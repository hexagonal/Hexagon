# Hexagon Spec: Collections Part 4 — `Map(k, v)` & `Set(a)`

**Status:** Decided (July 2026). The authoritative specification of the persistent hash-backed keyed collections: representation and honest complexity, construction (no literals; the `fromVector` convenience), the keyed-access family (`map[k]`, `KeyError`, `Map.get`), the upsert/forgiving update doctrine, representative retention, set algebra, the iteration-order contract (grounded in Part 2 §2.4), the `Eq`/`Show`/`Hash` instances and the deliberate absence of `Ord`, the core API, and the semantic ground rules for the JS boundary (conversions specified in FFI Part 10). Written against Collections Parts 1–3, Constraints, Exceptions, Pattern Matching, Loops, and Modules; none re-litigated.
**Scope:** As above, plus: the `KeyError` declaration (nullary); the `Map.set`-vs-`Vector.set` semantic split stated as doctrine; the **representative-retention rule** (first wins / left wins — §5.4); `keys`/`values`/`entries` correspondence; `fromEntries`/`fromSeq` and `entries`/`toSeq` synonym pairs; the JS→Hexagon key-collapse rule.
**Not in scope:** The combinator surface (`Map.update`/`merge`/`mergeWith`/`filter`/`mapValues`, `Set.map`/`filter`, `getOr`, `containsValue` — `stdlib-roadmap.md`; boundary decided in Part 5 §10); the normative `Iterable` operational spec, table-opening, and the `Bag` worked example (Part 5); transients (Part 5 §11 — runtime-internal only); the JS conversion *functions* themselves and their failure machinery (`toJsMap`/`fromJsMap`/`toJsSet`/`fromJsSet`, `JsConversionError`, cycle paths — FFI Part 10/Part 11; this doc pins the semantic ground rules, §10); `SortedMap`/`SortedSet` (pre-registered v2, Part 1 §4.1).
**Companions:** Collections Part 1 (§3 naming doctrine applied; §3.3 accessor pair instantiated for `Map`; §4 key model made operational; §7 operator boundaries restated); Collections Part 2 (§2.4 split determinism consumed as the iteration-order ground truth; §4.4 wording used for all instances); Collections Part 3 (accessor-family symmetry maintained and deliberately broken at `set`, §5); Exceptions (owed the `KeyError` declaration, §14; §2 no-polymorphic-payload rule is why it is nullary); Pattern Matching (loop heads are pattern positions — `for (k, v) in m`, §7.2); Loops (§2.1 loop heads; §5 table `Map`/`Set` rows); Modules (§6.4 qualified homes: `Map`/`Set` companion modules); FFI Part 10 (`JsMap`/`JsSet` and the boundary conversions); Operators (§7: no `++` for `Map`/`Set`; §14 bracket grammar); Constraints (§4.3 parameterized instances; §7 `Eq<Float>` = SameValueZero).

---

## 1. Doctrine

- **`Map` and `Set` are hash-backed and say so.** `<k: Hash>` / `<a: Hash>` in every signature that consults keys — the honest signature Part 1 §4 demanded. Operations that never touch a key (`size`, `isEmpty`, `keys`, `values`, `entries`, `toSeq`) carry no constraint.
- **Vector positions exist or don't; map keys are yours to mint.** `Vector.set` asserts a slot; `Map.set` inserts-or-replaces and never throws. The same name carries the same *direction* (keyed write) with the semantics each structure honestly has (§5.1).
- **Brackets retrieve; they never ask Boolean questions.** `map[k]` asserts presence and throws `KeyError`; `Map.get` answers with `Option`. `Set` has no brackets at all — membership is `contains` (§4.4).
- **Removal requests; it does not assert.** `Map.remove`/`Set.remove` on an absent key return the collection unchanged — the `dropFirst` forgiving family, and idempotent (§5.2).
- **Iteration order is deterministic within one execution, and intentionally nothing more.** Table placement is seeded (Part 2 §2.4); the order is a property of a collection value within a process, not of its contents, and not of any prior run (§7.1).
- **Costs are stated, not hidden.** Expected logarithmic, with the collision worst case named; set algebra is expected-linear in a named side; no structural-merge promise (§2.2).

---

## 2. Types, representation, complexity

### 2.1 The types

`Map(k, v)` and `Set(a)` are persistent **hash array mapped tries (HAMT lineage)**, owned and implemented by Hexagon in `@hexagon/runtime` (Part 1 §4.1). The API is representation-silent; the spec pins the complexity contract and nothing structural. Immutable.js is lineage/influence and a property-testing **oracle** — for the public hash function and observable semantics only; it is not a backend, private or otherwise, and nothing here is defined by reference to its behaviour. Table placement is seeded per Part 2 §2.4 and is not oracle-constrained.

Entries are placed by `mix(processSeed, hash(k))`-shaped internal mixing (Part 2 §2.4). The hash law (Part 2 §2.3) guarantees equal keys land together under any one seed; nothing else about placement is observable or promised.

### 2.2 Complexity contract

