/**
 * The experimental first emitter renders conservative, readable ESM from Core.
 * It is platform-neutral: hosts decide paths and perform filesystem writes.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import { INTRINSIC_INVENTORY, isIntrinsicScheme } from "../../intrinsics.js";
import type { Documentation } from "../../support/documentation.js";
import type * as Source from "../../support/source.js";
import { isSyntheticParameterName } from "../../support/synthetic.js";
import type * as Core from "../../syntax/core/index.js";
import type * as Emitted from "../../emission/index.js";
import type * as Resolved from "../../syntax/resolved/index.js";
import type * as Typed from "../../syntax/typed/index.js";
import { idContinue, idStart } from "../lexer/unicode-17.js";
import {
  planFundamentalSpecializations,
  specializeItem,
  type FundamentalSpecialization,
  type SpecializationCollision,
  type SpecializableItem,
} from "./specializations.js";

export interface JavaScriptEmissionOptions {
  /** Includes private editions for inspection tools; ordinary builds omit them. */
  readonly previewPrivateSpecializations?: boolean;
  /** Exposes reserved evidence handles needed by dependent Hexagon modules. */
  readonly exportInstanceEvidence?: boolean;
}

export function emitJavaScript(
  module: Core.Module,
  options: JavaScriptEmissionOptions = {},
): Emitted.JavaScript {
  return new JavaScriptEmitter(module, options).emit();
}

export interface DeclarationEmissionOptions {
  /**
   * The specifier this module's `.d.ts` spells for the program's runtime
   * declaration module (FFI Part 1 §8.3), path-adjusted from this module's own
   * emitted location to the source common root: `"./hex.js"` at the root
   * itself, `"../hex.js"` one directory down, and the probed name where a user
   * module already claims `hex` there.
   *
   * Only `compileProject` knows the program's paths, so only it can compute
   * this; emitting one module alone takes the same-directory default, which is
   * the shape a single-file program has.
   */
  readonly runtimeSpecifier?: string;
}

/** What a module at the source common root spells; see `runtimeSpecifier`. */
const DEFAULT_RUNTIME_SPECIFIER = "./hex.js";

export function emitDeclarations(
  module: Core.Module,
  options: DeclarationEmissionOptions = {},
): Emitted.Declarations {
  return new DeclarationEmitter(module, options).emit();
}

/** Emits a module-local TypeScript view of top-level bindings for interactive tools. */
export function emitTypeScriptPreview(
  module: Core.Module,
): Emitted.TypeScriptPreview {
  return new TypeScriptPreviewEmitter(module).emit();
}

type EvidenceNames = ReadonlyMap<string, string>;

/**
 * The checker's per-component evidence selection for one container, keyed by
 * component position (#278, `spec/products.md` §2.5's implementer note).
 *
 * `undefined` where there is none to render — the `Hash` walk, which is
 * licensed to stay structural because a `Hash` subject's `Eq` is derived all the
 * way down (Collections Part 2 §4.3), and the error fallbacks. A derived body
 * given `undefined` re-walks the type, which is exactly the old behaviour.
 */
type ComponentEvidence = ReadonlyMap<string, Core.Evidence> | undefined;

function componentEvidence(
  components: readonly Core.EvidenceComponent[],
): ReadonlyMap<string, Core.Evidence> {
  return new Map(components.map(({ key, evidence }) => [key, evidence]));
}

/**
 * Documentation, indexed the way emission asks for it: by the span of the
 * declaration a JSDoc block would precede (spec/doc-comments.md §7.1). A seat
 * that finds nothing here emits nothing — documentation is never invented, and
 * a declaration with no corresponding emitted form simply does not carry its
 * documentation across (§7.1, §8).
 */
class DocIndex {
  readonly #byTarget: ReadonlyMap<number, Documentation>;
  /** Blocks that found a seat: the ones a text emitter has already written. */
  readonly #seated = new Set<Documentation>();

  constructor(docs: readonly Documentation[]) {
    const byTarget = new Map<number, Documentation>();
    for (const doc of docs) {
      // The side table is keyed by the documented declaration's span start, and
      // the whole design rests on that being unique across every claim site. A
      // collision would silently hand one declaration another's documentation,
      // so it fails loudly instead of quietly.
      if (byTarget.has(doc.target)) {
        throw new Error(
          `internal error: two doc blocks target offset ${doc.target}`,
        );
      }
      byTarget.set(doc.target, doc);
    }
    this.#byTarget = byTarget;
  }

  /**
   * The JSDoc block for the declaration at `span`, as lines, or nothing.
   *
   * An empty doc block contributes empty documentation, which tooling treats as
   * absent (§3.2) — so it emits nothing rather than an empty block. It still
   * counts as seated: the seat existed, and the comment has been spoken for.
   */
  lines(span: Source.Span, indent = ""): string[] {
    const doc = this.#byTarget.get(span.start.offset);
    if (doc === undefined) return [];
    this.#seated.add(doc);
    return doc.content === "" ? [] : jsDocBlock(doc.content, indent);
  }

  /**
   * The comments already written as JSDoc, so the ordinary comment channel does
   * not write them a second time. Asked *after* the items are emitted, because
   * what is seated is exactly what emission found a seat for — a doc comment on
   * a `type` alias or a `union` has no `.js` seat, and Comments §6 keeps
   * preserving it as the item-boundary comment it also is.
   */
  seatedComments(): ReadonlySet<Source.Comment> {
    return new Set([...this.#seated].flatMap(({ comments }) => [...comments]));
  }

  /**
   * The source extent of the doc block a declaration carries. The readable `.js`
   * reproduces the source's own vertical spacing, and a declaration's
   * documentation is written above it: without this the blank lines the author
   * put *before* the doc block would be counted from the declaration instead.
   */
  span(span: Source.Span): Source.Span | undefined {
    return this.#byTarget.get(span.start.offset)?.span;
  }
}

/**
 * Whether an item has a seat in the emitted JavaScript for its *own*
 * documentation (§7.1). A `union` does not: what it emits is its constructors,
 * each of which carries its own documentation, and the union type itself exists
 * only in the `.d.ts`. Neither does a `constraint` (it emits member forwarders)
 * or an `honor` block (§7.1 names it explicitly as having no seat).
 */
function hasJavaScriptSeat(item: Core.Item): boolean {
  switch (item.kind) {
    case "Let":
    case "Var":
    case "LetPattern":
    case "Fun":
    case "RecordDeclaration":
    case "Exception":
      return true;
    default:
      return false;
  }
}

/**
 * Renders documentation content as a JSDoc block (§7.2). Content is emitted
 * verbatim — Markdown is what TypeScript tooling renders in JSDoc — with the
 * one sanitization the spec requires: JavaScript's block closer inside the
 * content would end the block early and leave the artifact invalid, so it takes
 * the standard JSDoc escape. The line prefix and the one-line shorthand are
 * quality-of-implementation.
 */
function jsDocBlock(content: string, indent: string): string[] {
  const safe = content.replaceAll("*/", "*\\/");
  const lines = safe.split("\n");
  if (lines.length === 1) return [`${indent}/** ${lines[0]} */`];
  return [
    `${indent}/**`,
    ...lines.map((line) => `${indent} *${line === "" ? "" : ` ${line}`}`),
    `${indent} */`,
  ];
}

/**
 * The two prelude declarations emission is allowed to recognize by identity.
 * Everything else about a user's or the stdlib's types reaches the emitter as
 * ordinary Core, and that is deliberate — this is the whole list of places where
 * the back end knows a specific declaration.
 *
 * - `seq` (Loops §6.6): known for the FFI Part 3 boundary in ruling R1's sense —
 *   wrap a foreign value entering as a `Seq`, drive a `Seq` leaving for
 *   JavaScript, lower `for x in` over one, and — since the defect-12 ruling
 *   (Part 3 §9.4) — give every `Seq` value the boundary traversal method that
 *   *is* its JavaScript face.
 * - `bool` (#147, decisions doc §3): the representation pin. `Bool` is an
 *   ordinary union to every earlier pass; here, and only here, its values are
 *   the JS `boolean` instead of the §6.2 all-nullary strings. This is a
 *   representation commitment, not a semantic one: no Hexagon program can tell
 *   the difference, because every eliminator of a `Bool` is representation-blind
 *   at the source level.
 */
interface PreludeIds {
  readonly seq: Resolved.RecordId | undefined;
  readonly bool: Resolved.UnionId | undefined;
}

function preludeIds(module: Core.Module): PreludeIds {
  return {
    // The same shape as `bool`'s fallback below, and needed for the same
    // reason: `stdlib/Seq.hex` is compiled *before* the prelude can offer it
    // `Seq`, yet it is the one module that constructs `Seq` records, so without
    // the fallback the boundary traversal method (Part 3 §9.4) would be absent
    // from every combinator's result — the defect itself.
    //
    // Unlike `bool`, this fallback is deliberately **not** mirrored in the
    // checker's `#seqRecord`, so the two passes disagree inside that one
    // module. That is safe for a different reason than `bool`'s, and the
    // difference matters: `bool`'s invariant ("they must agree, or one pass
    // pins what another does not") is about a *representation pin*, which both
    // passes act on and which can therefore be violated silently. Nothing here
    // is a pin.
    //
    // The checker reaches `#seqRecord` in three places — Part 1 §5.3's
    // nested-adapter error (extern annotations only, and skipped for the
    // intrinsic door), `#sequence` (the type of `Map.keys`, `Vector.toSeq` and
    // their siblings), and `#asSequence` (`for x in` recognition). Inside
    // `Seq.hex` all three see no `Seq`, so all three would refuse. `Seq.hex`
    // today writes none of them, which is why the disagreement has no reachable
    // consequence — and every one of them fails as a **hard error at compile
    // time**, never as wrong output, so nothing can ship silently while this
    // holds. The realistic trigger is not a new `extern` but a `for x in` loop
    // or a `Vector.toSeq` call added to `Seq.hex` (the #177 inlining arc edits
    // exactly this file); if one lands, mirror this fallback in the checker
    // rather than working around the refusal.
    seq: module.preludeRecords.get("Seq")
      ?? (module.preludeRecords.size === 0
        ? module.records.find(({ name }) => name === "Seq")?.id
        : undefined),
    // The fallback reaches exactly one module: `stdlib/Bool.hex`, which declares
    // what the prelude cannot yet supply to it. Everywhere else the prelude
    // entry wins, so a user's own `union Bool` occludes the name (Modules §5.4)
    // without acquiring the pin.
    bool: module.preludeUnions.get("Bool")
      ?? (module.preludeUnions.size === 0
        ? module.unions.find(({ name }) => name === "Bool")?.id
        : undefined),
  };
}

/**
 * The `Hex.*` runtime collection faces, exactly as FFI Part 1 §8.3 fixes them.
 *
 * The brand is a structural phantom marker rather than Part 7 §5's `unique
 * symbol`, and deliberately so: two programs compiled by the same compiler
 * produce interchangeable runtime values, and a per-program symbol would
 * type-reject handing one across (§8.4 item 3). Nothing carries `"~hex"` at
 * runtime — it is a TypeScript-only phantom, and no emitted JavaScript changes
 * on its account.
 *
 * Binders are lowercase per FFI Part 7 §2.2. No `/// <reference lib="…" />`
 * accompanies these: the declared floor is a consuming `lib` of es2015 or
 * later, stated rather than silently widened (§8.3).
 */
const RUNTIME_FACE_DECLARATIONS = [
  `export interface Vector<a> extends Iterable<a> { readonly "~hex": "Vector"; }`,
  `export interface Set<a> extends Iterable<a> { readonly "~hex": "Set"; }`,
  `export interface Map<k, v> extends Iterable<[k, v]> { readonly "~hex": "Map"; }`,
  `export interface Range extends Iterable<number> { readonly "~hex": "Range"; }`,
] as const;

/** The basename stem the runtime declaration module claims before probing. */
export const RUNTIME_DECLARATIONS_STEM = "hex";

/** The text of a program's runtime declaration module (FFI Part 1 §8.3). */
export function runtimeDeclarationsText(): string {
  return `${RUNTIME_FACE_DECLARATIONS.join("\n")}\n`;
}

/**
 * The same four interfaces as a namespace body, for the TypeScript preview.
 *
 * The preview is one pane of text with nothing to import from, so §8.3
 * obligation 6 has it declare the namespace inline instead. Members of an
 * ambient namespace are exported implicitly; the `export` keyword is dropped
 * because writing it inside `declare namespace` is redundant, and the bodies
 * are otherwise character-for-character the normative ones.
 */
function runtimeNamespaceDeclaration(alias: string): readonly string[] {
  return [
    `declare namespace ${alias} {`,
    ...RUNTIME_FACE_DECLARATIONS.map((line) => `  ${line.replace(/^export /, "")}`),
    "}",
  ];
}

/** The four faces §8.3 governs; every other row of the §4.1 table is elsewhere. */
type RuntimeFaceName = "Vector" | "Set" | "Map" | "Range";

/**
 * One declaration file's use of the runtime faces: the alias they are spelled
 * through, and whether any was actually reached.
 *
 * The alias is settled *before* rendering rather than patched in afterwards,
 * which is what lets `reference` return finished text. That is possible because
 * §10's probe runs over the file's top-level identifiers, and those are a
 * property of the module, not of the rendering — see `declarationTopLevelNames`.
 */
class RuntimeFaces {
  readonly alias: string;
  #used = false;

  constructor(alias: string) {
    this.alias = alias;
  }

  /** Whether any face was rendered — the whole of "emitted only when needed". */
  get used(): boolean {
    return this.#used;
  }

  reference(name: RuntimeFaceName, ...args: readonly string[]): string {
    this.#used = true;
    const face = `${this.alias}.${name}`;
    return args.length === 0 ? face : `${face}<${args.join(", ")}>`;
  }
}

/**
 * One declaration file's use of the prelude's type inventory (FFI Part 7 §2.4):
 * which entry each rendered face reached, and under what local.
 *
 * `RuntimeFaces`' shape, for `RuntimeFaces`' reason — the local is settled at
 * the moment of reference, so `reference` returns finished text and nothing is
 * patched in afterwards. It can be settled that early because the probe's
 * collision universe is a property of the module (`declarationTopLevelNames`)
 * plus the locals this sink has already handed out.
 *
 * Lookup is by identity, never by name: a module may occlude a prelude type
 * name with its own declaration (Modules §5.4), and that declaration's faces
 * must render bare — the discipline the `Bool`/`Seq` pins already follow.
 */
class PreludeTypeFaces {
  readonly #entries: readonly Resolved.PreludeTypeImport[];
  readonly #taken: Set<string>;
  /** The local each *referenced* entry renders as, by its index in the inventory. */
  readonly #locals = new Map<number, string>();

  constructor(entries: readonly Resolved.PreludeTypeImport[], taken: Iterable<string>) {
    this.#entries = entries;
    this.#taken = new Set(taken);
  }

  referenceUnion(id: Resolved.UnionId): string | undefined {
    return this.#reference((entry) => entry.union === id);
  }

  referenceRecord(id: Resolved.RecordId): string | undefined {
    return this.#reference((entry) => entry.record === id);
  }

  referenceExternType(id: Resolved.ExternTypeId): string | undefined {
    return this.#reference((entry) => entry.externType === id);
  }

  /**
   * The `import type` lines the rendered faces owe, in inventory order — which
   * is the normative prelude order, not first-use order, so the emitted text
   * does not depend on where in the module a face happens to sit.
   *
   * An entry a source-written import already binds owes nothing: channel 1 took
   * over its emission, and a second line would be a duplicate identifier.
   *
   * Each line's source specifier rides along because these are the only record
   * of the edge: reachability must emit the module a face imports from, and no
   * `Import` item carries it (`Emitted.Declarations.preludeTypeImports`).
   */
  lines(): readonly { readonly line: string; readonly specifier: string }[] {
    const lines: { line: string; specifier: string }[] = [];
    for (const [index, entry] of this.#entries.entries()) {
      const local = this.#locals.get(index);
      if (local === undefined || entry.explicitLocal !== undefined) continue;
      const item = local === entry.name ? entry.name : `${entry.name} as ${local}`;
      lines.push({
        line: `import type { ${item} } from ` +
          `${JSON.stringify(emittedModuleSpecifier(entry.specifier))};`,
        specifier: entry.specifier,
      });
    }
    return lines;
  }

  #reference(matches: (entry: Resolved.PreludeTypeImport) => boolean): string | undefined {
    const index = this.#entries.findIndex(matches);
    if (index === -1) return undefined;
    const settled = this.#locals.get(index);
    if (settled !== undefined) return settled;
    const entry = this.#entries[index]!;
    const local = entry.explicitLocal ?? this.#probe(entry.name);
    this.#locals.set(index, local);
    this.#taken.add(local);
    return local;
  }

  /**
   * The type's own name, then `Option1`, `Option2`, … — the `Hex` alias probe of
   * §2.1, on the same rule that only *generated* spellings move (Part 1 §10).
   *
   * Nearly unreachable today: a term cannot start with an uppercase letter, and
   * occlusion forecloses the local-type collision by keeping the occluded
   * identity out of every exported face. An import alias can spell any
   * identifier, so this is a guard rather than decoration.
   */
  #probe(name: string): string {
    if (!this.#taken.has(name)) return name;
    for (let suffix = 1; ; suffix += 1) {
      const candidate = `${name}${suffix}`;
      if (!this.#taken.has(candidate)) return candidate;
    }
  }
}

/**
 * What a declaration or preview emitter needs in order to render a type: the
 * prelude identities that pin two faces, the runtime-face sink, and the
 * prelude-type sink.
 */
interface DeclarationFaces {
  readonly prelude: PreludeIds;
  readonly runtime: RuntimeFaces;
  /**
   * §2.4's cross-module type imports. The preview is out of scope and keeps bare
   * names — it is one pane of text with nothing to import from — so it holds an
   * empty sink, which matches nothing and emits nothing.
   */
  readonly preludeTypes: PreludeTypeFaces;
}

/**
 * Every top-level identifier a generated `.d.ts` for this module can spell, as
 * the `Hex` alias probe's collision universe (FFI Part 1 §10).
 *
 * §10 probes "every top-level identifier emitted in that `.d.ts`, regardless of
 * TypeScript namespace", and §8.3 obligation 2 names the class this must not
 * miss: the emitter already writes `import type * as Json from "./tiny-json.js"`
 * for a source-level namespace import, so a module importing under the alias
 * `Hex` forces `Hex1`. That collision predates this ruling.
 *
 * The set is deliberately a superset of the *source-derived* names a file can
 * emit. Whether a declaration reaches the file depends on its being exported
 * and on its kind, and re-deciding that here would be a second copy of `emit`'s
 * conditions, drifting from the first. Over-claiming only ever moves the
 * generated alias, which no user name depends on; under-claiming emits a
 * `.d.ts` that does not compile.
 *
 * The names the emitter *generates* are left out, and that is the one place
 * this is not a superset: `__hex_opaque_X` brand constants and `__hex_bindingN`
 * locals really do reach the file. Both are omitted because their `__hex_`
 * prefix is unconditional, so neither can spell `Hex` or `HexN` — though by two
 * separate mechanisms, which is why this says "prefix" and not "`GeneratedNames`":
 * the brands go through `GeneratedNames.#claim`, while `__hex_bindingN` is a
 * template literal spelled out afresh at each of its use sites.
 * Specialization editions are omitted on a weaker ground — they are
 * `${sourceName}${FundamentalType}`, hence always suffixed `Nat`/`Int`/`Float`/
 * `BigInt`/`Bool`/`String`/`Unit`, and no such name is `Hex` or `HexN` either.
 * A generated-name scheme that ever drops those shapes has to revisit this.
 */
function declarationTopLevelNames(module: Core.Module): ReadonlySet<string> {
  const names = new Set<string>();
  for (const item of module.items) {
    switch (item.kind) {
      case "Import":
        if (item.form.kind === "Namespace") names.add(item.form.alias);
        else if (item.form.kind === "Named") {
          for (const name of item.form.names) names.add(name.local);
        }
        continue;
      case "ExternBlock":
        for (const declaration of item.declarations) names.add(declaration.localName);
        continue;
      case "TypeAlias":
      case "RecordDeclaration":
        names.add(item.name);
        continue;
      case "Union":
        names.add(item.name);
        for (const constructor of item.constructors) names.add(constructor.name);
        continue;
      case "Exception":
        names.add(item.binding.name);
        continue;
      default:
        continue;
    }
  }
  // `Let`/`Fun` names — and, redundantly, the constructor and exception names
  // the switch already added, since `module.symbols` carries those too. The
  // redundancy is kept: it is free, and a reader checking the switch against
  // `emit` should not have to also know which kinds `symbols` covers.
  for (const symbol of module.symbols) names.add(symbol.name);
  return names;
}

/**
 * The generated namespace alias: first free of `Hex`, `Hex1`, `Hex2`, …
 * (FFI Part 1 §10, Part 12 §11.1). Only the generated import is renamed; a user
 * name always keeps its spelling.
 */
function runtimeFacesAlias(module: Core.Module): string {
  const taken = declarationTopLevelNames(module);
  if (!taken.has("Hex")) return "Hex";
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `Hex${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

class JavaScriptEmitter {
  readonly #diagnostics = new Diagnostics.Bag();
  /**
   * Whether the module reached emission already carrying checker errors.
   *
   * Closure doc §13.6 scopes the evidence guarantee to modules the checker
   * accepts: on a **clean** module no value reaches here needing evidence at a
   * non-function type, so the branches below are conformance assertions. On an
   * **already-diagnosed** module they stay reachable — `let g = Some(describe)`
   * unused is the standing example, and it behaves this way on `main` too — and
   * there the emitter must stay quiet and emit best-effort. A second report of
   * the same unsolved variable, phrased as an internal failure, is the
   * Preamble §1.1 violation the ruling named.
   */
  readonly #alreadyDiagnosed: boolean;
  readonly #symbols = new Map<Resolved.SymbolId, Core.Symbol>();
  readonly #constructors = new Map<
    Resolved.SymbolId,
    { constructor: Core.Constructor; tagged: boolean; pinnedBool: boolean }
  >();
  readonly #recordConstructors = new Set<Resolved.SymbolId>();
  readonly #constrainedImports = new Map<Resolved.SymbolId, string>();
  readonly #exceptions = new Map<Resolved.SymbolId, Core.ExceptionItem>();
  readonly #constraints = new Map<string, Core.ConstraintItem>();
  readonly #nullaryExceptions = new Set<Resolved.SymbolId>();
  readonly #generatedNames: GeneratedNames;
  /** Local each imported symbol is bound under, by the module's own imports. */
  readonly #importLocals = new Map<Resolved.SymbolId, string>();
  /** The prelude identities emission is permitted to know; see `PreludeIds`. */
  readonly #prelude: PreludeIds;
  readonly #helpers = new Set<Helper>();
  readonly #helperNames = new Map<Helper, string>();
  readonly #exports: string[] = [];
  readonly #exportedEvidence = new Set<string>();
  /**
   * Every module-level dictionary the emitted body actually names (#153).
   *
   * Recorded at the one place a dictionary *name* reaches the output — the
   * `Instance` branch of `#emitEvidence` — rather than reconstructed by walking
   * Core for identifiers, so it cannot drift from what was written. Read only
   * after every item has been rendered; nothing is pruned after rendering, so by
   * then it is exact rather than an over-approximation.
   */
  readonly #referencedDictionaries = new Set<string>();
  /**
   * Every symbol a rendered `Name` expression named (#263).
   *
   * A superset of the imported symbols: it is consulted only for the names on a
   * *synthesized* prelude import, where an entry that was never referenced is
   * exactly the over-approximation `#noteCompanionCandidate` warns of. Recorded
   * at the one expression form that spells an imported symbol, so it cannot
   * drift from what was written, and read only after every item is rendered.
   */
  readonly #referencedSymbols = new Set<Resolved.SymbolId>();
  /**
   * The synthesized prelude imports, held back during rendering (#263): their
   * name lists are decided from `#referencedSymbols`, which only rendering
   * fills. See `#preludeTermImports`.
   */
  readonly #synthesizedImports: Core.ImportItem[] = [];
  /**
   * The constraint-member forwarders and hoisted default helpers this module
   * needs from other modules (Constraints §6.5), decided after rendering for the
   * reason the synthesized prelude channel is: the resolver puts every member of
   * an imported constraint in scope, because that is what importing a constraint
   * does (Modules §3.1), and importing all of them at run time would put lines
   * the source never wrote — and mostly does not use — into the output.
   *
   * A default helper is not a reference at all: it is owed by an `honor` that
   * inherits the default, and only rendering the instance discovers which.
   */
  readonly #usedDefaultHelpers = new Set<Resolved.SymbolId>();
  readonly #constraintImports: Core.ImportItem[] = [];
  /**
   * Local dictionary names an `Import` item already binds, so the prelude
   * channel never binds one a second time (#153). See `#preludeInstanceImports`.
   */
  readonly #importedInstanceLocals = new Set<string>();
  readonly #module: Core.Module;
  readonly #docs: DocIndex;
  readonly #exportInstanceEvidence: boolean;
  readonly #specializations: readonly FundamentalSpecialization[];
  readonly #generatedBodies: {
    readonly specialization: FundamentalSpecialization;
    readonly text: string;
  }[] = [];

  constructor(module: Core.Module, options: JavaScriptEmissionOptions) {
    this.#module = module;
    this.#docs = new DocIndex(module.docs);
    this.#prelude = preludeIds(module);
    this.#exportInstanceEvidence = options.exportInstanceEvidence ?? false;
    this.#generatedNames = new GeneratedNames(module.symbols.map(({ name }) => name));
    for (const item of module.items) {
      if (item.kind !== "Import") continue;
      for (const { localDictionary } of item.instances) {
        this.#importedInstanceLocals.add(localDictionary);
      }
    }
    for (const item of module.items) {
      if (item.kind !== "Import" || item.form.kind === "Effect") continue;
      // Namespace members are reached as `Alias.member` and never by bare local.
      if (item.form.kind === "Namespace") continue;
      for (const name of item.form.names) {
        if (name.symbol !== undefined) this.#importLocals.set(name.symbol, name.local);
      }
    }
    this.#alreadyDiagnosed = module.diagnostics.some(
      ({ severity }) => severity === "error",
    );
    for (const diagnostic of module.diagnostics) this.#diagnostics.add(diagnostic);
    for (const symbol of module.symbols) this.#symbols.set(symbol.id, symbol);
    for (const union of module.unions) {
      const tagged = union.constructors.some(({ slots }) => (slots?.length ?? 0) > 0);
      const pinnedBool = this.#prelude.bool !== undefined && union.id === this.#prelude.bool;
      for (const constructor of union.constructors) {
        this.#constructors.set(constructor.symbol, { constructor, tagged, pinnedBool });
      }
    }
    for (const record of module.records) {
      this.#recordConstructors.add(record.constructor.symbol);
    }
    for (const item of module.items) {
      if (item.kind === "ConstraintDeclaration") this.#constraints.set(item.name, item);
      if (item.kind !== "Exception") continue;
      this.#exceptions.set(item.binding.symbol, item);
      if (item.slots.length === 0) this.#nullaryExceptions.add(item.binding.symbol);
    }
    for (const item of module.items) {
      if (item.kind !== "Import" || item.form.kind === "Effect") continue;
      for (const name of item.form.names) {
        if (name.symbol === undefined) continue;
        const symbol = this.#symbols.get(name.symbol);
        if ((symbol?.scheme.constraints.length ?? 0) > 0) {
          this.#constrainedImports.set(
            name.symbol,
            item.form.kind === "Namespace"
              ? internalConstrainedExportName(name.symbol)
              : name.local,
          );
        }
      }
    }
    const plan = planFundamentalSpecializations(
      module,
      options.previewPrivateSpecializations ?? false,
    );
    this.#specializations = plan.specializations;
    addSpecializationCollisionDiagnostics(this.#diagnostics, module, plan.collisions);
  }

