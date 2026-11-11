/**
 * Compiler-owned source query: the inferred type written down where an inlay
 * hint stands, and a written type removed where one would stand
 * (WRITE-DOWN-TYPES.md, ruled: decision 1 (b), decision 2 (a), readings 1 to 5).
 *
 * - **Write down the inferred type**, on one place: a parameter of a function
 *   or lambda, a `let` or `var`, a `let` pattern's variable, a header's result
 *   (from its `)` to its `=`), or a binder list (on the name or `fun` keyword
 *   it follows). It writes what the hint there shows, letters included, each
 *   type spelled as this module names it (`spellType`).
 * - **Write down this header's types**, on a function's name where two or more
 *   of its places are unwritten: all of them, in one edit, checked once.
 * - **Remove the written type**, on a written type at any of those places:
 *   the reverse. Never on an exported term's, whose signature Modules §4.1.1
 *   requires whole.
 *
 * Refactorings, never fixes: only when asked, and never preferred. "Infer
 * return type" stays the fix for an exported function's missing result.
 *
 * A written type binds (plan point 3): a variable written in an annotation is
 * rigid while its definition is checked (Functions §4.1), so writing one can
 * change what a definition means, and removing one hands the decision from the
 * text to inference. So each edit is checked by compiling it (plan point 4),
 * which is the session's part (`#verifyWrittenTypes`): this says what is
 * written where, which names' types must stay as they are, and refuses, with
 * the reason, a type holding an error, one this module cannot spell, and a
 * declaration that does not check.
 */

import type * as Diagnostics from "../support/diagnostics.js";
import type * as Source from "../support/source.js";
import type * as LaidOut from "../syntax/laid-out/index.js";
import type * as Lexed from "../syntax/lexed/index.js";
import type * as Parsed from "../syntax/parsed/index.js";
import type * as Resolved from "../syntax/resolved/index.js";
import * as Typed from "../syntax/typed/index.js";
import { type PieceRole, type TypePiece, typePieces, type WrittenPiece } from "./inlay-hints.js";
import { unsettledDeclaration } from "./return-annotation.js";
import { spellType, type TypeNames, typeNamesOf, unspellable, VariableNames } from "./type-spelling.js";

export const HEADER_TITLE = "Write down this header's types";

export const PATTERN_REFUSAL =
  "a pattern's variable takes no written type: patterns destructure values, so write the type outside the pattern";

/** "Write down the inferred …" for one place, by what it is. */
export function writeTitle(role: PieceRole, name: string | undefined): string {
  return `Write down the inferred ${what(role, name)}`;
}

/** "Remove the written …" for one place, by what it is. */
export function removeTitle(role: PieceRole, name: string | undefined): string {
  return `Remove the written ${what(role, name)}`;
}

function what(role: PieceRole, name: string | undefined): string {
  const of = name === undefined ? "this `fun` block" : `\`${name}\``;
  switch (role) {
    case "result":
      return `result type of ${of}`;
    case "binder":
      return `binder list of ${of}`;
    default:
      return `type of ${of}`;
  }
}

export interface WrittenTypesInput {
  readonly parsed: Parsed.Module;
  readonly typed: Typed.Module;
  readonly resolved: Resolved.Module;
  /** This module's file, lexed and laid out: where each piece goes, and whether its declaration parsed. */
  readonly lexed: Lexed.File;
  readonly laidOut: LaidOut.File;
  /** This file's diagnostics: whether the declaration checks. */
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
  /** The caret or selection, ends included. */
  readonly start: number;
  readonly end: number;
  /** The file a module of this full name was compiled from (Packages §2.3). */
  readonly fileOfModule?: (moduleName: string) => Source.FileId | undefined;
}

/** A name whose type the edit must leave as it is, and what to call it. */
export interface Kept {
  readonly offset: number;
  readonly name: string;
}

