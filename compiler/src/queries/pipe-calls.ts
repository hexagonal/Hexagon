/**
 * Pipe and call, either way: a refactoring between forms the spec defines as
 * one another.
 *
 * `xs |> Seq.map(f) |> Seq.take(3)` and `Seq.take(Seq.map(xs, f), 3)` are one
 * program: a pipe stage is the call that takes the pipe's left side as its
 * first argument (Operators §8), a rewrite done before inference. So each form
 * can be written as the other with no question of meaning, and each rewrite is
 * checked only by parsing what it leaves (`same-reading.ts`).
 *
 * - **On a pipe's `|>`**, the whole pipeline it is part of is written as calls.
 * - **On a call's name**, the call and the calls nested in its first argument
 *   are written as a pipeline, innermost first. A dot call (`v.map(f)`) stops
 *   the chain: its receiver is not its first argument as written, so a pipe
 *   into it would read as a call with one argument more.
 *
 * A comment inside what is rewritten, where the rewrite would not keep it, is
 * a reason to refuse: the dev moves it first.
 */

import * as Source from "../support/source.js";
import type * as Parsed from "../syntax/parsed/index.js";
import { PRELUDE_MODULES } from "../prelude.js";
import { keepsReading, type TextEdit } from "./same-reading.js";
import { enclosingNodes, type SyntaxNode, syntaxTree } from "./syntax-nodes.js";

export const PIPE_TO_CALLS_TITLE = "Write the pipeline as calls";
export const CALLS_TO_PIPE_TITLE = "Write the calls as a pipeline";

/** A refactoring offered at a place: its edit, or why it is refused there. */
export type Refactoring =
  | { readonly title: string; readonly edit: TextEdit; readonly disabled?: undefined }
  | { readonly title: string; readonly edit?: undefined; readonly disabled: string };

/** The pipe and call rewrites offered for `[start, end]` of one parsed module. */
export function pipeCallRefactorings(
  file: Source.File,
  module: Parsed.Module,
  start: number,
  end: number,
): readonly Refactoring[] {
  const chain = enclosingNodes(syntaxTree(module), start, end);
  const found: Refactoring[] = [];
  const pipe = pipelineAt(chain);
  if (pipe !== undefined) {
    found.push(
      unreadMark(pipe)
        ? { title: PIPE_TO_CALLS_TITLE, disabled: UNREAD_MARK }
        : rewrite(file, module, PIPE_TO_CALLS_TITLE, pipe, writtenAsCalls(file, pipe)),
    );
  }
  const calls = callChainAt(chain, start, moduleAliases(module));
  if (calls !== undefined) {
    found.push(rewrite(file, module, CALLS_TO_PIPE_TITLE, calls.outer, writtenAsPipeline(file, calls)));
  }
  return found;
}

export interface Written {
  /** The text that replaces the expression, in the forms to try, the plainest first. */
  readonly texts: readonly string[];
  /** The spans of the expression whose text the rewrite keeps. */
  readonly kept: readonly Source.Span[];
}

/**
 * The refactoring `title` replacing `expression` with the first of `written`'s
 * texts that parses as the same program, or refused with the reason. Exported
 * for its tests, which hand it texts no rewrite here writes.
 */
export function rewrite(
  file: Source.File,
  module: Parsed.Module,
  title: string,
  expression: Parsed.Expr,
  written: Written,
): Refactoring {
  const { start, end } = solid(file, expression.span);
  const lost = module.comments.some(({ span }) =>
    start <= span.start.offset && span.end.offset <= end &&
    !written.kept.some((kept) => kept.start.offset <= span.start.offset && span.end.offset <= kept.end.offset)
  );
  if (lost) return { title, disabled: "A comment inside it would be lost. Move the comment out first." };
  for (const replacement of written.texts) {
    const edit = { start, end, replacement };
    if (keepsReading(file, module, edit)) return { title, edit };
  }
  // A `//` comment on a kept text's last line runs to the end of that line,
  // over whatever the rewrite writes after the text.
  const swallowing = module.comments.some(({ kind, span }) =>
    kind === "Line" && written.kept.some((kept) =>
      kept.start.offset <= span.start.offset && span.end.offset <= kept.end.offset &&
      !file.text.slice(span.end.offset, solid(file, kept).end).includes("\n")
    )
  );
  if (swallowing) {
    return { title, disabled: "A `//` comment inside it would swallow what the rewrite writes after it. Move the comment out first." };
  }
  return { title, disabled: "Written the other way here, it would parse as a different program." };
}

