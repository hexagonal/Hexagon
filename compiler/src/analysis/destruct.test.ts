import { describe, expect, test } from "vitest";
import { AnalysisSession, type CodeAction } from "./session.js";

/**
 * Destruct (language-server plan, section C, tier 2): on a `match` with no
 * arms yet, the editor writes one arm per case of the subject's type, each
 * body a `Debug.todo` naming the case (decision 5), as the repair for the
 * report of the missing arm block.
 */

const SHAPE = "export union Shape = Circle(radius: Float) | Square(side: Float) | Tri(a: Float, b: Float)";

function session(files: Readonly<Record<string, string>>): AnalysisSession {
  const analysis = new AnalysisSession();
  for (const [path, text] of Object.entries(files)) analysis.setFile(path, text);
  return analysis;
}

function program(...lines: readonly string[]): string {
  return ["module Main", SHAPE, ...lines].join("\n") + "\n";
}

/** The repairs offered on the first `match`, asked as the editor asks on its own. */
function repairs(text: string): readonly CodeAction[] {
  const at = text.indexOf("match");
  return session({ "/main.hex": text }).codeActions("/main.hex", { start: at, end: at })
    .filter(({ diagnostic }) => diagnostic?.message === "expected an indented block of match arms");
}

function applied(text: string, action: CodeAction): string {
  return [...action.edits].reverse().reduce(
    (written, { span, replacement }) => written.slice(0, span.start.offset) + replacement + written.slice(span.end.offset),
    text,
  );
}

/** The program after the one repair, and what it then reports. */
function destructed(text: string): { readonly text: string; readonly diagnostics: readonly string[] } {
  const [repair, ...others] = repairs(text);
  expect(others).toEqual([]);
  if (repair === undefined) throw new Error("no repair offered");
  const after = applied(text, repair);
  return { text: after, diagnostics: session({ "/main.hex": after }).diagnostics("/main.hex").map(({ message }) => message) };
}

describe("destruct on a `match` with no arms", () => {
  test("one arm per case of the subject's type, in declaration order", () => {
    const text = program("export let area(s: Shape): Float =", "    match s", "export let one: Int = 1");
    expect(repairs(text).map(({ title, kind, preferred }) => ({ title, kind, preferred })))
      .toEqual([{ title: "Add the 3 arms", kind: "quickfix", preferred: undefined }]);
    expect(destructed(text)).toEqual({
      text: program(
        "export let area(s: Shape): Float =",
        "    match s",
        "        Circle(_) => Debug.todo(\"Circle(_)\")",
        "        Square(_) => Debug.todo(\"Square(_)\")",
        "        Tri(_, _) => Debug.todo(\"Tri(_, _)\")",
        "export let one: Int = 1",
      ),
      diagnostics: [],
    });
  });

  test("its stand-ins selected in turn", () => {
    const text = program("export let area(s: Shape): Float =", "    match s");
    expect(repairs(text)[0]?.edits.map(({ snippet }) => snippet?.text)).toEqual([
      "        Circle(_) => ${1:Debug.todo(\"Circle(_)\")}\n" +
      "        Square(_) => ${2:Debug.todo(\"Square(_)\")}\n" +
      "        Tri(_, _) => ${3:Debug.todo(\"Tri(_, _)\")}\n",
    ]);
  });

  test("a match function's, from its parameter's type", () => {
    const text = program("export let area: Shape -> Float =", "    match", "export let one: Int = 1");
    expect(destructed(text).text).toBe(program(
      "export let area: Shape -> Float =",
      "    match",
      "        Circle(_) => Debug.todo(\"Circle(_)\")",
      "        Square(_) => Debug.todo(\"Square(_)\")",
      "        Tri(_, _) => Debug.todo(\"Tri(_, _)\")",
      "export let one: Int = 1",
    ));
  });

  test("one step in from where the `match`'s line begins, below its comments", () => {
    const text = program("export let area(s: Shape): Float = match s // to do", "export let one: Int = 1");
    expect(destructed(text)).toEqual({
      text: program(
        "export let area(s: Shape): Float = match s // to do",
        "    Circle(_) => Debug.todo(\"Circle(_)\")",
        "    Square(_) => Debug.todo(\"Square(_)\")",
        "    Tri(_, _) => Debug.todo(\"Tri(_, _)\")",
        "export let one: Int = 1",
      ),
      diagnostics: [],
    });
  });

  test("nested cases are the type's own: `Bool`, `Option`", () => {
    const text = program("export let f(o: Option(Bool)): Int =", "    match o");
    expect(destructed(text)).toEqual({
      text: program(
        "export let f(o: Option(Bool)): Int =",
        "    match o",
        "        Some(_) => Debug.todo(\"Some(_)\")",
        "        None => Debug.todo(\"None\")",
      ),
      diagnostics: [],
    });
  });

  test("with the file's line ending", () => {
    const text = program("export let area(s: Shape): Float =", "    match s", "export let one: Int = 1").replaceAll("\n", "\r\n");
    expect(destructed(text).text).toBe(program(
      "export let area(s: Shape): Float =",
      "    match s",
      "        Circle(_) => Debug.todo(\"Circle(_)\")",
      "        Square(_) => Debug.todo(\"Square(_)\")",
      "        Tri(_, _) => Debug.todo(\"Tri(_, _)\")",
      "export let one: Int = 1",
    ).replaceAll("\n", "\r\n"));
  });

  test("not where there are no cases to name, or the file was not read as written", () => {
    expect(repairs(program("export let f(n: Int): Int =", "    match n"))).toEqual([]);
    expect(repairs(program("export let f(p: { x: Int }): Int =", "    match p"))).toEqual([]);
    expect(repairs(program("export let area(s: Shape): Float =", "    match s", ")"))).toEqual([]);
    expect(repairs(program("module Debug", "export let area(s: Shape): Float =", "    match s"))).toEqual([]);
  });
});
