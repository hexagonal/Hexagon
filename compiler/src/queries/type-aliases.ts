/**
 * A type written in place given a name as a `type` alias, and an alias written
 * out as its body: refactorings between forms the spec defines as one another.
 *
 * An alias and its expansion are the same type (Declarations Preamble §4): the
 * checker expands an alias away, and only what hovers and the `.d.ts` file
 * show changes (§6). A callback parameter's type is a function type directly
 * or through an alias (Effects §2.4), so an arrow reads the same either way.
 *
 * - **Write the alias out**, on a use: the use becomes the alias's body, with
 *   the use's arguments in place of its parameters.
 * - **Write the alias out everywhere**, on the alias's name where it is
 *   declared: every use in its module, and the declaration with them unless
 *   it is exported, since another module may use it.
 * - **Introduce a type alias**, on a type: `type NewType = ` the type, above
 *   the item it is written in, and the alias in its place. The type's
 *   variables are the alias's parameters, in the order the type first writes
 *   them, so it uses every one (§5.3). The name is one stand-in written in both
 *   places, which the dev types once.
 * - **Introduce a type alias for its N places**, beside it where the module
 *   writes the type more than once: the alias in every place that reads as
 *   the type, variables by name, declared above the first.
 *
 * Names are read from the text alone: an alias's name means the alias
 * throughout its module (§7.2), save where a constraint's implied type of that
 * name stands. Each rewrite is checked by parsing what it leaves: the text
 * written must read as the alias expanded in the tree.
 */

import { isFollowing } from "../support/arrows.js";
import type * as Diagnostics from "../support/diagnostics.js";
import * as Source from "../support/source.js";
import type * as Parsed from "../syntax/parsed/index.js";
import { type Refactoring, rewrite, solid, textOf } from "./rewrite.js";
import { keepsReadingAs, parsedText, replaced, sameReading, type TextEdit } from "./same-reading.js";

export const WRITE_OUT_TITLE = "Write the alias out";
export const WRITE_OUT_EVERYWHERE_TITLE = "Write the alias out everywhere";
export const INTRODUCE_TITLE = "Introduce a type alias";
export const introduceEverywhereTitle = (count: number): string => `Introduce a type alias for its ${count} places`;

const BODY_COMMENT = "The alias's body holds a comment, which writing it out would copy. Move the comment out first.";
const PARSES_OTHERWISE = "Written the other way here, it would parse as a different program.";

/** An alias written where a type goes: its bare name, or its name applied. */
type Use = Parsed.NamedType | Parsed.AppliedType;

/** The alias rewrites offered for `[start, end]` of one parsed module. */
export function typeAliasRefactorings(
  file: Source.File,
  module: Parsed.Module,
  start: number,
  end: number,
): readonly Refactoring[] {
  const aliases = aliasesOf(module);
  return [
    ...writeOutAt(file, module, aliases, start, end),
    ...writeOutEverywhereAt(file, module, aliases, start, end),
    ...introduceAt(file, module, start, end),
  ];
}

/**
 * The module's aliases by name, each the one type the module declares under
 * it, and well formed: its body names neither the alias itself (§5.4) nor any
 * type variable but its parameters.
 */
function aliasesOf(module: Parsed.Module): ReadonlyMap<string, Parsed.TypeAliasItem> {
  const declared = new Map<string, number>();
  const declare = (name: Parsed.Name): void => void declared.set(name.text, (declared.get(name.text) ?? 0) + 1);
  for (const item of module.items) {
    if (item.kind === "TypeAlias" || item.kind === "RecordDeclaration" || item.kind === "Union") declare(item.name);
    if (item.kind === "ExternBlock") {
      for (const declaration of item.declarations) if (declaration.kind === "ExternType") declare(declaration.localName);
    }
  }
  const aliases = new Map<string, Parsed.TypeAliasItem>();
  for (const item of module.items) {
    if (item.kind !== "TypeAlias" || declared.get(item.name.text) !== 1) continue;
    const parameters = new Set(item.parameters.map(({ text }) => text));
    const wellFormed = [...typesIn(item.annotation)].every((type) =>
      type.kind === "TypeVariable"
        ? parameters.has(type.name.text)
        : type.kind === "NamedType"
        ? type.qualifier !== undefined || type.name.text !== item.name.text
        : type.kind !== "AppliedType" || type.qualifier !== undefined || type.constructor.text !== item.name.text
    );
    if (wellFormed) aliases.set(item.name.text, item);
  }
  return aliases;
}

