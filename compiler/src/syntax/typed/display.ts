import { IMPURE_ARROW, FOLLOWS_ARROW, PURE_ARROW } from "../../support/arrows.js";
import { collectEffectVariables } from "./effects.js";
import type * as Typed from "./tree.js";

/** Renders an inferred binding scheme in Hexagon's user-facing type notation. */
export function displayScheme(scheme: Typed.Scheme): string {
  return displayFace(scheme).type;
}

/**
 * Where a face is displayed, for §10's owner line: whose callback each settled
 * callback colour is (`Typed.Module.colourOwners`).
 */
export interface ColourContext {
  readonly owners: ReadonlyMap<Typed.TypeVariableId, string>;
}

/**
 * The colour context at one location of a module *(Effects §10)*, or
 * `undefined` where the module has no callback colour to name.
 */
export function colourContextAt(
  module: Pick<Typed.Module, "colourOwners">,
): ColourContext | undefined {
  if (module.colourOwners.size === 0) return undefined;
  return { owners: module.colourOwners };
}

/**
 * A scheme as displayed *(Effects §10)*: the type, and one owner line for each
 * captured colour the face depends on — a callback's colour of an enclosing
 * function, which the scheme does not quantify. A captured colour shows `>->`
 * where the face depends on it, and the owner line is information, not grammar.
 */
export function displayFace(
  scheme: Typed.Scheme,
  context?: ColourContext,
): { readonly type: string; readonly owners: readonly string[] } {
  const colours = effectVariables(scheme);
  const variables = variableNames(scheme, colours);
  const captured = context === undefined
    ? []
    : colours.filter((colour) => context.owners.has(colour) && !scheme.variables.includes(colour));
  return {
    type: `${displayConstraints(scheme, variables)}${displayType(scheme.type, variables, "spine")}`,
    owners: [...new Set(captured.map((colour) => `depends on ${context!.owners.get(colour)!}`))],
  };
}

/**
 * A scheme's constraints as source's own binder bracket (`spec/functions.md`
 * §5.1, §4.2), prefixing the type and set off by one space — `<a: Show> ` — or
 * the empty string when the scheme is constraint-free.
 *
 * The relation between a variable and its constraints is spelled `<a: Show>`
 * everywhere in Hexagon's grammar; the Haskell-flavored `Show a =>` it replaces
 * belonged to no grammar position at all, and its separator was the last
 * non-term reading of `=>` (#410). Grouping is §4.2's conjunction form, so a
 * variable's second and further constraints join it inside one entry:
 * `<a: (Num, Show)>`. Entries follow the display's variable-letter order —
 * which is the scheme's quantifier order, not the constraint list's — and
 * conjuncts within an entry order alphabetically by constraint name, which is
 * the evidence suffix's second key (FFI Part 9 §6.2, Constraints §6.1). The
 * order constraints happened to accumulate in is no more visible here than it
 * is in the ABI.
 *
 * Across variables the bracket does **not** track the suffix, and is not meant
 * to: the letters follow the type, while the suffix's ordinal is a declared
 * position, so `<b: Show, a: Show>(x: a, y: b)` displays `<a: Show, b: Show>`
 * against an arriving `(__Show_b, __Show_a)`. Both faces are canonical and
 * neither is wrong; they answer different questions (Functions §5.1).
 *
 * A generalized scheme constrains only bare type variables (even
 * `show((x, y))` decomposes structurally before generalization), so every
 * subject renders as a letter and every entry is a verbatim source spelling.
 * The bracket *as a whole* remains machine-written notation — an annotation
 * cannot carry a binder list (§4.2) — under Effects §10's license: display
 * marks what the grammar cannot express.
 */
function displayConstraints(
  scheme: Typed.Scheme,
  variables: ReadonlyMap<Typed.TypeVariableId, string>,
): string {
  const groups = new Map<string, string[]>();
  for (const constraint of scheme.constraints) {
    const subject = displayType(constraint.type, variables, "inside");
    const group = groups.get(subject);
    if (group === undefined) groups.set(subject, [constraint.name]);
    else group.push(constraint.name);
  }
  if (groups.size === 0) return "";

  // A subject the letters do not name is not something the checker builds; it
  // sorts last rather than vanishing.
  const letters = [...variables.values()];
  const rank = (subject: string): number => {
    const index = letters.indexOf(subject);
    return index === -1 ? letters.length : index;
  };

  const entries = [...groups]
    .sort(([left], [right]) => rank(left) - rank(right))
    .map(([subject, names]) => {
      const conjuncts = [...names].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
      return `${subject}: ${
        conjuncts.length === 1 ? conjuncts[0] : `(${conjuncts.join(", ")})`
      }`;
    });

  return `<${entries.join(", ")}> `;
}

