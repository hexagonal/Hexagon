# Hexagon FFI Part 5: Extern Receiver Members and Classes

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing. Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §5's receiver-member and class material (`method`, `get`/`set`, `class`, static members, visibility). The draft's three promotion questions were resolved in §13: foreign inheritance remains flat in v1; Method Syntax covers extern nominal types; and class-versus-standalone choice receives cultural guidance only. Inherits Part 4's landed resolutions: foreign-name-first aliases; monomorphic v1 extern declarations (Part 4 §12.4 — extern classes included); raw identity for representation-direct plain `fun` versus wrappers where convention demands them (Part 4 §4.3); generated opaque brands for exported extern types (Part 4 §12.3); `create` as cultural guidance, never a compiler-special name.
**Scope:** `method` declarations and receiver-call emission; `get`/`set` receiver properties, the fresh-read rule, and the honest-`Unit` setter; receiver binding (mandatory explicit subject, boundary-legal receiver types); first-class references and the stable convention-preserving wrapper; `extern class` lowering to an opaque type plus companion functions; construction with `new as create`; instance and static members; class visibility; default-export classes; subclassing exclusions; interaction with method syntax (dot calls); diagnostics.
**Not in scope:** `extern from` block syntax, `fun`/`let`, `type`, `default`, `extern import` (Part 4 — consumed, not restated); `extern enum` (`ffi-foreign-enums.md`); calling convention, callbacks, and callback `this` (Part 6); export surface and exact `.d.ts` forms (Part 7); `JsValue` and checked decoding of uncertain foreign values (Part 11).
**Companions:** Part 1 §1/§4 (trusted boundary; master table); Part 4 §3–§7 (aliasing, naming, visibility, default bindings); Part 7 (stable wrappers; opaque brand emission); Method Syntax spec §1/§4 (companion dispatch, `CompanionOf`, the "companion operation" vocabulary); Modules §5.3/§6 (companion idiom, opaque-type pattern); Exceptions §6 (`JsError`).

---

## 1. Doctrine

The four core foreign member forms have one-to-one operational meanings:

```text
fun     named module export call     parse(text)
method  receiver call                params.get(key)
get     receiver property read       response.status
set     receiver property write      request.timeout = value
```

All four become **ordinary explicit Hexagon bindings with stable subject-first types**. Only their foreign linkage and emission differ. `method`, `get`, and `set` record a *foreign calling convention*, not a new Hexagon object model: Hexagon gains no `this`, no implicit receiver, no inheritance, no overriding, no prototype dispatch, and no distinct method type from anything in this part.

`method` is the right keyword by analogy with Hexagon's companion-module organization:

- a module offers functions directly — no analogy required, since Hexagon modules map closely to JavaScript modules;
- a companion module offers operations that play the role methods play on a class, with a stricter separation between data and functions and without inheritance;
- an extern `method` binds an actual JavaScript receiver call into that companion-style Hexagon surface.

**Vocabulary note.** The Method Syntax spec's diagnostic rule — say "companion operation", never "method", for dot-call machinery — is unaffected. `method` here is a declaration keyword naming a foreign convention; diagnostics about the *declaration form* may say "extern `method`", while diagnostics about dispatch continue to say "companion operation".

Everything in Part 4 §1 applies unchanged: declarations are bodyless and fully annotated; declaration-site validation is real (including Part 1 §5.3 boundary legality for every member signature) and call-site validation is not; a declaration the foreign implementation does not satisfy is a contract violation with unspecified observations (Part 1 §3.1).

---

## 2. `method`: receiver calls

### 2.1 Declaration and typing

```hexagon
extern from "url-tools"
  export type SearchParams

  export method get(
    params: SearchParams,
    key: String,
  ): Nullable(String)
```

**The first parameter is mandatory and remains the explicit Hexagon subject.** Hexagon sees the ordinary function type:

```text
(SearchParams, String) -> Nullable(String)
```

There is nothing method-typed about the binding; subject-first ordering means pipes (`params |> SearchParams.get("name")`) and dot calls (§9) work exactly as they do for any companion operation.

### 2.2 Emission

A direct call:

```hexagon
import * as SearchParams from "./search-params"

SearchParams.get(params, "name")
```

emits the receiver-sensitive JavaScript call:

```js
params.get("name")
```

