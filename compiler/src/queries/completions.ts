/**
 * Compiler-owned source query: what could be written at an offset.
 *
 * This is the one editor question the rest of the compiler cannot answer from
 * what it keeps. Every other query reads a finished tree, where each name has
 * already become an identity — but completion asks about names that are *not*
 * there yet, so it needs the layers a name would have been chosen from, which
 * resolution consumes and discards. `Resolved.Module.scopes` is the resolver
 * writing those layers down as it goes, and this query reads them back.
 *
 * ## Two shapes of request
 *
 * **Qualified** — `Vector.` — lists one module's members, and is the common case
 * in a language whose library is reached through module names. **Unqualified**
 * lists what is in scope: local binders, module-level declarations, imports, the
 * prelude, the type names this module can see, and the module names themselves.
 *
 * Telling the two apart is the one thing here that reads source text rather than
 * a tree, and it has to: at the moment of the request `Vector.` does not parse,
 * and a tree that refuses to describe a half-typed line is exactly the tree an
 * editor is asking about. The reading is lexical only — which identifier
 * precedes the dot — using `spec/lexer.md` §3's own definition of an identifier
 * rather than a second guess at one. Nothing about *meaning* is read from text.
 *
 * ## What this deliberately does not do
 *
 * It does not narrow by position. A type annotation gets value names offered
 * alongside type names, because knowing that an offset is in type position means
 * having a parse, and the buffer being completed in is the one that does not
 * have one. Every candidate carries its kind, so a client shows them apart, and
 * a wrong-kind suggestion costs a glance rather than a mistake — where guessing
 * from a broken parse would drop the *right* answers.
 */

import type * as Resolved from "../syntax/resolved/index.js";
import {
  codePointBefore,
  identifierStartBefore,
  isIdentifierStart,
} from "../support/identifiers.js";
import { isCompilerMinted } from "../support/synthetic.js";
import type { SymbolFacts } from "./symbol-facts.js";

export type CompletionKind =
  | "value"
  | "function"
  | "parameter"
  | "constructor"
  | "type"
  | "module";

export interface Completion {
  readonly name: string;
  readonly kind: CompletionKind;
  /** The checker's type, for the ones that have one. */
  readonly detail?: string;
}

export interface CompletionInput {
  /** The file's text, for reading the partial name at the cursor. */
  readonly text: string;
  readonly offset: number;
  readonly resolved: Resolved.Module;
  readonly facts: ReadonlyMap<number, SymbolFacts>;
}

export function collectCompletions(input: CompletionInput): readonly Completion[] {
  // A comment cannot contain code, so nothing belongs here. Strings are left
  // alone deliberately: one can hold an interpolation, where names *do* belong,
  // and telling the two apart needs the token stream rather than the text.
  // Exclusive at the start — a cursor at the opening `/` is in front of the
  // comment — and at the end only for a block, whose span runs past its closing
  // `*)`. A line comment's span stops at the newline, so its last offset is
  // still inside it, and going exclusive there would answer on every line that
  // ends in a comment.
  if (input.resolved.comments.some(({ kind, span }) =>
    input.offset > span.start.offset &&
    (kind === "Block" ? input.offset < span.end.offset : input.offset <= span.end.offset)
  )) {
    return [];
  }
  const qualifier = qualifierAt(input.text, input.offset);
  if (qualifier !== undefined) return membersOf(qualifier, input);
  const found = new Map<string, Completion>();
  for (const region of regionsAt(input.resolved.scopes, input.offset, input.text)) {
    for (const binding of region.bindings) {
      // A sequential `let` scopes over the rest of its block, so before that
      // point the name is not merely unhelpful to offer — using it is an error.
      if (binding.visibleFrom > input.offset) continue;
      // Innermost first, so the first answer for a name is the one that name
      // actually means here; an outer binding of the same name is shadowed and
      // has no separate entry to offer.
      if (found.has(binding.name)) continue;
      // Compiler-minted binders are real symbols in a real scope — a `try` arm
      // binds one — but the lexer refuses to read `__hex_` back, so offering one
      // hands the user a name they cannot type.
      if (isCompilerMinted(binding.name)) continue;
      found.set(binding.name, ofSymbol(binding.name, binding.symbol, input.facts));
    }
  }
  for (const { name } of typeNames(input.resolved)) {
    if (!found.has(name)) found.set(name, { name, kind: "type" });
  }
  for (const { alias } of input.resolved.moduleAliases) {
    if (!found.has(alias)) found.set(alias, { name: alias, kind: "module" });
  }
  return sorted([...found.values()]);
}

/**
 * Scopes covering an offset, innermost first.
 *
 * Nesting is containment, so the narrower region is the inner one. Two regions
 * can share a span — the prelude layer and the module's own both govern the
 * whole file — and there the later-recorded one is inner, which is why the
 * resolver registers the prelude first.
 */
function regionsAt(
  scopes: readonly Resolved.ScopeRegion[],
  offset: number,
  text: string,
): readonly Resolved.ScopeRegion[] {
  return scopes
    .map((region, index) => ({ region, index }))
    .filter(({ region }) => covers(region, offset, text))
    .sort((left, right) =>
      (left.region.span.end.offset - left.region.span.start.offset) -
        (right.region.span.end.offset - right.region.span.start.offset) ||
      right.index - left.index
    )
    .map(({ region }) => region);
}