export type WrittenTypeRefactoring =
  | {
    readonly title: string;
    /** In this file's offsets, none overlapping. */
    readonly edits: readonly { readonly start: number; readonly end: number; readonly replacement: string }[];
    /** What the check's refusal says it was doing: "writing `: Int`". */
    readonly doing: string;
    /** The names whose own types are pieces of what is written or removed (reading 2's third clause). */
    readonly places: readonly Kept[];
    /** Every declaration of the module's, whose faces must stay as they are (reading 2's second clause). */
    readonly faces: readonly Kept[];
    readonly disabled?: undefined;
  }
  | { readonly title: string; readonly edits?: undefined; readonly disabled: string };

export function writtenTypeRefactorings(input: WrittenTypesInput): readonly WrittenTypeRefactoring[] {
  const { parsed, lexed, start, end } = input;
  const { unwritten, written } = typePieces({
    parsed: input.parsed,
    typed: input.typed,
    lexed,
    range: { start, end },
  });
  const touches = (span: Source.Span): boolean => span.start.offset <= end && start <= span.end.offset;
  let names: TypeNames | undefined;
  const spelling = (): TypeNames => names ??= typeNamesOf(input.resolved, input.fileOfModule);
  let faces: readonly Kept[] | undefined;
  const allFaces = (): readonly Kept[] => faces ??= facesOf(parsed);
  const kept = (pieces: readonly (TypePiece | WrittenPiece)[]): readonly Kept[] => {
    const found = new Map<number, Kept>();
    for (const piece of pieces) {
      for (const span of piece.places) found.set(span.start.offset, { offset: span.start.offset, name: lexed.text.slice(span.start.offset, span.end.offset) });
    }
    return [...found.values()];
  };

  const found: WrittenTypeRefactoring[] = [];
  const write = (title: string, pieces: readonly TypePiece[], doing: string | undefined): void => {
    // A `fun` block's head stands before its members, whose declarations it is part of.
    const refused = unsettled(input, pieces[0]!.places[0] ?? pieces[0]!.anchor);
    if (refused !== undefined) {
      found.push({ title, disabled: refused });
      return;
    }
    const edits: { start: number; end: number; replacement: string }[] = [];
    const texts: string[] = [];
    for (const piece of pieces) {
      const text = spelled(piece, spelling);
      if ("refused" in text) {
        found.push({ title, disabled: `the ${what(piece.role, piece.name)} cannot be written here: ${text.refused}` });
        return;
      }
      texts.push(text.written);
      piece.inserts.forEach(({ offset, label }, at) => {
        const last = at === piece.inserts.length - 1;
        edits.push({ start: offset, end: offset, replacement: last ? text.label : label });
      });
    }
    found.push({
      title,
      edits: edits.sort((left, right) => left.start - right.start),
      doing: doing ?? `writing \`${texts.join("")}\``,
      places: kept(pieces),
      faces: allFaces(),
    });
  };

  for (const piece of unwritten) {
    if (!touches(piece.anchor)) continue;
    const title = writeTitle(piece.role, piece.name);
    // The hint shows a pattern's variable's type, but the grammar has no
    // place for one: a pattern destructures a value (Pattern Matching §2.4).
    if (piece.role === "pattern") found.push({ title, disabled: PATTERN_REFUSAL });
    else write(title, [piece], undefined);
  }
  // A whole header, on its name, where two or more of its places are unwritten.
  const headers = new Map<number, TypePiece[]>();
  for (const piece of unwritten) {
    if (piece.header === undefined || !touches(piece.header)) continue;
    const pieces = headers.get(piece.header.start.offset) ?? [];
    pieces.push(piece);
    headers.set(piece.header.start.offset, pieces);
  }
  for (const pieces of headers.values()) {
    if (pieces.length >= 2) write(HEADER_TITLE, pieces, `writing the types of \`${pieces[0]!.name}\`'s header`);
  }

  for (const piece of written) {
    if (piece.exported || !piece.anchors.some(touches)) continue;
    const title = removeTitle(piece.role, piece.name);
    const refused = unsettled(input, piece.places[0] ?? piece.removed);
    if (refused !== undefined) {
      found.push({ title, disabled: refused });
      continue;
    }
    const { start: from, end: to } = { start: piece.removed.start.offset, end: piece.removed.end.offset };
    found.push({
      title,
      edits: [{ start: from, end: to, replacement: "" }],
      doing: `removing \`${lexed.text.slice(from, to).trim()}\``,
      places: kept([piece]),
      faces: allFaces(),
    });
  }
  return found;
}

