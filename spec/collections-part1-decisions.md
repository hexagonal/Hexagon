# Hexagon Spec: Collections Part 1 — Foundational Decisions

**Status:** Decided (July 2026); §3.1 amended 2026-08-02 — the `length`/`size` split, and enforcement of the `cons` ban against `stdlib/Seq.hex` — see correction record §10.1. The foundational decisions of the collections suite: names, representation, key model, naming doctrine, and the v1 iteration story. Authoritative for the doctrine it fixes; the full formal specifications are Collections Parts 2–5 and the FFI parts (see Companions), which are written against this ground and do not re-litigate it.
**Scope:** The `Vector(a)` name and the reservation of `List`; the representation and complexity contract; the collections naming doctrine; the uniform keyed-access partiality doctrine (`[]` throws, `get` is total); the Map/Set key model (`Hash`, hash-tried, not `Ord`-tree); `Hash` as a v1 derivable-only constraint; restricted user-implementable `Iterable` in v1; `Seq` as the universal conversion currency; operator boundaries (`++`).
**Not in scope:** The `Hash` formal spec and the constraint `type`-member grammar (Collections Part 2); `Vector` literals, patterns, indexing, slicing, and instances (Collections Part 3); the `Map`/`Set` formal spec, `KeyError`, and the iteration-order contract (Collections Part 4); the operational `Iterable` spec, the collections/stdlib boundary, and transients (Collections Part 5); the combinator surface (ledgered in `stdlib-roadmap.md`, decided in the stdlib listing); borrowed `Array(a)` (FFI Part 2); `Seq` interoperation (FFI Part 3); `JsMap`/`JsSet` (FFI Part 10); anything async.
**Companions:** Collections Parts 2–5 (the formal specs); Loops/Ranges/Iteration (`Seq`, base iteration semantics); Pattern Matching (vector patterns, with Part 3); Exceptions (`IndexError`; `KeyError` is declared in Part 4 §4.3); Operators (§7 `++`/`Concat` doctrine; the instance lives in Part 3 §8); Constraints (`honor`, orphan rule, coherence, derivation whitelist); Modules §7 (instance globality; §7.6 discoverability); FFI Parts 2, 3, and 10; `stdlib-roadmap.md`.

---

## 1. The workhorse sequence is `Vector(a)`; `List` is reserved

### 1.1 The decision

- The persistent indexed sequence formerly discussed as `List(a)` is named **`Vector(a)`**.
- **`List` is a reserved stdlib name**: no v1 type carries it, and user code cannot claim it (it lives in the prelude namespace layer as a reserved companion-module name). It is held for a possible v2 classic cons list, to be shipped only on demonstrated demand.

### 1.2 Rationale

`List` means something specific in the ML/Haskell/Elm lineage: a cons cell — O(1) prepend and head/tail sharing, O(n) index. Hexagon deliberately does not ship that structure, and naming the trie `List` would invite exactly the wrong idioms from FP-experienced users (head/tail recursion patterns against a structure whose costs are inverted). `Vector` has direct precedent for *this exact data structure* (Scala's immutable `Vector`, Clojure's vector) and the Rust-shaped tiebreak concurs (`Vec` = indexed growable sequence). It also makes the honest complexity story easier to tell: nobody expects `++` on a vector to be O(1).

### 1.3 Rename ripple (resolved)

The normative rename is resolved in its owners: Loops §5 and the finalized instance table (Part 5 §4) use `Vector`; Pattern Matching §11.1's deliberately-left list-pattern hole was discharged as **vector patterns**, owned by Pattern Matching and Collections Part 3 §3; the FFI parts use the final `Vector` name throughout. Residual historical or illustrative mentions elsewhere do not define a `List` surface and are removed by the consolidation audit.

### 1.4 Rejected alternatives (do not re-litigate)

- **Keep `List`** for the trie: wrong intuitions imported by the exact audience segment (FP-experienced) most likely to act on them; complexity documentation fights the name forever.
- **Free the name `List`** (unreserved): invites an ecosystem package to claim it with arbitrary semantics; reservation is nearly free and preserves the v2 option cleanly.
- **`Array`**: taken — it is the readonly foreign-door type at the FFI boundary (FFI Part 2 §6), and the distinction between the two is load-bearing.

