/**
 * Conformance for #808 — **the dot on a tower member is the open member call**,
 * and for the emission rider it carries.
 *
 * Method Syntax §1's sentence, which every test here is a reading of:
 *
 * > `receiver.name(args…)` is the one operation `name` the receiver's type owns,
 * > applied to `(receiver, args…)` and elaborated exactly as that operation's own
 * > spelling would be. **The receiver decides *what* is called; the operation
 * > decides *where it runs*.**
 *
 * Four claims, and the file is in four parts after the acceptance block:
 *
 * 1. **One elaboration, five spellings.** Operator, bare, constraint-qualified,
 *    pipe stage and dot are one call at a tower member (Numeric Literals §5.1's
 *    closed rungs — `Num`, `Signed`, `Frac`, `Pow`, `Integral`), so the operand
 *    widening and the **expected-type lift** reach all of them. The lift's
 *    observable content is a *value*: without it, `let r: BigInt = i.add(j)` ran
 *    the addition at `Int` and injected a sum `Int` may already have folded past
 *    2^53 — the silent overflow §5.1 exists to prevent, which had three spellings
 *    to hide in.
 * 2. **Members widen by their operands; doors are addressed by the receiver**
 *    (§6.1). `i.add(b)` and `b.add(i)` are both `BigInt`; `b.pow(i)` is the door
 *    with the `Int` injected — #783's first half — and `b.bump(p)`, an ordinary
 *    companion export with a written `BigInt` seat, is its second.
 * 3. **The ownership clause** (§4.2): `Nat` and `Int` own the subject-first
 *    members of the tower rungs they do not honor, so `n.subtract(m)` has a
 *    spelling, takes a written face, and without one refuses exactly as `n - m`
 *    does — with §9 row 15's rider on both spellings.
 * 4. **§8.1's emission rule**: wherever the operator spelling of a member lowers
 *    to a JavaScript operator at a type JavaScript represents by a primitive
 *    value, every other spelling produces that lowering *verbatim*. The check is
 *    one text per operation across its spellings, and one value.
 *
 * `Rat` is not a prelude module, so every `Rat` fixture is a two-file project —
 * which is also the object-representation control for part 4.
 *
 * Every graph that executes here is byte-distinct: emitted modules mount as
 * `data:` URLs cached by their full text, so two tests compiling the same
 * program would share one module instance.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

const STDLIB = import.meta.glob("../../../stdlib/*.hex", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** `stdlib/Rat.hex`, the nominal home §14(t)'s and §14(u)'s `Rat` rows name. */
const RAT = (() => {
  const entry = Object.entries(STDLIB).find(([path]) => path.endsWith("/Rat.hex"));
  if (entry === undefined) throw new Error("no stdlib/Rat.hex");
  return entry[1];
})();

/** §14(t)'s and §14(u)'s fixtures, and Numeric Literals §5.1's. */
const fixtures = "let i: Int = 6\n" +
  "let j: Int = 4\n" +
  "let count: Int = 3\n" +
  "let a: Int = 6\n" +
  "let c: Int = 3\n" +
  "let b: BigInt = 9n\n" +
  "let big: BigInt = 9n\n" +
  "let f: Float = 1.5\n" +
  "let g: Float = 2.5\n" +
  "let price: Float = 1.5\n" +
  "let n: Nat = 7\n" +
  "let m: Nat = 2\n" +
  'let s: String = "a"\n' +
  'let t: String = "b"\n' +
  "let p: Bool = True\n" +
  "let q: Bool = False\n" +
  // An ordinary call, for the argument shape that is neither an operator nor a
  // member call and still lands an expectation.
  "fun same(value: Int): Int = value\n";

function verdict(source: string): readonly string[] {
  return projectDiagnostics(fixtures + source);
}

