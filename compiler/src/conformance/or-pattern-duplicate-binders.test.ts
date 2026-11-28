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
        expect(report.message).toBe("`x` is bound twice in this pattern; rename one occurrence");
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
    ["a vector's rest", arm("Vector(T)", "[(A(x) | B(x)), ...x]"), "[(A(x) | B(x)), ...x]", 2, 0],
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
    expect(report.message).toBe("`x` is bound twice in this pattern; rename one occurrence");
    expect(report.caretText).toBe("x");
    expect(report.caretAt).toBe(caret);
    expect(report.labels).toEqual([{ message: "first binding is here", at: label }]);
  });

  // A vector's rest is resolved before its elements, but the report reads
  // source order: the caret on the later occurrence, the label on the earlier.
  test.each([
    ["a rest at the end", "Vector(Int)", "[x, ...x]", 1],
    ["a rest in the middle, the repeat before it", "Vector(Int)", "[x, ...x, y]", 1],
    ["a rest first, the repeat after it", "Vector(Int)", "[...x, x]", 1],
    ["a rest in the middle, the repeat after it", "Vector(Int)", "[a, ...x, x]", 1],
    ["an or-pattern element, then a rest in the middle", "Vector(T)", "[(A(x) | B(x)), ...x, _]", 2],
    ["a rest, then an or-pattern element", "Vector(T)", "[...x, (A(x) | B(x))]", 1],
    ["an element, then `as` inside the rest", "Vector(Int)", "[x, ...(r as x)]", 1],
    ["`as` over a vector, naming its rest", "Vector(Int)", "([x, ...r] as r)", 1],
  ])("a vector with %s", (_shape, type, pattern, caret) => {
    const name = pattern.includes("as r") ? "r" : "x";
    const report = soleReport(header + "\n" + arm(type, pattern), pattern, name);
    expect(report.message).toBe(`\`${name}\` is bound twice in this pattern; rename one occurrence`);
    expect(report.caretText).toBe(name);
    expect(report.caretAt).toBe(caret);
    expect(report.labels).toEqual([{ message: "first binding is here", at: 0 }]);
  });

  test("an or-pattern whose alternative writes its rest first is marked at its first occurrence", () => {
    const source = header + "\n" + arm("(Int, Vector(Int))", "(x, ([...x, x] | [x]))") + "        _ => 0\n";
    const pattern = "(x, ([...x, x] | [x]))";
    const start = source.indexOf(pattern);
    const occurrences = [...pattern.matchAll(/\bx\b/gu)].map(({ index }) => start + index);
    // Only the duplicate reports are read: the alternative's two `x`s share
    // one binding, so the rest and the element also meet as a type mismatch.
    const reports = compileMain(source).diagnostics
      .filter(({ message }) => message.includes("bound twice"))
      .map(({ message, primary, labels }) => ({
        message,
        caretAt: occurrences.indexOf(primary.start.offset),
        labels: (labels ?? []).map(({ span, message }) => ({
          message,
          at: occurrences.indexOf(span.start.offset),
        })),
      }));
    const twice = "`x` is bound twice in this pattern; rename one occurrence";
    expect(reports).toEqual([
      { message: twice, caretAt: 1, labels: [{ message: "first binding is here", at: 0 }] },
      { message: twice, caretAt: 2, labels: [{ message: "first binding is here", at: 1 }] },
    ]);
  });

  test("a fraction pattern names its own binder", () => {
    const report = soleReport(
      "module Main\n\nlet r = 3 // 4\nexport let out: BigInt =\n    match r with\n        (n | n) // n => n\n",
      "(n | n) // n",
      "n",
    );
    expect(report.message).toBe("`n` is bound twice in this pattern; rename one occurrence");
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
      "`x` is bound twice in this pattern; rename one occurrence",
      "`x` is bound twice in this pattern; rename one occurrence",
    ]);
  });

  test("two parameters repeating a name are still a duplicate parameter", () => {
    expect(compileMain("module Main\n\nfun f({p}, p) = p\n").diagnostics.map(({ message }) => message))
      .toEqual(["duplicate parameter `p`"]);
  });
});

describe("#104 more shapes, each one report per mistake", () => {
  const unions = header + "union T3 = A3(Int) | B3(Int) | C3(Int)\nunion M = M1(Int, T) | M2(T, Int) | N(Int)\n\n";
  const messages = (body: string): readonly string[] =>
    compileMain(unions + body).diagnostics.map(({ message }) => message);
  const arm = (type: string, pattern: string, fallback = false) =>
    `let f(p: ${type}): Int =\n    match p with\n        ${pattern} => 1\n` + (fallback ? "        _ => 0\n" : "");
  const twice = (name: string) => `\`${name}\` is bound twice in this pattern; rename one occurrence`;

  // The check runs before an inherited name is skipped: within one alternative
  // of an enclosing or-pattern, its shared name can still be bound twice.
  test.each([
    ["a binder, then an or-pattern", "M1(x, (A(x) | B(x))) | N(x)"],
    ["an or-pattern, then a binder", "M2((A(x) | B(x)), x) | N(x)"],
  ])("a repeat inside one alternative of an enclosing or-pattern: %s", (_order, pattern) => {
    expect(messages(arm("M", pattern, true))).toEqual([twice("x")]);
  });

  test.each([
    ["a binder beside a nested or-pattern", "(Int, T3)", "(x, ((A3(x) | B3(x)) | C3(x)))", false],
    ["an or-pattern with a sibling inside, then a binder", "(W, Int)", "(P((A(x) | B(x)), _) | Q(x), x)", false],
    ["a rest, then an or-pattern", "Vector(Int)", "[...x, (x | x)]", true],
  ])("%s", (_shape, type, pattern, fallback) => {
    expect(messages(arm(type, pattern, fallback))).toEqual([twice("x")]);
  });

  test("`as` over an or-pattern repeating a binder beside it names that binder", () => {
    expect(messages(arm("(Int, T)", "(w, (A(x) | B(x)) as w)"))).toEqual([twice("w")]);
  });

  // Two parameters are two patterns, not one (Statements §5.2).
  test.each([
    ["a plain parameter, then an or-pattern", "fun f(x: Int, (A(x) | B(x)): T): Int = x\n"],
    ["an or-pattern, then a plain parameter", "fun f((A(x) | B(x)): T, x: Int): Int = x\n"],
    ["a lambda", "let g: (Int, T) -> Int = (x, (A(x) | B(x))) => x\n"],
  ])("an or-pattern parameter beside a plain one: %s", (_order, body) => {
    expect(messages(body)).toEqual(["duplicate parameter `x`"]);
  });

  test("a name missing from one alternative and bound twice is two mistakes, two reports", () => {
    expect(messages(arm("(Int, T3)", "(x, (A3(x) | B3(_) | C3(x)))"))).toEqual([
      "`x` must be bound in every alternative of an or-pattern",
      twice("x"),
    ]);
  });
});

