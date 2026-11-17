/**
 * Wide constructs (Canonical Layout §15) and the check that names every
 * construct in the wrong shape (§12 item 6; `notes/canonical-formatting-and-naming.md` H9).
 *
 * Each kind of construct in §15.1's table has one rule for whether it may
 * stand on one line: a width limit, or never. A construct is measured as it
 * would read on one line, its tokens spaced as §7 spaces them with Collapse
 * extra spaces on, without a trailing comma (§15.2). The formatter spreads a
 * construct on one line that breaks its rule (`spreads`), and the check
 * names both halves of H9: a construct on one line that breaks its rule, and
 * a spread construct that could stand on one line, within its rule, on a line
 * that fits (`wrongShapes`).
 */

import { read, type Reading } from "./analysis.js";
import * as Spacing from "./spacing.js";
import type * as Lexed from "../syntax/lexed/index.js";

/** The kinds of construct the check reads: §15.1's rows, and the kinds with no width limit that H9 names. */
export type ConstructKind =
  | "conditional"
  | "loop"
  | "chain"
  | "arguments"
  | "record"
  | "record declaration"
  | "union"
  | "lambda"
  | "arm"
  | "and/or"
  | "vector"
  | "tuple"
  | "call"
  | "arithmetic"
  | "header";

/** §15.1's width limits. A kind not here has none: the line limit decides it. */
export const WIDTH_LIMITS: Readonly<Partial<Record<ConstructKind, number>>> = {
  conditional: 60,
  loop: 60,
  chain: 60,
  arguments: 60,
  record: 60,
  "record declaration": 60,
  union: 60,
  lambda: 60,
  arm: 80,
  "and/or": 80,
};

/** One construct of a document, by token index into `reading.lexed.tokens`. */
export interface Construct {
  readonly kind: ConstructKind;
  /** The first and last tokens of what its width measures (§15.2). */
  readonly first: number;
  readonly last: number;
  /** The tokens whose sharing a line puts it on one line (§15.2). */
  readonly opens: number;
  readonly closes: number;
  /** The tokens of the text that would stand on its line were it on one line. */
  readonly whole: readonly [number, number];
  /** Its width as it would read on one line, in code points (§15.2). */
  readonly width: number;
  /** Whether its row says never (§15.1). */
  readonly never: boolean;
  /** Whether its first token and its closing token share a line. */
  readonly onOneLine: boolean;
  /** Whether it must be spread: its own row, or something in it that must be (H9). */
  readonly mustSpread: boolean;
}

/** Whether a construct breaks its row of §15.1: never on one line, or wider than its width limit. */
export function overLimit(construct: Pick<Construct, "kind" | "width" | "never">): boolean {
  if (construct.never) return true;
  const limit = WIDTH_LIMITS[construct.kind];
  return limit !== undefined && construct.width > limit;
}

/** The constructs on one line that Apply width limits spreads (§15.3). */
export function spreads(reading: Reading): Construct[] {
  return constructs(reading).filter((construct) => construct.onOneLine && overLimit(construct));
}

/** A construct in the wrong shape, as the check names it (§12 item 6). */
export interface WrongShape {
  /** The line it begins on, counted from 1. */
  readonly line: number;
  readonly kind: ConstructKind;
  /**
   * `"spread"`: it stands on one line, and its row spreads it. `"one line"`:
   * it is spread, though it is within its width limit, nothing in it must be
   * spread, and on one line it would fit its line.
   */
  readonly should: "spread" | "one line";
  /** Its width on one line. */
  readonly width: number;
  /** Its width limit, or `"never"`, or `undefined` for a kind with none. */
  readonly limit: number | "never" | undefined;
  /** Its text as it would read on one line. */
  readonly text: string;
}

/**
 * Every construct in the wrong shape in house text (H9): one on one line that
 * its row spreads, and one spread that could stand on one line on a line no
 * longer than `maximumLineLength`, the house's 100 (H1). A document with a
 * syntax error has none, since it has no tree to read.
 */
