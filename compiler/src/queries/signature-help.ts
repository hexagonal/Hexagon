/**
 * Compiler-owned source query: signature help, while a call's arguments are
 * being written.
 *
 * It answers with three things the compiler already holds, and computes none of
 * them afresh:
 *
 * - **The call.** The innermost call whose parentheses hold the caret, read from
 *   the checked tree. A call the parser could not close is kept and checked like
 *   any other (`add(q, ` is a call with an error for its second argument), so
 *   the moment the user is typing is the moment there is one to read.
 * - **The callee's face,** exactly as hover shows it at that name: the same type
 *   occurrence, the same scheme, the same display (`Typed.displayCallFace`).
 *   That is the declaration's face, not the call's instance of it; the call's
 *   own arguments are still being written.
 * - **Which parameter the caret is on,** counted from the arguments the call
 *   holds. A receiver (`v.map(`) or a piped value (`x |> f(`) is the first
 *   argument without being written inside the parentheses, and counts first, so
 *   the highlight lands on the parameter the text in front of the caret fills.
 *
 * The parameter's name comes from the declaration where it has one: a `fun`, a
 * `let` bound to a lambda, an `extern fun`, a constraint member. A union's
 * constructor has none, and a pattern parameter's binder is the compiler's own,
 * so neither is named.
 */

import { lex } from "../passes/lexer/lexer.js";
import * as Source from "../support/source.js";
import { isCompilerMinted } from "../support/synthetic.js";
import * as Typed from "../syntax/typed/index.js";
import { occurrenceSpanOf, type TypeOccurrence } from "./type-occurrences.js";

export interface SignatureHelp {
  /** The callee as the call names it: its last identifier. */
  readonly name: string;
  /** `name: face`, the line hover shows for the callee. */
  readonly label: string;
  /** The face's parameters, in order. */
  readonly parameters: readonly SignatureParameter[];
  /**
   * The parameter the caret is on, counting from 0. It can be past the last
   * one, when more arguments are written than the callee takes.
   */
  readonly activeParameter: number;
  /** The gloss, one line each (Effects §10): the outer arrow's colours in words. */
  readonly colourOwners?: readonly string[];
  /** The declaration's documentation, when it carries any. */
  readonly documentation?: string;
}

export interface SignatureParameter {
  /** Where the parameter's type stands in `label`, as `[start, end)`. */
  readonly range: readonly [number, number];
  /** The parameter's name in the declaration, when it has one. */
  readonly name?: string;
}

export interface SignatureHelpInput {
  readonly text: string;
  readonly offset: number;
  readonly typed: Typed.Module;
  /** Every checked tree, for the declaration that names the parameters. */
  readonly trees: readonly Typed.Module[];
  /** Hover's own lookup: the type occurrence at exactly this span. */
  readonly typeOccurrenceAt: (span: Source.Span) => TypeOccurrence | undefined;
  /** The declaration's documentation, by symbol. */
  readonly documentationOf: (symbol: Typed.Symbol["id"]) => string | undefined;
}

export function signatureHelpAt(input: SignatureHelpInput): SignatureHelp | undefined {
  const { text, offset, typed } = input;
  const call = innermostCall(typed, text, offset);
  if (call === undefined) return undefined;
  const occurrence = input.typeOccurrenceAt(call.calleeName);
  if (occurrence?.scheme === undefined || occurrence.scheme.type.kind !== "Function") return undefined;
  const face = Typed.displayCallFace(occurrence.scheme, Typed.colourContextAt(typed));
  const name = text.slice(call.calleeName.start.offset, call.calleeName.end.offset);
  const prefix = `${name}: `;
  const names = occurrence.symbol === undefined
    ? undefined
    : parameterNames(occurrence.symbol, typed, input.trees);
  const documentation = occurrence.symbol === undefined ? undefined : input.documentationOf(occurrence.symbol);
  return {
    name,
    label: `${prefix}${face.type}`,
    parameters: face.parameters.map(([start, end], index) => {
      const declared = names?.[index];
      return {
        range: [prefix.length + start, prefix.length + end] as const,
        ...(declared === undefined ? {} : { name: declared }),
      };
    }),
    activeParameter: call.before + activeArgument(call, text, offset, typed.fileId),
    ...(face.owners.length === 0 ? {} : { colourOwners: face.owners }),
    ...(documentation === undefined ? {} : { documentation }),
  };
}

/** A call around the caret, and what reading it needs. */
interface CallAround {
  /** The span hover reads the callee's type at: its last identifier. */
  readonly calleeName: Source.Span;
  /** The offset of the `(` that opens the arguments. */
  readonly open: number;
  /** Where the caret may stand and still be inside the call, `[start, end]`. */
  readonly inside: readonly [number, number];
  /** The arguments written inside the parentheses, in order. */
  readonly written: readonly Typed.Expr[];
  /** How many arguments the call holds before its `(`: a receiver, a piped value. */
  readonly before: number;
}

