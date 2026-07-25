# Persistent Collections & the Hidden Node Primitive

**Status:** Design note (not yet implemented). Captures decisions from a design
discussion about moving `Vector` (and later `Map`/`Set`) from TS runtime helpers
into mostly-`.hex` code over a minimal, hidden intrinsic. Not binding until
promoted; recorded so the reasoning is not lost.

## 1. Goal

The spec pins `Vector(a)` as "the persistent 32-way bit-partitioned trie deque
from `@hexagon/runtime`" (Collections Part 3 §4/§11.5; RRB is an explicit Part 1
rejection, and `concat` is documented-linear — so no relaxed/variable nodes are
needed, ever). Today that trie lives **entirely in a TS runtime helper**
(`persistentCollections`), and `stdlib/Vector.hex` is a thin set of wrappers over
it. We want the inverse: **most of the logic in `.hex`, with only a small,
necessary intrinsic in TS.** The same applies later to `Map` and `Set`.

## 2. The three-array taxonomy

Three array-shaped types, distinguished by who may touch them and how:

| Type | Audience | Mutability | Role |
|---|---|---|---|
| `Array(a)` | dev-facing | read-only (borrowed foreign view) | FFI door for real JS arrays (FFI Part 2) |
| `Vector(a)` | dev-facing | immutable (persistent) | the workhorse sequence; devs use it, cannot forge or inspect one |
| `Node` (this note) | **hidden** | **mutable** | the runtime-private trie node; devs never see it |

`Node` is the first type that is *mutable and hidden*. Everything dev-facing stays
immutable (`Vector`) or read-only (`Array`); mutation lives entirely below the
waterline. This is consistent with Hexagon being non-religious about mutability:
mutation is admitted into the *runtime's implementation of the language*, not into
the *language's surface*. (Cf. Rust's `Vec`: `unsafe` inside, safe outside.)

## 3. Why `var` is insufficient

`var` is the wrong *axis*, not merely too weak. `var x = x + 1` reassigns a
**local binding** — the variable slot points at a new value. A trie's transient
construction needs **in-place mutation of a heap object's slots** (`node[i] = x`),
observable through every reference to `node`. Different capability. A stronger
`var` would not help; the missing thing is mutable *heap cells*, and they are used
through ordinary `let` bindings:

```
let node = Node.alloc()        -- binding never changes
Node.set(node, i, child)       -- the array behind it changes, in place
```

(This also matches why `var` is banned inside lambdas: it is deliberately a small
local-reassignment tool, not a shared-state mechanism.)

## 4. The intrinsic: one small mutable array

Immutable.js expresses the whole trie in plain JS because JS hands it a mutable,
index-addressable array for free (`new Array(32)`, `node[i] = x`, `arr.slice()`,
plus bitwise index math). Hexagon *withholds* exactly that (`Vector` is the
immutable workhorse we are defining; `Array(a)` is read-only borrowed; there are
no bitwise operators). So the minimum viable intrinsic is a single hidden array
node — the exact primitive Immutable.js gets from JS:

```
Node.alloc()            -- fresh 32-slot mutable array
Node.get(node, i)       -- read slot i
Node.set(node, i, x)    -- write slot i
Node.copy(node)         -- clone (for copy-on-write down one path)
```

Emits directly to JS array operations. **Everything above it is `.hex`:** node
navigation, the tail, origin/capacity, index math (`div 32` / `mod 32` — no
bitwise needed), slicing, and the public `Vector` surface.

### 4.1 Fixed width 32 (RRB ruled out)

Nodes are always exactly 32 slots. Ruling out RRB (spec-aligned) removes
variable-length internal nodes and size tables. The two inherently-not-full spots
of a *deque* remain and are handled in `.hex`, not by the primitive:

1. **The tail** — the 0..32 append buffer for amortized-O(1) push.
2. **The origin/head side** — the "either end" promise (`[...init, last]`,
   prepend) via the origin/capacity technique (Immutable.js List, not Clojure's
   append-only vector).

Because every node is 32, the primitive needs **no `length` op**: the `Vector`
record carries `size`, tail-count, and origin as plain integer fields in `.hex`.
Cost: a tiny vector still allocates a ≤32-slot array — negligible unless millions
of tiny vectors exist, and switchable to right-sized tails later without touching
trie logic.

## 5. Open decisions

1. **Mutable vs immutable `Node.set`.** Mutable (in-place, transient) matches
   Immutable.js's performance but re-admits controlled mutation into the runtime
   and burdens the author with the *unshared-only* invariant ("never mutate a node
   already shared with an older version" — the classic transient footgun; the type
   system will not catch it). Immutable (`set` returns a fresh copy) is invariant-
   free and simple, at the cost of extra allocation. **Recommendation:** build the
   immutable variant first (correct, spec-shaped, safe), add transients as a
   measured optimization later — Immutable.js itself started without transients.
2. **Visibility / hiding.** Hexagon has no "internal-only" visibility today
   (`export`/opaque control shape, not audience). `Node` must be a **privileged
   intrinsic**: recognized by the compiler, in scope only for runtime modules,
   unimportable from user code. Small new mechanism, but it does not exist yet.
3. **Provisioning dependency.** A mostly-`.hex` `@hexagon/runtime` is a real module
   (not embeddable as TS string constants like the tiny prelude nominals). It needs
   **package imports** (non-relative specifiers / a `std`/runtime root) to be
   importable cleanly. So the trie rewrite depends on that feature landing first.

## 6. Sequencing

1. **Package imports** — so `@hexagon/runtime` and `std/` can exist and be imported
   without embedding.
2. **The `Node` intrinsic** — the small hidden TS core (§4), plus the privileged-
   intrinsic visibility mechanism (§5.2); decide mutable vs immutable (§5.1).
3. **Rewrite `Vector` as a `.hex` trie** over `Node`, inside `@hexagon/runtime`.
   Then `Map`/`Set` on the same primitive.
4. **`Vector` → prelude** — trivial ergonomic wiring once the module is stable;
   orthogonal to the guts, so lowest priority.

This is a "self-host the standard library's core data structures" arc — multi-
session, but exactly what the spec already describes (the runtime *owns* the trie;
this changes that runtime's language from TS to mostly-`.hex`).
