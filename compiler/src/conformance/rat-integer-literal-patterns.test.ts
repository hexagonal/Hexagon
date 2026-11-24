/**
 * A bare integer literal is a pattern at canonical prelude `Rat`, as it is at
 * `Dec` (Pattern Matching §2.5, §2.10, §7.2; #1638). There it is the fraction
 * over one: `k` is the case `k//1`, and `-k` is `-k//1`. The test is the
 * fraction pattern's — the canonical top and bottom compared as `BigInt`s — so
 * no dictionary and no user code runs, and to the matrix `1` and `1//1` are one
 * case. A user's type honoring `Num` and `Eq` keeps its refusal, a user type
 * named `Rat` among them. Each row asserts the diagnostics by message, or the
 * running answer.
 */

import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

const main = (body: string): string => "module Main\n\n" + body;

const run = async (body: string): Promise<unknown> => (await runMain(main(body))).out;

/** `/main.hex`'s emitted JavaScript, from a program that compiles clean. */
const javascript = (body: string): string => {
  const project = compileMain(main(body));
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find((module) => module.source.path === "/main.hex")!.javascript.text;
};

/** Every diagnostic as its message, and each label's beneath it. */
const reports = (body: string): string[] =>
  compileMain(main(body)).diagnostics.flatMap((diagnostic) => [
    diagnostic.message,
    ...(diagnostic.labels ?? []).map(({ message }) => `+ ${message}`),
  ]);

/** `f` over a `Rat`, with `arms` beneath its `match`. */
const atRat = (arms: string): string =>
  "let f(r: Rat): String =\n    match r with\n" + arms;

const SPECIMEN = atRat("        1 => \"one\"\n        _ => \"other\"\n");

const DUPLICATE = "this literal case is unreachable; it is already handled above";

/** A user's number honoring `Num` and `Eq`, under the name `name`. */
const userNumber = (name: string): string =>
  `export record ${name} derives Eq = {count: Int}\n` +
  `honor Num<${name}> =\n` +
  `    add(l, r) = ${name}({count = l.count + r.count})\n` +
  `    multiply(l, r) = ${name}({count = l.count * r.count})\n` +
  `    fromNat(n) = ${name}({count = Int.fromNat(n)})\n`;

describe("#1638 a bare integer literal is a pattern at `Rat`", () => {
  test("the issue's specimen is the fraction over one", async () => {
    expect(await run(SPECIMEN + "export let out: String = f(1//1) ++ f(2//2) ++ f(1//2)\n"))
      .toBe("oneoneother");
  });

  test.each([
    [
      "a constructor's payload",
      "let f(o: Option(Rat)): String =\n    match o with\n        Some(1) => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f(Some(1//1)) ++ f(Some(1//2)) ++ f(None)\n",
      "oneotherother",
    ],
    [
      "a tuple element",
      "let f(p: (Rat, Int)): String =\n    match p with\n        (2, 0) => \"two\"\n        _ => \"other\"\n" +
        "export let out: String = f((4//2, 0)) ++ f((2//1, 1))\n",
      "twoother",
    ],
    [
      "a record field",
      "let f(r: {n: Rat}): String =\n    match r with\n        { n = 3 } => \"three\"\n        _ => \"other\"\n" +
        "export let out: String = f({ n = 3//1 }) ++ f({ n = 1//3 })\n",
      "threeother",
    ],
    [
      "a vector element",
      "let f(v: Vector(Rat)): String =\n    match v with\n        [0, 1] => \"pair\"\n        _ => \"other\"\n" +
        "export let out: String = f([0//5, 1//1]) ++ f([0//1])\n",
      "pairother",
    ],
    [
      "an or-pattern",
      atRat("        5 | 6 => \"small\"\n        _ => \"other\"\n") +
        "export let out: String = f(5//1) ++ f(12//2) ++ f(7//1)\n",
      "smallsmallother",
    ],
    [
      "an `as`",
      atRat("        4 as y => \"four ${y}\"\n        _ => \"other\"\n") +
        "export let out: String = f(8//2) ++ f(1//4)\n",
      "four 4/1other",
    ],
    [
      "a base other than ten",
      atRat("        0xFF => \"ff\"\n        _ => \"other\"\n") +
        "export let out: String = f(255//1) ++ f(1//255)\n",
      "ffother",
    ],
  ])("beneath %s", async (_, body, answer) => {
    expect(await run(body)).toBe(answer);
  });

  test("a negative literal is the negative fraction over one", async () => {
    expect(await run(
      atRat("        -3 => \"minus three\"\n        _ => \"other\"\n") +
        "export let out: String = f(-3//1) ++ \",\" ++ f(-6//2) ++ \",\" ++ f(3//1)\n",
    )).toBe("minus three,minus three,other");
  });

  test("a position settled as `Rat` by a later arm", async () => {
    expect(await run(
      "let f(o) =\n    match o with\n        Some(1) => \"one\"\n        Some(1//2) => \"half\"\n" +
        "        _ => \"other\"\n" +
        "export let out: String = f(Some(1//1)) ++ f(Some(1//2)) ++ f(Some(3//1))\n",
    )).toBe("onehalfother");
  });

  test("a position settled as `Rat` by a later line", async () => {
    expect(await run(
      "let f(x) =\n    let r =\n        match Some(x) with\n            Some(2) => \"two\"\n" +
        "            _ => \"other\"\n    let known: Rat = x\n    r\n" +
        "export let out: String = f(4//2) ++ f(1//2)\n",
    )).toBe("twoother");
  });

  test("the test is the fraction pattern's, with no dictionary", () => {
    const literal = javascript(SPECIMEN);
    const fraction = javascript(atRat("        1//1 => \"one\"\n        _ => \"other\"\n"));
    expect(literal).toBe(fraction);
    expect(literal).toContain("=== 1n");
    expect(literal).not.toContain("__Eq_");
  });
});

