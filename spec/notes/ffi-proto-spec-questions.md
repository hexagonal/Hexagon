# FFI Proto-Spec: Decision Surface

**Status:** Working note (July 2026). Proto-spec material, not yet normative.
**Purpose:** Bound the decisions required for the v1 JavaScript/TypeScript FFI, separating inherited commitments from questions the FFI specification must close. Existing normative specs govern wherever this note summarizes them.

**Companions:** `ffi-agenda.md`; `ffi-zero-cost-primitive-exports.md`; `ffi-exported-dictionaries.md`; Loops/Ranges/Iteration §6; Collections Part 4 §10; Collections Part 5 §6; Modules §11–§12; Unions §6; Exceptions §6/§10; Constraints §6.

---

## 1. Boundary doctrine

### Already directed

- The boundary is JavaScript/TypeScript and emitted code is readable ESM.
- Conversion is type-directed and per declared layer.
- Foreign throws participate in ordinary Hexagon `try`/`catch` through `JsError` without decoding arbitrary thrown values.
- `extern` imports are leaf edges for Hexagon's acyclicity rule. Hexagon does not inspect or certify cycles internal to foreign JavaScript modules.

### Proto-decision

A checked `extern` declaration is principally a trusted programmer assertion. Ordinary calls receive no general runtime shape validation. The compiler validates the Hexagon declaration itself; the binding author is responsible for asserting that the foreign implementation satisfies it.

The standard vocabulary is:

- **representation-direct:** the runtime value already has the declared JS representation and crosses unchanged;
- **borrowed foreign view:** zero-copy foreign-owned storage that Hexagon can only observe under a stability/lifetime contract (`Array`, future `JsMap`/`JsSet` views);
- **adapted foreign capability:** a supported top-level boundary wrapper establishes stronger Hexagon semantics (`Iterable<a>` entering `Seq(a)`);
- **converted value:** an explicit eager operation traverses/constructs a new representation (`Array.toVector`, `Map.fromJsMap`, decoders).

Validation occurs only where the named operation exists to establish an invariant or where protocol participation inherently requires a check: numeric narrowing, explicit decoding, malformed iterator results, cycle detection during structural-key ingestion, and similar conversion-owned cases. Fixed-arity dictionary evidence relies on TypeScript branding plus the trusted boundary; future variadic evidence is deferred rather than forcing routine v1 validation.

When foreign code violates a trusted declaration or borrow contract, affected Hexagon observations are unspecified; this does not imply memory unsafety. When an explicit checked decoder/converter encounters valid foreign input outside its representable domain, its own specified `Option`/`Result`/exception failure applies. Contract violation and defined conversion failure are distinct.

---

## 2. `Array(a)`: borrowed foreign collection

### Already directed

- `Array(a)` is the readonly foreign door for a JavaScript array; it is not a mutable Hexagon collection.
- Its `.d.ts` face is `ReadonlyArray<a>`.
- Collections Part 5 binds v1 to `Iterable<Array(a)>`, with `Item = a` and `iterate = Array.toSeq`.
- Hexagon provides no mutation operations on `Array(a)`.

### Current proto-decision

`Array(a)` is a zero-copy borrowed view. Foreign code owns the underlying JavaScript array and must keep its elements and length stable while Hexagon, including a deferred traversal derived from the array, may observe it. Violation does not imply memory unsafety, but the affected contents, order, length, and traversal observations are unspecified.

Under valid use, live iteration and snapshot iteration are observationally identical. Native `for...of` emission is therefore permitted and preferred; iteration does not copy merely to enforce a condition already required by the boundary contract.

`Array.toVector` is the explicit stable-snapshot operation.

### Closed package

- The stability obligation lasts while Hexagon or any deferred `Array.toSeq` traversal may still observe the array. An escaped sequence extends the borrow obligation through its possible consumption lifetime.
- `Array.toSeq` is lazy and zero-copy over the borrowed array.
- `Array.fromSeq` eagerly creates a fresh JavaScript array.
- `Array.toVector` eagerly creates a stable persistent snapshot.
- `Vector.toArray` eagerly creates a fresh JavaScript array.
- `Array(a)` joins the finite-collection `toSeq`/`fromSeq` suite.
- Collection conversions are shallow; nested representation contracts remain explicit under §4.
- A freshly runtime-constructed array is stable while exclusively held by Hexagon. The foreign stability obligation becomes relevant once foreign code can alias the reference; Hexagon never gains a public mutation operation either way.
- Native array iteration requires no special closing operation. A body throw propagates normally; JavaScript Array iterators own no external resource requiring deterministic `return()` cleanup.

---

## 3. `Seq(a)`: persistent sequence on the JS iterable protocol

### Already decided normatively

Loops §6 fixes all of the following:

- `Seq(a)` is a concrete lazy sequence with functional cursor operation:

  ```hexagon
  Seq.next : (Seq(a)) -> Option((a, Seq(a)))
  ```

- `Seq.next(s)` must not consume `s` from the caller's perspective. Sequence positions are persistent.
- `Seq(a)` emits onto JavaScript's native iterable/iterator protocol.
- A JavaScript consumer sees `Seq(a)` as `Iterable<a>` in `.d.ts`.

Therefore the earlier agenda statement that `Seq` does not cross the v1 boundary was stale and is superseded. Whether `Seq` crosses is not open.

### Required distinction

A replayable JS iterable is close to C# `IEnumerable<T>`: each call to `[Symbol.iterator]()` begins a fresh traversal. A generator **factory** can provide this shape.

A generator object or ordinary iterator is mutable and commonly single-shot: `[Symbol.iterator]()` may return the same object. It cannot be treated directly as a persistent Hexagon sequence position, because calling `next()` consumes it.

The public correspondence is:

```text
Hexagon Seq(a)                  -> replayable JavaScript Iterable<a>
foreign Iterable<a>             -> persistent memoized Seq adapter
single-shot IterableIterator<a> -> the same persistent memoized adapter
```

