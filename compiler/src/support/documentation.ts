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
  /**
   * The spans of the names a reader would point at to ask what this
   * documentation says: usually the one name the declaration introduces, all of
   * them for a destructuring `let`, and for an `honor` block the constraint in
   * its head, which is the only name it writes.
   *
   * Emission never reads this; editor services do. They hold a *name* — a
   * symbol's `bindingSpan`, a union's, the identifier under a cursor — where
   * `target` is the declaration's first token, and the two are the same offset
   * only for the forms whose declaration begins with its name. Recording it
   * here keeps the join at the one place that already decides which
   * declaration a block documents, rather than making a second pass re-derive
   * it from the tree.
   */
  readonly subjects: readonly Source.Span[];
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

/**
 * One recognized **throws manifest** (`spec/doc-comments.md` §6.1): the declared
 * exception a documented declaration says it may raise, and the condition under
 * which it does.
 */
export interface ThrowsManifest {
  /** The bare declared name from the backticks — what `@throws {X}` carries. */
  readonly name: string;
  /**
   * The prose after `when`, without the sentence's trailing period. Interior
   * whitespace is collapsed — a tag is one line — and nothing else is touched.
   */
  readonly condition: string;
}

/** The backticked head of a manifest: `Throws`, then one backticked name, then `when`. */
const MANIFEST_HEAD = /(?<![\p{L}\p{N}_])Throws\s+`([^`\n]*)`\s+when\b/gu;

/**
 * A manifest head *inside* a condition, which refuses the whole sentence (§6.1).
 * Deliberately not the head above: what refuses is a backticked uppercase-start
 * name followed by `when`, with or without a second `Throws` in front of it —
 * ``Throws `X` when a, and `Y` when b.`` has only one `Throws`.
 */
const NESTED_HEAD = /`[A-Z][A-Za-z0-9_]*`\s+when(?![\p{L}\p{N}_])/u;

/** The bare declared name a manifest may carry: uppercase-start, identifier shaped. */
const MANIFEST_NAME = /^[A-Z][A-Za-z0-9_]*$/u;

/**
 * Every throws manifest in doc content, in source order (§6.1).
 *
 * Recognition is **exact and conservative**, and the deviations are all one
 * answer — ordinary prose, no tag: a lowercase or non-identifier name, a missing
 * period, an empty condition, an unbalanced inline code span. The one rule that
 * is not a mere non-match is the refusal: a condition that itself contains a
 * manifest head fires *nothing* rather than one mangled tag, which is what makes
 * one sentence per exception the grammar and not merely the style.
 *
 * Fenced code blocks are not prose, so nothing inside one is read — a manifest
 * quoted in an example fires nothing.
 *
 * **The sentence ends at its period, which is neither a dot inside an inline
 * code span nor a dot the sentence runs straight through.**
 * ``Throws `IndexError` when `Vector.at` receives a bad index.`` has two dots
 * and one sentence; stopping at the first would emit a tag truncated mid-span,
 * with an unbalanced backtick in it, and — worse — would run the nested-head
 * refusal over a span shorter than the sentence, letting an early dot carry a
 * second manifest head past the check. So the terminator is found by scanning
 * outside code spans, and the refusal then reads the whole condition — and only
 * a dot that whitespace or the end of the content follows is that terminator
 * (`sentenceEnd`), which is what keeps a decimal in plain prose from ending the
 * sentence a word early — whitespace that reaches the dot across a run of
 * closing marks counts, so a manifest written `**in bold.**` or ending
 * `(in parentheses.)` terminates where its reader sees it end.
 *
 * The scan stops at a blank line as well. A sentence never crosses a paragraph
 * break, so a manifest whose period is missing takes the rest of *its*
 * paragraph and nothing beyond it — the alternative reads on into the next
 * paragraph and derives a tag out of prose that was never the manifest.
 */
export function throwsManifests(content: string): readonly ThrowsManifest[] {
  const prose = withoutFencedCode(content);
  const manifests: ThrowsManifest[] = [];
  MANIFEST_HEAD.lastIndex = 0;
  for (
    let match = MANIFEST_HEAD.exec(prose);
    match !== null;
    match = MANIFEST_HEAD.exec(prose)
  ) {
    const name = match[1]!;
    const rest = prose.slice(MANIFEST_HEAD.lastIndex);
    const period = sentenceEnd(rest);
    if (period === undefined) continue;
    const condition = rest.slice(0, period);
    if (!MANIFEST_NAME.test(name)) continue;
    // Belt and braces over the scan above, which cannot stop inside a span: the
    // deriver never guesses, so a condition whose backticks do not pair is
    // ordinary prose rather than a tag with a dangling delimiter in it.
    if (unbalancedCodeSpans(condition)) continue;
    if (NESTED_HEAD.test(condition)) continue;
    // The condition is carried verbatim but must become one tag line, so the
    // line breaks a doc block wraps its prose over collapse to single spaces.
    const collapsed = condition.trim().replace(/\s+/gu, " ");
    if (collapsed === "") continue;
    manifests.push({ name, condition: collapsed });
  }
  return manifests;
}

/**
 * The offset of the period that ends the sentence beginning at `text`, or
 * nothing when there is none outside an inline code span, and none before the
 * paragraph the sentence began in ends.
 *
 * Spans follow CommonMark's rule: a run of *n* backticks opens one, and the next
 * run of exactly *n* closes it. An unclosed run therefore swallows the rest of
 * the content and the sentence has no terminator — which is the refusal, not a
 * fallback to the last dot seen.
 *
 * **A period is a dot followed by whitespace, or one that ends the content, and
 * never one of a run** (§6.1 — `endsSentence` holds those halves, the closing
 * marks a period keeps its office under, and why each class is closed). A dot
 * that does not qualify is interior to the sentence, so scanning continues past
 * it and a later qualifying dot still terminates: the decimal in
 * ``Throws `IndexError` when the timeout exceeds 1.5 seconds.`` would otherwise
 * derive the condition "when the timeout exceeds 1", and a dotted name written
 * as prose rather than a span — `Vector.at` without its backticks — would
 * truncate the same way where the span form already does not.
 *
 * **A blank line ends the scan with no period**, because a sentence does not
 * cross a paragraph break. That bound is what keeps "reads on to the next
 * qualifying dot" honest: without it a manifest missing its period annexes the
 * paragraphs after it, and the deviation stops being local. It applies even
 * with a code span still open, which costs nothing — an inline span cannot
 * contain a blank line in CommonMark either. It is also what stops the scan at
 * a fenced code block, since `withoutFencedCode` leaves a fence behind as empty
 * lines.
 */
function sentenceEnd(text: string): number | undefined {
  let index = 0;
  let open: number | undefined;
  while (index < text.length) {
    const character = text[index]!;
    if (character === "\n" && blankLineFollows(text, index)) return undefined;
    if (character === "`") {
      let run = 0;
      while (text[index + run] === "`") run += 1;
      if (open === undefined) open = run;
      else if (open === run) open = undefined;
      index += run;
      continue;
    }
    if (character === "." && open === undefined && endsSentence(text, index)) {
      return index;
    }
    index += 1;
  }
  return undefined;
}

