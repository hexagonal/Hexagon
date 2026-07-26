/**
 * Conformance for pattern parameters (Functions §3.1, Pattern Matching §6.5):
 * each parameter is a full irrefutable pattern. The outer parentheses are the
 * parameter list and top-level commas separate parameters, so anything nested
 * is pattern syntax — `(x, y)` is two parameters, `((x, y))` is one that
 * destructures a tuple. Header sugar inherits all of it verbatim (§3.2's
 * identical-AST rule).
 */
import { describe, expect, test } from "vitest";

import * as Source from "../support/source.js";
import { lex } from "../passes/lexer/lexer.js";
import { applyLayout } from "../passes/layout/layout.js";
import { parse } from "../passes/parser/parser.js";
import { resolve } from "../passes/resolver/resolver.js";
import { check } from "../passes/checker/checker.js";
import { elaborate } from "../passes/elaborator/elaborator.js";
import { emitDeclarations, emitJavaScript } from "../passes/emitter/emitter.js";

function diagnostics(source: string): string[] {
  const file = new Source.File(Source.fileId(0), "/probe.hex", source);
  const resolved = resolve(parse(applyLayout(lex(file))), {});
  const typed = check(resolved);
  return [...resolved.diagnostics, ...typed.diagnostics].map(({ message }) => message);
}

/** The parameter names of the sole declaration `source` emits, in order. */
function renderedParameterNames(source: string): string[] {
  const signature = /\((.*)\) =>/.exec(declarations(source));
  expect(signature).not.toBeNull();
  return signature![1]!.split(", ").map((parameter) => parameter.split(":")[0]!.trim());
}

function declarations(source: string): string {
  const file = new Source.File(Source.fileId(0), "/probe.hex", source);
  const resolved = resolve(parse(applyLayout(lex(file))), {});
  const typed = check(resolved);
  expect([...resolved.diagnostics, ...typed.diagnostics]).toEqual([]);
  return emitDeclarations(elaborate(typed)).text;
}

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

// Proves this file's harness can observe a failure.
test("the harness reports a broken module rather than passing it", () => {
  expect(diagnostics("export let broken: Int = missing(1)\n").length).toBeGreaterThan(0);
});

describe("wildcard parameters", () => {
  test("§6.5 a bare wildcard lambda takes one argument and ignores it", async () => {
    const m = await run("let f = _ => 5\nexport let out: Int = f(99)\n");
    expect(m.out).toBe(5);
  });

  test("§6.5 a wildcard in header position behaves identically", async () => {
    const m = await run("let f(_) = 5\nexport let out: Int = f(99)\n");
    expect(m.out).toBe(5);
  });

  test("§6.5 wildcards bind nothing, so several may appear", async () => {
    const m = await run("let f(_, x, _) = x\nexport let out: Int = f(1, 7, 3)\n");
    expect(m.out).toBe(7);
  });

  test("§5.3 the eta-wrap now compiles as written in the spec", async () => {
    const m = await run(
      "let apply(transform: a -> b, value: a): b = transform(value)\n" +
        "let five(): Int = 5\n" +
        "export let out: Int = apply(_ => five(), ())\n",
    );
    expect(m.out).toBe(5);
  });
});

describe("destructuring parameters", () => {
  test("§6.5 a sole tuple-destructured parameter", async () => {
    const m = await run("let f = ((x, y)) => x + y\nexport let out: Int = f((3, 4))\n");
    expect(m.out).toBe(7);
  });

  test("§6.5 the same in header position", async () => {
    const m = await run("let f((x, y)) = x + y\nexport let out: Int = f((3, 4))\n");
    expect(m.out).toBe(7);
  });

  test("§6.5 nesting works to any depth", async () => {
    const m = await run(
      "let f(((a, b), c)) = a + b + c\nexport let out: Int = f(((1, 2), 3))\n",
    );
    expect(m.out).toBe(6);
  });

  test("§6.5 a single-constructor union parameter is irrefutable", async () => {
    const m = await run(
      "union UserId = UserId(value: Int)\n" +
        "let f(UserId(n)) = n\n" +
        "export let out: Int = f(UserId(7))\n",
    );
    expect(m.out).toBe(7);
  });
});

