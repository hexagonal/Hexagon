import { describe, expect, test } from "vitest";

import {
  insertIndentedLineBreak,
  isIPadOS,
  supportsMonacoEditor,
} from "./editor";

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

  test("detects only iPadOS for the caret-driven hover fallback", () => {
    expect(isIPadOS(
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
      "iPad",
      5,
    )).toBe(true);
    expect(isIPadOS(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      "MacIntel",
      5,
    )).toBe(true);
    expect(isIPadOS(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      "MacIntel",
      0,
    )).toBe(false);
    expect(isIPadOS("Mozilla/5.0 (Windows NT 10.0)", "Win32", 10)).toBe(false);
    expect(isIPadOS("Mozilla/5.0 (Linux; Android 15)", "Linux armv8l", 10)).toBe(false);
  });
});
