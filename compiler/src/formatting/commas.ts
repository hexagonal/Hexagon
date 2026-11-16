/**
 * The trailing commas Format document adds (Canonical Layout §14).
 *
 * A comma goes after the last item of every list in open brackets: a pair of
 * `()`, `[]` or `{}`, or the `<` and `>` of a list, whose closing bracket
 * begins a line (§5.2). Not every such pair holds a list. Parentheses that
 * group one item and the brackets of an index hold none, and a comma after an
 * item that ends in a block would be read inside the block (Lexer & Layout §7).
 * The parser refuses a comma in each of those places, at the comma, so the
 * parser decides: a comma is added where it reads as a trailing comma and
 * leaves the tree as it was, and nowhere else.
 */

import { read, sameTree, type Reading } from "./analysis.js";
import * as Spacing from "./spacing.js";

const openers = new Set<string>(["LeftParen", "LeftBracket", "LeftBrace"]);
const closers = new Set<string>(["RightParen", "RightBracket", "RightBrace"]);

/** Adds §14's trailing commas to a document that parses. */
export function addCommas(text: string): string {
  const reading = read(text);
  if (reading.syntaxError) return text;
  return insert(text, accepted(reading));
}

/**
 * The tokens §14 would put a trailing comma after, by index: what a line's
 * length counts whether or not the comma is written (§9.2).
 */
export function commaSites(reading: Reading): ReadonlySet<number> {
  const known = sitesCache.get(reading);
  if (known !== undefined) return known;
  const offsets = new Set(accepted(reading));
  const sites = new Set<number>();
  reading.lexed.tokens.forEach(({ span }, index) => {
    if (offsets.has(span.end.offset)) sites.add(index);
  });
  sitesCache.set(reading, sites);
  return sites;
}

const sitesCache = new WeakMap<Reading, ReadonlySet<number>>();

/** The offsets at which the parser takes the wanted commas as trailing commas. */
function accepted(reading: Reading): number[] {
  if (reading.syntaxError) return [];
  return settle(reading, reading.text, candidates(reading));
}
/**
 * Where a comma would go: directly after the last token of each list whose
 * closing bracket begins its line and has no comma before it, as UTF-16
 * offsets, in order.
 */
function candidates(reading: Reading): number[] {
  const tokens = reading.lexed.tokens.filter(({ kind }) => kind !== "Eof");
  const roles = Spacing.roles(tokens, new Set());
  const offsets: number[] = [];
  const stack: number[] = [];
  const consider = (open: number, close: number): void => {
    if (close - open < 2) return;
    const before = tokens[close - 1]!;
    if (before.kind === "Comma") return;
    // The closing bracket begins its line.
    if (before.span.end.line >= tokens[close]!.span.start.line) return;
    offsets.push(before.span.end.offset);
  };
  tokens.forEach(({ kind }, index) => {
    if (openers.has(kind)) stack.push(index);
    else if (closers.has(kind)) {
      const open = stack.pop();
      if (open !== undefined) consider(open, index);
    }
  });
  // A `<…>` list: its `<` and `>` are the ones spacing reads as a binder or
  // type-argument list's.
  const angles: number[] = [];
  tokens.forEach((_, index) => {
    if (roles.binderOpen.has(index)) angles.push(index);
    else if (roles.binderClose.has(index)) {
      const open = angles.pop();
      if (open !== undefined) consider(open, index);
    }
  });
  return [...new Set(offsets)].sort((left, right) => left - right);
}

/** Inserts commas at the given offsets, in order. */
function insert(text: string, offsets: readonly number[]): string {
  let out = "";
  let from = 0;
  for (const offset of offsets) {
    out += text.slice(from, offset) + ",";
    from = offset;
  }
  return out + text.slice(from);
}

/**
 * As many of the wanted commas as the parser takes as trailing commas, as
 * offsets in `text`. All at once where it takes them all; otherwise the commas
 * it refuses at their own place are set aside and the rest tried again, and
 * where a refusal cannot be placed, each half in turn.
 */
function settle(base: Reading, text: string, wanted: readonly number[]): number[] {
  if (wanted.length === 0) return [];
  const reading = read(insert(text, wanted));
  if (!reading.syntaxError && sameTree(base, reading)) return [...wanted];
  if (wanted.length === 1) return [];
  // Each comma's offset in the attempt, shifted by the commas before it.
  const refused = new Set(errorOffsets(reading));
  const kept = wanted.filter((offset, position) => !refused.has(offset + position));
  if (kept.length < wanted.length) return settle(base, text, kept);
  const half = Math.ceil(wanted.length / 2);
  const first = settle(base, text, wanted.slice(0, half));
  // The second half is tried with the first half's commas in place.
  const second = settle(base, insert(text, first), wanted.slice(half).map((offset) => offset + first.length));
  return [...first, ...second.map((offset) => offset - first.length)];
}

function errorOffsets(reading: Reading): number[] {
  const diagnostics = [
    ...reading.laidOut.diagnostics,
    ...reading.modules.flatMap(({ diagnostics: found }) => found),
  ];
  return diagnostics
    .filter(({ severity }) => severity === "error")
    .map(({ primary }) => primary.start.offset);
}
