/**
 * Arms with one body written as one arm with an or-pattern, and an or-pattern's
 * arm written as one arm per alternative: a refactoring between forms the spec
 * defines as one another.
 *
 * Arms are tried top to bottom and an or-pattern's alternatives left to right
 * (Pattern Matching §8), so adjacent arms with one body are that body's arm
 * under the or-pattern of their patterns, and back. Or-pattern rows expand
 * before coverage is judged (§7.1), so neither form changes what is reported.
 *
 * - **Only adjacent arms.** Moving an arm past another changes which one wins
 *   wherever their patterns overlap.
 * - **No guard.** A guard runs at most once per `match`, after the first
 *   alternative that matches, and a false one falls to the next arm (§3, §8):
 *   two arms run their guards in turn, so the forms differ.
 * - **The same names at the same types.** An or-pattern binds the same names in
 *   every alternative, at unifiable types (§2.6). The names are read from the
 *   text; the types from the checker's one solve, and asked to be equal, not
 *   only unifiable, since unifying two types inference kept apart would narrow
 *   the function the `match` is in.
 * - **The same body**, read as the parser reads it (`same-reading.ts`): the
 *   first arm's text is kept, and a comment only another arm holds is lost.
 *
 * Each rewrite is checked by parsing what it leaves: the arms must read as the
 * ones before with the run combined, or the arm split, comments moved with them.
 */

import * as Source from "../support/source.js";
import * as Parsed from "../syntax/parsed/index.js";
import * as Typed from "../syntax/typed/index.js";
import { type Refactoring, rewrite, solid } from "./rewrite.js";
import { keepsReadingAs, replaced, sameReading, type TextEdit } from "./same-reading.js";

export const SPLIT_TITLE = "Split the arm into one per alternative";
export const combineTitle = (count: number): string => `Combine the ${count} arms with this body`;

const GUARDED = "An arm with a `when` guard runs it once, after the first of its alternatives that matches, and " +
  "separate arms run theirs in turn (Pattern Matching §3), so the two forms differ wherever two of these patterns " +
  "match one value. Where none do, write the other form by hand.";

/** The combine and split rewrites offered for `[start, end]` of one parsed module. */
export function matchArmRefactorings(
  file: Source.File,
  module: Parsed.Module,
  typed: Typed.Module,
  start: number,
  end: number,
): readonly Refactoring[] {
  const lists = armLists(module);
  const head = headAt(file, module, lists, start, end);
  if (head !== undefined) {
    // A selection of one whole arm touches no other to combine it with.
    const combining = head.whole ? [] : combined(file, module, typed, head.arms, runAround(head.arms, head.index));
    return [...combining, ...split(file, module, head.arms, head.index)];
  }
  const selected = armsSelected(file, module, lists, start, end);
  return selected === undefined ? [] : combined(file, module, typed, selected.arms, selected.run);
}

/** Every list of arms in the module: a `match`'s, its `catch` clause's, a `try`'s. */
function armLists(module: Parsed.Module): readonly (readonly Parsed.MatchArm[])[] {
  const lists: (readonly Parsed.MatchArm[])[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.kind === "Match" || record.kind === "Try") {
      for (const key of ["arms", "catchArms"]) {
        const arms = record[key] as readonly Parsed.MatchArm[] | undefined;
        if (arms !== undefined && arms.length > 0) lists.push(arms);
      }
    }
    for (const key of Object.keys(record)) if (key !== "span") walk(record[key]);
  };
  walk(module.items);
  return lists;
}

/**
 * The arm whose head holds `[start, end]`, its pattern, its guard and its
 * arrow, up to its body, the spaces before it on its line aside; or that a selection
 * takes whole, comments after it on its line or not, which is `whole`. A
 * caret before the body's first character is on the body. Of two arms whose
 * heads hold it, the inner one, of a `match` in the outer's guard.
 */
