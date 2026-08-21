import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for **`Rat.toFloat`, the sanctioned exit from the exact world** —
 * #526, `rat.md` §6/§7/§8/§9 and `primitive-types.md` §3's `FloatRangeError`.
 *
 * Within range the answer is the **correctly rounded nearest double**, rounded
 * **once**, ties to even. §7 states the implementation constraint that makes
 * that claim testable: `Number(top) / Number(bottom)` rounds twice once either
 * magnitude passes 2^53, so the pins below are known *double-rounding traps* —
 * ratios where the naive route lands on the neighbouring double — and not merely
 * round-trips. A second trap lives in the subnormal range, where a scale to 53
 * bits followed by a float multiply rounds a second time on the coarser
 * `2 ** -1074` grid; the straddle pin there fails against that implementation
 * specifically.
 *
 * `FloatRangeError` (`stdlib/Float.hex`, the range being `Float`'s rather than
 * any one door's) is thrown by the single guard of §6 — *the result must be
 * finite, and nonzero when the input is nonzero* — under §8's one provenance-
 * tagged message for both ends.
 *
 * The expected doubles are **not** transcribed from the implementation. They are
 * recomputed here by `nearestDouble`, a deliberately *different* algorithm: a
 * binary search over the monotone IEEE bit patterns, deciding every comparison
 * by exact `BigInt` cross-multiplication and never scaling or shifting anything.
 * Two implementations agreeing on a trap is evidence; one implementation
 * agreeing with a copy of itself is not.
 *
 * `rat.md` §9 requires the emitted JavaScript to be *executed*: correct rounding
 * is a claim about what the module computes. Every program here is byte-distinct
 * from its neighbours — emitted modules mount as `data:` URLs cached by their
 * full text, so two identical programs would share one module instance and one
 * of the pins would be measuring the other's.
 */

const STDLIB = import.meta.glob("../../../stdlib/*.hex", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** `stdlib/Rat.hex`, the home module of the function under test. */
const RAT = (() => {
  const entry = Object.entries(STDLIB).find(([path]) => path.endsWith("/Rat.hex"));
  if (entry === undefined) throw new Error("no stdlib/Rat.hex");
  return entry[1];
})();

function withRat(source: string): readonly (readonly [string, string])[] {
  return [
    ["/main.hex", `import * as Rat from "./Rat"\n${source}`],
    ["/Rat.hex", RAT],
  ];
}

/** Compiles a `Rat` client and executes it, returning `/main.hex`'s exports. */
async function runRat(source: string): Promise<Record<string, unknown>> {
  return runProject(withRat(source));
}

/** What a thunk threw, or `undefined` if it returned. */
function threw(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

// -- The independent reference. ---------------------------------------------
//
// Deliberately *not* the scale-and-shift of `stdlib/Rat.hex`. This one never
// shifts a ratio at all: it binary-searches the 64-bit IEEE patterns, which
// order monotonically over the non-negative doubles, for the largest double at
// or below the exact ratio, then chooses between that double and its successor
// by comparing the two exact gaps. Every comparison is integer
// cross-multiplication, so nothing rounds anywhere in here.

const scratch = new DataView(new ArrayBuffer(8));

/** The double with this bit pattern. */
function fromPattern(pattern: bigint): number {
  scratch.setBigUint64(0, pattern);
  return scratch.getFloat64(0);
}

/** The exact value of a non-negative finite double, as a `[top, bottom]` pair. */
function exactly(value: number): readonly [bigint, bigint] {
  scratch.setFloat64(0, value);
  const pattern = scratch.getBigUint64(0);
  const exponent = (pattern >> 52n) & 0x7ffn;
  const fraction = pattern & 0xfffffffffffffn;
  if (exponent === 0n) return [fraction, 1n << 1074n];
  const shift = 1075n - exponent;
  const significand = fraction + (1n << 52n);
  return shift >= 0n ? [significand, 1n << shift] : [significand << -shift, 1n];
}

/** The largest finite double's bit pattern. */
const LARGEST_FINITE = 0x7fefffffffffffffn;

/** `-1`, `0`, `1` as `left` orders against `right`, both non-negative ratios. */
function compareRatios(
  leftTop: bigint,
  leftBottom: bigint,
  rightTop: bigint,
  rightBottom: bigint,
): number {
  const left = leftTop * rightBottom;
  const right = rightTop * leftBottom;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * `top / bottom` as the correctly rounded nearest double, ties to even, or the
 * marker for whichever end of `Rat.toFloat`'s guard the value fails.
 */
function nearestDouble(top: bigint, bottom: bigint): number | "overflow" | "erasure" {
  if (top === 0n) return 0;
  const negative = top < 0n;
  const magnitude = negative ? -top : top;
  const [largestTop, largestBottom] = exactly(fromPattern(LARGEST_FINITE));
  if (compareRatios(largestTop, largestBottom, magnitude, bottom) < 0) {
    // Past the largest finite double, the tie is at the midpoint between it and
    // 2^1024, which rounds *to* 2^1024 — an even significand — and so to an
    // infinity.
    const threshold = (1n << 1024n) - (1n << 970n);
    if (compareRatios(magnitude, bottom, threshold, 1n) >= 0) return "overflow";
    const largest = fromPattern(LARGEST_FINITE);
    return negative ? -largest : largest;
  }
  let low = 0n;
  let high = LARGEST_FINITE;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    const [candidateTop, candidateBottom] = exactly(fromPattern(middle));
    if (compareRatios(candidateTop, candidateBottom, magnitude, bottom) <= 0) low = middle;
    else high = middle - 1n;
  }
  const [belowTop, belowBottom] = exactly(fromPattern(low));
  const [aboveTop, aboveBottom] = exactly(fromPattern(low + 1n));
  const lowGapTop = magnitude * belowBottom - belowTop * bottom;
  const lowGapBottom = bottom * belowBottom;
  const highGapTop = aboveTop * bottom - magnitude * aboveBottom;
  const highGapBottom = bottom * aboveBottom;
  const order = compareRatios(lowGapTop, lowGapBottom, highGapTop, highGapBottom);
  const chosen = order < 0
    ? fromPattern(low)
    : order > 0
    ? fromPattern(low + 1n)
    : fromPattern((low & 1n) === 0n ? low : low + 1n);
  if (chosen === 0) return "erasure";
  return negative ? -chosen : chosen;
}

/** The route §7 forbids, for the traps to differ from. */
function naive(top: bigint, bottom: bigint): number {
  return Number(top) / Number(bottom);
}

describe("the control: the harness reports a failure rather than passing it", () => {
  test("a broken `Rat` client is refused", () => {
    const diagnostics = compileFiles(withRat("export let f: Float = Rat.toFloatz(1)\n"))
      .diagnostics.map(({ message }) => message);
    expect(diagnostics).not.toEqual([]);
  });

  test("the reference reproduces the doubles the host itself computes exactly", () => {
    // A ratio a host division already rounds once is not evidence about the
    // reference; these are the ones where the host's own answer is provably the
    // correctly rounded one, so a broken reference shows up here rather than in
    // a pin.
    const exact: readonly (readonly [bigint, bigint])[] = [
      [1n, 2n],
      [1n, 4n],
      [3n, 8n],
      [-7n, 4n],
      [10n, 1n],
    ];
    for (const [top, bottom] of exact) {
      expect(nearestDouble(top, bottom)).toBe(Number(top) / Number(bottom));
    }
  });
});

describe("within range: the correctly rounded nearest double (rat.md §9)", () => {
  test("the §9 lines: `1/2`, `1/3`, `-7/4`", async () => {
    const exports = await runRat(
      "// the acceptance lines\n" +
      "export let half: Float = Rat.toFloat(Rat.create(1, 2))\n" +
      "export let third: Float = Rat.toFloat(Rat.create(1, 3))\n" +
      "export let negative: Float = Rat.toFloat(Rat.create(-7, 4))\n" +
      "export let shownThird: String = show(Rat.toFloat(Rat.create(1, 3)))\n",
    );

    expect(exports["half"]).toBe(0.5);
    expect(exports["third"]).toBe(0.3333333333333333);
    expect(exports["negative"]).toBe(-1.75);
    // The nearest double to `1/3` shows as its shortest round-tripping decimal.
    expect(exports["shownThird"]).toBe("0.3333333333333333");
  });

  test("zero converts to `0.0` and does not throw", async () => {
    // The guard's second half is conditioned on a *nonzero* input; the canonical
    // zero is `0n / 1n`, and every spelling of it reduces to that.
    const exports = await runRat(
      "// zero\n" +
      "export let zero: Float = Rat.toFloat(Rat.create(0, 1))\n" +
      "export let alsoZero: Float = Rat.toFloat(Rat.create(0, 99))\n" +
      "export let negatedZero: Float = Rat.toFloat(Rat.create(0, -7))\n",
    );

    expect(exports["zero"]).toBe(0);
    expect(exports["alsoZero"]).toBe(0);
    expect(exports["negatedZero"]).toBe(0);
  });

  test("exact powers of two round-trip, both directions of the exponent", async () => {
    // Nothing rounds at these, so a mis-assembled `significand * 2 ** -scale`
    // shows up as an exact mismatch rather than a last-bit one.
    const exports = await runRat(
      "// powers of two\n" +
      "export let up: Float = Rat.toFloat(Rat.create(2n ** 200, 1n))\n" +
      "export let down: Float = Rat.toFloat(Rat.create(1n, 2n ** 200))\n" +
      "export let unit: Float = Rat.toFloat(Rat.create(1, 1))\n" +
      "export let deep: Float = Rat.toFloat(Rat.create(1n, 2n ** 1000))\n",
    );

    expect(exports["up"]).toBe(2 ** 200);
    expect(exports["down"]).toBe(2 ** -200);
    expect(exports["unit"]).toBe(1);
    expect(exports["deep"]).toBe(2 ** -1000);
  });

  test("the sign is carried, not recomputed", async () => {
    const exports = await runRat(
      "// signs\n" +
      "export let positive: Float = Rat.toFloat(Rat.create(1, 3))\n" +
      "export let negative: Float = Rat.toFloat(Rat.create(-1, 3))\n" +
      "export let normalized: Float = Rat.toFloat(Rat.create(1, -3))\n",
    );

    expect(exports["negative"]).toBe(-(exports["positive"] as number));
    expect(exports["normalized"]).toBe(-(exports["positive"] as number));
  });

  test("`x.toFloat()` reaches the same function (Method Syntax companion dispatch)", async () => {
    const exports = await runRat(
      "// dot call\n" +
      "let value: Rat.Rat = Rat.create(-7, 4)\n" +
      "export let dotted: Float = value.toFloat()\n" +
      "export let qualified: Float = Rat.toFloat(value)\n",
    );

    expect(exports["dotted"]).toBe(-1.75);
    expect(exports["qualified"]).toBe(-1.75);
  });
});

describe("one rounding: the double-rounding traps rat.md §7 asks for", () => {
  /**
   * Each row is a ratio at which `Number(top) / Number(bottom)` lands on the
   * *neighbouring* double. The expected value is `nearestDouble`'s, computed
   * above by the independent search; `naive` is asserted to differ, so a pin
   * that stopped discriminating would be visible rather than silently vacuous.
   */
  const TRAPS: readonly (readonly [string, bigint, bigint, string])[] = [
    [
      "a numerator past 2^53 rounds before the division",
      (1n << 53n) + 1n,
      7n,
      "Rat.create(2n ** 53 + 1n, 7n)",
    ],
    [
      "both magnitudes past 2^53, quotient below one",
      10542788741676953163148n,
      1909420290621286325459447n,
      "Rat.create(10542788741676953163148n, 1909420290621286325459447n)",
    ],
    [
      "both magnitudes past 2^53, quotient above one",
      52519350737876288937318n,
      23624121303055581918521n,
      "Rat.create(52519350737876288937318n, 23624121303055581918521n)",
    ],
    [
      "both magnitudes past 2^53, a large quotient",
      180359644842841657949488n,
      1439454445681207339n,
      "Rat.create(180359644842841657949488n, 1439454445681207339n)",
    ],
  ];

  for (const [what, top, bottom, spelling] of TRAPS) {
    test(`${what}`, async () => {
      const expected = nearestDouble(top, bottom);
      expect(typeof expected).toBe("number");
      // The trap is only a trap while the forbidden route disagrees.
      expect(naive(top, bottom)).not.toBe(expected);

      const exports = await runRat(
        `// trap: ${what}\n` +
        `export let converted: Float = Rat.toFloat(${spelling})\n`,
      );

      expect(exports["converted"]).toBe(expected);
    });
  }

  test("every trap survives `Rat.create`'s reduction", () => {
    // The load-bearing guard on the fixtures. `Rat.create` reduces, so a pair
    // sharing a factor reaches `toFloat` as some *other* ratio — and a ratio
    // that reduces to a small one is no trap at all, however large its written
    // form. Each pair here is already canonical, so what the test writes is what
    // the function converts.
    for (const [, top, bottom] of TRAPS) {
      let left = top < 0n ? -top : top;
      let right = bottom;
      while (right !== 0n) [left, right] = [right, left % right];
      expect(left).toBe(1n);
    }
  });

  test("the traps are traps: the naive route is a neighbouring double, not a wild one", () => {
    // Guarding the fixtures themselves — a transcription slip that made `naive`
    // differ by orders of magnitude would leave the pins above passing while
    // testing nothing about *rounding*.
    for (const [, top, bottom] of TRAPS) {
      const expected = nearestDouble(top, bottom) as number;
      const ratio = naive(top, bottom) / expected;
      expect(ratio).toBeGreaterThan(1 - 2 ** -50);
      expect(ratio).toBeLessThan(1 + 2 ** -50);
    }
  });
});

describe("the subnormal range: the rounding grid narrows before the rounding", () => {
  test("a value that rounds to a nonzero subnormal converts without throwing", async () => {
    // `2 ** -1060` is exactly a subnormal. The naive route answers `0` here,
    // because `Number(2n ** 1060n)` is an infinity.
    const exports = await runRat(
      "// subnormal, exact\n" +
      "export let tiny: Float = Rat.toFloat(Rat.create(1n, 2n ** 1060))\n" +
      "export let smallest: Float = Rat.toFloat(Rat.create(1n, 2n ** 1074))\n",
    );

    expect(exports["tiny"]).toBe(nearestDouble(1n, 1n << 1060n));
    expect(exports["tiny"]).toBe(2 ** -1060);
    expect(exports["smallest"]).toBe(5e-324);
  });

  test("just past half the smallest subnormal rounds up to it", async () => {
    // `3 / 2^1076` is `1.5 * 2^-1075`, above the halfway point, so it rounds to
    // the smallest subnormal rather than erasing.
    const exports = await runRat(
      "// subnormal, just above half\n" +
      "export let survives: Float = Rat.toFloat(Rat.create(3n, 2n ** 1076))\n",
    );

    expect(exports["survives"]).toBe(nearestDouble(3n, 1n << 1076n));
    expect(exports["survives"]).toBe(5e-324);
  });

  test("a 53-bit rounding followed by a scale gives the wrong subnormal here", async () => {
    // The straddle. The exact value is a hair *below* the midpoint between two
    // adjacent subnormals, so the correct answer rounds **down**:
    //
    //   value = (2 * m + 1) * 2^-1075 - 2^-1200,  with m = 2^45 + 1 (odd)
    //
    // Rounding to 53 significant bits first discards that hair — the 53-bit grid
    // near 2^-1029 is far coarser than 2^-1200 — leaving *exactly* the midpoint;
    // scaling that onto the `2 ** -1074` subnormal grid then rounds a second
    // time, and ties-to-even at an odd `m` rounds **up**. The two answers are
    // adjacent subnormals, so this pin fails against that implementation and
    // passes only when the retained width is cut before the single rounding.
    const top = (1n << 171n) + 3n * (1n << 125n) - 1n;
    const bottom = 1n << 1200n;
    const correct = nearestDouble(top, bottom) as number;
    const grid = 2 ** -1074; // the subnormal grid step, exactly
    const wrong = 35184372088834 * grid; // (m + 1) * 2^-1074
    expect(correct).toBe(35184372088833 * grid); // m * 2^-1074
    expect(correct).not.toBe(wrong);

    const exports = await runRat(
      "// subnormal straddle\n" +
      "export let straddle: Float =\n" +
      "    Rat.toFloat(Rat.create(2n ** 171 + 3n * (2n ** 125) - 1n, 2n ** 1200))\n",
    );

    expect(exports["straddle"]).toBe(correct);
    expect(exports["straddle"]).not.toBe(wrong);
  });
});

describe("the guard: finite, and nonzero when the input is (rat.md §6/§8)", () => {
  test("the §9 overflow line throws `FloatRangeError`, message pinned", async () => {
    // The spelling is §9's own; the bare digits ride Numeric Literals §5.1's
    // argument-seat lift onto `BigInt`.
    const exports = await runRat(
      "// overflow\n" +
      "export let boom(): Float = Rat.toFloat(Rat.create(2 ** 1100, 1))\n",
    );

    expect(threw(exports["boom"] as () => unknown)).toMatchObject({
      name: "FloatRangeError",
      message: "Rat.toFloat: value does not fit in Float",
      $hex: "Float",
    });
  });

  test("the §9 erasure line throws the same error and the same message", async () => {
    // The symmetric end: nonzero, but it would erase to `0`. One message for
    // both ends — which end failed is evident from the value.
    const exports = await runRat(
      "// erasure\n" +
      "export let boom(): Float = Rat.toFloat(Rat.create(1, 2 ** 1100))\n",
    );

    expect(threw(exports["boom"] as () => unknown)).toMatchObject({
      name: "FloatRangeError",
      message: "Rat.toFloat: value does not fit in Float",
    });
  });

  test("exactly half the smallest subnormal erases, and so throws", async () => {
    // `2 ** -1075` is the tie between `0` and the smallest subnormal, and `0` is
    // the even one — so the honest IEEE answer *is* zero, which is exactly the
    // total-error case the guard refuses.
    expect(nearestDouble(1n, 1n << 1075n)).toBe("erasure");
    const exports = await runRat(
      "// half the smallest subnormal\n" +
      "export let boom(): Float = Rat.toFloat(Rat.create(1n, 2n ** 1075))\n",
    );

    expect(threw(exports["boom"] as () => unknown)).toMatchObject({
      name: "FloatRangeError",
      message: "Rat.toFloat: value does not fit in Float",
    });
  });

  test("the finite boundary: the last value that converts, and the first that does not", async () => {
    // The overflow tie sits at `2^1024 - 2^970`, the midpoint between the
    // largest finite double and `2^1024`. One below it rounds down to the
    // largest finite double; the midpoint itself ties to the even significand,
    // which is the infinity, and throws. A guard checked before the rounding
    // rather than after it gets this pair the wrong way round.
    const keeps = (1n << 1024n) - (1n << 970n) - 1n;
    const throws = (1n << 1024n) - (1n << 970n);
    expect(nearestDouble(keeps, 1n)).toBe(Number.MAX_VALUE);
    expect(nearestDouble(throws, 1n)).toBe("overflow");

    const exports = await runRat(
      "// the finite boundary\n" +
      "export let largest: Float = Rat.toFloat(Rat.create((2n ** 53 - 1n) * 2n ** 971, 1n))\n" +
      "export let lastGood: Float =\n" +
      "    Rat.toFloat(Rat.create(2n ** 1024 - 2n ** 970 - 1n, 1n))\n" +
      "export let boom(): Float =\n" +
      "    Rat.toFloat(Rat.create(2n ** 1024 - 2n ** 970, 1n))\n" +
      "export let negativeBoom(): Float =\n" +
      "    Rat.toFloat(Rat.create(-(2n ** 1024 - 2n ** 970), 1n))\n",
    );

    expect(exports["largest"]).toBe(Number.MAX_VALUE);
    expect(exports["lastGood"]).toBe(Number.MAX_VALUE);
    expect(threw(exports["boom"] as () => unknown)).toMatchObject({
      name: "FloatRangeError",
      message: "Rat.toFloat: value does not fit in Float",
    });
    // The negative end fails identically: the guard is about magnitude.
    expect(threw(exports["negativeBoom"] as () => unknown)).toMatchObject({
      name: "FloatRangeError",
      message: "Rat.toFloat: value does not fit in Float",
    });
  });

  test("the guard reaches the TypeScript boundary as an `@throws` tag", () => {
    // #562: the door's doc spells the manifest sentence the deriver recognizes
    // (Doc Comments §6.1), so the exported face carries the tag a JSDoc reader
    // expects — the one word "when" is what the derivation turns on.
    const project = compileFiles(withRat("export let f: Float = Rat.toFloat(Rat.create(1, 2))\n"));
    expect(project.diagnostics).toEqual([]);
    const declarations = project.modules
      .find(({ source }) => source.path === "/Rat.hex")!.declarations.text;

    expect(declarations).toContain(
      "@throws {FloatRangeError} when the honest answer would not be an approximation at all:" +
        " past `Float`'s finite range, or a nonzero rational that would erase to zero\n",
    );
  });
});

describe("the exception's identity", () => {
  test("a catch arm names it by `Float`'s declaration, bare and qualified", async () => {
    // The catch arm certifies the (module, name) pair, so a sibling prelude
    // exception's arm does not answer for it.
    const exports = await runRat(
      "// catch arms\n" +
      "export fun bare(): String =\n" +
      "    try\n" +
      "        show(Rat.toFloat(Rat.create(2 ** 1100, 1)))\n" +
      "    catch\n" +
      "        FloatRangeError(message) => message\n" +
      "export fun qualified(): String =\n" +
      "    try\n" +
      "        show(Rat.toFloat(Rat.create(2 ** 1200, 1)))\n" +
      "    catch\n" +
      "        Float.FloatRangeError(message) => message\n" +
      "export fun sibling(): String =\n" +
      "    try\n" +
      "        show(Rat.toFloat(Rat.create(2 ** 1300, 1)))\n" +
      "    catch\n" +
      "        DivideByZeroError(message) => \"wrong: ${message}\"\n" +
      "        NegativeExponentError(message) => \"wrong: ${message}\"\n" +
      "        _ => \"not a sibling\"\n",
    );

    expect((exports["bare"] as () => string)())
      .toBe("Rat.toFloat: value does not fit in Float");
    expect((exports["qualified"] as () => string)())
      .toBe("Rat.toFloat: value does not fit in Float");
    expect((exports["sibling"] as () => string)()).toBe("not a sibling");
  });

  test("the JavaScript guards certify it against `stdlib/Float.hex`", async () => {
    // `.is` and `isHexError` are the JS consumer's face of the same brand the
    // arms above read. Both calls run over one module graph: `Float.hex`'s
    // emitted text is byte-identical across the two entries, so the `data:`
    // cache hands back the same instance and `.is` is the declaration's own.
    const files = withRat(
      "// runtime guards\n" +
      "export let boom(): Float = Rat.toFloat(Rat.create(1, 2 ** 1400))\n",
    );
    const main = await runProject(files);
    const float = await runProject(files, { entry: "/Float.hex" });

    const error = threw(main["boom"] as () => unknown);
    const range = float["FloatRangeError"] as { is: (value: unknown) => boolean };
    const isHexError = float["isHexError"] as (value: unknown) => boolean;

    expect(error).toBeInstanceOf(Error);
    expect(range.is(error)).toBe(true);
    expect(isHexError(error)).toBe(true);
    // A foreign `Error` wearing the name is unbranded, so the guard refuses it.
    expect(range.is(Object.assign(new Error("x"), { name: "FloatRangeError" })))
      .toBe(false);
  });

  test("a sibling declaration's guard does not answer for it", async () => {
    // The other direction of the same certification, from JavaScript: `Pow.hex`
    // and `Integral.hex` declare their own, and neither claims this one.
    const files = withRat(
      "// sibling guards\n" +
      "export let boom(): Float = Rat.toFloat(Rat.create(1, 2 ** 1500))\n",
    );
    const main = await runProject(files);
    const pow = await runProject(files, { entry: "/Pow.hex" });
    const integral = await runProject(files, { entry: "/Integral.hex" });

    const error = threw(main["boom"] as () => unknown);
    const negative = pow["NegativeExponentError"] as { is: (value: unknown) => boolean };
    const divide = integral["DivideByZeroError"] as { is: (value: unknown) => boolean };

    expect(negative.is(error)).toBe(false);
    expect(divide.is(error)).toBe(false);
  });
});
