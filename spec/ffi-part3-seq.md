# Hexagon FFI Part 3: `Seq(a)` Interoperation

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing. Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §3, drafted per `spec/notes/ffi-roadmap.md` Part 3. The question the draft recorded as a promotion blocker (adapter identity, §2.1) was resolved by James after independent review. Loops/Ranges/Iteration §6 is already normative for `Seq(a)` itself — the type, `Seq.next`, persistence, laziness, and emission onto the JS iterable protocol; this part specifies only the **boundary**: what a foreign iterable becomes in Hexagon, and what an exported Hexagon sequence is to JavaScript. **Revised 2026-07-28 (defect 12 ruling, Fable in the spec seat):** §2.2, §9.4–§9.7 added; §5 and §9.1 annotated. The de-intrinsification arc had left §9.1's promise without a mechanism — the exported value was a bare record with no `[Symbol.iterator]` while the `.d.ts` face still said `Iterable<a>` — and the divergence covered value, parameter, and result positions. The ruling restores the face as **representation**, not boundary plumbing, and specifies all three positions uniformly.
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

Three kinds of objects are involved, and they must not be conflated:

- **The stable exported function wrapper** (Part 7's) is the module-level JavaScript function generated for an exported Hexagon function whose signature needs boundary plumbing. It is allocated once with the ESM binding and has stable JS identity.
- **The stable imported extern wrapper** (Part 4 §4.3) is the symmetric local binding generated when an extern `fun` signature needs inbound adaptation, such as a foreign `Iterable<a>` result declared as `Seq(a)`. Representation-direct extern functions remain raw imports. Like the exported wrapper, an imported wrapper is allocated once and holds no per-value adapter state.
- **The adapter** is per adapted value: it holds the one source iterator and the memoization spine (§4) for a *particular* incoming iterable, so it can only come into existence when that value crosses.

```text
one stable boundary function wrapper
    -> on each call, adapt each incoming Iterable value
        -> one iterator and one memoization spine for that adapted value
```

### 2.1 Adapter identity: fresh per crossing

> **Every boundary crossing receives a fresh adapter. The runtime never caches adapters by foreign object identity.** Each adapter owns one source iterator and one memoization spine; the stable exported function wrapper owns none of that per-value state.

Consequences, stated as documented behavior:

- **Repeated crossings of a single-pass generator observe its current position.** The second adapter's `[Symbol.iterator]()` returns the same mutable generator object, so the second crossing continues from wherever earlier demand left it — possibly exhausted. This is exactly what two `for...of` loops over one generator observe in JavaScript (and two consumers of one generator in Python); the boundary preserves the foreign source's behavior rather than strengthening it. **The rewrite, when both consumers should see the same elements: cross once and share the resulting `Seq`** — persistence within one adapted sequence (§4) already provides memoized both-see-the-same semantics, explicitly.
- A replayable effectful iterable crossing twice runs its effects twice and observes current state each time, as two foreign traversals would.

Why no identity cache, recorded against re-litigation: a cache keyed on the foreign iterable must hold its adapter either strongly or weakly, and both lose. A `WeakMap` has weak *keys* but **strong values** — the entry would pin the adapter and its spine head, and therefore the entire forced history, for as long as the foreign iterable is alive, even with no Hexagon position reachable, violating §5's reachability rule. Making the *value* weak instead (a `WeakRef`) makes whether the second crossing shares or gets a fresh adapter depend on GC timing — observable semantics contingent on garbage collection, which is disqualifying on its own. Identity caching also cannot deliver its promise in general: two distinct iterable objects over one shared cursor would still interleave, so the cache would protect exactly one aliasing case while teaching a false rule. Cache scope compounds it (a global cache couples unrelated modules; a per-wrapper cache makes sharing depend on which exported function was called).

### 2.2 The inbound door: a genuine `Seq` passes by identity *(added 2026-07-28, defect 12 ruling)*

Every inbound crossing at a declared `Seq(a)` position goes through one **inbound door**, and the door distinguishes exactly two cases:

- **A genuine Hexagon `Seq` value is not adapted. It crosses by identity.** This is Part 7 §6's decided clause — "the existing erased runtime value crosses out and back by identity" — applied at the position where it was previously unimplementable: a `Seq` that Hexagon handed out and JavaScript hands back is the same value, same spine, same persistence regime, with no memoizing layer silently added. Since every `Seq` value carries the boundary traversal protocol (§9.4), a genuine `Seq` *also* satisfies the `Iterable<a>` face, so the two cases overlap on the value's capabilities and the door resolves the overlap in identity's favor.
- **Any other iterable receives a fresh adapter**, exactly per §2.1, which is unchanged and whose subject this case is. §2.1's "every boundary crossing receives a fresh adapter" governs *adapted foreign values*; a genuine `Seq` returning home is not an adapted value and never was — it is Part 7 §6's identity crossing.

Recognition is by the representation's own mark (the boundary traversal protocol of §9.4); the exact test is emitter latitude. The observable contract: genuine `Seq` ⇒ identity; other iterable ⇒ fresh adapter; a non-iterable at a `Seq(a)` position remains a trusted-boundary contract violation (Part 1 §3.1) with no validation added. A JavaScript value fabricated to look like a `Seq` record is likewise §3.1 territory, as fabricating any branded or opaque value is.

Why identity and not re-adaptation, recorded: re-adapting a genuine `Seq` would wrap a possibly re-deriving spine (Loops §6.4's internal default) in a memoizing one, so a round-trip through JavaScript would *observably change the value's persistence regime* — and break the identity idioms Part 7 §6 promises (a JS consumer storing and comparing the value, a Hexagon consumer relying on one shared spine). The rewrite §2.1 teaches ("cross once and share the `Seq`") also presupposes that the shared value survives crossings as itself.

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

*(Addendum, 2026-07-28, defect 12 ruling.)* The **memoized boundary view** of §9.4 obeys the same rule from the `Seq` value's side: the view and its forced prefix are reachable from the value that JavaScript traversed, so they live exactly as long as that value does and are collected with it. No cache limit may evict the view's reachable history (same clause as above), and a `Seq` never traversed by JavaScript carries no view and no buffer. The user-facing space rule this adds: handing JavaScript a `Seq` position and letting foreign code traverse far pins the forced portion for that value's lifetime — which is §9.1's memoization promise costing what it costs, not a leak.

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

*(Annotation, 2026-07-28.)* This promise survived the de-intrinsification unchanged — it was reaffirmed twice after the re-derivation default was adopted (Loops §6.4's "the export boundary memoizes unconditionally"; the ledger's `Seq.hex` row) — but its mechanism was destroyed with the intrinsic and never replaced. §9.4 now supplies the mechanism; nothing in this section's promise is weakened or strengthened by it.

### 9.2 The v1 boundary accepts `Iterable<a>`, not bare `Iterator<a>`

Generator objects normally qualify because they implement `IterableIterator<a>`. A bare iterator without `[Symbol.iterator]()` must be wrapped as an iterable by foreign code — a one-line shim on the JS side. A future explicitly single-pass or resource-aware type may accept iterators directly, but **it must not be called `Seq` and must not weaken `Seq` persistence** (§10).

### 9.3 Top-level positions only

The automatic adapter exists at supported top-level boundary positions. `Seq` nested inside a representation-direct aggregate or borrowed container (`Array(Seq(Int))`, a `Seq`-valued record field crossing directly) is rejected by Part 1 §5.3's hard error, with its named rewrite. `Seq` in callback parameter or result positions is rejected by Part 6's v1 callback rule. Neither restriction is weakened or restated here.

*(Note, 2026-07-28.)* §9.4's representation rule incidentally makes *outbound* nested `Seq` values honest (every `Seq` value satisfies the iterable protocol wherever it sits), but Part 1 §5.3's rejection is inbound-motivated and **stands unmodified**; whether it can ever be relaxed for outbound-only positions is a separate question this ruling does not open.

### 9.4 The mechanism at every position (defect 12 ruling, 2026-07-28)

The `Seq` face's authority was never actually in conflict once each decided clause is read at its own level. Part 1 §4.1's outbound row already states the contract this section restores: the outbound representation is "the runtime sequence value, **natively implementing the JS iterable protocol**". Part 7 §6's opaque-value clause forbids a *boundary artifact* — a wrapper, tag, or validation added at the crossing — not a representation. And ruling R1's "sole compiler-side constructor" confines representation knowledge to a named compiler-owned family, which this section extends by one member rather than dissolves. What gives way is only auxiliary phrasing: Loops §6.5's "boundary bridges supplying the iterable face" (the face now rides the value; edit note issued) and the R1 knowledge clause (amended below).

**The representation rule.** Every `Seq` value carries the JavaScript iterable protocol — a **boundary traversal method** at `[Symbol.iterator]` — as part of its emitted representation, alongside `pull` (Loops §6.6). It is one shared method for all `Seq` values, never a per-value closure; whether it rides an own-property slot or a shared prototype is emitter latitude (`Range`, `Map`, and `Set` values already carry the protocol the same way). The method is representation from birth, at every construction site (`Seq.hex`'s combinators and the §2 adapter alike), so it is present at every position without boundary plumbing — which is exactly why Part 7 §6 is satisfied rather than traded away: the value crosses out and back by identity, unmodified at the crossing, and what JavaScript finds on it was always there.

**The memoized boundary view.** The traversal method delivers §9.1 with these observable semantics, all normative:

1. Each `[Symbol.iterator]()` call opens an **independent cursor** at that `Seq` position.
2. All cursors ever opened on one `Seq` value share one **memoized boundary view** of it: across all foreign traversals of that value, each position's derivation runs **at most once** — the first cursor to reach a position forces it; every later observation replays the memoized outcome. Cursors may interleave freely; whichever cursor reaches the shared frontier advances it.
3. The view is created **lazily, at the value's first foreign traversal**. A `Seq` JavaScript never traverses carries no view, no buffer, and no cost beyond the shared method itself.
4. **Failure is memoized per position**, uniformly with §7.1: if forcing a position throws, every later foreign observation of that position replays the same thrown value and the underlying computation is not re-run.
5. An infinite or unbounded `Seq` forces only what some cursor has reached (laziness preserved through the view).
6. A cursor's early `return()` ends that cursor only (§8); the value and the view remain valid.
7. Retention follows §5's addendum: the view lives and dies with the value.

These are precisely the Loops §6.4 properties of the memoizing spine, and the representative implementation is the composed R1 pair — the inbound spine (§4–§7) driven over the value's own protocol traversal — verified to satisfy every one of them, including #124's failure memoization. The composition is representative, not normative; the seven properties are the contract. (Where the value's own spine already memoizes — an adapter-built `Seq` — an emitter may let the method drive `pull` directly, since the two are observationally indistinguishable there.)

**Channel separation, normative.** Hexagon-internal traversal — `for x in`, `Seq.next`, every combinator and consumer — drives the §6.2 protocol (`pull`) and **never the boundary traversal method**; it neither creates nor consults the boundary view. The internal persistence default (re-derivation, Loops §6.4) is therefore untouched by this ruling: the same value re-derives when Hexagon re-traverses it and replays memoized outcomes when JavaScript re-traverses it, which is exactly what "the export boundary memoizes regardless of internal default" has always meant. In particular, an emitter must not lower `for x in` to native `for...of` over the record — that would silently import boundary memoization (and its retention) into internal semantics.

**The three positions, uniformly:**

- **Value export — direct, no wrapper.** The ESM binding is the record, for Hexagon importers and JavaScript consumers alike; the record satisfies its `Iterable<a>` face by representation. (An export-site wrapper is impossible here — it would hand Hexagon importers a non-`Seq` — which is why the representation rule is the only shape that covers this position at all.)
- **Result position — direct, no wrapper.** An exported function's `Seq` result, and equally a `Seq` argument Hexagon passes *to* a declared foreign callable (the outbound extern direction, which the defect's statement did not reach but which had the same divergence), are honest by representation.
- **Parameter position — Part 7 §7 occasion 1's stable wrapper, now specified.** The wrapper routes each top-level `Seq(a)` argument through §2.2's inbound door — genuine `Seq` by identity, other iterable through a fresh §2.1 adapter — then calls the module-internal function. Hexagon importers reach the export through the same ESM binding and therefore the same wrapper; the identity pass-through makes it semantically transparent to them, at the price of one recognition check per `Seq`-typed argument per cross-module call. Same-module calls bind the internal function directly and pay nothing. The symmetric extern inbound wrapper (Part 4 §4.3, a foreign result declared `Seq(a)`) uses the same door, which is what makes a round-tripped `Seq` return by identity.

**Ruling R1, amended.** The inbound adapter remains the sole compiler-side *constructor* of `Seq` records, and the outbound driver the sole compiler-side consumer of `pull`. The compiler-side representation family grows from that pair to a named set of four, all one runtime-helper home: the inbound adapter, the outbound driver, the boundary traversal method (composed from the first two), and the inbound door's recognition check. Nothing outside that family — no other emitter path, no checker table, and no `.hex` source — knows the record's shape. The conformance round-trips that made the pair break loudly (R5) extend over the two new members.

**Diagnostics: none.** This ruling adds no user-facing error and no diagnostic text, so the Rewrite Rule is not engaged. The §11 checklist is unchanged.

### 9.5 What `Vector`, `Set`, and `Map` inherit (binding)

`Seq` pilots the pattern the other collections inherit (ledger §2, the `Seq.hex` obligation row; §5.2 item 2). The following is **binding spec now**, not advice, so that no companion arc re-derives it:

1. **The representation rule is inherited as an observable contract, not as an attachment mechanism.** An exported collection value satisfies its declared face's traversal protocol *as part of its representation*, never via a boundary artifact. This is stated over observations precisely so each representation pays its own way: `Map` and `Set` HAMT values already carry `[Symbol.iterator]` (paid); `Vector`'s current native-array representation is natively iterable (paid, at zero — a native array cannot and need not carry a custom method); the future persistent-vector core (ledger §5.1 residue) must keep the protocol on the value when it lands. Iteration yields what each collection's own spec gives its traversal: elements in index order for `Vector`, entries as `[k, v]` pairs for `Map`, members for `Set`, in the traversal order Collections Parts 3–4 define (unspecified-but-per-value-stable where those specs say so).
2. **Faces extend their iterable protocol.** `Hex.Vector<a>` and `Hex.Set<a>` extend `Iterable<a>`; `Hex.Map<k, v>` extends `Iterable<[k, v]>` — Part 1 §8.2, added by this ruling on the `Hex.Range` precedent (§8.1), same brand doctrine: an arbitrary iterable does not satisfy the face.
3. **Identity crossing, both directions, no doors.** Their faces are nominal brands, not the structural `Iterable<a>`, so **there is no inbound adaptation to inherit**: occasion 1 (Part 7 §7) is `Seq`-only, because only `Seq`'s parameter face admits arbitrary foreign iterables. A genuine collection value crosses out and back by identity (Part 7 §6, already true today); anything else at a branded position is a §3.1 contract violation, unchanged.
4. **No boundary memoization to inherit.** The memoized boundary view exists because `Seq` is lazy and possibly effectful; strict persistent structures need none of it. What they inherit from §9.4's semantics is only item 1: each `[Symbol.iterator]()` is an independent cursor over the persistent value.
5. **Nothing any of the three cannot pay.** The audit behind this section found the value-level cost already paid three times over (`Map`, `Set`, and `Vector`-as-array), and the face-level cost is declaration text. What it also found, recorded so it is filed rather than inherited: the *currently emitted* `.d.ts` faces (`ReadonlyArray`, `ReadonlySet`, `ReadonlyMap`, bare `Iterable<number>` for `Range`) diverge from Part 1 §4.1/§8's decided `Hex.*` faces — pre-existing implementation debt of the `.d.ts` generator, neither created nor altered by this ruling, owed its own defect entry.

### 9.6 Rejected alternatives (recorded against re-litigation)

1. **A dual-binding export protocol** (raw ESM binding for Hexagon importers, wrapped binding for JavaScript). Rejected: it changes the module emission contract for *every* module to serve one type; ESM cannot hide the raw binding, so the unbranded value leaks anyway; and it breaks the decided doctrine that one emitted binding is simultaneously the Hexagon and the JavaScript interface. Price avoided: none that the representation rule does not also avoid — the dual binding buys nothing over §9.4 once the value itself is honest.
2. **Changing the face to Part 7 §6's opaque brand.** Rejected: it would overturn §9.1, its two post-de-intrinsification reaffirmations (Loops §6.4; the ledger row), Part 1 §4.1's `Iterable<a>` rows, and §1's doctrine that `Seq` crosses both ways — and it would strand occasion 1, which is decided spec accepting arbitrary foreign iterables at `Seq(a)` parameters. The price of keeping it out: none; the brand's actual content (identity, no boundary artifact) is satisfied by §9.4.
3. **A branded face extending `Iterable<a>`** (`Hex.Seq<a>`, on the `Hex.Range` model). Rejected for `Seq` specifically: the parameter face must remain structural `Iterable<a>` (occasion 1), so branding could apply only to value/result positions, splitting one type's face by position — a per-position asymmetry no other type pays and §9.1's "face stays `Iterable<a>`" already decides against. Recorded price: JS-side round-trips are typed as `Iterable<a>` back into `Seq(a)` positions rather than nominally, which the identity pass-through (§2.2) makes semantically safe.
4. **A face delivered by a declared operation instead of the representation** (the intrinsic-door "fourth answer": consumers call `toJsIterable`). Rejected: it leaves every raw exported value dishonest against its `.d.ts` — the defect itself — and demotes a decided automatic property to a manual convention. The door (`spec/intrinsics.md`) is for operations a module owns, not for faces values must already have.
5. **The face without memoization** (the traversal method drives `pull` per cursor; replayable persistence only). Rejected: it narrows §9.1's memoization clause, which was reaffirmed twice *after* re-derivation became the internal default, so the corpus has already priced and re-chosen boundary memoization. Recorded price of keeping memoization: the lazily created per-value view and its retention (§5 addendum), and the deliberate two-channel asymmetry (§9.4 channel separation).

### 9.7 The `toJsIterable` obligation, discharged

The ledger's retention table (`stdlib-roadmap.md` §5.1, the `Seq.hex` row) kept "the `toJsIterable` bridge" as runtime residue, and the surface was owed alongside this ruling so the face and the operation exposing it would be decided together. Ruled together, they merge:

- **The bridge** is the boundary traversal method of §9.4. It remains exactly where the retention table kept it — runtime-provided residue behind `Seq.hex` (a mutable buffer cannot be `.hex`, Statements §6.2) — under its real identity: it is the face, not a conversion.
- **The public operation** is **`Seq.memoize`** (Loops §6.4; declared through the intrinsic door, `spec/intrinsics.md` §3.2). After §9.4, a public `toJsIterable : Seq(a) -> ...` could mean only two things: the identity (every `Seq` already is its own replayable, boundary-memoizing JavaScript iterable — there is nothing to convert to) or the explicit shared-memoizing-spine view — which is `memoize`, verbatim. The surface the obligation wanted therefore ships under its already-decided name, and a second name for either meaning is rejected as duplicate surface (naming doctrine, ledger §1) — doubly so in the pilot, where a redundant `toJsIterable` would be inherited as a redundant conversion by three more companions.
- The result type the original sketch imagined (`JsIterable(a)`, `spec/notes/seq-core-representation.md` §3) names a type that does not exist and that §9.4 leaves without a purpose; introducing it was considered and rejected as dead surface (a value of it could do nothing a `Seq` cannot).

The §5.1 row is updated by edit note to record this discharge; nothing of the obligation remains owed. If a genuinely distinct conversion surface ever arises — a single-pass export under a future §10.1 type, or `JsValue` integration — it enters the ledger as a new row under ledger rule 1; this section forecloses only the two meanings above.

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
| Inbound adaptation automatic and type-directed at top-level declared `Seq(a)` positions; no explicit conversion call; stable exported (Part 7) or imported extern (Part 4) function wrapper distinct from the per-value adapter | §2 |
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
| *(2026-07-28, defect 12 ruling)* Inbound door: genuine `Seq` crosses by identity (Part 7 §6), never re-adapted; §2.1 unchanged for foreign iterables | §2.2 |
| *(2026-07-28)* The iterable face is representation: every `Seq` value carries one shared boundary traversal method; lazily created per-value memoized boundary view delivers §9.1 (seven normative properties); Hexagon-internal traversal never uses the face (channel separation); value/result positions direct, parameter position through occasion 1's wrapper + the §2.2 door; R1 family grows to four named members | §9.4 |
| *(2026-07-28)* `Vector`/`Set`/`Map` inheritance bound: observable representation rule, `Hex.*` faces extend their `Iterable` (Part 1 §8.2), identity crossing with no doors, no boundary memoization; emitted-face divergence filed as separate debt | §9.5 |
| *(2026-07-28)* Five alternatives rejected with prices: dual binding, opaque brand face, branded `Hex.Seq` face, operation-delivered face, memoization-free face | §9.6 |
| *(2026-07-28)* `toJsIterable` discharged by merger: the bridge is the §9.4 face (runtime residue, as retained); the public operation is `Seq.memoize`; no second name ships | §9.7 |
