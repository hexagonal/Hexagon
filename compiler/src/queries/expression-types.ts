/**
 * Compiler-owned source query: the type of an expression.
 *
 * Two questions, one rule. A **selection** names the smallest piece of the
 * parsed tree that holds it, so selecting `first(["a", "b"])` names that call. A
 * **position** that is not on a name names the piece of the tree its character
 * belongs to: an operator, a bracket, a comma, a literal, a keyword. (A name is
 * hover's own: what it denotes, with its declaration's face.)
 *
 * The rule, from that piece outward: an expression answers with its type; a
 * part of an expression's own syntax (a `match` arm's `=>`, a record field's
 * `=`, a string's text) is the expression's; and a pattern, a type, a
 * declaration or a name answers nothing. A selected name answers where it
 * stands in an expression, with what the checker typed at exactly its text: a
 * name's type here, its instance, and a dot call's operation's (`v.map`'s
 * `map`, at `v`'s type).
 *
 * The type is the checked tree's, read by span: the expression the checker
 * typed at exactly that text, so nothing is computed afresh. Where the checker
 * folded a piece into the one around it, so that it has no type of its own (a
 * method's `receiver.name`, a module qualifier, a `|>` stage's call), the piece
 * answers nothing rather than borrowing its parent's type; a group is the
 * expression it holds. Where the checker converted the expression in place
 * (a `Nat` widened to `Int`, a vector adapted to a `Seq`, a reading's value
 * widened inside its `Some`), the answer is the type the text has and the type
 * it was converted to (Rust's "coerced to").
 *
 * One declaration's punctuation answers: a function's header (`let f(n: Int):
 * Int = …`) is the lambda the parser built from it, so its `(`, `:` and `=`
 * answer with the function's type.
 */

import type * as Source from "../support/source.js";
import type * as Parsed from "../syntax/parsed/index.js";
import * as Typed from "../syntax/typed/index.js";
import { enclosingNodes, solidText, type SyntaxNode, syntaxTree } from "./syntax-nodes.js";
import { forEachTypedExpression } from "./typed-walk.js";

export interface ExpressionType {
  /**
   * What the answer describes: the expression a selection names, or the run of
   * text under the pointer.
   */
  readonly span: Source.Span;
  /** The expression's type, as hover displays a type. */
  readonly displayedType: string;
  /** The gloss (Effects §10), one line each, for a function's outer arrow. */
  readonly colourOwners?: readonly string[];
  /** The type the checker converted it to where it stands, when it did. */
  readonly convertedTo?: string;
}

export interface ExpressionTypeInput {
  readonly file: Source.File;
  readonly parsed: Parsed.Module;
  readonly typed: Typed.Module;
}

/** A stretch of one node's own text, and what a position in it answers with. */
interface ExpressionRun {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
  readonly answer: Typed.Expr;
}

/**
 * The type of the expression a selection names, `[start, end)`, over that
 * expression's text. Spaces, line breaks and comments at either end of the
 * selection are not part of it, and a selection inside a part of an
 * expression's syntax (a record field, a `match` arm) names the expression.
 */
export function expressionTypeOfSelection(
  input: ExpressionTypeInput,
  start: number,
  end: number,
): ExpressionType | undefined {
  const solid = solidText(input.file, input.parsed);
  let from = start;
  let to = end;
  while (from < to && !solid(from)) from += 1;
  while (to > from && !solid(to - 1)) to -= 1;
  if (from === to) return undefined;
  const chain = enclosingNodes(syntaxTree(input.parsed), from, to);
  const named = chain.at(-1);
  if (named === undefined) return undefined;
  const lookup = typedAt(input.typed);
  let answering: SyntaxNode | undefined;
  if (named.role === "name") {
    answering = chain.at(-2)?.role === "expression" ? named : undefined;
  } else {
    for (const node of chain) answering = step(answering, node);
  }
  const answer = answering === undefined ? undefined : lookup(answering);
  return answer === undefined ? undefined : described(input, answer, answering!.span);
}

/**
 * The type at a position that is not on a name: what the character there
 * answers, or, where the position is on no character (a space, a line break, a
 * comment, the end of the text), what the character before it answers. So a
 * caret just after a `)` is on it, as a caret just after a name is on the name,
 * and a pointer on a name is never on the character before the name.
 */
export function expressionTypeAt(input: ExpressionTypeInput, offset: number): ExpressionType | undefined {
  const runs = expressionRuns(input);
  const solid = solidText(input.file, input.parsed);
  const holding = (at: number): ExpressionRun | undefined => runs.find(({ start, end }) => start <= at && at < end);
  // Runs hold only characters, so off every character it is the one before.
  const run = holding(solid(offset) ? offset : offset - 1);
  if (run === undefined) return undefined;
  return described(input, run.answer, input.file.span(run.start, run.end));
}

/**
 * The offsets `expressionTypeAt` answers at, as ranges closed at both ends:
 * each run's characters, and the offset just past it where that is on no
 * character. For a hover gate, which must open exactly where the hover answers.
 */
export function expressionHoverRanges(
  input: ExpressionTypeInput,
): readonly { readonly start: number; readonly end: number }[] {
  const solid = solidText(input.file, input.parsed);
  return expressionRuns(input).map(({ start, end }) => ({ start, end: solid(end) ? end - 1 : end }));
}

const runsOf = new WeakMap<Typed.Module, readonly ExpressionRun[]>();

/**
 * Every run of text `expressionTypeAt` answers in: each node's own characters,
 * the ones none of its children hold, cut at spaces, line breaks and comments,
 * kept where the node answers.
 */