  emit(): Emitted.JavaScript {
    const body: string[] = [];
    const trailing = trailingComments(this.#module.items, this.#module.comments);

    // Items are rendered before the comment channel is decided, because which
    // doc comments are already spoken for is exactly what rendering discovers:
    // a doc block with no seat here (a `type` alias, a `union`) is still an
    // item-boundary comment, and Comments §6 preserves it as one.
    const rendered = this.#module.items.map((item) => {
      const lines = this.#emitItem(item, 0, new Map(), false);
      const comments = trailing.get(item) ?? [];
      if (comments.length > 0 && lines.length > 0) {
        const last = lines.length - 1;
        lines[last] = `${lines[last]} ${comments.map(({ text }) => text).join(" ")}`;
      }
      // An item that emits nothing has nothing to precede, and one whose
      // emitted forms are its members' rather than its own has no seat for the
      // item's own documentation (§7.1).
      const doc = lines.length > 0 && hasJavaScriptSeat(item)
        ? this.#docs.lines(item.span)
        : [];
      return {
        item,
        lines: [...doc, ...lines],
        // A documented item starts, on the page, at its doc block.
        start: (doc.length > 0 ? this.#docs.span(item.span) : undefined) ?? item.span,
      };
    });

    // After rendering, because rendering is what discovers which prelude
    // dictionaries the body names (#153) and which prelude terms it names
    // (#263), and before the rendered entries, because these are imports.
    const preludeInstanceImports = this.#preludeInstanceImports();
    body.push(...preludeInstanceImports.map(({ line }) => line));
    const preludeTermImports = this.#preludeTermImports();
    body.push(...preludeTermImports.map(({ line }) => line));
    body.push(...this.#constraintMemberImports());

    const seated = this.#docs.seatedComments();
    const entries = sourceEntries(
      rendered,
      this.#module.comments.filter((comment) => !seated.has(comment)),
      trailing,
    );
    let previousSpan: Source.Span | undefined;
    for (const entry of entries) {
      if (previousSpan !== undefined) {
        body.push(...Array(blankLinesBetween(previousSpan, entry.start)).fill(""));
      }
      body.push(
        ...(entry.kind === "Comment" ? commentLines(entry.comment) : entry.lines),
      );
      previousSpan = entry.span;
    }
    body.push(...this.#exports);

    const helpers = [...this.#helpers]
      .sort()
      .flatMap((helper) =>
        renderHelper(helper, this.#helperName(helper), (dependency) =>
          this.#helperName(dependency)
        )
      );
    const lines = helpers.length === 0 ? body : [...helpers, "", ...body];

    const text = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
    return {
      kind: "JavaScript",
      fileId: this.#module.fileId,
      text,
      generatedSections: this.#generatedSections(text),
      preludeInstanceImports: [
        ...new Set(preludeInstanceImports.map(({ specifier }) => specifier)),
      ],
      preludeTermImports: [
        ...new Set(preludeTermImports.map(({ specifier }) => specifier)),
      ],
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  #emitItem(
    item: Core.Item,
    depth: number,
    evidenceNames: EvidenceNames,
    returnFinal: boolean,
  ): string[] {
    const prefix = indent(depth);
    if (item.kind === "ErrorItem") return [`${prefix}undefined;`];
    if (item.kind === "TypeAlias") return [];
    if (item.kind === "Import") {
      // A synthesized prelude import is rendered after every item, because its
      // name list is what the rendered body references and nothing else (#263).
      // Its `instances` are empty by construction (#153), so holding it back
      // withholds no evidence.
      if (item.synthesized) {
        this.#synthesizedImports.push(item);
        return [];
      }
      if (item.constraints.length > 0) this.#constraintImports.push(item);
      const specifier = JSON.stringify(emittedModuleSpecifier(item.specifier));
      const instances = item.instances.map(({ importedDictionary, localDictionary }) =>
        importedDictionary === localDictionary
          ? importedDictionary
          : `${importedDictionary} as ${localDictionary}`
      );
      const instanceImport = instances.length === 0
        ? []
        : [`${prefix}import { ${instances.join(", ")} } from ${specifier};`];
      if (this.#exportInstanceEvidence) {
        for (const { localDictionary } of item.instances) {
          this.#exportEvidence(localDictionary);
        }
      }
      if (item.form.kind === "Effect") {
        return instanceImport.length === 0
          ? [`${prefix}import ${specifier};`]
          : instanceImport;
      }
      if (item.form.kind === "Namespace") {
        const constrained = item.form.names.flatMap(({ symbol, constraintMember }) => {
          if (symbol === undefined || !this.#constrainedImports.has(symbol)) return [];
          if (constraintMember === true) return [];
          const name = internalConstrainedExportName(symbol);
          return [name];
        });
        return [
          `${prefix}import * as ${item.form.alias} from ${specifier};`,
          ...(constrained.length === 0
            ? []
            : [`${prefix}import { ${constrained.join(", ")} } from ${specifier};`]),
          ...instanceImport,
        ];
      }
      const names = item.form.names
        // A pinned `Bool` constructor is emitted as its literal (#147), so the
        // import that would bind it has nothing to bind.
        .filter(({ symbol }) => symbol === undefined || this.#pinnedBoolLiteral(symbol) === undefined)
        // Held back to `#constraintMemberImports`, with the default helpers this
        // import also owes (§6.5).
        .filter(({ constraintMember }) => constraintMember !== true)
        .filter(({ typeOnly }) => typeOnly !== true).map(({ imported, local, symbol }) => {
        const source = symbol !== undefined && this.#constrainedImports.has(symbol)
          ? internalConstrainedExportName(symbol)
          : imported;
        return source === local ? source : `${source} as ${local}`;
      });
      // A synthesized prelude import whose only names were `Bool` constructors
      // has nothing left to bind once the pin emits them as literals (#147), so
      // it must not fall through to the side-effect form: that would put a
      // load-order dependency into the output the source never asked for.
      if (names.length === 0 && item.form.kind === "Named" && item.form.names.length > 0) {
        return instanceImport;
      }
      return [...(names.length === 0
        ? [`${prefix}import ${specifier};`]
        : [`${prefix}import { ${names.join(", ")} } from ${specifier};`]),
        ...instanceImport];
    }
    if (item.kind === "ExternImport") {
      return [`${prefix}import ${JSON.stringify(item.specifier)};`];
    }
    if (item.kind === "ExternBlock") {
      const specifier = JSON.stringify(item.specifier);
      const lines: string[] = [];
      for (const declaration of item.declarations) {
        // A foreign `type` introduces no `.js` binding, so it has no seat here
        // and its documentation stays in the `.d.ts` (§7.1).
        if (declaration.kind === "ExternType") continue;
        const local = this.#identifier(
          declaration.binding.symbol,
          declaration.localName,
        );
        lines.push(...this.#docs.lines(declaration.span, prefix));
        if (!item.intrinsic && isIntrinsicScheme(item.specifier)) {
          // A `hex:`-scheme block the gate refused (§5). The module is errored,
          // so what is emitted is best-effort — but it must not be either of the
          // two things falling through would produce: the lowering (a working
          // door beside the diagnostic forbidding it) or the foreign path, which
          // would write `import … from "hex:intrinsic"` into user output and put
          // the reserved specifier — the one string the reservation exists to
          // keep out — into the artifact. An inert binding is neither.
          //
          // Asking the specifier here is not re-deriving the gate: "is this the
          // reserved scheme?" is syntactic, and the specifier does answer it.
          // Whether the module may *use* it is `item.intrinsic`, above.
          //
          // A binding that throws when called was considered and declined: it
          // would name the refusal at the call site instead of "not a function",
          // but diagnostics are the contract and running an errored module's
          // output is already off-book. §8.3 records the choice.
          lines.push(`${prefix}const ${local} = undefined;`);
          if (declaration.exported) {
            this.#exports.push(
              local === declaration.localName
                ? `export { ${local} };`
                : `export { ${local} as ${declaration.localName} };`,
            );
          }
          continue;
        }
        if (item.intrinsic) {
          // An ordinary binding of this module's output, whose body is the
          // compiler's lowering (`spec/intrinsics.md` §8.3) — so cross-module
          // linkage is ordinary ESM, exactly like every other prelude function.
          // No import is emitted: there is no foreign module. Nor is either
          // `Seq` bridge applied, because this is not a crossing — both sides of
          // the door are Hexagon, and a `Seq` argument arrives as itself.
          //
          // `item.intrinsic`, never the specifier: a `hex:` block the gate
          // refused reaches here as an ordinary errored item, and lowering it
          // would hand back a *working* door beside the diagnostic forbidding it
          // (§5.3). Emission for an errored module is best-effort by design, but
          // best-effort must not mean functional-but-forbidden.
          const key = declaration.foreignName ?? declaration.localName;
          lines.push(`${prefix}const ${local} = ${this.#lowerIntrinsic(key, declaration.span)};`);
          if (declaration.exported) {
            // Occasion 1 applies here as much as to a `.hex` function, and for
            // the sharper reason: an intrinsic's lowering is a compiler helper
            // that drives `pull`, so it is not merely dishonest but broken if a
            // JavaScript caller hands it the `Iterable<a>` its published face
            // invites. `Seq.memoize` is the whole of today's inventory.
            const exported = this.#boundaryExportName(
              local,
              declaration.kind === "ExternFun"
                ? {
                  kind: "Function",
                  parameters: declaration.parameters.map(({ scheme }) => scheme.type),
                  result: declaration.result,
                }
                : declaration.type,
            );
            this.#exports.push(
              exported === declaration.localName
                ? `export { ${exported} };`
                : `export { ${exported} as ${declaration.localName} };`,
            );
          }
          continue;
        }
        // A `Seq` faces JavaScript as `Iterable<a>`. **Outbound needs nothing**
        // (FFI Part 3 §9.4, the outbound extern direction): the value carries
        // that face by representation, so a `Seq` argument is passed to foreign
        // code as itself and crosses by identity. Inbound still needs the door
        // (§2.2) — what arrives may be any iterable — so a foreign result or
        // value declared `Seq(a)` is wrapped, and a genuine `Seq` coming home
        // that way returns by identity rather than acquiring a second spine.
        const wrapper = declaration.kind === "ExternFun"
          ? this.#isSequence(declaration.result) || isUnit(declaration.result)
          : this.#isSequence(declaration.type);
        if (!wrapper) {
          if (declaration.default) {
            lines.push(`${prefix}import ${local} from ${specifier};`);
          } else {
            const foreign = declaration.foreignName ?? declaration.localName;
            lines.push(
              `${prefix}import { ${foreign}${foreign === local ? "" : ` as ${local}`} } from ${specifier};`,
            );
          }
        } else {
          const foreign = declaration.foreignName ?? declaration.localName;
          const imported = this.#generatedNames.fresh(`${local}Foreign`);
          lines.push(
            declaration.default
              ? `${prefix}import ${imported} from ${specifier};`
              : `${prefix}import { ${foreign} as ${imported} } from ${specifier};`,
          );
          if (declaration.kind === "ExternLet") {
            lines.push(
              `${prefix}const ${local} = ${this.#useHelper("seqInbound")}(${imported});`,
            );
          } else {
            const parameters = declaration.parameters.map((parameter) =>
              this.#identifier(parameter.symbol, parameter.name)
            );
            const call = `${imported}(${parameters.join(", ")})`;
            const value = this.#isSequence(declaration.result)
              ? `${this.#useHelper("seqInbound")}(${call})`
              : isUnit(declaration.result)
              ? `{ ${call}; }`
              : call;
            lines.push(`${prefix}const ${local} = ${arrowParameters(parameters)} => ${value};`);
          }
        }
        if (declaration.exported) {
          this.#exports.push(
            local === declaration.localName
              ? `export { ${local} };`
              : `export { ${local} as ${declaration.localName} };`,
          );
        }
      }
      return lines;
    }
    if (item.kind === "ConstraintDeclaration") {
      return item.members.flatMap((member) => {
        const name = this.#identifier(member.binding.symbol, member.binding.name);
        const sourceParameters = member.parameters.map((parameter) =>
          this.#identifier(parameter.symbol, parameter.name)
        );
        const dictionaries = dictionaryEntries(member.binding.scheme).map(
          ({ constraint, variable }) => dictionaryParameterName(constraint, variable),
        );
        const dictionary = dictionaries[0] ?? "undefined";
        const parameters = [...sourceParameters, ...dictionaries];
        if (item.exported) {
          // §6.5: the forwarder gains an ESM export, which an importing module
          // that calls the member imports. Hexagon-to-Hexagon evidence plumbing
          // in the `__hex_instance_*` class, so it takes the internal name and
          // stays out of the `.d.ts` — §6.4 is untouched.
          this.#exports.push(
            `export { ${name} as ${internalConstrainedExportName(member.binding.symbol)} };`,
          );
        }
        // A constraint member's `.js` seat is the forwarder emitted for it; the
        // dictionary type it also documents (§7.1) has no `.d.ts` form yet.
        return [
          ...this.#docs.lines(member.span, prefix),
          `${prefix}const ${name} = ${arrowParameters(parameters)} => ${dictionary}.${member.binding.name}(${sourceParameters.join(", ")});`,
          ...this.#defaultHelper(item, member, depth, evidenceNames),
        ];
      });
    }
    if (item.kind === "Honor") {
      const localEvidence = new Map(evidenceNames);
      const parameters = item.typeParameters.flatMap((parameter) =>
        parameter.constraints.map((constraint) => {
          const name = dictionaryParameterName(constraint, parameter.variable);
          localEvidence.set(evidenceKey(parameter.variable, constraint), name);
          return name;
        })
      );
      const localDictionary = parameters.length === 0
        ? item.dictionary
        : this.#generatedNames.fresh("instance");
      // The checker's answer, carried on the item. It used to be looked up in a
      // module-local table keyed by the constraint's *name*, which returned
      // nothing the moment the declaration could be an imported one — and the
      // miss was silent, leaving a body that reaches the instance under
      // construction with no evidence for it (§6.5, #276).
      if (item.constraintSubject !== undefined) {
        localEvidence.set(
          evidenceKey(item.constraintSubject, item.constraint),
          localDictionary,
        );
      }
      const baseConstraints = item.baseConstraints.map(({ name, evidence }) => {
        const slot = (name[0]?.toLowerCase() ?? "") + name.slice(1);
        return objectProperty(
          slot,
          this.#emitEvidence(evidence, name, item.span, localEvidence),
        );
      });
      const members = item.derived
        ? this.#derivedMembers(item, localEvidence)
        : item.members.map((member) =>
            objectProperty(
              member.name,
              this.#emitExpr(member.value, depth, localEvidence),
            )
          );
      // §6.5: a default inherited from an *exported* constraint is a reference
      // to the home module's helper, applied at call time. Deferring is not
      // cosmetic — `localDictionary` is the const currently being initialized,
      // so reading it eagerly here would hit the temporal dead zone.
      const inheritedDefaults = item.inheritedDefaults.map((inherited) => {
        this.#usedDefaultHelpers.add(inherited.member);
        const parameters_ = Array.from(
          { length: inherited.arity },
          (_, index) => `__hex_arg${index}`,
        );
        return objectProperty(
          inherited.name,
          `${arrowParameters(parameters_)} => ${
            defaultHelperName(inherited.member)
          }(${[localDictionary, ...parameters_].join(", ")})`,
        );
      });
      const completedMembers =
        !item.derived && item.constraint === "Eq" &&
          !item.members.some(({ name }) => name === "notEquals")
          ? [
              ...members,
              ...inheritedDefaults,
              `notEquals: (__hex_left, __hex_right) => !${localDictionary}.equals(__hex_left, __hex_right)`,
            ]
          : [...members, ...inheritedDefaults];
      const value = `{ ${[...baseConstraints, ...completedMembers].join(", ")} }`;
      if (this.#exportInstanceEvidence) {
        this.#exportEvidence(item.dictionary);
      }
      if (parameters.length === 0) {
        return [`${prefix}const ${item.dictionary} = ${value};`];
      }
      return [
        `${prefix}const ${item.dictionary} = ${arrowParameters(parameters)} => {`,
        `${indent(depth + 1)}const ${localDictionary} = ${value};`,
        `${indent(depth + 1)}return ${localDictionary};`,
        `${prefix}};`,
      ];
    }
    if (item.kind === "ExprItem") {
      return returnFinal
        ? this.#emitReturn(item.expression, depth, evidenceNames)
        : this.#emitStatement(item.expression, depth, evidenceNames);
    }

    if (item.kind === "LetPattern") {
      // `bindingRhs` is the *binding-position* question Constraints §6.1 and
      // closure doc §13.3 ask, and a `LetPattern` can be a binding position too:
      // `let (g) = describe` reads through to a bare binder, so `g` names the
      // whole right-hand side and the checker keeps the evidence seat and
      // generalizes. Passing `false` here — as this call did until review round 5
      // — made the emitter eta-expand a *generalized* constrained alias, building
      // a wrapper of the unsuffixed arity while every consumer appended the
      // suffix: `const g = __hex_arg00 => describe(__hex_arg00, undefined)` with
      // `g("x", dict)` at the use. The dropped dictionary this file's §6.1 note
      // exists to prevent, on a program `main` compiles and runs.
      //
      // Destructuring patterns are excluded because there the checker declines
      // the seat (§13.6), so the alias is never generalized and the eta-expansion
      // at the concrete instance is correct. The gate's own condition —
      // every evidence entry an *unresolved* dictionary — is the second guard:
      // a pattern that reads through but whose reference discharged its evidence
      // never takes the bare branch anyway.
      const value = this.#emitExpr(
        item.value,
        depth,
        evidenceNames,
        patternNamesWholeValue(item.pattern),
      );
      const alternatives = expandOrPatterns(item.pattern);
      if (alternatives.length > 1) {
        const bindings = patternBindings(item.pattern);
        if (bindings.length === 0) return [`${prefix}${value};`];
        const matchName = this.#generatedNames.fresh("match");
        const names = bindings.map((binding) =>
          this.#identifier(binding.symbol, binding.name)
        );
        const lines = [
          `${prefix}const ${matchName} = ${value};`,
          `${prefix}let ${names.join(", ")};`,
        ];
        alternatives.forEach((alternative, index) => {
          const plan = this.#emitPatternPlan(alternative, matchName);
          const condition = plan.tests.length === 0
            ? "true"
            : plan.tests.join(" && ");
          lines.push(`${prefix}${index === 0 ? "if" : "else if"} (${condition}) {`);
          for (const binding of plan.bindings) {
            lines.push(`${indent(depth + 1)}${binding.replace(/^const /, "")}`);
          }
          lines.push(`${prefix}}`);
        });
        lines.push(
          `${prefix}else { throw new RangeError("Unexpected irrefutable pattern."); }`,
        );
        return lines;
      }
      if (item.pattern.kind === "Unit") return [`${prefix}${value};`];
      if (item.pattern.kind === "As") {
        const name = this.#identifier(
          item.pattern.binding.symbol,
          item.pattern.binding.name,
        );
        const nested = this.#emitPattern(item.pattern.pattern);
        return [
          `${prefix}const ${name} = ${value};`,
          ...(nested === "" ? [] : [`${prefix}const ${nested} = ${name};`]),
        ];
      }
      const pattern = this.#emitPattern(item.pattern);
      return pattern === ""
        ? [`${prefix}${value};`]
        : [`${prefix}const ${pattern} = ${value};`];
    }
    if (item.kind === "Union") {
      const tagged = item.constructors.some(({ slots }) => (slots?.length ?? 0) > 0);
      const lines = item.constructors.flatMap((constructor) => {
        const name = this.#identifier(constructor.symbol, constructor.name);
        if (item.exported && !item.opaque && depth === 0) {
          this.#exports.push(
            name === constructor.name
              ? `export { ${name} };`
              : `export { ${name} as ${constructor.name} };`,
          );
        }
        // Constructor documentation rides the materialized constructor (§7.1).
        const doc = this.#docs.lines(constructor.span, prefix);
        const slots = constructor.slots ?? [];
        if (slots.length > 0) {
          const parameters = slots.map(({ field }) => field);
          const fields = slots.map(({ field }) => objectProperty(field, field));
          return [...doc, `${prefix}const ${name} = ${arrowParameters(parameters)} => ({ tag: ${JSON.stringify(constructor.name)}, ${fields.join(", ")} });`];
        }
        // The pin (#147, Unions §6.4): a `Bool` constructor materialises against
        // the pinned representation, so the export site binds the JS boolean
        // rather than the all-nullary name-string.
        const pinned = this.#pinnedBoolLiteral(constructor.symbol);
        if (pinned !== undefined) return [...doc, `${prefix}const ${name} = ${pinned};`];
        return [...doc, tagged
          ? `${prefix}const ${name} = { tag: ${JSON.stringify(constructor.name)} };`
          : `${prefix}const ${name} = ${JSON.stringify(constructor.name)};`];
      });
      return lines;
    }
    if (item.kind === "RecordDeclaration") {
      const name = this.#identifier(item.constructor.symbol, item.constructor.name);
      if (item.exported && !item.opaque && depth === 0) {
        this.#exports.push(
          name === item.name ? `export { ${name} };` : `export { ${name} as ${item.name} };`,
        );
      }
      // `Seq`'s constructor is the one that is not the identity: the boundary
      // traversal method is part of what a `Seq` *is* (FFI Part 3 §9.4), so a
      // construction that reaches the binding rather than the inlined form
      // above must still produce it.
      //
      // No source reaches it today — the record is opaque, so only
      // `stdlib/Seq.hex` can name the constructor, and every construction there
      // is a direct call that inlines. This is here because the binding is a
      // *value*: the day `Seq.hex` passes `Seq` to a higher-order function, the
      // identity would silently hand back records without a face, which is the
      // defect this ruling closed. Deliberately unreachable, deliberately kept.
      if (this.#prelude.seq !== undefined && item.id === this.#prelude.seq) {
        return [
          `${prefix}const ${name} = __hex_record => ` +
          `({ ...__hex_record, [Symbol.iterator]: ${this.#useHelper("seqIterate")} });`,
        ];
      }
      return [`${prefix}const ${name} = __hex_record => __hex_record;`];
    }
    if (item.kind === "Exception") {
      const exceptionHelper = this.#useHelper("exception");
      const name = this.#identifier(item.binding.symbol, item.binding.name);
      const parameters = item.slots.map(({ field }) => field);
      const message = item.slots.some(({ field }) => field === "message")
        ? "message"
        : '""';
      const fields = `{ ${item.slots.map(({ field }) => objectProperty(field, field)).join(", ")} }`;
      const value = item.slots.length === 0
        ? `() => ${exceptionHelper}(${JSON.stringify(item.binding.name)}, "", {})`
        : `${arrowParameters(parameters)} => ${exceptionHelper}(${JSON.stringify(item.binding.name)}, ${message}, ${fields})`;
      if (item.exported && depth === 0) {
        this.#exports.push(
          name === item.binding.name
            ? `export { ${name} };`
            : `export { ${name} as ${item.binding.name} };`,
        );
      }
      return [`${prefix}const ${name} = ${value};`];
    }

    if (item.kind === "Fun") {
      const name = this.#identifier(item.binding.symbol, item.binding.name);
      this.#recordExport(item, name, depth);
      return [
        ...this.#emitFunctionDeclaration(item, name, depth, evidenceNames),
        ...this.#emitSpecializations(item, depth),
      ];
    }

    if (item.kind === "Var") {
      const name = this.#identifier(item.binding.symbol, item.binding.name);
      const value = this.#emitExpr(item.value, depth, evidenceNames);
      return [`${prefix}let ${name} = ${value};`];
    }

    const name = this.#identifier(item.binding.symbol, item.binding.name);
    const value = this.#emitBindingValue(item, depth, evidenceNames);
    this.#recordExport(item, name, depth);
    return [
      `${prefix}const ${name} = ${value};`,
      ...this.#emitSpecializations(item, depth),
    ];
  }

  #emitPattern(pattern: Core.Pattern): string {
    switch (pattern.kind) {
      case "Binding":
        return this.#identifier(
          pattern.binding.symbol,
          pattern.binding.name,
        );
      case "Wildcard":
        return "";
      case "Unit":
        return "";
      case "As":
        return this.#emitPattern(pattern.pattern);
      case "Or":
        return this.#emitPattern(pattern.alternatives[0] ?? {
          kind: "Wildcard",
          span: pattern.span,
        });
      case "Integer":
        return cleanNumber(pattern.decimal);
      case "String":
        return JSON.stringify(pattern.value);
      case "Tuple":
        // The arity-0 clause (Products §2.6, #159): the value is `undefined`,
        // so there is nothing to destructure — `const [] = e` would be a
        // runtime TypeError. Unreachable from source, where `()` parses as the
        // `Unit` pattern above, but the representation rule is arity-indexed
        // and this is its arity-0 case at this decision point.
        if (pattern.elements.length === 0) return "";
        return `[${pattern.elements.map((element) =>
          this.#emitPattern(element)
        ).join(", ")}]`;
      case "Vector":
        return "";
      case "Record": {
        const fields = pattern.fields.flatMap((field) => {
          const emitted = this.#emitPattern(field.pattern);
          if (emitted === "") return [];
          return [field.pattern.kind === "Binding" &&
              emitted === field.name
            ? field.name
            : `${field.name}: ${emitted}`];
        });
        return fields.length === 0 ? "" : `{ ${fields.join(", ")} }`;
      }
      case "Constructor": {
        const fields = pattern.arguments.flatMap((argument, index) => {
          const field = this.#constructors.get(pattern.symbol)?.constructor
            .slots[index]?.field ?? `item${index + 1}`;
          const emitted = this.#emitPattern(argument);
          if (emitted === "") return [];
          return [argument.kind === "Binding" && emitted === field
            ? field
            : `${field}: ${emitted}`];
        });
        return fields.length === 0 ? "" : `{ ${fields.join(", ")} }`;
      }
    }
  }

  /**
   * The hoisted helper for one defaulted member of an **exported** constraint
   * (Constraints §6.5).
   *
   * The body emits **once, at home**, taking the completed instance dictionary
   * as its first parameter. That is what lets a default use its module's private
   * bindings and still be inherited by an instance in a module that cannot see
   * them — the body stays where its free names resolve.
   *
   * The dictionary parameter is bound to the *declaration's subject*, which is
   * the variable the default body's own evidence references: a call to a sibling
   * member inside the default reads the slot off this parameter, so an override
   * is respected (§2's "calls from a default dispatch through the completed
   * instance") and §6.3's evaluation-freeness holds — the helper is applied at
   * call time, never while the dictionary literal is under construction.
   *
   * Nothing is emitted for an unexported constraint: its defaults materialize
   * into each honoring dictionary as before.
   */
  #defaultHelper(
    item: Core.ConstraintItem,
    member: Core.ConstraintItem["members"][number],
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    if (!item.exported || member.defaultValue === undefined) return [];
    const name = defaultHelperName(member.binding.symbol);
    const dictionary = `__hex_dict`;
    const localEvidence = new Map(evidenceNames);
    localEvidence.set(evidenceKey(item.subject, item.name), dictionary);
    const parameters = [
      dictionary,
      ...member.defaultValue.parameters.map((parameter) =>
        this.#identifier(parameter.symbol, parameter.name)
      ),
    ];
    this.#exports.push(`export { ${name} };`);
    return [
      `${indent(depth)}const ${name} = ${arrowParameters(parameters)} => ${
        this.#emitExpr(member.defaultValue.body, depth, localEvidence)
      };`,
    ];
  }

  #recordExport(
    item: Core.LetItem | Core.FunItem,
    name: string,
    depth: number,
  ): void {
    if (!item.exported || depth !== 0) return;
    if (item.binding.scheme.constraints.length > 0) {
      // The internal constrained export is Hexagon-to-Hexagon plumbing with
      // trailing evidence — it is not in the `.d.ts` face, so no JavaScript
      // caller can reach it and it needs no boundary wrapper. The face is the
      // specializations, and those do.
      this.#exports.push(
        `export { ${name} as ${internalConstrainedExportName(item.binding.symbol)} };`,
      );
      for (const specialization of this.#specializationsFor(item.binding.symbol)) {
        const exported = this.#boundaryExportName(
          specialization.name,
          specialization.scheme.type,
        );
        this.#exports.push(
          exported === specialization.name
            ? `export { ${specialization.name} };`
            : `export { ${exported} as ${specialization.name} };`,
        );
      }
      return;
    }
    const exported = this.#boundaryExportName(name, item.binding.scheme.type);
    this.#exports.push(
      exported === item.binding.name
        ? `export { ${exported} };`
        : `export { ${exported} as ${item.binding.name} };`,
    );
  }

  /**
   * Part 7 §7 **occasion 1**, specified by the defect-12 ruling (FFI Part 3
   * §9.4). An exported function with a top-level `Seq(a)` parameter faces
   * JavaScript as taking `Iterable<a>`, so the ESM binding is one stable
   * module-level wrapper that routes each such argument through the §2.2
   * inbound door before calling the module-internal function.
   *
   * Nothing else needs one. A `Seq` **result** and a `Seq` **value export** are
   * honest by representation, so they export directly — which is also the only
   * shape available to a value export, since a wrapper there would hand Hexagon
   * importers a non-`Seq`.
   *
   * Allocated once with the binding, so a JS consumer storing or comparing the
   * export sees one function forever (§7). Hexagon importers reach the same
   * binding and therefore the same wrapper; the door's identity pass-through is
   * what makes that semantically invisible to them, at one recognition check
   * per `Seq`-typed argument per cross-module call. Same-module calls bind the
   * internal name and pay nothing.
   *
   * Returns the name to export under — the internal one when no `Seq` parameter
   * is present, which is the overwhelmingly common case.
   */
  #boundaryExportName(name: string, type: Typed.Type): string {
    if (type.kind !== "Function") return name;
    const sequences = type.parameters.map((parameter) => this.#isSequence(parameter));
    if (!sequences.includes(true)) return name;
    const door = this.#useHelper("seqInbound");
    const parameters = sequences.map((_, index) => `__hex_argument${index}`);
    const wrapper = this.#generatedNames.fresh(`${name}Boundary`);
    this.#exports.push(
      `const ${wrapper} = ${arrowParameters(parameters)} => ${name}(${
        parameters.map((parameter, index) =>
          sequences[index] === true ? `${door}(${parameter})` : parameter
        ).join(", ")
      });`,
    );
    return wrapper;
  }

  #emitFunctionDeclaration(
    item: Core.FunItem | Core.LetItem,
    name: string,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    if (item.value.kind !== "Lambda") return [];
    const localEvidence = new Map(evidenceNames);
    const dictionaryParameters = dictionaryEntries(item.binding.scheme).map(
      ({ constraint, variable }) => {
        const dictionary = dictionaryParameterName(constraint, variable);
        localEvidence.set(evidenceKey(variable, constraint), dictionary);
        return dictionary;
      },
    );
    const parameters = [
      ...item.value.parameters.map((parameter) =>
        this.#identifier(parameter.symbol, parameter.name),
      ),
      ...dictionaryParameters,
    ];
    const prefix = indent(depth);
    const head = `${prefix}function ${name}(${parameters.join(", ")}) {`;
    const body = item.value.body.kind === "Block"
      ? this.#emitBlockItems(
          item.value.body.items,
          depth + 1,
          localEvidence,
        )
      : this.#emitReturn(item.value.body, depth + 1, localEvidence);
    return [head, ...body, `${prefix}}`];
  }

  #emitSpecializations(item: Core.Item, depth: number): string[] {
    if (depth !== 0 || (item.kind !== "Let" && item.kind !== "Fun")) return [];
    const lines: string[] = [];
    for (const specialization of this.#specializationsFor(item.binding.symbol)) {
      const specialized = specializeItem(item as SpecializableItem, specialization);
      const emitted = this.#emitFunctionDeclaration(
        specialized,
        specialization.name,
        depth,
        new Map(),
      );
      if (emitted.length === 0) continue;
      this.#generatedBodies.push({ specialization, text: emitted.join("\n") });
      lines.push(...emitted);
    }
    return lines;
  }

  #specializationsFor(
    symbol: Resolved.SymbolId,
  ): readonly FundamentalSpecialization[] {
    return this.#specializations.filter(({ sourceSymbol }) => sourceSymbol === symbol);
  }

  #generatedSections(text: string): readonly Emitted.GeneratedSection[] {
    let cursor = 0;
    return this.#generatedBodies.flatMap(({ specialization, text: body }) => {
      const startOffset = text.indexOf(body, cursor);
      if (startOffset < 0) return [];
      const endOffset = startOffset + body.length;
      cursor = endOffset;
      return [{
        kind: "FundamentalSpecialization" as const,
        sourceName: specialization.sourceName,
        generatedName: specialization.name,
        typeArguments: specialization.assignment.map(({ type }) => type),
        startOffset,
        endOffset,
        bytes: utf8ByteLength(body),
      }];
    });
  }

  #emitBindingValue(
    item: Core.LetItem,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    if (item.value.kind !== "Lambda") {
      return this.#emitExpr(item.value, depth, evidenceNames, true);
    }

    const localEvidence = new Map(evidenceNames);
    const dictionaryParameters = dictionaryEntries(item.binding.scheme).map(
      ({ constraint, variable }) => {
        const name = dictionaryParameterName(constraint, variable);
        localEvidence.set(evidenceKey(variable, constraint), name);
        return name;
      },
    );
    return this.#emitLambda(
      item.value,
      depth,
      localEvidence,
      dictionaryParameters,
    );
  }

  #emitExpr(
    expression: Core.Expr,
    depth: number,
    evidenceNames: EvidenceNames,
    /**
     * Whether this expression *is* a binding's right-hand side — not merely
     * somewhere inside one. Read by exactly one rule, `#emitConstrainedValue`'s
     * bare-alias case, whose spec text (Constraints §6.1, closure doc §13.3)
     * says "at a binding". Never propagated by the recursive cases: a name
     * nested in a record literal or an argument list is not a binding's RHS, and
     * treating it as one is what the 2026-08-01 review caught.
     */
    bindingRhs = false,
  ): string {
    switch (expression.kind) {
      case "Name": {
        this.#referencedSymbols.add(expression.symbol);
        // The pin at the reference site (#147, decisions doc §3.2): `True` emits
        // `true`. Ahead of every other spelling rule, because the constructor
        // never needs a binding, a local, or an import to be named by.
        const pinned = this.#pinnedBoolLiteral(expression.symbol);
        if (pinned !== undefined) return pinned;
        if (this.#constrainedImports.has(expression.symbol)) {
          const imported = this.#constrainedImports.get(expression.symbol)!;
          // An imported constrained binding has the same trailing-evidence ABI
          // as a local one, so a value reference to it needs the same wrapper.
          return (expression.evidence?.length ?? 0) === 0
            ? imported
            : this.#emitConstrainedValue(expression, imported, evidenceNames, bindingRhs);
        }
        if (expression.text.includes(".")) return expression.text;
        // An imported symbol is spelled by the local its import binds, which is
        // not always the name the reference carries: the synthesized prelude
        // import may bind a term under a distinguished local to clear a
        // module-level binding of the same name (Modules §6.4). Consulted before
        // `#identifier`, which sees only text and so cannot know.
        const importLocal = this.#importLocals.get(expression.symbol);
        const name = importLocal ?? this.#identifier(expression.symbol, expression.text);
        if (this.#nullaryExceptions.has(expression.symbol)) return `${name}()`;
        return (expression.evidence?.length ?? 0) === 0
          ? name
          : this.#emitConstrainedValue(expression, name, evidenceNames, bindingRhs);
      }
      case "CollectionOperation": {
        const needsPersistentRuntime = expression.collection !== "Vector";
        // The producing rows hand their traversal to the inbound adapter; the
        // consuming rows drive their argument through the outbound one. HAMT
        // traversal stays runtime-owned and composes with the pair: for an
        // effect-free source, memoizing and re-deriving are observationally
        // equivalent, so §6.4's re-derivation default for user-built sequences
        // is untouched by the boundary's memoization.
        const produces = expression.operation === "toSeq" ||
          (expression.collection === "Map" &&
            ["keys", "values", "entries"].includes(expression.operation));
        const consumes = expression.operation === "fromSeq" ||
          expression.operation === "fromEntries";
        return collectionOperation(
          expression.collection,
          expression.operation,
          needsPersistentRuntime ? this.#useHelper("persistentCollections") : "",
          expression.hashEvidence === undefined
            ? undefined
            : this.#emitEvidence(expression.hashEvidence, "Hash", expression.span, evidenceNames),
          produces ? this.#useHelper("seqFromIterable") : undefined,
          consumes ? this.#useHelper("seqToIterable") : undefined,
        );
      }
      case "PrimitiveOperation":
        return this.#useHelper(primitiveOperationHelper(expression.primitive, expression.operation));
      case "Unit":
      case "ErrorExpr":
        return "undefined";
      case "Number": {
        const literal = cleanNumber(expression.decimal);
        return expression.representation === "Float" ? `${literal}.0` : literal;
      }
      case "BigInt":
        return `${cleanNumber(expression.decimal)}n`;
      case "Float":
        return cleanNumber(expression.spelling);
      case "ConvertNat":
        return this.#emitConvertNat(expression, evidenceNames);
      case "WidenNat":
        return this.#emitWidenNat(expression, depth, evidenceNames);
      case "WidenInt":
        return this.#emitWidenInt(expression, depth, evidenceNames);
      case "String":
        return this.#emitString(expression, depth, evidenceNames);
      case "Tuple":
      case "Vector":
        // The arity-0 tuple's value is `undefined`, never `[]` (Products §2.6,
        // #159). Unreachable from source, where `()` parses as the `Unit`
        // expression above — but this is the representation rule's decision
        // point, so it carries the arity-0 clause. An empty *vector* really is
        // `[]`.
        if (expression.kind === "Tuple" && expression.elements.length === 0) {
          return "undefined";
        }
        return `[${expression.elements.map((element) =>
          this.#emitExpr(element, depth, evidenceNames)
        ).join(", ")}]`;
      case "Record":
        return this.#emitRecordLiteral(expression, depth, evidenceNames);
      case "TupleAccess":
        return (
          `${this.#emitOperand(expression.receiver, Precedence.Call, depth, evidenceNames)}` +
          `[${expression.index}]`
        );
      case "FieldAccess":
        return expression.receiver.kind === "Record"
          ? `(${this.#emitExpr(expression.receiver, depth, evidenceNames)}).${expression.field}`
          : `${this.#emitOperand(expression.receiver, Precedence.Call, depth, evidenceNames)}.${expression.field}`;
      case "Index": {
        const receiver = this.#emitExpr(expression.receiver, depth, evidenceNames);
        const index = this.#emitExpr(expression.index, depth, evidenceNames);
        if (expression.operation === "MapElement") {
          const hash = this.#emitEvidence(
            expression.hashEvidence ?? { kind: "Error" },
            "Hash",
            expression.span,
            evidenceNames,
          );
          return `${this.#useHelper("persistentCollections")}.mapGet(${hash})(${receiver}, ${index})`;
        }
        const helper = expression.operation === "VectorElement"
          ? "vectorIndex"
          : expression.operation === "VectorSlice"
          ? "vectorSlice"
          : expression.operation === "StringElement"
          ? "stringIndex"
          : "stringSlice";
        return `${this.#useHelper(helper)}(${receiver}, ${index})`;
      }
      case "Hash": {
        const dictionary = this.#emitEvidence(expression.evidence, "Hash", expression.span, evidenceNames);
        return `${dictionary}.hash(${this.#emitExpr(expression.value, depth, evidenceNames)})`;
      }
      case "Block": {
        const only = expression.items.length === 1
          ? expression.items[0]
          : undefined;
        return only?.kind === "ExprItem"
          ? this.#emitExpr(only.expression, depth, evidenceNames)
          : this.#emitBlockExpression(expression, depth, evidenceNames);
      }
      case "Lambda":
        return this.#emitLambda(expression, depth, evidenceNames, []);
      case "If": {
        const condition = this.#emitOperand(
          expression.condition,
          Precedence.Conditional,
          depth,
          evidenceNames,
          true,
        );
        const consequence = this.#emitExpr(
          expression.consequence,
          depth,
          evidenceNames,
        );
        const alternative = this.#emitExpr(
          expression.alternative,
          depth,
          evidenceNames,
        );
        return `${condition} ? ${consequence} : ${alternative}`;
      }
      case "While": {
        const lines = this.#emitWhile(expression, depth + 1, evidenceNames);
        return `(() => {\n${lines.join("\n")}\n${indent(depth)}})()`;
      }
      case "For": {
        const lines = this.#emitFor(expression, depth + 1, evidenceNames);
        return `(() => {\n${lines.join("\n")}\n${indent(depth)}})()`;
      }
      case "Match":
        return this.#emitMatch(expression, depth, evidenceNames);
      case "Throw":
        return `(() => { throw ${this.#emitExpr(expression.exception, depth, evidenceNames)}; })()`;
      case "Try":
        return this.#emitTry(expression, depth, evidenceNames);
      case "Call": {
        const constructed = expression.callee.kind === "Name" &&
          this.#recordConstructors.has(expression.callee.symbol) &&
          expression.arguments.length === 1
          ? expression.arguments[0]!
          : undefined;
        if (constructed !== undefined) {
          // A nominal record constructor is the identity, so the construction
          // inlines to its argument — except for `Seq`, whose representation
          // includes the boundary traversal method (FFI Part 3 §9.4). This is
          // one of the two construction sites the ruling names; the other is
          // the inbound adapter.
          if (!this.#isSequence(expression.type)) {
            return this.#emitExpr(constructed, depth, evidenceNames);
          }
          const face = `[Symbol.iterator]: ${this.#useHelper("seqIterate")}`;
          return constructed.kind === "Record"
            ? this.#emitRecordLiteral(constructed, depth, evidenceNames, face)
            // Not a literal (`Seq(existing)`): splice the shared method on
            // rather than mutate a value that may already be someone else's.
            : `{ ...${this.#emitExpr(constructed, depth, evidenceNames)}, ${face} }`;
        }
        return this.#emitCall(expression, depth, evidenceNames);
      }
      case "ConsoleLog":
        return `console.log(${expression.arguments.map((argument) =>
          this.#emitExpr(argument, depth, evidenceNames)
        ).join(", ")})`;
      case "LogicalNot":
        return `!${this.#emitOperand(expression.operand, Precedence.Unary, depth, evidenceNames)}`;
      case "Logical": {
        const operation = expression.operation === "And" ? "&&" : "||";
        const precedence = expression.operation === "And"
          ? Precedence.LogicalAnd
          : Precedence.LogicalOr;
        const left = this.#emitOperand(
          expression.left,
          precedence,
          depth,
          evidenceNames,
        );
        const right = this.#emitOperand(
          expression.right,
          precedence,
          depth,
          evidenceNames,
          true,
        );
        return `${left} ${operation} ${right}`;
      }
      case "ConstraintCall":
        return this.#emitConstraintCall(expression, depth, evidenceNames);
      case "ComparisonChain":
        return this.#emitComparison(expression, depth, evidenceNames);
      case "Range": {
        const helper = this.#useHelper("range");
        return `${helper}(${this.#emitExpr(expression.start, depth, evidenceNames)}, ${this.#emitExpr(expression.end, depth, evidenceNames)})`;
      }
      case "Assignment": {
        const target = this.#identifier(expression.target.symbol, expression.target.text);
        return `void (${target} = ${this.#emitExpr(expression.value, depth, evidenceNames)})`;
      }
    }
  }

  #emitOperand(
    expression: Core.Expr,
    parentPrecedence: Precedence,
    depth: number,
    evidenceNames: EvidenceNames,
    parenthesizeEqual = false,
  ): string {
    const emitted = this.#emitExpr(expression, depth, evidenceNames);
    const precedence = expressionPrecedence(expression);
    return precedence < parentPrecedence ||
      (parenthesizeEqual && precedence === parentPrecedence)
      ? `(${emitted})`
      : emitted;
  }

  #emitLambda(
    expression: Core.LambdaExpr,
    depth: number,
    evidenceNames: EvidenceNames,
    dictionaryParameters: readonly string[],
  ): string {
    const parameters = [
      ...expression.parameters.map((parameter) =>
        this.#identifier(parameter.symbol, parameter.name),
      ),
      ...dictionaryParameters,
    ];
    const head = `${arrowParameters(parameters)} =>`;

    if (expression.body.kind !== "Block") {
      // A `match`, and a `Unit`-position conditional (Operators §11.4), emit
      // statements rather than an expression, so the arrow needs a body block
      // to hold them.
      if (
        expression.body.kind === "Match" ||
        (expression.body.kind === "If" && isUnit(expression.body.type))
      ) {
        const lines = this.#emitReturn(
          expression.body,
          depth + 1,
          evidenceNames,
        );
        return `${head} {\n${lines.join("\n")}\n${indent(depth)}}`;
      }
      return `${head} ${arrowBody(this.#emitExpr(expression.body, depth, evidenceNames))}`;
    }

    const lines = this.#emitBlockItems(
      expression.body.items,
      depth + 1,
      evidenceNames,
    );
    return `${head} {\n${lines.join("\n")}\n${indent(depth)}}`;
  }

  #emitBlockExpression(
    expression: Core.BlockExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const lines = this.#emitBlockItems(
      expression.items,
      depth + 1,
      evidenceNames,
    );
    return `(() => {\n${lines.join("\n")}\n${indent(depth)}})()`;
  }

  #emitBlockItems(
    items: readonly Core.Item[],
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    if (items.length === 0) return [`${indent(depth)}return undefined;`];

    return items.flatMap((item, index) =>
      this.#emitItem(item, depth, evidenceNames, index === items.length - 1),
    );
  }

  #emitReturn(
    expression: Core.Expr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    if (expression.kind === "Match") {
      return this.#emitReturningMatch(expression, depth, evidenceNames);
    }
    // A `Unit`-valued tail is `Unit` position, not value position: the implicit
    // `undefined` a JavaScript function falls off the end with is exactly the
    // value these produce, so they emit as statements (Operators §11.4).
    if (
      expression.kind === "While" || expression.kind === "For" ||
      expression.kind === "Assignment" ||
      (expression.kind === "If" && isUnit(expression.type))
    ) {
      return this.#emitStatement(expression, depth, evidenceNames);
    }
    return [
      `${indent(depth)}return ${this.#emitExpr(expression, depth, evidenceNames)};`,
    ];
  }

  /**
   * An expression in statement position — its value is discarded, so the forms
   * that read better as statements than as expressions emit that way.
   */
  #emitStatement(
    expression: Core.Expr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    switch (expression.kind) {
      case "While":
        return this.#emitWhile(expression, depth, evidenceNames);
      case "For":
        return this.#emitFor(expression, depth, evidenceNames);
      case "If":
        return this.#emitStatementIf(expression, depth, evidenceNames);
      case "Assignment": {
        const target = this.#identifier(
          expression.target.symbol,
          expression.target.text,
        );
        const value = this.#emitExpr(expression.value, depth, evidenceNames);
        return [`${indent(depth)}${target} = ${value};`];
      }
      default:
        return [
          `${indent(depth)}${this.#emitExpr(expression, depth, evidenceNames)};`,
        ];
    }
  }

  /**
   * Statement/`Unit` position: plain `if`/`else if`/`else`, never a ternary
   * (Operators §11.4). An else-less source conditional emits an else-less JS
   * `if` — the `else ()` the parser inserted is erased, never a synthetic
   * `else`. An explicitly written `else ()` contributes no statements either,
   * so the same empty-branch check covers it.
   */
  #emitStatementIf(
    expression: Core.IfExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    const prefix = indent(depth);
    const condition = this.#emitExpr(expression.condition, depth, evidenceNames);
    const lines = [
      `${prefix}if (${condition}) {`,
      ...this.#emitBranch(expression.consequence, depth + 1, evidenceNames),
    ];

    // `else if` is `else` whose expression is another conditional (§11.3), so
    // the chain flattens rather than nesting a braced `if` per level.
    if (!expression.elseless && expression.alternative.kind === "If") {
      const [head = "", ...rest] = this.#emitStatementIf(
        expression.alternative,
        depth,
        evidenceNames,
      );
      return [...lines, `${prefix}} else ${head.trimStart()}`, ...rest];
    }

    const alternative = expression.elseless
      ? []
      : this.#emitBranch(expression.alternative, depth + 1, evidenceNames);
    return alternative.length === 0
      ? [...lines, `${prefix}}`]
      : [...lines, `${prefix}} else {`, ...alternative, `${prefix}}`];
  }

  /**
   * A branch of a statement conditional. A block arm flattens into the braces
   * the `if` already needs — its bindings keep their scope, which is what the
   * braces are — and none of its items returns, since the whole conditional is
   * in statement position.
   */
  #emitBranch(
    expression: Core.Expr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    if (expression.kind === "Unit") return [];
    return expression.kind === "Block"
      ? expression.items.flatMap((item) =>
        this.#emitItem(item, depth, evidenceNames, false)
      )
      : this.#emitStatement(expression, depth, evidenceNames);
  }

  #emitWhile(
    expression: Core.WhileExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    const prefix = indent(depth);
    const condition = this.#emitExpr(expression.condition, depth, evidenceNames);
    const body = expression.body.items.flatMap((item) =>
      this.#emitItem(item, depth + 1, evidenceNames, false)
    );
    return [
      `${prefix}while (${condition}) {`,
      ...body,
      `${prefix}}`,
    ];
  }

  #emitFor(
    expression: Core.ForExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    const prefix = indent(depth);
    const source = this.#emitExpr(expression.iterable, depth, evidenceNames);
    // `for x in` over a `Seq` is compiler-owned (ruling R3) and lowers through
    // the outbound driver — a `while` over `pull`, so a long sequence runs in
    // constant stack (Loops §6.5 promises no tail-call elimination). It is not
    // an `Iterable` instance and never asks for evidence.
    const iterable = this.#isSequence(expression.iterable.type)
      ? `${this.#useHelper("seqToIterable")}(${source})`
      : expression.iteration === undefined
      ? source
      : `${this.#emitEvidence(expression.iteration, "Iterable", expression.span, evidenceNames)}.iterate(${source})`;
    if (expression.pattern.kind === "Binding") {
      const name = this.#identifier(
        expression.pattern.binding.symbol,
        expression.pattern.binding.name,
      );
      const body = expression.body.items.flatMap((item) =>
        this.#emitItem(item, depth + 1, evidenceNames, false)
      );
      return [
        `${prefix}for (const ${name} of ${iterable}) {`,
        ...body,
        `${prefix}}`,
      ];
    }

    const itemName = this.#generatedNames.fresh("item");
    const plan = this.#emitPatternPlan(expression.pattern, itemName);
    const bindings = plan.bindings.map((binding) =>
      `${indent(depth + 1)}${binding}`
    );
    const body = expression.body.items.flatMap((item) =>
      this.#emitItem(item, depth + 1, evidenceNames, false)
    );
    return [
      `${prefix}for (const ${itemName} of ${iterable}) {`,
      ...bindings,
      ...body,
      `${prefix}}`,
    ];
  }

  #emitCall(
    expression: Core.CallExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    if (
      expression.callee.kind === "CollectionOperation" &&
      expression.callee.collection === "Node"
    ) {
      // The hidden fixed-32 trie node lowers to raw JS array operations, addressed
      // 0..31. `set`/`copy` are immutable (copy-on-write); the runtime trie code
      // that emits this is responsible for the unshared-node invariant. §4/§5.1.
      const arguments_ = expression.arguments.map((argument) =>
        this.#emitExpr(argument, depth, evidenceNames)
      );
      const [node = "undefined", index = "undefined", value = "undefined"] = arguments_;
      switch (expression.callee.operation) {
        case "empty":
          return "new Array(32)";
        case "get":
          return `(${node})[${index}]`;
        case "set":
          return `${this.#useHelper("nodeSet")}(${node}, ${index}, ${value})`;
        case "copy":
          return `(${node}).slice()`;
      }
    }
    if (
      expression.callee.kind === "CollectionOperation" &&
      expression.callee.collection === "Vector"
    ) {
      const arguments_ = expression.arguments.map((argument) =>
        this.#emitExpr(argument, depth, evidenceNames)
      );
      const [values = "undefined", argument = "undefined", value = "undefined"] =
        arguments_;
      switch (expression.callee.operation) {
        case "empty":
          return "[]";
        case "length":
          return `(${values}).length`;
        case "isEmpty":
          return `(${values}).length === 0`;
        case "append":
          return `[...${values}, ${argument}]`;
        case "prepend":
          return `[${argument}, ...${values}]`;
        case "at":
          return `${this.#useHelper("vectorAt")}(${values}, ${argument})`;
        case "set":
          return `${this.#useHelper("vectorSet")}(${values}, ${argument}, ${value})`;
        case "toSeq":
          return `${this.#useHelper("seqFromIterable")}(${values})`;
        case "fromSeq":
          return `Array.from(${this.#useHelper("seqToIterable")}(${values}))`;
      }
    }
    const specialization = this.#callSpecialization(expression);
    const emittedCallee = specialization?.name ??
      this.#emitExpr(expression.callee, depth, evidenceNames);
    const callee =
      expression.callee.kind === "Name" ||
        expression.callee.kind === "Call"
        ? emittedCallee
        : `(${emittedCallee})`;
    const arguments_ = expression.arguments.map((argument) =>
      this.#emitExpr(argument, depth, evidenceNames),
    );
    if (specialization === undefined) {
      arguments_.push(
        ...this.#evidenceArguments(expression.evidence, expression.span, evidenceNames),
      );
    }
    return `${callee}(${arguments_.join(", ")})`;
  }

  #callSpecialization(
    expression: Core.CallExpr,
  ): FundamentalSpecialization | undefined {
    if (expression.callee.kind !== "Name") return undefined;
    const candidates = this.#specializationsFor(expression.callee.symbol);
    if (candidates.length === 0) return undefined;

    const symbol = this.#symbols.get(expression.callee.symbol);
    if (symbol === undefined) return undefined;
    const entries = dictionaryEntries(symbol.scheme);
    if (entries.length !== expression.evidence.length) return undefined;

    const assignments = new Map<Typed.TypeVariableId, Typed.PrimitiveName>();
    for (const [index, entry] of entries.entries()) {
      const evidence = expression.evidence[index]?.value;
      if (evidence?.kind !== "Primitive") return undefined;
      const previous = assignments.get(entry.variable);
      if (previous !== undefined && previous !== evidence.instance) return undefined;
      assignments.set(entry.variable, evidence.instance);
    }

    return candidates.find((candidate) =>
      candidate.assignment.every(({ variable, type }) =>
        assignments.get(variable) === type
      )
    );
  }

  #emitMatch(
    expression: Core.MatchExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const lines = this.#emitReturningMatch(
      expression,
      depth + 1,
      evidenceNames,
    );
    return `(() => {\n${lines.join("\n")}\n${indent(depth)}})()`;
  }

  #emitTry(
    expression: Core.TryExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const error = this.#generatedNames.fresh("error");
    const prefix = indent(depth);
    const inner = indent(depth + 1);
    const armIndent = indent(depth + 2);
    const lines = [
      "(() => {",
      `${inner}try {`,
      `${armIndent}return ${this.#emitExpr(expression.body, depth + 2, evidenceNames)};`,
      `${inner}} catch (${error}) {`,
    ];
    for (const arm of expression.arms) {
      for (const alternative of expandOrPatterns(arm.pattern)) {
        const plan = this.#emitPatternPlan(alternative, error, true);
        const condition = plan.tests.length === 0
          ? "true"
          : plan.tests.join(" && ");
        lines.push(`${armIndent}if (${condition}) {`);
        const bodyDepth = depth + 3;
        const bodyIndent = indent(bodyDepth);
        for (const binding of plan.bindings) {
          lines.push(`${bodyIndent}${binding}`);
        }
        if (arm.guard === undefined) {
          lines.push(
            `${bodyIndent}return ${this.#emitExpr(arm.body, bodyDepth, evidenceNames)};`,
          );
        } else {
          const guard = this.#emitExpr(arm.guard, bodyDepth, evidenceNames);
          lines.push(`${bodyIndent}if (${guard}) {`);
          lines.push(
            `${indent(bodyDepth + 1)}return ${this.#emitExpr(arm.body, bodyDepth + 1, evidenceNames)};`,
            `${bodyIndent}}`,
          );
        }
        lines.push(`${armIndent}}`);
      }
    }
    lines.push(
      `${armIndent}throw ${error};`,
      `${inner}}`,
      `${prefix}})()`,
    );
    return lines.join("\n");
  }

  #emitReturningMatch(
    expression: Core.MatchExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    if (
      expression.union === undefined ||
      expression.arms.some((arm) =>
        arm.guard !== undefined || !isSimpleSwitchPattern(arm.pattern)
      )
    ) {
      return this.#emitConditionalMatch(expression, depth, evidenceNames);
    }
    const prefix = indent(depth);
    const armIndent = indent(depth + 1);
    const bodyDepth = depth + 2;
    const bodyIndent = indent(bodyDepth);
    const union = this.#module.unions.find(({ id }) => id === expression.union);
    const tagged = union?.constructors.some(({ slots }) => (slots?.length ?? 0) > 0) ?? false;
    const needsMatchName = tagged || expression.arms.some(
      (arm) => arm.pattern.kind === "Binding",
    );
    const matchName = needsMatchName
      ? this.#generatedNames.fresh("match")
      : undefined;
    const scrutinee = this.#emitExpr(
      expression.scrutinee,
      depth,
      evidenceNames,
    );
    const lines = matchName === undefined
      ? [`${prefix}switch (${scrutinee}) {`]
      : [
          `${prefix}const ${matchName} = ${scrutinee};`,
          `${prefix}switch (${matchName}${tagged ? ".tag" : ""}) {`,
        ];
    for (const arm of expression.arms) {
      const pattern = arm.pattern;
      if (pattern.kind === "Constructor") {
        // `case true:` / `case false:` under the pin; the name-string otherwise.
        const pinned = this.#pinnedBoolLiteral(pattern.symbol);
        lines.push(`${armIndent}case ${pinned ?? JSON.stringify(pattern.text)}:`);
        const metadata = this.#constructors.get(pattern.symbol)?.constructor;
        pattern.arguments.forEach((argument, index) => {
          if (matchName === undefined) return;
          const field = metadata?.slots[index]?.field ?? `item${index + 1}`;
          const destructuring = this.#emitPattern(argument);
          if (destructuring !== "") {
            lines.push(`${bodyIndent}const ${destructuring} = ${matchName}.${field};`);
          }
        });
        lines.push(...this.#emitArmBody(arm.body, bodyDepth, bodyIndent, evidenceNames));
      } else {
        lines.push(`${armIndent}default:`);
        if (pattern.kind === "Binding") {
          const name = this.#identifier(
            pattern.binding.symbol,
            pattern.binding.name,
          );
          lines.push(`${bodyIndent}const ${name} = ${matchName};`);
        }
        lines.push(...this.#emitArmBody(arm.body, bodyDepth, bodyIndent, evidenceNames));
      }
    }
    if (expression.arms.every((arm) => arm.pattern.kind === "Constructor")) {
      lines.push(
        `${armIndent}default:`,
        `${bodyIndent}throw new RangeError("Unexpected pattern.");`,
      );
    }
    lines.push(`${prefix}}`);
    return lines;
  }

  /**
   * A switch arm's body, followed by `break;` unless the body already exits.
   * An arm whose value is `Unit` — an assignment, a loop — emits statements
   * rather than a `return`, so without the `break` control would fall through
   * into the next arm's destructuring and then the exhaustiveness backstop.
   */
  #emitArmBody(
    body: Core.Expr,
    depth: number,
    bodyIndent: string,
    evidenceNames: EvidenceNames,
  ): string[] {
    const lines = this.#emitReturn(body, depth, evidenceNames);
    return exits(lines) ? lines : [...lines, `${bodyIndent}break;`];
  }

  #emitConditionalMatch(
    expression: Core.MatchExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    const prefix = indent(depth);
    const matchName = this.#generatedNames.fresh("match");
    const scrutinee = this.#emitExpr(expression.scrutinee, depth, evidenceNames);
    const lines = [`${prefix}const ${matchName} = ${scrutinee};`];

    for (const arm of expression.arms) {
      const alternatives = expandOrPatterns(arm.pattern);
      for (const [index, alternative] of alternatives.entries()) {
        const plan = this.#emitPatternPlan(alternative, matchName);
        const condition = plan.tests.length === 0
          ? "true"
          : plan.tests.join(" && ");
        const keyword = index === 0 ? "if" : "else if";
        lines.push(`${prefix}${keyword} (${condition}) {`);
        const armDepth = depth + 1;
        const armPrefix = indent(armDepth);
        for (const binding of plan.bindings) {
          lines.push(`${armPrefix}${binding}`);
        }
        if (arm.guard === undefined) {
          lines.push(...this.#emitChainArmBody(arm.body, armDepth, armPrefix, evidenceNames));
        } else {
          const guard = this.#emitExpr(arm.guard, armDepth, evidenceNames);
          lines.push(`${armPrefix}if (${guard}) {`);
          lines.push(...this.#emitChainArmBody(
            arm.body,
            armDepth + 1,
            indent(armDepth + 1),
            evidenceNames,
          ));
          lines.push(`${armPrefix}}`);
        }
        lines.push(`${prefix}}`);
      }
    }
    lines.push(`${prefix}throw new RangeError("Unexpected pattern.");`);
    return lines;
  }

  /**
   * An `if`-chain arm's body, followed by `return;` unless the body already
   * exits. An arm whose value is `Unit` — an assignment, a loop, a statement
   * conditional — emits statements rather than a `return`, and the chain is
   * closed by the unreachable-pattern `throw`, so without this the arm would
   * run and then fall into that throw.
   */
  #emitChainArmBody(
    body: Core.Expr,
    depth: number,
    bodyIndent: string,
    evidenceNames: EvidenceNames,
  ): string[] {
    const lines = this.#emitReturn(body, depth, evidenceNames);
    return exits(lines) ? lines : [...lines, `${bodyIndent}return;`];
  }

  #emitPatternPlan(
    pattern: Core.Pattern,
    value: string,
    exceptionPatterns = false,
  ): PatternPlan {
    switch (pattern.kind) {
      case "Wildcard":
        return { tests: [], bindings: [] };
      case "Unit":
        return { tests: [`${value} === undefined`], bindings: [] };
      case "As": {
        const nested = this.#emitPatternPlan(
          pattern.pattern,
          value,
          exceptionPatterns,
        );
        const name = this.#identifier(pattern.binding.symbol, pattern.binding.name);
        return {
          tests: nested.tests,
          bindings: [...nested.bindings, `const ${name} = ${value};`],
        };
      }
      case "Or": {
        const alternatives = pattern.alternatives.map((alternative) =>
          this.#emitPatternPlan(alternative, value, exceptionPatterns)
        );
        if (alternatives.some(({ bindings }) => bindings.length > 0)) {
          return { tests: ["false"], bindings: [] };
        }
        return {
          tests: [alternatives.map(({ tests }) =>
            tests.length === 0 ? "true" : `(${tests.join(" && ")})`
          ).join(" || ")],
          bindings: [],
        };
      }
      case "Binding": {
        const name = this.#identifier(pattern.binding.symbol, pattern.binding.name);
        return { tests: [], bindings: [`const ${name} = ${value};`] };
      }
      case "Integer":
        return { tests: [`${value} === ${cleanNumber(pattern.decimal)}`], bindings: [] };
      case "String":
        return { tests: [`${value} === ${JSON.stringify(pattern.value)}`], bindings: [] };
      case "Tuple":
        return combinePatternPlans(
          pattern.elements.map((element, index) =>
            this.#emitPatternPlan(
              element,
              `${value}[${index}]`,
              exceptionPatterns,
            )
          ),
        );
      case "Vector": {
        const fixed = pattern.elements.length;
        const plans = pattern.elements.map((element, index) => {
          const position = pattern.rest === undefined || index < pattern.rest.index
            ? String(index)
            : `${value}.length - ${fixed - index}`;
          return this.#emitPatternPlan(
            element,
            `${value}[${position}]`,
            exceptionPatterns,
          );
        });
        const combined = combinePatternPlans(plans);
        const restEnd = pattern.rest === undefined || pattern.rest.index === fixed
          ? ""
          : `, ${value}.length - ${fixed - pattern.rest.index}`;
        const restPlan = pattern.rest?.pattern === undefined
          ? { tests: [], bindings: [] }
          : this.#emitPatternPlan(
              pattern.rest.pattern,
              `${value}.slice(${pattern.rest.index}${restEnd})`,
              exceptionPatterns,
            );
        return {
          tests: [
            pattern.rest === undefined
              ? `${value}.length === ${fixed}`
              : `${value}.length >= ${fixed}`,
            ...combined.tests,
            ...restPlan.tests,
          ],
          bindings: [...combined.bindings, ...restPlan.bindings],
        };
      }
      case "Record":
        return combinePatternPlans(
          pattern.fields.map((field) =>
            this.#emitPatternPlan(
              field.pattern,
              `${value}.${field.name}`,
              exceptionPatterns,
            )
          ),
        );
      case "Constructor": {
        const exception = exceptionPatterns
          ? this.#exceptions.get(pattern.symbol)
          : undefined;
        const metadata = this.#constructors.get(pattern.symbol);
        const pinned = this.#pinnedBoolLiteral(pattern.symbol);
        const test = exception !== undefined
          ? `${value} != null && ${value}.$hex === true && ${value}.name === ${JSON.stringify(pattern.text)}`
          : pinned !== undefined
          // The pin again: a `Bool` pattern tests the boolean it actually is.
          ? `${value} === ${pinned}`
          : metadata?.tagged
          ? `${value}.tag === ${JSON.stringify(pattern.text)}`
          : `${value} === ${JSON.stringify(pattern.text)}`;
        const payloads = pattern.arguments.map((argument, index) => {
          const field = exception?.slots[index]?.field ??
            metadata?.constructor.slots[index]?.field ??
            `item${index + 1}`;
          return this.#emitPatternPlan(
            argument,
            `${value}.${field}`,
            exceptionPatterns,
          );
        });
        const combined = combinePatternPlans(payloads);
        return { tests: [test, ...combined.tests], bindings: combined.bindings };
      }
    }
  }

  #emitConvertNat(
    expression: Core.ConvertNatExpr,
    evidenceNames: EvidenceNames,
  ): string {
    if (expression.evidence.kind === "Primitive") {
      const literal = cleanNumber(expression.decimal);
      if (expression.evidence.instance === "BigInt") return `${literal}n`;
      if (expression.evidence.instance === "Float") return `${literal}.0`;
      return literal;
    }
    if (expression.evidence.kind === "Instance" || expression.evidence.kind === "Structural") {
      const dictionary = this.#emitEvidence(
        expression.evidence,
        "Num",
        expression.span,
        evidenceNames,
      );
      return `${dictionary}.fromNat(${cleanNumber(expression.decimal)})`;
    }
    if (expression.evidence.kind !== "Dictionary") return "undefined";
    const dictionary = this.#dictionary(
      expression.evidence.variable,
      expression.evidence.constraint ?? "Num",
      expression.span,
      evidenceNames,
      expression.evidence.path,
    );
    return `${dictionary}.fromNat(${cleanNumber(expression.decimal)})`;
  }

  #emitWidenNat(
    expression: Core.WidenNatExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const value = this.#emitExpr(expression.value, depth, evidenceNames);
    if (expression.evidence.kind === "Primitive") {
      return expression.evidence.instance === "BigInt"
        ? `BigInt(${value})`
        : value;
    }
    if (expression.evidence.kind === "Dictionary") {
      const dictionary = this.#dictionary(
        expression.evidence.variable,
        expression.evidence.constraint ?? "Num",
        expression.span,
        evidenceNames,
        expression.evidence.path,
      );
      return `${dictionary}.fromNat(${value})`;
    }
    if (expression.evidence.kind === "Instance" || expression.evidence.kind === "Structural") {
      const dictionary = this.#emitEvidence(
        expression.evidence,
        "Num",
        expression.span,
        evidenceNames,
      );
      return `${dictionary}.fromNat(${value})`;
    }
    return "undefined";
  }

  #emitWidenInt(
    expression: Core.WidenIntExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const value = this.#emitExpr(expression.value, depth, evidenceNames);
    if (expression.evidence.kind === "Primitive") {
      return expression.evidence.instance === "BigInt"
        ? `BigInt(${value})`
        : value;
    }
    if (expression.evidence.kind === "Dictionary") {
      const dictionary = this.#dictionary(
        expression.evidence.variable,
        expression.evidence.constraint ?? "Signed",
        expression.span,
        evidenceNames,
        expression.evidence.path,
      );
      return `${dictionary}.fromInt(${value})`;
    }
    if (expression.evidence.kind === "Instance" || expression.evidence.kind === "Structural") {
      const dictionary = this.#emitEvidence(
        expression.evidence,
        "Signed",
        expression.span,
        evidenceNames,
      );
      return `${dictionary}.fromInt(${value})`;
    }
    return "undefined";
  }

  #emitString(
    expression: Core.StringExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const parts = expression.parts.map((part) => {
      if (part.kind === "Text") return JSON.stringify(part.value);
      const value = this.#emitExpr(part.expression, depth, evidenceNames);
      if (part.evidence.kind === "Dictionary") {
        const dictionary = this.#dictionary(
          part.evidence.variable,
          part.evidence.constraint ?? "Show",
          part.span,
          evidenceNames,
          part.evidence.path,
        );
        return `${dictionary}.show(${value})`;
      }
      if (part.evidence.kind === "Instance" || part.evidence.kind === "Structural") {
        const dictionary = this.#emitEvidence(
          part.evidence,
          "Show",
          part.span,
          evidenceNames,
        );
        return `${dictionary}.show(${value})`;
      }
      if (part.evidence.kind === "Primitive") {
        if (part.evidence.instance === "String") {
          return this.#emitOperand(
            part.expression,
            Precedence.Additive,
            depth,
            evidenceNames,
          );
        }
        return `String(${value})`;
      }
      return `(${value}, undefined)`;
    });
    return parts.length === 0 ? '""' : parts.join(" + ");
  }

  #emitConstraintCall(
    expression: Core.ConstraintCallExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const arguments_ = expression.arguments.map((argument) =>
      this.#emitExpr(argument, depth, evidenceNames),
    );
    if (expression.evidence.kind === "Dictionary") {
      const dictionary = this.#dictionary(
        expression.evidence.variable,
        expression.evidence.constraint ?? expression.constraint,
        expression.span,
        evidenceNames,
        expression.evidence.path,
      );
      return `${dictionary}.${expression.member}(${arguments_.join(", ")})`;
    }
    if (expression.evidence.kind === "Error") return "undefined";
    if (expression.evidence.kind === "Instance" || expression.evidence.kind === "Structural") {
      const dictionary = this.#emitEvidence(
        expression.evidence,
        expression.constraint,
        expression.span,
        evidenceNames,
      );
      return `${dictionary}.${expression.member}(${arguments_.join(", ")})`;
    }

    const instance = expression.evidence.instance;
    const [leftExpression, rightExpression] = expression.arguments;
    const operand = (
      argument: Core.Expr | undefined,
      precedence: Precedence,
      parenthesizeEqual = false,
    ): string =>
      argument === undefined
        ? "undefined"
        : this.#emitOperand(
            argument,
            precedence,
            depth,
            evidenceNames,
            parenthesizeEqual,
          );
    switch (expression.member) {
      case "negate":
        return `-${operand(leftExpression, Precedence.Unary, true)}`;
      case "add":
        return (
          `${operand(leftExpression, Precedence.Additive)} + ` +
          operand(rightExpression, Precedence.Additive, true)
        );
      case "subtract":
        return (
          `${operand(leftExpression, Precedence.Additive)} - ` +
          operand(rightExpression, Precedence.Additive, true)
        );
      case "multiply":
        return (
          `${operand(leftExpression, Precedence.Multiplicative)} * ` +
          operand(rightExpression, Precedence.Multiplicative, true)
        );
      case "divide":
        return (
          `${operand(leftExpression, Precedence.Multiplicative)} / ` +
          operand(rightExpression, Precedence.Multiplicative, true)
        );
      case "concat":
        // Both operands are String, so flattening a nested concat preserves
        // JavaScript evaluation order and cannot trigger numeric addition.
        return (
          `${operand(leftExpression, Precedence.Additive)} + ` +
          operand(rightExpression, Precedence.Additive)
        );
      case "pow":
        if (instance === "Float") {
          const left = leftExpression === undefined
            ? "undefined"
            : expressionPrecedence(leftExpression) === Precedence.Unary
              ? `(${this.#emitExpr(leftExpression, depth, evidenceNames)})`
              : operand(leftExpression, Precedence.Exponentiation, true);
          return (
            `${left} ** ` +
            operand(rightExpression, Precedence.Exponentiation)
          );
        }
        return `${this.#useHelper("checkedPower")}(${arguments_[0] ?? "undefined"}, ${arguments_[1] ?? "undefined"})`;
    }
  }

  #emitComparison(
    expression: Core.ComparisonChainExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    if (expression.steps.length === 0) return "true";
    if (expression.steps.length === 1) {
      const step = expression.steps[0]!;
      const precedence = comparisonPrecedence(step);
      return this.#emitComparisonStep(
        step,
        this.#emitOperand(
          expression.operands[0]!,
          precedence,
          depth,
          evidenceNames,
        ),
        this.#emitOperand(
          expression.operands[1]!,
          precedence,
          depth,
          evidenceNames,
          true,
        ),
        evidenceNames,
      );
    }

    const prefix = indent(depth + 1);
    const operandNames = expression.operands.map(() =>
      this.#generatedNames.fresh("compare")
    );
    const lines = [
      `${prefix}const ${operandNames[0]} = ${this.#emitExpr(expression.operands[0]!, depth + 1, evidenceNames)};`,
    ];
    for (let index = 0; index < expression.steps.length; index += 1) {
      const operandName = operandNames[index + 1]!;
      lines.push(
        `${prefix}const ${operandName} = ${this.#emitExpr(expression.operands[index + 1]!, depth + 1, evidenceNames)};`,
      );
      const test = this.#emitComparisonStep(
        expression.steps[index]!,
        operandNames[index]!,
        operandName,
        evidenceNames,
      );
      lines.push(
        index === expression.steps.length - 1
          ? `${prefix}return ${test};`
          : `${prefix}if (!(${test})) return false;`,
      );
    }
    return `(() => {\n${lines.join("\n")}\n${indent(depth)}})()`;
  }

  #emitComparisonStep(
    step: Core.ComparisonStep,
    left: string,
    right: string,
    evidenceNames: EvidenceNames,
  ): string {
    const constraint =
      step.test === "Equal" || step.test === "NotEqual" ? "Eq" : "Ord";
    if (step.evidence.kind === "Dictionary") {
      const dictionary = this.#dictionary(
        step.evidence.variable,
        step.evidence.constraint ?? constraint,
        step.span,
        evidenceNames,
        step.evidence.path,
      );
      if (step.test === "Equal") return `${dictionary}.equals(${left}, ${right})`;
      if (step.test === "NotEqual") {
        return `${dictionary}.notEquals(${left}, ${right})`;
      }
      return comparisonFromOrdering(
        step.test,
        `${dictionary}.compare(${left}, ${right})`,
      );
    }
    if (step.evidence.kind === "Error") return "false";
    if (
      step.evidence.kind === "Structural" &&
      step.evidence.type.kind === "Union" &&
      this.#prelude.bool !== undefined &&
      step.evidence.type.union === this.#prelude.bool
    ) {
      // The pin (#147 §3.2/§3.4): comparing two `Bool`s is comparing two JS
      // booleans, so it is the operator itself — `a === b` for `iff` and `==`,
      // and `<`/`<=`/`>`/`>=` directly, because `false < true` is exactly the
      // declaration order `False | True`. Building a dictionary object to call
      // `.equals` on would be the same answer wrapped in an allocation.
      if (step.test === "Equal") return `${left} === ${right}`;
      if (step.test === "NotEqual") return `${left} !== ${right}`;
      return `${left} ${comparisonOperator(step.test)} ${right}`;
    }
    if (step.evidence.kind === "Instance" || step.evidence.kind === "Structural") {
      const dictionary = this.#emitEvidence(
        step.evidence,
        constraint,
        step.span,
        evidenceNames,
      );
      if (step.test === "Equal") return `${dictionary}.equals(${left}, ${right})`;
      if (step.test === "NotEqual") return `${dictionary}.notEquals(${left}, ${right})`;
      return comparisonFromOrdering(step.test, `${dictionary}.compare(${left}, ${right})`);
    }

    const instance = step.evidence.instance;
    if (step.test === "Equal" || step.test === "NotEqual") {
      let equality: string;
      if (instance === "Float") {
        equality = `${this.#useHelper("floatEquals")}(${left}, ${right})`;
      } else {
        equality = `${left} === ${right}`;
      }
      return step.test === "Equal" ? equality : `!(${equality})`;
    }

    // The primitive fast path (§5.1 codegen): no dictionary stands between the
    // comparator and its consumer, so the sign is consumed where it is made and
    // never becomes an observable `compare` result. §5.1's constructor tests
    // and this sign test agree by construction.
    if (instance === "Float") {
      return comparisonFromSign(
        step.test,
        `${this.#useHelper("compareFloat")}(${left}, ${right})`,
      );
    }
    if (instance === "String") {
      return comparisonFromSign(
        step.test,
        `${this.#useHelper("compareString")}(${left}, ${right})`,
      );
    }
    return `${left} ${comparisonOperator(step.test)} ${right}`;
  }

  /**
   * The evidence-at-a-non-function paths, retired per closure doc §13.6.
   *
   * On an already-diagnosed module: silence. The checker has made this
   * variable's real report, and a second one phrased as an emission failure is
   * the duplicate the ruling struck.
   *
   * On a checker-clean module: an evidence lookup that finds nothing is a
   * compiler defect, not the author's mistake — the checker either resolves the
   * variable or reports it. The message says exactly that and no more. It
   * deliberately does **not** cite §13.6's non-function guarantee: this helper
   * also serves `#dictionary`'s general path, which handles function-typed
   * values and derived `Eq`/`Hash` evidence that the guarantee never spoke to,
   * and round 5 caught the earlier wording claiming it for all of them.
   *
   * The ruling permits an assertion here. **This does not throw, on purpose.** Every review round of this arc has found a residual hole in the
   * previous round's fix, and turning an unknown remaining hole into a hard
   * crash would trade a wrong diagnostic for a dead compiler. It reports
   * instead, in terms that can only be read as a compiler bug. If a later round
   * establishes the invariant holds under adversarial search, this is the line
   * to harden.
   */
  #reportUnreachableEvidence(detail: string, span: Core.Expr["span"]): void {
    if (this.#alreadyDiagnosed) return;
    this.#diagnostics.add({
      severity: "error",
      message:
        `internal compiler error: ${detail}, on a module the checker accepted. ` +
        "This is a defect in the compiler, not in your program; please report it",
      primary: span,
    });
  }

  #dictionary(
    variable: Typed.TypeVariableId,
    constraint: Typed.ConstraintName,
    span: Core.Expr["span"],
    evidenceNames: EvidenceNames,
    path: readonly string[] = [],
  ): string {
    const name = evidenceNames.get(evidenceKey(variable, constraint));
    if (name !== undefined) {
      return path.reduce((dictionary, slot) => `${dictionary}.${slot}`, name);
    }
    // Retired as a user diagnostic, scoped per closure doc §13.6. On a module
    // the checker already rejected, this variable's real report has been made —
    // the defaulting/ambiguity error for `let g = Some(describe)`, which names
    // the rewrite — and repeating it here as an emission failure told the author
    // nothing and blamed a pass they cannot see. Emit best-effort into a module
    // the project has already rejected and say nothing.
    this.#reportUnreachableEvidence(
      `missing \`${constraint}\` evidence during JavaScript emission`,
      span,
    );
    return "undefined";
  }

  /** Selects direct Eq evidence or the nested Eq base constraint of Hash. */
  #equalityDictionary(
    variable: Typed.TypeVariableId,
    evidenceNames: EvidenceNames,
  ): string {
    if (evidenceNames.has(evidenceKey(variable, "Eq"))) {
      return this.#dictionary(variable, "Eq", this.#module.span, evidenceNames);
    }
    return `${this.#dictionary(variable, "Hash", this.#module.span, evidenceNames)}.eq`;
  }

  /**
   * The members of a derived instance.
   *
   * The body expands the subject **one level** — its own fields, or its
   * constructors' slots — and renders each component from the evidence the
   * checker selected for it (#278). It does not re-walk the component's type:
   * that is what silently ignored a hand-written component instance and read
   * through `opaque`, and `spec/products.md` §2.5's implementer note now pins
   * the rule the checker already followed.
   *
   * `Hash` is the one member still walked structurally, and it is licensed to
   * be: `Hash` cannot be hand-written, and deriving it requires derived `Eq`
   * (Collections Part 2 §4.3), so every type reachable from a `Hash` subject
   * has derived equality and the structural answer *is* the instance's answer.
   */
  #derivedMembers(item: Core.HonorItem, evidenceNames: EvidenceNames): readonly string[] {
    const subject = item.subject;
    const components = componentEvidence(item.components);
    const equals = (left: string, right: string): string =>
      this.#derivedEquals(subject, left, right, evidenceNames, false, components);
    if (item.constraint === "Eq") {
      return [
        `equals: (__hex_left, __hex_right) => ${equals("__hex_left", "__hex_right")}`,
        `notEquals: (__hex_left, __hex_right) => !(${equals("__hex_left", "__hex_right")})`,
      ];
    }
    if (item.constraint === "Show") {
      return [
        `show: __hex_value => ${this.#derivedShow(subject, "__hex_value", evidenceNames, components)}`,
      ];
    }
    if (item.constraint === "Ord") {
      return [
        `compare: (__hex_left, __hex_right) => ${this.#derivedCompare(
          subject,
          "__hex_left",
          "__hex_right",
          evidenceNames,
          components,
        )}`,
      ];
    }
    return [
      `hash: __hex_value => ${this.#derivedHash(subject, "__hex_value", evidenceNames)}`,
    ];
  }

  /**
   * The evidence for one component position, or `undefined` to keep the inline
   * arm (#278).
   *
   * A caller in the evidence-directed mode that finds no entry is a compiler
   * defect — the checker enumerated the components and emission is expanding
   * the same declaration — and it would silently reinstate the structural
   * re-derivation, so it says so rather than passing quietly.
   */
  #componentEvidenceAt(
    components: ComponentEvidence,
    key: string,
  ): Core.Evidence | undefined {
    if (components === undefined) return undefined;
    const evidence = components.get(key);
    if (evidence === undefined) {
      this.#reportUnreachableEvidence(
        `no component evidence for \`${key}\` during JavaScript emission`,
        this.#module.span,
      );
    }
    return evidence;
  }

  /** Builds law-preserving hashes from the same structural components as derived Eq. */
  #derivedHash(type: Typed.Type, value: string, evidenceNames: EvidenceNames): string {
    if (type.kind === "Primitive") return `${this.#useHelper("stableHash")}(${value})`;
    if (type.kind === "Variable") {
      return `${this.#dictionary(type.id, "Hash", this.#module.span, evidenceNames)}.hash(${value})`;
    }
    const combine = (parts: readonly string[]): string =>
      parts.reduce(
        (seed, part) => `${this.#useHelper("mixHash")}(${seed}, ${part})`,
        "0",
      );
    if (type.kind === "Tuple") {
      return combine(type.elements.map((element, index) =>
        this.#derivedHash(element, `${value}[${index}]`, evidenceNames)
      ));
    }
    if (type.kind === "Vector") {
      const elementHash = this.#derivedHash(type.element, "__hex_element", evidenceNames);
      return `(() => { let __hex_hash = 0; for (const __hex_element of ${value}) __hex_hash = ${this.#useHelper("mixHash")}(__hex_hash, ${elementHash}); return __hex_hash; })()`;
    }
    if (type.kind === "Set") {
      const dictionary = type.element.kind === "Variable"
        ? this.#dictionary(type.element.id, "Hash", this.#module.span, evidenceNames)
        : this.#emitEvidence({ kind: "Structural", type: type.element, components: [] }, "Hash", this.#module.span, evidenceNames);
      return `${this.#useHelper("persistentCollections")}.setHash(${dictionary}, ${this.#useHelper("mixHash")})(${value})`;
    }
    if (type.kind === "Map") {
      const key = type.key.kind === "Variable"
        ? this.#dictionary(type.key.id, "Hash", this.#module.span, evidenceNames)
        : this.#emitEvidence({ kind: "Structural", type: type.key, components: [] }, "Hash", this.#module.span, evidenceNames);
      const item = type.value.kind === "Variable"
        ? this.#dictionary(type.value.id, "Hash", this.#module.span, evidenceNames)
        : this.#emitEvidence({ kind: "Structural", type: type.value, components: [] }, "Hash", this.#module.span, evidenceNames);
      return `${this.#useHelper("persistentCollections")}.mapHash(${key}, ${item}, ${this.#useHelper("mixHash")})(${value})`;
    }
    if (type.kind === "Record") {
      return combine([...type.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) =>
        this.#derivedHash(field.type, `${value}.${field.name}`, evidenceNames)
      ));
    }
    if (type.kind === "NominalRecord") {
      const record = this.#module.records.find(({ id }) => id === type.record);
      if (record === undefined) return "0";
      const replacements = new Map(record.parameters.map((parameter, index) => [
        parameter,
        type.arguments[index] ?? { kind: "Error" as const },
      ]));
      return combine([...record.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) =>
        this.#derivedHash(substituteType(field.type, replacements), `${value}.${field.name}`, evidenceNames)
      ));
    }
    if (type.kind === "Union") {
      const union = this.#module.unions.find(({ id }) => id === type.union);
      if (union === undefined) return "0";
      const tagged = union.constructors.some(({ slots }) => slots.length > 0);
      if (!tagged) return `${this.#useHelper("stableHash")}(${value})`;
      const replacements = new Map(union.parameters.map((parameter, index) => [
        parameter,
        type.arguments[index] ?? { kind: "Error" as const },
      ]));
      const cases = union.constructors.map((constructor) => {
        const parts = [
          `${this.#useHelper("stableHash")}(${JSON.stringify(constructor.name)})`,
          ...constructor.slots.map((slot) => this.#derivedHash(
            substituteType(slot.type, replacements),
            `${value}.${slot.field}`,
            evidenceNames,
          )),
        ];
        return `case ${JSON.stringify(constructor.name)}: return ${combine(parts)};`;
      }).join(" ");
      return `(() => { switch (${value}.tag) { ${cases} default: return 0; } })()`;
    }
    return "0";
  }

  /**
   * One component of a derived or structural `compare` (#278).
   *
   * `Instance` dispatches — always, whether that instance is hand-written or
   * derived; the container never re-derives it. `Structural` recurses one level
   * carrying its own component selection. `Primitive`, `Dictionary` and `Error`
   * keep the inline arms of `#derivedCompare`: the licensed primitive shortcut,
   * the type-variable dictionary parameter a factory already receives, and the
   * best-effort fallback on a module the checker rejected.
   */
  #componentCompare(
    type: Typed.Type,
    left: string,
    right: string,
    evidenceNames: EvidenceNames,
    evidence: Core.Evidence | undefined,
  ): string {
    if (evidence?.kind === "Instance") {
      const dictionary = this.#emitEvidence(evidence, "Ord", this.#module.span, evidenceNames);
      return `${dictionary}.compare(${left}, ${right})`;
    }
    const components = evidence?.kind === "Structural"
      ? componentEvidence(evidence.components)
      : undefined;
    return this.#derivedCompare(type, left, right, evidenceNames, components);
  }

  /**
   * The body of a derived `compare`, in the one representation (#275).
   *
   * Every expression this returns evaluates to an `Ordering` — the Unions §6.2
   * name-string `"Less"`, `"Equal"` or `"Greater"` — because that is what a
   * dictionary's `compare` slot holds regardless of how the instance was
   * written. It is also what the recursive calls below receive from each other
   * and what the `Variable` case receives from another dictionary, so
   * composition is on the strings and never on a sign.
   *
   * Bare string literals rather than imported `Ordering` constructors: this is
   * the representation, emitted the same way every other all-nullary union
   * value is, and naming the constructors here would drag a synthesized prelude
   * import into every deriving module. A hand-written `honor` still imports
   * them, because its source names them.
   *
   * The numeric comparators survive as internals. `compareFloat`'s total order
   * over NaN and `compareString`'s codepoint order are unchanged; only the
   * final step from sign to constructor is new, and `ordering` is the single
   * place it happens.
   *
   * `components` (#278) carries the checker's per-component selection: this
   * expands `type` one level and hands each position to `#componentCompare`.
   */
  #derivedCompare(
    type: Typed.Type,
    left: string,
    right: string,
    evidenceNames: EvidenceNames,
    components: ComponentEvidence = undefined,
  ): string {
    const fromSign = (sign: string): string => `${this.#useHelper("ordering")}(${sign})`;
    const component = (
      key: string,
      componentType: Typed.Type,
      componentLeft: string,
      componentRight: string,
    ): string =>
      this.#componentCompare(
        componentType,
        componentLeft,
        componentRight,
        evidenceNames,
        this.#componentEvidenceAt(components, key),
      );
    if (type.kind === "Primitive") {
      if (type.name === "Float") {
        return fromSign(`${this.#useHelper("compareFloat")}(${left}, ${right})`);
      }
      if (type.name === "String") {
        return fromSign(`${this.#useHelper("compareString")}(${left}, ${right})`);
      }
      return `${left} < ${right} ? "Less" : ${left} > ${right} ? "Greater" : "Equal"`;
    }
    if (type.kind === "Variable") {
      return `${this.#dictionary(type.id, "Ord", this.#module.span, evidenceNames)}.compare(${left}, ${right})`;
    }
    if (type.kind === "Tuple") {
      return lexicographicComparison(type.elements.map((element, index) =>
        component(String(index), element, `${left}[${index}]`, `${right}[${index}]`)
      ));
    }
    if (type.kind === "Vector") {
      const elementOrder = component(
        "element",
        type.element,
        `${left}[__hex_index]`,
        `${right}[__hex_index]`,
      );
      return `(() => { const __hex_length = Math.min(${left}.length, ${right}.length); for (let __hex_index = 0; __hex_index < __hex_length; __hex_index += 1) { const __hex_order = ${elementOrder}; if (__hex_order !== "Equal") return __hex_order; } return ${fromSign(`${left}.length - ${right}.length`)}; })()`;
    }
    if (type.kind === "Record") {
      return lexicographicComparison(
        [...type.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) =>
          component(field.name, field.type, `${left}.${field.name}`, `${right}.${field.name}`)
        ),
      );
    }
    if (type.kind === "NominalRecord") {
      const record = this.#module.records.find(({ id }) => id === type.record);
      if (record === undefined) return '"Equal"';
      const replacements = new Map(record.parameters.map((parameter, index) => [
        parameter,
        type.arguments[index] ?? { kind: "Error" as const },
      ]));
      return lexicographicComparison(
        [...record.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) =>
          component(
            field.name,
            substituteType(field.type, replacements),
            `${left}.${field.name}`,
            `${right}.${field.name}`,
          )
        ),
      );
    }
    if (type.kind === "Union") {
      const union = this.#module.unions.find(({ id }) => id === type.union);
      if (union === undefined) return '"Equal"';
      // Under the pin (#147) the declaration-index table the string case needs
      // is unnecessary: `False | True` and JS `false < true` agree by
      // construction, so ordering reads the booleans themselves.
      if (this.#prelude.bool !== undefined && union.id === this.#prelude.bool) {
        return `${left} === ${right} ? "Equal" : ${right} ? "Less" : "Greater"`;
      }
      // Declaration-index order (Unions §7's implementer note for the §6.2
      // string case), never JS `<` on the name-strings: the index difference is
      // the sign, and `ordering` makes it the constructor.
      const tag = (value: string) => union.constructors
        .map((constructor, index) => `${value} === ${JSON.stringify(constructor.name)} ? ${index} : `)
        .join("") + "-1";
      const tagged = union.constructors.some(({ slots }) => slots.length > 0);
      if (!tagged) return fromSign(`(${tag(left)}) - (${tag(right)})`);
      const replacements = new Map(union.parameters.map((parameter, index) => [
        parameter,
        type.arguments[index] ?? { kind: "Error" as const },
      ]));
      const cases = union.constructors.map((constructor) => {
        const comparison = lexicographicComparison(constructor.slots.map((slot) =>
          component(
            `${constructor.name}.${slot.field}`,
            substituteType(slot.type, replacements),
            `${left}.${slot.field}`,
            `${right}.${slot.field}`,
          )
        ));
        return `case ${JSON.stringify(constructor.name)}: return ${comparison};`;
      }).join(" ");
      return `(() => { const __hex_tagOrder = ${fromSign(`(${tag(`${left}.tag`)}) - (${tag(`${right}.tag`)})`)}; if (__hex_tagOrder !== "Equal") return __hex_tagOrder; switch (${left}.tag) { ${cases} default: return "Equal"; } })()`;
    }
    return '"Equal"';
  }

  /**
   * A whole dictionary for one component, for the `Set`/`Map` runtime helpers,
   * which take a dictionary rather than an inline expression.
   *
   * The checker's selection when there is one (#278), so a `Map`'s values are
   * compared by their own `Eq` instance; otherwise the structural dictionary
   * this used to build unconditionally.
   */
  #subDictionary(
    components: ComponentEvidence,
    key: string,
    constraint: Typed.ConstraintName,
    type: Typed.Type,
    evidenceNames: EvidenceNames,
  ): string {
    const evidence = this.#componentEvidenceAt(components, key) ??
      ({ kind: "Structural", type, components: [] } as const);
    return this.#emitEvidence(evidence, constraint, this.#module.span, evidenceNames);
  }

  /** One component of a derived or structural `equals`; see `#componentCompare`. */
  #componentEquals(
    type: Typed.Type,
    left: string,
    right: string,
    evidenceNames: EvidenceNames,
    hashBacked: boolean,
    evidence: Core.Evidence | undefined,
  ): string {
    if (evidence?.kind === "Instance") {
      const dictionary = this.#emitEvidence(evidence, "Eq", this.#module.span, evidenceNames);
      return `${dictionary}.equals(${left}, ${right})`;
    }
    const components = evidence?.kind === "Structural"
      ? componentEvidence(evidence.components)
      : undefined;
    return this.#derivedEquals(type, left, right, evidenceNames, hashBacked, components);
  }

  #derivedEquals(
    type: Typed.Type,
    left: string,
    right: string,
    evidenceNames: EvidenceNames,
    hashBacked = false,
    // Always `undefined` when `hashBacked`: that mode renders the `eq` slot of a
    // *structural `Hash`* dictionary, which the note licenses to stay
    // structural, and whose components the checker raised as `Hash` rather than
    // `Eq` anyway.
    components: ComponentEvidence = undefined,
  ): string {
    const component = (
      key: string,
      componentType: Typed.Type,
      componentLeft: string,
      componentRight: string,
    ): string =>
      this.#componentEquals(
        componentType,
        componentLeft,
        componentRight,
        evidenceNames,
        hashBacked,
        hashBacked ? undefined : this.#componentEvidenceAt(components, key),
      );
    if (type.kind === "Primitive") {
      return type.name === "Float"
        ? `${this.#useHelper("floatEquals")}(${left}, ${right})`
        : `${left} === ${right}`;
    }
    if (type.kind === "Variable") {
      const dictionary = hashBacked
        ? `${this.#dictionary(type.id, "Hash", this.#module.span, evidenceNames)}.eq`
        : this.#equalityDictionary(type.id, evidenceNames);
      return `${dictionary}.equals(${left}, ${right})`;
    }
    if (type.kind === "Tuple") {
      return type.elements.map((element, index) =>
        component(String(index), element, `${left}[${index}]`, `${right}[${index}]`)
      ).join(" && ") || "true";
    }
    if (type.kind === "Vector") {
      const elementEquals = component(
        "element",
        type.element,
        `${left}[__hex_index]`,
        `${right}[__hex_index]`,
      );
      return `${left}.length === ${right}.length && (() => { for (let __hex_index = 0; __hex_index < ${left}.length; __hex_index += 1) if (!(${elementEquals})) return false; return true; })()`;
    }
    if (type.kind === "Set") {
      // `Hash`, so the structural walk stands where no selection was recorded.
      const hash = type.element.kind === "Variable"
        ? this.#dictionary(type.element.id, "Hash", this.#module.span, evidenceNames)
        : this.#subDictionary(components, "element", "Hash", type.element, evidenceNames);
      return `${this.#useHelper("persistentCollections")}.setEquals(${hash})(${left}, ${right})`;
    }
    if (type.kind === "Map") {
      const hash = type.key.kind === "Variable"
        ? this.#dictionary(type.key.id, "Hash", this.#module.span, evidenceNames)
        : this.#subDictionary(components, "key", "Hash", type.key, evidenceNames);
      const equals = type.value.kind === "Variable"
        ? hashBacked
          ? `${this.#dictionary(type.value.id, "Hash", this.#module.span, evidenceNames)}.eq`
          : this.#equalityDictionary(type.value.id, evidenceNames)
        : this.#subDictionary(
            hashBacked ? undefined : components,
            "value",
            "Eq",
            type.value,
            evidenceNames,
          );
      return `${this.#useHelper("persistentCollections")}.mapEquals(${hash}, ${equals})(${left}, ${right})`;
    }
    if (type.kind === "Record") {
      return type.fields.map((field) =>
        component(field.name, field.type, `${left}.${field.name}`, `${right}.${field.name}`)
      ).join(" && ") || "true";
    }
    if (type.kind === "NominalRecord") {
      const record = this.#module.records.find(({ id }) => id === type.record);
      if (record === undefined) return `${left} === ${right}`;
      const replacements = new Map(record.parameters.map((parameter, index) => [
        parameter,
        type.arguments[index] ?? { kind: "Error" as const },
      ]));
      return record.fields.map((field) =>
        component(
          field.name,
          substituteType(field.type, replacements),
          `${left}.${field.name}`,
          `${right}.${field.name}`,
        )
      ).join(" && ") || "true";
    }
    if (type.kind === "Union") {
      const union = this.#module.unions.find(({ id }) => id === type.union);
      if (union === undefined) return `${left} === ${right}`;
      const tagged = union.constructors.some(({ slots }) => slots.length > 0);
      if (!tagged) return `${left} === ${right}`;
      const replacements = new Map(union.parameters.map((parameter, index) => [
        parameter,
        type.arguments[index] ?? { kind: "Error" as const },
      ]));
      const cases = union.constructors.map((constructor) => {
        const fields = constructor.slots.map((slot) =>
          component(
            `${constructor.name}.${slot.field}`,
            substituteType(slot.type, replacements),
            `${left}.${slot.field}`,
            `${right}.${slot.field}`,
          )
        ).join(" && ") || "true";
        return `case ${JSON.stringify(constructor.name)}: return ${fields};`;
      }).join(" ");
      return `${left}.tag === ${right}.tag && (() => { switch (${left}.tag) { ${cases} default: return false; } })()`;
    }
    return `${left} === ${right}`;
  }

  /** One component of a derived or structural `show`; see `#componentCompare`. */
  #componentShow(
    type: Typed.Type,
    value: string,
    evidenceNames: EvidenceNames,
    evidence: Core.Evidence | undefined,
  ): string {
    if (evidence?.kind === "Instance") {
      const dictionary = this.#emitEvidence(evidence, "Show", this.#module.span, evidenceNames);
      return `${dictionary}.show(${value})`;
    }
    const components = evidence?.kind === "Structural"
      ? componentEvidence(evidence.components)
      : undefined;
    return this.#derivedShow(type, value, evidenceNames, components);
  }

  #derivedShow(
    type: Typed.Type,
    value: string,
    evidenceNames: EvidenceNames,
    components: ComponentEvidence = undefined,
  ): string {
    const component = (key: string, componentType: Typed.Type, componentValue: string): string =>
      this.#componentShow(
        componentType,
        componentValue,
        evidenceNames,
        this.#componentEvidenceAt(components, key),
      );
    if (type.kind === "Primitive") {
      if (type.name === "String") return value;
      return `String(${value})`;
    }
    if (type.kind === "Variable") {
      return `${this.#dictionary(type.id, "Show", this.#module.span, evidenceNames)}.show(${value})`;
    }
    if (type.kind === "Tuple") {
      const elements = type.elements.map((element, index) =>
        component(String(index), element, `${value}[${index}]`)
      );
      return elements.length === 0
        ? '"()"'
        : `"(" + ${elements.join(' + ", " + ')} + ")"`;
    }
    if (type.kind === "Vector") {
      const shown = component("element", type.element, "__hex_element");
      return `"[" + ${value}.map(__hex_element => ${shown}).join(", ") + "]"`;
    }
    if (type.kind === "Set") {
      const shown = component("element", type.element, "__hex_element");
      return `${value}.size === 0 ? "Set.empty" : "Set.fromVector([" + [...${value}].map(__hex_element => ${shown}).join(", ") + "])"`;
    }
    if (type.kind === "Map") {
      const key = component("key", type.key, "__hex_entry[0]");
      const item = component("value", type.value, "__hex_entry[1]");
      return `${value}.size === 0 ? "Map.empty" : "Map.fromVector([" + [...${value}].map(__hex_entry => "(" + ${key} + ", " + ${item} + ")").join(", ") + "])"`;
    }
    if (type.kind === "Record") {
      const fields = [...type.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) =>
        `${JSON.stringify(`${field.name} = `)} + ${component(
          field.name,
          field.type,
          `${value}.${field.name}`,
        )}`
      );
      return fields.length === 0 ? '"{}"' : `"{" + ${fields.join(' + ", " + ')} + "}"`;
    }
    if (type.kind === "NominalRecord") {
      const record = this.#module.records.find(({ id }) => id === type.record);
      if (record !== undefined) {
        const replacements = new Map(record.parameters.map((parameter, index) => [
          parameter,
          type.arguments[index] ?? { kind: "Error" as const },
        ]));
        const fields = [...record.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) =>
          `${JSON.stringify(`${field.name} = `)} + ${component(
            field.name,
            substituteType(field.type, replacements),
            `${value}.${field.name}`,
          )}`
        );
        return fields.length === 0
          ? '"{}"'
          : `"{" + ${fields.join(` + ", " + `)} + "}"`;
      }
    }
    if (type.kind === "Union") {
      const union = this.#module.unions.find(({ id }) => id === type.union);
      if (union !== undefined) {
        // The all-nullary case shows itself, because its representation already
        // *is* its constructor name. The pinned `Bool` is the one union where
        // that is not so, so it needs the two-way lookup (#147, §3.2).
        //
        // Parenthesized, and that is not cosmetic: every other branch here
        // returns something safe to drop into the `+`-concatenation a composite
        // show builds, and `+` binds tighter than `?:`. Bare, the accumulated
        // string prefix became the ternary's condition, so a record containing a
        // `Bool` displayed as `"True"` — the wrong value, silently. Caught in
        // review of the commit that introduced it.
        if (this.#prelude.bool !== undefined && union.id === this.#prelude.bool) {
          return `(${value} ? "True" : "False")`;
        }
        const tagged = union.constructors.some(({ slots }) => slots.length > 0);
        if (!tagged) return value;
        const replacements = new Map(union.parameters.map((parameter, index) => [
          parameter,
          type.arguments[index] ?? { kind: "Error" as const },
        ]));
        const cases = union.constructors.map((constructor) => {
          const payload = constructor.slots.map((slot) =>
            component(
              `${constructor.name}.${slot.field}`,
              substituteType(slot.type, replacements),
              `${value}.${slot.field}`,
            )
          );
          const shown = payload.length === 0
            ? JSON.stringify(constructor.name)
            : `${JSON.stringify(`${constructor.name}(`)} + ${payload.join(' + ", " + ')} + ")"`;
          return `case ${JSON.stringify(constructor.name)}: return ${shown};`;
        }).join(" ");
        return `(() => { switch (${value}.tag) { ${cases} default: return "<unknown>"; } })()`;
      }
    }
    return `JSON.stringify(${value})`;
  }

  #emitEvidence(
    evidence: Core.Evidence,
    constraint: Typed.ConstraintName,
    span: Core.Expr["span"],
    evidenceNames: EvidenceNames,
  ): string {
    if (evidence.kind === "Dictionary") {
      return this.#dictionary(
        evidence.variable,
        evidence.constraint ?? constraint,
        span,
        evidenceNames,
        evidence.path,
      );
    }
    if (evidence.kind === "Primitive") {
      return primitiveDictionary(
        constraint,
        evidence.instance,
        (helper) => this.#useHelper(helper),
      );
    }
    if (evidence.kind === "Structural") {
      // The direct structural use site — `v1 == v2` at `Vector(Metre)`, a tuple
      // compared inline — runs the same walk a `derives` body does, so it takes
      // the same component selection (#278). Without it these bypassed a
      // hand-written component instance exactly as a container's did.
      const components = componentEvidence(evidence.components);
      if (constraint === "Hash") {
        const equals = this.#derivedEquals(evidence.type, "__hex_left", "__hex_right", evidenceNames, true);
        return `({ eq: { equals: (__hex_left, __hex_right) => ${equals}, notEquals: (__hex_left, __hex_right) => !(${equals}) }, hash: __hex_value => ${this.#derivedHash(evidence.type, "__hex_value", evidenceNames)} })`;
      }
      if (constraint === "Eq") {
        const equals = this.#derivedEquals(evidence.type, "__hex_left", "__hex_right", evidenceNames, false, components);
        return `({ equals: (__hex_left, __hex_right) => ${equals}, notEquals: (__hex_left, __hex_right) => !(${equals}) })`;
      }
      if (constraint === "Ord") {
        return `({ compare: (__hex_left, __hex_right) => ${this.#derivedCompare(evidence.type, "__hex_left", "__hex_right", evidenceNames, components)} })`;
      }
      if (constraint === "Show") {
        return `({ show: __hex_value => ${this.#derivedShow(evidence.type, "__hex_value", evidenceNames, components)} })`;
      }
      if (constraint === "Concat" && evidence.type.kind === "Vector") {
        return "({ concat: (__hex_left, __hex_right) => [...__hex_left, ...__hex_right] })";
      }
      return "({})";
    }
    if (evidence.kind === "Instance") {
      // The use that decides whether a prelude instance needs an import (#153).
      this.#referencedDictionaries.add(evidence.dictionary);
      const arguments_ = evidence.arguments.map((argument) =>
        this.#emitEvidence(
          argument.evidence,
          argument.constraint,
          span,
          evidenceNames,
        )
      );
      return arguments_.length === 0
        ? evidence.dictionary
        : `${evidence.dictionary}(${arguments_.join(", ")})`;
    }
    return "undefined";
  }

  #identifier(symbol: Resolved.SymbolId, sourceName: string): string {
    return isSafeIdentifier(sourceName) ? sourceName : `__hex_binding${Number(symbol)}`;
  }

  /**
   * `import` lines for the prelude instances this module's body actually uses
   * (#153).
   *
   * The whole point of the channel is that availability costs nothing: a module
   * with `Ordering` in scope emits no import, and one that compares two of them
   * emits exactly one, pointed at the module that *declares* the dictionary
   * rather than at whatever intermediate happened to re-export it.
   *
   * Two properties this must keep:
   *
   * - **No re-export.** `#exportEvidence` is deliberately not called. Prelude
   *   evidence is reachable from every module directly, so a consumer never has
   *   to ask an intermediate for it — and the transit chain that made `#153`'s
   *   defect intermittently invisible does not re-form.
   * - **Deterministic order.** `preludeInstances` arrives in normative prelude
   *   order and is filtered, never sorted, so the output is a function of the
   *   prelude list and not of evidence-discovery order during rendering.
   *
   * One statement per entry rather than one per specifier: a prelude module may
   * already be imported for its *terms* by the synthesized import, and merging
   * into that item would need a second rendering pass to know what to merge.
   * Duplicate `import` statements from one specifier are ordinary ESM.
   *
   * The `#importedInstanceLocals` filter has nothing left to filter here, and
   * is kept as the invariant it asserts rather than as a live case. No import
   * item can bind one of these locals any more: a synthesized import carries no
   * instances (#153) and an explicit import of a prelude module carries none
   * either (#263), so the only remaining `Import` instances name non-prelude
   * modules, whose dictionaries this channel never offers. Were an import item
   * to bind one, both sides would build the local from the same file id and the
   * same dictionary — character-for-character equal — and emitting both is
   * `SyntaxError: Identifier has already been declared` at load, after a clean
   * compile. The import item would own the emission.
   */
  /**
   * `import` lines for the constraint plumbing this module reaches in another
   * module: member forwarders it calls, and default helpers its instances
   * inherit (Constraints §6.5).
   *
   * Decided after rendering, like the prelude channels. Importing a constraint
   * puts every member in scope (Modules §3.1) whether or not the module calls
   * them, so the name list here is what the body reached, never what the
   * resolver bound — the same discipline #263 applied to companion candidates.
   *
   * The names are deduplicated per specifier because a module may reach one
   * constraint by two routes (a named import beside an `import * as`), and two
   * `import` statements binding the same identifier is a `SyntaxError` at load,
   * after a clean compile.
   */
  #constraintMemberImports(): readonly string[] {
    return this.#constraintImports.flatMap((item) => {
      const names = new Set<string>();
      if (item.form.kind !== "Effect") {
        for (const { imported, symbol, constraintMember } of item.form.names) {
          if (constraintMember !== true || symbol === undefined) continue;
          if (!this.#referencedSymbols.has(symbol)) continue;
          const local = this.#constrainedImports.get(symbol) ?? imported;
          const source = internalConstrainedExportName(symbol);
          names.add(source === local ? source : `${source} as ${local}`);
        }
      }
      for (const { declaration } of item.constraints) {
        for (const member of declaration.members) {
          if (!this.#usedDefaultHelpers.has(member.binding.symbol)) continue;
          names.add(defaultHelperName(member.binding.symbol));
        }
      }
      if (names.size === 0) return [];
      return [`import { ${[...names].join(", ")} } from ${
        JSON.stringify(emittedModuleSpecifier(item.specifier))
      };`];
    });
  }

  #preludeInstanceImports(): readonly {
    readonly line: string;
    readonly specifier: string;
  }[] {
    return this.#module.preludeInstances
      .filter(({ localDictionary }) =>
        this.#referencedDictionaries.has(localDictionary) &&
        !this.#importedInstanceLocals.has(localDictionary)
      )
      .map(({ importedDictionary, localDictionary, specifier }) => {
        const binding = importedDictionary === localDictionary
          ? importedDictionary
          : `${importedDictionary} as ${localDictionary}`;
        return {
          line: `import { ${binding} } from ${
            JSON.stringify(emittedModuleSpecifier(specifier))
          };`,
          specifier,
        };
      });
  }

  /**
   * `import` lines for the prelude *terms* this module's body actually names
   * (#263) — the synthesized import items, rendered from what the elaborated
   * Core referenced instead of from what the resolver predicted.
   *
   * The resolver's name list is an over-approximation and has to be: whether
   * `x.f(y)` is a companion dispatch or a call of a function-valued field
   * depends on the receiver's type, which the checker decides long after that
   * list is built, so `#noteCompanionCandidate` registers the candidate from
   * syntax alone and fails towards the spare name. Filtering here is the same
   * structural move `#preludeInstanceImports` makes: the resolver decides
   * *availability*, emission decides what is imported, and neither is inferred
   * from the other. It is sound only for a synthesized item — an explicit
   * import's names were asked for by the source, and are emitted whether the
   * body names them or not.
   *
   * A synthesized item with no surviving name emits nothing at all. It must not
   * fall through to `import "./Seq.js";`: a bare side-effect import is a
   * load-order dependency the source never wrote, and it would keep the module
   * in the emitted graph — which is the whole cost this filter removes.
   */
  #preludeTermImports(): readonly {
    readonly line: string;
    readonly specifier: string;
  }[] {
    return this.#synthesizedImports.flatMap((item) => {
      // `#preludeImport` builds nothing else; the other forms have no seat here.
      if (item.form.kind !== "Named") return [];
      const names = item.form.names.flatMap(({ imported, local, symbol, typeOnly }) => {
        if (symbol === undefined || !this.#referencedSymbols.has(symbol)) return [];
        // A pinned `Bool` constructor is emitted as its literal (#147), so the
        // import that would bind it has nothing to bind.
        if (this.#pinnedBoolLiteral(symbol) !== undefined) return [];
        if (typeOnly === true) return [];
        // The local, never the imported name: a module that binds `map` itself
        // reaches the prelude's under a distinguished local (Modules §6.4), and
        // spelling the imported name here would redeclare its binding.
        const source = this.#constrainedImports.has(symbol)
          ? internalConstrainedExportName(symbol)
          : imported;
        return [source === local ? source : `${source} as ${local}`];
      });
      if (names.length === 0) return [];
      return [{
        line: `import { ${names.join(", ")} } from ${
          JSON.stringify(emittedModuleSpecifier(item.specifier))
        };`,
        specifier: item.specifier,
      }];
    });
  }

  #exportEvidence(dictionary: string): void {
    if (this.#exportedEvidence.has(dictionary)) return;
    this.#exportedEvidence.add(dictionary);
    this.#exports.push(`export { ${dictionary} };`);
  }

  /**
   * The pinned JS literal a `Bool` constructor denotes, or `undefined` if this
   * symbol is not one of the prelude `Bool`'s two constructors (#147).
   *
   * This is the whole of the representation pin at the value level: `True` is
   * `true`, `False` is `false`, and every place that would otherwise spell an
   * all-nullary constructor as its own name-string asks here first.
   */
  #pinnedBoolLiteral(symbol: Resolved.SymbolId): "true" | "false" | undefined {
    const metadata = this.#constructors.get(symbol);
    if (metadata === undefined || !metadata.pinnedBool) return undefined;
    return metadata.constructor.name === "True" ? "true" : "false";
  }

  /**
   * Whether this is the prelude `Seq` — the one type the emitter bridges at the
   * boundary. A record a *user* declares as `Seq` is an ordinary value and is
   * deliberately not matched: identity, never the spelling.
   */
  #isSequence(type: Typed.Type): boolean {
    return this.#prelude.seq !== undefined &&
      type.kind === "NominalRecord" &&
      type.record === this.#prelude.seq;
  }

  /**
   * A record literal, with `extra` appended verbatim as a final property when
   * the construction carries something the source fields do not — which today
   * is exactly `Seq`'s boundary traversal method (FFI Part 3 §9.4).
   */
  #emitRecordLiteral(
    expression: Core.RecordExpr,
    depth: number,
    evidenceNames: EvidenceNames,
    extra?: string,
  ): string {
    return `{ ${[
      ...(expression.spread === undefined
        ? []
        : [`...${this.#emitExpr(expression.spread, depth, evidenceNames)}`]),
      ...expression.fields.map((field) =>
        objectProperty(
          field.name,
          this.#emitExpr(field.value, depth, evidenceNames),
        )
      ),
      ...(extra === undefined ? [] : [extra]),
    ].join(", ")} }`;
  }

  /** The trailing evidence arguments a constrained callee expects (Constraints §6.1). */
  #evidenceArguments(
    evidence: readonly Core.CallEvidence[],
    span: Source.Span,
    evidenceNames: EvidenceNames,
  ): readonly string[] {
    return evidence.map(({ constraint, value }) => {
      if (value.kind === "Dictionary") {
        return this.#dictionary(
          value.variable,
          value.constraint ?? constraint,
          span,
          evidenceNames,
          value.path,
        );
      }
      return this.#emitEvidence(value, constraint, span, evidenceNames);
    });
  }

  /**
   * A constrained function referenced as a *value*, closed over its evidence.
   *
   * The trailing-evidence ABI means the raw binding is arity `n + k`, so handing
   * it on unwrapped gives a consumer that calls it with `n` arguments an
   * `undefined` dictionary and a crash at the first operation — clean compile,
   * runtime `TypeError` (defect 4). Eta-expanding to arity `n` restores the type
   * the reference actually claims.
   *
   * Only for references that carry evidence: wrapping every value reference
   * would cost an allocation per mention and break function identity, which FFI
   * Part 6 §1 is explicit about for exported callables.
   */
  #emitConstrainedValue(
    expression: Core.NameExpr,
    base: string,
    evidenceNames: EvidenceNames,
    bindingRhs: boolean,
  ): string {
    // ...except at a binding whose right-hand side is the reference itself and
    // which discharges none of its constraints. Step 1 of #205 made `let twice =
    // double` a syntactic value, so the alias generalizes and keeps the
    // original's residual constraints — and closure doc §2.2 is exact about what
    // that means: a reference "shares the unapplied entity", no evidence is
    // discharged at the binding, and the alias is "exactly as polymorphic, and
    // exactly as cheap, as the original". Emitting the bare name is that
    // sentence in JavaScript: `const twice = double`, with every consumer
    // appending the suffix it would have appended to `double`. Eta-expanding
    // instead would build a wrapper of the *unsuffixed* arity, which silently
    // drops the dictionary the consumer passes.
    //
    // `bindingRhs` is load-bearing and was missing until the 2026-08-01 review.
    // Without it the rule read every reference position, so a record field held
    // the bare evidence-taking function while the checker had typed that field
    // one arity narrower. Constraints §6.1 and §13.3 both say "at a binding";
    // this is that.
    //
    // What made that observable was once the `missing evidence during
    // JavaScript emission` note going quiet. It is no longer: that message is
    // retired as a user diagnostic (§13.6), and the shape it used to flag is
    // refused by the checker's evidence-seat rule before emission is reached.
    // The gate is still load-bearing — the *emission* changes, the bare name
    // against the eta-expansion — so read the emitted text, not the diagnostic
    // list, when probing it.
    //
    // Only a constraint defaulting cannot settle exhibits it. Under `Num` the
    // reference's evidence is a concrete instance rather than an unresolved
    // dictionary, the second half of the condition is false, and the position
    // never gets asked — which is why the first specimen written for this could
    // not tell the two builds apart.
    if (
      bindingRhs &&
      (expression.evidence ?? []).every(({ constraint, value }) =>
        value.kind === "Dictionary" &&
        !evidenceNames.has(evidenceKey(value.variable, value.constraint ?? constraint))
      )
    ) {
      return base;
    }
    // Between the two cases above there is a third the gate had no arm for, and
    // it is reachable from an ordinary *partial* annotation: `let g: (String, b)
    // -> String = pair`, where `pair : (Tag a, Tag b) => (a, b) -> String`. One
    // constraint is discharged at the binding, the other is still residual
    // because the binding's scheme quantifies it. The all-or-nothing test above
    // is false, so this fell into the eta case, which passed `undefined` for the
    // residual entry — while every consumer appended a dictionary for it,
    // against a wrapper one parameter short. Round 5's dropped dictionary,
    // reached through the *other* conjunct of the same gate.
    //
    // The correct shape threads the residual evidence as trailing parameters of
    // the wrapper: consumers append exactly the dictionaries the scheme
    // quantifies, in `dictionaryEntries`' order, so the parameters are minted in
    // that same order — by (variable, constraint name), per Constraints §6.1.
    // Only at a binding, which is the only position whose scheme can quantify a
    // residual constraint (§13.3).
    const residual = !bindingRhs ? [] : [
      ...new Map(
        (expression.evidence ?? []).flatMap(({ constraint, value }) => {
          if (value.kind !== "Dictionary") return [];
          const name = value.constraint ?? constraint;
          if (evidenceNames.has(evidenceKey(value.variable, name))) return [];
          return [[
            evidenceKey(value.variable, name),
            { variable: value.variable, constraint: name },
          ] as const];
        }),
      ).values(),
    ].sort((left, right) =>
      Number(left.variable) - Number(right.variable) ||
      left.constraint.localeCompare(right.constraint)
    );
    const residualParameters = residual.map(({ constraint, variable }) =>
      dictionaryParameterName(constraint, variable)
    );
    const localEvidence = new Map(evidenceNames);
    residual.forEach(({ constraint, variable }, index) => {
      localEvidence.set(evidenceKey(variable, constraint), residualParameters[index]!);
    });
    const dictionaries = this.#evidenceArguments(
      expression.evidence ?? [],
      expression.span,
      localEvidence,
    );
    if (expression.type.kind !== "Function") {
      // Nothing to eta-expand: a constrained non-function value has no arity to
      // wrap, and applying evidence eagerly would change when it is forced.
      // Retired as a user diagnostic on the same terms as `#dictionary`'s
      // (closure doc §13.6): the checker's evidence-seat rule is what refuses
      // this shape now, at the binding, where a rewrite can be named.
      this.#reportUnreachableEvidence(
        `\`${expression.text}\` needs constraint evidence in value position, ` +
          "but is not a function; call it, or annotate the reference at a concrete type",
        expression.span,
      );
      return base;
    }
    const parameters = expression.type.parameters.map((_, index) =>
      this.#generatedNames.fresh(`arg${index}`)
    );
    return `${arrowParameters([...parameters, ...residualParameters])} => ` +
      `${base}(${[...parameters, ...dictionaries].join(", ")})`;
  }

  /**
   * The compiler's implementation of an inventory key (`spec/intrinsics.md` §4).
   * The key space is flat and compiler-global precisely so it can mirror the
   * helper family, which is why every row here is one helper name.
   *
   * The declared scheme and the operation's owning spec are what bind: a
   * divergence between a row and its declaration is a compiler conformance
   * defect, testable and loggable, never a user diagnostic — the resolver has
   * already verified that the key exists, so an unknown key here cannot be
   * something the author typed.
   *
   * The two ways to arrive without a row are not the same failure, and must not
   * share a message. A key the *inventory* does not have is the author's typo,
   * already reported by the resolver — emitting quietly here keeps one mistake to
   * one diagnostic. A key the inventory *does* have with no lowering behind it is
   * the compiler contradicting itself, and is loud: emitting `undefined` for it
   * would surface later as a `Seq` that is not a `Seq`. `intrinsics.test.ts`
   * holds the two tables together ahead of time; this is the backstop.
   */
  #lowerIntrinsic(key: string, span: Source.Span): string {
    switch (key) {
      case "seqMemoize":
        return this.#useHelper("seqMemoize");
      default:
        if (INTRINSIC_INVENTORY.has(key)) {
          this.#diagnostics.add({
            severity: "error",
            message: `compiler defect: the intrinsic inventory provides \`${key}\`, ` +
              "but the emitter has no lowering for it",
            primary: span,
          });
        }
        return "undefined";
    }
  }

  #useHelper(helper: Helper): string {
    const pending = [helper];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (this.#helpers.has(next)) continue;
      this.#helpers.add(next);
      pending.push(...HELPER_DEPENDENCIES[next]);
    }
    return this.#helperName(helper);
  }

  #helperName(helper: Helper): string {
    const existing = this.#helperNames.get(helper);
    if (existing !== undefined) return existing;
    const name = this.#generatedNames.fixed(helper);
    this.#helperNames.set(helper, name);
    return name;
  }
}

