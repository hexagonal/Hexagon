/**
 * What the formatter reads a document into, and the checks it makes on its own
 * output (Canonical Layout §1, §12).
 *
 * The formatter changes whitespace and nothing else, and it proves that on
 * every run rather than trusting itself: the tokens and comments of its output
 * are the input's, in the same order, those inside interpolation holes
 * included, every string's text is the input's as written, and the output
 * parses to the same tree.
 */

import * as Source from "../support/source.js";
import { lex } from "../passes/lexer/lexer.js";
import { applyLayout } from "../passes/layout/layout.js";
import { parseFile } from "../passes/parser/parser.js";
import type * as Lexed from "../syntax/lexed/index.js";
import type * as LaidOut from "../syntax/laid-out/index.js";
import type * as Parsed from "../syntax/parsed/index.js";

/** The tokens a trailing comma stands before: a list's closing bracket (§14). */
export const listClosers: ReadonlySet<string> = new Set(["RightParen", "RightBracket", "RightBrace", "Greater"]);

/** A document read as far as the layout pass: all the whitespace pass reads. */
export interface Scan {
  readonly text: string;
  readonly lexed: Lexed.File;
  readonly laidOut: LaidOut.File;
  /** Whether the lexer or the layout pass reported an error. */
  readonly syntaxError: boolean;
}

/** A document read as far as the parser. */
export interface Reading extends Scan {
  readonly modules: readonly Parsed.Module[];
  /** Whether any of the three passes reported an error (Canonical Layout §2.3). */
  readonly syntaxError: boolean;
}

export function scan(text: string): Scan {
  const source = new Source.File(Source.fileId(0), "format.hex", text);
  const lexed = lex(source);
  const laidOut = applyLayout(lexed);
  const syntaxError = laidOut.diagnostics.some(({ severity }) => severity === "error");
  return { text, lexed, laidOut, syntaxError };
}

export function read(text: string): Reading {
  const scanned = scan(text);
  const modules = parseFile(scanned.laidOut);
  const syntaxError = scanned.syntaxError ||
    modules.some((module) => module.diagnostics.some(({ severity }) => severity === "error"));
  return { ...scanned, modules, syntaxError };
}

/**
 * Whether two readings hold the same text (§1's first guarantee): the same
 * tokens with the same payloads, those inside interpolation holes included,
 * the same comments, and the same text in every string as the author wrote
 * it, in the same order.
 * Where `commas` allows, `after` may also hold trailing commas `before` does
 * not, each directly before a closing bracket: the ones §14 adds.
 *
 * A comment's text is compared line by line with each later line's leading
 * whitespace set aside, since a comment that spans lines moves as a unit
 * (§8.2) and a line end is a boundary, not text (§1).
 */
export function sameText(before: Scan, after: Scan, commas = false): boolean {
  const left = before.lexed.tokens;
  const right = after.lexed.tokens;
  let index = 0;
  for (let position = 0; position < right.length; position += 1) {
    const token = right[position]!;
    if (index < left.length && tokenKey(left[index]!) === tokenKey(token)) {
      index += 1;
      continue;
    }
    const added = commas && token.kind === "Comma" && listClosers.has(right[position + 1]?.kind ?? "");
    if (!added) return false;
  }
  if (index !== left.length) return false;
  const leftComments = before.lexed.comments;
  const rightComments = after.lexed.comments;
  if (leftComments.length !== rightComments.length) return false;
  for (let index = 0; index < leftComments.length; index += 1) {
    if (commentKey(leftComments[index]!) !== commentKey(rightComments[index]!)) return false;
  }
  const leftTexts = stringTexts(before);
  const rightTexts = stringTexts(after);
  return leftTexts.length === rightTexts.length &&
    leftTexts.every((text, index) => text === rightTexts[index]);
}

/**
 * The text of every string in a reading, at any depth, as the author spelled
 * it: each run between a string's quotes and its holes, escapes as written
 * (§7.4). A token's payload holds a run's value, which two spellings can share.
 * A line end is a boundary, not text (§1), so each is compared as one.
 */
