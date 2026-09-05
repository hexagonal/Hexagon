/**
 * Compiler-owned source query: what each *name* in a file is, for an editor that
 * colours by meaning rather than by shape.
 *
 * ## Why this only classifies names
 *
 * Hexagon already ships a TextMate grammar, and semantic tokens override it
 * wherever the two overlap. So this query deliberately says nothing about
 * keywords, operators, literals, comments or punctuation: a regex knows those
 * exactly, the grammar already gets them right, and publishing a second opinion
 * would fork one answer across two implementations that nothing keeps in step.
 *
 * What a grammar cannot know is what a *name* means. `Colour` is a union here
 * and a record there; `size` is a function in one module and a parameter in the
 * next; `Red` is a constructor and `Red` is not a type. Those are resolution
 * results, and they are the whole of what this adds.
 *
 * The second consequence matters just as much: when a file stops parsing, this
 * query goes quiet and the grammar carries on colouring. A classifier that also
 * owned keywords would take the whole file's colour down with the parse.
 *
 * ## Modifiers
 *
 * Only `declaration`. LSP's `readonly` was considered and left out: Hexagon
 * values are immutable unless declared `var`, so marking every name readonly
 * states the default rather than distinguishing anything, and themes render it
 * as a visible difference — every ordinary binding would take a colour that in
 * other languages means "constant". The distinction worth drawing, `var`, has no
 * modifier in the protocol, and inventing one the client does not know is not a
 * distinction either.
 */

import type * as Source from "../support/source.js";
import type * as Resolved from "../syntax/resolved/index.js";
import type { Occurrence } from "./occurrences.js";
import type { SymbolFacts } from "./symbol-facts.js";

/**
 * The subset of LSP's standard token types Hexagon has names for. Standard ones
 * are used rather than invented ones so that a theme the user already has
 * colours Hexagon without being taught to; a custom type falls back to no colour
 * at all in every theme that has not heard of it.
 */
export type SemanticTokenType =
  | "function"
  | "method"
  | "variable"
  | "parameter"
  | "enum"
  | "enumMember"
  | "struct"
  | "type"
  | "interface";

export type SemanticTokenModifier = "declaration";

export interface SemanticToken {
  readonly span: Source.Span;
  readonly type: SemanticTokenType;
  readonly modifiers: readonly SemanticTokenModifier[];
}

/**
 * One file's name tokens, ordered by position and never overlapping.
 *
 * Occurrences arrive sorted and can share a span — a record's declaration is its
 * type and its constructor at once — but the protocol's encoding admits one
 * token per range, so a shared span publishes its first classification. The only
 * sharing this index produces is that record declaration, whose two readings map
 * to the same token, so nothing is being chosen between.
 */
export function collectSemanticTokens(
  occurrences: readonly Occurrence[],
  facts: ReadonlyMap<number, SymbolFacts>,
): readonly SemanticToken[] {
  const tokens: SemanticToken[] = [];
  const taken = new Set<string>();
  for (const occurrence of occurrences) {
    const { span } = occurrence;
    // The encoding is line-relative and cannot express a token that spans lines.
    // An identifier never does; a malformed span would corrupt every token after
    // it, so it is dropped rather than trusted.
    if (span.start.line !== span.end.line) continue;
    const key = `${span.start.offset}:${span.end.offset}`;
    // "First" is **compile order** since #829, not source order: a file may
    // declare several modules and the project hands them over dependency-first
    // (Modules §8.1), so the declaring module's occurrences arrive ahead of the
    // importer's listing of them. That is the dependency this dedupe rests on —
    // a declaration is a better classification than a mention of it, and the
    // order is what makes the declaration first. Any reordering of
    // `Analysis.occurrencesIn` has to change this key rather than trust it.
    if (taken.has(key)) continue;
    const type = classify(occurrence, facts);
    if (type === undefined) continue;
    taken.add(key);
    tokens.push({
      span,
      type,
      modifiers: occurrence.role === "definition" ? ["declaration"] : [],
    });
  }
  return tokens.sort((left, right) =>
    left.span.start.line - right.span.start.line ||
    left.span.start.column - right.span.start.column
  );
}

function classify(
  occurrence: Occurrence,
  facts: ReadonlyMap<number, SymbolFacts>,
): SemanticTokenType | undefined {
  switch (occurrence.target.kind) {
    case "union":
      return "enum";
    case "record":
      return "struct";
    case "extern-type":
      return "type";
    case "constraint":
      return "interface";
    case "value": {
      const known = facts.get(Number(occurrence.target.symbol));
      // A symbol with no entry is one no module declared, which should not
      // happen; colouring it as an ordinary binding is the answer that misleads
      // least, since that is what most names are.
      if (known === undefined) return "variable";
      return ofValue(known);
    }
  }
}

function ofValue(facts: SymbolFacts): SemanticTokenType {
  switch (facts.kind) {
    case "fun":
      return "function";
    case "parameter":
      // A parameter that happens to hold a function is still a parameter: that
      // is the distinction a reader is scanning for, and the type is on hover.
      return "parameter";
    case "constructor":
      return "enumMember";
    case "record-constructor":
      // The same token a record's *type* gets, and deliberately so: in source
      // the two are one name, and colouring the constructor as something else
      // would make one declaration look like two unrelated things.
      return "struct";
    case "constraint-member":
      return "method";
    case "let":
    case "var":
    case "pattern":
    case "extern":
      // The binder form does not say whether this is a function. `let f(x) = …`
      // is a `let`, `extern fun` and `extern let` are both `extern`, and
      // `let g = f` is a function with no parameter list anywhere. The type is
      // the thing that knows.
      return facts.functionValued ? "function" : "variable";
  }
}
