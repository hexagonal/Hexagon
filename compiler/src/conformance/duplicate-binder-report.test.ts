/**
 * The report for a name bound twice in one pattern (Pattern Matching §2.1,
 * §12; #104): every repeat gets a caret of its own, labelled at the first
 * occurrence, and where nothing reads the name the report offers to drop the
 * later occurrence — `_` in a subpattern binder's place, or the `as` clause
 * removed — an edit that leaves no duplicate behind.
 */

import { describe, expect, test } from "vitest";

import { compileMain } from "../support/test-project.js";

const header = "module Main\n\nunion T = A(Int) | B(Int)\n";

/** One `match` arm over `pattern`, its body `body`, with a fallback arm. */
const arm = (type: string, pattern: string, body = "1") =>
  `${header}let f(p: ${type}): Int =\n    match p with\n        ${pattern} => ${body}\n        _ => 0\n`;

const twice = (name: string) => `\`${name}\` is bound twice in this pattern; rename one occurrence`;

/** The duplicate reports of `source`, in order. */
function duplicates(source: string) {
  return compileMain(source).diagnostics.filter(({ message }) => message.includes("bound twice"));
}

function messages(source: string): readonly string[] {
  return compileMain(source).diagnostics.map(({ message }) => message);
}

/** `source` with the edits of every report's one fix applied together. */
function appliedAll(source: string, reports: ReturnType<typeof duplicates>): string {
  return reports
    .flatMap((report) => {
      expect(report.fixes).toHaveLength(1);
      return report.fixes![0]!.edits;
    })
    .sort((a, b) => b.span.start.offset - a.span.start.offset)
    .reduce(
      (text, edit) => text.slice(0, edit.span.start.offset) + edit.replacement + text.slice(edit.span.end.offset),
      source,
    );
}

/** `source` with the edits of the report's one fix applied. */
function applied(source: string, report: ReturnType<typeof duplicates>[number]): string {
  expect(report.fixes).toHaveLength(1);
  const [fix] = report.fixes!;
  expect(fix!.suggestion).toBe(true);
  return [...fix!.edits]
    .sort((a, b) => b.span.start.offset - a.span.start.offset)
    .reduce(
      (text, edit) => text.slice(0, edit.span.start.offset) + edit.replacement + text.slice(edit.span.end.offset),
      source,
    );
}

describe("#104 every repeat gets its own caret, labelled at the first occurrence", () => {
  test.each([
    ["a binder and a vector with an element and a rest", `${header}export let out: Int =\n    let (x, [x, ...x]) = (1, [2])\n    0\n`, "(x, [x, ...x])"],
    ["a vector with a rest between two repeats", arm("Vector(Int)", "[x, ...x, x]"), "[x, ...x, x]"],
    ["a vector with its rest last", arm("Vector(Int)", "[x, x, ...x]"), "[x, x, ...x]"],
    ["a tuple", arm("(Int, Int, Int)", "(x, x, x)"), "(x, x, x)"],
    ["a tuple around an or-pattern", arm("(Int, T, Int)", "(x, (A(x) | B(x)), x)"), "(x, (A(x) | B(x)), x)"],
    ["a vector with an or-pattern, an element and a rest", arm("Vector(T)", "[(A(x) | B(x)), x, ...x]"), "[(A(x) | B(x)), x, ...x]"],
  ])("%s", (_shape, source, pattern) => {
    const start = source.indexOf(pattern);
    // The or-pattern's two `x`s are one binder, marked at its first.
    const occurrences = [...pattern.matchAll(/\bx\b/gu)]
      .map(({ index }) => start + index)
      .filter((offset) => !pattern.includes("B(x)") || offset !== start + pattern.indexOf("B(x)") + 2);
    const reports = duplicates(source);
    expect(reports.map(({ message }) => message)).toEqual(occurrences.slice(1).map(() => twice("x")));
    expect(reports.map(({ primary }) => primary.start.offset).sort((a, b) => a - b))
      .toEqual(occurrences.slice(1));
    for (const report of reports) {
      expect(report.labels).toEqual([{ span: expect.anything(), message: "first binding is here" }]);
      expect(report.labels![0]!.span.start.offset).toBe(occurrences[0]);
    }
  });
});