---

## 2. Representation and complexity contract for `Vector(a)`

### 2.1 The decision

`Vector(a)` is a **persistent 32-way bit-partitioned trie deque** (Clojure/Immutable.js lineage), provided by `@hexagon/runtime`, with the Immutable.js origin/capacity technique giving cheap operations at *both* ends. The spec pins the complexity contract, not the implementation:

| Operation | Bound |
|---|---|
| `get` / `set` (by index) | O(log₃₂ n) |
| `append` / `dropLast` | O(1) amortized |
| `prepend` / `dropFirst` | O(1) amortized |
| `first` / `last` | O(1) |
| `concat` / `++` | **O(length of shorter side), documented as linear** |
| iteration | O(n) |

### 2.2 RRB rejected for v1 (pre-registered v2-maybe)

RRB (relaxed radix balanced) trees buy O(log n) concat/split at the price of relaxed nodes, size tables, rebalancing invariants, and worse constant factors — and in a strict (non-lazy) runtime the rebalancing cost is paid eagerly. The common workload (build, index, map/filter/fold, append, trim ends) is fully served by the plain trie. **v1 ships the boring structure and documents `++` as linear**; RRB is reconsidered only on benchmark evidence from real Hexagon code showing concat/split hot. The API is representation-silent, so the upgrade would be invisible to source.

### 2.3 Oracle

Immutable.js (MIT) is an implementation influence and property-testing oracle, **not a backend**. Hexagon owns and implements its collection structures in `@hexagon/runtime`. The operative statements live with the owners: Part 3 §4 for `Vector`; Part 4 §2.1 for `Map`/`Set`, where the oracle covers the public hash function and observable semantics only (table placement is seeded per Part 2 §2.4 and is not oracle-constrained).

---

## 3. Naming doctrine for collection APIs

### 3.1 The decision

Hexagon collection names are **modern functional, subject-first, self-describing**. Hexagon is not a copy of JS (it compiles *to* JS), and it is not a LISP or Haskell museum. Concretely:

**Banned name families:**
- LISP/Clojure lineage: `cons`, `snoc`, `conj`, `assoc`, `dissoc`. *(Enforced 2026-08-02: `Seq.cons` had shipped in violation of this row and is renamed `Seq.prepend` — §10.1.)*
- Haskell lineage where an ordinary word exists: `lookup`, `insert` (for map write), `member`.
- JS mutation pairs: `push`, `pop`, `shift`, `unshift` (`pop` is uniquely cursed — the ecosystem disagrees on whether it returns the element or the collection). These names stay on the JS side of the fence.
- `has` (JS-ism): `contains` reads uniformly across `String`, `Vector`, `Set`.

**Chosen core vocabulary (binding, not exhaustive):**
- `get` / `set` / `remove` for keyed access and update; `get` is always total and `Option`-returning (never a JS-ish absence value), with `[]` as its throwing counterpart — the uniform accessor pair, §3.3.
- `contains` (Set membership), `containsKey` (Map; leaves room for a deferred `containsValue`, avoids false cognates).
- `add` (Set), `append` / `prepend` (Vector ends; `Seq.prepend` since §10.1), `dropFirst` / `dropLast`.
- `first` / `last` return `Option(a)` (no exceptions for emptiness).
- `union` / `intersect` / `difference` / `isSubsetOf` (Set algebra, named — see §7).
- `empty`, `singleton`, `isEmpty`.
- **The cardinality reader is a general word with a linear specialization** *(amended 2026-08-02 — §10.1; originally a single `size`)*: **`size`** is the general word — `Map`, `Set`, and any non-linear collection; **`length`** is its specialization for linear, ordered structures — `String`, `Seq`, `Vector`, `Array`.
- `Map.fromEntries` with **last value wins** on duplicate keys (matches JS `Map` construction instinct; easy to state). Made normative, with the synonym pairs and representative-retention fine print, in Part 4 §3.
- **Uniform conversion suite**: every finite collection provides `toSeq` and `fromSeq` (for `Map`: `Seq((k, v))`), mechanically named, alongside `Map.keys` / `Map.values` / `Map.entries`.

### 3.2 Rationale