| Operation | Bound |
|---|---|
| `get` / `set` / `remove` / `containsKey` / `contains` / `add` | **expected O(log₃₂ n); worst-case O(n) under hash collisions** |
| `size` / `isEmpty` | O(1) |
| iteration (`toSeq`, `keys`, `values`, `entries`, `for..in`) | O(n) |
| `union(a, b)` | expected O(min(m,n) · log₃₂(m+n)) — traverses the smaller side, inserting into the larger |
| `intersect(a, b)` | expected O(min(m,n) · log₃₂ max(m,n)) — traverses the smaller side, probing the larger |
| `difference(a, b)` | expected O(size(a) · log₃₂ size(b)) — traverses the **left** side, probing the right |
| `isSubsetOf(a, b)` | expected O(size(a) · log₃₂ size(b)) |
| `fromSeq` / `fromEntries` / `fromVector` | expected O(n log₃₂ n) total; eager (§3.4) |

Notes, normative where bolded:

- **"Expected" is load-bearing.** Distinct unequal keys may lawfully share a hash (Part 2 §2.3 disclaims the converse of the law); colliding keys share a collision node whose operations are linear in the number of colliders. The seed defends placement against manufactured *bucket* collisions (Part 2 §2.4), but cannot separate values whose public hashes are genuinely equal. No collision-free worst-case logarithmic promise exists or is implied.
- **No structural-merge promise.** Set algebra is specified as iterate-one-side-and-modify; a future runtime is free to do structural HAMT merging (the representation-silent upgrade path, same shape as Part 1 §2.2's RRB stance), but no source-visible contract changes.
- The traversal side named in each row is normative *for the bound only* — which side's size dominates — not for iteration-order or any other observable.

---

## 3. Construction

### 3.1 No literals

**`Map` and `Set` have no literal syntax in v1.** `{…}` is permanently records; `[k: v]`-style forms would complicate the bracket grammar Part 3 §2 settled, for two types whose construction is rarely hot in source. Rejected alternative §12.1. Construction is by name:

```
let empty  = Map.empty                                -- Map(k, v), generalizes
let one    = Map.singleton(1, "one")                  -- Map(Int, String)
let m      = Map.fromVector([(1, "one"), (2, "two")]) -- Map(Int, String)
let s      = Set.fromVector([1, 2, 3])                -- Set(Int)
```

### 3.2 `fromVector` — the convenience constructor

`Set.fromVector<a: Hash>(xs: Vector(a)): Set(a)` and `Map.fromVector<k: Hash>(xs: Vector((k, v))): Map(k, v)` are **core** (not stdlib-listing). One hop from the vector literal is the practical construction idiom; without it the honest spelling is `Set.fromSeq(Vector.toSeq([1, 2, 3]))`, which taxes every call site for a purity the doctrine never demanded — `Seq` is the universal *currency* (Part 1 §5), not a toll booth.

Definitional equivalences (no special semantics, including duplicate handling):

```
Set.fromVector(xs) ≡ Set.fromSeq(Vector.toSeq(xs))
Map.fromVector(xs) ≡ Map.fromSeq(Vector.toSeq(xs))
```

### 3.3 Duplicates: last value, first representative

`Map.fromEntries` keeps the **last** value for a duplicated key (Part 1 §3.1). "Last" means last in the traversal order of the source sequence — well-defined because `Seq` traversal order is the sequence's own. Via §3.2's equivalences, `Map.fromVector` inherits it left-to-right. `Set.fromSeq`/`Set.fromVector` on duplicate elements keep one occurrence — and *which* occurrence is observable, because `equals`-equal values need not be indistinguishable (`equals(-0.0, 0.0)` is true; `show` tells them apart). The retained representative is the **first in source order**, per §5.4; the duplicated key's *key representative* in a `Map` is likewise the first, while its value is the last.

### 3.4 Synonym pairs; eagerness

- `Map.fromSeq` **≡** `Map.fromEntries` and `Map.toSeq` **≡** `Map.entries` — **definitional synonyms**, one implementation, two names. The redundancy is deliberate: the uniform conversion suite (Part 1 §3.1) and the domain vocabulary are both legitimate naming systems, and each pair costs one line.
- All `from*` constructors are **eager** (materialize the whole source); an infinite `Seq` diverges. Same one-line stance as `Vector.fromSeq` (Part 3 §7.2).

### 3.5 Empty values

`Map.empty : Map(k, v)` and `Set.empty : Set(a)` are polymorphic prelude constants; syntactic values, so they generalize normally (parallel to `[]` and nullary polymorphic constructors). **No `Hash` obligation**: constraints sit on operations that inspect, compare, hash, or place keys — emptiness does none of these.

---

## 4. Keyed access: `map[k]`, `get`, `KeyError`

### 4.1 The bracket

`m[k]` with `m : Map(k, v)`, `k : k`, requires `<k: Hash>` — yields the value; **throws `KeyError`** when the key is absent. The Part 1 §3.3 accessor pair, instantiated: brackets assert presence and fail loudly at the fault site. Read-only, as everywhere — `[]` never appears in write position; updates are `Map.set`.

Grammar: this is the same postfix bracket Operators §14 fixed and Part 3 §5 consumed; the element expression's type (`Int` vs `Range` vs the map's key type) selects the meaning during checking, not parsing. No new syntax.

