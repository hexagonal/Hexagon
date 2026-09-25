import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain, runProject }
  from "../support/test-project.js";

const HEADER = "module Main\n\n";

function threw(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("Dec literals and exact decimal arithmetic", () => {
  test("preserves literal payloads and retained places without an import", async () => {
    const exports = await runMain(
      HEADER +
        "let amount = 1_000.050d\n" +
        "export let unscaled: BigInt = amount.unscaled()\n" +
        "export let places: Int = amount.places()\n" +
        "export let placeDifference: Int = 1.2d.places() - 1.234d.places()\n" +
        "export let shown: String = amount.show()\n" +
        "export let boundary: String = 1.50d.show()\n",
    );
    expect(exports).toMatchObject({
      unscaled: 1000050n,
      places: 3,
      placeDifference: -2,
      shown: "1000.050",
      boundary: "1.50",
    });
  });

  test("distinguishes stored representation from numerical equality", async () => {
    const exports = await runMain(
      HEADER +
        "let first = Dec.create(200n, 2)\n" +
        "let second = Dec.create(200n, 2)\n" +
        "export let numerical: Bool = 2.0d == 2.00d\n" +
        "export let retainedPlacesDiffer: Bool = 2.0d.same(2.00d)\n" +
        "export let separateRecords: Bool = Dec.same(first, second)\n" +
        "export let valuesDiffer: Bool = Dec.same(2.00d, 3.00d)\n" +
        "export let signsDiffer: Bool = Dec.same(-2.00d, 2.00d)\n" +
        "export let zerosDiffer: Bool = Dec.same(0d, 0.00d)\n",
    );
    expect(exports).toMatchObject({
      numerical: true,
      retainedPlacesDiffer: false,
      separateRecords: true,
      valuesDiffer: false,
      signsDiffer: false,
      zerosDiffer: false,
    });
  });

  test("implements exact operators, integer widening, rounding, and powers", async () => {
    const exports = await runMain(
      HEADER +
        "export let sum: String = (1.50d + 2.005d).show()\n" +
        "export let product: String = (1.50d * 2.00d).show()\n" +
        "export let widenedLeft: String = (3n * 1.50d).show()\n" +
        "export let widenedRight: String = (1.50d * 3).show()\n" +
        "export let power: String = (1.50d ** 2).show()\n" +
        "export let school: String = 1.245d.withPlaces(2).show()\n" +
        "export let even: String = 1.245d.withPlacesEven(2).show()\n" +
        "export let quotient: String = 1d.divide(8d, 2).show()\n" +
        "export let quotientEven: String = 1d.divideEven(8d, 2).show()\n" +
        "export let rounded: BigInt = (-1.5d).round()\n" +
        "export let floored: BigInt = (-1.1d).floor()\n" +
        "export let ceiled: BigInt = (-1.1d).ceil()\n" +
        "export let truncated: BigInt = (-1.1d).trunc()\n",
    );
    expect(exports).toMatchObject({
      sum: "3.505",
      product: "3.0000",
      widenedLeft: "4.50",
      widenedRight: "4.50",
      power: "2.2500",
      school: "1.25",
      even: "1.24",
      quotient: "0.13",
      quotientEven: "0.12",
      rounded: -2n,
      floored: -2n,
      ceiled: -1n,
      truncated: -1n,
    });
  });

  test("rounds signed ties, neighbours, carries, and exact results once", async () => {
    const exports = await runMain(
      HEADER +
        "export let schoolPositive: String = 1.25d.withPlaces(1).show()\n" +
        "export let schoolNegative: String = (-1.25d).withPlaces(1).show()\n" +
        "export let evenDown: String = 1.25d.withPlacesEven(1).show()\n" +
        "export let evenUp: String = 1.35d.withPlacesEven(1).show()\n" +
        "export let evenNegative: String = (-1.25d).withPlacesEven(1).show()\n" +
        "export let belowTie: String = 1.24d.withPlaces(1).show()\n" +
        "export let carry: String = 9.95d.withPlaces(1).show()\n" +
        "export let negativeZero: String = (-0.04d).withPlaces(1).show()\n" +
        "export let direct: String = 1.249d.withPlaces(1).show()\n" +
        "export let increased: String = 1.2d.withPlaces(4).show()\n" +
        "export let productSchool: String = (0.25d * 0.1d).withPlaces(2).show()\n" +
        "export let productEven: String = (0.25d * 0.1d).withPlacesEven(2).show()\n",
    );
    expect(exports).toMatchObject({
      schoolPositive: "1.3",
      schoolNegative: "-1.3",
      evenDown: "1.2",
      evenUp: "1.4",
      evenNegative: "-1.2",
      belowTie: "1.2",
      carry: "10.0",
      negativeZero: "0.0",
      direct: "1.2",
      increased: "1.2000",
      productSchool: "0.03",
      productEven: "0.02",
    });
  });

  test("rounds repeating division for every sign and rejects every zero divisor", async () => {
    const exports = await runMain(
      HEADER +
        "export let pp: String = 1d.divide(6d, 3).show()\n" +
        "export let np: String = (-1d).divide(6d, 3).show()\n" +
        "export let pn: String = 1d.divide(-6d, 3).show()\n" +
        "export let nn: String = (-1d).divide(-6d, 3).show()\n" +
        "export let schoolTie: String = 1d.divide(8d, 2).show()\n" +
        "export let evenTie: String = 1d.divideEven(8d, 2).show()\n" +
        "export let zeroAtTwo: String = 0d.divide(7d, 2).show()\n" +
        "export let zeroScale(): Dec = 1d.divide(Dec.create(0n, 0), 2)\n" +
        "export let zeroScaled(): Dec = 1d.divideEven(Dec.create(0n, 40), 2)\n",
    );
    expect(exports).toMatchObject({
      pp: "0.167",
      np: "-0.167",
      pn: "-0.167",
      nn: "0.167",
      schoolTie: "0.13",
      evenTie: "0.12",
      zeroAtTwo: "0.00",
    });
    for (const name of ["zeroScale", "zeroScaled"] as const) {
      expect(threw(exports[name] as () => unknown)).toMatchObject({
        name: "DivideByZeroError",
        $hex: "Hex.Integral",
      });
    }
  });

  test("rejects negative places before zero fast paths and zero-divisor checks", async () => {
    const exports = await runMain(
      HEADER +
        "import Rat\n\n" +
        "export let createNegative(): Dec = Dec.create(0n, -1)\n" +
        "export let changeNegative(): Dec = 0d.withPlaces(-1)\n" +
        "export let changeEvenNegative(): Dec = 0d.withPlacesEven(-1)\n" +
        "export let divideNegative(): Dec = 0d.divide(1d, -1)\n" +
        "export let divideEvenBeforeZero(): Dec = 1d.divideEven(0d, -1)\n" +
        "export let ratNegative(): Dec = Rat.toDec(Rat.create(0n, 1n), -1)\n" +
        "export let ratEvenNegative(): Dec = Rat.toDecEven(Rat.create(0n, 1n), -1)\n" +
        "export let floatNegative(): Dec = Dec.fromFloat(Float.nan, -1)\n" +
        "export let floatEvenNegative(): Dec = Dec.fromFloatEven(Float.nan, -1)\n",
    );
    for (const [name, operation] of [
      ["createNegative", "Dec.create"],
      ["changeNegative", "Dec.withPlaces"],
      ["changeEvenNegative", "Dec.withPlacesEven"],
      ["divideNegative", "Dec.divide"],
      ["divideEvenBeforeZero", "Dec.divideEven"],
      ["ratNegative", "Rat.toDec"],
      ["ratEvenNegative", "Rat.toDecEven"],
      ["floatNegative", "Dec.fromFloat"],
      ["floatEvenNegative", "Dec.fromFloatEven"],
    ] as const) {
      expect(threw(exports[name] as () => unknown)).toMatchObject({
        name: "NegativeDecimalPlacesError",
        message: `${operation}: decimal places cannot be negative`,
        $hex: "Hex.Dec",
      });
    }
  });

  test("widens every exact integer source in both operand orders and refuses Frac", async () => {
    const exports = await runMain(
      HEADER +
        "let natural: Nat = 3\n" +
        "let integer: Int = -3\n" +
        "let large: BigInt = 9_007_199_254_740_993n\n" +
        "export let natLeft: String = (natural * 1.50d).show()\n" +
        "export let natRight: String = (1.50d * natural).show()\n" +
        "export let intLeft: String = (integer * 1.50d).show()\n" +
        "export let intRight: String = (1.50d * integer).show()\n" +
        "export let bigLeft: String = (large * 1.0d).show()\n" +
        "export let bigRight: String = (1.0d * large).show()\n",
    );
    expect(exports).toMatchObject({
      natLeft: "4.50",
      natRight: "4.50",
      intLeft: "-4.50",
      intRight: "-4.50",
      bigLeft: "9007199254740993.0",
      bigRight: "9007199254740993.0",
    });
    expect(projectDiagnostics(HEADER + "let invalid = 1d / 2d\n").join("\n"))
      .toContain("type `Dec` has no `Frac` instance");
  });

  test("handles enormous zero scales without constructing powers of ten", async () => {
    const exports = await runMain(
      HEADER +
        "let maximum: Int = 9_007_199_254_740_991\n" +
        "let zero = Dec.create(0n, maximum)\n" +
        "export let changed: Int = zero.withPlaces(0).places()\n" +
        "export let divided: Int = zero.divide(1d, maximum).places()\n" +
        "export let rounded: BigInt = zero.round()\n" +
        "export let roundedEven: BigInt = zero.roundEven()\n" +
        "export let floored: BigInt = zero.floor()\n" +
        "export let ceiled: BigInt = zero.ceil()\n" +
        "export let truncated: BigInt = zero.trunc()\n" +
        "export let equal: Bool = zero == 0d\n" +
        "export let ordered: Ordering = zero.compare(0d)\n" +
        "export let negativeBeforeZero: Ordering = (-1d).compare(zero)\n" +
        "export let positiveAfterZero: Ordering = 1d.compare(zero)\n" +
        "export let sameHash: Bool = zero.hash() == 0d.hash()\n",
    );
    expect(exports).toMatchObject({
      changed: 0,
      divided: 9_007_199_254_740_991,
      rounded: 0n,
      roundedEven: 0n,
      floored: 0n,
      ceiled: 0n,
      truncated: 0n,
      equal: true,
      ordered: { tag: "Equal" },
      negativeBeforeZero: { tag: "Less" },
      positiveAfterZero: { tag: "Greater" },
      sameHash: true,
    });
  });

  test("checks exact retained-place overflow even for zero coefficients", async () => {
    const exports = await runMain(
      HEADER +
        "let maximum: Int = 9_007_199_254_740_991\n" +
        "export let multiplyOverflow(): Dec = Dec.create(0n, maximum) * 0.0d\n" +
        "export let powOverflow(): Dec = Dec.create(0n, maximum) ** 2\n" +
        "export let identity: String = (Dec.create(0n, maximum) ** 0).show()\n" +
        "export let negativePower(): Dec = 2d ** -1\n",
    );
    expect(exports.identity).toBe("1");
    expect(threw(exports.multiplyOverflow as () => unknown)).toMatchObject({
      name: "DecimalPlacesOverflowError",
      message: "Dec.multiply: decimal places overflow",
      $hex: "Hex.Dec",
    });
    expect(threw(exports.powOverflow as () => unknown)).toMatchObject({
      name: "DecimalPlacesOverflowError",
      message: "Dec.pow: decimal places overflow",
    });
    expect(threw(exports.negativePower as () => unknown)).toMatchObject({
      name: "NegativeExponentError",
      message: "Dec.pow: exponent cannot be negative",
    });
  });

  test("keeps numerical Eq, Ord, Hash, and collection representatives coherent", async () => {
    const exports = await runMain(
      HEADER +
        "let keyPlaces(total: Int, key: Dec): Int = key.places()\n" +
        "let map = Map.fromVector([(1.50d, 1), (1.500d, 2)])\n" +
        "let set = Set.fromVector([0.00d, 0d])\n" +
        "export let equal: Bool = 1.50d == 1.500d\n" +
        "export let compareEqual: Ordering = 1.50d.compare(1.500d)\n" +
        "export let less: Bool = -2.0d < -1.99d\n" +
        "export let hashes: Bool = 1.50d.hash() == 1.500d.hash() and 0d.hash() == 0.00d.hash()\n" +
        "export let tenfoldUnequal: (Bool, Bool, Bool, Bool) = " +
          "(5d == 0.5d, 0.5d != 0.05d, 1.5d == 1.51d, -5d == 5.0d)\n" +
        "export let integralHashes: Bool = 3d.hash() == 3.0d.hash() and -0.5d.hash() == -0.50d.hash()\n" +
        "export let scaledHashes: Int = Set.fromVector([5d.hash(), 0.5d.hash(), 0.05d.hash(), 50d.hash()]).size()\n" +
        "export let mapSize: Int = map.size()\n" +
        "export let replacement: Option(Int) = map.get(1.5d)\n" +
        "export let mapRepresentativePlaces: Int = map.keys().fold(0, keyPlaces)\n" +
        "export let setSize: Int = set.size()\n" +
        "export let setRepresentativePlaces: Int = set.toSeq().fold(0, keyPlaces)\n",
    );
    expect(exports).toMatchObject({
      equal: true,
      compareEqual: { tag: "Equal" },
      less: true,
      hashes: true,
      tenfoldUnequal: [false, true, false, false],
      integralHashes: true,
      mapSize: 1,
      replacement: { tag: "Some", value: 2 },
      mapRepresentativePlaces: 2,
      setSize: 1,
      setRepresentativePlaces: 2,
    });
    // The hash reads the whole canonical key, places included, so a number and
    // its tenfold neighbours do not collide.
    expect(exports.scaledHashes).toBe(4);
  });

  test("keeps large coefficients exact and implements the full Real and integer-rounding surface", async () => {
    const exports = await runMain(
      HEADER +
        "let positive = 1.75d\n" +
        "let negative = -1.75d\n" +
        "let integral = 2.00d\n" +
        "export let large: String = (90071992547409931234567890.01d + 0.09d).show()\n" +
        "export let product: String = (90071992547409931234567890d * 10d).show()\n" +
        "export let positiveRounds: (BigInt, BigInt, BigInt, BigInt, BigInt) = " +
          "(positive.round(), positive.roundEven(), positive.floor(), positive.ceil(), positive.trunc())\n" +
        "export let negativeRounds: (BigInt, BigInt, BigInt, BigInt, BigInt) = " +
          "(negative.round(), negative.roundEven(), negative.floor(), negative.ceil(), negative.trunc())\n" +
        "export let integralRounds: (BigInt, BigInt, BigInt, BigInt, BigInt) = " +
          "(integral.round(), integral.roundEven(), integral.floor(), integral.ceil(), integral.trunc())\n" +
        "export let absolute: String = negative.abs().show()\n" +
        "export let signs: (Sign, Sign, Sign) = (negative.sign(), 0.00d.sign(), positive.sign())\n" +
        "export let interpolated: String = \"amount ${1.50d}\"\n",
    );
    expect(exports).toMatchObject({
      large: "90071992547409931234567890.10",
      product: "900719925474099312345678900",
      positiveRounds: [2n, 2n, 1n, 2n, 1n],
      negativeRounds: [-2n, -2n, -2n, -1n, -1n],
      integralRounds: [2n, 2n, 2n, 2n, 2n],
      absolute: "1.75",
      signs: [{ tag: "Negative" }, { tag: "Zero" }, { tag: "Positive" }],
      interpolated: "amount 1.50",
    });
    expect(projectDiagnostics(HEADER + "let approximate: Dec = 1.5\n"))
      .toEqual(["type mismatch: expected Dec, found Float"]);
  });

  test("uses numerical equality and literal-pattern identity across places", async () => {
    const exports = await runMain(
      HEADER +
        "export let equal: Bool = 1.50d == 1.500d\n" +
        "export let label(value: Dec): String = match value\n" +
        "    5.00d => \"five\"\n" +
        "    _ => \"other\"\n" +
        "export let matched: String = label(5d)\n",
    );
    expect(exports).toMatchObject({ equal: true, matched: "five" });
    expect(projectDiagnostics(
      HEADER +
        "let label(value: Dec): String = match value\n" +
        "    5d => \"first\"\n" +
        "    5.00d => \"second\"\n" +
        "    _ => \"other\"\n",
    )).toEqual(["this case is unreachable; the arm `5d` above already covers it"]);
    for (const arms of [
      "    5 => \"first\"\n    5.00d => \"second\"\n",
      "    5.00d => \"first\"\n    5 => \"second\"\n",
      "    0 => \"first\"\n    -0.00d => \"second\"\n",
    ]) {
      expect(projectDiagnostics(
        HEADER + "let duplicate(value: Dec): String = match value\n" + arms +
          "    _ => \"other\"\n",
      )[0]).toMatch(/already (covers it|handled above)/);
    }
    const bare = await runMain(
      HEADER +
        "let label(value: Dec): String = match value\n" +
        "    5 => \"five\"\n" +
        "    -2 => \"negative\"\n" +
        "    _ => \"other\"\n" +
        "export let five: String = label(5.00d)\n" +
        "export let negative: String = label(-2.0d)\n",
    );
    expect(bare).toMatchObject({ five: "five", negative: "negative" });

    expect(projectDiagnostics(
      HEADER +
        "let incomplete(value: Dec): String = match value\n" +
        "    0d => \"zero\"\n",
    )).toEqual(["match is missing cases: `_`"]);
    expect(projectDiagnostics(
      HEADER +
        "let complete(value: Dec): String = match value\n" +
        "    0d => \"zero\"\n" +
        "    _ => \"other\"\n",
    )).toEqual([]);
  });

  test("keeps the literal tied to canonical Hex.Dec under a shadowing declaration", () => {
    expect(projectDiagnostics(
      HEADER +
        "record Dec = {value: Int}\n" +
        "let user: Dec = 1.5d\n",
    )).toEqual(["type mismatch: expected Dec, found Dec"]);
    expect(projectDiagnostics(
      HEADER +
        "record Dec = {value: Int}\n" +
        "let classify(value: Dec): Int = match value\n" +
        "    1d => 1\n" +
        "    _ => 0\n",
    )).toEqual(["type mismatch: expected Dec, found Dec"]);
  });

  test("keeps literal construction canonical under a project module named Dec", async () => {
    const exports = await runProject([
      ["/Dec.hex", "module Dec\n\nexport let create(value: Int): String = \"user\"\n"],
      ["/main.hex", HEADER + "export let shown: String = 1.50d.show()\n"],
    ]);
    expect(exports.shown).toBe("1.50");
  });

  test("emits an opaque public Dec face", () => {
    const project = compileMain(HEADER + "export let amount: Dec = 1.50d\n");
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ name }) => name === "Main")!;
    expect(main.declarations.text).toContain("Dec");
    expect(main.javascript.text).toContain("({ unscaled: 150n, places: 2 })");
    expect(main.javascript.text).not.toContain("coefficient:");
    const dec = project.modules.find(({ name }) => name === "Hex.Dec")!;
    expect(dec.declarations.text).toContain("export type Dec = {");
    expect(dec.declarations.text).not.toContain("readonly unscaled:");
    expect(dec.declarations.text).not.toContain("readonly places:");
    for (const name of ["value", "decimalPlaces", "withDecimalPlaces", "withDecimalPlacesEven",
      "divideTo", "divideToEven", "multiplyTo", "multiplyToEven"]) {
      expect(dec.declarations.text).not.toContain(`export declare const ${name}`);
    }
    for (const name of ["unscaled", "places", "same", "withPlaces", "withPlacesEven", "divide", "divideEven"]) {
      expect(dec.declarations.text).toContain(`export declare const ${name}`);
    }
  });

  test("converts decimal ties, subnormals, and range failures to Float", async () => {
    const midpoint = (2n ** 53n + 1n) * 5n ** 53n;
    const smallestSubnormal = 5n ** 1074n;
    const halfSmallestSubnormal = 5n ** 1075n;
    const overflowing = 2n ** 1024n;
    const exports = await runMain(
      HEADER +
        `export let tie: Float = Dec.create(${midpoint}n, 53).toFloat()\n` +
        `export let aboveTie: Float = Dec.create(${midpoint * 10n + 1n}n, 54).toFloat()\n` +
        `export let subnormal: Float = Dec.create(${smallestSubnormal}n, 1074).toFloat()\n` +
        `export let underflow(): Float = Dec.create(${halfSmallestSubnormal}n, 1075).toFloat()\n` +
        `export let overflow(): Float = Dec.create(${overflowing}n, 0).toFloat()\n`,
    );
    expect(exports.tie).toBe(1);
    expect(exports.aboveTie).toBe(1.0000000000000002);
    expect(exports.subnormal).toBe(Number.MIN_VALUE);
    for (const name of ["underflow", "overflow"] as const) {
      expect(threw(exports[name] as () => unknown)).toMatchObject({
        name: "FloatRangeError",
        message: "Dec.toFloat: value does not fit in Float",
        $hex: "Hex.Float",
      });
    }
  });
});