/** `/main.hex`'s emitted JavaScript, with the project asserted clean. */
function emitted(source: string): string {
  const project = compileFiles([["/main.hex", fixtures + source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text;
}

/** The one emitted line binding `probe`, which is what every text pin reads. */
function probeLine(source: string): string {
  const line = emitted(source).split("\n").find((text) => text.includes("const probe"));
  if (line === undefined) throw new Error("no `probe` binding in the emitted module");
  return line.trim();
}

function withRat(source: string): readonly (readonly [string, string])[] {
  return [
    ["/main.hex", `import Rat from "./Rat"\n${fixtures}${source}`],
    ["/Rat.hex", RAT],
  ];
}

function ratVerdict(source: string): readonly string[] {
  return compileFiles(withRat(source)).diagnostics.map(({ message }) => message);
}

function ratProbeLine(source: string): string {
  const project = compileFiles(withRat(source));
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const line = project.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text.split("\n").find((text) => text.includes("const probe"));
  if (line === undefined) throw new Error("no `probe` binding in the emitted module");
  return line.trim();
}

describe("§14(t): the five spellings of a tower member are one call", () => {
  test("`count.multiply(price)` is `Float`, as `count * price` is", () => {
    // The row this arc was filed over. Every spelling names one operation, and
    // the operation runs where its operands establish it — the receiver being
    // one operand among them, never the pin it used to be.
    expect(verdict("export let x: Float = count * price\n")).toEqual([]);
    expect(verdict("export let x: Float = Num.multiply(count, price)\n")).toEqual([]);
    expect(verdict("export let x: Float = count |> Num.multiply(price)\n")).toEqual([]);
    expect(verdict("export let x: Float = count.multiply(price)\n")).toEqual([]);
    expect(verdict("export let x: Float = price.multiply(count)\n")).toEqual([]);
  });

  test("a **companion**-qualified spelling is a written face: operands widen into it", () => {
    // `Float.multiply` accepts the `Int`, which widens in. `Int.multiply` is the
    // same kind of thing and refuses, because a `Float` cannot enter `Int` —
    // exactly as `let t: Int = count * price` does.
    expect(verdict("export let x: Float = Float.multiply(count, price)\n")).toEqual([]);
    expect(verdict("export let x: Int = Int.multiply(count, price)\n"))
      .toEqual(["type mismatch: expected Int, found Float"]);
  });

  test("the lift reaches every spelling, and the value is the point", async () => {
    // 2^53 - 1 plus 2 is not representable as a double: an `Int` addition folds
    // it and only then injects. Before #808 the operator spelling lifted and the
    // other three did not, so the silent overflow had three spellings to hide
    // in. All four now run at `BigInt`.
    const exports = await runProject([["/main.hex",
      "// the lift, spelled four ways\n" +
      "let large: Int = 9007199254740991\n" +
      "let two: Int = 2\n" +
      "export let operator: BigInt = large + two\n" +
      "export let bare: BigInt = Num.add(large, two)\n" +
      "export let piped: BigInt = large |> Num.add(two)\n" +
      "export let dotted: BigInt = large.add(two)\n",
    ]]);

    expect(exports["operator"]).toBe(9007199254740993n);
    expect(exports["bare"]).toBe(9007199254740993n);
    expect(exports["piped"]).toBe(9007199254740993n);
    expect(exports["dotted"]).toBe(9007199254740993n);
  });

  test("`Integral.div` lifts too, though no operator spells it", async () => {
    // §5.1 names `div`, `mod`, `quot`, `rem` and `gcd` in the lift explicitly: a
    // rung with no operator is still a rung, and the written face is still the
    // arithmetic's home. Before #808 `let q: BigInt = i.div(j)` divided at `Int`
    // and injected the quotient; the shape is the pin, and the run is here to
    // say the shape is a program.
    const exports = await runProject([["/main.hex",
      "// Integral under the lift\n" +
      "let large: Int = 9007199254740991\n" +
      "let two: Int = 2\n" +
      "export let qualified: BigInt = Integral.div(large, two)\n" +
      "export let dotted: BigInt = large.div(two)\n",
    ]]);

    expect(exports["qualified"]).toBe(4503599627370495n);
    expect(exports["dotted"]).toBe(4503599627370495n);
    expect(probeLine("export let probe: BigInt = Integral.div(i, j)\n"))
      .toBe("const probe = div(BigInt(i), BigInt(j));");
    expect(probeLine("export let probe: BigInt = i.div(j)\n"))
      .toBe("const probe = div(BigInt(i), BigInt(j));");
  });

  test("`let r: BigInt = i.add(j)` runs at `BigInt`, not at `Int` then injected", () => {
    // The text half of the pin above, for the reader who wants to see the shape:
    // two injected operands, never one injected sum.
    expect(probeLine("export let probe: BigInt = i.add(j)\n"))
      .toBe("const probe = BigInt(i) + BigInt(j);");
    expect(probeLine("export let probe: BigInt = Num.add(i, j)\n"))
      .toBe("const probe = BigInt(i) + BigInt(j);");
    expect(probeLine("export let probe: BigInt = i |> Num.add(j)\n"))
      .toBe("const probe = BigInt(i) + BigInt(j);");
    expect(probeLine("export let probe: BigInt = i + j\n"))
      .toBe("const probe = BigInt(i) + BigInt(j);");
  });

  test("a `Float` never enters `Rat`, in any spelling", () => {
    // Every spelling refuses, which is the row. **Where** the refusal fires
    // differs, and the difference is pinned rather than smoothed over: at the
    // operator, Numeric Literals §5.1's stand-down declines the face before the
    // operation runs, so the report is §6's — at the binding, naming the operand
    // that declined. At the member spellings the subject is bound to the face
    // before the operands elaborate, so `price` meets `Rat` at its own seat and
    // takes the plain mismatch there. Reaching §6's report from the member
    // spellings needs the bind delayed until the operands are in; it is not in
    // this change, and no program's verdict turns on it.
    expect(ratVerdict("export let total: Rat.Rat = count * price\n")).toEqual([
      "`price` is a `Float` and cannot enter `Rat`, so the multiplication ran " +
        "at `Float`",
    ]);
    for (const spelling of [
      "Num.multiply(count, price)",
      "count |> Num.multiply(price)",
      "count.multiply(price)",
      "price.multiply(count)",
      "Float.multiply(count, price)",
    ]) {
      expect(ratVerdict(`export let total: Rat.Rat = ${spelling}\n`))
        .toEqual(["type mismatch: expected Rat, found Float"]);
    }
  });

  test("a declared type variable dispatches the widened member too", () => {
    // §14(t)'s last row. One `Signed<a>` dictionary, the `Int` injected through
    // the binder's `fromInt` — the same elaboration `count * value` takes, which
    // is exactly what "the dot adds no shape of its own" means on a bound member.
    expect(verdict(
      "export fun scale<a: Signed>(count: Int, value: a): a = count.multiply(value)\n",
    )).toEqual([]);
    expect(verdict(
      "export fun scale<a: Signed>(count: Int, value: a): a = value.multiply(count)\n",
    )).toEqual([]);
    expect(verdict(
      "export fun scale<a: Signed>(count: Int, value: a): a = count * value\n",
    )).toEqual([]);
  });
});

describe("§14(v): the receiver seat, and §5.1's stand-down", () => {
  /**
   * Method Syntax §2.2's **receiver rule**. The receiver of a dot call is the
   * operation's first operand and takes what that operand seat expects. It
   * cannot ask the operation — it must elaborate before the call can resolve —
   * so it asks the **spelling**, and the spelling answers only *through its
   * rung*: the face travels when the name is a tower member's spelling and the
   * expected type is a concrete type honoring that spelling's rung.
   *
   * The rung is the whole soundness of the stand-in, and the two rows that
   * carry it are `rem` under a `Float` face (`Float` honors no `Integral`, so
   * nothing forwards and `Integral<Int>`'s guarded member dispatches, never
   * `Float.hex`'s exported `rem`) and `gcd` at a user companion under a `BigInt`
   * face (the face honors the rung, so it forwards — and Numeric Literals
   * §5.1's **stand-down** then declines it, because `Foo` can reach `BigInt` by
   * neither route).
   */
  const foo = "export record Foo = {n: Int}\n" +
    "\n" +
    "honor Num<Foo> =\n" +
    "    add(left, right) = Foo({n = left.n + right.n})\n" +
    "    multiply(left, right) = Foo({n = left.n * right.n})\n" +
    "    fromNat(value) = Foo({n = Int.fromNat(value)})\n" +
    "\n" +
    "export let gcd(left: Foo, right: Foo): BigInt = BigInt.fromInt(left.n)\n" +
    "\n" +
    "let p: Foo = Foo({n = 4})\n" +
    "let q: Foo = Foo({n = 6})\n" +
    "let s2: Foo = Foo({n = 8})\n";

  /** One standalone program's `probe` line, with the project asserted clean. */
  const line = (source: string): string => {
    const project = compileFiles([["/main.hex", source]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const found = project.modules.find(({ source: file }) => file.path === "/main.hex")!
      .javascript.text.split("\n").find((text) => text.includes("const probe"));
    if (found === undefined) throw new Error("no `probe` binding in the emitted module");
    return found.trim();
  };

  test("the dot chain lifts as the operator chain and the pipe do", async () => {
    const exports = await runProject([["/main.hex",
      "// the receiver seat\n" +
      "let x: Int = 9007199254740991\n" +
      "let y: Int = 2\n" +
      "let z: Int = 3\n" +
      "export let dotted: BigInt = x.add(y).multiply(z)\n" +
      "export let mixed: BigInt = (x + y).multiply(z)\n" +
      "export let operator: BigInt = (x + y) * z\n" +
      "export let piped: BigInt = x.add(y) |> Num.multiply(z)\n",
    ]]);

    // (2^53 - 1 + 2) * 3 exactly. An inner `Int` addition folds to 2^53 first
    // and yields …976n — the value this rule exists to remove.
    for (const name of ["dotted", "mixed", "operator", "piped"]) {
      expect(exports[name]).toBe(27021597764222979n);
    }
    expect(probeLine("let probe: BigInt = (a + j).multiply(c)\n"))
      .toBe("const probe = (BigInt(a) + BigInt(j)) * BigInt(c);");
  });

  test("at `**` the base lifts, and the dot then addresses the door", () => {
    // §14(v): the base seat lifts to `BigInt`, so the dot addresses `BigInt`'s
    // door (§6.1) and the exponent injects into the door's own `BigInt` seat.
    expect(probeLine("let probe: BigInt = (a + j).pow(c)\n"))
      .toContain("(BigInt(a) + BigInt(j), BigInt(c))");
  });

  test("the guard flips at a `Float` face, by design", async () => {
    // The one behaviour the rule changes on purpose: the base lifts to `Float`,
    // the dot addresses `Float`'s door, and a negative exponent is an ordinary
    // reciprocal power where `Pow<Int>`'s guard used to throw — the dot
    // converging on `let x: Float = 2 ** negOne`.
    const exports = await runProject([["/main.hex",
      "// the guard flip\n" +
      "let i: Int = 1\n" +
      "let j: Int = 1\n" +
      "let negOne: Int = -1\n" +
      "export let dotted: Float = (i + j).pow(negOne)\n" +
      "export let operator: Float = 2 ** negOne\n",
    ]]);

    expect(exports["dotted"]).toBe(0.5);
    expect(exports["operator"]).toBe(0.5);
  });

  test("a face that honors no `Integral` forwards nothing", async () => {
    // The gate, and the row that shows why it is the **rung** and not the
    // spelling: `Float.hex` exports a `rem` — it may, precisely because `Float`
    // honors no `Integral` — and a spelling-only gate re-dispatched this call to
    // it. Pinned by dispatch rather than by text, because `Int` → `Float`
    // erases: `Integral<Int>`'s `rem` throws on a zero divisor where
    // `Float.hex`'s answers `NaN`.
    const exports = await runProject([["/main.hex",
      "// the rung gate\n" +
      "let i: Int = 7\n" +
      "let j: Int = 1\n" +
      "let k: Int = 3\n" +
      "let zero: Int = 0\n" +
      "export let value: Float = (i + j).rem(k)\n" +
      "export let guarded(): Float = (i + j).rem(zero)\n" +
      "export let qualified(): Float = Integral.rem(i + j, zero)\n",
    ]]);

    expect(exports["value"]).toBe(2);
    for (const name of ["guarded", "qualified"]) {
      const run = exports[name] as () => unknown;
      expect(() => run()).toThrow(/divisor is zero/u);
    }
  });

  test("the lift stands down where an operand cannot reach the face", () => {
    // §5.1's stand-down, and its one **non-refusing** case: the forwarded face
    // is not the consuming seat's own type, so the receiver simply keeps its
    // type. `BigInt` honors `Integral`, so `gcd` forwards it — and `Foo` reaches
    // `BigInt` by neither route, so `p.add(q)` runs at `Foo` and the companion's
    // exported `gcd` answers, exactly as it did before the rule.
    expect(line(`${foo}let probe: BigInt = p.add(q).gcd(s2)\n`))
      .toBe("const probe = gcd(__Num_Foo_add(p, q), s2);");
  });

  test("a flexible receiver keeps the pending goal and the fallback", () => {
    // An expectation is not an annotation: it lands on nothing, the receiver
    // stays unsolved, and §3.5's row fallback fires as before.
    expect(verdict("fun scaled(v): BigInt = v.multiply(2)\n")).toEqual([]);
    expect(emitted("fun scaled(v): BigInt = v.multiply(2)\n"))
      .toContain("v.multiply");
  });

  test("the same chain at a nominal home runs entirely there", () => {
    // The multi-module control: both operations run at `Rat` over injected
    // operands, in every spelling.
    expect(ratProbeLine("let probe: Rat.Rat = a.add(j).multiply(c)\n"))
      .toBe(
        "const probe = multiply(add(__Signed_Rat.fromInt(a), " +
          "__Signed_Rat.fromInt(j)), __Signed_Rat.fromInt(c));",
      );
    expect(ratProbeLine("let probe: Rat.Rat = (a + j) * c\n"))
      .toBe(
        "const probe = __Num_Rat.multiply(__Num_Rat.add(__Signed_Rat.fromInt(a), " +
          "__Signed_Rat.fromInt(j)), __Signed_Rat.fromInt(c));",
      );
  });

  test("the stand-down's refusal names the operand and the algebra", () => {
    // Numeric Literals §6. The lift stands down because `price` can reach `Rat`
    // by neither route, so the multiplication runs at `Float` and the mismatch
    // surfaces where the *result* meets its seat — at the binding, not at
    // `price`. The note is what keeps the report saying what the lift's own
    // refusal said.
    expect(ratVerdict("export let total: Rat.Rat = count * price\n")).toEqual([
      "`price` is a `Float` and cannot enter `Rat`, so the multiplication ran " +
        "at `Float`",
    ]);
  });
});

describe("the dot's seats are the bare call's, with the receiver in seat 1", () => {
  /**
   * Method Syntax §2.2's schedule, whole: the member's signature supplies every
   * **non-subject** seat pointwise — "a function-typed parameter that lands a
   * lambda" — while the **subject** seats are established from the operands
   * together. Those two are one mechanism, not two: Functions §4.3's own two
   * passes over the seat list, the non-lambda operands first (establishing the
   * shared subject, with §5.1's widening deciding it) and the lambda literals
   * after, reading a subject that is by then resolved.
   *
   * The dot takes that schedule with the receiver in seat 1. Anything less
   * fails one way or the other: settling the subject from the receiver alone
   * re-pins the algebra and the receiver stops widening; not establishing it at
   * all leaves a callback whose own seat is written in terms of the subject with
   * nothing to read. Each row here is pinned **against its bare spelling**,
   * which is the standard §1 sets.
   */
  const bag = "export record Bag = {items: Vector(Int)}\n" +
    "\n" +
    "export constraint OnSelf<a> =\n" +
    "    onSelf(subject: a, cb: (a) -> String): String\n" +
    "\n" +
    "honor OnSelf<Bag> =\n" +
    "    onSelf(subject, cb) = cb(subject)\n" +
    "\n" +
    "let bag: Bag = Bag({items = [1]})\n";

  // Honored at both widths, so the *name* resolves at either receiver and the
  // subject is left to the operands — which is the only way a user constraint
  // can show the mixed-width case. (A constraint honored only at `BigInt` is
  // not reachable through an `Int` receiver at all: §3.4 resolves the name from
  // the receiver's own honored set, and no ownership clause reaches outside the
  // tower.)
  const scale = "let i: Int = 6\n" +
    "let big: BigInt = 9n\n" +
    "\n" +
    "export constraint Scale<a: Num> =\n" +
    "    scale(subject: a, by: a, f: (a) -> a): a\n" +
    "\n" +
    "honor Scale<BigInt> =\n" +
    "    scale(subject, by, f) = f(Num.multiply(subject, by))\n" +
    "\n" +
    "honor Scale<Int> =\n" +
    "    scale(subject, by, f) = f(Num.multiply(subject, by))\n";

  /** One standalone program's `probe` line, with the project asserted clean. */
  const line = (source: string): string => {
    const project = compileFiles([["/main.hex", source]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const found = project.modules.find(({ source: file }) => file.path === "/main.hex")!
      .javascript.text.split("\n").find((text) => text.includes("const probe"));
    if (found === undefined) throw new Error("no `probe` binding in the emitted module");
    return found.trim();
  };

  test("a lambda argument reads a subject the receiver established", () => {
    // `cb`'s seat is `(a) -> String`, written in terms of the subject. The
    // receiver is the only operand that can establish it, and it must have done
    // so before the lambda elaborates — or the lambda's parameter is a variable
    // and `v.items` has nothing to project.
    const dotted = line(
      `${bag}let probe = bag.onSelf(v => Show.show(Vector.length(v.items)))\n`,
    );

    expect(dotted).toBe(line(
      `${bag}let probe = onSelf(bag, v => Show.show(Vector.length(v.items)))\n`,
    ));
    expect(dotted).toContain("v => show(length(v.items))");
  });

  test("a `match` argument lands the same way", () => {
    // Pattern Matching §6.1's refusal is what a match function takes when its
    // scrutinee type is still a variable, so this row fails loudly rather than
    // quietly when the subject is not established in time.
    const arms = "(match\n    _ => \"other\")\n";
    expect(line(`${bag}let probe = bag.onSelf${arms}`))
      .toBe(line(`${bag}let probe = onSelf(bag, match\n    _ => "other")\n`));
  });

  test("the widest operand wins the subject, and the lambda lands there", () => {
    // The mixed-width row: the receiver is an `Int`, the sibling operand a
    // `BigInt`. §5.1's widening decides the subject from the operands together,
    // so the subject is `BigInt`, the receiver widens into it, the callback's
    // seat is `(BigInt) -> BigInt`, and coherence selects `Scale<BigInt>` —
    // every part of it identical to the bare spelling's.
    const dotted = line(`${scale}let probe = i.scale(big, x => x)\n`);

    expect(dotted).toBe(line(`${scale}let probe = scale(i, big, x => x)\n`));
    expect(dotted).toBe("const probe = __Scale_BigInt_scale(BigInt(i), big, x => x);");
    // The same-width control, so the row above is read as widening rather than
    // as a constant answer.
    expect(line(`${scale}let probe = i.scale(i, x => x)\n`))
      .toBe("const probe = __Scale_Int_scale(i, i, x => x);");
  });
});

describe("an argument that lands an expectation does not re-pin the subject", () => {
  /**
   * §2.2's sentence, at the one seat that could quietly undo it: the dot's
   * argument pass runs a **subject-first early unification** when an argument
   * lands an expectation, so that `xs.map(match …)` reads its element type
   * before the arms are checked. At a **companion** operation that is sound —
   * the subject seat is written, and the receiver's head is what dispatch
   * matched. At a **constraint member** it is not: the seat is the subject, and
   * settling it from the receiver alone is exactly the pre-#808 pin §16.3
   * removed — the receiver stops being one operand among the others and can no
   * longer widen.
   *
   * The rows below are the ones that reach that seat: an operand-shaped
   * argument (a `Binary`, which has always landed an expectation) and a
   * member-call-shaped one (a `Call`, which lands one since #808). Each is
   * pinned **against its qualified spelling**, which is the claim — one call,
   * one elaboration, whichever spelling the reader met.
   */
  const alsoQualified = (dotted: string, qualified: string, emitted: string): void => {
    expect(verdict(`${dotted}\n`)).toEqual([]);
    expect(verdict(`${qualified}\n`)).toEqual([]);
    expect(probeLine(`${dotted}\n`)).toBe(emitted);
    expect(probeLine(`${qualified}\n`)).toBe(emitted);
  };

  test("an operator-shaped argument under a written face", () => {
    alsoQualified(
      "let probe: BigInt = c.multiply(a + j)",
      "let probe: BigInt = Num.multiply(c, a + j)",
      "const probe = BigInt(c) * (BigInt(a) + BigInt(j));",
    );
  });

  test("a dot-call argument under a written face", () => {
    alsoQualified(
      "let probe: BigInt = c.multiply(a.add(j))",
      "let probe: BigInt = Num.multiply(c, Num.add(a, j))",
      "const probe = BigInt(c) * (BigInt(a) + BigInt(j));",
    );
  });

  test("a dot-call argument in the receiver's own algebra", () => {
    alsoQualified(
      "let probe: BigInt = i.add(j.multiply(c))",
      "let probe: BigInt = Num.add(i, Num.multiply(j, c))",
      "const probe = BigInt(i) + BigInt(j) * BigInt(c);",
    );
  });

  test("a wider argument with no face at all: the operand still establishes it", () => {
    // The row where the re-pinning was not merely a refusal: the subject was
    // settled at `Int`, the `BigInt` product reported twice against it, and the
    // module still emitted `i + b * e` — an `Int` addition of two `BigInt`s.
    alsoQualified(
      "let probe = i.add(b.multiply(big))",
      "let probe = Num.add(i, Num.multiply(b, big))",
      "const probe = BigInt(i) + b * big;",
    );
  });

  test("an ordinary call argument reaches the seat too", () => {
    alsoQualified(
      "let probe: BigInt = i.add(same(j))",
      "let probe: BigInt = Num.add(i, same(j))",
      "const probe = BigInt(i) + BigInt(same(j));",
    );
  });

  test("a companion operation still reads its element type early", () => {
    // The other half of the seat, unchanged: `map`'s subject is written, so the
    // early unification stands there and the callback reads `Int` off the
    // receiver rather than a variable.
    expect(verdict(
      "let xs: Seq(Int) = Iterable.toSeq([1, 2])\n" +
      "export let probe: Seq(Int) = xs.map(match\n" +
      "    0 => 1\n" +
      "    other => other)\n",
    )).toEqual([]);
  });
});

describe("members widen by their operands (§3.4, §6.1)", () => {
  test("`i.add(b)` and `b.add(i)` are both `BigInt`", () => {
    expect(probeLine("let probe = i.add(b)\n"))
      .toBe("const probe = BigInt(i) + b;");
    expect(probeLine("let probe = b.add(i)\n"))
      .toBe("const probe = b + BigInt(i);");
    // The operator spelling, unchanged, for the comparison the rule is about.
    expect(probeLine("let probe = i + b\n"))
      .toBe("const probe = BigInt(i) + b;");
  });

  test("`Eq` and `Ord` are not rungs, and widen by the seat's ordinary injection", () => {
    // §5.1: a comparison across widths widens because the member's seats are
    // widening targets like any seat, not through the lift. `Ord.compare(i, b)`
    // always did; the dot refused, and that was the row the amendment calls
    // wrong wherever another operand establishes a wider subject.
    expect(probeLine("let probe = i.compare(b)\n"))
      .toBe("const probe = compare(BigInt(i), b);");
    expect(probeLine("let probe = Ord.compare(i, b)\n"))
      .toBe("const probe = compare(BigInt(i), b);");
    expect(probeLine("let probe = i.equals(b)\n"))
      .toBe("const probe = BigInt(i) === b;");
  });

  test("a nominal receiver widens an `Int` argument into its own algebra", () => {
    // `Rat` honors `Signed`, so the `Int` reaches it by `fromInt` — the same
    // injection the qualified spelling performs, and the emission the clause
    // leaves alone.
    expect(ratProbeLine("let r: Rat.Rat = Rat.fromInt(3)\nlet probe = r.add(i)\n"))
      .toBe("const probe = add(r, __Signed_Rat.fromInt(i));");
    expect(ratProbeLine(
      "let r: Rat.Rat = Rat.fromInt(3)\nlet probe = r.compare(i)\n",
    )).toBe("const probe = compare(r, __Signed_Rat.fromInt(i));");
  });

  test("the subject is moment-free: a goal that settles late widens the same", () => {
    // §11.3's note. The receiver's head is unknown at the dot here, so the goal
    // pends and settles at the region's deadline — and the instance is still
    // coherence's choice at the subject the operands establish, `BigInt` because
    // `b` is one of them.
    expect(verdict(
      "fun late(x): BigInt =\n" +
      "    let sum = x.add(b)\n" +
      "    let ignored: Int = x\n" +
      "    sum\n",
    )).toEqual([]);
  });
});

describe("doors are addressed by the receiver (§6.1, #783)", () => {
  test("`b.pow(i)` reaches the `BigInt` door with the `Int` injected", () => {
    // #783's first half, and the door's own reading: `x.pow(y)` at `BigInt` is
    // the widest face, and its argument seats widen *into* it by §5.1's ordinary
    // seat widening — which is what `BigInt.pow(b, i)` always did.
    expect(verdict("let probe = b.pow(i)\n")).toEqual([]);
    // The call, argument for argument — which is what §6.1 fixes, and it is the
    // same shape either way. The two spellings still reach the door through
    // different import channels and so bind it under different *local* names
    // (`pow` for the qualified spelling, a `__prelude_`-prefixed alias for the
    // dot): #585's channel, filed as **#816**, and not this ruling's. It is why
    // `stdlib/Rat.hex` keeps the qualified spelling for now — the dot's emission
    // is not yet the doctrine's — so this seat is pinned on a fixture, where the
    // claim is about the seat and nothing else.
    expect(probeLine("let probe = b.pow(i)\n")).toContain("(b, BigInt(i))");
    expect(probeLine("let probe = BigInt.pow(b, i)\n")).toBe("const probe = pow(b, BigInt(i));");
    expect(verdict("let probe = f.pow(i)\n")).toEqual([]);
    expect(probeLine("let probe = f.pow(i)\n")).toContain("(f, i)");
  });

  test("the same widening at a plain companion export with a wider written seat", async () => {
    // #783's **second** half, which is not about doors at all: §3.4's rewrite
    // always required the rewritten call to widen as the qualified one does.
    const exports = await runProject([
      ["/main.hex",
        'import Box from "./box"\n' +
        "let boxed: Box.Box = Box.Box({size = 1n})\n" +
        "let step: Int = 2\n" +
        "export let dotted: BigInt = Box.size(boxed.bump(step))\n" +
        "export let qualified: BigInt = Box.size(Box.bump(boxed, step))\n",
      ],
      ["/box.hex",
        "export record Box = {size: BigInt}\n" +
        "\n" +
        "export let bump(box: Box, k: BigInt): Box = Box({size = box.size + k})\n" +
        "\n" +
        "export let size(box: Box): BigInt = box.size\n",
      ],
    ]);

    expect(exports["dotted"]).toBe(3n);
    expect(exports["qualified"]).toBe(3n);
  });
});

describe("§9 row 14: the exponent seat's fixit, in every spelling", () => {
  const fixit = "the exponent of `**` is an `Int`; for a `BigInt` exponent, use " +
    "`BigInt.pow(value, exponent)`";

  test("`i ** 2n`, `Pow.pow(i, 2n)` and `i.pow(2n)` all name the door", () => {
    // Operators §6.3's mandatory fixit, branched on the exponent's type. The
    // member's written `Int` seat cannot widen a `BigInt`, and before #808 two
    // of these three spellings said only "type mismatch".
    expect(verdict("let probe = i ** 2n\n")).toEqual([fixit]);
    expect(verdict("let probe = Pow.pow(i, 2n)\n")).toEqual([fixit]);
    expect(verdict("let probe = i.pow(2n)\n")).toEqual([fixit]);
  });

  test("a `Float` exponent names `Float.pow` on the same terms", () => {
    const fractional = "the exponent of `**` is an `Int`; for a fractional exponent at " +
      "`Float`, use `Float.pow(value, exponent)`";
    expect(verdict("let probe = i ** 0.5\n")).toEqual([fractional]);
    expect(verdict("let probe = i.pow(0.5)\n")).toEqual([fractional]);
  });

  test("the span is the argument, never the whole call", () => {
    // #783's second finding. A report against the whole dot call points the
    // reader at the receiver, which is not the seat that refused.
    const source = `${fixtures}let probe = i.pow(2n)\n`;
    const project = compileFiles([["/main.hex", source]]);
    const reported = project.diagnostics[0]!;
    expect(source.slice(
      reported.primary.start.offset,
      reported.primary.end.offset,
    )).toBe("2n");
  });

  test("a `Nat` exponent widens into the seat rather than reporting", () => {
    // The seat is an ordinary written-`Int` one, so §5.1 applies into it.
    expect(verdict("let probe = i.pow(m)\n")).toEqual([]);
  });
});

describe("§4.2's ownership clause and §9 row 15's rider", () => {
  const noSigned = "type `Nat` has no `Signed` instance; its only legal homes are the " +
    "module declaring `Signed` and `Nat`'s prelude companion module, both outside " +
    "project source, so this pair's honored set is closed — change the type, or go " +
    "through the operations those homes export; a written `Int` face runs the " +
    "operation and admits the result (`let difference: Int = …`)";
  const noFrac = "type `Int` has no `Frac` instance; its only legal homes are the module " +
    "declaring `Frac` and `Int`'s prelude companion module, both outside project " +
    "source, so this pair's honored set is closed — change the type, or go through " +
    "the operations those homes export; for the integer quotient and remainder use " +
    "`Int.div` and `Int.mod`, and for real division write a `Float` face " +
    "(`let quotient: Float = …`), which runs the division there";

  test("`let d: Int = n.subtract(m)` runs at `Int` with both `Nat`s injected", async () => {
    // The clause's reason: `Nat` cannot honor `Signed`, so without ownership a
    // lifted `n.subtract(m)` would have no dot spelling at all. The value is the
    // pin — a difference that leaves `Nat`.
    const exports = await runProject([["/main.hex",
      "// ownership at Nat\n" +
      "let small: Nat = 2\n" +
      "let large: Nat = 7\n" +
      "export let dotted: Int = small.subtract(large)\n" +
      "export let operator: Int = small - large\n",
    ]]);

    expect(exports["dotted"]).toBe(-5);
    expect(exports["operator"]).toBe(-5);
  });

  test("without a face the owned member refuses exactly as the operator does", () => {
    // §9 row 15: *exactly* the operator's refusal, rider and all — one message
    // for two spellings of one operation.
    expect(verdict("let probe = n.subtract(m)\n")).toEqual([noSigned]);
    expect(verdict("let probe = n - m\n")).toEqual([noSigned]);
    expect(verdict("let probe = n.negate()\n")).toEqual([noSigned]);
    expect(verdict("let probe = -n\n")).toEqual([noSigned]);
  });

  test("`Int` owns `divide`, and takes `/`'s refusal with `Int.div`'s fixit", () => {
    expect(verdict("let probe = i.divide(j)\n")).toEqual([noFrac]);
    expect(verdict("let probe = i / j\n")).toEqual([noFrac]);
    expect(verdict("export let probe: Float = i.divide(j)\n")).toEqual([]);
    expect(probeLine("export let probe: Float = i.divide(j)\n"))
      .toBe("const probe = i / j;");
  });

  test("the named division family the rider offers is the receiver's own", () => {
    // `Nat` owns `divide` too, and its rider must name `Nat`'s family: `Nat.div`
    // answers in `Nat`, where `Int.div` would leave the type the reader is in.
    // Both exist — `Integral` is honored at both — and the pin is the offer
    // beside the proof that it compiles.
    expect(verdict("let probe = n.divide(m)\n")).toEqual([
      "type `Nat` has no `Frac` instance; its only legal homes are the module " +
        "declaring `Frac` and `Nat`'s prelude companion module, both outside project " +
        "source, so this pair's honored set is closed — change the type, or go " +
        "through the operations those homes export; for the integer quotient and " +
        "remainder use `Nat.div` and `Nat.mod`, and for real division write a " +
        "`Float` face (`let quotient: Float = …`), which runs the division there",
    ]);
    expect(verdict("export let probe: Nat = Nat.div(n, m)\n")).toEqual([]);
    expect(verdict("export let probe: Nat = Nat.mod(n, m)\n")).toEqual([]);
    expect(verdict("export let probe: Float = n.divide(m)\n")).toEqual([]);
  });

  test("the owned set is disjoint from the honored one — no two-claimant refusal", () => {
    // The clause adds a claimant only where the honored set has none, so every
    // dot that resolved before resolves to the same member now.
    expect(verdict("let probe = n.rem(2)\n")).toEqual([]);
    expect(verdict("let probe = i.div(j)\n")).toEqual([]);
    expect(verdict("let probe = 7.div(2)\n")).toEqual([]);
    expect(verdict("let probe = i.subtract(j)\n")).toEqual([]);
    expect(probeLine("let probe = n.rem(2)\n")).toBe("const probe = rem(n, 2);");
    expect(probeLine("let probe = 7.div(2)\n")).toBe("const probe = div(7, 2);");
  });

  test("no other type owns an unhonored member", () => {
    // The clause names `Nat` and `Int` and nothing else: a `Float` has no
    // `Integral`, and no ownership route invents one.
    expect(verdict("let probe = f.div(g)\n")).toEqual([
      "`Float` has no field `div`, its companion exports no operation `div`, and no " +
        "constraint honored at `Float` has a subject-first member `div`; call an " +
        "available subject-first function explicitly",
    ]);
  });
});

describe("§14(u): the operator's lowering, verbatim, in every spelling", () => {
  test("`Eq` at a primitive representation", () => {
    expect(probeLine("let probe = i.equals(j)\n")).toBe("const probe = i === j;");
    expect(probeLine("let probe = i == j\n")).toBe("const probe = i === j;");
    // Verbatim means the lowering `!=` has, not a `!==` this rule would invent.
    expect(probeLine("let probe = i.notEquals(j)\n"))
      .toBe("const probe = !(i === j);");
    expect(probeLine("let probe = i != j\n")).toBe("const probe = !(i === j);");
    // `Float` equality is SameValueZero through a helper, and the dot copies the
    // helper too.
    expect(probeLine("let probe = f.equals(g)\n"))
      .toBe(probeLine("let probe = f == g\n"));
    expect(probeLine("let probe = f.equals(g)\n"))
      .toContain("floatEquals(f, g)");
    // `Bool` belongs by its `boolean` pin, and the structural dictionary read it
    // used to take is displaced with the rest.
    expect(probeLine("let probe = p.equals(q)\n")).toBe("const probe = p === q;");
    expect(probeLine("let probe = p == q\n")).toBe("const probe = p === q;");
  });

  test("`Num`, `Signed`, `Frac` and `Concat` at a primitive representation", () => {
    expect(probeLine("let probe = i.add(j)\n")).toBe("const probe = i + j;");
    expect(probeLine("let probe = Num.add(i, j)\n")).toBe("const probe = i + j;");
    expect(probeLine("let probe = Int.add(i, j)\n")).toBe("const probe = i + j;");
    expect(probeLine("let probe = i |> Num.add(j)\n")).toBe("const probe = i + j;");
    expect(probeLine("let probe = i + j\n")).toBe("const probe = i + j;");
    expect(probeLine("let probe = i.subtract(j)\n")).toBe("const probe = i - j;");
    expect(probeLine("let probe = i.negate()\n")).toBe("const probe = -i;");
    expect(probeLine("let probe = i.multiply(f)\n")).toBe("const probe = i * f;");
    expect(probeLine("let probe = Float.multiply(i, f)\n"))
      .toBe("const probe = i * f;");
    expect(probeLine("let probe = f.divide(g)\n")).toBe("const probe = f / g;");
    expect(probeLine("let probe = s.concat(t)\n")).toBe("const probe = s + t;");
    expect(probeLine("let probe = s ++ t\n")).toBe("const probe = s + t;");
  });

  test("`pow` inlines only where `**` does — at `Float`, and nowhere else", () => {
    // The criterion is the operator spelling's lowering. `**` at `Float` is the
    // raw operator; at `Nat`, `Int` and `BigInt` it is a call to a guarded
    // member, so there is no operator lowering for the other spellings to copy.
    expect(probeLine("let probe = Pow.pow(f, i)\n")).toBe("const probe = f ** i;");
    expect(probeLine("let probe = f ** i\n")).toBe("const probe = f ** i;");
    expect(probeLine("let probe = i.pow(j)\n")).toBe("const probe = pow(i, j);");
    expect(probeLine("let probe = Pow.pow(i, j)\n")).toBe("const probe = pow(i, j);");
    // The door is a written face with a `Float` exponent seat, and no operator
    // spells it: `f ** g` refuses. It stays the door's own call.
    expect(verdict("let probe = f ** g\n").length).toBeGreaterThan(0);
    expect(probeLine("let probe = f.pow(g)\n")).toContain("pow(f, g)");
  });

  test("`compare` stays a call: no JavaScript operator carries an `Ordering`", () => {
    expect(probeLine("let probe = i.compare(j)\n"))
      .toBe("const probe = compare(i, j);");
    expect(probeLine("let probe = Ord.compare(i, j)\n"))
      .toBe("const probe = compare(i, j);");
  });

  test("`Integral` stays a call in every spelling", () => {
    expect(probeLine("let probe = i.mod(j)\n")).toBe("const probe = mod(i, j);");
    expect(probeLine("let probe = Integral.mod(i, j)\n"))
      .toBe("const probe = mod(i, j);");
  });

  test("an object representation is untouched by the rule", () => {
    // `Rat` is a record; `+` and `===` mean the wrong thing on it, so the same
    // test answers "a call" — which is what the member spellings already emit.
    expect(ratProbeLine("let r: Rat.Rat = Rat.fromInt(3)\nlet probe = r.add(r)\n"))
      .toBe("const probe = add(r, r);");
    expect(ratProbeLine(
      "let r: Rat.Rat = Rat.fromInt(3)\nlet probe = r.equals(r)\n",
    )).toBe("const probe = equals(r, r);");
  });

  test("a genuinely polymorphic call keeps its evidence route", () => {
    // The rule reads the *selected instance*. Inside a dictionary-taking
    // function there is none to read, and the forwarder is the whole answer.
    const text = emitted(
      "export fun alike<a: Eq>(x: a, y: a): Bool = x.equals(y)\n" +
      "export fun sum<a: Num>(x: a, y: a): a = x.add(y)\n",
    );
    expect(text).toContain("equals(x, y");
    expect(text).toContain("add(x, y");
  });

  test("one text per operation across its spellings, and one value", async () => {
    // The check §8.1 asks for, run as a check rather than asserted.
    const exports = await runProject([["/main.hex",
      "// one operation, five spellings\n" +
      "let left: Int = 6\n" +
      "let right: Int = 4\n" +
      "export let operator: Int = left + right\n" +
      "export let bare: Int = Num.add(left, right)\n" +
      "export let qualified: Int = Int.add(left, right)\n" +
      "export let piped: Int = left |> Num.add(right)\n" +
      "export let dotted: Int = left.add(right)\n",
    ]]);

    expect(Object.values(exports).filter((value) => value === 10)).toHaveLength(5);
  });
});

describe("the negative probes: what #808 does not change", () => {
  test("a member name still never nominates a type", () => {
    // §1's guardrail. An unknown receiver takes the row fallback, exactly as it
    // did before members could widen at all.
    expect(verdict("let nominates = (x) => x.add(1)\n")).toEqual([]);
    // The row fallback, byte for byte what it was: a POJO read and a call, with
    // the literal's own `Num` evidence riding the lambda's suffix.
    expect(emitted("let nominates = (x) => x.add(1)\n"))
      .toContain("(x.add)(__Num_a.fromNat(1))");
  });

  test("`x.pow(2n)` at `BigInt` is still the door, not the member", () => {
    expect(verdict("let probe = b.pow(2n)\n")).toEqual([]);
  });

  test("a written face that cannot hold the operands still refuses", () => {
    expect(verdict("export let probe: Int = i.multiply(f)\n"))
      .toEqual(["type mismatch: expected Int, found Float"]);
  });
});
