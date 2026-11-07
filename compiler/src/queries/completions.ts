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
 * ## Three shapes of request
 *
 * **After a value's dot** — `p.x`, a half-typed `v.ma`, mid-chain
 * `v.map(f).fi` — lists what that dot consults (Method Syntax §8.4), and it is
 * the one answer here that is not about names in scope at all: a dot is
 * type-directed, never lexical (§1). So it is read from `Typed.Module.dotSites`,
 * the checker's own judgment written down at the dot — whether the text decides
 * the receiver, and the one candidate set the dot resolves against — never from
 * the receiver's final solved type, which a later line can have learned after
 * the dot already refused it (§3.5). A dot nothing follows yet (`q.`) is kept
 * by the parser with an empty name, so it has its record like any other; one
 * whose receiver is a module (`Vector.`) is the qualifier reading's, below.
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

import type * as Source from "../support/source.js";
import type * as Resolved from "../syntax/resolved/index.js";
import * as Typed from "../syntax/typed/index.js";
import {
  codePointBefore,
  identifierStartBefore,
  isIdentifierStart,
} from "../support/identifiers.js";
import { isCompilerMinted } from "../support/synthetic.js";
import type { DocumentationIndex } from "./documentation.js";
import type { SymbolFacts } from "./symbol-facts.js";

export type CompletionKind =
  | "value"
  | "function"
  | "parameter"
  | "constructor"
  | "type"
  | "module"
  /** A field after a value's dot: a record's, a row's, or a tuple's `itemN`. */
  | "field"
  /** An exported operation of the receiver type's companion (Method Syntax §4.2). */
  | "operation"
  /** A constraint member the dot reaches (Method Syntax §4.2, §8.4). */
  | "member";

export interface Completion {
  readonly name: string;
  readonly kind: CompletionKind;
  /** The checker's type, for the ones that have one. */
  readonly detail?: string;
  /**
   * The declaration's documentation as Markdown (`spec/doc-comments.md` §8),
   * for the ones that carry any.
   */
  readonly documentation?: string;
  /** For a `member`, the constraint whose member it is (§8.4: "marked as members"). */
  readonly constraint?: string;
  /**
   * For a `member`, a tower member the receiver's type owns without honoring
   * its rung (Method Syntax §4.2's ownership clause): the call takes a written
   * face, as the operator does (§8.4).
   */
  readonly needsFace?: true;
}

/**
 * Method Syntax §8.4's marks, as an editor shows them beside the label: a
 * member says whose member it is, and a tower member the receiver's type owns
 * without honoring its rung says it needs a written type, as the operator does.
 * Plain text, and one spelling for the language server and the Playground.
 */
export function completionMark(
  completion: Pick<Completion, "constraint" | "needsFace">,
): string | undefined {
  if (completion.constraint === undefined) return undefined;
  const whose = `${completion.constraint} member`;
  return completion.needsFace === true ? `${whose}, needs a written type` : whose;
}

export interface CompletionInput {
  /** The file's text, for reading the partial name at the cursor. */
  readonly text: string;
  readonly offset: number;
  readonly resolved: Resolved.Module;
  readonly facts: ReadonlyMap<number, SymbolFacts>;
  readonly docs: DocumentationIndex;
  /**
   * The checked module at the cursor, whose colour scopes decide how a
   * captured colour displays there (Effects §10, #873). Absent when checking
   * produced none; the detail is then the location-blind display.
   */
  readonly typed?: Pick<Typed.Module, "fileId" | "colourOwners" | "dotSites">;
}

export function collectCompletions(input: CompletionInput): readonly Completion[] {
  // A comment cannot contain code, so nothing belongs here. Strings are left
  // alone deliberately: one can hold an interpolation, where names *do* belong,
  // and telling the two apart needs the token stream rather than the text.
  if (input.resolved.comments.some((comment) => inComment(input.offset, comment))) return [];
  // After a value's dot the checker has already said what the dot consults,
  // so that is the whole answer — including where it is nothing at all.
  const site = dotSiteAt(input);
  if (site !== undefined) return afterDot(site, input);
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
      // binds one — but `__` is refused in every Hexagon name seat (Lexer §3.2),
      // so offering one hands the user a name they cannot type.
      if (isCompilerMinted(binding.name)) continue;
      found.set(binding.name, ofSymbol(binding.name, binding.symbol, input.facts, cursorColours(input)));
    }
  }
  for (const { name, span } of typeNames(input.resolved)) {
    if (!found.has(name)) found.set(name, ofType(name, span, input.docs));
  }
  for (const { alias } of input.resolved.moduleAliases) {
    if (!found.has(alias)) found.set(alias, { name: alias, kind: "module" });
  }
  return sorted([...found.values()]);
}

/**
 * Whether an offset is being typed inside a comment.
 *
 * Exclusive at the start, since a cursor at the opening delimiter is in front of
 * the comment. At the end it turns on whether the comment was *closed*, which is
 * not the same as whether it is a block. A closed block's span runs one past its
 * `*)`, so an offset there is already outside it — but an unterminated one runs
 * to the end of the file, and that last offset is exactly where the caret sits
 * while the comment is still being typed. A line comment is never closed by a
 * delimiter; its span stops at the newline, and the offset before that newline
 * is still inside it.
 *
 * Closure is counted rather than read off the last two characters, because block
 * comments nest: `(* outer (* inner *)` ends in `*)` and is not closed.
 */