/** "Write the alias out" on the innermost use that holds `[start, end]`. */
function writeOutAt(
  file: Source.File,
  module: Parsed.Module,
  aliases: ReadonlyMap<string, Parsed.TypeAliasItem>,
  start: number,
  end: number,
): readonly Refactoring[] {
  let found: { readonly use: Use; readonly alias: Parsed.TypeAliasItem } | undefined;
  for (const item of module.items) {
    for (const alias of aliases.values()) {
      for (const use of usesIn(item, alias)) {
        if (holds(use.span, start, end) && (found === undefined || found.use.span.start.offset < use.span.start.offset)) {
          found = { use, alias };
        }
      }
    }
  }
  if (found === undefined) return [];
  return [writeOut(file, module, bodyOf(file, module, found.alias), found.use, WRITE_OUT_TITLE)];
}

/**
 * "Write the alias out everywhere" on the alias's name in its declaration:
 * every use, one at a time, item by item, so that a use inside another's
 * argument is written out where the outer one's body puts it. One edit per
 * item, and one that takes the declaration away unless it is exported.
 */
function writeOutEverywhereAt(
  file: Source.File,
  module: Parsed.Module,
  aliases: ReadonlyMap<string, Parsed.TypeAliasItem>,
  start: number,
  end: number,
): readonly Refactoring[] {
  const alias = [...aliases.values()].find(({ name }) => holds(name.span, start, end));
  if (alias === undefined) return [];
  const items = module.items.filter((item) => usesIn(item, alias).length > 0);
  if (items.length === 0) return [];
  const title = WRITE_OUT_EVERYWHERE_TITLE;
  const body = bodyOf(file, module, alias);
  if (body.comment) return [{ title, disabled: BODY_COMMENT }];
  const edits: TextEdit[] = [];
  if (!alias.exported) {
    const removal = declarationRemoval(file, module, alias);
    if (removal === undefined) {
      return [{ title, disabled: "A comment on the alias would be lost with its declaration. Move the comment out first." }];
    }
    edits.push(removal);
  }
  for (const item of items) {
    // Read from its block's or group's head, where it parses as in the file,
    // and only its own uses written out.
    const from = headOf(item);
    const was = file.text.slice(from, item.span.end.offset);
    const itemStart = item.span.start.offset - from;
    let text = was;
    for (let step = 0;; step += 1) {
      // A use nested in another's argument is copied once for each place the
      // body writes its parameter, so the steps stay few, but not one per use.
      if (step === 256) return [];
      // Each step is checked to read as before, so the item stays where it was.
      const [parsed] = parsedText(file, text);
      const now = parsed?.items.find(({ span }) => span.start.offset === itemStart);
      const [use] = now === undefined ? [] : usesIn(now, alias);
      if (use === undefined) break;
      const done = writeOut(new Source.File(file.id, file.path, text), parsed!, body, use, title);
      if (done.edit === undefined) return [done];
      text = text.slice(0, done.edit.start) + done.edit.replacement + text.slice(done.edit.end);
    }
    edits.push(changed(was, text, from));
  }
  const [edit, ...elsewhere] = edits;
  return [{ title, edit: edit!, elsewhere }];
}

/**
 * "Introduce a type alias" for the type the caret is in, whole, or for the one
 * type a selection covers; and, where the module writes it more than once,
 * the same for every place it is written.
 */
