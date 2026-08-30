/** Plans the closed family of fundamental editions for constrained functions. */

import { isPreRegisteredIdentity } from "../../constraints.js";
import type * as Core from "../../syntax/core/index.js";
import type * as Resolved from "../../syntax/resolved/index.js";
import type * as Typed from "../../syntax/typed/index.js";

export type SpecializableItem =
  | Core.FunItem
  | (Core.LetItem & { readonly value: Core.LambdaExpr });

export interface FundamentalAssignment {
  readonly variable: Typed.TypeVariableId;
  readonly type: FundamentalType;
}

export interface FundamentalSpecialization {
  readonly sourceSymbol: Resolved.SymbolId;
  readonly sourceName: string;
  readonly sourceExported: boolean;
  readonly name: string;
  readonly assignment: readonly FundamentalAssignment[];
  readonly scheme: Typed.Scheme;
}

export interface SpecializationCollision {
  readonly specialization: FundamentalSpecialization;
  readonly otherSourceName: string;
  readonly kind: "explicit" | "generated";
  readonly otherExported?: boolean;
}

export interface SpecializationPlan {
  readonly specializations: readonly FundamentalSpecialization[];
  readonly collisions: readonly SpecializationCollision[];
}

/**
 * The zero-cost fundamental set (`ffi-zero-cost-fundamental-exports.md` §2.1).
 * **Defined by enumeration, not derived from type classification** — the spec's
 * own framing, and #147 is what makes the distinction bite: `Bool` left the
 * primitive set to become a prelude union and stayed in this set unchanged,
 * because membership is a language category rather than an inference from how a
 * type happens to be classified. #159 repeats the move for `Unit`, now the
 * arity-0 tuple. Algorithm G's fundamental/non-fundamental split is unaffected
 * by either reclassification.
 */
export type FundamentalType =
  | Exclude<Typed.PrimitiveName, "Exn">
  | "Bool"
  | "Unit";

const fundamentalTypes: readonly FundamentalType[] = [
  "Nat",
  "Int",
  "Float",
  "BigInt",
  "Bool",
  "String",
  "Unit",
];

/** Computes Algorithms S and N for exported functions or inspection previews. */
export function planFundamentalSpecializations(
  module: Core.Module,
  includePrivate = false,
): SpecializationPlan {
  const explicitTerms = topLevelTermNames(module);
  const generated = new Map<string, FundamentalSpecialization>();
  const specializations: FundamentalSpecialization[] = [];
  const collisions: SpecializationCollision[] = [];
  // #147: `Bool` is a fundamental type that is no longer a primitive, so an
  // edition assigning it has to name the prelude declaration. Same guard as the
  // checker's `#boolUnion` and the emitter's `preludeIds` — the fallback is for
  // `stdlib/Bool.hex` alone, and the three passes must agree about which
  // declaration is the pinned one.
  const bool = module.preludeUnions.get("Bool")
    ?? (module.preludeUnions.size === 0
      ? module.unions.find(({ name }) => name === "Bool")?.id
      : undefined);

  for (const item of module.items) {
    if (!isSpecializable(item) || (!includePrivate && !item.exported)) continue;
    const planned = planItem(item, bool);
    for (const specialization of planned) {
      let collided = false;
      const explicit = explicitTerms.get(specialization.name);
      if (explicit !== undefined && explicit.name !== item.binding.name) {
        collided = true;
        collisions.push({
          specialization,
          otherSourceName: explicit.name,
          otherExported: explicit.exported,
          kind: "explicit",
        });
      }
      const previous = generated.get(specialization.name);
      if (previous !== undefined && previous.sourceSymbol !== specialization.sourceSymbol) {
        collided = true;
        collisions.push({
          specialization,
          otherSourceName: previous.sourceName,
          kind: "generated",
        });
      } else {
        if (!collided) generated.set(specialization.name, specialization);
      }
      if (!collided) specializations.push(specialization);
    }
  }

  return { specializations, collisions };
}