function inComment(offset: number, comment: Source.Comment): boolean {
  if (offset <= comment.span.start.offset) return false;
  return closed(comment)
    ? offset < comment.span.end.offset
    : offset <= comment.span.end.offset;
}

function closed(comment: Source.Comment): boolean {
  if (comment.kind !== "Block") return false;
  let depth = 0;
  for (let at = 0; at < comment.text.length - 1; at += 1) {
    const pair = comment.text.slice(at, at + 2);
    if (pair === "(*") depth += 1;
    else if (pair === "*)") depth -= 1;
    else continue;
    at += 1;
  }
  return depth === 0;
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

/**
 * The dot whose name the cursor is in, where the checker met one: from just
 * after the dot to the end of whatever name has been typed after it.
 *
 * Read from the checked tree rather than from text, unlike the module
 * qualifier below, because what a *value* is cannot be read from text: only the
 * dot's own judgment says which candidates it consults (Method Syntax §8.4).
 */
function dotSiteAt(input: CompletionInput): Typed.DotSite | undefined {
  const typed = input.typed;
  if (typed === undefined) return undefined;
  return typed.dotSites.find(({ name }) =>
    Number(name.fileId) === Number(typed.fileId) &&
    input.offset >= name.start.offset && input.offset <= name.end.offset
  );
}

/**
 * Method Syntax §8.4: what the dot resolves against, and nothing else (§11.2).
 *
 * A dot whose subject the text does not decide offers no companion operation
 * and no member, only the fields a bare read reaches there. Not the names in
 * scope, which a dot never consults (§1, "this is not UFCS"), and not a guess
 * from the type inference later settled on, which the dot has already refused
 * to read (§3.5) — the refusal's own message says what to write.
 */
function afterDot(site: Typed.DotSite, input: CompletionInput): readonly Completion[] {
  const colours = cursorColours(input);
  return sorted(site.candidates.map((candidate): Completion => {
    switch (candidate.kind) {
      case "Field": {
        const documentation = input.docs.at(candidate.declaration);
        return {
          name: candidate.name,
          kind: "field",
          detail: detailOf(candidate.scheme, colours),
          ...(documentation === undefined ? {} : { documentation }),
        };
      }
      case "Operation":
        return { ...ofSymbol(candidate.name, candidate.symbol, input.facts, colours), kind: "operation" };
      case "Member":
        return {
          ...ofSymbol(candidate.name, candidate.symbol, input.facts, colours),
          kind: "member",
          constraint: candidate.constraint,
          ...(candidate.needsFace === undefined ? {} : { needsFace: true }),
        };
    }
  }));
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

/**
 * Effects §10 at the completion cursor (#873): the location is where the name
 * would be written, so the nearest signature is the cursor's.
 */
function cursorColours(input: CompletionInput): Typed.ColourContext | undefined {
  return input.typed === undefined
    ? undefined
    : Typed.colourContextAt(input.typed);
}

function ofSymbol(
  name: string,
  symbol: Resolved.SymbolId,
  facts: ReadonlyMap<number, SymbolFacts>,
  colours?: Typed.ColourContext,
): Completion {
  const known = facts.get(Number(symbol));
  if (known === undefined) return { name, kind: "value" };
  return {
    name,
    kind: kindOf(known),
    detail: detailOf(known.scheme, colours),
    ...(known.documentation === undefined ? {} : { documentation: known.documentation }),
  };
}

/**
 * The type as hover shows it, with the gloss beside it (Effects §10), the
 * detail being one line of plain text: a module with no callback colours
 * glosses a face too.
 */
function detailOf(scheme: Typed.Scheme, colours: Typed.ColourContext | undefined): string {
  const face = Typed.displayFace(scheme, colours);
  return [face.type, ...face.owners.map((owner) => owner.replaceAll("`", ""))].join(" — ");
}

/**
 * A type name, documented by the declaration it names. Types have no symbol, so
 * their documentation is reached by span rather than through `SymbolFacts` —
 * and by whichever span the table kept, which is the name for a union or a
 * record and the whole declaration for an `extern type`.
 */
function ofType(
  name: string,
  span: Source.Span,
  docs: DocumentationIndex,
): Completion {
  const documentation = docs.at(span);
  return {
    name,
    kind: "type",
    ...(documentation === undefined ? {} : { documentation }),
  };
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
 *
 * Each comes with the span its own table kept, for documentation to be looked
 * up by: a union's span *is* its name, a record's name is on its constructor
 * binding, and an `extern type` has kept only its whole declaration — which is
 * the other key `DocumentationIndex` answers to.
 *
 * A record's own `span` would answer as well, since the resolver copies the
 * item's span into the table (`resolver.ts`, `span: item.span`) and that is the
 * offset the doc block targets. The constructor's is used anyway, because it is
 * the same key `ofSymbol` reaches the record by, and one of the two has to be
 * the answer when a later change makes them disagree.
 */
function typeNames(
  resolved: Resolved.Module,
): readonly { readonly name: string; readonly span: Source.Span }[] {
  return [
    ...resolved.unions.map(({ name, span }) => ({ name, span })),
    ...resolved.records.map((record) => ({ name: record.name, span: record.constructor.span })),
    ...resolved.externTypes.map(({ localName, span }) => ({ name: localName, span })),
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
