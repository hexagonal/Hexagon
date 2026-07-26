# Compiler conformance defect log

**Status:** Living implementation record. This file records cases where an
existing language decision was correct and the compiler diverged from it. It
does not amend the owning specification; the correction restores conformance.

Each entry names the defect origin, existing authority, correction, executable
conformance coverage, and diagnosis credit. This is the semantic sibling of the
parser acceptance gate: a standing place to connect specification commitments
to tests against the actual checker.

## 2026-07-24 — declared type variables were flexible

- **Classification:** compiler defect against specification; no design change.
- **Authority:** Functions §4.2 already states that a declared type more general
  than the body supports is an error. The Boundary Annotation Doctrine further
  relies on annotations pinning contracts.
- **Defect origin:** annotation type-variable creation in the checker used
  ordinary unification variables for both explicitly bound variables and
  variables first named inside annotations. A written `thing: a` could
  therefore collapse silently to `thing: Int`.
- **Correction:** type variables written in function annotations are rigid while
  the definition is checked. They retain identity across the signature and may
  accumulate inferred constraints, but cannot unify with a concrete type or a
  distinct declared type variable. Unannotated inference variables remain
  flexible.
- **Constraint completeness:** a written constraint list is a contract too. The
  body may demand only constraints entailed by that list. `<a: Eq>` cannot
  silently strengthen to `Hash`; the canonical repair is `<a: Hash>`, without
  restating the entailed `Eq`.
- **Rewrite Rule:** the structure diagnostic leads with the canonical repair:
  change `a` to the concrete type the body requires. Removing the annotation is
  also offered as the inference-revealing rewrite. The constraint diagnostic
  prints the canonical maximal constraint binder.
- **Executable conformance:** checker tests cover a monomorphic `takesInt`
  forcer, nested and return annotations, distinct declared variables, inferred
  `Num` and `Show` demands on rigid annotation variables, coexistence with an unannotated
  flexible parameter, and exported `Eq`/`Hash` completeness and entailment.
- **Credit:** Sol identified the checker/spec divergence and localized both
  annotation-variable creation sites. Fable identified the constraint-level
  completeness check and the required doctrine correction.
- **Notation audit:** the conformance record and new diagnostics use Hexagon
  source forms and constraint vocabulary, not Haskell `=>` shorthand. The
  separate tooling-display question remains recorded at Constraints §9.4.

This is the first entry where the corpus machinery caught the implementation
rather than correcting a document. Preserve that classification: the
specification was right all along.

## 2026-07-26 — defects found building the `Seq` core

Five findings from implementing `runtime/SeqCore.hex` against
`seq-core-representation.md`. Each was isolated to a minimal reproduction through
the aggregated `compileProject` channel (whose honesty is itself now pinned by a
poison test in `compiler/src/conformance/seq.test.ts`).

**Priority framing (James, 2026-07-26).** The objective these serve is retiring
the `Seq` intrinsic so the `.hex` record *is* `Seq`, with `Seq` de-intrinsifying
*before* `Vector` and serving as the pilot for it. Defects 1 and 2 are
**prerequisites** for that objective rather than items competing with it: an
opaque `Seq` is reachable only through `next` and through destructuring
`Option((a, Seq(a)))`, and both are currently broken. `SeqCore.hex` dodges them
by touching the `pull` field directly; no consumer of an opaque type can. Fixing
them first keeps the workarounds out of the template `Vector` will inherit.
Defect 4 is independent of the objective but is the most severe in absolute
terms. Defects 3 and 5 are noise. Recommended order: **1 and 2, then the
unification (deleting `SeqCore` and all four workarounds in that change), then
4**.

### 1. Rigid annotation variables leak across a call into a recursive caller

- **Classification:** compiler defect against specification; no design change.
- **Authority:** the 2026-07-24 entry above. Declared type variables are rigid
  *while the definition is checked*; that rigidity is a property of the
  definition, not of the callee's scheme at a call site. A generic annotated
  function must still be instantiated freshly per call.