/**
 * Instantiates types and evidence so an edition emits concrete operations.
 *
 * The substitution is applied to the *whole* body — every `Typed.Type` node and
 * every dictionary evidence node in one walk — so an edition is the generic body
 * read under the assignment, and nothing else. That completeness is the point
 * (#675): while only the evidence moved, an edition's walked component types
 * stayed `Variable` while its evidence said `Int`, and the emitter's derived
 * walks, which are type-directed, rebuilt a reference to a dictionary parameter
 * the edition no longer takes. Type and evidence now agree at every seat, so
 * every type-directed arm fires where a ground program's fires it.
 *
 * The parity that buys is structural, not textual, and the difference is worth
 * knowing before someone pins it. An edition's dictionary has the ground
 * program's name, shape and inline arms — `__Ord_Int_Int` is character-for-
 * character the ground one — but a dictionary carrying *internal* temporaries
 * picks up the #425 collision-only suffixes once seven of them share a module's
 * name allocator: an edition's `__Eq_Vector_Int` says `__rightStep_2` where the
 * ground program says `__rightStep`. Block-scoped inside its own IIFE, so
 * cosmetic — but a verbatim edition-against-ground comparison will trip on it.
 *
 * What a substituted dictionary parameter *becomes* is `editionEvidence`'s
 * question, and it is answered by the constraint's identity as much as by the
 * type it is assigned (#679): the two compiler-derived answers below are right
 * for the constraints the compiler pre-registers and wrong for every constraint
 * a module declares, which reaches its instance through `instances`.
 */
export function specializeItem(
  item: SpecializableItem,
  specialization: FundamentalSpecialization,
  bool: Resolved.UnionId | undefined,
  instances: EditionInstances,
): SpecializableItem {
  const substitutions = new Map(
    specialization.assignment.map(({ variable, type }) => [variable, type] as const),
  );
  return {
    ...item,
    exported: false,
    binding: {
      ...item.binding,
      name: specialization.name,
      scheme: specialization.scheme,
    },
    value: specializeBody(item.value, substitutions, bool, instances),
  } as SpecializableItem;
}

/**
 * Where an edition's substituted dictionary parameter finds the instance that
 * answers it (#679).
 *
 * The planner asks and the caller answers, because the question is about a
 * *module* — the three channels an instance reaches one by, which
 * `sourceInstanceDictionary` below walks — while this file knows only about a
 * scheme and a body. `undefined` is the answer for a pair no instance backs,
 * which is a compiler defect the implementation is expected to report before
 * answering: the plan offered a candidate the instance judgment does not
 * support, and an edition whose dictionary is nothing at all is a `TypeError`
 * at its first slot read.
 */
export type EditionInstances = (
  constraintIdentity: string,
  type: FundamentalType,
) => string | undefined;

/**
 * The answer for a caller that renders an edition's **face** and never its body.
 *
 * The `.d.ts` and preview emitters specialize an item to read the substituted
 * scheme and the lambda's parameter list, and nothing under them: no evidence
 * node of theirs is ever rendered. They resolve nothing rather than pretending
 * to, and the `Error` evidence that leaves in their copy of the body is exactly
 * as dead as the body is.
 */
export const faceOnlyEditionInstances: EditionInstances = () => undefined;

/**
 * The dictionary a **source** instance of this constraint at this fundamental
 * type exports, if one exists (#344, #679).
 *
 * Keyed on the constraint's **declaration identity** (`spec/constraints.md`
 * §5.1.1) rather than on its name, because a name is not a property of a
 * constraint at a module border: two modules may each declare a `Describe`, and
 * an import may rename one.
 *
 * Three channels, which are the three ways an instance reaches a module: its
 * own `honor` items, the instances an import makes global — transitively, so a
 * consumer that never names the declaring module still finds them — and the
 * prelude's (#153). They are disjoint by construction, so the order below is a
 * reading order and not a precedence: a module's own instances never appear in
 * `preludeInstances`, an explicit import of a prelude module carries none, and
 * coherence forbids two instances of one constraint at one head. Only the
 * prelude channel was consulted while the sole caller was `Primitive` evidence,
 * whose companions all arrive by it; a constraint some module *declared* is
 * honored in that module or in one this one imports, and both were invisible.
 */
export function sourceInstanceDictionary(
  module: Core.Module,
  constraintIdentity: string,
  head: FundamentalType | Typed.PrimitiveName,
  bool: Resolved.UnionId | undefined,
): string | undefined {
  for (const item of module.items) {
    if (item.kind !== "Honor") continue;
    if (item.constraintIdentity === constraintIdentity && honoredAt(item.subject, head, bool)) {
      return item.dictionary;
    }
  }
  for (const item of module.items) {
    if (item.kind !== "Import") continue;
    for (const instance of item.instances) {
      if (
        instance.constraintIdentity === constraintIdentity &&
        honoredAt(instance.subject, head, bool)
      ) {
        return instance.localDictionary;
      }
    }
  }
  return module.preludeInstances.find((available) =>
    available.constraintIdentity === constraintIdentity &&
    honoredAt(available.subject, head, bool)
  )?.localDictionary;
}

