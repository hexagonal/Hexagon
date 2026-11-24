/**
 * A bare integer-literal pattern whose position is settled as `Dec` only after
 * the pattern is read tests through `Dec`'s `Eq` evidence, as it does where the
 * position is `Dec` already (Pattern Matching §2.5, §8; #1158). `Dec` values are
 * records, so a reference comparison never matches one; each row below asserts
 * the running answer, beside the controls whose answer and emitted test do not
 * move.
 */

import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

const main = (body: string): string => "module Main\n\n" + body;

const run = async (body: string): Promise<unknown> => (await runMain(main(body))).out;

/** `/main.hex`'s emitted JavaScript, for a program that compiles clean. */
const javascript = (body: string): string => {
  const project = compileMain(main(body));
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find((module) => module.source.path === "/main.hex")!.javascript.text;
};

/** `f` matches `scrutinee` with `arms`, and only afterwards does `x` meet `Dec`. */
const deferred = (scrutinee: string, arms: string, settle = "    let known: Dec = x\n"): string =>
  "let f(x) =\n" +
  `    let r = match ${scrutinee} with\n` +
  arms +
  settle +
  "    r\n";

const ONE = "        Some(1) => \"one\"\n        _ => \"other\"\n";

describe("#1158 an integer pattern settled as Dec later", () => {
  test.each([
    [
      "the issue's program",
      deferred("Some(x)", ONE) + "export let out: String = f(1d) ++ f(2.5d)\n",
      "oneother",
    ],
    [
      "a later `Dec` arm settles the position",
      "let f(x) =\n    match Some(x) with\n        Some(1) => \"one\"\n" +
        "        Some(2.5d) => \"twohalf\"\n        _ => \"other\"\n" +
        "export let out: String = f(1d) ++ f(1.00d) ++ f(2.5d) ++ f(3d)\n",
      "oneonetwohalfother",
    ],
    [
      "a tuple element",
      deferred("(x, 0)", "        (1, _) => \"one\"\n        _ => \"other\"\n") +
        "export let out: String = f(1d) ++ f(2.5d)\n",
      "oneother",
    ],
    [
      "a record field",
      deferred("{ a = x, b = 0 }", "        { a = 1, b = _ } => \"one\"\n        _ => \"other\"\n") +
        "export let out: String = f(1d) ++ f(2.5d)\n",
      "oneother",
    ],
    [
      "a vector element",
      deferred("[x]", "        [1] => \"one\"\n        _ => \"other\"\n") +
        "export let out: String = f(1d) ++ f(2.5d)\n",
      "oneother",
    ],
    [
      "or-alternatives, an `as`, and a negative literal",
      deferred(
        "Some(x)",
        "        Some(1 | 2) => \"low\"\n        Some(-3 as y) => \"neg\"\n        _ => \"other\"\n",
      ) + "export let out: String = f(1.0d) ++ f(2d) ++ f(-3d) ++ f(2.5d)\n",
      "lowlownegother",
    ],
    [
      "a match function's arm",
      "let f(x) =\n    let r = Option.map(Some(Some(x)), match\n" +
        "        Some(1) => \"one\"\n        _ => \"other\"\n    )\n" +
        "    let known: Dec = x\n    match r with\n        Some(s) => s\n        None => \"none\"\n" +
        "export let out: String = f(1d) ++ f(2.5d)\n",
      "oneother",
    ],
  ])("%s", async (_shape, body, out) => {
    expect(await run(body)).toBe(out);
  });

  test("emits the test an annotated `x: Dec` emits", () => {
    const later = javascript(deferred("Some(x)", ONE) + "export let out: String = f(1d)\n");
    const annotated = javascript(
      deferred("Some(x)", ONE).replace("let f(x) =", "let f(x: Dec) =") +
        "export let out: String = f(1d)\n",
    );
    expect(later).toBe(annotated);
    expect(later).toContain("__Eq_Dec.equals(__match.value, __Num_Dec.fromNat(1))");
  });
});

describe("#1158 controls", () => {
  test.each([
    [
      "an annotated `x: Dec`",
      "let f(x: Dec) =\n    match Some(x) with\n" + ONE + "export let out: String = f(1d) ++ f(2.5d)\n",
      "oneother",
    ],
    [
      "a `Dec` arm before the integer arm",
      "let f(x) =\n    match Some(x) with\n        Some(2.5d) => \"twohalf\"\n" +
        "        Some(1) => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f(1d) ++ f(2.5d) ++ f(3d)\n",
      "onetwohalfother",
    ],
    [
      // No line settles this position, so `f` generalizes over it. The answer is
      // right at `Int`; the shape's other callers are #1637.
      "a position no line settles answers right at `Int`",
      "let f(x) =\n    match Some(x) with\n" + ONE + "export let out: String = f(1) ++ f(2)\n",
      "oneother",
    ],
    [
      // A `catch` arm's payload is declared, so its position is never settled late.
      "a `catch` arm at a declared `Dec` payload",
      "exception Failed(code: Dec)\nlet caught(v: Dec): String =\n    try throw^(Failed(v))\n" +
        "    catch\n        Failed(1) => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = caught(1d) ++ caught(2.5d)\n",
      "oneother",
    ],
  ])("%s", async (_shape, body, out) => {
    expect(await run(body)).toBe(out);
  });

  const TWINS = deferred("Some(x)", ONE, "    let known: Float = x\n") +
    deferred("Some(x)", ONE, "    let known: BigInt = x\n").replace("let f(x)", "let g(x)") +
    deferred("Some(x)", ONE, "    let known: Nat = x\n").replace("let f(x)", "let h(x)") +
    "export let out: String = f(1.0) ++ f(2.5) ++ g(1n) ++ g(2n) ++ h(1) ++ h(2)\n";

  test("deferred `Float`, `BigInt` and `Nat` positions keep their answers", async () => {
    expect(await run(TWINS)).toBe("oneotheroneotheroneother");
  });

  test("deferred `Float`, `BigInt` and `Nat` positions keep their emitted tests", () => {
    const text = javascript(TWINS);
    expect(text).toContain("__floatEquals(__match.value, 1.0)");
    expect(text).toContain("__match.value === 1n)");
    expect(text).toContain("__match.value === 1)");
    expect(text).not.toContain("__Eq_");
  });

  test("a deferred `Rat` position is still refused", () => {
    expect(projectDiagnostics(main(
      deferred("Some(x)", ONE, "    let known: Rat = x\n") + "export let out: String = f(1//1)\n",
    ))).toEqual([
      "`1` is not a pattern at `Rat`; bind a name and test it in a guard: `Some(y) when y == 1`",
    ]);
  });

  test("a `Dec` arm equal to an earlier integer arm is still unreachable", () => {
    expect(projectDiagnostics(main(
      "let f(x) =\n    match Some(x) with\n        Some(1) => \"one\"\n" +
        "        Some(1.0d) => \"dup\"\n        _ => \"other\"\n" +
        "export let out: String = f(1d)\n",
    ))).toEqual(["this case is unreachable; the arm `Some(1)` above already covers it"]);
  });
});
