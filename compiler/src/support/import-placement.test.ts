import { describe, expect, test } from "vitest";

import { insertedLine, newlineOf, pastLineEnd } from "./import-placement.js";

/**
 * The line arithmetic three seats share — the resolver's import repair, the
 * workspace tier's, and Modules §2.2's header move. Each of those is tested
 * where it stands, against real programs; what is here is the one case none of
 * them can construct from a program alone and all three depend on.
 *
 * A file's last line need not be ended by anything. `pastLineEnd` answers
 * `text.length` there — an offset past the *line* that is not past a *break* —
 * and a tier that wrote its own line at such an offset, or lifted such a line
 * and put it back elsewhere, would weld two lines into one. The import tiers
 * cannot reach it (their offset is below a header, and a header the file's last
 * line has nothing under it to repair) but they are one call away from it, and
 * the header move reaches it from the buffer an author is typing a header in.
 */
describe("insertedLine", () => {
  test("ends the line the way the file ends its own", () => {
    expect(insertedLine("module M\n\nlet a: Int = 1\n", 10, "import Lib")).toBe("import Lib\n");
    expect(insertedLine("module M\r\n\r\nlet a: Int = 1\r\n", 12, "import Lib"))
      .toBe("import Lib\r\n");
  });

  test("keeps a terminator the line already carries", () => {
    // What the header move lifts is a whole line and the blank run under it,
    // ended already and byte for byte the file's own. Nothing is appended to it.
    expect(insertedLine("module M\n\nlet a: Int = 1\n", 0, "module M\n\n")).toBe("module M\n\n");
    expect(insertedLine("module M\r\n\r\nlet a: Int = 1\r\n", 0, "module M\r\n\r\n"))
      .toBe("module M\r\n\r\n");
  });

  test("opens with a break at the end of a file whose last line has none", () => {
    // The half no program reaches through the import tiers: without it the
    // written line joins the line already standing there.
    const text = "module M\n\nlet a: Int = 1";
    expect(pastLineEnd(text, text.length)).toBe(text.length);
    expect(insertedLine(text, text.length, "let b: Int = 2")).toBe("\nlet b: Int = 2\n");
    expect(text.slice(0, text.length) + insertedLine(text, text.length, "let b: Int = 2"))
      .toBe("module M\n\nlet a: Int = 1\nlet b: Int = 2\n");
  });

  test("opens with none where the file ends its last line, or has no text at all", () => {
    const ended = "module M\n";
    expect(insertedLine(ended, ended.length, "let a: Int = 1")).toBe("let a: Int = 1\n");
    // Offset zero is never the end of a line already standing — the whole file
    // is below it — and an empty file has no line to weld to.
    expect(insertedLine("module M", 0, "module N")).toBe("module N\n");
    expect(insertedLine("", 0, "module M")).toBe("module M\n");
    expect(newlineOf("")).toBe("\n");
  });
});
