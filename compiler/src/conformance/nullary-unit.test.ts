/**
 * Conformance for the `() -> T` versus `Unit -> T` distinction (Functions §5.3).
 * They are different types: the first takes no argument, the second takes one
 * argument whose type is `Unit`. Confusing them otherwise surfaces as a bare
 * 1-and-0 arity mismatch naming neither the cause nor the fix.
 */
import { describe, expect, test } from "vitest";

import * as Source from "../support/source.js";
import { lex } from "../passes/lexer/lexer.js";
import { applyLayout } from "../passes/layout/layout.js";
import { parse } from "../passes/parser/parser.js";
import { resolve } from "../passes/resolver/resolver.js";
import { check } from "../passes/checker/checker.js";

function diagnostics(source: string): string[] {
  const file = new Source.File(Source.fileId(0), "/probe.hex", source);
  const resolved = resolve(parse(applyLayout(lex(file))), {});
  const typed = check(resolved);
  return [...resolved.diagnostics, ...typed.diagnostics].map(({ message }) => message);
}

// Proves this file's harness can observe a failure.
test("the harness reports a broken module rather than passing it", () => {
  expect(diagnostics("export let broken: Int = missing(1)\n").length).toBeGreaterThan(0);
});

describe("the two thunk-shaped types", () => {
  test("§5.3 both spellings are legal and distinct", () => {
    expect(diagnostics("let thunk: () -> Int = () => 5\nlet v: Int = thunk()\n")).toEqual([]);
    expect(diagnostics("let taking: Unit -> Int = value => 5\nlet v: Int = taking(())\n")).toEqual([]);
  });

  test("§5.3 a nullary lambda meeting `Unit -> T` names the fix", () => {
    const messages = diagnostics("let taking: Unit -> Int = () => 5\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("for a zero-parameter function write `() -> T`");
  });

  test("§5.3 an annotated unit parameter meeting `() -> T` names the fix", () => {
    const messages = diagnostics("let thunk: () -> Int = (value: Unit) => 5\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("for a zero-parameter function write `() -> T`");
  });

  test("§5.3 an unannotated lambda parameter keeps the general message", () => {
    // Nothing proves the parameter is `Unit`, so the specialized message would
    // be an unproven claim.
    const messages = diagnostics("let thunk: () -> Int = value => 5\n");
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((m) => !m.includes("zero-parameter function"))).toBe(true);
  });

  test("§5.3 calling a `Unit -> T` with no arguments names the fix", () => {
    const messages = diagnostics("let taking(value: Unit): Int = 5\nlet v: Int = taking()\n");
    expect(messages.some((m) => m.includes("takes one unit argument; write `f(())`"))).toBe(true);
  });

  test("§5.3 calling a `() -> T` with an argument names the fix", () => {
    const messages = diagnostics("let thunk(): Int = 5\nlet v: Int = thunk(())\n");
    expect(messages.some((m) => m.includes("takes no arguments; write `f()`"))).toBe(true);
  });

  test("§5.3 an unsolved parameter keeps the general message", () => {
    // The generic slot's parameter is a variable, not `Unit`: claiming `Unit`
    // here would be unproven. The honest fix is the eta-wrap.
    const messages = diagnostics(
      "let apply(transform: a -> b, value: a): b = transform(value)\n" +
        "let five(): Int = 5\n" +
        "let v: Int = apply(five, ())\n",
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((m) => !m.includes("zero-parameter function"))).toBe(true);
  });

  test("§5.3 the eta-wrap bridges a thunk into a generic slot", () => {
    expect(
      diagnostics(
        "let apply(transform: a -> b, value: a): b = transform(value)\n" +
          "let five(): Int = 5\n" +
          "let v: Int = apply(ignored => five(), ())\n",
      ),
    ).toEqual([]);
  });
});
