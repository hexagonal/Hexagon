/** Plans the closed family of fundamental editions for constrained functions. */

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
 * each edition emits what a hand-written ground program at the same types emits.
 */
export function specializeItem(
  item: SpecializableItem,
  specialization: FundamentalSpecialization,
  bool: Resolved.UnionId | undefined,
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
    value: specializeBody(item.value, substitutions, bool),
  } as SpecializableItem;
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
 * `Typed.Type`'s and nothing else — the only such `kind` anywhere in the Core or
 * Typed trees — recognised by its numeric `id`; the substituted-id test then
 * narrows it further, so a node this walk rewrites is always a type the
 * assignment names. Type-variable ids are unique across a module, so there is no
 * capture to avoid: no inner binder can rebind an id the scheme generalized.
 */
function specializeBody<T>(
  value: T,
  substitutions: ReadonlyMap<Typed.TypeVariableId, FundamentalType>,
  bool: Resolved.UnionId | undefined,
): T {
  if (Array.isArray(value)) {
    return value.map((element) => specializeBody(element, substitutions, bool)) as T;
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
    // The two enumeration-membered fundamentals name no primitive, so their
    // editions carry the evidence a *ground* site at the same type carries —
    // structural, over the type `substituteType` above wrote into the scheme.
    // `Unit`'s is the automatic tuple instance at arity 0 (#159); `Bool`'s is
    // `stdlib/Bool.hex`'s derived walk (#147), which is what makes an edition's
    // rendering agree with every other spelling of the same call: `"True"`
    // rather than the host's `String(x)`.
    if (replacement === "Unit") {
      return { kind: "Structural", type: { kind: "Tuple", elements: [] }, components: [] } as T;
    }
    if (replacement === "Bool") {
      return {
        kind: "Structural",
        type: bool === undefined
          ? { kind: "Error" }
          : { kind: "Union", union: bool, name: "Bool", arguments: [] },
        components: [],
      } as T;
    }
    if (replacement !== undefined) {
      return { kind: "Primitive", instance: replacement } as T;
    }
  }
  return Object.fromEntries(
    Object.entries(candidate).map(([key, nested]) => [
      key,
      specializeBody(nested, substitutions, bool),
    ]),
  ) as T;
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
