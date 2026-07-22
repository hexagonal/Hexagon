# Hexagon Spec: Method Syntax (Type-Directed Dot Calls)

**Status:** Decided (July 2026), corrected in place after the second Sol review — see **correction record §16.1** (goal ownership). A **hanging-questions** section (§12) remains; nothing there blocks implementation of §1–§11.
**Scope:** The dot-call form `e.name(args…)`; its semantics as companion-module dispatch; the deferred *DotCall* goal and its resolution lifecycle (opportunistic triggers, the receiver-region deadline and pinning rule, fixpoint, the row fallback); the definition of a type's companion operation set; coverage (eligible and ineligible receiver types); field/method collision rules; interaction with row polymorphism, tuples' `itemN`, opaque types, and transparent aliases; emission; LSP completion obligation; the **Deferred-Goals Doctrine** (new, hosted here pending consolidation into the Declarations Preamble); diagnostics; rejected alternatives; edit notes.
**Not in scope:** the pipe (`|>` — Operators §8, unchanged); constraint-member call forms (Constraints §2.2 and Sol-review closure §A — explicitly *not* extended by this spec, §7); the stdlib inventory of companion operations (stdlib listing; this spec fixes the *rule* that determines which exports are dot-callable); `.d.ts` (nothing method-shaped exists to represent, §8.3); bound-method values (rejected, §11.6).
**Companions:** Products spec (§3.2 field access, §4 row tiers, §5 nominal records — the fallback preserves all of it), Modules spec (§5.3 companion idiom, §7.2 home module — the dispatch target; §4.2 `export opaque`), FFI Part 5 (§9 — extern nominal types and receiver-member linkage), Constraints spec (§2.2 member namespacing — untouched; §7 prelude members — not dot-callable), Operators spec (§10 postfix forms — the dot-call is level 1), Loops spec (§7 — the compiler-known Iterable table, precedent for deadline-resolved machinery), Functions spec (§8 generalisation — the deadline), Sol-review closure (§E Rewrite Rule — cited throughout), Decisions Batch — Sol Review 2 (this spec's origin session).

Written for a future implementation session against the existing `hexc` architecture: Algorithm J, union-find tyvars, level-based generalisation, constraints as dictionaries, whole-program compilation from an entry point, layout pass, readable-JS emission with `.d.ts`.

---

## 1. Doctrine

- **The semantics is one rewrite.** For a receiver of known companion-bearing type:

  ```
  receiver.name(args…)   ⇒   CompanionOf(receiverType).name(receiver, args…)
  ```

  After resolution, a dot call **is** an ordinary qualified function call. No runtime methods, no `this`, no prototype, no wrapper object, no dynamic property lookup, no method table exists at any point. *(Rewrite formulation: Sol.)*
- **This is not UFCS.** Resolution is type-directed, never lexical. `v.at(3)` consults `v`'s inferred type, not the names in scope (rejected alternative §11.1). The lineage statement, when one is wanted: *Rust-shaped dot-call syntax with a much smaller resolution model* — one candidate set, no ladder, no traits, no search (§11.2).
- **Member names never nominate nominal types.** A dot call is resolved *from* the receiver's type; the receiver's type is never inferred *from* the member name. `let f(x) = x.at(3)` does not search companion modules for an `at` and conclude `Vector`. This sentence is the guardrail that keeps the feature a resolution rule rather than global overload search, and it is doctrine. *(Phrasing: Sol.)*
- **Bare dot is field access, always.** `e.name` without an argument list is record field access (or tuple `itemN`) and nothing else — never a method reference, never a bound method, never `() => Module.name(e)`. Companion dispatch exists only in the syntactic call form `e.name(args…)` (§2.1, §11.6).
- **The unresolved dot call *is* a field call, by definition.** Companion dispatch requires the receiver's head constructor to be known from independent evidence by its owner region's finalisation deadline (§3.1). Absent that, `e.name(args…)` *means* row-constrained field access — exactly what the form means in the corpus today. The row fallback is semantics, not a heuristic (§3.5). Every dot-call form therefore has one deterministic meaning, and principal types are preserved.
- **One companion, no search.** `CompanionOf` is a total, trivial function of the receiver's head constructor — the home module (Modules §7.2) for user nominal types, a fixed prelude companion for built-ins (§4). No import adds or removes a dot-callable operation; no two candidates can ever compete. This is the method-syntax analogue of the orphan rule.
- **Three spellings, one canonical form.** `Vector.at(v, 3)`, `v |> Vector.at(3)`, and `v.at(3)` all elaborate to the same call. The qualified spelling is canonical (it is what everything elaborates to); dot is the daily idiom for a value's own companion operations; the pipe is the idiom for transformation chains, polymorphic functions, and operations owned by another module (§9). Dot syntax does not replace pipes; it supplies discoverable companion operations, pipes express explicit flow. *(Doctrine wording: Sol, adopted.)*
- **Deferred inference goals are exceptional** — see §10, the Deferred-Goals Doctrine, which this feature is the first spec to cite as its license.

---

## 2. Syntax and the DotCall goal

### 2.1 The form

```
e.name(args…)        -- dot call: creates a DotCall goal
e.name               -- bare dot: field access (Products §3.2) / itemN (Products §2.3), always
(e.name)(args…)      -- parenthesized: field access, then an ordinary call — no goal
```

- The dot-call form is precisely: a level-1 postfix expression (Operators §10), a `.`, a **non-uppercase-start** term name, and an **immediately following argument list**. It creates a goal only in this exact shape.
- Parenthesizing the field access — `(e.name)(args…)` — is the opt-out: no goal is created; this is field access followed by an ordinary call, resolvable today and forever, and it is the disambiguation spelling the collision diagnostic offers (§6). It falls out of the grammar; no new form is introduced.
- `e.name` bound and called later (`let f = e.name` … `f()`) is likewise plain field access; the goal machinery never sees it.
- Uppercase after the dot is not this feature: `Alias.Name(args…)` is module-qualified access (Modules §5.1), resolved positionally as today. The `.` token remains the single token of Operators §14, resolved by what the left side names; nothing changes there.
- Dot calls interleave freely with the other level-1 postfix forms: `v.slice(1..3)[2].show()` parses as postfix chains always have. (Whether each link *resolves* is §3's business.)

### 2.2 What the goal records

On elaborating `e.name(args…)` where `e : α`:

```
DotCall(α, name, [argType…], resultType)
```

— the receiver's tyvar, the member name, the argument types (each elaborated normally, in source order, after the receiver), and a fresh result tyvar that stands for the whole expression's type. **The goal is owned by the inference region of its receiver tyvar** — the level, in the level-based-generalisation sense, at which that variable lives (§3.1). Note that a goal is created **uniformly**, even when `e`'s type is already concrete at the dot — in that case the opportunistic trigger (§3.2) simply fires immediately. One code path.

### 2.3 Evaluation order

The receiver is evaluated first, then the arguments left to right — identical to the rewritten form's behaviour (`Vector.at(e, args…)` evaluates the import binding, which is effect-free, then `e`, then `args`), and identical to what a JS reader expects of the emitted code. No temporary is ever needed; the single-evaluation rule (Operators §5.4) has no client here.

---

## 3. The resolution lifecycle

*(Opportunistic-with-deadline model: Sol's timing correction, adopted. Fixpoint-at-deadline and the monotonicity guardrail: this session's refinement.)*

### 3.1 Overview

```
create goal  →  opportunistic resolution (as unification reveals the receiver)
             →  deadline at the owner region's finalisation: fixpoint over remaining goals
             →  survivors take the row fallback (which is the form's defined meaning)
```

**The deadline is the finalisation boundary of the goal's owner region** — the region (level) of the receiver tyvar, per §2.2. This is normally the `let`, `fun`, or module-level-binding generalisation boundary (Functions §8) at which the receiver tyvar would be quantified or finalised: for a parameter receiver, the enclosing `fun`'s boundary; for a module-level receiver, that binding's boundary. It is **not** in general the boundary of the innermost binding that textually contains the dot call — a goal on an outer-level receiver survives inner `let` boundaries and sees evidence from the entire owner region, before or after the call textually. **The deadline applies even when the value restriction prevents actual quantification**: finalisation happens regardless; no DotCall goal may escape its owner's inference region. *(Region correction and the value-restriction sentence: Sol; the receiver-level owner, replacing "the binding currently being inferred": this session — see §16.1.)*

**The pinning rule.** A pending goal pins every tyvar it mentions (receiver, argument types, result) to at least its owner region's level: an inner generalisation boundary never quantifies a goal-entangled variable — it remains flexible at the owner level, exactly as level-based generalisation already treats variables mentioned by outer obligations (and as constraint-bearing tyvars behave under literal defaulting, Numeric Literals §4). This is what lets a lambda or inner `let` containing a dot call on an outer receiver generalise soundly *around* the pending goal: `let g = x => v.at(x)` generalises `g` without quantifying the goal's result variable, which resolves with `v` at the outer boundary. Dot-call expressions are applications, never syntactic values, so the value restriction independently guarantees no binding generalises *at* a dot call's own result; pinning covers the entangled-variable cases the value restriction alone does not.

### 3.2 Opportunistic resolution and the monotonicity guardrail

A goal is reconsidered whenever unification changes its receiver tyvar. The trigger is: **the receiver's type becomes head-known** — solved to a nominal constructor application, a primitive, a tuple type, or a record type (structural row or nominal). At the trigger, resolve per §3.4.

Opportunism is sound because the trigger is **monotone under union-find unification**: once α solves to `Vector(β)` it never becomes anything else; once it is a record row it stays one; head-known-ness only ever increases. Therefore resolving at the trigger and resolving at the deadline provably agree, and Algorithm J's order-independence survives — the property whose loss disqualified eager at-the-dot resolution (§11.3). This monotonicity argument is normative: any future change to the trigger must re-establish it.

**The row fallback is deadline-only, never opportunistic.** The fallback (§3.5) is precisely the non-monotone step — imposing it on a still-unsolved α before the owner region's finalisation would conflict with head evidence arriving elsewhere in that region. Only a goal that survives to its owner's deadline, with its receiver still an unsolved tyvar after the fixpoint, takes the fallback. (This is also why the per-binding deadline was rejected — §16.1: firing the fallback at an inner `let`'s boundary imposes the row on an outer variable prematurely, making the meaning of sibling statements order-sensitive.)

### 3.3 The deadline fixpoint

Chained dot calls make the deadline a fixpoint, not a single pass: in `v.map(f).take(3)`, the second goal's receiver **is** the first goal's result tyvar. Resolving `map` solves that tyvar, which fires the trigger for `take`. At the deadline, iterate: resolve every goal whose receiver is head-known; repeat until no goal fires; then, and only then, apply the fallback to survivors. Termination is trivial (goals only leave the set). In practice chains resolve opportunistically left to right long before the deadline — which is also what makes LSP completion usable mid-chain (§8.4) — but the fixpoint is what makes the deadline correct without ordering assumptions.

**After the fallback, ordinary inference resumes to stability before generalising.** Applying the structural interpretation removes each surviving goal by translating it into an ordinary callable-field constraint (§3.5); the imposed rows then interact with each other and with existing obligations through plain unification and constraint discharge, which must run to quiescence before the region generalises. In `fun f(x) = x.make().run()`, both survivors become structural requirements and the result row of `make` connects to the receiver row of `run` by nothing more exotic than unification. This is not a second DotCall fixpoint — after the fallback the goals are gone; it is ordinary inference finishing its job. *(Clarification: Sol.)*

### 3.4 Resolution by receiver shape

When the trigger fires (or at the deadline fixpoint), the receiver's head determines the goal's meaning:

| Receiver's type | Meaning |
|---|---|
| **Structural record** (closed or open row) with field `name` | Field access, then an ordinary call: elaborate as `(e.name)(args…)`. The field must be function-typed with matching arity — failures are the ordinary type/arity errors, phrased against the field. |
| **Structural record without field `name`** | The standard missing-field error naming the known fields (Products §3.2 family). Companion dispatch is never attempted — structural types have no home module (Modules §2). |
| **Nominal type `T`** (record, union, opaque, built-in collection) | **Collision check first** (§6): if `name` is both a field of `T` *visible at this site* and an exported companion operation of `T`, hard error. Exactly a visible field → field call, as the structural case. Exactly a companion operation → **rewrite**: `CompanionOf(T).name(e, args…)`, thereafter an ordinary qualified call — arity, types, constraints, dictionaries all proceed as if the user had written it. Neither → the neither-error (§9, row 4), with near-miss suggestions drawn from both the field set and the companion set. |
| **Primitive** (`Int`, `Float`, `Bool`, `String`, `Unit`, and compiler-known nominals like `Range`, `Seq`) | As the nominal case, with `CompanionOf` the fixed prelude companion (§4.3). No fields exist, so no collision surface. |
| **Tuple** | `name` of the form `itemN` → the existing positional interpretation (Products §2.3) followed by a call, i.e. `(t.itemN)(args…)`; the component must be callable. Any other name → the existing tuple-dot errors. Tuples have no companions (§5); nothing new. |
| **Function type** | Error: functions have no fields and no companion (§5). |
| **Rigid (annotation-bound) type variable** | The fallback's row constraint cannot unify with a rigid variable; this failure gets the bespoke type-variable diagnostic (§9, row 6) rather than the raw unification error — see §7 for the `x.compare(y)` case it exists for. |

### 3.5 The row fallback — semantics, not heuristic

A goal whose receiver is still an unsolved (flexible) tyvar after the deadline fixpoint resolves as **field access**: impose

```
α  =  {name: (argType…) -> resultType, ...}
```

— the exact constraint the expression has always imposed under Products §3.2/§4 — and let ordinary machinery proceed. Nothing else. In particular:

- **The fallback never rejects.** It constrains. If α carries constraints a structural record cannot discharge (instance heads name constructors — Constraints §5.4 — so a row can honor nothing), ordinary constraint discharge produces the error through existing paths with existing phrasing. There is no soundness precondition on applying the fallback; a "can this soundly be a field requirement" pre-check is a phantom and is rejected (§11.8). *(Deletion of the pre-check: this session, amending Sol's formulation.)*
- **Tier-0 row polymorphism is untouched.** `fun f(r) = r.callback(3)` infers `{callback: Int -> a, ...} -> a` exactly as before this spec existed. The feature changes nothing about any program that compiled before it.
- **The defined-meaning framing is normative.** The language rule, stated for users: *companion dispatch requires the compiler to know the receiver's type from independent evidence; where it doesn't, a dot call is a record-field call, as always.* This is a defined asymmetry with a defined diagnostic (§3.6), owned out loud — the same posture the pattern-matching spec takes on its open/closed asymmetry — not an inference wobble to be smoothed over.

### 3.6 The annotation asymmetry, owned

Consequence of §3.5, confronted rather than hidden:

```
fun f(v) = v.at(3)                 -- v infers as {at: Int -> a, ...}; f is row-polymorphic
fun g(v: Vector(Int)) = v.at(3)    -- companion dispatch: Vector.at(v, 3)
```

Both compile; they mean different things, and `f(someVector)` later fails (a nominal type never unifies with a row — Products §5.1).

Under the receiver-level deadline (§3.1), the asymmetry is **cross-region only**: within one region, evidence anywhere counts — `fun f(v) = { let x = v.at(3); Vector.size(v) }` resolves the dot call as companion dispatch, textual order irrelevant (test §14(d)). The fallback fires only after *all* of a region's evidence is in, so a fallback row can never be contradicted later in its own region; the contradiction always surfaces at a use of the finalised binding — typically another binding or another module. One diagnostic obligation discharges the Rewrite Rule on this, the feature's ugliest corner:

**The post-finalisation contradiction** — the worst error this feature can produce, at maximal distance from its cause: `f` above finalises at the row type; `f(vec)` elsewhere fails with, naively, "`Vector` has no field `at`". Mandatory enrichment: whenever a nominal type `T` fails row-unification and the demanded field's name matches an exported companion operation of `T`, the diagnostic must say **why the row exists and what to do**: *"`f`'s parameter was inferred as a record with field `at` because its type was unknown inside `f`; `Vector` is not a record. Annotate the parameter (`v: Vector(a)`) to use companion dispatch, or call `Vector.at` directly."* This fires on the unification failure regardless of where it surfaces — same module or across the program — keyed by the field-name/companion-name match. Acceptance test §14(g).

---

## 4. `CompanionOf` — definition

### 4.1 The function

`CompanionOf` is total over eligible receiver heads and requires no search:

| Receiver head | Companion |
|---|---|
| User nominal type (`record`/`union`, incl. `export opaque`) | The type's **home module** — the file containing its declaration (Modules §7.2). Not the importer's alias, not any import path: the declaration site, unconditionally. Diagnostics and hovers *spell* it using the companion idiom (`Box.size`), which Modules §5.3 blesses. |
| Extern nominal type (`extern type` or `extern class`) | Its **binding module** — the file containing the extern declaration, hence its foreign type home. Exported subject-first receiver members form its companion operation set under §4.2 exactly like Hexagon-defined operations (FFI Part 5 §9). |
| `Int`, `Float`, `Bool`, `String`, `Unit` | The fixed prelude companion module of the same name (Modules §5.3: `Int.div` etc. — "one mechanism, not a special prelude device"; §6.4 guarantees the modules exist). |
| Prelude nominal types (`Vector`, `Map`, `Set`, `Option`, `Result`, `Range`, `Seq`, `Ordering`, …) | Their prelude companion modules — the same rule as user nominals, since prelude types are declared in prelude modules; listed separately only to record that built-ins are *not* special-cased. The authoritative inventory is the stdlib listing's. |

### 4.2 The companion operation set

The dot-callable operations of a type `T` are exactly:

> the functions **exported** by `CompanionOf(T)` whose **first parameter's type is `T`-headed**.

**`T`-headed is a syntactic test, not a unification question**: after expanding transparent aliases, the first parameter's outermost type constructor is `T` itself. Constructing the candidate set is therefore a **declaration-indexing operation** — decidable per declaration, once, with no speculative unification anywhere (many types *unify* with `T(…)`, starting with a fresh variable; none of that is consulted). *(Syntactic formulation: Sol.)* Worked examples:

```
map(v: Vector(a), f: a -> b): Vector(b)    -- included: outermost constructor is Vector
empty(): Vector(a)                           -- excluded: no first parameter
make(x: Float, y: Float): Point              -- excluded: first parameter not Point-headed
identity<a>(x: a): a                         -- excluded: bare type variable, no constructor
```

- **Exported only, uniformly** — including inside the home module itself. Making private functions dot-callable inside-only would give a type a visibility-dependent method set; inside the home module bare calls are available anyway. (Alternative rejected, §11.9.)
- **The subject-first filter is nearly free**: the stdlib convention (Operators §8 — first parameter is the subject, normative) means companion modules are already shaped for this. `Vector.empty` is correctly invisible after a dot, per the table above.
- **No overloading exists** (one function per name per module — Modules §5.2), so name lookup yields at most one candidate; arity and argument types are checked *after* the rewrite as an ordinary call, with ordinary errors. Resolution is by name; typing is by the resolved function. There is no ranking and nothing to rank.
- The set is **import-insensitive**: whether the *call site's module* imported the companion is irrelevant to resolution (the compiler is whole-program and the home module is in the graph by reachability of the type). No `use`-changes-methods spookiness, by construction. Emission handles the import (§8.2).

### 4.3 Transparent aliases and `opaque`

- **A transparent alias inherits the expansion's companion.** `type Name = String` gives `Name`-typed values `String`'s operations, because a `Name` value *is* a `String` (aliases are transparent everywhere — Modules §6.2). An alias never introduces a companion identity of its own; a module declaring `type Name = String` contributes nothing dot-callable to `Name`. *(Clarification: Sol.)*
- **`export opaque` types are the pattern working at its best**: outside the home module the fields are invisible (Modules §4.2), so no field/companion collision is even possible there, and every dot call is companion dispatch against the exported surface. Inside the home module fields are visible and the collision rule (§6) applies as usual.

---

## 5. Coverage

*(Category list: Sol's formulation, adopted with the tuple/record clarifications.)*

**Eligible receivers (companion dispatch can fire):**

- nominal records — including `export opaque`;
- nominal unions — no field access exists on union values, so no collision surface; the cleanest receivers the feature has (`option.getOrElse(default)`, `result.map(f)` — still static companion calls, not object methods);
- extern nominal types and extern class types — their binding module is the companion, and their opaque values expose no Hexagon fields (FFI Part 5 §9);
- prelude nominal collection and utility types (`Vector`, `Map`, `Set`, `Option`, `Result`, `Range`, `Seq`, …);
- primitives, through the fixed prelude companions (`"a,b".split(",")`, `n.toFloat()` — inventory per stdlib listing);
- transparent aliases of any of the above, via expansion (§4.3).

**Ineligible (dot never means companion dispatch):**

- structural records — dot is field access there, full stop; "excluded" means excluded from *companion dispatch*, while `x.run(3)` on a callable field remains fully supported by ordinary row machinery;
- tuples — except the existing compiler-defined `itemN` positional access (Products §2.3), which §3.4 folds in unchanged;
- function types;
- type variables — flexible ones take the fallback (§3.5); rigid constrained ones get the §7 redirect;
- structural aliases *as such* (they defer to their expansion — §4.3).

---

## 6. Field/method collision — hard error at the use site

For a nominal type `T` with transparent (or locally visible) fields, `name` may be both a field of `T` and an exported subject-first operation of `CompanionOf(T)`. The declarations are **legal to coexist** — no declaration-time restriction — and the ambiguous *spelling* is a hard error where it appears:

```
box.size()
-- ERROR: `box.size()` is ambiguous.
--   `Box` has:
--     • a field `size`
--     • a companion operation `Box.size`
--   Write `Box.size(box)` to call the companion operation.
--   [field callable]      Write `(box.size)()` to call the stored field.
--   [field not callable]  Write `box.size` to access the field.
```

**The fixits are conditional on the field's type.** `Box.size(box)` is always offered; the field-side fixit is `(box.size)()` only when the field is function-typed — for a non-callable field (`size: Int`), that spelling is not a fix, and the message instead points at bare `box.size` for the access. *(Error shape and the conditionality: Sol; both offered forms are pre-existing grammar, per §2.1.)*

- **Resolution is name-based, not type-based**: a *non-callable* field named `size` still collides with a companion `size` at the call form. Otherwise `e.name` and `e.name(…)` would resolve `name` through unrelated mechanisms depending on the field's type, and changing a field's type would silently change which mechanism a call site uses. *(Rule and rationale: Sol, confirmed.)*
- **Visibility-scoped**: the collision requires the field to be *visible at the call site*. For an `opaque` type, call sites outside the home module see no fields and cannot collide (§4.3).
- The bare form `box.size` and the parenthesized form `(box.size)()` are never ambiguous — they are field access by grammar (§2.1). Only the fused dot-call form carries the question, so only it can error.
- **Consequence, chosen with eyes open** (recorded from the decision session): use-site collision makes dot-call availability fragile under library evolution — an upstream module adding a field named `size` breaks downstream `box.size()` call sites. The breakage is loud, local, and mechanically fixable (Rewrite Rule holds; both fixits are in the message), and it lands on call sites that add a qualifier rather than forcing the upstream author to rename a *public* export — which is why use-site beat the declaration-time ban (§11.5).

---

## 7. Constraint members are not dot-callable

`show`, `compare`, `equals`, `hash`, `add`, … are constraint members (Constraints §2.2), not companion operations, and dot syntax never reaches them. `x.show()` does not work and is not planned to:

- On a **rigid type variable**, the fallback's row constraint fails against the rigid variable, and the diagnostic is a bespoke redirect. The governing sentence — sharper than "type variables have no companion operations," since a future instantiation of `a` may well have them — is: **companion dispatch cannot be selected through an abstract receiver type.** *(Formulation: Sol.)* Two variants, by whether the name matches a constraint member reachable from the variable's bounds (§9, rows 6–7): when it does (`fun f<a: Ord>(x: a) = x.compare(y)`), redirect to the direct call — *"`a` is an abstract type variable, so the compiler cannot select a companion operation; `compare` is a constraint member — call it directly: `compare(x, y)`"*; when it doesn't (`fun f<a>(x: a) = x.process()`), state the options — *"`a` is an abstract type variable, so the compiler cannot select a companion operation for `.process`; require a callable record field in the parameter's type, use a concrete nominal type, or call a qualified function."* Mechanically both are an ordinary rigid-unification failure wearing a better message.
- On a **concrete receiver** (`3.show()`): resolution reaches `Int`'s companion; whether it finds `show` there depends on the stdlib listing (Modules §6.4 requires qualified homes for prelude names, and `String.show`-style per-type homes were its own example). **If** the companion exports a subject-first `show(x: Int): String`, then `3.show()` resolves as an ordinary companion call to *that monomorphic function* — legal, unremarkable, and involving no constraint dispatch whatsoever. This spec neither requires nor forbids such exports; it records that the *mechanism* stays clean either way: dot calls never consult instances, dictionaries, or constraint member names. The stdlib listing decides the inventory and inherits a note (§15).
- Extending dot syntax to dispatch constraint members on unknown types is the road to extension-trait machinery and import-sensitive method sets — the exact Rust complexity this design exists to refuse. Pre-registered rejection, §11.7; revisit bar in §12.1.

The guide's teaching is unchanged: prelude constraint members are called bare (`show(x)`) or piped (`x |> show`), per Sol-review closure §A.

---

## 8. Emission, `.d.ts`, and the LSP

### 8.1 Dot calls vanish

Resolved companion dispatch is an ordinary qualified call before lowering; **the dot-call node does not survive into codegen**. Emission is whatever the equivalent hand-written call emits:

```
v.at(3)          -- emits: at(v, 3)         (named import per Modules §11)
opt.getOrElse(0) -- emits: getOrElse(opt, 0), or its established inlining
r.callback(3)    -- (field call) emits: r.callback(3)   — the honest POJO read
```

Field-resolved dot calls emit *as themselves* — a JS property access and call on a POJO, which is exactly what the semantics is. Companion-resolved calls retain the resolved declaration's ordinary lowering: a Hexagon-defined operation emits the named-import call, subject to established inlining rights, while an extern receiver member retains its FFI linkage and may emit a receiver call or property access directly (FFI Part 5 §9). Method Syntax itself adds no runtime method, prototype change, or hidden `this`.

### 8.2 Imports

If a call site's module never textually imported the companion, the emitter adds whatever dependency the resolved declaration's lowering requires — normally the companion's named import under Modules §11, or the foreign module import/linkage required by an extern receiver member. Emitted-name collisions are the emitter's ordinary renaming problem, not a semantics question.

### 8.3 `.d.ts`

Nothing to represent: the emitted functions have the signatures they always had, and no method appears on any emitted type. The `.d.ts` story is byte-for-byte what it was before this spec.

### 8.4 LSP obligation

Completion after `receiver.` must be driven by **the same resolution model**, at the current inference state: head-known nominal → visible fields ∪ companion operation set (marking which is which); record row → known fields; unsolved tyvar → no companion candidates, and the hover may suggest an annotation to unlock completion. Opportunistic resolution (§3.2) is what makes mid-chain completion (`v.map(f).|`) work; this is a design requirement on the checker's incremental behaviour, not a nicety. The discoverability payoff for the target audience is a first-class motivation of the feature and the LSP row is therefore normative, not advisory.

---

## 9. Diagnostics checklist

| # | Situation | Error / hint |
|---|---|---|
| 1 | Field/method collision at dot-call form | the §6 message: name both interpretations; always offer `T.name(e)`; offer `(e.name)()` only if the field is callable, else point at bare `e.name` for the access |
| 2 | Structural receiver, no such field | existing missing-field error (Products §3.2 family) — companion dispatch never mentioned |
| 3 | Field resolved but not callable / wrong arity | ordinary type/arity errors phrased against the field: "field `at` has type `Int`, which is not a function" |
| 4 | Nominal receiver, name is neither field nor companion op | "`Vector` has no field `at2` and module `Vector` exports no operation `at2`" + near-miss suggestions from both sets |
| 5 | Companion op exists but first parameter is not `T`-headed | treated as row 4 (it is not in the operation set) — but if the name matches a non-subject-first export, hint: "`Vector.empty` does not take a `Vector` as its first argument; call it as `Vector.empty(…)`" |
| 6 | Dot call on rigid type variable, name matches a reachable constraint member | "`a` is an abstract type variable, so the compiler cannot select a companion operation; `compare` is a constraint member — call it directly: `compare(x, y)`" (§7) |
| 7 | Dot call on rigid type variable, no matching constraint member | "`a` is an abstract type variable, so the compiler cannot select a companion operation for `.process`; require a callable record field in the parameter's type, use a concrete nominal type, or call a qualified function" (§7) |
| 8 | Post-finalisation row-vs-nominal failure with matching companion op (any distance — same module or across the program) | the §3.6 enriched message — mandatory whenever the field name matches an exported companion operation of the failing nominal type. Same-region contradictions are unreachable under the receiver-level deadline (§3.6) |
| 9 | Tuple receiver, non-`itemN` name | existing tuple-dot errors (Products §2.3), unchanged |
| 10 | Function-typed receiver | "functions have no fields or companion operations" |
| 11 | Uppercase name after dot with an argument list where left side is not a module alias | existing Modules §5.1 resolution/errors, unchanged — not this feature |

Vocabulary rules: diagnostics say **companion operation** (never "method" — nothing method-like exists at runtime, and the noun would teach the wrong model) and never say "row" (Products §4 ban, still in force). "Dot call" is acceptable in hovers and docs.

---

## 10. The Deferred-Goals Doctrine (adopted)

Stated here as corpus doctrine; hosted in the Declarations Preamble on consolidation (edit note §15). *(Formulation: Sol, adopted near-verbatim.)*

> **Deferred inference goals are exceptional.** Each kind must have a finite, deterministic resolution rule; must not search globally; must not survive generalisation; and must preserve principal types.

The doctrine retroactively describes machinery already in the corpus — literal defaulting (Numeric Literals §4: deterministic rule at generalisation), the compiler-known Iterable table (Loops §7: unsolved tyvar at the boundary is an annotation-required error), the projection-bearing-constraint ban (Collections Part 2 §7: v1 refuses the goal category it cannot yet resolve this way) — which is the mark of a doctrine rather than a patch. It also sets the bar v2's implied-type projection inference must clear before it exists.

**DotCall's compliance, itemised:** one receiver variable per goal; one member name; resolution is field-or-unique-companion (no candidate set to rank, no global search — §4.2); goals cannot survive their owner region's finalisation (the fallback is total, the pinning rule keeps entangled variables out of inner quantification, and finalisation applies even where the value restriction prevents quantification — §3.1, §3.5); principal types are preserved because the unresolved form has a *defined* meaning identical to the pre-feature language (§3.5), and opportunistic early resolution provably agrees with deadline resolution by monotonicity (§3.2). There is no generalized "has-method" constraint in the type language; `DotCall` is checker state, never a type.

Any future ergonomic feature that wants the inferencer to postpone a decision cites this doctrine or returns to design.

---

## 11. Rejected alternatives

1. **Lexical UFCS (D-style: `v.at(3)` → bare-scope `at(v, 3)`).** Rejected: Hexagon's collection operation names deliberately collide across companion modules and are normally module-qualified, so the bare name is usually absent or wrong; resolution would become import-sensitive; the pipe already serves bare functions; and lexical lookup provides no receiver-based completion — the feature's chief payoff. *(Rationale list: Sol.)* **Do not relitigate.**
2. **Rust's resolution machinery.** Recorded with the free/real split so the spec claims credit only where restraint was exercised. *Structurally inapplicable (free):* the deref/auto-ref ladder (no references exist), inheritance (none exists), implicit borrowing (none exists). *Genuinely rejected (real):* trait-method candidates / extension traits — the source of Rust's import-changes-methods spookiness; one candidate set here, ever — and any ranking of multiple candidates (none can exist, §4.2). **Do not relitigate the extension-trait exclusion**; it protects the Sol-review §B invisible-instance analysis.
3. **Eager resolution at the dot** ("dispatch if the receiver's type happens to be concrete when elaboration reaches the expression"). Rejected: makes meaning depend on Algorithm J's traversal order, destroying order-independence — the property the deferred-goal design exists to keep. Disqualified, not merely disfavoured. **Do not relitigate.**
4. **Fields-win silent priority** at collisions. Rejected: adding or exposing a field would silently change which operation an existing call invokes, and a new companion export could be invisibly masked. Loud beats silent; no-warning-tier temperament. *(Consequence analysis: Sol.)*
5. **Declaration-time collision ban** (home module may not export a subject-first function named like a field). Rejected in favour of use-site (§6): it charges library authors for a feature their consumers may never use, breaks at a distance when a field is added, and its only cure is renaming a *public* export — worse churn than call sites qualifying. Revisit only with field evidence that use-site breakage under library evolution (§6, last bullet) is a real ecosystem pain.
6. **Bound-method values** (`v.at` as `() => Vector.at(v)`-ish, or any method reference). Rejected: implicit closure allocation, hidden receiver capture, equality-of-bound-methods questions, and a reintroduction of partial application through the back door. Not merely "Hexagon lacks currying" — a non-curried language *could* invent bound methods; Hexagon has no reason to. `map(vs, Vector.reverse)` stays qualified. *(Rationale: Sol.)* **Do not relitigate.**
7. **Constraint-member dispatch through dot** (`x.show()` resolving via instances on unknown or known types). Rejected for v1 and pre-registered as the feature's slippery slope: it is precisely extension-trait machinery, makes the method set depend on constraint solving, and taxes the bare-call doctrine (Sol-review §A) for nothing the LSP doesn't already provide. Revisit bar: §12.1.
8. **A soundness precondition on the row fallback** ("apply the fallback only if row inference can soundly produce a callable-field requirement; otherwise reject"). Rejected as a phantom check: the fallback constrains and never rejects; unsatisfiable results (e.g. constraints a row cannot honor) error through existing constraint-discharge paths with existing phrasing. Zero new code paths. *(Amends Sol's formulation.)*
9. **Private functions as dot-callable inside the home module.** Rejected: a visibility-dependent operation set; bare calls are available there anyway. Exported-only, uniformly (§4.2).
10. **Per-binding deadline** ("the goal is attached to the binding currently being inferred and resolves at its boundary"). Rejected: for a goal whose receiver lives at an outer level, an inner `let`'s boundary would fire the fallback on the outer variable prematurely — making `let x = v.at(3); Vector.size(v)` an error while its reordered siblings compile. Statement order between independent siblings would change meaning: the order-sensitivity that disqualified eager resolution (§11.3), reintroduced at binding granularity. The receiver-level deadline (§3.1) is the correct owner; see the correction record §16.1. **Do not relitigate.**

---

## 12. Hanging questions

1. **Dot access to constraint members, ever?** (`x.show()` as constraint dispatch.) Closed for v1 (§7, §11.7). Reopen condition: field evidence that TS-audience users pervasively write `x.show()` *and* the stdlib-listing hostile-specimen exercise (Sol-review §A.5) shows qualification pressure that dot syntax would genuinely relieve — and any design must still satisfy §10 (no global search, no import-sensitivity), which no known constraint-dispatch scheme does. Expected answer: permanent no; recorded as hanging only because the audience pressure is predictable.
2. **Method references / bound methods** (`v.at` as a value). Rejected (§11.6); recorded here only because TS users will ask. Reopen condition: none foreseeable; the pipe and lambdas (`x => Vector.at(v, x)`) cover every use.
3. **Companion operations on `Range`/`Seq` inventory** — which exports exist is the stdlib listing's; this spec only guarantees the mechanism reaches them (§4.1).
4. **Monomorphic prelude `show`/`toString`-style companions** (`3.show()` via `Int.show : Int -> String`) — stdlib-listing decision (§7); mechanism indifferent.
5. **The three-spellings style question at scale.** §1/§9 fixes the doctrine; whether real codebases fragment anyway is empirical. Watch during dogfooding; the formatter/linter (if one ever exists — there is no warning tier) is *not* the answer; guide pressure is.

---

## 13. Decisions log

| Decision | Where |
|---|---|
| Semantics = one rewrite to companion call; static, erased, no runtime methods/`this`/prototypes | §1, §8 |
| Type-directed, not lexical; lexical UFCS rejected with reasons | §1, §11.1 |
| **Member names never nominate nominal types** (doctrine; the anti-overload-search guardrail) | §1, §3.5 |
| Bare `e.name` is field access always; dispatch exists only in the fused call form; `(e.name)()` is the grammar-level opt-out | §2.1, §11.6 |
| Goal created uniformly; receiver-first evaluation order, no temporaries | §2.2–2.3 |
| Goal owned by the **receiver tyvar's region**; deadline = that region's finalisation boundary, effective even under the value restriction; **pinning rule** keeps goal-entangled tyvars out of inner quantification; per-binding deadline rejected | §2.2, §3.1, §11.10, §16.1 |
| Opportunistic resolution on head-known trigger; **monotonicity argument normative**; fallback deadline-only | §3.2 |
| Deadline is a fixpoint (chains); termination trivial; after the fallback, ordinary inference resumes to stability before generalising | §3.3 |
| Resolution table by receiver shape; nominal case checks collision first | §3.4 |
| **Row fallback is the form's defined meaning**; never rejects; Tier-0 row polymorphism byte-for-byte preserved; asymmetry is cross-region only, owned with the mandatory post-finalisation diagnostic | §3.5–3.6 |
| `CompanionOf` = home module (declaration site) / fixed prelude companions; total, search-free, import-insensitive | §4.1–4.2 |
| Operation set = exported ∧ subject-first; **`T`-headed is syntactic** (outermost constructor after alias expansion; declaration-indexing, no speculative unification); uniform inside/outside home; no overloading ⇒ no ranking | §4.2 |
| Transparent aliases inherit the expansion's companion; aliases introduce no companion identity; `opaque` collision-free outside home | §4.3 |
| Coverage: nominal records/unions/prelude nominals/primitives/aliases in; structural records (fields only), tuples (`itemN` only), functions, tyvars out | §5 |
| Collision: **hard error at use-site**, name-based (non-callable fields collide too), visibility-scoped; **fixits conditional on field callability**; declaration-time ban rejected; evolution fragility recorded eyes-open | §6, §11.4–11.5 |
| Constraint members not dot-callable; doctrine: **companion dispatch cannot be selected through an abstract receiver type**; rigid-tyvar redirect split by constraint-member match; monomorphic companion `show`-style exports are stdlib-listing's call, mechanism indifferent | §7 |
| Emission: dot node dead before lowering; field calls emit as themselves; companion calls emit named-import calls; emitter may add imports; `.d.ts` unchanged | §8.1–8.3 |
| LSP completion driven by the same resolution model — normative | §8.4 |
| Diagnostic noun: "companion operation", never "method"; "row" ban still holds | §9 |
| **Deferred-Goals Doctrine adopted**; DotCall's compliance itemised; hosted here pending Preamble consolidation | §10 |
| Nine rejected alternatives incl. eager resolution, fields-win, bound methods, fallback pre-check | §11 |

Credit: the rewrite formulation, opportunistic timing, name-based collision rule, nominal-union inclusion, alias clarification, the never-nominate phrasing, and the Deferred-Goals Doctrine originate with Sol's first review; the region correction (with the value-restriction finalisation sentence), conditional collision fixits, syntactic `T`-headed test, post-fallback resumption note, split rigid diagnostics, and the abstract-receiver doctrine sentence originate with Sol's second review. The fixpoint/monotonicity argument, fallback-as-defined-semantics framing, deletion of the fallback pre-check, use-site ruling, the post-finalisation diagnostic obligation, the receiver-level owner (replacing Sol's per-binding formulation), the pinning rule, and the §16.1 correction are this session's.

---

## 14. Acceptance tests

```
-- (a) The three spellings converge
let v: Vector(Int) = Vector.of(1, 2, 3)
Vector.at(v, 2)                    -- OK : Int
v |> Vector.at(2)                  -- OK : Int, same elaboration
v.at(2)                            -- OK : Int, same elaboration

-- (b) Chain: opportunistic left-to-right, no annotations
v.map(x => x * 2).take(2).at(1)    -- OK : Int  (each goal's receiver head-known
                                   --   from the previous resolution's result type)

-- (c) Tier-0 preservation: unknown receiver is a field call, exactly as today
fun f(r) = r.callback(3)           -- OK : {callback: Int -> a, ...} -> a
f({callback: n => n + 1})          -- OK : Int

-- (d) Same-region evidence counts, regardless of textual position (§3.1)
fun g(v) =
    let x = v.at(3)                  -- goal pends; receiver tyvar owned by g's region
    Vector.size(v)                   -- v := Vector(a): trigger fires, goal resolves
    x                                -- OK — the dot call is Vector.at(v, 3); the inner
                                   --   let boundary did NOT force the fallback (§11.10)
                                   --   [corrected: was wrongly an error — §16.1]

-- (e) Annotated form dispatches; no other evidence needed
fun h(v: Vector(Int)) = v.at(3)    -- OK: Vector.at(v, 3)

-- (f) Member names never nominate
let k(x) = x.at(3)                 -- OK, row-polymorphic (never infers Vector)

-- (g) Cross-module late evidence: the enriched error
-- lib.hex:   export fun first(v) = v.at(1)        -- generalises at the row type
-- main.hex:  first(Vector.of(9))                  -- ERROR (row 8): `first`'s parameter
                                                   --   was inferred as a record with
                                                   --   field `at` because its type was
                                                   --   unknown inside `first`; `Vector`
                                                   --   is not a record. Annotate the
                                                   --   parameter (`v: Vector(a)`) to use
                                                   --   companion dispatch.

-- (h) Collision, use-site, both fixits
-- box.hex: export record Box = {size: Int}
--          export fun size(b: Box): Int = b.size * 2
let b = Box({size: 3})
b.size                             -- OK : Int      (bare dot = field, always)
(b.size)                           -- OK : Int
b.size()                           -- ERROR (row 1): ambiguous — field `size` /
                                   --   companion `Box.size`. Write `Box.size(b)` to
                                   --   call the companion operation; write `b.size`
                                   --   to access the field.  [field is Int — not
                                   --   callable, so `(b.size)()` is NOT offered (§6)]
Box.size(b)                        -- OK : Int

-- (i) Non-subject-first export is invisible after the dot
v.empty()                          -- ERROR (row 5): `Vector` has no field `empty`;
                                   --   `Vector.empty` does not take a `Vector` as its
                                   --   first argument; call it as `Vector.empty()`

-- (j) Rigid variable with a matching constraint member: the redirect
fun cmp<a: Ord>(x: a, y: a) =
    x.compare(y)                     -- ERROR (row 6): `a` is an abstract type variable,
                                   --   so the compiler cannot select a companion
                                   --   operation; `compare` is a constraint member —
                                   --   call it directly: `compare(x, y)`

-- (j2) Rigid variable, no matching member: the options message
fun go<a>(x: a) =
    x.process()                      -- ERROR (row 7): `a` is an abstract type variable,
                                   --   so the compiler cannot select a companion
                                   --   operation for `.process`; require a callable
                                   --   record field in the parameter's type, use a
                                   --   concrete nominal type, or call a qualified
                                   --   function

-- (k) Nominal union receiver (no field surface, no collision possible)
let o: Option(Int) = Some(3)
o.getOrElse(0)                     -- OK : Int   (companion: Option.getOrElse)

-- (l) Transparent alias inherits companion
type Name = String
let n: Name = "hex"
n.length()                         -- OK : Int   (String's companion; `Name` adds none)

-- (m) Opaque outside home: pure companion surface
-- point.hex: export opaque record Point = {x: Float, y: Float}
--            export fun getX(p: Point): Float = p.x
p.getX()                           -- OK : Float  (outside home; field x invisible,
                                   --   no collision possible)
p.x                                -- ERROR: existing opacity error (Modules §4.2)

-- (n) Fallback + underivable constraint: existing error path, no new phrasing
fun m(x) = add(x, x.total(1))      -- x gets Num (from add) and, at deadline,
                                   --   the row {total: Int -> ...} — ERROR via
                                   --   ordinary discharge: no Num instance for a
                                   --   record type (existing constraint phrasing)

-- (o) Field-resolved dot call emits as itself
fun run(r: {step: Int -> Int, ...}) = r.step(1)
                                   -- emits: r.step(1)   — POJO read, honest JS

-- (p) The pinning rule: inner generalisation around a pending goal (§3.1)
fun f(v) =
    let g = x => v.at(x)             -- g is a syntactic value; generalises WITHOUT
                                   --   quantifying the goal's result tyvar (pinned
                                   --   to f's region)
    Vector.size(v)                   -- v := Vector(a): goal resolves as companion
    g(1)                             -- OK : a   — g : Int -> a after resolution

-- (q) Post-fallback resumption: survivor rows connect by ordinary unification (§3.3)
fun w(x) = x.make().run()          -- OK — both goals take the fallback at w's
                                   --   boundary; make's result row unifies with
                                   --   run's receiver row; w is row-polymorphic
```

---

## 15. Edit notes to companion documents

*(House rule: pending notes live here; applied on next touch of the target.)*

- **declarations-preamble.md** — host the **Deferred-Goals Doctrine** (§10) alongside the Rewrite Rule on consolidation, citing literal defaulting, the Iterable table, the projection ban, and DotCall as its instances.
- **operators-logic-precedence.md** — §10 (postfix forms): note that `e.name(args…)` with non-uppercase-start `name` creates the DotCall goal of this spec; `(e.name)(args…)` remains two postfix operations. §14 (`.` token): one cross-reference line; token unchanged.
- **products.md** — §3.2: one line — the fused dot-call form defers via this spec's goal and *means* field access whenever the receiver is not head-known-nominal; Tier-0 inference results are unchanged. §2.3: `itemN` folded into the goal's resolution table with identical behaviour.
- **modules.md** — §5.3 (companion idiom): note that method syntax makes the idiom load-bearing — `CompanionOf` targets the home module of §7.2. §11: emitter may add named imports for companion-resolved calls at sites that never textually imported the companion.
- **constraints.md** — §2.2: one line — constraint members are not reachable via dot (this spec §7); the bare/qualified doctrine (Sol-review §A) is unaffected.
- **loops-ranges-iteration.md** — §7: note the Iterable table is now one instance of the Deferred-Goals Doctrine; behaviour unchanged.
- **stdlib listing (on creation)** — inherits: (i) the subject-first convention now also determines dot-callability (§4.2); (ii) decide the monomorphic per-type `show`/`toString`-style companion exports question (§7, §12.4); (iii) companion inventories for `Range`, `Seq`, primitives.
- **hexagon-for-typescript-coders.md** — new chapter after Pipes: dot calls as "the method syntax you expected, without the objects" — teach the rewrite, the three-spellings doctrine (§1/§9 wording), the cross-region annotation asymmetry with examples §14(e)/(g), and the `x.show()` redirect. Permitted guide phrasing (Sol): *"Hexagon's method syntax provides a UFCS-like surface, but uses type-directed companion lookup rather than lexical UFCS"* — the spec's flat "this is not UFCS" stays in the spec. Parallel examples must mirror pipe-chapter conventions.
- **spec-roadmap.md / collections specs (Parts 3–5, on next touch)** — collection operation examples may add the dot spelling beside qualified/pipe forms where it aids the reader; the qualified form remains the canonical citation form in specs.

---

## 16. Correction records (July 2026, post-review)

Recorded per house rule: defect origin, rationale, rejected alternative marked do-not-relitigate. The correction is applied **in place** above (§2.2, §3.1, §3.2, §3.6, §9 rows 6–8, §11.10, tests §14(d)/(p)); the corrected sections are marked.

### 16.1 Goal ownership: receiver-level region, not the enclosing function — and not the enclosing binding

- **Defect:** §2.2/§3.1 as first decided attached the DotCall goal to "the enclosing function" and set the deadline at "the generalisation boundary of the enclosing function." Neither module-level bindings nor the level structure of inner `let`s fit that wording. Worse, acceptance test (d) asserted that same-function evidence *after* an inner `let` could not rescue a goal — directly contradicting §3.2's own trigger rule ("reconsidered whenever unification changes its receiver tyvar"), which fires on the later `Vector.size(v)` unification. The spec was internally inconsistent as shipped.
- **Origin:** the function-shaped wording was imported from the discussion's running example (`fun f(v) = v.at(3)`) without checking it against module-level bindings, nested `let`s, or the level-based generalisation machinery the corpus actually has; test (d) then encoded the un-generalised intuition rather than the §3.2 rule.
- **Correction:** the goal is owned by **the inference region (level) of its receiver tyvar**; the deadline is that region's finalisation boundary, effective even where the value restriction prevents quantification; the **pinning rule** keeps goal-entangled tyvars out of inner quantification. Consequences: same-region evidence counts regardless of textual position; the fallback can never be contradicted within its own region; the same-function diagnostic (old row 7) is unreachable and merges into the post-finalisation diagnostic (row 8); test (d) flips to OK.
- **Rejected alternative (do not relitigate):** the **per-binding deadline** — attaching the goal to "the binding currently being inferred" and finalising at its boundary. It fires the fallback on an outer-level variable at an inner `let`'s boundary, making the meaning of independent sibling statements order-sensitive: the defect class that disqualified eager resolution (§11.3), reintroduced at binding granularity. Recorded at §11.10.
- **Credit:** Sol flagged the function-specific wording and contributed the value-restriction finalisation sentence; the receiver-level owner formulation, the pinning rule, and the discovery that test (d) contradicted §3.2 are this session's, arrived at while evaluating Sol's proposed (and rejected) per-binding owner.