export function wrongShapes(text: string, maximumLineLength = 100): WrongShape[] {
  const reading = read(text);
  if (reading.syntaxError) return [];
  const tokens = reading.lexed.tokens;
  const found: WrongShape[] = [];
  for (const construct of constructs(reading)) {
    const limit = construct.never ? "never" as const : WIDTH_LIMITS[construct.kind];
    const shape = {
      line: tokens[Math.min(construct.first, construct.opens)]!.span.start.line + 1,
      kind: construct.kind,
      width: construct.width,
      limit,
      text: oneLine(reading, construct),
    };
    if (construct.onOneLine) {
      if (overLimit(construct)) found.push({ ...shape, should: "spread" });
    } else if (!construct.mustSpread && joinedLineWidth(reading, construct) <= maximumLineLength) {
      found.push({ ...shape, should: "one line" });
    }
  }
  return found.sort((left, right) => left.line - right.line);
}

// -----------------------------------------------------------------------------
// Finding the constructs

const cache = new WeakMap<Reading, readonly Construct[]>();

/** Every construct of a document that §15.1 or H9 names, outermost first. */
export function constructs(reading: Reading): readonly Construct[] {
  const known = cache.get(reading);
  if (known !== undefined) return known;
  const found = new Finder(reading).find();
  cache.set(reading, found);
  return found;
}

/** The keys of a tree node that hold no expression: patterns, types and names. */
const notExpressions = new Set([
  "pattern", "annotation", "returnAnnotation", "parameters", "typeParameters", "destructurings", "slots",
  "constructors", "declaredParameters", "derives", "impliedTypes", "subject", "constraint", "baseConstraints",
  "name", "field", "qualifier", "components", "result", "delegate", "module", "alias", "span",
  "widens", "group", "block", "keyword", "markSpan", "arrowSpan", "foreign",
]);

const arithmetic = new Set(["Add", "Subtract", "Multiply", "Divide", "Power", "Concat"]);
const logic = new Set(["And", "Or"]);
const openers = new Set(["LeftParen", "LeftBracket", "LeftBrace"]);
const closers = new Set(["RightParen", "RightBracket", "RightBrace"]);

type Node = { readonly kind?: string; readonly span?: { readonly start: { offset: number }; readonly end: { offset: number } } } &
  Record<string, unknown>;

interface Draft {
  readonly kind: ConstructKind;
  readonly first: number;
  readonly last: number;
  readonly opens: number;
  readonly closes: number;
  readonly whole: readonly [number, number];
  readonly never: boolean;
  /** For a lambda that is a call's last argument or a record's last field's value: that call's arguments or that record. */
  readonly ends?: Draft;
}

class Finder {
  readonly #reading: Reading;
  readonly #tokens: readonly Lexed.Token[];
  readonly #drafts: Draft[] = [];
  /** Token ranges inside which something must be spread: a block of two or more items, a `match`, a `try`. */
  readonly #hard: (readonly [number, number])[] = [];
  readonly #starts = new Map<number, number>();
  readonly #ends = new Map<number, number>();
  readonly #partner = new Map<number, number>();

