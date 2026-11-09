import { describe, expect, test } from "vitest";
import * as Source from "../support/source.js";
import { snippetOf } from "./snippet.js";

/**
 * A repair's stand-ins as an editor's snippet (language-server decision 5,
 * point 3): each a tabstop, selected in turn, in a snippet that begins a line.
 */

function file(text: string): Source.File {
  return new Source.File(Source.fileId(0), "/main.hex", text);
}

/** An insertion at `offset` of `replacement`, whose stand-ins are each `standIns` where it first appears. */
function insertion(text: string, offset: number, replacement: string, ...standIns: readonly string[]) {
  const position = file(text).positionAt(offset);
  let from = 0;
  const placeholders = standIns.map((standIn) => {
    const start = replacement.indexOf(standIn, from);
    from = start + standIn.length;
    return { start, end: from };
  });
  return { span: { fileId: Source.fileId(0), start: position, end: position }, replacement, placeholders };
}

/** The snippet's span as `line:column`, and its text. */
function snippet(text: string, edit: ReturnType<typeof insertion>) {
  const written = snippetOf(file(text), edit);
  return written === undefined
    ? undefined
    : { at: `${written.span.start.line}:${written.span.start.column}`, text: written.text };
}

describe("a repair's stand-ins as a snippet", () => {
  test("lines written below a line begin the next one, their stand-ins selected in turn", () => {
    const text = "    a => 1\nnext\n";
    const edit = insertion(text, 10, "\n    b => todo(\"b\")\n    c => todo(\"c\")", "todo(\"b\")", "todo(\"c\")");
    expect(snippet(text, edit)).toEqual({
      at: "1:0",
      text: "    b => ${1:todo(\"b\")}\n    c => ${2:todo(\"c\")}\n",
    });
  });

  test("with the file's line break, which the lines carry", () => {
    const text = "    a => 1\r\nnext\r\n";
    const edit = insertion(text, 10, "\r\n    b => todo(\"b\")", "todo(\"b\")");
    expect(snippet(text, edit)).toEqual({ at: "1:0", text: "    b => ${1:todo(\"b\")}\r\n" });
    // A line break other than the one there writes other text.
    expect(snippet(text, insertion(text, 10, "\n    b => todo(\"b\")", "todo(\"b\")"))).toBeUndefined();
  });

  test("an edit at a line's start stays where it is", () => {
    const text = "    a => 1\nnext\n";
    expect(snippet(text, insertion(text, 11, "    b => todo(\"b\")\n", "todo(\"b\")")))
      .toEqual({ at: "1:0", text: "    b => ${1:todo(\"b\")}\n" });
  });

  test("none inside a line, where an editor would indent the lines it writes again", () => {
    // Before what closes on the line, and at the end of a file with no final
    // line break: there is no line break to move past.
    const closing = "    xs.map(a => 1)\n";
    expect(snippet(closing, insertion(closing, 17, "\n    b => todo(\"b\")", "todo(\"b\")"))).toBeUndefined();
    const last = "    a => 1";
    expect(snippet(last, insertion(last, 10, "\n    b => todo(\"b\")", "todo(\"b\")"))).toBeUndefined();
    // Nor where the edit does not begin with a line break.
    const text = "    a => 1\n";
    expect(snippet(text, insertion(text, 10, " todo(\"b\")", "todo(\"b\")"))).toBeUndefined();
  });

  test("a replacement keeps the span it replaces, and has none inside a line", () => {
    const text = "    a => 1\nnext\n";
    const at = (offset: number) => file(text).positionAt(offset);
    const replacing = (start: number, end: number, replacement: string) => ({
      span: { fileId: Source.fileId(0), start: at(start), end: at(end) },
      replacement,
      placeholders: [{ start: replacement.indexOf("todo"), end: replacement.length }],
    });
    const written = snippetOf(file(text), replacing(11, 15, "b => todo(\"b\")"));
    expect(written && [written.span.start.offset, written.span.end.offset, written.text])
      .toEqual([11, 15, "b => ${1:todo(\"b\")}"]);
    // Moving past the line break would move what it replaces.
    expect(snippetOf(file(text), replacing(10, 15, "\nb => todo(\"b\")"))).toBeUndefined();
  });

  test("none for an edit without stand-ins", () => {
    const text = "    a => 1\n";
    expect(snippet(text, insertion(text, 11, "    b => 2\n"))).toBeUndefined();
  });

  test("text that would read as a snippet's own syntax is escaped", () => {
    const text = "x\n";
    const edit = insertion(text, 2, "a$b}c\\d = todo(\"$}\\\") $}\\", "todo(\"$}\\\")");
    expect(snippet(text, edit)?.text).toBe("a\\$b\\}c\\\\d = ${1:todo(\"\\$\\}\\\\\")} \\$\\}\\\\");
  });
});
