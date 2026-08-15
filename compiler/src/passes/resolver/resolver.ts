/**
 * The first resolver assigns stable identities to local bindings and replaces
 * textual references with those identities. It deliberately covers only the
 * binding forms admitted by the current parser: sequential lets and vars,
 * directly recursive functions, patterns, lambda parameters, and owner-relative
 * implied type names.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import {
  declaredConstraintIdentity,
  isPreRegisteredConstraint,
  NON_REDECLARABLE_CONSTRAINTS,
  PRE_REGISTERED_CONSTRAINT_MEMBERS,
  preRegisteredConstraintIdentity,
} from "../../constraints.js";
import {
  INTRINSIC_INVENTORY,
  INTRINSIC_SPECIFIER,
  isIntrinsicScheme,
  nearestIntrinsicKey,
} from "../../intrinsics.js";
import { relativeSpecifier } from "../../support/paths.js";
import type * as Source from "../../support/source.js";
import * as Parsed from "../../syntax/parsed/index.js";
import * as Resolved from "../../syntax/resolved/index.js";

export interface ModuleInterface {
  readonly module: Resolved.Module;
  readonly terms: ReadonlyMap<string, Resolved.Symbol>;
  readonly unions: ReadonlyMap<string, Resolved.Union>;
  readonly records: ReadonlyMap<string, Resolved.RecordDeclaration>;
  readonly aliases: ReadonlyMap<string, Resolved.TypeAliasItem>;
  readonly externTypes: ReadonlyMap<string, Resolved.ExternTypeDeclaration>;
  readonly instances: readonly InstanceInterface[];
  /**
   * Constraints this module exports, by declared name (Modules §4.1) — the ones
   * an importer may **name**, in a binder or through a module alias.
   */
  readonly constraints: ReadonlyMap<string, Resolved.ConstraintItem>;
  /**
   * The members of those constraints, by declared name (Modules §3.1: they
   * arrive with the constraint).
   *
   * Deliberately not folded into `terms`. A member is an ordinary module-scope
   * term once it is in scope, but it is not an independently importable export:
   * `import { describe }` naming only a member is refused (§3.1's "cannot be
   * imported severally", §12.4). Qualified access through a module alias reads
   * this map after `terms`, which is what makes `Geo.describe(x)` an ordinary
   * term reference (§3.3).
   */
  readonly constraintMembers: ReadonlyMap<string, Resolved.Symbol>;
  /**
   * Every constraint declaration reachable from this module, **exported or
   * not**, deduplicated by identity — metadata for the checker, never scope.
   *
   * Private ones are here on purpose, and they are the point of the channel: a
   * base constraint crosses because it *is* part of the declaration (§6.5), so
   * `export constraint Big<a: Small>` over a private `Small` puts `Small` in
   * every importer's base graph while leaving it unnameable everywhere. See
   * `Resolved.Module.visibleConstraints` for why one hop is not enough.
   */
  readonly visibleConstraints: readonly Resolved.ConstraintItem[];
}

export interface InstanceInterface {
  readonly identity: string;
  readonly constraint: string;
  /**
   * The identity of the constraint declaration this instance answers
   * (`spec/constraints.md` §5.1.1). Minted by the declaring module and passed
   * through untouched, like `identity` — an importer that re-derived it from
   * `constraint` would be back to keying coherence on a spelling.
   */
  readonly constraintIdentity: string;
  readonly typeParameters: readonly Resolved.TypeParameter[];
  readonly subject: Resolved.TypeAnnotation;
  readonly impliedTypes: readonly Resolved.HonorImpliedType[];
  readonly dictionary: string;
  /**
   * The instance's member seats under this interface's spellings (#444), and
   * the path of the module that declared it — see `Resolved.InstanceImport`,
   * whose two fields these become on the far side. Both pass through a transit
   * re-export untouched, because both are the declaring module's word.
   */
  readonly memberSeats: readonly Resolved.MemberSeat[];
  readonly declaringPath?: string;
  readonly span: Source.Span;
}

/**
 * Which of Statements §5's two binder classes a pattern's binders take. The
 * class comes from the binder's *position*, never from the pattern's grammar:
 * the same `{name}` is sequential on a `let` LHS and a head binder in a lambda
 * head or a match arm.
 *
 * - `"sequential"` — a `let` pattern. Scopes over the open-ended rest of its
 *   block, so it may not reuse any name in scope (§5.1 rule 1).
 * - `"head"` — a match arm, a catch arm, or a `for..in` binder. Governs a region
 *   the construct delimits and owns a scope of its own, so it may shadow
 *   anything (rule 2) with nothing to collide against.
 * - `"parameter"` — a pattern parameter. A head binder as well, but one that
 *   shares the lambda's scope with the parameters beside it, so the one name it
 *   may not take is a sibling parameter's (rule 3).
 */
type BinderClass = "sequential" | "head" | "parameter";

/**
 * A block's term declarations that the walk has not reached yet, plus the `fun`
 * symbols the block declares. Both exist for one diagnostic: a name that is not
 * in scope but *is* declared further down reads top-down (Functions §7.2), and
 * when both sides are `fun`s of the same block the split-group rule (§7.3) is
 * the actual repair.
 */
interface BlockDeclarations {
  readonly later: Map<string, LaterDeclaration>;
  readonly funSymbols: Set<Resolved.SymbolId>;
}

/**
 * `owner` is the declaring form for a name a type-namespace declaration binds —
 * what a diagnostic must tell the reader to move, since the constructor is not
 * itself movable.
 */
interface LaterDeclaration {
  readonly name: Parsed.Name;
  readonly fun: boolean;
  readonly owner?: string;
}

/**
 * The **term**-namespace names a type-namespace declaration binds: a union's and
 * record's constructors, an exception's, a constraint's members. Functions §7.2
 * governs their references — value position, and equally the pattern position a
 * constructor reaches; the type names beside them are not here, because a
 * type-position mention is order-free.
 */
function termNamesBound(
  item: Parsed.Item,
): readonly { readonly name: Parsed.Name; readonly owner: string }[] {
  if (item.kind === "Union") {
    return item.constructors.map(({ name }) => ({ name, owner: "union" }));
  }
  if (item.kind === "RecordDeclaration") return [{ name: item.name, owner: "record" }];
  if (item.kind === "Exception") return [{ name: item.name, owner: "exception" }];
  if (item.kind === "ConstraintDeclaration") {
    return item.members.map(({ name }) => ({ name, owner: "constraint" }));
  }
  return [];
}

/** Sequential binders are `let`s; both head classes are pattern binders. */
function declaredKind(binderClass: BinderClass): Resolved.SymbolKind {
  return binderClass === "sequential" ? "let" : "pattern";
}

/**
 * An English list of **two or more** parts — `a and b`, `a, b, and c` — for a
 * diagnostic that must enumerate rather than pick. A caller with one part has
 * nothing to enumerate and does not reach here.
 *
 * The conjunction is the caller's, because one list reads two ways in one
 * message: the homes a name has are *all* of them, the rewrites offered are any
 * *one* of them.
 */
function conjoin(parts: readonly string[], conjunction: "and" | "or"): string {
  const last = parts.at(-1)!;
  const leading = parts.slice(0, -1);
  return leading.length === 1
    ? `${leading[0]} ${conjunction} ${last}`
    : `${leading.join(", ")}, ${conjunction} ${last}`;
}

/** Two spans in the order a reader meets them, so a diagnostic can point in source order. */
function orderedBySource(a: Source.Span, b: Source.Span): readonly [Source.Span, Source.Span] {
  return a.start.offset <= b.start.offset ? [a, b] : [b, a];
}

/**
 * Opens a lambda body with the bindings its pattern parameters destructure
 * through, so everything downstream sees the shape a hand-written destructuring
 * `let` would have produced — the binders having already been classified in the
 * head, where they belong.
 */
function openedWith(
  bindings: readonly Resolved.LetPatternItem[],
  body: Resolved.Expr,
): Resolved.Expr {
  if (bindings.length === 0) return body;
  const items: readonly Resolved.Item[] = body.kind === "Block"
    ? [...bindings, ...body.items]
    : [...bindings, { kind: "ExprItem", expression: body, span: body.span }];
  return { kind: "Block", items, span: body.span };
}

/** One prelude module made implicitly available, with the specifier this module imports it by. */
export interface PreludeImport {
  readonly interface: ModuleInterface;
  readonly specifier: string;
}

export interface ResolveOptions {
  readonly imports?: ReadonlyMap<string, ModuleInterface>;
  readonly symbolBase?: number;
  readonly unionBase?: number;
  readonly recordBase?: number;
  readonly externTypeBase?: number;
  /**
   * The prelude modules, implicitly in scope in every non-prelude module. Their
   * names are seeded into a shadowable fallback scope (local declarations win),
   * and a used-names-only import is synthesized per prelude module that a module
   * references, so emission stays free of unused prelude imports.
   */
  readonly prelude?: readonly PreludeImport[];
  /**
   * Whether this module is a privileged runtime module. Only runtime modules may
   * name the hidden `Node` trie intrinsic (`Node.empty/get/set/copy`); in user
   * code `Node` resolves as an ordinary — and therefore unknown — name, so the
   * intrinsic stays unimportable and invisible. See the persistent-collections
   * design note §5.2.
   */
  readonly runtime?: boolean;
  /**
   * Whether this module is compiled as **standard-library source**, the privilege
   * the intrinsic door is gated on (`spec/intrinsics.md` §5.2). Two seats hold it
   * in v1: the prelude set, and the injected runtime-module set (§5.2's runtime
   * bullet, #365) — each including a project-supplied file at the corresponding
   * injection path or grant, which is the stdlib-developing-itself path.
   *
   * The privilege attaches to *how the module is compiled*, never to its text, and
   * unlike `runtime` it puts no name into scope: the door is a declaration form,
   * so there is nothing for unprivileged source to leak (§5.3). All an
   * unprivileged module can even type is the reserved specifier, which fails
   * closed with a named rewrite.
   */
  readonly privileged?: boolean;
  /**
   * The primitive this module is the fixed prelude companion of, when it is one
   * (`Resolved.Module.companionPrimitive` — #344). Settled by the caller from
   * the injection path and never from the module's text, because a primitive has
   * no declaration for text to point at.
   */
  readonly companionPrimitive?: Resolved.PrimitiveName;
  /**
   * This module's project-root-normalized path — the same string
   * `compileProject` keys its module map on.
   *
   * Two things are built from it and nothing else is: `Resolved.Module.path`,
   * and the `declaringPath` stamped on every union and record *this* module
   * declares. Both exist for Collections Part 5 §3.3's diagnostic, which names
   * the file a missing `Iterable` instance belongs in; the path is normalized
   * against the project root precisely so an importing module inherits it by
   * plain copy and relativizes once, at the message, against its own path.
   *
   * Like `privileged` and `companionPrimitive`, it is settled by the caller and
   * never by the module's text — a file does not know where it lives.
   */
  readonly path?: string;
}

export function resolve(
  module: Parsed.Module,
  options: ResolveOptions = {},
): Resolved.Module {
  const diagnostics = new Diagnostics.Bag();
  for (const diagnostic of module.diagnostics) diagnostics.add(diagnostic);

  return new Resolver(diagnostics, options).resolve(module);
}

/**
 * What kind of binding an `extern` block's declarations produce.
 *
 * A foreign one is `extern` — the value came from outside and the compiler knows
 * nothing about it beyond the declaration it was asked to believe. An intrinsic
 * one is `fun`, because that is what `spec/intrinsics.md` §3.1 makes it: "After
 * the declaration, the binding is an **ordinary module-level binding**: same
 * typing, visibility, collision, and occlusion rules as any other." §8.1 spends
 * that immediately — Method Syntax §4.2's companion operation set is built from
 * ordinary function bindings, and an exported intrinsic declaration has to be in
 * it for `source.memoize()` to dispatch the way every sibling combinator does.
 */
function externBindingKind(specifier: string): "fun" | "extern" {
  return isIntrinsicScheme(specifier) ? "fun" : "extern";
}

/**
 * A dictionary's preferred spelling: Dictionary Sharing §5's family
 * `__<Constraint>_<Subject>`, sitting directly under Lexer §3.2's reserved `__`
 * prefix like every other generated name (#425).
 *
 * Read `__Eq_Rat` as "honor `Eq<Rat>`". The flattening is not injective —
 * underscores are legal in constraint and type-constructor names — which is one
 * of the two reasons `nameDictionaries` exists.
 */
export function dictionaryName(constraint: string, subject: string): string {
  return `__${constraint}_${subject}`;
}

/**
 * A member seat's preferred spelling: the dictionary family's name with the
 * member appended (`spec/constraints.md` §6.1 — a generated family keyed
 * (constraint, subject, member), which is what `__Show_Int_show` reads as).
 *
 * `dictionary` is the instance's *preferred* spelling, never a suffixed local:
 * seats and dictionaries are one rank assigned in one pass, so a seat that read
 * a neighbour's already-resolved local would depend on the order the pass
 * happened to visit them in.
 */
export function memberSeatName(dictionary: string, member: string): string {
  return `${dictionary}_${member}`;
}

/**
 * Dictionary Sharing §5's naming and collision rules, applied once per module
 * over every dictionary that will hold a module-level seat (#425).
 *
 * Two things are decided here, and nothing else is:
 *
 * - **Imported names are unaliased by default.** A consumer binds an imported
 *   dictionary under the exporter's interface name, read from the resolved
 *   interface, whenever that spelling is uncontested. The unconditional
 *   per-file alias prefix this replaced meant a re-export chain grew a prefix
 *   per hop; re-binding the interface name at each hop is what stops the
 *   compounding.
 * - **A contested spelling suffixes every contestant.** When more than one
 *   dictionary wants one spelling, all of them take `_1`-upward suffixes and
 *   none keeps the bare name — so a bare dictionary name certifies that its
 *   spelling is uncontested in the module it appears in. Suffixes are assigned
 *   in the canonical order §5 fixes: declared instances in declaration order,
 *   each followed by its **member seats** in member declaration order
 *   (Constraints §6.1, #444), then hoisted bindings in emission order, then
 *   imports in specifier order, with the prelude channel last. Same module,
 *   same names, every compile.
 *
 *   A seat is a declared contestant in every sense, §8's export clause
 *   included: it keeps the bare spelling at the interface unless another
 *   declared name of the module contests it, so a consumer routing a concrete
 *   member call reads an uncontested name and predicts nothing.
 *
 *   The **hoisted** rank is not assigned here, and cannot be (#449): a hoisted
 *   binding exists only because some use site demanded its ground evidence
 *   tree, and those trees are the checker's output — they do not exist when
 *   this runs. The emitter mints those names against the seats decided here,
 *   through Lexer §3.2's probe, so a hoisted binding steps aside rather than
 *   pushing a declared instance off its spelling. That is narrower than §5's
 *   "none keeps the bare name" whenever a hoisted binding is one of the
 *   contestants; `dictionary-sharing.test.ts` pins what happens instead.
 *
 * Two arrivals of the *same* dictionary are not a contest: the same identity
 * reaching a module by two routes (a diamond of re-exports, or an import beside
 * a direct one) is one dictionary and takes one seat, under one name. Emission
 * binds it once — see the emitter's import rendering.
 *
 * §8's export rule is decided here too, because it is the same assignment read
 * from the other side, and it turns on **declared**, not on exported: the
 * plumbing sweep re-exports every imported dictionary in transit, so "exported"
 * would name almost everything and decide nothing. A declared instance keeps the
 * bare spelling at the interface unless another *declared* instance of the same
 * module contests it — nothing arriving from outside can rename a module's own
 * instance out from under its consumers. A transit copy is the other side of
 * that: it carries its §5 suffix at the interface whenever a declared instance
 * or another transit copy contests the spelling, and re-binds its incoming
 * interface name when the only contest is with an internal name.
 */
export function nameDictionaries(
  items: readonly Resolved.Item[],
  preludeInstances: readonly Resolved.PreludeInstance[],
): {
  readonly items: readonly Resolved.Item[];
  readonly preludeInstances: readonly Resolved.PreludeInstance[];
} {
  interface Seat {
    readonly preferred: string;
    /** Declared here, rather than arriving through an import. */
    readonly declared: boolean;
    local: string;
  }
  const byIdentity = new Map<string, Seat>();
  const groups = new Map<string, Seat[]>();
  const seat = (preferred: string, declared: boolean): Seat => {
    const entry: Seat = { preferred, declared, local: preferred };
    const group = groups.get(preferred);
    if (group === undefined) groups.set(preferred, [entry]);
    else group.push(entry);
    return entry;
  };
  const importedSeat = (identity: string, preferred: string): Seat => {
    const existing = byIdentity.get(identity);
    if (existing !== undefined) return existing;
    const entry = seat(preferred, false);
    byIdentity.set(identity, entry);
    return entry;
  };

  const declaredSeats = new Map<Resolved.HonorItem, Seat>();
  const memberSeats = new Map<Resolved.HonorItem, Seat[]>();
  for (const item of items) {
    if (item.kind !== "Honor") continue;
    declaredSeats.set(item, seat(item.dictionary, true));
    // §5's canonical order: "member seats with their instance in member
    // declaration order". With their instance, so a member seat is a declared
    // contestant seated immediately behind the record it fills — not a rank of
    // its own after every dictionary.
    memberSeats.set(
      item,
      item.memberSeats.map(({ seat: preferred }) => seat(preferred, true)),
    );
  }
  const importedSeats = new Map<Resolved.InstanceImport | Resolved.PreludeInstance, Seat>();
  for (const item of items) {
    if (item.kind !== "Import") continue;
    for (const instance of item.instances) {
      importedSeats.set(
        instance,
        importedSeat(instance.identity, instance.importedDictionary),
      );
    }
  }
  for (const instance of preludeInstances) {
    importedSeats.set(
      instance,
      importedSeat(instance.identity, instance.importedDictionary),
    );
  }

  // Nothing contested, nothing to rewrite — the overwhelmingly common shape.
  if ([...groups.values()].every((group) => group.length === 1)) {
    return { items, preludeInstances };
  }

  const taken = new Set(groups.keys());
  for (const group of groups.values()) {
    if (group.length === 1) continue;
    let suffix = 1;
    for (const entry of group) {
      let candidate = `${entry.preferred}_${suffix}`;
      // A suffixed spelling can itself be some other dictionary's preferred one
      // (`__Eq_Rat_1` is what `honor Eq_Rat_1<...>` would want). Keep probing —
      // §5's rule is "rename everything renameable", and the numbering stays
      // deterministic because the candidate order is.
      while (taken.has(candidate)) candidate = `${entry.preferred}_${++suffix}`;
      taken.add(candidate);
      entry.local = candidate;
      suffix += 1;
    }
  }

  /** §8: the spelling this module's *interface* publishes for a declared seat. */
  const exportedName = (entry: Seat): string => {
    const group = groups.get(entry.preferred) ?? [];
    return group.filter(({ declared }) => declared).length > 1
      ? entry.local
      : entry.preferred;
  };

  return {
    items: items.map((item): Resolved.Item => {
      if (item.kind === "Honor") {
        const entry = declaredSeats.get(item)!;
        const exported = exportedName(entry);
        const seats = memberSeats.get(item) ?? [];
        return {
          ...item,
          dictionary: entry.local,
          ...(exported === entry.local ? {} : { exportedDictionary: exported }),
          memberSeats: item.memberSeats.map(({ member }, index) => {
            const assigned = seats[index]!;
            const exportedSeat = exportedName(assigned);
            return {
              member,
              seat: assigned.local,
              ...(exportedSeat === assigned.local ? {} : { exportedSeat }),
            };
          }),
        };
      }
      if (item.kind !== "Import") return item;
      return {
        ...item,
        instances: item.instances.map((instance) => ({
          ...instance,
          localDictionary: importedSeats.get(instance)!.local,
        })),
      };
    }),
    preludeInstances: preludeInstances.map((instance) => ({
      ...instance,
      localDictionary: importedSeats.get(instance)!.local,
    })),
  };
}

export function moduleInterface(module: Resolved.Module): ModuleInterface {
  const symbols = new Map(module.symbols.map((symbol) => [symbol.id, symbol]));
  const terms = new Map<string, Resolved.Symbol>();
  const unions = new Map<string, Resolved.Union>();
  const records = new Map<string, Resolved.RecordDeclaration>();
  const aliases = new Map<string, Resolved.TypeAliasItem>();
  const externTypes = new Map<string, Resolved.ExternTypeDeclaration>();
  const discoveredInstances: InstanceInterface[] = module.items.flatMap((item): InstanceInterface[] => {
    if (item.kind === "Honor") {
      return [{
        identity: `${Number(module.fileId)}:${item.dictionary}`,
        constraint: item.constraint,
        constraintIdentity: item.constraintIdentity,
        typeParameters: item.typeParameters,
        subject: item.subject,
        impliedTypes: item.impliedTypes,
        // §8: the interface publishes the bare spelling even when a local
        // collision suffixed the binding behind it. Only a *declared*-versus-
        // declared contest pushes a suffix this far — an import or a hoisted
        // binding never outranks the module's own instance for its interface
        // name — and then `exportedDictionary` is the suffixed name itself.
        dictionary: item.exportedDictionary ?? item.dictionary,
        // §8's export clause read from the other side, seat by seat: the bare
        // spelling unless a declared-versus-declared contest pushed a suffix
        // this far. `declaringPath` is this module's, because this is the arm
        // where the instance is declared.
        memberSeats: item.memberSeats.map(({ member, seat, exportedSeat }) => ({
          member,
          seat: exportedSeat ?? seat,
        })),
        ...(module.path === undefined ? {} : { declaringPath: module.path }),
        span: item.span,
      }];
    }
    if (item.kind !== "Import") return [];
    return item.instances.map((instance) => ({
      identity: instance.identity,
      constraint: instance.constraint,
      constraintIdentity: instance.constraintIdentity,
      typeParameters: instance.typeParameters,
      subject: instance.subject,
      impliedTypes: instance.impliedTypes,
      dictionary: instance.localDictionary,
      // Untouched in transit: the seats belong to the declaring module and are
      // reached there, never through the hop that carried the dictionary.
      memberSeats: instance.memberSeats,
      ...(instance.declaringPath === undefined
        ? {}
        : { declaringPath: instance.declaringPath }),
      span: instance.span,
    }));
  });
  const instances = [...new Map(
    discoveredInstances.map((instance) => [instance.identity, instance]),
  ).values()];
  const constraints = new Map<string, Resolved.ConstraintItem>();
  const constraintMembers = new Map<string, Resolved.Symbol>();
  // Local declarations first, then what this module's own imports reached. Both
  // halves are metadata; only the exported local ones become nameable above.
  const visible = new Map<string, Resolved.ConstraintItem>();
  for (const item of module.items) {
    if (item.kind !== "ConstraintDeclaration") continue;
    visible.set(item.identity, item);
    if (!item.exported) continue;
    constraints.set(item.name, item);
    for (const member of item.members) {
      const symbol = symbols.get(member.binding.symbol);
      if (symbol !== undefined) constraintMembers.set(member.binding.name, symbol);
    }
  }
  for (const declaration of module.visibleConstraints) {
    if (!visible.has(declaration.identity)) visible.set(declaration.identity, declaration);
  }
  for (const item of module.items) {
    if (item.kind === "ExternBlock") {
      for (const declaration of item.declarations) {
        if (!declaration.exported) continue;
        if (declaration.kind === "ExternType") externTypes.set(declaration.localName, declaration);
        else {
          const symbol = symbols.get(declaration.binding.symbol);
          if (symbol !== undefined) terms.set(declaration.localName, symbol);
        }
      }
      continue;
    }
    if (!('exported' in item) || item.exported !== true) continue;
    if (item.kind === "Let" || item.kind === "Fun") {
      const symbol = symbols.get(item.binding.symbol);
      if (symbol !== undefined) terms.set(item.binding.name, symbol);
    } else if (item.kind === "TypeAlias") {
      aliases.set(item.name, item);
    } else if (item.kind === "Union") {
      const union = module.unions.find(({ id }) => id === item.union);
      if (union !== undefined) unions.set(item.name, union);
      for (const constructor of item.opaque ? [] : item.constructors) {
        const symbol = symbols.get(constructor.binding.symbol);
        if (symbol !== undefined) terms.set(constructor.binding.name, symbol);
      }
    } else if (item.kind === "RecordDeclaration") {
      const record = module.records.find(({ id }) => id === item.record);
      const symbol = symbols.get(item.constructor.symbol);
      if (record !== undefined) records.set(item.name, record);
      if (!item.opaque && symbol !== undefined) terms.set(item.name, symbol);
    } else if (item.kind === "Exception") {
      const symbol = symbols.get(item.binding.symbol);
      if (symbol !== undefined) terms.set(item.binding.name, symbol);
    }
  }
  return {
    module,
    terms,
    unions,
    records,
    aliases,
    externTypes,
    instances,
    constraints,
    constraintMembers,
    visibleConstraints: [...visible.values()],
  };
}