### Proto-decisions

1. **Inbound adaptation is automatic and type-directed.** Every foreign `Iterable<a>` returned or supplied at a boundary declared as `Seq(a)` is accepted and wrapped by the runtime. Ordinary `extern` use requires no explicit conversion call. A low-level `Seq.fromIterable`-style facility may exist later, but is not the normal checked-boundary mechanism.

2. **The runtime never probes or classifies replayability.** Requesting two iterator objects proves neither semantic replayability nor independence: they may share a queue, socket, clock, mutable store, effects, or one underlying cursor. The adapter must not call `[Symbol.iterator]()` speculatively or restart foreign computation.

3. **One iterator and one shared lazy memoization spine is the uniform inbound rule.** The adapter requests the source iterator once, on first demand. Each sequence node memoizes exactly one outcome: end, `(value, tail)`, or foreign failure. Repeating `Seq.next` at the same position therefore neither advances the source nor repeats foreign effects. A single-shot generator works without receiving weaker semantics; a replayable iterable is deliberately treated the same way.

4. **Reachability governs reclamation.** Memoization is represented by persistent lazy nodes, not a permanent central history array. A reachable sequence position retains the forced suffix needed to reproduce observations from that position. Once an older position is unreachable, ordinary garbage collection may reclaim its cached prefix. The shared iterator state must not keep an unnecessary back-reference to the sequence head.

5. **Traversal is iterative, never recursion-dependent.** `for x in xs`, `while`-based cursor consumption, and runtime combinators such as `Seq.fold` must use constant-stack iteration (`for...of`/loops in emitted JavaScript). Hexagon does not promise tail-call optimization; recursive sequence traversal remains ordinary recursion and may overflow the stack, so it is not the documented streaming idiom. Persistence still has an unavoidable space rule: consuming a very large or infinite single-shot source while retaining an earlier `Seq` position retains the forced portion reachable from that position; advancing while retaining only the current cursor permits unreachable prefixes to be collected. No cache limit may evict reachable history, because that would violate `Seq.next` persistence.

6. **`Seq` provides no deterministic disposal of an inbound iterator.** Natural exhaustion completes the source. Ending one loop early must not call the shared iterator's `return()`, because the same persistent sequence or a retained tail may be consumed later. Garbage collection cannot promise a timely `return()`. An exported JS traversal's `return()` ends that traversal without invalidating the underlying Hexagon sequence. Resource-owning iterators that require prompt closure are therefore not suitable `Seq` inputs; they need independently managed lifetime or a future explicit single-pass/resource abstraction.

7. **Iterator-protocol throws use the existing foreign-throw rule and are memoized per position.** Throws from `[Symbol.iterator]()`, `next()`, protocol property access, or an actually invoked `return()` surface through the `JsError` path unchanged. If forcing a sequence node fails, that node remembers the failure; forcing the same persistent position again must not advance the iterator or repeat the foreign operation.

8. **Malformed iterator results follow JavaScript protocol failure.** The adapter performs the minimum protocol check required by native iteration: `next()` must return an object. A malformed result produces a JavaScript `TypeError`, observed in Hexagon through `JsError`; throwing `done` or `value` accessors likewise follow the ordinary foreign-throw path. There is no separate Hexagon `InvalidIteratorError` and no general deep validation of foreign values.

9. **An exported Hexagon `Seq` is replayable, not merely nominally iterable.** Its `.d.ts` face remains the necessarily weaker `Iterable<a>`, but each call to `[Symbol.iterator]()` creates an independent traversal cursor at the exported Hexagon sequence position. Repeated JavaScript traversals observe the same memoized Hexagon sequence rather than re-running its lazy computation and effects.

10. **The v1 boundary accepts `Iterable<a>`, not bare `Iterator<a>`.** Generator objects normally qualify because they implement `IterableIterator<a>`. A bare iterator without `[Symbol.iterator]()` must be wrapped as an iterable by foreign code. A future explicitly single-pass or resource-aware type may accept iterators directly, but it must not be called `Seq` or weaken `Seq` persistence.

Together these decisions specify a persistent wrapper whose JavaScript face produces independent traversal cursors, with a single shared lazy memoization spine behind inbound foreign values.

---

## 4. Master boundary type mapping

The spec needs one authoritative table for source type, JavaScript representation, `.d.ts` face, conversion mode, and failure mode.

It must include:

1. `Int`, `Float`, `BigInt`, `Bool`, `String`, and `Unit`.
2. Functions and higher-order callbacks.
3. Tuples and structural records.
4. Nominal records, whose runtime and TypeScript faces are structurally represented unless `opaque` changes the boundary face.
5. Unions, including the all-nullary string representation and mixed/payload tagged-POJO representation.
6. `Option(a)` as its real Hexagon union representation, never erased to nullability.
7. `Nullable(a)` as the explicit nullish foreign door.
8. `Array(a)`, `Seq(a)`, `Vector(a)`, Hexagon `Map`/`Set`, and foreign `JsMap`/`JsSet` types.
9. `JsValue` or its final chosen name.
10. `opaque` types and exceptions.
11. Any types forbidden in an `extern` signature or export.

### `Nullable(a)` proto-decision

`Nullable(a)` is the zero-wrapper foreign type whose JavaScript/TypeScript representation is `a | null | undefined`. Merely carrying the value preserves whether the foreign value was `null` or `undefined`; conversion to `Option(a)` deliberately collapses both to `None`.

The companion surface includes:

```hexagon
Nullable.undefined      : Nullable(a)
Nullable.null           : Nullable(a)
Nullable.isNullish       : (Nullable(a)) -> Bool
Nullable.isNull          : (Nullable(a)) -> Bool
Nullable.isUndefined     : (Nullable(a)) -> Bool
Nullable.toOption        : (Nullable(a)) -> Option(a)
Nullable.toCase          : (Nullable(a)) -> NullableCase(a)
Nullable.fromOption      : (Option(a)) -> Nullable(a)  -- None -> undefined
Nullable.fromOptionOrNull : (Option(a)) -> Nullable(a) -- None -> null
```