const UNREAD_MARK = "A mark after a stage's own argument list marks nothing, and would be lost. Mark the list instead, as in `take!(3)`.";

/**
 * Whether a stage with its own argument list carries a mark after that list
 * (`x |> g(2)!`). A stage with a list marks the list (Operators §8); the parser
 * takes the mark at the stage's end and nothing reads it, so a rewrite would
 * drop it without a word (#1491).
 */
function unreadMark(pipe: Parsed.BinaryExpr): boolean {
  for (let at: Parsed.Expr = pipe; isPipe(at); at = at.left) {
    if (at.right.kind === "Call" && at.markSpan !== undefined) return true;
  }
  return false;
}

/**
 * The pipeline whose `|>` or stage name the range is on: the outermost pipe of
 * the chain the pipe there is the left side of, since `a |> f |> g` is
 * `(a |> f) |> g`.
 */
function pipelineAt(chain: readonly SyntaxNode[]): Parsed.BinaryExpr | undefined {
  let at = innermost(chain, (expression) => isPipe(expression));
  if (at < 0) return undefined;
  const pipe = chain[at]!.expression as Parsed.BinaryExpr;
  const inside = chain.slice(at + 1);
  if (inside.length > 0) {
    // On the stage: its name, or a stage call's name, mark or parentheses.
    const stage = pipe.right;
    if (inside[0]!.expression !== stage) return undefined;
    const name = stage.kind === "Call" ? stage.callee.span : stage.span;
    if (!onName(inside.slice(1), name)) return undefined;
  }
  // A pipe holding another directly holds it as its left side: as its right,
  // the other would be in parentheses.
  while (at > 0 && isPipe(chain[at - 1]?.expression)) at -= 1;
  return chain[at]!.expression as Parsed.BinaryExpr;
}

function isPipe(expression: Parsed.Expr | undefined): expression is Parsed.BinaryExpr {
  return expression?.kind === "Binary" && expression.operator === "Pipe";
}

/** `a |> f(b) |> g` as `g(f(a, b))`: each stage a call, its own argument list or the stage called. */
function writtenAsCalls(file: Source.File, pipe: Parsed.BinaryExpr): Written {
  const kept: Source.Span[] = [];
  const keep = (span: Source.Span): string => {
    kept.push(span);
    return textOf(file, span);
  };
  const write = (expression: Parsed.Expr): string => {
    if (!isPipe(expression)) return keep(expression.span);
    const subject = write(expression.left);
    const stage = expression.right;
    if (stage.kind === "Call") {
      return `${keep(stage.callee.span)}${markOf(stage, keep)}(${
        [subject, ...stage.arguments.map(({ span }) => keep(span))].join(", ")
      })`;
    }
    return `${callee(stage, keep(stage.span))}${markOf(expression, keep)}(${subject})`;
  };
  return { texts: [write(pipe)], kept };
}

/** A bare stage as a callee: parenthesized unless it is already one by its form. */
function callee(stage: Parsed.Expr, text: string): string {
  return CALLEE_FORMS.has(stage.kind) ? text : `(${text})`;
}

/**
 * Forms a bare stage can take that are a callee as they stand: a name, a path,
 * an index, parentheses. (A stage that is a call has its own list.)
 */
const CALLEE_FORMS: ReadonlySet<Parsed.Expr["kind"]> = new Set(["Name", "Access", "Index", "Group"]);

function markOf(
  marked: { readonly markSpan?: Source.Span },
  keep: (span: Source.Span) => string,
): string {
  return marked.markSpan === undefined ? "" : keep(marked.markSpan);
}

