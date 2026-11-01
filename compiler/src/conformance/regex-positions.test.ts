import fc from "fast-check";
import { beforeAll, describe, expect, test } from "vitest";

import { runMain } from "../support/test-project.js";

/**
 * #1414: **A `findFrom` start far from any cursor is read through Collections
 * Part 3 §9's table.** `findFrom` passes the cursor `(1, 0)`, so the engine used
 * to walk from the subject's start to `start` on every call, and a loop of
 * `findFrom` calls was quadratic. The engine still walks to `start` from its
 * cursor when the cursor is at or before `start` and at most 64 codepoints
 * before it, as it is in every enumeration; otherwise it reads `start`'s
 * offset as the code-unit length of `text[1..start - 1]`, which the table
 * makes amortised O(1) on a subject read again, and a `start` past
 * `length + 1` answers no match at once (`regex.md` §6.2). The
 * enumerations, `split` and the `replace` family keep their cursor and their
 * one pass; their tests here guard that they still agree with the oracle.
 *
 * The oracle for `findFrom` is the codepoint reading of `b+`: the first
 * position at or after `start` holding `b`, and the run of `b`s from there.
 */

const SOURCE = `module Main

import Regex

fun regexOf(source: String): Regex.Regex = match Regex.compile(source)
    Ok(regex) => regex
    Err(_) => regexOf("x")

let bs: Regex.Regex = regexOf("b+")
let xs: Regex.Regex = regexOf("x*")
let boundedBs: Regex.Regex = regexOf("\\\\bb+")

export let runFrom(text: String, start: Int): (Int, Int, String) = match Regex.findFrom(bs, text, start)
    Some(found) => (found.start(), found.length(), found.text())
    None => (0, 0, "")

export let boundedFrom(text: String, start: Int): (Int, Int) = match Regex.findFrom(boundedBs, text, start)
    Some(found) => (found.start(), found.length())
    None => (0, 0)

export let emptyFrom(text: String, start: Int): (Int, Int) = match Regex.findFrom(xs, text, start)
    Some(found) => (found.start(), found.length())
    None => (0, 0)

export let pieces(text: String): Vector(String) = Regex.split(bs, text)
export let replaced(text: String): String = Regex.replace(bs, text, "_")
export let emptyPieces(text: String): Vector(String) = Regex.split(xs, text)

export let count(text: String): Int =
    let digit = regexOf("[0-9]")
    var position = 1
    var total = 0
    var going = True
    while going
        match Regex.findFrom(digit, text, position)
            Some(found) =>
                total := total + 1
                position := found.start() + found.length()
            None => going := False
    total

export let pastEnd(text: String, times: Int): Int =
    let digit = regexOf("[0-9]")
    let start = String.length(text) + 2
    var misses = 0
    for _ in 1..times
        match Regex.findFrom(digit, text, start)
            Some(_) => ()
            None => misses := misses + 1
    misses
`;

type Exports = {
  readonly runFrom: (text: string, start: number) => readonly [number, number, string];
  readonly boundedFrom: (text: string, start: number) => readonly [number, number];
  readonly emptyFrom: (text: string, start: number) => readonly [number, number];
  readonly pieces: (text: string) => Iterable<string>;
  readonly replaced: (text: string) => string;
  readonly emptyPieces: (text: string) => Iterable<string>;
  readonly count: (text: string) => number;
  readonly pastEnd: (text: string, times: number) => number;
};

let main: Exports;

// Compiling `Regex` and its engine takes longer than the default hook timeout.
beforeAll(async () => {
  main = (await runMain(SOURCE)) as unknown as Exports;
}, 120_000);

const points = (text: string): string[] => Array.from(text);

function oracleRunFrom(text: string, start: number): [number, number, string] {
  const source = points(text);
  for (let at = Math.max(1, start); at <= source.length; at += 1) {
    if (source[at - 1] === "b") {
      let end = at;
      while (end <= source.length && source[end - 1] === "b") end += 1;
      return [at, end - at, source.slice(at - 1, end - 1).join("")];
    }
  }
  return [0, 0, ""];
}

/** The runs between maximal `b` runs: `split` on `b+`. */
function oracleRuns(text: string): string[] {
  const runs: string[] = [];
  let current = "";
  let inside = false;
  for (const point of points(text)) {
    if (point === "b") {
      if (!inside) runs.push(current);
      current = "";
      inside = true;
    } else {
      current += point;
      inside = false;
    }
  }
  runs.push(current);
  return runs;
}

