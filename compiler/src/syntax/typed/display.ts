import { displayedArrow, type ShownColour } from "../../support/arrows.js";
import { collectEffectVariables } from "./effects.js";
import type * as Typed from "./tree.js";

/** Renders an inferred binding scheme in Hexagon's user-facing type notation. */
export function displayScheme(scheme: Typed.Scheme): string {
  return displayFace(scheme).type;
}

/**
 * Where a face is displayed, for §10's gloss: whose callback each settled
 * callback colour is (`Typed.Module.colourOwners`), and its parameter's name
 * (`Typed.Module.colourNames`).
 */
export interface ColourContext {
  readonly owners: ReadonlyMap<Typed.TypeVariableId, string>;
  readonly names?: ReadonlyMap<Typed.TypeVariableId, string>;
}

/**
 * The colour context at one location of a module *(Effects §10)*, or
 * `undefined` where the module has no callback colour to name.
 */
export function colourContextAt(
  module: Pick<Typed.Module, "colourOwners"> & Partial<Pick<Typed.Module, "colourNames">>,
): ColourContext | undefined {
  if (module.colourOwners.size === 0 && (module.colourNames?.size ?? 0) === 0) return undefined;
  return { owners: module.colourOwners, ...(module.colourNames === undefined ? {} : { names: module.colourNames }) };
}

/**
 * A scheme as displayed *(Effects §10)*: the type, and the gloss, which reads
 * the outer arrow's two colours in words. A colour that passes through names
 * the callbacks it follows: the face's own by their parameters' names, and a
 * captured one, an enclosing function's callback the scheme does not
 * quantify, by its owner. The gloss is information, not grammar.
 */
export function displayFace(
  scheme: Typed.Scheme,
  context?: ColourContext,
): { readonly type: string; readonly owners: readonly string[] } {
  const { type, owners } = displayCallFace(scheme, context);
  return { type, owners };
}

/**
 * A face as `displayFace` shows it, and where in that text each piece of its
 * outer arrow stands, as `[start, end)` offsets: each parameter, which
 * signature help highlights as it is written, and the result. The binder list
 * is given apart, without the space that sets it off, and so is each of its
 * entries, by the type it constrains. A face that is not a function has no
 * parameters and no result.
 *
 * The positions come from the same pieces the text is built from, so the two
 * cannot disagree.
 *
 * With `letters`, the face is lettered as one display among several of one
 * declaration (`Letters`), which is how inlay hints show a declaration piece by
 * piece without letting two of its pieces disagree.
 */
export function displayCallFace(
  scheme: Typed.Scheme,
  context?: ColourContext,
  letters?: Letters,
): {
  readonly type: string;
  readonly owners: readonly string[];
  readonly binder: string;
  readonly binderEntries: readonly BinderEntry[];
  readonly parameters: readonly (readonly [number, number])[];
  readonly result?: readonly [number, number];
} {
  const colours = effectVariables(scheme);
  const variables = letters === undefined
    ? variableNames(scheme, colours)
    : letters.letter(variableOrder(scheme, colours));
  const binderEntries = displayConstraints(scheme, variables);
  const binder = binderEntries.length === 0 ? "" : `<${binderEntries.map(({ text }) => text).join(", ")}>`;
  const constraints = binder === "" ? "" : `${binder} `;
  const chosen = new Set(scheme.callersChoice ?? []);
  const owners = ownerLines(scheme, context);
  if (scheme.type.kind !== "Function") {
    return {
      type: `${constraints}${displayType(scheme.type, variables, "spine", chosen)}`,
      owners,
      binder,
      binderEntries,
      parameters: [],
    };
  }
  const shown = displayFunction(scheme.type, variables, "spine", chosen);
  return {
    type: `${constraints}${shown.text}`,
    owners,
    binder,
    binderEntries,
    parameters: shown.parameters.map(([start, end]) => [constraints.length + start, constraints.length + end] as const),
    result: [constraints.length + shown.result, constraints.length + shown.text.length],
  };
}

/**
 * The letters every display of one declaration shares *(inlay hints, Effects
 * §10)*. A type variable keeps one letter across all of them: the spelling the
 * source writes for it where it writes one, since a type variable written
 * anywhere in one declaration is one variable (Functions §4.1), and otherwise
 * the first letter no spelling of the declaration takes, minted in the order
 * the face it first appears in reaches it. A declaration that writes no
 * variable is lettered exactly as its face is on its own.
 *
 * Shown one display at a time, each type letters from `a` (Functions §5.1), so
 * `first: a` and `second: a` both stand beside `pairUp: (a, b) -> (a, b)`.
 * Shown together, as hints are, that would claim a tie the function does not
 * have.
 */
export class Letters {
  readonly #names = new Map<Typed.TypeVariableId, string>();
  readonly #taken = new Set<string>();