interface CallChain {
  /** The call the range is on, the pipeline's last stage. */
  readonly outer: Parsed.CallExpr;
  /** The calls from the innermost, the pipeline's first stage, out to `outer`. */
  readonly stages: readonly Parsed.CallExpr[];
  /** The innermost call's first argument, which the pipeline starts from. */
  readonly subject: Parsed.Expr;
}

/**
 * The call whose name, mark or parentheses the range is on, with the calls
 * nested in its first argument. None for a call with no argument, a pipe's own
 * stage (its first argument is the pipe's left side, not written in it), or a
 * dot call.
 *
 * A range that starts just before a call's `(` is on that call, whatever its
 * callee: after a name's last letter, a parenthesized callee's `)`, an index's
 * `]`, or the list of a callee that is itself a call (`k(1)‸(2)` is on the
 * outer call).
 */
function callChainAt(
  chain: readonly SyntaxNode[],
  start: number,
  aliases: ReadonlySet<string>,
): CallChain | undefined {
  let at = innermost(chain, (expression) => expression.kind === "Call");
  if (at < 0) return undefined;
  const holding = chain[at - 1]?.expression;
  const atEnd = start === chain[at]!.span.end.offset;
  if (atEnd && holding?.kind === "Call" && holding.callee === chain[at]!.expression) at -= 1;
  const outer = chain[at]!.expression as Parsed.CallExpr;
  const beforeList = start === outer.callee.span.end.offset;
  if (!(beforeList || onName(chain.slice(at + 1), outer.callee.span)) || !pipeable(outer, aliases)) return undefined;
  const holder = chain[at - 1];
  if (isPipe(holder?.expression) && holder.expression.right === outer) return undefined;
  const stages: Parsed.CallExpr[] = [outer];
  let subject = outer.arguments[0]!;
  while (subject.kind === "Call" && pipeable(subject, aliases)) {
    stages.unshift(subject);
    subject = subject.arguments[0]!;
  }
  return { outer, stages, subject };
}

/** A call a pipe can feed: one with a first argument, and not a dot call. */
function pipeable(call: Parsed.CallExpr, aliases: ReadonlySet<string>): boolean {
  return call.arguments.length > 0 && !dotCall(call.callee, aliases);
}

/**
 * Whether a callee is a dot call's `receiver.name`, read off the text as the
 * resolver reads it: an upper-case name before a `.` is a module's alias where
 * one is in scope (Modules §5.1, rule 1), so `Seq.map` is a qualified name, and
 * `v.map` and `None.defaultValue` are dot calls.
 */
function dotCall(callee: Parsed.Expr, aliases: ReadonlySet<string>): boolean {
  if (callee.kind !== "Access") return false;
  let receiver: Parsed.Expr = callee.receiver;
  while (receiver.kind === "Access") {
    if (receiver.field.startClass !== "upper") return true;
    receiver = receiver.receiver;
  }
  return receiver.kind !== "Name" || !aliases.has(receiver.name.text);
}

/**
 * The module aliases in scope in a module: its imports' and the prelude's
 * modules (Modules §5.5), which every module reaches by name.
 */
function moduleAliases(module: Parsed.Module): ReadonlySet<string> {
  const aliases = new Set(PRELUDE_ALIASES);
  for (const item of module.items) if (item.kind === "Import") aliases.add(item.alias.text);
  return aliases;
}

const PRELUDE_ALIASES: readonly string[] = PRELUDE_MODULES.map(({ name }) => name);

/**
 * `g(f(a, b))` as `a |> f(b) |> g`. On a line of its own and over several, as
 * the multiline chain of Lexer Layout §2.3 is: every stage on its own line at
 * the subject's column.
 */
