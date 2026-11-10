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
import type * as Parsed from "../syntax/parsed/index.js";
import * as Typed from "../syntax/typed/index.js";
import { type Refactoring, rewrite, solid } from "./rewrite.js";
import { keepsReadingAs, replaced, sameReading, type TextEdit } from "./same-reading.js";

export const SPLIT_TITLE = "Split the arm into one per alternative";
export const combineTitle = (count: number): string => `Combine the ${count} arms with this body`;

const GUARDED = "An arm with a `when` guard runs it once per `match`, after the first alternative that matches " +
  "(Pattern Matching §3), so its alternatives and separate arms are not the same.";

/** The combine and split rewrites offered for `[start, end]` of one parsed module. */
export function matchArmRefactorings(
  file: Source.File,
  module: Parsed.Module,
  typed: Typed.Module,
  start: number,
  end: number,
): readonly Refactoring[] {
  const lists = armLists(module);
  const head = headAt(lists, start, end);
  if (head !== undefined) {
    return [...combined(file, module, typed, head.arms, runAround(head.arms, head.index)), ...split(file, module, head.arms, head.index)];
  }
  const selected = armsSelected(file, lists, start, end);
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
 * The arm whose head holds `[start, end]`: its pattern, its guard and its
 * arrow, up to its body. A caret before the body's first character is on the body.
 */
function headAt(
  lists: readonly (readonly Parsed.MatchArm[])[],
  start: number,
  end: number,
): { readonly arms: readonly Parsed.MatchArm[]; readonly index: number } | undefined {
  for (const arms of lists) {
    const index = arms.findIndex(({ span, body }) =>
      span.start.offset <= start && (start === end ? start < body.span.start.offset : end <= body.span.start.offset)
    );
    if (index >= 0) return { arms, index };
  }
  return undefined;
}

/**
 * The arms a selection touches, two or more of one list, with the selection
 * inside that list. At most one list has them: a list inside another lies in
 * one arm of it.
 */
function armsSelected(
  file: Source.File,
  lists: readonly (readonly Parsed.MatchArm[])[],
  start: number,
  end: number,
): { readonly arms: readonly Parsed.MatchArm[]; readonly run: readonly number[] } | undefined {
  for (const arms of lists) {
    if (start < arms[0]!.span.start.offset || solidEnd(file, arms.at(-1)!) < end) continue;
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
    other !== undefined && other.fault !== true && sameReading(other.body, arm.body) &&
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
  if (!members.every(({ body }) => sameReading(body, members[0]!.body))) return [];
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
  // Each new arm starts a line at the arm's own column.
  const lineStart = file.text.lastIndexOf("\n", arm.span.start.offset - 1) + 1;
  const indent = file.text.slice(lineStart, arm.span.start.offset);
  if (indent.trim() !== "") return [];
  const target = { span: file.span(arm.span.start.offset, lineEnd(file, module, arm)) };
  // What follows the alternatives, copied into every arm: an `as`, the arrow, the body.
  const rest = file.span(or.span.end.offset, lineEnd(file, module, arm));
  const after = textIn(file, rest);
  // Under an `as`, an alternative keeps the parentheses an `as` of its own has.
  const text = or.alternatives
    .map((each) => (or === pattern ? whole(file, each) : textIn(file, each.span)) + after)
    .join(`\n${indent}`);
  const kept = [...or.alternatives.map(({ span }) => span), rest];
  return [rewrite(file, module, SPLIT_TITLE, target, { texts: [text], kept }, readsSplit(file, module, arms, index, rest))];
}

/** The or-pattern an arm's pattern is, or is under a top-level `as`. */
function orOf(pattern: Parsed.Pattern): Parsed.OrPattern | undefined {
  return pattern.kind === "Or" ? pattern : pattern.kind === "As" && pattern.pattern.kind === "Or" ? pattern.pattern : undefined;
}

/**
 * Whether an edit leaves the arms reading as they do with the arm at `index`
 * written once per alternative, each copy followed by `rest` (what follows the
 * alternatives) and the comments in them. Exported for its tests, which hand it
 * edits no rewrite here writes.
 */
export function readsSplit(
  file: Source.File,
  module: Parsed.Module,
  arms: readonly Parsed.MatchArm[],
  index: number,
  rest: Source.Span,
): (edit: TextEdit) => boolean {
  const { alternatives } = orOf(arms[index]!.pattern)!;
  const kept = [...alternatives.map(({ span }) => span), rest];
  return (edit) =>
    keepsReadingAs(file, module, edit, (before, start) => {
      const list = armListAt(before, arms[index]!.span.start.offset - start);
      if (list === undefined) return undefined;
      const old = list[index]!;
      const each = orOf(old.pattern)!.alternatives.map((alternative): Parsed.MatchArm => ({
        ...old,
        pattern: old.pattern.kind === "As" ? { ...old.pattern, pattern: alternative } : alternative,
      }));
      const armsAfter = [...list.slice(0, index), ...each, ...list.slice(index + 1)];
      return withComments(replaced(before, list, armsAfter), kept, start, alternatives.map(({ span }) => [span, rest]));
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
        const shown = [left, right].map((type) => Typed.displayScheme({ variables: [], constraints: [], type }));
        return shown[0] === shown[1]
          ? `\`${name}\` has a different type in each of these arms, and an or-pattern binds it at one type.`
          : `\`${name}\` is \`${shown[0]}\` in one of these arms and \`${shown[1]}\` in another, and an or-pattern binds it at one type.`;
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

/** A type as one key: equal keys are one type, however its names were written (`qualifier`). */
function typeKey(type: Typed.Type): string {
  return JSON.stringify(type, (key, value: unknown) => key === "qualifier" ? undefined : value);
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
  return pattern.kind === "As" && text.endsWith(")") ? text.slice(1, -1) : text;
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