/**
 * The innermost call whose parentheses hold the offset.
 *
 * Innermost by the width of what the parentheses hold, so a call written as an
 * argument wins over the call it is an argument of.
 */
function innermostCall(module: Typed.Module, text: string, offset: number): CallAround | undefined {
  let best: CallAround | undefined;
  forEachExpression(module, (expression) => {
    if (expression.kind !== "Call") return;
    const around = callAround(expression, text, offset, module.fileId);
    if (around === undefined) return;
    const [start, end] = around.inside;
    if (offset < start || offset > end) return;
    if (best === undefined || end - start < best.inside[1] - best.inside[0]) best = around;
  });
  return best;
}

/**
 * A call's parentheses, or nothing for a call written without them (a bare
 * `|>` stage, `x |> f`, is a call with no `(` of its own) and for one whose
 * `(` is not before the offset, which cannot hold it.
 */
function callAround(
  call: Typed.CallExpr,
  text: string,
  offset: number,
  fileId: Source.FileId,
): CallAround | undefined {
  const callee = call.callee;
  // A callee no source wrote, such as a sequence adaptation's inserted `toSeq`
  // (Collections Part 5 §3.6), has no width and no parentheses of its own.
  if (callee.span.start.offset === callee.span.end.offset) return undefined;
  const calleeName = callee.kind === "Name"
    ? occurrenceSpanOf(callee)
    : callee.kind === "Access"
    ? callee.field.span
    : callee.span;
  // The `(` follows the callee, after a mark (`f!(`, `f?(`) and any spaces on
  // the same line; anything else there means this call has none.
  let open = callee.span.end.offset;
  while (open < text.length && " \t!?^~".includes(text[open]!)) open += 1;
  if (text[open] !== "(" || offset <= open) return undefined;
  const written = call.arguments.filter((argument) => argument.span.start.offset > open);
  const before = call.arguments.length - written.length;
  const last = written.at(-1);
  const end = call.span.end.offset;
  // A closed call's span ends at its `)`, past its last argument. An unclosed one
  // ends at that argument: the parser gives it one, an error where it found none.
  const closed = last === undefined || end > last.span.end.offset;
  if (closed) return { calleeName, open, inside: [open + 1, end - 1], written, before };
  // An unclosed call reaches as far as the caret can still be typing in it: over
  // the spaces and comments after what the parser kept, to the next token (the
  // lexer ends every text with one, `Eof`).
  const next = lex(new Source.File(fileId, "<rest>", text.slice(end))).tokens[0]!;
  const reach = end + next.span.start.offset;
  return { calleeName, open, inside: [open + 1, reach], written, before };
}

/** Which written argument the caret is on, counting the commas before it. */
function activeArgument(call: CallAround, text: string, offset: number, fileId: Source.FileId): number {
  const { written } = call;
  for (let index = 0; index < written.length; index += 1) {
    const argument = written[index]!;
    if (offset > argument.span.end.offset) continue;
    if (offset >= argument.span.start.offset || index === 0) return index;
    // Between two arguments: the second one's, once the comma is behind the caret.
    const from = written[index - 1]!.span.end.offset;
    return commasIn(text, from, offset, fileId) > 0 ? index : index - 1;
  }
  const last = written.length - 1;
  const from = last < 0 ? call.open + 1 : written[last]!.span.end.offset;
  return Math.max(last, 0) + commasIn(text, from, offset, fileId);
}

/**
 * The commas between two offsets, read by the lexer so a comma inside a
 * comment is not one. Only text between arguments is read here, which holds
 * separators and comments and nothing the parser kept.
 */
function commasIn(text: string, from: number, to: number, fileId: Source.FileId): number {
  const gap = new Source.File(fileId, "<gap>", text.slice(from, to));
  return lex(gap).tokens.filter(({ kind }) => kind === "Comma").length;
}

/**
 * The declared names of a function's parameters, by its symbol, or nothing for
 * a symbol no declaration with a parameter list binds.
 *
 * Looked for in the module the asking call is in first, then in every other
 * checked tree: a symbol's identity is unique across the project.
 */
