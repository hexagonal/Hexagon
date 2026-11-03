# Hexagon FFI Part 11: `JsValue`, Checked Decoding, and Conversion Failure

**Status:** Decided and promoted after Sol review (July 2026). Drafted per `spec/notes/ffi-roadmap.md` Part 11 from the approved decision package (James/Sol, 2026-07-17); the draft's completions and open questions were resolved at review and are recorded in §§12–13 (retitled review-resolution sections; numbering stable per house rule). Resolutions applied in place: `JsKind` approved as drafted; **`JsConversionError` is a tracked exception** (§5; #1427 superseded the review's resolution as data, §12.2); `JsValue.from` approved; the conservative `JsError.message`/`stack` algorithms approved with objects *and functions* eligible for the guarded read (§7); `toArray`'s revoked-proxy probe follows `JsError`, unlike total `kind` (§4.2); `toJsMap`/`toJsSet` deferred from the v1 core with a recorded revisit bar (§9, §13.1); the composable decoder library is the stdlib listing's (§13.2, ledger discharge §10); and nullish absorption is normalized as one idempotency principle (§8, §13.3). Discharges `spec/notes/ffi-proto-spec-questions.md` §10's must-decide list and the accessor debt Exceptions §6.1 recorded. The approved decisions are normative here: `JsValue` is the final name, facing `unknown`; decoding is strict and non-coercing with no unsafe casts in v1; `JsValue.kind` is total and property-free; checked decoding throws the tracked exception `JsConversionError`; structured paths use fields, 1-based indices, map keys/values, and set elements, with cycles reporting current and first-seen paths; shape/range/cycle failures throw `JsConversionError` while hostile foreign throws stay `JsError`; `JsError.message`/`JsError.stack` are total, conservative, and suppress secondary throwing-property failures; `JsValue` itself includes `null` and `undefined` and is not modeled as `Nullable(JsValue)`. **Amended (#876):** `JsValue.from` is a **release seat** — its argument is walked by Part 1 §5.4 at its concrete type, and an argument type containing an unresolved type variable is refused (§2); `toArray`'s success value is a **captured** `Array(JsValue)`, a copy, no longer a zero-copy view (§4.2). **Carries Part 10's correction:** Part 10's shallow conversions originate failure paths through map keys and set elements only — never map values; *map value* remains general path vocabulary for conversions that actually traverse values (§6.3).
**Revised 2026-11-03 (memoization's cycle ruling, `memoization.md`):** §7 gains what a read on a cycle keeps, by FFI Part 3 §7.5's rule for every keeper.
**Revised 2026-11-03 (#1427):** checked decoding throws a tracked `JsConversionError(reason, path, message)` instead of answering `Result(_, JsConversionError)`: the Status and Scope, §1's two failure kinds, §2's dot example, §4, §5.1, §6.2, §12.2, §13.1, and the §11 and §14 rows. Spec first: `stdlib/JsValue.hex` conforms in the implementation that follows.
**Revised 2026-11-03 (#1447):** Hexagon looks inside a foreign object at most once and keeps what it saw (§1): the finding that an object is an array is kept for `kind` (§3), `toArray` keeps its look (§4.2), and a `catch` reads a thrown value's brand and name through §7's kept read (§7). §1 says what a foreign write to the kept record is, and where an environment refuses the record a place on the global object. §4.3's statement of what the core surface reads, and §11's rows for revoked proxies, are corrected to match.
**Scope:** The `JsValue` type: representation, face, nullish absorption, the total injection; `JsValue.kind`; the strict scalar decoders and `toArray`; the `JsConversionError` exception, reason classes, and all-or-nothing rule; the structured path model; `JsError.message`/`JsError.stack` over arbitrary throwables; the trusted-declaration-versus-defensive-decoding boundary; diagnostics.
**Not in scope:** the composable decoder/combinator library (stdlib listing — §13.2; the path vocabulary is fixed here so it composes); `JsMap`/`JsSet` classification decoders (§13.1); the `JsError` exception itself and catch semantics (Exceptions §6 — consumed); Part 10's conversions (consumed; they throw this part's exception); unsafe casts (none exist in v1, §1).
**Companions:** Exceptions §1–§2 (tracked exceptions; declarations), §5 (catching), §8 (`attempt`, `assume`); Effects §3.1 (marks and the reading `?`); Part 1 §3/§4.1 (failure doctrine; the `JsValue` row this part finalizes); Part 2 (the captured `Array`, `Nullable` idempotence); Part 10 §2 (the captured `JsMap`/`JsSet`); Part 10 §7.3 (the first consumers of `JsConversionError`); Exceptions §6–§7 (`JsError`, virtual wrapping, branded representation); Collections Part 1 §3.3 / Decisions Batch §5 (1-based indexing); Unions §6 (representations used by this part's declarations).

---

## 1. Doctrine: the honest uncertain value

`JsValue` is the type of a JavaScript value about which Hexagon asserts **nothing**. It is the honest complement to the trusted boundary, and the dividing rule (Part 1 §3.3) becomes a two-door instruction:

> **If you trust it, declare it** — write the extern signature at the real type, and the trusted-boundary contract governs. **If you don't, take a `JsValue` and decode it** — explicit, checked, strict.

Fixed here, from the approved package:

- **Strict, non-coercing decoding.** A decoder succeeds iff the value already *is* the target representation. Nothing is parsed, truncated, rounded, `String()`-ed, or `Number()`-ed. `JsValue.toBool` on `1` fails; `JsValue.toString` on `42` fails. Coercion is a foreign-side decision made in foreign code, never a Hexagon default.
- **No unsafe casts in v1.** There is no `JsValue.unsafeCast`, no `as`-style reinterpretation, no blessed backdoor. The only exits from `JsValue` are checked decoders — and the only bypass of decoding is an extern declaration, which is a visible, trusted assertion at a declaration site rather than an expression-level cast. This keeps every unchecked claim about foreign data findable by reading `extern` blocks.
- **Two failure kinds, never mixed** (the Part 10 §4.4 split, generalized): a value that is inspectable but wrong — wrong shape, out of range, cyclic — throws a **defined checked failure**, the tracked exception **`JsConversionError`** (§5). A **hostile foreign operation that throws** during inspection (a proxy trap, a poisoned getter) propagates as the foreign throw it is, through the ordinary **`JsError`** door. Neither is made from the other: `JsConversionError` is about the data; `JsError` is about the code. A catch arm that names `JsConversionError` lets a `JsError` through; a catch-all, `attempt` and the reading `?` take both (Exceptions §5.3, §8.2; Effects §3.1).
- **Hexagon looks inside a foreign object at most once.** What a look found is kept beside the object, never on it, for as long as the object lives, and every later look answers from what was kept: `toArray`'s look (§4.2), each property §7 reads, and the finding that an object is an array, the one answer of `kind` that foreign code can change (§3). That keeping is Effects §6.2's species (b): foreign code can change the object, but not what Hexagon saw, so a function that looks is a value function of its argument. A foreign write after the first look is not seen. A programmer who needs a fresh look declares the type they want at the boundary instead of `JsValue`: an `Array(JsValue)` result of an impure extern row, or an `Array(a)` parameter, is captured afresh at each crossing (FFI Part 1 §5.4). What is kept is held in one record per program, which every module's copy of the runtime reaches, so no two modules disagree about one object. A primitive, `null` and `undefined` have no inside to look at.
- **The record is reachable, as every representation is.** Modules find the record through a registered symbol on the global object, so foreign code can name it and write to it, as it can hand Hexagon a fake `{tag: "Some"}`. A write to the record is an FFI Part 1 §3.1 contract violation, in the tier that breaks only on purpose (Exceptions §7.1). Where the JavaScript environment refuses the record its place, a global object that is frozen or not extensible, or a symbol already naming something that cannot hold the record (`null`, a frozen object, or fields of the wrong kind), each module keeps a record of its own instead of failing to load. One module's looks still agree with each other; only in such an environment may two modules disagree about one object.

---

## 2. The `JsValue` type

- **Representation:** any JavaScript value whatsoever, held unchanged and crossing **by identity** — representation-direct, zero-copy, no wrapper. Finalizes Part 1 §4.1's provisional row (edit note, §10).
- **`.d.ts` face:** `unknown` — TypeScript's own type for exactly this contract. Never `any`: `unknown` forces the foreign consumer through the same narrowing discipline Hexagon imposes on itself.
- **`JsValue` includes `null` and `undefined`.** A `JsValue`-typed position accepts every JS value including both nullish forms; APIs returning "anything or nothing" are declared as plain `JsValue`, not `Nullable(JsValue)`. Nullishness is one more thing `kind` reports (§3), not a separate wrapper layer. (The `Nullable(JsValue)` spelling itself: §13.3.)
- **The injection is total, and is a release seat** *(amended #876; approved as the free identity at review, §12.4)*: `JsValue.from(value: a) -> JsValue` — every Hexagon value already is a JS value, and once it is a `JsValue` it crosses to foreign code by identity, unseen. So `from` is where a Hexagon value **enters the uncertain world**, and Part 1 §5.4's walk runs on its argument at the seat's concrete type: a value naming no captured collection is the representation-honest identity, erased in emission, exactly as before; an `Array(Int)`, or a record holding one, is copied, so that the `JsValue` handed onward never aliases storage a Hexagon `Array` value denotes. **The seat is refused when the argument type contains a type variable** — `let wrap(x: a): JsValue = JsValue.from(x)` — because the compiler cannot determine a release operation for it, and it never falls back to identity. It is refused first, and alone, when the argument type is or contains an open structural record (Part 1 §5.4 item 7). The check runs at the **innermost enclosing generalizing binding** (Functions §8), after that binding group is solved and after Numeric Literals §4's defaulting has run — `JsValue.from(1)` injects an `Int`, not a refused variable — and where no generalizing binding encloses the seat (a `var` initializer, Functions §8; a module-level expression, Modules §8.2) it runs when the enclosing top-level binding group is solved and defaulted; so a variable that inference resolves within the group is no obstacle, and a variable that remains — written by the author or introduced by generalization — is displayed under its generalized name (never a numbered inference variable): the diagnostic names it and offers the rewrites — inject where the concrete type is known, or pass an explicit conversion function (`a -> JsValue`) into the generic helper. A ground argument type still obeys Part 1 §5.4's refusals (`Vector(Array(Int))` is refused here as at any position). This is the one boundary seat where the *Hexagon* side supplies the value at a type variable, which is why parametricity does not excuse it as it excuses an exported `first(xs: Array(a)): a`. There is no checked path *into* `JsValue` because none is needed.

`JsValue` is not iterable, not comparable, not showable — it has no instances. Everything one does with it goes through `kind`, a decoder, or a trusted re-declaration at a boundary. The companion operations take the dot *(#511)*: `v.kind()` and `v.toInt^()` are ordinary companion dispatch (Method Syntax §4.1's boundary row).

---

## 3. `JsValue.kind`

`JsValue.kind : JsValue -> JsKind` — **total and property-free**, per the approved package. The inventory, approved as drafted (§12.1):

```hexagon
union JsKind derives (Eq, Show) =
    Undefined | Null | Bool | Number | BigInt
    | String | Symbol | Function | Array | Object
```

All-nullary, so every value is a shared tagged constant (Unions §6.2). It derives `Eq` and `Show` *(#511)*: the single-kind test `kind(v) == JsKind.Number` is the surface's most common question, and both instances are lawful and trivial on an all-nullary union. (`JsValue` itself still has no instances — §2; the kinds are ordinary domestic data about a foreign value, not the value.)

All ten constructors are qualified-only in the prelude inventory (`JsKind.Undefined`, `JsKind.Null`, …, `JsKind.Object`) in expressions and patterns. They are not auto-imported as bare prelude terms — the prelude's default for every union but the three open ones (Modules §5.5); `ffi.md` §12 records the first case. This ordinary companion qualification leaves the representation unchanged (Part 12 §12).

Classification rules, normative:

- `Undefined`/`Null` by direct comparison; `Bool`/`Number`/`BigInt`/`String`/`Symbol`/`Function` by `typeof`; `Array` by `Array.isArray`; everything else is `Object`.
- **Property-free means property-free**: the implementation never reads a property, never invokes a getter, never triggers a proxy `get`/`has` trap. `typeof` and `Array.isArray` satisfy this (neither consults user-observable traps).
- **Totality survives hostile inputs, including revoked proxies.** `Array.isArray` on a revoked proxy throws a `TypeError`; `kind` **guards that one probe** and classifies a revoked proxy as `Object`, unless the proxy was found to be an array before it was revoked (next bullet). No input makes `kind` throw. (Approved; contrast `toArray`, §4.2, which does not guard.)
- **The finding that an object is an array is kept** (§1). The first time Hexagon finds an object to be an array, by `kind` answering `Array` or by `toArray`'s probe answering true (§4.2), the runtime keeps that finding, and `kind` answers `Array` for that object from then on, even after a proxy over an array is revoked. No other answer of `kind` can change, so asking again is not a read that foreign code can vary: a value's `typeof` is fixed, a value that is not an array never becomes one, and a revoked proxy stays revoked. So `kind` keeps nothing else, and it does not probe again an object found to be an array.
- `kind` reports JavaScript's classification, not Hexagon's: a `Number` may or may not be a safe integer (that is `toInt`'s range check, §4); a `String` result says nothing about content. There is no `Int` kind — the `Int`/`Float` distinction is a Hexagon refinement invisible to `typeof` (Part 1 §4.2).

---

## 4. Checked decoding: the v1 surface

### 4.1 Scalar decoders

```hexagon
JsValue.toInt    : JsValue ->^ Int
JsValue.toFloat  : JsValue ->^ Float
JsValue.toBigInt : JsValue ->^ BigInt
JsValue.toBool   : JsValue ->^ Bool
JsValue.toString : JsValue ->^ String
```

Each is pure and may fail on its own account: a value that is not the target throws `JsConversionError` with the reason below and an empty path (§5). The caller reads the call as any tracked call is read (Effects §3.1, Exceptions §8): `value.toInt^()` passes the failure on, `value.toInt?()` is an `Option(Int)`, `attempt value.toInt^()` keeps it, `assume value.toInt^()` says it cannot happen, and a catch arm takes it apart, where a catch-all shows the rest as its one line (`JsConversionError: not an Int`):

```hexagon
let count(value: JsValue): String =
    try
        "count ${value.toInt^()}"
    catch
        JsConversionError(JsConversionReason.Range, _, _) => "a number, but not an Int"
        e => "${e}"
```

Strictness, per type:

| Decoder | Succeeds iff | Reason on failure |
|---|---|---|
| `toFloat` | `kind` is `Number` (any `number`: `NaN`, infinities, `-0` included) | `Shape` otherwise |
| `toInt` | `kind` is `Number` **and** `Number.isSafeInteger` holds | `Shape` if not a number; **`Range`** if a number outside the safe-integer domain (`1.5`, `2^53`, `NaN`) |
| `toBigInt` / `toBool` / `toString` | `kind` is `BigInt` / `Bool` / `String` | `Shape` otherwise |

`toString` accepts every JavaScript string, including one containing lone UTF-16
surrogates. It preserves the value exactly: decoding performs no Unicode-scalar
validation and never repairs an unmatched surrogate to U+FFFD (String Text
Processing §1).

`toInt` is why the reason classes distinguish `Shape` from `Range`: "not a number at all" and "a number `Int` cannot hold" are different programmer errors with different fixes.

### 4.2 `toArray`: the captured structural door

```hexagon
JsValue.toArray : JsValue ->^ Array(JsValue)
```

Succeeds iff `Array.isArray`; the success value is a **captured `Array(JsValue)`** *(amended #876)* — Hexagon's own copy of the array, made by Part 1 §5.4's walk at `Array(JsValue)`: each index read once in order, each element carried by identity as the uncertain `JsValue` it is, to be decoded individually by the caller; the copy is dense (Part 1 §5.4), and a hole in the source decodes as an `undefined` `JsValue` — a value of the type (§2), not a representation violation. The copy is the acquisition Part 2 §6.2 describes, performed by a named operation instead of a declared position; the result is stable from the moment of success, and the foreign array is not looked at again. A value that is not an array throws `JsConversionError` with reason `Shape` and an empty path. This is deliberately the *only* structural decoder in the core: it is realm-safe and O(n) — the copy reads each element, so it is no longer property-free the way `kind` is, and a hostile element getter or proxy trap that throws during the copy follows the `JsError` channel like the probe below; everything richer belongs to the stdlib decoder library (§13.2) or fell to the classification deferral (§13.1).

**The look is made once per object, and kept** (§1). `toArray`'s look at an object or function is its `Array.isArray` probe and, when the probe answers true, the copy. The probe is not made for an object already found to be an array (§3), and a probe that answers true is that finding. The first call that asks makes the look, and the runtime keeps its outcome beside the value: the copy, the verdict that the value is not an array, or the foreign throw that the probe or the copy raised. Every later call with that value answers from what was kept: the same copy, a `Shape` failure again (a new `JsConversionError`, built by each call that throws it), or the same thrown value again, as a sequence position replays a foreign throw (FFI Part 3 §7.1). So a foreign write to the array after the first look is not seen, and a proxy revoked after a successful look still decodes to the copy made before. A primitive, `null` or `undefined` is not an array, and its `Shape` failure needs no keeping. The kept copy is not the identity cache FFI Part 3 §2.1 rejects. That cache would pin a sequence's whole forced history for as long as the iterable lives, which Part 3 §5 forbids, and would promise a sharing it cannot give across iterables over one cursor. The kept copy is the size its source had when copied, goes when the source goes, and promises nothing beyond its one object. Its one record per program is deliberate (§1): every module sees one look, as with §7's reads.

**A look on a cycle keeps the refusal.** The copy can run foreign code (an index getter, or a proxy's `get` trap on `length` or an index), and that code can reach, through Hexagon, the look itself, by asking for `toArray` of the same value, or any entry in progress around the look: a memoised key, a sequence position, a guarded read or another look whose computation is around it. Either closes a cycle (FFI Part 3 §7.5), and the look is on it; so is a look ended by a replay (FFI Part 3 §7.5). A request for the look itself is refused with `ReentrancyFault` (FFI Part 3 §7.4). A look on a cycle ends in the refusal whatever the copy produced and keeps it, and every later call with that value throws it again. A call with that value while an entry of its cycle is in progress also ends the outermost entry of that cycle in progress, and every computation in progress inside it, in the refusal, and they join the cycle. A look whose copy encloses a cycle without being on it, one closed among entries begun after the look, keeps what it found, as any other entry does.

**The revoked-proxy edge, clarified at review:** unlike total `kind` (§3), `toArray` does **not** suppress a throwing `Array.isArray` probe. A revoked proxy's `TypeError` follows the ordinary `JsError` channel and is not converted into a `JsConversionError`. The asymmetry is the §1 doctrine applied honestly: `kind` promises a classification of *any* value and must absorb the probe to keep that promise; `toArray` promises a verdict about the data, and a throwing probe is foreign control flow, not a data verdict.

### 4.3 The `JsConversionError`/`JsError` split, restated operationally

Decoders inspect: the §4.1 scalar decoders trigger no getter, and `toArray`'s copy reads `length` and each index once, on its first look at an object (§4.2). `toArray` and the conversions that traverse further (Part 10's key ingestion; future library decoders) follow the rule uniformly: inspecting a value and finding it wrong → `JsConversionError`; a foreign operation throwing mid-inspection → `JsError` propagates, and no `JsConversionError` is synthesized from it. **Honest wrongness is a `JsConversionError`; a foreign throw stays a foreign throw.**

This part's composable decoder surface throws `JsConversionError`, and reasons and paths compose: a conversion that descends hands the path so far down to the decode it runs, or catches what that decode threw and throws a new `JsConversionError` with its own segment in front (§6.2). Either way it passes every other failure through untouched. A generated foreign-enum `fromJsT` is instead a closed-set membership projection returning `Option(T)`; other partial projections state their failure type in their owning specification (Part 12 §11.2).

---

## 5. `JsConversionError`

### 5.1 The declaration

*(A tracked exception since #1427; §12.2 records the review's earlier resolution as data.)*

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

exception JsConversionError(
    reason: JsConversionReason,
    path: Vector(JsPathSegment),
    message: String
)
```

All constructors of both unions are qualified-only in the prelude inventory *(#511; Part 12 §12's rule, extended there — and the prelude's default for every union but the three open ones, Modules §5.5)* — `JsConversionReason.Shape`, `JsConversionReason.Range`, `JsConversionReason.Cycle(firstSeen)`, `JsPathSegment.Field(name)`, `JsPathSegment.Index(index)`, and kin, in expressions and patterns alike. They are not auto-imported as bare prelude terms: `Shape`, `Range`, `Field`, and `Index` are ordinary user vocabulary, and the prelude does not spend them. This is ordinary companion qualification and leaves the runtime representations unchanged (Part 12 §12).

- **It is a tracked exception** (Exceptions §1): a failure the caller should plan for, declared in the prelude's `JsValue.hex` and, like every prelude throwable, bare by category (Exceptions §2.1; Modules §5.5). This part's decoders are `->^`; a decoder that takes a callback also follows what it is handed (Effects §2.2's `decodeArray`). The caller reads the call at its site (§4.1). It is the §1 doctrine made structural: **checked wrongness throws `JsConversionError`; foreign thrown control flow travels through `JsError`**, and the two are told apart by constructor.
- **A failed decode builds an `Error`** and captures its stack, as every Hexagon exception does (Exceptions §4, §7.1). A decoder library that tries alternatives in turn pays that once for each one that fails, and chooses among alternatives by `kind` (§3) where it can, which costs none.
- **`message` is one line naming the reason and the path** — `not an Int`, `not a whole number in Int's range at [Index(2)]`, `a cycle at [MapKey(3), Field("next")], first seen at [MapKey(3)]` — so that an uncaught failure, and `"${e}"` (Exceptions §8.6), say what went wrong and where. Its wording is not normative: programs read `reason` and `path`, never the text (the Part 4 §4.3 reporting-layer stance).
- Its boundary face is Exceptions §7.5's throwable face; its `reason` and `path` slots keep Part 7's ordinary union and vector faces.
- **`path` locates the failure**: empty vector = the decoded value itself (every §4.1–4.2 failure has an empty path); segments compose root-outward for nested traversals.
- **Cycles report both paths**: `path` is where the cycle was detected (current), `Cycle`'s payload is where the structure was first seen. The two together name the back-edge, which is the only actionable description of a cycle.
- **All-or-nothing** everywhere it is thrown: a conversion that throws it returns no partial result and leaves no observable state (Part 10 §7.3's rule, stated generally).
- Non-normative: reporting layers may render a richer diagnostic than `message` (path spelled `key[3].name`-style, expected/actual kinds); programs must not parse such renderings either.

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
- `MapKey(position)` / `MapValue(position)` / `SetElement(position)` — collection-entry traversal, identifying the entry by its 1-based source-iteration position, because an arbitrary foreign key cannot itself be carried in a payload (the `KeyFault` nullary rationale, Part 4 §4.3, applied to paths).

### 6.2 Composition

Segments read root-outward: decoding fails at "the `name` field of the 3rd element of the value under the 2nd map key" as

```text
[MapKey(2), Index(3), Field("name")]
```

A producer builds the vector one of two ways, and consumers get one flat vector either way. **Handing the path down**: each level passes the path so far to the decode it runs, which throws once, with the whole path; one `Error` is built however deep the failure. **Catching and throwing anew**: each level catches the `JsConversionError` its inner decode threw and throws a new one, with its segment in front of `path`, in front of a `Cycle`'s `firstSeen` as well so that the two paths keep one root, and with `message` rebuilt for the longer path; a failure at depth *d* builds *d* + 1 `Error`s. Handing the path down is the cheaper way, and the one a decoder library should prefer. The vocabulary is closed in v1 — a future decoder needing a new segment form amends this part rather than minting local conventions.

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
2. Thrown object (an array included, though `kind` names it apart) **or function**: one guarded read of `.message`, made the first time any call asks and kept (below); if the read succeeds and yields a string, that string; otherwise — read throws (getter, proxy trap), property absent, or non-string — the empty string. **The value's `toString` is never invoked** (hostile), and the throwing read is swallowed into `""`, never propagated: an accessor whose purpose is describing one failure must not manufacture a second.

**`stack`:**
1. Thrown non-property-bearing value: `None`.
2. Thrown object (an array included) **or function**: one guarded read of `.stack`, made the first time any call asks and kept; `Some(s)` iff the read succeeds with a string `s`; `None` otherwise (absent, non-string, or a throw, swallowed).

Both accessors are **`->`**, pure and unable to fail, and their calls are bare: `JsError.message(error)`, `JsError.stack(error)`.
- **Each property of a thrown value is read at most once, and kept.** The first call that asks for a thrown object's `.message` reads it, guarded, and the runtime keeps the answer; every later call with the same value answers from what was kept. `.stack` is kept the same way, on its own first read. That is Effects §6.2's species (b), the inbound `Seq` adapter's law (FFI Part 3 §4) applied to a thrown value's properties: the read may run an arbitrary foreign getter or proxy trap, but it runs at most once, and the world can no longer vary the answer. It is the same move as an incoming collection's capture (FFI Part 1 §5.4): Hexagon holds its own copy and the foreign side cannot change it. Only the time differs: a collection is copied as it crosses, because Hexagon is about to read it, and a thrown value's properties when first asked, because most caught failures are never described.
- **What is kept is the answer as read**, unless the read is on a cycle (below), a thrown read included: a getter that throws on the first read is `""` (or `None`) for that value from then on. A foreign write to the property after the first read is not seen.
- **A getter that comes back in reads nothing twice.** A getter that, while its own read runs, asks for the same property of the same value (through an exported Hexagon function that calls the accessor) is answered as a swallowed read, and the value keeps that answer: the getter runs exactly once, and every ask, the outer one included, gets `""` (or `None`). A re-entered `Seq` is refused with a fault (FFI Part 3 §7.3); here the accessors' totality forbids one, so re-entry is the swallowed read the guard already makes of a throw.
- **A read on a cycle keeps the swallowed answer.** A read whose getter reaches any entry in progress around it closes a cycle (FFI Part 3 §7.5): the read itself, when the getter comes back in for its own property, or a memoised key, a sequence position or another guarded read whose computation is around the read, whether the getter reaches it through Hexagon code or by iterating a sequence itself. The read is then on the cycle, and so is a read ended by a replay (FFI Part 3 §7.5). A read on a cycle keeps `""` (or `None`) whatever the getter returned. Reading it again while an entry of its cycle is in progress ends the outermost entry of that cycle in progress, and every computation in progress inside it, in the refusal, and they join the cycle (FFI Part 3 §7.5). A read that encloses a cycle without being on it keeps what the getter returned, as any other read does.
- **The guard is why neither can fail**, as before: the suppressed secondary exception is never propagated.
- **`Show<Exn>` and `Exn.stack` read the same way** (Exceptions §8.6). Describing a foreign throw reads its `.name` with this same guarded read, kept once per value like the other two, and its `.message` and `.stack` through these two accessors, so a value's properties are read once whichever asks first, a `catch` (below) included. Telling a hand-built `JsError(v)` apart reads the brand `$hex` and the payload the same way.
- **A `catch` reads the brand and `name` through the same kept read** (Exceptions §7.4), and so do `attempt`, `assume` and the reading `?`, which emit the same discrimination. So every `catch` of one value tests the same brand and name, and the same arms always pick the same arm; a getter on the brand or the name never throws its own error out of a `catch`. A `catch` and a later `show` of one value read the same brand and name. Where the environment refuses the record a place, all of this holds within each module, and two modules may each make their own read (§1).
- **The keeping is the runtime's, and invisible.** It lives beside the value, not on it, in the one record per program that every module's copy of the lowering reaches (§1, which also says what a write to the record is): the thrown object is never written, so foreign code holding it sees no new property, and the kept answers go when the value does. Richer interrogation of a thrown value — `name`, `cause`, structural decoding — is ordinary `JsValue` decoding with §4's tools and the §13.2 library; these two accessors exist because *every* catch site wants them and they must never make things worse.

---

## 8. `JsValue`, `Nullable`, and trusted declarations

The triangle, settled:

- **`JsValue` vs. a trusted declaration:** the extern author's choice per API honesty (§1). Mixed signatures are normal and encouraged — `extern fun parse(text: String) ->! JsValue` trusts the argument convention while refusing to trust the result.
- **`JsValue` vs. `Nullable(a)`:** `Nullable(a)` is the *typed* nullish door — "a known `a`, or nothing" (Part 2). `JsValue` is the *untyped* door and **absorbs nullishness** rather than wrapping it (§2): "or nothing" is already inside. Decoding a `JsValue` that may be nullish-or-`T` is `kind`-then-decode, or the future library's `nullable(decoder)` combinator.
- **Nullability normalization (resolved, §13.3)** — one idempotency principle, three instances:

  ```text
  Nullable(Nullable(a)) ≡ Nullable(a)
  Nullable(JsValue)     ≡ JsValue
  Nullable(T)           ≡ T        -- T a literal extern enum naming both null and undefined
  ```

  `Nullable` never stacks on a **designated nullish-absorbing type** — a type whose value set already contains both nullish forms, so that the wrapper would add nothing. The designated types are exactly `Nullable(_)` itself (Part 2's existing idempotence), `JsValue` (this part), and a literal `extern enum` naming both `null` and `undefined` (Foreign Enums §2.4 — one named: `Nullable` over it is permitted, adding the missing nullish value without collapse, #786); the list is explicit and closed. **No general structural "contains nullish" analysis exists over arbitrary types** — an opaque extern type that happens to admit `undefined` values, or a union an author believes nullish-adjacent, does not collapse; designation is by rule, not by inspection. The idiom for the three-way nullish split over an uncertain value is `kind` (§3).
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
| decoder finds wrong kind | `JsConversionError` with `reason = Shape` | §4.1, §5.2 |
| `toInt` on a non-safe-integer number | `JsConversionError` with `reason = Range` | §4.1 |
| cycle during a traversing conversion | `JsConversionError` with `reason = Cycle(firstSeen)` — current path + first-seen path | §5.1, §6 |
| hostile trap/getter throws during inspection or traversal | `JsError` propagates; never converted to `JsConversionError` | §1, §4.3 |
| `toArray`'s first look at a revoked proxy | the `TypeError` propagates as `JsError`, and is kept and thrown again by every later call; **not** a `JsConversionError` | §4.2 |
| `toArray` after a proxy is revoked, the first look having succeeded | the kept copy | §4.2 |
| a getter asks for `toArray` of the value whose copy is running it | `ReentrancyFault`, kept and thrown again by every later call | §4.2; FFI Part 3 §7.5 |
| `toArray` copy meets a throwing element getter or trap | `JsError` propagates; **not** a `JsConversionError` | §4.2 |
| `JsValue.from` at an argument type containing an unresolved type variable | hard error naming the variable; rewrites: inject at the concrete type, or pass an explicit conversion function into the generic helper | §2 *(#876)* |
| `kind` on any input, including revoked proxies | total; never throws; revoked proxy classifies `Object`, unless found to be an array before it was revoked | §3 |
| `JsError.message`/`stack` on hostile/degenerate throwables | total; secondary throws suppressed; conservative fallbacks (`""` / `None`) | §7 |
| attempt to spell an unsafe cast | does not exist — no diagnostic to design; the rewrites are "decode it" or "declare it (`extern`)" | §1 |
| `MapValue` segment from a Part 10 conversion | must not occur — implementation bug, not semantics | §6.3 |

---

## 12. Review resolutions: draft completions (closed)

The package fixed semantics; the draft supplied concrete spellings; review resolved each. *(Retitled at finalization; §-numbers stable.)*

1. **The `JsKind` inventory** (§3) — **approved as drafted**: ten kinds including `Array`, `typeof`-aligned plus `Null`; `kind` total and property-free, guarding the `Array.isArray` probe; revoked proxy classifies `Object`.
2. **The error declarations** (§5.1) — **resolved against the draft's exception design**: `JsConversionError` is an ordinary `record` over the `JsConversionReason` union (`Shape | Range | Cycle(firstSeen)`), with the cycle's first-seen path as the `Cycle` payload and entry-position payloads on the collection segments. The exception spelling — `Result.attempt` precedent, throwable-later, branded-`Error` representation, exception `.d.ts` face — is replaced throughout: checked wrongness is ordinary data in `Err`; only foreign thrown control flow travels through `JsError`. *Superseded by #1427:* once expected failures were tracked (Exceptions §1), the declaration became the exception of §5.1, and `Result` came to hold only a caught exception (Option/Result Convenience §1).
3. **The conservative `JsError.message`/`stack` algorithms** (§7) — **approved**, with the explicit extension that objects *and functions* are property-bearing values eligible for the single guarded read; secondary getter/proxy throws remain swallowed into `""`/`None`.
4. **`JsValue.from`** (§2) — **approved**: the total identity injection, erased in emission.

---

## 13. Review resolutions: open questions (closed)

*(Retitled at finalization; §-numbers stable.)*

### 13.1 `JsMap`/`JsSet` classification decoders — deferred from the v1 core

`toJsMap : JsValue ->^ JsMap(JsValue, JsValue)` needs a way to recognize a native `Map`, and no portable `Array.isArray`-equivalent exists: `instanceof Map` is **realm-bound** — a `Map` from an iframe/worker/vm context fails it while being a perfectly good map — and the workable intrinsic brand checks are awkward throw-based probes, sitting badly under this part's probe discipline. **Resolved: deferred**, recorded at §9.2 with that absence as the revisit bar; the decoders ride with the stdlib decoder family (§10's ledger note). Should they land, their success values are **captured** `JsMap`/`JsSet` values (Part 10 §2, #875), copies made by the decoder exactly as `toArray`'s success value is (§4.2).

### 13.2 The decoder library's home — the stdlib listing, confirmed

**Resolved: the boundary is confirmed.** This part owns `JsValue`, `JsKind`, the strict scalar decoders, `toArray`, the conversion-error structure, the path vocabulary, and the failure-channel doctrine. The stdlib listing owns field/record traversal, element-wise decoders, `nullable`, `oneOf`, defaults, map/set decoders, and related combinators — entered in the global stdlib-listing ledger per `spec/notes/v1-spec-consolidation-plan.md` (§10).

### 13.3 `Nullable(JsValue)` — definitional collapse, confirmed

**Resolved: option (a).** `Nullable(Nullable(a)) ≡ Nullable(a)` and `Nullable(JsValue) ≡ JsValue` are one idempotency principle over the closed set of designated nullish-absorbing types (§8), with no general structural "contains nullish" analysis over arbitrary types. Propagation to Part 2 is §10's edit note.

---

## 14. Decisions log (quick reference)

| Decision | Where |
|---|---|
| Two-door doctrine: trust → `extern` declaration; doubt → `JsValue` + strict checked decode; **no unsafe casts in v1** (no expression-level bypass; every unchecked claim lives in a findable `extern` block) | §1 |
| `JsConversionError` = data wrongness (shape/range/cycle); `JsError` = foreign code throwing; never mixed, never synthesized across *(#1427: both are throwables, told apart by constructor)* | §1, §4.3 |
| `JsValue`: final name; any JS value by identity; faces `unknown` (never `any`); **includes `null`/`undefined`** — not `Nullable(JsValue)`; no instances; total injection `JsValue.from` — *(#876)* a **release seat** that walks its argument at the concrete type (identity, erased, when nothing is captured), **refused at an unresolved type variable**, never an identity fallback | §2 |
| `JsValue.kind`: total, property-free, ten-kind inventory; `typeof` + `null` + `Array.isArray`; hostile-input totality incl. revoked proxies → `Object` | §3 |
| All constructors of `JsKind`, `JsConversionReason`, and `JsPathSegment` are qualified-only through their companions *(the latter two: #511; the prelude's default under Modules §5.5)*; no bare prelude auto-import; representations unchanged; `JsKind` derives `Eq` and `Show` *(#511)* | §3, §5.1; Part 12 §12 |
| Strict non-coercing scalar decoders, `->^`, throwing `JsConversionError` *(#1427)*; `toInt` splits `Shape`/`Range` via `isSafeInteger`; `toArray` = realm-safe **captured** `Array(JsValue)` — a copy, O(n) *(#876; formerly a zero-copy view)*; **`toArray` does not guard the `Array.isArray` probe — a revoked-proxy throw is `JsError`, never a `JsConversionError`**, and a throw during the copy is `JsError` too | §4 |
| Failure-type ownership: this composable decoder surface throws `JsConversionError` *(#1427)*; foreign-enum membership projection uses `Option`; other projections state their own type | §4.3; Part 12 §11.2 |
| **`JsConversionError` is a tracked exception** *(#1427; the review's resolution as data, §12.2, superseded)*: `exception JsConversionError(reason, path, message)` over `JsConversionReason = Shape \| Range \| Cycle(firstSeen)`; a prelude exception, bare by category; throwable face (Exceptions §7.5); `path` vector, empty = the value itself; all-or-nothing; `message` one line, its wording non-normative | §5, §12.2 |
| Path vocabulary closed at five segments: `Field`, `Index` (1-based), `MapKey`/`MapValue`/`SetElement` (1-based source-iteration position); root-outward composition; corpus-wide | §6.1–6.2 |
| **Part 10 correction:** its shallow conversions originate `MapKey`/`SetElement` only; `MapValue` reserved for value-traversing conversions; `Field`/`Index` originate from none of the v1 core surface | §6.3 |
| `JsError.message`/`stack` are `->`: each property of a thrown value is read once, guarded, on first use, and the answer kept (Effects §6.2 species (b)), so the read is a value; the guard's suppression is why neither can fail | §7 |
| *(2026-11-03, memoization's cycle ruling)* A guarded read is a keeper under FFI Part 3 §7.5: a read on a cycle keeps its swallowed answer whatever the getter returned, and reading it again while an entry of that cycle is in progress ends the outermost such entry, and every computation in progress inside it, in the refusal; a read that only encloses a cycle keeps what it read | §7 |
| *(2026-11-03, #1447)* Hexagon looks inside a foreign object at most once and keeps what it saw beside the object, in one record per program (Effects §6.2 species (b)): the finding that an object is an array, by `kind` or by `toArray`'s probe, is kept for `kind`; `toArray` keeps its look (the copy, the not-an-array verdict, or the foreign throw), and a look on a cycle keeps the refusal (FFI Part 3 §7.5); a `catch`, `attempt`, `assume` and the reading `?` read a thrown value's brand and name through §7's kept read; a foreign write to the record is a contract violation, and where the environment refuses the record a place on the global object each module keeps its own | §1, §3, §4.2, §7; Exceptions §7.4 |
| `JsError.message` total: primitives render safely; objects **and functions** get one guarded `.message` read, `toString` never invoked, secondary throws suppressed → `""`; `JsError.stack` total: guarded `.stack` read → `Option`, `None` on anything else | §7, §12.3 |
| `Nullable(a)` = typed nullish door; `JsValue` = untyped door absorbing nullish; **one idempotency principle over designated nullish-absorbing types: `Nullable(Nullable(a)) ≡ Nullable(a)`, `Nullable(JsValue) ≡ JsValue`, `Nullable(T) ≡ T` for a literal extern enum naming both nullish values (Foreign Enums §2.4); closed designation, no structural nullish analysis**; mixed trusted/uncertain signatures encouraged; `JsValue` legal in every direct position | §8, §13.3 |
| Decoder library confirmed to the stdlib listing (ledger entry issued); `toJsMap`/`toJsSet` deferred from the v1 core — revisit bar: no portable `Array.isArray`-equivalent (cross-realm `instanceof` failure; awkward throw-based intrinsic brand checks); JSON, serialization untouched | §9, §13.1–13.2 |
| Edit notes: Part 1 §4.1 `JsValue` row finalized; Exceptions §6.1 accessor debt discharged; `Nullable(JsValue) ≡ JsValue` propagated to Part 2; composable `JsValue` decoder family added to the global stdlib-listing ledger | §10 |
