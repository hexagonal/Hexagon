/**
 * Breaking a line longer than the Maximum line length (Canonical Layout §9),
 * or one holding a construct that Apply width limits spreads (§15).
 *
 * A break is a line end put before a token; the whitespace pass then writes the
 * new line's indentation by §5, as it would have written it had the author
 * broken the line there. Each break is kept only where the program parses to
 * the same tree afterwards (§9.3), so a structure that cannot be broken here
 * is left whole, and the next one tried. A line's length counts the trailing
 * comma §14 would add after its last token whether or not it is written, so a
 * line measures the same whatever Leave trailing commas as written says (§9.2);
 * the commas themselves are added once the lines are broken. It counts the
 * leading bar §16 would add in the same way.
 *
 * A line that holds a construct §15 spreads is broken in the same way as one
 * that is too long, outermost structure first, until that construct is no
 * longer on one line (§15.3). A union declaration, which §9 never breaks, is
 * spread by a shape of its own: its alternatives one to a line beneath its
 * `=`.
 */

import { differingItems, read, sameText, sameTree, scan, type Reading } from "./analysis.js";
import { barSites } from "./bars.js";
import { commaSites } from "./commas.js";
import * as Spacing from "./spacing.js";
import * as Whitespace from "./whitespace.js";
import { spreads, type Construct } from "./widths.js";
import type * as Lexed from "../syntax/lexed/index.js";

/** Binary operators by precedence level, loosest highest (Operators §3). */
const precedence = new Map<string, number>([
  ["Power", 3],
  ["Fraction", 5],
  ["Star", 6],
  ["Slash", 6],
  ["Plus", 7],
  ["Minus", 7],
  ["Concat", 7],
  ["band", 8],
  ["bxor", 9],
  ["bor", 10],
  ["Range", 11],
  ["EqualEqual", 12],
  ["NotEqual", 12],
  ["Less", 12],
  ["Greater", 12],
  ["LessEqual", 12],
  ["GreaterEqual", 12],
  ["And", 14],
  ["Or", 15],
  ["Implies", 16],
  ["Iff", 17],
]);

const openers = new Set(["LeftParen", "LeftBracket", "LeftBrace"]);
const closers = new Set(["RightParen", "RightBracket", "RightBrace"]);
const marks = new Set(["Bang", "Caret", "Tilde", "Question"]);

/** A way to break one line: line ends put before each of these tokens. */
interface Plan {
  /** The token that begins the line, which names it across rounds. */
  readonly line: number;
  readonly shape: string;
  readonly before: readonly number[];
  /** The breaks whose new line stands at the broken line's own column. */
  readonly level?: ReadonlySet<number>;
  /**
   * A trailing comma the plan removes: one after a last item that the plan
   * makes end in a block, where the grammar has no room for it (§14).
   */
  readonly removes?: number;
}

const MAXIMUM_ROUNDS = 10_000;

/**
 * Breaks each line longer than `limit`, which may be `Infinity`, and, where
 * `widths` asks, each line holding a construct that §15 spreads.
 */
export function breakLines(
  original: Reading,
  text: string,
  limit: number,
  options: Whitespace.Options,
  widths = false,
): string {
  let current = read(text);
  const failed = new Set<string>();
  for (let round = 0; round < MAXIMUM_ROUNDS; round += 1) {
    const reading = current;
    const spreading = widths ? spreads(reading) : [];
    const plans = linesToBreak(reading, limit, spreading)
      .map((line) => plan(reading, line, failed, limit, spreading))
      .filter((found): found is Plan => found !== undefined);
    if (plans.length === 0) return current.text;
    current = settle(original, current, plans, options, failed);
  }
  return current.text;
}

/**
 * Makes as many of the plans as keep the tree. All at once where they do;
 * otherwise the plans in the items whose trees changed are set aside and the
 * rest made together, and each set-aside plan is tried alone. Where the change
 * is not confined to items, each half is tried in turn. A plan that fails
 * alone is not made again, and its line tries its next structure.
 */
function settle(
  original: Reading,
  reading: Reading,
  plans: readonly Plan[],
  options: Whitespace.Options,
  failed: Set<string>,
): Reading {
  const made = attempt(original, reading, plans, options);
  if (made.kind === "Made") return made.reading;
  if (plans.length === 1) {
    failed.add(`${plans[0]!.line}:${plans[0]!.shape}`);
    return reading;
  }
  const suspects = made.suspects ?? [];
  const suspected = (one: Plan): boolean =>
    suspects.some(([first, last]) => first <= one.line && one.line <= last);
  const aside = plans.filter(suspected);
  if (aside.length > 0 && aside.length < plans.length) {
    let current = settle(original, reading, plans.filter((one) => !suspected(one)), options, failed);
    for (const one of aside) current = settle(original, current, [one], options, failed);
    return current;
  }
  const half = Math.ceil(plans.length / 2);
  const first = settle(original, reading, plans.slice(0, half), options, failed);
  return settle(original, first, plans.slice(half), options, failed);
}