function introduceAt(file: Source.File, module: Parsed.Module, start: number, end: number): readonly Refactoring[] {
  const target = typeAt(file, module, start, end);
  if (target === undefined) return [];
  const { type } = target;
  if (type.kind === "TypeVariable" || type.kind === "Hole" || !movable(target)) return [];
  const refused = refusal([...typesIn(type)]);
  if (refused !== undefined) return [{ title: INTRODUCE_TITLE, disabled: refused }];
  const places = module.items.flatMap((item) =>
    writtenTypes(item).flatMap((written) => [...typesIn(written)])
      .filter((each) => sameReading(each, type) && movable({ item, type: each }))
      .map((each) => ({ item, type: each }))
  );
  const one = introduced(file, module, type, [target], INTRODUCE_TITLE);
  return places.length < 2 ? [one] : [one, introduced(file, module, type, places, introduceEverywhereTitle(places.length))];
}

/**
 * Whether a type written in an item can be written above the item instead: a
 * name an item's implied type takes means that type inside the item and
 * nothing above it, and a type the parser put in place of one missing has no
 * text to move.
 */
function movable({ item, type }: Place): boolean {
  const implied = impliedNames(item);
  const named = (each: Parsed.TypeAnnotation): string | undefined =>
    each.kind === "NamedType" && each.qualifier === undefined
      ? each.name.text
      : each.kind === "AppliedType" && each.qualifier === undefined
      ? each.constructor.text
      : undefined;
  return [...typesIn(type)].every((each) => !(each.kind === "NamedType" && each.synthesized === true) && !implied.has(named(each) ?? ""));
}

/** A type as written, in the item it is written in. */
interface Place {
  readonly item: Parsed.Item;
  readonly type: Parsed.TypeAnnotation;
}

/**
 * `type`, given a name above the first of `places`, and the name in each of
 * them in its place, or why it cannot be.
 */
function introduced(
  file: Source.File,
  module: Parsed.Module,
  type: Parsed.TypeAnnotation,
  places: readonly Place[],
  title: string,
): Refactoring {
  const inside = (span: Source.Span): boolean => {
    const { start, end } = solid(file, span);
    return module.comments.some((comment) => start <= comment.span.start.offset && comment.span.end.offset <= end);
  };
  if (inside(type.span)) {
    return { title, disabled: "A comment inside the type would move into the alias. Move the comment out first." };
  }
  if (places.some((place) => inside(place.type.span))) {
    return { title, disabled: "A comment inside the type in another of its places would be lost. Move the comment out first." };
  }
  const parameters = [
    ...new Set([...typesIn(type)].filter((each): each is Parsed.TypeVariable => each.kind === "TypeVariable").map(({ name }) => name.text)),
  ];
  const name = freshName(module);
  const applied = parameters.length === 0 ? "" : `(${parameters.join(", ")})`;
  const at = aboveComments(file, module, headOf(places[0]!.item));
  let replacement = `type ${name}${applied} = ${ungrouped(file, type)}\n\n`;
  const placeholders: Diagnostics.Placeholder[] = [{ start: "type ".length, end: "type ".length + name.length, stop: 1 }];
  const used: (readonly [number, number])[] = [];
  let from = at;
  for (const place of places) {
    const { start, end } = solid(file, place.type.span);
    replacement += file.text.slice(from, start);
    used.push([replacement.length, replacement.length + name.length + applied.length]);
    placeholders.push({ start: replacement.length, end: replacement.length + name.length, stop: 1 });
    replacement += name + applied;
    from = end;
  }
  const edit = { start: at, end: from, replacement };
  return readsIntroduced(file, edit, places.at(-1)!.item.span.end.offset, name, used)
    ? { title, edit, placeholders }
    : { title, disabled: PARSES_OTHERWISE };
}

/**
 * A type's text without the parentheses written around it, which its span
 * takes in: a tuple keeps its own.
 */
function ungrouped(file: Source.File, type: Parsed.TypeAnnotation): string {
  let text = textOf(file, type.span);
  const enclosed = (each: string): boolean => each.startsWith("(") && closing(each) === each.length - 1;
  while (enclosed(text) && (type.kind !== "Tuple" || enclosed(text.slice(1, -1).trim()))) text = text.slice(1, -1).trim();
  return text;
}

