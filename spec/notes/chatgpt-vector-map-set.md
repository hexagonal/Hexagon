ChatGPT




Yesterday 8:36 PM
Thought for 22s
Probably no, not in the full RRB sense.

Immutable.js List is definitely a 32-wide vector-trie-ish persistent indexed sequence. Its own docs say List has O(log32 N) get/set, O(1) push/pop, and efficient addition/removal at both ends via push/pop and unshift/shift. 
 Its source literally has a VNode described as “a node in the List’s 32-wide trie”, with inner nodes holding child VNodes and leaf nodes holding values. 

But an RRB tree specifically means a relaxed radix balanced vector that improves things like concat, split, and insert. The Bagwell/Rompf RRB paper says the point is to allow immutable vector concatenation, insert-at, and splits in O(log N) while keeping the original vector’s indexing/update/iteration performance. 

Immutable.js List.concat does not appear to do RRB-style tree concatenation. In the current source, concat collects the incoming sequences and then does:

seqs.forEach((seq) => seq.forEach((value) => list.push(value)));
inside withMutations. 

So operationally, that is “append every element efficiently”, not “merge two vector trees logarithmically”.

So I’d classify it like this:

Immutable.js List:
  persistent 32-wide vector trie
  plus origin/capacity tricks for deque-like front operations
  plus transient-style batching via withMutations
  not obviously/full RRB, especially not for concat
For Hexagon, that means:

Vector.append(v, x)   -- cheap
Vector.prepend(v, x)  -- can be cheap if you copy Immutable.js-style origin trick
v ++ u                -- probably linear in length(u), unless you deliberately implement RRB concat
That is still perfectly good. You can document ++ as linear, then maybe make it faster in v2 if you go RRB. The API does not need to promise the fancy structure on day one.


i have heard that RRB in a non-lazy environment is not as efficient as has been advertised
and maybe RRB is doesn't provide enough gains for the added complexity (of implementation)
thoughts

I’ll separate the API question from the implementation question here. The API can allow ++ now; the implementation can start simple and become RRB later only if profiling justifies it.

Thought for 2m 17s
Yes, that criticism sounds plausible to me.

RRB trees have a beautiful sales pitch: keep ordinary persistent-vector performance, but add good concat/split/slice. The original RRB paper claims immutable vector concatenation, insert-at, and split in O(log N) while preserving the ordinary vector’s indexing/update/iteration performance. 
 Clojure’s core.rrb-vector frames the use case more cautiously: it may help when you frequently concatenate large vectors to produce new vectors. 

That “may help” is the important phrase.

For Hexagon, I would not make RRB the v1 implementation. I’d do:

Vector.append(v, x)    -- cheap
Vector.prepend(v, x)   -- cheap if you implement deque-style origin tricks
Vector.concat(v, u)    -- correct, probably O(length(u)) in v1
v ++ u                 -- same as Vector.concat
Then document concat honestly as linear unless you actually implement a better algorithm.

The practical problem with RRB is not that the idea is bad. It is that it buys you most when users do lots of large vector concat/split. But many programs mostly do:

build vector
index vector
map/filter/fold vector
append one item
maybe drop from ends
For that workload, a normal 32-wide persistent vector/deque is already excellent. Immutable.js List advertises O(log32 N) get/set, O(1) push/pop, and efficient addition/removal at both front and back. 
 Scala’s immutable Vector similarly presents itself as a general-purpose immutable indexed sequence with O(log n) random access/update and very fast append/prepend/tail/init. 

RRB adds extra machinery: relaxed nodes, size tables, more complicated concat balancing, more complicated invariants, and likely worse constant factors. In a strict/non-lazy implementation, you also tend to pay the rebalancing cost now, not later. Laziness can sometimes hide or amortise awkward structure-building; JS will not magically do that for you.

The best evidence that the complexity is real: there are whole papers/theses about making RRB practical, including work specifically on improving RRB append performance through transience/optimisations. 
 That is not a “small weekend data structure” smell.

So my Hexagon design instinct:

v1:
  persistent vector/deque
  append/prepend/first/last/dropFirst/dropLast/get/set
  concat implemented by iterating the right vector and appending

v2:
  only consider RRB if real Hexagon code shows concat/split are hot
The API does not need to expose the implementation choice. This is the nice part:

let c = a ++ b
can be linear in v1 and logarithmic in v2 without breaking source code.

So yes: RRB is probably overkill for Hexagon v1. Good API first, boring implementation first, fancy tree later only if benchmark pain demands it.


Okay I accept your Vector API.
There is a clear split in Hexagon between ideal functional, and practical JS output.
So i leave push and pop on the other side of the fence.

What are your suggested APIs for Map and Set?

For Map/Set, the big design fork is not naming; it is the key model. Without a public Hash constraint in v1, I’d strongly lean toward ordered persistent Map/Set requiring Ord keys, not HAMT-first hash maps.

Thought for 1m 22s
Yes. For Map and Set, I would go boring, named, functional, subject-first.

