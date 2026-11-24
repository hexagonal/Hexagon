/**
 * A number type that only a literal pattern tests, and no line of its function
 * settles, is an `Int` where the function generalizes; it is never left to the
 * caller (Pattern Matching §2.5, Numeric Literals §4; #1637). A literal pattern
 * compares with compiler-computed equality at a type the checker knows, and a
 * type the caller chooses is not one. Where the position cannot be an `Int` — it
 * also demands `Frac` — the pattern is refused, naming the written type and the
 * guard. Each row asserts the diagnostics by message, or the running answer.
 */

import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

const main = (body: string): string => "module Main\n\n" + body;

const run = async (body: string): Promise<unknown> => (await runMain(main(body))).out;

/** Every diagnostic as its message, and each label's beneath it. */
const reports = (body: string): string[] =>
  compileMain(main(body)).diagnostics.flatMap((diagnostic) => [
    diagnostic.message,
    ...(diagnostic.labels ?? []).map(({ message }) => `+ ${message}`),
  ]);

const ONE = "        Some(1) => \"one\"\n        _ => \"other\"\n";

const SPECIMEN = "let f(o) =\n    match o with\n" + ONE;

const MISMATCH = "type mismatch: expected Int, found Dec";

/** The label at a parameter `name` that holds the number in a part of its type. */
const inPart = (name: string, write: string): string =>
  `+ a number in \`${name}\` became an \`Int\` here: a pattern tests it with a number nothing had ` +
  `decided — ${write}`;

describe("#1637 a position only a literal pattern touches is an `Int`", () => {
  test("the issue's program is a mismatch at each `Dec` call, labelled at the parameter", () => {
    expect(reports(SPECIMEN + "export let out: String = f(Some(1d)) ++ f(Some(2.5d))\n")).toEqual([
      MISMATCH,
      inPart("o", "write `o: Option(Dec)`"),
      MISMATCH,
      inPart("o", "write `o: Option(Dec)`"),
    ]);
  });

  test("its `Int` calls answer as before", async () => {
    expect(await run(SPECIMEN + "export let out: String = f(Some(1)) ++ f(Some(2))\n")).toBe("oneother");
  });

  test("the type the label advises compiles and answers at `Dec`", async () => {
    expect(await run(
      SPECIMEN.replace("let f(o)", "let f(o: Option(Dec))") +
        "export let out: String = f(Some(1d)) ++ f(Some(2.5d))\n",
    )).toBe("oneother");
  });

  test("the self-wrapping twin is refused the same way, naming the whole parameter", () => {
    expect(reports(
      "let f(x) =\n    match Some(x) with\n" + ONE + "export let out: String = f(1d)\n",
    )).toEqual([
      MISMATCH,
      "+ `x` became an `Int` here: a pattern tests it with a number nothing had decided — write `x: Dec`",
    ]);
  });

  test.each([
    [
      "a tuple element",
      "let f(p) =\n    match p with\n        (1, _) => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f((1d, \"a\"))\n",
      [MISMATCH, inPart("p", "write its type here")],
    ],
    [
      "a record field",
      "let f(r) =\n    match r with\n        { n = 1 } => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f({ n = 1d })\n",
      [MISMATCH, inPart("r", "write its type here")],
    ],
    [
      "a vector element",
      "let f(v) =\n    match v with\n        [1] => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f([1d])\n",
      [
        "`1d` is a `Dec` and cannot enter `Int`, the home `: Int` writes",
        inPart("v", "write `v: Vector(Dec)`"),
      ],
    ],
    [
      "an or-pattern with a negative literal",
      "let f(o) =\n    match o with\n        Some(-1 | 2) => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f(Some(2d))\n",
      [MISMATCH, inPart("o", "write `o: Option(Dec)`")],
    ],
    [
      "an `as`",
      "let f(o) =\n    match o with\n        Some(1 as n) => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f(Some(1d))\n",
      [MISMATCH, inPart("o", "write `o: Option(Dec)`")],
    ],
    [
      "a `fun`",
      "fun f(o) =\n    match o with\n" + ONE + "export let out: String = f(Some(1d))\n",
      [MISMATCH, inPart("o", "write `o: Option(Dec)`")],
    ],
    [
      "a local function",
      "let outer(z: Dec): String =\n    let g(o) =\n        match o with\n" +
        "            Some(1) => \"one\"\n            _ => \"other\"\n    g(Some(z))\n" +
        "export let out: String = outer(1d)\n",
      [MISMATCH, inPart("o", "write `o: Option(Dec)`")],
    ],
    [
      "a match function",
      "let g = match\n    Some(1) => \"one\"\n    _ => \"other\"\nexport let out: String = g(Some(1d))\n",
      [
        MISMATCH,
        "+ this match function's parameter became an `Int` here: a pattern tests it with a number " +
        "nothing had decided — write the function's type where it is bound",
      ],
    ],
    [
      "a lambda",
      "let h = (o) =>\n    match o with\n" + ONE + "export let out: String = h(Some(1d))\n",
      [MISMATCH, inPart("o", "write `o: Option(Dec)`")],
    ],
    [
      "a `fun` block's knot",
      "fun\n    even(o, n) =\n        match o with\n            Some(0) => \"zero\"\n" +
        "            _ => if n == 0 then \"e\" else odd(o, n - 1)\n" +
        "    odd(o, n) = if n == 0 then \"o\" else even(o, n - 1)\n" +
        "export let out: String = even(Some(1d), 2)\n",
      [MISMATCH, inPart("o", "write `o: Option(Dec)`")],
    ],
  ])("%s", (_shape, body, expected) => {
    expect(reports(body)).toEqual(expected);
  });

  test("a `fun` block's knot answers at `Int`", async () => {
    expect(await run(
      "fun\n    even(o, n) =\n        match o with\n            Some(0) => \"zero\"\n" +
        "            _ => if n == 0 then \"e\" else odd(o, n - 1)\n" +
        "    odd(o, n) = if n == 0 then \"o\" else even(o, n - 1)\n" +
        "export let out: String = even(Some(1), 2) ++ odd(Some(0), 1)\n",
    )).toBe("ezero");
  });

  test("a literal spelled twice is unreachable", () => {
    expect(projectDiagnostics(main(
      "let f(o) =\n    match o with\n        Some(7) => \"one\"\n        Some(007) => \"two\"\n" +
        "        _ => \"other\"\nexport let out: String = f(Some(7))\n",
    ))).toEqual(["this case is unreachable; the arm `Some(7)` above already covers it"]);
  });
});

