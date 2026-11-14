import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import { compileProject } from "../../project.js";

/**
 * Division & Remainder §12: a checked division whose divisor is a written zero
 * is refused when the program is compiled, and every other zero divisor faults
 * when the division runs.
 */
const HEADER = "module Main\n\nlet r = 3 // 4\nlet d = 1.5d\nlet zero = 0\n";

function reports(line: string): readonly { readonly message: string; readonly at: string; readonly notes: readonly string[] }[] {
  const text = HEADER + line + "\n";
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", text)]);
  return project.diagnostics.map((diagnostic) => ({
    message: diagnostic.message,
    at: text.slice(diagnostic.primary.start.offset, diagnostic.primary.end.offset),
    notes: diagnostic.notes ?? [],
  }));
}

const DIVISION_NOTE = "a divisor written as a literal is checked when the program is compiled";
const FRACTION_NOTE = "a fraction's bottom written as a literal is checked when the program is compiled";

describe("a divisor written as a literal zero (Division & Remainder §12)", () => {
  // Each refused line, the division it quotes, and the written zero the report stands on.
  const refusedDivisions: readonly (readonly [string, string, string])[] = [
    ["let a = Int.mod(1, 0)", "Int.mod(1, 0)", "0"],
    ["let a = BigInt.rem(1n, -0n)", "BigInt.rem(1n, -0n)", "-0n"],
    ["let a: Rat = 1 / 0.0", "1 / 0.0", "0.0"],
    ["let a = 1.5d.divide(0.00d, 2)", "1.5d.divide(0.00d, 2)", "0.00d"],
    // Every spelling of a call: the companion, the constraint, the dot, a `|>` stage.
    ["let a = Int.div(7, 0)", "Int.div(7, 0)", "0"],
    ["let a = Integral.div(7, 0)", "Integral.div(7, 0)", "0"],
    ["let a = 7.div(0)", "7.div(0)", "0"],
    ["let a = 7 |> Int.mod(0)", "7 |> Int.mod(0)", "0"],
    ["let a = Int.quot(7, 0)", "Int.quot(7, 0)", "0"],
    ["let a = Nat.rem(7, (0: Nat))", "Nat.rem(7, (0: Nat))", "(0: Nat)"],
    ["let a = Rat.divide(r, 0)", "Rat.divide(r, 0)", "0"],
    ["let a = Frac.divide(r, 0)", "Frac.divide(r, 0)", "0"],
    ["let a = r.divide(0)", "r.divide(0)", "0"],
    ["let a = r / 0", "r / 0", "0"],
    ["let a = Dec.divide(d, 0d, 2)", "Dec.divide(d, 0d, 2)", "0d"],
    ["let a = d.divide(0d, 2)", "d.divide(0d, 2)", "0d"],
    ["let a = Dec.divideEven(d, 0d, 2)", "Dec.divideEven(d, 0d, 2)", "0d"],
    // A written zero in every spelling Lexer §5 admits, under signs, parentheses and written types.
    ["let a = Int.div(7, 0x0)", "Int.div(7, 0x0)", "0x0"],
    ["let a = Int.div(7, -0)", "Int.div(7, -0)", "-0"],
    ["let a = Int.div(7, (0))", "Int.div(7, (0))", "(0)"],
    ["let a = Int.div(7, -(-0))", "Int.div(7, -(-0))", "-(-0)"],
    ["let a = r / (0: BigInt)", "r / (0: BigInt)", "(0: BigInt)"],
    ["let a = r / -0.0", "r / -0.0", "-0.0"],
    ["let a = Dec.divide(d, 0, 2)", "Dec.divide(d, 0, 2)", "0"],
    ["let a = Dec.divide(d, 0.0, 2)", "Dec.divide(d, 0.0, 2)", "0.0"],
    // The type is the one the checker solved, written or inferred (§12.3), and the dividend is not read.
    ["let x = 3 // 4\nlet a = x / 0", "x / 0", "0"],
    ["let a = Int.div(0, 0)", "Int.div(0, 0)", "0"],
    // Wherever it stands (§12.4).
    ["fun never(n: Int): Int = n.rem(0)", "n.rem(0)", "0"],
    ["let a = if zero == 1 then Int.div(1, 0) else 2", "Int.div(1, 0)", "0"],
    ["let a = try Int.div(1, 0) catch\n    DivideByZeroFault(_) => 0", "Int.div(1, 0)", "0"],
  ];

  test.each(refusedDivisions)("refuses %j", (line, quoted, zero) => {
    expect(reports(line)).toEqual([{
      message: `division by zero: \`${quoted}\` has no value; write the divisor that was meant`,
      at: zero,
      notes: [DIVISION_NOTE],
    }]);
  });

  const refusedFractions: readonly (readonly [string, string, string])[] = [
    ["let a = 1 // 0", "1 // 0", "0"],
    ["let a = 0 // 0", "0 // 0", "0"],
    ["let a = 1 // -0", "1 // -0", "-0"],
    ["let a = Rat.create(1n, 0n)", "Rat.create(1n, 0n)", "0n"],
    ["let a = Rat.create(1, 0)", "Rat.create(1, 0)", "0"],
  ];

  test.each(refusedFractions)("refuses the fraction %j", (line, quoted, zero) => {
    expect(reports(line)).toEqual([{
      message: `a fraction's bottom is never zero, so \`${quoted}\` has no value; write the bottom that was meant`,
      at: zero,
      notes: [FRACTION_NOTE],
    }]);
  });

  test("an alias of the companion is the companion", () => {
    expect(reports("import Hex.Dec as D\nlet a = D.divide(d, 0d, 2)")).toEqual([{
      message: "division by zero: `D.divide(d, 0d, 2)` has no value; write the divisor that was meant",
      at: "0d",
      notes: [DIVISION_NOTE],
    }]);
  });

  test("every refusal in a module is made", () => {
    expect(reports("let a = Int.div(1, 0)\nlet b = 1 // 0\nlet c = r / 0").map(({ at }) => at)).toEqual(["0", "0", "0"]);
  });

  // Each compiles; each that divides by zero faults when it runs.
  const compiled: readonly string[] = [
    // A name is never read, and nothing is computed (§12.1).
    "let a = Int.div(1, zero)",
    "let a = Int.div(1, 2 - 2)",
    "let a = r / (0 // 5)",
    "let a = r / (zero // 1)",
    "let a = 1 // zero",
    // A function value is never read (§12.2).
    "let g = Int.div\nlet a = g(1, 0)",
    // A division at a type variable is never read (§12.3).
    "let f = x => x / 0\nlet a = f(1.0)\nlet b = f(1 // 2)",
    "fun h<a: Integral>(n: a): a = n.div(0)\nlet a = h(7)",
    // Not checked divisions (§12.2).
    "let a = Rat.reciprocal(0)",
    "let a = Rat.pow(0, -1)",
    // `Float` answers rather than faults (§5.1).
    "let a = 1.0 / 0.0",
    "let a: Float = 1 / 0",
    "let a = Float.mod(1.0, 0.0)",
    "let a = Float.rem(1.0, 0.0)",
    // Divisors that are not zero, written as decimals the seat promotes.
    "let a = r / 0.5",
    "let a = Dec.divide(d, 0.5, 2)",
    "let a = Int.div(0, 1)",
    "let a = 0 // 1",
  ];

  test.each(compiled)("compiles %j", (line) => {
    expect(reports(line)).toEqual([]);
  });
});