The biggest design decision: I would make v1 Map/Set ordered collections requiring Ord keys, not hash collections. Your own notes already say Hash is not a v1 user-facing constraint, and collections/key coherence is exactly where hash semantics become load-bearing. 

 So v1 should avoid pretending hash maps are free.

The roadmap also has Map/Set explicitly as an open Collections decision, so this fits neatly into the Collections spec rather than fighting current text. 


Map
Core API:

Map.empty : Map(k, v)

Map.isEmpty : Map(k, v) -> Bool
Map.size : Map(k, v) -> Int

Map.get<k: Ord>(map: Map(k, v), key: k): Option(v)
Map.containsKey<k: Ord>(map: Map(k, v), key: k): Bool

Map.set<k: Ord>(map: Map(k, v), key: k, value: v): Map(k, v)
Map.remove<k: Ord>(map: Map(k, v), key: k): Map(k, v)

Map.keys : Map(k, v) -> Seq(k)
Map.values : Map(k, v) -> Seq(v)
Map.entries : Map(k, v) -> Seq((k, v))

Map.fromEntries<k: Ord>(entries: Seq((k, v))): Map(k, v)
Map.toEntries : Map(k, v) -> Seq((k, v))
I like get, set, remove. Do not use assoc, dissoc, lookup, insert, unless you want the library to smell like Clojure/Haskell.

Map.get should return Option(v), never undefined.

match Map.get(usersById, id)
  Some(user) => user.name
  None => "Unknown"
For duplicate keys in fromEntries, I would use last value wins. That matches JS Map construction instincts and is easy to explain.

Map.fromEntries([(1, "old"), (1, "new")])
-- key 1 maps to "new"
Useful but maybe v2:

Map.update<k: Ord>(
  map: Map(k, v),
  key: k,
  f: Option(v) -> Option(v)
): Map(k, v)
That one is powerful, but slightly more abstract. It can insert, modify, or remove in one operation:

Map.update(counts, word, old =>
  match old
    Some(n) => Some(n + 1)
    None => Some(1)
)
Set
Core API:

Set.empty : Set(a)
Set.singleton : a -> Set(a)

Set.isEmpty : Set(a) -> Bool
Set.size : Set(a) -> Int

Set.contains<a: Ord>(set: Set(a), value: a): Bool

Set.add<a: Ord>(set: Set(a), value: a): Set(a)
Set.remove<a: Ord>(set: Set(a), value: a): Set(a)

Set.union<a: Ord>(left: Set(a), right: Set(a)): Set(a)
Set.intersect<a: Ord>(left: Set(a), right: Set(a)): Set(a)
Set.difference<a: Ord>(left: Set(a), right: Set(a)): Set(a)

Set.isSubsetOf<a: Ord>(left: Set(a), right: Set(a)): Bool
Set.isSupersetOf<a: Ord>(left: Set(a), right: Set(a)): Bool

Set.toSeq : Set(a) -> Seq(a)
Set.fromSeq<a: Ord>(values: Seq(a)): Set(a)
I would use contains, not has. has is JS-ish, but contains reads better across String, Vector, and Set.

if Set.contains(adminIds, userId)
  allow()
else
  deny()
For mutation-shaped names, I think these are acceptable:

Set.add(s, x)
Set.remove(s, x)
Map.set(m, k, v)
Map.remove(m, k)
They are not as dangerous as push/pop, because their return value is obvious enough in a persistent setting. pop is uniquely cursed because people disagree about whether it returns the removed element or the remaining collection.

Iteration
I would make:

for (k, v) in map
  ...

for x in set
  ...
For Map, iteration yields (k, v) pairs.
For Set, iteration yields values.

Since v1 Map/Set would be Ord-based, iteration order should be key order / value order, not insertion order. That is the one place JS people may be surprised, but it is honest and deterministic.

Operators
No ++ for Set.union.

++ should stay Concat, meaning sequence-like concatenation:

"ab" ++ "cd"
v ++ u
Set union is not concatenation. It should be named:

Set.union(a, b)
Set.intersect(a, b)
Set.difference(a, b)
Likewise, I would not give Map a ++ instance. Use:

Map.merge(left, right)       -- if you add it; right wins
Map.mergeWith(left, right, f)
But I would probably leave Map.merge for v2. set, remove, get, and fromEntries cover most v1 needs.

My v1 cut
Ship this:

Map.empty
Map.isEmpty
Map.size
Map.get
Map.containsKey
Map.set
Map.remove
Map.keys
Map.values
Map.entries
Map.fromEntries

Set.empty
Set.singleton
Set.isEmpty
Set.size
Set.contains
Set.add
Set.remove
Set.union
Set.intersect
Set.difference
Set.isSubsetOf
Set.toSeq
Set.fromSeq
Defer this:

Map.update
Map.merge
Map.mergeWith
Set.map
Set.filter
Map.filter
Map.mapValues
The deferred ones are good, but the first list is enough for v1 and keeps the surface from getting Clojure-sized.


