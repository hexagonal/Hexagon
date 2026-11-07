import { describe, expect, test } from "vitest";

import { hoverSelection } from "./hover-selection.js";

/** A selection over `[start, end]` of one line, as VS Code's `contains` reads it. */
function selection(start: number, end: number) {
  return {
    start,
    end,
    isEmpty: start === end,
    contains: (position: number) => start <= position && position <= end,
  };
}

const READS = { experimental: { hoverRange: true } };
const DOCUMENT = { uri: "file:///main.hex" };

/** The active editor, showing `DOCUMENT` unless told otherwise. */
function editor<Selection>(selections: readonly Selection[], document: object = DOCUMENT) {
  return { document, selections };
}

describe("what a hover sends", () => {
  test("a pointer inside a selection sends the selection", () => {
    const selected = selection(4, 9);
    expect(hoverSelection(editor([selected]), DOCUMENT, 6, READS)).toBe(selected);
  });

  test("a pointer outside every selection sends its position", () => {
    expect(hoverSelection(editor([selection(4, 9)]), DOCUMENT, 12, READS)).toBeUndefined();
  });

  test("an empty selection is a caret, and the position goes", () => {
    expect(hoverSelection(editor([selection(6, 6)]), DOCUMENT, 6, READS)).toBeUndefined();
  });

  test("with several selections, the one holding the pointer", () => {
    const second = selection(20, 25);
    expect(hoverSelection(editor([selection(4, 9), second]), DOCUMENT, 22, READS)).toBe(second);
  });

  test("where two selections hold the pointer, the first", () => {
    const first = selection(4, 9);
    expect(hoverSelection(editor([first, selection(9, 12)]), DOCUMENT, 9, READS)).toBe(first);
  });

  test("a server that does not read a selection is sent the position", () => {
    const selected = selection(4, 9);
    expect(hoverSelection(editor([selected]), DOCUMENT, 6, undefined)).toBeUndefined();
    expect(hoverSelection(editor([selected]), DOCUMENT, 6, {})).toBeUndefined();
    expect(hoverSelection(editor([selected]), DOCUMENT, 6, { experimental: { hoverRange: "yes" } })).toBeUndefined();
    expect(hoverSelection(editor([selected]), DOCUMENT, 6, { experimental: null })).toBeUndefined();
  });

  test("only the active editor's selection, and only where it shows the document hovered", () => {
    const selected = selection(4, 9);
    // The active editor shows another document: the hover is in a pane that is
    // not the one being worked in, and its position goes.
    expect(hoverSelection(editor([selected], { uri: "file:///other.hex" }), DOCUMENT, 6, READS)).toBeUndefined();
    // No editor is active (the pointer is over an editor while focus is in a
    // panel).
    expect(hoverSelection(undefined, DOCUMENT, 6, READS)).toBeUndefined();
  });
});
