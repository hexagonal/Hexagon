import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { File, fileId } from "./source.js";

describe("Source.File", () => {
  test("tracks LF, CRLF, and CR as one line boundary each", () => {
    const source = new File(fileId(0), "lines.hex", "a\nb\r\nc\rd");

    expect(source.lineCount).toBe(4);
    expect(source.positionAt(2)).toEqual({ offset: 2, line: 1, column: 0 });
    expect(source.positionAt(5)).toEqual({ offset: 5, line: 2, column: 0 });
    expect(source.positionAt(7)).toEqual({ offset: 7, line: 3, column: 0 });
  });

  test("counts astral characters as two UTF-16 columns", () => {
    const source = new File(fileId(0), "unicode.hex", "a𝕏b");

    expect(source.positionAt(3)).toEqual({ offset: 3, line: 0, column: 3 });
  });

  test("creates half-open spans", () => {
    const source = new File(fileId(7), "binding.hex", "let answer = 42");

    expect(source.span(4, 10)).toEqual({
      fileId: fileId(7),
      start: { offset: 4, line: 0, column: 4 },
      end: { offset: 10, line: 0, column: 10 },
    });
  });

  test("rejects invalid offsets and reversed spans", () => {
    const source = new File(fileId(0), "empty.hex", "");

    expect(() => source.positionAt(-1)).toThrow(RangeError);
    expect(() => source.positionAt(1)).toThrow(RangeError);
    expect(() => source.span(0, -1)).toThrow(RangeError);
  });

  test("always produces coordinates inside the source", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const source = new File(fileId(0), "generated.hex", text);

        for (let offset = 0; offset <= text.length; offset += 1) {
          const position = source.positionAt(offset);
          expect(position.offset).toBe(offset);
          expect(position.line).toBeGreaterThanOrEqual(0);
          expect(position.line).toBeLessThan(source.lineCount);
          expect(position.column).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
