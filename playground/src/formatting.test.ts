import { describe, expect, test } from "vitest";
import { formatSource } from "./formatting";

const off = {
  maximumLineLength: undefined,
  collapseExtraSpaces: false,
  leaveTrailingCommasAsWritten: false,
  applyWidthLimits: false,
};

describe("formatting in the playground", () => {
  test("formats the document as whitespace edits", () => {
    const source = "module Main\nlet x=1+2\n";
    const result = formatSource(source, off);
    expect(result.kind).toBe("formatted");
    if (result.kind !== "formatted") return;
    let text = source;
    for (const edit of [...result.edits].reverse()) {
      text = text.slice(0, edit.startOffset) + edit.replacement + text.slice(edit.endOffset);
    }
    expect(text).toBe("module Main\nlet x = 1 + 2\n");
  });

  test("formats only the items a selection touches", () => {
    const source = "module Main\nlet x=1\nlet y=2\n";
    const at = source.indexOf("y=");
    const result = formatSource(source, off, { startOffset: at, endOffset: at });
    expect(result).toEqual({
      kind: "formatted",
      edits: [
        { startOffset: source.indexOf("y=") + 1, endOffset: source.indexOf("y=") + 1, replacement: " " },
        { startOffset: source.indexOf("=2") + 1, endOffset: source.indexOf("=2") + 1, replacement: " " },
      ],
    });
  });

  test("passes the options on, and refuses as the compiler does", () => {
    const long = "module Main\nlet total = alpha + beta + gamma\n";
    expect(formatSource(long, { ...off, maximumLineLength: 20, collapseExtraSpaces: true }).kind).toBe("formatted");
    const spread = "module Main\nlet total = add(\n    1,\n    2\n)\n";
    const after = spread.indexOf("2") + 1;
    expect(formatSource(spread, off)).toEqual({
      kind: "formatted",
      edits: [{ startOffset: after, endOffset: after + 1, replacement: ",\n" }],
    });
    expect(formatSource(spread, { ...off, leaveTrailingCommasAsWritten: true })).toEqual({ kind: "formatted", edits: [] });
    const short = "module Main\nlet size = if a then 1 else if b then 2 else 3\n";
    expect(formatSource(short, off)).toEqual({ kind: "formatted", edits: [] });
    expect(formatSource(short, { ...off, applyWidthLimits: true }).kind).toBe("formatted");
    expect(formatSource(short, { ...off, applyWidthLimits: true })).not.toEqual({ kind: "formatted", edits: [] });
    expect(formatSource("module Main\nlet x = (1\n", off)).toEqual({ kind: "syntax-error" });
    expect(formatSource("module Main\nlet f(x: Int): Int =\n{- a much longer note -} x\n", off)).toMatchObject({
      kind: "refused",
      message: expect.stringContaining("line 3"),
    });
  });
});
