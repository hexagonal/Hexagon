# Stdlib listing: collection combinators

**Status:** Decided 2026-11-02, and revised on review before landing: §1.3
states what traversal order never chooses, and §7's shortcut keys on the
stored hash, so no comparison door is needed. Implemented by #1417;
conformance: `compiler/src/conformance/collection-combinators.test.ts`, and the
rebuilds' shapes in `hash-trie.test.ts`. §12, sorting on `Vector`, added
2026-11-02, ruled by James, and implemented by #1425; conformance:
`compiler/src/conformance/vector-sort.test.ts`. §13, extremes and totals
(`max`, `min`, `sum` and `product`, with `Ord.max` and `Ord.min` and `Seq`'s
consumers), added 2026-11-02 and ruled by James, with `Ord.max` and `Ord.min`
made defaulted members of `Ord` the same day, also ruled by James; SPEC-ONLY
until #1431 lands.
This document is the stdlib listing's
part for the combinator families over `Vector(a)`, `Set(a)` and `Map(k, v)`: their shared
doctrine, the v1 ship-list, and the deliberate absence of combinators on the
foreign collections. It discharges the "Combinator families" row of
`stdlib-roadmap.md` for these three types, and replaces the `Map.mapValues`
that Collections Part 4 §13.1 routed here with `Map.map` (§5.1).

**Homes:** `stdlib/Vector.hex`, `stdlib/Set.hex` and `stdlib/Map.hex`, the
prelude companions, with the trie operations they need in
`stdlib/Runtime/HashTrie.hex` and `stdlib/Runtime/VectorTrie.hex`; for §13,
also `stdlib/Ord.hex` and `stdlib/Seq.hex`.

**Not in scope:** `isSorted`,
`binarySearch` and `sortUniq`/`dedup` (later, on demand); `sortDescending`,
`sortByDescending`, `Ordering` helpers and `comparing` (not proposed);
Collections Part 3 §7's other `Vector` candidates (`insertAt` and
`removeAt`), positional `take` and `drop`, and `Map.update`, the `merge`
family, `getOr` and `containsValue` (all still ledgered in
`stdlib-roadmap.md`); `Seq`'s own surface beyond §13's eight consumers; `String`'s
text-processing surface (`string-text-processing.md`); the foreign collections
`Array(a)`, `JsMap(k, v)` and `JsSet(a)`, beyond §6's statement that they get
none of these.

**Companions:** Collections Part 1 §3 (naming), Part 3 (`Vector`), Part 4
(§4.4 no positions, §5.4 representatives, §7 iteration order), Part 5 (§3.4
`Seq` seats, §10 the collections/listing boundary); Effects §2.4 (callback
colours) and §7 (no failing step in a lazy pipeline); Exceptions §2 (fault
payloads); FFI Part 2 §1 and Part 10 §1 (the foreign collections are doors);
Intrinsics §3.4 and §4.2 (door rows onto a runtime module, parametricity);
`option-result-convenience.md` (the callback form these functions share);
for §12, Constraints §5.1–§5.2 (coherence), Decisions Batch §1 (`Ord<Float>`),
Intrinsics §3.3 (rows that run a callback) and Stdlib Roadmap §5.1; for §13,
Method Syntax §4.2 (what a dot call finds), Constraints §4.6 and §7
(member spellings, `Ord`'s laws), Loops §6 (`Seq` consumers) and Primitive
Types §2.1.

---

## 1. Doctrine

**1.1 Same name, same meaning.** A companion combinator `C.f` means `Seq.f`
over the collection's items, run eagerly, with a callback of any colour. Where
it returns a collection, it returns a collection of the same type, built from
the items the `Seq` function would produce. For a callback `p` that is pure and
cannot fail:

```hexagon
C.filter(c, p)   ≡  C.fromSeq(Seq.filter(c, p))
C.map(c, f)      ≡  C.fromSeq(Seq.map(c, f))        -- Map: where f's keys are distinct (§5.1)
C.fold(c, z, f)  ≡  Seq.fold(c, z, f)
```

The eager forms also accept callbacks that are impure or may fail, which the
lazy `Seq.filter` and `Seq.map` refuse (Effects §7). A `Map`'s items are its
entries `(k, v)` (Collections Part 4 §7.2), so every `Map` callback takes the
entry. Names that `Seq` does not have (`contains`, `indexOf`, `reverse`,
`indexed`) take their meaning from §3, and the sorts theirs from §12.

**1.2 A name goes only where its meaning holds.** `Map` and `Set` have no
positions (Collections Part 4 §4.4), so the names that speak about positions
(`first` and `last`, which Collections Part 3 already gives `Vector`, and
`indexOf`, `reverse`, `zip`, `indexed`, `sort` (§12), and later `take`, `drop`)
belong to `Vector` alone. The traversals a `Map` or `Set` already exposes
through `toSeq`, `entries` and `for` (`fold`, `find`, `any`, `all`) are offered
on both, and visit items in the order Part 4 §7.1 gives them.

**1.3 Traversal order never chooses what a resulting `Map` or `Set` holds:**
which keys or elements are present, up to `equals`, and each key's value, for
callbacks whose answers do not depend on the order of the calls (§1.1's laws
assume as much). It is why `Map.map` refuses a repeated key (§5.1) instead of
keeping the last. Besides the result's own traversal order (Collections Part 4
§7.1), the one thing the order can choose is a representative: of two equal
images that are distinguishable, which one `Set.map` keeps (§4), exactly as
`Set.fromSeq` chooses over a set's traversal (Collections Part 4 §3.3).

**1.4 The foreign collections get no combinators** (§6).

## 2. Calling and effects

Every function here is subject-first and reached qualified, through a pipe, or
by the dot, under the existing call rules (Method Syntax). No receiver
dispatch special case belongs to this API.

Callback parameters are `->!`, so each function follows the colour of the
callback it is handed (Effects §2.4): a callback that is pure and cannot fail
gives a bare call, and one that is impure or may fail requires the matching
mark on the outer call (`lines.map^(Int.parse)`). The mark permits effects; it
does not promise that one occurs.