// Letters, a pair, and lone surrogates, so `start` lands after pairs, on lone
// halves, and on both sides of the table's 32-unit threshold and 64-codepoint
// stride. `size: "max"`, because fast-check's default size draws at most ten
// pieces whatever `maxLength` says.
const unit = fc.constantFrom("a", "b", "😀", "\uD800", "\uDC00", "é");
const text = fc.array(unit, { maxLength: 150, size: "max" }).map((pieces) => pieces.join(""));

describe("positions read through the table answer what the walk answered", () => {
  test("`findFrom` from every start, before, inside and past the subject", () => {
    fc.assert(fc.property(text, (value) => {
      const size = points(value).length;
      for (let start = -1; start <= size + 2; start += 1) {
        expect([...main.runFrom(value, start)]).toEqual(oracleRunFrom(value, start));
      }
    }), { numRuns: 300 });
  });

  /**
   * An assertion at a located start reads the codepoint before it (§6.2), so
   * `\b` before a `b` holds only where that codepoint is not a word codepoint.
   */
  test("`\\b` at a located start reads the codepoint before it", () => {
    // A word codepoint by UTS #18's \w; a lone high and low surrogate in
    // that order pair into U+10000, a letter.
    const wordPattern = /^[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\u200C\u200D]$/u;
    const word = { has: (point: string): boolean => wordPattern.test(point) };
    fc.assert(fc.property(text, (value) => {
      const source = points(value);
      for (let start = 1; start <= source.length + 1; start += 1) {
        let expected: [number, number] = [0, 0];
        for (let at = start; at <= source.length; at += 1) {
          if (source[at - 1] === "b" && (at === 1 || !word.has(source[at - 2]!))) {
            let end = at;
            while (end <= source.length && source[end - 1] === "b") end += 1;
            expected = [at, end - at];
            break;
          }
        }
        expect([...main.boundedFrom(value, start)]).toEqual(expected);
      }
    }), { numRuns: 300 });
  });

  test("an empty match at the end is found from one past the end, never from two", () => {
    for (const value of ["", "a", "😀", "a".repeat(70), "😀".repeat(70), "\uD800".repeat(40)]) {
      const size = points(value).length;
      expect([...main.emptyFrom(value, size + 1)]).toEqual([size + 1, 0]);
      expect([...main.emptyFrom(value, size + 2)]).toEqual([0, 0]);
    }
  });

  test("`split` and `replace` still cut the same runs", () => {
    fc.assert(fc.property(text, (value) => {
      const runs = oracleRuns(value);
      expect(Array.from(main.pieces(value))).toEqual(runs);
      expect(main.replaced(value)).toBe(runs.join("_"));
    }), { numRuns: 1000 });
  });

  test("empty matches split between every codepoint, pairs kept whole", () => {
    expect(Array.from(main.emptyPieces("a😀\uD800b"))).toEqual(["", "a", "😀", "\uD800", "b", ""]);
  });
});

describe("the cost: a loop of `findFrom` calls is linear", () => {
  /**
   * The bound separates a walk from the start on every call from a position
   * read through the table. Before #1414 the loop below, 30,000 calls over a
   * 300,000-codepoint subject, walked about four and a half billion code
   * units: 20,000 calls over 200,000 codepoints already took 7.4 s, against
   * under a second afterwards.
   */
  const BOUND_MS = 5_000;

  test("30,000 `findFrom` calls, each starting where the last match ended", () => {
    for (const value of ["abcdefghi1".repeat(30_000), "abcd😀fghi1".repeat(30_000)]) {
      const started = Date.now();
      expect(main.count(value)).toBe(30_000);
      expect(Date.now() - started).toBeLessThan(BOUND_MS);
    }
  });

  /**
   * Past `length + 1` there is no match, and the row says so without walking
   * the subject; walking it took about 2.7 ns a codepoint, so the 20,000 calls
   * below would take some 16 s.
   */
  test("a start past `length + 1` answers at once", () => {
    const value = "abcdefghi1".repeat(30_000);
    const started = Date.now();
    expect(main.pastEnd(value, 20_000)).toBe(20_000);
    expect(Date.now() - started).toBeLessThan(BOUND_MS);
  });
});