The exact three-way reading is an ordinary Hexagon union:

```hexagon
union NullableCase(a) =
  Undefined
  | Null
  | Value(value: a)
```

`Nullable.toCase` preserves the distinction and supports exhaustive ordinary pattern matching; the `Value(value)` arm extracts an `a`. `Nullable.toOption` remains the shorter common path when both absence forms deliberately mean `None`.

`isNullish` is true for either foreign absence value. The two narrower predicates exist because some JavaScript APIs distinguish omission/`undefined` from explicit `null`. There are no unqualified `null` or `undefined` literals in ordinary Hexagon source. `Nullable.null` and `Nullable.undefined` are qualified, typed values that can exist only as `Nullable(a)`, providing explicit arguments for foreign APIs without admitting ambient nullish values into Hexagon.

These companion-owned conversion names are the current proto-direction and would supersede Unions §8's provisional `Option.fromNullable` / `Option.toNullable` spellings when the FFI spec lands; that consolidation edit remains owed.

TypeScript-style control-flow narrowing is **not** smuggled in through these predicates. In v1 FFI, `isNullish`/`isNull`/`isUndefined` return `Bool` and do not refine the static type of their argument; `Nullable.toOption` and `Nullable.toCase` are the ordinary checked extraction paths.

Whether Hexagon should ever gain flow-sensitive narrowing is reserved for a separate language/type-system deep dive. The initial presumption is that it may not fit Hexagon's HM/unification-oriented type system, but it is to be studied rather than dismissed without comparison and concrete examples. That deep dive must consider at least aliasing, mutation, closures, user-defined predicates, exhaustiveness, principal types, diagnostics, and whether narrowing would remain local or infect general inference. **This FFI decision supplies a concrete comparison point:** `Nullable.toCase` proved superior here because an explicit ordinary union provides extraction, exhaustiveness, stable types, and clear control flow without predicate-driven refinement. The future deep dive must compare narrowing against such sum-type conversions rather than assuming predicates need magical typing. It is not an FFI decision.

### Runtime-package namespace proto-decision

Generated `.d.ts` files that mention Hexagon-owned runtime types use one type-only namespace import:

```ts
import type * as Hex from "@hexagon/runtime";
```

Their public faces are:

```ts
Hex.Vector<a>
Hex.Map<k, v>
Hex.Set<a>
```

For example:

```ts
import type * as Hex from "@hexagon/runtime";

export declare function makeRow(): Hex.Vector<number>;

export declare function process(
  rows: ReadonlyArray<Hex.Vector<number>>,
): void;

export declare function index():
  Hex.Map<string, Hex.Vector<number>>;
```

`Hex.Map` and `Hex.Set` are visibly distinct from JavaScript/TypeScript's native `Map` and `Set`; `Hex.Vector` is visibly a runtime-owned persistent value rather than `ReadonlyArray`. The import is type-only and adds no emitted JavaScript dependency by itself.

The runtime package exports the naturally named public types `Vector`, `Map`, and `Set`; `Hex` is the generated file's local namespace alias. It is therefore not a claim on a global identifier and does not conflict with unrelated uses of the word elsewhere. The compiler controls the alias in its generated declaration and must resolve the rare collision with a user-exported local `Hex` name deterministically, while preserving `Hex` as the normal spelling.

`Hex` is the standard short form for tooling and generated foreign surfaces. It aligns with the already-decided `.hex` source extension and `hexc` compiler name.

The mental model intentionally resembles C++'s `import std;` plus `std::...`: one short, recognizable namespace houses the platform/runtime vocabulary. TypeScript uses dot qualification, so foreign consumers read `Hex.Vector`, `Hex.Map`, and `Hex.Set`. JavaScript operation exports may support the matching `Hex.Vector.get(...)` style through the runtime's public module surface, but the type-only declaration import does not by itself dictate that runtime export organization.

### Shallow conversion and nested adaptation proto-decision

Named collection conversions change only the collection explicitly named by the operation. They are shallow and preserve element values and their runtime identities:

```text
Vector.toArray : Vector(Vector(Int)) -> Array(Vector(Int))
Map.toJsMap    : Map(k, v) -> JsMap(k, v)
Set.toJsSet    : Set(a) -> JsSet(a)
```

`Vector.toArray` does not recursively produce `Array(Array(Int))`; `Map.toJsMap` does not recursively translate its values; `Set.toJsSet` does not recursively reinterpret its elements. A caller wanting nested conversion maps the appropriate explicit conversion over the nested values. Conversion names therefore state both the work performed and its cost boundary.

An `extern` signature is likewise a recursive representation contract, not a request for an implicit graph traversal. For example:

```hexagon
extern fun rows(): Array(Vector(Int))
```

asserts that the returned value is a JavaScript array containing genuine `@hexagon/runtime` Vector values. `ReadonlyArray<Hex.Vector<number>>` is its legitimate `.d.ts` face. Vector values may cross to JavaScript, be stored there, and return to Hexagon by identity; the trie-backed JavaScript runtime object is the Hexagon Vector value, not a wrapper around a separate value. The outer `Array` remains a zero-copy borrowed foreign array.

Nested representation-direct values are permitted. This includes primitive/native values, `Nullable`, further `Array` layers, records/unions in their specified emitted representations, and genuine Hexagon runtime values such as `Vector`, persistent `Map`, and persistent `Set`, subject to their ordinary declared contracts.

V1 rejects an adapter-requiring type when it appears inside a representation-direct aggregate or borrowed container and cannot be made valid without traversing, copying, proxying, or wrapping that enclosing value. The canonical case is:

```hexagon
extern fun streams(): Array(Seq(Int))
```

