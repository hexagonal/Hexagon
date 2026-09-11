import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for **literal patterns at the scrutinee's type** — Pattern Matching
 * §2.5, §4, §7.2, §8, §12, §15 (k); #894, and #519's two refusals with it.
 *
 * Three sentences govern every case below.
 *
 * - **`Float` literals are patterns.** The permanent ban is lifted: `Eq<Float>` is
 *   SameValueZero (Decisions Batch §1), so the NaN half of its rationale was
 *   false, and the signed-zero half was never a reason to refuse a pattern that
 *   follows the language's own equality. The arm test is what `scrutinee == lit`
 *   emits at `Float` — `__floatEquals`, never a bare `===`.
 * - **A literal pattern is checked at the scrutinee's type, and never widens it.**
 *   An integer literal is `fromNat` of its payload there, so `0` is a pattern at
 *   `Int`, `Nat`, `BigInt`, `Float`, `Rat` and any `Num`-honoring type; a decimal
 *   literal requires `Float`; a negative integer literal demands `Signed`. This is
 *   James's ruling of 2026-09-11, and it retires the monomorphic-`Int` typing
 *   #519 filed along with that issue's `Nat`/`BigInt` scrutinee gate.
 * - **A literal's coverage identity is its value**, at the primitives whose `Eq`
 *   the compiler computes — never its spelling (§7.2).
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

describe("acceptance and matching (§2.5, §15 (k))", () => {
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
  });
});

