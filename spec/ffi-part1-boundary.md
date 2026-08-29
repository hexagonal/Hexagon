# Hexagon FFI Part 1: Boundary Doctrine and Type Mapping

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing. Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §1 and §4, drafted per `spec/notes/ffi-roadmap.md` Part 1. The two questions the draft recorded as promotion blockers (`Range`'s foreign face, §8.1; opaque Promise handles, §4.4) were resolved by James and Sol before promotion. Amended 2026-08-02 (#128 ruling): §8's type-import target is re-grounded from a package that does not exist to the compiler-emitted runtime declaration module — §8.3; brand mechanism fixed and alternatives recorded — §8.3–§8.4.
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

The runtime value already has the declared JavaScript representation and crosses **unchanged** — no wrapper, no copy, no check. Primitives, `Unit`, tuples, records, unions, `Option(a)`, `Nullable(a)`, opaque values, exceptions, genuine runtime collection values (`Vector`, persistent `Map`/`Set`), opaque extern types, representation-direct boundary functions, and every callback signature admitted in v1 are representation-direct (§4). Ordinary boundary functions with a supported top-level adapted position instead receive the stable wrapper described by Parts 3, 4, and 7.

### 2.2 Borrowed foreign view

Zero-copy, foreign-owned storage that Hexagon can only **observe**, under a stability/lifetime contract stated by the owning part. Foreign code owns the storage; Hexagon gains no mutation capability. `Array(a)` is specified by Part 2; `JsMap(k, v)` and `JsSet(a)` are specified by Part 10.

### 2.3 Adapted foreign capability

A supported **top-level** boundary wrapper establishes stronger Hexagon semantics over a foreign protocol. The v1 instance is foreign `Iterable<a>` entering `Seq(a)` through the persistent memoizing adapter (Part 3). Adaptation is automatic and type-directed at supported top-level positions; it is never implicit inside an aggregate (§5.3).

### 2.4 Converted value

An explicit, eager, named operation traverses or constructs a new representation: `Array.toVector`, `Vector.toArray`, `Map.toJsMap`/`Map.fromJsMap`, `Set.toJsSet`/`Set.fromJsSet`, checked decoders. Conversions state their own cost and failure contracts; their names state both the work performed and its cost boundary (§5.1).

---

## 3. Trust, validation, and the two failure kinds

### 3.1 Contract violation: unspecified observations

When foreign code violates a trusted declaration or a borrow contract — a non-integral `number` behind an `Int` declaration, a mutated array behind a live `Array(a)` borrow — the affected Hexagon observations are **unspecified**. This does not create memory unsafety; it means Hexagon promises nothing about the affected contents, order, length, or derived results. Informally this is a cultural responsibility — binding authors check that the JavaScript API really satisfies the declaration — but normatively it is a programmer-supplied boundary contract.

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
| `Nat` | non-negative `number` satisfying `Number.isSafeInteger` | `number` | direct | trusted; violation → §3.1 |
| `Int` | `number` satisfying `Number.isSafeInteger` | `number` | direct | trusted; violation → §3.1 |
| `Float` | any `number` (incl. `NaN`, infinities, `-0`) | `number` | direct | trusted |
| `BigInt` | `bigint` | `bigint` | direct | trusted |
| `Bool` | `boolean` | `boolean` | direct | trusted |
| `String` | `string` | `string` | direct | trusted |
| `Unit` | `undefined` | `void` (return position), `undefined` elsewhere | direct | trusted |
| Tuple | plain JS array | TS tuple type (`[number, string]`) | direct | trusted |
| Structural record | POJO | structural object type | direct | trusted |
| Nominal `record` (non-opaque) | POJO (structurally represented) | structural object type; constructor per Part 7 | direct | trusted |
| `union` (all-nullary) | string literals | string-literal union | direct | trusted; representation cliff noted in Part 7. **Exempt: the prelude `Bool`** — its own row above governs; representation pinned to `boolean` (Unions §6.2, #147) |
| `union` (any payload) | string-tagged POJOs (Unions §6.1) | discriminated union on `tag` | direct | trusted |
| `extern enum` | captured foreign enum-object values | per `ffi-foreign-enums.md` | direct | trusted; checked `fromJsT` for uncertain data |
| `Option(a)` | its real union representation (`{tag:"Some"; value:a}` / shared `{tag:"None"}` constant) | the discriminated union — **never erased to nullability** | direct | trusted |
| declared `exception` values (e.g. `ParseError`) | branded `Error` (Exceptions §7.1) | `Error & {$hex: "<module>"; name: "..."; ...}` (Exceptions §7.5, brand value per #488; export surface Part 7) | direct | trusted |
| `Exn` (in exported signatures) | whatever was thrown — branded `Error` or the raw foreign throwable | plain `Error` (Exceptions §7.5's accepted white lie) | direct | trusted |
| `Range` | materialized range object implementing the JS iterable protocol (Loops §8) | `Hex.Range` — branded interface extending `Iterable<number>` (§8.1); the brand is §8.3's structural phantom marker, **not** Part 7 §5's `unique symbol` | direct | trusted |
| opaque extern Promise handles | the foreign `Promise` object, unchanged and by identity | the declared opaque type, per the general extern-type facing rule (Parts 4/7) | direct | trusted; §4.4 (rejection is a foreign async event) |
| Functions (boundary signatures) | n-ary JS function, same visible argument order | function type | direct in the common case; a supported top-level adapted position (e.g. `Seq(a)`) adds one stable boundary function wrapper plus fresh per-value adapters (Parts 3, 4, 7) | trusted; foreign throws → §7 |
| Callbacks (function-typed arguments/results) | the same JS function object in both directions | function type | direct — v1 admits **only** representation-direct callback signatures (Part 6) | trusted; adapter-requiring callback signatures are a v1 hard error (Part 6) |
| `Nullable(a)` | `a \| null \| undefined` (zero wrapper) | `a \| null \| undefined` | direct | trusted; companion surface in Part 2 |
| `Array(a)` | foreign-owned JS array, readonly to Hexagon | `ReadonlyArray<a>` | **borrowed** | stability contract in Part 2; violation → §3.1 |
| `Seq(a)` outbound (Hexagon sequence to JS) | the runtime sequence value, natively implementing the JS iterable protocol; each `[Symbol.iterator]()` yields an independent replayable cursor | `Iterable<a>` | direct | Part 3; trusted |
| `Seq(a)` inbound (foreign `Iterable<a>` to Hexagon) | persistent memoizing adapter over one foreign iterator, requested on first demand | `Iterable<a>` | **adapted** (top-level only; §5.3) | Part 3; protocol throws → §7 |
| `Vector(a)` | the runtime collection object **is** the value (identity crossing) | `Hex.Vector<a>` | direct | trusted |
| persistent `Map(k, v)` / `Set(a)` | runtime HAMT objects (identity crossing) | `Hex.Map<k, v>` / `Hex.Set<a>` | direct | trusted; snapshot conversions are **converted** (Part 10 inherits Collections Part 4 §10) |
| `JsMap(k, v)` / `JsSet(a)` | native JS `Map` / `Set` | `ReadonlyMap<k, v>` / `ReadonlySet<a>` | borrowed | Part 10 stability contract; inward persistent conversions are converted & checked |
| `JsValue` | arbitrary JS value, opaque and identity-crossing | `unknown` | direct (opaque); decoding is converted & checked | Part 11 |
| extern `type` (opaque foreign type) | whatever the foreign API supplies; Hexagon sees no structure | generated opaque branded named type (exact form Part 7) | direct | trusted |
| `opaque record` / `opaque union` | the erased underlying runtime value (no wrapper added) | TS `unique symbol` brand hiding the representation (Part 7) | direct | trusted |

### 4.2 Reading the table

- **"Trusted" failure mode** means §3.1 governs: no per-call validation exists, and a violated declaration yields unspecified observations. Specified failure results (§3.3) belong to *converted* operations (§2.4) — named conversions and decoders over these types, not rows of this table, which classifies crossing positions.
- **`Int` versus `Float`:** TypeScript cannot express the `Int` refinement — both face as `number`. The distinction remains part of the generated contract and its documentation (§6).
- **`Option(a)` is never nullish.** It crosses as its genuine union representation. `Nullable(a)` is the explicit nullish foreign door, and conversion between them is explicit (Part 2). `Unit`'s `undefined` representation is likewise unrelated to nullability (Primitive Types §9).
- **A foreign callable's declared `Unit` result is an observation rule, not a return-shape assertion.** Hexagon discards whatever the foreign call returns (Part 6 §3.2); exported Hexagon `Unit` functions genuinely return `undefined`.
- **Runtime collection values cross by identity.** A `Vector` handed to JavaScript, stored there, and returned to Hexagon is the same value; the runtime collection object is the Hexagon value, not a wrapper around one.
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
- **`.d.ts` face:** a Promise-backed handle follows the *general* extern opaque-type facing rule (Part 4 §5/§12.3): a generated opaque branded named type, with the exact declaration form owned by Part 7. Nothing Promise-specific is added. A JS consumer receiving the handle back therefore cannot `await` it type-safely — an accepted consequence of opacity.
- **Settlement-observing members** (`then`/`catch`/`finally`-shaped declarations) are declarable only as ordinary extern members under the general rules — Part 5 for receiver members, Part 6 for callback signatures — and confer **no** Hexagon-level async semantics: microtask timing, callback ordering, and rejection routing remain entirely foreign. A rejection delivered to a declared callback is an ordinary foreign call into a Hexagon function, nothing more. The async specification is the intended home for settlement observation; hand-rolled `then` bindings should expect to be superseded.
- **No callback exception:** fulfillment/rejection callbacks must have representation-direct signatures like every other v1 callback (Part 6). Promise support does not loosen that rule.
- **No Promise-specific generic or structural form is introduced here.** Part 4 §11/§12.4 makes all v1 extern declarations monomorphic and defers parameterized extern types/functions/classes as one family. The async specification alone owns `Promise(a)`.
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

asserts that the returned value is a JavaScript array containing genuine runtime `Vector` values *(2026-08-02: "runtime" per §8.3 — the compiler-provided runtime, not a package)*. `ReadonlyArray<Hex.Vector<number>>` is its legitimate `.d.ts` face; the outer `Array` remains a zero-copy borrowed foreign array.

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
| `Bool` | a `boolean` — *since #147 a prelude union with pinned representation (Unions §6.2); this row's requirement is unchanged and is the pin's boundary face* |
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
import type * as Hex from "./hex.js";
```

*(Amended 2026-08-02, §8.3: this line read `from "@hexagon/runtime"`. No such package exists to resolve that specifier — the import target is re-grounded to the runtime declaration module the compiler emits into the program's own output, spelled by **path-adjusted relative specifier**, of which `./hex.js` is the same-directory case; a module deeper than the source common root spells `../hex.js`, and a collision-probed root file gives `./hex1.js`, and so on. The alias, the one-import discipline, and the faces are unchanged; the last bullet's "runtime's public module surface" is qualified below. Both code blocks in this section are respelled rather than left with the note beside them: they are copyable `.d.ts` samples, and round 2's standard is that an unapplied correction does not stop an implementer.)*

Their public faces are `Hex.Vector<a>`, `Hex.Map<k, v>`, `Hex.Set<a>`, and `Hex.Range` (§8.1):

```ts
import type * as Hex from "./hex.js";

export declare function makeRow(): Hex.Vector<number>;

export declare function process(
  rows: ReadonlyArray<Hex.Vector<number>>,
): void;

export declare function index():
  Hex.Map<string, Hex.Vector<number>>;
```

- `Hex.Map` and `Hex.Set` are visibly distinct from JavaScript's native `Map` and `Set`; `Hex.Vector` is visibly a runtime-owned persistent value rather than `ReadonlyArray`. The import is type-only and by itself adds no emitted JavaScript dependency.
- The runtime package *(2026-08-02: read "the emitted runtime declaration module", §8.3)* exports the naturally named public types `Vector`, `Map`, `Set`, and `Range`; **`Hex` is the generated file's local namespace alias**, not a claim on a global identifier. The compiler controls the alias in its generated declarations and must resolve the rare collision with a user-exported local `Hex` name **deterministically**, while preserving `Hex` as the normal spelling. (The exact deterministic renaming scheme is an implementation obligation of the `.d.ts` generator; recorded in §10.)
- `Hex` is the standard short form for tooling and generated foreign surfaces, aligned with the `.hex` source extension and the `hexc` compiler name. The mental model resembles C++'s `import std;` plus `std::…`: one short namespace houses the runtime vocabulary. JavaScript operation exports may support a matching `Hex.Vector.get(...)` style through the runtime's public module surface, but the type-only declaration import does not by itself dictate that runtime export organization. *(2026-08-02, §8.3: no runtime public module surface exists in v1 — the "may" stays speculative, commits to nothing, and would land in `hex.js`, the seat §8.3 reserves.)*

### 8.1 `Hex.Range`

`Range`'s foreign face is **`Hex.Range`: a branded interface extending `Iterable<number>`**. *(2026-08-02, #128 ruling: this section formerly read "opaque branded interface". The word `opaque` is dropped throughout §8, because in this corpus "opaque branded" names Part 7 §5's non-exported `unique symbol` mechanism, and that is **not** the mechanism here — the `Hex.*` brand is §8.3's structural phantom marker `readonly "~hex": "Range"`, chosen deliberately for cross-program assignability. An implementer reading "opaque branded" as §5 would emit a `unique symbol` and break the interop §8.4 item 3 protects. Nothing about the doctrine changed; only the word that misnamed the mechanism.)* It exposes iteration and nothing else — no representation fields (bounds, step, or direction) appear on the face — and the brand means an **arbitrary `Iterable<number>` does not satisfy `Hex.Range`**. A JS consumer can traverse a crossed `Range`; only a genuine runtime-originated `Range` value satisfies the type. This resolves Loops §8's either/or (range-object interface versus `Iterable<number>`) as: both, in the only compatible order — a branded interface that *extends* the iterable protocol.

> **Edit note (for Loops/Ranges/Iteration §8 — discharged 2026-08-02, see body; retained as the anchor, nothing to re-apply):** the "range object's interface (or `Iterable<number>`)" alternative for `Range`'s `.d.ts` face is resolved by this section: the face is `Hex.Range`, branded, extending `Iterable<number>`. *(Discharged 2026-08-02, #128 ruling: verified already applied — Loops §8's `.d.ts`-impact bullet states the resolved face and cites this section, and no either/or text remains in the target.)* **Corrected in round 2, same day:** that discharge originally added "nothing left to change", which was drawn from the narrow check it had actually run (no either/or text) and stated as a general one. Loops §8's bullet still said "opaque branded interface" — the very wording this section had just dropped as an implementer hazard — so there *was* something left to change, and it is now corrected in place in Loops §8, with that file's Status line recording it. The either/or discharge stands; only the overreaching claim beside it did not.

### 8.2 The collection faces extend their iterable protocol *(added 2026-07-28, defect 12 ruling — Part 3 §9.5)*

On the §8.1 precedent, the remaining collection faces declare the iterability their runtime values already carry:

- **`Hex.Vector<a>` extends `Iterable<a>`** (elements in index order);
- **`Hex.Set<a>` extends `Iterable<a>`** (members, in the collection's own traversal order);
- **`Hex.Map<k, v>` extends `Iterable<[k, v]>`** (entries as two-element tuples, in the collection's own traversal order).

The brand doctrine is §8.1's, unchanged: each face remains a branded interface — branded by §8.3's structural phantom marker, never by Part 7 §5's `unique symbol` — so an **arbitrary iterable does not satisfy it** — a JS consumer can traverse a crossed value but only a genuine runtime-originated value satisfies the type, and iterability is the *only* protocol the faces expose (no representation fields, no mutation surface, and deliberately not `ReadonlyMap`/`ReadonlySet`/`ReadonlyArray` API shapes, which the runtime values do not implement). `Seq(a)` is deliberately **not** in this list: its face stays the structural `Iterable<a>` (§4.1; Part 3 §9.1), because its parameter positions must admit arbitrary foreign iterables (Part 7 §7 occasion 1) — the one type whose face is the protocol rather than a brand over it.

### 8.3 Where the `Hex` types live: the emitted runtime declaration module *(added 2026-08-02, #128 ruling)*

**The finding this section answers.** §8 and Part 7 §2.1 spell the import `from "@hexagon/runtime"`, and the Collections corpus says the collection structures are "provided by `@hexagon/runtime`" (Collections Part 1 §2.1 for `Vector` and §4.1 for `Map`/`Set`, with §2.3's ownership statement — "Hexagon owns and implements its collection structures in `@hexagon/runtime`" — and Collections Part 4 §2.1; the "final namespace/import form" is explicitly delegated to the FFI spec by Collections Part 4 §11's emission notes). **No such package exists, and nothing in the toolchain produces one.** The runtime reaches an emitted program two ways, verified against the compiler: helper definitions inlined into each emitted module (`__hex_range`, the `Seq` machinery, the collection helpers — `__hex_persistentCollections` when this was written, retired at the Set milestone, #373), and privileged runtime/prelude `.hex` modules compiled and shipped as sibling ESM files imported by relative specifier (`import { None } from "./Option.js"`). A generated `.d.ts` already carries type-only imports where the *source* imports another Hexagon module — `import type * as Json from "./tiny-json.js"` for a namespace import, `import type { … }` for type-only named imports, both through the emitter's existing `.hex` → `.js` specifier rewrite — but at ruling time it had **no runtime-type import**: nothing in the file declared or imported the `Hex` namespace, because there had never been anything to import it from. *(That one clause is the finding's only casualty of its own repair — the #128 implementation, merged 2026-08-03, emits exactly the import obligation 2 below specifies; the rest of this paragraph is still current, the package's nonexistence included, and stays in the present tense on purpose. Tense shifted 2026-08-03, #242.)* A conformance fix that emitted §8's import verbatim would make every generated declaration file unresolvable until the consumer installed a package nobody ships. The corpus's `@hexagon/runtime` references name **the runtime the compiler itself provides**, wherever it lives; this section fixes where its types live.

> **The `Hex` types are declared in a runtime declaration module the compiler emits into the program's own output: one `hex.d.ts` per compiled program, placed at the common root of the program's sources — the directory where the prelude modules already inject — and exporting the interfaces `Vector<a>`, `Set<a>`, `Map<k, v>`, and `Range`. Each generated `.d.ts` that mentions a `Hex.*` face imports it with one type-only relative import, path-adjusted from the importer's own emitted location to that root — `import type * as Hex from "./hex.js"` at the root itself, `"../hex.js"` from one directory down, and so on — under §10's alias probing, unchanged. No `hex.js` is emitted: the import is type-only and erased, and TypeScript resolves the specifier to `hex.d.ts`.**

The normative content of `hex.d.ts`, exactly (binders follow Part 7 §2.2's lowercase convention):

```ts
export interface Vector<a> extends Iterable<a> { readonly "~hex": "Vector"; }
export interface Set<a> extends Iterable<a> { readonly "~hex": "Set"; }
export interface Map<k, v> extends Iterable<[k, v]> { readonly "~hex": "Map"; }
export interface Range extends Iterable<number> { readonly "~hex": "Range"; }
```

Rules fixed here:

- **The brand is a structural phantom marker, not a `unique symbol`.** `readonly "~hex": "Vector"` delivers exactly §8.1's doctrine — an arbitrary `Iterable` does not satisfy the face, because it lacks the marker — while leaving values from two independently compiled Hexagon programs mutually assignable, which their runtime representations genuinely are (same compiler, same shapes). A `unique symbol` per emitted `hex.d.ts` would type-reject that working interop and claim a per-compilation nominality the runtime does not deliver (Part 7 §5's symbols are per-declaration-file types with a single home; these types deliberately have one home *per program*). That one ground suffices and is the only one recorded — §8.4 item 3. This is a **second brand mechanism** beside Part 7 §5's `unique symbol`, with a different threat model, and the divergence is deliberate: §5 governs what Hexagon exports opaquely, where unforgeability within one declaration file is the point; these are runtime types shared *across* programs, where assignability is. The edit note below carries the pointer into §5 so its "one mechanism" reading stays honest. **Second price, added 2026-08-02 (round 4) — the marker is a working TypeScript discriminant over a property that does not exist at runtime.** Because `"~hex"` carries a string-*literal* type, TypeScript treats the four faces as a discriminated union and narrows on it. Verified with the repo's own `tsc` under `--strict --module nodenext --lib es2022`, exit 0:

```ts
export function pick(x: Hex.Vector<number> | Hex.Set<number>): string {
  if (x["~hex"] === "Vector") { const v: Hex.Vector<number> = x; return "vector"; }
  const s: Hex.Set<number> = x; return "set";      // both branches typecheck
}
```

At runtime `x["~hex"]` is `undefined`, so the guard is always false and every such call takes the `Set` branch. The natural consumer-written form (`"~hex" in x && x["~hex"] === "Vector"`) is blessed identically and is likewise always false. This is **not** a reason to prefer `unique symbol`, which has exactly the same property, and it does not reopen §8.4 item 3 — it is recorded because §8.3's standard is that the white lie be priced, and this price was missed: the marker does not merely fail to exist, it invites a discrimination TypeScript endorses and the runtime always answers wrongly. A consumer needing to tell the faces apart at runtime must use the values' own protocols, never the marker. First price, accepted and recorded: the marker is forgeable by deliberate spelling. That is §3.1's territory — writing `{ [Symbol.iterator], "~hex": "Map" }` by hand is a programmer assertion that the value satisfies the Hexagon contract, exactly like any untyped-JavaScript crossing, and it is on the asserter's head.
- **The marker is TypeScript-only — a phantom.** Runtime values do not carry a `"~hex"` property and the emitter adds none: this is Part 7 §5's "no runtime wrapper, tag, or validation" clause applied to the runtime collections. **No emitted JavaScript changes** — but the fix is *not* merely per-file declaration text: `hex.d.ts` is the **first program-scoped emission artifact**, and the compiled-project model has no seat for it today (the project model is strictly per-module — each source file yields its `javascript` and `declarations`, and the project is the list of them plus diagnostics; there is no program-level emission slot, and the compile stays deliberately filesystem-free). The emission model must grow that seat; obligation 3 owns it. The white lie is priced: `value["~hex"]` typechecks as the string literal and evaluates to `undefined` — the same accepted family as `Exn`'s plain-`Error` face (Exceptions §7.5). The key `"~hex"` is not an identifier, so it can never collide with a structural-record field (Hexagon field names are identifiers) and must be quoted to be spelled at all.
- **The faces expose iterability plus the brand and nothing else** — §8.1/§8.2 unchanged. `Map`/`Set` runtime values happen to carry `size` and `root`, and `Range` values carry `start`/`end`/`descending`; none of that is on the face, and §8.2 already decided against API shapes. Not re-litigated here.
- **`hex.d.ts` is emitted only when needed** — precisely when at least one generated `.d.ts` imports it (the same present-only-when-needed discipline Part 12 §8's conformance row gives the import line itself).
- **Filename collision, deterministically, user wins.** A program module whose own emission claims `hex.js`/`hex.d.ts` **at the source common root** keeps its name; the runtime declaration module takes the first free of `hex.d.ts`, `hex1.d.ts`, `hex2.d.ts`, … — §10's probing discipline lifted to filenames (the first-free search, not §10's underscore suffix: a filename is not an identifier), probed **over the emitted filenames at that root**, compared case-insensitively (case-colliding filesystems exist) — and every generated import spells whichever name won. Only the generated file moves; a user module is never renamed.
- **The placement's price, recorded: the artifact's path is not stable under project membership.** The source common root is the longest shared directory prefix over *all* the project's source paths (`project.ts`'s `commonRoot`), so adding one distant source file shortens the root, moves `hex.d.ts`, and rewrites the relative specifier in every generated `.d.ts` that imports it. This is **accepted, not overlooked**: the prelude modules already inject at that same root and already have exactly this property, so the ruling adds no new instability class — it inherits one the compiled-project model has chosen. Any future ruling that stabilizes prelude placement stabilizes this with it.
- **The name reserves the runtime's seat.** If a later pass ever materializes shared runtime JavaScript (the helper-dedup direction), `hex.js` is its designated home, so the type home and the code home converge on one module identity instead of inventing a second.
- **No lib directives; the floor is stated instead.** As specified, `hex.d.ts` fails under `--lib es5` (TS2304 on `Iterable`, all four lines), and it is deliberately **not** repaired with a `/// <reference lib="es2015.iterable" />`: a lib directive silently widens every consuming compilation's `lib` set past its own configuration, which an emitted declaration file has no business doing. The decided floor: **emitted Hexagon declarations presuppose a TypeScript `lib` of es2015 or later.** The runtime's iteration protocol requires it, every existing face that says `Iterable` (`Seq`'s included) already assumed it, and the corpus's acceptance commands say `--lib es2022`. Decided here, not by omission.
- **`Vector`'s face narrows on purpose — and the price is bigger than a migration note, because the named exits do not exist yet.** When this narrowing landed, `Vector`'s representation was a plain JavaScript array, so the formerly emitted `ReadonlyArray<a>` face was accidentally honest at runtime — and freezing it into the public contract would have made Collections Part 3's decided trie representation a breaking `.d.ts` change. `Hex.Vector<a>` is what made that migration invisible, the API-representation-silence the Collections corpus already promises — and the migration has since happened: the representation is `runtime/VectorTrie.hex`'s trie (Part 3 §4), behind the same face, with no `.d.ts` change, exactly as designed. But stated plainly: `Vector.toArray` (§5.1's own example) is not among `stdlib/Vector.hex`'s exports, and `Map.toJsMap`/`Set.toJsSet` are not among `stdlib/Map.hex`/`stdlib/Set.hex`'s — the `JsMap`/`JsSet` views themselves are compiler types with live `Iterable` rows (#396), but the conversions into and out of them remain unshipped. The **v1 interim surface of a crossed collection is therefore iteration plus whatever the emitted modules export** — a consumer reading `map.size` (which happens to work today) or indexing a crossed `Vector` loses it at the typecheck, with spread/`Array.from` as the universal rewrite until the conversions ship (shipping doctrine and order: Part 2 §9.1 — the conversions are **absent until implementable**, never declared-but-throwing stubs, and `Vector.toArray` is first, #238). This ruling deliberately does **not** sequence the narrowing behind the conversions: an honest narrow face now beats a false wide one, and the conversion obligations stay owned where they are (FFI Part 2 for `Vector.toArray`; FFI Part 10 for the `JsMap`/`JsSet` doors). *(Tense corrected 2026-08-03, #242: this bullet was written before the #128 implementation merged (2026-08-03, `882ed2c`); "currently emitted", "is accidentally honest", and "the moment this lands" were the overtaken spellings. The representation claim stood until the trie wiring landed and is superseded with it — the bullet above now records both states. Re-corrected at #396: the overtaken spellings were "not yet compiler types" — `JsMap`/`JsSet` are — and "no `Map`/`Set` stdlib module at all" — `stdlib/Map.hex`/`stdlib/Set.hex` shipped with the Map/Set arc (#370, #373). The named exits still do not exist: no `toArray` in `stdlib/Vector.hex`, no conversion exports in `stdlib/Map.hex`/`stdlib/Set.hex`, #238 open.)*

**Conformance obligations** (the #128 implementation discharges these; no new diagnostics, so the Rewrite Rule is not engaged):

1. `renderType` emits `Hex.Vector<a>`, `Hex.Set<a>`, `Hex.Map<k, v>`, and `Hex.Range` (alias as probed) for the four §4.1 faces this section governs (three rows — `Map`/`Set` share one).
2. A generated `.d.ts` mentioning any `Hex.*` face carries exactly one type-only import of the runtime declaration module; one mentioning none carries none. §10's alias probe already runs over every top-level identifier the module's items can put in the file — which **includes the type-only import aliases a source-level Hexagon namespace import contributes** (`import type * as Json from "./tiny-json.js"`): a source module importing under the alias `Hex` forces `Hex_1`. It forces it where the file carries that alias's line — which Part 7 §2.4 settles from the typed tree, before any face is rendered, so the probe still runs once and early. An alias no rendered face is answered through reaches no `.d.ts` and contests nothing in it — a written dot is not enough, and Part 7 §2.4 states what is. That collision class is live before this ruling, not created by it; the implementation must probe against it.
3. The program's emission includes `hex.d.ts` (probed name, at the source common root) with exactly the normative content above, iff obligation 2 produced an importer. **This obligation includes growing the seat:** the compiled-project model is per-module today, with no program-level emission slot, so the model itself must gain one program-scoped artifact — the emission-model change is this obligation's, not incidental.
4. Unchanged rows stay unchanged: `Seq(a)` faces as structural `Iterable<a>` (§8.2's carve-out); `Node` reaches no shipped `.d.ts`. `JsMap`/`JsSet` joined as `Typed.Type` kinds with `renderType` cases of their own (#396), and their faces are exactly what this obligation bound ahead of the implementation: structural `ReadonlyMap<k, v>`/`ReadonlySet<a>`, never `Hex.`-branded, because the values are borrowed natives whose shapes are genuinely theirs (Part 10 §1).
5. Acceptance: `tsc --noEmit --strict` over an emitted program's declaration files exercising all four faces in parameter, result, and `declare const` positions. *(The two separately filed defects this item once carved out as "may still trip the run" are both fixed, neither by this section: #227 was ruled and fixed 2026-08-04 — Part 7 §2.4/§14.2 — and #228 `Array(a)` mutability was pure conformance to §4.1's row, fixed without a ruling (2026-08-04, `0134ce1`).)*
6. The TypeScript preview surface spells the same faces **and stays compilable on its own** — Part 7 §14.1's scope extends face rules to the preview — recorded there as **proposed and owed James's ruling**, not settled, so this obligation inherits that status, and the conformance suite runs real `tsc` over preview text, so "latitude" that emits an unresolvable `Hex` is not available. Decided: when any `Hex.*` face appears, the preview emits an inline `declare namespace Hex { … }` header whose interface bodies are exactly the normative content above, instead of an import into a file the pane cannot show. The structural brand is what makes the two spellings interchangeable — a value typed by the preview's namespace and one typed through an imported `hex.d.ts` are mutually assignable — which a `unique symbol` brand could not deliver (one more consequence of §8.4 item 3). Price: preview text pasted beside a real import redeclares the namespace; the preview is inspection-only, accepted.

**Scope fences.** #227 (a generated `.d.ts` names other Hexagon modules' types with no import) is its own ruling; nothing here decides it, but its fix must ride the relative type-only import discipline the emitter **already has** — the `.hex` → `.js` specifier rewrite behind today's `import type * as Json from "./tiny-json.js"` lines — which §8.3's runtime-declaration import also joins; this section joins that discipline, it does not establish it, and the two fixes belong to one emitter pass. #228 (`Array(a)` faced as mutable `Array<a>`; fixed 2026-08-04, `0134ce1`) was pure conformance to §4.1's existing row — no ruling needed, not this section's. #132 is fixed and orthogonal.

> **Edit note (for FFI Part 7, applied on next touch — three targets, one correction record in the §14 family):** **§2.1:** the `import type * as Hex from "@hexagon/runtime"` line is re-grounded by §8.3 — the specifier is the type-only relative import to the emitted `hex.d.ts` at the source common root (`./hex.js`, path-adjusted; probed name on collision); alias, probing, and the one-import discipline unchanged. **§5:** the uniformity claim ("This brand form is uniform across everything Hexagon exports opaquely… One mechanism, one reading") gains its boundary: it governs Hexagon's *opaque exports*, which is what §5 enumerates; the runtime collection faces — outside that enumeration — use §8.3's structural phantom marker instead, chosen for cross-program assignability. Add the pointer so §8.1/§8.2's branded interfaces are not read as §5's `unique symbol` — those two sections have now dropped the word "opaque" for exactly that reason, and Part 3 §9.5 item 3's "nominal brands" is corrected in place on the same ground. **§13** *(corrected 2026-08-02 — this note first said §11, which is Part 7's Diagnostics checklist; the row is in §13, Decisions log)***:** the decisions-log row quoting the `@hexagon/runtime` import line takes the same §2.1 re-grounding.

> **Edit note (for `ffi.md` — §8's `.d.ts`-emission row, §5 invariant 9, and §6's master face table, applied on next touch; §11.1 is named below only to record that it needs no change):** the row's "exactly one type-only `Hex` import, present only when a `Hex.*` face is needed" survives verbatim with the import target re-grounded to §8.3's emitted runtime declaration module; §11.1's alias probing is untouched, and §8.3 adds the filename probe beside it. **§5 invariant 9** — "**All** nominal opaque `.d.ts` faces use **the one** non-exported-`unique symbol` brand mechanism" — is the consolidation layer's restatement of Part 7 §5's uniformity claim, stated more absolutely than §5 states it, in the document whose job is to be the complete reconciliation. It is not falsified (this ruling deliberately stopped calling the `Hex.*` faces *opaque*, which keeps them outside the enumeration), but Part 12 is now **silent** on a second brand mechanism the FFI corpus contains, and silence is what fix (a) above exists to prevent. Bound the invariant to Hexagon's opaque exports and add the pointer: the runtime collection faces use §8.3's structural phantom marker, for cross-program assignability. §6's master face table lists the four `Hex.*` faces with no brand column entry; a pointer there costs nothing.

> **Edit note (four unowned corpus references, applied on next touch of each; added 2026-08-02 completing this ruling's sweep):** the blanket reading above — *the corpus's `@hexagon/runtime` references name the runtime the compiler itself provides, wherever it lives* — covers the ownership and provenance uses ("provided by `@hexagon/runtime`": Collections Part 1 §2.1/§2.3/§4.1, Part 3 §4, Part 4 §2.1, `collections-roadmap.md`). Its scope is the **normative** corpus, `spec/*.md`. `spec/notes/` is out of scope because `spec/README.md`'s authority rules make notes non-normative — *(that is the reason; an earlier draft of this sentence gave a fabricated example instead, citing a "§237" of `notes/ffi-proto-spec-questions.md`, a file with twelve sections, and attributing to it a phrase it does not contain. The `237` was a line number misread as a section number, and the phrase was never there. Recorded rather than quietly deleted, because the corpus's own standard for a sweep is that its scope fences be checkable)*. `compiler/architecture/persistent-collections.md` is also out of scope as a plan rather than a spec, and §8.4 item 2's reopening condition is what governs it — **but note its §1 made a present-tense claim that was false on both counts the `Vector` finding below establishes** *(repaired in that document at the Set milestone, #373)*: "Today that trie lives entirely in a TS runtime helper (`persistentCollections`), and `stdlib/Vector.hex` is a thin set of wrappers over it." The `persistentCollections` HAMT served `Map`/`Set` only *(its Map half retired at the Map milestone, #370, and the helper entire at the Set milestone, #373)*; `Vector` reached it not at all.

> **In-scope and repaired in place — this document's own §4.1 and §4.2** *(added 2026-08-02, round 4; applied round 5)*. §4.1's `Vector` row said "the runtime **trie** object **is** the value (identity crossing)" and §4.2's reading bullet said "the **trie-backed** runtime object is the Hexagon value, not a wrapper around one". Both were **representation-contract language**, resting on Collections Part 3 §4, and on that reading both stood exactly as Part 3 §4 stands — the identity-crossing point each is actually making is true today and unaffected by how `Vector` is represented. But the alternative reading makes them false, and §8.3's `Vector`-face bullet ("Today's `Vector` representation is a plain JavaScript array") sits in the same document: **a reader who took §4.1/§4.2 as statements about today would find a contradiction.** Round 4 deferred the repair to "next touch" of the document this commit was already touching, which is the standard this branch itself rejected at §8's amendment note (*an unapplied correction does not stop an implementer*, which is why §8's two code blocks were respelled in place). Both now read "runtime collection object", which loses nothing either sentence needs and takes no position on representation; Collections Part 3 §4 continues to own the trie contract. The blanket does **not** cover four passages that assert something further about a package, and each needs its own repair. All four are itemized in this note; the fourth comes last, after the `Vector` finding it depends on for context. **Collections Part 4 §11:** "Constructors, algebra, and instances emit `@hexagon/runtime` **calls**" is false as emission — the persistent-collection helpers were *inlined into each emitted module* (`__hex_persistentCollections` when this note was written; the helper retired at the Set milestone, #373, and the collection operations now reach `runtime/HashTrie.hex`'s sibling emitted module — still no package), which is the whole reason no package is needed; and the same bullet's "`.d.ts` faces expose `Hex.Map<k, v>` and `Hex.Set<a>` **from `@hexagon/runtime`**" takes the §8.3 re-grounding (the faces and the delegation of "final namespace/import form" to this spec are unchanged and now discharged). **Collections Part 2 §2.4:** "for a fixed compiler + `@hexagon/runtime` version" is a package-versioning commitment with no package behind it; the determinism promise is unaffected — read it as "for a fixed compiler and runtime version", the runtime being whatever the compiler provides. **`decisions-ml-dialect-generalization-2026-08.md` §5.3:** "today `Vector` ships from `@hexagon/runtime`'s JS trie (Collections Part 3 §4)" is wrong twice over, verified in the emitter. There is no package, and **there is no trie**: `Vector` is emitted today as a plain JavaScript array with copy-on-write operations (`append` is `[...v, x]`, `set` is `slice()`-then-assign, `length` is `.length`), and `needsPersistentRuntime` is false for `Vector`, so it reaches no persistent-collection runtime at all — which is what FFI Part 3 §9.5 item 1 already calls "`Vector`'s current native-array representation", so the corpus contradicts itself here and §5.3 is the side that is wrong. *(All of this described the emitter of its day and was verified then; the Vector emitter-wiring milestone, #306, replaced it — `Vector` now lowers onto `runtime/VectorTrie.hex`'s emitted module and `needsPersistentRuntime` no longer exists.)* **Read the whole clause as repaired, not just the parenthetical:** the sentence's tail — "until the wiring the row rests on §7's obligation against *that JS trie*" — has no JS trie to rest against either; read it as "against the current native-array `Vector`". What *does* stand is Collections Part 3 §4's **contract** (a persistent 32-way bit-partitioned trie deque with its pinned bounds): that specifies what `Vector` must be, not what it is today. Recorded while here, because nothing else records it: the shipped emission therefore **misses those pinned bounds** (`append` and `set` are O(n), not O(1) amortized / O(log₃₂ n)); the owed work is already tracked as `stdlib-roadmap.md` §5.1's "persistent-vector representation core" residue, but the *conformance gap* has no entry — that gap is this note's finding, not this ruling's to fix. *(Closed by the same milestone, #306: the trie emission restores the pinned bounds, and stdlib-roadmap §5.1's `Vector.hex` row now records the landing.)* §5.3's own argument survives **strengthened** — a native array is further from `VectorTrie.hex` than a JS trie would be, so there is even more plainly nothing for §6.3 to check before the emitter-wiring milestone; the `Vector(+a)` trusted row and the upgrade condition are untouched.
>
> **Fourth — `ffi-zero-cost-fundamental-exports.md`, opening preamble (not its `**Status:**` line):** "against the existing `hexc` architecture: … readable-JS emission with `.d.ts`, `@hexagon/runtime`" lists the package as part of the architecture that exists today — the same class of claim as Collections Part 4 §11's, at lower stakes since it is scene-setting rather than normative. Read as "the compiler-provided runtime".

> **Edit note (compiler source; added 2026-08-02, round 4 — applied and part-withdrawn 2026-08-03, #242; retained as the record, nothing left to apply):** the §5.3 clause falsified above was not only in the corpus. `compiler/src/passes/checker/variance.ts`'s claim-table doc comment carried it verbatim on the `Vector(+a)` row — "*`Vector` ships from `@hexagon/runtime`'s JS trie today (Collections Part 3 §4), so there is nothing for §6.3 to check yet*" — which is the first thing an implementer reads before touching that row, in the file that implements it. It took the same repair: no package, no trie, `Vector` is a copy-on-write native array, and the row's conclusion (nothing for §6.3 to check before the emitter-wiring milestone) survives strengthened. *(Applied by the #128 implementation, verified in the file: the row now states the copy-on-write native array, with a dated correction citing this note.)* This note originally recorded a second defect in the same comment — that its citation of "`intrinsics.md` §4.2's parametricity obligation" should read §7's, on `decisions-ml-dialect-generalization-2026-08.md` §5.3's wording. **Withdrawn as a false alarm, recorded so it is not re-applied:** `intrinsics.md` §4.2 does carry the obligation — "Parametricity is part of the contract", added 2026-08-01 under #205 — and in the same bullet names the closure doc's §5.3 trusted rows as riding it; the closure doc's own §7 opens "Host: `intrinsics.md` §4.2's verification list gains a fourth commitment", so §4.2 is the obligation's host and both citations are live. The comment was never wrong, its in-file refusal to apply this item is correct, and a standing instruction here would have been an instruction to make the file wrong.

> **Edit note (`book/`, tracked as issue #235 — recorded here so this sweep's scope is complete):** the book carries three `@hexagon/runtime` imports that the blanket reading does **not** rescue, because they are presented as emitted output rather than as provenance. `book/chapters/23-javascript-output.md:243`'s `import { Vector } from "@hexagon/runtime"` is the worst: a *value* import, in a JavaScript-output sample, doubly false since `Vector` operations are inlined natively and no such import is ever emitted. `book/chapters/21-collections.md:295` and `book/chapters/24-typescript-output.md:265` spell the type-only form and take §8.3's re-grounding. The book has no edit-note convention, which is why #235 exists; it is named here so a future sweeper does not read this note's silence as a decision that the book was clean.

> **Edit note (for FFI Part 9, applied on next touch):** §13.3 already marks the `@hexagon/runtime/…` subpath specifiers as representative; extend that marker to §11's ABI clause ("interoperate only against a compatible `@hexagon/runtime` dictionary ABI version"), which as written is a package-versioning commitment with no package behind it. Under §8.3 no runtime package exists in v1; the cross-package dictionary ABI inherits §8.4 item 2's reopening condition rather than a shipping surface.

**Provenance:** Part 3 §9.5 item 5's filed debt → `spec/notes/compiler-conformance-defects.md` entry 12's resolution block → issue #128 → this section. The ledger sentence in Part 3 §9.5 — which formerly read "remain filed debt owed their own defect entry" — stayed literally true while #128 was ruled and unbuilt: #128 is that entry, and it carried this ruling. *(2026-08-03, #242: the implementation merged 2026-08-03, which that sentence did not survive; the same sweep past-tensed it in place — it now reads "remained filed debt owed their own defect entry", carrying its own dated correction — and Part 3 §9.5's ledger records the whole family discharged.)*

### 8.4 Rejected alternatives (do not re-litigate)

1. **The status quo: structural utility faces** (`ReadonlyArray<a>`, `ReadonlyMap<k, v>`, `ReadonlySet<a>`, bare `Iterable<number>`). Rejected: it overturns §4.1, §8.1, and §8.2, all decided; it promises API the runtime values do not have — `map.get(k)` typechecks and throws at runtime, and of `ReadonlyMap`'s surface only `size` and iteration happen to exist on the HAMT records — and for `Vector` it freezes the current plain-array representation into the public contract, making the decided trie a breaking change. Price of keeping it out: consumers lose the member access the old faces (sometimes falsely) offered; the migration is the exported operations and the named conversions — unshipped in v1, so §8.3's interim-surface statement (iteration plus author exports, spread as the universal rewrite) is the honest near-term reading.
2. **A published `@hexagon/runtime` types package.** Rejected for v1: the package does not exist; it would put an install-time dependency under every consumer's *typecheck*; it version-couples the compiler to a package registry; and it forfeits the self-contained-emission property the implementation actually has (inlined helpers, runtime modules as siblings). **Price of keeping it out, recorded:** there is no shared, versioned type surface anywhere — a hand-written TypeScript project has nothing to install in order to name `Hex.Vector<number>` and must reach the types through some compiled output's `hex.d.ts`; and two Hexagon programs consumed side by side each carry their own copy of the same four interfaces, kept mutually assignable only by the brand being structural (§8.3 — half the reason it is). **Reopening condition, recorded:** if a shared runtime package ever ships for its own reasons, the types move into it and §8.3's specifier clause is superseded — the faces, names, and brand shape survive verbatim, which is why they are specified independently of their home.
3. **`unique symbol` brands for the `Hex.*` faces.** Rejected on one ground, which suffices: a per-program symbol type-rejects the cross-program interop the runtime genuinely supports — two outputs of the same compiler produce structurally interchangeable values, and consumers may hand them across. *(Withdrawn, recorded so it is not re-cited: an earlier draft also claimed unexported symbols break downstream declaration emission. That does not reproduce — the repo's own TypeScript emits `import("./hex.js").Vector<number>` references cleanly under `--declaration`, exported or not, and Part 7 §5's shipped brands depend on the unexported-symbol shape working.)* Price of the structural marker: deliberate forgery types — accepted under §3.1, per §8.3.
4. **Per-module inline `declare namespace Hex`** (no shared file). Rejected: a consumer cannot *name* `Hex.Vector<number>` in their own annotations unless every module exports the namespace, which plants a generated `Hex` export on every module's public surface and re-opens §10's collision rules for every module rather than one file. The per-file duplication is the smaller objection; the unnameability is the killer. **Price of keeping it out, recorded:** the types must then live somewhere shared — which is exactly what forces §8.3's program-scoped emission artifact into existence, with its placement rule, its filename probe, and the program-level seat the emission model must grow. That machinery is this rejection's bill, and it is paid knowingly.
5. **Widening the faces** (`size`, `get`, `Range` bounds, API shapes). Foreclosed by §8.2's "iterability is the only protocol", decided there, listed here only to keep this index complete.

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

## 10. Part 12 closeout

Part 12 §11.1 fixes the deterministic `Hex`-alias collision scheme promised by §8. The declaration emitter tries `Hex`, then `Hex_1`, `Hex_2`, … and takes the first candidate colliding with no top-level identifier the module's items can put in that `.d.ts`, regardless of TypeScript namespace, nor any spelling in Part 7 §1.1's contested vocabulary (#662). Only the generated import alias is renamed; a user export is never renamed. The universe probed against is deliberately a superset of what the file finally emits, and Part 7 §2.4 states why.

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
| One type-only `Hex` namespace import; `Hex.Vector`/`Hex.Map`/`Hex.Set` faces. *(2026-08-02, #128 ruling: this row formerly quoted `from "@hexagon/runtime"`. No such package exists — the specifier is the path-adjusted relative import to the emitted `hex.d.ts`, §8.3. The alias, the one-import discipline, and the faces are unchanged.)* | §8, §8.3 |
| Opaque extern Promise handles: representation-direct by identity; no Hexagon async semantics; settlement observation only via ordinary extern members; binding-author warning obligation (docs preserve, never invent); no diagnostic on principle; async spec unconstrained | §4.4 |
| `Range` faces as `Hex.Range`: branded interface extending `Iterable<number>` (brand = §8.3's structural phantom marker, **not** Part 7 §5's `unique symbol`); no representation fields; arbitrary `Iterable<number>` does not satisfy it (edit note to Loops §8 issued; the either/or is discharged, and the brand wording there is corrected in place 2026-08-02 — see §8.1) | §8.1 |
| Generated `Hex` import alias uses first-free `Hex`, `Hex_1`, `Hex_2`, … probing over every top-level identifier the module's items can put in that `.d.ts`; user exports are never renamed | §10; Part 12 §11.1 |
| *(2026-07-28, defect 12 ruling)* `Hex.Vector<a>`/`Hex.Set<a>` extend `Iterable<a>`, `Hex.Map<k, v>` extends `Iterable<[k, v]>`; brands unchanged; `Seq` deliberately excluded (structural face) | §8.2 |
| *(2026-08-02, #128 ruling)* The `Hex` types' home is the compiler-emitted runtime declaration module `hex.d.ts` — one per program, at the source common root, the first program-scoped emission artifact (the per-module project model must grow the seat); type-only path-adjusted relative import; no package; no `hex.js` emitted, name reserved for future shared runtime JS; brand mechanism is the structural phantom marker `readonly "~hex": "…"` (a deliberate second mechanism beside Part 7 §5's `unique symbol`; edit note issued); filename collision probed `hex`, `hex1`, … over the root's emitted filenames, case-insensitively, user never renamed; no emitted JavaScript changes; es2015 `lib` floor stated, no lib directives; preview emits an inline `declare namespace Hex` header; v1 interim JS surface of a crossed collection = iteration + author exports (named conversions unshipped); conformance obligations enumerated | §8.3 |
| *(2026-08-02, #128 ruling, round 2)* Two wording defects the ruling created or left, both with a path into the compiler, both fixed: **(a)** §4.1's `Range` row, §8.1, and §8.2 said "opaque branded interface", which in this corpus names Part 7 §5's non-exported `unique symbol` — the word is dropped there **and in §11's own `Range` row and Loops §8's `.d.ts`-impact bullet** (both corrected in round 2 after round 1 missed them — and round 1's discharge note had wrongly added "nothing left to change" about Loops, an overreach from a narrower check, now itself corrected); FFI Part 3 §9.5 item 3's "nominal brands" is corrected in place (nominal *effect*, structural *mechanism*); `ffi.md` §5 invariant 9, the consolidation layer's more-absolute restatement of the same uniformity claim, takes an edit note. An implementer following any of these would emit the brand §8.4 item 3 rejects; **(b)** the `@hexagon/runtime` sweep is completed — the blanket reading covers the provenance uses, and the four passages that assert more (Collections Part 4 §11's false "emits `@hexagon/runtime` calls", Part 2 §2.4's package-version clause, generalization §5.3's "ships from `@hexagon/runtime`'s JS trie" — no package *and* no trie: `Vector` is a copy-on-write native array today — and `ffi-zero-cost-fundamental-exports.md`'s preamble, which lists the package as existing architecture) take their own edit note *(round 3 said "three"; the count was four, corrected in the body that round and here in round 5 — this table is the one an implementer reads instead of §8)*. Also corrected: the Part 7 edit note's third target is §13 (Decisions log), not §11 (Diagnostics checklist), and this log's own §8 row no longer quotes the dead specifier. **Round 4** then found the sweep's own scope fence carried a *fabricated* citation (a "§237" of a twelve-section notes file, and a phrase that file does not contain) while the real occurrence of that phrase sat in this document's §4.1/§4.2 — both recorded, with the contract-not-current-representation reading that saves them; the falsified §5.3 clause also lives verbatim in `compiler/src/passes/checker/variance.ts`'s claim-table comment and takes an edit note; `book/`'s three imports are named so silence is not read as a clean bill; and a second price of the phantom marker is recorded — it is a working TypeScript discriminant over a property that is `undefined` at runtime, so narrowing on it typechecks and always answers wrongly (verified with `tsc`, exit 0) | §4.1, §4.2, §8.1, §8.2, §8.3 |
| *(2026-08-02, #128 ruling)* Rejected with prices: status-quo structural utility faces; a published `@hexagon/runtime` types package (price: no installable shared type surface, per-program interface copies; reopening condition recorded); `unique symbol` brands (sole ground: cross-program interop; the declaration-emission leg withdrawn as non-reproducing); per-module inline `Hex` namespaces (price: the program-scoped artifact and its machinery); widening the faces beyond iterability + brand | §8.4 |
| *(2026-08-02, #128 ruling, round 5)* Four repairs, no decision touched. **(a)** §4.1's `Vector` row and §4.2's reading bullet now say "runtime collection object" instead of "trie"/"trie-backed" — round 4 had deferred this to "next touch" of the document it was itself touching, which is the standard §8's amendment note rejects; the trie *contract* stays owned by Collections Part 3 §4. **(b)** FFI Part 3's citation drift: seven passages there cited **Part 7 §6** for the identity-crossing and opaque-value clauses, which live in Part 7 **§5** (§6 is Exceptions, and never was the brand section); round 4 fixed the eighth instance nine lines away and left these standing, so all seven are corrected with a record at Part 3 §13. **(c)** This log's round-2 row said the sweep's unowned passages were "three"; they are four — the count was corrected in §8.3's body in round 3 and not here, in the table an implementer reads instead of §8. **(d)** §8.3 now prices the one thing it was silent on: `hex.d.ts`'s path is unstable under project membership, since the common root shortens when a distant source is added — accepted as inherited from prelude injection, not new | §4.1, §4.2, §8.3, §11 |