- **Defect origin:** inside a *recursive* function, a call to another generic
  annotated function does not instantiate the callee's scheme. The callee's
  declared variable unifies with the caller's instead, so two independently
  declared `a`s are reported as one.
- **Reproduction** — no `Seq` involved:

  ```
  let ident(value: a): a = value
  export fun repeat(value: a, n: Int): a =
      if n <= 0 then
          value
      else
          repeat(ident(value), n - 1)
  ```

  reports "``a`` and ``a`` are distinct declared type variables, but the body
  requires them to be the same". Making the callee monomorphic removes the error;
  making the caller non-recursive removes it; so recursion plus a generic callee
  is the trigger.
- **Impact on the `Seq` core:** every recursive combinator would call
  `Seq.next`. The workaround is to drive the thunk inline as `(source.pull)()`
  inside recursive bodies. `next` remains the §6.2 protocol for consumers, and
  the non-recursive consumers do call it. When this is fixed, every `(x.pull)()`
  in `SeqCore.hex` should become `next(x)`.
- **CORRECTION (2026-07-26, on fixing — this entry's diagnosis above was wrong).**
  The heading and "Defect origin" are preserved as written for the record, but
  **both halves of that characterisation are false**, and the minimal
  reproduction survives only by accident. Discriminating cases:
  - Making the caller **non-recursive** does *not* remove the error
    (`export fun once(value: a): a = ident(value)` fails identically), so
    recursion was never the trigger.
  - Removing the **annotations** does not remove it either: an unannotated
    `let ident(value) = value` used at two types inside one `fun` fails just as
    hard. So it is not about rigid variables; that diagnostic was the loudest
    *symptom*, not the fault.
  - Declaring the callee `fun` instead of `let` makes every case pass.

  **Actual defect origin:** `#inferItems` installed **every `let` captured by a
  function as a monomorphic placeholder** before checking any function body. That
  discards the binding's generalization, fusing all of its uses into one type.
  The `let`/`fun` asymmetry is the whole fault: `fun` items were already checked
  in dependency order and generalized per component (issue #66), while captured
  `let`s were pinned regardless of whether their value was a syntactic value.
- **Authority (restated):** Functions §8 and the value restriction — a `let`
  whose RHS is a syntactic value generalizes. `#isValue` already implemented
  this; the captured-`let` path simply ran too late to use it. The 2026-07-24
  rigid-type-variable rule is **not** implicated and is unchanged.
- **Correction applied:** promoted `let`s — captured, and a syntactic value —
  join the dependency-ordered component pass alongside `fun`s, so they are
  generalized before the bodies that use them. Non-value bindings and every
  `var` keep the monomorphic placeholder, which for them is correct.
- **Executable conformance:** `compiler/src/conformance/generalized-captured-lets.test.ts`
  — the reproduction; the non-recursive and unannotated discriminators; two
  functions sharing one helper at different types; promoted-to-promoted and
  promoted-to-`fun` dependency edges; the function-body (block) path; a runtime
  execution check; and three guards that what must stay monomorphic still does,
  including a non-value `let` that must still be rejected at a second type.
  Verified end-to-end: `SeqCore.hex` with **every** `(x.pull)()` reverted to
  `next(x)` now compiles clean.

### 2. A tuple pattern inside a constructor pattern is not seen as covering

- **Classification:** compiler defect; pattern machinery (neighbour of #84).
- **Defect origin:** `Some((value, rest))` parses as a one-argument constructor
  pattern holding a tuple sub-pattern — the arity is read correctly — but
  exhaustiveness does not count the arm as covering `Some`, and reports
  "match is missing cases: `Some`".
- **Reproduction:**

  ```
  let o: Option((Int, Int)) = Some((1, 2))
  let r: Int = match o
      None => 0
      Some((value, rest)) => value + rest
  ```

  It is not `Option`-specific: `Ok((value, rest))` on a `Result` fails the same
  way. A bare tuple pattern (`(value, rest)`) and a tuple nested in a tuple
  (`((a, b), c)`) both work, so the gap is specifically a tuple directly beneath
  a constructor.
- **Distinguish from arity:** `Some(value, rest)` correctly reports
  "constructor pattern `Some` expects 1 arguments, got 2". Only the
  correctly-shaped form is mis-analysed.
- **Impact on the `Seq` core:** every `match` on the `Option((a, Seq(a)))`
  protocol. The workaround is to bind the payload whole and destructure on the
  next line with `let (value, rest) = pulled`.
- **Root cause (2026-07-26, on fixing).** The diagnosis above was right; this is
  the mechanism. Exhaustiveness asks `#isIrrefutablePattern(argument, slotType)`
  where `slotType` comes from the constructor's *declaration* — for
  `Some(value: a)` that is the union's own parameter `a`, which arrives as a bare
  type variable carrying no structure. The `Tuple` branch accepted a tuple
  pattern only when the expected type was already known to be a `Tuple`, so
  against a variable it fell through to "refutable" and the arm never counted as
  covering. Nothing was wrong with the *pattern* machinery; the slot type simply
  was not instantiated at that point.
- **Correction:** when the expected type prunes to a variable,
  `#isIrrefutablePattern` decides structurally
  (`isStructurallyIrrefutablePattern`, which already existed and already handled
  tuples, records, and `[...rest]` correctly). This is sound because
  `#inferMatchPattern` has separately checked the pattern against the real
  scrutinee type: if a tuple pattern typechecks there, the slot *is* a tuple, and
  irrefutability then turns only on whether each component pattern is
  irrefutable. Uniform across `Tuple`, `Record`, and `Vector` patterns.
- **Executable conformance:** `compiler/src/conformance/constructor-tuple-patterns.test.ts`
  — `Option`, `Result`, and a user union carrying tuples; a doubly-nested tuple;
  a structural record payload; a runtime check that both components bind; plus
  three guards that exhaustiveness still rejects what it should — a genuinely
  missing constructor, a *refutable* tuple element (`Some((1, right))` must not
  count as covering), and the untouched arity diagnostic.
- **Not covered, and why:** the nominal-record spelling
  (`Some(Point({ x, y }))`) is not writable at all yet — that is **#83**
  (paren-free `{a, b}` / `UserId(n)` patterns, pinned by PM §6.5 and
  unimplemented), independent of this defect. The structural-record test stands
  in; add the nominal case when #83 lands.
- **Verified end-to-end with defect 1:** `SeqCore.hex` with *both* Phase-1
  workarounds reverted — every `(x.pull)()` back to `next(x)` and every
  payload-then-`let` back to `Some((value, rest))` — compiles clean.

### 3. `project.diagnostics` reports each diagnostic three times

- **Classification:** compiler defect; aggregation introduced with #78.
- **Defect origin:** `compileProject` folds `typed`, `javascript`, and
  `declarations` diagnostics into one bag, but all three carry the *same*
  accumulated list, so every diagnostic is added once per stage.
- **Impact:** the channel is honest — nothing is hidden, which is what the poison
  test guards — but diagnostic counts are meaningless and output is noisy. A
  single ill-typed binding reports 3 errors; a parse failure reports 3 of each.
- **Root cause and correction (2026-07-26, on fixing).** Each emission stage
  seeds its own bag with the diagnostics it was handed (`emitter.ts`), so
  `javascript` and `declarations` both re-carry everything `typed` produced. The
  stages share diagnostic *identity*, so `compileProject` now folds through a
  seen-set: repeats collapse, and genuinely distinct diagnostics that happen to
  read alike are still reported separately. Pinned by a conformance test that one
  error reports once and two distinct errors report twice.
- **Poison-test sensitivity re-verified after the change, not assumed:** blinding
  the aggregation again turns both poison tests red while the sound-module
  control stays green.

### 4. Missing `Num` evidence can reach runtime as `undefined`

- **Classification:** compiler defect; evidence passing.
- **Defect origin:** an unannotated helper that is generic over `Num` and passed
  *as a value* (rather than applied at a known type) receives no evidence
  dictionary. This is not always caught at compile time: in one shape it emitted
  a diagnostic ("missing `Num` evidence during JavaScript emission"), and in
  another it compiled clean and failed at runtime with
  `TypeError: Cannot read properties of undefined (reading 'add')`.
- **Reproduction:** `let addPair(pair) = ...  left + right`, passed to a
  higher-order combinator. Annotating the parameter fixes it.
- **Severity:** the silent path is the concerning one — clean compile, runtime
  crash.

### 5. A multi-line `match` cannot be a record-field value (layout)

- **Classification:** limitation observed; *not* yet classified as a defect —
  needs a layout owner's ruling before it is called one.
- **Observation:** writing the pull step inline as
  `Seq({ pull: () => match next(source)` with the arms on following lines makes
  the layout algorithm close the record literal at the first arm
  ("expected `}` after record fields", "expected `)` after arguments"). The same
  applies to a multi-line lambda passed as a call argument.
- **Impact on the `Seq` core:** each combinator binds its step to a local `let`
  and then wraps it, which reads well enough that this may simply be the house
  form rather than something to fix.

### 6. Type-annotation resolution consults intrinsics before user declarations

- **Classification:** compiler defect against specification; no design change.
  *(Reclassified 2026-07-26 during Fable review: the "the type cannot be named
  `Seq`" finding above treated this as a fact of the language. It is not.)*
- **Authority:** Modules §5.4 — the prelude enters scope as a *distinct outermost
  layer*, and a module-level declaration **may occlude a prelude name**. Nothing
  in the corpus grants compiler-internal type machinery a resolution claim that
  outranks user declarations; §5.5 (added 2026-07-26) now states the consequence
  explicitly: compiler resolution never outranks declarations, and the retained
  boundary intrinsics (`Array`, `Nullable`, `Node`) are a fallback consulted
  *after* declarations.
- **Defect origin:** the resolver's type-annotation path consults the intrinsic
  branch (`Seq`/`Vector`/`Set`/`Array`/`Nullable`, resolver.ts:1739) *before*
  the user-record table (resolver.ts:1775) — but *after* the union table
  (resolver.ts:1700). Three consequences: a user `record Seq(a)` declares
  successfully yet no `Seq(a)` annotation can ever reach it (annotation resolves
  to the intrinsic; constructor builds the record; the two never unify); a user
  `union Seq(a)` *would* occlude the intrinsic, so the order is accidental, not
  doctrine; and the term namespace already yields to user bindings
  (resolver.ts:1165–1167) while the type namespace does not.
- **Correction:** declarations (records, unions, aliases, extern types — user
  and prelude alike) are consulted first; the surviving boundary intrinsics
  resolve as a fallback only. With `Seq` declared in the prelude
  (`stdlib/Seq.hex`, Loops §6.6), the name `Seq` then behaves exactly as
  Modules §5.4 always specified.
- **Relation to the priority framing above:** this defect *is* the resolver half
  of "the unification"; the checker half is repointing the intrinsic `Seq`
  producers at the prelude declaration. The full sequencing is owned by
  `seq-deintrinsification-plan.md`.
- **Correction applied (2026-07-26, plan Phase 2).** The record table moved up
  beside the alias, extern-type, and union tables, above the intrinsic branch,
  and the two later record lookups it superseded were deleted — one lookup now
  serves the applied and nullary forms alike, so the asymmetry cannot come back
  by halves. Membership of the fallback is unchanged this phase:
  `Seq`/`Vector`/`Set`/`Map` are still in it, and `Seq` leaves only at Phase 4.
- **Confirmed empirically before the fix, and the fix's own signature.** The
  defect's tell is a diagnostic naming the same type on both sides —
  `type mismatch: expected Vector(Int), found Vector(Int)` — with the
  `union Vector(a)` control clean beside it, which is the asymmetry stated as an
  experiment. A second, quieter consequence surfaced only under probing: a user
  record whose *arity* differs from the intrinsic's got no arity diagnostic at
  all, because the annotation never reached the declaration; the mismatch
  appeared later as an unreadable `Vector(Int)` / `Vector(?, ?)`. The corrected
  resolver reports `type \`Vector\` expects 2 arguments, but 1 were provided`.
- **Executable conformance:** `compiler/src/conformance/resolution-order.test.ts`
  — occlusion coherence for a user `record Vector(a)` across annotation,
  constructor, field read, same-module and imported-home companion dispatch, and
  a runtime round-trip; the arity discriminator; `Map(k, v)` and `Seq(a)` forms;
  the `union` control pinned against regression; `Array`, `Nullable`, and
  runtime-private `Node` still resolving uncontested (and `Node` still hidden
  outside a runtime module, and outranked by a runtime `record Node(a)`);
  `Vector`/`Set`/`Map`/`Seq` intrinsics still working; the `for ... in`
  desugaring unaffected; and the term-level yield pinned in the positive
  direction, via module aliases named `Seq` and `Vector`. Sensitivity verified by
  blinding, not assumed: with the resolver change reverted, 10 of the 22 go red.
- **Known residue, pinned deliberately.** Occluding `Vector` does not redirect
  the `[...]` **literal**, which is dedicated syntax wired to the intrinsic — so
  `fun lit(): Vector(Int) = [1, 2, 3]` still yields the same-name mismatch, now
  confined to the literal. That is `Vector`'s own arc (plan Phase 5, item 11,
  whose named weight is exactly this syntax surface), not this defect's; `Seq`
  has no literal form, so Phase 4 is unaffected. Pinned so the later arc starts
  from an assertion rather than a surprise.

### 7. A sequential placeholder could be generalized over

- **Classification:** compiler defect against specification; no design change.
  Found by Fable reviewing PR #86; **pre-existing on the `fun` path**, and
  widened to the captured-`let` path by entry 1's fix before being closed here.
- **Authority:** Functions §8, the value restriction — a `let` whose RHS is not
  a syntactic value is pinned to one type — together with the 2026-07-24 rule
  that a declared type more general than the body supports is an error.
- **Defect origin:** a module-level `let`/`var` captured by a function is
  installed as a monomorphic *placeholder* so bodies can refer to it before it is
  checked. That placeholder denotes one binding holding one value of one type,
  but it escaped through two doors:
  1. It was created at `level + 1`, and `#generalize` quantifies exactly the
     variables above the level it generalizes at — so any sibling generalizing at
     `level` quantified the placeholder into its own scheme.
  2. A declared (rigid) type variable could absorb it, directly or by being
     mentioned in a type the placeholder was bound to.

  Either way each consumer instantiated a fresh copy, so **one runtime value was
  handed out at two types** — and at constrained types with two different
  evidence dictionaries, which is a wrong-code channel, not mere permissiveness.
- **Reproduction:** `shared` is a function *call*, so it cannot generalize; an
  intermediary laundered that away.

  ```
  let makeEmpty() = []
  let shared = makeEmpty()
  let reuse = () => shared            -- or `fun reuse(): Vector(a) = shared`
                                      -- or `fun reuse() = shared`
  export fun useInt(values: Vector(Int)): Bool = reuse() == values
  export fun useText(values: Vector(String)): Bool = reuse() == values
  ```

  Direct consumption of `shared` was always correctly rejected; only the
  intermediary forms leaked.
- **Correction:** placeholders are created **at `level`**, so they sit at the
  generalization boundary and nothing quantifies them; and they are marked, so
  `#bind` rejects any attempt by a declared type variable to stand for one —
  from either direction, including when the declared variable merely occurs
  inside the bound type. The diagnostic leads with the canonical repair (name the
  concrete type) and offers the generalizing alternative (make the binding a
  function).
- **Executable conformance:**
  `compiler/src/conformance/sequential-placeholder-scope.test.ts` — all three
  intermediary forms rejected, the direct baseline rejected, and three guards
  that legitimate generalization is untouched (a generic captured `let` helper
  and a generic `fun` helper each still serve two types; a monomorphic captured
  binding is still usable repeatedly at its one type).
- **Credit:** Fable, from a discriminating probe run against both `main` and the
  branch — the table separating regression from pre-existing hole is what
  identified the shared mechanism rather than a fix-local slip.