/** Where the parenthesis that opens a text closes. */
function closing(text: string): number {
  let depth = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === "(") depth += 1;
    if (text[at] === ")" && --depth === 0) return at;
  }
  return -1;
}

/** Why a type cannot be an alias's body, where it cannot (§5). */
function refusal(types: readonly Parsed.TypeAnnotation[]): string | undefined {
  if (types.some(({ kind }) => kind === "Hole")) {
    return "A `type` declaration writes its types in full, and this type has a `_` in it. Write the type in place of " +
      "`_` first, or introduce the alias for a part of it without one.";
  }
  if (types.some((each) => each.kind === "Function" && isFollowing(each.effect))) {
    return "An alias is a type fragment, not a signature, so a following arrow in it has nothing handed to it " +
      "(Declarations Preamble §5.1.1). Introduce the alias for a part of the type without one.";
  }
  const tail = types.find((each): each is Parsed.RecordType => each.kind === "Record" && each.tail !== undefined);
  if (tail !== undefined) {
    return `A \`type\` alias's row tail is fresh at each use, so it cannot be named, and this type names \`...${tail.tail!.text}\`. ` +
      "Introduce the alias for a part of the type without it.";
  }
  return undefined;
}

/**
 * The use written out as the alias's body, its arguments in place of the
 * parameters: as written, then with an argument that is a function or a tuple
 * in parentheses, then the whole in parentheses, the first that parses as the
 * alias expanded in the tree. `Handler(Int) -> Unit` is `(Int -> Unit) -> Unit`,
 * not `Int -> Unit -> Unit`.
 */
function writeOut(file: Source.File, module: Parsed.Module, body: Body, use: Use, title: string): Refactoring {
  if (body.comment) return { title, disabled: BODY_COMMENT };
  const { alias } = body;
  const written = use.kind === "AppliedType" ? use.arguments : [];
  const regions = argumentRegions(file, module, use);
  for (const [index, argument] of written.entries()) {
    if (body.parameters.filter((each) => each === index).length < 2) continue;
    if ([...typesIn(argument)].some(({ kind }) => kind === "Hole")) {
      return {
        title,
        disabled: `\`${alias.name.text}\` writes \`${alias.parameters[index]!.text}\` in more than one place, and the \`_\` ` +
          "given for it is one type in all of them; written out, each `_` would be a type of its own. Write the type " +
          "in place of `_` first.",
      };
    }
    const region = regions[index]!;
    if (module.comments.some(({ span }) => region.start.offset <= span.start.offset && span.end.offset <= region.end.offset)) {
      return {
        title,
        disabled: `A comment inside it would be copied to each place \`${alias.name.text}\` writes ` +
          `\`${alias.parameters[index]!.text}\`. Move the comment out first.`,
      };
    }
  }
  const spelled = (wrapped: boolean): string => {
    let text = body.pieces[0]!;
    body.parameters.forEach((index, at) => {
      const { kind } = written[index]!;
      const own = textOf(file, regions[index]!);
      text += (wrapped && (kind === "Function" || kind === "Tuple") ? `(${own})` : own) + body.pieces[at + 1]!;
    });
    return text;
  };
  const texts = [...new Set([spelled(false), spelled(true), `(${spelled(false)})`, `(${spelled(true)})`])];
  return rewrite(file, module, title, use, { texts, kept: regions }, (edit) =>
    keepsReadingAs(file, module, edit, (before, start) => {
      const old = useAt(before, use.span.start.offset - start, use.span.end.offset - start);
      return old === undefined ? undefined : replaced(before, old, expansion(alias, old));
    }));
}

/**
 * Each of a use's arguments with the comments around it: the text between the
 * parenthesis or comma before it and the comma or parenthesis after it.
 */
