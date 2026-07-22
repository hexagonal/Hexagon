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

export type FundamentalType = Exclude<Typed.PrimitiveName, "Exn">;

const fundamentalTypes: readonly FundamentalType[] = [
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

  for (const item of module.items) {
    if (!isSpecializable(item) || (!includePrivate && !item.exported)) continue;
    const planned = planItem(item);
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

/** Instantiates types and evidence so an edition emits concrete operations. */
export function specializeItem(
  item: SpecializableItem,
  specialization: FundamentalSpecialization,
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
    value: replaceDictionaryEvidence(item.value, substitutions),
  } as SpecializableItem;
}

function planItem(item: SpecializableItem): readonly FundamentalSpecialization[] {
  if (item.binding.scheme.constraints.length === 0) return [];
  if (item.kind === "Let" && item.value.kind !== "Lambda") return [];

  const constraints = new Map<Typed.TypeVariableId, Set<Typed.ConstraintName>>();
  for (const requirement of item.binding.scheme.constraints) {
    if (requirement.type.kind !== "Variable") continue;
    const names = constraints.get(requirement.type.id) ?? new Set();
    names.add(requirement.name);
    constraints.set(requirement.type.id, names);
  }
  const specializing = item.binding.scheme.variables.filter((variable) =>
    constraints.has(variable)
  );
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
      sourceSymbol: item.binding.symbol,
      sourceName: item.binding.name,
      sourceExported: item.exported,
      name: `${item.binding.name}${types.join("")}`,
      assignment,
      scheme: specializeScheme(item.binding.scheme, new Map(
        assignment.map(({ variable, type }) => [variable, type] as const),
      )),
    };
  });
}

function specializeScheme(
  scheme: Typed.Scheme,
  substitutions: ReadonlyMap<Typed.TypeVariableId, FundamentalType>,
): Typed.Scheme {
  return {
    variables: scheme.variables.filter((variable) => !substitutions.has(variable)),
    constraints: scheme.constraints
      .filter(({ type }) => type.kind !== "Variable" || !substitutions.has(type.id))
      .map((constraint) => ({
        ...constraint,
        type: substituteType(constraint.type, substitutions),
      })),
    type: substituteType(scheme.type, substitutions),
  };
}

function substituteType(
  type: Typed.Type,
  substitutions: ReadonlyMap<Typed.TypeVariableId, FundamentalType>,
): Typed.Type {
  switch (type.kind) {
    case "Variable": {
      const replacement = substitutions.get(type.id);
      return replacement === undefined ? type : { kind: "Primitive", name: replacement };
    }
    case "Function":
      return {
        ...type,
        parameters: type.parameters.map((parameter) =>
          substituteType(parameter, substitutions)
        ),
        result: substituteType(type.result, substitutions),
      };
    case "Tuple":
      return {
        ...type,
        elements: type.elements.map((element) => substituteType(element, substitutions)),
      };
    case "Vector":
      return { ...type, element: substituteType(type.element, substitutions) };
    case "Set":
      return { ...type, element: substituteType(type.element, substitutions) };
    case "Map":
      return {
        ...type,
        key: substituteType(type.key, substitutions),
        value: substituteType(type.value, substitutions),
      };
    case "Array":
      return { ...type, element: substituteType(type.element, substitutions) };
    case "Nullable":
      return { ...type, value: substituteType(type.value, substitutions) };
    case "Seq":
      return { ...type, element: substituteType(type.element, substitutions) };
    case "Record":
      return {
        ...type,
        fields: type.fields.map((field) => ({
          ...field,
          type: substituteType(field.type, substitutions),
        })),
      };
    case "Union":
    case "NominalRecord":
      return {
        ...type,
        arguments: type.arguments.map((argument) =>
          substituteType(argument, substitutions)
        ),
      };
    case "Primitive":
    case "Range":
    case "ExternType":
    case "Error":
      return type;
  }
}

function replaceDictionaryEvidence<T>(
  value: T,
  substitutions: ReadonlyMap<Typed.TypeVariableId, FundamentalType>,
): T {
  if (Array.isArray(value)) {
    return value.map((element) => replaceDictionaryEvidence(element, substitutions)) as T;
  }
  if (value === null || typeof value !== "object") return value;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "Dictionary" && typeof candidate.variable === "number") {
    const replacement = substitutions.get(candidate.variable as Typed.TypeVariableId);
    if (replacement !== undefined) {
      return { kind: "Primitive", instance: replacement } as T;
    }
  }
  return Object.fromEntries(
    Object.entries(candidate).map(([key, nested]) => [
      key,
      replaceDictionaryEvidence(nested, substitutions),
    ]),
  ) as T;
}

function fundamentalSupports(
  type: FundamentalType,
  constraint: Typed.ConstraintName,
): boolean {
  const instances: Record<FundamentalType, readonly Typed.ConstraintName[]> = {
    Int: ["Signed", "Eq", "Ord", "Show", "Pow"],
    Float: ["Signed", "Frac", "Eq", "Ord", "Show", "Pow"],
    BigInt: ["Signed", "Eq", "Ord", "Show", "Pow"],
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
    case "Boolean":
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