function stringTexts(scan: Scan): string[] {
  const texts: string[] = [];
  const visit = (token: Lexed.Token): void => {
    if (token.kind !== "String") return;
    for (const part of token.parts) {
      if (part.kind === "Text") {
        texts.push(scan.text.slice(part.span.start.offset, part.span.end.offset).replace(/\r\n?/gu, "\n"));
      } else {
        part.tokens.forEach(visit);
      }
    }
  };
  scan.lexed.tokens.forEach(visit);
  return texts;
}

/** Whether two readings parse to the same tree (§1's second guarantee). */
export function sameTree(before: Reading, after: Reading): boolean {
  return treeKey(before) === treeKey(after);
}

/**
 * Where two readings' trees differ, as the top-level items of `after` that
 * differ from their counterparts, by token index; `undefined` where they differ
 * beyond their items, or in how many items there are.
 */
export function differingItems(before: Reading, after: Reading): readonly (readonly [number, number])[] | undefined {
  const left = before.modules.flatMap(({ items }) => items);
  const right = after.modules.flatMap(({ items }) => items);
  if (left.length !== right.length) return undefined;
  const withoutItems = (reading: Reading): string =>
    JSON.stringify(shape(reading.modules.map((module) => ({ ...module, items: [] }))));
  if (withoutItems(before) !== withoutItems(after)) return undefined;
  const tokens = after.lexed.tokens;
  const ranges: (readonly [number, number])[] = [];
  left.forEach((item, index) => {
    const counterpart = right[index]!;
    if (JSON.stringify(shape(item)) === JSON.stringify(shape(counterpart))) return;
    const { start, end } = counterpart.span;
    const first = tokens.findIndex(({ span }) => span.start.offset >= start.offset);
    let last = first;
    while (last + 1 < tokens.length && tokens[last + 1]!.span.end.offset <= end.offset) last += 1;
    ranges.push([first, last]);
  });
  return ranges;
}

const treeKeys = new WeakMap<Reading, string>();

function treeKey(reading: Reading): string {
  const cached = treeKeys.get(reading);
  if (cached !== undefined) return cached;
  const key = JSON.stringify(shape(reading.modules));
  treeKeys.set(reading, key);
  return key;
}

function tokenKey(token: Lexed.Token): string {
  return JSON.stringify(shape(token));
}

function commentKey(comment: Source.Comment): string {
  const lines = comment.text.split(/\r\n|\r|\n/u);
  // The later lines move together: each keeps its indentation relative to the
  // least indented of them, and a line of only whitespace is blank.
  const later = lines.slice(1).map((line) => {
    const leading = /^[ \t]*/u.exec(line)![0];
    return { leading, rest: line.slice(leading.length) };
  });
  const written = later.filter(({ rest }) => rest !== "");
  const common = written.length === 0 ? 0 : Math.min(...written.map(({ leading }) => leading.length));
  const rest = later.map(({ leading, rest: text }) => text === "" ? "" : leading.slice(common) + text);
  return JSON.stringify([comment.kind, comment.documentation, lines[0], ...rest]);
}

/**
 * A syntax value with its positions set aside, so two layouts of one program
 * compare equal.
 *
 * One more thing is set aside: a block that holds a single expression and
 * nothing else is that expression. The parser keeps the block where a value is
 * written beneath its `=` or `=>` and not where it is written on the header
 * line, and the two mean the same (Lexer & Layout §2.1: a single wrapped
 * expression is the one-item case; Canonical Layout §9.4 rule 1).
 */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if ("offset" in record && "line" in record && "column" in record) return 0;
  if (record["kind"] === "Block" && Array.isArray(record["items"]) && record["items"].length === 1) {
    const item = record["items"][0] as Record<string, unknown> | undefined;
    if (item?.["kind"] === "ExprItem") return shape(item["expression"]);
  }
  // A comment's own text, which moves as a unit (§8.2).
  if ("terminated" in record && "documentation" in record && typeof record["text"] === "string") {
    return commentKey(record as unknown as Source.Comment);
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (key === "fileId" || key === "span") continue;
    // A doc block's `target` is the documented declaration's offset.
    if (key === "target" && typeof record[key] === "number") continue;
    out[key] = shape(record[key]);
  }
  return out;
}
