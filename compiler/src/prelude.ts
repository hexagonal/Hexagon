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
 * ## The constraint declarations come first (#335)
 *
 * A constraint member is an export of its declaring module, so the ten
 * declarations the compiler holds are `.hex` files here, and their seats are
 * what put `show`, `equals`, `compare`, `add`, `div` and the rest into bare
 * scope everywhere. The rule placing them is the same seats-before-uses rule as
 * for any other member, read through a declaration's *signature types*: **a
 * constraint declaration sits as early as the types its member headers name
 * allow**, and no earlier.
 *
 * - `Show.hex` is first: its one signature names only the primitive `String`.
 * - `Num.hex`, `Signed.hex`, `Frac.hex`, `Pow.hex` and `Concat.hex` follow
 *   directly, because their headers name only primitives (`Nat`, `Int`) and the
 *   subject variable. Their own order among themselves is base-constraint order
 *   (`Signed` extends `Num`, `Frac` extends `Signed`, `Pow` extends `Num`).
 * - `Bool.hex` then seats the `Bool` union, since #147 made it a union rather
 *   than a primitive and every later condition and predicate depends on it.
 * - `Eq.hex` must follow `Bool.hex`, because `equals` answers `Bool`. That
 *   `Bool` itself *derives* `Eq` two lines earlier is not a cycle: a `derives`
 *   never consults the source declaration — the checker's derived path proceeds
 *   without one — so the derivation needs only the pre-registered `hex:Eq`
 *   identity, which is import-free.
 * - `Hash.hex` follows `Eq.hex`, its base constraint.
 * - `Prelude.hex` seats `Ordering`, so `Ord.hex` must follow it: `compare`
 *   answers `Ordering`. `Ord` is also why `Eq` had to be seated by here.
 * - `Integral.hex` follows both of its bases, `Num` and `Ord`.
 *
 * `Iterable` has no file: it is pre-registered by name only, owned by the
 * collections arc (#283), and reachable in v1 solely through a user's own
 * source declaration.
 *
 * ## Then the data modules
 *
 * `Option.hex` and the rest follow in the order their uses demand — `Seq.hex`
 * sits after `Option.hex` because a pull step returns an `Option`.
 *
 * `Vector.hex` is last because it needs the most: `first`/`last`/`get` answer with
 * `Option`, and `toSeq`/`fromSeq` name `Seq`.
 */
export const PRELUDE_MODULES: readonly PreludeModule[] = [
  "Show.hex",
  "Num.hex",
  "Signed.hex",
  "Frac.hex",
  "Pow.hex",
  "Concat.hex",
  "Bool.hex",
  "Eq.hex",
  "Hash.hex",
  "Prelude.hex",
  "Ord.hex",
  "Integral.hex",
  "Option.hex",
  "Seq.hex",
  "Result.hex",
  "Vector.hex",
].map((basename) => ({ basename, source: PRELUDE_SOURCES[basename]! }));