describe("#104 more controls that run", () => {
  const run = (body: string): Promise<Record<string, unknown>> =>
    runMain("module Main\n\nunion T = A(Int) | B(Int) | C(Int)\n" + body);

  test("an or-pattern nested deep in another, beside a binder", async () => {
    expect(await run(
      "union V = P(T, T)\nlet f(p: (Int, V)): Int =\n    match p with\n" +
        "        (y, (P((A(x) | B(x)), C(z)) | P(C(z), (A(x) | B(x))))) => y * 100 + x * 10 + z\n" +
        "        _ => 0\n" +
        "export let out: (Int, Int, Int) = (f((1, P(B(2), C(3)))), f((1, P(C(4), A(5)))), f((1, P(A(1), A(1)))))\n",
    )).toMatchObject({ out: [123, 154, 0] });
  });

  test("an inherited name bound in several alternatives", async () => {
    expect(await run(
      "union M = M1(Int, T) | M2(T, Int) | N(Int, Int)\nlet f(m: M): Int =\n    match m with\n" +
        "        M1(y, (A(x) | B(x) | C(x))) | M2((A(x) | B(x) | C(x)), y) | N(x, y) => x * 10 + y\n" +
        "export let out: (Int, Int, Int) = (f(M1(1, C(2))), f(M2(B(3), 4)), f(N(5, 6)))\n",
    )).toMatchObject({ out: [21, 34, 56] });
  });

  test("two or-patterns binding different names", async () => {
    expect(await run(
      "let f(p: (T, T)): Int =\n    match p with\n        ((A(x) | B(x) | C(x)), (A(y) | B(y) | C(y))) => x * 10 + y\n" +
        "export let out: Int = f((A(1), C(2)))\n",
    )).toMatchObject({ out: 12 });
  });

  test("or-patterns in separate arms, functions and blocks do not meet", async () => {
    expect(await run(
      "let f(p: (T, Int)): Int =\n    match p with\n        ((A(x) | B(x)), 0) => x\n        (_, x) => x * 100\n" +
        "fun h1((A(x) | B(x) | C(x)): T): Int = x\n" +
        "fun h2((A(x) | B(x) | C(x)): T): Int = x * 2\n" +
        "let k1: Int =\n    let (A(x) | B(x) | C(x)) = A(3)\n    x\n" +
        "let k2: Int =\n    let (A(x) | B(x) | C(x)) = B(4)\n    x\n" +
        "export let out: (Int, Int, Int, Int, Int, Int) = (f((A(1), 0)), f((B(1), 2)), h1(C(5)), h2(A(6)), k1, k2)\n",
    )).toMatchObject({ out: [1, 200, 5, 12, 3, 4] });
  });

  test("vector rests in alternatives", async () => {
    expect(await run(
      "let f(v: Vector(Int)): Int =\n    match v with\n" +
        "        [1, x, ...r] | [...r, x, 2] => x * 10 + r.length()\n        _ => 0\n" +
        "export let out: (Int, Int, Int) = (f([1, 5, 7, 8]), f([9, 9, 6, 2]), f([3]))\n",
    )).toMatchObject({ out: [52, 62, 0] });
  });

  test("fraction alternatives", async () => {
    expect(await run(
      "let f(r: Rat): BigInt =\n    match r with\n        (n // 1) | (1 // n) => n\n        _ => 0\n" +
        "export let out: (BigInt, BigInt, BigInt) = (f(5 // 1), f(1 // 7), f(2 // 3))\n",
    )).toMatchObject({ out: [5n, 7n, 0n] });
  });

  test("record punning in alternatives", async () => {
    expect(await run(
      "union U = R({a: Int, x: Int})\nlet f(u: U): Int =\n    match u with\n" +
        "        R({a = 1, x}) | R({a = 2, x}) => x\n        _ => 0\n" +
        "export let out: (Int, Int, Int) = (f(R({a = 1, x = 4})), f(R({a = 2, x = 7})), f(R({a = 3, x = 9})))\n",
    )).toMatchObject({ out: [4, 7, 0] });
  });

  test("an or-pattern shadows an outer `let`", async () => {
    expect(await run(
      "let x = 100\nlet f(t: T): Int =\n    match t with\n        A(x) | B(x) | C(x) => x\n" +
        "export let out: (Int, Int) = (f(B(4)), x)\n",
    )).toMatchObject({ out: [4, 100] });
  });
});