/**
 * What a module's internal export spellings are computed from, for
 * `Resolved.ImportItem.internalNames` — see its documentation for why an
 * importer is given the inputs rather than the names.
 *
 * Both clauses are the emitter's own-module enumerations on the far side, item
 * kind for item kind: `constraints` is what `moduleInterface` fills from this
 * module's `export constraint` items and nothing else, and the term walk reads
 * the declaration's own items rather than the interface's `terms` map, because
 * that map also holds constructors and exception names — which mint no internal
 * spelling and, being uppercase-start, can contest none either. Counting them
 * on one side only is the way the two sides would drift.
 */
function internalNameInputs(
  imported: ModuleInterface | undefined,
): Resolved.InternalNameInputs {
  if (imported === undefined) return { members: [], terms: [] };
  const members = [...imported.constraints.values()].flatMap((declaration) =>
    declaration.members.map(({ binding, defaultValue }) => ({
      name: binding.name,
      defaulted: defaultValue !== undefined,
    }))
  );
  const terms = imported.module.items.flatMap((item) => {
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
 * The exported terms whose value form admits Algorithm N editions, for
 * `Resolved.ImportItem.specializableTerms` — see its documentation for why the
 * fact travels instead of being predicted from the scheme.
 *
 * The predicate is `isSpecializable` in the emitter's `specializations.ts`,
 * item kind for item kind, and the two must stay in step: an over-report is a
 * call to an edition the exporter never wrote, an under-report is only a missed
 * optimization. A foreign row mints no edition and is absent for that reason —
 * `extern` declarations carry no Hexagon body to specialize.
 */
function specializableTerms(
  imported: ModuleInterface | undefined,
): readonly string[] {
  if (imported === undefined) return [];
  return imported.module.items.flatMap((item) =>
    (item.kind === "Fun" || (item.kind === "Let" && item.value.kind === "Lambda")) &&
      item.exported
      ? [item.binding.name]
      : []
  );
}

class Scope {
  readonly #bindings = new Map<string, Resolved.SymbolId>();
  /**
   * Every binding in the order it was made, kept alongside the lookup map for
   * `Resolved.Module.scopes`. The map cannot serve: it holds only the *winner*
   * for each name, and it has no record of where a binding became visible.
   */
  readonly recorded: Resolved.ScopeBinding[] = [];
  /**
   * The source this scope governs. Assigned after construction only for the
   * prelude layer, which exists before there is a module to measure.
   */
  region: Source.Span | undefined;

  constructor(readonly parent?: Scope, region?: Source.Span, readonly body = false) {
    this.region = region;
  }

  /**
   * @param visibleFrom Where the name comes into scope, for a binder that does
   * not scope over its whole region. Sequential `let` and `var` are the only
   * ones; everything else is declared before the region's body is walked.
   */
  define(name: string, symbol: Resolved.SymbolId, visibleFrom?: number): void {
    this.#bindings.set(name, symbol);
    this.recorded.push({
      name,
      symbol,
      visibleFrom: visibleFrom ?? this.region?.start.offset ?? 0,
    });
  }

  lookupLocal(name: string): Resolved.SymbolId | undefined {
    return this.#bindings.get(name);
  }

  lookup(name: string): Resolved.SymbolId | undefined {
    return this.#bindings.get(name) ?? this.parent?.lookup(name);
  }

  /**
   * The scope `lookup` would answer from, or `undefined` if nothing binds the
   * name. What the symbol alone cannot tell a caller: a prelude term and an
   * explicit import of that same term are one `SymbolId`, so "did this reference
   * land on the prelude layer?" is a question about the *layer* that held it.
   */
  lookupOwner(name: string): Scope | undefined {
    if (this.#bindings.has(name)) return this;
    return this.parent?.lookupOwner(name);
  }
}

class Resolver {
  readonly #symbols = new Map<Resolved.SymbolId, Resolved.Symbol>();
  readonly #importedSymbols = new Map<Resolved.SymbolId, Resolved.Symbol>();
  /** The honor-block member currently being resolved (Constraints §4.6). */
  readonly #honorMembers: string[] = [];
  /** Whether resolution is inside a constraint declaration's default body. */
  #inDefaultBody = false;
  /** Where this module's `honor` declarations bind each spelling (§4.6). */
  readonly #honoredMemberLines = new Map<string, HonoredMemberLine[]>();
  readonly #unions: Resolved.Union[] = [];
  readonly #records: Resolved.RecordDeclaration[] = [];
  readonly #externTypes: Resolved.ExternTypeDeclaration[] = [];
  readonly #unionNames = new Map<string, Resolved.UnionId>();
  readonly #unionArities = new Map<string, number>();
  readonly #recordNames = new Map<string, Resolved.RecordId>();
  /** Record identities the prelude supplies, by name, immune to local occlusion. */
  readonly #preludeRecords = new Map<string, Resolved.RecordId>();
  /** Union identities the prelude supplies, by name, immune to local occlusion. */
  readonly #preludeUnions = new Map<string, Resolved.UnionId>();
  readonly #recordArities = new Map<string, number>();
  readonly #externTypeNames = new Map<string, Resolved.ExternTypeId>();
  readonly #typeAliases = new Map<string, Parsed.TypeAliasItem | Resolved.TypeAliasItem>();
  readonly #unionDeclarations = new WeakMap<Parsed.UnionItem, Resolved.UnionId>();
  readonly #recordDeclarations = new WeakMap<Parsed.RecordItem, Resolved.RecordId>();
  readonly #externTypeDeclarations = new WeakMap<Parsed.ExternTypeDeclaration, Resolved.ExternTypeId>();
  readonly #resolvingAliases: string[] = [];
  readonly #imports: ReadonlyMap<string, ModuleInterface>;
  readonly #runtime: boolean;
  readonly #privileged: boolean;
  readonly #companionPrimitive: Resolved.PrimitiveName | undefined;
  /** This module's own path; see `ResolveOptions.path`. */
  readonly #path: string | undefined;
  readonly #preludeScope = new Scope();
  /** Every scope opened, in the order they were opened — see `Module.scopes`. */
  readonly #openScopes: Scope[] = [];
  /**
   * Where a *sequential* pattern binder comes into scope: the end of the `let`
   * that introduced it. Held here rather than threaded through
   * `#resolvePattern`, which recurses a dozen ways and would carry the value
   * unchanged down every one of them; only the one caller that classifies its
   * binders as sequential ever sets it.
   */
  #sequentialVisibleFrom: number | undefined;
  #moduleScope: Scope | undefined;
  readonly #preludeTerms = new Map<Resolved.SymbolId, Resolved.Symbol>();
  readonly #preludeTypeNames = new Set<string>();
  readonly #preludeSpecifierBySymbol = new Map<Resolved.SymbolId, string>();
  readonly #preludeInterfaceBySpecifier = new Map<string, ModuleInterface>();
  /**
   * File ids of the prelude modules visible here — how an *explicit* import is
   * recognized as naming one (#263). By module identity rather than by
   * specifier: the same module is `./Option` from the root and `../Option` from
   * a subdirectory, and a predicate reading the text would answer differently
   * for one module.
   */
  readonly #preludeFileIds = new Set<number>();
  /**
   * The prelude's importable type inventory (FFI Part 7 §2.4), accumulated in
   * `#seedPrelude` and published as `Module.preludeTypeImports`.
   *
   * Mutable only in `explicitLocal`, which is settled later: an explicit import
   * of the same identity takes over the entry's emission, and whether one exists
   * is not known until the import items have been resolved.
   */
  readonly #preludeTypeImports: {
    -readonly [K in keyof Resolved.PreludeTypeImport]: Resolved.PreludeTypeImport[K];
  }[] = [];
  readonly #usedPreludeSymbols = new Set<Resolved.SymbolId>();
  /**
   * Every prelude term of a given name, in prelude order — *not* only the one
   * `#preludeScope` holds. Two prelude members may export the same bare name
   * (`length`, `prepend`, `empty` are `Seq.hex`'s and `Vector.hex`'s alike, per
   * Collections Part 1 §3.1's naming doctrine), and the scope keeps the last,
   * which is the answer to the *bare* spelling and to nothing else.
   * `#noteCompanionCandidate` needs them all: dot call is type-directed
   * (Method Syntax §1), so a `Seq` receiver reaches `Seq.hex`'s `length` however
   * many later members occlude the bare name.
   */
  readonly #preludeTermsByName = new Map<string, Resolved.SymbolId[]>();
  /**
   * The qualified home of every prelude term of a given name, in prelude order —
   * the module names `#preludeModuleAliases` binds, which are what a rewrite of a
   * bare reference has to be spelled with.
   *
   * Two or more homes is a **collision**, and a bare reference to a collided name
   * is refused: neither member owns the spelling, so the reference is an error
   * that names every home (the F#/ML answer — `List.map` and `Seq.map` coexist
   * and the use site qualifies). The alternative the scope gives for free, last
   * member wins, silently changes what a bare `empty` means in every program
   * already written the moment a member joins the prelude.
   *
   * Keyed by *visible* homes, not by the prelude list: this map is filled from
   * the members seeded into this resolver, and a prelude member is seeded only
   * the members before it (Modules §5.5). So `empty` is ambiguous in a consumer,
   * which sees `Seq.hex` and `Vector.hex` both, and ordinary inside `Result.hex`,
   * which sees only the first.
   */
  readonly #preludeHomesByName = new Map<string, string[]>();
  readonly #explicitlyImported = new Set<Resolved.SymbolId>();
  readonly #moduleAliases = new Map<string, ModuleInterface>();
  /** Prelude members addressable by name — a fallback layer, so an explicit
   *  `import * as` of the same name is a module-level binding and wins (§5.4). */
  readonly #preludeModuleAliases = new Map<string, ModuleInterface>();
  /**
   * The names a `constraint` declaration may not take, growing as the module's
   * own declarations are resolved. Seeded from the pre-registered inventory,
   * whose one declaration the compiler holds (§5.1.1) — a module-level twin is
   * refused rather than admitted as a name the wired-in machinery cannot reach.
   *
   * **Not seeded in privileged (standard-library) source.** A privileged
   * declaration of a pre-registered name is not a twin; it is the stdlib
   * *supplying* the declaration the compiler pre-registered by name — the
   * intrinsic-door move applied to a constraint declaration (the
   * constraint-members-are-values note §6 step 2, #335). `#constraintIdentity`'s
   * pre-registration-wins rule then lands the declaration on the compiler-global
   * `hex:` identity, so the wired-in machinery and the source declaration are
   * one constraint by construction, exactly as `stdlib/Integral.hex`'s already
   * is. The privilege carries the same trust model as the rest of `privileged`:
   * it attaches to how the module is compiled, and the embedded-source drift
   * guard pins what that source says.
   */
  readonly #constraintNames = new Set<string>();
  /**
   * The constraint names this module's own `constraint` declarations take,
   * collected before any item is resolved.
   *
   * Read by `#constraintIdentity` so that a module which both declares `C` and
   * imports one keeps its own declaration's identity for its own text. That the
   * pair is also a reported collision is beside the point: the identity has to
   * be a function of the name either way, and answering it from source order
   * would make the erroneous program's two halves disagree about which `C` they
   * meant.
   */
  readonly #declaredConstraintNames = new Set<string>();
  /** Imported constraints by the local name they bind (Modules §3.1/§3.2). */
  readonly #importedConstraints = new Map<string, Resolved.ConstraintItem>();
  /** Imported constraints by `Alias.Name`, for the §3.3 binder position. */
  readonly #qualifiedConstraints = new Map<string, Resolved.ConstraintItem>();
  /** Every constraint declaration the import graph reaches, by identity. */
  readonly #visibleConstraints = new Map<string, Resolved.ConstraintItem>();
  readonly #impliedTypeOwners = new Map<string, Set<string>>();
  readonly #pending: { readonly name: Parsed.Name; readonly kind: "let" | "var" }[] = [];
  readonly #predeclaredBindings = new WeakMap<Parsed.FunItem | Parsed.ExternFunDeclaration | Parsed.ExternLetDeclaration, Resolved.Binding>();
  readonly #blockDeclarations: BlockDeclarations[] = [];
  readonly #currentFunctions: Resolved.SymbolId[] = [];
  readonly #varOwners = new Map<Resolved.SymbolId, number>();
  readonly #diagnostics: Diagnostics.Bag;
  /** This module's file id, held for identity minting; set by `resolve`. */
  #fileId = 0;
  #lambdaDepth = 0;
  /** Written-hole identities; see `Resolved.HoleTypeAnnotation.id`. */
  #nextHole = 0;
  #nextSymbol: number;
  #nextUnion: number;
  #nextRecord: number;
  #nextExternType: number;

  constructor(diagnostics: Diagnostics.Bag, options: ResolveOptions) {
    this.#diagnostics = diagnostics;
    this.#imports = options.imports ?? new Map();
    this.#runtime = options.runtime ?? false;
    this.#privileged = options.privileged ?? false;
    this.#companionPrimitive = options.companionPrimitive;
    this.#path = options.path;
    this.#nextSymbol = options.symbolBase ?? 0;
    this.#nextUnion = options.unionBase ?? 0;
    this.#nextRecord = options.recordBase ?? 0;
    this.#nextExternType = options.externTypeBase ?? 0;
    if (!this.#privileged) {
      for (const name of NON_REDECLARABLE_CONSTRAINTS) this.#constraintNames.add(name);
    }
    for (const preludeImport of options.prelude ?? []) {
      this.#preludeFileIds.add(Number(preludeImport.interface.module.fileId));
      this.#seedPrelude(preludeImport.interface, preludeImport.specifier);
    }
  }

  /**
   * The identity a constraint *name* denotes here (`spec/constraints.md`
   * §5.1.1).
   *
   * Pre-registration wins over a module's own declaration, and that order is
   * load-bearing rather than defensive. It applies to exactly the two names a
   * module may still redeclare (`Iterable`, `Integral` — see
   * `NON_REDECLARABLE_CONSTRAINTS`), and a pre-registered constraint is
   * compiler-global: every module means the same declaration by the name,
   * without importing anything. A source declaration of one is *supplying* that
   * declaration's members, not minting a rival, so it must land on the same
   * identity — otherwise `stdlib/Integral.hex`'s constraint and the `Integral`
   * an importing module demands would be two different constraints.
   *
   * An **imported** constraint keeps the identity its declaring module minted
   * (§6.5's "an exported constraint crosses as a reference to its
   * declaration"), which is the whole point: the importer must not mint one of
   * its own, or the instances the home module already holds would answer a
   * different constraint. This module's own declarations still win over an
   * import of the same name — see `#declaredConstraintNames`.
   *
   * A name that is none of the three names nothing; it is minted file-scoped
   * anyway, which keeps the checker's unknown-constraint report the only
   * diagnostic for that program rather than adding a second, keying one.
   */
  #constraintIdentity(name: string): string {
    const qualified = this.#qualifiedConstraints.get(name);
    if (qualified !== undefined) return qualified.identity;
    if (isPreRegisteredConstraint(name)) return preRegisteredConstraintIdentity(name);
    if (this.#declaredConstraintNames.has(name)) {
      return declaredConstraintIdentity(this.#fileId, name);
    }
    return this.#importedConstraints.get(name)?.identity ??
      declaredConstraintIdentity(this.#fileId, name);
  }

  /** The declaration a constraint name denotes here, if this module can see it. */
  #namedConstraint(name: string): Resolved.ConstraintItem | undefined {
    return this.#qualifiedConstraints.get(name) ??
      this.#importedConstraints.get(name);
  }

  /**
   * A module addressable by name: an explicit `import * as` alias first, then the
   * prelude layer. Modules §6.4 requires every prelude name to have a qualified
   * home; §5.4 makes an explicit alias a module-level binding, so it wins.
   */
  #namedModule(name: string): ModuleInterface | undefined {
    return this.#moduleAliases.get(name) ?? this.#preludeModuleAliases.get(name);
  }

  /**
   * Makes a prelude term reachable from emitted code, returning the name to
   * spell it by, or `undefined` if the symbol is not a prelude term.
   *
   * A prelude member has no namespace object to dot into — unlike an explicit
   * `import * as`, nothing declares one. So the reference compiles to a plain
   * name backed by the same synthesized used-names-only import the bare spelling
   * uses, and the symbol has to join that set or the emitted module references
   * nothing.
   *
   * The *local* the import binds it under is decided later, in `#preludeImport`,
   * because choosing it here would mean guessing which names the module will go
   * on to bind (PR #91 finding F1). The reference carries the term's own name;
   * emission substitutes the import's local.
   */
  #reachPreludeTerm(symbol: Resolved.SymbolId): string | undefined {
    const term = this.#preludeTerms.get(symbol);
    if (term === undefined) return undefined;
    this.#usedPreludeSymbols.add(symbol);
    return term.name;
  }

  /**
   * Marks a prelude term that *companion dispatch* might reach through this
   * field name. `source.map(f)` names no module, and whether it is a dispatch or
   * a call of a function-valued field depends on the receiver's **type** — which
   * the checker decides, long after the synthesized prelude import is built. So
   * the candidate is registered here, from the one syntactic form dispatch can
   * take. It is conservative in one direction only: at worst a spare candidate,
   * never a missing one.
   *
   * The failure this prevents is the silent kind (defect log entries 8 and 10):
   * the module compiles clean and its emitted JavaScript calls a name it never
   * imported. `Seq.hex` is the first prelude module to export dispatchable
   * lowercase operations, so nothing exercised this before.
   *
   * **Every prelude term of the name, not the one the bare spelling resolves
   * to.** Dispatch consults the receiver's type, so an occluded member is as
   * reachable as the occluding one; registering only `#preludeScope`'s winner
   * made the over-approximation an *under*-approximation the moment two members
   * shared a name, and produced exactly the failure above — a `Seq` receiver's
   * `length` emitted as a bare name that `Vector.hex`'s import had bound.
   *
   * What a spare candidate costs is bounded at one entry in the resolved tree
   * (#263). Registration is *availability* only: emission renders the
   * synthesized import from the names the elaborated Core references, so a
   * candidate no dispatch turned out to need is never imported, never drags the
   * prelude module into the emitted graph, and never reaches this module's
   * public ESM surface. The over-approximation used to pay all three.
   */
  #noteCompanionCandidate(field: string): void {
    for (const symbol of this.#preludeTermsByName.get(field) ?? []) {
      this.#reachPreludeTerm(symbol);
    }
  }

  /**
   * Whether `receiver.field(…)` is a *compiler companion* call — one the `Access`
   * case below turns into a `CollectionOperation`. Those never reach a prelude
   * term: the operation is the compiler's own, resolved by name against a fixed
   * per-collection inventory, so no dispatch candidate exists to register.
   *
   * The conservatism in `#noteCompanionCandidate` is deliberate and stays; this
   * only removes the one case that is decidable *here*, syntactically, with no
   * help from the checker. The emitted output no longer depends on it — since
   * #263 an unreferenced candidate is filtered out at emission — so what it
   * still buys is in the resolved tree: no spare entry in the used-prelude set,
   * and no spare claim on a module-level name, which is what would otherwise
   * push `#preludeImport` into renaming a local it never needed to rename. The
   * collection cores and `Seq.hex` share vocabulary on purpose (`isEmpty`,
   * `empty` — Collections Part 1 §3.1's naming doctrine), so `Set.isEmpty(s)`
   * is an ordinary spelling and not a rarity.
   *
   * The guards mirror the `Access` case below, and must keep mirroring it: a
   * receiver that some declaration claims is *not* the compiler companion, and a
   * candidate must still be registered for it. `Node` carries the field
   * inventory too, because its `Access` case does — outside those four names
   * `Node.x(…)` is an ordinary access, and suppressing there would be a claim
   * this predicate has no right to make.
   */
  #routesToCollectionCore(receiver: Parsed.Expr, field: string, scope: Scope): boolean {
    if (receiver.kind !== "Name") return false;
    const name = receiver.name.text;
    if (scope.lookup(name) !== undefined) return false;
    if (this.#namedModule(name) !== undefined) return false;
    // `Node` alone since #373 retired `Set`'s guard entry, as #370 retired
    // `Map`'s (`spec/intrinsics.md` §9.2's Map/Set milestones). Each entry went
    // because the schedule says so: `stdlib/Map.hex` and `stdlib/Set.hex` are
    // prelude members now, so `#namedModule` above already declines every `Map.`
    // and `Set.` receiver, and leaving either name here would be a claim about a
    // route that no longer exists.
    return this.#runtime && name === "Node" &&
      ["empty", "get", "set", "copy"].includes(field);
  }

  /**
   * Makes one prelude module's nominals implicitly available. Terms go into a
   * fallback scope so a local declaration of the same name shadows the prelude;
   * type identities are registered so annotations resolve and the checker sees
   * them. The specifier is recorded per term so the synthesized import points at
   * the module the name actually came from.
   *
   * Types are recorded twice, and the second record is the one FFI Part 7 §2.4
   * reads: `#preludeTypeNames` and friends are keyed by *name*, which occlusion
   * can move (§5.4), while a face carries an identity. The inventory below is
   * keyed by identity and ordered — the members arrive in normative prelude
   * order, and each member's slice is unions, then records, then extern types.
   */
  #seedPrelude(prelude: ModuleInterface, specifier: string): void {
    this.#preludeInterfaceBySpecifier.set(specifier, prelude);
    const seedTypeName = (name: string): void => {
      this.#preludeTypeNames.add(name);
    };
    const inventory = (
      name: string,
      identity: Pick<Resolved.PreludeTypeImport, "union" | "record" | "externType">,
    ): void => {
      this.#preludeTypeImports.push({ ...identity, name, specifier });
    };
    // Modules §6.4: the occlusion rule's "the prelude version stays reachable
    // qualified" only works if the member can be *named*. Registering it under
    // its own basename gives every prelude name the qualified home §6.4 requires,
    // the same way an explicit `import * as` alias would. An explicit alias of
    // the same name is a module-level binding and wins, per §5.4.
    const moduleName = specifier.slice(specifier.lastIndexOf("/") + 1).replace(/\.js$/u, "");
    if (moduleName !== "") this.#preludeModuleAliases.set(moduleName, prelude);
    for (const [name, symbol] of prelude.terms) {
      this.#preludeScope.define(name, symbol.id);
      this.#preludeTermsByName.set(name, [
        ...this.#preludeTermsByName.get(name) ?? [],
        symbol.id,
      ]);
      // The home a refused bare reference is rewritten to. `moduleName` is the
      // same string `#preludeModuleAliases` was keyed by just above, so the
      // diagnostic's suggestion is a spelling that resolves rather than a guess
      // at one; the specifier stands in only if a member has no basename to be
      // named by, which no injection path produces.
      this.#preludeHomesByName.set(name, [
        ...this.#preludeHomesByName.get(name) ?? [],
        moduleName === "" ? specifier : moduleName,
      ]);
      this.#preludeTerms.set(symbol.id, symbol);
      this.#preludeSpecifierBySymbol.set(symbol.id, specifier);
      // Registered eagerly so `#symbol` resolves prelude references during body
      // resolution; unused entries never reach emission (the import lists only
      // the terms actually referenced) and are excluded from id-base progression.
      this.#importedSymbols.set(symbol.id, symbol);
    }
    // A constraint member is an export of its declaring module (#335), and a
    // prelude module's exports are in bare scope everywhere — so the members
    // seed exactly as the terms above do: same fallback scope, same collision
    // arithmetic, same synthesized-import channel. `constraintMembers` holds
    // only the members of constraints this module *declares* (see
    // `ModuleInterface`), never the member bindings of an `honor` block, which
    // is the boundary the note's §5 item 8 requires: bare `show` in a consumer
    // has exactly one exporter, `Show.hex` — an honoring module's binding is
    // reached only qualified, or bare from inside that module.
    for (const [name, symbol] of prelude.constraintMembers) {
      this.#preludeScope.define(name, symbol.id);
      this.#preludeTermsByName.set(name, [
        ...this.#preludeTermsByName.get(name) ?? [],
        symbol.id,
      ]);
      this.#preludeHomesByName.set(name, [
        ...this.#preludeHomesByName.get(name) ?? [],
        moduleName === "" ? specifier : moduleName,
      ]);
      this.#preludeTerms.set(symbol.id, symbol);
      this.#preludeSpecifierBySymbol.set(symbol.id, specifier);
      this.#importedSymbols.set(symbol.id, symbol);
    }
    // The declarations themselves ride the metadata channel, so the checker
    // validates an `honor` against the source declaration rather than its
    // wired-in fallback table. Metadata only, never scope — a consumer's binder
    // `<a: Show>` still resolves through pre-registration, and nothing here
    // makes a prelude constraint importable severally.
    for (const declaration of prelude.visibleConstraints) {
      if (!this.#visibleConstraints.has(declaration.identity)) {
        this.#visibleConstraints.set(declaration.identity, declaration);
      }
    }
    for (const [name, union] of prelude.unions) {
      seedTypeName(name);
      // Kept separately from `#unionNames` for the reason given below for
      // records: a local declaration may occlude the name (§5.4), and the
      // compiler's own producers must still reach the prelude's `Bool`.
      this.#preludeUnions.set(name, union.id);
      this.#unionNames.set(name, union.id);
      this.#unionArities.set(name, union.parameters.length);
      inventory(name, { union: union.id });
      if (!this.#unions.some(({ id }) => id === union.id)) {
        this.#unions.push({ ...union, representationVisible: false });
      }
    }
    for (const [name, record] of prelude.records) {
      seedTypeName(name);
      // Kept separately from `#recordNames`, which a local declaration may
      // occlude (§5.4). The compiler's own producers must reach the *prelude's*
      // `Seq`, not whatever record a module happens to name `Seq`, so they need
      // an identity that occlusion cannot move.
      this.#preludeRecords.set(name, record.id);
      this.#recordNames.set(name, record.id);
      this.#recordArities.set(name, record.parameters.length);
      inventory(name, { record: record.id });
      if (!this.#records.some(({ id }) => id === record.id)) {
        this.#records.push({ ...record, representationVisible: false });
      }
    }
    // Aliases are seeded but never inventoried: a face carries an alias's
    // expansion rather than its name (§2.4, Modules §11.4), so no `.d.ts` can
    // reference one and an entry could only ever produce a dead import.
    for (const [name, alias] of prelude.aliases) {
      seedTypeName(name);
      this.#typeAliases.set(name, { ...alias, name });
    }
    for (const [name, externType] of prelude.externTypes) {
      seedTypeName(name);
      this.#externTypeNames.set(name, externType.externType);
      inventory(name, { externType: externType.externType });
      if (!this.#externTypes.some(({ externType: id }) => id === externType.externType)) {
        this.#externTypes.push({ ...externType, localName: name });
      }
    }
  }

  resolve(module: Parsed.Module): Resolved.Module {
    this.#fileId = Number(module.fileId);
    this.#predeclareTypes(module.items);
    // Implied type names have owner-relative identity, but failed uses outside
    // an owner still receive the knowing v1 diagnostic even before declaration.
    // See Collections Part 2 §6–§7.3.
    for (const item of module.items) {
      if (item.kind !== "ConstraintDeclaration") continue;
      this.#declaredConstraintNames.add(item.name.text);
      for (const impliedType of item.impliedTypes) {
        const owners = this.#impliedTypeOwners.get(impliedType.name.text) ?? new Set();
        owners.add(item.name.text);
        this.#impliedTypeOwners.set(impliedType.name.text, owners);
      }
    }
    // The prelude layer was seeded before there was a module to measure, so it
    // is given its region now. It governs the whole file — that is what
    // "implicitly in scope everywhere" means — and it is registered first, so
    // that a module-level binding of the same name, recorded later, is the one
    // an inner-wins reader takes.
    this.#preludeScope.region = module.span;
    this.#openScopes.push(this.#preludeScope);
    const scope = this.#openScope(this.#preludeScope, module.span, true);
    // The one scope whose parent is the prelude layer, and so the only one where
    // Modules §5.4 permits occlusion. Held rather than inferred: "module level"
    // is scope identity, not nesting depth — a block body of a module-level
    // `let` runs at lambda depth 0 but is an inner layer, where the ban is
    // absolute.
    this.#moduleScope = scope;
    this.#predeclareExternTerms(module.items, scope);
    this.#indexHonoredMemberLines(module.items);
    const resolvedItems = this.#resolveItems(module.items, scope);
    this.#claimHonoredMembers(resolvedItems, scope);
    // After resolution, never before: the synthesized import's local names have
    // to dodge every name the emitted module binds, and that set is only closed
    // once every declaration has been through `#declare` (PR #91 finding F1).
    const preludeChannel = this.#preludeInstanceChannel(module.span);
    // Dictionary Sharing §5's naming pass, last of all: it needs every declared
    // instance and every imported one in one place, and both channels are only
    // complete here.
    const { items, preludeInstances } = nameDictionaries(
      this.#assignMemberSeats([
        ...this.#preludeImport(module.span, resolvedItems),
        ...resolvedItems,
      ]),
      preludeChannel,
    );

    return {
      kind: "Module",
      fileId: module.fileId,
      items,
      symbols: [...this.#importedSymbols.values(), ...this.#symbols.values()],
      scopes: this.#openScopes.map((open) => ({
        // Every registered scope has been given a region; the module's own span
        // is the only sensible answer if one somehow was not, and is wide rather
        // than wrong.
        span: open.region ?? module.span,
        bindings: open.recorded,
        body: open.body,
      })),
      // Explicit aliases first, so a reader taking the first entry for a name
      // gets the one that wins: an `import * as Vector` is a module-level
      // binding and outranks the prelude companion of the same name (§5.4).
      moduleAliases: [...this.#moduleAliases, ...this.#preludeModuleAliases]
        .map(([alias, reached]) => ({
          alias,
          members: [...reached.terms].map(([name, symbol]) => ({ name, symbol: symbol.id })),
        })),
      unions: this.#unions,
      records: this.#records,
      preludeRecords: this.#preludeRecords,
      preludeUnions: this.#preludeUnions,
      preludeInstances,
      // Read after resolution, never during: `explicitLocal` records that a
      // source-written import took an entry over (§2.4), and the import items
      // are only all resolved by now.
      preludeTypeImports: this.#preludeTypeImports.map((entry) => ({ ...entry })),
      visibleConstraints: [...this.#visibleConstraints.values()],
      externTypes: this.#externTypes,
      comments: module.comments,
      docs: module.docs,
      ...(this.#companionPrimitive === undefined
        ? {}
        : { companionPrimitive: this.#companionPrimitive }),
      ...(this.#path === undefined ? {} : { path: this.#path }),
      span: module.span,
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  /**
   * Opens a scope and registers it for `Module.scopes`.
   *
   * `region` is the source the scope actually governs, which is not always the
   * span of the construct that opened it — see the `For` case, where the
   * iterable is resolved outside the scope its own pattern binds into.
   */
  #openScope(parent: Scope, region: Source.Span, body = false): Scope {
    const scope = new Scope(parent, region, body);
    this.#openScopes.push(scope);
    return scope;
  }

  /** Registers module type identities before resolving any declaration body. */
  #predeclareTypes(items: readonly Parsed.Item[]): void {
    const claimed = new Map<string, Source.Span>();
    const declarations: (
      | Parsed.TypeAliasItem
      | Parsed.UnionItem
      | Parsed.RecordItem
      | Parsed.ExternTypeDeclaration
    )[] = [];
    for (const item of items) {
      if (item.kind === "TypeAlias" || item.kind === "Union" || item.kind === "RecordDeclaration") {
        declarations.push(item);
      } else if (item.kind === "ExternBlock") {
        declarations.push(...item.declarations.filter(
          (declaration): declaration is Parsed.ExternTypeDeclaration =>
            declaration.kind === "ExternType",
        ));
      }
    }
    for (const item of declarations) {
      const itemName = item.kind === "ExternType" ? item.localName : item.name;
      const previous = claimed.get(itemName.text);
      if (previous !== undefined) {
        this.#diagnostics.add({
          severity: "error",
          message: `type \`${itemName.text}\` is already declared`,
          primary: itemName.span,
          labels: [{ span: previous, message: "first declaration is here" }],
        });
        continue;
      }
      claimed.set(itemName.text, itemName.span);
      if (item.kind === "TypeAlias") {
        this.#typeAliases.set(item.name.text, item);
      } else if (item.kind === "Union") {
        const id = Resolved.unionId(this.#nextUnion++);
        this.#unionDeclarations.set(item, id);
        this.#unionNames.set(item.name.text, id);
        this.#unionArities.set(item.name.text, item.parameters.length);
      } else if (item.kind === "RecordDeclaration") {
        const id = Resolved.recordId(this.#nextRecord++);
        this.#recordDeclarations.set(item, id);
        this.#recordNames.set(item.name.text, id);
        this.#recordArities.set(item.name.text, item.parameters.length);
      } else {
        const id = Resolved.externTypeId(this.#nextExternType++);
        this.#externTypeDeclarations.set(item, id);
        this.#externTypeNames.set(item.localName.text, id);
      }
    }
  }

  #predeclareExternTerms(items: readonly Parsed.Item[], scope: Scope): void {
    for (const item of items) {
      if (item.kind !== "ExternBlock") continue;
      const kind = externBindingKind(item.specifier);
      for (const declaration of item.declarations) {
        if (declaration.kind === "ExternType") continue;
        const existing = scope.lookupLocal(declaration.localName.text);
        if (existing !== undefined) this.#reportRebinding(declaration.localName, existing);
        const binding = this.#declare(declaration.localName, kind);
        this.#predeclaredBindings.set(declaration, binding);
        if (existing === undefined) scope.define(declaration.localName.text, binding.symbol);
      }
    }
  }

  /**
   * The gate (`spec/intrinsics.md` §5). Returns whether this block is the
   * intrinsic door — which it is only when the specifier names it *and* the
   * module may use it. In unprivileged source the block never resolves, so no
   * user program can reach the inventory (§5.3), and reporting exactly one error
   * per block keeps the diagnostic about the thing the author actually typed.
   */
  #checkExternSpecifier(
    specifier: string,
    span: Source.Span,
    form: "block" | "import",
  ): boolean {
    if (!isIntrinsicScheme(specifier)) return false;
    if (!this.#privileged) {
      // The rewrite names the form the author was already writing. Pointing an
      // effect import at an `extern from` block would be telling them to rewrite
      // the wrong half of what they typed.
      this.#diagnostics.add({
        severity: "error",
        message: "the `hex:` specifier scheme is reserved to standard-library source; " +
          (form === "block"
            ? "to bind your own JavaScript implementation, use an ordinary `extern from` " +
              "block naming your module"
            : "to run your own JavaScript module for its effects, use an ordinary " +
              "`extern import` naming your module"),
        primary: span,
      });
      return false;
    }
    if (specifier !== INTRINSIC_SPECIFIER) {
      this.#diagnostics.add({
        severity: "error",
        message: `\`${specifier}\` is not a reserved boundary; ` +
          `\`${INTRINSIC_SPECIFIER}\` is the scheme's only member`,
        primary: span,
      });
      return false;
    }
    return true;
  }

  /**
   * Verification replaces trust (§4.2). At a foreign boundary the declaration is
   * believed; here the compiler is the implementer, so key existence and arity
   * are checked at the declaration site. Types are deliberately *not* checked
   * against a compiler-side table — the annotation is normative, and a lowering
   * that diverges from it is a compiler conformance defect, never a user
   * diagnostic.
   */
  #verifyIntrinsicKey(
    declaration: Parsed.ExternFunDeclaration | Parsed.ExternLetDeclaration,
  ): void {
    // A `default` declaration has no foreign name to be the key, and the form
    // was already refused (§3.3). Verifying the local name as a key on top of
    // that would report the author's one mistake twice, the second time as a
    // claim about a key they never wrote.
    if (declaration.default) return;
    const name = declaration.foreignName ?? declaration.localName;
    const arity = INTRINSIC_INVENTORY.get(name.text);
    if (arity === undefined) {
      // The Rewrite Rule wants a named rewrite in every hard error. A near
      // neighbour is the best one — it is almost always the key the author meant.
      // With nothing close, the inventory itself is the rewrite: it is flat and
      // compiler-global, so listing it is exhaustive rather than a guess, which
      // is the one thing a suggestion here must not be.
      const nearest = nearestIntrinsicKey(name.text);
      this.#diagnostics.add({
        severity: "error",
        message: `the compiler provides no intrinsic \`${name.text}\`; ` +
          (nearest === undefined
            ? `the keys it provides are ${[...INTRINSIC_INVENTORY.keys()]
              .map((key) => `\`${key}\``).join(", ")}`
            : `the nearest provided key is \`${nearest}\``),
        primary: name.span,
      });
      return;
    }
    if (declaration.kind !== "ExternFun") return;
    if (declaration.parameters.length !== arity) {
      this.#diagnostics.add({
        severity: "error",
        message: `intrinsic \`${name.text}\` takes ${arity} ` +
          `${arity === 1 ? "parameter" : "parameters"}, but this declaration has ` +
          `${declaration.parameters.length}`,
        primary: declaration.span,
      });
    }
  }

  #resolveItems(
    items: readonly Parsed.Item[],
    scope: Scope,
  ): readonly Resolved.Item[] {
    // Everything the block declares, so a reference that finds nothing in scope
    // can be told it is reading a declaration that has not happened yet
    // (Functions §7.2/§10) instead of being told the name is unknown. Entries
    // leave as the walk passes their declaration, so what remains is exactly
    // what is still *later* than the reference being resolved.
    const frame: BlockDeclarations = { later: new Map(), funSymbols: new Set() };
    const declare = (later: LaterDeclaration): void => {
      if (!frame.later.has(later.name.text)) frame.later.set(later.name.text, later);
    };
    for (const item of items) {
      if (item.kind === "Fun" || item.kind === "Let" || item.kind === "Var") {
        declare({ name: item.name, fun: item.kind === "Fun" });
      } else if (item.kind === "LetPattern") {
        for (const name of Parsed.patternNames(item.pattern)) declare({ name, fun: false });
      } else {
        // The term names a type-namespace declaration binds. Their references
        // read top-down like any other term reference (§7.2); the declarations
        // themselves, and every type-position mention of them, stay order-free.
        for (const { name, owner } of termNamesBound(item)) declare({ name, fun: false, owner });
      }
    }
    this.#blockDeclarations.push(frame);
    const resolved: Resolved.Item[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      // A contiguous run of `fun`s is one group (Functions §7.3): every member
      // is bound before the first body is walked, so the bodies see each other
      // in both directions. Any other item ends the run, and the next run binds
      // where it starts — which is what makes forward visibility stop there.
      if (item.kind === "Fun" && !this.#predeclaredBindings.has(item)) {
        for (let scan = index; scan < items.length; scan += 1) {
          const member = items[scan];
          if (member?.kind !== "Fun") break;
          const existing = scope.lookupLocal(member.name.text);
          if (existing !== undefined) this.#reportRebinding(member.name, existing);
          const binding = this.#declare(member.name, "fun");
          this.#predeclaredBindings.set(member, binding);
          frame.funSymbols.add(binding.symbol);
          frame.later.delete(member.name.text);
          if (existing === undefined) {
            scope.define(member.name.text, binding.symbol, item.span.start.offset);
          }
        }
      }
      const resolvedItem = this.#resolveItem(item, scope);
      resolved.push(resolvedItem, ...this.#derivedHonors(resolvedItem));
      if (item.kind === "Fun" || item.kind === "Let" || item.kind === "Var") {
        frame.later.delete(item.name.text);
      } else if (item.kind === "LetPattern") {
        for (const name of Parsed.patternNames(item.pattern)) frame.later.delete(name.text);
      } else {
        for (const { name } of termNamesBound(item)) frame.later.delete(name.text);
      }
    }
    this.#blockDeclarations.pop();
    return resolved;
  }

  /** Expands declaration-header derivation sugar into ordinary instance items. */
  #derivedHonors(item: Resolved.Item): readonly Resolved.HonorItem[] {
    if (item.kind !== "Union" && item.kind !== "RecordDeclaration") return [];
    const requiredParameters = new Set(
      (item.kind === "Union"
        ? item.constructors.flatMap((constructor) => constructor.slots)
        : item.fields
      ).flatMap(({ annotation }) => annotationTypeVariables(annotation)),
    );
    const subject: Resolved.TypeAnnotation = item.kind === "Union"
      ? {
          kind: "Union",
          union: item.union,
          name: item.name,
          arguments: item.parameters.map((name) => ({
            kind: "TypeVariable",
            name,
            span: item.span,
          })),
          span: item.span,
        }
      : {
          kind: "RecordDeclaration",
          record: item.record,
          name: item.name,
          arguments: item.parameters.map((name) => ({
            kind: "TypeVariable",
            name,
            span: item.span,
          })),
          span: item.span,
        };
    return item.derives.map((constraint) => ({
      kind: "Honor",
      constraint,
      constraintIdentity: this.#constraintIdentity(constraint),
      typeParameters: item.parameters.map((name) => ({
        name,
        constraints: requiredParameters.has(name) ? [constraint] : [],
        span: item.span,
      })),
      subject,
      derived: true,
      dictionary: dictionaryName(constraint, item.name),
      memberSeats: [],
      impliedTypes: [],
      members: [],
      span: item.span,
    }));
  }

  #resolveItem(item: Parsed.Item, scope: Scope): Resolved.Item {
    switch (item.kind) {
      case "Import": {
        if (!item.specifier.startsWith("./") && !item.specifier.startsWith("../")) {
          this.#diagnostics.add({
            severity: "error",
            message: "package imports are not yet supported; use a relative module path",
            primary: item.span,
          });
        }
        const importedModule = this.#imports.get(item.specifier);
        if (importedModule === undefined) {
          this.#diagnostics.add({
            severity: "error",
            message: `cannot resolve module \`${item.specifier}\``,
            primary: item.span,
          });
        }
        /** What this line put in the constraint namespace; see `ConstraintImport`. */
        const boundConstraints: Resolved.ConstraintImport[] = [];
        // Metadata before names, and for every import form including the effect
        // one: what a module can *see* of the constraint graph is a property of
        // the graph, not of what this line chose to bind (Modules §6.5). The
        // declarations that only arrive here are the ones no import could name —
        // a private middle link in a base chain; see `Module.visibleConstraints`.
        for (const declaration of importedModule?.visibleConstraints ?? []) {
          if (!this.#visibleConstraints.has(declaration.identity)) {
            this.#visibleConstraints.set(declaration.identity, declaration);
          }
        }
        if (item.form.kind === "Namespace" && importedModule !== undefined) {
          if (this.#moduleAliases.has(item.form.alias.text)) {
            this.#diagnostics.add({
              severity: "error",
              message: `module alias \`${item.form.alias.text}\` is already bound`,
              primary: item.form.alias.span,
            });
          } else {
            this.#moduleAliases.set(item.form.alias.text, importedModule);
            this.#includeNominals(importedModule, item.form.alias.text);
            for (const symbol of importedModule.terms.values()) {
              this.#importedSymbols.set(symbol.id, symbol);
            }
            // §3.3: a constraint qualifies through the alias in a binder
            // (`<a: Geo.C>`), and its members through it as ordinary terms
            // (`Geo.describe(x)`). The alias is the module in both cases.
            for (const declaration of importedModule.constraints.values()) {
              const local = `${item.form.alias.text}.${declaration.name}`;
              this.#qualifiedConstraints.set(local, declaration);
              boundConstraints.push({ local, declaration });
            }
            for (const symbol of importedModule.constraintMembers.values()) {
              this.#importedSymbols.set(symbol.id, symbol);
            }
          }
        }
        const names = item.form.kind === "Named"
          ? item.form.names.flatMap((name): Resolved.ImportName[] => {
              const term = importedModule?.terms.get(name.imported.text);
              const union = importedModule?.unions.get(name.imported.text);
              const record = importedModule?.records.get(name.imported.text);
              const alias = importedModule?.aliases.get(name.imported.text);
              const externType = importedModule?.externTypes.get(name.imported.text);
              const constraint = importedModule?.constraints.get(name.imported.text);
              // §3.1: "Members cannot be imported severally." Naming one is a
              // near miss with an exact answer, so it gets the answer rather
              // than the generic does-not-export report.
              const severalMember = term === undefined && constraint === undefined
                ? importedModule?.constraintMembers.get(name.imported.text)
                : undefined;
              if (severalMember !== undefined) {
                const owner = [...importedModule!.constraints.values()].find(
                  (declaration) =>
                    declaration.members.some(
                      ({ binding }) => binding.name === name.imported.text,
                    ),
                );
                this.#diagnostics.add({
                  severity: "error",
                  message:
                    `\`${name.imported.text}\` is a member of constraint ` +
                    `\`${owner?.name ?? "?"}\`; import the constraint — its members ` +
                    "arrive with it",
                  primary: name.span,
                });
                return [];
              }
              if (term === undefined && union === undefined && record === undefined && alias === undefined && externType === undefined && constraint === undefined) {
                this.#diagnostics.add({
                  severity: "error",
                  message: `module \`${item.specifier}\` does not export \`${name.imported.text}\``,
                  primary: name.span,
                });
              }
              const memberNames = constraint === undefined
                ? []
                : this.#bindImportedConstraint(
                    importedModule!,
                    constraint,
                    name,
                    scope,
                    boundConstraints,
                  );
              if (term !== undefined) {
                const existing = scope.lookup(name.local.text);
                // A prelude name is a shadowable fallback: an explicit import of
                // the same local name overrides it silently (and takes over its
                // emission, so it is excluded from the synthesized prelude import).
                if (existing !== undefined && !this.#preludeTerms.has(existing)) {
                  this.#reportRebinding(name.local, existing);
                } else {
                  scope.define(name.local.text, term.id);
                }
                this.#explicitlyImported.add(term.id);
                this.#importedSymbols.set(term.id, term);
              }
              if (union !== undefined) {
                if ((this.#unionNames.has(name.local.text) || this.#recordNames.has(name.local.text)) && !this.#preludeTypeNames.has(name.local.text)) {
                  this.#diagnostics.add({
                    severity: "error",
                    message: `type \`${name.local.text}\` is already declared or imported`,
                    primary: name.span,
                  });
                }
                this.#unionNames.set(name.local.text, union.id);
                this.#unionArities.set(name.local.text, union.parameters.length);
                if (!this.#unions.some(({ id }) => id === union.id)) this.#unions.push({ ...union, representationVisible: false });
              }
              if (record !== undefined) {
                if ((this.#unionNames.has(name.local.text) || this.#recordNames.has(name.local.text)) && !this.#preludeTypeNames.has(name.local.text)) {
                  this.#diagnostics.add({
                    severity: "error",
                    message: `type \`${name.local.text}\` is already declared or imported`,
                    primary: name.span,
                  });
                }
                this.#recordNames.set(name.local.text, record.id);
                this.#recordArities.set(name.local.text, record.parameters.length);
                const importedRecord = { ...record, representationVisible: false };
                if (!this.#records.some(({ id }) => id === record.id)) this.#records.push(importedRecord);
              }
              if (alias !== undefined) {
                if ((this.#typeAliases.has(name.local.text) || this.#unionNames.has(name.local.text) || this.#recordNames.has(name.local.text) || this.#externTypeNames.has(name.local.text)) && !this.#preludeTypeNames.has(name.local.text)) {
                  this.#diagnostics.add({
                    severity: "error",
                    message: `type \`${name.local.text}\` is already declared or imported`,
                    primary: name.span,
                  });
                } else {
                  this.#typeAliases.set(name.local.text, { ...alias, name: name.local.text });
                }
              }
              if (externType !== undefined) {
                if ((this.#typeAliases.has(name.local.text) || this.#unionNames.has(name.local.text) || this.#recordNames.has(name.local.text) || this.#externTypeNames.has(name.local.text)) && !this.#preludeTypeNames.has(name.local.text)) {
                  this.#diagnostics.add({
                    severity: "error",
                    message: `type \`${name.local.text}\` is already declared or imported`,
                    primary: name.span,
                  });
                } else {
                  this.#externTypeNames.set(name.local.text, externType.externType);
                  if (!this.#externTypes.some(({ externType: id }) => id === externType.externType)) {
                    this.#externTypes.push({ ...externType, localName: name.local.text });
                  }
                }
              }
              const typeBinding = union !== undefined || record !== undefined ||
                alias !== undefined || externType !== undefined;
              // §2.4 channel 1: this import owns every name it binds, so the
              // prelude channel must not offer a second line for the same
              // identity. Matched by identity, never by spelling — a rename
              // still takes the entry over, and the entry's faces spell the
              // local the source chose.
              if (typeBinding) {
                for (const entry of this.#preludeTypeImports) {
                  const owned = (union !== undefined && entry.union === union.id) ||
                    (record !== undefined && entry.record === record.id) ||
                    (externType !== undefined && entry.externType === externType.externType);
                  if (owned) entry.explicitLocal = name.local.text;
                }
              }
              // A constraint name binds in neither the term nor the type
              // namespace and has no `.js` or `.d.ts` face (Constraints §6.4),
              // so it contributes no entry of its own — only its members do.
              const own: readonly Resolved.ImportName[] =
                term === undefined && !typeBinding && constraint !== undefined
                  ? []
                  : [{
                      imported: name.imported.text,
                      local: name.local.text,
                      ...(term === undefined ? {} : { symbol: term.id }),
                      ...(term === undefined && typeBinding ? { typeOnly: true } : {}),
                      ...(typeBinding ? { typeBinding: true } : {}),
                      span: name.span,
                    }];
              return [...own, ...memberNames];
            })
          : undefined;
        const namespaceAlias = item.form.kind === "Namespace"
          ? item.form.alias.text
          : undefined;
        // An explicit import of a *prelude* module carries no instance evidence
        // (#263), for the reason `#preludeImport` carries none (#153): the
        // prelude's instances ride `Module.preludeInstances`, which every module
        // gets whether or not it imports anything. Carrying them here as well
        // would put a second copy of the same identity into this module's
        // interface, which consumers would then predict imports of and
        // intermediates re-export — the transit #153 cut for the synthesized
        // channel, cut here for the explicit one.
        //
        // Only prelude modules. An ordinary module's `honor` is reachable from a
        // consumer three hops away *only* through the intermediates, so instance
        // evidence on a non-prelude import is load-bearing and untouched.
        const preludeSource = importedModule !== undefined &&
          this.#preludeFileIds.has(Number(importedModule.module.fileId));
        return {
          kind: "Import",
          specifier: item.specifier,
          synthesized: false,
          form: item.form.kind === "Effect"
            ? item.form
            : item.form.kind === "Namespace"
              ? {
                  kind: "Namespace",
                  alias: namespaceAlias!,
                  names: [
                    ...[...(importedModule?.terms.entries() ?? [])].map(
                      ([name, symbol]) => ({ name, symbol, member: false }),
                    ),
                    // §3.3: `Geo.describe(x)` is an ordinary term reference,
                    // reached through the alias like any other export.
                    ...[...(importedModule?.constraintMembers.entries() ?? [])].map(
                      ([name, symbol]) => ({ name, symbol, member: true }),
                    ),
                  ].map(({ name, symbol, member }) => ({
                    imported: name,
                    local: `${namespaceAlias}.${name}`,
                    symbol: symbol.id,
                    ...(member ? { constraintMember: true } : {}),
                    span: item.span,
                  })),
                }
              : {
                  kind: "Named",
                  names: names ?? [],
                },
          instances: (preludeSource ? [] : importedModule?.instances ?? []).map((instance) => ({
            identity: instance.identity,
            constraint: instance.constraint,
            constraintIdentity: instance.constraintIdentity,
            typeParameters: instance.typeParameters,
            subject: instance.subject,
            impliedTypes: instance.impliedTypes,
            importedDictionary: instance.dictionary,
            // The exporter's interface name, unaliased. `nameDictionaries`
            // suffixes it later if this module contests the spelling (§5).
            localDictionary: instance.dictionary,
            memberSeats: instance.memberSeats,
            ...this.#seatOrigin(instance.declaringPath),
            span: item.span,
          })),
          constraints: boundConstraints,
          internalNames: internalNameInputs(importedModule),
          specializableTerms: specializableTerms(importedModule),
          span: item.span,
        };
      }
      case "ExternImport":
        // The reservation is a property of the scheme, not of one block form, so
        // it fails closed here too. In privileged source the specifier is legal
        // but the form is not: §8.3 emits no import because there is no foreign
        // module, and an effect import of the door would emit one that resolves
        // to nothing.
        if (this.#checkExternSpecifier(item.specifier, item.span, "import")) {
          this.#diagnostics.add({
            severity: "error",
            message: "the intrinsic door has no foreign module to import; " +
              "declare the operations you need in an `extern from " +
              `${JSON.stringify(INTRINSIC_SPECIFIER)}\` block`,
            primary: item.span,
          });
        }
        return item;
      case "ExternBlock": {
        const intrinsic = this.#checkExternSpecifier(item.specifier, item.span, "block");
        const declarations = item.declarations.map((declaration): Resolved.ExternDeclaration => {
          if (intrinsic && declaration.kind !== "ExternType") {
            this.#verifyIntrinsicKey(declaration);
          }
          if (declaration.kind === "ExternType") {
            const resolved: Resolved.ExternTypeDeclaration = {
              kind: "ExternType",
              exported: declaration.exported,
              default: false,
              ...(declaration.pure === undefined ? {} : { pure: declaration.pure }),
              ...(declaration.foreignName === undefined ? {} : { foreignName: declaration.foreignName.text }),
              localName: declaration.localName.text,
              externType: this.#externTypeDeclarations.get(declaration) ?? Resolved.externTypeId(this.#nextExternType++),
              span: declaration.span,
            };
            this.#externTypes.push(resolved);
            return resolved;
          }
          const binding = this.#predeclaredBindings.get(declaration) ??
            this.#declare(declaration.localName, externBindingKind(item.specifier));
          const common = {
            exported: declaration.exported,
            default: declaration.default,
            ...(declaration.pure === undefined ? {} : { pure: declaration.pure }),
            ...(declaration.conduit === undefined ? {} : { conduit: declaration.conduit }),
            ...(declaration.foreignName === undefined ? {} : { foreignName: declaration.foreignName.text }),
            localName: declaration.localName.text,
            binding,
            span: declaration.span,
          };
          if (declaration.kind === "ExternLet") {
            return {
              kind: "ExternLet",
              ...common,
              annotation: this.#resolveTypeAnnotation(declaration.annotation),
            };
          }
          const parameters = declaration.parameters.map((parameter) => ({
            ...this.#declare(parameter.name, "parameter"),
            ...(parameter.annotation === undefined
              ? {}
              : { annotation: this.#resolveTypeAnnotation(parameter.annotation) }),
          }));
          return {
            kind: "ExternFun",
            ...common,
            // #370: an intrinsic row's constraint brackets ride the §3.4 grant.
            // The parser records them only inside the reserved boundary, so
            // nothing here has to re-derive the gate's answer.
            ...(declaration.typeParameters === undefined
              ? {}
              : {
                typeParameters: declaration.typeParameters.map((parameter) => ({
                  name: parameter.name.text,
                  constraints: parameter.constraints.map(({ text }) => text),
                  span: parameter.span,
                })),
              }),
            parameters,
            returnAnnotation: this.#resolveTypeAnnotation(declaration.returnAnnotation),
          };
        });
        return {
          kind: "ExternBlock",
          specifier: item.specifier,
          intrinsic,
          declarations,
          span: item.span,
        };
      }
      case "ConstraintDeclaration": {
        if (this.#constraintNames.has(item.name.text)) {
          this.#diagnostics.add({
            severity: "error",
            message: isPreRegisteredConstraint(item.name.text)
              ? `constraint \`${item.name.text}\` is pre-registered and cannot be redeclared`
              : this.#importedConstraints.has(item.name.text)
                ? `constraint \`${item.name.text}\` is already declared or imported`
                : `constraint \`${item.name.text}\` is already declared`,
            primary: item.name.span,
          });
        }
        this.#constraintNames.add(item.name.text);
        const typeParameters = new Set([item.subject.text]);
        const impliedTypes = new Set(item.impliedTypes.map(({ name }) => name.text));
        const impliedContext = { owner: item.name.text, names: impliedTypes };
        const memberBindings = item.members.map((member) => {
          // A constraint member binds at module level, so §5.4's occlusion rule
          // applies to it exactly as it does to `let` and `fun` (defect 9): it
          // may occlude a prelude name and may not collide with a sibling in its
          // own layer. Same scope-identity test, same reason — a depth test
          // would license shadowing in inner layers (PR #89 finding F1).
          const existing = scope === this.#moduleScope
            ? scope.lookupLocal(member.name.text)
            : scope.lookup(member.name.text);
          if (existing !== undefined) this.#reportRebinding(member.name, existing);
          const binding = this.#declare(member.name, "constraint-member");
          if (existing === undefined) scope.define(member.name.text, binding.symbol);
          return binding;
        });
        const members = item.members.map((member, index) => {
          const binding = memberBindings[index]!;
          const parameters = member.parameters.map((parameter) => ({
            ...this.#declare(parameter.name, "parameter"),
            ...(parameter.annotation === undefined
              ? {}
              : { annotation: this.#resolveTypeAnnotation(parameter.annotation, typeParameters, impliedContext) }),
          }));
          return {
            binding,
            parameters,
            returnAnnotation: this.#resolveTypeAnnotation(member.returnAnnotation, typeParameters, impliedContext),
            ...(member.defaultValue === undefined
              ? {}
              : { defaultValue: this.#resolveDefaultBody(member.defaultValue, scope, impliedContext) }),
            span: member.span,
          };
        });
        const declaration: Resolved.ConstraintItem = {
          kind: "ConstraintDeclaration",
          exported: item.exported,
          name: item.name.text,
          identity: this.#constraintIdentity(item.name.text),
          subject: item.subject.text,
          baseConstraints: item.baseConstraints.map(({ text }) => text),
          // Resolved here, where the names were written: an importer reading
          // `baseConstraints` alone could only guess (§6.5).
          baseConstraintIdentities: item.baseConstraints.map(({ text }) =>
            this.#constraintIdentity(text)
          ),
          impliedTypes: item.impliedTypes.map(({ name, span }) => ({
            name: name.text,
            span,
          })),
          members,
          span: item.span,
        };
        this.#visibleConstraints.set(declaration.identity, declaration);
        return declaration;
      }
      case "Honor": {
        const typeParameterNames = new Set(item.typeParameters.map(({ name }) => name.text));
        const subject = this.#resolveTypeAnnotation(item.subject, typeParameterNames);
        const declaration = this.#impliedTypeOwners;
        // An imported constraint's implied types come from its declaration —
        // the local owner table only knows this module's own (§6.5: the implied
        // type members do not travel separately, they *are* the declaration).
        const imported = this.#namedConstraint(item.constraint.text);
        const names = imported !== undefined
          ? new Set(imported.impliedTypes.map(({ name }) => name))
          : new Set(
              [...declaration.entries()]
                .filter(([, owners]) => owners.has(item.constraint.text))
                .map(([name]) => name),
            );
        const impliedContext = { owner: item.constraint.text, names };
        return {
          kind: "Honor",
          constraint: item.constraint.text,
          constraintIdentity: this.#constraintIdentity(item.constraint.text),
          typeParameters: item.typeParameters.map((parameter) => ({
            name: parameter.name.text,
            constraints: parameter.constraints.map(({ text }) => text),
            span: parameter.span,
          })),
          subject,
          derived: item.derived,
          // The constraint's *declared* name, never the importer's spelling: an
          // alias or an `Alias.Name` qualification is this module's word for
          // someone else's declaration, and the second is not even a legal
          // JavaScript identifier.
          dictionary: dictionaryName(
            this.#namedConstraint(item.constraint.text)?.name ?? item.constraint.text,
            annotationHeadName(subject),
          ),
          // Filled by `#assignMemberSeats`, which runs once every declaration is
          // resolved and the constraint behind this head is in view.
          memberSeats: [],
          impliedTypes: item.impliedTypes.map((impliedType) => ({
            name: impliedType.name.text,
            annotation: this.#resolveTypeAnnotation(
              impliedType.annotation,
              typeParameterNames,
            ),
            span: impliedType.span,
          })),
          members: item.members.map((member) => {
            // Constraints §4.6: a member definition is a `let` header, not a
            // `fun`, so its own body may not call its own name. The stack is what
            // tells a reference which name that is; a constraint *declaration's*
            // default body never pushes onto it, which is the exemption stated
            // in the same bullet.
            this.#honorMembers.push(member.name.text);
            const value = this.#resolveLambda(member.value, scope, impliedContext);
            this.#honorMembers.pop();
            return { name: member.name.text, value, span: member.span };
          }),
          span: item.span,
        };
      }
      case "Let": {
        // Modules §5.4 is layered: a binder in the *module's own scope* may
        // occlude a prelude name (the local one wins unqualified, the prelude's
        // stays reachable qualified), while any binder in an inner layer may
        // occlude nothing — prelude included, and layer-blind. `lookupLocal`
        // stops at this module's layer; `lookup` walks out through the prelude.
        // `fun` already drew this distinction in the predeclare pass; `let` did
        // not, which is why the rule went untested until the prelude first
        // exported a lowercase name.
        //
        // The test is scope *identity*, not nesting depth: the block body of a
        // module-level `let` runs at lambda depth 0 yet is an inner layer, so a
        // depth test would quietly license shadowing there (PR #89 finding F1).
        const existing = scope === this.#moduleScope
          ? scope.lookupLocal(item.name.text)
          : scope.lookup(item.name.text);
        if (existing !== undefined) this.#reportRebinding(item.name, existing);

        const binding = this.#declare(item.name, "let");
        this.#pending.push({ name: item.name, kind: "let" });
        const value = this.#resolveExpr(Parsed.unwrapBindingValue(item.value), scope);
        this.#pending.pop();

        // Preserve the first valid meaning after an error instead of allowing
        // a rejected rebinding to change how subsequent names resolve.
        // Visible from the end of its own item: a sequential binder scopes over
        // the rest of its block (Statements §5.1), not over its own value.
        if (existing === undefined) {
          scope.define(item.name.text, binding.symbol, item.span.end.offset);
        }

        return {
          kind: "Let",
          exported: item.exported,
          binding,
          ...(item.annotation === undefined
            ? {}
            : { annotation: this.#resolveTypeAnnotation(item.annotation) }),
          value,
          span: item.span,
        };
      }
      case "TypeAlias": {
        const parameters = new Set(item.parameters.map(({ text }) => text));
        const used = parsedAnnotationTypeVariables(item.annotation);
        for (const parameter of item.parameters) {
          if (!used.has(parameter.text)) {
            this.#diagnostics.add({
              severity: "error",
              message: `type parameter \`${parameter.text}\` is not used by alias \`${item.name.text}\``,
              primary: parameter.span,
            });
          }
        }
        // Effects §2.2.1 / Declarations Preamble §5.1.1: an alias body has no
        // enclosing signature, so `->?` there denotes nothing. The check has to
        // stand *here*, before `#instantiateResolvedAlias` inlines the body
        // into a use site: inlined into a signature that happens to have an
        // inlet, the arrow would silently link — and transparency means one
        // alias would then name two colours across two mentions, which is not a
        // type. Refusing at the declaration is what keeps the alias one type.
        const orphaned = this.#refuseLinkedArrows(item.annotation);
        this.#resolvingAliases.push(item.name.text);
        const resolvedBody = this.#resolveTypeAnnotation(item.annotation, parameters);
        this.#resolvingAliases.pop();
        // Recovery: a refused `->?` becomes the impure constant in the stored
        // body, so the alias inlines as `->!` at every use site. Without this
        // the linked arrow would reach a use site whose signature happens to
        // have an inlet, link there, and make every call through the alias owe
        // `?` — a cascade of consequences from one already-reported defect.
        const annotation = orphaned ? constantifyLinkedArrows(resolvedBody) : resolvedBody;
        const resolvedAlias: Resolved.TypeAliasItem = {
          kind: "TypeAlias",
          exported: item.exported,
          name: item.name.text,
          parameters: item.parameters.map(({ text }) => text),
          annotation,
          span: item.span,
        };
        this.#typeAliases.set(item.name.text, resolvedAlias);
        return resolvedAlias;
      }
      case "Var": {
        const existing = scope.lookup(item.name.text);
        if (existing !== undefined) this.#reportRebinding(item.name, existing);
        if (this.#lambdaDepth === 0) {
          this.#diagnostics.add({
            severity: "error",
            message: "`var` is only allowed inside a function",
            primary: item.name.span,
          });
        }
        const binding = this.#declare(item.name, "var");
        this.#varOwners.set(binding.symbol, this.#lambdaDepth);
        this.#pending.push({ name: item.name, kind: "var" });
        const value = this.#resolveExpr(Parsed.unwrapBindingValue(item.value), scope);
        this.#pending.pop();
        if (existing === undefined) {
          scope.define(item.name.text, binding.symbol, item.span.end.offset);
        }
        return {
          kind: "Var",
          binding,
          ...(item.annotation === undefined
            ? {}
            : { annotation: this.#resolveTypeAnnotation(item.annotation) }),
          value,
          span: item.span,
        };
      }
      case "LetPattern": {
        const names = Parsed.patternNames(item.pattern);
        this.#pending.push(
          ...names.map((name) => ({ name, kind: "let" as const })),
        );
        const value = this.#resolveExpr(Parsed.unwrapBindingValue(item.value), scope);
        this.#pending.splice(this.#pending.length - names.length, names.length);
        const seen = new Map<string, Resolved.Binding>();
        this.#sequentialVisibleFrom = item.span.end.offset;
        const pattern = this.#resolvePattern(item.pattern, scope, seen, "sequential");
        this.#sequentialVisibleFrom = undefined;
        return {
          kind: "LetPattern",
          exported: false,
          pattern,
          value,
          span: item.span,
        };
      }
      case "Union": {
        const union = this.#unionDeclarations.get(item) ?? Resolved.unionId(this.#nextUnion++);
        const typeParameters = new Set(item.parameters.map(({ text }) => text));
        const seenConstructors = new Set<string>();
        const constructors = item.constructors.map((constructor) => {
          const existing = scope.lookup(constructor.name.text);
          if (seenConstructors.has(constructor.name.text)) {
            this.#diagnostics.add({
              severity: "error",
              message: `duplicate constructor \`${constructor.name.text}\``,
              primary: constructor.span,
            });
          } else if (existing !== undefined) {
            this.#reportRebinding(constructor.name, existing);
          }
          seenConstructors.add(constructor.name.text);
          const binding = this.#declare(constructor.name, "constructor");
          if (existing === undefined) {
            scope.define(constructor.name.text, binding.symbol);
          }
          return {
            binding,
            slots: constructor.slots.map((slot, index) => ({
              field: slot.name?.text ?? `item${index + 1}`,
              annotation: this.#resolveTypeAnnotation(slot.annotation, typeParameters),
              span: slot.span,
            })),
            span: constructor.span,
          };
        });
        const declaration: Resolved.Union = {
          id: union,
          name: item.name.text,
          parameters: item.parameters.map(({ text }) => text),
          declaredParameters: item.declaredParameters,
          derives: item.derives.map(({ text }) => text),
          opaque: item.opaque,
          representationVisible: true,
          // Stamped here and nowhere else: this is the *declaring* site, and
          // every other registration of this object — explicit import, prelude
          // seeding, `#includeNominals` — is a spread copy that carries the
          // path onward untouched (`Resolved.Union.declaringPath`).
          ...(this.#path === undefined ? {} : { declaringPath: this.#path }),
          span: item.name.span,
          constructors,
        };
        this.#unions.push(declaration);
        return {
          kind: "Union",
          exported: item.exported,
          opaque: item.opaque,
          union,
          name: item.name.text,
          parameters: item.parameters.map(({ text }) => text),
          declaredParameters: item.declaredParameters,
          derives: item.derives.map(({ text }) => text),
          constructors,
          span: item.span,
        };
      }
      case "RecordDeclaration": {
        const record = this.#recordDeclarations.get(item) ?? Resolved.recordId(this.#nextRecord++);
        const existing = scope.lookup(item.name.text);
        if (existing !== undefined) this.#reportRebinding(item.name, existing);
        const constructor = this.#declare(item.name, "record-constructor");
        if (existing === undefined) scope.define(item.name.text, constructor.symbol);
        const typeParameters = new Set(item.parameters.map(({ text }) => text));
        const fields = item.fields.map((field) => ({
          name: field.name.text,
          annotation: this.#resolveTypeAnnotation(field.annotation, typeParameters),
          span: field.span,
        }));
        const declaration: Resolved.RecordDeclaration = {
          id: record,
          name: item.name.text,
          parameters: item.parameters.map(({ text }) => text),
          declaredParameters: item.declaredParameters,
          derives: item.derives.map(({ text }) => text),
          opaque: item.opaque,
          representationVisible: true,
          // The declaring site; see the union arm above.
          ...(this.#path === undefined ? {} : { declaringPath: this.#path }),
          constructor,
          fields,
          span: item.span,
        };
        this.#records.push(declaration);
        return {
          kind: "RecordDeclaration",
          exported: item.exported,
          opaque: item.opaque,
          record,
          name: item.name.text,
          parameters: declaration.parameters,
          declaredParameters: item.declaredParameters,
          derives: declaration.derives,
          constructor,
          fields,
          span: item.span,
        };
      }
      case "Exception": {
        const existing = scope.lookup(item.name.text);
        if (existing !== undefined) this.#reportRebinding(item.name, existing);
        const binding = this.#declare(item.name, "constructor");
        if (existing === undefined) scope.define(item.name.text, binding.symbol);
        return {
          kind: "Exception",
          exported: item.exported,
          binding,
          slots: item.slots.map((slot, index) => ({
            field: slot.name?.text ?? `item${index + 1}`,
            annotation: this.#resolveTypeAnnotation(slot.annotation),
            span: slot.span,
          })),
          span: item.span,
        };
      }
      case "Fun": {
        const binding = this.#predeclaredBindings.get(item) ?? this.#declare(item.name, "fun");
        this.#currentFunctions.push(binding.symbol);
        const value = this.#resolveLambda(item.value, scope);
        this.#currentFunctions.pop();

        return {
          kind: "Fun",
          exported: item.exported,
          binding,
          value,
          span: item.span,
        };
      }
      case "ExprItem":
        return {
          kind: "ExprItem",
          expression: this.#resolveExpr(item.expression, scope),
          span: item.span,
        };
      case "ErrorItem":
        return item;
    }
  }

  #resolveExpr(expression: Parsed.Expr, scope: Scope): Resolved.Expr {
    switch (expression.kind) {
      case "Name":
        return this.#resolveName(expression, scope);
      case "Unit":
      case "Integer":
      case "BigInt":
      case "Float":
      case "ErrorExpr":
        return expression;
      case "String":
        return {
          ...expression,
          parts: expression.parts.map((part) =>
            part.kind === "Text"
              ? part
              : {
                  ...part,
                  expression: this.#resolveExpr(part.expression, scope),
                },
          ),
        };
      case "Tuple":
      case "Vector":
        return {
          ...expression,
          elements: expression.elements.map((element) =>
            this.#resolveExpr(element, scope),
          ),
        };
      case "Record":
        return {
          kind: "Record",
          ...(expression.spread === undefined
            ? {}
            : { spread: this.#resolveExpr(expression.spread, scope) }),
          fields: expression.fields.map((field) => ({
            name: { text: field.name.text, startClass: field.name.startClass, span: field.name.span },
            punned: field.punned,
            value: this.#resolveExpr(field.value, scope),
            span: field.span,
          })),
          span: expression.span,
        };
      case "Group":
        return {
          ...expression,
          expression: this.#resolveExpr(expression.expression, scope),
        };
      case "Ascription":
        // The ordinary annotation path, deliberately: type names get their
        // identities (so the occurrence index reaches them) and holes get
        // resolver-assigned ids through the same mint, so an alias applied at a
        // hole shares seed and id exactly as it does in a binding annotation
        // (Ascription §9.2).
        return {
          kind: "Ascription",
          expression: this.#resolveExpr(expression.expression, scope),
          annotation: this.#resolveTypeAnnotation(expression.annotation),
          span: expression.span,
        };
      case "Block": {
        const blockScope = this.#openScope(scope, expression.span, true);
        return {
          ...expression,
          items: this.#resolveItems(expression.items, blockScope),
        };
      }
      case "Lambda":
        return this.#resolveLambda(expression, scope);
      case "If":
        return {
          kind: "If" as const,
          condition: this.#resolveExpr(expression.condition, scope),
          consequence: this.#resolveExpr(expression.consequence, scope),
          alternative: this.#resolveExpr(expression.alternative, scope),
          ...(expression.elseless ? { elseless: true } : {}),
          span: expression.span,
        };
      case "While":
        return {
          kind: "While",
          condition: this.#resolveExpr(expression.condition, scope),
          body: this.#resolveExpr(expression.body, scope) as Resolved.BlockExpr,
          span: expression.span,
        };
      case "For": {
        // The body, not the whole `for`: the iterable is resolved in the
        // *outer* scope, so a region spanning the construct would claim the
        // loop's binder is in scope inside the thing being iterated over.
        const loopScope = this.#openScope(scope, expression.body.span, true);
        const pattern = this.#resolvePattern(
          expression.pattern,
          loopScope,
          new Map(),
          "head",
        );
        return {
          kind: "For",
          pattern,
          iterable: this.#resolveExpr(expression.iterable, scope),
          body: this.#resolveExpr(expression.body, loopScope) as Resolved.BlockExpr,
          span: expression.span,
        };
      }
      case "Match":
        return {
          ...expression,
          scrutinee: this.#resolveExpr(expression.scrutinee, scope),
          arms: expression.arms.map((arm) => {
            const armScope = this.#openScope(scope, arm.span);
            const pattern = this.#resolvePattern(
              arm.pattern,
              armScope,
              new Map(),
              "head",
            );
            return {
              pattern,
              ...(arm.guard === undefined
                ? {}
                : { guard: this.#resolveExpr(arm.guard, armScope) }),
              body: this.#resolveExpr(arm.body, armScope),
              span: arm.span,
            };
          }),
        };
      case "Try":
        return {
          kind: "Try",
          body: this.#resolveExpr(expression.body, scope),
          arms: expression.arms.map((arm) => {
            const armScope = this.#openScope(scope, arm.span);
            const pattern = this.#resolvePattern(
              arm.pattern,
              armScope,
              new Map(),
              "head",
            );
            return {
              pattern,
              ...(arm.guard === undefined
                ? {}
                : { guard: this.#resolveExpr(arm.guard, armScope) }),
              body: this.#resolveExpr(arm.body, armScope),
              span: arm.span,
            };
          }),
          span: expression.span,
        };
      case "Call":
        if (
          expression.callee.kind === "Name" &&
          expression.callee.name.text === "hash" &&
          scope.lookup("hash") === undefined
        ) {
          if (expression.arguments.length !== 1) {
            this.#diagnostics.add({
              severity: "error",
              message: `\`hash\` expects exactly one value, got ${expression.arguments.length}`,
              primary: expression.span,
            });
          }
          return {
            kind: "Hash",
            value: expression.arguments[0] === undefined
              ? { kind: "ErrorExpr", span: expression.span }
              : this.#resolveExpr(expression.arguments[0], scope),
            span: expression.span,
          };
        }
        if (
          expression.callee.kind === "Name" &&
          expression.callee.name.text === "throw" &&
          scope.lookup("throw") === undefined
        ) {
          if (expression.arguments.length !== 1) {
            this.#diagnostics.add({
              severity: "error",
              message: `\`throw\` expects exactly one exception, got ${expression.arguments.length}`,
              primary: expression.span,
            });
          }
          const argument = expression.arguments[0];
          return {
            kind: "Throw",
            exception: argument === undefined
              ? { kind: "ErrorExpr", span: expression.span }
              : this.#resolveExpr(argument, scope),
            span: expression.span,
          };
        }
        const refusedConsole = this.#refusedHostConsoleLog(expression, scope);
        if (refusedConsole !== undefined) {
          return {
            ...expression,
            callee: {
              ...refusedConsole,
              // The receiver is minted rather than resolved: resolving the name
              // would report the unknown `console` the refusal has already
              // spoken for, and this recovery owes one sentence.
              receiver: { kind: "ErrorExpr", span: refusedConsole.receiver.span },
              field: {
                text: refusedConsole.field.text,
                startClass: refusedConsole.field.startClass,
                span: refusedConsole.field.span,
              },
            },
            arguments: expression.arguments.map((argument) =>
              this.#resolveExpr(argument, scope),
            ),
          };
        }
        if (
          expression.callee.kind === "Access" &&
          !(expression.callee.receiver.kind === "Name" &&
            this.#namedModule(expression.callee.receiver.name.text) !== undefined) &&
          !this.#routesToCollectionCore(
            expression.callee.receiver,
            expression.callee.field.text,
            scope,
          )
        ) {
          this.#noteCompanionCandidate(expression.callee.field.text);
        }
        return {
          ...expression,
          callee: this.#resolveExpr(expression.callee, scope),
          arguments: expression.arguments.map((argument) =>
            this.#resolveExpr(argument, scope),
          ),
        };
      case "Access":
        if (expression.receiver.kind === "Name") {
          // The guard below asks whether a *declaration* claims the qualifier,
          // and a prelude module is one: `#namedModule` covers the explicit
          // `import * as` alias and the implicit prelude home alike (Modules
          // §6.4). Testing `#moduleAliases` alone would let the compiler's own
          // machinery outrank a prelude member, which is exactly the resolution
          // order Modules §5.5 forbids — and it is what kept `Seq.map` bound to
          // the intrinsic family after `Seq.hex` joined the set.
          //
          // One guard, not three: `Vector`'s, `Map`'s and `Set`'s went at their
          // self-declaration milestones (#370, #373), and `Node` is what the
          // family has left (`spec/intrinsics.md` §3.3, §9.2; #223). It is
          // `#runtime`-gated, so no user program can reach it at all.
          if (
            this.#runtime &&
            expression.receiver.name.text === "Node" &&
            ["empty", "get", "set", "copy"].includes(expression.field.text) &&
            scope.lookup("Node") === undefined &&
            this.#namedModule("Node") === undefined
          ) {
            return {
              kind: "CollectionOperation",
              collection: "Node",
              operation: expression.field.text,
              span: expression.span,
            };
          }
          // No primitive door here, and no transitional companion spelling
          // either: both died with the last companion (`spec/intrinsics.md`
          // §9.2, #344). Every primitive has a real module now, so `Float.mod`
          // and `Int.show` are the ordinary reads below — the module's exported
          // terms, then Modules §5.3's honored members.
          const importedModule = this.#namedModule(expression.receiver.name.text);
          if (importedModule !== undefined) {
            // §3.3/§5.3, in order: the module's exported terms, then the members
            // of constraints it **declares** — the polymorphic read, which is
            // why a declaring module that also honors answers with the
            // declaration — then the members of instances it honors at a type of
            // its own. Read after `terms`, never merged into it: a member is not
            // an independently importable name (§3.1).
            const symbol = importedModule.terms.get(expression.field.text) ??
              importedModule.constraintMembers.get(expression.field.text);
            if (symbol === undefined) {
              const honored = this.#honoredMemberAccess(
                importedModule,
                expression.receiver.name.text,
                expression.field,
              ) ??
                this.#providedRowMemberAccess(
                  importedModule,
                  expression.receiver.name.text,
                  expression.field,
                );
              if (honored !== undefined) return honored;
              this.#diagnostics.add({
                severity: "error",
                message: curatedCompanionMiss(
                  importedModule.module.companionPrimitive,
                  expression.field.text,
                ) ??
                  `module \`${expression.receiver.name.text}\` does not export \`${expression.field.text}\``,
                primary: expression.field.span,
              });
              return { kind: "ErrorExpr", span: expression.span };
            }
            this.#importedSymbols.set(symbol.id, symbol);
            const preludeLocal = this.#reachPreludeTerm(symbol.id);
            if (preludeLocal !== undefined) {
              return { kind: "Name", symbol: symbol.id, text: preludeLocal, span: expression.span };
            }
            return {
              kind: "Name",
              symbol: symbol.id,
              text: `${expression.receiver.name.text}.${expression.field.text}`,
              span: expression.span,
            };
          }
        }
        return {
          ...expression,
          receiver: this.#resolveExpr(expression.receiver, scope),
          field: {
            text: expression.field.text,
            startClass: expression.field.startClass,
            span: expression.field.span,
          },
        };
      case "Index":
        return {
          ...expression,
          receiver: this.#resolveExpr(expression.receiver, scope),
          index: this.#resolveExpr(expression.index, scope),
        };
      case "Unary":
        return {
          ...expression,
          operand: this.#resolveExpr(expression.operand, scope),
        };
      case "Binary":
        return {
          ...expression,
          left: this.#resolveExpr(expression.left, scope),
          right: this.#resolveExpr(expression.right, scope),
        };
      case "Comparison":
        return {
          ...expression,
          operands: expression.operands.map((operand) =>
            this.#resolveExpr(operand, scope),
          ),
        };
      case "Assignment":
        if (expression.target.kind !== "Name") {
          this.#diagnostics.add({
            severity: "error",
            message: "assignment targets a bare name; records and tuples are immutable",
            primary: expression.target.span,
          });
        }
        return {
          ...expression,
          target: this.#resolveExpr(expression.target, scope),
          value: this.#resolveExpr(expression.value, scope),
        };
    }
  }

  #resolvePattern(
    pattern: Parsed.Pattern,
    scope: Scope,
    seen: Map<string, Resolved.Binding>,
    binderClass: BinderClass,
    sharedBindings?: ReadonlyMap<string, Resolved.Binding>,
  ): Resolved.Pattern {
    if (
      pattern.kind === "Wildcard" ||
      pattern.kind === "Unit" ||
      pattern.kind === "Integer" ||
      pattern.kind === "String"
    ) return pattern;
    if (pattern.kind === "Or") {
      const namesByAlternative = pattern.alternatives.map((alternative) =>
        Parsed.patternNames(alternative)
      );
      const expected = new Set(namesByAlternative[0]?.map(({ text }) => text));
      for (const names of namesByAlternative.slice(1)) {
        const actual = new Set(names.map(({ text }) => text));
        for (const name of new Set([...expected, ...actual])) {
          if (expected.has(name) !== actual.has(name)) {
            this.#diagnostics.add({
              severity: "error",
              message: `\`${name}\` must be bound in every alternative of an or-pattern`,
              primary: pattern.span,
            });
          }
        }
      }

      const sourceNames = new Map<string, Parsed.Name>();
      for (const name of namesByAlternative.flat()) {
        if (!sourceNames.has(name.text)) sourceNames.set(name.text, name);
      }
      const shared = new Map(sharedBindings);
      for (const [text, name] of sourceNames) {
        if (shared.has(text)) continue;
        const claimed = this.#claimBinder(name, scope, binderClass);
        const binding = this.#declare(name, declaredKind(binderClass));
        shared.set(text, binding);
        if (claimed) {
          scope.define(
            text,
            binding.symbol,
            binderClass === "sequential" ? this.#sequentialVisibleFrom : undefined,
          );
        }
      }
      return {
        kind: "Or",
        alternatives: pattern.alternatives.map((alternative) =>
          this.#resolvePattern(alternative, scope, new Map(), binderClass, shared)
        ),
        span: pattern.span,
      };
    }
    if (pattern.kind === "As") {
      const nested = this.#resolvePattern(
        pattern.pattern,
        scope,
        seen,
        binderClass,
        sharedBindings,
      );
      const binder = this.#resolvePattern(
        { kind: "Binding", name: pattern.name, span: pattern.name.span },
        scope,
        seen,
        binderClass,
        sharedBindings,
      );
      return {
        kind: "As",
        pattern: nested,
        binding: (binder as Resolved.BindingPattern).binding,
        span: pattern.span,
      };
    }
    if (pattern.kind === "Constructor") {
      const symbol = scope.lookup(pattern.name.text);
      if (symbol === undefined || this.#symbol(symbol).kind !== "constructor") {
        const later = symbol === undefined
          ? this.#findLaterDeclaration(pattern.name.text)
          : undefined;
        this.#diagnostics.add(
          later === undefined
            ? {
                severity: "error",
                message: `unknown constructor \`${pattern.name.text}\``,
                primary: pattern.name.span,
              }
            : {
                severity: "error",
                message: `\`${pattern.name.text}\` is declared later in this block; ` +
                  "declarations are read top-down — move the " +
                  `${later.owner ?? "declaration"}'s declaration above this use`,
                primary: pattern.name.span,
                labels: [{ span: later.name.span, message: "declared here" }],
              },
        );
        return { kind: "Wildcard", span: pattern.span };
      }
      return {
        kind: "Constructor",
        symbol,
        text: pattern.name.text,
        nameSpan: pattern.name.span,
        arguments: pattern.arguments.map((argument) =>
          this.#resolvePattern(argument, scope, seen, binderClass, sharedBindings),
        ),
        span: pattern.span,
      };
    }
    if (pattern.kind === "Tuple") {
      return {
        ...pattern,
        elements: pattern.elements.map((element) =>
          this.#resolvePattern(element, scope, seen, binderClass, sharedBindings),
        ),
      };
    }
    if (pattern.kind === "Vector") {
      const resolvedRest = pattern.rest === undefined
        ? undefined
        : {
            index: pattern.rest.index,
            span: pattern.rest.span,
            ...(pattern.rest.pattern === undefined
              ? {}
              : { pattern: this.#resolvePattern(pattern.rest.pattern, scope, seen, binderClass, sharedBindings) }),
          };
      return {
        kind: "Vector",
        elements: pattern.elements.map((element) =>
          this.#resolvePattern(element, scope, seen, binderClass, sharedBindings)
        ),
        ...(resolvedRest === undefined ? {} : { rest: resolvedRest }),
        span: pattern.span,
      };
    }
    if (pattern.kind === "Record") {
      return {
        kind: "Record",
        fields: pattern.fields.map((field) => ({
          name: field.name.text,
          nameSpan: field.name.span,
          pattern: this.#resolvePattern(
            field.pattern,
            scope,
            seen,
            binderClass,
            sharedBindings,
          ),
          span: field.span,
        })),
        span: pattern.span,
      };
    }

    // Binding twice within one pattern is simultaneous duplication, not
    // shadowing (§5.1 rule 3): it is an error in every class, and it settles the
    // name before the class ever gets a say. An or-pattern's alternatives share
    // one binding per name (`sharedBindings`), already claimed above.
    const duplicate = seen.get(pattern.name.text);
    if (duplicate !== undefined) {
      this.#diagnostics.add({
        severity: "error",
        message: `\`${pattern.name.text}\` is bound twice in this pattern`,
        primary: pattern.name.span,
        labels: [{ span: duplicate.span, message: "first binding is here" }],
      });
    }
    const claimed = duplicate === undefined && sharedBindings === undefined &&
      this.#claimBinder(pattern.name, scope, binderClass);

    const binding = sharedBindings?.get(pattern.name.text) ??
      this.#declare(pattern.name, declaredKind(binderClass));
    seen.set(pattern.name.text, binding);
    if (claimed) {
      scope.define(
        pattern.name.text,
        binding.symbol,
        binderClass === "sequential" ? this.#sequentialVisibleFrom : undefined,
      );
    }
    return { kind: "Binding", binding, span: pattern.span };
  }

  /**
   * Settles one pattern binder against the names already in scope, per its
   * Statements §5 class, and reports the conflict if it has one. Answers whether
   * the binder may go on to own its name in `scope`; a rejected binder leaves the
   * existing meaning in place, so the names after it still resolve to what they
   * did before the error.
   */
  #claimBinder(name: Parsed.Name, scope: Scope, binderClass: BinderClass): boolean {
    // Rule 2: a head binder may shadow anything, and it owns its scope outright.
    if (binderClass === "head") return true;

    // A pattern parameter is a head binder too, but it shares the lambda's scope
    // with the parameters beside it, so a name already bound *there* is a second
    // parameter of that name — duplication (rule 3), not shadowing. Everything
    // further out it may shadow, exactly as a plain parameter does.
    if (binderClass === "parameter") {
      const sibling = scope.lookupLocal(name.text);
      if (sibling === undefined) return true;
      // Order the pair by source position, not by which one resolved second.
      // Every plain parameter binds before any pattern parameter is resolved, so
      // a pattern binder is always the later claimant even when it was written
      // first — reporting in claim order would label the *second* `p` of
      // `f({p}, p)` as the first one. Two plain parameters have never had that
      // problem, and this keeps the whole family reading the same way: the
      // primary marks the repeat, the label marks what it repeats.
      const [first, second] = orderedBySource(this.#symbol(sibling).bindingSpan, name.span);
      this.#diagnostics.add({
        severity: "error",
        message: `duplicate parameter \`${name.text}\``,
        primary: second,
        labels: [{ span: first, message: "first parameter is here" }],
      });
      return false;
    }

    // Rule 1, layered by Modules §5.4: a binder in the module's own scope may
    // occlude a prelude name on the same scope-identity test `let`, `fun`, and
    // constraint members use; in any inner layer the ban is absolute, so the
    // lookup walks all the way out.
    const existing = scope === this.#moduleScope
      ? scope.lookupLocal(name.text)
      : scope.lookup(name.text);
    if (existing === undefined) return true;
    this.#reportRebinding(name, existing);
    return false;
  }

  /**
   * Refuses a bare reference that landed on the prelude layer for a name two or
   * more visible members export, reporting every qualified home.
   *
   * The test is on the *layer the name resolved in*, not on the symbol: a
   * prelude term and an explicit import of it are one `SymbolId`, and an
   * explicit import is a module-level binding (Modules §5.4). So is a local
   * declaration of the name. Both occlude the prelude layer whole, collided or
   * not, and both are rewrites this diagnostic does not need to name — the
   * reference in front of the reader is bare, and the local, obvious fix for a
   * bare reference is to qualify it.
   *
   * The refusal reaches the bare spelling and nothing else. `Seq.empty` never
   * comes through here (the `Access` case resolves a qualifier against
   * `#namedModule`), and neither does `values.length()`: dispatch is
   * type-directed (Method Syntax §1) and reads `#preludeTermsByName`, which holds
   * every member's term precisely so an occluded one stays reachable. Dot call is
   * the mitigation this ruling leans on, so it must not be collateral.
   */
  #refusedAmbiguousPrelude(name: Parsed.Name, scope: Scope): boolean {
    if (scope.lookupOwner(name.text) !== this.#preludeScope) return false;
    const homes = this.#preludeHomesByName.get(name.text) ?? [];
    if (homes.length < 2) return false;
    this.#diagnostics.add({
      severity: "error",
      message: `the prelude name \`${name.text}\` is ambiguous: exported by ` +
        `${conjoin(homes.map((home) => `\`${home}\``), "and")}; write ` +
        `${conjoin(homes.map((home) => `\`${home}.${name.text}\``), "or")}`,
      primary: name.span,
    });
    return true;
  }

  /**
   * The signpost standing where the host console operation used to be (#417),
   * answering with the refused callee so its caller can rebuild the call.
   *
   * `console.log(...)` is not an operation of this language: there is no ambient
   * `console`, and the debugging probe a writer reaching for it wants is
   * `Debug.log` (Effects §6.2). The shape check that once admitted the form is
   * kept only to say so, because the sentences it decays to — an unknown name,
   * and a member access on it — name neither the mistake nor the replacement.
   *
   * Saying so is the whole of the difference. The caller keeps the *shape* the
   * ordinary recovery would have built, resolved arguments and all, so
   * `console.log(x, nmae)` reports the typo exactly as `console.warn(x, nmae)`
   * does and the editor's queries still reach into the argument list. Arguments
   * are resolved and retained, never resolved and dropped: a dropped reference
   * would leave its prelude term in the used set with nothing referring to it.
   *
   * A `console` in scope takes the call back: the receiver is that binding, the
   * access means whatever the binding means, and no report is owed.
   *
   * The rewrite is offered for a single argument and no other arity. This pass
   * sees no types, and `log` takes one rendered `String` — so one argument is
   * the shape a mechanical rewrite can produce honestly, and a wrongly-typed one
   * meets `log`'s parameter at the checker, which is a better place to arrive
   * than nowhere. Several arguments or none have no such rewrite: the
   * interpolation is the writer's move.
   */
  #refusedHostConsoleLog(
    expression: Parsed.CallExpr,
    scope: Scope,
  ): Parsed.AccessExpr | undefined {
    const callee = expression.callee;
    if (
      callee.kind !== "Access" ||
      callee.receiver.kind !== "Name" ||
      callee.receiver.name.text !== "console" ||
      callee.field.text !== "log" ||
      scope.lookup("console") !== undefined
    ) {
      return undefined;
    }
    this.#diagnostics.add({
      severity: "error",
      message: "`console.log` is not a Hexagon operation; the debugging probe " +
        "is `log` (`Debug.log`)",
      primary: callee.span,
      ...(expression.arguments.length === 1
        ? {
          fixes: [{
            message: "write `log`",
            edits: [{ span: callee.span, replacement: "log" }],
          }],
        }
        : {}),
    });
    return callee;
  }

  #resolveName(expression: Parsed.NameExpr, scope: Scope): Resolved.Expr {
    const symbol = scope.lookup(expression.name.text);
    if (symbol !== undefined) {
      // Before anything is made of the symbol: a refused reference names no
      // term, so it must not join the used-prelude set the synthesized import is
      // built from, and `ErrorExpr` poisons the checker's view of it the way an
      // unknown name does — one diagnostic for the program, not a cascade.
      if (this.#refusedAmbiguousPrelude(expression.name, scope)) {
        return { kind: "ErrorExpr", span: expression.span };
      }
      if (this.#refusedMemberReference(expression.name, symbol)) {
        return { kind: "ErrorExpr", span: expression.span };
      }
      const owner = this.#varOwners.get(symbol);
      if (owner !== undefined && owner < this.#lambdaDepth) {
        this.#diagnostics.add({
          severity: "error",
          message: `\`${expression.name.text}\` is a \`var\` and cannot be used inside a lambda; copy it to a \`let\` first`,
          primary: expression.span,
          labels: [{ span: this.#symbol(symbol).bindingSpan, message: "mutable binding declared here" }],
        });
      }
      if (this.#preludeTerms.has(symbol)) this.#usedPreludeSymbols.add(symbol);
      return {
        kind: "Name",
        symbol,
        text: expression.name.text,
        span: expression.span,
      };
    }

    const pending = this.#findPending(expression.name.text);
    if (pending !== undefined) {
      this.#diagnostics.add({
        severity: "error",
        message: pending.kind === "let"
          ? `\`${expression.name.text}\` is not in scope in its own \`let\` definition; \`let\` is non-recursive — use \`fun\`.`
          : `\`${expression.name.text}\` is not in scope in its own \`var\` definition; initialize it from an earlier binding`,
        primary: expression.span,
        labels: [{ span: pending.name.span, message: "binding declared here" }],
      });
      return { kind: "ErrorExpr", span: expression.span };
    }

    const later = this.#findLaterDeclaration(expression.name.text);
    this.#diagnostics.add(
      later === undefined
        ? {
            severity: "error",
            message: `unknown name \`${expression.name.text}\``,
            primary: expression.span,
          }
        : {
            severity: "error",
            message: `\`${expression.name.text}\` is declared later in this block; ` +
              (later.split
                ? "only an unbroken run of `fun`s recurses together — move the " +
                  `intervening declaration out of the run, or move \`${expression.name.text}\`'s ` +
                  "declaration above this use"
                : "declarations are read top-down — move its declaration above this use"),
            primary: expression.span,
            labels: [{ span: later.name.span, message: "declared here" }],
          },
    );

    return { kind: "ErrorExpr", span: expression.span };
  }

  /**
   * The declaration of `name` further down an enclosing block, if there is one.
   *
   * `split` marks the case §7.3 owns rather than §7.2: both sides are `fun`s of
   * the same block, so they would have recursed together had an item not been
   * written between them.
   */
  #findLaterDeclaration(
    name: string,
  ): (LaterDeclaration & { readonly split: boolean }) | undefined {
    for (let index = this.#blockDeclarations.length - 1; index >= 0; index -= 1) {
      const frame = this.#blockDeclarations[index];
      const declaration = frame?.later.get(name);
      if (frame === undefined || declaration === undefined) continue;
      return {
        ...declaration,
        split: declaration.fun &&
          this.#currentFunctions.some((symbol) => frame.funSymbols.has(symbol)),
      };
    }
    return undefined;
  }

  #resolveLambda(
    expression: Parsed.LambdaExpr,
    scope: Scope,
    impliedContext?: { readonly owner: string; readonly names: ReadonlySet<string> },
  ): Resolved.LambdaExpr {
    this.#lambdaDepth += 1;
    const lambdaScope = this.#openScope(scope, expression.span);
    const parameters = expression.parameters.map((parameter) => {
      const existing = lambdaScope.lookupLocal(parameter.name.text);
      const binding = this.#declare(parameter.name, "parameter");

      if (existing === undefined) {
        lambdaScope.define(parameter.name.text, binding.symbol);
      } else {
        const previous = this.#symbol(existing);
        this.#diagnostics.add({
          severity: "error",
          message: `duplicate parameter \`${parameter.name.text}\``,
          primary: parameter.name.span,
          labels: [
            { span: previous.bindingSpan, message: "first parameter is here" },
          ],
        });
      }

      const annotation = parameter.annotation === undefined
        ? undefined
        : this.#resolveTypeAnnotation(parameter.annotation, new Set(), impliedContext);
      return {
        ...binding,
        ...(annotation === undefined ? {} : { annotation }),
      };
    });

    // A pattern parameter's binders are head binders whichever spelling
    // introduced them (Pattern Matching §6.5), so they bind here — in the
    // lambda's own scope, beside the plain parameters and under the same rules —
    // rather than in the body, where the surrounding `let`'s sequential class
    // would be the only one on offer (Statements §5.2's pre-desugar warning).
    // The equivalent `let` still opens the body, and is checked, typed, and
    // emitted as a written one: only the classification happens up here.
    const destructurings = (expression.destructurings ?? []).map(
      (destructuring): Resolved.LetPatternItem => {
        const value = this.#resolveExpr(
          { kind: "Name", name: destructuring.name, span: destructuring.span },
          lambdaScope,
        );
        return {
          kind: "LetPattern",
          exported: false,
          pattern: this.#resolvePattern(
            destructuring.pattern,
            lambdaScope,
            new Map(),
            "parameter",
          ),
          value,
          span: destructuring.span,
        };
      },
    );

    const resolved: Resolved.LambdaExpr = {
      kind: "Lambda",
      parameters,
      ...(expression.typeParameters === undefined
        ? {}
        : {
            typeParameters: expression.typeParameters.map((parameter) => ({
              name: parameter.name.text,
              constraints: parameter.constraints.map(({ text }) => text),
              span: parameter.span,
            })),
          }),
      ...(expression.returnAnnotation === undefined
        ? {}
        : { returnAnnotation: this.#resolveTypeAnnotation(expression.returnAnnotation, new Set(), impliedContext) }),
      body: openedWith(destructurings, this.#resolveExpr(expression.body, lambdaScope)),
      span: expression.span,
    };
    this.#lambdaDepth -= 1;
    return resolved;
  }

  #resolveTypeAnnotation(
    annotation: Parsed.TypeAnnotation,
    typeParameters = new Set<string>(),
    impliedContext?: { readonly owner: string; readonly names: ReadonlySet<string> },
    substitutions: ReadonlyMap<string, Resolved.TypeAnnotation> = new Map(),
  ): Resolved.TypeAnnotation {
    if (annotation.kind === "Function") {
      return {
        kind: "Function",
        parameters: annotation.parameters.map((parameter) =>
          this.#resolveTypeAnnotation(parameter, typeParameters, impliedContext, substitutions)
        ),
        result: this.#resolveTypeAnnotation(
          annotation.result,
          typeParameters,
          impliedContext,
          substitutions,
        ),
        ...(annotation.effect === undefined ? {} : { effect: annotation.effect }),
        ...(annotation.arrowSpan === undefined ? {} : { arrowSpan: annotation.arrowSpan }),
        span: annotation.span,
      };
    }
    if (annotation.kind === "Tuple") {
      return {
        kind: "Tuple",
        elements: annotation.elements.map((element) =>
          this.#resolveTypeAnnotation(element, typeParameters, impliedContext, substitutions),
        ),
        span: annotation.span,
      };
    }
    if (annotation.kind === "Record") {
      return {
        kind: "Record",
        fields: annotation.fields.map((field) => ({
          name: field.name.text,
          annotation: this.#resolveTypeAnnotation(field.annotation, typeParameters, impliedContext, substitutions),
          span: field.span,
        })),
        open: annotation.open,
        ...(annotation.tail === undefined ? {} : { tail: annotation.tail.text }),
        span: annotation.span,
      };
    }
    if (annotation.kind === "Hole") {
      // Minted per *written* `_`, which is the only place a hole enters the
      // resolved tree: every later copy is made by substitution, which spreads
      // the node and so carries this id — and its seeded constraints — with it.
      return {
        kind: "Hole",
        id: this.#nextHole++,
        constraints: annotation.constraints.map(({ text }) => text),
        span: annotation.span,
      };
    }
    if (annotation.kind === "TypeVariable") {
      const replacement = substitutions.get(annotation.name.text);
      if (replacement !== undefined) return withTypeSpan(replacement, annotation.span);
      return {
        kind: "TypeVariable",
        name: annotation.name.text,
        span: annotation.span,
      };
    }
    const name = annotation.kind === "AppliedType"
      ? annotation.constructor.text
      : annotation.name.text;
    if (annotation.qualifier !== undefined) {
      const imported = this.#namedModule(annotation.qualifier.text);
      if (imported === undefined) {
        this.#diagnostics.add({
          severity: "error",
          message: `unknown module alias \`${annotation.qualifier.text}\``,
          primary: annotation.qualifier.span,
        });
        return { kind: "ErrorType", span: annotation.span };
      }
      const arguments_ = annotation.kind === "AppliedType"
        ? annotation.arguments.map((argument) => this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions))
        : [];
      const union = imported.unions.get(name);
      if (union !== undefined) return this.#resolvedNominalType("union", union, name, arguments_, annotation.span);
      const record = imported.records.get(name);
      if (record !== undefined) return this.#resolvedNominalType("record", record, name, arguments_, annotation.span);
      const alias = imported.aliases.get(name);
      if (alias !== undefined) return this.#instantiateResolvedAlias(alias, arguments_, annotation.span);
      const externType = imported.externTypes.get(name);
      if (externType !== undefined) {
        if (arguments_.length > 0) {
          this.#diagnostics.add({
            severity: "error",
            message: `extern type \`${name}\` is monomorphic and takes no type arguments`,
            primary: annotation.span,
          });
        }
        return {
          kind: "ExternType",
          externType: externType.externType,
          name: `${annotation.qualifier.text}.${name}`,
          span: annotation.span,
        };
      }
      this.#diagnostics.add({
        severity: "error",
        message: `module \`${annotation.qualifier.text}\` does not export type \`${name}\``,
        primary: annotation.span,
      });
      return { kind: "ErrorType", span: annotation.span };
    }
    if (impliedContext?.names.has(name)) {
      if (annotation.kind === "AppliedType") {
        this.#diagnostics.add({
          severity: "error",
          message: `\`${name}\` is an implied type of \`${impliedContext.owner}\` and cannot be applied in v1`,
          primary: annotation.span,
        });
        return { kind: "ErrorType", span: annotation.span };
      }
      return {
        kind: "ImpliedType",
        constraint: impliedContext.owner,
        name,
        span: annotation.span,
      };
    }
    const alias = this.#typeAliases.get(name);
    if (alias !== undefined) {
      const arguments_ = annotation.kind === "AppliedType"
        ? annotation.arguments.map((argument) => this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions))
        : [];
      return isResolvedTypeAlias(alias)
        ? this.#instantiateResolvedAlias(alias, arguments_, annotation.span)
        : this.#resolveAlias(name, arguments_, annotation.span, typeParameters, impliedContext, substitutions);
    }
    const externType = this.#externTypeNames.get(name);
    if (externType !== undefined) {
      if (annotation.kind === "AppliedType") {
        this.#diagnostics.add({
          severity: "error",
          message: `extern type \`${name}\` is monomorphic and takes no type arguments`,
          primary: annotation.span,
        });
      }
      return { kind: "ExternType", externType, name, span: annotation.span };
    }
    const union = this.#unionNames.get(name);
    if (union !== undefined) {
      const arguments_ = annotation.kind === "AppliedType"
        ? annotation.arguments.map((argument) =>
          this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions)
        )
        : [];
      const expected = this.#unionArities.get(name) ?? 0;
      if (arguments_.length !== expected) {
        this.#diagnostics.add({
          severity: "error",
          message: `type \`${name}\` expects ${expected} argument${expected === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
          primary: annotation.span,
        });
      }
      return {
        kind: "Union",
        union,
        name,
        arguments: arguments_,
        span: annotation.span,
      };
    }
    // Declarations outrank the compiler's own type machinery (Modules §5.5): the
    // record table is consulted here, alongside the alias/extern/union tables
    // above, so the intrinsic branch below is reached only when no declaration
    // claims the name. Records were once tested *after* the intrinsics while
    // unions were tested before them; that asymmetry was the resolution-order
    // defect (defect log entry 6), not a rule.
    const declaredRecord = this.#recordNames.get(name);
    if (declaredRecord !== undefined) {
      const arguments_ = annotation.kind === "AppliedType"
        ? annotation.arguments.map((argument) =>
          this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions)
        )
        : [];
      const expected = this.#recordArities.get(name) ?? 0;
      if (arguments_.length !== expected) {
        this.#diagnostics.add({
          severity: "error",
          message: `type \`${name}\` expects ${expected} argument${expected === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
          primary: annotation.span,
        });
      }
      return { kind: "RecordDeclaration", record: declaredRecord, name, arguments: arguments_, span: annotation.span };
    }
    if (annotation.kind === "AppliedType") {
      if (this.#runtime && name === "Node") {
        // `Node(a)` is spellable only inside a runtime module; elsewhere it falls
        // through to the unknown-generic-type path, keeping the intrinsic hidden.
        if (annotation.arguments.length !== 1) {
          this.#diagnostics.add({
            severity: "error",
            message: `type \`Node\` expects 1 argument, but ${annotation.arguments.length} were provided`,
            primary: annotation.span,
          });
        }
        const element = annotation.arguments[0] === undefined
          ? { kind: "ErrorType" as const, span: annotation.span }
          : this.#resolveTypeAnnotation(annotation.arguments[0], typeParameters, impliedContext, substitutions);
        return { kind: "Node", element, span: annotation.span };
      }
      // `Seq` is gone from this list: it is a prelude *declaration* now (Loops
      // §6.6), reached through the record table above. The names left are the
      // boundary intrinsics that no `.hex` module declares — `JsMap` and
      // `JsSet` (FFI Part 10 §1) among them, reached here for the same reason
      // `Array` is: a borrowed foreign view has no Hexagon declaration site.
      if (
        name === "Vector" || name === "Set" || name === "Array" ||
        name === "Nullable" || name === "JsSet"
      ) {
        if (annotation.arguments.length !== 1) {
          this.#diagnostics.add({
            severity: "error",
            message: `type \`${name}\` expects 1 argument, but ${annotation.arguments.length} were provided`,
            primary: annotation.span,
          });
        }
        const argument = annotation.arguments[0] === undefined
          ? { kind: "ErrorType" as const, span: annotation.span }
          : this.#resolveTypeAnnotation(annotation.arguments[0], typeParameters, impliedContext, substitutions);
        if (name === "Nullable") return { kind: "Nullable", value: argument, span: annotation.span };
        if (name === "Vector") return { kind: "Vector", element: argument, span: annotation.span };
        if (name === "Set") return { kind: "Set", element: argument, span: annotation.span };
        if (name === "JsSet") return { kind: "JsSet", element: argument, span: annotation.span };
        return { kind: "Array", element: argument, span: annotation.span };
      }
      if (name === "Map" || name === "JsMap") {
        if (annotation.arguments.length !== 2) {
          this.#diagnostics.add({
            severity: "error",
            message: `type \`${name}\` expects 2 arguments, but ${annotation.arguments.length} were provided`,
            primary: annotation.span,
          });
        }
        const key = annotation.arguments[0] === undefined
          ? { kind: "ErrorType" as const, span: annotation.span }
          : this.#resolveTypeAnnotation(annotation.arguments[0], typeParameters, impliedContext, substitutions);
        const value = annotation.arguments[1] === undefined
          ? { kind: "ErrorType" as const, span: annotation.span }
          : this.#resolveTypeAnnotation(annotation.arguments[1], typeParameters, impliedContext, substitutions);
        if (name === "JsMap") return { kind: "JsMap", key, value, span: annotation.span };
        return { kind: "Map", key, value, span: annotation.span };
      }
      this.#diagnostics.add({
        severity: "error",
        message: `unknown generic type \`${name}\``,
        primary: annotation.span,
      });
      return { kind: "ErrorType", span: annotation.span };
    }
    if (isPrimitiveName(annotation.name.text)) {
      return {
        kind: "Primitive",
        name: annotation.name.text,
        span: annotation.span,
      };
    }
    if (annotation.name.text === "Range") {
      return { kind: "Range", span: annotation.span };
    }

    const owners = this.#impliedTypeOwners.get(name);
    if (owners !== undefined) {
      const ownerNames = [...owners].sort();
      const ownership = ownerNames.length === 1
        ? `of \`${ownerNames[0]}\``
        : `declared by ${ownerNames.map((owner) => `\`${owner}\``).join(" and ")}`;
      this.#diagnostics.add({
        severity: "error",
        message: `\`${name}\` is an implied type ${ownership} and cannot appear in type expressions`,
        primary: annotation.span,
      });
      return { kind: "ErrorType", span: annotation.span };
    }
    this.#diagnostics.add({
      severity: "error",
      message:
        `unknown type \`${annotation.name.text}\`; this slice supports primitive, ` +
        "tuple, and declared union types",
      primary: annotation.span,
    });
    return { kind: "ErrorType", span: annotation.span };
  }

  #declare(name: Parsed.Name, kind: Resolved.SymbolKind): Resolved.Binding {
    const symbol = Resolved.symbolId(this.#nextSymbol++);
    this.#symbols.set(symbol, {
      id: symbol,
      name: name.text,
      kind,
      bindingSpan: name.span,
    });
    return { symbol, name: name.text, span: name.span };
  }

  #resolveAlias(
    name: string,
    arguments_: readonly Resolved.TypeAnnotation[],
    span: Source.Span,
    outerParameters = new Set<string>(),
    impliedContext?: { readonly owner: string; readonly names: ReadonlySet<string> },
    outerSubstitutions: ReadonlyMap<string, Resolved.TypeAnnotation> = new Map(),
  ): Resolved.TypeAnnotation {
    const alias = this.#typeAliases.get(name);
    if (alias === undefined || isResolvedTypeAlias(alias)) return { kind: "ErrorType", span };
    if (this.#resolvingAliases.includes(name)) {
      const cycle = [...this.#resolvingAliases.slice(this.#resolvingAliases.indexOf(name)), name];
      this.#diagnostics.add({
        severity: "error",
        message: `recursive type alias cycle: ${cycle.map((part) => `\`${part}\``).join(" -> ")}`,
        primary: span,
      });
      return { kind: "ErrorType", span };
    }
    if (arguments_.length !== alias.parameters.length) {
      this.#diagnostics.add({
        severity: "error",
        message: `type alias \`${name}\` expects ${alias.parameters.length} argument${alias.parameters.length === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
        primary: span,
      });
    }
    const replacements = new Map(outerSubstitutions);
    alias.parameters.forEach((parameter, index) => {
      replacements.set(parameter.text, arguments_[index] ?? { kind: "ErrorType", span });
    });
    this.#resolvingAliases.push(name);
    const result = this.#resolveTypeAnnotation(
      alias.annotation,
      new Set([...outerParameters, ...alias.parameters.map(({ text }) => text)]),
      impliedContext,
      replacements,
    );
    this.#resolvingAliases.pop();
    return withTypeSpan(result, span);
  }

  /**
   * Effects §4.4's report, for every `->?` written in an alias body.
   *
   * Every occurrence is reported, not just the first: they are independent
   * mistakes and a writer fixing one arrow should not have to recompile to
   * discover the next.
   */
  #refuseLinkedArrows(annotation: Parsed.TypeAnnotation): boolean {
    let found = false;
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const child of node) walk(child);
        return;
      }
      const record = node as {
        kind?: unknown;
        effect?: unknown;
        arrowSpan?: Source.Span;
      };
      if (record.kind === "Function" && record.effect === "linked") {
        found = true;
        const arrowSpan = record.arrowSpan;
        if (arrowSpan !== undefined) {
          this.#diagnostics.add({
            severity: "error",
            message:
              "`->?` is the caller's colour, and this position has no caller to " +
              "choose it — an alias is a type fragment, not a signature; write " +
              "`->!` for a function that pulls the world, or `->` for one that does not",
            primary: arrowSpan,
            fixes: [{
              message: "write `->!`",
              edits: [{ span: arrowSpan, replacement: "->!" }],
            }],
          });
        }
      }
      for (const [key, child] of Object.entries(record)) {
        if (key === "span" || key === "arrowSpan") continue;
        walk(child);
      }
    };
    walk(annotation);
    return found;
  }

  #instantiateResolvedAlias(
    alias: Resolved.TypeAliasItem,
    arguments_: readonly Resolved.TypeAnnotation[],
    span: Source.Span,
  ): Resolved.TypeAnnotation {
    if (arguments_.length !== alias.parameters.length) {
      this.#diagnostics.add({
        severity: "error",
        message: `type alias \`${alias.name}\` expects ${alias.parameters.length} argument${alias.parameters.length === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
        primary: span,
      });
    }
    const replacements = new Map(alias.parameters.map((parameter, index) => [
      parameter,
      arguments_[index] ?? { kind: "ErrorType" as const, span },
    ]));
    return substituteResolvedType(alias.annotation, replacements, span);
  }

  #resolvedNominalType(
    kind: "union" | "record",
    declaration: Resolved.Union | Resolved.RecordDeclaration,
    name: string,
    arguments_: readonly Resolved.TypeAnnotation[],
    span: Source.Span,
  ): Resolved.TypeAnnotation {
    const expected = declaration.parameters.length;
    if (arguments_.length !== expected) {
      this.#diagnostics.add({
        severity: "error",
        message: `type \`${name}\` expects ${expected} argument${expected === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
        primary: span,
      });
    }
    return kind === "union"
      ? { kind: "Union", union: (declaration as Resolved.Union).id, name, arguments: arguments_, span }
      : { kind: "RecordDeclaration", record: (declaration as Resolved.RecordDeclaration).id, name, arguments: arguments_, span };
  }

  #includeNominals(imported: ModuleInterface, qualifier?: string): void {
    for (const union of imported.unions.values()) {
      if (!this.#unions.some(({ id }) => id === union.id)) this.#unions.push({ ...union, representationVisible: false });
    }
    for (const record of imported.records.values()) {
      if (!this.#records.some(({ id }) => id === record.id)) this.#records.push({ ...record, representationVisible: false });
    }
    for (const externType of imported.externTypes.values()) {
      if (!this.#externTypes.some(({ externType: id }) => id === externType.externType)) {
        this.#externTypes.push({
          ...externType,
          localName: qualifier === undefined
            ? externType.localName
            : `${qualifier}.${externType.localName}`,
        });
      }
    }
  }

  /**
   * Synthesized imports for the prelude terms this module actually references —
   * one per prelude module, carrying exactly the used names and no more.
   * Constructors matched in patterns compile to their string tags and need no
   * import, so only value references (tracked in `#resolveName`) contribute here.
   */
  /**
   * Every identifier the emitted module already binds at its top level.
   *
   * Deliberately **not** a list of binder forms. The first version of this dodge
   * enumerated `let`/`fun`/`var` and silently missed named imports, extern
   * declarations, let-patterns, and constraint members — the same mistake as
   * defect 11, where a rule stated over "module-level binders" was fixed at the
   * two forms that happened to be in front of me. Two structural sources close
   * the set instead:
   *
   * 1. **every symbol this module declared.** `#declare` is the single funnel
   *    for all of them, so no binder form — present or future — can escape it.
   *    It is broader than "top level" (parameters and body locals are in there
   *    too), and being broader is the safe direction: a spare distinguished
   *    local costs nothing, a missed one is a `SyntaxError` at load.
   * 2. **every local an import introduces**, which are bindings this module owns
   *    without declaring.
   */
  #emittedTopLevelNames(resolvedItems: readonly Resolved.Item[]): Set<string> {
    const names = new Set<string>();
    for (const symbol of this.#symbols.values()) names.add(symbol.name);
    for (const item of resolvedItems) {
      if (item.kind !== "Import") continue;
      if (item.form.kind === "Namespace") names.add(item.form.alias);
      if (item.form.kind === "Effect") continue;
      for (const name of item.form.names) names.add(name.local);
    }
    return names;
  }

  #preludeImport(
    span: Source.Span,
    resolvedItems: readonly Resolved.Item[],
  ): readonly Resolved.Item[] {
    const taken = this.#emittedTopLevelNames(resolvedItems);
    const namesBySpecifier = new Map<string, Resolved.ImportName[]>();
    for (const symbol of this.#usedPreludeSymbols) {
      // An explicit import of the same name owns its emission; don't import twice.
      if (this.#explicitlyImported.has(symbol)) continue;
      const term = this.#preludeTerms.get(symbol);
      const specifier = this.#preludeSpecifierBySymbol.get(symbol);
      if (term === undefined || specifier === undefined) continue;
      const names = namesBySpecifier.get(specifier) ?? [];
      // Reaching `Result.tally` from a module that itself binds `tally` is
      // exactly what §6.4 exists for, so importing it *as* `tally` would collide
      // with the binding it is there to see past — and a redeclared identifier
      // is a `SyntaxError` at load, after a clean compile.
      //
      // The dodging local is a generated name like any other, so it probes the
      // way they all do since #425: the preferred spelling first, then
      // underscored numeric suffixes from 1 — `__prelude_map`, then
      // `__prelude_map_1`. The digits used to be glued straight on.
      let local = term.name;
      for (let attempt = 0; taken.has(local); attempt += 1) {
        local = `__prelude_${term.name}${attempt === 0 ? "" : `_${attempt}`}`;
      }
      taken.add(local);
      names.push({ imported: term.name, local, symbol, span });
      namesBySpecifier.set(specifier, names);
    }
    return [...namesBySpecifier].map(([specifier, names]) => ({
      kind: "Import" as const,
      specifier,
      form: { kind: "Named" as const, names },
      // Deliberately empty (#153). This import exists because a *term* was
      // referenced, and instance availability must not depend on that: the
      // prelude's instances ride `Module.preludeInstances` instead, which every
      // module gets whether or not it names a prelude term. Carrying them here
      // as well would put a second copy of the same identity into this module's
      // interface, which consumers would then predict imports of and
      // intermediates re-export — the transit chain #153 exists to cut.
      instances: [],
      // Empty for the same reason: the prelude's constraints are the
      // pre-registered ones, in scope by name in every module with no import.
      constraints: [],
      // Not empty for that reason: these describe the exporting module's own
      // output, and a prelude module names its exports like any other.
      internalNames: internalNameInputs(
        this.#preludeInterfaceBySpecifier.get(specifier),
      ),
      specializableTerms: specializableTerms(
        this.#preludeInterfaceBySpecifier.get(specifier),
      ),
      synthesized: true,
      span,
    }));
  }

  /**
   * The prelude-owned instances visible here, in normative prelude order (#153).
   *
   * Every visible prelude module's interface instances, which is both what it
   * declares and what it carries. Availability, not emission: nothing here is an
   * import, and an entry only becomes one if the emitter finds the elaborated
   * Core actually referencing its dictionary.
   *
   * Called after resolution so `#preludeUnions` is fully seeded — the `Bool`
   * filter below reads it.
   */
  #preludeInstanceChannel(span: Source.Span): readonly Resolved.PreludeInstance[] {
    // The pinned `Bool`'s four constraints are satisfied structurally at every
    // use site (#147 — see the checker's `#resolveRequirement`), so its
    // dictionaries are never referenced and must never be offered: seeding them
    // would put an instance in the checker's universe that competes with the
    // structural answer, and emitting them would import four dead dictionaries
    // into every module that so much as names `Bool` in a signature.
    //
    // What this filter changes, stated exactly, because it is narrower than it
    // looks. Removing it changes no emission and no accepted program: the
    // structural answer wins before instance selection in every reachable case,
    // including a generic dictionary-passing call site (`fun eq<a: Eq>(x, y) =
    // x == y` applied to `Bool`), and the emitter's referenced-only gate then
    // drops what is never selected. Its one observable effect is on programs
    // that already fail: an orphan `honor Eq<Bool>` reports *only* the orphan
    // error, where without the filter it would also report `duplicate instance
    // of Eq<Bool>`.
    //
    // That is an asymmetry against `Ordering` and `Option`, whose orphan honors
    // do report the collision (`prelude-instance-availability.test.ts` pins it),
    // and it is the chosen side. A `Bool` requirement is answered by the pin,
    // not by an instance — so a universe holding no `Bool` instance is the
    // truthful description of this compiler, and reporting a collision against
    // an instance that never participates in selection would not be.
    const boolUnion = this.#preludeUnions.get("Bool");
    const channel: Resolved.PreludeInstance[] = [];
    const seen = new Set<string>();
    for (const [specifier, iface] of this.#preludeInterfaceBySpecifier) {
      for (const instance of iface.instances) {
        if (
          boolUnion !== undefined &&
          instance.subject.kind === "Union" &&
          instance.subject.union === boolUnion
        ) continue;
        // A prelude module's interface carries what it imported as well as what
        // it declared, so the same identity can arrive from two members. The
        // checker deduplicates by identity anyway; collapsing here keeps the
        // emitter's candidate set a set, so one dictionary cannot be imported
        // twice under two local names.
        if (seen.has(instance.identity)) continue;
        seen.add(instance.identity);
        channel.push({
          identity: instance.identity,
          constraint: instance.constraint,
          constraintIdentity: instance.constraintIdentity,
          typeParameters: instance.typeParameters,
          subject: instance.subject,
          impliedTypes: instance.impliedTypes,
          importedDictionary: instance.dictionary,
          // Unaliased, as in the explicit channel; `nameDictionaries` decides.
          localDictionary: instance.dictionary,
          memberSeats: instance.memberSeats,
          // `specifier` above names the prelude member this instance was
          // *found* in, which the deduplication above may have settled on
          // ahead of the module that declares it; the seats are reached at the
          // declaration, so they take their own route (#444).
          ...this.#seatOrigin(instance.declaringPath),
          specifier,
          span,
        });
      }
    }
    return channel;
  }

  #findPending(
    name: string,
  ): { readonly name: Parsed.Name; readonly kind: "let" | "var" } | undefined {
    for (let index = this.#pending.length - 1; index >= 0; index -= 1) {
      const pending = this.#pending[index];
      if (pending?.name.text === name) return pending;
    }
    return undefined;
  }

  /**
   * Binds an imported constraint: the name in the constraint namespace, and
   * **every member** in the term namespace (Modules §3.1).
   *
   * An alias renames the constraint only (§3.2) — the members keep the names
   * their declaration gave them, which is the same reason they cannot be
   * imported severally: they are module-scope terms belonging to a declaration,
   * not exports the import list negotiates one at a time.
   *
   * Returns the synthesized member entries for the import item. They carry
   * `constraintMember` so that emission can tell them from names the source
   * wrote and import only the ones the body reaches.
   */
  #bindImportedConstraint(
    home: ModuleInterface,
    declaration: Resolved.ConstraintItem,
    name: Parsed.ImportName,
    scope: Scope,
    bound: Resolved.ConstraintImport[],
  ): readonly Resolved.ImportName[] {
    const local = name.local.text;
    // Same-namespace collision, reported at the import line (Modules §5.2). A
    // pre-registered name is unavailable for the reason a redeclaration is: the
    // wired-in machinery reaches its constraint by one identity, and a second
    // meaning for the word would be unreachable by it.
    if (
      isPreRegisteredConstraint(local) ||
      this.#declaredConstraintNames.has(local) ||
      this.#importedConstraints.has(local)
    ) {
      this.#diagnostics.add({
        severity: "error",
        message: `constraint \`${local}\` is already declared or imported`,
        primary: name.span,
      });
      return [];
    }
    this.#importedConstraints.set(local, declaration);
    this.#constraintNames.add(local);
    bound.push({ local, declaration });
    return declaration.members.flatMap((member): Resolved.ImportName[] => {
      const symbol = home.constraintMembers.get(member.binding.name);
      if (symbol === undefined) return [];
      const memberName: Parsed.Name = {
        text: member.binding.name,
        startClass: "non-upper",
        span: name.span,
      };
      // A member is an ordinary module-scope term, so §5.4's occlusion rule
      // governs it exactly as it governs an imported function: it may take a
      // prelude name over, and may not collide in its own layer.
      const existing = scope.lookup(member.binding.name);
      if (existing !== undefined && !this.#preludeTerms.has(existing)) {
        this.#reportRebinding(memberName, existing);
      } else {
        scope.define(member.binding.name, symbol.id);
      }
      this.#explicitlyImported.add(symbol.id);
      this.#importedSymbols.set(symbol.id, symbol);
      return [{
        imported: member.binding.name,
        local: member.binding.name,
        symbol: symbol.id,
        constraintMember: true,
        span: name.span,
      }];
    });
  }

  /**
   * A constraint declaration's default member body, marked as such.
   *
   * The mark is the whole point: §4.6's reference laws govern honor blocks, and
   * a default lives in the declaration. Its member references reach whichever
   * instance completes it, at call time — an evidence route, which names no
   * binding, so a self-recursive default is as legal as it ever was.
   */
  #resolveDefaultBody(
    value: Parsed.LambdaExpr,
    scope: Scope,
    impliedContext?: { readonly owner: string; readonly names: ReadonlySet<string> },
  ): Resolved.LambdaExpr {
    this.#inDefaultBody = true;
    const resolved = this.#resolveLambda(value, scope, impliedContext);
    this.#inDefaultBody = false;
    return resolved;
  }

  /**
   * Constraints §4.6's ordering half, indexed before any body is resolved: for
   * each spelling this module's `honor` declarations bind, where each binding's
   * line is.
   *
   * A member definition **enters the module's top-down order at its own line**,
   * so a bare reference to one is legal exactly where any binding reference is:
   * after that line. The index is built from the parsed items because the law is
   * about text, and because a reference in the first honor block has to be able
   * to ask about the last one — which resolution has not reached yet.
   *
   * Three sources of member names per block, because the claim covers every
   * member the instance binds and not only the ones the block writes: the
   * written members, a locally declared constraint's list, and the compiler's
   * table for a pre-registered name. A defaulted member of an *imported* user
   * constraint is the residue, and it can only under-report — never refuse a
   * program §4.6 permits.
   */
  #indexHonoredMemberLines(items: readonly Parsed.Item[]): void {
    const declared = new Map<string, readonly string[]>();
    for (const item of items) {
      if (item.kind !== "ConstraintDeclaration") continue;
      declared.set(
        item.name.text,
        item.members.map((member) => member.name.text),
      );
    }
    const record = (name: string, entry: HonoredMemberLine): void => {
      this.#honoredMemberLines.set(name, [
        ...this.#honoredMemberLines.get(name) ?? [],
        entry,
      ]);
    };
    for (const item of items) {
      if (item.kind === "Union" || item.kind === "RecordDeclaration") {
        for (const derive of item.derives) {
          for (const member of PRE_REGISTERED_CONSTRAINT_MEMBERS[derive.text] ?? []) {
            record(member, { constraint: derive.text, span: item.span });
          }
        }
        continue;
      }
      if (item.kind !== "Honor") continue;
      const constraint = item.constraint.text;
      const names = new Set([
        ...item.members.map((member) => member.name.text),
        ...declared.get(constraint) ?? [],
        ...PRE_REGISTERED_CONSTRAINT_MEMBERS[constraint] ?? [],
      ]);
      for (const name of names) {
        const written = item.members.find((member) => member.name.text === name);
        record(name, { constraint, span: written?.span ?? item.span });
      }
    }
  }

  /**
   * Constraints §4.6, at a bare reference to a spelling this module honors.
   *
   * Three refusals, all of them the law applied to one sentence — a member
   * definition is a module-level binding:
   *
   * - **Its own body cannot call its own name** (#293's non-`fun` law). The
   *   rewrite diagnostic names the sanctioned forms, and the qualified one only
   *   where it exists: a constraint declared in this module has no qualified
   *   spelling, because a module cannot name itself.
   * - **Two blocks binding one spelling** make the bare use genuinely ambiguous.
   *   The coexistence carve-out keeps both definitions legal; it is the bare
   *   *use* that is refused, naming the routes that are not ambiguous.
   * - **A reference above the binding's line** is the ordinary declared-later
   *   error — never "unknown name", which would be false.
   *
   * Evidence routes are not references and never reach here: interpolation, an
   * operator face, and a member-resolved dot call name no binding (Method Syntax
   * §4.4), which is what keeps mutually recursive instances legal in either
   * order.
   */
  #refusedMemberReference(name: Parsed.Name, symbol: Resolved.SymbolId): boolean {
    const declaration = this.#symbol(symbol);
    if (declaration.kind !== "constraint-member") return false;
    // A constraint *declaration's* default body is not an honor block. Its
    // member references — its own name included — reach the completed instance
    // through evidence, so none of the laws below governs them (§4.6's third
    // bullet, and Method Syntax §4.4's exemption for evidence routes).
    if (this.#inDefaultBody) return false;
    const bindings = this.#honoredMemberLines.get(name.text);
    if (bindings === undefined || bindings.length === 0) return false;
    if (this.#honorMembers.at(-1) === name.text) {
      const qualified = this.#declaredConstraintNames.has(bindings[0]!.constraint)
        ? ""
        : `, or qualify the instance you mean: \`${bindings[0]!.constraint}.${name.text}(…)\``;
      this.#diagnostics.add({
        severity: "error",
        message: `\`${name.text}\` is this member's own name, and a member cannot ` +
          "call itself bare; recursion is spelled through dispatch — write the " +
          `dot call \`value.${name.text}()\`${qualified}`,
        primary: name.span,
      });
      return true;
    }
    // On the **declaring** module the polymorphic read wins (the note's
    // consequence 4): a module that declares a constraint and also honors it
    // holds the spelling twice on purpose, and bare use means the declaration's
    // export — ordered at the declaration's own line, which the ordinary
    // top-down machinery already governs. Only where the instance binding is the
    // spelling's one meaning do the two laws below have anything to say.
    if (Number(declaration.bindingSpan.fileId) === this.#fileId) return false;
    // Ambiguity is between **constraints**, never between instances. Two blocks
    // honoring one constraint at two of the module's types bind one declaration's
    // member twice, and evidence at the argument's type tells them apart — which
    // is what §4.6's carve-out means by "disambiguated by evidence". Two
    // *constraints* whose members share a spelling is the case with no such
    // discriminator, and it is the one refused.
    const constraints = [...new Set(bindings.map(({ constraint }) => constraint))];
    if (constraints.length > 1) {
      this.#diagnostics.add({
        severity: "error",
        message: `\`${name.text}\` is ambiguous here: this module binds it as a ` +
          `member of ${constraints.map((constraint) => `\`${constraint}\``).join(" and ")}. ` +
          "Write the dot call on a value, or qualify the instance you mean.",
        primary: name.span,
      });
      return true;
    }
    // A reference above **every** binding of the spelling is the ordinary
    // declared-later error — never "unknown name", which would be false.
    const earliest = bindings.reduce((first, binding) =>
      binding.span.start.offset < first.span.start.offset ? binding : first
    );
    if (name.span.start.offset < earliest.span.start.offset) {
      this.#diagnostics.add({
        severity: "error",
        message: `\`${name.text}\` is bound by the \`${earliest.constraint}\` instance ` +
          "below this use; declarations are read top-down — move the instance " +
          "above this use, or reach it through dispatch",
        primary: name.span,
        labels: [{ span: earliest.span, message: "the member is bound here" }],
      });
      return true;
    }
    return false;
  }

  /**
   * Consequence 4 of the members-as-values ruling, as Modules §5.3 graduates it:
   * **qualified access reaches an honoring module's members.**
   *
   * `Rat.add(r1, r2)` denotes `Num<Rat>`'s member; `Bool.show(flag)` denotes
   * derived `Show<Bool>`'s. The governing principle is uniform access — a
   * consumer's `M.f(…)` survives `f` migrating between a plain module function
   * and a constraint member, in either direction, with no call site changing —
   * which is why this read comes *after* `terms` and after the module's own
   * declared members, and never merges with either.
   *
   * Only instances at a type the module **declares**: an instance merely passing
   * through its import graph is not its member to offer. A module honoring one
   * constraint at several of its own types makes the spelling ambiguous and
   * takes §5.5's refusal posture, naming each honored type and the routes that
   * are not ambiguous.
   */
  /**
   * The same Modules §5.3 uniform-access read, for a **provided row** — an
   * instance no module's text declares (Collections Part 5 §4).
   *
   * `#honoredMemberAccess` above answers from `iface.instances`, which is built
   * from `honor` items, so it cannot answer here: the nine `Iterable` rows have
   * no source form at all (#353's ruling 1 — `Seq`'s would be a seat cycle and
   * `Vector`'s a structural head, both refused). What is *not* different is what
   * the reader is owed. `Vector.toSeq(v)` is the honored-member read of the row
   * at `Vector`, exactly as `Int.show(5)` is the read of `stdlib/Int.hex`'s
   * `honor Show<Int>`, and it stays a correct spelling now that the companions
   * no longer plain-export the name (Part 5 §2.3's sole-exporter bullet).
   *
   * Homed at the companion, never at `Iterable.hex`: `Iterable.toSeq` is the
   * *declaration's* qualified spelling and already answers through
   * `constraintMembers` one branch earlier, polymorphically. These pin the
   * subject, which is what makes `Map.toSeq(v)` at a vector a type error rather
   * than a synonym.
   *
   * `Range` has no row here because it has no companion module to home one at
   * (Part 5 §14.3 leaves `Range.toSeq` to the stdlib listing); the bare member
   * reaches a range perfectly well. `Array` is the same case one spec further
   * out — FFI Part 2 §9 names `Array.toSeq`, but no `Array.hex` exists to hang
   * it on yet.
   */
  #providedRowMemberAccess(
    iface: ModuleInterface,
    alias: string,
    field: Parsed.Name,
  ): Resolved.Expr | undefined {
    if (field.text !== "toSeq") return undefined;
    // Keyed on the *module*, never on the spelling: a user's own
    // `import * as Vector from "./mine"` shadows the prelude alias, and the row
    // belongs to the prelude companion or to nothing.
    //
    // Compared by `fileId` rather than by object identity, because reaching the
    // same module two ways yields two interfaces. An explicit
    // `import * as Vector from "./stdlib/Vector"` of the very file the prelude
    // seated — what the Playground's hosted equipment does — resolves through
    // `#moduleAliases`, and identity would reject the module it is *about*.
    const companion = this.#preludeModuleAliases.get(alias);
    if (companion === undefined) return undefined;
    if (companion.module.fileId !== iface.module.fileId) return undefined;
    const declaring = this.#preludeModuleAliases.get("Iterable");
    const symbol = declaring?.constraintMembers.get("toSeq");
    if (symbol === undefined) return undefined;
    const local = this.#reachPreludeTerm(symbol.id);
    if (local === undefined) return undefined;
    const span = field.span;
    const variable = (name: string): Resolved.TypeAnnotation => ({
      kind: "TypeVariable",
      name,
      span,
    });
    const parameter = (name: string): Resolved.TypeParameter => ({
      name,
      constraints: [],
      span,
    });
    const pin = (
      annotation: Resolved.TypeAnnotation,
      names: readonly string[],
    ): Resolved.Expr => {
      this.#importedSymbols.set(symbol.id, symbol);
      return {
        kind: "Name",
        symbol: symbol.id,
        text: local,
        instanceSubject: { annotation, typeParameters: names.map(parameter) },
        span,
      };
    };
    if (alias === "Vector") {
      return pin({ kind: "Vector", element: variable("a"), span }, ["a"]);
    }
    if (alias === "Set") {
      return pin({ kind: "Set", element: variable("a"), span }, ["a"]);
    }
    if (alias === "Map") {
      return pin(
        { kind: "Map", key: variable("k"), value: variable("v"), span },
        ["k", "v"],
      );
    }
    if (alias === "String") {
      return pin({ kind: "Primitive", name: "String", span }, []);
    }
    if (alias === "Seq") {
      const record = iface.records.get("Seq");
      if (record === undefined) return undefined;
      return pin(
        {
          kind: "RecordDeclaration",
          record: record.id,
          name: "Seq",
          arguments: [variable("a")],
          span,
        },
        ["a"],
      );
    }
    return undefined;
  }

  #honoredMemberAccess(
    iface: ModuleInterface,
    alias: string,
    field: Parsed.Name,
  ): Resolved.Expr | undefined {
    // "A type it declares" — read for a **fixed prelude companion** as *the
    // primitive it companions* (Modules §5.3 as amended by #344; Constraints
    // §5.3 makes the companion the primitive's home module). `BigInt.gcd`
    // denotes `Integral<BigInt>`'s member exactly as `Rat.add` denotes
    // `Num<Rat>`'s, and the conversions ride the same read. The fact comes from
    // the module's compilation, not its text, so a user module honoring at a
    // primitive it does not companion is unaffected — as is the several-own-types
    // ambiguity refusal below, which a companion honoring at one type never meets.
    const declares = (subject: Resolved.TypeAnnotation): boolean =>
      (subject.kind === "RecordDeclaration" &&
        [...iface.records.values()].some(({ id }) => id === subject.record)) ||
      (subject.kind === "Union" &&
        [...iface.unions.values()].some(({ id }) => id === subject.union)) ||
      (subject.kind === "Primitive" &&
        subject.name === iface.module.companionPrimitive);
    const candidates = iface.instances.flatMap((instance) => {
      if (!declares(instance.subject)) return [];
      const declaration = iface.visibleConstraints.find(
        (item) => item.identity === instance.constraintIdentity,
      );
      const member = declaration?.members.find(
        ({ binding }) => binding.name === field.text,
      );
      if (member === undefined) return [];
      return [{ instance, member }];
    });
    if (candidates.length === 0) return undefined;
    if (candidates.length > 1) {
      const types = candidates.map(({ instance }) => `\`${annotationHeadName(instance.subject)}\``);
      this.#diagnostics.add({
        severity: "error",
        message: `\`${alias}.${field.text}\` is ambiguous: \`${alias}\` honors a ` +
          `constraint with a member \`${field.text}\` at ${types.join(" and ")}. ` +
          `Write the dot call on a value of the type you mean, the bare ` +
          `\`${field.text}(…)\`, or the declaring module's qualified spelling.`,
        primary: field.span,
      });
      return { kind: "ErrorExpr", span: field.span };
    }
    const { instance, member } = candidates[0]!;
    const symbol = iface.module.symbols.find(({ id }) => id === member.binding.symbol);
    if (symbol === undefined) return undefined;
    this.#importedSymbols.set(symbol.id, symbol);
    // The member is the *declaring* module's binding, so the spelling this
    // module emits has to be one it can reach: the prelude local for a prelude
    // constraint, or the local a real import of the declaration already bound.
    // Nothing else has an import to render, and inventing one is the companion
    // arc's business, not this read's.
    const local = this.#reachPreludeTerm(symbol.id) ??
      (this.#explicitlyImported.has(symbol.id) ? symbol.name : undefined);
    if (local === undefined) return undefined;
    return {
      kind: "Name",
      symbol: symbol.id,
      text: local,
      instanceSubject: {
        annotation: instance.subject,
        typeParameters: instance.typeParameters,
      },
      span: field.span,
    };
  }

  /**
   * Consequence 3 of the constraint-members-are-values note (#335): **an
   * honored member's spelling is claimed in the honoring module's term space.**
   *
   * A member definition is a module-level binding. Hexagon has no overloading,
   * so a module that honors `Show<Box>` and also binds an ordinary `show` has
   * bound one name twice, and that is the rebinding error the language already
   * owns — no new rule, only a new pair of things that collide. The defect it
   * retires was writable and silent: a module could export `show(box) =
   * "export"` *while* honoring `Show<Box>` with `show(box) = "member"`, compile
   * clean, and split the spellings (a dot call and an in-module bare use took
   * the export; interpolation took the member).
   *
   * Three boundaries, each load-bearing:
   *
   * - **Members from distinct honor blocks coexist.** One module honoring two
   *   constraints that share a member name is legal and stays legal (note
   *   consequence 5), disambiguated by evidence, by qualification, or by
   *   Modules §5.5 where a bare use is genuinely ambiguous. That falls out of
   *   the claim being read against *bindings*: an honor block binds nothing in
   *   the module scope, so no claim can meet another claim.
   * - **A declaring module's own declaration is not an honor.** `Show.hex`
   *   binds `show` as a `constraint-member` of its declaration; a module that
   *   both declares and honors holds the spelling twice on purpose (note §5
   *   item 4), so a `constraint-member` binding is never the collision.
   * - **The claim covers every member of the constraint**, not the ones the
   *   block writes: a defaulted member the instance inherits is bound just as
   *   much as an overridden one, and a `derives` clause is honoring too.
   *
   * Run once, after every item is resolved, which is what makes the claim
   * order-free — a `let` before the block and a `let` after it are the same
   * collision, and each is reported at whichever of the two the reader would
   * fix. Only the module layer: an inner-layer binder is refused by §5.4's
   * absolute ban long before it could reach here.
   */
  #claimHonoredMembers(items: readonly Resolved.Item[], scope: Scope): void {
    for (const item of items) {
      if (item.kind !== "Honor") continue;
      const instance = `${item.constraint}<${annotationHeadName(item.subject)}>`;
      for (const member of this.#honoredMemberNames(item)) {
        const existing = scope.lookupLocal(member);
        if (existing === undefined) continue;
        const previous = this.#symbol(existing);
        if (previous.kind === "constraint-member") continue;
        const bound = previous.bindingSpan;
        const rebinding = "Hexagon does not allow rebinding — choose a different name.";
        const claimFirst = item.span.start.offset < bound.start.offset;
        this.#diagnostics.add({
          severity: "error",
          message: claimFirst
            ? `\`${member}\` is already bound: the \`${instance}\` instance binds it ` +
              `as a member (line ${item.span.start.line + 1}); ${rebinding}`
            : `the \`${instance}\` instance binds \`${member}\`, which is already ` +
              `bound (line ${bound.start.line + 1}); ${rebinding}`,
          primary: claimFirst ? bound : item.span,
          labels: claimFirst
            ? [{ span: item.span, message: "the member is bound here" }]
            : [{ span: bound, message: "previous binding" }],
        });
      }
    }
  }

  /**
   * The member names an `honor` binds: the constraint's declaration, wherever
   * it is visible from — this module's own, an imported one, or a prelude one
   * riding the visible-constraints metadata channel.
   *
   * The fallback is for a compile with no prelude at all (the pass-level unit
   * harnesses), where a pre-registered name still means the compiler's
   * constraint but no declaration is in view. See
   * `PRE_REGISTERED_CONSTRAINT_MEMBERS` for why answering from a table there is
   * better than answering from the honor block's own member list, which would
   * silently let an inherited default's spelling escape the claim.
   */
  #honoredMemberNames(item: Resolved.HonorItem): readonly string[] {
    const declaration = this.#visibleConstraints.get(item.constraintIdentity) ??
      this.#namedConstraint(item.constraint);
    if (declaration !== undefined) {
      return declaration.members.map(({ binding }) => binding.name);
    }
    return PRE_REGISTERED_CONSTRAINT_MEMBERS[item.constraint] ?? [];
  }

  /**
   * Constraints §6.1's member seats, one per member of every **ground**
   * instance this module declares, under their preferred spellings (#444).
   *
   * Run once, immediately before `nameDictionaries`, because it needs exactly
   * what that pass needs: every declaration resolved, so the constraint behind
   * each `honor` is in view. The member list is the constraint declaration's —
   * `#honoredMemberNames`, the same enumeration §4.6's spelling claim already
   * runs on — which is what makes the seat set the instance's *completed* one:
   * an inherited default has no line in the block to be read off, and a derived
   * instance has no lines at all, yet §2's completed member set holds both and
   * §4.6 qualifies `Int.notEquals` either way.
   *
   * "Ground" is the emitter's own test, spelled the way emission spells it: an
   * instance takes an evidence parameter per (binder, constraint) pair, so an
   * instance with no such pair is a record and every other one is a factory. A
   * factory's members close over its parameters and so cannot hoist (§6.1's
   * parameterized bullet), which is why those instances get no seats here.
   */
  #assignMemberSeats(items: readonly Resolved.Item[]): readonly Resolved.Item[] {
    return items.map((item) => {
      if (item.kind !== "Honor") return item;
      if (item.typeParameters.some(({ constraints }) => constraints.length > 0)) {
        return item;
      }
      const members = this.#honoredMemberNames(item);
      if (members.length === 0) return item;
      return {
        ...item,
        memberSeats: members.map((member) => ({
          member,
          seat: memberSeatName(item.dictionary, member),
        })),
      };
    });
  }

  /**
   * Where an imported instance's member seats are reached from **here**: the
   * declaring module's path, carried on unchanged, plus that path as an import
   * specifier from this module (#444).
   *
   * Both are absent together, and the compilation that has neither is the one
   * that gave no module a path — the pass-level harnesses. Routing a concrete
   * member call across a module boundary then has no specifier to write, so it
   * declines and the call keeps its forwarder, which is the shape those
   * harnesses measured before this existed.
   */
  #seatOrigin(declaringPath: string | undefined): {
    readonly declaringPath?: string;
    readonly seatSpecifier?: string;
  } {
    if (declaringPath === undefined || this.#path === undefined) return {};
    return {
      declaringPath,
      seatSpecifier: relativeSpecifier(this.#path, declaringPath),
    };
  }

  #reportRebinding(name: Parsed.Name, existing: Resolved.SymbolId): void {
    const previous = this.#symbol(existing);
    this.#diagnostics.add({
      severity: "error",
      message:
        `\`${name.text}\` is already bound (line ` +
        `${previous.bindingSpan.start.line + 1}); Hexagon does not allow ` +
        "rebinding — choose a different name.",
      primary: name.span,
      labels: [{ span: previous.bindingSpan, message: "previous binding" }],
    });
  }

  #symbol(id: Resolved.SymbolId): Resolved.Symbol {
    const symbol = this.#symbols.get(id) ?? this.#importedSymbols.get(id);
    if (symbol === undefined) throw new Error(`unknown internal symbol ${id}`);
    return symbol;
  }
}