Same move as `mod`/`rem` over `%`: names that state their convention to a modern reader, with no lineage tax. The audience is senior TS developers; the doctrine gives them words they can read on first contact while remaining honestly functional (persistent, value-returning, `Option`-shaped).

### 3.3 The uniform accessor pair: `[]` throws, `get` is total

**The decision.** Every keyed collection offers both a panicking and a non-panicking read accessor, and the split is the same everywhere:

- **`[]` is the partial, throwing accessor**: `vec[i]` throws `IndexError` on an out-of-range index (Decisions Batch §5, unchanged); `map[k]` throws **`KeyError`** on an absent key. Read-only — `[]` never appears in write position (persistent values; updates are `Vector.set` / `Map.set`).
- **`get` is the total, `Option`-returning accessor**: `Vector.get(v, i): Option(a)`; `Map.get(m, k): Option(v)`.
- Slicing continues to clamp (Decisions Batch §5) — slices are total by design and outside this pair.

The doctrine is fixed here; the normative surfaces live with their owners: `Vector` and `String` indexing and slicing in Collections Part 3 (§5–§6, §9); `map[k]` and the `KeyError` declaration in Collections Part 4 (§4); borrowed `Array(a)` access in FFI Part 2 §6; `JsMap`'s bracket and `JsSet`'s deliberate lack of brackets in FFI Part 10 (§4–§5).

**Rationale.** The programmer should get the choice of panicking or not, and one rule covering all keyed access is simple, generalisable, and teachable: *brackets can throw; `get` cannot.* It is exactly Rust's split (`v[i]` panics, `v.get(i)` returns `Option`) extended to maps the Python way (`d[k]` raises `KeyError`, `d.get(k)` is safe) — both on-lineage precedents, and both instantly legible to the target audience. It also gives the `Option`-averse an honest escape hatch that is visibly partial at the call site.

**Doctrine (binding stdlib-wide): the `try` prefix, if ever used, means "does not throw."** C#'s `TryGetValue`, F#'s `Map.tryFind`, and Rust's `try_` all mark the *safe* variant; a Hexagon `tryX` that throws would invert a reflex for the TS and FP audiences simultaneously. Since `get` already occupies the safe slot, the prefix is expected to stay unused — this doctrine exists to keep a `tryX`-that-throws from ever slipping into the stdlib.

**Rejected alternatives (do not re-litigate):**
- **`Map.tryGet` as the throwing accessor**: `try` universally signals non-throwing across the reference languages; maximally confusing name.
- **A named `Map.getOrThrow` instead of `map[k]`**: honest but forfeits the unifying rule; two types, two conventions. (A `getOr(m, k, default)` convenience remains a stdlib-listing decision, ledgered in `stdlib-roadmap.md`.)
- **`map[k]` returning `Option(v)`**: makes `[]` mean "total" on Map and "throws" on Vector — the exact inconsistency the pair exists to prevent.

---

## 4. Map and Set are hash-based; `Hash` ships in v1, derivable-only

### 4.1 The decision

- `Map(k, v)` and `Set(a)` are **hash-tried persistent collections (HAMT lineage)** provided by `@hexagon/runtime`.
- Their key/element constraint is **`Hash`**, which **ships in v1**, formally specified in Part 2. The load-bearing properties, fixed here:
  - `Hash` has `Eq` as a base constraint (`Hash` extends `Eq`).
  - `Hash` is **derivable-only for user code**: it joins the derivation whitelist; users cannot write `honor Hash<T>` by hand, and deriving `Hash<T>` additionally requires that the `Eq<T>` instance is itself compiler-derived (the Eq-agreement rule, Part 2 §4.3).
  - Collection instances are compiler/runtime-provided — specified normatively by spec text, with no source form (Part 2 §4.4; Part 4 §8). The core-type instances' provenance is Part 2 §2.5's status map: companion source under the carve-out for the primitives, `Bool`'s prelude derivation, `Unit`'s automatic structural instance. "Derivable-only" constrains users, not the specification.
  - `Hash<Float>` normalises consistently with `Eq<Float>`'s SameValueZero: `-0` hashes as `+0`, all `NaN` bit patterns hash to one value. The normative statement is Part 2 §2.3/§2.5.