function argumentRegions(file: Source.File, module: Parsed.Module, use: Use): readonly Source.Span[] {
  if (use.kind !== "AppliedType") return [];
  const code = (at: number): number => {
    for (;;) {
      while (/\s/.test(file.text[at] ?? "")) at += 1;
      const comment = module.comments.find(({ span }) => span.start.offset === at);
      if (comment === undefined) return at;
      at = comment.span.end.offset;
    }
  };
  let after = code(use.constructor.span.end.offset) + 1;
  return use.arguments.map((argument) => {
    const delimiter = code(argument.span.end.offset);
    let start = after;
    while (/\s/.test(file.text[start]!)) start += 1;
    after = delimiter + 1;
    return file.span(start, delimiter);
  });
}

/** An alias's body as text, around each parameter it writes. */
interface Body {
  readonly alias: Parsed.TypeAliasItem;
  /** The text between the parameters the body writes: one more than `parameters`. */
  readonly pieces: readonly string[];
  /** Which parameter, by its index, the body writes between each two pieces. */
  readonly parameters: readonly number[];
  /** Whether a comment stands inside the body. */
  readonly comment: boolean;
}

function bodyOf(file: Source.File, module: Parsed.Module, alias: Parsed.TypeAliasItem): Body {
  const { start, end } = solid(file, alias.annotation.span);
  const variables = [...typesIn(alias.annotation)].filter((each): each is Parsed.TypeVariable => each.kind === "TypeVariable");
  // A variable's own span takes in parentheses written around it; its name's does not.
  const pieces: string[] = [];
  let at = start;
  for (const { name: { span } } of variables) {
    pieces.push(file.text.slice(at, span.start.offset));
    at = span.end.offset;
  }
  pieces.push(file.text.slice(at, end));
  return {
    alias,
    pieces,
    parameters: variables.map(({ name }) => alias.parameters.findIndex(({ text }) => text === name.text)),
    comment: module.comments.some(({ span }) => start <= span.start.offset && span.end.offset <= end),
  };
}

/** The alias's body, its parameters taken by the use's arguments: the type the use is. */
function expansion(alias: Parsed.TypeAliasItem, use: Use): Parsed.TypeAnnotation {
  const written = new Map(alias.parameters.map(({ text }, index) => [text, (use as Parsed.AppliedType).arguments[index]]));
  const substitute = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(substitute);
    if (node === null || typeof node !== "object") return node;
    const record = node as Record<string, unknown>;
    // A well-formed alias writes no variable but its parameters, and a bare use
    // is of an alias that has none.
    if (record.kind === "TypeVariable") return written.get((record as unknown as Parsed.TypeVariable).name.text);
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, substitute(value)]));
  };
  return substitute(alias.annotation) as Parsed.TypeAnnotation;
}

/**
 * Whether the text from `edit`'s start to `to`, the end of the last item it
 * changes, once edited, reads as before when the alias it declares first is
 * expanded at its uses, at `used` in the replacement, and taken away, the
 * documentation comments still on what they were on. Exported for its tests,
 * which hand it edits the rewrite never writes.
 */
export function readsIntroduced(
  file: Source.File,
  edit: TextEdit,
  to: number,
  name: string,
  used: readonly (readonly [number, number])[],
): boolean {
  const was = file.text.slice(edit.start, to);
  const now = edit.replacement + file.text.slice(edit.end, to);
  // Items with no module header between them parse as one module.
  const [before] = parsedText(file, was);
  const [after] = parsedText(file, now);
  if (before === undefined || after === undefined) return false;
  const [alias, ...items] = after.items;
  if (alias?.kind !== "TypeAlias" || alias.name.text !== name) return false;
  const expanded = new Map<object, object>();
  for (const [start, end] of used) {
    const use = useAt(items, start, end);
    if (use === undefined || (use.kind === "NamedType" ? use.name : use.constructor).text !== name) return false;
    expanded.set(use, expansion(alias, use));
  }
  return after.docs.every(({ target }) => target !== alias.span.start.offset) &&
    sameReading(
      { items: before.items, comments: before.comments, docs: before.docs.map(({ content }) => content) },
      { items: replacedAll(items, expanded), comments: after.comments, docs: after.docs.map(({ content }) => content) },
    );
}

