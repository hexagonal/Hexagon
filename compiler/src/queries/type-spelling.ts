/**
 * Compiler-owned source query: writing an inferred type back out as source.
 *
 * `Typed.displayScheme` already renders types, and this is deliberately not it.
 * That one renders for a *reader*: an unknown becomes `?`, a variable nothing
 * named becomes `t7`, and a type renders under the name its own module gave it
 * whatever this module calls it. Each of those is right in a hover and wrong in
 * an edit, because an edit's text has to be something the compiler will read
 * back as the same type. So this renders for a *writer*, and where it cannot, it
 * says why rather than inventing a spelling that will not resolve.
 *
 * The two must nonetheless agree on shape — `Vector(a)`, `(A, B) -> C`, `Unit`
 * for the empty tuple (Products §2.7, #159) — because a user who reads a type in
 * a hover and then asks for it to be written expects the same notation twice.
 *
 * The arrow trio is where the same principle makes them diverge, deliberately
 * (#364): both write `->` and `->!`, which mean what they say wherever they
 * stand, and where the display shows a variable colour — `->?`, or `->?¹` in a
 * multi-colour face — this refuses either way. It refuses even the plain
 * spelling because linking is a property of the *whole* signature, and what is
 * spelled here is one type torn out of it: whether a written `->?` links to the
 * arrows around it, and whether its new home offers the inlet §2.2.1 requires,
 * are not questions this type can answer.
 */

import { IMPURE_ARROW, PURE_ARROW } from "../support/arrows.js";
import type * as Resolved from "../syntax/resolved/index.js";
import type * as Source from "../support/source.js";
import type * as Typed from "../syntax/typed/index.js";

/** A type this module cannot name, and the sentence explaining which and why. */
export interface Unspellable {
  readonly unspellable: string;
}

export type SpellingResult = { readonly text: string } | Unspellable;

export function unspellable(result: SpellingResult): result is Unspellable {
  return "unspellable" in result;
}

/**
 * The names one module has for the nominal types it can see.
 *
 * A nominal type carries the name its *declaration* gave it, which is not always
 * a name the module reading it can write: `import {Colour as Shade}` leaves the
 * declared name `Colour` bound to nothing here, and a type reached only through
 * `import Palette` is spelled `Palette.Colour` (Modules §3.3). Writing the
 * declared name in either case produces text that does not compile, so the
 * spelling has to come from what this module actually bound.
 */
export interface TypeNames {
  readonly unions: ReadonlyMap<Resolved.UnionId, string>;
  readonly records: ReadonlyMap<Resolved.RecordId, string>;
  readonly externTypes: ReadonlyMap<Resolved.ExternTypeId, string>;
  /**
   * Type names this module binds itself, whatever they name.
   *
   * The built-in spellings — `Vector`, `Map`, `Unit`, `Int` and the rest — have
   * no identity to look up and are otherwise written as literals, so this is the
   * only thing standing between them and a module that declared `union Unit` of
   * its own. Prelude names are deliberately absent: they are what a bare
   * spelling means when nothing occludes it, so counting them here would make
   * every module unable to write anything.
   */
  readonly taken: ReadonlySet<string>;
}

/**
 * What each type identity is called *here*.
 *
 * Sources are consulted in the order a reader would expect to write them, and
 * the first name found for an identity wins:
 *
 * 1. declarations in this file, which are spelled by their own name;
 * 2. names brought in by a written `import { … }`, spelled by the local half of
 *    the clause, so an alias is respected;
 * 3. the prelude's types (Modules §5.5), spelled bare;
 * 4. anything a namespace import reaches, spelled `Alias.Name`.
 *
 * A name already claimed by a different identity is not reused — a module that
 * declares its own `Option` occludes the prelude's (Modules §5.4), and spelling
 * the prelude's `Option` there would name the wrong type with no diagnostic to
 * say so. The check is by name, so occlusion is handled wherever it comes from.
 */
