import { describe, expect, test } from "vitest";

import {
  compileFiles,
  compileMain,
  projectDiagnostics,
  runMain,
} from "../support/test-project.js";

/**
 * Conformance for **literal patterns at the type of their position** — Pattern
 * Matching §2.5, §4, §7.2, §8, §12, §15 (k); #894, and #519's two refusals with it.
 *
 * Four sentences govern every case below.
 *
 * - **`Float` literals are patterns.** The permanent ban is lifted: `Eq<Float>` is
 *   SameValueZero (Decisions Batch §1), so the NaN half of its rationale was
 *   false, and the signed-zero half was never a reason to refuse a pattern that
 *   follows the language's own equality. The arm test is what `scrutinee == lit`
 *   emits at `Float` — `__floatEquals`, never a bare `===`.
 * - **A literal pattern is checked at the type of its position, and never widens
 *   it.** An integer literal contributes `Num`, `Eq`, and `Signed` for a negative
 *   one, and unifies there; a decimal literal requires `Float`; a string literal
 *   `String`. This is James's ruling of 2026-09-11, and it retires the
 *   monomorphic-`Int` typing #519 filed along with that issue's `Nat`/`BigInt`
 *   scrutinee gate.
 * - **The permitted-primitive restriction is checked on the resolved type.** An
 *   integer literal must resolve to `Int`, `Nat`, `BigInt` or `Float` — the four
 *   whose value *and* whose equality the compiler computes. A resolution to a
 *   `Num`-honoring type outside them (`Rat`, a declared variable under
 *   `<a: (Num, Eq)>`) is refused at the literal, naming the guard that works.
 * - **A literal's coverage identity is its value** at that primitive, never its
 *   spelling (§7.2).
 *
 * The emitted text is pinned as well as the verdicts: §2.5's equality selection is
 * an emission rule, and the conversion from spelling to value is #897's.
 */

const main = (body: string): string => "module Main\n\n" + body;

/** `/main.hex`'s emitted JavaScript. */
const emitted = (body: string): string => {
  const project = compileMain(main(body));
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
};

const DUPLICATE = "this literal case is unreachable; it is already handled above";

/**
 * Every test here compiles whole projects, prelude included, so the file is slow by
 * construction — and slow in a way that varies with what else the runner is doing.
 * One test measured 1.2s alone and timed out at 5.3s under full-suite contention,
 * 0.3s past vitest's default: a red suite for a reason that is not a defect. The
 * budget is per test and generous, because the only thing it is protecting against
 * is load, and a test that genuinely hangs still fails inside twenty seconds.
 */
const BUDGET = { timeout: 20000 } as const;

/** Several modules' diagnostics, for the cases that need a term to import. */
const diagnostics = (
  files: readonly (readonly [string, string])[],
): readonly string[] => compileFiles(files).diagnostics.map(({ message }) => message);

/** A module of plain terms, one per shape §2.5's guard condition parts on. */
const HELPER: readonly [string, string] = [
  "/helper.hex",
  "module Helper\n\n" +
  "export let zero: Nat = 0\n" +
  "export let count: Int = 0\n" +
  "export let text: String = \"x\"\n" +
  "export let go = (n: Int): Int => n\n" +
  "export let pair: (Int, Int) = (0, 0)\n" +
  "export let origin: {x: Int} = {x = 0}\n" +
  "export let many: Vector(Int) = [0]\n" +
  "export let nothing: Option(a) = None\n" +
  "export let empty: Vector(a) = []\n" +
  "export union Blob = Blob\n" +
  "export let blobPair: (Blob, Blob) = (Blob, Blob)\n" +
  "export let blobRecord: {x: Blob} = {x = Blob}\n" +
  "export let blobs: Vector(Blob) = [Blob]\n",
];

/** A union with no `Eq`, and the same union with one. */
const HUE: readonly [string, string] = [
  "/hue.hex",
  "module Hue\n\nexport union Hue = Red | Green\nexport let first: Hue = Red\n",
];
const HUE_EQ: readonly [string, string] = [
  "/hueeq.hex",
  "module HueEq\n\nexport union Hue derives Eq = Red | Green\nexport let first: Hue = Red\n",
];

describe("acceptance and matching (§2.5, §15 (k))", BUDGET, () => {
  test("positive and negative finite literals match, and `0.0` matches `-0.0`", async () => {
    // §2.5: "the arm `0.0` matches `-0.0`, exactly as `x == 0.0` is true of it".
    // The run is the point — a pin on the emitted test alone would not show that
    // JavaScript's `===` already equates the zeros.
    const exports = await runMain(main(
      "export fun name(t: Float): String =\n" +
        "    match t\n" +
        "        0.0 => \"zero\"\n" +
        "        -40.0 => \"the same on both scales\"\n" +
        "        _ => \"ok\"\n" +
        "export let atZero: String = name(0.0)\n" +
        "export let atNegativeZero: String = name(-0.0)\n" +
        "export let atForty: String = name(-40.0)\n" +
        "export let elsewhere: String = name(1.5)\n",
    ));
    expect([
      exports["atZero"],
      exports["atNegativeZero"],
      exports["atForty"],
      exports["elsewhere"],
    ]).toEqual(["zero", "zero", "the same on both scales", "ok"]);
  });

  test("the arm test is the `==` lowering at `Float`, never a bare `===`", () => {
    // §2.5/§8's selection, and Decisions Batch §1.5's text. A bare `===` would
    // refuse `NaN` its own literal — which no literal can be, the named special
    // values being terms — but it is the *wrong function*, and that is what is
    // pinned: the seat goes through the one `Float` equality the language has.
    const text = emitted(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        0.0 => \"zero\"\n" +
        "        -40.0 => \"cold\"\n" +
        "        _ => \"ok\"\n",
    );
    expect(text).toContain("__floatEquals(__match, 0.0)");
    expect(text).toContain("__floatEquals(__match, -40.0)");
    expect(text).not.toContain("__match === 0.0");
  });

  test("nested, tuple, record and or-pattern positions all take the literal", async () => {
    const exports = await runMain(main(
      "export fun inOption(o: Option(Float)): String =\n" +
        "    match o\n" +
        "        Some(0.0) => \"some zero\"\n" +
        "        Some(_) => \"some\"\n" +
        "        None => \"none\"\n" +
        "export fun inTuple(p: (Float, Int)): String =\n" +
        "    match p\n" +
        "        (0.0, _) => \"zero first\"\n" +
        "        _ => \"other\"\n" +
        "export fun inRecord(r: {port: Float}): String =\n" +
        "    match r\n" +
        "        {port = 0.0} => \"closed\"\n" +
        "        _ => \"open\"\n" +
        "export fun inOr(t: Float): String =\n" +
        "    match t\n" +
        "        0.0 | 1.5 => \"either\"\n" +
        "        _ => \"neither\"\n" +
        "export let a: String = inOption(Some(-0.0))\n" +
        "export let b: String = inTuple((0.0, 3))\n" +
        "export let c: String = inRecord({port = 0.0})\n" +
        "export let d: String = inOr(1.5)\n" +
        "export let e: String = inOr(2.5)\n",
    ));
    expect([exports["a"], exports["b"], exports["c"], exports["d"], exports["e"]])
      .toEqual(["some zero", "zero first", "closed", "either", "neither"]);
  });

  test("`Float` stays an infinite domain: the catch-all is required (§7.1)", () => {
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        0.0 => \"zero\"\n" +
        "        1.5 => \"half\"\n",
    ))).toEqual(["match is missing cases: `_`"]);
  });

  test("a `Float` literal at any other scrutinee type is the ordinary mismatch", () => {
    // §2.5: a decimal literal requires `Float`, `Float` being the source of
    // neither of Numeric Literals §5.1's two conversions. No widening, and no
    // fixit of the pattern's own (§12's row).
    expect(projectDiagnostics(main(
      "export fun f(count: Int): String =\n" +
        "    match count\n" +
        "        0.0 => \"zero\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual(["type mismatch: expected Int, found Float"]);
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(ratio: Rat.Rat): String =\n" +
        "    match ratio\n" +
        "        1.5 => \"never\"\n" +
        "        _ => \"ok\"\n",
    )).toEqual(["type mismatch: expected Rat, found Float"]);
    // §12's row names the nested position too: the slot's type, not the
    // scrutinee's, is what the literal is checked against.
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(o: Option(Rat.Rat)): String =\n" +
        "    match o\n" +
        "        Some(0.0) => \"never\"\n" +
        "        _ => \"ok\"\n",
    )).toEqual(["type mismatch: expected Rat, found Float"]);
  });
});

