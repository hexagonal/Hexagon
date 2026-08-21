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
  // The two prelude nominals: hosted at /stdlib so the compiler's prelude uses
  // these canonical copies (by basename), and never auto-imported — `Option`/
  // `Some`/`None` are implicitly in scope everywhere, and `Vector`'s basename
  // is a qualified home. `Prelude`, `Result`, and `Seq` are prelude members too
  // and are deliberately *not* hosted: the compiler's embedded copies serve
  // them, and a conformance test asserts those never drift from `stdlib/`.
  { companion: "Option", path: "/stdlib/Option.hex", source: optionSource },
  { companion: "Vector", path: "/stdlib/Vector.hex", source: vectorSource },
  { companion: "Rat", path: "/stdlib/Rat.hex", source: ratSource },
];

/**
 * "Playground equipment": hosted modules auto-imported into a workspace that
 * mentions them — the fun, show-off pieces you'd normally import yourself. This
 * is a Playground affordance, distinct from the language prelude
 * (`Ordering`/`Option`/`Result`, supplied implicitly by the compiler), and it
 * covers only what the prelude does not reach.
 *
 * One line goes in, the companion idiom's own: `import * as X`. The alias is
 * the module (`Rat.create`), and since Modules §5.1 rule 2's companion fallback
 * (#531) it also answers the bare type name a written face needs
 * (`let exact(f: Int): Rat = …`) — the named half the injection used to carry
 * beside it is redundant, and with it the gate that dropped it where a buffer
 * declared that type itself. The alias binds nothing, so a buffer's own
 * `record Rat` wins with no collision to arrange around.
 *
 * `Vector` is not equipment: it is a prelude module, and Modules §6.4 registers
 * every prelude module's basename as a qualified home, so `Vector.append` and
 * `xs.append(..)` resolve with no import at all — the import was a no-op. `Rat`
 * is deliberately outside the prelude, so nothing but this list reaches it.
 */
export const playgroundEquipment: readonly string[] = ["Rat"];
