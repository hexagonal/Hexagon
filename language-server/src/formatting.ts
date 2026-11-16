/**
 * Format document and Format selection across the protocol boundary
 * (`spec/canonical-layout.md`; the compiler's `formatDocument` and
 * `formatSelection` decide the layout, and this only translates).
 *
 * Two settings, `hexagon.format.maximumLineLength` and
 * `hexagon.format.collapseExtraSpaces`, both off until the dev sets them
 * (Canonical Layout §3): a line length of Unlimited, written as no number,
 * and extra spaces kept. The editor's own indentation settings play no part
 * (§5.1), so the request's `FormattingOptions` are not read.
 *
 * A document with a syntax error gets no edits and no message: the error is
 * already reported (§2.3). Any other refusal gets no edits and a message
 * saying why, naming the line where there is one.
 */

import type { Position, TextEdit } from "vscode-languageserver";
import type { FormatOptions, FormatResult } from "../../compiler/src/index.js";

export interface FormatSettings {
  /** A number of characters, or `undefined` for Unlimited (§3.1). */
  readonly maximumLineLength: number | undefined;
  /** Whether a gap wider than one space becomes one (§3.2). */
  readonly collapseExtraSpaces: boolean;
}

export const DEFAULT_FORMAT_SETTINGS: FormatSettings = { maximumLineLength: undefined, collapseExtraSpaces: false };

/**
 * The settings in a `workspace/configuration` answer for `hexagon.format`.
 * A line length that is not a whole number of at least one is Unlimited, and
 * anything else not there keeps its default: a client that knows nothing of
 * these settings formats with both off.
 */
export function formatSettingsOf(value: unknown): FormatSettings {
  const record = value as Record<string, unknown> | null | undefined;
  const length = record?.["maximumLineLength"];
  const collapse = record?.["collapseExtraSpaces"];
  return {
    maximumLineLength: typeof length === "number" && Number.isInteger(length) && length >= 1 ? length : undefined,
    collapseExtraSpaces: typeof collapse === "boolean" ? collapse : DEFAULT_FORMAT_SETTINGS.collapseExtraSpaces,
  };
}

/** The compiler's options for these settings. */
export function formatOptionsOf(settings: FormatSettings): FormatOptions {
  return {
    maximumLineLength: settings.maximumLineLength ?? "unlimited",
    collapseExtraSpaces: settings.collapseExtraSpaces,
  };
}

/** What a formatting request answers: its edits, and the message a refusal shows. */
export interface FormatAnswer {
  readonly edits: TextEdit[];
  readonly message?: string;
}

/** The compiler's result as the protocol's edits, each a run of whitespace. */
export function toLspFormatting(result: FormatResult, positionAt: (offset: number) => Position): FormatAnswer {
  switch (result.kind) {
    case "Formatted":
      return {
        edits: result.edits.map((edit) => ({
          range: { start: positionAt(edit.start), end: positionAt(edit.end) },
          newText: edit.newText,
        })),
      };
    case "SyntaxError":
      return { edits: [] };
    case "Refused":
      return { edits: [], message: result.message };
  }
}
