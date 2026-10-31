/**
 * A declaration's parameters are the only type variables scoped over its
 * right-hand side (Declarations Preamble §3). A variable the head does not bind
 * is refused at the declaration (#1288): left free, it was quantified apart at
 * every construction and every match, so the declaration said "any type" and
 * was believed.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics } from "../support/test-project.js";

function applyEdits(source: string, edits: readonly { span: { start: { offset: number }; end: { offset: number } }; replacement: string }[]): string {
  let out = source;
  for (const edit of [...edits].sort((left, right) => right.span.start.offset - left.span.start.offset)) {
    out = out.slice(0, edit.span.start.offset) + edit.replacement + out.slice(edit.span.end.offset);
  }
  return out;
}

describe("#1288 an unbound type variable in a declaration is refused", () => {
  test("the unsound program: an `Int` function handed a `String` no longer compiles", () => {
    const messages = projectDiagnostics(
      "module Main\n\n" +
      "union V = V((b) -> Int)\n" +
      "let v = V((x: Int) => x + 1)\n" +
      "export let n: Int = match v\n" +
      "    V(f) => f(\"s\")\n",
    );
    expect(messages).toEqual([
      "type variable `b` is not a parameter of `V`; a `union` declaration binds every type variable it names: write `union V(b)`",
    ]);
  });

  test.each([
    ["record R = { f: b }\n", "a `record` declaration binds every type variable it names: write `record R(b)`"],
    ["type T = Vector(q)\n", "a `type` declaration binds every type variable it names: write `type T(q)`"],
    ["union W(a) = W(a, (c) -> c)\n", "a `union` declaration binds every type variable it names: write `union W(a, c)`"],
  ])("each declaration form refuses it: %s", (declaration, expected) => {
    const messages = projectDiagnostics("module Main\n\n" + declaration);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(expected);
  });

  test("bound and phantom parameters stay legal", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
      "record R(a) = { f: a }\n" +
      "union P(a) = X | Y\n" +
      "type F(b) = (b) -> Int\n" +
      "union V(a) = V(F(a))\n",
    )).toEqual([]);
  });

  test("the applied edit binds every missing variable at once and reaches legal code", () => {
    const source = "module Main\n\nopaque union V(+a) = V(a, b, c, b)\n";
    const compiled = compileMain(source);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "type variable `b` is not a parameter of `V`; a `union` declaration binds every type variable it names: write `union V(+a, b, c)`",
      "type variable `c` is not a parameter of `V`; a `union` declaration binds every type variable it names: write `union V(+a, b, c)`",
    ]);
    const edits = compiled.diagnostics[0]!.fixes![0]!.edits;
    expect(compiled.diagnostics[1]!.fixes![0]!.edits).toEqual(edits);
    const repaired = applyEdits(source, edits);
    expect(repaired).toBe("module Main\n\nopaque union V(+a, b, c) = V(a, b, c, b)\n");
    expect(projectDiagnostics(repaired)).toEqual([]);
  });

  test("a head with no parameters gains a parameter list", () => {
    const source = "module Main\n\nrecord R = { f: b }\n";
    const compiled = compileMain(source);
    expect(applyEdits(source, compiled.diagnostics[0]!.fixes![0]!.edits))
      .toBe("module Main\n\nrecord R(b) = { f: b }\n");
  });

  test("a variable reached through an alias is the alias's report, once, even across modules", () => {
    const project = compileFiles([
      ["/main.hex", "module Main\nimport Lib\nunion V = V(Lib.F)\n"],
      ["/lib.hex", "module Lib\nexport type F = (b) -> Int\n"],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "type variable `b` is not a parameter of `F`; a `type` declaration binds every type variable it names: write `type F(b)`",
    ]);
    expect(Number(project.diagnostics[0]!.primary.fileId)).toBe(1);
  });
});
