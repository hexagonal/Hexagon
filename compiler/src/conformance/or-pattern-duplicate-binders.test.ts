/**
 * An or-pattern binds each of its names once in the pattern around it, so a
 * name it binds and a name bound beside it, or in a sibling or-pattern, are one
 * name bound twice in one pattern (#104; Pattern Matching §2.1, §2.6;
 * Statements §5.2). That is one report, the pattern-shaped one, in every place
 * a pattern binds: never a rebinding or "duplicate parameter" report beside it
 * or in its stead, and never silence with JavaScript that declares the name
 * twice. An or-pattern's own alternatives each keep a universe of their own, so
 * `A(x) | B(x)` binds `x` once and still runs.
 */

import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

const header = "module Main\n\nunion T = A(Int) | B(Int)\nunion W = P(T, T) | Q(Int)\n";

/**
 * The shapes, each a whole pattern with the parameter type it matches, a value
 * of that type, and which written occurrences of `x` (counted from 0, within
 * the pattern) carry the caret and the label.
 */
const shapes = [
  { name: "a binder, then an or-pattern", pattern: "(x, (A(x) | B(x)))", type: "(Int, T)", value: "(1, A(2))", caret: 1, label: 0 },
  { name: "an or-pattern, then a binder", pattern: "((A(x) | B(x)), x)", type: "(T, Int)", value: "(A(2), 1)", caret: 2, label: 0 },
  { name: "two sibling or-patterns", pattern: "((A(x) | B(x)), (A(x) | B(x)))", type: "(T, T)", value: "(A(1), B(2))", caret: 2, label: 0 },
  { name: "`as` over an or-pattern", pattern: "((A(x) | B(x)) as x)", type: "T", value: "A(2)", caret: 2, label: 0 },
  {
    name: "sibling or-patterns inside one alternative",
    pattern: "(P((A(x) | B(x)), (A(x) | B(x))) | Q(x))",
    type: "W",
    value: "P(A(1), B(2))",
    caret: 2,
    label: 0,
  },
] as const;

type Shape = (typeof shapes)[number];

/** Each place a pattern binds, as a program around one pattern whose body reads `x`. */
const positions: readonly (readonly [string, (shape: Shape) => string])[] = [
  ["a `let` in a block", ({ pattern, value }) =>
    `export let out: Int =\n    let ${pattern} = ${value}\n    x\n`],
  ["a module-level `let`", ({ pattern, value }) =>
    `let ${pattern} = ${value}\nexport let out: Int = x\n`],
  ["a function parameter", ({ pattern, type, value }) =>
    `fun f(${pattern}: ${type}): Int = x\nexport let out: Int = f(${value})\n`],
  ["a lambda parameter", ({ pattern, type, value }) =>
    `let g: (${type}) -> Int = (${pattern}) => x\nexport let out: Int = g(${value})\n`],
  ["a `match` arm", ({ pattern, type, value }) =>
    `let f(p: ${type}): Int =\n    match p with\n        ${pattern} => x\nexport let out: Int = f(${value})\n`],
  ["a `catch` arm", ({ pattern, type, value }) =>
    `exception Boom(v: ${type})\n` +
    `let source(fail: Bool): Int =\n    if fail then throw^(Boom(${value})) else 7\n` +
    `export let out: Int =\n    try source^(True)\n    catch\n        Boom(${pattern}) => x\n`],
  ["a `for` head", ({ pattern, type, value }) =>
    `let total(ps: Vector(${type})): Int =\n    var t = 0\n    for ${pattern} in ps do\n        t := t + x\n    t\n` +
    `export let out: Int = total([${value}])\n`],
  ["a match function", ({ pattern, type, value }) =>
    `let f: (${type}) -> Int = match\n    ${pattern} => x\nexport let out: Int = f(${value})\n`],
];

/**
 * The sole report `source` makes, read off as the message, its label, and the
 * offsets of the caret and the label, beside the offsets of every written
 * occurrence of `name` in the first occurrence of `pattern`.
 */
function soleReport(source: string, pattern: string, name = "x") {
  const { diagnostics } = compileMain(source);
  expect(diagnostics.length, diagnostics.map(({ message }) => message).join(" | ")).toBe(1);
  const [report] = diagnostics;
  const start = source.indexOf(pattern);
  expect(start).toBeGreaterThanOrEqual(0);
  const occurrences = [...pattern.matchAll(new RegExp(`\\b${name}\\b`, "gu"))]
    .map(({ index }) => start + index);
  return {
    message: report!.message,
    caretText: source.slice(report!.primary.start.offset, report!.primary.end.offset),
    caretAt: occurrences.indexOf(report!.primary.start.offset),
    labels: (report!.labels ?? []).map(({ span, message }) => ({
      message,
      at: occurrences.indexOf(span.start.offset),
    })),
  };
}

describe("#104 a name an or-pattern binds is bound once in the whole pattern", () => {
  for (const [position, program] of positions) {
    describe(position, () => {
      test.each(shapes.map((shape) => [shape.name, shape] as const))("%s", (_name, shape) => {
        const source = header + "\n" + program(shape);
        const report = soleReport(source, shape.pattern);
        expect(report.message).toBe("`x` is bound twice in this pattern");
        expect(report.caretText).toBe("x");
        expect(report.caretAt).toBe(shape.caret);
        expect(report.labels).toEqual([{ message: "first binding is here", at: shape.label }]);
      });
    });
  }
});