describe("the literal at the scrutinee's type (§2.5's checking rule, #519)", () => {
  test("an integer literal rides `Num` to `Float`, `Nat`, `BigInt` and `Rat`", () => {
    // Four scrutinees that *all* drew "type mismatch: expected X, found Int"
    // before the ruling, and at which `x == 0` was accepted throughout. Two of
    // them also drew #519's "cannot match on `X` yet".
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
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(ratio: Rat.Rat): String =\n" +
        "    match ratio\n" +
        "        0 => \"zero\"\n" +
        "        _ => \"ok\"\n",
    )).toEqual([]);
  });

  test("the literal is built at that type, and tested by that type's `Eq` (§8)", () => {
    // §2.5's two emission sentences together: the spelling is the type's
    // (Numeric Literals §5.2 — `0.0`, `0n`) and the test is the type's `Eq`
    // (`===` at the primitives, the type's own `equals` elsewhere). The `Rat` arm
    // is the one that shows both halves going through evidence.
    expect(emitted(
      "export fun f(t: Float): String =\n    match t\n        0 => \"z\"\n        _ => \"o\"\n",
    )).toContain("__floatEquals(__match, 0.0)");
    expect(emitted(
      "export fun f(b: BigInt): String =\n    match b\n        0 => \"z\"\n        _ => \"o\"\n",
    )).toContain("__match === 0n");
    expect(emitted(
      "export fun f(n: Nat): String =\n    match n\n        0 => \"z\"\n        _ => \"o\"\n",
    )).toContain("__match === 0");
    expect(
      compileMain("module Main\n\nimport Rat\n\n" +
        "export fun f(r: Rat.Rat): String =\n    match r\n        0 => \"z\"\n        _ => \"o\"\n")
        .modules.find(({ source }) => source.path === "/main.hex")!.javascript.text,
    ).toContain("__Eq_Rat.equals(__match, __Num_Rat.fromNat(0))");
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

  test("a `Rat` literal arm runs, through `Rat`'s own `Eq` and `fromNat`", async () => {
    const exports = await runMain("module Main\n\nimport Rat\n\n" +
      "export fun f(r: Rat.Rat): String =\n" +
        "    match r\n" +
        "        0 => \"zero\"\n" +
        "        _ => \"other\"\n" +
        "export let a: String = f(Rat.fromInt(0))\n" +
        "export let b: String = f(Rat.fromInt(3))\n",
    );
    expect([exports["a"], exports["b"]]).toEqual(["zero", "other"]);
  });

  test("a type honoring no `Num` draws what `x == 0` draws there (§12)", () => {
    // The report is the `==` seat's, verbatim, which is what §2.5's sentence
    // promises: "as `x == 0` draws there". One report — the equality the arm
    // would have tested through has nothing to add about a literal the type
    // cannot carry at all.
    const atString = "integer literal cannot have type `String`";
    expect(projectDiagnostics(main("export fun f(s: String): Bool = s == 0\n")))
      .toEqual([atString]);
    expect(projectDiagnostics(main(
      "export fun f(s: String): String =\n" +
        "    match s\n" +
        "        0 => \"zero\"\n" +
        "        _ => \"other\"\n",
    ))).toEqual([atString]);
  });

  test("a negative integer literal demands `Signed` — at `Nat`, §7.6's report", () => {
    // §2.5's last bullet, and §15 (k)'s pin: the arm draws Modules §7.6's
    // missing-instance report for `Signed` at `Nat`, **verbatim as `x == -1`
    // draws there**. The two strings are compared to each other, not just to a
    // literal, so the parity is what fails if either moves.
    const fromComparison = projectDiagnostics(main("export fun f(n: Nat): Bool = n == -1\n"));
    const fromPattern = projectDiagnostics(main(
      "export fun f(n: Nat): String =\n" +
        "    match n\n" +
        "        -1 => \"never\"\n" +
        "        _ => \"ok\"\n",
    ));
    expect(fromPattern).toEqual(fromComparison);
    expect(fromPattern).toEqual([
      "type `Nat` has no `Signed` instance; its only legal homes are the module " +
      "declaring `Signed` and `Nat`'s prelude companion module, both outside " +
      "project source, so this pair's honored set is closed — change the type, or " +
      "go through the operations those homes export; a written `Int` face runs " +
      "the operation and admits the result (`let difference: Int = …`)",
    ]);
    // The demand is judged whatever the payload, `-0` included (§2.5).
    expect(projectDiagnostics(main(
      "export fun f(n: Nat): String =\n" +
        "    match n\n" +
        "        -0 => \"never\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual(fromComparison);
    // And it is satisfied at every `Signed`-honoring type.
    expect(projectDiagnostics(main(
      "export fun f(i: Int): String =\n" +
        "    match i\n" +
        "        -1 => \"minus one\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([]);
  });

  test("the undetermined scrutinee is §6.1's, with or without a literal arm", () => {
    // `match 0` with a `0` arm compiled only by the accident the ruling retires:
    // the old monomorphic typing unified the scrutinee to `Int` at arm-check,
    // while the same match with `_` alone, or with the guard twin, was refused.
    // §6.1 reads the scrutinee at dispatch, and all three now read alike.
    const refusal = "cannot match on a value of abstract type; " +
      "use the operations its constraints provide";
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

  test("a literal in a slot of declared type demands its constraints there too", () => {
    // The same parity one level down: the slot's type is a rigid variable, and
    // the literal asks of it exactly what `x == 0` asks.
    const fromComparison = projectDiagnostics(main("export fun f(x: a): Bool = x == 0\n"));
    expect(projectDiagnostics(main(
      "export fun f(o: Option(a)): String =\n" +
        "    match o\n" +
        "        Some(0) => \"zero\"\n" +
        "        _ => \"other\"\n",
    ))).toEqual(fromComparison);
    expect(fromComparison).toEqual([
      "exported function `f` must declare every constraint in its signature; " +
      "write `<a: (Num, Eq)>`",
    ]);
  });
});

describe("coverage identity is the value, not the spelling (§7.2)", () => {
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

  test("outside the primitives the key is the spelling, and stays conservative", () => {
    // §7.2: "the matrix declining to equate what it cannot evaluate: it never
    // leans on an unchecked law". `0` and `00` at `Rat` are one value under
    // `Eq<Rat>` at runtime and one key here, because the *spelling* is
    // separator-free-equal; `0` and `-0` are two keys, and the only consequence
    // is a dead arm unreported — the posture §7.2 takes for an unprovable guard.
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(r: Rat.Rat): String =\n" +
        "    match r\n" +
        "        0 => \"zero\"\n" +
        "        0 => \"never\"\n" +
        "        _ => \"ok\"\n",
    )).toEqual([DUPLICATE]);
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(r: Rat.Rat): String =\n" +
        "    match r\n" +
        "        0 => \"zero\"\n" +
        "        -0 => \"unreported\"\n" +
        "        _ => \"ok\"\n",
    )).toEqual([]);
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

describe("a term's spelling in pattern position (§2.5, §12)", () => {
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
    // a term — `Helper.zero` is its own example — so a function's name takes it as
    // readily as a constant's.
    expect(projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(i: Int): String =\n" +
        "    match i\n" +
        "        Rat.fromInt => \"zero\"\n" +
        "        _ => \"ok\"\n",
    )).toEqual([
      "`Rat.fromInt` is a value, not a pattern; bind a name and test it in a " +
      "guard: `x when x == Rat.fromInt`",
    ]);
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

describe("the lexer's conversion governs (§2.5, §12; Lexer §5)", () => {
  test("`1.0e308` is a legal pattern", () => {
    expect(projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        1.0e308 => \"huge\"\n" +
        "        _ => \"ok\"\n",
    ))).toEqual([]);
  });

  test("`1.0e309` draws the lexer's report, and no pattern report beside it", () => {
    // §2.5: "a construct the lexer has already diagnosed draws no further report
    // from the pattern seat". Before #894 the seat added "expected a binding,
    // `_`, constructor, tuple, or record pattern" and the match added "match is
    // missing cases: `_`".
    const diagnostics = projectDiagnostics(main(
      "export fun f(t: Float): String =\n" +
        "    match t\n" +
        "        1.0e309 => \"hot\"\n" +
        "        _ => \"ok\"\n",
    ));
    expect(diagnostics[0]).toBe("Float literal is too large; use `Float.infinity`");
    expect(diagnostics).not.toContain(
      "expected a binding, `_`, constructor, tuple, or record pattern",
    );
    expect(diagnostics).not.toContain("match is missing cases: `_`");
    // What remains is the layout pass's own cascade, which the dropped token
    // causes in expression position identically — pre-existing, and no pattern
    // seat's to suppress.
    expect(diagnostics.slice(1)).toEqual([
      "inconsistent dedent; expected one of columns 0, 4",
      "expected a newline or `;` between block items",
    ]);
  });
});

describe("the emitted integer literal is canonical (#897)", () => {
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