function parameterNames(
  symbol: Typed.Symbol["id"],
  asking: Typed.Module,
  trees: readonly Typed.Module[],
): readonly (string | undefined)[] | undefined {
  const named = (bindings: readonly Typed.Binding[]): readonly (string | undefined)[] =>
    bindings.map(({ name }) => (isCompilerMinted(name) ? undefined : name));
  for (const tree of [asking, ...trees.filter((tree) => tree !== asking)]) {
    let found: readonly (string | undefined)[] | undefined;
    const visitItem = (item: Typed.Item): void => {
      if (found !== undefined) return;
      switch (item.kind) {
        case "Fun":
          if (item.binding.symbol === symbol) found = named(item.value.parameters);
          return;
        case "Let":
        case "Var":
          if (item.binding.symbol === symbol && item.value.kind === "Lambda") found = named(item.value.parameters);
          return;
        case "ExternBlock":
          for (const declaration of item.declarations) {
            if (declaration.kind === "ExternFun" && declaration.binding.symbol === symbol) {
              found = named(declaration.parameters);
            }
          }
          return;
        case "ConstraintDeclaration":
          for (const member of item.members) {
            if (member.binding.symbol === symbol) found = named(member.parameters);
          }
          return;
        default:
          return;
      }
    };
    forEachItem(tree, visitItem);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Every item of a module, nested ones in blocks included. */
function forEachItem(module: Typed.Module, visit: (item: Typed.Item) => void): void {
  walk(module, visit, () => {});
}

/** Every expression of a module, in every item, nested ones included. */
function forEachExpression(module: Typed.Module, visit: (expression: Typed.Expr) => void): void {
  walk(module, () => {}, visit);
}

function walk(
  module: Typed.Module,
  onItem: (item: Typed.Item) => void,
  onExpression: (expression: Typed.Expr) => void,
): void {
  const visitItem = (item: Typed.Item): void => {
    onItem(item);
    switch (item.kind) {
      case "Let":
      case "Var":
      case "LetPattern":
      case "Fun":
        visitExpression(item.value);
        return;
      case "ConstraintDeclaration":
        for (const member of item.members) {
          if (member.defaultValue !== undefined) visitExpression(member.defaultValue);
        }
        return;
      case "Honor":
        for (const member of item.members) visitExpression(member.value);
        return;
      case "PatternDeclaration":
        visitExpression(item.view.value);
        if (item.build !== undefined) visitExpression(item.build.value);
        return;
      case "ExprItem":
        visitExpression(item.expression);
        return;
      default:
        return;
    }
  };
  const visitArms = (arms: readonly Typed.MatchArm[]): void => {
    for (const arm of arms) {
      if (arm.guard !== undefined) visitExpression(arm.guard);
      visitExpression(arm.body);
    }
  };
  const visitExpression = (expression: Typed.Expr): void => {
    onExpression(expression);
    switch (expression.kind) {
      case "Name":
      case "Unit":
      case "FromNat":
      case "BigInt":
      case "Dec":
      case "Float":
      case "CollectionOperation":
      case "ErrorExpr":
        return;
      case "WidenNat":
      case "WidenInt":
      case "WidenBigInt":
      case "Hash":
        visitExpression(expression.value);
        return;
      case "String":
        for (const part of expression.parts) {
          if (part.kind === "Interpolation") visitExpression(part.expression);
        }
        return;
      case "Vector":
      case "Tuple":
        for (const element of expression.elements) visitExpression(element);
        return;
      case "Record":
        if (expression.spread !== undefined) visitExpression(expression.spread);
        for (const field of expression.fields) visitExpression(field.value);
        return;
      case "Group":
      case "Ascription":
        visitExpression(expression.expression);
        return;
      case "Block":
        for (const item of expression.items) visitItem(item);
        return;
      case "Lambda":
        visitExpression(expression.body);
        return;
      case "If":
        visitExpression(expression.condition);
        visitExpression(expression.consequence);
        visitExpression(expression.alternative);
        return;
      case "While":
        visitExpression(expression.condition);
        visitExpression(expression.body);
        return;
      case "For":
        visitExpression(expression.iterable);
        visitExpression(expression.body);
        return;
      case "Match":
        visitExpression(expression.scrutinee);
        visitArms(expression.arms);
        visitArms(expression.catchArms ?? []);
        return;
      case "Try":
        visitExpression(expression.body);
        visitArms(expression.arms);
        return;
      case "Throw":
        visitExpression(expression.exception);
        return;
      case "Call":
        visitExpression(expression.callee);
        for (const argument of expression.arguments) visitExpression(argument);
        return;
      case "Access":
        visitExpression(expression.receiver);
        return;
      case "Index":
        visitExpression(expression.receiver);
        visitExpression(expression.index);
        return;
      case "LogicalNot":
        visitExpression(expression.operand);
        return;
      case "Logical":
        visitExpression(expression.left);
        visitExpression(expression.right);
        return;
      case "ConstraintCall":
        for (const argument of expression.arguments) visitExpression(argument);
        return;
      case "ComparisonChain":
        for (const operand of expression.operands) visitExpression(operand);
        return;
      case "Range":
        visitExpression(expression.start);
        visitExpression(expression.end);
        return;
      case "Assignment":
        visitExpression(expression.target);
        visitExpression(expression.value);
        return;
      default: {
        const unreachable: never = expression;
        return unreachable;
      }
    }
  };
  for (const item of module.items) visitItem(item);
}
