# Hexagon Spec: Statements, Blocks & Mutability

**Status:** Decided (July 2026). With a **hanging-questions** section (§10; §§10.2–10.3 are resolved anchors); nothing there blocks implementation of §1–§9. §5.4 is the permanent rationale anchor for `let`-pattern binders being sequential.
**Scope:** The expression/binding classification ("everything is an expression except bindings"), block typing (non-final items unify with `Unit`, block-final bindings are errors), the discarded-value rule and the prelude `ignore` function, the two-tier shadowing ban (the Head Binder Shadowing rule: sequential binders may not shadow; head binders may — class decided by position, §5), the `var` declaration, the `:=` assignment expression, the lambda-boundary rule for `var`, JS emission, and edit notes to existing specs.
**Not in scope:** loop constructs (`for` / `for..in` — loops spec; this doc records one binding constraint on it, §7.4), the pattern grammar (pattern-matching spec; the binder *class* of every pattern position is fixed here, §5), module-level name collisions between local bindings and imports/prelude names (modules spec — decided there, Modules §5.4; consumed here §5.2), ref cells (do not exist; §6.4 records the rejection), lint policy (§10.4).
**Companions:** Functions spec (blocks as lambda bodies §3.1; capture sets §7.2 — amended by this doc §9.2; generalisation §8 — `var` rule confirmed here), Lexer & Layout spec (blocks as pure layout; "a block's value is its final expression" — refined by this doc §9.2), Unions spec (match-arm binders §4.2 — classified as head binders here), Exceptions spec (catch-arm binders — likewise), Primitive Types spec (§9 `Unit`), Declarations Preamble §1.1 (the Rewrite Rule, which this doc's diagnostics obey).

---

## 1. Doctrine

- **Everything is an expression, except bindings.** Hexagon adopts the F# model: there is no statement category in the semantics. What reads as a "statement" (`print(x)`, `x := 5`) is an ordinary expression of type `Unit`. The only non-expressions in the language are **bindings** — `let`, `var`, `fun` in blocks, and the module-level declarations (`record`, `union`, `type`, `constraint`, `honor`, `exception`). A binding introduces a name; it has no value and no type.
- **Blocks are sequences of items; sequencing is `Unit`-typed.** Every non-final item in a block either is a binding or unifies with `Unit`. A computed value in non-final position is a **discarded value** and a hard error (§3.2) — the escape hatch is the prelude function `ignore` (§3.3). The final item must be an expression; the block's type is that expression's type. A block ending in a binding is a hard error (§3.1).
- **Mutability exists in exactly one form: `var`, and it never escapes.** `var` is local, monomorphic rebinding in the `let mutable` lineage (F#; Roc's `var`). It is confined to function bodies, assignable only via `:=`, and — the load-bearing rule — **invisible across every lambda boundary**: a lambda may neither read nor assign a `var` declared outside itself (§6.2). Hexagon therefore has no ref cells, no mutable capture, no counter factories. Mutation that cannot be observed from outside a function is, from the outside, not mutation at all; the language's immutable identity survives intact.
- **Shadowing is banned for sequential binders, permitted for head binders (the Head Binder Shadowing rule).** Every name bound by the LHS of a `let`/`var`/`fun` — destructuring patterns included — may never reuse a name that is in scope, at any nesting depth: that is where refactoring bugs live, and Hexagon's layout syntax offers no brace to visually fence a shadow. Function parameters, match-arm binders, catch-arm binders, and loop variables **may** shadow — their scope is visually adjacent to the binder itself, and short conventional names (`x`, `e`, `acc`) are the whole point of them. The rule in one line: *bindings accumulate down a function; binders govern a visible adjacent region.* The class is decided by scope shape, not by whether the binding form is a pattern: replacing `let x = ...` with `let (x, y) = ...` produces the identical scope and must not change whether shadowing is legal. (§5)
- **Readable-JS emission stays trivial.** `var x = 5` emits `let x = 5;`, `x := 6` emits `x = 6;`, `ignore(e)` emits `e;`. The no-capture rule (§6.2) is what makes this honest: JS's capture-the-binding closure semantics can never be observed, because nothing captures a `var`.

---

## 2. The expression/binding classification

**Bindings** (not expressions; no type, no value):

| Form | Where legal |
|---|---|
| `let name = e` / header sugar | any block, incl. module top level |
| `var name = e` | blocks inside a function body only (§6.1) |
| `fun name = lambda` / header sugar | any block, incl. module top level |
| `record` / `union` / `type` / `constraint` / `honor` / `exception` | module top level only (their own specs) |
| `let pattern = t` destructuring (irrefutable patterns, Pattern Matching §6.3) | any block; every bound name is a sequential binder (§5) |

**Expressions** (everything else), including the ones that colloquially read as statements:

- calls (including `Unit`-returning ones like `print(x)`), literals, lambdas, `if`/`then`/`else`, `match`, `try`/`catch`, `throw(e)`;
- **`name := e`** — the assignment expression, type `Unit` (§6.3).

There is no third category. "Statement" may be used informally in docs and diagnostics to mean "expression of type `Unit` used for its effect," but the grammar and the typechecker know only bindings and expressions.

**Consequence, recorded so nobody special-cases it:** because `:=` is an ordinary `Unit`-typed expression, it may appear anywhere an expression may — as an `if` branch, as a match-arm body, as a block-final item, even as a `let` RHS (`let y = (x := 6)` is legal, `y : Unit`, pointless, harmless). No grammar restriction exists or is needed; the type system carries the whole weight. (Emission of the exotic positions: §8.)

---

## 3. Block typing

A block (layout-delimited per Lexer & Layout, or the degenerate same-line single expression) is a sequence of items. The rules, in full:

1. **Final item must be an expression.** The block's type is that expression's type.
2. **A block-final binding is a hard error.** A binding introduces a name for the rest of the block; a binding with no "rest" is nearly always the fell-off-the-end bug. Diagnostic: "a block cannot end with a `let`; did you mean to return `x`?" (naming the bound variable; same shape for `var`/`fun`).
3. **Every non-final expression item unifies with `Unit`.** This single unification yields the whole sequencing discipline — see §3.2.

### 3.1 Block-final bindings: the error, precisely

The check is syntactic (is the final item a binding node?), applied after layout, before typechecking. It applies to every block: lambda bodies, `if` branches, match arms, catch arms, `try` bodies. The module top-level block is exempt — a module *is* a sequence of declarations and need not end in an expression; module "value" is not a concept.

### 3.2 The discarded-value rule

Non-final expression items unify with `Unit`. Consequences:

- `print(x)`, `x := 5`, an effectful call returning `Unit`: fine, already `Unit`.
- `throw(e)` mid-block: fine **with no special case** — divergence types at a fresh variable (Exceptions §3), which unifies with `Unit` happily. Implementers: verify this falls out; do not add a divergence special case.
- `validateAll(items)` returning `List(...)` in non-final position: **unification failure, reported as a discarded value, not as a generic type error.** Use provenance tagging (the Numeric Literals §6 trick): the `Unit` obligation on a non-final item carries `SequencePosition(span)` provenance, and a failure whose `Unit` side traces to it reports:

  > this expression's value is discarded — its type is `List(Item)`; wrap it in `ignore(...)` if discarding is intentional.

  Never report this as "cannot unify `List(Item)` with `Unit`" and never mention unification.
- The rule is a **hard error**. Hexagon has no warning tier (the Rewrite Rule, Declarations Preamble §1.1, owns that doctrine and this diagnostic's naming obligation); the F# precedent (a warning) is deliberately upgraded, consistent with exhaustiveness and reachability being hard errors elsewhere.

### 3.3 `ignore`

```
ignore : a -> Unit
```

A **prelude function**, not a keyword: it takes anything, returns `()`. It is first-class like any function (`map(xs, ignore)` is legal, if useless). Idiomatic uses:

```
ignore(validateAll(items))
validateAll(items) |> ignore
```

Emission: an applied `ignore(e)` emits the bare expression statement `e;` — statement position in JS *is* discarding, so the call erases. Referenced as a value, the emitter materialises `const ignore = _x => undefined;` on demand (same on-demand doctrine as constructors, Unions §6.4).

`let _ = e` is **not** a discard idiom in Hexagon — `_` is a pattern wildcard (Products §2.4), not a bindable name in `let name = ...` position, and blessing it would create a second discard spelling. One idiom: `ignore`.

---

## 4. Blocks inside expressions (restated for closure)

Nothing changes from the companions; recorded so this spec is self-contained:

- `if`/`match`/`try` are expressions *containing* blocks. Each branch/arm block types per §3; the construct's type unifies all branch types as before. `if p then x := 1 else x := 2` is therefore an `if` expression of type `Unit` — both branch blocks end in a `Unit`-typed expression.
- An `if` **without** `else` exists only in the layout form (Operators §11: the `then`-form requires `else`) and is `Unit`-typed, the then-block unifying against `Unit` — exactly this section's rule applied by that owner.
- A lambda whose body block ends in `x := e` is a function returning `Unit` — no ceremony, no trailing `()`. This is the ergonomic payoff of the F# model and one of this spec's acceptance tests (§9.1).

---

## 5. Shadowing: the Head Binder Shadowing rule

*(Why `let`-pattern binders are sequential — rationale and the rejected alternative: §5.4.)*

Two classes of binders, decided by one criterion:

> **A binder is a head binder iff its scope is a proper subterm of the construct that introduces it.** Every other binder is sequential.

The criterion is a syntactic check against the AST — no judgment call per form, and new binding positions (list patterns from the collections spec, any future comprehension form) classify themselves on arrival. The docs-facing paraphrase: a head binder's governed region is *syntactically attached* to the binder-bearing construct; a sequential binder's region is the open-ended rest of whatever block it sits in.

**Sequential binders** bind a name for *the rest of the enclosing block* — a scope with no visible right edge; the enclosing block is a *superterm* of the binding form. These are **every name bound by the LHS of a `let`, `var`, or `fun`** — including every name bound by a `let` destructuring pattern (`let (x, y) = t`, `let {name, total} = order`, `let UserId(n) = id`) — and module-level declarations, within their own namespaces (layered against the prelude per Modules §5.4; see §5.2).

**Head binders** govern a region delimited by their own construct, always a proper subterm of it: function parameters — whether written in a lambda (`x => ...`) or in header sugar (`let f(x) = ...`, `fun f(x) = ...`), which desugars to the same thing (scope: the lambda body); `match`-arm pattern binders (scope: the arm body; Unions §4.2, Pattern Matching §2.1); `catch`-arm pattern binders (the arm body; Exceptions §5.2); and the loop variable or pattern of `for..in` (the loop body; §7.4, Pattern Matching §6.4).

The classification is **per-binder, not per-form**: `let f(x) = x + 1` binds `f` sequentially and `x` as a head binder — one form, both classes, and always has (§5.2). Pattern-ness is orthogonal to binder class: the same record pattern `{name}` binds a head binder in a lambda head or match arm and a sequential binder on a `let` LHS. Class is determined by *position*, never by the grammar of the pattern.

### 5.1 The rules

1. **A sequential binder may not reuse any name in scope** — whether the existing binding is itself sequential or a head binder, at any nesting depth, anywhere within the current function or its enclosing functions' local scopes. This applies to every name a `let` LHS pattern binds, punned record fields included: `let x = 10` followed by `let (x, y) = getPair()` is an error, as is `let name = currentUser()` followed by `let {name, total} = order`. Hard error at the second binding, naming the first: "`x` is already bound (line N); Hexagon does not allow rebinding — choose a different name." When the second binding is a destructuring pattern, the fixit is pattern-aware: discard with `_`, or rename the field — `{name: orderName}` (§9.3).
2. **A head binder may shadow anything**: a sequential binder (`let x = 1; xs |> map(x => ...)` — the motivating EF-query case), another head binder (nested lambdas both binding `x`), a `var`, a prelude name. The shadow fully eclipses the outer name for the binder's region; there is no way to reach the eclipsed name inside it.
3. Same-block duplicate names are the degenerate case of rule 1 (`let x = 1; let x = 2` — error) and of the existing duplicate-binder rules for patterns (`Rect(w, w)` — error, Unions §4.2; those are *simultaneous* binders, not shadowing, and stay errors).

### 5.2 Sharpenings

- Header-sugar parameters are head binders by definition (§5), so `let x = 42` then `let f(x) = x + 1` is legal — inside `f`, `x` is the parameter; outside, still `42`; `f` itself is a sequential binder and must be fresh. Implementations that check shadowing before desugaring must treat header parameters identically to lambda parameters.
- Head-binder shadowing of a `var` is legal per rule 2 — but the shadowing binder is *not* a `var`, so `:=` against the name inside the lambda hits the "not assignable" diagnostic (§6.3), never the outer `var` (which is unreachable across the lambda boundary anyway, §6.2). No ambiguity can arise.
- A `let` inside a lambda may not reuse the lambda's own parameter name (`x => { let x = ... }`) — rule 1: sequential binder, name in scope, banned.
- The sequential-binder ban is what makes `:=` resolution trivial: within any function, a `var` name is globally unique among sequential binders, so an assignment target resolves to exactly one candidate, always. `let`-pattern names being sequential (§5.4) adds only rejected collisions, never a second live candidate.
- **Binder class is positional, not pattern-determined.** The full pattern grammar (Pattern Matching spec) is legal at both sequential and head positions; the pattern contributes the *names*, the position contributes the *class*. Still exactly two classes; no pattern form may ever create a third (§5.4).
- **Module aliases can never be shadowed by any binder**, head or sequential — not by a new restriction, but by the start-class rule: module aliases are mandatorily uppercase-start (Modules §3.3) and an uppercase-start name in any pattern position is a constructor reference, never a binder (Pattern Matching §2.1). `let f(Json) = ...` therefore binds nothing; it resolves `Json` as a constructor and fails as unknown. The near-miss diagnostic for that failure is owed to the Modules diagnostics table (edit note §9.2).
- **Scope of rule 1 vs module/prelude names:** decided by Modules §5.4 (which retires this doc's §10.2 interim rule). A *module-level* sequential binder may occlude a prelude name; a *function-local* binder occludes nothing, prelude included — inside a function body the ban is absolute and layer-blind. Destructuring names participate identically at both levels: a module-level `let {parse} = ...`-style binding occludes a prelude `parse` exactly as `let parse = ...` would.

### 5.3 Lineage note (for the docs, not the compiler)

The Head Binder Shadowing rule is mildly novel as a crisp rule. Nearest relatives: Elm and Zig ban all shadowing (parameters included); Erlang forbids rebinding but lets fun parameters shadow (as a warning); Rust/OCaml/F# allow everything. Hexagon's split tracks a real distinction — visible-region binders vs open-ended bindings — and is motivated by layout syntax: without braces there is no visual fence around a nested scope, so open-ended shadowing is a misread hazard that head binders don't share.

### 5.4 Why `let`-pattern binders are sequential (permanent rationale anchor)

`let (x, y) = pair` governs no delimited region; its binders scope to the tail of the enclosing block, exactly like two consecutive `let`s — so the **proper-subterm criterion** (§5) classifies them sequential, with no per-form exception. Under any head-class reading, `let x = 10; let (x, y) = getPair(); use(x)` would compile with `x` silently changing meaning mid-block: precisely the hazard the sequential ban exists to prevent.

**Why the classification is forced, not preferred:**

1. **Refactoring invariance.** Replacing `let x = ...` with `let (x, y) = ...` produces the identical scope for `x`; it must not change whether shadowing is legal. This is the same argument that motivated the sequential ban, applied to the rule itself.
2. **Punning is the aggravating case.** With record-pattern punning (Pattern Matching §2.4), `let {name, total} = order` binds a name the programmer *never wrote* — inherited from a field of a type declared elsewhere. Every genuine head binder has an explicitly-typed name at the binding site; only `let` would combine an implicit name with an unbounded scope.
3. The criterion classifies every position correctly with no exceptions, including module level (destructuring names are module-layer sequential binders, so Modules §5.4 occlusion applies to them unchanged).

**Rejected alternative — head-class `let`-pattern names for state-threading (do not relitigate):**

```
let (state, a) = step1(state0)
let (state, b) = step2(state)      -- error
```

OCaml/F# bread-and-butter, and *more* common with tuples than the scalar rebinding Hexagon already bans, because tuple returns are how state is threaded without mutation; the scalar escape hatch is also unavailable (`var` forbids destructuring, §6.1). Rejected anyway: it preserves the silent-rebinding hazard, which is worse; the scalar analogue is already an error, so the doctrine already demands fresh names (`state1`, `state2`) or restructuring into a `for`/fold; the cost is honest friction where the hazard is real. Whether state-threading pressure eventually justifies `var` destructuring is a field-evidence question, §10.6 — the classification itself is closed.

---

## 6. `var` and `:=`

### 6.1 Declaration

```
var count = 0
var best = firstCandidate(xs)
```

- **Form: `var name = expr`.** Name-only — no destructuring (`var (a, b) = t` is a parse error: "`var` binds a single name; destructure with `let` and copy"), no header sugar (a `var` is never a function definition), no annotation-free special cases beyond `let`'s. A type annotation is permitted in the `let` position style: `var count: Int = 0`.
- **Legal only inside a function body**: in the body block of some lambda, at any block depth within it (`if` branches, match arms, nested blocks — all fine). The module top-level block, and any block not (transitively) inside a lambda body, may not contain `var`: "`var` is only allowed inside a function; move mutable work into a function, or use `let` if the value does not change." Module-level mutable state does not exist.
- **Non-recursive, like `let`**: the name is not in scope in its own RHS (same pending-binder mechanism, Functions §6; same diagnostic family).
- **Never generalises** (Functions §8.4, unchanged — this spec is that rule's raison d'être). The binding gets a **monotype**. Value restriction interplay: `var xs = emptyList()` gets `List(?1)` with `?1` unsolved; the first use — including the first `:=` — fixes it, permanently.
- Head Binder Shadowing applies: `var` is a sequential binder; it may not reuse a name in scope, and nothing may rebind it.

### 6.2 The lambda boundary (the load-bearing rule)

**A lambda may not reference a `var` declared outside itself — neither reading it nor assigning it.** Hard error at the reference:

> `shift` is a `var` and cannot be used inside a lambda; copy it to a `let` first: `let s = shift`.

That rewrite is for a **read** of the current value. An attempted assignment gets the mutation-shaped diagnostic: "`total` is a `var` and cannot be updated inside a lambda; use a `for` loop for mutable iteration, or have the lambda return the updated value and assign it outside."

- The boundary is the **lambda**, not the block. `:=` and reads across `if`/`match`/`try`/nested-block boundaries within the same function are fine; crossing a `=>` is what's forbidden.
- The blessed idiom for handing a `var`'s current value to a lambda is an immutable copy:

  ```
  var shift = computeShift()
  ...
  let s = shift                  -- freeze the current value
  xs |> map(x => x + s)          -- fine: s is a let
  ```

- **`fun` can never touch a `var`**, as a corollary: a `fun`'s RHS is syntactically a lambda (Functions §7.1), so the rule applies wholesale. Consequently **`var`s never appear in capture sets** — see the edit note §9.2.
- Enforcement point: name resolution. When a lookup resolves to a `var` binding and the reference site is inside a lambda nested within the `var`'s owning lambda body, emit the error. This is a pure scope-walk check; no dataflow analysis.
- Rationale, recorded so it is not re-litigated: mutable capture is the ref-cell smuggling route (the counter factory), and it is exactly what the `let mutable` lineage refuses (F# bans capture outright; Roc's `var` is defined by desugaring to pure rebinding). It is also what keeps emission honest (§8): JS closures capture bindings, and if nothing captures a `var`, the semantic gap between Hexagon and its emitted `let` is zero.
- **Pre-registered rejection — no escape-analysis exception, permanently.** "Lambdas may capture a `var` when the compiler proves the lambda does not escape" is rejected outright, not deferred: escape analysis would make **program legality depend on optimizer cleverness** (a legal program becomes illegal when the analysis gets weaker or the code drifts past its horizon) and on **unverifiable foreign callback behavior** at the JS boundary (whether a lambda escapes through an extern call is exactly what the trusted boundary cannot see). **Any future relaxation must be explicit syntax the programmer writes, never an inferred analysis.** The direction-specific rewrites above apply uniformly whether or not a compiler could prove that a particular lambda stays local.

### 6.3 Assignment: `:=`

```
count := count + 1
best := candidate
```

- **`name := expr` is an expression of type `Unit`.** The RHS unifies with the `var`'s monotype — "cannot change type" is a *consequence* of unification against the binding's monotype, not a separate rule, and its failure is an ordinary type error phrased against the `var`: "`count` has type `Int`; cannot assign a `String`."
- **Target grammar: a bare name, only.** Everything else is rejected with a targeted diagnostic (checklist §9.3): `p.x := e` (records are immutable — suggest `{...p, x: e}`), `t.item1 := e` (tuples are immutable), `f(x) := e` (parse error: assign to a name).
- **Target must be `var`-bound.** `:=` to a `let`-bound name: "`y` was bound with `let`; declare it with `var` if you need to update it." To a head binder (parameter, pattern binder): "`x` is a parameter and cannot be assigned; declare a `var`." To an undeclared name: ordinary unbound-name error — **no** implicit declaration, ever (the JS `x = 5`-creates-a-global disease does not exist here, and the diagnostic should not suggest it).
- Targets resolve uniquely by construction (§5.2). Assignment before the `var`'s declaration line is impossible for the same reason any use is: the name is not yet in scope (blocks are sequential; the pending-binder machinery already covers the RHS case).
- `:=` respects the lambda boundary (§6.2): assignment from inside a nested lambda is the boundary error, reported as such (not as an unbound name).

### 6.4 What does not exist (pre-registered rejections)

- **Ref cells** (`Ref(a)`, `makeRef`, ML `ref`): none. F# needs `ref` as the escape hatch *because* `let mutable` can't be captured; Hexagon declines the hatch. If shared mutable state is ever needed it is an FFI concern at the boundary, not a language type. Do not re-litigate without new information.
- **Mutable record fields, mutable tuple slots, array mutation**: none; products are immutable (Products spec) and `:=` targets names only.
- **Compound assignment** (`+=`, `-=`): none in v1. Cheap sugar, but sugar on the language's one dodgy feature; revisit only with field evidence.
- **`var` at module level**: none, per §6.1. Global mutable state is the one thing this design cannot make invisible.

---

## 7. Interactions with existing machinery

### 7.1 Inference

- `var x = e`: infer `e`'s type as a monotype `τ`; bind `x : τ` in the environment, marked mutable, never generalised. Unsolved variables in `τ` remain unsolved (value-restriction style) and are fixed by later uses/assignments.
- `x := e` where `x : τ`: infer `e`, unify with `τ`, result type `Unit`.
- Non-final block items: unify with `Unit`, `SequencePosition` provenance (§3.2).
- Nothing in `unify` changes. The four cases are untouched (same guarantee the Numeric Literals spec makes).

### 7.2 Generalisation and the value restriction

Unchanged; this spec merely activates the rules Functions §8 pre-positioned. Assert in tests: `var xs = emptyList()` then `xs := [1]`-equivalent pins `?1 := Int`; a subsequent `xs := ["a"]`-equivalent is a type error phrased per §6.3.

### 7.3 `fun` capture sets

Simplified: capture sets track **`let` bindings only** (edit note §9.2). A `fun` referencing a `var` is the §6.2 boundary error before capture analysis ever sees it. The transitive-closure and initialized-before-use machinery of Functions §7.2 is otherwise unchanged.

### 7.4 Loop-body constraint (discharged; Loops is the owner)

This spec imposed two requirements on loops, both now normative in `loops-ranges-iteration.md`: **loop bodies are blocks, not lambdas** — existential for §6.2, since a lambda body would forbid the loop from touching any `var` and kill the accumulate-in-a-loop idiom that motivates `var` — and **the loop variable of `for..in` is a head binder** (§5). Loop semantics live there, not here.

---

## 8. JS emission

| Hexagon | JS |
|---|---|
| `var x = 5` | `let x = 5;` |
| `x := e` (statement position — the overwhelmingly common case) | `x = e;` |
| block-final `x := e` in a function body | `x = e;` and the function returns nothing (`Unit` ↔ `undefined`, Primitive Types §9) |
| `ignore(e)` in statement position | `e;` |
| `x := e` in a genuinely value position (`let y = (x := 6)`) | honest-`Unit` form, e.g. `const y = void (x = 6);` — JS assignment yields the assigned value, so a bare `const y = (x = 6)` would lie; the emitter must not produce it |

- `.d.ts` impact: none. `var` is function-internal; nothing mutable crosses the boundary.
- The `var` → `let` mapping is sound *because of* §6.2: JS `let` is captured by reference by closures, but no Hexagon lambda ever closes over a `var`, so the difference is unobservable. If §6.2 were ever relaxed, this emission would need revisiting — recorded as the coupling it is.
- Blocks: no change to emission machinery — block structure is explicit in the AST (Lexer & Layout §3.3); the discarded-value rule is a typecheck, not an emission concern; rejected programs never reach the emitter.

---

## 9. Acceptance tests, edit notes, diagnostics

### 9.1 Acceptance tests (golden: inferred type + emitted JS)

```
-- (a) The accumulator shape (loop form per loops-ranges-iteration.md)
fun sumTo(n) =
    var total = 0
    ... total := total + i ...        -- however iterated
    total
-- total : Int; emits let total = 0; ... total = total + i; ... return total;

-- (b) Block-final assignment: Unit function, no ceremony
fun bump() = count := count + 1     -- ERROR if count is outer (crosses `fun`'s lambda);
                                    -- legal only for a var in the same body — so:
fun step(n) =
    var x = n
    x := x + 1
    x                                  -- step : Int -> Int

-- (c) Discarded value
fun process(items) =
    validateAll(items)                 -- ERROR: value discarded; use ignore(...)
    saveAll(items)

fun process2(items) =
    ignore(validateAll(items))         -- fine; emits validateAll(items);
    saveAll(items)

-- (d) Block-final binding
fun f() =
    let x = compute()                  -- ERROR: block cannot end with a let;
                                     -- did you mean to return x?

-- (e) Lambda boundary
fun g(xs) =
    var shift = 1
    xs |> map(x => x + shift)          -- ERROR: shift is a var; copy to a let first

fun g2(xs) =
    var shift = 1
    ...
    let s = shift
    xs |> map(x => x + s)              -- fine

-- (f) Head Binder Shadowing
let x = 1
let x = 2                            -- ERROR: x is already bound
xs |> map(x => x * 2)                -- fine: head binder shadows

let x = 42
let f(x) = x + 1                     -- fine: header-sugar parameter is a head binder
-- f(1) evaluates to 2; x is still 42 (guards against checking shadowing pre-desugar)

-- (f2) let-pattern binders are sequential (§5.4)
let x = 10
let (x, y) = getPair()               -- ERROR: x is already bound (destructure with _
                                     -- or fresh names)
let name = currentUser()
let {name, total} = order            -- ERROR: name is already bound; rename the
                                     -- field: {name: orderName}
match order
    {name, total} => use(name, total)  -- fine: match-arm binder is a head binder;
                                     -- same pattern, different position, different class

-- (g) Monomorphic var, value restriction
fun h() =
    var xs = emptyList()               -- xs : List(?1)
    xs := ints                         -- pins ?1 := Int
    xs := strings                      -- ERROR: xs has type List(Int)
```

### 9.2 Edit notes to existing specs (apply on merge)

1. **Functions §7.2:** "the outer-block `let`/`var` bindings its body references" → "`let` bindings" — `var`s can never be referenced across a lambda boundary (this spec §6.2), so they never appear in capture sets.
2. **Lexer & Layout §1** ("A block's value is its final expression"): add the caveat "the final item must be an expression; a block-final binding is a compile error (Statements spec §3.1)."
3. **Functions §8.4** ("`var` never generalizes"): add cross-reference "— see the Statements, Blocks & Mutability spec for `var` in full."
4. **Functions §10** diagnostics table: add rows for the §9.3 entries owned jointly (uppercase rule etc. unaffected).

*Apply on next touch; until then this doc governs:*

5. **Pattern Matching** — companions line "head-binder status of *all* pattern binders" → "binder class is determined by position (Statements §5), not by pattern-ness." §6.3 (`let` patterns) gains: "names bound here are **sequential binders** (Statements §5.4) — they may not reuse any name in scope; the arm/lambda positions bind head binders as before." §14.4's discharge note re-worded: the no-third-class flag *is* discharged, but via the positional rule, not via blanket head-binder status. Decisions-log row "All pattern binders are head binders" → "Binder class is positional; `let`-pattern binders sequential (Statements §5.4)."
6. **Products §2.4** — the destructuring binders' classification: strike any head-binder reference; cross-reference Statements §5/§5.4.
7. **Modules §10** diagnostics table — new near-miss row: uppercase-start name in a binder-pattern position resolving to no constructor but matching an in-scope module alias → "`Json` is a module alias; binders are non-uppercase-start — did you mean `json`?" (resolution-time hint, same family as "`Shape` is a type, not a module," Modules §5.1).
8. **hexagon-for-typescript-coders** — note for the destructuring chapter: TS muscle memory allows `const { name } = user` to shadow inside a braced block; Hexagon's `let {name} = user` is a rebinding error when `name` is in scope — rename with `{name: n}` or destructure in a `match`/lambda head where shadowing is legal.

### 9.3 Diagnostics checklist

| Situation | Error / hint |
|---|---|
| Block ends with a binding | "a block cannot end with a `let`; did you mean to return `x`?" (§3.1) |
| Non-`Unit` value in non-final position | "this expression's value is discarded — its type is `T`; wrap it in `ignore(...)` if intentional" (§3.2; never phrased as unification) |
| `var` outside a function body | "`var` is only allowed inside a function; move mutable work into a function, or use `let` if the value does not change" (§6.1) |
| `var (a, b) = t` | parse error: "`var` binds a single name; destructure with `let` and copy" (§6.1) |
| `var` name reuses a name in scope / any sequential rebinding | "`x` is already bound (line N); Hexagon does not allow rebinding — choose a different name" (§5.1) |
| `let`-pattern binds a name already in scope (incl. punned fields) | same "already bound" error, pattern-aware fixits: "discard it with `_`", "rename the field: `{name: orderName}`"; for the state-threading shape, suggest fresh names or a `for`/fold (§5.1, §5.4) |
| Lambda reads an outer `var` | "`shift` is a `var` and cannot be used inside a lambda; copy it to a `let` first" (§6.2) |
| Lambda assigns an outer `var` | "`total` is a `var` and cannot be updated inside a lambda; use a `for` loop for mutable iteration, or have the lambda return the updated value and assign it outside" (§6.2) |
| `:=` to a `let`-bound name | "`y` was bound with `let`; declare it with `var` if you need to update it" (§6.3) |
| `:=` to a parameter / pattern binder | "`x` is a parameter and cannot be assigned; declare a `var`" (§6.3) |
| `:=` to an undeclared name | ordinary unbound-name error; never suggest implicit declaration (§6.3) |
| `p.x := e` on a record | "records are immutable; build an updated copy: `{...p, x: e}`" (§6.3) |
| `t.itemN := e` on a tuple | "tuples are immutable; construct a new tuple with the changed slot" (§6.3) |
| Non-name `:=` target | parse error: "`:=` assigns to a `var` name" (§6.3) |
| Assignment type mismatch | "`count` has type `Int`; cannot assign a `String`" — phrased against the `var`, not as generic unification (§6.3) |
| Self-reference in `var` RHS | the `let` non-recursion diagnostic family (Functions §6) |

### 9.4 Terminology (binding on diagnostics and docs)

"Sequential binder" / "head binder" are spec-internal vocabulary; diagnostics say "already bound," "parameter," "pattern binder" — never "sequential" or "head." "Statement" may appear informally ("`;` separates statements," Lexer & Layout) but never in a type error; types speak of expressions and `Unit`.

---

## 10. Hanging questions (recorded, not decided)

1. **Cosmetic restriction on value-position `:=`.** `let y = (x := 6)` is legal and useless (§2). A parse-level restriction to statement-ish positions would cost a grammar wrinkle for zero semantic gain; left legal. Revisit only if it confuses real users.
2. **Resolved anchor (not an open question).** Head Binder Shadowing vs module/prelude names is **decided by Modules §5.4** (module-level bindings may occlude the prelude; function-local binders occlude nothing; the interim rule here is retired). This entry keeps its number only because existing cross-references cite §10.2.
3. **Resolved anchor (not an open question).** `else`-less `if` is **decided by Operators §11**: the layout form permits it (`Unit`-typed, per §4 here); the `then`-form requires `else`. Number kept for existing cross-references.
4. **Over-broad `ignore` lint.** `ignore` can hide bugs exactly as it prevents them; a lint on suspicious discards was floated (same parking spot as the Exceptions §10.5 over-broad-catch lint). Linting policy remains out of spec scope.
5. **Compound assignment** (`+=` etc.): rejected for v1 (§6.4); revisit with field evidence alongside the loops spec, where the itch would first appear.
6. **`var` destructuring pressure from state-threading** (§5.4): the tuple state-threading idiom now requires fresh names or a loop, and the scalar escape hatch (`var`) forbids destructuring (§6.1). If field evidence shows users repeatedly wanting `var (state, x) = ...`, reopening §6.1's name-only rule is the pressure-relief valve to consider — the §5.4 classification itself is closed.

---

## 11. Decisions log

| Decision | Where |
|---|---|
| F# model: everything is an expression except bindings; no statement category; `:=` is a `Unit`-typed expression | §1, §2 |
| Block: non-final items unify with `Unit`; final item must be an expression; block type = final expression's type | §3 |
| Block-final binding is a hard error ("did you mean to return x?") | §3.1 |
| Discarded non-`Unit` values are hard errors (F# warning upgraded); provenance-tagged phrasing; `throw` needs no special case | §3.2 |
| `ignore : a -> Unit` is a prelude function, not a keyword; the single discard idiom; erases in emission | §3.3 |
| Head Binder Shadowing rule: sequential binders — every name bound by a `let`/`var`/`fun` LHS, destructuring patterns included — never reuse an in-scope name, any depth; head binders (parameters, match/catch-arm binders, loop variables) may shadow anything; class decided by the proper-subterm criterion | §5 |
| Binder class is positional, not pattern-determined; two classes only, no third; supersedes "pattern forms inherit head-binder status wholesale" | §5.2, §7.4 |
| `let`-pattern binders are sequential — proper-subterm criterion; refactoring invariance + punning rationale; head-class-for-state-threading alternative rejected; module aliases unshadowable via the case rule (no new restriction) | §5.4, §5.2 |
| `var name = expr`: name-only, function-body-only, non-recursive, monomorphic, never generalises | §6.1 |
| Lambda boundary: no read or write of an outer `var` from any lambda; read rewrite = copy to `let`; mutation rewrite = `for` or return-and-assign outside; `fun` therefore never touches vars; **no escape-analysis exception, permanently — legality never depends on optimizer cleverness or foreign callback behavior; any relaxation must be explicit syntax** | §6.2 |
| `:=`: bare-name target, `var`-bound only, RHS unifies with the monotype ("can't change type" is a consequence); no implicit declaration | §6.3 |
| No ref cells, no mutable fields, no compound assignment, no module-level `var` | §6.4 |
| Capture sets are `let`-only (Functions §7.2 amended) | §7.3, §9.2 |
| Loop constraint (discharged into `loops-ranges-iteration.md`): loop bodies are blocks, not lambdas; loop variable is a head binder | §7.4 |
| Emission: `var`→`let`, `:=`→`=`, `ignore(e)`→`e;`; value-position `:=` must emit honest `Unit` (`void`); soundness of `var`→`let` is coupled to the no-capture rule | §8 |
| Hanging questions: four open (§10.1, §10.4–§10.6); §10.2 and §10.3 retained as resolved anchors (decided by Modules §5.4 and Operators §11) | §10 |
