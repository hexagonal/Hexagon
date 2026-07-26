/**
 * Conformance for emitted-JavaScript shapes that typecheck cleanly but can be
 * mis-parsed or mis-executed by JavaScript itself. Each case executes the
 * emitted module, so a wrong shape shows up as a wrong value rather than as a
 * text mismatch.
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

async function run(source: string): Promise<Record<string, unknown>> {
  const file = new Source.File(Source.fileId(0), "/probe.hex", source);
  const resolved = resolve(parse(applyLayout(lex(file))), {});
  expect(resolved.diagnostics).toEqual([]);
  const typed = check(resolved);
  expect(typed.diagnostics).toEqual([]);
  const javascript = emitJavaScript(elaborate(typed));
  expect(javascript.diagnostics).toEqual([]);
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(javascript.text)}`;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

// Proves this file's harness can observe a failure: a harness that silently
// swallowed diagnostics would report every case below as green regardless of
// what the compiler did.
test("the harness reports a broken module rather than passing it", async () => {
  await expect(run("export let broken: Int = missing(1)\n")).rejects.toThrow();
});

describe("concise arrow bodies", () => {
  test("a lambda returning a record returns the record, not undefined", async () => {
    // A record construction inlines to its literal (the constructor is the
    // identity), so a concise arrow body would begin with `{` and be read as a
    // block.
    const m = await run(
      "record Box = { value: Int }\n" +
        "let wrapper: Int -> Box = value => Box({ value: value })\n" +
        "export let out: Int = (wrapper(7)).value\n",
    );
    expect(m.out).toBe(7);
  });

  test("a record-returning lambda passed as an argument behaves the same", async () => {
    const m = await run(
      "record Box = { value: Int }\n" +
        "let apply(transform: Int -> Box, value: Int): Box = transform(value)\n" +
        "export let out: Int = (apply(value => Box({ value: value }), 9)).value\n",
    );
    expect(m.out).toBe(9);
  });
});

describe("statement-position match", () => {
  const MAYBE = "union Maybe =\n    | Nothing\n    | Just(value: Int)\n";

  test("a matched arm does not fall through into the next arm", async () => {
    // Unit-valued arms emit statements rather than a `return`, so the switch
    // needs a `break` to stop control reaching the next arm's destructuring.
    const m = await run(
      MAYBE +
        "let pick(source: Maybe): Int =\n" +
        "    var result = 0\n" +
        "    match source\n" +
        "        Nothing => result := 1\n" +
        "        Just(value) => result := value\n" +
        "    result\n" +
        "export let nothingCase: Int = pick(Nothing)\n" +
        "export let justCase: Int = pick(Just(9))\n",
    );
    expect(m.nothingCase).toBe(1);
    expect(m.justCase).toBe(9);
  });

  test("a loop-valued arm does not fall through either", async () => {
    const m = await run(
      MAYBE +
        "let count(source: Maybe): Int =\n" +
        "    var total = 0\n" +
        "    match source\n" +
        "        Just(limit) =>\n" +
        "            for step in 1..limit\n" +
        "                total := total + step\n" +
        "        Nothing => total := 0 - 1\n" +
        "    total\n" +
        "export let summed: Int = count(Just(4))\n" +
        "export let missing: Int = count(Nothing)\n",
    );
    expect(m.summed).toBe(10);
    expect(m.missing).toBe(-1);
  });
});