function isPrimitiveName(name: string): name is Resolved.PrimitiveName {
  return ["Nat", "Int", "Float", "String", "BigInt", "Exn", "Unit"].includes(name);
}

function isResolvedTypeAlias(
  alias: Parsed.TypeAliasItem | Resolved.TypeAliasItem,
): alias is Resolved.TypeAliasItem {
  return typeof alias.name === "string";
}

/**
 * The operations a primitive companion is asked for and deliberately does not
 * have, with the sentence that says why (Integral §8's diagnostics row).
 *
 * A name-not-found hint is cheap, and this one is worth its keep: the obvious
 * hand-rolled `a * b / gcd(a, b)` at `Int` overflows the safe range for
 * ordinary inputs, silently, which is exactly the mistake the missing member is
 * refusing to make. The row survived the re-homing (#344) — the spelling now
 * misses as an ordinary does-not-export at a real module rather than at the
 * wired route — because the obligation is the row, not the mechanism that
 * carried it.
 */
const CURATED_COMPANION_MISSES: ReadonlyMap<string, string> = new Map([
  [
    "Int.lcm",
    "`Int` has no `lcm` — its results overflow `Int`'s safe range for ordinary " +
      "inputs; use `BigInt.lcm`",
  ],
]);

function curatedCompanionMiss(
  companion: string | undefined,
  field: string,
): string | undefined {
  return companion === undefined
    ? undefined
    : CURATED_COMPANION_MISSES.get(`${companion}.${field}`);
}

