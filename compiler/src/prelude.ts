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

import { STDLIB_SOURCES } from "./stdlib-sources.js";
import { RUNTIME_MODULES } from "./runtime-modules.js";

export interface PreludeModule {
  /** The module's **declared name** (Modules §1) — `Option`, `JsValue`. */
  readonly name: string;
  /** Embedded fallback source, used only when the project supplies its own file. */
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
 * what make `Show.show`, `Eq.equals`, `Ord.compare`, `Num.add`, `Integral.div`
 * and `Iterable.toSeq` spellable everywhere. (Their seats no longer put those
 * *names* into bare scope: since #742 the member channel seeds `show` alone,
 * and every other member is reached by the dot where it is subject-first and
 * qualified always — Modules §5.5.) The rule placing them is the same
 * seats-before-uses rule as for any other member, read through a declaration's
 * *signature types*:
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
 * - `Ordering.hex` seats the `Ordering` union, so `Ord.hex` must follow it:
 *   `compare` answers `Ordering`. `Ord` is also why `Eq` had to be seated by
 *   here, and `Show`/`Eq` are why `Ordering.hex` cannot sit earlier than it
 *   does — it `derives` both. The union has a **module of its own** (#742) for
 *   the reason `JsKind.hex` does: its constructors are qualified-only under
 *   Modules §5.5's bare set, and a qualified constructor is spelled through the
 *   module that declares it (Modules §3.3), so the home must be addressable
 *   under the union's own name. `Ordering.Less` resolves; `Prelude.Less`, the
 *   only spelling the old seat offered, does not exist.
 * - `Prelude.hex` follows it, and holds `ignore` alone — the one prelude
 *   function in the bare set (Modules §5.5).
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
 * `Array.hex` opens the FFI block (#511). It is FFI Part 2's companion, not
 * Part 11's, and it needs exactly one thing: `get` answers with an `Option`, so
 * it sits after `Option.hex`. Everything else about the seat is deliberate
 * rather than forced. It is **late** because its two exports are `length` and
 * `get`, and a prelude module sees the members before it: seated early, every
 * later companion declaring either word would be weighing its own spelling
 * against this file's, for no gain. From here it is visible to no prelude
 * module that spells either word. (Since #742 that arithmetic decides only how
 * many routes a refusal enumerates — nothing is seeded bare either way — so the
 * seat is now a courtesy to the reader rather than a load-bearing fact.)
 * Nothing forces it
 * before `JsValue.hex` either: `Array(a)` is a compiler-owned type with no
 * declaration site, so `JsValue.toArray`'s `Result(Array(JsValue), …)` spells
 * the type through the fallback (Modules §5.5) and not through this module.
 * It sits here because a reader meeting the boundary companions meets them
 * together.
 *
 * `JsMap.hex` and `JsSet.hex` follow it immediately (#792), and they are FFI
 * Part 10's companions of the other two borrowed views. Their seats are forced
 * by the same reading as `Array.hex`'s, one signature at a time: `JsMap.get`
 * answers with an `Option`, both `fromSeq` rows name `Seq`, and `JsMap.entries`
 * is `Iterable`'s member reached qualified, so all three of `Option.hex`,
 * `Seq.hex` and `Iterable.hex` must already be seated — which the tail beside
 * `Array.hex` satisfies with room to spare. Nothing forces them relative to the
 * Part 11 block below, and nothing in that block names either type: like
 * `Array(a)`, both are compiler-owned with no declaration site, so only these
 * files and a user's own annotation can spell them. They sit beside `Array.hex`
 * for its reason — a reader meeting the boundary companions meets them
 * together — and the vocabulary the pair spends is the same courtesy it is
 * there: `size`, `get`, `containsKey`, `entries`, `contains` and `fromSeq` are
 * every one of them already multi-homed and already refused bare (Modules
 * §5.5), so the seat decides only how many routes a refusal enumerates.
 *
 * `JsKind.hex`, `JsPathSegment.hex`, `JsConversionReason.hex` and `JsValue.hex`
 * are FFI Part 11's four, and they are the seats-before-uses rule four times
 * over. The first three each declare one union and nothing else, and each is a
 * module of its own for the same reason: `spec/ffi.md` §12 (as extended for
 * #511) makes every constructor of all three **qualified-only** — `JsKind.Null`,
 * `JsPathSegment.Index(3)`, `JsConversionReason.Shape` — and a qualified
 * constructor is spelled through the module that declares it (Modules §3.3), so
 * the union's home must be addressable under the union's own name.
 *
 * Among the three, only one edge is forced: `JsConversionReason.hex` names
 * `Vector(JsPathSegment)` in `Cycle`'s payload, so it sits after both
 * `Vector.hex` and `JsPathSegment.hex`. `JsKind.hex` is all-nullary and names
 * nothing at all, so its seat is convention — beside its siblings, before the
 * module that uses it.
 *
 * `JsValue.hex` then sits after everything its headers name: all three unions
 * above, `Result.hex`, because every decoder answers with one, and `Vector.hex`,
 * because the `JsConversionError` inside that `Err` carries a `Vector` of path
 * segments. Nothing before them names a `JsValue` — the type has no Hexagon
 * declaration site, so only these files and a user's own annotation can spell
 * it.
 *
 * `JsError.hex` closes the FFI block (#509), and its seat is forced twice over.
 * It sits after `JsValue.hex` because the exception's payload slot names
 * `JsValue` and both accessors take one, and after `Result.hex` and
 * `Option.hex` because `JsValue.toString` — which is what turns a guarded read
 * into a verdict — answers with a `Result` and `stack` answers with an
 * `Option`. It is a module of its own for the reason `JsKind.hex` is: FFI
 * Part 11 §7 spells the accessors `JsError.message` and `JsError.stack`, and a
 * qualified spelling needs a module addressable under the name (Modules §3.3).
 * The seat is also what makes the two names it exports — `message` and
 * `stack` — visible to no prelude module at all. Since #742 neither is a *bare*
 * name anywhere: both are reached as `JsError.message(e)` or by the dot, like
 * every other prelude function (Modules §5.5).
 *
 * `Debug.hex` is last (#407), and its seat is the opposite kind of fact: almost
 * no signature here forces it. Both members name `Show` and nothing else — `log`
 * since #419 widened it to `log<a: Show>(value: a)`, `trace` from the start — so
 * anywhere after `Show.hex`, which is the first seat, would do. It sits last for
 * what the seat *denies* rather than for anything it needs. A member sees only the members
 * before it, so from the last seat `log` and `trace` are visible to no prelude
 * module at all: nothing in the standard library can quietly acquire a probe,
 * and every print in it would have to be a deliberate import. #742 settled the
 * other half of the same worry for good: the two are reached as `Debug.log` and
 * `Debug.trace` in user code too — James's ruling 1b, against a bare `log` he
 * had been bitten by — so the vocabulary this file spends is now nothing at
 * all, whatever its seat.
 */
export const PRELUDE_MODULES: readonly PreludeModule[] = [
  "Show",
  "Num",
  "Signed",
  "Frac",
  "Pow",
  "Concat",
  "Bool",
  "Eq",
  "Hash",
  "Ordering",
  "Prelude",
  "Ord",
  "Integral",
  "Option",
  "Int",
  "Nat",
  "Float",
  "BigInt",
  "Seq",
  "String",
  "Iterable",
  "Result",
  "Vector",
  "Map",
  "Set",
  "Stream",
  "Array",
  "JsMap",
  "JsSet",
  "JsKind",
  "JsPathSegment",
  "JsConversionReason",
  "JsValue",
  "JsError",
  "Debug",
].map((name) => ({ name, source: STDLIB_SOURCES[name]! }));

/**
 * The rest of the package `Hex`: every embedded standard-library module that is
 * neither a prelude member nor a runtime module (Packages §2.4).
 *
 * The standard library is `Hex` **in full**. A module here puts nothing in bare
 * scope — #742's bare set is closed, and this list may not grow it — and is
 * reached the way any other package's module is: `import Rat` where the project
 * declares no `Rat` of its own, `import Hex.Rat` always, and occluded silently
 * by a project's own `module Rat` (Packages §3.2, Modules §2.3). Its emitted
 * file, `Hex/Rat.js`, is written only where the program reaches it (§6).
 *
 * Derived by subtraction rather than listed, so a new `stdlib/` file is a `Hex`
 * module the moment it lands: the two lists that *are* enumerated are the ones
 * whose membership means something the compiler acts on — bare scope and its
 * normative order (`PRELUDE_MODULES`), and the two compilation privileges
 * (`RUNTIME_MODULES`) — and everything else is an ordinary module.
 *
 * The seats come after every prelude member, which is the only constraint on
 * them: a `Hex` module sees the whole prelude and no other module of this list,
 * because nothing here is in anybody's scope without an import, and an import
 * is an edge the module graph already orders.
 */
export const LIBRARY_MODULES: readonly PreludeModule[] = Object.keys(STDLIB_SOURCES)
  .filter((name) =>
    !PRELUDE_MODULES.some((member) => member.name === name) &&
    !RUNTIME_MODULES.some((member) => member.name === name)
  )
  .map((name) => ({ name, source: STDLIB_SOURCES[name]! }));

/**
 * The **fixed prelude companion** of each primitive (Method Syntax §4.1's table;
 * Constraints §5.3 — #344), by the declared name of the module injected for it.
 *
 * A primitive type's home module is its companion, which is what lets the orphan
 * rule read for primitives exactly as it always has for nominal types, and what
 * lets Modules §5.3's "a type it declares" read as "the primitive it companions".
 * A primitive has no declaration, so this fact cannot come from a module's text:
 * it comes from which prelude member the module was injected as, the same shape
 * the intrinsic door's privilege takes (`spec/intrinsics.md` §5.2).
 *
 * Every companion the language has is here (#344): `Float` and `String` closed
 * the migration, so no primitive's instances are compiler-wired and Modules
 * §5.3's transitional spellings have nothing left to serve.
 */
export const PRIMITIVE_COMPANION_MODULES: ReadonlyMap<string, string> = new Map([
  ["BigInt", "BigInt"],
  ["Int", "Int"],
  ["Nat", "Nat"],
  ["Float", "Float"],
  ["String", "String"],
]);
