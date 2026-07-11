# Hexagon Spec: Collections Part 1 — Foundational Decisions

**Status:** Decided (July 2026). First completed part of the Collections roadmap (see `collections-roadmap.md`). This is a **decisions document**, not the full Collections spec: it fixes the names, representations, key model, naming doctrine, and the v1 iteration story, so that the remaining parts are written against settled ground. Authoritative for everything it decides; it **amends** Decisions Batch 2026-07 §6 and Loops §11.1 where noted (§6.4 here).
**Scope:** The `Vector(a)` name and the reservation of `List`; representation and complexity contract; the collections naming doctrine; the uniform keyed-access partiality doctrine (`[]` throws, `get` is total); the Map/Set key model (`Hash`, hash-tried, not `Ord`-tree); `Hash` as a v1 derivable-only constraint (direction); restricted user-implementable `Iterable` in v1 (direction); `Seq` as the universal conversion currency; operator boundaries (`++`).
**Not in scope:** The full API surface (Part 5 / Stdlib listing); indexing `[]` and literals/patterns for the new names (Part 3); `Map`/`Set` instances and iteration-order fine print (Part 4); the `Hash` constraint's formal spec and the `type`-member grammar in `constraint`/`implement` (Part 2); transients (Part 5); anything async.
**Companions:** FFI agenda (its `List(a)` entry is renamed by §1); Loops/Ranges/Iteration (§5 table, §7.2 sketch adopted, §11.1 amended); Decisions Batch 2026-07 (§1.4 `Hash<Float>` inherited and activated, §5 partiality inherited, §6 amended); Constraints (orphan rule, coherence, derivation whitelist — Part 2 will edit); Modules (§7 instance globality relied on); Pattern Matching (§11.1 list-pattern hole becomes vector patterns, Part 3); Operators (§7 `Concat` owed instance discharged in direction); Exceptions (gains `KeyError` as `IndexError`'s sibling, §3.3 — fine print owed by Part 4).

Written for a future implementation session against the existing `hexc` architecture: Algorithm J, union-find tyvars, dictionary passing, whole-program compilation, readable-JS emission with `.d.ts`, `@hexagon/runtime`.

---

## 1. The workhorse sequence is `Vector(a)`; `List` is reserved

### 1.1 The decision

- The persistent indexed sequence formerly discussed as `List(a)` is named **`Vector(a)`**.
- **`List` is a reserved stdlib name**: no v1 type carries it, and user code cannot claim it (it lives in the prelude namespace layer as a reserved companion-module name). It is held for a possible v2 classic cons list, to be shipped only on demonstrated demand.

### 1.2 Rationale

`List` means something specific in the ML/Haskell/Elm lineage: a cons cell — O(1) prepend and head/tail sharing, O(n) index. Hexagon deliberately does not ship that structure, and naming the trie `List` would invite exactly the wrong idioms from FP-experienced users (head/tail recursion patterns against a structure whose costs are inverted). `Vector` has direct precedent for *this exact data structure* (Scala's immutable `Vector`, Clojure's vector) and the Rust-shaped tiebreak concurs (`Vec` = indexed growable sequence). It also makes the honest complexity story easier to tell: nobody expects `++` on a vector to be O(1).

### 1.3 Rename ripple (edit notes)

- **FFI agenda item 1**: `List(a)` → `Vector(a)`; content otherwise unchanged (runtime-owned trie, Immutable.js as private backend/oracle).
- **Loops §5 iterable table**: row renamed.
- **Pattern Matching §11.1**: the deliberately-left hole is now **vector patterns**; Part 3 owns them (semantics expected unchanged in shape, cost story restated — §8.3 here).
- **Roadmap, Decisions Batch, TS-coders guide**: textual renames on next touch; no semantic edits.

### 1.4 Rejected alternatives (do not re-litigate)

- **Keep `List`** for the trie: wrong intuitions imported by the exact audience segment (FP-experienced) most likely to act on them; complexity documentation fights the name forever.
- **Free the name `List`** (unreserved): invites an ecosystem package to claim it with arbitrary semantics; reservation is nearly free and preserves the v2 option cleanly.
- **`Array`**: taken — it is the readonly foreign-door type at the FFI boundary, and the distinction between the two is load-bearing.

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

Immutable.js (MIT) remains the temporary private backend option and the property-testing oracle, per the FFI agenda entry.

---

## 3. Naming doctrine for collection APIs

### 3.1 The decision

Hexagon collection names are **modern functional, subject-first, self-describing**. Hexagon is not a copy of JS (it compiles *to* JS), and it is not a LISP or Haskell museum. Concretely:

**Banned name families:**
- LISP/Clojure lineage: `cons`, `snoc`, `conj`, `assoc`, `dissoc`.
- Haskell lineage where an ordinary word exists: `lookup`, `insert` (for map write), `member`.
- JS mutation pairs: `push`, `pop`, `shift`, `unshift` (`pop` is uniquely cursed — the ecosystem disagrees on whether it returns the element or the collection). These names stay on the JS side of the fence.
- `has` (JS-ism): `contains` reads uniformly across `String`, `Vector`, `Set`.

**Chosen core vocabulary (binding, not exhaustive):**
- `get` / `set` / `remove` for keyed access and update; `get` is always total and `Option`-returning (never a JS-ish absence value), with `[]` as its throwing counterpart — the uniform accessor pair, §3.3.
- `contains` (Set membership), `containsKey` (Map; leaves room for a deferred `containsValue`, avoids false cognates).
- `add` (Set), `append` / `prepend` (Vector ends), `dropFirst` / `dropLast`.
- `first` / `last` return `Option(a)` (no exceptions for emptiness).
- `union` / `intersect` / `difference` / `isSubsetOf` (Set algebra, named — see §7).
- `empty`, `singleton`, `isEmpty`, `size`.
- `Map.fromEntries` with **last value wins** on duplicate keys (matches JS `Map` construction instinct; easy to state).
- **Uniform conversion suite**: every collection provides `toSeq` and `fromSeq` (for `Map`: `Seq((k, v))`), mechanically named, alongside `Map.keys` / `Map.values` / `Map.entries`.

### 3.2 Rationale

Same move as `mod`/`rem` over `%`: names that state their convention to a modern reader, with no lineage tax. The audience is senior TS developers; the doctrine gives them words they can read on first contact while remaining honestly functional (persistent, value-returning, `Option`-shaped).

### 3.3 The uniform accessor pair: `[]` throws, `get` is total

**The decision.** Every keyed collection offers both a panicking and a non-panicking read accessor, and the split is the same everywhere:

- **`[]` is the partial, throwing accessor**: `vec[i]` throws `IndexError` on an out-of-range index (Decisions Batch §5, unchanged); `map[k]` throws **`KeyError`** on an absent key. Read-only — `[]` never appears in write position (persistent values; updates are `Vector.set` / `Map.set`).
- **`get` is the total, `Option`-returning accessor**: `Vector.get(v, i): Option(a)`; `Map.get(m, k): Option(v)`.
- Slicing continues to clamp (Decisions Batch §5) — slices are total by design and outside this pair.

This largely pre-answers the Part 3/4 `[]` question in direction; Parts 3/4 own the syntax and the `KeyError` fine print.

**Rationale.** The programmer should get the choice of panicking or not, and one rule covering all keyed access is simple, generalisable, and teachable: *brackets can throw; `get` cannot.* It is exactly Rust's split (`v[i]` panics, `v.get(i)` returns `Option`) extended to maps the Python way (`d[k]` raises `KeyError`, `d.get(k)` is safe) — both on-lineage precedents, and both instantly legible to the target audience. It also gives the `Option`-averse an honest escape hatch that is visibly partial at the call site.

**Doctrine (binding stdlib-wide): the `try` prefix, if ever used, means "does not throw."** C#'s `TryGetValue`, F#'s `Map.tryFind`, and Rust's `try_` all mark the *safe* variant; a Hexagon `tryX` that throws would invert a reflex for the TS and FP audiences simultaneously. Since `get` already occupies the safe slot, the prefix is expected to stay unused — this doctrine exists to keep a `tryX`-that-throws from ever slipping into the stdlib.

**Rejected alternatives (do not re-litigate):**
- **`Map.tryGet` as the throwing accessor**: `try` universally signals non-throwing across the reference languages; maximally confusing name.
- **A named `Map.getOrThrow` instead of `map[k]`**: honest but forfeits the unifying rule; two types, two conventions. (A `getOr(m, k, default)` convenience remains available to the Part 5 / Stdlib-listing surface decision.)
- **`map[k]` returning `Option(v)`**: makes `[]` mean "total" on Map and "throws" on Vector — the exact inconsistency the pair exists to prevent.

---

## 4. Map and Set are hash-based; `Hash` ships in v1, derivable-only

### 4.1 The decision

- `Map(k, v)` and `Set(a)` are **hash-tried persistent collections (HAMT lineage)** provided by `@hexagon/runtime`.
- Their key/element constraint is **`Hash`**, which **ships in v1** as a constraint with these properties (formal spec: Part 2):
  - `Hash` has `Eq` as a superconstraint (`Hash` implies `Eq`).
  - `Hash` is **derivable-only for user code**: it joins the derivation whitelist; users cannot hand-write `implement Hash<T>`. The stdlib may bless instances for its own types (primitives, and collection types per Part 4) — "derivable-only" constrains users, not the stdlib.
  - `Hash<Float>` obeys Decisions Batch §1.4 exactly: `-0` hashes as `+0`, all `NaN`s hash to one value. That pre-registered constraint is hereby **activated**.
- Signatures follow the Set/Map sketch: `Map.get<k: Hash>(map: Map(k, v), key: k): Option(v)`, `Set.add<a: Hash>(set: Set(a), value: a): Set(a)`, etc.
- Iteration order is **deterministic but unspecified** (fixed by the structural hash; stable within a program; not insertion order, not sorted). Part 4 owns the fine print.
- **`SortedMap` / `SortedSet` (`Ord`-keyed trees) are pre-registered as v2-on-demand counterparts** — the Rust `HashMap`/`BTreeMap` pairing.

### 4.2 Rationale

The corpus already leans hash-shaped, decisively:

1. **`Eq<Float>` = SameValueZero was chosen specifically for Map/Set key coherence** (Decisions Batch §1.2). That decision earns its keep only if Hexagon's Map/Set have JS-Map-like key semantics; an `Ord`-tree map never consults SameValueZero.
2. **Decisions Batch §1.4 pre-registered `Hash<Float>` semantics** "if Hash ever ships" and confirmed the Immutable.js substrate is already compliant. The door was deliberately open; "not v1 user-facing" was a deferral, not a rejection — and the derivable-only form keeps the *user-facing surface* it worried about minimal.
3. **The Rust-shaped tiebreak**: Rust's default map is `HashMap`; the ordered tree is the opt-in. The "functional collections are `Ord`-based" impression is the ML/Haskell/Elm/F# tree tradition only — Clojure, Scala, and Roc (the languages closest to Hexagon's runtime story) all default to HAMTs.
4. **`Ord`-keyed maps overtax key types**: a record key would need a total order it has no natural claim to. `Hash`+`Eq` is the genuinely weaker requirement, and the whitelist derivation covers records/unions structurally.
5. **Audience**: senior TS developers expect maps to be hash-like and do not expect sorted iteration.