function headAt(
  file: Source.File,
  module: Parsed.Module,
  lists: readonly (readonly Parsed.MatchArm[])[],
  start: number,
  end: number,
): { readonly arms: readonly Parsed.MatchArm[]; readonly index: number; readonly whole: boolean } | undefined {
  const selected = trimmed(file, start, end);
  // A head selected from its line's start: the spaces before it, not a line break.
  let from = start;
  while (from < end && /[ \t]/.test(file.text[from]!)) from += 1;
  const reach = (arm: Parsed.MatchArm): "head" | "whole" | undefined => {
    const { span, body } = arm;
    if (start === end) return span.start.offset <= start && start < body.span.start.offset ? "head" : undefined;
    if (span.start.offset <= from && end <= body.span.start.offset) return "head";
    const ends = [solidEnd(file, arm), lineEnd(file, module, arm)];
    return selected.start === span.start.offset && ends.includes(selected.end) ? "whole" : undefined;
  };
  let found: { readonly arms: readonly Parsed.MatchArm[]; readonly index: number; readonly whole: boolean } | undefined;
  for (const arms of lists) {
    arms.forEach((arm, index) => {
      const held = reach(arm);
      if (held !== undefined && (found === undefined || found.arms[found.index]!.span.start.offset < arm.span.start.offset)) {
        found = { arms, index, whole: held === "whole" };
      }
    });
  }
  return found;
}

/** A selection without the spaces and line breaks at its ends, as a selection of whole lines has. */
function trimmed(file: Source.File, start: number, end: number): { readonly start: number; readonly end: number } {
  while (start < end && /\s/.test(file.text[start]!)) start += 1;
  while (start < end && /\s/.test(file.text[end - 1]!)) end -= 1;
  return { start, end };
}

/**
 * The arms a selection touches, two or more of one list, with the selection
 * inside that list, its spaces and line breaks aside, and the comments after
 * the last arm on its line. At most one list has them: a list inside another
 * lies in one arm of it.
 */
function armsSelected(
  file: Source.File,
  module: Parsed.Module,
  lists: readonly (readonly Parsed.MatchArm[])[],
  selectionStart: number,
  selectionEnd: number,
): { readonly arms: readonly Parsed.MatchArm[]; readonly run: readonly number[] } | undefined {
  const { start, end } = trimmed(file, selectionStart, selectionEnd);
  for (const arms of lists) {
    if (start < arms[0]!.span.start.offset || lineEnd(file, module, arms.at(-1)!) < end) continue;
    const run = arms.flatMap((arm, index) => arm.span.start.offset < end && start < solidEnd(file, arm) ? [index] : []);
    if (run.length >= 2) return { arms, run };
  }
  return undefined;
}

/**
 * The run of adjacent arms around the one at `index` whose bodies read as its
 * body does, stopping at a fault arm (`fault x` is a whole arm's pattern only,
 * Exceptions §5.2) and, from an arm with no guard, at a guarded one. From a
 * guarded arm the run takes its neighbours, to be refused for its guard.
 */
