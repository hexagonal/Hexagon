import { describe, expect, test } from "vitest";
import { AnalysisSession, type CodeAction } from "../analysis/session.js";
import { applyLayout } from "../passes/layout/layout.js";
import { lex } from "../passes/lexer/lexer.js";
import { parseFile } from "../passes/parser/parser.js";
import * as Source from "../support/source.js";
import { keepsReading } from "./same-reading.js";

/**
 * A program and where in it: `‸` is a caret, `«…»` a selection. Both marks are
 * removed before compiling.
 */
function marked(source: string): { readonly text: string; readonly start: number; readonly end: number } {
  const caret = source.indexOf("‸");
  if (caret >= 0) return { text: source.slice(0, caret) + source.slice(caret + 1), start: caret, end: caret };
  const open = source.indexOf("«");
  const close = source.indexOf("»");
  if (open < 0 || close < open) throw new Error("no caret or selection in the source");
  return {
    text: source.slice(0, open) + source.slice(open + 1, close) + source.slice(close + 1),
    start: open,
    end: close - 1,
  };
}

const PRELUDE = [
  "module Main",
  "record Point = { x: Int, y: Int }",
  "let x = 1",
  "let y = 2",
  "let r = { x = 3, y = 4 }",
  "",
].join("\n");

const PUNS = "Write the fields as puns";
const OUTS = "Write the puns out";
const pun = (name: string): string => `Write the field \`${name}\` as a pun`;
const out = (name: string): string => `Write the pun \`${name}\` out`;

/** The refactorings offered at the mark, by title. */
function offered(body: string): ReadonlyMap<string, CodeAction> {
  const { text, start, end } = marked(PRELUDE + body);
  const session = new AnalysisSession();
  session.setFile("/main.hex", text);
  return new Map(
    session.codeActions("/main.hex", { start, end }, { invoked: true })
      .filter(({ kind }) => kind === "refactor")
      .map((action) => [action.title, action]),
  );
}

/**
 * The body after the refactoring named `title` is applied at the mark, or why it
 * is refused. A program written reports nothing, as the one it came from.
 */
function rewritten(body: string, title: string): string {
  const action = offered(body).get(title);
  if (action === undefined) return "not offered";
  if (action.disabled !== undefined) return `refused: ${action.disabled}`;
  const { text } = marked(PRELUDE + body);
  const [edit] = action.edits;
  const after = text.slice(0, edit!.span.start.offset) + edit!.replacement + text.slice(edit!.span.end.offset);
  expect(reports(text)).toEqual([]);
  expect(reports(after)).toEqual([]);
  return after.slice(PRELUDE.length);
}

function reports(text: string): readonly string[] {
  const session = new AnalysisSession();
  session.setFile("/main.hex", text);
  return session.diagnostics("/main.hex").map(({ message }) => message);
}

/** The titles offered at the mark. */
const titles = (body: string): readonly string[] => [...offered(body).keys()];

/** Lines joined, so a program reads as it is laid out. */
const lines = (...written: readonly string[]): string => written.join("\n");