/** Applies plans, rewrites the whitespace, and keeps the result only if the tree is the same. */
function attempt(
  original: Reading,
  reading: Reading,
  plans: readonly Plan[],
  options: Whitespace.Options,
): Attempt {
  const tokens = reading.lexed.tokens;
  const text = reading.text;
  const lines = lineStarts(text);
  const indentOf = (line: number): number => {
    let offset = lines[line]!;
    while (text[offset] === " ") offset += 1;
    return offset - lines[line]!;
  };
  const inserts: { readonly offset: number; readonly remove: number; readonly text: string }[] = [];

  // The rest of a broken line's item moves two levels deeper with it, so that
  // a block it holds stays deeper than the line that now owns it. A line in
  // the rest of several broken items moves for each. A conditional's breaks
  // leave its `if` where it is, so nothing after it moves. A loop's body
  // moves beneath its `do`, and its continuation lines move with it. A value
  // moved beneath its `=` that begins with `if` or `try` takes its clauses
  // (`else`, `catch`) with it.
  const shifts = new Map<number, number>();
  for (const one of plans) {
    if (one.shape === "conditional") continue;
    const line = tokens[one.line]!.span.start.line;
    // A value that begins with `if` or `try` owns the clauses after it.
    const owner = (one.shape === "value" || one.shape === "lambda") &&
      ["If", "Try"].includes(tokens[one.before[0]!]!.kind);
    for (const later of restOfItem(reading, lines, line, indentOf(line), owner)) {
      shifts.set(later, (shifts.get(later) ?? 0) + 2 * Whitespace.LEVEL);
    }
  }
  for (const [line, shift] of shifts) inserts.push({ offset: lines[line]!, remove: 0, text: " ".repeat(shift) });
  for (const one of plans) {
    if (one.removes === undefined) continue;
    const { start, end } = tokens[one.removes]!.span;
    inserts.push({ offset: start.offset, remove: end.offset - start.offset, text: "" });
  }

  for (const one of plans) {
    const line = tokens[one.line]!.span.start.line;
    const indent = indentOf(line) + (shifts.get(line) ?? 0);
    for (const index of one.before) {
      const token = tokens[index]!;
      const offset = token.span.start.offset;
      let gap = offset;
      while (gap > 0 && (text[gap - 1] === " " || text[gap - 1] === "\t")) gap -= 1;
      // A provisional indentation that keeps the line's place in the layout:
      // carried on, two levels deeper, except `else`, a comma after a block,
      // and a chain's links under a receiver that begins its line, which
      // stand at their item's. The whitespace pass then writes the line's own
      // (§5).
      const level = token.kind === "Else" || token.kind === "Comma" || one.level?.has(index) === true;
      const provisional = level ? indent : indent + 2 * Whitespace.LEVEL;
      inserts.push({ offset: gap, remove: offset - gap, text: "\n" + " ".repeat(provisional) });
    }
  }
  inserts.sort((left, right) => right.offset - left.offset);
  let broken = text;
  for (const insert of inserts) {
    broken = broken.slice(0, insert.offset) + insert.text + broken.slice(insert.offset + insert.remove);
  }

  const provisional = scan(broken);
  if (!sameText(original, provisional, false, false, true)) return { kind: "Failed" };
  if (provisional.syntaxError) return { kind: "Failed" };
  const written = Whitespace.write(provisional, options);
  if (written.kind !== "Written") return { kind: "Failed" };
  const result = read(written.text);
  if (result.syntaxError) return { kind: "Failed" };
  if (!sameTree(original, result)) {
    const suspects = differingItems(original, result);
    return suspects === undefined ? { kind: "Failed" } : { kind: "Failed", suspects };
  }
  return { kind: "Made", reading: result };
}

type Attempt =
  | { readonly kind: "Made"; readonly reading: Reading }
  | {
    readonly kind: "Failed";
    /** The top-level items, by token range, whose trees the plans changed, where that is known. */
    readonly suspects?: readonly (readonly [number, number])[];
  };

/**
 * The lines after a line that continue its item: those indented deeper, those
 * at its own column that begin by closing brackets, and, where `clauses` asks,
 * the clauses (`else`, `catch`) at its own column. A line inside a string is
 * the string's, and stays as it is.
 */
function restOfItem(
  reading: Reading,
  lines: readonly number[],
  line: number,
  indent: number,
  clauses: boolean,
): number[] {
  const text = reading.text;
  const { firstOnLine, insideString } = lineFacts(reading);
  const rest: number[] = [];
  for (let later = line + 1; later < lines.length; later += 1) {
    if (insideString.has(later)) continue;
    const start = lines[later]!;
    const end = later + 1 < lines.length ? lines[later + 1]! - 1 : text.length;
    const content = text.slice(start, end);
    if (content.trim() === "") continue;
    const own = /^ */u.exec(content)![0].length;
    const first = firstOnLine.get(later);
    const clause = clauses && own === indent && first !== undefined && first.span.start.offset === start + own &&
      (first.kind === "Else" || first.kind === "Catch" || first.kind === "Finally");
    // A line that begins by closing brackets at the item's column continues it.
    const closing = own === indent && first !== undefined && first.span.start.offset === start + own &&
      closers.has(first.kind);
    if (own <= indent && !clause && !closing) break;
    rest.push(later);
  }
  return rest;
}

interface LineFacts {
  readonly firstOnLine: ReadonlyMap<number, Lexed.Token>;
  readonly insideString: ReadonlySet<number>;
}

const factsOf = new WeakMap<Reading, LineFacts>();

/** Each line's first token, and the lines that begin inside a string. */
function lineFacts(reading: Reading): LineFacts {
  const known = factsOf.get(reading);
  if (known !== undefined) return known;
  const firstOnLine = new Map<number, Lexed.Token>();
  const insideString = new Set<number>();
  for (const token of reading.lexed.tokens) {
    if (!firstOnLine.has(token.span.start.line)) firstOnLine.set(token.span.start.line, token);
    if (token.kind === "String") {
      for (let inner = token.span.start.line + 1; inner <= token.span.end.line; inner += 1) insideString.add(inner);
    }
  }
  const facts = { firstOnLine, insideString };
  factsOf.set(reading, facts);
  return facts;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let offset = 0; offset < text.length; offset += 1) {
    if (text[offset] === "\n") starts.push(offset + 1);
  }
  return starts;
}

