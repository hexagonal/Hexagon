import { describe, expect, test } from "vitest";

import { linkRegexBuilder, refusedLiteral, sourceSpelling } from "./regex-literals.js";
import * as Source from "./support/source.js";

/**
 * The pieces of `regex.md` §8's check below the compiler: the report's text
 * and place, and the builder over a stand-in `Hex.Regex` whose `compile`
 * answers values no real pattern builds, so every arm of the printer runs.
 */

describe("a report spells the pattern as a string literal does (§8)", () => {
  test.each([
    ["`\\q`", "`\\\\q`"],
    ['`"`', '`\\"`'],
    ["`a\nb`", "`a\\nb`"],
    ["`a\tb`", "`a\\tb`"],
    ["`a\rb`", "`a\\rb`"],
    ["`${x}`", "`\\${x}`"],
    ["`#{x}`", "`\\#{x}`"],
    ["`$ and #`", "`$ and #`"],
    ["`\u0001`", "`\\u{1}`"],
    ["`\u007F`", "`\\u{7F}`"],
    ["plain words stay", "plain words stay"],
  ])("%j", (message, written) => {
    expect(sourceSpelling(message)).toBe(written);
  });
});

describe("a report sits on the codepoint its position names (§8)", () => {
  const file = new Source.File(Source.fileId(0), "/main.hex", 'Regex.compile("a(") |> f(pattern)');
  const literal = { pattern: "a(", span: file.span(14, 18) };
  const text = (span: Source.Span) => file.text.slice(span.start.offset, span.end.offset);

  test("inside the literal, and past its end on the closing quote", () => {
    expect(text(refusedLiteral(file, literal, "m", 2).primary)).toBe("(");
    expect(text(refusedLiteral(file, literal, "m", 3).primary)).toBe('"');
  });

  test("on the whole span where it holds no plain literal", () => {
    const other = { pattern: "a(", span: file.span(25, 32) };
    expect(text(refusedLiteral(file, other, "m", 2).primary)).toBe("pattern");
  });

  test("never on another file's literal", () => {
    const elsewhere = new Source.File(Source.fileId(1), "/other.hex", file.text);
    expect(() => refusedLiteral(elsewhere, literal, "m", 2)).toThrow(/another file holds/u);
  });
});

describe("an edit placed on the literal opens no interpolation (§8)", () => {
  // Each: the literal's source, the pattern it writes, one edit, and the
  // literal the edit leaves.
  test.each([
    // A bare `#` before an edit whose text begins with `{` is taken in and
    // written apart from it.
    ['"#\\u{7B}3,1}"', "#{3,1}", { start: 2, end: 7, text: "{1,3}" }, '"\\#{1,3}"'],
    ['"\\\\$\\u{7B}3,1}"', "\\${3,1}", { start: 3, end: 8, text: "{1,3}" }, '"\\\\\\${1,3}"'],
    // A `#` the source writes as an escape opens nothing.
    ['"\\u{23}\\u{7B}3,1}"', "#{3,1}", { start: 2, end: 7, text: "{1,3}" }, '"\\u{23}{1,3}"'],
    // An edit whose text ends in `$` before a `{`.
    ['"[$-!{]"', "[$-!{]", { start: 2, end: 5, text: "!-$" }, '"[!-\\${]"'],
    // A deletion that would leave a bare `#` or `$` before a `{`.
    ['"#(?){"', "#(?){", { start: 2, end: 5, text: "" }, '"\\#{"'],
    ['"$(?){"', "$(?){", { start: 2, end: 5, text: "" }, '"\\${"'],
  ] as const)("%s", (literal, pattern, edit, after) => {
    const file = new Source.File(Source.fileId(0), "/main.hex", `Regex.compile(${literal})`);
    const site = { pattern, span: file.span(14, 14 + literal.length) };
    const [fix] = refusedLiteral(file, site, "m", 1, [{ title: "t", edits: [edit] }]).fixes ?? [];
    let out = file.text;
    for (const each of fix!.edits) {
      out = out.slice(0, each.span.start.offset) + each.replacement + out.slice(each.span.end.offset);
    }
    expect(out.slice(14, -1)).toBe(after);
  });
});

