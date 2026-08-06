/**
 * The implicit prelude injected into every compiled project.
 *
 * Each member's `source` is an exact copy of the canonical, human-facing file in
 * `stdlib/`. The copies are embedded so that `compileProject` stays
 * filesystem-free; when a project supplies its own file at the injection path
 * (e.g. compiling the stdlib itself) that copy wins and the embedded fallback is
 * unused.
 *
 * The text lives in the generated `prelude-sources.ts` — `npm run
 * generate:prelude` — rather than being transcribed here, and a conformance test
 * asserts the embedded copies never drift from the originals.
 */

import { PRELUDE_SOURCES } from "./prelude-sources.js";

export interface PreludeModule {
  /** Basename placed at the common root of a project's sources. */
  readonly basename: string;
  /** Embedded fallback source, used only when the project supplies no file at the path. */
  readonly source: string;
}

/**
 * The prelude module set (Modules §5.5). **This order is normative, not
 * incidental.** Every module here is implicitly in scope in every non-prelude
 * module, and in the prelude modules *after* it — each member sees the members
 * before it, and only those, which is what makes cycles impossible by
 * construction. Adding a member means placing it after everything it uses —
 * `Seq.hex` sits after `Option.hex` because a pull step returns an `Option`.
 *
 * `Show.hex` is first because it declares and uses nothing but the `Show`
 * constraint itself (its one signature names only the primitive `String`), while
 * nearly everything after it answers `Show`: `Bool.hex` derives it two lines in,
 * and `Prelude.hex`'s `Ordering` does the same. Its seat is what puts the
 * member `show` into bare scope everywhere (the constraint-members-are-values
 * direction note, #335).
 *
 * `Bool.hex` sits directly after it: everything else can use `Bool` and it uses
 * nothing but `Show`'s seat, and since #147 made `Bool` a union rather than a
 * primitive, every later member's conditions and predicates depend on it.
 *
 * `Vector.hex` is last because it needs the most: `first`/`last`/`get` answer with
 * `Option`, and `toSeq`/`fromSeq` name `Seq`.
 */
export const PRELUDE_MODULES: readonly PreludeModule[] = [
  "Show.hex",
  "Bool.hex",
  "Prelude.hex",
  "Option.hex",
  "Seq.hex",
  "Result.hex",
  "Vector.hex",
].map((basename) => ({ basename, source: PRELUDE_SOURCES[basename]! }));
