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
 *   the use's arguments in place of its parameters. A use of an alias another
 *   module exports is written out too, each name in the body spelled as this
 *   module reaches the type it names, and an alias that module keeps to itself
 *   written out in its place; refused, naming the import, where this module
 *   cannot reach a type the body names.
 * - **Write the alias out everywhere**, on the alias's name where it is
 *   declared: every use in its module, and the declaration with them unless
 *   something else names it: another module, where it is exported, or an
 *   honor's subject, which is not written out.
 * - **Introduce a type alias**, on a type: `type NewType = ` the type, above
 *   the item it is written in, and the alias in its place. The type's
 *   variables are the alias's parameters, in the order the type first writes
 *   them, so it uses every one (§5.3). The name is one stand-in written in both
 *   places, which the dev types once.
 * - **Introduce a type alias for its N places**, beside it where the module
 *   writes the type more than once: the alias in every place that reads as
 *   the type, variables by name, declared above the first.
 *
 * Names are read from the text: an alias's name means the alias throughout
 * its module (§7.2), save where a constraint's implied type of that name
 * stands; another module's names are spelled through this module's imports,
 * and the prelude's as the resolver spells them here. No type is asked for.
 * Each rewrite is checked by parsing what it leaves: the text written must
 * read as the alias expanded in the tree.
 */

import { isPrimitiveName } from "../passes/resolver/resolver.js";
import { isFollowing } from "../support/arrows.js";
import type * as Diagnostics from "../support/diagnostics.js";
import * as Source from "../support/source.js";
import type * as Parsed from "../syntax/parsed/index.js";
import type * as Resolved from "../syntax/resolved/index.js";
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

/**
 * What writing out another module's alias needs: how this module reaches the
 * program's other modules, and those modules as written and resolved.
 */
export interface Abroad {
  /** This module as the resolver read it: its imports, and how it spells each record and union. */
  readonly resolved: Resolved.Module;
  /** A module of the program by its full name (Packages §2.3). */
  readonly moduleNamed: (fullName: string) => Elsewhere | undefined;
  /** The module's name as an `import` in this module writes it. */
  readonly importName: (fullName: string) => string;
}

/** Another module of the program, as written and as resolved. */
export interface Elsewhere {
  /** Its full name. */
  readonly name: string;
  readonly source: Source.File;
  readonly parsed: Parsed.Module;
  readonly resolved: Resolved.Module;
  /** Everything it reports: the checker's, after the resolver's and the parser's. */
  readonly typed: { readonly diagnostics: readonly Diagnostics.Diagnostic[] };
}

