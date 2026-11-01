import fc from "fast-check";
import { beforeAll, describe, expect, test } from "vitest";

import { runMain } from "../support/test-project.js";

/**
 * #1413: **String's scans read the text, not a copy of it.** `stdlib/String.hex`
 * used to start most operations by copying the whole text into a vector of
 * codepoints, so `length`, `startsWith` and every search paid about 250 ns per
 * codepoint of the text on every call. They now read it through brackets,
 * which Collections Part 3 §9's position table makes amortised O(1) on a
 * string read again, and `length` finds the last nonempty one-codepoint window
 * by doubling and halving, O(log n) once the string has been read.
 *
 * The oracle is the old reading: the text as `Array.from` codepoints, which
 * pairs a high surrogate with a following low one and leaves every other
 * surrogate a codepoint of its own (String Text Processing §1).
 */

const SOURCE = `module Main

export let size(text: String): Int = text.length()
export let starts(text: String, prefix: String): Bool = text.startsWith(prefix)
export let ends(text: String, suffix: String): Bool = text.endsWith(suffix)
export let first(text: String, target: String): Int = match text.indexOf(target)
    Some(at) => at
    None => 0
export let last(text: String, target: String): Int = match text.lastIndexOf(target)
    Some(at) => at
    None => 0
export let pieces(text: String, delimiter: String): Vector(String) = text.split(delimiter)
export let code(text: String): Int = match text.toCodepoint()
    Some(value) => value
    None => -1
export let piecesCi(text: String, delimiter: String): Vector(String) = text.splitCi(delimiter)
export let replacedCi(text: String, target: String): String = text.replaceCi(target, "_")
export let lastCi(text: String, target: String): Int = match text.lastIndexOfCi(target)
    Some(at) => at
    None => 0
export let startsCi(text: String, prefix: String): Bool = text.startsWithCi(prefix)
export let endsCi(text: String, suffix: String): Bool = text.endsWithCi(suffix)
export let lined(text: String): Vector(String) = text.lines()
export let trimmedStart(text: String): String = text.trimStart()
export let trimmedEnd(text: String): String = text.trimEnd()
export let droppedFirst(text: String, count: Int): String = text.dropFirstN(count)
export let droppedLast(text: String, count: Int): String = text.dropLastN(count)
`;

type Exports = {
  readonly size: (text: string) => number;
  readonly starts: (text: string, prefix: string) => boolean;
  readonly ends: (text: string, suffix: string) => boolean;
  readonly first: (text: string, target: string) => number;
  readonly last: (text: string, target: string) => number;
  readonly pieces: (text: string, delimiter: string) => readonly string[] | Iterable<string>;
  readonly code: (text: string) => number;
  readonly piecesCi: (text: string, delimiter: string) => Iterable<string>;
  readonly replacedCi: (text: string, target: string) => string;
  readonly lastCi: (text: string, target: string) => number;
  readonly startsCi: (text: string, prefix: string) => boolean;
  readonly endsCi: (text: string, suffix: string) => boolean;
  readonly lined: (text: string) => Iterable<string>;
  readonly trimmedStart: (text: string) => string;
  readonly trimmedEnd: (text: string) => string;
  readonly droppedFirst: (text: string, count: number) => string;
  readonly droppedLast: (text: string, count: number) => string;
};

let main: Exports;

beforeAll(async () => {
  main = (await runMain(SOURCE)) as unknown as Exports;
});

const points = (text: string): string[] => Array.from(text);

/** Whether `target`'s codepoints occur in `source`'s at 0-based `at`. */
function occursAt(source: string[], target: string[], at: number): boolean {
  if (at < 0 || at + target.length > source.length) return false;
  return target.every((point, offset) => source[at + offset] === point);
}

function oracleFirst(text: string, target: string): number {
  const source = points(text);
  const wanted = points(target);
  if (wanted.length === 0) return 1;
  for (let at = 0; at < source.length; at += 1) if (occursAt(source, wanted, at)) return at + 1;
  return 0;
}

function oracleLast(text: string, target: string): number {
  const source = points(text);
  const wanted = points(target);
  if (wanted.length === 0) return source.length + 1;
  let found = 0;
  for (let at = 0; at < source.length; at += 1) if (occursAt(source, wanted, at)) found = at + 1;
  return found;
}

function oracleSplit(text: string, delimiter: string): string[] {
  const source = points(text);
  const wanted = points(delimiter);
  if (wanted.length === 0) return ["", ...source, ""];
  const result: string[] = [];
  let from = 0;
  let at = 0;
  while (at < source.length) {
    if (occursAt(source, wanted, at)) {
      result.push(source.slice(from, at).join(""));
      at += wanted.length;
      from = at;
    } else {
      at += 1;
    }
  }
  result.push(source.slice(from).join(""));
  return result;
}