describe("#104 an unused repeat is offered its edit", () => {
  test.each([
    ["a tuple", arm("(Int, Int)", "(x, x)"), "(x, _)"],
    ["a rest at the end", arm("Vector(Int)", "[x, ...x]"), "[x, ..._]"],
    ["a rest first", arm("Vector(Int)", "[...x, x]"), "[...x, _]"],
    ["a punned record field", arm("{a: Int, x: Int}", "{a = x, x}"), "{a = x, x = _}"],
    ["a constructor under `as`", arm("T", "A(x) as x"), "A(x)"],
    ["a tuple under `as`", arm("(Int, Int)", "(p, q) as p"), "(p, q)"],
    ["an or-pattern under `as`", arm("T", "(A(x) | B(x)) as x"), "(A(x) | B(x))"],
    ["an or-pattern, then a binder", arm("(T, Int)", "((A(x) | B(x)), x)"), "((A(x) | B(x)), _)"],
    ["an or-pattern, then a rest", arm("Vector(T)", "[(A(x) | B(x)), ...x]"), "[(A(x) | B(x)), ..._]"],
    ["a typed binder", arm("(Int, Int)", "((x: Int), (x: Int))"), "((x: Int), (_: Int))"],
    ["a fraction", `${header}let f(r: Rat): Int =\n    match r with\n        x // x => 1\n`, "x // _"],
    ["two fields binding one name", arm("{a: Int, b: Int}", "{a = x, b = x}"), "{a = x, b = _}"],
  ])("in a match arm, %s", (_shape, source, rewritten) => {
    const [report, ...rest] = duplicates(source);
    expect(rest).toEqual([]);
    const fixed = applied(source, report!);
    expect(fixed).toContain(rewritten);
    // Nothing but the duplicate goes: the program's other reports stay as they were.
    expect(messages(fixed)).toEqual(messages(source).filter((message) => !message.includes("bound twice")));
  });

  test.each([
    ["a `let` in a block", `${header}export let out: Int =\n    let (x, x) = (1, 2)\n    3\n`, "let (x, _)"],
    ["a module-level `let`", `${header}let (x, x) = (1, 2)\nexport let out: Int = 3\n`, "let (x, _)"],
    ["a function parameter", `${header}fun f((x, x): (Int, Int)): Int = 1\nexport let out: Int = f((1, 2))\n`, "fun f((x, _)"],
    ["a lambda parameter", `${header}let g: ((Int, Int)) -> Int = ((x, x)) => 1\nexport let out: Int = g((1, 2))\n`, "((x, _)) =>"],
    [
      "a `for` head",
      `${header}let total(ps: Vector((Int, Int))): Int =\n    var t = 0\n    for (x, x) in ps do\n        t := t + 1\n    t\n` +
        "export let out: Int = total([(1, 2)])\n",
      "for (x, _) in",
    ],
  ])("in %s", (_position, source, rewritten) => {
    const [report, ...rest] = duplicates(source);
    expect(rest).toEqual([]);
    const fixed = applied(source, report!);
    expect(fixed).toContain(rewritten);
    // Nothing but the duplicate goes: the program's other reports stay as they were.
    expect(messages(fixed)).toEqual(messages(source).filter((message) => !message.includes("bound twice")));
  });
});

describe("#104 three occurrences", () => {
  test.each([
    ["a tuple", arm("(Int, Int, Int)", "(x, x, x)"), "(x, _, _)"],
    ["a vector with a rest between", arm("Vector(Int)", "[x, ...x, x]"), "[x, ..._, _]"],
  ])("in %s, unused, every repeat is offered its edit, and together they compile", (_shape, source, rewritten) => {
    const reports = duplicates(source);
    expect(reports).toHaveLength(2);
    const fixed = appliedAll(source, reports);
    expect(fixed).toContain(rewritten);
    expect(messages(fixed)).toEqual(messages(source).filter((message) => !message.includes("bound twice")));
  });

  test.each([
    ["a tuple", arm("(Int, Int, Int)", "(x, x, x)", "x")],
    ["a vector with a rest between", arm("Vector(Int)", "[x, ...x, x]", "x.length()")],
  ])("in %s, read by the body, no repeat is offered an edit", (_shape, source) => {
    const reports = duplicates(source);
    expect(reports).toHaveLength(2);
    for (const report of reports) expect(report.fixes ?? []).toEqual([]);
  });
});

describe("#104 a repeat is offered no edit", () => {
  test.each([
    ["an arm body reads the name", arm("(Int, Int)", "(x, x)", "x")],
    ["a guard reads the name", arm("(Int, Int)", "(x, x) when x > 1", "2")],
    ["an `as` binder the body reads", arm("T", "A(x) as x", "x")],
    ["a block's later statement reads the name", `${header}export let out: Int =\n    let (x, x) = (1, 2)\n    x\n`],
    ["a later item reads the name", `${header}let (x, x) = (1, 2)\nexport let out: Int = x\n`],
    ["a function body reads the name", `${header}fun f((x, x): (Int, Int)): Int = x\nexport let out: Int = f((1, 2))\n`],
    ["a lambda body reads the name", `${header}let g: ((Int, Int)) -> Int = ((x, x)) => x\nexport let out: Int = g((1, 2))\n`],
    [
      "a `for` body reads the name",
      `${header}let total(ps: Vector((Int, Int))): Int =\n    var t = 0\n    for (x, x) in ps do\n        t := t + x\n    t\n` +
        "export let out: Int = total([(1, 2)])\n",
    ],
    // An or-pattern's alternatives must bind the same names (§2.6), so its
    // occurrence is never dropped alone.
    ["the later occurrence is an or-pattern", arm("(Int, T)", "(x, (A(x) | B(x)))")],
    // The repeated field is refused on its own, and no binder edit lifts that.
    [
      "a punned field repeated",
      arm("U", "R({x, x})").replace("union T", "union U = R({x: Int})\nunion T"),
    ],
    [
      "both occurrences are inside an or-pattern's alternative",
      arm("U", "C(x, x) | D(x, x)").replace("union T", "union U = C(Int, Int) | D(Int, Int)\nunion T"),
    ],
  ])("%s", (_case, source) => {
    const reports = duplicates(source);
    expect(reports.length).toBeGreaterThan(0);
    for (const report of reports) expect(report.fixes ?? []).toEqual([]);
  });
});
