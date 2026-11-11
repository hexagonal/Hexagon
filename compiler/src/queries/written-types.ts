/**
 * Compiler-owned source query: the inferred type written down where an inlay
 * hint stands, and a written type removed where one would stand
 * (WRITE-DOWN-TYPES.md, ruled: decision 1 (b), decision 2 (a), readings 1 to 5).
 *
 * - **Write down the inferred type**, on one place: a parameter of a function
 *   or lambda, a `let` or `var`, a header's result (from its `)` to its `=`),
 *   or a binder list (on the name or `fun` keyword it follows). It writes what
 *   the hint there shows, letters included (a row's tail the hint leaves
 *   unlettered takes a letter), each type and constraint spelled as this
 *   module names it (`spellType`, `spellConstraint`). A `let` pattern's
 *   variable has a hint but no place for a type, and is refused.
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
 * written where, and refuses, with the reason, a type holding an error, one
 * this module cannot spell, and a declaration that does not check.
 *
 * Only what is asked for at the caret, or where a selection starts, is
 * offered, as a hint is asked for where it stands.
 */

import type * as Diagnostics from "../support/diagnostics.js";
import type * as Source from "../support/source.js";
import type * as LaidOut from "../syntax/laid-out/index.js";
import type * as Lexed from "../syntax/lexed/index.js";
import type * as Parsed from "../syntax/parsed/index.js";
import type * as Resolved from "../syntax/resolved/index.js";
import * as Typed from "../syntax/typed/index.js";
import { type PieceRole, type TypePiece, typePieces } from "./inlay-hints.js";
import { unsettledDeclaration } from "./return-annotation.js";
import { spellConstraint, spellType, type TypeNames, typeNamesOf, unspellable, VariableNames } from "./type-spelling.js";

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
  /**
   * The caret, or where a selection starts. Only what is asked for there is
   * offered, as a hint is asked for where it stands: each offer is checked by
   * compiling it, so a selection across a module would compile it once for
   * every place it holds.
   */
  readonly offset: number;
  /** The file a module of this full name was compiled from (Packages §2.3). */
  readonly fileOfModule?: (moduleName: string) => Source.FileId | undefined;
}

export type WrittenTypeRefactoring =
  | {
    readonly title: string;
    /** In this file's offsets, none overlapping. */
    readonly edits: readonly { readonly start: number; readonly end: number; readonly replacement: string }[];
    /** What the check's refusal says it was doing: "writing `: Int`". */
    readonly doing: string;
    readonly disabled?: undefined;
  }
  | { readonly title: string; readonly edits?: undefined; readonly disabled: string };

export function writtenTypeRefactorings(input: WrittenTypesInput): readonly WrittenTypeRefactoring[] {
  const { lexed, offset } = input;
  const { unwritten, written } = typePieces({
    parsed: input.parsed,
    typed: input.typed,
    lexed,
    range: { start: offset, end: offset },
  });
  const holds = (span: Source.Span): boolean => span.start.offset <= offset && offset <= span.end.offset;
  let names: TypeNames | undefined;
  const spelling = (): TypeNames => names ??= typeNamesOf(input.resolved, input.fileOfModule);
  // Every declaration a piece is part of must check: each member's, for a block's head.
  const unsettledAt = (places: readonly Source.Span[]): string | undefined => {
    for (const place of places) {
      const refused = unsettled(input, place);
      if (refused !== undefined) return refused;
    }
    return undefined;
  };

  const found: WrittenTypeRefactoring[] = [];
  const write = (title: string, pieces: readonly TypePiece[], doing: string | undefined): void => {
    const refused = unsettledAt(pieces.flatMap(({ places }) => places));
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
      piece.inserts.forEach(({ offset: at, label }, index) => {
        const last = index === piece.inserts.length - 1;
        edits.push({ start: at, end: at, replacement: last ? text.label : label });
      });
    }
    found.push({
      title,
      edits: edits.sort((left, right) => left.start - right.start),
      doing: doing ?? `writing \`${texts.join("")}\``,
    });
  };

  for (const piece of unwritten) {
    if (!holds(piece.anchor)) continue;
    const title = writeTitle(piece.role, piece.name);
    // The hint shows a pattern's variable's type, but the grammar has no
    // place for one: a pattern destructures a value (Pattern Matching §2.4).
    if (piece.role === "pattern") found.push({ title, disabled: PATTERN_REFUSAL });
    else write(title, [piece], undefined);
  }
  // A whole header, on its name, where two or more of its places are unwritten.
  const headers = new Map<number, TypePiece[]>();
  for (const piece of unwritten) {
    if (piece.header === undefined || !holds(piece.header)) continue;
    const pieces = headers.get(piece.header.start.offset) ?? [];
    pieces.push(piece);
    headers.set(piece.header.start.offset, pieces);
  }
  for (const pieces of headers.values()) {
    const { start, end } = pieces[0]!.header!;
    const name = lexed.text.slice(start.offset, end.offset);
    if (pieces.length >= 2) write(HEADER_TITLE, pieces, `writing the types of \`${name}\`'s header`);
  }

  for (const piece of written) {
    if (piece.exported || !piece.anchors.some(holds)) continue;
    const title = removeTitle(piece.role, piece.name);
    const refused = unsettledAt(piece.places);
    if (refused !== undefined) {
      found.push({ title, disabled: refused });
      continue;
    }
    const { start, end } = piece.removed;
    found.push({
      title,
      edits: [{ start, end, replacement: "" }],
      doing: `removing \`${lexed.text.slice(start, end).trim()}\``,
    });
  }
  return found;
}