interface LongLine {
  /** Token indices of the code that begins on the line, first to last. */
  readonly first: number;
  readonly last: number;
  /** A union declaration on the line that §15 spreads. */
  readonly union?: Construct;
  /** A record declaration on the line that §15 spreads. */
  readonly record?: Construct;
}

/**
 * The lines to break: those longer than the limit, and those holding a
 * construct on one line that §15 spreads, in order.
 */
function linesToBreak(reading: Reading, limit: number, spreading: readonly Construct[]): LongLine[] {
  const long = longLines(reading, limit);
  if (spreading.length === 0) return long;
  const tokens = reading.lexed.tokens;
  const byLine = new Map<number, LongLine>();
  for (const line of long) byLine.set(tokens[line.first]!.span.start.line, line);
  for (const construct of spreading) {
    const line = tokens[construct.opens]!.span.start.line;
    let known = byLine.get(line);
    if (known === undefined) {
      let first = construct.opens;
      while (first > 0 && tokens[first - 1]!.span.start.line === line) first -= 1;
      let last = construct.opens;
      while (tokens[last + 1] !== undefined && tokens[last + 1]!.kind !== "Eof" &&
        tokens[last + 1]!.span.start.line === line) last += 1;
      // Where several items share a line, only the last is broken (§9.3), so
      // a construct in an earlier one stays on its line (§15.3).
      if (construct.opens < lastItemStart(tokens, first, last)) continue;
      known = { first, last };
    }
    if (construct.kind === "union" && known.union === undefined) known = { ...known, union: construct };
    if (construct.kind === "record declaration" && known.record === undefined) known = { ...known, record: construct };
    byLine.set(line, known);
  }
  return [...byLine.values()].sort((left, right) => left.first - right.first);
}

/**
 * The first token of the last of the items a line holds, separated by `;`,
 * which stands only between the items of a block, never inside brackets.
 */
function lastItemStart(tokens: readonly Lexed.Token[], first: number, last: number): number {
  let start = first;
  for (let index = first; index <= last; index += 1) {
    if (tokens[index]!.kind === "Semicolon") start = index + 1;
  }
  return start;
}

/**
 * The lines whose code runs past the limit (§9.2): a trailing comment does not
 * count, and the trailing comma §14 would add does.
 */
function longLines(reading: Reading, limit: number): LongLine[] {
  const tokens = reading.lexed.tokens.filter(({ kind }) => kind !== "Eof");
  const text = reading.text;
  const sites = commaSites(reading);
  const bars = barSites(reading);
  const found: LongLine[] = [];
  let index = 0;
  while (index < tokens.length) {
    const line = tokens[index]!.span.start.line;
    let last = index;
    while (last + 1 < tokens.length && tokens[last + 1]!.span.start.line === line) last += 1;
    const end = tokens[last]!.span.end;
    if (end.line === line) {
      const lineStart = end.offset - end.column;
      const length = [...text.slice(lineStart, end.offset)].length + (sites.has(last) ? 1 : 0) +
        (bars.has(index) ? 2 : 0);
      if (length > limit) found.push({ first: index, last });
    }
    index = last + 1;
  }
  return found;
}

