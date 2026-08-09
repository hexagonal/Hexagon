/**
 * Reading the effect dimension off a finished type (`spec/effects.md`, #355).
 *
 * The slot itself is `FunctionType.effect` and nothing here interprets it; what
 * these walks answer is where the colours *are*, for the three consumers that
 * have to know: the display renderer numbering them (§10, #364), the `.d.ts`
 * emitter deciding whether a face has anything an arrow could say, and the same
 * emitter keeping an effect variable out of a TypeScript quantifier it can
 * never name.
 */

import type * as Typed from "./tree.js";

/**
 * Every effect variable a type reaches, in the order the rendered text first
 * reaches it.
 *
 * Textual order, not tree order, because #364's numbering is by first
 * appearance in the displayed signature: a function prints its domain, then its
 * own arrow, then its result, so the effect slot is visited between the
 * parameters and the result. A `Set` keeps that order.
 */
export function collectEffectVariables(
  type: Typed.Type,
  found = new Set<Typed.TypeVariableId>(),
): Set<Typed.TypeVariableId> {
  switch (type.kind) {
    case "Function":
      for (const parameter of type.parameters) collectEffectVariables(parameter, found);
      if (typeof type.effect === "object") found.add(type.effect.variable);
      collectEffectVariables(type.result, found);
      return found;
    case "Vector":
    case "Set":
    case "Array":
    case "Node":
      return collectEffectVariables(type.element, found);
    case "Nullable":
      return collectEffectVariables(type.value, found);
    case "Map":
      collectEffectVariables(type.key, found);
      return collectEffectVariables(type.value, found);
    case "Tuple":
      for (const element of type.elements) collectEffectVariables(element, found);
      return found;
    case "Record":
      for (const field of type.fields) collectEffectVariables(field.type, found);
      return found;
    case "Union":
    case "NominalRecord":
      for (const argument of type.arguments) collectEffectVariables(argument, found);
      return found;
    default:
      return found;
  }
}

/**
 * Every effect variable with at least one **inlet** occurrence in this type —
 * an occurrence on an arrow standing in a parameter position (§2.2).
 *
 * The inlet is what makes a written `=>` link rather than take the
 * else-constant reading: it is "a slot through which a caller's instantiation
 * can flow". A variable whose every occurrence is in result or outer position
 * has no such slot, so writing its face back would read as the impure constant
 * and say something the displayed type does not — which is why #364 numbers it
 * even when it is the face's only colour.
 *
 * Parameter position is read structurally, at every depth: each function type's
 * own parameters contribute, so a callback arrow nested inside a returned
 * function is an inlet exactly as a top-level one is.
 */
export function collectInletVariables(
  type: Typed.Type,
  found = new Set<Typed.TypeVariableId>(),
): Set<Typed.TypeVariableId> {
  switch (type.kind) {
    case "Function":
      for (const parameter of type.parameters) collectEffectVariables(parameter, found);
      return collectInletVariables(type.result, found);
    case "Vector":
    case "Set":
    case "Array":
    case "Node":
      return collectInletVariables(type.element, found);
    case "Nullable":
      return collectInletVariables(type.value, found);
    case "Map":
      collectInletVariables(type.key, found);
      return collectInletVariables(type.value, found);
    case "Tuple":
      for (const element of type.elements) collectInletVariables(element, found);
      return found;
    case "Record":
      for (const field of type.fields) collectInletVariables(field.type, found);
      return found;
    case "Union":
    case "NominalRecord":
      for (const argument of type.arguments) collectInletVariables(argument, found);
      return found;
    default:
      return found;
  }
}

/**
 * Whether any arrow in this type carries a colour other than the pure constant.
 *
 * An absent slot is the pure constant, which is what every arrow means with the
 * flag off — so this is `false` for every type the flag-off compiler builds, and
 * that is what keeps the generated `.d.ts` documentation from appearing on a
 * corpus where it would say nothing. Purity is the silent one (§1).
 */
export function carriesEffect(type: Typed.Type): boolean {
  switch (type.kind) {
    case "Function":
      return type.effect !== undefined ||
        type.parameters.some(carriesEffect) ||
        carriesEffect(type.result);
    case "Vector":
    case "Set":
    case "Array":
    case "Node":
      return carriesEffect(type.element);
    case "Nullable":
      return carriesEffect(type.value);
    case "Map":
      return carriesEffect(type.key) || carriesEffect(type.value);
    case "Tuple":
      return type.elements.some(carriesEffect);
    case "Record":
      return type.fields.some((field) => carriesEffect(field.type));
    case "Union":
    case "NominalRecord":
      return type.arguments.some(carriesEffect);
    default:
      return false;
  }
}

/**
 * Every variable a type mentions as a *type* — as against the effect slots
 * above. A record's row variable counts: `{x: Int, ...a}` mentions `a`.
 */
export function collectTypeVariables(
  type: Typed.Type,
  found = new Set<Typed.TypeVariableId>(),
): Set<Typed.TypeVariableId> {
  switch (type.kind) {
    case "Variable":
      found.add(type.id);
      return found;
    case "Function":
      for (const parameter of type.parameters) collectTypeVariables(parameter, found);
      return collectTypeVariables(type.result, found);
    case "Vector":
    case "Set":
    case "Array":
    case "Node":
      return collectTypeVariables(type.element, found);
    case "Nullable":
      return collectTypeVariables(type.value, found);
    case "Map":
      collectTypeVariables(type.key, found);
      return collectTypeVariables(type.value, found);
    case "Tuple":
      for (const element of type.elements) collectTypeVariables(element, found);
      return found;
    case "Record":
      for (const field of type.fields) collectTypeVariables(field.type, found);
      if (type.tail !== undefined) found.add(type.tail);
      return found;
    case "Union":
    case "NominalRecord":
      for (const argument of type.arguments) collectTypeVariables(argument, found);
      return found;
    default:
      return found;
  }
}

/**
 * A scheme's quantified variables minus the ones that are colours and nothing
 * else (#364).
 *
 * Effect variables generalize with the binding like any other type variable
 * (§3.4), so they arrive in `Scheme.variables` beside the ordinary ones. A
 * TypeScript face has no notation for a colour and erases it (§8), so a
 * quantifier built from the raw list declares type parameters no rendered type
 * ever mentions: `compose`, which is polymorphic in nothing, was published as
 * `<a, b>`. A variable standing in a type position as well is kept — nothing
 * builds one today, and a dropped one would be a `.d.ts` that does not compile.
 */
export function quantifiedTypeVariables(
  scheme: Typed.Scheme,
): readonly Typed.TypeVariableId[] {
  const colours = collectEffectVariables(scheme.type);
  if (colours.size === 0) return scheme.variables;
  const mentioned = collectTypeVariables(scheme.type);
  for (const constraint of scheme.constraints) collectTypeVariables(constraint.type, mentioned);
  return scheme.variables.filter(
    (variable) => !colours.has(variable) || mentioned.has(variable),
  );
}