describe("#104 in a match arm, under every other pattern form", () => {
  // A vector pattern is refutable and takes a fallback arm; every other one
  // here is irrefutable, where a fallback would be reported unreachable.
  const arm = (type: string, pattern: string, extra = "") =>
    `${extra}let f(p: ${type}): Int =\n    match p with\n        ${pattern} => 1\n` +
    (type.startsWith("Vector") ? "        _ => 0\n" : "");

  test.each([
    ["a vector element", arm("Vector(Int)", "[x, (x | x)]"), "[x, (x | x)]", 1, 0],
    // A vector pattern's rest is resolved before its elements, so here the
    // caret marks the earlier text and the label the rest, as it does for a
    // plain `[x, ...x]`.
    ["a vector's rest", arm("Vector(T)", "[(A(x) | B(x)), ...x]"), "[(A(x) | B(x)), ...x]", 0, 2],
    ["a record field", arm("{a: Int, b: T}", "{a = x, b = (A(x) | B(x))}"), "{a = x, b = (A(x) | B(x))}", 1, 0],
    ["a typed pattern", arm("(Int, T)", "((x: Int), ((A(x) | B(x)): T))"), "((x: Int), ((A(x) | B(x)): T))", 1, 0],
    [
      "a declared pattern",
      arm(
        "Box",
        "(x, (A(x) | B(x)))boxed",
        "record Box = {n: Int, t: T}\npattern boxed(n: Int, t: T): Box\n" +
          "    view(box) = (box.n, box.t)\n    build(n, t) = Box({n = n, t = t})\n",
      ),
      "(x, (A(x) | B(x)))boxed",
      1,
      0,
    ],
    [
      "a guard that reads the name",
      "let f(p: (Int, T)): Int =\n    match p with\n        (x, (A(x) | B(x))) when x > 1 => 5\n        _ => 0\n",
      "(x, (A(x) | B(x)))",
      1,
      0,
    ],
  ])("%s", (_form, program, pattern, caret, label) => {
    const report = soleReport(header + "\n" + program, pattern);
    expect(report.message).toBe("`x` is bound twice in this pattern");
    expect(report.caretText).toBe("x");
    expect(report.caretAt).toBe(caret);
    expect(report.labels).toEqual([{ message: "first binding is here", at: label }]);
  });

  test("a plain binder and a rest mark the same pair as an or-pattern and a rest", () => {
    const report = soleReport(header + "\n" + arm("Vector(Int)", "[x, ...x]"), "[x, ...x]");
    expect(report.caretAt).toBe(0);
    expect(report.labels).toEqual([{ message: "first binding is here", at: 1 }]);
  });

  test("a fraction pattern names its own binder", () => {
    const report = soleReport(
      "module Main\n\nlet r = 3 // 4\nexport let out: BigInt =\n    match r with\n        (n | n) // n => n\n",
      "(n | n) // n",
      "n",
    );
    expect(report.message).toBe("`n` is bound twice in this pattern");
    expect(report.caretText).toBe("n");
    expect(report.caretAt).toBe(2);
    expect(report.labels).toEqual([{ message: "first binding is here", at: 0 }]);
  });
});

describe("#104 controls", () => {
  test("an or-pattern alone, nested, beside another binder and under `as` still runs", async () => {
    expect(await runMain(
      "module Main\n\nunion T = A(Int) | B(Int) | C(Int)\n" +
        "let f(p: (Int, T)): Int =\n    match p with\n        (y, ((A(x) | B(x)) | C(x)) as w) => y * 100 + x\n" +
        "let g(t: T): Int =\n    match t with\n        A(x) | B(x) | C(x) as v => x\n" +
        "fun h((A(x) | B(x) | C(x)): T): Int = x\n" +
        "export let out: (Int, Int, Int, Int) =\n    let (A(k) | B(k) | C(k)) = C(9)\n" +
        "    (f((1, B(2))), g(C(3)), h(A(4)), k)\n",
    )).toMatchObject({ out: [102, 3, 4, 9] });
  });

  test("an or-pattern repeating its own name across alternatives still runs (#215)", async () => {
    expect(await runMain(
      "module Main\n\nlet f(v: Vector(Int)): Int =\n    match v with\n" +
        "        [...(r | r), 1 | 2] => r.length()\n        _ => 100\n" +
        "let total(ps: Vector((Int, Int))): Int =\n    var t = 0\n" +
        "    for ((x | x), y) in ps do\n        t := t + x + y\n    t\n" +
        "export let out: (Int, Int) = (f([5, 6, 2]), total([(1, 2), (3, 4)]))\n",
    )).toMatchObject({ out: [2, 10] });
  });

  test("a name twice within each alternative is still one report per alternative", () => {
    expect(compileMain(
      "module Main\n\nunion U = C(Int, Int) | D(Int, Int)\nfun f((C(x, x) | D(x, x)): U): Int = x\n" +
        "export let out: Int = f(C(1, 2))\n",
    ).diagnostics.map(({ message }) => message)).toEqual([
      "`x` is bound twice in this pattern",
      "`x` is bound twice in this pattern",
    ]);
  });

  test("two parameters repeating a name are still a duplicate parameter", () => {
    expect(compileMain("module Main\n\nfun f({p}, p) = p\n").diagnostics.map(({ message }) => message))
      .toEqual(["duplicate parameter `p`"]);
  });
});
