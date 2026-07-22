# Collections

Most programs need more than one value at a time. Hexagon provides three persistent
collections for the ordinary cases:

| Collection | Use it for |
| --- | --- |
| `Vector(a)` | values kept in a sequence |
| `Map(k, v)` | values found by keys |
| `Set(a)` | distinct values and membership |

**Persistent** means that an update produces a new collection without changing the
old one. The word does not mean that the collection is automatically written to disk.
It means that earlier versions remain valid values.

```hexagon
let supplies = ["rope", "torch", "map"]
let betterSupplies = Vector.set(supplies, 2, "lantern")
```

`betterSupplies` is `["rope", "lantern", "map"]`. `supplies` is still
`["rope", "torch", "map"]`. This is the same value-oriented style used by record
updates, now backed by data structures designed to share their unchanged parts.

## Vectors are the everyday sequence

Square brackets construct a `Vector`:

```hexagon
let empty = []
let scores = [18, 24, 31]
let labels = [formatScore(18), formatScore(24)]
```

All elements have one type. The inferred types above are `Vector(a)` for the reusable
empty value, `Vector(Int)`, and `Vector(String)`.

`Vector` is not named `List` because it is not a linked list. It supports efficient
access and persistent updates throughout the sequence, along with efficient additions
at either end. Code should use the behavior it needs rather than importing assumptions
from a differently shaped collection.

Common operations follow the subject-first convention:

```hexagon
let withCompass = Vector.append(supplies, "compass")
let firstSupply = Vector.first(supplies)       // Option(String)
let supplyCount = Vector.size(supplies)        // Int
```

The same calls may use the pipe or dot-call spellings already established:

```hexagon
supplies |> Vector.append("compass")
supplies.append("compass")
```

This chapter uses only a representative handful of operations. The API reference is
the right place to discover every mapping, filtering, sorting, and folding function.

## Indexing states whether absence is acceptable

Hexagon collection positions are one-based:

```hexagon
let first = supplies[1]
let maybeFourth = Vector.get(supplies, 4)
```

The bracket asserts that the position exists. It produces a `String` here and throws
`IndexError` if the assertion is false. `get` makes absence part of the result instead:
it returns `Option(String)`, with `None` for an invalid position.

These two forms express different intentions:

```hexagon
let requiredHeading = chapters[1]

let optionalHeading =
    match Vector.get(chapters, requestedIndex)
        Some(heading) => heading
        None => "Untitled"
```

`Vector.at` adds explicit from-the-end addressing. Positive positions agree with
brackets, while `Vector.at(values, -1)` selects the final element. Zero and positions
beyond either end still throw. Negative addressing is available only through the
named operation; an accidentally negative bracket index fails instead of silently
changing direction.

Slices use inclusive ranges and clamp to the available window:

```hexagon
let middle = supplies[2..3]
let throughEnd = supplies[2..99]
```

Both results are vectors. A descending range is for traversal, not for a window, so it
is rejected in slice position with `SliceError`.

## Vector patterns expose the ends and the remainder

The pattern language gains a vector shape:

```hexagon
let describe(items: Vector(String)): String =
    match items
        [] => "nothing"
        [only] => "one item: ${only}"
        [first, ...rest] => "first: ${first}; more: ${Vector.size(rest)}"
```

`[]` matches exactly the empty vector. A fixed pattern such as `[only]` matches one
exact length. A rest pattern matches the remaining middle and binds it as another
`Vector`:

```hexagon
[first, ...rest]
[...init, last]
[first, ..., last]
```

The rest spelling is `...`, not the `..` range operator. Element positions accept the
full pattern language, so `[Some(value), ...rest]` is legal.

Length matters to exhaustiveness. Fixed-length patterns alone cannot cover vectors of
every possible size; a rest pattern supplies the unbounded case. In a binding position,
only `[...]` or `[...all]` is irrefutable. `[first, ...rest]` can fail on `[]`, so it
belongs in `match`.

## Maps associate keys with values

`Map` has no literal syntax. Constructing one from a vector of tuples keeps the source
easy to read:

```hexagon
let scores = Map.fromVector([
    ("Mira", 18),
    ("Niko", 24),
])
```

The inferred type is `Map(String, Int)`. A map update inserts a new key or replaces the
value associated with an existing key, and returns a new map.

```hexagon
let revised = Map.set(scores, "Mira", 20)
let expanded = Map.set(revised, "Asha", 31)
```

Again, `scores` remains unchanged. Removing an absent key is also harmless; `remove`
returns the map it was given.

Map access follows the same assertion-versus-possibility distinction as vectors:

```hexagon
let miraScore = scores["Mira"]             // Int; may throw KeyError
let visitorScore = Map.get(scores, "Ivo")  // Option(Int)
```

Brackets retrieve associated values. They never ask membership questions, and a `Set`
therefore has no bracket form.