describe("the depth rule and the irrefutability gate", () => {
  test("§6.5 `(x, y)` is two parameters, `((x, y))` is one", () => {
    expect(
      diagnostics("let f = ((x, y)) => x + y\nexport let out: Int = f(1, 2)\n")
        .some((m) => m.includes("expects 1 arguments")),
    ).toBe(true);
    expect(
      diagnostics("let f = (x, y) => x + y\nexport let out: Int = f((1, 2))\n")
        .some((m) => m.includes("expects 2 arguments")),
    ).toBe(true);
  });

  test("§6.5 a refutable parameter is rejected", () => {
    const messages = diagnostics(
      "union Shade =\n    | Light\n    | Dark\nlet f(Light) = 1\nexport let out: Int = f(Light)\n",
    );
    expect(messages.some((m) => m.includes("refutable"))).toBe(true);
  });

  test("a plain name parameter is unchanged", async () => {
    const m = await run("let f(value) = value\nexport let out: Int = f(7)\n");
    expect(m.out).toBe(7);
  });
});

describe("signature positions have no body to destructure into", () => {
  test("an extern function rejects a pattern parameter", () => {
    expect(
      diagnostics('extern from "m"\n    fun f((x, y): (Int, Int)): Int\n'),
    ).toContain("extern functions take plain parameter names, not patterns");
  });

  test("a constraint member rejects a pattern parameter", () => {
    expect(
      diagnostics("constraint Sized<a> =\n    size((x, y): (a, a)): Int\n"),
    ).toContain("constraint members take plain parameter names, not patterns");
  });

  test("a wildcard is accepted there: it binds nothing, so nothing is destructured", () => {
    expect(diagnostics('extern from "m"\n    fun f(_: Int): Int\n')).toEqual([]);
  });
});

describe("the synthetic binder never reaches the reader", () => {
  // The lexer reserves `__hex_`, so a diagnostic naming a synthetic binder
  // would tell the reader to write an identifier the lexer refuses — a Rewrite
  // Rule breach (Declarations Preamble §1.1).
  test("the incomplete-signature diagnostic names `_`, not the minted binder", () => {
    const messages = diagnostics("export let f(((a, b), c)) = a + b + c\n");
    expect(messages.some((m) => m.includes("add type for parameter `_`"))).toBe(true);
    expect(messages.some((m) => m.includes("__hex_"))).toBe(false);
  });

  test("emitted declarations do not publish the minted binder", () => {
    const text = declarations(
      "export let f(_: Int): Int = 1\n" +
        "export let g(((a, b), c): ((Int, Int), Int)): Int = a + b + c\n",
    );
    expect(text).not.toContain("__hex_");
  });

  test("an extern signature does not publish the minted binder", () => {
    const text = declarations('extern from "m"\n    export fun f(_: Int): Int\n');
    expect(text).not.toContain("__hex_");
  });

  test("two synthetic parameters render distinctly, keeping the output valid", () => {
    const text = declarations("export let f(_: Int, _: Int): Int = 1\n");
    expect(text).toContain("arg0");
    expect(text).toContain("arg1");
  });

  // TypeScript rejects a duplicate parameter name, so a module that checks
  // clean must not emit declarations that do not. `argN` is itself writable,
  // so the generated name yields; the user's is never renamed.
  test("a user parameter already spelt `arg0` pushes the generated name aside", () => {
    expect(renderedParameterNames("export let f(_: Int, arg0: Int): Int = arg0\n"))
      .toEqual(["arg1", "arg0"]);
  });

  test("the same collision at the generated name's own index", () => {
    expect(renderedParameterNames("export let g(arg1: Int, _: Int): Int = arg1\n"))
      .toEqual(["arg1", "arg2"]);
  });

  test("every rendered signature names its parameters distinctly", () => {
    const names = renderedParameterNames(
      "export let h(_: Int, arg0: Int, _: Int, arg1: Int, _: Int): Int = arg0\n",
    );
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("arg0");
    expect(names).toContain("arg1");
  });
});