An arbitrary `ReadonlyArray<Iterable<number>>` cannot satisfy this declaration honestly: each iterable may require the persistent memoizing `Seq` adapter, while `Array(a)` promises zero-copy direct indexing and iteration. The compiler rejects this boundary shape with a diagnostic identifying the nested adapter-requiring type and recommending an explicit eager conversion/adaptation step. The same rule applies to an adapter-requiring value nested in a direct record, tuple, union payload, or other unwrapped aggregate.

Top-level adaptation remains supported (`Iterable<a>` to `Seq(a)` per §3), and explicit decoders/converters may deliberately traverse a foreign structure and construct a new Hexagon value. Those operations are not zero-copy and must state their failure and complexity contracts. V1 does not attempt proxies, lazy per-field adaptation, automatic deep conversion, or replayability inference to lift the nested restriction.

Whether a later version can safely generalize nested adapters is deferred without a design commitment. It is not required for the v1 FFI.

### Numeric boundary proto-decision

An `extern` type annotation is a trusted programmer assertion, not a request for automatic validation on every call. This is part of the boundary's performance contract: ordinary correctly declared foreign calls remain representation-direct and fast.

The primitive representation requirements are:

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

assert respectively that the implementation returns a safe integral number, an arbitrary JS number, a JS bigint, and a borrowed array whose observed elements are safe integral numbers. The compiler inserts no per-call numeric guards and does not scan `Array(Int)` merely to validate its elements. TypeScript cannot express the `Int` refinement—both `Int` and `Float` face as `number`—so the distinction remains part of the generated contract and documentation.

If a foreign implementation violates its declared numeric contract, the `extern` declaration is wrong and affected Hexagon observations are unspecified. Informally this is a cultural responsibility—authors check that the JavaScript API really satisfies the declaration—but normatively it is a programmer-supplied boundary contract.

Dynamic checks belong to operations whose purpose is to establish a narrower invariant from an uncertain value, for example:

```hexagon
BigInt.toInt    : (BigInt) -> Option(Int)
Int.fromFloat   : (Float) -> Option(Int)       -- if included in the stdlib
JsValue.toInt   : (JsValue) -> Option(Int)     -- if included in the decoder surface
```

`BigInt.toInt` checks range; a Float/unknown-value-to-Int conversion uses `Number.isSafeInteger`. An explicit structural decoder for an unknown array of integers must inspect and validate every element and is necessarily O(n). This does not weaken the zero-scan rule for a trusted `extern fun values(): Array(Int)` declaration.

Existing semantic checks remain unchanged: checked arithmetic checks safety, division checks zero, and integer exponentiation checks negative exponents where their owning specs require it. These are promises of the named operations, not general FFI validation. Ordinary `Int` arithmetic retains Primitive Types §2.1's unchecked plain-JS overflow policy.

The dividing rule is:

> Declaring a foreign value to have a type is trusted. Explicitly converting or decoding an uncertain value into a narrower type is checked.

---

## 5. `extern` declarations and module binding

### Core syntax proto-decision

Foreign bindings use JavaScript's `from "specifier"` vocabulary, TypeScript-like bodyless typed declarations, and Hexagon's existing declaration forms and layout:

```hexagon
extern from "tiny-json"
  export type JsonValue
  export fun parse(text: String): JsonValue
  export fun stringify(value: JsonValue): String
  let VERSION as version: String
```

The block introduces ordinary module-level Hexagon bindings. They are private unless individually prefixed with `export`; an exported extern binding is re-exported from the compiled Hexagon facade and appears in its `.d.ts`. The foreign module specifier may be a bare package specifier because this construct is explicitly outside Hexagon-to-Hexagon import resolution.

Named members use JavaScript's foreign-name-first alias order:

```hexagon
fun parse as parseJson(text: String): JsonValue
let VERSION as version: String
type ForeignNode as Node
```

The unaliased or right-hand name is the local Hexagon binding. `type` declares a nominal opaque foreign type: it has no automatically available structure, constructor, or instances.

Inside an extern block, the declaration keywords make a strict callable/value distinction:

- `fun` declares a callable foreign export.
- `let` declares a non-callable foreign value.

This is contextual foreign-declaration vocabulary. `fun` here means callable, not that Hexagon can see or cares whether the JavaScript implementation is recursive; extern declarations have no bodies. The trusted-boundary rule remains: declaring a non-callable JS export with `fun`, or a value with an incompatible declared type, is a programmer contract violation rather than a reason for automatic runtime inspection.

Targeted syntax diagnostics prevent the ordinary Hexagon `let`-function habit from obscuring the distinction:

```hexagon
extern from "tiny-json"
  let parse(text: String): JsonValue
```

> extern callable declarations use `fun`; write `fun parse(text: String): JsonValue`

Conversely, an extern `fun` without a parameter list points to `let` for a foreign value. A deliberately opaque callable object is future specialized surface, not a reason to blur v1 `fun` and `let`.

### Extern `method`: receiver-call proto-decision

`method` is the right foreign declaration keyword by analogy with Hexagon's companion-module organization:

- a module offers functions directly—no analogy is required, because Hexagon modules map closely to JavaScript modules;
- a companion module offers operations that play the role methods play on a class, but with a stricter separation between data and functions and without inheritance;
- an extern `method` binds an actual JavaScript receiver call into that companion-style Hexagon surface.

For example:

```hexagon
extern from "url-tools"
  export type SearchParams

  export method get(
    params: SearchParams,
    key: String,
  ): Nullable(String)
```

The first parameter is mandatory and remains the explicit Hexagon subject. Hexagon sees the ordinary function type:

```text
(SearchParams, String) -> Nullable(String)
```

A direct call:

```hexagon
import * as SearchParams from "./search-params"

SearchParams.get(params, "name")
```

emits the receiver-sensitive JavaScript call:

```js
params.get("name")
```

