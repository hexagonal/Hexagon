/**
 * Compiler-owned source query: the documentation an editor can show, indexed
 * for the two questions an editor asks.
 *
 * `spec/doc-comments.md` §8 puts doc content in hover and completion for every
 * documentable position, including the block-local binders and `honor` members
 * that reach neither emitted artifact. The content itself is already attached —
 * the parser did that (§4) and the module carries it — so what is missing is a
 * way to reach it from what an editor holds, which is never a declaration:
 *
 * - **A name.** A symbol's `bindingSpan`, a union's span, the identifier under
 *   the cursor. That is what `at` answers, and it is why `Documentation` records
 *   its `subjects` alongside its `target`. The two are the same offset wherever
 *   a declaration's first token *is* a name — a record field, a constraint
 *   member, an `honor` member, and every union constructor, whose recorded
 *   target is its own name span and not the `|` that claimed the block — and
 *   different for every form with a keyword or an `export` in front (§4.2's
 *   module-level inventory, and every `extern from` item). Where they are the
 *   same the subject is recorded anyway, so that each attachment names its own
 *   subject rather than every reader inheriting that coincidence.
 * - **A position.** Three documentable positions have no identity at all in the
 *   occurrence index — an `honor` member's name is a bare string in the resolved
 *   tree, a record field is not a symbol, a `type` alias is expanded away — so
 *   nothing there can be reached by name. `covering` answers for those, and it
 *   is the reason hover can honour §8's "every documentable position" without
 *   the occurrence index growing entries it has no identity to give.
 *
 * A destructuring `let` is neither case and needs `subjects` for a third
 * reason: its binders *are* symbols (the resolver declares one per binder, and
 * `collectOccurrences` publishes every symbol it finds), so each is reachable
 * by name — but one block covers all of them, and only the attachment knows
 * which names those are.
 *
 * Project-wide, like `collectSymbolFacts` and for the same reason: a name
 * declared in one module is hovered and completed in another, and every key
 * carries the file it belongs to.
 */

import type * as Source from "../support/source.js";
import type { Documentation } from "../support/documentation.js";

/** A documented name, for a position the occurrence index does not describe. */
export interface DocumentedName {
  /** The name's own span, for the editor to highlight. */
  readonly span: Source.Span;
  readonly content: string;
}

/** The module views this query needs; every compiled tree carries them. */
export interface DocumentedModule {
  readonly fileId: Source.FileId;
  readonly docs: readonly Documentation[];
}

export class DocumentationIndex {
  static of(modules: readonly DocumentedModule[]): DocumentationIndex {
    return new DocumentationIndex(modules);
  }

  /** Content by `fileId:offset` of a declaration's name *and* of its first token. */
  readonly #byOffset = new Map<string, string>();
  /** Documented names by file, for the containment scan `covering` does. */
  readonly #namesByFile = new Map<number, DocumentedName[]>();

  private constructor(modules: readonly DocumentedModule[]) {
    for (const module of modules) {
      const file = Number(module.fileId);
      for (const doc of module.docs) {
        // Subjects go in first and the declaration key only if its offset is
        // still free. The guard is defensive rather than load-bearing: today
        // the only two keys that can meet are one block's own subject and its
        // own target, where the entry is identical either way — a second block
        // cannot reach the same offset, because `DocBlocks` lets one block
        // claim a code token and no declaration begins where a name is
        // referenced. It costs one lookup to make a future form that broke
        // that lose its own declaration key rather than another block's name.
        for (const subject of doc.subjects) {
          this.#byOffset.set(key(file, subject.start.offset), doc.content);
          const names = this.#namesByFile.get(file);
          const name = { span: subject, content: doc.content };
          if (names === undefined) this.#namesByFile.set(file, [name]);
          else names.push(name);
        }
        const declaration = key(file, doc.target);
        if (!this.#byOffset.has(declaration)) this.#byOffset.set(declaration, doc.content);
      }
    }
  }

  /**
   * The documentation of the declaration that starts at `span`, empty content
   * and absent alike reported as `undefined`.
   *
   * An empty doc block attaches and contributes empty documentation, which
   * tooling treats as absent (§3.2) — so a caller never has to ask twice.
   */
  at(span: Source.Span | undefined): string | undefined {
    if (span === undefined) return undefined;
    const content = this.#byOffset.get(key(Number(span.fileId), span.start.offset));
    return content === undefined || content === "" ? undefined : content;
  }

  /** The documented name covering an offset, if the offset is on one. */
  covering(fileId: Source.FileId, offset: number): DocumentedName | undefined {
    // Inclusive at the end, like every other position query the session
    // answers: a caret just past a name is still on it.
    return this.namesIn(fileId).find(({ span }) =>
      offset >= span.start.offset && offset <= span.end.offset
    );
  }

  /**
   * Every documented name in one file — exactly the set `covering` scans.
   *
   * Exists so a caller can ask *where* this index answers without asking offset
   * by offset, which is what the Playground's caret-driven hover needs. Written
   * as the source `covering` reads from rather than beside it, so the set and
   * the lookup cannot come to disagree about what counts as documented: an empty
   * doc block attaches and contributes empty documentation, which tooling treats
   * as absent (§3.2), and that exclusion now happens in one place.
   */
  namesIn(fileId: Source.FileId): readonly DocumentedName[] {
    return (this.#namesByFile.get(Number(fileId)) ?? []).filter(
      ({ content }) => content !== "",
    );
  }
}

function key(file: number, offset: number): string {
  return `${file}:${offset}`;
}
