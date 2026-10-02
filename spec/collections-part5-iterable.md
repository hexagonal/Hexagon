# Hexagon Spec: Collections Part 5 — `Iterable` & Collections Closeout

**Status:** Decided (July 2026); pre-landing corrections incorporated in place (§18); `Iterable<String>` source ownership adopted September 2026 (§18.4); `Seq` seats — an iterable adapted where a sequence is expected, and a loop head over a source not yet known — adopted September 2026 (§3.4–§3.6). Fifth and final part of the Collections effort. The authoritative operational specification of v1 `Iterable`: the resolution and typing of `for p in e`, the finalized standard-instance table (nine rows, every one a source `honor` block: six core rows and three FFI-owned ones), table-opening for user instances, static-resolution emission, the collections/stdlib boundary, and the transients decision. Written against Collections Parts 1–4, Constraints, Loops/Ranges/Iteration, Pattern Matching, and Modules; none re-litigated.
**Scope:** The `for p in e` resolution algorithm and its failure taxonomy (a declared type variable's `Seq(a)` rewrite; the two-legal-homes user-nominal message); `Seq` seats — the adaptation of an iterable value where a sequence is expected, a source whose head is not yet known, and what never adapts (§3.4–§3.6); the standard instance table (§4); `Iterable<String>` with `Item = String`, its authoritative source declaration in `String.hex`, and the `String.toSeq`/`String.fromSeq` conversion pair (`fromSeq` = concatenation, full contract §5.3); the collection-conversion-suite domain (finite collections; `Range` and `Seq` exempt with reasons); `toSeq` as a real prelude term (the `Iterable` member); user-instance mechanics, discoverability, and collisions at filled slots; the "writing your own collection" recipe, normative, with `Bag(a)`; static-resolution emission; the combinator-surface boundary; transients runtime-internal only.
**Not in scope:** The `Iterable` declaration and type-member grammar (Part 2 §5–§8 — consumed, not restated); the v2 implied-types remainder (deferred `Item(α)` goals, `Item(c)` reference syntax, member obligations, `Iterable` binders, `derive via` — Part 2 §11, Part 1 §6.3); the combinator families themselves (`stdlib-roadmap.md` ledger, decided at the stdlib listing; boundary drawn in §10); `AsyncSeq` and any `for await` form (Loops §11.4); **everything normative about the foreign collections `Array(a)`, `JsMap(k, v)`, `JsSet(a)`** — types, capture and borrow contracts, observation semantics, conversions, emission, `.d.ts` faces (FFI Parts 2 and 10; §4 records their instance rows, §6 the discharged `Array` ownership); the foreign (`.d.ts`) representation of constraints on exported polymorphic functions (FFI spec; see §9.3); String text-processing operations beyond this document's iteration and `fromSeq` contracts (`string-text-processing.md`).
**Companions:** Functions (§4's specified conversions; §4.3's seats, channels, and an argument's own turn; §8 item 2); Method Syntax (§3's deadline; §10's doctrine); Ascription (§3); Collections Part 1 (§6.1/§6.5 made normative here; §9.5/§9.6 closed); Collections Part 2 (§8 declaration; §7.2 binder ban; §9 diagnostics extended); Collections Part 3 (§8 `Iterable<Vector>` row; §9 linear idiom cashed by §5 here); Collections Part 4 (§7.2 rows; §13.1/§13.4 closed here); Loops/Ranges/Iteration (§2.3 desugaring; §5 table finalized as §4 here; §6 `Seq`; §7.1 judgment made normative as instance lookup); Pattern Matching (§5 five-positions gate); Modules (§7 instance globality and orphan rule; §7.6 discoverability); Constraints (§5.1 coherence; §2.2 members); FFI Part 2 (§§6, 8–9: the `Array(a)` obligation discharged); FFI Part 3 (`Seq(a)` boundary crossing); FFI Part 10 (§6 `JsMap`/`JsSet` rows); Primitive Types (§5.1 String indexing).

---

## 1. Doctrine

- **The table is the constraint.** The Loops §5 iterable table *is* `Iterable`'s instance table (Part 2 §8); this document finalizes its v1 rows and opens it to users. There is no second mechanism, no registry beside the constraint system.
- **"You can write a real collection" is a v1 requirement, and `for x in myBag` is its floor** (Part 1 §6.1, discharged here). The whole tax is one small `honor` block.
- **Loops and `Seq` seats are one consumer.** A `for` head and a seat expecting `Seq(a)` both require a sequence, and the same lookup supplies it from an iterable value (§3.4). Consumers take `Seq(a)`; callers pass their collections as they are.
- **v1 iteration is monomorphic.** The projection-bearing binder ban (Part 2 §7.2) means every `for..in` site knows its collection's outer constructor at compile time. Static instance resolution and dictionary-free loop emission are therefore *consequences*, not optimisations (§9.1).
- **Iterable and "in the conversion suite" are different properties.** `toSeq` is the `Iterable` member itself (§2.3): every iterable type has it, supplied by its instance. The **conversion suite** is the stronger, finite-collection property of *also* providing `fromSeq` under exactly that name — deliberately including `String` (§5). `Range` is iterable but is not a collection: its instance supplies `toSeq` like any instance's, but `Range.fromSeq` has no natural meaning and does not exist. `Seq` is the conversion **currency itself** — its instance's `toSeq` is the identity — and it crosses the FFI boundary through FFI Part 3's explicit adapters. `Array(a)` is a suite member (decided by FFI Part 2 §8.3; §6 here). Third-party collections are expected to provide `fromSeq` as part of the recipe (§8.1); their `toSeq` is their instance's member.
- **Structure here, combinators there.** The collections specs own what a collection *is*; the stdlib listing owns the combinator families over it (§10). The Part 1 §3 naming doctrine binds both.

---

## 2. The constraint, the member, and the table

### 2.1 The declaration (by reference)

```
constraint Iterable<c> =
    type Item
    toSeq(xs: c) -> Seq(Item)
```

Normative home: Part 2 §8 (declaration, `Item` naming, projection-bearing status, binder and reference bans). Nothing is redeclared here; this document is its operational half, exactly as Part 2's not-in-scope line promised.

### 2.2 The judgment is instance lookup

Loops §7.1's judgment **Iterable(τ) = ε** is hereby defined normatively as: *look up the unique global `Iterable` instance whose head constructor is τ's outer constructor; ε is that instance's `Item` binding under the substitution of τ's arguments.* Uniqueness is coherence (Constraints §5.1); globality is Modules §7.1; user rows enter per §7 here. The judgment's shape is unchanged from Loops — it was always a functional-dependency table; the table simply has a public door now.

### 2.3 `toSeq` is a real constraint member

With Part 2 §8's promotion, `toSeq` is an ordinary constraint member: a module-scope term name (Constraints §2.2), reached at concrete types by the dot — `"abc".toSeq() : Seq(String)`, `myBag.toSeq() : Seq(Int)` (Method Syntax §7) — and qualified, through the declaring module (`Iterable.toSeq(range)`) or an honoring companion (`Vector.toSeq(values)`); it is not seeded bare (Modules §5.5's set). Consequences, stated once:

- **Loops §2.3's reference desugaring now names this member.** The `toSeq(e)` in the desugaring, formerly described as compiler-internal, is the constraint member itself; the desugaring is otherwise character-for-character unchanged (edit note, §16).
- **Qualified home:** `Iterable.toSeq` — the member is an export of its declaring module, `stdlib/Iterable.hex` (Part 2 §8), which satisfies the Modules §6.4 invariant. A module-level user `toSeq` is an ordinary binding and never meets the prelude's, which has no bare spelling to occlude; the qualified forms stay reachable.
- **One member, never a plain export.** The collection companions do not *export* `toSeq` as a plain function — a module-level binding of a member's spelling beside the instance is the Constraints §4.6 rebinding error — so each supplies it as its instance's member, and the per-type qualified spellings (`Vector.toSeq`, `Map.toSeq`, `Set.toSeq`, `String.toSeq`) are the uniform-access honored-member read (Modules §5.3), qualifiable but never a bare export (Constraints §4.6). One member, every per-type spelling intact.
- **`iterate` is not this member's name.** `Seq.iterate(seed, step)` — the seed/step producer — is an ordinary `Seq` combinator, unrelated to iteration-as-conversion, and keeps its canonical name precisely because the member does not claim it.
- `Seq.next` and the functional-cursor protocol are untouched (Loops §6.2).

---

## 3. Consuming an iterable: `for` heads and `Seq` seats

> Both loops and sequence parameters require a sequence, and the same adaptation rule supplies one from an iterable value.

Two consumers need a sequence: a `for` head (§3.1) and a seat whose expected type is headed by `Seq` (§3.4). The consumer establishes that a sequence is needed; the source's type establishes which `Iterable` instance supplies it, by the one lookup of §2.2. A function that needs only sequential traversal therefore takes `Seq(a)`, and its callers pass their collections as they are — `String.fromSeq(words)` means `String.fromSeq(Iterable.toSeq(words))` — so no consumer needs a second `fromIterable` entry point beside its `fromSeq`. Functions that need indexing, keyed lookup, updates, or a particular collection result keep taking that collection.

### 3.1 The algorithm (normative)

For `for p in e` with body `b`:

1. Typecheck `e` **once**, yielding τ. (`e` is evaluated once at runtime, before iteration — Loops §2.3, unchanged.)
2. Resolve τ's **outer type constructor**. A declared type variable fails per §3.2. An unsolved inference variable **waits**: the loop makes τ's `Iterable` demand now, as a `Seq` seat does (§3.5), and the demand's `Item` stands as ε for steps 5–7; steps 3–4 run when τ's head is established — by its owner region's close at the latest, where a head nothing established is `Seq` (§3.5). Whether the loop's head is accepted therefore never depends on whether an earlier or a later statement describes its source (#1118).
3. Look up the unique global `Iterable` instance for that constructor (§2.2). If none exists, fail per §3.2.
4. Substitute τ's arguments into the instance's `Item` binding, yielding the element type ε — for a source that waited, unifying it with the demand's `Item`.
5. Check the loop pattern `p` against ε. `p` is a full pattern; its binders are **head binders** (Statements §5, via Pattern Matching's loop-head position).
6. Require `p` to be **irrefutable at ε** (Pattern Matching §5 — the one gate, no loop-specific dialect).
7. Check `b` against `Unit` (Loops §2.2, unchanged, including the discard-error phrasing).
8. The whole expression has type `Unit`.

Steps 5–6 consume Part 4 §7.2's supersession of Loops §2.1: loop heads are one of Pattern Matching's five positions; `for (k, v) in m` is the canonical beneficiary.

A waiting source's element is read in the body as the schedule has solved it (Functions §4.3's ordering pin): known where an earlier seat or statement fixed it, an inference variable otherwise — so a body that must dispatch on the element, a `match` on it (Pattern Matching §6.1), needs it fixed before the loop, or the source annotated. Conceptually the loop traverses `Iterable.toSeq(e)`: loops and `Seq` seats share one capability lookup and one conversion meaning (§3.4), which neither turns a call into a loop nor requires a loop to allocate a sequence — native traversal stays where canonical provenance licenses it (§9).

### 3.2 Failure taxonomy — three cases

An annotation fixes an inference variable; it cannot fix a declared type variable, and telling the user to annotate a generic parameter is a false trail. The declared-variable case reuses Part 2 §9's binder-ban hint verbatim, because it is the same fact surfacing at a use site. An unsolved inference variable is not a failure: its head waits for its owner region's close (§3.1 step 2, §3.5).

| τ at step 2/3 | Error |
|---|---|
| Declared type variable (written in the enclosing function's annotations or binders, or an instance binder) | "`xs` has the generic type `c`, and `Iterable` declares an implied type and cannot constrain a type variable in v1; take a `Seq(a)` parameter instead" |
| Concrete constructor, no instance, **not** a user nominal type | "`Int` is not iterable" + a conversion hint where one exists |
| Concrete constructor, no instance, **user nominal type** | the two-legal-homes form, §3.3 |

### 3.3 The user-nominal diagnostic names both legal homes

For a user nominal `T` with no instance, the message is the loop-side face of the instance-discoverability obligation (Modules §7.6). The compiler always knows both legal homes — the orphan rule's search space of size two — and the message names **both**, leading with the actionable one:

> `Bag(Int)` is not iterable. Define `honor Iterable<Bag(a)>` in module `Bag`, which declares `Bag`. The only other legal home is the prelude module declaring `Iterable`. Alternatively, convert with `Bag.toSeq`-style functions, or take a `Seq(a)` parameter.

The prelude home is not user-editable, but naming it makes the two-home rule accurate and explains *why no third module can provide the instance* — the orphan rule handed to the user as a closed search space, not a hint. This subsumes Part 1 §6.4's earlier hint amendment, upgraded to name the modules.

### 3.4 `Seq` seats adapt

**A value whose type is not `Seq` meets a seat whose expected type is headed by `Seq` through its `Iterable` instance**: the seat inserts the instance's `toSeq`. This is one of the language's **specified conversions** (Functions §4): the seat's expected type elaborates it where the value meets the seat, exactly as Numeric Literals §5.1's widening is elaborated, and no other conversion ever happens there.

```
let words = ["red", "green", "blue"]
String.fromSeq(words)                   -- String.fromSeq(Iterable.toSeq(words))

let view: Seq(String) = words           -- adapted at the annotation
let same = words                        -- Vector(String): no seat asks for a sequence

let colors(): Seq(String) =
    ["red", "green"]                    -- adapted at the declared result
```

**The seats** are Functions §4.3's supplying seats whose expected type is headed by `Seq`, and the parts that section hands an expected type to:

- **An argument** at a parameter headed by `Seq` when the call is checked — by the callee's written signature or an instantiated inferred one, a constructor's parameter included. Qualified calls, aliases with known signatures, pipes, and dot calls in their resolved argument positions are calls alike; a dot call that resolves late meets its arguments where it resolves, as its widening does (Method Syntax §3.4).
- **An immutable binding's annotation**, and an expression ascription's written type (Ascription spec §3).
- **A declared result** — a function's return annotation — and a lambda's body where the function type it lands on supplies a `Seq` result.
- **A constraint member's body** against its contract's `Seq` result (Functions §4.3's member seat).
- **The parts an expected type reaches** through Functions §4.3's channels: a forwarding form's value paths (grouping, a block's final expression, both branches of `if`, the arm bodies of `match` and `try`, a `try`'s body block); a constructor application's arguments, where the application's expected type solves their parameters (`let o: Option(Seq(String)) = Some(words)`); a literal form's parts — tuple components, record fields, a vector literal's elements, a `with` update's overrides (`let p: (Seq(String), Int) = (words, 1)`); and the values on an argument's spine (`usePair((words, 1))`).

Inside an `Iterable` instance's own `toSeq`, every one of these seats keeps §3.6's one exclusion. The consumer's type is read as resolution has fixed it: adaptation never takes part in choosing a callee, resolving a dot, or selecting an overloaded meaning. A `var`'s annotation and an assignment's right-hand side are not sequence seats — `var s: Seq(String) = words` is refused — though numeric widening reaches the assignment boundary (Numeric Literals §5.1).

**The adaptation.** At the seat's final check (Functions §4.3's ordering pin), on the normative schedule:

1. Read the seat's expected type as the schedule has solved it. Its head must already be `Seq`; its element may be an unsolved variable. A seat whose type is still a bare variable is not a sequence seat, and a later sibling that solves it to a `Seq` does not return to the value: nothing is checked twice.
2. Establish the source's type once, keeping its own head. The source is never first forced to `Seq`, retried at another interpretation, or given an overloaded meaning by the sequence demand.
3. A `Seq(b)` source passes unchanged, `b` unified with the expected element.
4. A source of any other known head — `Vector(a)` has one, generic element and all — resolves its unique global `Iterable` instance (§2.2), substitutes its arguments into the instance's `Item`, and discharges the instance's prerequisites, which never select among candidates. A head with no instance is refused, never passed through. A source whose type is still a variable waits (§3.5).
5. Unify the `Item` with the expected element by ordinary unification. If it succeeds, the instance's `toSeq` is inserted; otherwise the mismatch is reported (§12). There is no second route.

Instance identity, prerequisites, visibility, and provider availability are exactly those of the explicit member call: an adaptation grants no access to an implementation or provider the explicit call could not reach, and a plain function named `toSeq` establishes no `Iterable` capability.

**A form's paths under an open element.** Where the seat's head is `Seq` and its element, or a part of it, is open — a generic `Seq(a)` parameter, `Seq(_)`, `Seq(Option(_))` — the paths of a forwarding form first agree on their **element types**, each path's own or its instance's `Item`, joined as Functions §4.3 joins the paths of a form whose expectation leaves a part open (#1107) and reported where that join reports: at an `if`, the `if`; at a `match` or `try`, each later arm that disagrees; among a vector literal's elements read against `Vector(Seq(_))`, the later element. Each path is then adapted on its own, and only the selected path's conversion runs. A path whose head has no instance is refused where it stands (step 4), not joined; a path whose head is not yet known contributes only its pending `Item` (§3.5), never takes a sibling's head, and is decided at the close like any unknown source.

```
Seq.length(if useFirst then names else moreNames)
-- names : Vector(String), moreNames : Set(String): the elements agree on String,
-- so a = String, and each branch converts through its own instance
```

`Vector(Int)` against `Set(String)` is refused at the `if`: no one `Seq` holds both. In `fun f(c, xs, names: Vector(String)) = Seq.length(if c then xs else names)`, `xs` is `Seq(String)` by the close's default (§3.5), never `names`'s `Vector`.

**Only a seat's `Seq` head authorizes a conversion.** A sequence-valued path does not authorize converting its sibling; a value at a callee's bare type variable never adapts, whatever its group holds (`pick(seq, vec)` at `pick<a>(x: a, y: a)` is refused); and inference never invents `Seq` as a common collection type. A channel adapts the value newly written at its part, never an existing value: an `Option(Vector(String))` already held is refused at `Option(Seq(String))` (§3.6), while `Some(words)` written there adapts `words`.

**The source's constructor stays its own.** No channel hands a `Seq` face into a source while the source elaborates: a lambda declines it (not a function type), a constructor application unifies its result early only where the heads match (Functions §4.3), a literal form hands parts only where its written shape matches — a vector literal meets `Vector(t)`, never `Seq(t)` — and no other call's result meets its expected type ahead of its arguments. The expectation reaches the source only as the value it must adapt into.

### 3.5 A source whose head is not yet known

**The element is linked at once; the head waits.** A source whose type is still a variable at a `Seq` seat or a loop head — an unannotated parameter nothing has yet described — makes there, at its own turn, the demand the explicit call makes: `Iterable` on the source, its `Item` the expected element. It is the subject's one demand (Part 2 §7.2.1), which every seat, loop head, and explicit call on the source joins. So the element is known whatever collection the source turns out to be: after `sumInts(v)` (`sumInts : (Seq(Int)) -> Int`), `Seq.map(v, …)`'s callback reads `Int`. At an argument the demand is made at the argument's turn, not where an argument whose type is still a variable otherwise meets its parameter — when the first pass ends, or at the call's end (Functions §4.3). Only the head waits: when the owner region establishes it, §3.4's steps 3–5 decide then, so `String.fromSeq(xs)` beside `Vector.length(xs)` converts `xs` in either statement order. The conversion, where there is one, is elaborated once, when the head is known; the value is never checked again. A head that arrives late with no instance, or with an `Item` that disagrees with the linked element, is reported where the subject's demand was made — the first seat, loop head, or explicit call on it — in that site's own wording, since a report stands where its demand was made (Functions §10); so its place never depends on whether the head arrives before or after that site: `sumInts(v)` followed by `let k: Vector(String) = v` is refused at `sumInts(v)`, where the argument's seat reports, as the two lines swapped are.

**The default.** If the head is still unknown when the owner region closes, the source **is** the sequence a seat asked for: it takes the `Seq` reading, one defaulting step — `let f(xs) = String.fromSeq(xs)` is `(Seq(String)) -> String` — and an explicit `Iterable.toSeq` demand on the same subject settles with it. The default belongs to seats and loop heads: an explicit call alone on a subject nothing describes keeps Part 2 §7.2.1's refusal (`let t(x) = Iterable.toSeq(x)` is refused). Owner and deadline are the subject demand's (Part 2 §7.2.1).

**A declared variable.** A source whose type is a declared type variable provides no head and never will. It is refused as the explicit call is (Part 2 §7.2.1), with §3.2's rewrite to a `Seq(a)` parameter. A declared variable in the element passes through ordinary unification — `let f(xs: Vector(a)): Seq(a) = xs` adapts, `Item = a` meeting the result's `a` — so rigidity never selects between readings: only the source's head does.

**The close.** At the owner region's close, every waiting source whose head is still unknown takes its `Seq` reading. The `Int` default never meets a waiting source, whose `Iterable` demand is not defaultable. Then the region's ordinary defaulting (Numeric Literals §4) and Part 2 §7.2.1's refusal of the demands that remain run. A default taken at the close is one decision on a variable nothing informed, never a revision: nothing before it committed the source to any head.

**What reads the head before the close.** A judgment that needs the source's head before the close reads it as the schedule has solved it — open — where a seat that committed at once would have made it `Seq`:

- a dot call on the source, which is refused at the dot: the text does not decide the source's type (Method Syntax §3.5);
- a `match` on the source itself (Pattern Matching §6.1's abstract-type refusal).

```
fun go(v) =
    let total = sumInts(v)              -- sumInts : (Seq(Int)) -> Int
    v.map(match                         -- refused: the arms see a variable
        n when n < 0 => "negative"
        _ => "other")
```

The repair is to annotate the source (`v: Seq(Int)`), or to spell the call qualified (`Seq.map(v, match …)`), whose callback reads the element the seat linked.

**What the rule adds to the type system: nothing.** Every adaptation is an application of a constraint member at an instance resolved at a known head, its `Item` substituted there; no variable acquires an `Iterable` bound, no projection is left symbolic, and no subtyping or conversion search enters unification. The elaborated program is an ordinary program, and its schemes are the ones inference derives for it. The source program is not claimed principal: `let f(xs) = String.fromSeq(xs)` is typable at `(Seq(String)) -> String` and at `(Vector(String)) -> String`, and their common generalization would be an `Iterable`-bounded variable with a projected element — v2's machinery (Part 2 §11). The checker gives the `Seq` typing, uniquely, by the default. Numeric Literals §5.1 makes the same concession on the same terms (`let g(v) = useFloat(v)` is `(Float) -> Float`): the typing is the one the normative schedule determines. The deferred decision is one of the Deferred-Goals Doctrine's kinds (Declarations Preamble §1.2).

### 3.6 What an adaptation means, and what never adapts

**An adaptation is its explicit call.** An inserted conversion behaves exactly like an explicit call to the resolved `Iterable.toSeq` at the same seat: the source is evaluated once, and runtime evaluation order, exceptions, traversal order, laziness, and cost are the explicit call's. No eager traversal, copying, memoization, or further foreign snapshot is added; a foreign collection's sequence observes the captured contents its boundary contract established (FFI Part 1 §2.2). `Iterable.toSeq`'s contract is pure (Effects §13), each instance body is checked against it, and an adaptation adds no effect mark and hides no effect of evaluating its source. The effectful `Stream` has no `Iterable` instance (`stream.md` §4.5) and never adapts. An adaptation is an application for generalization too: a right-hand side with one anywhere on its value tree generalizes as its explicit spelling does (Functions §8 item 2). (The word is this section's: FFI's boundary adapters, which wrap a value crossing to or from JavaScript — FFI Part 3 — are unrelated.)

**What never adapts:**

- **Elements.** An established `Vector(Int)` supplies `Seq(Int)`, never `Seq(Float)`: no numeric conversion is mapped over elements, and no sequence-element expectation is pushed inward to retarget a collection literal.
- **Structures.** An existing `Option(Vector(a))` does not become `Option(Seq(a))`. A newly written constructor argument or literal part at a `Seq` seat is a seat of its own (§3.4).
- **Functions.** An existing function returning a vector is not a function returning a sequence. A newly written lambda's body checked against a known `Seq` result is the ordinary body seat.
- **Method search.** A vector does not acquire `Seq`'s operations: a resolved `Seq.map(values, transform)` adapts its argument, while `values.map(transform)` resolves at `Vector` and never reaches `Seq.map`.
- **Other destinations.** There is no reverse conversion, no automatic collection materialization, no chain of conversions, no subtyping, and no change to `widens`.
- **An instance's own subject, in its own `toSeq`.** Inside an `Iterable` instance's `toSeq`, a value whose head is the instance's subject head is never adapted, at any `Seq` seat of the member's body — `s` itself, a `Stack(Int)` inside `honor Iterable<Stack(a)>` (with `record Stack(a) = {items: Vector(a)}`), or a child `k: Tree(a)` in a tree's flatten inside `honor Iterable<Tree(a)>` (`Seq.flatMap(kids, (k) => k)`) — since the only conversion there would be the member being defined, a call to itself the program never wrote. It is refused, with the rewrite named (§12): convert its contents (`toSeq(s) = s.items`), or write the call where recursion on a smaller value is meant. The exclusion is the member's own body, not what it calls: a helper whose written result is `Seq(a)` — `let flat(s: Stack(a)): Seq(a) = s`, called as `toSeq(s) = flat(s)` — adapts `s` through the instance being defined, exactly as `Iterable.toSeq(s)` written in `flat` would; the recursion is the program's, visible at a named function, and its repair is the same, `s.items`.

Every lawful instance follows the same rule: a `String` supplies codepoint strings, a `Map` its entry tuples, a `Set` its specified traversal order, and no consumer has an exception of its own. An exhaustive consumer of an infinite sequence can still fail to terminate. An explicit `toSeq` keeps its uses — a sequence wanted where no seat asks for one, or `Seq`'s operations chosen by the dot — and every existing spelling of it stays.

---

## 4. Standard instances: the finalized v1 table

This is the complete v1 table, and every row in it is an ordinary source
`honor` block. `String`'s is in its fixed primitive companion (§5). `Range`,
`Vector`, `Map` and `Set` each have theirs in the companion that declares the
type — `stdlib/Range.hex`, `stdlib/Vector.hex`, `stdlib/Map.hex`,
`stdlib/Set.hex` — written over a traversal the companion already has: a
private door for `Range`, `Vector` and `Set` (Intrinsics §3.2), and `Map`'s own
exported `entries`, so that `toSeq ≡ entries` holds by construction. `Seq`'s row
is in `stdlib/Iterable.hex`, the constraint's own module, and can be nowhere
else: `Seq.hex` seats before `Iterable.hex`, whose member's signature names
`Seq`, so the companion cannot name the constraint, and seating it later would
be a cycle (Modules §5.5). The final three are FFI-owned rows over captured
foreign collections (#876, #875), each declared by a source `honor` block in the
companion that declares its type — `stdlib/Array.hex`, `stdlib/JsMap.hex`,
`stdlib/JsSet.hex` — over a private traversal door (Intrinsics §3.2, §3.3).

Source ownership changes neither lookup nor the public member spellings, with
one exception at `Seq`. A companion's qualified `Vector.toSeq(v)` is Modules
§5.3's read of the member its module honors; `Seq.hex` honors nothing, so there
is no `Seq.toSeq`. A sequence reaches its row as `s.toSeq()` or
`Iterable.toSeq(s)`, both of which read the instance wherever it is declared,
and the refusal of `Seq.toSeq` names both (§12).

| Type | `type Item` | `toSeq` (the member) | Fixed by |
|---|---|---|---|
| `Range` | `Int` | the range's progression (ascending or descending per the value; Loops §3) | **`stdlib/Range.hex`**; Loops §3/§5 |
| `Vector(a)` | `a` | the Part 3 §7.2 conversion | **`stdlib/Vector.hex`**; Part 3 §8 |
| `Seq(a)` | `a` | identity | **`stdlib/Iterable.hex`**; Loops §6 |
| `Map(k, v)` | `(k, v)` | ≡ `entries` | **`stdlib/Map.hex`**; Part 4 §7.2 |
| `Set(a)` | `a` | element traversal | **`stdlib/Set.hex`**; Part 4 §7.2 |
| `String` | `String` (one codepoint) | the source instance's codepoint sequence, §5.2 | **`stdlib/String.hex`; §5 here** |
| `Array(a)` | `a` | ≡ `Array.toSeq` (FFI Part 2 §9's named conversion) — over the captured array, a stable value (#876) | **`stdlib/Array.hex`**; FFI Part 2 §8 |
| `JsMap(k, v)` | `(k, v)` | ≡ `entries` — over the captured map, a stable value (#875) | **`stdlib/JsMap.hex`**; FFI Part 10 §6 |
| `JsSet(a)` | `a` | ≡ `JsSet.toSeq` — over the captured set, a stable value (#875) | **`stdlib/JsSet.hex`**; FFI Part 10 §6 |

Notes:

- The final three rows inherit their observation and emission semantics from their owning FFI parts; this table records their coherent `Iterable` instances rather than restating those capture contracts.
- `Range` participates in iteration but not in the conversion suite (§1): its instance's `toSeq` exists like any member's, but there is no `Range.fromSeq`. `Seq`'s row is the identity — the currency needs no conversion into itself — and the identity is *lawful* because `Seq` traversal is pure: `toSeq`'s contract is `->` (Effects §5, §13.5), and a persistent pure sequence is re-traversable and shareable, so the sequence view of itself **is** itself. Identity handed to an effectful producer would alias consumption state, which is exactly why `Stream` has no instance and `Stream.toSeq` is inexpressible rather than omitted (`stream.md` §4–§5). `toSeq`'s pure contract is checked at every instance (Effects §13.2), so the unsound identity is not forbidden by convention — it is unspellable.
- No other v1 type is iterable. In particular the prelude unions `Option`/`Result`/`Bool` are not (`match` is their consumption form — for `Bool`, joined by its condition/operator eliminators, Unions §1/§8; it keeps `Option`/`Result` company here since #147 reclassified it out of this note's primitive clause *(2026-07-29; record §18.3)*), and `Int`/`Float`/`Unit`/functions are the §3.2 concrete-non-iterable case.
- This table closes Loops §11.6 and is the finalized Loops §5 inventory (Loops now defers here by reference).

---

## 5. `String`: iterable, and its conversion suite

### 5.1 The instance — `Item = String`, one codepoint per item

`Iterable<String>` is declared authoritatively in `stdlib/String.hex` through
the ordinary instance mechanism:

```hex
honor Iterable<String> =
    type Item = String
    toSeq(text) = nativeToSeq(text)
```

`nativeToSeq` is a private, explicitly typed intrinsic-door binding for the
representation traversal; it is not a second instance and is not public API.
The source block is the unique coherence provider, with `type Item = String`;
each item is a
**one-codepoint `String`**, in codepoint order. A valid surrogate pair is one
item. A lone surrogate supplied by JavaScript is one preserved item, but not a
Unicode scalar value (Primitive Types §5.1; String Text Processing §1 and §9).
This closes the question Loops §11.6 left open, in the only way it could close:

- Hexagon has no `Char` (Primitive Types §5.1); a one-codepoint `String` is the established unit — it is exactly what `s[i]` returns (Part 3 §9).
- Part 2 §8 already carried `String` in the iterable inventory; Part 3 §9 already tells users "the linear idiom is `for c in s`". The source declaration now makes that capability visible where readers meet the type.
- **`for c in s` is O(n) total** — a single pass — which is precisely the escape from the O(n²) bracket-in-a-loop trap Part 3 §9 warns about. The doc states the pairing: brackets for occasional access, the loop for traversal.
- Grapheme-cluster iteration, if it ever ships, is a named stdlib function (mirroring Part 3 §9's indexing stance); the instance is codepoints, permanently.

### 5.2 `String.toSeq`

`String.toSeq : String -> Seq(String)` — the codepoint sequence, in order. Lazy (a `Seq` view over an immutable string is safe by construction); O(1) to create, O(n) to exhaust. **There is no `String.codepoints` synonym** — Loops §11.6's interim name is not introduced; the uniform suite name is the API (rejected alternative, §13.1).

### 5.3 `String.fromSeq` — concatenation, full contract

`String.fromSeq : Seq(String) -> String` — concatenates the elements. The contract, normative:

- **Empty sequence produces `""`.**
- **Elements concatenate in the sequence's traversal order.**
- **Elements may be strings of any length** — `""`, one codepoint, many. `fromSeq` is forgiving, like every `from*` constructor (`Vector.fromSeq` accepts any `Seq`, not only ones produced by `Vector.toSeq`); semantically it is the fold of `++` (`Concat<String>`, Operators §7) over the sequence.
- **No Unicode normalization occurs.** The result is exactly the codepoint concatenation of the inputs; `fromSeq` never inspects, folds, or canonicalizes content.
- **Eager; an infinite `Seq` diverges** (the `from*` family stance, Part 3 §7.2 / Part 4 §3.4).
- **Complexity: linear in the total input/output length.** *Implementation note (binding on the emitter/runtime):* collect chunks and join (`parts.join("")`-shaped); the fold-of-`++` description above is **semantic only** and must not license quadratic repeated immutable concatenation.
- **Round-trip law, one-sided:** `String.fromSeq(String.toSeq(s)) == s`, for every `s`. The converse makes no chunk-boundary claim: `toSeq(fromSeq(xs))` yields one-codepoint items, not `xs`'s original chunks.

This keeps the finite-collection conversion suite (§1) exception-free where it
applies. The separator-taking
`String.join(parts: Seq(String), separator: String): String` is specified by
String Text Processing §7. It supplements rather than replaces `fromSeq`.

---

## 6. `Array(a)`: ownership decided here, discharged by FFI Part 2

### 6.1 The obligation, discharged

The *direction* — the foreign door is iterable — was decided here as a binding obligation on the v1 FFI spec (`Iterable<Array(a)>` with `type Item = a` and the member `toSeq` behaving as `Array.toSeq`) and was never FFI's to reopen. Everything that gives the row meaning was FFI's to define, and FFI Part 2 has discharged it in full; nothing about `Array` iteration remains open, and none of it is restated here:

- **Stability and observation.** FFI Part 2 §6.2 fixes the capture contract *(#876; formerly a borrowed stability contract)*: an `Array(a)` is Hexagon's own snapshot of the foreign array, made at the crossing. §6.5 there resolves the observation question this section deliberately left to it — every observation, iteration included, is of that stable value, so native `for...of` emission is licensed (§8.2 there).
- **The instance.** FFI Part 2 §8 declares `Iterable<Array(a)>` under exactly the obligated shape, and `stdlib/Array.hex` honors it; the row appears in §4 here. Suite membership is decided: `Array(a)` joins the finite-collection conversion suite (§8.3 there; doctrine §1 here).
- **The conversion surface.** FFI Part 2 §9 fixes the four names — `Array.toSeq` / `Array.fromSeq` / `Array.toVector` / `Vector.toArray` — with their laziness/freshness and shallow-element semantics.

The resolution algorithm (§3), the recipe (§8), and the domestic emission rules (§9) were designed to be, and are, unaffected by the discharge.

---

## 7. User instances: the table opens

### 7.1 What a user writes

Exactly the Part 2 §5.3 form — nothing loop-specific:

```
honor Iterable<Bag(a)> =
    type Item = a
    toSeq(bag) = ...            -- the conversion body; §8.2's worked example
```

The member *is* the type's `toSeq`: the honoring module writes the conversion here rather than as a plain export — a module-level binding of a member's spelling alongside the instance would be the rebinding error (Constraints §4.6) — and `Bag.toSeq` remains a correct consumer spelling as the uniform-access honored-member read (Modules §5.3). Exactly-once member binding, the (constraint, constructor) coherence slot, and the orphan rule (home of `Iterable` — the prelude — or home of `Bag`) all apply unchanged (Part 2 §5.3–§5.4, Modules §7.2). Writing the instance adds the row; §3's resolution needs nothing else. The instance is legal on `record` and `union` types alike, `opaque` or not — opacity hides structure, not capabilities (Modules §4.2).

### 7.2 Globality and discoverability

Instances are global over the import graph (Modules §7.1). For the home-module instance the graph does the work by construction: **no `Bag` value can exist in a program whose graph excludes module `Bag`**, so wherever a `Bag` flows, its instance is already present — including into modules that never name `Bag` (values carried by inference). No separate loading step is needed for `Iterable` on your own collection — Modules §3.3 has no form for one — and none is taught in the recipe (Modules §7.6: unnecessary in v1). What the user needs when something goes wrong is §3.3's diagnostic, which hands them the orphan rule's search space of size two.

### 7.3 Collisions at a filled slot

Every standard row occupies an ordinary coherence slot, declared by the module §4 names. A user `honor Iterable<Vector(a)>` fails the **orphan rule** — the user's file declares neither `Iterable` nor `Vector` — and because an instance the module sees already fills the slot, the orphan error names it and the module that declares it: *"orphan instance: this module declares neither `Iterable` nor the instance subject; `Iterable<Vector(a)>` is already declared in module `Vector`."*

That one report is the whole verdict. No duplicate-instance report follows it: the orphan refusal already says the `honor` cannot stand, and its clause already says why no module the user owns could supply the instance, so a second report would only restate the first. The rule is the orphan rule's (Constraints §5.3), not `Iterable`'s: any orphan `honor` on a filled slot takes it, naming the occupant's module as the reader spells it (Modules §7.6 — a prelude module by its bare name) or "this module" when an earlier `honor` in the same file filled the slot.

The fold is at the orphan's own declaration only. Any other module that reaches both instances still reports the duplicate (Modules §7.3), as does a second `honor` that satisfies the orphan rule where it is written — at a standard row that means standard-library source, a second row in a companion. Duplicates follow Modules §7.3: same module at the second declaration, cross-module at whole-program check naming both sites.

---

## 8. The recipe and the worked example: `Bag(a)`

### 8.1 The recipe (Part 1 §6.5, now normative)

A third-party collection in v1 is complete with:

1. **one `honor Iterable` instance** whose `toSeq` member is the conversion — this is `for..in` *and* the suite's `toSeq` half in one declaration (`Bag.toSeq` reads through it, Modules §5.3);
2. **`fromSeq`** as an ordinary exported function (the suite's construction half, §1);
3. element constraints (e.g. `<a: Hash>`) in its own signatures **only where an operation genuinely consults them**.

The whole tax is one small instance. Anything more (combinators, instances like `Eq`) is ordinary library surface, not iteration machinery.

### 8.2 The example

```
-- bag.hex — a multiset: an opaque record over Map(a, Int) counts
module Bag

opaque record Bag(a) = {counts: Map(a, Int)}

export fun fromSeq<a: Hash>(items: Seq(a)): Bag(a) = ...
export fun add<a: Hash>(bag: Bag(a), x: a): Bag(a) = ...
export fun count<a: Hash>(bag: Bag(a), x: a): Int = ...   -- 0 when absent
export fun size(bag: Bag(a)): Int = ...                    -- total multiplicity

honor Iterable<Bag(a)> =
    type Item = a
    toSeq(bag) = ...
        -- each element repeated `count` times, elements grouped; see order
        -- note below. This member is Bag's `toSeq`: `Bag.toSeq` reads it.
```

```
-- consumer.hex
module Consumer

import Bag

let bag = Bag.fromSeq(Vector.toSeq([1, 2, 2, 3]))
var total = 0
for x in bag                 -- Item = Int; resolution: head constructor Bag → the instance
    total := total + x         -- 8

-- The generic form remains unwritable in v1, exactly as designed:
fun sum<c: Iterable>(xs: c): Int = ...
    -- ERROR: `Iterable` declares an implied type and cannot constrain a
    --        type variable; take a `Seq(a)` parameter instead   (Part 2 §7.2/§9)

-- The idiom:
fun sum(xs: Seq(Int)): Int = ...
sum(bag)                     -- 8: the Seq seat adapts through Bag's instance (§3.4)
```

What the example fixes, normatively:

- **Constraint placement is honest:** `fromSeq`/`add`/`count` need `<a: Hash>` (they consult the backing `Map`'s keys); `size` and the `Iterable` instance — `toSeq` included — need **nothing**: iteration never hashes. A user whose element type lacks `Hash` can still iterate a `Bag` handed to them; they simply cannot build one.
- **The instance lives in the type's home module** (module `Bag`) — the ordinary orphan-legal choice, and the one §3.3's diagnostic points at.
- **Opacity and instances compose:** `Bag` is `opaque`; consumers cannot see `counts`, but `for x in bag` works, because the instance was declared where nothing is hidden.
- **The order contract is inherited and must be stated:** `Bag.toSeq`'s cross-element order is its backing `Map`'s iteration order — deterministic for a value within one execution, unspecified, unstable across runs (Part 4 §7.1). A user collection's docs inherit the obligation to say so; this one just did.

---

## 9. Emission — forced consequences

### 9.1 No dictionaries at loop sites — a consequence, not a choice

The binder ban (Part 2 §7.2) makes every `for..in` site monomorphic in the iterable's outer constructor, so the compiler always knows the concrete instance statically. There is no program in which a runtime instance lookup *could* occur at a loop; dictionary-free emission is total. A `Seq` seat's adaptation is resolved at a known head in the same way (§3.4), and emits exactly its explicit call: the instance's `toSeq`, statically resolved. (Dictionaries can still appear where any constraint's do — inside genuinely polymorphic functions — but never introduced by iteration, which no binder can carry.)

### 9.2 The emission table

Loops §8 is restated **by reference and unchanged** — in particular the counting-loop erasure for syntactic ranges remains **mandatory**, and nothing in the general story below weakens it. What this document adds:

| Case | Emission |
|---|---|
| Syntactic range head (`1..n`, `Range.up(...)`, `Range.down(...)`) | native counting loop — Loops §8, mandatory, unchanged |
| `Vector` / `Map` / `Set` / `Seq` | `for (const x of e)` — every emitted value is a JS iterable (Loops §6.5, Part 3, Part 4 §11) |
| `Map` with tuple head | `for (const [k, v] of m.entries())`-shaped (Part 4 §11) |
| `String` | `for (const c of s)` — native JS string iteration is codepoint-wise, which is exactly §5.1's semantics; zero helpers (strings are immutable, so no observation question arises) |
| `Range` value through a variable | general path over the materialised range object (Loops §8, unchanged) |
| **User instance** | statically resolved `toSeq` call in the head: `for (const x of __Iterable_Bag.toSeq(bag))`-shaped — a `for..of` head is evaluated once (Loops §2.3), and it is read into a `const` first only where it mentions the loop variable's name (Loops §8) — then the general path over the emitted `Seq` |

(`Array(a)`, `JsMap`, and `JsSet` emission is owned by FFI Parts 2 and 10, which license native iteration over the captured collections (#876, #875) — §6.)

The user-instance call is statically resolved: it names the instance's emitted object (here `__Iterable_Bag`, whose `toSeq` is the instance's `toSeq` body), so the member keeps its name, and no dictionary is passed or selected at runtime. Where the instance's `toSeq` is a trivial delegation, the emitter may inline through it; observable behaviour per Loops §2.3 either way.

`String`'s source ownership is deliberately not an abstraction tax. Its
canonical source instance must retain the pre-migration lowering: a direct
`for..in` loop emits native `for...of` over the string with no `Seq` allocation,
dictionary read, or member-call hop, while an explicit `String.toSeq`/
`Iterable.toSeq`/dot call reaches the same lazy native adapter as before — O(1)
to construct and O(n) to exhaust. This is a required semantic-and-cost
preservation rule, not an optional optimization. It is licensed only after
resolution identifies the canonical `String.hex` declaration; a same-spelled
user declaration receives no such lowering. Tests must cover runtime items,
emitted shape, laziness, and the absence of the extra adapter on the loop path.

### 9.3 Laziness and `.d.ts`

- `for x in s` over a `Seq` pulls elements **on demand** (the functional cursor, Loops §6.2/§6.5); an infinite `Seq` loops forever, computing each element only as reached — exit is via `throw` or process end, per the `while True` stance (Loops §4).
- **No `Iterable`, `Item`, or `Iterable`-instance machinery appears in `.d.ts`.** The constraint cannot leak by construction (no binder can carry it — Part 2 §8), instances are never exports (Modules §11.5), and the v1 reference ban keeps `Item` out of every signature. **The foreign representation of *other* constraints on exported polymorphic functions (e.g. `Bag.fromSeq`'s `<a: Hash>`) is owned by the FFI spec** — see the bounded exported-dictionaries direction (`spec/notes/ffi-exported-dictionaries.md`); this document asserts nothing about it. (`Seq(a)` itself faces as `Iterable<a>` — Loops §6.5 — which is a statement about `Seq`, not about the constraint.)

---

## 10. The collections / stdlib-listing boundary — decided

The roadmap's leaning is fixed as the rule:

- **The collections specs (Parts 1–5) own:** the types and names; representation references and complexity contracts; construction (literals, `fromVector`, `from*` eagerness); the core access surface (the accessor pair, `at`, slicing); the update doctrine (upsert, forgiving removal, representative retention); set algebra; the standard instances (`Eq`/`Ord`/`Show`/`Hash`/`Concat`/`Iterable`), whether source-owned or provided; the conversion suite (`toSeq`/`fromSeq` on every finite collection, §1); patterns; operator boundaries.
- **The stdlib listing owns:** the combinator families over every collection and `Seq`, including the v1 ship-list versus deferred split within them, inventoried in `stdlib-roadmap.md` and decided at the listing session under the Part 1 §3 naming doctrine, which binds there in full (banned families, subject-first, `Option`-shaped totality). String Text Processing now owns `String.join` and the rest of that companion's text-processing surface.

The test for future placement: *does it define what the structure is, or what you can do over it?* Structure here; doing there.

---

## 11. Transients — runtime-internal only (decided)

The runtime **may** batch internal construction and bulk operations with transient (`withMutations`-style) mutation — `fromSeq`/`fromEntries`/`fromVector`, set algebra, `String.fromSeq` — behind the persistent API. **No public transient API ships in v1**: no `withMutations`, no transient handle types, no scoped-mutation blocks.

Rationale: a public transient is an observable mutable collection value, in a language whose entire mutation story is `var` confinement inside function bodies (Statements §6) — it would be the one value-shaped mutable thing in the language, with an aliasing story (escape, capture, double-commit) that v1 has no machinery to police. The public need transients serve elsewhere is bulk-construction speed, which the runtime achieves internally with zero surface (the Immutable.js precedent: its own `withMutations` is how its constructors are fast; users of *Hexagon's* constructors get that for free). Revisit in v2 only on benchmark evidence from real Hexagon code that **userland** batching — not stdlib-internal construction — is a measured bottleneck; the honest v2 shapes would be syntactic and scoped, not a mutable handle.

This resolves Part 4 §13.4. Rejected alternative recorded at §13.4 below.

---

## 12. Diagnostics checklist

New rows first; inherited rows by reference (unchanged, listed for the consolidated picture).

| Situation | Error / hint | § |
|---|---|---|
| `for x in xs`, `xs` an unsolved inference variable | none at the head: its head waits for its owner's close, and a head nothing established is `Seq` | §3.1, §3.5 |
| `for x in xs`, `xs : c` a rigid declared variable — and a `Seq` seat whose source is one | "`xs` has the generic type `c`, and `Iterable` declares an implied type and cannot constrain a type variable in v1; take a `Seq(a)` parameter instead" | §3.2, §3.5 |
| A `Seq` seat's source whose head has no `Iterable` instance | the seat's ordinary mismatch, naming both types: "type mismatch: expected `Seq(String)`, found `Int`" | §3.4 |
| A `Seq` seat's source whose `Item` disagrees with the expected element | the seat's ordinary mismatch, adding the sequence the source supplies: "type mismatch: expected `Seq(String)`, found `Vector(Int)`, which supplies `Seq(Int)`" | §3.4, §3.6 |
| A form's paths under an open `Seq` element whose elements disagree | Functions §4.3's join report, where the join reports it (the `if`; a later arm; a later element), naming the element types | §3.4 |
| An existing structure at a `Seq`-bearing type (`Option(Vector(String))` at `Option(Seq(String))`) | the seat's ordinary mismatch; nothing inside an existing value adapts | §3.6 |
| A value of an `Iterable` instance's own subject at a `Seq` seat inside its own `toSeq` | the seat's ordinary mismatch + "inside `Iterable<Stack(a)>`'s own `toSeq`, a `Stack(a)` is not converted to a sequence, since that would call the member being defined; convert its contents, or write `Iterable.toSeq(…)` where recursion on a smaller value is meant" | §3.6 |
| A dot call or a `match` on a source whose head waits (`v.map(match …)`, `match v`) | Pattern Matching §6.1's refusal with its rider, unchanged; the repairs (§3.5): annotate the source (`v: Seq(Int)`), or spell the call qualified (`Seq.map(v, match …)`) | §3.5 |
| A waiting source's late head with no instance, or an `Item` disagreeing with the linked element | the demand site's own report (a seat's row above, §3.2's at a loop head, the explicit call's ordinary report at an explicit call), where the subject's demand was made, whether the head arrived before or after it | §3.5 |
| Non-iterable concrete type, not user-nominal | "`Int` is not iterable" (+ conversion hint where one exists) | §3.2 |
| Non-iterable user nominal type | two-legal-homes form: the type's home module with the `honor` fixit, the prelude as the only other legal home, and the `toSeq`/`Seq(a)` alternatives | **§3.3 (new)** |
| `Seq.toSeq`, the one standard iterable type whose module has no `toSeq` (§4) | curated hint: "`Seq` has no `toSeq` — its `Iterable` instance is declared in module `Iterable`; use `Iterable.toSeq`, or call `toSeq` by the dot" — at the standard library's `Seq` only, never a project's own `module Seq` | **§4 (new)** |
| Orphan `honor` at a filled slot (every standard row's included) | the orphan-rule error + "`Iterable<Vector(a)>` is already declared in module `Vector`"; no duplicate report beside it | **§7.3 (new clause)** |
| Projection-bearing constraint on a binder | Part 2 §9 row, unchanged | Part 2 §7.2 |
| `Item` in a type expression | Part 2 §9 row, unchanged | Part 2 §7.3 |
| Missing / extra / duplicate `type Item` binding in `honor` | Part 2 §9 rows, unchanged | Part 2 §5.3 |
| Refutable loop-head pattern | the uniform irrefutability-gate error | Pattern Matching §5; Part 4 §9 |
| Assignment to a loop binder | "`x` is a loop variable and cannot be assigned; declare a `var`" | Loops §2.1 |
| Non-`Unit` final expression in a loop body | discard error, loop provenance | Loops §2.2 |
| User-vs-user duplicate instance | Modules §7.3 phrasing, modulo the honor-era noun: **"duplicate instance of `Iterable<Bag>`"** | §7.3 |

`String.fromSeq` produces no new diagnostics (total; divergence on infinite input is documented, not diagnosed).

---

## 13. Rejected alternatives (do not re-litigate)

### 13.1 `String.codepoints` as a synonym for `String.toSeq`

Loops §11.6's interim name. Rejected: the conversion suite exists so conversion names never need looking up; a domain synonym for the *most mechanical* member of the suite would undercut the suite's one virtue at its first extension. (Contrast Part 4 §3.4's `entries`/`toSeq` synonym pair, which earns its keep because `entries` is entrenched domain vocabulary with `keys`/`values` siblings; "codepoints" has no such family.) The word "codepoint" lives in the docs, not the API.

### 13.2 `String.toSeq` without `String.fromSeq`

Keeps the suite honest on collections proper and documents `String` as a partial participant. Rejected: within its domain — finite collections (§1) — the suite invariant is only mechanical if it has no asterisks, and the missing direction has an obvious, total, law-abiding meaning (concatenation). The cost of shipping it is one line; the cost of the asterisk is permanent.

### 13.3 Strict codepoints-only `String.fromSeq`

Requiring every element to be one codepoint and throwing otherwise — the exact inverse of `toSeq`. Rejected: it adds a runtime scan and a brand-new failure mode with no customer; it is out of character with the forgiving `from*` family (every other `fromSeq` accepts any `Seq` of the right element type); and the round-trip law holds under concatenation anyway.

### 13.4 Public transients (`withMutations`, transient handles)

Rejected per §11: an observable mutable collection value contradicts the `var`-confinement mutation story and imports an aliasing discipline v1 cannot police. Internal batching captures the performance without the surface. Revisit-bar: v2, on benchmarks of userland (not stdlib-internal) bulk mutation from real Hexagon code.

### 13.5 Declaring the normative `Iterable<Array(a)>` row in this document

The draft of this spec did exactly that, with native `for..of` emission mandated and observation semantics left open. Rejected on review (correction record §18.1): the two positions cannot coexist — native JS array iteration has JavaScript's mutation-observation behaviour and cannot implement snapshot semantics if the FFI spec were to choose them; a normative row whose meaning is undefined is not a decision. The direction (Array is iterable) was kept as a binding obligation on FFI (§6.1); the meaning lives where it can be defined coherently, and now is defined there (FFI Part 2 §§6.5, 8) — since #876 as iteration over a captured snapshot, which is what native emission implements without qualification.

### 13.6 Teaching the effect-import pattern in the recipe

Rejected per §7.2: for a home-module instance the pattern is structurally unnecessary (no value of the type can exist without its module in the graph), and the Modules §13(i) annotation existed precisely to keep it from reading as daily idiom *(the form itself has since been deleted — Modules §3.3, #762)*. The recipe teaches that the graph does the work; the diagnostic (§3.3) covers the failure path.

---

## 14. Hanging questions (owned elsewhere; recorded, non-blocking)

1. *(discharged)* **The `Array(a)` package** — decided in full by **FFI Part 2** (§§6, 8–9): the capture contract (#876; formerly a borrow contract), `Iterable<Array(a)>`, observation of the captured value, native-iteration emission, the four conversion names, suite membership, `.d.ts` face, shallow element treatment. See §6.
2. *(discharged by String Text Processing)* **`String.join(parts, separator)`
   and the text-processing companion surface** — sequence-first `join`
   supplements §5.3's `fromSeq`; the dedicated String specification owns the
   remaining operations.
3. *(discharged)* **Public `Range.toSeq`** — `Range.toSeq(r)` is the companion's honored member (Modules §5.3), since `stdlib/Range.hex` honors `Iterable<Range>` in source.
4. **The v2 implied-types remainder** — deferred `Item(α)` goals, `Item(c)` reference syntax, obligations on type members, `Iterable` binders, `derive via`, `Hash` on user collection types → unchanged, per Part 2 §11 / Part 1 §6.3; nothing here moves it.
5. **`AsyncSeq` and asynchronous iteration** → the async spec (Loops §11.4, unchanged; it does not depend on anything here).

---

## 15. Decisions log

| # | Decision | § |
|---|---|---|
| 1 | Iterable(τ)=ε defined as global-instance lookup on τ's outer constructor; the Loops table is the instance table, operationally | §2.2 |
| 2 | `toSeq` is the member, reached by the dot and qualified (not seeded bare — Modules §5.5); Loops §2.3's desugaring names it; qualified home `Iterable.toSeq`, an export of the declaring module; companions supply theirs as instance members, never as plain exports, and `Seq.iterate` (the producer) is unrelated | §2.3 |
| 3 | Normative 8-step algorithm for `for p in e`; pattern heads per Pattern Matching's five positions, irrefutability-gated; body `Unit`; source evaluated once | §3.1 |
| 4 | **Inference-vs-declared split**: a declared type variable → `Seq(a)` parameter hint; an unsolved inference variable is not refused at the head: it waits for its owner's close (row 18) | §3.2 |
| 5 | User-nominal not-iterable error names **both legal homes** (the Modules §7.6 discoverability obligation's loop-side face), leading with the actionable one | §3.3 |
| 6 | The v1 core table is exactly six rows, each a source `honor` block: `String` in its primitive companion; `Range`, `Vector`, `Map`, and `Set` in the companions declaring them; `Seq` in `Iterable.hex`, its own companion seating before the constraint (so no `Seq.toSeq`); the FFI-owned captured foreign collections add `Array(a)` (obligated §6.1, discharged FFI Part 2 §8; #876), `JsMap(k, v)`, and `JsSet(a)` (FFI Part 10 §6; #875), each in its declaring companion; nothing else iterable in v1 | §4–§6 |
| 7 | **`Iterable<String>`: `Item = String`, one codepoint per item** — Loops §11.6 closed; graphemes stay named-function territory | §5.1 |
| 8 | `String.toSeq` lazy codepoint view; **no `codepoints` synonym** | §5.2, §13.1 |
| 9 | **`String.fromSeq` ships: concatenation**, full contract — `""` on empty, traversal order, any-length elements, no normalization, eager, linear with join-not-fold implementation note, one-sided round-trip law | §5.3 |
| 10 | **Conversion-suite domain fixed: finite collection types.** `String` joins; `Range` exempt (not a collection); `Seq` is the currency itself; `Array` membership → FFI; third parties via the recipe | §1, §5.3 |
| 11 | **`Iterable<Array(a)>` decided as a binding v1 FFI obligation** (`Item = a`, member `toSeq` behaving as `Array.toSeq`); row meaning, conversions, observation semantics, and emission owned by FFI — discharged in full by FFI Part 2 | §6, §13.5 |
| 12 | An orphan `honor` on a filled slot is one report: the orphan error naming the occupant's module; the duplicate report is folded into it there (#1131); a module reaching both still reports the duplicate | §7.3 |
| 13 | Recipe normative (the instance's `toSeq` member as the conversion + `fromSeq` exported + honest constraint placement); effect-import pattern deliberately untaught; user collections inherit and must state their order contract | §8 |
| 14 | **Emission: static instance resolution is total** (consequence of the binder ban); Loops §8 erasure mandatory and untouched; source-owned `String` must retain native `for..of` with no adapter/dictionary/call overhead, while explicit `toSeq` retains the same lazy adapter and complexity; no `Iterable`/`Item`/instance machinery in `.d.ts` — other constraints' foreign representation deferred to FFI | §9 |
| 15 | Collections/stdlib boundary fixed: structure in Parts 1–5, combinator families (and their v1 ship-list) in the stdlib listing under the Part 1 §3 doctrine | §10 |
| 16 | **Transients runtime-internal only; no public API in v1**; v2 revisit-bar = userland benchmarks | §11 |
| 17 | **`Seq` seats adapt**: a value of another known head meeting a seat headed by `Seq` converts through its instance's `toSeq`, a specified conversion (Functions §4) decided at the seat's final check; every channel an expected type already takes adapts, an existing value never; `var` and `:=` are not sequence seats | §3.4 |
| 18 | **A source whose head is not yet known** makes its `Iterable` demand at its own turn, linking its element at once; its head is decided when it is known — by its owner region's close at the latest — and one nothing describes takes the `Seq` reading — seats and loop heads alike (#1118), while an explicit `Iterable.toSeq` alone keeps its refusal; at the close, each source still unknown takes its `Seq` reading | §3.1, §3.5 |
| 19 | **A form's paths under an open `Seq` element** join their element types (reported where #1107's join reports), then each adapts on its own; a path of unknown head contributes only its element | §3.4 |
| 20 | **Nothing converts inside an `Iterable` instance's own `toSeq`** a value headed by its own subject; a helper one call removed adapts, its recursion visible | §3.6 |
| 21 | **An adaptation is its explicit call**: evaluation, laziness, cost, effects, emission, and generalization are the explicit spelling's | §3.6, §9.1 |

---

## 16. Edit notes to companion specs, and closeout

### 16.1 Edit notes (live)

The roadmap and agenda edits queued at landing were applied then; the companion-spec edits to Loops/Ranges/Iteration and Collections Parts 1, 2, and 4 have since been applied in their owners (verified at consolidation) and their rows removed. Two remain live, on the house apply-on-next-touch convention:

| Doc | Edit | When |
|---|---|---|
| **primitive-types.md** | §5.1: note String iteration decided — `for c in s`, one-codepoint items, O(n) single pass (pointer §5 here). | on next touch |
| **hexagon-for-typescript-coders.md** | `for..in` chapter — Hexagon's `for..in` is JS's `for..of` done right (Loops §1 doctrine); tuple heads over `Map`; String loops are codepoint-correct (unlike naive JS index loops); "write your own collection" sidebar = §8's recipe; the generic-`Iterable` rejection with the `Seq(a)` idiom. | on next touch |

### 16.2 Closeout confirmations

- **Part 1 §6.4's amendments are reflected**: Decisions Batch 2026-07 §6 stands as amended (the restricted form is v1; the full feature v2); Loops §11.1 was re-scoped by Part 2 §14; the main roadmap's Tier-3 implied-types entry carries the re-scope and the `derive via` pointer.
- **The Part 2 §14 `Elem` → `Item` rename ripple**: this document and Part 1 use `Item` throughout; the residual historical `Elem` spellings in Decisions Batch 2026-07 ride the consolidation supersede pass, not an edit note here.
- With Part 5 filed, the Collections effort's outstanding export is the stdlib listing's inherited items (§10, ledgered in `stdlib-roadmap.md`); the FFI inheritance (§14.1, Part 4 §10.4) has been discharged by FFI Parts 2 and 10.

---

## 17. Acceptance tests (golden: inferred type, runtime value, emitted JS, diagnostics)

```
-- (a) Every standard row loops, with the right element type
for i in 1..3            -- i : Int      (counting-loop emission, mandatory)
    ...
for x in [10, 20]        -- x : Int      (Vector)
    ...
for c in "héllo"         -- c : String   (one codepoint; emits for (const c of s))
    ...
for x in Set.fromVector([1, 2])   -- x : Int
    ...

-- (b) Map: tuple head; vector-pattern head still gated
for (k, v) in m          -- irrefutable tuple head; emits for (const [k, v] of ...)
    ...
for [k, v] in m          -- ERROR: this pattern can fail; use match (Part 4 §9)
    ...

-- (c) String conversion suite (contract per §5.3)
String.toSeq("ab")                          -- Seq(String): "a", "b"
String.fromSeq(String.toSeq(s)) == s        -- true, for every s (one-sided round trip)
String.fromSeq(Vector.toSeq(["ab", "", "c"]))  -- "abc" (any-length elements; concat)
String.fromSeq(Seq.empty)                   -- ""
-- No golden test asserts chunk-boundary preservation through toSeq ∘ fromSeq.

-- (d) The Bag example end-to-end (per §8.2)
let bag = Bag.fromSeq(Vector.toSeq([1, 2, 2, 3]))   -- fromSeq needs Hash<Int>: provided
var total = 0
for x in bag                                -- iteration needs no Hash
    total := total + x                        -- total = 8
-- emits: for (const x of __Iterable_Bag.toSeq(bag)) { total = total + x; }

-- (e) Rigid vs unsolved: a refusal, and a head that waits
fun f(xs: c) =
    for x in xs                               -- ERROR: `xs` has the generic type `c`, and
        ...                                     --   Iterable declares an implied type and cannot
                                            --   constrain a type variable in v1; take a Seq(a)
                                            --   parameter instead
fun g(xs) =
    for x in xs                               -- the head waits for g's close (§3.1 step 2)
        ()
    Vector.length(xs)                         -- g : (Vector(a)) -> Int — and the same with
                                            --   the two statements swapped (#1118)
fun h(xs) =
    for x in xs                               -- nothing describes xs: h : (Seq(a)) -> Unit
        ()

-- (f) Non-iterable: plain vs user-nominal (two legal homes)
for x in 42                                 -- ERROR: `Int` is not iterable
    ...
for x in widget                             -- widget : Widget, user record, no instance
    ...                                       -- ERROR: `Widget` is not iterable. Define
                                            --   honor Iterable<Widget> in module Widget,
                                            --   which declares Widget. The only other
                                            --   legal home is the prelude module
                                            --   declaring Iterable. Alternatively,
                                            --   convert or take a Seq(a) parameter.

-- (g) Collision with a standard row: one orphan error, naming the row's home
honor Iterable<Vector(a)> =                 -- in user code
    type Item = a
    toSeq(xs) = Vector.toSeq(xs)
-- ERROR: orphan instance — this module declares neither `Iterable` nor `Vector`;
--        Iterable<Vector(a)> is already declared in module Vector

-- (h) User-vs-user duplicate (same module)
honor Iterable<Bag(a)> = ...                -- second declaration in module Bag
-- ERROR at the second declaration: duplicate instance of Iterable<Bag>

-- (i) Once-evaluation of the source
for x in expensive()                        -- expensive() called exactly once
    ...
-- emits: for (const x of expensive()) { ... }  -- the head is evaluated once; no temporary

-- (j) Infinite Seq: lazy pull, no divergence before the loop
-- nats: an infinite Seq of 1, 2, 3, ... (producer illustrative — any infinite
-- Seq specimen serves; the combinator surface is the stdlib listing's)
for n in nats
    if n > 3 then throw(Done()) else consume(n)   -- consume : Int -> Unit
-- pulls 1, 2, 3, 4; consumes 1, 2, 3; throws on 4; each element computed on
-- demand; nothing materialized

-- (k) var mutation in loop bodies keeps working (blocks, not lambdas)
var acc = ""
for c in "abc"
    acc := acc ++ c                           -- acc = "abc"

-- (l) No Iterable machinery in .d.ts
-- module Bag's emitted Bag.d.ts contains no Iterable, no Item, no Iterable-instance
-- object — nothing iteration-shaped. (The .d.ts representation of the Hash
-- constraint on fromSeq/add/count is the FFI spec's business and is asserted
-- neither way here.)

-- (m) Seq seats adapt (§3.4); words : Vector(String), bag : Bag(Int)
String.fromSeq(words)                       -- String.fromSeq(Iterable.toSeq(words))
let view: Seq(String) = words               -- adapted; `let same = words` stays Vector(String)
let colors(): Seq(String) = ["red", "green"] -- adapted at the declared result
let o: Option(Seq(String)) = Some(words)    -- constructor argument
let p: (Seq(String), Int) = (words, 1)      -- literal part
Seq.length(if c then words else moreWords)  -- moreWords : Set(String): elements join, each adapts
Seq.length(bag)                             -- a user instance, statically resolved
let s: Seq(String) = someSeq                -- a Seq passes unchanged
-- emits the explicit call's JS at each site: the instance's toSeq, statically resolved

-- (n) What never adapts
let bad: Seq(Float) = ints                  -- ints : Vector(Int) — ERROR: expected Seq(Float),
                                            --   found Vector(Int), which supplies Seq(Int)
let held: Option(Seq(String)) = maybeWords  -- maybeWords : Option(Vector(String)) — ERROR
var s2: Seq(String) = words                 -- ERROR: a var's annotation is not a Seq seat
Seq.length(if c then ints else words)       -- ERROR at the `if`: Int and String disagree
pick(someSeq, words)                        -- pick<a>(x: a, y: a) — ERROR: no Seq seat
words.map(f)                                -- Vector.map; never Seq.map by adaptation

-- (o) A source whose head is not yet known (§3.5)
let f1(xs) = String.fromSeq(xs)             -- f1 : (Seq(String)) -> String
let f2(xs) =
    let s = String.fromSeq(xs)              -- decided when the head arrives, in either statement order
    Vector.length(xs)                       -- f2 : (Vector(String)) -> Int, xs adapted
fun f3(v) =
    let total = sumInts(v)                  -- the element is linked here: Int
    Seq.map(v, match                        -- accepted: the callback reads Int
        n when n < 0 => "negative"
        _ => "other")
let t(x) = Iterable.toSeq(x)                -- ERROR: an explicit call alone keeps its refusal
fun go(v) =
    let total = sumInts(v)
    v.map(match                             -- ERROR: the dot waits on v's head, so the arms
        n when n < 0 => "negative"          --   see a variable (Pattern Matching §6.1); annotate
        _ => "other")                       --   `v: Seq(Int)`, or write Seq.map(v, match …)
fun z(xs, ys) =
    let s = String.fromSeq(xs)              -- xs waits
    xs.zip(ys)                              -- a goal on a waiting receiver
-- at z's close xs takes Seq(String), the goal resolves to Seq.zip and meets ys at a
-- Seq parameter, ys waits in turn and takes Seq(b):
-- z : (Seq(String), Seq(b)) -> Seq((String, b))
fun late(v) =
    let total = sumInts(v)                  -- ERROR here, at sumInts(v): expected Seq(Int), found
    let k: Vector(String) = v               --   Vector(String), which supplies Seq(String) —
    total                                   --   the same place with the two lines swapped

-- (p) An instance's own subject, in its own toSeq (§3.6)
record Stack(a) = {items: Vector(a)}
honor Iterable<Stack(a)> =
    type Item = a
    toSeq(s) = s                            -- ERROR: a Stack(a) is not converted inside
                                            --   Iterable<Stack(a)>'s own toSeq; convert its
                                            --   contents (s.items) or write the call
-- toSeq(s) = s.items adapts the Vector; a helper `let flat(s: Stack(a)): Seq(a) = s`
-- called as toSeq(s) = flat(s) adapts through the instance being defined (recursion
-- the program wrote, visible at flat)
```

---

## 18. Correction records (incorporated)

Two pre-landing review corrections were applied in place; this anchor records that they are incorporated. The same review's smaller tightenings — the conversion-suite domain (§1, §5.3, §13.2), the completed two-legal-homes diagnostic (§3.3), the full `String.fromSeq` contract (§5.3), acceptance-test repairs (§17) — are simply part of the normative text above.

### 18.1 `Array(a)` iteration: normative ownership transferred to FFI

The draft declared the `Iterable<Array(a)>` row normatively here while leaving its observation semantics to FFI; the positions cannot coexist (native iteration fixes observation behaviour). Corrected: the row became a binding FFI obligation (§6), since discharged by FFI Part 2. Rejected alternative, do not relitigate: §13.5.

### 18.2 The `.d.ts` claim narrowed to `Iterable` machinery

§9.3 originally claimed no constraint machinery of any kind appears in `.d.ts`; the foreign representation of *other* constraints on exported polymorphic functions is the FFI spec's (bounded exported-dictionaries direction, `spec/notes/ffi-exported-dictionaries.md`). Corrected in §9.3 and test (l). Do not restate the unconditional non-leakage slogan in any collections document — its scope is monomorphic exports plus this constraint's by-construction guarantee.

### 18.3 `Bool` reclassified in §4's non-iterables note (2026-07-29, #147)

§4's closing note listed `Bool` in its concrete-primitive clause; under the ML-dialect ruling (`decisions-ml-dialect-bool-2026-07.md`) `Bool` is the prelude union `False | True` (Unions §8) and now stands with `Option`/`Result` in the prelude-union clause instead. No behavioral change: `Bool` was not iterable and is not iterable; a `for x in myBool` head remains the §3.2 concrete-non-iterable error either way.

### 18.4 `Iterable<String>` moved from a provided row to source (2026-09)

The row's existence, implied type, codepoint semantics, public spellings,
laziness, and complexity are unchanged. Its authority moves from the compiler's
provided table into an ordinary `honor Iterable<String>` declaration in the
primitive's fixed home, `stdlib/String.hex`. The compiler retains only the
private traversal intrinsic and the canonical-declaration-based lowerings
required by §9.2; neither is a hidden fallback instance. The migration removes
the provided row in the same implementation change, so coherence continues to
have exactly one provider. Every other standard row moved to source by the same
rule (§4).