/** The break §9.4 makes in a line: its outermost structure first. */
function plan(
  reading: Reading,
  line: LongLine,
  failed: ReadonlySet<string>,
  limit: number,
  spreading: readonly Construct[],
): Plan | undefined {
  const tokens = reading.lexed.tokens;
  // Where several items share a line, only the last is broken (§9.3).
  let start = line.first;
  const depth: number[] = [];
  let level = 0;
  for (let index = line.first; index <= line.last; index += 1) {
    const kind = tokens[index]!.kind;
    if (closers.has(kind)) level -= 1;
    if (level < 0) {
      // A line that begins by closing brackets: what follows is the rest of
      // the item around them.
      level = 0;
      start = index + 1;
    }
    depth[index] = level;
    if (openers.has(kind)) level += 1;
    if (kind === "Semicolon" && level === 0) start = index + 1;
  }
  const atTop = (index: number): boolean => depth[index] === 0;
  const range = (from: number): number[] => {
    const indices: number[] = [];
    for (let index = from; index <= line.last; index += 1) indices.push(index);
    return indices;
  };
  const roles = rolesOf(reading);
  const candidates: { readonly shape: string; readonly before: () => number[] }[] = [];

  // 1. A binding, declaration, assignment, arm or lambda: the value beneath its
  // `=`, `:=` or `=>`. An assignment is laid out as a binding is. A binding's
  // `=`, an arm's `=>` or an assignment's `:=` that comes after a head keyword
  // is inside that construct's branch, not the line's own.
  const firstHead = range(start).find((index) => atTop(index) && headKeywords.has(tokens[index]!.kind));
  const before = (index: number): boolean => firstHead === undefined || index < firstHead;
  const head = range(start).find((index) =>
    atTop(index) && before(index) && valueHeads.has(tokens[index]!.kind));
  const measure = measuring(reading, limit, spreading);
  const pairs = pairsOf(reading);
  // A union that §15 spreads: its alternatives one to a line beneath its `=`.
  const union = line.union;
  if (union !== undefined) {
    candidates.push({
      shape: "union",
      before: () => {
        const lead = tokens[union.opens - 1]?.kind === "Bar" ? union.opens - 1 : union.opens;
        const bars = range(union.opens).filter((index) => index <= union.closes && tokens[index]!.kind === "Bar");
        return [lead, ...bars];
      },
    });
  }
  // A body, conditional or loop that ends an item of open brackets
  // ends in a block once it is broken, and a comma the author wrote after it
  // would be read inside the block: it begins a line of its own, the one place
  // it can stand (Lexer & Layout §7).
  const comma = (found: number[]): number[] =>
    found.length > 0 && tokens[line.last]!.kind === "Comma" && atTop(line.last) && pairs.enclosing[line.last] !== undefined
      ? [...found, line.last]
      : found;
  // A record declaration that §15 spreads: its braces open where they
  // stand, the house's `record R = {`, its value kept on the `=`'s line.
  const record = line.record;
  if (record !== undefined) {
    candidates.push({ shape: "record", before: () => brackets(shaping, [record.opens], depth) });
  }
  // 2. A line holding several items of open brackets opened on an earlier
  // line breaks between them before anything inside them breaks.
  candidates.push({ shape: "items", before: () => betweenItems(tokens, pairs, depth, start, line.last, measure) });
  if (head !== undefined && head < line.last) {
    // A value that is a lambda keeps its head on the `=`'s or `:=`'s line, and
    // only its body goes beneath the `=>`, where the line through the `=>` fits.
    const arrow = tokens[head]!.kind !== "FatArrow" ? lambdaArrow(tokens, pairs, roles, head + 1, line.last) : undefined;
    if (arrow !== undefined && arrow < line.last && measure.fits(arrow)) {
      candidates.push({ shape: "lambda", before: () => [arrow + 1] });
    }
    candidates.push({ shape: "value", before: () => [head + 1] });
  }
  const valueStart = head !== undefined ? head + 1 : start;
  const value = range(valueStart).filter(atTop);

  const heads = headsOn(tokens, start, line.last, depth);
  const blocked = insideHeads(heads, line.last);
  if (value.length > 0) {
    // 4. A conditional.
    candidates.push({ shape: "conditional", before: () => comma(conditional(tokens, value, line.last)) });
    // 6. A loop: its body beneath its `do`.
    candidates.push({
      shape: "loop",
      before: () => comma(heads
        .filter(({ keyword, closer }) =>
          closer !== undefined && closer < line.last && atTop(keyword) &&
          (tokens[keyword]!.kind === "While" || tokens[keyword]!.kind === "For"))
        .slice(0, 1)
        .map(({ closer }) => closer! + 1)),
    });
    // 3. A chain.
    candidates.push({ shape: "chain", before: () => chain(tokens, roles, value) });
    // 5. An operator.
    candidates.push({ shape: "operator", before: () => operator(tokens, roles, value, line.last) });
  }
  // 2. Brackets: the first pair on the line with something between it, or, on
  // a header whose value is already beneath it, the header's.
  const bracketsFrom = value.length > 0 ? valueStart : start;
  // The first pair outside a head.
  const openings = range(bracketsFrom).filter((index) => !blocked.has(index));
  const shaping: Shaping = { tokens, pairs, roles, measure, last: line.last, keepHead: true };
  // Where a lambda's kept head cannot be made, as before a trailing comma,
  // the brackets open one item to a line instead.
  const plainly: Shaping = { ...shaping, keepHead: false };
  candidates.push({ shape: "brackets", before: () => brackets(shaping, openings, depth) });
  candidates.push({ shape: "brackets plainly", before: () => brackets(plainly, openings, depth) });

  // 7. A head, once nothing else on its line is left to break: its own
  // expression breaks as any does, and its closing word ends its last line.
  const outer = heads[0];
  const own: number[] = [];
  if (outer !== undefined) {
    // A `for` head's own expression is its source, after `in`.
    let from = outer.keyword + 1;
    if (tokens[outer.keyword]!.kind === "For") {
      for (let index = from; index < (outer.closer ?? line.last + 1); index += 1) {
        if (tokens[index]!.kind === "In" && depth[index] === depth[outer.keyword]) {
          from = index + 1;
          break;
        }
      }
    }
    for (let index = from; index < (outer.closer ?? line.last + 1); index += 1) {
      if (depth[index] === depth[outer.keyword]) own.push(index);
    }
  }
  // Only once nothing else is left: no value to put beneath its `=` or `=>`,
  // no conditional's branches and no loop's body still on the line, except
  // where that break has been tried and could not be made.
  const othersLeft = candidates
    .filter(({ shape }) => ["value", "lambda", "conditional", "loop"].includes(shape))
    .filter(({ shape }) => !failed.has(`${line.first}:${shape}`))
    .some((candidate) => candidate.before().some((index) => index > line.first && index <= line.last));
  const inHead = (found: number[]): number[] => found.filter((index) => index !== outer?.closer);
  if (own.length > 0 && !othersLeft) {
    const top = depth[outer!.keyword]!;
    candidates.push({ shape: "head chain", before: () => inHead(chain(tokens, roles, own)) });
    candidates.push({ shape: "head operator", before: () => inHead(operator(tokens, roles, own, line.last)) });
    candidates.push({
      shape: "head brackets",
      before: () => inHead(brackets(shaping, own, depth, top)),
    });
    candidates.push({
      shape: "head brackets plainly",
      before: () => inHead(brackets(plainly, own, depth, top)),
    });
  }

  // Last of all, a body that ends an item of open brackets before a comma
  // goes beneath its `=>`, the comma on a line of its own, where nothing else
  // on the line could be broken.
  if (head !== undefined && head < line.last && tokens[head]!.kind === "FatArrow") {
    candidates.push({ shape: "body before a comma", before: () => comma([head + 1]).length > 1 ? comma([head + 1]) : [] });
  }

  for (const candidate of candidates) {
    if (failed.has(`${line.first}:${candidate.shape}`)) continue;
    const before = candidate.before().filter((index) => index > line.first && index <= line.last);
    // A break inside a head is the head's own; none is ever made before a
    // closing word (§9.3).
    if (!candidate.shape.startsWith("head") && before.some((index) => blocked.has(index))) continue;
    if (heads.some(({ closer }) => closer !== undefined && before.includes(closer))) continue;
    if (before.length === 0) continue;
    // A chain whose receiver begins its line keeps its links at its level.
    const level = candidate.shape === "chain" && valueStart === line.first ? new Set(before) : undefined;
    // A comma after an item that ends in a block once broken: a separator
    // begins a line of its own, and a trailing comma, which has no room
    // there, is removed (§14).
    const trailing = before.includes(line.last) && tokens[line.last]!.kind === "Comma" &&
      (closers.has(tokens[line.last + 1]?.kind ?? "") || tokens[line.last + 1]?.kind === "Greater");
    return {
      line: line.first,
      shape: candidate.shape,
      before: trailing ? before.filter((index) => index !== line.last) : before,
      ...(level === undefined ? {} : { level }),
      ...(trailing ? { removes: line.last } : {}),
    };
  }
  return undefined;
}

