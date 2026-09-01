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
 * ## The constraint declarations come as early as their signatures allow (#335)
 *
 * A constraint member is an export of its declaring module, so all **eleven**
 * declarations the compiler holds are `.hex` files here, and their seats are
 * what put `show`, `equals`, `compare`, `add`, `div`, `toSeq` and the rest into
 * bare scope everywhere. The rule placing them is the same seats-before-uses
 * rule as for any other member, read through a declaration's *signature types*:
 * **a constraint declaration sits as early as the types its member headers name
 * allow**, and no earlier.
 *
 * Ten of them cluster at the front, because their headers name primitives and
 * the subject variable and little else. That is the rule's *consequence*, not a
 * rule of its own — `Iterable.hex` obeys the same sentence and lands far down
 * the list, after `Seq.hex`, because `toSeq(xs: c): Seq(Item)` names `Seq`.
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
 * `Iterable.hex` is the eleventh, and the one declaration that cannot sit with
 * the others: `toSeq(xs: c): Seq(Item)` names `Seq`, so the same
 * signature-types rule that puts `Show.hex` first puts this one after
 * `Seq.hex` — the latest seat any constraint declaration takes, and the reason
 * Collections Part 5 §4's provided rows have no source form. `Seq.hex` cannot
 * honor a constraint whose name is not yet in scope, and seating `Iterable.hex`
 * earlier is a genuine cycle rather than a reordering.
 *
 * ## Then the data modules
 *
 * `Option.hex` and the rest follow in the order their uses demand — `Seq.hex`
 * sits after `Option.hex` because a pull step returns an `Option`.
 *
 * `Int.hex` (#344) is the first **primitive companion** — a primitive's home
 * module, where its instances are ordinary `honor` blocks rather than compiler
 * rows (Constraints §5.3). It sits after every constraint declaration it honors
 * and after `Option.hex`, because the checked family (`checkedAdd` and its two
 * siblings) answers with an `Option(Int)`.
 *
 * `Nat.hex` and `Float.hex` are the second and third, and their seats follow
 * the same reading. `Nat.hex` sits after `Int.hex`: `Nat.fromInt`'s sign check
 * is `value < 0` at `Int`, so it consumes `Ord<Int>` and `Num<Int>` evidence,
 * which only `Int.hex` supplies now that the wired rows are gone. `Float.hex`
 * sits after `Int.hex` too, because `Num<Float>`'s `fromNat` composes through
 * `Int.fromNat`, which is `Num<Int>`'s member at its own companion. Everything
 * from `Seq.hex` onward sees all three, which is what lets
 * `runtime/VectorTrie.hex`'s index arithmetic reach `Integral<Int>`.
 *
 * `BigInt.hex` is the fourth, and it needs the most of the five. It sits after
 * every constraint declaration because it honors eight of them, after
 * `Option.hex` because `toInt` answers with one, and after `Float.hex` because
 * `toFloat`'s guard throws `Float.hex`'s `FloatRangeError` (#533) — the same
 * sentence as everything else here, an exception being a use like any other.
 * Nothing before it names a `BigInt`.
 *
 * `String.hex` is the fifth and the last: with it every primitive companion is
 * source and no instance in the language is compiler-wired. It is also the one
 * companion whose seat is *forced*, and it moved to earn it (#353). Its
 * instances need nothing later than `Ord.hex`, and it sat among the numeric
 * companions on that reading — a convenience their contiguity paid for.
 * Collections Part 5 §5.3 then gave it `fromSeq : Seq(String) ->
 * String`, the conversion suite's construction half, and a signature naming
 * `Seq` cannot be written before `Seq.hex` seats. So `String.hex` follows
 * `Seq.hex` now. The swap costs nothing in the other direction: `Seq.hex`
 * names no string, interpolates none, and shows nothing, so it loses no
 * instance it was using. `String.toSeq` needs no seat at all — it is the
 * provided row's member (Part 5 §4), read through `Iterable.hex` below.
 *
 * `Vector.hex` needs a great deal: `first`/`last`/`get` answer with `Option`,
 * and `toSeq`/`fromSeq` name `Seq`.
 *
 * `Map.hex` needs the most of anything before it — `Hash` for its keyed trio,
 * `Option` for `get`, `Seq` for `entries` and the two projections over it, and
 * `Vector` itself for `fromVector`, which is Collections Part 4 §3.2's
 * definitional equivalence and the one edge that fixes the order rather than
 * merely permitting it. It held the last seat from the Map step (#370), having
 * displaced `Vector.hex` from it.
 *
 * `Set.hex` displaces `Map.hex` from the last seat in turn (#373). It needs
 * exactly what `Map.hex` needs — `Hash` for its keyed trio, `Option` for the
 * unexported `storedMember` row that `intersect` probes with, `Seq` for `toSeq`
 * and the whole algebra folded over it, and `Vector` for `fromVector` — and it
 * needs nothing from `Map.hex` at all: the two companions are siblings over one
 * runtime module, not layers.
 *
 * `Stream.hex` (#364). Its seat is genuinely constrained rather than
 * conventional: `fromSeq` names `Seq`, every pull answers an `Option`, and
 * `collect` builds a `Vector`, so it sits after all three. Nothing needs a
 * `Stream`, and nothing can — the type is `Seq`'s impure sibling and no pure
 * module has business with one.
 *
 * `JsKind.hex` and `JsValue.hex` are the FFI Part 11 pair, and the pair is the
 * seats-before-uses rule twice over. `JsKind.hex` declares one all-nullary
 * union, so its signature types name nothing and it could sit almost anywhere;
 * it sits immediately before `JsValue.hex` because that is the module that uses
 * it, and because a constructor of it is reachable only as `JsKind.Null`
 * (`spec/ffi.md` §12), which is a *qualified* spelling and so needs the module
 * addressable under the name. `JsValue.hex` then sits after everything its
 * headers name: `Result.hex`, because every decoder answers with one, and
 * `Vector.hex`, because the `JsConversionError` inside that `Err` carries a
 * `Vector` of path segments. Nothing before them names a `JsValue` — the type has
 * no Hexagon declaration site, so only these two files and a user's own
 * annotation can spell it.
 *
 * `Debug.hex` is last (#407), and its seat is the opposite kind of fact: almost
 * no signature here forces it. Both members name `Show` and nothing else — `log`
 * since #419 widened it to `log<a: Show>(value: a)`, `trace` from the start — so
 * anywhere after `Show.hex`, which is the first seat, would do. It sits last for
 * what the seat *denies* rather than for anything it needs. A member sees only the members
 * before it, so from the last seat `log` and `trace` are visible to no prelude
 * module at all: nothing in the standard library can quietly acquire a probe,
 * and every print in it would have to be a deliberate import. The collision
 * arithmetic (Modules §5.5) follows the same way round — no prelude module's
 * own bare names ever stand against these two, because none of them is in
 * scope where the other is — so the two names first have to be weighed in user
 * code, where the whole prelude arrives at once regardless of seat order.
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
  "Int.hex",
  "Nat.hex",
  "Float.hex",
  "BigInt.hex",
  "Seq.hex",
  "String.hex",
  "Iterable.hex",
  "Result.hex",
  "Vector.hex",
  "Map.hex",
  "Set.hex",
  "Stream.hex",
  "JsKind.hex",
  "JsValue.hex",
  "Debug.hex",
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
 * Every companion the language has is here (#344): `Float.hex` and `String.hex`
 * closed the migration, so no primitive's instances are compiler-wired and
 * Modules §5.3's transitional spellings have nothing left to serve.
 */
export const PRIMITIVE_COMPANION_BASENAMES: ReadonlyMap<string, string> = new Map([
  ["BigInt.hex", "BigInt"],
  ["Int.hex", "Int"],
  ["Nat.hex", "Nat"],
  ["Float.hex", "Float"],
  ["String.hex", "String"],
]);
