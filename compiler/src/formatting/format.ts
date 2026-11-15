/**
 * Format document and Format selection (spec/canonical-layout.md).
 *
 * Both are pure functions of a document's text and the two options. They
 * rewrite whitespace and nothing else, and check that on every run: the
 * output's tokens and comments are the input's, it parses to the same tree,
 * and formatting it again changes nothing (§1, §12). A document with a syntax
 * error is refused without a report of the formatter's own (§2.3), since the
 * error is already reported.
 */

import { read, sameText, sameTree, type Reading } from "./analysis.js";
import { breakLines } from "./breaking.js";
import * as Whitespace from "./whitespace.js";

export interface FormatOptions {
  /**
   * The longest a line of code may be before it is broken, in code points, or
   * `"unlimited"`, under which no line is ever broken (§3.1). The default.
   */
  readonly maximumLineLength?: number | "unlimited";
  /** Whether a gap wider than the one space §7 calls for becomes one (§3.2). Off by default. */
  readonly collapseExtraSpaces?: boolean;
}

/** A replacement of `[start, end)` of the original text, in UTF-16 offsets. */
export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

export type FormatResult =
  | {
    readonly kind: "Formatted";
    /** The whole document after formatting. */
    readonly text: string;
    /** The edits that turn the original into `text`, each a run of whitespace. */
    readonly edits: readonly TextEdit[];
  }
  /** The document has a syntax error, which is already reported (§2.3). */
  | { readonly kind: "SyntaxError" }
  /** §2.3's other refusals: a comment that leaves its code no room, or a failed check. */
  | { readonly kind: "Refused"; readonly message: string; readonly line?: number };

/** The selection Format selection is asked to format, in UTF-16 offsets. */
export interface FormatRange {
  readonly start: number;
  readonly end: number;
}

const CHECK_FAILED = "formatting failed: the formatted document did not check as unchanged, so nothing was changed";

/** Format document (§2.1). */
export function formatDocument(text: string, options: FormatOptions = {}): FormatResult {
  const formatted = formatWhole(text, options);
  if (formatted.kind !== "Whole") return formatted;
  return { kind: "Formatted", text: formatted.text, edits: whitespaceEdits(text, formatted.text) };
}

/**
 * Format selection (§2.2): the selection widens to the top-level items it
 * touches, and within that region the result is Format document's, byte for
 * byte. Nothing outside the region changes.
 */
export function formatSelection(text: string, selection: FormatRange, options: FormatOptions = {}): FormatResult {
  const formatted = formatWhole(text, options);
  if (formatted.kind !== "Whole") return formatted;
  const map = alignment(text, formatted.text);
  const region = regionOf(formatted.original, formatted.layout, selection, formatted.text, map);
  const { from, to } = region;
  const result = text.slice(0, region.start) + formatted.text.slice(from, to) + text.slice(region.end);
  if (result !== text) {
    const check = read(result);
    if (check.syntaxError || !sameText(formatted.original, check) || !sameTree(formatted.original, check)) {
      return { kind: "Refused", message: CHECK_FAILED };
    }
  }
  return { kind: "Formatted", text: result, edits: whitespaceEdits(text, result) };
}

type Whole =
  | { readonly kind: "Whole"; readonly text: string; readonly original: Reading; readonly layout: Whitespace.Layout }
  | Exclude<FormatResult, { kind: "Formatted" }>;

function formatWhole(text: string, options: FormatOptions): Whole {
  const original = read(text);
  if (original.syntaxError) return { kind: "SyntaxError" };
  const once = pass(original, options);
  if (once.kind !== "Pass") return once;

  const after = read(once.text);
  if (after.syntaxError || !sameText(original, after) || !sameTree(original, after)) {
    return { kind: "Refused", message: CHECK_FAILED };
  }
  // §1's third guarantee: formatting twice changes nothing.
  const twice = pass(after, options);
  if (twice.kind !== "Pass" || twice.text !== once.text) {
    return { kind: "Refused", message: CHECK_FAILED };
  }
  return { kind: "Whole", text: once.text, original, layout: once.layout };
}

function pass(reading: Reading, options: FormatOptions):
  | { readonly kind: "Pass"; readonly text: string; readonly layout: Whitespace.Layout }
  | Exclude<FormatResult, { kind: "Formatted" }> {
  const settings = { collapseExtraSpaces: options.collapseExtraSpaces === true };
  const written = Whitespace.write(reading, settings);
  if (written.kind === "Refused") {
    return { kind: "Refused", message: written.message, line: written.line };
  }
  const limit = options.maximumLineLength;
  if (limit === undefined || limit === "unlimited") {
    return { kind: "Pass", text: written.text, layout: written.layout };
  }
  const broken = breakLines(reading, written.text, limit, settings);
  return { kind: "Pass", text: broken, layout: written.layout };
}

// -----------------------------------------------------------------------------
// Format selection's region (§2.2)

interface Region {
  /** The region in the original text. */
  readonly start: number;
  readonly end: number;
  /** The same region in the formatted text. */
  readonly from: number;
  readonly to: number;
}

