# Hexagon Spec: Exceptions

**Status:** Decided (July 2026) — with a **hanging-questions** section (§10); nothing there blocks implementation of §1–§9.
**Scope:** The `exception` declaration (an open extensible sum of error constructors), the `Exn` type, `throw`, the `try`/`catch` expression, foreign (JS-originated) throwables and the `JsError` door, the tagged-`Error`-plus-brand runtime representation, prelude additions (`JsError`, `Result.attempt`), emission and `.d.ts` shapes.
**Not in scope:** `finally` (deferred, §10.1), the full pattern grammar (pattern-matching spec — catch arms use the same flat constructor patterns as `match`, Unions §4.2), the `JsValue` opaque foreign type and its accessors (FFI spec; this doc names the needs), module-level qualification of exception constructor names (modules spec), async/promise-rejection interactions (FFI/async spec, if any).
**Companions:** Unions spec (constructor grammar reused wholesale; the closed/open contrast is this doc's reason to exist), Functions spec (arity, constructors-as-terms, value restriction), Lexer & Layout spec (`try`/`catch` bodies are layout blocks), Constraints spec (no derived instances for `Exn`, §7).

Written for a future implementation session against the existing `hexc` architecture: Algorithm J, union-find tyvars, level-based generalisation, constraints as dictionaries, layout pass, readable-JS emission with `.d.ts`.

---

## 1. Doctrine

- **Predictable failure is data; unpredictable failure is exceptions.** When a failure mode can be anticipated at a call site, return `Result` or a custom `union` — that is what closed sums and exact exhaustiveness are for. `exception` exists for the failures that *cannot* be enumerated in advance. This division is the spec's first sentence on purpose: exceptions are the pressure valve that lets `union` stay closed. There will be no open unions in Hexagon's data; there is exactly one open sum in the language, and it is `Exn`.
- **SML semantics, JS spelling.** The design is Standard ML's `exception` — an extensible sum whose constructors are declared independently, whose values are first-class, with a non-exhaustive handler that implicitly re-raises. The surface keywords are the ones every Hexagon user already knows: `throw`, `try`, `catch` (not `raise`/`handle`).
- **`Exn` is a real type, and its values are ordinary values.** An exception can be constructed, bound, stored in a record, passed to a function, and thrown later. Construction and throwing are separate acts (as in SML, and as in JS's `new Error` vs `throw`).
- **`catch` is a `match` that cannot be exhaustive.** Because the sum is open, "missing cases" is meaningless; the rule inverts. Where `match` demands exhaustiveness (Unions §4.3), `catch` provides an implicit *anything-unmatched propagates*. No error, no warning, no mandatory `_` arm. This does not weaken the exhaustiveness doctrine — that payoff was always about data; control-flow escape is a different contract.
- **The entire foreign world enters through exactly one door: `JsError`** (§6). Every Hexagon-originated exception is a declared constructor; everything else JS can throw is a `JsError`. One door is a doctrine.
- **Representation: a branded plain `Error`, no classes** (§7). Hexagon emits no `class`, ever — unions are tagged POJOs; exceptions are tagged `Error` objects with a brand field. Same shape of idea: `tag` answers "which constructor" for data, `name` answers it for exceptions, `$hex` answers "whose exception."

---

## 2. The `exception` declaration

```
exception NotFound
exception ParseError(line: Int, message: String)
exception Timeout(millis: Int)
```

- **Grammar: exactly a union constructor, freestanding.** The payload is the constructor-payload form from Unions §2.1, inherited wholesale: parenthesised parameter-list-like slots; **per exception, all slots named or all unnamed** (all-or-none); nullary written bare (`exception NotFound`, never `NotFound()`); uppercase-initial constructor name; lowercase-initial slot names; duplicate slot names an error.
- Each declaration adds one constructor to the single open type **`Exn`**. There is no declaration of `Exn` itself; it is a prelude type constant, and `exception` declarations extend its constructor set. Two in-scope exceptions with the same name: error at the point of ambiguity; two in one module: hard error at the second declaration — the constructor-collision rule family (Unions §2), unchanged.
- **Module-level only.** An `exception` declaration inside a function or block is a parse error. SML's generative local exceptions (a fresh exception per evaluation of the declaration) are deliberately declined — they exist to fake dynamic binding, and nothing in Hexagon's design wants them. (Diagnostic: "exceptions are declared at module level.")
- **No type parameters, no type variables in payloads.** `exception Wrapped(value: a)` is a hard error: an open sum has no parameterised declaration site the way `Option(a)` does — the `a` has nowhere to be quantified — and SML bans top-level polymorphic exceptions for the same soundness reason. Payload slot types must be closed. (Diagnostic: "exception payloads must have concrete types.")
- **Reserved slot names: `name`, `stack`, and any identifier beginning with `$`.** These belong to the representation (§7): `name` is the discriminant, `stack` is the JS-captured trace, `$`-initial names are representation-internal (the brand lives at `$hex`). Declaring a slot with a reserved name is a hard error: "`name` is reserved as the exception's discriminant field; rename this field." (This replaces, for exceptions, the union spec's `tag` reservation — `tag` itself is *not* reserved here.)
- **`message` is the blessed slot** (style rule + representation hook): a slot named `message` must be of type `String`, and its value feeds the underlying JS `Error`'s own message (§7), so uncaught output reads `ParseError: unexpected token`. Not required; strongly encouraged for every exported exception. Declaring `message` at a non-String type is a hard error (the representation hook demands a string).

### 2.1 Constructors as terms

Exactly the union rules (Unions §2.2), restated for closure:

- A payload exception is a function: `ParseError : (line: Int, message: String) -> Exn`. Ordinary n-ary rules: parens required, arity checked, no partial application, no tuple splatting. First-class: `map(lines, l => ParseError(l, "bad"))` is legal.
- A nullary exception is a **value** of type `Exn`, used bare: `NotFound`. `NotFound()` gets the standard "`NotFound` is a value; write it without `()`" hint. *(But note §7.3: unlike union nullaries, a nullary exception is not a shared constant — each mention constructs fresh, to capture a stack.)*
- Slot names are representation/documentation only; construction and catch patterns are positional, always (Unions §2.1 doctrine unchanged).
- Value restriction: a constructor application of syntactic values is a syntactic value (Functions §8.2). Nothing generalises here anyway — every exception has type `Exn`, no variables in sight.

---

## 3. Typing

- **`Exn` is an opaque prelude type constant.** It unifies with itself and nothing else. No structural anything; no user code can name its "constructor set" because it doesn't have a closed one.
- `throw : (Exn) -> a` — a prelude function (not a keyword-with-special-grammar; ordinary call syntax `throw(e)`). It never returns, so its result type is a fresh variable that unifies with any expected type — the standard typing of divergence. `if broken then throw(NotFound) else 5` types as `Int`.
- **`Exn` is not `Result`'s friend by subtyping or coercion** — there is no implicit relationship. The explicit bridge is `Result.attempt` (§8.2).
- `match` on an `Exn` scrutinee is **not permitted** — "match requires a union type in v1" (Unions §4.2) already excludes it, and it stays excluded permanently: an open sum can never satisfy `match`'s exhaustiveness contract. The only eliminator for `Exn` is a `catch` block. (Consequently there is also no dot access, no predicates — the Unions §5 doctrine transfers whole.)

---

## 4. `throw`

```
throw(ParseError(3, "unexpected token"))
throw(err)                    -- err : Exn, constructed earlier
```

- Ordinary function application; the argument is any `Exn`-typed expression.
- **Stack traces are captured at construction, not at throw** — inherited directly from JS (`new Error` captures; `throw` doesn't), and specced as such rather than fought. The common adjacent case `throw(ParseError(...))` is therefore perfect; the construct-now-throw-later pattern carries the construction site's stack, documented with one line in the stdlib docs.
- Emission: `throw(e)` emits `throw e;` — except the `JsError` unwrapping rule, §6.2.

---

## 5. `try` / `catch`

### 5.1 Syntax

```
try
  parse(input)
catch
  ParseError(line, _) => defaultFor(line)
  NotFound => fallback
  JsError(e) => log(e); fallback
```

- **`try` takes a body** — same line or an indented layout block, final expression is its value (identical to lambda bodies, Functions §3.1). **`catch` takes a layout block of arms**, one per VSEP/`;`, each `pattern => body` — syntactically the same arm form as `match` (Unions §4.1), parsed in the same arm context, with the same `=>` token. Braced forms do not exist; a `{` after `try` or `catch` gets the standard records-not-blocks diagnostic (Lexer & Layout §5).
- **`catch` is mandatory** — a bare `try` block is a parse error ("`try` requires a `catch`"). There is no `finally` in v1 (deferred, §10.1).
- **`try`/`catch` is an expression**: the try-body's type and every arm body's type unify to one result type. The scrutinee position is implicit (the in-flight exception); arms are evaluated against it top to bottom.

### 5.2 Patterns

Catch arms use **exactly the v1 flat constructor patterns of Unions §4.2** — positional binders, `_` slots, bare `_`/bare-variable whole-value arms, no nesting, no literals, no guards; the pattern-matching spec owns the superset grammar for both `match` and `catch` uniformly. All the same diagnostics transfer (pattern arity, bare payload constructor hint, `Point()`-style parens hint, uppercase-in-slot = nested pattern error, duplicate binders).

The one addition: **`JsError(e)`** is a legal arm — a prelude exception (§6) matched like any other, binding the raw foreign throwable.

### 5.3 Semantics: implicit rethrow, exact reachability

- Arms are tried in order; the first matching arm's body is the expression's value.
- **An unmatched exception propagates automatically** — the implicit rethrow. This is the SML `handle` semantics and the whole point of §1's inverted rule: no exhaustiveness demand, no required `_`.
- A `_` (or bare-variable) arm catches **everything** — Hexagon exceptions and foreign throwables alike (§6 makes this true, not merely claimed).
- **Reachability is still checked and still a hard error** (Unions §4.3 transfers): a constructor arm already covered above, or any arm after `_`/bare-variable, or a constructor arm after a `JsError` arm *only if* — no: `JsError` covers only the foreign branch, so domestic arms after it are fine; but a second `JsError` arm, or anything after `_`, is unreachable. With flat patterns this remains exact set logic; do not approximate.
- The try-body is evaluated once; exceptions thrown *inside a catch arm's body* are not caught by the same `catch` (they propagate outward) — standard, but stated because JS's `try`/`catch` behaves identically and the emission (§7.4) gets it for free.

---

## 6. Foreign throwables: `JsError`

Hexagon code compiled to JS will have JS exceptions pass through it — a `TypeError` from an extern call, a `RangeError` from `JSON.parse`, a bare `throw "oops"` from a badly-behaved library (JS permits throwing any value). The survey of precedent (ReScript's `Js.Exn.Error`, Scala.js's `js.JavaScriptException`, Fable/Kotlin-JS's hierarchy mapping, PureScript's everything-is-the-JS-error) all converges on: foreign throwables must be catchable through the same construct. Hexagon agrees — the number-one job a JS developer will hire `try`/`catch` for is wrapping a throwing JS API, and the design must serve it.

### 6.1 The prelude exception

```
exception JsError(error: JsValue)
```

- `JsValue` is an opaque extern type (name and accessors owed to the FFI spec — at minimum `JsError.message : (JsValue) -> String`, `JsError.stack : (JsValue) -> Option(String)`; flagged there). No attempt is made to type an arbitrary thrown value structurally, because JS permits throwing anything, including `null` and strings.
- **No decoding.** A JS `RangeError` is a `JsError` whose payload you interrogate via accessors; it does not become a structured Hexagon exception. Classification of foreign errors is userland. This keeps the FFI honest — no typing the untypeable.

### 6.2 The wrapping is virtual

`JsError` is special-cased in emission (and only there — its typing and surface behaviour are ordinary):

- **In a catch arm**, `JsError(e)` allocates nothing: it is the foreign branch of the two-stage discrimination (§7.4), and `e` binds the raw thrown value directly. Implicit rethrow of an unmatched foreign error rethrows *the original object* — stack intact, no wrapper burying it.
- **`throw` applied directly to a `JsError` construction unwraps**: `throw(JsError(e))` emits `throw e;`. This makes the rethrow-after-inspection idiom (`JsError(e) => if recoverable(e) then ... else throw(JsError(e))`) preserve the original error's identity and stack. 
- **As a first-class value** (constructed, not immediately thrown/matched): `JsError(v)` materialises an ordinary branded exception object carrying the payload (§7), like any other constructor. Throwing *that* value later throws the branded wrapper — the unwrapping rule is syntactic (throw-of-construction), not dynamic. Acceptable residue: the dominant idioms (catch, rethrow-in-arm) are zero-cost and identity-preserving; the exotic one is merely ordinary.

---

## 7. Runtime representation & emission

### 7.1 The representation: `Error` + brand

Every Hexagon-constructed exception is a **plain JS `Error` object** — real stack trace, sane uncaught console output — extended with a brand and its payload fields. **No classes.** Construction of `ParseError(3, "bad")` emits (modulo a shared helper, §7.2):

```js
Object.assign(new Error("bad"), {
  $hex: true,               // the brand: "this is a Hexagon exception"
  name: "ParseError",       // the discriminant (JS consoles print name: message)
  line: 3                   // payload slots, flat, under their declared names
})
```

- **The brand is `$hex: true`** — a plain own-property, chosen over a `Symbol` key deliberately: it is honest data, survives structured-clone/realms/workers/bundler-duplication (all the places prototype identity breaks), and `$hex` is not a legal Hexagon identifier, so it can never collide with a user slot (§2's `$` reservation makes this airtight).
- **`name` is the discriminant** — doing for exceptions exactly what `tag` does for unions, with the bonus that `name` is the field JS consoles and error reporters already print: uncaught output reads `ParseError: bad` plus a stack, indistinguishable from a well-written JS library's error.
- The `message` slot, if declared, feeds `new Error(message)` (§2); an exception without a `message` slot constructs `new Error()` with an empty message.
- Unnamed slots emit as `item1 … itemN` fields, the products vocabulary (Unions §6.1), flat beside the brand.
- **Rejected: one `HexagonError` class, or a class per exception** (the F#/Fable shape) — considered at length and declined. Classes reintroduce `instanceof` and prototype identity, which breaks across bundler duplicates and realms — a known ecosystem wart the branded-POJO-over-`Error` design simply doesn't have — and would put `class` declarations in emitted output that is otherwise class-free. The reconciliation paragraph that design needed is the tell; this design needs none. Do not re-litigate without new information.
- **Rejected: bare tagged POJOs (no `Error`)** — an uncaught `{tag: "NotFound"}` surfaces as `[object Object]` with no stack: a catastrophic debugging experience and a readable-JS violation in spirit. The `Error` base is non-negotiable.
- Spoofing residue, recorded honestly: a JS library *deliberately* throwing `{$hex: true, name: "ParseError", ...}` impersonates a Hexagon exception. The brand moves the failure mode from "breaks by accident" (any library setting `err.name`, which is conventional) to "breaks only on purpose," which is where every tagged representation in the language already lives — nothing stops JS handing Hexagon a fake `{tag: "Some"}` either.

### 7.2 Construction sites

The emitter provides one tiny module-level helper (shape at its discretion, e.g. `const $mkExn = (name, message, fields) => Object.assign(new Error(message), {$hex: true, name}, fields);`) so construction sites stay readable: `$mkExn("ParseError", "bad", {line: 3})`. Direct `Object.assign` inline is equally acceptable for the emitter where it reads better; the representation, not the helper, is the contract.

### 7.3 Nullary exceptions construct fresh

Unlike union nullaries (shared module-level constants, Unions §6.1), **a nullary exception constructs a fresh object at each mention**: `NotFound` emits `$mkExn("NotFound", "", {})` at the use site. Reason: the stack trace is captured at construction (§4), and a stack pointing at the declaration site is worthless. The union spec's allocation-free trick is deliberately not applied; exceptions are cold paths and a construction per throw is the correct trade.

### 7.4 Emitting `catch`: two-stage discrimination

Brand first, then name — this is the structure that makes the semantics of §5.3 and §6 true:

```js
try {
  ...
} catch (err) {
  if (err != null && err.$hex === true) {          // stage 1: domestic?
    if (err.name === "ParseError") {               // stage 2: which one
      const line = err.line;
      ...
    } else if (err.name === "NotFound") {
      ...
    } else throw err;                              // unmatched Hexagon exn: implicit rethrow
  } else {                                         // foreign branch
    const e = err;                                 // the JsError(e) arm, if present
    ...                                            // no JsError/_ arm: throw err;
  }
}
```

- The `err != null` guard is load-bearing: JS code can `throw null` / `throw "oops"`, and those must flow to the foreign branch rather than crash the discriminator.
- Verify against the two failure modes this structure exists to kill: a Hexagon `NotFound` reaching a `JsError`-only catch is branded → domestic branch → no name match → rethrown (`JsError` never swallows domestic exceptions); a foreign `new Error` with `name === "ParseError"` is unbranded → foreign branch (no impersonation-by-coincidence).
- A `_`/bare-variable arm emits as the catch-all in **both** branches (or equivalently, a hoisted structure — emitter's choice; the observable rule is that `_` truly catches everything, foreign included).
- Name discrimination may use `if`/`else` chains or `switch (err.name)`; catch blocks are cold by definition, so the emitter should prefer whichever reads better.
- `try`/`catch`-as-expression uses the same strategy ladder as `match` (Unions §6.3): statement lifting into `return`/`const`-assignment positions first, IIFE for genuinely inline positions.
- Payload binders emit as `const` bindings from the declared field names (patterns positional in source, representation named), with the same inline-single-use license as Unions §6.3.

### 7.5 `.d.ts`

An exported exception appears as the intersection type a TS author would write for a branded error:

```ts
type ParseError = Error & { $hex: true; name: "ParseError"; line: number };
```

- **The brand is included, deliberately**: JS-side code constructing Hexagon exceptions to throw into Hexagon does it correctly or not at all.
- Whether exception *constructor functions* are exported for JS callers is the FFI/modules export question (same flag as Unions §6.5); representation-wise nothing blocks it.
- `Exn` itself, where it appears in exported signatures (e.g. `Result.attempt`'s error side), is `Error` in the `.d.ts` — honest about the foreign door: any caught value is presented as an `Error`-typed thing at the boundary. (Foreign non-`Error` throwables make this a white lie of the same size every TS `catch` clause tells; recorded, accepted.)

---

## 8. Prelude additions

### 8.1 `JsError`

Per §6.1. Declared in the prelude; its `JsValue` payload type and accessors are the FFI spec's to finish.

### 8.2 `Result.attempt`

```
Result.attempt : (() -> a) -> Result(a, Exn)
```

Runs the thunk; `Ok(value)` on normal return, `Err(exn)` on any throw — Hexagon or foreign (foreign arrives as the `JsError`-branch value, i.e. `Err(JsError(e))` observationally). This is the bridge from the exception world back to the data world, expected to be the single most-used exception function in practice; it is ordinary Hexagon (a `try`/`catch` with a `_` arm) and may be written in the stdlib, not compiler magic. The inverse direction is `throw` composed on `match`/`Err` and needs no dedicated function.

*(Naming note: subject-first convention doesn't bite — the thunk is the only argument.)*

---

## 9. Diagnostics checklist

| Situation | Error / hint |
|---|---|
| `exception` inside a function/block | "exceptions are declared at module level" (§2) |
| Type variable in a payload slot | "exception payloads must have concrete types" (§2) |
| Slot named `name`/`stack`/`$...` | reserved-name error, rename hint (§2) |
| `message` slot at non-String type | hard error: `message` must be `String` (§2) |
| Mixed named/unnamed slots | parse error, all-or-none (Unions §2.1) |
| `NotFound()` construction or pattern | "`NotFound` is a value; write it without `()`" (Unions §2.2) |
| Constructor/pattern arity mismatch | standard arity errors + `Circle(_)`-style hints (Unions §4.2 family) |
| Duplicate exception name (module / in-scope) | constructor-collision rule family (§2) |
| Bare `try` without `catch` | "`try` requires a `catch`" (§5.1) |
| `finally` | "`finally` is not part of Hexagon v1" (§10.1) |
| Braced `try { ... }` / `catch { ... }` | records-not-blocks diagnostic (Lexer & Layout §5) |
| Unreachable catch arm (covered constructor, arm after `_`, second `JsError`) | hard error, naming the shadowing arm (§5.3) |
| `match` on an `Exn` scrutinee | "match requires a union type; exceptions are inspected with `try`/`catch`" (§3) |
| Dot access on an `Exn` value | "exceptions are inspected with `try`/`catch`" (§3) |
| Nested pattern / literal / guard in a catch arm | deferred-to-pattern-spec messages (Unions §4.2 family) |

---

## 10. Hanging questions (recorded, not decided)

1. **`finally`.** Deferred from v1 by agreement. It is a resource-management feature and drags real questions (may `finally` throw? does it overwrite the in-flight exception? interaction with the expression-typing of `try`?) that deserve their own session, probably alongside whatever resource/effect story the FFI develops. The keyword should be reserved by the parser now (targeted diagnostic above) so adding it later is non-breaking.
2. **`JsValue` and its accessors.** Owed to the FFI spec: the opaque type's name (bikeshed: `JsValue` vs `Foreign`), the accessor set (`message`, `stack`, coercions), and whether `JsError.error`'s payload participates in any `Nullable(T)` story.
3. **Async.** JS promise rejections are exceptions in a trench coat; if Hexagon grows async/await or a Task type, the rejection channel presumably carries `Exn` with the same brand discipline. Nothing here precludes it; flagged so the async design remembers.
4. **`Show<Exn>` / constraints on `Exn`.** Presumption: `Exn` has **no** derived or prelude instances in v1 — not `Show` (what would it show, given foreign values?), not `Eq` (identity vs structural on error objects is a swamp). Interpolating an `Exn` is therefore a compile error; users show `JsError.message(e)` or their own formatting. Presumed here, confirm in the stdlib listing.
5. **Warning on over-broad catches?** A lint flagging `_`-arms that swallow everything (the classic error-hiding bug) was floated informally. Linting policy is out of scope for specs so far; parked.

---

## 11. Decisions log

| Decision | Where |
|---|---|
| Exceptions = the one open sum, for unpredictable failure; `Result`/unions for predictable | §1 |
| SML semantics; `throw`/`try`/`catch` spelling | §1 |
| `Exn` values first-class; construction ≠ throwing | §1, §2.1 |
| `exception` = freestanding union-constructor grammar; all-or-none slots; module-level only; no local/generative exceptions | §2 |
| No polymorphic exceptions (concrete payload types only) | §2 |
| Reserved slots: `name`, `stack`, `$...`; `message` blessed and String-typed, feeds `Error` message | §2 |
| `throw : (Exn) -> a`, prelude function, divergence typing; stack captured at construction | §3, §4 |
| `catch` mandatory; `finally` deferred with reserved keyword | §5.1, §10.1 |
| Catch arms = flat constructor patterns (shared grammar with `match`); implicit rethrow; reachability still hard-errors; no exhaustiveness demand | §5.2–5.3 |
| `match`/dot-access on `Exn`: never | §3 |
| Foreign throwables catchable via prelude `JsError(error: JsValue)`; no decoding; classification is userland | §6 |
| `JsError` wrapping is virtual: catch-arm binds raw value; `throw(JsError(e))` unwraps syntactically | §6.2 |
| Representation: plain `Error` + `$hex: true` brand + `name` discriminant + flat payload; no classes, no `instanceof`, no prototypes | §7.1 |
| Class-based designs and bare-POJO design rejected, reasons recorded | §7.1 |
| Nullary exceptions construct fresh (stack capture); union shared-constant trick not applied | §7.3 |
| Two-stage catch discrimination (brand, then name); `err != null` guard; `_` catches truly everything | §7.4 |
| `.d.ts`: `Error & {$hex: true; name: "..."; ...}`; brand included; `Exn` at the boundary is `Error` | §7.5 |
| Prelude: `JsError`, `Result.attempt : (() -> a) -> Result(a, Exn)` (stdlib, not magic) | §8 |
| Five hanging questions recorded | §10 |