- Signatures follow the Set/Map sketch: `Map.get<k: Hash>(map: Map(k, v), key: k): Option(v)`, `Set.add<a: Hash>(set: Set(a), value: a): Set(a)`, etc.
- Iteration order is **deterministic but unspecified** — not insertion order, not sorted, not stable across executions, and not a function of the collection's contents. The full contract is Part 2 §2.4 as instantiated by Part 4 §7.1; this document adds nothing to it.
- **`SortedMap` / `SortedSet` (`Ord`-keyed trees) are pre-registered as v2-on-demand counterparts** — the Rust `HashMap`/`BTreeMap` pairing.

### 4.2 Rationale

The corpus already leans hash-shaped, decisively:

1. **`Eq<Float>` = SameValueZero was chosen specifically for Map/Set key coherence** (Decisions Batch §1.2). That decision earns its keep only if Hexagon's Map/Set have JS-Map-like key semantics; an `Ord`-tree map never consults SameValueZero.
2. **Decisions Batch §1.4 pre-registered `Hash<Float>` semantics** "if Hash ever ships" and confirmed that the Immutable.js oracle exhibits compatible behavior. The door was deliberately open; "not v1 user-facing" was a deferral, not a rejection — and the derivable-only form keeps the *user-facing surface* it worried about minimal.
3. **The Rust-shaped tiebreak**: Rust's default map is `HashMap`; the ordered tree is the opt-in. The "functional collections are `Ord`-based" impression is the ML/Haskell/Elm/F# tree tradition only — Clojure, Scala, and Roc (the languages closest to Hexagon's runtime story) all default to HAMTs.
4. **`Ord`-keyed maps overtax key types**: a record key would need a total order it has no natural claim to. `Hash`+`Eq` is the genuinely weaker requirement, and the whitelist derivation covers records/unions structurally.
5. **Audience**: senior TS developers expect maps to be hash-like and do not expect sorted iteration.

**Coherence hazard, resolved by construction:** a hand-written `Eq` that disagrees with the internal hash silently corrupts a hash map. Derivable-only `Hash` makes the user-defined hazard unwritable: every user-derived `Hash` is structurally consistent with its required compiler-derived `Eq`; each compiler/runtime-provided instance is specified together with an agreeing `Eq` under Part 2 §2.3/§4.4.

**On JS conversion (recorded because it caused confusion):** `Map → JsMap` is O(n) iteration under *either* key model; the emitted JS `Map` simply inherits the iteration order. The real impedance mismatch — JS `Map` uses reference identity for object keys, Hexagon uses structural `Eq` — exists identically under `Ord`-trees, so it does not discriminate. If anything the hash design converts more faithfully: primitive-key semantics (SameValueZero) match JS exactly. Part 4 §10 pins the boundary semantics; FFI Part 10 owns the conversion functions.

### 4.3 Rejected alternatives (do not re-litigate)