const roleCache = new WeakMap<Reading, Spacing.Roles>();

function rolesOf(reading: Reading): Spacing.Roles {
  const known = roleCache.get(reading);
  if (known !== undefined) return known;
  const roles = Spacing.roles(reading.lexed.tokens.filter(({ kind }) => kind !== "Eof"), new Set());
  roleCache.set(reading, roles);
  return roles;
}

/** A head on a line (Lexer & Layout §2.4): its keyword, and its closing word if the line holds it. */
interface Head {
  readonly keyword: number;
  readonly closer: number | undefined;
}

const headKeywords = new Set(["If", "While", "For", "Match"]);

/** The tokens a value or body goes beneath (§9.4 rule 1). */
const valueHeads = new Set(["Equal", "Assign", "FatArrow"]);

function isCloser(tokens: readonly Lexed.Token[], keyword: number, index: number): boolean {
  const token = tokens[index]!;
  switch (tokens[keyword]!.kind) {
    case "If":
      return token.kind === "Then";
    case "While":
    case "For":
      return token.kind === "Do";
    default:
      return token.kind === "NonUpperName" && token.text === "with";
  }
}

/** The heads on a line, outermost first, each with its closing word where the line holds it. */
function headsOn(tokens: readonly Lexed.Token[], from: number, last: number, depth: readonly number[]): Head[] {
  const heads: Head[] = [];
  const open: number[] = [];
  for (let index = from; index <= last; index += 1) {
    const kind = tokens[index]!.kind;
    // A head left open inside brackets that have closed is done with.
    while (open.length > 0 && depth[open.at(-1)!]! > depth[index]!) {
      heads.push({ keyword: open.pop()!, closer: undefined });
    }
    const innermost = open.at(-1);
    if (innermost !== undefined && depth[index] === depth[innermost] && isCloser(tokens, innermost, index)) {
      open.pop();
      heads.push({ keyword: innermost, closer: index });
    } else if (headKeywords.has(kind)) {
      // The bare `match` of a match function holds nothing and needs no closing word.
      if (kind === "Match" && index === last) continue;
      open.push(index);
    }
  }
  for (const keyword of open) heads.push({ keyword, closer: undefined });
  return heads.sort((left, right) => left.keyword - right.keyword);
}

/**
 * The tokens inside the heads on a line, from just after each keyword to its
 * closing word or the end of the line. A break there is a head's own (§9.4
 * rule 7), made only once nothing else on the line is left to break.
 */
function insideHeads(heads: readonly Head[], last: number): Set<number> {
  const inside = new Set<number>();
  for (const { keyword, closer } of heads) {
    for (let index = keyword + 1; index <= (closer ?? last); index += 1) inside.add(index);
  }
  return inside;
}

/** §9.4 rule 4: `then` ends its line, each branch on its own, `else` beneath `if`. */
function conditional(tokens: readonly Lexed.Token[], whole: readonly number[], last: number): number[] {
  const value = elseIf(tokens, whole);
  if (tokens[value[0]!]!.kind !== "If") return [];
  const before: number[] = [];
  let expecting: "Then" | "Else" = "Then";
  // Conditionals inside a branch, still waiting for their own `else`.
  let nested = 0;
  for (let position = 1; position < value.length; position += 1) {
    const index = value[position]!;
    const kind = tokens[index]!.kind;
    if (kind === "If" && tokens[index - 1]?.kind !== "Else") {
      if (expecting === "Then") return [];
      nested += 1;
    } else if (kind === "Then" && nested === 0 && expecting === "Then") {
      if (index < last) before.push(index + 1);
      expecting = "Else";
    } else if (kind === "Else" && nested > 0) {
      if (tokens[index + 1]?.kind !== "If") nested -= 1;
    } else if (kind === "Else" && expecting === "Else") {
      before.push(index);
      if (tokens[index + 1]?.kind === "If") expecting = "Then";
      else {
        if (index < last) before.push(index + 1);
        break;
      }
    }
  }
  return before;
}

