import { describe, expect, test } from "vitest";

import { insertIndentedLineBreak, supportsMonacoEditor } from "./editor";

describe("insertIndentedLineBreak", () => {
  test("copies the current line's leading spaces", () => {
    expect(insertIndentedLineBreak("fun f =\n  if true", 17, 17)).toEqual({
      text: "fun f =\n  if true\n  ",
      caret: 20,
    });
  });

  test("does not copy spaces occurring after source text", () => {
    expect(insertIndentedLineBreak("  value  ", 9, 9)).toEqual({
      text: "  value  \n  ",
      caret: 12,
    });
  });

  test("preserves spaces on an otherwise blank line", () => {
    expect(insertIndentedLineBreak("let x = 1\n    ", 14, 14)).toEqual({
      text: "let x = 1\n    \n    ",
      caret: 19,
    });
  });

  test("replaces a selection and positions the caret after indentation", () => {
    expect(insertIndentedLineBreak("  first second", 7, 14)).toEqual({
      text: "  first\n  ",
      caret: 10,
    });
  });

  test("copies only the spaces before a caret within indentation", () => {
    expect(insertIndentedLineBreak("    value", 2, 2)).toEqual({
      text: "  \n    value",
      caret: 5,
    });
  });
});

describe("editor support", () => {
  test("uses Monaco only with a desktop-sized fine pointer", () => {
    expect(supportsMonacoEditor(true, 1280)).toBe(true);
    expect(supportsMonacoEditor(false, 1280)).toBe(false);
    expect(supportsMonacoEditor(true, 760)).toBe(false);
  });
});
