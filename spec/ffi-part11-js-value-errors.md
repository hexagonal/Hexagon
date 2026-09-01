# Hexagon FFI Part 11: `JsValue`, Checked Decoding, and Conversion Failure

**Status:** Decided and promoted after Sol review (July 2026). Drafted per `spec/notes/ffi-roadmap.md` Part 11 from the approved decision package (James/Sol, 2026-07-17); the draft's completions and open questions were resolved at review and are recorded in §§12–13 (retitled review-resolution sections; numbering stable per house rule). Resolutions applied in place: `JsKind` approved as drafted; **`JsConversionError` is ordinary data, not an exception** (§5); `JsValue.from` approved; the conservative `JsError.message`/`stack` algorithms approved with objects *and functions* eligible for the guarded read (§7); `toArray`'s revoked-proxy probe follows `JsError`, unlike total `kind` (§4.2); `toJsMap`/`toJsSet` deferred from the v1 core with a recorded revisit bar (§9, §13.1); the composable decoder library is the stdlib listing's (§13.2, ledger discharge §10); and nullish absorption is normalized as one idempotency principle (§8, §13.3). Discharges `spec/notes/ffi-proto-spec-questions.md` §10's must-decide list and the accessor debt Exceptions §6.1 recorded. The approved decisions are normative here: `JsValue` is the final name, facing `unknown`; decoding is strict and non-coercing with no unsafe casts in v1; `JsValue.kind` is total and property-free; checked decoding returns `Result(_, JsConversionError)`; structured paths use fields, 1-based indices, map keys/values, and set elements, with cycles reporting current and first-seen paths; shape/range/cycle failures return `Err` while hostile foreign throws use `JsError`; `JsError.message`/`JsError.stack` are total, conservative, and suppress secondary throwing-property failures; `JsValue` itself includes `null` and `undefined` and is not modeled as `Nullable(JsValue)`. **Carries Part 10's correction:** Part 10's shallow conversions originate failure paths through map keys and set elements only — never map values; *map value* remains general path vocabulary for conversions that actually traverse values (§6.3).
**Scope:** The `JsValue` type: representation, face, nullish absorption, the total injection; `JsValue.kind`; the strict scalar decoders and `toArray`; the `JsConversionError` data declaration, reason classes, and all-or-nothing rule; the structured path model; `JsError.message`/`JsError.stack` over arbitrary throwables; the trusted-declaration-versus-defensive-decoding boundary; diagnostics.
**Not in scope:** the composable decoder/combinator library (stdlib listing — §13.2; the path vocabulary is fixed here so it composes); `JsMap`/`JsSet` classification decoders (§13.1); the `JsError` exception itself and catch semantics (Exceptions §6 — consumed); Part 10's conversions (consumed; they cite this part's error type); unsafe casts (none exist in v1, §1).
**Companions:** Part 1 §3/§4.1 (failure doctrine; the `JsValue` row this part finalizes); Part 2 (`Array` borrowed view, `Nullable` idempotence); Part 10 §7.3 (the first consumers of `JsConversionError`); Exceptions §6–§7 (`JsError`, virtual wrapping, branded representation); Collections Part 1 §3.3 / Decisions Batch §5 (1-based indexing); Unions §6 (representations used by this part's declarations).

---

## 1. Doctrine: the honest uncertain value

`JsValue` is the type of a JavaScript value about which Hexagon asserts **nothing**. It is the honest complement to the trusted boundary, and the dividing rule (Part 1 §3.3) becomes a two-door instruction:

> **If you trust it, declare it** — write the extern signature at the real type, and the trusted-boundary contract governs. **If you don't, take a `JsValue` and decode it** — explicit, checked, strict.

Fixed here, from the approved package:

- **Strict, non-coercing decoding.** A decoder succeeds iff the value already *is* the target representation. Nothing is parsed, truncated, rounded, `String()`-ed, or `Number()`-ed. `JsValue.toBool` on `1` fails; `JsValue.toString` on `42` fails. Coercion is a foreign-side decision made in foreign code, never a Hexagon default.
- **No unsafe casts in v1.** There is no `JsValue.unsafeCast`, no `as`-style reinterpretation, no blessed backdoor. The only exits from `JsValue` are checked decoders — and the only bypass of decoding is an extern declaration, which is a visible, trusted assertion at a declaration site rather than an expression-level cast. This keeps every unchecked claim about foreign data findable by reading `extern` blocks.
- **Two failure channels, never mixed** (the Part 10 §4.4 split, generalized): a value that is inspectable but wrong — wrong shape, out of range, cyclic — produces a **defined checked failure**, `Err(JsConversionError)`. A **hostile foreign operation that throws** during inspection (a proxy trap, a poisoned getter) propagates through the ordinary **`JsError`** door. `Err` is about the data; `JsError` is about the code.

---

## 2. The `JsValue` type

- **Representation:** any JavaScript value whatsoever, held unchanged and crossing **by identity** — representation-direct, zero-copy, no wrapper. Finalizes Part 1 §4.1's provisional row (edit note, §10).
- **`.d.ts` face:** `unknown` — TypeScript's own type for exactly this contract. Never `any`: `unknown` forces the foreign consumer through the same narrowing discipline Hexagon imposes on itself.
- **`JsValue` includes `null` and `undefined`.** A `JsValue`-typed position accepts every JS value including both nullish forms; APIs returning "anything or nothing" are declared as plain `JsValue`, not `Nullable(JsValue)`. Nullishness is one more thing `kind` reports (§3), not a separate wrapper layer. (The `Nullable(JsValue)` spelling itself: §13.3.)
- **The injection is total and free:** `JsValue.from(value: a) -> JsValue` — every Hexagon value already is a JS value, so `from` is the representation-honest identity, erased in emission. There is no checked path *into* `JsValue` because none is needed. *(Approved at review, §12.4.)*

`JsValue` is not iterable, not comparable, not showable — it has no instances. Everything one does with it goes through `kind`, a decoder, or a trusted re-declaration at a boundary. The companion operations take the dot *(#511)*: `v.kind()` and `v.toInt()` are ordinary companion dispatch (Method Syntax §4.1's boundary row).

---

## 3. `JsValue.kind`

`JsValue.kind : JsValue -> JsKind` — **total and property-free**, per the approved package. The inventory, approved as drafted (§12.1):

```hexagon
union JsKind derives (Eq, Show) =
    Undefined | Null | Bool | Number | BigInt
    | String | Symbol | Function | Array | Object
```

All-nullary, so its JS representation is the string union — pleasant and free (Unions §6.2). It derives `Eq` and `Show` *(#511)*: the single-kind test `kind(v) == JsKind.Number` is the surface's most common question, and both instances are lawful and trivial on an all-nullary union. (`JsValue` itself still has no instances — §2; the kinds are ordinary domestic data about a foreign value, not the value.)

All ten constructors are qualified-only in the prelude inventory (`JsKind.Undefined`, `JsKind.Null`, …, `JsKind.Object`) in expressions and patterns. They are not auto-imported as bare prelude terms — the prelude's default for every union but the three open ones (Modules §5.5); `ffi.md` §12 records the first case. This ordinary companion qualification leaves the string representation unchanged (Part 12 §12).

Classification rules, normative:

- `Undefined`/`Null` by direct comparison; `Bool`/`Number`/`BigInt`/`String`/`Symbol`/`Function` by `typeof`; `Array` by `Array.isArray`; everything else is `Object`.
- **Property-free means property-free**: the implementation never reads a property, never invokes a getter, never triggers a proxy `get`/`has` trap. `typeof` and `Array.isArray` satisfy this (neither consults user-observable traps).
- **Totality survives hostile inputs, including revoked proxies.** `Array.isArray` on a revoked proxy throws a `TypeError`; `kind` **guards that one probe** and classifies a revoked proxy as `Object`. No input makes `kind` throw. (Approved; contrast `toArray`, §4.2, which does not guard.)
- `kind` reports JavaScript's classification, not Hexagon's: a `Number` may or may not be a safe integer (that is `toInt`'s range check, §4); a `String` result says nothing about content. There is no `Int` kind — the `Int`/`Float` distinction is a Hexagon refinement invisible to `typeof` (Part 1 §4.2).

---

## 4. Checked decoding: the v1 surface

### 4.1 Scalar decoders

```hexagon
JsValue.toInt    : JsValue -> Result(Int, JsConversionError)
JsValue.toFloat  : JsValue -> Result(Float, JsConversionError)
JsValue.toBigInt : JsValue -> Result(BigInt, JsConversionError)
JsValue.toBool   : JsValue -> Result(Bool, JsConversionError)
JsValue.toString : JsValue -> Result(String, JsConversionError)
```

Strictness, per type:

| Decoder | Succeeds iff | Reason on failure |
|---|---|---|
| `toFloat` | `kind` is `Number` (any `number`: `NaN`, infinities, `-0` included) | `Shape` otherwise |
| `toInt` | `kind` is `Number` **and** `Number.isSafeInteger` holds | `Shape` if not a number; **`Range`** if a number outside the safe-integer domain (`1.5`, `2^53`, `NaN`) |
| `toBigInt` / `toBool` / `toString` | `kind` is `BigInt` / `Bool` / `String` | `Shape` otherwise |

`toInt` is why the reason classes distinguish `Shape` from `Range`: "not a number at all" and "a number `Int` cannot hold" are different programmer errors with different fixes.

### 4.2 `toArray`: the borrowed structural door

```hexagon
JsValue.toArray : JsValue -> Result(Array(JsValue), JsConversionError)
```

Succeeds iff `Array.isArray`; the success value is the **zero-copy borrowed view** over the same array, honestly element-typed as `JsValue` — the elements remain uncertain, and each is decoded individually by the caller. From the moment of success, Part 2's `Array` stability contract governs the borrow. Failure is `Shape`. This is deliberately the *only* structural decoder in the core: it is realm-safe, property-free, and O(1); everything richer belongs to the stdlib decoder library (§13.2) or fell to the classification deferral (§13.1).

**The revoked-proxy edge, clarified at review:** unlike total `kind` (§3), `toArray` does **not** suppress a throwing `Array.isArray` probe. A revoked proxy's `TypeError` follows the ordinary `JsError` channel and is not converted into `Err(Shape)`. The asymmetry is the §1 doctrine applied honestly: `kind` promises a classification of *any* value and must absorb the probe to keep that promise; `toArray` promises a verdict about the data, and a throwing probe is foreign control flow, not a data verdict.

### 4.3 The `Err`/`JsError` split, restated operationally

Decoders inspect; they do not traverse objects or invoke foreign behavior — the §4.1–4.2 surface cannot itself trigger a getter. Conversions that **do** traverse (Part 10's key ingestion; future library decoders) follow the rule uniformly: inspecting a value and finding it wrong → `Err`; a foreign operation throwing mid-inspection → `JsError` propagates, and no `Err` is synthesized from it. **Honest wrongness is data; a throw is control.**

This part's composable decoder surface returns `Result(_, JsConversionError)` so reasons and paths compose. A generated foreign-enum `fromJsT` is instead a closed-set membership projection returning `Option(T)`; other partial projections state their failure type in their owning specification (Part 12 §11.2).

---

## 5. `JsConversionError`

### 5.1 The declaration

*(Resolved at review, §12.2: ordinary data, not an exception.)*

```hexagon
union JsPathSegment =
    Field(name: String)
    | Index(index: Int)                          -- 1-based
    | MapKey(position: Int)                      -- 1-based source-iteration position
    | MapValue(position: Int)
    | SetElement(position: Int)

union JsConversionReason =
    Shape
    | Range
    | Cycle(firstSeen: Vector(JsPathSegment))

record JsConversionError = {
    reason: JsConversionReason,
    path: Vector(JsPathSegment),
}
```

All constructors of both unions are qualified-only in the prelude inventory *(#511; Part 12 §12's rule, extended there)* — `JsConversionReason.Shape`, `JsConversionReason.Range`, `JsConversionReason.Cycle(firstSeen)`, `JsPathSegment.Field(name)`, `JsPathSegment.Index(index)`, and kin, in expressions and patterns alike. They are not auto-imported as bare prelude terms: `Shape`, `Range`, `Field`, and `Index` are ordinary user vocabulary, and the prelude does not spend them. This is ordinary companion qualification and leaves the runtime representations unchanged (Part 12 §12).

- **It is ordinary data** — a record over unions, carried in `Err` like any other value. The checked-failure path allocates no `Error`, captures no stack, and carries no brand; it is a described outcome, not an escape. This is the §1 doctrine made structural: **checked wrongness is ordinary data in `Err`; foreign thrown control flow travels through `JsError`** — the one exception-shaped thing in this part. A caller who wants to abort on `Err` matches and throws an exception of its own choosing, at its own site.
- Its boundary faces follow Part 7's ordinary record and union rules (§3–§4 there): structural record face, tagged-POJO reason union — nothing error-flavored in the `.d.ts`.
- **`path` locates the failure**: empty vector = the decoded value itself (every §4.1–4.2 failure has an empty path); segments compose root-outward for nested traversals.
- **Cycles report both paths**: `path` is where the cycle was detected (current), `Cycle`'s payload is where the structure was first seen. The two together name the back-edge, which is the only actionable description of a cycle.
- **All-or-nothing** everywhere the type appears: an `Err` returns no partial result and leaves no observable state (Part 10 §7.3's rule, stated generally).
- Non-normative: reporting layers may render a best-effort human diagnostic (path spelled `key[3].name`-style, expected/actual kinds); programs must not parse such renderings (the Part 4 §4.3 reporting-layer stance).

### 5.2 Reasons

- **`Shape`** — the value is not the required kind of thing (wrong `typeof`, not an array, not an object where one was required).
- **`Range`** — the right kind of value outside the representable domain (`toInt` on `2^53`; future decoders' domain checks).
- **`Cycle`** — a traversal that must terminate encountered a back-edge (structural-key hashing, Part 10 §7.3; any future deep decode).

---

## 6. The structured path model

### 6.1 Vocabulary

Five segment forms (§5.1), fixed as **the** path vocabulary for every checked conversion in the corpus — Part 10's today, the stdlib decoder library's tomorrow:

- `Field(name)` — object property traversal;
- `Index(i)` — array/sequence position, **1-based** (house indexing, Decisions Batch §5 — a path is Hexagon diagnostics, not a JS offset);
- `MapKey(position)` / `MapValue(position)` / `SetElement(position)` — collection-entry traversal, identifying the entry by its 1-based source-iteration position, because an arbitrary foreign key cannot itself be carried in a payload (the `KeyError` nullary rationale, Part 4 §4.3, applied to paths).

### 6.2 Composition

Segments read root-outward: decoding fails at "the `name` field of the 3rd element of the value under the 2nd map key" as

```text
[MapKey(2), Index(3), Field("name")]
```

Producers append as they descend; consumers get one flat vector. The vocabulary is closed in v1 — a future decoder needing a new segment form amends this part rather than minting local conventions.

### 6.3 Which conversions originate which segments (Part 10 correction, normative)

**Part 10's shallow conversions (`Map.fromJsMap`, `Set.fromJsSet`) originate failure paths through `MapKey` and `SetElement` only — never `MapValue`.** They hash keys and elements (a traversal that can detect cycles) and never traverse values (shallow, trusted). `MapValue` remains in the general vocabulary for conversions that actually traverse values — a future `decodeMap`-style library function that decodes both sides of every entry. A `MapValue` segment appearing in an error today would be a bug, not a semantics.

`Field` and `Index` likewise originate only from conversions that traverse objects and arrays — none in this part's core surface (every §4 failure has an empty path); they exist now so Part 10's segments and the future library's segments compose in one vocabulary.

---

## 7. `JsError.message` and `JsError.stack`

The accessors Exceptions §6.1 owed to this part, over the `JsError` payload (`error: JsValue` — the raw thrown value, which JS permits to be *anything*: `null`, a string, a symbol, a hostile object):

```hexagon
JsError.message : JsValue -> String
JsError.stack   : JsValue -> Option(String)
```

**Both are total and conservative, and suppress secondary throwing-property failures** (approved, §12.3). **Objects and functions alike are property-bearing values eligible for the single guarded read** — a thrown function is exotic but legal JS, and it carries properties like any object. The algorithms:

**`message`:**
1. Thrown non-property-bearing value (`kind` ∈ {`String`, `Number`, `BigInt`, `Bool`, `Symbol`, `Undefined`, `Null`}): the safe rendering — the string itself for `String`; safe stringification for the others (`String(sym)` form, which cannot throw). `throw "oops"` yields `"oops"`.
2. Thrown object **or function**: one guarded read of `.message`; if the read succeeds and yields a string, that string; otherwise — read throws (getter, proxy trap), property absent, or non-string — the empty string. **The value's `toString` is never invoked** (hostile), and the throwing read is swallowed into `""`, never propagated: an accessor whose purpose is describing one failure must not manufacture a second.

**`stack`:**
1. Thrown non-property-bearing value: `None`.
2. Thrown object **or function**: one guarded read of `.stack`; `Some(s)` iff the read succeeds with a string `s`; `None` otherwise (absent, non-string, or a throw, swallowed).

Both accessors perform **fresh guarded reads per call** (Part 5 §3.1's discipline — the property may be an accessor) and touch exactly the one named property. Richer interrogation of a thrown value — `name`, `cause`, structural decoding — is ordinary `JsValue` decoding with §4's tools and the §13.2 library; these two accessors exist because *every* catch site wants them and they must never make things worse.

---

## 8. `JsValue`, `Nullable`, and trusted declarations

The triangle, settled:

- **`JsValue` vs. a trusted declaration:** the extern author's choice per API honesty (§1). Mixed signatures are normal and encouraged — `extern fun parse(text: String): JsValue` trusts the argument convention while refusing to trust the result.
- **`JsValue` vs. `Nullable(a)`:** `Nullable(a)` is the *typed* nullish door — "a known `a`, or nothing" (Part 2). `JsValue` is the *untyped* door and **absorbs nullishness** rather than wrapping it (§2): "or nothing" is already inside. Decoding a `JsValue` that may be nullish-or-`T` is `kind`-then-decode, or the future library's `nullable(decoder)` combinator.
- **Nullability normalization (resolved, §13.3)** — one idempotency principle, two instances:

  ```text
  Nullable(Nullable(a)) ≡ Nullable(a)
  Nullable(JsValue)     ≡ JsValue
  ```

  `Nullable` never stacks on a **designated nullish-absorbing type** — a type whose value set already contains both nullish forms. The designated types are exactly `Nullable(_)` itself (Part 2's existing idempotence) and `JsValue` (this part); the list is explicit and closed. **No general structural "contains nullish" analysis exists over arbitrary types** — an opaque extern type that happens to admit `undefined` values, or a union an author believes nullish-adjacent, does not collapse; designation is by rule, not by inspection. The idiom for the three-way nullish split over an uncertain value is `kind` (§3).
- **`JsValue` in any position** — parameters, results, record fields, collection elements (`Array(JsValue)`, `JsMap(String, JsValue)`), callback signatures — is representation-direct and legal wherever Part 1 §5.3 admits a direct type. Uncertainty nests honestly.

---

## 9. Deferred surfaces (recorded, not designed)

1. **The composable decoder library** — field/record traversal, element-wise collection decoders, `nullable`/`oneOf`/default combinators, map/set decoders: **the stdlib listing's, confirmed** (§13.2; ledger edit note §10). The path vocabulary (§6) and error structure (§5) are fixed here precisely so that library composes without new error machinery.
2. **`JsValue.toJsMap` / `JsValue.toJsSet`** — **deferred from the v1 core** (§13.1). The revisit bar, recorded: the absence of a portable `Array.isArray`-equivalent for native `Map`/`Set` — `instanceof` fails cross-realm, and the workable intrinsic brand checks are awkward throw-based probes (`Map.prototype.size` getter application and kin), which sit badly under this part's property-free/guarded-probe discipline. Revisit when the platform provides a clean classification primitive or field evidence shows cross-realm maps are a non-problem worth the `instanceof` caveat.
3. **Unsafe casts** — excluded from v1 by decision; any future proposal re-argues against §1's doctrine, not around it.
4. **JSON-specific decoding** — a library concern over this part's primitives; nothing JSON-shaped is special in the core.
5. **Structured-clone / serialization interop** — untouched.

---

## 10. Companion discharges applied at promotion

- **ffi-part1-boundary.md §4.1** — the provisional `JsValue` row is finalized: name `JsValue`, face `unknown`, representation-direct (opaque) by identity, decoding converted & checked per this part. The §10 "not yet decided" marker clears.
- **exceptions.md §6.1** — the accessor debt is discharged: `JsValue` is final (no longer "name owed to FFI"), and `JsError.message`/`JsError.stack` are specified (this part §7) as total conservative accessors.
- **ffi-part2-nullable-array.md** — propagate the nullability normalization (§8): `Nullable(Nullable(a)) ≡ Nullable(a)` and `Nullable(JsValue) ≡ JsValue` are one idempotency principle over the closed set of designated nullish-absorbing types; Part 2's idempotence rule gains the second instance and the closed-designation framing.
- **global stdlib-listing ledger/roadmap** (per `spec/notes/v1-spec-consolidation-plan.md`) — add the composable `JsValue` decoder family: field/record traversal, element-wise decoders, `nullable`, `oneOf`, defaults, map/set decoders and classification (`toJsMap`/`toJsSet`, carrying §13.1's revisit bar), built over this part's primitives, error structure, and path vocabulary.

---

## 11. Diagnostics checklist

| Situation | Behavior | Owner |
|---|---|---|
| decoder finds wrong kind | `Err` with `reason = Shape` | §4.1, §5.2 |
| `toInt` on a non-safe-integer number | `Err` with `reason = Range` | §4.1 |
| cycle during a traversing conversion | `Err` with `reason = Cycle(firstSeen)` — current path + first-seen path | §5.1, §6 |
| hostile trap/getter throws during inspection or traversal | `JsError` propagates; never converted to `Err` | §1, §4.3 |
| `toArray` on a revoked proxy | the `Array.isArray` `TypeError` propagates as `JsError`; **not** `Err(Shape)` | §4.2 |
| `kind` on any input, including revoked proxies | total; never throws; revoked proxy classifies `Object` | §3 |
| `JsError.message`/`stack` on hostile/degenerate throwables | total; secondary throws suppressed; conservative fallbacks (`""` / `None`) | §7 |
| attempt to spell an unsafe cast | does not exist — no diagnostic to design; the rewrites are "decode it" or "declare it (`extern`)" | §1 |
| `MapValue` segment from a Part 10 conversion | must not occur — implementation bug, not semantics | §6.3 |

---

## 12. Review resolutions: draft completions (closed)

The package fixed semantics; the draft supplied concrete spellings; review resolved each. *(Retitled at finalization; §-numbers stable.)*

1. **The `JsKind` inventory** (§3) — **approved as drafted**: ten kinds including `Array`, `typeof`-aligned plus `Null`; `kind` total and property-free, guarding the `Array.isArray` probe; revoked proxy classifies `Object`.
2. **The error declarations** (§5.1) — **resolved against the draft's exception design**: `JsConversionError` is an ordinary `record` over the `JsConversionReason` union (`Shape | Range | Cycle(firstSeen)`), with the cycle's first-seen path as the `Cycle` payload and entry-position payloads on the collection segments. The exception spelling — `Result.attempt` precedent, throwable-later, branded-`Error` representation, exception `.d.ts` face — is replaced throughout: checked wrongness is ordinary data in `Err`; only foreign thrown control flow travels through `JsError`.
3. **The conservative `JsError.message`/`stack` algorithms** (§7) — **approved**, with the explicit extension that objects *and functions* are property-bearing values eligible for the single guarded read; secondary getter/proxy throws remain swallowed into `""`/`None`.
4. **`JsValue.from`** (§2) — **approved**: the total identity injection, erased in emission.

---

## 13. Review resolutions: open questions (closed)

*(Retitled at finalization; §-numbers stable.)*

### 13.1 `JsMap`/`JsSet` classification decoders — deferred from the v1 core

`toJsMap : JsValue -> Result(JsMap(JsValue, JsValue), ...)` needs a way to recognize a native `Map`, and no portable `Array.isArray`-equivalent exists: `instanceof Map` is **realm-bound** — a `Map` from an iframe/worker/vm context fails it while being a perfectly good map — and the workable intrinsic brand checks are awkward throw-based probes, sitting badly under this part's probe discipline. **Resolved: deferred**, recorded at §9.2 with that absence as the revisit bar; the decoders ride with the stdlib decoder family (§10's ledger note).

### 13.2 The decoder library's home — the stdlib listing, confirmed

**Resolved: the boundary is confirmed.** This part owns `JsValue`, `JsKind`, the strict scalar decoders, `toArray`, the conversion-error structure, the path vocabulary, and the failure-channel doctrine. The stdlib listing owns field/record traversal, element-wise decoders, `nullable`, `oneOf`, defaults, map/set decoders, and related combinators — entered in the global stdlib-listing ledger per `spec/notes/v1-spec-consolidation-plan.md` (§10).

### 13.3 `Nullable(JsValue)` — definitional collapse, confirmed

**Resolved: option (a).** `Nullable(Nullable(a)) ≡ Nullable(a)` and `Nullable(JsValue) ≡ JsValue` are one idempotency principle over the closed set of designated nullish-absorbing types (§8), with no general structural "contains nullish" analysis over arbitrary types. Propagation to Part 2 is §10's edit note.

---

## 14. Decisions log (quick reference)

| Decision | Where |
|---|---|
| Two-door doctrine: trust → `extern` declaration; doubt → `JsValue` + strict checked decode; **no unsafe casts in v1** (no expression-level bypass; every unchecked claim lives in a findable `extern` block) | §1 |
| `Err` = data wrongness (shape/range/cycle); `JsError` = foreign code throwing; never mixed, never synthesized across | §1, §4.3 |
| `JsValue`: final name; any JS value by identity; faces `unknown` (never `any`); **includes `null`/`undefined`** — not `Nullable(JsValue)`; no instances; total identity injection `JsValue.from` | §2 |
| `JsValue.kind`: total, property-free, ten-kind inventory; `typeof` + `null` + `Array.isArray`; hostile-input totality incl. revoked proxies → `Object` | §3 |
| All constructors of `JsKind`, `JsConversionReason`, and `JsPathSegment` are qualified-only through their companions *(the latter two: #511; the prelude's default since Modules §5.5)*; no bare prelude auto-import; representations unchanged; `JsKind` derives `Eq` and `Show` *(#511)* | §3, §5.1; Part 12 §12 |
| Strict non-coercing scalar decoders returning `Result`; `toInt` splits `Shape`/`Range` via `isSafeInteger`; `toArray` = realm-safe zero-copy borrowed `Array(JsValue)`; **`toArray` does not guard the `Array.isArray` probe — a revoked-proxy throw is `JsError`, never `Err(Shape)`** | §4 |
| Failure-type ownership: this composable decoder surface uses `Result(_, JsConversionError)`; foreign-enum membership projection uses `Option`; other projections state their own type | §4.3; Part 12 §11.2 |
| **`JsConversionError` is ordinary data**: `record {reason, path}` over `JsConversionReason = Shape \| Range \| Cycle(firstSeen)`; no `Error`, no stack capture, no brand, not throwable as-is; ordinary record/union boundary faces (Part 7); `path` vector, empty = the value itself; all-or-nothing; diagnostic rendering non-normative | §5, §12.2 |
| Path vocabulary closed at five segments: `Field`, `Index` (1-based), `MapKey`/`MapValue`/`SetElement` (1-based source-iteration position); root-outward composition; corpus-wide | §6.1–6.2 |
| **Part 10 correction:** its shallow conversions originate `MapKey`/`SetElement` only; `MapValue` reserved for value-traversing conversions; `Field`/`Index` originate from none of the v1 core surface | §6.3 |
| `JsError.message` total: primitives render safely; objects **and functions** get one guarded `.message` read, `toString` never invoked, secondary throws suppressed → `""`; `JsError.stack` total: guarded `.stack` read → `Option`, `None` on anything else | §7, §12.3 |
| `Nullable(a)` = typed nullish door; `JsValue` = untyped door absorbing nullish; **one idempotency principle over designated nullish-absorbing types: `Nullable(Nullable(a)) ≡ Nullable(a)`, `Nullable(JsValue) ≡ JsValue`; closed designation, no structural nullish analysis**; mixed trusted/uncertain signatures encouraged; `JsValue` legal in every direct position | §8, §13.3 |
| Decoder library confirmed to the stdlib listing (ledger entry issued); `toJsMap`/`toJsSet` deferred from the v1 core — revisit bar: no portable `Array.isArray`-equivalent (cross-realm `instanceof` failure; awkward throw-based intrinsic brand checks); JSON, serialization untouched | §9, §13.1–13.2 |
| Edit notes: Part 1 §4.1 `JsValue` row finalized; Exceptions §6.1 accessor debt discharged; `Nullable(JsValue) ≡ JsValue` propagated to Part 2; composable `JsValue` decoder family added to the global stdlib-listing ledger | §10 |
