# Hexagon FFI Part 6: Functions and Callbacks

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing. Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §6. The draft's two clarifications were confirmed in §12: a foreign callable declared with a `Unit` result discards its return value, and a function-typed extern `let` is a hard error with the `fun` rewrite. Review also tightened branded-exception re-entry (§4) and the receiver-independence contract for raw inbound function values (§5.3/§6).
**Scope:** The boundary calling convention for function values in both directions; fixed visible arity and the no-validation arity doctrine; lowering (the identity, and the exhaustive list of places a wrapper exists instead); `Unit` at the boundary; foreign throws and Hexagon exceptions crossing through calls and callbacks; the v1 representation-direct callback subset, its identity guarantees, and the rejection of adapter-requiring callback signatures; callback `this`; retention and capture.
**Not in scope:** extern declaration syntax and receiver members (Parts 4–5 — consumed, not restated); the `Seq` adapter itself (Part 3); the export surface, `.d.ts` generation, and stable export wrappers' emission details (Part 7); constrained functions and trailing dictionary evidence (Parts 8–9); Promise semantics, async callbacks, and rejection channels (deferred with the async specification; Part 1 §4.4).
**Companions:** Functions §5/§5.1/§5.3/§9 (n-ary application, displayed types, nullary functions, emission); Exceptions §6–§7 (`JsError`, virtual wrapping, branded representation, two-stage discrimination); Part 1 §1–§5 (trusted boundary, categories, master table, nested-adapter restriction); Part 3 §9.3 (callback-position `Seq` rejection assigned here); Part 4 §4 (`fun`/`let`, first-class extern references); Part 5 §2.3 (stable convention-preserving wrappers).

---

## 1. Doctrine: the calling convention is the identity

Hexagon's visible source argument order is preserved in emitted JavaScript, and Hexagon's n-ary functions **are** n-ary JavaScript functions (Functions §9). For representation-direct signatures — the common case, and the only callback case in v1 — the boundary calling convention is therefore the identity:

- **No currying and no uncurrying exist anywhere.** Hexagon has no currying (Functions §1) and the boundary introduces none: a two-parameter Hexagon function is a two-parameter JS function, called as `f(x, y)` on both sides. There is no arguments-object packing, no tuple lowering, no spread.
- **Subject-first APIs and pipe-to-first rewriting remain intact at the boundary.** The pipe is resolved before emission (Operators §8); what crosses is the ordinary call.
- **Constraint evidence, when required, forms a trailing suffix** rather than occupying the subject slot — referenced here, governed by Parts 8–9.
- **Extern receiver members lower their first visible subject argument to the JavaScript receiver** — Part 5's rule, restated for completeness, not modified.

Wrappers exist only where a named rule puts one, and this list is exhaustive for v1:

| Wrapper | Owner |
|---|---|
| stable export wrapper for a supported top-level adapted position (e.g. incoming `Iterable<a>` declared `Seq(a)`) | Parts 3/7; Part 4 §4.3 for the extern-binding face |
| stable convention-preserving wrapper for first-class receiver members (`method`/`get`/`set`/`new`, incl. static) | Part 5 §2.3 |
| stable export wrapper for a generic constrained export when its internal calling convention needs public-ABI plumbing; otherwise the trailing-evidence function exports directly | Parts 7–9 |

**Every boundary function wrapper in this table is module-level, allocated once with its ESM binding, with stable JS identity.** This statement is about the named callable wrapper, not fresh per-value adapters created by a call (Part 3 §2.1). No supported v1 *callback* signature requires any wrapper at all (§5), which is what makes callback identity trivial rather than cached.

---

## 2. Arity

### 2.1 Hexagon calling foreign: exact declared arity

Hexagon calls checked extern callables (and inbound function values, §5.4) at their **exact declared arity** — the fixed visible arity of Part 4 §9, checked at compile time like every Hexagon call (Functions §5: "`f` expects 2 arguments, got 1"). The emitted call supplies exactly the declared arguments; the compiler never pads, drops, or reorders. An API's optional slot is modeled honestly with `Nullable(...)` and an explicit `Nullable.undefined` argument (Part 4 §9); rest parameters and overloads remain deferred (Part 4 §11).

### 2.2 JavaScript calling Hexagon: the trusted contract, no validation

A JavaScript caller of an exported Hexagon function is expected to satisfy its generated `.d.ts`. Under the trusted-boundary doctrine (Part 1 §1):