describe("Float to Dec conversion", () => {
  test("rounds the float's exact binary value once to the requested places", async () => {
    const exports = await runMain(
      HEADER +
        "let shown(value: Dec): String = value.show()\n" +
        "export let sum: String = shown(Dec.fromFloat(0.1 + 0.2, 2))\n" +
        "export let price: String = shown(Dec.fromFloat(12.34, 2))\n" +
        "export let widened: String = shown(Dec.fromFloat(1.5, 3))\n" +
        "export let belowTie: String = shown(Dec.fromFloat(2.675, 2))\n" +
        "export let ties: (String, String, String, String) = (\n" +
        "    shown(Dec.fromFloat(2.5, 0)), shown(Dec.fromFloatEven(2.5, 0)),\n" +
        "    shown(Dec.fromFloat(-2.5, 0)), shown(Dec.fromFloatEven(-2.5, 0)))\n" +
        "export let binaryTies: (String, String) = " +
          "(shown(Dec.fromFloat(0.125, 2)), shown(Dec.fromFloatEven(0.125, 2)))\n" +
        "export let negativeZero: String = shown(Dec.fromFloat(-0.0, 2))\n" +
        "export let negativeToZero: String = shown(Dec.fromFloat(-0.001, 2))\n" +
        "export let large: String = shown(Dec.fromFloat(1e21, 0))\n" +
        "export let largest: BigInt = Dec.fromFloat(1.7976931348623157e308, 0).unscaled()\n" +
        "export let smallest: (BigInt, Int) = " +
          "(Dec.fromFloat(5e-324, 1074).unscaled(), Dec.fromFloat(5e-324, 1074).places())\n" +
        "export let smallestRounded: String = shown(Dec.fromFloat(5e-324, 2))\n",
    );
    expect(exports).toMatchObject({
      sum: "0.30",
      price: "12.34",
      widened: "1.500",
      // The double nearest 2.675 lies just below it, so no tie arises.
      belowTie: "2.67",
      ties: ["3", "2", "-3", "-2"],
      binaryTies: ["0.13", "0.12"],
      negativeZero: "0.00",
      negativeToZero: "0.00",
      large: "1000000000000000000000",
      largest: (2n ** 53n - 1n) * 2n ** 971n,
      smallest: [5n ** 1074n, 1074],
      smallestRounded: "0.00",
    });
  });

  test("throws DecRangeError for NaN and the infinities", async () => {
    const exports = await runMain(
      HEADER +
        "export let nan(): Dec = Dec.fromFloat(Float.nan, 2)\n" +
        "export let positive(): Dec = Dec.fromFloat(Float.infinity, 2)\n" +
        "export let negative(): Dec = Dec.fromFloatEven(-Float.infinity, 2)\n",
    );
    for (const [name, operation] of [
      ["nan", "Dec.fromFloat"],
      ["positive", "Dec.fromFloat"],
      ["negative", "Dec.fromFloatEven"],
    ] as const) {
      expect(threw(exports[name] as () => unknown)).toMatchObject({
        name: "DecRangeError",
        message: `${operation}: value is not finite`,
        $hex: "Hex.Dec",
      });
    }
  });
});

