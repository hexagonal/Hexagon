import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

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
    expect(refusals("let id<a>(x: a): a = x\nlet a: Dec = id(n * 1.5)\n"))
      .toEqual(["type mismatch: expected Dec, found Float"]);
    expect(refusals("let a = (n * 1.5).multiply(price)\n"))
      .toEqual(["type mismatch: expected Float, found Dec"]);
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
    expect(refusals("let p: (Dec, Dec) = (n, 0.5)\n")).toEqual([
      "type mismatch: expected Dec, found Int",
      "type mismatch: expected Dec, found Float",
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
      "`n - i` is a `Int` and cannot enter `Nat`, the home `: Nat` writes",
    ]);
  });

  test("a value already refused poisons the tree", () => {
    for (const source of ["let x: Dec = nope + n * f\n", "let x: Dec = n * f + nope\n"]) {
      expect(refusals(source)).toEqual(["unknown name `nope`"]);
    }
  });

  test("an unsolved value takes the face only where the face carries its demands", () => {
    // `x / x` demands `Frac`, which `Dec` carries and `BigInt` does not; either
    // way the tree's one report is the value that declined.
    expect(refusals("fun h(x) =\n    let w = x / x\n    let t: Dec = x * f\n    t\n")).toEqual([
      "`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`",
    ]);
    expect(refusals("fun h(x) =\n    let w = x / x\n    let t: BigInt = x * f\n    t\n")).toEqual([
      "`f` is a `Float` and cannot enter `BigInt`, so the multiplication could not run at `BigInt`",
    ]);
  });

  test("a declared variable in a refused tree keeps its own verdict", () => {
    for (const product of ["x * f", "f * x"]) {
      expect(refusals(`fun half<a: Num>(x: a): Dec = ${product}\n`)).toEqual([
        "`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`",
      ]);
    }
  });

  test("an unsolved value runs at the face, the kept type deciding nothing", () => {
    expect(refusals("fun h(x) =\n    let y: Dec = x * f\n    let z: Dec = x\n    z\n")).toEqual([
      "`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`",
    ]);
  });
});
