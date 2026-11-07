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

describe("what a hover sends", () => {
  test("a pointer inside a selection sends the selection", () => {
    const selected = selection(4, 9);
    expect(hoverSelection([selected], 6, READS)).toBe(selected);
  });

  test("a pointer outside every selection sends its position", () => {
    expect(hoverSelection([selection(4, 9)], 12, READS)).toBeUndefined();
  });

  test("an empty selection is a caret, and the position goes", () => {
    expect(hoverSelection([selection(6, 6)], 6, READS)).toBeUndefined();
  });

  test("with several selections, the one holding the pointer", () => {
    const second = selection(20, 25);
    expect(hoverSelection([selection(4, 9), second], 22, READS)).toBe(second);
  });

  test("where two selections hold the pointer, the first", () => {
    const first = selection(4, 9);
    expect(hoverSelection([first, selection(9, 12)], 9, READS)).toBe(first);
  });

  test("a server that does not read a selection is sent the position", () => {
    const selected = selection(4, 9);
    expect(hoverSelection([selected], 6, undefined)).toBeUndefined();
    expect(hoverSelection([selected], 6, {})).toBeUndefined();
    expect(hoverSelection([selected], 6, { experimental: { hoverRange: "yes" } })).toBeUndefined();
    expect(hoverSelection([selected], 6, { experimental: null })).toBeUndefined();
  });
});
