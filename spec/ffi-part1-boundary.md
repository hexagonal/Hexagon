# Hexagon FFI Part 1: Boundary Doctrine and Type Mapping

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing. Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §1 and §4, drafted per `spec/notes/ffi-roadmap.md` Part 1. The two questions the draft recorded as promotion blockers (`Range`'s foreign face, §8.1; opaque Promise handles, §4.4) were resolved by James and Sol before promotion.
**Scope:** The trusted, fast boundary and its failure doctrine; the four boundary categories (representation-direct / borrowed foreign view / adapted foreign capability / converted value); the master Hexagon-to-JavaScript/TypeScript type mapping table; opaque extern Promise handles (§4.4); shallow conversion and the nested-adaptation restriction; the numeric trust rule; foreign throws at the boundary; and the `Hex` runtime type namespace for generated declarations, including `Hex.Range` (§8.1).
**Not in scope:** `Nullable(a)` and `Array(a)` companion surfaces (Part 2, `ffi-part2-nullable-array.md`); `Seq(a)` adaptation mechanics (Part 3, `ffi-part3-seq.md`); `extern` syntax and module binding (Part 4); receiver members and classes (Part 5); calling convention and callbacks (Part 6); the export surface and `.d.ts` generation rules (Part 7); constrained exports and dictionaries (Part 8, `ffi-zero-cost-fundamental-exports.md`, and Part 9); JavaScript `Map`/`Set` (Part 10); `JsValue` and checked decoding (Part 11). Where this document's table names those types, it fixes only their **category** and links forward.
**Companions:** Primitive Types §1–§2, §9; Products §2.6/§3.5/§5.4; Unions §6; Exceptions §6–§7; Modules §11–§12; Loops/Ranges/Iteration §6; Collections Part 4 §10; Collections Part 5 §6; `ffi-foreign-enums.md`.

---

## 1. Doctrine

The Hexagon FFI boundary is JavaScript/TypeScript, and emitted code is readable ESM.

> **A checked `extern` declaration is principally a trusted programmer assertion. Ordinary calls receive no general runtime shape validation.**

The compiler validates the Hexagon declaration itself — its syntax, its types, its boundary category legality (§5.3) — and then trusts it. The binding author is responsible for asserting that the foreign implementation satisfies the declaration. This is the boundary's performance contract: ordinary, correctly declared foreign calls cross at exactly their declared category's cost — representation-direct in the common case, one supported adapter at a declared `Seq(a)` position — with no general guards, defensive wrappers, or scans.

Consequences fixed here:

- **Conversion is type-directed and per declared layer.** The declared type at each boundary position determines what (if anything) happens there; no runtime classification, probing, or reflection substitutes for the declaration.
- **Validation lives only in named operations** whose purpose is to establish an invariant, or where protocol participation inherently requires a check (§3.2).
- **Foreign throws enter through exactly one door, `JsError`** (§7; Exceptions §6). No arbitrary thrown value is decoded.
- **`extern` imports are leaf edges** for Hexagon's module acyclicity rule. Hexagon does not inspect or certify cycles internal to foreign JavaScript modules.
- **No general reflection**, prototype-driven type dispatch, or automatic foreign instance search exists at the boundary.

---

## 2. The four boundary categories

Every **boundary occurrence** falls under exactly one of four categories. The first three classify how a value of a declared type crosses at a boundary position; the fourth classifies explicit named operations, not types — the same type can cross directly or under borrow at its declared positions *and* be the subject of a converted operation (`Vector` is representation-direct; `Vector.toArray` is a conversion). These names are the standard vocabulary of the whole FFI corpus; later parts use them without redefining them.

### 2.1 Representation-direct

The runtime value already has the declared JavaScript representation and crosses **unchanged** — no wrapper, no copy, no check. Primitives, `Unit`, tuples, records, unions, `Option(a)`, `Nullable(a)`, opaque values, exceptions, genuine runtime collection values (`Vector`, persistent `Map`/`Set`), opaque extern types, representation-direct boundary functions, and every callback signature admitted in v1 are representation-direct (§4). Ordinary boundary functions with a supported top-level adapted position instead receive the stable wrapper described by Parts 3 and 7.

### 2.2 Borrowed foreign view

Zero-copy, foreign-owned storage that Hexagon can only **observe**, under a stability/lifetime contract stated by the owning part. Foreign code owns the storage; Hexagon gains no mutation capability. `Array(a)` is the v1 borrowed view (Part 2); future `JsMap`/`JsSet` views belong to Part 10.

### 2.3 Adapted foreign capability

A supported **top-level** boundary wrapper establishes stronger Hexagon semantics over a foreign protocol. The v1 instance is foreign `Iterable<a>` entering `Seq(a)` through the persistent memoizing adapter (Part 3). Adaptation is automatic and type-directed at supported top-level positions; it is never implicit inside an aggregate (§5.3).

### 2.4 Converted value

An explicit, eager, named operation traverses or constructs a new representation: `Array.toVector`, `Vector.toArray`, `Map.toJsMap`/`Map.fromJsMap`, `Set.toJsSet`/`Set.fromJsSet`, checked decoders. Conversions state their own cost and failure contracts; their names state both the work performed and its cost boundary (§5.1).

---

## 3. Trust, validation, and the two failure kinds

### 3.1 Contract violation: unspecified observations

When foreign code violates a trusted declaration or a borrow contract — a non-integral `number` behind an `Int` declaration, a mutated array behind a live `Array(a)` borrow — the affected Hexagon observations are **unspecified**. This does not imply memory unsafety; it means Hexagon promises nothing about the affected contents, order, length, or derived results. Informally this is a cultural responsibility — binding authors check that the JavaScript API really satisfies the declaration — but normatively it is a programmer-supplied boundary contract.

### 3.2 Where checks lawfully live

Validation occurs only where the named operation exists to establish an invariant or where protocol participation inherently requires a check:

- numeric narrowing (`BigInt.toInt`, and any Float/unknown-to-`Int` conversion; §6);
- explicit decoding of uncertain values (Part 11);
- the minimum iterator-protocol check native iteration performs (malformed `next()` results; Part 3);
- cycle detection during structural-key ingestion (Collections Part 4 §10; Part 10);
- and similar conversion-owned cases.

Constraint-dictionary evidence introduces no v1 boundary validation of its own; its rules are Parts 8–9's.

### 3.3 Defined conversion failure

When an explicit checked decoder or converter encounters **valid foreign input outside its representable domain**, its own specified `Option`/`Result`/exception failure applies. Contract violation (§3.1) and defined conversion failure are distinct: the first is a broken promise with unspecified consequences; the second is a specified, ordinary result.

> **The dividing rule:** declaring a foreign value to have a type is trusted. Explicitly converting or decoding an uncertain value into a narrower type is checked.

---

## 4. Master type mapping

### 4.1 The table

For each Hexagon type: its JavaScript runtime representation, its generated `.d.ts` face, its boundary category (§2), and its failure mode. `Hex.` faces use the §8 namespace import.

| Hexagon type | JS runtime representation | `.d.ts` face | Category | Failure mode |
|---|---|---|---|---|
| `Int` | `number` satisfying `Number.isSafeInteger` | `number` | direct | trusted; violation → §3.1 |
| `Float` | any `number` (incl. `NaN`, infinities, `-0`) | `number` | direct | trusted |
| `BigInt` | `bigint` | `bigint` | direct | trusted |
| `Bool` | `boolean` | `boolean` | direct | trusted |
| `String` | `string` | `string` | direct | trusted |
| `Unit` | `undefined` | `void` (return position), `undefined` elsewhere | direct | trusted |
| Tuple | plain JS array | TS tuple type (`[number, string]`) | direct | trusted |
| Structural record | POJO | structural object type | direct | trusted |
| Nominal `record` (non-opaque) | POJO (structurally represented) | structural object type; constructor per Part 7 | direct | trusted |
| `union` (all-nullary) | string literals | string-literal union | direct | trusted; representation cliff noted in Part 7 |
| `union` (any payload) | string-tagged POJOs (Unions §6.1) | discriminated union on `tag` | direct | trusted |
| `extern enum` | captured foreign enum-object values | per `ffi-foreign-enums.md` | direct | trusted; checked `fromJsT` for uncertain data |
| `Option(a)` | its real union representation (`{tag:"Some"; value:a}` / shared `{tag:"None"}` constant) | the discriminated union — **never erased to nullability** | direct | trusted |
| declared `exception` values (e.g. `ParseError`) | branded `Error` (Exceptions §7.1) | `Error & {$hex: true; name: "..."; ...}` (Exceptions §7.5; export surface Part 7) | direct | trusted |
| `Exn` (in exported signatures) | whatever was thrown — branded `Error` or the raw foreign throwable | plain `Error` (Exceptions §7.5's accepted white lie) | direct | trusted |
| `Range` | materialized range object implementing the JS iterable protocol (Loops §8) | `Hex.Range` — opaque branded interface extending `Iterable<number>` (§8.1) | direct | trusted |
| opaque extern Promise handles | the foreign `Promise` object, unchanged and by identity | the declared opaque type, per the general extern-type facing rule (Parts 4/7) | direct | trusted; §4.4 (rejection is a foreign async event) |
| Functions (boundary signatures) | n-ary JS function, same visible argument order | function type | direct in the common case; a supported top-level adapted position (e.g. `Seq(a)`) adds the one stable boundary adapter/wrapper (Part 3; Part 7) | trusted; foreign throws → §7 |
| Callbacks (function-typed arguments/results) | the same JS function object in both directions | function type | direct — v1 admits **only** representation-direct callback signatures (Part 6) | trusted; adapter-requiring callback signatures are a v1 hard error (Part 6) |
| `Nullable(a)` | `a \| null \| undefined` (zero wrapper) | `a \| null \| undefined` | direct | trusted; companion surface in Part 2 |
| `Array(a)` | foreign-owned JS array, readonly to Hexagon | `ReadonlyArray<a>` | **borrowed** | stability contract in Part 2; violation → §3.1 |
| `Seq(a)` outbound (Hexagon sequence to JS) | the runtime sequence value, natively implementing the JS iterable protocol; each `[Symbol.iterator]()` yields an independent replayable cursor | `Iterable<a>` | direct | Part 3; trusted |
| `Seq(a)` inbound (foreign `Iterable<a>` to Hexagon) | persistent memoizing adapter over one foreign iterator, requested on first demand | `Iterable<a>` | **adapted** (top-level only; §5.3) | Part 3; protocol throws → §7 |
| `Vector(a)` | the runtime trie object **is** the value (identity crossing) | `Hex.Vector<a>` | direct | trusted |
| persistent `Map(k, v)` / `Set(a)` | runtime HAMT objects (identity crossing) | `Hex.Map<k, v>` / `Hex.Set<a>` | direct | trusted; snapshot conversions are **converted** (Part 10 inherits Collections Part 4 §10) |
| foreign `JsMap` / `JsSet` (names open) | native JS `Map` / `Set` | provisionally `ReadonlyMap<k, v>` / `ReadonlySet<a>` | borrowed | Part 10 — **not yet decided** (§10) |
| `JsValue` (name open) | arbitrary JS value, opaque | `unknown` (provisional) | direct (opaque); decoding is converted & checked | Part 11 — **not yet decided** (§10) |
| extern `type` (opaque foreign type) | whatever the foreign API supplies; Hexagon sees no structure | the declared named type | direct | trusted |
| `opaque record` / `opaque union` | the erased underlying runtime value (no wrapper added) | TS `unique symbol` brand hiding the representation (Part 7) | direct | trusted |

### 4.2 Reading the table

- **"Trusted" failure mode** means §3.1 governs: no per-call validation exists, and a violated declaration yields unspecified observations. Specified failure results (§3.3) belong to *converted* operations (§2.4) — named conversions and decoders over these types, not rows of this table, which classifies crossing positions.
- **`Int` versus `Float`:** TypeScript cannot express the `Int` refinement — both face as `number`. The distinction remains part of the generated contract and its documentation (§6).
- **`Option(a)` is never nullish.** It crosses as its genuine union representation. `Nullable(a)` is the explicit nullish foreign door, and conversion between them is explicit (Part 2). `Unit`'s `undefined` representation is likewise unrelated to nullability (Primitive Types §9).
- **Runtime collection values cross by identity.** A `Vector` handed to JavaScript, stored there, and returned to Hexagon is the same value; the trie-backed runtime object is the Hexagon value, not a wrapper around one.
- **Nominal records** are structurally represented at the boundary unless `opaque` changes the boundary face; the constructor/`.d.ts` details are Part 7's.

### 4.3 Forbidden and deferred in `extern` signatures and exports

- **Adapter-requiring types in nested positions** are rejected (§5.3) — the only v1 shape-legality rule beyond the type system itself.
- **Bare `Iterator<a>`** does not satisfy a `Seq(a)` position; the v1 boundary accepts `Iterable<a>` only (Part 3).
- **Async surfaces are deferred, not designed here.** The decided exclusions are: no async sequence boundary until the async specification defines its types and rejection semantics; and no Promise-returning or async callbacks in v1 (Part 6). Opaque extern **Promise handles** are nonetheless permitted — §4.4 is the governing decision.
- **No mutable Hexagon array type exists**; `Array(a)` is the readonly foreign door.
- Rest/variadic, overloaded, and optional-parameter extern signatures are deferred (Part 4/Part 6 record the fixed-arity rule).

### 4.4 Opaque extern Promise handles

> **V1 permits an opaque extern type whose underlying foreign representation is a JavaScript Promise. It crosses representation-directly, by identity, and may be stored, passed, or returned unchanged — never wrapped. This introduces no Hexagon `Promise(a)`, no `async`/`await`, no automatic settlement conversion, no cancellation, no scheduling, and no rejection handling.**

- **Failure split:** a synchronous throw from a Promise-returning extern call follows the ordinary `JsError` path (§7). Later rejection of the held Promise is a **foreign asynchronous event** — invisible to Hexagon unless a declared foreign operation delivers it to a callback.
- **`.d.ts` face:** a Promise-backed handle follows the *general* extern opaque-type facing rule (declaration syntax Part 4; export faces Part 7); nothing Promise-specific is added. If that rule faces the type as a bare opaque name, a JS consumer receiving the handle back cannot `await` it type-safely — an ergonomic consequence recorded here, decided there.
- **Settlement-observing members** (`then`/`catch`/`finally`-shaped declarations) are declarable only as ordinary extern members under the general rules — Part 5 for receiver members, Part 6 for callback signatures — and confer **no** Hexagon-level async semantics: microtask timing, callback ordering, and rejection routing remain entirely foreign. A rejection delivered to a declared callback is an ordinary foreign call into a Hexagon function, nothing more. The async specification is the intended home for settlement observation; hand-rolled `then` bindings should expect to be superseded.
- **No callback exception:** fulfillment/rejection callbacks must have representation-direct signatures like every other v1 callback (Part 6). Promise support does not loosen that rule.
- **No Promise-specific generic or structural form is introduced here.** Whether extern types *generally* may be parameterized is Parts 4–5's question and is not decided by this section. The async specification alone owns `Promise(a)`.
- **Binding-author documentation obligation:** the compiler cannot discover a Promise representation behind opacity, so the warning is the binding author's to supply: that holding a handle neither observes nor suppresses settlement; that unhandled-rejection behavior is host-defined, including possible process termination; and what settlement obligations the bound API imposes. Generated FFI documentation **preserves the supplied warning** rather than inventing it.
- **No compile-time diagnostic exists, on principle:** any Promise-specific diagnostic would require the compiler to know a foreign representation behind an opaque type, contradicting the opacity doctrine. Its absence is a decision, not an omission.
- **Non-constraint clause:** the async specification owns `Promise(a)`, `await`, `AsyncSeq`, combinators, cancellation, and rejection integration, and owes these opaque handles nothing beyond their ordinary extern validity. No compatibility, migration, or naming commitment is created here.

---

## 5. Shallow conversion and nested adaptation

### 5.1 Named conversions are shallow

A named collection conversion changes **only the collection explicitly named by the operation**. It preserves element values and their runtime identities:

```text
Vector.toArray : Vector(Vector(Int)) -> Array(Vector(Int))
Map.toJsMap    : Map(k, v) -> JsMap(k, v)
Set.toJsSet    : Set(a) -> JsSet(a)
```

`Vector.toArray` does not recursively produce `Array(Array(Int))`; `Map.toJsMap` does not translate its values; `Set.toJsSet` does not reinterpret its elements. A caller wanting nested conversion maps the appropriate explicit conversion over the nested values. Conversion names therefore state both the work performed and its cost boundary.

### 5.2 An `extern` signature is a recursive representation contract

The declaration asserts the representation of the whole nested value; it never requests an implicit graph traversal:

```hexagon
extern fun rows(): Array(Vector(Int))
```

asserts that the returned value is a JavaScript array containing genuine `@hexagon/runtime` Vector values. `ReadonlyArray<Hex.Vector<number>>` is its legitimate `.d.ts` face; the outer `Array` remains a zero-copy borrowed foreign array.

**Nested representation-direct values are permitted**: primitives and native values, `Nullable`, further `Array` layers, records and unions in their specified emitted representations, and genuine runtime values (`Vector`, persistent `Map`/`Set`), each under its ordinary declared contract.

### 5.3 The nested-adapter restriction (v1, hard error)

V1 **rejects** an adapter-requiring type when it appears inside a representation-direct aggregate or borrowed container and cannot be made valid without traversing, copying, proxying, or wrapping that enclosing value. The canonical case:

```hexagon
extern fun streams(): Array(Seq(Int))
```

An arbitrary `ReadonlyArray<Iterable<number>>` cannot satisfy this declaration honestly: each iterable may require the persistent memoizing `Seq` adapter, while `Array(a)` promises zero-copy direct indexing and iteration. The same rule applies to an adapter-requiring value nested in a direct record, tuple, union payload, or other unwrapped aggregate.

Per the Rewrite Rule, the diagnostic must identify the nested adapter-requiring type and name the local rewrite: an explicit eager conversion/adaptation step at a controlled boundary (or a small foreign shim). Top-level adaptation remains supported, and explicit converters may deliberately traverse a foreign structure — stating their failure and complexity contracts, since they are not zero-copy.

V1 does not attempt proxies, lazy per-field adaptation, automatic deep conversion, or replayability inference to lift this restriction. Whether a later version can safely generalize nested adapters is **deferred without a design commitment**; it is not required for the v1 FFI.

---

## 6. The numeric boundary

The primitive representation requirements (the trusted assertions behind the §4.1 rows):

| Hexagon type | Required JavaScript value |
|---|---|
| `Int` | a `number` satisfying `Number.isSafeInteger(value)` |
| `Float` | any `number`, including `NaN`, infinities, and `-0` |
| `BigInt` | a `bigint` |
| `Bool` | a `boolean` |
| `String` | a `string` |

Thus:

```hexagon
extern fun count(): Int
extern fun measurement(): Float
extern fun population(): BigInt
extern fun counts(): Array(Int)
```

assert respectively a safe integral number, an arbitrary JS number, a JS bigint, and a borrowed array whose observed elements are safe integral numbers. **The compiler inserts no per-call numeric guards and does not scan `Array(Int)` merely to validate its elements** (the zero-scan rule).

Dynamic checks belong to operations whose purpose is to establish a narrower invariant from an uncertain value:

```hexagon
BigInt.toInt  : BigInt -> Option(Int)
```

`BigInt.toInt` checks range; a Float- or unknown-value-to-`Int` conversion uses `Number.isSafeInteger`; an explicit structural decoder for an unknown array of integers must inspect every element and is necessarily O(n). None of this weakens the zero-scan rule for a trusted declaration.

Existing semantic checks are unchanged and are promises of their named operations, not FFI validation: checked arithmetic checks safety, division checks zero, and integer exponentiation checks negative exponents where their owning specs require it. Ordinary `Int` arithmetic retains Primitive Types §2.1's unchecked plain-JS overflow policy.

---

## 7. Foreign throws

Foreign throws participate in ordinary Hexagon `try`/`catch` through the prelude exception `JsError(error: JsValue)` — Exceptions §6 is authoritative for the mechanism (two-stage brand discrimination, virtual wrapping, identity-preserving rethrow). This part fixes only the boundary-facing doctrine:

- **Everything JavaScript can throw arrives as a `JsError`.** No arbitrary thrown value is decoded into a structured Hexagon exception; classification of foreign errors is userland via the `JsValue` accessor surface (Part 11).
- Throws surfacing from boundary machinery itself — iterator-protocol methods and property accessors during `Seq` adaptation, foreign property reads, conversion traversals — follow this same path unchanged, unless a specific conversion's spec assigns them a defined failure (§3.3).
- Branded Hexagon exceptions crossing outward remain ordinary JS throws of branded `Error` values (Exceptions §7; export faces in Part 7).

---

## 8. The `Hex` runtime type namespace

Generated `.d.ts` files that mention Hexagon-owned runtime types use one type-only namespace import:

```ts
import type * as Hex from "@hexagon/runtime";
```

Their public faces are `Hex.Vector<a>`, `Hex.Map<k, v>`, `Hex.Set<a>`, and `Hex.Range` (§8.1):

```ts
import type * as Hex from "@hexagon/runtime";

export declare function makeRow(): Hex.Vector<number>;

export declare function process(
  rows: ReadonlyArray<Hex.Vector<number>>,
): void;

export declare function index():
  Hex.Map<string, Hex.Vector<number>>;
```

- `Hex.Map` and `Hex.Set` are visibly distinct from JavaScript's native `Map` and `Set`; `Hex.Vector` is visibly a runtime-owned persistent value rather than `ReadonlyArray`. The import is type-only and by itself adds no emitted JavaScript dependency.
- The runtime package exports the naturally named public types `Vector`, `Map`, `Set`, and `Range`; **`Hex` is the generated file's local namespace alias**, not a claim on a global identifier. The compiler controls the alias in its generated declarations and must resolve the rare collision with a user-exported local `Hex` name **deterministically**, while preserving `Hex` as the normal spelling. (The exact deterministic renaming scheme is an implementation obligation of the `.d.ts` generator; recorded in §10.)
- `Hex` is the standard short form for tooling and generated foreign surfaces, aligned with the `.hex` source extension and the `hexc` compiler name. The mental model resembles C++'s `import std;` plus `std::…`: one short namespace houses the runtime vocabulary. JavaScript operation exports may support a matching `Hex.Vector.get(...)` style through the runtime's public module surface, but the type-only declaration import does not by itself dictate that runtime export organization.

### 8.1 `Hex.Range`

`Range`'s foreign face is **`Hex.Range`: an opaque branded interface extending `Iterable<number>`**. It exposes iteration and nothing else — no representation fields (bounds, step, or direction) appear on the face — and the brand means an **arbitrary `Iterable<number>` does not satisfy `Hex.Range`**. A JS consumer can traverse a crossed `Range`; only a genuine runtime-originated `Range` value satisfies the type. This resolves Loops §8's either/or (range-object interface versus `Iterable<number>`) as: both, in the only compatible order — a branded interface that *extends* the iterable protocol.

> **Edit note (for Loops/Ranges/Iteration §8, applied on next touch):** the "range object's interface (or `Iterable<number>`)" alternative for `Range`'s `.d.ts` face is resolved by this section: the face is `Hex.Range`, branded, extending `Iterable<number>`.

---

## 9. Diagnostics checklist

All hard errors, per the Rewrite Rule (each names its local rewrite):

| Situation | Diagnostic |
|---|---|
| Adapter-requiring type nested in a representation-direct aggregate or borrowed container (§5.3) | hard error naming the nested type; rewrite: explicit eager conversion/adaptation at a controlled boundary, or a foreign shim |
| Bare-`Iterator` shape offered where `Seq(a)` is declared | not statically detectable (trusted boundary); Part 3 documents the foreign obligation to supply an `Iterable` |

Async-callback rejection diagnostics belong to Part 6 with the rest of the callback rules (§4.3 records only that the exclusion is decided). No Promise-handle diagnostic exists, on principle (§4.4): the compiler cannot see a foreign representation behind opacity.

Diagnostics for extern declaration *syntax* (callable `let`, missing subject parameters, etc.) belong to Parts 4–5.

---

## 10. Open questions (recorded, not decided)

Deliberately left open here; nothing in this document may be read as deciding them. All are owed to the later parts named. (The two former promotion blockers — `Range`'s foreign face and Promise-bearing extern declarations — were resolved by James and Sol and are now normative in §8.1 and §4.4 respectively.)

1. **`JsValue`** — final name (`JsValue` vs `Foreign` vs other), accessor set, `unknown` face confirmation, decoding surface, conversion-failure representation, path diagnostics, and cycle policy (Part 11; Exceptions §10 concurs).
2. **Foreign `JsMap`/`JsSet`** — final type names and accessor surfaces, coupled to `ReadonlyMap`/`ReadonlySet` faces (Part 10). The §4.1 row is categorical only.
3. **The deterministic `Hex`-alias collision scheme** (§8) — the exact renaming algorithm when a module exports a local `Hex` name; an implementation decision of the `.d.ts` generator to be fixed no later than Part 12.
4. **A common conversion-failure exception versus per-conversion result types** (§3.3 fixes only that defined failures exist and are distinct from contract violations; the shared shape, if any, is Part 10/Part 11 work).

---

## 11. Decisions log (quick reference)

| Decision | Where |
|---|---|
| Checked `extern` = trusted programmer assertion; no general runtime shape validation | §1 |
| Four-category vocabulary: representation-direct / borrowed / adapted / converted | §2 |
| Contract violation → unspecified observations (not unsafety); distinct from defined conversion failure | §3 |
| Checks live only in named invariant-establishing operations and inherent protocol participation | §3.2 |
| Master mapping table incl. `Option` never erased to nullability; runtime collections cross by identity | §4 |
| `Nullable`/`Array` borrowed-vs-direct categories fixed; surfaces owed to Part 2; `Seq` direct outbound and adapted inbound, mechanics owed to Part 3 | §4.1 |
| Named conversions are shallow; extern signatures are recursive representation contracts | §5.1–§5.2 |
| Nested adapter-requiring positions are a v1 hard error with a named rewrite | §5.3 |
| Numeric trust table; zero per-call guards; zero-scan rule; the dividing rule (trusted declaration vs checked conversion) | §6 |
| One foreign-throw door: `JsError`; no decoding of arbitrary thrown values | §7 |
| Type-only `import type * as Hex from "@hexagon/runtime"`; `Hex.Vector`/`Hex.Map`/`Hex.Set` faces | §8 |
| Opaque extern Promise handles: representation-direct by identity; no Hexagon async semantics; settlement observation only via ordinary extern members; binding-author warning obligation (docs preserve, never invent); no diagnostic on principle; async spec unconstrained | §4.4 |
| `Range` faces as `Hex.Range`: opaque branded interface extending `Iterable<number>`; no representation fields; arbitrary `Iterable<number>` does not satisfy it (edit note to Loops §8 issued) | §8.1 |
