/**
 * The names each declaration gives its parameters, for hover and signature help
 * (Functions §5.1).
 *
 * A function type carries no names, so they are read off the declaration: a
 * `fun`, a `let` or `var` bound to a lambda, an `extern fun`, a constraint
 * member, a constructor or an exception. A pattern parameter's binder is the
 * compiler's own, and an unnamed slot's field is only its place, so neither is
 * named. A symbol no such declaration binds — `let g = f`, a parameter that
 * holds a function — has no entry, and is shown by its type alone.
 *
 * Project-wide, like `collectSymbolFacts`, because symbol identities are unique
 * across a project and a function is named the same in every module that uses
 * it. Unlike those facts it is wanted only when a reader asks, so the session
 * builds it on the first hover or signature help after a change, not on every
 * recheck.
 */

import { isCompilerMinted } from "../support/synthetic.js";
import * as Typed from "../syntax/typed/index.js";
import { forEachTypedItem } from "./typed-walk.js";

/** One entry per parameter, in order; `undefined` for one the declaration does not name. */
export type ParameterNames = readonly (string | undefined)[];

export function collectParameterNames(trees: readonly Typed.Module[]): ReadonlyMap<number, ParameterNames> {
  const names = new Map<number, ParameterNames>();
  for (const tree of trees) {
    forEachTypedItem(tree, (item) => {
      for (const [symbol, declared] of declaredParameterNames(item)) names.set(Number(symbol), declared);
    });
  }
  return names;
}

/** The parameter names of each symbol one item binds with a parameter list. */
function declaredParameterNames(item: Typed.Item): readonly (readonly [Typed.Symbol["id"], ParameterNames])[] {
  const named = (bindings: readonly Typed.Binding[]): ParameterNames =>
    bindings.map(({ name }) => (isCompilerMinted(name) ? undefined : name));
  switch (item.kind) {
    case "Fun":
      return [[item.binding.symbol, named(item.value.parameters)]];
    case "Let":
    case "Var":
      return item.value.kind === "Lambda" ? [[item.binding.symbol, named(item.value.parameters)]] : [];
    case "ExternBlock":
      return item.declarations.flatMap((declaration) =>
        declaration.kind === "ExternFun" ? [[declaration.binding.symbol, named(declaration.parameters)] as const] : []
      );
    case "ConstraintDeclaration":
      return item.members.map((member) => [member.binding.symbol, named(member.parameters)] as const);
    case "Union":
      return item.constructors.map((constructor) => [constructor.symbol, slotNames(constructor.slots)] as const);
    case "Exception":
      return [[item.binding.symbol, slotNames(item.slots)]];
    default:
      return [];
  }
}

/**
 * A constructor's slot names, none for an unnamed slot. An unnamed slot is kept
 * under its place's field, `item1` to `itemN` (Unions §6), which no program
 * reads by that name (§5). So a field that is exactly its place says nothing a
 * name would, and a slot named that way by hand loses nothing.
 */
function slotNames(slots: readonly Typed.ConstructorSlot[]): ParameterNames {
  return slots.map(({ field }, index) => (field === `item${index + 1}` ? undefined : field));
}