function expressionRuns(input: ExpressionTypeInput): readonly ExpressionRun[] {
  const known = runsOf.get(input.typed);
  if (known !== undefined) return known;
  const solid = solidText(input.file, input.parsed);
  const lookup = typedAt(input.typed);
  const runs: ExpressionRun[] = [];
  /** The runs of solid text in `[from, to)`, each answering with `answer`. */
  const own = (from: number, to: number, answer: Typed.Expr): void => {
    let start: number | undefined;
    for (let at = from; at <= to; at += 1) {
      if (at < to && solid(at)) {
        start ??= at;
      } else if (start !== undefined) {
        runs.push({ start, end: at, answer });
        start = undefined;
      }
    }
  };
  const visit = (node: SyntaxNode, around: SyntaxNode | undefined): void => {
    const answering = step(around, node);
    const answer = answering === undefined ? undefined : lookup(answering);
    // Kept only where `described` answers, so the runs are the answer's own
    // offsets: an expression the checker could not type answers nothing.
    const shown = answer !== undefined && describable(input, answer) ? answer : undefined;
    let at = node.span.start.offset;
    for (const child of node.children) {
      if (shown !== undefined) own(at, child.span.start.offset, shown);
      visit(child, answering);
      at = child.span.end.offset;
    }
    if (shown !== undefined) own(at, node.span.end.offset, shown);
  };
  visit(syntaxTree(input.parsed), undefined);
  runsOf.set(input.typed, runs);
  return runs;
}

/**
 * The expression a node answers for, given the one the node around it answers
 * for: itself, an expression's; the expression's, a part's; none, the rest's.
 */
function step(around: SyntaxNode | undefined, node: SyntaxNode): SyntaxNode | undefined {
  switch (node.role) {
    case "expression":
      return node;
    case "part":
      return around;
    case "name":
    case "other":
      return undefined;
  }
}

const indexes = new WeakMap<Typed.Module, ReadonlyMap<string, Typed.Expr>>();

/**
 * The checked expression at a parsed expression's text: the outermost one the
 * checker built there, which is the one the expression around it holds.
 */
function typedAt(typed: Typed.Module): (node: SyntaxNode) => Typed.Expr | undefined {
  let index = indexes.get(typed);
  if (index === undefined) {
    const built = new Map<string, Typed.Expr>();
    forEachTypedExpression(typed, (expression) => {
      const key = keyOf(expression.span);
      // The walk meets an expression before what it holds.
      if (!built.has(key)) built.set(key, expression);
    });
    index = built;
    indexes.set(typed, built);
  }
  const found = index;
  const lookup = (node: SyntaxNode): Typed.Expr | undefined => {
    const exact = found.get(keyOf(node.span));
    if (exact !== undefined) return exact;
    const inner = node.children[0];
    return node.expression?.kind === "Group" && inner !== undefined ? lookup(inner) : undefined;
  };
  return lookup;
}

function keyOf(span: Source.Span): string {
  return `${span.start.offset}:${span.end.offset}`;
}

/**
 * The type the text has, inside the conversions the checker made in place over
 * the same text: a numeric widening; a sequence adaptation, the one call whose
 * callee no source wrote (and so has no width); a reading's value widened
 * inside its `Some`. A decimal-point literal the checker built at a `Frac` type
 * from an injected `BigInt` (#525) is that type's own literal, not a conversion.
 */
function writtenType(input: ExpressionTypeInput, expression: Typed.Expr): Typed.Type {
  switch (expression.kind) {
    case "WidenBigInt":
      if (expression.value.kind === "BigInt" && !wroteBigInt(input, expression.value.span)) return expression.type;
      return writtenType(input, expression.value);
    case "WidenDec":
    case "WidenNat":
    case "WidenInt":
      return writtenType(input, expression.value);
    case "Call": {
      const [argument] = expression.arguments;
      const inserted = expression.callee.span.start.offset === expression.callee.span.end.offset;
      if (inserted && argument !== undefined) return writtenType(input, argument);
      const { callee, readingWidening, type } = expression;
      return readingWidening !== undefined && type.kind === "Union" && callee.type.kind === "Function"
        ? { ...type, arguments: [callee.type.result] }
        : type;
    }
    default:
      return expression.type;
  }
}

/** Whether the text at a span is a `BigInt` literal as written (`15n`). */
function wroteBigInt(input: ExpressionTypeInput, span: Source.Span): boolean {
  const chain = enclosingNodes(syntaxTree(input.parsed), span.start.offset, span.end.offset);
  return chain.at(-1)?.expression?.kind === "BigInt";
}

/** Whether `described` answers for an expression: whether the checker typed it. */
function describable(input: ExpressionTypeInput, outer: Typed.Expr): boolean {
  return writtenType(input, outer).kind !== "Error";
}

function described(input: ExpressionTypeInput, outer: Typed.Expr, span: Source.Span): ExpressionType | undefined {
  const written = writtenType(input, outer);
  if (written.kind === "Error") return undefined;
  const context = Typed.colourContextAt(input.typed);
  const face = Typed.displayFace({ variables: [], constraints: [], type: written }, context);
  const converted = written === outer.type
    ? undefined
    : Typed.displayFace({ variables: [], constraints: [], type: outer.type }, context).type;
  return {
    span,
    displayedType: face.type,
    ...(face.owners.length === 0 ? {} : { colourOwners: face.owners }),
    ...(converted === undefined ? {} : { convertedTo: converted }),
  };
}
