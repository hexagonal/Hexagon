# Hexagon Spec: Functions

**Status:** Decided (July 2026)
**Scope:** Function definition, lambdas, `let`/`fun` binding of functions, application, arity, generalization, naming, and JS emission.
**Not in scope:** modules (Modules), operators including `|>` (Operators §8), constraint semantics (Constraints — this doc fixes only the `<a: C>` syntax, §4.2), tuples and records (Products), the pattern grammar and irrefutability (Pattern Matching — §3.1 here takes the lambda-parameter rule by reference), blocks and `var` (Statements, Blocks & Mutability), FFI (ffi.md).
**Companions:** Statements spec (blocks as lambda bodies; `var` in full, §8.4 here; joint diagnostics §10), Pattern Matching §6.5 (lambda parameters as patterns; the depth rule), Operators §8 (pipe; subject-first convention made normative), Method Syntax §4.2 (subject-first determines dot-callability) and §4.4 (dot calls obey §7.2's declaration order), Primitive Types §9 (`Unit`), Declarations Preamble §1.1 (the Rewrite Rule, which §10's diagnostics obey).

---

## 1. Design stance

Hexagon is an ML dialect that targets JavaScript (`decisions-ml-dialect-bool-2026-07.md` §1; #147). It serves JS developers with moderate FP capability, and its emitter pursues idiomatic, readable JavaScript as a valued outcome — no longer the design adjudicator it was once framed as. The function design below predates the pivot and stands unchanged in substance: its JS-facing choices rest on the JavaScript-specific fact of n-ary parameter passing, exactly the kind of ground the ruling's §1.1 still honors. *(Restated 2026-07-29.)* It follows from decisions fixed elsewhere:

- **No currying.** All arguments are supplied at once.
- **Functions are genuinely n-ary.** Internally `TFun([A, B], C)`; emitted as n-ary JS functions; arity is a property of the function, checked at every call site.
- **Types are optional.** Untyped definitions are the primary form; inference (HM, Algorithm J) supplies types. Annotations exist for comprehension and for constraining, not because the compiler needs them.
- **SML as flavor, not semantics.** Surface conventions are borrowed from Standard ML's uncurried style — `()` for the nullary case, no 1-tuples, tuple-shaped parameter lists — but the parameter list is *not* a tuple value. See §5.

---

## 2. Naming

Function names (like all term-level bindings) are **non-uppercase-start** identifiers.
An uppercase-start name in term-binding position is a hard compile error, not a
warning. Uppercase-start identifiers are reserved for types and constructors. This
gives the resolver a syntactic binder/constructor distinction while allowing names
such as `用户`, `$parse`, and `_cached` (Lexer §3).

---

## 3. The primary (type-free) forms

These are the forms users should reach for first. Everything in this section typechecks by inference alone.

### 3.1 Lambdas

```
x => body                 -- one parameter, no parens needed
(x) => body               -- identical; parens are grouping, not a 1-tuple
(x, y) => body            -- two parameters
() => body                -- zero parameters
```

- Parameters are comma-separated inside parens; a **single parameter may omit the parens**. `(x) => e` and `x => e` are the same term — `(x)` is redundant grouping, consistent with "there is no 1-tuple."
- **Each parameter is a full irrefutable pattern** (Pattern Matching §6.5, the owner of the grammar and the depth rule). In a lambda head the outer parentheses are the parameter list and **top-level commas separate parameters**: `(x, y) => e` is two parameters, permanently; `((x, y)) => e` is one tuple-destructured parameter; `{a, b} => e` is one record-destructured parameter. The zero/one/many arity doctrine here is untouched by pattern syntax. Refutable patterns are rejected by Pattern Matching's irrefutability gate; that spec owns the algorithm and diagnostics.
- Body is an expression. Block bodies use the language's ordinary block form (Statements spec); the block's final expression is the lambda's value.
- An unannotated parameter's type is inferred — and where the surrounding seat writes one, it arrives before the body is checked (§4.3).
- A lambda is a *syntactic value*: constructing it evaluates nothing. This property is load-bearing for §7 (`fun` groups) and §8 (value restriction).
- **The match function** (Pattern Matching §6.7): `match` ending its logical item, followed by an arm block, is a unary lambda — `$x => match $x …` by definition, with exhaustiveness demanded over the parameter type. It is a lambda literal for every written-form check (§7.1 included) and a syntactic value like any other lambda.

### 3.2 `let`-bound functions

**Prefer `let` over `fun` whenever there is a choice.** `fun` exists for recursion (self- or mutual); everything else is a `let`.

```
let double = x => x * 2
let plus = (x, y) => x + y
let plus(x, y) = x + y          -- header sugar: same AST node as the line above
```

Header syntax (`let f(params) = body`) is pure sugar for `let f = (params) => body`. The parser produces the **identical AST node** for both — equivalence is by construction, not by two code paths agreeing. Header parameters are the same patterns as lambda parameters (§3.1).

### 3.3 `fun`-bound functions (recursion)

```
fun fact(n) = if n <= 1 then 1 else n * fact(n - 1)
fun fact = (n) => if n <= 1 then 1 else n * fact(n - 1)   -- same AST node, same emission
```

Same header/lambda sugar equivalence as `let`. The differences from `let` are scoping and recursion, specified in §7.

---

## 4. Typed forms

Annotations serve comprehension and constraint-attachment. They never change what inference *could* derive except by restricting it.

### 4.1 Parameter and return annotations

```
let plus(x: Int, y: Int): Int = x + y
let log(msg: String): Unit = print(msg)
let plus = (x: Int, y: Int): Int => x + y
```

- Parameter annotations: `name: Type` inside the parameter list.
- Return annotation: **colon after the parameter list** — TypeScript/C#/Scala/Kotlin style. There is no `->` in definition headers; arrow notation is the canonical displayed type form (§5.1).
- *(#355.)* **A definition's own effect colour is inferred from its body**, never written in the header — the header has no outer-arrow seat, which is the previous bullet working as designed. Function-typed *parameter* annotations carry their own arrows (`transform: a ->? b`), and those are part of this signature: a parameter's `->?` links to the signature's one effect variable (Effects §2.2) and is one of the inlets that make the signature's other `->?` occurrences legal (Effects §2.2.1 — a return annotation's application spine can carry an inlet too). A written arrow that contradicts the body's solved colour is the face error, both directions (Effects §4.2).
- *(#405.)* **A return annotation needs no parentheses around a function type.** The type arrows are `->`, `->?`, `->!`, and the lambda's own arrow is `=>` — different tokens, so the annotation grammar may be right-associative and greedy without ever swallowing the body: in `(x): A ->! B => body` the annotation is `A ->! B` and the body is `body`, and the legal curried lambda `(x): a => y => x` still annotates `a` and takes `y => x` as its body. Parentheses remain available for grouping and mean what they always meant. *(This replaces #355's rule, which gave an unparenthesized `=>` in this slot to the body and required `(x): (A => B) => body`; both of that rule's causes were the type and term levels sharing the `=>` token, and Effects §2 no longer lets them.)*
- Any subset of annotations may be given on private functions; inference fills
  the rest. An exported function is the module-boundary exception: Modules
  §4.1.1 requires every parameter and the result to be annotated.
- **No standalone signature lines.** Types are written only on definitions.
- **A type variable written in an annotation is rigid while that definition is
  checked.** Repeated `a` occurrences name the same type, but `a` cannot quietly
  become `Int` or another concrete type to satisfy the body. The annotation is
  a contract, not a hint. An unannotated parameter still receives an ordinary
  inference variable and may resolve to a concrete type.

The distinction is observable only when an annotation overpromises:

```
let takesInt(value: Int) = value
let inferred(value) = takesInt(value)       -- legal; value is inferred as Int
let rejected(value: a) = takesInt(value)    -- ERROR: declared a, body requires Int
let numeric(value: a) = value + 1           -- legal; Num is inferred for a
```

Rigid annotation variables still accumulate inferred constraints. Rigidity
pins type structure; it does not suppress demands discovered in the body.
The literature term *skolem* may be used once to anchor the implementation
technique, but Hexagon diagnostics say **declared type variable**.

Ascription — `(e: Type)`, the Ascription spec — is a fourth annotation
position under this same contract: type variables written anywhere in one
declaration (parameter annotations, the return annotation, and ascriptions in
its body) are the same variables, and a name not written elsewhere introduces
rigid, scoped to that declaration.

A type position inside an annotation may instead be left unwritten with a
**type hole**, spelled `_`: `xs: Vector(_)` claims the constructor and infers
the element. A hole elaborates to an ordinary inference variable — never
rigid, filled with a monotype, never a scheme. The bare whole-type hole
(`x: _`) is legal and inert — it means exactly what omitting the annotation
means, and canonical formatting drops it, leaving the bare binder `x`.
A hole — and only a hole — may carry a written constraint list, the §4.2
form: `x: _ : Show`, or `xs: Vector(_ : Num)` for an element. The list is a
requirement the fill must satisfy — a floor, never a cap; a named variable
instead constrains at its binder (§4.2), the one home a name affords.
Semantics, legal positions, constrained holes, and the
total-contract fence (no holes in exported signatures or declaration
surfaces) are owned by `decisions-ml-dialect-annotations-2026-08.md`.

### 4.2 Explicit type parameters

Angle-bracket syntax, settled form:

```
let plus<a: Num>(x: a, y: a): a = x + y
let plus = <a: Num>(x: a, y: a): a => x + y      -- equivalent, same AST node
```

- Form: `<typevar: constraintList>` where `constraintList` is a single constraint or a parenthesized list `(C1, C2, ...)` meaning *all* listed constraints hold. The tuple notation is suggestive (conjunction is a product); it is not a real tuple. Example: `<a: (Eq, Show)>`.
- Multiple type variables: `<a: Num, b: Show>` etc.
- An unconstrained variable may be written bare: `<a>` (legal; never canonical on functions — §4.2.1).
- Type variables are non-uppercase-start; lowercase `a`, `b`, `k`, and `v` remain the ML-family cultural convention.
- **Explicit type parameters do not create polymorphism** — inference generalizes anyway (§8). Their one added power over the bare lowercase spelling is to attach constraints; they do not name the variables into existence, since the lowercase case already classifies them as variables (§4.2.1). If the declared type is *less* general than the body supports, the declaration wins (the function is deliberately restricted). If it is *more* general than the body supports, that is a type error.
- A written binder's constraint list is also checked as a contract. Every constraint
  demanded by the body must be entailed by a declared constraint; the checker
  must not silently strengthen the list. Thus a body that uses `hash(value)`
  is rejected under `<a: Eq>` and accepted under `<a: Hash>`. Because `Hash`
  extends `Eq`, the latter also covers equality uses without restating `Eq`.
- Exported functions must write their constraint binders. Their lists contain
  every independent public constraint and omit constraints entailed as bases
  of another listed constraint; Modules §4.1.1 owns the export rule, and
  §4.2.1 below gives the complete decision procedure for when a binder is
  written at all. Private module-level functions retain the boundary-first
  style convention: annotate parameters, but infer constraints and results.
- **Position restriction:** `<...>` type parameters are syntactically permitted only on lambdas in `let`/`fun` RHS position (equivalently, in header sugar). A `<...>`-annotated lambda anywhere else is a parse error. This prevents rank-2 types from being *expressed* here; rank-2 has its own annotation-gated pathway outside this spec's scope.

#### 4.2.1 When to write constraint binders

The binder exists to attach constraints, not to introduce names. What a
bare `<a>` would announce — that `a` is a type variable and not a concrete
type — is already carried by the identifier's *case*. Lexer §3 assigns
uppercase-start names the type, union-case, constraint, implied-type,
exception, and module-alias roles and non-uppercase-start names the term
and binder roles; in type position, then, a non-uppercase-start name can
only be a type variable. So `x: a` already says everything `<a>` would,
unambiguously and at the use site; the binder repeats information the
reader already has.
It earns its place only when it carries a constraint — `<a: Ord>` — which
the lexical form cannot express. A type variable is therefore introduced by
its first appearance in a parameter or return annotation (§4.1) and
generalized by inference (§8); a bare `<a>` header adds nothing. Bare `<a>`
remains grammatically legal on functions (Constraints §1) but is never
canonical there — its one load-bearing position is a `constraint` head
(Constraints §2), where no annotation precedes the binder to introduce the
subject. An `honor` header is the function case, not the `constraint` case:
a parameterized head's variables are binders in themselves, and the prefix
earns its place only to constrain one (Constraints §5.4).

The decision procedure, in full:

- **Exported function, constrained variable:** write the binder. Its
  content is fixed by Modules §4.1.1 — every independent public constraint,
  maximal under base-constraint entailment, no restated bases.
- **Exported function, unconstrained variable:** write no binder. "Every
  independent constraint" quantifies over *constraints*, not type
  variables; a variable with nothing to publish publishes nothing.
- **Private module-level function:** write no binders at all; the body
  infers the minimal principal constraint set (style, not enforced —
  boundary-first convention, §4.1).

The worked contrast:

```
export let id(x: a): a = x                       -- complete; no binder to write
export let max<a: Ord>(x: a, y: a): a =
    if x >= y then x else y                      -- binder, because Ord is published
```

`id` is a complete exported signature as written: `a` is introduced by
`x: a`, rigid while the definition is checked (§4.1), and generalized at
the binding (§8). Adding `<a>` would be legal and inert. `max` writes
`<a: Ord>` because there is a constraint to publish — and writes only
`Ord`, since any base constraints ride along by entailment.

Rigidity is independent of the binder: an annotation variable is rigid
whether or not a `<...>` binder names it (§4.1). The binder changes what
is *published*, never how the body is *checked* — with the one §4.2
exception that a written constraint list is itself a contract the body
must not exceed.

Constraint semantics (what `Num` means, base constraints, `honor`) are the Constraints spec's business. This spec fixes only the syntax above.

### 4.3 Expected types reach inward *(#513)*

> An **expected type** flows in from the seats that write one, through the forms that return a subexpression's value, and lands at lambdas — and, as a widening home, at arithmetic operations (Numeric Literals §5.1's expected-type lift).

Inference is Hindley–Milner, Algorithm J (§8) — a lambda's unannotated parameters begin as inference variables, and a type written *around* the lambda reaches them by unification. This section fixes **when**: the unification a seat would perform anyway is performed **before the lambda's body is inferred**, so every judgment that reads a type during body inference — the match dispatch above all (Pattern Matching §6.1) — reads the resolved one. The everyday beneficiary is the match function (Pattern Matching §6.7), whose parameter type is often fixed by nothing *inside* it: guard-only arms over a numeric type constrain without resolving, and before this rule the §6.1 refusal fired on a type that was written one token away. Half of this channel predates the rule — a body has always been checked knowing its enclosing signature's written face (a local `->?` names that signature's variable, Effects §2.2.2; the face check reads both sides, Effects §4.2) — and the doctrine sentence is now whole: **the annotation's face flows inward entire**, types and colours alike, colours riding as ordinary components of the type (Effects §3.4).

**The supplying seats.** A seat supplies an expected type when it independently determines one:

- **An annotated `let`/`fun` right-hand side** (§4.1): the annotation is the expectation. A partially annotated face supplies what it writes; holes ride along as the ordinary inference variables they elaborate to.
- **An annotated `var`'s initializer, and every `:=` assignment's right-hand side** (Statements §6.1, §6.3): the `var`'s type — as annotated, or as settled so far under first-use pinning — is the expectation; an assignment boundary has always been a place a type is independently established (Numeric Literals §5.1's own list).
- **An ascription's expression** (Ascription spec §3): `(match … : (Int) -> String)` supplies the written face.
- **Each argument of a call whose callee's function type is known** when the call is checked: the callee's parameter types, pointwise — constructor applications included, a constructor being a function with a known type; **dot calls included**: a dot call whose receiver is head-known at the dot resolves its member before elaborating its arguments precisely so the member's signature can supply here (Method Syntax §2.2). Arguments are elaborated in **two passes — non-lambda arguments in source order first, then lambda literals in source order** (F#'s known-type order, rustc's closures-last; the deferred class is exactly the landing class below — the arrow form and the scrutinee-less `match`, Pattern Matching §6.7, annotated parameters or not, **read through grouping parentheses** (§3.1): `(x => e)` defers as `x => e` does. Nothing else defers: a name bound to a lambda, a call producing one, an **ascribed** lambda — whose face the ascription itself supplies, so deferral would buy it nothing — and every other expression elaborate in the first pass). Each expectation is read as resolved at the argument's turn, so the schedule pays twice over: the subject-first convention (§5.4) resolves the instantiation at the first argument, and a callback *anywhere* in the list — ahead of its subject included, the callback-first signature `f : ((a) -> b, Vector(a)) -> …` — reads its expectation off an instantiation the first pass has already resolved. The schedule is an **elaboration order only**: evaluation order remains the rewritten form's source order (§5.4, Method Syntax §2.2; Operators §8's bare-stage footnote is its one recorded deviation), and the schedule reorders no runtime effect. A callee whose type is still an undetermined variable supplies nothing, and a dot-call goal whose receiver is still unsolved at the dot keeps its pending path, its arguments synthesizing (Method Syntax §2.2, §3.3).
- **The application whose callee is a lambda literal — the pipe seat** *(Operators §8)*. `value |> match …` rewrites to `(match …)(value)` before inference (Operators §8; the checker never knows pipes exist), so the pipe's seat is the application whose callee is a lambda literal. That application elaborates **arguments first, callee last** — the lambda-literal callee is the two-pass schedule's deferred class in callee position; one schedule serves both positions — and the callee lambda lands the function type built from the elaborated argument types, pointwise, with a fresh undetermined variable as its result component — landed as what it is, the body's expected type forwarding nothing (the landing rules below govern, arity gate included: a mismatch declines silently and the seat's ordinary diagnostics stand). Both spellings of Pattern Matching §6.7 are served alike: `total |> match` with guard-only arms reads its parameter type off `total`, and the bare-lambda stage `value |> (x => …)` likewise. An application whose callee is any other expression — a name, a call, a dot chain — elaborates its callee first, as ever.
- **A constraint member's body** — its type is fully determined by the constraint declaration with the subject substituted, and Constraints §4.1 already states member typing as checking, not inference. One mechanism now serves both sentences.