- **Eager.** Each function runs to completion before it returns, and stores no
  callback for later.
- **Order of calls.** The comparators of `sortUsing` (§12.3) and of §13's
  `Using` forms (§13.3) follow their own sections. Every other callback is
  called at most once per item: on a `Vector` in index order, from 1; on a
  `Set` or `Map` in the collection's traversal order (Collections Part 4
  §7.1); on a `Seq` in its own order. `find`, `any` and `all` stop at the
  first item that decides the answer. Every other function calls the callback
  on every item.
- **Failures.** A failure in a callback propagates unchanged and ends the
  call; nothing is caught or converted. It becomes data at the call with the
  reading `?`, and over a block with `attempt` (Effects §3.1, Exceptions §8.2).

## 3. `Vector`

```hexagon
map(values: Vector(a), transform: a ->! b): Vector(b)
filter(values: Vector(a), keep: a ->! Bool): Vector(a)
flatMap(values: Vector(a), transform: a ->! Vector(b)): Vector(b)
fold(values: Vector(a), initial: b, combine: (b, a) ->! b): b
find(values: Vector(a), matches: a ->! Bool): Option(a)
any(values: Vector(a), matches: a ->! Bool): Bool
all(values: Vector(a), matches: a ->! Bool): Bool
contains<a: Eq>(values: Vector(a), element: a): Bool
indexOf<a: Eq>(values: Vector(a), element: a): Option(Int)
reverse(values: Vector(a)): Vector(a)
zip(left: Vector(a), right: Vector(b)): Vector((a, b))
indexed(values: Vector(a)): Vector((Int, a))
```

- `map`, `filter`, `fold`, `find`, `any` and `all` are §1.1's law at `Vector`,
  in index order.
- `flatMap` concatenates, in order, the vectors `transform` returns. Its
  callback returns a `Vector`, the collection's own type, as OCaml's
  `List.concat_map` and Elm's `List.concatMap` do.
- `contains` answers whether some element `equals` `element`. `indexOf`
  answers the 1-based position of the first such element, or `None`
  (Collections Part 1 §3: absence is `Option`).