  constructor(reading: Reading) {
    this.#reading = reading;
    this.#tokens = reading.lexed.tokens;
    const stack: number[] = [];
    this.#tokens.forEach((token, index) => {
      if (token.kind === "Eof") return;
      this.#starts.set(token.span.start.offset, index);
      this.#ends.set(token.span.end.offset, index);
      if (openers.has(token.kind)) stack.push(index);
      else if (closers.has(token.kind)) {
        const open = stack.pop();
        if (open !== undefined) {
          this.#partner.set(open, index);
          this.#partner.set(index, open);
        }
      }
    });
  }

  find(): Construct[] {
    for (const module of this.#reading.modules) {
      for (const item of module.items) this.#item(item as unknown as Node);
    }
    this.#hardTokens();
    return this.#settle();
  }

  /** The token indices a node's span runs over, or `undefined` where it is inside a string's hole. */
  #range(node: Node): readonly [number, number] | undefined {
    if (node.span === undefined) return undefined;
    const first = this.#starts.get(node.span.start.offset);
    if (first === undefined) return undefined;
    // A span can run on over the whitespace after its last token.
    let last = this.#ends.get(node.span.end.offset);
    if (last === undefined) {
      let low = first;
      let high = this.#tokens.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (this.#tokens[middle]!.span.end.offset <= node.span.end.offset) low = middle;
        else high = middle - 1;
      }
      last = low;
    }
    if (last < first || this.#tokens[last]!.kind === "Eof") return undefined;
    return [first, last];
  }

  #add(draft: Omit<Draft, "whole"> & { readonly whole?: readonly [number, number] }): Draft {
    const made = { ...draft, whole: draft.whole ?? [draft.opens, draft.closes] as const };
    this.#drafts.push(made);
    return made;
  }

  #item(item: Node): void {
    switch (item.kind) {
      case "Union":
        this.#union(item);
        return;
      case "RecordDeclaration":
        this.#recordDeclaration(item);
        return;
      default:
        this.#children(item, undefined);
    }
  }

  #union(item: Node): void {
    const range = this.#range(item);
    if (range === undefined) return;
    const [first, last] = range;
    // Only `union` itself, not a foreign enum written in a union's shape.
    let head = first;
    if (this.#tokens[head]!.kind === "Export") head += 1;
    if (this.#text(head) === "opaque") head += 1;
    if (this.#text(head) !== "union") return;
    const constructors = item["constructors"] as readonly Node[];
    const alternatives = constructors.map((one) => this.#range(one));
    const opens = alternatives[0]?.[0];
    const closes = alternatives.at(-1)?.[1];
    if (opens === undefined || closes === undefined) return;
    this.#add({ kind: "union", first, last, opens, closes, whole: [first, last], never: false });
  }

  #recordDeclaration(item: Node): void {
    const range = this.#range(item);
    if (range === undefined) return;
    const [first, last] = range;
    let opens = first;
    while (opens <= last && this.#tokens[opens]!.kind !== "LeftBrace") opens += 1;
    const closes = this.#partner.get(opens);
    if (opens > last || closes === undefined) return;
    this.#add({ kind: "record declaration", first, last, opens, closes, whole: [first, last], never: false });
  }

  /** Visits the expressions a node holds. */
  #children(node: Node, parent: Node | undefined): void {
    for (const key of Object.keys(node)) {
      if (notExpressions.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const one of value) this.#child(one, node, key);
      } else {
        this.#child(value, node, key);
      }
    }
    void parent;
  }

  #child(value: unknown, parent: Node, key: string): void {
    if (value === null || typeof value !== "object") return;
    const node = value as Node;
    if (typeof node.kind === "string") {
      if (node.kind === "Block") {
        this.#block(node);
        return;
      }
      this.#expression(node, parent, key);
      return;
    }
    // A match arm: its pattern, its guard and its body.
    if ("pattern" in node && "body" in node) {
      this.#arm(node);
      return;
    }
    // A record field, a member: what it holds.
    this.#children(node, parent);
  }

  #block(block: Node): void {
    const items = block["items"] as readonly Node[];
    const only = items.length === 1 ? items[0] : undefined;
    if (only?.kind !== "ExprItem") {
      const range = this.#range(block);
      if (range !== undefined) this.#hard.push(range);
    }
    for (const item of items) this.#item(item);
  }

  #arm(arm: Node): void {
    const range = this.#range(arm);
    if (range !== undefined) {
      this.#add({ kind: "arm", first: range[0], last: range[1], opens: range[0], closes: range[1], never: false });
    }
    if (arm["guard"] !== undefined) this.#child(arm["guard"], arm, "guard");
    this.#child(arm["body"], arm, "body");
  }

  #expression(node: Node, parent: Node, key: string): void {
    const range = this.#range(node);
    if (range !== undefined) this.#classify(node, parent, key, range);
    this.#children(node, parent);
  }

  #classify(node: Node, parent: Node, key: string, [first, last]: readonly [number, number]): void {
    const whole = { first, last, opens: first, closes: last };
    switch (node.kind) {
      case "If": {
        // An `else if` is a link of its chain, not a conditional of its own.
        if (parent.kind === "If" && key === "alternative") return;
        this.#add({ kind: "conditional", ...whole, never: holdsConditional(node) });
        return;
      }
      case "While":
      case "For": {
        const items = (node["body"] as Node)["items"] as readonly Node[];
        const only = items.length === 1 && items[0]!.kind === "ExprItem"
          ? (items[0]!["expression"] as Node).kind
          : undefined;
        const never = only === "If" || only === "While" || only === "For";
        this.#add({ kind: "loop", ...whole, never });
        return;
      }
      case "Match":
      case "Try":
        this.#hard.push([first, last]);
        return;
      case "Lambda":
        this.#lambda(node, parent, key, first, last);
        return;
      case "Call":
      case "Access": {
        this.#chain(node, parent, key, whole);
        if (node.kind === "Call") this.#call(node, parent, key);
        return;
      }
      case "Binary": {
        const operator = node["operator"] as string;
        const outer = parent.kind === "Binary" ? parent["operator"] as string : undefined;
        if (operator === "Pipe") {
          if (outer === "Pipe" && key === "left") return;
          let stages = 0;
          let spine: Node = node;
          while (spine.kind === "Binary" && spine["operator"] === "Pipe") {
            stages += 1;
            spine = spine["left"] as Node;
          }
          if (stages >= 2) this.#add({ kind: "chain", ...whole, never: false });
        } else if (logic.has(operator)) {
          if (outer === undefined || !logic.has(outer)) this.#add({ kind: "and/or", ...whole, never: false });
        } else if (arithmetic.has(operator)) {
          if (outer === undefined || !arithmetic.has(outer)) this.#add({ kind: "arithmetic", ...whole, never: false });
        }
        return;
      }
      case "Record": {
        const record = this.#add({ kind: "record", ...whole, never: false });
        const field = (node["fields"] as readonly Node[]).at(-1);
        if (field !== undefined) this.#lastField.set(field, record);
        return;
      }
      case "Vector":
        this.#add({ kind: "vector", ...whole, never: false });
        return;
      case "Tuple":
        this.#add({ kind: "tuple", ...whole, never: false });
        return;
    }
  }

  /** Each record's last field, and the record. */
  readonly #lastField = new Map<Node, Draft>();

  #lambda(node: Node, parent: Node, key: string, first: number, last: number): void {
    const body = this.#range(node["body"] as Node);
    if (body === undefined) return;
    const before = this.#tokens[body[0] - 1];
    if (before?.kind === "Equal") {
      // A function's header, which the parser builds as a lambda: from the
      // start of its declaration, which begins its line, to its `=`.
      let start = first;
      const line = this.#tokens[first]!.span.start.line;
      while (start > 0 && this.#tokens[start - 1]!.span.start.line === line && this.#tokens[start - 1]!.kind !== "Eof") {
        start -= 1;
      }
      this.#add({ kind: "header", first: start, last: body[0] - 1, opens: start, closes: body[0] - 1, never: false });
      return;
    }
    if (before?.kind !== "FatArrow") return;
    // A lambda that ends a call's arguments or a record keeps its head on that
    // line, and is spread wherever they are (H7).
    let ends: Draft | undefined;
    if (parent.kind === "Call" && key === "arguments") {
      const args = parent["arguments"] as readonly Node[];
      if (args.at(-1) === node) ends = this.#callArguments.get(parent);
    } else if (key === "value") {
      ends = this.#lastField.get(parent);
    }
    this.#add({ kind: "lambda", first, last, opens: first, closes: last, never: false, ...(ends === undefined ? {} : { ends }) });
  }

  readonly #callArguments = new Map<Node, Draft>();

  #call(node: Node, parent: Node, key: string): void {
    void parent;
    void key;
    const args = node["arguments"] as readonly Node[];
    if (args.length === 0) return;
    const first = this.#range(args[0]!);
    const last = this.#range(args.at(-1)!);
    if (first === undefined || last === undefined) return;
    const opens = first[0] - 1;
    let closes = last[1] + 1;
    if (this.#tokens[closes]?.kind === "Comma") closes += 1;
    if (this.#tokens[opens]?.kind !== "LeftParen" || this.#tokens[closes]?.kind !== "RightParen") return;
    const kind = args.length >= 2 ? "arguments" : "call";
    this.#callArguments.set(node, this.#add({ kind, first: first[0], last: last[1], opens, closes, never: false }));
  }

  /** A chain of two or more dot calls, from its receiver (§9.4 rule 3). */
  #chain(node: Node, parent: Node, key: string, whole: { first: number; last: number; opens: number; closes: number }): void {
    // A link inside a longer chain is that chain's.
    if (parent.kind === "Access" && key === "receiver") return;
    if (parent.kind === "Call" && key === "callee") return;
    let links = 0;
    let spine: Node = node;
    for (;;) {
      if (spine.kind === "Call" && (spine["callee"] as Node).kind === "Access") {
        const callee = spine["callee"] as Node;
        if (isModulePath(callee["receiver"] as Node)) break;
        links += 1;
        spine = callee["receiver"] as Node;
      } else if (spine.kind === "Access") {
        if (isModulePath(spine)) break;
        spine = spine["receiver"] as Node;
      } else {
        break;
      }
    }
    if (links >= 2) this.#add({ kind: "chain", ...whole, never: false });
  }

  #text(index: number): string | undefined {
    const token = this.#tokens[index];
    return token !== undefined && "text" in token ? (token as { text: string }).text : undefined;
  }

  /** The tokens inside which something must be spread: a comment that ends its line, and a string over several lines. */
  #hardTokens(): void {
    const tokens = this.#tokens;
    for (const token of tokens) {
      if (token.kind === "String" && token.span.start.line !== token.span.end.line) {
        const index = this.#starts.get(token.span.start.offset)!;
        this.#hard.push([index, index]);
      }
    }
    for (const comment of this.#reading.lexed.comments) {
      // The token after the comment, and whether it is on a later line.
      const after = tokens.findIndex(({ span, kind }) => kind !== "Eof" && span.start.offset >= comment.span.end.offset);
      const next = after === -1 ? undefined : tokens[after];
      if (next !== undefined && next.span.start.line === comment.span.end.line) continue;
      // A comment that ends its line lies between two tokens; it is inside
      // whatever runs over both.
      const previous = after === -1 ? tokens.length - 2 : after - 1;
      if (previous < 0 || after === -1) continue;
      this.#hard.push([previous, after]);
    }
  }

  #settle(): Construct[] {
    const tokens = this.#tokens;
    const roles = rolesOf(this.#reading);
    const extent = (draft: Draft): readonly [number, number] =>
      [Math.min(draft.first, draft.opens), Math.max(draft.last, draft.closes)];
    // Each construct, and each range inside which something must be spread,
    // under the innermost construct that holds it: sorted outermost first, a
    // range after a construct with the same extent.
    interface Entry { readonly from: number; readonly to: number; readonly draft?: Draft; must: boolean; parent?: Entry }
    const entries: Entry[] = [
      ...this.#drafts.map((draft) => {
        const [from, to] = extent(draft);
        const width = measure(this.#reading, roles, draft.first, draft.last, draft.kind === "union");
        this.#widths.set(draft, width);
        return { from, to, draft, must: overLimit({ kind: draft.kind, width, never: draft.never }) };
      }),
      ...this.#hard.map(([from, to]) => ({ from, to, must: true })),
    ];
    entries.sort((left, right) => left.from - right.from || right.to - left.to ||
      (left.draft === undefined ? 1 : 0) - (right.draft === undefined ? 1 : 0));
    const open: Entry[] = [];
    for (const entry of entries) {
      while (open.length > 0 && !(open.at(-1)!.from <= entry.from && entry.to <= open.at(-1)!.to)) open.pop();
      const parent = open.at(-1);
      if (parent !== undefined) entry.parent = parent;
      if (entry.draft !== undefined) open.push(entry);
    }
    // What must be spread is spread around it too: innermost first.
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]!;
      if (entry.must && entry.parent !== undefined) entry.parent.must = true;
    }
    const must = new Map(entries.filter(({ draft }) => draft !== undefined).map((entry) => [entry.draft!, entry.must]));
    return entries.filter(({ draft }) => draft !== undefined).map(({ draft }) => {
      const made = draft!;
      // A lambda that ends a call or record which must be spread keeps its
      // head on that line, its body beneath its `=>` (H7).
      const ends = made.ends !== undefined && must.get(made.ends) === true;
      return {
        kind: made.kind,
        first: made.first,
        last: made.last,
        opens: made.opens,
        closes: made.closes,
        whole: made.whole,
        width: this.#widths.get(made)!,
        never: made.never,
        onOneLine: tokens[made.opens]!.span.start.line === tokens[made.closes]!.span.end.line,
        mustSpread: must.get(made) === true || ends,
      };
    });
  }

  readonly #widths = new Map<Draft, number>();
}

