# Hexagon FFI Part 3: `Seq(a)` Interoperation

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing. Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §3, drafted per `spec/notes/ffi-roadmap.md` Part 3. The question the draft recorded as a promotion blocker (adapter identity, §2.1) was resolved by James after independent review. Loops/Ranges/Iteration §6 is already normative for `Seq(a)` itself — the type, `Seq.next`, persistence, laziness, and emission onto the JS iterable protocol; this part specifies only the **boundary**: what a foreign iterable becomes in Hexagon, and what an exported Hexagon sequence is to JavaScript.
**Scope:** Top-level `Iterable<a>` input; the persistent memoizing inbound adapter (one iterator, one shared lazy spine, no replayability probing, fresh adapter per crossing with no identity cache — §2.1); retention and reclamation; iterative rather than recursive traversal; iterator closure and the no-deterministic-disposal rule; foreign throws and malformed iterator results; the replayable exported traversal; the `Iterable`-not-`Iterator` boundary; and the v1 restriction on nested adapter-requiring positions (by reference to Part 1 §5.3).
**Not in scope:** `Seq(a)`'s intrinsic semantics (Loops §6, consumed); single-pass `Iterator<a>` acceptance, async iteration, callback-position adapters, and any separate resource-managed stream type (**deferred**, §10); `Array.toSeq`'s borrow interaction (Part 2 §6.2/§9); callback signatures generally (Part 6).
**Companions:** Part 1 §2.3/§3/§5.3 (adapted category, failure doctrine, nested restriction); Part 2 §9 (`Array.toSeq`); Loops/Ranges/Iteration §6; Collections Part 5 §1/§4 (`Seq` as conversion currency; instance table); Exceptions §6 (`JsError`); `spec/notes/ffi-agenda.md` (stale non-crossing statement superseded, §1).

---

## 1. Doctrine

`Seq(a)` crosses the v1 boundary, in both directions. Loops §6 fixed the pieces that make this possible: `Seq.next : Seq(a) -> Option((a, Seq(a)))` must not consume its argument — sequence positions are persistent — and `Seq(a)` emits onto JavaScript's native iterable/iterator protocol, facing as `Iterable<a>` in `.d.ts`.

> **Edit note (for `spec/notes/ffi-agenda.md`, applied on next touch):** the agenda's earlier statement that `Seq` does not cross the v1 boundary was stale and is superseded. Whether `Seq` crosses is not open.