- **Extra JS arguments are naturally ignored** — an n-ary JS function ignores extras; this is a fact of the representation, documented, not a validated behavior.
- **Missing or invalid arguments violate the boundary contract**, with unspecified affected observations (Part 1 §3.1).
- **No general runtime arity validation is inserted.** No wrapper counts `arguments`; ordinary exported functions remain the direct emitted functions.

### 2.3 JavaScript invoking a Hexagon callback

The same two facts apply per invocation: JavaScript APIs that supply extra callback arguments (`forEach`'s `(value, index, array)`) are harmless against a Hexagon callback declared with fewer parameters — the extras are ignored by the representation. Supplying *fewer* arguments than the callback's declared parameters, or ill-typed ones, is a contract violation by the foreign API's binding declaration.

### 2.4 Function-typed extern `let` is a hard error

Part 4 §4.1's strict distinction — `fun` declares callable, `let` declares non-callable value — is sharpened here for the annotation-only corner: an extern `let` whose declared type is a function type is a hard error, since it declares a callable while dodging the callable keyword.

> extern callable declarations use `fun`; a binding of type `Int -> Int` is callable — write `fun f(x: Int): Int`

Nothing is lost: an extern `fun` is already usable first-class (Part 4 §4.3). This is the confirmed Part 4 callable/value distinction, including the annotation-only spelling (§12.2).

---

## 3. `Unit` at the boundary

### 3.1 Faces

`Unit`'s JS representation is `undefined`; its `.d.ts` face is `void` in return position and `undefined` elsewhere (Part 1 §4.1). A `Unit`-returning Hexagon function or callback returns JavaScript `undefined` naturally (Functions §9); nothing is manufactured at the boundary. Meaningful callback results are preserved — a callback declared `Event -> Bool` returns its `boolean` to the foreign caller unchanged.

### 3.2 A declared `Unit` result is discarding, not trusting

When Hexagon calls a foreign callable declared with result `Unit`, the foreign return value — whatever it is — is **discarded**: the emitter never propagates a foreign return value into a `Unit`-typed position (emission is the call in statement position, or `void expr` where an expression is needed). Declaring `: Unit` therefore does *not* assert that the JavaScript implementation returns `undefined`; it asserts that the result is meaningless and unobserved.

This is the one deliberately lenient spot in the trusted boundary, and it is lenient by construction rather than by validation: discarding costs nothing, and it matches both TypeScript's `void`-assignability culture and this corpus's existing practice — Part 5's `set` emission (`request.timeout = 5000;`) already discards the JS assignment-expression value under the honest-`Unit` doctrine. The rejected alternative — treating a value-returning JS function declared `: Unit` as a §3.1 contract violation — would make every fire-and-forget use of a value-returning JS API (`array.push`, chaining APIs, `Map.prototype.set`) formally undefined behavior, for no observable benefit. Confirmed at review (§12.1).

The rule is direction-specific: an **exported Hexagon** function declared `: Unit` genuinely returns `undefined`, so its `void` face is honest with no discarding needed.

### 3.3 Nullary functions

`() -> r` is a zero-parameter function on both sides; no unit value is passed in either direction (Functions §5.3). `Unit` never appears as a manufactured argument.

---

## 4. Foreign throws and exceptions across the boundary

Exceptions require **no boundary-specific mechanism in either direction**; this section consolidates what existing specs already fix.

### 4.1 Inbound: branded exceptions remain domestic; other throws use `JsError`

Any throw entering Hexagon from a foreign call — an extern `fun`/`method` call, a `get`/`set` property operation, a `new` construction, or an inbound function value's invocation (§5.3) — goes through Exceptions §7.4's ordinary two-stage discrimination. A branded Hexagon exception remains domestic even if it travelled through foreign frames; every other thrown value takes the `JsError` foreign branch, with the raw value bound directly and no wrapper allocated (the wrapping is virtual, Exceptions §6.2). No arbitrary thrown value is decoded (Part 1 §1). JS's degenerate throws (`throw null`, `throw "oops"`) are unbranded and therefore foreign; the discriminator's null guard handles them.

### 4.2 Outbound: Hexagon exceptions are honest JS throws

A Hexagon exception thrown into JavaScript — whether by an exported function or by a Hexagon callback executing under a foreign caller — is the branded `Error` object of Exceptions §7.1: real stack, `name` discriminant, flat payload fields, `$hex` brand. Foreign code catches it as an ordinary `Error`; its `.d.ts` face, where exported, is Exceptions §7.5's intersection type. Nothing is unwrapped, translated, or double-wrapped at the boundary.

### 4.3 Through callbacks: round trips compose from the two rules above

A Hexagon callback that throws propagates a JS throw through the foreign caller (§4.2); if that throw travels through foreign frames and returns into a Hexagon `try` (the extern call that invoked the API), it is **still branded** — the domestic branch of the discrimination catches it as the Hexagon exception it never stopped being. A foreign callback invoked *by* Hexagon (an inbound function value) that throws surfaces as `JsError` (§4.1). A foreign API that catches, swallows, or replaces a Hexagon callback's throw does what that API does — the boundary makes no delivery promise on behalf of foreign control flow.

---

## 5. Callbacks: the v1 representation-direct subset

### 5.1 The rule and the mechanism

Callbacks are required for a usable JavaScript FFI, but v1 supports only **representation-direct callback signatures**: every callback parameter and result type must cross without per-call adaptation, recursively under the nested-adapter rule (Part 1 §5.3). Such callbacks are passed as **the same JavaScript function object in both directions** — no wrapper, no copy, no identity translation:

```hexagon
extern from "event-source"
    export type Event
    export type Target

    export fun addListener(
        target: Target,
        callback: Event -> Unit,
    ): Unit

    export fun removeListener(
        target: Target,
        callback: Event -> Unit,
    ): Unit
```

`Event` is an opaque representation-direct foreign value and `Unit` is JavaScript `undefined`; no wrapper is required. Passing the same Hexagon function to `addListener` and then `removeListener` passes the same JS function identity naturally — the listener actually deregisters. **No weak wrapper cache exists in v1 because no supported callback signature needs a wrapper**; identity preservation is a consequence of the representation, not a caching feature.

### 5.2 What qualifies

Representation-direct callback eligibility is applied recursively: primitives and native values, `Nullable`, borrowed `Array` whose nested types are themselves representation-direct, records and unions in their specified emitted representations, declared exceptions and `Exn`, genuine Hexagon runtime values (`Hex.Vector`/`Hex.Map`/`Hex.Set`, crossing by identity), opaque extern types, and function types built from the same set. Here `Array` retains Part 1 §2.2's **borrowed** category and stability contract; it qualifies because the same array object crosses with no per-invocation adapter, copy, or callback wrapper. Ordinary Hexagon functions are n-ary JavaScript functions with the same visible argument order (§1), so a function-typed callback parameter or result nests without ceremony.

A practical shape this admits today, without waiting for Part 11: Node-style error-first callbacks, declared honestly against an opaque error type —

```hexagon
extern from "legacy-io"
    export type IoError

    export fun readText(
        path: String,
        callback: (Nullable(IoError), Nullable(String)) -> Unit,
    ): Unit
```

### 5.3 Inbound function values

A foreign function entering Hexagon at a function-typed boundary position — an extern `fun`'s function-typed result, a function-typed record field, a callback handed back — is, symmetrically, the raw foreign function object as the Hexagon function value. Hexagon calls it at its exact declared arity (§2.1); its throws follow §4.1's discrimination; its declared signature is trusted (Part 1 §1). Crossing back out, it is still the same object.

Because no wrapper binds a receiver, the declaration also asserts that this raw function is **receiver-independent**: calling it with no meaningful JavaScript `this` must satisfy the signature. A function-valued property that relies on its owning object as `this` is not honestly representable as a detached function value; bind it as an extern `method` with an explicit subject when possible, or use a JavaScript shim that binds the receiver.

### 5.4 Adapter-requiring callback signatures are rejected

The canonical example:

```hexagon
extern from "stream-tools"
    fun visit(callback: Seq(Int) -> Unit): Unit
```

An arbitrary JS `Iterable<number>` would require a fresh persistent-`Seq` adaptation **at each callback invocation**, which drags in wrapper identity, retention, failure memoization, and lifetime questions that v1 deliberately refuses (Part 3 §10). V1 does not generate that wrapper. This is a hard error at the extern declaration, and it discharges the rejection Part 3 §9.3 and §11 assigned to this part. Per the Rewrite Rule, the diagnostic identifies the nested adapter-requiring type and names the three rewrites:

> callback parameter `Seq(Int)` requires a boundary adapter, which v1 callbacks do not support; use a representation-direct type (e.g. `Array(Int)`), perform an explicit eager conversion at a controlled boundary, or bind through a small JavaScript shim

The same rejection applies to any adapter-requiring type anywhere in a callback signature, in either direction, under Part 1 §5.3's recursive rule. It does **not** affect already-decided top-level `Seq` crossing (`extern fun values(): Seq(Int)`), whose one stable boundary adapter remains supported (Part 3).

---

## 6. Callback `this` is ignored

JavaScript may invoke any callback with a `this` value. **Hexagon callbacks cannot observe it, and v1 simply ignores it.** The original function object may be passed directly; JS invocation-supplied `this` has no Hexagon binding, and emitted Hexagon functions never read `this`. APIs that require callback code to observe the callback receiver are unsupported in v1: use an explicit receiver argument or a JavaScript shim. Symmetrically, §5.3's raw inbound function values must not require a receiver the Hexagon function type cannot express.

This is distinct from — and does not weaken — extern `method` (Part 5), where *Hexagon supplies* an explicit first subject and emission restores that subject as the JS receiver. The exclusion here is about `this` flowing *into* a Hexagon function's body, which has no slot for it.

---

## 7. Retention and capture

Callback retention by JavaScript is permitted and unbounded: foreign code may store a Hexagon function, call it later, call it repeatedly, or never call it. Nothing about crossing the boundary changes a Hexagon function's semantics — it closes over its environment per ordinary rules, and Hexagon's existing ban on capturing `var` across lambda boundaries (Statements) remains exactly as it is. **No synchronous/escaping/`@noescape`-style annotation exists or is planned**: the ban is checked at the lambda, not at the boundary, so the boundary needs no unverifiable claim about when foreign code will invoke what it holds.

---

## 8. Deferred surfaces (recorded, not designed)

Excluded from v1 and reserved for a later FFI/async deep dive; nothing here pre-commits their design:

1. **Callback arguments or results requiring `Seq`** or any other runtime boundary adapter (§5.4; Part 3 §10.3).
2. **Wrapper caching** keyed by original function plus boundary signature — unnecessary until adapting callbacks exist, and to be designed with them.
3. **Callback-visible JavaScript `this`** or receiver-aware callback types (§6).
4. **Promise-returning callbacks, async callbacks, and rejection-channel integration** — await the async specification (Part 1 §4.4).
5. **Optional, overloaded, or rest/variadic callback signatures** — deferred with their extern-declaration counterparts (Part 4 §11).
6. **Runtime identity guarantees for callbacks repeatedly crossing through different adapting signatures** — meaningless until (1)–(2) exist.

**The revisit bar** for this family: a concrete foundational JavaScript API that cannot be bound honestly with representation-direct callbacks or a small explicit shim.

---

## 9. Diagnostics checklist

| Situation | Diagnostic (rewrite named) | Owner |
|---|---|---|
| adapter-requiring type in a callback parameter or result (either direction) | the §5.4 error: names the nested type; rewrites = representation-direct type / explicit eager conversion / JS shim | §5.4 (discharges Part 3 §9.3/§11's assignment) |
| function-typed extern `let` | "extern callable declarations use `fun`; a binding of type `Int -> Int` is callable — write `fun f(x: Int): Int`" | §2.4 |
| arity mismatch at a Hexagon call of a boundary function | ordinary Functions §5 compile-time arity error, unchanged | §2.1 |
| JS caller passing too few/ill-typed arguments to an exported function or Hexagon callback | not a diagnostic — contract violation, unspecified observations (Part 1 §3.1) | §2.2–2.3 |
| throw entering through a boundary call or inbound-function invocation | not a diagnostic — branded Hexagon exception remains domestic; every other value takes the runtime `JsError` path | §4.1 |
| raw inbound function value whose implementation requires `this` | not detectable — contract violation; bind as extern `method` or use a receiver-binding JS shim | §5.3, §6 |
| API requiring callback-visible `this` | not detectable — documented unsupported; explicit receiver argument or shim | §6 |

---

## 10. Acceptance sketches

```hexagon
-- (a) Identity round trip: same function object out, registered and removed
let onEvent(e: Event): Unit = log(Event.describe(e))
addListener(target, onEvent)
removeListener(target, onEvent)          -- same JS identity; actually deregisters

-- (b) Extra JS callback arguments are harmless
-- foreign: array.forEach(cb) invokes cb(value, index, array)
extern from "helpers"
    fun each(values: Array(Int), callback: Int -> Unit): Unit
each(xs, n => total.push(n))             -- index/array ignored by representation

-- (c) Meaningful callback result preserved
extern from "helpers"
    fun filter(values: Array(Int), keep: Int -> Bool): Array(Int)

-- (d) Unit result is discarding
extern from "collections"
    type JsArray
    method push(arr: JsArray, value: Int): Unit
JsArray.push(arr, 3)                     -- JS push returns the new length; discarded

-- (e) Hexagon exception through a callback, caught back in Hexagon
try
    each(xs, n => if n < 0 then throw(Negative) else ())
catch
    Negative => ...                        -- still branded through the foreign frames
    JsError(e) => ...                      -- a throw from `each` itself lands here

-- (f) Rejected: adapter in callback position
extern from "stream-tools"
    fun visit(callback: Seq(Int) -> Unit): Unit
                                         -- ERROR (§5.4): names Seq(Int), offers the
                                         --   three rewrites; top-level Seq unaffected
```

---

## 11. Open questions — none

The decision record for this part was complete, and §12 records the review resolution of its two draft clarifications. The genuinely undecided neighboring surfaces are all §8 deferrals with named owners.

---

## 12. Review resolutions

### 12.1 The `Unit`-discarding rule (§3.2)

**Confirmed.** A declared `Unit` result on a foreign callable means the emitter discards the foreign return value; it is not a trusted assertion that the implementation returns `undefined`. The rationale is §3.2's TypeScript `void` culture, Part 5 `set` precedent, and support for deliberately ignored value-returning APIs such as `array.push`.

### 12.2 Function-typed extern `let` (§2.4)

**Confirmed.** A function-typed extern `let` is a hard error sharpening Part 4 §4.1's callable/value distinction, with the `fun` rewrite named. Part 4 §4.1/§4.2 now records the annotation-only case directly.

---

## 13. Decisions log (quick reference)

| Decision | Where |
|---|---|
| Calling convention is the identity: visible order preserved; n-ary ↔ n-ary; no currying/uncurrying, packing, or spread; pipes resolved before emission; evidence trailing (Parts 8–9) | §1 |
| Exhaustive v1 boundary-function-wrapper occasions (adapted-position export wrapper, receiver-member wrapper, constrained-export ABI wrapper when needed); each wrapper is module-level and stable, distinct from fresh per-value adapters; matching constrained ABIs export directly; no callback wrappers exist | §1, §5.1 |
| Hexagon calls boundary callables at exact declared arity (compile-checked); no padding or reordering | §2.1 |
| JS callers governed by `.d.ts` contract: extras naturally ignored (representation fact), missing/invalid = contract violation; **no runtime arity validation** | §2.2–2.3 |
| Function-typed extern `let` is a hard error → `fun` (confirmed at review) | §2.4, §12.2 |
| `Unit`: `void`/`undefined` faces; **declared `Unit` result is discarding, not trusting** (confirmed at review); exported Hexagon `Unit` genuinely returns `undefined`; nullary functions pass no unit | §3, §12.1 |
| Exceptions need no boundary mechanism: branded Hexagon exceptions remain domestic on re-entry; other inbound throws → `JsError` (virtual wrapping, two-stage discrimination); outbound Hexagon throws are branded `Error`s; no delivery promise through foreign control flow | §4 |
| V1 callbacks = representation-direct signatures only, recursive under Part 1 §5.3; same JS function object both directions; identity by representation, not caching; no weak wrapper cache | §5.1–5.2 |
| Inbound foreign function values are the raw function object as the Hexagon value, symmetric on re-crossing | §5.3 |
| Raw inbound function values assert receiver independence; a function requiring foreign `this` uses extern `method` or a JS shim | §5.3, §6 |
| Adapter-requiring callback signatures: hard error at declaration with three named rewrites; discharges Part 3 §9.3/§11; top-level `Seq` crossing unaffected | §5.4 |
| Callback `this` ignored; unobservable from Hexagon; receiver-requiring APIs → explicit argument or shim; distinct from extern `method` | §6 |
| Unbounded foreign retention permitted; `var`-capture ban unchanged; no escape annotations ever inserted at the boundary | §7 |
| Deferred: adapting callbacks, wrapper caches, callback `this`, async callbacks, optional/overload/rest callback signatures, cross-signature identity — one revisit bar (concrete foundational API) | §8 |