/**
 * A piece's text as this module spells it: its type through `spellType`,
 * lettered as the hint is, and what stands around it in the hint's label. A
 * binder list's entries are written as the hint shows them.
 *
 * A parameter's arrows are written as the hint shows them (Effects §10): a
 * callback's arrow says what the function accepts, so a colour there that is
 * not a constant is the constant, `->!` for a callback the function follows;
 * the function's own colour is never written (Functions §4.1, #355). A result's
 * or a binding's arrow whose colour follows a callback, shown `>->`, is
 * refused, as "Infer return type" refuses it.
 */
function spelled(
  piece: TypePiece,
  names: () => TypeNames,
): { readonly label: string; readonly written: string } | { readonly refused: string } {
  const label = piece.inserts.at(-1)!.label;
  if (piece.shown === undefined) return { label, written: label };
  const variables = new VariableNames();
  for (const [id, letter] of piece.letters.letter([])) variables.bind(id, letter);
  variables.choose(piece.shown.scheme.callersChoice ?? []);
  if (piece.role === "parameter") variables.choose(Typed.collectEffectVariables(piece.shown.type));
  const text = spellType(piece.shown.type, names(), variables);
  if (unspellable(text)) return { refused: text.unspellable };
  const { before, after } = piece.shown;
  return { label: `${before}${text.text}${after}`, written: `${before}${text.text}`.trim() };
}

/**
 * Why the declaration a span is in does not check, if it does not: the module
 * item holding it, as `unsettledDeclaration` asks of "Infer return type"'s.
 */
function unsettled(input: WrittenTypesInput, span: Source.Span): string | undefined {
  const item = input.parsed.items.find((each) =>
    each.span.start.offset <= span.start.offset && span.end.offset <= each.span.end.offset
  );
  if (item === undefined) return undefined;
  const named = item.kind === "Fun" || item.kind === "Let" || item.kind === "Var" ? item : undefined;
  const value = named?.value;
  const body = value === undefined
    ? item.span.start.offset
    : value.kind === "Lambda"
      ? value.body.span.start.offset
      : value.span.start.offset;
  return unsettledDeclaration(input.diagnostics, input.lexed, input.laidOut, {
    who: named === undefined ? whoOf(item) : `\`${named.name.text}\``,
    from: item.span.start.offset,
    body,
    to: item.span.end.offset,
  });
}

function whoOf(item: Parsed.Item): string {
  return item.kind === "Honor" ? "this instance" : "this declaration";
}

/** Every name the module declares at its top, which the faces a check compares are the types of. */
function facesOf(parsed: Parsed.Module): readonly Kept[] {
  const found: Kept[] = [];
  const add = (name: Parsed.Name): void => {
    found.push({ offset: name.span.start.offset, name: name.text });
  };
  for (const item of parsed.items) {
    if (item.kind === "Fun" || item.kind === "Let" || item.kind === "Var") add(item.name);
    if (item.kind === "LetPattern") bindersOf(item.pattern, add);
  }
  return found;
}

/** Every name a pattern binds. */
function bindersOf(pattern: unknown, visit: (name: Parsed.Name) => void): void {
  if (Array.isArray(pattern)) {
    for (const each of pattern) bindersOf(each, visit);
    return;
  }
  if (typeof pattern !== "object" || pattern === null) return;
  const node = pattern as { readonly kind?: string; readonly name?: Parsed.Name };
  if ((node.kind === "Binding" || node.kind === "As") && node.name !== undefined) visit(node.name);
  for (const [field, child] of Object.entries(pattern)) {
    if (field !== "span" && field !== "name") bindersOf(child, visit);
  }
}