describe("the builder writes what compile built (§8, §9)", () => {
  const trie = [
    "function iterate() { return this.items[Symbol.iterator](); }",
    "export const vector = (items) => ({ items, [Symbol.iterator]: iterate });",
    "export const empty = vector([]);",
  ].join("\n");
  const regex = [
    'import { vector } from "./Runtime/VectorTrie.js";',
    "const shared = () => { const marks = [1, 2]; return { a: marks, b: marks }; };",
    "const values = {",
    "  shared,",
    "  filled: () => ({ marks: new Array(20).fill(-1), short: [-1, -1], mixed: [...new Array(19).fill(0), 1] }),",
    "  zero: () => ({ z: -0, empty: {} }),",
    "  bare: () => Object.assign(Object.create(null), { a: 1 }),",
    "  vector: () => ({ v: vector([1, vector([2])]) }),",
    "  holes: () => ({ h: [1, , 3] }),",
    "  map: () => ({ m: new Map() }),",
    "  bad: () => { throw { name: \"RegexCompileFault\", message: \"bad (position: 3)\", position: 3, rewrites: [] }; },",
    "  fixed: () => { throw { name: \"RegexCompileFault\", message: \"m (position: 1)\", position: 1, rewrites: vector([{ title: \"t\", edits: vector([{ start: 1, end: 2, text: \"x\" }]) }]) }; },",
    "  untitled: () => { throw { name: \"RegexCompileFault\", message: \"m (position: 1)\", position: 1, rewrites: [{ edits: [] }] }; },",
    "  unspanned: () => { throw { name: \"RegexCompileFault\", message: \"m (position: 1)\", position: 1, rewrites: [{ title: \"t\", edits: [{ start: 1, text: \"x\" }] }] }; },",
    "  scalar: () => { throw { name: \"RegexCompileFault\", message: \"m (position: 1)\", position: 1, rewrites: 3 }; },",
    "  broken: () => { throw new TypeError(\"broken\"); },",
    "};",
    "export const compile = (pattern) => (values[pattern] ?? (() => ({ p: pattern })))();",
  ].join("\n");
  const syntax = [
    'import { vector } from "../Runtime/VectorTrie.js";',
    "const parsed = {",
    "  dated: () => ({ root: {}, groupCount: 2, names: [[\"year\", 1]], spans: vector([{ start: 2, length: 17 }, { start: 20, length: 10 }]) }),",
    "  none: () => ({ root: {}, groupCount: 0, names: [], spans: vector([]) }),",
    "  bad: () => { throw { name: \"RegexError\", message: \"m\", position: 1, rewrites: [] }; },",
    "  unspanned: () => ({ names: [], spans: vector([{ start: 1 }]) }),",
    "  unnamed: () => ({ names: [[1, 1]], spans: vector([]) }),",
    "  broken: () => { throw new TypeError(\"broken\"); },",
    "};",
    "const counted = () => { globalThis.__syntaxParses = (globalThis.__syntaxParses ?? 0) + 1; };",
    "const fresh = (pattern) => () => ({ names: [], spans: vector([{ start: 1, length: pattern.length }]) });",
    "export const parse = (pattern) => (counted(), (parsed[pattern] ?? fresh(pattern))());",
  ].join("\n");
  const builder = () => linkRegexBuilder(
    [
      { path: "/Hex/Runtime/VectorTrie.js", text: trie },
      { path: "/Hex/Regex.js", text: regex },
      { path: "/Hex/Regex/Syntax.js", text: syntax },
    ],
    "/Hex/Regex.js",
    "/Hex/Runtime/VectorTrie.js",
    "/Hex/Regex/Syntax.js",
  );
  const written = (pattern: string): string => {
    const outcome = builder().run(pattern);
    if (outcome.kind !== "built") throw new Error(`${pattern} was refused`);
    return outcome.write("V", "A");
  };
  const evaluated = (pattern: string): unknown =>
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    (new Function("V", "A", `return (${written(pattern)});`) as (v: unknown, a: unknown) => unknown)(
      (items: unknown[]) => ({ vector: items }),
      Array,
    );

  test("storage two fields share, written once and shared again", () => {
    expect(written("shared")).toContain("__shared0 = [1, 2]");
    const value = evaluated("shared") as { a: unknown; b: unknown };
    expect(value.a).toEqual([1, 2]);
    expect(value.a).toBe(value.b);
  });

  test("a long array holding one value throughout, filled", () => {
    expect(written("filled")).toContain("marks: new A(20).fill(-1)");
    expect(written("filled")).toContain("short: [-1, -1]");
    expect(evaluated("filled")).toEqual({
      marks: new Array(20).fill(-1),
      short: [-1, -1],
      mixed: [...new Array(19).fill(0), 1],
    });
  });

  test("-0, an empty record, an object with no prototype, and vectors", () => {
    const zero = evaluated("zero") as { z: number; empty: object };
    expect(Object.is(zero.z, -0)).toBe(true);
    expect(zero.empty).toEqual({});
    const bare = evaluated("bare") as object;
    expect(Object.getPrototypeOf(bare)).toBe(null);
    expect({ ...bare }).toEqual({ a: 1 });
    expect(evaluated("vector")).toEqual({ v: { vector: [1, { vector: [2] }] } });
  });

  test("what no program holds is a compiler defect, not a constant", () => {
    expect(() => builder().run("holes")).toThrow(/an array with holes/u);
    expect(() => builder().run("map")).toThrow(/not plain data/u);
    expect(() => builder().run("broken")).toThrow(/broken/u);
  });

  test("a fault is a refusal, its position taken off the message", () => {
    expect(builder().run("bad")).toEqual({ kind: "refused", message: "bad", position: 3, rewrites: [] });
  });

  test("a fault's rewrites are read off its vectors, and any other shape is a compiler defect", () => {
    expect(builder().run("fixed")).toEqual({
      kind: "refused",
      message: "m",
      position: 1,
      rewrites: [{ title: "t", edits: [{ start: 1, end: 2, text: "x" }] }],
    });
    for (const pattern of ["untitled", "unspanned", "scalar"]) {
      expect(() => builder().run(pattern)).toThrow(/rewrites of a shape it cannot read/u);
    }
  });

  test("a pattern's groups are read off the parse, named where the pattern names them", () => {
    expect(builder().groups("dated")).toEqual([
      { index: 1, name: "year", start: 2, length: 17 },
      { index: 2, start: 20, length: 10 },
    ]);
    expect(builder().groups("none")).toEqual([]);
    expect(builder().groups("bad")).toBeUndefined();
    expect(() => builder().groups("broken")).toThrow(/broken/u);
    for (const pattern of ["unspanned", "unnamed"]) {
      expect(() => builder().groups(pattern)).toThrow(/a pattern of a shape it cannot read/u);
    }
  });

  test("groups are kept per pattern, a refusal's too, the oldest dropped past the limit", () => {
    const parses = (): number => (globalThis as { __syntaxParses?: number }).__syntaxParses ?? 0;
    const linked = builder();
    const first = linked.groups("q0");
    expect(linked.groups("q0")).toBe(first);
    const before = parses();
    expect(linked.groups("bad")).toBeUndefined();
    expect(linked.groups("bad")).toBeUndefined();
    expect(parses()).toBe(before + 1);
    for (let index = 1; index <= 1024; index += 1) linked.groups(`q${index}`);
    const latest = linked.groups("q1024");
    expect(linked.groups("q1024")).toBe(latest);
    expect(linked.groups("q0")).not.toBe(first);
  });

  test("answers are kept per pattern, the oldest dropped past the limit", () => {
    const linked = builder();
    const first = linked.run("p0");
    expect(linked.run("p0")).toBe(first);
    for (let index = 1; index <= 1024; index += 1) linked.run(`p${index}`);
    const latest = linked.run("p1024");
    expect(linked.run("p1024")).toBe(latest);
    expect(linked.run("p0")).not.toBe(first);
  });
});
