/**
 * A record's fields as puns and written out, either way: a refactoring between
 * forms the spec defines as one another.
 *
 * `{x}` is `{x = x}`, in a literal, an update and a pattern alike (Pattern
 * Matching §2.4 and §9, Products §3.1): "that's the entire punning rule". So
 * each form can be written as the other with no question of meaning, and each
 * rewrite is checked only by parsing what it leaves (`same-reading.ts`).
 *
 * - **On a field**, or on several in a selection, the fields written `x = x` are
 *   written as puns, and the puns are written out.
 * - **On the record but no field** (a brace, `with`, the record being updated),
 *   every field of it.
 *
 * A field whose value is not its own name bare, `{x = y}` or `{x = M.x}`, has no
 * pun. A keyword-named field has none either (Lexer §4.4), and is never one.
 */

import * as Source from "../support/source.js";
import type * as Parsed from "../syntax/parsed/index.js";
import { type Refactoring, rewrite } from "./rewrite.js";

/** The pun rewrites offered for `[start, end]` of one parsed module. */
export function recordPunRefactorings(
  file: Source.File,
  module: Parsed.Module,
  start: number,
  end: number,
): readonly Refactoring[] {
  const record = innermostRecord(module, start, end);
  if (record === undefined) return [];
  const touched = record.fields.filter(({ span }) =>
    start === end
      ? span.start.offset <= start && start <= span.end.offset
      : span.start.offset < end && start < span.end.offset
  );
  const fields = (touched.length > 0 ? touched : record.fields).map(fieldForm);
  const found: Refactoring[] = [];
  const outs = fields.filter((field) => field?.form === "out") as Field[];
  const puns = fields.filter((field) => field?.form === "pun") as Field[];
  if (outs.length > 0) {
    const title = outs.length === 1 ? `Write the field \`${outs[0]!.name}\` as a pun` : "Write the fields as puns";
    found.push(rewritten(file, module, title, outs, (field) => field.name));
  }
  if (puns.length > 0) {
    const title = puns.length === 1 ? `Write the pun \`${puns[0]!.name}\` out` : "Write the puns out";
    found.push(rewritten(file, module, title, puns, (field) => `${field.name} = ${field.name}`));
  }
  return found;
}

/** A record literal or update, or a record pattern: the forms that pun. */
type PunningRecord = Parsed.RecordExpr | Parsed.RecordPattern;

/** A field that is a pun, or is written out and could be one. */
interface Field {
  readonly form: "pun" | "out";
  readonly name: string;
  readonly span: Source.Span;
}

/**
 * Whether a field is a pun, written out as one could be, or neither. A literal's
 * field says which it is. A pattern's pun is its binding, standing where the
 * field's name does; written out, the binding comes after the `=`.
 */
function fieldForm(field: Parsed.RecordField | Parsed.RecordPatternField): Field | undefined {
  const { name, span } = field;
  const bare = "value" in field
    ? field.value.kind === "Name" && field.value.name.text === name.text
    : field.pattern.kind === "Binding" && field.pattern.name.text === name.text;
  if (!bare) return undefined;
  const punned = "value" in field ? field.punned : field.pattern.span.start.offset === name.span.start.offset;
  return { form: punned ? "pun" : "out", name: name.text, span };
}

/**
 * The fields rewritten each as `write` has it, in one edit from the first to the
 * last, keeping the text between them as written.
 */
function rewritten(
  file: Source.File,
  module: Parsed.Module,
  title: string,
  fields: readonly Field[],
  write: (field: Field) => string,
): Refactoring {
  const kept: Source.Span[] = [];
  let replacement = "";
  for (const [index, field] of fields.entries()) {
    if (index > 0) {
      const between = file.span(fields[index - 1]!.span.end.offset, field.span.start.offset);
      kept.push(between);
      replacement += file.text.slice(between.start.offset, between.end.offset);
    }
    replacement += write(field);
  }
  const span = file.span(fields[0]!.span.start.offset, fields.at(-1)!.span.end.offset);
  return rewrite(file, module, title, { span }, { texts: [replacement], kept });
}

/**
 * The record, literal, update or pattern, that holds `[start, end]` and no other
 * record holding it does: the one with the narrowest span. A record type is not
 * one, and nor is a record with no fields.
 */
function innermostRecord(module: Parsed.Module, start: number, end: number): PunningRecord | undefined {
  let found: PunningRecord | undefined;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (punning(record) && holds(record.span, start, end) && (found === undefined || width(record.span) < width(found.span))) {
      found = record;
    }
    for (const key of Object.keys(record)) if (key !== "span") walk(record[key]);
  };
  walk(module.items);
  return found;
}

/**
 * Whether a parsed node is a record that puns: its fields have values or
 * patterns, where a record type's and a record declaration's have types.
 */
function punning(node: Record<string, unknown>): node is Record<string, unknown> & PunningRecord {
  if (!Array.isArray(node.fields)) return false;
  const [first] = node.fields as readonly Record<string, unknown>[];
  return first !== undefined && ("value" in first || "pattern" in first);
}

function holds(span: Source.Span, start: number, end: number): boolean {
  return span.start.offset <= start && end <= span.end.offset;
}

function width(span: Source.Span): number {
  return span.end.offset - span.start.offset;
}