describe("#1638 one case for `1` and `1//1` (§7.2)", () => {
  test("`1` then `1//1`: the second is unreachable", () => {
    expect(projectDiagnostics(main(
      atRat("        1 => \"one\"\n        1//1 => \"again\"\n        _ => \"other\"\n"),
    ))).toEqual(["this case is unreachable; the arm `1` above already covers it"]);
  });

  test("`1//1` then `1`: the second is unreachable", () => {
    expect(projectDiagnostics(main(
      atRat("        1//1 => \"one\"\n        1 => \"again\"\n        _ => \"other\"\n"),
    ))).toEqual([DUPLICATE]);
  });

  test("`1 | 1//1`: the alternative is dead", () => {
    expect(projectDiagnostics(main(
      atRat("        1 | 1//1 => \"one\"\n        _ => \"other\"\n"),
    ))).toEqual(["this case is unreachable; the arm `1` above already covers it"]);
  });

  test("`7` then `007`: the second is unreachable", () => {
    expect(projectDiagnostics(main(
      atRat("        7 => \"seven\"\n        007 => \"again\"\n        _ => \"other\"\n"),
    ))).toEqual([DUPLICATE]);
  });

  test("`1` then `n//d` is reachable", async () => {
    expect(await run(
      atRat("        1 => \"one\"\n        n//d => \"${n}/${d}\"\n") +
        "export let out: String = f(1//1) ++ \",\" ++ f(2//4)\n",
    )).toBe("one,1/2");
  });

  test("`n//d` then `1`: the literal is unreachable", () => {
    expect(projectDiagnostics(main(
      atRat("        n//d => \"fraction\"\n        1 => \"one\"\n"),
    ))).toEqual(["this match arm is unreachable; an earlier pattern matches everything"]);
  });

  test("`2//2` stays the dead fraction it is", () => {
    expect(projectDiagnostics(main(
      atRat("        2//2 => \"one\"\n        _ => \"other\"\n"),
    ))).toEqual([
      "this case is unreachable; a fraction comes apart in lowest terms with a positive bottom, " +
      "so `2//2` never matches — write `1//1`",
    ]);
  });

  test("literal arms alone are not exhaustive", () => {
    expect(projectDiagnostics(main(
      atRat("        1 => \"one\"\n        2 => \"two\"\n"),
    ))).toEqual(["match is missing cases: `_//_`"]);
  });
});

