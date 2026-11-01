import fc from "fast-check";
import { beforeAll, describe, expect, test } from "vitest";

import { runMain } from "../support/test-project.js";

/**
 * #1410: **String positions are read once and kept.** Collections Part 3 §9
 * addresses a string by codepoint, so `s[i]` and `s[lo..hi]` must find where
 * codepoint `i` starts, and that is a scan wherever a surrogate pair can come
 * first. The emitter's `stringPositions` helper does the scan once per string
 * and keeps the answer for the four strings read most recently, so indexing one
 * string again is amortised O(1) while the worst case stays §9's O(n).
 *
 * Before it, every bracket ran `Array.from` over the whole string, so a loop of
 * `s[i]` was quadratic with a large constant, and so was every `String`
 * operation that cuts pieces (`lines`, `split`, `words`, `replace`), because
 * each piece is a slice of the whole text.
 *
 * The oracle is that old reading: `Array.from(text)`, which pairs a high
 * surrogate with a following low one and leaves every other surrogate a
 * codepoint of its own, exactly as §9 says a lone surrogate is preserved.
 */

const SOURCE = `module Main

export let index(text: String, position: Int): String = text[position]
export let slice(text: String, low: Int, high: Int): String = text[low..high]
export let sliceDown(text: String, high: Int, low: Int): String = text[Range.down(high, low)]
`;

type Exports = {
  readonly index: (text: string, position: number) => string;
  readonly slice: (text: string, low: number, high: number) => string;
  readonly sliceDown: (text: string, high: number, low: number) => string;
};

let main: Exports;

beforeAll(async () => {
  main = (await runMain(SOURCE)) as unknown as Exports;
});

/** What the old helper answered, or the fault it threw, as plain data. */
function oracleIndex(text: string, position: number): string | { fault: string; size: number } {
  const points = Array.from(text);
  if (position < 1 || position > points.length) return { fault: "IndexFault", size: points.length };
  return points[position - 1]!;
}

function oracleSlice(text: string, low: number, high: number): string {
  return Array.from(text).slice(Math.max(0, low - 1), Math.max(0, high)).join("");
}

function actualIndex(text: string, position: number): string | { fault: string; size: number } {
  try {
    return main.index(text, position);
  } catch (error) {
    const { name, size } = error as { name: string; size: number };
    return { fault: name, size };
  }
}

// Every surrogate shape: BMP letters on both sides of Latin-1, an astral
// character (a pair), and the three halves alone, which pair up with each other
// only when a high one happens to precede a low one.
const unit = fc.constantFrom("a", "7", "é", "—", "😀", "\uD800", "\uDBFF", "\uDC00");
// Up to 40 pieces, so strings land on both sides of the helper's 32-unit
// threshold: shorter ones are scanned every time, longer ones are kept.
const text = fc.array(unit, { maxLength: 40 }).map((pieces) => pieces.join(""));

describe("positions agree with the codepoint reading, short strings and kept ones", () => {
  test("`s[i]` answers the codepoint or the fault, with §5.5's size", () => {
    fc.assert(
      fc.property(text, fc.integer({ min: -2, max: 45 }), (value, position) => {
        expect(actualIndex(value, position)).toEqual(oracleIndex(value, position));
      }),
      { numRuns: 2000 },
    );
  });

  test("`s[lo..hi]` clamps like the old reading, past either end included", () => {
    fc.assert(
      fc.property(text, fc.integer({ min: -3, max: 45 }), fc.integer({ min: -3, max: 45 }), (value, low, high) => {
        expect(main.slice(value, low, high)).toBe(oracleSlice(value, low, high));
      }),
      { numRuns: 2000 },
    );
  });

  test("a descending window is still `SliceFault`, whatever the string", () => {
    expect(() => main.sliceDown("abc", 3, 1)).toThrow(expect.objectContaining({ name: "SliceFault" }));
    expect(() => main.sliceDown("😀".repeat(40), 3, 1)).toThrow(expect.objectContaining({ name: "SliceFault" }));
  });

  test("lone surrogates are positions of their own, at both ends and beside a pair", () => {
    const long = "x".repeat(32);
    for (const value of ["\uD800", "\uDC00", "\uD800x", "x\uDC00", "\uDBFF􏰀", "\uDC00\uD800", long + "\uD800", "\uDC00" + long]) {
      const points = Array.from(value);
      for (let position = 1; position <= points.length; position += 1) {
        expect(main.index(value, position)).toBe(points[position - 1]);
      }
      expect(actualIndex(value, points.length + 1)).toEqual({ fault: "IndexFault", size: points.length });
    }
  });
});

describe("the kept answers never leak between strings", () => {
  /**
   * The memo is keyed by the string's contents, holds four, and moves a hit to
   * the front. Interleaving more distinct long strings than it holds, several
   * of them the same length, sends every read through hits, misses, promotions
   * and evictions; each answer must still be its own string's.
   */
  test("interleaved reads of six long strings each answer their own string", () => {
    const strings = [
      "a".repeat(40),
      "b".repeat(40),
      "😀".repeat(20),
      "x😀".repeat(20),
      "\uD800y".repeat(20),
      "—".repeat(40),
    ];
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 1, max: 40 })), { minLength: 1, maxLength: 60 }),
        (reads) => {
          for (const [which, position] of reads) {
            const value = strings[which]!;
            expect(actualIndex(value, position)).toEqual(oracleIndex(value, position));
            expect(main.slice(value, position, position + 2)).toBe(oracleSlice(value, position, position + 2));
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  test("an equal string built separately reads the same positions", () => {
    const first = "😀z".repeat(30);
    const second = ["😀z".repeat(15), "😀z".repeat(15)].join("");
    expect(main.index(first, 3)).toBe("😀");
    expect(main.index(second, 4)).toBe("z");
    expect(main.slice(second, 59, 99)).toBe("😀z");
  });
});

describe("the cost: splitting and indexing loops are linear", () => {
  /**
   * The bound is generous on purpose; it separates linear from quadratic, not
   * fast from slow. Before #1410, `lines()` over 8,000 short lines took about
   * 4 s and this 20,000-line text would take minutes; an `s[i]` loop over
   * 23,574 characters took 5.6 s. Afterwards both programs below run in well
   * under a second.
   */
  const BOUND_MS = 5_000;

  test("`lines()` over a 20,000-line text", async () => {
    const program = await runMain(`module Main

export let count(lineCount: Int): Int =
    let text = String.join(Seq.map(1..lineCount, (n) => "line \${n}"), "\\n")
    text.lines().length()
`) as { count: (lineCount: number) => number };
    const started = Date.now();
    expect(program.count(20_000)).toBe(20_000);
    expect(Date.now() - started).toBeLessThan(BOUND_MS);
  });

  test("an `s[i]` loop over 60,000 codepoints, with and without pairs", async () => {
    const program = await runMain(`module Main

export let sevens(text: String): Int =
    var total = 0
    for position in 1..text.length()
        if text[position] == "7" then total := total + 1
    total
`) as { sevens: (text: string) => number };
    for (const value of ["1234567890".repeat(6_000), "12345😀7890".repeat(6_000)]) {
      const started = Date.now();
      expect(program.sevens(value)).toBe(6_000);
      expect(Date.now() - started).toBeLessThan(BOUND_MS);
    }
  });
});