- **`Ord`-keyed balanced trees as the v1 default** (the Haskell `Data.Map` / OCaml / Elm `Dict` / F# `Map` shape): rests on the non sequitur "no public `Hash` constraint ⟹ must be `Ord`"; forfeits the SameValueZero anchoring; taxes record keys with an unearned total order; surprises the target audience with sorted O(log n)-with-tree-constants maps. Sorted collections return as v2 `SortedMap`/`SortedSet` if demanded.
- **Anonymous runtime structural hashing with no constraint in signatures** (the literal Immutable.js model): mechanically workable — the runtime can hash any compiled Hexagon value — but hides a real requirement from the types. `Map.set` demanding `<k: Hash>` is the honest signature; hiding it is not very Hexagon.
- **User-implementable `Hash` in v1**: reopens the hash/`Eq` coherence hazard the derivable-only form exists to close, for no v1 customer. The v2 revisit is pre-registered as `derive via` (Part 2 §11) — a law-proof candidate replacement for hand-written instances, not a reopening.

---

## 5. `Seq` is the universal currency

`Seq(a)` (Loops §6) is the public, concrete, lazy common-currency sequence with the functional-cursor protocol. This document fixes the **uniform conversion invariant**: every finite stdlib collection ships `toSeq` / `fromSeq` (§3.1), and third-party collections are expected to do the same (§6.5). Two deliberate non-members of that suite (Part 5 §4): `Range` is iterable but is not a collection and has no conversion pair; `Seq` itself needs no identity pair — the currency does not convert into itself. `Seq` **crosses the FFI boundary in v1**: inbound foreign iterables adapt automatically, and an exported Hexagon `Seq` presents a replayable iterable face; FFI Part 3 owns the persistent adapter semantics.

---

## 6. User-implementable `Iterable` ships in v1, restricted

### 6.1 The decision

**"You can write a real collection" is a v1 requirement, and `for x in myBag` is its floor.** v1 therefore ships user-implementable `Iterable` in the following restricted form:

- `Iterable` is a real prelude constraint declaration with an implied `type Item` member and `toSeq(xs: c): Seq(Item)`. The declaration is Part 2 §8; the `type`-member grammar is Part 2 §5.
- A user instance — `honor Iterable<Bag(a)>` with `type Item = a` — adds a row to the iterable table. The operational lookup for `for p in e`, the finalized provided-instance table, the failure taxonomy and diagnostics, and the table-opening rules are Collections Part 5 §§2–8.
- Instances are global (Modules §7). Discoverability is owned by Modules §7.6 and Part 5 §7.2: for a home-module instance the import graph does the work by construction — no effect import is needed.
- **v1 restrictions, stated plainly:** `Item(c)` is not referenceable in user type expressions, and `Iterable` cannot appear as a constraint binder on user functions (the projection-bearing restriction, Part 2 §7). Functions generic over "any iterable" remain unwritable in v1; `Seq(a)` parameters remain the idiom (Loops §7.1).

### 6.2 Rationale

The original deferral protected against a specific risk: **deferred `Item(α)` goals in inference** — the machinery for generic-over-any-iterable functions, the first feature that would touch `unify`'s environs. `for x in myBag` needs none of it: head-constructor-known table lookup is exactly how the internal table already worked (it was always a functional-dependency table). Opening the table to `honor` is parser-and-bookkeeping work — real spec surface (the `type`-member grammar, Part 2), zero inference changes. And the calibration specimen the deferral said it was waiting for now exists: the first user-defined collection.

### 6.3 What stays v2

Deferred `Item(α)` goals; `Item(c)` in user type expressions; obligations on implied types (`type Item: Show`); non-structural user hashing. The canonical statement of the v1 restriction is Part 2 §7; the pre-registered v2 direction — including `derive via` as the candidate replacement for hand-written `Hash` — is owned by **Part 2 §11**.

### 6.4 Amendments (resolved)

The amendments this part made are applied and stand: Decisions Batch 2026-07 §6 is amended (the restricted form is v1; the full implied-types feature remains v2, per §6.3); Loops records the table-opening promotion as resolved (Loops §7, §11), re-scoped by Part 2 §14; the main roadmap's Tier-3 implied-types entry carries the re-scope and the `derive via` pointer. Confirmation record: Part 5 §16.2.

### 6.5 The "so you're writing your own collection" recipe

A proper third-party collection in v1: (1) `toSeq` / `fromSeq` as ordinary functions; (2) one `honor Iterable` instance delegating to `toSeq` — this is `for..in`; (3) element constraints like `<a: Hash>` in its own signatures as needed. Complete, and the whole tax is one small instance. The recipe is normative, with the worked `Bag(a)` example, at Part 5 §8.

---

## 7. Operator boundaries

- **`++` is `Concat` and means sequence concatenation only**: `String ++ String`, `Vector ++ Vector`. The `Concat<Vector(a)>` instance and its emitted behavior (linear trie concatenation; multi-arg fusion as an emitter freedom) are normative in Part 3 §8, discharging the Operators §7 owed instance.
- **No `++` for `Set` or `Map`.** Set union is not concatenation; use `Set.union` / `Set.intersect` / `Set.difference`. Map combination is named (`Map.merge` family — a stdlib-listing surface, ledgered in `stdlib-roadmap.md`).
- No new operators of any kind (existing doctrine: no user-defined operators, no operator overloading beyond constraint-backed `++`).

---

## 8. Reserved anchor

Canonical decisions are stated in §§1–7; no duplicate summary is maintained.

## 9. Reserved anchor

No open questions remain in this part; their final rules live in Collections Parts 2–5.

---

## 10. Correction records

Recorded per house rule (`method-syntax.md` §16 precedent): origin, rationale, consequences with owners, rejected alternatives marked do-not-relitigate. Section numbers everywhere are stable; the body text each record amends carries a pointer to it.

### 10.1 The 2026-08-02 naming ruling: `Seq.prepend`, and the `length`/`size` split

Ruled by James, 2026-08-02. Two renames of different characters, one argument-order consequence, and one explicit non-rename.

**(a) `Seq.cons` → `Seq.prepend` — enforcement, not amendment.** §3.1 banned `cons` from the day it was decided ("no ancient LISP words" — James, restating the row's own rationale); `stdlib/Seq.hex` shipped the export anyway, and no audit caught the violation until this ruling. The rename discharges a landed decision rather than changing one. Nothing in §3.1's banned-families row moves.

**(b) `Vector.size` → `Vector.length`, and `Array.size` → `Array.length` — a genuine amendment.** §3.1's chosen vocabulary listed a single `size`, and that word never described the corpus: `String.length` (Primitive Types §5.1) and `Seq.length` (`stdlib/Seq.hex`) shipped as `length` long before this ruling; only `Vector` and `Array` obeyed the written doctrine. The amendment replaces the single word with a **hierarchy, not two coordinate words** (James: *"length is for 'linear' items like Array, Seq, Vector — they use length; size is the general word, used by Map, Set and any non-linear collection"*), now stated in §3.1:

> **`size` is the general word** — the cardinality reader of `Map`, `Set`, and any non-linear collection. A future collection defaults to `size`.
> **`length` is the specialization for linear, ordered structures** — `String`, `Seq`, `Vector`, `Array`.

`Array` entered by James's in-session amendment when the residual inconsistency was put to him ("Array should also use length, no size"). `Map.size` and `Set.size` are correct under the rule and unchanged. The split is also the host platform's own — JavaScript reads `Array.prototype.length` and `String.prototype.length` against `Map.prototype.size` and `Set.prototype.size` — so the audience's habits already encode it; the amendment makes the doctrine describe both the corpus and the reflexes it serves (§3.2's standard, met rather than asserted).

**(c) `prepend` is subject-first: `Seq.prepend(rest: Seq(a), value: a)`.** The rename is not a transliteration of `cons(value, rest)` — the argument order flips, and the flip is the load-bearing half. `cons` was the *only* non-subject-first export in `stdlib/Seq.hex` (`next(source)`, `map(source, transform)`, `take(source, count)`, … are all subject-first), and dot-call desugaring makes the old order a trap: `s.prepend(x)` puts the receiver in parameter 1 (Method Syntax §2.1), so a value-first `prepend` would desugar to "prepend the sequence `s` onto `x`." In the ordinary case (`s : Seq(a)`, `x : a`) that is a **type error**, not a silent wrong answer; only at `s : Seq(Seq(t))`, `x : Seq(t)` does it type-check and quietly build the wrong sequence. Subject-first closes both doors, and `Seq.prepend(rest, value)` now agrees in shape with `Vector.prepend(values, value)`, which was born subject-first — one word, one shape, both sequences.

**Consequences, with owners:**

- Collections Part 3 §7's core-surface row is renamed in place with an amendment marker; the compiler/runtime-boundary paragraph there already covers that `Vector.length` is a compiler-known core operation (checker and emitter name it), so no further Part 3 surface changes.
- FFI Part 2 §6.3's specialized `.length` diagnostic **changes character** under the rename — the sharp edge of this ruling. The diagnostic survives, re-scoped and re-justified; the ruling lives in FFI Part 2 §13.1.
- Identifier occurrences in code samples across `method-syntax.md`, `decisions-ml-dialect-generalization-2026-08.md`, `notes/ml-generalization-variance-handoff.md` (the living acceptance program), and `notes/seq-core-representation.md` / `notes/seq-hex-next-phase-handoff.md` (present-tense surface inventories) are updated in place.
- **A diagnostic regression on un-imported `Vector` receivers — a known cost of the rename, taken with eyes open and not fixed here (owner: `hexc` diagnostics — issue #217).** The rename puts `length` and `prepend` into the prelude term namespace (they are `Seq.hex` exports), and dot-call resolution on a `Vector` receiver never reaches `Vector`'s compiler-core operations. Before the rename those names bound nothing, so `[1,2].size()` failed *cleanly*, with the Rewrite-Rule message "the companion of `Vector(…)` has no operation `size`; call an available subject-first function explicitly" (verified at the branch point). Now the call **binds — to the wrong companion**: `[1,2,3].length()` reports "type mismatch: expected `Seq(…)`, found `Vector(…)`", and `[1,2].prepend(0)` the analogous mismatch, instead of a message naming the fix. The control confirming the mechanism: `[1,2].isEmpty()`, whose name is not a `Seq` export, still gets the clean message. Bounded, stated precisely: this is **never a wrong answer** — `Seq.prepend`'s and `Seq.length`'s subjects cannot unify with `Vector(a)`, so the call always errors loudly — and it bites only while `stdlib/Vector.hex` is unimported; with `import * as Vector` *(era spelling; #565)* the module occludes the provisional compiler companion (Part 3 §7) and `[1,2,3].length()` compiles clean. The degraded message is a Rewrite-Rule debt this ruling takes on; it is recorded here so the fix is owed, not rediscovered. Filed as **#217**, which also records that the same root cause — dot call not reaching the collection cores — is what makes `[1,2].append(3)` crash (#212). **Resolved at the Vector milestone**: `stdlib/Vector.hex` is a prelude member, dot-call dispatch is type-directed (Method Syntax §4.2), and `[1,2,3].length()` compiles as `Vector.length` — the debt this paragraph records is discharged, and the "provisional compiler companion" it cites no longer exists (Part 3 §7 now states the prelude-membership rule).
- **Era syntax stands in era records** (the #179 principle: reproduce era claims in era syntax). `notes/value-restriction-and-variance.md`'s specimens are *observed runs* — its recorded diagnostics were produced by `cons(value, rest)`-era programs, and renaming the specimens would detach observed messages from the programs that produced them; they keep era syntax with an annotation. `collections-roadmap.md` (Completed, historical) likewise keeps its era spelling — `size` in its Part 3 plan listing. These residual `cons`/`size` occurrences are deliberate, not missed.

**Out of scope, recorded so it is not rediscovered as a defect:**

- **`IndexError(index: Int, size: Int)` keeps its `size` payload slot** — ruled by James, with the hierarchy of (b) as the reason. `IndexError` is a single shared prelude declaration (Part 3 §5.5), and nothing scopes it to linear structures; since `size` is the general word and `length` the linear specialization, a slot named `length` would assert a linearity the declaration does not have. The slot also names a fact about the collection ("the collection's size at fault time," Part 3 §5.5), not the operation that read it. The generality is anticipation, not description: **today every `IndexError` thrower happens to be linear** — `Vector` (Part 3 §5), `String` (Part 3 §9), `Array` (FFI Part 2 §6.3); `Map` throws the nullary `KeyError` (Part 4 §4.3), not `IndexError` — but §4 pre-registers `SortedMap`/`SortedSet` for v2, and an indexed non-linear collection that ever throws `IndexError` would make a `length` slot already wrong. The residual mismatch — `Vector.length` throws `IndexError(index, size)` — is the specialization reading through to the general declaration, not an oversight; do not "fix" the slot on the observation that all current throwers are linear.
- Representation-private internals are untouched: `runtime/VectorTrie.hex`'s 0-based `size`, and Part 3 §3.6's emission sketch that mirrors it, are behind the compiler/runtime boundary and invisible at the source level.
- Prose uses of "size" as an ordinary English noun remain prose.

**Rejected alternatives (do not re-litigate):**

- **Grandfathering `Seq.cons`.** A shipped violation does not amend a spec by accident; the ban is the decision, and enforcement is the cheapest it will ever be.
- **One word everywhere** — `size` universally (as §3.1 was written) or `length` universally. `length` on `Map`/`Set` implies an ordering that does not exist; `size` on ordered structures fights `String.length`/`Seq.length` as shipped and the platform cognates the audience carries. The split states its convention to a modern reader on first contact.
- **Value-first `prepend(value, rest)`**, preserving `cons`'s order under the new name: the dot-call inversion of (c). Rejected precisely because the ordinary-case failure is loud but the `Seq(Seq(t))` case is silent.
- **Renaming the `IndexError` payload slot to match**: explicitly excluded by James in the same ruling.

