import ratSource from "../../stdlib/Rat.hex?raw";
import optionSource from "../../stdlib/Option.hex?raw";
import vectorSource from "../../stdlib/Vector.hex?raw";

/**
 * Library modules the Playground hosts so that both ordinary imports and the
 * compiler's implicit prelude resolve against real Hexagon source. Hosting a
 * module makes it *available*; it does not make it implicit.
 */
export interface HostedModule {
  readonly companion: string;
  readonly path: string;
  readonly source: string;
}

export const hostedModules: readonly HostedModule[] = [
  // A prelude nominal: hosted at /stdlib so the compiler's prelude uses this
  // canonical copy (by basename), but never auto-imported — `Option`/`Some`/
  // `None` are implicitly in scope everywhere. `Prelude`, `Result`, and `Seq`
  // are prelude members too and are deliberately *not* hosted: the compiler's
  // embedded copies serve them, and a conformance test asserts those never
  // drift from `stdlib/`.
  { companion: "Option", path: "/stdlib/Option.hex", source: optionSource },
  { companion: "Vector", path: "/stdlib/Vector.hex", source: vectorSource },
  { companion: "Rat", path: "/stdlib/Rat.hex", source: ratSource },
];

/**
 * "Playground equipment": hosted modules auto-imported (`import * as X`) into
 * every workspace as a convenience — the fun, show-off pieces you'd normally
 * import yourself. This is a Playground affordance, distinct from the language
 * prelude (`Ordering`/`Option`/`Result`, supplied implicitly by the compiler).
 *
 * `Vector` is equipment for now; it will move to the prelude once the compiler
 * supports implicit namespace modules (so `Vector.append`/`xs.append(..)` work
 * with no import, the way `[..]` literals already do). `Rat` stays equipment.
 */
export const playgroundEquipment: readonly string[] = ["Vector", "Rat"];
