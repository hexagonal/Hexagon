/**
 * Source files are the common coordinate system shared by every compiler
 * phase. Offsets and columns count UTF-16 code units so spans can move between
 * the compiler, JavaScript strings, and the Language Server Protocol without
 * lossy conversions. Lines and columns are zero-based internally.
 */

declare const fileIdBrand: unique symbol;

export type FileId = number & { readonly [fileIdBrand]: "FileId" };

export interface Position {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface Span {
  readonly fileId: FileId;
  readonly start: Position;
  readonly end: Position;
}

/** Assigns the stable identity supplied by a compiler host to a source file. */
export function fileId(value: number): FileId {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("a source file id must be a non-negative safe integer");
  }

  return value as FileId;
}

export class File {
  readonly #lineStarts: readonly number[];

  readonly id: FileId;
  readonly path: string;
  readonly text: string;

  constructor(id: FileId, path: string, text: string) {
    this.id = id;
    this.path = path;
    this.text = text;
    this.#lineStarts = findLineStarts(text);
  }

  get lineCount(): number {
    return this.#lineStarts.length;
  }

  /** Converts an absolute UTF-16 offset to its line-relative coordinates. */
  positionAt(offset: number): Position {
    assertOffset(this.text, offset);

    let low = 0;
    let high = this.#lineStarts.length;

    while (low + 1 < high) {
      const middle = low + Math.floor((high - low) / 2);
      const lineStart = this.#lineStarts[middle];

      if (lineStart === undefined || lineStart > offset) {
        high = middle;
      } else {
        low = middle;
      }
    }

    const lineStart = this.#lineStarts[low];
    if (lineStart === undefined) {
      throw new Error("internal error: every source file must have a first line");
    }

    return { offset, line: low, column: offset - lineStart };
  }

  /** Creates a half-open span and rejects coordinates outside this file. */
  span(startOffset: number, endOffset: number): Span {
    assertOffset(this.text, startOffset);
    assertOffset(this.text, endOffset);

    if (endOffset < startOffset) {
      throw new RangeError("a source span cannot end before it starts");
    }

    return {
      fileId: this.id,
      start: this.positionAt(startOffset),
      end: this.positionAt(endOffset),
    };
  }
}

// Recognize the three line endings accepted by JavaScript text producers.
// CRLF is one boundary so the following line starts after both code units.
function findLineStarts(text: string): readonly number[] {
  const starts = [0];

  for (let offset = 0; offset < text.length; offset += 1) {
    const codeUnit = text.charCodeAt(offset);

    if (codeUnit === 0x0d && text.charCodeAt(offset + 1) === 0x0a) {
      offset += 1;
      starts.push(offset + 1);
    } else if (codeUnit === 0x0a || codeUnit === 0x0d) {
      starts.push(offset + 1);
    }
  }

  return starts;
}

function assertOffset(text: string, offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) {
    throw new RangeError("a source offset must lie within its file");
  }
}
