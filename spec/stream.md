# Hexagon Spec: `Stream(a)` — the impure sequence

**Status:** Decided (#355). Shipped: `stdlib/Stream.hex` implements this surface, and this spec is its contract (`stdlib-roadmap.md` records the row).
**Scope:** The `Stream(a)` type, its protocol, the v1 module surface, what is structurally absent, and the division of labour with `Seq`.
**Not in scope:** The effects discipline itself (`effects.md`, assumed throughout); the boundary crossing (FFI Part 3's `Stream` section owns it); `Random`/`Clock` module designs (future specs — they are this type's first customers, not its content); push sequences and async (out of scope per `effects.md` §1).
**Companions:** `effects.md` (§2.5 data-field arrows, §7 the posture), Loops §6 (`Seq`, the pure sibling), FFI Part 3 (launder vs raw crossing), Statements §6.2 (why construction is external), `stdlib-roadmap.md`.

---

## 1. Doctrine

**`Stream(a)` is the effectful pull sequence — `Seq(a)`'s impure nominal sibling, not a mode of it.** The two-point effect lattice degenerates "a sequence parameterized by effect" into two types (`effects.md` §7), so Hexagon ships two types, on the Kotlin `Sequence`/`Flow` and F# `Seq`/`AsyncSeq` precedent:

| | `Seq(a)` | `Stream(a)` |
|---|---|---|
| Pull | pure (`->` field) | effectful (`=>` field — the impure constant) |
| Successor | a tail value: `Some((head, rest))` | none: `Some(head)` — the stream advances |
| Persistence | by re-derivation; positions are values | none; a pull is spent |
| Replay | `memoize` (species (b)) | structurally absent (§5) |
| The world | never (branch (ii)) | is the point |

**Tails are a purity privilege.** A pure sequence can hand out its own future as a value because re-deriving it costs only recomputation. A stream cannot — its next element does not exist until the world is asked — so `Stream` has no tail, and *having no tail is the JS iterator protocol*: a stateful `next()` you call again. That shape identity is what makes the boundary crossing raw rather than adapted (§6).

`Stream` is synchronous. An async source is not a slower `Stream`; it is a different axis, refused here (`effects.md` §1).

## 2. The type and the protocol

```
export opaque record Stream(+a) = { next: () ->! Option(a) }

export let next(source: Stream(a)): Option(a) = (source.next)!()
```

- The field arrow is a data-position `=>`: **the impure constant, never linked** (`effects.md` §2.5) — a data declaration has no signature variable. Pulling performs effects, by declaration.
- `Some(value)`: the next element; the stream has advanced. `None`: exhausted. Pulling an exhausted stream yields `None` again; a source must be written to that contract.
- The exported `next` is thin over the field, and its inferred face is `Stream(a) ->! Option(a)` — the first pull is unconditional. Every call to it wears `!`. Inside the home module — where the opaque type's field is visible and shares its spelling with the companion export — the fused `source.next(...)` is Method Syntax §6's field/method collision, a hard error naming both claimants; the field read is therefore spelled `(source.next)!()`, the parenthesized form §6 itself offers for a callable field. Outside the home module no field is visible (Method Syntax §6's visibility scoping), so `stream.next!()` dispatches to this companion operation cleanly.
- **The `Option` at every pull is accepted for v1**, ambient sources included. An ambient source (entropy, a clock) never ends, so its consumers unwrap `Some` forever; a total variant would need either a second nominal type or partiality by `throw`, both worse than one honest protocol. Revisit bar: field evidence that ambient-source unwrapping dominates real `Stream` code.
- The variance claim `+a` is verified at home per Modules §4.2.1: `a` occurs only in the field's result.

## 3. Construction is external, by design

**A genuine stream source cannot be written in pure Hexagon, and this is the design working.** Successive pulls answer differently, so a source needs state that survives between calls of one closure — exactly what Statements §6.2 forbids a lambda to capture and §6.4 refuses to reify. A `Stream` therefore enters the program only through the world's doors:

- **a user extern** returning `Stream(a)` at the boundary (the raw crossing, §6) — the ordinary case;
- **an intrinsic-door declaration** (`Intrinsics` spec) where the runtime is the implementer — the door `fromSeq` uses (§4.3);
- **a derived stream** — `map`/`filter` over an existing one (§4.2), which own no state of their own.

`Random` and `Clock` are the intended first customers: one impure seam per ambient source, faced as a `Stream`, everything downstream pure. A seeded PRNG is deliberately **not** a `Stream` — deterministic generation from a seed is `Seq.unfold`, pure; entropy is a `Stream`; and a frozen sample is `collect!`ed pure data (§4.4).

## 4. The v1 surface

Consumption drives the world, so consumers wear `->!`. Building a derived stream touches nothing, so the wiring stays silent — `map(randoms, double)` is a bare call in ordinary bodies; effects surface where pulls happen: `next!`, `collect!`, `fold!`, `forEach!`, `find!`. (Inside an inlet-bearing body the wiring call conducts instead — Effects §3.3's qualification, restated in §4.2.)

### 4.1 `next`

§2's protocol function. The manual consumption idiom is a `while` loop matching `next!(source)` — loop bodies are blocks and mark their own calls; `for..in` does not apply (§4.5).

### 4.2 Derived streams: `map`, `filter`

```
export let map(source: Stream(a), transform: a ->? b): Stream(b)
export let filter(source: Stream(a), keep: a ->? Bool): Stream(a)
```

- Both construct a new `Stream` whose stored closure pulls `next!(source)` and applies the callback with `?`. The body itself is neither a source nor a conductor — evaluation builds a value and touches nothing — so the declaration's own colour is unconstrained and, its signature carrying an inlet, stays effect-polymorphic rather than defaulting (Effects §3.4's third arm). At the call this resolves exactly as `compose` does (Effects §3.3): **bare in ordinary bodies** — the common case, and the slogan's — while inside an inlet-bearing body the same call conservatively **conducts** and wears `?`.
- The stored closure's own colour is the conservative join — it performs the unconditional pull and forwards the callback's colour — which is the impure constant, matching the field it is stored into (`effects.md` §2.4, §2.5). Both are writable in ordinary Hexagon: their state is the source itself.
- A derived stream shares its source's cursor: pulling the derivation advances the underlying stream. There is no independence to promise and none is promised.
- **No `take`, no `drop`.** A count-limited *transformer* needs a counter surviving between pulls — cross-call state, inexpressible (§3) and not worth an intrinsic: bounded consumption is what `collect` is for. Record against casual re-litigation; an intrinsic-door `take` may be proposed with field evidence.

### 4.3 `fromSeq`

```
extern from "hex:intrinsic"
    export fun streamFromSeq as fromSeq(source: Seq(a)): Stream(a)
```

A pure sequence driven as a stream: each pull takes one step of the `Seq` and holds the successor — the cursor is the cross-call state, which is why this is an intrinsic-door declaration (§3) with the Intrinsics §4.2 obligations. The teaching point is **injection**: any consumer written against `Stream(a)` can be fed a pure, replayable script — `fromSeq(Seq.iterate(t0, tick))` stands in for a clock in a test, which is the pattern the ambient-source modules are designed around.

### 4.4 Consumers: `collect`, `fold`, `forEach`, `find`

```
export let collect(source: Stream(a), count: Int): Vector(a)
export let fold(source: Stream(a), initial: b, combine: (b, a) ->? b): b
export let forEach(source: Stream(a), action: a ->? Unit): Unit
export let find(source: Stream(a), matches: a ->? Bool): Option(a)
```

- Every consumer's inferred outer face is `->!` — the pull is unconditional — so every consumption is spelled: `collect!(randoms, 10)`. `Stream.fold`'s face, `(Stream(a), b, (b, a) ->? b) ->! b`, is the arrow trio's canonical worked example: linked callback, constant-impure self (`effects.md` §2.4) — and the callback's `->?` is the inlet that makes the face legal (`effects.md` §2.2.1).
- `collect` pulls at most `count` elements (fewer if the stream ends) into a `Vector(a)` — **the frozen sample**: pure data, the stream's one bridge back to the pure world. A `count` of zero or less collects nothing, on `Seq.take`'s convention.
- `fold` and `forEach` drive to exhaustion and so **do not return on an ambient source**; their doc comments must say so (the `Seq` consumers' precedent). `find` stops at the first match, so it is safe on an ambient source that contains one.
- The callbacks are linked `=>`; bodies mark them `?`. A pure callback keeps the consumption exactly as effectful as the pulls — `!` either way — and an impure callback adds nothing to the spelling: the face already rounds up (`effects.md` §2.4).

### 4.5 What the surface refuses

- **No `Iterable` instance, ever**: `toSeq` is a constraint member, members are pure (`effects.md` §5), and a `Stream`'s traversal is not. Consequently **`for x in stream` does not exist**; consumption is the consumers or the `while`/`next!` idiom. The diagnostic for the attempt is the ordinary no-instance failure; a targeted hint may name `forEach!`.
- **No `any`/`all`/`length`** in v1 — each is one `find`/`fold` away, and a minimal first surface is easier to grow than to shrink. `stdlib-roadmap.md` owns additions.

## 5. Structurally absent: replay

There is **no `Stream.memoize`, no `Stream.toSeq`, no replay of any kind** — not omitted, inexpressible: `memoize` claims purity for an owned at-most-once read (species (b), `effects.md` §6.2), and a value that can be pulled again from outside its owner is not at-most-once. The `Seq.memoize` landmine (memoization observably changing how many times effects run) cannot be rebuilt here because the types refuse to meet: `Stream` is not `Seq`, and nothing converts one *to* the other.

This is also a small security win worth stating: **replaying entropy is unspellable.** A drawn sample exists only if the program `collect!`ed it into data on purpose; no combinator quietly retains draws.

The one honest bridge each way: `fromSeq` (pure → impure, §4.3) and `collect!` (impure → pure data, §4.4). A foreign effectful iterable that *should* read as replayable pure data takes FFI Part 3's `Seq` launder instead — that is the boundary's declared choice (§6).

## 6. The boundary, in one paragraph

A foreign iterator-shaped source crosses at a `Stream(a)` position **raw**: protocol to protocol, one thin per-pull translation (`IteratorResult` ↔ `Option`), no adapter object, no memoization spine, no replay manufactured — impurity declared instead of laundered. The same object at a `Seq(a)` position takes Part 3's launder and becomes replayable pure data, at-most-once (a JS random generator crossing as `Seq` is a *lazily frozen sample*). Position is the declaration of intent. FFI Part 3's `Stream` section owns the mechanism, both directions, and the async refusal at the boundary.

## 7. Emission

`Stream(a)` is the `{ next }` record, erased like every record; marks and colours erase with the rest of the effects discipline (`effects.md` §8). The `.d.ts` face and any `[Symbol.iterator]`/iterator-protocol accommodation on the emitted value are FFI Part 3's `Stream` section's to fix, not this module's.

## 8. Rejected alternatives (do not re-litigate without new information)

- **`Seq(a, e)` — one type, effect-parameterized**: `effects.md` §11's refusal, applied.
- **A tail-carrying impure sequence** (`next: () ->! Option((a, Stream(a)))`): a tail on an impure pull promises a "rest" the world has not decided yet; every strengthening of that promise converges on either memoization (which is `Seq` + launder) or lying. No-tail is also the zero-cost boundary shape (§1).
- **`Stream.memoize` / `toSeq`**: §5 — the landmine, declined structurally.
- **`take`/`drop` transformers**: §4.2 — cross-call state; `collect` is the bounded form.
- **Push (`Observable`) in v1**: future sibling; needs its own design (no head, Meijer duality, JS-native priority) and files its own issue.

## 9. Decisions log

| Decision | Where |
|---|---|
| Nominal sibling, not an effect parameter; no tail; tails are a purity privilege; sync only | §1 |
| `Stream(+a) = { next: () ->! Option(a) }`; field arrow the impure constant, written; exported `next` face `->!`; `Option`-per-pull accepted for v1 with revisit bar | §2 |
| Construction is external: externs, the intrinsic door, or derivation — cross-call state is inexpressible in pure Hexagon | §3 |
| `Random`/`Clock` are the first customers; seeded PRNG is `Seq.unfold`, entropy is `Stream`, samples are `collect!`ed data | §3, §4.4 |
| v1 surface: `next`, `map`, `filter`, `fromSeq`, `collect`, `fold`, `forEach`, `find`; wiring bare in ordinary bodies (conducts under an inlet — Effects §3.3/§3.4), consumption `!` | §4 |
| No `Iterable` instance; no `for..in`; no `take`/`drop`; no `any`/`all`/`length` in v1 | §4.2, §4.5 |
| Replay structurally absent: no `memoize`, no `toSeq`; entropy replay unspellable | §5 |
| Boundary: raw protocol-to-protocol crossing at `Stream` positions; the launder stays at `Seq` positions | §6 |
