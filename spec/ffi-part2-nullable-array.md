# Hexagon FFI Part 2: `Nullable(a)` and Borrowed `Array(a)`

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing; §6.3 amended 2026-08-02 — `Array.size` is renamed `Array.length` under Collections Part 1 §10.1, and the `.length` diagnostic is re-charactered, see correction record §13.1. Amended 2026-08-02 (#237 ruling): §9 gains its shipping doctrine — an unshipped conversion is absent, never a declared-but-throwing stub; outbound `Vector.toArray` ships first — §9.1; rejected alternatives, including James's retracted `NotImplemented` interim, §9.2. The same amendment reconciles §8 with §9.1's finding of fact, on the ordinary ground that a Decided spec's rows are design statements rather than reports on the build: §8.1's `Iterable<Array(a)>` row does not oblige a public symbol spelled `Array.toSeq`, so Collections Part 5 §6's discharge stands, while §8.3's suite membership — which does name callables — is marked decided-but-unshipped. The debt's ledger row is `stdlib-roadmap.md` §2. Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §2 and the §4 `Nullable` package, drafted per `spec/notes/ffi-roadmap.md` Part 2. The three questions the draft recorded as promotion blockers (`Nullable` idempotence, §2.1; the `Array` accessor surface, §6.3; sparse arrays, §6.4) were resolved by James and Sol before promotion. Reads Part 1 (`ffi-part1-boundary.md`) for the category vocabulary and failure doctrine; restates neither.
**Scope:** The two explicit foreign doors this part owns. `Nullable(a)`: the raw `a | null | undefined` representation, definitional idempotence (§2.1), the qualified values `Nullable.null` and `Nullable.undefined`, the inspection predicates, `NullableCase(a)` and `Nullable.toCase`, and the `Option` conversions — including the supersession of Unions §8's provisional spellings (§5). `Array(a)`: the zero-copy readonly borrowed view, the foreign stability contract, the read-only accessor surface (§6.3), sparse arrays and holes (§6.4), observation semantics and native iteration emission (discharging Collections Part 5 §6's binding obligation), shallow element treatment, and the explicit copying conversions (`Array.toSeq`/`Array.fromSeq`/`Array.toVector`/`Vector.toArray`).
**Not in scope:** Optional/default parameters (Part 4 fixes the fixed-arity rule; callers model explicit nullish slots with the §2.2 values). TypeScript-style flow narrowing (reserved for a separate type-system deep dive; §2.5 records the reservation and the preferred alternative). `Seq(a)` adaptation mechanics (Part 3 — `Array.toSeq`'s result is a `Seq`, whose semantics live there). Foreign `JsMap`/`JsSet` views (Part 10). `JsValue` and checked decoding (Part 11).
**Companions:** Part 1 §2–§5 (categories, failure doctrine, shallow conversion, `Hex` namespace); Unions §8 (`Option`; provisional conversion spellings superseded here, §5); Primitive Types §9 (`Unit` is unrelated to nullability); Collections Part 5 §6 (the `Iterable<Array(a)>` obligation, discharged in §8); Collections Part 5 §1 (the finite-collection conversion suite); Loops/Ranges/Iteration §6 (`Seq`).

---

## 1. Doctrine

JavaScript has two pervasive shapes with no honest Hexagon equivalent: nullish values and mutable arrays. Each gets exactly one explicit, zero-cost foreign door, and neither leaks into ordinary Hexagon:

> **`Nullable(a)` is the explicit nullish door: a zero-wrapper boundary type whose value is `a | null | undefined`. `Array(a)` is the explicit array door: a zero-copy, readonly, borrowed view of a foreign-owned JavaScript array. `Nullable(a)` is representation-direct at the boundary. `Array(a)` crosses without copying but remains a borrowed foreign view. Neither admits ambient nullability or mutation into Hexagon.**

- There are **no unqualified `null` or `undefined` literals** in ordinary Hexagon source; the nullish values exist only as the qualified, typed companions of §2.2.
- `Option(a)` is never erased to nullability (Part 1 §4; Unions §8's pre-registered rejection). `Nullable` is where JS nullishness lives, and the conversion between the two worlds is explicit (§5).
- `Array(a)` is **not a Hexagon-owned persistent collection** and has no mutation operations. (It does join the finite-collection conversion suite, §8.3 — suite membership is about `toSeq`/`fromSeq` vocabulary, not ownership.) The persistent workhorse remains `Vector(a)`; `Array` exists so bindings can accept and return real JavaScript arrays without copying.
- `Unit`'s `undefined` representation (Primitive Types §9) is unrelated to `Nullable`; they meet at the boundary but are different concepts.

---

## 2. `Nullable(a)`

### 2.1 Representation

`Nullable(a)` is a **zero-wrapper** foreign type. Its JavaScript runtime representation and its `.d.ts` face are both:

```ts
a | null | undefined
```

No wrapper object, tag, or brand exists at runtime; a `Nullable(String)` holding `"x"` *is* the string `"x"`. Merely carrying the value preserves whether the foreign value was `null` or `undefined` — the distinction is lost only where a conversion deliberately collapses it (§4).

**`Nullable` is definitionally idempotent over the closed set of designated nullish-absorbing types:**

```text
Nullable(Nullable(a)) ≡ Nullable(a)
Nullable(JsValue)     ≡ JsValue
```

The first equation applies through type aliases and generic substitution: there is no distinct doubly-nullable type for the zero-wrapper representation to misrepresent. Part 11 designates `JsValue` as the second and only other v1 nullish-absorbing type because it already contains both `null` and `undefined`. The designation list is explicit and closed; the checker performs no general structural “contains nullish” analysis over arbitrary unions or opaque foreign types.

### 2.2 The qualified nullish values

```hexagon
Nullable.undefined : Nullable(a)
Nullable.null      : Nullable(a)
```

These are qualified, typed values that can exist **only** as `Nullable(a)`. They provide explicit arguments for foreign APIs — `Nullable.undefined` for the ordinary omitted/default JS case, `Nullable.null` when the API specifically distinguishes explicit null — without admitting ambient nullish values into Hexagon. (Their use in modeling a foreign API's optional slot under the fixed-arity rule is Part 4's example, not new surface here.)

### 2.3 Inspection predicates

```hexagon
Nullable.isNullish   : Nullable(a) -> Bool
Nullable.isNull      : Nullable(a) -> Bool
Nullable.isUndefined : Nullable(a) -> Bool
```

`isNullish` is true for either foreign absence value. The two narrower predicates exist because some JavaScript APIs distinguish omission/`undefined` from explicit `null`.

**These predicates return `Bool` and nothing more.** They do not refine the static type of their argument; TypeScript-style control-flow narrowing is not smuggled in through them (§2.5). Extraction goes through `toCase` or `toOption` (§§3–4).

### 2.4 Emission

The predicates and the §2.2 values are representation-honest and trivially cheap: `Nullable.undefined` is `undefined`, `Nullable.null` is `null`, `isNullish(x)` is `x == null` (or the equivalent explicit comparison, emitter's choice for readability), `isNull`/`isUndefined` are `===` comparisons. No allocation anywhere.

### 2.5 No flow narrowing; `toCase` is the alternative

Whether Hexagon should ever gain flow-sensitive narrowing is **reserved for a separate language/type-system deep dive** — to be studied against at least aliasing, mutation, closures, user-defined predicates, exhaustiveness, principal types, diagnostics, and locality, not dismissed without comparison. It is not an FFI decision, and nothing in this part constrains its outcome except as a comparison point:

> **This FFI supplies the concrete comparison datum.** `Nullable.toCase` proved superior here because an explicit ordinary union provides extraction, exhaustiveness, stable types, and clear control flow without predicate-driven refinement. The future deep dive must compare narrowing against such sum-type conversions rather than assuming predicates need magical typing.

The house answer to "how do I narrow a `Nullable`?" is therefore: **you don't — you convert.** `Nullable.toCase` for the exact three-way reading, `Nullable.toOption` when both absence forms mean `None`.

---

## 3. `NullableCase(a)` and `Nullable.toCase`

The exact three-way reading is an ordinary Hexagon union:

```hexagon
union NullableCase(a) =
    Undefined
    | Null
    | Value(value: a)
```

```hexagon
Nullable.toCase : Nullable(a) -> NullableCase(a)
```

`toCase` preserves the `null`/`undefined` distinction and supports exhaustive ordinary `match`; the `Value(value)` arm extracts an `a`. `NullableCase` is a plain prelude union with no special typing — it follows Unions §6 for representation (mixed union: tagged POJOs, shared nullary constants) and Unions §4 for matching. Nothing about it is boundary magic; only `toCase` itself touches the foreign representation.

All three constructors are qualified-only in the prelude inventory: `NullableCase.Undefined`, `NullableCase.Null`, and `NullableCase.Value(value)` in expressions and patterns. They are not auto-imported as bare prelude terms. This is ordinary companion qualification and does not change their runtime representations (Part 12 §12).

---

## 4. `Option` conversions

```hexagon
Nullable.toOption        : Nullable(a) -> Option(a)
Nullable.fromOption      : Option(a) -> Nullable(a)   -- None -> undefined
Nullable.fromOptionOrNull : Option(a) -> Nullable(a)  -- None -> null
```

- `toOption` **deliberately collapses** both absence forms to `None`. It is the shorter common path when omission and explicit null mean the same thing — which is most APIs.
- `fromOption` maps `None` to `undefined`, the ordinary JS absence; `fromOptionOrNull` exists for APIs that specifically want explicit `null`.
- These are ordinary eager functions in Part 1 §2's vocabulary: **converted** operations with total, specified behavior (no failure mode — every input has a defined image).
- `Some(x)` converts to the value `x` itself (zero wrapper on the `Nullable` side); `toOption` wraps a present value as `Some(value)` in `Option`'s real union representation.
- At `a = Nullable(b)`, §2.1's idempotence applies: `fromOption : Option(Nullable(b)) -> Nullable(Nullable(b))` is `Option(Nullable(b)) -> Nullable(b)`, so `fromOption(Some(Nullable.null))` is simply `null` at `Nullable(b)`. The collapse is definitional, not an ambiguity.

---

## 5. Supersession: Unions §8's provisional spellings

Unions §8 provisionally named this conversion pair `Option.fromNullable` / `Option.toNullable`, with exact signatures owed to the FFI spec. **This part supersedes those spellings.** The conversions are `Nullable`-companion-owned:

```text
Option.fromNullable  -> superseded by  Nullable.toOption
Option.toNullable    -> superseded by  Nullable.fromOption / Nullable.fromOptionOrNull
```

Ownership rationale: the operations exist because `Nullable` exists; the boundary type's companion is where a binding author looks; and `Option`'s prelude surface stays free of boundary vocabulary.

> **Edit note (for Unions §8, to be applied on next touch of that document):** replace the provisional `Option.fromNullable` / `Option.toNullable` spellings with a pointer to this part's §4 companion surface. The §8 rejection of nullable erasure is unaffected and remains binding.

---

## 6. `Array(a)`: the borrowed foreign view

### 6.1 What it is

`Array(a)` is a **zero-copy borrowed view** of a JavaScript array (Part 1 §2.2's borrowed category). Foreign code owns the underlying array. Hexagon provides **no mutation operations** on `Array(a)` — it is readonly *from Hexagon*, full stop — and its `.d.ts` face is:

```ts
ReadonlyArray<a>
```

Element types obey Part 1 §5.2's recursive representation contract: `Array(Int)` asserts a JS array of safe integers (never scanned, per the zero-scan rule); `Array(Vector(Int))` asserts a JS array of genuine runtime Vector values, faced as `ReadonlyArray<Hex.Vector<number>>`. An adapter-requiring element type (`Array(Seq(Int))`) is rejected by Part 1 §5.3.

### 6.2 The foreign stability contract

> **Foreign code must keep the array's elements and length stable while Hexagon, including any deferred traversal derived from the array, may observe it.**

- The obligation lasts while Hexagon or any deferred `Array.toSeq` traversal may still observe the array. **An escaped sequence extends the borrow obligation** through its possible consumption lifetime: handing `Array.toSeq(arr)` onward hands the stability obligation onward with it.
- Violation is a Part 1 §3.1 contract violation: it does not create memory unsafety, but the affected contents, order, length, and traversal observations are unspecified.
- **A freshly runtime-constructed array is stable while exclusively held by Hexagon.** `Array.fromSeq` and `Vector.toArray` produce fresh arrays (§9); the stability obligation becomes relevant only once foreign code can alias the reference. Hexagon never gains a public mutation operation either way.

### 6.3 The accessor surface

`Array(a)` ships a read-only accessor surface aligned with `Vector`'s indexing doctrine (Collections Part 3 §5–§6 — brackets assert, names answer, windows have no direction). All observations are zero-copy reads of the borrowed array except slicing, which is an explicit fresh construction:

```hexagon
Array.length : Array(a) -> Int
xs[i]                                 -- 1-based read-only; throws IndexError out of bounds
Array.at    : (Array(a), Int) -> a    -- signed from-end addressing; throws IndexError
Array.get   : (Array(a), Int) -> Option(a)
xs[lo..hi]                            -- eager shallow slice: a fresh JS array
```

- `xs[i]` is **1-based and read-only**; there is no assignment-to-index grammar, and no `set` exists. Out-of-bounds throws `IndexError` (Collections Part 3's declaration), asserting at the fault site.
- `at` and `get` carry their Vector contracts: `at` is the bracket's signed sibling (from-end addressing, throws), `get` answers with `Option`.
- **Slicing is eager and shallow and returns a fresh JS array** — an `Array(a)` that is freshly runtime-constructed and therefore stable while exclusively held (§6.2). Elements are preserved by value and identity (Part 1 §5.1); windows clamp, and a directed window throws `SliceError`, per the Vector window doctrine.
- **No mutation surface exists**, on any accessor or result.
- Emission is representation-honest but not bare: `Array.length(xs)` is `xs.length`. `xs[i]` emits a bounds check (`i < 1 || i > xs.length` throws `IndexError`) plus the 1-to-0 offset, then the native index read — the assertion semantics require the check; a bare `xs[i - 1]` would return `undefined` out of bounds instead of throwing. Slicing emits **window intersection** before calling native `Array.prototype.slice`, because JavaScript interprets negative slice bounds from the end — passing an unclamped bound through would silently select the wrong window, and clamping each endpoint independently into `[1, length]` is also wrong (a fully out-of-window slice like `[10, 20, 30][5..9]` must be empty, not `[30]`). The required emission shape:

  ```text
  start = max(lo, 1)
  end   = min(hi, length)

  if start > end: fresh empty array
  else:           native slice(start - 1, end)
  ```

  This handles empty arrays and empty ascending ranges correctly. A slice taking a general `Range` value checks direction **first** and throws `SliceError` for a descending range, per the window doctrine.
- **The `.length` habit keeps its specialized diagnostic — re-charactered by the 2026-08-02 rename (§13.1).** A bare property read `xs.length` on an `Array(a)` remains a hard error whose message names **both** legal spellings (§10) — the canonical `Array.length(xs)` first, and the minimal edit `xs.length()` — per the Rewrite Rule, the fixits are stated in the diagnostic (§13.1 resolves why both). What the error teaches changed with the rename: the word is now right and the *spelling* is wrong. The message must therefore explain the grammar, never the vocabulary — `Array(a)` is nominal, not a record; it has no field surface, and no property read crosses the foreign door; the companion call is the read. A user who typed the right word must not be told the name is wrong. The fused call form `xs.length()` is not this diagnostic's business at all: it is ordinary companion dispatch (Method Syntax §2.1, §5) resolving to `Array.length(xs)`, and it compiles (§13.1). The diagnostic's domain is exactly the bare read.

### 6.4 Sparse arrays and holes

**`Array(Nullable(a))` admits sparse JavaScript arrays; a hole observes as `Nullable.undefined`.** No presence distinction exists: Hexagon cannot and does not distinguish a hole from a stored `undefined`, and no `has`-style accessor is added. No scanning is performed — the zero-scan rule is unchanged.

A hole in an array declared with a **non-nullable** element type violates Part 1 §5.2's trusted element representation contract, with Part 1 §3.1's consequences (affected observations unspecified). This is the ordinary trusted-boundary reading, now stated rather than inferred: `undefined` is not a safe integer, a string, or any other non-`Nullable` representation, and the declaration asserted it would not appear.

### 6.5 Observation semantics: live and snapshot coincide

Under valid use — i.e. under the §6.2 contract — **live iteration and snapshot iteration are observationally identical**. This is the resolution of the observation-semantics question Collections Part 5 §6.1 deliberately left to this spec: the boundary contract already requires exactly the stability that a snapshot would otherwise have to manufacture, so iteration **does not copy merely to enforce a condition already required by the contract**.

Consequently, **native `for...of` emission is permitted and preferred** (§8.2). `Array.toVector` is the explicit stable-snapshot operation for callers who need stability beyond the borrow (§9).

---

## 7. Native iteration needs no closing protocol

Native array iteration requires no special closing operation. A loop-body throw propagates normally; JavaScript Array iterators own no external resource requiring deterministic `return()` cleanup. (Contrast Part 3's rules for foreign iterators behind `Seq`, where closure is a real question — none of that machinery applies to the borrowed array door.)

---

## 8. The `Iterable` instance: discharging Collections Part 5 §6

### 8.1 The row

This document declares the row Collections Part 5 §6.1 pre-committed:

> **`Iterable<Array(a)>` holds, with `type Item = a`; its member `toSeq` is §9's `Array.toSeq`.**

`for x in arr` therefore resolves by the ordinary Collections Part 5 §3 algorithm; the direction (the foreign door is iterable) was decided there and is not reopened here. The row's *meaning* is §6.5's: iteration observes the borrowed array under the stability contract, and live-versus-snapshot is not observable under valid use.

**The row does not oblige a public symbol of that spelling** *(added 2026-08-02, #237 ruling)*. §9.1 finds that `Array.toSeq` does not exist in the shipped toolchain. That finding does not falsify this row, and the reason is the ordinary one: **this document is Decided, and a Decided spec's instance row is a statement of design, not a report on the current build.** An unshipped compiler no more falsifies §8.1 than it falsifies §9's four conversion contracts, which are equally unimplemented and equally normative. **The word doing the work is *absent*, and the boundary is sharp:** an implementation that **contradicts** a Decided row is a conformance defect (`spec/notes/compiler-conformance-defects.md` — *"an existing language decision was correct and the compiler diverged from it … the correction restores conformance"*), never a licensed divergence. Nothing in this paragraph excuses a divergence; it addresses only a row the build has not reached. The member binding fixes what iterating an `Array` *means* — the element type and the traversal — and names the operation (§9's `Array.toSeq`) that will realize it; it does not oblige the compiler to route through a symbol of that spelling, and today the compiler does not: §8.2's native `for...of` emission consults no member at all. **Collections Part 5 §6's discharge therefore stands.** What §9.1 finds unshipped is the *callable* `Array.toSeq`, which §8.3 and §9 name.

Two things this paragraph deliberately does **not** claim, both corrected out of an earlier draft that asserted them:

- **Not that a provided row's `toSeq` is uncallable.** It is callable. Collections Part 2 §7.2 preserves exactly this: *"Calling its function members at concrete types: legal — `toSeq(myBag)` … the same monomorphic dispatch every constraint member already has"*, and Part 5 §2.3 gives the provided-row case outright — `toSeq("abc") : Seq(String)`. The binder ban, the type-variable restriction, and the `.d.ts` exclusion each close a *different* path (polymorphic loop sites, generic signatures, foreign surface) and none closes the monomorphic direct call. `toSeq(arr)` is a legal shape, and since `stdlib/Iterable.hex` landed the member is the name's one bare exporter (Part 5 §2.3's sole-exporter bullet), so the call reaches exactly this row.
- **Not that this is special.** Nothing here is peculiar to `Array`. The same holds of `Iterable<JsMap(k, v)>` and `Iterable<JsSet(a)>` — FFI Part 10 §6 binds their members, and those rows waited only on the types having representations at all; with the types landed (#396) both rows are live in exactly this section's condition: `toSeq(jsMap)` discharges against the row while the *callable* `JsMap.toSeq`/`JsSet.toSeq` stay among Part 10's unshipped names. A Decided row outrunning the build is the corpus's normal condition, not an exception needing a doctrine.

*(Bare `iterate` is unrelated — it is `Seq`'s seed/step producer, which keeps that name.)*

### 8.2 Emission

`for x in arr` over an `Array(a)` emits native JavaScript iteration:

```js
for (const x of arr) { ... }
```

This is legitimate precisely because of §6.5 — native iteration's JavaScript mutation-observation behavior is unobservable under the boundary contract, which is why Collections Part 5 §13.5 correctly refused to mandate this emission before the semantics existed. The decision record licenses exactly this: native `for...of`, permitted and preferred. Other emission strategies (e.g. direct indexed loops) are not licensed here — an exotic foreign array object could observe the difference in access pattern, so any widening of the emission license is a separate decision, not emitter discretion.

### 8.3 Suite membership

**`Array(a)` joins the finite-collection `toSeq`/`fromSeq` conversion suite** (Collections Part 5 §1), under exactly those names (§9). This closes the suite-membership question Part 5 left open.

**Membership is decided; the names are not yet shipped** *(added 2026-08-02, #237 ruling)*. Neither `Array.toSeq` nor `Array.fromSeq` exists today (§9.1's finding of fact). The difference from §8.1 is not doctrinal — neither section is exempt from §9.1, and §9.1 has no exemptions to give — it is that **§8.1's row has shipped behaviour under an unshipped member name, and this sentence names surface with no behaviour at all**: `for x in arr` compiles and iterates today (§8.2's native emission), whereas nothing whatever answers to `Array.toSeq`. Suite membership is nonetheless settled as design — no later document may reopen whether `Array(a)` belongs — and the names ship under §9.1's doctrine and order, never as stubs in the interim. Read "joins the suite, under exactly those names" as fixing *which* names discharge the membership, not as asserting that they are callable now.

---

## 9. The conversion surface

```hexagon
Array.toSeq    : Array(a) -> Seq(a)      -- lazy, zero-copy view over the borrow
Array.fromSeq  : Seq(a) -> Array(a)      -- eager, fresh JS array
Array.toVector : Array(a) -> Vector(a)   -- eager, stable persistent snapshot
Vector.toArray : Vector(a) -> Array(a)   -- eager, fresh JS array
```

- **`Array.toSeq` is lazy and zero-copy** over the borrowed array. It allocates no copy and extends the stability obligation per §6.2. Everything about the resulting `Seq`'s persistence and memoization is Part 3's; nothing here adds to it.
- **`Array.fromSeq` eagerly creates a fresh JavaScript array.** Consuming the sequence follows Part 3's rules (iterative traversal; an infinite `Seq` does not terminate).
- **`Array.toVector` eagerly creates a stable persistent snapshot** — the explicit escape from the borrow: the resulting `Vector` is an ordinary Hexagon value with no foreign stability dependency.
- **`Vector.toArray` eagerly creates a fresh JavaScript array**, stable while exclusively held (§6.2).
- **All four are shallow** (Part 1 §5.1): they change only the collection named by the operation and preserve element values and runtime identities. `Vector.toArray : Vector(Vector(Int)) -> Array(Vector(Int))` — never `Array(Array(Int))`. Nested conversion is the caller's explicit map.
- All four are **converted** operations (Part 1 §2.4) with total, specified behavior on valid inputs; there is no checked failure mode. (These names supersede the FFI agenda's stale pre-rename `Array.toList`/`List.toArray` spellings, as Collections Part 5 §6.1 already recorded.)

### 9.1 Shipping doctrine: absent until implemented, outbound first *(added 2026-08-02, #237 ruling)*

**The finding this section answers.** As of this ruling, none of §9's four conversions is implemented, all verified against the tree: `stdlib/Vector.hex` exports no `toArray`; no `Array` companion operations exist at all (the resolver's compiler-provided collection qualifiers are `Map`/`Set`/`Vector` in ordinary source, plus the runtime-privileged `Node` (`intrinsics.md` §9.2; #223) — no `Array` among them — and there is no `Array.hex`); and the intrinsic inventory holds exactly `seqMemoize`. *(Since superseded in part: the `Vector` milestone landed — `stdlib/Vector.hex` is a prelude member declaring seven `vector*` inventory keys through the intrinsic door, and the resolver's compiler-provided collection qualifiers are now `Map`/`Set` plus the runtime-privileged `Node`. The quartet itself remains unimplemented; obligation 2 below carries the current route.)* Meanwhile the #128 ruling (FFI Part 1 §8.3) narrows a crossed `Vector`'s `.d.ts` face to the branded `Hex.Vector<a>`, removing the array member access TypeScript consumers see today — access that is accidentally honest only while the representation remains a plain array, and that would make Collections Part 3's decided trie a breaking change (Part 1 §8.3). The narrowing therefore lands ahead of its named migration path, and shipping `Vector.toArray` as a declaration whose body throws a new `NotImplemented` exception was proposed as the interim (James, 2026-08-02) and retracted by him the same day. This section rules the interim.

> **A shipped Hexagon-owned operation exists when it works. Until `Vector.toArray` can be implemented exactly as §9 specifies, it is absent — no declaration, no export, no `.d.ts` entry, no reserved stub that typechecks and throws. The same rule governs the rest of this quartet, Part 10's conversions, and Hexagon-owned shipped surface generally: declared-but-throwing stubs do not ship.**

Grounds:

- **The type system is the contract of record, and "typechecks" must mean "can run."** The defect #128 removes from the `.d.ts` faces is precisely a promise the runtime denies — `map.get(k)` typechecking and throwing (Part 1 §8.4 item 1). A stub reproduces that defect deliberately, relocating it from the faces into the operations, and worsens its position: the lie is discovered at first execution instead of at the typecheck. Absence fails at compile time on an existing, truthful message, and keeps failing that way until the operation ships. That message is the resolver's — ``module `Vector` does not export `toArray` `` — since the `Vector` milestone: `Vector` is an ordinary prelude module, the checker's companion rows are gone, and an unknown operation is an unknown export, everywhere. (An earlier form of this passage assigned the message to the checker's companion-operation row, correcting a still-earlier draft the other way; both passes' texts have now each had their turn being the right answer, and the resolver's is the one that survives the milestone.) **No new diagnostic is introduced; the Rewrite Rule is not engaged.**
- **The migration target is nameable without a symbol.** §9 fixes `Vector.toArray`'s name, signature, and complete semantics (eager, fresh, shallow, total; §6.2 stability). The spec is the forward contract; when the operation ships it appears whole, under the contract already written. Nothing a throwing declaration could "reserve" is left unreserved.
- **A blessed `NotImplemented` would misuse the exception system.** Exceptions §1's first doctrine reserves exceptions for the failures that *cannot* be anticipated at a call site; an unconditional throw-on-entry is the most anticipatable failure possible. The declared family — `IndexError`, `SliceError`, `KeyError`, `DivideByZeroError`, `ReentrancyError` — are data- or state-dependent faults Hexagon machinery detects in otherwise-working programs. A build-state marker is a different kind of thing and joins no such family. (Under #234 the throw would also be observable but unhandleable — and the defense "acceptable, since working code never reaches it" concedes that no working code needs the symbol, which is exactly the case for absence.)

**Scope of the doctrine.** "Shipped Hexagon-owned surface" means the stdlib, prelude, and runtime modules the toolchain ships, and its compiler-provided operations — everything a consumer of the toolchain can call. It does not govern user code (users may stub their own libraries however they please), nor development-time scaffolding that never reaches a release: a fixture, harness, or unreleased branch may hold whatever placeholder its author likes, and the fence is the release artifact — nothing a published toolchain installs or emits may contain a stub this section forbids.

**No carve-out for unshipped specification.** An earlier draft of this section added one — a rule that the doctrine governs "callable surface, not semantic content", exempting instance members no v1 program could name — to reconcile §9.1's build-state finding with §8.1's member binding (`toSeq` = `Array.toSeq`). **It is withdrawn, and nothing replaces it.** The exemption was unnecessary and unsound: unnecessary because a Decided spec's contracts are not claims about the current build and need no exemption to outrun it (§8.1); unsound because its own narrowing predicate was false — a provided row's member *is* callable at concrete types (Collections Part 2 §7.2, Part 5 §2.3) — and because at least three further provided rows (`String`, `JsMap`, `JsSet`) would have needed the same exemption, from documents this part has no authority over. A doctrine reading *shipped means it works* must have no exception clause a later author can widen; this one had one, and it is gone. §8.3's suite membership, which names callables that do not exist, is decided-but-unshipped and says so plainly instead.

**Price, stated plainly.** Until the conversions ship, the JavaScript surface of a crossed `Vector` after #128 is iteration, spread, and `Array.from` — guaranteed by the face extending its iterable protocol (Part 1 §8.2) — plus whatever the Hexagon author exports by hand. There is no named conversion; nothing in emitted `.d.ts` or editor completion reveals that one is planned; and a TypeScript consumer cannot write a `toArray` call that compiles now and lights up later. This **confirms** Part 1 §8.3's interim-surface statement as written.

**Order of shipping, per James (2026-08-02): outbound before inbound.** `Vector.toArray` — the direction that *produces values for JavaScript*, and the direction #128's narrowing exposes — ships first, tracked as issue #238. **This is a one-item priority, not a two-way partition of the quartet** — a correction to an earlier draft, which called `Array.toSeq`/`Array.fromSeq`/`Array.toVector` "the inbound half … motivated by pulling foreign data in". By this section's own criterion that is wrong of `Array.fromSeq : Seq(a) -> Array(a)`, which eagerly builds a fresh JavaScript array and so runs outbound, alongside `Vector.toArray`; only `Array.toSeq` and `Array.toVector` pull foreign data in. What James's ordering fixes is that `Vector.toArray` goes first, because #128's narrowing exposes that direction; the other three follow, separately motivated, deliberately not gated on #128 and not filed alongside #238. Their obligation sources differ and are worth keeping straight: Collections Part 5 §1's suite doctrine obliges the `toSeq`/`fromSeq` **pair**, while `Array.toVector` is owed instead to a live corpus dependency — Pattern Matching §11.1 directs users to "convert with `Array.toVector`". Part 10's `Map.toJsMap`/`Set.toJsSet` are outbound but additionally gated on `Map.hex`/`Set.hex` existing at all (no such modules yet); their internal order is Part 10's business. Ordering is scheduling, not design: every §9 contract, and every corpus reference to these names while unshipped (e.g. Pattern Matching §11.1's "convert with `Array.toVector`"), remains the normative design.

**Conformance obligations on the eventual implementation** (fixed here so shipping requires no re-deciding):

1. `Vector.toArray` ships implemented exactly per §9 — eager, fresh JS array, shallow, total, stable while exclusively held (§6.2) — exported from `stdlib/Vector.hex`, the companion home.
2. The mechanism is the intrinsic door, and its gate is open. `stdlib/Vector.hex` is a prelude member — the `Vector` milestone (`intrinsics.md` §3.2, §9.2) — so a `"hex:intrinsic"` block is legal there (`intrinsics.md` §5.2), and the module already declares its seven boundary operations through it; `vectorToArray` is one more flat-inventory key in that block. The routes an earlier form of this obligation weighed while the gate was shut are gone with it: `Vector`'s `CollectionOperation` rows and the public-name door were removed at the milestone, so there is no wrapper shape left to extend. The *family* is still not scheduled for retirement — `Node` outlives the four companions in it, and whether a one-member family is the intended terminus is #223.
3. Its `.d.ts` face follows Part 1 §4.1's `Array(a)` row as it stands at ship time (currently `ReadonlyArray<a>`; #228, the conformance defect once open on that row, was fixed 2026-08-04 (`0134ce1`) — the emitter now writes the decided face). This section adds no face rule.
4. Partial shipping is excluded: the operation appears with its full §9 contract or not at all.

**Discoverability.** The boxed rule reaches Hexagon-owned shipped surface generally, but it is written in a document titled for `Nullable(a)` and borrowed `Array(a)`, where nobody proposing a stub elsewhere would look. `stdlib-roadmap.md` §1 — the binding-doctrine table every listing decision passes through — therefore carries a pointer row to this section, owned here. Any future consolidation that gives shipped-surface doctrine a home of its own inherits the rule unchanged and retires the pointer.

**Ledger.** This section discovers stdlib debt — the §9 quartet is specified and unimplemented — and `stdlib-roadmap.md` rule 1 makes that ledger's row mandatory and exclusive ("no other ledger exists"). The row is added there by this ruling, in §2 (v1 obligations), carrying the order and the absence rule. The reconciling reading, and the one this ruling works to — neither file's self-description is chosen here — is that `ffi.md` §9.1 is the FFI spec's local index into that ledger rather than a competing one, and it gets a mirror entry. The conflict itself is recorded, not resolved, under `stdlib-roadmap.md` rule 5; that file's consolidation pass owns the final wording.

> **Edit note (for FFI Part 1 §8.3/§8.4 — DISCHARGED 2026-08-03; retained as the record, nothing to re-apply):** no *corrective* change was required — this note records verification. §8.3's interim-surface bullet ("v1 interim surface … iteration plus author exports, named conversions unshipped, spread as the universal rewrite") and §8.4 item 1's price were tested 2026-08-02 against a live proposal to ship `Vector.toArray` declared-but-throwing, and they stand as written; the proposal is rejected at §9.2 item 1 here. The one cross-reference this note directed — "(shipping doctrine and order: Part 2 §9.1)" — was added to §8.3's interim-surface bullet once both rulings landed (PRs #239, #240).

> **Edit note (for `ffi.md` §9.1, applied on next touch):** add the §9 conversion quartet's implementation to the obligations list as a mirror of the `stdlib-roadmap.md` §2 row, carrying this section's order — outbound `Vector.toArray` first (issue #238); inbound later, separately motivated — and the absence-not-stubs rule (§9.1 here). Flagged, not directed: §9.1 there heads itself "global ledger", which reads against `stdlib-roadmap.md` rule 1's "no other ledger exists". This ruling has no authority over `ffi.md`'s heading and does not decide it — the roadmap's consolidation pass does. Note for whoever does: the index reading is an inference from rule 1 plus `stdlib-roadmap.md` §6's silence on FFI's *stdlib* half, not a statement §6 makes, so cite rule 1.

### 9.2 Rejected alternatives (do not re-litigate)

1. **A declared-but-throwing stub plus a blessed `NotImplemented` exception.** Proposed by James (2026-08-02) and retracted by him the same day — recorded here so #237's original text cannot revive it. Rejected on §9.1's grounds: it reproduces in the operation surface the exact defect #128 removes from the type faces; `NotImplemented` fails Exceptions §1 (a certain failure is not an exceptional one) and joins no declared-exception family; and under #234 the throw is observable but unhandleable. **Price of keeping it out:** no forward-compilable symbol — a TypeScript consumer cannot write `toArray` calls that compile today and work later; the plan is discoverable only from this spec, never from `.d.ts` or completion; and the real operation's eventual arrival is a surface addition consumers must revisit rather than a silent behavior upgrade under an existing name.
2. **Ship it implemented now** (sequence #128 behind the conversion, or rush the conversion). Rejected: outside a ruling's power — this is the spec seat, not an implementing one — and against James's sequencing; #128 already ruled, deliberately, that the honest narrow face does not wait for the conversions (Part 1 §8.3). **Price of keeping it out:** the interim window is real and is borne by exactly the consumers the #128 narrowing takes member access from — they get spread/`Array.from` and nothing better until #238 lands.
3. **A recognized-but-unshipped diagnostic** (the compiler knows the name `Vector.toArray` and answers "specified but not yet available"). Rejected: it builds a shadow inventory of unshipped names, maintained by hand, that will drift stale — and it makes the compiler assert scheduling facts the spec owns. **Price of keeping it out:** the existing checker error teaches nothing about the plan; a user who found `toArray` in this spec learns from the diagnostic only that the companion has no such operation, and must return here to learn why and until when.

---

## 10. Diagnostics checklist

This part introduces **one new hard error** (the `.length` habit); everything else lands elsewhere and is only inherited:

| Situation | Owner |
|---|---|
| Adapter-requiring type nested inside `Array(a)` or any direct aggregate | Part 1 §5.3 (hard error with named rewrite) |
| Extern declaration syntax around `Nullable` slots (fixed arity, optional-parameter modeling) | Part 4 |
| Attempted mutation of `Array(a)` | not a diagnostic — no such operation exists to misuse (§6.1) |
| Bare property read `.length` on an `Array(a)` (the JS/TS habit) | this part, §6.3 — specialized hard error naming both rewrites: canonical `Array.length(xs)`, minimal `xs.length()`; the fault is the field spelling, not the word (§13.1). The call form `xs.length()` is not an error — companion dispatch. |
| Out-of-bounds `xs[i]`/`at`; directed slice window | not compile diagnostics — runtime `IndexError`/`SliceError` per Collections Part 3's doctrine (§6.3) |
| Calling an unshipped §9 conversion (`Vector.toArray` today) | not a new diagnostic — the ordinary resolver error, ``module `Vector` does not export `toArray` ``, deliberately (§9.1: absence, never a stub; Rewrite Rule not engaged). Since the `Vector` milestone, `Vector` is an ordinary prelude module and an unknown operation is an unknown export, everywhere |

---

## 11. Open questions

None. The three blockers this draft originally recorded were resolved by James and Sol and are now normative in this document: `Nullable` idempotence (§2.1), the `Array` accessor surface (§6.3), and the sparse-array/`Nullable` interaction (§6.4).

---

## 12. Decisions log (quick reference)

| Decision | Where |
|---|---|
| Two explicit foreign doors; no ambient nullability or mutation; no unqualified nullish literals | §1 |
| `Nullable(a)` = zero-wrapper `a \| null \| undefined`; carrying preserves the null/undefined distinction | §2.1 |
| `Nullable.null` / `Nullable.undefined` — qualified, typed, `Nullable(a)`-only | §2.2 |
| `isNullish`/`isNull`/`isUndefined` return `Bool`; no flow narrowing; narrowing reserved for a type-system deep dive with `toCase` as the comparison datum | §2.3, §2.5 |
| `NullableCase(a) = Undefined \| Null \| Value(value: a)`; `toCase` is the exact exhaustive reading | §3 |
| All `NullableCase` constructors are qualified-only through the companion; no bare prelude auto-import; representations unchanged | §3; FFI Part 12 §12 |
| `toOption` collapses both absences to `None`; `fromOption` → `undefined`; `fromOptionOrNull` → `null` | §4 |
| Supersedes Unions §8's `Option.fromNullable`/`Option.toNullable`; edit note issued | §5 |
| `Array(a)` = zero-copy readonly borrowed view; `ReadonlyArray<a>` face; no mutation surface | §6.1 |
| Stability contract covers deferred traversals; escaped `Seq` extends the borrow; fresh arrays stable while exclusively held | §6.2 |
| Live and snapshot iteration observationally identical under the contract; iteration never copies to enforce the contract | §6.5 |
| Accessor surface: `length`, 1-based read-only `[]` (throws `IndexError`), `at` (signed), `get` (`Option`), eager shallow clamping slices returning fresh JS arrays; no mutation; `.length` gets a specialized diagnostic naming `Array.length` | §6.3 |
| `Nullable` is definitionally idempotent over the closed designated nullish-absorbing set: `Nullable(Nullable(a)) ≡ Nullable(a)` and `Nullable(JsValue) ≡ JsValue`; no structural nullish analysis | §2.1; FFI Part 11 §8 |
| `Array(Nullable(a))` admits sparse arrays; holes observe as `Nullable.undefined`; no presence distinction, no scanning; a hole under a non-nullable element type is a Part 1 §3.1 contract violation | §6.4 |
| Native iteration needs no closing protocol | §7 |
| `Iterable<Array(a)>`: `Item = a`, member `toSeq` = `Array.toSeq`; native `for...of` emission; suite membership — Collections Part 5 §6 discharged | §8 |
| *(2026-08-02, #237 ruling)* The row above **does not oblige a public symbol spelled `Array.toSeq`**, and §9.1's build-state finding therefore does not falsify it: a Decided spec's instance row states design, not the current build, exactly as §9's four unimplemented contracts do; `Array` iteration emits native `for...of` through no member (§8.2). Part 5 §6's discharge stands. §8.3's suite membership, which *does* name callables, is **decided but unshipped** and now says so. **Explicitly not claimed** (an earlier draft did, wrongly): that a provided row's `toSeq` is uncallable — it is callable at concrete types, Collections Part 2 §7.2 and Part 5 §2.3's `toSeq("abc")`; and that `Array` is special — `Iterable<String>` binds the equally unsupplied codepoint member | §8.1, §8.3 |
| `Array.toSeq` lazy zero-copy; `Array.fromSeq`/`Array.toVector`/`Vector.toArray` eager and fresh; all shallow | §9 |
| `Array.size` renamed `Array.length` (Collections Part 1 §10.1); the `.length` diagnostic re-charactered — grammar, not vocabulary; `xs.length()` is companion dispatch and compiles; the diagnostic names both rewrites, canonical first | §6.3, §13.1 |
| *(2026-08-02, #237 ruling)* Shipped Hexagon-owned surface carries no declared-but-throwing stubs: an operation that cannot yet be implemented is absent — no declaration, no export, no `.d.ts` entry — and the spec is the forward contract; §9's quartet is currently unshipped (verified); interim JS surface of a crossed `Vector` = iteration/spread/`Array.from` + author exports, confirming Part 1 §8.3; no new diagnostic, Rewrite Rule not engaged; outbound `Vector.toArray` ships first (#238) — a one-item priority, not a partition, since `Array.fromSeq` is outbound too — the other three later and separately motivated, Part 10's doors gated on `Map.hex`/`Set.hex`; implementation obligations fixed (contract per §9, companion home, intrinsic-door route designed but gated on standard-library-source privilege (§9.1 obligation 2), no partial shipping); **no carve-out**: the "callable surface, not semantic content" exemption an earlier draft added is withdrawn unreplaced, as unnecessary and unsound, leaving the doctrine without an exception clause; the debt's ledger row is `stdlib-roadmap.md` §2 under that file's rule 1, with `ffi.md` §9.1 a mirror index and the two files' "global ledger" claims recorded under rule 5, not chosen | §9.1 |
| *(2026-08-02, #237 ruling)* Rejected with prices: the declared-but-throwing stub + blessed `NotImplemented` (proposed and retracted by James; a build-state marker is not a runtime fault — Exceptions §1 — and joins no declared-exception family; uncatchable besides, #234); implement-now sequencing; a recognized-but-unshipped diagnostic | §9.2 |

---

## 13. Correction records

### 13.1 The 2026-08-02 rename: `Array.size` → `Array.length`, and what the `.length` diagnostic now teaches

Collections Part 1 §10.1 (James, 2026-08-02) restated the naming doctrine's cardinality reader as a general word with a linear specialization: `size` in general (`Map`, `Set`, any non-linear collection), **`length` for linear, ordered structures** — `String`, `Seq`, `Vector`, and this part's `Array`, by James's explicit amendment. `Array.size` is renamed `Array.length` throughout this part (§6.3's surface block and emission bullet, §10's table, §12's summary row).

**The diagnostic survives the rename — ruled here, because the mechanical edit changed its character and the July text no longer justified it.** As decided in July, the specialized error taught vocabulary: "your JS habit says `.length`; the Hexagon name is `Array.size`." That lesson no longer exists — the word is the same on both sides. Three facts replace it, and §6.3 now states them:

1. **The error's subject is surface grammar, not vocabulary.** `Array(a)` is a nominal foreign view with no field surface; a bare property read fails on any nominal type, and this diagnostic is the door-specific, better-worded instance of that uniform rule — kept specialized because `.length` is the single most-typed reflex the door meets. Its message must explain the absence of fields and name the companion call; a message implying the *name* is wrong would now be false, and the Rewrite Rule requires the fixit to be comprehensible to someone who already typed the right word.
2. **The call form `xs.length()` stopped being an error entirely.** `Array(a)` is an eligible dot-call receiver (Method Syntax §5: extern/prelude nominal types), and `Array.length` is an exported subject-first companion operation (§4.2 there), so the fused form is ordinary companion dispatch resolving to `Array.length(xs)`. Before the rename it failed — no companion operation named `length` existed. Beyond the rename itself (which removes `Array.size` and the dot spelling `xs.size()` exactly as any rename removes the old name), this is the only change in what compiles, and it is a widening: a TS-habituated author who adds parentheses now simply has working code. **Consequence for the fixit, resolved here:** the cheapest local rewrite of the rejected `xs.length` is now that one-character edit, and the Rewrite Rule is not served by a message that withholds the cheapest fix while mandating a costlier one. The diagnostic names **both** legal spellings: `Array.length(xs)` first — the qualified form is the canonical spelling everything elaborates to (Method Syntax §1), and leading with it keeps the message teaching what the dot form *means* — and `xs.length()` as the minimal edit, per Method Syntax §6's precedent of offering each legal spelling in a fused-form diagnostic.
3. **The emission coincidence is principled.** `Array.length(xs)` emits `xs.length` (§6.3), so the diagnostic tells a user who wrote `xs.length` to write the form that *emits* `xs.length`. That is correct, not absurd, and the message wording must survive it: the rejected spelling is Hexagon property-read syntax against a nominal type; the mandated one is a Hexagon companion call; that the two meet in the emitted JavaScript is the zero-cost door doing its job.

**Rejected alternative (do not re-litigate): dropping the specialized diagnostic in favor of the generic machinery.** Post-rename, the demanded field's name matches an exported companion operation, which is exactly the key Method Syntax's nominal-fails-row enrichment fires on — so the generic path could now arguably produce a serviceable message. Rejected: that enrichment's mandated wording explains an *inferred row* ("its type was unknown"), the wrong story for a receiver whose type is known to be `Array(a)`; and the frequency of the TS reflex at this door earns a tuned message under the Rewrite Rule. The specialized error remains this part's, with the §6.3 character.
