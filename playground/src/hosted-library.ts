import ratSource from "../../stdlib/Rat.hex?raw";
import optionSource from "../../stdlib/Option.hex?raw";
import vectorSource from "../../stdlib/Vector.hex?raw";

/**
 * Library modules the Playground hands the compiler beside the user's buffer,
 * from the repository's own canonical `stdlib/` sources.
 *
 * Hosting a module makes it **available**, and since #831 that is all it does:
 * a buffer reaches `Rat` by writing `import Rat`, the line any Hexagon file
 * writes (Modules §3.1). The equipment mechanism this replaced injected that
 * line into the user's file whenever the buffer *spelled* `Rat` — an affordance
 * from before #829, when a module could only be imported by a path the
 * Playground's one document had nowhere to write.
 *
 * `Option.hex` and `Vector.hex` sit at their prelude basenames, so the compiler
 * adopts them as the prelude modules they are and the Playground's copies are
 * the ones the program resolves against. `Rat` is outside the prelude, so it
 * enters as an ordinary module of the compiled project — **not** as `Hex.Rat`,
 * which the compiler has no way for a host to say yet (`ProjectOptions` grants
 * no file to another package). Two consequences, both stated where they are
 * felt: `import Hex.Rat` names no module here, and a buffer declaring its own
 * `module Rat` is the duplicate-name refusal (Modules §2.2) against a file it
 * cannot see, where a true `Hex.Rat` would be occluded silently (Packages
 * §3.2).
 */
export interface HostedModule {
  /** Where the compiler is handed the file; no part of the language (Modules §1). */
  readonly path: string;
  readonly source: string;
}

export const hostedLibrary: readonly HostedModule[] = [
  { path: "/stdlib/Option.hex", source: optionSource },
  { path: "/stdlib/Vector.hex", source: vectorSource },
  { path: "/stdlib/Rat.hex", source: ratSource },
];