function writtenAsPipeline(file: Source.File, { outer, stages, subject }: CallChain): Written {
  const kept: Source.Span[] = [];
  const keep = (span: Source.Span): string => {
    kept.push(span);
    return textOf(file, span);
  };
  const first = keep(subject.span);
  // A first value that stands bare is tried bare and then parenthesized, for
  // one whose last operand reaches to the right (`1 + if c then 2 else 3`).
  const heads = SUBJECT_FORMS.has(subject.kind) && !(subject.kind === "Unary" && subject.operator === "Not")
    ? [first, `(${first})`]
    : [`(${first})`];
  const written = stages.map((call) => {
    const rest = call.arguments.slice(1).map(({ span }) => keep(span));
    const name = keep(call.callee.span);
    const mark = markOf(call, keep);
    // A stage that is a call is read as taking the pipe into its own list, so
    // a callee that is itself a call keeps an empty one.
    return rest.length > 0 || call.callee.kind === "Call" ? `${name}${mark}(${rest.join(", ")})` : `${name}${mark}`;
  });
  const { text } = file;
  const start = outer.span.start.offset;
  const { end } = solid(file, outer.span);
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const indent = text.slice(lineStart, start);
  const after = text.slice(end).split("\n", 1)[0]!;
  const ownLine = /^[ \t]*$/.test(indent) && /^[ \t]*\r?$/.test(after) && text.slice(start, end).includes("\n");
  const newline = text.slice(start, end).includes("\r\n") ? "\r\n" : "\n";
  // Bare where the pipeline may stand as the call did, as an argument, an
  // element, a statement or an item; parenthesized where it would bind too
  // loosely, as an operand or a receiver. The parse says which.
  const texts = heads.flatMap((head) => {
    const line = [head, ...written].join(" |> ");
    const lines = [head, ...written.map((stage) => `${indent}|> ${stage}`)].join(newline);
    return ownLine ? [lines, `(${lines})`, line, `(${line})`] : [line, `(${line})`];
  });
  return { texts, kept };
}

/**
 * Forms that stand as a pipe's left side as they are. The others reach to the
 * right (a lambda, `if`, `match`) or bind looser than `|>` (`:=`), and are
 * parenthesized. So is a `not`, which binds tighter, by choice: `not a |> f` is
 * `f(not a)`, but reads to a person as `not (a |> f)`.
 */
const SUBJECT_FORMS: ReadonlySet<Parsed.Expr["kind"]> = new Set([
  "Name",
  "Unit",
  "Integer",
  "BigInt",
  "Dec",
  "Float",
  "String",
  "Vector",
  "Tuple",
  "Record",
  "Group",
  "Ascription",
  "Call",
  "PatternConstruction",
  "Access",
  "Index",
  "Unary",
  "Binary",
  "Comparison",
]);

/** The index of the innermost node holding an expression `is` accepts, or -1. */
function innermost(chain: readonly SyntaxNode[], is: (expression: Parsed.Expr) => boolean): number {
  for (let at = chain.length - 1; at >= 0; at -= 1) {
    const { expression } = chain[at]!;
    if (expression !== undefined && is(expression)) return at;
  }
  return -1;
}

/**
 * Whether the nodes the range is in, inside some expression, are only a name
 * or a path of names within `name`: the range is on the name, not inside an
 * argument or a callee's own body. None is the expression's own punctuation.
 */
function onName(inside: readonly SyntaxNode[], name: Source.Span): boolean {
  return inside.every((node) =>
    within(node.span, name) &&
    (node.role === "name" || node.expression?.kind === "Name" || node.expression?.kind === "Access")
  );
}

function within(inner: Source.Span, outer: Source.Span): boolean {
  return outer.start.offset <= inner.start.offset && inner.end.offset <= outer.end.offset;
}

/**
 * A span's text, without the line breaks and spaces a form that ends at a
 * layout boundary, such as a `match`'s last arm, can carry at its end.
 */
function textOf(file: Source.File, span: Source.Span): string {
  const { start, end } = solid(file, span);
  return file.text.slice(start, end);
}

function solid(file: Source.File, span: Source.Span): { readonly start: number; readonly end: number } {
  const start = span.start.offset;
  return { start, end: start + file.text.slice(start, span.end.offset).trimEnd().length };
}