/** The alias rewrites offered for `[start, end]` of one parsed module. */
export function typeAliasRefactorings(
  file: Source.File,
  module: Parsed.Module,
  start: number,
  end: number,
  abroad?: Abroad,
): readonly Refactoring[] {
  const aliases = aliasesOf(module);
  return [
    ...writeOutAt(file, module, aliases, start, end, abroad),
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

/**
 * "Write the alias out" on the innermost use that holds `[start, end]`: of an
 * alias of this module, or of one another module exports, reached through
 * this module's import of it.
 */
function writeOutAt(
  file: Source.File,
  module: Parsed.Module,
  aliases: ReadonlyMap<string, Parsed.TypeAliasItem>,
  start: number,
  end: number,
  abroad: Abroad | undefined,
): readonly Refactoring[] {
  let found: { readonly use: Use; readonly body: () => Body | string | undefined } | undefined;
  const consider = (use: Use, body: () => Body | string | undefined): void => {
    if (holds(use.span, start, end) && (found === undefined || found.use.span.start.offset < use.span.start.offset)) {
      found = { use, body };
    }
  };
  const here = abroad === undefined ? undefined : reachOf(module, abroad.resolved);
  for (const item of module.items) {
    for (const alias of aliases.values()) {
      for (const use of usesIn(item, alias)) consider(use, () => bodyOf(file, module, alias));
    }
    for (const { use, home, alias } of here === undefined ? [] : usesAbroad(item, here, abroad!)) {
      consider(use, () => bodyAbroad(file, abroad!, here!, home, alias, use));
    }
  }
  if (found === undefined) return [];
  const body = found.body();
  if (body === undefined) return [];
  if (typeof body === "string") return [{ title: WRITE_OUT_TITLE, disabled: body }];
  return [writeOut(file, module, body, found.use, WRITE_OUT_TITLE)];
}

/** What a module's type names reach: its own types, its imports, and the implied types of its constraints. */
interface Reach {
  /** Every type the module declares, by name, and whether it exports it. */
  readonly owned: ReadonlyMap<string, boolean>;
  /** The names a constraint of the module gives an implied type, which a bare name never reaches past. */
  readonly implied: ReadonlySet<string>;
  /** Each module alias an `import` binds, with the full name of the module, in the order written. */
  readonly imports: ReadonlyMap<string, string>;
}

function reachOf(parsed: Parsed.Module, resolved: Resolved.Module): Reach {
  const owned = new Map<string, boolean>();
  const implied = new Set<string>();
  for (const item of parsed.items) {
    if (item.kind === "TypeAlias" || item.kind === "RecordDeclaration" || item.kind === "Union") owned.set(item.name.text, item.exported);
    if (item.kind === "ExternBlock") {
      for (const declaration of item.declarations) {
        if (declaration.kind === "ExternType") owned.set(declaration.localName.text, declaration.exported);
      }
    }
    if (item.kind === "ConstraintDeclaration") for (const { name } of item.impliedTypes) implied.add(name.text);
  }
  const imports = new Map<string, string>();
  for (const item of resolved.items) {
    // The prelude's companions are not imports (Modules §5.1 rule 2).
    if (item.kind === "Import" && !item.synthesized && item.form.kind === "Namespace") imports.set(item.form.alias, item.moduleName);
  }
  return { owned, implied, imports };
}

/**
 * The uses in an item of an alias another module exports: `Geo.Segment`
 * through this module's import of it, or `Segment` bare through Modules §5.1
 * rule 2's companion fallback, where this module declares no `Segment` itself.
 */
function usesAbroad(
  item: Parsed.Item,
  here: Reach,
  abroad: Abroad,
): readonly { readonly use: Use; readonly home: Elsewhere; readonly alias: Parsed.TypeAliasItem }[] {
  return writtenTypes(item).flatMap((type) => [...typesIn(type)]).flatMap((type) => {
    if (type.kind !== "NamedType" && type.kind !== "AppliedType") return [];
    const name = (type.kind === "NamedType" ? type.name : type.constructor).text;
    const qualifier = type.qualifier?.text;
    if (qualifier === undefined && (here.owned.has(name) || here.implied.has(name))) return [];
    const fullName = here.imports.get(qualifier ?? name);
    const home = fullName === undefined ? undefined : abroad.moduleNamed(fullName);
    const alias = home === undefined ? undefined : aliasesOf(home.parsed).get(name);
    const arity = type.kind === "AppliedType" ? type.arguments.length : 0;
    return alias?.exported === true && alias.parameters.length === arity ? [{ use: type, home: home!, alias }] : [];
  });
}

/**
 * Another module's alias, its body spelled the way this module reaches each
 * type it names, or why it cannot be: a type this module cannot write, or a
 * comment in the body. An alias the home module keeps to itself is written
 * out in its place, since it is the type it stands for (Declarations Preamble
 * §4) and this module cannot name it.
 */
function bodyAbroad(
  file: Source.File,
  abroad: Abroad,
  here: Reach,
  home: Elsewhere,
  alias: Parsed.TypeAliasItem,
  use: Use,
): Body | string | undefined {
  const name = use.kind === "NamedType" ? use.name : use.constructor;
  const spelling = textOf(file, file.span((use.qualifier ?? name).span.start.offset, name.span.end.offset));
  const parameters = new Map(alias.parameters.map((name, index): [string, Spelled] => [name.text, {
    segments: [{ parameter: index }],
    tree: { kind: "TypeVariable", name, span: name.span },
  }]));
  const split = ({ segments }: Spelled): { readonly pieces: readonly string[]; readonly written: readonly number[] } => {
    const pieces = [""];
    const written: number[] = [];
    for (const segment of segments) {
      if (typeof segment === "string") pieces[pieces.length - 1] += segment;
      else {
        written.push(segment.parameter);
        pieces.push("");
      }
    }
    return { pieces, written };
  };
  try {
    const [plain, grouped] = [false, true].map((grouping) => {
      const speller = new Speller(abroad, here, spelling, grouping);
      return speller.body(speller.reachOf(home), alias, parameters, 0);
    });
    const { pieces, written } = split(plain!);
    return { alias: { ...alias, annotation: plain!.tree }, pieces, parameters: written, comment: false, grouped: split(grouped!).pieces };
  } catch (error) {
    if (error instanceof Refused) return error.reason;
    throw error;
  }
}

/** A type spelled for another module: its text, around the parameters of the alias written out, and its tree. */
interface Spelled {
  readonly segments: readonly (string | { readonly parameter: number })[];
  readonly tree: Parsed.TypeAnnotation;
}

/** Why a type cannot be spelled for the module, or `undefined` where nothing is offered. */
class Refused {
  constructor(readonly reason: string | undefined) {}
}

/** A module whose aliases are written out in another, with how it reaches its names. */
interface Home extends Elsewhere {
  readonly reach: Reach;
}

/** Spells types written in other modules the way one module, `here`, reaches them. */
class Speller {
  readonly #abroad: Abroad;
  readonly #here: Reach;
  /** The use being written out, as this module writes it, for the reasons given. */
  readonly #use: string;
  readonly #homes = new Map<string, Home>();
  /** Whether a type written out inside another, or given for a parameter there, is put in parentheses. */
  readonly #grouping: boolean;

  constructor(abroad: Abroad, here: Reach, use: string, grouping: boolean) {
    this.#abroad = abroad;
    this.#here = here;
    this.#use = use;
    this.#grouping = grouping;
  }

  reachOf(module: Elsewhere): Home {
    let home = this.#homes.get(module.name);
    if (home === undefined) {
      home = { ...module, reach: reachOf(module.parsed, module.resolved) };
      this.#homes.set(module.name, home);
    }
    return home;
  }

  /** An alias's body, spelled here, its parameters each taken by what `parameters` gives. */
  body(home: Home, alias: Parsed.TypeAliasItem, parameters: ReadonlyMap<string, Spelled>, depth: number): Spelled {
    // A cycle of aliases does not compile, and is not followed round.
    if (depth === 32) throw new Refused(undefined);
    const { start, end } = offsets(alias.annotation.span);
    if (home.parsed.comments.some(({ span }) => start <= span.start.offset && span.end.offset <= end)) {
      throw new Refused(BODY_COMMENT);
    }
    const spelled = this.#spelled(home, alias.annotation, parameters, depth);
    // A body its own module reports for what the refusals above do not name
    // would carry the error here: `Range(Int)`, where `Range` takes none.
    const { diagnostics } = home.typed;
    if (diagnostics.some(({ primary }) => start <= primary.start.offset && primary.end.offset <= end)) throw new Refused(undefined);
    return spelled;
  }

  /** A type written in `home`, spelled here: its text with each name and parameter replaced, and its tree. */
  #spelled(home: Home, type: Parsed.TypeAnnotation, parameters: ReadonlyMap<string, Spelled>, depth: number): Spelled {
    const replacements: { readonly start: number; readonly end: number; readonly segments: Spelled["segments"] }[] = [];
    // The type itself is what its place holds, whatever it is written as.
    const placed = (each: Parsed.TypeAnnotation, spelled: Spelled): Spelled["segments"] =>
      this.#grouping && each !== type && (spelled.tree.kind === "Function" || spelled.tree.kind === "Tuple")
        ? ["(", ...spelled.segments, ")"]
        : spelled.segments;
    const rebuilt = (each: Parsed.TypeAnnotation): Parsed.TypeAnnotation => {
      switch (each.kind) {
        case "TypeVariable": {
          // A well-formed alias writes no variable but its parameters.
          const given = parameters.get(each.name.text)!;
          replacements.push({ start: each.name.span.start.offset, end: each.name.span.end.offset, segments: placed(each, given) });
          return given.tree;
        }
        case "NamedType":
        case "AppliedType": {
          const name = each.kind === "NamedType" ? each.name : each.constructor;
          const start = (each.qualifier ?? name).span.start.offset;
          const named = this.#named(home, each, parameters, depth);
          if ("tree" in named) {
            const end = each.kind === "NamedType" ? name.span.end.offset : appliedEnd(home.source, each);
            replacements.push({ start, end, segments: placed(each, named) });
            return named.tree;
          }
          replacements.push({ start, end: name.span.end.offset, segments: [named.spelling] });
          const qualifier = named.spelling.includes(".") ? named.spelling.slice(0, named.spelling.indexOf(".")) : undefined;
          const own = named.spelling.slice(named.spelling.indexOf(".") + 1);
          const { qualifier: _, ...rest } = each;
          const written = (text: string): Parsed.Name => ({ ...name, text });
          return {
            ...rest,
            ...(qualifier === undefined ? {} : { qualifier: written(qualifier) }),
            ...(each.kind === "NamedType"
              ? { name: written(own) }
              : { constructor: written(own), arguments: each.arguments.map(rebuilt) }),
          } as Parsed.TypeAnnotation;
        }
        case "Tuple":
          return { ...each, elements: each.elements.map(rebuilt) };
        case "Record":
          return { ...each, fields: each.fields.map((field) => ({ ...field, annotation: rebuilt(field.annotation) })) };
        case "Function":
          return { ...each, parameters: each.parameters.map(rebuilt), result: rebuilt(each.result) };
        default:
          return each;
      }
    };
    const tree = rebuilt(type);
    const { start, end } = offsets(type.span);
    const segments: (string | { readonly parameter: number })[] = [];
    let at = start;
    for (const replacement of replacements) {
      segments.push(home.source.text.slice(at, replacement.start), ...replacement.segments);
      at = replacement.end;
    }
    segments.push(home.source.text.slice(at, end));
    return { segments, tree };
  }

  /**
   * A name written in `home`, spelled here; or, for an alias `home` keeps to
   * itself, written out.
   */
  #named(
    home: Home,
    type: Parsed.NamedType | Parsed.AppliedType,
    parameters: ReadonlyMap<string, Spelled>,
    depth: number,
  ): { readonly spelling: string } | Spelled {
    const name = (type.kind === "NamedType" ? type.name : type.constructor).text;
    // The module that declares it, read as `home` reads the name: through its
    // import, its own, or through the companion fallback; or none, for the
    // prelude's and the compiler's own types.
    const qualifier = type.qualifier?.text;
    const companion = home.reach.imports.get(name);
    const declaring = qualifier !== undefined
      ? home.reach.imports.get(qualifier)
      : home.reach.owned.has(name)
      ? home.name
      : !home.reach.implied.has(name) && companion !== undefined && this.#exports(companion, name)
      ? companion
      : undefined;
    const kept = declaring === home.name && home.reach.owned.get(name) === false;
    if (kept && home.parsed.items.some((item) => item.kind === "TypeAlias" && item.name.text === name)) {
      const alias = aliasesOf(home.parsed).get(name);
      const given = type.kind === "AppliedType" ? type.arguments : [];
      if (alias === undefined || alias.parameters.length !== given.length) throw new Refused(undefined);
      const arguments_ = new Map(
        alias.parameters.map(({ text }, index) => [text, this.#spelled(home, given[index]!, parameters, depth)] as const),
      );
      return this.body(home, alias, arguments_, depth + 1);
    }
    if (declaring !== undefined) return { spelling: this.#through(declaring, name) };
    // The prelude's or the compiler's own, which `home` declares and imports
    // nothing of the name of.
    const spellings = this.#abroad.resolved.nominalSpellings;
    const taken = new Refused(`\`${this.#use}\` names the prelude's \`${name}\`, and a type this module reaches takes that name here.`);
    const union = home.resolved.preludeUnions.get(name);
    const record = home.resolved.preludeRecords.get(name);
    if (union !== undefined || record !== undefined) {
      // Bare, or through the prelude's module where a declaration here takes the name.
      const spelling = union !== undefined ? spellings.unions.get(union) : spellings.records.get(record!);
      if (spelling === undefined) throw taken;
      return { spelling };
    }
    if (isPrimitiveName(name) || name === "Nullable" || name === "JsValue") {
      // A compiler-owned type's name is its spelling until a declaration
      // takes it: `record Float = {…}` makes a bare `Float` the record. The
      // resolver reads a bare `JsValue` after the implied types' names, which
      // take it too.
      const implied = name === "JsValue" && this.#here.implied.has(name);
      if (!spellings.claimed.has(name) && !implied) return { spelling: name };
      throw new Refused(`\`${this.#use}\` names the compiler's \`${name}\`, and a type this module reaches takes that name here.`);
    }
    if (!home.resolved.externTypes.some(({ localName }) => localName === name)) throw new Refused(undefined);
    // An extern type of the prelude's, reached bare where nothing here takes its name.
    const companionHere = this.#here.imports.get(name);
    if (this.#here.owned.has(name) || this.#here.implied.has(name) || (companionHere !== undefined && this.#exports(companionHere, name))) {
      throw taken;
    }
    return { spelling: name };
  }

  /** Whether a module of the program exports a type of this name. */
  #exports(fullName: string, name: string): boolean {
    const module = this.#abroad.moduleNamed(fullName);
    return module !== undefined && this.reachOf(module).reach.owned.get(name) === true;
  }

  /**
   * A type `declaring` exports, as this module writes it: bare through the
   * companion fallback, or through this module's first import of it; or why
   * it cannot.
   */
  #through(declaring: string, name: string): string {
    // A module the program does not have, which `home` reports.
    if (this.#abroad.moduleNamed(declaring) === undefined) throw new Refused(undefined);
    const display = this.#abroad.importName(declaring);
    if (!this.#exports(declaring, name)) {
      throw new Refused(`\`${this.#use}\` names \`${name}\`, which \`${display}\` does not export, so this module cannot write it.`);
    }
    const here = this.#here;
    if (!here.owned.has(name) && !here.implied.has(name) && here.imports.get(name) === declaring) return name;
    for (const [alias, fullName] of here.imports) if (fullName === declaring) return `${alias}.${name}`;
    throw new Refused(
      `\`${this.#use}\` names \`${name}\`, declared in \`${display}\`, which this module does not import. ` +
        `Write \`import ${display}\` first.`,
    );
  }
}

/** A type's span as offsets: it starts and ends at a character of the type. */
function offsets(span: Source.Span): { readonly start: number; readonly end: number } {
  return { start: span.start.offset, end: span.end.offset };
}

/** Where an applied type's own text ends: at the parenthesis that closes its arguments. */
function appliedEnd(file: Source.File, type: Parsed.AppliedType): number {
  const open = file.text.indexOf("(", type.constructor.span.end.offset);
  return open + closing(file.text.slice(open)) + 1;
}

/**
 * "Write the alias out everywhere" on the alias's name in its declaration:
 * every use, one at a time, item by item, so that a use inside another's
 * argument is written out where the outer one's body puts it. One edit per
 * item, and one that takes the declaration away unless it is exported or an
 * honor names it.
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
  // An honor's subject may name the alias (it is the type it stands for), and
  // is not written out: an alias carries no instances of its own (§4).
  const subject = module.items.some((item) => item.kind === "Honor" && bareName(item.subject) === alias.name.text);
  if (!alias.exported && !subject) {
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
  return [...typesIn(type)].every((each) => !(each.kind === "NamedType" && each.synthesized === true) && !implied.has(bareName(each) ?? ""));
}

/** The name a type writes bare, unqualified, where it is a name or one applied. */
function bareName(type: Parsed.TypeAnnotation): string | undefined {
  return type.kind === "NamedType" && type.qualifier === undefined
    ? type.name.text
    : type.kind === "AppliedType" && type.qualifier === undefined
    ? type.constructor.text
    : undefined;
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
    const { start, end } = offsets(span);
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
  const at = aboveComments(file, module, lineHead(file, module, headOf(places[0]!.item)));
  const newline = file.text.slice(0, at).endsWith("\r\n") ? "\r\n" : "\n";
  let replacement = `type ${name}${applied} = ${ungrouped(file, type)}${newline}${newline}`;
  const placeholders: Diagnostics.Placeholder[] = [{ start: "type ".length, end: "type ".length + name.length, stop: 1 }];
  const used: (readonly [number, number])[] = [];
  let from = at;
  for (const place of places) {
    const { start, end } = offsets(place.type.span);
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
  // In a constraint's members a name its implied type takes means that type
  // (reading 10), so a body that writes the name would mean another there.
  const item = module.items.find(({ span }) => holds(span, use.span.start.offset, use.span.end.offset));
  const implied = item === undefined ? new Set<string>() : impliedNames(item);
  const taken = [...typesIn(alias.annotation)].map(bareName).find((name) => name !== undefined && implied.has(name));
  if (taken !== undefined) {
    return {
      title,
      disabled: `Inside \`${(item as Parsed.ConstraintItem).name.text}\`'s members \`${taken}\` is its implied type, so the ` +
        `alias's body, written out here, would name that instead of the \`${taken}\` it names now.`,
    };
  }
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
  const spelled = (pieces: readonly string[], wrapped: boolean): string => {
    let text = pieces[0]!;
    body.parameters.forEach((index, at) => {
      const { kind } = written[index]!;
      const own = textOf(file, regions[index]!);
      text += (wrapped && (kind === "Function" || kind === "Tuple") ? `(${own})` : own) + pieces[at + 1]!;
    });
    return text;
  };
  const alternatives = [body.pieces, ...(body.grouped === undefined ? [] : [body.grouped])];
  const bare = alternatives.flatMap((pieces) => [spelled(pieces, false), spelled(pieces, true)]);
  const texts = [...new Set([...bare, ...bare.map((text) => `(${text})`)])];
  return rewrite(file, module, title, use, { texts, kept: regions }, (edit) =>
    keepsReadingAs(file, module, edit, (before, start) => {
      const old = useAt(before, use.span.start.offset - start, use.span.end.offset - start);
      return old === undefined ? undefined : replaced(before, old, expansion(alias, old));
    }));
}

/**
 * Each of a use's arguments with the comments around it: the text between the
 * parenthesis or comma before it and the comma or parenthesis after it. A
 * constrained hole's constraints, `_ : Show`, follow its span.
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
  const delimiterAfter = (at: number): number => {
    for (let depth = 0;; at += 1) {
      at = code(at);
      const char = file.text[at];
      if (char === undefined || (depth === 0 && (char === "," || char === ")"))) return at;
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
    }
  };
  let after = code(use.constructor.span.end.offset) + 1;
  return use.arguments.map((argument) => {
    const delimiter = delimiterAfter(argument.span.end.offset);
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
  /**
   * The pieces with each alias written out inside the body, and each type
   * given for its parameters, in parentheses where it is a function or a
   * tuple: for an alias another module exports, whose body may write out
   * one its module keeps to itself.
   */
  readonly grouped?: readonly string[];
}

function bodyOf(file: Source.File, module: Parsed.Module, alias: Parsed.TypeAliasItem): Body {
  const { start, end } = offsets(alias.annotation.span);
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
 * The alias's declaration taken away: the lines it stands on, and a blank line
 * after them where one stands above too; or, where another item shares its
 * line, the declaration and the `;` between them. None where a comment would
 * go with it, or one just above it, on a line of its own, would be left on
 * what follows.
 */
function declarationRemoval(file: Source.File, module: Parsed.Module, alias: Parsed.TypeAliasItem): TextEdit | undefined {
  const { text } = file;
  const from = alias.span.start.offset;
  const to = solid(file, alias.span).end;
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const startsLine = /^[ \t]*$/.test(text.slice(lineStart, from));
  const separator = /^[ \t]*;?[ \t]*/.exec(text.slice(to))![0];
  const endsLine = /^(\r?\n|$)/.test(text.slice(to + separator.length));
  const commentIn = (start: number, end: number): boolean =>
    module.comments.some(({ span }) => start <= span.start.offset && span.start.offset < end);
  const commentAbove = module.comments.some(({ span }) =>
    span.end.offset <= lineStart && /^[ \t]*\r?\n$/.test(text.slice(span.end.offset, lineStart)) &&
    /^[ \t]*$/.test(text.slice(text.lastIndexOf("\n", span.start.offset - 1) + 1, span.start.offset))
  );
  let start: number;
  let end: number;
  if (!endsLine) {
    // `type P = …; let n = …`: what follows takes the declaration's place.
    [start, end] = [from, to + separator.length];
    // A comment just after it is the declaration's own.
    if ((startsLine && commentAbove) || commentIn(end, end + 1)) return undefined;
  } else if (!startsLine) {
    // `let n = …; type P = …`: the line ends where the item before it does.
    [start, end] = [from - /[ \t]*;?[ \t]*$/.exec(text.slice(lineStart, from))![0].length, to + separator.length];
  } else {
    const lineBreak = text.indexOf("\n", to);
    [start, end] = [lineStart, lineBreak < 0 ? text.length : lineBreak + 1];
    if (commentAbove) return undefined;
    const blankBelow = /^[ \t]*\r?\n/.exec(text.slice(end));
    if (blankBelow !== null && (start === 0 || /\n[ \t]*\r?\n$/.test(text.slice(0, start)))) end += blankBelow[0].length;
  }
  return commentIn(start, end) ? undefined : { start, end, replacement: "" };
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
 * The first item on the line the item at `at` starts on, where items share a
 * line: an alias declared there is written from the line's start.
 */
function lineHead(file: Source.File, module: Parsed.Module, at: number): number {
  const lineStart = file.text.lastIndexOf("\n", at - 1) + 1;
  return Math.min(at, ...module.items.map(headOf).filter((head) => lineStart <= head));
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
      (type.span.start.offset === from && type.span.end.offset === to) ||
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
