/**
 * Conformance for term-binding body blocks (Lexer & Layout §2.1): a binding's
 * indented RHS is a block whose value is its final expression, exactly as for a
 * function body — the parameter list is irrelevant. Covers the block itself, the
 * expression-continuation tokens that keep aligned multiline chains one item
 * (§2.3), and the block rules a binding body inherits (Statements §3).
 */
import { describe, expect, test } from "vitest";

import * as Source from "../support/source.js";
import { lex } from "../passes/lexer/lexer.js";
import { applyLayout } from "../passes/layout/layout.js";
import { parse } from "../passes/parser/parser.js";
import { resolve } from "../passes/resolver/resolver.js";
import { check } from "../passes/checker/checker.js";
import { elaborate } from "../passes/elaborator/elaborator.js";
import { emitJavaScript } from "../passes/emitter/emitter.js";

function typecheck(source: string) {
  const file = new Source.File(Source.fileId(0), "/probe.hex", source);
  const resolved = resolve(parse(applyLayout(lex(file))), {});
  const typed = check(resolved);
  return { resolved, typed };
}

/** Every diagnostic raised from lexing through checking. */
function diagnostics(source: string): string[] {
  const { resolved, typed } = typecheck(source);
  return [...resolved.diagnostics, ...typed.diagnostics].map(({ message }) => message);
}

async function run(source: string): Promise<Record<string, unknown>> {
  const { resolved, typed } = typecheck(source);
  expect(resolved.diagnostics).toEqual([]);
  expect(typed.diagnostics).toEqual([]);
  const javascript = emitJavaScript(elaborate(typed));
  expect(javascript.diagnostics).toEqual([]);
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(javascript.text)}`;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

describe("term-binding body blocks", () => {
  test("§2.1 a value binding's block yields its final expression", async () => {
    const m = await run(
      "let x =\n" +
        "    let y = 40\n" +
        "    y + 2\n" +
        "export let out: Int = x\n",
    );
    expect(m.out).toBe(42);
  });

  test("§2.1 the same block form nests inside a function body", async () => {
    const m = await run(
      "let compute(): Int =\n" +
        "    let total =\n" +
        "        let base = 40\n" +
        "        base + 1\n" +
        "    total\n" +
        "export let out: Int = compute()\n",
    );
    expect(m.out).toBe(41);
  });

  test("§2.1 a var binding takes the same treatment", async () => {
    const m = await run(
      "let compute(): Int =\n" +
        "    var running =\n" +
        "        let seed = 20\n" +
        "        seed * 2\n" +
        "    running := running + 2\n" +
        "    running\n" +
        "export let out: Int = compute()\n",
    );
    expect(m.out).toBe(42);
  });

  test("§2.1 a single wrapped expression is the one-item case", async () => {
    const m = await run(
      "let compute(value: Int): Int = value\n" +
        "let x =\n" +
        "    compute(42)\n" +
        "export let out: Int = x\n",
    );
    expect(m.out).toBe(42);
  });

  test("§2.3 a leading operator continues the preceding item", async () => {
    const m = await run(
      "let total =\n" +
        "    40\n" +
        "    + 2\n" +
        "export let out: Int = total\n",
    );
    expect(m.out).toBe(42);
  });

  test("§3 a binding body inherits the discarded-value rule", () => {
    // Two items, the first a computed value: the block rules apply here exactly
    // as in a function body.
    const messages = diagnostics(
      "let compute(): Int = 1\n" +
        "let x =\n" +
        "    compute()\n" +
        "    41\n" +
        "export let out: Int = x\n",
    );
    expect(messages.some((message) => message.includes("discarded"))).toBe(true);
  });

  test("§3.1 a binding body may not end in a binding", () => {
    const messages = diagnostics(
      "let x =\n" +
        "    let y = 40\n" +
        "export let out: Int = x\n",
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  test("type declarations stay continuations: union alternatives get no block", async () => {
    const m = await run(
      "union Shade =\n" +
        "    | Light\n" +
        "    | Dark\n" +
        "let name(shade: Shade): Int = match shade\n" +
        "    Light => 1\n" +
        "    Dark => 2\n" +
        "export let out: Int = name(Dark)\n",
    );
    expect(m.out).toBe(2);
  });
});
