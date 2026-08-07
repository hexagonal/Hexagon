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
 * `BigInt.hex` (#344) is the first **primitive companion** — a primitive's home
 * module, where its instances are ordinary `honor` blocks rather than compiler
 * rows (Constraints §5.3). It sits after every constraint declaration because it
 * honors eight of them, and after `Option.hex` because `toInt` answers with one;
 * nothing before it names a `BigInt`.
 *
 * `Int.hex` and `Nat.hex` are the second and third, and their seats follow the
 * same reading. `Int.hex` sits after every constraint declaration it honors and
 * after `Option.hex`, because the checked family (`checkedAdd` and its two
 * siblings) answers with an `Option(Int)`. `Nat.hex` sits after `Int.hex`:
 * `Nat.fromInt`'s sign check is `value < 0` at `Int`, so it consumes
 * `Ord<Int>` and `Num<Int>` evidence, which only `Int.hex` supplies now that
 * the wired rows are gone. Everything from `Seq.hex` onward sees both, which is
 * what lets `runtime/VectorTrie.hex`'s index arithmetic reach `Integral<Int>`.
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
  "BigInt.hex",
  "Int.hex",
  "Nat.hex",
  "Seq.hex",
  "Result.hex",
  "Vector.hex",
].map((basename) => ({ basename, source: PRELUDE_SOURCES[basename]! }));

/**
 * The **fixed prelude companion** of each primitive (Method Syntax §4.1's table;
 * Constraints §5.3 — #344), by the basename its module is injected at.
 *
 * A primitive type's home module is its companion, which is what lets the orphan
 * rule read for primitives exactly as it always has for nominal types, and what
 * lets Modules §5.3's "a type it declares" read as "the primitive it companions".
 * A primitive has no declaration, so this fact cannot come from a module's text:
 * it comes from the injection path, the same shape the intrinsic door's privilege
 * takes (`spec/intrinsics.md` §5.2).
 *
 * Only the companions that exist as source are here. `Float` and `String` join
 * at their own milestones, in that migration order; until then their instances
 * are compiler-wired and their qualified spellings are the resolver's
 * transitional ones (Modules §5.3's note).
 */
export const PRIMITIVE_COMPANION_BASENAMES: ReadonlyMap<string, string> = new Map([
  ["BigInt.hex", "BigInt"],
  ["Int.hex", "Int"],
  ["Nat.hex", "Nat"],
]);