/**
 * Whether an instance's subject **is** this fundamental type.
 *
 * One test over the two spellings a subject arrives in — a `Typed.Type` on this
 * module's own `Honor` items, a `Resolved.TypeAnnotation` on an imported or
 * prelude instance — which agree on the shapes that can be a fundamental: a
 * primitive's name, and a union's identity.
 *
 * The `Bool` test is the union identity and never the name, the same pin the
 * emitter's `#groundFundamental` and comparison lowering make: a module that
 * declares its own `Bool` has not declared the prelude's. `Bool` is an ordinary
 * instance head otherwise — Zero-Cost Fundamental Exports §3.2's judgment at
 * `Unit` and `Bool` — so a declared constraint reaches it exactly as it reaches
 * a primitive.
 *
 * `Unit` matches nothing, and that is the answer rather than a gap. Instances
 * are keyed on type constructors and the empty tuple has neither a constructor
 * name nor a home module, so no `honor` can ever name it (§3.2 again;
 * Constraints §9.3, §4.5's structural bullet). `Unit`'s lawful instances are
 * exactly the automatic structural ones, which `editionEvidence` renders itself
 * and never asks about here.
 */
function honoredAt(
  subject: Typed.Type | Resolved.TypeAnnotation,
  head: FundamentalType | Typed.PrimitiveName,
  bool: Resolved.UnionId | undefined,
): boolean {
  if (head === "Bool") {
    return bool !== undefined && subject.kind === "Union" && subject.union === bool;
  }
  if (head === "Unit") return false;
  return subject.kind === "Primitive" && subject.name === head;
}

/**
 * Algorithm N for a declaration reached **across a module boundary** (#440):
 * the plan the exporter ran, recomputed here from the generalized scheme its
 * interface carries.
 *
 * Sound on any program that compiles, in both directions. Nothing is missed
 * because the scheme travels verbatim and the rule below is a function of it
 * alone; nothing is invented because a collision that dropped a planned edition
 * is an *error* at an exported source (`addSpecializationCollisionDiagnostics`),
 * so a clean exporter published every name this plans. The one input the scheme
 * cannot supply — whether the item's value is a lambda — arrives on the import
 * as `specializableTerms`, which is the caller's gate rather than this one's.
 */
export function planImportedSpecializations(
  symbol: Core.Symbol,
  bool: Resolved.UnionId | undefined,
): readonly FundamentalSpecialization[] {
  return planScheme(symbol.id, symbol.name, symbol.scheme, true, bool);
}

function planItem(
  item: SpecializableItem,
  bool: Resolved.UnionId | undefined,
): readonly FundamentalSpecialization[] {
  if (item.kind === "Let" && item.value.kind !== "Lambda") return [];
  return planScheme(
    item.binding.symbol,
    item.binding.name,
    item.binding.scheme,
    item.exported,
    bool,
  );
}

function planScheme(
  symbol: Resolved.SymbolId,
  name: string,
  scheme: Typed.Scheme,
  exported: boolean,
  bool: Resolved.UnionId | undefined,
): readonly FundamentalSpecialization[] {
  if (scheme.constraints.length === 0) return [];

  const constraints = new Map<Typed.TypeVariableId, Set<Typed.ConstraintName>>();
  for (const requirement of scheme.constraints) {
    if (requirement.type.kind !== "Variable") continue;
    const names = constraints.get(requirement.type.id) ?? new Set();
    names.add(requirement.name);
    constraints.set(requirement.type.id, names);
  }
  const specializing = scheme.variables.filter((variable) => constraints.has(variable));
  if (specializing.length === 0) return [];

  const candidates = specializing.map((variable) =>
    fundamentalTypes.filter((type) =>
      [...(constraints.get(variable) ?? [])].every((constraint) =>
        fundamentalSupports(type, constraint)
      )
    )
  );
  if (candidates.some((types) => types.length === 0)) return [];

  return cartesian(candidates).map((types) => {
    const assignment = specializing.map((variable, index) => ({
      variable,
      type: types[index]!,
    }));
    return {
      sourceSymbol: symbol,
      sourceName: name,
      sourceExported: exported,
      name: `${name}${types.join("")}`,
      assignment,
      scheme: specializeScheme(scheme, new Map(
        assignment.map(({ variable, type }) => [variable, type] as const),
      ), bool),
    };
  });
}