describe("#1638 what stays refused at `Rat`", () => {
  test("a literal beyond `Int` range names the fraction with an `n` top", () => {
    const project = compileMain(main(
      atRat("        9007199254740993 => \"big\"\n        _ => \"other\"\n"),
    ));
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "integer literal exceeds Int range; write `9007199254740993n//1` for a Rat",
    ]);
    expect(project.diagnostics[0]?.fixes?.[0]?.edits[0]?.replacement).toBe("9007199254740993n//1");
    expect(projectDiagnostics(main(
      atRat("        -9007199254740993 => \"big\"\n        _ => \"other\"\n"),
    ))).toEqual([
      "integer literal exceeds Int range; write `-9007199254740993n//1` for a Rat",
    ]);
  });

  test("the spelling it names works", async () => {
    expect(await run(
      atRat("        9007199254740993n//1 => \"big\"\n        _ => \"other\"\n") +
        "export let out: String = f(9007199254740993n//1) ++ f(1//1)\n",
    )).toBe("bigother");
  });

  test("a decimal-point literal and a `d` literal keep their mismatches", () => {
    expect(projectDiagnostics(main(atRat("        0.5 => \"half\"\n        _ => \"other\"\n"))))
      .toEqual(["type mismatch: expected Rat, found Float"]);
    expect(projectDiagnostics(main(atRat("        0.5d => \"half\"\n        _ => \"other\"\n"))))
      .toEqual(["type mismatch: expected Rat, found Dec"]);
  });

  test("a user's number honoring `Num` and `Eq` keeps its refusal", () => {
    expect(projectDiagnostics(main(
      userNumber("Tally") +
        "export fun f(t: Tally): String =\n    match t with\n        1 => \"one\"\n        _ => \"other\"\n",
    ))).toEqual(["`1` is not a pattern at `Tally`; bind a name and test it in a guard: `x when x == 1`"]);
  });

  test("a user type named `Rat` is not the prelude's", () => {
    expect(projectDiagnostics(main(
      userNumber("Rat") +
        "export fun f(r: Rat): String =\n    match r with\n        1 => \"one\"\n        _ => \"other\"\n",
    ))).toEqual(["`1` is not a pattern at `Rat`; bind a name and test it in a guard: `x when x == 1`"]);
  });
});

describe("#1638 the #1637 label at a `Rat` caller", () => {
  const unsettled = "let f(o) =\n    match o with\n        Some(1) => \"one\"\n        _ => \"other\"\n";

  test("advises the written `Rat` type", () => {
    expect(reports(unsettled + "export let out: String = f(Some(1//1))\n")).toEqual([
      "type mismatch: expected Int, found Rat",
      "+ a number in `o` became an `Int` here: a pattern tests it with a number nothing had decided " +
      "— write `o: Option(Rat)`",
    ]);
  });

  test("and the advice compiles and answers", async () => {
    expect(await run(
      unsettled.replace("let f(o)", "let f(o: Option(Rat))") +
        "export let out: String = f(Some(1//1)) ++ f(Some(3//2))\n",
    )).toBe("oneother");
  });
});

describe("#1638 the other permitted types are unchanged", () => {
  test.each([
    ["Int", "f(1) ++ f(2)"],
    ["BigInt", "f(1n) ++ f(2n)"],
    ["Float", "f(1.0) ++ f(2.5)"],
    ["Dec", "f(1.00d) ++ f(2.5d)"],
  ])("at `%s`", async (type, calls) => {
    expect(await run(
      `let f(x: ${type}): String =\n    match x with\n        1 => "one"\n        _ => "other"\n` +
        `export let out: String = ${calls}\n`,
    )).toBe("oneother");
  });
});