/** One `honor` declaration's binding of one member spelling (Constraints §4.6). */
interface HonoredMemberLine {
  readonly constraint: string;
  readonly span: Source.Span;
}

function annotationHeadName(annotation: Resolved.TypeAnnotation): string {
  switch (annotation.kind) {
    case "Primitive": return annotation.name;
    case "Range": return "Range";
    case "Vector": return "Vector";
    case "Map": return "Map";
    case "Set": return "Set";
    case "Array": return "Array";
    case "JsMap": return "JsMap";
    case "JsSet": return "JsSet";
    case "Node": return "Node";
    case "Nullable": return "Nullable";
    case "Function": return "Function";
    case "Union": return annotation.name;
    case "RecordDeclaration": return annotation.name;
    case "ExternType": return annotation.name;
    case "Tuple": return "Tuple";
    case "Record": return "Record";
    case "TypeVariable": return annotation.name;
    case "ImpliedType": return annotation.name;
    case "Hole": return "_";
    case "ErrorType": return "Error";
  }
}

function annotationTypeVariables(annotation: Resolved.TypeAnnotation): readonly string[] {
  switch (annotation.kind) {
    case "TypeVariable": return [annotation.name];
    case "Vector": return annotationTypeVariables(annotation.element);
    case "Set": return annotationTypeVariables(annotation.element);
    case "Array": return annotationTypeVariables(annotation.element);
    case "JsSet": return annotationTypeVariables(annotation.element);
    case "Node": return annotationTypeVariables(annotation.element);
    case "Nullable": return annotationTypeVariables(annotation.value);
    case "Map":
    case "JsMap": return [
      ...annotationTypeVariables(annotation.key),
      ...annotationTypeVariables(annotation.value),
    ];
    case "Function": return [
      ...annotation.parameters.flatMap(annotationTypeVariables),
      ...annotationTypeVariables(annotation.result),
    ];
    case "Tuple": return annotation.elements.flatMap(annotationTypeVariables);
    case "Record": return annotation.fields.flatMap((field) =>
      annotationTypeVariables(field.annotation)
    );
    case "Union":
    case "RecordDeclaration":
      return annotation.arguments.flatMap(annotationTypeVariables);
    case "ExternType":
    case "Primitive":
    case "Range":
    case "ImpliedType":
    // A hole names no variable: it claims no shape and links nothing (closure
    // doc §2.3), so it contributes no name to any declaration head's inventory.
    case "Hole":
    case "ErrorType":
      return [];
  }
}

