import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for **decimal-point literal promotion** (#525, Numeric Literals
 * §5.1).
 *
 * A decimal-point literal takes an exact home wherever §5.1 already knows the
 * target: the canonical `Dec`, carrying its written digits and places, or a
 * concrete type honoring `Frac` and `FromBigInt`, reaching the written value
 * through that type's own exact arithmetic. Only the literal is promoted —
 * never an established `Float` — and never into a type variable, so a literal
 * with no known exact target is the `Float` it always was.
 */

const HEADER = "module Main\n\n";

describe("promotion into Dec", () => {
  test("carries the written digits and places at every seat §5.1 establishes", async () => {
    const exports = await runMain(
      HEADER +
        "let price: Dec = 2.50d\n" +
        "let half(): Dec = 0.50\n" +
        "let pick(waived: Bool): Dec = if waived then 0.0 else price\n" +
        "let annotated: Dec = 1_000.050\n" +
        "export let shown: (String, String, String, String) = " +
          "(annotated.show(), half().show(), pick(True).show(), pick(False).show())\n" +
        "let sum: Dec = 0.1 + 0.2\n" +
        "let owed: Dec = -0.05\n" +
        "export let lifted: String = sum.show()\n" +
        "export let negated: String = owed.show()\n" +
        "export let operands: (String, String) = ((price * 1.15).show(), (1.15 * price).show())\n" +
        "export let argument: String = Dec.divide(price, 1.5, 2).show()\n" +
        "export let compared: (Bool, Bool) = (price == 2.5, 2.49 < price)\n",
    );
    expect(exports).toMatchObject({
      shown: ["1000.050", "0.50", "0.0", "2.50"],
      lifted: "0.3",
      negated: "-0.05",
      operands: ["2.8750", "2.8750"],
      argument: "1.67",
      compared: [true, true],
    });
  });

  /**
   * A forwarding form hands its expectation to each value path (Functions
   * §4.3), and a literal value path takes it — the reach an integer literal
   * gets by unification, so `if waived then 0.0 else 1.25` compiles at `Dec`
   * exactly as `if waived then 0 else 1` does.
   */
  test("takes the expectation a forwarding form hands its value paths", async () => {
    const exports = await runMain(
      HEADER +
        "let pick(waived: Bool): Dec = if waived then 0.0 else 1.25\n" +
        "let size(n: Int): Dec = match n\n    0 => 0.00\n    _ => 2.5\n" +
        "let blockValue: Dec =\n    let unused = 1\n    0.75\n" +
        "let grouped: Dec = (0.250)\n" +
        "let guarded(): Dec =\n    try\n        0.5\n    catch\n        _ => 1.5\n" +
        "export let shown: (String, String, String, String, String, String, String) = " +
          "(pick(True).show(), pick(False).show(), size(0).show(), size(1).show(), " +
          "blockValue.show(), grouped.show(), guarded().show())\n",
    );
    expect(exports.shown).toEqual(["0.0", "1.25", "0.00", "2.5", "0.75", "0.250", "0.5"]);
  });

  test("emits exactly the `d` literal of the same digits", () => {
    const project = compileMain(HEADER + "export let amount: Dec = 1.50\n");
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ name }) => name === "Main")!;
    expect(main.javascript.text).toContain("({ unscaled: 150n, places: 2 })");
  });

  test("refuses an exponent, spelling the value in ordinary notation", () => {
    expect(projectDiagnostics(HEADER + "let big: Dec = 1.5e2\n")).toEqual([
      "a `Dec` literal is written without an exponent, so its decimal places show; write `150`",
    ]);
    expect(projectDiagnostics(HEADER + "let small: Dec = 1.5e-3\n")).toEqual([
      "a `Dec` literal is written without an exponent, so its decimal places show; write `0.0015`",
    ]);
  });
});

