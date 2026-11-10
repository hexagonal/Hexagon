/**
 * Whether a rewrite of the text keeps the program the parser reads from it.
 *
 * The refactorings that trade one form for another the spec defines as the
 * same: `a |> f(b)` is `f(a, b)` by Operators §8's rewrite, done before
 * inference. So a rewrite is right when the text it leaves parses to the same
 * tree, once each form is read as its definition. That is a question for the
 * parser alone: nothing here asks a type, so there is no second reading of the
 * program to disagree with the checker's.
 *
 * The comparison reads the tree the way the checker does: a pipe as the call
 * it rewrites to, and a pair of parentheses as what they hold, with every
 * position left out. A comment is compared by its text, and the parser's
 * reports by theirs, so a rewrite that drops a comment or breaks the parse is
 * refused as surely as one that changes an expression.
 */

import { applyLayout } from "../passes/layout/layout.js";
import { lex } from "../passes/lexer/lexer.js";
import { parseFile } from "../passes/parser/parser.js";
import * as Source from "../support/source.js";
import { isCompilerMinted } from "../support/synthetic.js";
import type * as Parsed from "../syntax/parsed/index.js";

/** One replacement in a file's text: `[start, end)` becomes `replacement`. */
export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/**
 * Whether replacing `edit` in the module's file leaves the module reading as
 * before. Only the top-level item the edit lies in is parsed again: it starts
 * its line, so its columns, which layout reads, are the file's; the edit cannot
 * reach past it; and parsing a few lines is cheap enough to ask as the dev
 * opens a menu.
 */
export function keepsReading(file: Source.File, module: Parsed.Module, edit: TextEdit): boolean {
  const item = module.items.find(({ span }) => span.start.offset <= edit.start && edit.end <= span.end.offset);
  if (item === undefined) return false;
  const { text } = file;
  const start = item.span.start.offset;
  const end = item.span.end.offset;
  const before = text.slice(start, end);
  const after = before.slice(0, edit.start - start) + edit.replacement + before.slice(edit.end - start);
  return sameReading(parsedText(file, before), parsedText(file, after));
}

function parsedText(file: Source.File, text: string): readonly Parsed.Module[] {
  return parseFile(applyLayout(lex(new Source.File(file.id, file.path, text))), file.path);
}

function sameReading(before: unknown, after: unknown): boolean {
  return JSON.stringify(reading(before)) === JSON.stringify(reading(after));
}

/**
 * A parsed value as the checker reads it: positions dropped, keys in one order,
 * a group as what it holds, a pipe as its call, a lambda that matches its one
 * parameter as the match function it is, and a punned field as written out.
 *
 * But not a group that holds a call's callee written `e.name`: `(e.name)(args)`
 * reads the field and calls it, where `e.name(args)` is a dot call (Method
 * Syntax §2.1), so those parentheses are kept.
 */
function reading(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reading);
  if (value === null || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  if (node.kind === "Call" && fieldCallee(node.callee as Parsed.Expr)) {
    return reading({ ...node, callee: { kind: "FieldCallee", access: node.callee } });
  }
  if (node.kind === "Group" && "expression" in node) return reading(node.expression);
  if (node.kind === "Binary" && node.operator === "Pipe") return reading(pipeCall(node as unknown as Parsed.BinaryExpr));
  if (node.kind === "Lambda") {
    const arms = matchFunctionArms(node as unknown as Parsed.LambdaExpr);
    if (arms !== undefined) return { kind: "MatchFunction", arms: reading(arms) };
  }
  const read: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort()) {
    if (key === "span" || key.endsWith("Span") || key === "offset" || key === "line" || key === "column") continue;
    // A pun is its field written out (Pattern Matching §9): `{x}` is `{x = x}`.
    if (key === "punned") continue;
    read[key] = reading(node[key]);
  }
  return read;
}

/** A callee that reads a field: `e.name` in parentheses, which a dot call is not. */
function fieldCallee(callee: Parsed.Expr): boolean {
  return callee.kind === "Group" && ungrouped(callee).kind === "Access";
}

function ungrouped(expression: Parsed.Expr): Parsed.Expr {
  return expression.kind === "Group" ? ungrouped(expression.expression) : expression;
}

/**
 * The call a pipe stage is (Operators §8), as the checker writes it: into a
 * stage's own argument list when it has one, else a call of the whole stage,
 * carrying the stage's mark.
 */
export function pipeCall(pipe: Parsed.BinaryExpr): Parsed.CallExpr {
  const { left, right } = pipe;
  if (right.kind === "Call") return { ...right, arguments: [left, ...right.arguments], span: pipe.span };
  return {
    kind: "Call",
    callee: right,
    arguments: [left],
    ...(pipe.mark === undefined ? {} : { mark: pipe.mark }),
    ...(pipe.reading === undefined ? {} : { reading: pipe.reading }),
    ...(pipe.markInError === undefined ? {} : { markInError: pipe.markInError }),
    span: pipe.span,
  };
}

/**
 * The arms of a lambda that is a match function (Pattern Matching §6.7): one
 * parameter with no written type, and a body that is a `match` on that
 * parameter alone, with no `catch` clause and the parameter named in no arm.
 * The parser builds the scrutinee-less form as exactly this, its binder one no
 * source can name, so that form and the lambda it is read the same.
 */
function matchFunctionArms(lambda: Parsed.LambdaExpr): readonly Parsed.MatchArm[] | undefined {
  const match = matchedBody(lambda);
  const [parameter, ...others] = lambda.parameters;
  if (match === undefined || parameter === undefined || others.length > 0) return undefined;
  const plain = parameter.annotation === undefined && lambda.returnAnnotation === undefined &&
    lambda.typeParameters === undefined && lambda.destructurings === undefined && match.catchArms === undefined;
  const name = parameter.name.text;
  const onParameter = match.scrutinee.kind === "Name" && match.scrutinee.name.text === name;
  return plain && onParameter && !namesIn(match.arms).has(name) ? match.arms : undefined;
}

/**
 * The `match` a lambda's body is: the body itself, or a block holding it and
 * nothing else, as a body begun on the line after the arrow is.
 */
export function matchedBody(lambda: Parsed.LambdaExpr): Parsed.MatchExpr | undefined {
  const { body } = lambda;
  if (body.kind === "Match") return body;
  if (body.kind !== "Block" || body.items.length !== 1) return undefined;
  const [item] = body.items;
  return item!.kind === "ExprItem" && item.expression.kind === "Match" ? item.expression : undefined;
}

/**
 * Every name spelled in a parsed value: the names it reads, binds or declares,
 * fields and labels included. A lambda's parameter is free to drop or to
 * introduce exactly when its spelling is not among them, which asks more than
 * resolution would and never less.
 *
 * Not the binders the parser mints (a match function's, a pattern parameter's,
 * `_`'s): one is read only inside the lambda that mints it, and they share
 * their spellings, so a nested match function's would read as the outer one's.
 */
export function namesIn(value: unknown): ReadonlySet<string> {
  const names = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.text === "string" && "startClass" in record && !isCompilerMinted(record.text)) {
      names.add(record.text);
    }
    for (const key of Object.keys(record)) if (key !== "span") walk(record[key]);
  };
  walk(value);
  return names;
}