describe("#1638 more seats and spellings at `Rat`", () => {
  test.each([
    [
      "a `catch` arm over an exception's `Rat` payload",
      "exception Failed(Rat)\n" +
        "let f(r: Rat): String =\n    try\n        throw^(Failed(r))\n    catch\n" +
        "        Failed(1) => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f(1//1) ++ f(1//2)\n",
      "oneother",
    ],
    [
      "a user's declared pattern over `Rat`s",
      "pattern pair(left: Rat, right: Rat): (Rat, Rat)\n    view(p) = p\n" +
        "let f(p: (Rat, Rat)): String =\n    match p with\n        (1, 2)pair => \"yes\"\n        _ => \"no\"\n" +
        "export let out: String = f((1//1, 2//1)) ++ f((1//1, 1//2))\n",
      "yesno",
    ],
    [
      "a nominal record's field and a union's payload",
      "record Box = {r: Rat}\nunion Shape = Ratio(Rat) | Nothing\n" +
        "let f(b: Box, s: Shape): String =\n" +
        "    let x =\n        match b with\n            Box({r = 1}) => \"b1\"\n            _ => \"b?\"\n" +
        "    let y =\n        match s with\n            Ratio(2) => \"s2\"\n            _ => \"s?\"\n" +
        "    x ++ y\n" +
        "export let out: String = f(Box({r = 1//1}), Ratio(2//1)) ++ f(Box({r = 1//2}), Nothing)\n",
      "b1s2b?s?",
    ],
    [
      "a typed pattern at a written position",
      atRat("        (1: Rat) => \"one\"\n        _ => \"other\"\n") +
        "export let out: String = f(1//1) ++ f(1//2)\n",
      "oneother",
    ],
    [
      "a typed pattern at an inferred position",
      "let f(o) =\n    match o with\n        Some((1: Rat)) => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f(Some(1//1)) ++ f(Some(1//2))\n",
      "oneother",
    ],
    [
      "a match function",
      "let f: (Rat) -> String = match\n    1 => \"one\"\n    _ => \"other\"\n" +
        "export let out: String = f(1//1) ++ f(1//2)\n",
      "oneother",
    ],
    [
      "the safe-integer boundary",
      atRat("        9007199254740991 => \"max\"\n        -9007199254740991 => \"min\"\n        _ => \"other\"\n") +
        "export let out: String = f(9007199254740991n//1) ++ f(-9007199254740991n//1) ++ f(1//1)\n",
      "maxminother",
    ],
    [
      "zero and a negative, against every spelling of their value",
      atRat("        0 => \"z\"\n        -3 => \"m\"\n        _ => \"o\"\n") +
        "export let out: String = f(0//1) ++ f(0//5) ++ f((-6)//2) ++ f(3//(-1)) ++ f(3//1)\n",
      "zzmmo",
    ],
    [
      "a type alias of `Rat`",
      "type Q = Rat\n" +
        "let f(r: Q): String =\n    match r with\n        1 => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f(1//1) ++ f(1//2)\n",
      "oneother",
    ],
    [
      "`Rat` imported under an alias",
      "import Rat as R\n" +
        "let f(r: R.Rat): String =\n    match r with\n        1 => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f(R.create(2, 2)) ++ f(1//2)\n",
      "oneother",
    ],
  ])("%s", async (_, body, answer) => {
    expect(await run(body)).toBe(answer);
  });

  /** A module that hands out `Rat`s and never matches them. */
  const LIB: readonly [string, string] = [
    "/lib.hex",
    "module Lib\n\nexport let whole: Rat = 4//4\nexport let part: Rat = 1//4\n",
  ];

  test("across modules, in a module that never names `Rat`", async () => {
    const exports = await runProject([LIB, [
      "/main.hex",
      "module Main\n\nimport Lib\n\n" +
        "let f(r: Bool): String =\n    match (if r then Lib.whole else Lib.part) with\n" +
        "        1 => \"one\"\n        _ => \"other\"\n" +
        "export let out: String = f(True) ++ f(False)\n",
    ]]);
    expect(exports.out).toBe("oneother");
  });

  test("across modules, in a module with its own `record Rat`", async () => {
    const exports = await runProject([LIB, [
      "/main.hex",
      "module Main\n\nimport Lib\n\nrecord Rat = {n: Int}\n\n" +
        "export let out: String =\n    match Lib.whole with\n        1 => \"one\"\n        _ => \"other\"\n",
    ]]);
    expect(exports.out).toBe("one");
  });

  test.each([
    ["`0` then `-0`", "        0 => \"zero\"\n        -0 => \"again\"\n        _ => \"other\"\n", DUPLICATE],
    ["`n//1` then `1`", "        n//1 => \"whole\"\n        1 => \"one\"\n        _ => \"other\"\n", DUPLICATE],
  ])("%s: the second is unreachable", (_, arms, message) => {
    expect(projectDiagnostics(main(atRat(arms)))).toEqual([message]);
  });

  test("`1` then `n//1` is reachable", async () => {
    expect(await run(
      atRat("        1 => \"one\"\n        n//1 => \"whole ${n}\"\n        _ => \"other\"\n") +
        "export let out: String = f(1//1) ++ \",\" ++ f(5//1) ++ \",\" ++ f(1//2)\n",
    )).toBe("one,whole 5,other");
  });

  test("a guarded `1` leaves `1//1` below it reachable", async () => {
    expect(await run(
      atRat("        1 when False => \"never\"\n        1//1 => \"one\"\n        _ => \"other\"\n") +
        "export let out: String = f(1//1)\n",
    )).toBe("one");
  });

  test("an irrefutable seat gives one report, naming the fraction it can miss", () => {
    expect(projectDiagnostics(main(
      "export fun f(xs: Vector(Rat)): Int =\n    for 1 in xs do\n        ignore(1)\n    1\n",
    ))).toEqual(["this pattern can fail: `_//_`; use `match`"]);
    expect(projectDiagnostics(main(
      "export fun f(o: (Rat, Int)): Int =\n    let (1, k) = o\n    k\n",
    ))).toEqual(["this pattern can fail: `(_//_, _)`; use `match`"]);
  });
});
