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
 *   its `subjects` alongside its `target`: the two agree only where a
 *   declaration's first token *is* the name it introduces — a record field, a
 *   constraint member, an `honor` member, and a union's first constructor when
 *   no `|` precedes it — and disagree for every form with a keyword, a `|`, or
 *   an `export` in front (§4.2's module-level inventory, every `extern from`
 *   item, and the idiomatic bar-prefixed constructor).
 * - **A position.** Some documentable positions have no identity at all in the
 *   occurrence index — an `honor` member's name is a bare string in the resolved
 *   tree, a record field is not a symbol, a `type` alias is expanded away, and a
 *   destructuring `let`'s binders are patterns before they are anything else —
 *   so nothing there can be reached by name. `covering` answers for those, and
 *   it is the reason hover can honour §8's "every documentable position"
 *   without the occurrence index growing entries it has no identity to give.
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
        // A subject wins its own offset; the declaration key is written only if
        // that offset is still free, so a form whose first token *is* its name
        // writes one entry rather than two. Nothing else can collide: a target
        // offset is where a code token starts and a subject offset is where a
        // name token starts, so two of them meeting means one token, which
        // means one declaration and one block.
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
    const names = this.#namesByFile.get(Number(fileId)) ?? [];
    // Inclusive at the end, like every other position query the session
    // answers: a caret just past a name is still on it.
    const found = names.find(({ span }) =>
      offset >= span.start.offset && offset <= span.end.offset
    );
    return found === undefined || found.content === "" ? undefined : found;
  }
}

function key(file: number, offset: number): string {
  return `${file}:${offset}`;
}