Thus `method` records a foreign calling convention, not a new Hexagon object model. Hexagon gains no `this`, implicit receiver, inheritance, overriding, prototype dispatch, or distinct method type. Pipes and ordinary subject-first ordering remain unchanged because the JS receiver originates in the first visible argument.

An extern method referenced as a first-class value must materialize a wrapper that preserves this convention:

```hexagon
let lookup = SearchParams.get
```

```js
const lookup = (params, key) => params.get(key);
```

The raw detachable property function is never exposed as the Hexagon value. Named method aliases follow the extern foreign-name-first rule (`method get as lookup(...)`). A missing first parameter or a receiver type that cannot cross the boundary receives a targeted declaration error.

### Extern `get` / `set`: receiver-property proto-decision

Receiver properties follow their JavaScript operation by analogy, while entering Hexagon as ordinary subject-first companion functions:

```hexagon
extern from "web-response"
  export type Response
  export type Headers

  export get status(response: Response): Int
  export get headers(response: Response): Headers
  export get redirected(response: Response): Bool
```

Hexagon calls:

```hexagon
Response.status(response)
Response.headers(response)
```

emit property reads:

```js
response.status
response.headers
```

`get` means a property-read operation. It deliberately does not distinguish a stored data property from a JavaScript accessor getter, because callers use the same syntax and the foreign implementation may change without altering the binding. Every Hexagon call performs a fresh read; the compiler must not cache, hoist, or common-subexpression-eliminate it merely because Hexagon bindings are immutable. A foreign property read may compute, vary, or throw.

A getter referenced as a first-class Hexagon function materializes a wrapper:

```hexagon
let readStatus = Response.status
```

```js
const readStatus = response => response.status;
```

Its ordinary Hexagon type is `(Response) -> Int`.

A writable property requires an explicit `set` declaration; a `get` declaration alone grants no Hexagon write capability even if JavaScript could technically assign the property:

```hexagon
extern from "http-client"
  export type Request

  export get timeout(request: Request): Int

  export set timeout as setTimeout(
    request: Request,
    value: Int,
  ): Unit
```

```hexagon
Request.setTimeout(request, 5000)
```

```js
request.timeout = 5000;
```

The setter's first parameter is the subject, its final parameter supplies the assigned value, and its return type must be `Unit` regardless of JavaScript assignment expressions yielding the assigned value. This follows Hexagon's existing honest-`Unit` assignment doctrine. Getter and setter cannot introduce the same term name, so the setter uses an explicit local alias (`set timeout as setTimeout`) rather than an implicit capitalization rule.

The four core foreign member forms now have one-to-one operational meanings:

```text
fun     named module export call     parse(text)
method  receiver call                params.get(key)
get     receiver property read       response.status
set     receiver property write      request.timeout = value
```

All four become ordinary explicit Hexagon bindings with stable subject-first types. Only their foreign linkage and emission differ.

### Extern `class` and companion construction proto-decision

`class` is valid foreign-description vocabulary inside `extern`, because a binding author working at that boundary necessarily knows the JavaScript API may contain classes. It does not add classes to Hexagon. An extern class lowers to an opaque foreign type plus ordinary companion functions; Hexagon gains no inheritance, subclassing, overriding, implicit receiver, or class-valued type-system feature.

The primary companion constructor name is culturally **`create`**:

```hexagon
Url.create(text)
Point.create(x, y)
Customer.create(name, email)
```

The name has no compiler semantics and is not enforced for user APIs. It names the caller's perspective: the companion module is a black box, the caller requests a value, and the value appears. How the implementation allocates, validates, normalizes, or incrementally makes that value is deliberately hidden and should not determine the public name.

More specific construction names are preferred whenever they communicate meaningful behavior:

```hexagon
Vector.empty
Vector.singleton(value)
Vector.fromSeq(values)
UserId.parse(text)
Regex.compile(pattern)
Connection.open(config)
```

Thus the house rule is:

> Use `create` for a type's primary unsurprising constructor. Use `empty`, `singleton`, `fromX`, `parse`, `compile`, `open`, or another domain-specific name when it says more.

`new` is reserved for describing the JavaScript side of a foreign class constructor and normally maps explicitly to the Hexagon companion name:

```hexagon
extern from "node:url"
  class URL as Url
    new as create(text: String)
```

```hexagon
Url.create(text)
```

```js
new URL(text)
```

This makes the boundary translation honest: JavaScript constructs with `new`; Hexagon callers use the companion's ordinary `create` function. Other local names remain legal when they are semantically better; the FFI does not silently rename every constructor.

### Extern class static members and visibility proto-decision

**Status:** provisionally accepted for v1; reopen on a concrete counterexample rather than speculative complexity.

An extern class may declare static receiver operations alongside construction and instance members:

```hexagon
extern from "node:url"
  export class URL as Url
    new as create(text: String)

    static method canParse(text: String): Bool
    static get defaultPort(): Int

    method toString(url: Url): String
    get hostname(url: Url): String
```

The Hexagon companion surface is:

```hexagon
Url.create(text)
Url.canParse(text)
Url.defaultPort()
Url.toString(url)
Url.hostname(url)
```

with representative emission:

```js
new URL(text)
URL.canParse(text)
URL.defaultPort
url.toString()
url.hostname
```

Static member declarations use `static method`, `static get`, and `static set`. They target properties on the imported JavaScript constructor object. `static method` retains receiver-call emission because a JavaScript static method may observe its constructor as `this`; a first-class Hexagon reference therefore materializes a preserving wrapper rather than detaching the raw property function. Static getters perform a fresh read, and static setters return `Unit`, following the already-fixed instance-member rules.

Visibility is deliberately simple:

- `export class` exports the opaque foreign type and every member declared in its extern class block;
- unprefixed `class` keeps the type and all declared members private to the binding module;
- JavaScript members omitted from the declaration do not exist in Hexagon, regardless of their visibility in JavaScript.

