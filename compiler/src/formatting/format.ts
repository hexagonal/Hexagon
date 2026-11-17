/**
 * Format document and Format selection (spec/canonical-layout.md).
 *
 * Both are pure functions of a document's text and the four options. They
 * rewrite whitespace and add §14's trailing commas and §16's leading bars, and
 * nothing else, and check that on every run: the output's tokens and comments
 * are the input's apart from those commas and bars, those inside interpolation
 * holes included, every string's text is the input's as written, it parses to
 * the same tree, and formatting it again changes nothing (§1, §12). A document with a syntax
 * error is refused without a report of the formatter's own (§2.3), since the
 * error is already reported.
 */

import { read, sameText, sameTree, type Reading } from "./analysis.js";
import { breakLines } from "./breaking.js";
import { addBars } from "./bars.js";
import { addCommas } from "./commas.js";
import * as Whitespace from "./whitespace.js";

export interface FormatOptions {
  /**
   * The longest a line of code may be before it is broken, in code points, or
   * `"unlimited"`, under which no line is ever broken (§3.1). The default.
   */
  readonly maximumLineLength?: number | "unlimited";
  /** Whether a gap wider than the one space §7 calls for becomes one (§3.2). Off by default. */
  readonly collapseExtraSpaces?: boolean;
  /** Whether Format document adds no trailing commas (§3.4). Off by default. */
  readonly leaveTrailingCommasAsWritten?: boolean;
  /**
   * Whether Format document also spreads a construct on one line that is
   * wider than its width limit, or whose kind is never on one line, though
   * its line fits (§3.5, §15). Off by default.
   */
  readonly applyWidthLimits?: boolean;
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
    /** The edits that turn the original into `text`: runs of whitespace, and the commas and bars added (§14, §16). */
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
    if (check.syntaxError || !sameText(formatted.original, check, adds(options), true, true) || !sameTree(formatted.original, check)) {
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
  if (after.syntaxError || !sameText(original, after, adds(options), true, true) || !sameTree(original, after)) {
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
  // Lines are broken first, each counting the comma §14 would add whether or
  // not it is written (§9.2), and the commas go in once the brackets are open.
  let text = written.text;
  const limit = options.maximumLineLength;
  const widths = options.applyWidthLimits === true;
  if ((limit !== undefined && limit !== "unlimited") || widths) {
    const length = limit === undefined || limit === "unlimited" ? Infinity : limit;
    text = breakLines(reading, text, length, settings, widths);
  }
  if (adds(options)) text = addCommas(text);
  // A union's leading bar, which no option turns off (§16).
  text = addBars(text);
  return { kind: "Pass", text, layout: written.layout };
}

/** Whether Format document adds §14's trailing commas. */
function adds(options: FormatOptions): boolean {
  return options.leaveTrailingCommasAsWritten !== true;
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

  // The blank lines at the end of a group, after its last code or comment.
  const tailOf = (group: number): number => {
    const end = endOf(group);
    let line = lineStarts.findIndex((offset) => offset >= end);
    if (line === -1) line = lineStarts.length;
    let tail = line;
    while (tail - 1 > groups[group]!.lead && isBlank(text, lineStarts, tail - 1)) tail -= 1;
    return tail < lineStarts.length ? lineStarts[tail]! : end;
  };

  let first = containing(selection.start);
  const lastTouched = containing(Math.max(selection.start, selection.end - 1));
  const tail = tailOf(first);
  if (selection.start >= tail && tail < endOf(first)) {
    if (lastTouched === first) {
      // A selection that touches only the blank lines after an item covers them.
      let character = tail - 1;
      while (character > 0 && isWhitespace(text.charCodeAt(character))) character -= 1;
      let from = map.get(character)!;
      while (from < formatted.length && !isLineEnd(formatted.charCodeAt(from))) from += 1;
      return { start: tail, end: endOf(first), from: Math.min(from + 1, formatted.length), to: formattedStart(first + 1) };
    }
    // It begins in those blank lines and touches no line of the item before them.
    first += 1;
  }
  return {
    start: startOf(first),
    end: endOf(lastTouched),
    from: formattedStart(first),
    to: formattedStart(lastTouched + 1),
  };
}

function isBlank(text: string, lineStarts: readonly number[], line: number): boolean {
  const start = lineStarts[line]!;
  const end = line + 1 < lineStarts.length ? lineStarts[line + 1]! : text.length;
  return text.slice(start, end).trim() === "";
}

function isLineEnd(code: number): boolean {
  return code === 0x0a || code === 0x0d;
}

// -----------------------------------------------------------------------------
// Whitespace alignment and edits

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/**
 * Each non-whitespace character's offset in `before`, mapped to its offset in
 * `after`. A comma or bar Format document added is passed over (`added`).
 */
function alignment(before: string, after: string): Map<number, number> {
  const map = new Map<number, number>();
  let right = 0;
  for (let left = 0; left < before.length; left += 1) {
    if (isWhitespace(before.charCodeAt(left))) continue;
    while (right < after.length && (isWhitespace(after.charCodeAt(right)) || added(before, left, after, right))) {
      right += 1;
    }
    map.set(left, right);
    if (removed(before, left, after, right)) continue;
    right += 1;
  }
  map.set(before.length, after.length);
  return map;
}

/**
 * Whether the character `after` holds at `right` is one Format document
 * added where `before` holds something else at `left`: a comma §14 added,
 * which stands directly before a closing bracket and so is never followed by
 * a comma of the author's, or a bar §16 added, which stands directly before an
 * alternative's first token and so is never followed by a bar of the author's.
 */
function added(before: string, left: number, after: string, right: number): boolean {
  const character = after[right];
  return (character === "," || character === "|") && before[left] !== character;
}

/**
 * Whether the character `before` holds at `left` is a comma Format document
 * removed (§14): `after` holds something else there. A removed comma stands
 * directly before a closing bracket, and nothing is added there.
 */
function removed(before: string, left: number, after: string, right: number): boolean {
  return before[left] === "," && after[right] !== ",";
}

/**
 * The edits that turn `before` into `after`: each replaces a run of
 * whitespace, and takes in any comma or bar Format document added there
 * (see `added`).
 */
function whitespaceEdits(before: string, after: string): TextEdit[] {
  const edits: TextEdit[] = [];
  let left = 0;
  let right = 0;
  while (left <= before.length || right <= after.length) {
    let leftEnd = left;
    let rightEnd = right;
    for (;;) {
      while (leftEnd < before.length && isWhitespace(before.charCodeAt(leftEnd))) leftEnd += 1;
      while (rightEnd < after.length && (isWhitespace(after.charCodeAt(rightEnd)) ||
        added(before, leftEnd, after, rightEnd))) rightEnd += 1;
      if (!removed(before, leftEnd, after, rightEnd)) break;
      leftEnd += 1;
    }
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
