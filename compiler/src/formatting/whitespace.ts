/**
 * The whitespace pass: one document's lines rewritten into canonical layout —
 * line ends (Canonical Layout §4), indentation (§5), blank lines (§6), spacing
 * within a line (§7) and comments (§8). It keeps every line break the author
 * wrote in code; breaking long lines is `breaking.ts`'s.
 *
 * Indentation is read from the layout pass's own output. Its virtual tokens say
 * where each block opens, where each of its items begins and where it ends, so
 * the pass that decides what an indentation means and the pass that writes one
 * read the same structure (§5.4).
 */

import type * as Source from "../support/source.js";
import type * as Lexed from "../syntax/lexed/index.js";
import type { Scan } from "./analysis.js";
import * as Spacing from "./spacing.js";

export interface Options {
  readonly collapseExtraSpaces: boolean;
}

export type Outcome =
  | { readonly kind: "Written"; readonly text: string; readonly layout: Layout }
  | { readonly kind: "Refused"; readonly message: string; readonly line: number };

/** What the pass learned about the document, for Format selection and breaking. */
export interface Layout {
  /** The document's top-level items, in order (§2.2). */
  readonly items: readonly TopLevelItem[];
}

export interface TopLevelItem {
  /** Token indices of the item's first and last tokens. */
  readonly first: number;
  readonly last: number;
}

/** Four columns to a level of indentation (§5.1). */
export const LEVEL = 4;

const BYTE_ORDER_MARK = "﻿";

type Element =
  | { readonly kind: "token"; readonly index: number; readonly start: number; readonly end: number; readonly startLine: number; readonly endLine: number }
  | { readonly kind: "comment"; readonly comment: Source.Comment; readonly start: number; readonly end: number; readonly startLine: number; readonly endLine: number };

interface Line {
  readonly start: number;
  /** Where the line's text ends, before its line end. */
  readonly end: number;
}

interface Frame {
  readonly kind: "block" | "bracket";
  /** The column of the frame's items: a block's, or an open bracket pair's. */
  readonly itemIndent: number;
  readonly openerLine: number;
  readonly open: boolean;
  /** A block whose items are arms: `match`'s and `catch`'s. */
  readonly arms: boolean;
  itemStart: number;
  newItem: boolean;
}

type ItemKind = "import" | "header" | "closer" | "declaration" | "statement";

const declarationKinds = new Set<string>([
  "Export", "Let", "Var", "Fun", "Type", "Record", "Exception", "Constraint", "Honor", "Extern", "Derive",
]);
const declarationWords = new Set(["union", "pattern", "widens", "fault", "opaque", "class"]);

const continuationKinds = new Set<string>([
  "Dot", "Pipe", "Plus", "Star", "Slash", "EqualEqual", "NotEqual", "LessEqual", "GreaterEqual",
  "Greater", "Range", "Arrow", "Comma", "And", "Or",
]);

const openers = new Set<string>(["LeftParen", "LeftBracket", "LeftBrace"]);
const closers = new Set<string>(["RightParen", "RightBracket", "RightBrace"]);
const clauses = new Set<string>(["Else", "Catch", "Finally"]);
const controls = new Set<string>(["If", "For", "While", "Match", "Try", "Attempt", "Assume"]);

export function write(reading: Scan, options: Options): Outcome {
  return new Writer(reading, options).write();
}

class Writer {
  readonly #text: string;
  readonly #options: Options;
  readonly #reading: Scan;
  readonly #tokens: readonly Lexed.Token[];
  readonly #lines: readonly Line[];
  readonly #elements: readonly Element[];
  /** For each line, the index of its first code token, where code begins it. */
  readonly #firstToken = new Map<number, number>();
  /** The column each line that holds code is written at (§5). */
  readonly #indent = new Map<number, number>();
  readonly #matching = new Map<number, number>();
  readonly #beginsItem = new Set<number>();
  readonly #opensBlock = new Set<number>();
  readonly #items: TopLevelItem[] = [];
  readonly #itemKinds: ItemKind[] = [];
  readonly #multiLine = new Set<number>();
  readonly #openPairs = new Set<number>();
  #lastTokens: Map<number, number> | undefined;
  #nextIndents: Map<number, number> | undefined;
  /** In a union declaration at top level, the line of its latest `|` alternative. */
  #alternativeLine = -1;