This matches the existing rule that `export` exports everything a declaration introduces and avoids a second nested visibility system. Selective public/private members within one declared extern class are deferred. Binding authors omit unwanted members; if a real library requires a private raw member to implement a public safe facade around the same exported type, that example is the revisit bar.

### Other core forms

Effect-only foreign imports use:

```hexagon
extern import "telemetry/register"
```

This introduces no bindings and executes the foreign module's top-level effects. It remains visibly distinct from an effect import between `.hex` modules.

### Default-export binding proto-decision

JavaScript default exports ship in v1. Inside an extern block, `default` can only identify the incoming JavaScript default export—Hexagon modules have no default exports—so the familiar modifier order is unambiguous:

```hexagon
extern from "client-library"
  default fun createClient(config: Config): Client
```

```js
import createClient from "client-library";
```

The binding is private by default. The ordinary leading `export` modifier makes the resulting local Hexagon binding public:

```hexagon
extern from "client-library"
  export default fun createClient(config: Config): Client
```

This does **not** create a Hexagon or emitted-JS default export. Directionally:

```text
incoming JS default export
        -> local Hexagon binding createClient
        -> named Hexagon export createClient
```

Representative emission may alias the foreign import internally:

```js
import createClient$foreign from "client-library";
export const createClient = createClient$foreign;
```

The same linkage modifier applies to values and classes:

```hexagon
extern from "settings"
  default let settings: Settings

extern from "database-client"
  export default class Client
    new as create(config: Config)
```

`export` keeps its sole Hexagon meaning throughout: expose the declaration's local binding. `default` keeps its extern-only meaning: select the unnamed JavaScript export. The contextual reading is preferred over the less familiar `default export` order.

Optional/default parameters are not introduced by FFI. V1 extern callables have fixed visible arity; an API's explicit nullish slot is modeled honestly, for example:

```hexagon
extern from "library"
  fun lookupRaw(
    key: String,
    fallback: Nullable(String),
  ): String
```

Callers use `Nullable.undefined` for the ordinary omitted/default JS case and `Nullable.null` when the API specifically distinguishes explicit null. Rest parameters, overload declarations, and general optional-argument syntax remain outside this core decision.

### Still open in this package

1. Globals, CommonJS-specific binding forms, overloads, and rest/variadic externs; directional preference remains to defer them until a concrete foundational library requires them.
2. Final diagnostics for unsupported or unrepresentable signatures beyond the core forms fixed above.

---

## 6. Function and callback calling convention

### V1 proto-decision

- Hexagon's visible source argument order is preserved in emitted JavaScript.
- Subject-first APIs and pipe-to-first rewriting remain intact at the boundary.
- Constraint evidence, when required, forms a trailing suffix rather than occupying the subject slot.
- Foreign throws use the `JsError` path.
- Extern `method` lowers its first visible subject argument to the JavaScript receiver/`this`; Hexagon itself has no `this`, and first-class method references use a preserving wrapper (§5).

Callbacks are required for a usable JavaScript FFI, but v1 supports only **representation-direct callback signatures**. Every callback parameter and result type must cross without per-call adaptation, recursively under the existing nested-adapter rule (§4). Such callbacks are passed as the same JavaScript function object in both directions:

```hexagon
extern from "event-source"
  type Event
  type Target

  fun addListener(
    target: Target,
    callback: (Event) -> Unit,
  ): Unit

  fun removeListener(
    target: Target,
    callback: (Event) -> Unit,
  ): Unit
```

`Event` is an opaque representation-direct foreign value, and `Unit` is JavaScript `undefined`; no wrapper is required. Passing the same Hexagon function to `addListener` and `removeListener` therefore passes the same JS function identity naturally. No weak wrapper cache exists in v1 because no supported callback signature needs a wrapper.

Representation-direct callback types include primitives/native values, `Nullable`, borrowed `Array` whose nested types are themselves representation-direct, records/unions in their specified emitted representations, genuine Hexagon runtime values (`Hex.Vector`/`Hex.Map`/`Hex.Set`), and opaque foreign types. Ordinary Hexagon functions are n-ary JavaScript functions with the same visible argument order. A `Unit` result faces as TypeScript `void` and returns JavaScript `undefined`; meaningful callback results are preserved.

Adapter-requiring callback signatures are rejected in v1. The canonical example is:

```hexagon
extern from "stream-tools"
  fun visit(callback: (Seq(Int)) -> Unit): Unit
```

An arbitrary JS `Iterable<number>` would require a fresh persistent-`Seq` adaptation at each callback invocation, which in turn introduces wrapper identity, retention, failure, and lifetime questions. V1 does not generate that wrapper. The diagnostic identifies the nested `Seq` and recommends a representation-direct type, an explicit eager conversion at a controlled boundary, or a small JavaScript shim. This does not affect already-decided **top-level** `Seq` crossing (`extern fun values(): Seq(Int)`), whose one boundary adapter remains supported (§3).

JavaScript may invoke an ordinary callback with a `this` value, but Hexagon callbacks cannot observe it and v1 simply ignores it. The original function object may be passed directly; JS invocation-supplied `this` has no Hexagon binding. APIs that require callback code to observe the callback receiver are unsupported in v1 and use an explicit receiver argument or a JavaScript shim. This is distinct from extern `method`, where Hexagon supplies an explicit first subject and emission restores that subject as JS `this`.

Arity follows the trusted-boundary doctrine. Hexagon calls checked extern functions at their exact declared arity. A JavaScript caller of an exported Hexagon function is expected to satisfy its generated `.d.ts`; extra JS arguments are naturally ignored, while missing or invalid arguments violate the boundary contract. No general runtime arity validation is inserted.

Exceptions require no callback-specific mechanism: branded Hexagon exceptions thrown through a callback remain JS throws; foreign throws returning into Hexagon follow the existing `JsError` discrimination. Callback retention by JavaScript is permitted; Hexagon's existing ban on capturing `var` across lambda boundaries remains unchanged and requires no unverifiable synchronous/escaping annotation.

