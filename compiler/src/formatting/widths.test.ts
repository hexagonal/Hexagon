import { describe, expect, it } from "vitest";

import { wrongShapes, type WrongShape } from "./widths.js";

const lines = (...written: string[]): string => written.join("\n") + "\n";

/** The wrong shapes of a document, as `line kind should width`. */
function named(text: string): string[] {
  return wrongShapes(text).map(({ line, kind, should, width }: WrongShape) => `${line} ${kind} ${should} ${width}`);
}

describe("A construct on one line that its row spreads (§15.1; H9)", () => {
  it("names each kind over its width limit, and none at it", () => {
    const at = (width: number, prefix: string, suffix = ""): string =>
      prefix + "x".repeat(width - prefix.length - suffix.length) + suffix;
    expect(named(lines(
      "module A",
      `let a = ${at(60, "if c then 1 else ")}`,
      `let b = ${at(61, "if c then 1 else ")}`,
      `let c = f(${at(60, "1, ")})`,
      `let d = f(${at(61, "1, ")})`,
      `let e = ${at(60, "a.f().g(", ")")}`,
      `let g = ${at(61, "a.f().g(", ")")}`,
      `let h = ${at(60, "{ a = ", " }")}`,
      `let i = ${at(61, "{ a = ", " }")}`,
      `let j = ${at(60, "x => ")}`,
      `let k = ${at(61, "x => ")}`,
      `let l = ${at(80, "a and ")}`,
      `let m = ${at(81, "a or ")}`,
      at(60, "record R = { a: ", " }"),
      at(61, "record S = { a: ", " }"),
      at(60, "union T = A | X"),
      at(61, "union U = A | X"),
      "fun n(xs: Vector(Int)) =",
      `    ${at(60, "for x in xs do ")}`,
      `    ${at(61, "for x in xs do ")}`,
      "    match xs with",
      `        ${at(80, "_ => ")}`,
      `        ${at(81, "_ => ")}`,
    ))).toEqual([
      "3 conditional spread 61",
      "5 arguments spread 61",
      "7 chain spread 61",
      "9 record spread 61",
      "11 lambda spread 61",
      "13 and/or spread 81",
      "15 record declaration spread 61",
      "17 union spread 61",
      "20 loop spread 61",
      "23 arm spread 81",
    ]);
  });

  it("names an `else if` chain, a conditional that holds another, and a loop whose body is one, however short", () => {
    expect(named(lines(
      "module A",
      "let a = if a then 1 else if b then 2 else 3",
      "let b = if a then (if b then 1 else 2) else 3",
      "let c = if (if a then b else c) then 1 else 2",
      "fun d(xs: Vector(Int)) =",
      "    for x in xs do if x > 0 then print(x)",
      "    while go() do while go() do step()",
      "    for x in xs do print(x)",
    ))).toEqual([
      "2 conditional spread 35",
      "3 conditional spread 37",
      "4 conditional spread 37",
      "6 loop spread 37",
      "7 loop spread 34",
    ]);
  });

  it("counts a pipeline of two stages as a chain, and no module's name as a link", () => {
    expect(named(lines(
      "module A",
      `let a = values |> Vector.map(double) |> Vector.filter(${"x".repeat(30)})`,
      `let b = Vector.fromSeq(${"x".repeat(50)}).length()`,
    ))).toEqual(["2 chain spread 77"]);
  });

  it("counts a comment inside a construct as written (§15.2)", () => {
    expect(named(lines(
      "module A",
      `let a = if ready then ${"x".repeat(20)} else {- why -} ${"y".repeat(20)}`,
      `let b = if ready then ${"x".repeat(20)} else ${"y".repeat(20)}`,
    ))).toEqual(["2 conditional spread 70"]);
  });

  it("holds no width limit for a vector, a tuple, a call of one argument, arithmetic or a header", () => {
    expect(named(lines(
      "module A",
      `let a = [${"1, ".repeat(30)}1]`,
      `let b = (${"1, ".repeat(30)}1)`,
      `let c = f(${"x".repeat(70)})`,
      `let d = ${"a + ".repeat(20)}a`,
      `let e(${"a: Int, ".repeat(9)}b: Int) = 1`,
    ))).toEqual([]);
  });

  it("measures a construct as §7 spaces it, without a trailing comma, wherever it stands", () => {
    expect(named(lines(
      "module A",
      `let a = f(${"x".repeat(25)},      ${"y".repeat(25)},      zzzzzz)`,
      "let b =",
      "    g(",
      `        f(${"x".repeat(25)}, ${"y".repeat(25)}, zzzzzzz),`,
      "    )",
    ))).toEqual(["5 arguments spread 61"]);
  });

  it("reads a record's fields and a fraction's sides", () => {
    expect(named(lines(
      "module A",
      "let a = { n = if a then 1 else if b then 2 else 3 }",
      "let b = (if a then 1 else if b then 2 else 3) // 4",
    ))).toEqual(["2 conditional spread 35", "3 conditional spread 35"]);
  });

  it("leaves a construct in an interpolation hole alone", () => {
    expect(named(lines("module A", `let a = "\${if c then ${"x".repeat(60)} else y}"`))).toEqual([]);
  });

  it("names nothing in a document with a syntax error", () => {
    expect(wrongShapes(lines("module A", "let a = if a then 1 else if b then 2 else"))).toEqual([]);
  });

  it("gives the line, the limit and the text on one line", () => {
    expect(wrongShapes(lines("module A", "", "let a = if a then 1 else if b then 2 else 3"))).toEqual([{
      line: 3,
      kind: "conditional",
      should: "spread",
      width: 35,
      limit: "never",
      text: "if a then 1 else if b then 2 else 3",
    }]);
  });
});

