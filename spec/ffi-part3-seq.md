# Hexagon FFI Part 3: `Seq(a)` Interoperation

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing; §9.5 item 3 corrected in place 2026-08-02 under the #128 ruling — the collection faces' brand is nominal in *effect* but structural in *mechanism* (FFI Part 1 §8.3's phantom marker, not Part 7 §5's `unique symbol`), so this section's "nominal brands" is respelled where it was binding spec an implementer would follow. Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §3, drafted per `spec/notes/ffi-roadmap.md` Part 3. The question the draft recorded as a promotion blocker (adapter identity, §2.1) was resolved by James after independent review. Loops/Ranges/Iteration §6 is already normative for `Seq(a)` itself — the type, `Seq.next`, persistence, laziness, and emission onto the JS iterable protocol; this part specifies only the **boundary**: what a foreign iterable becomes in Hexagon, and what an exported Hexagon sequence is to JavaScript. **Revised 2026-07-28 (defect 12 ruling, Fable in the spec seat):** §2.2, §9.4–§9.7 added; §5 and §9.1 annotated. The de-intrinsification arc had left §9.1's promise without a mechanism — the exported value was a bare record with no `[Symbol.iterator]` while the `.d.ts` face still said `Iterable<a>` — and the divergence covered value, parameter, and result positions. The ruling restores the face as **representation**, not boundary plumbing, and specifies all three positions uniformly.
**Revised 2026-08-02 (issue #123 ruling, Fable in the spec seat over an implementing-seat draft):** §7.3–§7.4 added; §4 annotated, §9.4 property 2 narrowed. §4 and §7.1 described forcing as an atomic step with one outcome and said nothing about foreign code re-entering the spine mid-forcing; the case was reachable from an ordinary program and silently lost an element. §7.3 refuses it — the refusal every `seqToIterable` generator source already made, now uniform across sources — and §7.4 declares what the refusal throws: **`ReentrancyError`**, a domestic exception on the `IndexError`/`KeyError` model, not a `JsError` (the condition is Hexagon-detected; Exceptions §6's door is for foreign throwables). One consequence is **recorded rather than ruled** — a refusal reaching the §9.4 boundary view ends that value's foreign traversability, and issue **#232** owns whether it should.
**Scope:** Top-level `Iterable<a>` input; the persistent memoizing inbound adapter (one iterator, one shared lazy spine, no replayability probing, fresh adapter per crossing with no identity cache — §2.1); retention and reclamation; iterative rather than recursive traversal; iterator closure and the no-deterministic-disposal rule; foreign throws, malformed iterator results, and the reentrancy refusal (`ReentrancyError`, §7.3–§7.4); the replayable exported traversal; the `Iterable`-not-`Iterator` boundary; and the v1 restriction on nested adapter-requiring positions (by reference to Part 1 §5.3).
**Not in scope:** `Seq(a)`'s intrinsic semantics (Loops §6, consumed); single-pass `Iterator<a>` acceptance, async iteration, callback-position adapters, and any separate resource-managed stream type (**deferred**, §10); `Array.toSeq`'s borrow interaction (Part 2 §6.2/§9); callback signatures generally (Part 6).
**Companions:** Part 1 §2.3/§3/§5.3 (adapted category, failure doctrine, nested restriction); Part 2 §9 (`Array.toSeq`); Loops/Ranges/Iteration §6; Collections Part 5 §1/§4 (`Seq` as conversion currency; instance table); Exceptions §6 (`JsError`), §2/§7 (the declaration grammar and representation `ReentrancyError` rides, §7.4); Collections Part 3 §5.5 and Part 4 §4.3 (the declared-runtime-exception precedents §7.4 stands on); `spec/notes/ffi-agenda.md` (stale non-crossing statement superseded, §1).

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

- **A genuine Hexagon `Seq` value is not adapted. It crosses by identity.** This is Part 7 §5's decided clause — "the existing erased runtime value crosses out and back by identity" — applied at the position where it was previously unimplementable: a `Seq` that Hexagon handed out and JavaScript hands back is the same value, same spine, same persistence regime, with no memoizing layer silently added. Since every `Seq` value carries the boundary traversal protocol (§9.4), a genuine `Seq` *also* satisfies the `Iterable<a>` face, so the two cases overlap on the value's capabilities and the door resolves the overlap in identity's favor.
- **Any other iterable receives a fresh adapter**, exactly per §2.1, which is unchanged and whose subject this case is. §2.1's "every boundary crossing receives a fresh adapter" governs *adapted foreign values*; a genuine `Seq` returning home is not an adapted value and never was — it is Part 7 §5's identity crossing.

Recognition is by the representation's own mark (the boundary traversal protocol of §9.4); the exact test is emitter latitude. The observable contract: genuine `Seq` ⇒ identity; other iterable ⇒ fresh adapter; a non-iterable at a `Seq(a)` position remains a trusted-boundary contract violation (Part 1 §3.1) with no validation added. A JavaScript value fabricated to look like a `Seq` record is likewise §3.1 territory, as fabricating any branded or opaque value is.

*(Edit note, 2026-08-02, defect 12's implementation.)* **Which half of the representation is the mark.** The parenthetical above names the boundary traversal protocol, and that cannot be the discriminator: every iterable the door exists to *adapt* carries `[Symbol.iterator]` too, so testing for it would recognize all of them. Nor can the test be the identity of the shared method, because that method is emitted per module and a `Seq` arriving from another module carries that module's copy. The mark is therefore the **other** half of §9.4's representation — the record, whose `pull` is the §6.2 protocol — and the door's test is that `pull` is present. The observable contract above holds with one narrow carve-out from "other iterable ⇒ fresh adapter": a foreign iterable that happens to expose a callable `pull` — stream-ish JavaScript APIs do — takes the identity branch and is driven as a `Seq`, which observably yields a silently empty sequence rather than a crash (its `pull` returns nothing the traversal recognizes as a step). That residue is what the fabricated-look-alike clause already governs, unchanged, and the test cannot be narrowed to the traversal method's identity for the per-module reason above. This replaces a parenthetical that pointed at the half of the representation that cannot do the job, and stays within "the exact test is emitter latitude".

Why identity and not re-adaptation, recorded: re-adapting a genuine `Seq` would wrap a possibly re-deriving spine (Loops §6.4's internal default) in a memoizing one, so a round-trip through JavaScript would *observably change the value's persistence regime* — and break the identity idioms Part 7 §5 promises (a JS consumer storing and comparing the value, a Hexagon consumer relying on one shared spine). The rewrite §2.1 teaches ("cross once and share the `Seq`") also presupposes that the shared value survives crossings as itself.

---

## 3. The adapter never probes or classifies replayability

Requesting two iterator objects proves neither semantic replayability nor independence: the two may share a queue, a socket, a clock, a mutable store, effects, or one underlying cursor. The adapter must not call `[Symbol.iterator]()` speculatively and must not restart foreign computation to find out what kind of iterable it holds.

---

## 4. One iterator, one shared lazy memoization spine

This is the **uniform inbound rule** — there is no fast path for "obviously replayable" sources and no degraded mode for single-shot ones:

- The adapter requests the source iterator **once, on first demand**.
- Each sequence node memoizes **exactly one outcome**: end, `(value, tail)`, or foreign failure (§7).
- Repeating `Seq.next` at the same position therefore neither advances the source nor repeats foreign effects.

*(Addendum, 2026-08-02, issue #123 ruling.)* "Exactly one outcome" is stated over a forcing that runs to completion before any other forcing of the same spine begins. **§7.3 makes that an enforced property rather than an assumption**: a forcing that is re-entered — by the foreign source it is driving, or by anything that source calls — refuses the reentrant force rather than letting two forcings compete for one position. Nothing above changes for a program that does not do it.

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

### 7.3 Reentrant forcing is refused *(ruled 2026-08-02, issue #123)*

A forcing is **reentrant** when the code it runs — a foreign `next()`, a `done` or `value` getter, `[Symbol.iterator]()` (acquisition is deferred to the first pull, §3, so it too runs inside a forcing), or anything they call — asks the same spine to force a position that is not yet memoized. Because a tail node is built only from a successful forcing, the reachable nodes are a chain whose last member is the only unforced one, so the position asked for is always **the position being forced**.

**The ruling: the spine refuses it.** A pull that would begin forcing while a forcing of that spine is in flight throws **`ReentrancyError`** (declared in §7.4). The refusal itself touches nothing — not the source, not that spine's memo, not the iterator.

Three consequences, all normative:

- **Replay is untouched.** A reentrant pull of a position that *is* memoized returns its memoized outcome, exactly as any other pull would — the refusal is scoped to *beginning a forcing*, not to entering `pull`. A foreign source that looks back at elements it has already produced is doing nothing cyclic and must keep working. On the spine being forced, the outcome replayed is always a **value**: an end or a failure has no successor node, so no forcing of that spine can be in flight behind one. The other two arms are reachable only across spines, where this rule does not apply.
- **The enclosing forcing is unaffected.** If the code that met the refusal swallows it and returns a result, that result is the position's outcome and the traversal continues. Exactly one source element is consumed per position, as §4 requires.
- **A refusal is an ordinary failure to every spine it reaches.** A reentrant traversal that arrives through a **second** spine — most often the §9.4 boundary view, since that is JavaScript's route into a `Seq` value — meets the refusal as a throw out of *its* source, which §7.1 memoizes at that position. That value is finished as an `Iterable` to JavaScript, and says so on every later attempt rather than going quiet. Whether the *enclosing* traversal survives is the previous bullet's business, not this one's: it completes normally if the code that met the refusal swallowed it, and fails at that position by §7.1 if it did not.

  The view is not JavaScript's only route back in. Foreign code that calls an exported Hexagon function re-enters through the **internal** channel (§9.4's channel separation), which builds no boundary view and memoizes nothing of the kind — a refusal raised there propagates and is caught or not, leaving no residue.

**Recorded, not ruled — issue #232.** The third consequence's second-spine memoization is the behaviour, and it is not a settled decision. The repair that suggests itself, declining to memoize a refusal a spine did not raise, is *worse as things stand*: the refusal travels out through `seqToIterable`'s generator, a generator that has thrown is completed, and the next forcing of that position reads `done` off it and memoizes **end** — the value then reads as *empty* to JavaScript instead of raising, which is the silent truncation this ruling exists to remove. But that completion is an artifact of the driver being a generator, which nothing in this part requires: with `seqToIterable` emitting an explicit cursor instead, the same repair keeps the value's foreign face working. Both halves would have to land together, and `seqToIterable` is half of R1 and the internal channel's driver, so #232 owns the change and the checks it needs. §7.4 changes the refusal's *kind*, not this calculus — a failure cell stores whatever was thrown, and the truncation mechanism is the generator's completion, indifferent to what completed it; a declared kind does hand #232 a sturdier recognizer than a message match, recorded for its file. Until #232 is decided, **do not read the third consequence as a decision that a refusal should end the foreign face** — read it as what happens.

**Why refusal and not an answer.** Not a survey of alternatives — an impossibility. The reentrant forcing needs a value the enclosing `next()` has not returned yet, so no rule can serve both from one source advance; and two advances give two elements for one position, of which only one can be memoized. **Lossless and order-preserving cannot both hold**, because the only construction that keeps both is the inner forcing waiting for the outer, which single-threaded synchronous JavaScript cannot express. Every non-refusing rule therefore loses an element or reorders the sequence, and does it silently. This is not hypothetical: a program with no import cycle and no self-reference (a third module hands the `Seq` to the foreign module the sequence's own derivation calls) produced a sequence one element short, with both the reentrant and the enclosing traversal agreeing on the short answer and nothing raised anywhere.

**Where the check lawfully lives** (Part 1 §3.2). §3.2 permits validation *only* where a named operation establishes an invariant or where protocol participation inherently requires a check, and its Part 3 entry is the minimum native iteration performs. A reentrancy guard is not one of those: native iteration performs no such check, and this one inspects no foreign value. It is lawful because **§3.2's subject-matter is validating foreign values, and this validates the adapter's own state** — no inbound value is examined, narrowed, or distrusted, so the "only" does not reach it. Stated here rather than assumed, because a ruling marked do-not-re-litigate must not step past another spec's normative "only" in silence. (If one insisted on placing it *inside* §3.2's list, its first limb — an operation that exists to establish an invariant — is where it would sit, since the adapter exists to establish §4's one-outcome-per-position. The claim above is the narrower one and does not depend on that reading.)

> **Edit note (for `ffi-part1-boundary.md` §3.2, applied on next touch):** the "only" is about validating foreign values. A boundary mechanism checking its *own* invariant is outside that subject-matter rather than an exception to it; Part 3 §7.3's reentrancy refusal is the first instance and should be named there as one.

**One case is made uniform; the kind is §7.4's ruling.** Every spine whose source is a `seqToIterable` generator — every `Seq.memoize` (Loops §6.4) and every §9.4 boundary view — already had the reentrant advance refused by JavaScript itself, with `TypeError: Generator is already running`; only a foreign iterator whose `next()` is an ordinary function reached the incoherent path, and that is the case this ruling conforms. What is conformed across sources is the **refusal**. The check precedes the platform's, so it replaces that `TypeError` rather than deferring to it, and what the refusal throws is therefore a choice — made, with the alternative recorded against re-litigation, in §7.4.

**Scope.** This governs the memoizing spines this part specifies: the §2 inbound adapter, and by §9.4 and Loops §6.4 the boundary view and `Seq.memoize`, which are the same mechanism. It does not govern **re-derivation** — the internal channel builds no memo and has no position to collide on, so a derivation that observes its own sequence there re-derives from the head each time and recurses. Loops §6.5 declines tail-call elimination, so every such cycle passes through a growing stack and **fails fast with a stack overflow**; no spine detects it, and none needs to. That is a materially better outcome than the boundary case had, and it is why re-derivation is left alone rather than given a guard of its own.

**Not a contract violation** (Part 1 §3.1). The foreign code satisfies its declaration; nothing was promised and broken. Reentrancy is a cyclic value dependency, and a pure Hexagon program cannot construct one — `let` is non-recursive, a closure cannot capture a `var` (Statements §6.2), and a `fun` may not read a `let` it is captured by before that `let` is bound — so the cycle always runs through the boundary, but not always through foreign *misbehaviour*. §3.1's unspecified-observation doctrine is therefore the wrong instrument here, and the previously-recorded reading of this case as "behaviour is unspecified" is superseded.

**Inheritance.** `Seq` is the pilot for `Vector`, `Set`, and `Map` (stdlib-roadmap §5.2). Those inherit §9.5's rule — identity crossing with **no** boundary memoization — so they have no spine, no forcing, and nothing for this rule to apply to. It is inherited as a settled question, not as three more open ones.

### 7.4 The `ReentrancyError` declaration *(ruled 2026-08-02, with §7.3)*

The refusal is a condition **Hexagon itself detects**, in state Hexagon itself owns, and that settles its kind before any cost accounting does. Exceptions §1's one-door doctrine cuts both ways: *every Hexagon-originated exception is a declared constructor; everything else JS can throw is a `JsError`.* Nothing foreign failed here — the foreign code satisfies its declaration (§7.3's contract paragraph), the check reads the adapter's own flag and no foreign value (§7.3's lawful-home paragraph), and the platform performs no such check of its own. A refusal delivered as a manufactured JS `TypeError` would make this the first condition Hexagon detects that leaves through the foreign-throwables door (Exceptions §6) — Hexagon impersonating the platform to its own programs. It joins the family it belongs to instead — `IndexError`, `SliceError`, `KeyError`, `DivideByZeroError`: runtime faults Hexagon machinery detects, declared as constructors.

Declared here and canonically exported by `stdlib/Seq.hex`. The complete package/prelude loader may additionally promote the constructor into the prelude; until then its explicit source spelling is `Seq.ReentrancyError`:

```
exception ReentrancyError
```

- **Nullary — decided**, on `KeyError`'s model (Collections Part 4 §4.3): no slot survives scrutiny. A `Seq` position has no user-meaningful address — sequences are not indexed, and the spine tracks no ordinals, so an `index`-like slot would add per-node state purely to decorate a diagnostic, the shape of argument that made `KeyError` nullary. A `message: String` slot (the `DivideByZeroError` shape, whose message varies by the operation at fault) would carry the same sentence at every fault: the refusal has one raiser, the memoizing spine, and nothing about the fault varies. A slot whose value cannot vary is decoration.
- **Recognition is owed, not yet available — issue #234.** No declared exception is catchable today: a constructor named in a `catch` pattern does not resolve (`JsError` included), and the qualified spelling this section gives is not parseable as a pattern at all. That is a general compiler gap, not this ruling's — `ReentrancyError` is exactly as catchable as `IndexError` is, which is to say not yet — and it is why the implementation ships the **throw** alone. The branded value is raised and observable; the arm that reads it lands with #234.
- **Non-normative message**, per the same model: the runtime supplies a diagnostic rendering on the underlying JS `Error` — canonically `"Seq position is already being forced: a sequence position cannot depend on its own value"` — and programs must not parse or depend on it. Recognition is the catch arm; that there *is* one is half the point of declaring the exception.
- **The name is general, on `IndexError`'s precedent** (Collections Part 1 §10.1's anticipation clause: nothing scopes a shared declaration to its current throwers). Future machinery that must refuse re-entry into its own in-flight operation raises the same constructor rather than minting a sibling.

**The raiser is the runtime, and the brand is the identity.** The spine is emitted per module, so the refusal is constructed at the raise site as the Exceptions §7.1 representation directly — a fresh plain `Error` carrying the canonical message, extended with `name: "ReentrancyError"` and `$hex: true`, no payload fields — exactly as the emitted `IndexError` and `SliceError` already are; fresh per refusal (Exceptions §7.3), so the stack points at the reentrant pull. That the construction never calls `Seq.hex`'s declared constructor is the representation working as designed: exception identity is `name` under the `$hex` brand, chosen over prototype identity for precisely the many-copies case (Exceptions §7.1), so the inline construction, the `.hex` declaration, and every module's copy of the spine coincide on one nominal exception.

**What a program observes.** In Hexagon, an ordinary domestic exception — once #234 lands: a `catch` arm `Seq.ReentrancyError => …` matches exactly this condition (emitted discrimination: `$hex === true && name === "ReentrancyError"`, Exceptions §7.4), and an unmatched refusal propagates. The refusal usually surfaces first *inside foreign code* — the reentrant pull is typically JavaScript mid-`next()` — and passing through foreign frames rebrands nothing: the `JsError` door is virtual (Exceptions §6.2), so a refusal that comes back out of a foreign call, or replays out of a second spine's memo (§7.3's third consequence), is still `ReentrancyError` to the `catch` that finally receives it. JavaScript sees what it sees of every escaping Hexagon exception: an `Error` named `ReentrancyError` (Exceptions §7.5).

**Rejected, recorded against re-litigation: `JsError` via a manufactured `TypeError`** — the ruling's own first draft, justified there by §7.2's "no separate Hexagon error type". Three reasons, each sufficient:

1. **§7.2's reason does not reach.** §7.2's `TypeError` is the platform's own voice: the malformed-result check is "the minimum protocol check native iteration performs", the fault it reports is foreign misbehaviour, and native `for...of` over the same iterator raises the same error — Hexagon performs the platform's check and reports the platform's finding. The reentrancy guard is lawful on the *opposite* ground (§7.3's lawful-home paragraph): native iteration performs no such check, and no foreign value is inspected. A check licensed because it is *not* a protocol-participation check cannot take its error kind from the rule that governs protocol-participation checks.
2. **Unrecognizable by construction.** Exceptions §6.1 leaves classification of foreign errors to userland, and message text is exactly what programs must not depend on — so a `JsError` refusal could not be told, by any specified means, from any other foreign `TypeError`. §7.3's second consequence contemplates code meeting the refusal and choosing its response; a rule cannot invite that choice and withhold the means to make it.
3. **Platform uniformity was never on offer.** The surviving argument for `TypeError` — generator-sourced spines already failed with `TypeError: Generator is already running` — selects nothing: the guard precedes the platform's check in every case (§7.3), so the platform's error is unreachable through the spine and the kind is Hexagon's choice however spelt. Matching the platform's spelling without the platform's involvement is impersonation, not uniformity.