### Deferred callback surface

The following are excluded from v1 and reserved for a later FFI/async deep dive:

1. Callback arguments or results requiring `Seq` or any other runtime boundary adapter.
2. Wrapper caching keyed by original function plus boundary signature; unnecessary until adapting callbacks exist.
3. Callback-visible JavaScript `this` or receiver-aware callback types.
4. Promise-returning callbacks, async callbacks, and rejection-channel integration.
5. Optional, overloaded, or rest/variadic callback signatures.
6. Runtime identity guarantees for repeatedly crossing callbacks through different adapting signatures.

The revisit bar is a concrete foundational JavaScript API that cannot be bound honestly with representation-direct callbacks or a small explicit shim.

---

## 7. Hexagon exports consumed by JavaScript

### Export correspondence proto-decision

Hexagon's existing `export` is the sole foreign-export permission. Every exported declaration becomes an ordinary named ESM export where it has a runtime term and appears in the generated `.d.ts` where it has a public type face. There is no second `export ffi` system and no automatic default export.

Representation-direct values and functions export directly with stable ESM identity. For example:

```hexagon
export let version = "1.0"
export let double(x: Int): Int = x * 2
```

have the ordinary JavaScript/TypeScript shape:

```ts
export declare const version: string;
export declare function double(x: number): number;
```

### Records

An exported non-opaque record already exports its type and constructor under Modules §4.1. Both cross:

```hexagon
export record Point = {x: Float, y: Float}
```

```ts
export type Point = {x: number; y: number};
export declare function Point(value: {x: number; y: number}): Point;
```

The runtime constructor may be the representation-honest identity function because `Point` is already the POJO. JavaScript may also construct the structural object directly; the exported constructor provides the supported, discoverable shape.

### Unions

An exported non-opaque union exports its type and every constructor, exactly as it does between Hexagon modules. Payload constructors are JS functions; nullary tagged-POJO constructors are values; all-nullary string-union constructors are string constants:

```ts
export type Shape =
  | {tag: "Circle"; radius: number}
  | {tag: "Point"};

export declare function Circle(radius: number): Shape;
export declare const Point: Shape;
```

```ts
export type Color = "Red" | "Green" | "Blue";
export declare const Red: Color;
export declare const Green: Color;
export declare const Blue: Color;
```

### Opaque values

`export opaque record` and `export opaque union` export the type only; their raw fields and constructors remain absent from JavaScript exports and `.d.ts`, while explicitly exported smart constructors/accessors cross as ordinary functions. The TypeScript face uses a private `unique symbol` brand and hides the representation:

```ts
declare const userIdBrand: unique symbol;
export type UserId = {readonly [userIdBrand]: never};
```

The brand is TypeScript-only. No runtime wrapper, tag, or validation is added; the existing erased runtime value crosses out and back by identity. TypeScript discourages structural fabrication, while untyped JavaScript remains governed by the trusted-boundary contract.

### Exceptions

An exported payload exception provides its branded `Error` type and a JS constructor function:

```ts
export type ParseError = Error & {
  readonly $hex: true;
  readonly name: "ParseError";
  readonly line: number;
};

export declare function ParseError(
  line: number,
  message: string,
): ParseError;
```

A nullary exception is value-shaped in Hexagon source but must be function-shaped for JavaScript consumers:

```ts
export declare function NotFound(): NotFound;
```

Each JS call constructs a fresh branded `Error` and captures the call-site stack. Exporting one constant would capture a stale module-initialization stack and violate the existing fresh-nullary-exception semantics. This is a deliberate, documented surface difference: Hexagon writes `throw(NotFound)`; JavaScript writes `throw NotFound()`.

### Direct exports and stable wrappers

Export directly when the runtime value already has its declared JS representation: primitives, `Nullable`, `Array`, genuine `Hex.Vector`/`Hex.Map`/`Hex.Set` values, records/unions, opaque erased values, and representation-direct functions/callbacks.

Generate one stable module-level boundary wrapper only when a supported **top-level** signature needs adaptation or calling-convention plumbing. Examples are an incoming `Iterable<a>` parameter declared as `Seq(a)` and a generic constrained export with trailing dictionary evidence. The wrapper is allocated once with the ESM binding, not per reference or call, so its JS identity is stable. The v1 nested-adapter/callback restrictions remain unchanged.

No wrapper performs general defensive validation. Explicit decoders/converters retain their own checked semantics; ordinary exported signatures remain trusted contracts.

### ABI warning: the union representation cliff

Generated FFI documentation must state:

> An all-nullary union is represented as string literals. Adding the first payload-bearing constructor changes the complete union representation to tagged objects and is a breaking change for JavaScript consumers.

Hexagon callers are protected by recompilation and `match`; JavaScript consumers are not. Adding any constructor is already an exhaustiveness break, but the first payload-bearing addition also changes the representation of every existing constructor.

---

## 8. Exported constraint dictionaries

**Detailed companions:** `ffi-zero-cost-primitive-exports.md`; `ffi-exported-dictionaries.md`. Those notes own examples, expansion mechanics, evidence shapes, ABI, and revisit bars; this section records the FFI-level package.

### Hybrid export proto-decision

An exported constrained-polymorphic function generates:

1. direct dictionary-free named specializations for every lawful combination of the closed fundamental set (`Int`, `Float`, `BigInt`, `Bool`, `String`, `Unit`); and
2. the source base-name generic edition with trailing dictionary evidence when the public instance graph contains usable non-fundamental evidence satisfying its constraints.

Private types and internal call sites never reshape the JS export surface. Fundamental specializations are unconditional for the exported declaration. Multiple constrained variables generate the complete lawful Cartesian product provisionally; suffix order follows declared type-variable order. Generated-name collisions with explicit exports are hard errors.

Example:

```hexagon
export let plus<a: Num>(x: a, y: a): a = x + y
```