describe("promotion into Frac targets", () => {
  test("reaches Rat's exact value, exponents included", async () => {
    const exports = await runMain(
      HEADER +
        "import Rat\n\n" +
        "let tenth: Rat = 0.1\n" +
        "let tiny: Rat = 1e-9\n" +
        "let hundreds: Rat = 1.5e2\n" +
        "let sum: Rat = 0.1 + 0.2\n" +
        "let third = Rat.create(1n, 3n)\n" +
        "export let shown: (String, String, String, String, String) = " +
          "(tenth.show(), tiny.show(), hundreds.show(), sum.show(), (third + 0.5).show())\n",
    );
    expect(exports.shown).toEqual(["1/10", "1/1000000000", "150/1", "3/10", "5/6"]);
  });

  /**
   * The target is found by what it honors, never by name: a user type with
   * `Frac` and `FromBigInt` receives `fromBigInt(c) / fromBigInt(10^s)`
   * through its own instances. This one keeps its fraction unreduced, so the
   * route itself is visible.
   */
  test("builds the written value through a user type's own instances", async () => {
    const exports = await runMain(
      HEADER +
        "record Ratio = {top: BigInt, bottom: BigInt}\n\n" +
        "honor Num<Ratio> =\n" +
        "    add(l, r) = Ratio({top = l.top * r.bottom + r.top * l.bottom, bottom = l.bottom * r.bottom})\n" +
        "    multiply(l, r) = Ratio({top = l.top * r.top, bottom = l.bottom * r.bottom})\n" +
        "    fromNat(n) = Ratio({top = BigInt.fromNat(n), bottom = 1n})\n\n" +
        "honor Signed<Ratio> =\n" +
        "    subtract(l, r) = Ratio({top = l.top * r.bottom - r.top * l.bottom, bottom = l.bottom * r.bottom})\n" +
        "    negate(v) = Ratio({top = -v.top, bottom = v.bottom})\n" +
        "    fromInt(n) = Ratio({top = BigInt.fromInt(n), bottom = 1n})\n\n" +
        "honor FromBigInt<Ratio> =\n" +
        "    fromBigInt(n) = Ratio({top = n, bottom = 1n})\n\n" +
        "honor Frac<Ratio> =\n" +
        "    divide(l, r) = Ratio({top = l.top * r.bottom, bottom = l.bottom * r.top})\n\n" +
        "let quarter: Ratio = 0.25\n" +
        "let whole: Ratio = 2.0e1\n" +
        "export let parts: (BigInt, BigInt, BigInt, BigInt) = " +
          "(quarter.top, quarter.bottom, whole.top, whole.bottom)\n",
    );
    expect(exports.parts).toEqual([25n, 100n, 20n, 1n]);
  });
});

describe("what stays Float", () => {
  test("a literal with no known exact target", async () => {
    const exports = await runMain(
      HEADER +
        "let plain = 0.1\n" +
        "let scaled(x) = x * 0.5\n" +
        "export let values: (Float, Float) = (plain, scaled(3.0))\n",
    );
    expect(exports.values).toEqual([0.1, 1.5]);
  });

  test("an established Float value, a type variable, and an inferred Float seat", () => {
    expect(projectDiagnostics(HEADER + "let f = 0.5\nlet x: Dec = f\n"))
      .toEqual(["type mismatch: expected Dec, found Float"]);
    expect(projectDiagnostics(HEADER + "fun half<a: Frac>(x: a): a = x * 0.5\n")).toEqual([
      "`a` is a declared type variable, but the body requires `Float`; change the annotation " +
        "to `Float`, or remove it to let the type be inferred",
    ]);
    expect(projectDiagnostics(HEADER + "let g(x) = x * 0.5\nlet y: Dec = g(2.0d)\n")).toEqual([
      "type mismatch: expected Dec, found Float",
      "type mismatch: expected Float, found Dec",
    ]);
  });

  /** Patterns keep their exact-type rule until #1054; the refusal names the `d` spelling. */
  test("a literal pattern, whose refusal names the `d` spelling", () => {
    const refusal = (arm: string): readonly string[] =>
      projectDiagnostics(
        HEADER + `let label(a: Dec): String = match a\n    ${arm} => "x"\n    _ => "o"\n`,
      );
    expect(refusal("0.5")).toEqual([
      "type mismatch: expected Dec, found Float; a `Dec` pattern is written with the `d` suffix: `0.5d`",
    ]);
    expect(refusal("-1.25")).toEqual([
      "type mismatch: expected Dec, found Float; a `Dec` pattern is written with the `d` suffix: `-1.25d`",
    ]);
    expect(refusal("1.5e-3")).toEqual([
      "type mismatch: expected Dec, found Float; a `Dec` pattern is written with the `d` suffix: `0.0015d`",
    ]);
  });
});
