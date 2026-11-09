/**
 * What the refactorings between forms the spec defines as one another share:
 * an edit written as one or more texts, the first that parses as the same
 * program taken (`same-reading.ts`), and a refusal, with its reason, where none
 * does or where a comment would be lost.
 */

import * as Source from "../support/source.js";
import type * as Parsed from "../syntax/parsed/index.js";
import { keepsReading, type TextEdit } from "./same-reading.js";

/** A refactoring offered at a place: its edit, or why it is refused there. */
export type Refactoring =
  | { readonly title: string; readonly edit: TextEdit; readonly disabled?: undefined }
  | { readonly title: string; readonly edit?: undefined; readonly disabled: string };

export interface Written {
  /** The text that replaces the expression, in the forms to try, the plainest first. */
  readonly texts: readonly string[];
  /** The spans of the expression whose text the rewrite keeps. */
  readonly kept: readonly Source.Span[];
}

/**
 * The refactoring `title` replacing `expression` with the first of `written`'s
 * texts that parses as the same program, or refused with the reason. Exported
 * for its tests, which hand it texts no rewrite here writes.
 */
export function rewrite(
  file: Source.File,
  module: Parsed.Module,
  title: string,
  expression: Parsed.Expr,
  written: Written,
): Refactoring {
  const { start, end } = solid(file, expression.span);
  const lost = module.comments.some(({ span }) =>
    start <= span.start.offset && span.end.offset <= end &&
    !written.kept.some((kept) => kept.start.offset <= span.start.offset && span.end.offset <= kept.end.offset)
  );
  if (lost) return { title, disabled: "A comment inside it would be lost. Move the comment out first." };
  for (const replacement of written.texts) {
    const edit = { start, end, replacement };
    if (keepsReading(file, module, edit)) return { title, edit };
  }
  // A `//` comment on a kept text's last line runs to the end of that line,
  // over whatever the rewrite writes after the text.
  const swallowing = module.comments.some(({ kind, span }) =>
    kind === "Line" && written.kept.some((kept) =>
      kept.start.offset <= span.start.offset && span.end.offset <= kept.end.offset &&
      !file.text.slice(span.end.offset, solid(file, kept).end).includes("\n")
    )
  );
  if (swallowing) {
    return { title, disabled: "A `//` comment inside it would swallow what the rewrite writes after it. Move the comment out first." };
  }
  return { title, disabled: "Written the other way here, it would parse as a different program." };
}

/**
 * A span's text, without the line breaks and spaces a form that ends at a
 * layout boundary, such as a `match`'s last arm, can carry at its end.
 */
export function textOf(file: Source.File, span: Source.Span): string {
  const { start, end } = solid(file, span);
  return file.text.slice(start, end);
}

export function solid(file: Source.File, span: Source.Span): { readonly start: number; readonly end: number } {
  const start = span.start.offset;
  return { start, end: start + file.text.slice(start, span.end.offset).trimEnd().length };
}