> **Edit note (for `exceptions.md` §8, applied on next touch):** the prelude additions gain `ReentrancyError` — nullary, canonically exported by `stdlib/Seq.hex`, raised by the runtime's memoizing spine (FFI Part 3 §7.3–§7.4) — beside the `KeyError` row Collections Part 4's edit note already owes that section.

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

The `Seq` face's authority was never actually in conflict once each decided clause is read at its own level. Part 1 §4.1's outbound row already states the contract this section restores: the outbound representation is "the runtime sequence value, **natively implementing the JS iterable protocol**". Part 7 §5's opaque-value clause forbids a *boundary artifact* — a wrapper, tag, or validation added at the crossing — not a representation. And ruling R1's "sole compiler-side constructor" confines representation knowledge to a named compiler-owned family, which this section extends by one member rather than dissolves. What gives way is only auxiliary phrasing: Loops §6.5's "boundary bridges supplying the iterable face" (the face now rides the value; edit note issued) and the R1 knowledge clause (amended below).

**The representation rule.** Every `Seq` value carries the JavaScript iterable protocol — a **boundary traversal method** at `[Symbol.iterator]` — as part of its emitted representation, alongside `pull` (Loops §6.6). It is one shared method for all `Seq` values, never a per-value closure; whether it rides an own-property slot or a shared prototype is emitter latitude (`Range`, `Map`, and `Set` values already carry the protocol the same way). The method is representation from birth, at every construction site (`Seq.hex`'s combinators and the §2 adapter alike), so it is present at every position without boundary plumbing — which is exactly why Part 7 §5 is satisfied rather than traded away: the value crosses out and back by identity, unmodified at the crossing, and what JavaScript finds on it was always there.

*(Edit note, 2026-08-02, defect 12's implementation.)* **"One shared method" is one per emitted module, not one per program.** Runtime helpers are emitted inline into each module's output — the corpus's standing convention, which `persistentCollections` and the R1 pair already ride — so the boundary traversal method is a single function *within a module's emission*, and a `Seq` constructed in another module carries that module's copy. This weakens none of the seven properties below: the method rides the value from its construction site (an own property, as built today), so every foreign traversal of a given value goes through its constructing module's method and therefore its one view — property 2's "at most once across all foreign traversals of that value" is a per-value promise and holds exactly as stated. What the scope correction forecloses is a misreading: "one shared method" is not a cross-module identity promise, and nothing may test the method's identity to recognize a `Seq` — the trap §2.2's note closes, and the reason the door's mark is `pull` rather than anything about this method.

**The memoized boundary view.** The traversal method delivers §9.1 with these observable semantics, all normative:

1. Each `[Symbol.iterator]()` call opens an **independent cursor** at that `Seq` position.
2. All cursors ever opened on one `Seq` value share one **memoized boundary view** of it: across all foreign traversals of that value, each position's derivation runs **at most once** — the first cursor to reach a position forces it; every later observation replays the memoized outcome. Cursors may interleave freely; whichever cursor reaches the shared frontier advances it. *(Narrowed 2026-08-02 by §7.3: "freely" means between forcings, not inside one. The view is a spine and §7.3 governs spines, so a cursor that reaches the frontier from within another cursor's forcing of that same position is refused — and, per §7.3's third bullet, the refusal is memoized at that position, so the narrowing costs the value its foreign traversability rather than costing one cursor a step. Issue #232 owns whether it should. The refusal itself was already true of every generator-sourced view, which is why it went unstated.)*
3. The view is created **lazily, at the value's first foreign traversal**. A `Seq` JavaScript never traverses carries no view, no buffer, and no cost beyond the shared method itself.
4. **Failure is memoized per position**, uniformly with §7.1: if forcing a position throws, every later foreign observation of that position replays the same thrown value and the underlying computation is not re-run.
5. An infinite or unbounded `Seq` forces only what some cursor has reached (laziness preserved through the view).
6. A cursor's early `return()` ends that cursor only (§8); the value and the view remain valid.
7. Retention follows §5's addendum: the view lives and dies with the value.

These are precisely the Loops §6.4 properties of the memoizing spine, and the representative implementation is the composed R1 pair — the inbound spine (§4–§7) driven over the value's own protocol traversal — verified to satisfy every one of them, including #124's failure memoization. The composition is representative, not normative; the seven properties are the contract. (Where the value's own spine already memoizes — an adapter-built `Seq` — an emitter may let the method drive `pull` directly, since the two are observationally indistinguishable there.)

*(Edit note, 2026-08-02, defect 12's implementation.)* **Where the view lives.** This section left the view's storage to the emitter; the choice made is a `WeakMap` keyed by the `Seq` value, held in the shared method's closure — never a slot on the record. Two things that buys, recorded because they are the reasons to keep it: a `Seq` JavaScript never traverses gains nothing at all (property 3, delivered at its sharpest — no reachable per-value state of any kind), and the view can never surface to a JavaScript consumer enumerating the value's own properties. Retention is §5's addendum verbatim, with one wrinkle worth naming so it is not mistaken for a leak: the key is reachable from its own entry — the view's spine drives the value — which is exactly the ephemeron cycle `WeakMap` is specified to collect, so the pairing dies with the value as the addendum requires. A recorded implementation choice under existing latitude, not a new normative rule.

*(Edit note, 2026-08-02, defect 12's implementation.)* **The parenthetical latitude above is declined, and its price is double buffering.** The shared method composes unconditionally — a value's first foreign traversal builds the view spine over the value's own traversal, whatever the value is — so an adapter-built `Seq`, whose own spine already memoizes, gets a second memoizing spine when JavaScript traverses it, and its forced elements are retained twice: once in the adapter's spine, once in the view's. Observationally the two paths are indistinguishable there, which is exactly what the parenthetical says, so this is correct and permitted; the cost is recorded so a later reader knows the latitude is still on the table rather than assuming it was taken. It also compounds with #131 (the spine's central-array retention against §5), which then applies to both spines of such a value — a pointer, not a claim about how #131 resolves.

**Channel separation, normative.** Hexagon-internal traversal — `for x in`, `Seq.next`, every combinator and consumer — drives the §6.2 protocol (`pull`) and **never the boundary traversal method**; it neither creates nor consults the boundary view. The internal persistence default (re-derivation, Loops §6.4) is therefore untouched by this ruling: the same value re-derives when Hexagon re-traverses it and replays memoized outcomes when JavaScript re-traverses it, which is exactly what "the export boundary memoizes regardless of internal default" has always meant. In particular, an emitter must not lower `for x in` to native `for...of` over the record — that would silently import boundary memoization (and its retention) into internal semantics.

**The three positions, uniformly:**

- **Value export — direct, no wrapper.** The ESM binding is the record, for Hexagon importers and JavaScript consumers alike; the record satisfies its `Iterable<a>` face by representation. (An export-site wrapper is impossible here — it would hand Hexagon importers a non-`Seq` — which is why the representation rule is the only shape that covers this position at all.)
- **Result position — direct, no wrapper.** An exported function's `Seq` result, and equally a `Seq` argument Hexagon passes *to* a declared foreign callable (the outbound extern direction, which the defect's statement did not reach but which had the same divergence), are honest by representation.
- **Parameter position — Part 7 §7 occasion 1's stable wrapper, now specified.** The wrapper routes each top-level `Seq(a)` argument through §2.2's inbound door — genuine `Seq` by identity, other iterable through a fresh §2.1 adapter — then calls the module-internal function. Hexagon importers reach the export through the same ESM binding and therefore the same wrapper; the identity pass-through makes it semantically transparent to them, at the price of one recognition check per `Seq`-typed argument per cross-module call. Same-module calls bind the internal function directly and pay nothing. The symmetric extern inbound wrapper (Part 4 §4.3, a foreign result declared `Seq(a)`) uses the same door, which is what makes a round-tripped `Seq` return by identity.

*(Conformance note, 2026-08-02, defect 12's implementation.)* Two of this section's claims that were statements of intent are now true of the emitter, recorded so they are checkable rather than assumed. Channel separation holds as written: `for x in` still lowers through the outbound driver, never native `for...of` over the record. And the outbound extern direction is honest by representation in the strongest sense — a `Seq` argument to a declared foreign callable is passed *unwrapped*, so an extern declaration needs no wrapper for its `Seq` parameters at all, only the inbound door for a `Seq`-declared result or value; the pre-ruling emitter's plumbing that drove each `Seq` argument through the outbound driver at the call site is deleted, since the value carries its face.

*(Edit note, 2026-08-02, defect 12's implementation.)* **A generated name reaches the JavaScript surface.** Occasion 1's wrapper is emitted as a module-level `const` arrow exported under the public name, so the ESM *binding* is aliased but the function object's own `name` — what `Seq.map.name` returns and what stack frames print — is the compiler-generated spelling (`__hex_mapBoundary0` today). This is not against Part 7 §1's "raw identity, no indirection", which does not govern a position where a wrapper is decided spec; but a compiler-internal name is now user-visible where nothing was before, and since every `Seq.hex` companion with a top-level `Seq` parameter takes the wrapper, it is most of that module's exported surface, not a corner. Recorded as a cost of the emission shape; whether the wrapper should carry the public name is deliberately not ruled here.

**Ruling R1, amended.** The inbound adapter remains the sole compiler-side *constructor* of `Seq` records, and the outbound driver the sole compiler-side consumer of `pull`. The compiler-side representation family grows from that pair to a named set of four, all one runtime-helper home: the inbound adapter, the outbound driver, the boundary traversal method (composed from the first two), and the inbound door's recognition check. Nothing outside that family — no other emitter path, no checker table, and no `.hex` source — knows the record's shape. The conformance round-trips that made the pair break loudly (R5) extend over the two new members.

**Diagnostics: none.** This ruling adds no user-facing error and no diagnostic text, so the Rewrite Rule is not engaged. The §11 checklist is unchanged.

### 9.5 What `Vector`, `Set`, and `Map` inherit (binding)

`Seq` pilots the pattern the other collections inherit (ledger §2, the `Seq.hex` obligation row; §5.2 item 2). The following is **binding spec now**, not advice, so that no companion arc re-derives it:

1. **The representation rule is inherited as an observable contract, not as an attachment mechanism.** An exported collection value satisfies its declared face's traversal protocol *as part of its representation*, never via a boundary artifact. This is stated over observations precisely so each representation pays its own way: `Map` and `Set` HAMT values already carry `[Symbol.iterator]` (paid); `Vector`'s current native-array representation is natively iterable (paid, at zero — a native array cannot and need not carry a custom method); the future persistent-vector core (ledger §5.1 residue) must keep the protocol on the value when it lands. Iteration yields what each collection's own spec gives its traversal: elements in index order for `Vector`, entries as `[k, v]` pairs for `Map`, members for `Set`, in the traversal order Collections Parts 3–4 define (unspecified-but-per-value-stable where those specs say so).
2. **Faces extend their iterable protocol.** `Hex.Vector<a>` and `Hex.Set<a>` extend `Iterable<a>`; `Hex.Map<k, v>` extends `Iterable<[k, v]>` — Part 1 §8.2, added by this ruling on the `Hex.Range` precedent (§8.1), same brand doctrine: an arbitrary iterable does not satisfy the face.
3. **Identity crossing, both directions, no doors.** Their faces are branded, not the bare structural `Iterable<a>`, so **there is no inbound adaptation to inherit**: *(2026-08-02, #128 ruling — this item formerly read "nominal brands", which misnames the mechanism in a section that is binding spec. What is nominal is the **effect**: an arbitrary iterable does not satisfy `Hex.Vector<a>`. The **mechanism** is structural — Part 1 §8.3's phantom marker `readonly "~hex": "Vector"`, deliberately not Part 7 §5's `unique symbol`, because a per-program symbol would type-reject the cross-program interop the runtime genuinely supports (Part 1 §8.4 item 3). An implementer who read "nominal brand" here as §5's mechanism would emit the wrong declaration. Item 2's "same brand doctrine" is unaffected and correct.)* occasion 1 (Part 7 §7) is `Seq`-only, because only `Seq`'s parameter face admits arbitrary foreign iterables. A genuine collection value crosses out and back by identity (Part 7 §5, already true today); anything else at a branded position is a §3.1 contract violation, unchanged.
4. **No boundary memoization to inherit.** The memoized boundary view exists because `Seq` is lazy and possibly effectful; strict persistent structures need none of it. What they inherit from §9.4's semantics is only item 1: each `[Symbol.iterator]()` is an independent cursor over the persistent value.
5. **Nothing any of the three cannot pay.** The audit behind this section found the value-level cost already paid three times over (`Map`, `Set`, and `Vector`-as-array), and the face-level cost is declaration text. What it also found, recorded so it is filed rather than inherited: the *then-emitted* `.d.ts` faces (`ReadonlyArray`, `ReadonlySet`, `ReadonlyMap`, bare `Iterable<number>` for `Range`) diverged from Part 1 §4.1/§8's decided `Hex.*` faces — pre-existing implementation debt of the `.d.ts` generator, neither created nor altered by this ruling, owed its own defect entry. *(Discharged 2026-08-03, #242: the entry it was owed is #128 — ruled at Part 1 §8.3 (2026-08-02), implemented and merged 2026-08-03. Verified against the merged compiler, not inherited from the issue: `renderType` emits all four `Hex.*` faces, and a generated `.d.ts` that mentions one carries the type-only import of the emitted `hex.d.ts`. This item formerly read "the *currently emitted* `.d.ts` faces … diverge"; the audit record keeps its past tense as provenance, and nothing in this item remains filed.)*

*(Edit note, 2026-08-02, defect 12's implementation.)* Item 5's debt family had a `Seq`-shaped member this file did not list: `Seq.hex`'s **own** emitted `.d.ts` spelt `Seq(a)` as the local opaque brand `Seq<a>` — the one module that declares `Seq` cannot reach it through the prelude, so the generator failed to recognize its own declaration — leaving `Seq.js`'s published face (`memoize<a>(source: Seq<a>): Seq<a>`) incompatible with the `Iterable<a>` every consumer module publishes for the same functions. §9.1 and §2.3 say the face is `Iterable<a>` unconditionally, and §9.6 alternative 3 reaffirms it by rejecting a branded face, so the fix is conformance, not a spec change; it is recorded here so item 5's ledger reads correctly: the `Seq` member of that family is **discharged**, while the `ReadonlyArray`/`ReadonlySet`/`ReadonlyMap`/bare `Iterable<number>` members remained filed debt owed their own defect entry *(so the ledger stood when this note was written; corrected 2026-08-03, #242 — that entry is #128, ruled at Part 1 §8.3 (2026-08-02) and implemented, merged 2026-08-03, so the whole family is now discharged and this ledger holds no filed debt)*. One residue the conformance creates, completing this ledger: `Seq.d.ts` still declares Part 7 §5's brand (`declare const __hex_opaque_Seq: unique symbol; export type Seq<a> = {readonly [__hex_opaque_Seq]: a}`), now referenced by no exported signature and inhabited by no value — every signature spells the face `Iterable<a>`. That is not a violation of anything decided: §5's brand is what an `export opaque` type declares, and §9.6 alternative 3 rejects the brand only as the *face*, not as a declared type. But it is new dead surface a TypeScript consumer can import and write against, recorded here rather than silently shipped; whether it should stay is not ruled on.

### 9.6 Rejected alternatives (recorded against re-litigation)

1. **A dual-binding export protocol** (raw ESM binding for Hexagon importers, wrapped binding for JavaScript). Rejected: it changes the module emission contract for *every* module to serve one type; ESM cannot hide the raw binding, so the unbranded value leaks anyway; and it breaks the decided doctrine that one emitted binding is simultaneously the Hexagon and the JavaScript interface. Price avoided: none that the representation rule does not also avoid — the dual binding buys nothing over §9.4 once the value itself is honest.
2. **Changing the face to Part 7 §5's opaque brand.** Rejected: it would overturn §9.1, its two post-de-intrinsification reaffirmations (Loops §6.4; the ledger row), Part 1 §4.1's `Iterable<a>` rows, and §1's doctrine that `Seq` crosses both ways — and it would strand occasion 1, which is decided spec accepting arbitrary foreign iterables at `Seq(a)` parameters. The price of keeping it out: none; the brand's actual content (identity, no boundary artifact) is satisfied by §9.4.
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

This part introduces **no new hard errors** (its one runtime exception is declared in §7.4); the boundary-shape errors it relies on land elsewhere:

| Situation | Owner |
|---|---|
| `Seq` nested in a direct aggregate or borrowed container | Part 1 §5.3 (hard error with named rewrite) |
| `Seq` in a callback parameter/result position | Part 6 (v1 callback rule) |
| Malformed foreign iterator result | not a diagnostic — runtime JS `TypeError` via `JsError` (§7.2) |
| Reentrant forcing of a spine | not a diagnostic — runtime `ReentrancyError` (§7.3; declared §7.4); detected, unlike the row below |
| Resource-owning iterator supplied as a `Seq` input | not detectable — documented suitability rule (§8) |

---

## 12. Open questions

None. The one blocker this draft originally recorded — adapter identity across repeated crossings — was resolved by James after independent review: **fresh adapter per boundary crossing, no identity cache**, now normative in §2.1.

Everything else the roadmap assigns to this part is closed by the decision record; the genuinely undecided neighboring surfaces are the §10 deferrals, each with a named owner. (The precise runtime representation of the adapter's lazy nodes is an implementation choice already licensed by Loops §6.5, constrained by §4–§5's semantics.)

---

## 13. Decisions log (quick reference)

> **Correction record (2026-08-02, #128 ruling round 5 — file-wide citation drift, no decision changed).** Seven passages in this document cited **Part 7 §6** for the identity-crossing and opaque-value clauses: §2.2's two bullets and its "why identity" paragraph, §9.4's authority paragraph and representation rule, §9.5 item 3, and this log's defect-12 row. In `ffi-part7-exports.md` as shipped, **§6 is Exceptions**; the clause every one of them means — *"the existing erased runtime value (or foreign object, for extern types) crosses out and back **by identity**"*, and the "no runtime wrapper, tag, or validation" clause with it — is **§5, Opaque branded values: the uniform brand**, whose own 2026-07-28 note about `Seq`'s traversal method confirms the pairing. `git log -S"## 6. Opaque branded"` over that file returns nothing, so §6 was never the brand section and the numbers are a draft-era artifact, not a supersession. All seven are corrected to §5 in place. Recorded rather than silently fixed because the drift twice survived a rewrite of the very item carrying it: round 2 of this ruling rewrote §9.5 item 3 in place (the "nominal brands" correction) and left its §6 citation standing, and round 4 then corrected the eighth instance — §9.6 item 2's "Part 7 §6's opaque brand" — nine lines away, without looking up — the one-place-fix failure this ruling's review rounds exist to catch — and a future reader finding the old numbering in history should know it was error, not history.
>
> **Where the same drift survives, named so this record's silence is not read as a clean bill.** *Correct, not drift:* `exceptions.md` §7.5's `.d.ts` bullet and its §11 decisions-log row cite Part 7 §6 for exported exception constructors — §6 **is** Exceptions, and those two are right. *Out of this sweep's scope:* `spec/notes/seq-deintrinsification-plan.md`, `notes/defect-12-ruling-handoff.md`, and `notes/compiler-conformance-defects.md` all carry it (`compiler-conformance-defects.md` most heavily, and it additionally cites a "Part 7 §6.8" — the numbering there is not merely off by one and is not audited here), and `spec/README.md`'s authority rules make notes non-normative (the same fence FFI Part 1 §8.3's sweep note draws). *Compiler source, edit note issued, not edited here:* `compiler/src/passes/emitter/emitter.ts`'s `seqIterate` and `seqInbound` comments (the two sites that implement this section) and `compiler/src/conformance/seq-unification.test.ts`'s occasion-1 test comment each attribute the identity clause to Part 7 §6; on next touch of those files, read §5. A ruling does not edit compiler source, so the divergence is recorded rather than left for the next reader to rediscover — the same disposition round 4 gave `checker/variance.ts` (FFI Part 1 §8.3).

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
| *(2026-08-02, issue #123 ruling)* Forcing is not reentrant: a pull that would begin forcing while a forcing of that spine is in flight throws `ReentrancyError` (§7.4), touching neither source, memo, nor iterator. Replay of an already-memoized position is untouched (the refusal is scoped to *beginning* a forcing); a refusal reaching a second spine is memoized there and ends that value's foreign traversability — **behaviour recorded, not ruled; #232 owns it** (declining to memoize truncates silently as things stand); lossless-and-order-preserving is impossible, not merely unchosen; the check validates the adapter's own state, not a foreign value, which is why Part 1 §3.2's "only" does not reach it (edit note issued); re-derivation is out of scope and fails fast by stack overflow; not a Part 1 §3.1 contract violation. Narrows §9.4 property 2. Inherited by `Vector`/`Set`/`Map` as vacuous — §9.5 item 4 gives them no spine | §7.3 |
| *(2026-08-02, issue #123 ruling)* The refusal is domestic: `exception ReentrancyError` — nullary on `KeyError`'s model, name general on `IndexError`'s precedent, declared here and canonically exported by `stdlib/Seq.hex` (source spelling `Seq.ReentrancyError` pending prelude promotion; edit note to Exceptions §8 issued); raised by the runtime as the branded Exceptions §7.1 representation (`name: "ReentrancyError"`, `$hex: true`, fresh per refusal, canonical message non-normative); `JsError`-via-manufactured-`TypeError` rejected with three recorded reasons — §7.2's reason licenses only the platform's own minimum check, a `JsError` refusal is unrecognizable by any specified means, and platform uniformity selects nothing once the guard precedes the platform's check | §7.4 |
| Malformed results = JS `TypeError` via `JsError`; no `InvalidIteratorError`; no deep validation; forcing follows native protocol order (`next()` once, `done` once, `value` once and only if not done) | §7.2 |
| No deterministic disposal; early loop exit must not call shared `return()`; resource-owning iterators unsuitable | §8 |
| Exported `Seq` replayable: independent cursors per `[Symbol.iterator]()` over the same memoized sequence; face stays `Iterable<a>` | §9.1 |
| Boundary accepts `Iterable<a>` only; bare iterators wrapped by foreign code; future single-pass type must not be called `Seq` | §9.2 |
| Nested and callback positions rejected — owned by Part 1 §5.3 and Part 6 | §9.3 |
| *(2026-07-28, defect 12 ruling)* Inbound door: genuine `Seq` crosses by identity (Part 7 §5), never re-adapted; §2.1 unchanged for foreign iterables | §2.2 |
| *(2026-07-28)* The iterable face is representation: every `Seq` value carries one shared boundary traversal method; lazily created per-value memoized boundary view delivers §9.1 (seven normative properties); Hexagon-internal traversal never uses the face (channel separation); value/result positions direct, parameter position through occasion 1's wrapper + the §2.2 door; R1 family grows to four named members | §9.4 |
| *(2026-07-28)* `Vector`/`Set`/`Map` inheritance bound: observable representation rule, `Hex.*` faces extend their `Iterable` (Part 1 §8.2), identity crossing with no doors, no boundary memoization; emitted-face divergence filed as separate debt | §9.5 |
| *(2026-07-28)* Five alternatives rejected with prices: dual binding, opaque brand face, branded `Hex.Seq` face, operation-delivered face, memoization-free face | §9.6 |
| *(2026-07-28)* `toJsIterable` discharged by merger: the bridge is the §9.4 face (runtime residue, as retained); the public operation is `Seq.memoize`; no second name ships | §9.7 |
| *(2026-08-02, defect 12's implementation)* The door's mark is the record half of the representation — `pull` — never `[Symbol.iterator]` (every adaptee carries one) and never the shared method's identity (the method is per emitted module); within §2.2's stated emitter latitude | §2.2 |
| *(2026-08-02)* "One shared method" scoped to one per emitted module; the seven properties are per value and hold unchanged (the method rides the value from its construction site); no cross-module identity promise. The view lives in a `WeakMap` keyed by the value in the method's closure — ephemeron cycle, collected per §5's addendum | §9.4 |
| *(2026-08-02)* Conformance: `for x in` still lowers through the outbound driver; a `Seq` argument to a foreign callable passes unwrapped (extern wrappers exist for inbound `Seq` positions only) | §9.4 |
| *(2026-08-02)* Two recorded costs of the emission shape, neither ruled on: the adapter-recognition latitude is declined (adapter-built values double-buffer under foreign traversal; compounds with #131), and occasion 1's wrapper exposes its generated `name` to JavaScript (`__hex_mapBoundary0` in `.name` and stack frames) | §9.4 |
| *(2026-08-02)* `Seq.hex`'s own `.d.ts` face conformed to `Iterable<a>` — the `Seq`-shaped member of §9.5 item 5's emitted-face debt family, discharged; the rest stays filed. Residue: the Part 7 §5 brand type remains declared in `Seq.d.ts`, referenced by nothing — legal, but dead importable surface, recorded | §9.5 |