function specializeScheme(
  scheme: Typed.Scheme,
  substitutions: ReadonlyMap<Typed.TypeVariableId, FundamentalType>,
  bool: Resolved.UnionId | undefined,
): Typed.Scheme {
  return {
    variables: scheme.variables.filter((variable) => !substitutions.has(variable)),
    constraints: scheme.constraints
      .filter(({ type }) => type.kind !== "Variable" || !substitutions.has(type.id))
      .map((constraint) => ({
        ...constraint,
        type: substituteType(constraint.type, substitutions, bool),
      })),
    type: substituteType(scheme.type, substitutions, bool),
  };
}

function substituteType(
  type: Typed.Type,
  substitutions: ReadonlyMap<Typed.TypeVariableId, FundamentalType>,
  bool: Resolved.UnionId | undefined,
): Typed.Type {
  switch (type.kind) {
    case "Variable": {
      const replacement = substitutions.get(type.id);
      if (replacement === undefined) return type;
      // Five of the seven fundamental types are primitives and become a
      // primitive node. `Bool` (#147) and `Unit` (#159) are the exceptions —
      // both left the primitive set and stayed fundamental by enumeration — so
      // their editions name what the types are now: the prelude union, and the
      // arity-0 tuple.
      if (replacement === "Unit") return { kind: "Tuple", elements: [] };
      if (replacement !== "Bool") return { kind: "Primitive", name: replacement };
      return bool === undefined
        ? { kind: "Error" }
        : { kind: "Union", union: bool, name: "Bool", arguments: [] };
    }
    case "Function":
      return {
        ...type,
        parameters: type.parameters.map((parameter) =>
          substituteType(parameter, substitutions, bool)
        ),
        result: substituteType(type.result, substitutions, bool),
      };
    case "Tuple":
      return {
        ...type,
        elements: type.elements.map((element) => substituteType(element, substitutions, bool)),
      };
    case "Vector":
      return { ...type, element: substituteType(type.element, substitutions, bool) };
    case "Set":
      return { ...type, element: substituteType(type.element, substitutions, bool) };
    case "Map":
      return {
        ...type,
        key: substituteType(type.key, substitutions, bool),
        value: substituteType(type.value, substitutions, bool),
      };
    case "Array":
    case "JsSet":
      return { ...type, element: substituteType(type.element, substitutions, bool) };
    case "JsMap":
      return {
        ...type,
        key: substituteType(type.key, substitutions, bool),
        value: substituteType(type.value, substitutions, bool),
      };
    case "Node":
      return { ...type, element: substituteType(type.element, substitutions, bool) };
    case "Nullable":
      return { ...type, value: substituteType(type.value, substitutions, bool) };
    case "Record":
      return {
        ...type,
        fields: type.fields.map((field) => ({
          ...field,
          type: substituteType(field.type, substitutions, bool),
        })),
      };
    case "Union":
    case "NominalRecord":
      return {
        ...type,
        arguments: type.arguments.map((argument) =>
          substituteType(argument, substitutions, bool)
        ),
      };
    case "Primitive":
    case "Range":
    case "ExternType":
    case "Error":
      return type;
  }
}

/**
 * One deep walk carrying the assignment into an edition's body, rewriting the
 * two node families that name a specialized variable: the `Dictionary` evidence
 * a dictionary parameter would have supplied, and the `Variable` *types* the
 * body was elaborated at.
 *
 * The walk is untyped on purpose — the Core tree it crosses is a dozen node
 * families deep and gains members regularly, and a hand-written traversal that
 * has to be extended for each of them is a defect waiting for the next node
 * kind. Two structural guards keep it honest. `Dictionary` is an evidence kind
 * and nothing else, recognised by its numeric `variable`. `Variable` is
 * `Typed.Type`'s — `syntax/typed/tree.ts`'s is the only `kind: "Variable"` node
 * declared in the Core or Typed trees — recognised by its numeric `id`; the
 * substituted-id test then narrows it further, so a node this walk rewrites is
 * always a type the assignment names. Type-variable ids are unique across a
 * module, so there is no capture to avoid: no inner binder can rebind an id the
 * scheme generalized.
 *
 * A grep finds a *second* declaration and it is not a counterexample:
 * `passes/checker/checker.ts` declares its own `Variable` for the checker's
 * internal `Mono`, structurally identical and so a byte-for-byte match for this
 * guard, which could not tell the two apart. What keeps that harmless is the
 * module boundary: both that `Variable` and `Mono` itself are declared without
 * `export`, so no value of either type leaves the checker to reach a Core tree.
 * If `Mono` is ever exported, this walk is one of the places to re-examine.
 */
