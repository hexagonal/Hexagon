import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for **one expression, one home** (#1062, Numeric Literals §5.1).
 *
 * An expression's tower operators and its forwarding forms (`if`, `match`,
 * `try`, grouping, a block's final expression) form one tree, and a seat ends
 * it. Its home is the seat's concrete type where one lands, and otherwise the
 * widest type its values establish — chosen once, every value then entering it.
 * A decimal-point literal is `Float` only where the tree offers no exact home,
 * so it never settles its part of an expression before the rest is in.
 */

const HEADER = "module Main\n\nimport Rat\n\n";
const FIXTURES =
  "let n: Int = 3\n" +
  "let i: Int = 4\n" +
  "let m: Nat = 2\n" +
  "let price: Dec = 2.50d\n" +
  "let c: Bool = True\n" +
  "let f: Float = 1.5\n";

const run = (source: string): Promise<Record<string, unknown>> =>
  runMain(HEADER + FIXTURES + source);
const refusals = (source: string): readonly string[] =>
  projectDiagnostics(HEADER + FIXTURES + source);

/** The emitted line that defines `name`. */
const emittedLine = (source: string, name: string): string => {
  const project = compileMain(HEADER + FIXTURES + source);
  expect(project.diagnostics).toEqual([]);
  const main = project.modules.find(({ name: module }) => module === "Main")!;
  return main.javascript.text.split("\n").find((line) => line.includes(`const ${name} =`))!;
};

describe("a decimal literal waits for the rest of its expression", () => {
  test("#1062's table: every row meets at Dec", async () => {
    const exports = await run(
      "let a1: Dec = n * 1.5 * price\n" +
        "let a2: Dec = (n + 0.5) * price\n" +
        "let a3: Dec = (if c then n else 0.5) * price\n" +
        "let a4: Dec = if c then n else 0.5\n" +
        "let a5: Dec = if c then 1 else 0.5\n" +
        "let a6: Dec = match c\n    True => n\n    False => m\n" +
        "let a7: Dec = match c\n    True => 0.5\n    False => n\n" +
        "export let shown: (String, String, String, String, String, String, String) = " +
        "(a1.show(), a2.show(), a3.show(), a4.show(), a5.show(), a6.show(), a7.show())\n",
    );
    expect(exports.shown).toEqual(["11.250", "8.750", "7.50", "3", "1", "3", "0.5"]);
  });

  test("unannotated, the home is the exact value's, wherever it stands", async () => {
    const exports = await run(
      "let b1 = n * 1.5 * price\n" +
        "let b2 = price * n * 1.5\n" +
        "let b3 = 1.5 * price * n\n" +
        "let b4 = (0.5 + 0.25) * price\n" +
        "let b5 = 0.5 * 2 * price\n" +
        "export let shown: (String, String, String, String, String) = " +
        "(b1.show(), b2.show(), b3.show(), b4.show(), b5.show())\n",
    );
    expect(exports.shown).toEqual(["11.250", "11.250", "11.250", "1.8750", "2.500"]);
  });

  test("in every operand order, every operation runs at Dec", () => {
    for (const spelled of ["n * 1.5 * price", "price * n * 1.5", "1.5 * price * n"]) {
      const line = emittedLine(`let b1 = ${spelled}\n`, "b1");
      // The literal is the `d` literal of its digits, and no multiplication
      // is JavaScript's own — each is `Dec`'s.
      expect(line).toContain("unscaled: 15n, places: 1");
      expect(line).not.toMatch(/[\w)] \* [\w(]/u);
    }
  });

  test("with nothing exact in the tree, a decimal literal is the Float it is", async () => {
    const exports = await run("export let plain: Float = n * 1.5\n");
    expect(exports.plain).toBe(4.5);
  });
});

describe("the forms join as one", () => {
  test("if and match meet at the wider integer in either order (#824)", async () => {
    const exports = await run(
      "let j1 = if c then m else n\n" +
        "let j2 = if c then n else m\n" +
        "let j3 = match c\n    True => m\n    False => n\n" +
        "let j4 = match c\n    True => n\n    False => m\n" +
        "let j5: Int = match c\n    True => n\n    False => m\n" +
        "let j6: Int =\n    try\n        m\n    catch\n        _ => n\n" +
        "export let joined: (Int, Int, Int, Int, Int, Int) = (j1, j2, j3, j4, j5, j6)\n",
    );
    expect(exports.joined).toEqual([2, 3, 2, 3, 3, 2]);
    // The home each join chose is `Int`, not the `Nat` its first path was.
    for (const join of [
      "if c then m else n",
      "if c then n else m",
      "match c\n    True => m\n    False => n",
      "match c\n    True => n\n    False => m",
    ]) {
      expect(refusals(`let j = ${join}\nlet z: Nat = j\n`))
        .toEqual(["type mismatch: expected Nat, found Int"]);
    }
  });

  test("a written face reaches a lambda body and an assignment", async () => {
    const exports = await run(
      "let g: () -> Dec = () => n\n" +
        "let assigned(): Dec =\n    var t: Dec = price\n    t := n * 1.5\n    t\n" +
        "export let shown: (String, String) = (g().show(), assigned().show())\n",
    );
    expect(exports.shown).toEqual(["3", "4.5"]);
  });
});

describe("comparisons are siblings", () => {
  test("both operands meet at one home before the comparison is chosen", async () => {
    const exports = await run(
      "export let compared: (Bool, Bool, Bool) = " +
        "(price < n * 1.5, n * 1.5 < price, price == 0.5 * 5)\n",
    );
    expect(exports.compared).toEqual([true, false, true]);
  });
});

describe("the instance gate", () => {
  test("an operation the home lacks runs at its own parts' home", async () => {
    const exports = await run("export let gated: Float = (n band 1) * f\n");
    expect(exports.gated).toBe(1.5);
  });
});

describe("what moves", () => {
  test("an operation runs at the wider home, exact past 2^53", async () => {
    const exports = await run(
      "let big: Int = 9007199254740991\n" +
        "let one: Dec = 1.00d\n" +
        "export let product: String = (big * i * one).show()\n",
    );
    expect(exports.product).toBe("36028797018963964.00");
  });

  test("an unannotated variable takes its tree's home", () => {
    expect(refusals(
      "let useNat(v: Nat): Nat = v\n" +
        "fun ff(x) =\n    let s = x + m + n\n    useNat(x)\n",
    )).toEqual(["type mismatch: expected Nat, found Int"]);
  });

  test("a type's partiality follows the home", async () => {
    const exports = await run(
      "let two: Int = 2\nlet k: Int = -1\n" +
        "export let reciprocal: Float = (two ** k) * f\n",
    );
    expect(exports.reciprocal).toBe(0.75);
  });
});

describe("the boundaries", () => {
  test("a binding, a call's result, and a dot receiver each end the tree", () => {
    expect(refusals("let y = n * 1.5\nlet a = y * price\n")).toEqual([
      "`price` is a `Dec` and `y` a `Float`; an expression's arithmetic runs at one type, " +
        "and neither enters the other; convert one explicitly — `price.toFloat()`",
    ]);
    expect(refusals("let id<a>(x: a): a = x\nlet a = id(n * 1.5) * price\n")).toEqual([
      "`price` is a `Dec` and `id(n * 1.5)` a `Float`; an expression's arithmetic runs at one " +
        "type, and neither enters the other; convert one explicitly — `price.toFloat()`",
    ]);
    // A face reaches no argument through a function's result (#1066): the
    // function-result report names the boundary and the ascription across it.
    expect(refusals("let id<a>(x: a): a = x\nlet a: Dec = id(n * 1.5)\n")).toEqual([
      "`id(n * 1.5)` is a `Float` — the type expected here does not reach an argument " +
        "through a function's result; write `id((n * 1.5: Dec))`",
    ]);
    expect(refusals("let a = (n * 1.5).multiply(price)\n")).toEqual([
      "`n * 1.5` settled at `Float` before `.multiply` saw `price` — a dot call's receiver " +
        "is settled on its own; write `n * 1.5 * price`, or name the home: `let a: Dec = …`",
    ]);
  });

  test("an established Float meets an exact value, and neither enters the other", () => {
    expect(refusals("let a = f * 1.5 * price\n")).toEqual([
      "`price` is a `Dec` and `f` a `Float`; an expression's arithmetic runs at one type, " +
        "and neither enters the other; convert one explicitly — `price.toFloat()`",
    ]);
    // Refused once for the whole expression, however many values decline.
    expect(refusals("let a = f + price + price + price\n")).toHaveLength(1);
    expect(refusals("let a = if c then f else (if c then price else price)\n")).toHaveLength(1);
  });

  test("a value its home cannot take is named with the home and the door", () => {
    expect(refusals("let b: BigInt = 7n\nlet a = b * 1.5\n")).toEqual([
      "`b` is a `BigInt` and cannot enter `Float`, the home `1.5` gives this expression; " +
        "convert one explicitly — `b.toFloat()`",
    ]);
    expect(refusals("let a = f * price\n")).toEqual([
      "`price` is a `Dec` and `f` a `Float`; an expression's arithmetic runs at one type, " +
        "and neither enters the other; convert one explicitly — `price.toFloat()`",
    ]);
  });

  test("a gated operation's result enters its home as any value does", () => {
    const refused =
      "`b band 1` is a `BigInt` and cannot enter `Float`, the home `f` gives this expression; " +
      "convert one explicitly — `(b band 1).toFloat()`";
    expect(refusals("let b: BigInt = 7n\nlet a = (b band 1) * f\n")).toEqual([refused]);
    expect(refusals("let b: BigInt = 7n\nlet a = (b band 1) * f + price\n")).toEqual([refused]);
  });

  test("the door is named on whichever side has one", () => {
    // `Rat` has an exit to `Float` and `Float` none into `Rat` (tenet 7), so the
    // repair converts the `Rat`, whichever value gave the home.
    const door = "convert one explicitly — `r.toFloat()`";
    const rat = "let r: Rat = Rat.create(1, 3)\n";
    expect(refusals(`${rat}let a = r * f\n`)[0]).toContain(door);
    expect(refusals(`${rat}let a = f * r\n`)[0]).toContain(door);
  });

  test("a refusal already reported poisons its tree, as it poisoned every join", () => {
    expect(refusals("let a = foo / 2\n")).toEqual(["unknown name `foo`"]);
    expect(refusals("let a = foo + \"a\"\n")).toEqual(["unknown name `foo`"]);
    expect(refusals("let a: Int = foo / 2\n")).toEqual(["unknown name `foo`"]);
    expect(refusals(
      "let g = (v: Int) => v\nlet a: Int = match g\n    _ => \"s\"\n",
    )).toEqual(["cannot match on `(Int) -> Int` yet"]);
    expect(refusals(
      "let g = (v: Int) => v\nlet a = (match g\n    _ => \"s\"\n    ) + 1\n",
    )).toEqual(["cannot match on `(Int) -> Int` yet"]);
  });

  test("grouping moves no report", () => {
    const at = (source: string): number => {
      const project = compileMain(HEADER + FIXTURES + source);
      return project.diagnostics[0]!.primary.start.offset;
    };
    const plain = at("let a = n + \"a\"\n");
    expect(at("let a = (n) + (\"a\")\n")).toBe(plain);
  });

  test("the exclusions stand", () => {
    expect(refusals("fun half<a: Frac>(x: a): a = x * 0.5\n")).toEqual([
      "`a` is a declared type variable, but the body requires `Float`; change the annotation " +
        "to `Float`, or remove it to let the type be inferred",
    ]);
  });

  test("declared and constrained variables keep their targets", () => {
    const kept =
      "fun widen<t: Num>(value: Nat): t = value\n" +
      "fun k(count: Int, value) =\n    let z = value / value\n    count * value\n" +
      "fun k5(count: Int, value) =\n    let z = value + 1\n    count * value\n" +
      "let scale<a: Signed>(count: Int, value: a): a = count * value\n";
    expect(refusals(kept)).toEqual([]);
    // `k` stays polymorphic, `<a: Frac> (Int, a) -> a`: a `Float` reaches it.
    expect(refusals(kept + "let kf: Float = k(1, 2.5)\n")).toEqual([]);
    // `k5`'s variable carries `Num` alone, which an `Int` cannot enter: it is
    // `(Int, Int) -> Int`, and a `Float` does not reach it.
    expect(refusals(kept + "let kf = k5(1, 2.5)\n")).toHaveLength(1);
  });

  test("which constrained variable is asked first decides nothing", () => {
    for (const sum of ["x + y + n", "y + x + n"]) {
      for (const first of ["x == x", "x + x"]) {
        expect(refusals(
          `fun g(x, y) =\n    let t = ${first}\n    let z = y / y\n    ${sum}\n`,
        )).toEqual([]);
      }
    }
  });

  test("an operator under a face keeps its seats", () => {
    // `**`'s exponent is its own seat, faced by `Int` (Operators §6.3).
    expect(refusals("let x: Int = n ** (m - m)\n")).toEqual([]);
    // A negation or `bnot` is an operand seat like any other: it stands down
    // with the value it holds, and the report names that value (#827).
    expect(refusals("let x: Dec = -(n * f)\n")).toEqual([
      "`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`",
    ]);
    expect(refusals("let x: Int = bnot f\n")).toEqual([
      "`f` is a `Float` and cannot enter `Int`, so the bitwise complement could not run at `Int`",
    ]);
  });
});

describe("a faced tree is refused once, naming the value that declined (#827)", () => {
  test("one report, whatever forms and operations stand between", () => {
    const declined = (face: string, operation: string): string =>
      `\`f\` is a \`Float\` and cannot enter \`${face}\`, so the ${operation} could not run at \`${face}\``;
    expect(refusals("let r: Rat = Rat.fromInt(2)\nlet x: Rat = (if c then n else f) * r\n"))
      .toEqual([declined("Rat", "multiplication")]);
    expect(refusals("let x: Dec = (n + f) * price\n")).toEqual([declined("Dec", "addition")]);
    expect(refusals("let x: Dec = if c then f * 2 else price\n"))
      .toEqual([declined("Dec", "multiplication")]);
    expect(refusals("let x: Dec =\n    try\n        n * f\n    catch\n        _ => price\n"))
      .toEqual([declined("Dec", "multiplication")]);
    expect(refusals("let x: Dec = (if c then n * f else price) * price\n"))
      .toEqual([declined("Dec", "multiplication")]);
  });

  test("the first value in source order is the one named", () => {
    // `f` comes before `price`, and before the second `f`; an operand that is
    // itself an operation is never the one named — the value inside it is.
    expect(refusals("let x: Dec = (n * f) * (i * f)\n"))
      .toEqual(["`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`"]);
    expect(refusals("let x: Dec = f * 2 + n * f\n"))
      .toEqual(["`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`"]);
    // An unsolved value is never taken for the one that declined.
    expect(refusals("fun g(x) =\n    let y: Dec = (x * f) + x\n    y\n"))
      .toEqual(["`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`"]);
  });

  test("with no operation between the value and the seat, the value is refused where it meets the face", () => {
    const entry = "`f` is a `Float` and cannot enter `Dec`, the home `: Dec` writes; " +
      "convert it explicitly — `Dec.fromFloat(f, places)`";
    expect(refusals("let x: Dec = if c then f else price\n")).toEqual([entry]);
    expect(refusals("let x: Dec = if c then f else n * f\n")).toEqual([entry]);
  });

  test("a stood-down operation selects no evidence at the type it kept", () => {
    const foo = "record Foo = {n: Int}\n" +
      "honor Num<Foo> =\n    add(left, right) = left\n    multiply(left, right) = left\n" +
      "    fromNat(value) = Foo({n = 0})\n" +
      "let p: Foo = Foo({n = 4})\nlet q: Foo = Foo({n = 6})\n";
    // `Foo` has no `Frac`, and nothing asks it to: the division ran nowhere.
    expect(refusals(foo + "let x: Rat = p / q\n")).toEqual([
      "`p` is a `Foo` and cannot enter `Rat`, so the division could not run at `Rat`",
    ]);
  });
  test("a gated call whose own parts select no home is a value that reaches", () => {
    // `Nat` honors no `Signed`, so `y - z` is gated; its operands are unsolved
    // and select no home, so it reaches the face like any unsolved value, and
    // the gate's missing instance is the one report — never silence.
    const missing = (face: string, rung: string): string =>
      `type \`${face}\` has no \`${rung}\` instance`;
    for (
      const [source, face, rung] of [
        ["fun gg(y, z) =\n    let x: Nat = (y - z) + m\n    x\n", "Nat", "Signed"],
        ["fun gg(y) =\n    let x: Nat = -y + m\n    x\n", "Nat", "Signed"],
        ["fun gg(y) =\n    let x: Nat = if c then -y else m\n    x\n", "Nat", "Signed"],
        ["fun gg(y, z) =\n    let x: Float = (y band z) * f\n    x\n", "Float", "Bitwise"],
      ] as const
    ) {
      const reports = refusals(source);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain(missing(face, rung));
    }
    // Inside a tree already refused, the gated call adds nothing: the tree's
    // one report is the value that declined.
    for (const sum of ["(y - z) + f", "f + (y - z)", "(y - z) * 2 + f"]) {
      expect(refusals(`fun gg(y, z) =\n    let x: Nat = ${sum}\n    x\n`)).toEqual([
        "`f` is a `Float` and cannot enter `Nat`, so the addition could not run at `Nat`",
      ]);
    }
    // A gated call that does select a home is a value like any other.
    expect(refusals("let x: Nat = if c then n - i else m\n")).toEqual([
      "`n - i` is an `Int` and cannot enter `Nat`, the home `: Nat` writes",
    ]);
  });

  test("a value already refused poisons the tree", () => {
    for (const source of ["let x: Dec = nope + n * f\n", "let x: Dec = n * f + nope\n"]) {
      expect(refusals(source)).toEqual(["unknown name `nope`"]);
    }
  });

  test("a refused tree decides nothing about an unsolved value", () => {
    // `x / x` demands `Frac`, which `Dec` carries and `BigInt` does not; either
    // way the tree's one report is the value that declined.
    expect(refusals("fun h(x) =\n    let w = x / x\n    let t: Dec = x * f\n    t\n")).toEqual([
      "`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`",
    ]);
    // And where the demand comes after the tree: the tree decided nothing
    // about `x`, so `x / x` meets no face it was given.
    expect(refusals("fun h(x) =\n    let t: Dec = x * f\n    let w = x / x\n    t\n")).toEqual([
      "`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`",
    ]);
    expect(refusals("fun h(x) =\n    let w = x / x\n    let t: BigInt = x * f\n    t\n")).toEqual([
      "`f` is a `Float` and cannot enter `BigInt`, so the multiplication could not run at `BigInt`",
    ]);
  });

  test("a declared variable declines, and speaks in its own words", () => {
    // No conversion takes `a` into `Dec`: `x` declines like any established
    // type, and the first declining value in source order is the one named —
    // a declared variable by its own report, at the value (#827, ruling 3).
    const declared = "`a` is a declared type variable, but the body requires `Dec`; " +
      "change the annotation to `Dec`, or remove it to let the type be inferred";
    expect(refusals("fun half<a: Num>(x: a): Dec = x * f\n")).toEqual([declared]);
    expect(refusals("fun half<a: Num>(x: a): Dec = if c then x else f\n")).toEqual([declared]);
    expect(refusals("fun half<a: Num>(x: a): Dec = f * x\n")).toEqual([
      "`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`",
    ]);
    // Alone, it is the report it always was.
    expect(refusals("fun half<a: Num>(x: a): Dec = x * 2\n")).toEqual([declared]);
  });

  test("an unsolved value is left to its later seats, the kept type deciding nothing", () => {
    expect(refusals("fun h(x) =\n    let y: Dec = x * f\n    let z: Dec = x\n    z\n")).toEqual([
      "`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`",
    ]);
  });
});

describe("calls join the tree (#1062, part 2)", () => {
  const generic = "let h<t: Num>(x: t, y: t): t = x + y\n" +
    "let h3<t: Num>(x: t, v: Vector(t), y: t): t = y\n" +
    "let decs: Vector(Dec) = [price]\n";

  test("a tower member call is an interior node in every spelling", async () => {
    const exports = await run(
      "let c1 = Num.multiply(n, 1.5) * price\n" +
        "let c2 = n.multiply(1.5) * price\n" +
        "let c3 = (n |> Num.multiply(1.5)) * price\n" +
        "let c4 = price.multiply(n * 1.5)\n" +
        "let c5: Dec = (n * 1.5).multiply(price)\n" +
        "let c6 = Num.add(0.5, price)\n" +
        "export let shown: (String, String, String, String, String, String) = " +
        "(c1.show(), c2.show(), c3.show(), c4.show(), c5.show(), c6.show())\n",
    );
    expect(exports.shown).toEqual(["11.250", "11.250", "11.250", "11.250", "11.250", "3.00"]);
  });

  test("arguments at one type variable are siblings, in either order", async () => {
    const exports = await run(
      generic +
        "let s1 = h(n * 1.5, price)\n" +
        "let s2 = h(price, n * 1.5)\n" +
        "let s3 = price.compare(n * 1.5) == Ordering.Less\n" +
        "export let shown: (String, String, Bool) = (s1.show(), s2.show(), s3)\n",
    );
    expect(exports.shown).toEqual(["7.00", "7.00", true]);
    for (const call of ["h(n * 1.5, price)", "h(price, n * 1.5)"]) {
      expect(emittedLine(generic + `let s = ${call}\n`, "s")).not.toMatch(/[\w)] \* [\w(]/u);
    }
  });

  test("the schedule residue: what a receiver was handed at its turn", () => {
    // `decs` solves `t` at its turn, so the later receiver is handed `Dec`
    // (Method Syntax §2.2) and runs there; the earlier one closed at `Float`.
    expect(refusals(generic + "let r = h3((n * 1.5).multiply(price), decs, 0.5)\n")).toEqual([
      "`n * 1.5` settled at `Float` before `.multiply` saw `price` — a dot call's receiver " +
        "is settled on its own; write `n * 1.5 * price`, or name the home: " +
        "`(n * 1.5: Dec)`",
    ]);
    expect(refusals(generic + "let r = h3(0.5, decs, (n * 1.5).multiply(price))\n")).toEqual([]);
  });

  test("the siblings' home is settled before a callback reads it", () => {
    const folds = "let fs: Vector(Float) = [f]\n";
    expect(refusals(folds + "let t = Seq.fold(fs.toSeq(), 0.0, (acc, x) => acc + x)\n"))
      .toEqual([]);
    // `0.0` alone at `b` is a `Float` before the callback is checked, so the
    // callback's `Dec` element cannot join it.
    expect(refusals(generic + "let t = Seq.fold(decs.toSeq(), 0.0, (acc, x) => acc + x)\n"))
      .toHaveLength(1);
  });

  test("a vector literal's elements are siblings", () => {
    for (const vector of ["[m, n]", "[n, m]"]) {
      expect(refusals(`let v: Vector(Int) = ${vector}\n`)).toEqual([]);
    }
    for (const vector of ["[m, n, price]", "[price, m, n]", "[n, price]", "[price, n * 1.5]"]) {
      expect(refusals(`let v: Vector(Dec) = ${vector}\n`)).toEqual([]);
    }
  });

  test("an inferred face reaches a receiver the schedule solved it for (#818)", async () => {
    // `bigs` solves `t` at its turn, so the dot chain's receiver is handed
    // `BigInt` and the addition cannot overflow.
    const exports = await run(
      "let big: BigInt = 1n\n" +
        "let bigs: Vector(BigInt) = [big]\n" +
        "let a9: Int = 9007199254740991\n" +
        "let b9: Int = 2\n" +
        "let c9: Int = 3\n" +
        "let f2<t: Num>(v: Vector(t), y: t): t = y\n" +
        "export let exact: String = f2(bigs, a9.add(b9).multiply(c9)).show()\n",
    );
    expect(exports.exact).toBe("27021597764222979");
  });

  test("every spelling of a tower call reports as its operator does", () => {
    const declared = "`a` is a declared type variable, but the body requires `Dec`; " +
      "change the annotation to `Dec`, or remove it to let the type be inferred";
    for (const body of ["x * f", "Num.multiply(x, f)", "x.multiply(f)", "x |> Num.multiply(f)"]) {
      expect(refusals(`fun half<a: Num>(x: a): Dec = ${body}\n`), body).toEqual([declared]);
    }
    const foo = "record Foo = {n: Int}\n" +
      "honor Num<Foo> =\n    add(left, right) = left\n    multiply(left, right) = left\n" +
      "    fromNat(value) = Foo({n = 0})\n" +
      "honor Signed<Foo> =\n    subtract(left, right) = left\n    negate(value) = value\n" +
      "    fromInt(value) = Foo({n = value})\n" +
      "let s2: Foo = Foo({n = 8})\n";
    const orders = ["Integral.gcd(s2, n + i)", "Integral.gcd(n + i, s2)", "(n + i).gcd(s2)"];
    const reports = orders.map((call) => refusals(foo + `let g = ${call}\n`));
    expect(reports[0]).toHaveLength(1);
    expect(reports[0]![0]).toContain("type `Foo` has no `Integral` instance");
    for (const report of reports) expect(report).toEqual(reports[0]);
    // Under a face the operand order is invisible too, whether or not the
    // declining type carries the rung (Method Syntax §2.2): `s2` is named once.
    for (const call of orders) {
      expect(refusals(foo + `let g: BigInt = ${call}\n`), call).toEqual([
        "`s2` is a `Foo` and cannot enter `BigInt`, so the `gcd` operation could not run at `BigInt`",
      ]);
    }
  });

  test("a receiver that closed before the dot is named with both repairs", () => {
    expect(refusals("let a = (n + 1.5).multiply(price)\n")).toEqual([
      "`n + 1.5` settled at `Float` before `.multiply` saw `price` — a dot call's receiver " +
        "is settled on its own; write `(n + 1.5) * price`, or name the home: `let a: Dec = …`",
    ]);
    expect(refusals("let a = (n * 1.5).add(price * 2)\n")).toEqual([
      "`n * 1.5` settled at `Float` before `.add` saw `price * 2` — a dot call's receiver " +
        "is settled on its own; write `n * 1.5 + price * 2`, or name the home: `let a: Dec = …`",
    ]);
    // Away from a binding, the home is named by an ascription.
    expect(refusals("let id<a>(x: a): a = x\nlet a = id((n * 1.5).multiply(price))\n")).toEqual([
      "`n * 1.5` settled at `Float` before `.multiply` saw `price` — a dot call's receiver " +
        "is settled on its own; write `n * 1.5 * price`, or name the home: " +
        "`(n * 1.5: Dec)`",
    ]);
    // A receiver holding an established `Float` would not have entered `Dec`
    // either way: the ordinary conflict.
    expect(refusals("let a = (f * 2).multiply(price)\n")).toEqual([
      "`price` is a `Dec` and `(f * 2)` a `Float`; an expression's arithmetic runs at one " +
        "type, and neither enters the other; convert one explicitly — `price.toFloat()`",
    ]);
  });

  test("the closed-receiver report offers only what compiles", () => {
    // `Dec` honors no `Frac`, so `.divide` could not have run at `Dec` either:
    // the ordinary conflict, and no rewrite.
    const conflict = "`price` is a `Dec` and `(n + 1.5)` a `Float`; an expression's " +
      "arithmetic runs at one type, and neither enters the other; convert one explicitly — " +
      "`price.toFloat()`";
    expect(refusals("let a = (n + 1.5).divide(price * 2)\n")).toEqual([conflict]);
    expect(refusals("let a: Dec = (n + 1.5).divide(price * 2)\n")).toEqual([conflict]);
    // An open member outside the tower: its result is no home, so the
    // receiver is ascribed.
    expect(refusals("let a = (n * 1.5).compare(price)\n")).toEqual([
      "`n * 1.5` settled at `Float` before `.compare` saw `price` — a dot call's receiver " +
        "is settled on its own; name the home: `(n * 1.5: Dec)`",
    ]);
    // A home this site cannot spell drops that repair and keeps the report:
    // `Rat` reached only through another module's face has no name here.
    const lib = "module Lib\n\nimport Rat\n\nexport let third: Rat = Rat.create(1, 3)\n";
    expect(compileFiles([
      ["/main.hex", "module Main\n\nimport Lib\n\nlet n: Int = 3\nlet a = (n * 1.5).multiply(Lib.third)\n"],
      ["/Lib.hex", lib],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "`n * 1.5` settled at `Float` before `.multiply` saw `Lib.third` — a dot call's receiver " +
        "is settled on its own; write `n * 1.5 * Lib.third`",
    ]);
    // The refused receiver takes the call around it with it.
    expect(refusals("let a = (n * 1.5).multiply(price).add(price)\n")).toEqual([
      "`n * 1.5` settled at `Float` before `.multiply` saw `price` — a dot call's receiver " +
        "is settled on its own; write `n * 1.5 * price`, or name the home: `(n * 1.5: Dec)`",
    ]);
  });

  test("a stood-down call in every spelling selects no evidence at its kept type", () => {
    const foo = "record Foo = {n: Int}\n" +
      "honor Num<Foo> =\n    add(left, right) = left\n    multiply(left, right) = left\n" +
      "    fromNat(value) = Foo({n = 0})\n" +
      "let p: Foo = Foo({n = 4})\nlet q: Foo = Foo({n = 6})\n";
    for (const division of ["p / q", "Frac.divide(p, q)", "p |> Frac.divide(q)"]) {
      expect(refusals(foo + `let x: Rat = ${division}\n`), division).toEqual([
        "`p` is a `Foo` and cannot enter `Rat`, so the division could not run at `Rat`",
      ]);
    }
    for (const division of ["zzz / 1.5", "Frac.divide(zzz, 1.5)"]) {
      expect(refusals(`let x = ${division}\n`), division).toEqual(["unknown name `zzz`"]);
    }
  });

  test("a sibling's home an earlier argument solved is named", () => {
    const report = "`f` is a `Float` and cannot enter `Dec`, the home `decs` gives this " +
      "argument; convert it explicitly — `Dec.fromFloat(f, places)`";
    expect(refusals(generic + "let a = h3(0.5, decs, f)\n")).toEqual([report]);
    expect(refusals(generic + "let a = h3(f, decs, f)\n")).toEqual([report]);
    expect(refusals(generic + "let app<t: Num>(x: t, v: Vector(t)): t = x\nlet a = app(f, decs)\n"))
      .toEqual([report]);
  });

  test("an argument checked before the pass was built has had its turn", () => {
    // The companion receiver solves `a` before `n`'s group closes.
    expect(emittedLine("let big: BigInt = 1n\nlet bigs: Vector(BigInt) = [big]\n" +
      "let a = bigs.append(n)\n", "a")).toContain("BigInt(n)");
  });

  test("a vector element that does not join is reported at the element", () => {
    const project = compileMain(HEADER + FIXTURES + "let v = [n, \"a\", m]\n");
    expect(project.diagnostics.map(({ message }) => message))
      .toEqual(["type mismatch: expected Int, found String"]);
    const text = (HEADER + FIXTURES + "let v = [n, \"a\", m]\n");
    expect(project.diagnostics[0]!.primary.start.offset).toBe(text.indexOf("\"a\""));
  });

  test("a callback is a black box whose written face is visible (ruling A2)", async () => {
    const apply = "let apply2(x: a, g: (a) -> a): a = g(x)\n" +
      "let apply3(g: (a) -> a, x: a): a = g(x)\n";
    const exports = await run(
      apply +
        "let w1 = apply2(m, (v: Int) => v + n)\n" +
        "let w2 = apply3((v: Int) => v + n, m)\n" +
        "let w3 = apply2(m, (v): Int => v + n)\n" +
        "fun outer(p) = apply2(p, (v) => v + n)\n" +
        "export let shown: (Int, Int, Int, Int) = (w1, w2, w3, outer(1))\n",
    );
    expect(exports.shown).toEqual([5, 5, 5, 4]);
    const settled = "`m` settled this call's `Nat` before the callback was checked, and the " +
      "callback's body returns `Int` — a callback's body chooses no type for the values " +
      "beside it; write `(m: Int)`, or annotate the callback: `(v: Int) => …`";
    expect(refusals(apply + "let w = apply2(m, (v) => v + n)\n")).toEqual([settled]);
    expect(refusals(apply + "let w = apply3((v) => v + n, m)\n")).toEqual([settled]);
    // Both repairs compile.
    expect(refusals(apply + "let w = apply2((m: Int), (v) => v + n)\n")).toEqual([]);
  });

  test("a literal receiver is a value of its call (ruling b′)", async () => {
    const exports = await run(
      "let l1 = 1.5.multiply(price)\n" +
        "let l2 = (1.5).multiply(price)\n" +
        "let l3 = (-1.5).multiply(price)\n" +
        "let l4 = (2).multiply(price)\n" +
        "export let shown: (String, String, String, String) = " +
        "(l1.show(), l2.show(), l3.show(), l4.show())\n",
    );
    expect(exports.shown).toEqual(["3.750", "3.750", "-3.750", "5.00"]);
    // A form of literals is no literal: it settled at `Float`.
    expect(refusals("let a = (if c then 1.5 else 2.5).multiply(price)\n")).toHaveLength(1);
    expect(refusals("let y = 1.5\nlet a = y.multiply(price)\n")).toHaveLength(1);
  });

  test("a callback's annotation is read early only where reading it has no effect", () => {
    const apply = "let apply2(x: a, g: (a) -> a): a = g(x)\n";
    // A hole is the lambda's own to read: it takes the type the call settles.
    const project = compileMain(HEADER + FIXTURES + apply + "let w = apply2(m, (v: _) => v)\n");
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ name }) => name === "Main")!;
    expect(main.typed.typeHoles.map(({ scheme }) => scheme.type))
      .toEqual([{ kind: "Primitive", name: "Nat" }]);
    // A constrained hole's constraint is required once.
    const frac = refusals(apply + "let w = apply2(m, (v: _ : Frac) => v)\n");
    expect(frac).toHaveLength(1);
    expect(frac[0]).toContain("type `Nat` has no `Frac` instance");
    // An arrow's colour is reported as the lambda's own reading finds it, as on
    // `main`; an early reading would call the `->?` orphaned instead.
    expect(refusals(
      "let spare(): Unit = ()\nlet applyF(x: a, g: (a) -> Int): Int = g(x)\n" +
        "let w = applyF(spare, (k: () ->? Unit) => 1)\n",
    )).toEqual([
      "this signature's `->?` promises a colour the caller chooses, but the body solves it " +
        "to the pure constant — the honest face is `->`",
    ]);
    // A malformed annotation reports once.
    expect(refusals(apply + "let w = apply2(m, (v: Zork) => v)\n")).toEqual(["unknown type `Zork`"]);
  });

  test("a literal receiver is a value at every open member, through any grouping", () => {
    for (const receiver of ["1.5", "(1.5)", "(-1.5)", "(-(1.5))"]) {
      expect(refusals(`let a = ${receiver}.compare(price)\n`), receiver).toEqual([]);
      expect(refusals(`let a = ${receiver}.multiply(price)\n`), receiver).toEqual([]);
    }
  });

  test("the settled-callback report names what settled the home, and offers what compiles", () => {
    const report = (sibling: string, settled: string, body: string, repairs: string): string =>
      `\`${sibling}\` settled this call's \`${settled}\` before the callback was checked, and ` +
      `the callback's body returns \`${body}\` — a callback's body chooses no type for the ` +
      `values beside it; ${repairs}`;
    // The value that established the home, not the first sibling.
    expect(refusals(
      "let apply4(x: a, y: a, g: (a) -> a): a = g(x)\nlet w = apply4(1, m, (v) => v + n)\n",
    )).toEqual([report("m", "Nat", "Int", "write `(m: Int)`, or annotate the callback: `(v: Int) => …`")]);
    // A parameter written in the variable, but not as it, is not annotated.
    expect(refusals(
      "let applyV(x: a, g: (Vector(a)) -> a): a = x\nlet w = applyV(m, (vs) => vs.at(1) + n)\n",
    )).toEqual([report("m", "Nat", "Int", "write `(m: Int)`")]);
    // A `Dec` body is reported as any other.
    expect(refusals("let apply2(x: a, g: (a) -> a): a = g(x)\nlet w = apply2(n, (v) => v * price)\n"))
      .toEqual([report("n", "Int", "Dec", "write `(n: Dec)`, or annotate the callback: `(v: Dec) => …`")]);
  });

  test("a repair names its type as this site resolves it (#1089)", () => {
    const apply = "let apply2(x: a, g: (a) -> a): a = g(x)\n";
    const settled = (sibling: string, body: string, repairs: string): string =>
      `\`${sibling}\` settled this call's \`Int\` before the callback was checked, and the ` +
      `callback's body returns \`${body}\` — a callback's body chooses no type for the ` +
      `values beside it${repairs}`;
    const closed = (saw: string, repairs: string): string =>
      `\`n * 1.5\` settled at \`Float\` before \`.multiply\` saw \`${saw}\` — a dot call's ` +
      `receiver is settled on its own; ${repairs}`;
    // A local `Dec` takes the bare name, so the prelude's is reached through
    // its companion — and each repair offered compiles.
    const shadowed = (source: string): readonly string[] =>
      projectDiagnostics("module Main\n\nrecord Dec = {z: Int}\n\nlet n: Int = 3\n" + source);
    expect(shadowed(apply + "let w = apply2(n, (v) => v * 2.50d)\n")).toEqual([
      settled("n", "Dec", "; write `(n: Dec.Dec)`, or annotate the callback: `(v: Dec.Dec) => …`"),
    ]);
    expect(shadowed("let a = (n * 1.5).multiply(2.50d)\n")).toEqual([
      closed("2.50d", "write `n * 1.5 * 2.50d`, or name the home: `let a: Dec.Dec = …`"),
    ]);
    expect(shadowed(apply + "let w = apply2((n: Dec.Dec), (v) => v * 2.50d)\n")).toEqual([]);
    expect(shadowed(apply + "let w = apply2(n, (v: Dec.Dec) => v * 2.50d)\n")).toEqual([]);
    expect(shadowed("let a: Dec.Dec = (n * 1.5).multiply(2.50d)\n")).toEqual([]);
    // An imported type is spelled as the file spells it: bare through its
    // companion alias, qualified through any other.
    const rat = "let r: Rat = Rat.fromInt(2)\n";
    expect(refusals(rat + apply + "let w = apply2(n, (v) => v * r)\n")).toEqual([
      settled("n", "Rat", "; write `(n: Rat)`, or annotate the callback: `(v: Rat) => …`"),
    ]);
    expect(refusals(rat + "let a = (n * 1.5).multiply(r)\n")).toEqual([
      closed("r", "write `n * 1.5 * r`, or name the home: `let a: Rat = …`"),
    ]);
    expect(refusals(rat + "let a = (n * 1.5).compare(r)\n")).toEqual([
      "`n * 1.5` settled at `Float` before `.compare` saw `r` — a dot call's receiver " +
        "is settled on its own; name the home: `(n * 1.5: Rat)`",
    ]);
    expect(refusals(rat + apply + "let w = apply2((n: Rat), (v) => v * r)\n")).toEqual([]);
    expect(refusals(rat + apply + "let w = apply2(n, (v: Rat) => v * r)\n")).toEqual([]);
    expect(refusals(rat + "let a: Rat = (n * 1.5).multiply(r)\n")).toEqual([]);
    expect(refusals(rat + "let a = (n * 1.5: Rat).compare(r)\n")).toEqual([]);
    const aliased = (source: string): readonly string[] =>
      projectDiagnostics("module Main\n\nimport Rat as Q\n\nlet n: Int = 3\n" + apply +
        "let r = Q.fromInt(2)\n" + source);
    expect(aliased("let w = apply2(n, (v) => v * r)\n")).toEqual([
      settled("n", "Rat", "; write `(n: Q.Rat)`, or annotate the callback: `(v: Q.Rat) => …`"),
    ]);
    expect(aliased("let w = apply2((n: Q.Rat), (v) => v * r)\n")).toEqual([]);
    // An implied type of the module's own constraint takes the bare name, and
    // refuses it outside its constraint.
    const implied = (source: string): readonly string[] =>
      projectDiagnostics("module Main\n\nimport Rat\n\nconstraint Source<a> =\n    type Rat\n" +
        "    peek(supply: a) -> Rat\n\nlet n: Int = 3\n" + apply + "let r = Rat.fromInt(2)\n" + source);
    expect(implied("let w = apply2(n, (v) => v * r)\n")).toEqual([
      settled("n", "Rat", "; write `(n: Rat.Rat)`, or annotate the callback: `(v: Rat.Rat) => …`"),
    ]);
    expect(implied("let w = apply2((n: Rat.Rat), (v) => v * r)\n")).toEqual([]);
    // An implied type skips only the companion fallback: outside its
    // constraint the tables and the compiler's own names answer first.
    expect(projectDiagnostics(
      "module Main\n\nconstraint Source<a> =\n    type Float\n    peek(supply: a) -> Float\n\n" +
        "let n: Int = 3\n" + apply + "let g = 1.5\nlet w = apply2(n, (v) => v * g)\n",
    )).toEqual([settled("n", "Float", "; write `(n: Float)`, or annotate the callback: `(v: Float) => …`")]);
    // Implied `Dec` keeps the prelude's bare `Dec`.
    expect(projectDiagnostics(
      "module Main\n\nconstraint Source<a> =\n    type Dec\n    peek(supply: a) -> Dec\n\n" +
        "let n: Int = 3\n" + apply + "let w = apply2(n, (v) => v * 2.50d)\n",
    )).toEqual([settled("n", "Dec", "; write `(n: Dec)`, or annotate the callback: `(v: Dec) => …`")]);
    // The module's own union is spelled bare.
    const own = "module Main\n\nunion U = U(Int)\n\n" +
      "honor Num<U> =\n    add(left, right) = left\n    multiply(left, right) = left\n" +
      "    fromNat(value) = U(0)\n" +
      "honor Signed<U> =\n    subtract(left, right) = left\n    negate(value) = value\n" +
      "    fromInt(value) = U(value)\n\nlet n: Int = 3\nlet u: U = U(2)\n" + apply;
    expect(projectDiagnostics(own + "let w = apply2(n, (v) => v * u)\n")).toEqual([
      settled("n", "U", "; write `(n: U)`, or annotate the callback: `(v: U) => …`"),
    ]);
    expect(projectDiagnostics(own + "let w = apply2((n: U), (v) => v * u)\n")).toEqual([]);
    // An imported union the file never names is reached through its alias.
    const unionLib = own.replace("module Main", "module Lib").replace("union U", "export union U")
      .replace("let u: U = U(2)", "export let two: U = U(2)").replace(apply, "");
    const imported = (call: string): readonly string[] =>
      compileFiles([
        ["/main.hex", "module Main\n\nimport Lib as L\n\nlet n: Int = 3\n" + apply + "let u = L.two\n" + call],
        ["/Lib.hex", unionLib],
      ]).diagnostics.map(({ message }) => message);
    expect(imported("let w = apply2(n, (v) => v * u)\n")).toEqual([
      settled("n", "U", "; write `(n: L.U)`, or annotate the callback: `(v: L.U) => …`"),
    ]);
    expect(imported("let w = apply2((n: L.U), (v) => v * u)\n")).toEqual([]);
    // And through its companion alias, bare.
    expect(compileFiles([
      ["/main.hex", "module Main\n\nimport Lib as U\n\nlet n: Int = 3\n" + apply + "let u = U.two\n" +
        "let w = apply2(n, (v) => v * u)\n"],
      ["/Lib.hex", unionLib],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      settled("n", "U", "; write `(n: U)`, or annotate the callback: `(v: U) => …`"),
    ]);
    // A compiler-owned type whose name a declaration took has no spelling —
    // the module's own, or an import's through its companion alias.
    const float = "let n: Int = 3\n" + apply + "let g = 1.5\nlet w = apply2(n, (v) => v * g)\n";
    for (const lib of ["export type Float = Int\n", 'extern from "./x.js"\n    export type Float\n']) {
      expect(compileFiles([
        ["/main.hex", "module Main\n\nimport Lib as Float\n\n" + float],
        ["/Lib.hex", "module Lib\n\n" + lib],
      ]).diagnostics.map(({ message }) => message), lib).toEqual([settled("n", "Float", "")]);
    }
    for (const declaration of ["record Float = {z: Int}", "type Float = Int", 'extern from "./x.js"\n    type Float']) {
      expect(projectDiagnostics(
        `module Main\n\n${declaration}\n\nlet n: Int = 3\n` + apply +
          "let g = 1.5\nlet w = apply2(n, (v) => v * g)\n",
      ), declaration).toEqual([settled("n", "Float", "")]);
    }
  });

  test("an annotated binding is never offered its own annotation", () => {
    expect(refusals("let a: String = (n * 1.5).multiply(price)\n")).toEqual([
      "`n * 1.5` settled at `Float` before `.multiply` saw `price` — a dot call's receiver " +
        "is settled on its own; write `n * 1.5 * price`",
    ]);
  });
});