describe("Rat and Dec conversions", () => {
  test("converts exactly and applies both requested tie rules", async () => {
    const exports = await runMain(
      HEADER +
        "import Rat\n\n" +
        "let eighth = Rat.create(1n, 8n)\n" +
        "let exact = Rat.fromDec(1.50d)\n" +
        "export let top: BigInt = exact.top()\n" +
        "export let bottom: BigInt = exact.bottom()\n" +
        "export let school: String = Rat.toDec(eighth, 2).show()\n" +
        "export let even: String = Rat.toDecEven(eighth, 2).show()\n",
    );
    expect(exports).toMatchObject({ top: 3n, bottom: 2n, school: "0.13", even: "0.12" });
  });

  test("handles signs, carries, and maximum-place zeroes without intermediate powers", async () => {
    const exports = await runMain(
      HEADER +
        "import Rat\n\n" +
        "let maximum: Int = 9_007_199_254_740_991\n" +
        "let zero = Rat.fromDec(Dec.create(0n, maximum))\n" +
        "export let zeroTop: BigInt = zero.top()\n" +
        "export let zeroBottom: BigInt = zero.bottom()\n" +
        "export let zeroPlaces: Int = Rat.toDec(zero, maximum).places()\n" +
        "export let negativeSchool: String = Rat.toDec(Rat.create(-1n, 8n), 2).show()\n" +
        "export let negativeEven: String = Rat.toDecEven(Rat.create(-1n, 8n), 2).show()\n" +
        "export let carry: String = Rat.toDec(Rat.create(199n, 20n), 1).show()\n",
    );
    expect(exports).toMatchObject({
      zeroTop: 0n,
      zeroBottom: 1n,
      zeroPlaces: 9_007_199_254_740_991,
      negativeSchool: "-0.13",
      negativeEven: "-0.12",
      carry: "10.0",
    });
  });
});