function runAround(arms: readonly Parsed.MatchArm[], index: number): readonly number[] {
  const arm = arms[index]!;
  const joins = (other: Parsed.MatchArm | undefined): boolean =>
    other !== undefined && other.fault !== true && sameBody(other.body, arm.body) &&
    (arm.guard !== undefined || other.guard === undefined);
  let first = index;
  let last = index;
  while (joins(arms[first - 1])) first -= 1;
  while (joins(arms[last + 1])) last += 1;
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

/** The run of arms written as one arm with the or-pattern of their patterns, or why it cannot be. */
function combined(
  file: Source.File,
  module: Parsed.Module,
  typed: Typed.Module,
  arms: readonly Parsed.MatchArm[],
  run: readonly number[],
): readonly Refactoring[] {
  const members = run.map((index) => arms[index]!);
  if (members.length < 2 || members.some(({ fault }) => fault === true)) return [];
  if (!members.every(({ body }) => sameBody(body, members[0]!.body))) return [];
  const title = combineTitle(members.length);
  if (members.some(({ guard }) => guard !== undefined)) return [{ title, disabled: GUARDED }];
  const mismatch = bindingMismatch(typed, members);
  if (mismatch === undefined) return [];
  if (mismatch !== "") return [{ title, disabled: mismatch }];
  const [first] = members;
  const target = { span: file.span(first!.span.start.offset, lineEnd(file, module, members.at(-1)!)) };
  const rest = file.span(first!.pattern.span.end.offset, lineEnd(file, module, first!));
  const text = members.map(({ pattern }) => alternative(file, pattern)).join(" | ") + textIn(file, rest);
  const kept = [...members.map(({ pattern }) => pattern.span), rest];
  return [rewrite(file, module, title, target, { texts: [text], kept }, readsCombined(file, module, arms, run, kept))];
}

/**
 * Whether an edit leaves the arms reading as they do with the run combined: its
 * patterns as the alternatives of the first arm's, the comments in `kept` (the
 * spans the edit writes, in its order) where it writes them. Exported for its
 * tests, which hand it edits no rewrite here writes.
 */
export function readsCombined(
  file: Source.File,
  module: Parsed.Module,
  arms: readonly Parsed.MatchArm[],
  run: readonly number[],
  kept: readonly Source.Span[],
): (edit: TextEdit) => boolean {
  return (edit) =>
    keepsReadingAs(file, module, edit, (before, start) => {
      const list = armListAt(before, arms[run[0]!]!.span.start.offset - start);
      if (list === undefined) return undefined;
      const head = list[run[0]!]!;
      const alternatives = list.slice(run[0]!, run.at(-1)! + 1).map(({ pattern }) => pattern);
      const one: Parsed.MatchArm = { ...head, pattern: { kind: "Or", alternatives, span: head.pattern.span } };
      const armsAfter = [...list.slice(0, run[0]!), one, ...list.slice(run.at(-1)! + 1)];
      return withComments(replaced(before, list, armsAfter), kept, start, [kept]);
    });
}

/** The arm whose pattern is an or-pattern written once per alternative, or why it cannot be. */
function split(file: Source.File, module: Parsed.Module, arms: readonly Parsed.MatchArm[], index: number): readonly Refactoring[] {
  const arm = arms[index]!;
  const { pattern } = arm;
  const or = orOf(pattern);
  if (or === undefined) return [];
  if (arm.guard !== undefined) return [{ title: SPLIT_TITLE, disabled: GUARDED }];
  // Each new arm starts a line at the arm's own column, with the file's line break.
  const lineStart = file.text.lastIndexOf("\n", arm.span.start.offset - 1) + 1;
  const indent = file.text.slice(lineStart, arm.span.start.offset);
  if (indent.trim() !== "") return [];
  const newline = file.text[lineStart - 2] === "\r" ? "\r\n" : "\n";
  const target = { span: file.span(arm.span.start.offset, lineEnd(file, module, arm)) };
  const after = following(file, module, arm, or);
  const rest = after.map((span) => textIn(file, span)).join("");
  // Under an `as`, an alternative keeps the parentheses an `as` of its own has.
  const text = alternativesOf(or)
    .map((each) => (or === pattern ? whole(file, each) : textIn(file, each.span)) + rest)
    .join(`${newline}${indent}`);
  const kept = [...alternativesOf(or).map(({ span }) => span), ...after];
  return [rewrite(file, module, SPLIT_TITLE, target, { texts: [text], kept }, readsSplit(file, module, arms, index, after))];
}

/** The or-pattern an arm's pattern is, or is under a top-level `as`. */
function orOf(pattern: Parsed.Pattern): Parsed.OrPattern | undefined {
  return pattern.kind === "As" && pattern.pattern.kind === "Or" ? pattern.pattern : pattern.kind === "Or" ? pattern : undefined;
}

/** An or-pattern's alternatives, those of an or-pattern among them in its place, as they are tried (Pattern Matching §8). */
function alternativesOf(or: Parsed.OrPattern): readonly Parsed.Pattern[] {
  return or.alternatives.flatMap((each) => each.kind === "Or" ? alternativesOf(each) : [each]);
}

/**
 * What follows an arm's alternatives, copied into each arm a split writes: an
 * `as` and its name, without the parentheses it may be written in, then what
 * follows the pattern on the arm's last line, the arrow, the body and its comments.
 */
function following(file: Source.File, module: Parsed.Module, arm: Parsed.MatchArm, or: Parsed.OrPattern): readonly Source.Span[] {
  const rest = file.span(arm.pattern.span.end.offset, lineEnd(file, module, arm));
  return arm.pattern.kind === "As" ? [file.span(or.span.end.offset, arm.pattern.name.span.end.offset), rest] : [rest];
}

/**
 * Whether an edit leaves the arms reading as they do with the arm at `index`
 * written once per alternative, each copy followed by the spans in `after`
 * (what follows the alternatives) and the comments in them. Exported for its
 * tests, which hand it edits no rewrite here writes.
 */
export function readsSplit(
  file: Source.File,
  module: Parsed.Module,
  arms: readonly Parsed.MatchArm[],
  index: number,
  after: readonly Source.Span[],
): (edit: TextEdit) => boolean {
  const alternatives = alternativesOf(orOf(arms[index]!.pattern)!);
  const kept = [...alternatives.map(({ span }) => span), ...after];
  return (edit) =>
    keepsReadingAs(file, module, edit, (before, start) => {
      const list = armListAt(before, arms[index]!.span.start.offset - start);
      if (list === undefined) return undefined;
      const old = list[index]!;
      const each = alternativesOf(orOf(old.pattern)!).map((alternative): Parsed.MatchArm => ({
        ...old,
        pattern: old.pattern.kind === "As" ? { ...old.pattern, pattern: alternative } : alternative,
      }));
      const armsAfter = [...list.slice(0, index), ...each, ...list.slice(index + 1)];
      return withComments(replaced(before, list, armsAfter), kept, start, alternatives.map(({ span }) => [span, ...after]));
    });
}

/**
 * Whether the arms bind the same names at the same types, as one or-pattern
 * must (Pattern Matching §2.6): `""` where they do, the reason where they do
 * not, `undefined` where the checker could not read an arm's pattern as
 * written, as with a constructor its scrutinee's type does not have, which it
 * reads as `_`.
 */
function bindingMismatch(typed: Typed.Module, members: readonly Parsed.MatchArm[]): string | undefined {
  const bound: ReadonlyMap<string, Typed.Type>[] = [];
  for (const member of members) {
    const checked = typedArm(typed, member);
    const binders = checked === undefined ? undefined : bindersOf(checked.pattern);
    const written = namesBound(member.pattern);
    if (binders === undefined || binders.size !== written.size) return undefined;
    bound.push(binders);
  }
  const [first, ...others] = bound;
  for (const other of others) {
    for (const name of new Set([...first!.keys(), ...other.keys()])) {
      const left = first!.get(name);
      const right = other.get(name);
      if (left === undefined || right === undefined) {
        return `\`${name}\` is bound in one of these arms and not in another, and an or-pattern binds the same names ` +
          "in every alternative (Pattern Matching §2.6).";
      }
      if (typeKey(left) !== typeKey(right)) {
        // Shown only where each display names one type: a variable's letter
        // need not be the one the source writes, and two types of one name
        // from two modules show alike.
        const [one, another] = [left, right].map((type) => Typed.displayCallFace({ variables: [], constraints: [], type }).type);
        return one === another || [left, right].some(variable)
          ? `\`${name}\` has a different type in each of these arms, and an or-pattern binds it at one type.`
          : `\`${name}\` is \`${one}\` in one of these arms and \`${another}\` in another, and an or-pattern binds it at one type.`;
      }
    }
  }
  return "";
}

/** The checked arm at a parsed arm's place. */
function typedArm(typed: Typed.Module, arm: Parsed.MatchArm): Typed.MatchArm | undefined {
  let found: Typed.MatchArm | undefined;
  const walk = (node: unknown): void => {
    if (found !== undefined) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const span = record.span as Source.Span | undefined;
    if ("pattern" in record && "body" in record && span?.start.offset === arm.span.start.offset) {
      found = record as unknown as Typed.MatchArm;
      return;
    }
    for (const key of Object.keys(record)) if (key !== "span" && key !== "type") walk(record[key]);
  };
  walk(typed.items);
  return found;
}

/** The names a checked pattern binds, each at the type the checker gave it. */
function bindersOf(pattern: Typed.Pattern): ReadonlyMap<string, Typed.Type> {
  const bound = new Map<string, Typed.Type>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const binding = record.binding as Typed.Binding | undefined;
    // An or-pattern's alternatives bind each name at one type (§2.6), so any one of them says it.
    if (binding !== undefined) bound.set(binding.name, binding.scheme.type);
    for (const key of Object.keys(record)) if (key !== "span") walk(record[key]);
  };
  walk(pattern);
  return bound;
}