  constructor(reading: Scan, options: Options) {
    this.#reading = reading;
    this.#text = reading.text;
    this.#options = options;
    this.#tokens = reading.lexed.tokens.filter(({ kind }) => kind !== "Eof");
    this.#lines = splitLines(this.#text);
    this.#elements = this.#readElements();
  }

  write(): Outcome {
    this.#matchBrackets();
    this.#walk();
    const rendered = this.#render();
    if (rendered.kind === "Refused") return rendered;
    const text = this.#arrangeBlankLines(rendered.lines);
    return { kind: "Written", text, layout: { items: this.#items } };
  }

  // ---------------------------------------------------------------------------
  // Reading the document

  #readElements(): Element[] {
    const elements: Element[] = [];
    const strings: { start: number; end: number }[] = [];
    this.#tokens.forEach((token, index) => {
      elements.push({
        kind: "token",
        index,
        start: token.span.start.offset,
        end: token.span.end.offset,
        startLine: token.span.start.line,
        endLine: token.span.end.line,
      });
      if (token.kind === "String") strings.push({ start: token.span.start.offset, end: token.span.end.offset });
    });
    for (const comment of this.#reading.lexed.comments) {
      const start = comment.span.start.offset;
      // A comment inside a string's interpolation is the string's.
      if (strings.some((string) => string.start <= start && start < string.end)) continue;
      elements.push({
        kind: "comment",
        comment,
        start,
        end: comment.span.end.offset,
        startLine: comment.span.start.line,
        endLine: comment.span.end.line,
      });
    }
    elements.sort((left, right) => left.start - right.start);
    for (const element of elements) {
      if (element.kind !== "token") continue;
      const line = element.startLine;
      if (!this.#firstToken.has(line) && this.#beginsLine(element.index)) {
        this.#firstToken.set(line, element.index);
      }
    }
    return elements;
  }

  /** Whether a token is the first code on its line. */
  #beginsLine(index: number): boolean {
    if (index === 0) return true;
    return this.#tokens[index - 1]!.span.end.line < this.#tokens[index]!.span.start.line;
  }

  #matchBrackets(): void {
    const stack: number[] = [];
    this.#tokens.forEach((token, index) => {
      if (openers.has(token.kind)) stack.push(index);
      else if (closers.has(token.kind)) {
        const open = stack.pop();
        if (open !== undefined) {
          this.#matching.set(open, index);
          this.#matching.set(index, open);
        }
      }
    });
  }

  #lineOf(index: number): number {
    return this.#tokens[index]!.span.start.line;
  }

  /** The column a line is written at: its code's, or else as the author wrote it. */
  #lineIndent(line: number): number {
    const indent = this.#indent.get(line);
    if (indent !== undefined) return indent;
    const { start, end } = this.#lines[line]!;
    const leading = /^[ \t]*/u.exec(this.#text.slice(start, end))![0];
    return visualWidth(leading, 0);
  }

  /** The column, as the author wrote it, of the first code on a line. */
  #authorColumn(line: number): number | undefined {
    const first = this.#firstToken.get(line);
    return first === undefined ? undefined : this.#tokens[first]!.span.start.column;
  }

  // ---------------------------------------------------------------------------
  // Indentation (§5)

  #walk(): void {
    const index = new Map<Lexed.Token, number>();
    this.#tokens.forEach((token, position) => index.set(token, position));
    const frames: Frame[] = [];
    let previous = -1;
    let sawClose = false;
    let topItem = -1;
    let unionLines = 0;

    for (const token of this.#reading.laidOut.tokens) {
      if (token.kind === "VOpen") {
        if (frames.length === 0) {
          frames.push(block(0, false));
        } else {
          const owner = this.#owner(frames.at(-1)!, previous);
          const arms = this.#headsArms(frames.at(-1)!, previous);
          frames.push(block(this.#lineIndent(this.#lineOf(owner)) + LEVEL, arms));
          this.#opensBlock.add(this.#tokens[previous]!.span.end.line);
        }
        continue;
      }
      if (token.kind === "VSep") {
        const frame = frames.at(-1);
        if (frame !== undefined) frame.newItem = true;
        continue;
      }
      if (token.kind === "VClose") {
        if (frames.at(-1)?.kind === "block") frames.pop();
        sawClose = true;
        continue;
      }
      if (token.kind === "Eof") break;
      const position = index.get(token as Lexed.Token);
      if (position === undefined) continue;
      const frame = frames.at(-1)!;

      if (frame.newItem) this.#beginsItem.add(position);
      if (this.#firstToken.get(token.span.start.line) === position) {
        const indent = this.#indentOf(frames, position, previous, sawClose);
        this.#indent.set(token.span.start.line, indent);
        // §6.3: a line that begins a block's second or later item, below the
        // module's own block, makes its declaration multi-line.
        if (frames.length > 1 && frame.kind === "block" && frame.newItem && frame.itemStart !== -1) {
          this.#multiLine.add(topItem);
        }
        if (frames.length === 1 && topItem !== -1 && this.#isUnion(this.#items[topItem]!.first)) {
          if (token.kind === "Bar") this.#alternativeLine = token.span.start.line;
          const first = this.#tokens[previous];
          if (token.kind === "Bar" || first?.kind === "Equal") {
            unionLines += 1;
            if (unionLines >= 2) this.#multiLine.add(topItem);
          }
        }
      }

      if (frames.length === 1 && frame.newItem) {
        this.#items.push({ first: position, last: position });
        this.#itemKinds.push(this.#itemKind(position));
        topItem = this.#items.length - 1;
        unionLines = 0;
        this.#alternativeLine = -1;
      }
      if (frame.newItem) {
        frame.itemStart = position;
        frame.newItem = false;
      }
      if (topItem !== -1) this.#items[topItem] = { first: this.#items[topItem]!.first, last: position };

      if (openers.has(token.kind)) {
        const close = this.#matching.get(position);
        const open = close !== undefined && this.#firstToken.get(this.#lineOf(close)) === close;
        if (open) this.#openPairs.add(position);
        const line = token.span.start.line;
        frames.push({
          kind: "bracket",
          itemIndent: this.#lineIndent(line) + LEVEL,
          openerLine: line,
          open,
          arms: false,
          itemStart: -1,
          newItem: true,
        });
      } else if (closers.has(token.kind)) {
        if (frames.at(-1)?.kind === "bracket") frames.pop();
      } else if (token.kind === "Comma" && frame.kind === "bracket") {
        frame.newItem = true;
      } else if (token.kind === "Semicolon" && frame.kind === "block") {
        frame.newItem = true;
      }
      previous = position;
      sawClose = false;
    }
  }

  #indentOf(frames: readonly Frame[], position: number, previous: number, sawClose: boolean): number {
    const token = this.#tokens[position]!;
    const frame = frames.at(-1)!;
    const before = this.#tokens[previous];
    // A union's alternatives are items of their own (§5.1): a line carried on
    // within one is measured from the alternative's line.
    const itemLine = (target: Frame): number => {
      if (target.itemStart === -1) return this.#lineOf(position);
      if (target === frames[0] && this.#alternativeLine > this.#lineOf(target.itemStart)) {
        return this.#alternativeLine;
      }
      return this.#lineOf(target.itemStart);
    };
    const parent = frames.at(-2);

    if (frames.length === 1 && frame.newItem) return 0;
    if (closers.has(token.kind) && frame.kind === "bracket") return this.#lineIndent(frame.openerLine);
    if (frame.kind === "block" && frame.newItem) return frame.itemIndent;
    if (clauses.has(token.kind)) return this.#lineIndent(itemLine(frame));
    if (token.kind === "Then" && token.span.start.column === this.#authorColumn(itemLine(frame))) {
      return this.#lineIndent(itemLine(frame));
    }
    if (frame.kind === "bracket" && frame.newItem) {
      if (frame.open) return frame.itemIndent;
      return this.#lineIndent(parent === undefined ? this.#lineOf(position) : itemLine(parent)) + 2 * LEVEL;
    }
    if (before?.kind === "Equal") return this.#lineIndent(itemLine(frame)) + LEVEL;
    if (token.kind === "Bar" && frame.itemStart !== -1 && this.#isUnion(frame.itemStart)) {
      return this.#lineIndent(this.#lineOf(frame.itemStart)) + LEVEL;
    }
    // The item a line continues holds both its first token and the one
    // before it; a comma between brackets belongs to the item around them.
    const holder = token.kind === "Comma" && frame.kind === "bracket" && parent !== undefined ? parent : frame;
    const line = itemLine(holder);
    if (continuationKinds.has(token.kind) && token.span.start.column === this.#authorColumn(line)) {
      return this.#lineIndent(line);
    }
    if (sawClose) return this.#lineIndent(line);
    return this.#lineIndent(line) + 2 * LEVEL;
  }

  /** The token that begins the construct owning the block a head opens (§5.3). */
  #owner(frame: Frame, head: number): number {
    const token = this.#tokens[head]!;
    const from = frame.itemStart === -1 ? head : frame.itemStart;
    if (token.kind === "Then") return this.#matchingIf(head, from);
    if (clauses.has(token.kind)) return head;
    if (token.kind === "FatArrow") {
      if (frame.kind === "block" && frame.arms) return from;
      return this.#lambdaStart(head);
    }
    return this.#lastControl(from, head) ?? from;
  }

  #headsArms(frame: Frame, head: number): boolean {
    const token = this.#tokens[head]!;
    if (token.kind === "Catch") return true;
    if (token.kind === "Then" || token.kind === "FatArrow" || clauses.has(token.kind)) return false;
    const from = frame.itemStart === -1 ? head : frame.itemStart;
    const control = this.#lastControl(from, head);
    return control !== undefined && this.#tokens[control]!.kind === "Match";
  }

  #matchingIf(then: number, from: number): number {
    let depth = 0;
    for (let index = then - 1; index >= from; index -= 1) {
      const kind = this.#tokens[index]!.kind;
      if (closers.has(kind)) {
        index = this.#matching.get(index) ?? index;
        continue;
      }
      if (kind === "Then") depth += 1;
      else if (kind === "If") {
        if (depth === 0) return index;
        depth -= 1;
      }
    }
    return from;
  }

  #lambdaStart(arrow: number): number {
    const before = arrow - 1;
    const token = this.#tokens[before];
    if (token?.kind !== "RightParen") return Math.max(before, 0);
    const open = this.#matching.get(before) ?? before;
    if (this.#tokens[open - 1]?.kind === "Greater") {
      let depth = 0;
      for (let index = open - 1; index >= 0; index -= 1) {
        const kind = this.#tokens[index]!.kind;
        if (kind === "Greater") depth += 1;
        else if (kind === "Less") {
          depth -= 1;
          if (depth === 0) return index;
        }
      }
    }
    return open;
  }

  /** Lexer & Layout's `lastControlHead`, over the tokens of one item. */
  #lastControl(from: number, to: number): number | undefined {
    for (let index = to; index >= from; index -= 1) {
      const kind = this.#tokens[index]!.kind;
      const next = this.#tokens[index + 1]?.kind;
      if (index < to && (next === "Comma" || next === "RightBrace")) continue;
      if ((kind === "Attempt" || kind === "Assume") && index !== to) continue;
      if (controls.has(kind)) return index;
    }
    return undefined;
  }

  #pastVisibility(first: number): number {
    let index = first;
    if (this.#tokens[index]?.kind === "Export") index += 1;
    const word = this.#tokens[index];
    if (word?.kind === "NonUpperName" && word.text === "opaque") index += 1;
    return index;
  }

  #isUnion(first: number): boolean {
    const token = this.#tokens[this.#pastVisibility(first)];
    return token?.kind === "Extern" || token?.kind === "Type" ||
      (token?.kind === "NonUpperName" && token.text === "union");
  }

  #itemKind(first: number): ItemKind {
    const token = this.#tokens[first]!;
    const next = this.#tokens[first + 1];
    if (token.kind === "Import") return "import";
    if (token.kind === "Extern" && next?.kind === "Import") return "import";
    if (token.kind === "NonUpperName") {
      if (token.text === "module" && next?.kind === "UpperName") return "header";
      if (token.text === "end" && next?.kind === "NonUpperName" && next.text === "module") return "closer";
      if (declarationWords.has(token.text) && next !== undefined &&
        (next.kind === "UpperName" || next.kind === "NonUpperName" || declarationKinds.has(next.kind))) {
        return "declaration";
      }
    }
    return declarationKinds.has(token.kind) ? "declaration" : "statement";
  }

  // ---------------------------------------------------------------------------
  // Rendering each line (§4, §7, §8)

  #render():
    | { readonly kind: "Lines"; readonly lines: readonly RenderedLine[] }
    | { readonly kind: "Refused"; readonly message: string; readonly line: number } {
    const roles = Spacing.roles(this.#tokens, this.#beginsItem);
    const output: RenderedLine[] = [];
    let cursor = 0;
    /** An element that runs on past the end of its line, and its shift. */
    let spanning: { readonly element: Element; readonly shift: number } | undefined;

    for (let lineNumber = 0; lineNumber < this.#lines.length; lineNumber += 1) {
      const line = this.#lines[lineNumber]!;
      const here: Element[] = [];
      while (cursor < this.#elements.length && this.#elements[cursor]!.startLine === lineNumber) {
        here.push(this.#elements[cursor]!);
        cursor += 1;
      }

      let text = "";
      let kind: RenderedLine["kind"];
      let previous: Element | undefined;

      if (spanning !== undefined && spanning.element.endLine >= lineNumber) {
        const end = Math.min(spanning.element.end, line.end);
        text = shiftLine(this.#text.slice(line.start, end), spanning.shift);
        kind = "content";
        previous = spanning.element;
        if (spanning.element.endLine === lineNumber) spanning = undefined;
        if (spanning !== undefined) {
          output.push({ text, kind, source: lineNumber });
          continue;
        }
      } else if (here.length === 0) {
        output.push({ text: "", kind: "blank", source: lineNumber });
        continue;
      } else {
        kind = here[0]!.kind === "token" ? "code" : "comment";
      }

      let index = 0;
      if (previous === undefined) {
        // The line begins with an element: place it.
        const first = here[0]!;
        const placed = this.#place(lineNumber, here);
        if (placed.kind === "Refused") return placed;
        text = placed.text;
        index = placed.count;
        previous = here[placed.count - 1]!;
        if (first.kind === "comment" && first.endLine > lineNumber) {
          spanning = { element: first, shift: this.#commentShift(first, placed.firstColumn) };
        } else if (previous.endLine > lineNumber) {
          spanning = { element: previous, shift: 0 };
        }
      }

      for (; index < here.length; index += 1) {
        const element = here[index]!;
        const gap = this.#gap(previous!, element, roles, index === here.length - 1);
        text += gap;
        const piece = this.#text.slice(element.start, Math.min(element.end, line.end));
        text += piece;
        previous = element;
        if (element.endLine > lineNumber) spanning = { element, shift: 0 };
      }
      output.push({ text, kind, source: lineNumber });
    }
    return { kind: "Lines", lines: output };
  }

  /**
   * Places a line's first elements: its code at its indentation, and the
   * comments before that code (§8.2).
   */
  #place(lineNumber: number, here: readonly Element[]):
    | { readonly kind: "Placed"; readonly text: string; readonly count: number; readonly firstColumn: number }
    | { readonly kind: "Refused"; readonly message: string; readonly line: number } {
    const line = this.#lines[lineNumber]!;
    const codeAt = here.findIndex((element) => element.kind === "token");
    const first = here[0]!;
    if (codeAt === 0) {
      const indent = this.#indent.get(lineNumber) ?? 0;
      const piece = this.#text.slice(first.start, Math.min(first.end, line.end));
      const text = " ".repeat(indent) + piece;
      return { kind: "Placed", text, count: 1, firstColumn: indent };
    }
    if (codeAt === -1) {
      const indent = this.#nextCodeIndent(lineNumber);
      const piece = this.#text.slice(first.start, Math.min(first.end, line.end));
      const text = " ".repeat(indent) + piece;
      return { kind: "Placed", text, count: 1, firstColumn: indent };
    }
    // Comments, then code: the code goes where §5 puts it and the comments keep
    // their place before it, the last gap shrinking to one space if it must.
    const target = this.#indent.get(lineNumber) ?? 0;
    const code = here[codeAt]!;
    const lineText = this.#text.slice(line.start, line.end);
    const from = visualWidth(this.#text.slice(line.start, first.start), 0);
    const lastComment = here[codeAt - 1]!;
    const commentsWidth = visualWidth(this.#text.slice(line.start, lastComment.end), 0) - from;
    const gap = visualWidth(this.#text.slice(line.start, code.start), 0) -
      visualWidth(this.#text.slice(line.start, lastComment.end), 0);
    let start = target - commentsWidth - gap;
    let lastGap = gap;
    if (start < 0) {
      lastGap = Math.max(1, gap + start);
      start = target - commentsWidth - lastGap;
    }
    if (start < 0) {
      return {
        kind: "Refused",
        message: `the comment on line ${lineNumber + 1} leaves its code no room; move it to a line of its own`,
        line: lineNumber,
      };
    }
    let text = " ".repeat(start);
    const base = line.start;
    // The comments as written, and the gaps between them with tabs expanded.
    for (let index = 0; index < codeAt; index += 1) {
      const element = here[index]!;
      if (index > 0) {
        const before = here[index - 1]!;
        text += expandTabs(lineText.slice(before.end - base, element.start - base),
          visualWidth(lineText.slice(0, before.end - base), 0));
      }
      text += lineText.slice(element.start - base, element.end - base);
    }
    text += " ".repeat(lastGap);
    text += this.#text.slice(code.start, Math.min(code.end, line.end));
    return { kind: "Placed", text, count: codeAt + 1, firstColumn: start };
  }

  #nextCodeIndent(lineNumber: number): number {
    if (this.#nextIndents === undefined) {
      const next = new Map<number, number>();
      let following = 0;
      for (let line = this.#lines.length - 1; line >= 0; line -= 1) {
        next.set(line, following);
        following = this.#indent.get(line) ?? following;
      }
      this.#nextIndents = next;
    }
    return this.#nextIndents.get(lineNumber) ?? 0;
  }

  /**
   * How far a comment that spans lines moves its later lines: as far as its
   * first line moved, unless that would cut into a later line's text (§8.2).
   */
  #commentShift(element: Element, column: number): number {
    const line = this.#lines[element.startLine]!;
    const shift = column - visualWidth(this.#text.slice(line.start, element.start), 0);
    if (shift >= 0) return shift;
    for (let number = element.startLine + 1; number <= element.endLine; number += 1) {
      const { start, end } = this.#lines[number]!;
      const content = this.#text.slice(start, number === element.endLine ? Math.min(end, element.end) : end);
      if (content.trim() === "") continue;
      const leading = /^[ \t]*/u.exec(content)![0];
      if (leading.includes("\t") || leading.length < -shift) return 0;
    }
    return shift;
  }

  #gap(left: Element, right: Element, roles: Spacing.Roles, last: boolean): string {
    const lineNumber = right.startLine;
    const line = this.#lines[lineNumber]!;
    const leftEnd = Math.max(left.end, line.start);
    const authored = visualWidth(this.#text.slice(line.start, right.start), 0) -
      visualWidth(this.#text.slice(line.start, leftEnd), 0);
    if (left.kind === "comment" || right.kind === "comment") {
      if (right.kind === "comment" && left.kind === "token" && last) return " ".repeat(Math.max(1, authored));
      return " ".repeat(authored);
    }
    const rule = Spacing.rule(this.#tokens, roles, left.index, authored > 0);
    const collapse = this.#options.collapseExtraSpaces;
    switch (rule) {
      case "one":
        return " ".repeat(collapse ? 1 : Math.max(1, authored));
      case "none": {
        if (authored === 0) return "";
        const leftText = this.#text.slice(left.start, left.end);
        const rightText = this.#text.slice(right.start, right.end);
        const kinds = [this.#tokens[left.index]!.kind, this.#tokens[right.index]!.kind] as const;
        return Spacing.canJoin(leftText, rightText, kinds) ? "" : " ";
      }
      case "kept":
      case "presence":
        return authored === 0 ? "" : " ".repeat(collapse ? 1 : authored);
    }
  }

  // ---------------------------------------------------------------------------
  // Blank lines (§6)

  #arrangeBlankLines(lines: readonly RenderedLine[]): string {
    const removed = new Set<number>();
    const beginsClosing = (rendered: RenderedLine): boolean => {
      if (rendered.kind !== "code") return false;
      const first = this.#firstToken.get(rendered.source);
      if (first === undefined) return false;
      const kind = this.#tokens[first]!.kind;
      return closers.has(kind) || clauses.has(kind);
    };
    const endsOpening = (rendered: RenderedLine): boolean => {
      if (this.#opensBlock.has(rendered.source)) return true;
      const last = this.#lastTokenOn(rendered.source);
      return last !== undefined && this.#openPairs.has(last);
    };

    let index = 0;
    while (index < lines.length) {
      if (lines[index]!.kind !== "blank") {
        index += 1;
        continue;
      }
      let end = index;
      while (end < lines.length && lines[end]!.kind === "blank") end += 1;
      const before = lines[index - 1];
      const after = lines[end];
      const drop =
        before === undefined || after === undefined || endsOpening(before) || beginsClosing(after);
      for (let blank = index; blank < end; blank += 1) {
        if (drop || blank > index) removed.add(blank);
      }
      index = end;
    }

    // §6.2: the blank lines the formatter adds, each directly after something.
    const addAfter = new Set<number>();
    for (let item = 0; item + 1 < this.#items.length; item += 1) {
      const kind = this.#itemKinds[item]!;
      const next = this.#itemKinds[item + 1]!;
      const lastLine = this.#endOfLine(this.#tokens[this.#items[item]!.last]!.span.end.line);
      const nextLine = this.#tokens[this.#items[item + 1]!.first]!.span.start.line;
      if (lastLine === nextLine) continue;
      const follows = next === "declaration" || next === "statement";
      if (
        (kind === "import" && follows) ||
        (kind === "declaration" && this.#multiLine.has(item) && (follows || next === "import")) ||
        (kind === "closer" && next === "header")
      ) {
        addAfter.add(lastLine);
      }
    }

    const kept: string[] = [];
    lines.forEach((rendered, position) => {
      if (removed.has(position)) return;
      kept.push(rendered.text);
      if (addAfter.has(rendered.source)) {
        let next = position + 1;
        while (next < lines.length && removed.has(next)) next += 1;
        if (next < lines.length && lines[next]!.kind !== "blank") kept.push("");
      }
    });
    const bom = this.#text.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : "";
    if (kept.length === 0) return bom;
    return bom + kept.join("\n") + "\n";
  }

  #lastTokenOn(lineNumber: number): number | undefined {
    if (this.#lastTokens === undefined) {
      const last = new Map<number, number>();
      for (const element of this.#elements) {
        if (element.kind === "token") last.set(element.endLine, element.index);
      }
      this.#lastTokens = last;
    }
    return this.#lastTokens.get(lineNumber);
  }

  /** The line on which the last element that begins on a line ends. */
  #endOfLine(lineNumber: number): number {
    let end = lineNumber;
    for (const element of this.#elements) {
      if (element.startLine > lineNumber) break;
      if (element.startLine === lineNumber) end = Math.max(end, element.endLine);
    }
    return end;
  }
}

interface RenderedLine {
  readonly text: string;
  readonly kind: "blank" | "code" | "comment" | "content";
  /** The line of the author's document this one was written from. */
  readonly source: number;
}

function block(itemIndent: number, arms: boolean): Frame {
  return { kind: "block", itemIndent, openerLine: -1, open: false, arms, itemStart: -1, newItem: true };
}

/** The document's lines, split at every line end Lexer §2.1 admits (§4). */
function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = text.startsWith(BYTE_ORDER_MARK) ? 1 : 0;
  for (let offset = start; offset < text.length; offset += 1) {
    const unit = text.charCodeAt(offset);
    if (unit === 0x0a || unit === 0x0d) {
      lines.push({ start, end: offset });
      if (unit === 0x0d && text.charCodeAt(offset + 1) === 0x0a) offset += 1;
      start = offset + 1;
    }
  }
  lines.push({ start, end: text.length });
  return lines;
}

/**
 * The width of some text in columns, counted in code points, with each tab
 * advancing to the next multiple of four (§7.3), from a starting column.
 */
export function visualWidth(text: string, from: number): number {
  let column = from;
  for (const character of text) {
    column = character === "\t" ? (Math.floor(column / LEVEL) + 1) * LEVEL : column + 1;
  }
  return column - from;
}

function expandTabs(text: string, from: number): string {
  let column = from;
  let out = "";
  for (const character of text) {
    if (character === "\t") {
      const next = (Math.floor(column / LEVEL) + 1) * LEVEL;
      out += " ".repeat(next - column);
      column = next;
    } else {
      out += character;
      column += 1;
    }
  }
  return out;
}

function shiftLine(text: string, shift: number): string {
  if (shift === 0 || text.trim() === "") return text;
  if (shift > 0) return " ".repeat(shift) + text;
  return text.slice(-shift);
}