/**
 * Whether a scope reaches an offset.
 *
 * A region ends at its last *token*, which is not where a user asks for
 * completion. Pressing Enter inside a function puts the cursor past the end of
 * every region that matters — on whitespace no tree has any reason to describe —
 * and that is the single most common place this request comes from. So a region
 * also reaches an offset separated from its end by nothing but whitespace.
 *
 * The indent test is what keeps that from reaching too far. Between two
 * top-level declarations everything is whitespace too, and without it the first
 * one's locals would be offered while writing the second. A cursor indented at
 * least as far as the region began is inside it in the only sense Hexagon has;
 * one further left has left it.
 *
 * The indent is read from the line the region *starts* on rather than from the
 * region's own column, which is not the construct's indent: a lambda's span
 * begins at its parameter list, so `fun tint(value: Int)` opens a region in
 * column eight while the declaration plainly sits in column zero.
 */
function covers(region: Resolved.ScopeRegion, offset: number, text: string): boolean {
  const { start, end } = region.span;
  if (offset >= start.offset && offset <= end.offset) return true;
  if (offset < start.offset || offset > text.length) return false;
  if (!/^\s*$/.test(text.slice(end.offset, offset))) return false;
  const indent = indentOfLineAt(text, start.offset);
  const column = columnAt(text, offset);
  // A body's own start column is where its contents sit, so a cursor there is
  // inside it. A construct that begins with a head — a match arm, a lambda —
  // sits *at* that column itself, so a cursor there is writing the next one:
  // after `zero => zero`, a cursor back at the arm's column is a new arm, and
  // the previous arm's binder has gone out of scope.
  return region.body ? column >= indent : column > indent;
}

function columnAt(text: string, offset: number): number {
  return offset - lineStartAt(text, offset);
}

function lineStartAt(text: string, offset: number): number {
  return text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

/**
 * How far the line holding an offset is indented.
 *
 * Compared against rather than the region's own column, which is not the
 * construct's indent: a lambda's span begins at its parameter list, so
 * `fun tint(value: Int)` starts a region in column eight while the declaration
 * plainly sits in column zero. Reading the indentation of the line it starts on
 * asks the question layout would ask.
 */
function indentOfLineAt(text: string, offset: number): number {
  const lineStart = lineStartAt(text, offset);
  const line = text.slice(lineStart, text.indexOf("\n", lineStart) + 1 || undefined);
  return line.length - line.trimStart().length;
}

function membersOf(qualifier: string, input: CompletionInput): readonly Completion[] {
  const named = input.resolved.moduleAliases.find(({ alias }) => alias === qualifier);
  // A qualifier that names no module is answered with nothing rather than with
  // everything in scope: the user has said which module they mean, and a list
  // ignoring that is a list of wrong answers.
  if (named === undefined) return [];
  return sorted(
    named.members.map(({ name, symbol }) => ofSymbol(name, symbol, input.facts)),
  );
}

function ofSymbol(
  name: string,
  symbol: Resolved.SymbolId,
  facts: ReadonlyMap<number, SymbolFacts>,
): Completion {
  const known = facts.get(Number(symbol));
  if (known === undefined) return { name, kind: "value" };
  return { name, kind: kindOf(known), detail: known.displayedType };
}

function kindOf(facts: SymbolFacts): CompletionKind {
  switch (facts.kind) {
    case "fun":
      return "function";
    case "parameter":
      return "parameter";
    case "constructor":
    case "record-constructor":
      return "constructor";
    case "constraint-member":
    case "let":
    case "var":
    case "pattern":
    case "extern":
      // The binder form does not say whether a name holds a function; the
      // checker's type does. See `SymbolFacts`.
      return facts.functionValued ? "function" : "value";
  }
}

/**
 * Every type name this module can write, local and imported alike. The tables
 * carry both, which is what makes an imported type offerable without asking the
 * import list what it brought in.
 */
function typeNames(resolved: Resolved.Module): readonly { readonly name: string }[] {
  return [
    ...resolved.unions.map(({ name }) => ({ name })),
    ...resolved.records.map(({ name }) => ({ name })),
    ...resolved.externTypes.map(({ localName }) => ({ name: localName })),
  ];
}

function sorted(completions: readonly Completion[]): readonly Completion[] {
  return [...completions].sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The module name a qualified completion is being asked about, if this offset is
 * behind one.
 *
 * Read backwards from the cursor: over the partial name being typed, then a dot,
 * then the identifier before it. The forms that merely contain a dot are turned
 * away by that scan rather than by cases of their own — `..` because a dot is
 * not an identifier character, so the range operator leaves nothing before it,
 * and `1.5` because a digit is not an identifier *start*.
 */
export function qualifierAt(text: string, offset: number): string | undefined {
  const cursor = Math.max(0, Math.min(offset, text.length));
  const afterDot = skipSpace(text, identifierStartBefore(text, cursor));
  const dot = codePointBefore(text, afterDot);
  if (dot?.character !== ".") return undefined;
  const end = skipSpace(text, dot.start);
  const start = identifierStartBefore(text, end);
  if (start === end) return undefined;
  const qualifier = text.slice(start, end);
  // The scan walked over identifier *continue* characters, which include digits.
  // Requiring a valid start rejects `1.` before it can be read as a module.
  const first = String.fromCodePoint(qualifier.codePointAt(0)!);
  return isIdentifierStart(first) ? qualifier : undefined;
}

function skipSpace(text: string, at: number): number {
  let start = at;
  for (;;) {
    const previous = codePointBefore(text, start);
    if (previous === undefined || !/^[ \t]$/.test(previous.character)) return start;
    start = previous.start;
  }
}
