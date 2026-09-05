/**
 * Where an inserted `import` line goes in a file that already has text in it
 * (Modules §5.1's "*placed so the file stays well-formed and any term-position
 * use sits below it*", #577).
 *
 * One rule, two tiers. Since #829 a module import names a module and carries no
 * path, so the **compiler** tier writes the line wherever it has reached the
 * type's home module (§5.1's applied-edit obligation, §10's "the type's home
 * named, the applied edit carried"); the **workspace** tier writes it where the
 * spelling is one no reached module exports and only an inventory can answer.
 * Both place it the same way, and this is the one place that says how — a
 * second copy is how two tiers come to disagree about a file they both edit.
 */

import type * as Source from "./source.js";

/** What a module offers the placement: its header, and the import lines it wrote. */
export interface ImportPlacement {
  /**
   * The module header's own span, or `undefined` for a file that declares none
   * (Modules §2.1's refusal recovers a name; it writes no line).
   */
  readonly header: Source.Span | undefined;
  /**
   * The spans of the import lines the **source** wrote, in any order.
   * Synthesized imports are not lines — the resolver writes one for the prelude
   * names a module used (Modules §5.5, §6.4) — and have no text to sit under.
   */
  readonly imports: readonly Source.Span[];
}

/**
 * Two placements, and the second is the one that needs saying. **After the last
 * import line above the use** is the natural one — the new alias joins the ones
 * already there, and §3's top-down half is satisfied by construction, since the
 * imports considered are only those the use is already below. **Just below the
 * `module` header** is the fallback, and it is chosen rather than settled for:
 * it is above every declaration, so it can split nothing — in particular it can
 * never come between a doc comment and the declaration the comment documents,
 * which is the one placement that would change what the file means rather than
 * merely how it reads (`spec/doc-comments.md` §2.1: a doc comment attaches to
 * what *immediately* follows it).
 *
 * The header is what the fallback is measured from, and not offset zero, since
 * #829: a file's first line is now `module Name`, and an import written above
 * it is not a badly-placed import but an ill-formed file — §5.1 requires the
 * applied edit to leave the module well-formed, and "code outside a module" is
 * what offset zero would produce. A file with no header has no module for the
 * edit to sit inside; the parser's own refusal there carries the repair, and
 * this falls back to the top exactly as it always did.
 *
 * **"Any term-position use" is read locally — the use being repaired.** The
 * universal reading is available and is deliberately not taken. It differs only
 * where imports are *interleaved* between declarations and two refused uses of
 * one spelling straddle one: repairing the lower use seats the alias below the
 * upper one, which then draws its own declared-later error rather than being
 * fixed by the same edit. Three reasons for the local reading. It is what the
 * author asked for — the caret is on one use, and an edit that jumped above an
 * import line the author wrote between two declarations would be reordering
 * their file, not adding to it. It never makes a file worse: the upper use was
 * already refused and is now refused with a fixit of its own. And the shape is
 * reachable only through interleaved imports, which the top-down half of §3
 * exists to make legible rather than to encourage. The universal reading is
 * satisfied anyway wherever a request covers both uses, because each tier
 * offers the line once per spelling, above the earliest refusal of it.
 */
export function importInsertionOffset(
  placement: ImportPlacement,
  text: string,
  before: number,
): number {
  let offset = placement.header === undefined
    ? 0
    : pastBlankLines(text, pastLineEnd(text, placement.header.end.offset));
  for (const span of placement.imports) {
    if (span.end.offset > before) continue;
    offset = Math.max(offset, pastLineEnd(text, span.end.offset));
  }
  return offset;
}

/**
 * The offset past any run of blank lines starting at `offset` — so a line
 * inserted below a header joins the module's body rather than wedging itself
 * into the blank the house style leaves under the header.
 */
function pastBlankLines(text: string, offset: number): number {
  let at = offset;
  for (;;) {
    const end = text.indexOf("\n", at);
    const line = end === -1 ? text.slice(at) : text.slice(at, end);
    if (line.trim() !== "" || end === -1) return at;
    at = end + 1;
  }
}

/** The offset just past the line break that ends the line `offset` is on. */
function pastLineEnd(text: string, offset: number): number {
  const index = text.indexOf("\n", offset);
  return index === -1 ? text.length : index + 1;
}
