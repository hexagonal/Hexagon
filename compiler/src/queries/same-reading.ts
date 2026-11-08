/**
 * Whether a rewrite of the text keeps the program the parser reads from it.
 *
 * The tier-1 refactorings (LANGUAGE-SERVER-PLAN.md, section C) trade one form
 * for another the spec defines as the same: `a |> f(b)` is `f(a, b)` by
 * Operators §8's rewrite, done before inference. So a rewrite is right when the
 * text it leaves parses to the same tree, once each form is read as its
 * definition. That is a question for the parser alone: nothing here asks a
 * type, so there is no second reading of the program to disagree with the
 * checker's (doctrine point 4 asks this only of the refactorings that move
 * code).
 *
 * The comparison reads the tree the way the checker does: a pipe as the call
 * it rewrites to, and a pair of parentheses as what they hold, with every
 * position left out. A comment is compared by its text, so a rewrite that drops
 * one is refused as surely as one that changes an expression.
 */

import { applyLayout } from "../passes/layout/layout.js";
import { lex } from "../passes/lexer/lexer.js";
import { parseFile } from "../passes/parser/parser.js";
import * as Source from "../support/source.js";
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
 * a group as what it holds, and a pipe as its call.
 */
function reading(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reading);
  if (value === null || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  if (node.kind === "Group" && "expression" in node) return reading(node.expression);
  if (node.kind === "Binary" && node.operator === "Pipe") return reading(pipeCall(node as unknown as Parsed.BinaryExpr));
  const read: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort()) {
    if (key === "span" || key.endsWith("Span") || key === "offset" || key === "line" || key === "column") continue;
    read[key] = reading(node[key]);
  }
  return read;
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
