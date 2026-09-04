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
    ["/main.hex", "module Main\n\n" + `import Rat\n${fixtures}${source}`],
    ["/Rat.hex", "module Rat\n\n" + RAT],
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
      "module Main\n\n" + "// the lift, spelled four ways\n" +
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
      "module Main\n\n" + "// Integral under the lift\n" +
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
    // Every spelling refuses, which is the row — and since #821's **delayed
    // bind** every spelling of the open call refuses in the same words. The
    // subject is established after the operands are in, so the stand-down is
    // decided over all of them and Numeric Literals §6's note is taken at the
    // member spellings too: `price` meets no `Rat` seat of its own, and the
    // report fires at the binding, naming the operand that declined. (Before it,
    // the four open spellings bound the subject to the face first and took a
    // plain mismatch at `price`'s seat — #819's first bullet.)
    const report = "`price` is a `Float` and cannot enter `Rat`, so the " +
      "multiplication ran at `Float`";
    for (const spelling of [
      "count * price",
      "Num.multiply(count, price)",
      "count |> Num.multiply(price)",
      "count.multiply(price)",
      "price.multiply(count)",
    ]) {
      expect(ratVerdict(`export let total: Rat.Rat = ${spelling}\n`))
        .toEqual([report]);
    }
    // The **companion-qualified** spelling is a written face rather than a
    // further spelling of the open call (§5.1, Method Syntax §1): the operands
    // widen *into* it and it lifts nothing, so there is no stand-down to
    // report and the mismatch is the plain one.
    expect(ratVerdict("export let total: Rat.Rat = Float.multiply(count, price)\n"))
      .toEqual(["type mismatch: expected Rat, found Float"]);
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
   * The rung is the whole soundness of the stand-in, and the row that carries it
   * is `rem` under a `Float` face: `Float` honors no `Integral`, so nothing
   * forwards and `Integral<Int>`'s guarded member dispatches, never
   * `Float.hex`'s exported `rem`.
   *
   * *(#821.)* Where the face **does** travel it is **binding**, as at any
   * operand seat. The receiver stand-down that first shipped with the rule — a
   * receiver whose operands could not reach the face keeping its own type and
   * dispatching there — is retracted: it tested the receiver operand alone, so
   * `p.add(q).gcd(s)` compiled while `i.add(p).gcd(s)` refused twice, one
   * operation with two verdicts. Now the subject is established after **every**
   * operand is in, the lift stands down over all of them, and a stood-down
   * receiver is refused at the dot with §9 row 16's one report of three facts.
   */
  const foo = "export record Foo = {n: Int}\n" +
    "\n" +
    "honor Num<Foo> =\n" +
    "    add(left, right) = Foo({n = left.n + right.n})\n" +
    "    multiply(left, right) = Foo({n = left.n * right.n})\n" +
    "    fromNat(value) = Foo({n = Int.fromNat(value)})\n" +
    "\n" +
    // `Signed<Foo>` is what lets an `Int` operand enter `Foo` (§5.1's second
    // conversion), which is the whole of the mixed-operand matrix below: without
    // it `i.add(p)` would refuse for want of an algebra rather than for the face.
    "honor Signed<Foo> =\n" +
    "    subtract(left, right) = Foo({n = left.n - right.n})\n" +
    "    negate(value) = Foo({n = -value.n})\n" +
    "    fromInt(value) = Foo({n = value})\n" +
    "\n" +
    "export let gcd(left: Foo, right: Foo): BigInt = BigInt.fromInt(left.n)\n" +
    "export let mk(): Foo = Foo({n = 1})\n" +
    "\n" +
    "let i: Int = 2\n" +
    "let j: Int = 3\n" +
    "let c: Bool = True\n" +
    "let b9: BigInt = 9n\n" +
    "let ff: Float = 1.5\n" +
    "let gg: Float = 2.5\n" +
    "let p: Foo = Foo({n = 4})\n" +
    "let q: Foo = Foo({n = 6})\n" +
    "let s2: Foo = Foo({n = 8})\n";

  /**
   * The same fixture as a **companion module**, which is what makes the
   * companion-qualified spelling `Foo.add(p, q)` reachable at all — and what
   * makes the type's spelling at the use site `Foo.Foo`.
   */
  const fooModule = foo.slice(0, foo.indexOf("let i: Int"));
  const fooMain = 'import Foo\n' +
    "let p: Foo.Foo = Foo.mk()\n" +
    "let q: Foo.Foo = Foo.mk()\n" +
    "let s2: Foo.Foo = Foo.mk()\n";

  /** One standalone program's diagnostics, in production order. */
  const refusals = (source: string): readonly string[] =>
    compileFiles([["/main.hex", "module Main\n\n" + source]]).diagnostics.map(({ message }) => message);

  /**
   * §9 row 16's report, assembled from its three facts so a pin states them
   * rather than quoting a sentence nobody reads.
   */
  const rowSixteen = (parts: {
    /** The receiver as the site spells it, or `""` where it has no spelling. */
    readonly receiver: string;
    /** The declining operand clause, in §6's words. */
    readonly declined: string;
    /** The stood-down call, which the offered ascription names. */
    readonly ascribe: string;
    /** The type it kept, and that type's spelling at the site. */
    readonly kept: string;
    readonly written?: string;
  }): string =>
    "`gcd` is a member of `Integral` and `BigInt` honors `Integral`, so the " +
    `\`BigInt\` here reached the receiver${
      parts.receiver === "" ? "" : ` \`${parts.receiver}\``
    }; ${parts.declined} cannot enter \`BigInt\`, so the addition could not run ` +
    `at \`BigInt\`. To keep \`${parts.ascribe}\` at \`${parts.kept}\`, ascribe ` +
    `it — \`(${parts.ascribe}: ${parts.written ?? parts.kept})\` — or bind it first`;

  /**
   * The **face descent's** report: the operation's or the form's own mismatch,
   * with §2.2's boundary repair on it where the ascription compiles.
   *
   * The repair names no binding. What is ascribed here is a whole operation or
   * a whole forwarding form, whose join *without* the face is its own question:
   * measured, `let t = if c then i + j else p` joins at `Foo` and repairs, while
   * the `match` of the same two paths refuses on its own, the arm join carrying
   * no widening. §9 row 16's own repair does name one — it ascribes the
   * stood-down call, whose type is the kept type by construction.
   */
  const descended = (
    ascribed: string,
    mismatch = "expected BigInt, found Foo",
    kept = "Foo",
  ): string =>
    `type mismatch: ${mismatch}. To keep \`${ascribed}\` at \`${kept}\`, ` +
    `ascribe it — \`(${ascribed}: ${kept})\``;

  /** One standalone program's `probe` line, with the project asserted clean. */
  const line = (source: string): string => {
    const project = compileFiles([["/main.hex", "module Main\n\n" + source]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const found = project.modules.find(({ source: file }) => file.path === "/main.hex")!
      .javascript.text.split("\n").find((text) => text.includes("const probe"));
    if (found === undefined) throw new Error("no `probe` binding in the emitted module");
    return found.trim();
  };

  test("the dot chain lifts as the operator chain and the pipe do", async () => {
    const exports = await runProject([["/main.hex",
      "module Main\n\n" + "// the receiver seat\n" +
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
      "module Main\n\n" + "// the guard flip\n" +
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
      "module Main\n\n" + "// the rung gate\n" +
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

  test("a stood-down receiver is refused, never accepted at the type it kept", () => {
    // §9 row 16, and the retraction it is *(#821)*. `BigInt` honors `Integral`,
    // so `gcd` forwards it; `Foo` reaches `BigInt` by neither route, so the
    // addition could not run there — and the face being **binding**, the dot
    // refuses rather than dispatching the companion's exported `gcd` at `Foo`.
    // `[was OK]`: this exact program compiled before the retraction.
    expect(refusals(`${foo}let probe: BigInt = p.add(q).gcd(s2)\n`)).toEqual([
      rowSixteen({
        receiver: "p.add(q)",
        declined: "`p` is a `Foo` and",
        ascribe: "p.add(q)",
        kept: "Foo",
      }),
    ]);
  });

  test("every written boundary keeps the receiver, and every spelling refuses alike", () => {
    // The boundaries §2.2 names, each stopping the face: the ascription, the
    // separate binding, and the absence of a face at all. All three answer with
    // the companion's exported `gcd`, which is the point of the offered repair —
    // the program the reader wanted is one edit away.
    expect(line(`${foo}let probe: BigInt = (p.add(q): Foo).gcd(s2)\n`))
      .toBe("const probe = gcd(__Num_Foo_add(p, q), s2);");
    expect(line(`${foo}let probe = p.add(q).gcd(s2)\n`))
      .toBe("const probe = gcd(__Num_Foo_add(p, q), s2);");
    expect(line(`${foo}let t2 = p.add(q)\nlet probe: BigInt = t2.gcd(s2)\n`))
      .toBe("const probe = gcd(t2, s2);");
    // A receiver that is no tower member call takes the expectation and does
    // nothing with it — an expectation is not an annotation.
    expect(line(`${foo}let probe: BigInt = p.gcd(s2)\n`))
      .toBe("const probe = gcd(p, s2);");
    expect(line(`${foo}let probe: BigInt = mk().gcd(s2)\n`))
      .toBe("const probe = gcd(mk(), s2);");
  });

  test("the refusal is one report at every spelling of the receiver's operation", () => {
    // The **delayed bind**, measured where it shows: before it, the mixed
    // operand `i.add(p)` refused *twice* (the subject was bound to the face, so
    // `p` refused at its own seat as well), the constraint-qualified spelling
    // three times, and the all-`Foo` operator spelling not at all. One
    // operation, one verdict, one report — whichever spelling wrote it.
    const mixed = (receiver: string, declined = "`p` is a `Foo` and"): string =>
      rowSixteen({ receiver, declined, ascribe: receiver, kept: "Foo" });
    expect(refusals(`${foo}let probe: BigInt = i.add(p).gcd(s2)\n`))
      .toEqual([mixed("i.add(p)")]);
    expect(refusals(`${foo}let probe: BigInt = p.add(i).gcd(s2)\n`))
      .toEqual([mixed("p.add(i)")]);
    // `[was OK]` — the operator spellings compiled, the receiver operand alone
    // having been tested and `Foo` having declined it.
    expect(refusals(`${foo}let probe: BigInt = (i + p).gcd(s2)\n`))
      .toEqual([rowSixteen({
        receiver: "(i + p)",
        declined: "`p` is a `Foo` and",
        ascribe: "i + p",
        kept: "Foo",
      })]);
    expect(refusals(`${foo}let probe: BigInt = (p + q).gcd(s2)\n`))
      .toEqual([rowSixteen({
        receiver: "(p + q)",
        declined: "`p` is a `Foo` and",
        ascribe: "p + q",
        kept: "Foo",
      })]);
    // The constraint-qualified spelling and the pipe stage are the open call
    // too (§5.1), and refuse once each. Both are quoted **as written**: the
    // resolved tree records the member a qualified reference resolved to and not
    // the qualifier, and a pipe stage arrives as the call it rewrote to, so
    // neither reconstructs — the report slices the source span instead.
    expect(refusals(`${foo}let probe: BigInt = Num.add(p, q).gcd(s2)\n`))
      .toEqual([rowSixteen({
        receiver: "Num.add(p, q)",
        declined: "`p` is a `Foo` and",
        ascribe: "Num.add(p, q)",
        kept: "Foo",
      })]);
    expect(refusals(`${foo}let probe: BigInt = (p |> Num.add(q)).gcd(s2)\n`))
      .toEqual([rowSixteen({
        receiver: "(p |> Num.add(q))",
        declined: "`p` is a `Foo` and",
        ascribe: "p |> Num.add(q)",
        kept: "Foo",
      })]);
  });

  test("the companion-qualified receiver is a written face and cannot stand down", () => {
    // §5.1: `Foo.add(p, q)` is a *written face*, not a further spelling of the
    // open call — the operands widen into it and it lifts nothing, so there is
    // no stand-down and nothing forwards past it. It needs the two-module shape,
    // a companion module being what makes the qualified spelling reachable, and
    // that shape is also where the offered ascription has to name the type as
    // *this* module spells it.
    const project = compileFiles([
      ["/main.hex", fooMain + "let probe: BigInt = Foo.add(p, q).gcd(s2)\n"],
      ["/Foo.hex", "module Foo\n\n" + fooModule],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(
      project.modules.find(({ source: file }) => file.path === "/main.hex")!
        .javascript.text.split("\n").find((text) => text.includes("const probe"))!.trim(),
    ).toBe("const probe = Foo.gcd(add(p, q), s2);");
    // And the row-16 repair spells `Foo.Foo`, which is the only spelling that
    // resolves here.
    expect(
      compileFiles([
        ["/main.hex", fooMain + "let probe: BigInt = p.add(q).gcd(s2)\n"],
        ["/Foo.hex", "module Foo\n\n" + fooModule],
      ]).diagnostics.map(({ message }) => message),
    ).toEqual([
      rowSixteen({
        receiver: "p.add(q)",
        declined: "`p` is a `Foo` and",
        ascribe: "p.add(q)",
        kept: "Foo",
        written: "Foo.Foo",
      }),
    ]);
  });

  test("the face reaches a tower call through every forwarding form", () => {
    // §2.2's reach: the face governs every tower member call it reaches, and it
    // reaches through the forms that return another expression's value. Each of
    // these compiled before the retraction — the branches joined at `Foo` and
    // the companion's `gcd` answered — and each is `[was OK]`.
    const branch = (receiver: string, source: string): void => {
      expect(refusals(`${foo}let probe: BigInt = ${source}\n`)).toEqual([
        rowSixteen({
          receiver,
          declined: "`p` is a `Foo` and",
          ascribe: "p.add(q)",
          kept: "Foo",
        }),
      ]);
    };
    branch("(if c then p.add(q) else p)", "(if c then p.add(q) else p).gcd(s2)");
    branch(
      "(if c then (if c then p.add(q) else p) else q)",
      "(if c then (if c then p.add(q) else p) else q).gcd(s2)",
    );
    // A `match` arm, a block's final expression and a `try` body are forwarding
    // forms too. The receiver has no spelling this report can offer, so it names
    // none.
    branch("", "(match c\n        True => p.add(q)\n        False => p).gcd(s2)");
    branch("", "(if c then\n        let z = 1\n        p.add(q)\n    else p).gcd(s2)");
    branch("", "(try\n        p.add(q)\n    catch\n        JsError(e) => p).gcd(s2)");
    // A tower operation inside a branch, reached as an operand of another.
    expect(
      refusals(
        `${foo}let probe: BigInt = ((if c then p.add(q) else p) + q).gcd(s2)\n`,
      ),
    ).toEqual([
      rowSixteen({
        receiver: "((if c then p.add(q) else p) + q)",
        declined: "the part of the receiver that declined is a `Foo` and it",
        ascribe: "(if c then p.add(q) else p) + q",
        kept: "Foo",
      }),
    ]);
    // The operator inside a branch takes the same row.
    expect(refusals(`${foo}let probe: BigInt = (if c then p + q else p).gcd(s2)\n`))
      .toEqual([rowSixteen({
        receiver: "(if c then p + q else p)",
        declined: "`p` is a `Foo` and",
        ascribe: "p + q",
        kept: "Foo",
      })]);
    // And the reach follows a dot call's own receiver, wherever the face got to.
    expect(
      refusals(
        `${foo}let probe: BigInt = (if c then p.add(q).gcd(s2) else b9).multiply(b9)\n`,
      ),
    ).toEqual([
      rowSixteen({
        receiver: "p.add(q)",
        declined: "`p` is a `Foo` and",
        ascribe: "p.add(q)",
        kept: "Foo",
      }),
    ]);
  });

  test("a boundary inside a form composes, and a form with no tower call is untouched", () => {
    // The twin of the block route above, one line apart: the binding *inside*
    // the block is a boundary, so the block's final expression is a variable and
    // the face reaches no tower call at all.
    expect(
      refusals(
        `${foo}let probe: BigInt = (if c then\n` +
          "        let inner = p.add(q)\n        inner\n    else p).gcd(s2)\n",
      ),
    ).toEqual([]);
    // An ascription inside a branch is a boundary too, and composes — and it is
    // the repair the report offers, so it must compile.
    expect(line(`${foo}let probe: BigInt = (if c then (p.add(q): Foo) else p).gcd(s2)\n`))
      .toBe("const probe = gcd(c ? __Num_Foo_add(p, q) : p, s2);");
    // The whole-receiver ascription also repairs *here*, the receiver's own type
    // being the kept type. The fixit names the smaller, always-repairing one.
    expect(line(`${foo}let probe: BigInt = (if c then p.add(q) else p: Foo).gcd(s2)\n`))
      .toBe("const probe = gcd(c ? __Num_Foo_add(p, q) : p, s2);");
    // Variables in both branches: nothing lifts, nothing stands down.
    expect(line(`${foo}let probe: BigInt = (if c then p else q).gcd(s2)\n`))
      .toBe("const probe = gcd(c ? p : q, s2);");
  });

  test("the operand channel carries the face, and the report is the outermost stand-down", () => {
    // §5.1's operand channel is part of the reach: the inner `p.add(q)` stands
    // down, the outer `+` then stands down over it, and row 16 reports at the
    // **outermost** of the two.
    expect(refusals(`${foo}let probe: BigInt = (p.add(q) + q).gcd(s2)\n`)).toEqual([
      rowSixteen({
        receiver: "(p.add(q) + q)",
        declined: "the part of the receiver that declined is a `Foo` and it",
        ascribe: "p.add(q) + q",
        kept: "Foo",
      }),
    ]);
  });

  test("the `**` exponent seat is outside the reach", () => {
    // Numeric Literals §5.1: at `**` the face governs the **base** seat only —
    // the written `Int` exponent takes `Int` as its own face and never the outer
    // one. Both rows are unchanged by #821.
    expect(line(`${foo}let probe: BigInt = (b9 ** (i + j)).gcd(b9)\n`))
      .toBe("const probe = __Integral_BigInt_gcd(__Pow_BigInt.pow(b9, i + j), b9);");
    expect(line(`${foo}let probe: BigInt = ((i + j) ** i).multiply(b9)\n`))
      .toBe("const probe = __Pow_BigInt.pow(BigInt(i) + BigInt(j), i) * b9;");
  });

  test("where the parts disagree, the form's own report wins and row 16 stands aside", () => {
    // A forwarding form has **no lift** of its own to stand down: the face
    // reaches both branches, `i + j` enters it and `p` cannot, and the branches
    // then disagree. Operators §11's report at the whole `if` is the whole
    // refusal — one report, where two fired before — and §2.2 adds only the
    // boundary repair, offered because the branch the face lifted would follow
    // the receiver to `Foo`.
    expect(refusals(`${foo}let probe: BigInt = (if c then i + j else p).gcd(s2)\n`))
      .toEqual([descended("(if c then i + j else p)")]);
    // The repair is offered only where it compiles. `b9 : BigInt` would not
    // follow the receiver to `Foo`, so no ascription is named.
    expect(refusals(`${foo}let probe: BigInt = (if c then p.add(q) else b9).gcd(s2)\n`))
      .toEqual(["type mismatch: expected Foo, found BigInt"]);
    // §9 row 16 names the `match` and `try` arm bodies in the same breath as the
    // `if`'s branches (Pattern Matching §6.2's report at the arm body), and the
    // join there is result-against-arm rather than branch-against-branch. Both
    // twins of the control above: one report, and row 16 stands aside.
    expect(
      refusals(
        `${foo}let probe: BigInt = (match c\n` +
          "        True => p.add(q)\n        False => b9).gcd(s2)\n",
      ),
    ).toEqual(["type mismatch: expected Foo, found BigInt"]);
    expect(
      refusals(
        `${foo}fun probeOf(): BigInt =\n    (try\n        p.add(q)\n` +
          "    catch\n        JsError(e) => b9).gcd(s2)\n",
      ),
    ).toEqual(["type mismatch: expected Foo, found BigInt"]);
    // And the lifted-branch twins, where the `if` carries the boundary fixit and
    // the arm forms do not. The reason is not that the walk stops early — it
    // reaches the arm bodies and finds that both of them do follow — but that an
    // arm form's own text spans lines, so the ascription cannot be put on one
    // line, and the *binding* is no repair here either: `let t = match c / True
    // => i + j / False => p` refuses on its own, the arm join carrying no
    // widening where the `if`'s does (pinned below). Nothing offerable, so
    // nothing offered.
    expect(
      refusals(
        `${foo}let probe: BigInt = (match c\n` +
          "        True => i + j\n        False => p).gcd(s2)\n",
      ),
    ).toEqual(["type mismatch: expected BigInt, found Foo"]);
    expect(
      refusals(
        `${foo}fun probeOf(): BigInt =\n    (try\n        i + j\n` +
          "    catch\n        JsError(e) => p).gcd(s2)\n",
      ),
    ).toEqual(["type mismatch: expected BigInt, found Foo"]);
    // The nested receiver is the same shape at the operator and at the member
    // spelling: the face descends into one operand, the other declines it, and
    // the operation is left with no algebra. Its own report, once, with the
    // repair.
    expect(refusals(`${foo}let probe: BigInt = (p + (i + j)).gcd(s2)\n`))
      .toEqual([descended("(p + (i + j))", "expected Foo, found BigInt")]);
    expect(refusals(`${foo}let probe: BigInt = p.add(i.add(j)).gcd(s2)\n`))
      .toEqual([descended("p.add(i.add(j))", "expected Foo, found BigInt")]);
  });

  test("every repair this report offers compiles", () => {
    // The truth test behind an offered rewrite (Modules §7.6): each ascription
    // named above is pasted back and must be accepted.
    expect(refusals(`${foo}let probe: BigInt = (i + p: Foo).gcd(s2)\n`)).toEqual([]);
    expect(refusals(`${foo}let probe: BigInt = (p + q: Foo).gcd(s2)\n`)).toEqual([]);
    expect(refusals(`${foo}let probe: BigInt = (add(p, q): Foo).gcd(s2)\n`)).toEqual([]);
    expect(refusals(`${foo}let probe: BigInt = (if c then (p + q: Foo) else p).gcd(s2)\n`))
      .toEqual([]);
    expect(
      refusals(`${foo}let probe: BigInt = (if c then i + j else p: Foo).gcd(s2)\n`),
    ).toEqual([]);
    expect(refusals(`${foo}let probe: BigInt = ((p + (i + j)): Foo).gcd(s2)\n`))
      .toEqual([]);
    expect(refusals(`${foo}let probe: BigInt = (p.add(i.add(j)): Foo).gcd(s2)\n`))
      .toEqual([]);
    expect(refusals(`${foo}let probe: BigInt = (p.add(q) + q: Foo).gcd(s2)\n`))
      .toEqual([]);
    // The two spellings the tree cannot reconstruct, offered as written and
    // pasted back exactly as offered.
    expect(refusals(`${foo}let probe: BigInt = (Num.add(p, q): Foo).gcd(s2)\n`))
      .toEqual([]);
    expect(refusals(`${foo}let probe: BigInt = (p |> Num.add(q): Foo).gcd(s2)\n`))
      .toEqual([]);
  });

  test("the boundary is offered only where it compiles", () => {
    // The Rewrite Rule's own test, and it is decided from the **recorded** types
    // of the operands rather than from a prediction about the kept type. A
    // tower operation follows the receiver to `Foo` only where each of its own
    // operands can enter `Foo`: `i` and `j` do, through `Signed.fromInt`, and
    // `b9 : BigInt` enters nothing — so the same shapes that carry the fixit one
    // line above carry none here. `main` offered none on any of them.
    const bare = "type mismatch: expected BigInt, found Foo";
    expect(refusals(`${foo}let probe: BigInt = (if c then i + b9 else p).gcd(s2)\n`))
      .toEqual([bare]);
    expect(refusals(`${foo}let probe: BigInt = (if c then i.add(b9) else p).gcd(s2)\n`))
      .toEqual([bare]);
    expect(refusals(`${foo}let probe: BigInt = (p + (i + b9)).gcd(s2)\n`))
      .toEqual(["type mismatch: expected Foo, found BigInt"]);
    expect(refusals(`${foo}let probe: BigInt = p.add(i.add(b9)).gcd(s2)\n`))
      .toEqual(["type mismatch: expected Foo, found BigInt"]);
    // And the rung half of the same test: `Foo` honors no `Pow`, so a `**`
    // branch would not run at `Foo` under any ascription.
    expect(refusals(`${foo}let probe: BigInt = (if c then b9 ** i else p).gcd(s2)\n`))
      .toEqual([bare]);
    // Each of the offers that *is* made, pasted back — the positive half of the
    // same predicate, so a change to it cannot pass by weakening one side.
    for (
      const repaired of [
        "(if c then i + j else p: Foo)",
        "((p + (i + j)): Foo)",
        "(p.add(i.add(j)): Foo)",
      ]
    ) expect(refusals(`${foo}let probe: BigInt = ${repaired}.gcd(s2)\n`)).toEqual([]);
  });

  test("the boundary walks every value path the face itself walks", () => {
    // The repair asks its question of the **whole** ascribed expression, and
    // the face travels through the forwarding forms (§2.2), so the walk has to
    // as well: grouping, a block's final expression, both `if` branches, and
    // `match`/`try` arm bodies. Walking only as far as the first `Group`
    // silenced every one of these, a **one-line** nested `if` among them — so
    // line-spanning was never the operative reason.
    expect(
      refusals(
        `${foo}let probe: BigInt = (if c then (if c then i + j else i) else p).gcd(s2)\n`,
      ),
    ).toEqual([descended("(if c then (if c then i + j else i) else p)")]);
    expect(refusals(`${foo}let probe: BigInt = (p + ((i + j))).gcd(s2)\n`))
      .toEqual([descended("(p + ((i + j)))", "expected Foo, found BigInt")]);
    expect(refusals(`${foo}let probe: BigInt = (if c then (i + j) else p).gcd(s2)\n`))
      .toEqual([descended("(if c then (i + j) else p)")]);
    // Both, pasted back.
    for (
      const repaired of [
        "((if c then (if c then i + j else i) else p): Foo)",
        "((p + ((i + j))): Foo)",
        "((if c then (i + j) else p): Foo)",
      ]
    ) expect(refusals(`${foo}let probe: BigInt = ${repaired}.gcd(s2)\n`)).toEqual([]);
    // The walk reaching further must not weaken B2: one `BigInt` leaf anywhere
    // in the nest and the offer is withheld, at every depth.
    const bare = "type mismatch: expected BigInt, found Foo";
    expect(
      refusals(
        `${foo}let probe: BigInt = (if c then (if c then i + b9 else i) else p).gcd(s2)\n`,
      ),
    ).toEqual([bare]);
    expect(refusals(`${foo}let probe: BigInt = (p + (i + (j + b9))).gcd(s2)\n`))
      .toEqual(["type mismatch: expected Foo, found BigInt"]);
    expect(refusals(`${foo}let probe: BigInt = (p + (i + (j + i))).gcd(s2)\n`))
      .toEqual([descended("(p + (i + (j + i)))", "expected Foo, found BigInt")]);
  });

  test("the binding is a repair at the stood-down call, and not at a form", () => {
    // Why §9 row 16's repair names a binding and the face descent's does not.
    // Row 16 ascribes the **stood-down call**, whose own type is the kept type,
    // so binding it is §2.2's boundary by construction. The descent ascribes a
    // whole form, whose join *without* the face is a separate question: the
    // `if` widens and repairs, the `match` of the same two paths does not.
    expect(line(`${foo}let t9 = if c then i + j else p\nlet probe: BigInt = t9.gcd(s2)\n`))
      .toBe("const probe = gcd(t9, s2);");
    expect(
      refusals(
        `${foo}let t9 = match c\n        True => i + j\n        False => p\n`,
      ),
    ).toEqual(["type mismatch: expected Int, found Foo"]);
  });

  test("a dot with no claimant at all keeps its own refusal", () => {
    // §9 row 16's scope is a claimant **outside the rung** — a companion export,
    // an honored member of a user constraint, a function-typed field. The
    // complement of "the kept type honors the rung" is "a non-rung claimant *or
    // none*", and only the first is this row: where nothing answers, §9 row 4's
    // refusal is both true and precise where row 16 would name a type that has
    // no such member and offer an ascription that does not compile.
    const noSuchGcd = (type: string): string =>
      `\`${type}\` has no field \`gcd\`, its companion exports no operation ` +
      `\`gcd\`, and no constraint honored at \`${type}\` has a subject-first ` +
      "member `gcd`; call an available subject-first function explicitly";
    // `Float` honors no `Integral` and exports no `gcd`; the receiver stands
    // down all the same, `Float` reaching `BigInt` by neither route.
    expect(refusals(`${foo}let probe: BigInt = (ff + gg).gcd(b9)\n`))
      .toEqual([noSuchGcd("Float")]);
    expect(refusals(`${foo}let probe = (ff + gg).gcd(b9)\n`))
      .toEqual([noSuchGcd("Float")]);
    // The same fixture with the export deleted: one line decides which refusal
    // the annotated program gets.
    const noExport = foo.replace(
      "export let gcd(left: Foo, right: Foo): BigInt = BigInt.fromInt(left.n)\n",
      "",
    );
    expect(refusals(`${noExport}let probe: BigInt = p.add(q).gcd(s2)\n`))
      .toEqual([noSuchGcd("Foo")]);
    // A claimant that exists but does not **answer** is no claimant either, and
    // the two ways it can fail to are §3.4's own — which is why this row reads
    // the dispatch table rather than a second copy of it. A field that is not a
    // function takes §9 row 3, and an export declared below the call takes
    // §9 row 12; row 16's ascription would paste into exactly those.
    const nf = "export record Nf = {n: Int, gcd: Int}\n" +
      "honor Num<Nf> =\n" +
      "    add(left, right) = Nf({n = left.n + right.n, gcd = 0})\n" +
      "    multiply(left, right) = Nf({n = left.n * right.n, gcd = 0})\n" +
      "    fromNat(value) = Nf({n = Int.fromNat(value), gcd = 0})\n" +
      "let f1: Nf = Nf({n = 1, gcd = 0})\n" +
      "let f2: Nf = Nf({n = 2, gcd = 0})\n";
    const notAFunction =
      "`.gcd` is not a function — it has type `Int`, and this call supplies 1 argument";
    expect(refusals(`${nf}let probe: BigInt = f1.add(f2).gcd(f1)\n`))
      .toEqual([notAFunction]);
    expect(refusals(`${nf}let probe: BigInt = (f1.add(f2): Nf).gcd(f1)\n`))
      .toEqual([notAFunction]);
    expect(
      refusals(
        `${noExport}let probe: BigInt = p.add(q).gcd(s2)\n` +
          "export let gcd(left: Foo, right: Foo): BigInt = BigInt.fromInt(left.n)\n",
      ),
    ).toEqual([
      "`Foo`'s companion declares `gcd` below this call; declarations are read " +
      "top-down — move the declaration above this call",
    ]);
  });

  test("each stand-down in a receiver is reported, one repair at a time", () => {
    // Two siblings, each a true and singular refusal: the first is reported, and
    // its repair surfaces the second. Pinned so the iteration is deliberate.
    expect(refusals(`${foo}let probe: BigInt = (if c then p.add(q) else q.add(p)).gcd(s2)\n`))
      .toEqual([rowSixteen({
        receiver: "(if c then p.add(q) else q.add(p))",
        declined: "`p` is a `Foo` and",
        ascribe: "p.add(q)",
        kept: "Foo",
      })]);
    expect(
      refusals(
        `${foo}let probe: BigInt = (if c then (p.add(q): Foo) else q.add(p)).gcd(s2)\n`,
      ),
    ).toEqual([rowSixteen({
      receiver: "(if c then (p.add(q): Foo) else q.add(p))",
      declined: "`q` is a `Foo` and",
      ascribe: "q.add(p)",
      kept: "Foo",
    })]);
    expect(
      line(
        `${foo}let probe: BigInt = ` +
          "(if c then (p.add(q): Foo) else (q.add(p): Foo)).gcd(s2)\n",
      ),
    ).toBe("const probe = gcd(c ? __Num_Foo_add(p, q) : __Num_Foo_add(q, p), s2);");
  });

  test("the rung's own member is dispatched at the kept type, with no row 16", () => {
    // §9 row 16's claimant clause. `multiply` is `Num`'s member and `Foo` honors
    // `Num`, so the kept type meets the rung's own operation there and the
    // ascription would repair nothing — `(p.add(q): Foo).multiply(s2)` refuses
    // just the same. No row 16, and the enclosing seat's ordinary stand-down
    // report is the one report.
    const stoodDown =
      "an operand of type `Foo` cannot enter `BigInt`, so the multiplication " +
      "ran at `Foo`";
    expect(refusals(`${foo}let probe: BigInt = p.add(q).multiply(s2)\n`))
      .toEqual([stoodDown]);
    expect(refusals(`${foo}let probe: BigInt = (p.add(q): Foo).multiply(s2)\n`))
      .toEqual([stoodDown]);
  });

  test("the three non-rung claimants are refused alike, and repaired alike", () => {
    // §9 row 16's class, named exactly: a **non-rung claimant bearing a rung
    // spelling**. The companion export is pinned above; these are the other two
    // — an honored member of a user constraint, and a function-typed field. Each
    // refuses with the same row and each is accepted with the same ascription.
    const numAndSigned = (name: string, extra: string): string =>
      `honor Num<${name}> =\n` +
      `    add(left, right) = ${name}({n = left.n + right.n${extra}})\n` +
      `    multiply(left, right) = ${name}({n = left.n * right.n${extra}})\n` +
      `    fromNat(value) = ${name}({n = Int.fromNat(value)${extra}})\n` +
      `honor Signed<${name}> =\n` +
      `    subtract(left, right) = ${name}({n = left.n - right.n${extra}})\n` +
      `    negate(value) = ${name}({n = -value.n${extra}})\n` +
      `    fromInt(value) = ${name}({n = value${extra}})\n`;
    const bar = "export constraint Gcdish<a: Num> =\n" +
      "    gcd(left: a, right: a): BigInt\n" +
      "export record Bar = {n: Int}\n" +
      numAndSigned("Bar", "") +
      "honor Gcdish<Bar> =\n" +
      "    gcd(left, right) = BigInt.fromInt(left.n)\n" +
      "let b1: Bar = Bar({n = 4})\n" +
      "let b2: Bar = Bar({n = 6})\n" +
      "let b3: Bar = Bar({n = 8})\n";
    expect(refusals(`${bar}let probe: BigInt = b1.add(b2).gcd(b3)\n`)).toEqual([
      rowSixteen({
        receiver: "b1.add(b2)",
        declined: "`b1` is a `Bar` and",
        ascribe: "b1.add(b2)",
        kept: "Bar",
      }),
    ]);
    expect(line(`${bar}let probe: BigInt = (b1.add(b2): Bar).gcd(b3)\n`))
      .toBe("const probe = __Gcdish_Bar_gcd(__Num_Bar_add(b1, b2), b3);");

    const baz = "export record Baz = {n: Int, gcd: (Baz) -> BigInt}\n" +
      "honor Num<Baz> =\n" +
      "    add(left, right) = Baz({n = left.n + right.n, gcd = left.gcd})\n" +
      "    multiply(left, right) = Baz({n = left.n * right.n, gcd = left.gcd})\n" +
      "    fromNat(value) = Baz({n = Int.fromNat(value), gcd = other => 0n})\n" +
      "honor Signed<Baz> =\n" +
      "    subtract(left, right) = Baz({n = left.n - right.n, gcd = left.gcd})\n" +
      "    negate(value) = Baz({n = -value.n, gcd = value.gcd})\n" +
      "    fromInt(value) = Baz({n = value, gcd = other => 0n})\n" +
      "let z1: Baz = Baz({n = 4, gcd = other => 1n})\n" +
      "let z2: Baz = Baz({n = 6, gcd = other => 1n})\n" +
      "let z3: Baz = Baz({n = 8, gcd = other => 1n})\n";
    expect(refusals(`${baz}let probe: BigInt = z1.add(z2).gcd(z3)\n`)).toEqual([
      rowSixteen({
        receiver: "z1.add(z2)",
        declined: "`z1` is a `Baz` and",
        ascribe: "z1.add(z2)",
        kept: "Baz",
      }),
    ]);
    expect(line(`${baz}let probe: BigInt = (z1.add(z2): Baz).gcd(z3)\n`))
      .toBe("const probe = (__Num_Baz_add(z1, z2).gcd)(z3);");
  });

  test("a receiver that entered the face is refused for its own reasons", () => {
    // The literal-only receiver: literals reach anything, so `1 + 2` lifts to
    // `BigInt` and the receiver **entered** the face. What refuses is `s2` at
    // `Integral<BigInt>`'s own seat — not row 16, which is about a receiver that
    // could not enter.
    expect(refusals(`${foo}let probe: BigInt = (1 + 2).gcd(s2)\n`))
      .toEqual(["type mismatch: expected BigInt, found Foo"]);
    // Unannotated, the literals take `s2`'s `Foo` and `Integral<Foo>` is
    // missing — refused either way, and neither refusal is row 16.
    expect(refusals(`${foo}let probe = (1 + 2).gcd(s2)\n`)).toEqual([
      "type `Foo` has no `Integral` instance; it could only be declared in " +
      "`./main.hex` (declares `Foo`) or the module declaring `Integral`",
    ]);
    expect(line(`${foo}let probe: BigInt = (1 + 2).gcd(3)\n`))
      .toBe("const probe = __Integral_BigInt_gcd(1n + 2n, 3n);");
    expect(line(`${foo}let probe = (1 + 2).gcd(3)\n`))
      .toBe("const probe = __Integral_Int_gcd(1 + 2, 3);");
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
    const project = compileFiles([["/main.hex", "module Main\n\n" + source]]);
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
        "module Main\n\n" + 'import Box\n' +
        "let boxed: Box.Box = Box.Box({size = 1n})\n" +
        "let step: Int = 2\n" +
        "export let dotted: BigInt = Box.size(boxed.bump(step))\n" +
        "export let qualified: BigInt = Box.size(Box.bump(boxed, step))\n",
      ],
      ["/box.hex",
        "module Box\n\n" + "export record Box = {size: BigInt}\n" +
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
    const project = compileFiles([["/main.hex", "module Main\n\n" + source]]);
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
      "module Main\n\n" + "// ownership at Nat\n" +
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
      "module Main\n\n" + "// one operation, five spellings\n" +
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
    // The verdict is unchanged; the words are §6's since #821's delayed bind
    // (the dot is the open call, so it takes the note the operator takes).
    expect(verdict("export let probe: Int = i.multiply(f)\n"))
      .toEqual([
        "`f` is a `Float` and cannot enter `Int`, so the multiplication ran at " +
          "`Float`",
      ]);
    expect(verdict("export let probe: Int = i * f\n"))
      .toEqual([
        "`f` is a `Float` and cannot enter `Int`, so the multiplication ran at " +
          "`Float`",
      ]);
  });
});
