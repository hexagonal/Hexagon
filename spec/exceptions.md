# Hexagon Spec: Exceptions

**Status:** Decided. Three kinds of throw: exceptions, tracked by Effects' fail colour; faults, untracked; foreign throws, tracked as the row they come through claims. With a **hanging-questions** section (§10; §10.1 since resolved); nothing there blocks implementation of §1–§9.
**Scope:** The `exception` and `fault` declarations (constructors of one open sum), the `Exn` type, `throw` and how its kind is read, the `try`/`catch` expression, the match catch expression (`match … catch`, §5.4), the `fault` pattern, the body forms `attempt` and `assume`, foreign (JS-originated) throwables and the `JsError` door, the tagged-`Error`-plus-brand runtime representation, prelude additions (`JsError`, `AssumptionFault`), emission and `.d.ts` shapes.
**Not in scope:** The fail colour itself: what a call may throw is tracked, marked and handled by Effects' rules (§1, §3.1, §3.6), which this doc's forms read. `finally` (resolved: never — §10.1), the full pattern grammar (Pattern Matching §6.2), the `JsValue` type and its decoding surface (FFI Part 11; this doc consumes its two conservative `JsError` accessors), module-level qualification of constructor names (Modules), async/promise-rejection interactions (FFI/async spec, if any).
**Companions:** Effects (§1 the two colours and the three kinds; §3.1 the reading `?`; §3.6 where a failure starts and where it ends; §6.1 rows' claims). Option/Result Convenience (`Result.orThrow`, `Option.orThrow`, the reading's `Option`). Unions spec (constructor grammar reused wholesale; the closed/open contrast is this doc's reason to exist), Functions spec (arity, constructors-as-terms, value restriction), Lexer & Layout spec (`try`/`catch`, `attempt` and `assume` bodies are layout blocks), Pattern Matching (§6.1, §6.2), Constraints spec (no derived instances for `Exn`, §7).

Written for a future implementation session against the existing `hexc` architecture: Algorithm J, union-find tyvars, level-based generalisation, constraints as dictionaries, layout pass, readable-JS emission with `.d.ts`.

---

## 1. Doctrine

- **Three kinds of throw.**
  - **An exception** is an expected failure, one a caller should plan for: a parse error, a missing file, a timeout. It is declared with `exception` (§2) and **tracked**: Effects' fail colour records whether a function may throw one, a call that may wears `^` or `!`, and the failure passes up through callbacks by itself (Effects §1, §3.6). A caller that wants the failure as data reads the call with `?` (Effects §3.1) or guards it with `attempt` (§8.2). `Result` stays for storing an outcome: a value kept in a collection, handed on later, or returned across a module's public face.
  - **A fault** is a broken assumption: an index out of range, a division by zero, a number that does not fit. It is declared with `fault`, and its name ends in `Fault` (§2). It is **not tracked**: no colour records it and no call is marked for it, so the prelude, which throws only faults, stays silent, and `Int.div` stays pure and unable to fail. It is catchable, deliberately: an arm names it, or the `fault e` pattern catches every fault (§5). A catch-all `_` lets it through.
  - **A foreign throw** is whatever JavaScript throws through a boundary. It is tracked as the row it comes through claims (Effects §6.1), and it is caught as `JsError` (§6).

  Tracking records *whether* a call may fail, never *which* exception it throws (Effects §1).
- **Catching is legal anywhere, pure code included** (the OCaml/F# position). Which fault or foreign throw arrives is therefore observable in code whose colours are silent, and the Effects §7 reordering licence is bounded by it: a conforming compiler may not reorder or fuse silent computations where doing so changes which exception or fault is thrown, or whether one is. JS's fully specified evaluation order means the emitter meets the bound by doing nothing; it is recorded so a future optimizer does not spend a licence that was never that wide. **Throw-pure/catch-impure** (Haskell's cut) is rejected with its price named: imprecise exceptions make the *observed* exception depend on evaluation order, which buys an optimizer a freedom that laziness left Haskell unable to decline, and that Hexagon declines.
- **SML semantics, JS spelling.** The design is Standard ML's `exception` — an extensible sum whose constructors are declared independently, whose values are first-class, with a non-exhaustive handler that implicitly re-raises. The surface vocabulary is what every Hexagon user already knows: `try`/`catch` syntax and the ordinary `throw` function (not `raise`/`handle`).
- **`Exn` is a real type, and its values are ordinary values.** Every throwable is an `Exn`: an exception, a fault, or, through `JsError`, a foreign throw. One can be constructed, bound, stored in a record, passed to a function, and thrown later. Construction and throwing are separate acts (as in SML, and as in JS's `new Error` vs `throw`).
- **`catch` is a `match` that cannot be exhaustive.** Because the sum is open, "missing cases" is meaningless; the rule inverts. Where `match` demands exhaustiveness (Unions §4.3), `catch` provides an implicit *anything-unmatched propagates*. No error, no warning, no mandatory `_` arm. A `_` arm catches every exception and every foreign throw, and lets faults through (§5.3). This does not weaken the exhaustiveness doctrine — that payoff was always about data; control-flow escape is a different contract. The two constructs also compose — a `match` may take a `catch` clause (§5.4) — with each section keeping its own law.
- **The entire foreign world enters through exactly one door: `JsError`** (§6). Every Hexagon-originated throwable is a declared constructor, an exception's or a fault's; everything else JS can throw is a `JsError`. One door is a doctrine.
- **Representation: a branded plain `Error`, no classes** (§7). Hexagon emits no `class`, ever — unions are tagged POJOs; exceptions and faults are tagged `Error` objects with a brand field. Same shape of idea: `tag` answers "which constructor" for data, `name` answers it for throwables, and with its ending which kind (§7.1), `$hex` answers "whose throwable" — and answers it fully *(#488)*: its value is the **declaring module's full name** (§7.1; #829), so one field says both whose language (a string there: Hexagon's — string-typedness is the language test, §7.4) and whose declaration (which module's). A closed sum's constructor names are scoped by its type and `match` is type-directed, so `tag` needs no qualifier; the open sum lost that protection when every `exception` and `fault` in the program joined one type, so its discriminant carries the uniqueness the type system no longer can — runtime identity is the (module, name) pair, exactly the checker's own.

---

## 2. The `exception` and `fault` declarations

```
exception NotFoundError
exception ParseError(line: Int, message: String)
exception TimeoutError(millis: Int)
fault InvariantFault(message: String)
```

- **Two head words, one grammar.** `exception` declares an exception and `fault` declares a fault (§1). `fault` is a contextual head word, a keyword only at the head of a module-level declaration, as `union` is (Lexer §4.2). Everything below holds of both, unless it names one.
- **A fault's name ends in `Fault`, and only a fault's does.** The ending is enforced both ways, so the kind shows wherever the name does. `fault Invariant(message: String)` is refused, "a fault's name ends in `Fault` — rename it `InvariantFault`", and so is `exception TimeoutFault`, "only a fault's name ends in `Fault`; this is an exception — rename it, or declare it with `fault`", each with a rename fixit. An exception's name is free. By convention it ends in `Error`, as the stdlib's, the book's and this spec's do, but nothing enforces it: a data type that holds a failure, `record JsConversionError`, may end in `Error` too.

- **Grammar: exactly a union constructor, freestanding.** The payload is the constructor-payload form from Unions §2.1, inherited wholesale: parenthesised parameter-list-like slots; **per exception, all slots named or all unnamed** (all-or-none); nullary written bare (`exception NotFoundError`, never `NotFoundError()`); uppercase-start constructor name; non-uppercase-start slot names; duplicate slot names an error.
- Each declaration adds one constructor to the single open type **`Exn`**. There is no declaration of `Exn` itself; it is a prelude type constant, and `exception` declarations extend its constructor set. Two in-scope exceptions with the same name: error at the point of ambiguity; two in one module: hard error at the second declaration — the constructor-collision rule family (Unions §2), unchanged.
- **Module-level only.** An `exception` or `fault` declaration inside a function or block is a parse error. SML's generative local exceptions (a fresh exception per evaluation of the declaration) are deliberately declined — they exist to fake dynamic binding, and nothing in Hexagon's design wants them. (Diagnostic: "exceptions and faults are declared at module level.")
- **No type parameters, no type variables in payloads.** `exception Wrapped(value: a)` is a hard error: an open sum has no parameterised declaration site the way `Option(a)` does — the `a` has nowhere to be quantified — and SML bans top-level polymorphic exceptions for the same soundness reason. Payload slot types must be closed. (Diagnostic: "exception and fault payloads must have concrete types.")
- **No captured foreign collection in a payload** *(#876, #875; FFI Part 1 §5.4 item 3)*. `exception Bad(rows: Array(Int))` — or a payload whose type names `Array(a)`, `JsMap(k, v)`, or `JsSet(a)` anywhere inside it — is a hard error at the declaration. An exception crosses the foreign boundary wherever a throw travels: out of an exported function into a JavaScript `catch`, through foreign frames and back (FFI Part 6 §4), and none of those is a declared position at which FFI Part 1 §5.4's capture walk could copy the payload, so a captured collection there would be Hexagon-retained storage reachable from foreign code. The refusal is **unconditional** — a property of the declaration, not of any use, because an exception's travel is not statically bounded — so it fires in a program with no `extern` at all; the diagnostic says so in its own words ("an exception may be thrown through foreign code, so its payload cannot hold a foreign collection; carry a `Vector`, or a persistent `Map`/`Set` converted at the construction site") rather than sending the reader to the FFI. The declaration is the one place safety can be established, and establishing it there is what lets `Exn` — the abstract type, whose payloads no position can inspect — keep crossing by identity everywhere it does today (FFI Part 1 §4.1). Rewrite: carry a `Vector` (`Array.toVector` at the construction site) or a persistent `Map`/`Set`, whose element types name none in turn (`Map.fromJsMap`/`Set.fromJsSet`, whose `Result` the construction site handles — FFI Part 10 §7.3), each of which crosses by identity with nothing to protect.
- **No open row in a payload** (Products §4 owns the refusal; this bullet relays it, and FFI Part 1 §5.4 item 7 records the boundary consequence). `exception Bad(r: {n: Int, ...})` — or a payload whose type carries `...`, bare or named, at any depth and through any `type` alias — is a hard error at the declaration, on the ground Products §4 states for every declaration's row: it is one row for every value of the type, so a construction that widened it would widen every `Bad`. The refusal is unconditional, as the captured-collection bullet's is: it fires in a program with no `extern` at all. Diagnostic, in Products §4's vocabulary: "an exception's payload names every field of its values; this slot's type says the record may have more fields — name them, or give the slot the type `JsValue`".
- **Reserved slot names: `name`, `stack`, and any identifier beginning with `$`.** These belong to the representation (§7): `name` is the discriminant, `stack` is the JS-captured trace, `$`-initial names are representation-internal (the brand lives at `$hex`). Declaring a slot with a reserved name is a hard error: "`name` is reserved as the discriminant field; rename this field." (This replaces, for exceptions, the union spec's `tag` reservation — `tag` itself is *not* reserved here.)
- **`message` is the blessed slot** (style rule + representation hook): a slot named `message` must be of type `String`, and its value feeds the underlying JS `Error`'s own message (§7), so uncaught output reads `ParseError: unexpected token`. Not required; strongly encouraged for every exported exception. Declaring `message` at a non-String type is a hard error (the representation hook demands a string).

### 2.1 Constructors as terms

Exactly the union rules (Unions §2.2), restated for closure:

- A payload exception is a function: `ParseError : (line: Int, message: String) -> Exn`. Ordinary n-ary rules: parens required, arity checked, no partial application, no tuple splatting. First-class: `map(lines, l => ParseError(l, "bad"))` is legal.
- A nullary exception or fault is a **value** of type `Exn`, used bare: `NotFoundError`. `NotFoundError()` gets the standard "`NotFoundError` is a value, not a function; write it without `()`" hint. *(But note §7.3: unlike union nullaries, a nullary exception is not a shared constant — each mention constructs fresh, to capture a stack.)*
- Slot names are representation/documentation only; construction and catch patterns are positional, always (Unions §2.1 doctrine unchanged).
- Value restriction: a constructor application of syntactic values is a syntactic value (Functions §8.2). Nothing generalises here anyway — every exception has type `Exn`, no variables in sight.
- **Prelude throwables are bare as a category**: every exception and fault the prelude declares is in bare scope, in a catch arm and in an expression, and stays reachable qualified (`Map.KeyFault`) — the one prelude channel whose constructors are all bare, where union constructors are qualified-only but the open unions' (Modules §5.5). The ground is the name shape: a compound `…Fault` word, like `JsError`, is its own qualifier, nobody declares one as a function or a value, and a user's same-named declaration occludes with reservation (Modules §5.4), whether declared in the module or reached through a same-named import (Modules §5.1 rule 3). A future prelude fault joins bare without a ruling; the inventory keeps the names unique.

---

## 3. Typing

- **`Exn` is an opaque prelude type constant.** It unifies with itself and nothing else, and it holds every exception, every fault and, through `JsError`, every foreign throw. No structural anything; no user code can name its "constructor set" because it doesn't have a closed one.
- **`throw` is a prelude function**, not a keyword with special grammar: ordinary call syntax `throw(e)`. It never returns, so its result type is a fresh variable that unifies with any expected type — the standard typing of divergence. `if broken then throw(IndexFault(i, n)) else 5` types as `Int`.
- **What a `throw` may do is read from the text of its argument.** It touches no world. Whether it may fail depends on the kind of what it throws (Effects §3.6):
  - **A fault is no failure.** `throw` applied to a fault's constructor, or to its nullary name, is bare: `throw(IndexFault(i, n))`, `throw(AssumptionFault(cause))`. So is `throw` applied to a name whose binding is a catch arm's pattern that matches only faults: `fault e`, `IndexFault(i, n) as e`, or an or-pattern of fault constructors (§5.2). The binding is what proves the kind, not the spelling: inside such an arm, a `let e = ParseError(1, "x")` that shadows `e` makes `throw^(e)` read it as an exception, and a `let` that names a fault's construction (`let e = IndexFault(1, 2)`) proves nothing to the `throw` that reads `e`.
  - **Everything else may fail**, and the call wears `^`: an exception's constructor (`throw^(ParseError(3, "unexpected token"))`), `JsError` (`throw^(JsError(v))`, §6.2), and a value whose kind the text does not show (`throw^(err)`, `catch e => throw^(e)`).
  - The argument is read through grouping, `throw((IndexFault(i, n)))`. A pipe stage is the call it rewrites to (Operators §8), so `IndexFault(i, n) |> throw` is bare.
  - **`throw` named as a value**, without its argument list, has no argument to read, and is `(Exn) ->^ a`: `let fire = throw`, `Vector.forEach^(errors, throw)`, and a grouped callee, `(throw)(IndexFault(i, n))`, which applies the named value.
- **`Exn` is not `Result`'s friend by subtyping or coercion** — there is no implicit relationship. The explicit bridges are `attempt` (§8.2), from a failure to data, and `Result.orThrow` and `Option.orThrow` (Option/Result Convenience), from data back to an exception.
- `match` on an `Exn` scrutinee is **not permitted** — a permanent exclusion (Pattern Matching §6.1): an open sum can never satisfy `match`'s exhaustiveness contract. Diagnostic: "match requires a closed type; exceptions are inspected with `try`/`catch`." The only eliminator for `Exn` is a `catch` block — `try`'s (§5.1) or a match's clause (§5.4), where the exception is never the scrutinee. (Consequently there is also no dot access, no predicates — the Unions §5 doctrine transfers whole.)
- **Nor does a `match` take one apart inside data.** An exception's or a fault's constructor, `JsError`'s included, written as a pattern in a `match` arm, at any depth (`Some(ParseError(_, _))`, `(IndexFault(_, _), n)`), is refused at the constructor: "`ParseError` is an exception's constructor, and a `match` never takes `Exn`; exceptions are inspected with `try`/`catch`" ("a fault's constructor" for a fault). The same refusal stands at every pattern seat that shares the typing, a `let`, a `for` loop variable, a lambda parameter (Pattern Matching §6.1), its clause reading "a pattern never takes `Exn` apart" there. A `catch` arm is where these constructors are patterns.

---

## 4. `throw`

```
throw^(ParseError(3, "unexpected token"))
throw(IndexFault(i, n))       -- a fault: bare (§3)
throw^(err)                   -- err : Exn, constructed earlier
```

- Ordinary function application; the argument is any `Exn`-typed expression, and its text decides the mark (§3).
- **Stack traces are captured at construction, not at throw** — inherited directly from JS (`new Error` captures; `throw` doesn't), and specced as such rather than fought. The common adjacent case `throw^(ParseError(...))` is therefore perfect; the construct-now-throw-later pattern carries the construction site's stack, documented with one line in the stdlib docs.
- Emission: `throw(e)` emits `throw e;` — except the `JsError` unwrapping rule, §6.2.

---

## 5. `try` / `catch`

### 5.1 Syntax

```
try
    parse^(input)
catch
    ParseError(line, _) => defaultFor(line)
    NotFoundError => fallback
    IndexFault(i, n) => outOfRange(i, n)
    JsError(e) => log~(JsError.message~(e)); fallback
```

- **`try` takes a body** — same line or an indented layout block, final expression is its value (identical to lambda bodies, Functions §3.1). **`catch` takes a layout block of arms**, one per VSEP/`;`, each `pattern => body` — syntactically the same arm form as `match` (Unions §4.1), parsed in the same arm context, with the same `=>` token. Braced forms do not exist; a `{` after `try` or `catch` gets the standard records-not-blocks diagnostic (Lexer & Layout §5).
- **`catch` is mandatory** — a bare `try` block is a parse error ("`try` requires a `catch`"). There is no `finally` — in v1 or ever (§10.1).
- **`try`/`catch` is an expression**: the try-body's type and every arm body's type meet at one result type — by unification, and for numeric bodies at their expression tree's home, as `if` branches do (Numeric Literals §5.1, #1062). The scrutinee position is implicit (the in-flight exception); arms are evaluated against it top to bottom.

### 5.2 Patterns

Catch arms use **the full pattern grammar, owned by Pattern Matching §6.2** — nesting, literals, or-patterns, `as`, guards — one grammar and one arm form (`pattern [when g] => body`) for `match` and `catch` uniformly. The flat-constructor restrictions this section once carried are discharged (Pattern Matching §14.3, applied). The shared diagnostics transfer unchanged (pattern arity, bare payload constructor hint, `Point()`-style parens hint, duplicate binders).

Two additions:
- **`JsError(e)`** is a legal arm — a prelude exception (§6) matched like any other, binding the raw foreign throwable. Or-patterns mixing domestic and foreign arms are legal: `ParseError(_) | JsError(_) => fallback` (Pattern Matching §6.2).
- **The kind pattern `fault x`** (or `fault _`) matches every fault, of any declaration, and binds it as an `Exn` that is known to be a fault (§3): `fault e => report~(e)`, and `fault e when critical(e) => throw(e)`. It is a whole arm's pattern, with its guard if it has one. It does not stand inside an or-pattern, nested in another pattern, under `as`, or anywhere outside a `catch` arm (a `match` data arm, a `let`, a `for`, a lambda parameter), where it is refused: "a `fault` pattern is a whole catch arm's pattern". `fault` is a contextual keyword at a catch arm's head, as at a declaration's (§2).

### 5.3 Semantics: implicit rethrow, exact reachability

- Arms are tried in order; the first matching arm's body is the expression's value.
- **An unmatched exception propagates automatically** — the implicit rethrow. This is the SML `handle` semantics and the whole point of §1's inverted rule: no exhaustiveness demand, no required `_`.
- **A `_` (or bare-variable) arm catches every exception and every foreign throw, and lets every fault through.** A fault is caught only by an arm that names it, or by `fault e`. Catching everything is the pair: `fault e` beside `_`. A catch-all that let faults through unnoticed would turn bugs into handled outcomes, a parser's `Err` say, so it never does; a test runner or a server catches faults on purpose.
- **The three kinds partition `Exn`.** An exception, a fault and a foreign throw are never the same value, so `_` and `fault e` never shadow each other, in either order, and `JsError` arms, fault arms and exception arms each shadow only their own kind.
- **Reachability is still checked and still a hard error** (Unions §4.3 transfers), by kind: a constructor arm already covered above is unreachable; so is an exception's arm below `_`, a fault's arm below `fault e`, and a second `JsError` arm or a `JsError` arm below `_`. A fault's arm below `_` is reachable, and so is a domestic arm below a `JsError` arm. Over the full grammar the logic is Pattern Matching §7.2's — or-patterns folded in, guarded arms unable to subsume — and it remains exact; do not approximate.
- **Over a part that cannot fail, an arm that only catches failures is refused.** Where what a `try` guards cannot fail, its fail colour silent once its body settles (Effects §3.6), no exception can arrive, so an exception's arm, other than `JsError`'s, and a catch-all are refused: "this arm can never run: nothing in this `try` may fail", a refused catch-all adding "— a fault passes `_`; to catch one, name it or write `fault e`". A fault's arm, `fault e` and `JsError(e)` stay: a fault may still arrive, and so may a foreign throw from a row whose claim that it cannot fail is broken (Effects §6.1). A callback's colour is not silent, so a catch-all around a call through a callback stands at every instantiation. A guarded part in error owes nothing (Effects §3.5).
- **Guards** (Pattern Matching §3) run against the caught exception after the arm's pattern matches, outside any protection: a guard that throws propagates outward, exactly like a body — the emission gets this for free, guards running inside the JS catch block (§7.4). A failed guard falls through to the next arm; no arm left means the implicit rethrow, as always.
- The try-body is evaluated once; exceptions thrown *inside a catch arm's body* are not caught by the same `catch` (they propagate outward) — standard, but stated because JS's `try`/`catch` behaves identically and the emission (§7.4) gets it for free.
- **Colours.** Where an unguarded `_` or bare-variable arm stands among the arms, the `try` handles the try-body's failure (Effects §3.6): the try-body's world colour joins the enclosing body's, and its fail colour does not. Where none stands, the try-body's colours join as any subexpression's do, the implicit rethrow passing its failure on, since the fail colour records whether, never which. Every arm body is an ordinary position, and joins both colours. A rethrow in an arm is a `throw` marked by §3: `e => throw^(e)` may fail, and `fault e => throw(e)` is bare. A call inside either on a callback's colour conducts it and wears its mark, as usual (Effects §3.1, §3.4). Catching never launders the world colour.

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
- **Typing.** Every body — data arm and catch arm alike — meets at the one result type, as §5.1's bodies do. The scrutinee types against the data arms exactly as without the clause (Pattern Matching §6.1); in particular the `Exn`-scrutinee ban (§3) is untouched — a catch clause does not make `match` an eliminator for `Exn`.
- **Exhaustiveness is untouched in both directions.** The data arms alone must be exhaustive over the scrutinee's type — the clause discharges nothing, because a thrown exception is not a case of that type. The catch arms carry no exhaustiveness demand — the sum is open; §1's inverted rule. Two shapes are thereby impossible rather than banned: a `match` of only catch arms cannot be written (`match e` followed directly by `catch` is a parse error at the clause, §9: "`match` requires at least one arm; to handle only exceptions, use `try`/`catch`"), and an or-pattern can never span the sections (its alternatives live in one arm, and each arm lives in one block).
- **Reachability is per-section and unchanged** — Pattern Matching §7.2 for the data arms, §5.3's exact set logic for the catch arms — **plus one new judgment: a scrutinee whose evaluation provably cannot throw makes the entire clause unreachable.** Hard error, like every unreachable arm: "this `catch` can never run: evaluating ⟨scrutinee⟩ cannot throw" (⟨scrutinee⟩ substitutes the source text — always a single lexical form, by the class below). The judgment runs where reachability already runs — after elaboration — and the class is exact and deliberately minimal. It fires only when the elaborated scrutinee is (i) a **bare variable read** — a plain reference, not an evidence application: a generalized literal binding's use re-runs its `Num` elaboration, which may be user code — or (ii) a **literal whose elaboration erases to a primitive construction** (the Numeric Literals §5 codegen guarantee; a String literal with no interpolation holes qualifies, and so does the Unit literal `()` — the arity-0 tuple evaluates nothing; a non-empty tuple, vector, or record literal never does — their sub-expressions run arbitrary code). Nothing wider: the fail colour proves only that no exception arrives, and a fault or a foreign throw still may, since a `->` function may throw a fault. So a clause over a scrutinee that cannot fail stays reachable through its fault arms, `fault e` and `JsError(e)`, and its exception arms and catch-all are refused by §5.3's rule instead. In particular, a user `Num` instance's `fromNat` is pure yet may throw, and its totality is a documented law, not a checked property; where user elaboration is in play, the judgment declines rather than lean on the law.
- **Colours.** §5.3's bullet transfers, with the window narrowed: where an unguarded catch-all stands in the clause, the scrutinee's failure is handled and its world colour joins the enclosing body's; the data arms and the catch arms are ordinary positions and join both colours (Effects §3.6).

Emission is §7.4's discrimination with the `try` narrowed to the scrutinee — see the note there.

---

## 6. Foreign throwables: `JsError`

Hexagon code compiled to JS will have JS exceptions pass through it — a `TypeError` from an extern call, a `RangeError` from `JSON.parse`, a bare `throw "oops"` from a badly-behaved library (JS permits throwing any value). The survey of precedent (ReScript's `Js.Exn.Error`, Scala.js's `js.JavaScriptException`, Fable/Kotlin-JS's hierarchy mapping, PureScript's everything-is-the-JS-error) all converges on: foreign throwables must be catchable through the same construct. Hexagon agrees — the number-one job a JS developer will hire `try`/`catch` for is wrapping a throwing JS API, and the design must serve it.

### 6.1 The prelude exception

```
exception JsError(error: JsValue)
```

- `JsValue` is the representation-direct opaque type for any JavaScript value, facing TypeScript as `unknown` (FFI Part 11). No attempt is made to type an arbitrary thrown value structurally, because JS permits throwing anything, including `null` and strings. FFI Part 11 §7 specifies the total conservative accessors `JsError.message : JsValue ->~ String` and `JsError.stack : JsValue ->~ Option(String)` (each touches the world, one guarded foreign read per call, and cannot fail: guarded property failures are suppressed into `""` / `None`).
- **`JsError` is an exception, not a fault** (its name does not end in `Fault`), so `_` catches it. A foreign throw is tracked as the row it comes through claims (Effects §6.1). Through a row that may fail (`->^`, `->!`), it is a failure the fail colour tracks. Through one that claims it cannot (`->`, `->~`), it breaks that claim and arrives untracked: as a `JsError`, or as the branded Hexagon exception it was where one came back out through the foreign frames (FFI Part 6 §4). A catch-all catches either.
- **No decoding.** A JS `RangeError` is a `JsError` whose payload you interrogate via accessors; it does not become a structured Hexagon exception. Classification of foreign errors is userland. This keeps the FFI honest — no typing the untypeable.

### 6.2 The wrapping is virtual

`JsError` is special-cased in emission (and only there — its typing and surface behaviour are ordinary). The special case is keyed on the prelude's declaration, not the spelling: where a module's own `exception JsError`, or a same-named import (Modules §5.1 rule 3, §5.4), occludes the prelude's, bare `JsError` is that other exception's constructor and carries none of the below, and the foreign door is reached qualified — as `JsError.JsError(e)` under the module's own declaration, and through a realiased import of the prelude module (`import Hex.JsError as Js`, then `Js.JsError(e)`) where the spelling `JsError` names the user's module.

- **In a catch arm**, `JsError(e)` allocates nothing: it is the foreign branch of the two-stage discrimination (§7.4), and `e` binds the raw thrown value directly. Implicit rethrow of an unmatched foreign error rethrows *the original object* — stack intact, no wrapper burying it.
- **`throw` applied directly to a `JsError` construction unwraps**: `throw^(JsError(e))` emits `throw e;`. This makes the rethrow-after-inspection idiom (`JsError(e) => if recoverable(e) then ... else throw^(JsError(e))`) preserve the original error's identity and stack. 
- **As a first-class value** (constructed, not immediately thrown/matched): `JsError(v)` materialises an ordinary branded exception object carrying the payload (§7), like any other constructor. Throwing *that* value later throws the branded wrapper — the unwrapping rule is syntactic (throw-of-construction), not dynamic. Acceptable residue: the dominant idioms (catch, rethrow-in-arm) are zero-cost and identity-preserving; the exotic one is merely ordinary.

---

## 7. Runtime representation & emission

### 7.1 The representation: `Error` + brand

Every Hexagon-constructed exception and fault is a **plain JS `Error` object** — real stack trace, sane uncaught console output — extended with a brand and its payload fields. **No classes.** Construction of `ParseError(3, "bad")` emits (modulo a shared helper, §7.2):

```js
Object.assign(new Error("bad"), {
  $hex: "Parser",           // the brand: "this is a Hexagon exception" — and whose (the declaring module)
  name: "ParseError",       // the discriminant (JS consoles print name: message)
  line: 3                   // payload slots, flat, under their declared names
})
```

- **The brand is `$hex: "<declaring module>"`** *(#488; supersedes `$hex: true`)* — a plain own-property, chosen over a `Symbol` key deliberately: it is honest data, survives structured-clone/realms/workers/bundler-duplication (all the places prototype identity breaks), and `$hex` is not a legal Hexagon identifier, so it can never collide with a user slot (§2's `$` reservation makes this airtight). The value is the declaring module's identity — and a module's identity in Hexagon **is its full name** (Modules §2.1, §2.3; #829 — before #829 it was the module's path, and the brand was the project-root-relative path with `.hex` dropped): the declared name, dotted segments and all, prefixed by the package's name and a dot where the module belongs to a named package (Packages §2.3, §2.5) — the compiler's own module identity, rendered as the importer would write it. Unique by construction — module names are unique within a package, no module's dotted name begins with a package in the program (both Modules §2.2), and a program holds one copy of each package, the project counted (Packages §4.3) — with no new naming rule, no importer-alias dependence, and no dependence on where the file sits. A project's `module Parser` brands `"Parser"` (this document's running example); `module Client.Errors` brands `"Client.Errors"`, so its `Boom` and `module Server.Errors`'s `Boom` stay distinct; a prelude module brands its full name (`"Hex.Seq"`, `"Hex.Vector"`, `"Hex.Map"`), and a dependency's module its own (`"Acme.Geometry"`). Two modules each declaring `exception Boom` therefore produce distinguishable representations — two modules sharing one file included (Modules §2.2) — and a catch arm binds only the constructor it names — without the module in the brand, `B.Boom(tag)` catches `A`'s `Boom` with `tag` bound `undefined`, an accident needing no adversary. The value is stable across builds and machines, since nothing in it reads a path: the identity root #494 asked for is the name itself. One edit changes every brand a package declares — giving the manifest a `name` (Packages §2.5), which turns `"Parser"` into `"Acme.Parser"` and re-spells the literal in every exception face — so publication is the moment to take it, before any JavaScript consumer has copied a brand string.
- **The kind is the name's ending.** A fault's `name` ends in `Fault`, and only a fault's does (§2), so a Hexagon error, one whose `$hex` is a string, is a fault exactly when its `name` ends in `Fault`. No field records the kind: the name already guarantees it, and an uncaught fault already prints as one (`IndexFault: …`). A foreign throwable is never a fault, whatever it is called.
- **`name` is the discriminant** — doing for exceptions and faults exactly what `tag` does for unions, with the bonus that `name` is the field JS consoles and error reporters already print: uncaught output reads `ParseError: bad` plus a stack, indistinguishable from a well-written JS library's error.
- The `message` slot, if declared, feeds `new Error(message)` (§2); a declaration without a `message` slot constructs `new Error()` with an empty message. `AssumptionFault`'s `cause` is the one exception to that (§8.3).
- Unnamed slots emit as `item1 … itemN` fields, the products vocabulary (Unions §6.1), flat beside the brand.
- **Rejected: one `HexagonError` class, or a class per exception** (the F#/Fable shape) — considered at length and declined. Classes reintroduce `instanceof` and prototype identity, which breaks across bundler duplicates and realms — a known ecosystem wart the branded-POJO-over-`Error` design simply doesn't have — and would put `class` declarations in emitted output that is otherwise class-free. The reconciliation paragraph that design needed is the tell; this design needs none. Do not re-litigate without new information.
- **Rejected: bare tagged POJOs (no `Error`)** — an uncaught `{tag: "NotFoundError"}` surfaces as `[object Object]` with no stack: a catastrophic debugging experience and a readable-JS violation in spirit. The `Error` base is non-negotiable.
- Spoofing residue, recorded honestly: a JS library *deliberately* throwing `{$hex: "Parser", name: "ParseError", ...}` impersonates a Hexagon exception. The brand moves the failure mode from "breaks by accident" (any library setting `err.name`, which is conventional) to "breaks only on purpose," which is where every tagged representation in the language already lives — nothing stops JS handing Hexagon a fake `{tag: "Some"}` either. One widening under #488, recorded: stage 1 is now a **class** test (any string `$hex`), not a sentinel match, so a foreign throwable carrying a coincidental string `$hex` routes to the domestic branch — bypassing `JsError` arms and rethrown unless `_` catches — and `isHexError` answers true for it. Same tier in kind: `$hex` is nobody's conventional property (unlike `name`), so the coincidence still requires an object that had no business carrying it.

### 7.2 Construction sites

The emitter provides one tiny module-level helper (shape at its discretion, e.g. `const $mkExn = (name, message, fields) => Object.assign(new Error(message), {$hex: "Parser", name}, fields);` — per-module, so the helper bakes in its own module's name, #488) so construction sites stay readable: `$mkExn("ParseError", "bad", {line: 3})`. Direct `Object.assign` inline is equally acceptable for the emitter where it reads better; the representation, not the helper, is the contract. In a module whose own bindings contest `Error` or `Object`, the helper's references reach the globals through reserved imports — `new __global_Error(…)` — under FFI Part 7 §1.2's runtime-vocabulary rule (#666); the representation is unchanged.

### 7.3 Nullary exceptions and faults construct fresh

Unlike union nullaries (shared module-level constants, Unions §6.1), **a nullary exception or fault constructs a fresh object at each mention**: `NotFoundError` emits `$mkExn("NotFoundError", "", {})` at the use site. Reason: the stack trace is captured at construction (§4), and a stack pointing at the declaration site is worthless. The union spec's allocation-free trick is deliberately not applied; exceptions are cold paths and a construction per throw is the correct trade.

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
    } else if (err.$hex === "Parser" && err.name === "NotFoundError") {
      ...
    } else if (err.name.endsWith("Fault")) {       // the kind: a `fault e` arm, if present
      ...                                          // no `fault e` arm: throw err;
    } else throw err;                              // unmatched Hexagon exn: implicit rethrow
  } else {                                         // foreign branch
    const e = err;                                 // the JsError(e) arm, if present
    ...                                            // no JsError/_ arm: throw err;
  }
}
```

- The `err != null` guard is load-bearing: JS code can `throw null` / `throw "oops"`, and those must flow to the foreign branch rather than crash the discriminator.
- Verify against the three failure modes this structure exists to kill: a Hexagon `NotFoundError` reaching a `JsError`-only catch is branded → domestic branch → no name match → rethrown (`JsError` never swallows domestic exceptions); a foreign `new Error` with `name === "ParseError"` is unbranded → foreign branch (no impersonation-by-coincidence); and module `A`'s `Boom` reaching an arm written `B.Boom(tag)` is branded `"A"`, not `"B"` → no match → rethrown *(#488 — no cross-module capture, no `undefined` payloads)*.
- Where every arm's constructor is declared by one module — the common case — the emitter may hoist the owner comparison (`err.$hex === "Parser" && (err.name === "ParseError" ? … : err.name === "NotFoundError" ? … : …)`); the observable rule is the (module, name) pair per arm, not the shape of the chain.
- A `_`/bare-variable arm emits as the catch-all of the foreign branch, and of the domestic branch for exceptions only: a fault that reaches it there is rethrown (`err.name.endsWith("Fault")`). A `fault e` arm is the domestic branch's kind test (§7.1). Equivalently a hoisted structure — emitter's choice; the observable rule is that `_` catches every exception and foreign throw and lets every fault through.
- **A reading, `attempt` and `assume` emit the same discrimination** (Effects §8): a `catch` that rethrows a fault and handles everything else, around the call alone for a reading (Effects §3.1), and around the body for `attempt` and `assume` (§8.2, §8.3).
- Name discrimination may use `if`/`else` chains or — within a hoisted owner group, where the `$hex` comparison has already run (#488) — `switch (err.name)`; catch blocks are cold by definition, so the emitter should prefer whichever reads better.
- `try`/`catch`-as-expression uses the same strategy ladder as `match` (Unions §6.3): statement lifting into `return`/`const`-assignment positions first, IIFE for genuinely inline positions.
- Payload binders emit as `const` bindings from the declared field names (patterns positional in source, representation named), with the same inline-single-use license as Unions §6.3.
- **The match catch expression (§5.4) narrows the `try` to the scrutinee.** Lower as: bind the scrutinee inside the `try` (`let $t; try { $t = <scrutinee>; } catch (err) { … }`), run this section's discrimination in the JS `catch` — a matched arm produces the expression's result and control skips the data arms; unmatched, `throw err;` — then lower the data arms on `$t` outside the `try`, per Unions §6.3. The join (a `return` in statement-lifted return positions; a labeled `break` or the IIFE rung otherwise) follows the same strategy ladder; the shapes above are illustrative. The observable contract is §5.4's window: the emitted `try` wraps the scrutinee's evaluation and nothing else — no data-arm test, guard, or body, and no catch-arm guard or body, may sit inside it.

### 7.5 `.d.ts`

An exported exception or fault appears as the intersection type that states the §7.1 representation honestly — which is also exactly the shape a hand-written branded error's declaration takes (an outcome, post-#147, not the ground):

```ts
type ParseError = Error & { readonly $hex: "Parser"; readonly name: "ParseError"; readonly line: number };
```

- **The brand is included, deliberately**: JS-side code constructing Hexagon exceptions to throw into Hexagon does it correctly or not at all.
- Exported exceptions and faults ship constructor functions for JavaScript callers (FFI Part 7 §6). Payload constructors follow declared slot order. Nullary ones are also function-shaped for JavaScript and construct a fresh branded `Error` on every call, preserving call-site stack capture; they are never exported as shared constants.
- `Exn` itself, where it appears in exported signatures (e.g. the error side of a `Result(a, Exn)` that `attempt` made), is `Error` in the `.d.ts` — honest about the foreign door: any caught value is presented as an `Error`-typed thing at the boundary. (Foreign non-`Error` throwables make this a white lie of the same size every TS `catch` clause tells; recorded, accepted.)
- **The throws manifest** *(#479)*: an exported declaration documents each declared exception or fault it may throw with the recognized sentence ``Throws `X` when <condition>.`` (Doc Comments §6.1 — `Throws`, the language's own verb), and emission surfaces each as a generated `@throws` tag in the JSDoc block (Doc Comments §7.4; FFI Part 7 §6). Documentation, not typing; nothing is checked (§10.4's linting posture).

### 7.6 Boundary guards: `.is` and `isHexError` *(#478)*

The discrimination a JS consumer must write — §7.4's two-stage test, read from the outside — is manufactured for them at emission, in two shapes:

- **Every exported exception or fault constructor carries a guard property `is`.** `ParseError.is(err)` is the domestic test at this identity — `err != null && err.$hex === "Parser" && err.name === "ParseError"` (#488's (module, name) pair) — and its declaration types it as a TypeScript predicate, `(err: unknown) => err is ParseError`, so a consumer's branch narrows to §7.5's intersection face. The property seat is deliberately collision-free: no Hexagon surface can occupy a property of an exception constructor — a nullary's dotted spelling is ruled out by §3, and a payload constructor's resolves as Modules §5.1's module namespace, never as a property — so no name is spent and no collision rule is needed. Nullary exceptions carry the same property on their function-shaped export (FFI Part 7 §6).
- **A module that exports at least one exception or fault also exports `isHexError`** — stage 1 alone, `err != null && typeof err.$hex === "string"`, typed `(err: unknown) => err is Error & { readonly $hex: string; readonly name: string }`. It answers the domestic-or-foreign question every consuming `catch` asks first; the foreign branch is its negation.
- **`isHexError` is a face, not a hygiene name** (Lexer §3.2 keeps generated public spellings outside the `__` prefix), so it is spelled plainly — and, being a fixed generated public name, a collision with an explicit export of the same module is the Part 8 §6.2 family's hard error: both sites named, the fix a source rename, never a silent one.
- **Guards certify the brand, not the payload.** They witness construction by §7.1's representation contract, nothing structural; §7.1's spoofing paragraph transfers unchanged — a guard moves the consumer's check from hand-written to correct, not from honest to safe.
- **`JsError` ships no guard.** Its wrapping is virtual (§6.2): outside §6.2's exotic first-class residue, what a JS consumer receives from Hexagon is never a branded `"JsError"` — it is the original foreign throwable — so a `JsError.is` would match only that residue and mislead everywhere else. The foreign branch is `!isHexError(err)`.
- **Nothing here exists on the Hexagon side of the boundary.** `.is` and `isHexError` are emission artifacts like the constructor functions themselves (FFI Part 7 §6 owns their `.d.ts` faces); Hexagon source can neither name nor need them — the domestic eliminator is `catch` (§3).

---

## 8. The bridges, and the prelude's throwables

### 8.1 `JsError`

Per §6.1. Declared in the prelude; FFI Part 11 finalizes its `JsValue` payload and the total conservative `message`/`stack` accessors.

### 8.2 `attempt`: a failure as data

```
let loaded = attempt loadConfig^(path)        -- Result(Config, Exn)
let parsed = attempt
    let raw = readFile!(path)
    parse^(raw)
```

- **A body form, like `try`.** The word `attempt` is followed by a body, on the same line or in an indented layout block (Lexer & Layout §2.1), whose final expression is its value. It is a keyword (Lexer §4.1), not a function: it takes no mark, has no face, and is never named as a value or handed on. The calls in its body keep their own marks.
- **It eats to the right** (Operators §3.2), as `if` and `match` do: `Some(attempt parse^(s))` delimits it, and `attempt parse^(s) |> Result.map(f)` is `attempt (parse^(s) |> Result.map(f))`, which pipes the parsed value, not the `Result`. To map the `Result`, write `(attempt parse^(s)) |> Result.map(f)`.
- **Typing.** Where the body has type `a`, `attempt` has type `Result(a, Exn)`.
- **Semantics.** The body runs once. `attempt` gives `Ok(value)` where the body returns, and `Err(x)` where it throws an exception or a foreign throw, the latter as `JsError`'s value (`Err(JsError(e))` observationally, §6.2). A fault passes through untouched, as it passes `_` (§5.3).
- **Colours.** `attempt` handles its body's failure (Effects §3.6): the body's world colour joins the enclosing body's, and its fail colour does not. So `attempt decodeUser^(v)` is pure and cannot fail, and `attempt fetchUser!(id)` touches the world and cannot fail. The body's own fail colour is left as it stands: a callback run there keeps accepting what its arrow accepts.
- **Over a body that cannot fail, it is refused**, as a reading on a call that cannot fail is (Effects §3.1): "nothing here may fail, so `attempt` has nothing to catch". A body cannot fail where its fail colour is silent once it settles (Effects §3.6). A callback's colour is not silent, so `attempt f!()` over a callback `f` stands at every instantiation. A body in error owes nothing.

### 8.3 `assume`: this cannot fail here

```
let port = assume Int.parse^(text)
```

- **A body form, exactly as `attempt` is** (§8.2): a keyword, a body on the same line or in a block, eating to the right, taking no mark and no face.
- **Typing.** `assume` has the type of its body.
- **Semantics.** It is the writer's word that the body's failure cannot happen here. Where the body returns, `assume` gives its value. Where it throws an exception or a foreign throw, `assume` throws the fault `AssumptionFault(cause)` instead, with the original as its `cause`. A fault passes through untouched.
- **Colours.** Like `attempt`'s: the failure is handled, and a broken assumption is a fault, which nothing tracks. So `assume Int.parse^(text)` is pure and cannot fail.
- **Over a body that cannot fail, it is refused**, as `attempt` is: "nothing here may fail, so there is nothing to assume".

**`AssumptionFault`** is declared in the prelude's `Prelude.hex`, beside `ignore`: like `ignore`, it is a language form's companion, and no module's operation throws it. It is bare by category (§2.1), and `Prelude.AssumptionFault` qualified, so its brand is `"Hex.Prelude"` (§7.1):

```
fault AssumptionFault(cause: Exn)
```

Its `cause` is JavaScript's own `Error.cause` (ES2022): the emitted object is `new Error(message, { cause })`, branded as §7.1 says, where `message` is the cause's own message when the cause is an `Error`, and empty otherwise. An uncaught `AssumptionFault` therefore prints the original failure's message, and a JavaScript debugger shows the cause chain. It declares no `message` slot, and none can be given.

### 8.4 Data back to a failure

The inverse bridge is a function, not a form: `Result.orThrow : Result(a, Exn) ->^ a` throws an `Err`'s exception and returns an `Ok`'s value, and `Option.orThrow : (Option(a), () -> Exn) ->^ a` throws the exception its thunk constructs for `None` (Option/Result Convenience owns both). A `Result` whose error side is not `Exn` maps it first (`Result.mapError`).

### 8.5 The prelude's faults

Every throwable the prelude declares is a fault, but `JsError`, which is an exception. Each is declared where the operation that throws it lives — `AssumptionFault`, which a form throws, in `Prelude.hex` (§8.3) — and they are bare by category (§2.1): `IndexFault`, `SliceFault`, `KeyFault`, `DivideByZeroFault`, `IntRangeFault`, `FloatRangeFault`, `DecRangeFault`, `UndefinedSignFault`, `NegativeExponentFault`, `DecimalPlacesOverflowFault`, `NegativeDecimalPlacesFault`, `ReentrancyFault` and `AssumptionFault`. The runtime's own `TrieCorruptionFault` reports a broken internal invariant and is not bare.

---

## 9. Diagnostics checklist

| Situation | Error / hint |
|---|---|
| `exception` or `fault` inside a function/block | "exceptions and faults are declared at module level" (§2) |
| A `fault` whose name does not end in `Fault` | "a fault's name ends in `Fault` — rename it `InvariantFault`" + rename fixit (§2) |
| An `exception` whose name ends in `Fault` | "only a fault's name ends in `Fault`; this is an exception — rename it, or declare it with `fault`" + both fixits (§2) |
| Type variable in a payload slot | "exception and fault payloads must have concrete types" (§2) |
| Slot named `name`/`stack`/`$...` | reserved-name error, rename hint (§2) |
| `message` slot at non-String type | hard error: `message` must be `String` (§2) |
| payload names a captured foreign collection (`Array(a)`, `JsMap(k, v)`, `JsSet(a)`) | hard error at the declaration; rewrite: carry a `Vector`, or a persistent `Map`/`Set`, converted at the construction site and naming none in turn (§2; FFI Part 1 §5.4 item 3) |
| payload type carries `...` (bare or named, at any depth, through any alias) | hard error at the declaration: "an exception's payload names every field of its values; this slot's type says the record may have more fields — name them, or give the slot the type `JsValue`" (§2; Products §4) |
| Mixed named/unnamed slots | parse error, all-or-none (Unions §2.1) |
| `NotFoundError()` construction or pattern | "`NotFoundError` is a value, not a function; write it without `()`" (Unions §2.2) |
| Constructor/pattern arity mismatch | standard arity errors + `Circle(_)`-style hints (Unions §4.2 family) |
| Duplicate exception or fault name (module / in-scope) | constructor-collision rule family (§2) |
| Bare `try` without `catch` | "`try` requires a `catch`" (§5.1) |
| `finally` | "Hexagon has no `finally`; resources are scoped with `use`" (§10.1) |
| Braced `try { ... }` / `catch { ... }` | records-not-blocks diagnostic (Lexer & Layout §5) |
| Unreachable catch arm (a covered constructor; an exception's arm or a `JsError` arm after `_`; a fault's arm after `fault e`; a second `JsError`) | hard error, naming the shadowing arm (§5.3) |
| An exception's arm, other than `JsError`'s, or a catch-all, where what the `try` or the clause guards cannot fail | "this arm can never run: nothing in this `try` may fail"; a refused `_` or bare variable adds "— a fault passes `_`; to catch one, name it or write `fault e`" + fixit removing the arm, or, where no arm would remain, removing the `try` and its `catch` (or the clause) and keeping the body (§5.3; Effects §3.6) |
| A `fault` pattern inside an or-pattern, nested, under `as`, or outside a `catch` arm (a `match` data arm, a `let`, a `for`, a lambda parameter) | "a `fault` pattern is a whole catch arm's pattern" (§5.2) |
| `fault` before a constructor's pattern or a group at a catch arm's head (`fault MyFault(c) =>`, `fault Vector.IndexFault(i, _) =>`) | "a `fault` pattern is `fault` and a name or `_`, catching every fault; to catch `MyFault` alone, write its pattern without `fault`" (the constructor spelled as written; before a group, "to catch what this pattern names, write it without `fault`") + fixit removing the word; at any other pattern seat, §5.2's "a `fault` pattern is a whole catch arm's pattern" with the same fixit (§5.2) |
| `attempt` over a body that cannot fail | "nothing here may fail, so `attempt` has nothing to catch" + fixit keeping the value's type: `Ok(…)` around the body (§8.2) |
| `assume` over a body that cannot fail | "nothing here may fail, so there is nothing to assume" + fixit removing the word (§8.3) |
| `attempt` or `assume` with no body, or named as a value | parse error: "`attempt` is followed by the code it guards, on the same line or in an indented block" (§8.2) |
| A `throw` whose mark disagrees with its argument's kind | Effects §9's mark rows: "this call cannot fail, so `throw` wants no mark, not `^`" for a fault; "this call may fail, so `throw` wants `^`, not no mark" otherwise (§3) |
| `match` on an `Exn` scrutinee | "match requires a closed type; exceptions are inspected with `try`/`catch`" (§3; Pattern Matching §6.1) |
| An exception's or a fault's constructor as a pattern in a `match` arm at any depth, or in a `let`, `for` or lambda-parameter pattern | "`ParseError` is an exception's constructor, and a `match` never takes `Exn`; exceptions are inspected with `try`/`catch`" ("a fault's constructor" for a fault; "a pattern never takes `Exn` apart" at a `let`, `for` or lambda-parameter seat), at the constructor (§3; Pattern Matching §6.1) |
| Dot access on an `Exn` value | "exceptions are inspected with `try`/`catch`" (§3) |
| `catch` clause on a cannot-throw scrutinee (bare variable read / primitive-erased literal, §5.4's class) | hard error: "this `catch` can never run: evaluating ⟨scrutinee⟩ cannot throw" (§5.4) |
| `match e` followed directly by `catch` (no data arms) | parse error: "`match` requires at least one arm; to handle only exceptions, use `try`/`catch`" (§5.4) |
| `catch` indented as a match arm | parse error + fixit: "align `catch` with `match` to attach a catch clause" (§5.4); at a match function this row's advice would be circular (no column attaches a clause there), so every `catch` reaching a match function — this seat included — reports the match-function diagnostic instead (Pattern Matching §6.7) |
| `catch` at an enclosing item's column, or aligned with a mid-line `match` head's item | alignment error + fixit: "a `catch` clause must align with a `match` that begins its line — align the `catch` with the `match`'s column; if the `match` head is mid-line, move it onto its own line" (§5.4); when the trailing `match` is scrutinee-less, report the match-function diagnostic (row below) directly instead |
| `catch` on a match function (scrutinee-less `match`, Pattern Matching §6.7) | "a match function's parameter is already a value; there is nothing here for `catch` to observe — to guard the arm bodies, write a lambda whose body is `try match x …` with `catch` aligned to the `try`" (§5.4) |

---

## 10. Hanging questions (recorded; §10.1 since resolved)

1. **`finally`. Resolved: never.** `finally` is an accident of language-history sequencing: `unwind-protect` patched the non-local exits exceptions created, and the patch fossilized into surface syntax (Modula-3, then Java, then C# and JS) before the dominant use case — paired acquire/release — got its own construct. The counterfactual has been run: C++ and Ada had the resource construct first and never grew `finally`; the languages that shipped `finally` and later confronted the resource case added the paired construct and demoted it (Python's `with`, Java's try-with-resources, TC39's `using`; C#'s `using` was sugar over try/finally from the start); and the greenfield designs that revisited the question chose the paired construct instead (`defer` in Go, Swift, and Zig; `Drop` in Rust). The primitive must exist somewhere, but not as surface syntax: a future `use` lowers to emitted JS `try`/`finally`, so the emitter holds unwind-protect for free and the surface never needs the keyword. In an expression language `finally` is statement-shaped — it contributes no value — and every question the deferral recorded (may it throw? does it overwrite the in-flight exception? what does it do to `try`'s typing?) dissolves unasked. The keyword stays reserved permanently, purely to power the diagnostic (§9); the v2 resource story (`use`, a scoped binding in the F# style) files its own issue when that arc opens, and nothing here pre-decides its shape beyond the diagnostic's forward reference. Do not re-litigate without new information.
2. **Async.** JS promise rejections are exceptions in a trench coat; if Hexagon grows async/await or a Task type, the rejection channel presumably carries `Exn` with the same brand discipline. Nothing here precludes it; flagged so the async design remembers.
3. **`Show<Exn>` / constraints on `Exn`.** Presumption: `Exn` has **no** derived or prelude instances in v1 — not `Show` (what would it show, given foreign values?), not `Eq` (identity vs structural on error objects is a swamp). Interpolating an `Exn` is therefore a compile error; users show `JsError.message~(e)` or their own formatting. Presumed here, confirm in the stdlib listing.
4. **Warning on over-broad catches?** A lint flagging `_`-arms that swallow everything (the classic error-hiding bug) was floated informally. Linting policy is out of scope for specs so far; parked.

---

## 11. Decisions log

| Decision | Where |
|---|---|
| Three kinds of throw: exceptions (expected failures, tracked by Effects' fail colour), faults (broken assumptions, untracked, named `…Fault`), foreign throws (tracked as the row they come through claims); `Exn` is the one open sum holding all three; `Result` stores an outcome | §1 |
| SML semantics; `throw`/`try`/`catch` spelling | §1 |
| `Exn` values first-class; construction ≠ throwing | §1, §2.1 |
| `exception` and `fault` = freestanding union-constructor grammar; all-or-none slots; module-level only; no local/generative declarations | §2 |
| A fault's name ends in `Fault`, and only a fault's does, enforced with rename fixits; an exception's name is free, `…Error` by convention | §2 |
| No polymorphic exceptions (concrete payload types only) | §2 |
| Reserved slots: `name`, `stack`, `$...`; `message` blessed and String-typed, feeds `Error` message | §2 |
| `throw` is a prelude function, divergence typing; its mark is read from its argument's text: a fault (a constructor, or a catch-arm binder whose pattern matches only faults) bare, anything else `^`; named as a value it is `(Exn) ->^ a`; stack captured at construction | §3, §4 |
| Prelude throwables bare as a category — the `…Fault` suffix, like `JsError`, is the qualifier; future prelude faults join without a ruling | §2.1; Modules §5.5 |
| `catch` mandatory; `finally` deferred with reserved keyword | §5.1, §10.1 |
| Catch arms = flat constructor patterns (shared grammar with `match`); implicit rethrow; reachability still hard-errors; no exhaustiveness demand | §5.2–5.3 |
| `match`/dot-access on `Exn`: never; an exception's or a fault's constructor as a pattern outside a catch arm, at any depth: refused | §3 |
| Foreign throwables catchable via prelude `JsError(error: JsValue)`; no decoding; classification is userland | §6 |
| `JsError.message`/`stack` are total conservative Part 11 accessors; objects/functions receive one guarded fresh property read, secondary throws fall back to `""`/`None`; both touch the world and cannot fail, `->~`, so a catch arm writes `JsError.message~(e)` | §6.1; FFI Part 11 §7 |
| `JsError` wrapping is virtual: catch-arm binds raw value; `throw^(JsError(e))` unwraps syntactically; `JsError` is an exception, which `_` catches | §6.1, §6.2 |
| Representation: plain `Error` + `$hex: true` brand + `name` discriminant + flat payload; no classes, no `instanceof`, no prototypes | §7.1 |
| Class-based designs and bare-POJO design rejected, reasons recorded | §7.1 |
| Nullary exceptions construct fresh (stack capture); union shared-constant trick not applied | §7.3 |
| Two-stage catch discrimination (brand, then name); `err != null` guard; `_` catches every exception and foreign throw and rethrows faults; `fault e` is the domestic branch's kind test; the kind is the name's `Fault` ending, with no field | §7.1, §7.4 |
| `.d.ts`: `Error & {$hex: true; name: "..."; ...}`; brand included; exported constructor functions (nullary included, fresh per call); `Exn` at the boundary is `Error` | §7.5; FFI Part 7 §6 |
| Prelude: `JsError`; `AssumptionFault(cause: Exn)` in `Prelude.hex`, its `cause` JavaScript's `Error.cause`; the faults the prelude's operations throw | §8 |
| Exceptions are tracked by Effects' fail colour, and faults are not; a catch-all, `attempt`, `assume` and the reading handle a failure; catching stays legal anywhere, and catch-in-pure bounds the Effects §7 reordering licence; throw-pure/catch-impure rejected | §1, §3, §5.3 |
| `attempt` and `assume` are body forms (keywords, no face, eating to the right): `attempt` gives `Result(a, Exn)`, `assume` throws `AssumptionFault(cause)` for a failure; both let faults through and are refused over a body that cannot fail; data back to a failure is `Result.orThrow`/`Option.orThrow` | §8.2–§8.4 |
| `_` catches exceptions and foreign throws and lets faults through; `fault e`, a whole arm's pattern only, catches every fault; the three kinds partition `Exn`, and reachability reads by kind; over a part that cannot fail, exception arms and catch-alls are refused | §5.2, §5.3 |
| `finally`: resolved to never (supersedes the deferral row above) — keyword reserved permanently, purely for the diagnostic; resources are the v2 `use` story | §5.1, §9, §10.1 |
| *(#876)* No captured foreign collection in an exception payload — hard error at the declaration, rewrite `Vector`; the rule is what keeps abstract `Exn` identity-crossing at every boundary position | §2 |
| Boundary guards (#478): `.is` on every exported exception constructor (TS predicate to the §7.5 face); `isHexError` per exception-exporting module (stage-1 test); fixed generated face, collision = Part 8 §6.2-family hard error; `JsError` excluded (virtual wrapping); guards certify the brand only; nothing exists Hexagon-side | §7.6 |
| #488: the brand carries the declaring module — `$hex: "<module>"`, superseding `true` in the two rows above — runtime identity is the (module, name) pair, the checker's own; stage 1 = string check (a class test, spoofing note widened accordingly); two same-named exceptions in two modules stay distinct, no cross-module capture; the value is the module's full name (#829 — formerly its root-relative path; unique by construction, no new naming rule), prelude modules brand `Hex.Seq`-style, a dependency's modules under their package; naming a project's manifest re-spells every brand it declares — taken at publication | §1, §7.1, §7.2, §7.4–§7.6 |
| #500: the match catch expression — a `match` may take a `catch` clause; sectioned, never per-arm markers (data arms and catch arms answer to different laws, so they get different blocks; OCaml's interleaved `exception` arms and a per-arm `catch` marker considered and declined — do not re-litigate without new information); window = the scrutinee's evaluation only; full catch grammar in the clause; exhaustiveness untouched both directions; per-section reachability plus the cannot-throw judgment (post-elaboration, erasure-gated, minimal — never leaning on the unchecked `Num` totality law); clause attachment by column, line-initial `match` heads only (mid-line attachment reserved as a compatible future liberalization) | §5.4, §7.4, §9 |
| Catch-arm grammar discharge (Pattern Matching §14.3, applied on the #500 touch): §5.2 repoints to Pattern Matching §6.2 — full grammar in catch arms, superseding the flat-pattern rows above; §5.3 gains the or-pattern/guard notes; the deferred-to-pattern-spec diagnostics row retired | §5.2, §5.3, §9 |
| #505: the match function takes no `catch` clause, on principle — its scrutinee is its parameter, already a value; nothing to observe (the desugar is the cannot-throw class by construction); dedicated diagnostic with the `try` rewrite | §5.4, §9; Pattern Matching §6.7 |
| Four hanging questions recorded | §10 |
| §7.5's `.d.ts` phrasing re-grounded post-#147 (2026-07-29): the intersection face is the honest statement of §7.1's representation; TS-author phrasing demoted to outcome; face unchanged | §7.5 |