const rolesCache = new WeakMap<Reading, Spacing.Roles>();

/** §7's roles for a document's tokens. */
function rolesOf(reading: Reading): Spacing.Roles {
  const known = rolesCache.get(reading);
  if (known !== undefined) return known;
  const roles = Spacing.roles(reading.lexed.tokens.filter(({ kind }) => kind !== "Eof"), new Set());
  rolesCache.set(reading, roles);
  return roles;
}

/** Whether a conditional holds another, wherever it stands inside it (§15.1). */
function holdsConditional(node: Node): boolean {
  let found = false;
  const visit = (value: unknown, top: boolean): void => {
    if (found || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const one of value) visit(one, false);
      return;
    }
    const record = value as Node;
    if (!top && record.kind === "If") {
      found = true;
      return;
    }
    for (const key of Object.keys(record)) {
      if (key === "span" || notExpressions.has(key)) continue;
      visit(record[key], false);
    }
  };
  visit(node, true);
  return found;
}

function isModulePath(node: Node): boolean {
  if (node.kind === "Name") return /^\p{Lu}/u.test(((node["name"] as Node)["text"] as string | undefined) ?? "");
  if (node.kind === "Access") {
    const field = (node["field"] as Node)["text"] as string | undefined;
    return /^\p{Lu}/u.test(field ?? "") && isModulePath(node["receiver"] as Node);
  }
  return false;
}