/**
 * The marks a period keeps its office under: the closers of quotation,
 * bracketing, and Markdown emphasis (§6.1). ASCII only, and closed for the same
 * reason the whitespace set is — a curly quote or an exotic bracket would be a
 * second spelling no reader of the clause could enumerate.
 */
const CLOSING_MARKS = new Set([")", "]", "}", "\"", "'", "*", "_"]);

/**
 * Whether the dot at `index` is the sentence's period — see `sentenceEnd`.
 *
 * Whitespace is the closed set the source language itself admits (Lexer §2.1,
 * §2.2): a space, a tab, or a line ending. `\s` would be a wider and stranger
 * class than any reader could guess — it admits U+FEFF and refuses U+200B — and
 * doc content gets no invisible second spelling of a space that Hexagon source
 * is denied, so an exotic spacing character after the dot leaves the sentence
 * unterminated rather than guessed at. §2.2 calls a tab inside a comment
 * content rather than horizontal whitespace, but that is a stance about
 * tokenizing the comment, not about the prose inside it: here a tab separates
 * one word from the next, which is why it stays in the set.
 *
 * A dot immediately preceded by another dot is not a period either: an ellipsis
 * is interior. The condition is carried verbatim, so without this the last dot
 * of `bad... and more.` would qualify — whitespace follows it — and the run's
 * leading dots would ride into the tag as `when the index is bad..`.
 *
 * The whitespace may arrive **across a run of closing marks**: `(paren.)`,
 * `"quote."`, and `**bold.**` all end their sentence at the dot, and the marks
 * ride outside the condition rather than unseating the period. A manifest
 * emphasized in its own paragraph is ordinary house prose, and reading its
 * period as interior lost the whole tag silently — two such paragraphs lost
 * two.
 */
function endsSentence(text: string, index: number): boolean {
  if (text[index - 1] === ".") return false;
  let after = index + 1;
  while (after < text.length && CLOSING_MARKS.has(text[after]!)) after += 1;
  const next = text[after];
  return next === undefined || next === " " || next === "\t" ||
    next === "\n" || next === "\r";
}

/**
 * Whether the line ending at `index` is followed by a blank one — the paragraph
 * break `sentenceEnd` stops at.
 *
 * Doc content arrives with its line endings already normalized to `\n`
 * (`extractDocContent`), so the break is one newline, the horizontal whitespace
 * §2.2 admits, and a second newline.
 */
function blankLineFollows(text: string, index: number): boolean {
  let ahead = index + 1;
  while (text[ahead] === " " || text[ahead] === "\t") ahead += 1;
  return text[ahead] === "\n";
}

/** Whether a condition's backtick runs fail to pair — see `sentenceEnd`. */
function unbalancedCodeSpans(condition: string): boolean {
  let index = 0;
  let open: number | undefined;
  while (index < condition.length) {
    if (condition[index] !== "`") {
      index += 1;
      continue;
    }
    let run = 0;
    while (condition[index + run] === "`") run += 1;
    if (open === undefined) open = run;
    else if (open === run) open = undefined;
    index += run;
  }
  return open !== undefined;
}

/**
 * The content with every fenced code block blanked out (§6.1's prose-only rule).
 *
 * Blanked rather than removed so that nothing downstream has to reason about
 * shifted offsets; the recognizer reads text, never positions. A fence closes on
 * the same character it opened with, and an unclosed one runs to the end —
 * CommonMark's rule, and the conservative one here besides.
 */
function withoutFencedCode(content: string): string {
  let fence: string | undefined;
  return content.split("\n").map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1]?.[0];
    if (fence === undefined) {
      if (marker === undefined) return line;
      fence = marker;
      return "";
    }
    if (marker === fence) fence = undefined;
    return "";
  }).join("\n");
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