**The forwarding forms.** A form that returns a subexpression's value hands its expected type to that subexpression: grouping parentheses (§3.1), a block's final expression (Statements §3; a right-hand side's layout block is the one-item case, read through as ever — §8.2), **both** branches of `if` (Operators §11), a `try`'s body block (Exceptions §5.1 — the construct's value path), and every arm body of `match` and `try` — catch arms included (Pattern Matching §6.2). **No other form forwards.** A tuple or record literal's components, a call's own result, and every other position synthesize exactly as before — an operator's operands included, with one channel that is not forwarding: at an arithmetic operation the expected-type lift governs, the operands take the operation's home type as their expected type, a widening channel Numeric Literals §5.1 owns entire. Forwarding through more forms is a compatible liberalization under the ordering pin below, adopted only on field evidence.

**Landing at a lambda.** Besides the operation home above (Numeric Literals §5.1's business), the expectation does nothing until it reaches a lambda literal — a match function included, being a lambda by desugar (Pattern Matching §6.7). There:

- If the expectation is a function type of the lambda's arity, each **unannotated** parameter takes the corresponding parameter component — and propagation adds no rigidity and removes none: a component that is an ordinary inferred type lands as one, and a component that is itself a declared variable (the seat's own rigid `a`; a constraint member's substituted subject) arrives as the rigid variable it already is. Rigidity remains the written contract's business (§4.1); propagation only carries it. The expectation's result component becomes the body's expected type, forwarded per the rules above. Components that are still undetermined variables land as what they are; landing is unification, not resolution.
- An **annotated** parameter keeps its annotation as the contract (§4.1, unchanged) and unifies with the expected component. A failure here is the seat's ordinary mismatch — the same unification the seat's final check would have failed — reported in the seat's own diagnostic family.
- If the expectation is **not** a function type of the lambda's arity — wrong arity, a non-function type, a type still undetermined at the seat — propagation **declines silently**: the lambda synthesizes as before, and whatever is wrong surfaces as the seat's existing diagnostic (the §5 arity error, the ordinary mismatch). Silent means silent: no diagnostic names propagation, in either outcome.

**The ordering pin — the schedule is the semantics.** Propagation performs early exactly the unifications the seat's final check performs anyway; that final check remains the typing authority, and propagation never invents types and never reports errors of its own. What it rides is a **normative elaboration schedule**: declarations top-down (§7.2), an application's callee first *unless the callee is a lambda literal*, then non-lambda arguments in source order, then lambda-literal arguments in source order, then a lambda-literal callee; operands left to right. The schedule is a checking order, not an evaluation order — runtime evaluation is the rewritten form's source order, its one recorded deviation Operators §8's bare-stage footnote, and the schedule reorders no effect. Elaboration order is observable through the judgments that read the substitution mid-schedule: **contextual widening** (Numeric Literals §5.1), whose targets read the substitution as the schedule built it, and Pattern Matching §6.1's abstract-scrutinee **refusal**, which reads the scrutinee's type at dispatch — so two programs differing only in the order of sibling expressions that share an undetermined variable may type differently, by design. That trade is made where F# made it — type-directed conversions defined against a fixed known-type checking order — and this schedule keeps the observable surface as small as a widening language's can be: a lambda literal's position **relative to its non-lambda siblings** is never observable (the deferred class elaborates after the first pass from any position), which no source-order schedule can say; among lambda literals, pass-2 source order is semantics, the same residue as the first pass's. Three consequences are normative:

- **Propagation is an ordering device, not a judgment.** A program's types are those its seats' unifications impose; the schedule fixes only when they are imposed. No diagnostic names propagation, in any outcome.
- **The written face wins.** A written contract is never silently narrowed. A row tail written open stays open (`export fun m(): {...a} -> {...a} = (r) => {...r}` faces the annotation it writes — §4.1's rigidity contract, kept); arithmetic under a written concrete numeric type runs *at* that type (Numeric Literals §5.1's expected-type lift — the same principle at the operation level). At a seat the schedule does not reach, a silent row collapse persists as the pre-existing defect it is, owned by #520, never by this section.
- **One boundary at operations, none elsewhere.** A propagated expectation that lands at an *arithmetic operation* as a concrete type is an established widening target — the operation's home type, operands widening in (Numeric Literals §5.1 owns the rule). Everywhere else an expectation is not an annotation: it establishes no value-widening target of its own and neither adds nor removes a defaulting decision — a variable propagation resolves is resolved to exactly what the seat's final unification would have imposed, so Numeric Literals §4 sees the same residue either way. The landing pair, deliberate: `let g: (Int) -> Float = x => x + x` compiles — the body's addition runs at `Float`, the written return type being the arithmetic's home — and `let g = (x: Int): Float => x + x` compiles identically, both emitting the JavaScript the `Int` addition would emit (`Float` erases to the same representation; Numeric Literals §5.2).

Pattern Matching §6.1's abstract-type refusal **stands unchanged**: a scrutinee whose type is a variable still cannot be matched. What changes is which programs reach it — a seat's expectation arrives before the arms are checked (possibly still undetermined, in which case the refusal fires as before), so the refusal is left to programs where no seat determined the type. For those, the refusal's report gains a rider when the scrutinee is a lambda parameter whose type is an *undetermined inference variable*, teaching the spellings this section makes work — Pattern Matching §6.1 owns the wording. A parameter whose type is a *declared* variable (rigid, §4.1) keeps the constraint-operations advice: its type is determined, and abstract by declaration.

**Conformance obligations** (the pins the suite owes; Pattern Matching §6.7's desugar-equality pins continue to hold, both spellings now succeeding together where a seat supplies):

- Each supplying seat accepts the guard-only numeric match function: the annotated `let` (`let sign: (Int) -> String = match …`), the argument seat subject-first (`Seq.map(xs, match …)`), the argument seat **callback-first** (`f(match …, xs)` at `f : ((a) -> b, Vector(a)) -> …` — the first pass resolves the instantiation from `xs`, the second hands the arms `Int`), the **dot call at a head-known receiver** (`xs.map(match …)` — Method Syntax §2.2's resolve-before-arguments order), the **pipe** (`total |> match …` at a determined `total` — in **both** §6.7 spellings), the ascription, the annotated `var` and `:=`, the constraint member body.
- Each forwarding form conducts: `if` branches, the `try` body block, `match`/`try` arm bodies, block-final, grouping.
- Non-forwarding stands: a match function as a **tuple component** of an annotated binding still declines (with §6.1's rider), pinning that tuple literals do not forward.
- Decline paths: arity mismatch at a supplied seat yields §5's ordinary arity error with no propagation artifact; a dot call whose receiver is **still unsolved at the dot** (a bare parameter receiver: `(v) => v.map(match …)`) declines — the goal pends, the arguments synthesize, and the arms see a variable, with §6.1's rider; a pipe whose piped value's type is itself still undetermined (`(v) => v |> match …`) declines the same way.
- Schedule pins, both directions each, all at **generic** callees so no expectation lands and the schedule alone decides (fixtures: `one : Int`, `half : Float`, `useFloat : (Float) -> Float`): the **deferred-lambda pair** — `fun outer(p) = f(x => useFloat(p), p + one)` at `f : ((a) -> b, c) -> …` and its argument-swapped mirror behave **identically**: the first pass types `p + one` at `Int`, and the lambda's `useFloat(p)` reports the ordinary mismatch (with §4.1's annotate-the-parameter guidance), whichever argument is written first — a lambda's position relative to non-lambda siblings is unobservable. The **callee-position flavours** likewise reject identically: `(p + one) |> (x => useFloat(p))` and `(show(p + one)) |> match` with an arm body reading `useFloat(p)` — arguments elaborate first. The **non-lambda sibling pair** pins the first pass's residue as spec: at `g : (a, a) -> …`, `g(p + half, p + one)` types `p` at `Float` (the second argument's `one` widening in) while the swapped `g(p + one, p + half)` rejects (`p` pinned exactly at `Int`, `half` reaching no target). The **lambda sibling pair** pins pass 2's residue the same way: at `f : ((a) -> b, (c) -> d) -> …`, `f(x => useFloat(p), y => p + one)` types `p` at `Float` while the lambda-swapped mirror rejects — source order within each pass is semantics. A bare unannotated binding — `let f = match` with its arms on the following lines — still refuses with the rider (no seat, and defaulting does not rescue a dispatch that fired mid-inference).
- The written-face lift's landing pair: `let g: (Int) -> Float = x => x + x` compiles, its body's addition running at `Float` and emitting what the `Int` addition would; `let g = (x: Int): Float => x + x` compiles identically (Numeric Literals §5.1's lift, both faces written; §5.1's own conformance pins cover the lift's observable cases).
- Pipe stability: a literal-heavy pipe match (`someNat |> match` with constructor or literal patterns) keeps compiling argument-first, at the same types — the patterns fixed the type before and fix it still.
- Schedule-stability spot-checks: representative programs outside the schedule pins' race class keep their inferred schemes verbatim across the order migration.

---

## 5. Application and arity

```
f()          -- call with zero arguments
f(x)         -- one argument
f(x, y)      -- two arguments
```

- Parentheses at the call site are **required**. There is no juxtaposition application.
- **Arity mismatch is a compile-time error**, reported directly: "`f` expects 2 arguments, got 1." Unification of function types checks arity first, then unifies parameters pointwise.
- **No partial application.** Wrap in a lambda: `y => f(1, y)`.
- **No placeholder shorthand** (`f(_, 2)` etc.). None; the completed FFI did not reopen this, and no other pressure has.
- **No splatting / no tuple application.** Given `let t = (3, 7)`, the call `plus(t)` is an arity error (one argument supplied, two expected). Parameter lists *resemble* tuples but are not tuple values; there is no implicit conversion in either direction. Someone holding a tuple destructures it: `let (x, y) = t` then `plus(x, y)` (Pattern Matching §6.3).
- **No optional, default, or named parameters** in pure Hexagon functions. The extern boundary's handling of optional slots and `Nullable(a)` is FFI-owned (ffi.md; `Nullable` is FFI Part 2); optional/default parameters, rest/variadics, and overloads at the boundary are recorded post-v1 FFI deferrals (ffi.md §9.2 — FFI Part 4 §11, Part 6 §8). Nothing there leaks into pure Hexagon function semantics.

### 5.1 Displayed function types

Compiler-facing type displays — hovers, diagnostics, inferred-type views, and documentation signatures — use right-associative arrow notation with a zero/one/many parameter distinction:

```text
read    : () -> String
greet   : String -> String
combine : (String, String) -> String
apply   : (String -> String) -> String
```

- A zero-parameter function uses `()` as its domain.
- A one-parameter function uses the parameter type directly: `A -> B`, never `(A) -> B`. There is no one-item tuple or one-item parameter-list type.
- When that one parameter is itself a tuple, its tuple parentheses are grouped once
  more so arity remains visible: `((A, B)) -> C`. Without the outer grouping,
  `(A, B) -> C` is the distinct type of a two-parameter function.
- A function with two or more parameters uses a parenthesized, comma-separated parameter list: `(A, B) -> C`.
- `->` associates to the right. Parentheses around a function type are therefore grouping, as in `(A -> B) -> C`; they are not retained merely because a function has one parameter.
- *(#355; respelled #405.)* **Every arrow carries its effect colour**, and the display renders the trio: `->` pure, `->?` this signature's linked effect variable, `->!` the impure constant (Effects §2, the owner of the readings). The three are one arrow under the same zero/one/many grammar, differing only in the mark they carry — the call trichotomy's own marks:

  ```text
  fold            : (Seq(a), b, (b, a) ->? b) ->? b
  withTransaction : (String ->? String) ->! String
  Stream.next     : Stream(a) ->! Option(a)
  ```

  All three arrows associate and group identically; a display never omits a colour, since silence is the pure claim (Effects §1). The same arrows are legal in source annotation positions under the same grammar, subject to Effects §2.2.1 — `->?` needs a signature with an inlet. One caveat rides `->?`: an inferred face can carry more effect variables than the written grammar can spell apart, and the display numbers those — Effects §10 owns the rule.
- *(#410.)* **A constrained scheme displays its constraints source-shaped**: §4.2's binder bracket, prefixing the type, set off by one space.

  ```text
  parse   : <a: Show> Int -> a
  bump    : <a: (Num, Show)> a -> a
  both    : <a: Show, b: Show> (a, b) -> String
  ```

  Grouping uses §4.2's conjunction form, so one variable's several constraints share one entry. Entries follow the display's variable-letter order — the order the variables occur in the type, which is where the letters come from — and conjuncts within an entry order **alphabetically by constraint name**, matching the evidence suffix's second key (FFI Part 9 §6.2). The order constraints happened to be written or accumulated in is no more visible here than it is in the ABI.

  The display is a **canonical** face, so it shows the head's binder order no more than it shows the accumulation order: `<b: Show, a: Show>(x: a, y: b)` and `<a: Show, b: Show>(x: b, y: a)` both display `<a: Show, b: Show> (a, b) -> String`, as does the binder-less spelling (§4.2.1). Across variables it therefore does not track the suffix, whose ordinal is a **declared** position (Part 9 §6.2, §6.2.1) — the two faces answer different questions, and coincide exactly when a head is spelled in the order its variables occur in the type. Nothing depends on the coincidence: the ABI is read off the declaration, never off a display.

  Unconstrained variables are unmentioned (bare `<a>` is never canonical, §4.2), and a constraint-free scheme shows no bracket. In source the bracket glues to what follows, because what follows is the parameter list it binds into; a display has no parameter list — the bracket is a quantifier prefix on a complete type — and the space is what marks the difference. The honor head exhibits both spellings in one line: `honor<a: Show> Show<Vector(a)>`. The bracketed face *as a whole* is machine-written notation, since an annotation cannot carry a binder list (§4.2's position restriction), under exactly the licence effect numbering has (Effects §10): a display marks what the grammar cannot express. Every *piece* of it is nonetheless a verbatim source spelling, and the bracket pastes onto a declaration head unchanged.
- This notation describes Hexagon types. TypeScript declaration output separately follows TypeScript grammar and therefore retains `(name: A) => B`; the colour crosses as a generated documentation line carrying the Hexagon face (Effects §10).

The internal representation remains genuinely n-ary: `TFun([], R)`, `TFun([A], R)`, and `TFun([A, B], R)`. This display rule does not encode unary functions as a special semantic form.

### 5.2 The SML reading (rejected — do not re-litigate)

The natural wrong answer, reached independently by readers who know ML: *"a
function is a machine from input to output, so it cannot take nothing; a
nullary function must take `unit`."* F# and OCaml do spell nullary as
`unit -> T`, because ML has no true zero-ary functions. **Hexagon departed
deliberately, and the departure is load-bearing** — it is what buys n-ary
JS-native emission.

The two are distinct types with distinct calling conventions, visible in the
emitted JavaScript:

```
let thunk: () -> Int = () => 5          -- emits `() => 5`;  called `thunk()`
let taking: Unit -> Int = value => 5    -- emits `value => 5`; called `taking(())`, i.e. `taking(undefined)`
```

So the model is a legitimate way to *teach* the surface syntax — `()` for the
nullary case, no 1-tuples, tuple-shaped parameter lists (§1) — and Primitive
Types §9's remarks about `()` are consistent with it. It must not be encoded:
function types are n-ary, calls are checked by arity, and no unit value is
passed to `f()`. §5.3 states the law and the diagnostics that enforce it.

Blessing an equivalence between the two is **rejected**: it would require
hidden adapters wherever one flows into the other, breaching §5's
arity-checked-first rule, the readable-JS goal, and FFI Part 6's identity
calling convention — and it would be the language's only implicit conversion
between distinct types.

Making the empty domain a type of its own was considered and **deferred
post-v1**. The unary reading is not a bolt-on: it is the keystone of a
different design, in which every function takes exactly one thing and `unit`
is the type invented so that "nothing" can be one. Buying its abstraction —
`a -> b` ranging over thunks too — means buying its calling convention, which
§1 declines. The form worth exploring instead is **polymorphism over parameter
lists**, one feature serving both arity abstraction and the FFI variadics
recorded as a post-v1 deferral (ffi.md §9.2); a pseudo-type for the zero case
alone would be all of that machinery for the least valuable point on the curve.
Revisit bar: demonstrated demand for generic thunk-accepting combinators, or
FFI variadics landing — whichever comes first. Until then the seam is crossed
by the eta-wrap (§5.3).

### 5.3 Nullary functions and `Unit`

- `() => body` is a **zero-parameter function**. No argument (unit or otherwise) is passed; emitted JS takes no parameters.
- **A thunk's type is written `() -> T`, never `Unit -> T`.** The two are
  different types: `() -> T` takes no argument, `Unit -> T` takes one argument
  whose type happens to be `Unit`. Writing `Unit` in parameter position is legal
  but never canonical (`canonical-formatting-and-naming.md` S10).
- `Unit` appears in this spec only as a **return type** for effect-only functions: `let log(msg: String): Unit = ...`. Its literal `()`, JS representation (`undefined`), and constraint memberships are fixed in Primitive Types §9. A `Unit`-typed *parameter* is not written by hand; it arises from instantiating a generic at `Unit`.
- **Generics cannot abstract over arity.** A type variable ranges over types, and
  a zero-ary domain is not a type, so `a -> b` never unifies with `() -> b`. A
  thunk therefore cannot be passed where `a -> b` is expected; the bridge is an
  eta-wrap that gives the callee its one argument:

  ```
  let apply(transform: a -> b, value: a): b = transform(value)
  let five(): Int = 5
  let result = apply(_ => five(), ())     -- not `apply(five, ())`
  ```

  This seam is narrow — it appears only where a thunk meets a fully generic
  function slot — but it is a real cost of n-ary functions and is stated rather
  than left to be discovered.
- The parser must keep `()` (unit literal / nullary call syntax) unambiguous against grouping parens; coordinate with the Products spec rather than special-casing.

### 5.4 Parameter order convention

Because the pipe operator inserts its left operand as the **first argument** of the call on its right (Operators §8), the standard library and idiomatic user code put the "subject" — the value being operated on — **first**: `map(xs, f)`, not `map(f, xs)`. This spec records the convention; Operators §8 makes it normative for the prelude and stdlib, and Method Syntax §4.2 additionally makes subject-first determine dot-callability.

---

## 6. `let` is non-recursive

Inside the RHS of `let x = ...`, any reference to `x` — at any nesting depth, **including inside lambdas** — is a compile error:

> `x` is not in scope in its own `let` definition; `let` is non-recursive — use `fun`.

Implementation: a **pending-binder stack** in the name resolver. The binder name is pushed while its RHS is resolved and added to the environment only afterward; a lookup that hits the pending stack produces the targeted diagnostic above rather than a generic "unbound name." (`var` reuses the same mechanism and diagnostic family — Statements §6.1.)

Consequences:

- `let` permits no shadowing games via self-reference; the name simply does not exist yet — for *reference*. Against *rebinding* it is reserved: a sequential binder in the RHS may not claim the pending name (`let y = ...` whose block opens `let y = 5` is an error — Statements §5.1), while head binders may as ever (Statements §5.1 rule 2).
- Recursion, including through a lambda (`let f = n => ... f(n-1) ...`), is impossible with `let` by design. This is what `fun` is for.

---

## 7. `fun`: recursive, grouped, syntactically restricted

### 7.1 RHS restriction

The RHS of `fun` **must be syntactically a lambda literal** — written directly (`fun f = (n) => body`), via header sugar (`fun f(n) = body`), or as a match function (Pattern Matching §6.7 — a lambda literal in written form, evaluating nothing at bind time). Anything else is a compile error:

```
fun f(n) = body            -- allowed (header syntax)
fun f = (n) => body        -- allowed (lambda literal; identical AST, identical emission)
fun x = 5                  -- error
fun fib = memoize(...)     -- error
```

The check is **syntactic** (is the RHS node a lambda?), not semantic ("is this expression of function type?") — the latter cannot be checked before evaluation, which is exactly what group binding must avoid.

Rationale: a `fun` group's members are all bound before any member's body can run (§7.3 — mutual visibility requires it), which is only sound if creating each member requires **zero evaluation**. A lambda literal has that property; `memoize(...)` does not — it would have to *run* first.

### 7.2 Declarations are read top-down

Every term binding — `let`, `var`, `fun`, and every term-namespace name an `import` item binds (Modules §3) alike — is usable only **after** its declaration. There is no hoisting: dependencies sit above their dependents, and a file reads in the order it evaluates. The one exception is the inside of a `fun` group (§7.3), whose members see each other.

The law is uniform across module top level and inner blocks, and it governs every kind of reference — a bare name, and equally a dot call, which is a reference to the operation it dispatches to (Method Syntax §4.4). It also governs every term-namespace name a type-namespace declaration binds — a union's or record's **constructors**, an `exception`'s constructor, a `constraint`'s **members** — in **value position**: `Box({value = 1})` above `record Box` is the same declared-later error as any other. A *type-position* reference (`b: Box`) is free, per the declarations' own order-insensitivity (Declarations Preamble §7.2). A **pattern-position** constructor (`Red =>`, a `catch` arm's exception) obeys the top-down law like a value-position one: a `match` sits below the union it inspects, and one rule covers every term-namespace mention that is not a type. An instance member body is an ordinary reference site under this law; the `honor` declaration's placement freedom is its own, and the evidence it emits is ordered by Constraints §6.3 (below).

```
let use: Int = twice(3)        -- ERROR: `twice` is declared later in this block;
                               --   declarations are read top-down — move its
                               --   declaration above this use
let twice(n: Int): Int = n * 2

let twice(n: Int): Int = n * 2
let use: Int = twice(3)        -- fine
```

Consequences:

- **The emitted JavaScript can never trip a temporal-dead-zone error.** The guarantee has two legs. Term bindings and value-position constructor and member references are safe by enforced source order — the ordering the compiler enforces is the ordering the emitted module evaluates, with no capture analysis and no transitive initialization checks. Evidence — instance dictionaries and factories, the term-level artifacts whose declaration (`honor`) carries no source-ordering law — is safe by emission position: constructing it evaluates nothing, and it is emitted before all term bindings (Constraints §6.3).
- Type-namespace declarations are untouched: `record`, `union`, `type`, `constraint`, `honor`, and `exception` remain order-insensitive among themselves per Declarations Preamble §7.2. What obeys this section is the *value-position use* of the term names they bind, per the paragraph above.
- A reference to a name that is declared *later in the same block* is not a bare "unknown name": the resolver knows where the declaration sits and says so (§10).

### 7.3 Mutual recursion: contiguous `fun` groups

An **unbroken run of `fun` declarations** — no other item between them — forms a **group**. Inside the group, every member's body sees every member, earlier and later alike. This is the language's only forward visibility among terms, and it exists because mutual recursion cannot be spelled without it. A lone `fun` is a group of one — its self-visibility (§3.3) is this same rule at its smallest. An *item* here is any declaration or statement of the enclosing block or module; modifiers (`export`) and attached doc comments ride their declaration, so `export fun` continues a run.

```
fun even(n: Int): Bool = if n == 0 then True else odd(n - 1)
fun odd(n: Int): Bool = if n == 0 then False else even(n - 1)   -- one group; mutual references fine
```

- **Any non-`fun` item ends the run.** Splitting a group breaks recursion between the halves: the earlier half can no longer name the later. The forward reference gets §7.2's declared-later diagnostic, extended with the group rule — only an unbroken run of `fun`s recurses together; move the intervening item out of the run (§10).
- Comments — doc comments included — do not split a group; only items do.
- To code outside it, a group is ordinary: members are usable after their declarations, per §7.2. (Equivalently, after the group — nothing else can sit between members.)
- **Grouping bounds visibility, not typing.** The monomorphic knot of §7.4 is still the strongly-connected component of actual references, computed within the group and typed dependencies-first. Two adjacent but independent `fun`s do not restrict each other's generality; a contiguous run is not one typing unit merely by adjacency.

### 7.4 Recursion is monomorphic

`fun` accepts type parameters freely and generalizes like `let` (§8). But **recursive calls — direct or mutual, within the SCC (computed within the group, §7.3) — are at the definition's own monomorphic type**; no polymorphic recursion. This requires no special enforcement: within the SCC the function's type is a not-yet-generalized monotype, so a recursive use at a different instantiation fails ordinary unification. Generic recursive functions (`map`, `fold`) work fine — the *outside world* instantiates them freshly; only the recursive knot is monomorphic.

### 7.5 Memoized recursion (the one restricted pattern)

`memoize` itself is an ordinary higher-order function and fully writable in Hexagon; `let cheap = memoize(expensive)` is unremarkable. The only restricted pattern is the self-referential one-liner `fun fib = memoize((n) => ... fib ...)` — rejected by §7.1, for the same reason OCaml's `let rec` rejects non-lambda RHSes. The blessed idiom is **open recursion**: write the function taking "itself" as a parameter, and tie the knot with a `memoFix` combinator (a v1 listing obligation at `stdlib-roadmap.md` §2; fully expressible in Hexagon):

```
fun fibOpen(self, n) = if n <= 1 then n else self(n - 1) + self(n - 2)
let fib = memoFix(fibOpen)
```

(`memoFix` builds a map, defines a local `fun go(n)` that consults the map and calls `f(go, n)` on miss, and returns `go` — all expressible under these rules.) The spec-level summary: Hexagon supports memoization of any function and memoized recursion via open recursion; it rules out only the self-referential single binding.

---

## 8. Generalization (observable rules)

The inference engine uses Algorithm J with union-find type variables and level-based generalization. This section fixes the observable behavior; detailed compiler architecture is outside the language surface:

1. **Generalization happens at `let`/`fun` bindings** (and at module export, per the Modules spec). A generalized binding is polymorphic; each *use* instantiates fresh type variables.
2. **Value restriction (ML-style; list completed and rationale corrected 2026-08-01, #205 — closure doc `decisions-ml-dialect-generalization-2026-08.md`):** a `let` RHS is generalized in full **only if it is a syntactic value** — a lambda literal, a literal, a **reference (possibly module-qualified) to an immutable term binding** (a `let`, a `fun`, a parameter, a pattern binder, or an import — never a `var` read, which is a state observation, not a value; closure doc §2.3), a constructor application of values, a **record literal whose field values are values**, or a tuple of values. A function *call* is not a value. Given any generic producer — say a local `fun makeEmpty() = []`, of type `() -> Vector(a)` —
   ```
   let xs = makeEmpty()
   ```
   `xs` is not condemned to monomorphism by this item alone: item 7's relaxed rule governs every non-value RHS and generalizes exactly the unconstrained, covariant-only variables — for `xs`, all of them, `Vector(+a)` being a compiler-side claim (closure doc §5.3; a parameterized type with neither a written claim nor a table row is invariant, and its variables are declined). A variable item 7 *declines* — constrained, or occurring in a non-covariant position — gets an unsolved monomorphic `?1`; the first use fixes it, permanently, and the diagnostic for a later conflicting use points at the **pinning use**, never "the body" (§10, #206). (A variable refused by *levels* is a different creature: it belongs to the environment and was never this binding's to solve.)

   Rationale, corrected (2026-08-01, #205; the prior text here blamed mutation and effects): the classic ML hole — an effectfully produced mutable cell generalized polymorphically — is *inexpressible* in Hexagon (Statements §6.4: no ref cells, no mutable fields; §6.2: `var` crosses no lambda boundary), and no foreign call returns a type containing a variable (FFI Part 4 §12.4 — a coupling recorded in the closure doc §3: lifting that deferral must revisit this rule). What the restriction actually guards is **constraint coherence under the evaluate-once rule** — it is Hexagon's monomorphism restriction. Generalizing an expansive *constrained* binding (`let y = double(42)` at `<a: Num> a`) would force either one shared computed value used at several representations (incoherent: the computation is representation-sensitive) or evidence abstraction re-running the RHS per use (observably breaking "a binding evaluates once"). Literals escape the dilemma — their elaboration `fromNat(payload)` re-runs per use and the lexer's range cap keeps every instance exact (Numeric Literals §3, §5) — which is why they are values and computations are not. The workaround for a declined variable is the familiar ML one: call the producer where the element type is known, or annotate.

   **"In full" is bounded by the evidence seat** *(added 2026-08-01, #205/#207 round 3 — closure doc §13.6)*: evidence has exactly one seat, the trailing parameter suffix of a function (Constraints §6.1), so a value binding quantifies a **constrained** variable only when the type of the binding's **one evaluated value — the right-hand side as a whole, never a component a pattern projects from it** *(reading corrected 2026-08-02, closure doc §13.6 round 4)* — is a function type. At a value binding of any other type — a record literal, a tuple, a constructor application; the rule keys on the evaluated value's *type*, never the RHS's syntactic form — a variable still carrying constraints after Numeric Literals §4's defaulting (which runs first, unchanged: its "would otherwise be quantified" test is answered before this rule speaks, so `let x = 42` still defaults at its own binding) is **declined**: an unsolved monomorphic `?n`, first-use-pins-it, item 7's own fallback. So `let g = describe`, with `describe : <a: Tag> (a) -> String`, generalizes — `g`'s own type is the function the suffix rides (§9's bare-reference emission) — while `let holder = { f = describe }` pins `a` at the first use of `holder.f` and emits with the concrete instance, exactly as when the record row was not yet on the list. A **destructuring** `let` therefore never quantifies a constrained variable *(2026-08-02, closure doc §13.6 round 4)*: the seat is read at the scrutinee — the one value the binding evaluates — and a pattern that destructures presupposes a non-function scrutinee, functions having no components. At `let (g, n) = (describe, 1)` the aggregate is allocated once and `g` names a projection of that allocation, so there is no per-instantiation construction for evidence to ride: every constrained variable declines and pins, for every name the pattern binds, `as` names and arbitrary nesting included, while unconstrained variables in the same components still generalize in full (`let (e, n) = (Seq.empty, 1)` gives a polymorphic `e`; the same is promised for constructor-pattern components — `let Box(e) = Box(Seq.empty)` — but not yet delivered, a pre-existing checker defect, #213 *(recorded 2026-08-02, closure doc §13.6 round 5)*). A pattern that is, after read-through, a bare binder over a function-typed RHS keeps the seat — it names the constructed value itself. The scheme this rule refuses to build, a non-function carrying residual constraints, is one the language has no representation for; the refusal is this rule at the binding, **never** an emission-time diagnostic (closure doc §13.6's invariant, restated 2026-08-02: every scheme with a nonempty residual constraint set describes the binding's entire evaluated value — the binder carrying it names that value itself, never a pattern component — and that value's type is a function type). Unconstrained variables are untouched — `let r = { pull = () => None }` generalizes in full. An **annotated** value binding — equally an unannotated one whose right-hand-side ascription declared the rigid variable (Ascription spec §3.1); the arm keys on the variable's declaredness, not the binder's own annotation — whose rigid variable this rule declines is a hard error at the declaration, §4.1's family (§10's row; exports inherit it via their mandatory signatures, Modules §4.1.1); the annotated arm has no *annotation-syntax* destructuring case — annotation syntax is the bare binder's alone, and the grammar rejects an annotation after a `let` pattern ("expected `=` after `let` pattern") *(corrected 2026-08-02, closure doc §13.6 round 5: a clause here previously keyed the error on the scrutinee of a binding the grammar cannot produce)* — but an RHS **ascription** can declare a rigid variable under a destructuring `let` (Ascription spec §3.1), and a declared variable the destructuring sentence would otherwise pin is the same hard error: a rigid variable can neither be quantified nor pinned; a fully concrete annotation leaves no residual constraint, and the rule never fires.

   **The test reads through pure wrappers.** It asks what the RHS *means*, not what punctuation surrounds it. Parentheses only group, an ascription only pins a type without evaluating (Ascription spec §3 — an ascription of a syntactic value is a syntactic value), and a RHS written on the following line only opens a block holding that one expression (Lexer & Layout §2.1) — so

   ```
   let id = (x) => x
   let id = ((x) => x)
   let id =
       (x) => x
   ```

   are one binding written three ways, and all three generalize. Every other rule that reads what a RHS *means* reads it the same way: the exported-signature check (§4.1), the evidence a constrained binding carries (Constraints §6.1), and the emitted shape (§9). Layout is layout; it does not decide whether a binding is polymorphic. §7.1 is the one rule that does not read through, and it asks a different question — what a `fun`'s RHS *is*, on which group binding depends — so it refuses a wrapped lambda literal in either spelling.

   **A block of more than one item is not read through**, and is not a value even when its final expression is a lambda:

   ```
   -- load : () -> Table(k, v),  find : (Table(k, v), k) -> v,  Table transparent
   let lookup =
       let table = load()
       (key) => find(table, key)     -- key's type: pinned by first use (contravariant);
                                     -- the result type: generalizes (item 7)
   ```

   Its earlier items run when the binding is bound, and code that has already run is precisely what *full* generalization is withheld from — the symmetry with §7.3's group visibility noted at the end of this section. Item 7 still applies per variable *(revised 2026-08-01, #205)*: here the argument variable occurs contravariantly and is pinned by the first use, while the unconstrained result variable generalizes — soundly, because the once-loaded table, typed with no known element type, can by parametricity contain no elements (closure doc §4.4). The rewrite for a pinned variable is the ML one again: lift the earlier items into the enclosing block, where they are bound once and what remains on the right-hand side is a lambda, hence a value.
3. **`fun` generalizes exactly like `let`** — its RHS is always a lambda (§7.1), hence always a value, so `fun` bindings always generalize. Recursive uses are monomorphic per §7.4.
4. **`var` never generalizes — and nothing else may generalize a `var`'s type** *(completed 2026-08-01, #205/#207)*. The first half is its own rule, independent of the value restriction — see the Statements, Blocks & Mutability spec for `var` in full. The second half is what item 7 makes necessary to state: the variables of a `var`'s monotype belong to the environment for the whole of the `var`'s scope, so no binding in that scope — item 2's values and item 7's expansive bindings alike — may quantify them, and any use anywhere in the scope, an assignment included, pins them (Statements §6.1's first-use-pins rule, unchanged). The case that forces the sentence: `var v = Seq.empty`, then `let e = v` — an expansive binding, since a `var` read is not a value (item 2) — with `e` used at two element types and `v` later assigned. Before item 7 no expansive binding quantified anything, so the alias could not leak the `var`'s unsolved variable; now item 7 must **decline** it, or the later assignment pins a variable `e`'s scheme had already quantified — one shared, assignable binding observed at several types at once. Levels are the mechanism (the `var`'s variables sit at its owning block's level, hence in every inner binding's environment); the observable rule is this item's, and a conflicting later use gets the pinning-use diagnostic (§10).
5. **Lambda parameters are monomorphic within their scope.** Inside `(f) => ...`, the parameter `f` has one type per instantiation of the enclosing function; it cannot be used at two different types. The classic demonstration:
   ```
   let id = x => x
   (id(1), id("a"))                    -- fine: id is let-bound, each use instantiates fresh

   let apply = f => (f(1), f("a"))     -- ERROR: f is lambda-bound, monomorphic;
                                       -- cannot be both Int -> ? and String -> ?
   ```
   This is HM's let-polymorphism / lambda-monomorphism split and is the single most surprising rule for the target audience; diagnostics should be written with care here.
6. Header sugar and explicit-lambda forms generalize identically **by construction** (one AST node, §3.2).
7. **The relaxed rule *(added 2026-08-01, #205; Garrigue's relaxed value restriction, with a clause OCaml never needed)*:** a `let` RHS that is **not** a syntactic value still generalizes, **per variable**, exactly those type variables of the binding's inferred type that are **(a) unconstrained** — the variable does not occur free in the argument of any residual constraint of the binding (compound arguments included: `Show(Vector(?1))` constrains `?1`) — **and (b) covariant-only** — every occurrence is in a covariant position under the variance analysis (closure doc `decisions-ml-dialect-generalization-2026-08.md` §5: transparent constructors inferred, opaque constructors per their declared claims — Modules §4.2.1 — compiler-known constructors per the compiler-side claim table, closure doc §5.3; `->` flips its argument position) — level admission as always. Every other variable stays an unsolved monomorphic `?n`, first-use-pins-it, per item 2; defaulting does **not** fire on a clause-(a)-declined variable's account — item 7's decision *is* Numeric Literals §4's "would otherwise be quantified" test (closure doc §4.4). An **annotated** expansive binding (ascription-declared rigid variables included — Ascription spec §3.1) puts its rigid variables through the same three clauses: all pass and the binding generalizes; any declined is a hard error at the declaration in §4.1's diagnostic family — a rigid variable can neither be quantified nor pinned — with exports inheriting the error through their mandatory signatures (Modules §4.1.1; closure doc §4.1). Soundness rests on three legs, each normative elsewhere: parametricity of pure Hexagon code (exception payloads admit no type variables — Exceptions §2); monomorphic foreign externs (FFI Part 4 §12.4 — lifting that deferral must revisit this item); and the intrinsic parametricity obligation (`intrinsics.md` §4.2). Clause (a) is load-bearing and is Hexagon's own — OCaml ships this rule without it because OCaml has no constraints; dropping it would reopen item 2's coherence dilemma. Decided; do not re-litigate (closure doc §4.3, §9.5).

There is a pleasing symmetry the implementer can lean on: group visibility (§7.3) and *full* generalization (§8.2) are both privileges of syntactic values — of code that has not executed yet. Item 7's remainder is bounded precisely by what already-executed code can never contain: an element at a type nothing could have produced *(sentence adjusted 2026-08-01, #205)*. Values' privilege carries one bound of its own kind — item 2's evidence-seat rule *(2026-08-01, #205/#207)* — because value-ness is a fact of *timing* and the seat is a fact of *representation*: no amount of not-having-run gives a record somewhere to carry a dictionary.

---

## 9. JS emission

Readable, idiomatic output is a language goal; emission shape is part of the contract.

| Hexagon | JS |
|---|---|
| `fun f(n) = body` / `fun f = (n) => body` | `function f(n) { ... }` — a function declaration |
| `let f = () => body` / `let f() = body` | `const f = () => ...` at its textual position |
| `let f = x => body` / `let f(x) = body` | `const f = x => ...` at its textual position |
| `let f = (x, y) => body` / `let f(x, y) = body` | `const f = (x, y) => ...` at its textual position |
| anonymous lambda in expression position | JS arrow function |
| `f(x, y)` | `f(x, y)` — n-ary call, no tuple/array allocation, no spread |
| `let log(msg): Unit = ...` | a JS function that simply returns nothing (`Unit` ↔ `undefined`, Primitive Types §9; `void` in `.d.ts` return position) |

Notes:

- The `fun` → `function` mapping is sound *because of* §7.1: the lambda-literal restriction guarantees the RHS is evaluation-free, so a group's members all exist before any member's body runs — which is what §7.3's mutual visibility needs. JavaScript hoists `function` declarations further than the language grants, but §7.2's top-down law means no conforming program can observe the difference, and no reference can trip a TDZ error at runtime.
- The same lambda AST node emits differently depending on its binding (`function` under `fun`, `const` + arrow under `let`); the emitter dispatches on the binding form, not the RHS shape.
- Arrow emission preserves the zero/one/many visual model: `() =>` for no parameters, `x =>` for one, `(x, y) =>` for several. A grouped unary source lambda, `(x) =>`, and unary header sugar, `f(x)`, therefore emit the canonical `x =>` form; the redundant grouping is not preserved. TypeScript function types still use their grammatically required parenthesized parameter list in `.d.ts`.
- Names pass through unchanged when legal as JavaScript bindings. JavaScript reserved-word collisions use deterministic `__`-prefixed locals; Lexer §3 owns that reserved prefix.
- *(Added, #205/#207.)* A binding whose RHS is a bare reference to a **constrained** function emits the bare reference — `let twice = double`, with `double : <a: Num> (a) -> a`, emits `const twice = double;` — whenever the binding discharges none of the reference's constraints; every consumer appends the same trailing evidence suffix it would have appended to the original. Constraints §6.1 owns the rule and its boundary with the evidence-in-scope case, which still eta-expands.

---

## 10. Diagnostics checklist (implementer-facing)

Diagnostics obey the Rewrite Rule (Declarations Preamble §1.1): where a legal spelling of the intent exists, the error names it.

| Situation | Error |
|---|---|
| Uppercase-start function/binding name | hard error: term bindings require a non-uppercase-start name (§2) |
| Self-reference in `let` RHS (any depth) | "`x` is not in scope in its own `let` definition; `let` is non-recursive — use `fun`" (§6) |
| `fun` RHS not a lambda literal | error, syntactic check (§7.1) |
| Value- or pattern-position reference to a term name declared later in the same block — binding, constructor, or constraint member; any reference form | "`twice` is declared later in this block; declarations are read top-down — move its declaration above this use" (§7.2; the dot-call phrasing is Method Syntax §4.4/§9's) |
| Forward reference to a `fun` across a group split | the declared-later family, extended: "only an unbroken run of `fun`s recurses together; move the intervening declaration out of the run" (§7.3) |
| Dot call targeting a member of the caller's own `fun` group | Method Syntax §4.4/§9 own it — "a dot call cannot target its own `fun` group; spell the call by name: `twice(b)`" |
| Lambda (hence any `fun` body) **reads** an outer `var` | Statements §6.2/§9.3 own it — "`shift` is a `var` and cannot be used inside a lambda; copy it to a `let` first: `let s = shift`" |
| Lambda (hence any `fun` body) **assigns** an outer `var` | Statements §6.2/§9.3 own it — "…cannot be updated inside a lambda; use a `for` loop for mutable iteration, or have the lambda return the updated value and assign it outside" |
| Call with wrong number of arguments | "`f` expects N arguments, got M" (§5) |
| Passing a tuple where multiple arguments are expected | arity error (§5); consider a hint suggesting destructuring |
| `() =>` meets a `Unit -> T` annotation, or a unit-typed parameter meets `() -> T` | "`Unit -> T` takes a unit *value*; a zero-parameter function is `() -> T`" + the corrected annotation (§5.3) |
| A zero/one arity mismatch where the parameter is not known to be `Unit` | say what is provable without claiming `Unit`: "expected a zero-parameter function, but this one takes a parameter; write `() => ...`", or the eta-wrap row below (§5.3) |
| `f()` where `f: Unit -> T`, or `f(())` where `f: () -> T` | "`f` takes one unit argument; write `f(())`" / "`f` takes no arguments; write `f()`" (§5.3) |
| A thunk passed where `a -> b` is expected | "a zero-parameter function cannot be passed where a one-parameter function is expected; generics do not abstract over arity, so wrap it: `_ => thunk()`" (§5.3) |
| `((x, y)) => e` written meaning two parameters | Pattern Matching §6.5 owns it — "one parameter destructuring a tuple; remove the outer parentheses for two parameters" |
| Polymorphic recursion | ordinary unification failure at the recursive call site (§7.4); consider a hint when the failing call is a self/SCC reference |
| Lambda parameter used at two types | unification failure (§8.5); diagnostic should distinguish this from other type errors if feasible |
| A use conflicts with a type pinned by an earlier use of a binding's undergeneralized variable | the error points at the **pinning use** ("`e`'s element type was fixed to `BigInt` by this earlier use") and never claims the binding's *body* required the type (§8.2/§8.7; #205, #206) |
| Annotated (incl. exported; ascription-declared variables included — Ascription spec §3.1) expansive binding whose declared variable item 7 declines | hard error at the declaration, naming the clause that fired: "`a` is a declared type variable, but this right-hand side is a computation that cannot be generalized in `a` (`a` is constrained by `Num`)" / "(`a` occurs in argument position)"; "bind where the type is known, or remove the annotation" (§8.7, §4.1 family; Modules §4.1.1; #205) |
| Annotated (incl. exported; ascription-declared variables included — Ascription spec §3.1) **value** binding whose declared variable the evidence-seat rule declines (§8.2) | hard error at the declaration: "`a` is a declared type variable, but a binding whose type is not a function cannot carry its `Tag` constraint — evidence rides only a function's trailing parameters; annotate at a concrete type, or remove the annotation" (§8.2, §4.1 family; Modules §4.1.1; #205/#207, closure doc §13.6) |
| Declared type variable forced to a concrete type | "`a` is a declared type variable, but the body requires `Int`; change the annotation to `Int`, or remove it to let the type be inferred" (§4.1) (ascription-declared variables: the report is worded for that spelling — Ascription spec §5) |
| Body requires a constraint not entailed by the written constraint list | "`a` is declared to honor `Eq`, but the body requires `Hash`; write `<a: Hash>`, or remove the constraint annotation to let it be inferred" (§4.2) |
| `<...>` type parameters on a lambda outside `let`/`fun` RHS position | parse error (§4.2) |

---

## 11. Deferred / cross-references

- **Tuples and destructuring**: Products spec (tuple values, no 1-tuples, `()` as the nullary case) and Pattern Matching (destructuring in every binding position). This spec depends only on: no 1-tuples, `()` is the nullary case, no tuple↔argument-list conversion.
- **Operators**, including `|>` first-argument insertion: Operators §8. This spec contributes only the subject-first parameter-order convention (§5.4). Note for reading the examples: Hexagon prefers English logical operators (`not`, `and`, `or`, `implies`, `iff`) and uses `if ... then ... else ...` as its conditional expression — there is no C-style `? :` ternary (Operators spec).
- **Constraints** (`Num`, `Signed`, `honor`, base constraints): Constraints spec. This spec fixes only the `<a: C>` / `<a: (C1, C2)>` syntax (§4.2).
- **FFI** (complete; `ffi.md` is the entry point): `Nullable(a)` and boundary conversions are FFI Part 2; extern functions and bindings are Part 4; the boundary calling convention for functions and callbacks (identity convention, exact arity, `Unit` discarding) is Part 6; optional/default parameters, rest/variadics, and overloads at the boundary are recorded post-v1 deferrals (ffi.md §9.2). Nothing there leaks into pure Hexagon function semantics.
- **Polymorphism over parameter lists** (a type variable ranging over a *sequence* of parameter types, so one signature covers `() -> b`, `Int -> b`, and `(Int, String) -> b` alike): **post-v1**, recorded in §5.2. It is the form worth exploring for arity abstraction, and the same feature FFI variadics would need; a pseudo-type for the zero-ary domain alone is rejected in its favour. Until then, the seam is the eta-wrap (§5.3).
- **Constraint display in tooling**: settled here (§5.1) — source-shaped, the §4.2 binder bracket as a quantifier prefix. Constraints §9.4 records the resolution. The function arrow shape is fixed here too.
- **Type-system internals** (Algorithm J, levels, union-find): compiler architecture, not additional language surface. §8 owns the observable generalization rules, and §4.3 the observable checking-mode rules — expected-type propagation is language surface (#513). Rank-2 types, should they arrive, still come through their own annotation-gated pathway (§4.2), which §4.3's machinery would host but does not open.
- **The elaboration schedule** (#517): §4.3's schedule is normative — non-lambda arguments first, lambda literals last, a lambda-literal callee after its arguments — so the pipe supplies in both §6.7 spellings, and contextual widening's targets include the written face at operations (Numeric Literals §5.1's expected-type lift). The design ledger, the order-migration record, and the declined alternative (widening removal) live on #517.
- **Type holes** (`_` in annotation type positions): `decisions-ml-dialect-annotations-2026-08.md` owns semantics, positions, the total-contract fence, diagnostics, and the annotation-doctrine record; §4.1 notes only the surface.

---

## 12. Conformance correction record

**2026-08-01 — §8.2's list omitted record literals; the stdlib leaned on them.**
`Seq.hex`'s module-level producers are constructor applications **of record
literals** (`Seq({ pull = ... })`), a shape the written list did not include.
The list is repaired in place under #205 (which also adds references — the
Step 1 relaxation, a genuine rule change, not part of this correction). Whether
the shipped checker conformed to the written list or the repaired one was not
established at ruling time; the conformance suite must pin the repaired
behavior on both the bare record literal and the constructor-wrapped shape
(closure doc `decisions-ml-dialect-generalization-2026-08.md` §2.4, §11.1).

**2026-07-28 — a right-hand side was read with its layout block attached.**
Lexer & Layout §2.1 already gives every term binding a block and already says a
single wrapped expression "is simply the one-item case, so the ordinary
multi-line RHS is unaffected". The compiler did not read it that way: the block
reached every rule that inspects a right-hand side, so a binding written on the
following line was not a syntactic value, did not generalize, was not an
exported *function* for the §4.1 signature check, and — once generalized —
carried no constraint evidence into emission. Whether a `let` was polymorphic
depended on where it sat on the page. The implementation now peels the wrappers
that do not change what a right-hand side means, once, before any rule that
reads its meaning sees it; §7.1, which reads the written form instead, keeps its
own answer. That much is a compiler defect correction. The one specification
addition is §8.2's ruling that a **multi**-item block is not read through and
does not generalize, which no document had decided. Implementation record and
credit live in `notes/compiler-conformance-defects.md` (issue #98).

**2026-07-24 — implemented in conformance with the existing rule.** Section
4.2 already required an error when a declared type was more general than its
body. The checker had represented user-written type variables with ordinary
unification variables, allowing an annotation such as `value: a` to collapse
silently to `Int`. The implementation now treats written annotation variables
as rigid during definition checking and checks written constraint lists for
completeness. This is a compiler defect correction, not a specification change.
The implementation record and Sol credit live in
`notes/compiler-conformance-defects.md`.
