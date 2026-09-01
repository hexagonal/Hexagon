/**
 * The intrinsic inventory (`spec/intrinsics.md` §4).
 *
 * The intrinsic door is how privileged standard-library source names a
 * compiler-provided implementation of an operation it publicly owns. It is a
 * *declaration*, not a third meaning of `Name.` — an `extern from
 * "hex:intrinsic"` block reusing FFI Part 4's grammar, whose left-of-`as` name
 * is a key in this flat, compiler-global space (§4.1) rather than a foreign
 * export name.
 *
 * Keys deliberately mirror the emitter's runtime helper family (`seqMemoize` ↔
 * the memoizing spine) and survive module and operation renames: the local name
 * is the module's business, the key is the compiler's.
 *
 * At a foreign extern boundary the declaration is believed; here it is
 * **checked** (§4.2), because the compiler is the implementer. Key existence and
 * arity are verified at the declaration site. Types are *not* checked against a
 * table: the declaration's annotation is normative, and a lowering that diverges
 * from it is a compiler conformance defect, never a user diagnostic.
 */

/** The reserved specifier scheme (§5.1). Fails closed in unprivileged source. */
export const INTRINSIC_SCHEME = "hex:";

/** The scheme's only v1 member (§5.1). */
export const INTRINSIC_SPECIFIER = "hex:intrinsic";

export function isIntrinsicScheme(specifier: string): boolean {
  return specifier.startsWith(INTRINSIC_SCHEME);
}