  /**
   * Records that the source writes this variable `name`. A variable written
   * twice in one declaration is written with one name, or the checker refuses
   * the declaration; one name may still be written for two variables where
   * the declaration has parts that scope their own (Functions §7.3).
   */
  bind(id: Typed.TypeVariableId, name: string): void {
    this.#taken.add(name);
    this.#names.set(id, name);
  }

  /** Reserves a spelling the declaration writes, whatever it names. */
  reserve(name: string): void {
    this.#taken.add(name);
  }

  /** Letters `variables` in order, minting for those with no letter yet; every letter so far. */
  letter(variables: Iterable<Typed.TypeVariableId>): ReadonlyMap<Typed.TypeVariableId, string> {
    for (const variable of variables) {
      if (this.#names.has(variable)) continue;
      for (let index = 0; ; index += 1) {
        const candidate = variableName(index);
        if (this.#taken.has(candidate)) continue;
        this.bind(variable, candidate);
        break;
      }
    }
    return this.#names;
  }
}

/**
 * The gloss (Effects §10): the outer arrow's world colour and fail colour in
 * words, one clause each — "pure", "impure" or "impure only if `f` is"; then
 * "cannot fail", "may fail" or "may fail only if `f` may" — for every face
 * whose outer arrow is not `->`, since silence is the strong claim (§1).
 */
function ownerLines(scheme: Typed.Scheme, context: ColourContext | undefined): readonly string[] {
  if (scheme.type.kind !== "Function") return [];
  const arrow = scheme.type;
  if (arrow.effect === undefined && arrow.fail === undefined) return [];
  const parts = (effect: Typed.Effect): readonly Typed.TypeVariableId[] =>
    typeof effect !== "object" ? [] : "join" in effect ? effect.join : [effect.variable];
  // The callbacks a colour passes through: the face's own by name, a captured
  // one by its owner, and "what it is handed" for those with no name to quote.
  const followed = (effect: Typed.Effect): string => {
    const names: string[] = [];
    let unnamed = false;
    for (const part of parts(effect)) {
      const name = scheme.variables.includes(part)
        ? context?.names?.get(part)
        : context?.owners.get(part);
      if (name === undefined) {
        unnamed = true;
        continue;
      }
      const quoted = scheme.variables.includes(part) ? `\`${name}\`` : name;
      if (!names.includes(quoted)) names.push(quoted);
    }
    if (unnamed || names.length === 0) names.push("what it is handed");
    return names.join(" or ");
  };
  const world = arrow.effect === undefined
    ? "pure"
    : typeof arrow.effect === "object"
    ? `impure only if ${followed(arrow.effect)} is`
    : "impure";
  const fail = arrow.fail === undefined
    ? "cannot fail"
    : typeof arrow.fail === "object"
    ? `may fail only if ${followed(arrow.fail)} may`
    : "may fail";
  return [`${world}; ${fail}`];
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
/** One entry of a displayed binder list: `a: Show`, and the type it constrains, `a`. */
export interface BinderEntry {
  readonly subject: string;
  readonly text: string;
}

function displayConstraints(
  scheme: Typed.Scheme,
  variables: ReadonlyMap<Typed.TypeVariableId, string>,
): readonly BinderEntry[] {
  const groups = new Map<string, string[]>();
  for (const constraint of scheme.constraints) {
    const subject = displayType(constraint.type, variables, "inside");
    const group = groups.get(subject);
    if (group === undefined) groups.set(subject, [constraint.name]);
    else group.push(constraint.name);
  }
  if (groups.size === 0) return [];

  // A subject the letters do not name is not something the checker builds; it
  // sorts last rather than vanishing.
  const letters = [...variables.values()];
  const rank = (subject: string): number => {
    const index = letters.indexOf(subject);
    return index === -1 ? letters.length : index;
  };

  return [...groups]
    .sort(([left], [right]) => rank(left) - rank(right))
    .map(([subject, names]) => {
      const conjuncts = [...names].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
      return {
        subject,
        text: `${subject}: ${conjuncts.length === 1 ? conjuncts[0] : `(${conjuncts.join(", ")})`}`,
      };
    });
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
 * A function type's arrow (`spec/effects.md` §2, §10), from its two colours.
 * An absent slot is silent, so a signature that never wrote a colour displays
 * exactly the `->` it always has — silence is the strong claim (§1). No colour
 * is numbered.
 */
function displayArrow(
  type: Typed.FunctionType,
  place: ArrowPlace,
  chosen: ReadonlySet<Typed.TypeVariableId> = NONE_CHOSEN,
): string {
  // A colour in error shows its constant (§3.5, §10, #1223): nothing is claimed
  // silent for a function whose body could not be read. A colour that is the
  // caller's choice, where an argument read backwards hands the function in,
  // is any function: the constant (§10, #1184).
  const shown = (effect: Typed.Effect | undefined): ShownColour =>
    effect === undefined
      ? "silent"
      : effect === "impure" || effect === "error" || isCallersChoice(effect, chosen)
      ? "constant"
      : "follows";
  return displayedArrow(shown(type.effect), shown(type.fail), place);
}

/** No colour is the caller's choice. */
const NONE_CHOSEN: ReadonlySet<Typed.TypeVariableId> = new Set();

/**
 * Whether a colour is the caller's choice (`Scheme.callersChoice`): a variable
 * among `chosen`, or a join of them only. It is shown and written as the
 * constant (`spec/effects.md` §10, #1184).
 */
export function isCallersChoice(effect: Typed.Effect, chosen: ReadonlySet<Typed.TypeVariableId>): boolean {
  return typeof effect === "object" &&
    ("variable" in effect ? chosen.has(effect.variable) : effect.join.every((variable) => chosen.has(variable)));
}

function displayType(
  type: Typed.Type,
  variables: ReadonlyMap<Typed.TypeVariableId, string>,
  place: ArrowPlace,
  chosen: ReadonlySet<Typed.TypeVariableId> = NONE_CHOSEN,
): string {
  // Every component that is not the spine's own next arrow stands inside what
  // this arrow returns or is handed; a function there keeps the place's
  // reading, and so does everything beneath it.
  const inner = (part: Typed.Type): string => displayType(part, variables, place, chosen);
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
    case "Function":
      return displayFunction(type, variables, place, chosen).text;
  }
}

/**
 * A function type as displayed, and where each of its parameters stands in
 * the text (`displayCallFace`).
 */
function displayFunction(
  type: Typed.FunctionType,
  variables: ReadonlyMap<Typed.TypeVariableId, string>,
  place: ArrowPlace,
  chosen: ReadonlySet<Typed.TypeVariableId>,
): {
  readonly text: string;
  readonly parameters: readonly (readonly [number, number])[];
  /** Where the result starts in `text`; it runs to the end. */
  readonly result: number;
} {
  // A spine arrow's function-typed parameters are callbacks, whose own
  // arrows — and those of the functions they return — carry their colours;
  // everything else in a parameter means what it says (Effects §2.4).
  const parameters = type.parameters.map((parameter) =>
    displayType(parameter, variables, place === "spine" && parameter.kind === "Function" ? "callback" : "inside", chosen),
  );
  const soleParameter = type.parameters[0];
  // A sole `Unit` parameter displays bare — it renders as a name, so the
  // parens that keep `((a, b)) -> c` from reading as two parameters have
  // nothing to disambiguate.
  const bare = parameters.length === 1 &&
    !(soleParameter?.kind === "Function" ||
      (soleParameter?.kind === "Tuple" && soleParameter.elements.length > 0));
  const domain = parameters.length === 0
    ? "()"
    : bare
    ? parameters[0]!
    : `(${parameters.join(", ")})`;
  const ranges: (readonly [number, number])[] = [];
  let at = bare ? 0 : 1;
  for (const parameter of parameters) {
    ranges.push([at, at + parameter.length]);
    at += parameter.length + ", ".length;
  }
  const head = `${domain} ${displayArrow(type, place, chosen)} `;
  return {
    text: head +
      displayType(type.result, variables, place === "callback" && type.result.kind !== "Function" ? "inside" : place, chosen),
    parameters: ranges,
    result: head.length,
  };
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
  return new Map(
    variableOrder(scheme, colours).map((variable, index) => [variable, variableName(index)]),
  );
}

/** The variables `variableNames` letters, in the order it letters them. */
function variableOrder(
  scheme: Typed.Scheme,
  colours: readonly Typed.TypeVariableId[],
): readonly Typed.TypeVariableId[] {
  const effects = new Set(colours);
  const variables = new Set(scheme.variables.filter((variable) => !effects.has(variable)));
  collectVariables(scheme.type, variables);
  for (const constraint of scheme.constraints) {
    collectVariables(constraint.type, variables);
  }
  return [...variables];
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
      // Not the tail: a tail takes a letter only when the scheme quantifies it,
      // and otherwise renders bare (`displayType`).
      for (const field of type.fields) collectVariables(field.type, variables);
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
    case "Vector":
    case "Set":
    case "Array":
    case "JsSet":
    case "Node":
      collectVariables(type.element, variables);
      return;
    case "Map":
    case "JsMap":
      collectVariables(type.key, variables);
      collectVariables(type.value, variables);
      return;
    case "Nullable":
      collectVariables(type.value, variables);
      return;
    case "Primitive":
    case "Range":
    case "JsValue":
    case "Error":
      return;
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

function variableName(index: number): string {
  const letter = String.fromCharCode("a".charCodeAt(0) + (index % 26));
  const cycle = Math.floor(index / 26);
  return cycle === 0 ? letter : `${letter}${cycle}`;
}
