import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

/**
 * Conformance for **an assignment's value block** (#1590; Lexer & Layout §2.1,
 * Statements §6.3, Operators §12).
 *
 * A line ending in `:=` opens a block, as a line ending in a binding's `=`
 * does, and the value assigned is the block's final expression. Every shape
 * here is executed: the block's `let`s must stay its own, and its value must be
 * what lands in the `var`.
 */

function diagnostics(source: string): readonly string[] {
  return compileMain("module Main\n\n" + source).diagnostics.map(({ message }) => message);
}

async function run(source: string): Promise<Record<string, unknown>> {
  return runMain("module Main\n\n" + source);
}

describe("a line ending in `:=` opens the value's block", () => {
  test("several items assign the final expression", async () => {
    const source =
      "export let charge(weight: Int, distance: Int): Int =\n" +
      "    var total = 1\n" +
      "    total :=\n" +
      "        let carriage = weight * 4\n" +
      "        let mileage = distance * 2\n" +
      "        carriage + mileage + total\n" +
      "    total\n";
    expect(diagnostics(source)).toEqual([]);
    const charge = (await run(source))["charge"] as (weight: number, distance: number) => number;
    expect(charge(3, 5)).toBe(23);
  });

  test("a single wrapped expression assigns what it would on the `:=` line", async () => {
    const source =
      "export let next(n: Int): Int =\n" +
      "    var total = n\n" +
      "    total :=\n" +
      "        total + 1\n" +
      "    total\n";
    expect(diagnostics(source)).toEqual([]);
    expect(((await run(source))["next"] as (n: number) => number)(4)).toBe(5);
  });

  test("a `match` and an `if` beneath `:=` are the value", async () => {
    const source =
      "export let pick(n: Int): Int =\n" +
      "    var chosen = 0\n" +
      "    chosen :=\n" +
      "        match n with\n" +
      "            0 => 10\n" +
      "            _ => n\n" +
      "    var signed = 0\n" +
      "    signed :=\n" +
      "        if n > 0 then\n" +
      "            1\n" +
      "        else\n" +
      "            0 - 1\n" +
      "    chosen * signed\n";
    expect(diagnostics(source)).toEqual([]);
    const pick = (await run(source))["pick"] as (n: number) => number;
    expect(pick(0)).toBe(-10);
    expect(pick(3)).toBe(3);
  });

  test("the block's names are its own, bound afresh each time it runs", async () => {
    const source =
      "export let summed(n: Int): Int =\n" +
      "    var total = 0\n" +
      "    for item in 1..n do\n" +
      "        total :=\n" +
      "            let step = item * 2\n" +
      "            total + step\n" +
      "    let step = 100\n" +
      "    total + step\n";
    expect(diagnostics(source)).toEqual([]);
    expect(((await run(source))["summed"] as (n: number) => number)(3)).toBe(112);

    const leaking =
      "export let leaks(n: Int): Int =\n" +
      "    var total = 0\n" +
      "    total :=\n" +
      "        let inner = n\n" +
      "        inner\n" +
      "    inner\n";
    expect(diagnostics(leaking).some((message) => message.includes("inner"))).toBe(true);
  });

  test("the block's value must have the `var`'s type", () => {
    const source =
      "export let wrong(n: Int): Int =\n" +
      "    var total = 0\n" +
      "    total :=\n" +
      "        let text = \"many\"\n" +
      "        text\n" +
      "    total\n";
    expect(diagnostics(source)).not.toEqual([]);
  });
});