/**
 * Every intrinsic the compiler provides, keyed by §4.1's `<companion><Operation>`
 * convention, with the arity §4.2 verifies each declaration against.
 *
 * `seqMemoize` — Loops §6.4's explicit opt-in: wraps any `Seq` in the runtime's
 * memoizing spine, the same mechanism as FFI Part 3's inbound adapter. Declared
 * by `stdlib/Seq.hex` per `spec/intrinsics.md` §3.2; lowered by the emitter's
 * helper of the same name.
 *
 * `streamFromSeq` — `stream.md` §4.3's one door: a pure sequence driven as a
 * stream. The cursor that holds the successor between pulls is cross-call state,
 * which §3 of that spec makes inexpressible in Hexagon — a lambda cannot touch
 * an outer `var` (Statements §6.2) — so the runtime owns it and the row is the
 * declaration. Its declared face is pure: building the cursor touches nothing,
 * and the impurity is the record field's arrow, which is the constant.
 *
 * The `vector*` family is exactly Collections Part 3 §7's boundary crossing —
 * representation-sensitive length and end updates, signed indexed access,
 * persistent indexed update, and the eager/lazy bridge. Everything else in that
 * table is Hexagon source in `stdlib/Vector.hex`, which declares these seven and
 * owns the public surface over them (§9.2's `Vector` milestone).
 *
 * The `bigInt*` family is the door's third customer and the primitive template's
 * worked example (§3.2, #344), in the **primop shape**: every own-operation
 * member of `stdlib/BigInt.hex`'s eight instances crosses here, because an
 * operator- or interpolation-form body would denote only the slot it defines
 * (Constraints §6.1). What sits *above* those operations is ordinary Hexagon in
 * that file and therefore absent here — the Euclidean pair over the truncated
 * one, `gcd`, `lcm`, `toInt`'s range check, and every zero-divisor and
 * negative-exponent guard. `bigIntPow` is the raw native `**`, unguarded, for
 * the same reason.
 *
 * The `int*` and `nat*` families are the second landing (§3.2, #344) and take
 * the same primop shape, with three deltas that are each an **absence**.
 *
 * - The **self-identities take no key**. `Signed<Int>`'s `fromInt` and
 *   `Num<Nat>`'s `fromNat` convert a type to itself, so each body is the plain
 *   binding `value` — nothing that selects its own slot — and the
 *   strictly-simpler doctrine sends such a body to ordinary Hexagon. There is
 *   no `intFromInt` and no `natFromNat`. `intFromNat` *does* cross: any Hexagon
 *   body for `Nat` -> `Int` typechecks only through Numeric Literals §5.1's
 *   contextual widening, which elaborates through `Num<Int>.fromNat`, the very
 *   slot being defined; its lowering is the identity over the one shared
 *   `number` representation.
 * - **`natPow` has no guard above it.** A `Nat` exponent cannot be negative, so
 *   the negative-exponent guard `Int` and `BigInt` carry in source is dead by
 *   typing at `Nat` and is not written (Operators §6.3).
 * - **The checked family never reaches the door.** `Int.checkedAdd`,
 *   `checkedSub`, and `checkedMul` (Primitive Types §2.1) are ordinary Hexagon
 *   over the ordinary members: every overflow test is an exact pre-check
 *   phrased inside the safe range, so there is no unchecked core and no host
 *   predicate to declare.
 *
 * `natFromIntUnchecked` is the one conversion core in the pair, sitting beneath
 * `Nat.fromInt`'s sign check exactly as `bigIntToIntUnchecked` sits beneath
 * `BigInt.toInt`'s range check.
 *
 * The `float*` and `string*` families are the third landing and the last (§3.2,
 * #344), in the same primop shape, with three things worth naming.
 *
 * - **`floatRem` is a plain export's core, not a member's.** `Float` is never
 *   `Integral` (Integral §1), so `Float.rem` is an ordinary exported function
 *   whose lowering is the bare `a % b` of Division & Remainder §6, and
 *   `Float.mod` is the Euclidean adjustment written over it in Hexagon. There
 *   is no `floatMod` key, and no guard anywhere in either companion: float
 *   partiality is `NaN`, and `String` has no partial operation.
 * - **One `Float` conversion crosses and one does not.** `floatFromInt` is
 *   keyed, for `intFromNat`'s exact argument: any Hexagon body for `Int` ->
 *   `Float` typechecks only through Numeric Literals §5.1's contextual
 *   widening, which elaborates through the very slot being defined.
 *   `Num<Float>`'s `fromNat` composes out of two slots that already exist —
 *   `fromInt(Int.fromNat(value))` — so it is ordinary Hexagon and takes no key.
 * - **`Show<String>` has the keyless body.** `show` at `String` is the identity
 *   by ruling (Primitive Types §7), the plain binding `value`, so it goes the
 *   way `Signed<Int>`'s `fromInt` went. `stringCompare` is at the other
 *   extreme: its codepoint walk has no strictly simpler Hexagon to be written
 *   in, because the language has no codepoint API.
 * - **`stringFromSeq` is the family's one non-member row** (#353), and the only
 *   one whose lowering the spec dictates rather than merely permits.
 *   Collections Part 5 §5.3 defines `String.fromSeq` as concatenation and then
 *   binds the implementation: *collect chunks and join*, with the fold-of-`++`
 *   description marked semantic only and quadratic repeated concatenation ruled
 *   out by name. A Hexagon body would be that fold, so the operation crosses
 *   here to reach the host's `join` — not because the language cannot say what
 *   it means, but because the language cannot say it at the required
 *   complexity. Its twin `String.toSeq` takes no key at all: it is the provided
 *   `Iterable<String>` row's member (§4, §5.2), rendered at its use sites out
 *   of the same `Seq`-over-an-iterable adapter every other row uses, and JS
 *   string iteration is codepoint-wise, which is §5.1's semantics exactly.
 *
 * The `hashTrie*` family is the door's first **runtime-module** customer (§5.2's
 * runtime bullet, #365): `runtime/HashTrie.hex` declares all ten, unexported,
 * and the trie is otherwise ordinary Hexagon. Three groups, each a single
 * JavaScript expression, and each there because Hexagon has no spelling for it
 * rather than because the trie wanted a shortcut.
 *
 * - **The placement mix.** `hashTrieMix` is the one row with state behind it: a
 *   per-process seed read at most once, which is `spec/effects.md` §6.2 species
 *   (b) and Collections Part 2 §2.4's seeded placement. The public member is
 *   deterministic and unseeded by §2.4's other half, so a trie navigating by it
 *   directly would expose the bucket function to manufactured collisions and
 *   freeze traversal order across executions — the two things §2.4's split
 *   forbids.
 * - **Bit algebra** — `hashTrieDigit`, `hashTrieBitTest`, `hashTrieBitSet`,
 *   `hashTrieBitClear`, `hashTrieBitCount`, `hashTrieBitCountBelow`. Hexagon has
 *   no bitwise operators (`runtime/VectorTrie.hex` needed none, and divides
 *   instead; a bitmap-compressed trie needs six bits' worth), and a popcount
 *   written over `div`/`rem` would be a loop where the host has a SWAR word.
 * - **Packed storage** — `hashTrieNodeSingleton`, `hashTrieNodeInsertAt`,
 *   `hashTrieNodeRemoveAt`. The `Node` fallback family (§3.3) builds and reads
 *   *fixed-32* arrays; a bitmap-compressed branch stores exactly its popcount,
 *   so it needs the three length-changing operations that family has no member
 *   for. `Node.get`/`Node.set` are length-agnostic and serve both shapes, which
 *   is why no keyed twin of either appears here.
 *
 * The `map*` family is `stdlib/Map.hex`'s (§3.2, #370), and it is the first
 * whose lowerings are *another Hexagon module's* compiled operations rather than
 * emitter-written JavaScript: each of the seven aliases the corresponding export
 * of `runtime/HashTrie.hex`'s emitted module. Three things about the shape are
 * worth stating where the keys are.
 *
 * - **The keyed trio is constrained.** `mapGet`, `mapSet` and `mapRemove`
 *   declare `<k: Hash>` (§3.4's amendment, the grant's concrete demand), so
 *   their call sites append the evidence suffix — which is exactly what the
 *   lowering expects, because the lowering *is* a compiled `<k: Hash>` function
 *   and the same compiler emitted both faces.
 * - **`mapSingleton` is unconstrained, permanently** (Collections Part 4
 *   §12.4). The trie honors that with an unplaced root arm rather than by
 *   hashing early, so there is nothing here for the key to defer to.
 * - **`mapEmpty` takes no parameters and is unexported.** The block admits `fun`
 *   only and `empty` is a value, so `Map.hex` writes `export let empty: Map(k,
 *   v) = emptyMap()` above it; the wrapper is expansive and generalizes on the
 *   relaxed rule over `Map`'s now-verified covariant claim rows. `isEmpty`,
 *   `containsKey`, `keys`, `values`, the `toSeq`/`fromSeq` pair, `fromEntries`
 *   and `fromVector` take no keys at all — every one of them is ordinary
 *   Hexagon over these seven.
 *
 * The `set*` family is `stdlib/Set.hex`'s (§3.2, #373), and it is the `map*`
 * paragraph at one type parameter: seven keys, the keyed trio
 * (`setContains`/`setAdd`/`setRemove`) constrained `<a: Hash>`, `setSingleton`
 * unconstrained and permanently so, and `setEmpty` the unexported thunk beneath
 * `export let empty: Set(a)`. The one delta is what the lowerings target. A
 * `Set(a)` is **not** the bare `HashTrie(a, Unit)` it sounds like: a trie value's
 * emitted iterator yields `[key, value]` pairs, which is `Hex.Map`'s face, while
 * `Hex.Set<a> extends Iterable<a>` promises elements, and one record carries one
 * iterator. So `runtime/HashTrie.hex` holds a one-field wrapper record
 * (`HashSet`) with thin set-facing operations over it, and these seven alias
 * *those* (#373). The wrapper is also what keeps the aliases 1:1 — it absorbs the
 * `Unit` argument that a bare-trie wiring would have needed adapters for.
 * `isEmpty`, the whole algebra (`union`, `intersect`, `difference`,
 * `isSubsetOf`), `fromSeq` and `fromVector` take no keys: every one of them is
 * ordinary Hexagon over these seven.
 *
 * There is an **eighth** key, `setLookup`, and it is not §6.2 surface: `Set.hex`
 * declares it unexported, the way `Map.hex` and `Set.hex` declare their `empty`
 * thunks. It answers the stored *representative* — `Option(a)`, not `Bool` — and
 * exists because Part 4 pins two things that pull opposite ways: §2.2 requires
 * `intersect` to traverse the smaller side, and §5.4 requires the result to hold
 * the **left** side's representatives. When the smaller side is the right one,
 * satisfying both means looking the left's representative up rather than
 * reusing the element in hand. `contains` stays the surface's only membership
 * read (§4.4).
 *
 * `debugLog` is `stdlib/Debug.hex`'s one row (§3.2, #407), and the door's first
 * **species (a)** customer (`spec/effects.md` §6.2): a write to a channel no
 * Hexagon expression can read back, declared pure and honestly so. The lowering
 * is where the species is earned rather than asserted — §6.2's caveat requires
 * the sink captured when the emitted module initializes, because a `console.log`
 * dereferenced per call is a global a program could replace and then read the
 * probe back through. `trace` takes no key: it is ordinary Hexagon over this
 * row, interpolating its label and value and answering the value.
 *
 * The `jsValue*` family is `stdlib/JsValue.hex`'s (FFI Part 11), in the same
 * primop shape the primitive companions took: the door carries what the
 * language cannot say, and every guard above it is ordinary Hexagon in that
 * file. Three things about the cut are worth stating where the keys are.
 *
 * - **Five of the eight are the identity, and all five are unexported.**
 *   `jsValueAsIntUnchecked` and its four siblings each cross one shared
 *   representation — a JavaScript `number` *is* an `Int` and a `Float`, a
 *   `bigint` *is* a `BigInt`, a `boolean` *is* a `Bool`, a `string` *is* a
 *   `String` — and each sits beneath the exported decoder whose `kind` test
 *   earns it, exactly as `bigIntToIntUnchecked` sits beneath `BigInt.toInt`'s
 *   range check. `jsValueIsSafeInteger` is the one predicate, and it is what
 *   splits `Shape` from `Range` at `toInt` (§4.1).
 * - **`jsValueKind` is the only row with any JavaScript to it**, and it is a
 *   helper rather than a bare arrow because the classification is statements: a
 *   `typeof` ladder, and then one `Array.isArray` probe that must be **guarded**
 *   so a revoked proxy classifies as `Object` rather than throwing (§3's
 *   totality clause). No row in the family reads a property.
 * - **`jsValueFrom` is keyed for what Hexagon cannot write.** The injection is
 *   the representation-honest identity (§2), and `value` at `a -> JsValue`
 *   typechecks through nothing, so the strictly-simpler law cannot send it to
 *   source. It is *erased at its call sites*, so the module-level binding this
 *   key lowers is what a foreign caller reaching the export finds, and nothing
 *   a Hexagon call site pays for.
 */