**Coherence hazard, resolved by construction:** a hand-written `Eq` that disagrees with the internal hash silently corrupts a hash map. Derivable-only `Hash` makes the hazard unwritable: every `Hash` instance a user can obtain is compiler-derived, structurally consistent with the derived `Eq` it implies.

**On JS conversion (recorded because it caused confusion):** `Map → JsMap` is O(n) iteration under *either* key model; the emitted JS `Map` simply inherits the iteration order. The real impedance mismatch — JS `Map` uses reference identity for object keys, Hexagon uses structural `Eq` — exists identically under `Ord`-trees, so it does not discriminate. If anything the hash design converts more faithfully: primitive-key semantics (SameValueZero) match JS exactly. Part 4 owns the boundary conversions.

### 4.3 Rejected alternatives (do not re-litigate)

- **`Ord`-keyed balanced trees as the v1 default** (the Haskell `Data.Map` / OCaml / Elm `Dict` / F# `Map` shape): rests on the non sequitur "no public `Hash` constraint ⟹ must be `Ord`"; forfeits the SameValueZero anchoring; taxes record keys with an unearned total order; surprises the target audience with sorted O(log n)-with-tree-constants maps. Sorted collections return as v2 `SortedMap`/`SortedSet` if demanded.
- **Anonymous runtime structural hashing with no constraint in signatures** (the literal Immutable.js model): mechanically workable — the runtime can hash any compiled Hexagon value — but hides a real requirement from the types. `Map.set` demanding `<k: Hash>` is the honest signature; hiding it is not very Hexagon.
- **User-implementable `Hash` in v1**: reopens the hash/`Eq` coherence hazard the derivable-only form exists to close, for no v1 customer. Revisit in v2 alongside `Hash` on user collection types (§6.3).

---

## 5. `Seq` is the universal currency (confirmation, not change)

`Seq(a)` (Loops §6) is already the public, concrete, lazy common-currency sequence with the functional-cursor protocol. This document adds only the **uniform conversion invariant**: every stdlib collection ships `toSeq` / `fromSeq` (§3.1), and third-party collections are expected to do the same (§6). Nothing in Loops §6 changes. `Seq` still does not cross the FFI boundary in v1 (FFI agenda item 7, unaffected).

---

## 6. User-implementable `Iterable` ships in v1, restricted

### 6.1 The decision

**"You can write a real collection" is a v1 requirement, and `for x in myBag` is its floor.** v1 therefore ships user-implementable `Iterable` in the following restricted form:

- The `constraint Iterable` / `implement Iterable` shape is the Loops §7.2 sketch **verbatim** — `type Elem` member, `iterate(xs: c): Seq(Elem)`, `type Elem = a` on the implement side — so the v2 associated-types spec is a pure widening, never a migration.
- `implement Iterable<Bag(a)>` adds a row to the (formerly compiler-internal) Loops §5 iterable table. Resolution is unchanged: `for x in e` requires `e`'s head type constructor to be known; unique instance looked up (coherence + orphan rule); element type read off the instance. **The unsolved-tyvar case remains the same error as today** ("annotation required").
- Instances are global per Modules §7; `import "./bag"` anywhere in the graph suffices.
- **v1 restrictions, stated plainly:** `Elem(c)` is not referenceable in user type expressions, and `Iterable` cannot appear as a constraint binder on user functions. Functions generic over "any iterable" remain unwritable in v1; `Seq(a)` parameters remain the idiom (Loops §7.1 seam, unchanged).

### 6.2 Rationale

The Decisions Batch §6 / Loops §11.1 deferral protected against a specific risk: **deferred `Elem(α)` goals in inference** — the machinery for generic-over-any-iterable functions, the first feature that would touch `unify`'s environs. `for x in myBag` needs none of it: head-constructor-known table lookup is exactly how the internal table already works (it was always a functional-dependency table). Opening the table to `implement` is parser-and-bookkeeping work — real spec surface (the `type`-member grammar, Part 2), zero inference changes. And the calibration specimen the deferral said it was waiting for now exists: the first user-defined collection.

### 6.3 What stays v2 (unchanged in substance)

Deferred `Elem(α)` goals; `Elem(c)` in user type expressions; obligations on associated types (`type Elem: Show`); `Hash` instances on user-defined collection types (a bag as a map key — niche; interim workaround: convert to a canonical `Vector` key). The v2 associated-types spec inherits all of it.

### 6.4 Amendments (edit notes)

- **Decisions Batch 2026-07 §6** ("associated types not in v1"): amended, not contradicted — the recorded rationale (inference machinery) does not apply to the §6.1 restricted form, which is hereby carved out as v1. The full feature remains v2.
- **Loops §11.1**: the "user types join the table via `implement`" line is promoted from v2 sketch to v1 (restricted); §9.5's rejections unaffected. **Loops §8 diagnostics**: "`τ` is not iterable" keeps its conversion hint and gains "or `implement Iterable<τ>`" where τ is a user nominal type.
- **Roadmap Tier 3**: associated-types entry re-scoped to the §6.3 remainder.

### 6.5 The "so you're writing your own collection" recipe (to appear in the final spec)

A proper third-party collection in v1: (1) `toSeq` / `fromSeq` as ordinary functions; (2) one `implement Iterable` instance delegating to `toSeq` — this is `for..in`; (3) element constraints like `<a: Hash>` in its own signatures as needed. Complete, and the whole tax is one small instance.

---

## 7. Operator boundaries

- **`++` is `Concat` and means sequence concatenation only**: `String ++ String`, `Vector ++ Vector`. This discharges (in direction) the Operators §7 owed instance, retargeted from `List` to `Vector`.
- **No `++` for `Set` or `Map`.** Set union is not concatenation; use `Set.union` / `Set.intersect` / `Set.difference`. Map combination is named (`Map.merge` family — surface deferred to Part 5 / Stdlib listing).
- No new operators of any kind (existing doctrine: no user-defined operators, no operator overloading beyond constraint-backed `++`).

---

## 8. Decisions log

| # | Decision | § |
|---|---|---|
| 1 | Workhorse sequence named `Vector(a)` | §1 |
| 2 | `List` reserved (possible v2 cons list, on demand only) | §1 |
| 3 | Trie deque, both-ends O(1) amortized; complexity table pinned | §2 |
| 4 | RRB rejected for v1; `++` documented linear; v2-maybe on benchmarks | §2.2 |
| 5 | Naming doctrine: modern functional, subject-first; LISP/Haskell/JS-mutation names banned | §3 |
| 6 | `contains`/`containsKey`, `get`→`Option`, `first`/`last`→`Option`, `fromEntries` last-wins | §3.1 |
| 7 | Uniform accessor pair: `[]` throws (`IndexError`/`KeyError`), `get` total and `Option`-returning, everywhere | §3.3 |
| 8 | `try` prefix, if ever used, means "does not throw" (stdlib-wide doctrine) | §3.3 |
| 9 | Uniform `toSeq`/`fromSeq` on every collection | §3.1, §5 |
| 10 | `Map`/`Set` are hash-tried (HAMT); `Ord`-tree default rejected | §4 |
| 11 | `Hash` ships v1: derivable-only for users, implies `Eq`, §1.4 Float rules activated | §4.1 |
| 12 | Iteration order deterministic-but-unspecified; `SortedMap`/`SortedSet` pre-registered v2 | §4.1 |
| 13 | User-implementable `Iterable` in v1, restricted (no `Elem(c)` in type exprs, no `Iterable` binders) | §6 |
| 14 | Decisions Batch §6 and Loops §11.1 amended accordingly | §6.4 |
| 15 | `++` = sequence concat only; no `++` for `Set`/`Map` | §7 |

## 9. Hanging questions (owned by later parts; recorded, non-blocking)

1. `[]` details: syntax integration, slice syntax, `KeyError`'s exact shape and home (Exceptions spec takes an edit note — `IndexError` sibling), whether `[]` extends beyond `Vector`/`Map` (e.g. `String` codepoint indexing) (Parts 3/4 — the *direction* is closed by §3.3).
2. `Vector` literals (`[1, 2, 3]` presumed) and vector patterns' cost story (`[x, ..rest]` — `rest` is a slice, not a shared tail) (Part 3).
3. `Map`/`Set` literals (leaning: none) (Part 4).
4. Instances on the collections themselves: `Eq<Vector>`, `Ord<Vector>` (lexicographic?), `Eq<Map>`/`Eq<Set>` (order-independent — needs definition), `Show`, and stdlib-blessed `Hash<Vector(...)>` etc. (Part 4, with Part 2's wording enabling stdlib blessing).
5. Collections-spec vs Stdlib-listing boundary for the combinator surface (`map`/`filter`/`fold`/`update`/`merge`); leaning: types/representation/key model/`Iterable`/`[]`/literals here, combinators to the Stdlib listing (Part 5).
6. Transients (`withMutations`-style): leaning runtime-internal only (Part 5).
7. Sequencing vs FFI: this part edits the FFI agenda regardless; either order now works (roadmap doc).