describe("#1637 a position that cannot be an `Int` refuses the pattern", () => {
  test("a position that also divides, with the guard offered", () => {
    expect(projectDiagnostics(main(
      "let f(x) =\n    match Some(x) with\n        Some(1) => x / x\n        _ => x\n" +
        "export let out: Float = f(1.0)\n",
    ))).toEqual([
      "`1` is not a pattern at a type left to the caller; write the parameter's type, or bind a " +
      "name and test it in a guard: `Some(y) when y == 1`",
    ]);
  });

  test("inside an or-pattern, where no guard can be offered", () => {
    expect(projectDiagnostics(main(
      "let f(x) =\n    match Some(x) with\n        Some(1 | 2) => x / x\n        _ => x\n" +
        "export let out: Float = f(1.0)\n",
    ))).toEqual([
      "`1` is not a pattern at a type left to the caller; write the parameter's type",
      "`2` is not a pattern at a type left to the caller; write the parameter's type",
    ]);
  });

  test("at an arm that has a guard already", () => {
    expect(projectDiagnostics(main(
      "let f(x) =\n    match Some(x) with\n        Some(1) when x > 0 => x / x\n        _ => x\n" +
        "export let out: Float = f(1.0)\n",
    ))).toEqual(["`1` is not a pattern at a type left to the caller; write the parameter's type"]);
  });

  test("both advised spellings compile", async () => {
    expect(await run(
      "let f(x: Float) =\n    match Some(x) with\n        Some(1) => x / x\n        _ => x\n" +
        "let g(x) =\n    match Some(x) with\n        Some(y) when y == 1 => x / x\n        _ => x\n" +
        "export let out: Float = f(1.0) + f(3.0) + g(1.0) + g(5.0)\n",
    )).toBe(10);
  });
});

describe("#1637 controls", () => {
  test("the guard twin stays generic and answers at `Dec` and at `Int`", async () => {
    expect(await run(
      "let f(x) =\n    match Some(x) with\n        Some(y) when y == 1 => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f(1d) ++ f(2.5d) ++ f(1) ++ f(2)\n",
    )).toBe("oneotheroneother");
  });

  test("a comparison with an expression literal stays generic", async () => {
    expect(await run(
      "let f(x) = if x == 1 then \"one\" else \"other\"\nexport let out: String = f(1d) ++ f(2.5d) ++ f(1)\n",
    )).toBe("oneotherone");
  });

  test("a written `<a: (Num, Eq)>` keeps its refusal", () => {
    expect(projectDiagnostics(main(
      "let f<a: (Num, Eq)>(x: a): String =\n    match Some(x) with\n" + ONE +
        "export let out: String = f(1d)\n",
    ))).toEqual(["`1` is not a pattern at `a`; bind a name and test it in a guard: `Some(y) when y == 1`"]);
  });

  test("a position a body line settles as `Dec` answers at `Dec`", async () => {
    expect(await run(
      "let f(x) =\n    let d: Dec = x\n    match Some(x) with\n" + ONE +
        "export let out: String = f(1d) ++ f(2.5d)\n",
    )).toBe("oneother");
  });

  test("a bare subject keeps its own default and label", () => {
    expect(reports(
      "let f(x) =\n    match x with\n        1 => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f(1d)\n",
    )).toEqual([
      MISMATCH,
      "+ `x` became an `Int` here: a `match` tests it with a number nothing had decided — write `x: Dec`",
    ]);
  });
});
