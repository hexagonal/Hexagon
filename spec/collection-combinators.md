# Stdlib listing: collection combinators

**Status:** Decided 2026-11-02. Not yet implemented; the implementation is
tracked separately. This document is the stdlib listing's part for the
combinator families over `Vector(a)`, `Set(a)` and `Map(k, v)`: their shared
doctrine, the v1 ship-list, and the deliberate absence of combinators on the
foreign collections. It discharges the "Combinator families" row of
`stdlib-roadmap.md` for these three types, and replaces the `Map.mapValues`
that Collections Part 4 §13.1 routed here with `Map.map` (§5.1).

**Homes:** `stdlib/Vector.hex`, `stdlib/Set.hex` and `stdlib/Map.hex`, the
prelude companions, with the trie operations they need in
`stdlib/Runtime/HashTrie.hex` and `stdlib/Runtime/VectorTrie.hex`.

**Not in scope:** sorting, and `min`/`max`/`sum` (later listing decisions);
`Map.update`, the `merge` family, `getOr` and `containsValue` (still ledgered
in `stdlib-roadmap.md`); `Seq`'s own surface, which is unchanged; `String`'s
text-processing surface (`string-text-processing.md`); the foreign collections
`Array(a)`, `JsMap(k, v)` and `JsSet(a)`, beyond §6's statement that they get
none of these.

**Companions:** Collections Part 1 §3 (naming), Part 3 (`Vector`), Part 4
(§4.4 no positions, §5.4 representatives, §7 iteration order), Part 5 (§3.4
`Seq` seats, §10 the collections/listing boundary); Effects §2.4 (callback
colours) and §7 (no failing step in a lazy pipeline); Exceptions §2 (fault
payloads); FFI Part 2 §1 and Part 10 §1 (the foreign collections are doors);
Intrinsics §3.3 (doors); `option-result-convenience.md` (the callback form
these functions share).

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
lazy right-hand sides refuse (Effects §7). A `Map`'s items are its entries
`(k, v)` (Collections Part 4 §7.2), so every `Map` callback takes the entry.
Names that `Seq` does not have (`contains`, `indexOf`, `reverse`, `indexed`)
take their meaning from Collections Part 3 and §3.

**1.2 A name goes only where its meaning holds.** `Map` and `Set` have no
positions (Collections Part 4 §4.4), so the names that speak about positions
(`indexOf`, `reverse`, `zip`, `indexed`, and later `sort`, `take`, `drop`,
`first`, `last`) belong to `Vector` alone. The traversals a `Map` or `Set`
already exposes through `toSeq`, `entries` and `for` (`fold`, `find`, `any`,
`all`) are offered on both, and visit items in the order Part 4 §7.1 gives
them.

**1.3 Traversal order never chooses a resulting `Map` or `Set`'s contents.**
This extends Collections Part 4 §5.4's stance for set algebra to the
combinators. It is why `Map.map` refuses a repeated key (§5.1) instead of
keeping the last.

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
- **Order of calls.** The callback is called at most once per item: on a
  `Vector` in index order, from 1; on a `Set` or `Map` in the collection's
  traversal order (Collections Part 4 §7.1). `find`, `any` and `all` stop at
  the first item that decides the answer. Every other function calls the
  callback on every item.
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
  Nothing is lost by the merge, since equal images are one element. Where two
  images are equal but distinguishable (in v1 only `0.0` and `-0.0`, Part 4
  §5.4), the representative kept is the first produced in traversal order,
  exactly as for `Set.fromSeq(Seq.map(s, transform))`.
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
caller who wants last-wins writes `Map.fromSeq(Seq.map(m, transform))`, where
the dependence on order is visible.