class DeclarationEmitter {
  readonly #diagnostics = new Diagnostics.Bag();
  readonly #module: Core.Module;
  readonly #specializations: readonly FundamentalSpecialization[];
  readonly #opaqueBrands: ReadonlyMap<string, string>;
  /** The prelude identities and runtime faces this `.d.ts` renders through. */
  readonly #faces: DeclarationFaces;
  readonly #docs: DocIndex;
  /** Where the program's runtime declaration module sits, from here. */
  readonly #runtimeSpecifier: string;

  constructor(module: Core.Module, options: DeclarationEmissionOptions) {
    this.#module = module;
    this.#opaqueBrands = opaqueBrandNames(module);
    const runtime = new RuntimeFaces(runtimeFacesAlias(module));
    this.#faces = {
      prelude: preludeIds(module),
      runtime,
      // The settled runtime alias joins the probe's universe: it is a top-level
      // identifier of this file that `declarationTopLevelNames` deliberately
      // does not carry, being generated rather than source-derived.
      //
      // That universe is a documented *superset* of what the file emits, and it
      // is one here too — it carries every prelude term name, so a prelude
      // record whose constructor shares its type's name would take `Name1`
      // against no real collision. Cosmetic, and it errs the safe way: the cost
      // of over-claiming is a moved generated spelling, the cost of
      // under-claiming is a `.d.ts` that does not compile. No prelude type is
      // affected today (`Seq` is opaque, so no term shares a type's name).
      preludeTypes: new PreludeTypeFaces(
        module.preludeTypeImports,
        [...declarationTopLevelNames(module), runtime.alias],
      ),
    };
    this.#runtimeSpecifier = options.runtimeSpecifier ?? DEFAULT_RUNTIME_SPECIFIER;
    this.#docs = new DocIndex(module.docs);
    for (const diagnostic of module.diagnostics) this.#diagnostics.add(diagnostic);
    const plan = planFundamentalSpecializations(module);
    this.#specializations = plan.specializations;
    addSpecializationCollisionDiagnostics(this.#diagnostics, module, plan.collisions);
  }