// -----------------------------------------------------------------------------
// The measure (§15.2)

const listClosers = new Set(["RightParen", "RightBracket", "RightBrace"]);

/**
 * The width of the tokens from `first` to `last` as they would read on one
 * line: each gap as §7 spaces it with Collapse extra spaces on, a comment
 * between them as written, and no trailing comma. Where `union` asks, a
 * leading `|` after the `=` is not counted, since a union on one line takes
 * none (Unions §2).
 */
function measure(reading: Reading, roles: Spacing.Roles, first: number, last: number, union: boolean): number {
  const tokens = reading.lexed.tokens;
  let width = [...spell(reading, roles, first, last, union)].length;
  // A comment between two of its tokens counts as written.
  const start = tokens[first]!.span.start.offset;
  const end = tokens[last]!.span.end.offset;
  for (const comment of reading.lexed.comments) {
    if (comment.span.start.offset > start && comment.span.end.offset < end) {
      width += [...comment.text].length + 1;
    }
  }
  return width;
}

/** The tokens from `first` to `last` as they would read on one line, as `measure` measures them, comments aside. */
function spell(reading: Reading, roles: Spacing.Roles, first: number, last: number, union: boolean): string {
  const tokens = reading.lexed.tokens;
  const text = reading.text;
  const skipped = (index: number): boolean => {
    const token = tokens[index]!;
    if (token.kind === "Comma" && index < last + 1 && (listClosers.has(tokens[index + 1]?.kind ?? "") ||
      roles.binderClose.has(index + 1))) return true;
    return union && token.kind === "Bar" && tokens[index - 1]?.kind === "Equal";
  };
  let spelled = "";
  let previous: number | undefined;
  for (let index = first; index <= last; index += 1) {
    if (skipped(index)) continue;
    const token = tokens[index]!;
    if (previous !== undefined) spelled += " ".repeat(gap(reading, roles, previous, index));
    spelled += text.slice(token.span.start.offset, token.span.end.offset);
    previous = index;
  }
  return spelled;
}

