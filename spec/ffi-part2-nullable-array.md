# Hexagon FFI Part 2: `Nullable(a)` and Borrowed `Array(a)`

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing. Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §2 and the §4 `Nullable` package, drafted per `spec/notes/ffi-roadmap.md` Part 2. The three questions the draft recorded as promotion blockers (`Nullable` idempotence, §2.1; the `Array` accessor surface, §6.3; sparse arrays, §6.4) were resolved by James and Sol before promotion. Reads Part 1 (`ffi-part1-boundary.md`) for the category vocabulary and failure doctrine; restates neither.
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
- Violation is a Part 1 §3.1 contract violation: it does not imply memory unsafety, but the affected contents, order, length, and traversal observations are unspecified.
- **A freshly runtime-constructed array is stable while exclusively held by Hexagon.** `Array.fromSeq` and `Vector.toArray` produce fresh arrays (§9); the stability obligation becomes relevant only once foreign code can alias the reference. Hexagon never gains a public mutation operation either way.

### 6.3 The accessor surface

`Array(a)` ships a read-only accessor surface aligned with `Vector`'s indexing doctrine (Collections Part 3 §5–§6 — brackets assert, names answer, windows have no direction). All observations are zero-copy reads of the borrowed array except slicing, which is an explicit fresh construction:

```hexagon
Array.size  : Array(a) -> Int
xs[i]                                 -- 1-based read-only; throws IndexError out of bounds
Array.at    : (Array(a), Int) -> a    -- signed from-end addressing; throws IndexError
Array.get   : (Array(a), Int) -> Option(a)
xs[lo..hi]                            -- eager shallow slice: a fresh JS array
```

- `xs[i]` is **1-based and read-only**; there is no assignment-to-index grammar, and no `set` exists. Out-of-bounds throws `IndexError` (Collections Part 3's declaration), asserting at the fault site.
- `at` and `get` carry their Vector contracts: `at` is the bracket's signed sibling (from-end addressing, throws), `get` answers with `Option`.
- **Slicing is eager and shallow and returns a fresh JS array** — an `Array(a)` that is freshly runtime-constructed and therefore stable while exclusively held (§6.2). Elements are preserved by value and identity (Part 1 §5.1); windows clamp, and a directed window throws `SliceError`, per the Vector window doctrine.
- **No mutation surface exists**, on any accessor or result.
- Emission is representation-honest but not bare: `Array.size(xs)` is `xs.length`. `xs[i]` emits a bounds check (`i < 1 || i > xs.length` throws `IndexError`) plus the 1-to-0 offset, then the native index read — the assertion semantics require the check; a bare `xs[i - 1]` would return `undefined` out of bounds instead of throwing. Slicing emits **window intersection** before calling native `Array.prototype.slice`, because JavaScript interprets negative slice bounds from the end — passing an unclamped bound through would silently select the wrong window, and clamping each endpoint independently into `[1, size]` is also wrong (a fully out-of-window slice like `[10, 20, 30][5..9]` must be empty, not `[30]`). The required emission shape:

  ```text
  start = max(lo, 1)
  end   = min(hi, size)

  if start > end: fresh empty array
  else:           native slice(start - 1, end)
  ```

  This handles empty arrays and empty ascending ranges correctly. A slice taking a general `Range` value checks direction **first** and throws `SliceError` for a descending range, per the window doctrine.
- **The `.length` habit gets a specialized diagnostic**: a TS-habituated `xs.length` on an `Array(a)` is rejected with a message naming `Array.size(xs)` (§10) — per the Rewrite Rule, the fixit is stated in the diagnostic.

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

> **`Iterable<Array(a)>` holds, with `type Item = a` and `iterate = Array.toSeq`.**

`for x in arr` therefore resolves by the ordinary Collections Part 5 §3 algorithm; the direction (the foreign door is iterable) was decided there and is not reopened here. The row's *meaning* is §6.5's: iteration observes the borrowed array under the stability contract, and live-versus-snapshot is not observable under valid use.

### 8.2 Emission

`for x in arr` over an `Array(a)` emits native JavaScript iteration:

```js
for (const x of arr) { ... }
```

This is legitimate precisely because of §6.5 — native iteration's JavaScript mutation-observation behavior is unobservable under the boundary contract, which is why Collections Part 5 §13.5 correctly refused to mandate this emission before the semantics existed. The decision record licenses exactly this: native `for...of`, permitted and preferred. Other emission strategies (e.g. direct indexed loops) are not licensed here — an exotic foreign array object could observe the difference in access pattern, so any widening of the emission license is a separate decision, not emitter discretion.

### 8.3 Suite membership

**`Array(a)` joins the finite-collection `toSeq`/`fromSeq` conversion suite** (Collections Part 5 §1), under exactly those names (§9). This closes the suite-membership question Part 5 left open.

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

---

## 10. Diagnostics checklist

This part introduces **one new hard error** (the `.length` habit); everything else lands elsewhere and is only inherited:

| Situation | Owner |
|---|---|
| Adapter-requiring type nested inside `Array(a)` or any direct aggregate | Part 1 §5.3 (hard error with named rewrite) |
| Extern declaration syntax around `Nullable` slots (fixed arity, optional-parameter modeling) | Part 4 |
| Attempted mutation of `Array(a)` | not a diagnostic — no such operation exists to misuse (§6.1) |
| `.length` on an `Array(a)` (the JS/TS habit) | this part, §6.3 — specialized hard error naming the rewrite: `Array.size(xs)` |
| Out-of-bounds `xs[i]`/`at`; directed slice window | not compile diagnostics — runtime `IndexError`/`SliceError` per Collections Part 3's doctrine (§6.3) |

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
| Accessor surface: `size`, 1-based read-only `[]` (throws `IndexError`), `at` (signed), `get` (`Option`), eager shallow clamping slices returning fresh JS arrays; no mutation; `.length` gets a specialized diagnostic naming `Array.size` | §6.3 |
| `Nullable` is definitionally idempotent over the closed designated nullish-absorbing set: `Nullable(Nullable(a)) ≡ Nullable(a)` and `Nullable(JsValue) ≡ JsValue`; no structural nullish analysis | §2.1; FFI Part 11 §8 |
| `Array(Nullable(a))` admits sparse arrays; holes observe as `Nullable.undefined`; no presence distinction, no scanning; a hole under a non-nullable element type is a Part 1 §3.1 contract violation | §6.4 |
| Native iteration needs no closing protocol | §7 |
| `Iterable<Array(a)>`: `Item = a`, `iterate = Array.toSeq`; native `for...of` emission; suite membership — Collections Part 5 §6 discharged | §8 |
| `Array.toSeq` lazy zero-copy; `Array.fromSeq`/`Array.toVector`/`Vector.toArray` eager and fresh; all shallow | §9 |