  emit(): Emitted.Declarations {
    const declarations: string[] = [];
    let isExternalModule = false;
    for (const item of this.#module.items) {
      if (item.kind === "Import") {
        const specifier = JSON.stringify(emittedModuleSpecifier(item.specifier));
        if (item.form.kind === "Namespace") {
          declarations.push(`import type * as ${item.form.alias} from ${specifier};`);
          isExternalModule = true;
        } else if (item.form.kind === "Named") {
          // Every name that binds a type, not just those binding *only* a type
          // (§2.4 channel 1): a record's name imports its constructor and its
          // type at once, and the term half must not cost the `.d.ts` its type
          // row. The JavaScript side reads `typeOnly` and is untouched.
          const names = item.form.names.filter(({ typeBinding }) => typeBinding === true)
            .map(({ imported, local }) => imported === local ? imported : `${imported} as ${local}`);
          if (names.length > 0) {
            declarations.push(`import type { ${names.join(", ")} } from ${specifier};`);
            isExternalModule = true;
          }
        }
        continue;
      }
      if (item.kind === "ExternBlock") {
        for (const declaration of item.declarations) {
          if (!declaration.exported) continue;
          // The brand line goes before the documentation: JSDoc binds to the
          // declaration that immediately follows it.
          const doc = this.#docs.lines(declaration.span);
          if (declaration.kind === "ExternType") {
            const brand = this.#opaqueBrands.get(declaration.localName)!;
            declarations.push(`declare const ${brand}: unique symbol;`);
            declarations.push(...doc);
            declarations.push(`export type ${declaration.localName} = { readonly [${brand}]: never };`);
          } else if (declaration.kind === "ExternFun") {
            declarations.push(...doc);
            declarations.push(...renderExternFunctionDeclaration(declaration, true, this.#faces));
          } else {
            declarations.push(...doc);
            declarations.push(
              `export declare const ${declaration.localName}: ${renderType(declaration.type, new Map(), this.#faces, false)};`,
            );
          }
          isExternalModule = true;
        }
        continue;
      }
      if (item.kind === "ExternImport") continue;
      if (item.kind === "TypeAlias") {
        if (!item.exported) continue;
        const variables = typeVariableNames(item.parameters);
        const names = item.parameters.map((parameter) => variables.get(parameter)!);
        const generics = names.length === 0 ? "" : `<${names.join(", ")}>`;
        declarations.push(...this.#docs.lines(item.span));
        declarations.push(`export type ${item.name}${generics} = ${renderType(item.type, variables, this.#faces, false)};`);
        isExternalModule = true;
        continue;
      }
      if (item.kind === "Union") {
        if (item.opaque && item.exported) {
          const brand = this.#opaqueBrands.get(item.name)!;
          const variables = typeVariableNames(item.parameters);
          const names = item.parameters.map((parameter) => variables.get(parameter)!);
          const generics = names.length === 0 ? "" : `<${names.join(", ")}>`;
          declarations.push(`declare const ${brand}: unique symbol;`);
          declarations.push(...this.#docs.lines(item.span));
          declarations.push(`export type ${item.name}${generics} = { readonly [${brand}]: ${names.length === 0 ? "never" : names.join(" | ")} };`);
          isExternalModule = true;
          continue;
        }
        declarations.push(...this.#docs.lines(item.span));
        declarations.push(renderUnionDeclaration(item, item.exported, this.#faces));
        if (item.exported) {
          isExternalModule = true;
          const variables = typeVariableNames(item.parameters);
          const genericNames = item.parameters.map((parameter) => variables.get(parameter)!);
          const generics = genericNames.length === 0
            ? ""
            : `<${genericNames.join(", ")}>`;
          const result = item.parameters.length === 0
            ? item.name
            : `${item.name}<${genericNames.join(", ")}>`;
          for (const constructor of item.constructors) {
            const type = constructor.slots.length === 0
              ? item.parameters.length === 0
                ? item.name
                : `${item.name}<${item.parameters.map(() => "never").join(", ")}>`
              : `${generics}(${constructor.slots.map((slot, index) => `${slot.field || `arg${index}`}: ${renderType(slot.type, variables, this.#faces, false)}`).join(", ")}) => ${result}`;
            declarations.push(...this.#docs.lines(constructor.span));
            declarations.push(
              `export declare const ${constructor.name}: ${type};`,
            );
          }
        }
        continue;
      }
      if (item.kind === "RecordDeclaration") {
        if (!item.exported) continue;
        const variables = typeVariableNames(item.parameters);
        const names = item.parameters.map((parameter) => variables.get(parameter)!);
        const generics = names.length === 0 ? "" : `<${names.join(", ")}>`;
        if (item.opaque) {
          const brand = this.#opaqueBrands.get(item.name)!;
          declarations.push(`declare const ${brand}: unique symbol;`);
          declarations.push(...this.#docs.lines(item.span));
          declarations.push(`export type ${item.name}${generics} = { readonly [${brand}]: ${names.length === 0 ? "never" : names.join(" | ")} };`);
          isExternalModule = true;
          continue;
        }
        const recordType = `{ ${item.fields.map((field) =>
          `${field.name}: ${renderType(field.type, variables, this.#faces, false)}`
        ).join("; ")} }`;
        const result = names.length === 0 ? item.name : `${item.name}<${names.join(", ")}>`;
        declarations.push(...this.#docs.lines(item.span));
        // Field documentation needs the one seat TypeScript tooling reads it
        // from — the property in the structural type (§7.1) — and a property
        // only gets its own JSDoc when the type is written across lines.
        declarations.push(
          ...this.#renderRecordType(item, variables, `export type ${item.name}${generics} = `),
        );
        declarations.push(`export declare const ${item.name}: ${generics}(${item.fields.length === 0 ? "record: {}" : `record: ${recordType}`}) => ${result};`);
        isExternalModule = true;
        continue;
      }
      if (item.kind === "Exception") {
        if (!item.exported) continue;
        const face = `Error & { readonly $hex: true; readonly name: ${JSON.stringify(item.binding.name)}${item.slots.map((slot) => `; readonly ${slot.field}: ${renderType(slot.type, new Map(), this.#faces, false)}`).join("")} }`;
        declarations.push(...this.#docs.lines(item.span));
        declarations.push(`export type ${item.binding.name} = ${face};`);
        const constructor = item.slots.length === 0
          ? `() => ${item.binding.name}`
          : `(${item.slots.map((slot) => `${slot.field}: ${renderType(slot.type, new Map(), this.#faces, false)}`).join(", ")}) => ${item.binding.name}`;
        declarations.push(`export declare const ${item.binding.name}: ${constructor};`);
        isExternalModule = true;
        continue;
      }
      if ((item.kind !== "Let" && item.kind !== "Fun") || !item.exported) {
        continue;
      }
      if (item.binding.scheme.constraints.length > 0) {
        const specializations = this.#specializations.filter(
          ({ sourceSymbol }) => sourceSymbol === item.binding.symbol,
        );
        for (const specialization of specializations) {
          if (item.value.kind !== "Lambda") continue;
          const specialized = specializeItem(item as SpecializableItem, specialization);
          // A constrained binding has no single `.d.ts` declaration — its face
          // is one per specialization — so its documentation rides each.
          declarations.push(...this.#docs.lines(item.span));
          declarations.push(
            renderFunctionDeclaration(
              specialization.name,
              specialized.binding.scheme,
              specialized.value as Core.LambdaExpr,
              true,
              this.#faces,
            ),
          );
        }
        isExternalModule ||= specializations.length > 0;
        continue;
      }
      isExternalModule = true;

      declarations.push(...this.#docs.lines(item.span));
      const safeName = isSafeIdentifier(item.binding.name);
      const local = safeName
        ? item.binding.name
        : `__hex_binding${Number(item.binding.symbol)}`;
      if (item.kind === "Fun") {
        declarations.push(
          renderFunctionDeclaration(local, item.binding.scheme, item.value, safeName, this.#faces),
        );
        if (!safeName) {
          declarations.push(`export { ${local} as ${item.binding.name} };`);
        }
      } else if (safeName) {
        const type = renderScheme(item.binding.scheme, this.#faces, item.value);
        declarations.push(`export declare const ${item.binding.name}: ${type};`);
      } else {
        const type = renderScheme(item.binding.scheme, this.#faces, item.value);
        declarations.push(`declare const ${local}: ${type};`);
        declarations.push(`export { ${local} as ${item.binding.name} };`);
      }
    }
    // The prelude types the rendered faces actually reached (§2.4). Unshifted
    // for the reason the runtime import below is: a compiler-written import
    // precedes the module's own items. They are read only now, when every face
    // has been rendered and the referenced set is closed.
    const preludeTypeLines = this.#faces.preludeTypes.lines();
    if (preludeTypeLines.length > 0) {
      declarations.unshift(...preludeTypeLines.map(({ line }) => line));
      isExternalModule = true;
    }
    // Exactly one type-only import of the runtime declaration module, and only
    // when a `Hex.*` face was actually rendered (FFI Part 1 §8.3 obligation 2).
    // It goes first, ahead of the source-level imports, because it is the
    // compiler's own line rather than one of the module's. The import is
    // type-only and erases, so it adds no emitted JavaScript dependency and no
    // `hex.js` is ever written.
    if (this.#faces.runtime.used) {
      declarations.unshift(
        `import type * as ${this.#faces.runtime.alias} from ` +
          `${JSON.stringify(this.#runtimeSpecifier)};`,
      );
      isExternalModule = true;
    }
    if (!isExternalModule) declarations.push("export {};");

    return {
      kind: "Declarations",
      fileId: this.#module.fileId,
      text: `${declarations.join("\n")}\n`,
      importsRuntimeTypes: this.#faces.runtime.used,
      preludeTypeImports: [...new Set(preludeTypeLines.map(({ specifier }) => specifier))],
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  /**
   * The structural type a `record` declares, as `.d.ts` lines. It stays on one
   * line — the shape every existing golden expects — unless a field carries
   * documentation, because a property's JSDoc has to precede it on its own
   * line to be the property's (spec/doc-comments.md §7.1).
   */
  #renderRecordType(
    item: Core.RecordItem,
    variables: ReadonlyMap<Typed.TypeVariableId, string>,
    head: string,
  ): string[] {
    const fields = item.fields.map((field) => ({
      doc: this.#docs.lines(field.span, "  "),
      text: `${field.name}: ${renderType(field.type, variables, this.#faces, false)}`,
    }));
    if (fields.every(({ doc }) => doc.length === 0)) {
      return [`${head}{ ${fields.map(({ text }) => text).join("; ")} };`];
    }
    return [
      `${head}{`,
      ...fields.flatMap(({ doc, text }) => [...doc, `  ${text};`]),
      "};",
    ];
  }
}

class TypeScriptPreviewEmitter {
  readonly #diagnostics = new Diagnostics.Bag();
  readonly #module: Core.Module;
  readonly #specializations: readonly FundamentalSpecialization[];
  readonly #opaqueBrands: ReadonlyMap<string, string>;
  /** The prelude identities and runtime faces this preview renders through. */
  readonly #faces: DeclarationFaces;
  readonly #docs: DocIndex;

  constructor(module: Core.Module) {
    this.#module = module;
    this.#opaqueBrands = opaqueBrandNames(module);
    this.#faces = {
      prelude: preludeIds(module),
      runtime: new RuntimeFaces(runtimeFacesAlias(module)),
      // Inert: §2.4's Scope keeps the preview on bare names.
      preludeTypes: new PreludeTypeFaces([], []),
    };
    this.#docs = new DocIndex(module.docs);
    for (const diagnostic of module.diagnostics) this.#diagnostics.add(diagnostic);
    const plan = planFundamentalSpecializations(module, true);
    this.#specializations = plan.specializations;
    addSpecializationCollisionDiagnostics(this.#diagnostics, module, plan.collisions);
  }

  emit(): Emitted.TypeScriptPreview {
    const declarations: string[] = [];
    let isExternalModule = false;

    for (const item of this.#module.items) {
      if (item.kind === "Import") {
        const specifier = JSON.stringify(emittedModuleSpecifier(item.specifier));
        if (item.form.kind === "Namespace") {
          declarations.push(`import type * as ${item.form.alias} from ${specifier};`);
          isExternalModule = true;
        } else if (item.form.kind === "Named") {
          const names = item.form.names.filter(({ typeOnly }) => typeOnly === true)
            .map(({ imported, local }) => imported === local ? imported : `${imported} as ${local}`);
          if (names.length > 0) {
            declarations.push(`import type { ${names.join(", ")} } from ${specifier};`);
            isExternalModule = true;
          }
        }
        continue;
      }
      if (item.kind === "ExternBlock") {
        for (const declaration of item.declarations) {
          const prefix = declaration.exported ? "export " : "";
          const doc = this.#docs.lines(declaration.span);
          if (declaration.kind === "ExternType") {
            const brand = this.#opaqueBrands.get(declaration.localName)!;
            declarations.push(`declare const ${brand}: unique symbol;`);
            declarations.push(...doc);
            declarations.push(`${prefix}type ${declaration.localName} = { readonly [${brand}]: never };`);
          } else if (declaration.kind === "ExternFun") {
            declarations.push(...doc);
            declarations.push(...renderExternFunctionDeclaration(declaration, declaration.exported, this.#faces));
          } else {
            declarations.push(...doc);
            declarations.push(
              `${prefix}declare const ${declaration.localName}: ${renderType(declaration.type, new Map(), this.#faces, false)};`,
            );
          }
          isExternalModule ||= declaration.exported;
        }
        continue;
      }
      if (item.kind === "ExternImport") continue;
      if (item.kind === "TypeAlias") {
        const prefix = item.exported ? "export " : "";
        const variables = typeVariableNames(item.parameters);
        const names = item.parameters.map((parameter) => variables.get(parameter)!);
        const generics = names.length === 0 ? "" : `<${names.join(", ")}>`;
        declarations.push(...this.#docs.lines(item.span));
        declarations.push(`${prefix}type ${item.name}${generics} = ${renderType(item.type, variables, this.#faces, false)};`);
        isExternalModule ||= item.exported;
        continue;
      }
      if (item.kind === "Union") {
        if (item.opaque) {
          const prefix = item.exported ? "export " : "";
          const brand = this.#opaqueBrands.get(item.name)!;
          const variables = typeVariableNames(item.parameters);
          const names = item.parameters.map((parameter) => variables.get(parameter)!);
          const generics = names.length === 0 ? "" : `<${names.join(", ")}>`;
          declarations.push(`declare const ${brand}: unique symbol;`);
          declarations.push(...this.#docs.lines(item.span));
          declarations.push(`${prefix}type ${item.name}${generics} = { readonly [${brand}]: ${names.length === 0 ? "never" : names.join(" | ")} };`);
          isExternalModule ||= item.exported;
          continue;
        }
        declarations.push(...this.#docs.lines(item.span));
        declarations.push(renderUnionDeclaration(item, item.exported, this.#faces));
        const variables = typeVariableNames(item.parameters);
        const genericNames = item.parameters.map((parameter) => variables.get(parameter)!);
        const generics = genericNames.length === 0 ? "" : `<${genericNames.join(", ")}>`;
        const result = item.parameters.length === 0
          ? item.name
          : `${item.name}<${genericNames.join(", ")}>`;
        for (const constructor of item.constructors) {
          const prefix = item.exported ? "export " : "";
          const type = constructor.slots.length === 0
            ? item.parameters.length === 0
              ? item.name
              : `${item.name}<${item.parameters.map(() => "never").join(", ")}>`
            : `${generics}(${constructor.slots.map((slot, index) => `${slot.field || `arg${index}`}: ${renderType(slot.type, variables, this.#faces, false)}`).join(", ")}) => ${result}`;
          declarations.push(...this.#docs.lines(constructor.span));
          declarations.push(
            `${prefix}declare const ${constructor.name}: ${type};`,
          );
        }
        isExternalModule ||= item.exported;
        continue;
      }
      if (item.kind === "RecordDeclaration") {
        const prefix = item.exported ? "export " : "";
        const variables = typeVariableNames(item.parameters);
        const names = item.parameters.map((parameter) => variables.get(parameter)!);
        const generics = names.length === 0 ? "" : `<${names.join(", ")}>`;
        if (item.opaque) {
          const brand = this.#opaqueBrands.get(item.name)!;
          declarations.push(`declare const ${brand}: unique symbol;`);
          declarations.push(...this.#docs.lines(item.span));
          declarations.push(`${prefix}type ${item.name}${generics} = { readonly [${brand}]: ${names.length === 0 ? "never" : names.join(" | ")} };`);
          isExternalModule ||= item.exported;
          continue;
        }
        const recordType = `{ ${item.fields.map((field) =>
          `${field.name}: ${renderType(field.type, variables, this.#faces, false)}`
        ).join("; ")} }`;
        const result = names.length === 0 ? item.name : `${item.name}<${names.join(", ")}>`;
        declarations.push(...this.#docs.lines(item.span));
        declarations.push(
          ...this.#renderRecordType(item, variables, `${prefix}type ${item.name}${generics} = `),
        );
        declarations.push(`${prefix}declare const ${item.name}: ${generics}(record: ${recordType}) => ${result};`);
        isExternalModule ||= item.exported;
        continue;
      }
      if (item.kind === "Exception") {
        const prefix = item.exported ? "export " : "";
        const face = `Error & { readonly $hex: true; readonly name: ${JSON.stringify(item.binding.name)}${item.slots.map((slot) => `; readonly ${slot.field}: ${renderType(slot.type, new Map(), this.#faces, false)}`).join("")} }`;
        declarations.push(...this.#docs.lines(item.span));
        declarations.push(`${prefix}type ${item.binding.name} = ${face};`);
        const constructor = item.slots.length === 0
          ? `() => ${item.binding.name}`
          : `(${item.slots.map((slot) => `${slot.field}: ${renderType(slot.type, new Map(), this.#faces, false)}`).join(", ")}) => ${item.binding.name}`;
        declarations.push(`${prefix}declare const ${item.binding.name}: ${constructor};`);
        isExternalModule ||= item.exported;
        continue;
      }
      if (item.kind === "LetPattern") {
        for (const binding of patternBindings(item.pattern)) {
          const name = isSafeIdentifier(binding.name)
            ? binding.name
            : `__hex_binding${Number(binding.symbol)}`;
          declarations.push(
            `declare const ${name}: ${renderScheme(binding.scheme, this.#faces)};`,
          );
        }
        continue;
      }
      if (item.kind !== "Let" && item.kind !== "Fun") continue;
      if (item.binding.scheme.constraints.length > 0) {
        const specializations = this.#specializations.filter(
          ({ sourceSymbol }) => sourceSymbol === item.binding.symbol,
        );
        for (const specialization of specializations) {
          if (item.value.kind !== "Lambda") continue;
          const specialized = specializeItem(item as SpecializableItem, specialization);
          // A constrained binding has no single `.d.ts` declaration — its face
          // is one per specialization — so its documentation rides each.
          declarations.push(...this.#docs.lines(item.span));
          declarations.push(
            renderFunctionDeclaration(
              specialization.name,
              specialized.binding.scheme,
              specialized.value as Core.LambdaExpr,
              item.exported,
              this.#faces,
            ),
          );
        }
        isExternalModule ||= item.exported && specializations.length > 0;
        continue;
      }

      const name = isSafeIdentifier(item.binding.name)
        ? item.binding.name
        : `__hex_binding${Number(item.binding.symbol)}`;
      declarations.push(...this.#docs.lines(item.span));
      if (item.exported) {
        if (item.kind === "Fun") {
          declarations.push(
            renderFunctionDeclaration(
              name,
              item.binding.scheme,
              item.value,
              isSafeIdentifier(item.binding.name),
              this.#faces,
            ),
          );
          if (!isSafeIdentifier(item.binding.name)) {
            declarations.push(`export { ${name} as ${item.binding.name} };`);
          }
        } else if (isSafeIdentifier(item.binding.name)) {
          declarations.push(
            `export declare const ${name}: ${renderScheme(item.binding.scheme, this.#faces, item.value)};`,
          );
        } else {
          declarations.push(
            `declare const ${name}: ${renderScheme(item.binding.scheme, this.#faces, item.value)};`,
          );
          declarations.push(`export { ${name} as ${item.binding.name} };`);
        }
        isExternalModule = true;
      } else if (item.kind === "Fun") {
        declarations.push(
          renderFunctionDeclaration(name, item.binding.scheme, item.value, false, this.#faces),
        );
      } else {
        declarations.push(
          `declare const ${name}: ${renderScheme(item.binding.scheme, this.#faces, item.value)};`,
        );
      }
    }

    // The preview is one pane of inspection-only text with no file to import
    // from, so §8.3 obligation 6 has it declare the namespace inline instead —
    // the same four interfaces, which is what keeps a value typed through the
    // preview and one typed through an imported `hex.d.ts` mutually assignable.
    // The header goes first to read like one, not because TypeScript needs it
    // there: a type reference may precede its declaration in the same file.
    if (this.#faces.runtime.used) {
      declarations.unshift(...runtimeNamespaceDeclaration(this.#faces.runtime.alias));
    }
    if (!isExternalModule) declarations.push("export {};");

    return {
      kind: "TypeScriptPreview",
      fileId: this.#module.fileId,
      text: `${declarations.join("\n")}\n`,
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  /**
   * The structural type a `record` declares, as `.d.ts` lines. It stays on one
   * line — the shape every existing golden expects — unless a field carries
   * documentation, because a property's JSDoc has to precede it on its own
   * line to be the property's (spec/doc-comments.md §7.1).
   */
  #renderRecordType(
    item: Core.RecordItem,
    variables: ReadonlyMap<Typed.TypeVariableId, string>,
    head: string,
  ): string[] {
    const fields = item.fields.map((field) => ({
      doc: this.#docs.lines(field.span, "  "),
      text: `${field.name}: ${renderType(field.type, variables, this.#faces, false)}`,
    }));
    if (fields.every(({ doc }) => doc.length === 0)) {
      return [`${head}{ ${fields.map(({ text }) => text).join("; ")} };`];
    }
    return [
      `${head}{`,
      ...fields.flatMap(({ doc, text }) => [...doc, `  ${text};`]),
      "};",
    ];
  }
}

type SourceEntry = ItemEntry | CommentEntry;

function opaqueBrandNames(module: Core.Module): ReadonlyMap<string, string> {
  const typeNames = module.items.flatMap((item) =>
    item.kind === "TypeAlias" || item.kind === "Union" || item.kind === "RecordDeclaration"
      ? [item.name]
      : item.kind === "ExternBlock"
      ? item.declarations.flatMap((declaration) =>
          declaration.kind === "ExternType" ? [declaration.localName] : []
        )
      : []
  );
  const names = new GeneratedNames([
    ...module.symbols.map(({ name }) => name),
    ...typeNames,
  ]);
  return new Map(module.items.flatMap((item) =>
    (item.kind === "Union" || item.kind === "RecordDeclaration") && item.opaque
      ? [[item.name, names.fixed(`opaque_${item.name}`)] as const]
      : item.kind === "ExternBlock"
      ? item.declarations.flatMap((declaration) =>
          declaration.kind === "ExternType"
            ? [[declaration.localName, names.fixed(`opaque_${declaration.localName}`)] as const]
            : []
        )
      : []
  ));
}

interface PatternPlan {
  readonly tests: readonly string[];
  readonly bindings: readonly string[];
}

function addSpecializationCollisionDiagnostics(
  diagnostics: Diagnostics.Bag,
  module: Core.Module,
  collisions: readonly SpecializationCollision[],
): void {
  for (const collision of collisions) {
    diagnostics.add({
      severity: collision.specialization.sourceExported ? "error" : "warning",
      message: collision.kind === "explicit"
        ? collision.otherExported
          ? `generated specialization \`${collision.specialization.name}\` conflicts with exported \`${collision.otherSourceName}\`; rename one of the exports`
          : `generated specialization \`${collision.specialization.name}\` conflicts with binding \`${collision.otherSourceName}\`; rename one of the declarations`
        : `generated specialization \`${collision.specialization.name}\` from \`${collision.specialization.sourceName}\` conflicts with the edition generated by \`${collision.otherSourceName}\`; rename one of the exports`,
      primary: module.items.find((item) =>
        (item.kind === "Let" || item.kind === "Fun") &&
        item.binding.symbol === collision.specialization.sourceSymbol
      )?.span ?? module.span,
    });
  }
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function expandOrPatterns(pattern: Core.Pattern): readonly Core.Pattern[] {
  switch (pattern.kind) {
    case "Or":
      return pattern.alternatives.flatMap(expandOrPatterns);
    case "As":
      return expandOrPatterns(pattern.pattern).map((nested) => ({
        ...pattern,
        pattern: nested,
      }));
    case "Tuple":
      return combinations(pattern.elements.map(expandOrPatterns)).map(
        (elements) => ({ ...pattern, elements }),
      );
    case "Record":
      return combinations(pattern.fields.map((field) =>
        expandOrPatterns(field.pattern).map((nested) => ({
          ...field,
          pattern: nested,
        }))
      )).map((fields) => ({ ...pattern, fields }));
    case "Constructor":
      return combinations(pattern.arguments.map(expandOrPatterns)).map(
        (arguments_) => ({ ...pattern, arguments: arguments_ }),
      );
    default:
      return [pattern];
  }
}

function combinations<T>(groups: readonly (readonly T[])[]): readonly T[][] {
  return groups.reduce<readonly T[][]>(
    (results, group) => results.flatMap((result) =>
      group.map((value) => [...result, value])
    ),
    [[]],
  );
}

function combinePatternPlans(plans: readonly PatternPlan[]): PatternPlan {
  return {
    tests: plans.flatMap(({ tests }) => tests),
    bindings: plans.flatMap(({ bindings }) => bindings),
  };
}

function isSimpleSwitchPattern(pattern: Core.Pattern): boolean {
  return pattern.kind === "Constructor"
    ? pattern.arguments.every(isSimplePayloadBindingPattern)
    : pattern.kind === "Binding" || pattern.kind === "Wildcard";
}

function isSimplePayloadBindingPattern(pattern: Core.Pattern): boolean {
  switch (pattern.kind) {
    case "Binding":
    case "Wildcard":
    case "Unit":
      return true;
    case "Tuple":
      return pattern.elements.every(isSimplePayloadBindingPattern);
    case "Vector":
      return false;
    case "Record":
      return pattern.fields.every((field) =>
        isSimplePayloadBindingPattern(field.pattern)
      );
    case "Integer":
    case "String":
    case "Constructor":
    case "As":
    case "Or":
      return false;
  }
}

/** An item already rendered to lines; see the two phases in `emit`. */
interface RenderedItem {
  readonly item: Core.Item;
  readonly lines: readonly string[];
  /** Where the item begins on the page: its doc block, when it has one. */
  readonly start: Source.Span;
}

interface ItemEntry extends RenderedItem {
  readonly kind: "Item";
  readonly span: Source.Span;
}

interface CommentEntry {
  readonly kind: "Comment";
  readonly comment: Source.Comment;
  readonly span: Source.Span;
  readonly start: Source.Span;
}

function trailingComments(
  items: readonly Core.Item[],
  comments: readonly Source.Comment[],
): ReadonlyMap<Core.Item, readonly Source.Comment[]> {
  const result = new Map<Core.Item, Source.Comment[]>();
  for (const comment of comments) {
    if (comment.kind !== "Line") continue;
    const item = items.findLast(
      (candidate) =>
        candidate.span.end.line === comment.span.start.line &&
        candidate.span.end.offset <= comment.span.start.offset,
    );
    if (item === undefined) continue;
    const existing = result.get(item) ?? [];
    existing.push(comment);
    result.set(item, existing);
  }
  return result;
}

function sourceEntries(
  items: readonly RenderedItem[],
  comments: readonly Source.Comment[],
  trailing: ReadonlyMap<Core.Item, readonly Source.Comment[]>,
): SourceEntry[] {
  const trailingSet = new Set([...trailing.values()].flat());
  return [
    ...items.map((rendered): ItemEntry => ({
      kind: "Item",
      ...rendered,
      span: rendered.item.span,
    })),
    ...comments
      .filter(
        (comment) =>
          comment.span.start.column === 0 && !trailingSet.has(comment),
      )
      .map(
        (comment): CommentEntry => ({
          kind: "Comment",
          comment,
          span: comment.span,
          start: comment.span,
        }),
      ),
  ].sort((left, right) => left.span.start.offset - right.span.start.offset);
}

// Emitted comments carry the source's content in JavaScript's spelling, and the
// emitted file has to stay valid JavaScript (spec/comments.md §6). A block body
// containing JavaScript's own closer cannot be a JavaScript block comment at all,
// so it is re-presented as a run of `//` comments on whole lines.
function commentLines(comment: Source.Comment): string[] {
  const split = (text: string) => text.split(/\r\n|\r|\n/u);
  if (comment.kind === "Line") return split(comment.text);

  // An unterminated comment still reaches here — it is recorded alongside its
  // diagnostic — and its text has no closer to strip. Taking one off regardless
  // would delete the last two characters of the file.
  const body = comment.text.slice(2, comment.terminated ? -2 : undefined);
  return body.includes("*/")
    ? split(body).map((line) => `//${line}`.trimEnd())
    : split(`/*${body}*/`);
}

/** Preserves vertical separation where top-level source entries align. */
function blankLinesBetween(previous: Source.Span, next: Source.Span): number {
  return Math.max(0, next.start.line - previous.end.line - 1);
}

/** Emits the canonical zero/one/many JavaScript arrow-parameter shape. */
function arrowParameters(parameters: readonly string[]): string {
  return parameters.length === 1
    ? parameters[0]!
    : `(${parameters.join(", ")})`;
}

/**
 * Whether a type is `Unit` — the arity-0 tuple (#159, Products §2.6): the tuple
 * representation rule is arity-indexed, an array at arity ≥ 2 and `undefined`
 * at arity 0, so this is the emitter's one test for the `undefined` clause.
 */
function isUnit(type: Typed.Type): boolean {
  return type.kind === "Tuple" && type.elements.length === 0;
}

/**
 * Whether emitted statements end in an unconditional exit, so that appending a
 * `break` would be unreachable. Conservative: anything else is treated as
 * falling through.
 */
function exits(lines: readonly string[]): boolean {
  const last = lines.at(-1)?.trim() ?? "";
  return last.startsWith("return ") || last.startsWith("return;") ||
    last.startsWith("throw ") || last.startsWith("break;") ||
    last.startsWith("continue;");
}

/**
 * Parenthesizes a concise arrow body that starts with `{`, which JavaScript
 * would otherwise read as a block rather than an object literal. Reached
 * whenever a lambda's body emits a record — a record construction inlines to its
 * literal, since the constructor is the identity function.
 */
function arrowBody(text: string): string {
  return text.startsWith("{") ? `(${text})` : text;
}

/** Uses object-property shorthand whenever the emitted key and value coincide. */
function objectProperty(name: string, value: string): string {
  return name === value ? name : `${name}: ${value}`;
}

type Helper =
  | "checkedPower"
  | "compareFloat"
  | "compareString"
  | "ordering"
  | "exception"
  | "floatEquals"
  | "range"
  | "seqFromIterable"
  | "seqInbound"
  | "seqIterate"
  | "seqMemoize"
  | "seqToIterable"
  | "nodeSet"
  | "vectorAt"
  | "vectorIndex"
  | "vectorSet"
  | "vectorSlice"
  | "stringIndex"
  | "stringSlice"
  | "stableHash"
  | "mixHash"
  | "intDiv"
  | "intMod"
  | "intQuot"
  | "intRem"
  | "intGcd"
  | "bigIntDiv"
  | "bigIntMod"
  | "bigIntQuot"
  | "bigIntRem"
  | "bigIntGcd"
  | "bigIntLcm"
  | "floatMod"
  | "floatRem"
  | "persistentCollections";

/**
 * Which helpers a helper's own body names. `#useHelper` closes over this, so
 * requesting one member of a mutually recursive family emits the whole family.
 *
 * The FFI Part 3 family (ruling R1, four members after the defect-12 ruling —
 * Part 3 §9.4) is the reason this is a table rather than a couple of `if`s: the
 * inbound adapter builds records that carry the boundary traversal method, and
 * that method is composed from the adapter and the outbound driver, so the
 * three are a cycle that neither eager `add` calls nor recursion can express.
 */
const HELPER_DEPENDENCIES: Readonly<Record<Helper, readonly Helper[]>> = {
  checkedPower: [],
  compareFloat: [],
  compareString: [],
  ordering: [],
  exception: [],
  floatEquals: [],
  range: [],
  seqFromIterable: ["seqIterate"],
  seqInbound: ["seqFromIterable"],
  seqIterate: ["seqFromIterable", "seqToIterable"],
  seqMemoize: ["seqFromIterable", "seqToIterable"],
  seqToIterable: [],
  nodeSet: [],
  vectorAt: [],
  vectorIndex: [],
  vectorSet: [],
  vectorSlice: [],
  stringIndex: ["vectorIndex"],
  stringSlice: ["vectorSlice"],
  stableHash: [],
  mixHash: [],
  intDiv: [],
  intMod: [],
  intQuot: [],
  intRem: [],
  intGcd: [],
  bigIntDiv: [],
  bigIntMod: [],
  bigIntQuot: [],
  bigIntRem: [],
  bigIntGcd: [],
  bigIntLcm: [],
  floatMod: [],
  floatRem: [],
  persistentCollections: [],
};

enum Precedence {
  Arrow = 1,
  Conditional,
  LogicalOr,
  LogicalAnd,
  Equality,
  Relational,
  Additive,
  Multiplicative,
  Exponentiation,
  Unary,
  Call,
  Primary,
}

function expressionPrecedence(expression: Core.Expr): Precedence {
  switch (expression.kind) {
    case "Lambda":
      return Precedence.Arrow;
    case "If":
      return Precedence.Conditional;
    case "Logical":
      return expression.operation === "And"
        ? Precedence.LogicalAnd
        : Precedence.LogicalOr;
    case "LogicalNot":
      return Precedence.Unary;
    case "FieldAccess":
    case "TupleAccess":
    case "Index":
    case "Hash":
    case "Call":
    case "ConsoleLog":
    case "While":
    case "For":
    case "Throw":
    case "Try":
    case "Range":
      return Precedence.Call;
    case "Assignment":
      return Precedence.Unary;
    case "Record":
      return Precedence.Primary;
    case "ConstraintCall":
      if (expression.evidence.kind !== "Primitive") return Precedence.Call;
      switch (expression.member) {
        case "add":
        case "subtract":
        case "concat":
          return Precedence.Additive;
        case "multiply":
        case "divide":
          return Precedence.Multiplicative;
        case "pow":
          return expression.evidence.instance === "Float"
            ? Precedence.Exponentiation
            : Precedence.Call;
        case "negate":
          return Precedence.Unary;
      }
    case "ComparisonChain":
      return expression.steps.length === 1
        ? comparisonPrecedence(expression.steps[0]!)
        : Precedence.Call;
    case "String":
      if (expression.parts.length === 1 && expression.parts[0]?.kind === "Text") {
        return Precedence.Primary;
      }
      return expression.parts.length > 1
        ? Precedence.Additive
        : Precedence.Conditional;
    case "Match":
    case "ConvertNat":
    case "Block":
      return Precedence.Call;
    case "WidenNat":
    case "WidenInt":
      return expression.evidence.kind === "Primitive" &&
          expression.evidence.instance !== "BigInt"
        ? expressionPrecedence(expression.value)
        : Precedence.Call;
    case "Name":
    case "CollectionOperation":
    case "PrimitiveOperation":
    case "Unit":
    case "Number":
    case "BigInt":
    case "Float":
    case "Tuple":
    case "Vector":
    case "ErrorExpr":
      return Precedence.Primary;
  }
}

function comparisonPrecedence(step: Core.ComparisonStep): Precedence {
  return step.test === "Equal" || step.test === "NotEqual"
    ? Precedence.Equality
    : Precedence.Relational;
}

function renderHelper(
  helper: Helper,
  name: string,
  dependencyName: (helper: Helper) => string,
): string[] {
  switch (helper) {
    case "intDiv":
    case "intMod":
    case "intQuot":
    case "intRem":
    case "intGcd":
    case "bigIntDiv":
    case "bigIntMod":
    case "bigIntQuot":
    case "bigIntRem":
    case "bigIntGcd":
    case "bigIntLcm":
    case "floatMod":
    case "floatRem": {
      const [primitive, operation] = primitiveOperationFromHelper(helper);
      return [`const ${name} = ${primitiveOperation(primitive, operation)};`];
    }
    case "persistentCollections":
      return [
        `const ${name} = (() => {`,
        "  const entries = function* (__hex_node) {",
        "    if (__hex_node === null) return;",
        "    if (__hex_node.kind === 0) { yield* __hex_node.entries; return; }",
        "    for (const __hex_child of __hex_node.children) if (__hex_child !== undefined) yield* entries(__hex_child);",
        "  };",
        "  const find = (__hex_node, __hex_hash, __hex_key, __hex_equals, __hex_shift = 0) => {",
        "    if (__hex_node === null) return undefined;",
        "    if (__hex_node.kind === 0) return __hex_node.hash === __hex_hash ? __hex_node.entries.find(__hex_entry => __hex_equals(__hex_entry[0], __hex_key)) : undefined;",
        "    return find(__hex_node.children[(__hex_hash >>> __hex_shift) & 31] ?? null, __hex_hash, __hex_key, __hex_equals, __hex_shift + 5);",
        "  };",
        "  const join = (__hex_left, __hex_right, __hex_shift) => {",
        "    const __hex_leftIndex = (__hex_left.hash >>> __hex_shift) & 31, __hex_rightIndex = (__hex_right.hash >>> __hex_shift) & 31;",
        "    const __hex_children = [];",
        "    if (__hex_leftIndex === __hex_rightIndex) __hex_children[__hex_leftIndex] = join(__hex_left, __hex_right, __hex_shift + 5);",
        "    else { __hex_children[__hex_leftIndex] = __hex_left; __hex_children[__hex_rightIndex] = __hex_right; }",
        "    return { kind: 1, children: __hex_children };",
        "  };",
        "  const insert = (__hex_node, __hex_hash, __hex_key, __hex_value, __hex_equals, __hex_shift = 0) => {",
        "    const __hex_leaf = { kind: 0, hash: __hex_hash, entries: [[__hex_key, __hex_value]] };",
        "    if (__hex_node === null) return [__hex_leaf, true];",
        "    if (__hex_node.kind === 0) {",
        "      if (__hex_node.hash !== __hex_hash) return [join(__hex_node, __hex_leaf, __hex_shift), true];",
        "      const __hex_index = __hex_node.entries.findIndex(__hex_entry => __hex_equals(__hex_entry[0], __hex_key));",
        "      if (__hex_index < 0) return [{ ...__hex_node, entries: [...__hex_node.entries, [__hex_key, __hex_value]] }, true];",
        "      if (__hex_node.entries[__hex_index][1] === __hex_value) return [__hex_node, false];",
        "      const __hex_updated = __hex_node.entries.slice(); __hex_updated[__hex_index] = [__hex_node.entries[__hex_index][0], __hex_value];",
        "      return [{ ...__hex_node, entries: __hex_updated }, false];",
        "    }",
        "    const __hex_slot = (__hex_hash >>> __hex_shift) & 31, __hex_child = __hex_node.children[__hex_slot] ?? null;",
        "    const [__hex_updated, __hex_added] = insert(__hex_child, __hex_hash, __hex_key, __hex_value, __hex_equals, __hex_shift + 5);",
        "    if (__hex_updated === __hex_child) return [__hex_node, __hex_added];",
        "    const __hex_children = __hex_node.children.slice(); __hex_children[__hex_slot] = __hex_updated;",
        "    return [{ kind: 1, children: __hex_children }, __hex_added];",
        "  };",
        "  const discard = (__hex_node, __hex_hash, __hex_key, __hex_equals, __hex_shift = 0) => {",
        "    if (__hex_node === null) return [null, false];",
        "    if (__hex_node.kind === 0) {",
        "      if (__hex_node.hash !== __hex_hash) return [__hex_node, false];",
        "      const __hex_index = __hex_node.entries.findIndex(__hex_entry => __hex_equals(__hex_entry[0], __hex_key));",
        "      if (__hex_index < 0) return [__hex_node, false];",
        "      const __hex_remaining = __hex_node.entries.filter((_, __hex_entryIndex) => __hex_entryIndex !== __hex_index);",
        "      return [__hex_remaining.length === 0 ? null : { ...__hex_node, entries: __hex_remaining }, true];",
        "    }",
        "    const __hex_slot = (__hex_hash >>> __hex_shift) & 31, __hex_child = __hex_node.children[__hex_slot] ?? null;",
        "    const [__hex_updated, __hex_removed] = discard(__hex_child, __hex_hash, __hex_key, __hex_equals, __hex_shift + 5);",
        "    if (!__hex_removed) return [__hex_node, false];",
        "    const __hex_children = __hex_node.children.slice(); __hex_children[__hex_slot] = __hex_updated ?? undefined;",
        "    return [{ kind: 1, children: __hex_children }, true];",
        "  };",
        "  const mapValue = (__hex_root, __hex_size) => ({ root: __hex_root, size: __hex_size, [Symbol.iterator]: function () { return entries(__hex_root); } });",
        "  const setValue = (__hex_root, __hex_size) => ({ root: __hex_root, size: __hex_size, [Symbol.iterator]: function* () { for (const [__hex_key] of entries(__hex_root)) yield __hex_key; } });",
        "  const hashed = (__hex_dictionary, __hex_value) => __hex_dictionary.hash(__hex_value) | 0;",
        "  const emptyMap = () => mapValue(null, 0), emptySet = () => setValue(null, 0);",
        "  const mapSet = __hex_hash => (__hex_map, __hex_key, __hex_value) => { const [__hex_root, __hex_added] = insert(__hex_map.root, hashed(__hex_hash, __hex_key), __hex_key, __hex_value, __hex_hash.eq.equals); return __hex_root === __hex_map.root ? __hex_map : mapValue(__hex_root, __hex_map.size + Number(__hex_added)); };",
        "  const mapRemove = __hex_hash => (__hex_map, __hex_key) => { const [__hex_root, __hex_removed] = discard(__hex_map.root, hashed(__hex_hash, __hex_key), __hex_key, __hex_hash.eq.equals); return __hex_removed ? mapValue(__hex_root, __hex_map.size - 1) : __hex_map; };",
        "  const mapEntry = (__hex_hash, __hex_map, __hex_key) => find(__hex_map.root, hashed(__hex_hash, __hex_key), __hex_key, __hex_hash.eq.equals);",
        "  const mapContainsKey = __hex_hash => (__hex_map, __hex_key) => mapEntry(__hex_hash, __hex_map, __hex_key) !== undefined;",
        "  const mapGet = __hex_hash => (__hex_map, __hex_key) => { const __hex_entry = mapEntry(__hex_hash, __hex_map, __hex_key); if (__hex_entry !== undefined) return __hex_entry[1]; const __hex_error = new Error(\"key is absent\"); __hex_error.name = \"KeyError\"; throw __hex_error; };",
        "  const setAdd = __hex_hash => (__hex_set, __hex_value) => { const [__hex_root, __hex_added] = insert(__hex_set.root, hashed(__hex_hash, __hex_value), __hex_value, undefined, __hex_hash.eq.equals); return __hex_added ? setValue(__hex_root, __hex_set.size + 1) : __hex_set; };",
        "  const setRemove = __hex_hash => (__hex_set, __hex_value) => { const [__hex_root, __hex_removed] = discard(__hex_set.root, hashed(__hex_hash, __hex_value), __hex_value, __hex_hash.eq.equals); return __hex_removed ? setValue(__hex_root, __hex_set.size - 1) : __hex_set; };",
        "  const setContains = __hex_hash => (__hex_set, __hex_value) => find(__hex_set.root, hashed(__hex_hash, __hex_value), __hex_value, __hex_hash.eq.equals) !== undefined;",
        "  const setUnion = __hex_hash => (__hex_left, __hex_right) => { let __hex_result = __hex_left; for (const __hex_value of __hex_right) __hex_result = setAdd(__hex_hash)(__hex_result, __hex_value); return __hex_result; };",
        "  const setIntersect = __hex_hash => (__hex_left, __hex_right) => { let __hex_result = emptySet(); const __hex_has = setContains(__hex_hash); for (const __hex_value of __hex_left) if (__hex_has(__hex_right, __hex_value)) __hex_result = setAdd(__hex_hash)(__hex_result, __hex_value); return __hex_result; };",
        "  const setDifference = __hex_hash => (__hex_left, __hex_right) => { let __hex_result = __hex_left; const __hex_remove = setRemove(__hex_hash); for (const __hex_value of __hex_right) __hex_result = __hex_remove(__hex_result, __hex_value); return __hex_result; };",
        "  const setIsSubsetOf = __hex_hash => (__hex_left, __hex_right) => { const __hex_has = setContains(__hex_hash); for (const __hex_value of __hex_left) if (!__hex_has(__hex_right, __hex_value)) return false; return true; };",
        "  const mapFrom = __hex_hash => __hex_source => { let __hex_result = emptyMap(); const __hex_set = mapSet(__hex_hash); for (const [__hex_key, __hex_value] of __hex_source) __hex_result = __hex_set(__hex_result, __hex_key, __hex_value); return __hex_result; };",
        "  const setFrom = __hex_hash => __hex_source => { let __hex_result = emptySet(); const __hex_add = setAdd(__hex_hash); for (const __hex_value of __hex_source) __hex_result = __hex_add(__hex_result, __hex_value); return __hex_result; };",
        "  const setEquals = __hex_hash => (__hex_left, __hex_right) => __hex_left.size === __hex_right.size && (() => { const __hex_has = setContains(__hex_hash); for (const __hex_value of __hex_left) if (!__hex_has(__hex_right, __hex_value)) return false; return true; })();",
        "  const mapEquals = (__hex_hash, __hex_valueEq) => (__hex_left, __hex_right) => __hex_left.size === __hex_right.size && (() => { for (const [__hex_key, __hex_value] of __hex_left) { const __hex_entry = mapEntry(__hex_hash, __hex_right, __hex_key); if (__hex_entry === undefined || !__hex_valueEq.equals(__hex_value, __hex_entry[1])) return false; } return true; })();",
        "  const setHash = (__hex_hash, __hex_mix) => __hex_set => { let __hex_result = __hex_set.size | 0; for (const __hex_value of __hex_set) __hex_result = (__hex_result + __hex_mix(0x51ed270b, __hex_hash.hash(__hex_value))) | 0; return __hex_result; };",
        "  const mapHash = (__hex_keyHash, __hex_valueHash, __hex_mix) => __hex_map => { let __hex_result = __hex_map.size | 0; for (const [__hex_key, __hex_value] of __hex_map) __hex_result = (__hex_result + __hex_mix(__hex_keyHash.hash(__hex_key), __hex_valueHash.hash(__hex_value))) | 0; return __hex_result; };",
        "  return { emptyMap, emptySet, mapSet, mapRemove, mapContainsKey, mapGet, mapFrom, setAdd, setRemove, setContains, setUnion, setIntersect, setDifference, setIsSubsetOf, setFrom, setEquals, mapEquals, setHash, mapHash, size: __hex_collection => __hex_collection.size, isEmpty: __hex_collection => __hex_collection.size === 0, mapKeys: __hex_map => [...__hex_map].map(__hex_entry => __hex_entry[0]), mapValues: __hex_map => [...__hex_map].map(__hex_entry => __hex_entry[1]), mapEntries: __hex_map => [...__hex_map] };",
        "})();",
      ];
    case "mixHash":
      return [
        `function ${name}(__hex_seed, __hex_value) {`,
        "  return Math.imul(__hex_seed ^ __hex_value, 0x9e3779b1) | 0;",
        "}",
      ];
    case "stableHash":
      return [
        `function ${name}(__hex_value) {`,
        "  if (__hex_value === undefined) return 0;",
        "  if (typeof __hex_value === \"boolean\") return __hex_value ? 1 : 2;",
        "  if (typeof __hex_value === \"number\") { if (Number.isNaN(__hex_value)) return 0x7fc00000; if (Object.is(__hex_value, -0)) return 0; const __hex_text = String(__hex_value); let __hex_hash = 0; for (let __hex_index = 0; __hex_index < __hex_text.length; __hex_index += 1) __hex_hash = Math.imul(__hex_hash, 31) + __hex_text.charCodeAt(__hex_index) | 0; return __hex_hash; }",
        "  const __hex_text = String(__hex_value); let __hex_hash = 0; for (let __hex_index = 0; __hex_index < __hex_text.length; __hex_index += 1) __hex_hash = Math.imul(__hex_hash, 31) + __hex_text.charCodeAt(__hex_index) | 0; return __hex_hash;",
        "}",
      ];
    case "exception":
      return [
        `function ${name}(__hex_name, __hex_message, __hex_fields) {`,
        "  return Object.assign(new Error(__hex_message), { $hex: true, name: __hex_name }, __hex_fields);",
        "}",
      ];
    case "floatEquals":
      return [
        `function ${name}(__hex_left, __hex_right) {`,
        "  return __hex_left === __hex_right || (Number.isNaN(__hex_left) && Number.isNaN(__hex_right));",
        "}",
      ];
    case "compareFloat":
      return [
        `function ${name}(__hex_left, __hex_right) {`,
        "  if (Number.isNaN(__hex_left)) return Number.isNaN(__hex_right) ? 0 : 1;",
        "  if (Number.isNaN(__hex_right)) return -1;",
        "  return __hex_left < __hex_right ? -1 : __hex_left > __hex_right ? 1 : 0;",
        "}",
      ];
    case "ordering":
      // The one representation (#275): every `compare` slot answers with an
      // `Ordering` value, which under Unions §6.2 is the constructor's own
      // name-string. The numeric comparators above are fast-path internals, so
      // this is the single place their sign crosses into the dictionary.
      return [
        `function ${name}(__hex_sign) {`,
        '  return __hex_sign < 0 ? "Less" : __hex_sign > 0 ? "Greater" : "Equal";',
        "}",
      ];
    case "compareString":
      return [
        `function ${name}(__hex_left, __hex_right) {`,
        "  const __hex_leftPoints = Array.from(__hex_left);",
        "  const __hex_rightPoints = Array.from(__hex_right);",
        "  const __hex_length = Math.min(__hex_leftPoints.length, __hex_rightPoints.length);",
        "  for (let __hex_index = 0; __hex_index < __hex_length; __hex_index += 1) {",
        "    const __hex_leftPoint = __hex_leftPoints[__hex_index].codePointAt(0);",
        "    const __hex_rightPoint = __hex_rightPoints[__hex_index].codePointAt(0);",
        "    if (__hex_leftPoint < __hex_rightPoint) return -1;",
        "    if (__hex_leftPoint > __hex_rightPoint) return 1;",
        "  }",
        "  return __hex_leftPoints.length < __hex_rightPoints.length ? -1 : __hex_leftPoints.length > __hex_rightPoints.length ? 1 : 0;",
        "}",
      ];
    case "checkedPower":
      return [
        `function ${name}(__hex_base, __hex_exponent) {`,
        "  if (__hex_exponent < 0) {",
        '    const __hex_error = new Error("an integer exponent cannot be negative");',
        '    __hex_error.name = "NegativeExponentError";',
        "    throw __hex_error;",
        "  }",
        "  return __hex_base ** __hex_exponent;",
        "}",
      ];
    case "range":
      return [
        `function ${name}(__hex_start, __hex_end) {`,
        "  return { start: __hex_start, end: __hex_end, descending: false,",
        "    *[Symbol.iterator]() {",
        "      for (let __hex_value = __hex_start; __hex_value <= __hex_end; __hex_value += 1) yield __hex_value;",
        "    },",
        "  };",
        "}",
      ];
    case "vectorIndex":
      return [
        `function ${name}(__hex_values, __hex_index) {`,
        "  if (__hex_index < 1 || __hex_index > __hex_values.length) { const __hex_error = new RangeError(`index ${__hex_index} out of bounds for size ${__hex_values.length}`); __hex_error.name = \"IndexError\"; __hex_error.$hex = true; __hex_error.index = __hex_index; __hex_error.size = __hex_values.length; throw __hex_error; }",
        "  return __hex_values[__hex_index - 1];",
        "}",
      ];
    case "vectorAt":
      return [
        `function ${name}(__hex_values, __hex_index) {`,
        "  const __hex_position = __hex_index < 0 ? __hex_values.length + __hex_index + 1 : __hex_index;",
        "  if (__hex_position < 1 || __hex_position > __hex_values.length) { const __hex_error = new RangeError(`index ${__hex_index} out of bounds for size ${__hex_values.length}`); __hex_error.name = \"IndexError\"; __hex_error.$hex = true; __hex_error.index = __hex_index; __hex_error.size = __hex_values.length; throw __hex_error; }",
        "  return __hex_values[__hex_position - 1];",
        "}",
      ];
    case "nodeSet":
      // Copy-on-write a fixed-32 trie node; slots are raw (0-based, no bounds
      // check) because only trusted runtime trie code ever emits this.
      return [
        `function ${name}(__hex_node, __hex_index, __hex_value) {`,
        "  const __hex_updated = __hex_node.slice();",
        "  __hex_updated[__hex_index] = __hex_value;",
        "  return __hex_updated;",
        "}",
      ];
    case "vectorSet":
      return [
        `function ${name}(__hex_values, __hex_index, __hex_value) {`,
        "  if (__hex_index < 1 || __hex_index > __hex_values.length) { const __hex_error = new RangeError(`index ${__hex_index} out of bounds for size ${__hex_values.length}`); __hex_error.name = \"IndexError\"; __hex_error.$hex = true; __hex_error.index = __hex_index; __hex_error.size = __hex_values.length; throw __hex_error; }",
        "  const __hex_updated = __hex_values.slice();",
        "  __hex_updated[__hex_index - 1] = __hex_value;",
        "  return __hex_updated;",
        "}",
      ];
    case "vectorSlice":
      return [
        `function ${name}(__hex_values, __hex_range) {`,
        "  if (__hex_range.descending) { const __hex_error = new RangeError(\"a slice window cannot descend\"); __hex_error.name = \"SliceError\"; __hex_error.$hex = true; __hex_error.start = __hex_range.start; __hex_error.end = __hex_range.end; throw __hex_error; }",
        "  return __hex_values.slice(Math.max(0, __hex_range.start - 1), Math.max(0, __hex_range.end));",
        "}",
      ];
    case "stringIndex":
      return [
        `function ${name}(__hex_text, __hex_index) {`,
        "  const __hex_points = Array.from(__hex_text);",
        `  return ${dependencyName("vectorIndex")}(__hex_points, __hex_index);`,
        "}",
      ];
    case "stringSlice":
      return [
        `function ${name}(__hex_text, __hex_range) {`,
        `  return ${dependencyName("vectorSlice")}(Array.from(__hex_text), __hex_range).join("");`,
        "}",
      ];
    // ---------------------------------------------------------------------
    // The FFI Part 3 representation family (ruling R1, amended by the defect-12
    // ruling — Part 3 §9.4). Together these four are the *entire* compiler-side
    // knowledge of how a `Seq` is represented: `seqFromIterable` is the only
    // place the compiler constructs one, `seqToIterable` the only place it
    // drives one, `seqIterate` the boundary traversal method every `Seq` value
    // carries, and `seqInbound` the door that recognizes one arriving from
    // JavaScript. Everything else — every combinator, `next`, the whole public
    // face — lives in prelude `stdlib/Seq.hex`.
    //
    // They are the one sanctioned exception to "nothing outside `.hex` knows
    // `Option`'s or the record's emitted shape", so both shapes are written
    // literally below rather than imported: a record emits as a plain object
    // and a tagged constructor as `{ tag, ...slots }`. Conformance round-trips
    // execute these against `.hex`-side destructuring precisely so a change to
    // either emission breaks loudly here (R5) instead of silently yielding a
    // `Seq` no Hexagon code can pull.
    // ---------------------------------------------------------------------
    case "seqFromIterable":
      // Bridge IN. A foreign iterable is single-shot and mutable; a `Seq` is
      // persistent, so the spine memoizes: every traversal replays the same
      // values and the source advances only when a traversal reaches the
      // frontier. This is what FFI Part 3 §9.1 requires of an exported or
      // imported sequence, and Loops §6.4 names it as the boundary's spine.
      //
      // `[Symbol.iterator]()` is called at the first *pull*, not when the
      // adapter is built: §3 forbids speculative acquisition and forbids
      // restarting foreign computation to discover what kind of iterable this
      // is. Forcing a node then follows §7.2's protocol access order exactly —
      // `next()` once, require an object, read `done` once and **boolean-coerce**
      // it (a `{ done: 1 }` result terminates native iteration and must
      // terminate this), read `value` once and only when not done. The `Boolean`
      // is written out because §7.2 names the coercion, not because the two
      // readers of `__hex_ended` would do anything else with a truthy `done`;
      // what a `{ done: 1 }` source actually does is pinned by a test rather
      // than by that call.
      //
      // **The memo lives in the nodes, never in a central array** (§5, and #131,
      // which is the defect of having done it the other way). §5 decides the
      // representation in as many words — "persistent lazy nodes, not a
      // permanent central history array" — and it decides it for a property it
      // then spends: once an older position is unreachable, its cached prefix
      // may be collected, so "advancing while retaining only the current cursor"
      // costs O(1). A shared buffer closed over by every node inverts exactly
      // that: the newest node would pin the whole forced prefix.
      //
      // So a node holds its own outcome and, on success, a direct reference to
      // its successor. References run head-to-tail only, and the adapter scope
      // below holds no node at all (§5's third clause, that the shared iterator
      // state keeps no back-reference to the head). Retaining position *i*
      // therefore retains the forced *suffix* from *i* and none of **this
      // spine's** prefix.
      //
      // That last qualifier is load-bearing, and the claim is false without it.
      // The adapter keeps `__hex_source` and the iterator it acquired from it,
      // which is §5's permitted shared state — but when the source is itself a
      // `Seq` (both `seqMemoize` and `seqIterate` build the spine over
      // `seqToIterable(s)`, whose generator closes over `s`'s head), that pins
      // the *source's* head, and a source that stores rather than re-derives
      // still has its prefix pinned through it. A second retention channel, in
      // the driver rather than in the memo, filed as #230.
      //
      // **Failure is an outcome the spine memoizes too** (§7.1, and §7.2 step 6
      // for every step above): forcing a position again after it failed must
      // replay the stored throw rather than advance the iterator or repeat the
      // foreign operation. It is per-position for the same reason the value is —
      // §4 says each node memoizes exactly one outcome, and end / `(value,
      // tail)` / failure are the three. The cell is a *box*, not the thrown
      // value itself, since JavaScript permits throwing `undefined`.
      //
      // **Forcing is not reentrant, and the spine says so** (§7.3, the #123
      // ruling). A position whose forcing asks for that same position is asking
      // for the value it is computing; there is no answer, only a choice of
      // wrong one. Two forcings of one position each consume a source element
      // and only one can be the position's value, so the alternatives are losing
      // an element or reordering the sequence — the buffer this spine replaced
      // reordered, and the per-node memo dropped, both silently.
      //
      // So a forcing already in flight is *this spine's* flag, and a pull that
      // reaches the forcing step while it is set throws instead. The check sits
      // **before** the `try`, which is load-bearing: the reentrant pull is of the
      // very node being forced, so a throw from inside the `try` would memoize
      // as that node's failure and poison the position the enclosing forcing is
      // about to answer.
      //
      // Per spine rather than per node, and the reason is only that one node is
      // ever unforced: a tail is built solely in the success path, so the
      // reachable nodes are a chain whose last member is the only one that can
      // reach the check. The two spellings are indistinguishable — no test
      // separates them — and this one keeps the cell off every node. A reentrant
      // pull of an already-memoized position never reaches the check at all:
      // replay is untouched, and a foreign source that looks back at elements it
      // has already produced keeps working, which §7.3 requires.
      //
      // **A refusal is an ordinary failure to every spine it passes through.**
      // A reentrant traversal that arrives through a second spine — most often
      // the §9.4 boundary view, since that is JavaScript's route into a `Seq`
      // value — meets the refusal as a throw out of *its* source, and §7.1
      // memoizes it there. The Hexagon-side traversal completes correctly; the
      // value is finished as an `Iterable` to JavaScript.
      //
      // §7.3 **records** that rather than ruling it, and issue #232 owns the
      // decision. The repair that suggests itself — decline to memoize a refusal
      // you did not raise — is worse *as things stand*: the throw travels out
      // through `seqToIterable`'s generator, a generator that has thrown is
      // completed, the next forcing reads `done` off it and memoizes end, and
      // the value reads as empty to JavaScript instead of raising. Measured, not
      // argued. But the completion is an artifact of the driver being a
      // generator, which nothing in Part 3 requires: with `seqToIterable`
      // emitting an explicit cursor, the same repair keeps the foreign face
      // working, and the whole suite passes but for the test pinning today's
      // behaviour. Both halves would land together, and `seqToIterable` is half
      // of R1 and the internal channel's driver, so it is #232's to weigh.
      //
      // **`ReentrancyError`, a declared Hexagon exception** (§7.4), not a
      // manufactured `TypeError`. The condition is one Hexagon detects in state
      // Hexagon owns, so it leaves through the domestic door: Exceptions §1's
      // one-door doctrine puts every Hexagon-originated exception behind a
      // declared constructor and reserves `JsError` for what JavaScript threw.
      // §7.2's `TypeError` is the platform's own voice — the minimum protocol
      // check native iteration performs, reporting foreign misbehaviour — and
      // this check is lawful on the opposite ground, that it is *not* a protocol
      // check and reads no foreign value, so it cannot borrow that kind.
      //
      // Constructed inline as Exceptions §7.1's representation rather than by
      // calling `Seq.hex`'s constructor, exactly as the emitted `IndexError` and
      // `SliceError` are: exception identity is `name` under the `$hex` brand,
      // chosen over prototype identity precisely so that every module's copy of
      // this helper and the one `.hex` declaration coincide on one nominal
      // exception. Fresh per refusal (§7.3 of Exceptions), so the stack points
      // at the reentrant pull. The message is a diagnostic rendering and is
      // non-normative — recognition is the `name`, never the text.
      //
      // What the enclosing forcing observes is nothing at all, unless the
      // foreign code lets the throw propagate out of `next()` — in which case it
      // is that position's failure by §7.1, like any other throw from the source.
      //
      // Serialized forcings are why nothing else here guards against collision.
      // Each node is forced exactly once, so a store never meets a value already
      // present; and **this spine** cannot have observed `done` while one of its
      // nodes is unforced, since that node was built from a not-done result and
      // none is built from an ended one. The qualifier is not decoration — two
      // adapters over one self-iterable foreign iterator can drive each other's
      // shared cursor to exhaustion, which is §2.1's documented "repeated
      // crossings of a single-pass generator observe its current position" and
      // behaves the same here as it did before. The shared `done` flag and the
      // first-writer guards that stood here between #131 and #123 were repairs
      // for collisions this ruling makes unreachable, and dead code whose
      // comment claims otherwise is worse than none. The `finally` above is the
      // one thing kept without a test behind it: a stuck flag is unobservable
      // (no node exists past a failed one), but a `finally` asserts nothing,
      // which is what separates it from the three that went.
      //
      // Every node carries the boundary traversal method (§9.4): the adapter is
      // one of the ruling's two named construction sites, and a `Seq` built here
      // is as much a `Seq` as one `Seq.hex` builds — an adapted foreign iterable
      // handed straight back out to JavaScript must face it as an `Iterable`.
      return [
        `function ${name}(__hex_source) {`,
        "  let __hex_iterator = undefined;",
        "  let __hex_forcing = false;",
        "  const __hex_node = () => {",
        "    let __hex_step = undefined;",
        "    let __hex_failure = undefined;",
        "    return {",
        `      [Symbol.iterator]: ${dependencyName("seqIterate")},`,
        "      pull: () => {",
        "        if (__hex_step === undefined && __hex_failure === undefined) {",
        "          if (__hex_forcing) {",
        '            throw Object.assign(new Error("Seq position is already being forced: a sequence position cannot depend on its own value"), { $hex: true, name: "ReentrancyError" });',
        "          }",
        "          __hex_forcing = true;",
        "          try {",
        "            if (__hex_iterator === undefined) __hex_iterator = __hex_source[Symbol.iterator]();",
        "            const __hex_next = __hex_iterator.next();",
        '            if (__hex_next === null || (typeof __hex_next !== "object" && typeof __hex_next !== "function")) {',
        '              throw new TypeError("Iterator result " + String(__hex_next) + " is not an object");',
        "            }",
        "            __hex_step = Boolean(__hex_next.done)",
        '              ? { tag: "None" }',
        '              : { tag: "Some", value: [__hex_next.value, __hex_node()] };',
        "          } catch (__hex_error) {",
        "            __hex_failure = { error: __hex_error };",
        "            throw __hex_error;",
        "          } finally {",
        "            __hex_forcing = false;",
        "          }",
        "        }",
        "        if (__hex_failure !== undefined) throw __hex_failure.error;",
        "        return __hex_step;",
        "      },",
        "    };",
        "  };",
        "  return __hex_node();",
        "}",
      ];
    case "seqMemoize":
      // Loops §6.4's explicit opt-in, lowered for `spec/intrinsics.md` §3.2's
      // declaration. Re-derivation is the internal default, so a `Seq` whose
      // steps are effectful and which will be traversed more than once is the
      // caller's cue to come here; the result replays cached elements instead of
      // recomputing, at the cost of retaining what is forced and still
      // reachable. Since #131 this spine's own nodes hold the memo, so a cursor
      // no longer pins the part of *it* that the cursor has passed.
      //
      // **That is not yet true of a `memoize` whose source stores**, and this is
      // the helper where it bites hardest, because the composition below is
      // precisely the one that pins its source's head: `seqToIterable`'s
      // generator closes over `s`, so `Seq.memoize` over an inbound-adapted
      // `Seq` (or over another `memoize`) still retains everything through it.
      // The second retention channel is #230, and until it closes the honest
      // statement of `memoize`'s cost is "the forced suffix, plus whatever the
      // source itself is holding".
      //
      // No new spine is built. §6.4 names the mechanism as *the same* one FFI
      // Part 3's inbound adapter uses, so the lowering is literally the R1 pair
      // composed: `seqToIterable` exposes the source's persistent traversal as an
      // iterable, and `seqFromIterable` puts the memoizing spine over it. Every
      // §6.4 property then holds by inheritance rather than by re-derivation of
      // the argument — including failure memoization (Part 3 §7.1), which the
      // spine already provides and which composition cannot weaken.
      //
      // Composition is sound here for the reason §4's retention rule states: the
      // outbound view is created once, at this call, so all traversals of the
      // result share the one spine over the one iterator. Handing `seqToIterable`
      // a `Seq` does not consume it — the argument is left as it was, and
      // memoizing it does not change *it*, only the value returned.
      return [
        `function ${name}(__hex_source) {`,
        `  return ${dependencyName("seqFromIterable")}(${dependencyName("seqToIterable")}(__hex_source));`,
        "}",
      ];
    case "seqIterate":
      // **The face.** FFI Part 3 §9.4: the JavaScript iterable protocol is part
      // of a `Seq`'s representation, not plumbing bolted on at a crossing, which
      // is exactly what lets Part 7 §6's identity clause hold — the value crosses
      // out and back unmodified, and what JavaScript finds on it was always
      // there. One shared method for every `Seq` value in the module, never a
      // per-value closure, so carrying the face costs a property slot.
      //
      // The per-value state it needs lives in a `WeakMap` rather than a slot on
      // the record, so a `Seq` JavaScript never traverses gains nothing at all
      // (§9.4 property 3) and so the view never becomes visible to a JS consumer
      // enumerating the value. Retention is §5's addendum verbatim: the view is
      // reachable only from the value, so it is collected with it. The key is
      // reachable from its own entry (the view's spine drives the value), which
      // is the textbook ephemeron cycle `WeakMap` is specified to collect.
      //
      // The body is the ruling's own representative implementation — the R1 pair
      // composed, the inbound spine driven over the value's `pull` traversal —
      // and the seven normative properties are what it is checked against:
      // independent cursors (1) because each call makes a fresh driver over the
      // shared spine; at-most-once derivation (2) and memoized failure (4)
      // because the spine memoizes both; lazy view creation (3) because nothing
      // is built until the first call and the spine acquires its iterator only
      // at the first pull; preserved laziness (5) because a cursor forces only
      // what it reaches; per-cursor `return()` (6) because abandoning the
      // generator touches neither the spine nor any other cursor; retention (7)
      // as above.
      //
      // "Checked against" means checked, not argued: all seven have executing
      // tests in `conformance/seq-boundary-view.test.ts`, one describe block
      // each. Property 7 is the one that needed machinery — collectability of
      // the `WeakMap`'s ephemeron cycle has no ordinary observable — so that
      // test exposes `gc` in-process and watches a `WeakRef`. Replacing the
      // `WeakMap` below with a `Map` fails it and nothing else.
      //
      // `this` is the traversed `Seq`: the method is an own property, so the
      // protocol calls it with the value as receiver.
      return [
        `const ${name} = (() => {`,
        "  const __hex_views = new WeakMap();",
        "  return function () {",
        "    let __hex_view = __hex_views.get(this);",
        "    if (__hex_view === undefined) {",
        `      __hex_view = ${dependencyName("seqFromIterable")}(${dependencyName("seqToIterable")}(this));`,
        "      __hex_views.set(this, __hex_view);",
        "    }",
        `    return ${dependencyName("seqToIterable")}(__hex_view)[Symbol.iterator]();`,
        "  };",
        "})();",
      ];
    case "seqInbound":
      // **The door** (FFI Part 3 §2.2). A genuine `Seq` handed back at a `Seq(a)`
      // position is not adapted — it crosses by identity, same spine, same
      // persistence regime (Part 7 §6). Anything else iterable gets a fresh
      // adapter, which is §2.1 unchanged and whose subject that case is.
      //
      // Recognition is by the representation's own mark. `[Symbol.iterator]`
      // cannot be it — every iterable the door must *adapt* has one too — and
      // the method's identity cannot be it either, since helpers are emitted per
      // module and a `Seq` from another module carries that module's copy. So
      // the test is `pull`, the half of §9.4's representation that is the
      // record. §2.2 leaves the exact test to the emitter and rules a fabricated
      // look-alike a trusted-boundary contract violation (Part 1 §3.1), so no
      // validation is added beyond it.
      return [
        `function ${name}(__hex_value) {`,
        '  return __hex_value != null && typeof __hex_value.pull === "function"',
        "    ? __hex_value",
        `    : ${dependencyName("seqFromIterable")}(__hex_value);`,
        "}",
      ];
    case "seqToIterable":
      // Bridge OUT, and the **internal** channel's driver. A `while` loop over
      // `pull`, never recursion: Loops §6.5 promises no tail-call elimination,
      // so driving a long `Seq` recursively would grow the stack. Re-iterating
      // restarts from the head, which is persistence, not memoization — the
      // `Seq` handed in is unconsumed.
      //
      // Channel separation (§9.4) is why this stays distinct from the face: a
      // driver built here consults no boundary view, so lowering `for x in`
      // through it keeps re-derivation as the internal default. Lowering it to
      // native `for...of` over the record instead would silently import boundary
      // memoization, and its retention, into internal semantics.
      return [
        `function ${name}(__hex_sequence) {`,
        "  return {",
        "    *[Symbol.iterator]() {",
        "      let __hex_current = __hex_sequence;",
        "      while (true) {",
        "        const __hex_step = (__hex_current.pull)();",
        '        if (__hex_step.tag !== "Some") return;',
        "        yield __hex_step.value[0];",
        "        __hex_current = __hex_step.value[1];",
        "      }",
        "    },",
        "  };",
        "}",
      ];
  }
}

/** Selects compiler-owned operations over persistent hash-array-mapped tries. */
function collectionOperation(
  collection: Core.CollectionOperationExpr["collection"],
  operation: string,
  runtime: string,
  hash?: string,
  /** The inbound adapter, for the rows that produce a `Seq` (ruling R1). */
  seqFrom?: string,
  /** The outbound driver, for the rows that consume one. */
  seqTo?: string,
): string {
  const dictionaries = `${hash}`;
  if (collection === "Map") {
    if (operation === "empty") return `${runtime}.emptyMap`;
    if (["set", "remove", "containsKey", "get"].includes(operation)) {
      return `${runtime}.map${operation[0]!.toUpperCase()}${operation.slice(1)}(${dictionaries})`;
    }
    if (operation === "size") return `${runtime}.size`;
    if (operation === "isEmpty") return `${runtime}.isEmpty`;
    if (["keys", "values", "entries"].includes(operation)) return `__hex_map => ${seqFrom}(${runtime}.map${operation[0]!.toUpperCase()}${operation.slice(1)}(__hex_map))`;
    if (operation === "toSeq") return `__hex_map => ${seqFrom}(${runtime}.mapEntries(__hex_map))`;
    if (operation === "fromVector") return `${runtime}.mapFrom(${dictionaries})`;
    if (operation === "fromSeq" || operation === "fromEntries") return `__hex_entries => ${runtime}.mapFrom(${dictionaries})(${seqTo}(__hex_entries))`;
  }
  if (collection === "Set") {
    if (operation === "empty") return `${runtime}.emptySet`;
    if (["add", "remove", "contains", "union", "intersect", "difference", "isSubsetOf"].includes(operation)) {
      return `${runtime}.set${operation[0]!.toUpperCase()}${operation.slice(1)}(${dictionaries})`;
    }
    if (operation === "size") return `${runtime}.size`;
    if (operation === "isEmpty") return `${runtime}.isEmpty`;
    if (operation === "toSeq") return `__hex_set => ${seqFrom}(__hex_set)`;
    if (operation === "fromVector") return `${runtime}.setFrom(${dictionaries})`;
    if (operation === "fromSeq") return `__hex_values => ${runtime}.setFrom(${dictionaries})(${seqTo}(__hex_values))`;
  }
  if (operation === "empty") return "() => []";
  if (operation === "length") return "__hex_vector => __hex_vector.length";
  if (operation === "isEmpty") return "__hex_vector => __hex_vector.length === 0";
  if (operation === "append") return "(__hex_vector, __hex_value) => [...__hex_vector, __hex_value]";
  if (operation === "prepend") return "(__hex_vector, __hex_value) => [__hex_value, ...__hex_vector]";
  if (operation === "at") {
    return "(__hex_vector, __hex_index) => { const __hex_position = __hex_index < 0 ? __hex_vector.length + __hex_index + 1 : __hex_index; if (__hex_position < 1 || __hex_position > __hex_vector.length) { const __hex_error = new RangeError(`index ${__hex_index} out of bounds for size ${__hex_vector.length}`); __hex_error.name = \"IndexError\"; __hex_error.$hex = true; __hex_error.index = __hex_index; __hex_error.size = __hex_vector.length; throw __hex_error; } return __hex_vector[__hex_position - 1]; }";
  }
  if (operation === "set") {
    return "(__hex_vector, __hex_index, __hex_value) => { if (__hex_index < 1 || __hex_index > __hex_vector.length) { const __hex_error = new RangeError(`index ${__hex_index} out of bounds for size ${__hex_vector.length}`); __hex_error.name = \"IndexError\"; __hex_error.$hex = true; __hex_error.index = __hex_index; __hex_error.size = __hex_vector.length; throw __hex_error; } const __hex_updated = __hex_vector.slice(); __hex_updated[__hex_index - 1] = __hex_value; return __hex_updated; }";
  }
  if (operation === "toSeq") return `__hex_vector => ${seqFrom}(__hex_vector)`;
  if (operation === "fromSeq") return `__hex_values => Array.from(${seqTo}(__hex_values))`;
  return "() => undefined";
}

/** Emits the fixed primitive companion families without inventing runtime objects. */
function primitiveOperation(
  primitive: Core.PrimitiveOperationExpr["primitive"],
  operation: Core.PrimitiveOperationExpr["operation"],
): string {
  const zero = primitive === "BigInt" ? "0n" : "0";
  if (primitive === "Float") {
    if (operation === "rem") return "(__hex_a, __hex_b) => __hex_a % __hex_b";
    return "(__hex_a, __hex_b) => { const __hex_r = __hex_a % __hex_b; return __hex_r < 0 ? __hex_r + Math.abs(__hex_b) : __hex_r; }";
  }
  const guard = `if (__hex_b === ${zero}) { const __hex_error = new Error(${JSON.stringify(`${primitive}.${operation}: divisor is zero`)}); __hex_error.name = \"DivideByZeroError\"; __hex_error.$hex = true; throw __hex_error; }`;
  if (operation === "rem") return `(__hex_a, __hex_b) => { ${guard} return __hex_a % __hex_b; }`;
  if (operation === "quot") {
    return primitive === "BigInt"
      ? `(__hex_a, __hex_b) => { ${guard} return __hex_a / __hex_b; }`
      : `(__hex_a, __hex_b) => { ${guard} return Math.trunc(__hex_a / __hex_b); }`;
  }
  if (operation === "mod") {
    return `(__hex_a, __hex_b) => { ${guard} const __hex_r = __hex_a % __hex_b; const __hex_abs = __hex_b < ${zero} ? -__hex_b : __hex_b; return __hex_r < ${zero} ? __hex_r + __hex_abs : __hex_r; }`;
  }
  if (operation === "div") {
    return `(__hex_a, __hex_b) => { ${guard} const __hex_r0 = __hex_a % __hex_b; const __hex_abs = __hex_b < ${zero} ? -__hex_b : __hex_b; const __hex_r = __hex_r0 < ${zero} ? __hex_r0 + __hex_abs : __hex_r0; return (__hex_a - __hex_r) / __hex_b; }`;
  }
  if (operation === "gcd") {
    const left = primitive === "BigInt"
      ? "(__hex_a < 0n ? -__hex_a : __hex_a)"
      : "Math.abs(__hex_a)";
    const right = primitive === "BigInt"
      ? "(__hex_b < 0n ? -__hex_b : __hex_b)"
      : "Math.abs(__hex_b)";
    return `(__hex_a, __hex_b) => { let __hex_x = ${left}; let __hex_y = ${right}; while (__hex_y !== ${zero}) { const __hex_t = __hex_x % __hex_y; __hex_x = __hex_y; __hex_y = __hex_t; } return __hex_x; }`;
  }
  return `(__hex_a, __hex_b) => { if (__hex_a === ${zero} || __hex_b === ${zero}) return ${zero}; const __hex_gcd = ${primitiveOperation(primitive, "gcd")}; const __hex_value = (__hex_a / __hex_gcd(__hex_a, __hex_b)) * __hex_b; return __hex_value < ${zero} ? -__hex_value : __hex_value; }`;
}

type PrimitiveOperationHelper = Extract<
  Helper,
  | "intDiv" | "intMod" | "intQuot" | "intRem" | "intGcd"
  | "bigIntDiv" | "bigIntMod" | "bigIntQuot" | "bigIntRem" | "bigIntGcd" | "bigIntLcm"
  | "floatMod" | "floatRem"
>;

function primitiveOperationHelper(
  primitive: Core.PrimitiveOperationExpr["primitive"],
  operation: Core.PrimitiveOperationExpr["operation"],
): PrimitiveOperationHelper {
  const owner = primitive === "BigInt" ? "bigInt" : primitive.toLowerCase();
  return `${owner}${operation[0]!.toUpperCase()}${operation.slice(1)}` as PrimitiveOperationHelper;
}

function primitiveOperationFromHelper(
  helper: PrimitiveOperationHelper,
): readonly [Core.PrimitiveOperationExpr["primitive"], Core.PrimitiveOperationExpr["operation"]] {
  const primitive = helper.startsWith("bigInt")
    ? "BigInt"
    : helper.startsWith("float")
    ? "Float"
    : "Int";
  const ownerLength = primitive === "BigInt" ? 6 : primitive === "Float" ? 5 : 3;
  const operation = helper.slice(ownerLength).toLowerCase() as Core.PrimitiveOperationExpr["operation"];
  return [primitive, operation];
}

class GeneratedNames {
  readonly #used: Set<string>;
  readonly #next = new Map<string, number>();

  constructor(existing: Iterable<string>) {
    this.#used = new Set(existing);
  }

  fixed(stem: string): string {
    return this.#claim(stem);
  }

  fresh(stem: string): string {
    let index = this.#next.get(stem) ?? 0;
    while (true) {
      const name = this.#claim(`${stem}${index}`);
      this.#next.set(stem, index + 1);
      return name;
    }
  }

  #claim(stem: string): string {
    const base = `__hex_${stem}`;
    let name = base;
    let suffix = 1;
    while (this.#used.has(name)) name = `${base}${suffix++}`;
    this.#used.add(name);
    return name;
  }
}

function dictionaryEntries(scheme: Typed.Scheme): readonly {
  readonly constraint: Typed.ConstraintName;
  readonly variable: Typed.TypeVariableId;
}[] {
  return scheme.constraints
    .flatMap((constraint) =>
      constraint.type.kind === "Variable"
        ? [{ constraint: constraint.name, variable: constraint.type.id }]
        : [],
    )
    .sort(
      (left, right) =>
        Number(left.variable) - Number(right.variable) ||
        left.constraint.localeCompare(right.constraint),
    );
}

function substituteType(
  type: Typed.Type,
  replacements: ReadonlyMap<Typed.TypeVariableId, Typed.Type>,
): Typed.Type {
  if (type.kind === "Variable") return replacements.get(type.id) ?? type;
  if (type.kind === "Function") {
    return {
      kind: "Function",
      parameters: type.parameters.map((parameter) => substituteType(parameter, replacements)),
      result: substituteType(type.result, replacements),
    };
  }
  if (type.kind === "Tuple") {
    return { kind: "Tuple", elements: type.elements.map((element) =>
      substituteType(element, replacements)
    ) };
  }
  if (type.kind === "Vector") {
    return { kind: "Vector", element: substituteType(type.element, replacements) };
  }
  if (type.kind === "Node") {
    return { kind: "Node", element: substituteType(type.element, replacements) };
  }
  if (type.kind === "Record") {
    return {
      ...type,
      fields: type.fields.map((field) => ({
        ...field,
        type: substituteType(field.type, replacements),
      })),
    };
  }
  if (type.kind === "Union" || type.kind === "NominalRecord") {
    return {
      ...type,
      arguments: type.arguments.map((argument) => substituteType(argument, replacements)),
    };
  }
  return type;
}

/**
 * Composes component `Ordering`s left to right: the first component that is not
 * `Equal` decides. Nothing here is arithmetic — every operand is already an
 * `Ordering` name-string (#275), so the empty case (a `Unit`, an empty record, a
 * nullary constructor's slots) is `"Equal"`, not a zero.
 */
function lexicographicComparison(comparisons: readonly string[]): string {
  if (comparisons.length === 0) return '"Equal"';
  const statements = comparisons.map((comparison, index) =>
    `const __hex_order${index} = ${comparison}; if (__hex_order${index} !== "Equal") return __hex_order${index};`
  );
  return `(() => { ${statements.join(" ")} return "Equal"; })()`;
}

function dictionaryParameterName(
  constraint: Typed.ConstraintName,
  variable: Typed.TypeVariableId,
): string {
  return `__hex_dict${constraint}_${Number(variable)}`;
}

function primitiveDictionary(
  constraint: Typed.ConstraintName,
  instance: Typed.PrimitiveName,
  helperName: (helper: Helper) => string,
): string {
  switch (constraint) {
    case "Num": {
      const fromNat = instance === "BigInt"
        ? "BigInt(__hex_a)"
        : "__hex_a";
      return `({ add: (__hex_a, __hex_b) => __hex_a + __hex_b, multiply: (__hex_a, __hex_b) => __hex_a * __hex_b, fromNat: __hex_a => ${fromNat} })`;
    }
    case "Signed": {
      const fromInt = instance === "BigInt"
        ? "BigInt(__hex_a)"
        : "__hex_a";
      return `({ num: ${primitiveDictionary("Num", instance, helperName)}, subtract: (__hex_a, __hex_b) => __hex_a - __hex_b, negate: __hex_a => -__hex_a, fromInt: __hex_a => ${fromInt} })`;
    }
    case "Frac":
      return `({ signed: ${primitiveDictionary("Signed", instance, helperName)}, divide: (__hex_a, __hex_b) => __hex_a / __hex_b })`;
    case "Concat":
      return "({ concat: (__hex_a, __hex_b) => __hex_a + __hex_b })";
    case "Pow":
      return instance === "Float"
        ? `({ num: ${primitiveDictionary("Num", instance, helperName)}, pow: (__hex_a, __hex_b) => __hex_a ** __hex_b })`
        : `({ num: ${primitiveDictionary("Num", instance, helperName)}, pow: (__hex_a, __hex_b) => ${helperName("checkedPower")}(__hex_a, __hex_b) })`;
    case "Eq":
      return instance === "Float"
        ? "({ equals: (__hex_a, __hex_b) => __hex_a === __hex_b || (__hex_a !== __hex_a && __hex_b !== __hex_b), notEquals: (__hex_a, __hex_b) => !(__hex_a === __hex_b || (__hex_a !== __hex_a && __hex_b !== __hex_b)) })"
        : "({ equals: (__hex_a, __hex_b) => __hex_a === __hex_b, notEquals: (__hex_a, __hex_b) => __hex_a !== __hex_b })";
    case "Ord":
      // A `compare` slot answers with an `Ordering`, here as everywhere (#275).
      // The comparators keep their semantics — `compareFloat`'s total order over
      // NaN, `compareString`'s codepoint order — and `ordering` turns the sign
      // they return into the constructor the slot owes its caller.
      if (instance === "Float") {
        return `({ eq: ${primitiveDictionary("Eq", instance, helperName)}, compare: (__hex_a, __hex_b) => ${helperName("ordering")}(${helperName("compareFloat")}(__hex_a, __hex_b)) })`;
      }
      if (instance === "String") {
        return `({ eq: ${primitiveDictionary("Eq", instance, helperName)}, compare: (__hex_a, __hex_b) => ${helperName("ordering")}(${helperName("compareString")}(__hex_a, __hex_b)) })`;
      }
      return `({ eq: ${primitiveDictionary("Eq", instance, helperName)}, compare: (__hex_a, __hex_b) => __hex_a < __hex_b ? "Less" : __hex_a > __hex_b ? "Greater" : "Equal" })`;
    case "Show":
      if (instance === "String") return "({ show: __hex_a => __hex_a })";
      return "({ show: __hex_a => String(__hex_a) })";
    case "Hash":
      return instance === "Float"
        ? `({ eq: { equals: (__hex_a, __hex_b) => __hex_a === __hex_b || (__hex_a !== __hex_a && __hex_b !== __hex_b), notEquals: (__hex_a, __hex_b) => !(__hex_a === __hex_b || (__hex_a !== __hex_a && __hex_b !== __hex_b)) }, hash: __hex_a => ${helperName("stableHash")}(__hex_a) })`
        : `({ eq: { equals: (__hex_a, __hex_b) => __hex_a === __hex_b, notEquals: (__hex_a, __hex_b) => __hex_a !== __hex_b }, hash: __hex_a => ${helperName("stableHash")}(__hex_a) })`;
    case "Integral": {
      const num = primitiveDictionary("Num", instance, helperName);
      const ordering = primitiveDictionary("Ord", instance, helperName);
      const operationOwner = instance === "Nat" ? "Int" : instance;
      const member = (operation: Core.PrimitiveOperationExpr["operation"]): string =>
        helperName(primitiveOperationHelper(operationOwner as "Int" | "BigInt", operation));
      return `({ num: ${num}, ord: ${ordering}, div: ${member("div")}, mod: ${member("mod")}, quot: ${member("quot")}, rem: ${member("rem")}, gcd: ${member("gcd")} })`;
    }
    default:
      return "({})";
  }
}

function evidenceKey(
  variable: Typed.TypeVariableId,
  constraint: Typed.ConstraintName,
): string {
  return `${Number(variable)}:${constraint}`;
}

function internalConstrainedExportName(symbol: Resolved.SymbolId): string {
  return `__hex_export${Number(symbol)}`;
}

/**
 * The home module's hoisted helper for a defaulted constraint member
 * (Constraints §6.5), named after the member's symbol so every inheriting
 * instance — in any module — spells the same one.
 */
function defaultHelperName(symbol: Resolved.SymbolId): string {
  return `__hex_default${Number(symbol)}`;
}

/**
 * The relational four against an `Ordering` result (Operators §5.1): `a < b` is
 * `compare(a, b) == Less`, and so on — a **constructor test**, never a sign
 * test. This is the form every dictionary `compare` call takes, because a
 * dictionary slot holds `(a, a) -> Ordering` whether the instance was derived
 * or hand-written (#275). The operand is the Unions §6.2 name-string.
 *
 * The `Equal`/`NotEqual` arms are unreachable from the comparison lowering —
 * those tests go through `Eq`'s `equals`/`notEquals` before any `compare` is
 * reached — but `ComparisonTest` is a closed set and the switch is total.
 */
function comparisonFromOrdering(test: Core.ComparisonTest, ordering: string): string {
  switch (test) {
    case "Less":
      return `${ordering} === "Less"`;
    case "Greater":
      return `${ordering} === "Greater"`;
    case "LessEqual":
      return `${ordering} !== "Greater"`;
    case "GreaterEqual":
      return `${ordering} !== "Less"`;
    case "Equal":
      return `${ordering} === "Equal"`;
    case "NotEqual":
      return `${ordering} !== "Equal"`;
  }
}

/**
 * The same four against a numeric comparator's sign. Legal only where the
 * number never crosses a dictionary or FFI boundary — that is, the primitive
 * fast path, where `#emitComparisonStep` calls `compareFloat`/`compareString`
 * directly and consumes the result in the same expression.
 */
function comparisonFromSign(test: Core.ComparisonTest, order: string): string {
  switch (test) {
    case "Less":
      return `${order} < 0`;
    case "Greater":
      return `${order} > 0`;
    case "LessEqual":
      return `${order} <= 0`;
    case "GreaterEqual":
      return `${order} >= 0`;
    case "Equal":
      return `${order} === 0`;
    case "NotEqual":
      return `${order} !== 0`;
  }
}

function comparisonOperator(
  test: Exclude<Core.ComparisonTest, "Equal" | "NotEqual">,
): string {
  switch (test) {
    case "Less":
      return "<";
    case "Greater":
      return ">";
    case "LessEqual":
      return "<=";
    case "GreaterEqual":
      return ">=";
  }
}

function renderScheme(
  scheme: Typed.Scheme,
  faces: DeclarationFaces,
  value?: Core.Expr,
): string {
  const type = scheme.type;
  // A `declare const` has nowhere to put a quantifier, so a polymorphic value's
  // face is one instantiation of it (FFI Part 7 §14.1): `never` for each
  // quantified type variable, the empty row for a quantified row tail. Naming
  // the binders here instead would print a type variable no declaration binds,
  // and a `.d.ts` that does not compile (#132).
  if (type.kind !== "Function") {
    return renderType(type, neverInstantiation(scheme.variables), faces, false);
  }
  const variables = typeVariableNames(scheme.variables);
  const lambda = value?.kind === "Lambda" ? value : undefined;

  const genericNames = scheme.variables.map((variable) => variables.get(variable)!);
  const generics = genericNames.length === 0
    ? ""
    : `<${genericNames.join(", ")}>`;
  const names = declarationParameterNames(lambda?.parameters ?? [], type.parameters.length);
  const parameters = type.parameters.map(
    (parameter, index) => `${names[index]}: ` + renderType(parameter, variables, faces, false),
  );
  return (
    `${generics}(${parameters.join(", ")}) => ` +
    renderType(type.result, variables, faces, true, lambda?.body)
  );
}

function renderExternFunctionDeclaration(
  declaration: Core.ExternBlockItem["declarations"][number] & { readonly kind: "ExternFun" },
  exported: boolean,
  faces: DeclarationFaces,
): readonly string[] {
  const names = declarationParameterNames(
    declaration.parameters,
    declaration.parameters.length,
  );
  // Foreign externs are monomorphic (FFI Part 4 §12.4) and quantify nothing, so
  // this is empty for them. Intrinsic declarations may be generic (§3.4), and
  // their face has to quantify what their scheme does.
  const variables = typeVariableNames(declaration.binding.scheme.variables);
  const genericNames = declaration.binding.scheme.variables.map((variable) =>
    variables.get(variable)!
  );
  const generics = genericNames.length === 0 ? "" : `<${genericNames.join(", ")}>`;
  const parameters = declaration.parameters.map((parameter, index) =>
    `${names[index]}: ${renderType(parameter.scheme.type, variables, faces, false)}`
  );
  const result = renderType(declaration.result, variables, faces, true);
  const safe = isSafeIdentifier(declaration.localName);
  const local = safe
    ? declaration.localName
    : `__hex_binding${Number(declaration.binding.symbol)}`;
  if (safe) {
    return [
      `${exported ? "export " : ""}declare function ${local}${generics}(${parameters.join(", ")}): ${result};`,
    ];
  }
  const lines = [
    `declare const ${local}: ${generics}(${parameters.join(", ")}) => ${result};`,
  ];
  if (exported) lines.push(`export { ${local} as ${declaration.localName} };`);
  return lines;
}

function renderFunctionDeclaration(
  name: string,
  scheme: Typed.Scheme,
  value: Core.LambdaExpr,
  exported: boolean,
  faces: DeclarationFaces,
): string {
  if (scheme.type.kind !== "Function") {
    const prefix = exported ? "export " : "";
    return `${prefix}declare const ${name}: ${renderScheme(scheme, faces, value)};`;
  }

  const variables = typeVariableNames(scheme.variables);
  const genericNames = scheme.variables.map((variable) => variables.get(variable)!);
  const generics = genericNames.length === 0
    ? ""
    : `<${genericNames.join(", ")}>`;
  const names = declarationParameterNames(value.parameters, scheme.type.parameters.length);
  const parameters = scheme.type.parameters.map(
    (parameter, index) => `${names[index]}: ` + renderType(parameter, variables, faces, false),
  );
  const result = renderType(scheme.type.result, variables, faces,
    true,
    value.body,
  );
  const prefix = exported ? "export " : "";
  return (
    `${prefix}declare function ${name}${generics}` +
    `(${parameters.join(", ")}): ${result};`
  );
}

/**
 * A nominal type under the local it is spelled by — its own name, or the one
 * §2.4's inventory settled on for a prelude-supplied type.
 */
function renderNominal(
  local: string,
  args: readonly Typed.Type[],
  variables: ReadonlyMap<Typed.TypeVariableId, string>,
  faces: DeclarationFaces,
): string {
  return args.length === 0
    ? local
    : `${local}<${args.map((argument) =>
      renderType(argument, variables, faces, false)
    ).join(", ")}>`;
}

function renderType(
  type: Typed.Type,
  variables: ReadonlyMap<Typed.TypeVariableId, string>,
  faces: DeclarationFaces,
  returnPosition: boolean,
  value?: Core.Expr,
): string {
  switch (type.kind) {
    case "Primitive":
      switch (type.name) {
        case "Nat":
        case "Int":
        case "Float":
          return "number";
        case "String":
          return "string";
        case "BigInt":
          return "bigint";
        case "Exn":
          return "Error & { readonly $hex: true; readonly name: string }";
      }
    case "Variable":
      return variables.get(type.id) ?? "unknown";
    // The four runtime collection faces (FFI Part 1 §4.1, §8.1–§8.3). They are
    // branded rather than structural because an arbitrary iterable is not one of
    // these values, and they are not `ReadonlyArray`/`ReadonlyMap`/`ReadonlySet`
    // because the runtime values do not implement those APIs — a consumer who
    // called `map.get(k)` through the old face typechecked and failed at run
    // time (§8.4 item 1). `Seq` keeps the structural `Iterable<a>` below: its
    // parameter positions must admit arbitrary foreign iterables (§8.2).
    case "Range":
      return faces.runtime.reference("Range");
    case "Vector":
      return faces.runtime.reference("Vector", renderType(type.element, variables, faces, false));
    case "Set":
      return faces.runtime.reference("Set", renderType(type.element, variables, faces, false));
    case "Map":
      return faces.runtime.reference(
        "Map",
        renderType(type.key, variables, faces, false),
        renderType(type.value, variables, faces, false),
      );
    case "Array":
      // A borrowed foreign array is readonly to Hexagon and has no mutation
      // surface (FFI Part 1 §4.1; Part 2 §6.1, §13), so the face is the
      // immutable spelling. Structural, not branded: the value is an ordinary
      // foreign JS array, not one of the runtime collections above.
      return `ReadonlyArray<${renderType(type.element, variables, faces, false)}>`;
    case "Node":
      // The hidden trie node never appears in a public `.d.ts`; its honest JS
      // shape is a fixed-length mutable array of the slot type.
      return `Array<${renderType(type.element, variables, faces, false)}>`;
    case "Nullable":
      return `${renderType(type.value, variables, faces, false)} | null | undefined`;
    case "Union":
      // The representation pin (#147): the prelude `Bool` faces JavaScript as
      // `boolean`, not as the `"False" | "True"` string union its all-nullary
      // shape would otherwise produce. Only the prelude's; a user union spelled
      // `Bool` renders as itself.
      if (faces.prelude.bool !== undefined && type.union === faces.prelude.bool) return "boolean";
      return renderNominal(
        faces.preludeTypes.referenceUnion(type.union) ?? type.name,
        type.arguments,
        variables,
        faces,
      );
    case "NominalRecord":
      // FFI Part 3: `Seq(a)` faces JavaScript as `Iterable<a>`, whatever it is
      // internally. Internal opacity and the boundary face are independent, and
      // both are decided — the bridge pair is what makes the face honest. Only
      // the *prelude's* `Seq` gets this; a user record spelled `Seq` is an
      // ordinary nominal type.
      if (faces.prelude.seq !== undefined && type.record === faces.prelude.seq) {
        return `Iterable<${renderType(type.arguments[0] ?? { kind: "Error" }, variables, faces, false)}>`;
      }
      return renderNominal(
        faces.preludeTypes.referenceRecord(type.record) ?? type.name,
        type.arguments,
        variables,
        faces,
      );
    case "ExternType":
      return faces.preludeTypes.referenceExternType(type.externType) ?? type.name;
    case "Tuple":
      // The arity-indexed representation's `.d.ts` faces (Products §2.6, #159):
      // at arity 0 the value is `undefined`, never `[]` — a `Unit`-returning
      // function is a JS function that returns nothing, so its face is `void`.
      if (type.elements.length === 0) {
        return returnPosition ? "void" : "undefined";
      }
      return (
        `[${type.elements.map((element) =>
          renderType(element, variables, faces, false)
        ).join(", ")}]`
      );
    case "Record":
      const record = `{ ${type.fields.map(({ name, type: field }) =>
        `${name}: ${renderType(field, variables, faces, false)}`
      ).join("; ")} }`;
      const tail = type.tail === undefined ? undefined : variables.get(type.tail) ?? "object";
      // A tail rendering as `NEVER` came from `neverInstantiation` — the only
      // producer that can put it there, since binder names are `a`, `b`, … `a1`
      // — and stands at the empty row: no further fields, so the intersection is
      // dropped. Writing `& never` instead would collapse the record to `never`.
      // A different substitution that ever renders a tail as `never` has to
      // revisit this, which is why the two sites name each other.
      return tail === undefined || tail === NEVER ? record : `(${record} & ${tail})`;
    case "Function": {
      const lambda = value?.kind === "Lambda" ? value : undefined;
      const names = declarationParameterNames(
        lambda?.parameters ?? [],
        type.parameters.length,
      );
      const parameters = type.parameters.map(
        (parameter, index) => `${names[index]}: ` + renderType(parameter, variables, faces, false),
      );
      return (
        `(${parameters.join(", ")}) => ` +
        renderType(type.result, variables, faces, true, lambda?.body)
      );
    }
    case "Error":
      return "unknown";
  }
}

/**
 * Names every parameter of one signature. A binder that is absent or
 * compiler-minted — a pattern parameter's, unwritable in source — has no name
 * to show, so it takes `argN`. That spelling *is* writable, so it is probed
 * upward past any parameter the source already spells that way: TypeScript
 * rejects a duplicate parameter name outright, and a module that checks clean
 * must not emit declarations that do not. Only generated names move; a
 * user-written one is never renamed (FFI Part 12 §11.1 settles the `Hex` alias
 * the same way).
 */
function declarationParameterNames(
  bindings: readonly (Core.Binding | undefined)[],
  count: number,
): readonly string[] {
  const written: (string | undefined)[] = [];
  const taken = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const binding = bindings[index];
    if (binding === undefined || isSyntheticParameterName(binding.name)) {
      written.push(undefined);
      continue;
    }
    const name = isSafeIdentifier(binding.name)
      ? binding.name
      : `__hex_binding${Number(binding.symbol)}`;
    written.push(name);
    taken.add(name);
  }
  return written.map((name, index) => {
    if (name !== undefined) return name;
    let suffix = index;
    while (taken.has(`arg${suffix}`)) suffix += 1;
    taken.add(`arg${suffix}`);
    return `arg${suffix}`;
  });
}

function renderUnionDeclaration(
  item: Core.UnionItem,
  exported: boolean,
  faces: DeclarationFaces,
): string {
  const prefix = exported ? "export " : "";
  const variables = typeVariableNames(item.parameters);
  const genericNames = item.parameters.map((parameter) => variables.get(parameter)!);
  const generics = genericNames.length === 0 ? "" : `<${genericNames.join(", ")}>`;
  // The pin (#147): the declaration site has to agree with every use site, so
  // the prelude `Bool`'s own alias is `boolean`, not the `"False" | "True"`
  // string union its all-nullary shape would otherwise produce.
  if (faces.prelude.bool !== undefined && item.union === faces.prelude.bool) {
    return `${prefix}type ${item.name} = boolean;`;
  }
  const tagged = item.constructors.some(({ slots }) => slots.length > 0);
  const alternatives = item.constructors
    .map(({ name, slots }) => tagged
      ? `{ tag: ${JSON.stringify(name)}${slots.map(({ field, type }) => `; ${field}: ${renderType(type, variables, faces, false)}`).join("")} }`
      : JSON.stringify(name))
    .join(" | ");
  return `${prefix}type ${item.name}${generics} = ${alternatives};`;
}

function patternBindings(pattern: Core.Pattern): Core.Binding[] {
  switch (pattern.kind) {
    case "Binding":
      return [pattern.binding];
    case "Wildcard":
    case "Unit":
    case "Integer":
    case "String":
      return [];
    case "As":
      return [...patternBindings(pattern.pattern), pattern.binding];
    case "Or":
      return pattern.alternatives[0] === undefined
        ? []
        : patternBindings(pattern.alternatives[0]);
    case "Tuple":
      return pattern.elements.flatMap(patternBindings);
    case "Vector":
      return [
        ...pattern.elements.flatMap(patternBindings),
        ...(pattern.rest?.pattern === undefined ? [] : patternBindings(pattern.rest.pattern)),
      ];
    case "Record":
      return pattern.fields.flatMap((field) => patternBindings(field.pattern));
    case "Constructor":
      return pattern.arguments.flatMap(patternBindings);
  }
}

function typeVariableNames(
  variables: readonly Typed.TypeVariableId[],
): ReadonlyMap<Typed.TypeVariableId, string> {
  return new Map(
    variables.map((variable, index) => [variable, typeVariableName(index)]),
  );
}

const NEVER = "never";

/**
 * The rendering of a scheme's quantified variables at the `never` instantiation
 * (FFI Part 7 §14.1) — what a face uses where TypeScript has no seat for the
 * quantifier itself.
 *
 * `typeVariableName` produces `a`, `b`, … `a1`, so `NEVER` is a value no binder
 * name can collide with; the record case reads it back to recognise a row tail
 * standing at the empty row.
 */
function neverInstantiation(
  variables: readonly Typed.TypeVariableId[],
): ReadonlyMap<Typed.TypeVariableId, string> {
  return new Map(variables.map((variable) => [variable, NEVER]));
}

function typeVariableName(index: number): string {
  const letter = String.fromCharCode("a".charCodeAt(0) + (index % 26));
  const cycle = Math.floor(index / 26);
  return cycle === 0 ? letter : `${letter}${cycle}`;
}

/**
 * Whether a `let` pattern gives some binder the right-hand side's whole value —
 * the read-through cases of closure doc §13.6, where the evidence seat survives
 * because the binder names the value itself rather than a projection of it.
 *
 * `As` qualifies whatever it wraps: its own name always denotes the scrutinee.
 * Every destructuring form does not, and must not — the checker declines the
 * seat there, so their references carry resolved evidence and belong in the
 * eta-expansion.
 *
 * Replacing this with `return true` — or the `Or` arm's recursion with a blanket
 * `true` — leaves the whole suite green, and that is an
 * **equivalent mutant rather than a coverage gap** — recorded with its argument
 * so a later reader does not have to re-derive it. The caller's other condition
 * requires every evidence entry to be an *unresolved* dictionary, which only a
 * generalized constrained scheme produces. Under a destructuring pattern the
 * right-hand side's type is an aggregate, so generalizing a constrained variable
 * there would be exactly the constrained non-function scheme §13.6 forbids: the
 * bare branch is unreachable, whatever this returns. The restriction is kept as
 * the emitter's own statement of the correspondence, so that a future regression
 * in the checker's seat rule surfaces as a wrong *diagnostic* rather than as
 * silently bare-emitted names in destructuring positions.
 */
function patternNamesWholeValue(pattern: Core.Pattern): boolean {
  if (pattern.kind === "Binding" || pattern.kind === "Wildcard") return true;
  // `As` qualifies whatever it wraps — its own name is the scrutinee — so it
  // does not recurse. `Or` does: an or-of-bare-binders reads through (each
  // alternative names the whole value), while an or-of-destructuring does not,
  // and the checker's `Or` arm generalizes each binder against the scrutinee
  // type exactly on that distinction. Omitting `Or` here left `let (g | g) =
  // describe` generalizing in the checker and eta-expanding in the emitter —
  // round 5's blocker one pattern shape over, on a program `main` runs.
  if (pattern.kind === "As") return true;
  if (pattern.kind === "Or") return pattern.alternatives.every(patternNamesWholeValue);
  return false;
}

export function emittedModuleSpecifier(specifier: string): string {
  return specifier.endsWith(".hex")
    ? `${specifier.slice(0, -4)}.js`
    : `${specifier}.js`;
}

function cleanNumber(spelling: string): string {
  return spelling.replaceAll("_", "");
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

const reservedWords = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

function isSafeIdentifier(name: string): boolean {
  if (reservedWords.has(name)) return false;
  const scalars = [...name];
  const first = scalars.shift();
  if (first === undefined || !isJavaScriptIdentifierStart(first)) return false;
  return scalars.every(isJavaScriptIdentifierContinue);
}

function isJavaScriptIdentifierStart(scalar: string): boolean {
  return scalar === "$" || scalar === "_" || idStart.test(scalar);
}

function isJavaScriptIdentifierContinue(scalar: string): boolean {
  return scalar === "$" || scalar === "_" || scalar === "\u200C" ||
    scalar === "\u200D" || idContinue.test(scalar);
}
