/**
 * Doc-block formation and attachment: `spec/doc-comments.md` §3.2, §4, §5.
 *
 * Doc comments are trivia and stay trivia — they are not tokens and never enter
 * the grammar (§10). What happens here instead is bookkeeping alongside the
 * parser: the doc comments are grouped into blocks, each block is indexed by the
 * physical code token that follows it, and a declaration parser claims the block
 * sitting before its first token. Whatever is left over documented nothing, and
 * that is §5's hard error.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import {
  extractDocContent,
  type Documentation,
} from "../../support/documentation.js";
import type * as LaidOut from "../../syntax/laid-out/index.js";

const REWRITE = "Move it directly above the declaration it describes, or make " +
  "it an ordinary comment (`(* ... *)`).";

const DANGLING =
  "documentation comment does not document anything — the next code is not a " +
  `declaration. ${REWRITE}`;

const IMPORTS = `${DANGLING} imports are not documentable; module-level ` +
  "documentation is not in v1.";

const EXTERN_HEADER =
  "documentation attaches to the items an `extern from` block introduces, not " +
  "to the block — move it above the first item inside the block, or make it an " +
  "ordinary comment (`(* ... *)`).";

const LEADING_ONLY =
  "documentation comments precede what they document — move this above the " +
  "declaration on its own line, or make it an ordinary comment (`(* ... *)`).";

/**
 * `spec/constraints.md` §4.7's "one operation, one doc": a member supplied by a
 * `widens` declaration is that declaration's body restricted, so the operation
 * is documented once, at its widest face. The accounting line reports that the
 * supply happened elsewhere and has nothing of its own to say.
 */
export function widenedLineTakesNoDoc(member: string): string {
  return `the \`${member} = widened\` line takes no documentation — one ` +
    "operation, one doc: document it at its `widens` declaration, or make " +
    "this an ordinary comment (`(* ... *)`).";
}

interface Block {
  readonly comments: readonly Source.Comment[];
  readonly span: Source.Span;
  /** Index into the code-token list of the token that follows the block. */
  readonly next: number;
  /** Members with code before them on their line: §4.3's violation. */
  readonly offending: readonly Source.Comment[];
  claimed: boolean;
}

export class DocBlocks {
  /**
   * A `DocBlocks` with nothing in it, for a parser that is not parsing a file.
   * The interpolation sub-parser is the only one: an interpolation's comments
   * are in the *outer* file's list already, where the enclosing-token test in
   * the constructor answers for them, so giving the inner parser the outer
   * bookkeeping would let one comment be judged twice.
   */
  static none(diagnostics: Diagnostics.Bag): DocBlocks {
    return new DocBlocks([], [], diagnostics);
  }

  /** Physical, non-`Eof` tokens: the "code tokens" §4.1 quantifies over. */
  readonly #code: readonly LaidOut.Token[];
  readonly #diagnostics: Diagnostics.Bag;
  /** Blocks by the start offset of the code token that follows them. */
  readonly #blocks = new Map<number, Block>();
  readonly #attached: Documentation[] = [];

  constructor(
    tokens: readonly LaidOut.Token[],
    comments: readonly Source.Comment[],
    diagnostics: Diagnostics.Bag,
  ) {
    this.#diagnostics = diagnostics;
    this.#code = tokens.filter(({ kind }) =>
      kind !== "VOpen" && kind !== "VSep" && kind !== "VClose" && kind !== "Eof"
    );

