import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics } from "../support/test-project.js";

/**
 * A long arithmetic chain compiles in time linear in its length (#1072).
 *
 * Each level of a left-nested chain once materialized its operands twice in the
 * checker and emitted them twice in the emitter, so every term doubled the
 * work: 22 terms took seconds and 100 never finished. A compile is synchronous,
 * so no test timeout can interrupt one; the guard is a chain long enough that
 * either doubling takes many seconds, against a bound a hundred times what the
 * linear walk needs.
 */

const HEADER = "module Main\n\nlet n: Int = 3\nlet f: Float = 1.5\nlet price: Dec = 2.50d\n";
const TERMS = 24;
const BOUND_MS = 2_000;
const chain = (operator = " + "): string => Array.from({ length: TERMS }, () => "n").join(operator);

/** The source's diagnostics, and how long its compile took. */
function timed(source: string): { readonly messages: readonly string[]; readonly ms: number } {
  const start = Date.now();
  const messages = projectDiagnostics(HEADER + source);
  return { messages, ms: Date.now() - start };
}

describe("a long arithmetic chain compiles in linear time", () => {
  test("at a primitive, where the emitter inlines the operator", () => {
    const start = Date.now();
    const project = compileMain(HEADER + `let x = ${chain()}\n`);
    expect(Date.now() - start).toBeLessThan(BOUND_MS);
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ name }) => name === "Main")!;
    const line = main.javascript.text.split("\n").find((text) => text.includes("const x ="))!;
    expect(line.match(/n \+ /gu)).toHaveLength(TERMS - 1);
  });

  test("under a written face, and through a member's dictionary", () => {
    for (const source of [`let x: Float = ${chain()}\n`, `let x = price * ${chain(" * ")}\n`]) {
      const { messages, ms } = timed(source);
      expect(messages, source).toEqual([]);
      expect(ms, source).toBeLessThan(BOUND_MS);
    }
  });

  test("refused once where its face declines", () => {
    const { messages, ms } = timed(`let x: Dec = f + ${chain()}\n`);
    expect(messages).toHaveLength(1);
    expect(ms).toBeLessThan(BOUND_MS);
  });
});
