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
 * The `vector*` family is Collections Part 3 §7's boundary crossing plus one:
 * seven §7 keys — representation-sensitive length and end updates, signed
 * indexed access, persistent indexed update, and the eager/lazy bridge — and
 * `vectorToArray`, which is FFI Part 2 §9's and has its own paragraph below.
 * Everything else in §7's table is Hexagon source in `stdlib/Vector.hex`, which
 * declares those seven and owns the public surface over them (§9.2's `Vector`
 * milestone).
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
 * #344), in the same primop shape, with the following things worth naming.
 *
 * - **`floatRem` is a plain export's core, not a member's.** `Float` is never
 *   `Integral` (Integral §1), so `Float.rem` is an ordinary exported function
 *   whose lowering is the bare `a % b` of Division & Remainder §6, and
 *   `Float.mod` is the Euclidean adjustment written over it in Hexagon. There
 *   is no `floatMod` key and no guard in this float-valued family: its
 *   partiality is `NaN`.
 * - **The checked rounding exits keep only three capabilities here** (#919).
 *   `floatTrunc` produces the integer-valued `Float` every rule composes over,
 *   `floatIsSafeInteger` earns the crossing, and `floatToIntUnchecked` is its
 *   representation-identity core. Direction, ties, canonical zero, messages,
 *   and the `IntRangeError` guard stay in ordinary `Float.hex`; there is no
 *   `floatFloor`, `floatCeil`, or host-asymmetric `floatRound` key.
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
 *   complexity. Its twin `String.toSeq` is the source-owned
 *   `Iterable<String>` row's member (§4, §5.2), whose ordinary body delegates
 *   to private `stringToSeq`. That key is the same lazy
 *   `Seq`-over-an-iterable adapter the old provided row used, and JS string
 *   iteration is codepoint-wise, which is §5.1's semantics exactly.
 *
 * The `hashTrie*` family is the door's first **runtime-module** customer (§5.2's
 * runtime bullet, #365): `stdlib/Runtime/HashTrie.hex` declares all ten, unexported,
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
 *   no bitwise operators (`stdlib/Runtime/VectorTrie.hex` needed none, and divides
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
 * of `Hex.Runtime.HashTrie`'s emitted module. Three things about the shape are
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
 * iterator. So `stdlib/Runtime/HashTrie.hex` holds a one-field wrapper record
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
 * The `math*` family is `stdlib/Math.hex`'s complete function surface
 * (`spec/math.md` §5). Each key is a direct alias of the corresponding native
 * `Math` operation; `mathLn` alone changes the public spelling (`ln`) to the
 * native spelling (`log`). The constants are ordinary Float literals in source,
 * and power is deliberately absent: it remains owned by `Pow` and `Float.pow`.
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
 *
 * *(#511, the `toArray` slice.)* Two more `jsValue*` rows and one `array*` row
 * land together, and the cut is the same one twice over — the probe and the
 * crossing are keyed, and the verdict between them is ordinary Hexagon.
 *
 * - **`jsValueIsArray` is `Array.isArray`, raw and unguarded**, and that is the
 *   row's whole content. It is a *different key* from the probe inside
 *   `jsValueKind` on purpose: FFI Part 11 §4.2 rules that `toArray` does not
 *   suppress a throwing probe, where §3's totality clause requires `kind` to. A
 *   revoked proxy therefore leaves `toArray` as a foreign throw and classifies
 *   as `Object` under `kind`, and the asymmetry is spelled in the inventory
 *   rather than in a flag on one key. `jsValueAsArrayUnchecked` is the sixth
 *   **unexported** representation-honest identity, sitting beneath the verdict
 *   that earns it exactly as its five siblings do — the borrowed view *is* the same
 *   array (§4.2's zero-copy clause), so the crossing has nothing to do.
 * - **`arrayLength` is `stdlib/Array.hex`'s one row** (FFI Part 2 §6.3), and it
 *   lowers to the native `.length` read that §6.3's emission bullet names. Its
 *   sibling accessors need no key: `get` is ordinary Hexagon over this row and
 *   the bracket, and the bracket itself is an *expression form* — the emitter's
 *   own lowering, like `Vector`'s and `Map`'s — so the bounds assertion that
 *   throws `IndexError` is no companion operation and takes no key. Neither
 *   does the file's §9 conversion, `Array.toVector`: it is a `for` over the
 *   borrow folding `Vector.append`, which is ordinary Hexagon at the same
 *   complexity, so `stdlib-roadmap.md` §5.1 keeps it in source. The contrast
 *   with `vectorToArray` below is the whole of why one is keyed and one is not.
 *
 * *(#792, the borrowed collections.)* The `jsMap*` and `jsSet*` families are
 * `stdlib/JsMap.hex`'s and `stdlib/JsSet.hex`'s (FFI Part 10 §3), and the cut is
 * `arrayLength`'s one type parameter wider: each row is a single native read or
 * a single native construction, and every verdict over them is ordinary Hexagon
 * in those files. **No row carries `Hash`** — §4.3 makes lookup the native
 * collection's SameValueZero, so there is no evidence for a key to defer to.
 *
 * - **`jsMapGetUnchecked` is unexported**, beneath `JsMap.get`, and the pairing
 *   is §4.2's two-step lowering rather than a convenience. The bare native
 *   `get` answers `undefined` for a stored `undefined` and for an absent key
 *   alike, so `get` asks `jsMapHas` first and reaches this row only once the key
 *   is known present — which is what keeps `Some(undefined)` distinguishable
 *   from `None`. §4.2 forbids fusing the two into one `get` plus an
 *   `undefined` test *even where `v` looks unable to contain `undefined`*, and
 *   writing the sequence in Hexagon over two keys is how that comes out
 *   unfusable: the emitter never sees a shape to collapse.
 * - **`jsMapFromSeq` and `jsSetFromSeq` are `new Map(…)` and `new Set(…)` and
 *   nothing more.** A Hexagon `Seq` value carries `[Symbol.iterator]` and a
 *   Hexagon tuple *is* a plain two-element JS array, so the native constructors
 *   already consume the source in traversal order and already implement §6.5's
 *   duplicate rules — later value wins at a map, first representative and
 *   position retained at a set. Nothing is adapted on the way in, and the
 *   freshness §6.5 promises is the constructor's own.
 * - **`Map` and `Set` are spelled through the emitter's runtime vocabulary**
 *   (#666, FFI Part 7 §1.2), which is what the two words joined it for: a
 *   host explicitly trusting its own copy of either registered member
 *   may bind either spelling at module level, and a captured `Map` would make
 *   `fromSeq` construct the user's value.
 *
 * *(#509, the `JsError` door.)* The `jsError*` family is `stdlib/JsError.hex`'s
 * (FFI Part 11 §7), three rows for the two total conservative accessors, and
 * the cut is §3.2's standard one: what only JavaScript can say is keyed, and
 * the verdict over it is ordinary Hexagon.
 *
 * - **`jsErrorReadMessage` and `jsErrorReadStack` are the guarded reads**, and
 *   guarded is the whole content: Hexagon has no way to catch a getter or a
 *   proxy trap, so a `.message` that throws could not be swallowed in source at
 *   all. Each performs **one** property read and answers with what it read, or
 *   `undefined` when the read threw — so the string verdict above them
 *   (`JsValue.toString`, strict and non-coercing) is Hexagon's, and the value's
 *   own `toString` is reached by nothing. Two keys rather than one property
 *   name in a parameter, because the accessors are two operations and the
 *   inventory names operations.
 * - **`jsErrorRender` is the safe stringification** §7's first bullet requires
 *   of a value that bears no properties. It is not Hexagon-expressible for the
 *   reason the family exists: a `Symbol`, `undefined` and `null` have no
 *   decoder in FFI Part 11 §4 at all, and `String(value)` is the one rendering
 *   that cannot throw on any of them. It is asked only of a value `kind` has
 *   already placed outside `Object` and `Function`, so it never meets a
 *   `toString` of anyone's — the guard is the Hexagon above it, exactly as
 *   `jsValueIsSafeInteger`'s caller is.
 *
 * *(#238, the outbound crossing.)* `vectorToArray` is `stdlib/Vector.hex`'s
 * eighth key and the only one of that file's rows that is not Collections
 * Part 3 §7's boundary: it is FFI Part 2 §9's outbound conversion, declared
 * there per §9.1's obligation 2, and shipped with its whole contract or not at
 * all (obligation 4).
 *
 * The crossing itself is the row's entire content. A `Vector(a)` is an opaque
 * trie whose spine belongs to the runtime, and an `Array(a)` is a JavaScript
 * array — the borrowed foreign door, which by construction has no Hexagon
 * producer: there is no array literal, no constructor, and no mutation surface
 * to fill one through (§6.1). A source body could therefore not so much as name
 * its own result, so the strictly-simpler law has nowhere to send it. Nothing
 * sits *above* the key either, which is the other half of the cut: §9 makes the
 * operation eager, fresh, shallow and total, so there is no guard to write, no
 * range to check, and no verdict to reach. Where `BigInt.toInt` wraps
 * `bigIntToIntUnchecked` in a range check, this row wraps nothing, and a
 * Hexagon wrapper over it would add only a second name for one call.
 *
 * **§9's other direction takes no key, and the asymmetry is the doctrine
 * working.** `Array.toVector` is the same section's inbound conversion and is
 * ordinary Hexagon in `stdlib/Array.hex`. The sentence above is exactly why:
 * `vectorToArray` is keyed because a source body could not name its own result,
 * and the mirror of that argument is false. An `Array(a)` has no *producer*,
 * but it has a *traversal* — §8.1's provided `Iterable` row, which §8.2 emits
 * as native `for...of` — and `stdlib/Array.hex` is seated after
 * `stdlib/Vector.hex` in the prelude order, so `Vector.append` is in scope
 * there. A `for` over the borrow folding `append` is therefore expressible, at
 * the same complexity and the same emitted shape a key would produce — the
 * comparison §5.1 asks for is against the alternative implementation, and the
 * keyed `vectorOf` is the very same fold of persistent appends — which is
 * precisely the case `stdlib-roadmap.md` §5.1 keeps in source: none of its four
 * justifications for a private intrinsic (a host capability, an opaque or
 * performance-critical representation, a compiler transformation, measured
 * performance evidence) reaches it. Both premises are pinned in
 * `array-to-vector.test.ts`, so if either stops holding this paragraph breaks
 * visibly rather than quietly.
 *
 * *(#927, the Regex arc's foundations.)* The `buffer` family is
 * `stdlib/Runtime/Regex.hex`'s, and it is the inventory's **first type row**
 * beside four operations over it (§3.3, `regex.md` §7). `buffer` is the
 * confined, mutable, invariant storage the engine is written over: a Hexagon
 * record is immutable whatever its fields (Statements §6.4), so no declared form
 * can carry the mutation, and an empty `opaque record` would leave the compiler
 * nothing to own. Its entry names `Runtime.Regex` as its one declarer, which is
 * the half of §3.3's confinement bar a declaration site can answer; the other
 * half — that no value of the type escapes the declaring module — the checker
 * verifies.
 *
 * The four operations write the arrow true of each (§3.3, `regex.md` §7):
 * `bufferCreate`, `bufferRead`, and `bufferWrite` are `->!`, because a fresh
 * buffer's identity is observable through the other two — a write to one and a
 * read of the other tell two buffers apart — while `bufferLength` is `->`, the
 * size being fixed at creation with no row that changes it. Bounds are
 * unchecked: the engine never reads or writes outside a buffer it sized, and
 * that is a conformance obligation on the engine rather than a check (`regex.md`
 * §7). The engine itself, and the `regexProgram` type key with its two sealed
 * rows, land in later arcs of #927; nothing here anticipates them.
 */

/** Which of §4.2's two grades a key is verified at. */
export type IntrinsicGrade = "operation" | "type";

/** An operation key: a `fun` row's, whose arity is its parameter count. */
export interface IntrinsicOperationEntry {
  readonly grade: "operation";
  readonly arity: number;
}

/**
 * A type key (§3.3, §4.1): a `type` row's, whose arity is its **type**-parameter
 * count and whose entry names the modules permitted to declare it — by declared
 * name, as `runtime-modules.ts` spells one (`Runtime.Regex`). A declaration
 * anywhere else is refused (§11).
 *
 * Where two modules are named they bind the same compiler type, as two `fun`
 * rows for one key bind one lowering, and every obligation over the type binds
 * them jointly.
 *
 * *(#1071.)* `vector`, `map`, and `set` are the first **public** keys: each is
 * its companion's own type, declared by `export type vector as Vector(+a)` and
 * its siblings, and each names the built-in kind it is and the runtime record
 * its values are. The claim written at the row is checked against that record
 * there, which is what retired their compiler-side claim-table rows.
 */
export interface IntrinsicTypeEntry {
  readonly grade: "type";
  readonly arity: number;
  readonly declarers: readonly string[];
  /**
   * The key's **reach** (§3.3): whether the type is addressable only in its
   * declarers, or is its declaring module's own type, exported like any other.
   */
  readonly reach: "confined" | "public";
  /**
   * *(#1071.)* For a public key, the **built-in kind** the key's type is. The
   * language already has a kind for every public key — each is a type with
   * syntax of its own (a vector literal, `..`) — so the kind *is* the key's one
   * identity, and the row binds its spelling to it rather than minting a door
   * type beside it. A confined key has no kind; its identity is its reserved
   * door-type id (`intrinsicTypeId`).
   */
  readonly kind?: PublicTypeKind;
  /**
   * The Hexagon record the emitter targets for the type's values, parameter for
   * parameter, where there is one (§4.1). A written variance claim is checked
   * against this record's computed variance at the row (§3.3).
   */
  readonly representation?: { readonly module: string; readonly record: string };
}

/** The built-in kinds a public type key names (#1071). */
export type PublicTypeKind = "Vector" | "Map" | "Set";

export type IntrinsicEntry = IntrinsicOperationEntry | IntrinsicTypeEntry;

/**
 * The inventory's **type** rows (§3.3). They share the one flat, compiler-global
 * key space with the operations — one space, two grades — which is what makes
 * §4.2's wrong-grade diagnostic a statement about the row's *keyword* rather
 * than about the key's existence.
 */
const INTRINSIC_TYPES: readonly (readonly [string, IntrinsicTypeEntry])[] = [
  ["buffer", { grade: "type", arity: 1, declarers: ["Runtime.Regex"], reach: "confined" }],
  [
    "vector",
    {
      grade: "type",
      arity: 1,
      declarers: ["Vector"],
      reach: "public",
      kind: "Vector",
      representation: { module: "Runtime.VectorTrie", record: "TrieVector" },
    },
  ],
  [
    "map",
    {
      grade: "type",
      arity: 2,
      declarers: ["Map"],
      reach: "public",
      kind: "Map",
      representation: { module: "Runtime.HashTrie", record: "HashTrie" },
    },
  ],
  [
    "set",
    {
      grade: "type",
      arity: 1,
      declarers: ["Set"],
      reach: "public",
      kind: "Set",
      representation: { module: "Runtime.HashTrie", record: "HashSet" },
    },
  ],
];

/** The inventory's **operation** rows, key to parameter count. */
const INTRINSIC_OPERATIONS: readonly (readonly [string, number])[] = [
  ["seqMemoize", 1],
  ["streamFromSeq", 1],
  ["vectorLength", 1],
  ["vectorAppend", 2],
  ["vectorPrepend", 2],
  ["vectorAt", 2],
  ["vectorSet", 3],
  ["vectorToSeq", 1],
  ["vectorFromSeq", 1],
  ["vectorToArray", 1],
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
  ["bigIntBitAnd", 2],
  ["bigIntBitOr", 2],
  ["bigIntBitXor", 2],
  ["bigIntShiftLeft", 2],
  ["bigIntShiftRight", 2],
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
  ["intBitAnd", 2],
  ["intBitOr", 2],
  ["intBitXor", 2],
  ["intShiftLeft", 2],
  ["intShiftRight", 2],
  ["intToInt32", 1],
  ["intToUint32", 1],
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
  ["floatTrunc", 1],
  ["floatIsSafeInteger", 1],
  ["floatToIntUnchecked", 1],
  ["stringConcat", 2],
  ["stringEquals", 2],
  ["stringCompare", 2],
  ["stringHash", 1],
  ["stringFromSeq", 1],
  ["stringToSeq", 1],
  ["stringIsWhitespace", 1],
  ["stringIsCased", 1],
  ["stringIsCaseIgnorable", 1],
  ["stringLowercaseMapping", 1],
  ["stringUppercaseMapping", 1],
  ["stringCaseFoldMapping", 1],
  ["stringCodepointUnchecked", 1],
  ["stringFromCodepointUnchecked", 1],
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
  ["nullableUndefined", 0],
  ["nullableNull", 0],
  ["nullableIsNull", 1],
  ["nullableIsUndefined", 1],
  ["nullableAsValueUnchecked", 1],
  ["nullableFromValue", 1],
  ["debugLog", 1],
  ["mathSqrt", 1],
  ["mathSin", 1],
  ["mathCos", 1],
  ["mathTan", 1],
  ["mathAsin", 1],
  ["mathAcos", 1],
  ["mathAtan", 1],
  ["mathAtan2", 2],
  ["mathExp", 1],
  ["mathLn", 1],
  ["mathLog10", 1],
  ["mathSinh", 1],
  ["mathCosh", 1],
  ["mathTanh", 1],
  ["jsValueKind", 1],
  ["jsValueFrom", 1],
  ["jsValueIsSafeInteger", 1],
  ["jsValueAsIntUnchecked", 1],
  ["jsValueAsFloatUnchecked", 1],
  ["jsValueAsBigIntUnchecked", 1],
  ["jsValueAsBoolUnchecked", 1],
  ["jsValueAsStringUnchecked", 1],
  ["jsValueIsArray", 1],
  ["jsValueAsArrayUnchecked", 1],
  ["arrayLength", 1],
  ["jsMapSize", 1],
  ["jsMapHas", 2],
  ["jsMapGetUnchecked", 2],
  ["jsMapFromSeq", 1],
  ["jsSetSize", 1],
  ["jsSetHas", 2],
  ["jsSetFromSeq", 1],
  ["jsErrorReadMessage", 1],
  ["jsErrorReadStack", 1],
  ["jsErrorRender", 1],
  ["bufferCreate", 2],
  ["bufferRead", 2],
  ["bufferWrite", 3],
  ["bufferLength", 1],
];

/**
 * Every intrinsic the compiler provides, at both grades, in one flat
 * compiler-global space (§4.1). The operations come first because they were
 * first; the order is the inventory listing's order and nothing else reads it.
 */
export const INTRINSIC_INVENTORY: ReadonlyMap<string, IntrinsicEntry> = new Map<
  string,
  IntrinsicEntry
>([
  ...INTRINSIC_OPERATIONS.map(
    ([key, arity]) => [key, { grade: "operation", arity } as IntrinsicEntry] as const,
  ),
  ...INTRINSIC_TYPES.map(([key, entry]) => [key, entry as IntrinsicEntry] as const),
]);

/**
 * The reserved identity band for **door-declared types** (§3.3, §4.1).
 *
 * A type key names **one compiler type**, not one per declaration: "where two
 * modules are named they bind the same compiler type, as two `fun` rows for one
 * key bind one lowering, and every obligation over the type binds them jointly"
 * (§3.3). So the identity is a function of the key and of nothing else — not of
 * the declaration, not of the module, not of the order the compiler happened to
 * reach them in — and `node`'s scheduled migration, which names two declarers,
 * is what makes that difference observable rather than theoretical.
 *
 * The band sits above the prelude's reserved range (`project.ts`'s
 * `PRELUDE_ID_BASE`) so that the two allocators never meet: an ordinary extern
 * type's id is minted per module and rebased per compilation, and an intrinsic
 * type's is fixed for the life of the compiler. `project.ts` excludes this band
 * from both rebasings for that reason.
 */
export const INTRINSIC_TYPE_ID_BASE = 2_000_000;

/**
 * The one identity a type key denotes, or `undefined` for a key that is not a
 * type key. Stable across modules and across compilations, by construction.
 */
export function intrinsicTypeId(key: string): number | undefined {
  const index = INTRINSIC_TYPES.findIndex(([name]) => name === key);
  return index < 0 ? undefined : INTRINSIC_TYPE_ID_BASE + index;
}

/**
 * The built-in kind a public key's reserved identity denotes (#1071), or
 * `undefined` for a confined key's identity and for any other id. The resolver
 * reads it wherever a type name resolves to a door row's identity: a public row
 * binds its spelling to the kind, so what the spelling produces is the kind.
 */
export function publicTypeKind(id: number): PublicTypeKind | undefined {
  const entry = INTRINSIC_TYPES[id - INTRINSIC_TYPE_ID_BASE]?.[1];
  return entry?.reach === "public" ? entry.kind : undefined;
}

/**
 * Every representation record a type key names, as `<module>.<record>` (#1071):
 * the records a public row's written claim is checked against.
 */
export const REPRESENTATION_RECORD_KEYS: ReadonlySet<string> = new Set(
  INTRINSIC_TYPES.flatMap(([, entry]) =>
    entry.representation === undefined
      ? []
      : [`${entry.representation.module}.${entry.representation.record}`]
  ),
);

/** Whether a built-in kind's name is one a public type key names (#1071). */
export function isPublicTypeKind(kind: string): kind is PublicTypeKind {
  return INTRINSIC_TYPES.some(([, entry]) => entry.kind === kind);
}

/** A public kind's type key and entry (#1071): the inverse of `publicTypeKind`. */
export function publicTypeKey(
  kind: PublicTypeKind,
): { readonly key: string; readonly id: number; readonly entry: IntrinsicTypeEntry } {
  const index = INTRINSIC_TYPES.findIndex(([, entry]) => entry.kind === kind);
  const [key, entry] = INTRINSIC_TYPES[index]!;
  return { key, id: INTRINSIC_TYPE_ID_BASE + index, entry };
}

/** The inventory's keys at one grade, in inventory order (§4.2). */
export function intrinsicKeys(grade: IntrinsicGrade): readonly string[] {
  return [...INTRINSIC_INVENTORY]
    .filter(([, entry]) => entry.grade === grade)
    .map(([key]) => key);
}

/**
 * The nearest inventory member to a misspelled key, for §11's diagnostic. Only
 * a genuinely close key is offered: past a third of the key's length the
 * "nearest" member is noise, and the message falls back to listing nothing.
 *
 * *(#927.)* The search is **grade-scoped** (§4.2): the row's own keyword says
 * which half of the space the author was reaching into, so offering an operation
 * key to a misspelled `type` row would be a suggestion the row could not take —
 * it would draw the wrong-grade refusal on the next compile. A key at the other
 * grade is not "near"; it is a different kind of thing.
 */
export function nearestIntrinsicKey(
  key: string,
  grade: IntrinsicGrade,
): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of intrinsicKeys(grade)) {
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