/** §9.4 rule 3: a chain of two or more links, each on a line of its own. */
function chain(tokens: readonly Lexed.Token[], roles: Spacing.Roles, whole: readonly number[]): number[] {
  const value = reach(tokens, whole);
  if (value.length === 0 || tokens[value[0]!]!.kind === "If") return [];
  const pipes = value.filter((index) => tokens[index]!.kind === "Pipe");
  const operators = value.filter((index) => binaryLevel(tokens, roles, index) !== undefined);
  let links: number[];
  if (pipes.length > 0) {
    links = pipes;
  } else if (operators.length === 0) {
    links = value.filter((index) => isDotCall(tokens, index));
  } else {
    return [];
  }
  return links.length >= 2 ? links : [];
}

function isDotCall(tokens: readonly Lexed.Token[], index: number): boolean {
  if (tokens[index]!.kind !== "Dot") return false;
  // A dot after an uppercase name is a module qualifier.
  if (tokens[index - 1]?.kind === "UpperName") return false;
  if (tokens[index + 1]?.kind !== "NonUpperName") return false;
  let next = index + 2;
  while (marks.has(tokens[next]?.kind ?? "")) next += 1;
  return tokens[next]?.kind === "LeftParen";
}

function binaryLevel(tokens: readonly Lexed.Token[], roles: Spacing.Roles, index: number): number | undefined {
  const token = tokens[index]!;
  if (token.kind === "NonUpperName") {
    return roles.bitwiseOperator.has(index) ? precedence.get(token.text) : undefined;
  }
  if ((token.kind === "Plus" || token.kind === "Minus") && roles.prefix.has(index)) return undefined;
  if (token.kind === "Less" && roles.binderOpen.has(index)) return undefined;
  if (token.kind === "Greater" && roles.binderClose.has(index)) return undefined;
  return precedence.get(token.kind);
}

/** A line that begins `else if` is read from its `if`: an `else if` stays on one line. */
function elseIf(tokens: readonly Lexed.Token[], value: readonly number[]): readonly number[] {
  const first = value[0];
  const second = value[1];
  if (first === undefined || second === undefined) return value;
  return tokens[first]!.kind === "Else" && tokens[second]!.kind === "If" ? value.slice(1) : value;
}

const eatsRight = new Set(["If", "Match", "Attempt", "Assume", "Try", "FatArrow"]);

/**
 * The tokens an operator chain reaches: up to a form that eats to the right
 * (Operators §3.2), whose operators are its own, or, in a conditional, the
 * condition, which `heads` then keeps whole (§9.3).
 */
function reach(tokens: readonly Lexed.Token[], whole: readonly number[]): readonly number[] {
  const value = elseIf(tokens, whole);
  if (tokens[value[0]!]!.kind === "If") {
    const then = value.findIndex((index) => tokens[index]!.kind === "Then");
    return value.slice(1, then === -1 ? value.length : then);
  }
  const end = value.findIndex((index, position) => position > 0 && eatsRight.has(tokens[index]!.kind));
  return end === -1 ? value : value.slice(0, end);
}

/** §9.4 rule 5: carried on at two levels, one operand to a line, at the loosest operator. */
function operator(
  tokens: readonly Lexed.Token[],
  roles: Spacing.Roles,
  value: readonly number[],
  last: number,
): number[] {
  const operands = reach(tokens, value);
  let loosest = 0;
  for (const index of operands) loosest = Math.max(loosest, binaryLevel(tokens, roles, index) ?? 0);
  if (loosest === 0) return [];
  const before: number[] = [];
  for (const index of operands) {
    if (binaryLevel(tokens, roles, index) !== loosest) continue;
    // The carried-on line begins with the operator (§9.5). An operator the
    // author left at the end of the line stays there, with its operand.
    if (index < last) before.push(index);
  }
  return before;
}

/** Measures lines against the limit, as they stand before a break. */
interface Measure {
  /**
   * Whether the line holding a token fits when it ends with that token (§9.2),
   * and holds no construct that §15 spreads (§15.3).
   */
  readonly fits: (last: number) => boolean;
  /** The width of the text from the start of one token to the end of another, in code points. */
  readonly width: (first: number, last: number) => number;
  readonly limit: number;
}

function measuring(reading: Reading, limit: number, spreading: readonly Construct[]): Measure {
  const tokens = reading.lexed.tokens;
  const text = reading.text;
  return {
    fits: (last) => {
      const end = tokens[last]!.span.end;
      if ([...text.slice(end.offset - end.column, end.offset)].length > limit) return false;
      return !spreading.some((construct) =>
        tokens[construct.opens]!.span.start.line === end.line && Math.max(construct.last, construct.closes) <= last);
    },
    width: (first, last) => [...text.slice(tokens[first]!.span.start.offset, tokens[last]!.span.end.offset)].length,
    limit,
  };
}

/** Each bracket's partner, and each token's innermost enclosing opening bracket. */
interface Pairs {
  readonly partner: ReadonlyMap<number, number>;
  readonly enclosing: readonly (number | undefined)[];
}

const pairsCache = new WeakMap<Reading, Pairs>();

function pairsOf(reading: Reading): Pairs {
  const known = pairsCache.get(reading);
  if (known !== undefined) return known;
  const tokens = reading.lexed.tokens;
  const partner = new Map<number, number>();
  const enclosing: (number | undefined)[] = [];
  const stack: number[] = [];
  tokens.forEach(({ kind }, index) => {
    if (closers.has(kind)) {
      const open = stack.pop();
      if (open !== undefined) {
        partner.set(open, index);
        partner.set(index, open);
      }
    }
    enclosing[index] = stack.at(-1);
    if (openers.has(kind)) stack.push(index);
  });
  const pairs = { partner, enclosing };
  pairsCache.set(reading, pairs);
  return pairs;
}