/** The names a parsed pattern binds, as written. */
function namesBound(pattern: Parsed.Pattern): ReadonlySet<string> {
  const names = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.kind === "Binding" || record.kind === "As") names.add((record.name as Parsed.Name).text);
    for (const key of Object.keys(record)) if (key !== "span") walk(record[key]);
  };
  walk(pattern);
  return names;
}

/**
 * A type as one key: equal keys are one type, however its names were written
 * (`qualifier`), and in whatever order a record type's fields were, or the
 * colours a colour is joined from.
 */
function typeKey(type: Typed.Type): string {
  return JSON.stringify(type, (key, value: unknown) => {
    if (key === "qualifier") return undefined;
    const record = value as Partial<Typed.RecordType> & { readonly join?: readonly number[] } | null;
    if (typeof value !== "object" || record === null) return value;
    // A colour joined from several is one colour whatever order inference met them in.
    if (Array.isArray(record.join)) return { ...record, join: [...record.join].sort((left, right) => left - right) };
    return record.kind === "Record"
      ? { ...record, fields: [...record.fields!].sort((left, right) => left.name.localeCompare(right.name)) }
      : value;
  });
}

/**
 * Whether a type holds a variable a display letters: a type's or a record's
 * tail. A colour's shows as `>->`, a letter of none.
 */
