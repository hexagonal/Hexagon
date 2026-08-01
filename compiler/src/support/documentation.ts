/**
 * Documentation attached to a declaration: the content model of
 * `spec/doc-comments.md`, plus the §3.1 extraction that produces it.
 *
 * Documentation is metadata, not semantics. It reaches the back end on the
 * module, keyed by the source position of the declaration it documents, rather
 * than as a field on fifteen node types across four trees — nothing between the
 * parser and the emitter reads it, and nothing may branch on it.
 */

import type * as Source from "./source.js";

/** One doc block (§3.2), resolved to the declaration it documents (§4). */
export interface Documentation {
  /** Extracted, dedented, joined content (§3.1, §3.2); `""` when empty. */
  readonly content: string;
  /**
   * Start offset of the documented declaration's own span — the key emission
   * and tooling look documentation up by. It is the declaration's span, not the
   * doc block's, and not necessarily the token attachment matched on: a doc
   * block before `| Circle(…)` matches the `|` and targets the constructor.
   */
  readonly target: number;
  /** The doc block's own extent, first opener through last closer. */
  readonly span: Source.Span;
  /** The comments the block is made of, so emission does not repeat them. */
  readonly comments: readonly Source.Comment[];
}

/**
 * Extracts one doc comment's content (§3.1), in the spec's order: drop one
 * leading space after `(**`, drop a blank remainder of the opener's line, drop
 * trailing whitespace before `*)`, then dedent by the longest common literal
 * whitespace prefix.
 *
 * The opener-line fragment is exempt from the dedent because it begins mid-line
 * and carries no indentation of its own — but only when it exists. A body that
 * begins on the next line has no fragment, so all of its lines participate and
 * dedent together.
 */
export function extractDocContent(comment: Source.Comment): string {
  // An unterminated doc comment still reaches here, recorded alongside its own
  // diagnostic (Comments §5); there is no closer to strip.
  let body = comment.text.slice(3, comment.terminated ? -2 : undefined);

  // 1a. one leading space after `(**`.
  if (body.startsWith(" ")) body = body.slice(1);

  // 1b. a blank remainder of the opener's line goes entirely, newline included;
  //     what is left then has no opener-line fragment.
  const firstBreak = /\r\n|\r|\n/u.exec(body);
  let fragment = true;
  if (firstBreak === null) {
    if (body.trim() === "") {
      body = "";
      fragment = false;
    }
  } else if (body.slice(0, firstBreak.index).trim() === "") {
    body = body.slice(firstBreak.index + firstBreak[0].length);
    fragment = false;
  }

  // 2. trailing whitespace, the final newline included, before `*)`. Only the
  //    body's end: whitespace at the end of an interior line is content (two
  //    trailing spaces are a Markdown hard break).
  body = body.replace(/\s+$/u, "");

  // 3. dedent by the longest common literal whitespace prefix, computed over
  //    the non-blank lines and stripped from exactly the lines that
  //    participated — so a blank line keeps whatever whitespace it has, and the
  //    opener-line fragment keeps all of its.
  const lines = body.split(/\r\n|\r|\n/u);
  const participates = (line: string, index: number) =>
    !(fragment && index === 0) && line.trim() !== "";
  const prefix = commonWhitespacePrefix(lines.filter(participates));

  return lines
    .map((line, index) =>
      participates(line, index) ? line.slice(prefix.length) : line
    )
    .join("\n");
}

/** The longest whitespace prefix every given line starts with. */
function commonWhitespacePrefix(lines: readonly string[]): string {
  let prefix: string | undefined;
  for (const line of lines) {
    const indent = /^[ \t]*/u.exec(line)![0];
    if (prefix === undefined) {
      prefix = indent;
      continue;
    }
    let shared = 0;
    while (
      shared < prefix.length && shared < indent.length &&
      prefix[shared] === indent[shared]
    ) {
      shared += 1;
    }
    prefix = prefix.slice(0, shared);
  }
  return prefix ?? "";
}