/**
 * A piece's text as this module spells it: its type through `spellType`,
 * lettered as the hint is, and what stands around it in the hint's label. A
 * binder list's entries are written as the hint shows them, each constraint
 * spelled as this module names it (`spellConstraint`).
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
  let entries: string | undefined;
  if (piece.entries !== undefined) {
    const { list, before, after } = piece.entries;
    const texts: string[] = [];
    for (const { subject, constraints } of list) {
      const spellings: string[] = [];
      for (const constraint of constraints) {
        const spelling = spellConstraint(constraint, names());
        if (unspellable(spelling)) return { refused: spelling.unspellable };
        spellings.push(spelling.text);
      }
      texts.push(`${subject}: ${spellings.length === 1 ? spellings[0] : `(${spellings.join(", ")})`}`);
    }
    entries = `${before}${texts.join(", ")}${after}`;
  }
  if (piece.shown === undefined) {
    const label = entries ?? piece.inserts.at(-1)!.label;
    return { label, written: label };
  }
  const variables = new VariableNames();
  for (const [id, letter] of piece.letters.letter([])) variables.bind(id, letter);
  variables.choose(piece.shown.scheme.callersChoice ?? []);
  if (piece.role === "parameter") variables.choose(Typed.collectEffectVariables(piece.shown.type));
  const text = spellType(piece.shown.type, names(), variables);
  if (unspellable(text)) return { refused: text.unspellable };
  const before = entries ?? piece.shown.before;
  const { after } = piece.shown;
  return { label: `${before}${text.text}${after}`, written: `${before}${text.text}`.trim() };
}

/**
 * Why the declaration a span is in does not check, if it does not: the module
 * item holding it, as `unsettledDeclaration` asks of "Infer return type"'s,
 * and, for a member of a `fun` block, every member, since members are checked
 * together (Functions §7.3): one that does not check leaves its siblings'
 * types unsettled too.
 */
function unsettled(input: WrittenTypesInput, span: Source.Span): string | undefined {
  const item = input.parsed.items.find((each) =>
    each.span.start.offset <= span.start.offset && span.end.offset <= each.span.end.offset
  );
  if (item === undefined) return undefined;
  const block = item.kind === "Fun" ? item.block : undefined;
  if (block === undefined) return unsettledItem(input, item);
  for (const member of input.parsed.items) {
    if (member.kind !== "Fun" || member.block?.id !== block.id) continue;
    const refused = unsettledItem(input, member);
    if (refused !== undefined) return refused;
  }
  return undefined;
}

function unsettledItem(input: WrittenTypesInput, item: Parsed.Item): string | undefined {
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