    let pending: Source.Comment[] = [];
    let pendingNext = -1;
    const flush = () => {
      if (pending.length === 0) return;
      const members = pending;
      pending = [];
      const first = members[0]!;
      const last = members.at(-1)!;
      this.#blocks.set(this.#code[pendingNext]?.span.start.offset ?? -1, {
        comments: members,
        span: { fileId: first.span.fileId, start: first.span.start, end: last.span.end },
        next: pendingNext,
        offending: members.filter((comment) => !this.#isLeading(comment)),
        claimed: false,
      });
    };

    for (const comment of comments) {
      if (!comment.documentation) continue;

      // §5's last row: an unterminated doc comment takes Comments §5's error and
      // nothing else. It runs to end of file, so it has no next code token, and
      // adding "documents nothing" to it would be a cascade from one typo.
      if (!comment.terminated) continue;

      // A doc comment inside a string interpolation is inside a token: the
      // lexer scans an interpolation's trivia with the same scanner, so its
      // comments reach this list even though its tokens do not. It documents
      // nothing, and the code token that follows the *string* is not its
      // neighbour, so it never joins a block.
      if (this.#enclosingToken(comment.span.start.offset) !== undefined) {
        this.#report(DANGLING, comment.span);
        continue;
      }

      // §3.2: consecutive doc comments form one block. Ordinary comments and
      // blank lines between them are invisible; a code token between them is
      // not, and starts a new block.
      const next = this.#nextCode(comment.span.start.offset);
      if (pending.length > 0 && next !== pendingNext) flush();
      pendingNext = next;
      pending.push(comment);
    }
    flush();
  }

  /**
   * Claims the block sitting before `codeTokenOffset`, if there is one, as the
   * documentation of a declaration spanning `target`.
   *
   * `subjects` are the spans of the names a reader would point at to ask what
   * the block says, for the editor services that hold a name rather than a
   * declaration — one for most forms, several for a destructuring `let`, and
   * none for a pattern that binds nothing. Required rather than defaulted: a
   * call site that passed none by omission would file its block under no name
   * at all, which is silent, and is the §8 gap `subjects` exists to close.
   */
  attach(
    codeTokenOffset: number,
    target: Source.Span,
    subjects: readonly Source.Span[],
  ): void {
    const block = this.#claim(codeTokenOffset);
    if (block === undefined) return;

    // §4.3: a doc comment with code before it on its line does not attach, even
    // when what follows it is exactly the declaration it was aimed at. Its
    // block-mates still do — the rule rejects a comment, not its neighbours.
    for (const comment of block.offending) this.#report(LEADING_ONLY, comment.span);
    const members = block.comments.filter(
      (comment) => !block.offending.includes(comment),
    );
    if (members.length === 0) return;
    const first = members[0]!;
    const last = members.at(-1)!;

    this.#attached.push({
      // §3.2: contents concatenate in source order, joined by a blank line. An
      // empty member contributes nothing rather than a stray paragraph break.
      content: members
        .map(extractDocContent)
        .filter((content) => content !== "")
        .join("\n\n"),
      target: target.start.offset,
      subjects,
      span: { fileId: first.span.fileId, start: first.span.start, end: last.span.end },
      comments: members,
    });
  }

  /**
   * Claims the block without recording it: the declaration it would document
   * failed to parse, and one syntax error is enough.
   */
  discard(codeTokenOffset: number): void {
    this.#claim(codeTokenOffset);
  }

  /**
   * Claims the block and **refuses** it: this position documents nothing, and
   * says so rather than swallowing the comment.
   *
   * The difference from `discard` is the whole point — that one is silent
   * because a syntax error has already been reported, while here the code
   * parsed fine and the only thing wrong is that a doc block was written where
   * no documentation can live. Refusing beats attaching it invisibly.
   */
  refuse(codeTokenOffset: number, message: string): void {
    const block = this.#claim(codeTokenOffset);
    if (block === undefined) return;
    this.#report(message, block.span);
  }

  /** Reports every unclaimed block (§5) and returns what attached (§4). */
  finish(): readonly Documentation[] {
    for (const block of this.#blocks.values()) {
      if (block.claimed) continue;
      // §5 splits the two overlapping rows by what the doc comment sits in
      // front of. A doc comment with code after it on its line is embedded in a
      // declaration or an expression — the positions row 1 names — while one
      // that ends its line is a trailing annotation, which is row 4's own case
      // and the form §10 rejects outright.
      if (block.offending.length > 0 && !this.#codeFollowsOnLine(block)) {
        for (const comment of block.offending) this.#report(LEADING_ONLY, comment.span);
        continue;
      }
      this.#report(this.#danglingMessage(block), block.span);
    }
    return this.#attached;
  }

  #claim(codeTokenOffset: number): Block | undefined {
    const block = this.#blocks.get(codeTokenOffset);
    if (block === undefined || block.claimed) return undefined;
    block.claimed = true;
    return block;
  }

  /** §4.3: only whitespace and other comments may precede it on its line. */
  #isLeading(comment: Source.Comment): boolean {
    const previous = this.#code[this.#nextCode(comment.span.start.offset) - 1];
    return previous === undefined || previous.span.end.line !== comment.span.start.line;
  }

  #codeFollowsOnLine(block: Block): boolean {
    return this.#code[block.next]?.span.start.line === block.span.end.line;
  }

  /**
   * §5's message rows. The generic sentence would be false of an `extern from`
   * header — that header *does* begin a declaration form — so the Rewrite Rule
   * sends it somewhere else; and a doc block over an import is pointed at the
   * module-documentation deferral, which is what its author was reaching for.
   */
  #danglingMessage(block: Block): string {
    const token = this.#code[block.next];
    if (token === undefined) return DANGLING;
    if (token.kind === "Import") return IMPORTS;
    if (token.kind !== "Extern") return DANGLING;
    return this.#code[block.next + 1]?.kind === "Import" ? IMPORTS : EXTERN_HEADER;
  }

  /** The index of the first code token starting at or after `offset`. */
  #nextCode(offset: number): number {
    let low = 0;
    let high = this.#code.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.#code[middle]!.span.start.offset < offset) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /** The code token whose extent strictly contains `offset`, if any. */
  #enclosingToken(offset: number): LaidOut.Token | undefined {
    const candidate = this.#code[this.#nextCode(offset) - 1];
    return candidate !== undefined && candidate.span.end.offset > offset
      ? candidate
      : undefined;
  }

  #report(message: string, primary: Source.Span): void {
    this.#diagnostics.add({ severity: "error", message, primary });
  }
}
