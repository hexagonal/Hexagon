/**
 * Breaking a line longer than the Maximum line length (Canonical Layout §9).
 *
 * A break is a line end put before a token; the whitespace pass then writes the
 * new line's indentation by §5, as it would have written it had the author
 * broken the line there. Each break is kept only where the program parses to
 * the same tree afterwards (§9.3), so a structure that cannot be broken here
 * is left whole, and the next one tried.
 */

import { differingItems, read, sameText, sameTree, scan, type Reading } from "./analysis.js";
import * as Spacing from "./spacing.js";
import * as Whitespace from "./whitespace.js";
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
}

const MAXIMUM_ROUNDS = 10_000;

export function breakLines(original: Reading, text: string, limit: number, options: Whitespace.Options): string {
  let current = read(text);
  const failed = new Set<string>();
  for (let round = 0; round < MAXIMUM_ROUNDS; round += 1) {
    const reading = current;
    const plans = longLines(reading, limit)
      .map((line) => plan(reading, line, failed))
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
  // the rest of several broken items moves for each.
  const shifts = new Map<number, number>();
  for (const one of plans) {
    const line = tokens[one.line]!.span.start.line;
    for (const later of restOfItem(reading, lines, line, indentOf(line))) {
      shifts.set(later, (shifts.get(later) ?? 0) + 2 * Whitespace.LEVEL);
    }
  }
  for (const [line, shift] of shifts) inserts.push({ offset: lines[line]!, remove: 0, text: " ".repeat(shift) });

  for (const one of plans) {
    const line = tokens[one.line]!.span.start.line;
    const indent = indentOf(line) + (shifts.get(line) ?? 0);
    for (const index of one.before) {
      const token = tokens[index]!;
      const offset = token.span.start.offset;
      let gap = offset;
      while (gap > 0 && (text[gap - 1] === " " || text[gap - 1] === "\t")) gap -= 1;
      // A provisional indentation that keeps the line's place in the layout:
      // carried on, two levels deeper, except `else` and a chain's links under
      // a receiver that begins its line, which stand at their item's. The
      // whitespace pass then writes the line's own (§5).
      const level = token.kind === "Else" || one.level?.has(index) === true;
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
  if (!sameText(original, provisional)) return { kind: "Failed" };
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
 * The lines after a line that continue its item: those indented deeper, and
 * the clauses (`else`, `catch`) at its own column. A line inside a string is
 * the string's, and stays as it is.
 */
function restOfItem(reading: Reading, lines: readonly number[], line: number, indent: number): number[] {
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
    const clause = own === indent && first !== undefined && first.span.start.offset === start + own &&
      (first.kind === "Else" || first.kind === "Catch" || first.kind === "Finally");
    if (own <= indent && !clause) break;
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
}

/** The lines whose code runs past the limit (§9.2): a trailing comment does not count. */
function longLines(reading: Reading, limit: number): LongLine[] {
  const tokens = reading.lexed.tokens.filter(({ kind }) => kind !== "Eof");
  const text = reading.text;
  const found: LongLine[] = [];
  let index = 0;
  while (index < tokens.length) {
    const line = tokens[index]!.span.start.line;
    let last = index;
    while (last + 1 < tokens.length && tokens[last + 1]!.span.start.line === line) last += 1;
    const end = tokens[last]!.span.end;
    if (end.line === line) {
      const lineStart = end.offset - end.column;
      const length = [...text.slice(lineStart, end.offset)].length;
      if (length > limit) found.push({ first: index, last });
    }
    index = last + 1;
  }
  return found;
}

/** The break §9.4 makes in a line: its outermost structure first. */
function plan(reading: Reading, line: LongLine, failed: ReadonlySet<string>): Plan | undefined {
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

  // 1. A binding, declaration, arm or lambda: the value beneath its `=` or `=>`.
  const head = range(start).find((index) =>
    atTop(index) && (tokens[index]!.kind === "Equal" || tokens[index]!.kind === "FatArrow"));
  const assign = range(start).find((index) => atTop(index) && tokens[index]!.kind === "Assign");
  if (head !== undefined && head < line.last) {
    candidates.push({ shape: "value", before: () => [head + 1] });
  }
  const valueStart = head !== undefined ? head + 1 : assign !== undefined ? assign + 1 : start;
  const value = range(valueStart).filter(atTop);

  if (value.length > 0) {
    // 4. A conditional.
    candidates.push({ shape: "conditional", before: () => conditional(tokens, value, line.last) });
    // 3. A chain.
    candidates.push({ shape: "chain", before: () => chain(tokens, roles, value) });
    // 5. An operator.
    candidates.push({ shape: "operator", before: () => operator(tokens, roles, value, line.last) });
  }
  // 2. Brackets: the first pair on the line with something between it, or, on
  // a header whose value is already beneath it, the header's.
  const bracketsFrom = value.length > 0 ? valueStart : start;
  candidates.push({ shape: "brackets", before: () => brackets(tokens, range(bracketsFrom), depth, line.last) });

  const blocked = heads(tokens, start, line.last);
  for (const candidate of candidates) {
    if (failed.has(`${line.first}:${candidate.shape}`)) continue;
    const before = candidate.before().filter((index) => index > line.first && index <= line.last);
    if (before.some((index) => blocked.has(index))) continue;
    if (before.length === 0) continue;
    // A chain whose receiver begins its line keeps its links at its level.
    const level = candidate.shape === "chain" && valueStart === line.first ? new Set(before) : undefined;
    return { line: line.first, shape: candidate.shape, before, ...(level === undefined ? {} : { level }) };
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

/**
 * The tokens no line may begin with: those inside a control head on the line,
 * from its keyword to the `then` that ends an `if`'s condition, or to the end
 * of the line for `match`, `for` and `while`.
 *
 * Lexer & Layout §2.1 reads a line that ends inside such a head as a block
 * head, so the line after it would open a block and the program would read
 * differently: today the layout pass keeps a bare `if` as its recovery head,
 * which is why a condition carried onto a second line (§5.3's example) does
 * not yet parse. Breaking there could only fail the tree check, so the
 * structure is not tried.
 */
function heads(tokens: readonly Lexed.Token[], from: number, last: number): Set<number> {
  const blocked = new Set<number>();
  for (let index = from; index <= last; index += 1) {
    const kind = tokens[index]!.kind;
    if (kind === "If") {
      let depth = 0;
      for (let next = index + 1; next <= last; next += 1) {
        const inner = tokens[next]!.kind;
        blocked.add(next);
        if (inner === "If") depth += 1;
        else if (inner === "Then") {
          if (depth === 0) break;
          depth -= 1;
        }
      }
    } else if (kind === "Match" || kind === "For" || kind === "While") {
      for (let next = index + 1; next <= last; next += 1) blocked.add(next);
    }
  }
  return blocked;
}

/** §9.4 rule 4: `then` ends its line, each branch on its own, `else` beneath `if`. */
function conditional(tokens: readonly Lexed.Token[], whole: readonly number[], last: number): number[] {
  const value = elseIf(tokens, whole);
  if (tokens[value[0]!]!.kind !== "If") return [];
  const before: number[] = [];
  let expecting: "Then" | "Else" = "Then";
  for (let position = 1; position < value.length; position += 1) {
    const index = value[position]!;
    const kind = tokens[index]!.kind;
    if (kind === "If" && tokens[index - 1]?.kind !== "Else") return [];
    if (kind === "Then" && expecting === "Then") {
      if (index < last) before.push(index + 1);
      expecting = "Else";
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
 * condition (§9.4 rule 4: a condition too long breaks by the same rules).
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

/** §9.4 rule 2: a bracket pair's contents one item to a line, the closer on its own. */
function brackets(
  tokens: readonly Lexed.Token[],
  candidates: readonly number[],
  depth: readonly number[],
  last: number,
): number[] {
  for (const open of candidates) {
    if (depth[open] !== 0 || !openers.has(tokens[open]!.kind)) continue;
    if (closers.has(tokens[open + 1]?.kind ?? "")) continue;
    // Its closer, on this line.
    let level = 0;
    let close: number | undefined;
    const commas: number[] = [];
    for (let index = open; index <= last; index += 1) {
      const kind = tokens[index]!.kind;
      if (openers.has(kind)) level += 1;
      else if (closers.has(kind)) {
        level -= 1;
        if (level === 0) {
          close = index;
          break;
        }
      } else if (kind === "Comma" && level === 1) {
        commas.push(index);
      }
    }
    if (close === undefined) continue;
    // A trailing comma stays where it is: the closer goes after it.
    const items = commas.filter((comma) => comma + 1 !== close).map((comma) => comma + 1);
    return [open + 1, ...items, close];
  }
  return [];
}
