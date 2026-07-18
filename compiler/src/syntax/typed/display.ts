import type * as Typed from "./tree.js";

/** Renders an inferred binding scheme in Hexagon's user-facing type notation. */
export function displayScheme(scheme: Typed.Scheme): string {
  const variables = variableNames(scheme);
  const constraints = scheme.constraints.map(
    (constraint) =>
      `${constraint.name} ${displayType(constraint.type, variables)}`,
  );
  const type = displayType(scheme.type, variables);

  return constraints.length === 0
    ? type
    : `${constraints.join(", ")} => ${type}`;
}

function displayType(
  type: Typed.Type,
  variables: ReadonlyMap<Typed.TypeVariableId, string>,
): string {
  switch (type.kind) {
    case "Primitive":
      return type.name;
    case "Range":
      return "Range";
    case "Variable":
      return variables.get(type.id) ?? `t${Number(type.id)}`;
    case "Error":
      return "?";
    case "Tuple":
      return `(${type.elements.map((element) =>
        displayType(element, variables)
      ).join(", ")})`;
    case "Record": {
      const fields = type.fields.map(({ name, type: field }) =>
        `${name}: ${displayType(field, variables)}`
      );
      if (type.tail !== undefined) {
        fields.push(`...${variables.get(type.tail) ?? `t${Number(type.tail)}`}`);
      }
      return `{${fields.join(", ")}}`;
    }
    case "Union":
      return type.arguments.length === 0
        ? type.name
        : `${type.name}(${type.arguments.map((argument) =>
          displayType(argument, variables)
        ).join(", ")})`;
    case "NominalRecord":
      return type.arguments.length === 0
        ? type.name
        : `${type.name}(${type.arguments.map((argument) =>
          displayType(argument, variables)
        ).join(", ")})`;
    case "Function": {
      const parameters = type.parameters.map((parameter) =>
        displayType(parameter, variables),
      );
      const domain =
        parameters.length === 0
          ? "()"
          : parameters.length === 1
            ? type.parameters[0]?.kind === "Function" ||
                type.parameters[0]?.kind === "Tuple"
              ? `(${parameters[0]})`
              : parameters[0]!
            : `(${parameters.join(", ")})`;
      return (
        `${domain} -> ` +
        displayType(type.result, variables)
      );
    }
  }
}

function variableNames(
  scheme: Typed.Scheme,
): ReadonlyMap<Typed.TypeVariableId, string> {
  const variables = new Set(scheme.variables);
  collectVariables(scheme.type, variables);
  for (const constraint of scheme.constraints) {
    collectVariables(constraint.type, variables);
  }

  return new Map(
    [...variables].map((variable, index) => [variable, variableName(index)]),
  );
}

function collectVariables(
  type: Typed.Type,
  variables: Set<Typed.TypeVariableId>,
): void {
  switch (type.kind) {
    case "Variable":
      variables.add(type.id);
      return;
    case "Function":
      for (const parameter of type.parameters) {
        collectVariables(parameter, variables);
      }
      collectVariables(type.result, variables);
      return;
    case "Tuple":
      for (const element of type.elements) collectVariables(element, variables);
      return;
    case "Record":
      for (const field of type.fields) collectVariables(field.type, variables);
      if (type.tail !== undefined) variables.add(type.tail);
      return;
    case "Union":
      for (const argument of type.arguments) collectVariables(argument, variables);
      return;
    case "NominalRecord":
      for (const argument of type.arguments) collectVariables(argument, variables);
      return;
    case "Primitive":
    case "Range":
    case "Error":
      return;
  }
}

function variableName(index: number): string {
  const letter = String.fromCharCode("a".charCodeAt(0) + (index % 26));
  const cycle = Math.floor(index / 26);
  return cycle === 0 ? letter : `${letter}${cycle}`;
}
