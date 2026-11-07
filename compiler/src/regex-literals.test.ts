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
    "  bad: () => { throw { name: \"RegexCompileFault\", message: \"bad (position: 3)\", position: 3 }; },",
    "  broken: () => { throw new TypeError(\"broken\"); },",
    "};",
    "export const compile = (pattern) => (values[pattern] ?? (() => ({ p: pattern })))();",
  ].join("\n");
  const builder = () => linkRegexBuilder(
    [{ path: "/Hex/Runtime/VectorTrie.js", text: trie }, { path: "/Hex/Regex.js", text: regex }],
    "/Hex/Regex.js",
    "/Hex/Runtime/VectorTrie.js",
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
    expect(builder().run("bad")).toEqual({ kind: "refused", message: "bad", position: 3 });
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