function regionOf(
  reading: Reading,
  layout: Whitespace.Layout,
  selection: FormatRange,
  formatted: string,
  map: ReadonlyMap<number, number>,
): Region {
  const text = reading.text;
  const tokens = reading.lexed.tokens;
  const lineStarts = lineStartOffsets(text);
  // Every element's start, by line: a comment belongs to the item after it.
  const elementStarts = [
    ...tokens.filter(({ kind }) => kind !== "Eof").map(({ span }) => span.start),
    ...reading.lexed.comments.map(({ span }) => span.start),
  ].sort((left, right) => left.offset - right.offset);

  // Groups of items, each beginning at the first element after the last line
  // of the group before; items that share a line share a group.
  interface Group { lead: number; leadOffset: number; lastLine: number }
  const groups: Group[] = [];
  let element = 0;
  for (const item of layout.items) {
    const firstLine = tokens[item.first]!.span.start.line;
    const lastLine = tokens[item.last]!.span.end.line;
    const previous = groups.at(-1);
    if (previous !== undefined && firstLine <= previous.lastLine) {
      previous.lastLine = Math.max(previous.lastLine, lastLine);
      continue;
    }
    while (element < elementStarts.length && previous !== undefined &&
      elementStarts[element]!.line <= previous.lastLine) {
      element += 1;
    }
    const lead = elementStarts[element] ?? tokens[item.first]!.span.start;
    groups.push({ lead: lead.line, leadOffset: lead.offset, lastLine });
  }
  // Comments after the last item form an item of their own.
  const last = groups.at(-1);
  if (last !== undefined) {
    const trailing = elementStarts.find(({ line }) => line > last.lastLine);
    if (trailing !== undefined) groups.push({ lead: trailing.line, leadOffset: trailing.offset, lastLine: Infinity });
  }
  if (groups.length === 0) return { start: 0, end: text.length, from: 0, to: formatted.length };

  const startOf = (group: number): number => group === 0 ? 0 : lineStarts[groups[group]!.lead]!;
  const endOf = (group: number): number => group + 1 < groups.length ? startOf(group + 1) : text.length;
  const containing = (offset: number): number => {
    let found = 0;
    groups.forEach((_, group) => {
      if (startOf(group) <= offset) found = group;
    });
    return found;
  };
  // Where a group begins in the formatted text: the line of its lead.
  const formattedStart = (group: number): number => {
    if (group === 0) return 0;
    if (group >= groups.length) return formatted.length;
    return lineStart(formatted, map.get(groups[group]!.leadOffset)!);
  };

  const first = containing(selection.start);
  const lastTouched = containing(Math.max(selection.start, selection.end - 1));
  // A selection that touches only the blank lines after an item covers them.
  const group = groups[first]!;
  if (first === lastTouched && Number.isFinite(group.lastLine) && group.lastLine + 1 < lineStarts.length) {
    const tail = lineStarts[group.lastLine + 1]!;
    if (selection.start >= tail && tail < endOf(first)) {
      let character = tail - 1;
      while (character > 0 && isWhitespace(text.charCodeAt(character))) character -= 1;
      const after = map.get(character)!;
      let from = after;
      while (from < formatted.length && !isLineEnd(formatted.charCodeAt(from))) from += 1;
      return { start: tail, end: endOf(first), from: Math.min(from + 1, formatted.length), to: formattedStart(first + 1) };
    }
  }
  return {
    start: startOf(first),
    end: endOf(lastTouched),
    from: formattedStart(first),
    to: formattedStart(lastTouched + 1),
  };
}

function isLineEnd(code: number): boolean {
  return code === 0x0a || code === 0x0d;
}

// -----------------------------------------------------------------------------
// Whitespace alignment and edits

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/** Each non-whitespace character's offset in `before`, mapped to its offset in `after`. */
function alignment(before: string, after: string): Map<number, number> {
  const map = new Map<number, number>();
  let right = 0;
  for (let left = 0; left < before.length; left += 1) {
    if (isWhitespace(before.charCodeAt(left))) continue;
    while (right < after.length && isWhitespace(after.charCodeAt(right))) right += 1;
    map.set(left, right);
    right += 1;
  }
  map.set(before.length, after.length);
  return map;
}

/** The edits, each a run of whitespace, that turn `before` into `after`. */
function whitespaceEdits(before: string, after: string): TextEdit[] {
  const edits: TextEdit[] = [];
  let left = 0;
  let right = 0;
  while (left <= before.length || right <= after.length) {
    let leftEnd = left;
    while (leftEnd < before.length && isWhitespace(before.charCodeAt(leftEnd))) leftEnd += 1;
    let rightEnd = right;
    while (rightEnd < after.length && isWhitespace(after.charCodeAt(rightEnd))) rightEnd += 1;
    const old = before.slice(left, leftEnd);
    const replacement = after.slice(right, rightEnd);
    if (old !== replacement) edits.push({ start: left, end: leftEnd, newText: replacement });
    if (leftEnd >= before.length && rightEnd >= after.length) break;
    // Past one non-whitespace character on each side; they are the same one.
    left = leftEnd + 1;
    right = rightEnd + 1;
  }
  return edits;
}

function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let offset = 0; offset < text.length; offset += 1) {
    const unit = text.charCodeAt(offset);
    if (unit === 0x0d && text.charCodeAt(offset + 1) === 0x0a) {
      offset += 1;
      starts.push(offset + 1);
    } else if (unit === 0x0a || unit === 0x0d) {
      starts.push(offset + 1);
    }
  }
  return starts;
}

function lineStart(text: string, offset: number): number {
  let start = offset;
  while (start > 0) {
    const unit = text.charCodeAt(start - 1);
    if (unit === 0x0a || unit === 0x0d) break;
    start -= 1;
  }
  return start;
}