function specializeBody<T>(
  value: T,
  substitutions: ReadonlyMap<Typed.TypeVariableId, FundamentalType>,
  bool: Resolved.UnionId | undefined,
  instances: EditionInstances,
): T {
  if (Array.isArray(value)) {
    return value.map((element) =>
      specializeBody(element, substitutions, bool, instances)
    ) as T;
  }
  if (value === null || typeof value !== "object") return value;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.kind === "Variable" && typeof candidate.id === "number" &&
    substitutions.has(candidate.id as Typed.TypeVariableId)
  ) {
    // The same `substituteType` the scheme went through, so an edition's body
    // and its signature cannot disagree about what the variable became.
    return substituteType(candidate as unknown as Typed.Type, substitutions, bool) as T;
  }
  if (candidate.kind === "Dictionary" && typeof candidate.variable === "number") {
    const replacement = substitutions.get(candidate.variable as Typed.TypeVariableId);
    if (replacement !== undefined) {
      // The identity is read off the node rather than guarded for, because a
      // `Dictionary` node without one is not one this walk can rewrite: it
      // reaches `editionEvidence` as the empty identity, which is no
      // constraint's, and is reported there rather than left in the body as a
      // reference to a parameter the edition does not take.
      const identity = typeof candidate.constraintIdentity === "string"
        ? candidate.constraintIdentity
        : "";
      return editionEvidence(identity, replacement, bool, instances) as T;
    }
  }
  return Object.fromEntries(
    Object.entries(candidate).map(([key, nested]) => [
      key,
      specializeBody(nested, substitutions, bool, instances),
    ]),
  ) as T;
}

/**
 * The evidence a **ground** program at this fundamental type carries for the
 * constraint an edition's dictionary parameter answered.
 *
 * Which of the three answers is right is a question about the *constraint* and
 * not only about the type, which is why the identity is read and not the
 * assignment alone (#679):
 *
 * - A **pre-registered** constraint at one of the five primitive fundamentals is
 *   `Primitive` evidence, which `#emitEvidence` resolves to the companion
 *   module's exported dictionary (#344).
 * - A pre-registered constraint at `Bool` or `Unit` is `Structural`, over the
 *   type `substituteType` wrote into the scheme. `Unit`'s is the automatic tuple
 *   instance at arity 0 (#159); `Bool`'s is `stdlib/Bool.hex`'s derived walk
 *   (#147), which is what makes an edition's rendering agree with every other
 *   spelling of the same call: `"True"` rather than the host's `String(x)`.
 * - Everything else is a constraint some module **declared**, and its evidence
 *   is the ordinary instance row — the dictionary a source `honor` at this
 *   fundamental exports.
 *
 * Neither of the first two arms can stand in for the third, and both fail in
 * their own way. A declared constraint is not one of the four the compiler
 * derives, so the `Bool` arm renders an empty dictionary and calls a member on
 * it — no diagnostic, a `TypeError` at run time. No companion module exports a
 * declared constraint's dictionary, so the `Primitive` arm reports a compiler
 * defect and leaves `undefined.member(…)` behind. Both were measured before this
 * split existed; the table simply admitted no declared constraint to reach them.
 *
 * `Unit` never reaches the third arm, and Zero-Cost Fundamental Exports §3.2 is
 * where that is normative rather than incidental: a user constraint never has
 * `Unit` among its candidates. See `honoredAt` for the same fact from the
 * lookup's side.
 */
function editionEvidence(
  constraintIdentity: string,
  type: FundamentalType,
  bool: Resolved.UnionId | undefined,
  instances: EditionInstances,
): Core.Evidence {
  if (!isPreRegisteredIdentity(constraintIdentity)) {
    const dictionary = instances(constraintIdentity, type);
    // The caller reports; a second diagnostic here would be the one failure
    // told twice, and `Error` evidence is what elaboration already writes for a
    // requirement someone else has reported.
    if (dictionary === undefined) return { kind: "Error" };
    return {
      kind: "Instance",
      dictionary,
      arguments: [],
      // The tag a ground site's evidence carries at a primitive head (#344),
      // so an edition whose body calls another specializable function routes to
      // *its* edition exactly as the ground program does (`#groundFundamental`).
      ...(type === "Bool" || type === "Unit" ? {} : { primitive: type }),
    };
  }
  if (type === "Unit") {
    return { kind: "Structural", type: { kind: "Tuple", elements: [] }, components: [] };
  }
  if (type === "Bool") {
    return {
      kind: "Structural",
      type: bool === undefined
        ? { kind: "Error" }
        : { kind: "Union", union: bool, name: "Bool", arguments: [] },
      components: [],
    };
  }
  return { kind: "Primitive", instance: type };
}