export function typeNamesOf(
  resolved: Resolved.Module,
  fileOfSpecifier?: (specifier: string) => Source.FileId | undefined,
): TypeNames {
  const unions = new Map<Resolved.UnionId, string>();
  const records = new Map<Resolved.RecordId, string>();
  const externTypes = new Map<Resolved.ExternTypeId, string>();
  const claimed = new Set<string>();
  const taken = new Set<string>();

  const claim = <Id>(into: Map<Id, string>, id: Id, name: string): void => {
    if (claimed.has(name)) return;
    claimed.add(name);
    // One identity can be reachable under two names — two namespace imports of
    // one module, most simply — and the first is kept so the same request
    // answers the same way twice.
    if (!into.has(id)) into.set(id, name);
  };
  const declaredIn = (fileId: Source.FileId | undefined) => ({
    union: (name: string): Resolved.UnionId | undefined =>
      resolved.unions.find((union) => union.name === name && union.span.fileId === fileId)?.id,
    record: (name: string): Resolved.RecordId | undefined =>
      resolved.records.find((record) => record.name === name && record.span.fileId === fileId)?.id,
    externType: (name: string): Resolved.ExternTypeId | undefined =>
      resolved.externTypes.find((declaration) =>
        declaration.localName === name && declaration.span.fileId === fileId
      )?.externType,
  });

  for (const union of resolved.unions) {
    if (union.span.fileId !== resolved.fileId) continue;
    taken.add(union.name);
    claim(unions, union.id, union.name);
  }
  for (const record of resolved.records) {
    if (record.span.fileId !== resolved.fileId) continue;
    taken.add(record.name);
    claim(records, record.id, record.name);
  }
  for (const declaration of resolved.externTypes) {
    if (declaration.span.fileId !== resolved.fileId) continue;
    taken.add(declaration.localName);
    claim(externTypes, declaration.externType, declaration.localName);
  }
  // A type alias binds a name and has no identity of its own — nothing can be
  // spelled *as* one — so it appears here only to say the name is spoken for.
  // It is spoken for against both kinds of spelling: `type Option = Int` takes
  // the name away from the prelude's union exactly as `union Option` would.
  for (const item of resolved.items) {
    if (item.kind !== "TypeAlias") continue;
    taken.add(item.name);
    claimed.add(item.name);
  }

  // Every import binds a module and nothing smaller (Modules §3, #762), so the
  // spellings an import contributes are the alias's: the qualified ones below,
  // and — where the aliased module exports a type of the alias's own spelling —
  // the **bare** one §5.1 rule 2's companion fallback answers. The bare one is
  // claimed first because it is the spelling the reader would write, and the
  // qualified one still stands behind it for every other type the module
  // exports.
  const namespaces: { readonly alias: string; readonly fileId: Source.FileId }[] = [];
  for (const item of resolved.items) {
    if (item.kind !== "Import" || item.synthesized) continue;
    const declaring = fileOfSpecifier?.(item.specifier);
    if (declaring === undefined || item.form.kind !== "Namespace") continue;
    const { alias } = item.form;
    namespaces.push({ alias, fileId: declaring });
    if (taken.has(alias)) continue;
    const declared = declaredIn(declaring);
    const union = declared.union(alias);
    if (union !== undefined) {
      claim(unions, union, alias);
      continue;
    }
    const record = declared.record(alias);
    if (record !== undefined) {
      claim(records, record, alias);
      continue;
    }
    const externType = declared.externType(alias);
    if (externType !== undefined) claim(externTypes, externType, alias);
  }

  for (const [name, union] of resolved.preludeUnions) claim(unions, union, name);
  for (const [name, record] of resolved.preludeRecords) claim(records, record, name);

  for (const { alias, fileId } of namespaces) {
    for (const union of resolved.unions) {
      if (union.span.fileId === fileId) claim(unions, union.id, `${alias}.${union.name}`);
    }
    for (const record of resolved.records) {
      if (record.span.fileId === fileId) claim(records, record.id, `${alias}.${record.name}`);
    }
    for (const declaration of resolved.externTypes) {
      if (declaration.span.fileId === fileId) {
        claim(externTypes, declaration.externType, `${alias}.${declaration.localName}`);
      }
    }
  }

  return { unions, records, externTypes, taken };
}

/**
 * The spelling of each type variable in one signature.
 *
 * A variable that the signature already writes has to keep that spelling: the
 * `a` in `fun listOf(value: a)` is the same variable the result is built from,
 * and calling it `b` in the result would declare a second, unrelated one. The
 * written names are recovered by walking each written annotation beside the type
 * the checker inferred for it, which is the only place the pairing survives —
 * `Typed.VariableType` is an identity and nothing else.
 *
 * A variable the signature never wrote gets a fresh letter, avoiding every name
 * the signature does write. Minting is safe rather than presumptuous: an
 * annotation variable is rigid while the definition is checked (Functions §4.1),
 * so a minted name is a claim that the function really is polymorphic there —
 * a claim the session re-checks by compiling the edit before offering it.
 */
export class VariableNames {
  readonly #names = new Map<Typed.TypeVariableId, string>();
  readonly #taken = new Set<string>();

  /** Reserves a spelling the signature already uses, whatever it names. */
  reserve(name: string): void {
    this.#taken.add(name);
  }

