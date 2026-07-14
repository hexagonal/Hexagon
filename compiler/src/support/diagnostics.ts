/**
 * Diagnostics preserve source attribution independently of presentation.
 * Passes produce this platform-neutral structure; terminal, editor, and
 * browser hosts decide how to render it.
 */

import type * as Source from "./source.js";

export interface Label {
  readonly span: Source.Span;
  readonly message: string;
}

export interface Edit {
  readonly span: Source.Span;
  readonly replacement: string;
}

export interface Fix {
  readonly message: string;
  readonly edits: readonly Edit[];
}

export interface Diagnostic {
  readonly severity: "error";
  readonly message: string;
  readonly primary: Source.Span;
  readonly labels?: readonly Label[];
  readonly notes?: readonly string[];
  readonly fixes?: readonly Fix[];
}

export class Bag {
  readonly #diagnostics: Diagnostic[] = [];

  add(diagnostic: Diagnostic): void {
    this.#diagnostics.push(diagnostic);
  }

  get isEmpty(): boolean {
    return this.#diagnostics.length === 0;
  }

  /**
   * Returns diagnostics in source order while preserving production order for
   * diagnostics at the same location. This makes host output deterministic
   * without requiring passes to coordinate how they discover failures.
   */
  toArray(): readonly Diagnostic[] {
    return this.#diagnostics
      .map((diagnostic, insertionOrder) => ({ diagnostic, insertionOrder }))
      .sort((left, right) => {
        const sourceOrder = compareSpans(
          left.diagnostic.primary,
          right.diagnostic.primary,
        );

        return sourceOrder === 0
          ? left.insertionOrder - right.insertionOrder
          : sourceOrder;
      })
      .map(({ diagnostic }) => diagnostic);
  }
}

function compareSpans(left: Source.Span, right: Source.Span): number {
  return (
    left.fileId - right.fileId ||
    left.start.offset - right.start.offset ||
    left.end.offset - right.end.offset
  );
}