### 4.2 `Map.get` — the total sibling

`Map.get<k: Hash>(m: Map(k, v), key: k): Option(v)` — `None` on absence, never throws.

### 4.3 The `KeyError` declaration

Declared here, housed in the prelude (edit note to Exceptions, §14):

```
exception KeyError
```

**Nullary — decided.** A polymorphic key cannot be a payload slot (Exceptions §2 bans type variables in payloads), and every alternative slot lies or taxes:

- `KeyError(key: String)` via `Show`-rendering would infect `[]` — and transitively every `<k: Hash>` polymorphic caller — with a `Show k` obligation, purely to decorate an exception. Constraint pollution for a diagnostic.
- `KeyError(size: Int)` is a lying slot: the map's size is not the fault; the absent key is, and it cannot be carried.

The asymmetry with `IndexError(index: Int, size: Int)` is principled, not accidental: `Int` indices are always payload-able; arbitrary keys aren't.

**Non-normative:** the runtime may include a best-effort diagnostic rendering of the key in the underlying JS `Error.message` (message rendering is the reporting layer's business — Exceptions doctrine). Programs must not parse or depend on that rendering.

### 4.4 What `Map` and `Set` do *not* get

- **No slicing — brackets never slice a `Map`.** Windows are positional (Part 3 §6's doctrine); maps have no positions. `m[e]` is always interpreted against the map's key type: when the key type is not `Range`, a `Range`-valued `e` is an ordinary type error; when the key type *is* `Range` and the required `Hash<Range>` instance exists, `m[r]` is an ordinary key lookup — never a slice. (Whether `Range` gets `Eq`/`Hash` at all is a stdlib-listing decision, ledgered in `stdlib-roadmap.md`; the no-slicing rule does not depend on it.)
- **No `Map.at`.** Signed addressing is from-*end* addressing; a map has no ends.
- **No `Set` brackets at all.** `s[x]` as a membership test would make `[]` answer a Boolean question — rejected (§12.2). Membership is `Set.contains`; brackets retrieve values associated with keys, and a set's elements *are* its keys, with nothing further to retrieve.

---

## 5. Update

### 5.1 `Map.set` is upsert

`Map.set<k: Hash>(m: Map(k, v), key: k, value: v): Map(k, v)` — persistent insert-or-replace; **never throws**.

This is the deliberate, stated break with `Vector.set` (which throws `IndexError` on a missing slot, Part 3 §5.4). The doctrine line: **Vector positions exist or don't; map keys are yours to mint.** A vector write to index 9 of a 3-element vector asserts a falsehood about a structure whose positions are fixed by its size; a map write at a fresh key is the ordinary act of populating a keyed structure — asserting prior existence would demand a separate insertion operation and import positional semantics into a structure that has none. Every reference language concurs (Rust `insert`, JS `set`, Python `[k] =`, F#/Haskell map insert — all upsert). Same name, same *direction* (keyed write), honest per-structure semantics; the doc states the pair side by side so nobody learns it by surprise.

`Set.add<a: Hash>(s: Set(a), x: a): Set(a)` — insert; adding a present element returns the set unchanged (idempotent).

### 5.2 `remove` is forgiving

`Map.remove<k: Hash>(m, key)` and `Set.remove<a: Hash>(s, x)` return the collection **unchanged** when the key/element is absent; they never throw. "Remove" names a request, not an assertion — the `dropFirst`/`dropLast` family (Part 3 §7.1/§11.4), with the pleasant algebraic consequence stated in the doc:

```
remove(remove(m, k), k) == remove(m, k)      -- idempotent
```

A caller who needs the assertion checks `containsKey` first or reads `m[k]` before removing — three intents (assert / ask / request), three named behaviours, exactly the Part 3 §7.1 consistency note extended.

### 5.3 Set algebra

`Set.union`, `Set.intersect`, `Set.difference` — all `<a: Hash>`, all total, complexity per §2.2, **left-representative retention per §5.4**. `Set.isSubsetOf(a, b)` is true iff every element of `a` is in `b` (`empty` is a subset of everything; every set is a subset of itself). Superset is flipped arguments; **no `isSupersetOf`** in the core (§12.3; stdlib-listing candidate at most).

**No `++`** for either type (Part 1 §7, restated): set union is not concatenation; map combination is the named `merge` family, ledgered in `stdlib-roadmap.md`.

### 5.4 Representative retention: first wins, left wins

`equals`-equal keys/elements are one map key or set element, but they need not be one *value*: `Eq<Float>` is SameValueZero (Constraints §7 — chosen precisely for this key model), so `-0.0` and `0.0` are the same key while remaining observably distinct — and the distinction propagates into any derived-`Eq` structure containing a `Float`, and later into wrapper key types (`CiString "Key"` vs `CiString "key"`, Part 2 §4.5). The collection must therefore say which concrete **representative** it physically retains. The rule:

> **A stored key or element representative is never replaced by an `equals`-equal newcomer.**

Consequences, normative:

- `Set.add(s, x)` where `contains(s, x)`: returns `s` **unchanged** — the stored representative survives. (§5.1's idempotence claim *is* this rule; a replace-on-add semantics would return a distinguishable set.)
- `Map.set(m, k, v)` where `containsKey(m, k)`: replaces the **value**, retains the stored **key** representative. The JS `Map` behaviour exactly, and the asymmetry is stated as one line: *values take last-wins; key representatives take first-wins.*
- `fromEntries`/`fromSeq`/`fromVector`: for duplicated keys/elements, the **first-inserted representative** survives (with the last value, for `Map` — §3.3).
- **Set algebra: the left operand's representative survives** for elements present in both sides (`union`, `intersect`; `difference` retains only left elements by definition). This is deliberately independent of §2.2's traversal-side freedom — that freedom was already scoped "for the bound only, not for any other observable"; a smaller-side traversal implements left-retention with insert-if-absent in one direction and insert-with-replace in the other. `Map.merge`'s key-representative rule rides with the `merge` family to the stdlib listing, bound by this section's doctrine.

Lineage: JS `Map`/`Set` and Python dicts retain the first key representative; the Immutable.js oracle concurs. In v1 the rule is observable only through SameValueZero-equated Floats (bare or embedded in structures); it becomes load-bearing the day the first wrapper key type ships.

---

## 6. Core API

Under the Part 1 §3 naming doctrine (subject-first; companion modules `Map`/`Set` per Modules §5.3, qualified homes per §6.4). The combinator surface is the stdlib listing's (Part 5 boundary decision); this is the core:

### 6.1 `Map`

| Function | Type | Notes |
|---|---|---|
| `empty` | `Map(k, v)` | §3.5, generalizes |
| `singleton` | `(k, v) -> Map(k, v)` | **unconstrained — decided** (§12.4); first placement occurs on first keyed operation |
| `isEmpty` | `Map(k, v) -> Bool` | |
| `size` | `Map(k, v) -> Int` | O(1) |
| `get` | `<k: Hash>(Map(k, v), k) -> Option(v)` | §4.2 |
| `containsKey` | `<k: Hash>(Map(k, v), k) -> Bool` | room left for a deferred `containsValue` (Part 1 §3.1) |
| `set` | `<k: Hash>(Map(k, v), k, v) -> Map(k, v)` | upsert, §5.1 |
| `remove` | `<k: Hash>(Map(k, v), k) -> Map(k, v)` | forgiving, §5.2 |
| `keys` | `Map(k, v) -> Seq(k)` | §7.3 correspondence |
| `values` | `Map(k, v) -> Seq(v)` | §7.3 |
| `entries` | `Map(k, v) -> Seq((k, v))` | ≡ `toSeq`, §3.4 |
| `fromEntries` | `<k: Hash>(Seq((k, v))) -> Map(k, v)` | last value, first representative, §3.3; ≡ `fromSeq` |
| `toSeq` / `fromSeq` | as `entries` / `fromEntries` | the uniform suite, §3.4 |
| `fromVector` | `<k: Hash>(Vector((k, v))) -> Map(k, v)` | §3.2 |

### 6.2 `Set`

| Function | Type | Notes |
|---|---|---|
| `empty` | `Set(a)` | §3.5, generalizes |
| `singleton` | `a -> Set(a)` | unconstrained, as `Map.singleton` |
| `isEmpty` | `Set(a) -> Bool` | |
| `size` | `Set(a) -> Int` | O(1) |
| `contains` | `<a: Hash>(Set(a), a) -> Bool` | membership; the only Boolean read |
| `add` | `<a: Hash>(Set(a), a) -> Set(a)` | §5.1 |
| `remove` | `<a: Hash>(Set(a), a) -> Set(a)` | forgiving, §5.2 |
| `union` / `intersect` / `difference` | `<a: Hash>(Set(a), Set(a)) -> Set(a)` | §5.3 |
| `isSubsetOf` | `<a: Hash>(Set(a), Set(a)) -> Bool` | §5.3 |
| `toSeq` / `fromSeq` | `Set(a) -> Seq(a)` / `<a: Hash> Seq(a) -> Set(a)` | |
| `fromVector` | `<a: Hash> Vector(a) -> Set(a)` | §3.2 |

`Map.singleton` is included (symmetry with `Set.singleton` and genuine utility — the one-entry map is common).

---

## 7. Iteration

### 7.1 The order contract

Grounded entirely in Part 2 §2.4; this section instantiates it for `Map`/`Set` and adds nothing:

> **Iteration order is deterministic but unspecified.** For a given collection value, repeated iteration yields the same order within one program execution. The order is **not** insertion order, **not** sorted order, **not** stable across program executions or compiler/runtime versions (table placement is per-process seeded), and **not a function of the collection's contents** — extensionally equal collections may iterate in different orders, even within one execution.

The last clause is independent of seeding: HAMT internals (collision-node ordering, deletion-path compaction) may differ between `Eq`-equal values with different construction histories, and the spec imposes no canonicalization obligation on the runtime. The cross-run instability is *intentional* (the Go rationale, per Part 2 §2.4): snapshot tests and accidental order-dependence are kept honest before an ecosystem can calcify around an order nobody promised.

User-facing docs carry the practical consequence in one line: **need an order? sort a `Vector`** — `Vector.sort(Map.toSeq(m) |> Vector.fromSeq)`-shaped (`sort` owed to the stdlib listing), or wait for `SortedMap`/`SortedSet` (pre-registered v2).

### 7.2 `Iterable` instances and loop heads

Provided (Part 2 §4.4 wording; rows in the Loops §5 table):

| Instance | Associated type | `iterate` |
|---|---|---|
| `Iterable<Map(k, v)>` | `type Item = (k, v)` | `toSeq` |
| `Iterable<Set(a)>` | `type Item = a` | `toSeq` |

```
for (key, value) in m
  ...
for x in s
  ...
```

`for (key, value) in m` is legal: the tuple-of-binders pattern is irrefutable, and loop heads are one of Pattern Matching's five positions under the one irrefutability gate (Pattern Matching §6; Loops §2.1).

### 7.3 `keys` / `values` / `entries` correspondence

**The three traversals correspond**: at every position `i`, `entries` yields exactly the pair of the key and value yielded at position `i` by `keys` and `values`. Extensionally:

```
entries(m) ≡ zip(keys(m), values(m))
```

where `≡` means corresponding traversal of the one underlying order — not three independent sequences relying on any canonical representation. Free to provide (all three walk the same trie) and eliminates a real bug class (zipping keys against values). All three, and `toSeq`, and `for..in`, use the same §7.1 order for a given value.

---

## 8. Instances

All compiler/runtime-provided (Part 2 §4.4 wording — specified normatively here, no source form).

### 8.1 `Eq` — extensional

| Instance | Given | Semantics |
|---|---|---|
| `Eq<Set(a)>` | `Hash a` | equal sizes, and every element of either set is contained in the other |
| `Eq<Map(k, v)>` | `Hash k`, `Eq v` | equal sizes, and every key of either maps in both to `equals`-equal values |

Purely extensional — same contents, equal; construction history, internal form, and iteration order are irrelevant *by definition* (order-independence is not a property the implementation must arrange; it is what the definition says). Keys need `Hash` (which supplies their `Eq` via the superconstraint); map values need only `Eq`. The obvious implementation is size check + per-entry lookup (expected O(n log₃₂ n)); non-normative. Constraint propagation is the standard parameterized-instance shape (Constraints §4.3).

### 8.2 No `Ord` — decided

Neither type has an `Ord` instance, and none is planned. An `Ord` must represent a meaningful, stable ordering of *values*; the only order a hash table has is its traversal order, which is per-process (§7.1) — a lexicographic-over-iteration `Ord` would compare differently across runs, which is not an order, it is a bug generator. The contrast is instructive and stated in the doc: `Vector` has intrinsic positional order, so lexicographic `Ord<Vector>` is natural (Part 3 §8); `Map`/`Set` are extensionally unordered, so nothing. `SortedMap`/`SortedSet` (v2, on demand) gain entrywise/lexicographic `Ord` naturally, because their key order is semantic. Rejected alternative §12.5 (the Haskell `Data.Map` `Ord` is a sorted-tree artifact).

Consequences accepted: maps and sets are not sortable, not comparable with `<`, and cannot key a future `SortedMap`.

### 8.3 `Show` — constructor-shaped display

| Instance | Given | Rendering |
|---|---|---|
| `Show<Set(a)>` | `Show a` | `Set.fromVector([e1, e2, …])`; `Set.empty` when empty |
| `Show<Map(k, v)>` | `Show k`, `Show v` | `Map.fromVector([(k1, v1), …])`; `Map.empty` when empty |

**Constructor-shaped, not round-trip.** The rendering names real constructors (§3.2) around the established tuple/vector `Show` forms — but `Show` is display, not serialization, and the output is not guaranteed parseable source (`Show<String>` displays bare, per Products §2.5: `show(Map.fromVector([(1, "a")]))` is `Map.fromVector([(1, a)])`). Same modest terminology as Part 3's "literal-shaped" for `Vector`; do not call it round-trip. Rejected alternative: pseudo-literal syntax (`Set{1, 2}`) — compact, but displays syntax that does not parse *even in principle*, a first no `Show` should set (§12.6).

Entries appear in the value's §7.1 iteration order — deterministic for that value within the execution, unspecified, and not stable across executions. The doc says this next to the format, because `show` output in snapshot tests is exactly where the §7.1 non-promise bites first.

### 8.4 `Hash` — permutation-invariant, forced

| Instance | Given | Semantics |
|---|---|---|
| `Hash<Set(a)>` | `Hash a` | fold over element hashes, **invariant under every permutation of the elements** |
| `Hash<Map(k, v)>` | `Hash k`, `Hash v` | per-entry hash combines key and value **order-sensitively within the pair** (an entry must distinguish `(k, v)` from `(v, k)`-shaped confusions), then a fold over entry hashes **invariant under every permutation of the entries** |

Permutation-invariance is stated as the normative contract (not "commutative fold" — a weak combine like bare XOR is technically commutative and still invites cancellation pathologies; the invariance statement constrains the *result*, and the combine algorithm stays runtime-owned per Part 2 §3.2).

This is **forced, not chosen**, by Part 2 §2.4's split: the public `hash` member is unseeded and deterministic across runs, while iteration order is seed-dependent — so any order-sensitive fold over iteration would make `hash(m)` a per-process value, violating the member's own contract. Permutation-invariance is simultaneously what the Part 2 §2.3 law needs against §8.1's extensional `Eq`. Both routes lead here; the doc records both.

These instances make `Map`s and `Set`s usable as map keys and set elements themselves (`Set(Set(Int))` works).

---

## 9. Diagnostics checklist

| Situation | Error / behaviour | § |
|---|---|---|
| `m[k]` with absent key | runtime `KeyError` (nullary; best-effort key rendering in the JS message, non-normative) | §4.1, §4.3 |
| `m[k]` where `k`'s type lacks `Hash` | ordinary unsatisfied-constraint error (hint: `derives (Eq, Hash)` — Part 2 §9) | §4.1 |
| `s[x]` on a `Set` | ordinary type error (no bracket support on `Set`); no special diagnostic owed | §4.4 |
| `m[lo..hi]` where the key type is not `Range` | ordinary type error; with a `Range` key type (and `Hash<Range>` provided) it is an ordinary key lookup, never a slice | §4.4 |
| Hand-written-`Eq` key type used with `Map`/`Set` | unsatisfied `Hash` at the use site; the Part 2 §4.3 Eq-agreement error at the derivation site; wrapper-key pattern is the sanctioned answer | Part 2 §4.3/§4.5 |
| `Map.set` / `remove` / `add` with absent or present key | **no error** — upsert / forgiving by design | §5 |
| `for (k, v) in m` | legal (irrefutable tuple pattern in a loop head) | §7.2 |
| `for [k, v] in m` | irrefutability-gate error (vector pattern can fail on length), as Part 3 §3.4 | §7.2 |
| Ordering comparison (`<` etc.) on `Map`/`Set` | ordinary unsatisfied-`Ord` error; no bespoke message | §8.2 |
| `show(m)` where key/value lacks `Show` | ordinary unsatisfied-constraint error | §8.3 |

No new *static* diagnostics: the constraint system and the existing bracket machinery police everything above.

---

## 10. The JS boundary: semantic ground rules

The conversion functions — `Map.toJsMap` / `Map.fromJsMap` / `Set.toJsSet` / `Set.fromJsSet` — are **specified in FFI Part 10**, together with the `JsMap(k, v)`/`JsSet(a)` borrowed views (`ReadonlyMap`/`ReadonlySet` faces), eager **shallow-snapshot** conversion semantics, checked inward conversion (`Err(JsConversionError)` on cyclic structural-key ingestion, with structured paths per FFI Part 11), and the rule that **values are never traversed**. This section states the semantic ground rules those conversions honor; FFI Part 10 is the operational owner and is not restated here.

### 10.1 Primitive keys: faithful

For `Int`, `Float`, `String`, `Bool` keys/elements, conversion is semantically faithful in both directions: Hexagon's `Eq` on these types *is* SameValueZero (Constraints §7), which *is* JS `Map`/`Set` key equality. `-0`/`+0` unify and all `NaN`s are one key on both sides of the fence. This is the Part 1 §4.2 payoff, stated as normative: **no primitive-keyed entry is collapsed, split, or lost by conversion in either direction.**

### 10.2 Hexagon → JS: structural identity does not survive

Structural/nominal Hexagon keys (records, tuples, unions) convert to distinct JS objects. Consequences, documented:

- Two structurally *unequal* Hexagon keys become two JS keys: fine.
- A Hexagon key's structural identity is **not usable from JS by reconstruction**: looking up in the emitted `JsMap` requires the exact converted object reference; an equal-looking JS object is a different key under JS reference identity. The converted map is a snapshot for JS consumption, not a shared structural index.

### 10.3 JS → Hexagon: structural collapse — later value, first key representative

A JS `Map` may hold multiple reference-distinct object keys that convert to `equals`-equal Hexagon keys. Those entries collapse, deterministically:

> Conversion traverses the source `JsMap` in its own iteration order (which JS defines as insertion order). When multiple JS keys convert to `equals`-equal Hexagon keys, **the later entry's value wins; the first converted key representative is retained** (§5.4).

Consistent with §3.3 — conversion *is* `fromEntries` over the source's entry sequence, morally and probably literally, and inherits its last-value/first-representative split. `Set` conversion collapses `equals`-equal elements to one, **retaining the first source representative** (§5.4) — which representative survives is observable, exactly as everywhere else in this spec.

---

## 11. Emission notes

- `Map.empty`/`Set.empty` emit shared runtime constants (as `Vector.empty`, Part 3 §2).
- `m[k]` emits a runtime keyed read with the presence check that produces `KeyError` (a check exists either way — JS `.get` returns `undefined` on absence; the throwing form wins on type cleanliness, exactly the Part 3 §5.1 argument).
- Constructors, algebra, and instances emit `@hexagon/runtime` calls; `.d.ts` faces expose `Hex.Map<k, v>` and `Hex.Set<a>` from `@hexagon/runtime` (final namespace/import form: FFI spec).
- `for (k, v) in m` emits the general iterable path (Loops §6.5) with a destructuring head: `for (const [k, v] of m.entries())`-shaped — readable, native.

---

## 12. Rejected alternatives (do not re-litigate)

### 12.1 Map/Set literals

`#{…}`, `[k: v]`, `%{…}` et al. Rejected for v1: every candidate either collides with settled syntax (`{…}` is records permanently; `[…]` is Vector/brackets, settled in Part 3) or spends a sigil (words-only aesthetic, Operators §1.2). Construction-by-name with `fromVector` (§3.2) is one hop from a literal. Revisit only on field evidence that construction is a real ergonomic pain point.

### 12.2 `s[x]` as membership test

Brackets answering a Boolean question would fork `[]`'s meaning by type — retrieval on `Vector`/`Map`/`String`, predicate on `Set` — destroying the one-rule teachability the accessor pair exists for (Part 1 §3.3). `contains` is the membership word everywhere (Part 1 §3.1).

### 12.3 `Set.isSupersetOf`

Exactly `isSubsetOf` with flipped arguments; the lean core wins. A stdlib-listing candidate at most, and only if field usage shows the flip genuinely confuses.

### 12.4 `<k: Hash>` on `singleton`

Considered (a one-entry map arguably "places" its key). Resolved: unconstrained — a singleton can be represented without placement, deferring hashing to the first keyed operation, which carries the constraint. Keeps the §3.5 principle clean: constraints sit on operations that consult keys. **The signature is permanent, not provisional**: adding `<k: Hash>` later would be a source- and ABI-breaking change (existing call sites at constraint-free key types stop compiling; the emitted function gains a dictionary parameter), so the decision does not keep a compatibility door open, and the signature is not to be reopened.

### 12.5 `Ord<Map>` / `Ord<Set>`

The Haskell `Data.Map`/`Data.Set` precedent is a sorted-tree artifact: their `Ord` compares sorted association lists, an order those structures carry intrinsically. A HAMT has no intrinsic order, and its traversal order is per-process (§7.1); any `Ord` built on it would be run-dependent — worse than useless. If sorted collections ship (v2 `SortedMap`/`SortedSet`), *they* get `Ord`.

### 12.6 Pseudo-literal `Show` (`Set{1, 2}` / `Map{1: "a"}`)

Compact and Rust-Debug-familiar, but it displays syntax that does not parse even in principle — every existing `Show` renders forms that at least *look like* Hexagon (literals, constructors); inventing display-only syntax is a precedent with no floor. Constructor-shaped display (§8.3) is barely longer and entirely honest.

### 12.7 Last-wins key representatives (replace-on-write)

Retaining the *newest* `equals`-equal key/element instead of the stored one. Rejected: it breaks `Set.add` idempotence (adding a present element would return a distinguishable set, forcing §5.1 to be rewritten or falsified); it diverges from JS `Map`/`Set`, Python, and the oracle for no gain; and it makes every insertion a potential representative churn, where first-wins makes presence checks sufficient. **"Unspecified representative" is equally rejected**: the retained representative is observable (via SameValueZero-equated Floats today — bare or embedded in derived-`Eq` structures — and wrapper key types tomorrow, where the representative is the pattern's entire point), so leaving it unspecified is an observable nondeterminism in a language with no warning tier to excuse one; and the set-algebra case would make the surviving representative depend on operand *sizes*.

### 12.8 Cross-run iteration-order stability / content-determined order

Rejected in Part 2 §2.4 (do-not-relitigate record there; table placement is seeded, the promise is within-execution only). Additionally rejected here on independent grounds even *within* one execution: "extensionally equal collections iterate identically" would be a canonicalization obligation on the runtime (collision-node ordering and deletion history are construction-dependent), not a free consequence of HAMT determinism. Listed to keep this doc's rejection index complete; the authority is Part 2 §2.4.

---

## 13. Routed elsewhere (recorded, non-blocking)

1. **The `Map.merge` family, `update`, `filter`, `mapValues`, `getOr`, `containsValue`; `Set.map`/`filter`** → `stdlib-roadmap.md` (boundary fixed by Part 5 §10; `merge`'s representative rule bound by §5.4 here).
2. **`Range` `Eq`/`Hash`** → `stdlib-roadmap.md` (rides Loops §3.6's open `Eq`); until decided, `Range` keys are unsatisfiable, which is correct — and §4.4's no-slicing rule is independent of the outcome.
3. *(resolved)* **Transients** — decided in **Collections Part 5 §11**: runtime-internal only; no public transient API in v1. Not open.
4. **`SortedMap`/`SortedSet`** → v2 on demand (Part 1 §4.1); they inherit the `Ord` and order-contract questions this doc deliberately refused.

---

## 14. Edit notes to companion specs (unapplied only)

| Doc | Edit |
|---|---|
| **exceptions.md** | Prelude exceptions still lack **`exception KeyError`** (nullary; §4.3 here) — the `IndexError` sibling; note the non-normative message clause and cite the §2 no-polymorphic-payload rule as the deciding constraint. Add on next touch. |
| **operators-logic-precedence.md** | §14 note on next touch: the bracket's element-type dispatch now covers `Map` keys (Int index / Range slice / map key — checking-time selection, §4.1 here), and a `Range`-typed key is a lookup, never a slice (§4.4); no grammar change. |
| **ffi-part10-js-map-set.md** | §7.3 still says "the later entry wins" for maps and that the retained `Set` representative has "nothing observable about which" — align with §5.4/§10.3 here: for maps, the later entry's *value* wins and the *first* converted key representative is retained; for sets, the *first* source representative is retained (observably). |
| **notes/hexagon-for-typescript-coders.md** | On next touch: Map/Set section — upsert `set`, `get`-returns-`Option`, `m[k]` throws, no literals (`fromVector` idiom), iteration order deliberately unstable across runs (snapshot-test warning), key representatives retained first-wins exactly like JS `Map`/`Set` (§5.4). |

---

## 15. Reserved

*Anchor retained for stable inbound references. The canonical decisions of this document live in §§1–14; there is no separate decisions table.*

---

## 16. Acceptance tests

```
-- (a) Construction, generalization, no Hash on empty
let e = Map.empty                          -- Map(k, v), generalizes
let m = Map.fromVector([(1, "one"), (2, "two")])
let s = Set.fromVector([1, 2, 3])
let one = Map.singleton("a", 1)            -- Map(String, Int)
Map.fromEntries(Vector.toSeq([(1, "old"), (1, "new")]))[1]
                                           -- "new"  (last value wins)

-- (b) Unsatisfied Hash, hinted (key type without derives)
record Weird = {s: String}
honor Eq<Weird> =
  equals(a, b) = String.lower(a.s) == String.lower(b.s)
let bad = Map.set(Map.empty, Weird {s: "K"}, 1)
                                           -- ERROR: no Hash instance for Weird
                                           --   (and derives Hash is barred by the
                                           --    Eq-agreement rule, Part 2 §4.3;
                                           --    wrapper key types are the pattern)

-- (c) Accessor pair
m[1]                                       -- "one"
m[9]                                       -- throws KeyError
Map.get(m, 9)                              -- None
Map.containsKey(m, 2)                      -- true

-- (d) No Set brackets; contains is membership
s[1]                                       -- ERROR: type error (Set has no [])
Set.contains(s, 2)                         -- true

-- (e) Upsert vs assert
Map.set(m, 3, "three")                     -- OK: inserts (contrast Vector.set, throws)
Map.set(m, 1, "uno")                       -- OK: replaces
Map.remove(m, 99)                          -- OK: unchanged (forgiving)
Set.remove(Set.add(s, 4), 4) == s          -- true

-- (f) Set algebra
Set.union(Set.fromVector([1, 2]), Set.fromVector([2, 3]))
                                           -- {1, 2, 3} extensionally
Set.isSubsetOf(Set.empty, s)               -- true
s ++ s                                     -- ERROR: no Concat for Set (use Set.union)

-- (g) Iteration; pattern loop head
var total = 0
for (k, v) in m
  total := total + k                       -- OK: irrefutable tuple head
for [k, v] in m
  ...                                      -- ERROR: this pattern can fail; use match

-- (h) Order contract (property-shaped, not golden-output)
-- toSeq(m) traversed twice in one run: identical order.
-- entries(m) pairs keys(m) with values(m) positionally.
-- No test may assert a concrete order across runs.

-- (i) Instances
Map.fromVector([(1, "a"), (2, "b")]) == Map.fromVector([(2, "b"), (1, "a")])
                                           -- true   (extensional Eq)
Set.fromVector([1, 2]) < Set.fromVector([1, 2, 3])
                                           -- ERROR: no Ord instance for Set(Int)
show(Set.fromVector([1, 2]))               -- "Set.fromVector([1, 2])"  (some order)
show(Map.empty)                            -- "Map.empty"
hash(Set.fromVector([1, 2])) == hash(Set.fromVector([2, 1]))
                                           -- true   (permutation-invariant)
let nested = Set.fromVector([Set.fromVector([1]), Set.fromVector([2])])
                                           -- OK: Set(Set(Int)) — Hash<Set> provided

-- (j) Representative retention (§5.4)
let z = Set.fromVector([-0.0, 0.0])        -- one element (SameValueZero)
Set.size(z)                                -- 1
show(Vector.fromSeq(Set.toSeq(z)))         -- "[-0.0]"   (first representative retained)
Set.add(z, 0.0) == z                       -- true, and the SAME value (add is idempotent)
let m0 = Map.set(Map.set(Map.empty, -0.0, "a"), 0.0, "b")
m0[0.0]                                    -- "b"        (value: last wins)
show(Vector.fromSeq(Map.keys(m0)))         -- "[-0.0]"   (key representative: first wins)
Set.union(Set.fromVector([-0.0]), Set.fromVector([0.0]))
                                           -- retains -0.0 (left operand's representative)
```

---

## 17. Reserved

*Anchor retained for stable inbound references. The post-review correction formerly recorded here (representative retention — `equals`-equal is not indistinguishable) is incorporated into §§3.3, 5.4, 10.3, and 12.7, with its do-not-relitigate record at §12.7.*