  /** Records that this identity is written `name` in the source. */
  bind(id: Typed.TypeVariableId, name: string): void {
    this.#taken.add(name);
    if (!this.#names.has(id)) this.#names.set(id, name);
  }

  /**
   * Pairs a written annotation with the type inferred for it, recording every
   * variable spelling the two agree on. Mismatched shapes are simply not
   * recorded: the annotation may be an alias of the inferred type rather than
   * the same tree, and a wrong pairing is worse than a missing one.
   */
  learn(annotation: Resolved.TypeAnnotation, type: Typed.Type): void {
    if (annotation.kind === "TypeVariable") {
      if (type.kind === "Variable") this.bind(type.id, annotation.name);
      else this.reserve(annotation.name);
      return;
    }
    switch (annotation.kind) {
      case "Vector":
        if (type.kind === "Vector") this.learn(annotation.element, type.element);
        return;
      case "Set":
        if (type.kind === "Set") this.learn(annotation.element, type.element);
        return;
      case "Array":
        if (type.kind === "Array") this.learn(annotation.element, type.element);
        return;
      case "JsSet":
        if (type.kind === "JsSet") this.learn(annotation.element, type.element);
        return;
      case "JsMap":
        if (type.kind === "JsMap") {
          this.learn(annotation.key, type.key);
          this.learn(annotation.value, type.value);
        }
        return;
      case "Node":
        if (type.kind === "Node") this.learn(annotation.element, type.element);
        return;
      case "Nullable":
        if (type.kind === "Nullable") this.learn(annotation.value, type.value);
        return;
      case "Map":
        if (type.kind === "Map") {
          this.learn(annotation.key, type.key);
          this.learn(annotation.value, type.value);
        }
        return;
      case "Tuple":
        if (type.kind === "Tuple" && type.elements.length === annotation.elements.length) {
          annotation.elements.forEach((element, at) => this.learn(element, type.elements[at]!));
        }
        return;
      case "Function":
        if (type.kind === "Function" && type.parameters.length === annotation.parameters.length) {
          annotation.parameters.forEach((parameter, at) =>
            this.learn(parameter, type.parameters[at]!)
          );
          this.learn(annotation.result, type.result);
        }
        return;
      case "Record":
        if (annotation.tail !== undefined) this.reserve(annotation.tail);
        if (type.kind === "Record") {
          for (const field of annotation.fields) {
            const inferred = type.fields.find(({ name }) => name === field.name);
            if (inferred !== undefined) this.learn(field.annotation, inferred.type);
          }
          if (type.tail !== undefined && annotation.tail !== undefined) {
            this.bind(type.tail, annotation.tail);
          }
        }
        return;
      case "Union":
        if (type.kind === "Union" && type.arguments.length === annotation.arguments.length) {
          annotation.arguments.forEach((argument, at) => this.learn(argument, type.arguments[at]!));
        }
        return;
      case "RecordDeclaration":
        if (type.kind === "NominalRecord" && type.arguments.length === annotation.arguments.length) {
          annotation.arguments.forEach((argument, at) => this.learn(argument, type.arguments[at]!));
        }
        return;
      default:
        return;
    }
  }

  nameOf(id: Typed.TypeVariableId): string {
    const known = this.#names.get(id);
    if (known !== undefined) return known;
    for (let index = 0; ; index += 1) {
      const letter = String.fromCharCode("a".charCodeAt(0) + (index % 26));
      const cycle = Math.floor(index / 26);
      const candidate = cycle === 0 ? letter : `${letter}${cycle}`;
      if (this.#taken.has(candidate)) continue;
      this.bind(id, candidate);
      return candidate;
    }
  }
}

/**
 * One type as Hexagon source, or the reason it cannot be written here.
 *
 * Every refusal names the type it is about, because the sentence is shown to a
 * user deciding what to do next: "no name for it in this module" is actionable
 * where "cannot infer" is not.
 */
export function spellType(
  type: Typed.Type,
  names: TypeNames,
  variables: VariableNames,
): SpellingResult {
  const parts: string[] = [];
  const write = (each: readonly Typed.Type[]): Unspellable | undefined => {
    for (const one of each) {
      const spelled = spellType(one, names, variables);
      if (unspellable(spelled)) return spelled;
      parts.push(spelled.text);
    }
    return undefined;
  };
  const nominal = (
    name: string | undefined,
    declared: string,
    args: readonly Typed.Type[],
  ): SpellingResult => {
    if (name === undefined) {
      return {
        unspellable:
          `\`${declared}\` is declared in another module and this one has no name for it`,
      };
    }
    const failed = write(args);
    if (failed !== undefined) return failed;
    return { text: args.length === 0 ? name : `${name}(${parts.join(", ")})` };
  };
  /**
   * A name the language supplies rather than a module: `Vector`, `Unit`, `Int`.
   * These have no identity to look up, so occlusion is the only question about
   * them — and a module that declared its own `Unit` would otherwise get the
   * annotation `: Unit` naming its union, which typechecks against nothing and
   * reports `expected Unit, found Unit`.
   */
  const builtIn = (name: string, args: readonly Typed.Type[] = []): SpellingResult => {
    if (names.taken.has(name)) {
      return {
        unspellable:
          `this module declares its own \`${name}\`, so the built-in \`${name}\` ` +
          "has no name here",
      };
    }
    const failed = write(args);
    if (failed !== undefined) return failed;
    return { text: args.length === 0 ? name : `${name}(${parts.join(", ")})` };
  };

  switch (type.kind) {
    case "Primitive":
      return builtIn(type.name);
    case "Range":
      return builtIn("Range");
    case "JsValue":
      return builtIn("JsValue");
    case "Variable":
      return { text: variables.nameOf(type.id) };
    case "Error":
      // The checker's stand-in for a type it could not work out. `?` is a fine
      // thing to show a reader and not a thing to write into a file.
      return { unspellable: "part of the inferred type is unknown, because the definition has an error" };
    case "Vector":
    case "Set":
    case "Array":
    case "JsSet":
    // `Node(a)` is the hidden fixed-32 trie node, which only a privileged
    // runtime module may name. It is written rather than refused here: a module
    // that may not name it is one the type could not have come from.
    case "Node":
      return builtIn(type.kind, [type.element]);
    case "Nullable":
      return builtIn("Nullable", [type.value]);
    case "Map":
      return builtIn("Map", [type.key, type.value]);
    case "JsMap":
      return builtIn("JsMap", [type.key, type.value]);
    case "Tuple": {
      // The empty tuple is `Unit`, which is the type's one name; `()` in type
      // notation is only a zero-parameter domain (Products §2.7, #159).
      if (type.elements.length === 0) return builtIn("Unit");
      const failed = write(type.elements);
      return failed ?? { text: `(${parts.join(", ")})` };
    }
    case "Record": {
      const fields: string[] = [];
      for (const field of type.fields) {
        const spelled = spellType(field.type, names, variables);
        if (unspellable(spelled)) return spelled;
        fields.push(`${field.name}: ${spelled.text}`);
      }
      if (type.tail !== undefined) fields.push(`...${variables.nameOf(type.tail)}`);
      return { text: `{${fields.join(", ")}}` };
    }
    case "Union":
      return nominal(names.unions.get(type.union), type.name, type.arguments);
    case "NominalRecord":
      return nominal(names.records.get(type.record), type.name, type.arguments);
    case "ExternType":
      return nominal(names.externTypes.get(type.externType), type.name, []);
    case "Function": {
      // The arrow's colour is part of the text, so it decides spellability
      // before anything else does (`spec/effects.md` §2, #364). Both constants
      // mean the same thing wherever they are written and go straight in. A
      // *variable* colour does not: the annotation grammar links every written
      // `->?` in a signature into one variable (§2.2), so writing this arrow
      // would say something about the signature's other arrows that this type
      // alone cannot know is true — and, with no inlet among them, would not be
      // legal at all (§2.2.1). Either way the call marks every caller owes can
      // change. So this refuses rather than writing text whose meaning depends
      // on where it lands.
      if (type.effect !== undefined && type.effect !== "impure") {
        return {
          unspellable:
            "this function type's arrow is an effect variable, and writing `->?` here " +
            "would link it to the rest of the signature's colour",
        };
      }
      const failed = write(type.parameters);
      if (failed !== undefined) return failed;
      const result = spellType(type.result, names, variables);
      if (unspellable(result)) return result;
      const sole = type.parameters[0];
      // Parenthesized unless the domain is a single name-shaped parameter: a
      // sole `Unit` reads as `Unit -> a` because there is nothing to
      // disambiguate, where a sole function or tuple needs the parens that keep
      // `((a, b)) -> c` from reading as two parameters.
      const domain = parts.length === 0
        ? "()"
        : parts.length === 1 &&
            sole?.kind !== "Function" &&
            !(sole?.kind === "Tuple" && sole.elements.length > 0)
          ? parts[0]!
          : `(${parts.join(", ")})`;
      const arrow = type.effect === undefined ? PURE_ARROW : IMPURE_ARROW;
      return { text: `${domain} ${arrow} ${result.text}` };
    }
  }
}
