/**
 * Format document and Format selection in the playground (`spec/canonical-layout.md`).
 *
 * The compiler's `formatDocument` and `formatSelection` decide the layout; this
 * runs them in the compiler worker and carries the answer across as offsets.
 */

import { formatDocument, formatSelection, type FormatOptions } from "../../compiler/src/index";
import type { BufferRange, PlaygroundFormatOptions, PlaygroundFormatResult } from "./protocol";

export function formatSource(
  source: string,
  options: PlaygroundFormatOptions,
  range?: BufferRange,
): PlaygroundFormatResult {
  const compilerOptions: FormatOptions = {
    maximumLineLength: options.maximumLineLength ?? "unlimited",
    collapseExtraSpaces: options.collapseExtraSpaces,
    leaveTrailingCommasAsWritten: options.leaveTrailingCommasAsWritten,
    applyWidthLimits: options.applyWidthLimits,
  };
  const result = range === undefined
    ? formatDocument(source, compilerOptions)
    : formatSelection(source, { start: range.startOffset, end: range.endOffset }, compilerOptions);
  switch (result.kind) {
    case "Formatted":
      return {
        kind: "formatted",
        edits: result.edits.map(({ start, end, newText }) => ({ startOffset: start, endOffset: end, replacement: newText })),
      };
    case "SyntaxError":
      return { kind: "syntax-error" };
    case "Refused":
      return { kind: "refused", message: result.message };
  }
}