/** What the bracket shapes read: the tokens, their pairs, and the line being broken. */
interface Shaping {
  readonly tokens: readonly Lexed.Token[];
  readonly pairs: Pairs;
  readonly roles: Spacing.Roles;
  readonly measure: Measure;
  /** The last token on the line being broken. */
  readonly last: number;
  /** Whether a last item that is a lambda keeps its head on the line. */
  readonly keepHead: boolean;
}

/** The first token of each item between a pair of brackets, and the comma after each, where there is one. */
function itemsOf(tokens: readonly Lexed.Token[], pairs: Pairs, open: number, close: number): {
  readonly starts: number[];
  readonly commas: number[];
} {
  const starts: number[] = [];
  const commas: number[] = [];
  let index = open + 1;
  if (index < close) starts.push(index);
  while (index < close) {
    const partner = openers.has(tokens[index]!.kind) ? pairs.partner.get(index) : undefined;
    if (partner !== undefined) {
      index = partner + 1;
      continue;
    }
    if (tokens[index]!.kind === "Comma") {
      commas.push(index);
      // A trailing comma begins no item.
      if (index + 1 < close) starts.push(index + 1);
    }
    index += 1;
  }
  return { starts, commas };
}

/**
 * Whether `first` to `last` is a literal of a filled list (§9.4 rule 2): a
 * number, with or without a leading `-`, a string with no hole on one line, or
 * a tuple of those.
 */
function isLiteral(tokens: readonly Lexed.Token[], pairs: Pairs, first: number, last: number, inTuple = false): boolean {
  const token = tokens[first]!;
  const numeric = (kind: string): boolean => ["Integer", "BigInt", "Dec", "Float"].includes(kind);
  if (first === last) {
    if (numeric(token.kind)) return true;
    return token.kind === "String" && token.span.start.line === token.span.end.line &&
      token.parts.every(({ kind }) => kind === "Text");
  }
  if (first + 1 === last && token.kind === "Minus") return numeric(tokens[last]!.kind);
  if (inTuple || token.kind !== "LeftParen" || pairs.partner.get(first) !== last) return false;
  const { starts, commas } = itemsOf(tokens, pairs, first, last);
  if (commas.length === 0) return false;
  return starts.every((start, position) => {
    const end = (commas[position] ?? last) - 1;
    return end >= start && isLiteral(tokens, pairs, start, end, true);
  });
}

/** Whether every item between a pair of brackets is a literal, so that the pair is filled. */
function isFilled(tokens: readonly Lexed.Token[], pairs: Pairs, open: number, close: number): boolean {
  const { starts, commas } = itemsOf(tokens, pairs, open, close);
  if (starts.length === 0) return false;
  return starts.every((start, position) => {
    const end = (commas[position] ?? close) - 1;
    return end >= start && isLiteral(tokens, pairs, start, end);
  });
}

/**
 * The breaks that fill items onto lines at `indent`: as many to a line as
 * fit, and at least one, each line breaking after a comma. `ends` is the last
 * token of each item, its comma included; a last item with no comma counts
 * the one §14 adds once its closing bracket begins a line (§9.2).
 */
function fill(
  tokens: readonly Lexed.Token[],
  measure: Measure,
  starts: readonly number[],
  ends: readonly number[],
  indent: number,
): number[] {
  const before: number[] = [];
  const widthOf = (position: number): number => {
    const end = ends[position]!;
    const comma = position === starts.length - 1 && tokens[end]!.kind !== "Comma" ? 1 : 0;
    return measure.width(starts[position]!, end) + comma;
  };
  let used = indent + widthOf(0);
  for (let position = 1; position < starts.length; position += 1) {
    const width = widthOf(position);
    if (used + 1 + width <= measure.limit) {
      used += 1 + width;
    } else {
      before.push(starts[position]!);
      used = indent + width;
    }
  }
  return before;
}

/** The indentation of the line a token is on. */
function indentOn(token: Lexed.Token): number {
  const start = token.span.start;
  return start.column;
}

/**
 * §9.4 rule 2's last paragraph: a line holding several items of open
 * brackets whose opening bracket is on an earlier line breaks between them,
 * one item to a line or filled.
 */
function betweenItems(
  tokens: readonly Lexed.Token[],
  pairs: Pairs,
  depth: readonly number[],
  start: number,
  last: number,
  measure: Measure,
): number[] {
  const open = pairs.enclosing[start];
  if (open === undefined) return [];
  const close = pairs.partner.get(open);
  if (close === undefined || close <= last) return [];
  // Open brackets: the closing bracket begins its line (§5.2).
  if (tokens[close - 1]!.span.end.line === tokens[close]!.span.start.line) return [];
  const starts = [start];
  const ends: number[] = [];
  for (let index = start; index <= last; index += 1) {
    if (depth[index] !== 0 || tokens[index]!.kind !== "Comma") continue;
    ends.push(index);
    if (index < last) starts.push(index + 1);
  }
  if (starts.length < 2) return [];
  if (ends.length < starts.length) ends.push(last);
  if (!isFilled(tokens, pairs, open, close)) return starts.slice(1);
  return fill(tokens, measure, starts, ends, indentOn(firstOnLine(tokens, start)));
}

/**
 * The `=>` of a lambda that runs from `first` to the end of its item, where
 * its head is on the line: a name, or a bracketed parameter list with an
 * optional binder list before it and annotation after it.
 */