/** A parsed value with each node a key of `by` in its place given there. */
function replacedAll(value: unknown, by: ReadonlyMap<object, object>): unknown {
  if (value === null || typeof value !== "object") return value;
  const instead = by.get(value);
  if (instead !== undefined) return instead;
  if (Array.isArray(value)) return value.map((each) => replacedAll(each, by));
  return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, replacedAll(each, by)]));
}

/**
 * The edit that turns `was` into `now`, both starting at `from`, written over
 * only what differs. Exported for its tests.
 */
export function changed(was: string, now: string, from: number): TextEdit {
  let head = 0;
  while (head < was.length && head < now.length && was[head] === now[head]) head += 1;
  let tail = 0;
  while (tail < was.length - head && tail < now.length - head && was[was.length - 1 - tail] === now[now.length - 1 - tail]) {
    tail += 1;
  }
  return { start: from + head, end: from + was.length - tail, replacement: now.slice(head, now.length - tail) };
}

/**
 * The lines an alias's declaration stands on, and a blank line after them
 * where one stands above too, or none where a comment is on those lines or
 * on the lines just above them, which taking the lines away would lose or
 * leave on the declaration below.
 */
function declarationRemoval(file: Source.File, module: Parsed.Module, alias: Parsed.TypeAliasItem): TextEdit | undefined {
  const { text } = file;
  const start = text.lastIndexOf("\n", alias.span.start.offset - 1) + 1;
  const lineBreak = text.indexOf("\n", solid(file, alias.span).end);
  let end = lineBreak < 0 ? text.length : lineBreak + 1;
  const attached = module.comments.some(({ span }) =>
    (start <= span.start.offset && span.start.offset < end) ||
    (span.end.offset <= start && /^[ \t]*\r?\n$/.test(text.slice(span.end.offset, start)))
  );
  if (attached) return undefined;
  const blankBelow = /^[ \t]*\r?\n/.exec(text.slice(end));
  if (blankBelow !== null && (start === 0 || /\n[ \t]*\r?\n$/.test(text.slice(0, start)))) end += blankBelow[0].length;
  return { start, end, replacement: "" };
}

/** Where an item's text starts when it is parsed again: its `fun` block's or honor group's head where it is a member of one. */
function headOf(item: Parsed.Item): number {
  return item.kind === "Fun" && item.block !== undefined
    ? item.block.span.start.offset
    : item.kind === "Honor" && item.group !== undefined
    ? item.group.span.start.offset
    : item.span.start.offset;
}

/**
 * The start of the lines of comments just above `at`, with no blank line
 * between, or `at`: an alias written there would come between the item and a
 * comment about it, and a documentation comment would document the alias.
 */
function aboveComments(file: Source.File, module: Parsed.Module, at: number): number {
  for (;;) {
    const above = module.comments.find(({ span }) =>
      span.end.offset <= at && /^[ \t]*\r?\n$/.test(file.text.slice(span.end.offset, at)) &&
      /^[ \t]*$/.test(file.text.slice(file.text.lastIndexOf("\n", span.start.offset - 1) + 1, span.start.offset))
    );
    if (above === undefined) return at;
    at = file.text.lastIndexOf("\n", above.span.start.offset - 1) + 1;
  }
}

/** `NewType`, or the first of `NewType2`, `NewType3`, … the module does not already write. */
function freshName(module: Parsed.Module): string {
  const written = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.text === "string" && "startClass" in record) written.add(record.text);
    for (const key of Object.keys(record)) if (key !== "span") walk(record[key]);
  };
  walk(module.items);
  for (let count = 1;; count += 1) {
    const name = count === 1 ? "NewType" : `NewType${count}`;
    if (!written.has(name)) return name;
  }
}

/**
 * The type the caret is in, the whole of what is written there, or the one
 * type a selection covers, its own parentheses included or not; with the item
 * it is written in. Not an `honor`'s subject: an alias carries no instances of
 * its own (Declarations Preamble §4).
 */
