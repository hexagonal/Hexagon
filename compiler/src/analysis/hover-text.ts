/**
 * What a hover reads as, for every host that shows one.
 *
 * The session answers `hover` with the facts — a name, what it denotes, its
 * type, its documentation — and leaves the sentence to whoever is drawing it.
 * Two hosts draw it: the language server, over LSP, and the Playground, into
 * Monaco. Both render Markdown, so the sentence itself is not protocol; only
 * the wrapper around it is (`MarkupContent` on one side, `IMarkdownString` on
 * the other). Written twice it drifts, and it did: the Playground's own hover
 * printed `xs : Seq(Int)` against the server's `value xs: Seq(Int)`, with no
 * documentation at all. So it is written here, once, and imported by both.
 */

import type { Target } from "../queries/occurrences.js";
import type { Hover } from "./session.js";

/**
 * One shape for every hover: what the name is, then its type when it has one,
 * then its documentation. A value and a union reading differently would make
 * the hover's own layout something the user has to parse before the content.
 *
 * The documentation is Markdown by `spec/doc-comments.md` §6 and goes in as
 * itself — no fencing, no escaping — because rendering it as Markdown is what
 * §8 asks for. It is separated by a blank line rather than by a rule: `---`
 * after a line of text is a Markdown *heading* marker, which would silently
 * restyle the signature above it.
 */
export function hoverMarkdown(hover: Hover): string {
  const signature = hover.displayedType === undefined
    ? `\`${hover.name}\``
    : `\`${hover.name}: ${hover.displayedType}\``;
  // A name the session found no identity for — an `honor` member, a record
  // field — is answered by its documentation alone, so there is no word to put
  // in front of it.
  const heading = hover.target === undefined
    ? signature
    : `${describeTarget(hover.target)} ${signature}`;
  return hover.documentation === undefined
    ? heading
    : `${heading}\n\n${hover.documentation}`;
}

/** The word a hover puts in front of a name, for each thing a name can be. */
function describeTarget(target: Target): string {
  switch (target.kind) {
    case "value":
      return "value";
    case "union":
      return "union";
    case "record":
      return "record";
    case "extern-type":
      return "foreign type";
    case "constraint":
      return "constraint";
  }
}