/** The gap §7 puts between two tokens on one line, with Collapse extra spaces on. */
function gap(reading: Reading, roles: Spacing.Roles, left: number, right: number): number {
  const tokens = reading.lexed.tokens;
  if (right !== left + 1) {
    // A trailing comma or leading bar passed over: the gap is the one before the token after it.
    const after = tokens[right]!;
    if (after.kind === "RightBrace") return 1;
    if (listClosers.has(after.kind) || roles.binderClose.has(right)) return 0;
    return 1;
  }
  const written = reading.text.slice(tokens[left]!.span.end.offset, tokens[right]!.span.start.offset);
  const rule = Spacing.rule(tokens, roles, left, written.length > 0);
  switch (rule) {
    case "one":
      return 1;
    case "none":
      return 0;
    default:
      return written.length > 0 ? 1 : 0;
  }
}

/** A construct's text as it would read on one line, comments aside, for a report. */
function oneLine(reading: Reading, construct: Construct): string {
  return spell(reading, rolesOf(reading), construct.first, construct.last, construct.kind === "union");
}

/**
 * The width of the line a spread construct would stand on, were it on one
 * line: the text before it on its first line, its own text on one line, and
 * the code after it on its last line, a trailing comment and the gap before
 * it not counted (§9.2).
 */
function joinedLineWidth(reading: Reading, construct: Construct): number {
  const tokens = reading.lexed.tokens;
  const text = reading.text;
  const [from, to] = construct.whole;
  const start = tokens[from]!.span.start;
  const before = [...text.slice(start.offset - start.column, start.offset)].length;
  const own = measure(reading, rolesOf(reading), from, to, construct.kind === "union");
  let after = 0;
  const line = tokens[to]!.span.end.line;
  for (let index = to + 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === "Eof" || token.span.start.line !== line) break;
    after = token.span.end.offset - tokens[to]!.span.end.offset;
  }
  return before + own + after;
}
