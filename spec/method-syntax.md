# Hexagon Spec: Method Syntax (Type-Directed Dot Calls)

**Status:** Decided (July 2026), corrected in place after the second Sol review — see **correction record §16.1** (goal ownership) — and **amended August 2026 for constraint-member dispatch** (#304/#335, the members-as-values ruling) — see **reversal record §16.2**. A **hanging-questions** section (§12) remains; nothing there blocks implementation of §1–§11.
**Scope:** The dot-call form `e.name(args…)`; its semantics as companion-module dispatch **and, since the #335 steal, constraint-member dispatch** (honored members on head-known receivers; bound members on declared type variables); the deferred *DotCall* goal and its resolution lifecycle (opportunistic triggers, the receiver-region deadline and pinning rule, fixpoint, the defaulting step, the row fallback); the definition of a type's companion operation set; coverage (eligible and ineligible receiver types); field/method collision rules; interaction with row polymorphism, tuples' `itemN`, opaque types, and transparent aliases; emission; LSP completion obligation; the **Deferred-Goals Doctrine** (hosted here pending consolidation into the Declarations Preamble); diagnostics; rejected alternatives; edit notes.
**Not in scope:** the pipe (`|>` — Operators §8, unchanged); the bare and qualified constraint-member call forms themselves (Constraints §2.2 owns the call-style doctrine; this spec owns only the dot spelling's reach); the stdlib inventory of companion operations (stdlib listing; this spec fixes the *rule* that determines which exports are dot-callable); `.d.ts` (nothing method-shaped exists to represent, §8.3); bound-method values (rejected, §11.6).
**Companions:** Products spec (§3.2 field access, §4 row tiers, §5 nominal records — the fallback preserves all of it), Modules spec (§5.3 companion idiom, §7.2 home module — the dispatch target; §4.2 `opaque`), FFI Part 5 (§9 — extern nominal types and receiver-member linkage), Constraints spec (§2.2 member namespacing and call style; §4.6 member bindings in the honoring module — the dot's exemptions and the own-name refusal), Operators spec (§10 postfix forms — the dot-call is level 1), Loops spec (§7 — the compiler-known Iterable table, precedent for deadline-resolved machinery), Functions spec (§8 generalisation — the deadline), Sol-review closure (§E Rewrite Rule — cited throughout), Decisions Batch — Sol Review 2 (this spec's origin session).

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
- **One companion, no search.** `CompanionOf` is a total, trivial function of the receiver's head constructor — the home module (Modules §7.2) for user nominal types, a fixed prelude companion for built-ins (§4). No import adds or removes a dot-callable operation. *(Amended for #304/#335 — see §16.2.)* The operation set now unions the receiver type's **honored constraint members** (§4.2), which preserves both properties: coherence keys instances program-wide, so membership is as import-insensitive and search-free as the export set — but two candidate *sources* can now claim one spelling, and where they do the call is refused naming every qualified home (§6). Refusal, never ranking; the no-ranking doctrine survives the union — and survives §6.1's generalisation-law carve too, which refuses to rank by recognizing a widens binding and its derived member as one claimant rather than two.
- **Three spellings, one canonical form.** `Vector.at(v, 3)`, `v |> Vector.at(3)`, and `v.at(3)` all elaborate to the same call. The qualified spelling is canonical (it is what everything elaborates to); dot is the daily idiom for a value's own companion operations; the pipe is the idiom for transformation chains, polymorphic functions, and operations owned by another module (§9). Dot syntax does not replace pipes; it supplies discoverable companion operations, pipes express explicit flow. *(Doctrine wording: Sol, adopted.)* Since the prelude seeds no function or member bare but `ignore` and `show` (Modules §5.5), the dot is the prelude's **everyday** surface and the qualified spelling its explicit and polymorphic one — the sentence above states a preference; §5.5 makes it the shape, and the stdlib's own source writes the dot wherever it resolves (`stdlib-roadmap.md` §1).
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
- *(#355.)* **A call mark anchors the argument list, whatever the callee expression** (Effects §3.2). A dot call marks its own list — `stream.next!()` — and the parenthesized opt-out marks its ordinary call the same way: `(source.step)!()`. In a postfix chain each argument list is marked for the arrow *it* discharges (Effects §3.3); the bare dot `e.name` remains field access and remains colourless — no argument list, no mark. A goal deferred to the deadline (§3.3) resolves with its mark obligation intact: the mark was anchored to the list at parse time and dispatch does not move it.
- In a multiline chain, a leading dot is a postfix continuation. The canonical layout aligns each leading dot with the receiver, just as a leading `|>` aligns with the value in a multiline pipe:

  ```hexagon
  let selected =
      numbers
      .filter(number => number > 3)
      .map(number => number * 10)
      .take(5)
  ```

### 2.2 What the goal records

On elaborating `e.name(args…)` where `e : α`:

```
DotCall(α, name, [argType…], resultType)
```

— the receiver's tyvar, the member name, the argument types (each elaborated normally on Functions §4.3's schedule — non-lambda arguments in source order, lambda literals after — following the receiver), and a fresh result tyvar that stands for the whole expression's type. **The goal is owned by the inference region of its receiver tyvar** — the level, in the level-based-generalisation sense, at which that variable lives (§3.1).

*(#513.)* **When the receiver's type is head-known at the dot** — already solved to a §3.2 trigger shape when the receiver's own elaboration returns — **resolution runs before the arguments are elaborated**: the goal is created and resolved per §3.4 on the spot, and the call then checks as a named call to the resolved member, its signature supplying each argument's expected type (Functions §4.3), pointwise. This ordering is what the argument seat requires — an expectation is useless after its argument has been checked — and it changes nothing about *which* member is chosen: §3.2's monotonicity argument is exactly the proof that resolving at creation and resolving at the trigger or deadline agree. A receiver still unsolved at the dot keeps the path above unchanged — arguments elaborated first, the goal pending on the trigger — and those arguments synthesize, Functions §4.3's known-callee condition being unmet. One resolution algorithm (§3.4), two entry moments; and only the arguments' expected types ride on which moment fires — dispatch never does (§11.3's rejection is untouched — see the note there). Evaluation order (§2.3) is inference-independent and unchanged.

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

Chained dot calls make the deadline a fixpoint, not a single pass: in `v.map(f).take(3)`, the second goal's receiver **is** the first goal's result tyvar. Resolving `map` solves that tyvar, which fires the trigger for `take`. At the deadline, iterate: resolve every goal whose receiver is head-known; repeat until no goal fires; **then apply Numeric Literals §4's defaulting to the survivors' receivers** — a receiver tyvar whose constraint set is non-empty and entirely defaultable settles to `Int`, which is the head-known trigger, so the fixpoint re-fires and those goals resolve as dispatch *(the defaulting step: #304 — see §3.5)*; then, and only then, apply the fallback to the remainder. Termination is trivial (goals only leave the set). In practice chains resolve opportunistically left to right long before the deadline — which is also what makes LSP completion usable mid-chain (§8.4) — but the fixpoint is what makes the deadline correct without ordering assumptions.

**After the fallback, ordinary inference resumes to stability before generalising.** Applying the structural interpretation removes each surviving goal by translating it into an ordinary callable-field constraint (§3.5); the imposed rows then interact with each other and with existing obligations through plain unification and constraint discharge, which must run to quiescence before the region generalises. In `fun f(x) = x.make().run()`, both survivors become structural requirements and the result row of `make` connects to the receiver row of `run` by nothing more exotic than unification. This is not a second DotCall fixpoint — after the fallback the goals are gone; it is ordinary inference finishing its job. *(Clarification: Sol.)*

### 3.4 Resolution by receiver shape

When the trigger fires (or at the deadline fixpoint), the receiver's head determines the goal's meaning:

| Receiver's type | Meaning |
|---|---|
| **Structural record** (closed or open row) with field `name` | Field access, then an ordinary call: elaborate as `(e.name)(args…)`. The field must be function-typed with matching arity — failures are the ordinary type/arity errors, phrased against the field. |
| **Structural record without field `name`** | The standard missing-field error naming the known fields (Products §3.2 family). Companion dispatch is never attempted — structural types have no home module (Modules §2). |
| **Nominal type `T`** (record, union, opaque, built-in collection) | **Collision check first** (§6): if `name` is claimed by more than one of — a field of `T` *visible at this site*, an exported companion operation of `T`, an honored constraint member of `T` (§4.2) — hard error naming every claimant. Exactly a visible field → field call, as the structural case. Exactly a companion operation → **rewrite**: `CompanionOf(T).name(e, args…)`, thereafter an ordinary qualified call — arity, types, constraints, dictionaries all proceed as if the user had written it. Exactly an honored member → **member dispatch**: the call elaborates as the member applied to `(e, args…)` with the `C<T>` instance selected by coherence — the same elaboration as the bare call at a concrete type (Constraints §6.1). None → the neither-error (§9, row 4), with near-miss suggestions drawn from the field, companion, and member sets. |
| **Primitive** (`Int`, `Nat`, `BigInt`, `Float`, `String`, and compiler-known nominals like `Range`, `Seq`, `JsValue` — the last added with #511, classification only: its companion ties by rule, §4.1's boundary row, not by the five primitives' source-migration story below) *(`Bool` moved to the nominal row — reclassified as a prelude union 2026-07-29, #147; see the note under §4.1. `Nat` and `BigInt` added to this row with #304/#335 — the rows ascription.md §6.1 recorded as this arc's debt. `Unit` retired to the tuple row with #344 — it is the empty tuple (#159), and its listing here was a pre-#159 anomaly; no `Unit.hex` exists or ever will)* | As the nominal case, with `CompanionOf` the fixed prelude companion (§4.1). No fields exist, so the collision surface is export-vs-member only. Every companion supplies both halves as ordinary source (`BigInt.hex`, then `Int.hex` and `Nat.hex`, then `Float.hex` and `String.hex` — #344, migration complete): `42n.show()` is `Show`'s member at `BigInt`, `n.div(2)` is `Integral`'s member at `Int`, `1.5.show()` is `Show`'s member at `Float` through `stdlib/Float.hex`'s own `honor` block. |
| **Tuple** (including `Unit`, the empty tuple — #159, #344) | `name` of the form `itemN` → the existing positional interpretation (Products §2.3) followed by a call, i.e. `(t.itemN)(args…)`; the component must be callable. Any other name → the existing tuple-dot errors. Tuples have no companions (§5); nothing new. |
| **Function type** | Error: functions have no fields and no companion (§5). |
| **Declared type variable** *(row amended for #304/#335 — see §16.2; was a blanket refusal)* | **Bound-member dispatch.** If `name` matches exactly one subject-first member of the variable's declared bound constraints (bases included, Constraints §2.1), the call elaborates as that member applied to `(e, args…)`, evidence-dispatched through the binder's dictionary — `x.compare(y)` under `a: Ord` is `compare(x, y)`. More than one match → the §6-family refusal naming each member's qualified home (the bare spelling where a home is the current module — §6). No match → the bespoke type-variable diagnostic (§9, row 7): the bounds are the *entire* candidate set — no instance search, no companion consultation — so the fallback's row constraint is never imposed on a declared variable. |

### 3.5 The row fallback — semantics, not heuristic

**The defaulting step comes first** *(#304)*. Numeric Literals §4's defaulting was always scheduled at this same boundary ("inside the generalisation step"); this amendment fixes the order within it: defaulting runs **before** the row fallback. A surviving goal whose receiver tyvar carries a non-empty, entirely defaultable constraint set settles to `Int` and resolves as dispatch — `42.show()` is `Show`'s member at `Int`, exactly as bare `show(42)` is. The amendment reclassifies no compiling program: every program it touches was a guaranteed error under the old order (the imposed row meets the receiver's `Num`-family constraints, and a row can honor nothing — instance heads name constructors, Constraints §5.4). The receiver's constraint set is what it is at the deadline, however it arose — a literal's `Num`, a bare member call's `Show` — one rule, no literal-only carve-out.

A goal whose receiver is still an unsolved (flexible) tyvar after the deadline fixpoint **and the defaulting step** resolves as **field access**: impose

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

Under the receiver-level deadline (§3.1), the asymmetry is **cross-region only**: within one region, evidence anywhere counts — `fun f(v) = { let x = v.at(3); Vector.length(v) }` resolves the dot call as companion dispatch, textual order irrelevant **for dispatch**. *(#513.)* For the arguments' expected types the order does matter: only a receiver head-known **at the dot** resolves before argument elaboration and supplies them (§2.2); evidence arriving later still resolves the dispatch identically, but cannot retroactively hand expectations to arguments already checked — those synthesized (Functions §4.3), and a match-function argument among them takes Pattern Matching §6.1's refusal with its rider. (Test §14(d) pins the dispatch half.) The fallback fires only after *all* of a region's evidence is in, so a fallback row can never be contradicted later in its own region; the contradiction always surfaces at a use of the finalised binding — typically another binding or another module. One diagnostic obligation discharges the Rewrite Rule on this, the feature's ugliest corner:

**The post-finalisation contradiction** — the worst error this feature can produce, at maximal distance from its cause: `f` above finalises at the row type; `f(vec)` elsewhere fails with, naively, "`Vector` has no field `at`". Mandatory enrichment: whenever a nominal type `T` fails row-unification and the demanded field's name matches an exported companion operation of `T` **or a subject-first member of a constraint honored at `T`** *(member clause added with #304/#335 — `fun f(v) = v.show()` finalised at the row type, then applied to an `Int`, deserves the same rescue)*, the diagnostic must say **why the row exists and what to do**: *"`f`'s parameter was inferred as a record with field `at` because its type was unknown inside `f`; `Vector` is not a record. Annotate the parameter (`v: Vector(a)`) to use companion dispatch, or call `Vector.at` directly."* This fires on the unification failure regardless of where it surfaces — same module or across the program — keyed by the field-name/companion-name match. Acceptance test §14(g).

---

## 4. `CompanionOf` — definition

### 4.1 The function

`CompanionOf` is total over eligible receiver heads and requires no search:

| Receiver head | Companion |
|---|---|
| User nominal type (`record`/`union`, incl. `opaque`) | The type's **home module** — the file containing its declaration (Modules §7.2). Not the importer's alias, not any import path: the declaration site, unconditionally. Diagnostics and hovers *spell* it using the companion idiom (`Box.size`), which Modules §5.3 blesses. |
| Extern nominal type (`extern type` or `extern class`) | Its **binding module** — the file containing the extern declaration, hence its foreign type home. Exported subject-first receiver members form its companion operation set under §4.2 exactly like Hexagon-defined operations (FFI Part 5 §9). |
| `Int`, `Nat`, `BigInt`, `Float`, `String` | The fixed prelude companion of the same name (Modules §5.3: `Int.div` etc. — "one reading, not a special prelude device"). *(`Nat`/`BigInt` rows added with #304/#335; `Unit` left this row with #344 — the empty tuple takes the tuple story, §3.4.)* All five companions exist as source (#344 — `Float.hex` and `String.hex` completed the fixed migration order) and are the ordinary nominal case in every respect; Modules §5.3's transitional machinery retired with the last landing, and §6.4's qualified-home guarantee held throughout the migration. |
| Prelude nominal types (`Vector`, `Map`, `Set`, `Option`, `Result`, `Bool`, `Range`, `Seq`, `Ordering`, …) | Their prelude companion modules — the same rule as user nominals, since prelude types are declared in prelude modules; listed separately only to record that built-ins are *not* special-cased. The authoritative inventory is the stdlib listing's. |
| `JsValue` *(#511)* — and `Array(a)`, already eligible per Part 2 §13.1 | The fixed prelude companion of the same name. These boundary types are compiler-provided with no declaration site, so the tie is by rule — the primitive row's pattern: `v.kind()` and `v.toInt()` are `JsValue.kind(v)` and `JsValue.toInt(v)`; `xs.length()` is `Array.length(xs)`, and each further `Array` companion operation joins the set as it ships (Part 2 §9.1). No fields exist on such values, so the collision surface is export-vs-member only. |

*(Amended 2026-07-29, #147.)* `Bool` moved from the fixed-primitive-companion row to the prelude-nominal row here, and out of §3.4's **Primitive** row: since the ML-dialect ruling it is the prelude union `union Bool derives (Eq, Ord, Show, Hash) = False | True` (Unions §8), and its declaration lives in real prelude source whose home is the `Bool` companion module itself — the `Seq.hex` model (`decisions-ml-dialect-bool-2026-07.md` §3.5) — making this row's "built-ins are not special-cased" rule literally true of it. `CompanionOf(Bool)` is the same `Bool` companion module as before, and every dot call on a `Bool` receiver resolves exactly as before: **no dispatch outcome changes**. The move is recorded anyway because dot-call dispatch has proven sensitive to symbol classification (the #134 fun-versus-extern lesson): a resolver that classifies `Bool` by the wrong row is one refactor away from a real defect, and these tables are what it gets checked against.

### 4.2 The companion operation set

The dot-callable operations of a type `T` are exactly *(second clause added for #304/#335 — see §16.2)*:

> the functions **exported** by `CompanionOf(T)` whose **first parameter's type is `T`-headed**, **unioned with** the **subject-first members of every constraint honored at `T`**.

**A subject-first member** is one whose first parameter's declared type is the constraint's subject variable itself — `show(value: a)`, `compare(left: a, right: a)`, `div(left: a, right: a)` qualify; `fromNat(value: Nat): a` does not (the subject appears only in the return), so `42.fromNat(…)` is not a spelling and never will be. This is the member-side analogue of the `T`-headed test below, and equally syntactic: decidable per declaration, no unification consulted.

**Membership stays a declaration-indexing operation.** Coherence (Constraints §5.1) keys instances on (constraint, constructor) program-wide, so "constraints honored at `T`" is a table lookup with at most one instance per key — as total, deterministic, and import-insensitive as the export set. Where the two clauses (or two honored constraints) put one spelling in the set twice, the fused call form is refused naming every qualified home (§6); no ranking exists. Member dispatch elaborates as the bare member call at `T` would — evidence selected by coherence, erased where monomorphic uses erase (Constraints §6.1); the companion clause's rewrite target is `CompanionOf(T).name(…)` as before.

**`T`-headed is a syntactic test, not a unification question**: after expanding transparent aliases, the first parameter's outermost type constructor is `T` itself. Constructing the candidate set is therefore a **declaration-indexing operation** — decidable per declaration, once, with no speculative unification anywhere (many types *unify* with `T(…)`, starting with a fresh variable; none of that is consulted). *(Syntactic formulation: Sol.)* Worked examples:

```
map(v: Vector(a), f: a -> b): Vector(b)    -- included: outermost constructor is Vector
empty(): Vector(a)                           -- excluded: no first parameter
make(x: Float, y: Float): Point              -- excluded: first parameter not Point-headed
identity(x: a): a                            -- excluded: bare type variable, no constructor
```

- **Exported only, uniformly** — including inside the home module itself. Making private functions dot-callable inside-only would give a type a visibility-dependent method set; inside the home module bare calls are available anyway. (Alternative rejected, §11.9.)
- **The subject-first filter is nearly free**: the stdlib convention (Operators §8 — first parameter is the subject, normative) means companion modules are already shaped for this. `Vector.empty` is correctly invisible after a dot, per the table above.
- **No overloading exists** (one function per name per module — Modules §5.2), so each *clause* yields at most one candidate per name; where the union holds two, the call is refused naming both homes (§6) — never ranked. Arity and argument types are checked *after* resolution as an ordinary call, with ordinary errors. Resolution is by name; typing is by the resolved function or member. Within the honoring module itself the two clauses cannot even collide: an ordinary binding of a member's spelling is the rebinding error (Constraints §4.6), so an export-vs-member split there is unwritable — the cross-source collision requires the instance to live in the *constraint's* home under the orphan rule.
- The set is **import-insensitive**: whether the *call site's module* imported the companion is irrelevant to resolution (the compiler is whole-program; the home module is in the graph by reachability of the type, and instances are global once their module is — Modules §7.1). No `use`-changes-methods spookiness, by construction. Emission handles the import (§8.2).

### 4.3 Transparent aliases and `opaque`

- **A transparent alias inherits the expansion's companion.** `type Name = String` gives `Name`-typed values `String`'s operations, because a `Name` value *is* a `String` (aliases are transparent everywhere — Modules §6.2). An alias never introduces a companion identity of its own; a module declaring `type Name = String` contributes nothing dot-callable to `Name`. *(Clarification: Sol.)*
- **`opaque` types are the pattern working at its best**: outside the home module the fields are invisible (Modules §4.2), so no field/companion collision is even possible there, and every dot call is companion dispatch against the exported surface. Inside the home module fields are visible and the collision rule (§6) applies as usual.

### 4.4 Declaration order within the home module

§4.2's candidate set is indexed from declarations and is order-independent — *what* is dot-callable never depends on where in the home module an operation sits. Whether a given call site may **reach** a candidate is a separate question, and it has the same answer as every other reference (Functions §7.2):

- **A dot call is legal exactly where a reference to the operation is legal.** §1's rewrite makes this forced rather than chosen: `e.name(args…)` *is* a call of the companion operation — spelled qualified from other modules, bare in the home module, which cannot name itself — and that callee must be declared above the call site like any reference. Within the home module, then, a dot call may target only an operation declared **above** it. Call sites in other modules see the whole exported surface, as always — §4.2's import-insensitivity is untouched.
- **A dot call never targets a member of the caller's own `fun` block** (Functions §7.3): calls within a block are spelled by name. "Within" reads textually and at any depth — a dot call anywhere inside a member's body, a nested lambda or inner `fun` included, never targets that block, because any such call is a block edge the reference graph cannot see. Recursion, direct or mutual, therefore never hides behind a dot — and dispatch can never create a reference-graph cycle the resolver cannot see, which is what keeps §4.2 a declaration-indexing operation with no type-directed feedback into dependency analysis.

**Member-resolved dot calls are exempt from both rules** *(#304/#335)*. A dot call that resolves to an honored constraint member is an **evidence route**: it names no binding — elaboration reads a dictionary slot at call time — so it creates no reference-graph edge, and the top-down law governs name references only (Constraints §4.6). A member-resolved dot call is therefore legal anywhere in the honoring module: below the honor block, inside a sibling member, and inside the member's **own body**, where it is the sanctioned recursion spelling (`kid.show()` — the own-name refusal, Constraints §4.6, is what forces recursion out of the bare form). No honor-block analogue of the `fun`-block dot ban exists, and the asymmetry is principled, not an oversight: the block's ban protects the resolver's reference graph from edges dispatch would hide, and member dispatch never enters that graph — mutually referencing instances were already legal through interpolation for the same reason. The emission fault line for instance recursion (safe inside member lambdas, a fault before the instance's own `const` initializes) is Constraints' §6.3 territory and is unchanged by the spelling.

Neither rule disturbs §3's order-independence of *inference*: §14(d)'s "evidence anywhere in the region counts" is about where the receiver's **type** becomes known, and stands. Declaration order constrains which declarations a resolved call may name, not how the receiver's head is discovered.

Diagnostics: an operation that exists in the companion but sits below the call site, or inside the caller's own group, is reported as exactly that (§9 rows 12–13) — never as "the companion has no operation", which would be false.

---

## 5. Coverage

*(Category list: Sol's formulation, adopted with the tuple/record clarifications.)*

**Eligible receivers (companion dispatch can fire):**

- nominal records — including `opaque`;
- nominal unions — no field access exists on union values, so no collision surface; the cleanest receivers the feature has (`option.getOrElse(default)`, `result.map(f)` — still static companion calls, not object methods);
- extern nominal types and extern class types — their binding module is the companion, and their opaque values expose no Hexagon fields (FFI Part 5 §9);
- prelude nominal collection and utility types (`Vector`, `Map`, `Set`, `Option`, `Result`, `Seq`, …) — `Range` is head-known but has no companion module today, so no dot fires on it and its conversion is spelled `Iterable.toSeq(range)` (§4.1's authoritative inventory is the stdlib listing's);
- primitives, through the fixed prelude companions (`"a,b".split(",")`, `n.toFloat()` — inventory per stdlib listing) and their constraint instances — all source since the migration completed, #344 (`42n.show()`, `n.div(2)` — §3.4's primitive row);
- `JsValue`, `Array(a)`, `JsMap(k, v)`, and `JsSet(a)` — compiler-provided boundary types tied to their fixed prelude companions by rule *(#511, #792; §4.1's row)*: `v.kind()`, `v.toInt()`, `xs.length()`, `m.get(k)`, `s.contains(x)` (Part 2 §13.1 — companion dispatch today; each further `Array` companion operation joins as it ships, Part 2 §9.1; FFI Part 10 §3's surfaces are `JsMap.hex`'s and `JsSet.hex`'s exports); their values expose no Hexagon fields, so no collision surface; `Nullable` is not settled here;
- **declared type variables, for bound-member dispatch only** *(moved from the ineligible list for #304/#335 — §16.2)*: `x.compare(y)` under `a: Ord` dispatches through the binder's evidence; the candidate set is the declared bounds and nothing else — no companion exists or is consulted;
- transparent aliases of any of the above, via expansion (§4.3).

**Ineligible (dot never means companion dispatch):**

- structural records — dot is field access there, full stop; "excluded" means excluded from *companion dispatch*, while `x.run(3)` on a callable field remains fully supported by ordinary row machinery;
- tuples — except the existing compiler-defined `itemN` positional access (Products §2.3), which §3.4 folds in unchanged;
- function types;
- **flexible** type variables — they take the defaulting step, then the fallback (§3.5); a declared variable whose bounds hold no matching member is refused, never row-constrained (§3.4);
- structural aliases *as such* (they defer to their expansion — §4.3).

---

## 6. Field/method collision — hard error at the use site

*(Extended for #304/#335: the honored-member clause of §4.2 adds a third candidate source. The law is unchanged in kind — any two of {visible field, companion export, honored member} claiming the fused call form is the same hard error, naming every claimant with its disambiguating spelling: the qualified companion call, the field spellings below, the member's qualified home (its declaring module — `Show.show(x)`), or, where two honored constraints collide, each declaring module's spelling. Where a claimant's declaring module **is the current module**, no qualified spelling exists — a module cannot name itself — and the refusal names the bare spelling in its place, which is unambiguous there: the declaration's member is the module's own binding, and consequence-5's import shapes keep any rival out of bare scope. Member-vs-member ambiguity on a declared type variable takes the same refusal shape, §3.4.)*

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

### 6.1 One claimant under the generalisation law *(#541)*

The refusal above counts **claimants**, and Modules §5.3's generalisation law changes what counts as one: a companion's `widens` binding and the member it supplies (Constraints §4.7 — the member is the binding's derived restriction) are **one claimant, not two**. They are one operation wearing two widths, so there is nothing to disambiguate and nothing to rank: the dot call resolves as the companion-operation rewrite, `CompanionOf(T).name(e, args…)`, which under Modules §5.3's resolution order is the **widens binding** — the operation's widest face. `x.pow(0.5)` at `Float` and `x.pow(2n)` at `BigInt` are therefore ordinary dot calls, not collisions (Operators §6.3.1). A list-form declaration (`widens Pow.pow, Mul.pow(…)`) is the same fact at more members: every listed member is the one body's restriction, so the whole family is one claimant and the dot shows the one widest face. The no-ranking doctrine (§1) is untouched: it refuses genuinely rival sources, and the law's whole content is that these are not rivals — same-spelled members from distinct honor blocks with no `widens` declaration over them remain genuine rivals, count their full number of claimants, and are refused exactly as before.

---

## 7. Constraint members are dot-callable — through instances and bounds, never through search

*(Rewritten for #304/#335 — this section previously excluded members from dot syntax entirely; §16.2 records the reversal and what made it sound. The exclusion's real target — instance search on unknown types, import-sensitive method sets — remains excluded below.)*

`show`, `compare`, `div`, `add`, … are constraint members, and since the members-as-values ruling (Constraints §2.2) they are ordinary module-scope values with declaring-module homes. Dot syntax reaches them through exactly two doors, both already open in the resolution table (§3.4):

- On a **head-known receiver**, the operation set includes the subject-first members of constraints the receiver's type honors (§4.2). `42.show()` (after the defaulting step), `(42: Nat).show()`, `42n.show()`, `42.0.show()`, `n.div(2)`, `r1.add(r2)` — each is the member at that type, the instance selected by coherence, elaborated as the qualified call at that type would be. No companion module is consulted or required.
- On a **declared type variable**, the candidate set is the variable's declared bounds — `x.compare(y)` under `a: Ord` dispatches `compare` through the binder's dictionary (§3.4's amended row). The bounds are written in the header; nothing is searched, nothing is imported, and an unbounded or unmatched variable is refused with the options message (§9 row 7), never row-constrained.

What stays excluded, and the sentence that guards it: **dot syntax never *discovers* a member — it dispatches members the receiver's type or bounds already own.** On a flexible tyvar the goal takes the defaulting step and then the fallback; no instance table is scanned to guess a receiver type (member names never nominate — §1); no import adds or removes a member from any receiver's set (coherence is whole-program). The §11.7 rejection was of extension-trait machinery; bounds and honored instances are the opposite of that machinery — closed, declared, orphan-ruled sets.

Two footnotes the old text carried, updated: a companion cannot export a monomorphic subject-first `show(x: Int): String` at all — inside the honoring module that spelling is the unconditional rebinding error (Constraints §4.6, #546); the member's wider face, where one exists, is a `widens` declaration (Constraints §4.7), which the dot reaches as one claimant (§6.1). The stdlib-listing question "monomorphic `show` companions?" (§12.4) is settled by construction: the member **is** the operation — identically, or as the widens binding's derived restriction — and a duplicate export is unwritable. The guide's teaching gains a spelling rather than changing: bare (`show(x)`), piped (`x |> show`), qualified (`Show.show`, `Int.show`), and — on known types and bounded variables — the dot.

---

## 8. Emission, `.d.ts`, and the LSP

### 8.1 Dot calls vanish

Resolved companion dispatch is an ordinary qualified call before lowering; **the dot-call node does not survive into codegen**. Emission is whatever the equivalent hand-written call emits:

```
v.at(3)          -- emits: at(v, 3)         (named import per Modules §11)
opt.getOrElse(0) -- emits: getOrElse(opt, 0), or its established inlining
r.callback(3)    -- (field call) emits: r.callback(3)   — the honest POJO read
```

Field-resolved dot calls emit *as themselves* — a JS property access and call on a POJO, which is exactly what the semantics is. Companion-resolved calls retain the resolved declaration's ordinary lowering: a Hexagon-defined operation emits the named-import call, subject to established inlining rights, while an extern receiver member retains its FFI linkage and may emit a receiver call or property access directly (FFI Part 5 §9). **Member-resolved calls emit exactly what the bare member call emits at the same type** (Constraints §6.1/§6.5): the concrete instance's slot where selection erases, the forwarder with passed evidence where it does not — the dot spelling adds no emission shape of its own. Method Syntax itself adds no runtime method, prototype change, or hidden `this`.

### 8.2 Imports

If a call site's module never textually imported the companion, the emitter adds whatever dependency the resolved declaration's lowering requires — normally the companion's named import under Modules §11, or the foreign module import/linkage required by an extern receiver member. Emitted-name collisions are the emitter's ordinary renaming problem, not a semantics question.

### 8.3 `.d.ts`

Nothing to represent: the emitted functions have the signatures they always had, and no method appears on any emitted type. The `.d.ts` story is byte-for-byte what it was before this spec.

### 8.4 LSP obligation

Completion after `receiver.` must be driven by **the same resolution model**, at the current inference state: head-known nominal → visible fields ∪ companion operation set — honored members included, marked as members (§4.2); declared type variable → the subject-first members of its bounds; record row → known fields; unsolved flexible tyvar → no companion candidates, and the hover may suggest an annotation to unlock completion. Opportunistic resolution (§3.2) is what makes mid-chain completion (`v.map(f).|`) work; this is a design requirement on the checker's incremental behaviour, not a nicety. The discoverability payoff for the target audience is a first-class motivation of the feature and the LSP row is therefore normative, not advisory.

---

## 9. Diagnostics checklist

| # | Situation | Error / hint |
|---|---|---|
| 1 | Field/method collision at dot-call form | the §6 message: name both interpretations; always offer `T.name(e)`; offer `(e.name)()` only if the field is callable, else point at bare `e.name` for the access |
| 2 | Structural receiver, no such field | existing missing-field error (Products §3.2 family) — companion dispatch never mentioned |
| 3 | Field resolved but not callable / wrong arity | the not-callable report, phrased against the field the way the mark reports name it — "`.at` is not a function — it has type `Int`, and this call supplies 1 argument" (#385; no arrow appears — a demanded arrow's colour is a claim about a call that does not exist); wrong arity keeps the ordinary arity error |
| 4 | Nominal receiver, name is no field, companion op, or honored member | "`Vector` has no field `at2`, module `Vector` exports no operation `at2`, and no constraint honored at `Vector` has a member `at2`" + near-miss suggestions from all three sets |
| 5 | Companion op exists but first parameter is not `T`-headed; or a member exists but is not subject-first | treated as row 4 (neither is in the operation set) — but hint at the near-miss: "`Vector.empty` does not take a `Vector` as its first argument; call it as `Vector.empty(…)`" / "`fromNat` does not take its constraint's subject first; call it as `Num.fromNat(…)`" |
| 6 | Dot call resolves to two claimants (field/export/member, member/member — head-known or declared-variable receiver) | the §6-family refusal: name every claimant with its disambiguating spelling — `Box.size(box)`, the field spellings, the member's declaring-module home (`Show.show(box)`), or the bare spelling where a claimant is declared in the current module (§6) *(row repurposed by #304/#335 — the old row-6 redirect died with §3.4's amended row: that case now dispatches)* |
| 7 | Dot call on declared type variable, no subject-first member in its bounds | "`a` is a declared type variable, so `.process` can only be one of its constraints' members, and none of `a`'s constraints has a subject-first member `process`; add the constraint to the parameter's binder, use a concrete nominal type, or call a qualified function" (§3.4, §7) |
| 8 | Post-finalisation row-vs-nominal failure with matching companion op or honored member (any distance — same module or across the program) | the §3.6 enriched message — mandatory whenever the field name matches an exported companion operation of, or a subject-first honored member at, the failing nominal type. Same-region contradictions are unreachable under the receiver-level deadline (§3.6) |
| 9 | Tuple receiver, non-`itemN` name | existing tuple-dot errors (Products §2.3), unchanged |
| 10 | Function-typed receiver | "functions have no fields or companion operations" |
| 11 | Uppercase name after dot with an argument list where left side is not a module alias | existing Modules §5.1 resolution/errors, unchanged — not this feature |
| 12 | Companion op exists but is declared below the call site (home module only) | "`Box`'s companion declares `twice` below this call; declarations are read top-down — move the declaration above this call" (§4.4; Functions §7.2 family). Never row 4's "no operation" |
| 13 | Dot call targets a member of the caller's own `fun` block | "a dot call cannot target its own `fun` block; spell the call by name: `map(s, f)`" (§4.4; Functions §7.3) |

Vocabulary rules: diagnostics say **companion operation** and **constraint member** (never "method" — nothing method-like exists at runtime, and the noun would teach the wrong model) and never say "row" (Products §4 ban, still in force). "Dot call" is acceptable in hovers and docs.

---

## 10. The Deferred-Goals Doctrine (adopted)

Stated here as corpus doctrine; hosted in the Declarations Preamble on consolidation (edit note §15). *(Formulation: Sol, adopted near-verbatim.)*

> **Deferred inference goals are exceptional.** Each kind must have a finite, deterministic resolution rule; must not search globally; must not survive generalisation; and must preserve principal types.

The doctrine retroactively describes machinery already in the corpus — literal defaulting (Numeric Literals §4: deterministic rule at generalisation), the compiler-known Iterable table (Loops §7: unsolved tyvar at the boundary is an annotation-required error), the projection-bearing-constraint ban (Collections Part 2 §7: v1 refuses the goal category it cannot yet resolve this way) — which is the mark of a doctrine rather than a patch. It also sets the bar v2's implied-type projection inference must clear before it exists.

**DotCall's compliance, itemised:** one receiver variable per goal; one member name; resolution is field, unique companion operation, or unique honored/bound member — duplicates refuse, nothing ranks, nothing searches globally (the instance table is coherence-keyed and the bounds are declared — §3.4, §4.2); goals cannot survive their owner region's finalisation (the defaulting step and fallback are total in sequence, the pinning rule keeps entangled variables out of inner quantification, and finalisation applies even where the value restriction prevents quantification — §3.1, §3.5); principal types are preserved because the unresolved form has a *defined* meaning identical to the pre-feature language (§3.5 — the defaulting step reorders two rules already at the boundary and reclassifies only guaranteed-error programs), and opportunistic early resolution provably agrees with deadline resolution by monotonicity (§3.2). There is no generalized "has-method" constraint in the type language; `DotCall` is checker state, never a type.

Any future ergonomic feature that wants the inferencer to postpone a decision cites this doctrine or returns to design.

---

## 11. Rejected alternatives

1. **Lexical UFCS (D-style: `v.at(3)` → bare-scope `at(v, 3)`).** Rejected: Hexagon's collection operation names deliberately collide across companion modules and are normally module-qualified, so the bare name is usually absent or wrong; resolution would become import-sensitive; the pipe already serves bare functions; and lexical lookup provides no receiver-based completion — the feature's chief payoff. *(Rationale list: Sol.)* **Do not relitigate.**
2. **Rust's resolution machinery.** Recorded with the free/real split so the spec claims credit only where restraint was exercised. *Structurally inapplicable (free):* the deref/auto-ref ladder (no references exist), inheritance (none exists), implicit borrowing (none exists). *Genuinely rejected (real):* trait-method candidates / extension traits — the source of Rust's import-changes-methods spookiness; one candidate set here, ever — and any ranking of multiple candidates (none can exist, §4.2). **Do not relitigate the extension-trait exclusion**; it protects the Sol-review §B invisible-instance analysis.
3. **Eager resolution at the dot** ("dispatch if the receiver's type happens to be concrete when elaboration reaches the expression"). Rejected: makes meaning depend on Algorithm J's traversal order, destroying order-independence — the property the deferred-goal design exists to keep. Disqualified, not merely disfavoured. **Do not relitigate.** **[Not reversed by §2.2's #513 ordering.** What this entry disqualifies is dispatch — the choice of operation, or the fallback's firing — depending on arrival time. §2.2's head-known-at-the-dot rule resolves early only where §3.2's monotone trigger proves the same resolution would happen later; the one thing that rides on the moment is whether the arguments receive expected types, which is Functions §4.3's own normatively scheduled surface: a seat whose expectation arrives late synthesizes at that seat, exactly as the schedule states, and is never differently-dispatched.**]**
4. **Fields-win silent priority** at collisions. Rejected: adding or exposing a field would silently change which operation an existing call invokes, and a new companion export could be invisibly masked. Loud beats silent; no-warning-tier temperament. *(Consequence analysis: Sol.)*
5. **Declaration-time collision ban** (home module may not export a subject-first function named like a field). Rejected in favour of use-site (§6): it charges library authors for a feature their consumers may never use, breaks at a distance when a field is added, and its only cure is renaming a *public* export — worse churn than call sites qualifying. Revisit only with field evidence that use-site breakage under library evolution (§6, last bullet) is a real ecosystem pain.
6. **Bound-method values** (`v.at` as `() => Vector.at(v)`-ish, or any method reference). Rejected: implicit closure allocation, hidden receiver capture, equality-of-bound-methods questions, and a reintroduction of partial application through the back door. Not merely "Hexagon lacks currying" — a non-curried language *could* invent bound methods; Hexagon has no reason to. `map(vs, Vector.reverse)` stays qualified. *(Rationale: Sol.)* **Do not relitigate.**
7. **Constraint-member dispatch through dot** (`x.show()` resolving via instances on unknown or known types). Rejected for v1 and pre-registered as the feature's slippery slope: it is precisely extension-trait machinery, makes the method set depend on constraint solving, and taxes the bare-call doctrine (Sol-review §A) for nothing the LSP doesn't already provide. Revisit bar: §12.1. **[Reversed in part — §16.2.** The members-as-values ruling (#335) gave members declaring-module identities and export status, which is what this rejection said no scheme had: dispatch on *head-known* types and *declared bounds* is now table-lookup against coherence-keyed instances and written binders — no unknown-type dispatch, no constraint solving in the method set, no import sensitivity. The **unknown-type half stands rejected**: a flexible receiver still takes the fallback, and member names still never nominate.**]**
8. **A soundness precondition on the row fallback** ("apply the fallback only if row inference can soundly produce a callable-field requirement; otherwise reject"). Rejected as a phantom check: the fallback constrains and never rejects; unsatisfiable results (e.g. constraints a row cannot honor) error through existing constraint-discharge paths with existing phrasing. Zero new code paths. *(Amends Sol's formulation.)*
9. **Private functions as dot-callable inside the home module.** Rejected: a visibility-dependent operation set; bare calls are available there anyway. Exported-only, uniformly (§4.2).
10. **Per-binding deadline** ("the goal is attached to the binding currently being inferred and resolves at its boundary"). Rejected: for a goal whose receiver lives at an outer level, an inner `let`'s boundary would fire the fallback on the outer variable prematurely — making `let x = v.at(3); Vector.length(v)` an error while its reordered siblings compile. Statement order between independent siblings would change meaning: the order-sensitivity that disqualified eager resolution (§11.3), reintroduced at binding granularity. The receiver-level deadline (§3.1) is the correct owner; see the correction record §16.1. **Do not relitigate.**

---

## 12. Hanging questions

1. **Dot access to constraint members, ever?** ~~Closed for v1 (§7, §11.7).~~ **Answered (#304/#335): yes, through instances and bounds** (§7, §16.2). The reopen bar this item set — a design satisfying §10's no-global-search, no-import-sensitivity test — was met not by a dispatch scheme but by the members-as-values ruling changing what members *are*. The predicted audience pressure arrived on schedule (#304's table was the forcing exhibit); the answer it got is narrower than the Rust machinery this item feared, and the unknown-type case stays closed.
2. **Method references / bound methods** (`v.at` as a value). Rejected (§11.6); recorded here only because TS users will ask. Reopen condition: none foreseeable; the pipe and lambdas (`x => Vector.at(v, x)`) cover every use.
3. **Companion operations on `Range`/`Seq` inventory** — which exports exist is the stdlib listing's; this spec only guarantees the mechanism reaches them (§4.1).
4. **Monomorphic prelude `show`/`toString`-style companions** (`3.show()` via `Int.show : Int -> String`) — **settled by construction (#304/#335)** (§7): `3.show()` is `Show`'s member at `Int`, and `Int.show` is the member's qualified spelling through the honoring companion (Modules §5.3); a duplicate monomorphic export is the rebinding error in the honoring module and the §6 refusal across modules. Nothing is left for the stdlib listing to decide here.
5. **The three-spellings style question at scale.** §1/§9 fixes the doctrine; whether real codebases fragment anyway is empirical. Watch during dogfooding; the formatter/linter (if one ever exists — there is no warning tier) is *not* the answer; guide pressure is.

---

## 13. Decisions log

| Decision | Where |
|---|---|
| Semantics = one rewrite to companion call; static, erased, no runtime methods/`this`/prototypes | §1, §8 |
| Home-module dot calls obey declaration order — legal exactly where the qualified spelling is; a dot call never targets the caller's own `fun` block | §4.4 |
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
| Operation set = exported ∧ subject-first (unioned with honored subject-first members since #304/#335 — row below); **`T`-headed is syntactic** (outermost constructor after alias expansion; declaration-indexing, no speculative unification); uniform inside/outside home; duplicate claimants refuse, never rank | §4.2 |
| Transparent aliases inherit the expansion's companion; aliases introduce no companion identity; `opaque` collision-free outside home | §4.3 |
| Coverage: nominal records/unions/prelude nominals/primitives/aliases in; declared tyvars in for bound-member dispatch (#304/#335, §16.2); structural records (fields only), tuples (`itemN` only), functions, flexible tyvars out | §5 |
| Collision: **hard error at use-site**, name-based (non-callable fields collide too), visibility-scoped; **fixits conditional on field callability**; declaration-time ban rejected; evolution fragility recorded eyes-open | §6, §11.4–11.5 |
| ~~Constraint members not dot-callable; companion dispatch cannot be selected through an abstract receiver type; rigid-tyvar redirect; monomorphic `show` exports stdlib-listing's call~~ **Superseded** by the three member-dispatch rows above (#304/#335, §16.2) — the never-nominate and flexible-receiver halves survive in them | §7, §16.2 |
| Emission: dot node dead before lowering; field calls emit as themselves; companion calls emit named-import calls; emitter may add imports; `.d.ts` unchanged | §8.1–8.3 |
| LSP completion driven by the same resolution model — normative | §8.4 |
| Diagnostic noun: "companion operation", never "method"; "row" ban still holds | §9 |
| **Deferred-Goals Doctrine adopted**; DotCall's compliance itemised; hosted here pending Preamble consolidation | §10 |
| Nine rejected alternatives incl. eager resolution, fields-win, bound methods, fallback pre-check | §11 |
| `Bool` reclassified out of the Primitive rows to the prelude-nominal path (#147); `CompanionOf(Bool)` = the `Bool` companion module, now also the declaration's home; dispatch outcomes unchanged — classification hygiene, recorded against the #134 lesson | §3.4, §4.1 |
| **Operation set unions honored subject-first members** (#304/#335); membership stays declaration-indexed via coherence; two claimants on one spelling refuse naming homes — no ranking | §4.2, §6, §16.2 |
| **Declared type variables dispatch bound members** (`x.compare(y)` under `a: Ord`); bounds are the entire candidate set; no match refuses, never row-constrains; old blanket refusal reversed | §3.4, §7, §16.2 |
| **Defaulting step precedes the row fallback** at the deadline (`42.show()` is `Show<Int>`'s member); reorders two boundary rules; reclassifies only guaranteed-error programs | §3.3, §3.5 |
| **Member-resolved dot calls are evidence routes**: exempt from declaration order and the own-block ban; the sanctioned recursion spelling inside member bodies; no honor-block dot ban exists | §4.4; Constraints §4.6 |
| Member dispatch emits what the bare member call emits; the dot adds no emission shape | §8.1 |
| `Unit` retired from the Primitive rows to the tuple row (#344): the empty tuple (#159) takes the tuple story; no `Unit.hex` exists or ever will | §3.4, §5 |
| Primitive companions become source per companion (#344): each migrated companion is the ordinary nominal case; the fixed migration order (`BigInt.hex`, then `Int.hex`+`Nat.hex`, then `Float.hex`+`String.hex`) is **complete** and no wired instance remains | §3.4, §5; Modules §5.3; Constraints §5.3 |
| Head-known-at-the-dot resolution precedes argument elaboration (#513): the resolved member's signature supplies argument expectations (Functions §4.3); unsolved receivers keep the pending-goal path with synthesized arguments; dispatch outcome unchanged in both moments, §11.3's rejection intact | §2.2, §3.2, §11.3 |
| `JsValue` is an eligible receiver through its fixed prelude companion (#511) — these compiler-provided boundary types tie to companions by rule, the primitive pattern; `Array(a)`'s clause records the eligibility Part 2 §13.1 already reads; `JsMap(k, v)` and `JsSet(a)` joined when their companions shipped (#792); `Nullable` not settled | §3.4, §4.1, §5 |

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
f({callback = n => n + 1})          -- OK : Int

-- (d) Same-region evidence counts, regardless of textual position (§3.1)
fun g(v) =
    let x = v.at(3)                  -- goal pends; receiver tyvar owned by g's region
    Vector.length(v)                   -- v := Vector(a): trigger fires, goal resolves
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
let b = Box({size = 3})
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

-- (j) Declared type variable with a matching bound member: dispatch
--     [flipped by #304/#335 — was the row-6 redirect; §16.2]
fun cmp<a: Ord>(x: a, y: a) =
    x.compare(y)                     -- OK : Ordering — `compare` dispatched through
                                   --   the binder's `Ord` evidence; same elaboration
                                   --   as the qualified call at that type

-- (j2) Declared type variable, no matching member: the options message
fun go(x: a) =
    x.process()                      -- ERROR (row 7): `a` is a declared type variable,
                                   --   so `.process` can only be one of its
                                   --   constraints' members, and none of `a`'s
                                   --   constraints has a subject-first member
                                   --   `process`; add the constraint to the
                                   --   parameter's binder, use a concrete nominal
                                   --   type, or call a qualified function

-- (j3) The four-row #304 table: member dispatch on primitives
42.show()                          -- OK : "42"  — defaulting step settles Int (§3.5),
                                   --   Show<Int>'s member
(42: Nat).show()                   -- OK : "42"  — head-known Nat, Show<Nat>'s member
42n.show()                         -- OK : "42"  — head-known BigInt, Show<BigInt>'s member
42.0.show()                        -- OK : "42"  — head-known Float, Show<Float>'s member
7.div(2)                           -- OK : 3     — defaulting settles Int; Integral's
                                   --   member at Int, no companion module involved

-- (j4) Member ambiguity: two honored constraints claim one spelling
-- loud.hex: constraint Loud<a> = volume(x: a): Int  ;  honor Loud<Gauge> = ...
-- soft.hex: constraint Soft<a> = volume(x: a): Int  ;  honor Soft<Gauge> = ...
g.volume()                         -- ERROR (row 6): both `Loud`'s member and `Soft`'s
                                   --   member claim `volume` at `Gauge`; write
                                   --   `Loud.volume(g)` or `Soft.volume(g)`

-- (k) Nominal union receiver (no field surface, no collision possible)
let o: Option(Int) = Some(3)
o.getOrElse(0)                     -- OK : Int   (companion: Option.getOrElse)

-- (l) Transparent alias inherits companion
type Name = String
let n: Name = "hex"
n.length()                         -- OK : Int   (String's companion; `Name` adds none)

-- (m) Opaque outside home: pure companion surface
-- point.hex: opaque record Point = {x: Float, y: Float}
--            export fun getX(p: Point): Float = p.x
p.getX()                           -- OK : Float  (outside home; field x invisible,
                                   --   no collision possible)
p.x                                -- ERROR: existing opacity error (Modules §4.2)

-- (n) Defaultable receiver + unknown name: the defaulting step reroutes the error
--     [updated with #304 — was the row-vs-Num discharge error; the defaulting
--      step now settles the receiver first, §3.5]
fun m(x) = Num.multiply(x, x.total(1)) -- x gets Num (from multiply); at the deadline the
                                       --   defaulting step settles x := Int, the goal
                                       --   re-fires, and `total` is no field, companion
                                       --   operation, or honored member of Int —
                                       --   ERROR (row 4). Same program, same refusal,
                                       --   now phrased against Int rather than a row

-- (o) Field-resolved dot call emits as itself
fun run(r: {step: Int -> Int, ...}) = r.step(1)
                                   -- emits: r.step(1)   — POJO read, honest JS

-- (p) The pinning rule: inner generalisation around a pending goal (§3.1)
fun f(v) =
    let g = x => v.at(x)             -- g is a syntactic value; generalises WITHOUT
                                   --   quantifying the goal's result tyvar (pinned
                                   --   to f's region)
    Vector.length(v)                   -- v := Vector(a): goal resolves as companion
    g(1)                             -- OK : a   — g : Int -> a after resolution

-- (q) Post-fallback resumption: survivor rows connect by ordinary unification (§3.3)
fun w(x) = x.make().run()          -- OK — both goals take the fallback at w's
                                   --   boundary; make's result row unifies with
                                   --   run's receiver row; w is row-polymorphic

-- (r) Home-module declaration order (§4.4): declared-below is its own error
-- box.hex: export record Box = {value: Int}
--          export let use(b: Box): Int = b.twice()   -- ERROR (row 12): `Box`'s
--                                                    --   companion declares `twice`
--                                                    --   below this call; move it above
--          export let twice(b: Box): Int = b.value * 2
-- Reordered (twice above use): OK — and from any OTHER module, b.twice()
-- is OK regardless of where twice sits in box.hex (§4.2 import-insensitivity).

-- (s) Own-block dispatch ban (§4.4): recursion is spelled by name
-- seq.hex (home of Seq):
-- export fun map(s: Seq(a), f: a -> b): Seq(b) =
--     ... s.map(f) ...                               -- ERROR (row 13): a dot call
--                                                    --   cannot target its own `fun`
--                                                    --   group; spell it map(s, f)
```

---

## 15. Edit notes to companion documents

*(House rule: pending notes live here; applied on next touch of the target.)*

- **declarations-preamble.md** — host the **Deferred-Goals Doctrine** (§10) alongside the Rewrite Rule on consolidation, citing literal defaulting, the Iterable table, the projection ban, and DotCall as its instances.
- **operators-logic-precedence.md** — §10 (postfix forms): note that `e.name(args…)` with non-uppercase-start `name` creates the DotCall goal of this spec; `(e.name)(args…)` remains two postfix operations. §14 (`.` token): one cross-reference line; token unchanged.
- **products.md** — §3.2: one line — the fused dot-call form defers via this spec's goal and *means* field access whenever the receiver is not head-known-nominal; Tier-0 inference results are unchanged. §2.3: `itemN` folded into the goal's resolution table with identical behaviour.
- **modules.md** — §5.3 (companion idiom): note that method syntax makes the idiom load-bearing — `CompanionOf` targets the home module of §7.2. §11: emitter may add named imports for companion-resolved calls at sites that never textually imported the companion.
- **constraints.md** — §2.2: the call-style doctrine now names four spellings (bare, piped, qualified, dot — this spec §7 owns the dot's mechanics); §4.6 hosts the member-binding law the dot's exemptions cite. *(Applied with this amendment.)*
- **loops-ranges-iteration.md** — §7: note the Iterable table is now one instance of the Deferred-Goals Doctrine; behaviour unchanged.
- **stdlib listing (on creation)** — inherits: (i) the subject-first convention now also determines dot-callability (§4.2); (ii) ~~decide the monomorphic per-type `show`-style companion exports question~~ *settled by construction (§7, §12.4, #304/#335)*; (iii) companion inventories for `Range`, `Seq`, primitives — member spellings excluded, they are the constraints' own (§4.2).
- **hexagon-for-typescript-coders.md** — new chapter after Pipes: dot calls as "the method syntax you expected, without the objects" — teach the rewrite, the three-spellings doctrine for companion operations (§1/§9 wording) and the member four-spellings beside it (§7's closing sentence), the cross-region annotation asymmetry with examples §14(e)/(g), and member dispatch per §7: the dot works on known types and bounded variables, and a flexible receiver takes the fallback — there is no `x.show()` redirect anymore. *(Clause updated with #304/#335 — discharging the note as first written would have shipped the reversed rule.)* Permitted guide phrasing (Sol): *"Hexagon's method syntax provides a UFCS-like surface, but uses type-directed companion lookup rather than lexical UFCS"* — the spec's flat "this is not UFCS" stays in the spec. Parallel examples must mirror pipe-chapter conventions.
- **spec-roadmap.md / collections specs (Parts 3–5, on next touch)** — collection operation examples may add the dot spelling beside qualified/pipe forms where it aids the reader; the qualified form remains the canonical citation form in specs.

---

## 16. Correction and reversal records

Recorded per house rule: defect origin, rationale, rejected alternative marked do-not-relitigate. Each correction is applied **in place** above and the touched sections are marked — §16.1 (July 2026): §2.2, §3.1, §3.2, §3.6, §9 rows 6–8, §11.10, tests §14(d)/(p); §16.2 (August 2026): §1, §3.3–§3.5, §4.2, §4.4, §5, §6, §7, §8, §9, §11.7, §12.1/§12.4, tests §14(j)–(j4)/(n).

### 16.1 Goal ownership: receiver-level region, not the enclosing function — and not the enclosing binding

- **Defect:** §2.2/§3.1 as first decided attached the DotCall goal to "the enclosing function" and set the deadline at "the generalisation boundary of the enclosing function." Neither module-level bindings nor the level structure of inner `let`s fit that wording. Worse, acceptance test (d) asserted that same-function evidence *after* an inner `let` could not rescue a goal — directly contradicting §3.2's own trigger rule ("reconsidered whenever unification changes its receiver tyvar"), which fires on the later `Vector.length(v)` unification. The spec was internally inconsistent as shipped.
- **Origin:** the function-shaped wording was imported from the discussion's running example (`fun f(v) = v.at(3)`) without checking it against module-level bindings, nested `let`s, or the level-based generalisation machinery the corpus actually has; test (d) then encoded the un-generalised intuition rather than the §3.2 rule.
- **Correction:** the goal is owned by **the inference region (level) of its receiver tyvar**; the deadline is that region's finalisation boundary, effective even where the value restriction prevents quantification; the **pinning rule** keeps goal-entangled tyvars out of inner quantification. Consequences: same-region evidence counts regardless of textual position; the fallback can never be contradicted within its own region; the same-function diagnostic (old row 7) is unreachable and merges into the post-finalisation diagnostic (row 8); test (d) flips to OK.
- **Rejected alternative (do not relitigate):** the **per-binding deadline** — attaching the goal to "the binding currently being inferred" and finalising at its boundary. It fires the fallback on an outer-level variable at an inner `let`'s boundary, making the meaning of independent sibling statements order-sensitive: the defect class that disqualified eager resolution (§11.3), reintroduced at binding granularity. Recorded at §11.10.
- **Credit:** Sol flagged the function-specific wording and contributed the value-restriction finalisation sentence; the receiver-level owner formulation, the pinning rule, and the discovery that test (d) contradicted §3.2 are this session's, arrived at while evaluating Sol's proposed (and rejected) per-binding owner.

### 16.2 Reversal record (August 2026, #304/#335): constraint members join the dot

- **What changed:** §7's total exclusion of constraint members from dot syntax is reversed for two receiver classes — head-known types (dispatch through the honored instance, §3.4/§4.2) and declared type variables (dispatch through the written bounds, §3.4). Flexible receivers are untouched: defaulting step, then fallback; no instance is ever consulted to *identify* a receiver. §9 row 6's redirect died with the flip (its case now compiles); §12.1 and §12.4 closed; §11.7 is reversed in part and annotated in place.
- **Why the original rejection was right when made:** in July 2026 a constraint member had no term-position identity — no declaring module, no export status, no qualified home. Any dot dispatch to one would have been a name-keyed search of the instance tables: extension-trait machinery, exactly as §11.7 said. The rejection's stated bar (§12.1: no global search, no import-sensitivity) was unmeetable *by a dispatch scheme* because the deficiency was in what members were, not in how dispatch might find them.
- **What changed the ground:** the members-as-values ruling (#335; Constraints §2.2/§4.6, `spec/notes/constraint-members-are-values.md`). Members are exports of their declaring modules; instances are coherence-keyed program-wide; honored spellings are claimed against rebinding. Dispatch is now a lookup in tables that already exist for other reasons, and the §10 doctrine test passes where it could not before.
- **The forcing exhibit:** the own-name refusal (Constraints §4.6, #293's non-`fun` law applied to members) removes the bare spelling inside a member's own body, and its ruled rewrite is the dot call. In a *parameterized* instance the recursive position has the declared variable's type — `box.value.show()` inside `honor<a: Show> Show<Box(a)>`. For a prelude constraint the declaring-module spelling (`Show.show(box.value)`) survives as a fallback, evidence-selected; the forcing case is the **conjunction**: a parameterized instance of a constraint *declared in the honoring module itself* — `constraint Describe` and `honor<a: Describe> Describe<Tree(a)>` in one file — where no qualified spelling exists at all (a module cannot name itself). Without bound-member dispatch the refusal would leave that recursion with no spelling. The bounds row is therefore not ergonomic sugar; it is what makes the refusal's sanctioned forms total. (Ruled on exactly this exhibit — #304.)
- **What §11.7 still rejects, permanently:** dispatch that *discovers* a receiver's type from a member name (never-nominate, §1), dispatch on flexible variables, and any import-sensitive member set. The slippery slope was real; the fence moved to where the slope actually starts.