// Every surrogate shape, as Part 3 §9's own tests use: letters on both sides
// of Latin-1, an astral character (a pair), and the three halves alone, which
// pair up with each other only when a high one happens to precede a low one.
const unit = fc.constantFrom("a", "b", "é", "😀", "\uD800", "\uDBFF", "\uDC00");
// Up to 150 pieces, so texts land on both sides of the position table's
// 32-unit threshold and cross its 64-codepoint stride.
const text = fc.array(unit, { maxLength: 150 }).map((pieces) => pieces.join(""));
const needle = fc.array(unit, { maxLength: 3 }).map((pieces) => pieces.join(""));

describe("the scans answer what the codepoint reading answers", () => {
  test("`length` counts codepoints, every size from 0 to past two strides", () => {
    for (const piece of ["a", "😀", "\uD800", "a😀", "\uDC00\uD800"]) {
      for (let count = 0; count <= 140; count += 1) {
        const value = piece.repeat(count);
        expect(main.size(value)).toBe(points(value).length);
      }
    }
    fc.assert(fc.property(text, (value) => {
      expect(main.size(value)).toBe(points(value).length);
    }), { numRuns: 1000 });
  });

  test("`startsWith` and `endsWith` compare codepoints, a pair never split", () => {
    fc.assert(fc.property(text, needle, (value, affix) => {
      const source = points(value);
      const wanted = points(affix);
      expect(main.starts(value, affix)).toBe(occursAt(source, wanted, 0));
      expect(main.ends(value, affix)).toBe(occursAt(source, wanted, source.length - wanted.length));
    }), { numRuns: 1000 });
    expect(main.starts("𐀀", "\uD800")).toBe(false);
    expect(main.ends("𐀀", "\uDC00")).toBe(false);
  });

  test("`indexOf`, `lastIndexOf` and `split` find the same matches", () => {
    fc.assert(fc.property(text, needle, (value, target) => {
      expect(main.first(value, target)).toBe(oracleFirst(value, target));
      expect(main.last(value, target)).toBe(oracleLast(value, target));
      expect(Array.from(main.pieces(value, target) as Iterable<string>)).toEqual(oracleSplit(value, target));
    }), { numRuns: 1000 });
  });

  /**
   * The `Ci` family compares the text's folded codepoints with the folded
   * target, so a target that folding changes must still match: an uppercase
   * letter, and `ß`, whose full folding is `ss` (String Text Processing §5).
   */
  test("the `Ci` searches match a target that folding changes", () => {
    expect(Array.from(main.piecesCi("aXbxc", "X"))).toEqual(["a", "b", "c"]);
    expect(Array.from(main.piecesCi("maßeMASSE", "SS"))).toEqual(["ma", "eMA", "E"]);
    expect(main.replacedCi("aXbxc", "X")).toBe("a_b_c");
    expect(main.replacedCi("Straße", "SS")).toBe("Stra_e");
    expect(main.lastCi("aXbxc", "X")).toBe(4);
    expect(main.lastCi("Straße", "SS")).toBe(5);
    expect(main.startsCi("Straße", "STRASS")).toBe(true);
    expect(main.startsCi("Straße", "STRASSX")).toBe(false);
    expect(main.endsCi("Straße", "SSE")).toBe(true);
    expect(main.endsCi("Straße", "XSSE")).toBe(false);
    for (const value of ["", "Straße"]) {
      expect(main.startsCi(value, "")).toBe(true);
      expect(main.endsCi(value, "")).toBe(true);
    }
  });

  /**
   * `lines` looks one past a CR for its LF, the trims run off either end of
   * a text that is all `White_Space`, and the drops count from either end.
   */
  test("`lines`, the trims and the drops at the ends of the text", () => {
    const spaced = fc.array(fc.constantFrom("a", "😀", "\uD800", " ", "\r", "\n"), { maxLength: 80 })
      .map((pieces) => pieces.join(""));
    const blank = (point: string): boolean => point === " " || point === "\r" || point === "\n";
    fc.assert(fc.property(spaced, fc.integer({ min: -2, max: 90 }), (value, count) => {
      const source = points(value);
      const lines: string[] = [];
      let current = "";
      let pending = false;
      for (let at = 0; at < source.length; at += 1) {
        const point = source[at]!;
        if (point === "\r" || point === "\n") {
          lines.push(current);
          current = "";
          pending = false;
          if (point === "\r" && source[at + 1] === "\n") at += 1;
        } else {
          current += point;
          pending = true;
        }
      }
      if (pending) lines.push(current);
      expect(Array.from(main.lined(value))).toEqual(lines);
      let start = 0;
      while (start < source.length && blank(source[start]!)) start += 1;
      let end = source.length;
      while (end > 0 && blank(source[end - 1]!)) end -= 1;
      expect(main.trimmedStart(value)).toBe(source.slice(start).join(""));
      expect(main.trimmedEnd(value)).toBe(source.slice(0, end).join(""));
      const kept = Math.max(count, 0);
      expect(main.droppedFirst(value, count)).toBe(source.slice(kept).join(""));
      expect(main.droppedLast(value, count)).toBe(source.slice(0, Math.max(source.length - kept, 0)).join(""));
    }), { numRuns: 1000 });
    expect(Array.from(main.lined("a\r"))).toEqual(["a"]);
    expect(main.trimmedStart(" ".repeat(40))).toBe("");
    expect(main.trimmedEnd(" ")).toBe("");
  });

  test("`toCodepoint` still answers only for one scalar value", () => {
    expect(main.code("😀")).toBe(0x1F600);
    expect(main.code("a")).toBe(0x61);
    expect(main.code("")).toBe(-1);
    expect(main.code("ab")).toBe(-1);
    expect(main.code("\uD800")).toBe(-1);
    expect(main.code("😀".repeat(40))).toBe(-1);
  });
});

