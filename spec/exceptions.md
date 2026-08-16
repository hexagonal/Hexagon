# Hexagon Spec: Exceptions

**Status:** Decided (July 2026); re-based onto the effects discipline (#480) — the cut is now stated here, not merely inferable from Effects §1, and `Result.attempt`'s arrows link; `finally` resolved to never (#481); boundary guards added (#478, §7.6); the brand carries the declaring module (#488, §7.1); the match catch expression added (#500, §5.4). With a **hanging-questions** section (§10; §10.1 since resolved); nothing there blocks implementation of §1–§9.
**Scope:** The `exception` declaration (an open extensible sum of error constructors), the `Exn` type, `throw`, the `try`/`catch` expression, the match catch expression (`match … catch`, §5.4), foreign (JS-originated) throwables and the `JsError` door, the tagged-`Error`-plus-brand runtime representation, prelude additions (`JsError`, `Result.attempt`), emission and `.d.ts` shapes.
**Not in scope:** `finally` (resolved: never — §10.1), the full pattern grammar (pattern-matching spec — catch arms use the same flat constructor patterns as `match`, Unions §4.2), the `JsValue` type and its decoding surface (FFI Part 11; this doc consumes its two conservative `JsError` accessors), module-level qualification of exception constructor names (modules spec), async/promise-rejection interactions (FFI/async spec, if any).
**Companions:** Unions spec (constructor grammar reused wholesale; the closed/open contrast is this doc's reason to exist), Functions spec (arity, constructors-as-terms, value restriction), Lexer & Layout spec (`try`/`catch` bodies are layout blocks), Constraints spec (no derived instances for `Exn`, §7), Effects spec (§1 owns the cut this doc's §1 restates; §2.2's linked arrows are `Result.attempt`'s, §8.2).

Written for a future implementation session against the existing `hexc` architecture: Algorithm J, union-find tyvars, level-based generalisation, constraints as dictionaries, layout pass, readable-JS emission with `.d.ts`.

---

## 1. Doctrine

- **Predictable failure is data; unpredictable failure is exceptions.** When a failure mode can be anticipated at a call site, return `Result` or a custom `union` — that is what closed sums and exact exhaustiveness are for. `exception` exists for the failures that *cannot* be enumerated in advance. This division is the spec's first sentence on purpose: exceptions are the pressure valve that lets `union` stay closed. There will be no open unions in Hexagon's data; there is exactly one open sum in the language, and it is `Exn`.
- **Throwing is not an effect.** The effect discipline tracks observable interaction with the world (Effects §1), and exceptions stand deliberately outside it — the partiality/defect channel beside the data channel, not a third colour. `throw` carries the pure constant arrow (§3), a `->` function may throw *and may catch*, and `Int.div` stays pure-and-partial: without this cut, the throwing-companion doctrine would mark the whole prelude impure, and silence — the strongest claim — would die of noise. Two alternatives were weighed and rejected; recorded so they are not re-litigated without new information. **Exceptions as a tracked effect** (the Koka direction) is structurally excluded: the lattice has two points and a signature has one variable, so "throws but world-pure" has no spelling — and would need one everywhere, because the prelude throws. **Throw-pure/catch-impure** (Haskell's cut) is rejected with its price named. Imprecise exceptions make the *observed* exception depend on evaluation order — which is what buys an optimizer the freedom to reorder pure code without regard to what it throws, a freedom laziness left Haskell unable to decline. Hexagon takes the other side: catching stays legal in pure code (the OCaml/F# position), exception identity is therefore observable in pure code, and the Effects §7 reordering licence is bounded by that observability — a conforming compiler may not reorder or fuse pure computations where doing so changes which exception is thrown, or whether one is. JS's fully specified evaluation order means the emitter meets the bound by doing nothing; it is recorded so a future optimizer does not spend a licence that was never that wide.
- **SML semantics, JS spelling.** The design is Standard ML's `exception` — an extensible sum whose constructors are declared independently, whose values are first-class, with a non-exhaustive handler that implicitly re-raises. The surface vocabulary is what every Hexagon user already knows: `try`/`catch` syntax and the ordinary `throw` function (not `raise`/`handle`).
- **`Exn` is a real type, and its values are ordinary values.** An exception can be constructed, bound, stored in a record, passed to a function, and thrown later. Construction and throwing are separate acts (as in SML, and as in JS's `new Error` vs `throw`).
- **`catch` is a `match` that cannot be exhaustive.** Because the sum is open, "missing cases" is meaningless; the rule inverts. Where `match` demands exhaustiveness (Unions §4.3), `catch` provides an implicit *anything-unmatched propagates*. No error, no warning, no mandatory `_` arm. This does not weaken the exhaustiveness doctrine — that payoff was always about data; control-flow escape is a different contract. The two constructs also compose — a `match` may take a `catch` clause (§5.4) — with each section keeping its own law.
- **The entire foreign world enters through exactly one door: `JsError`** (§6). Every Hexagon-originated exception is a declared constructor; everything else JS can throw is a `JsError`. One door is a doctrine.
- **Representation: a branded plain `Error`, no classes** (§7). Hexagon emits no `class`, ever — unions are tagged POJOs; exceptions are tagged `Error` objects with a brand field. Same shape of idea: `tag` answers "which constructor" for data, `name` answers it for exceptions, `$hex` answers "whose exception" — and answers it fully *(#488)*: its value is the **declaring module's path identity** (§7.1), so one field says both whose language (a string there: Hexagon's — string-typedness is the language test, §7.4) and whose declaration (which module's). A closed sum's constructor names are scoped by its type and `match` is type-directed, so `tag` needs no qualifier; the open sum lost that protection when every `exception` in the program joined one type, so its discriminant carries the uniqueness the type system no longer can — runtime identity is the (module, name) pair, exactly the checker's own.

---

## 2. The `exception` declaration

```
exception NotFound
exception ParseError(line: Int, message: String)
exception Timeout(millis: Int)
```

- **Grammar: exactly a union constructor, freestanding.** The payload is the constructor-payload form from Unions §2.1, inherited wholesale: parenthesised parameter-list-like slots; **per exception, all slots named or all unnamed** (all-or-none); nullary written bare (`exception NotFound`, never `NotFound()`); uppercase-start constructor name; non-uppercase-start slot names; duplicate slot names an error.
- Each declaration adds one constructor to the single open type **`Exn`**. There is no declaration of `Exn` itself; it is a prelude type constant, and `exception` declarations extend its constructor set. Two in-scope exceptions with the same name: error at the point of ambiguity; two in one module: hard error at the second declaration — the constructor-collision rule family (Unions §2), unchanged.
- **Module-level only.** An `exception` declaration inside a function or block is a parse error. SML's generative local exceptions (a fresh exception per evaluation of the declaration) are deliberately declined — they exist to fake dynamic binding, and nothing in Hexagon's design wants them. (Diagnostic: "exceptions are declared at module level.")
- **No type parameters, no type variables in payloads.** `exception Wrapped(value: a)` is a hard error: an open sum has no parameterised declaration site the way `Option(a)` does — the `a` has nowhere to be quantified — and SML bans top-level polymorphic exceptions for the same soundness reason. Payload slot types must be closed. (Diagnostic: "exception payloads must have concrete types.")
- **Reserved slot names: `name`, `stack`, and any identifier beginning with `$`.** These belong to the representation (§7): `name` is the discriminant, `stack` is the JS-captured trace, `$`-initial names are representation-internal (the brand lives at `$hex`). Declaring a slot with a reserved name is a hard error: "`name` is reserved as the exception's discriminant field; rename this field." (This replaces, for exceptions, the union spec's `tag` reservation — `tag` itself is *not* reserved here.)
- **`message` is the blessed slot** (style rule + representation hook): a slot named `message` must be of type `String`, and its value feeds the underlying JS `Error`'s own message (§7), so uncaught output reads `ParseError: unexpected token`. Not required; strongly encouraged for every exported exception. Declaring `message` at a non-String type is a hard error (the representation hook demands a string).

### 2.1 Constructors as terms

Exactly the union rules (Unions §2.2), restated for closure:

- A payload exception is a function: `ParseError : (line: Int, message: String) -> Exn`. Ordinary n-ary rules: parens required, arity checked, no partial application, no tuple splatting. First-class: `map(lines, l => ParseError(l, "bad"))` is legal.
- A nullary exception is a **value** of type `Exn`, used bare: `NotFound`. `NotFound()` gets the standard "`NotFound` is a value, not a function; write it without `()`" hint. *(But note §7.3: unlike union nullaries, a nullary exception is not a shared constant — each mention constructs fresh, to capture a stack.)*
- Slot names are representation/documentation only; construction and catch patterns are positional, always (Unions §2.1 doctrine unchanged).
- Value restriction: a constructor application of syntactic values is a syntactic value (Functions §8.2). Nothing generalises here anyway — every exception has type `Exn`, no variables in sight.

---

## 3. Typing

- **`Exn` is an opaque prelude type constant.** It unifies with itself and nothing else. No structural anything; no user code can name its "constructor set" because it doesn't have a closed one.
- `throw : Exn -> a` — a prelude function (not a keyword-with-special-grammar; ordinary call syntax `throw(e)`). It never returns, so its result type is a fresh variable that unifies with any expected type — the standard typing of divergence. `if broken then throw(NotFound) else 5` types as `Int`. Its arrow is the pure constant `->`, deliberately (§1): a throw neither colours the enclosing body nor wears a call mark — `throw(NotFound)` is a bare call, legal in a `->` body.
- **`Exn` is not `Result`'s friend by subtyping or coercion** — there is no implicit relationship. The explicit bridge is `Result.attempt` (§8.2).
- `match` on an `Exn` scrutinee is **not permitted** — a permanent exclusion (Pattern Matching §6.1): an open sum can never satisfy `match`'s exhaustiveness contract. Diagnostic: "match requires a closed type; exceptions are inspected with `try`/`catch`." The only eliminator for `Exn` is a `catch` block — `try`'s (§5.1) or a match's clause (§5.4), where the exception is never the scrutinee. (Consequently there is also no dot access, no predicates — the Unions §5 doctrine transfers whole.)

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
- **`catch` is mandatory** — a bare `try` block is a parse error ("`try` requires a `catch`"). There is no `finally` — in v1 or ever (§10.1).
- **`try`/`catch` is an expression**: the try-body's type and every arm body's type unify to one result type. The scrutinee position is implicit (the in-flight exception); arms are evaluated against it top to bottom.

### 5.2 Patterns

Catch arms use **the full pattern grammar, owned by Pattern Matching §6.2** — nesting, literals, or-patterns, `as`, guards — one grammar and one arm form (`pattern [when g] => body`) for `match` and `catch` uniformly. The flat-constructor restrictions this section once carried are discharged (Pattern Matching §14.3, applied). The shared diagnostics transfer unchanged (pattern arity, bare payload constructor hint, `Point()`-style parens hint, duplicate binders).

The one addition: **`JsError(e)`** is a legal arm — a prelude exception (§6) matched like any other, binding the raw foreign throwable. Or-patterns mixing domestic and foreign arms are legal: `ParseError(_) | JsError(_) => fallback` (Pattern Matching §6.2).

### 5.3 Semantics: implicit rethrow, exact reachability

- Arms are tried in order; the first matching arm's body is the expression's value.
- **An unmatched exception propagates automatically** — the implicit rethrow. This is the SML `handle` semantics and the whole point of §1's inverted rule: no exhaustiveness demand, no required `_`.
- A `_` (or bare-variable) arm catches **everything** — Hexagon exceptions and foreign throwables alike (§6 makes this true, not merely claimed).
- **Reachability is still checked and still a hard error** (Unions §4.3 transfers): a constructor arm already covered above, or any arm after `_`/bare-variable, or a constructor arm after a `JsError` arm *only if* — no: `JsError` covers only the foreign branch, so domestic arms after it are fine; but a second `JsError` arm, or anything after `_`, is unreachable. Over the full grammar the logic is Pattern Matching §7.2's — or-patterns folded in, guarded arms unable to subsume — and it remains exact; do not approximate.
- **Guards** (Pattern Matching §3) run against the caught exception after the arm's pattern matches, outside any protection: a guard that throws propagates outward, exactly like a body — the emission gets this for free, guards running inside the JS catch block (§7.4). A failed guard falls through to the next arm; no arm left means the implicit rethrow, as always.
- The try-body is evaluated once; exceptions thrown *inside a catch arm's body* are not caught by the same `catch` (they propagate outward) — standard, but stated because JS's `try`/`catch` behaves identically and the emission (§7.4) gets it for free.
- **Colours: nothing here owns an effect rule.** The try-body and every arm body are ordinary expression positions — their call marks join into the enclosing body's colour exactly as any other subexpression's do, and a `?` call inside either conducts the enclosing signature's variable as usual (Effects §3.1). Catching never launders an effect, and throwing never creates one (§1).

### 5.4 The match catch expression *(#500)*

`catch` has a second seat: a `match` may take a `catch` clause.

```
match parse(input)
    Ok(ast) => compile(ast)
    Err(reason) => report(reason)
catch
    ParseError(line, _) => recoverAt(line)
```

The motivating shape is OCaml's exception arms (`match … with … | exception P -> …`), adopted with the arms regrouped: where OCaml interleaves exception arms among the data arms, Hexagon separates the sections, because the two kinds of arm match differently — data arms partition a closed domain under the exhaustiveness demand, catch arms probe the one open sum under the implicit rethrow — and arms answering to different laws get different blocks. The regrouping loses nothing: a scrutinee evaluation either returns a value or throws, so the two sections never compete for the same evaluation, and interleaving could never express an ordering that matters.

- **Syntax.** The `catch` clause sits at the `match` head's own column, after the arm block, and is in every respect §5.1's `catch`: a layout block of arms in the full catch grammar (§5.2; Pattern Matching §6.2), `JsError(e)` included, one arm per VSEP/`;`, no braced form. The clause is optional — `match` without `catch` is unchanged — and attaches by column to the nearest construct at its indentation (Lexer & Layout §2): a `catch` aligned with a `try` is the try's, even when the try-body is a match; a `catch` aligned with a `match` head is the match's.
- **A match function takes no clause at all** (Pattern Matching §6.7): a scrutinee-less `match` is a function literal whose scrutinee is its parameter — a value already produced, under other handlers, before the function is entered, so there is nothing for a clause to observe (its desugar is the cannot-throw class by construction). The seat's diagnostic gives the `try` rewrite (§9).
- **The clause attaches only to a `match` head that begins its logical item.** A mid-line head — `let x = match e`, an arm body `=> match next(source)`, `try match e`, argument position — cannot take a catch clause: no line can sit at such a head's column (a line that deep continues the preceding arm), and a `catch` at the enclosing item's column belongs to the enclosing construct — which either owns it (`try`) or refuses it with the alignment diagnostic (§9). The rewrap is one indent: move the `match` onto its own line as the binding's block RHS (every term binding opens a block, Lexer & Layout §2.1). Chosen conservatively, and deliberately so: attaching an enclosing-column `catch` to an item's *trailing* match would be a compatible future liberalization; the reverse would be a break.
- **Semantics: the window covers the scrutinee's evaluation, and nothing else.** The scrutinee is evaluated once. If it returns a value, the data arms proceed as an ordinary `match`, and the catch arms are dead for that evaluation — they do not guard the data arms' guards or bodies. If it throws, the catch arms are tried top to bottom with §5.3 in force whole: the first matching arm's body is the expression's value; an unmatched exception propagates (implicit rethrow); an exception thrown inside a catch arm's guard or body propagates outward. This is `try`'s protection applied to the scrutinee alone — precisely what the composition `try (match …) catch` cannot say, since that form wraps the arms too.
- **Typing.** Every body — data arm and catch arm alike — unifies to the one result type. The scrutinee types against the data arms exactly as without the clause (Pattern Matching §6.1); in particular the `Exn`-scrutinee ban (§3) is untouched — a catch clause does not make `match` an eliminator for `Exn`.
- **Exhaustiveness is untouched in both directions.** The data arms alone must be exhaustive over the scrutinee's type — the clause discharges nothing, because a thrown exception is not a case of that type. The catch arms carry no exhaustiveness demand — the sum is open; §1's inverted rule. Two shapes are thereby impossible rather than banned: a `match` of only catch arms cannot be written (`match e` followed directly by `catch` is a parse error at the clause, §9: "`match` requires at least one arm; to handle only exceptions, use `try`/`catch`"), and an or-pattern can never span the sections (its alternatives live in one arm, and each arm lives in one block).
- **Reachability is per-section and unchanged** — Pattern Matching §7.2 for the data arms, §5.3's exact set logic for the catch arms — **plus one new judgment: a scrutinee whose evaluation provably cannot throw makes the entire clause unreachable.** Hard error, like every unreachable arm: "this `catch` can never run: evaluating ⟨scrutinee⟩ cannot throw" (⟨scrutinee⟩ substitutes the source text — always a single token, by the class below). The judgment runs where reachability already runs — after elaboration — and the class is exact and deliberately minimal. It fires only when the elaborated scrutinee is (i) a **bare variable read** — a plain reference, not an evidence application: a generalized literal binding's use re-runs its `Num` elaboration, which may be user code — or (ii) a **literal whose elaboration erases to a primitive construction** (the Numeric Literals §5 codegen guarantee; a String literal with no interpolation holes qualifies, and so does the Unit literal `()` — the arity-0 tuple evaluates nothing; a non-empty tuple, vector, or record literal never does — their sub-expressions run arbitrary code). Nothing wider: throwing is not an effect (§1), so no colour analysis exists to prove throw-freedom through calls — and purity would not prove it anyway, since a `->` function may throw. In particular, a user `Num` instance's `fromNat` is pure yet may throw, and its totality is a documented law, not a checked property; where user elaboration is in play, the judgment declines rather than lean on the law.
- **Colours: nothing new.** The bullet above transfers: the scrutinee and every body join into the enclosing colour as ordinary expression positions.

Emission is §7.4's discrimination with the `try` narrowed to the scrutinee — see the note there.

---

## 6. Foreign throwables: `JsError`

Hexagon code compiled to JS will have JS exceptions pass through it — a `TypeError` from an extern call, a `RangeError` from `JSON.parse`, a bare `throw "oops"` from a badly-behaved library (JS permits throwing any value). The survey of precedent (ReScript's `Js.Exn.Error`, Scala.js's `js.JavaScriptException`, Fable/Kotlin-JS's hierarchy mapping, PureScript's everything-is-the-JS-error) all converges on: foreign throwables must be catchable through the same construct. Hexagon agrees — the number-one job a JS developer will hire `try`/`catch` for is wrapping a throwing JS API, and the design must serve it.

### 6.1 The prelude exception

```
exception JsError(error: JsValue)
```

- `JsValue` is the representation-direct opaque type for any JavaScript value, facing TypeScript as `unknown` (FFI Part 11). No attempt is made to type an arbitrary thrown value structurally, because JS permits throwing anything, including `null` and strings. FFI Part 11 §7 specifies the total conservative accessors `JsError.message : JsValue -> String` and `JsError.stack : JsValue -> Option(String)`; guarded property failures are suppressed into `""` / `None`.
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
  $hex: "Parser",           // the brand: "this is a Hexagon exception" — and whose (the declaring module)
  name: "ParseError",       // the discriminant (JS consoles print name: message)
  line: 3                   // payload slots, flat, under their declared names
})
```

- **The brand is `$hex: "<declaring module>"`** *(#488; supersedes `$hex: true`)* — a plain own-property, chosen over a `Symbol` key deliberately: it is honest data, survives structured-clone/realms/workers/bundler-duplication (all the places prototype identity breaks), and `$hex` is not a legal Hexagon identifier, so it can never collide with a user slot (§2's `$` reservation makes this airtight). The value is the declaring module's identity — and a module's identity in Hexagon **is its path** (Modules §2: a file is a module, naming is the importer's act, the information is the path): the project-root-relative path, forward slashes, `.hex` dropped — the compiler's own module identity, rendered without the leading slash and extension. Unique by construction — one module per path — with no new naming rule and no importer-alias dependence. A root-level `Parser.hex` brands `"Parser"` (this document's running example); `client/errors.hex` brands `"client/errors"`, so its `Boom` and `server/errors.hex`'s `Boom` stay distinct; an injected stdlib module brands its canonical injected name (`"Seq"`, `"Vector"`, `"Map"`). Two modules each declaring `exception Boom` therefore produce distinguishable representations, and a catch arm binds only the constructor it names — without the module in the brand, `B.Boom(tag)` catches `A`'s `Boom` with `tag` bound `undefined`, an accident needing no adversary. If a package story ever arrives, the value widens to the package-qualified path — a continuation, not a redesign.
- **`name` is the discriminant** — doing for exceptions exactly what `tag` does for unions, with the bonus that `name` is the field JS consoles and error reporters already print: uncaught output reads `ParseError: bad` plus a stack, indistinguishable from a well-written JS library's error.
- The `message` slot, if declared, feeds `new Error(message)` (§2); an exception without a `message` slot constructs `new Error()` with an empty message.
- Unnamed slots emit as `item1 … itemN` fields, the products vocabulary (Unions §6.1), flat beside the brand.
- **Rejected: one `HexagonError` class, or a class per exception** (the F#/Fable shape) — considered at length and declined. Classes reintroduce `instanceof` and prototype identity, which breaks across bundler duplicates and realms — a known ecosystem wart the branded-POJO-over-`Error` design simply doesn't have — and would put `class` declarations in emitted output that is otherwise class-free. The reconciliation paragraph that design needed is the tell; this design needs none. Do not re-litigate without new information.
- **Rejected: bare tagged POJOs (no `Error`)** — an uncaught `{tag: "NotFound"}` surfaces as `[object Object]` with no stack: a catastrophic debugging experience and a readable-JS violation in spirit. The `Error` base is non-negotiable.
- Spoofing residue, recorded honestly: a JS library *deliberately* throwing `{$hex: "Parser", name: "ParseError", ...}` impersonates a Hexagon exception. The brand moves the failure mode from "breaks by accident" (any library setting `err.name`, which is conventional) to "breaks only on purpose," which is where every tagged representation in the language already lives — nothing stops JS handing Hexagon a fake `{tag: "Some"}` either. One widening under #488, recorded: stage 1 is now a **class** test (any string `$hex`), not a sentinel match, so a foreign throwable carrying a coincidental string `$hex` routes to the domestic branch — bypassing `JsError` arms and rethrown unless `_` catches — and `isHexError` answers true for it. Same tier in kind: `$hex` is nobody's conventional property (unlike `name`), so the coincidence still requires an object that had no business carrying it.

### 7.2 Construction sites

The emitter provides one tiny module-level helper (shape at its discretion, e.g. `const $mkExn = (name, message, fields) => Object.assign(new Error(message), {$hex: "Parser", name}, fields);` — per-module, so the helper bakes in its own module's name, #488) so construction sites stay readable: `$mkExn("ParseError", "bad", {line: 3})`. Direct `Object.assign` inline is equally acceptable for the emitter where it reads better; the representation, not the helper, is the contract.

### 7.3 Nullary exceptions construct fresh

Unlike union nullaries (shared module-level constants, Unions §6.1), **a nullary exception constructs a fresh object at each mention**: `NotFound` emits `$mkExn("NotFound", "", {})` at the use site. Reason: the stack trace is captured at construction (§4), and a stack pointing at the declaration site is worthless. The union spec's allocation-free trick is deliberately not applied; exceptions are cold paths and a construction per throw is the correct trade.

### 7.4 Emitting `catch`: two-stage discrimination

Brand first, then name — this is the structure that makes the semantics of §5.3 and §6 true:

```js
try {
  ...
} catch (err) {
  if (err != null && typeof err.$hex === "string") {          // stage 1: domestic?
    if (err.$hex === "Parser" && err.name === "ParseError") { // stage 2: which one — (module, name)
      const line = err.line;
      ...
    } else if (err.$hex === "Parser" && err.name === "NotFound") {
      ...
    } else throw err;                              // unmatched Hexagon exn: implicit rethrow
  } else {                                         // foreign branch
    const e = err;                                 // the JsError(e) arm, if present
    ...                                            // no JsError/_ arm: throw err;
  }
}
```

- The `err != null` guard is load-bearing: JS code can `throw null` / `throw "oops"`, and those must flow to the foreign branch rather than crash the discriminator.
- Verify against the three failure modes this structure exists to kill: a Hexagon `NotFound` reaching a `JsError`-only catch is branded → domestic branch → no name match → rethrown (`JsError` never swallows domestic exceptions); a foreign `new Error` with `name === "ParseError"` is unbranded → foreign branch (no impersonation-by-coincidence); and module `A`'s `Boom` reaching an arm written `B.Boom(tag)` is branded `"A"`, not `"B"` → no match → rethrown *(#488 — no cross-module capture, no `undefined` payloads)*.
- Where every arm's constructor is declared by one module — the common case — the emitter may hoist the owner comparison (`err.$hex === "Parser" && (err.name === "ParseError" ? … : err.name === "NotFound" ? … : …)`); the observable rule is the (module, name) pair per arm, not the shape of the chain.
- A `_`/bare-variable arm emits as the catch-all in **both** branches (or equivalently, a hoisted structure — emitter's choice; the observable rule is that `_` truly catches everything, foreign included).
- Name discrimination may use `if`/`else` chains or — within a hoisted owner group, where the `$hex` comparison has already run (#488) — `switch (err.name)`; catch blocks are cold by definition, so the emitter should prefer whichever reads better.
- `try`/`catch`-as-expression uses the same strategy ladder as `match` (Unions §6.3): statement lifting into `return`/`const`-assignment positions first, IIFE for genuinely inline positions.
- Payload binders emit as `const` bindings from the declared field names (patterns positional in source, representation named), with the same inline-single-use license as Unions §6.3.
- **The match catch expression (§5.4) narrows the `try` to the scrutinee.** Lower as: bind the scrutinee inside the `try` (`let $t; try { $t = <scrutinee>; } catch (err) { … }`), run this section's discrimination in the JS `catch` — a matched arm produces the expression's result and control skips the data arms; unmatched, `throw err;` — then lower the data arms on `$t` outside the `try`, per Unions §6.3. The join (a `return` in statement-lifted return positions; a labeled `break` or the IIFE rung otherwise) follows the same strategy ladder; the shapes above are illustrative. The observable contract is §5.4's window: the emitted `try` wraps the scrutinee's evaluation and nothing else — no data-arm test, guard, or body, and no catch-arm guard or body, may sit inside it.

### 7.5 `.d.ts`

An exported exception appears as the intersection type that states the §7.1 representation honestly — which is also exactly the shape a hand-written branded error's declaration takes (an outcome, post-#147, not the ground):

```ts
type ParseError = Error & { readonly $hex: "Parser"; readonly name: "ParseError"; readonly line: number };
```

- **The brand is included, deliberately**: JS-side code constructing Hexagon exceptions to throw into Hexagon does it correctly or not at all.
- Exported exceptions ship constructor functions for JavaScript callers (FFI Part 7 §6). Payload constructors follow declared slot order. Nullary exceptions are also function-shaped for JavaScript and construct a fresh branded `Error` on every call, preserving call-site stack capture; they are never exported as shared constants.
- `Exn` itself, where it appears in exported signatures (e.g. `Result.attempt`'s error side), is `Error` in the `.d.ts` — honest about the foreign door: any caught value is presented as an `Error`-typed thing at the boundary. (Foreign non-`Error` throwables make this a white lie of the same size every TS `catch` clause tells; recorded, accepted.)
- **The throws manifest** *(#479)*: an exported declaration documents each declared exception it may throw with the recognized sentence ``Throws `X` when <condition>.`` (Doc Comments §6.1 — `Throws`, the language's own verb), and emission surfaces each as a generated `@throws` tag in the JSDoc block (Doc Comments §7.4; FFI Part 7 §6). Documentation, not typing; nothing is checked (§10.4's linting posture).

### 7.6 Boundary guards: `.is` and `isHexError` *(#478)*

The discrimination a JS consumer must write — §7.4's two-stage test, read from the outside — is manufactured for them at emission, in two shapes:

- **Every exported exception constructor carries a guard property `is`.** `ParseError.is(err)` is the domestic test at this identity — `err != null && err.$hex === "Parser" && err.name === "ParseError"` (#488's (module, name) pair) — and its declaration types it as a TypeScript predicate, `(err: unknown) => err is ParseError`, so a consumer's branch narrows to §7.5's intersection face. The property seat is deliberately collision-free: no Hexagon surface can occupy a property of an exception constructor — a nullary's dotted spelling is ruled out by §3, and a payload constructor's resolves as Modules §5.1's module namespace, never as a property — so no name is spent and no collision rule is needed. Nullary exceptions carry the same property on their function-shaped export (FFI Part 7 §6).
- **A module that exports at least one exception also exports `isHexError`** — stage 1 alone, `err != null && typeof err.$hex === "string"`, typed `(err: unknown) => err is Error & { readonly $hex: string; readonly name: string }`. It answers the domestic-or-foreign question every consuming `catch` asks first; the foreign branch is its negation.
- **`isHexError` is a face, not a hygiene name** (Lexer §3.2 keeps generated public spellings outside the `__` prefix), so it is spelled plainly — and, being a fixed generated public name, a collision with an explicit export of the same module is the Part 8 §6.2 family's hard error: both sites named, the fix a source rename, never a silent one.
- **Guards certify the brand, not the payload.** They witness construction by §7.1's representation contract, nothing structural; §7.1's spoofing paragraph transfers unchanged — a guard moves the consumer's check from hand-written to correct, not from honest to safe.
- **`JsError` ships no guard.** Its wrapping is virtual (§6.2): outside §6.2's exotic first-class residue, what a JS consumer receives from Hexagon is never a branded `"JsError"` — it is the original foreign throwable — so a `JsError.is` would match only that residue and mislead everywhere else. The foreign branch is `!isHexError(err)`.
- **Nothing here exists on the Hexagon side of the boundary.** `.is` and `isHexError` are emission artifacts like the constructor functions themselves (FFI Part 7 §6 owns their `.d.ts` faces); Hexagon source can neither name nor need them — the domestic eliminator is `catch` (§3).

---

## 8. Prelude additions

### 8.1 `JsError`

Per §6.1. Declared in the prelude; FFI Part 11 finalizes its `JsValue` payload and the total conservative `message`/`stack` accessors.

### 8.2 `Result.attempt`

```
Result.attempt : (() ->? a) ->? Result(a, Exn)
```

Runs the thunk; `Ok(value)` on normal return, `Err(exn)` on any throw — Hexagon or foreign (foreign arrives as the `JsError`-branch value, i.e. `Err(JsError(e))` observationally). This is the bridge from the exception world back to the data world, expected to be the single most-used exception function in practice; it is ordinary Hexagon (a `try`/`catch` with a `_` arm) and may be written in the stdlib, not compiler magic. The inverse direction is `throw` composed on `match`/`Err` and needs no dedicated function.

The arrows are linked (Effects §2.2): the thunk's `->?` is the signature's inlet, and `attempt` is a conduit — its body is a `?` call on the thunk under a catch-all — so running `attempt` is exactly as effectful as the thunk it is handed. Instantiated pure, the whole call is pure and bare; instantiated impure, it wears `!`. A pure-only face would refuse exactly the boundary-wrapping calls this function exists for.

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
| `NotFound()` construction or pattern | "`NotFound` is a value, not a function; write it without `()`" (Unions §2.2) |
| Constructor/pattern arity mismatch | standard arity errors + `Circle(_)`-style hints (Unions §4.2 family) |
| Duplicate exception name (module / in-scope) | constructor-collision rule family (§2) |
| Bare `try` without `catch` | "`try` requires a `catch`" (§5.1) |
| `finally` | "Hexagon has no `finally`; resources are scoped with `use`" (§10.1) |
| Braced `try { ... }` / `catch { ... }` | records-not-blocks diagnostic (Lexer & Layout §5) |
| Unreachable catch arm (covered constructor, arm after `_`, second `JsError`) | hard error, naming the shadowing arm (§5.3) |
| `match` on an `Exn` scrutinee | "match requires a closed type; exceptions are inspected with `try`/`catch`" (§3; Pattern Matching §6.1) |
| Dot access on an `Exn` value | "exceptions are inspected with `try`/`catch`" (§3) |
| `catch` clause on a cannot-throw scrutinee (bare variable read / primitive-erased literal, §5.4's class) | hard error: "this `catch` can never run: evaluating ⟨scrutinee⟩ cannot throw" (§5.4) |
| `match e` followed directly by `catch` (no data arms) | parse error: "`match` requires at least one arm; to handle only exceptions, use `try`/`catch`" (§5.4) |
| `catch` indented as a match arm | parse error + fixit: "align `catch` with `match` to attach a catch clause" (§5.4) |
| `catch` at an enclosing item's column, or aligned with a mid-line `match` head's item | alignment error + fixit: "a `catch` clause must align with a `match` that begins its line — align the `catch` with the `match`'s column; if the `match` head is mid-line, move it onto its own line" (§5.4); when the trailing `match` is scrutinee-less, report the match-function diagnostic (row below) directly instead |
| `catch` on a match function (scrutinee-less `match`, Pattern Matching §6.7) | "a match function's parameter is already a value; there is nothing here for `catch` to observe — to guard the arm bodies, write a lambda whose body is `try match x …` with `catch` aligned to the `try`" (§5.4) |

---

## 10. Hanging questions (recorded; §10.1 since resolved)

1. **`finally`. Resolved: never.** `finally` is an accident of language-history sequencing: `unwind-protect` patched the non-local exits exceptions created, and the patch fossilized into surface syntax (Modula-3, then Java, then C# and JS) before the dominant use case — paired acquire/release — got its own construct. The counterfactual has been run: C++ and Ada had the resource construct first and never grew `finally`; the languages that shipped `finally` and later confronted the resource case added the paired construct and demoted it (Python's `with`, Java's try-with-resources, TC39's `using`; C#'s `using` was sugar over try/finally from the start); and the greenfield designs that revisited the question chose the paired construct instead (`defer` in Go, Swift, and Zig; `Drop` in Rust). The primitive must exist somewhere, but not as surface syntax: a future `use` lowers to emitted JS `try`/`finally`, so the emitter holds unwind-protect for free and the surface never needs the keyword. In an expression language `finally` is statement-shaped — it contributes no value — and every question the deferral recorded (may it throw? does it overwrite the in-flight exception? what does it do to `try`'s typing?) dissolves unasked. The keyword stays reserved permanently, purely to power the diagnostic (§9); the v2 resource story (`use`, a scoped binding in the F# style) files its own issue when that arc opens, and nothing here pre-decides its shape beyond the diagnostic's forward reference. Do not re-litigate without new information.
2. **Async.** JS promise rejections are exceptions in a trench coat; if Hexagon grows async/await or a Task type, the rejection channel presumably carries `Exn` with the same brand discipline. Nothing here precludes it; flagged so the async design remembers.
3. **`Show<Exn>` / constraints on `Exn`.** Presumption: `Exn` has **no** derived or prelude instances in v1 — not `Show` (what would it show, given foreign values?), not `Eq` (identity vs structural on error objects is a swamp). Interpolating an `Exn` is therefore a compile error; users show `JsError.message(e)` or their own formatting. Presumed here, confirm in the stdlib listing.
4. **Warning on over-broad catches?** A lint flagging `_`-arms that swallow everything (the classic error-hiding bug) was floated informally. Linting policy is out of scope for specs so far; parked.

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
| `throw : Exn -> a`, prelude function, divergence typing; stack captured at construction | §3, §4 |
| `catch` mandatory; `finally` deferred with reserved keyword | §5.1, §10.1 |
| Catch arms = flat constructor patterns (shared grammar with `match`); implicit rethrow; reachability still hard-errors; no exhaustiveness demand | §5.2–5.3 |
| `match`/dot-access on `Exn`: never | §3 |
| Foreign throwables catchable via prelude `JsError(error: JsValue)`; no decoding; classification is userland | §6 |
| `JsError.message`/`stack` are total conservative Part 11 accessors; objects/functions receive one guarded fresh property read, secondary throws fall back to `""`/`None` | §6.1; FFI Part 11 §7 |
| `JsError` wrapping is virtual: catch-arm binds raw value; `throw(JsError(e))` unwraps syntactically | §6.2 |
| Representation: plain `Error` + `$hex: true` brand + `name` discriminant + flat payload; no classes, no `instanceof`, no prototypes | §7.1 |
| Class-based designs and bare-POJO design rejected, reasons recorded | §7.1 |
| Nullary exceptions construct fresh (stack capture); union shared-constant trick not applied | §7.3 |
| Two-stage catch discrimination (brand, then name); `err != null` guard; `_` catches truly everything | §7.4 |
| `.d.ts`: `Error & {$hex: true; name: "..."; ...}`; brand included; exported constructor functions (nullary included, fresh per call); `Exn` at the boundary is `Error` | §7.5; FFI Part 7 §6 |
| Prelude: `JsError`, `Result.attempt : (() ->? a) ->? Result(a, Exn)` (stdlib, not magic) | §8 |
| Throwing is not an effect — the cut restated from this side; `throw` is `->` pure; `try`/`catch` colours by ordinary join; exceptions-as-tracked-effect and throw-pure/catch-impure both rejected, reasons recorded; catch-in-pure bounds the Effects §7 reordering licence (observable throws pin order) | §1, §3, §5.3 |
| `Result.attempt`'s arrows link — the thunk's `->?` is the inlet, `attempt` a conduit | §8.2 |
| `finally`: resolved to never (supersedes the deferral row above) — keyword reserved permanently, purely for the diagnostic; resources are the v2 `use` story | §5.1, §9, §10.1 |
| Boundary guards (#478): `.is` on every exported exception constructor (TS predicate to the §7.5 face); `isHexError` per exception-exporting module (stage-1 test); fixed generated face, collision = Part 8 §6.2-family hard error; `JsError` excluded (virtual wrapping); guards certify the brand only; nothing exists Hexagon-side | §7.6 |
| #488: the brand carries the declaring module — `$hex: "<module>"`, superseding `true` in the two rows above — runtime identity is the (module, name) pair, the checker's own; stage 1 = string check (a class test, spoofing note widened accordingly); two same-named exceptions in two modules stay distinct, no cross-module capture; the value is the module's path identity (root-relative, unique by construction — no new naming rule), injected modules use their canonical names, a future package story widens the value | §1, §7.1, §7.2, §7.4–§7.6 |
| #500: the match catch expression — a `match` may take a `catch` clause; sectioned, never per-arm markers (data arms and catch arms answer to different laws, so they get different blocks; OCaml's interleaved `exception` arms and a per-arm `catch` marker considered and declined — do not re-litigate without new information); window = the scrutinee's evaluation only; full catch grammar in the clause; exhaustiveness untouched both directions; per-section reachability plus the cannot-throw judgment (post-elaboration, erasure-gated, minimal — never leaning on the unchecked `Num` totality law); clause attachment by column, line-initial `match` heads only (mid-line attachment reserved as a compatible future liberalization) | §5.4, §7.4, §9 |
| Catch-arm grammar discharge (Pattern Matching §14.3, applied on the #500 touch): §5.2 repoints to Pattern Matching §6.2 — full grammar in catch arms, superseding the flat-pattern rows above; §5.3 gains the or-pattern/guard notes; the deferred-to-pattern-spec diagnostics row retired | §5.2, §5.3, §9 |
| #505: the match function takes no `catch` clause, on principle — its scrutinee is its parameter, already a value; nothing to observe (the desugar is the cannot-throw class by construction); dedicated diagnostic with the `try` rewrite | §5.4, §9; Pattern Matching §6.7 |
| Four hanging questions recorded | §10 |
| §7.5's `.d.ts` phrasing re-grounded post-#147 (2026-07-29): the intersection face is the honest statement of §7.1's representation; TS-author phrasing demoted to outcome; face unchanged | §7.5 |