describe("A spread construct that could stand on one line (H9)", () => {
  it("names each kind written spread within its width limit, on a line that fits", () => {
    expect(named(lines(
      "module A",
      "let a =",
      "    if c then",
      "        1",
      "    else",
      "        2",
      "let b = f(",
      "    1,",
      "    2,",
      ")",
      "let c = [",
      "    1,",
      "]",
      "let d = { a = 1,",
      "    b = 2 }",
      "record R = {",
      "    a: Int,",
      "}",
      "union T =",
      "    | A",
      "    | B",
      "fun e(xs: Vector(Int)) =",
      "    for x in xs do",
      "        print(x)",
      "    match xs with",
      "        _ =>",
      "            1",
      "let g = (x: Int) =>",
      "    x + 1",
      "let h(",
      "    a: Int,",
      ") = 1",
      "let i = a",
      "        + b",
      "let j = a",
      "        and b",
      "let k = xs",
      "    .map(f)",
      "    .filter(g)",
    ))).toEqual([
      "3 conditional one line 18",
      "7 arguments one line 4",
      "11 vector one line 3",
      "14 record one line 16",
      "16 record declaration one line 21",
      "19 union one line 15",
      "23 loop one line 23",
      "26 arm one line 6",
      "28 lambda one line 17",
      "30 header one line 15",
      "33 arithmetic one line 5",
      "35 and/or one line 7",
      "37 chain one line 19",
    ]);
  });

  it("names nothing that would not fit its line on one line", () => {
    expect(named(lines(
      "module A",
      `let a = ${"x".repeat(60)} + f(`,
      `    ${"y".repeat(30)},`,
      "    z,",
      ")",
    ))).toEqual([]);
  });

  it("names nothing that holds what must be spread", () => {
    expect(named(lines(
      "module A",
      // A block of two items.
      "let a = xs.map(x =>",
      "    let y = x + 1",
      "    y",
      ")",
      // A `match` with its arms.
      "let b = xs.map(match",
      "    _ => 1",
      ")",
      // A comment that ends its line.
      "let c = f(",
      "    1, -- one",
      "    2,",
      ")",
      // A string over several lines.
      "let d = f(\"one",
      "    two\", 2)",
      // A construct the table spreads.
      "let e = [",
      `    { a = ${"x".repeat(60)} },`,
      "]",
    ))).toEqual(["16 record spread 68"]);
  });

  it("names no lambda that ends a call the table spreads, whose head stays on the call's line (H7)", () => {
    expect(named(lines(
      "module A",
      `let a = Vector.fold(${"values".repeat(5)}, 0, (sum, value) =>`,
      "    sum + value",
      ")",
    ))).toEqual([]);
    expect(named(lines(
      "module A",
      "let a = Vector.fold(values, 0, (sum, value) =>",
      "    sum + value",
      ")",
    ))).toEqual(["2 arguments one line 38", "2 lambda one line 27"]);
  });

  it("names no lambda that ends a record the table spreads (H7)", () => {
    expect(named(lines(
      "module A",
      `let a = Handler({ name = "${"x".repeat(40)}", run = (event) =>`,
      "    event + 1",
      "})",
    ))).toEqual([]);
  });

  it("measures a union on one line without its leading bar", () => {
    expect(named(lines("module A", "union T =", "    | A", "    | B")).map((one) => one.split(" ").at(-1))).toEqual(["15"]);
  });
});