/**
 * Which fundamental types honor which constraint, for planning the monomorphic
 * editions (FFI's zero-cost fundamental exports).
 *
 * *(#344.)* The table asks what a type honors, not where the instance lives, so
 * `BigInt`'s row is unchanged by the companion arc — but what an edition's
 * evidence *renders* to did change: a substituted dictionary at a migrated
 * companion resolves to that module's exported instance rather than to a
 * literal built at the use site, which is `#emitEvidence`'s business, not this
 * table's. `Int`, `Nat`, `Float`, and `String` follow at their milestones with
 * no row here moving either.
 */
function fundamentalSupports(
  type: FundamentalType,
  constraint: Typed.ConstraintName,
): boolean {
  const instances: Record<FundamentalType, readonly Typed.ConstraintName[]> = {
    Nat: ["Num", "Eq", "Ord", "Show", "Pow", "Integral"],
    Int: ["Num", "Signed", "Eq", "Ord", "Show", "Pow", "Integral"],
    Float: ["Num", "Signed", "Frac", "Eq", "Ord", "Show", "Pow"],
    BigInt: ["Num", "Signed", "Eq", "Ord", "Show", "Pow", "Integral"],
    Bool: ["Eq", "Ord", "Show"],
    String: ["Eq", "Ord", "Show", "Concat"],
    Unit: ["Eq", "Ord", "Show"],
  };
  return instances[type].includes(constraint);
}

function topLevelTermNames(
  module: Core.Module,
): ReadonlyMap<string, { readonly name: string; readonly exported: boolean }> {
  const names = new Map<string, { name: string; exported: boolean }>();
  const add = (name: string, exported: boolean): void => {
    names.set(name, { name, exported });
  };
  for (const item of module.items) {
    if (item.kind === "Let" || item.kind === "Fun") {
      add(item.binding.name, item.exported);
    } else if (item.kind === "LetPattern") {
      for (const name of patternBindingNames(item.pattern)) add(name, false);
    } else if (item.kind === "RecordDeclaration") {
      add(item.name, item.exported);
    } else if (item.kind === "Union") {
      for (const constructor of item.constructors) add(constructor.name, item.exported);
    } else if (item.kind === "Exception") {
      add(item.binding.name, item.exported);
    } else if (item.kind === "ConstraintDeclaration") {
      for (const member of item.members) add(member.binding.name, false);
    } else if (item.kind === "Import") {
      if (item.form.kind === "Namespace") add(item.form.alias, false);
      if (item.form.kind === "Named") {
        for (const name of item.form.names) add(name.local, false);
      }
    } else if (item.kind === "ExternBlock") {
      for (const declaration of item.declarations) {
        if (declaration.kind !== "ExternType") {
          add(declaration.localName, declaration.exported);
        }
      }
    }
  }
  return names;
}

function patternBindingNames(pattern: Core.Pattern): readonly string[] {
  switch (pattern.kind) {
    case "Binding":
      return [pattern.binding.name];
    case "As":
      return [...patternBindingNames(pattern.pattern), pattern.binding.name];
    case "Or":
      return pattern.alternatives[0] === undefined
        ? []
        : patternBindingNames(pattern.alternatives[0]);
    case "Tuple":
      return pattern.elements.flatMap(patternBindingNames);
    case "Vector":
      return [
        ...pattern.elements.flatMap(patternBindingNames),
        ...(pattern.rest?.pattern === undefined ? [] : patternBindingNames(pattern.rest.pattern)),
      ];
    case "Record":
      return pattern.fields.flatMap(({ pattern }) => patternBindingNames(pattern));
    case "Constructor":
      return pattern.arguments.flatMap(patternBindingNames);
    case "Wildcard":
    case "Unit":
    case "Integer":
    case "String":
      return [];
  }
}

function isSpecializable(item: Core.Item): item is SpecializableItem {
  return item.kind === "Fun" ||
    (item.kind === "Let" && item.value.kind === "Lambda");
}

function cartesian<T>(groups: readonly (readonly T[])[]): readonly T[][] {
  return groups.reduce<readonly T[][]>(
    (rows, group) => rows.flatMap((row) => group.map((entry) => [...row, entry])),
    [[]],
  );
}
