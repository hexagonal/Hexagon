/**
 * The experimental first emitter renders conservative, readable ESM from Core.
 * It is platform-neutral: hosts decide paths and perform filesystem writes.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import { preRegisteredConstraintIdentity } from "../../constraints.js";
import { INTRINSIC_INVENTORY, isIntrinsicScheme } from "../../intrinsics.js";
import { PRIMITIVE_COMPANION_BASENAMES } from "../../prelude.js";
import { type Documentation, throwsManifests } from "../../support/documentation.js";
import { relativeSpecifier } from "../../support/paths.js";
import type * as Source from "../../support/source.js";
import { isSyntheticParameterName } from "../../support/synthetic.js";
import type * as Core from "../../syntax/core/index.js";
import type * as Emitted from "../../emission/index.js";
import type * as Resolved from "../../syntax/resolved/index.js";
import * as Typed from "../../syntax/typed/index.js";
import { idContinue, idStart } from "../lexer/unicode-17.js";
import {
  faceOnlyEditionInstances,
  fundamentalInstanceDictionaries,
  planFundamentalSpecializations,
  planImportedSpecializations,
  preludeBoolUnion,
  sourceInstanceDictionary,
  specializeItem,
  type FundamentalInstances,
  type FundamentalSpecialization,
  type FundamentalType,
  type SpecializationCollision,
  type SpecializableItem,
} from "./specializations.js";

/**
 * Every operation the emitted program performs on a `Vector(a)` by calling the
 * trie runtime, and the name it is exported under from `runtime/VectorTrie.hex`.
 *
 * This is the *whole* of what the emitter knows about how a vector is built and
 * read. Collections Part 3 §4's trie is Hexagon source over the `Node`
 * intrinsic; nothing here re-implements any of it, and no emitted JavaScript
 * reads a `TrieVector`'s fields. The one further fact emission relies on is the
 * representation contract: every vector value carries `[Symbol.iterator]`, which
 * is why `show`, `hash`, `for x in`, spread, and the `Map`/`Set` `fromVector`
 * consumers appear nowhere in this list — they iterate, and iterating is not a
 * call into the runtime.
 *
 * `nodeRun` is the exception that proves the rule: it is used only *inside* the
 * emitted runtime module, by the iterator that makes the contract true.
 *
 * The list is fixed rather than derived because it is a contract in both
 * directions — a name missing from the module would be a JavaScript
 * `SyntaxError` in the export list rather than a compiler diagnostic, and
 * `vector-trie-wiring.test.ts` checks the two sides against each other.
 */
export const VECTOR_RUNTIME_OPERATIONS = [
  /** The one shared empty vector (a value, not a function). */
  "empty",
  /** `size(trie)` — Collections Part 3 §7's O(1) `length`, two field reads. */
  "size",
  /** `get(trie, index)` — 0-based, caller-checked. */
  "get",
  /** `set(trie, index, value)` — 0-based, caller-checked, persistent. */
  "set",
  "append",
  "prepend",
  /** `slice(trie, begin, end)` — 0-based half-open, bounds already in range. */
  "slice",
  /** `window(trie, begin, end)` — `slice` with §6.1's clamping applied first. */
  "window",
  /** `concat(left, right)` — the `Concat<Vector(a)>` instance (§8). */
  "concat",
  /** `nodeRun(trie, index)` — the leaf-run locator the O(n) iterator walks. */
  "nodeRun",
] as const;

export type VectorRuntimeOperation = (typeof VECTOR_RUNTIME_OPERATIONS)[number];

/**
 * Every operation the emitted program performs on a `Map(k, v)` or a `Set(a)` by
 * calling the hash-trie runtime, and the name it is exported under from
 * `runtime/HashTrie.hex` (#370, #373).
 *
 * Read `VECTOR_RUNTIME_OPERATIONS`' block for what a list like this is and why
 * it is fixed rather than derived; everything there applies here verbatim, with
 * one difference worth naming. The vector list is what the *emitter* reaches
 * for on its own account — a literal, a bracket, a pattern. This list is
 * `stdlib/Map.hex`'s and `stdlib/Set.hex`'s fifteen door keys — seven and eight
 * (`spec/intrinsics.md` §3.2) — so almost every member is here because a `map*`
 * or `set*` intrinsic lowers to it. Five the emitter reaches on its own account:
 * `get`, for the bracket's throwing read and the derived `Eq`; `entries`, for
 * the map's iteration face; `members`, for the set's; and `memberCount` and
 * `containsMember`, which the set's derived instances need because a `HashSet`
 * holds one field and the maintained count is inside it — so where `mapEquals`,
 * `mapHash` and `#derivedShow`'s `Map` arm read `.size` off the value, their
 * `Set` counterparts call.
 *
 * `containsKey` and `isEmpty` are declared in the runtime module and are
 * deliberately **not** here, and the Set step (#373) leaves both where they are.
 * `Map.hex` writes both in ordinary Hexagon over `get` and `size`, and `Set.hex`
 * writes its `isEmpty` over `size` the same way; the trie's own `containsKey` is
 * still reached — but from *inside* the module, by the wrapper's
 * `containsMember`, which is on this list. An export list naming operations no
 * consumer imports is a claim the wiring has no reason to make.
 *
 * The set-facing eight are the wrapper record's, not the trie's (#373): a
 * `Set(a)` is a `HashSet(a)` holding one `HashTrie(a, Unit)`, because one record
 * carries one `[Symbol.iterator]` and the trie's yields pairs.
 */
export const HASH_TRIE_RUNTIME_OPERATIONS = [
  /** The one shared empty trie (a value, not a function). */
  "empty",
  /** `singleton(key, value)` — the unplaced one-entry trie (Part 4 §12.4). */
  "singleton",
  /** `size(trie)` — the maintained field, O(1). */
  "size",
  /** `get(trie, key)` — `<k: Hash>`, so its compiled form takes evidence. */
  "get",
  /** `set(trie, key, value)` — `<k: Hash>`, upsert, persistent. */
  "set",
  /** `remove(trie, key)` — `<k: Hash>`, forgiving. */
  "remove",
  /** `entries(trie)` — the lazy depth-first walk, as a `Seq((k, v))`. */
  "entries",
  /** The one shared empty set, wrapping `empty` (a value, not a function). */
  "emptySet",
  /** `soleMember(element)` — the unplaced one-element set (Part 4 §12.4). */
  "soleMember",
  /** `memberCount(s)` — the trie's maintained field through the wrapper, O(1). */
  "memberCount",
  /** `containsMember(s, element)` — `<a: Hash>`, the only Boolean read. */
  "containsMember",
  /** `memberIn(s, element)` — `<a: Hash>`, the stored representative (§5.4). */
  "memberIn",
  /** `addMember(s, element)` — `<a: Hash>`, insert-if-absent (Part 4 §5.1). */
  "addMember",
  /** `removeMember(s, element)` — `<a: Hash>`, forgiving. */
  "removeMember",
  /** `members(s)` — the trie walk projected to keys, as a `Seq(a)`. */
  "members",
] as const;

export type HashTrieRuntimeOperation = (typeof HASH_TRIE_RUNTIME_OPERATIONS)[number];

/**
 * How this module reaches one runtime module.
 *
 * `"self"` is the runtime module emitting itself: its operations are ordinary
 * module-level bindings, so they are named bare, and it is here — and only here
 * — that the emitter writes the JavaScript export list and gives every
 * constructed representation record its `[Symbol.iterator]`.
 *
 * A specifier is every other module: the operations arrive as named imports.
 * Absent means no runtime is available, which is what emitting a single module
 * outside `compileProject` gets; emission then names the operations as if
 * imported from the same directory, which is the shape a one-file program has,
 * exactly like `DEFAULT_RUNTIME_SPECIFIER` above.
 */
export type RuntimeLocation = "self" | { readonly specifier: string };

/** Where each runtime module sits, from this module, by injected basename. */
export type RuntimeLocations = ReadonlyMap<string, RuntimeLocation>;

/**
 * One runtime module's wiring, in the one record that decides all of it (#370).
 *
 * There used to be a quintet of vector-shaped members — an operations list, a
 * default specifier, a use map, an import renderer, an export renderer — and a
 * second runtime module could not simply have a second copy: the export
 * renderer keyed off `"self"` alone, so whichever module was emitting itself
 * got *the vector list* written as its export list, and the other got none.
 * Generalizing was therefore forced rather than tidy. Each channel below is the
 * same one channel it always was, now indexed by `basename`.
 */
export interface RuntimeModuleWiring {
  /** The injected basename (`runtime-modules.ts`), and this record's key. */
  readonly basename: string;
  /**
   * The operations, in the order the emitted export list and every consumer's
   * import list name them — a function of what a module uses, never of where in
   * the module it happens to use it.
   */
  readonly operations: readonly string[];
  /**
   * The stem a generated import local takes, per FFI Part 1 §10 applied to a
   * term: the import and a user's own function of the same name must coexist,
   * and only the generated spelling ever moves. The stems name the *runtime*
   * rather than the public type, so a reader can tell an imported runtime
   * operation from a locally emitted helper at a glance, and two runtimes that
   * share an operation name (`size`, `get`, `set`, `empty` — all four are in
   * both lists) never hand each other's local out.
   */
  readonly localStem: string;
  /** What a module at the source common root spells for it. */
  readonly defaultSpecifier: string;
  /**
   * Each representation record whose construction carries a boundary traversal
   * method, and the helper that method is. Empty (or absent) for a runtime
   * module no public `Iterable` type is built from.
   *
   * A *list* rather than the single pair this was, because one runtime module
   * can back two public faces (#373): `runtime/HashTrie.hex` builds both
   * `HashTrie`, which is what a `Map(k, v)` is and yields `[k, v]`, and
   * `HashSet`, which is what a `Set(a)` is and yields elements. One record
   * carries one iterator, so two faces need two records and two helpers.
   */
  readonly iterables?: readonly {
    readonly record: string;
    readonly helper: "vectorIterate" | "hashTrieIterate" | "hashSetIterate";
  }[];
}

/** What a module at the source common root spells for the vector trie runtime. */
export const DEFAULT_VECTOR_RUNTIME_SPECIFIER = "./VectorTrie";

/** Every runtime module the emitter wires, in injection order. */
export const RUNTIME_WIRINGS: readonly RuntimeModuleWiring[] = [
  {
    basename: "VectorTrie.hex",
    operations: VECTOR_RUNTIME_OPERATIONS,
    localStem: "trie",
    defaultSpecifier: DEFAULT_VECTOR_RUNTIME_SPECIFIER,
    iterables: [{ record: "TrieVector", helper: "vectorIterate" }],
  },
  {
    basename: "HashTrie.hex",
    operations: HASH_TRIE_RUNTIME_OPERATIONS,
    localStem: "hashTrie",
    defaultSpecifier: "./HashTrie",
    iterables: [
      { record: "HashTrie", helper: "hashTrieIterate" },
      { record: "HashSet", helper: "hashSetIterate" },
    ],
  },
];

const VECTOR_WIRING = RUNTIME_WIRINGS[0]!;
const HASH_TRIE_WIRING = RUNTIME_WIRINGS[1]!;

export interface JavaScriptEmissionOptions {
  /** Includes private editions for inspection tools; ordinary builds omit them. */
  readonly previewPrivateSpecializations?: boolean;
  /** Exposes reserved evidence handles needed by dependent Hexagon modules. */
  readonly exportInstanceEvidence?: boolean;
  /**
   * Where this module's emission finds each runtime module. Only
   * `compileProject` knows the program's paths, so only it can compute the
   * specifiers; a basename with no entry takes the same-directory default.
   */
  readonly runtimes?: RuntimeLocations;
  /**
   * The local each routed member seat binds under, by `memberSeatKey` — the
   * answer to Dictionary Sharing §8's seat-binding rule, which only a finished
   * rendering can give (#444). Absent on the discovery pass; see
   * `emitJavaScript`.
   */
  readonly memberSeatLocals?: ReadonlyMap<string, string>;
  /**
   * The specifier this module spells the program's **runtime module** by (FFI
   * Part 7 §1.2), source-form, as an `Import` item would carry it — the file
   * holding the globals capture a contested module imports its reserved names
   * from.
   *
   * Only `compileProject` knows the program's source common root and the stem
   * Part 1 §8.3's probe settled there, exactly as with `runtimes` above, so only
   * it can compute the specifier. An uncontested module never spells it; a
   * contested one emitted without it would import from the same-directory
   * default, which is the wrong file from any module below the root.
   */
  readonly runtimeGlobalsSpecifier?: string;
  /**
   * The program's Algorithm S candidate rows for the **pre-registered**
   * constraints (#679); see `FundamentalInstances`.
   *
   * Only `compileProject` can supply them, and for the reason the two options
   * above name plus one of its own: the rows are a fact about the prelude, and a
   * prelude module sees only the members before its own seat. Emitting one
   * module alone answers from that module's own channels instead, which is the
   * complete answer for any module that sees the whole prelude.
   */
  readonly fundamentalInstances?: FundamentalInstances;
}

/**
 * Which routed member seats earn the member's **source** spelling is a fact
 * about the whole finished module, so emission runs twice when — and only when
 * — one of them does.
 *
 * Dictionary Sharing §8: a consumer binds an imported seat under the member's
 * source spelling where that spelling is uncontested in the consumer, and the
 * two decisive contests are legible nowhere earlier. Whether the member's
 * *forwarder* is bound here is whether any surviving reference named it, which
 * `#referencedSymbols` answers only once every body is rendered; and whether
 * two seats want one member spelling is a property of the whole set of routed
 * calls, so the first one cannot be given the spelling on the promise that no
 * second appears. The name has to be in the body text as it is written, so the
 * body is written twice rather than patched.
 *
 * The discovery pass is a complete, correct emission — every seat under its
 * generated spelling — so a module where no seat earns the source spelling
 * pays nothing, and the pass that runs second is the one whose output ships.
 * Rendering is a pure function of the module and these options, so the second
 * pass repeats the first's routing decisions exactly; the only names it claims
 * that the first did not are the source spellings themselves, which no
 * generated name can contest (every one of those carries Lexer §3.2's reserved
 * prefix, and a member's source spelling cannot).
 */
export function emitJavaScript(
  module: Core.Module,
  options: JavaScriptEmissionOptions = {},
): Emitted.JavaScript {
  const discovery = new JavaScriptEmitter(module, options);
  const emitted = discovery.emit();
  const memberSeatLocals = discovery.memberSeatSpellings();
  if (memberSeatLocals === undefined) return emitted;
  return new JavaScriptEmitter(module, { ...options, memberSeatLocals }).emit();
}

/** One routed seat's identity across the two passes: the module it lives in, and its name there. */
function memberSeatKey(specifier: string, seat: string): string {
  return `${specifier} ${seat}`;
}

/**
 * Every name a module's items bind at module level in the emitted JavaScript
 * (#444) — the eagerly legible part of Dictionary Sharing §8's contest set.
 *
 * Deliberately over-approximate on one axis and exact on the other: an
 * *explicit* import's locals are counted whether or not the body names them,
 * because the source asked for those and the line is emitted either way, while
 * a synthesized prelude import's are left out here and added by
 * `memberSeatSpellings` from what rendering actually referenced. Generated
 * names are out of scope by construction — Lexer §3.2's reserved prefix is on
 * every one of them and can be on no member's source spelling.
 */
function moduleLevelBindings(
  module: Core.Module,
  /**
   * Whether a namespace import's alias counts. It binds like any other name and
   * every caller but one wants it counted; the exception is the caller that
   * *plans* those aliases' spellings (#569), which needs the set they are
   * contested by — this set without them.
   */
  namespaceAliases = true,
): readonly string[] {
  const identifier = (binding: Core.Binding | Core.Constructor): string =>
    isSafeIdentifier(binding.name) ? binding.name : `__binding${Number(binding.symbol)}`;
  return module.items.flatMap((item): readonly string[] => {
    switch (item.kind) {
      case "Let":
      case "Fun":
      case "Var":
        return [identifier(item.binding)];
      case "LetPattern":
        return patternBindings(item.pattern).map(identifier);
      case "Union":
        return item.constructors.map(identifier);
      case "RecordDeclaration":
        return [identifier(item.constructor)];
      case "Exception":
        return [identifier(item.binding)];
      case "ConstraintDeclaration":
        // The forwarders, and the §6.5 helper each defaulted member hoists.
        return item.members.flatMap((member) => [
          identifier(member.binding),
          ...(member.defaultValue === undefined
            ? []
            : [defaultHelperName(member.binding.name)]),
        ]);
      case "ExternBlock":
        return item.declarations.flatMap((declaration) =>
          declaration.kind === "ExternType" ? [] : [declaration.localName]
        );
      case "Import":
        if (item.synthesized || item.form.kind === "Effect") return [];
        return item.form.kind === "Namespace"
          ? (namespaceAliases ? [item.form.alias] : [])
          : item.form.names.map(({ local }) => local);
      default:
        return [];
    }
  });
}

/**
 * FFI Part 7 §1.2's trigger quantity, settled before rendering: one flat set of
 * the **source** names this module binds where a runtime-vocabulary spelling
 * could land.
 *
 * `moduleLevelBindings` is exactly it — top-level declarations, import locals,
 * and namespace-import aliases — read for its source spellings rather than for
 * its emitted ones. The two coincide on everything that matters here: every
 * vocabulary member is a safe JavaScript identifier, so `identifier`'s rename is
 * the identity on all of them, and rule 1's aliasing of *minted* locals runs
 * after this and puts nothing into the set.
 *
 * `undefined` is the one member a function scope can also bind, being the one
 * lowercase member — `let` requires a non-uppercase-start name, so every other
 * spelling is a module-level exposure only. Its trigger reads the module's whole
 * symbol table instead, filtered to the symbols this file declares: the imported
 * entries carry the *exporting* file's id, and a module that merely imports a
 * term named `undefined` through a namespace alias binds nothing under it.
 *
 * **The minted import locals are subtracted**, which is rule 1 and rule 2 read
 * together: rule 2's trigger is the module's *source* bindings, and rule 1 has
 * already decided that a minted local under a vocabulary spelling does not take
 * it. Leaving them in makes the module import a capture it references nowhere —
 * an import line that is no longer the manifest §1.2 says it is, and an
 * uncontested module that is no longer byte-identical. `namespaceAliasPlan`
 * subtracts `typeOnlyImportLocals` in the same shape and for the same kind of
 * reason: `moduleLevelBindings` is deliberately an over-approximation, and each
 * caller subtracts the part it must not over-count.
 *
 * Counted rather than collected, exactly as that plan counts, so that a module
 * declaring `console` itself *and* carrying a minted local spelled `console`
 * would still contest on the declaration's account. **No accepted program
 * observes that difference today**, and the clause is kept as the shape rather
 * than as a live case: the named-import route is refused before it reaches here
 * — "`console` is already bound; it arrived with `import { Boxy }`, and a named
 * constraint import brings its members" (Modules §5.3's generalisation law) —
 * and the route that diagnostic offers instead, `import module …`, contributes
 * an alias rather than member names, so it subtracts nothing. Measured, both
 * halves. The counting is what the rule would want if that collision rule ever
 * relaxed along the route its own diagnostic names, and it costs nothing now;
 * a collected set would be the same answer for every program that compiles.
 *
 * The reach is one spelling. A constraint member is a term, so it is
 * non-uppercase-start and cannot be any of the eleven uppercase members; a
 * synthesized prelude import contributes nothing here in the first place
 * (`moduleLevelBindings` drops it); and `undefined` is settled by the symbol
 * check above, which an imported member never reaches. `console` is what is
 * left, and it was measured over-triggering.
 */
function runtimeVocabularyTrigger(module: Core.Module): RuntimeVocabulary {
  const bound = new Map<string, number>();
  for (const name of moduleLevelBindings(module)) {
    bound.set(name, (bound.get(name) ?? 0) + 1);
  }
  for (const local of mintedImportLocals(module)) {
    const remaining = (bound.get(local) ?? 0) - 1;
    if (remaining > 0) bound.set(local, remaining);
    else bound.delete(local);
  }
  return new RuntimeVocabulary(
    new Set(bound.keys()),
    module.symbols.some(
      (symbol) => symbol.name === UNIT_SPELLING && symbol.bindingSpan.fileId === module.fileId,
    ),
  );
}

/**
 * Whether one name on an `import` item is the *emitter's* to spell rather than
 * the source's — FFI Part 7 §1.2 rule 1's population, at the seat that decides
 * a local.
 *
 * Two forms qualify. A **synthesized** prelude import was never written at all
 * (Modules §11.2's liberty). A **constraint member** rides a written line but is
 * not a written name: importing a constraint puts every member in scope
 * (Modules §3.1), so the local mirrors the member's spelling by the emitter's
 * choice, and no source text moves when it stops doing so.
 */
function mintedImportName(
  item: Core.ImportItem,
  name: { readonly constraintMember?: boolean },
): boolean {
  return item.synthesized === true || name.constraintMember === true;
}

/**
 * The locals `moduleLevelBindings` counts that the emitter, not the source,
 * spelled — the half the trigger above subtracts.
 *
 * Named forms of written imports only, which is where the two lists meet: a
 * synthesized item contributes no local to that set at all, and a namespace form
 * contributes its alias rather than its names.
 */
function mintedImportLocals(module: Core.Module): readonly string[] {
  return module.items.flatMap((item) =>
    item.kind === "Import" && !item.synthesized && item.form.kind === "Named"
      ? item.form.names.flatMap((name) => mintedImportName(item, name) ? [name.local] : [])
      : []
  );
}

/**
 * The local each namespace import's emitted `import * as` line binds, entered
 * only for an alias one of the module's own bindings contests (#569).
 *
 * The `* as` head is JavaScript's and survives only in emission (§11.2, #565);
 * the source line this plan renames the local of is `import module Point`.
 *
 * Modules §5.2 makes `import module Point from "./point"` beside a declared
 * `Point` legal and load-bearing — it is the companion idiom — and the checker
 * reports nothing, so the two Hexagon namespaces must reach JavaScript as two
 * bindings. §11.2 already says whose problem that is: "emitted-name collisions
 * are the emitter's ordinary renaming problem".
 *
 * The **alias** is what moves. The declaration may be exported and its spelling
 * is then the module's public face, while an alias is importer-internal: it
 * reaches the output on its own `import` line and in the qualified uses this
 * map rewrites, and nowhere else. Lexer §3.2's probe read at a source-level
 * spelling — the reserved prefix belongs to generated names, and this is a
 * source name moving aside — so the suffixes run from `_1` bare: `Point_1`.
 *
 * A **contestant** is a name the emitted file really binds. `moduleLevelBindings`
 * is deliberately an over-approximation of that (see its own note), and the one
 * place the two part company for a spelling an alias could carry is a *type-only*
 * named import, which `#emitImport` drops from the `import { }` line: an imported
 * `type` alias, an imported opaque record's type, an imported union's type name.
 * Nothing binds those in JavaScript, so nothing of them can collide, and an alias
 * that moved for one would be a rename against a name that is not there. They are
 * subtracted here rather than in `moduleLevelBindings`, whose other caller wants
 * the over-count. The line's two other filters cannot reach an alias's spelling:
 * a constraint member's name is a term's and an alias is uppercase-start, and the
 * pinned `Bool` constructors are the prelude's own.
 *
 * Alias against alias cannot arise *as a collision* (two same-spelled aliases are
 * a source error), but an alias can still be standing on the spelling this probe
 * is about to mint — `import * as Point` beside `import * as Point_1` — so the
 * avoid set holds every other module-level binding, every alias, and every
 * spelling already handed out here. Landing on the second alias would rebuild
 * #569's own failure one alias over.
 */
function namespaceAliasPlan(module: Core.Module): ReadonlyMap<string, string> {
  const aliases = module.items.flatMap((item) =>
    item.kind === "Import" && !item.synthesized && item.form.kind === "Namespace"
      ? [item.form.alias]
      : []
  );
  // Counted rather than collected, so subtracting a type-only import's local
  // leaves a spelling some *other* binding also carries still contesting on that
  // binding's account.
  const contested = new Map<string, number>();
  for (const name of moduleLevelBindings(module, false)) {
    contested.set(name, (contested.get(name) ?? 0) + 1);
  }
  for (const local of typeOnlyImportLocals(module)) {
    const remaining = (contested.get(local) ?? 0) - 1;
    if (remaining > 0) contested.set(local, remaining);
    else contested.delete(local);
  }
  // The empty map is the whole no-collision case: every lookup misses and every
  // spelling is the source's own, so a module without this collision emits the
  // text it emitted before the plan existed.
  if (!aliases.some((alias) => contested.has(alias))) return new Map();
  const taken = new Set([...contested.keys(), ...aliases]);
  const plan = new Map<string, string>();
  for (const alias of aliases) {
    if (!contested.has(alias)) continue;
    let suffix = 1;
    let local = `${alias}_${suffix}`;
    while (taken.has(local)) local = `${alias}_${++suffix}`;
    taken.add(local);
    plan.set(alias, local);
  }
  return plan;
}

/**
 * The named-import locals the emitted `import { }` line leaves unbound: the
 * type-only ones, which cross the boundary in the `.d.ts` and nowhere else. See
 * `namespaceAliasPlan`, the only caller and the reason this is separate from
 * `moduleLevelBindings`.
 */
function typeOnlyImportLocals(module: Core.Module): readonly string[] {
  return module.items.flatMap((item) =>
    item.kind === "Import" && !item.synthesized && item.form.kind === "Named"
      ? item.form.names.flatMap(({ local, typeOnly }) => typeOnly === true ? [local] : [])
      : []
  );
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
  /**
   * Every nominal type the program declares and exports, by identity: its own
   * name, and the path of the module that declares it (FFI Part 7 §2.4 rung 5).
   *
   * Rung 5 mints `import type { Name as Local }` for an identity no rung above
   * can name — the shape a type alias's expansion reaches, since an importer
   * that binds only the alias binds nothing the expansion mentions (#618) — and
   * a home module is the one thing this module's own tree cannot supply.
   *
   * Program-wide and shared, keyed by `nominalHomeKey`, with `modulePath` doing
   * the per-module part: the specifier is relativized here rather than a copy of
   * the table being built for every module.
   *
   * Only `compileProject` has the table; emitting one module alone leaves both
   * absent, and rung 5 then declines and the face falls back to the declared
   * name — today's behaviour, which is what a lone `emitDeclarations` had.
   */
  readonly nominalHomes?: ReadonlyMap<string, NominalHome>;
  /** This module's own path, for relativizing `nominalHomes`. */
  readonly modulePath?: string;
  /**
   * The program's Algorithm S candidate rows (#679); see the identically-named
   * option on `JavaScriptEmissionOptions` for why only `compileProject` has
   * them. The two faces must plan the same editions or a declared entry point
   * names a function the JavaScript never emitted.
   */
  readonly fundamentalInstances?: FundamentalInstances;
}

/** One entry of `DeclarationEmissionOptions.nominalHomes`. */
export interface NominalHome {
  /** The type's own name in its home module — what a minted line imports. */
  readonly name: string;
  /** The declaring module's path, as `compileProject` normalizes it. */
  readonly path: string;
}

/**
 * `nominalHomes`' key. Exported because the table is built one pass away from
 * where it is read, and a second spelling of the key would be wrong only for the
 * identities the two disagreed about.
 */
export function nominalHomeKey(
  kind: "union" | "record" | "externType",
  id: number,
): string {
  return `${kind}:${id}`;
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
  fundamentalInstances?: FundamentalInstances,
): Emitted.TypeScriptPreview {
  return new TypeScriptPreviewEmitter(module, fundamentalInstances).emit();
}

type EvidenceNames = ReadonlyMap<string, string>;

/**
 * The checker's per-component evidence selection for one container, keyed by
 * component position (#278, `spec/products.md` §2.5's implementer note).
 *
 * `undefined` where there is none to render: a component whose evidence is a
 * dictionary parameter or an error, and the leaf recursions that reach a type
 * with no components at all. A derived body given `undefined` walks the type —
 * at a dictionary parameter that is one step to the `Variable` arm and is the
 * whole of the right answer, and on a module the checker rejected it is the
 * best effort there is.
 */
type ComponentEvidence = ReadonlyMap<string, Core.Evidence> | undefined;

function componentEvidence(
  components: readonly Core.EvidenceComponent[],
): ReadonlyMap<string, Core.Evidence> {
  return new Map(components.map(({ key, evidence }) => [key, evidence]));
}

/**
 * One slot of a dictionary literal **this emitter builds** — structural
 * evidence and the planner's `Bool` editions (`#derivedSlots`).
 *
 * The slot is described rather than only rendered so that a use site which
 * immediately selects and applies it can take the body directly, per Dictionary
 * Sharing §9.1's literal-member rule (#425). `rendered` is what stands in the
 * literal when it is not reduced, so the two faces cannot drift: the literal is
 * built *from* these slots and from nothing else.
 *
 * `arrow` is absent for a slot whose value is not an arrow this emitter wrote —
 * a helper reference (`toSeq: __seqFromIterable`), a nested record (`Hash`'s
 * `eq`). There is nothing to beta-reduce there.
 */
type DerivedSlot = {
  readonly name: string;
  readonly rendered: string;
  readonly arrow?: {
    readonly parameters: readonly string[];
    readonly body: string;
  };
};

/**
 * One member of a **declared** instance's completed set (Constraints §2), and
 * the lambda that implements it (#444).
 *
 * Named rather than pre-joined into `name: value` because the implementation is
 * now the initializer of the instance's member seat (§6.1) as often as it is a
 * slot's value, and the two spellings must come from one rendering.
 */
interface MemberImplementation {
  readonly name: string;
  readonly rendered: string;
}

/** A dictionary slot holding an arrow this emitter wrote. */
function derivedArrow(
  name: string,
  parameters: readonly string[],
  body: string,
): DerivedSlot {
  const head = parameters.length === 1
    ? parameters[0]!
    : `(${parameters.join(", ")})`;
  return { name, rendered: `${head} => ${body}`, arrow: { parameters, body } };
}

/** The literal a set of slots stands for, in the one place it is spelled. */
function dictionaryLiteral(slots: readonly DerivedSlot[]): string {
  return slots.length === 0
    ? "({})"
    : `({ ${slots.map(({ name, rendered }) => `${name}: ${rendered}`).join(", ")} })`;
}

const IDENTIFIER_CHARACTER = /[A-Za-z0-9_$]/;

/** The index just past the string literal opening at `start`. */
function skipStringLiteral(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    const character = text[index]!;
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === quote) return index + 1;
    index += 1;
  }
  return text.length;
}

/**
 * Where `name` occurs as an identifier in emitted JavaScript — not inside a
 * string literal, and not as a property name after a dot.
 *
 * Emitted text, not source, so the scanner only has to be right about what this
 * emitter writes: quoted strings (always `JSON.stringify`d), identifiers, and
 * punctuation. Template literals are excluded by the caller rather than
 * scanned.
 */
function identifierOccurrences(text: string, name: string): readonly number[] {
  const positions: number[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (character === '"' || character === "'") {
      index = skipStringLiteral(text, index);
      continue;
    }
    if (IDENTIFIER_CHARACTER.test(character)) {
      let end = index;
      while (end < text.length && IDENTIFIER_CHARACTER.test(text[end]!)) {
        end += 1;
      }
      // A leading dot is a property name — unless it is the last of a spread's
      // three, which is what `[...__value]` is made of. Reading that as a
      // property was one occurrence short of the truth, and short is the
      // dangerous direction: the count guard would have licensed a reduction
      // that duplicates its argument.
      const member = text[index - 1] === "." && text[index - 2] !== ".";
      if (text.slice(index, end) === name && !member) positions.push(index);
      index = end;
      continue;
    }
    index += 1;
  }
  return positions;
}

/**
 * The index of the bracket closing the one that opens at `start`, or
 * `undefined` when the text does not close it.
 */
function matchingBracket(text: string, start: number): number | undefined {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const character = text[index]!;
    if (character === '"' || character === "'") {
      index = skipStringLiteral(text, index);
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return undefined;
}

/**
 * Whether the text binds tighter than every operator a derived body can place
 * around it — an identifier, a literal, a postfix chain over one, or an already
 * parenthesized expression.
 *
 * A member call's arguments sit in argument position, where nothing binds; the
 * body positions they land in after §9.1's reduction are not so forgiving
 * (`__value.field`, `[...__value]`, `__left === __right`). Anything this
 * refuses gets parentheses, so a wrong answer here can only cost a redundant
 * pair, never a precedence bug.
 */
function atomicOperand(text: string): boolean {
  let index = 0;
  let value = false;
  while (index < text.length) {
    const character = text[index]!;
    if (character === "(" || character === "[") {
      const end = matchingBracket(text, index);
      if (end === undefined) return false;
      index = end + 1;
      value = true;
      continue;
    }
    if (character === '"' || character === "'") {
      if (value) return false;
      index = skipStringLiteral(text, index);
      value = true;
      continue;
    }
    if (character === ".") {
      if (!value) return false;
      index += 1;
      value = false;
      continue;
    }
    if (IDENTIFIER_CHARACTER.test(character)) {
      if (value) return false;
      let end = index;
      while (end < text.length && IDENTIFIER_CHARACTER.test(text[end]!)) {
        end += 1;
      }
      index = end;
      value = true;
      continue;
    }
    return false;
  }
  return value;
}

/** Keywords after which a derived body's text is a loop or branch, not a step. */
const CONTROL_KEYWORDS = new Set([
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "default",
  "catch",
  "finally",
  "return",
  "throw",
  "yield",
  "await",
  "new",
]);

/** The keyword heads whose parenthesized part is itself evaluated on the spot. */
const EVALUATED_HEADS = new Set(["for", "switch"]);

/**
 * Whether the text between `start` and `position` is evaluated on the spot,
 * exactly once, left to right, with nothing effectful in it — §9.1's position
 * half of the guard, which the count half cannot see.
 *
 * The scanner reads only the shapes this emitter writes into a derived body and
 * refuses everything else, so a construct it does not model costs a missed
 * reduction and never a wrong one. What it accepts ahead of the occurrence:
 * identifiers, property reads, indexing, string and number literals, spreads,
 * arithmetic and comparison operators, local `let`/`const` steps inside an
 * immediately-invoked arrow, and bracket groups the occurrence is *inside* (an
 * argument list, a `for … of` head, a `switch` discriminant — none of which has
 * run its call yet). What it refuses: a call that **completes** before the
 * occurrence (its effects would then precede the argument's, which ran first in
 * the unreduced shape), a `?`/`:`/`&&`/`||` ahead of it (the occurrence is in a
 * branch), an `=>` ahead of it (the occurrence is under a deferred lambda), and
 * any control keyword whose body it would sit in.
 */
function evaluatedInPlace(
  text: string,
  start: number,
  end: number,
  position: number,
): boolean {
  let index = start;
  while (index < position) {
    const character = text[index]!;
    if (character === '"' || character === "'") {
      index = skipStringLiteral(text, index);
      continue;
    }
    if (character === "(" || character === "[" || character === "{") {
      const close = matchingBracket(text, index);
      if (close === undefined || close >= end) return false;
      if (position < close) {
        // The immediately-invoked arrow — `hash`'s `Vector` arm and the tagged
        // walks — is a region evaluated on the spot, so its block is live.
        // Every other brace is an object literal or a statement block this
        // scanner does not model.
        if (text.startsWith("(() => {", index) && text[close + 1] === "(") {
          const body = index + "(() => {".length;
          return position >= body && evaluatedInPlace(text, body, close - 1, position);
        }
        if (character === "{") return false;
        return evaluatedInPlace(text, index + 1, close, position);
      }
      // The whole group is evaluated before the occurrence. A call there has
      // already run by the time the argument would be evaluated.
      if (
        character === "(" && index > start &&
        /[A-Za-z0-9_$)\]]/.test(text[index - 1]!)
      ) {
        return false;
      }
      index = close + 1;
      continue;
    }
    if (IDENTIFIER_CHARACTER.test(character)) {
      let wordEnd = index;
      while (wordEnd < text.length && IDENTIFIER_CHARACTER.test(text[wordEnd]!)) {
        wordEnd += 1;
      }
      const word = text.slice(index, wordEnd);
      if (CONTROL_KEYWORDS.has(word) && text[index - 1] !== ".") {
        // `for (const x of E)` and `switch (E)` evaluate their head on the
        // spot; anything after the head, and anything after any other control
        // keyword, is a loop or branch body.
        if (!EVALUATED_HEADS.has(word)) return false;
        const head = text.indexOf("(", wordEnd);
        if (head === -1) return false;
        const close = matchingBracket(text, head);
        if (close === undefined || close >= end || position >= close) return false;
        return evaluatedInPlace(text, head + 1, close, position);
      }
      index = wordEnd;
      continue;
    }
    if (character === "=" && text[index + 1] === ">") return false;
    if (
      character === "?" || character === ":" || character === "&" ||
      character === "|" || character === "`" || character === "^" ||
      character === "%"
    ) {
      return false;
    }
    index += 1;
  }
  return true;
}

/**
 * Dictionary Sharing §9.1's reduction (#425): the member's body with the
 * arguments substituted, or `undefined` when the guard refuses and the literal
 * shape has to stand.
 *
 * The guard is the one the ruling states, and it is what makes the rewrite an
 * *identity* on evaluation rather than a plausible-looking rearrangement: each
 * parameter occurs exactly once in the body, the occurrences read in parameter
 * order, and each sits where the body evaluates it exactly once and
 * unconditionally — so no argument expression is duplicated, dropped,
 * reordered, deferred, or made conditional. `Unit`'s `compare` — a constant
 * body naming neither operand — is refused by the dropping clause; a `Vector`'s
 * `equals` and a `Set`'s `show`, which read their operand twice, by the
 * duplication clause; and a `Vector`'s `compare`, which takes the right
 * operand's iterator before it walks the left, by the order and position
 * clauses together.
 *
 * A slot that is not an arrow at all takes the **selection** alone, which is
 * sound for the same reason the whole peephole is: building the literal
 * evaluates nothing (Constraints §6.3), and the slot is a plain reference to a
 * helper that reads no `this`.
 *
 * Counting *every* occurrence, not just free ones, is also what keeps the
 * textual substitution safe: a body carrying a nested dictionary literal binds
 * `__left`/`__value` again inside itself, and that second occurrence takes the
 * count past one, so no substitution can ever cross a binder of the same name.
 */
function reduceDerivedMember(
  slot: DerivedSlot,
  arguments_: readonly string[],
): string | undefined {
  const arrow = slot.arrow;
  if (arrow === undefined) {
    return atomicOperand(slot.rendered) && !slot.rendered.includes("(")
      ? `${slot.rendered}(${arguments_.join(", ")})`
      : undefined;
  }
  if (arrow.parameters.length !== arguments_.length) return undefined;
  // No derived body contains one, and the scanners above do not read the
  // substitutions inside one. Refusing is the safe half of the guess.
  if (arrow.body.includes("`")) return undefined;
  const positions: number[] = [];
  for (const parameter of arrow.parameters) {
    const occurrences = identifierOccurrences(arrow.body, parameter);
    if (occurrences.length !== 1) return undefined;
    const position = occurrences[0]!;
    if (positions.length > 0 && position <= positions[positions.length - 1]!) {
      return undefined;
    }
    if (!evaluatedInPlace(arrow.body, 0, arrow.body.length, position)) {
      return undefined;
    }
    positions.push(position);
  }
  let reduced = arrow.body;
  // Right to left, so the recorded offsets stay valid as the text grows.
  for (let index = positions.length - 1; index >= 0; index -= 1) {
    const argument = arguments_[index]!;
    const operand = atomicOperand(argument) ? argument : `(${argument})`;
    reduced = reduced.slice(0, positions[index]!) + operand +
      reduced.slice(positions[index]! + arrow.parameters[index]!.length);
  }
  // Parenthesized, because the shape it replaces was a *call* — a primary,
  // which binds tighter than anything a body can end up being. A bare ternary
  // dropped into `+`-concatenation reads the string prefix as its condition,
  // the hazard `#derivedShow`'s `Bool` arm memorializes. The condition is what
  // "parenthesized" is for and no more: a body that is already a primary (the
  // `Bool` arm's own parenthesized ternary, a helper call) is left alone rather
  // than given a second, meaningless pair.
  return atomicOperand(reduced) ? reduced : `(${reduced})`;
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
   *
   * `generated` is the emitter's own documentation for this declaration —
   * today, the Hexagon face a TypeScript type cannot spell (#364). It joins the
   * user's content in **one** block, user content first and generated content
   * after a blank line, because TS tooling attaches only the immediately
   * preceding block and two blocks would silently drop one (§7.3).
   *
   * `exported` opens the second generated channel: the `@throws` tags derived
   * from the content's own throws manifests (§6.1, §7.4 — #479). They come last
   * within the generated position, where JSDoc tags conventionally sit, and only
   * at an **exported** seat: the tag is consumer-boundary documentation, so a
   * private binding's `.js` block carries the manifest sentence verbatim like
   * all content and derives nothing.
   */
  lines(
    span: Source.Span,
    indent = "",
    generated: readonly string[] = [],
    exported = false,
  ): string[] {
    const doc = this.#byTarget.get(span.start.offset);
    if (doc !== undefined) this.#seated.add(doc);
    const written = doc === undefined ? "" : doc.content;
    const tags = exported
      ? throwsManifests(written).map(({ name, condition }) => `@throws {${name}} when ${condition}`)
      : [];
    const content = [written, ...generated, tags.join("\n")]
      .filter((part) => part !== "")
      .join("\n\n");
    return content === "" ? [] : jsDocBlock(content, indent);
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
 * Whether an item's own declaration crosses the module boundary — the ground
 * §7.4 puts the derived `@throws` tags on. A module-level `var` and a
 * destructuring `let` never do (their `exported` is `false` by type), and a
 * kind with no seat of its own is never asked.
 */
function itemExported(item: Core.Item): boolean {
  switch (item.kind) {
    case "Let":
    case "LetPattern":
    case "Fun":
    case "RecordDeclaration":
    case "Exception":
      return item.exported;
    default:
      return false;
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
 * The prelude declarations emission is allowed to recognize by identity.
 * Everything else about a user's or the stdlib's declarations reaches the
 * emitter as ordinary Core, and that is deliberate — this is the whole list of
 * places where the back end knows a specific declaration.
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
 * - `ignore` (#313, Statements §3.3): the first **term** in this list, and the
 *   only one. `stdlib/Prelude.hex` defines it as ordinary source — no door key,
 *   by Constraints §6.1's strictly-simpler law — so what is known here is the
 *   applied call's *cost*, not a second definition: `ignore(e)` in discarding
 *   position emits the bare statement `e;`, and in value position `void e`.
 *   Everything else about the binding is ordinary ESM, which is what makes
 *   `map(xs, ignore)` need nothing from this file.
 */
interface PreludeIds {
  readonly seq: Resolved.RecordId | undefined;
  readonly stream: Resolved.RecordId | undefined;
  readonly bool: Resolved.UnionId | undefined;
  readonly ignore: Resolved.SymbolId | undefined;
}

/**
 * `stdlib/Prelude.hex`'s `ignore` as this module sees it, or nothing when the
 * module never reached the name (#313).
 *
 * **The resolved binding, never the spelling.** A module may declare its own
 * `ignore` (Modules §5.4), and calls to *that* one must emit as ordinary calls —
 * erasing them would drop a user's function body on the floor. The symbol is read
 * off the synthesized prelude import, which is where the resolver records the
 * identity a bare or `Prelude.`-qualified reference landed on: both spellings
 * resolve to this one symbol (Modules §6.4), so one check covers both, and an
 * occluding module's own binding has a different symbol and is never matched.
 *
 * Absent inside `stdlib/Prelude.hex` itself, which imports nothing and so has no
 * entry to read — the self-blindness `preludeIds` documents for `seq` and `bool`,
 * here with no fallback because none is owed: `Prelude.hex` is the first module
 * of the prelude that could call `ignore` and it does not, and a missing entry
 * costs an un-erased call rather than a wrong one.
 */
function preludeIgnoreSymbol(module: Core.Module): Resolved.SymbolId | undefined {
  for (const item of module.items) {
    if (item.kind !== "Import" || !item.synthesized) continue;
    if (item.form.kind !== "Named") continue;
    const basename = item.specifier.slice(item.specifier.lastIndexOf("/") + 1);
    if (basename !== "Prelude") continue;
    for (const name of item.form.names) {
      if (name.imported === "ignore" && name.typeOnly !== true) return name.symbol;
    }
  }
  return undefined;
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
    // `Stream` needs no self-blindness fallback the way `seq` and `bool` do.
    // Those two are read *inside the module that declares them*, where
    // `preludeRecords` is still empty; this one is read only at an extern
    // boundary, and `stdlib/Stream.hex` declares no externs.
    //
    // **When that changes, the fallback above cannot be copied verbatim** — its
    // guard is `preludeRecords.size === 0`, and that is not "this module
    // declares the prelude's record", it is "no prelude record exists here yet",
    // which is a *proxy* true of exactly the earliest declarer. Measured:
    // `Seq.hex` sees `records=[]` and `Stream.hex` sees `records=["Seq"]`, so a
    // verbatim copy would never fire in the one module that needs it. (`bool`'s
    // `preludeUnions.size === 0` is the same proxy, sound for the same reason:
    // `Bool` is the first prelude union.) #659 pins `Stream`'s face and so makes
    // this identity read inside `Stream.hex`; the fallback it needs is guarded
    // on the module rather than on the inventory's size — the absence of a
    // `Stream` entry beside a declaration of that name is the real condition.
    stream: module.preludeRecords.get("Stream"),
    // `preludeBoolUnion` rather than a copy of it: the planner reads the same
    // pin, and "the passes must agree about which declaration is the pinned one"
    // is a claim better held by there being one reading than by two that match.
    bool: preludeBoolUnion(module),
    ignore: preludeIgnoreSymbol(module),
  };
}

/**
 * Whether a record identity is the one FFI Part 7 §2.3 **pins** — the prelude's
 * `Seq`, whose entire boundary meaning is the JS-native notion `for...of`
 * consumes, so its face is `Iterable<a>` (§2.3's criterion).
 *
 * **One seat for the pin's membership** (#622). A pin governs the type
 * *everywhere* it reaches a `.d.ts`: every rendered face spells the notion, the
 * home module's declaration seat is the same spelling as a transparent alias,
 * and §5's brand is not emitted at all. Those three readers ask this one
 * question, so a face pinned while a seat brands — the mismatch this issue
 * repaired — is no longer expressible.
 *
 * **Membership is all it answers.** `Stream(a)` is Part 3 §14.2's standing
 * candidate, and #659 does *not* land by widening this predicate alone; three
 * edits move together, and the other two are not here:
 *
 * 1. **this predicate** — whether the identity is pinned;
 * 2. **`renderType`'s pinned arm** — *which* notion. It spells `Iterable<…>`
 *    outright, correct while `Seq` is the only member and wrong the moment
 *    `Stream` joins, whose §14.2 notion is `IterableIterator<…>`. Widening the
 *    membership alone was measured: `Stream`'s faces came out `Iterable`. The
 *    notion becomes per-type there, and `pinnedDeclarationFace` follows for
 *    free, asking that arm rather than holding a spelling of its own;
 * 3. **`preludeIds`' `stream` entry** — a self-blindness fallback, without which
 *    `Stream.hex` cannot see its own pin and only its consumers move. Its guard
 *    is not `seq`'s; see the note there.
 *
 * `Bool`'s pin is a **union**, and its declaration seat is the union arm's own
 * `type Bool = boolean;` (§14.5) — nothing here duplicates or contests it.
 */
function pinnedRecord(record: Resolved.RecordId, prelude: PreludeIds): boolean {
  return prelude.seq !== undefined && record === prelude.seq;
}

/**
 * §2.3's pins as `nominalHomes` keys — the currency `qualifyingAliases` probes
 * in, where an identity is a key rather than an id and unions sit beside records.
 *
 * The same fact as `pinnedRecord`, in the one other shape the file needs it, so
 * a pin added to the predicate above is a pin here: rung 3's universe must not
 * count a qualifier whose face the pin settles, because a qualified `S.Seq(Int)`
 * renders as `Iterable<number>` and the alias `S` is nowhere in the emitted text.
 * `Bool` joins from the union side, which is why this and not `pinnedRecord`
 * itself is what that probe calls.
 */
function pinnedHomeKeys(prelude: PreludeIds): ReadonlySet<string> {
  return new Set([
    ...(prelude.bool === undefined ? [] : [nominalHomeKey("union", Number(prelude.bool))]),
    ...(prelude.seq === undefined ? [] : [nominalHomeKey("record", Number(prelude.seq))]),
  ]);
}

/**
 * A §2.3-pinned record's declaration seat — the pinned face at the type's own
 * §2.2 parameters — or `undefined` where the type is unpinned and §5's brand is
 * owed (#622):
 *
 * ```ts
 * export type Seq<a> = Iterable<a>;
 * ```
 *
 * The spelling is `renderType`'s, asked for the declared type at its own
 * parameters, rather than a second rendering of the same face: the seat *is* the
 * face, and one that changed without the other would reinstate the divergence.
 */
function pinnedDeclarationFace(
  item: Core.RecordItem,
  variables: ReadonlyMap<Typed.TypeVariableId, string>,
  faces: DeclarationFaces,
): string | undefined {
  if (!pinnedRecord(item.record, faces.prelude)) return undefined;
  const self: Typed.NominalRecordType = {
    kind: "NominalRecord",
    record: item.record,
    name: item.name,
    arguments: item.parameters.map((id) => ({ kind: "Variable", id })),
  };
  return renderType(self, variables, faces, false);
}

/**
 * FFI Part 7 §1.1's **contested vocabulary**: the TypeScript standard-library
 * spellings this file's face rules can write (#662; correction record §14.6).
 *
 * TypeScript resolves a name file-locally before its library, so a type-space
 * binding under one of these in a module's own `.d.ts` captures every face there
 * written in it. Four measured severity classes: a non-generic capture ships a
 * declaration file that fails the consumer's compile (`TS2315`); a *same-arity*
 * capture compiles clean everywhere with every face silently meaning the user's
 * type; an `Error` capture strips the real `Error` members from every exception
 * face; and an exception itself named `Error` captures its own face into a
 * circular alias (`TS2456`), which no TypeScript accepts.
 *
 * **This is the list, once.** A second copy is how the two halves of the repair
 * drift apart, and each half reads the whole list: the spellings join every
 * probe universe (§1.1 half 1, so nothing the compiler mints can take a lib
 * spelling a face needs), and a face written in one qualifies through
 * `globalThis` exactly where the file's universe binds it (§1.1 half 2,
 * `VocabularyFaces`).
 *
 * **The vocabulary is defined by the faces, not by TypeScript's library.** It
 * holds exactly what the seats below emit, and grows only when a face rule is
 * added — `IterableIterator` joins with Part 3 §14.2's `Stream` face (#659), on
 * the same edit that teaches `renderType`'s pinned arm to spell it. TypeScript
 * growing its library moves nothing: a global no face spells captures nothing,
 * because the capture needs both sides. Lowercase library spellings (`boolean`,
 * `number`, `string`, `void`, `unknown`, `never`) are outside it permanently —
 * nominal names are parser-gated uppercase.
 *
 * The one lib spelling a face rule writes that is deliberately *not* here is
 * `renderType`'s `Node` arm (`Array<…>`), the hidden vector-trie node: §1.1
 * enumerates the vocabulary from the published faces, and that arm's own note
 * records that the node never appears in a public `.d.ts`. A change that
 * publishes it has to revisit this list alongside that note.
 */
const CONTESTED_VOCABULARY = [
  "Iterable",
  "ReadonlyArray",
  "ReadonlyMap",
  "ReadonlySet",
  "Error",
] as const;

/** One member of the vocabulary above — the argument `VocabularyFaces` takes. */
type ContestedSpelling = typeof CONTESTED_VOCABULARY[number];

/**
 * One declaration file's spelling of the contested vocabulary (FFI Part 7 §1.1
 * half 2): bare where nothing in the file contests it, `globalThis.`-qualified
 * where something does.
 *
 * **Collision-only**, which is the house rule that a probe which has not had to
 * move emits the text it always emitted, read at the face: a file whose universe
 * binds no contested spelling emits the bare vocabulary byte-identically to
 * before this rule existed. Constant qualification was rejected — it would spend
 * every shipped file's resemblance to hand-written TypeScript on a hazard only
 * self-colliding files have (§14.6).
 *
 * The qualified spelling **is** the library type: assignability, inference and
 * member access are byte-for-byte those of the bare spelling, consumers never
 * write the qualifier themselves, and the reference works on every toolchain
 * that can consume these declarations at all (measured through real `tsc` at
 * 4.7, 5.0, 5.6 and current). The qualifier is itself beyond contest, and not by
 * the uppercase gate: `export let globalThis: Int = 1` is legal Hexagon and
 * emits a `declare const globalThis` into the same file, and the qualified faces
 * still resolve to the library types, because TypeScript resolves `globalThis`
 * in type position specially rather than through the file's bindings.
 *
 * The universe is §2.4's **flat** one — every top-level identifier the module's
 * items can put in the file, read without per-namespace subtlety. The bindings
 * that make qualification *necessary* are the type-space ones (an exported type,
 * a carried named import's local); a value-space-only member — a constructor
 * sharing the spelling, a carried namespace alias — triggers a qualification the
 * file did not strictly need, which is this rule's instance of §2.4's licensed
 * over-claim: one flat universe, no second drifting quantity, at the cost of a
 * harmless qualified spelling.
 *
 * Settled **before** any face is rendered, like every other spelling this file
 * chooses: the decision is per (file, spelling) and reads a property of the
 * module, so no seat's answer depends on the order the seats are visited in.
 */
class VocabularyFaces {
  readonly #qualified: ReadonlySet<string>;

  constructor(universe: ReadonlySet<string>) {
    this.#qualified = new Set(CONTESTED_VOCABULARY.filter((name) => universe.has(name)));
  }

  /** The spelling this file writes for one vocabulary member. */
  spell(name: ContestedSpelling): string {
    return this.#qualified.has(name) ? `globalThis.${name}` : name;
  }
}

/** The inert vocabulary a file with no universe to consult holds: always bare. */
const BARE_VOCABULARY = new VocabularyFaces(new Set());

/**
 * Unit's own spelling (Products §2.6), and the one runtime-vocabulary member
 * that owes the runtime module no capture: §1.2 rule 3 answers it with `void 0`.
 *
 * A reserved import of `globalThis.undefined` *works* — measured, and §14.7
 * records the measurement so the false ground "no qualifier can rescue
 * `undefined`" is not re-asserted — but `void 0` owes no import, is immune at
 * every scope with no per-module machinery, and is JavaScript's own idiom for
 * the value. It is also the only member capturable at *function* scope, being
 * the only lowercase one a `let` can bind.
 */
const UNIT_SPELLING = "undefined";

/** What a module binding `undefined` spells Unit as throughout (§1.2 rule 3). */
const UNIT_IMMUNE_SPELLING = "void 0";

/**
 * FFI Part 7 §1.2's **runtime vocabulary**: the global spellings the emitted
 * JavaScript writes (#666; correction record §14.7).
 *
 * §1.1's disease in the other file. JavaScript resolves a name file-locally
 * before the global scope too, so a module-scope binding under one of these
 * captures every emitted reference to it in that module. Four measured severity
 * classes: `export record Error` (or `Object`) beside a declared exception makes
 * every raise throw `TypeError: Error is not a constructor`; `export record
 * Symbol` beside any `for` loop makes the loop throw before its first iteration;
 * `let undefined = 1` and `export exception Boolean` beside a `Seq` boundary are
 * both **silently wrong values** — every Unit in scope becomes `1`, and
 * `Seq.length` of a three-element sequence answers `0`; and a binding JavaScript
 * refuses outright (`export let eval`, `import { await }`) is a load-time
 * `SyntaxError`.
 *
 * **The vocabulary is defined by the emitter's references, not by JavaScript's
 * global object.** It holds exactly the spellings the emitted runtime text can
 * write — helper bodies and inline expression seats alike — and grows only with
 * the text that references them. JavaScript growing its global object moves
 * nothing: a global the emitter never writes captures nothing, because the
 * capture needs both sides. `conformance/runtime-vocabulary.test.ts`'s tripwire
 * renders every helper and scans every emitted-reference seat, asserting the
 * referenced globals are a subset of this list, so the capturable set moves only
 * by conscious edit.
 *
 * Two members are here on the feeder rule rather than on a live user capture.
 * `console` has one reference — the debug probe's module-evaluation capture —
 * written into a stdlib module no user binding can reach, and is listed so a
 * future inlining of the probe is covered before it happens. `BigInt` is
 * capturable and is *not* in §14.7's measured enumeration, which the feeder rule
 * settles rather than the enumeration: `BigInt(…)` is written by the widening
 * seats and by `bigIntFromNat`/`bigIntFromInt`, and a union constructor named
 * `BigInt` binds the spelling at module level exactly as `Error` does.
 *
 * Siblings of §1.1's list, never copies: `Iterable` names no JavaScript value
 * and `Math` appears in no face, so each file guards its own.
 */
export const RUNTIME_VOCABULARY = [
  UNIT_SPELLING,
  "Array",
  "BigInt",
  "Boolean",
  "console",
  "Error",
  "Math",
  "Number",
  "Object",
  "RangeError",
  "String",
  "Symbol",
  "TypeError",
  "WeakMap",
] as const;

/** One member of the vocabulary above — the argument `RuntimeVocabulary` takes. */
type RuntimeSpelling = typeof RUNTIME_VOCABULARY[number];

/**
 * The vocabulary members that take a reserved capture from the program's runtime
 * module — every one but Unit's, whose rule is `void 0`.
 *
 * The runtime module exports the whole of this, always, whichever program asked:
 * its bytes depend on the vocabulary alone (§1.2, and `runtimeGlobalsText`).
 */
const RESERVED_CAPTURES: readonly Exclude<RuntimeSpelling, typeof UNIT_SPELLING>[] =
  RUNTIME_VOCABULARY.filter(
    (name): name is Exclude<RuntimeSpelling, typeof UNIT_SPELLING> => name !== UNIT_SPELLING,
  );

/** The reserved local one vocabulary member's capture is imported under. */
function reservedCapture(name: string): string {
  return `__${name}`;
}

/** Every spelling a minted `.js` import local must probe past (§1.2 rule 1). */
const MINTED_LOCAL_HAZARDS: ReadonlySet<string> = new Set<string>(RUNTIME_VOCABULARY);

/**
 * One module's spelling of the runtime vocabulary (FFI Part 7 §1.2 rules 2
 * and 3): bare where the module binds nothing under it, and stepped around
 * where it does.
 *
 * **On the spelling alone, never on the emission's reference set.** The trigger
 * reads what the module *binds* — top-level declarations, import locals, and
 * namespace-import aliases, one flat quantity settled before rendering (§2.4's
 * discipline) — because the reference set is exactly the quantity that re-draws
 * silently, and a trigger reading it would fail precisely when the hazard moves.
 * A module binding no vocabulary spelling emits the bare text it always did,
 * byte-identically.
 *
 * The namespace alias is in that quantity deliberately, against §1.1's grain: a
 * source `import module String …` lowers to `import * as String`, which occupies
 * JavaScript's value-name space like any binding, where a TypeScript namespace
 * import leaves the plain type-name space alone (§1.1's measured control). The
 * two sections' triggers diverge on exactly this binding form.
 *
 * The protected spelling is **manufactured, not found**. TypeScript resolves
 * type-position `globalThis` specially, immune to the file's bindings; JavaScript
 * protects no spelling of the global scope, and `export let globalThis: Int = 1`
 * emits `const globalThis = 1;` verbatim. So the capture is made in the one
 * namespace no user binding can enter — Lexer §3.2's reserved prefix — and
 * arrives as an import from a module the user's bindings cannot reach. It has to
 * be an import: `const` shadows its whole scope, so a leading `const __Error =
 * Error;` beside a later user `Error` binding reads the temporal dead zone and
 * the module dies at load.
 *
 * `undefined` is the exception at both ends: its trigger also reads function
 * scope (it is the one lowercase member, so the one a `let` can bind), and its
 * answer is `void 0` rather than a capture.
 */
class RuntimeVocabulary {
  readonly #captured: ReadonlySet<string>;
  readonly #unitContested: boolean;

  constructor(bindings: ReadonlySet<string>, unitContested: boolean) {
    this.#captured = new Set(RESERVED_CAPTURES.filter((name) => bindings.has(name)));
    this.#unitContested = unitContested;
  }

  /** The spelling this module writes for one vocabulary member. */
  spell(name: RuntimeSpelling): string {
    if (name === UNIT_SPELLING) return this.#unitContested ? UNIT_IMMUNE_SPELLING : UNIT_SPELLING;
    return this.#captured.has(name) ? reservedCapture(name) : name;
  }

  /**
   * The reserved captures this module imports, in vocabulary order — empty for
   * an uncontested module, which then writes no import line at all.
   *
   * The line doubles as a manifest: it names exactly the spellings this module
   * contests, whether or not its emission happens to reference them.
   */
  get captures(): readonly string[] {
    return RESERVED_CAPTURES.filter((name) => this.#captured.has(name)).map(reservedCapture);
  }
}

/** The inert vocabulary a module with no bindings to consult holds: always bare. */
const BARE_RUNTIME_VOCABULARY = new RuntimeVocabulary(new Set(), false);

/**
 * The text of a program's runtime module (FFI Part 7 §1.2), which holds the
 * globals capture no contested module can perform for itself.
 *
 * One binding per capturable vocabulary member, the full vocabulary always: the
 * bytes depend on the vocabulary alone, never on which program or module asked.
 * Nothing shadows inside it — the module binds only reserved names — which is
 * the whole reason the capture lives here rather than at the head of the
 * contested file.
 */
export function runtimeGlobalsText(): string {
  const captures = RESERVED_CAPTURES.map(reservedCapture);
  return [
    `const ${
      RESERVED_CAPTURES.map((name) => `${reservedCapture(name)} = globalThis.${name}`).join(
        ",\n  ",
      )
    };`,
    `export { ${captures.join(", ")} };`,
    "",
  ].join("\n");
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
 *
 * `Iterable` is a parameter because these lines are *faces*, and the preview
 * writes them into the module's own pane where a user's `Iterable` can capture
 * them — measured, `TS2315` on the `extends` clause. The shipped runtime module
 * is a file of its own whose four top-level names are fixed, so it never
 * qualifies and passes the bare spelling.
 */
function runtimeFaceDeclarations(iterable: string): readonly string[] {
  return [
    `export interface Vector<a> extends ${iterable}<a> { readonly "~hex": "Vector"; }`,
    `export interface Set<a> extends ${iterable}<a> { readonly "~hex": "Set"; }`,
    `export interface Map<k, v> extends ${iterable}<[k, v]> { readonly "~hex": "Map"; }`,
    `export interface Range extends ${iterable}<number> { readonly "~hex": "Range"; }`,
  ];
}

/**
 * The basename stem the runtime declaration module claims before probing.
 *
 * Shared with the runtime *module* (FFI Part 7 §1.2): `hex.d.ts` and `hex.js`
 * are one module identity under one probed stem, which is the reservation Part 1
 * §8.3 made and §1.2 takes up. The probe's input is the source basenames, so the
 * stem is defined even for a program owing `hex.js` and no `hex.d.ts`.
 */
export const RUNTIME_DECLARATIONS_STEM = "hex";

/** What a module at the source common root spells the runtime module by. */
const DEFAULT_RUNTIME_GLOBALS_SPECIFIER = `./${RUNTIME_DECLARATIONS_STEM}`;

/** The text of a program's runtime declaration module (FFI Part 1 §8.3). */
export function runtimeDeclarationsText(): string {
  return `${runtimeFaceDeclarations(BARE_VOCABULARY.spell("Iterable")).join("\n")}\n`;
}

/**
 * The same four interfaces as a namespace body, for the TypeScript preview.
 *
 * The preview is one pane of text with nothing to import from, so §8.3
 * obligation 6 has it declare the namespace inline instead. Members of an
 * ambient namespace are exported implicitly; the `export` keyword is dropped
 * because writing it inside `declare namespace` is redundant, and the bodies
 * are otherwise character-for-character the normative ones — including §1.1's
 * qualification, since sharing the pane is exactly what exposes them to it.
 */
function runtimeNamespaceDeclaration(
  alias: string,
  vocabulary: VocabularyFaces,
): readonly string[] {
  return [
    `declare namespace ${alias} {`,
    ...runtimeFaceDeclarations(vocabulary.spell("Iterable"))
      .map((line) => `  ${line.replace(/^export /, "")}`),
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
  /**
   * The probe's collision universe, **shared** with the sink that owns this one
   * (`NominalFaces`): rung 4's locals and rung 5's are minted into one file and
   * must not land on each other, so both probes add to the same set.
   */
  readonly #taken: Set<string>;
  /** The local each *referenced* entry renders as, by its index in the inventory. */
  readonly #locals = new Map<number, string>();

  constructor(entries: readonly Resolved.PreludeTypeImport[], taken: Set<string>) {
    this.#entries = entries;
    this.#taken = taken;
  }

  /** Rung 4, by identity — `undefined` where the inventory has no such entry. */
  reference(identity: NominalIdentity): string | undefined {
    switch (identity.kind) {
      case "union":
        return this.#reference((entry) => entry.union === identity.id);
      case "record":
        return this.#reference((entry) => entry.record === identity.id);
      case "externType":
        return this.#reference((entry) => entry.externType === identity.id);
    }
  }

  /**
   * The `import type` lines the rendered faces owe, in inventory order — which
   * is the normative prelude order, not first-use order, so the emitted text
   * does not depend on where in the module a face happens to sit.
   *
   * The `explicitLocal` skip is **vestigial in the ordinary case and kept for
   * one skewed one**. Rung 2 outranks rung 4 now and marks its own line owed, so
   * an entry a source import genuinely bound is never referenced here at all.
   * What is left is the shape where the resolver set `explicitLocal` — a
   * take-over it performs whenever the name binds a type — for a name a
   * collision then refused to bind, so rung 2 declines while the field stands.
   * There this sink answers with a local the file may not bind, and the skip is
   * the safer of two broken outputs: writing the line instead would bind that
   * local to a second declaration, and it was refused for colliding with a
   * first. Pre-existing #227 residue either way, and #621's neighbourhood.
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
   * The type's own name, then `Option_1`, `Option_2`, … — the `Hex` alias probe
   * of §2.1, on the same rule that only *generated* spellings move (Part 1 §10).
   * The suffix takes an underscore, the emitted JavaScript's own idiom (#619).
   *
   * Nearly unreachable today: a term cannot start with an uppercase letter, and
   * occlusion forecloses the local-type collision by keeping the occluded
   * identity out of every exported face. An import alias can spell any
   * identifier, so this is a guard rather than decoration.
   */
  #probe(name: string): string {
    if (!this.#taken.has(name)) return name;
    for (let suffix = 1; ; suffix += 1) {
      const candidate = `${name}_${suffix}`;
      if (!this.#taken.has(candidate)) return candidate;
    }
  }
}

/** One nominal identity, as the sink below is asked for it. */
type NominalIdentity =
  | { readonly kind: "union"; readonly id: Resolved.UnionId }
  | { readonly kind: "record"; readonly id: Resolved.RecordId }
  | { readonly kind: "externType"; readonly id: Resolved.ExternTypeId };

function identityKey(identity: NominalIdentity): string {
  return nominalHomeKey(identity.kind, Number(identity.id));
}

/**
 * **How this declaration file spells every nominal its faces mention** — FFI
 * Part 7 §2.4's one sink, five rungs in order.
 *
 * What a face carries is an identity and never a spelling, and how an identity
 * is spelled is a property of neither the type nor quite the module: one record
 * is `Point` where it is declared, `LibPoint` where an import renamed it, and
 * `Lib.Point` at a seat the source qualified. The emitter used to name every
 * nominal by its *declared* name with no record of what this file binds, which
 * is one defect wearing four faces (#574, #268, #617, #618).
 *
 * The rungs, in order:
 *
 * 1. **This module declares the identity** — the bare name. A declaration
 *    occludes (Modules §5.4), and a module's own type is its own to spell.
 * 2. **A source-written named import binds it** — that import's local, `as` and
 *    all, whatever else the same name binds (#617).
 * 3. **The occurrence is qualified through a namespace alias** — `Alias.Name`,
 *    the spelling the source wrote *at that seat* (#268). The one rung keyed on
 *    the occurrence, and answered only for a qualifier **this module itself
 *    wrote**: a spelling that travelled on a type alias's expansion would name a
 *    real type that is the wrong one, silently.
 * 4. **The prelude's type inventory** (#227), unchanged, probed local and all.
 * 5. **Nothing above answers** — the file mints its own import from the
 *    identity's home module (#618), under the same probe.
 *
 * **The file's imports are exactly what these answers owe.** Rung 1 owes
 * nothing; rungs 2 through 5 each owe the line their answer is spelled through,
 * and a line no answer owes is not written — which is what dissolves the two
 * collision shapes #574 filed, with no renaming at all. That is
 * candidates-then-filter, the architecture the prelude inventory and the
 * synthesized term import already follow: resolution decides availability,
 * emission decides what is imported, and neither is inferred from the other.
 */
class NominalFaces {
  readonly #fileId: Source.FileId;
  /** Rung 1: every nominal this module declares, exported or not, by identity. */
  readonly #own: ReadonlyMap<string, string>;
  /** Rung 2: the local a source-written named import binds each identity under. */
  readonly #imported: ReadonlyMap<string, string>;
  /** Rung 3: each qualifying alias's *emitted* spelling, after any yield. */
  readonly #aliasLocals: ReadonlyMap<string, string>;
  /** Rung 4. */
  readonly #prelude: PreludeTypeFaces;
  /** Rung 5's table and this module's path; both absent outside `compileProject`. */
  readonly #homes: ReadonlyMap<string, NominalHome> | undefined;
  readonly #path: string | undefined;
  /** The probe's universe, shared with rung 4's sink. */
  readonly #taken: Set<string>;

  /** What each rung's answers have actually owed, closed when rendering ends. */
  readonly #usedImports = new Set<string>();
  readonly #usedAliases = new Set<string>();
  readonly #minted = new Map<
    string,
    { readonly local: string; readonly name: string; readonly specifier: string }
  >();

  constructor(options: {
    readonly fileId: Source.FileId;
    readonly own: ReadonlyMap<string, string>;
    readonly imported: ReadonlyMap<string, string>;
    readonly aliasLocals: ReadonlyMap<string, string>;
    readonly prelude: PreludeTypeFaces;
    readonly homes: ReadonlyMap<string, NominalHome> | undefined;
    readonly path: string | undefined;
    readonly taken: Set<string>;
  }) {
    this.#fileId = options.fileId;
    this.#own = options.own;
    this.#imported = options.imported;
    this.#aliasLocals = options.aliasLocals;
    this.#prelude = options.prelude;
    this.#homes = options.homes;
    this.#path = options.path;
    this.#taken = options.taken;
  }

  /**
   * The finished spelling for one occurrence, and the record that its rung's
   * line is owed.
   *
   * `declared` is the type's own name, and it is the answer only in the shapes
   * §2.4 fences to #621: a nominal its owner keeps private, carried into an
   * exported face by a record field, a union payload, an exception payload or a
   * type alias with no diagnostic. There rung 1 answers with a name the file
   * does not bind, or no rung answers at all — the pre-existing behaviour, kept
   * rather than repaired here, because repairing it is the checker's boundary
   * rule and not this sink's.
   */
  reference(
    identity: NominalIdentity,
    qualifier: Typed.TypeQualifier | undefined,
    declared: string,
  ): string {
    const key = identityKey(identity);
    const own = this.#own.get(key);
    if (own !== undefined) return own;
    const local = this.#imported.get(key);
    if (local !== undefined) {
      this.#usedImports.add(key);
      return local;
    }
    // Rung 3 reads the occurrence, and only where **this** module wrote the
    // qualifier: a qualifier arriving on a type from another module is not an
    // occurrence here however it is spelled, and that a module of its own binds
    // an alias of the same spelling makes no difference — that is exactly the
    // case where reading the spelling would publish another module's type under
    // this one's name.
    if (qualifier !== undefined && qualifier.module === this.#fileId) {
      const alias = this.#aliasLocals.get(qualifier.alias);
      if (alias !== undefined) {
        this.#usedAliases.add(qualifier.alias);
        return `${alias}.${qualifier.member}`;
      }
    }
    return this.#prelude.reference(identity) ?? this.#mint(key, declared);
  }

  /** Whether a rendered face answered through this source alias (§2.4). */
  usedAlias(alias: string): boolean {
    return this.#usedAliases.has(alias);
  }

  /** This alias's emitted spelling — its own, or the one it yielded to. */
  aliasLocal(alias: string): string {
    return this.#aliasLocals.get(alias) ?? alias;
  }

  /** Whether a rendered face answered through this named import's identity. */
  usedImport(key: string): boolean {
    return this.#usedImports.has(key);
  }

  /** Rung 4's lines; see `PreludeTypeFaces.lines`. */
  preludeLines(): readonly { readonly line: string; readonly specifier: string }[] {
    return this.#prelude.lines();
  }

  /**
   * Rung 5's lines, **ordered by home specifier and then by imported name**.
   *
   * Rung 5 has no inventory to follow and must not fall back on first reference,
   * for the reason the inventory rule exists: emitted text may not depend on
   * where in the module a face happens to sit.
   */
  mintedLines(): readonly { readonly line: string; readonly specifier: string }[] {
    return [...this.#minted.values()]
      .sort((left, right) =>
        left.specifier === right.specifier
          ? (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
          : (left.specifier < right.specifier ? -1 : 1)
      )
      .map(({ local, name, specifier }) => ({
        line: `import type { ${local === name ? name : `${name} as ${local}`} } from ` +
          `${JSON.stringify(emittedModuleSpecifier(specifier))};`,
        specifier,
      }));
  }

  #mint(key: string, declared: string): string {
    const settled = this.#minted.get(key);
    if (settled !== undefined) return settled.local;
    const home = this.#homes?.get(key);
    if (home === undefined || this.#path === undefined) return declared;
    const local = this.#probe(home.name);
    this.#taken.add(local);
    this.#minted.set(key, {
      local,
      name: home.name,
      specifier: relativeSpecifier(this.#path, home.path),
    });
    return local;
  }

  /** The type's own name, then `Option_1`, `Option_2`, … — §2.1's probe exactly. */
  #probe(name: string): string {
    if (!this.#taken.has(name)) return name;
    for (let suffix = 1; ; suffix += 1) {
      const candidate = `${name}_${suffix}`;
      if (!this.#taken.has(candidate)) return candidate;
    }
  }
}

/**
 * What a declaration or preview emitter needs in order to render a type: the
 * prelude identities that pin two faces, the runtime-face sink, and §2.4's sink.
 */
interface DeclarationFaces {
  readonly prelude: PreludeIds;
  readonly runtime: RuntimeFaces;
  /**
   * §2.4's five rungs. The preview is out of scope and keeps bare names — it is
   * one pane of text with nothing to import from — so it holds an inert sink,
   * whose every rung declines and whose answer is the declared name.
   */
  readonly nominals: NominalFaces;
  /**
   * §1.1's contested vocabulary, per file. **The preview is not out of scope
   * here**, and the two readings do not conflict: §2.4's Scope note keeps the
   * preview on bare *names* because the pane has nothing to import from, and
   * qualification imports nothing — so the preview shows what would ship, which
   * is the #622 precedent (§14.6).
   */
  readonly vocabulary: VocabularyFaces;
}

/**
 * The brands this module's `.d.ts` really declares, out of the map's entries.
 *
 * `opaqueBrandNames` mints one for **every** extern type in an extern block,
 * because the preview declares them all; `emit` writes the `declare const` only
 * for an exported one. Feeding the map's whole range into the collision universe
 * therefore claimed a name the declaration file does not contain — the same
 * over-claim the gated-alias rule exists to prevent, one condition over — and a
 * namespace alias spelled `HandleBrand` moved to `HandleBrand_1` for a brand
 * nothing declared. The conditions here are `emit`'s own, arm for arm.
 *
 * `opaque` on a union or a record implies export, so those two arms cannot
 * differ today; they test it anyway, because a rule read off a coincidence is
 * one the next change to `opaque` silently breaks.
 *
 * A §2.3-**pinned** record declares no brand at all (#622), so it claims no name
 * either — the same over-claim, one condition further over.
 */
function emittedBrandNames(
  module: Core.Module,
  prelude: PreludeIds,
  brands: ReadonlyMap<string, string>,
): readonly string[] {
  return module.items.flatMap((item) => {
    if (item.kind === "RecordDeclaration" && item.opaque && pinnedRecord(item.record, prelude)) {
      return [];
    }
    if ((item.kind === "Union" || item.kind === "RecordDeclaration") && item.opaque) {
      return item.exported ? [brands.get(item.name)!] : [];
    }
    if (item.kind !== "ExternBlock") return [];
    return item.declarations.flatMap((declaration) =>
      declaration.kind === "ExternType" && declaration.exported
        ? [brands.get(declaration.localName)!]
        : []
    );
  });
}

/** The inert sink the preview holds; see `DeclarationFaces.nominals`. */
function bareNominalFaces(fileId: Source.FileId): NominalFaces {
  return new NominalFaces({
    fileId,
    own: new Map(),
    imported: new Map(),
    aliasLocals: new Map(),
    prelude: new PreludeTypeFaces([], new Set()),
    homes: undefined,
    path: undefined,
    taken: new Set(),
  });
}

/**
 * Rung 1's table: every nominal identity **this module declares**, by its
 * declared name.
 *
 * Exported and unexported alike. §2.4 fences the unexported case to #621 — the
 * checker's boundary rule is per *binding*, so a record field or a union payload
 * can still carry a private nominal into an exported face — and the fence's own
 * description is that rung 1 answers there with a name the file does not bind.
 * Leaving those identities out would not repair that; it would only change which
 * unbound name is printed.
 */
function declaredNominals(module: Core.Module): ReadonlyMap<string, string> {
  const declared = new Map<string, string>();
  for (const item of module.items) {
    if (item.kind === "Union") {
      declared.set(nominalHomeKey("union", Number(item.union)), item.name);
    } else if (item.kind === "RecordDeclaration") {
      declared.set(nominalHomeKey("record", Number(item.record)), item.name);
    } else if (item.kind === "ExternBlock") {
      for (const declaration of item.declarations) {
        if (declaration.kind !== "ExternType") continue;
        declared.set(
          nominalHomeKey("externType", Number(declaration.externType)),
          declaration.localName,
        );
      }
    }
  }
  return declared;
}

/**
 * Rung 2's table: the local each source-written **named** import binds an
 * identity under.
 *
 * By identity, so a rename is honoured — `import { Shape as S }` and a face
 * saying `S`, which is the half of one channel that disagreed with the other
 * (#617) — and so the term half of a name that binds both cannot cost the
 * `.d.ts` its type half. A name binding only a *type alias* carries no identity
 * and reaches no entry: faces hold an alias's expansion, never its name.
 */
function importedNominals(module: Core.Module): ReadonlyMap<string, string> {
  const bound = new Map<string, string>();
  for (const item of module.items) {
    if (item.kind !== "Import" || item.synthesized || item.form.kind !== "Named") continue;
    for (const name of item.form.names) {
      const key = importNameIdentity(name);
      if (key !== undefined && !bound.has(key)) bound.set(key, name.local);
    }
  }
  return bound;
}

/**
 * The identity key one named-import name binds, or `undefined` where it binds
 * none — a term, a constraint, or a type *alias*, which has no identity because
 * a face carries its expansion and never its name.
 */
function importNameIdentity(name: Resolved.ImportName): string | undefined {
  if (name.union !== undefined) return nominalHomeKey("union", Number(name.union));
  if (name.record !== undefined) return nominalHomeKey("record", Number(name.record));
  if (name.externType !== undefined) {
    return nominalHomeKey("externType", Number(name.externType));
  }
  return undefined;
}

/**
 * **Every type this module's `.d.ts` renders a face from**, in item order.
 *
 * The set `emit` walks, read for its types rather than for its text: exported
 * declarations, plus a union of any visibility, whose shape reaches the file
 * whether or not it is exported because an exported signature may name it. An
 * opaque exported type contributes nothing — its face is §5's brand, and its
 * fields and payloads are not published.
 *
 * What this must not become is a second, drifting copy of the conditions under
 * which a face is rendered — §2.4 says so — and where the two could disagree it
 * **errs narrow**. The asymmetry runs the opposite way to every other probe in
 * this file: a face this walk misses costs a qualified *spelling* and nothing
 * else, rung 5 minting a face that stays bound, correct and findable, while one
 * it invents moves a minted local aside for a name the file does not contain —
 * the failure the whole criterion exists to prevent. Every arm below is pinned
 * by a conformance test that fails if it drifts either way, because a
 * hand-maintained copy is exactly where the next drift lands.
 */
function renderedFaceTypes(
  module: Core.Module,
  specializations: readonly FundamentalSpecialization[],
): readonly Typed.Type[] {
  const types: Typed.Type[] = [];
  for (const item of module.items) {
    switch (item.kind) {
      case "ExternBlock":
        for (const declaration of item.declarations) {
          if (!declaration.exported) continue;
          if (declaration.kind === "ExternFun") {
            // #370: a constrained row publishes no face at all.
            if (declaration.binding.scheme.constraints.length > 0) continue;
            types.push(declaration.binding.scheme.type);
          } else if (declaration.kind !== "ExternType") {
            types.push(declaration.type);
          }
        }
        continue;
      case "TypeAlias":
        if (item.exported) types.push(item.type);
        continue;
      case "Union":
        // No `exported` test, deliberately: a private union still renders its
        // shape (`type Holder = …`), because an exported signature may name it.
        if (item.opaque && item.exported) continue;
        for (const constructor of item.constructors) {
          for (const slot of constructor.slots) types.push(slot.type);
        }
        continue;
      case "RecordDeclaration":
        if (!item.exported || item.opaque) continue;
        for (const field of item.fields) types.push(field.type);
        continue;
      case "Exception":
        if (!item.exported) continue;
        for (const slot of item.slots) types.push(slot.type);
        continue;
      case "Let":
      case "Fun": {
        if (!item.exported) continue;
        // A constrained export renders one face per **fundamental
        // specialization**, and `emit` writes none where the plan produced none
        // — a constraint of the user's own admits no editions (Part 8 §3.2) — or
        // where the value is not a lambda. Both conditions are `emit`'s, mirrored
        // here for the reason the whole function exists: a face this file does
        // not publish spells nothing in it.
        //
        // The lambda test is **unreachable, for two separate reasons**, in
        // `emit` as much as here — and both are worth naming, because a change
        // that retires one leaves the other standing:
        //
        // - For a `Let` it is short-circuited: `planItem` returns no editions
        //   for one whose value is not a lambda, so the editions test above
        //   already excludes every input this one would.
        // - For a `Fun` it is **statically vacuous**: `Core.FunItem.value` is
        //   typed `LambdaExpr`, so there is no non-lambda to exclude. Widen that
        //   field to `Expr` and this test becomes load-bearing at once, with
        //   nothing but this note to say so.
        //
        // It is kept because this function's contract is to read arm for arm
        // against `emit`, and a mirror that quietly drops a condition is a
        // mirror a reader can no longer check — but no test pins it, and while
        // both reasons hold, none can.
        if (item.binding.scheme.constraints.length > 0) {
          const editions = specializations.filter(
            ({ sourceSymbol }) => sourceSymbol === item.binding.symbol,
          );
          if (editions.length === 0 || item.value.kind !== "Lambda") continue;
        }
        // The scheme, not the editions: each edition is a *substitution* of it,
        // and substitution replaces variables, so every qualified nominal in an
        // edition is one of this scheme's and no edition adds one.
        types.push(item.binding.scheme.type);
        continue;
      }
      default:
        continue;
    }
  }
  return types;
}

/** One namespace-qualified nominal a rendered face carries. */
interface FaceQualifier {
  readonly qualifier: Typed.TypeQualifier;
  readonly key: string;
}

/** Every qualified nominal in one rendered face, with the identity it named. */
function faceQualifiers(type: Typed.Type, into: FaceQualifier[]): void {
  switch (type.kind) {
    case "Union":
      if (type.qualifier !== undefined) {
        into.push({ qualifier: type.qualifier, key: nominalHomeKey("union", Number(type.union)) });
      }
      for (const argument of type.arguments) faceQualifiers(argument, into);
      return;
    case "NominalRecord":
      if (type.qualifier !== undefined) {
        into.push({
          qualifier: type.qualifier,
          key: nominalHomeKey("record", Number(type.record)),
        });
      }
      for (const argument of type.arguments) faceQualifiers(argument, into);
      return;
    case "ExternType":
      if (type.qualifier !== undefined) {
        into.push({
          qualifier: type.qualifier,
          key: nominalHomeKey("externType", Number(type.externType)),
        });
      }
      return;
    case "Vector":
    case "Set":
    case "Array":
    case "JsSet":
    case "Node":
      faceQualifiers(type.element, into);
      return;
    case "Nullable":
      faceQualifiers(type.value, into);
      return;
    case "Map":
    case "JsMap":
      faceQualifiers(type.key, into);
      faceQualifiers(type.value, into);
      return;
    case "Tuple":
      for (const element of type.elements) faceQualifiers(element, into);
      return;
    case "Record":
      for (const field of type.fields) faceQualifiers(field.type, into);
      return;
    case "Function":
      for (const parameter of type.parameters) faceQualifiers(parameter, into);
      faceQualifiers(type.result, into);
      return;
    // `Primitive`, `Range`, `Variable` and `Error` are leaves with no nominal
    // inside them and nothing to qualify.
    default:
      return;
  }
}

/**
 * The namespace aliases a `.d.ts` for this module carries — the ones some
 * **rendered face** is answered at rung 3 through, which is exactly where the
 * file carries the alias's line (FFI Part 7 §2.4).
 *
 * The one member of the collision universe that is not over-claimed at all. An
 * alias absent from the emitted text contests nothing in it, and counting an
 * absent one would move a minted local aside for a name the reader cannot find,
 * which is the failure this rung order exists to avoid.
 *
 * A written dot is not enough, and three things keep one from counting — named
 * here as the instances they are, the rule itself being the emitted line, so a
 * rung or a pin added later cannot leave the list stale:
 *
 * - **§2.3's pins**, applied ahead of the sink, so a qualified `S.Seq(Int)`
 *   faces as `Iterable<number>` and a qualified `B.Bool` as `boolean`.
 * - **An earlier rung** — rung 2's local outranks rung 3 at a qualified seat as
 *   much as at a bare one, and rung 1's declaration likewise.
 * - **An occurrence that reaches no rendered face** — a qualifier in an
 *   unexported binding's signature, or in a type written inside a body, spells
 *   nothing this file publishes. That is what `renderedFaceTypes` is for.
 *
 * None of it is a rendering question: the faces are known from the module's
 * items, and collecting the qualifiers they carry is a walk that produces no
 * text — so the universe is complete before any spelling is chosen and the probe
 * still runs once and early.
 */
function qualifyingAliases(
  module: Core.Module,
  prelude: PreludeIds,
  own: ReadonlyMap<string, string>,
  imported: ReadonlyMap<string, string>,
  specializations: readonly FundamentalSpecialization[],
): readonly string[] {
  const occurrences: FaceQualifier[] = [];
  for (const type of renderedFaceTypes(module, specializations)) {
    faceQualifiers(type, occurrences);
  }
  const pinned = pinnedHomeKeys(prelude);
  const answered = new Set<string>();
  for (const { qualifier, key } of occurrences) {
    // A qualifier is a reference to a *binding*, so it means nothing outside the
    // scope that holds it: only the writing module may read one back.
    if (qualifier.module !== module.fileId) continue;
    if (pinned.has(key) || own.has(key) || imported.has(key)) continue;
    answered.add(qualifier.alias);
  }
  return module.items.flatMap((item) =>
    item.kind === "Import" && !item.synthesized && item.form.kind === "Namespace" &&
      answered.has(item.form.alias)
      ? [item.form.alias]
      : []
  );
}

/**
 * **Where the alias is contested, the alias yields the bare spelling to the
 * declaration** (FFI Part 7 §2.4; Modules §11.2).
 *
 * Modules §5.2 makes `import module Point from "./point"` beside a declared
 * `Point` legal — it is the companion idiom, not an accident — so rung 3's
 * `Point.Point` can meet a top-level `Point` this same file emits. The
 * declaration is, or may become, the module's public face; the alias is internal
 * to the file, reaching it on its own import line and in the qualified faces
 * that line serves, and nowhere else.
 *
 * A yielding alias is **a source name stepping aside, not a spelling the
 * compiler minted**, so it takes the collision-only suffix its emitted-JavaScript
 * counterpart takes — `Point_1`, counting from `_1`. Since #619 the two agree on
 * the spelling of a suffix — every suffixed `.d.ts` spelling counts `_1`, `_2`,
 * … What still tells them apart is the subject that moves and the universe each
 * probes against: here the *source alias* steps aside and the declaration keeps
 * the bare name, where a minted local is a spelling the compiler made up and is
 * itself what moves.
 *
 * The declaration file decides this **independently of the emitted JavaScript**,
 * and the two may differ. They must: the `.js` binds terms and the `.d.ts` binds
 * types and `declare const`s, so an alias forced to move in one can sit
 * uncontested in the other. Neither choice is observable — an alias is exported
 * from neither file.
 *
 * The empty map is the whole no-collision case, and it is the common one: every
 * lookup misses, every alias keeps its own spelling, and a module without this
 * collision emits the text it emitted before the plan existed.
 *
 * `contestants` is `declarationTopLevelNames` with the aliases themselves left
 * out — an alias does not contest itself, and two aliases cannot share a
 * spelling — so it is the same superset every probe here works against. Where it
 * over-claims, an alias moves that need not have; the cost of that is a spelling
 * exported from neither file, which is why the safe direction is this one.
 *
 * §1.1's contested vocabulary joins the **suffix probe** and deliberately not
 * the yield *decision*. The two are different questions asked of one set here:
 * a yielding alias must not land on a lib spelling a face needs (half 1, which
 * is why it is in `taken`), but a namespace binding does not occupy the plain
 * type-name space — measured with a control (#662) — so `import module Iterable`
 * captures nothing and is not a reason for the source alias to step aside.
 * Making it one would be worse than idle: the alias would leave the universe as
 * `Iterable_1` and the file's genuinely-owed qualification would stop firing.
 * §14.6 states the outcome directly — a carried `import module Iterable`
 * triggers only the licensed harmless qualification, never a yield.
 */
function declarationAliasPlan(
  aliases: readonly string[],
  contestants: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  if (!aliases.some((alias) => contestants.has(alias))) return new Map();
  const taken = new Set<string>([...contestants, ...aliases, ...CONTESTED_VOCABULARY]);
  const plan = new Map<string, string>();
  for (const alias of aliases) {
    if (!contestants.has(alias)) continue;
    let suffix = 1;
    let local = `${alias}_${suffix}`;
    while (taken.has(local)) local = `${alias}_${++suffix}`;
    taken.add(local);
    plan.set(alias, local);
  }
  return plan;
}

/**
 * Every top-level identifier a generated `.d.ts` for this module can spell, as
 * the `Hex` alias probe's collision universe (FFI Part 1 §10).
 *
 * §10 probes "every top-level identifier emitted in that `.d.ts`, regardless of
 * TypeScript namespace", and §8.3 obligation 2 names the class this must not
 * miss: the emitter already writes `import type * as Json from "./tiny-json.js"`
 * for a source-level namespace import, so a module importing under the alias
 * `Hex` forces `Hex_1`. That collision predates this ruling.
 *
 * **`namespaceAliases` is the one part the caller supplies**, because it is the
 * one member of this universe that is not over-claimed (§2.4). An alias reaches
 * the `.d.ts` only where some occurrence qualifies through it, and one that does
 * not contests nothing there; forcing `Hex_1` for an alias absent from the file
 * is exactly the failure the amended obligation 2 spells out. The declaration
 * emitter passes the qualifying aliases under their *emitted* spellings; the
 * preview, which writes every alias line unconditionally and is out of §2.4's
 * scope, passes them all.
 *
 * The set is deliberately a superset of the *source-derived* names a file can
 * emit. Whether a declaration reaches the file depends on its being exported
 * and on its kind, and re-deciding that here would be a second copy of `emit`'s
 * conditions, drifting from the first. Over-claiming only ever moves the
 * generated alias, which no user name depends on; under-claiming emits a
 * `.d.ts` that does not compile.
 *
 * The names the emitter *generates* are left out, and that is the one place this
 * is not a superset. The **brands** are put back by the caller — `DeclarationEmitter`
 * adds them to every universe it builds — because they cannot be excluded on a
 * spelling argument any more: they really do reach the file as `declare const
 * <Name>Brand: unique symbol` (FFI Part 7 §5), and §2.4 rung 5's minted local is
 * a *foreign type's own name*, which can end in `Brand` like anything else. The
 * old ground for leaving them out — that no compiler-chosen spelling could
 * collide with one — died with that rung.
 *
 * Three classes stay out, each on a prefix, suffix or case argument that still
 * holds against every spelling this file can mint:
 *
 * - A **`__bindingN` local** is under Lexer §3.2's reserved prefix, which no
 *   `Hex` spelling and no Hexagon type name can be.
 * - A **specialization edition** is `${sourceName}${FundamentalType}`, hence
 *   always suffixed `Nat`/`Int`/`Float`/`BigInt`/`Bool`/`String`/`Unit`. A
 *   generated-name scheme that ever drops that shape has to revisit this — and
 *   the brands are the standing example of a scheme whose shape argument did
 *   lapse, so the revisit is not hypothetical.
 * - The **`isHexError` guard face** (Exceptions §7.6, #478) is emitted by every
 *   module exporting an exception, so it really is a top-level identifier of
 *   that file — but every spelling this file mints starts uppercase: the
 *   runtime alias is `Hex` and a suffix, a brand is `<Name>Brand` and a suffix,
 *   and the two source-derived ones — a minted local's nominal name, a yielding
 *   alias's module alias — sit at seats the parser gates uppercase-start
 *   (`UpperName`). The guard starts lowercase, and a *user* export colliding
 *   with it is already the Part 8 §6.2 family's hard error (Part 7 §6), so the
 *   universe never has to route around it. A scheme that ever mints a
 *   lowercase-start spelling has to revisit this alongside the brands.
 *
 * **The module's own items, never `module.symbols`.** That list also carries the
 * prelude's terms and every symbol a *namespace* alias reaches, and neither is a
 * top-level identifier of this file — a namespace member is spelled through its
 * alias and nowhere else. Counting them is not over-approximation but error in
 * the direction the rung order cannot absorb: a record's constructor shares its
 * type's name, so every companion an alias reaches would push a minted local to
 * `Name_1` against a `Name` the file does not contain. The names the switch adds
 * are exactly what `emit` can write at top level.
 */
function declarationTopLevelNames(
  module: Core.Module,
  namespaceAliases: readonly string[] = allNamespaceAliases(module),
): ReadonlySet<string> {
  const names = new Set<string>(namespaceAliases);
  for (const item of module.items) {
    switch (item.kind) {
      case "Import":
        if (item.form.kind === "Named") {
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
      case "Let":
      case "Fun":
      case "Var":
        names.add(item.binding.name);
        continue;
      default:
        continue;
    }
  }
  return names;
}

/** Every namespace alias the source wrote, gated or not; see the caller above. */
function allNamespaceAliases(module: Core.Module): readonly string[] {
  return module.items.flatMap((item) =>
    item.kind === "Import" && item.form.kind === "Namespace" ? [item.form.alias] : []
  );
}

/**
 * The generated namespace alias: first free of `Hex`, `Hex_1`, `Hex_2`, …
 * (FFI Part 1 §10, Part 12 §11.1). Only the generated import is renamed; a user
 * name always keeps its spelling, and the suffix takes an underscore — the
 * emitted JavaScript's own idiom, never `Hex1` (#619).
 */
function runtimeFacesAlias(module: Core.Module, universe?: ReadonlySet<string>): string {
  const taken = universe ?? declarationTopLevelNames(module);
  if (!taken.has("Hex")) return "Hex";
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `Hex_${suffix}`;
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
  /**
   * The import item each imported constrained term arrived on, so a call site
   * that reaches for that term's fundamental edition (#440) knows which module
   * to import the edition from and which enumeration to check it against.
   */
  readonly #constrainedImportItems = new Map<Resolved.SymbolId, Core.ImportItem>();
  readonly #exceptions = new Map<Resolved.SymbolId, Core.ExceptionItem>();
  readonly #constraints = new Map<string, Core.ConstraintItem>();
  readonly #nullaryExceptions = new Set<Resolved.SymbolId>();
  /**
   * This module's brand identity (Exceptions §7.1, #488), read off its own
   * `exception` declarations — every one of them was stamped with it by the
   * resolver, so any one answers. `""` for a module that declares none, which
   * is exactly the module whose emission never spells a brand of its own.
   */
  readonly #identity: string;
  /**
   * This module's own internal export spellings, by source name; see
   * `internalNamePlan`.
   */
  readonly #internalNames: ReadonlyMap<string, string>;
  /**
   * The `__default_<member>` spellings this module's output claims — the
   * hoisted helpers of §6.5, one per defaulted member of an exported
   * constraint. Held apart from `#internalNames` because a defaulted member
   * publishes two names off one source name.
   */
  readonly #defaultHelpers: ReadonlySet<string>;
  /**
   * The same plan for an *imported* module, run over the inputs its import item
   * carries. Cached per item because every name on the import is asked.
   */
  readonly #importedInternalNames = new Map<
    Core.ImportItem,
    ReadonlyMap<string, string>
  >();
  /**
   * The local each default helper is reached by here. This module's own helpers
   * are their export spellings; an inherited one is aliased, because the
   * exporter's spelling is fixed by the member's name and two modules may
   * export a helper for one member name.
   */
  readonly #defaultHelperLocals = new Map<Resolved.SymbolId, string>();
  /**
   * The local a namespace import binds an internal constrained export under.
   * Namespace imports name no local of their own, and the same reason applies:
   * `Loud.volume` and `Soft.volume` both arrive preferring `__volume`.
   */
  readonly #namespaceConstrainedLocals = new Map<Resolved.SymbolId, string>();
  /** Internal-export locals an emitted `import` line already bound. */
  readonly #boundConstrainedImports = new Set<string>();
  /**
   * The emitted local of every namespace alias this module's own bindings
   * contest, by its source spelling; see `namespaceAliasPlan`. Empty for a
   * module with no such collision, which is every module the corpus ships.
   */
  readonly #namespaceAliases: ReadonlyMap<string, string>;
  readonly #generatedNames: GeneratedNames;
  /** Local each imported symbol is bound under, by the module's own imports. */
  readonly #importLocals = new Map<Resolved.SymbolId, string>();
  /** The prelude identities emission is permitted to know; see `PreludeIds`. */
  readonly #prelude: PreludeIds;
  /**
   * The fundamental each instance dictionary in scope is honored at, for the
   * call-site router; see `fundamentalInstanceDictionaries`.
   */
  readonly #instanceDictionaryHeads: ReadonlyMap<string, FundamentalType>;
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
   * Which (edition, constraint, fundamental) triples `#editionInstanceDictionary`
   * has already reported, so one missing instance is one diagnostic.
   *
   * The resolver is asked once per *dictionary node*, not once per edition — a
   * body naming its constraint's member three times asks three times — and the
   * answer is a function of the triple, so the three failures are one failure
   * seen three times. The same doctrine `Constraint.unsatisfied` follows on the
   * checker's side.
   */
  readonly #reportedEditionInstances = new Set<string>();
  /**
   * The program's Algorithm S candidate rows, or `undefined` where this module
   * is being emitted outside a project; see `JavaScriptEmissionOptions`.
   */
  readonly #fundamentalInstances: FundamentalInstances | undefined;
  /**
   * How each quantified type variable is spelled in the signature it comes from
   * (#425), which is what an evidence parameter is named after: `<a: Show>` is
   * answered by `__Show_a`, not by a counter, so a generic body reads as a
   * transcription of its own signature.
   *
   * An instance head carries its binders' *written* spellings and uses them; a
   * scheme does not carry them at all, so its variables take the same canonical
   * `a`, `b`, … the `.d.ts` face and the LSP hover already print for them. Both
   * are "the source type variable" as this compiler preserves it.
   *
   * Registered as declarations are reached and never overwritten: a variable
   * belongs to exactly one binder, and the first registration is that binder's.
   */
  readonly #variableSpellings = new Map<Typed.TypeVariableId, string>();
  #unnamedVariables = 0;
  /**
   * What each unparameterized instance reads while its own `const` initializes:
   * the rendered base-constraint evidence, and nothing else. Instance
   * dictionaries are emitted ahead of every term binding (Constraints §6.3), and
   * this is what orders them among themselves.
   */
  readonly #directEvidence = new Map<Core.Item, readonly string[]>();
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
  /**
   * Local dictionary names an emitted `import` line has already bound, so two
   * arrivals of one dictionary identity bind it once (#425). Filled during
   * rendering, unlike `#importedInstanceLocals`, because it records what was
   * *emitted* rather than what the resolver bound.
   */
  readonly #boundImportedDictionaries = new Set<string>();
  readonly #module: Core.Module;
  readonly #docs: DocIndex;
  readonly #exportInstanceEvidence: boolean;
  readonly #runtimes: RuntimeLocations;
  /**
   * How this module spells the runtime vocabulary (FFI Part 7 §1.2), settled in
   * construction from what the module *binds* and read at every seat that writes
   * a global — the same before-rendering discipline §1.1's face qualification
   * follows, and for the same reason: no seat's answer may depend on the order
   * the seats are visited in.
   */
  readonly #runtimeVocabulary: RuntimeVocabulary;
  /**
   * Unit's spelling in this module (Products §2.6, FFI Part 7 §1.2 rule 3):
   * `undefined` everywhere, and `void 0` throughout a module that binds
   * `undefined` at any scope.
   *
   * Held as one string because it is written at a dozen seats — Unit and the
   * empty tuple, an omitted-value placeholder, an errored binding's initializer,
   * an empty block's `return` — and because one of those seats compares against
   * it (`#hoistGroundEvidence`'s error-evidence check), which a second spelling
   * would silently defeat.
   */
  readonly #unit: string;
  /** Where this module finds the runtime module, when it contests anything. */
  readonly #runtimeGlobalsSpecifier: string;
  /**
   * The runtime operations this module's emission reached, and the local each
   * is named by — the import lists, decided by rendering exactly as the prelude
   * term channel's is (#263). Keyed by runtime basename; insertion order is not
   * the emitted order, see `#runtimeImports`.
   */
  readonly #runtimeUses = new Map<string, Map<string, string>>();
  readonly #specializations: readonly FundamentalSpecialization[];
  /**
   * Algorithm N recomputed for an imported callee, cached per symbol because
   * every call site of one asks (#440).
   */
  readonly #importedSpecializations = new Map<
    Resolved.SymbolId,
    readonly FundamentalSpecialization[]
  >();
  /**
   * The fundamental editions this module *calls* in another module, and the
   * local each is bound under — the import lines of #440, decided by rendering
   * for the reason every other post-rendering import channel is. Keyed by
   * import item rather than by specifier so a name is taken from the module the
   * source actually named, and so two aliases over one module bind once.
   */
  readonly #usedSpecializations = new Map<Core.ImportItem, Map<string, string>>();
  /**
   * Where a concrete member call reaches each ground instance's seats
   * (Constraints §6.1, #444), keyed by the **local** dictionary name — which is
   * what `Core.InstanceEvidence` carries, so the classifier reads the checker's
   * own selection rather than re-deciding it.
   *
   * `specifier` is absent for this module's own instances, whose seats are
   * module-level `const`s already in scope, and present for every arriving one,
   * where it names the module that *declares* the instance rather than the one
   * the dictionary was imported through — a diamond of re-exports settles the
   * dictionary on the first specifier in source order, and a transit module
   * re-exports the record, not its seats.
   */
  readonly #instanceSeats = new Map<
    string,
    {
      readonly seats: ReadonlyMap<string, string>;
      readonly specifier?: string;
    }
  >();
  /**
   * The member seats this module *calls* in another module, and the local each
   * is bound under — the import lines of #444, decided by rendering like every
   * other post-rendering import channel. Keyed by specifier rather than by
   * import item, because the declaring module may have no import item here at
   * all: a prelude companion has none by construction, and a transitively
   * reached instance's declaring module has none by definition.
   */
  readonly #usedMemberSeats = new Map<
    string,
    Map<string, { readonly member: string; readonly local: string }>
  >();
  /** This pass's answer to §8's seat-binding rule, or empty on the discovery pass. */
  readonly #memberSeatLocals: ReadonlyMap<string, string>;
  /**
   * Method Syntax §8.2's added imports (#585): a companion operation a dot call
   * here reached in a module this file never imported, by symbol, and the local
   * it is bound under once something references it.
   *
   * Claimed at the reference rather than up front, so an entry the rendering
   * never reaches costs neither an `import` line nor a name — the same discipline
   * `#usedMemberSeats` follows, and for the same reason: these locals sit in the
   * one namespace every other minted name probes past.
   */
  readonly #companionImportLocals = new Map<Resolved.SymbolId, string>();
  /** What the checker recorded for those operations, by symbol. */
  readonly #companionImports: ReadonlyMap<Resolved.SymbolId, Typed.CompanionImport>;
  /**
   * Every name this module binds at **module level** in the emitted JavaScript,
   * as far as its items settle it (#444).
   *
   * The contest set §8's seat-binding rule reads, minus the two entries only a
   * finished rendering can supply — a surviving forwarder import and a second
   * routed seat — which `memberSeatSpellings` adds. Generated names are absent
   * and need not be here: every one carries Lexer §3.2's reserved prefix, and a
   * constraint member's source spelling never can.
   */
  readonly #moduleBindings = new Set<string>();
  readonly #generatedBodies: {
    readonly specialization: FundamentalSpecialization;
    readonly text: string;
  }[] = [];
  /**
   * Dictionary Sharing §3.1 and §3.4: one module-level `const` per distinct
   * ground evidence tree — applications and structural dictionaries in one map,
   * because they are one family (§5) emitted in one block.
   *
   * An **application**'s key is the application spelled out —
   * `__Show_Option(__Show_Int)` — with every *argument* already replaced by the
   * name its own hoisting minted. That is §4's canonical key with the leaves
   * normalized: structurally equal trees render identically and so share a key,
   * and the two leaf kinds that denote one dictionary (a migrated companion's
   * `Primitive` evidence and the `Instance` evidence for the same source
   * instance) do not split into two bindings for one value.
   *
   * A **structural** node has no application to render, so it keys on §4's
   * extension instead — the demanded constraint, a canonical serialization of
   * its ground type, and its components' trees (`structuralEvidenceKey`). The
   * two key spaces cannot meet: an application's rendering begins with a
   * dictionary name and a structural key with `structural:`.
   *
   * Insertion order is dependency order and needs no sort: `#emitEvidence`
   * renders arguments before the application they sit in and a structural
   * initializer before it is interned, so a subtree is interned before its
   * parent, and a tree is strictly larger than its subterms (§5's
   * DAG-by-construction argument).
   */
  readonly #hoistedEvidence = new Map<
    string,
    { readonly name: string; readonly initializer: string }
  >();
  /**
   * Nonzero while rendering evidence that is read **as the module loads**,
   * above the hoisted block: an unparameterized instance's base-constraint
   * slots (`#directEvidence`). §5 places hoisted bindings after the factories
   * and zero-argument instances they reference, so a binding those instances
   * read back would be in its temporal dead zone. Suppressing the rewrite there
   * keeps the one direction of the edge §5 assumes, whatever the checker hands
   * this position.
   */
  #eagerEvidenceDepth = 0;

  constructor(module: Core.Module, options: JavaScriptEmissionOptions) {
    this.#module = module;
    this.#docs = new DocIndex(module.docs);
    this.#prelude = preludeIds(module);
    this.#instanceDictionaryHeads = fundamentalInstanceDictionaries(module, this.#prelude.bool);
    this.#exportInstanceEvidence = options.exportInstanceEvidence ?? false;
    this.#runtimes = options.runtimes ?? new Map();
    this.#runtimeVocabulary = runtimeVocabularyTrigger(module);
    this.#unit = this.#runtimeVocabulary.spell(UNIT_SPELLING);
    this.#runtimeGlobalsSpecifier = options.runtimeGlobalsSpecifier ??
      DEFAULT_RUNTIME_GLOBALS_SPECIFIER;
    const inputs = ownInternalNameInputs(module);
    this.#internalNames = internalNamePlan(inputs);
    this.#defaultHelpers = new Set(
      inputs.members
        .filter(({ defaulted }) => defaulted)
        .map(({ name }) => defaultHelperName(name)),
    );
    // Dictionary names are module-level `const`s and `import` bindings like any
    // other, so the emitter's own fresh names must dodge them. They are not
    // symbols, so nothing else puts them in the taken set (#425). A default
    // helper is a module-level `const` on the same footing, and its spelling is
    // fixed rather than probed, so it is seeded rather than minted.
    this.#generatedNames = new GeneratedNames([
      ...module.symbols.map(({ name }) => name),
      ...this.#defaultHelpers,
      ...module.items.flatMap((item) =>
        item.kind === "Honor"
          // The member seats ride with their dictionary (§6.1): they are
          // module-level `const`s the resolver already named, so the mint has
          // to dodge them for the same reason and by the same route.
          ? [item.dictionary, ...item.memberSeats.map(({ seat }) => seat)]
          : item.kind === "Import"
          ? item.instances.map(({ localDictionary }) => localDictionary)
          : []
      ),
      ...module.preludeInstances.map(({ localDictionary }) => localDictionary),
    ]);
    for (const item of module.items) {
      if (item.kind !== "Import") continue;
      for (const { localDictionary } of item.instances) {
        this.#importedInstanceLocals.add(localDictionary);
      }
    }
    this.#memberSeatLocals = options.memberSeatLocals ?? new Map();
    this.#companionImports = new Map(
      module.companionImports.map((companion) => [companion.symbol, companion]),
    );
    this.#namespaceAliases = namespaceAliasPlan(module);
    for (const name of moduleLevelBindings(module)) this.#moduleBindings.add(name);
    // The seat inventory, from the three channels an instance reaches a module
    // by. This module's own is seated first and never overwritten: an entry
    // arriving from outside for a dictionary declared here would be the same
    // instance travelling back, and its seats are in scope already.
    for (const item of module.items) {
      if (item.kind !== "Honor" || item.memberSeats.length === 0) continue;
      this.#instanceSeats.set(item.dictionary, {
        seats: new Map(item.memberSeats.map(({ member, seat }) => [member, seat])),
      });
    }
    for (
      const instance of [
        ...module.items.flatMap((item) => item.kind === "Import" ? item.instances : []),
        ...module.preludeInstances,
      ]
    ) {
      if (instance.memberSeats.length === 0) continue;
      // No specifier is no route: the seats exist in the declaring module, and
      // a call with no way to name that module keeps its forwarder.
      if (instance.seatSpecifier === undefined) continue;
      if (this.#instanceSeats.has(instance.localDictionary)) continue;
      this.#instanceSeats.set(instance.localDictionary, {
        seats: new Map(instance.memberSeats.map(({ member, seat }) => [member, seat])),
        specifier: instance.seatSpecifier,
      });
    }
    for (const item of module.items) {
      if (item.kind !== "Import" || item.form.kind === "Effect") continue;
      // Namespace members are reached as `Alias.member` and never by bare local.
      if (item.form.kind === "Namespace") continue;
      for (const name of item.form.names) {
        // Through `#identifier`, so a source-written import local under a name
        // JavaScript refuses to bind is renamed here and every reference follows
        // (FFI Part 7 §1.2 rule 4): `import { await } from …` emitted the
        // spelling verbatim and the module never parsed. The seat is shared with
        // every other unpublishable binding and the trigger is the same; what it
        // is *not* shared with is a vocabulary spelling, which is the user's
        // binding and makes the module qualify around it instead (rule 2).
        if (name.symbol !== undefined) {
          this.#importLocals.set(
            name.symbol,
            this.#importedLocal(name.symbol, name.local, mintedImportName(item, name)),
          );
        }
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
    // The prelude's and the imports' exception declarations, which a catch arm
    // may name by either spelling since #469. `#exceptions` decides what a
    // constructor pattern *tests* — Exceptions §7.1's `$hex`/`name` form rather
    // than a union tag — so a declaration that did not reach here compiles a
    // catch arm to a string comparison no thrown value satisfies, silently.
    //
    // `#nullaryExceptions` is deliberately not fed from here. It rewrites a
    // **value** reference into a construction, and an imported exception's value
    // face is the exporter's already-constructed one, reached by the import's
    // local name.
    for (const declaration of module.visibleExceptions) {
      this.#exceptions.set(declaration.binding.symbol, declaration);
    }
    let identity = "";
    for (const item of module.items) {
      if (item.kind === "ConstraintDeclaration") this.#constraints.set(item.name, item);
      if (item.kind !== "Exception") continue;
      this.#exceptions.set(item.binding.symbol, item);
      identity = item.owner;
      if (item.slots.length === 0) this.#nullaryExceptions.add(item.binding.symbol);
    }
    this.#identity = identity;
    for (const item of module.items) {
      if (item.kind !== "Import" || item.form.kind === "Effect") continue;
      for (const name of item.form.names) {
        if (name.symbol === undefined) continue;
        const symbol = this.#symbols.get(name.symbol);
        if ((symbol?.scheme.constraints.length ?? 0) > 0) {
          this.#constrainedImports.set(
            name.symbol,
            item.form.kind === "Namespace"
              ? this.#namespaceConstrainedLocal(name.symbol, name.imported)
              : this.#importedLocal(name.symbol, name.local, mintedImportName(item, name)),
          );
          this.#constrainedImportItems.set(name.symbol, item);
        }
      }
    }
    for (const item of module.items) {
      if (item.kind !== "ConstraintDeclaration" || !item.exported) continue;
      for (const member of item.members) {
        if (member.defaultValue === undefined) continue;
        this.#defaultHelperLocals.set(
          member.binding.symbol,
          defaultHelperName(member.binding.name),
        );
      }
    }
    this.#fundamentalInstances = options.fundamentalInstances;
    const plan = planFundamentalSpecializations(
      module,
      options.fundamentalInstances,
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
    const renderItem = (item: Core.Item): {
      readonly item: Core.Item;
      readonly lines: readonly string[];
      readonly start: Source.Span;
    } => {
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
        ? this.#docs.lines(item.span, "", [], itemExported(item))
        : [];
      return {
        item,
        lines: [...doc, ...lines],
        // A documented item starts, on the page, at its doc block.
        start: (doc.length > 0 ? this.#docs.span(item.span) : undefined) ?? item.span,
      };
    };

    // `Import` items render **last**, and only their own kind is held back
    // (#440). A source-written import line has to name the fundamental editions
    // this module's call sites chose, and only rendering the bodies discovers
    // which — the same after-the-fact knowledge every deferred channel below is
    // built on, except that this line has a *seat in the source order* and so
    // cannot move into a channel.
    //
    // Reordering is safe because the two directions are not symmetric. A body
    // never reads anything import rendering writes: the local every imported
    // name is spelled by is seated in construction (`#constrainedImports`,
    // `#importLocals`, `#namespaceConstrainedLocals`), not here, and the rest of
    // what this arm writes — the held-back synthesized and constraint items, the
    // bound-once dictionary and constrained-local sets — is read only by the
    // deferred channels and by itself.
    //
    // `#exports` is the one exception, and it is settled rather than reasoned
    // away: an import re-publishes its instances' evidence, so leaving that to
    // the second pass would move those lines below every term's. The claim runs
    // through `#exportEvidence`'s own idempotence — it is asked here, at the
    // item's source position, and the second pass's identical request is then a
    // no-op. Emitted export order is therefore unchanged by the split.
    const renderedByItem = new Map<Core.Item, ReturnType<typeof renderItem>>();
    for (const item of this.#module.items) {
      if (item.kind === "Import" && this.#exportInstanceEvidence) {
        for (const { localDictionary } of item.instances) {
          this.#exportEvidence(localDictionary);
        }
      }
      if (item.kind !== "Import") renderedByItem.set(item, renderItem(item));
    }
    for (const item of this.#module.items) {
      if (item.kind === "Import") renderedByItem.set(item, renderItem(item));
    }
    const rendered = this.#module.items.map((item) => renderedByItem.get(item)!);

    // Before the import lines, because a helper body may itself call the trie
    // runtime — `vectorIndex` is a bounds check around `get` — and the import
    // line has to know that.
    //
    // Two facts make the move safe, and both are invariants rather than
    // conveniences. Rendering a helper adds no *helper*: `#useHelper` closed
    // the dependency family over at the moment of request, and `renderHelper`
    // resolves names through `#helperName`, which requests nothing. And no
    // import renderer below adds one either — they emit `import` lines from
    // what rendering already recorded, and reach no expression. A renderer that
    // ever calls `#useHelper` has to move back below this.
    const helpers = [...this.#helpers]
      .sort()
      .flatMap((helper) =>
        renderHelper(
          helper,
          this.#helperName(helper),
          (dependency) => this.#helperName(dependency),
          (operation) => this.#useVectorRuntime(operation),
          (operation) => this.#useHashTrieRuntime(operation),
          this.#identity,
          (global) => this.#runtimeVocabulary.spell(global),
        )
      );

    // After rendering, because rendering is what discovers which prelude
    // dictionaries the body names (#153) and which prelude terms it names
    // (#263), and before the rendered entries, because these are imports.
    const preludeInstanceImports = this.#preludeInstanceImports();
    body.push(...preludeInstanceImports.map(({ line }) => line));
    const preludeTermImports = this.#preludeTermImports();
    body.push(...preludeTermImports.map(({ line }) => line));
    const specializationImports = this.#specializationImports();
    body.push(...specializationImports.flatMap(({ line }) => line === undefined ? [] : [line]));
    const memberSeatImports = this.#memberSeatImports();
    body.push(...memberSeatImports.map(({ line }) => line));
    const companionOperationImports = this.#companionOperationImports();
    body.push(...companionOperationImports.map(({ line }) => line));
    const runtimeImports = this.#runtimeImports();
    body.push(...runtimeImports.map(({ line }) => line));
    body.push(...this.#constraintMemberImports());

    // Constraints §6.3: an `honor` may sit below a term binding whose evaluation
    // demands its dictionary, and no source-ordering law forbids that, so the
    // dictionaries go out ahead of every term binding. Building one evaluates
    // nothing — a record of lambdas — which is what makes the move legal.
    const instances = orderInstances(
      rendered.filter(({ item }) => item.kind === "Honor"),
      this.#directEvidence,
    );
    if (instances.length > 0) {
      body.push(...instances.flatMap(({ lines }) => lines), "");
    }

    // Dictionary Sharing §5: the hoisted ground evidence — §3.1's applications
    // and §3.4's structural dictionaries alike — in dependency order, after the
    // factories and zero-argument instances they reference and before the term
    // bindings that demand them (Constraints §6.3's emission obligation, whose
    // §12 edit note generalizes it to both kinds). Insertion order *is*
    // dependency order — see
    // `#hoistedEvidence` — so nothing is sorted here, and §8 keeps them out of
    // the export list by the simple fact that nothing adds them to it.
    if (this.#hoistedEvidence.size > 0) {
      body.push(
        ...[...this.#hoistedEvidence.values()].map(
          ({ name, initializer }) => `const ${name} = ${initializer};`,
        ),
        "",
      );
    }

    const seated = this.#docs.seatedComments();
    const entries = sourceEntries(
      rendered.filter(({ item }) => item.kind !== "Honor"),
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
    // The stage-1 guard (Exceptions §7.6, #478), once per module that exports an
    // exception. It sits with the export lines rather than beside any one
    // constructor because it is the *module's* face, not a declaration's — and
    // it is a `const`, not a hoisted `function`, so nothing can call it above
    // its own definition and a JavaScript reader sees one generated line.
    if (this.#module.items.some((item) => item.kind === "Exception" && item.exported)) {
      body.push(IS_HEX_ERROR_GUARD);
    }
    body.push(...this.#exports);
    body.push(...this.#runtimeExports());

    // FFI Part 7 §1.2 rule 2's line, first in the file and a manifest of exactly
    // the spellings this module contests. Empty for every module that binds none
    // of them, which is what keeps an uncontested file byte-identical.
    const captures = this.#runtimeVocabulary.captures;
    const runtimeGlobalsImport = captures.length === 0 ? [] : [
      `import { ${captures.join(", ")} } from ${
        JSON.stringify(emittedModuleSpecifier(this.#runtimeGlobalsSpecifier))
      };`,
      "",
    ];
    const lines = [
      ...runtimeGlobalsImport,
      ...(helpers.length === 0 ? body : [...helpers, "", ...body]),
    ];

    const text = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
    return {
      kind: "JavaScript",
      fileId: this.#module.fileId,
      text,
      generatedSections: generatedSections(text, this.#generatedBodies),
      preludeInstanceImports: [
        ...new Set(preludeInstanceImports.map(({ specifier }) => specifier)),
      ],
      preludeTermImports: [
        ...new Set(preludeTermImports.map(({ specifier }) => specifier)),
      ],
      specializationImports: [
        ...new Set(specializationImports.map(({ specifier }) => specifier)),
      ],
      memberSeatImports: [
        ...new Set(memberSeatImports.map(({ specifier }) => specifier)),
      ],
      companionOperationImports: [
        ...new Set(companionOperationImports.map(({ specifier }) => specifier)),
      ],
      runtimeImports: runtimeImports.map(({ specifier }) => specifier),
      importsRuntimeGlobals: captures.length > 0,
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
    if (item.kind === "ErrorItem") return [`${prefix}${this.#unit};`];
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
      // One binding per local name. The resolver gives every arrival of one
      // dictionary identity the same local (§5's naming pass), so a diamond of
      // re-exports — or an import beside a direct one — reaches here twice with
      // one name, and emitting both `import` lines is `SyntaxError: Identifier
      // has already been declared` at load, after a clean compile. The first
      // specifier in source order owns the binding; the second names the same
      // dictionary, so which one is a matter of which module the emitted graph
      // must reach, and the earlier is as good an answer as the later.
      const instances = item.instances.flatMap(({ importedDictionary, localDictionary }) => {
        if (this.#boundImportedDictionaries.has(localDictionary)) return [];
        this.#boundImportedDictionaries.add(localDictionary);
        return [
          importedDictionary === localDictionary
            ? importedDictionary
            : `${importedDictionary} as ${localDictionary}`,
        ];
      });
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
        // One binding per local, for the reason the instance list above gives:
        // two aliases over one module reach the same symbol, and two `import`
        // lines binding one identifier is a `SyntaxError` at load.
        const constrained = item.form.names.flatMap(({ imported, symbol, constraintMember }) => {
          if (symbol === undefined || !this.#constrainedImports.has(symbol)) return [];
          if (constraintMember === true) return [];
          const local = this.#constrainedImports.get(symbol)!;
          if (this.#boundConstrainedImports.has(local)) return [];
          this.#boundConstrainedImports.add(local);
          const source = this.#importedInternalName(imported, item);
          return [source === local ? source : `${source} as ${local}`];
        });
        // A namespace alias can never reach an edition as `Math.plusInt` — the
        // editions are not on the exporter's Hexagon interface, so the resolver
        // binds no member for them — which is exactly why this form already has
        // a second, named line for the internal constrained exports. The
        // editions join that line rather than opening a third.
        const bindings = [...constrained, ...this.#specializationBindings(item)];
        return [
          `${prefix}import * as ${this.#namespaceLocal(item.form.alias)} from ${specifier};`,
          ...(bindings.length === 0
            ? []
            : [`${prefix}import { ${bindings.join(", ")} } from ${specifier};`]),
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
          ? this.#importedInternalName(imported, item)
          : imported;
        // The binding side takes rule 4's rename, matching what the references
        // were seated with in construction. A name with no symbol is a name the
        // resolver did not bind, on an already-errored module; there is no
        // number to mint from and nothing that reads it.
        const bound = symbol === undefined ? local : this.#identifier(symbol, local);
        return source === bound ? source : `${source} as ${bound}`;
      })
        // The editions this module's call sites chose in the module this import
        // names (#440), after the bindings the source wrote. One line per
        // specifier: they are named imports of the same module, and the only
        // reason they could not join it before was that the line was written
        // before the call sites were rendered.
        .concat(this.#specializationBindings(item));
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
        lines.push(
          ...this.#docs.lines(declaration.span, prefix, [], declaration.exported),
        );
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
          lines.push(`${prefix}const ${local} = ${this.#unit};`);
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
          if (declaration.exported && declaration.binding.scheme.constraints.length > 0) {
            // #370: a constrained row (§3.4) exports under the internal
            // constrained name, exactly as a constrained `.hex` binding does —
            // the ESM surface a Hexagon importer reaches, carrying trailing
            // evidence and staying out of the `.d.ts` face. Nothing about the
            // door changes here; this is the ordinary constrained-export shape,
            // which is what "types as an ordinary constrained function" means at
            // the boundary a module's output is.
            this.#exports.push(
              `export { ${local} as ${
                this.#ownInternalName(declaration.localName)
              } };`,
            );
            continue;
          }
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
        //
        // `Stream` is the mirror image and rides the same seam (§14). A foreign
        // result or value declared `Stream(a)` gets the §14.1 **shim** rather
        // than the adapter: position is the declaration of intent, so what the
        // `Seq` position launders the `Stream` position takes raw. Only these
        // two inbound positions are bridged here — a `Stream` *argument* handed
        // out to foreign code is the §14.2 outbound face, which is withheld.
        const inbound = (type: Typed.Type): "seq" | "stream" | undefined =>
          this.#isSequence(type) ? "seq" : this.#isStream(type) ? "stream" : undefined;
        const inboundResult = declaration.kind === "ExternFun"
          ? inbound(declaration.result)
          : inbound(declaration.type);
        const wrapper = declaration.kind === "ExternFun"
          ? inboundResult !== undefined || isUnit(declaration.result)
          : inboundResult !== undefined;
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
          const door = inboundResult === "stream" ? "streamInbound" : "seqInbound";
          if (declaration.kind === "ExternLet") {
            lines.push(
              `${prefix}const ${local} = ${this.#useHelper(door)}(${imported});`,
            );
          } else {
            const parameters = declaration.parameters.map((parameter) =>
              this.#identifier(parameter.symbol, parameter.name)
            );
            const call = `${imported}(${parameters.join(", ")})`;
            const value = inboundResult !== undefined
              ? `${this.#useHelper(door)}(${call})`
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
        this.#noteScheme(member.binding.scheme);
        const { names: dictionaries } = this.#evidenceParameters(
          dictionaryEntries(member.binding.scheme),
          evidenceNames,
        );
        const dictionary = dictionaries[0] ?? this.#unit;
        const parameters = [...sourceParameters, ...dictionaries];
        if (item.exported) {
          // §6.5: the forwarder gains an ESM export, which an importing module
          // that calls the member imports. Hexagon-to-Hexagon evidence plumbing
          // in the `__*` class, so it takes the internal name and
          // stays out of the `.d.ts` — §6.4 is untouched.
          this.#exports.push(
            `export { ${name} as ${this.#ownInternalName(member.binding.name)} };`,
          );
        }
        // A constraint member's `.js` seat is the forwarder emitted for it; the
        // dictionary type it also documents (§7.1) has no `.d.ts` form yet.
        return [
          ...this.#docs.lines(member.span, prefix, [], item.exported),
          `${prefix}const ${name} = ${arrowParameters(parameters)} => ${dictionary}.${member.binding.name}(${sourceParameters.join(", ")});`,
          ...this.#defaultHelper(item, member, depth, evidenceNames),
        ];
      });
    }
    if (item.kind === "Honor") {
      this.#noteHonorParameters(item.typeParameters);
      const { names: parameters, localEvidence } = this.#evidenceParameters(
        item.typeParameters.flatMap((parameter) =>
          parameter.constraints.map((constraint) => ({
            constraint,
            variable: parameter.variable,
          }))
        ),
        evidenceNames,
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
      // Dictionary Sharing §3.2: self-evidence at the factory's **identity
      // arrangement** — this instance's dictionary applied to the factory's own
      // parameters, in order — is the local record under construction, not a
      // fresh application. Legal precisely because every reader sits inside a
      // member's closure body and so is never evaluated during the factory's
      // application; a recursive traversal therefore allocates zero additional
      // dictionaries rather than one shared one, and the shape holds even when
      // the instantiation is not ground.
      //
      // Registered as the arrangement's rendering, which is what makes "in
      // order" load-bearing without a second comparison: a deeper (`Weird`) or
      // permuted (`Swap`) self-demand, and a *different* instance over the same
      // parameters (mutual recursion), all render to something else and fall
      // through to §3.3 unchanged.
      if (parameters.length > 0) {
        localEvidence.set(
          selfEvidenceKey(`${item.dictionary}(${parameters.join(", ")})`),
          localDictionary,
        );
      }
      // The one part of a dictionary that is read while the `const` initializes:
      // members and inherited defaults are lambdas, so the dictionaries they
      // name are read at call time and order nothing (Constraints §6.3). That is
      // also why it is the one position where a ground application must not
      // hoist — see `#eagerEvidenceDepth`.
      this.#eagerEvidenceDepth += 1;
      const baseEvidence = item.baseConstraints.map(({ name, evidence }) => ({
        name,
        rendered: this.#emitEvidence(evidence, name, item.span, localEvidence),
      }));
      this.#eagerEvidenceDepth -= 1;
      if (parameters.length === 0) {
        this.#directEvidence.set(item, baseEvidence.map(({ rendered }) => rendered));
      }
      const baseConstraints = baseEvidence.map(({ name, rendered }) =>
        objectProperty((name[0]?.toLowerCase() ?? "") + name.slice(1), rendered)
      );
      const members: MemberImplementation[] = item.derived
        ? this.#derivedMembers(item, localEvidence)
        : item.members.map((member) => ({
            name: member.name,
            rendered: this.#emitExpr(member.value, depth, localEvidence),
          }));
      // §6.5: a default inherited from an *exported* constraint is a reference
      // to the home module's helper, applied at call time. Deferring is not
      // cosmetic — `localDictionary` is the const currently being initialized,
      // so reading it eagerly here would hit the temporal dead zone.
      const inheritedDefaults = item.inheritedDefaults.map((inherited) => {
        this.#usedDefaultHelpers.add(inherited.member);
        const parameters_ = Array.from(
          { length: inherited.arity },
          (_, index) => `__arg${index}`,
        );
        return {
          name: inherited.name,
          rendered: `${arrowParameters(parameters_)} => ${
            this.#defaultHelperLocal(inherited.member, inherited.name)
          }(${[localDictionary, ...parameters_].join(", ")})`,
        };
      });
      const completedMembers =
        !item.derived && item.constraint === "Eq" &&
          !item.members.some(({ name }) => name === "notEquals")
          ? [
              ...members,
              ...inheritedDefaults,
              {
                name: "notEquals",
                rendered: `(__left, __right) => !${localDictionary}.equals(__left, __right)`,
              },
            ]
          : [...members, ...inheritedDefaults];
      if (this.#exportInstanceEvidence) {
        this.#exportEvidence(item.dictionary, item.exportedDictionary ?? item.dictionary);
      }
      // Constraints §6.1: at a **ground** instance every member's implementation
      // hoists to its own module-level binding — the instance's member seat —
      // and the record's slots reference the seats by name. That is §4.6's law
      // reaching emission: a member definition *is* a module-level binding, and
      // now emits as one, which is what a concrete member call routes to.
      //
      // Default versus override never reaches this shape. The three ways a slot
      // arrives — supplied, a §6.5 helper wrapper, the `Eq` completion above —
      // are three renderings of one completed member set (§2), and each takes a
      // seat on the same terms. A **parameterized** instance has none: its
      // members close over the factory's evidence parameters, so `seats` is
      // empty and the record carries its lambdas inline exactly as before.
      const seats = parameters.length === 0 ? item.memberSeats : [];
      const seatLines: string[] = [];
      const seatedSlots: string[] = [];
      const seated = new Set<string>();
      for (const { member, seat, exportedSeat } of seats) {
        const implementation = completedMembers.find(({ name }) => name === member);
        if (implementation === undefined) continue;
        seated.add(member);
        // §6.3's rider: the seat is emitted before the record that references
        // it, which costs nothing because a seat is a lambda and evaluates
        // nothing — and the record's slot reads stay call-time either way.
        seatLines.push(`${prefix}const ${seat} = ${implementation.rendered};`);
        seatedSlots.push(objectProperty(member, seat));
        // §8: the seats travel the declared-instance plumbing sweep under their
        // generated spellings, so a consumer's concrete call can import them.
        if (this.#exportInstanceEvidence) this.#exportEvidence(seat, exportedSeat ?? seat);
      }
      const slots = [
        ...baseConstraints,
        ...seatedSlots,
        // A slot the seat list does not name is one the constraint declaration
        // does not declare — an extra member, which the checker has already
        // refused. It keeps its inline rendering so a diagnosed module still
        // emits the record it emitted before.
        ...completedMembers
          .filter(({ name }) => !seated.has(name))
          .map(({ name, rendered }) => objectProperty(name, rendered)),
      ];
      const value = `{ ${slots.join(", ")} }`;
      if (parameters.length === 0) {
        return [...seatLines, `${prefix}const ${item.dictionary} = ${value};`];
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
      // suffix: `const g = __arg00 => describe(__arg00, undefined)` with
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
          `${prefix}else { throw new ${this.#spell("RangeError")}("Unexpected irrefutable pattern."); }`,
        );
        return lines;
      }
      if (item.pattern.kind === "Unit") return [`${prefix}${value};`];
      // Collections Part 3 §3.6's shape, at the `let` seat — which is also the
      // parameter-destructure seat, since a pattern parameter is lowered to a
      // fresh binder plus this item (Statements §5.2).
      //
      // A vector pattern has no JS destructuring form: a `Vector` is a trie, not
      // an array, and its slots are `__trieGet` calls. `#emitPattern` therefore
      // answers one with the empty string, which on this route means "binds
      // nothing" — so every binder underneath it was silently dropped and the
      // module ran with the names unbound. Anything carrying a vector anywhere
      // leaves the destructuring route entirely and takes the plan machinery the
      // loop head and the match arms already use.
      //
      // Whole rather than hybridised: a plan reads each slot off a *path* into
      // the subject (`p[1]`, `r.items`), so the record and tuple shells above a
      // vector leaf cost nothing to express there, and the output stays one flat
      // run of `const`s instead of a destructuring followed by a second pass.
      // Patterns with no vector in them keep the destructuring rendering, which
      // is the shape this file's emission tests pin.
      //
      // The plan's length tests are dropped rather than emitted. Pattern
      // Matching §5.3's gate has already refused every refutable pattern at this
      // position — §3.4 leaves exactly `[...rest]` and `[...]` — so a test here
      // could only be true, and emitting it would wrap the whole binding group
      // in a dead `if` whose binders would then have to escape it.
      if (containsVectorPattern(item.pattern)) {
        // No binder at all is the anonymous rest, `let [...] = xs`: §3.6 emits
        // no slice for it, and the value still has to be evaluated.
        if (patternBindings(item.pattern).length === 0) return [`${prefix}${value};`];
        // §3.6's shape names the subject once per slot read and once per
        // `__trieSize`, so a value that is not already a bare reference is bound
        // first rather than re-evaluated per slot.
        const subject = isSafeIdentifier(value)
          ? value
          : this.#generatedNames.fresh("subject");
        const plan = this.#emitPatternPlan(withoutUnboundVectors(item.pattern), subject);
        return [
          ...(subject === value ? [] : [`${prefix}const ${subject} = ${value};`]),
          ...plan.bindings.map((binding) => `${prefix}${binding}`),
        ];
      }
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
        const doc = this.#docs.lines(constructor.span, prefix, [], item.exported);
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
          `${prefix}const ${name} = __record => ` +
          `({ ...__record, [${this.#spell("Symbol")}.iterator]: ${this.#useHelper("seqIterate")} });`,
        ];
      }
      return [`${prefix}const ${name} = __record => __record;`];
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
      // The boundary guard (Exceptions §7.6, FFI Part 7 §6 — #478): assigned
      // once beside the constructor, on the exported ones only, because it is
      // the JS consumer's side of §7.4's discrimination and nothing on the
      // Hexagon side can name it. A nullary exception carries it too — its
      // export is function-shaped for JavaScript (Part 7 §6) — and the property
      // seat is collision-free by §7.6: no Hexagon surface can occupy a
      // property of an exception constructor.
      const guard = item.exported && depth === 0
        ? [
          `${prefix}${name}.is = (${GUARD_PARAMETER}) => ${
            guardTest(GUARD_PARAMETER, item.owner, item.binding.name)
          };`,
        ]
        : [];
      return [`${prefix}const ${name} = ${value};`, ...guard];
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
        // Erased, as in `#emitPatternPlan`: the value is the record, so the
        // binding form is whatever the one sub-pattern binds, applied directly
        // (#591). `let Crate({n}) = c` is `const { n } = c`.
        if (this.#recordConstructors.has(pattern.symbol)) {
          const inner = pattern.arguments[0];
          return inner === undefined ? "" : this.#emitPattern(inner);
        }
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
    const name = defaultHelperName(member.binding.name);
    const dictionary = `__dict`;
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
        `export { ${name} as ${this.#ownInternalName(item.binding.name)} };`,
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
    const parameters = sequences.map((_, index) => `__argument${index}`);
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
    this.#noteScheme(item.binding.scheme);
    const { names: dictionaryParameters, localEvidence } = this.#evidenceParameters(
      dictionaryEntries(item.binding.scheme),
      evidenceNames,
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
      const specialized = specializeItem(
        item as SpecializableItem,
        specialization,
        this.#prelude.bool,
        (constraintIdentity, type) =>
          this.#editionInstanceDictionary(constraintIdentity, type, specialization, item.span),
      );
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

  #emitBindingValue(
    item: Core.LetItem,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    // Ahead of the non-lambda return: the bare-alias case below reads this
    // binding's own scheme variables through `#emitConstrainedValue`'s residual
    // arm, and their spellings have to be registered before it does (#425).
    this.#noteScheme(item.binding.scheme);
    if (item.value.kind !== "Lambda") {
      return this.#emitExpr(item.value, depth, evidenceNames, true);
    }

    const { names: dictionaryParameters, localEvidence } = this.#evidenceParameters(
      dictionaryEntries(item.binding.scheme),
      evidenceNames,
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
        // §8.2's added import, ahead of the ordinary import rules: this symbol
        // is in no import item and in no local scope, so every spelling rule
        // below would answer with a name nothing binds (#585).
        const companion = this.#companionImportLocal(expression.symbol);
        if (companion !== undefined) {
          return (expression.evidence?.length ?? 0) === 0
            ? companion
            : this.#emitConstrainedValue(expression, companion, evidenceNames, bindingRhs);
        }
        if (this.#constrainedImports.has(expression.symbol)) {
          const imported = this.#constrainedImports.get(expression.symbol)!;
          // An imported constrained binding has the same trailing-evidence ABI
          // as a local one, so a value reference to it needs the same wrapper.
          return (expression.evidence?.length ?? 0) === 0
            ? imported
            : this.#emitConstrainedValue(expression, imported, evidenceNames, bindingRhs);
        }
        if (expression.text.includes(".")) return this.#qualifiedSpelling(expression.text);
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
      case "CollectionOperation":
        // `Node` alone since #373 closed the arc, and a *called* `Node.get` (the
        // only shape any source writes) never arrives here: `#emitCall` reads
        // the callee before this switch does and lowers the four operations to
        // raw array expressions. What is left for this arm is the un-called
        // reference — `let f = Node.get` inside a privileged runtime module —
        // which has no value form to emit, because the operations are syntax the
        // caller inlines and not functions that exist anywhere. `() => undefined`
        // is what it has always answered there; the whole `Set` family that used
        // to share this arm went to `stdlib/Set.hex`.
        return `() => ${this.#unit}`;
      case "Unit":
      case "ErrorExpr":
        return this.#unit;
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
        // The arity-0 tuple's value is `undefined`, never `[]` (Products §2.6,
        // #159). Unreachable from source, where `()` parses as the `Unit`
        // expression above — but this is the representation rule's decision
        // point, so it carries the arity-0 clause.
        if (expression.elements.length === 0) return this.#unit;
        return `[${expression.elements.map((element) =>
          this.#emitExpr(element, depth, evidenceNames)
        ).join(", ")}]`;
      case "Vector": {
        // Collections Part 3 §2's literal. `[]` is the one shared empty trie —
        // a value, not a call, because a `TrieVector` is immutable and there is
        // nothing to distinguish two of them by. A non-empty literal hands its
        // elements to one fold over `append`; the array is the argument list,
        // and never the vector.
        if (expression.elements.length === 0) return this.#useVectorRuntime("empty");
        const elements = expression.elements.map((element) =>
          this.#emitExpr(element, depth, evidenceNames)
        );
        return `${this.#useHelper("vectorOf")}([${elements.join(", ")}])`;
      }
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
          // The bracket is an *expression form*, so it stays the emitter's own
          // lowering after the Map step (#370) — `stdlib/Map.hex` owns the
          // companion surface and never the bracket, which is why `KeyError` is
          // an ordinary exported exception there rather than a door key. The
          // helper reaches the same `get` the door does, and re-throws its
          // absence as §4.3's payload.
          return `${this.#useHelper("mapIndex")}(${receiver}, ${index}, ${hash})`;
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
        return this.#emitMemberCall(
          expression.evidence,
          "Hash",
          "hash",
          [this.#emitExpr(expression.value, depth, evidenceNames)],
          expression.span,
          evidenceNames,
        );
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
          // inlines to its argument — except for the records whose
          // representation *includes* their JavaScript traversal method: `Seq`
          // (FFI Part 3 §9.4), `TrieVector`, which is what a `Vector(a)` is and
          // what `Hex.Vector<a> extends Iterable<a>` promises about it, since
          // #370 `HashTrie`, which is what a `Map(k, v)` is and what
          // `Hex.Map<k, v> extends Iterable<[k, v]>` promises about it, and
          // since #373 `HashSet`, which is what a `Set(a)` is and what
          // `Hex.Set<a> extends Iterable<a>` promises about it — the second
          // record on one runtime module, and the reason there is a second one
          // at all, since a `HashSet` would otherwise have inherited the pair
          // yielding face of the trie it wraps.
          //
          // The runtime side needs no equivalent of `#isSequence`'s prelude
          // lookup, and could not have one: every one of these records is
          // declared in a runtime module and exported from nowhere, so the only
          // expression in any program that can construct one is inside that
          // module. Being *in* it is therefore the whole test.
          const runtimeIterate = this.#runtimeIterateHelper(expression.type);
          const face = this.#isSequence(expression.type)
            ? `[${this.#spell("Symbol")}.iterator]: ${this.#useHelper("seqIterate")}`
            : runtimeIterate !== undefined
            ? `[${this.#spell("Symbol")}.iterator]: ${this.#useHelper(runtimeIterate)}`
            : undefined;
          if (face === undefined) {
            return this.#emitExpr(constructed, depth, evidenceNames);
          }
          return constructed.kind === "Record"
            ? this.#emitRecordLiteral(constructed, depth, evidenceNames, face)
            // Not a literal (`Seq(existing)`): splice the shared method on
            // rather than mutate a value that may already be someone else's.
            : `{ ...${this.#emitExpr(constructed, depth, evidenceNames)}, ${face} }`;
        }
        return this.#emitCall(expression, depth, evidenceNames);
      }
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
    // An erased `ignore` call is a `void` expression, not a call (#313), so its
    // precedence is the operator's and not `Precedence.Call`. `expressionPrecedence`
    // reads the Core node alone and cannot know; asking here keeps the table
    // honest instead of relying on "nothing binds tighter than a call around a
    // `Unit`", which is true today and is not a rule anything states.
    const precedence = this.#ignoreOperand(expression) === undefined
      ? expressionPrecedence(expression)
      : Precedence.Unary;
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
    if (items.length === 0) return [`${indent(depth)}return ${this.#unit};`];

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
   * The operand of an applied call to the prelude's `ignore`, or nothing
   * (Statements §3.3, #313).
   *
   * The single gate both emission positions ask, so the two can never disagree
   * about which calls are the language's discard idiom. Everything it tests is a
   * property of the *call*, not of the name: the callee resolves to the symbol
   * `preludeIgnoreSymbol` pinned, so an occluding module's own `ignore` (Modules
   * §5.4) fails here and emits as the ordinary call it is. The arity and evidence
   * guards are belt-and-braces against a shape `ignore : a -> Unit` cannot take —
   * a call the checker accepted has exactly one argument and no dictionary — and
   * cost one comparison to keep a malformed tree from losing its operand.
   */
  #ignoreOperand(expression: Core.Expr): Core.Expr | undefined {
    if (this.#prelude.ignore === undefined || expression.kind !== "Call") return undefined;
    if (expression.callee.kind !== "Name") return undefined;
    if (expression.callee.symbol !== this.#prelude.ignore) return undefined;
    if (expression.arguments.length !== 1 || expression.evidence.length > 0) return undefined;
    return expression.arguments[0];
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
    // Statements §3.3's **discarding position**, and the erasure is mandatory
    // there: statement position in JavaScript *is* discarding, so the call has
    // nothing left to do and the one sanctioned discard idiom costs nothing.
    // Recursing rather than emitting `${operand};` directly is what makes
    // `ignore(while …)` and `ignore(if …)` lower to the statement forms they
    // would have taken unwrapped — the operand inherits this position whole.
    const discarded = this.#ignoreOperand(expression);
    if (discarded !== undefined) {
      return this.#emitStatement(discarded, depth, evidenceNames);
    }
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
      default: {
        const emitted = this.#emitExpr(expression, depth, evidenceNames);
        // A record literal is the one emission that starts with `{`, where a
        // JavaScript statement begins a *block*: `{ name: value };` parses as a
        // labelled statement and evaluates something else entirely, or fails to
        // parse. Unreachable before #313 — nothing but `ignore` can put a
        // non-`Unit` value in statement position — and the parenthesis is the
        // whole fix.
        const statement = emitted.startsWith("{") ? `(${emitted})` : emitted;
        return [`${indent(depth)}${statement};`];
      }
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
      : this.#emitMemberCall(
        expression.iteration,
        "Iterable",
        "toSeq",
        [source],
        expression.span,
        evidenceNames,
      );
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
    // Statements §3.3's **value position** — everywhere `#emitStatement` did not
    // claim the call, so the `Unit` result is consumed. The erasure may not leak
    // the operand here: `void` evaluates it exactly once and answers `undefined`,
    // which is `Unit`'s representation, where dropping the call would answer the
    // operand's own value instead. `parenthesizeEqual` brackets an operand
    // sitting at `void`'s own rung rather than above it — an assignment, whose
    // expression form is itself a `void`, composes as `void (void (count = 1))`
    // rather than running the two together.
    const ignored = this.#ignoreOperand(expression);
    if (ignored !== undefined) {
      return `void ${
        this.#emitOperand(ignored, Precedence.Unary, depth, evidenceNames, true)
      }`;
    }
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
      const [node = this.#unit, index = this.#unit, value = this.#unit] = arguments_;
      switch (expression.callee.operation) {
        case "empty":
          return `new ${this.#spell("Array")}(32)`;
        case "get":
          return `(${node})[${index}]`;
        case "set":
          return `${this.#useHelper("nodeSet")}(${node}, ${index}, ${value})`;
        case "copy":
          return `(${node}).slice()`;
      }
    }
    const member = this.#memberCall(expression, depth, evidenceNames);
    if (member !== undefined) return member;
    const specialized = this.#specializedCallee(expression);
    const emittedCallee = specialized ??
      this.#emitExpr(expression.callee, depth, evidenceNames);
    const callee =
      expression.callee.kind === "Name" ||
        expression.callee.kind === "Call"
        ? emittedCallee
        : `(${emittedCallee})`;
    // The written arguments are rendered left to right whichever edition was
    // chosen, and evidence only ever follows them, so §8.1.4's same-evaluation-
    // order obligation is a property of the shape rather than something the
    // choice has to preserve.
    const arguments_ = expression.arguments.map((argument) =>
      this.#emitExpr(argument, depth, evidenceNames),
    );
    if (specialized === undefined) {
      arguments_.push(
        ...this.#evidenceArguments(expression.evidence, expression.span, evidenceNames),
      );
    }
    return `${callee}(${arguments_.join(", ")})`;
  }

  /**
   * Constraints §6.1's three-arm concrete-call doctrine, or `undefined` where
   * this call is not one (#444).
   *
   * A source-written member **call** — bare `show(x)`, qualified `Int.show(x)`,
   * dot `x.show()`, and a pipe stage, which desugars to the bare call and rides
   * with it — whose head resolves to a **concrete type** is a call to the
   * instance's method, and it erases by what the instance is:
   *
   * - a **ground declared instance** is a direct call to the honoring module's
   *   member seat, the forwarder hop and the evidence both gone — §4.6's law
   *   made emission-true, since bare-in-module, qualified, and dispatch now
   *   reach one binding;
   * - a **parameterized declared instance at a ground head** has no
   *   evidence-free binding to call — its members close over element evidence —
   *   so the member is read off Dictionary Sharing §3.1's hoisted ground
   *   application, `__Show_Option_Int.show(x)`;
   * - a head whose ground demand is **compiler-built** — tuples, `Unit`,
   *   `Bool` — reads the member off §3.4's hoisted structural dictionary, the
   *   same shape again.
   *
   * The gate is what the *checker* selected, never syntax. Evidence that is not
   * ground — a dictionary parameter anywhere in the tree — is a genuinely
   * polymorphic call, which keeps the forwarder and its trailing evidence
   * unchanged; so is a member reference that is not a callee, which the §6.1
   * constrained-function-as-value bullet owns and `#emitConstrainedValue`
   * renders. Elaboration-internal dispatch (interpolation, comparison
   * fallbacks, `Hash`, iteration) never arrives here at all: it carries no
   * `Call` node naming a member.
   *
   * The two slot-reading arms deliberately do not go through `#emitMemberCall`.
   * That path is Dictionary Sharing §9.1's literal-member seat, which reduces a
   * compiler-built literal it selects in place; this clause fixes the emitted
   * shape as a read off the hoisted binding, and there is no literal at the
   * site to reduce.
   */
  #memberCall(
    expression: Core.CallExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string | undefined {
    if (expression.callee.kind !== "Name") return undefined;
    const symbol = this.#symbols.get(expression.callee.symbol);
    if (symbol === undefined || symbol.kind !== "constraint-member") return undefined;
    // A member's scheme carries exactly one constraint — v1 members introduce
    // no type variables of their own (§2) — so a call site with any other
    // arity is not one this clause describes.
    if (expression.evidence.length !== 1) return undefined;
    const { constraint, value: evidence } = expression.evidence[0]!;
    if (evidence.kind === "Error" || !isGroundEvidence(evidence)) return undefined;
    const arguments_ = expression.arguments.map((argument) =>
      this.#emitExpr(argument, depth, evidenceNames)
    );
    const seat = this.#memberSeat(evidence, constraint, symbol.name);
    if (seat !== undefined) return `${seat}(${arguments_.join(", ")})`;
    const dictionary = this.#emitEvidence(
      evidence,
      constraint,
      expression.span,
      evidenceNames,
    );
    return `${dictionary}.${symbol.name}(${arguments_.join(", ")})`;
  }

  /**
   * The seat this member call names, or `undefined` where the instance has none
   * and the call reads a slot instead (#444).
   *
   * Only a **ground declared** instance has seats. A factory application is not
   * one — its evidence carries arguments, and a member closing over them could
   * not have hoisted — and neither is compiler-built structural evidence, whose
   * dictionary no module declares. Both fall to the hoisted-binding arms.
   *
   * A `Primitive` leaf is the same declared instance under the tag elaboration
   * stamps for a migrated companion (#344), so it resolves to that companion's
   * dictionary first and asks the same question of it.
   *
   * Routing to a seat is a materialization demand on the instance — record and
   * seats together — in the honoring module. This module's own instances are
   * emitted unconditionally, which discharges it locally; across a boundary the
   * declared-instance plumbing sweep (Dictionary Sharing §8) has already
   * emitted and exported both.
   */
  #memberSeat(
    evidence: Core.Evidence,
    constraint: Typed.ConstraintName,
    member: string,
  ): string | undefined {
    const dictionary = evidence.kind === "Primitive"
      ? this.#sourceInstanceDictionary(constraint, evidence.instance)
      : evidence.kind === "Instance" && evidence.arguments.length === 0
      ? evidence.dictionary
      : undefined;
    if (dictionary === undefined) return undefined;
    const instance = this.#instanceSeats.get(dictionary);
    const seat = instance?.seats.get(member);
    if (instance === undefined || seat === undefined) return undefined;
    // A local instance's seat is a `const` in this module and is called by its
    // own name: there is nothing to import and so nothing to bind it under.
    return instance.specifier === undefined
      ? seat
      : this.#memberSeatLocal(instance.specifier, seat, member);
  }

  /**
   * The local one imported member seat is called by here, claimed on first use
   * — `#specializationLocal`'s treatment of an imported edition, over a name
   * that already carries the reserved prefix.
   *
   * Dictionary Sharing §8's seat-binding rule is applied from the plan the
   * discovery pass computed (`memberSeatSpellings`): where the member's source
   * spelling was uncontested it is bound here, so the routed call reads exactly
   * as the source wrote it — `import { __Show_Int_show as show }`, then
   * `show(5)`. With no plan, or on any contest, the generated spelling stands.
   */
  #memberSeatLocal(specifier: string, seat: string, member: string): string {
    let names = this.#usedMemberSeats.get(specifier);
    if (names === undefined) {
      names = new Map();
      this.#usedMemberSeats.set(specifier, names);
    }
    const existing = names.get(seat);
    if (existing !== undefined) return existing.local;
    // Taken from the plan rather than claimed: the discovery pass established
    // that nothing in this module binds the spelling, and no generated name can
    // contest it — every one of those carries Lexer §3.2's prefix.
    const planned = this.#memberSeatLocals.get(memberSeatKey(specifier, seat));
    const local = planned ?? this.#generatedNames.claimGenerated(seat);
    names.set(seat, { member, local });
    return local;
  }

  /**
   * Dictionary Sharing §8's seat-binding rule, answered once every body is
   * rendered: which routed seats earn the member's **source** spelling, keyed
   * by `memberSeatKey`. `undefined` when none do, which is the signal that this
   * pass's output is already final (`emitJavaScript`).
   *
   * A spelling is contested by three things, and the first two are why this
   * cannot be decided at the call site:
   *
   * - **the forwarder.** Any surviving use of the member that is not a routed
   *   call — a value reference, a genuinely polymorphic call — binds the
   *   forwarder under the member's own name (Constraints §6.5), and whether one
   *   survives is exactly `#referencedSymbols`, which only rendering fills.
   * - **a second seat.** Two instances' seats for one member — `show(5)` beside
   *   `show("hi")` — are two bindings wanting one spelling, and §8 gives it to
   *   neither: *all* contestants keep their generated names, with no numbering,
   *   because a seat's generated spelling is already unique and reads better
   *   here than `show_1` would.
   * - **an ordinary binding**, whether the module's own or an import's
   *   (`#moduleBindings`), plus the prelude terms rendering actually
   *   referenced — the same filter `#preludeTermImports` applies, asked here so
   *   a prelude term and a seat cannot both claim one name.
   *
   * A **local** instance's member counts as a contestant too. Honoring a
   * constraint claims each member's name in the module's term space (§4.6), and
   * a bare use there means that instance's member — so binding some *other*
   * instance's seat to the same JavaScript name would make the emitted spelling
   * mean what the source spelling does not.
   */
  memberSeatSpellings(): ReadonlyMap<string, string> | undefined {
    const routed = [...this.#usedMemberSeats].flatMap(([specifier, names]) =>
      [...names].map(([seat, { member }]) => ({ specifier, seat, member }))
    );
    if (routed.length === 0) return undefined;
    const contested = new Set<string>(this.#moduleBindings);
    // Every name this module binds *anywhere*, module level or not. A seat's
    // local is a module-scope binding in the emitted JavaScript, so a parameter
    // or a body local spelled the same shadows it inside the very function whose
    // call was routed — `function f(show) { return show + show(1); }`, which
    // compiles clean and fails at run time. Both spellings are the member's own,
    // and both are legal: a head binder may shadow anything (Statements §5), and
    // a sequential binder may shadow the prelude layer (Modules §5.4). The seat
    // keeps its generated name instead, which Lexer §3.2's prefix protects.
    //
    // `Module.symbols` is the single funnel every binder goes through, which is
    // why the set is read off it rather than off the binder forms — no binder
    // form, present or future, can escape it. The file test is what keeps the
    // set to *bindings*: the imported and prelude symbols share the list, and
    // the member's own term is one of them, so counting those would contest
    // every spelling the rule exists to hand out.
    for (const { name, bindingSpan } of this.#module.symbols) {
      if (bindingSpan.fileId === this.#module.fileId) contested.add(name);
    }
    for (const item of this.#module.items) {
      if (item.kind !== "Honor") continue;
      for (const { member } of item.memberSeats) contested.add(member);
    }
    // The two import channels rendering decides — a synthesized prelude import
    // and a constraint's members — read exactly as their own renderers read
    // them, so a name that survives the filter there is a binding here.
    for (const item of [...this.#synthesizedImports, ...this.#constraintImports]) {
      if (item.form.kind === "Effect") continue;
      for (const { imported, local, symbol } of item.form.names) {
        if (symbol === undefined || !this.#referencedSymbols.has(symbol)) continue;
        contested.add(this.#constrainedImports.get(symbol) ?? local ?? imported);
      }
    }
    const wanted = new Map<string, number>();
    for (const { member } of routed) wanted.set(member, (wanted.get(member) ?? 0) + 1);
    const plan = new Map<string, string>();
    for (const { specifier, seat, member } of routed) {
      if (contested.has(member) || wanted.get(member) !== 1) continue;
      // The fourth contestant, and not a binding at all: a seat that took the
      // member's source spelling would be a minted import local mirroring an
      // export's, which FFI Part 7 §1.2 rule 1 refuses for the runtime
      // vocabulary and JavaScript's reserved words alike. Declining leaves the
      // seat under its generated name, which Lexer §3.2's prefix protects.
      if (MINTED_LOCAL_HAZARDS.has(member) || reservedWords.has(member)) continue;
      plan.set(memberSeatKey(specifier, seat), member);
    }
    return plan.size === 0 ? undefined : plan;
  }

  /**
   * `import` lines for the member seats this module's concrete calls reach in
   * another module, and the module edges they create (#444).
   *
   * A line of its own, always: the declaring module need have no import item
   * here — a prelude companion has none by construction, and an instance
   * reached through a re-export chain is declared in a module this one may
   * never name. That is defect 8's shape exactly, which is why the specifier is
   * reported to `project.ts` beside the line rather than inferred from the
   * tree. Sorted, so the emitted text is a function of what the module calls
   * rather than of where it calls it.
   */
  #memberSeatImports(): readonly {
    readonly line: string;
    readonly specifier: string;
  }[] {
    return [...this.#usedMemberSeats]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([specifier, names]) => ({
        line: `import { ${
          [...names]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([source, { local }]) => source === local ? source : `${source} as ${local}`)
            .join(", ")
        } } from ${JSON.stringify(emittedModuleSpecifier(specifier))};`,
        specifier,
      }));
  }

  /**
   * The local this module calls one §8.2 companion operation by, claimed on
   * first reference, or `undefined` where the symbol is not one (#585).
   *
   * The **source spelling when nothing here holds it** (`claimPublic`), because
   * that is the name the source wrote after the dot and the emitted call should
   * read as the source does; the reserved probe otherwise, since a module's own
   * binding owns its public name and the added import is what moves aside.
   * §8.2 calls exactly this "the emitter's ordinary renaming problem".
   */
  #companionImportLocal(symbol: Resolved.SymbolId): string | undefined {
    const existing = this.#companionImportLocals.get(symbol);
    if (existing !== undefined) return existing;
    const companion = this.#companionImports.get(symbol);
    if (companion === undefined) return undefined;
    const local = this.#generatedNames.claimPublic(companion.imported);
    this.#companionImportLocals.set(symbol, local);
    return local;
  }

  /**
   * `import` lines for the companion operations §4.2's import-insensitivity put
   * within reach of this module's dot calls but no import of its own names
   * (Method Syntax §8.2, #585), and the module edges they create.
   *
   * A line of its own, always, and for `#memberSeatImports`'s reason: the home
   * module need have no import item here at all — that *is* the case this
   * channel exists for — so the specifier is reported to `project.ts` rather
   * than inferred from the tree, or the emitted file imports one that was never
   * written. A **constrained** operation is imported under the exporter's
   * internal spelling, which is the face that takes trailing evidence (FFI Part
   * 7 §7); an unconstrained one is imported under its own name. Sorted, so the
   * emitted text is a function of what the module calls rather than of where.
   */
  #companionOperationImports(): readonly {
    readonly line: string;
    readonly specifier: string;
  }[] {
    const bySpecifier = new Map<string, string[]>();
    for (const [symbol, local] of this.#companionImportLocals) {
      const companion = this.#companionImports.get(symbol);
      if (companion === undefined) continue;
      const source = companion.constrained
        ? internalNamePlan(companion.internalNames).get(companion.imported) ??
          `__${companion.imported}`
        : companion.imported;
      const names = bySpecifier.get(companion.specifier) ?? [];
      names.push(source === local ? source : `${source} as ${local}`);
      bySpecifier.set(companion.specifier, names);
    }
    return [...bySpecifier]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([specifier, names]) => ({
        line: `import { ${names.sort((left, right) => left.localeCompare(right)).join(", ")} } from ${
          JSON.stringify(emittedModuleSpecifier(specifier))
        };`,
        specifier,
      }));
  }

  /**
   * The name a call reaches its callee's **fundamental edition** by, where one
   * covers this call site — FFI Part 8 §8.2's optimizer freedom, taken (§15 row
   * 18, #440). `undefined` keeps the generic edition and its trailing evidence,
   * which is every site where a type variable is still in play, the
   * instantiation is at a type Part 8 does not call fundamental, or the callee
   * publishes no editions at all.
   *
   * The imported half reaches the same editions the exporting module wrote, and
   * differs in exactly two places: the plan is recomputed rather than read off
   * this module's own items, and the name has to be *imported*, which is what
   * `#specializationLocal` records.
   *
   * All seven fundamentals route, at both halves (#441). Five name a primitive
   * and are read off the tag the elaborator stamps for one; `Bool` and `Unit`
   * are fundamental by *enumeration* (#147, #159), so `#groundFundamental`
   * reads their ground type instead — see it for why that is the same answer.
   */
  #specializedCallee(expression: Core.CallExpr): string | undefined {
    if (expression.callee.kind !== "Name") return undefined;
    const imported = this.#constrainedImportItems.get(expression.callee.symbol);
    const candidates = imported === undefined
      ? this.#specializationsFor(expression.callee.symbol)
      : this.#importedSpecializationsFor(expression.callee.symbol, imported);
    if (candidates.length === 0) return undefined;

    const symbol = this.#symbols.get(expression.callee.symbol);
    if (symbol === undefined) return undefined;
    const entries = dictionaryEntries(symbol.scheme);
    if (entries.length !== expression.evidence.length) return undefined;

    const assignments = new Map<Typed.TypeVariableId, FundamentalType>();
    for (const [index, entry] of entries.entries()) {
      const evidence = expression.evidence[index]?.value;
      const instance = evidence === undefined ? undefined : this.#groundFundamental(evidence);
      if (instance === undefined) return undefined;
      const previous = assignments.get(entry.variable);
      if (previous !== undefined && previous !== instance) return undefined;
      assignments.set(entry.variable, instance);
    }

    const chosen = candidates.find((candidate) =>
      candidate.assignment.every(({ variable, type }) =>
        assignments.get(variable) === type
      )
    );
    if (chosen === undefined) return undefined;
    return imported === undefined
      ? chosen.name
      : this.#specializationLocal(imported, chosen.name);
  }

  /**
   * The fundamental type a call site's evidence is ground at, or `undefined`
   * where it is ground at nothing Part 8 enumerates — a type variable still in
   * play, a user type, `Exn`.
   *
   * **Three** spellings for one question, because the fundamental set is defined
   * by enumeration and not by classification (#441), and the three answers come
   * from where each kind of evidence keeps the fact:
   *
   * - a **primitive**'s ground type is the tag elaboration stamps on its
   *   evidence (#344);
   * - **structural** evidence carries the ground type itself, which is how
   *   `Bool` and `Unit` are read for the constraints the compiler derives —
   *   since #147 and #159 they are the prelude union and the arity-0 tuple, and
   *   neither names a primitive to stamp;
   * - an **`Instance`** at `Bool` carries neither. Its subject is a union, so
   *   elaboration stamps nothing, and the node holds only a dictionary name —
   *   so the answer comes from what that dictionary is an instance *of*
   *   (`fundamentalInstanceDictionaries`). This is the case a constraint some
   *   module *declared* takes at `Bool`: the four the compiler derives never
   *   reach it, being satisfied structurally by the pin.
   *
   * Without the third, `tell(True)` at `<a: Describe>` kept the generic edition
   * and its trailing `__Describe_Bool` while `tellBool` sat exported beside it
   * — §8.2's freedom taken at five of the six non-`Unit` fundamentals and
   * dropped at the sixth. `Unit` needs no counterpart: no `honor` can name the
   * empty tuple, so no `Instance` evidence exists there to route.
   *
   * The `Bool` test is the union identity, not the name, in both places it is
   * made — the same one `#emitComparisonStep`'s representation pin uses, so a
   * module that declares its own `Bool` has not declared the prelude's.
   */
  #groundFundamental(evidence: Core.Evidence): FundamentalType | undefined {
    const primitive = primitiveInstance(evidence);
    if (primitive !== undefined) return primitive === "Exn" ? undefined : primitive;
    // Below the tag as a discipline, not because anything can see the order:
    // the two readings agree wherever both answer, and moving this arm above
    // the tag leaves the suite green (measured). The tag is asked first because
    // it is the *authoritative* reading — elaboration stamped it from the
    // requirement's own type, and it is total over primitives — while this is a
    // lookup that can miss, and a fallback belongs after the answer it falls
    // back from.
    //
    // A *parameterized* instance needs no test of its own: an instance binder
    // must appear in the head (Constraints §5.4), so a factory's subject names
    // its variables and is never a fundamental, and no factory's dictionary is
    // in the table to be found.
    if (evidence.kind === "Instance") {
      return this.#instanceDictionaryHeads.get(evidence.dictionary);
    }
    if (evidence.kind !== "Structural") return undefined;
    if (evidence.type.kind === "Tuple" && evidence.type.elements.length === 0) return "Unit";
    return evidence.type.kind === "Union" &&
        this.#prelude.bool !== undefined &&
        evidence.type.union === this.#prelude.bool
      ? "Bool"
      : undefined;
  }

  /**
   * The editions an imported callee publishes, recomputed from the scheme its
   * interface carries — `planImportedSpecializations` for why that is sound,
   * and `ImportItem.specializableTerms` for the one input it needs beyond the
   * scheme. A term whose value form mints no editions — a constraint member's
   * forwarder, an exported constrained binding whose value is not a lambda —
   * plans nothing here, and every call site of it keeps its evidence.
   */
  #importedSpecializationsFor(
    symbol: Resolved.SymbolId,
    item: Core.ImportItem,
  ): readonly FundamentalSpecialization[] {
    const cached = this.#importedSpecializations.get(symbol);
    if (cached !== undefined) return cached;
    const declaration = this.#symbols.get(symbol);
    const planned =
      declaration === undefined || !item.specializableTerms.includes(declaration.name)
        ? []
        : planImportedSpecializations(
            declaration,
            this.#module,
            this.#fundamentalInstances,
            this.#prelude.bool,
          );
    this.#importedSpecializations.set(symbol, planned);
    return planned;
  }

  /**
   * The local one imported edition is called by here, claimed on first use.
   *
   * An edition's name is a **public** spelling — `logInt` is what the exporter's
   * `.d.ts` face declares — unlike every other name this emitter mints, so it is
   * claimed as one: the bare name when nothing in this module binds it, and the
   * reserved probe when something does, which is #425's alias-only-on-collision
   * rule applied to a name arriving from outside.
   */
  #specializationLocal(item: Core.ImportItem, name: string): string {
    let names = this.#usedSpecializations.get(item);
    if (names === undefined) {
      names = new Map();
      this.#usedSpecializations.set(item, names);
    }
    const existing = names.get(name);
    if (existing !== undefined) return existing;
    const local = this.#generatedNames.claimPublic(name);
    names.set(name, local);
    return local;
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
      ...this.#emitCatchArms(expression.arms, error, depth + 2, evidenceNames),
      `${armIndent}throw ${error};`,
      `${inner}}`,
      `${prefix}})()`,
    ];
    return lines.join("\n");
  }

  /**
   * §7.4's discrimination as the body of a JS `catch (error)` block — the arms
   * only. One `if` per or-pattern alternative, each matching arm returning its
   * body's value, guards inside the block exactly where §5.3 puts them (a
   * throwing guard propagates, and a failing one falls through to the next arm).
   *
   * The implicit rethrow is the caller's `throw error;` after these lines, so
   * both of `catch`'s seats — `try`'s clause and the match catch clause
   * (Exceptions §5.1, §5.4) — emit one block of arms from one place.
   */
  #emitCatchArms(
    arms: readonly Core.MatchArm[],
    error: string,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    const armIndent = indent(depth);
    const lines: string[] = [];
    for (const arm of arms) {
      for (const alternative of expandOrPatterns(arm.pattern)) {
        const plan = this.#emitPatternPlan(alternative, error, true);
        const condition = plan.tests.length === 0
          ? "true"
          : plan.tests.join(" && ");
        lines.push(`${armIndent}if (${condition}) {`);
        const bodyDepth = depth + 1;
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
    return lines;
  }

  /**
   * A `match` in a position that returns its value — the statement-lifted rung
   * of the ladder, and what the IIFE rung wraps.
   *
   * The match catch clause (Exceptions §5.4) is lowered here, because its whole
   * observable contract is about what the emitted `try` encloses: the scrutinee
   * is evaluated into a binding *inside* the `try`, §7.4's discrimination runs
   * in the JS `catch` — a matched arm `return`s, so control never reaches the
   * data arms, and an unmatched one rethrows — and the data arms are lowered
   * after the `try` closes, on the binding. No data-arm test, guard, or body,
   * and no catch-arm guard or body, sits inside the protected region.
   */
  #emitReturningMatch(
    expression: Core.MatchExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    if (expression.catchArms === undefined) {
      return this.#emitMatchArms(expression, depth, evidenceNames);
    }
    const scrutinee = this.#generatedNames.fresh("scrutinee");
    const error = this.#generatedNames.fresh("error");
    const prefix = indent(depth);
    const inner = indent(depth + 1);
    return [
      `${prefix}let ${scrutinee};`,
      `${prefix}try {`,
      `${inner}${scrutinee} = ${
        this.#emitExpr(expression.scrutinee, depth + 1, evidenceNames)
      };`,
      `${prefix}} catch (${error}) {`,
      ...this.#emitCatchArms(expression.catchArms, error, depth + 1, evidenceNames),
      `${inner}throw ${error};`,
      `${prefix}}`,
      ...this.#emitMatchArms(expression, depth, evidenceNames, scrutinee),
    ];
  }

  /**
   * The data arms alone. `bound` names a local the scrutinee has already been
   * evaluated into — the match catch clause's temporary — and its presence is
   * what keeps the scrutinee from being emitted (and so evaluated) twice.
   */
  #emitMatchArms(
    expression: Core.MatchExpr,
    depth: number,
    evidenceNames: EvidenceNames,
    bound?: string,
  ): string[] {
    if (
      expression.union === undefined ||
      expression.arms.some((arm) =>
        arm.guard !== undefined || !isSimpleSwitchPattern(arm.pattern)
      )
    ) {
      return this.#emitConditionalMatch(expression, depth, evidenceNames, bound);
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
    const matchName = bound ??
      (needsMatchName ? this.#generatedNames.fresh("match") : undefined);
    const lines = matchName === undefined
      ? [`${prefix}switch (${
          this.#emitExpr(expression.scrutinee, depth, evidenceNames)
        }) {`]
      : [
          ...(bound === undefined
            ? [`${prefix}const ${matchName} = ${
                this.#emitExpr(expression.scrutinee, depth, evidenceNames)
              };`]
            : []),
          `${prefix}switch (${matchName}${tagged ? ".tag" : ""}) {`,
        ];
    for (const arm of expression.arms) {
      const pattern = arm.pattern;
      if (pattern.kind === "Constructor") {
        // `case true:` / `case false:` under the pin; the name-string otherwise.
        const pinned = this.#pinnedBoolLiteral(pattern.symbol);
        lines.push(`${armIndent}case ${pinned ?? JSON.stringify(pattern.tag)}:`);
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
        `${bodyIndent}throw new ${this.#spell("RangeError")}("Unexpected pattern.");`,
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
    bound?: string,
  ): string[] {
    const prefix = indent(depth);
    const matchName = bound ?? this.#generatedNames.fresh("match");
    const lines = bound === undefined
      ? [`${prefix}const ${matchName} = ${
          this.#emitExpr(expression.scrutinee, depth, evidenceNames)
        };`]
      : [];

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
    lines.push(`${prefix}throw new ${this.#spell("RangeError")}("Unexpected pattern.");`);
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
        // Collections Part 3 §3.6's shape, against the trie's 0-based
        // internals: one length test — `=== n` when the pattern fixes the
        // length, `>= k` when a rest absorbs the remainder — then an indexed
        // read per element slot, and a slice for a rest *binder* only, since
        // §3.5's cost is a cost the pattern should not pay for a `...` that
        // binds nothing.
        //
        // Slots after the rest count from the end, which is what makes
        // `[...init, last]` and `[first, ..., last]` mean what they say. The
        // rest's own window closes at the first of them, or at the size when
        // there is none.
        const size = (subject: string) => `${this.#useVectorRuntime("size")}(${subject})`;
        const fixed = pattern.elements.length;
        const plans = pattern.elements.map((element, index) => {
          const position = pattern.rest === undefined || index < pattern.rest.index
            ? String(index)
            : `${size(value)} - ${fixed - index}`;
          return this.#emitPatternPlan(
            element,
            `${this.#useVectorRuntime("get")}(${value}, ${position})`,
            exceptionPatterns,
          );
        });
        const combined = combinePatternPlans(plans);
        const restEnd = pattern.rest === undefined || pattern.rest.index === fixed
          ? size(value)
          : `${size(value)} - ${fixed - pattern.rest.index}`;
        const restPlan = pattern.rest?.pattern === undefined
          ? { tests: [], bindings: [] }
          : this.#emitPatternPlan(
              pattern.rest.pattern,
              `${this.#useVectorRuntime("slice")}(${value}, ${pattern.rest.index}, ${restEnd})`,
              exceptionPatterns,
            );
        return {
          tests: [
            pattern.rest === undefined
              ? `${size(value)} === ${fixed}`
              : `${size(value)} >= ${fixed}`,
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
        // The nominal record's constructor pattern erases with its constructor
        // (#591). Products §5.1/§5.4: `Point` is the identity on the record it
        // is handed, so the runtime value *is* the record and there is no
        // wrapper to unwrap — no tag to test, no payload field to read. The one
        // sub-pattern therefore plans against the very same value, which is the
        // pattern-side mirror of the direct application's erasure.
        if (this.#recordConstructors.has(pattern.symbol)) {
          const inner = pattern.arguments[0];
          return inner === undefined
            ? { tests: [], bindings: [] }
            : this.#emitPatternPlan(inner, value, exceptionPatterns);
        }
        const exception = exceptionPatterns
          ? this.#exceptions.get(pattern.symbol)
          : undefined;
        const metadata = this.#constructors.get(pattern.symbol);
        const pinned = this.#pinnedBoolLiteral(pattern.symbol);
        // Exceptions §7.4's two-stage discrimination, written as one chain per
        // arm: `!= null` so a `throw null` reaches the discriminator without
        // crashing it, then the **(module, name) pair** (#488). Comparing the
        // brand against a string subsumes stage 1's class test — a value whose
        // `$hex` equals this module's identity has a string `$hex` — and §7.4
        // fixes the pair per arm as the observable rule, leaving the shape of
        // the chain, including any hoist of the owner across a module's arms,
        // to the emitter. Testing `name` alone is what let module `A`'s `Boom`
        // through an arm written `B.Boom(tag)`, binding `tag` to `undefined`.
        const test = exception !== undefined
          ? `${value} != null && ${value}.$hex === ${JSON.stringify(exception.owner)} && ${value}.name === ${JSON.stringify(pattern.tag)}`
          : pinned !== undefined
          // The pin again: a `Bool` pattern tests the boolean it actually is.
          ? `${value} === ${pinned}`
          : metadata?.tagged
          ? `${value}.tag === ${JSON.stringify(pattern.tag)}`
          : `${value} === ${JSON.stringify(pattern.tag)}`;
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
    const converted = primitiveInstance(expression.evidence);
    if (converted !== undefined) {
      const literal = cleanNumber(expression.decimal);
      if (converted === "BigInt") return `${literal}n`;
      if (converted === "Float") return `${literal}.0`;
      return literal;
    }
    if (expression.evidence.kind === "Instance" || expression.evidence.kind === "Structural") {
      return this.#emitMemberCall(
        expression.evidence,
        "Num",
        "fromNat",
        [cleanNumber(expression.decimal)],
        expression.span,
        evidenceNames,
      );
    }
    if (expression.evidence.kind !== "Dictionary") return this.#unit;
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
    const widened = primitiveInstance(expression.evidence);
    if (widened !== undefined) {
      return widened === "BigInt" ? `${this.#spell("BigInt")}(${value})` : value;
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
      return this.#emitMemberCall(
        expression.evidence,
        "Num",
        "fromNat",
        [value],
        expression.span,
        evidenceNames,
      );
    }
    return this.#unit;
  }

  #emitWidenInt(
    expression: Core.WidenIntExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const value = this.#emitExpr(expression.value, depth, evidenceNames);
    const widened = primitiveInstance(expression.evidence);
    if (widened !== undefined) {
      return widened === "BigInt" ? `${this.#spell("BigInt")}(${value})` : value;
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
      return this.#emitMemberCall(
        expression.evidence,
        "Signed",
        "fromInt",
        [value],
        expression.span,
        evidenceNames,
      );
    }
    return this.#unit;
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
      // Primitive Types §7's table, as the inlining of `Show`'s slot at a
      // primitive that Constraints §6.1 licenses — the same string whether the
      // instance is wired or `stdlib/BigInt.hex`'s source (#344).
      const shown = primitiveInstance(part.evidence);
      if (shown !== undefined) {
        if (shown === "String") {
          return this.#emitOperand(
            part.expression,
            Precedence.Additive,
            depth,
            evidenceNames,
          );
        }
        return `${this.#spell("String")}(${value})`;
      }
      if (part.evidence.kind === "Instance" || part.evidence.kind === "Structural") {
        return this.#emitMemberCall(
          part.evidence,
          "Show",
          "show",
          [value],
          part.span,
          evidenceNames,
        );
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
    if (expression.evidence.kind === "Error") return this.#unit;
    // The operator faces at a primitive, inlined (Constraints §6.1's last
    // sentence; Primitive Types §7; Operators). The selection is the instance's
    // either way — a wired row for the companions still transitional, and
    // `stdlib/BigInt.hex`'s `honor` block for the one that migrated (#344) —
    // and the table below renders that one selection as the JavaScript operator
    // rather than as a slot read. Only the members the switch covers are
    // inlinable; everything else (`div` and its family, most of all) takes the
    // dictionary route below, which is where its implementation actually lives.
    //
    // `pow` is the one member whose inlining depends on where its guard lives.
    // At `BigInt`, `Int`, and now `Nat` the negative-exponent guard is Hexagon
    // in the companion, so inlining `a ** b` would reinstate the retired
    // implementation beside the source one — those three take the dictionary
    // route to the member their own module exports. `Nat` joined them with the
    // `Int` exponent seat (#541), which made a negative exponent spellable
    // there and so gave the guard something to catch. Only `Float` still
    // inlines, and correctly: it never had a guard at all, and its member's
    // `Int` exponent is the same JavaScript `number` the raw `**` wants.
    const candidate = INLINED_OPERATOR_MEMBERS.includes(expression.member)
      ? primitiveInstance(expression.evidence)
      : undefined;
    const instance = expression.member === "pow" && candidate !== "Float"
      ? undefined
      : candidate;
    if (instance === undefined) {
      // `Dictionary` and `Error` returned above, so what is left is an instance
      // — nominal, structural, or a primitive companion's source one, which
      // `#emitEvidence` resolves to the dictionary that module exports.
      return this.#emitMemberCall(
        expression.evidence,
        expression.constraint,
        expression.member,
        arguments_,
        expression.span,
        evidenceNames,
      );
    }
    const [leftExpression, rightExpression] = expression.arguments;
    const operand = (
      argument: Core.Expr | undefined,
      precedence: Precedence,
      parenthesizeEqual = false,
    ): string =>
      argument === undefined
        ? this.#unit
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
      case "pow": {
        // The one instance still reaching this arm inlines to the raw operator:
        // `Nat`, `Int`, and `BigInt` were routed to their companions' guarded
        // members above, so what is left is `Float`, which never had a guard.
        // Its member's exponent is an `Int` and its own seat a `Float`, but
        // both are one JavaScript `number` and the conversion between them is
        // the identity, so the raw `**` is the slot exactly. JS `**` refuses an
        // unparenthesized unary left operand, so a negated base gets its
        // parentheses here rather than from the precedence table.
        const left = leftExpression === undefined
          ? this.#unit
          : expressionPrecedence(leftExpression) === Precedence.Unary
            ? `(${this.#emitExpr(leftExpression, depth, evidenceNames)})`
            : operand(leftExpression, Precedence.Exponentiation, true);
        return `${left} ** ` + operand(rightExpression, Precedence.Exponentiation);
      }
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
    // The comparison faces at a primitive, inlined — the same licence the
    // operator table above takes (Constraints §6.1), and the same lowering
    // whether the instance is a wired row or `stdlib/BigInt.hex`'s source
    // (#344). The fast path below is the point: no dictionary stands between
    // the comparator and its consumer.
    const instance = primitiveInstance(step.evidence);
    if (instance === undefined) {
      if (step.evidence.kind === "Instance" || step.evidence.kind === "Structural") {
        const member = (name: string): string =>
          this.#emitMemberCall(
            step.evidence,
            constraint,
            name,
            [left, right],
            step.span,
            evidenceNames,
          );
        if (step.test === "Equal") return member("equals");
        if (step.test === "NotEqual") return member("notEquals");
        return comparisonFromOrdering(step.test, member("compare"));
      }
      return "false";
    }
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
    return this.#unit;
  }

  /**
   * Selects direct Eq evidence or the nested Eq base constraint of Hash.
   *
   * A hand-mirror of one edge of the stdlib constraint graph, and correct only
   * while that graph is the whole graph: a user base constraint `Wide<a: Hash>`
   * reaches `Eq` by a path neither probe spells. So it is the
   * **components-blind fallback** (#669) — every seat with a selection to read
   * renders the recorded entailment path through `#emitEvidence` instead.
   *
   * There was one live route into it, and it is gone. A specialization-planner
   * edition used to rewrite its dictionary parameters to `Primitive` evidence
   * while leaving the component's walked type a `Variable`, so
   * `#derivedEquals`' bare-`Variable` arm arrived here on a module the checker
   * had **accepted** — both probes missing, because an edition has no dictionary
   * parameters at all, and the `Hash` fallback reporting `missing \`Hash\`
   * evidence` on a program that never writes `Hash`. `specializeItem` now
   * carries the assignment into the edition's types as well as its evidence
   * (#675), so no accepted program presents a variable component the enclosing
   * scheme does not bind, and nothing reaches here.
   *
   * What the helper is retained for is best-effort emission on a module the
   * checker **rejected**, where a walk may still have no selection to read and
   * these two probes are the best guess available. Say the rest plainly: that
   * path is measured by nothing. A per-call counter puts its reaches at **zero**
   * across the entire compiler suite, accepted and rejected programs alike, so
   * the helper's behaviour is currently unpinned and a reader changing it will
   * get no signal from the tests.
   */
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
   * `Hash` is rendered from the selection like the other three (#609). The
   * licence that once exempted it — deriving `Hash` requires derived `Eq`
   * (Collections Part 2 §4.3), so the structural answer *is* the instance's
   * answer — was true of the *answer* and false of the *walk*: expanding a
   * component's representation needs that component's declaration, and a module
   * only has the declarations it names. A nominal reaching this module solely
   * through an imported alias had no row to expand, so the walk took its miss
   * arm and collapsed the hash to a constant while the component's own
   * dictionary stood beside it unused.
   */
  #derivedMembers(
    item: Core.HonorItem,
    evidenceNames: EvidenceNames,
  ): MemberImplementation[] {
    const subject = item.subject;
    const components = componentEvidence(item.components);
    const equals = (left: string, right: string): string =>
      this.#derivedEquals(subject, left, right, evidenceNames, false, components);
    if (item.constraint === "Eq") {
      return [
        { name: "equals", rendered: `(__left, __right) => ${equals("__left", "__right")}` },
        {
          name: "notEquals",
          rendered: `(__left, __right) => !(${equals("__left", "__right")})`,
        },
      ];
    }
    if (item.constraint === "Show") {
      return [{
        name: "show",
        rendered: `__value => ${this.#derivedShow(subject, "__value", evidenceNames, components)}`,
      }];
    }
    if (item.constraint === "Ord") {
      return [{
        name: "compare",
        rendered: `(__left, __right) => ${this.#derivedCompare(
          subject,
          "__left",
          "__right",
          evidenceNames,
          components,
        )}`,
      }];
    }
    return [{
      name: "hash",
      rendered: `__value => ${this.#derivedHash(subject, "__value", evidenceNames, components)}`,
    }];
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

  /** One component of a derived or structural `hash`; see `#componentCompare`. */
  #componentHash(
    type: Typed.Type,
    value: string,
    evidenceNames: EvidenceNames,
    evidence: Core.Evidence | undefined,
  ): string {
    if (componentDispatch(evidence)) {
      const dictionary = this.#emitEvidence(evidence, "Hash", this.#module.span, evidenceNames);
      return `${dictionary}.hash(${value})`;
    }
    const components = evidence?.kind === "Structural"
      ? componentEvidence(evidence.components)
      : undefined;
    return this.#derivedHash(type, value, evidenceNames, components);
  }

  /**
   * Builds law-preserving hashes from the same components as derived `Eq` —
   * from the *instances* the checker selected for them, not from a walk into
   * their representations (#278, #609).
   *
   * `components` carries that selection, under the keys the checker records:
   * tuple positions by index, a `Vector`'s `element`, a record's field names, a
   * union's `Constructor.field`, and `element`/`key`/`value` at the collections.
   * The two laws this keeps are the same one read twice — equal values hash
   * equally — because the component's `hash` and the component's `equals` are
   * now the same instance's two members rather than two walks that agree only
   * where this module can see far enough to make them.
   */
  #derivedHash(
    type: Typed.Type,
    value: string,
    evidenceNames: EvidenceNames,
    components: ComponentEvidence = undefined,
  ): string {
    const component = (
      key: string,
      componentType: Typed.Type,
      componentValue: string,
    ): string =>
      this.#componentHash(
        componentType,
        componentValue,
        evidenceNames,
        this.#componentEvidenceAt(components, key),
      );
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
        component(String(index), element, `${value}[${index}]`)
      ));
    }
    if (type.kind === "Vector") {
      // Fresh binders per level. `for (const x of x)` is a TDZ
      // `ReferenceError` — the head's own scope holds the binding while the
      // iterable expression is evaluated — so a fixed `__element` faults on
      // `hash` at `Vector(Vector(a))`, where the inner walk's source *is* the
      // outer walk's binder. Pre-dates the trie; the representation had nothing
      // to do with it.
      const element = this.#generatedNames.fresh("element");
      const accumulator = this.#generatedNames.fresh("hash");
      const elementHash = component("element", type.element, element);
      return `(() => { let ${accumulator} = 0; for (const ${element} of ${value}) ` +
        `${accumulator} = ${this.#useHelper("mixHash")}(${accumulator}, ${elementHash}); ` +
        `return ${accumulator}; })()`;
    }
    if (type.kind === "Set") {
      // Through `#subDictionary` at every element kind, a variable's included
      // (#278, #669): the checker records the `element` demand at a `Set`'s
      // `Hash`, and both the old shortcuts around it — an empty structural node,
      // and a reference rebuilt from `type.element.id` — threw that selection
      // away. `#subDictionary` keeps the shortcut where it belongs, blind.
      const dictionary = this.#subDictionary(
        components,
        "element",
        "Hash",
        type.element,
        evidenceNames,
      );
      return `${this.#useHelper("setHash")}(${dictionary}, ${value})`;
    }
    if (type.kind === "Map") {
      const key = this.#subDictionary(components, "key", "Hash", type.key, evidenceNames);
      const item = this.#subDictionary(components, "value", "Hash", type.value, evidenceNames);
      return `${this.#useHelper("mapHash")}(${key}, ${item}, ${value})`;
    }
    if (type.kind === "Record") {
      return combine([...type.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) =>
        component(field.name, field.type, `${value}.${field.name}`)
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
        component(
          field.name,
          substituteType(field.type, replacements),
          `${value}.${field.name}`,
        )
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
          ...constructor.slots.map((slot) => component(
            `${constructor.name}.${slot.field}`,
            substituteType(slot.type, replacements),
            `${value}.${slot.field}`,
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
   * derived; the container never re-derives it. `Dictionary` dispatches too
   * (#669): the reference the inline arm rebuilt from `type.id` is right only
   * where the binder demands this walk's constraint directly, and the recorded
   * node is right always. `Structural` recurses one level carrying its own
   * component selection. `Primitive` and `Error` keep the inline arms of
   * `#derivedCompare`: the licensed primitive shortcut, and the best-effort
   * fallback on a module the checker rejected.
   *
   * The primitive shortcut is licensed by the component's **type**, not by the
   * evidence's kind, and it is sound because the two always agree. Nothing in
   * the compiler manufactures a `Primitive`-evidence-over-`Variable`-type pair
   * any more: the specialization planner used to, rewriting an edition's
   * evidence and leaving its walked types generic, and the inline arm taken
   * there was not the shortcut but the walk's dictionary rebuild — #675's ICE.
   * `specializeItem` now carries the assignment into both, so an edition's
   * component seat presents a ground type beside its ground evidence and the
   * shortcut fires exactly where a hand-written program at that type fires it.
   * `Primitive` therefore stays out of `componentDispatch`: admitting it would
   * reopen #344's exemption and buy nothing.
   *
   * *(#344.)* An instance **honored at a primitive** keeps the inline arm too,
   * which is `componentDispatch`'s whole job: a migrated companion's evidence
   * is an ordinary `Instance` now, but Constraints §6.1's last sentence licenses
   * the monomorphic tables as *inlining of the door-backed slots* wherever the
   * instance stands, and coherence says there is exactly one to render. Reading
   * `kind === "Instance"` alone would have made a `{x: Int}` record's derived
   * `equals` a call into `Int.js` where it had always been `===`.
   */
  #componentCompare(
    type: Typed.Type,
    left: string,
    right: string,
    evidenceNames: EvidenceNames,
    evidence: Core.Evidence | undefined,
  ): string {
    if (componentDispatch(evidence)) {
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
      // §8's lexicographic order, zipped through the representation contract
      // for `#derivedEquals`' reason. Running out of right-hand elements first
      // decides `Greater` on the spot; running out of left-hand ones falls to
      // the tail check, where a proper prefix is `Less`. No length is measured:
      // exhaustion is the comparison.
      // Fresh binders per level, for `#derivedEquals`' reason: a nested vector
      // order runs this walk inside itself, and shared names are a TDZ fault.
      const leftElement = this.#generatedNames.fresh("leftElement");
      const rightElement = this.#generatedNames.fresh("rightElement");
      const iterator = this.#generatedNames.fresh("rightStep");
      const step = this.#generatedNames.fresh("step");
      const order = this.#generatedNames.fresh("order");
      const elementOrder = component("element", type.element, leftElement, rightElement);
      // #680, the same elision as `#derivedEquals`': an element order that
      // ignores its right-hand operand — `Unit`'s inlines to `"Equal"` — leaves
      // this read discarded. Only the binding goes. The loop itself is
      // load-bearing whatever the element says, because exhaustion is what
      // decides a vector order: `.next()` still has to run, `done` still decides
      // `Greater`, and the tail check still separates `Equal` from `Less`.
      // Collapsing an all-`"Equal"` walk to a length comparison would be a
      // different emission rather than a deletion, so it is not taken here.
      const readsRight = elementOrder.includes(rightElement);
      const rightBinding = readsRight ? `const ${rightElement} = ${step}.value; ` : "";
      return "(() => { " +
        `const ${iterator} = ${right}[${this.#spell("Symbol")}.iterator](); ` +
        `for (const ${leftElement} of ${left}) { ` +
        `const ${step} = ${iterator}.next(); ` +
        `if (${step}.done) return "Greater"; ` +
        `${rightBinding}` +
        `const ${order} = ${elementOrder}; ` +
        `if (${order} !== "Equal") return ${order}; } ` +
        `return ${iterator}.next().done ? "Equal" : "Less"; })()`;
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
      return `(() => { const __tagOrder = ${fromSign(`(${tag(`${left}.tag`)}) - (${tag(`${right}.tag`)})`)}; if (__tagOrder !== "Equal") return __tagOrder; switch (${left}.tag) { ${cases} default: return "Equal"; } })()`;
    }
    return '"Equal"';
  }

  /**
   * A whole dictionary for one component, for the `Set`/`Map` derived-instance
   * helpers, which take a dictionary rather than an inline expression: each
   * probes the *other* collection at a key the walk produces, so the comparison
   * has to travel as a value rather than be spliced in around two names.
   *
   * The checker's selection when there is one (#278), so a `Map`'s values are
   * compared by their own `Eq` instance; otherwise the structural dictionary
   * this used to build unconditionally.
   *
   * A type-variable component reads the selection too (#669). The recorded
   * `Dictionary` node carries the *entailment path* by which this binder's
   * constraint reaches the demanded one — `__Wide_a.hash` under
   * `constraint Wide<a: Hash>` — and rebuilding the reference from `type.id`
   * spelled a dictionary named nowhere in scope. `#emitEvidence` renders that
   * node as the same direct reference the shortcut used to write, path
   * included, so nothing eta-wraps. The shortcut survives only components-blind,
   * where there is no selection to read.
   *
   * The condition is **whether a node was recorded**, never which kind it is, so
   * a variable component renders `Primitive` and `Instance` nodes here as well.
   * That is deliberate — the recording is the answer wherever it exists — and it
   * is why this one seat was already right for a specialization-planner edition
   * back when the edition's evidence was `Primitive` over a still-`Variable`
   * type and every sibling seat reported #675's ICE. Editions now substitute
   * their types too, so the shape that made the point no longer arises, and the
   * reading rule is unchanged.
   *
   * The seat is pinned by the `Map` programs in `derived-walk-evidence.test.ts`
   * and `planner-edition-walks.test.ts` — a per-call counter measures 16 reaches
   * from each — and by that first file's `Set` rows, which traverse it too: 1
   * reach from the `Set(a)` equals walk, 4 from `Set(Set(a))`'s hash walk, 2
   * from the `Map(a, Int)` key walk. Its `describe` says as much; the seat
   * belongs to `Set` and `Map` alike.
   *
   * What measures **zero** is every tuple, `Vector` and record program in
   * `planner-edition-walks.test.ts`, that file's `Set((a, Int))` under a `Hash`
   * binder included — so the walks reached by an *edition* are, `Map` aside,
   * blind to a change here.
   */
  #subDictionary(
    components: ComponentEvidence,
    key: string,
    constraint: Typed.ConstraintName,
    type: Typed.Type,
    evidenceNames: EvidenceNames,
  ): string {
    const evidence = this.#componentEvidenceAt(components, key);
    if (evidence !== undefined) {
      return this.#emitEvidence(evidence, constraint, this.#module.span, evidenceNames);
    }
    // Reached components-blind, and — because `#componentEvidenceAt` reports a
    // map that exists but lacks the key — on the defect path it names. Both want
    // the same answer: a variable's dictionary is the parameter itself, never a
    // literal wrapping its slots, and only a structural type has slots to build.
    // `Eq` goes through the name-probe, the one thing blind mode has instead of
    // a recorded path.
    if (type.kind === "Variable") {
      return constraint === "Eq"
        ? this.#equalityDictionary(type.id, evidenceNames)
        : this.#dictionary(type.id, constraint, this.#module.span, evidenceNames);
    }
    return this.#emitEvidence(
      { kind: "Structural", type, components: [] },
      constraint,
      this.#module.span,
      evidenceNames,
    );
  }

  /**
   * One component of a derived or structural `equals`; see `#componentCompare`.
   *
   * `hashBacked` changes which dictionary the component is asked for, never
   * whether it is asked (#609). The components of a `Hash` node were raised as
   * `Hash` requirements, so its evidence is keyed under `Hash` and the equality
   * comes out of that dictionary's `eq` — asking for the same evidence under
   * `Eq` would name a dictionary the checker never selected.
   */
  #componentEquals(
    type: Typed.Type,
    left: string,
    right: string,
    evidenceNames: EvidenceNames,
    hashBacked: boolean,
    evidence: Core.Evidence | undefined,
  ): string {
    if (componentDispatch(evidence)) {
      const dictionary = hashBacked
        ? `${this.#emitEvidence(evidence, "Hash", this.#module.span, evidenceNames)}.eq`
        : this.#emitEvidence(evidence, "Eq", this.#module.span, evidenceNames);
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
    // Carried in both modes (#609). When `hashBacked` this renders the `eq` slot
    // of a *structural `Hash`* dictionary, whose components the checker raised
    // as `Hash` rather than `Eq` — a difference in which dictionary each
    // component is named under, which `#componentEquals` reads, and not a reason
    // to drop the selection: dropping it fell back to a representation walk that
    // decides a reached tagged union by JavaScript `===`.
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
        this.#componentEvidenceAt(components, key),
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
      // §8: size check, then elementwise, left to right. The walk is a zip of
      // the two iterators rather than an index walk — a trie read is
      // O(log32 n), so indexing would make an equality O(n log32 n) that the
      // representation contract already offers in O(n). The size check stays,
      // and stays first: it is what §8 says, and a mismatched pair must not
      // reach a user `equals` at all.
      // Fresh binders per level, not fixed ones: `Vector(Vector(a))` nests this
      // walk inside itself (Constraints §4.3's parameterized instance, resolved
      // twice), and reused names put the inner `const` in the outer's scope —
      // where the outer's own initializer already read it. That is a TDZ
      // `ReferenceError` at run time on a program that compiled clean.
      const leftElement = this.#generatedNames.fresh("leftElement");
      const rightElement = this.#generatedNames.fresh("rightElement");
      const step = this.#generatedNames.fresh("rightStep");
      const elementEquals = component("element", type.element, leftElement, rightElement);
      const size = `${this.#useVectorRuntime("size")}(${left}) === ` +
        `${this.#useVectorRuntime("size")}(${right})`;
      // #680. An element equality that ignores its operands makes the machinery
      // around it dead, and `Unit`'s does: it inlines to `true`, so base emitted
      // a discarded `.next()` read and a guard testing a literal, once per
      // element, forever false. The three names above are still *claimed* even
      // where nothing is emitted — `#claim` is what decides the `_1` suffixes,
      // so releasing them here would renumber the binders of every other
      // dictionary in the module, which is a change to emission that is not
      // dead.
      //
      // `true` is the identity of the fold, so the loop cannot do anything: the
      // equality is its size check and nothing more. Any other operand-free
      // element expression keeps its loop — it may still decide the answer —
      // and only sheds the right-hand binding it does not read.
      if (elementEquals === "true") return size;
      // Conservative by construction: a name that merely *contains* this
      // binder — a nested walk's `__rightElement_1` — counts as a mention, so
      // the walk keeps a binding it might not need rather than dropping one it
      // does.
      const readsRight = elementEquals.includes(rightElement);
      const iterator = readsRight
        ? `const ${step} = ${right}[${this.#spell("Symbol")}.iterator](); `
        : "";
      const advance = readsRight ? `const ${rightElement} = ${step}.next().value; ` : "";
      return `${size} && ` +
        `(() => { ${iterator}` +
        `for (const ${leftElement} of ${left}) { ` +
        `${advance}` +
        `if (!(${elementEquals})) return false; } return true; })()`;
    }
    if (type.kind === "Set") {
      // `Hash` at both the `Eq` and the `Hash` node: a set's equality is its
      // elements' hashing, so the one key answers for both modes. Through
      // `#subDictionary` at every element kind, for `#derivedHash`' reason.
      const hash = this.#subDictionary(components, "element", "Hash", type.element, evidenceNames);
      return `${this.#useHelper("setEquals")}(${hash}, ${left}, ${right})`;
    }
    if (type.kind === "Map") {
      const hash = this.#subDictionary(components, "key", "Hash", type.key, evidenceNames);
      // The `value` key again, under the constraint the enclosing node raised
      // it as: `Hash` beneath a `Hash` node, where the equality is the
      // dictionary's `eq`, and `Eq` beneath an `Eq` one. The suffix is written
      // here rather than asked of the selection, because it names a slot of
      // whatever dictionary the selection resolved to.
      const equals = hashBacked
        ? `${this.#subDictionary(components, "value", "Hash", type.value, evidenceNames)}.eq`
        : this.#subDictionary(components, "value", "Eq", type.value, evidenceNames);
      return `${this.#useHelper("mapEquals")}(${hash}, ${equals}, ${left}, ${right})`;
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
    if (componentDispatch(evidence)) {
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
      return `${this.#spell("String")}(${value})`;
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
      // §8: rendered as the literal, `[]` for empty — which `join` gives for
      // free. Spread rather than `map`, because a trie is not an array; the
      // spread is the representation contract, the same one `Set` and `Map`
      // below already read through.
      const shown = component("element", type.element, "__element");
      return `"[" + [...${value}].map(__element => ${shown}).join(", ") + "]"`;
    }
    if (type.kind === "Set") {
      // §8: the constructor-shaped rendering, over the wrapper (#373). The
      // emptiness test is `memberCount` rather than `Map`'s `.size` field read
      // just below: a `HashSet` holds one field, `trie`, and the maintained
      // count lives inside it. The spread is the representation contract, the
      // same one `Vector` and `Map` read through.
      const shown = component("element", type.element, "__element");
      return `${this.#useHashTrieRuntime("memberCount")}(${value}) === 0 ? "Set.empty" : ` +
        `"Set.fromVector([" + [...${value}].map(__element => ${shown}).join(", ") + "])"`;
    }
    if (type.kind === "Map") {
      const key = component("key", type.key, "__entry[0]");
      const item = component("value", type.value, "__entry[1]");
      return `${value}.size === 0 ? "Map.empty" : "Map.fromVector([" + [...${value}].map(__entry => "(" + ${key} + ", " + ${item} + ")").join(", ") + "])"`;
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

  /**
   * The dictionary a **source** instance at this primitive exports, if one
   * exists (#344).
   *
   * The lookup itself is `sourceInstanceDictionary`, which walks the three
   * channels an instance reaches a module by and keys on the constraint's
   * declaration identity (§5.1.1). The one thing this seat has to supply is that
   * identity, and a use site carries only a name — so the `hex:` space is named
   * outright, which is exactly right for the evidence that arrives here.
   * `Primitive` evidence has two producers and both are pre-registered: the
   * specialization planner mints it for a pre-registered constraint alone
   * (`editionEvidence`), and elaboration mints it for a requirement at a
   * primitive that selected no instance, which since #344 is the wired row the
   * ruling retired. A declared constraint reaching here answers nothing, and the
   * defect below is what says so — the same outcome the name-keyed lookup gave,
   * for a better-stated reason.
   */
  #sourceInstanceDictionary(
    constraint: Typed.ConstraintName,
    instance: Typed.PrimitiveName,
  ): string | undefined {
    return sourceInstanceDictionary(
      this.#module,
      preRegisteredConstraintIdentity(constraint),
      instance,
      this.#prelude.bool,
    );
  }

  /**
   * The instance an edition's substituted dictionary parameter resolves to, or
   * a reported compiler defect (#679).
   *
   * The planner asks this for every constraint a module *declared* — a
   * pre-registered one is answered by the two compiler-derived arms without
   * leaving `editionEvidence` — and the answer is the ordinary instance row a
   * ground program at the same type would select. Nothing is added to
   * `#referencedDictionaries` here: the evidence carries the name, and it is
   * rendering the evidence that decides whether the module reaches it.
   *
   * `undefined` is unreachable on a well-formed program, and since #679's leg 2
   * it is unreachable *by construction*: for a declared constraint the plan's
   * candidates and this lookup read the same three instance channels
   * (`fundamentalInstancesOf` and `sourceInstanceDictionary`), so a candidate
   * the judgment admits is an instance this finds. The report is what keeps
   * that pairing honest rather than assumed — the two were separate answers
   * once, and while the hand table stood they disagreed about every declared
   * constraint. An edition with no dictionary at all reads a slot off nothing at
   * run time, a long way from the cause. Reported once per triple, not once per
   * asking — see `#reportedEditionInstances`.
   */
  #editionInstanceDictionary(
    constraintIdentity: string,
    type: FundamentalType,
    specialization: FundamentalSpecialization,
    span: Source.Span,
  ): string | undefined {
    const dictionary = sourceInstanceDictionary(
      this.#module,
      constraintIdentity,
      type,
      this.#prelude.bool,
    );
    if (dictionary !== undefined) return dictionary;
    const triple = `${specialization.name}|${constraintIdentity}|${type}`;
    if (this.#reportedEditionInstances.has(triple)) return undefined;
    this.#reportedEditionInstances.add(triple);
    // The constraint is named the way the sibling report at `#emitEvidence`
    // names one — `Describe<Int>` — wherever a declaration is in view to read
    // the name off. Where none is (an imported constraint's base, reached
    // through no declaration this module binds), the identity stands as the
    // internal handle it is, and is labelled one rather than passed off as a
    // spelling: its `<fileId>:` half means nothing to a reader and moves with
    // the project's source order.
    const name = this.#declaredConstraintName(constraintIdentity);
    const missing = name === undefined
      ? `constraint declaration \`${constraintIdentity}\` at \`${type}\``
      : `\`${name}<${type}>\``;
    this.#diagnostics.add({
      severity: "error",
      message: `compiler defect: \`${specialization.name}\` is an edition at ` +
        `\`${type}\`, and no instance of ${missing} reached this module`,
      primary: span,
    });
    return undefined;
  }

  /**
   * The name a constraint's own **declaration** gives it, found by identity.
   *
   * Two seats hold a declaration: this module's own items, and the constraints
   * an import binds — which carry the *home* module's declaration, so the name
   * read here is the one every module agrees on rather than this module's
   * spelling for it, which an `as` alias may have moved. The checker's
   * `#canonicalConstraintName` answers the same question from the other side of
   * the Typed boundary.
   *
   * `undefined` where neither seat holds one, which the caller is written for.
   */
  #declaredConstraintName(constraintIdentity: string): string | undefined {
    for (const item of this.#module.items) {
      if (item.kind === "ConstraintDeclaration") {
        if (item.identity === constraintIdentity) return item.name;
        continue;
      }
      if (item.kind !== "Import") continue;
      for (const { declaration } of item.constraints) {
        if (declaration.identity === constraintIdentity) return declaration.name;
      }
    }
    return undefined;
  }

  /**
   * A dictionary whose slots are the derived walks over a type, rather than a
   * definition read from a module.
   *
   * One renderer for the two callers that need it: structural evidence at a
   * tuple, record, or `Vector`, and the `Bool` editions the specialization
   * planner asks for. Constraints §6.1's licence is what makes this a
   * *rendering* rather than a second instance — the same licence the operator
   * fast paths take.
   */
  #derivedDictionary(
    constraint: Typed.ConstraintName,
    type: Typed.Type,
    components: ComponentEvidence,
    evidenceNames: EvidenceNames,
  ): string {
    return dictionaryLiteral(
      this.#derivedSlots(constraint, type, components, evidenceNames),
    );
  }

  /**
   * The same dictionary, slot by slot (#425).
   *
   * The literal above is built from this and from nothing else, so a use site
   * that immediately selects and applies one member — §9.1's peephole, which
   * reads the slot's arrow and reduces it — and a use site that needs the whole
   * record cannot disagree about what the dictionary contains. Every derived
   * body is rendered here exactly once whichever face the caller takes: the
   * walks mint fresh binder names as they go, so a second rendering would move
   * every later name in the module.
   */
  #derivedSlots(
    constraint: Typed.ConstraintName,
    type: Typed.Type,
    components: ComponentEvidence,
    evidenceNames: EvidenceNames,
  ): readonly DerivedSlot[] {
    if (constraint === "Hash") {
      const equals = this.#derivedEquals(type, "__left", "__right", evidenceNames, true, components);
      return [
        {
          name: "eq",
          rendered: `{ equals: (__left, __right) => ${equals}, notEquals: (__left, __right) => !(${equals}) }`,
        },
        derivedArrow(
          "hash",
          ["__value"],
          this.#derivedHash(type, "__value", evidenceNames, components),
        ),
      ];
    }
    if (constraint === "Eq") {
      const equals = this.#derivedEquals(type, "__left", "__right", evidenceNames, false, components);
      return [
        derivedArrow("equals", ["__left", "__right"], equals),
        derivedArrow("notEquals", ["__left", "__right"], `!(${equals})`),
      ];
    }
    if (constraint === "Ord") {
      return [derivedArrow(
        "compare",
        ["__left", "__right"],
        this.#derivedCompare(type, "__left", "__right", evidenceNames, components),
      )];
    }
    if (constraint === "Show") {
      return [derivedArrow(
        "show",
        ["__value"],
        this.#derivedShow(type, "__value", evidenceNames, components),
      )];
    }
    if (constraint === "Iterable") {
      // Collections Part 5 §4's provided rows, rendered rather than imported
      // (#353). Every one of them is one slot, and every slot but `Seq`'s is
      // the same expression: an emitted `Vector`, `Map`, `Set`, `Range`,
      // `Array`, `JsMap`, `JsSet` and JavaScript `String` are all iterable
      // values, and `seqFromIterable` is the compiler's one constructor of a
      // `Seq` over one. The per-type meanings §4's table names are already
      // carried by the emitted iterators — a map's yields its entries, a set's
      // its elements (not the `Unit`s beneath them), a string's its codepoints,
      // which is §5.1's semantics exactly. The two borrowed views need no arm of
      // their own for the same reason they need no adaptation: a native `Map`'s
      // entries are two-element arrays, which *is* the tuple representation, and
      // a native `Set` yields its elements (FFI Part 10 §6.3), in the insertion
      // order the foreign object itself contracts for (§6.2). So `String.toSeq`
      // is lazy, O(1) to create and O(n) to exhaust (§5.2) for the same reason
      // `Vector.toSeq` is: the adapter acquires the iterator at the first pull,
      // never at construction.
      //
      // `Seq`'s row is the **identity**, not the adapter: rebuilding a spine
      // over a sequence that already has one would be a second memo for values
      // it already memoizes, and the row exists precisely so that normalizing a
      // `Seq` with `toSeq` costs nothing (§4's purity note).
      return this.#isSequence(type)
        ? [derivedArrow("toSeq", ["__source"], "__source")]
        : [{ name: "toSeq", rendered: this.#useHelper("seqFromIterable") }];
    }
    if (constraint === "Concat" && type.kind === "Vector") {
      // The Operators §7 instance, and the whole of it: `concat` is the trie
      // operation itself, so `++` at `Vector(a)` is documented-linear (Part 1
      // §2.2) and the result grows out of the left operand's trie rather than
      // copying it.
      return [{ name: "concat", rendered: this.#useVectorRuntime("concat") }];
    }
    return [];
  }

  /**
   * The subject a compiler-built dictionary literal would be derived over, or
   * `undefined` when this evidence is not one of those (#425).
   *
   * The one kind `#emitEvidence` renders as a literal: structural evidence,
   * whichever seat it came from — a ground use site, or a `Bool`/`Unit` edition,
   * whose dictionary parameters the planner rewrites to the very evidence a
   * ground site at the same type carries.
   */
  #derivedSubject(
    evidence: Core.Evidence,
  ): { readonly type: Typed.Type; readonly components: ComponentEvidence } | undefined {
    if (evidence.kind === "Structural") {
      return {
        type: evidence.type,
        components: componentEvidence(evidence.components),
      };
    }
    return undefined;
  }

  /**
   * One constraint member, selected out of this evidence and applied.
   *
   * The seat of Dictionary Sharing §9.1's literal-member rule (#425): where the
   * dictionary is a literal **this emitter builds**, the member is taken out of
   * it and its arrow beta-reduced, so `({ show: __value => (__value ? "True" :
   * "False") }).show(e)` emits as `(e ? "True" : "False")`. Every other
   * dictionary — a named instance, a factory application, an evidence parameter
   * — is already the reduced form and takes the ordinary slot call, and the
   * whole-record uses (trailing evidence, a helper's dictionary argument) never
   * come through here at all.
   *
   * The literal is built from the *same* slots the reduction reads, so the
   * refusal path emits exactly what this site emitted before the rule.
   */
  #emitMemberCall(
    evidence: Core.Evidence,
    constraint: Typed.ConstraintName,
    member: string,
    arguments_: readonly string[],
    span: Core.Expr["span"],
    evidenceNames: EvidenceNames,
  ): string {
    const applied = `${member}(${arguments_.join(", ")})`;
    const subject = this.#derivedSubject(evidence);
    if (subject === undefined) {
      const dictionary = this.#emitEvidence(evidence, constraint, span, evidenceNames);
      return `${dictionary}.${applied}`;
    }
    const slots = this.#derivedSlots(
      constraint,
      subject.type,
      subject.components,
      evidenceNames,
    );
    const slot = slots.find((candidate) => candidate.name === member);
    const reduced = slot === undefined
      ? undefined
      : reduceDerivedMember(slot, arguments_);
    // Reduction first, and nothing else changes that (§3.4's last paragraph,
    // §9.1): where it fires, no dictionary is materialized at all and there is
    // nothing to hoist. Where it declines at a ground shape — a member parameter
    // read twice or not at all, an occurrence under a deferred lambda — the
    // selection reads off the §3.4 binding rather than off a literal rebuilt
    // here: `({ show: __value => "()" }).show(value)` becomes
    // `__Show_Unit.show(value)`.
    if (reduced !== undefined) return reduced;
    // The slots are rendered above whichever face this site takes, because
    // whether the reduction fires is a question about the rendered arrow. Where
    // a binding already exists this rendering is discarded and the binding's own
    // initializer — the identical literal, interned at the first site — stands.
    const hoisted = evidence.kind === "Structural"
      ? this.#hoistStructuralEvidence(constraint, evidence, () => dictionaryLiteral(slots))
      : undefined;
    return `${hoisted ?? dictionaryLiteral(slots)}.${applied}`;
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
      // A companion's dictionary is its source instance's, never a literal
      // built here (#344). Primitive evidence still reaches this branch from
      // the specialization planner, which rewrites a monomorphic edition's
      // dictionary parameters by primitive name; for `BigInt` the answer is
      // `stdlib/BigInt.hex`'s exported dictionary, and materializing a second
      // one would be the wired row the ruling retired, rebuilt under another
      // name.
      const sourced = this.#sourceInstanceDictionary(constraint, evidence.instance);
      if (sourced !== undefined) {
        this.#referencedDictionaries.add(sourced);
        return sourced;
      }
      // The invariant, made checkable (#344), and with the last landing there
      // is nothing left for it to fall through *to*: every primitive that
      // honors anything is a source companion, so the wired table this branch
      // used to end in is gone. Reaching here is a plumbing failure, and it has
      // to be loud — a silent empty dictionary's first slot read is a
      // `TypeError` at run time, a long way from the cause.
      this.#diagnostics.add({
        severity: "error",
        message: MIGRATED_COMPANIONS.has(evidence.instance)
          ? `compiler defect: \`${constraint}<${evidence.instance}>\` is a source ` +
            "instance of a migrated primitive companion, but no dictionary for it " +
            "reached this module"
          : `compiler defect: no module supplies \`${constraint}<${evidence.instance}>\`, ` +
            "and no wired instance exists to stand in for one",
        primary: span,
      });
      return this.#unit;
    }
    if (evidence.kind === "Structural") {
      // The direct structural use site — `v1 == v2` at `Vector(Metre)`, a tuple
      // compared inline — runs the same walk a `derives` body does, so it takes
      // the same component selection (#278). Without it these bypassed a
      // hand-written component instance exactly as a container's did.
      const components = componentEvidence(evidence.components);
      const literal = () =>
        this.#derivedDictionary(constraint, evidence.type, components, evidenceNames);
      // Dictionary Sharing §3.4: at a ground shape the literal is the
      // *initializer* of one module-level binding, and this site is a reference
      // to it. Only a free component (§3.4's second paragraph) leaves the
      // literal standing where it is written. Exactly one of the two branches
      // renders it: the thunk runs only when a binding is being minted, and the
      // fallback only when no binding was.
      return this.#hoistStructuralEvidence(constraint, evidence, literal) ?? literal();
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
      if (arguments_.length === 0) return evidence.dictionary;
      const rendering = `${evidence.dictionary}(${arguments_.join(", ")})`;
      // §3.2, before §3.1 and before anything else: inside a parameterized
      // instance's factory body, this instance at the factory's own parameters
      // *is* the record under construction. Keyed on the rendering because the
      // arrangement is exactly what distinguishes the replacement from §3.3's
      // residue — `__Dsp_Swap(__Dsp_b, __Dsp_a)` is this factory permuted and
      // renders differently, so it misses and stays a call-time application.
      const self = evidenceNames.get(selfEvidenceKey(rendering));
      if (self !== undefined) return self;
      return this.#hoistGroundEvidence(evidence, rendering, arguments_);
    }
    return this.#unit;
  }

  /**
   * Dictionary Sharing §3.1: the name of the one module-level binding for this
   * ground application, minting it on first demand.
   *
   * Returns the application unchanged when it must not hoist — a free evidence
   * parameter anywhere in the tree (§3.3), evidence that failed to resolve (§4:
   * error evidence never hoists), or an eagerly-read position (`#eagerEvidenceDepth`).
   */
  #hoistGroundEvidence(
    evidence: Core.InstanceEvidence,
    rendering: string,
    argumentRenderings: readonly string[],
  ): string {
    if (this.#eagerEvidenceDepth > 0) return rendering;
    if (!isGroundEvidence(evidence)) return rendering;
    // The `Primitive` defect path returns this after reporting; a tree built
    // over it is error evidence in §4's sense however it was spelled.
    if (argumentRenderings.includes(this.#unit)) return rendering;
    const existing = this.#hoistedEvidence.get(rendering);
    if (existing !== undefined) return existing.name;
    // §5's spelling, through the same probe every other generated name takes:
    // the taken set is seeded with every declared, imported, and prelude
    // dictionary local, so a hoisted binding never lands on a seat the resolver
    // already assigned (`nameDictionaries`), and two hoisted bindings whose
    // flattened spellings coincide separate by suffix.
    const name = this.#generatedNames.fresh(
      [
        evidence.dictionary.startsWith("__")
          ? evidence.dictionary.slice(2)
          : evidence.dictionary,
        ...argumentRenderings.map(flattenDictionarySpelling),
      ].join("_"),
    );
    this.#hoistedEvidence.set(rendering, { name, initializer: rendering });
    return name;
  }

  /**
   * Dictionary Sharing §3.4: the name of the one module-level binding for this
   * ground structural dictionary, minting it on first demand — or `undefined`
   * when the dictionary must stay a literal at its site.
   *
   * Joins §3.1's channel rather than opening a second one: the same map, the
   * same flush, the same §5 name probe. The key is §4's, which is the one place
   * the two kinds differ — an application keys on its rendering, and a
   * structural node has no application to render, so it keys on the demanded
   * constraint plus its type and components (`structuralEvidenceKey`).
   *
   * `initializer` is a thunk and not a string because the literal must be
   * rendered **exactly** when it is interned. Rendering it unconditionally would
   * mint the walks' fresh binder names at every use site, moving every later
   * generated name in the module for a rendering that is then thrown away; and
   * rendering it *after* interning would put a component's own binding after the
   * binding that reads it, which is the one thing §5's insertion-order-is-
   * dependency-order argument needs to stay true.
   *
   * Refused in an eagerly-read position (`#eagerEvidenceDepth`) for the reason
   * that field records: §5 places the hoisted block after the instances, so a
   * binding an instance reads back as it initializes would be in its temporal
   * dead zone.
   */
  #hoistStructuralEvidence(
    constraint: Typed.ConstraintName,
    evidence: Core.StructuralEvidence,
    initializer: () => string,
  ): string | undefined {
    if (this.#eagerEvidenceDepth > 0) return undefined;
    if (!isGroundEvidence(evidence)) return undefined;
    const key = this.#structuralEvidenceKey(constraint, evidence);
    const existing = this.#hoistedEvidence.get(key);
    if (existing !== undefined) return existing.name;
    const rendered = initializer();
    const name = this.#generatedNames.fresh(
      [constraint, ...flattenTypeSpelling(evidence.type)].join("_"),
    );
    this.#hoistedEvidence.set(key, { name, initializer: rendered });
    return name;
  }

  /**
   * Dictionary Sharing §4's key for a **structural** node: the demanded
   * constraint, a canonical serialization of the ground type, and the
   * components' evidence trees in component order.
   *
   * The constraint is in the key and not decoration. A zero-component shape's
   * type alone cannot tell `Show<Unit>`'s dictionary from `Eq<Unit>`'s — both
   * are `Tuple []` — so keying on the type would share one binding between two
   * different records. The full application is the key; the bare type never is.
   *
   * The components ride along as §4 states, and they are what makes this a
   * method rather than a free function: their **leaves** must be normalized the
   * way `#hoistedEvidence`'s application keys are normalized by rendering. A
   * migrated companion's dictionary reaches one component as `Primitive`
   * evidence and another as `Instance` evidence for the same source instance —
   * measured, not supposed: `Set.add(Set.add(Set.empty, p), p)` and
   * `Map.set(Map.empty, p, v)` at `p: (Int, Int)` hand this the same
   * `Hash<(Int, Int)>` with `Hash<Int>` spelled both ways, and keying on the raw
   * kinds split one dictionary into `__Hash_Int_Int` and `__Hash_Int_Int_1`.
   * Resolving a `Primitive` leaf to the source instance it renders as collapses
   * the pair, exactly as §4 intends ("selection already happened").
   *
   * Any deterministic spelling serves (§4) — this one is internal, and §5's name
   * is the only visible face.
   */
  #structuralEvidenceKey(
    constraint: Typed.ConstraintName,
    evidence: Core.StructuralEvidence,
  ): string {
    return `structural:${this.#serializeEvidence(evidence, constraint)}`;
  }

  /** One evidence tree, serialized for `#structuralEvidenceKey`. */
  #serializeEvidence(evidence: Core.Evidence, constraint: Typed.ConstraintName): string {
    switch (evidence.kind) {
      case "Primitive": {
        const sourced = this.#sourceInstanceDictionary(constraint, evidence.instance);
        return sourced === undefined
          ? `P|${constraint}|${evidence.instance}`
          : `I|${sourced}()`;
      }
      case "Instance":
        return `I|${evidence.dictionary}(${
          evidence.arguments
            .map(({ constraint: argument, evidence: tree }) =>
              this.#serializeEvidence(tree, argument)
            )
            .join(",")
        })`;
      case "Structural":
        return `S|${constraint}|${serializeType(evidence.type)}|${
          evidence.components
            .map(({ key, evidence: tree }) => `${key}=${this.#serializeEvidence(tree, constraint)}`)
            .join(",")
        }`;
      case "Dictionary":
        return `D|${evidence.constraint ?? constraint}|${Number(evidence.variable)}|${
          (evidence.path ?? []).join(".")
        }`;
      case "Error":
        return "E";
    }
  }

  #identifier(symbol: Resolved.SymbolId, sourceName: string): string {
    return isSafeIdentifier(sourceName) ? sourceName : `__binding${Number(symbol)}`;
  }

  /**
   * How this module writes one global (FFI Part 7 §1.2): the bare spelling, or
   * the reserved capture imported from the runtime module where the module's own
   * bindings contest it.
   *
   * Every inline seat that names a global goes through here, and every helper
   * body through the callback `renderHelper` takes. A seat that spells one bare
   * is the defect itself, so the tripwire in
   * `conformance/runtime-vocabulary.test.ts` scans for exactly that.
   */
  #spell(name: RuntimeSpelling): string {
    return this.#runtimeVocabulary.spell(name);
  }

  /**
   * The local one imported name binds under (FFI Part 7 §1.2 rules 1 and 4).
   *
   * The authorship split is the whole content of `minted`. A **source-written**
   * import local moves only where JavaScript refuses the spelling outright
   * (rule 4) — where it takes a vocabulary spelling the binding is the user's,
   * and the module qualifies around it instead (rule 2). A **minted** one — the
   * named imports emission itself decides, whose local mirrors the imported
   * export's spelling: a constraint member Modules §3.1 put in scope, a
   * synthesized prelude import's term — moves for either class, because nothing
   * user-written is at stake.
   *
   * Without the second half, a constraint whose member is named `undefined`
   * emits `import { __undefined as undefined }` into every module that calls it
   * polymorphically, and every Unit in that module reads the forwarder; with
   * `eval` the module does not parse at all. Both measured.
   */
  #importedLocal(symbol: Resolved.SymbolId, local: string, minted: boolean): string {
    if (minted && MINTED_LOCAL_HAZARDS.has(local)) return `__binding${Number(symbol)}`;
    return this.#identifier(symbol, local);
  }

  /** The local a namespace alias is bound under here; see `namespaceAliasPlan`. */
  #namespaceLocal(alias: string): string {
    return this.#namespaceAliases.get(alias) ?? alias;
  }

  /**
   * A qualified spelling as the emitted file reads it (#569): `Alias.member`
   * under whatever local the alias's `import * as` line actually bound.
   *
   * The head is a module alias or a fixed prelude companion's name (§5.3), and
   * only the former can have moved — a companion is seeded rather than
   * imported, so it binds no local of this module's to contest.
   */
  #qualifiedSpelling(text: string): string {
    const head = text.slice(0, text.indexOf("."));
    const local = this.#namespaceAliases.get(head);
    return local === undefined ? text : `${local}${text.slice(head.length)}`;
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
   * constraint by two routes (a named import beside an `import module`), and two
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
          const local = this.#constrainedImports.get(symbol) ??
            this.#importedLocal(symbol, imported, true);
          const source = this.#importedInternalName(imported, item);
          names.add(source === local ? source : `${source} as ${local}`);
        }
      }
      for (const { declaration } of item.constraints) {
        for (const member of declaration.members) {
          if (!this.#usedDefaultHelpers.has(member.binding.symbol)) continue;
          const source = defaultHelperName(member.binding.name);
          const local = this.#defaultHelperLocal(member.binding.symbol, member.binding.name);
          names.add(source === local ? source : `${source} as ${local}`);
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
          ? this.#importedInternalName(imported, item)
          : imported;
        // The line the emitter decided, so its local takes rule 1's probe: a
        // prelude term is minted by construction, whatever the resolver named
        // it (`#importLocals` was seated the same way).
        const bound = this.#importedLocal(symbol, local, true);
        return [source === bound ? source : `${source} as ${bound}`];
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

  /**
   * The `import` bindings for the fundamental editions this module *calls* in
   * the module `item` names (#440), in edition-name order so the emitted text
   * is a function of what the module calls rather than of where it calls it.
   *
   * Read by the two places an edition can be bound, and by both only after
   * every body has been rendered: a source-written import's own line, which is
   * why `Import` items render last, and the channel below for the synthesized
   * prelude imports, which have no line of their own to join.
   */
  #specializationBindings(item: Core.ImportItem): readonly string[] {
    const names = this.#usedSpecializations.get(item);
    if (names === undefined) return [];
    return [...names]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([source, local]) => source === local ? source : `${source} as ${local}`);
  }

  /**
   * The edition imports that need a line of their own, and the module edges
   * every edition import creates (#440).
   *
   * Only a **synthesized** prelude import needs the line. A source-written one
   * has a line at its own seat in the source order and takes its editions
   * there, so emitting them here as well would bind each identifier twice —
   * `SyntaxError: Identifier has already been declared` at load, after a clean
   * compile.
   *
   * The `specifier` is reported for **both**, which is the half that is not
   * cosmetic. A synthesized import whose every name went to an edition emits no
   * term line at all, so this is the only record that `Debug.js` has to be
   * written beside an emitted `import { logString } from "./Debug.js"` — defect
   * 8's shape. A source-written import's edge is already readable from the tree;
   * reporting it too costs a duplicate in a set and keeps the channel's meaning
   * "what this file imports editions from" rather than "what the other rule
   * missed".
   */
  #specializationImports(): readonly {
    readonly line: string | undefined;
    readonly specifier: string;
  }[] {
    return this.#module.items.flatMap((item) => {
      if (item.kind !== "Import") return [];
      const bindings = this.#specializationBindings(item);
      if (bindings.length === 0) return [];
      return [{
        line: item.synthesized
          ? `import { ${bindings.join(", ")} } from ${
            JSON.stringify(emittedModuleSpecifier(item.specifier))
          };`
          : undefined,
        specifier: item.specifier,
      }];
    });
  }

  /**
   * The internal export name **this** module publishes for one of its own
   * exports, by the name its interface carries. The fallback is unreachable —
   * every caller is on an export path, and `ownInternalNameInputs` walks the
   * same items those paths do — and is the preferred spelling, so a name that
   * somehow escaped the plan is still the name the pre-#430 rule would give.
   */
  #ownInternalName(name: string): string {
    return this.#internalNames.get(name) ?? `__${name}`;
  }

  /**
   * The internal export name the module behind `item` published for `imported`,
   * from *that* module's inputs rather than this one's.
   */
  #importedInternalName(imported: string, item: Core.ImportItem): string {
    let plan = this.#importedInternalNames.get(item);
    if (plan === undefined) {
      plan = internalNamePlan(item.internalNames);
      this.#importedInternalNames.set(item, plan);
    }
    return plan.get(imported) ?? `__${imported}`;
  }

  /**
   * The local a namespace import binds one internal constrained export under.
   *
   * Minted rather than taken from the exporter, because the exported spelling is
   * a function of the member's *name*: `import module Loud` and `import module Soft`
   * over two modules that each declare `volume` both bring `__volume` home, and
   * binding both is `SyntaxError: Identifier has already been declared` at load,
   * after a clean compile. The exported names stay as they are — moving one to
   * suit a consumer would cost every other consumer its prediction — so the
   * importer aliases, as it does for a contested dictionary (Dictionary Sharing
   * §5). Claimed in construction order, because a reference is rendered before
   * the import line that binds it as often as after.
   */
  #namespaceConstrainedLocal(symbol: Resolved.SymbolId, imported: string): string {
    const existing = this.#namespaceConstrainedLocals.get(symbol);
    if (existing !== undefined) return existing;
    const local = this.#generatedNames.fresh(imported);
    this.#namespaceConstrainedLocals.set(symbol, local);
    return local;
  }

  /**
   * The local an inherited default helper is reached by, aliased for the reason
   * above and minted on first use, so a default this module never inherits
   * claims no name. This module's own helpers are seated in construction and
   * never reach the mint.
   */
  #defaultHelperLocal(symbol: Resolved.SymbolId, member: string): string {
    const existing = this.#defaultHelperLocals.get(symbol);
    if (existing !== undefined) return existing;
    const local = this.#generatedNames.fresh(`default_${member}`);
    this.#defaultHelperLocals.set(symbol, local);
    return local;
  }

  /**
   * Publishes one dictionary as this module's cross-module evidence plumbing.
   *
   * `exported` is the spelling the *interface* carries, which is the bare
   * flattened name even where a local collision suffixed the `const` behind it
   * (Dictionary Sharing §8) — hence the aliasing form. Consumers read the
   * exported spelling from the resolved interface and never predict a local one.
   */
  #exportEvidence(dictionary: string, exported = dictionary): void {
    if (this.#exportedEvidence.has(dictionary)) return;
    this.#exportedEvidence.add(dictionary);
    this.#exports.push(
      dictionary === exported
        ? `export { ${dictionary} };`
        : `export { ${dictionary} as ${exported} };`,
    );
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
   * Whether this is the prelude `Stream` — `Seq`'s sibling at the boundary, and
   * bridged for the mirror-image reason (FFI Part 3 §14). Identity, never the
   * spelling, exactly as for `Seq`.
   */
  #isStream(type: Typed.Type): boolean {
    return this.#prelude.stream !== undefined &&
      type.kind === "NominalRecord" &&
      type.record === this.#prelude.stream;
  }

  /**
   * The boundary traversal method a construction of `type` carries, or nothing.
   *
   * A runtime module's representation record is recognized **by name inside
   * that module and nowhere else**, which is not the weak version of an
   * identity check but the exact one: `TrieVector`, `HashTrie` and `HashSet` are
   * private to their own modules — the checker refuses to export a binding
   * exposing any of them — so no other module can hold a value of one, name it,
   * or construct one. The `Bool`/`Seq` pins need a prelude lookup because those
   * types *do* cross boundaries and a user declaration can occlude the name;
   * these cannot.
   *
   * One module may offer several (#373): `runtime/HashTrie.hex` backs both
   * public faces, and the record's own name is what picks the helper.
   */
  #runtimeIterateHelper(type: Typed.Type): Helper | undefined {
    if (type.kind !== "NominalRecord") return undefined;
    for (const wiring of RUNTIME_WIRINGS) {
      if (this.#locationOf(wiring) !== "self") continue;
      for (const iterable of wiring.iterables ?? []) {
        const named = this.#module.records.some(
          ({ id, name }) => id === type.record && name === iterable.record,
        );
        if (named) return iterable.helper;
      }
    }
    return undefined;
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
    const { names: residualParameters, localEvidence } = this.#evidenceParameters(
      residual,
      evidenceNames,
    );
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
      case "streamFromSeq":
        return this.#useHelper("streamFromSeq");
      // Collections Part 3 §7's boundary. Four of the seven *are* a trie
      // operation and lower to the imported name itself; `at` and `set` reach
      // for helpers because a bounds check followed by a return is statements,
      // which the arrow expression a door binding is initialized with cannot
      // hold, and `vectorAt` is also where §5.5's `IndexError` payload is
      // built, so sharing it keeps one shape.
      //
      // `length` is the row §7 pins at O(1), and it stays there: `size` is
      // `capacity - origin`, two field reads, with nothing traversed.
      case "vectorLength":
        return this.#useVectorRuntime("size");
      case "vectorAppend":
        return this.#useVectorRuntime("append");
      case "vectorPrepend":
        return this.#useVectorRuntime("prepend");
      case "vectorAt":
        return this.#useHelper("vectorAt");
      case "vectorSet":
        return this.#useHelper("vectorSet");
      // Both bridges go through the representation contract rather than through
      // the trie: a vector is iterable, so the inbound adapter takes one whole,
      // and `fromSeq` is the literal builder over a different source (§7.2).
      case "vectorToSeq":
        return this.#useHelper("seqFromIterable");
      case "vectorFromSeq":
        return `__values => ${this.#useHelper("vectorOf")}(` +
          `${this.#useHelper("seqToIterable")}(__values))`;
      // `stdlib/BigInt.hex`'s natives (#344), in the primop shape: every one is
      // a JavaScript operator or one-call conversion, so each lowers to a bare
      // arrow with no helper behind it. Nothing here guards, converts a sign, or
      // branches on a range — those are Hexagon in the companion, which is the
      // point of the split (`spec/intrinsics.md` §3.2). Two rows are worth
      // spelling out: `bigIntCompare` answers with the Unions §6.2 name-strings
      // an `Ordering` *is* (#275), and `bigIntPow` is the **raw** `**`, because
      // the negative-exponent guard sits above it in source.
      case "bigIntAdd":
        return "(__a, __b) => __a + __b";
      case "bigIntMultiply":
        return "(__a, __b) => __a * __b";
      case "bigIntSubtract":
        return "(__a, __b) => __a - __b";
      case "bigIntNegate":
        return "__a => -__a";
      case "bigIntQuot":
        return "(__a, __b) => __a / __b";
      case "bigIntRem":
        return "(__a, __b) => __a % __b";
      case "bigIntPow":
        return "(__a, __b) => __a ** __b";
      case "bigIntEquals":
        return "(__a, __b) => __a === __b";
      case "bigIntCompare":
        return '(__a, __b) => __a < __b ? "Less" : __a > __b ? "Greater" : "Equal"';
      case "bigIntShow":
        return `__a => ${this.#spell("String")}(__a)`;
      case "bigIntHash":
        return `__a => ${this.#useHelper("stableHash")}(__a)`;
      // The conversions (Primitive Types §6). `fromNat`/`fromInt` are exact and
      // total; the other two are unchecked cores whose range logic sits above
      // them in source — `toInt`'s `Option` check, and `toFloat`'s overflow
      // guard. `Number(bigint)` is correctly rounded, ties to even, so the
      // rounding `toFloat` documents is the host's and needs nothing here.
      case "bigIntFromNat":
      case "bigIntFromInt":
        return `__a => ${this.#spell("BigInt")}(__a)`;
      case "bigIntToIntUnchecked":
      case "bigIntToFloatUnchecked":
        return `__a => ${this.#spell("Number")}(__a)`;
      // `stdlib/Int.hex`'s and `stdlib/Nat.hex`'s natives (#344, the second
      // landing), in the same primop shape: a JavaScript operator or a one-call
      // conversion apiece, each a bare arrow with no helper behind it. Nothing
      // here guards or branches on a range — the zero-divisor guards, the
      // Euclidean pair, `gcd`, `Nat.fromInt`'s sign check, and the checked
      // family are all Hexagon in the companions. `intPow` is the **raw** `**`
      // because its negative-exponent guard sits above it in source; `natPow`
      // is raw because at `Nat` there is no guard to write.
      case "intAdd":
      case "natAdd":
        return "(__a, __b) => __a + __b";
      case "intMultiply":
      case "natMultiply":
        return "(__a, __b) => __a * __b";
      case "intSubtract":
        return "(__a, __b) => __a - __b";
      case "intNegate":
        return "__a => -__a";
      // The truncated quotient at a `number` is `Math.trunc` of the real one:
      // JS `/` is float division, so the rounding has to be asked for. The
      // remainder is `%`, which already truncates.
      case "intQuot":
      case "natQuot":
        return `(__a, __b) => ${this.#spell("Math")}.trunc(__a / __b)`;
      case "intRem":
      case "natRem":
        return "(__a, __b) => __a % __b";
      case "intPow":
      case "natPow":
        return "(__a, __b) => __a ** __b";
      case "intEquals":
      case "natEquals":
        return "(__a, __b) => __a === __b";
      case "intCompare":
      case "natCompare":
        return '(__a, __b) => __a < __b ? "Less" : __a > __b ? "Greater" : "Equal"';
      case "intShow":
      case "natShow":
        return `__a => ${this.#spell("String")}(__a)`;
      case "intHash":
      case "natHash":
        return `__a => ${this.#useHelper("stableHash")}(__a)`;
      // `Nat` and `Int` share one `number` representation, so both conversions
      // are the identity: the widening one is total, and the narrowing one is
      // the unchecked core `Nat.fromInt`'s sign check sits above.
      case "intFromNat":
      case "natFromIntUnchecked":
        return "__a => __a";
      // `stdlib/Float.hex`'s and `stdlib/String.hex`'s natives (#344, the third
      // landing and the last), in the same primop shape. Three rows are not
      // bare operators, and each is that way because the operator would be
      // *wrong*: `floatEquals` is SameValueZero rather than `===`, so `NaN`
      // equals itself and the two zeroes agree; `floatCompare` and
      // `stringCompare` are the decided total order and the codepoint order,
      // through the comparators that already serve the operator fast paths,
      // wrapped in the `Ordering` name-string a `compare` slot owes its caller
      // (#275). Nothing here guards, because nothing at either type can:
      // `Float`'s partiality is `NaN`, and `String` has no partial operation.
      case "floatAdd":
        return "(__a, __b) => __a + __b";
      case "floatMultiply":
        return "(__a, __b) => __a * __b";
      case "floatSubtract":
        return "(__a, __b) => __a - __b";
      case "floatNegate":
        return "__a => -__a";
      case "floatDivide":
        return "(__a, __b) => __a / __b";
      case "floatPow":
        return "(__a, __b) => __a ** __b";
      // The `rem` half of Division & Remainder §5, and the only half of it that
      // crosses: bare `%`, no guard and no helper, with `Float.mod` written
      // over it in the companion's own Hexagon.
      case "floatRem":
        return "(__a, __b) => __a % __b";
      case "floatEquals":
        return "(__a, __b) => __a === __b || (__a !== __a && __b !== __b)";
      case "floatCompare":
        return `(__a, __b) => ${this.#useHelper("ordering")}(${this.#useHelper("compareFloat")}(__a, __b))`;
      case "floatShow":
        return `__a => ${this.#spell("String")}(__a)`;
      case "floatHash":
      case "stringHash":
        return `__a => ${this.#useHelper("stableHash")}(__a)`;
      // Collections Part 5 §5.3, whose implementation note is **binding**:
      // collect chunks and join. The spread materializes the sequence once and
      // `join` walks it once, so the cost is linear in the total length; the
      // fold of `++` the section describes is semantics, and writing it would
      // be the quadratic repeated concatenation the same sentence forbids.
      // Empty in, `""` out, for free — `[].join("")` is `""` (§5.3's first
      // clause) — and nothing here inspects, folds, or canonicalizes content,
      // which is the no-normalization clause holding by construction.
      case "stringFromSeq":
        return `__values => [...${this.#useHelper("seqToIterable")}(__values)].join("")`;
      case "stringConcat":
        return "(__a, __b) => __a + __b";
      case "stringEquals":
        return "(__a, __b) => __a === __b";
      case "stringCompare":
        return `(__a, __b) => ${this.#useHelper("ordering")}(${this.#useHelper("compareString")}(__a, __b))`;
      // `floatFromInt` is the identity over the one shared `number`
      // representation, exactly as `intFromNat` is; it is keyed only because a
      // Hexagon body for it would elaborate through the slot being defined.
      case "floatFromInt":
        return "__a => __a";
      // `runtime/HashTrie.hex`'s three groups (#365). The placement mix and the
      // popcount reach for helpers — one holds the per-process seed, the other a
      // SWAR word whose four statements no arrow expression can hold; the rest
      // are bare arrows, because each really is one JavaScript operator.
      case "hashTrieMix":
        return this.#useHelper("hashTrieMix");
      // `>>>` is deliberate over `>>`: the digit is an unsigned 5-bit field, and
      // an arithmetic shift of a negative mixed hash would sign-extend into it.
      // The caller never asks past shift 30 (JavaScript takes the shift count
      // modulo 32, so shift 35 would silently answer shift 3); the module's
      // `lastShift` states that invariant and `splitEntry` throws rather than
      // build a node below it.
      case "hashTrieDigit":
        return "(__a, __b) => (__a >>> __b) & 31";
      case "hashTrieBitTest":
        return "(__a, __b) => (__a & (1 << __b)) !== 0";
      case "hashTrieBitSet":
        return "(__a, __b) => __a | (1 << __b)";
      case "hashTrieBitClear":
        return "(__a, __b) => __a & ~(1 << __b)";
      case "hashTrieBitCount":
        return this.#useHelper("bitCount");
      // The mask is every bit strictly below `index`. At index 31 `1 << 31` is
      // `-2147483648` and the subtraction gives `0x7fffffff` — the 31 low bits,
      // which is exactly right; at index 0 it is `0`, so nothing is counted.
      // (The one index this expression could not serve is 32, which no caller
      // reaches: a digit is 0..31.)
      case "hashTrieBitCountBelow":
        return `(__a, __b) => ${this.#useHelper("bitCount")}(__a & ((1 << __b) - 1))`;
      case "hashTrieNodeSingleton":
        return "__a => [__a]";
      case "hashTrieNodeInsertAt":
        return "(__a, __b, __c) => [...__a.slice(0, __b), __c, ...__a.slice(__b)]";
      case "hashTrieNodeRemoveAt":
        return "(__a, __b) => [...__a.slice(0, __b), ...__a.slice(__b + 1)]";
      // `stdlib/Map.hex`'s seven (#370), and the first family whose lowerings
      // are **another Hexagon module's compiled operations**: each aliases the
      // matching export of `runtime/HashTrie.hex`'s emitted module, which is the
      // wiring that module's header promised. Nothing is adapted on the way
      // through — a `Map(k, v)` *is* a `HashTrie(k, v)`, and the two faces agree
      // because the same compiler wrote both.
      //
      // The keyed trio needs no mention of evidence here for the same reason:
      // its declaration carries `<k: Hash>` (§3.4), so a call site appends the
      // suffix the compiled `<k: Hash>` operation already takes. An alias is the
      // whole lowering, and a wrapper would only add an arity to get wrong.
      case "mapSingleton":
        return this.#useHashTrieRuntime("singleton");
      case "mapSize":
        return this.#useHashTrieRuntime("size");
      case "mapGet":
        return this.#useHashTrieRuntime("get");
      case "mapSet":
        return this.#useHashTrieRuntime("set");
      case "mapRemove":
        return this.#useHashTrieRuntime("remove");
      case "mapEntries":
        return this.#useHashTrieRuntime("entries");
      // The one that is not an alias, because the trie's `empty` is a *value*
      // and the door admits `fun` only. The thunk is what bridges the two, and
      // it is called exactly once per program: `Map.hex` binds `export let empty
      // = emptyMap()`, so the emitted `Map.empty` is a module-level `const`
      // holding the one shared trie — Collections Part 4 §11's shared runtime
      // constant, arrived at through the door rather than beside it.
      case "mapEmpty":
        return `() => ${this.#useHashTrieRuntime("empty")}`;
      // `stdlib/Set.hex`'s eight (#373) — its seven-row §6.2 surface plus the
      // unexported `setLookup` — in the `map*` block's shape one type parameter
      // narrower. What they alias is the trie module's **wrapper** operations,
      // not the trie's own: a `Set(a)` is a `HashSet(a)` holding a
      // `HashTrie(a, Unit)`, because one record carries one `[Symbol.iterator]`
      // and the trie's yields pairs. The wrapper also absorbs the `Unit`
      // argument, which is what keeps seven of the eight plain aliases instead
      // of the arity-adjusting arrows a bare-trie wiring would have needed; the
      // eighth is `setEmpty`, a thunk for the reason its own comment gives.
      case "setSingleton":
        return this.#useHashTrieRuntime("soleMember");
      case "setSize":
        return this.#useHashTrieRuntime("memberCount");
      case "setContains":
        return this.#useHashTrieRuntime("containsMember");
      // The eighth key, and the one that is not Part 4 §6.2 surface: `Set.hex`
      // declares it **unexported**, so no program can call it. `intersect` needs
      // it when the smaller side is the right one — §2.2 pins the traversal to
      // the smaller side and §5.4 pins the result's representatives to the left,
      // and the only way to satisfy both at once is to look the left's
      // representative *up*. `contains` remains the surface's only membership
      // read (§4.4).
      case "setLookup":
        return this.#useHashTrieRuntime("memberIn");
      case "setAdd":
        return this.#useHashTrieRuntime("addMember");
      case "setRemove":
        return this.#useHashTrieRuntime("removeMember");
      case "setElements":
        return this.#useHashTrieRuntime("members");
      // The thunk, for `mapEmpty`'s reason exactly: the wrapper's `emptySet` is
      // a *value* and the door admits `fun` only. `Set.hex` binds `export let
      // empty: Set(a) = emptySet()`, so the emitted `Set.empty` is a
      // module-level `const` holding the one shared set.
      case "setEmpty":
        return `() => ${this.#useHashTrieRuntime("emptySet")}`;
      // `stdlib/Debug.hex`'s one row (#407), and the helper it reaches is the
      // whole of the ruling: `spec/effects.md` §6.2 admits the probe as species
      // (a) *on condition* that the sink is captured, which is a property of
      // the emitted code and of nothing else.
      case "debugLog":
        return this.#useHelper("debugLog");
      default:
        if (INTRINSIC_INVENTORY.has(key)) {
          this.#diagnostics.add({
            severity: "error",
            message: `compiler defect: the intrinsic inventory provides \`${key}\`, ` +
              "but the emitter has no lowering for it",
            primary: span,
          });
        }
        return this.#unit;
    }
  }

  /**
   * Records how a scheme's quantified variables are spelled, so the evidence
   * parameters minted for its constraints can be named after them (#425).
   *
   * A scheme keeps no binder spellings — generalization mints variables, it does
   * not remember what the author called them — so the canonical `a`, `b`, … is
   * the spelling, and it is the same one `renderType` puts in the `.d.ts` and
   * `Typed.display` puts in a hover. The transcription is therefore exact
   * against the face the tools show, which is the readable property the naming
   * is for.
   */
  #noteScheme(scheme: Typed.Scheme): void {
    scheme.variables.forEach((variable, index) => {
      if (this.#variableSpellings.has(variable)) return;
      this.#variableSpellings.set(variable, typeVariableName(index));
    });
  }

  /**
   * The same, for an instance head, whose binders *are* written down (#390) and
   * so name themselves: `honor Show<Box(elem)> for <elem: Show>` takes
   * `__Show_elem`.
   */
  #noteHonorParameters(parameters: readonly Typed.HonorTypeParameter[]): void {
    parameters.forEach((parameter, index) => {
      if (this.#variableSpellings.has(parameter.variable)) return;
      this.#variableSpellings.set(
        parameter.variable,
        isSafeIdentifier(parameter.name) ? parameter.name : typeVariableName(index),
      );
    });
  }

  #variableSpelling(variable: Typed.TypeVariableId): string {
    const existing = this.#variableSpellings.get(variable);
    if (existing !== undefined) return existing;
    // Unreachable from a well-formed tree: every constraint an evidence
    // parameter answers is quantified by a scheme or an instance head, and both
    // are registered before their bodies render. Deterministic rather than
    // thrown, because a name is needed to keep emitting and the alternative is
    // an internal error thrown at the user.
    const spelling = typeVariableName(this.#unnamedVariables++);
    this.#variableSpellings.set(variable, spelling);
    return spelling;
  }

  /**
   * The evidence parameter one constraint on one type variable arrives in
   * (Constraints §6.1's trailing-evidence position), named for the constraint
   * and the variable's spelling: `__Show_a` (#425).
   *
   * `taken` is the evidence already in scope. Spelling from the signature means
   * two parameters in one JavaScript scope can genuinely want one name — an
   * inner generic binding under a generic function may re-use `a`, and shadowing
   * the outer dictionary would leave the outer body's requirement answered by
   * the wrong evidence. The same numbering discipline the dictionary family uses
   * settles it: probe `_1` upward. Distinct constraints on one variable need no
   * probe — `<a: (Num, Show)>` is `__Num_a` and `__Show_a` already.
   */
  #dictionaryParameterName(
    constraint: Typed.ConstraintName,
    variable: Typed.TypeVariableId,
    taken: ReadonlySet<string>,
  ): string {
    const base = `__${constraint}_${this.#variableSpelling(variable)}`;
    let name = base;
    let suffix = 1;
    while (taken.has(name)) name = `${base}_${suffix++}`;
    return name;
  }

  /**
   * Mints the evidence parameters for one binder list, threading them into a
   * copy of the enclosing evidence map. One helper for the four sites that need
   * it, so the shadowing probe cannot be applied at three of them.
   */
  #evidenceParameters(
    entries: readonly {
      readonly constraint: Typed.ConstraintName;
      readonly variable: Typed.TypeVariableId;
    }[],
    evidenceNames: EvidenceNames,
  ): { readonly names: readonly string[]; readonly localEvidence: Map<string, string> } {
    const localEvidence = new Map(evidenceNames);
    const taken = new Set(evidenceNames.values());
    const names = entries.map(({ constraint, variable }) => {
      const name = this.#dictionaryParameterName(constraint, variable, taken);
      taken.add(name);
      localEvidence.set(evidenceKey(variable, constraint), name);
      return name;
    });
    return { names, localEvidence };
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

  /**
   * The name this module spells a trie-runtime operation by, requesting the
   * import that binds it if this is the first use.
   *
   * Inside the runtime module the operation is a module-level binding of its own
   * source name, so there is nothing to import and nothing to rename. Everywhere
   * else it arrives as a named import under a generated local: `append` the
   * import and `append` a user's own function must be able to coexist, and only
   * the generated spelling ever moves (FFI Part 1 §10's rule, applied to a term).
   *
   * The stem is `trie`, not `vector`, and the difference is readability rather
   * than correctness. Several bracket helpers are already `__vectorX`, and a
   * shared stem made the probe hand out `__vectorSlice1` to whichever of the
   * two asked second — a name that says nothing about which it is, and that
   * moves between modules with the order they happen to reach them. `trie`
   * names the runtime, so a reader can tell an imported trie operation from a
   * locally emitted helper at a glance, and neither ever displaces the other.
   */
  #useVectorRuntime(operation: VectorRuntimeOperation): string {
    return this.#useRuntime(VECTOR_WIRING, operation);
  }

  #useHashTrieRuntime(operation: HashTrieRuntimeOperation): string {
    return this.#useRuntime(HASH_TRIE_WIRING, operation);
  }

  #useRuntime(wiring: RuntimeModuleWiring, operation: string): string {
    if (this.#locationOf(wiring) === "self") return operation;
    let uses = this.#runtimeUses.get(wiring.basename);
    if (uses === undefined) {
      uses = new Map<string, string>();
      this.#runtimeUses.set(wiring.basename, uses);
    }
    const existing = uses.get(operation);
    if (existing !== undefined) return existing;
    const name = this.#generatedNames.fixed(
      `${wiring.localStem}${operation[0]!.toUpperCase()}${operation.slice(1)}`,
    );
    uses.set(operation, name);
    return name;
  }

  /** Where this module finds `wiring`'s runtime module. */
  #locationOf(wiring: RuntimeModuleWiring): RuntimeLocation {
    return this.#runtimes.get(wiring.basename) ??
      { specifier: wiring.defaultSpecifier };
  }

  /**
   * One `import` line per runtime module whose operations this module reached,
   * and none for one it did not — the whole of "a program with no vectors
   * carries no trie runtime", and now of "a program with no maps carries no
   * hash trie". The specifiers ride along because reachability must emit the
   * modules these point at, and no `Import` item records the edges
   * (`Emitted.JavaScript.runtimeImports`).
   *
   * Named in each wiring's own operation order rather than first-use order, so
   * the emitted text is a function of what the module uses and not of where in
   * the module it happens to use it.
   */
  #runtimeImports(): readonly { readonly line: string; readonly specifier: string }[] {
    return RUNTIME_WIRINGS.flatMap((wiring) => {
      const location = this.#locationOf(wiring);
      const uses = this.#runtimeUses.get(wiring.basename);
      if (location === "self" || uses === undefined || uses.size === 0) return [];
      const items = wiring.operations.flatMap((operation) => {
        const local = uses.get(operation);
        return local === undefined ? [] : [`${operation} as ${local}`];
      });
      return [{
        line: `import { ${items.join(", ")} } from ` +
          `${JSON.stringify(emittedModuleSpecifier(location.specifier))};`,
        specifier: location.specifier,
      }];
    });
  }

  /**
   * The runtime module's JavaScript export list.
   *
   * `runtime/VectorTrie.hex` exports nothing at the Hexagon level and cannot:
   * every operation's type names the private `TrieVector`, and the checker
   * refuses to export a binding that exposes a private type. That refusal is
   * the feature — it is what makes the trie unreachable by any Hexagon
   * `import`, however the compiler places the file — so the way out is the
   * emitted module's own export list, written here.
   *
   * An operation the module does not declare is reported rather than exported.
   * Injection prefers a project's own file at the basename (the rule the
   * shipped-source sweep compiles `runtime/VectorTrie.hex` in its real role
   * by), so a project can put an unrelated file in this seat; without the check
   * the result is a `SyntaxError` in generated JavaScript with no diagnostic
   * anywhere, which is the worst way to learn it.
   */
  #runtimeExports(): readonly string[] {
    // The module's *own* top-level bindings, never `module.symbols`: that also
    // carries the prelude's, so a file declaring none of these would still look
    // as though it had `empty` and `prepend` — `Seq.hex` exports both — and the
    // export list would name what nothing declares.
    const declared = new Set(
      this.#module.items.flatMap((item) =>
        item.kind === "Let" || item.kind === "Fun" ? [item.binding.name] : []
      ),
    );
    return RUNTIME_WIRINGS.flatMap((wiring) => {
      if (this.#locationOf(wiring) !== "self") return [];
      const missing = wiring.operations.filter((operation) => !declared.has(operation));
      if (missing.length > 0) {
        this.#diagnostics.add({
          severity: "error",
          message: `this file sits at \`${wiring.basename}\`'s injection path but declares ` +
            `no ${missing.map((operation) => `\`${operation}\``).join(", ")}`,
          primary: this.#module.span,
        });
      }
      const present = wiring.operations.filter((operation) => declared.has(operation));
      return present.length === 0 ? [] : [`export { ${present.join(", ")} };`];
    });
  }
}

class DeclarationEmitter {
  readonly #diagnostics = new Diagnostics.Bag();
  readonly #module: Core.Module;
  readonly #specializations: readonly FundamentalSpecialization[];
  /**
   * Each edition **face** as it was rendered, for §10's byte accounting — the
   * declaration side's `#generatedBodies`, recorded at the push so the report
   * measures the text this file actually carries.
   */
  readonly #generatedFaces: {
    readonly specialization: FundamentalSpecialization;
    readonly text: string;
  }[] = [];
  /** §3.4's list, from the plan this file's faces were rendered from. */
  readonly #zeroEntryPointExports: readonly string[];
  readonly #opaqueBrands: ReadonlyMap<string, string>;
  /** The prelude identities and runtime faces this `.d.ts` renders through. */
  readonly #faces: DeclarationFaces;
  readonly #docs: DocIndex;
  /** Where the program's runtime declaration module sits, from here. */
  readonly #runtimeSpecifier: string;

  constructor(module: Core.Module, options: DeclarationEmissionOptions) {
    this.#module = module;
    this.#opaqueBrands = opaqueBrandNames(module);
    // Hoisted above the alias set because that set has to know which constrained
    // exports render a face at all, and this is what decides it. A pure function
    // of the module and the program's candidate rows, so it settles here as
    // readily as at the end.
    const plan = planFundamentalSpecializations(module, options.fundamentalInstances);
    this.#specializations = plan.specializations;
    this.#zeroEntryPointExports = plan.zeroEntryPointExports;
    // Every spelling below is settled **before** a single face is rendered, and
    // that is what §2.4's rung order rests on: the probe's universe is a property
    // of the module, so `reference` can return finished text and nothing has to
    // be patched in afterwards. The one input that would otherwise need the
    // rendering — whether an alias reaches the file — is answered by walking the
    // types the file will render, a walk that produces no text (`qualifyingAliases`).
    const own = declaredNominals(module);
    const imported = importedNominals(module);
    const prelude = preludeIds(module);
    const aliases = qualifyingAliases(module, prelude, own, imported, plan.specializations);
    // **The brands are settled first and then contest everything after them.**
    // A brand is derived from a declared name, so it is as much a property of
    // the module as the declaration is — but it is emitted, `declare const
    // <Name>Brand: unique symbol`, and it therefore belongs in every universe
    // below. It did not have to before: the exclusion rested on no
    // compiler-chosen spelling being able to end in `Brand`, and rung 5's
    // candidate is a *foreign type's own name*, which can end in anything. A
    // foreign `PointBrand` minted beside an `opaque record Point` collided
    // silently — TS2440 and two TS2395s on a program with no Hexagon diagnostic.
    const brands = emittedBrandNames(module, prelude, this.#opaqueBrands);
    const aliasLocals = declarationAliasPlan(
      aliases,
      new Set([...declarationTopLevelNames(module, []), ...brands]),
    );
    const universe = new Set([
      ...declarationTopLevelNames(
        module,
        aliases.map((alias) => aliasLocals.get(alias) ?? alias),
      ),
      ...brands,
    ]);
    // §1.1 half 2, and it reads the universe **before** the vocabulary joins it
    // below: what this asks is whether the *module* binds a contested spelling,
    // and a set that carries the vocabulary unconditionally answers yes always.
    // The aliases are already at their emitted spellings here, which is the
    // whole of §14.6's namespace clause — a yielded `Iterable_1` is not an
    // `Iterable` in this universe, and a carried, unyielded one is.
    const vocabulary = new VocabularyFaces(universe);
    // §1.1 half 1: the vocabulary joins every probe universe, so no spelling the
    // compiler mints can take a lib spelling a face needs. It bites at rung 5 —
    // a minted local's first candidate is the foreign type's *own name*, so a
    // module exporting a record genuinely named `Iterable` would otherwise be
    // imported under `Iterable` here and capture this file's `Seq` faces. The
    // other two probes below can only ever produce `Hex_n` and `Name_n`, so the
    // vocabulary is inert for them; they read it anyway, because a probe that
    // reads a different universe from its neighbours is the drift this rule's
    // single list exists to prevent.
    const probed = new Set([...universe, ...CONTESTED_VOCABULARY]);
    const runtime = new RuntimeFaces(runtimeFacesAlias(module, probed));
    // The settled runtime alias joins the probe's universe: it is a top-level
    // identifier of this file that `declarationTopLevelNames` deliberately does
    // not carry, being generated rather than source-derived.
    //
    // That universe is a documented *superset* of what the file emits, and it is
    // one here too — a declaration that reaches no `.d.ts` row still spends its
    // name. Cosmetic, and it errs the safe way: the cost of over-claiming is a
    // moved generated spelling, the cost of under-claiming is a `.d.ts` that
    // does not compile.
    const taken = new Set([...probed, runtime.alias]);
    this.#faces = {
      prelude,
      runtime,
      vocabulary,
      nominals: new NominalFaces({
        fileId: module.fileId,
        own,
        imported,
        aliasLocals: new Map(aliases.map((alias) => [alias, aliasLocals.get(alias) ?? alias])),
        prelude: new PreludeTypeFaces(module.preludeTypeImports, taken),
        homes: options.nominalHomes,
        path: options.modulePath,
        taken,
      }),
    };
    this.#runtimeSpecifier = options.runtimeSpecifier ?? DEFAULT_RUNTIME_SPECIFIER;
    this.#docs = new DocIndex(module.docs);
    for (const diagnostic of module.diagnostics) this.#diagnostics.add(diagnostic);
    addSpecializationCollisionDiagnostics(this.#diagnostics, module, plan.collisions);
  }

  emit(): Emitted.Declarations {
    // A source-written import line is owed by the *answers its names gave*, and
    // no answer is in before rendering ends — so the item's seat is reserved
    // here and filled at the end. §2.4's Placement: a line rung 2 or rung 3 owes
    // keeps its **source position**, because it is the module's own import and
    // not the compiler's, and is simply absent where no answer owed it.
    const declarations: (string | Core.ImportItem)[] = [];
    let isExternalModule = false;
    for (const item of this.#module.items) {
      if (item.kind === "Import") {
        declarations.push(item);
        continue;
      }
      if (item.kind === "ExternBlock") {
        for (const declaration of item.declarations) {
          if (!declaration.exported) continue;
          // The brand line goes before the documentation: JSDoc binds to the
          // declaration that immediately follows it.
          const doc = this.#docs.lines(declaration.span, "", [], true);
          if (declaration.kind === "ExternType") {
            const brand = this.#opaqueBrands.get(declaration.localName)!;
            declarations.push(`declare const ${brand}: unique symbol;`);
            declarations.push(...doc);
            declarations.push(`export type ${declaration.localName} = { readonly [${brand}]: never };`);
          } else if (declaration.kind === "ExternFun") {
            // #370: a constrained row has no face; see the other extern-block
            // arm below for why publishing one would be worse than publishing
            // nothing.
            if (declaration.binding.scheme.constraints.length > 0) continue;
            declarations.push(
              ...this.#docs.lines(
                declaration.span,
                "",
                hexagonFaceDoc(declaration.binding.scheme),
                true,
              ),
            );
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
        declarations.push(...this.#docs.lines(item.span, "", [], true));
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
          declarations.push(...this.#docs.lines(item.span, "", [], true));
          declarations.push(`export type ${item.name}${generics} = { readonly [${brand}]: ${names.length === 0 ? "never" : names.join(" | ")} };`);
          isExternalModule = true;
          continue;
        }
        // Modules §11.4: a private type gets no line of any kind in the shipped
        // file, a non-exported `type` declaration included. This arm alone
        // pushed its row for every union, exported or not — only the
        // constructors below were gated — so every private union in every module
        // was published, representation and all (#621). The gate is every other
        // arm's, and with it the constructors' own `exported` test is the same
        // question asked twice.
        if (!item.exported) continue;
        isExternalModule = true;
        declarations.push(...this.#docs.lines(item.span, "", [], true));
        declarations.push(renderUnionDeclaration(item, true, this.#faces));
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
          declarations.push(...this.#docs.lines(constructor.span, "", [], true));
          declarations.push(
            `export declare const ${constructor.name}: ${type};`,
          );
        }
        continue;
      }
      if (item.kind === "RecordDeclaration") {
        if (!item.exported) continue;
        const variables = typeVariableNames(item.parameters);
        const names = item.parameters.map((parameter) => variables.get(parameter)!);
        const generics = names.length === 0 ? "" : `<${names.join(", ")}>`;
        if (item.opaque) {
          // A §2.3-pinned type takes no brand: its seat is the pinned face as a
          // transparent alias, so the exported name and every rendered face
          // denote one type (§5's exclusion; §14.5, #622). There is no
          // `declare const` line to emit, and the documentation rides the alias
          // exactly as it rode the branded row.
          const pinned = pinnedDeclarationFace(item, variables, this.#faces);
          if (pinned !== undefined) {
            declarations.push(...this.#docs.lines(item.span, "", [], true));
            declarations.push(`export type ${item.name}${generics} = ${pinned};`);
            isExternalModule = true;
            continue;
          }
          const brand = this.#opaqueBrands.get(item.name)!;
          declarations.push(`declare const ${brand}: unique symbol;`);
          declarations.push(...this.#docs.lines(item.span, "", [], true));
          declarations.push(`export type ${item.name}${generics} = { readonly [${brand}]: ${names.length === 0 ? "never" : names.join(" | ")} };`);
          isExternalModule = true;
          continue;
        }
        const recordType = `{ ${item.fields.map((field) =>
          `${field.name}: ${renderType(field.type, variables, this.#faces, false)}`
        ).join("; ")} }`;
        const result = names.length === 0 ? item.name : `${item.name}<${names.join(", ")}>`;
        declarations.push(...this.#docs.lines(item.span, "", [], true));
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
        declarations.push(...this.#docs.lines(item.span, "", [], true));
        declarations.push(
          ...renderExceptionDeclarations(item, "export ", this.#faces),
        );
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
          const specialized = specializeItem(
            item as SpecializableItem,
            specialization,
            this.#faces.prelude.bool,
            faceOnlyEditionInstances,
          );
          // A constrained binding has no single `.d.ts` declaration — its face
          // is one per specialization — so its documentation rides each, and so
          // does the Hexagon face, which is the specialization's own.
          declarations.push(
            ...this.#docs.lines(
              item.span,
              "",
              hexagonFaceDoc(specialized.binding.scheme),
              true,
            ),
          );
          const face = renderFunctionDeclaration(
            specialization.name,
            specialized.binding.scheme,
            specialized.value as Core.LambdaExpr,
            true,
            this.#faces,
          );
          // §10: recorded here, where the face is the text that goes into the
          // file, rather than recovered afterwards by searching for a signature
          // this would have to render a second time to know.
          this.#generatedFaces.push({ specialization, text: face });
          declarations.push(face);
        }
        isExternalModule ||= specializations.length > 0;
        continue;
      }
      isExternalModule = true;

      declarations.push(
        ...this.#docs.lines(item.span, "", hexagonFaceDoc(item.binding.scheme), true),
      );
      const safeName = isSafeIdentifier(item.binding.name);
      const local = safeName
        ? item.binding.name
        : `__binding${Number(item.binding.symbol)}`;
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
    // The stage-1 guard's face (Exceptions §7.6, #478), once, after the module's
    // own rows: it is the module's guard, not any one exception's, and its
    // emitted counterpart sits with the export lines for the same reason.
    if (this.#module.items.some((item) => item.kind === "Exception" && item.exported)) {
      declarations.push(renderIsHexErrorDeclaration(this.#faces));
      isExternalModule = true;
    }
    // Every rung's answers are in; the file's imports are exactly what they owe.
    //
    // The source-written lines first, in their own seats: a namespace line is
    // written where a face qualified through it, and a named line keeps only the
    // names an answer reached. Everything an import binds that no face named
    // vanishes — a companion imported for its terms, a term-only name, a type
    // alias whose expansion the faces carry instead of its name. That is one
    // rule, not a feature of its own, and it is what dissolves the alias/
    // declaration and alias/named-import collisions with no renaming at all.
    let importSurvived = false;
    const rendered = declarations.flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      const lines = this.#importLines(entry);
      importSurvived ||= lines.length > 0;
      return lines;
    });
    isExternalModule ||= importSurvived;
    // The prelude types the rendered faces actually reached (§2.4 rung 4), then
    // rung 5's minted lines. Unshifted for the reason the runtime import below
    // is: a compiler-written import precedes the module's own items. They are
    // read only now, when every face has been rendered and the answers are
    // closed.
    const preludeTypeLines = this.#faces.nominals.preludeLines();
    const mintedTypeLines = this.#faces.nominals.mintedLines();
    if (preludeTypeLines.length > 0 || mintedTypeLines.length > 0) {
      rendered.unshift(
        ...preludeTypeLines.map(({ line }) => line),
        ...mintedTypeLines.map(({ line }) => line),
      );
      isExternalModule = true;
    }
    // Exactly one type-only import of the runtime declaration module, and only
    // when a `Hex.*` face was actually rendered (FFI Part 1 §8.3 obligation 2).
    // It goes first, ahead of the source-level imports, because it is the
    // compiler's own line rather than one of the module's. The import is
    // type-only and erases, so it adds no emitted JavaScript dependency and no
    // `hex.js` is ever written.
    if (this.#faces.runtime.used) {
      rendered.unshift(
        `import type * as ${this.#faces.runtime.alias} from ` +
          `${JSON.stringify(this.#runtimeSpecifier)};`,
      );
      isExternalModule = true;
    }
    if (!isExternalModule) rendered.push("export {};");

    const text = `${rendered.join("\n")}\n`;
    return {
      kind: "Declarations",
      fileId: this.#module.fileId,
      text,
      generatedSections: generatedSections(text, this.#generatedFaces),
      zeroEntryPointExports: this.#zeroEntryPointExports,
      importsRuntimeTypes: this.#faces.runtime.used,
      preludeTypeImports: [...new Set(preludeTypeLines.map(({ specifier }) => specifier))],
      mintedTypeImports: [...new Set(mintedTypeLines.map(({ specifier }) => specifier))],
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  /**
   * One source-written import item's `.d.ts` lines — none, where no rendered
   * face answered through it (§2.4).
   *
   * The declaration file is not a transcription of the module's import list; it
   * carries what its faces need. A module importing a companion for its *terms*
   * — the common case, and the whole of the companion idiom — writes no
   * declaration-side line for it, and so cannot collide on its alias.
   */
  #importLines(item: Core.ImportItem): readonly string[] {
    const specifier = JSON.stringify(emittedModuleSpecifier(item.specifier));
    if (item.form.kind === "Namespace") {
      if (!this.#faces.nominals.usedAlias(item.form.alias)) return [];
      return [
        `import type * as ${this.#faces.nominals.aliasLocal(item.form.alias)} from ${specifier};`,
      ];
    }
    // No `synthesized` test on either arm, and none is owed: the one synthesized
    // item is the prelude's used-names import, whose `ImportName`s carry neither
    // `typeBinding` nor an identity, so the gate below declines them anyway. A
    // test that can never fire is a claim about a shape that does not exist.
    if (item.form.kind !== "Named") return [];
    // Every name that binds a type, not just those binding *only* a type: a
    // record's name imports its constructor and its type at once, and the term
    // half must not cost the `.d.ts` its type row. The JavaScript side reads
    // `typeOnly` and is untouched.
    const names = item.form.names.flatMap((name) => {
      const identity = importNameIdentity(name);
      if (name.typeBinding !== true || identity === undefined) return [];
      if (!this.#faces.nominals.usedImport(identity)) return [];
      return [name.imported === name.local ? name.imported : `${name.imported} as ${name.local}`];
    });
    return names.length === 0 ? [] : [`import type { ${names.join(", ")} } from ${specifier};`];
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

  constructor(module: Core.Module, fundamentalInstances?: FundamentalInstances) {
    this.#module = module;
    this.#opaqueBrands = opaqueBrandNames(module);
    // The preview writes every namespace alias line unconditionally and is out
    // of §2.4's gated-alias scope, so its universe carries them all — the
    // default `declarationTopLevelNames` reading, which is also the one the
    // runtime-alias probe here has always used.
    const universe = declarationTopLevelNames(module);
    this.#faces = {
      prelude: preludeIds(module),
      runtime: new RuntimeFaces(
        runtimeFacesAlias(module, new Set([...universe, ...CONTESTED_VOCABULARY])),
      ),
      // §1.1 qualifies here too, and the preview is the one file where the
      // *runtime* faces are exposed to the capture as well: the pane declares
      // `Hex` inline, so `interface Vector<a> extends Iterable<a>` shares a
      // scope with the user's own `Iterable` (measured, `TS2315`).
      vocabulary: new VocabularyFaces(universe),
      // Inert: §2.4's Scope keeps the preview on bare names. It is one pane of
      // text with nothing to import from, so every rung declines and the sink
      // answers with the declared name — which is what the preview has always
      // printed, and what §14.3 leaves unchanged.
      nominals: bareNominalFaces(module.fileId),
    };
    this.#docs = new DocIndex(module.docs);
    for (const diagnostic of module.diagnostics) this.#diagnostics.add(diagnostic);
    const plan = planFundamentalSpecializations(module, fundamentalInstances, true);
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
          const doc = this.#docs.lines(declaration.span, "", [], declaration.exported);
          if (declaration.kind === "ExternType") {
            const brand = this.#opaqueBrands.get(declaration.localName)!;
            declarations.push(`declare const ${brand}: unique symbol;`);
            declarations.push(...doc);
            declarations.push(`${prefix}type ${declaration.localName} = { readonly [${brand}]: never };`);
          } else if (declaration.kind === "ExternFun") {
            // #370: a **constrained** row has no `.d.ts` face, exactly as a
            // constrained `.hex` binding has none. Its ESM export is the
            // internal constrained name and its real arity carries the trailing
            // evidence, so rendering the declared signature here would publish
            // an export the module does not have under that name *and* promise
            // it one argument short — a clean compile that fails at the first
            // JavaScript call. The face is the specializations (Constraints
            // §6.4), and `Hash` has none, so the rows are simply absent from the
            // face: correct, and no worse than the surface they replaced, which
            // had no face either.
            if (declaration.binding.scheme.constraints.length > 0) continue;
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
        declarations.push(...this.#docs.lines(item.span, "", [], item.exported));
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
          declarations.push(...this.#docs.lines(item.span, "", [], item.exported));
          declarations.push(`${prefix}type ${item.name}${generics} = { readonly [${brand}]: ${names.length === 0 ? "never" : names.join(" | ")} };`);
          isExternalModule ||= item.exported;
          continue;
        }
        declarations.push(...this.#docs.lines(item.span, "", [], item.exported));
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
          declarations.push(...this.#docs.lines(constructor.span, "", [], item.exported));
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
          // The pin governs the preview's seat too (#622). The preview already
          // renders a pinned *face* as the notion — `renderType` is the same
          // function here — so a brand at the seat would be the same divergence
          // in one pane of text that it was across a program's files. The
          // preview reaches it only in a module that declares the prelude's
          // `Seq`, which is the point: what it shows is what would ship.
          const pinned = pinnedDeclarationFace(item, variables, this.#faces);
          if (pinned !== undefined) {
            declarations.push(...this.#docs.lines(item.span, "", [], item.exported));
            declarations.push(`${prefix}type ${item.name}${generics} = ${pinned};`);
            isExternalModule ||= item.exported;
            continue;
          }
          const brand = this.#opaqueBrands.get(item.name)!;
          declarations.push(`declare const ${brand}: unique symbol;`);
          declarations.push(...this.#docs.lines(item.span, "", [], item.exported));
          declarations.push(`${prefix}type ${item.name}${generics} = { readonly [${brand}]: ${names.length === 0 ? "never" : names.join(" | ")} };`);
          isExternalModule ||= item.exported;
          continue;
        }
        const recordType = `{ ${item.fields.map((field) =>
          `${field.name}: ${renderType(field.type, variables, this.#faces, false)}`
        ).join("; ")} }`;
        const result = names.length === 0 ? item.name : `${item.name}<${names.join(", ")}>`;
        declarations.push(...this.#docs.lines(item.span, "", [], item.exported));
        declarations.push(
          ...this.#renderRecordType(item, variables, `${prefix}type ${item.name}${generics} = `),
        );
        declarations.push(`${prefix}declare const ${item.name}: ${generics}(record: ${recordType}) => ${result};`);
        isExternalModule ||= item.exported;
        continue;
      }
      if (item.kind === "Exception") {
        declarations.push(...this.#docs.lines(item.span, "", [], item.exported));
        declarations.push(
          ...renderExceptionDeclarations(
            item,
            item.exported ? "export " : "",
            this.#faces,
          ),
        );
        isExternalModule ||= item.exported;
        continue;
      }
      if (item.kind === "LetPattern") {
        for (const binding of patternBindings(item.pattern)) {
          const name = isSafeIdentifier(binding.name)
            ? binding.name
            : `__binding${Number(binding.symbol)}`;
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
          const specialized = specializeItem(
            item as SpecializableItem,
            specialization,
            this.#faces.prelude.bool,
            faceOnlyEditionInstances,
          );
          // A constrained binding has no single `.d.ts` declaration — its face
          // is one per specialization — so its documentation rides each.
          declarations.push(...this.#docs.lines(item.span, "", [], item.exported));
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
        : `__binding${Number(item.binding.symbol)}`;
      declarations.push(...this.#docs.lines(item.span, "", [], item.exported));
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

    // The stage-1 guard's face (Exceptions §7.6), on the same condition the
    // `.d.ts` emits it on: at least one *exported* exception.
    if (this.#module.items.some((item) => item.kind === "Exception" && item.exported)) {
      declarations.push(renderIsHexErrorDeclaration(this.#faces));
      isExternalModule = true;
    }

    // The preview is one pane of inspection-only text with no file to import
    // from, so §8.3 obligation 6 has it declare the namespace inline instead —
    // the same four interfaces, which is what keeps a value typed through the
    // preview and one typed through an imported `hex.d.ts` mutually assignable.
    // The header goes first to read like one, not because TypeScript needs it
    // there: a type reference may precede its declaration in the same file.
    if (this.#faces.runtime.used) {
      declarations.unshift(
        ...runtimeNamespaceDeclaration(this.#faces.runtime.alias, this.#faces.vocabulary),
      );
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
  // A brand is a **face**, not a hygiene name: it is declared in the `.d.ts` a
  // TypeScript reader looks at, so it stays outside Lexer §3.2's reserved `__`
  // prefix, and so do its collision probes (FFI Part 7 §5, #425). `<name>Brand`
  // is that part's own representative spelling; per-type uniqueness within the
  // file is the contract, which is what the probe delivers. A moved brand takes
  // §2.1's underscore suffix — `<name>Brand_1`, never `<name>Brand1` — a brand
  // already looking like a type, so it aliases like one (#619).
  const taken = new Set([...module.symbols.map(({ name }) => name), ...typeNames]);
  const brand = (name: string): string => {
    const base = `${name}Brand`;
    let candidate = base;
    let suffix = 1;
    while (taken.has(candidate)) candidate = `${base}_${suffix++}`;
    taken.add(candidate);
    return candidate;
  };
  return new Map(module.items.flatMap((item) =>
    (item.kind === "Union" || item.kind === "RecordDeclaration") && item.opaque
      ? [[item.name, brand(item.name)] as const]
      : item.kind === "ExternBlock"
      ? item.declarations.flatMap((declaration) =>
          declaration.kind === "ExternType"
            ? [[declaration.localName, brand(declaration.localName)] as const]
            : []
        )
      : []
  ));
}

interface PatternPlan {
  readonly tests: readonly string[];
  readonly bindings: readonly string[];
}

/**
 * The parameter the emitted boundary guards take (Exceptions §7.6, #478).
 *
 * Lexer §3.2's reserved prefix, and deliberately: `is` and `isHexError` are the
 * **faces**, spelled plainly because a TypeScript reader sees them; the binder
 * inside one is generated code like any other, and `__error` is the spelling
 * `GeneratedNames.fresh("error")` already gives a catch binding.
 */
const GUARD_PARAMETER = "__error";

/**
 * One exception's guard body: §7.4's (module, name) pair read from the outside,
 * which is exactly the test a catch arm for the same constructor emits (#488).
 */
function guardTest(value: string, owner: string, name: string): string {
  return `${value} != null && ${value}.$hex === ${JSON.stringify(owner)}` +
    ` && ${value}.name === ${JSON.stringify(name)}`;
}

/**
 * The stage-1 guard a module exporting at least one exception publishes
 * (Exceptions §7.6): domestic-or-foreign, the question every consuming `catch`
 * asks first, with the foreign branch its negation. The shape is the emitter's;
 * the predicate is normative.
 */
const IS_HEX_ERROR_GUARD =
  `export const isHexError = (${GUARD_PARAMETER}) => ` +
  `${GUARD_PARAMETER} != null && typeof ${GUARD_PARAMETER}.$hex === "string";`;

/** The fixed public name of that guard — a face, so no reserved prefix. */
const IS_HEX_ERROR = "isHexError";

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

/**
 * Zero-Cost Fundamental Exports §10's byte accounting, over whichever artefact's
 * editions are handed in: the JavaScript emitter's rendered bodies, or the
 * declaration emitter's rendered faces.
 *
 * One function for both because §10 asks for one measurement of two files, and
 * the two would drift apart the moment they were written twice. The rendered
 * text is *recorded as it was pushed* and then found in the finished file rather
 * than re-rendered here — that is what makes a row a report of the emission
 * instead of a second opinion about it, and it is why a face that stopped being
 * pushed loses its row rather than acquiring a stale one.
 *
 * The cursor advances past each located edition, so the scan is linear and an
 * edition can never be found inside one already accounted for. A row is dropped
 * where the text is not found at all, which no emission produces today: the
 * final file is the pushed strings joined, and every edition's rendering carries
 * its own generated name. Dropping beats guessing an offset that would make
 * `text.slice(start, end)` return something that is not the edition.
 */
function generatedSections(
  text: string,
  editions: readonly {
    readonly specialization: FundamentalSpecialization;
    readonly text: string;
  }[],
): readonly Emitted.GeneratedSection[] {
  let cursor = 0;
  return editions.flatMap(({ specialization, text: rendered }) => {
    const startOffset = text.indexOf(rendered, cursor);
    if (startOffset < 0) return [];
    const endOffset = startOffset + rendered.length;
    cursor = endOffset;
    return [{
      kind: "FundamentalSpecialization" as const,
      sourceName: specialization.sourceName,
      generatedName: specialization.name,
      typeArguments: specialization.assignment.map(({ type }) => type),
      startOffset,
      endOffset,
      bytes: utf8ByteLength(rendered),
    }];
  });
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

/**
 * Instance dictionaries in an order that satisfies their direct references:
 * source order, delayed only where one dictionary is read while another
 * initializes. A reference from inside a member lambda is read at call time and
 * constrains nothing, so it is not among the edges here (Constraints §6.3).
 *
 * A cycle cannot arise from direct references — a dictionary that read itself
 * into being could not be built at all — so an item whose dependencies never
 * arrive is emitted in source order rather than dropped.
 */
function orderInstances(
  instances: readonly RenderedItem[],
  directEvidence: ReadonlyMap<Core.Item, readonly string[]>,
): readonly RenderedItem[] {
  const names = new Map(
    instances.flatMap((rendered) =>
      rendered.item.kind === "Honor" ? [[rendered.item.dictionary, rendered] as const] : []
    ),
  );
  const emitted = new Set<RenderedItem>();
  const ordered: RenderedItem[] = [];
  const place = (rendered: RenderedItem, visiting: ReadonlySet<RenderedItem>): void => {
    if (emitted.has(rendered) || visiting.has(rendered)) return;
    const next = new Set(visiting).add(rendered);
    for (const evidence of directEvidence.get(rendered.item) ?? []) {
      for (const identifier of evidence.match(/[A-Za-z_$][\w$]*/gu) ?? []) {
        const dependency = names.get(identifier);
        if (dependency !== undefined) place(dependency, next);
      }
    }
    emitted.add(rendered);
    ordered.push(rendered);
  };
  for (const rendered of instances) place(rendered, new Set());
  return ordered;
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

// `checkedPower` left this family with #344's second landing: it was the
// integer `pow` lowering, and its negative-exponent guard is Hexagon in
// `stdlib/Int.hex` and `stdlib/BigInt.hex` now. `Nat` needs no guard and
// `Float` never had one, so both inline the raw `**` and nothing calls it.
// The same landing retired `intDiv`, `intMod`, `intQuot`, `intRem`, and
// `intGcd` into `stdlib/Int.hex`'s `honor Integral<Int>` block.
type Helper =
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
  | "streamFromSeq"
  | "streamInbound"
  | "debugLog"
  | "nodeSet"
  | "vectorAt"
  | "vectorIndex"
  | "vectorIterate"
  | "hashTrieIterate"
  | "hashSetIterate"
  | "mapIndex"
  | "mapEquals"
  | "mapHash"
  | "setEquals"
  | "setHash"
  | "vectorOf"
  | "vectorSet"
  | "vectorSlice"
  | "stringIndex"
  | "stringSlice"
  | "stableHash"
  | "mixHash"
  | "hashTrieMix"
  | "bitCount";

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
  // Drives `pull` directly rather than through `seqToIterable`: a stream is
  // single-pass, so it wants a cursor it can hold, not a fresh generator.
  streamFromSeq: [],
  // Owes nothing. The whole of §14.1 is that the shim composes with no spine:
  // no adapter, no memo, no driver — one foreign step per pull.
  streamInbound: [],
  debugLog: [],
  nodeSet: [],
  vectorAt: [],
  vectorIndex: [],
  vectorIterate: [],
  // The hash trie's face drives the module's own lazy `entries` walk through
  // the `Seq` driver, so it owes that helper (#370).
  hashTrieIterate: ["seqToIterable"],
  // The set face drives the wrapper's own key-projected walk through the same
  // driver, and owes the same helper (#373).
  hashSetIterate: ["seqToIterable"],
  mapIndex: [],
  mapEquals: [],
  mapHash: ["mixHash"],
  setEquals: [],
  setHash: ["mixHash"],
  vectorOf: [],
  vectorSet: [],
  vectorSlice: [],
  // Empty since the trie: `stringIndex`/`stringSlice` reached the vector
  // helpers when a `Vector(a)` was a JS array and a codepoint array was one.
  // Each now carries its own array reading (§9), because a string is not a
  // trie and re-tying them would put the codepoint path through a trie
  // build it has no use for.
  stringIndex: [],
  stringSlice: [],
  stableHash: [],
  mixHash: [],
  hashTrieMix: [],
  bitCount: [],
};

/**
 * Every helper body the emitter can write, rendered once each with the **bare**
 * vocabulary — the input FFI Part 7 §1.2's tripwire scans
 * (`conformance/runtime-vocabulary.test.ts`).
 *
 * Exported for that one reader, and driven off `HELPER_DEPENDENCIES`' keys
 * rather than a second list, so a helper added to the `Helper` union is rendered
 * here without anyone remembering to add it: the tripwire's whole value is that
 * it cannot be outrun by an edit elsewhere. The names handed in are stand-ins —
 * what is scanned is which *globals* a body names, and no helper's spelling of
 * its own name or its dependencies' can be one.
 *
 * One entry per helper, whole: a body is scanned as a unit because its locals
 * are what separate its globals from its own names, and a helper read a line at
 * a time would report every parameter as free.
 */
export function renderEveryHelper(): readonly string[] {
  return (Object.keys(HELPER_DEPENDENCIES) as Helper[]).map((helper) =>
    renderHelper(
      helper,
      `__${helper}`,
      (dependency) => `__${dependency}`,
      (operation) => `__trie_${operation}`,
      (operation) => `__hashTrie_${operation}`,
      "probe",
      (global) => BARE_RUNTIME_VOCABULARY.spell(global),
    ).join("\n")
  );
}

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
    case "ConstraintCall": {
      const inlined = primitiveInstance(expression.evidence);
      if (inlined === undefined) return Precedence.Call;
      switch (expression.member) {
        case "add":
        case "subtract":
        case "concat":
          return Precedence.Additive;
        case "multiply":
        case "divide":
          return Precedence.Multiplicative;
        case "pow":
          return inlined === "Float"
            ? Precedence.Exponentiation
            : Precedence.Call;
        case "negate":
          return Precedence.Unary;
        default:
          return Precedence.Call;
      }
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
    case "WidenInt": {
      const widened = primitiveInstance(expression.evidence);
      return widened !== undefined && widened !== "BigInt"
        ? expressionPrecedence(expression.value)
        : Precedence.Call;
    }
    case "Name":
    case "CollectionOperation":
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
  /** The vector trie runtime, for the helpers that are bounds checks around it. */
  runtimeName: (operation: VectorRuntimeOperation) => string,
  /**
   * The hash trie runtime, for the map bracket, both iteration faces, and the
   * derived instances of both companions (#370, #373).
   */
  hashTrieName: (operation: HashTrieRuntimeOperation) => string,
  /**
   * The emitting module's brand identity (Exceptions §7.1, #488) — what the
   * `exception` helper bakes in. Only that helper reads it: every other throw
   * site below raises a *prelude* exception, whose brand is its own declaring
   * module's and is spelled by the constants beside them.
   */
  identity: string,
  /**
   * How the emitting module spells the runtime vocabulary (FFI Part 7 §1.2).
   *
   * Threaded in rather than written bare, because a helper body is emitted
   * *into the user's module* and its globals are captured by that module's own
   * bindings — the defect this rule repairs, at its sharpest seat: `exception`'s
   * `new Error(…)` beside an `export record Error` throws `TypeError: Error is
   * not a constructor` on every raise. A helper relocated to a module of its own
   * would need no parameter, and §14.7 records why that is not the repair: the
   * inline seats — Unit's spelling in user function bodies, `String(…)` in
   * interpolation and derived `show` — are written outside every helper.
   */
  spell: (name: RuntimeSpelling) => string,
): string[] {
  switch (helper) {
    // The HAMT's placement mix (#365). The seed is read **once**, when the
    // emitted module is first evaluated, and never again — `spec/effects.md`
    // §6.2 species (b), the same shape `seqMemoize`'s cache has: the world is
    // touched at most once, by the owner, and no caller can observe when. Within
    // one execution the function is therefore an ordinary pure function of its
    // argument, which is exactly Collections Part 2 §2.4's promise; across
    // executions the placement, and so a trie's traversal order, differs.
    //
    // The multiplier is the 32-bit golden-ratio constant `mixHash` already uses.
    // Nothing about the trie depends on which mixer this is, only on its being a
    // function of its argument and on its carrying the seed — the public member
    // is deterministic and unseeded by design (Collections Part 2 §2.4), so a
    // trie navigating by it directly would give the bucket function away and
    // freeze traversal order across executions.
    case "hashTrieMix":
      return [
        `const ${name} = (() => {`,
        `  const __seed = (${spell("Math")}.random() * 0x100000000) | 0;`,
        `  return __value => ${spell("Math")}.imul(__value ^ __seed, 0x9e3779b1) | 0;`,
        "})();",
      ];
    // The debug probe (#407), and the sibling of the mix above in the one
    // respect that matters: the world is touched **once**, when the emitted
    // module is evaluated, and the call path only uses what was taken then.
    // `spec/effects.md` §6.2 admits a console write as species (a) — a channel
    // no Hexagon expression can read back — and then makes the capture a
    // condition of the admission, because `console.log` is a replaceable global
    // and a lowering that dereferenced it per call would hand the program a way
    // to read its own probe back. What is captured is the bound method, so a
    // sink that expects its receiver still gets one.
    //
    // One parameter, not the host's variadic: the declared face is
    // `(message: String) -> Unit`, and a JavaScript caller reaching the
    // exported binding directly is held to it rather than to `console.log`'s
    // signature. `Unit` is `undefined` (Products §2.6), which is what the sink
    // answers anyway.
    case "debugLog":
      return [
        `const ${name} = (() => {`,
        `  const __sink = ${spell("console")}.log.bind(${spell("console")});`,
        "  return __message => { __sink(__message); };",
        "})();",
      ];
    // Population count of a 32-bit word, the SWAR form: pairs, then nibbles,
    // then bytes, then one multiply that sums the four byte counts into the top
    // byte. Four statements, which is why this is a helper and not the bare
    // arrow the rest of the bit family lowers to.
    case "bitCount":
      return [
        `function ${name}(__bitmap) {`,
        "  let __value = __bitmap - ((__bitmap >> 1) & 0x55555555);",
        "  __value = (__value & 0x33333333) + ((__value >> 2) & 0x33333333);",
        "  __value = (__value + (__value >> 4)) & 0x0f0f0f0f;",
        `  return ${spell("Math")}.imul(__value, 0x01010101) >> 24;`,
        "}",
      ];
    case "mixHash":
      return [
        `function ${name}(__seed, __value) {`,
        `  return ${spell("Math")}.imul(__seed ^ __value, 0x9e3779b1) | 0;`,
        "}",
      ];
    // The public `hash` member (#356). Collections Part 2 §2.3 binds it to one
    // law — `equals(x, y)` implies `hash(x) == hash(y)` — and §2.5's
    // `Hash<Float>` row names the two places `Eq<Float>` is neither the host's
    // `===` nor its `Object.is`: every `NaN` is one value, and `-0` is `+0`.
    // They diverge in opposite directions — `===` already agrees about the
    // zeroes, `Object.is` already agrees about `NaN` — which is why both halves
    // are discharged inside the number arm, and by different means.
    //
    // The NaN half is explicit: `Number.isNaN` catches every production of it
    // and answers one constant. The fold would deliver a single value on its own
    // too — every `NaN` stringifies to `"NaN"` — so the guard is not what makes
    // the law hold; it is cheaper than stringifying, and it makes the sameness
    // legible rather than an accident. (Which constant is nobody's business:
    // §2.2 promises the codomain and §2.3's law, no particular number.) The ±0
    // half has no such guard, and is the one that is easy to lose: it holds only
    // because `String(-0)` is `"0"` in JavaScript, so the two zeroes reach the
    // fold as the same text and come out the same number. There is nothing to
    // read here — the normalization *is* the stringification.
    //
    // So a numeric fast path added below (a bitwise mix, an integer shortcut)
    // must re-establish the ±0 half by hand, or it silently reopens #356. And
    // this is not `Float`'s obligation alone: `intHash` and `natHash` lower to
    // this same helper, and `Int` reaches `-0` at runtime through `0 * -1`.
    case "stableHash":
      return [
        `function ${name}(__value) {`,
        `  if (__value === ${spell("undefined")}) return 0;`,
        "  if (typeof __value === \"boolean\") return __value ? 1 : 2;",
        `  if (typeof __value === "number") { if (${spell("Number")}.isNaN(__value)) return 0x7fc00000; const __text = ${
          spell("String")
        }(__value); let __hash = 0; for (let __index = 0; __index < __text.length; __index += 1) __hash = ${
          spell("Math")
        }.imul(__hash, 31) + __text.charCodeAt(__index) | 0; return __hash; }`,
        `  const __text = ${
          spell("String")
        }(__value); let __hash = 0; for (let __index = 0; __index < __text.length; __index += 1) __hash = ${
          spell("Math")
        }.imul(__hash, 31) + __text.charCodeAt(__index) | 0; return __hash;`,
        "}",
      ];
    // Exceptions §7.2's construction helper. It is per-module precisely so the
    // brand can be baked in rather than passed: every exception it builds was
    // declared here, so `$hex` is this module's identity and never a parameter.
    case "exception":
      return [
        `function ${name}(__name, __message, __fields) {`,
        `  return ${spell("Object")}.assign(new ${spell("Error")}(__message), { $hex: ${
          JSON.stringify(identity)
        }, name: __name }, __fields);`,
        "}",
      ];
    case "floatEquals":
      return [
        `function ${name}(__left, __right) {`,
        `  return __left === __right || (${spell("Number")}.isNaN(__left) && ${
          spell("Number")
        }.isNaN(__right));`,
        "}",
      ];
    case "compareFloat":
      return [
        `function ${name}(__left, __right) {`,
        `  if (${spell("Number")}.isNaN(__left)) return ${spell("Number")}.isNaN(__right) ? 0 : 1;`,
        `  if (${spell("Number")}.isNaN(__right)) return -1;`,
        "  return __left < __right ? -1 : __left > __right ? 1 : 0;",
        "}",
      ];
    case "ordering":
      // The one representation (#275): every `compare` slot answers with an
      // `Ordering` value, which under Unions §6.2 is the constructor's own
      // name-string. The numeric comparators above are fast-path internals, so
      // this is the single place their sign crosses into the dictionary.
      return [
        `function ${name}(__sign) {`,
        '  return __sign < 0 ? "Less" : __sign > 0 ? "Greater" : "Equal";',
        "}",
      ];
    case "compareString":
      return [
        `function ${name}(__left, __right) {`,
        `  const __leftPoints = ${spell("Array")}.from(__left);`,
        `  const __rightPoints = ${spell("Array")}.from(__right);`,
        `  const __length = ${spell("Math")}.min(__leftPoints.length, __rightPoints.length);`,
        "  for (let __index = 0; __index < __length; __index += 1) {",
        "    const __leftPoint = __leftPoints[__index].codePointAt(0);",
        "    const __rightPoint = __rightPoints[__index].codePointAt(0);",
        "    if (__leftPoint < __rightPoint) return -1;",
        "    if (__leftPoint > __rightPoint) return 1;",
        "  }",
        "  return __leftPoints.length < __rightPoints.length ? -1 : __leftPoints.length > __rightPoints.length ? 1 : 0;",
        "}",
      ];
    case "range":
      return [
        `function ${name}(__start, __end) {`,
        "  return { start: __start, end: __end, descending: false,",
        `    *[${spell("Symbol")}.iterator]() {`,
        "      for (let __value = __start; __value <= __end; __value += 1) yield __value;",
        "    },",
        "  };",
        "}",
      ];
    // ---------------------------------------------------------------------
    // The vector bracket family (Collections Part 3 §5). Each is a bounds
    // assertion wrapped around one trie operation, and exists as a helper for
    // the reason it always did: a check followed by a return is *statements*,
    // which neither an expression position nor the arrow an intrinsic-door
    // binding is initialized with can hold.
    //
    // They build §5.5's `IndexError` payload directly rather than constructing
    // the `stdlib/Vector.hex` exception, and that is deliberate. The payload
    // (`$hex`, `name`, `index`, `size`) and the message are what every catch
    // site and every diagnostic test reads; routing them through the Hexagon
    // declaration would change both, for no gain — the trie carries no bounds
    // policy of its own, which is exactly why its `get`/`set` are documented as
    // caller-checked.
    //
    // **The brand is `"Vector"`, a literal, and belongs to the declaring module
    // rather than to the one this helper is emitted into** (Exceptions §7.1,
    // #488). A bounds check inlined into `client/report.hex` still raises
    // `Vector`'s `IndexError`, and a catch arm written `Vector.IndexError(…)`
    // anywhere tests `"Vector"`; branding the emitting module would put every
    // such arm permanently past it. The literal is safe because an injected
    // module brands its **canonical injected name** wherever in a project its
    // file sits, so `stdlib/Vector.hex` and an embedded `Vector.hex` agree.
    // `SliceError` below, `mapIndex`'s `KeyError` and `seqFromIterable`'s
    // `ReentrancyError` are the same rule at `"Vector"`, `"Map"` and `"Seq"`.
    case "vectorIndex":
      return [
        `function ${name}(__values, __index) {`,
        `  const __size = ${runtimeName("size")}(__values);`,
        `  if (__index < 1 || __index > __size) { const __error = new ${spell("RangeError")}` +
        "(`index ${__index} out of bounds for size ${__size}`); __error.name = \"IndexError\"; __error.$hex = \"Vector\"; __error.index = __index; __error.size = __size; throw __error; }",
        `  return ${runtimeName("get")}(__values, __index - 1);`,
        "}",
      ];
    case "vectorAt":
      return [
        `function ${name}(__values, __index) {`,
        `  const __size = ${runtimeName("size")}(__values);`,
        "  const __position = __index < 0 ? __size + __index + 1 : __index;",
        `  if (__position < 1 || __position > __size) { const __error = new ${spell("RangeError")}` +
        "(`index ${__index} out of bounds for size ${__size}`); __error.name = \"IndexError\"; __error.$hex = \"Vector\"; __error.index = __index; __error.size = __size; throw __error; }",
        `  return ${runtimeName("get")}(__values, __position - 1);`,
        "}",
      ];
    case "vectorOf":
      // The literal `[a, b, c]` (§2) and `Vector.fromSeq` (§7.2) are one
      // operation over two sources: fold `append` over anything iterable. Both
      // are eager, and `fromSeq` on an infinite `Seq` diverges here, as §7.2
      // says it does.
      return [
        `function ${name}(__source) {`,
        `  let __result = ${runtimeName("empty")};`,
        `  for (const __value of __source) __result = ${runtimeName("append")}(__result, __value);`,
        "  return __result;",
        "}",
      ];
    case "vectorIterate":
      // The boundary traversal method every `TrieVector` carries, and the whole
      // of what makes `Vector<a> extends Iterable<a>` true: `for x in`, spread,
      // `Array.from`, `Map.fromVector`, `show`, and `hash` all reach a vector
      // through this and nothing else. Emitted only into the runtime module,
      // which is the only place a `TrieVector` is constructed.
      //
      // It walks *nodes*, not elements: `nodeRun` descends once per 32-element
      // leaf and reports how far that leaf reaches, so a whole traversal is
      // O(n). Reading element-at-a-time through `get` would be O(n log32 n) —
      // correct, and quietly worse on every loop a program writes.
      return [
        `function* ${name}() {`,
        `  const __size = ${runtimeName("size")}(this);`,
        "  let __index = 0;",
        "  while (__index < __size) {",
        `    const [__values, __offset, __run] = ${runtimeName("nodeRun")}(this, __index);`,
        "    for (let __step = 0; __step < __run; __step += 1) yield __values[__offset + __step];",
        "    __index += __run;",
        "  }",
        "}",
      ];
    case "hashTrieIterate":
      // The boundary traversal method every `HashTrie` carries (#370), and the
      // whole of what makes `Hex.Map<k, v> extends Iterable<[k, v]>` true:
      // `for (k, v) in m`, spread, `show`, `hash`, and the derived `Eq`'s left
      // walk all reach a map through this and nothing else. Emitted only into
      // the runtime module, which is the only place a `HashTrie` is constructed.
      //
      // Unlike the vector's, this one delegates: `entries` is the module's own
      // lazy depth-first walk with an explicit frame stack, so re-deriving the
      // traversal here would mean a second implementation of the same walk with
      // the same suspension problem, and the `Seq` driver already exists to turn
      // one into an iterator. It is O(n) over the whole traversal, which is what
      // Collections Part 4 §2.2's iteration row asks for.
      return [
        `function* ${name}() {`,
        `  yield* ${dependencyName("seqToIterable")}(${hashTrieName("entries")}(this));`,
        "}",
      ];
    case "hashSetIterate":
      // The boundary traversal method every `HashSet` carries (#373), and the
      // whole of what makes `Hex.Set<a> extends Iterable<a>` true: `for x in s`,
      // spread, `show`, `hash`, and the derived `Eq`'s left walk all reach a set
      // through this and nothing else. Emitted only into the runtime module,
      // which is the only place a `HashSet` is constructed.
      //
      // **This is why the wrapper record exists.** It delegates to `members`,
      // the wrapper's own key-projected walk, rather than to `entries`; a
      // `Set(a)` that were literally its inner trie would have carried
      // `hashTrieIterate` and yielded `[element, ()]` pairs across the boundary,
      // which is `Hex.Map`'s contract and a lie about this type.
      return [
        `function* ${name}() {`,
        `  yield* ${dependencyName("seqToIterable")}(${hashTrieName("members")}(this));`,
        "}",
      ];
    case "mapIndex":
      // The bracket, `m[k]` (Collections Part 4 §4.1): assert presence, throw
      // `KeyError` on absence. A helper for `vectorIndex`'s reason — a check
      // followed by a return is *statements* — and it builds §4.3's payload
      // directly rather than constructing `stdlib/Map.hex`'s exception, exactly
      // as the vector family builds `IndexError`'s. The trailing parameter is
      // the key's `Hash` evidence, which the trie's `get` takes because its
      // declaration is `<k: Hash>`.
      //
      // `KeyError` is **nullary** by ruling: a polymorphic key cannot be a
      // payload slot (Exceptions §2), so no field is set beyond the two every
      // Hexagon exception carries. The key does reach the *message*, which §4.3
      // licenses as a non-normative best-effort rendering — programs must not
      // parse it — and `String(key)` is what a rendering with no `Show`
      // evidence in hand can honestly do.
      return [
        `function ${name}(__map, __key, __hash) {`,
        `  const __found = ${hashTrieName("get")}(__map, __key, __hash);`,
        '  if (__found.tag === "Some") return __found.value;',
        `  const __error = new ${spell("Error")}` + "(`no value for key ${" + spell("String") +
        "(__key)}`);",
        '  __error.name = "KeyError";',
        '  __error.$hex = "Map";',
        "  throw __error;",
        "}",
      ];
    case "mapEquals":
      // Collections Part 4 §8.1's extensional `Eq`, re-lowered over the trie
      // (#370): equal sizes, and every entry of the left found in the right at
      // an `equals`-equal value. The left walk is the iteration face and the
      // right probe is the trie's own `get`, so nothing here knows the
      // representation beyond `.size` and being iterable.
      //
      // Order-independence is not arranged, it is what the definition says
      // (§8.1) — two maps with different construction histories may iterate
      // differently and still be equal, which is exactly what a probe-the-other
      // walk delivers and a positional one would not.
      return [
        `function ${name}(__hash, __valueEq, __left, __right) {`,
        "  if (__left.size !== __right.size) return false;",
        "  for (const [__key, __value] of __left) {",
        `    const __found = ${hashTrieName("get")}(__right, __key, __hash);`,
        '    if (__found.tag !== "Some") return false;',
        "    if (!__valueEq.equals(__value, __found.value)) return false;",
        "  }",
        "  return true;",
        "}",
      ];
    case "mapHash":
      // Collections Part 4 §8.4's `Hash`, re-lowered over the trie (#370). The
      // combine is unchanged: each entry's key and value are mixed *order
      // sensitively within the pair*, and the entry hashes are summed, which is
      // invariant under every permutation of the entries. §8.4 forces that — the
      // public `hash` member is deterministic and unseeded while iteration order
      // is seeded, so an order-sensitive fold would make `hash(m)` a per-process
      // value and break the member's own contract.
      return [
        `function ${name}(__keyHash, __valueHash, __map) {`,
        "  let __result = __map.size | 0;",
        "  for (const [__key, __value] of __map) {",
        `    __result = (__result + ${dependencyName("mixHash")}(` +
          "__keyHash.hash(__key), __valueHash.hash(__value))) | 0;",
        "  }",
        "  return __result;",
        "}",
      ];
    case "setEquals":
      // Collections Part 4 §8.1's extensional `Eq`, re-lowered over the wrapper
      // (#373) — `mapEquals`' shape with the value comparison gone, because a
      // set's elements are its keys and there is nothing else to agree about.
      // Equal sizes, and every element of the left found in the right.
      //
      // The size read is `memberCount` rather than a `.size` field: a `HashSet`
      // holds one field, `trie`, and the maintained count lives inside it. The
      // membership probe is the wrapper's own `containsMember`, whose trailing
      // argument is the element's `Hash` evidence because its declaration is
      // `<a: Hash>`.
      //
      // Order-independence is not arranged, it is what the definition says
      // (§8.1): two sets built in different orders may iterate differently and
      // still be equal, which is what a probe-the-other walk delivers.
      return [
        `function ${name}(__hash, __left, __right) {`,
        `  if (${hashTrieName("memberCount")}(__left) !== ` +
          `${hashTrieName("memberCount")}(__right)) return false;`,
        "  for (const __element of __left) {",
        `    if (!${hashTrieName("containsMember")}(__right, __element, __hash)) return false;`,
        "  }",
        "  return true;",
        "}",
      ];
    case "setHash":
      // Collections Part 4 §8.4's `Hash`, re-lowered over the wrapper (#373).
      // The combine is `mapHash`'s with one component instead of two: each
      // element's hash is mixed with a fixed salt and the results are summed,
      // which is invariant under every permutation of the elements. §8.4 forces
      // that — the public `hash` member is deterministic and unseeded while
      // iteration order is seeded, so an order-sensitive fold would make
      // `hash(s)` a per-process value and break the member's own contract.
      return [
        `function ${name}(__elementHash, __set) {`,
        `  let __result = ${hashTrieName("memberCount")}(__set) | 0;`,
        "  for (const __element of __set) {",
        `    __result = (__result + ${dependencyName("mixHash")}(` +
          "0x51ed270b, __elementHash.hash(__element))) | 0;",
        "  }",
        "  return __result;",
        "}",
      ];
    case "nodeSet":
      // Copy-on-write a fixed-32 trie node; slots are raw (0-based, no bounds
      // check) because only trusted runtime trie code ever emits this.
      return [
        `function ${name}(__node, __index, __value) {`,
        "  const __updated = __node.slice();",
        "  __updated[__index] = __value;",
        "  return __updated;",
        "}",
      ];
    case "vectorSet":
      return [
        `function ${name}(__values, __index, __value) {`,
        `  const __size = ${runtimeName("size")}(__values);`,
        `  if (__index < 1 || __index > __size) { const __error = new ${spell("RangeError")}` +
        "(`index ${__index} out of bounds for size ${__size}`); __error.name = \"IndexError\"; __error.$hex = \"Vector\"; __error.index = __index; __error.size = __size; throw __error; }",
        `  return ${runtimeName("set")}(__values, __index - 1, __value);`,
        "}",
      ];
    case "vectorSlice":
      // §6.2: direction faults, magnitude clamps. The clamping is the trie's
      // `window`, so the 1-based-to-0-based shift is all this adds — the
      // "single call with zero guard code" the spec pins, modulo the offset.
      return [
        `function ${name}(__values, __range) {`,
        `  if (__range.descending) { const __error = new ${spell("RangeError")}` +
        "(\"a slice window cannot descend\"); __error.name = \"SliceError\"; __error.$hex = \"Vector\"; __error.start = __range.start; __error.end = __range.end; throw __error; }",
        `  return ${runtimeName("window")}(__values, __range.start - 1, __range.end);`,
        "}",
      ];
    // ---------------------------------------------------------------------
    // String indexing (§9) reads the *same* doctrine over a different
    // representation: 1-based, codepoint-addressed, `IndexError` on the
    // bracket, clamping windows, `SliceError` on direction. It used to reach
    // the vector helpers over a codepoint array, and stopped when `Vector(a)`
    // became a trie — a string is not one, and `Array.from` of one is not a
    // vector. The duplicated bounds arithmetic below is the price of that, and
    // the honest price: these two are the only place the array reading lives
    // now, so nothing about them can drift when the trie changes.
    case "stringIndex":
      return [
        `function ${name}(__text, __index) {`,
        `  const __points = ${spell("Array")}.from(__text);`,
        `  if (__index < 1 || __index > __points.length) { const __error = new ${
          spell("RangeError")
        }` +
        "(`index ${__index} out of bounds for size ${__points.length}`); __error.name = \"IndexError\"; __error.$hex = \"Vector\"; __error.index = __index; __error.size = __points.length; throw __error; }",
        "  return __points[__index - 1];",
        "}",
      ];
    case "stringSlice":
      return [
        `function ${name}(__text, __range) {`,
        `  if (__range.descending) { const __error = new ${spell("RangeError")}` +
        "(\"a slice window cannot descend\"); __error.name = \"SliceError\"; __error.$hex = \"Vector\"; __error.start = __range.start; __error.end = __range.end; throw __error; }",
        `  return ${spell("Array")}.from(__text).slice(${spell("Math")}.max(0, __range.start - 1), ${
          spell("Math")
        }.max(0, __range.end)).join("");`,
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
      // readers of `__ended` would do anything else with a truthy `done`;
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
      // The adapter keeps `__source` and the iterator it acquired from it,
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
      // `SliceError` are: exception identity is the (module, name) pair — `name`
      // under the declaring module's `$hex` brand, `"Seq"` here (#488) — chosen
      // over prototype identity precisely so that every module's copy of this
      // helper and the one `.hex` declaration coincide on one nominal exception. Fresh per refusal (§7.3 of Exceptions), so the stack points
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
        `function ${name}(__source) {`,
        `  let __iterator = ${spell("undefined")};`,
        "  let __forcing = false;",
        "  const __node = () => {",
        `    let __step = ${spell("undefined")};`,
        `    let __failure = ${spell("undefined")};`,
        "    return {",
        `      [${spell("Symbol")}.iterator]: ${dependencyName("seqIterate")},`,
        "      pull: () => {",
        `        if (__step === ${spell("undefined")} && __failure === ${spell("undefined")}) {`,
        "          if (__forcing) {",
        `            throw ${spell("Object")}.assign(new ${
          spell("Error")
        }("Seq position is already being forced: a sequence position cannot depend on its own value"), { $hex: "Seq", name: "ReentrancyError" });`,
        "          }",
        "          __forcing = true;",
        "          try {",
        `            if (__iterator === ${spell("undefined")}) __iterator = __source[${
          spell("Symbol")
        }.iterator]();`,
        "            const __next = __iterator.next();",
        '            if (__next === null || (typeof __next !== "object" && typeof __next !== "function")) {',
        `              throw new ${spell("TypeError")}("Iterator result " + ${
          spell("String")
        }(__next) + " is not an object");`,
        "            }",
        `            __step = ${spell("Boolean")}(__next.done)`,
        '              ? { tag: "None" }',
        '              : { tag: "Some", value: [__next.value, __node()] };',
        "          } catch (__error) {",
        "            __failure = { error: __error };",
        "            throw __error;",
        "          } finally {",
        "            __forcing = false;",
        "          }",
        "        }",
        `        if (__failure !== ${spell("undefined")}) throw __failure.error;`,
        "        return __step;",
        "      },",
        "    };",
        "  };",
        "  return __node();",
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
        `function ${name}(__source) {`,
        `  return ${dependencyName("seqFromIterable")}(${dependencyName("seqToIterable")}(__source));`,
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
        `  const __views = new ${spell("WeakMap")}();`,
        "  return function () {",
        "    let __view = __views.get(this);",
        `    if (__view === ${spell("undefined")}) {`,
        `      __view = ${dependencyName("seqFromIterable")}(${dependencyName("seqToIterable")}(this));`,
        "      __views.set(this, __view);",
        "    }",
        `    return ${dependencyName("seqToIterable")}(__view)[${spell("Symbol")}.iterator]();`,
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
        `function ${name}(__value) {`,
        '  return __value != null && typeof __value.pull === "function"',
        "    ? __value",
        `    : ${dependencyName("seqFromIterable")}(__value);`,
        "}",
      ];
    case "streamInbound":
      // **The raw crossing** (FFI Part 3 §14.1) — the shim, and everything the
      // §2 adapter is not. Position declares intent: the same foreign object at
      // a `Seq(a)` position is laundered into replayable pure data, and here it
      // is left exactly as impure as it is.
      //
      // **Iterable or bare iterator.** `Seq`'s iterable-only rule (§9.2) is
      // grounded in replay obligations a `Stream` does not have, so a
      // single-pass cursor is admitted as the shape it already is. The iterator
      // is requested from an iterable **once, at the crossing** rather than
      // deferred to the first pull as §3 defers the adapter's — §14.1 says at
      // the crossing, and a per-crossing shim has a crossing to say it at.
      //
      // **No memoization spine, no failure memo, no latch, no history.** One
      // foreign step per pull, and nothing carried between them. In particular
      // an exhausted stream is *not* latched to `None`: what the next pull
      // observes is whatever the foreign cursor does next, which is §2.1's
      // posture verbatim — the boundary preserves the source's behavior rather
      // than strengthening it. A source that misbehaves after exhaustion is
      // Part 1 §3.1 territory, exactly as it would be to a JavaScript consumer.
      // A foreign throw propagates out of that pull through the ordinary
      // `JsError` path and nothing is remembered.
      //
      // **`return()` is never called** (§14.1's last line; §8's posture
      // inherited). And there is no recognition check for a Hexagon `Stream`
      // arriving home: §14.2 rules the round trip a composition that preserves
      // semantics rather than identity, so the door shims whatever it is given.
      //
      // The protocol check and its access order are §7.2's, at their minimum
      // and shared verbatim with the adapter: `next()` once, an object result
      // or a `TypeError`, `done` read once and boolean-coerced, and `value`
      // read only when `done` was false.
      return [
        `function ${name}(__source) {`,
        "  const __iterator =",
        `    __source != null && typeof __source[${spell("Symbol")}.iterator] === "function"`,
        `      ? __source[${spell("Symbol")}.iterator]()`,
        "      : __source;",
        "  return {",
        "    next: () => {",
        "      const __step = __iterator.next();",
        '      if (__step === null || (typeof __step !== "object" && typeof __step !== "function")) {',
        `        throw new ${spell("TypeError")}("Iterator result " + ${
          spell("String")
        }(__step) + " is not an object");`,
        "      }",
        `      if (${spell("Boolean")}(__step.done)) return { tag: "None" };`,
        '      return { tag: "Some", value: __step.value };',
        "    },",
        "  };",
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
        `function ${name}(__sequence) {`,
        "  return {",
        `    *[${spell("Symbol")}.iterator]() {`,
        "      let __current = __sequence;",
        "      while (true) {",
        "        const __step = (__current.pull)();",
        '        if (__step.tag !== "Some") return;',
        "        yield __step.value[0];",
        "        __current = __step.value[1];",
        "      }",
        "    },",
        "  };",
        "}",
      ];
    case "streamFromSeq":
      // `stream.md` §4.3's door: the cursor is the cross-call state a Hexagon
      // lambda cannot hold (Statements §6.2), so it lives here, in the one
      // closure the record's field reads.
      //
      // Two properties the module's contract rests on. **A pull is one step**:
      // the successor is stored and the head returned, so the derived stream
      // advances exactly as `stream.md` §1 says a stream does — there is no
      // tail to hand out. And **an exhausted stream keeps answering `None`**
      // (§2): the cursor is left standing at the position that ended, and
      // re-deriving a pure `Seq` position gives the same answer, so every later
      // pull ends again rather than restarting or throwing.
      //
      // No memoization and no view: the source is a `Seq` and already owns
      // whatever persistence it has. Driving `pull` rather than composing
      // `seqToIterable` is deliberate — a generator would be a second traversal
      // to hold, where the whole shape here is one position at a time.
      return [
        `function ${name}(__sequence) {`,
        "  let __current = __sequence;",
        "  return {",
        "    next: () => {",
        "      const __step = (__current.pull)();",
        '      if (__step.tag !== "Some") return { tag: "None" };',
        "      __current = __step.value[1];",
        '      return { tag: "Some", value: __step.value[0] };',
        "    },",
        "  };",
        "}",
      ];
  }
}

/**
 * The primitive an evidence value's instance is honored at, or `undefined`.
 *
 * One reader for the two shapes a primitive instance now takes: the wired rows
 * of the companions that have not migrated (`PrimitiveEvidence`), and the source
 * `honor` blocks of the ones that have, which are ordinary `InstanceEvidence`
 * carrying the primitive alongside their dictionary (#344).
 *
 * Every call site of this function is a **call-site inlining** — Constraints
 * §6.1's "the monomorphic lowering tables … remain true as inlining of the
 * door-backed slots". Materializing a whole dictionary is deliberately not one
 * of them: that reads `#emitEvidence`, where a migrated companion's dictionary
 * is the source instance's and nothing is inlined, because a second dictionary
 * literal would be a second definition rather than a rendering of one.
 */
/**
 * The constraint members whose call at a known primitive instance emits as a
 * JavaScript operator rather than as a dictionary slot read.
 *
 * Exactly the arms of `#emitConstraintCall`'s switch, and deliberately not one
 * more: `div`, `mod`, `quot`, `rem`, and `gcd` have no operator to be, and their
 * implementation is `stdlib/BigInt.hex`'s source, so a member outside this list
 * reaches its instance the ordinary way.
 */
const INLINED_OPERATOR_MEMBERS: readonly string[] = [
  "negate",
  "add",
  "subtract",
  "multiply",
  "divide",
  "concat",
  "pow",
];

/**
 * The primitives whose instances are source `honor` blocks (#344), read from
 * the one list that decides it so the two cannot drift. With the last landing
 * that is all of them, which is exactly why the set still earns its keep: it
 * names the primitives whose dictionary must have arrived from their own
 * module, so `#emitEvidence` can say which failure it is looking at instead of
 * emitting an empty object and letting a `TypeError` report it later.
 */
const MIGRATED_COMPANIONS: ReadonlySet<string> = new Set(
  PRIMITIVE_COMPANION_BASENAMES.values(),
);

function primitiveInstance(evidence: Core.Evidence): Typed.PrimitiveName | undefined {
  if (evidence.kind === "Primitive") return evidence.instance;
  return evidence.kind === "Instance" ? evidence.primitive : undefined;
}

/**
 * Whether this evidence tree is **ground** — Dictionary Sharing §4's condition
 * for hoisting: an instance application whose leaves are named instances or
 * primitive dictionaries, with no free evidence parameter anywhere in it.
 *
 * `Dictionary` evidence is the free parameter itself and is what §3.3 keeps at
 * the call. `Error` evidence never hoists, by the same section.
 *
 * `Structural` evidence joins through §3.4, and its groundness is two
 * conditions rather than one. The components' own trees must be ground, as for
 * an application's arguments — that is the condition §3.4 states, and it is what
 * excludes a tuple inside a polymorphic body whose element evidence is the
 * body's evidence parameter. But it is not sufficient on its own, because a
 * structural node's rendering is a *walk over its type*, not an application of
 * its components: a node the checker recorded no component demand for (the
 * `Bool` pin, `Concat<Vector(a)>`, and the `Iterable` provided rows)
 * vacuously satisfies "all components ground" while the walk beneath it still
 * reaches `#dictionary` at every `Variable` it meets — a free evidence
 * parameter, in a module-level initializer. So the type must be variable-free
 * too, which is the invariant that actually holds the hoist up: a hoisted
 * initializer references only module-level names.
 */
function isGroundEvidence(evidence: Core.Evidence): boolean {
  if (evidence.kind === "Primitive") return true;
  if (evidence.kind === "Structural") {
    return isGroundType(evidence.type) &&
      evidence.components.every(({ evidence: component }) => isGroundEvidence(component));
  }
  if (evidence.kind !== "Instance") return false;
  return evidence.arguments.every(({ evidence: argument }) => isGroundEvidence(argument));
}

/**
 * Whether a derived walk over this type can reach no type variable — the second
 * half of a structural node's groundness (see `isGroundEvidence`).
 *
 * A record's row tail counts as a variable even though the walks never consult
 * it: an open row is not a ground type, and refusing to hoist one costs a
 * duplicated literal where admitting one wrongly would cost a `ReferenceError`.
 * `Error` is refused with it — §4's "error evidence never hoists", read through
 * the type the walk would have been over.
 */
function isGroundType(type: Typed.Type): boolean {
  switch (type.kind) {
    case "Variable":
    case "Error":
      return false;
    case "Primitive":
    case "Range":
    case "ExternType":
      return true;
    case "Vector":
    case "Set":
    case "Array":
    case "JsSet":
    case "Node":
      return isGroundType(type.element);
    case "Nullable":
      return isGroundType(type.value);
    case "Map":
    case "JsMap":
      return isGroundType(type.key) && isGroundType(type.value);
    case "Tuple":
      return type.elements.every(isGroundType);
    case "Record":
      return type.tail === undefined && type.fields.every(({ type: field }) => isGroundType(field));
    case "Union":
    case "NominalRecord":
      return type.arguments.every(isGroundType);
    case "Function":
      return type.parameters.every(isGroundType) && isGroundType(type.result);
  }
}

/** One ground type, serialized for `#structuralEvidenceKey`. */
function serializeType(type: Typed.Type): string {
  switch (type.kind) {
    case "Primitive":
      return type.name;
    case "Range":
      return "Range";
    case "Vector":
    case "Set":
    case "Array":
    case "JsSet":
    case "Node":
      return `${type.kind}(${serializeType(type.element)})`;
    case "Nullable":
      return `Nullable(${serializeType(type.value)})`;
    case "Map":
    case "JsMap":
      return `${type.kind}(${serializeType(type.key)},${serializeType(type.value)})`;
    case "Tuple":
      return `(${type.elements.map(serializeType).join(",")})`;
    case "Record":
      return `{${
        [...type.fields]
          .map(({ name, type: field }) => `${name}:${serializeType(field)}`)
          .sort()
          .join(",")
      }${type.tail === undefined ? "" : `|${Number(type.tail)}`}}`;
    // The identity, never the name: a module that declares its own `Bool` has
    // not declared the prelude's, the same test `#groundFundamental` makes.
    case "Union":
      return `U${Number(type.union)}(${type.arguments.map(serializeType).join(",")})`;
    case "NominalRecord":
      return `R${Number(type.record)}(${type.arguments.map(serializeType).join(",")})`;
    case "ExternType":
      return `X${Number(type.externType)}`;
    case "Function":
      return `(${type.parameters.map(serializeType).join(",")})->${serializeType(type.result)}`;
    case "Variable":
      return `v${Number(type.id)}`;
    case "Error":
      return "!";
  }
}

/**
 * A structural dictionary's contribution to its binding's spelling (Dictionary
 * Sharing §5): "flattens the way the type is spelled" — `__Show_Unit`, and a
 * tuple contributing its element spellings in order, `__Show_Int_Int` for
 * `Show<(Int, Int)>`.
 *
 * The anonymous constructor contributes nothing, exactly as it contributes
 * nothing to the type's spelling: a tuple is written as the parameter list it
 * reifies, and `Unit` is the arity-0 tuple, so it is the one tuple with a name
 * to give. Nesting makes this flattening non-injective — `((Int, Int), Int)` and
 * `(Int, (Int, Int))` both spell `Int_Int_Int` — and §5's collision rule absorbs
 * it with the rest, `GeneratedNames` supplying the probe.
 */
function flattenTypeSpelling(type: Typed.Type): readonly string[] {
  switch (type.kind) {
    case "Primitive":
      return [type.name];
    case "Range":
      return ["Range"];
    case "Vector":
    case "Set":
    case "Array":
    case "JsSet":
    case "Node":
      return [type.kind, ...flattenTypeSpelling(type.element)];
    case "Nullable":
      return ["Nullable", ...flattenTypeSpelling(type.value)];
    case "Map":
    case "JsMap":
      return [type.kind, ...flattenTypeSpelling(type.key), ...flattenTypeSpelling(type.value)];
    case "Tuple":
      return type.elements.length === 0
        ? ["Unit"]
        : type.elements.flatMap(flattenTypeSpelling);
    case "Record":
      return [...type.fields].map(({ name }) => name).sort();
    case "Union":
    case "NominalRecord":
      return [type.name, ...type.arguments.flatMap(flattenTypeSpelling)];
    case "ExternType":
      return [type.name];
    // Unreachable behind `isGroundType`, and spelled rather than thrown on so
    // that a future caller outside the hoist path gets a name instead of a crash.
    case "Function":
    case "Variable":
    case "Error":
      return [];
  }
}

/**
 * One argument dictionary's contribution to a hoisted binding's spelling
 * (Dictionary Sharing §5): "the factory's name followed by the flattened
 * spelling of its argument instances", so `__Render_Box(__Render_Int)` is
 * `__Render_Box_Int`.
 *
 * The constraint segment is dropped because the factory already carries it —
 * repeating it would spell `__Render_Box_Render_Int`. Dropping it is what makes
 * the flattening non-injective, which is exactly the non-injectivity §5's
 * collision rule exists to absorb, and `GeneratedNames` supplies the probe.
 */
function flattenDictionarySpelling(name: string): string {
  const stripped = name.startsWith("__") ? name.slice(2) : name;
  const separator = stripped.indexOf("_");
  return separator < 0 ? stripped : stripped.slice(separator + 1);
}

/**
 * The key under which a factory body's own identity arrangement is registered
 * in `EvidenceNames`, so §3.2's replacement is a lookup rather than a re-walk.
 *
 * Held in the same map as the evidence *parameters* because it answers the same
 * question — "what does this module already have a name for?" — and namespaced
 * apart from `evidenceKey`, whose spellings all begin with a digit.
 */
function selfEvidenceKey(rendering: string): string {
  return `self:${rendering}`;
}

/**
 * Whether a derived container's component evidence is one the container must
 * **dispatch** to rather than re-derive (#278) — a nominal instance, or a
 * binder's dictionary parameter.
 *
 * An instance honored at a primitive is not one of those. Its evidence became
 * an ordinary `Instance` when that primitive's companion migrated (#344), but
 * the leaf arms of the four derived walks — `#derivedEquals`, `#derivedCompare`,
 * `#derivedShow`, `#derivedHash` (#609) — are
 * that instance rendered, not a second definition of it — Constraints §6.1's
 * last sentence, the same licence `#emitConstraintCall` takes for `+` and
 * `#emitComparison` for `<`. #278's hazard was a hand-written *component*
 * instance being bypassed, and a primitive has exactly one instance to bypass.
 *
 * `Dictionary` joins it (#669). The walks' `Variable` arms rebuild the reference
 * from the component's `type.id` under the walk's own constraint, which is the
 * recorded node only when the binder demands that constraint directly; where a
 * user base constraint entails it — `constraint Wide<a: Hash>` — the recording
 * carries the constraint the binder was written with and the entailment path
 * through it, and the rebuild named a dictionary that does not exist. There is
 * no primitive concern to weigh here: a `Dictionary` node is a parameter, and
 * `#emitEvidence` renders it as the same reference the arms wrote, plus the
 * path they dropped.
 */
function componentDispatch(
  evidence: Core.Evidence | undefined,
): evidence is Core.InstanceEvidence | Core.DictionaryEvidence {
  if (evidence?.kind === "Dictionary") return true;
  return evidence?.kind === "Instance" && evidence.primitive === undefined;
}

class GeneratedNames {
  readonly #used: Set<string>;

  constructor(existing: Iterable<string>) {
    // The reserved captures are seeded whether or not this module is contested
    // (FFI Part 7 §1.2): in a contested one they are real `import` bindings a
    // minted name would redeclare, and seeding them unconditionally keeps the
    // mint's answers a function of the module's own names rather than of a
    // condition settled elsewhere.
    this.#used = new Set([...RESERVED_CAPTURES.map(reservedCapture), ...existing]);
  }

  /**
   * One name per stem, minted once and asked for by name afterwards — a helper
   * function, a runtime import's local.
   */
  fixed(stem: string): string {
    return this.#claim(stem);
  }

  /**
   * A new binder under this stem. The first one gets the bare spelling and the
   * next takes the probe's `_1` — the *same* mechanism as `fixed`, since a
   * second `fresh("match")` is exactly an occupied preferred spelling (#425).
   * The counter this replaced started at 0 and glued its digit on, so the first
   * `match` was `__match0` and the first `arg0` was `__arg00`.
   */
  fresh(stem: string): string {
    return this.#claim(stem);
  }

  /**
   * A **public** spelling this module wants to bind — a fundamental
   * specialization's exported name, a §8.2 companion operation's local, which is
   * a source-level name rather than a reserved one (#440, #585). The bare
   * spelling when nothing here holds it, and the reserved probe when something
   * does: the source's own binding owns the public name, and an imported edition
   * is what moves aside.
   *
   * **The runtime vocabulary and JavaScript's reserved words move it aside too**
   * (FFI Part 7 §1.2 rule 1, #666). This is the one seat at which a compiler-
   * minted `.js` import local can mirror an export's spelling, so it is the whole
   * population that could contest: a companion export named `undefined` or
   * `await` is legal Hexagon, and a minted local under either spelling would
   * capture the module's own runtime text or fail to parse at all. Nothing user-
   * written is at stake here, which is why a minted local moves for *either*
   * class where a source-written import local moves only for the second (rule 4)
   * and the module qualifies around the first (rule 2).
   */
  claimPublic(name: string): string {
    if (this.#used.has(name) || MINTED_LOCAL_HAZARDS.has(name) || reservedWords.has(name)) {
      return this.#claim(name);
    }
    this.#used.add(name);
    return name;
  }

  /**
   * A **generated** spelling arriving from another module — an imported member
   * seat (#444). `claimPublic`'s rule with the reserved prefix already on the
   * name: the bare spelling when nothing here holds it, and the family's own
   * probe when something does, over the stem rather than the whole name, since
   * re-prefixing would spell `____Show_Int_show`.
   */
  claimGenerated(name: string): string {
    if (!this.#used.has(name)) {
      this.#used.add(name);
      return name;
    }
    return this.#claim(name.startsWith("__") ? name.slice(2) : name);
  }

  /**
   * Lexer §3.2's reserved prefix, and the probe discipline under it: the
   * preferred spelling is `__<stem>`, and an occupied one probes numeric
   * suffixes from 1 — `__vectorSlice_1`, then `__vectorSlice_2` (#425).
   */
  #claim(stem: string): string {
    const base = `__${stem}`;
    let name = base;
    let suffix = 1;
    while (this.#used.has(name)) name = `${base}_${suffix++}`;
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
    `const __order${index} = ${comparison}; if (__order${index} !== "Equal") return __order${index};`
  );
  return `(() => { ${statements.join(" ")} return "Equal"; })()`;
}


function evidenceKey(
  variable: Typed.TypeVariableId,
  constraint: Typed.ConstraintName,
): string {
  return `${Number(variable)}:${constraint}`;
}

/**
 * The home module's hoisted helper for a defaulted constraint member
 * (Constraints §6.5), named after the member so every inheriting instance — in
 * any module — spells the same one.
 *
 * Unconditional, and that is what makes it predictable across the boundary: an
 * importer reaches a helper through the constraint declaration alone, so it can
 * see nothing of the exporting module's terms and must be asked to see nothing.
 * The other two families probe around this one instead. The `default` marker is
 * load-bearing rather than decorative — a defaulted member of an exported
 * constraint exports both its forwarder and this helper off one symbol, so the
 * two spellings must differ.
 */
function defaultHelperName(member: string): string {
  return `__default_${member}`;
}

/** Lexer §3.2's probe: the preferred spelling, then numeric suffixes from 1. */
function probeInternalName(name: string, taken: ReadonlySet<string>): string {
  const base = `__${name}`;
  let spelling = base;
  let suffix = 1;
  while (taken.has(spelling)) spelling = `${base}_${suffix++}`;
  return spelling;
}

/**
 * Every internal export spelling one module publishes that is *not* a default
 * helper: the §6.5 forwarder of each member of its exported constraints, and
 * the trailing-evidence export of each constrained binding (FFI Part 7 §7).
 * Keyed by the source name, which is one namespace across both — a member and a
 * term of one module cannot share a spelling to begin with.
 *
 * The whole rule, in one place, run over `Resolved.InternalNameInputs`: the
 * exporting module builds those from its own items and an importer reads them
 * off the import, so "both sides agree" is a property of having one
 * implementation over one input rather than of two computations matching.
 *
 * Three families, ranked, each probing past a set the other side can compute:
 *
 * 1. **Helpers** keep `__default_<member>` outright — see `defaultHelperName`.
 * 2. **Forwarders** prefer `__<member>` and probe past the helpers and past
 *    every *other* member's preferred spelling. The second clause is what keeps
 *    a forwarder that has been pushed off its preferred name from landing on a
 *    sibling's: members `log` (defaulted), `default_log`, and `default_log_1`
 *    is the shape.
 * 3. **Terms** prefer `__<term>` and probe past the helpers, the *resolved*
 *    forwarders, and every other term's preferred spelling.
 *
 * That closes the namespace. Two preferred spellings never collide, because two
 * module-scope names never do. A probed spelling never sits on a preferred one
 * that survived: within a rank the siblings' preferred spellings are in the
 * avoid set, above it the resolved spellings are, and below it the lower rank
 * probes away in turn. And two probed spellings never collide across distinct
 * bases: both end in `_<digits>` with no interior underscore, so the last
 * underscore starts both suffixes, and equal strings force equal bases.
 *
 * `terms` deliberately holds every exported binding, not only the constrained
 * ones. An unconstrained export mints no spelling but still contests one, and
 * constrainedness lives in a scheme the resolver has not got — so counting all
 * of them is what lets both sides count the same heads.
 */
function internalNamePlan(
  inputs: Resolved.InternalNameInputs,
): ReadonlyMap<string, string> {
  const helpers = new Set(
    inputs.members
      .filter(({ defaulted }) => defaulted)
      .map(({ name }) => defaultHelperName(name)),
  );
  const plan = new Map<string, string>();
  const forwarders = new Set<string>();
  const memberNames = inputs.members.map(({ name }) => name);
  for (const name of memberNames) {
    const taken = new Set(helpers);
    for (const other of memberNames) if (other !== name) taken.add(`__${other}`);
    const spelling = probeInternalName(name, taken);
    plan.set(name, spelling);
    forwarders.add(spelling);
  }
  for (const name of inputs.terms) {
    const taken = new Set([...helpers, ...forwarders]);
    for (const other of inputs.terms) if (other !== name) taken.add(`__${other}`);
    plan.set(name, probeInternalName(name, taken));
  }
  return plan;
}

/**
 * The `Resolved.InternalNameInputs` this module's own output is named from.
 *
 * Item kind for item kind with the resolver's `internalNameInputs`, which is
 * what an importer is handed: the two walks are one rule read from two trees,
 * and a kind counted here but not there is exactly how the sides would drift.
 */
function ownInternalNameInputs(module: Core.Module): Resolved.InternalNameInputs {
  const members = module.items.flatMap((item) =>
    item.kind === "ConstraintDeclaration" && item.exported
      ? item.members.map(({ binding, defaultValue }) => ({
        name: binding.name,
        defaulted: defaultValue !== undefined,
      }))
      : []
  );
  const terms = module.items.flatMap((item) => {
    if (item.kind === "ExternBlock") {
      return item.declarations.flatMap((declaration) =>
        declaration.exported && declaration.kind !== "ExternType"
          ? [declaration.localName]
          : []
      );
    }
    return (item.kind === "Let" || item.kind === "Fun") && item.exported
      ? [item.binding.name]
      : [];
  });
  return { members, terms };
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

/**
 * The generated documentation an exported value's `.d.ts` face carries: its
 * Hexagon signature, when a TypeScript type cannot say what that signature says
 * (`spec/effects.md` §10, #364).
 *
 * The obligation is that a `.d.ts` face render the arrow trio, and the
 * TypeScript face cannot: `=>` is TypeScript's *only* function arrow, so
 * `(document: string) => void` is what a pure `->`, a linked `->?` and the
 * impure constant `->!` all come out as. The colours erase at emission (§8) and
 * nothing is proposed to change that; what is added is the one channel a
 * `.d.ts` has for saying something TypeScript's notation cannot — the JSDoc
 * block, where §7.3 of `spec/doc-comments.md` already provides for generated
 * content riding beside the author's.
 *
 * A face whose every arrow is pure gets nothing, and that is the doctrine
 * rather than a saving: purity is the silent one (§1), so a wholly pure corpus
 * emits declarations with no block of this kind anywhere in them.
 */
function hexagonFaceDoc(scheme: Typed.Scheme): readonly string[] {
  return Typed.carriesEffect(scheme.type)
    ? [`Hexagon: \`${Typed.displayScheme(scheme)}\``]
    : [];
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
  const quantified = Typed.quantifiedTypeVariables(scheme);
  const variables = typeVariableNames(quantified);
  const lambda = value?.kind === "Lambda" ? value : undefined;

  const genericNames = quantified.map((variable) => variables.get(variable)!);
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
  const quantified = Typed.quantifiedTypeVariables(declaration.binding.scheme);
  const variables = typeVariableNames(quantified);
  const genericNames = quantified.map((variable) => variables.get(variable)!);
  const generics = genericNames.length === 0 ? "" : `<${genericNames.join(", ")}>`;
  const parameters = declaration.parameters.map((parameter, index) =>
    `${names[index]}: ${renderType(parameter.scheme.type, variables, faces, false)}`
  );
  const result = renderType(declaration.result, variables, faces, true);
  const safe = isSafeIdentifier(declaration.localName);
  const local = safe
    ? declaration.localName
    : `__binding${Number(declaration.binding.symbol)}`;
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

  const quantified = Typed.quantifiedTypeVariables(scheme);
  const variables = typeVariableNames(quantified);
  const genericNames = quantified.map((variable) => variables.get(variable)!);
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
          // The brand carries the declaring module (#488), so the face that
          // admits *any* Hexagon exception says `string` — the same shape
          // `isHexError` narrows to (Exceptions §7.6).
          return `${faces.vocabulary.spell("Error")} ` +
            "& { readonly $hex: string; readonly name: string }";
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
      return `${faces.vocabulary.spell("ReadonlyArray")}<${
        renderType(type.element, variables, faces, false)
      }>`;
    case "JsMap":
    case "JsSet":
      // The borrowed views of native `Map`/`Set` (FFI Part 10 §1). Structural
      // like `Array` and for the same reason twice over: the value *is* the
      // caller's own `Map`/`Set`, so a brand would be a lie, and Hexagon exposes
      // no mutation on it, so the readonly spelling is the whole of what the
      // face has to say (§1's table).
      return type.kind === "JsSet"
        ? `${faces.vocabulary.spell("ReadonlySet")}<${
          renderType(type.element, variables, faces, false)
        }>`
        : `${faces.vocabulary.spell("ReadonlyMap")}<${
          renderType(type.key, variables, faces, false)
        }, ${renderType(type.value, variables, faces, false)}>`;
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
      //
      // §2.3's pins are settled **before the sink is asked**, so a qualified
      // `S.Bool` faces as `boolean` and imports nothing, exactly as a bare one
      // does: what the pin governs is the face, not the spelling that reached it.
      if (faces.prelude.bool !== undefined && type.union === faces.prelude.bool) return "boolean";
      return renderNominal(
        faces.nominals.reference({ kind: "union", id: type.union }, type.qualifier, type.name),
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
      //
      // The identity is asked of `pinnedRecord`, the one seat the pin lives at:
      // the home module's declaration seat aliases *this* spelling and declares
      // no brand (Part 7 §2.3, §14.5, #622), and a pin true here but false there
      // is the divergence this issue repaired.
      if (pinnedRecord(type.record, faces.prelude)) {
        return `${faces.vocabulary.spell("Iterable")}<${
          renderType(type.arguments[0] ?? { kind: "Error" }, variables, faces, false)
        }>`;
      }
      return renderNominal(
        faces.nominals.reference({ kind: "record", id: type.record }, type.qualifier, type.name),
        type.arguments,
        variables,
        faces,
      );
    case "ExternType":
      return faces.nominals.reference(
        { kind: "externType", id: type.externType },
        type.qualifier,
        type.name,
      );
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
      : `__binding${Number(binding.symbol)}`;
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

/**
 * One exception's `.d.ts` rows (Exceptions §7.5, FFI Part 7 §6): the branded
 * intersection type, the constructor JavaScript calls, and — for an exported
 * one — the `is` guard (§7.6, #478).
 *
 * The constructor is a **`declare function`**, not the `declare const` of an
 * arrow type, because that is what carries the guard: a namespace merges with a
 * function declaration and with nothing an initializer-less `const` can be, and
 * the merge is what types `ParseError.is` as a predicate so a consumer's branch
 * narrows to the intersection face. The two spellings are the same value to
 * every caller; only the declaration form differs.
 *
 * The brand literal is the declaring module's identity (#488) — the exact string
 * a JS constructor-writer copies, which is the reason §7.5 puts it in the face
 * at all.
 */
function renderExceptionDeclarations(
  item: Core.ExceptionItem,
  prefix: string,
  faces: DeclarationFaces,
): readonly string[] {
  const name = item.binding.name;
  const slot = (slot: Typed.ConstructorSlot): string =>
    `${slot.field}: ${renderType(slot.type, new Map(), faces, false)}`;
  // §1.1: the exception face is the vocabulary's sharpest seat. An `export
  // record Error` in this file silently intersects every one of these with the
  // user's record instead of the library's `Error`, and an exception *itself*
  // named `Error` makes the row a circular alias no TypeScript accepts.
  const face = `${faces.vocabulary.spell("Error")} & ` +
    `{ readonly $hex: ${JSON.stringify(item.owner)}` +
    `; readonly name: ${JSON.stringify(name)}` +
    `${item.slots.map((declared) => `; readonly ${slot(declared)}`).join("")} }`;
  const rows = [
    `${prefix}type ${name} = ${face};`,
    `${prefix}declare function ${name}(${item.slots.map(slot).join(", ")}): ${name};`,
  ];
  if (prefix === "") return rows;
  return [
    ...rows,
    `${prefix}declare namespace ${name} {`,
    `  function is(${GUARD_PARAMETER}: unknown): ${GUARD_PARAMETER} is ${name};`,
    "}",
  ];
}

/**
 * The stage-1 guard's `.d.ts` row (Exceptions §7.6, FFI Part 7 §6), emitted by a
 * module that exports at least one exception. Its predicate narrows an
 * `unknown` catch binding to the shape every Hexagon exception shares.
 */
function renderIsHexErrorDeclaration(faces: DeclarationFaces): string {
  // §1.1 reaches the guard as much as the faces: captured, its predicate narrows
  // a caught value to the *user's* type intersected with the brand shape, so a
  // consumer's `e.message` in the true branch stops typechecking — the guard is
  // degraded rather than broken, which is why it is pinned rather than assumed.
  return `export declare function ${IS_HEX_ERROR}(${GUARD_PARAMETER}: unknown): ` +
    `${GUARD_PARAMETER} is ${faces.vocabulary.spell("Error")}` +
    ` & { readonly $hex: string; readonly name: string };`;
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

/**
 * The same pattern with every vector sub-pattern that binds nothing replaced by
 * a wildcard.
 *
 * Only the `let` seat asks, and only because it drops the plan's tests: a
 * binding-less vector contributes a `__trieSize` length test and nothing else,
 * so planning it would put `size` on the module's runtime import list for an
 * operation the emitted code never calls. `[...]` and `_` accept every value
 * alike (Collections Part 3 §3.4), and any *other* binding-less vector pattern
 * has already been refused by Pattern Matching §5.3's gate, so the substitution
 * changes no accepted program's meaning.
 */
function withoutUnboundVectors(pattern: Core.Pattern): Core.Pattern {
  if (pattern.kind === "Vector" && patternBindings(pattern).length === 0) {
    return { kind: "Wildcard", span: pattern.span };
  }
  switch (pattern.kind) {
    case "As":
      return { ...pattern, pattern: withoutUnboundVectors(pattern.pattern) };
    case "Tuple":
      return { ...pattern, elements: pattern.elements.map(withoutUnboundVectors) };
    case "Vector":
      return {
        ...pattern,
        elements: pattern.elements.map(withoutUnboundVectors),
        ...(pattern.rest?.pattern === undefined
          ? {}
          : { rest: { ...pattern.rest, pattern: withoutUnboundVectors(pattern.rest.pattern) } }),
      };
    case "Record":
      return {
        ...pattern,
        fields: pattern.fields.map((field) => ({
          ...field,
          pattern: withoutUnboundVectors(field.pattern),
        })),
      };
    case "Constructor":
      return { ...pattern, arguments: pattern.arguments.map(withoutUnboundVectors) };
    case "Or":
      return { ...pattern, alternatives: pattern.alternatives.map(withoutUnboundVectors) };
    case "Binding":
    case "Wildcard":
    case "Unit":
    case "Integer":
    case "String":
      return pattern;
  }
}

/**
 * Whether a vector pattern occurs anywhere inside this one (Collections Part 3
 * §3.1's full nesting).
 *
 * The `let` seat asks it of the *whole* pattern rather than slot by slot,
 * because a JS destructuring is one expression: a single vector leaf anywhere
 * under it has no form to take there, so the whole pattern moves to the plan
 * (§3.6). The recursion mirrors `patternBindings`, since the two answer about
 * the same tree.
 */
function containsVectorPattern(pattern: Core.Pattern): boolean {
  switch (pattern.kind) {
    case "Vector":
      return true;
    case "Binding":
    case "Wildcard":
    case "Unit":
    case "Integer":
    case "String":
      return false;
    case "As":
      return containsVectorPattern(pattern.pattern);
    case "Or":
      return pattern.alternatives.some(containsVectorPattern);
    case "Tuple":
      return pattern.elements.some(containsVectorPattern);
    case "Record":
      return pattern.fields.some((field) => containsVectorPattern(field.pattern));
    case "Constructor":
      return pattern.arguments.some(containsVectorPattern);
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

/**
 * `a`, `b`, … `z`, then `a1` at the 27th binder: FFI Part 7 §2.2's binder
 * alphabet, not §2.1's probe. No universe is consulted — the alphabet cycles on
 * arity alone — so the digit is a cycle counter rather than a collision suffix,
 * and it rightly stays bare of #619's underscore.
 */
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

/**
 * The spellings JavaScript refuses as a binding name, which the emitter renames
 * around (FFI Part 7 §1.2 rule 4): a `__binding`-prefixed local, with the source
 * name restored at the export seat.
 *
 * `arguments` and `eval` are not keywords — they are the two names strict mode
 * refuses to bind, and an emitted module is always strict. They are as fatal as
 * the keywords are: the module never parses, so nothing in it runs.
 *
 * The rename is lawful at these seats and nowhere else, on a stated ground: an
 * internal alias leaks into a consumer's diagnostics exactly when it names a
 * *type* (measured, §14.7), every entry here is lowercase, and a Hexagon type
 * name is parser-gated uppercase — so a `__binding` alias can carry a value's
 * export seat but never a type's. An addition to this set must preserve that; it
 * is the lowercase gate, not the seat, doing the protecting.
 */
const reservedWords = new Set([
  "arguments",
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
  "eval",
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