function variable(type: Typed.Type): boolean {
  let found = false;
  JSON.stringify(type, (_, value: unknown) => {
    const node = value as { readonly kind?: unknown; readonly tail?: unknown } | null;
    if (node?.kind === "Variable" || (node?.kind === "Record" && node.tail !== undefined)) found = true;
    return value;
  });
  return found;
}

/**
 * A pattern's text as an alternative: an `as` is looser than `|` (§2.7), so it
 * takes parentheses where it has none. Its own span ends at its name unless
 * the parentheses are the span's.
 */
function alternative(file: Source.File, pattern: Parsed.Pattern): string {
  const text = textIn(file, pattern.span);
  return pattern.kind === "As" && !text.endsWith(")") ? `(${text})` : text;
}

/** An alternative's text as a whole arm's pattern, without the parentheses an `as` needed among alternatives. */
function whole(file: Source.File, pattern: Parsed.Pattern): string {
  const text = textIn(file, pattern.span);
  return pattern.kind === "As" && text.endsWith(")") ? text.slice(1, -1).trim() : text;
}

/**
 * Whether two arms' bodies read alike, a body begun on the line after its
 * arrow as the one written after it: the block that holds it and nothing else
 * only says where it was written (`Parsed.unwrapBindingValue`).
 */
function sameBody(left: Parsed.Expr, right: Parsed.Expr): boolean {
  return sameReading(Parsed.unwrapBindingValue(left), Parsed.unwrapBindingValue(right));
}

/** The list of parsed arms holding an arm that starts at `start`. */
function armListAt(value: unknown, start: number): readonly Parsed.MatchArm[] | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    const holds = value.some((each) => {
      const record = each as Record<string, unknown> | null;
      return record !== null && typeof record === "object" && "pattern" in record && "body" in record &&
        (record.span as Source.Span).start.offset === start;
    });
    if (holds) return value as readonly Parsed.MatchArm[];
    for (const each of value) {
      const found = armListAt(each, start);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [key, each] of Object.entries(value)) {
    if (key === "span") continue;
    const found = armListAt(each, start);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The parsed modules with their comments where the rewrite leaves them: the
 * comments in `regions` (spans of the file, the item starting at `start`)
 * taken out, and written again where the rewrite writes those regions, in
 * `order`, one list of regions for each copy it writes.
 */
function withComments(
  modules: unknown,
  regions: readonly Source.Span[],
  start: number,
  order: readonly (readonly Source.Span[])[],
): unknown {
  const inside = (comment: Source.Comment, span: Source.Span): boolean =>
    span.start.offset - start <= comment.span.start.offset && comment.span.end.offset <= span.end.offset - start;
  return (modules as readonly Parsed.Module[]).map((parsed) => {
    const moved = parsed.comments.filter((comment) => regions.some((span) => inside(comment, span)));
    if (moved.length === 0) return parsed;
    const at = parsed.comments.indexOf(moved[0]!);
    const written = order.flatMap((copy) => copy.flatMap((span) => moved.filter((comment) => inside(comment, span))));
    const kept = parsed.comments.filter((comment) => !moved.includes(comment));
    return { ...parsed, comments: [...kept.slice(0, at), ...written, ...kept.slice(at)] };
  });
}

function textIn(file: Source.File, span: Source.Span): string {
  return file.text.slice(span.start.offset, span.end.offset);
}

/** Where an arm ends, without the line breaks and spaces the last arm can carry. */
function solidEnd(file: Source.File, arm: Parsed.MatchArm): number {
  return solid(file, arm.span).end;
}

/**
 * Where an arm ends with the comments after its body on its last line, which
 * are the arm's: the rewrite moves them with the arm's text, or refuses where
 * the arm's text is dropped. Anything but a comment there (a `)` closing what
 * the `match` stands in) is not the arm's.
 */
function lineEnd(file: Source.File, module: Parsed.Module, arm: Parsed.MatchArm): number {
  let end = solidEnd(file, arm);
  for (let at = end; ;) {
    while (file.text[at] === " " || file.text[at] === "\t") at += 1;
    const comment = module.comments.find(({ span }) => span.start.offset === at);
    if (comment === undefined) return end;
    at = end = comment.span.end.offset;
  }
}