export const INTRINSIC_INVENTORY: ReadonlyMap<string, number> = new Map([
  ["seqMemoize", 1],
  ["streamFromSeq", 1],
  ["vectorLength", 1],
  ["vectorAppend", 2],
  ["vectorPrepend", 2],
  ["vectorAt", 2],
  ["vectorSet", 3],
  ["vectorToSeq", 1],
  ["vectorFromSeq", 1],
  ["bigIntAdd", 2],
  ["bigIntMultiply", 2],
  ["bigIntFromNat", 1],
  ["bigIntSubtract", 2],
  ["bigIntNegate", 1],
  ["bigIntFromInt", 1],
  ["bigIntEquals", 2],
  ["bigIntCompare", 2],
  ["bigIntShow", 1],
  ["bigIntPow", 2],
  ["bigIntHash", 1],
  ["bigIntQuot", 2],
  ["bigIntRem", 2],
  ["bigIntToIntUnchecked", 1],
  ["bigIntToFloatUnchecked", 1],
  ["intAdd", 2],
  ["intMultiply", 2],
  ["intFromNat", 1],
  ["intSubtract", 2],
  ["intNegate", 1],
  ["intEquals", 2],
  ["intCompare", 2],
  ["intShow", 1],
  ["intPow", 2],
  ["intHash", 1],
  ["intQuot", 2],
  ["intRem", 2],
  ["natAdd", 2],
  ["natMultiply", 2],
  ["natEquals", 2],
  ["natCompare", 2],
  ["natShow", 1],
  ["natPow", 2],
  ["natHash", 1],
  ["natQuot", 2],
  ["natRem", 2],
  ["natFromIntUnchecked", 1],
  ["floatAdd", 2],
  ["floatMultiply", 2],
  ["floatSubtract", 2],
  ["floatNegate", 1],
  ["floatFromInt", 1],
  ["floatDivide", 2],
  ["floatEquals", 2],
  ["floatCompare", 2],
  ["floatShow", 1],
  ["floatPow", 2],
  ["floatHash", 1],
  ["floatRem", 2],
  ["stringConcat", 2],
  ["stringEquals", 2],
  ["stringCompare", 2],
  ["stringHash", 1],
  ["stringFromSeq", 1],
  ["hashTrieMix", 1],
  ["hashTrieDigit", 2],
  ["hashTrieBitTest", 2],
  ["hashTrieBitSet", 2],
  ["hashTrieBitClear", 2],
  ["hashTrieBitCount", 1],
  ["hashTrieBitCountBelow", 2],
  ["hashTrieNodeSingleton", 1],
  ["hashTrieNodeInsertAt", 3],
  ["hashTrieNodeRemoveAt", 2],
  ["mapEmpty", 0],
  ["mapSingleton", 2],
  ["mapSize", 1],
  ["mapGet", 2],
  ["mapSet", 3],
  ["mapRemove", 2],
  ["mapEntries", 1],
  ["setEmpty", 0],
  ["setSingleton", 1],
  ["setSize", 1],
  ["setContains", 2],
  ["setAdd", 2],
  ["setRemove", 2],
  ["setElements", 1],
  ["setLookup", 2],
  ["debugLog", 1],
  ["jsValueKind", 1],
  ["jsValueFrom", 1],
  ["jsValueIsSafeInteger", 1],
  ["jsValueAsIntUnchecked", 1],
  ["jsValueAsFloatUnchecked", 1],
  ["jsValueAsBigIntUnchecked", 1],
  ["jsValueAsBoolUnchecked", 1],
  ["jsValueAsStringUnchecked", 1],
]);

/**
 * The nearest inventory member to a misspelled key, for §11's diagnostic. Only
 * a genuinely close key is offered: past a third of the key's length the
 * "nearest" member is noise, and the message falls back to listing nothing.
 */
export function nearestIntrinsicKey(key: string): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of INTRINSIC_INVENTORY.keys()) {
    const distance = editDistance(key, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best === undefined) return undefined;
  return bestDistance <= Math.max(1, Math.floor(best.length / 3)) ? best : undefined;
}

/** Ordinary Levenshtein distance over a single rolling row. */
function editDistance(left: string, right: string): number {
  let previous = [...Array(right.length + 1).keys()];
  for (let index = 1; index <= left.length; index += 1) {
    const current = [index];
    for (let other = 1; other <= right.length; other += 1) {
      current.push(
        left[index - 1] === right[other - 1]
          ? previous[other - 1]!
          : 1 + Math.min(previous[other - 1]!, previous[other]!, current[other - 1]!),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}
