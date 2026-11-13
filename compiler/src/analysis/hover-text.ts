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
import { glossSentences } from "../syntax/typed/display.js";
import type { Hover } from "./session.js";

/**
 * One shape for every hover: what the name is, then its type when it has one,
 * its parameters under their declared names where it has those (Functions
 * §5.1), then its documentation. A value and a union reading differently would make
 * the hover's own layout something the user has to parse before the content.
 * An expression's type has no name, so it is the type alone, and then, where
 * the checker converted the expression in place, the type it became.
 *
 * The documentation is Markdown by `spec/doc-comments.md` §6 and goes in as
 * itself — no fencing, no escaping — because rendering it as Markdown is what
 * §8 asks for. It is separated by a blank line rather than by a rule: `---`
 * after a line of text is a Markdown *heading* marker, which would silently
 * restyle the signature above it.
 */
export function hoverMarkdown(hover: Hover): string {
  const type = hover.signature ?? hover.displayedType;
  const signature = hover.name === undefined
    ? `\`${type}\``
    : type === undefined
    ? `\`${hover.name}\``
    : `\`${hover.name}: ${type}\``;
  // A name the session found no identity for — an `honor` member, a record
  // field — is answered by its documentation alone, so there is no word to put
  // in front of it.
  const named = hover.target === undefined
    ? signature
    : `${describeTarget(hover.target)} ${signature}`;
  // Effects §10's gloss (#873), on a line of its own and so in sentences
  // (Declarations Preamble §1.3).
  const glossed = hover.colourOwners === undefined
    ? named
    : [named, ...hover.colourOwners.map(glossSentences)].join("\n\n");
  const heading = hover.convertedTo === undefined
    ? glossed
    : `${glossed}\n\nConverted to \`${hover.convertedTo}\` here.`;
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
    case "module":
      return "module";
  }
}