describe("a field written as a pun", () => {
  test("from its name, its `=` or its value", () => {
    expect(rewritten("let p = { x‸ = x, y = 1 }", pun("x"))).toBe("let p = { x, y = 1 }");
    expect(rewritten("let p = { x =‸ x, y = 1 }", pun("x"))).toBe("let p = { x, y = 1 }");
    expect(rewritten("let p = { x = x‸, y = 1 }", pun("x"))).toBe("let p = { x, y = 1 }");
  });

  test("in a literal, an update and a nominal record's construction", () => {
    expect(rewritten("let p = { r with x = x‸ }", pun("x"))).toBe("let p = { r with x }");
    expect(rewritten("let p = Point({ x = 1, y = y‸ })", pun("y"))).toBe("let p = Point({ x = 1, y })");
  });

  test("in a pattern: an arm's, a `let`'s, a lambda's head, a constructor's argument, a loop's", () => {
    expect(rewritten(lines("let f = (q: { x: Int, y: Int }) => match q", "    { x = x‸, y } => x + y"), pun("x")))
      .toBe(lines("let f = (q: { x: Int, y: Int }) => match q", "    { x, y } => x + y"));
    expect(rewritten(lines("let f(s: { z: Int }) =", "    let { z = z‸ } = s", "    z"), pun("z")))
      .toBe(lines("let f(s: { z: Int }) =", "    let { z } = s", "    z"));
    expect(rewritten("let f = ({ x = x‸ }) => x", pun("x"))).toBe("let f = ({ x }) => x");
    expect(rewritten("let f = (p: Point) => match p\n    Point({ y = y‸ }) => y", pun("y")))
      .toBe("let f = (p: Point) => match p\n    Point({ y }) => y");
    expect(rewritten(lines("let f() =", "    for { x = x‸ } in [r]", "        ()"), pun("x")))
      .toBe(lines("let f() =", "    for { x } in [r]", "        ()"));
  });

  test("a field named `with`, which is no update", () => {
    expect(rewritten("let with = 5\nlet p = { with = with‸ }", pun("with"))).toBe("let with = 5\nlet p = { with }");
  });

  test("every field from the record's brace, `with`, or the record it updates, keeping what lies between", () => {
    expect(rewritten("let p = ‸{ x = x, y = y }", PUNS)).toBe("let p = { x, y }");
    expect(rewritten("let p = { x = x, y = y }‸", PUNS)).toBe("let p = { x, y }");
    expect(rewritten("let p = { r w‸ith x = x, y = y }", PUNS)).toBe("let p = { r with x, y }");
    expect(rewritten("let p = { ‸r with x = x, y = y }", PUNS)).toBe("let p = { r with x, y }");
    expect(rewritten("let p = ‸{ x = x, (* keep *) y = y }", PUNS)).toBe("let p = { x, (* keep *) y }");
    expect(rewritten(lines("let p = ‸{", "    x = x, // first", "    y = y", "}"), PUNS))
      .toBe(lines("let p = {", "    x, // first", "    y", "}"));
  });

  test("from a caret at a field's first character, that field", () => {
    expect(rewritten("let p = { x = x, ‸y = y }", pun("y"))).toBe("let p = { x = x, y }");
  });

  test("the fields a selection touches, and only those", () => {
    expect(rewritten("let p = { «x = x, y» = y, z = 3 }", PUNS)).toBe("let p = { x, y, z = 3 }");
    expect(rewritten("let p = { x = x, «y = y», z = x }", pun("y"))).toBe("let p = { x = x, y, z = x }");
    // A selection ending where the next field starts, or starting where the
    // last one ends, does not touch it.
    expect(rewritten("let p = { «x = x, »y = y }", pun("x"))).toBe("let p = { x, y = y }");
    expect(rewritten("let p = { x = x«, »y = y }", PUNS)).toBe("let p = { x, y }");
    expect(rewritten("let p = { x = x«, y» = y }", pun("y"))).toBe("let p = { x = x, y }");
  });

  test("not from a selection reaching past the record", () => {
    expect(titles("let p =« { x = x, y = y }»")).toEqual([]);
  });

  test("beside a record with no fields, or a copy", () => {
    expect(rewritten("let e = {}\nlet p = { x = x‸ }", pun("x"))).toBe("let e = {}\nlet p = { x }");
    expect(rewritten("let e = {...r}\nlet p = { x = x‸ }", pun("x"))).toBe("let e = {...r}\nlet p = { x }");
    expect(titles("let e = {‸}")).toEqual([]);
  });

  test("in the innermost record the mark is in", () => {
    expect(rewritten("let p = { outer = { x = x‸ }, y = y }", pun("x"))).toBe("let p = { outer = { x }, y = y }");
    expect(titles("let p = { outer‸ = { x = x }, y = y }")).toEqual([]);
    expect(rewritten("let p = { outer = { x = x }, y = y ‸}", pun("y"))).toBe("let p = { outer = { x = x }, y }");
  });

  test("refused where a comment would be lost", () => {
    expect(rewritten("let p = { x = (* the x *) x‸ }", pun("x")))
      .toBe("refused: A comment inside it would be lost. Move the comment out first.");
  });

  test("not where the value is not the field's own name, bare", () => {
    expect(titles("let p = { x = y‸ }")).toEqual([]);
    expect(titles("let p = { x = r.x‸ }")).toEqual([]);
    expect(titles("let p = { x = (x)‸ }")).toEqual([]);
    // A pattern's parentheses only group, and the parser keeps no group there:
    // `{x = (x)}` binds `x` as `{x}` does.
    expect(rewritten(lines("let f = (q: { x: Int }) => match q", "    { x = (x)‸ } => x"), pun("x")))
      .toBe(lines("let f = (q: { x: Int }) => match q", "    { x } => x"));
    expect(titles("let p = { x = x + 1‸ }")).toEqual([]);
    expect(titles(lines("let f = (q: { x: Int }) => match q", "    { x = _‸ } => 0"))).toEqual([]);
    expect(titles(lines("let f = (q: { x: Int }) => match q", "    { x = y‸ } => y"))).toEqual([]);
    expect(titles(lines("let f = (q: { x: Int }) => match q", "    { x = x as y‸ } => x + y"))).toEqual([]);
    expect(titles(lines("let f = (q: { x: Int }) => match q", "    { x = _ as x‸ } => x"))).toEqual([]);
    const same = ["pattern same(s: Int): Int", "    view(s) = s", "    build(s) = s"];
    expect(titles(lines(...same, "let p = { same = (1)same‸ }"))).toEqual([]);
    expect(titles(lines("let f = (q: { x: Int }) => match q", "    { x = 1‸ } => 0", "    _ => 1"))).toEqual([]);
  });

  test("not in a record type or declaration, nor for a field named by a keyword", () => {
    expect(titles("let f = (q: { x‸: Int }) => q.x")).toEqual([]);
    expect(titles("record Size = { width‸: Int }")).toEqual([]);
    expect(titles("let p = { type = 1‸ }")).toEqual([]);
  });
});