```ts
export declare function plusInt(x: number, y: number): number;
export declare function plusFloat(x: number, y: number): number;
export declare function plusBigInt(x: bigint, y: bigint): bigint;

// Present when public usable non-fundamental Num evidence exists:
export declare function plus<a>(
  x: a,
  y: a,
  num: Num.Dictionary<a>,
): a;
```

The fundamental functions contain direct concrete emitted operations; they are not wrappers around the generic edition.

### Dictionary types and public evidence

Dictionary types are distinct constraint-qualified Hexagon ABI types expressed in TypeScript:

```ts
Num.Dictionary<a>
Eq.Dictionary<a>
Show.Dictionary<a>
```

All Hexagon-originated `.d.ts` generic binders use lowercase Hexagon convention (`a`, `b`, `k`, `v`). Fundamental evidence is constraint-owned (`Num.int`, `Show.string`, `Eq.bool`). Public non-fundamental evidence is type-owned under the lowercase constraint name (`Rat.num`, `Customer.show`).

Every lawful instance whose constraint, outer type constructor, and handle/factory signature are publicly nameable receives a public handle or factory. This is determined by public capability, not current consumption. Private instances remain compiler plumbing.

Parameterized evidence is a real companion factory:

```ts
Vector.show(Show.string)
Option.eq(Eq.int)
Map.show(Show.string, Show.int)
```

The short public name matches the implementation: it accepts required evidence and returns the composed dictionary object.

### Evidence ABI

- Evidence occupies the trailing suffix; pipes/source arguments stay at the left edge.
- Multiple evidence parameters order by type-variable ordinal then constraint name; alpha-renaming cannot alter ABI.
- Superconstraint dictionaries are nested; callers pass the most specific required dictionary.
- TypeScript `unique symbol` branding distinguishes constraint/value evidence statically.
- Fixed-arity v1 calls perform no routine runtime dictionary validation under the trusted-boundary doctrine.
- Dictionary objects should be frozen where practical.
- Cross-package evidence requires a compatible `@hexagon/runtime` dictionary ABI.
- Changing constraint members, superconstraint slots, factory argument order, or evidence order is an ABI event.
- Variadic right-edge evidence extraction remains deferred with general rest parameters; it is not v1 surface.

---

## 9. `Map` and `Set` conversions

### Already fixed by Collections Part 4

- Names: `Map.toJsMap` / `Map.fromJsMap`, `Set.toJsSet` / `Set.fromJsSet`.
- Primitive keys/elements are faithful through SameValueZero alignment.
- Hexagon-to-JS structural keys become reference-identity keys; reconstruction in JS does not recover lookup identity.
- JS-to-Hexagon equality collapse is deterministic; for maps the later entry wins in source iteration order.

### Closed conversion direction

- All four conversions create snapshots; they never share mutable JS Map/Set storage with a persistent Hexagon collection.
- Conversion is shallow under §4: the named outer collection changes representation, while keys/elements/values retain their declared runtime values and identities. Key ingestion still performs the hashing/equality work required by the destination collection.
- Persistent Hexagon results/faces use `Hex.Map<k, v>` and `Hex.Set<a>` through the type-only `Hex` runtime namespace import.
- Primitive equality faithfulness, object-reference caveats, collapse order, and public function names remain exactly as inherited above.

### Still open

1. Final foreign type names and accessor surfaces: `JsMap`, `JsSet`, or alternatives, coupled to `ReadonlyMap<k, v>` / `ReadonlySet<a>` `.d.ts` faces.
2. Cyclic structural-key detection and the common conversion-failure result/exception chosen with §10.

---

## 10. Foreign values, nullability, and conversion failure

### Must decide

1. Final name: `JsValue`, `Foreign`, or another spelling.
2. Minimum safe accessor set, including:

   ```hexagon
   JsError.message : (JsValue) -> String
   JsError.stack   : (JsValue) -> Option(String)
   ```

3. Behaviour for arbitrary thrown values including `null`, strings, symbols, and hostile objects with throwing property accessors.
4. Whether `JsError` accessors coerce, inspect conservatively, or may themselves surface a foreign throw.
5. A common conversion-failure exception or per-conversion result types.
6. Cycle reporting and useful path diagnostics for structural conversion.
7. The exact relationship between `JsValue`, `Nullable(a)`, and unsafe casts/decoders, if any.

---

## 11. Confirmed exclusions and deferred surfaces

Confirm explicitly in the normative FFI spec:

- No mutable Hexagon array type in v1; `Array(a)` is the readonly foreign door.
- No claim that a bare JavaScript iterator already satisfies persistent `Seq` semantics.
- No async sequence boundary until the async specification defines `Promise`, `AsyncSeq`, and rejection semantics.
- No general reflection, prototype-driven type dispatch, or automatic foreign instance search.
- No automatic **user-type** monomorphic export explosion. The closed fundamental set deliberately receives named specializations (`plusInt`/`plusFloat`/`plusBigInt`); public user types share the generic dictionary edition.
- No inspection of the internal dependency graph of an extern JavaScript module.
- No TypeScript-style flow narrowing introduced by `Nullable` predicates; the feature is reserved for a separate type-system deep dive.

---

## 12. Proposed decision order

1. Boundary trust and failure doctrine.
2. `Array(a)` borrowed-view package.
3. `Seq(a)` inbound persistence adapter and exported replayability.
4. Master type-mapping table, including `Nullable`.
5. `extern` syntax and module binding.
6. Functions, callbacks, and exception propagation.
7. Hexagon-to-JavaScript export surface and ABI.
8. Zero-cost fundamental specializations and exported constraint dictionaries.
9. Map/Set conversions and general conversion failures.
10. `JsValue`, opaque TypeScript faces, diagnostics, and acceptance tests.

This order establishes semantic ownership and lifetime before syntax, then defines ordinary value/function crossings before the exceptional dictionary and structural-conversion cases.
