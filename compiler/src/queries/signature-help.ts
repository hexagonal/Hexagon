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
 *   occurrence, the same scheme, the same display (`Typed.displayCallFace`),
 *   its parameters under their declared names.
 *   That is the declaration's face, not this call's instance of it, since the
 *   call's own arguments are still being written. Where hover shows something
 *   narrower, so does this: a constraint member whose colour waits on its
 *   instance shows that instance's face once the call decides it (a member
 *   whose contract is `->!`, called on a value whose instance is pure, reads
 *   `->`), and a record field holding a function shows the field's type in that
 *   record.
 * - **Which parameter the caret is on,** counted from the arguments the call
 *   holds. A receiver (`v.map(`) or a piped value (`x |> f(`) is the first
 *   argument without being written inside the parentheses, and counts first, so
 *   the highlight lands on the parameter the text in front of the caret fills.
 *
 * The parameter's name comes from the declaration where it has one
 * (`collectParameterNames`): a `fun`, a `let` bound to a lambda, an
 * `extern fun`, a constraint member, a constructor or an exception whose slots
 * are named. A pattern parameter's binder is the compiler's own, and an unnamed
 * slot's field is only its place, so neither is named.
 *
 * It does not answer for a prelude member that stands behind an operator
 * (`add`, `concat`, `shiftLeft`, …) called by name, whether bare, through its
 * constraint or on its subject (`add(1, `, `Num.add(1, `, `1.add(`): the checker
 * keeps that as a constraint call with no callee of its own, so there is no
 * type at the name to read, for hover either. When more arguments are written
 * than the callee takes, the active parameter is past the last one, and a host
 * shows no highlight.
 */

import { lex } from "../passes/lexer/lexer.js";
import * as Source from "../support/source.js";
import * as Typed from "../syntax/typed/index.js";
import { occurrenceSpanOf, type TypeOccurrence } from "./type-occurrences.js";
import { forEachTypedExpression } from "./typed-walk.js";

export interface SignatureHelp {
  /** The callee as the call names it: its last identifier. */
  readonly name: string;
  /** `name: face`, the line hover shows for the callee, parameters named. */
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
  /** Where the parameter stands in `label`, its name included, as `[start, end)`. */
  readonly range: readonly [number, number];
  /** The parameter's name in the declaration, when it has one. */
  readonly name?: string;
}

export interface SignatureHelpInput {
  readonly text: string;
  readonly offset: number;
  readonly typed: Typed.Module;
  /** Hover's own lookup: the type occurrence at exactly this span. */
  readonly typeOccurrenceAt: (span: Source.Span) => TypeOccurrence | undefined;
  /** The declaration's documentation, by symbol. */
  readonly documentationOf: (symbol: Typed.Symbol["id"]) => string | undefined;
  /** The names the declaration gives its parameters, by symbol. */
  readonly parameterNamesOf: (symbol: Typed.Symbol["id"]) => readonly (string | undefined)[] | undefined;
}

export function signatureHelpAt(input: SignatureHelpInput): SignatureHelp | undefined {
  const { text, offset, typed } = input;
  const call = innermostCall(typed, text, offset);
  if (call === undefined) return undefined;
  const occurrence = input.typeOccurrenceAt(call.calleeName);
  if (occurrence?.scheme === undefined || occurrence.scheme.type.kind !== "Function") return undefined;
  const names = occurrence.symbol === undefined ? undefined : input.parameterNamesOf(occurrence.symbol);
  const face = Typed.displayCallFace(occurrence.scheme, Typed.colourContextAt(typed), undefined, names);
  const name = text.slice(call.calleeName.start.offset, call.calleeName.end.offset);
  const prefix = `${name}: `;
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
  const comments = new Map(module.comments.map(({ span }) => [span.start.offset, span.end.offset]));
  let best: CallAround | undefined;
  forEachTypedExpression(module, (expression) => {
    if (expression.kind !== "Call") return;
    const around = callAround(expression, text, comments);
    if (around === undefined) return;
    const [start, end] = around.inside;
    if (offset < start || offset > end) return;
    if (best === undefined || end - start < best.inside[1] - best.inside[0]) best = around;
  });
  return best;
}

/**
 * A call's parentheses: where they open, and what they hold.
 *
 * A call written without them needs no test of its own. It ends where its
 * callee does (a bare `|>` stage, `x |> f`, has its one argument in front), so
 * it holds nothing, and no caret is inside it.
 */
function callAround(
  call: Typed.CallExpr,
  text: string,
  comments: ReadonlyMap<number, number>,
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
  // The `(` follows the callee, after a mark (`f!(`, `f?(`) and any spaces,
  // line breaks and comments: `add\n    (q, 1)` is a call too.
  const open = past(text, callee.span.end.offset, comments, "!?^~");
  const written = call.arguments.filter((argument) => argument.span.start.offset > open);
  const before = call.arguments.length - written.length;
  const last = written.at(-1);
  const end = call.span.end.offset;
  // A closed call's span ends at its `)`, past its last argument. An unclosed one
  // ends at that argument: the parser gives it one, an error where it found none.
  const closed = last === undefined || end > last.span.end.offset;
  if (closed) return { calleeName, open, inside: [open + 1, end - 1], written, before };
  // An unclosed call reaches as far as the caret can still be typing in it: over
  // the spaces, line breaks and comments after what the parser kept, to where the
  // next token starts or the text ends.
  return { calleeName, open, inside: [open + 1, past(text, end, comments)], written, before };
}

/**
 * Where the next token starts, from an offset: past spaces, line breaks,
 * comments, and any of `also`. The comments are the ones the lexer found, by
 * where each starts, read rather than found again. (What follows an unclosed
 * call in its module is read as more of its arguments, so a comment after one
 * is always its module's own.) Text the lexer refuses is not passed over: a
 * JavaScript-style block comment, a byte-order mark past the start.
 */
function past(text: string, from: number, comments: ReadonlyMap<number, number>, also = ""): number {
  let at = from;
  while (at < text.length) {
    const comment = comments.get(at);
    if (comment !== undefined) at = comment;
    else if (` \t\r\n${also}`.includes(text[at]!)) at += 1;
    else break;
  }
  return at;
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
