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
  readonly severity: "error" | "warning" | "information";
  readonly message: string;
  readonly primary: Source.Span;
  readonly labels?: readonly Label[];
  readonly notes?: readonly string[];
  readonly fixes?: readonly Fix[];
  /**
   * Set on the errors that say a declaration's signature is incomplete: the
   * missing annotations themselves (Modules §4.1.1) and the constraints that
   * cannot be declared until they are written.
   *
   * Marked rather than recognised. A repair that writes part of a signature has
   * to tell these apart from every other error reported against the same
   * declaration name, because these are the *absence* of what it is writing and
   * the others are reasons not to write it — and both kinds report at the
   * binding, so no test on spans can separate them. The alternative is matching
   * on message text, which makes a sentence a user reads into an interface a
   * pass depends on.
   *
   * Deliberately narrow: not a general diagnostic code, which is a bigger
   * question than one repair needs answered.
   */
  readonly incompleteSignature?: true;
  /**
   * The region this report speaks for: every other diagnostic whose primary
   * span falls inside it is a consequence of this one and is dropped.
   *
   * For the report that says the source was *parsed* differently than it was
   * meant (#355 ruling 8's return-annotation slot, #364). There the later
   * passes are not wrong — they are faithfully describing a tree the writer did
   * not write, and their reports arrive before the one sentence that names the
   * fix. Suppression is the honest cut: the misparse is the defect, and it is
   * reported once.
   *
   * Never set by a pass reporting an ordinary defect. A diagnostic carrying
   * this field is itself immune, so two of them cannot silence each other.
   */
  readonly supersedes?: Source.Span;
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
   * How many diagnostics have been added, in production order and without the
   * sorting `toArray` does. A pass that performs a unification early — one a
   * later, coarser check will perform again — reads this before and after to
   * learn whether its own attempt reported, so the later check can be given an
   * `Error` to absorb instead of reporting the same mismatch twice.
   */
  get count(): number {
    return this.#diagnostics.length;
  }

  /**
   * Returns diagnostics in source order while preserving production order for
   * diagnostics at the same location. This makes host output deterministic
   * without requiring passes to coordinate how they discover failures.
   */
  toArray(): readonly Diagnostic[] {
    const ordered = this.#diagnostics
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
    const regions = ordered.flatMap((diagnostic) =>
      diagnostic.supersedes === undefined ? [] : [diagnostic.supersedes]
    );
    if (regions.length === 0) return ordered;
    return ordered.filter((diagnostic) =>
      diagnostic.supersedes !== undefined ||
      !regions.some((region) => contains(region, diagnostic.primary))
    );
  }
}

/** Whether `span` lies wholly inside `region`, in the same file. */
function contains(region: Source.Span, span: Source.Span): boolean {
  return (
    region.fileId === span.fileId &&
    span.start.offset >= region.start.offset &&
    span.end.offset <= region.end.offset
  );
}

function compareSpans(left: Source.Span, right: Source.Span): number {
  return (
    left.fileId - right.fileId ||
    left.start.offset - right.start.offset ||
    left.end.offset - right.end.offset
  );
}
