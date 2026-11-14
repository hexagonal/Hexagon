import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for an exported `let` whose value is a lambda (Modules §4.1.1,
 * #1402).
 *
 * The signature is complete in either place: the binding's name carries the
 * whole type, or the lambda annotates every parameter and its result. The
 * check used to read only the lambda, so `export let u: (Int) -> Int = (x) =>
 * x` — whose type is written, whole, on its name — was refused for leaving
 * `x` unannotated. Only when neither place is complete is the export refused.
 *
 * What the ruling leaves alone is pinned beside it: the hole fence speaks in
 * both places, the constraint tier (#1047) applies to either form, an
 * ascription is not a signature, and a binding whose value is not a lambda
 * draws what it drew before.
 */

const HEADER = "module Main\n\n";
const INCOMPLETE_U =
  "exported function `u` requires a complete signature; add type for parameter `x` and a return type";
const FENCE = "an exported signature is complete (Modules §4.1.1); replace `_` with the intended type";

/** Each report as `[the text its primary spans, its message]`. */
function reports(source: string): readonly (readonly string[])[] {
  const text = HEADER + source;
  return compileMain(text).diagnostics.map(({ primary, message }) => [
    text.slice(primary.start.offset, primary.end.offset),
    message,
  ]);
}

/** `/main.hex`'s emitted `.d.ts`. */
function declarations(source: string): string {
  const project = compileMain(HEADER + source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const main = project.modules.find(({ name }) => name === "Main");
  if (main === undefined) throw new Error("no module `Main` in the compiled project");
  return main.declarations.text;
}

describe("the name carries the whole type", () => {
  test("a bare lambda is accepted at every arity", () => {
    expect(reports("export let nothing: () -> Unit = () => ()\n")).toEqual([]);
    expect(reports("export let u: (Int) -> Int = (x) => x\n")).toEqual([]);
    expect(reports("export let pick: (Int, String) -> String = (n, s) => s\n")).toEqual([]);
  });

  test("a partially annotated lambda is accepted", () => {
    expect(reports("export let u: (Int) -> Int = (x: Int) => x\n")).toEqual([]);
    expect(reports("export let pick: (Int, String) -> String = (n, s: String) => s\n")).toEqual([]);
  });

  test("the type may be written through an alias, or name a type variable", () => {
    expect(reports("type Step = (Int) -> Int\nexport let u: Step = (x) => x + 1\n")).toEqual([]);
    expect(reports("export let id: (a) -> a = (x) => x\n")).toEqual([]);
  });

  test("the lambda is checked against the written type", () => {
    // The parameters take their types from the name, as a private binding's
    // do: `x + 1` checks at `Int`, and a body the type does not admit is
    // refused for the mismatch, not for the signature.
    expect(reports("export let u: (Int) -> Int = (x) => x + 1\n")).toEqual([]);
    expect(reports('export let u: (Int) -> Int = (x) => "s"\n')).toEqual([
      ["(Int) -> Int", "type mismatch: expected Int, found String"],
    ]);
    expect(reports("export let u: (Int) -> Int = (x, y) => x\n")).toEqual([
      ["(Int) -> Int", "function arity mismatch: 1 and 2"],
    ]);
  });

  test("the declaration file reads as the lambda-annotated form's", () => {
    // Parameter names come from the lambda either way; the types from the
    // binding's scheme.
    expect(declarations("export let u: (Int) -> Int = (x) => x\n"))
      .toBe("export declare const u: (x: number) => number;\n");
    expect(declarations("export let u(x: Int): Int = x\n"))
      .toBe("export declare const u: (x: number) => number;\n");
    expect(declarations("export let id: (a) -> a = (x) => x\n"))
      .toBe("export declare const id: <a>(x: a) => a;\n");
  });

  test("a name-typed export runs, from JavaScript and from an importing module", async () => {
    const exports = await runMain(
      HEADER +
        "export let nothing: () -> Unit = () => ()\n" +
        "export let inc: (Int) -> Int = (x) => x + 1\n" +
        "export let pick: (Int, String) -> String = (n, s) => s ++ show(n)\n",
    );
    expect((exports["inc"] as (x: number) => number)(41)).toBe(42);
    expect((exports["pick"] as (n: number, s: string) => string)(7, "n")).toBe("n7");
    expect((exports["nothing"] as () => unknown)()).toBe(undefined);

    const imported = await runProject([
      ["/lib.hex", "module Lib\n\nexport let inc: (Int) -> Int = (x) => x + 1\n"],
      ["/main.hex", HEADER + "import Lib\n\nexport let r: Int = Lib.inc(41)\n"],
    ]);
    expect(imported["r"]).toBe(42);
  });
});

describe("the lambda carries the whole type", () => {
  test("a fully annotated lambda with no name type is accepted", () => {
    expect(reports("export let u = (x: Int): Int => x\n")).toEqual([]);
    expect(reports("export let nothing = (): Unit => ()\n")).toEqual([]);
  });

  test("both places written is accepted", () => {
    expect(reports("export let u: (Int) -> Int = (x: Int): Int => x\n")).toEqual([]);
  });
});

describe("neither place is complete", () => {
  test("the report names what the lambda leaves unwritten, unchanged", () => {
    expect(reports("export let u = (x) => x\n")).toEqual([["u", INCOMPLETE_U]]);
    expect(reports("export let u = (x: Int) => x\n")).toEqual([
      ["u", "exported function `u` requires a complete signature; add a return type"],
    ]);
  });
});

describe("holes stay fenced in both places", () => {
  test("a hole in the lambda is refused even under a whole name type", () => {
    expect(reports("export let u: (Int) -> Int = (x: _) => x\n")).toEqual([["_", FENCE]]);
    expect(reports("export let u: (Int) -> Int = (x): _ => x\n")).toEqual([["_", FENCE]]);
  });

  test("a hole in the name type is the fence's one report; the bare lambda owes nothing", () => {
    // Replacing `_` is the whole repair, so the lambda's unwritten annotations
    // are not reported beside it (Modules §4.1.1): one fact is one report.
    expect(reports("export let u: (_) -> Int = (x) => x\n")).toEqual([["(_)", FENCE]]);
    expect(reports("export let u: (Int) -> _ = (x) => x\n")).toEqual([["_", FENCE]]);
  });

  test("a bare `_` as the whole name type is the fence's one report", () => {
    expect(reports("export let u: _ = (x) => x\n")).toEqual([["_", FENCE]]);
  });

  test("a hole in the name type over a fully annotated lambda is the same one report", () => {
    expect(reports("export let u: (_) -> Int = (x: Int): Int => x\n")).toEqual([["(_)", FENCE]]);
  });

  test("with no name type at all, the bare lambda still owes its signature", () => {
    expect(reports("export let u = (x) => x\n")).toEqual([["u", INCOMPLETE_U]]);
  });
});

describe("the constraint tier applies to the name-typed form unchanged (#1047)", () => {
  test("an unwritten constraint is refused, and the binder on the name is accepted", () => {
    expect(reports("export let s: (a) -> String = (x) => show(x)\n")).toEqual([
      ["s", "exported function `s` must declare every constraint in its signature; write `<a: Show>`"],
    ]);
    // The binder is the name's, as `export let alias<a: Show>: (a) -> String =
    // describe` writes it (Modules §4.1.1, Functions §4.2).
    expect(reports("export let s<a: Show>: (a) -> String = (x) => show(x)\n")).toEqual([]);
  });

  test("the constrained name-typed export specializes as the header form does", () => {
    const shown = declarations("export let s<a: Show>: (a) -> String = (x) => show(x)\n");
    expect(shown).toBe(declarations("export let s<a: Show>(x: a): String = show(x)\n"));
    expect(shown).toContain("export declare function sInt(x: number): string;\n");
  });
});

describe("what is not a lambda value draws what it drew before", () => {
  test("a named function or an `if` between lambdas, under a name type", () => {
    expect(reports(
      "let inc(x: Int): Int = x + 1\n" +
        "export let u: (Int) -> Int = inc\n" +
        "export let w: (Int) -> Int = if True then (x) => x else (x) => x + 1\n",
    )).toEqual([]);
  });

  test("the same shapes with no name type still ask for the binding's type", () => {
    expect(reports(
      "let inc(x: Int): Int = x + 1\n" +
        "export let u = inc\n" +
        "export let w = if True then (x: Int): Int => x else (x: Int): Int => x + 1\n",
    )).toEqual([
      ["u", "exported value `u` requires a type annotation"],
      ["w", "exported value `w` requires a type annotation"],
    ]);
  });

  test("an ascription around the lambda is not a signature (Ascription)", () => {
    expect(reports("export let u = ((x) => x : (Int) -> Int)\n")).toEqual([
      ["u", "exported value `u` requires a type annotation"],
    ]);
    expect(reports("export let u = ((x: Int): Int => x : (Int) -> Int)\n")).toEqual([
      ["u", "exported value `u` requires a type annotation"],
    ]);
  });

  test("an imported name-typed function checks at the written type", () => {
    const project = compileFiles([
      ["/lib.hex", "module Lib\n\nexport let inc: (Int) -> Int = (x) => x + 1\n"],
      ["/main.hex", HEADER + "import Lib\n\nexport let r: Int = Lib.inc(\"s\")\n"],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "type mismatch: expected Int, found String",
    ]);
  });
});