describe("the literal at the type of its position (§2.5's checking rule, #519)", BUDGET, () => {
  test("an integer literal stands at each of the four permitted primitives", () => {
    // All four drew "type mismatch: expected X, found Int" before the ruling, and
    // `x == 0` was accepted at every one of them. `Nat` and `BigInt` also drew
    // #519's "cannot match on `X` yet".
    for (const [type, scrutinee] of [
      ["Float", "t"],
      ["Nat", "n"],
      ["BigInt", "b"],
      ["Int", "i"],
    ] as const) {
      expect(projectDiagnostics(main(
        `export fun f(${scrutinee}: ${type}): String =\n` +
          `    match ${scrutinee}\n` +
          "        0 => \"zero\"\n" +
          "        _ => \"other\"\n",
      ))).toEqual([]);
    }
  });

  test("and nowhere else: the restriction refuses `Rat`, naming the guard", () => {
    // §15 (k)'s `match ratio`. The constraints hold — `Rat` honors `Num` and `Eq`,
    // and `ratio == 0` compiles — and the literal is still not a pattern, because
    // the value at `Rat` is not one the compiler computes (§7.2, §8).
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(ratio: Rat.Rat): String =\n" +
        "    match ratio\n" +
        "        0 => \"zero\"\n" +
        "        _ => \"ok\"\n",
    )).toEqual([
      "`0` is not a pattern at `Rat`; bind a name and test it in a guard: " +
      "`x when x == 0`",
    ]);
    // The constraints really do hold, which is what makes this the restriction's
    // report and not a constraint failure's.
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(ratio: Rat.Rat): Bool = ratio == 0\n",
    )).toEqual([]);
    // And the refused arm is read as `_` (§7.3's fourth tier): with no catch-all
    // at all, the one report still stands alone.
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(ratio: Rat.Rat): String =\n" +
        "    match ratio\n" +
        "        0 => \"zero\"\n",
    )).toEqual([
      "`0` is not a pattern at `Rat`; bind a name and test it in a guard: " +
      "`x when x == 0`",
    ]);
  });

  test("the guard is spelled at the literal's own position beneath the top", () => {
    // §2.5's other named refusal: a declared variable is resolved — rigid by
    // declaration — so the restriction judges it, and the rewrite has to keep the
    // enclosing pattern's shape.
    expect(projectDiagnostics(main(
      "export fun f<a: (Num, Eq)>(o: Option(a)): String =\n" +
        "    match o\n" +
        "        Some(0) => \"zero\"\n" +
        "        _ => \"other\"\n",
    ))).toEqual([
      "`0` is not a pattern at `a`; bind a name and test it in a guard: " +
      "`Some(y) when y == 0`",
    ]);
    // The binder dodges every name the pattern already binds.
    expect(projectDiagnostics(main(
      "export fun f<a: (Num, Eq)>(p: (a, a)): String =\n" +
        "    match p\n" +
        "        (0, y) => \"zero\"\n" +
        "        _ => \"other\"\n",
    ))).toEqual([
      "`0` is not a pattern at `a`; bind a name and test it in a guard: " +
      "`(y1, y) when y1 == 0`",
    ]);
  });

  test("the rewrite keeps an `as` binder, and declines inside an or-pattern", () => {
    // §2.5's rewrite has to be one the reader can paste, which is what the walk's
    // root is for. `as` and `|` re-enter the walk at their own position, so they
    // used to re-take the root: `0 as z` printed `x when x == 0` and silently
    // dropped the binder the arm body reads.
    const rat = (body: string): string => "module Main\n\nimport Rat\n\n" +
      "fun use(r: Rat.Rat): String = \"used\"\n" + body;
    expect(projectDiagnostics(rat(
      "export fun f(r: Rat.Rat): String =\n" +
        "    match r\n" +
        "        0 as z => use(z)\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([
      "`0` is not a pattern at `Rat`; bind a name and test it in a guard: " +
      "`y as z when y == 0`",
    ]);
    // And the rewrite compiles, binder and all — which is the whole claim.
    expect(projectDiagnostics(rat(
      "export fun f(r: Rat.Rat): String =\n" +
        "    match r\n" +
        "        y as z when y == 0 => use(z)\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([]);
    // Beneath the top the `as` travels with the rest of the shape.
    expect(projectDiagnostics(rat(
      "export fun f(o: Option(Rat.Rat)): String =\n" +
        "    match o\n" +
        "        Some(0 as z) => use(z)\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([
      "`0` is not a pattern at `Rat`; bind a name and test it in a guard: " +
      "`Some(y as z) when y == 0`",
    ]);
    // `as` is the loosest pattern operator (§2.7), so an `as` directly inside an
    // `as` needs parentheses: `y1 as y as z` is a chain the grammar has no form for,
    // and the unparenthesized rewrite drew four reports of its own.
    expect(projectDiagnostics(rat(
      "export fun f(r: Rat.Rat): String =\n" +
        "    match r\n" +
        "        (0 as y) as z => use(z)\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([
      "`0` is not a pattern at `Rat`; bind a name and test it in a guard: " +
      "`(y1 as y) as z when y1 == 0`",
    ]);
    expect(projectDiagnostics(rat(
      "export fun f(r: Rat.Rat): String =\n" +
        "    match r\n" +
        "        (y1 as y) as z when y1 == 0 => use(z)\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([]);
    // One level down the enclosing form's brackets already separate them.
    expect(projectDiagnostics(rat(
      "export fun f(o: Option(Rat.Rat)): String =\n" +
        "    match o\n" +
        "        Some(0 as y) as z => use(y)\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([
      "`0` is not a pattern at `Rat`; bind a name and test it in a guard: " +
      "`Some(y1 as y) as z when y1 == 0`",
    ]);
    // Inside an or-alternative there is no single-literal rewrite: swapping one
    // alternative's literal for a fresh binder is what §2.6's same-bindings rule
    // refuses, so the sentence stops. One report per refused literal, still.
    for (const pattern of ["0 | 1", "Some(0 | 1)"]) {
      const scrutinee = pattern.startsWith("Some") ? "Option(Rat.Rat)" : "Rat.Rat";
      expect(projectDiagnostics(rat(
        `export fun f(r: ${scrutinee}): String =\n` +
          "    match r\n" +
          `        ${pattern} => "small"\n` +
          "        _ => \"ok\"\n",
      ))).toEqual([
        "`0` is not a pattern at `Rat`",
        "`1` is not a pattern at `Rat`",
      ]);
    }
    // The control: the rewrite the seat declined to offer is indeed refused.
    expect(projectDiagnostics(rat(
      "export fun f(o: Option(Rat.Rat)): String =\n" +
        "    match o\n" +
        "        Some(y | 1) when y == 0 => \"small\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([
      "`y` must be bound in every alternative of an or-pattern",
      "`1` is not a pattern at `Rat`",
    ]);
  });

  test("an undetermined nested position resolves by inference and defaulting", () => {
    // §15 (k): "`Some(0)` under `match None` is a match at `Option(Int)`". The
    // restriction is judged on the *resolved* type, so it waits for the default
    // rather than refusing a variable — and `Int` is permitted, so nothing is
    // reported and the arm emits an `Int` test.
    expect(projectDiagnostics(main(
      "export let a: String =\n" +
        "    match None\n" +
        "        Some(0) => \"zero\"\n" +
        "        _ => \"other\"\n",
    ))).toEqual([]);
    expect(emitted(
      "export let a: String =\n" +
        "    match None\n" +
        "        Some(0) => \"zero\"\n" +
        "        _ => \"other\"\n",
    )).toContain("=== 0");
  });

  test("the literal is built at that primitive, and tested by the compiler's `Eq`", () => {
    // §2.5's two emission sentences together: the literal carries that type's
    // spelling (Numeric Literals §5.2 — `0.0`, `0n`) and the test is the equality
    // the compiler computes there (§8's "patterns never invoke user code").
    expect(emitted(
      "export fun f(t: Float): String =\n    match t\n        0 => \"z\"\n        _ => \"o\"\n",
    )).toContain("__floatEquals(__match, 0.0)");
    expect(emitted(
      "export fun f(b: BigInt): String =\n    match b\n        0 => \"z\"\n        _ => \"o\"\n",
    )).toContain("__match === 0n");
    expect(emitted(
      "export fun f(n: Nat): String =\n    match n\n        0 => \"z\"\n        _ => \"o\"\n",
    )).toContain("__match === 0");
    expect(emitted(
      "export fun f(i: Int): String =\n    match i\n        0 => \"z\"\n        _ => \"o\"\n",
    )).toContain("__match === 0");
  });

  test("a `BigInt` literal arm runs", async () => {
    const exports = await runMain(main(
      "export fun f(b: BigInt): String =\n" +
        "    match b\n" +
        "        0 => \"zero\"\n" +
        "        _ => \"big\"\n" +
        "export let a: String = f(0n)\n" +
        "export let b: String = f(7n)\n",
    ));
    expect([exports["a"], exports["b"]]).toEqual(["zero", "big"]);
  });

  test("an unmet constraint draws what `x == 0` draws there, and nothing else", () => {
    // §2.5: "the arm draws, for each unmet constraint, exactly what `x == 0` draws
    // at that type — this section adds no voice of its own". Each case compares the
    // pattern's diagnostics to the comparison's, so the parity is what fails if
    // either seat moves. The union is the case that shows it is **per constraint**:
    // `Eq` is unmet there as well as `Num`, and both seats say both things, in the
    // same order.
    const parity = (type: string, declaration: string, argument: string): void => {
      // Neither function is exported, and each is used at its own result type, so
      // the only diagnostics either program can draw are the literal's own.
      const comparison = projectDiagnostics(main(
        declaration +
          `fun f(x: ${type}): Bool = x == 0\n` +
          `export let a: Bool = f(${argument})\n`,
      ));
      const pattern = projectDiagnostics(main(
        declaration +
          `fun g(x: ${type}): String =\n` +
          "    match x\n" +
          "        0 => \"zero\"\n" +
          "        _ => \"other\"\n" +
          `export let a: String = g(${argument})\n`,
      ));
      expect(pattern).toEqual(comparison);
      expect(pattern.length).toBeGreaterThan(0);
    };
    parity("String", "", "\"x\"");
    parity("{a: Int}", "", "{a = 1}");
    parity("Flag", "union Flag = On | Off\n\n", "On");
    // And the wordings themselves, so a silent drift in both seats at once still
    // fails: `String` honors `Eq` and not `Num`, the union honors neither.
    expect(projectDiagnostics(main(
      "export fun f(s: String): String =\n" +
        "    match s\n" +
        "        0 => \"zero\"\n" +
        "        _ => \"other\"\n",
    ))).toEqual(["integer literal cannot have type `String`"]);
  });

  test("a negative integer literal demands `Signed` — at `Nat`, §7.6's report", () => {
    // §2.5's last bullet, and §15 (k)'s pin: the arm draws Modules §7.6's
    // missing-instance report for `Signed` at `Nat` — the comparison's report, less
    // Method Syntax §9 row 15's written-face rider, which rides at an *operation*
    // seat and is omitted here with nothing in its place (James's third ruling).
    // The pattern's text is pinned whole, and the comparison's is pinned as that
    // text **plus** the rider, so the two cannot drift apart silently and the one
    // clause that differs is the only one that may.
    const closedPair = "type `Nat` has no `Signed` instance; its only legal homes " +
      "are the module declaring `Signed` and `Nat`'s prelude companion module, both " +
      "outside project source, so this pair's honored set is closed — change the " +
      "type, or go through the operations those homes export";
    const rider = "; a written `Int` face runs the operation and admits the result " +
      "(`let difference: Int = …`)";
    const fromPattern = projectDiagnostics(main(
      "export fun f(n: Nat): String =\n" +
        "    match n\n" +
        "        -1 => \"never\"\n" +
        "        _ => \"ok\"\n",
    ));
    expect(fromPattern).toEqual([closedPair]);
    // The rider's own seats, measured in their own contexts — the acceptance the
    // ruling asks for is both halves, so both are here. `==` is the comparison the
    // arm's diagnostic is delegated from; `-` and `.subtract` are §9 row 15's own
    // two spellings, which the rider was written for.
    for (const operation of ["n == -1", "n - m", "n.subtract(m)"]) {
      expect(projectDiagnostics(main(
        `export fun f(n: Nat, m: Nat): Bool = ${operation} == -1\n`,
      ))).toContain(closedPair + rider);
    }
    // And `Frac`'s row of the same rider is untouched: it names no pattern seat,
    // and a literal pattern never demands `Frac`.
    expect(projectDiagnostics(main("export fun f(n: Nat, m: Nat): Nat = n / m\n")))
      .toEqual([
        "type `Nat` has no `Frac` instance; its only legal homes are the module " +
        "declaring `Frac` and `Nat`'s prelude companion module, both outside project " +
        "source, so this pair's honored set is closed — change the type, or go " +
        "through the operations those homes export; for the integer quotient and " +
        "remainder use `Nat.div` and `Nat.mod`, and for real division write a " +
        "`Float` face (`let quotient: Float = …`), which runs the division there",
      ]);
    // The demand is judged whatever the payload, `-0` included (§2.5).
    expect(projectDiagnostics(main(
      "export fun f(n: Nat): String =\n" +
        "    match n\n" +
        "        -0 => \"never\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([closedPair]);
    // And it is satisfied at every `Signed`-honoring type.
    expect(projectDiagnostics(main(
      "export fun f(i: Int): String =\n" +
        "    match i\n" +
        "        -1 => \"minus one\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([]);
  });

  test("an undetermined literal scrutinee is named and points to an ascription", () => {
    // `match 0` with a `0` arm compiled only by the accident the ruling retires:
    // the old monomorphic typing unified the scrutinee to `Int` at arm-check,
    // while the same match with `_` alone, or with the guard twin, was refused.
    // §6.1 reads the scrutinee at dispatch, and all three now read alike.
    // Constraints §8 names the surviving inference variable. Unlike a rigid
    // abstract type, this value has no useful operations to point at; an
    // ascription supplies the concrete representation `match` needs.
    const refusal = "cannot match on a value of abstract type `a`; the value's " +
      "type is not determined here; give the matched expression a concrete " +
      "type with an ascription";
    expect(projectDiagnostics(main(
      "export let a: String =\n    match 0\n        0 => \"zero\"\n        _ => \"other\"\n",
    ))).toEqual([refusal]);
    expect(projectDiagnostics(main(
      "export let a: String =\n    match 0\n        _ => \"other\"\n",
    ))).toEqual([refusal]);
    expect(projectDiagnostics(main(
      "export let a: String =\n" +
        "    match 0\n" +
        "        x when x == 0 => \"zero\"\n" +
        "        _ => \"other\"\n",
    ))).toEqual([refusal]);
  });

  test("undetermined name and expression scrutinees take the same advice", () => {
    expect(projectDiagnostics(main(
      "fun byName(x) =\n" +
        "    let alias = x\n" +
        "    match alias\n" +
        "        _ => \"value\"\n" +
        "export let a: String = byName(0)\n",
    ))).toEqual([
      "cannot match on a value of abstract type `a`; the value's type is not " +
        "determined here; give the matched expression a concrete type with an ascription",
    ]);
    expect(projectDiagnostics(main(
      "export let a: String =\n" +
        "    match (x => x)(0)\n" +
        "        _ => \"value\"\n",
    ))).toEqual([
      "cannot match on a value of abstract type `a`; the value's type is not " +
        "determined here; give the matched expression a concrete type with an ascription",
    ]);
  });

  test("an ascription gives an undetermined literal scrutinee a concrete type", () => {
    expect(projectDiagnostics(main(
      "export let a: String =\n" +
        "    match (0: Int)\n" +
        "        0 => \"zero\"\n" +
        "        _ => \"other\"\n",
    ))).toEqual([]);
  });

  test("the common unannotated spelling is §6.1's too, with #513's rider", () => {
    // `match 0` is the minimal case; this is the one a reader meets. Under the old
    // monomorphic-`Int` typing the literal arm silently fixed the parameter to
    // `Int` and the function compiled; §2.5 contributes constraints instead, the
    // parameter stays undetermined, and §6.1 refuses the match — with the rider
    // #513 wrote for exactly this scrutinee and which nothing in the repo pinned.
    // Pre-existing text, like the sentence in the test above, and pinned for the
    // same reason: this arc is what makes it reachable, not what wrote it.
    const rider = "cannot match on a value of abstract type `a`; the parameter's type " +
      "is not determined here; give the parameter a type — bind the function with " +
      "its own annotated `let`, or use it where its parameter type is known";
    expect(projectDiagnostics(main(
      "fun f(x) =\n" +
        "    match x\n" +
        "        0 => \"zero\"\n" +
        "        _ => \"other\"\n" +
        "export let a: String = f(1)\n",
    ))).toEqual([rider]);
    // Annotated, it compiles and runs at the annotation's type.
    expect(projectDiagnostics(main(
      "fun f(x: Nat): String =\n" +
        "    match x\n" +
        "        0 => \"zero\"\n" +
        "        _ => \"other\"\n" +
        "export let a: String = f(1)\n",
    ))).toEqual([]);
  });

  test("a declared variable takes the demands, and then the restriction", () => {
    // §2.5's order, at the one position a declared variable is reachable from: the
    // constraints are raised first — `Num` and `Eq`, which an undeclared signature
    // then reports as its own (Modules §4.1.1) — and the permitted-primitive check
    // follows them, because a declared variable is *resolved*: rigid by
    // declaration, and not one of the four.
    expect(projectDiagnostics(main(
      "export fun f(o: Option(a)): String =\n" +
        "    match o\n" +
        "        Some(0) => \"zero\"\n" +
        "        _ => \"other\"\n",
    ))).toEqual([
      // The list is alphabetical (Functions §5.1), rendered by
      // `advisedConstraintList`, so it is the very list the comparison advises
      // below — although this seat accepted `Eq` first and the comparison
      // accepted `Num` first. Accumulation order reaches nothing a reader pastes.
      "exported function `f` must declare every constraint in its signature; " +
      "write `<a: (Eq, Num)>`",
      "`0` is not a pattern at `a`; bind a name and test it in a guard: " +
      "`Some(y) when y == 0`",
    ]);
    // Declared, the signature's report goes and the restriction stands alone.
    expect(projectDiagnostics(main(
      "export fun f<a: (Num, Eq)>(o: Option(a)): String =\n" +
        "    match o\n" +
        "        Some(0) => \"zero\"\n" +
        "        _ => \"other\"\n",
    ))).toEqual([
      "`0` is not a pattern at `a`; bind a name and test it in a guard: " +
      "`Some(y) when y == 0`",
    ]);
    // The comparison at a declared variable, for contrast: it is no pattern, so
    // only the signature speaks.
    expect(projectDiagnostics(main("export fun f(x: a): Bool = x == 0\n"))).toEqual([
      "exported function `f` must declare every constraint in its signature; " +
      "write `<a: (Eq, Num)>`",
    ]);
    // The negative literal raises `Signed` besides, and `Signed` carries `Num`
    // (Constraints §7), so the base goes: a list naming both would be refused by
    // Modules §4.1.1's own "must omit base constraint `Num`" rule. Both spellings
    // of the program advise the same two.
    expect(projectDiagnostics(main(
      "export fun f(o: Option(a)): String =\n" +
        "    match o\n" +
        "        Some(-1) => \"one\"\n" +
        "        _ => \"other\"\n",
    ))).toEqual([
      "exported function `f` must declare every constraint in its signature; " +
      "write `<a: (Eq, Signed)>`",
      "`-1` is not a pattern at `a`; bind a name and test it in a guard: " +
      "`Some(y) when y == -1`",
    ]);
    expect(projectDiagnostics(main("export fun f(x: a): Bool = x == -1\n"))).toEqual([
      "exported function `f` must declare every constraint in its signature; " +
      "write `<a: (Eq, Signed)>`",
    ]);
    // And the advised binder is one the next compile accepts, at both spellings:
    // de-based, so §4.1.1's omit-the-base rule has nothing to say.
    expect(projectDiagnostics(main(
      "export fun f<a: (Eq, Signed)>(o: Option(a)): String =\n" +
        "    match o\n" +
        "        Some(-1) => \"one\"\n" +
        "        _ => \"other\"\n",
    ))).toEqual([
      "`-1` is not a pattern at `a`; bind a name and test it in a guard: " +
      "`Some(y) when y == -1`",
    ]);
    expect(projectDiagnostics(main("export fun f<a: (Eq, Signed)>(x: a): Bool = x == -1\n")))
      .toEqual([]);
  });

  test("the **binding** walk takes the same seat, not the old `Int` unification", () => {
    // §2.5 is one rule for both pattern walks, and the binding walk's literals are
    // reachable despite §5's refutability gate: the gate is a *second* report, and
    // the typing still happens. A `let`'s tuple component at `Float` drew "type
    // mismatch: expected Float, found Int" beside the gate before the ruling.
    expect(projectDiagnostics(main(
      "export let p: (Float, Int) = (1.5, 1)\n" +
        "\n" +
        "let (0, b) = p\n",
    ))).toEqual(["this pattern can fail: `(_, _)`; use `match`"]);
    // And a lambda parameter's literal is typed through `Num` rather than pinned to
    // `Int`, which is what the generalized signature reads back.
    expect(projectDiagnostics(main("export let f = (0) => 1\n"))).toEqual([
      "exported function `f` requires a complete signature; add type for " +
      "parameter `_` and a return type",
      "exported function `f` must declare every constraint in its signature; " +
      "write `<a: (Eq, Num)>`",
      "this pattern can fail: `_`; use `match` — for a match function, write " +
      "`match` with arms",
    ]);
  });
});

describe("coverage identity is the value, not the spelling (§7.2)", BUDGET, () => {
  test("the zeros are one `Float` literal, and so is an integer `0` at `Float`", () => {
    // §15 (k)'s second block, line for line.
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        0.0 => \"zero\"\n" +
        "        -0.0 => \"never\"\n" +
        "        0 => \"still never\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([DUPLICATE, DUPLICATE]);
  });

  test("spellings the lexer rounds to one double are one literal", () => {
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        1.0 => \"one\"\n" +
        "        1.00 => \"never\"\n" +
        "        1.0e0 => \"never\"\n" +
        "        10e-1 => \"never\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([DUPLICATE, DUPLICATE, DUPLICATE]);
    // Once per dead alternative, at the top of one arm (§7.2).
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        1.0 | 1.00 | 1.0e0 => \"one\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([DUPLICATE, DUPLICATE]);
  });

  test("underflow to zero is the literal `0.0`", () => {
    // The lexer's conversion governs (§2.5): `1.0e-400` underflows to `0.0`, so
    // the two arms cover the same values and the matrix says so.
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        1.0e-400 => \"tiny\"\n" +
        "        0.0 => \"never\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([DUPLICATE]);
  });

  test("the law reaches `Int` too: `007` is `7`, and `-0` is `0`", () => {
    // Both of these compiled clean before #894 — the matrix keyed on the
    // spelling, and Lexer §5 legalises the leading zeroes.
    expect(projectDiagnostics(main(
      "export fun f(count: Int): String =\n" +
        "    match count\n" +
        "        7 => \"seven\"\n" +
        "        007 => \"never\"\n" +
        "        0 => \"zero\"\n" +
        "        -0 => \"never\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([DUPLICATE, DUPLICATE]);
    // Separators are not part of the value either (§7.2's separator-free reading).
    expect(projectDiagnostics(main(
      "export fun f(count: Int): String =\n" +
        "    match count\n" +
        "        1_000 => \"a thousand\"\n" +
        "        1000 => \"never\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([DUPLICATE]);
  });

  test("and `Nat` and `BigInt`, whose arms #519's gate used to refuse outright", () => {
    for (const type of ["Nat", "BigInt"] as const) {
      expect(projectDiagnostics(main(
        `export fun f(n: ${type}): String =\n` +
          "    match n\n" +
          "        7 => \"seven\"\n" +
          "        007 => \"never\"\n" +
          "        _ => \"ok\"\n",
      ))).toEqual([DUPLICATE]);
    }
  });

  test("there is no key outside the primitives: no literal pattern stands there", () => {
    // §7.2 as the restriction leaves it — "at a type outside those primitives no
    // literal pattern stands, so the matrix never equates what it cannot
    // evaluate". Two `Rat` arms draw two refusals and no duplicate report: each
    // failed to type, and a broken pattern is never keyed and never a shadower
    // (§7.3's fourth tier).
    const refusal = "`0` is not a pattern at `Rat`; bind a name and test it in a " +
      "guard: `x when x == 0`";
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(r: Rat.Rat): String =\n" +
        "    match r\n" +
        "        0 => \"zero\"\n" +
        "        0 => \"never\"\n" +
        "        _ => \"ok\"\n",
    )).toEqual([refusal, refusal]);
  });

  test("the late restriction reaches §7.3 before coverage, like the eager one", () => {
    const refusal = "`0` is not a pattern at `Rat`; bind a name and test it in a " +
      "guard: `Some(y) when y == 0`";
    const arms =
      "        Some(0) => \"first\"\n" +
      "        Some(0) => \"second\"\n" +
      "        Some(r) => \"${Rat.toFloat(r)}\"\n" +
      "        _ => \"other\"\n";
    // Concrete at the first arm: both patterns are refused before the matrix.
    expect(projectDiagnostics(
      "module Main\n\nimport Rat\n\n" +
      "export fun eager(value: Option(Rat.Rat)): String =\n" +
      "    match value\n" + arms,
    )).toEqual([refusal, refusal]);
    // Undetermined at both literal arms, then fixed by the sibling. The deferred
    // verdict is still the matrix's input, so neither refusal is a shadower.
    expect(projectDiagnostics(
      "module Main\n\nimport Rat\n\n" +
      "export let late: String =\n" +
      "    match None\n" + arms,
    )).toEqual([refusal, refusal]);
  });

  test("each late literal receives the delegated failure that its eager twin does", () => {
    const failure = "integer literal cannot have type `String`";
    const arms =
      "        Some(0) => \"first\"\n" +
      "        Some(0) => \"second\"\n" +
      "        Some(\"s\") => \"text\"\n" +
      "        _ => \"other\"\n";
    expect(projectDiagnostics(main(
      "export fun eager(value: Option(String)): String =\n" +
      "    match value\n" + arms,
    ))).toEqual([failure, failure]);
    // Both occurrences share one inferred slot and therefore one evidence seat.
    // Diagnostics remain per failed pattern: evidence deduplication cannot erase
    // the second typing verdict or let that pattern shadow an arm below it.
    expect(projectDiagnostics(main(
      "export let late: String =\n" +
      "    match None\n" + arms,
    ))).toEqual([failure, failure]);
  });

  test("late per-literal validation does not repeat structural component failures", () => {
    const arms =
      "        Some(0) => \"first\"\n" +
      "        Some(0) => \"second\"\n" +
      "        Some([f]) => f(1)\n" +
      "        _ => \"other\"\n";
    const eager = projectDiagnostics(main(
      "export fun eager(value: Option(Vector((Int) -> String))): String =\n" +
      "    match value\n" + arms,
    ));
    const late = projectDiagnostics(main(
      "export let late: String =\n" +
      "    match None\n" + arms,
    ));
    expect(eager).toEqual([
      "functions have no `Eq` instance",
      "type `Vector((Int) -> String)` has no `Num` instance",
      "functions have no `Eq` instance",
      "type `Vector((Int) -> String)` has no `Num` instance",
    ]);
    // The inferred path may report before every nested display variable settles,
    // but it owes the same four failures: one `Eq` and one `Num` for each literal.
    // Revalidating the resident structural `Eq` would make this five.
    expect(late).toHaveLength(eager.length);
    expect(late.filter((message) => message.includes("`Eq`"))).toHaveLength(2);
    expect(late.filter((message) => message.includes("`Num`"))).toHaveLength(2);
  });

  test("deferred restrictions stay attached across eager and late matches", () => {
    const refusal = "`0` is not a pattern at `Rat`; bind a name and test it in a " +
      "guard: `Some(y) when y == 0`";
    expect(projectDiagnostics(
      "module Main\n\nimport Rat\n\n" +
      "export fun eager(value: Option(Rat.Rat)): String =\n" +
      "    match value\n" +
      "        Some(0) => \"zero\"\n" +
      "        _ => \"other\"\n" +
      "export let late: String =\n" +
      "    match None\n" +
      "        Some(0) => \"zero\"\n" +
      "        Some(r) => \"${Rat.toFloat(r)}\"\n" +
      "        _ => \"other\"\n",
    )).toEqual([refusal, refusal]);
  });

  test("a genuine catch-all still shadows a late-broken arm below it", () => {
    const refusal = "`0` is not a pattern at `Rat`; bind a name and test it in a " +
      "guard: `Some(y) when y == 0`";
    expect(projectDiagnostics(
      "module Main\n\nimport Rat\n\n" +
      "fun f(value): String =\n" +
      "    let first =\n" +
      "        match value\n" +
      "            _ => \"all\"\n" +
      "            Some(0) => \"broken\"\n" +
      "    match value\n" +
      "        Some(r) => \"${Rat.toFloat(r)}\"\n" +
      "        _ => first\n" +
      "export let answer: String = f(None)\n",
    )).toEqual([
      "this match arm is unreachable; an earlier pattern matches everything",
      refusal,
    ]);
  });

  test("a duplicate in a nested column names its one shadowing arm", () => {
    // §7.2 asks for the shadowing arm by name wherever naming one would be true,
    // and a nested duplicate is covered by one arm alone. The general sentence
    // stands where several arms cover it only jointly.
    expect(projectDiagnostics(main(
      "export fun f(p: (Float, Int)): String =\n" +
        "    match p\n" +
        "        (0.0, _) => \"zero\"\n" +
        "        (-0.0, _) => \"never\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual(["this case is unreachable; the arm `(0.0, _)` above already covers it"]);
    expect(projectDiagnostics(main(
      "export fun f(p: (Bool, Int)): String =\n" +
        "    match p\n" +
        "        (True, 0) => \"a\"\n" +
        "        (False, 0) => \"b\"\n" +
        "        (_, 0) => \"never\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual(["this case is unreachable; the patterns above already cover it"]);
  });

  test("a refused negative literal at `Nat` is keyed not at all (§7.2)", () => {
    // §7.2 names this exception in passing — `Nat`, "whose negative literals are
    // refused before any key is read". Two `-1` arms draw two `Signed` reports and
    // no duplicate report between them: each failed to type, and §7.3's fourth tier
    // keys neither and lets neither shadow.
    const closedPair = "type `Nat` has no `Signed` instance; its only legal homes " +
      "are the module declaring `Signed` and `Nat`'s prelude companion module, both " +
      "outside project source, so this pair's honored set is closed — change the " +
      "type, or go through the operations those homes export";
    expect(projectDiagnostics(main(
      "export fun f(n: Nat): String =\n" +
        "    match n\n" +
        "        -1 => \"a\"\n" +
        "        -1 => \"b\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([closedPair, closedPair]);
  });

  test("a guarded arm still establishes no coverage (§3, §7.1)", () => {
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        0.0 when t < 1.0 => \"guarded zero\"\n" +
        "        0.0 => \"zero\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([]);
  });
});

/**
 * §2.5's guard-validity rule, as James ruled it: "the term's type unifying with the
 * position's, and the `Eq` the comparison needs — and, for a negated spelling, the
 * `Signed` — in scope there; where it is not, the report stops at "`Float.nan` is a
 * value, not a pattern" and offers nothing, a fixit that would not compile being
 * worse than none".
 *
 * The three tests below it pin the report **and compile the guard each case offered
 * or withheld**, so the rule is checked rather than asserted. They are three rather
 * than one because every case compiles a whole project: one test of all of them ran
 * 1.2s alone and timed out under full-suite contention.
 *
 * `termArm` writes the refused spelling as an arm; `termGuard` writes the guard the
 * sentence would have offered, at the top of an arm where that is what it spells.
 */
const termArm = (
  scrutinee: string,
  type: string,
  pattern: string,
  imports: string,
): string =>
  `module Main\n\n${imports}\n` +
  `export fun f(${scrutinee}: ${type}): String =\n` +
  `    match ${scrutinee}\n` +
  `        ${pattern} => "n"\n` +
  "        _ => \"ok\"\n";

const termGuard = (
  scrutinee: string,
  type: string,
  spelling: string,
  imports: string,
): string =>
  `module Main\n\n${imports}\n` +
  `export fun f(${scrutinee}: ${type}): String =\n` +
  `    match ${scrutinee}\n` +
  `        x when x == ${spelling} => "n"\n` +
  "        _ => \"ok\"\n";

describe("a term's spelling in pattern position (§2.5, §12)", BUDGET, () => {
  test("`Float.nan` draws one report, with the guard as its rewrite", () => {
    // Measured before #894: four errors — "`Float` has no constructor `Float`",
    // "expected `=>` after match pattern or guard", "expected an expression,
    // found `.`", and an unreachable-arm report riding beside them.
    expect(projectDiagnostics("module Main\n\nimport Float\n\n" +
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        Float.nan => \"not a number\"\n" +
        "        _ => \"ok\"\n",
    )).toEqual([
      "`Float.nan` is a value, not a pattern; bind a name and test it in a " +
      "guard: `x when x == Float.nan`",
    ]);
  });

  test("the sign rides the sentence: `-Float.infinity`", () => {
    expect(projectDiagnostics("module Main\n\nimport Float\n\n" +
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        -Float.infinity => \"cold\"\n" +
        "        _ => \"ok\"\n",
    )).toEqual([
      "`-Float.infinity` is a value, not a pattern; bind a name and test it in " +
      "a guard: `x when x == -Float.infinity`",
    ]);
  });

  test("the sentence is general, not `Float`'s", () => {
    // §2.5 states the refusal for any qualified spelling whose last segment names
    // a term — `Helper.zero` is its own example — so a user module's constant takes
    // it as readily as the prelude's.
    expect(diagnostics([HELPER, [
      "/main.hex",
      "module Main\n\nimport Helper\n\n" +
      "export fun f(n: Nat): String =\n" +
        "    match n\n" +
        "        Helper.zero => \"zero\"\n" +
        "        _ => \"ok\"\n",
    ]])).toEqual([
      "`Helper.zero` is a value, not a pattern; bind a name and test it in a " +
      "guard: `x when x == Helper.zero`",
    ]);
  });

  test("the guard is offered where the `Eq` (and the `Signed`) is in scope", () => {
    // Offered. `Eq<Float>` and `Signed<Float>` are both in scope, and the term is
    // a `Float` — and each guard compiles clean.
    for (const spelling of ["Float.nan", "-Float.infinity"]) {
      expect(projectDiagnostics(termArm("t", "Float", spelling, "import Float\n")))
        .toEqual([
          `\`${spelling}\` is a value, not a pattern; bind a name and test it in ` +
          `a guard: \`x when x == ${spelling}\``,
        ]);
      expect(projectDiagnostics(termGuard("t", "Float", spelling, "import Float\n")))
        .toEqual([]);
    }
    // Offered at a union that derives `Eq`, withheld at the same union without one
    // — the one difference between the two modules.
    expect(diagnostics([HUE_EQ, [
      "/main.hex",
      termArm("h", "HueEq.Hue", "HueEq.first", "import HueEq\n"),
    ]])).toEqual([
      "`HueEq.first` is a value, not a pattern; bind a name and test it in a " +
      "guard: `x when x == HueEq.first`",
    ]);
    expect(diagnostics([HUE_EQ, [
      "/main.hex",
      termGuard("h", "HueEq.Hue", "HueEq.first", "import HueEq\n"),
    ]])).toEqual([]);
    expect(diagnostics([HUE, [
      "/main.hex",
      termArm("h", "Hue.Hue", "Hue.first", "import Hue\n"),
    ]])).toEqual(["`Hue.first` is a value, not a pattern"]);
    expect(diagnostics([HUE, [
      "/main.hex",
      termGuard("h", "Hue.Hue", "Hue.first", "import Hue\n"),
    ]])).toEqual([
      "type `Hue` has no `Eq` instance; it could only be declared in module `Hue` " +
      "(declares `Hue`) or the module declaring `Eq`; add `derives Eq` to the " +
      "declaration of `Hue`",
    ]);
  });

  test("and withheld where the `Signed`, or the unification, fails", () => {
    // The `Signed` half: `Eq<Nat>` is in scope, `Signed<Nat>` is not, and only the
    // negated spelling is refused its guard.
    expect(diagnostics([HELPER, [
      "/main.hex",
      termArm("n", "Nat", "-Helper.zero", "import Helper\n"),
    ]])).toEqual(["`-Helper.zero` is a value, not a pattern"]);
    expect(diagnostics([HELPER, [
      "/main.hex",
      termGuard("n", "Nat", "-Helper.zero", "import Helper\n"),
    ]])).toEqual([
      "type `Nat` has no `Signed` instance; its only legal homes are the module " +
      "declaring `Signed` and `Nat`'s prelude companion module, both outside " +
      "project source, so this pair's honored set is closed — change the type, or " +
      "go through the operations those homes export; a written `Int` face runs the " +
      "operation and admits the result (`let difference: Int = …`)",
    ]);
    // The unification half: `Eq<String>` is in scope and the term is an `Int`.
    expect(diagnostics([HELPER, [
      "/main.hex",
      termArm("s", "String", "Helper.count", "import Helper\n"),
    ]])).toEqual(["`Helper.count` is a value, not a pattern"]);
    expect(diagnostics([HELPER, [
      "/main.hex",
      termGuard("s", "String", "Helper.count", "import Helper\n"),
    ]])).toEqual(["type mismatch: expected Int, found String"]);
    // A function-typed term: no `Eq` at a function, and no unification either.
    expect(diagnostics([HELPER, [
      "/main.hex",
      termArm("i", "Int", "Helper.go", "import Helper\n"),
    ]])).toEqual(["`Helper.go` is a value, not a pattern"]);
  });

  test("and withheld at a `catch` arm, and for a spelling with no term symbol", () => {
    // A `catch` arm's position is `Exn`, which no term is.
    expect(diagnostics([HELPER, [
      "/main.hex",
      "module Main\n\nimport Helper\n\n" +
      "export fun f(): Int =\n" +
        "    match Helper.go(1)\n" +
        "        x => x\n" +
        "    catch\n" +
        "        Helper.count => 0\n" +
        "        _ => 1\n",
    ]])).toEqual(["`Helper.count` is a value, not a pattern"]);
    // A spelling that resolved through an honored member carries no term symbol,
    // and the guard is withheld — rightly: `Rat.fromInt` is a function.
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      termArm("i", "Int", "Rat.fromInt", "").slice("module Main\n\n\n".length),
    )).toEqual(["`Rat.fromInt` is a value, not a pattern"]);
  });

  test("the guard is spelled at the position, not at the scrutinee", () => {
    // §2.5: "The same holds of every guard this section names as a rewrite." The
    // value sentence's rewrite goes through the one function the restriction's uses,
    // so beneath the top of an arm the enclosing pattern keeps its shape with a
    // binder where the spelling stood — and the condition reads the *position's*
    // type, which is the type the offer was gated on. Spelled `x when x == …`
    // regardless, every one of these offered a guard that draws "type mismatch:
    // expected Int, found Option(Int)" and its siblings.
    const nested: readonly (readonly [string, string, string, string])[] = [
      ["o", "Option(Int)", "Some(Helper.count)", "Some(y)"],
      ["p", "(Int, Int)", "(Helper.count, _)", "(y, _)"],
      ["r", "{x: Int}", "{x = Helper.count}", "{x = y}"],
      ["v", "Vector(Int)", "[Helper.count, _]", "[y, _]"],
      ["o", "Option(Option(Int))", "Some(Some(Helper.count))", "Some(Some(y))"],
      ["i", "Int", "Helper.count as z", "y as z"],
    ];
    for (const [subject, type, pattern, rewrite] of nested) {
      const program = (arm: string): readonly [string, string] => [
        "/main.hex",
        "module Main\n\nimport Helper\n\n" +
        `export fun f(${subject}: ${type}): String =\n` +
        `    match ${subject}\n` +
        `        ${arm} => "n"\n` +
        "        _ => \"ok\"\n",
      ];
      expect(diagnostics([HELPER, program(pattern)])).toEqual([
        "`Helper.count` is a value, not a pattern; bind a name and test it in a " +
        `guard: \`${rewrite} when y == Helper.count\``,
      ]);
      // The offered rewrite compiles, which is the whole claim.
      expect(diagnostics([HELPER, program(`${rewrite} when y == Helper.count`)]))
        .toEqual([]);
    }
    // Inside an or-alternative there is none: swapping the spelling alone drops the
    // other alternatives, which is a different program rather than a repair (§2.6).
    for (const [subject, type, pattern] of [
      ["i", "Int", "Helper.count | 1"],
      ["o", "Option(Int)", "Some(Helper.count) | None"],
    ] as const) {
      expect(diagnostics([HELPER, [
        "/main.hex",
        "module Main\n\nimport Helper\n\n" +
        `export fun f(${subject}: ${type}): String =\n` +
        `    match ${subject}\n` +
        `        ${pattern} => "n"\n` +
        "        _ => \"ok\"\n",
      ]])).toEqual(["`Helper.count` is a value, not a pattern"]);
    }
  });

  test("a second broken node in the pattern withholds the rewrite", () => {
    // §2.5 replaces **the refused node** and nothing else. A second broken node has
    // no spelling to print — an unresolved qualifier, a term's spelling, a literal
    // the lexer refused — and printing `_` for it offered a rewrite that *compiles*
    // while deleting a test the reader wrote, and with it that test's own report.
    // Withheld instead, at both sentences.
    const rat = (body: string): string => "module Main\n\nimport Rat\n\n" + body;
    expect(projectDiagnostics(rat(
      "export fun f(p: (Rat.Rat, Int)): String =\n" +
        "    match p\n" +
        "        (0, Nowhere.zilch) => \"z\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual(["`0` is not a pattern at `Rat`", "no module alias `Nowhere`"]);
    expect(projectDiagnostics(rat(
      "export fun f(p: (Rat.Rat, Float)): String =\n" +
        "    match p\n" +
        "        (0, 1.0e309) => \"z\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([
      "`0` is not a pattern at `Rat`",
      "Float literal is too large; use `Float.infinity`",
    ]);
    // Two term spellings beside each other: each is the other's second broken node.
    expect(diagnostics([HELPER, [
      "/main.hex",
      "module Main\n\nimport Helper\n\n" +
      "export fun f(p: (Int, String)): String =\n" +
        "    match p\n" +
        "        (Helper.count, Helper.text) => \"z\"\n" +
        "        _ => \"ok\"\n",
    ]])).toEqual([
      "`Helper.count` is a value, not a pattern",
      "`Helper.text` is a value, not a pattern",
    ]);
    // The controls, which are what make the rule `Error` nodes alone: a sibling
    // *literal* is printed as written, and a wildcard sibling is no obstacle.
    expect(projectDiagnostics(rat(
      "export fun f(p: (Rat.Rat, Rat.Rat)): String =\n" +
        "    match p\n" +
        "        (0, 1) => \"z\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([
      "`0` is not a pattern at `Rat`; bind a name and test it in a guard: " +
      "`(y, 1) when y == 0`",
      "`1` is not a pattern at `Rat`; bind a name and test it in a guard: " +
      "`(0, y) when y == 1`",
    ]);
    expect(diagnostics([HELPER, [
      "/main.hex",
      "module Main\n\nimport Helper\n\n" +
      "export fun f(p: (Int, String)): String =\n" +
        "    match p\n" +
        "        (Helper.count, _) => \"z\"\n" +
        "        _ => \"ok\"\n",
    ]])).toEqual([
      "`Helper.count` is a value, not a pattern; bind a name and test it in a " +
      "guard: `(y, _) when y == Helper.count`",
    ]);
  });

  test("an arm that already has a guard is offered no rewrite", () => {
    // §2.5 puts the test "in the arm's guard (§3)", and what the rewrite renders is
    // the whole arm head — pattern *plus* `when …`. At an arm that already carries
    // one, pasting it *replaces* that guard: `(0, k) when k > 5` was offered
    // `(y, k) when y == 0`, which compiles and then fires for every `k`, and where
    // the existing guard was itself refused it took that report with it. Joining the
    // two is what §2.5 licenses and what this seat has no printer for, so the
    // rewrite is withheld — the one safe direction, the wrong rewrite compiling.
    const rat = (body: string): string => "module Main\n\nimport Rat\n\n" + body;
    const tuple = (arm: string): string => rat(
      "export fun f(p: (Rat.Rat, Int)): String =\n" +
        "    match p\n" +
        `        ${arm} => "z"\n` +
        "        _ => \"ok\"\n",
    );
    expect(projectDiagnostics(tuple("(0, k) when k > 5")))
      .toEqual(["`0` is not a pattern at `Rat`"]);
    // At the top of an arm too: `x when x == 0` replaces a guard just as readily.
    expect(projectDiagnostics(rat(
      "export fun f(r: Rat.Rat, g: Bool): String =\n" +
        "    match r\n" +
        "        0 when g => \"z\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual(["`0` is not a pattern at `Rat`"]);
    // And at the value sentence, which renders through the same path.
    expect(diagnostics([HELPER, [
      "/main.hex",
      "module Main\n\nimport Helper\n\n" +
      "export fun f(p: (Int, Int)): String =\n" +
        "    match p\n" +
        "        (Helper.count, k) when k > 5 => \"z\"\n" +
        "        _ => \"ok\"\n",
    ]])).toEqual(["`Helper.count` is a value, not a pattern"]);
    // The row that is round 3's finding reached through the guard: the replaced
    // guard was itself refused, so the rewrite deleted a report.
    expect(projectDiagnostics(tuple("(0, k) when k == Nowhere.zilch")))
      .toEqual(["`0` is not a pattern at `Rat`", "no module alias `Nowhere`"]);
    // The controls: the unguarded twins still offer their rewrites, and the flag is
    // the arm's own — a *later* guarded arm leaves an earlier one's offer standing.
    expect(projectDiagnostics(tuple("(0, k)"))).toEqual([
      "`0` is not a pattern at `Rat`; bind a name and test it in a guard: " +
      "`(y, k) when y == 0`",
    ]);
    expect(diagnostics([HELPER, [
      "/main.hex",
      "module Main\n\nimport Helper\n\n" +
      "export fun f(p: (Int, Int)): String =\n" +
        "    match p\n" +
        "        (Helper.count, k) => \"z\"\n" +
        "        _ => \"ok\"\n",
    ]])).toEqual([
      "`Helper.count` is a value, not a pattern; bind a name and test it in a " +
      "guard: `(y, k) when y == Helper.count`",
    ]);
    expect(projectDiagnostics(rat(
      "export fun f(p: (Rat.Rat, Int)): String =\n" +
        "    match p\n" +
        "        (0, k) => \"z\"\n" +
        "        (1, k) when k > 5 => \"y\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([
      "`0` is not a pattern at `Rat`; bind a name and test it in a guard: " +
      "`(y, k) when y == 0`",
      "`1` is not a pattern at `Rat`",
    ]);
    // And in the other order, which is what says the flag is restored rather than
    // latched: a guarded arm above leaves the unguarded arm below it its rewrite.
    expect(projectDiagnostics(rat(
      "export fun f(p: (Rat.Rat, Int)): String =\n" +
        "    match p\n" +
        "        (1, k) when k > 5 => \"y\"\n" +
        "        (0, k) => \"z\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([
      "`1` is not a pattern at `Rat`",
      "`0` is not a pattern at `Rat`; bind a name and test it in a guard: " +
      "`(y, k) when y == 0`",
    ]);
    // The **late** judgment takes the same three facts: a position undetermined when
    // the literal was checked is judged after inference, and the arm's guard is read
    // from the record rather than from the checker, which has moved on. The sibling
    // arm is what resolves the position, to a `Rat` the restriction then refuses.
    const late = (arm: string, sibling: string): string =>
      "module Main\n\nimport Rat\n\n" +
      "export fun f(g: Bool): String =\n" +
        "    match None\n" +
        `        ${arm} => "z"\n` +
        `        ${sibling}\n` +
        "        _ => \"o\"\n";
    expect(projectDiagnostics(late("Some(0)", "Some(y) => \"${Rat.toFloat(y)}\"")))
      .toEqual([
        "`0` is not a pattern at `Rat`; bind a name and test it in a guard: " +
        "`Some(y) when y == 0`",
      ]);
    expect(projectDiagnostics(late("Some(0) when g", "Some(y) => \"${Rat.toFloat(y)}\"")))
      .toEqual(["`0` is not a pattern at `Rat`"]);
  });

  test("the late judgment takes §2.5's two phases in order too", () => {
    // §12's row, unconditionally: "the constraint fails before the restriction is
    // reached", and §2.5's refusal is for a type "honoring `Num` and `Eq`" outside the
    // four, "the constraints satisfied and the check after them". At a position
    // already resolved that order is free — a failed demand reports inside `#require`
    // and the seat returns — but a position still undetermined defers its demands, and
    // they fail later, at the unification that resolved it. Each of these drew the
    // delegated report *and* a restriction refusal whose fixit could not clear it.
    const late = (sibling: string, declaration = ""): string =>
      "module Main\n\n" + declaration +
      "export let a: String =\n" +
        "    match None\n" +
        "        Some(0) => \"z\"\n" +
        `        ${sibling} => "y"\n` +
        "        _ => \"o\"\n";
    expect(projectDiagnostics(late("Some({x = _})")))
      .toEqual(["type `{x: a, ...}` has no `Num` instance"]);
    expect(projectDiagnostics(late("Some(\"s\")")))
      .toEqual(["integer literal cannot have type `String`"]);
    expect(projectDiagnostics(late("Some((_, _))")))
      .toEqual(["type `(a, b)` has no `Num` instance"]);
    // A union honoring neither draws one report per unmet constraint — two — and no
    // refusal beside them, which is §12's "one per unmet constraint" exactly.
    expect(projectDiagnostics(late("Some(Red)", "union Hue = Red | Green\n\n"))).toEqual([
      "type `Hue` has no `Eq` instance; it could only be declared in module `Main` " +
      "(declares `Hue`) or the module declaring `Eq`; add `derives Eq` to the " +
      "declaration of `Hue`",
      "integer literal cannot have type `Hue`",
    ]);
    // And the eager path, which was always right and is the gate's control: the same
    // order, at a position the literal's own check resolved.
    expect(projectDiagnostics(
      "module Main\n\nexport fun f(s: String): String =\n" +
        "    match s\n        0 => \"z\"\n        _ => \"o\"\n",
    )).toEqual(["integer literal cannot have type `String`"]);
  });

  test("each of the three demands gates the restriction, and only when unmet", () => {
    // A hand-written `Num` is what separates the gate's three conjuncts, because no
    // prelude type does: `Nat` is the only one honoring `Num` and `Eq` without
    // `Signed`, and it is a permitted primitive, which returns above the gate. So the
    // subject is a record honoring `Num` by hand — which is also §2.5's own example
    // for the restriction, "a user's `Money` honoring both".
    const tally = (derives: string, arm: string): string =>
      "module Main\n\n" +
      `record Tally${derives} = {count: Int}\n` +
      "honor Num<Tally> =\n" +
      "    add(l, r) = Tally({count = l.count + r.count})\n" +
      "    multiply(l, r) = Tally({count = l.count * r.count})\n" +
      "    fromNat(n) = Tally({count = Int.fromNat(n)})\n" +
      "\n" +
      "export let a: String =\n" +
        "    match None\n" +
        `        Some(${arm}) => "z"\n` +
        "        Some(Tally({count = _})) => \"y\"\n" +
        "        _ => \"o\"\n";
    // `Eq` unmet: the delegated report alone.
    expect(projectDiagnostics(tally("", "0"))).toEqual([
      "type `Tally` has no `Eq` instance; it could only be declared in module `Main` " +
      "(declares `Tally`) or the module declaring `Eq`; add `derives Eq` to the " +
      "declaration of `Tally`",
    ]);
    // `Signed` unmet, which only a negative literal demands: likewise.
    expect(projectDiagnostics(tally(" derives Eq", "-1"))).toEqual([
      "type `Tally` has no `Signed` instance; it could only be declared in module " +
      "`Main` (declares `Tally`) or the module declaring `Signed`",
    ]);
    // And the control that makes the gate a *condition* rather than a blanket skip:
    // all three demands met at the same type, and the restriction fires with its
    // guard — §2.5's "a user's `Money` honoring both … refused at the literal".
    expect(projectDiagnostics(tally(" derives Eq", "0"))).toEqual([
      "`0` is not a pattern at `Tally`; bind a name and test it in a guard: " +
      "`Some(y) when y == 0`",
    ]);
  });

  test("structural and built-in collection equality offer the guard", () => {
    const cases = [
      ["(Int, Int)", "Helper.pair"],
      ["{x: Int}", "Helper.origin"],
      ["Vector(Int)", "Helper.many"],
    ] as const;
    for (const [type, spelling] of cases) {
      expect(diagnostics([HELPER, [
        "/main.hex",
        termArm("value", type, spelling, "import Helper\n"),
      ]])).toEqual([
        `\`${spelling}\` is a value, not a pattern; bind a name and test it in ` +
        `a guard: \`x when x == ${spelling}\``,
      ]);
      expect(diagnostics([HELPER, [
        "/main.hex",
        termGuard("value", type, spelling, "import Helper\n"),
      ]])).toEqual([]);
    }
  });

  test("a polymorphic term is proved without changing inference state", () => {
    const source = "module Main\n\nimport Helper\n\n" +
      "export fun ints(o: Option(Int)): String =\n" +
        "    match o\n" +
        "        Helper.nothing => \"z\"\n" +
        "        _ => \"ok\"\n\n" +
      "export fun strings(o: Option(String)): String =\n" +
        "    match o\n" +
        "        Helper.nothing => \"z\"\n" +
        "        _ => \"ok\"\n\n" +
      "export fun nested(o: Option(Option(Int))): String =\n" +
        "    match o\n" +
        "        Helper.nothing => \"z\"\n" +
        "        _ => \"ok\"\n\n" +
      "export fun intVectors(v: Vector(Int)): String =\n" +
        "    match v\n" +
        "        Helper.empty => \"z\"\n" +
        "        _ => \"ok\"\n\n" +
      "export fun stringVectors(v: Vector(String)): String =\n" +
        "    match v\n" +
        "        Helper.empty => \"z\"\n" +
        "        _ => \"ok\"\n";
    expect(diagnostics([HELPER, ["/main.hex", source]])).toEqual([
      "`Helper.nothing` is a value, not a pattern; bind a name and test it in a " +
      "guard: `x when x == Helper.nothing`",
      "`Helper.nothing` is a value, not a pattern; bind a name and test it in a " +
      "guard: `x when x == Helper.nothing`",
      "`Helper.nothing` is a value, not a pattern; bind a name and test it in a " +
      "guard: `x when x == Helper.nothing`",
      "`Helper.empty` is a value, not a pattern; bind a name and test it in a " +
      "guard: `x when x == Helper.empty`",
      "`Helper.empty` is a value, not a pattern; bind a name and test it in a " +
      "guard: `x when x == Helper.empty`",
    ]);
    // Each offered replacement compiles, and the first proof has neither bound the
    // shared scheme variable to `Int` nor minted state observed by the second use.
    expect(diagnostics([HELPER, [
      "/main.hex",
      source
        .replaceAll("Helper.nothing =>", "x when x == Helper.nothing =>")
        .replaceAll("Helper.empty =>", "x when x == Helper.empty =>"),
    ]])).toEqual([]);
  });

  test("the read-only proof withholds guards whose comparison would fail", () => {
    const helper: readonly [string, string] = [
      "/helper.hex",
      HELPER[1] +
      "export let split<a>: (Option(a), Option(a)) = (None, None)\n",
    ];
    const cases = [
      ["(Helper.Blob, Helper.Blob)", "Helper.blobPair"],
      ["{x: Helper.Blob}", "Helper.blobRecord"],
      ["Vector(Helper.Blob)", "Helper.blobs"],
    ] as const;
    for (const [type, spelling] of cases) {
      expect(diagnostics([helper, [
        "/main.hex",
        termArm("value", type, spelling, "import Helper\n"),
      ]])).toEqual([`\`${spelling}\` is a value, not a pattern`]);
      expect(diagnostics([helper, [
        "/main.hex",
        termGuard("value", type, spelling, "import Helper\n"),
      ]])).toContain(
        "type `Blob` has no `Eq` instance; it could only be declared in module " +
        "`Helper` (declares `Blob`) or the module declaring `Eq`; add `derives Eq` " +
        "to the declaration of `Blob`",
      );
    }
    // One quantified variable appears twice: one speculative substitution map must
    // reject two different concrete arguments even though the position has `Eq`.
    expect(diagnostics([helper, [
      "/main.hex",
      termArm(
        "value",
        "(Option(Int), Option(String))",
        "Helper.split",
        "import Helper\n",
      ),
    ]])).toEqual(["`Helper.split` is a value, not a pattern"]);
    // The `Eq<Option>` head exists, but its parameter obligation does not: merely
    // finding the instance is not enough to offer a comparison that still fails.
    expect(diagnostics([helper, [
      "/main.hex",
      termArm("value", "Option(Helper.Blob)", "Helper.nothing", "import Helper\n"),
    ]])).toEqual(["`Helper.nothing` is a value, not a pattern"]);
    expect(diagnostics([helper, [
      "/main.hex",
      termGuard("value", "Option(Helper.Blob)", "Helper.nothing", "import Helper\n"),
    ]])).toContain(
      "type `Blob` has no `Eq` instance; it could only be declared in module " +
      "`Helper` (declares `Blob`) or the module declaring `Eq`; add `derives Eq` " +
      "to the declaration of `Blob`",
    );
  });

  test("and only where a guard may be written at all (§3)", () => {
    // §3: "guards are only legal on `match` and `catch` arms". At a `let`, a
    // `for..in` head, or a parameter there is no guard to put the test in, so the
    // sentence stops — the same rule as above, about the position rather than the
    // types. The refusal itself still fires at every seat.
    const seats = [
      "export fun f(): Int =\n    let Helper.count = 1\n    2\n",
      "export fun f(v: Vector(Int)): Int =\n" +
        "    for Helper.count in v\n        ignore(1)\n    1\n",
      "export fun f(Helper.count: Int): Int = 1\n",
    ];
    for (const seat of seats) {
      expect(diagnostics([HELPER, [
        "/main.hex",
        "module Main\n\nimport Helper\n\n" + seat,
      ]])).toContain("`Helper.count` is a value, not a pattern");
      expect(diagnostics([HELPER, [
        "/main.hex",
        "module Main\n\nimport Helper\n\n" + seat,
      ]])).not.toContain(
        "`Helper.count` is a value, not a pattern; bind a name and test it in a " +
        "guard: `x when x == Helper.count`",
      );
    }
    // The **restriction's** rewrite is the same guard and takes the same rule: a
    // `for..in` head and a parameter draw the refusal bare.
    const refusal = "`0` is not a pattern at `Rat`";
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(v: Vector(Rat.Rat)): Int =\n" +
        "    for 0 in v\n        ignore(1)\n    1\n",
    )).toEqual([refusal]);
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(0: Rat.Rat): Int = 1\n",
    )).toEqual([refusal]);
  });

  test("a name the module exports nothing for takes the expression-position report", () => {
    // A rewrite is never offered for a value that does not exist (§2.5).
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        Rat.zilch => \"never\"\n" +
        "        _ => \"ok\"\n",
    )).toEqual(["module `Rat` does not export `zilch`"]);
  });

  test("an unbound qualifier is Modules §5.1 rule 1's report, before any of these", () => {
    // §12's row: rule 1's report leads, carrying its repair where `import Rat`
    // would resolve — the spelling names a real module here, just an unimported
    // one, and the selection above is never reached.
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        Rat.zilch => \"never\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual(["no module alias `Rat`; `import Rat`"]);
    // And without a module of the name, the same report with no repair invented.
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        Nowhere.zilch => \"never\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual(["no module alias `Nowhere`"]);
  });

  test("no cascade: the refused arm is read as `_` and shadows nothing", () => {
    // §7.3's fourth tier, for a pattern that failed to parse. Before #894 the
    // arm was dropped, which made the `match` non-exhaustive and drew a *second*
    // report about the hole the drop had left — and a refused arm above good ones
    // drew "this match arm is unreachable; an earlier pattern matches everything".
    expect(projectDiagnostics("module Main\n\nimport Float\n\n" +
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        Float.nan => \"nan\"\n" +
        "        0.0 => \"zero\"\n" +
        "        _ => \"ok\"\n",
    )).toEqual([
      "`Float.nan` is a value, not a pattern; bind a name and test it in a " +
      "guard: `x when x == Float.nan`",
    ]);
    // And the control: a genuine catch-all above still shadows the arm below it.
    expect(projectDiagnostics("module Main\n\nimport Float\n\n" +
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        x => \"anything\"\n" +
        "        Float.nan => \"nan\"\n",
    )).toEqual([
      "`Float.nan` is a value, not a pattern; bind a name and test it in a " +
      "guard: `x when x == Float.nan`",
      "this match arm is unreachable; an earlier pattern matches everything",
    ]);
  });

  test("the named special values are tested in guards, which SameValueZero makes work", async () => {
    // §2.5's complete example, run on all four inputs and on `-0.0`.
    const exports = await runMain("module Main\n\nimport Float\n\n" +
      "export fun describe(value: Float): String =\n" +
        "    match value\n" +
        "        x when x == Float.nan => \"not a number\"\n" +
        "        x when x == Float.infinity => \"positive infinity\"\n" +
        "        x when x == -Float.infinity => \"negative infinity\"\n" +
        "        _ => \"finite\"\n" +
        "export let a: String = describe(Float.nan)\n" +
        "export let b: String = describe(Float.infinity)\n" +
        "export let c: String = describe(-Float.infinity)\n" +
        "export let d: String = describe(1.5)\n" +
        "export let e: String = describe(-0.0)\n",
    );
    expect([
      exports["a"],
      exports["b"],
      exports["c"],
      exports["d"],
      exports["e"],
    ]).toEqual([
      "not a number",
      "positive infinity",
      "negative infinity",
      "finite",
      "finite",
    ]);
  });
});

describe("the lexer's conversion governs (§2.5, §12; Lexer §5)", BUDGET, () => {
  test("`1.0e308` is a legal pattern", () => {
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        1.0e308 => \"huge\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([]);
  });

  test("`1.0e309` draws the lexer's report, and nothing else anywhere", () => {
    // §2.5: "a construct the lexer has already diagnosed draws no further report
    // from the pattern seat". Before #894 the seat added "expected a binding,
    // `_`, constructor, tuple, or record pattern" and the match added "match is
    // missing cases: `_`"; the layout pass then added two more, because the lexer
    // **dropped** the token and the arm block's shape was computed from whatever
    // followed. Lexer §9's recovery form ends all of it: one report, at every seat.
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        1.0e309 => \"hot\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual(["Float literal is too large; use `Float.infinity`"]);
    // The sign rides the same stand-down.
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        -1.0e309 => \"cold\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual(["Float literal is too large; use `Float.infinity`"]);
    // And in expression position, where the same two layout reports followed it.
    expect(projectDiagnostics(main("export let big: Float = 1.0e309\n")))
      .toEqual(["Float literal is too large; use `Float.infinity`"]);
  });

  test("the recovery form is no literal in **expression** position either", () => {
    // Lexer §9's "never part of the public successful token inventory" binds both
    // seats that read a `Float` token. Admitting it emitted the `Infinity` the
    // conversion produced — `let x: Float = 1.0e309` emitted `1.0e309` — which
    // nothing ships today only because a failed compile's text has no consumer.
    const project = compileMain(main("export let x: Float = 1.0e309\n"));
    expect(project.diagnostics.map(({ message }) => message))
      .toEqual(["Float literal is too large; use `Float.infinity`"]);
    const text = project.modules
      .find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(text).not.toContain("1.0e309");
    expect(text).not.toContain("Infinity");
  });

  test("the recovery form is no literal: it keys nothing and is never a shadower", () => {
    // The token is handed on so the parse continues, and the pattern seat reads it
    // as the error it is rather than as the `Infinity` literal `Number` computed.
    // §7.3's fourth tier then grants the broken arm **maximal** cover — coverage
    // reads it as `_` — which is why an overflow arm standing alone over an infinite
    // domain draws no missing-cases report, and why its emitted test is `if (true)`
    // —
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        1.0e309 => \"a\"\n",
    ))).toEqual(["Float literal is too large; use `Float.infinity`"]);
    // — with or without the sign, which the negative seat reads the same way.
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        -1.0e309 => \"a\"\n",
    ))).toEqual(["Float literal is too large; use `Float.infinity`"]);
    // — and it is never a shadower: two of them draw two lexical reports and no
    // duplicate-literal report between them.
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        1.0e309 => \"a\"\n" +
        "        1.0e309 => \"b\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([
      "Float literal is too large; use `Float.infinity`",
      "Float literal is too large; use `Float.infinity`",
    ]);
  });

  test("§15 (k)'s last block, as one program", () => {
    // The golden block, which the dropped token used to swallow: its overflow arm
    // collapsed the `match` and the two arms below it were never parsed, so two of
    // its three expected reports were absent. All three, in source order.
    expect(projectDiagnostics("module Main\n\nimport Float\n\n" +
      "export fun f(temp: Float): String =\n" +
        "    match temp\n" +
        "        1.0e309 => \"hot\"\n" +
        "        Float.nan => \"not a number\"\n" +
        "        -Float.infinity => \"cold\"\n" +
        "        _ => \"ok\"\n",
    )).toEqual([
      "Float literal is too large; use `Float.infinity`",
      "`Float.nan` is a value, not a pattern; bind a name and test it in a guard: " +
      "`x when x == Float.nan`",
      "`-Float.infinity` is a value, not a pattern; bind a name and test it in a " +
      "guard: `x when x == -Float.infinity`",
    ]);
  });

  test("the same stand-down covers an oversize **integer** literal", () => {
    // The `Nat`/`BigInt` gate's lift makes this program reachable, and the seat's
    // rule is the same one: the lexer has diagnosed it, so the pattern adds nothing.
    // #898 retains the token so the arm below survives intact. The append-`n`
    // repair is offered only at the `BigInt` seat, where it compiles.
    for (const type of ["BigInt", "Int"] as const) {
      const diagnostics = projectDiagnostics(main(
        `export fun f(n: ${type}): String =\n` +
          "    match n\n" +
          "        9007199254740993 => \"big\"\n" +
          "        _ => \"ok\"\n",
      ));
      expect(diagnostics[0]).toBe(type === "BigInt"
        ? "integer literal exceeds Int range; add `n` for a BigInt"
        : "integer literal exceeds Int range");
      expect(diagnostics).not.toContain(
        "expected a binding, `_`, constructor, tuple, or record pattern",
      );
      expect(diagnostics).not.toContain("match is missing cases: `_`");
      expect(diagnostics.slice(1)).toEqual([]);
    }
  });
});

describe("the emitted integer literal is canonical (#897)", BUDGET, () => {
  test("a pattern's `007` emits `7`, not a legacy octal literal", () => {
    // `if (__match === 007)` is what this emitted before: strict-mode code — every
    // ES module — refuses a legacy octal literal with a SyntaxError, so the module
    // never loaded.
    const text = emitted(
      "export fun f(n: Int): String =\n" +
        "    match n\n" +
        "        007 => \"seven\"\n" +
        "        _ => \"other\"\n",
    );
    expect(text).toContain("__match === 7");
    expect(text).not.toContain("007");
  });

  test("`-0` emits `0`, the literal §7.2 says it is", () => {
    // §7.2: "`-0` is the literal `0`" for both judgments, and the coverage key
    // agrees (the duplicate pin above). The emitted test follows the same law:
    // `=== -0` behaves identically in JavaScript, so the spelling is the only thing
    // at stake and it should read as the literal the arm matches.
    const text = emitted(
      "export fun f(i: Int): String =\n" +
        "    match i\n" +
        "        -0 => \"zero\"\n" +
        "        _ => \"other\"\n",
    );
    expect(text).toContain("__match === 0");
    expect(text).not.toContain("-0");
    // A sign that carries a value keeps it.
    expect(emitted(
      "export fun f(i: Int): String =\n" +
        "    match i\n" +
        "        -007 => \"minus seven\"\n" +
        "        _ => \"other\"\n",
    )).toContain("__match === -7");
  });

  test("so does an expression's, at every numeric representation", () => {
    const text = emitted(
      "export let i: Int = 007\n" +
        "export let n: Nat = 0012\n" +
        "export let b: BigInt = 007n\n" +
        "export let f: Float = 0007.50\n" +
        "export let g: Float = 00.5\n",
    );
    expect(text).toContain("const i = 7;");
    expect(text).toContain("const n = 12;");
    expect(text).toContain("const b = 7n;");
    // `0007.50` and `00.5` are legal Hexagon (Lexer §5 spells out that `00.5` has
    // no octal meaning) and SyntaxErrors in JavaScript.
    expect(text).toContain("const f = 7.50;");
    expect(text).toContain("const g = 0.5;");
  });

  test("the modules all run", async () => {
    const exports = await runMain(main(
      "export let i: Int = 007\n" +
        "export let b: BigInt = 007n\n" +
        "export let f: Float = 0007.50\n" +
        "export fun seven(n: Int): Bool =\n" +
        "    match n\n" +
        "        007 => True\n" +
        "        _ => False\n" +
        "export let matched: Bool = seven(7)\n",
    ));
    expect([exports["i"], exports["b"], exports["f"], exports["matched"]])
      .toEqual([7, 7n, 7.5, true]);
  });
});
