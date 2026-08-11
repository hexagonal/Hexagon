import { IMPURE_ARROW, linkedArrow, PURE_ARROW } from "../../support/arrows.js";
import { collectEffectVariables } from "./effects.js";
import type * as Typed from "./tree.js";

/**
 * How each effect variable in one displayed signature is numbered, empty when
 * nothing is numbered (`support/arrows.ts`, #364).
 */
type EffectNumbering = ReadonlyMap<Typed.TypeVariableId, number>;

const NOTHING_NUMBERED: EffectNumbering = new Map();

/** Renders an inferred binding scheme in Hexagon's user-facing type notation. */
export function displayScheme(scheme: Typed.Scheme): string {
  // One scheme is one displayed signature, so the whole of it — constraints
  // included — is what the effect variables are numbered across.
  const colours = effectVariables(scheme);
  const variables = variableNames(scheme, colours);
  const numbering: EffectNumbering = writesBackUnchanged(scheme, colours)
    ? NOTHING_NUMBERED
    : new Map(colours.map((colour, index) => [colour, index + 1]));
  const constraints = scheme.constraints.map(
    (constraint) =>
      `${constraint.name} ${displayType(constraint.type, variables, numbering)}`,
  );
  const type = displayType(scheme.type, variables, numbering);

  return constraints.length === 0
    ? type
    : `${constraints.join(", ")} => ${type}`;
}

/**
 * A function type's arrow (`spec/effects.md` §2). An absent slot is the pure
 * constant, so a signature that never wrote a colour displays exactly the `->`
 * it always has — purity is the silent one (§1).
 */
function displayArrow(
  effect: Typed.Effect | undefined,
  numbering: EffectNumbering,
): string {
  if (effect === undefined) return PURE_ARROW;
  if (effect === "impure") return IMPURE_ARROW;
  return linkedArrow(numbering.get(effect.variable));
}

function displayType(
  type: Typed.Type,
  variables: ReadonlyMap<Typed.TypeVariableId, string>,
  numbering: EffectNumbering,
): string {
  switch (type.kind) {
    case "Primitive":
      return type.name;
    case "Range":
      return "Range";
    case "Vector":
      return `Vector(${displayType(type.element, variables, numbering)})`;
    case "Set":
      return `Set(${displayType(type.element, variables, numbering)})`;
    case "Map":
      return `Map(${displayType(type.key, variables, numbering)}, ${displayType(type.value, variables, numbering)})`;
    case "Array":
      return `Array(${displayType(type.element, variables, numbering)})`;
    case "JsMap":
      return `JsMap(${displayType(type.key, variables, numbering)}, ${displayType(type.value, variables, numbering)})`;
    case "JsSet":
      return `JsSet(${displayType(type.element, variables, numbering)})`;
    case "Node":
      return `Node(${displayType(type.element, variables, numbering)})`;
    case "Nullable":
      return `Nullable(${displayType(type.value, variables, numbering)})`;
    case "Variable":
      return variables.get(type.id) ?? `t${Number(type.id)}`;
    case "Error":
      return "?";
    case "Tuple":
      // The arity-0 tuple displays as `Unit`, never `()` — the type's one name
      // (Products §2.7, #159); `()` in type notation is only the zero-parameter
      // domain below.
      if (type.elements.length === 0) return "Unit";
      return `(${type.elements.map((element) =>
        displayType(element, variables, numbering)
      ).join(", ")})`;
    case "Record": {
      const fields = type.fields.map(({ name, type: field }) =>
        `${name}: ${displayType(field, variables, numbering)}`
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
          displayType(argument, variables, numbering)
        ).join(", ")})`;
    case "NominalRecord":
      return type.arguments.length === 0
        ? type.name
        : `${type.name}(${type.arguments.map((argument) =>
          displayType(argument, variables, numbering)
        ).join(", ")})`;
    case "ExternType":
      return type.name;
    case "Function": {
      const parameters = type.parameters.map((parameter) =>
        displayType(parameter, variables, numbering),
      );
      const soleParameter = type.parameters[0];
      const domain =
        parameters.length === 0
          ? "()"
          : parameters.length === 1
            // A sole `Unit` parameter displays bare — it renders as a name, so
            // the parens that keep `((a, b)) -> c` from reading as two
            // parameters have nothing to disambiguate.
            ? soleParameter?.kind === "Function" ||
                (soleParameter?.kind === "Tuple" && soleParameter.elements.length > 0)
              ? `(${parameters[0]})`
              : parameters[0]!
            : `(${parameters.join(", ")})`;
      return (
        `${domain} ${displayArrow(type.effect, numbering)} ` +
        displayType(type.result, variables, numbering)
      );
    }
  }
}

/**
 * Whether the undecorated arrows say exactly what this scheme says (#364;
 * narrowed to one condition by #405).
 *
 * **One** distinct effect variable, because a written signature links every
 * `->?` into a single variable (§2.2) and two would come back as one. That is
 * now the whole test.
 *
 * The predecessor carried a second condition — at least one **inlet**
 * occurrence — because the else-constant rule read an inlet-less `=>` back as
 * the impure constant, so `(() -> String) => Int` would have written back as a
 * different *type*. With that rule withdrawn (§2.2.1) the undecorated spelling
 * no longer changes meaning; it is refused outright by §4.4, with a sentence
 * saying why. Numbering is for what the grammar cannot express, not for what
 * the checker will reject, so the lone inlet-less variable displays plainly.
 *
 * A face with no variable at all is trivially unchanged: constants round-trip.
 */
function writesBackUnchanged(
  _scheme: Typed.Scheme,
  colours: readonly Typed.TypeVariableId[],
): boolean {
  return colours.length <= 1;
}

/**
 * The scheme's effect variables, in the order the rendered text first reaches
 * them (#364). Constraints come first because they are printed first.
 */
function effectVariables(scheme: Typed.Scheme): readonly Typed.TypeVariableId[] {
  const found = new Set<Typed.TypeVariableId>();
  for (const constraint of scheme.constraints) collectEffectVariables(constraint.type, found);
  collectEffectVariables(scheme.type, found);
  return [...found];
}

/**
 * A letter for every type variable the signature can show — and for no effect
 * variable, which wears an arrow rather than a name.
 *
 * A quantified scheme carries its effect variables in `variables` beside the
 * ordinary ones (they *are* type variables, `spec/effects.md` §3.4), so without
 * the exclusion a colour would take `a` from the type variable that goes on to
 * display as `b`, and `(() => Int, a) -> a` would print as `(() => Int, b) -> b`
 * with no `a` anywhere. A variable that is somehow both — none is built today —
 * keeps its letter, because `collectVariables` puts it back.
 */
function variableNames(
  scheme: Typed.Scheme,
  colours: readonly Typed.TypeVariableId[],
): ReadonlyMap<Typed.TypeVariableId, string> {
  const effects = new Set(colours);
  const variables = new Set(scheme.variables.filter((variable) => !effects.has(variable)));
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
    case "ExternType":
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