The first visible argument becomes the JavaScript receiver; the remaining arguments follow in order. Hexagon itself never sees a `this`.

### 2.3 First-class references: the stable convention-preserving wrapper

An extern `method` referenced as a first-class value must materialize a wrapper that preserves the receiver convention:

```hexagon
let lookup = SearchParams.get
```

```js
const lookup = (params, key) => params.get(key);
```

**The raw detachable property function is never exposed as the Hexagon value** — detached, it would lose its receiver and silently misbehave, which is exactly the JS hazard this form exists to fence off.

The wrapper is **stable**: at most one module-level wrapper exists per receiver-member declaration, allocated once with the ESM binding (the same identity discipline as Part 7's stable export wrappers). Every first-class reference denotes that same wrapper object, so passing the reference twice — an `addListener`/`removeListener` pair, a Set of callbacks — observes one stable function identity. Direct calls need not route through the wrapper; the emitter keeps the inline receiver-call form of §2.2. Contrast Part 4 §4.3: a representation-direct plain extern `fun` retains raw imported-function identity because no convention needs preserving; receiver members always wrap.

### 2.4 Aliasing

Named method aliases follow the extern foreign-name-first rule (Part 4 §3.1):

```hexagon
method get as lookup(params: SearchParams, key: String): Nullable(String)
```

Local member names obey ordinary Hexagon naming rules (Part 4 §3.2); a foreign member name that violates them requires an alias, with the same rewrite-naming diagnostic.

---

## 3. `get`: receiver property reads

### 3.1 Declaration and the fresh-read rule

```hexagon
extern from "web-response"
  export type Response
  export type Headers

  export get status(response: Response): Int
  export get headers(response: Response): Headers
  export get redirected(response: Response): Bool
```

Hexagon calls emit property reads:

```hexagon
Response.status(response)     -- emits: response.status
Response.headers(response)    -- emits: response.headers
```

`get` means a **property-read operation**. It deliberately does not distinguish a stored data property from a JavaScript accessor getter: callers use the same syntax either way, and the foreign implementation may change between the two without altering the binding.

**Every Hexagon call performs a fresh read.** The compiler must not cache, hoist, or common-subexpression-eliminate a `get` merely because Hexagon bindings are immutable — a foreign property read may compute, vary, or throw (through the ordinary `JsError` path, Part 1 §7). An instance `get` takes exactly one parameter, the subject.

### 3.2 First-class references

A getter referenced as a first-class Hexagon function materializes the stable convention-preserving wrapper (§2.3's rules apply unchanged):

```hexagon
let readStatus = Response.status
```

```js
const readStatus = response => response.status;
```

Its ordinary Hexagon type is `Response -> Int`.

---

## 4. `set`: receiver property writes

### 4.1 Explicit write capability, honest `Unit`

A writable property requires an explicit `set` declaration; **a `get` declaration alone grants no Hexagon write capability**, even if JavaScript could technically assign the property:

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

An instance `set` takes **exactly two parameters** — the subject first, the assigned value last — and its return type **must be `Unit`**, regardless of JavaScript assignment expressions yielding the assigned value. This follows Hexagon's existing honest-`Unit` assignment doctrine.

### 4.2 The getter/setter name split

Getter and setter cannot introduce the same term name — they are two ordinary module-level bindings, and ordinary collision rules apply — so the setter uses an explicit local alias (`set timeout as setTimeout`) rather than an implicit capitalization or prefixing rule. The diagnostic for the collision names exactly that rewrite.

---

## 5. Receiver binding rules

These rules govern `method`, `get`, and `set` wherever they appear — standalone in an `extern from` block or grouped in an `extern class` block (§6):

- **The subject is explicit and first.** A missing first parameter is a targeted declaration error naming the rewrite (§11). Hexagon has no implicit receiver to supply one.
- **The receiver type must be able to cross the boundary** under Part 1's table — representation-direct or borrowed at the receiver position. A receiver type that cannot cross receives a targeted declaration error. The receiver is typically an extern `type` (or extern class type), but any boundary-legal type is admitted: `method trim(text: String): String` binding JavaScript's `"…".trim()` is a legitimate declaration.
- **Inside an `extern class` block, the instance-member subject must be the class's own declared Hexagon type.** A class groups the members of one foreign class; a member whose subject is some other type belongs at block level, and the diagnostic says so.
- Receiver members are **fixed visible arity** like every v1 extern callable (Part 4 §9), and monomorphic (Part 4 §12.4).

---

## 6. `extern class`

### 6.1 What it is and what it lowers to

`class` is valid foreign-description vocabulary inside `extern`, because a binding author working at that boundary necessarily knows the JavaScript API may contain classes. **It does not add classes to Hexagon.** An extern class lowers to an opaque foreign type plus ordinary companion functions — precisely the §2–§4 member forms, grouped under the type they serve:

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

The class header follows the foreign-name-first alias rule: `class URL as Url` declares foreign class `URL` under local type name `Url`; an unaliased `class URL` binds the type name `URL`. The declared type behaves exactly like an extern `type` (Part 4 §5): nominal, opaque, representation-direct by identity, no automatically available structure or instances; its exported `.d.ts` face is the generated opaque brand (Part 4 §12.3), with the exact form owned by Part 7.

The foreign constructor **object** is not itself a Hexagon value: only declared members reach it. (Exposing constructor objects as values sits with Part 4 §11's deferred opaque callables.)

**Cultural guidance:** use `extern class` when the foreign API is class-shaped; use an extern `type` plus standalone receiver members for interface- or handle-shaped APIs. This is teaching, not compiler surface: aside from class grouping, all-or-nothing visibility, and `new`, the two forms deliberately lower alike.

### 6.2 Construction: `new as create`

`new` is reserved for describing the JavaScript side of a foreign class constructor and normally maps explicitly to the Hexagon companion name:

```hexagon
new as create(text: String)
```

```hexagon
Url.create(text)      -- emits: new URL(text)
```

Rules:

- **`new` always carries `as localName`.** There is no foreign name to inherit (`new` is the operation, not a name), and `new` itself is not a legal Hexagon binding name; the diagnostic names the rewrite (§11).
- **The result type is implicit** — a `new` declaration constructs the class's own declared type and writes no return annotation.
- **Multiple `new` declarations are legal** with distinct local names, each declaring one way of calling the same foreign constructor at its own fixed arity: `new as create(text: String)` beside `new as createWithBase(text: String, base: String)`. Each is an independent binding under ordinary collision rules; this is not overload machinery (nothing shares a name).
- A first-class reference to a `new` binding materializes the stable convention-preserving wrapper (`text => new URL(text)`), per §2.3.

**`create` is cultural guidance, not compiler surface.** The name has no compiler semantics and is not enforced. It names the caller's perspective — the companion is a black box, the caller requests a value, the value appears — and the house rule stands:

> Use `create` for a type's primary unsurprising constructor. Use `empty`, `singleton`, `fromX`, `parse`, `compile`, `open`, or another domain-specific name when it says more.

This makes the boundary translation honest: JavaScript constructs with `new`; Hexagon callers use the companion's ordinary function. The FFI does not silently rename every constructor.

### 6.3 Static members

Static member declarations use `static method`, `static get`, and `static set`. They target properties on the imported JavaScript constructor object, and they drop the subject parameter — the constructor is the receiver, and it is fixed:

- **`static method`** declares its visible parameters only (`static method canParse(text: String): Bool`). It **retains receiver-call emission** (`URL.canParse(text)`) because a JavaScript static method may observe its constructor as `this`; a first-class reference therefore materializes the stable preserving wrapper (`text => URL.canParse(text)`), never the raw detached property function.
- **`static get`** takes exactly zero parameters; `Url.defaultPort()` performs a fresh read of `URL.defaultPort` under §3.1's no-caching rule. Its Hexagon type is `() -> Int`.
- **`static set`** takes exactly one parameter (the assigned value) and returns `Unit`, following §4.1.

### 6.4 Default-export classes

Part 4 §6's `default` modifier applies to classes:

```hexagon
extern from "database-client"
  export default class Client
    new as create(config: Config)
```

`default` selects the incoming JavaScript default export as the foreign class; everything else — the private-by-default binding, `export` producing a *named* Hexagon export, never a Hexagon or emitted-JS default export — is Part 4 §6 unchanged. A `default class` header names its local type directly (there is no foreign name), so `default class Foreign as Local` is ill-formed, mirroring Part 4's no-`as`-on-`default` rule.

---

## 7. Visibility

Deliberately simple, all-or-nothing per class:

- **`export class` exports the opaque foreign type and every member declared in its extern class block.**
- **Unprefixed `class` keeps the type and all declared members private** to the binding module.
- **JavaScript members omitted from the declaration do not exist in Hexagon**, regardless of their visibility in JavaScript. Omission is the binding author's curation tool.

This matches the existing rule that `export` exports everything a declaration introduces, and avoids a second, nested visibility system. `export` on an individual member inside a class block is a hard error whose rewrite is class-level: move the `export` to the class, or move the member to block level (standalone members carry their own `export`, Part 4 §7).

**Selective public/private members within one declared extern class are deferred.** Binding authors omit unwanted members. The recorded revisit bar: a real library that requires a *private* raw member in order to implement a public safe facade around the same exported type. (Status inherited from the decision record: provisionally accepted for v1; reopen on a concrete counterexample rather than speculative complexity.)

Exported members are re-exported from the compiled facade like any exported extern binding (Part 4 §7); since receiver members are always wrapper-backed (§2.3), **the ESM export of a receiver member is its stable wrapper** — there is no raw property function that could be exported instead.

---

## 8. Members are flat module-level bindings

An extern class block groups declarations; it does **not** create a namespace. Hexagon has no in-file submodules (Modules §2), and this part does not add one. Every member — `create`, `canParse`, `toString`, `hostname` — is an ordinary module-level binding of the binding module, exactly like a standalone extern declaration.

The `Url.member(...)` spelling in this part's examples is therefore the ordinary companion idiom: the binding module is dedicated to the class, and consumers namespace-import it under the type's name (`import * as Url from "./url"`) — Modules §6's opaque-type pattern, unchanged. **One class per binding module is the intended idiom**, not a rule.

Consequence: two extern classes declared in one module whose members share a name (`toString` on both) collide under ordinary module-level collision rules, and the fix is the ordinary one — alias one of them (`method toString as urlToString(...)`) or split the classes into their own modules. The diagnostic names both rewrites.

---

## 9. Method syntax reaches extern members

Extern receiver members were shaped subject-first precisely so they enter Hexagon as companion operations, and the Method Syntax spec's machinery is designed to need nothing new here: an extern class's (or extern type's) home module is the binding module that declares it, and its exported subject-first members are exactly a companion operation set. The intended consequence:

```hexagon
url.toString()        -- companion dispatch: Url.toString(url) — emits url.toString()
url.hostname()        -- companion dispatch: Url.hostname(url) — emits url.hostname
params.get("name")    -- companion dispatch: SearchParams.get(params, "name")
```

with zero new dispatch machinery: the dot call rewrites to the qualified companion call (Method Syntax §1), and *that* call's extern linkage does the receiver-call or property-read emission (§2.2, §3.1). Opaque extern types have no visible fields, so no field/companion collision surface exists outside pathological cases — the cleanest receivers the dot-call feature has, alongside nominal unions.

Method Syntax §4.1 and §5 include extern nominal types (`extern type` and extern class types): the companion is the **binding module** — the declaration site, which is what "home module" means for a foreign type. No other dispatch machinery changes.

Bare `url.hostname` (no argument list) remains field access by grammar (Method Syntax §2.1) and fails with the ordinary no-such-field/opacity error; the property read is spelled `url.hostname()` or `Url.hostname(url)`. This is the honest consequence of `get` entering Hexagon as a function, and it is not softened: a property-shaped bare dot would smuggle in exactly the implicit-receiver reads this part refuses.

---

## 10. Subclassing and inheritance exclusions

Fixed exclusions, restating none of JavaScript's model into Hexagon:

- **No `extends` in an extern class declaration**, and no way to state that one extern class subclasses another. Each foreign class is declared as its own flat opaque type plus members.
- **No Hexagon-side subclassing** of a foreign class, no overriding, no `super`, no `protected`, no abstract members. Hexagon cannot define a class, so it cannot extend one; APIs that require the consumer to subclass (template-method frameworks) are unsupported in v1 and need a JavaScript shim.
- **No prototype-driven dispatch and no `instanceof` surface.** Runtime classification of an uncertain foreign value is Part 11's checked-decoding territory, not an extern-class feature.
- **Foreign inheritance is flattened by the binding author's declarations.** A member available on `Dog` via its `Animal` prototype may simply be declared as a `Dog` member (`method speak(dog: Dog): Unit`) — the trusted boundary asserts the call works, and JavaScript dispatch makes it work. What v1 does *not* provide is any typed relationship between two declared extern types (see §13.1).

---

## 11. Diagnostics checklist

Hard errors with named rewrites per the Rewrite Rule:

| Situation | Diagnostic (rewrite named) | Owner |
|---|---|---|
| `method`/`get`/`set` (instance form) with no subject parameter | "an extern `method` takes its receiver as an explicit first parameter; write `method get(params: SearchParams, key: String): ...`" | §5 |
| receiver type that cannot cross the boundary | targeted declaration error naming the type and Part 1's category rules | §5 |
| class instance member whose subject is not the class's type | "instance members of `class URL as Url` take `Url` as their first parameter; declare this member at block level if it targets another type" | §5 |
| instance `get` with extra parameters | "a property read takes no arguments beyond its subject; for a receiver call, use `method`" | §3.1 |
| instance `set` without exactly (subject, value) parameters | "an extern `set` takes the subject and the assigned value: `set timeout as setTimeout(request: Request, value: Int): Unit`" | §4.1 |
| `static get` with any parameters | "a static property read takes no parameters; write `static get defaultPort(): Int`" | §6.3 |
| `static set` without exactly one value parameter | "a static property write takes exactly the assigned value; write `static set defaultPort(value: Int): Unit`" | §6.3 |
| `set` return type other than `Unit` | "an extern `set` returns `Unit`" (honest-`Unit` doctrine) | §4.1 |
| getter and setter introducing the same term name | ordinary collision error + "alias the setter: `set timeout as setTimeout(...)`" | §4.2 |
| `new` without `as` | "name the companion constructor: `new as create(text: String)`" | §6.2 |
| return annotation on `new` | "`new` constructs `Url`; remove the annotation" | §6.2 |
| `fun`/`let`/`type` inside a class block | "extern class members are `new`, `method`, `get`, `set`, and their `static` forms; declare this at block level" | §6.1 |
| `export` on an individual class member | "`export class` exports every declared member; export the class, or declare the member at block level" | §7 |
| `extends` (or any subclass relation) in an extern class | "Hexagon does not model foreign inheritance; declare the subclass as its own `extern class`" | §10 |
| `as` on a `default class` header | Part 4 §6's rule: no foreign name exists; name the type directly | §6.4 |
| member-name collision across classes in one module | ordinary collision error + both rewrites: alias one member, or split the classes into their own binding modules | §8 |
| type parameters on an extern class or member | Part 4 §12.4's hard error — generic extern declarations deferred | Part 4 |

---

## 12. Deferred surfaces (recorded, not designed)

1. **Selective per-member visibility** within one extern class (§7; revisit bar recorded there).
2. **Subclassing-dependent APIs** — frameworks requiring consumer-defined subclasses; a JavaScript shim is the v1 answer (§10).
3. **Symbol-keyed and computed members** — not representable by named member declarations; grouped with Part 4 §11's arbitrary-string export names.
4. **Constructor objects as values** — with Part 4 §11's opaque callables.
5. **Generic extern classes** — deferred as part of Part 4 §12.4's family.
6. **Index/parameterized accessors** beyond property `get`/`set` (JS index signatures, getter-with-arguments patterns) — a receiver call (`method`) binds most such APIs honestly (`params.get(key)` *is* the canonical example); anything genuinely property-indexed waits for demand.

---

## 13. Review resolutions

The draft's three open questions were resolved at promotion; none remains blocking.

### 13.1 Typed relationships across a foreign inheritance hierarchy

If a binding declares both `Animal` and `Dog` as extern types/classes, Hexagon sees two unrelated nominal types: a `Dog` value cannot be passed where `Animal` is declared, even though JavaScript substitutability makes it valid at runtime. §10's flattening answer (declare inherited members directly on `Dog`; declare each function against the type actually used) covers the common cases but duplicates declarations and cannot express "this foreign function accepts any `Animal`" for a caller holding a `Dog`.

**Resolution:** v1 ships with flattening only. Any future fix is an explicit, trusted, zero-cost upcast declaration in the extern vocabulary (something in the spirit of a declared `Dog -> Animal` coercion function), never type-system subtyping. Revisit on a concrete foundational library whose binding becomes unreasonable under flattening.

### 13.2 Method-syntax coverage of extern types

**Resolution:** confirmed as §9 states. `CompanionOf` extends to extern nominal types with the binding module as home module. Method Syntax §4.1/§5 now records that coverage; its dispatch machinery is otherwise unchanged.

### 13.3 Same-module standalone members versus class grouping

A binding author can declare the same foreign API either as an extern `type` plus standalone `method`/`get`/`set` declarations (§2–§4, the `SearchParams` shape) or as an `extern class` (§6, the `URL` shape). The two lower identically; the class form differs only in grouping, all-or-nothing visibility, and `new`.

**Resolution:** §6.1 carries one cultural sentence: prefer `class` for class-shaped foreign APIs and `type` plus standalone members for interface- or handle-shaped APIs. There is no compiler rule.

---

## 14. Decisions log (quick reference)

| Decision | Where |
|---|---|
| Four member forms with one-to-one operational meanings (`fun`/`method`/`get`/`set`); all become ordinary subject-first Hexagon bindings; no new object model — no `this`, inheritance, prototype dispatch, or method types | §1 |
| `method`: mandatory explicit first-parameter subject; ordinary function type; emits receiver call; keyword justified by the companion-module analogy | §1, §2.1–2.2 |
| First-class receiver-member references: **stable convention-preserving wrapper** — one module-level wrapper per declaration, allocated once, same identity for every reference; raw detachable property function never exposed; direct calls emit inline | §2.3 |
| Member aliases foreign-name-first; local member names obey ordinary naming rules (Part 4 §3 inherited) | §2.4 |
| `get` = property-read operation; deliberately blind to data-property-vs-accessor; **fresh read every call — no caching/hoisting/CSE**; may compute, vary, or throw (`JsError`) | §3.1 |
| `set` required for write capability (`get` grants none); exactly (subject, value); returns `Unit` (honest-`Unit` doctrine); getter/setter share no name — setter aliases (`set timeout as setTimeout`) | §4 |
| Receiver rules uniform standalone or in-class: explicit first subject; receiver must be boundary-legal (any crossable type, incl. primitives); class instance members' subject = the class's type; fixed arity; monomorphic | §5 |
| `extern class` = opaque foreign type + companion functions; adds no classes to Hexagon; class header aliases foreign-name-first; constructor object not a value; exported type faces as generated opaque brand (Part 7 owns form) | §6.1 |
| `new as create(...)`: `as` mandatory (no foreign name; `new` not bindable); result type implicit; multiple `new` declarations legal under distinct names; first-class reference wraps; `create` cultural with the house naming rule | §6.2 |
| Static members: `static method`/`static get`/`static set` target the constructor object; subject parameter dropped; static method keeps receiver-call emission + preserving wrapper (constructor may be its `this`); static get nullary fresh read; static set unary returning `Unit` | §6.3 |
| `default class` per Part 4 §6; no `as` on the header | §6.4 |
| Visibility all-or-nothing per class: `export class` exports type + every declared member; unprefixed = all private; omitted JS members don't exist; per-member `export` hard error; selective visibility deferred with the private-raw-member/public-facade revisit bar; exported receiver members export their stable wrappers | §7 |
| Members are flat module-level bindings — no namespace, no in-file submodule; one-class-per-binding-module is idiom, not rule; cross-class name collisions are ordinary collisions with named rewrites | §8 |
| Dot calls reach extern members via ordinary companion dispatch; Method Syntax's coverage table includes extern nominal types; bare `e.name` stays field access, so property reads are spelled `url.hostname()` | §9, §13.2 |
| Exclusions: no `extends`, no Hexagon subclassing/overriding/`super`/`protected`/abstract, no `instanceof` surface (Part 11 owns uncertain-value classification); foreign inheritance is flattened in v1; any future upcast is explicit and trusted, never subtyping | §10, §13.1 |
| Prefer `extern class` for class-shaped APIs and extern `type` plus standalone members for interface- or handle-shaped APIs; cultural guidance only | §6.1, §13.3 |
| Symbol-keyed members, constructor objects, subclass-dependent APIs, selective visibility, generics deferred | §12 |