describe("the cost: a question about a long text no longer copies it", () => {
  /**
   * The bound separates "the whole text on every call" from "a scan once,
   * then O(log n) or the prefix". Before #1413, 1,000 `length` calls on a
   * 205,307-character text took 48 s and 1,000 `startsWith` calls 50 s; the
   * loops below, on 100,000 codepoints, would take over 20 s each. Afterwards
   * each runs in tens of milliseconds.
   */
  const BOUND_MS = 5_000;

  test("1,000 `length`, `startsWith`, `endsWith` and `contains` calls on a 100,000-codepoint text", async () => {
    const program = await runMain(`module Main

export let asked(text: String): Int =
    var total = 0
    for _ in 1..1000
        total := total + text.length()
        if text.startsWith("12") then total := total + 1
        if text.endsWith("90") then total := total + 1
        if text.contains("34") then total := total + 1
    total
`) as { asked: (text: string) => number };
    for (const value of ["1234567890".repeat(10_000), "1234😀67890".repeat(10_000)]) {
      const started = Date.now();
      expect(program.asked(value)).toBe(1000 * (points(value).length + 3));
      expect(Date.now() - started).toBeLessThan(BOUND_MS);
    }
  });

  /**
   * Collections Part 3 §9's memo tells two strings of one length apart by
   * comparing them, which costs the prefix they share. A search that read
   * its target through brackets too would pay that on every bracket, and
   * with a target as long as the text that is quadratic: read that way,
   * these four took 23 s together on 300,000 ASCII codepoints and 52 s with
   * pairs, against under a second when the target is read once.
   */
  test("a target as long as the text and sharing its contents is read once", () => {
    for (const piece of ["1234567890", "1234😀67890"]) {
      const value = piece.repeat(30_000);
      const copy = Array.from(value).join("");
      const near = Array.from(value).slice(0, -1).join("") + "x";
      const started = Date.now();
      expect(main.starts(value, copy)).toBe(true);
      expect(main.ends(value, copy)).toBe(true);
      expect(main.first(value, near)).toBe(0);
      expect(Array.from(main.piecesCi(value, copy))).toEqual(["", ""]);
      expect(Date.now() - started).toBeLessThan(BOUND_MS);
    }
  });

  /**
   * The memo finds a string equal to one it keeps by comparing contents, and
   * on that hit keeps the string just read, so a copy of a text already read,
   * built separately, pays one comparison rather than one per bracket. Kept
   * the other way, `indexOf` over this copy compared 300,000 code units at
   * every bracket.
   */
  test("a separately built copy of a text already read is scanned in one pass", () => {
    for (const piece of ["1234567890", "1234😀67890"]) {
      const value = piece.repeat(30_000);
      expect(main.size(value)).toBe(points(value).length);
      const fresh = Array.from(value).join("");
      const started = Date.now();
      expect(main.first(fresh, "x")).toBe(0);
      expect(Array.from(main.lined(fresh))).toEqual([value]);
      expect(Date.now() - started).toBeLessThan(BOUND_MS);
    }
  });
});