/**
 * Where an arrow stands in a displayed face (Effects §10), which decides how a
 * colour that is not a constant is spelled there: on the face's spine and in
 * what it returns, a colour that depends on callbacks is `>->`; on a
 * callback's own arrows it is the callback's colour, `->!`; anywhere else
 * inside a parameter type an arrow means what it says, so an undecided colour
 * there shows the constant `->!`.
 */
type ArrowPlace = "spine" | "callback" | "inside";

/**
 * A function type's arrow (`spec/effects.md` §2, §10). An absent slot is the
 * pure constant, so a signature that never wrote a colour displays exactly the
 * `->` it always has — purity is the silent one (§1). No colour is numbered.
 */
function displayArrow(effect: Typed.Effect | undefined, place: ArrowPlace): string {
  if (effect === undefined) return PURE_ARROW;
  // A colour in error shows `->!` (§3.5, §10, #1223): no purity is claimed for a
  // function whose body could not be read.
  if (effect === "impure" || effect === "error") return IMPURE_ARROW;
  return place === "spine" ? FOLLOWS_ARROW : IMPURE_ARROW;
}

function displayType(
  type: Typed.Type,
  variables: ReadonlyMap<Typed.TypeVariableId, string>,
  place: ArrowPlace,
): string {
  // Every component that is not the spine's own next arrow stands inside what
  // this arrow returns or is handed; a function there keeps the place's
  // reading, and so does everything beneath it.
  const inner = (part: Typed.Type): string => displayType(part, variables, place);
  switch (type.kind) {
    case "Primitive":
      return type.name;
    case "Range":
      return "Range";
    case "Vector":
      return `Vector(${inner(type.element)})`;
    case "Set":
      return `Set(${inner(type.element)})`;
    case "Map":
      return `Map(${inner(type.key)}, ${inner(type.value)})`;
    case "Array":
      return `Array(${inner(type.element)})`;
    case "JsMap":
      return `JsMap(${inner(type.key)}, ${inner(type.value)})`;
    case "JsSet":
      return `JsSet(${inner(type.element)})`;
    case "JsValue":
      return "JsValue";
    case "Node":
      return `Node(${inner(type.element)})`;
    case "Nullable":
      return `Nullable(${inner(type.value)})`;
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
        inner(element)
      ).join(", ")})`;
    case "Record": {
      const fields = type.fields.map(({ name, type: field }) =>
        `${name}: ${inner(field)}`
      );
      if (type.tail !== undefined) {
        // A tail the letters do not name is an unquantified row, and it renders
        // as the bare `...` the checker's own diagnostics write. Its internal
        // number is not a name — #649: no user-facing rendering shows a
        // numbered inference variable — and inventing a letter for it would
        // claim a quantifier that is not there. A quantified tail keeps its
        // letter, `...a`.
        fields.push(`...${variables.get(type.tail) ?? ""}`);
      }
      return `{${fields.join(", ")}}`;
    }
    case "Union":
      return type.arguments.length === 0
        ? type.name
        : `${type.name}(${type.arguments.map((argument) =>
          inner(argument)
        ).join(", ")})`;
    case "NominalRecord":
      return type.arguments.length === 0
        ? type.name
        : `${type.name}(${type.arguments.map((argument) =>
          inner(argument)
        ).join(", ")})`;
    case "ExternType":
      // #927: a parameterized intrinsic `type` row displays its arguments like
      // any nominal's. A foreign extern type has none and reads as its bare name.
      return type.arguments.length === 0
        ? type.name
        : `${type.name}(${type.arguments.map((argument) =>
          inner(argument)
        ).join(", ")})`;
    case "Function": {
      // A spine arrow's function-typed parameters are callbacks, whose own
      // arrows — and those of the functions they return — carry their colours;
      // everything else in a parameter means what it says (Effects §2.4).
      const parameters = type.parameters.map((parameter) =>
        displayType(parameter, variables, place === "spine" && parameter.kind === "Function" ? "callback" : "inside"),
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
        `${domain} ${displayArrow(type.effect, place)} ` +
        displayType(type.result, variables, place === "callback" && type.result.kind !== "Function" ? "inside" : place)
      );
    }
  }
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