The required distinction, which the whole part turns on: a **replayable** JS iterable (each `[Symbol.iterator]()` begins a fresh traversal — the shape a generator *factory* provides, close to C# `IEnumerable<T>`) is not the same thing as a **generator object or ordinary iterator**, which is mutable and commonly single-shot — `[Symbol.iterator]()` may return the same object, and calling `next()` consumes it. The latter can never be treated directly as a persistent Hexagon sequence position.

The public correspondence:

```text
Hexagon Seq(a)                  -> replayable JavaScript Iterable<a>
foreign Iterable<a>             -> persistent memoized Seq adapter
single-shot IterableIterator<a> -> the same persistent memoized adapter
```

---

## 2. Inbound adaptation is automatic and type-directed

Every foreign `Iterable<a>` returned or supplied at a boundary position declared as `Seq(a)` is accepted and wrapped by the runtime. Ordinary `extern` use requires **no explicit conversion call** — this is Part 1 §2.3's adapted category, and it applies at supported **top-level** positions only (§9). A low-level `Seq.fromIterable`-style facility may exist later, but it is not the normal checked-boundary mechanism and is not v1 surface.

Two different objects are involved, and they must not be conflated:

- **The stable exported function wrapper** (Part 7's) is the module-level JavaScript function generated for an exported Hexagon function whose signature needs boundary plumbing. It is allocated once with the ESM binding and has stable JS identity.
- **The adapter** is per adapted value: it holds the one source iterator and the memoization spine (§4) for a *particular* incoming iterable, so it can only come into existence when that value crosses.

```text
one stable exported function wrapper
    -> on each call, adapt each incoming Iterable value
        -> one iterator and one memoization spine for that adapted value
```

### 2.1 Adapter identity: fresh per crossing

> **Every boundary crossing receives a fresh adapter. The runtime never caches adapters by foreign object identity.** Each adapter owns one source iterator and one memoization spine; the stable exported function wrapper owns none of that per-value state.

Consequences, stated as documented behavior:

- **Repeated crossings of a single-pass generator observe its current position.** The second adapter's `[Symbol.iterator]()` returns the same mutable generator object, so the second crossing continues from wherever earlier demand left it — possibly exhausted. This is exactly what two `for...of` loops over one generator observe in JavaScript (and two consumers of one generator in Python); the boundary preserves the foreign source's behavior rather than strengthening it. **The rewrite, when both consumers should see the same elements: cross once and share the resulting `Seq`** — persistence within one adapted sequence (§4) already provides memoized both-see-the-same semantics, explicitly.
- A replayable effectful iterable crossing twice runs its effects twice and observes current state each time, as two foreign traversals would.

Why no identity cache, recorded against re-litigation: a cache keyed on the foreign iterable must hold its adapter either strongly or weakly, and both lose. A `WeakMap` has weak *keys* but **strong values** — the entry would pin the adapter and its spine head, and therefore the entire forced history, for as long as the foreign iterable is alive, even with no Hexagon position reachable, violating §5's reachability rule. Making the *value* weak instead (a `WeakRef`) makes whether the second crossing shares or gets a fresh adapter depend on GC timing — observable semantics contingent on garbage collection, which is disqualifying on its own. Identity caching also cannot deliver its promise in general: two distinct iterable objects over one shared cursor would still interleave, so the cache would protect exactly one aliasing case while teaching a false rule. Cache scope compounds it (a global cache couples unrelated modules; a per-wrapper cache makes sharing depend on which exported function was called).

---

## 3. The adapter never probes or classifies replayability

Requesting two iterator objects proves neither semantic replayability nor independence: the two may share a queue, a socket, a clock, a mutable store, effects, or one underlying cursor. The adapter must not call `[Symbol.iterator]()` speculatively and must not restart foreign computation to find out what kind of iterable it holds.

---

## 4. One iterator, one shared lazy memoization spine

This is the **uniform inbound rule** — there is no fast path for "obviously replayable" sources and no degraded mode for single-shot ones:

- The adapter requests the source iterator **once, on first demand**.
- Each sequence node memoizes **exactly one outcome**: end, `(value, tail)`, or foreign failure (§7).
- Repeating `Seq.next` at the same position therefore neither advances the source nor repeats foreign effects.

A single-shot generator works without receiving weaker semantics; a replayable iterable is deliberately treated the same way. Memoization is what makes the foreign iterator's mutability invisible behind `Seq`'s persistence.

---

## 5. Retention: reachability governs reclamation

Memoization is represented by **persistent lazy nodes, not a permanent central history array**:

- A reachable sequence position retains the forced suffix needed to reproduce observations from that position.
- Once an older position is unreachable, ordinary garbage collection may reclaim its cached prefix.
- The shared iterator state must not keep an unnecessary back-reference to the sequence head.
- **No cache limit may evict reachable history** — that would violate `Seq.next` persistence. There is no configuration knob that trades persistence for memory.

The unavoidable space rule, stated for users: consuming a very large or infinite single-shot source while retaining an earlier `Seq` position retains the forced portion reachable from that position; advancing while retaining only the current cursor permits unreachable prefixes to be collected.

---

## 6. Traversal is iterative, never recursion-dependent

`for x in xs`, `while`-based cursor consumption, and runtime combinators such as `Seq.fold` must use **constant-stack iteration** (`for...of`/loops in emitted JavaScript). Hexagon does not promise tail-call optimization; recursive sequence traversal remains ordinary recursion and may overflow the stack, so it is **not** the documented streaming idiom. The documented idiom is the loop and the combinator, both of which the implementation must keep flat.

---

## 7. Failure: throws and malformed results

### 7.1 Foreign throws, memoized per position

Throws from `[Symbol.iterator]()`, `next()`, protocol property access, or an actually invoked `return()` surface through the `JsError` path unchanged (Part 1 §7; Exceptions §6). **If forcing a sequence node fails, that node remembers the failure**: forcing the same persistent position again must not advance the iterator and must not repeat the foreign operation. Failure is an outcome like any other in the §4 spine.

### 7.2 Malformed iterator results and protocol access order

The adapter performs only the minimum protocol check native iteration performs: `next()` must return an object. A malformed result produces a JavaScript `TypeError`, observed in Hexagon through `JsError`; throwing `done` or `value` accessors likewise follow the ordinary foreign-throw path. **There is no separate Hexagon `InvalidIteratorError` and no general deep validation of foreign values** — this is Part 1 §3.2's "protocol participation inherently requires a check" case, at its minimum.

Because `done` and `value` may be effectful getters, forcing one node follows JavaScript's native iteration order exactly — a clarification of the already-selected protocol, not a new design decision:

1. Call `next()` once.
2. Require an object result (else the `TypeError` above).
3. Read `done` once and boolean-coerce it.
4. If true, memoize **end** without reading `value`.
5. Otherwise read `value` once and memoize `(value, tail)`.
6. A throw at any step is memoized as that node's failure outcome (§7.1) at whichever step produced it.

Each property is read once per forcing, and per §4's memoization, once per position ever.

---

## 8. Iterator closure: no deterministic disposal

`Seq` provides **no deterministic disposal** of an inbound iterator:

- Natural exhaustion completes the source.
- Ending one loop early must **not** call the shared iterator's `return()` — the same persistent sequence, or a retained tail, may be consumed later.
- Garbage collection cannot promise a timely `return()`.
- An exported JS traversal's `return()` (§9.1) ends **that traversal** without invalidating the underlying Hexagon sequence.

Consequently: **resource-owning iterators that require prompt closure are not suitable `Seq` inputs.** They need independently managed lifetime (close the resource explicitly, outside the sequence) or a future explicit single-pass/resource abstraction (§10). This is a documented suitability rule, not a detectable error — the trusted boundary cannot see whether an iterator owns a resource.

---

## 9. The exported face and the boundary shape

### 9.1 An exported Hexagon `Seq` is replayable

Its `.d.ts` face remains the necessarily weaker `Iterable<a>`, but the exported value is stronger than the face promises: **each call to `[Symbol.iterator]()` creates an independent traversal cursor at the exported Hexagon sequence position.** Repeated JavaScript traversals observe the same memoized Hexagon sequence rather than re-running its lazy computation and effects. One JS consumer's early `return()` ends only its own cursor (§8).

### 9.2 The v1 boundary accepts `Iterable<a>`, not bare `Iterator<a>`

Generator objects normally qualify because they implement `IterableIterator<a>`. A bare iterator without `[Symbol.iterator]()` must be wrapped as an iterable by foreign code — a one-line shim on the JS side. A future explicitly single-pass or resource-aware type may accept iterators directly, but **it must not be called `Seq` and must not weaken `Seq` persistence** (§10).

### 9.3 Top-level positions only

The automatic adapter exists at supported top-level boundary positions. `Seq` nested inside a representation-direct aggregate or borrowed container (`Array(Seq(Int))`, a `Seq`-valued record field crossing directly) is rejected by Part 1 §5.3's hard error, with its named rewrite. `Seq` in callback parameter or result positions is rejected by Part 6's v1 callback rule. Neither restriction is weakened or restated here.

---

## 10. Deferred surfaces (recorded, not designed)

Excluded from v1 and reserved for later work; nothing here pre-commits their design:

1. **Single-pass `Iterator<a>` acceptance** — a future explicitly single-pass or resource-aware type (not named `Seq`; §9.2).
2. **Async iteration** — `AsyncIterable`, `AsyncSeq`, and rejection semantics await the async specification (Part 1 §4.3).
3. **Callback-position adapters** — `Seq` in callback signatures, with the wrapper-identity, retention, and lifetime questions they entail (Part 6 owns the rejection and its revisit bar).
4. **A separate resource-managed stream type** — the home for prompt-closure semantics that §8 deliberately refuses to give `Seq`.

---

## 11. Diagnostics checklist

This part introduces **no new hard errors**; the boundary-shape errors it relies on land elsewhere:

| Situation | Owner |
|---|---|
| `Seq` nested in a direct aggregate or borrowed container | Part 1 §5.3 (hard error with named rewrite) |
| `Seq` in a callback parameter/result position | Part 6 (v1 callback rule) |
| Malformed foreign iterator result | not a diagnostic — runtime JS `TypeError` via `JsError` (§7.2) |
| Resource-owning iterator supplied as a `Seq` input | not detectable — documented suitability rule (§8) |

---

## 12. Open questions

None. The one blocker this draft originally recorded — adapter identity across repeated crossings — was resolved by James after independent review: **fresh adapter per boundary crossing, no identity cache**, now normative in §2.1.

Everything else the roadmap assigns to this part is closed by the decision record; the genuinely undecided neighboring surfaces are the §10 deferrals, each with a named owner. (The precise runtime representation of the adapter's lazy nodes is an implementation choice already licensed by Loops §6.5, constrained by §4–§5's semantics.)

---

## 13. Decisions log (quick reference)

| Decision | Where |
|---|---|
| `Seq` crosses the v1 boundary both ways; stale agenda statement superseded (edit note issued) | §1 |
| Correspondence: `Seq(a)` → replayable `Iterable<a>`; foreign `Iterable<a>`/single-shot `IterableIterator<a>` → one persistent memoized adapter | §1 |
| Inbound adaptation automatic and type-directed at top-level declared `Seq(a)` positions; no explicit conversion call; stable exported function wrapper (Part 7) distinct from the per-value adapter | §2 |
| Fresh adapter per boundary crossing; no identity cache (strong-value pinning vs weak-value GC-dependence both disqualifying); repeated crossings of a single-pass generator observe its current position — rewrite: cross once and share the `Seq` | §2.1 |
| No replayability probing; no speculative `[Symbol.iterator]()`; no restarted foreign computation | §3 |
| Uniform rule: one iterator requested on first demand; one shared lazy memoization spine; one memoized outcome per node | §4 |
| Reachability governs reclamation; no central history array; no cache limit may evict reachable history | §5 |
| Traversal is constant-stack iterative; recursion is not the streaming idiom; the space rule stated | §6 |
| Protocol throws surface via `JsError` and are memoized per position | §7.1 |
| Malformed results = JS `TypeError` via `JsError`; no `InvalidIteratorError`; no deep validation; forcing follows native protocol order (`next()` once, `done` once, `value` once and only if not done) | §7.2 |
| No deterministic disposal; early loop exit must not call shared `return()`; resource-owning iterators unsuitable | §8 |
| Exported `Seq` replayable: independent cursors per `[Symbol.iterator]()` over the same memoized sequence; face stays `Iterable<a>` | §9.1 |
| Boundary accepts `Iterable<a>` only; bare iterators wrapped by foreign code; future single-pass type must not be called `Seq` | §9.2 |
| Nested and callback positions rejected — owned by Part 1 §5.3 and Part 6 | §9.3 |