function lambdaArrow(
  tokens: readonly Lexed.Token[],
  pairs: Pairs,
  roles: Spacing.Roles,
  first: number,
  last: number,
): number | undefined {
  let index = first;
  if (tokens[index]?.kind === "Less" && roles.binderOpen.has(index)) {
    while (index <= last && !(tokens[index]!.kind === "Greater" && roles.binderClose.has(index))) index += 1;
    index += 1;
  }
  const token = tokens[index];
  if (token === undefined || index > last) return undefined;
  if (token.kind === "NonUpperName" || token.kind === "Wildcard") {
    return tokens[index + 1]?.kind === "FatArrow" && index + 1 <= last ? index + 1 : undefined;
  }
  if (token.kind !== "LeftParen" && token.kind !== "LeftBrace") return undefined;
  const close = pairs.partner.get(index);
  if (close === undefined || close >= last) return undefined;
  if (tokens[close + 1]!.kind === "FatArrow") return close + 1;
  if (tokens[close + 1]!.kind !== "Colon") return undefined;
  // An annotation: its arrows are `->`, so the first `=>` outside brackets is the lambda's.
  for (let next = close + 2; next <= last; next += 1) {
    const kind = tokens[next]!.kind;
    if (kind === "FatArrow") return next;
    if (openers.has(kind)) next = pairs.partner.get(next) ?? last;
    else if (kind === "Comma" || closers.has(kind)) return undefined;
  }
  return undefined;
}

const callees = new Set(["NonUpperName", "UpperName", "RightParen", "RightBracket", ...marks]);

/**
 * Where the last item of a call or a record is a lambda or a bare `match`
 * (§9.4 rule 2), the token that ends the head kept on the line: the lambda's
 * `=>`, or `match`.
 */
function lastItemHead(shaping: Shaping, open: number, close: number): number | undefined {
  const { tokens, pairs, roles, last } = shaping;
  const kind = tokens[open]!.kind;
  const call = kind === "LeftParen" && (callees.has(tokens[open - 1]?.kind ?? "") ||
    (tokens[open - 1]?.kind === "Greater" && roles.binderClose.has(open - 1)));
  if (!call && kind !== "LeftBrace") return undefined;
  const { starts } = itemsOf(tokens, pairs, open, close);
  let first = starts.at(-1);
  if (first === undefined || first > last) return undefined;
  if (kind === "LeftBrace") {
    // A field: its name, then `=`, then its value.
    if (tokens[first]!.kind !== "NonUpperName" || tokens[first + 1]?.kind !== "Equal") return undefined;
    first += 2;
  }
  // The match function: `match` ending its line.
  if (tokens[first]?.kind === "Match" && first === last) return first;
  return lambdaArrow(tokens, pairs, roles, first, last);
}

/**
 * §9.4 rule 2: the first pair on the line with something between it. Its
 * contents go one item to a line and its closer on its own line, except where
 * its only item is bracketed, its last item is a lambda, or it is filled.
 */
function brackets(shaping: Shaping, candidates: readonly number[], depth: readonly number[], top = 0): number[] {
  const { tokens, pairs } = shaping;
  for (const open of candidates) {
    if (depth[open] !== top || !openers.has(tokens[open]!.kind)) continue;
    if (closers.has(tokens[open + 1]?.kind ?? "")) continue;
    const close = pairs.partner.get(open);
    if (close === undefined) continue;
    const before = shapeOf(shaping, open, close);
    if (before.length > 0) return before;
  }
  return [];
}

/** The breaks one pair of brackets takes, by the shapes of §9.4 rule 2. */
function shapeOf(shaping: Shaping, open: number, close: number): number[] {
  const { tokens, pairs, measure, last } = shaping;
  const onLine = close <= last;
  // Brackets whose only item is a vector literal, a record or a tuple open
  // and close with it. Parentheses around one expression are not a tuple.
  const inner = open + 1;
  if (
    openers.has(tokens[inner]!.kind) && pairs.partner.get(inner) === close - 1 && close - 1 > inner + 1 &&
    (tokens[inner]!.kind !== "LeftParen" || itemsOf(tokens, pairs, inner, close - 1).commas.length > 0)
  ) {
    return shapeOf(shaping, inner, close - 1);
  }
  const { starts } = itemsOf(tokens, pairs, open, close);
  const onThisLine = starts.filter((start) => start <= last);
  const oneToALine = [...onThisLine, ...(onLine ? [close] : [])];
  // A last item that is a lambda keeps its head on the line, where it fits.
  const head = lastItemHead(shaping, open, close);
  if (head !== undefined) {
    if (shaping.keepHead && head < last && measure.fits(head)) return [head + 1, ...(onLine ? [close] : [])];
    return oneToALine;
  }
  // Brackets whose closer is on a later line open only for a lambda.
  if (!onLine) return [];
  if (isFilled(tokens, pairs, open, close)) {
    const { commas } = itemsOf(tokens, pairs, open, close);
    const ends = starts.map((start, position) => commas[position] ?? close - 1);
    const indent = indentOn(firstOnLine(tokens, open)) + Whitespace.LEVEL;
    return [open + 1, ...fill(tokens, measure, starts, ends, indent), close];
  }
  return oneToALine;
}

/** The first token on the line a token is on. */
function firstOnLine(tokens: readonly Lexed.Token[], index: number): Lexed.Token {
  const line = tokens[index]!.span.start.line;
  let first = index;
  while (first > 0 && tokens[first - 1]!.span.start.line === line) first -= 1;
  return tokens[first]!;
}
