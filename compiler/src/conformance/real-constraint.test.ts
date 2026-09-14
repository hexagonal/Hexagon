import { describe, expect, test } from "vitest";

import { runMain } from "../support/test-project.js";

const PROGRAM = "module Main\n\n" +
  "import Rat\n\n" +
  "fun doubledAbs<a: Real>(value: a): a = Real.abs(value) + value.abs()\n" +
  "fun signCode<a: Real>(value: a): Int =\n" +
  "    match value.sign()\n" +
  "        Sign.Negative => -1\n" +
  "        Sign.Zero => 0\n" +
  "        Sign.Positive => 1\n\n" +
  "export let natAbs: Nat = Real.abs((7: Nat))\n" +
  "export let intAbs: Int = (-9).abs()\n" +
  "export let intMaximumAbs: Int = (-9_007_199_254_740_991).abs()\n" +
  "export let bigAbs: BigInt = (-12_345_678_901_234_567_890n).abs()\n" +
  "export let floatAbs: Float = (-2.5).abs()\n" +
  "export let negativeZeroAbs: Float = (-0.0).abs()\n" +
  "export let negativeInfinityAbs: Float = (-Float.infinity).abs()\n" +
  "export let nanAbs: Float = Float.nan.abs()\n" +
  "let ratAbs: Rat.Rat = Rat.create(-2, 3).abs()\n" +
  "export let ratAbsTop: BigInt = Rat.top(ratAbs)\n" +
  "export let ratAbsBottom: BigInt = Rat.bottom(ratAbs)\n" +
  "export let genericInt: Int = doubledAbs(-6)\n" +
  "export let genericBig: BigInt = doubledAbs(-7n)\n" +
  "export let natZeroSign: Int = signCode((0: Nat))\n" +
  "export let natPositiveSign: Int = signCode((3: Nat))\n" +
  "export let intNegativeSign: Int = signCode(-3)\n" +
  "export let bigPositiveSign: Int = signCode(3n)\n" +
  "export let floatNegativeInfinitySign: Int = signCode(-Float.infinity)\n" +
  "export let floatPositiveInfinitySign: Int = signCode(Float.infinity)\n" +
  "export let floatNegativeZeroSign: Int = signCode(-0.0)\n" +
  "export let floatPositiveZeroSign: Int = signCode(0.0)\n" +
  "export let ratNegativeSign: Int = signCode(Rat.create(-2, 3))\n" +
  "export let ratZeroSign: Int = signCode(Rat.create(0, 5))\n" +
  "export let ratPositiveSign: Int = signCode(Rat.create(2, 3))\n" +
  "export fun nanSign(): Sign = Float.nan.sign()\n";

describe("Real standard instances", () => {
  test("absolute value preserves every subject type and the generic Num base", async () => {
    const exports = await runMain(PROGRAM);

    expect(exports["natAbs"]).toBe(7);
    expect(exports["intAbs"]).toBe(9);
    expect(exports["intMaximumAbs"]).toBe(9_007_199_254_740_991);
    expect(exports["bigAbs"]).toBe(12_345_678_901_234_567_890n);
    expect(exports["floatAbs"]).toBe(2.5);
    expect(Object.is(exports["negativeZeroAbs"], 0)).toBe(true);
    expect(exports["negativeInfinityAbs"]).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(exports["nanAbs"])).toBe(true);
    expect(exports["ratAbsTop"]).toBe(2n);
    expect(exports["ratAbsBottom"]).toBe(3n);
    expect(exports["genericInt"]).toBe(12);
    expect(exports["genericBig"]).toBe(14n);
  });

  test("sign classifies zeroes, finite values, infinities, and Rat exactly", async () => {
    const exports = await runMain(PROGRAM);

    expect(exports["natZeroSign"]).toBe(0);
    expect(exports["natPositiveSign"]).toBe(1);
    expect(exports["intNegativeSign"]).toBe(-1);
    expect(exports["bigPositiveSign"]).toBe(1);
    expect(exports["floatNegativeInfinitySign"]).toBe(-1);
    expect(exports["floatPositiveInfinitySign"]).toBe(1);
    expect(exports["floatNegativeZeroSign"]).toBe(0);
    expect(exports["floatPositiveZeroSign"]).toBe(0);
    expect(exports["ratNegativeSign"]).toBe(-1);
    expect(exports["ratZeroSign"]).toBe(0);
    expect(exports["ratPositiveSign"]).toBe(1);
  });

  test("Float NaN has no sign", async () => {
    const exports = await runMain(PROGRAM);
    expect(() => (exports["nanSign"] as () => unknown)()).toThrowError(
      expect.objectContaining({ name: "UndefinedSignError", message: "NaN has no sign" }),
    );
  });
});