function typeAt(
  file: Source.File,
  module: Parsed.Module,
  start: number,
  end: number,
): { readonly item: Parsed.Item; readonly type: Parsed.TypeAnnotation } | undefined {
  const written = module.items.flatMap((item) => writtenTypes(item).map((type) => ({ item, type })));
  if (start === end) return written.find(({ type }) => holds(type.span, start, end));
  let { start: from, end: to } = solid(file, file.span(start, end));
  while (from < to && /\s/.test(file.text[from]!)) from += 1;
  const selected = file.text.slice(from, to);
  return written.flatMap(({ item, type }) => [...typesIn(type)].map((each) => ({ item, type: each })))
    .find(({ type }) =>
      (type.span.start.offset === from && solid(file, type.span).end === to) ||
      (holds(type.span, from, to) && selected === ungrouped(file, type))
    );
}

/** Every whole type written in an item: each annotation's, outermost, but not an `honor`'s subject. */
function writtenTypes(item: Parsed.Item): readonly Parsed.TypeAnnotation[] {
  const types: Parsed.TypeAnnotation[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "span") continue;
      const value = record[key];
      // A pattern declaration's head writes its result type as `result`.
      const typed = key === "annotation" || key === "returnAnnotation" || (key === "result" && "components" in record);
      if (typed && value !== null && typeof value === "object" && "kind" in value) types.push(value as Parsed.TypeAnnotation);
      else walk(value);
    }
  };
  walk(item);
  return types;
}

/** A type and every type written inside it, in the order they are written. */
function* typesIn(type: Parsed.TypeAnnotation): Generator<Parsed.TypeAnnotation> {
  yield type;
  switch (type.kind) {
    case "AppliedType":
      for (const argument of type.arguments) yield* typesIn(argument);
      return;
    case "Tuple":
      for (const element of type.elements) yield* typesIn(element);
      return;
    case "Record":
      for (const field of type.fields) yield* typesIn(field.annotation);
      return;
    case "Function":
      for (const parameter of type.parameters) yield* typesIn(parameter);
      yield* typesIn(type.result);
      return;
  }
}

/** The uses of `alias` written in `item`, each with as many arguments as it has parameters (§5.1). */
function usesIn(item: Parsed.Item, alias: Parsed.TypeAliasItem): readonly Use[] {
  const name = alias.name.text;
  if (impliedNames(item).has(name)) return [];
  const arity = alias.parameters.length;
  return writtenTypes(item).flatMap((type) => [...typesIn(type)]).filter((type): type is Use =>
    type.kind === "NamedType"
      ? type.qualifier === undefined && type.name.text === name && arity === 0
      : type.kind === "AppliedType" && type.qualifier === undefined && type.constructor.text === name &&
        type.arguments.length === arity
  );
}

/**
 * The implied types a constraint declares, whose names mean them in its
 * members' signatures. An honor's are not: an implied type cannot be written
 * in a type (Collections Part 2 §7.3), so a name written in an honor's body
 * means what it means in the module.
 */
function impliedNames(item: Parsed.Item): ReadonlySet<string> {
  return item.kind === "ConstraintDeclaration" ? new Set(item.impliedTypes.map(({ name }) => name.text)) : new Set();
}

/** The use spanning exactly `[start, end)` in a parsed value. */
function useAt(value: unknown, start: number, end: number): Use | undefined {
  if (Array.isArray(value)) {
    for (const each of value) {
      const found = useAt(each, start, end);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const node = value as Record<string, unknown>;
  const span = node.span as Source.Span | undefined;
  if ((node.kind === "NamedType" || node.kind === "AppliedType") && span?.start.offset === start && span.end.offset === end) {
    return node as unknown as Use;
  }
  for (const key of Object.keys(node)) {
    if (key === "span") continue;
    const found = useAt(node[key], start, end);
    if (found !== undefined) return found;
  }
  return undefined;
}

function holds(span: Source.Span, start: number, end: number): boolean {
  return span.start.offset <= start && end <= span.end.offset;
}
