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
 * before. Only the top-level item the edit lies in is parsed again, from its
 * `fun` block's head where it is a block's member: it starts its line, so its
 * columns, which layout reads, are the file's; the edit cannot reach past it;
 * and parsing a few lines is cheap enough to ask as the dev opens a menu.
 */
export function keepsReading(file: Source.File, module: Parsed.Module, edit: TextEdit): boolean {
  const texts = itemTexts(file, module, edit);
  return texts !== undefined && sameReading(parsedText(file, texts.before), parsedText(file, texts.after));
}

/**
 * Whether replacing `edit` leaves the module reading as before, once the call
 * at `span` in the text before is read as `substitute` makes it from itself and
 * from the call the edit writes in its place, which spans the replacement
 * exactly. For a rewrite between forms the parser reads apart and the checker
 * reads as one, such as a dot call and its qualified call (Method Syntax §1):
 * `substitute` says what the one is as the other.
 */
export function keepsReadingWith(
  file: Source.File,
  module: Parsed.Module,
  edit: TextEdit,
  span: Source.Span,
  substitute: (before: Parsed.CallExpr, after: Parsed.CallExpr) => Parsed.CallExpr,
): boolean {
  const texts = itemTexts(file, module, edit);
  if (texts === undefined) return false;
  const { start } = texts;
  const before = parsedText(file, texts.before);
  const after = parsedText(file, texts.after);
  const old = callAt(before, span.start.offset - start, span.end.offset - start);
  const written = callAt(after, edit.start - start, edit.start - start + edit.replacement.length);
  return old !== undefined && written !== undefined && sameReading(replaced(before, old, substitute(old, written)), after);
}

/**
 * Whether replacing `edit` leaves the module reading as `expect` says the text
 * before it reads once rewritten. `expect` is handed the parsed item before the
 * edit, its offsets counted from `start`, the item's own start. For a rewrite
 * that moves or copies what the tree holds apart, such as an arm written once
 * per alternative of its or-pattern: what is moved is moved in the tree too,
 * comments included, and the text written must read as that.
 */
export function keepsReadingAs(
  file: Source.File,
  module: Parsed.Module,
  edit: TextEdit,
  expect: (before: readonly Parsed.Module[], start: number) => unknown,
): boolean {
  const texts = itemTexts(file, module, edit);
  if (texts === undefined) return false;
  return sameReading(expect(parsedText(file, texts.before), texts.start), parsedText(file, texts.after));
}

/** The text of the top-level item the edit lies in, before and after it, and where the item starts. */
function itemTexts(
  file: Source.File,
  module: Parsed.Module,
  edit: TextEdit,
): { readonly before: string; readonly after: string; readonly start: number } | undefined {
  const item = module.items.find(({ span }) => span.start.offset <= edit.start && edit.end <= span.end.offset);
  if (item === undefined) return undefined;
  // A `fun` block's member is an item of its own that starts under the block's
  // head (Functions §7.3): read from the head, it parses as it does in the file.
  const start = item.kind === "Fun" && item.block !== undefined ? item.block.span.start.offset : item.span.start.offset;
  const before = file.text.slice(start, item.span.end.offset);
  const after = before.slice(0, edit.start - start) + edit.replacement + before.slice(edit.end - start);
  return { before, after, start };
}

/** The call spanning exactly `[start, end)` in a parsed value. */
function callAt(value: unknown, start: number, end: number): Parsed.CallExpr | undefined {
  if (Array.isArray(value)) {
    for (const each of value) {
      const found = callAt(each, start, end);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const node = value as Record<string, unknown>;
  const span = node.span as Source.Span | undefined;
  if (node.kind === "Call" && span?.start.offset === start && span.end.offset === end) {
    return node as unknown as Parsed.CallExpr;
  }
  for (const key of Object.keys(node)) {
    if (key === "span") continue;
    const found = callAt(node[key], start, end);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** A parsed value with one node in it, found by identity, taken for another. */
export function replaced(value: unknown, node: object, by: object): unknown {
  if (value === node) return by;
  if (Array.isArray(value)) return value.map((each) => replaced(each, node, by));
  if (value === null || typeof value !== "object") return value;
  const copy: Record<string, unknown> = {};
  for (const [key, each] of Object.entries(value)) copy[key] = replaced(each, node, by);
  return copy;
}

function parsedText(file: Source.File, text: string): readonly Parsed.Module[] {
  return parseFile(applyLayout(lex(new Source.File(file.id, file.path, text))), file.path);
}

/** Whether two parsed values read the same, as the checker reads them (`reading`). */
export function sameReading(before: unknown, after: unknown): boolean {
  return JSON.stringify(reading(before)) === JSON.stringify(reading(after));
}

/**
 * A parsed value as the checker reads it: positions dropped, keys in one order,
 * a group as what it holds, a pipe as its call, a lambda that matches its one
 * parameter as the match function it is, a punned field as written out, and an
 * or-pattern's alternatives with any or-pattern among them spread in place.
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
  // An or-pattern's alternatives are tried left to right (Pattern Matching
  // §8), so one written inside another is the outer's, in its place.
  if (node.kind === "Or" && Array.isArray(node.alternatives)) {
    const alternatives = (node.alternatives as readonly Parsed.Pattern[]).flatMap(function flat(each): readonly Parsed.Pattern[] {
      return each.kind === "Or" ? each.alternatives.flatMap(flat) : [each];
    });
    return { kind: "Or", alternatives: reading(alternatives) };
  }
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