```hexagon
(** Two entries passed through `Map.map` came back with equal keys. *)
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
adapted into a function of the entry.

## 6. The foreign collections

`Array(a)`, `JsMap(k, v)` and `JsSet(a)` get none of these combinators. They
are foreign doors, not Hexagon collections, and the persistent `Vector`, `Map`
and `Set` are the workhorses (FFI Part 2 §1, FFI Part 10 §1). What they need is
already present:

- **Consumers.** Each honors `Iterable`, so `Seq.fold`, `Seq.find`, `Seq.any`,
  `Seq.all`, `Seq.forEach` and `Seq.length` take one directly, through
  Collections Part 5 §3.4's `Seq` seats.
- **Transformations.** Convert once to the workhorse: `Array.toVector(arr)` or
  `Vector.fromSeq(arr)`, `Map.fromSeq(jsMap)`, `Set.fromSeq(jsSet)`. Each is
  one linear copy, like the crossing's own (FFI Part 2 §6.2).

## 7. Costs

For a collection of `n` items, not counting the callbacks' own costs:

| Operation | Bound |
|---|---|
| `Vector.map`, `filter`, `flatMap`, `reverse`, `zip`, `indexed` | O(n) in the elements produced, plus the result's construction |
| `fold`, `find`, `any`, `all`, `contains`, `indexOf` (all three types where offered) | O(n) traversal; `find`, `any`, `all`, `contains` and `indexOf` stop early |
| `Set.filter`, `Map.filter` | O(n): the trie is rebuilt from its own nodes, with no key hashed again |
| `Set.map` | expected O(n log₃₂ n): each image is hashed and placed |
| `Map.map` | O(n), plus expected O(log₃₂ n) for each entry whose returned key does not land where the key handed in was |

A returned key **lands where the key handed in was** when it is the same value
by SameValueZero (the relation `Eq<Float>` uses, Constraints §7) and its hash,
under `j`'s `Hash`, is the one stored for the original. Such an entry keeps its
slot, which takes the returned key and the new value. A key that is rebuilt
rather than returned (a fresh tuple equal to the old one, say) is placed
again: the same result, at the placement's cost. The shortcut is unobservable:
the result is always the one the full placement gives, so it is transparent on
the terms Effects §6.2 sets for an owned memo.

`filter` and the `Map` functions other than `map` carry no `Hash` constraint,
since they consult no key (Collections Part 4 §1). `Set.map` and `Map.map`
carry `Hash` on the new element or key type, which they place.

## 8. Implementation requirements

- The combinators are ordinary Hexagon source in their companions, written as
  loops over the collections, not as round trips through `Seq` (whose per-pull
  allocation costs about forty times a loop).
- `Set.filter`, `Map.filter` and `Map.map` need trie operations that read each
  entry's stored hash. `Map.map`'s shortcut also needs a comparison of two
  values by SameValueZero whatever their types, which ordinary Hexagon cannot
  write. Both are runtime doors under Intrinsics §3.3, and Intrinsics §3.2's
  `Map` and `Set` paragraphs record the keys when they ship.
- `DuplicateKeyFault` joins Exceptions §8.5's inventory of the prelude's
  faults when it ships, bare by category like `KeyFault` (Exceptions §2.1).
- Every export carries a one- or two-sentence `(** *)` doc comment, purpose
  first.
- Conformance tests check each function against its §1.1 law (or §3's meaning)
  on random collections, including `Set.map`'s representative rule, `Map.map`'s
  fault on every repeated key (and its absence otherwise), and the shortcut's
  agreement with the full placement.

## 9. Rejected alternatives (do not re-litigate)

### 9.1 `Map.map` that keeps the keys and returns only a value

F#'s `Map.map` and Elm's `Dict.map` take the key and value as two arguments and
return the new value; their `Seq.map` over a map takes the entry, so the two
meanings show in two callback shapes. In Hexagon both take the entry, so one
lambda, `((k, v)) => v * 10`, would mean a sequence of numbers to `Seq.map`
and a map with the old keys to `Map.map`. That breaks §1.1.

### 9.2 `Map.mapValues`

A second function for the values-only case. §7's shortcut makes `Map.map`
returning the key it was handed a single pass, so the second name buys no
speed.

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
| 1 | One combinator family across `Vector`, `Set` and `Map`, each name meaning `Seq`'s over the items, eager, with callbacks of any colour | §1.1, §2 |
| 2 | Positional names on `Vector` only | §1.2 |
| 3 | Traversal order never chooses a resulting collection's contents | §1.3 |
| 4 | v1 ship-lists: `Vector` twelve, `Set` six, `Map` six | §3–§5 |
| 5 | `Map` callbacks take the entry, destructured with a tuple pattern; `(k, v) => …` is never adapted | §5.2, §9.4 |
| 6 | `Map.map` is entries in, entries out; a repeated key throws `DuplicateKeyFault`; no `mapValues` | §5.1, §9.1–§9.3 |
| 7 | `Map.map` keeps a slot whose key comes back unchanged, through a runtime door; the shortcut is unobservable | §7, §8 |
| 8 | No combinators on `Array`, `JsMap`, `JsSet` | §6, §9.6 |
