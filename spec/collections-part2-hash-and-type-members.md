# Hexagon Spec: Collections Part 2 — The `Hash` Constraint & Constraint Type Members

**Status:** Decided (July 2026). Two halves, one document: the formal spec of the `Hash` constraint (§2–§4), and the grammar and rules for implied `type` members in `constraint`/`honor` bodies (§5–§8), including the `Iterable` prelude declaration (§8). Written against Collections Part 1 and the Constraints spec (`honor` keyword); neither is re-litigated here.
**Scope:** The `Hash` declaration, member, codomain, law, and determinism contract; the provided (compiler/runtime) instance set for `Hash`; the derivable-only rule and its enforcement, including the Eq-agreement rule; the wrapper-key pattern; the `type`-member grammar on both declaration and instance sides; identity and scoping of implied type names; the **projection-bearing constraint** definition and the v1 binder ban; the `Iterable` prelude declaration.
**Not in scope:** `Hash` instances for `Vector`/`Map`/`Set` (Part 3 §8, Part 4 §8.4, under §4.4's wording here); table-opening semantics, resolution, diagnostics, and the provided-instance table for `Iterable` (Part 5 — the *declaration* lives here, everything operational there); the v2 implied-types remainder (§11); the `CiString` wrapper's name and folding semantics (`stdlib-roadmap.md`).
**Companions:** Collections Part 1 (§4 key model, §6 restricted `Iterable` — both made formal here); Constraints (§2 member grammar, §4 instance mechanics, §4.5 derivation, §7 prelude registration, §8 diagnostics); Collections Parts 3–5; Loops/Ranges/Iteration (§5 iterable table = §8's instance table; §7 the `Seq(a)` idiom); Declarations Preamble (module-level `type`); Modules (§6.4 qualified homes; §7 instance globality); Products/Unions (structural-instance pattern extended to `Hash`); `stdlib-roadmap.md` (routed items, §12).

**Vocabulary, fixed for docs and diagnostics:** the member declared with the `type` keyword inside a `constraint` is an **implied type member** (short form in prose: *implied type*). An implied type is a type uniquely determined by a constraint instance's subject type: `Iterable<Vector(Int)>` implies `Item = Int`. The `honor` declaration establishes that implication explicitly; this is not merely a type inferred from an expression. Diagnostics say **"implied type"**. A **projection-bearing constraint** is a constraint that declares at least one implied type member (§7.1). The technical word "projection" names the operation and stays out of diagnostics.

---

## 1. Doctrine

- **`Hash` is the honest signature for hash-backed collections** (Part 1 §4): `Map.set<k: Hash>` states the real requirement instead of hiding structural hashing in the runtime.
- **The hash/equality law holds by construction, not by trust.** Every `Hash<T>` a *user* can derive requires a compiler-derived `Eq<T>` (§4.3), so the pair is structurally consistent by construction; every compiler/runtime-provided `Hash` is specified normatively together with its `Eq` (§2.5, §4.4), and the spec text carrying the instance carries the law. v1 has no way to obtain a lawless `Hash`.
- **Hash values are observable but not portable.** `hash` is an ordinary callable member (§2.2), deterministic and unseeded — but the stdlib's hash-backed collections place entries by *seeded* internal mixing, and iteration order is promised only within one program execution (§2.4).
- **One keyword, three positions.** The `type` keyword serves the module-level alias (Declarations Preamble §4), the `constraint` body, and the `honor` block; position fully disambiguates — the Rust precedent.
- **The v1 boundary is drawn at projection, not at `Iterable`.** What v1 lacks is the inference machinery for *projecting* an implied type out of an unsolved variable (`Item(α)` deferred goals). The restriction therefore bans exactly that — projection-bearing constraints on type-variable binders (§7) — uniformly, with no special-cased names.

---

## 2. The `Hash` constraint

### 2.1 Declaration

```
constraint Hash<a: Eq> =
    hash(x: a): Int
```

- `Eq` is the superconstraint: `Hash` implies `Eq`, per the standard left-to-right reading (Constraints §1/§2.1). Every type honoring `Hash` has an `Eq` instance, and a function constrained `<a: Hash>` may use `equals` on `a`.
- `Hash` lives in the prelude; its qualified home exists per Modules §6.4. Its name occupies the constraint namespace like any other (Constraints §2.2).
- This is a real declaration with a real member, not a marker (rejected alternative §10.1).

### 2.2 The member

`hash` is an ordinary constraint member: a module-scope term name (Constraints §2.2), callable wherever the constraint is discharged — `hash(42)`, `hash("key")`, and polymorphically inside `<a: Hash>` functions. Legitimate uses beyond the collections internals: memoization keys, sharding, debugging.

**Codomain: `Int`.** The normative promise about the *value* is §2.3's law and §2.4's determinism — nothing else. *Informative, non-normative:* all provided and derived hashes in the v1 runtime land in signed 32-bit range (the Immutable.js smi lineage; the runtime folds with `| 0`-family operations). Code must not rely on the range; it may become normative later only under demonstrated interop pressure (§12.2).

Dictionary shape, per Constraints §6.2: `Hash_T = { eq: Eq_T, hash: (x) => ... }`. The member name `hash` does not collide with the lowercased superconstraint slot `eq`; the §6.2 collision check is satisfied trivially.

### 2.3 The law

> For all `x`, `y` of a type honoring `Hash`: **`equals(x, y)` implies `hash(x) == hash(y)`.**

Stated normatively even though §4.3 makes it hold by construction in v1 — this is the sentence any future instance-producing mechanism (v2 `derive via`, §11) must discharge. The converse is explicitly **not** a law: unequal values may collide, and collision handling is entirely the collections' business.

Consequence of the superconstraint: **`Hash<Float>` normalises consistently with `Eq<Float>`'s SameValueZero** (Constraints §7) — `-0` hashes as `+0`, and all `NaN` bit patterns hash to a single value.

### 2.4 Determinism — public function vs table placement

Two layers, deliberately split:

**The `hash` member is deterministic and unseeded**: for a fixed compiler + `@hexagon/runtime` version, the same value hashes to the same `Int`, within and across program runs. This keeps A1 coherent (an observable member cannot keep a seed secret, so it must not have one), keeps the Immutable.js oracle valid for the *function*, and keeps `hash` useful for memo keys and sharding. Non-promises: not stable across compiler/runtime versions; **not a serialization format**.

**Table placement is seeded.** Hash-backed stdlib collections (Part 4's `Map`/`Set`) do not place entries by `hash(k)` directly; they place by an internal mix of a **per-process random seed** with the public hash — `bucketHash = mix(processSeed, hash(k))`-shaped. The seed is not exposed as language surface: it is not readable, and it appears in no payload. The §2.3 law is untouched — equal values have equal public hashes, hence equal mixed hashes under the one process seed, hence land together.

Consequences, normative:

- **Iteration order of hash-backed collections is deterministic for a given collection value within one program execution, and explicitly unstable across executions, compiler versions, and runtime versions** (Part 1 §4.1's promise, instantiated by Part 4 §7.1). The cross-run instability is intentional, the Go rationale: it keeps snapshot tests and accidental order-dependence honest before an ecosystem can form around an order nobody promised (Hyrum's law). Order is likewise **not a function of the collection's contents** in any way user code may rely on.
- **HashDoS resistance for stdlib tables**: an attacker who knows only the public hash values cannot target **distinct** public hashes into the same internal buckets without the process seed. Values with genuinely equal public hashes still collide — §2.3 permits that, and Part 4 §2.2 owns the resulting worst-case complexity. (Rust's seeded `HashMap` is the precedent; Go and Python seed for the same reason.) For a web-targeted language fed hostile strings, unseeded placement would expose the internal bucket function directly and make targeted collisions easier to manufacture.
- **Honest residue, documented**: the public `hash` function itself remains non-DoS-resistant. A user who builds their own table keyed directly on `hash(x)` inherits that exposure; the stdlib's tables do not. One sentence in the `hash` docs.

**Do not re-litigate:** unseeded table placement with a cross-run iteration-order guarantee. Immutable.js is the influence and the oracle for the public hash *function*; it is not a backend, and its internal placement behaviour dictates nothing here. A cross-run order promise would both re-accept the DoS exposure and freeze an observable the spec calls unspecified (snapshot tests and debug output calcify an order; changing the runtime hash later becomes ecosystem breakage). Any future revisit requires field evidence that cross-run order stability is worth both costs.

### 2.5 Provided instances (primitives and structural types)

The following instances are **compiler/runtime-provided** (§4.4 wording; no source form):

| Type | Notes |
|---|---|
| `Hash<Int>` | value-based; the f64-integer-invariant makes this trivial |
| `Hash<Float>` | §2.3: `-0` ≡ `+0`, all NaNs one value — SameValueZero-consistent |
| `Hash<Bool>` | two values |
| `Hash<String>` | agrees with `Eq<String>` (JS `===` string equality); algorithm unspecified (runtime-owned) |
| `Hash<BigInt>` | folds the arbitrary-precision value into `Int`; collisions inevitable and lawful |
| `Hash<Unit>` | constant |

**Structural types** follow the `Eq` pattern exactly (Products §2.5/§3.4 family): tuples and structural records receive **automatic compiler-derived `Hash`**, conditional on every component/field type having `Hash`. Users cannot honor structural types (Constraints §9.3 presumption, unchanged); their `Hash`, like their `Eq`, is exclusively compiler-derived — and therefore mutually consistent by construction.

**No other core instance is fixed by this section:** no `Hash<Exn>` (Exceptions §10's no-instances presumption, enforced by §4.2 here); function types have no `Eq`, so `Hash` cannot arise; `Seq` has no `Eq` and therefore no `Hash`. `Range` and prelude-union instances remain stdlib-listing decisions (§12.3). Collection instances live in their owning specs: `Hash<Vector(a)>` in Part 3 §8, and `Hash<Map(k, v)>`/`Hash<Set(a)>` in Part 4 §8.4.

---

## 3. Derived `Hash`: mechanics

### 3.1 `Hash` is on the derivation whitelist

The derivable constraints in v1 are **`Eq`, `Ord`, `Show`, `Hash`** (Constraints §4.5). All derivation machinery applies unchanged:

```
record Point = {x: Float, y: Float} derives (Eq, Hash)
-- elaborates to:
--   honor Eq<Point> = derive
--   honor Hash<Point> = derive
```

- `honor Hash<T> = derive` occupies the ordinary (constraint, constructor) coherence slot, obeys the orphan rule, and participates in superconstraint existence checks: deriving `Hash` with no `Eq<T>` in scope is the existing missing-superconstraint error, plus the hint **"add `Eq` to the `derives` list"** (parallel to `Ord`).
- On a parameterized nominal type, `derive` produces the expected parameterized instance; component types' `Hash` obligations become instance-context obligations per Constraints §4.3 (`honor<a: Hash> Hash<Box(a)> = derive`-shaped).
- An underivable slot is the standard error, phrased against the derivation: "cannot derive `Hash<Handler>`: field `f` has type `Int -> Int`, which has no `Hash` instance."
- The whitelist diagnostic names all four derivable forms: "`Num` cannot be derived; only `Eq`, `Ord`, `Show`, and `Hash` have derivable forms." The same form applies to `Signed`.

### 3.2 Derivation semantics (contract, not algorithm)

Derived `Hash` for a nominal `record` is a hash over its fields' hashes; for a `union`, over the constructor tag and the payload's hashes — in both cases **defined only up to the §2.3 law and §2.4 determinism**. The combining algorithm is runtime-owned and unspecified, exactly as the structural instances' (§2.5). This is deliberately weaker than the `Eq`/`Ord`/`Show` derivations, whose observable behaviour is fully pinned (Products/Unions): a hash's only observable obligations *are* the law and determinism, and pinning an algorithm would freeze an implementation detail for no user benefit.

---

## 4. Derivable-only: the user/stdlib asymmetry

### 4.1 The rule for user code

**`honor Hash<T> = derive` is the only legal form of a `Hash` instance in user source.** A member-block instance —

```
honor Hash<UserId> =
    hash(u) = u.n * 31        -- ERROR
```

— is a **hard error with its own message** (§9), distinct from the generic non-derivable-constraint error: the user found the right constraint and the wrong door, and the message must say which door is open. Everything else about `honor ... = derive` (placement, orphan rule, coherence) is §3.1.

### 4.2 Exceptions

`derives Hash` on an `exception` declaration is the existing error ("exceptions have no derived instances"); since §4.1 closes the member-block form too, `Hash<Exn>` is unwritable in total, as Exceptions §10 presumes.

### 4.3 The Eq-agreement rule

> **`honor Hash<T> = derive` is a hard error unless the `Eq<T>` instance is itself derived** (a `derive` instance for nominal types; the automatic structural instance for structural component types).

Error: *"cannot derive `Hash<Weird>`: `Weird` has a hand-written `Eq` instance; a derived hash is only consistent with a derived equality."*

This is the load-bearing clause. A derived (structural) hash consulted by a hash-tried `Map` against a hand-written (non-structural) `equals` silently corrupts the map — two keys the user's `equals` calls equal land in different buckets, and lookups nondeterministically miss. That is exactly the coherence hazard Part 1 §4.2 closed by making `Hash` derivable-only; this rule closes the last crack in it. The check is cheap: the compiler knows each instance's provenance (derived vs member-block).

**Consequence, accepted with eyes open:** a type with a hand-written `Eq` — case-insensitive keys, normalized-form equality — **cannot be a `Map` key or `Set` element in v1** via its own instances. The sanctioned answers are §4.5 (wrapper key types, available in v1) and §11 (`derive via`, pre-registered v2). Keying on a canonical `String`/`Vector` projection by hand remains the manual fallback.

The rule composes cleanly with the rest of the system: `derives (Eq, Hash)` in one header trivially satisfies it; `derives (Eq, Ord, Hash)` likewise; structural components are always structurally-`Eq`'d, so the parameterized-instance case needs no extra check beyond the obligations §3.1 already imposes.

### 4.4 The stdlib asymmetry, made precise

"Derivable-only" constrains **users**, not the specification. The prelude's `Hash` instances (§2.5 here; collection instances in Parts 3–4) are **compiler/runtime-provided, specified normatively by the spec text, with no source form** — precisely the status the automatic structural instances have always had. There is no privileged-module mechanism, no pragma, no blessed syntax: "the stdlib may bless an instance" *means* "the spec declares that the instance exists and the compiler/runtime provide it." A future stdlib author cannot smuggle a `Hash` instance into a `.hex` source file any more than a user can; the collection parts' instances enter the language the same way §2.5's do — by specification.

Every such provided instance is bound by §2.3's law; the spec text carrying the instance carries the obligation.

### 4.5 The wrapper-key pattern

The sanctioned v1 answer to "I need non-structural key equality" is a **wrapper key type with a compiler-provided, mutually consistent `Eq`/`Hash` pair**. First customer, owed to the stdlib listing: a case-insensitive string wrapper (working name `CiString` — name *and* folding semantics decided there, §12.1), whose provided `Eq` and `Hash` both operate on the folded form, agreeing by construction. This is the Rust `UniCase` / Haskell `Data.CaseInsensitive` pattern: the variant equality lives in a *type*, where the instance system can see it, rather than in an instance variant, where §4.3 would have to police it.

---

## 5. Constraint type members: grammar

### 5.1 Declaration side

```
constraint Iterable<c> =
    type Item
    iterate(xs: c): Seq(Item)
```

- A **type member** line is the keyword `type` followed by an uppercase-start name, on its own layout line (VSEP/`;` per Lexer & Layout), among the ordinary function members. No `=`, no parameters, no obligations (`type Item: Show` is v2 — §11).
- **Multiple type members are permitted by grammar.** No prelude constraint needs more than one; the grammar does not encode that accident (Rust precedent).
- Duplicate type-member names within one constraint: hard error, same family as duplicate function members (Constraints §2).
- The keyword is the existing `type` in its **third position** (module level / `constraint` body / `honor` block); position fully disambiguates. No lexer change; no new keyword.

### 5.2 Scope within the declaration

A type member's bare name (`Item`) is in scope **throughout the constraint body**, regardless of line order — member signatures may reference it (`Seq(Item)` above), including signatures textually preceding the `type` line. Style guidance (non-normative): declare type members first. Within the body, `Item` denotes "the instance's chosen type" — an opaque type constant to the checker, distinct from every other type; two different type members never unify with each other or with anything else during constraint-declaration checking.

### 5.3 Instance side

```
honor<a> Iterable<Bag(a)> =
    type Item = a
    iterate(xs) = Bag.toSeq(xs)
```

- The binding line is `type Name = τ`. **τ may mention only in-scope type names** (primitives, nominal types, fully-applied aliases per Declarations Preamble §5, other constructors) **and the instance's own `<...>` binders.** τ may **not** mention any implied type name — its own or another constraint's (they are not referenceable in type expressions, §7.3) — which is why recursion through type members is unwritable: no SCC check is needed because the cycle cannot be written.
- **Exactly-once discipline**, mirroring function members (Constraints §4.1): every type member declared by the constraint must be bound exactly once in the `honor` block; missing, extra, and duplicate bindings are each errors naming the member (§9).
- Within the `honor` block, the bare name `Item` is in scope and denotes τ — usable in optional annotations on the block's own function members. Function-member checking proceeds with the substitution applied: `iterate`'s expected type above is `Bag(a) -> Seq(a)`.
- A bare `Item = a` line (no keyword) is not this form — it is shaped like a term-level binding of an uppercase-start name, which Functions §2 reserves for constructors; the `type` keyword is what makes the line self-announcing.

### 5.4 Coherence

A type member is **part of the instance**: it lives in the instance's existing (constraint, constructor) coherence slot (Constraints §5.1) and adds no new slot, no new orphan consideration, and no new globality question. One instance per (constraint, constructor) means one `Item` per (constraint, constructor) — the functional-dependency reading the iterable table always had.

---

## 6. Identity and scoping of implied type names

**The identity of an implied type is the pair (owner constraint, member name).** `Source.Item`, `Sink.Item`, and `Iterable.Item` are three distinct implied types. Implied type names claim **no module-level namespace slot of any kind** — an implied type is a member of its constraint, exactly as a constraint's function members are (Constraints §2.2's member model, transposed to types), not a module-level declaration.

Consequently:

- Two constraints in one module may both declare `type Item`: **legal, ordinary, expected** — the Rust situation (`Iterator::Item`, `IntoIterator::Item`, and dozens more coexist because the owner disambiguates).
- A constraint's type member may share a name with a module-level `type`/`record`/`union`: **no conflict.** Inside the owner's body and its `honor` blocks, the bare member name **occludes** the module-level name (the standard local-wins scoping the language already has everywhere); outside those bodies the module-level name resolves by ordinary lexical scoping, untouched.
- The only duplicate rule is **within one constraint** (§5.1). Duplicate checking never crosses constraint boundaries.

**Scoping is owner-relative**: bare `Item` resolves *to the implied type* only inside its owner constraint's body and that constraint's `honor` blocks (§5.2/§5.3). Everywhere else, the implied type is not referenceable at all (§7.3); a same-spelled module-level type name, where one exists, remains usable there as itself.

**Do not re-litigate: module-level registration of implied type names**, in any collision family. Registering them flat — so that two constraints could not both declare `type Item`, or a type member collided with a same-named module-level declaration — imports the *constructor* collision story for what are *members*; constraint members already have (owner, name) identity with "qualified is normal" as their settled disambiguation doctrine. Flat registration manufactures artificial scarcity (Rust's ecosystem has hundreds of coexisting `Item`s), buys nothing for v2 that owner qualification doesn't buy better, and breaks the member analogy the constraint system is built on.

**v2 lands pre-shaped by existing doctrine.** When the projection reference syntax arrives, it inherits the constraint-member story wholesale: bare `Item(c)` when unambiguous in context, `Iterable.Item(c)` as the ordinary qualified form for collisions — the "qualified is normal" doctrine extending to type members with no new sentence. No registration scheme is needed now for that future to be clean; the owner *is* the disambiguator.

---

## 7. The v1 restriction: projection-bearing constraints

### 7.1 Definition

> A **projection-bearing constraint** is a constraint that declares at least one implied type member.

The name states the reason for the rule it serves: what such a constraint adds to the system is a *projection* (from a type to its member's binding), and projection out of an unsolved type variable is precisely the inference machinery (`Item(α)` deferred goals) that v1 does not have and v2 owns (Part 1 §6.2/§6.3).

### 7.2 The binder ban

> **A projection-bearing constraint cannot be imposed on a type-variable binder in v1.**

This is uniform over every binder position: function type parameters (`let f<c: Iterable>(...)` — error), `honor` prefix binders (`honor<a: Iterable> ...` — error), constraint subject binders, i.e. superconstraint position (`constraint Foo<c: Iterable>` — error), and conjunctions (`<a: (Eq, Iterable)>` — error on the `Iterable` conjunct). There are no other binder positions (data-declaration headers take no constraints, Declarations Preamble §2.2).

What remains — and suffices for Part 1 §6.1's floor — is everything that never projects from a variable:

- **Declaring** a projection-bearing constraint (user or prelude): legal. §5.1 grammar is fully general, not a prelude privilege (rejected alternative §10.4).
- **Honoring** one at a lawful instance head: legal — `honor<a> Iterable<Bag(a)>` per §5.3.
- **Calling its function members at concrete types**: legal — `iterate(myBag)` where `myBag : Bag(Int)` resolves by head-constructor lookup, the same monomorphic dispatch every constraint member already has. Zero inference changes.
- **The `for..in` judgment consuming its instance table**: Part 5's business.

Functions generic over "any iterable" remain unwritable in v1; `Seq(a)` parameters remain the idiom (Loops §7.1 seam, unchanged), and the ban's diagnostic points there (§9).

### 7.3 The reference ban

**An implied type is not referenceable in any type expression outside its owning constraint's body and `honor` blocks.** v1 rejects every expression that actually attempts such a reference:

- **Applied and qualified forms** — `Item(c)`, `Item(Bag(Int))`, `Iterable.Item`, and kin — are always such an attempt: they are v2's reference syntax (§11), and v1 reserves them by rejecting them with a message that knows what they will become, not by parsing them: *"`Item` is an implied type of `Iterable` and cannot appear in type expressions."*
- **A bare uppercase-start name** outside every owner's body resolves by ordinary lexical scoping. If it resolves to a module-level type of the same spelling, it *is* that type — legal, no interaction with this rule (§6's occlusion works in one direction only). If it resolves to nothing and matches a known implied type name, the resolver rejects it with the same knowing message — cheaper and better-phrased than a bare unbound-name error. A same-spelled identifier is **not** rejected merely for sharing a spelling with an implied type.

Enforcement point: type-name resolution. Outside its owner's bodies the implied type is simply not in scope; the resolver's knowledge of owner-scoped member names (§6) upgrades the failure message.

---

## 8. `Iterable` is a prelude constraint declaration

```
constraint Iterable<c> =
    type Item
    iterate(xs: c): Seq(Item)
```

**The implied type is named `Item`.** Rationale, kept against re-litigation: `Item` is the ordinary full word; it is the exact Rust precedent for this exact slot (`Iterator`'s `type Item`); and the eventual v2 reference syntax `Item(c)` reads as plain English. Rejected: **`Elem`** (a truncation with Haskell-shelf lineage — `Foldable`/MonoTraversable's `Elem`; an abbreviation would be off-doctrine in the most prominent implied type in the language), **`Element`** (the Swift spelling — full-word virtue, but longer while buying nothing `Item` lacks). "Element type" remains the correct *prose* phrase for the concept (Loops §7.1's ε is untouched); `Item` is the member's name.

- The compiler-known iterable table (Loops §5) **is defined as this constraint's instance table**: one row per instance, element column = the instance's `Item` binding, strategy column = its `iterate`. The definitive v1 table of provided instances — including the FFI-owned `Array(a)`, `JsMap(k, v)`, and `JsSet(a)` rows — is **Part 5 §4**; it is not repeated here.
- `Iterable` is projection-bearing, so §7.2 applies: it cannot constrain a binder in v1. The Loops §7.1 discipline — `Iterable` never appearing in inferred signatures, hovers, or unsatisfied-constraint errors — is thereby preserved *by construction* rather than by suppression: no binder can introduce it, so inference can never surface it.
- **Operational semantics are Part 5's**: `for x in e` resolution (head-constructor-known lookup, unsolved-tyvar annotation-required error, non-iterable error + hints), table-opening for user instances, orphan-rule application to those instances, and emission. This document owns the declaration and the grammar it exercises; nothing operational is decided here beyond what Part 1 §6.1 already fixed.

---

## 9. Diagnostics checklist

Noun policy: the noun for the `type`-declared member is **implied type**; the instance noun remains **instance**; `Hash` diagnostics use the derivation vocabulary of Constraints §4.5.

| Situation | Error / hint | Provenance |
|---|---|---|
| Unsatisfied `Hash` at a call/use site | standard unsatisfied-constraint phrasing ("`Point` has no `Hash` instance, required by `Map.set`") **plus** fixit: "add `derives Hash` to the declaration of `Point`" | Constraints §8 pattern + this doc |
| Member-block `honor Hash<T>` | "`Hash` instances cannot be hand-written; use `derives Hash` on the declaration of `T`" | §4.1 |
| `honor Hash<T> = derive` with hand-written `Eq<T>` | "cannot derive `Hash<Weird>`: `Weird` has a hand-written `Eq` instance; a derived hash is only consistent with a derived equality" | §4.3 |
| `derives Hash` with no `Eq` in scope | missing-superconstraint error + "add `Eq` to the `derives` list" | §3.1 |
| Underivable field/slot for `Hash` | "cannot derive `Hash<Point>`: field `f` has type `T`, which has no `Hash` instance" | §3.1 |
| `derive` for a non-derivable constraint | "…only `Eq`, `Ord`, `Show`, and `Hash` have derivable forms" | §3.1, Constraints §8 |
| `derives Hash` on an `exception` | "exceptions have no derived instances" (existing) | §4.2 |
| Projection-bearing constraint on a binder | "`Iterable` declares an implied type and cannot constrain a type variable; take a `Seq(a)` parameter instead" (the `Seq` hint appears when the constraint is `Iterable`; for user constraints, the first clause alone) | §7.2 |
| Attempted implied-type reference in a type expression (applied/qualified form, or unresolvable bare name matching a known implied type) | "`Item` is an implied type of `Iterable` and cannot appear in type expressions" | §7.3 |
| Duplicate type member within a constraint | hard error, duplicate-member family | §5.1 |
| Missing type-member binding in `honor` | "the `Iterable<Bag(a)>` instance is missing `type Item`" | §5.3 |
| Extra type-member binding in `honor` | "`Iterable` has no implied type `Items`" (+ near-miss suggestion) | §5.3 |
| Duplicate type-member binding in `honor` | hard error at the second line | §5.3 |
| Implied type name (own or other) in a `type Name = τ` RHS | the §7.3 message (same enforcement point) | §5.3, §7.3 |
| Bare `Item = a` line in an `honor` block | ordinary parse error for a term-level uppercase binding (Functions §2); near-miss hint "did you mean `type Item = a`?" is nice-to-have, not owed | §5.3 |

---

## 10. Rejected alternatives (do not re-litigate)

### 10.1 Marker `Hash` + seeded runtime hashing (rejected as a bundle)

A zero-member `constraint Hash<a: Eq>` with the hash function living only in the dictionary, unnameable — optionally paired with a per-process random seed for HashDoS resistance. Rejected: the dictionary must carry the function regardless, so the marker buys only opacity; a zero-member constraint is a new grammar corner with one inhabitant; observable `hash` has legitimate uses (memo keys, sharding); and a seeded *member* undermines itself — a seed is not secret once `hash` is callable. The observable-member design is the honest one; seeding belongs only inside table placement (§2.4).

### 10.2 Derived `Hash` over hand-written `Eq`, hazard documented

Permitting `derives Hash` beside a custom `Eq` with a manual "keep them consistent" warning. Rejected without hesitation: this recreates, inside the derivation system, the exact silent-map-corruption hazard that derivable-only exists to close (Part 1 §4.2). A documented landmine is still a landmine; §4.3 makes it unwritable instead.

### 10.3 Parameterized derivation (`derives Hash by caseFold`)

A derivation-variant grammar to serve case-insensitive keys and kin. Rejected: it is a second derivation grammar; both `Eq` and `Hash` would need the variant argument, and the compiler would have to verify they took the *same* one — re-importing the agreement hazard as a new error class. The wrapper-key pattern (§4.5) serves the use case with zero new grammar, and `derive via` (§11) is the lawful general mechanism if v2 wants one.

### 10.4 Type members as a prelude-only (or `Iterable`-only) grammar

Restricting §5's grammar to the prelude, or hardcoding the binder ban to the name `Iterable`. Rejected: a grammar with one permitted inhabitant is a fiction, and a name-keyed restriction turns v2's widening into a migration of the special case rather than a deletion of one rule. The projection-bearing definition (§7.1) bans exactly what v1 cannot do and nothing else; user-declared projection-bearing constraints are legal, honorable, and monomorphically callable today, and join binder positions in v2 with no source changes.

### 10.5 Broader diagnostic nouns

"Type member" was considered because it echoes the source keyword and is self-describing. Rejected: it could later cover non-projected members (for example, a type constant never projected from the subject), silently over-widening every rule phrased with it — the §7.1 definition would drift. The earlier ecosystem noun was also rejected as too weak: mere association does not state the functional dependency. **Implied type** says what matters here—the instance subject uniquely determines the member type—and keeps the projection-bearing definition future-proof.

### 10.6 Normative 32-bit `hash` codomain

Pinning the signed-32-bit range as a promise rather than an informative note. Rejected for v1: no consumer needs it, and a promise once made is permanent. Revisit only under concrete interop pressure (§12.2).

---

## 11. Pre-registered v2 direction: `derive via`

Recorded so v2 planning starts here rather than from scratch; **nothing below is decided.**

The shape: `honor (Eq, Hash)<T> = derive via normalize`, where `normalize : T -> U` and `U` has `Eq`/`Hash` — both instances defined through the same projection, so the §2.3 law holds **by construction for any user-supplied function**, not by trust. This subsumes case-insensitive keys, normalized-form equality, and most of the demand queued behind "user-implementable `Hash`"; it is therefore a **candidate replacement** for, not an addition to, the Part 1 §6.3 "user `Hash` in v2" entry — a law-proof mechanism where raw hand-written `Hash` is merely law-hoped. Open questions for that spec: the multi-constraint head form, whether `Eq` alone may be derived `via` (creating a hand-written-`Eq`-like instance that §4.3 would then need to reason about), evaluation-freeness of the projection reference (Constraints §6.3 pressure), and interaction with `Ord`.

The v2 implied-types remainder is also routed here: deferred `Item(α)` goals, the `Item(c)` reference syntax (§7.3 reserves it), obligations on type members (`type Item: Show`), and generic `Iterable` binders — per Part 1 §6.3 and the spec roadmap's Tier-3 entry. None of it is designed here.

---

## 12. Routed elsewhere (recorded, non-blocking)

1. **`CiString`: name and folding semantics** (Unicode full case fold vs `toLowerCase`-family — a real semantic choice with JS-emission consequences) → `stdlib-roadmap.md` (wrapper-key row; §4.5 here fixes the mechanism).
2. **Normative `hash` range** — only if interop pressure materialises; the informative note stands until then (§2.2, §10.6).
3. **`Hash` for prelude unions** (`Ordering` et al., via `derives` on their prelude declarations) and **`Range` `Eq`/`Hash`** (rides the open Loops §3.6 `Eq` question) → `stdlib-roadmap.md` (prelude-instances rows).
4. *(discharged)* **`Hash<Vector>`/`Hash<Map>`/`Hash<Set>`** — specified: Part 3 §8 and Part 4 §8.4. Not open.
5. **`derive via`** and the v2 implied-types remainder → §11.

---

## 13. Reserved

*Anchor retained for stable inbound references. The canonical decisions of this document live in §§1–12; there is no separate decisions table.*

---

## 14. Edit notes to companion specs (unapplied only)

| Doc | Edit |
|---|---|
| **declarations-preamble.md** | Not-in-scope line still describes implied `type` members as v2 — now v1 per this doc; on next touch, repoint to here and note the `type` keyword's three positions (module / `constraint` / `honor`), position-disambiguated. |
| **exceptions.md** | §10 no-instances presumption note on next touch: `Hash<Exn>` is unwritable in total (§4.2 here). |
| **lexer-layout.md** | Note only, on next touch: no new keyword; `type` gains its third position. |

---

## 15. Acceptance tests

```
-- (1) Derives Hash; usable as a key-shaped value
record Point = {x: Float, y: Float} derives (Eq, Hash)
let h = hash(Point {x: 1.0, y: 2.0})            -- OK : Int

-- (2) Law-relevant Float normalisation
hash(-0.0) == hash(0.0)                          -- true
hash(0.0 / 0.0) == hash(Float.nan)               -- true (all NaNs one value)

-- (3) Structural types: automatic, conditional
let t = hash((1, "a", true))                     -- OK (all components Hash)
let u = hash((1, fn))                            -- ERROR: no Hash for Int -> Int (component)

-- (4) Hand-written Hash: closed door, signposted
honor Hash<UserId> =
    hash(u) = u.n                                  -- ERROR: Hash instances cannot be
                                                 --   hand-written; use `derives Hash`

-- (5) Eq-agreement rule
record Weird = {s: String}
honor Eq<Weird> =
    equals(a, b) = String.lower(a.s) == String.lower(b.s)
honor Hash<Weird> = derive                       -- ERROR: `Weird` has a hand-written `Eq`
                                                 --   instance; a derived hash is only
                                                 --   consistent with a derived equality

-- (6) Missing superconstraint, hinted
record P = {n: Int} derives Hash                 -- ERROR: missing Eq
                                                 --   hint: add `Eq` to the `derives` list

-- (7) Whitelist message names all four
honor Signed<P> = derive                            -- ERROR: only Eq, Ord, Show, and Hash
                                                 --   have derivable forms

-- (8) A user collection joins for..in (operational check in Part 5)
union Bag(a) = MkBag(Vector(a))
let toSeq<a>(b: Bag(a)): Seq(a) = ...
honor<a> Iterable<Bag(a)> =
    type Item = a
    iterate(xs) = toSeq(xs)                        -- OK; instance row: Bag → Item = a

-- (9) Exactly-once on the instance side
honor<a> Iterable<Box(a)> =
    iterate(xs) = ...                              -- ERROR: instance is missing `type Item`

-- (10) Projection-bearing binder ban, all positions
let f<c: Iterable>(xs: c): Int = ...             -- ERROR: `Iterable` declares an implied
                                                 --   type and cannot constrain a type
                                                 --   variable; take a `Seq(a)` parameter
constraint Countable<c: Iterable> =              -- ERROR: same rule, superconstraint position
    count(xs: c): Int

-- (11) Reference ban (no module-level `Item` in scope)
let g(e: Item): Int = ...                        -- ERROR: `Item` is an implied type of
                                                 --   `Iterable` and cannot appear in type
                                                 --   expressions

-- (12) Monomorphic member call: legal today
let n = iterate(MkBag(v))                        -- OK : Seq(Int)   (head constructor known)

-- (13) Owner-scoped identity (two user constraints, one module)
constraint Source<c> =
    type Item
    next(xs: c): Option(Item)                      -- Item here is Source.Item
constraint Sink<c> =
    type Item                                      -- OK: Sink.Item is a distinct implied
    put(xs: c, x: Item): c                         --   type; the owner disambiguates

-- (14) Occlusion inside an owner's body
type Item = Int                                  -- a module-level alias, coexisting freely
constraint Queue<c> =
    type Item                                      -- OK: no conflict with the alias
    peek(xs: c): Option(Item)                      -- Item = Queue.Item here (occludes the alias)
```

*(Bare `Item` outside any owner's body still means the module-level alias where one is in scope — as after test (14)'s alias; inside `Queue`'s body it means `Queue.Item`. Standard local-wins scoping — §6, §7.3.)*

---

## 16. Reserved

*Anchor retained for stable inbound references. The post-review corrections formerly recorded here (owner-scoped implied-type identity; the seeded-placement/iteration-order split) are incorporated into §6 and §2.4 respectively, each with its do-not-relitigate record.*
