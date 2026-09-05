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
 *
 * The line arithmetic the placement is built from is exported beside it, for
 * the same reason: Modules §2.2's header *move* lifts a line and its blank run,
 * and every tier that writes a line has to end it the way the file ends its
 * own — and has to cope with a file whose last line is ended by nothing at all
 * (`insertedLine`). One copy of each, or the tiers drift.
 *
 * **One seat writes its line by hand, and says so here rather than looking like
 * a fourth reader that forgot to call.** Modules §2.1's headerless repair (the
 * parser's `every file declares its module`) writes `module Name` plus *two*
 * breaks at offset zero. Both departures are the point: its offset is always
 * zero, where `insertedLine`'s opening break — which exists for a file whose
 * last line is unterminated — is never wanted, and the second break is the
 * blank line the house style leaves under a header, which no other seat writes
 * because no other seat is writing the header. It still ends its line the way
 * the file ends its own (`newlineOf`), which is the part of the arithmetic
 * there is only one copy of.
 */

import type * as Diagnostics from "./diagnostics.js";
import * as Source from "./source.js";
import type * as Parsed from "../syntax/parsed/index.js";

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
 * what offset zero would produce.
 *
 * **A file with no header gets no placement at all** — `undefined`, and the
 * refusal keeps its message and drops its edit. There is no module for the line
 * to sit inside, and the top of the file is the one seat it may not take: the
 * parser's own "every file declares its module" refusal inserts `module Name`
 * there, so two fixes would stand at offset zero and a host applying both at
 * once could put the import above the header it was meant to follow. Applied
 * one at a time the second is recomputed and lands correctly either way; a "fix
 * all" does not recompute, so the collision is removed rather than ordered
 * around, and the header repair — the one that file needs first — is left
 * alone. An import line the use is already below still places, header or not:
 * that offset is never zero, so nothing collides.
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
): number | undefined {
  let offset = placement.header === undefined
    ? undefined
    : pastBlankLines(text, pastLineEnd(text, placement.header.end.offset));
  for (const span of placement.imports) {
    if (span.end.offset > before) continue;
    const below = pastLineEnd(text, span.end.offset);
    offset = offset === undefined ? below : Math.max(offset, below);
  }
  return offset;
}

/**
 * The offset past any run of blank lines starting at `offset` — so a line
 * inserted below a header joins the module's body rather than wedging itself
 * into the blank the house style leaves under the header.
 *
 * Exported for Modules §2.2's other line edit, the header *move*: what a move
 * lifts is the header's line and the blank run under it, which is the same run
 * an insert below a header steps over. One copy of the arithmetic, for the
 * reason the module doc gives — two tiers editing one file must not each own a
 * notion of where a line ends.
 */
export function pastBlankLines(text: string, offset: number): number {
  let at = offset;
  for (;;) {
    const end = text.indexOf("\n", at);
    const line = end === -1 ? text.slice(at) : text.slice(at, end);
    if (line.trim() !== "" || end === -1) return at;
    at = end + 1;
  }
}

/**
 * The offset just past the line break that ends the line `offset` is on. The
 * break itself is kept in the slice below it, so a CRLF file's `\r` travels
 * with the line it ends rather than being left behind.
 *
 * **A file's last line need not be ended at all**, and then this answers
 * `text.length` — an offset past the *line* that is not past a *break*. Every
 * caller writing a line at, or lifting a line up to, an offset from here has to
 * treat that case, which is what `insertedLine` is for: `pastLineEnd` reports
 * where the line stops and nothing more, because inventing a break here would
 * make the arithmetic disagree with the file it is measuring.
 */
export function pastLineEnd(text: string, offset: number): number {
  const index = text.indexOf("\n", offset);
  return index === -1 ? text.length : index + 1;
}

/**
 * The text a tier writes to put `line` at `offset` as a **whole line of its
 * own** — `line`, ended the way the file ends its own lines where it does not
 * end itself, and opened with a break where `offset` is the end of a file whose
 * last line has none.
 *
 * Both halves answer the one fact `pastLineEnd` records: a file's last line can
 * be unterminated, and the *first* file where that matters is not an exotic one
 * — it is the buffer an author is typing in, whose last line is unterminated
 * for exactly as long as it takes them to press Return. A tier that pasted its
 * own line at such an offset would weld two lines into one, and a tier that
 * lifted such a line and put it back elsewhere would weld it to whatever
 * stands where it lands: `module Geometry` moved above `let stray: Int = 1`
 * becomes `module Geometrylet stray: Int = 1`, which is a repair that refuses
 * the file it repaired.
 *
 * One copy, and both tiers plus §2.2's header move read it, for the reason the
 * module doc gives: a second notion of where a line ends is how two editors of
 * one file come to disagree about it.
 */
export function insertedLine(text: string, offset: number, line: string): string {
  const opening = offset > 0 && offset >= text.length && !text.endsWith("\n")
    ? newlineOf(text)
    : "";
  const closing = line.endsWith("\n") ? "" : newlineOf(text);
  return `${opening}${line}${closing}`;
}

/**
 * Modules §5.1 rule 1's **other** applied edit: the qualifier dropped.
 *
 * "A module does not qualify through itself; write `make(1.0, 0.0)`" — and
 * `` `Point` is a type, not a module; write `make(0.0, 0.0)` `` — repair by
 * deleting the qualification and nothing else, so what is left is the reference
 * the reader already wrote. `qualification` is the range that goes: the
 * qualifier and its dot, measured where the two names were parsed.
 *
 * One writer, for the reason the module doc gives, and here the two readers are
 * two *passes* rather than two tiers: the resolver reports this family at the
 * term, type and pattern seats, the checker at the constraint seats Constraints
 * §8 sends here, and a reader who wrote the same mistake in a binder and in a
 * body is owed the same repair under the same words at both.
 */