function parsedAnnotationTypeVariables(annotation: Parsed.TypeAnnotation): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (type: Parsed.TypeAnnotation): void => {
    if (type.kind === "TypeVariable") names.add(type.name.text);
    else if (type.kind === "Tuple") type.elements.forEach(visit);
    else if (type.kind === "Record") type.fields.forEach((field) => visit(field.annotation));
    else if (type.kind === "AppliedType") type.arguments.forEach(visit);
    else if (type.kind === "Function") {
      type.parameters.forEach(visit);
      visit(type.result);
    }
  };
  visit(annotation);
  return names;
}

function withTypeSpan(type: Resolved.TypeAnnotation, span: Source.Span): Resolved.TypeAnnotation {
  // A substituted type is re-pointed at the position it was substituted *into*,
  // so a diagnostic about an alias body carets the alias body. A hole keeps its
  // own span instead: the `_` the user wrote is the only thing hover can point
  // at, and an alias body has no `_` in it to caret (§5.4 fences one out).
  if (type.kind === "Hole") return type;
  return { ...type, span };
}

function substituteResolvedType(
  type: Resolved.TypeAnnotation,
  replacements: ReadonlyMap<string, Resolved.TypeAnnotation>,
  span = type.span,
): Resolved.TypeAnnotation {
  if (type.kind === "Hole") return type;
  if (type.kind === "TypeVariable") return withTypeSpan(replacements.get(type.name) ?? type, span);
  if (type.kind === "Tuple") return { ...type, elements: type.elements.map((element) => substituteResolvedType(element, replacements)), span };
  if (type.kind === "Record") return {
    ...type,
    fields: type.fields.map((field) => ({ ...field, annotation: substituteResolvedType(field.annotation, replacements) })),
    span,
  };
  if (type.kind === "Vector" || type.kind === "Set" || type.kind === "Array" || type.kind === "JsSet") {
    return { ...type, element: substituteResolvedType(type.element, replacements), span };
  }
  if (type.kind === "Nullable") return { ...type, value: substituteResolvedType(type.value, replacements), span };
  if (type.kind === "Map" || type.kind === "JsMap") return {
    ...type,
    key: substituteResolvedType(type.key, replacements),
    value: substituteResolvedType(type.value, replacements),
    span,
  };
  if (type.kind === "Function") return {
    ...type,
    parameters: type.parameters.map((parameter) =>
      substituteResolvedType(parameter, replacements)
    ),
    result: substituteResolvedType(type.result, replacements),
    span,
  };
  if (type.kind === "Union" || type.kind === "RecordDeclaration") {
    return { ...type, arguments: type.arguments.map((argument) => substituteResolvedType(argument, replacements)), span };
  }
  return { ...type, span };
}

/**
 * A resolved type with every linked arrow turned into the impure constant.
 *
 * Error recovery for an alias body §5.1.1 has already refused (Effects §4.4).
 * The arrow denotes nothing, and leaving it `"linked"` would let it acquire a
 * meaning at a use site that happens to offer an inlet — so it takes the
 * constant, which is what the writer is being told to write.
 */
function constantifyLinkedArrows(annotation: Resolved.TypeAnnotation): Resolved.TypeAnnotation {
  const rebuild = (node: unknown): unknown => {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(rebuild);
    const record = node as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      copy[key] = key === "span" || key === "arrowSpan" ? child : rebuild(child);
    }
    if (copy.kind === "Function" && copy.effect === "linked") copy.effect = "constant";
    return copy;
  };
  return rebuild(annotation) as Resolved.TypeAnnotation;
}
