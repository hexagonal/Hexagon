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
      // The constraint *list* reads `(Eq, Num)` where the comparison's reads
      // `(Num, Eq)`: this seat demands `Eq` first so that its delegated *reports*
      // are the comparison's in order (the test above), and the two orders cannot
      // both be had — `#bind` validates a variable's requirements in the order it
      // accepted them. Pinned as measured rather than smoothed over.
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
      "write `<a: (Num, Eq)>`",
    ]);
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