export function dropQualifierFix(qualification: Source.Span): Diagnostics.Fix {
  return {
    message: "drop the qualifier",
    edits: [{ span: qualification, replacement: "" }],
  };
}

/** The offset the line `offset` sits on begins at. */
export function lineStart(text: string, offset: number): number {
  return offset <= 0 ? 0 : text.lastIndexOf("\n", offset - 1) + 1;
}

/**
 * The line ending the file itself uses — `\r\n` where its first break is one,
 * `\n` otherwise (a file with no break at all).
 *
 * An inserted line has to end the way the lines around it do: a `\n` written
 * into a CRLF file leaves one line ending in the middle of the file that does
 * not match its neighbours, which is a diff every reviewer of that file sees
 * and no author wrote. The first break settles it because a file mixing the two
 * has no answer to give, and its first line is the one convention anything else
 * can be measured against.
 */
export function newlineOf(text: string): string {
  const index = text.indexOf("\n");
  return index > 0 && text[index - 1] === "\r" ? "\r\n" : "\n";
}

/**
 * The **one writer** of this family's applied edit, for one module.
 *
 * Modules §5.1: "One edit per module, however many seats draw the report: every
 * seat carries the same insert, the same range and the same text". Two passes
 * draw the report — the resolver at the term, type and pattern seats, the
 * checker at the constraint seats Constraints §8 sends here — and a reader who
 * writes `Scale.Scale` in a binder and `Scale.create` in its body is owed one
 * import line, not two, and not one at three seats and none at the fourth.
 * A cache private to either pass gives exactly that, so the cache is here and
 * both passes hold the same one.
 *
 * `undefined` where the module supplied no source text (a pass-level `resolve`
 * or `check` in a unit test) or where the placement declines (a file with no
 * header — `importInsertionOffset`), which degrades to the message alone and
 * never to a wrong offset.
 */
export class ImportRepairs {
  readonly #placement: ImportPlacement;
  readonly #text: string | undefined;
  readonly #file: Source.File | undefined;
  readonly #offered = new Map<string, Diagnostics.Fix>();
  readonly #headRewritten: readonly Parsed.RefusedImportHead[];

  constructor(module: Parsed.Module, text: string | undefined, path: string | undefined) {
    this.#placement = {
      header: module.name.declared ? module.name.span : undefined,
      imports: module.items.flatMap((item) =>
        // A refused head's recovery is a line the author wrote and the reading
        // kept, so an inserted import still belongs below it.
        item.kind === "Import" ? [item.span] : []
      ),
    };
    this.#text = text;
    this.#file = text === undefined
      ? undefined
      : new Source.File(module.fileId, path ?? "", text);
    this.#headRewritten = module.refusedImportAliases;
  }

  /**
   * §5.1's "a refused import head that offers the same line by its own rewrite
   * is that line already offered, and **the seats below it** carry none" — a
   * miscased head (`import geometry`) is refused at parse with `import
   * Geometry` as its own applied edit, so a seat below it names the line and
   * writes none, or two lightbulbs write one import.
   *
   * **Below it** is the whole condition and is read positionally. A use that
   * stands *above* the head keeps its edit, and has to: the head's own rewrite
   * would bind the alias underneath that use, where §3's top-down half refuses
   * it again, so the line the head offers is not the line that use needs. What
   * that use needs is an import above itself, which is exactly what `fix`
   * places (`importInsertionOffset` considers only import lines the use is
   * already below, and falls back to the header). Membership alone would take
   * the repair away from a seat the head cannot repair, for a reason nothing on
   * the reader's screen states.
   */
  headRewrites(spelling: string, use: number): boolean {
    return this.#headRewritten.some(({ alias, span }) =>
      alias === spelling && span.start.offset < use
    );
  }

  /**
   * The applied edit inserting `line`, for the spelling `spelling`, above the
   * use at `use`.
   *
   * Computed once per spelling, from the first use any pass reaches — which is
   * the topmost, and so sits above them all — and handed back at every later
   * seat. A host applying any set of them at once therefore applies one import,
   * and a host recomputing after applying one finds the line present and offers
   * nothing.
   */
  fix(spelling: string, line: string, use: number): Diagnostics.Fix | undefined {
    const text = this.#text;
    const file = this.#file;
    if (text === undefined || file === undefined) return undefined;
    const already = this.#offered.get(spelling);
    if (already !== undefined) return already;
    const offset = importInsertionOffset(this.#placement, text, use);
    if (offset === undefined) return undefined;
    const fix: Diagnostics.Fix = {
      // The **family's** title, the one the workspace tier writes at the seats
      // it still owns (`#importModuleAction`): one repair offered under one
      // name, whichever tier reached it.
      message: `import \`${spelling}\``,
      // The line written as a whole line (`insertedLine`), not spliced in: it
      // ends the way its neighbours do, or the repair carries a whitespace diff
      // into a CRLF file, and it opens with a break where the offset is the end
      // of a file whose last line has none, or the repair welds two lines.
      edits: [{ span: file.span(offset, offset), replacement: insertedLine(text, offset, line) }],
    };
    this.#offered.set(spelling, fix);
    return fix;
  }
}
