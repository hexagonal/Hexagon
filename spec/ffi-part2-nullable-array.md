# Hexagon FFI Part 2: `Nullable(a)` and Captured `Array(a)`

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing; §6.3 amended 2026-08-02 — `Array.size` is renamed `Array.length` under Collections Part 1 §10.1, and the `.length` diagnostic is re-charactered, see correction record §13.1. Amended 2026-08-02 (#237 ruling): §9 gains its shipping doctrine — an unshipped conversion is absent, never a declared-but-throwing stub; outbound `Vector.toArray` ships first — §9.1; rejected alternatives, including James's retracted `NotImplemented` interim, §9.2. The same amendment reconciles §8 with §9.1's finding of fact, on the ordinary ground that a Decided spec's rows are design statements rather than reports on the build: §8.1's `Iterable<Array(a)>` row does not oblige a public symbol spelled `Array.toSeq`, so Collections Part 5 §6's discharge stands, while §8.3's suite membership — which does name callables — is marked decided-but-unshipped. The debt's ledger row is `stdlib-roadmap.md` §2. Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §2 and the §4 `Nullable` package, drafted per `spec/notes/ffi-roadmap.md` Part 2. The three questions the draft recorded as promotion blockers (`Nullable` idempotence, §2.1; the `Array` accessor surface, §6.3; sparse arrays, §6.4) were resolved by James and Sol before promotion. Reads Part 1 (`ffi-part1-boundary.md`) for the category vocabulary and failure doctrine; restates neither. **Amended (#876): `Array(a)` moves from the borrowed foreign view to the captured foreign collection** (Part 1 §2.2) — §6 is rewritten around the snapshot taken at acquisition, the stability contract and the live-equals-snapshot license it grounded are retired, and the correction record is §13.2; `JsMap`/`JsSet` follow separately under #875 and are still borrowed views until then.
**Scope:** The two explicit foreign doors this part owns. `Nullable(a)`: the raw `a | null | undefined` representation, definitional idempotence (§2.1), the qualified values `Nullable.null` and `Nullable.undefined`, the inspection predicates, `NullableCase(a)` and `Nullable.toCase`, and the `Option` conversions — including the supersession of Unions §8's provisional spellings (§5). `Array(a)`: the readonly captured collection — Hexagon's snapshot of a foreign array, taken at the crossing — the capture contract and its cost (§6.2), the read-only accessor surface (§6.3), sparse arrays and holes (§6.4), observation semantics and native iteration emission (discharging Collections Part 5 §6's binding obligation), shallow element treatment, and the explicit conversions (`Array.toSeq`/`Array.fromSeq`/`Array.toVector`/`Vector.toArray`).
**Not in scope:** Optional/default parameters (Part 4 fixes the fixed-arity rule; callers model explicit nullish slots with the §2.2 values). TypeScript-style flow narrowing (reserved for a separate type-system deep dive; §2.5 records the reservation and the preferred alternative). `Seq(a)` adaptation mechanics (Part 3 — `Array.toSeq`'s result is a `Seq`, whose semantics live there). Foreign `JsMap`/`JsSet` (Part 10 — borrowed views until #875 migrates them to the captured category this part now instantiates). `JsValue` and checked decoding (Part 11).
**Companions:** Part 1 §2–§5 (categories, failure doctrine, shallow conversion, `Hex` namespace); Unions §8 (`Option`; provisional conversion spellings superseded here, §5); Primitive Types §9 (`Unit` is unrelated to nullability); Collections Part 5 §6 (the `Iterable<Array(a)>` obligation, discharged in §8); Collections Part 5 §1 (the finite-collection conversion suite); Loops/Ranges/Iteration §6 (`Seq`).

---

## 1. Doctrine

JavaScript has two pervasive shapes with no honest Hexagon equivalent: nullish values and mutable arrays. Each gets exactly one explicit foreign door, and neither leaks into ordinary Hexagon:

> **`Nullable(a)` is the explicit nullish door: a zero-wrapper boundary type whose value is `a | null | undefined`. `Array(a)` is the explicit array door: a readonly JavaScript array that Hexagon captures at the crossing and owns — a snapshot of the foreign array, sharing no storage with it. `Nullable(a)` is representation-direct at the boundary. `Array(a)` is a captured foreign collection (Part 1 §2.2): copied as it crosses, in both directions, and stable because nothing foreign can reach the copy. Neither admits ambient nullability or mutation into Hexagon.**

- There are **no unqualified `null` or `undefined` literals** in ordinary Hexagon source; the nullish values exist only as the qualified, typed companions of §2.2.
- `Option(a)` is never erased to nullability (Part 1 §4; Unions §8's pre-registered rejection). `Nullable` is where JS nullishness lives, and the conversion between the two worlds is explicit (§5).
- `Array(a)` is **not a Hexagon-owned persistent collection** and has no mutation operations. (It does join the finite-collection conversion suite, §8.3 — suite membership is about `toSeq`/`fromSeq` vocabulary, not ownership.) The persistent workhorse remains `Vector(a)`; `Array` exists so bindings can accept and return real JavaScript arrays in their native shape — `ReadonlyArray<a>` on the face, a plain array underneath, O(1) native indexing — at the price of one linear copy per crossing (§6.2). A binding that cannot pay that copy, or needs the foreign array's identity or its live contents, binds an opaque extern handle with `->!` accessors instead (Part 1 §2.2): that is a foreign capability, and `Array(a)` is deliberately not one.
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
Nullable(T)           ≡ T        -- T a literal extern enum naming both null and undefined
```

The first equation applies through type aliases and generic substitution: there is no distinct doubly-nullable type for the zero-wrapper representation to misrepresent. Part 11 designates `JsValue` as a nullish-absorbing type because it already contains both `null` and `undefined`; Foreign Enums §2.4 designates a literal `extern enum` naming both `null` and `undefined`, because its own value set already holds both forms wrapping would add; an enum naming only one of the two is not designated, and writing `Nullable` over it is refused (Foreign Enums §2.4). At an absorbing `a` the §4 surface stays callable at `Nullable(a) ≡ a` and acts as the ordinary projection: `toOption` sends the type's own nullish values to `None`, and `fromOption(None)` yields `undefined`, a value of the type. The designation list is explicit and closed; the checker performs no general structural “contains nullish” analysis over arbitrary unions or opaque foreign types.

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

All three constructors are qualified-only in the prelude inventory: `NullableCase.Undefined`, `NullableCase.Null`, and `NullableCase.Value(value)` in expressions and patterns. They are not auto-imported as bare prelude terms — the prelude's default for every union but the three open ones (Modules §5.5); `ffi.md` §12 records the first case. This is ordinary companion qualification and does not change their runtime representations (Part 12 §12).

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

## 6. `Array(a)`: the captured foreign collection

### 6.1 What it is

`Array(a)` is a **captured foreign collection** (Part 1 §2.2): a JavaScript array that Hexagon holds as its own **snapshot** of the foreign array that crossed. Foreign code keeps its original and may do what it likes with it; the Hexagon value is a different array, made at the crossing, that no foreign code can reach. Hexagon provides **no mutation operations** on `Array(a)` — it is readonly *from Hexagon*, full stop — and its `.d.ts` face is:

```ts
ReadonlyArray<a>
```

Element types obey Part 1 §5.2's recursive representation contract: `Array(Int)` asserts a JS array of safe integers (never scanned, per the zero-scan rule — the copy carries each element, it does not inspect it); `Array(Vector(Int))` asserts a JS array of genuine runtime Vector values, faced as `ReadonlyArray<Hex.Vector<number>>`, and the copy holds those very `Vector` values by identity. `Array(Array(Int))` is captured layer by layer — the outer copy holds inner copies (Part 1 §5.4). An adapter-requiring element type (`Array(Seq(Int))`) is rejected by Part 1 §5.3, and an `Array` beneath an identity-crossing container (`Vector(Array(Int))`) by Part 1 §5.4 item 1.

### 6.2 The capture contract

> **An `Array(a)` value is captured at acquisition: the array Hexagon holds is a fresh copy of the foreign array, made as it crossed, and it never changes. Foreign mutation of the original after the crossing is not observable through the Hexagon value, its slices, its `length`, or any sequence derived from it. A later acquisition may yield a different value — and a row that writes `->` is asserting that it will not (Part 4 §4.5; Effects §6.2 species (c); Part 1 §5.4).**

- **Where the capture happens** is Part 1 §5.4's position table, not restated: every declared boundary position at which the walk reaches the `Array` — an extern result or argument, an `extern let` once at initialization, a receiver member's slots, an exported function's parameters and result through its stable export wrapper, a callback's slots at each invocation — and, not declared positions but running the same walk, the two named operations `JsValue.from` (out) and `JsValue.toArray` (in). The copy runs in **both directions**: an `Array` handed *to* foreign code is a fresh array too, so the value Hexagon retains cannot be reached by the code that received it. A Hexagon-to-Hexagon call never copies — two Hexagon functions passing an `Array(Int)` share one value, as they share a `Vector`.
- **What the copy is.** A fresh JavaScript array with the source's `length`, each index read exactly once in index order through native array access, each element carried through the walk at `a` — by identity for every type but a captured collection or a function that names one (Part 1 §5.4). Holes are §6.4's business; the copy is dense, and the traversal is iterative, never dependent on recursion depth (Part 1 §5.4). The emitter's spelling of the copy is its own (`slice`, `Array.from`, an indexed loop); the access pattern above is the contract, because an exotic array object can observe it.
- **Cost.** Linear in `length`, plus the element walk, at every crossing — stated here as Part 1 §5.4 requires, and accepted as the price of the guarantee. Accessing the captured value afterwards is the native cost of a native array: `length`, `xs[i]`, `at`, and `get` are O(1) and slicing is O(k), and the compiler may share or hoist any of them freely, since a value has no fresh-read rule.
- **Effects.** The copy performs none of its own. The acquisition is coloured by the row that performs it (Part 4 §4.5): an unannotated extern row is `->!`, and a `->` row returning an `Array(Int)` is the author's separate claim that the foreign source does not vary between calls (Part 1 §5.4) — the acquisition is what Effects §6.2 species (c) licenses; the row's result is then a value by capture, its reads afterwards are ordinary pure reads of a Hexagon value needing no species, and nothing about the value's later use is coloured by how it was acquired.
- **Stability during capture; identity.** A hostile getter or proxy trap that throws during the copy follows the ordinary `JsError` path (Part 1 §7) out of the frame performing the crossing; a foreign mutation that races the copy — a trap that mutates the array being read — leaves *that acquisition's* contents unspecified (Part 1 §3.1) and nothing else. A captured array has no identity relation to its source and none to any other capture of the same source: two acquisitions are two values, a round trip out and back is two copies, and nothing is cached. `IndexError`'s `size` slot and `Array.length` report the captured array's length, which is the source's length at the moment of capture.
- **Fresh arrays Hexagon makes** — a slice (§6.3), `Array.fromSeq`, `Vector.toArray` (§9) — are captured values from birth: made by Hexagon, held by Hexagon, unreachable from foreign code until they cross, at which point they are copied like any other. There is no "stable while exclusively held" clause any more, because every `Array(a)` value is exclusively held, always.
- **The dated exception.** Until #875 lands, an `Array(a)` extracted from a borrowed `JsMap(k, Array(a))` or `JsSet(Array(a))` is the one `Array` value the walk did not make: the borrowed map is a container the walk does not enter (Part 1 §5.4), so that array is the live foreign one, held still by Part 10 §2's borrow obligation for as long as Hexagon retains it rather than by this contract (Part 1 §2.2). Every other `Array(a)` value is a capture, and #875 closes the exception.
- **What is not promised.** Nothing about the foreign original: the crossing reads it once and forgets it. A binding that wants the original — its identity, its current contents, zero-copy access — has the opaque extern handle (Part 1 §2.2), and this type is not it.

### 6.3 The accessor surface

`Array(a)` ships a read-only accessor surface aligned with `Vector`'s indexing doctrine (Collections Part 3 §5–§6 — brackets assert, names answer, windows have no direction). All observations are native reads of the captured array — reads of a value, which the compiler may share — except slicing, which is an explicit fresh construction:

```hexagon
Array.length : Array(a) -> Int
xs[i]                                 -- 1-based read-only; throws IndexError out of bounds
Array.at    : (Array(a), Int) -> a    -- signed from-end addressing; throws IndexError
Array.get   : (Array(a), Int) -> Option(a)
xs[lo..hi]                            -- eager shallow slice: a fresh JS array
```

- `xs[i]` is **1-based and read-only**; there is no assignment-to-index grammar, and no `set` exists. Out-of-bounds throws `IndexError` (Collections Part 3's declaration), asserting at the fault site.
- `at` and `get` carry their Vector contracts: `at` is the bracket's signed sibling (from-end addressing, throws), `get` answers with `Option`.
- **Slicing is eager and shallow and returns a fresh JS array** — a captured value from birth (§6.2), sharing no storage with the array it was cut from. Elements are preserved by value and identity (Part 1 §5.1); windows clamp, and a directed window throws `SliceError`, per the Vector window doctrine.
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

**`Array(Nullable(a))` admits sparse JavaScript arrays; a hole observes as `Nullable.undefined`.** No presence distinction exists: Hexagon cannot and does not distinguish a hole from a stored `undefined`, and no `has`-style accessor is added. No scanning is performed — the zero-scan rule is unchanged: the capture copy (§6.2) carries what each index reads without inspecting it, and stores an `undefined` where the source had a hole — the copy is dense in both directions (Part 1 §5.4), which Hexagon cannot observe and JavaScript, receiving an outbound copy, can.

A hole in an array declared with a **non-nullable** element type violates Part 1 §5.2's trusted element representation contract, with Part 1 §3.1's consequences (affected observations unspecified). This is the ordinary trusted-boundary reading, now stated rather than inferred: `undefined` is not a safe integer, a string, or any other non-`Nullable` representation, and the declaration asserted it would not appear.

### 6.5 Observation semantics: the value is the snapshot

**Every observation of an `Array(a)` — indexing, `length`, slicing, iteration, any `Seq` derived from it — observes the captured array, which is stable** (the one value that is not a capture, an array extracted from a borrowed `JsMap`/`JsSet` until #875, is stable under Part 10 §2's borrow obligation instead — §6.2). This is the resolution of the observation-semantics question Collections Part 5 §6.1 deliberately left to this spec, and it is now the plain one: there is nothing live to observe. Iteration copies nothing *at iteration time* because the copy was made at the crossing; a `Seq` derived from the array may be forced a year later and sees the same elements.

Consequently, **native `for...of` emission is permitted and preferred** (§8.2), because a native array iterator over an array nobody else can reach is a traversal of a value. `Array.toVector` remains the conversion into persistent storage for callers who want `Vector`'s operations (§9); it is no longer an escape from anything.

---

## 7. Native iteration needs no closing protocol

Native array iteration requires no special closing operation. A loop-body throw propagates normally; JavaScript Array iterators own no external resource requiring deterministic `return()` cleanup. (Contrast Part 3's rules for foreign iterators behind `Seq`, where closure is a real question — none of that machinery applies to the captured array, which is Hexagon's own.)

---

## 8. The `Iterable` instance: discharging Collections Part 5 §6

### 8.1 The row

This document declares the row Collections Part 5 §6.1 pre-committed:

> **`Iterable<Array(a)>` holds, with `type Item = a`; its member `toSeq` is §9's `Array.toSeq`.**

`for x in arr` therefore resolves by the ordinary Collections Part 5 §3 algorithm; the direction (the foreign door is iterable) was decided there and is not reopened here. The row's *meaning* is §6.5's: iteration traverses the captured array, a stable value.

**The row does not oblige a public symbol of that spelling** *(added 2026-08-02, #237 ruling)*. §9.1 finds that `Array.toSeq` does not exist in the shipped toolchain. That finding does not falsify this row, and the reason is the ordinary one: **this document is Decided, and a Decided spec's instance row is a statement of design, not a report on the current build.** An unshipped compiler no more falsifies §8.1 than it falsifies §9's four conversion contracts, which are equally unimplemented and equally normative. **The word doing the work is *absent*, and the boundary is sharp:** an implementation that **contradicts** a Decided row is a conformance defect (`spec/notes/compiler-conformance-defects.md` — *"an existing language decision was correct and the compiler diverged from it … the correction restores conformance"*), never a licensed divergence. Nothing in this paragraph excuses a divergence; it addresses only a row the build has not reached. The member binding fixes what iterating an `Array` *means* — the element type and the traversal — and names the operation (§9's `Array.toSeq`) that will realize it; it does not oblige the compiler to route through a symbol of that spelling, and today the compiler does not: §8.2's native `for...of` emission consults no member at all. **Collections Part 5 §6's discharge therefore stands.** What §9.1 finds unshipped is the *callable* `Array.toSeq`, which §8.3 and §9 name.

Two things this paragraph deliberately does **not** claim, both corrected out of an earlier draft that asserted them:

- **Not that a provided row's `toSeq` is uncallable.** It is callable. Collections Part 2 §7.2 preserves exactly this: *"Calling its function members at concrete types: legal — `toSeq(myBag)` … the same monomorphic dispatch every constraint member already has"*, and Part 5 §2.3 gives the provided-row case outright — `toSeq("abc") : Seq(String)`. The binder ban, the type-variable restriction, and the `.d.ts` exclusion each close a *different* path (polymorphic loop sites, generic signatures, foreign surface) and none closes the monomorphic direct call. `toSeq(arr)` is a legal shape, and since `stdlib/Iterable.hex` landed the member is the name's one bare exporter (Part 5 §2.3's sole-exporter bullet), so the call reaches exactly this row.
- **Not that this is special.** Nothing here is peculiar to `Array`. The same holds of `Iterable<JsMap(k, v)>` and `Iterable<JsSet(a)>` — FFI Part 10 §6 binds their members, and those rows waited only on the types having representations at all; with the types landed (#396) both rows were live in exactly this section's condition — `toSeq(jsMap)` discharging against the row while the *callable* `JsMap.toSeq`/`JsSet.toSeq` were still among Part 10's unshipped names — until the companions shipped (#792) and the qualified spellings reached the same member. A Decided row outrunning the build is the corpus's normal condition, not an exception needing a doctrine.

*(Bare `iterate` is unrelated — it is `Seq`'s seed/step producer, which keeps that name.)*

### 8.2 Emission

`for x in arr` over an `Array(a)` emits native JavaScript iteration:

```js
for (const x of arr) { ... }
```

This is legitimate precisely because of §6.5 — the array being iterated is Hexagon's own captured copy, so native iteration's JavaScript mutation-observation behavior has nothing to observe; Collections Part 5 §13.5 correctly refused to mandate this emission before the semantics existed. The decision record licenses exactly this: native `for...of`, permitted and preferred. Other emission strategies (e.g. direct indexed loops) are not licensed here — the copy made at the crossing is an ordinary array, so the ground is no longer that an exotic object could watch the access pattern, but one emission is still one emission: any widening of the license is a separate decision, not emitter discretion.

### 8.3 Suite membership

**`Array(a)` joins the finite-collection `toSeq`/`fromSeq` conversion suite** (Collections Part 5 §1), under exactly those names (§9). This closes the suite-membership question Part 5 left open.

**Membership is decided; the names are not yet shipped** *(added 2026-08-02, #237 ruling)*. Neither `Array.toSeq` nor `Array.fromSeq` exists today (§9.1's finding of fact). The difference from §8.1 is not doctrinal — neither section is exempt from §9.1, and §9.1 has no exemptions to give — it is that **§8.1's row has shipped behaviour under an unshipped member name, and this sentence names surface with no behaviour at all**: `for x in arr` compiles and iterates today (§8.2's native emission), whereas nothing whatever answers to `Array.toSeq`. Suite membership is nonetheless settled as design — no later document may reopen whether `Array(a)` belongs — and the names ship under §9.1's doctrine and order, never as stubs in the interim. Read "joins the suite, under exactly those names" as fixing *which* names discharge the membership, not as asserting that they are callable now.

---

## 9. The conversion surface

```hexagon
Array.toSeq    : Array(a) -> Seq(a)      -- lazy view over the captured array
Array.fromSeq  : Seq(a) -> Array(a)      -- eager, fresh JS array
Array.toVector : Array(a) -> Vector(a)   -- eager, stable persistent snapshot
Vector.toArray : Vector(a) -> Array(a)   -- eager, fresh JS array
```

- **`Array.toSeq` is lazy and allocates no copy**: it traverses the captured array, which is stable, so the sequence may be forced at any time and observes the same elements (§6.5). Everything about the resulting `Seq`'s persistence and memoization is Part 3's; nothing here adds to it, and no borrow is extended by holding it, because there is no borrow.
- **`Array.fromSeq` eagerly creates a fresh JavaScript array.** Consuming the sequence follows Part 3's rules (iterative traversal; an infinite `Seq` does not terminate).
- **`Array.toVector` eagerly creates a persistent `Vector`** of the same elements — the conversion into the persistent workhorse for callers who want its operations; both sides of it are stable values.
- **`Vector.toArray` eagerly creates a fresh JavaScript array** — a captured value from birth (§6.2), copied again when it crosses to foreign code.
- **All four are shallow** (Part 1 §5.1): they change only the collection named by the operation and preserve element values and runtime identities. `Vector.toArray : Vector(Vector(Int)) -> Array(Vector(Int))` — never `Array(Array(Int))`. Nested conversion is the caller's explicit map.
- All four are **converted** operations (Part 1 §2.4) with total, specified behavior on valid inputs; there is no checked failure mode. (These names supersede the FFI agenda's stale pre-rename `Array.toList`/`List.toArray` spellings, as Collections Part 5 §6.1 already recorded.)

### 9.1 Shipping doctrine: absent until implemented, outbound first *(added 2026-08-02, #237 ruling)*

**The finding this section answers.** As of this ruling, none of §9's four conversions is implemented, all verified against the tree: `stdlib/Vector.hex` exports no `toArray`; no `Array` companion operations exist at all (the resolver's compiler-provided collection qualifiers are `Map`/`Set`/`Vector` in ordinary source, plus the runtime-privileged `Node` (`intrinsics.md` §9.2; #223) — no `Array` among them — and there is no `Array.hex`); and the intrinsic inventory holds exactly `seqMemoize`. *(Since superseded in part: the `Vector` milestone landed — `stdlib/Vector.hex` is a prelude member declaring its `vector*` inventory keys through the intrinsic door, the resolver's one remaining compiler-provided qualifier is the runtime-privileged `Node`, and `stdlib/Array.hex` is itself a prelude member, exporting `length`, `get`, and now `toVector`. `Vector.toArray` has since shipped through that door, exactly as obligation 2 below routes it, and `Array.toVector` as ordinary Hexagon in `stdlib/Array.hex` — a `for` over the captured array folding `Vector.append`, which is what makes it expressible, so `stdlib-roadmap.md` §5.1 forbids the door; `Array.toSeq`/`Array.fromSeq` remain unimplemented.)* Meanwhile the #128 ruling (FFI Part 1 §8.3) narrows a crossed `Vector`'s `.d.ts` face to the branded `Hex.Vector<a>`, removing the array member access TypeScript consumers see today — access that is accidentally honest only while the representation remains a plain array, and that would make Collections Part 3's decided trie a breaking change (Part 1 §8.3). The narrowing therefore lands ahead of its named migration path, and shipping `Vector.toArray` as a declaration whose body throws a new `NotImplemented` exception was proposed as the interim (James, 2026-08-02) and retracted by him the same day. This section rules the interim.

> **A shipped Hexagon-owned operation exists when it works. Until a §9 conversion can be implemented exactly as §9 specifies, it is absent — no declaration, no export, no `.d.ts` entry, no reserved stub that typechecks and throws. The rule governed `Vector.toArray` and `Array.toVector` until they shipped, and governs the two `Seq` conversions still owed, Part 10's conversions, and Hexagon-owned shipped surface generally: declared-but-throwing stubs do not ship.**

Grounds:

- **The type system is the contract of record, and "typechecks" must mean "can run."** The defect #128 removes from the `.d.ts` faces is precisely a promise the runtime denies — `map.get(k)` typechecking and throwing (Part 1 §8.4 item 1). A stub reproduces that defect deliberately, relocating it from the faces into the operations, and worsens its position: the lie is discovered at first execution instead of at the typecheck. Absence fails at compile time on an existing, truthful message, and keeps failing that way until the operation ships. That message is the resolver's — ``module `Array` does not export `toSeq` `` today, and ``module `Vector` does not export `toArray` `` and ``module `Array` does not export `toVector` `` while those operations were unshipped — since the `Vector` milestone: `Vector` and `Array` are ordinary prelude modules, the checker's companion rows are gone, and an unknown operation is an unknown export, everywhere. (An earlier form of this passage assigned the message to the checker's companion-operation row, correcting a still-earlier draft the other way; both passes' texts have now each had their turn being the right answer, and the resolver's is the one that survives the milestone.) **No new diagnostic is introduced; the Rewrite Rule is not engaged.**
- **The migration target is nameable without a symbol.** §9 fixes `Vector.toArray`'s name, signature, and complete semantics (eager, fresh, shallow, total; §6.2 stability). The spec is the forward contract; when the operation ships it appears whole, under the contract already written — as `Vector.toArray` did. Nothing a throwing declaration could "reserve" is left unreserved.
- **A blessed `NotImplemented` would misuse the exception system.** Exceptions §1's first doctrine reserves exceptions for the failures that *cannot* be anticipated at a call site; an unconditional throw-on-entry is the most anticipatable failure possible. The declared family — `IndexError`, `SliceError`, `KeyError`, `DivideByZeroError`, `ReentrancyError` — are data- or state-dependent faults Hexagon machinery detects in otherwise-working programs. A build-state marker is a different kind of thing and joins no such family. (Under #234 the throw would also be observable but unhandleable — and the defense "acceptable, since working code never reaches it" concedes that no working code needs the symbol, which is exactly the case for absence.)

**Scope of the doctrine.** "Shipped Hexagon-owned surface" means the stdlib, prelude, and runtime modules the toolchain ships, and its compiler-provided operations — everything a consumer of the toolchain can call. It does not govern user code (users may stub their own libraries however they please), nor development-time scaffolding that never reaches a release: a fixture, harness, or unreleased branch may hold whatever placeholder its author likes, and the fence is the release artifact — nothing a published toolchain installs or emits may contain a stub this section forbids.

**No carve-out for unshipped specification.** An earlier draft of this section added one — a rule that the doctrine governs "callable surface, not semantic content", exempting instance members no v1 program could name — to reconcile §9.1's build-state finding with §8.1's member binding (`toSeq` = `Array.toSeq`). **It is withdrawn, and nothing replaces it.** The exemption was unnecessary and unsound: unnecessary because a Decided spec's contracts are not claims about the current build and need no exemption to outrun it (§8.1); unsound because its own narrowing predicate was false — a provided row's member *is* callable at concrete types (Collections Part 2 §7.2, Part 5 §2.3) — and because at least three further provided rows (`String`, `JsMap`, `JsSet`) would have needed the same exemption, from documents this part has no authority over. A doctrine reading *shipped means it works* must have no exception clause a later author can widen; this one had one, and it is gone. §8.3's suite membership, which names callables that do not exist, is decided-but-unshipped and says so plainly instead.

**Price, stated plainly.** While `Vector.toArray` was unshipped, the JavaScript surface of a crossed `Vector` after #128 was iteration, spread, and `Array.from` — guaranteed by the face extending its iterable protocol (Part 1 §8.2) — plus whatever the Hexagon author exported by hand. There was no named conversion; nothing in emitted `.d.ts` or editor completion revealed that one was planned; and a TypeScript consumer could not write a `toArray` call that compiled then and lit up later. That **confirmed** Part 1 §8.3's interim-surface statement as written. With `Vector.toArray` shipped, the named exit is the operation itself on `stdlib/Vector.hex`'s emitted face; a crossed `Vector`'s own face is unchanged.

**Order of shipping, per James (2026-08-02): outbound before inbound.** `Vector.toArray` — the direction that *produces values for JavaScript*, and the direction #128's narrowing exposes — shipped first (#238). **This is a one-item priority, not a two-way partition of the quartet** — a correction to an earlier draft, which called `Array.toSeq`/`Array.fromSeq`/`Array.toVector` "the inbound half … motivated by pulling foreign data in". By this section's own criterion that is wrong of `Array.fromSeq : Seq(a) -> Array(a)`, which eagerly builds a fresh JavaScript array and so runs outbound, alongside `Vector.toArray`; only `Array.toSeq` and `Array.toVector` pull foreign data in. What James's ordering fixes is that `Vector.toArray` goes first, because #128's narrowing exposes that direction; the other three follow, separately motivated, deliberately not gated on #128 and not filed alongside #238 — `Array.toVector` has since shipped. Their obligation sources differ and are worth keeping straight: Collections Part 5 §1's suite doctrine obliges the `toSeq`/`fromSeq` **pair**, while `Array.toVector` was owed instead to a live corpus dependency — Pattern Matching §11.1 directs users to "convert with `Array.toVector`" — a dependency its landing discharges. Part 10's `Map.toJsMap`/`Set.toJsSet` are outbound but additionally gated on `Map.hex`/`Set.hex` existing at all (no such modules yet); their internal order is Part 10's business. Ordering is scheduling, not design: every §9 contract, and every corpus reference to these names while unshipped (e.g. §8.3's suite membership naming `Array.toSeq`), remains the normative design.

**The prelude consequence of #876**, stated so the implementation is not the first place it is met: every exported function whose signature names `Array(a)` takes Part 7 §7 occasion 4's stable export wrapper under its public name, with Hexagon importers binding the internal edition — `stdlib/Array.hex`'s `length`, `get`, and `toVector`, and `stdlib/Vector.hex`'s `toArray`, among them. These are **public APIs**, and the wrappers are uniform: a JavaScript caller of `Vector.toArray` receives a copy of the fresh array the conversion built (§13.2 item 2's price, met here), and a JavaScript caller of `Array.length` pays a linear copy to read a length. The cost is documented, not excused by any assumption about who calls; Hexagon callers pay no boundary-wrapper copying cost — `Vector.toArray` still pays its own conversion. Copy elimination is governed by Part 1 §5.4's fence — only where the compiler proves the snapshot and alias-protection guarantees preserved, a fresh unaliased result such as `Vector.toArray`'s being a candidate and not an exemption by name — and no optimization is required and no wrapper bypass is introduced here.

**Conformance obligations on the implementation** (fixed here so shipping required no re-deciding; the shipped `Vector.toArray` discharges all four; obligation 4 and the boxed rule above reach `Array.toSeq` and `Array.fromSeq`, whose mechanism is theirs to settle; `Array.toVector` needed no door — an `Array(a)` has no Hexagon producer, but a `Vector(a)` has `append`, so its body is ordinary Hexagon in `stdlib/Array.hex` under `stdlib-roadmap.md` §5.1):

1. `Vector.toArray` ships implemented exactly per §9 — eager, fresh JS array, shallow, total, a captured value from birth (§6.2; "stable while exclusively held" before #876) — exported from `stdlib/Vector.hex`, the companion home.
2. The mechanism is the intrinsic door, and its gate is open. `stdlib/Vector.hex` is a prelude member — the `Vector` milestone (`intrinsics.md` §3.2, §9.2) — so a `"hex:intrinsic"` block is legal there (`intrinsics.md` §5.2), and the module declared its seven boundary operations through it before this one; `vectorToArray` is the eighth flat-inventory key in that block. The routes an earlier form of this obligation weighed while the gate was shut are gone with it: `Vector`'s `CollectionOperation` rows and the public-name door were removed at the milestone, so there is no wrapper shape left to extend. The *family* is still not scheduled for retirement — `Node` outlives the four companions in it, and whether a one-member family is the intended terminus is #223.
3. Its `.d.ts` face follows Part 1 §4.1's `Array(a)` row as it stands at ship time (currently `ReadonlyArray<a>`; #228, the conformance defect once open on that row, was fixed 2026-08-04 (`0134ce1`) — the emitter now writes the decided face). This section adds no face rule.
4. Partial shipping is excluded: the operation appears with its full §9 contract or not at all.

**Discoverability.** The boxed rule reaches Hexagon-owned shipped surface generally, but it is written in a document titled for `Nullable(a)` and captured `Array(a)`, where nobody proposing a stub elsewhere would look. `stdlib-roadmap.md` §1 — the binding-doctrine table every listing decision passes through — therefore carries a pointer row to this section, owned here. Any future consolidation that gives shipped-surface doctrine a home of its own inherits the rule unchanged and retires the pointer.

**Ledger.** This section discovers stdlib debt — the §9 quartet is specified and, but for `Vector.toArray` and `Array.toVector`, unimplemented — and `stdlib-roadmap.md` rule 1 makes that ledger's row mandatory and exclusive ("no other ledger exists"). The row is added there by this ruling, in §2 (v1 obligations), carrying the order and the absence rule. The reconciling reading, and the one this ruling works to — neither file's self-description is chosen here — is that `ffi.md` §9.1 is the FFI spec's local index into that ledger rather than a competing one, and it gets a mirror entry. The conflict itself is recorded, not resolved, under `stdlib-roadmap.md` rule 5; that file's consolidation pass owns the final wording.

> **Edit note (for FFI Part 1 §8.3/§8.4 — DISCHARGED 2026-08-03; retained as the record, nothing to re-apply):** no *corrective* change was required — this note records verification. §8.3's interim-surface bullet ("v1 interim surface … iteration plus author exports, named conversions unshipped, spread as the universal rewrite") and §8.4 item 1's price were tested 2026-08-02 against a live proposal to ship `Vector.toArray` declared-but-throwing, and they stand as written; the proposal is rejected at §9.2 item 1 here. The one cross-reference this note directed — "(shipping doctrine and order: Part 2 §9.1)" — was added to §8.3's interim-surface bullet once both rulings landed (PRs #239, #240).

> **Edit note (for `ffi.md` §9.1 — DISCHARGED at #238, applied on that touch; retained as the record, nothing to re-apply):** add the §9 conversion quartet's implementation to the obligations list as a mirror of the `stdlib-roadmap.md` §2 row, carrying this section's order — outbound `Vector.toArray` first (issue #238); inbound later, separately motivated — and the absence-not-stubs rule (§9.1 here). Flagged, not directed: §9.1 there heads itself "global ledger", which reads against `stdlib-roadmap.md` rule 1's "no other ledger exists". This ruling has no authority over `ffi.md`'s heading and does not decide it — the roadmap's consolidation pass does. Note for whoever does: the index reading is an inference from rule 1 plus `stdlib-roadmap.md` §6's silence on FFI's *stdlib* half, not a statement §6 makes, so cite rule 1.

### 9.2 Rejected alternatives (do not re-litigate)

1. **A declared-but-throwing stub plus a blessed `NotImplemented` exception.** Proposed by James (2026-08-02) and retracted by him the same day — recorded here so #237's original text cannot revive it. Rejected on §9.1's grounds: it reproduces in the operation surface the exact defect #128 removes from the type faces; `NotImplemented` fails Exceptions §1 (a certain failure is not an exceptional one) and joins no declared-exception family; and under #234 the throw is observable but unhandleable. **Price of keeping it out:** no forward-compilable symbol — a TypeScript consumer could not write `toArray` calls that compiled then and worked later; the plan is discoverable only from this spec, never from `.d.ts` or completion; and the real operation's eventual arrival is a surface addition consumers must revisit rather than a silent behavior upgrade under an existing name.
2. **Ship it implemented now** (sequence #128 behind the conversion, or rush the conversion). Rejected: outside a ruling's power — this is the spec seat, not an implementing one — and against James's sequencing; #128 already ruled, deliberately, that the honest narrow face does not wait for the conversions (Part 1 §8.3). **Price of keeping it out:** the interim window is real and is borne by exactly the consumers the #128 narrowing takes member access from — they got spread/`Array.from` and nothing better until #238 landed.
3. **A recognized-but-unshipped diagnostic** (the compiler knows the name `Vector.toArray` and answers "specified but not yet available"). Rejected: it builds a shadow inventory of unshipped names, maintained by hand, that will drift stale — and it makes the compiler assert scheduling facts the spec owns. **Price of keeping it out:** the existing checker error teaches nothing about the plan; a user who found `toArray` in this spec learns from the diagnostic only that the companion has no such operation, and must return here to learn why and until when.

---

## 10. Diagnostics checklist

This part introduces **one new hard error** (the `.length` habit); everything else lands elsewhere and is only inherited:

| Situation | Owner |
|---|---|
| Adapter-requiring type nested inside `Array(a)` or any direct aggregate | Part 1 §5.3 (hard error with named rewrite) |
| Extern declaration syntax around `Nullable` slots (fixed arity, optional-parameter modeling) | Part 4 |
| Attempted mutation of `Array(a)` | not a diagnostic — no such operation exists to misuse (§6.1) |
| `Array` beneath an identity-crossing container, inside an opaque representation, in an exception payload, or as an exported value binding; `JsValue.from` at an unresolved variable | Part 1 §5.4's refusals (single owner; this part inherits) |
| Bare property read `.length` on an `Array(a)` (the JS/TS habit) | this part, §6.3 — specialized hard error naming both rewrites: canonical `Array.length(xs)`, minimal `xs.length()`; the fault is the field spelling, not the word (§13.1). The call form `xs.length()` is not an error — companion dispatch. |
| Out-of-bounds `xs[i]`/`at`; directed slice window | not compile diagnostics — runtime `IndexError`/`SliceError` per Collections Part 3's doctrine (§6.3) |
| Calling an unshipped §9 conversion (`Array.toSeq`, `Array.fromSeq` today; `Vector.toArray` and `Array.toVector` have shipped) | not a new diagnostic — the ordinary resolver error, ``module `Array` does not export `toSeq` ``, deliberately (§9.1: absence, never a stub; Rewrite Rule not engaged). `Array` is an ordinary prelude module and an unknown operation is an unknown export, everywhere |

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
| All `NullableCase` constructors are qualified-only through the companion (the prelude's default — Modules §5.5); no bare prelude auto-import; representations unchanged | §3; FFI Part 12 §12 |
| `toOption` collapses both absences to `None`; `fromOption` → `undefined`; `fromOptionOrNull` → `null` | §4 |
| Supersedes Unions §8's `Option.fromNullable`/`Option.toNullable`; edit note issued | §5 |
| `Array(a)` = readonly **captured** foreign collection — Hexagon's snapshot of the foreign array *(#876; formerly a zero-copy borrowed view, §13.2)*; `ReadonlyArray<a>` face; no mutation surface | §6.1 |
| *(#876)* Capture contract: copied at every declared crossing, both directions, type-directed (Part 1 §5.4); linear cost accepted; copy performs no effect, the row's arrow colours the acquisition; hostile reads → `JsError`, racing mutation → unspecified for that acquisition only; no identity relation, no cache; fresh arrays are captured from birth; the stability contract, the escaped-`Seq` borrow extension, and "stable while exclusively held" are retired | §6.2 |
| *(#876)* Until #875, an `Array` extracted from a borrowed `JsMap`/`JsSet` is the one non-captured `Array` value, held by Part 10 §2's borrow obligation — the dated exception Part 1 §2.2 names | §6.2, §6.5 |
| *(#876)* Every observation observes the captured array; iteration copies nothing at iteration time because the crossing already did; native `for...of` licensed on that ground | §6.5 |
| Accessor surface: `length`, 1-based read-only `[]` (throws `IndexError`), `at` (signed), `get` (`Option`), eager shallow clamping slices returning fresh JS arrays; no mutation; `.length` gets a specialized diagnostic naming `Array.length` | §6.3 |
| `Nullable` is definitionally idempotent over the closed designated nullish-absorbing set: `Nullable(Nullable(a)) ≡ Nullable(a)`, `Nullable(JsValue) ≡ JsValue`, and `Nullable(T) ≡ T` for a literal extern enum naming both nullish values (one named: `Nullable(T)` refused); no structural nullish analysis | §2.1; FFI Part 11 §8; Foreign Enums §2.4 |
| `Array(Nullable(a))` admits sparse arrays; holes observe as `Nullable.undefined`; no presence distinction, no scanning; a hole under a non-nullable element type is a Part 1 §3.1 contract violation | §6.4 |
| Native iteration needs no closing protocol | §7 |
| `Iterable<Array(a)>`: `Item = a`, member `toSeq` = `Array.toSeq`; native `for...of` emission; suite membership — Collections Part 5 §6 discharged | §8 |
| *(2026-08-02, #237 ruling)* The row above **does not oblige a public symbol spelled `Array.toSeq`**, and §9.1's build-state finding therefore does not falsify it: a Decided spec's instance row states design, not the current build, exactly as §9's four unimplemented contracts do; `Array` iteration emits native `for...of` through no member (§8.2). Part 5 §6's discharge stands. §8.3's suite membership, which *does* name callables, is **decided but unshipped** and now says so. **Explicitly not claimed** (an earlier draft did, wrongly): that a provided row's `toSeq` is uncallable — it is callable at concrete types, Collections Part 2 §7.2 and Part 5 §2.3's `toSeq("abc")`; and that `Array` is special — `Iterable<String>` binds the equally unsupplied codepoint member | §8.1, §8.3 |
| `Array.toSeq` lazy over the captured array (no borrow to extend); `Array.fromSeq`/`Array.toVector`/`Vector.toArray` eager and fresh; all shallow | §9 |
| `Array.size` renamed `Array.length` (Collections Part 1 §10.1); the `.length` diagnostic re-charactered — grammar, not vocabulary; `xs.length()` is companion dispatch and compiles; the diagnostic names both rewrites, canonical first | §6.3, §13.1 |
| *(2026-08-02, #237 ruling)* Shipped Hexagon-owned surface carries no declared-but-throwing stubs: an operation that cannot yet be implemented is absent — no declaration, no export, no `.d.ts` entry — and the spec is the forward contract; §9's quartet is currently unshipped (verified); interim JS surface of a crossed `Vector` = iteration/spread/`Array.from` + author exports, confirming Part 1 §8.3; no new diagnostic, Rewrite Rule not engaged; outbound `Vector.toArray` ships first (#238) — a one-item priority, not a partition, since `Array.fromSeq` is outbound too — the other three later and separately motivated, Part 10's doors gated on `Map.hex`/`Set.hex`; implementation obligations fixed (contract per §9, companion home, intrinsic-door route designed but gated on standard-library-source privilege (§9.1 obligation 2), no partial shipping); **no carve-out**: the "callable surface, not semantic content" exemption an earlier draft added is withdrawn unreplaced, as unnecessary and unsound, leaving the doctrine without an exception clause; the debt's ledger row is `stdlib-roadmap.md` §2 under that file's rule 1, with `ffi.md` §9.1 a mirror index and the two files' "global ledger" claims recorded under rule 5, not chosen. *(Amended, #238: `Vector.toArray` shipped through the intrinsic door as obligation 2 routes it.)* *(Amended, #237: `Array.toVector` shipped as ordinary Hexagon in `stdlib/Array.hex` — no door, `stdlib-roadmap.md` §5.1; `Array.toSeq`/`Array.fromSeq` remain unshipped.)* | §9.1 |
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

### 13.2 The #876 ruling: from borrowed view to captured collection

**What changed.** `Array(a)` was a zero-copy borrowed view under a foreign stability contract: foreign code owned the array and promised to hold it still while Hexagon, or any `Seq` derived from it, might observe it, and on that promise live and snapshot observation coincided and native iteration was licensed (the former §6.2 and §6.5). The ruling replaces the contract with a capture: the array Hexagon holds is its own copy, made at the crossing in both directions (§6.2; Part 1 §2.2, §5.4). The accessor surface (§6.3), the sparse-array rule (§6.4), the `Iterable` row (§8), the emission (§8.2), the conversion quartet's names and shallowness (§9), the shipping doctrine (§9.1), and the `.d.ts` face are unchanged; what each of them *meant* by stability is now the value's own.

**Why.** The governing principle: a pure collection denotes stable contents, and foreign mutation must not change a collection value Hexagon already holds. The borrow contract made `Array.length` a pure-faced read of storage foreign code could vary, held honest only by the foreign owner's promise and by a rule forbidding the compiler to hoist the read — and forbidding an optimisation does not establish purity. Purity in Hexagon is a fact about values, not a promise about what the compiler refrains from doing. The same finding, made on `JsMap.size`, produced the sibling ruling #875.

**Rejected alternatives, with prices (do not re-litigate):**

1. **Keep the borrow, keep the face pure, forbid hoisting.** Rejected as the defect itself: an implementation restriction masquerading as a semantic guarantee, unsound the moment a wrapper, a memoization, or a deferred traversal moves the read. Price of keeping it out: the zero-copy crossing, and the linear cost §6.2 now states at every position.
2. **Copy inbound only.** Rejected: an `Array` handed *out* by identity is Hexagon's storage in foreign hands, and the value Hexagon retains changes when that code mutates it. Price of keeping it out: the outbound copy, including on values Hexagon itself made (`Vector.toArray`'s result crosses as a second fresh array).
3. **Classify at runtime** — copy whatever `Array.isArray` says is an array, wherever it appears. Rejected: Part 1 §1 admits no runtime classification at the boundary, `instanceof` is realm-bound for the `Map`/`Set` siblings (Part 11 §13.1), and a type-directed walk already knows every position. Price of keeping it out: the refused positions of Part 1 §5.4, where a dynamic check might have reached and the static walk cannot.
4. **Freeze captured arrays** (`Object.freeze` at capture) so an escaped copy cannot be mutated. Rejected: it reaches arrays alone — a frozen native `Map` still accepts `set` — so the refusals of Part 1 §5.4 would be needed anyway and the mechanism would split by type; a sloppy-mode consumer's write to a frozen array is a silent no-op, not a signal; and it changes what JavaScript receives. Price of keeping it out: none of the refusals can be lifted for arrays alone.
5. **Copy through identity-crossing containers** (`Vector(Array(Int))` rebuilt with copied elements). Rejected: it breaks the identity crossing those containers promise (Part 1 §4.2), costs a traversal and, for `Map`/`Set`, a re-hash, and would make the runtime collections' crossing type-directed too. Price: Part 1 §5.4 item 1's refusal and its rewrites.
6. **An identity cache for conversion wrappers** so a wrapped callback deregisters by identity. Deferred, not rejected — Part 6 §5.5 and §8; the foreign shim retaining the wrapper is the recorded workaround.

**What the ruling deliberately leaves alone.** The finite-collection suite membership and the four conversion names (§8.3, §9); `Array.toVector`'s body as ordinary Hexagon (§9.1) — a `for` over a captured array is a traversal of a value, and needs no door; the `.length` diagnostic (§13.1); and Part 5's fresh-read rule for `->!` getters, which is about foreign properties and was never about this type.