describe("a pun written out", () => {
  test("in a literal, an update and a pattern", () => {
    expect(rewritten("let p = { x‸, y = 1 }", out("x"))).toBe("let p = { x = x, y = 1 }");
    expect(rewritten("let p = { r with x‸ }", out("x"))).toBe("let p = { r with x = x }");
    expect(rewritten("let f = ({ x‸ }) => x", out("x"))).toBe("let f = ({ x = x }) => x");
    expect(rewritten(lines("let f = (q: { x: Int, y: Int }) => match q", "    { x, y‸ } => x + y"), out("y")))
      .toBe(lines("let f = (q: { x: Int, y: Int }) => match q", "    { x, y = y } => x + y"));
  });

  test("every pun from the record's brace, and the written fields left as they are", () => {
    expect(rewritten("let p = ‸{ x, y, z = 3 }", OUTS)).toBe("let p = { x = x, y = y, z = 3 }");
    expect(rewritten("let p = ‸{ x, y = y }", out("x"))).toBe("let p = { x = x, y = y }");
    expect(rewritten("let p = ‸{ x, y = y }", pun("y"))).toBe("let p = { x, y }");
  });

  test("a field named `with`", () => {
    expect(rewritten("let with = 5\nlet p = { with‸ }", out("with"))).toBe("let with = 5\nlet p = { with = with }");
  });
});

describe("the two rewrites", () => {
  test("undo one another", () => {
    const written = "let p = { r with x = x, y = y }";
    const punned = rewritten(written.replace("{", "‸{"), PUNS);
    expect(punned).toBe("let p = { r with x, y }");
    expect(rewritten(punned.replace("{", "‸{"), OUTS)).toBe(written);
  });

  test("are offered only when the dev asks, as refactorings, never preferred", () => {
    const { text, start, end } = marked(PRELUDE + "let p = { x = x‸ }");
    const session = new AnalysisSession();
    session.setFile("/main.hex", text);
    expect(session.codeActions("/main.hex", { start, end }).map(({ title }) => title)).toEqual([]);
    expect(session.codeActions("/main.hex", { start, end }, { invoked: true })
      .map(({ title, kind, preferred }) => ({ title, kind, preferred })))
      .toEqual([{ title: pun("x"), kind: "refactor", preferred: undefined }]);
  });
});

describe("the parse that checks a rewrite", () => {
  const check = (before: string, after: string): boolean => {
    const text = PRELUDE + before;
    const file = new Source.File(1 as Source.FileId, "/main.hex", text);
    const [module] = parseFile(applyLayout(lex(file)), file.path);
    return keepsReading(file, module!, { start: PRELUDE.length, end: text.length, replacement: after });
  };

  test("reads a pun as its field written out", () => {
    expect(check("let p = { x = x, y }", "let p = { x, y = y }")).toBe(true);
    expect(check("let p = { r with x = x }", "let p = { r with x }")).toBe(true);
  });

  test("and not a field whose value is another name", () => {
    expect(check("let p = { x = y }", "let p = { x }")).toBe(false);
    expect(check("let p = { x = y }", "let p = { y }")).toBe(false);
  });
});