- `reverse` answers the elements in the opposite order (the explicit reversal
  Collections Part 3 §6.3's idiom needs).
- `zip` pairs elements positionally and ends with the shorter vector, as
  `Seq.zip` does.
- `indexed` pairs each element with its 1-based position, position first:
  `indexed(["a", "b"])` is `[(1, "a"), (2, "b")]`.

## 4. `Set`

```hexagon
map<b: Hash>(s: Set(a), transform: a ->! b): Set(b)
filter(s: Set(a), keep: a ->! Bool): Set(a)
fold(s: Set(a), initial: b, combine: (b, a) ->! b): b
find(s: Set(a), matches: a ->! Bool): Option(a)
any(s: Set(a), matches: a ->! Bool): Bool
all(s: Set(a), matches: a ->! Bool): Bool
```

- All six are §1.1's law at `Set`, in traversal order.
- `Set.map` merges elements whose images are equal, as `Set.fromSeq` does.
  Where two images are equal but distinguishable (for example `0.0` and
  `-0.0`, bare or inside a structure, Part 4 §5.4), the representative kept is
  the first produced in traversal order, exactly as for
  `Set.fromSeq(Seq.map(s, transform))`. Which one that is can differ from run
  to run (§1.3).
- `Set.filter` keeps the stored representatives of the elements it keeps.
- `find` answers the first matching element in traversal order. Where several
  match, which one that is follows Part 4 §7.1, as for `Seq.find(s, matches)`.

`contains`, the set algebra and the conversions are Collections Part 4's.

## 5. `Map`

```hexagon
map<j: Hash>(m: Map(k, v), transform: ((k, v)) ->! (j, w)): Map(j, w)
filter(m: Map(k, v), keep: ((k, v)) ->! Bool): Map(k, v)
fold(m: Map(k, v), initial: b, combine: (b, (k, v)) ->! b): b
find(m: Map(k, v), matches: ((k, v)) ->! Bool): Option((k, v))
any(m: Map(k, v), matches: ((k, v)) ->! Bool): Bool
all(m: Map(k, v), matches: ((k, v)) ->! Bool): Bool
```

`filter`, `fold`, `find`, `any` and `all` are §1.1's law at `Map`, over
entries, in traversal order. `filter` keeps the stored key representatives.

### 5.1 `Map.map`: entries in, entries out

`Map.map` hands each entry to `transform` and builds a map from the entries it
returns:

```hexagon
m.map(((name, score)) => (name, score * 10))          -- keys kept, values changed
m.map(((name, score)) => (String.toLower(name), score))   -- keys changed
```

Where the returned keys are distinct, the result is
`Map.fromSeq(Seq.map(m, transform))`. Where two returned keys are `equals`-equal,
`Map.fromSeq` would keep the last, and "last" would be the traversal order's
choice (§1.3). `Map.map` instead throws `DuplicateKeyFault`, after every
callback has run. Whether a repeat occurs depends only on the entries
returned, not on the order, so the fault is as deterministic as the result. A
callback that fails ends the call first, so its failure, not the fault, is
what propagates. A caller who wants last-wins writes
`Map.fromSeq(Seq.map(m, transform))`, or, for a callback that is impure or may
fail, `Map.fromSeq(Vector.fromSeq(m).map^(transform))` with the mark its colours
call for (`~`, `^` or `!`), where the dependence on order is visible.

```hexagon
(** Raised when two entries passed through `Map.map` come back with equal
    keys. *)
fault DuplicateKeyFault
```

`DuplicateKeyFault` is declared in `stdlib/Map.hex`, housed in the prelude
beside `KeyFault`. It is nullary for `KeyFault`'s reason: a polymorphic key
cannot be a payload slot (Exceptions §2, Collections Part 4 §4.3). As for
`KeyFault`, the runtime may render the key in the JavaScript `Error.message`
on a best-effort basis, and programs must not depend on that rendering.

Each returned key is its own representative in the result: a callback that
returns `-0.0` for the key `0.0` gets a map holding `-0.0`. Two entries
returned as `0.0` and `-0.0` are a repeated key.

There is no `Map.mapValues`: a values-only change is `Map.map` returning the key
it was handed, and §7 makes that a single pass.

### 5.2 The entry callback

A `Map` callback is a function of one parameter, the entry. It is destructured
in the parameter with a tuple pattern, Hexagon's spelling of JavaScript's
`([k, v]) => …`:

```hexagon
m.any(((name, score)) => score > 90)
m.fold(0, (total, (_, score)) => total + score)
```

A lambda of two parameters, `(k, v) => …`, is a different function type, and
is refused at an entry callback as it is at any one-parameter seat. It is never
adapted into a function of the entry. The refusal names the rewrite
`((k, v)) => …` (Declarations Preamble §1.1's Rewrite Rule; #1418).

## 6. The foreign collections

`Array(a)`, `JsMap(k, v)` and `JsSet(a)` get none of these combinators. They
are foreign doors, not Hexagon collections, and the persistent `Vector`, `Map`
and `Set` are the workhorses (FFI Part 2 §1, FFI Part 10 §1). What they need is
already present:

- **Consumers.** Each honors `Iterable`, so `Seq.fold`, `Seq.find`, `Seq.any`,
  `Seq.all`, `Seq.forEach` and `Seq.length` take one directly, through
  Collections Part 5 §3.4's `Seq` seats, and so do §13's eight, from
  `Seq.max` to `Seq.product`.
- **Transformations.** Convert once to the workhorse: `Array.toVector(arr)` or
  `Vector.fromSeq(arr)`, `Map.fromSeq(jsMap)`, `Set.fromSeq(jsSet)`. The first
  two are one linear copy, like the crossing's own (FFI Part 2 §6.2); the last
  two place each item, at Collections Part 4 §2.2's expected cost.

## 7. Costs

For a collection of `n` items, not counting the callbacks' own costs:

| Operation | Bound |
|---|---|
| `Vector.map`, `filter`, `flatMap`, `reverse`, `indexed` | O(n + r), `r` the result's length |
| `Vector.zip` | O(r), `r` the shorter vector's length |
| `fold`, `find`, `any`, `all`, `contains`, `indexOf` (all three types where offered) | O(n) traversal; `find`, `any`, `all`, `contains` and `indexOf` stop early |
| `Set.filter`, `Map.filter` | O(n): the trie is rebuilt from its own nodes, with no key hashed again |
| `Set.map` | expected O(n log₃₂ n): each image is hashed and placed |
| `Map.map` | expected O(n): each returned key is hashed under `j`'s `Hash` once, or, for a key a collision node held, at most three times; plus expected O(log₃₂ n) for each entry whose returned key does not keep its original's slot; the kept keys of a collision node of `c` keys are compared pairwise, O(c²) (Part 4 §2.2's "expected") |

A returned key **keeps its original's slot** when its mixed hash under `j`'s
`Hash` (Collections Part 2 §2.4) is the one stored for the original. The trie
places a key by that hash alone, so the slot is where placing the returned key
afresh would put it, and it takes the returned key and the new value. A key
handed back unchanged keeps its slot whenever `j`'s `Hash` agrees with `k`'s
on it, as it does when `j` is `k`; `0.0` and `-0.0` hash alike (Collections
Part 2 §2.3), so a key turned from one into the other keeps its slot too.
Every other returned key is placed afresh. Kept keys that share a collision
node, which holds the keys of one mixed hash, are compared with each other
under `j`'s `Eq`, and a key placed afresh is compared as it is placed, so every
repeat is found (§5.1). Kept keys in different slots have different hashes, so
they cannot be equal.

The shortcut changes nothing this listing or Collections Part 4 promises: the
result holds exactly the entries placing every returned entry afresh would
give, representatives included. Only the trie's shape, and with it the
traversal order, can differ, and Part 4 §7.1 promises nothing about the order
of two maps.

`filter` and the `Map` functions other than `map` carry no `Hash` constraint,
since they consult no key (Collections Part 4 §1). `Set.map` and `Map.map`
carry `Hash` on the new element or key type, which they place.

## 8. Implementation requirements

- The combinators are loops over the collections, never round trips through
  `Seq`, whose every pull allocates a cell. A walk that must stop early or
  read two collections in step, and every walk over a `Map` or `Set`, is a
  loop over the trie's own nodes: ordinary Hexagon in `Hex.Runtime.VectorTrie`
  or `Hex.Runtime.HashTrie`, reached through companion door rows linked onto
  its compiled operations (Intrinsics §3.4), whose keys Intrinsics §3.2's
  combinators paragraph records. That covers `Vector`'s search (beneath
  `find`, `any`, `all`, `contains`, `indexOf`) and `zip`, and `Map`'s and
  `Set`'s `fold`, `find`, `filter` and the rebuild beneath `Map.map`; `filter`
  and the rebuild read each entry's stored hash. The rest are ordinary Hexagon
  in the companions, `Vector`'s over its `for` loop.
- `filter`'s and `Map.map`'s rebuilds keep the trie's invariants, as its own
  removal does: a branch is never empty, a collision node holds at least two
  entries, and a branch left with one entry or collision node below it is
  replaced by that child.
- The walks are parametric (Intrinsics §4.2): they move the values at their
  type parameters and compare keys only through `Eq` and `Hash` evidence. No
  new comparison door is needed.
- `DuplicateKeyFault` is in Exceptions §8.5's inventory of the prelude's
  faults, bare by category like `KeyFault` (Exceptions §2.1), and the counts
  of the bare set in Modules §5.5 and `stdlib-roadmap.md`, and the bare-set
  conformance test, include it.
- Every export carries a one- or two-sentence `(** *)` doc comment, purpose
  first.
- Conformance tests check each function against its §1.1 law (or §3's meaning)
  on random collections, including `Set.map`'s representative rule, `Map.map`'s
  fault on every repeated key (and its absence otherwise), and the shortcut's
  agreement with the full placement.

## 9. Rejected alternatives (do not re-litigate)

### 9.1 `Map.map` that keeps the keys and returns only a value

F#'s `Map.map` and Elm's `Dict.map` take the key and value as two arguments and
return the new value, while a function of the entry (F#'s `Seq.map` over a
map, or a `List.map` over Elm's `Dict.toList`) takes one pair, so the two
meanings show in two callback shapes. In Hexagon both take the entry, so one
lambda, `((k, v)) => v * 10`, would mean a sequence of numbers to `Seq.map`
and a map with the old keys to `Map.map`. That breaks §1.1.

### 9.2 `Map.mapValues`

A second function for the values-only case. §7's shortcut makes `Map.map`
returning the key it was handed a single pass, so the second name buys no
asymptotic speed. It would save one hash of each key, which `Map.map` computes
because it cannot know that `j` is `k`.

### 9.3 Last-wins on a repeated key in `Map.map`

The survivor would be the traversal order's choice (§1.3). Refusing is
Swift's `Dictionary(uniqueKeysWithValues:)`, Java's `Collectors.toMap` and C#'s
`ToDictionary`.

### 9.4 Adapting `(k, v) => …` into a function of the entry

Swift admitted such unpacking, removed it (SE-0110), and partly restored it.
Here it would let an inferred element type decide how many parameters a lambda
has.

### 9.5 One generic family over `Iterable`

A generic `map` that returns "the same collection" needs higher-kinded types,
which Hexagon does not have (`dictionary-sharing.md`), or Scala's
`CanBuildFrom`/`BuildFrom`, which chooses the result collection by inspecting
inferred types. The generic consumers already exist once, as `Seq`'s, through
Collections Part 5 §3.4's seats.

### 9.6 Combinators on `Array`, `JsMap` and `JsSet`

They would put a second working collection beside each workhorse, which FFI
Part 2 §1 and Part 10 §1 refuse. JavaScript itself gives `Map` and `Set` no
`map` or `filter`.

### 9.7 Only order-free results on `Map` and `Set`

Dropping `fold` and `find` from `Map` and `Set` would leave no way to reduce a
set but a loop or `Seq`, and every colleague with sets offers a fold. The order
those two expose is already public through `toSeq`, `entries` and `for`.

## 10. Precedents consulted

| Language | Set and map combinators | A map's `map` |
|---|---|---|
| OCaml | `map`, `filter`, `fold`, `exists`, `for_all` on `Set` and `Map` | values only (`map`), key and value (`mapi`) |
| F# | `map`, `filter`, `fold`, `exists`, `forall` on `Set` and `Map` | key and value in, value out |
| Elm | `map`, `filter`, `foldl`, `foldr` on `Set` and `Dict` | key and value in, value out |
| GHC | `map`, `filter`, `foldr` on `Data.Set` and `Data.Map` | values only; `mapKeys` keeps the greatest original key's value |
| Swift | `filter` returns the same type; `reduce`, `first(where:)` | `mapValues`; `map` returns an array; duplicate keys refused when building |
| Rust | no `map` or `filter` on collections; iterator adaptors and `collect` | — |
| JavaScript | none on `Map`/`Set`; spread into an array and rebuild | — |

## 11. Decisions log

| # | Decision | Section |
|---|---|---|
| 1 | One combinator family across `Vector`, `Set` and `Map`, each name meaning `Seq`'s over the items, eager, with callbacks of any colour; no generic family over `Iterable` | §1.1, §2, §9.5 |
| 2 | Positional names on `Vector` only | §1.2 |
| 3 | Traversal order never chooses which items a resulting `Map` or `Set` holds, or a key's value, for callbacks whose answers do not depend on call order | §1.3 |
| 4 | v1 ship-lists: `Vector` twelve (fifteen with #9's sorts), `Set` six, `Map` six, with `fold` and `find` on all three; §13 adds eight to `Vector` and `Set` and six to `Map` | §3–§5, §9.7, §13.1 |
| 5 | `Map` callbacks take the entry, destructured with a tuple pattern; `(k, v) => …` is never adapted | §5.2, §9.4 |
| 6 | `Map.map` is entries in, entries out; a repeated key throws `DuplicateKeyFault`; no `mapValues` | §5.1, §9.1–§9.3 |
| 7 | `Map.map` keeps the slot of each returned key whose hash is the one stored, so a key handed back unchanged costs no placement; the shortcut changes nothing promised | §7, §8 |
| 8 | No combinators on `Array`, `JsMap`, `JsSet` | §6, §9.6 |
| 9 | `Vector.sort`, `sortBy` and `sortUsing`, on `Vector` only, each returning a new vector | §12.1, §12.6 |
| 10 | All three stable; `sortBy` calls its key once per element, in index order | §12.2, §12.3, §12.6 |
| 11 | The comparator's calls are deterministic but unspecified; a comparator that is not consistent gets some permutation back, never a fault | §12.3, §12.6 |
| 12 | One door, `vectorSortUsing`, onto the platform's stable sort | §12.5 |
| 13 | `Ord.max` and `Ord.min` are defaulted members of `Ord`, which an instance may override under Constraints §7's laws | §13.1, §13.6 |
| 14 | `max`, `min`, `maxBy`, `minBy`, `maxUsing`, `minUsing`, `sum` and `product` on `Vector`, `Set` and `Seq`; the first six on `Map`, over its entries; none on the foreign collections | §13.1 |
| 15 | On a tie, `min` keeps the first of equal items and `max` the last, agreeing with the stable sort | §13.2, §13.6 |
| 16 | An empty collection's order forms answer `None`, and `sum` and `product` the identity; no faulting sibling and no `sumBy` | §13.2, §13.6 |
| 17 | `sum` and `product` are left folds from the identity, the same for every element type; every key and comparator call is fixed | §13.2, §13.3, §13.6 |

## 12. Sorting

### 12.1 The surface

`Vector` gains three functions, and no other collection gains any:

```hexagon
sort<a: Ord>(values: Vector(a)): Vector(a)
sortBy<b: Ord>(values: Vector(a), key: a ->! b): Vector(a)
sortUsing(values: Vector(a), compare: (a, a) ->! Ordering): Vector(a)
```

- `sort` is the function Collections Part 3 §12, Part 4 §7.1, Constraints §8
  and Modules §13 already name. The other two follow Collections Part 1
  §3.4: `By` takes a key, `Using` takes the procedure that decides.
- **`Vector` only.** A sort speaks about positions, so it belongs where §1.2
  puts the positional names. `Map` and `Set` have no positions and no `Ord`
  (Collections Part 4 §4.4, §8.2), the foreign collections get no combinators
  (§6), and `Seq` keeps its lazy family: a sort reads every element before it
  answers, so a sequence is collected into a vector first.
- **Why three.** Coherence allows one `Ord` per type and no local instance
  (Constraints §5.1, §5.2), so
  any other order is a function the caller passes. `sortUsing` is the
  fundamental, and `sort` and `sortBy` are sugar over it.

```hexagon
let hands = parsed.sortBy((h) => (h.kind, h.cards))
let merged = intervals.sortBy(((start, _)) => start)
let top3 = totals.sortUsing((a, b) => Ord.compare(b, a))[1..3]
let board = players.sortUsing((a, b) => Ord.compare((b.score, a.name), (a.score, b.name)))
```

### 12.2 Meaning

- **`sortUsing(values, compare)`** answers a new vector holding exactly the
  elements of `values`. Where `compare` is **consistent** on them, they are
  ordered so that `compare(earlier, later)` is never `Greater`. A comparator
  is consistent when it answers each pair the same way every time,
  `compare(x, y)` is `Less` exactly when `compare(y, x)` is `Greater`, and
  `Less` and `Equal` are each transitive. It need not agree with `equals`:
  `Ord.compare` under Constraints §7's laws is consistent, and so is a
  comparison of keys under such an `Ord`, which answers `Equal` for distinct
  elements with one key. §12.3 covers a comparator that is not consistent.
- **Stable.** Elements for which `compare` answers `Equal` keep the order they
  had in `values`. Elements that compare equal can still be told apart: `0.0`
  and `-0.0` under `Ord<Float>` (Decisions Batch §1), or two records with one
  key under `sortBy`. Without stability, the algorithm would choose which comes
  first, and the text would not decide the result.
- **`sort(values)`** is `sortUsing(values, Ord.compare)`.
- **`sortBy(values, key)`** orders the elements by their keys under `Ord`,
  stably. It calls `key` once per element, in index order from 1, before any
  comparison: `sortUsing` over the pairs `(key(x), x)`, comparing first
  components and keeping the second.
- **Descending** is a swapped comparator, `(a, b) => Ord.compare(b, a)`. Mixed
  directions swap one component of a tuple. `reverse` after `sort` is not the
  same, since it also reverses the order of equal elements.

### 12.3 Calls and effects

§2's calling and failure rules hold: the three are eager, a callback may take
any colour, and a failure in a callback propagates unchanged and ends the
call, with no partly sorted vector observable. §2's order of calls holds for
`sortBy`'s key; the comparator is the exception it names:

- **`sortBy`'s key** runs exactly once per element, in index order. A key
  that has effects therefore has them in an order the text decides.
- **`sortUsing`'s comparator** is called only on pairs of elements of
  `values`. How many calls there are, and on which pairs in which order, is
  not specified; the calls depend only on the input and on the comparator's
  answers.
- **A comparator that is not consistent** (§12.2) still gets back a
  permutation of `values`. Which permutation is unspecified. The sort makes
  finitely many calls whatever the comparator answers, and never faults
  because of what it answers.

### 12.4 Costs

For a vector of `n` elements, not counting the callbacks' own costs:

| Operation | Bound |
|---|---|
| `sort`, `sortUsing` | O(n log n) comparator calls, and O(n) to copy the elements out and build the result |
| `sortBy` | `n` key calls, then `sortUsing`'s bound |

### 12.5 Implementation requirements

- **One door.** `sortUsing` is one door row in `stdlib/Vector.hex`, key
  `vectorSortUsing`, taking `compare` at `->!` and writing `>->`, as every row
  that runs a callback does (Intrinsics §3.3). `sort` and `sortBy` are ordinary
  Hexagon over it in the companion.
- **The lowering sorts positions, never elements.** It copies the elements to
  a fresh array, sorts the positions with the platform's stable sort, deciding
  each pair of positions by `compare` on their elements, and builds the result
  from the elements in the sorted order of positions. The platform's sort
  moves `undefined` to the end without calling its comparator, and `Unit`,
  `Nullable(a)`, `JsValue` and opaque extern types can be `undefined` (FFI
  Part 1 §4.1, Part 10 §4.2). Sorting the elements would therefore inspect
  them by representation, which Intrinsics §4.2's parametricity forbids.
- **The row seals nothing.** The lowering writes only to arrays it allocates,
  which no Hexagon code can reach while it writes them, the comparator
  included, and which nothing writes after it returns. A comparator that sorts
  again gets arrays of its own. So a call has no observable effect its
  comparator does not have (Effects §2.1), and throws nothing its comparator
  does not, as Intrinsics §4.2 requires of the lowering at `>->`. This is not Effects
  §6.2's species (d), which seals impure Hexagon code beneath a `->` face and
  takes no callback.
- **Why a door** (Stdlib Roadmap §5.1). At 100,000 `Int` elements, a merge
  sort written in Hexagon over `Vector` takes about 0.8 s, and this lowering
  about 52 ms. A faster sort written in Hexagon would need a mutable buffer,
  and a row over one may not run a callback (Effects §6.2 species (d)).
- **Adapting `Ordering`.** The lowering turns each `Ordering` into the
  platform comparator's number by its tag, inside the call, which Operators §5.1's
  implementer note allows; no number is observable.

### 12.6 Rejected alternatives (do not re-litigate)

- **No comparator form, only `sort` and `sortBy`.** Orders such as "names
  descending, scores ascending" would need a wrapper type with a flipped
  `Ord` (Haskell's `Down`, Rust's `Reverse`) before they could be written.
  That keeps the sugar and drops the fundamental it stands for; the library
  may restrict sugar, but never a fundamental. A `Down`-style type may still
  come later beside the comparator form.
- **No key form, only `sort` and `sortUsing`** (OCaml). The most common sort,
  by a field, would write its key twice and compute it on every comparison,
  and an effectful key would run in the comparator's unspecified order.
- **Recomputing the key on every comparison** (Elm's `sortBy`, Rust's
  `sort_by_key`). A key's effects would happen a number of times that depends
  on the algorithm.
- **An unstable sort, or an unstable sibling** (Rust's `sort_unstable`). The
  algorithm would choose among distinguishable equal elements, and here it
  would not be faster.
- **Faulting on a comparator that is not consistent** (Rust 1.81's sorts
  may panic). Whether it faulted would depend on the algorithm and the data,
  so two inputs of the same shape could differ, which the text does not
  decide.

### 12.7 Precedents consulted

| Language | Plain | By key | By comparator | Stable |
|---|---|---|---|---|
| OCaml | none (`List.sort compare`) | none | `List.sort`, `List.stable_sort` | `stable_sort` |
| F# | `List.sort` | `List.sortBy` | `List.sortWith` | `List` yes; `Array` no |
| Elm | `List.sort` | `List.sortBy` (key per comparison) | `List.sortWith` | not documented (inherits the host's sort) |
| Haskell | `sort` | `sortOn` (key once per element) | `sortBy` | yes |
| Rust | `sort` | `sort_by_key`, `sort_by_cached_key` | `sort_by` | `sort` yes; `sort_unstable*` no |
| Swift | `sorted()` | none | `sorted(by:)`, a Bool predicate | yes |
| JavaScript | `toSorted()` (compares as strings) | none | `toSorted(compareFn)` | yes (`sort` since ES2019; `toSorted`, ES2023, always) |
| Scala (the anti-pattern: another order is a local instance) | `sorted` (implicit `Ordering`) | `sortBy` (implicit `Ordering`) | `sortWith` (Bool) | yes |

## 13. Extremes and totals

### 13.1 The surface

`Ord` gains two defaulted members:

```hexagon
export constraint Ord<a: Eq> =
    compare(left: a, right: a) -> Ordering
    max(left: a, right: a) -> a =
        match compare(left, right)
            Greater => left
            _ => right
    min(left: a, right: a) -> a =
        match compare(left, right)
            Greater => right
            _ => left
```

`Vector`, `Set` and `Seq` each gain eight functions, shown here at `Vector`.
`Set`'s take `s: Set(a)` and `Seq`'s take `source: Seq(a)` as the first
parameter:

```hexagon
max<a: Ord>(values: Vector(a)): Option(a)
min<a: Ord>(values: Vector(a)): Option(a)
maxBy<b: Ord>(values: Vector(a), key: a ->! b): Option(a)
minBy<b: Ord>(values: Vector(a), key: a ->! b): Option(a)
maxUsing(values: Vector(a), compare: (a, a) ->! Ordering): Option(a)
minUsing(values: Vector(a), compare: (a, a) ->! Ordering): Option(a)
sum<a: Num>(values: Vector(a)): a
product<a: Num>(values: Vector(a)): a
```

`Map` gains the first six, over its entries:

```hexagon
max<k: Ord, v: Ord>(m: Map(k, v)): Option((k, v))
min<k: Ord, v: Ord>(m: Map(k, v)): Option((k, v))
maxBy<c: Ord>(m: Map(k, v), key: ((k, v)) ->! c): Option((k, v))
minBy<c: Ord>(m: Map(k, v), key: ((k, v)) ->! c): Option((k, v))
maxUsing(m: Map(k, v), compare: ((k, v), (k, v)) ->! Ordering): Option((k, v))
minUsing(m: Map(k, v), compare: ((k, v), (k, v)) ->! Ordering): Option((k, v))
```

- **One name for both forms.** `Ord.max(a, b)` and `Vector.max(values)` live
  in different modules, so they do not clash, and `values.max()` dot-calls the
  collection form. The key and comparator forms follow Collections Part 1
  §3.4: `By` takes the thing ordered on, `Using` the procedure that decides.
- **`Ord.max` and `Ord.min` are defaulted members of `Ord`,** as `notEquals`
  is of `Eq` (Constraints §2). Every instance has them without writing them,
  derived and structural instances included, and an instance may write its
  own under the laws of Constraints §7. This is the shape of Haskell's `Ord`
  class, whose `max` and `min` are members with defaults, and of Rust's `Ord`
  trait, whose `max` and `min` are provided methods; both break a tie as
  §13.2 does.
  - Being members, they dot-call wherever `compare` does (Method Syntax
    §4.2). Where the receiver's type has a declared or derived instance, as
    `Int`, `String` or a record with `derives Ord` has, `a.max(b)` is
    `Ord.max(a, b)`.
  - The instance of a tuple, a structural record or a `Vector` is structural
    and gives no dot call, so there the spelling is `Ord.max(a, b)`. On a
    `Vector`, `values.max()` is the collection form.
  - Honoring `Ord` claims the spellings `max` and `min` in the honoring
    module (Constraints §4.6), so such a module binds no module-level `max`
    or `min` of its own. `Set` and `Map` therefore could not honor `Ord` in
    their companions while those bind the collection forms.

  §13.6 records the alternative.
- **Where they go.** A reduction speaks about no position, so §1.2 does not
  confine it to `Vector`, and it goes wherever `fold` and `find` are: on
  `Vector`, `Set` and `Map`. A `Map`'s items are its entries, so its callbacks
  take the entry (§5.2). It has no `sum` or `product`, because an entry is a
  tuple, no tuple honors `Num`, and so no call could type-check. A map's
  values are totalled through the sequence `Map.values` answers:
  `m.values().sum()`. `Seq`'s eight are the generic consumers, which every
  iterable reaches through Collections Part 5 §3.4's seats, as in
  `Seq.sum(1..100)`. The foreign collections get none (§6).

```hexagon
let total = lines.map(score).sum()
let most = elves.map((calories) => calories.sum()).max()
let nearest = points.minBy((point) => point.distance)
let busiest = visits.maxBy(((_, count)) => count)
let latest = events.maxUsing((a, b) => Ord.compare(a.time, b.time))
let triangle = Seq.sum(1..100)
let higher = a.max(b)
let lower = Ord.min((1, "b"), (1, "a"))
```

### 13.2 Meaning

- **Two values.**
  - `Ord.max(a, b)` is `a` when `Ord.compare(a, b)` is `Greater`, and `b`
    otherwise.
  - `Ord.min(a, b)` is `b` when `Ord.compare(a, b)` is `Greater`, and `a`
    otherwise.
  - On a tie, `min` answers its first argument and `max` its second, so
    `(Ord.min(a, b), Ord.max(a, b))` is always `(a, b)` or `(b, a)`: a stable
    sort of the two.
  - These are the defaults, and an instance that writes its own `max` or
    `min` must answer the same (Constraints §7).
- **Empty.** On an empty collection, `max`, `min` and their `By` and `Using`
  forms answer `None` (Collections Part 1 §3.1). `sum` answers zero and
  `product` one, `Num.fromNat(0)` and `Num.fromNat(1)`.
- **`maxUsing(c, compare)`** reads the items in traversal order and keeps a
  best item:
  - the best starts as the first item;
  - each later item `x` replaces it unless `compare(best, x)` is `Greater`.
- **`minUsing(c, compare)`** reads them the same way, and `x` replaces the
  best only when `compare(best, x)` is `Greater`.
- **Traversal order** is index order for a `Vector`, Collections Part 4 §7.1's
  order for a `Set` or a `Map`, and the sequence's own order for a `Seq`.
- **Ties.** Among items that compare equal, `min` keeps the first and `max` the
  last.
- **`max(c)` and `min(c)`** are `maxUsing(c, Ord.compare)` and
  `minUsing(c, Ord.compare)`.
- **`maxBy(c, key)`** calls `key` once per item, in traversal order. Each
  item's key is compared with the best key so far before the next item's key
  is computed, so the walk holds the best key and the current one, never all
  of them. It answers the last of the
  items whose key is greatest:
  `maxUsing` over the pairs `(key(x), x)`, comparing first components and
  keeping the second. `minBy` answers the first of the items whose key is
  least.
- **Agreement with the sort.** For a `Vector` and a comparator that is
  consistent (§12.2):
  - `minUsing(v, compare)` is `sortUsing(v, compare).first()`, and
    `maxUsing(v, compare)` is `sortUsing(v, compare).last()`, empty vectors
    included;
  - the same holds for `min` and `max` against `sort`, and for `minBy` and
    `maxBy` against `sortBy`.
- **`sum(c)`** is `fold(c, Num.fromNat(0), Num.add)`, and **`product(c)`** is
  `fold(c, Num.fromNat(1), Num.multiply)`. Both run left to right in traversal
  order, starting from the identity. Nothing in them depends on the element
  type:
  - A `Float` sum rounds at each step, as a loop written by hand does. At
    `Float`, `add` is commutative exactly but associative only up to rounding,
    and not at all where a step overflows or meets `NaN` (Constraints §7), so
    a different order of the same items can give a different sum.
  - A `NaN` among the items makes the sum `NaN`.
  - `Vector.sum([-0.0])` is `0.0`, since `0.0 + -0.0` is `0.0`.
  - Once a running `Int` or `Nat` total or product leaves the safe range, it
    is no longer promised exact, as `+` and `*` are not there (Primitive
    Types §1 for `Nat`, §2.1 for `Int`).
- **`NaN` and the signed zeros** follow `Ord<Float>` (Decisions Batch §1), as
  the sort does:
  - `NaN` is greatest, so `Vector.max([1.0, Float.nan])` is `Some(NaN)`.
  - `Ord.min(1.0, Float.nan)` is `1.0`.
  - `Ord.max(0.0, -0.0)` is `-0.0`, its second argument, because the two are
    equal.
- **A `Set` or a `Map`.** Their traversal order is fixed for one value within
  one execution and promised for nothing else: two equal sets can be traversed
  in different orders, and so can one set in two executions (Collections
  Part 4 §7.1). So, just as `fold` and `find` on these collections can
  (§9.7), the answer can differ between equal collections, or between runs,
  wherever it depends on the order:
  - which item a `By` or `Using` form returns among items that tie;
  - how a `Float` sum or product rounds;
  - an `Int` or `Nat` total or product that leaves the safe range;
  - a `product` under a `Num` whose `multiply` does not commute, such as a
    matrix type's (Constraints §7);
  - the answer under a comparator that is not consistent (§13.3), or under a
    callback whose answers depend on the order of its calls.

  `Set.max` and `Set.min` never tie, because `Ord` agrees with `equals`
  (Constraints §7) and a set's elements are distinct. `Map.max` and `Map.min`
  never tie either: the keys are distinct, so the key alone decides. `v: Ord`
  is still required, so a map whose values have no order, such as a
  `Map(String, Set(Int))`, takes `m.maxBy(((key, _)) => key)` instead.

### 13.3 Calls and effects

§2's calling and failure rules hold. All of these functions are eager, a
callback may take any colour, and a failure in a callback propagates unchanged
and ends the call. Unlike the sort's comparator (§12.3), every call is fixed:

- **A key** runs exactly once per item, in traversal order, and each item's
  key is compared with the best key so far before the next item's key is
  computed. A failure in a key or in a comparison of keys therefore ends the
  call with the later items' keys not computed.
- **A comparator** runs exactly `n - 1` times for `n` items, as
  `compare(best, x)` for each item `x` after the first, in traversal order,
  and not at all for an empty collection.
- **A comparator that is not consistent** still leaves the call answering one
  of the items of a non-empty collection. Which one is the item the steps of
  §13.2 give, so it is decided by the input and the comparator's answers. The call never faults because of what the
  comparator answers.
- **`sum` and `product`** call `Num.add` or `Num.multiply` once per item, in
  traversal order.

### 13.4 Costs

For `n` items, not counting the callbacks' own costs:

| Operation | Bound |
|---|---|
| `Ord.max`, `Ord.min` (the defaults) | one `compare` call |
| `max`, `min`, `maxUsing`, `minUsing` | `n - 1` comparator calls, none when empty; one traversal |
| `maxBy`, `minBy` | `n` key calls and `n - 1` comparisons of keys, none when empty; one traversal |
| `sum`, `product` | `n` additions or multiplications; one traversal |

Every one of them holds constant extra space and, on a `Seq`, constant stack
(Loops §6).

### 13.5 Implementation requirements

- **No door.** All of them are ordinary Hexagon over the collection's `fold`
  (Stdlib Roadmap §5.1). The default bodies of `Ord.max` and `Ord.min` are
  ordinary Hexagon in `Ord.hex`.
- **The two-value pair goes through the instance.** Every `Ord` instance
  carries `max` and `min` as it carries `compare` (Constraints §6.1). At a
  ground declared instance, such as `Int`'s, a call is a direct call to the
  instance's member seat; elsewhere at a known type, including a tuple,
  `Bool` and a parameterized instance such as a `Box(Int)`'s, it reads the
  member off the hoisted dictionary; under an `Ord` bound it reads it from the
  dictionary passed in. A member's forwarder has no editions (Constraints
  §6.1).
- **Editions for the collection forms.** Each function bound by `Ord` or
  `Num` gets an edition at every fundamental type seated before its module
  that honors the bound: `Int`, `Nat`, `Float` and `BigInt` for all of them,
  `Bool` and `Unit` for the `Ord`-bound ones, and `String` as well on `Set`
  and `Map`, which are seated after `String.hex`. `Map.max` and `Map.min` bind
  two variables, so each gets the full product of that spec's candidates, 49
  editions, whose size its §10 requires to be measurable.

### 13.6 Rejected alternatives (do not re-litigate)

- **`Ord.max` and `Ord.min` as plain functions in `Ord.hex`** (OCaml's
  `Stdlib.max`, Swift's free `max`). They would claim no spelling in a module
  that honors `Ord`, but no instance could supply its own, and `a.max(b)`
  would be refused, because a dot call finds only the exports of its
  receiver's companion and the members of the constraints its type honors
  (Method Syntax §4.2).
- **The first of equal items for both `min` and `max`** (Python, Kotlin,
  lodash, F#, and Swift's `Sequence.max()`). `Ord.min(a, b)` and
  `Ord.max(a, b)` would answer the same argument on a tie, and `max` would no
  longer be the last element of the stable sort.
- **An unspecified tie.** The answer would depend on the implementation, and
  the text would not decide it.
- **A `max` that faults on an empty collection, or a faulting sibling**
  (Haskell's `maximum`, F#'s `List.max`). Absence is `Option` (Collections
  Part 1 §3.1), and there is one function per operation (its §3.3).
- **`sumBy`** (F#, lodash, Kotlin's `sumOf`). `By` takes the thing an operation
  orders on (Collections Part 1 §3.4), and a sum orders nothing. On a
  `Vector`, write `values.map(cost).sum()`. On a `Set` or a `Map`, `map`
  answers a set or a map, and `Set.map` merges equal images (§4), which would
  drop repeated costs. Write `Seq.sum(Seq.map(s, cost))` for a `cost` that is
  pure and cannot fail, and otherwise fold, marked as `cost` requires; for a
  `cost` of any colour, `s.fold!(0, (total, item) => total + cost!(item))`.
- **A compensated sum inside `sum` for `Float`** (Python's `sum` since 3.12).
  `Num` has no subtraction or comparison, so the generic `sum` could compensate
  only by inspecting its element type and choosing another algorithm, which
  is one interpretation chosen by an inferred type. A separate compensated sum
  may still come later, under a name of its own.
- **`maximum` and `minimum` for the collection forms** (Haskell, Elm). Those
  languages need a second name because their `max` is bare. Here the two forms
  live in different modules.

### 13.7 Precedents consulted

| Language | Two values | Collection | Empty | Key and comparator forms | Tie (collection max) | Sum |
|---|---|---|---|---|---|---|
| OCaml | `Stdlib.max`, `min` (plain) | none | — | none | — | none (`fold_left (+) 0`) |
| SML | `Int.max`, `Real.max` (per type) | none | — | none | — | none |
| Haskell | `max`, `min` (`Ord` members) | `maximum`, `minimum` | throws | `maximumBy (comparing f)` | last | `sum`, `product` |
| Elm | `max`, `min` (plain) | `List.maximum`, `minimum` | `Nothing` | none in core | — | `List.sum`, `product` |
| F# | `max`, `min` (plain) | `List.max`, `min` | throws | `maxBy`, `minBy` | first | `sum`, `sumBy` |
| Rust | `a.max(b)`, `cmp::max` | `Iterator::max`, `min` | `None` | `max_by_key`, `max_by` | last | `sum`, `product` |
| Swift | free `max`, `min` | `Sequence.max()`, `min()` | `nil` | `max(by:)` | first | none (`reduce(0, +)`) |
| Python | `max(a, b)` | `max(xs)` | throws, or `default=` | `key=` | first | `sum` (compensated for floats since 3.12) |
| Kotlin | `maxOf(a, b)` | `maxOrNull()` | `null` | `maxByOrNull`, `maxWithOrNull` | first | `sum`, `sumOf` |
| lodash | — | `max`, `min` | `undefined` | `maxBy`, `minBy` | first | `sum`, `sumBy` |
