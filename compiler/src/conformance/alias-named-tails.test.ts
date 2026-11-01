/**
 * An alias's row tail is fresh at each use (Products §4), so a `type` alias may
 * not name one (#1406). Named, it was no parameter of the alias (Declarations
 * Preamble §3) and, inlined, joined the using signature's tail of that name.
 */

import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

const REFUSAL = (name: string): string =>
  `a \`type\` alias's row tail is fresh at each use, so it cannot be named; write \`...\` for \`...${name}\``;

function applyEdits(source: string, edits: readonly { span: { start: { offset: number }; end: { offset: number } }; replacement: string }[]): string {
  let out = source;
  for (const edit of [...edits].sort((left, right) => right.span.start.offset - left.span.start.offset)) {
    out = out.slice(0, edit.span.start.offset) + edit.replacement + out.slice(edit.span.end.offset);
  }
  return out;
}

describe("#1406 a type alias's row tail cannot be named", () => {
  test("the captured program: refused at the alias, and the call no longer reports a cascade", () => {
    // Before, `Row`'s `r` joined `q`'s, and the call was refused with "unexpected `z`".
    expect(projectDiagnostics(
      "module Main\n\n" +
      "type Row = {n: Int, ...r}\n" +
      "let g(p: Row, q: {k: Int, ...r}): Int = p.n + q.k\n" +
      "export let out: Int = g({n = 1, m = 2}, {k = 3, z = \"s\"})\n",
    )).toEqual([REFUSAL("r")]);
  });

  test("every named tail at any depth is refused, each at its name", () => {
    expect(projectDiagnostics(
      "module Main\n\ntype F = ({n: Int, ...r}) -> {m: Vector({k: Int, ...s})}\n",
    )).toEqual([REFUSAL("r"), REFUSAL("s")]);
  });

  test("the applied edit writes the bare tail, which is legal and fresh at each use", async () => {
    const source = "module Main\n\n" +
      "type Row = {n: Int, ...r}\n" +
      "let g(p: Row, q: {k: Int, ...r}): Int = p.n + q.k\n" +
      "export let out: Int = g({n = 1, m = 2}, {k = 3, z = \"s\"})\n";
    const compiled = compileMain(source);
    const repaired = applyEdits(source, compiled.diagnostics[0]!.fixes![0]!.edits);
    expect(repaired).toContain("type Row = {n: Int, ...}\n");
    expect(projectDiagnostics(repaired)).toEqual([]);
    expect(await runMain(repaired)).toMatchObject({ out: 4 });
  });

  test("a function signature still names its tails", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
      "export let touch(p: {x: Float, ...r}): {x: Float, ...r} = {p with x = p.x + 1.0}\n",
    )).toEqual([]);
  });

  test("a tail written as an alias parameter too is one report naming both repairs, with no edit", () => {
    const compiled = compileMain("module Main\n\ntype Row(r) = {n: Int, ...r}\n");
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      REFUSAL("r") + ", and remove the parameter `r`",
    ]);
    expect(compiled.diagnostics[0]!.fixes ?? []).toEqual([]);
  });

  test("a parameter the body also uses as a type keeps; only the tail goes", () => {
    const source = "module Main\n\ntype Row(r) = {n: r, ...r}\n";
    const compiled = compileMain(source);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([REFUSAL("r")]);
    expect(projectDiagnostics(applyEdits(source, compiled.diagnostics[0]!.fixes![0]!.edits))).toEqual([]);
  });

  test("an alias whose parameter is only a tail still gets the unbound-variable edit", () => {
    const compiled = compileMain("module Main\n\ntype Row(r) = {n: a, ...r}\n");
    const unbound = compiled.diagnostics.find(({ message }) => message.startsWith("type variable `a`"));
    expect(unbound?.message).toContain("write `type Row(r, a)`");
    expect(unbound?.fixes?.length).toBe(1);
  });

  test("a tail written in an alias's argument at a use site is the signature's, and kept", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
      "type Box(a) = {v: a}\n" +
      "export let f(p: Box({x: Int, ...r})): {x: Int, ...r} = p.v\n",
    )).toEqual([]);
  });
});