Maps iterate as key-value tuples, so tuple patterns fit directly:

```hexagon
for (name, score) in scores
    print("${name}: ${score}")
```

## Sets answer membership questions

A `Set` contains distinct elements:

```hexagon
let invited = Set.fromVector(["Mira", "Niko", "Asha"])
let withIvo = Set.add(invited, "Ivo")
let withoutNiko = Set.remove(withIvo, "Niko")

if Set.contains(withoutNiko, "Mira")
    print("Mira is invited")
```

Adding an element already present and removing an element already absent both leave
the set unchanged. Named operations express the usual set relationships:

```hexagon
let everyone = Set.union(dayGuests, eveningGuests)
let allDay = Set.intersect(dayGuests, eveningGuests)
let dayOnly = Set.difference(dayGuests, eveningGuests)
```

There is deliberately no `++` for sets or maps. Concatenation preserves a sequence;
set union and map combination have different meanings and deserve names.

## Hashing is an explicit capability

Maps and sets are hash-backed. Operations that inspect or place keys therefore require
the key type to honor `Hash`:

```hexagon
let remember<k: Hash, v>(cache: Map(k, v), key: k, value: v): Map(k, v) =
    Map.set(cache, key, value)
```

`Hash` has `Eq` as a superconstraint. Equal keys must have equal hash values; unequal
keys may still collide. Primitive values and structural products receive lawful hash
behavior from Hexagon. A nominal key type opts in through derivation:

```hexagon
record GuestId derives (Eq, Hash) = {value: Int}
```

User code cannot hand-write `Hash`. Derivation ties it to structural equality, so a
map never has to trust an instance whose equality and hashing quietly disagree.

Hash-table iteration has a deliberately limited promise. Repeatedly iterating one map
or set value produces the same order during one program execution, but the order is
not insertion order, not sorted order, and not stable across executions. If order is
part of the result, convert to a vector and sort it explicitly.

## Sequences connect collections

Every finite collection provides `toSeq` and `fromSeq` operations:

```hexagon
let selected =
    scores
    |> Map.toSeq
    |> Seq.filter((entry) => entry.item2 >= 20)
    |> Vector.fromSeq
```

`Seq(a)` remains the lazy currency between APIs. `toSeq` can expose collection values
incrementally; `fromSeq` is eager because it must build a finite collection. Applying
`fromSeq` to an infinite sequence therefore never finishes.

This shared route avoids a web of pairwise conversions. It also gives reusable
consumers a simple signature:

```hexagon
let countItems<a>(items: Seq(a)): Int = ...
```

Callers convert at the edge instead of requiring the function to abstract over every
possible collection representation.

## User-defined collections can join ordinary loops

`Vector`, `Map`, and `Set` are not a closed club. A user-defined collection can honor
`Iterable` and thereby work with `for`:

```hexagon
record Bag(a) = {items: Vector(a)}

honor<a> Iterable<Bag(a)> =
    type Item = a
    iterate(bag) = Vector.toSeq(bag.items)
```

Now ordinary loop syntax works:

```hexagon
let bag = Bag({items: [2, 3, 3]})

for number in bag
    print(number)
```

For now, read `type Item = a` as “iterating `Bag(a)` produces `a`.” The `iterate`
operation supplies those values as a sequence. This is the whole extension needed for
an ordinary collection.

That `type` line introduces a more general constraint feature called an implied
type. The next chapter explains implied types properly: how constraints declare
them, how instances choose them, where their names are visible, and why Hexagon keeps
their use deliberately restricted.

## Persistent collections have honest runtime faces

`Vector`, `Map`, and `Set` are runtime-owned persistent values, not native mutable
JavaScript arrays, maps, or sets wearing optimistic types. A vector literal therefore
emits in this general shape:

```js
const supplies = Vector.of("rope", "torch", "map");
const betterSupplies = Vector.set(supplies, 2, "lantern");
```

Their public TypeScript faces make the distinction visible:

```ts
import type * as Hex from "@hexagon/runtime";

export declare const supplies: Hex.Vector<string>;
export declare const scores: Hex.Map<string, number>;
export declare const invited: Hex.Set<string>;
```

Explicit conversion functions are the doors to foreign JavaScript collections. They
will appear with the rest of JavaScript input rather than being hidden inside
ordinary collection operations.

## Summary

- `Vector`, `Map`, and `Set` are persistent: updates return new values;
- vectors use literals, one-based indexing, inclusive slices, and vector patterns;
- brackets assert that an index or key exists, while `get` returns `Option`;
- map `set` inserts or replaces, while set operations express membership and algebra;
- hash-backed operations state their `Hash` requirement explicitly;
- map and set traversal order is deliberately unspecified beyond one execution;
- `Seq` is the lazy conversion currency between collections;
- user-defined collections can join ordinary loops by honoring `Iterable`; and
- persistent collections remain visibly distinct runtime values at the JS/TS boundary.
