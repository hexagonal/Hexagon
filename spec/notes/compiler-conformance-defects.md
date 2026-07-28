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
  (`Some(Point({ x, y }))`) is not writable at all yet. **The blocker was
  misattributed to #83** (paren-free `{a, b}` / `UserId(n)` lambda-head
  patterns). #83 has since landed and the spelling is still rejected, with
  `` unknown constructor `Point` ``: a nominal `record` declaration registers no
  constructor *pattern*, so `Point({ x, y })` cannot be written in any pattern
  position — `match` arm, `let`, or lambda head alike. That is **#84 item 1**
  (nominal record patterns), and it was always the real blocker; #83 governed
  only whether a paren-free pattern may head a lambda, which is a different
  question that never applied to a nested pattern inside a `match` arm. The
  structural-record test stands in; add the nominal case when #84 item 1 lands.
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
- **Diagnosis (2026-07-26).** Not "no evidence is computed" — the evidence is
  computed and then dropped. A constrained generic compiles to a function taking
  a trailing evidence dictionary, and evidence is attached to **call sites**:
  the checker records a requirement list for every `Name` reference but
  transfers it to the typed tree only when that name is a call *callee*. A
  reference in **value position** — passed as an argument, bound to an annotated
  `let`, returned, stored in a collection, imported and passed on — kept the
  raw arity-`n + k` binding, so a consumer calling it with `n` arguments left the
  dictionary `undefined` and the first operation through it crashed.
- **Newly reachable through ordinary code.** `Seq.map` was a compiler intrinsic
  until the Phase 4 unification, so `Seq.map(values, double)` with an unannotated
  `double` could not be written at all. It can now, and it crashed.
- **Correction applied (2026-07-26).** A value reference carries its own
  resolved constraints (`Typed.NameExpr.requirements`, `Core.NameExpr.evidence`),
  and emission eta-expands it to the arity the reference claims, closing over the
  dictionaries: `plus` becomes `(a0, a1) => plus(a0, a1, <dict>)`. Callee
  references carry none — the enclosing `Call` still owns that evidence, and
  doing both would apply it twice, so the checker marks callee names explicitly.
  Only references that actually carry evidence are wrapped: wrapping every value
  reference would cost an allocation per mention and break function identity,
  which FFI Part 6 §1 is explicit about. The exported binding is untouched — the
  raw function is what leaves the module, and its specializations are unaffected.
- **Executable conformance:**
  `compiler/src/conformance/constrained-value-evidence.test.ts`, all executing
  the emitted module, because the diagnostic channel says nothing about this
  defect. Eight value positions, including the imported case (which reaches the
  emitter by a different path) and two references at *different* types, which
  forbids one shared wrapper. Three guards: a direct call still passes evidence
  at the call site, an unconstrained function is still passed by identity, and an
  annotated monomorphic function needs no evidence at all. Verified sensitive by
  blinding — the eight redden, the guards stay green.

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
  resolver reports ``type `Vector` expects 2 arguments, but 1 were provided``.
- **Executable conformance:** `compiler/src/conformance/resolution-order.test.ts`
  — occlusion coherence for a user `record Vector(a)` across annotation,
  constructor, field read, same-module and imported-home companion dispatch, and
  a runtime round-trip; the arity discriminator; `Map(k, v)` and `Seq(a)` forms;
  the `union` control pinned against regression; the boundary intrinsics pinned
  in **both** directions — `Array`, `Nullable`, and runtime-private `Node` still
  resolving uncontested, `Node` still hidden outside a runtime module, and each
  of the three outranked by a same-named user record;
  `Vector`/`Set`/`Map`/`Seq` intrinsics still working; the `for ... in`
  desugaring unaffected; and the term-level yield pinned in the positive
  direction, via module aliases named `Seq` and `Vector`. Sensitivity verified by
  blinding, not assumed: with the resolver change reverted, 13 of the 25 go red.
- **Occlusion reaches extern signatures.** §5.5 grants no carve-out for extern
  positions, so a user `record Array(a)` is what an `extern fun sink(values:
  Array(Int))` in that module takes — pinned, with the constructor call as the
  discriminator. Noted because it is the consequence a later reader of FFI Part 3
  is most likely to be surprised by, and it follows from the spec as written
  rather than from an implementation choice. (Found by Fable probing PR #87
  beyond the suite; the two boundary-occlusion tests are Fable's finding F1.)
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

### 8. A prelude module reachable only through another was dropped from emission

- **Classification:** compiler defect; silent wrong output. Found by Fable
  reviewing PR #88, **against my classification** — I reported it as latent, on
  the reasoning that the same commit both enabled prelude-to-prelude references
  and fixed the emission. That was wrong: the defect did not need the Phase 3
  visibility change to be reachable, only an explicit `import` line, which was
  always legal.
- **Authority:** Modules §11 — emission is 1:1 ESM. An emitted module importing a
  module that was never emitted is not a 1:1 correspondence with anything; it is
  a broken artifact. The project channel must also be honest (the standing
  poison-test rule): a project that produces unloadable output must not report
  success.
- **Defect origin:** prelude modules are emitted conditionally, so a project that
  never touches the prelude is unchanged by its existence. The predicate asked
  whether some **non-prelude** module imported the member. That was sufficient
  while prelude members could not reference one another, and it ignored
  prelude-to-prelude importers *whatever the origin of the import* — synthesized
  or written. A member imported only by another prelude member was therefore
  dropped while the importer's emitted JavaScript still named it.
- **Reproduction (on `main`, no Phase 3 machinery).** `injectPrelude` prefers a
  project's own file at a prelude basename over the embedded fallback — the
  documented path for compiling the stdlib itself. Supply `/Prelude.hex`,
  `/Option.hex`, and a `/Result.hex` carrying an **explicit** import line:

  ```
  import * as O from "./Option"
  export union Result(a, e) = Ok(value: a) | Err(error: e)
  export fun toOption(result: Result(a, e)): O.Option(a) = ...
  ```

  with a `/main.hex` that imports only `./Result`. Result on `main`:
  `diagnostics: []`, emitted modules `["/Result.hex", "/main.hex"]`, and
  `Result.js` containing `import { ... } from "./Option.js"`. Clean compile,
  unloadable output. The shipped `stdlib/` does not currently contain such an
  import, so the defect was reachable rather than occurring.
- **Correction applied (2026-07-26, plan Phase 3).** Emission is now reachability
  from the non-prelude modules rather than a single hop: a worklist adds any
  imported module to the emitted set, reading the same `resolved.items` channel
  the old predicate read, so written and synthesized imports are treated
  identically. Prelude modules nothing reaches are still dropped, so the economy
  the predicate existed for is intact.
- **Executable conformance:**
  `compiler/src/conformance/prelude-mechanism.test.ts` — the synthesized-import
  case (a member visible to a later member under §5.5), **this entry's explicit-
  import reproduction as a distinct channel**, the untouched-prelude control, and
  the general invariant the specific cases belong to: every relative import in
  the emitted output names an emitted module. Verified sensitive by blinding the
  reachability walk while keeping the visibility change, which reddens the
  emission tests alone.
- **Dating the reproduction.** The explicit-import channel depends on Modules
  §5.5's "no `import` lines in prelude source" being a stated convention with no
  diagnostic behind it. Should that become an error, this repro stops being
  well-formed and the synthesized channel becomes the only one — the correction
  and the invariant are unaffected either way.
- **Credit:** Fable, from a probe run against both `main` and the branch. The
  ruling is the finding here: I had reasoned from *when the code changed* rather
  than testing *what the old code accepted*, and the probe is what separated
  them.

### 9. A module-level `let` could not occlude a prelude value

- **Classification:** compiler defect against specification; no design change.
  Found while preparing Phase 4, by adding `stdlib/Seq.hex` to the prelude set.
- **Authority:** Modules §5.4, both halves. A **module-level** `let`/`fun` **may
  occlude a prelude name** — the local one wins unqualified module-wide and the
  prelude's stays reachable qualified — while a **function-local** binder may
  occlude **nothing**, prelude included. §5.4 states the stakes itself: "Without
  occlusion, every addition to the prelude in a future release would break any
  program already using that name — untenable with no warning tier to soften it."
- **Defect origin:** a one-word asymmetry between the two module-level binder
  paths. The `fun` predeclare pass tested `scope.lookupLocal`, which stops at the
  module's own layer, so `fun` occluded correctly. The `let` path tested
  `scope.lookup`, which walks out through the prelude layer, so a module-level
  `let` over a prelude name was reported as a rebinding — and, the binding having
  been refused, later references resolved to the prelude's value instead.
- **Why it went unnoticed:** the shipped prelude exports `Ordering`, `Option`,
  `Result` and their **capitalized** constructors only. No lowercase prelude
  value existed for a module-level `let` to occlude, so §5.4's guarantee had
  never been exercised for values at all. `stdlib/Seq.hex` is the first prelude
  module that exports lowercase names (`empty`, `map`, `filter`, `fold`, …), and
  it collided with `stdlib/Vector.hex`'s own `empty` immediately.
- **Reproduction:** with any prelude module exporting a lowercase value `tally`,
  a consumer writing `export let tally: String = "mine"` at module level reports
  `` `tally` is already bound ``. The same module written `export fun tally(...)`
  compiles — that discriminating pair is what located the fix.
- **Correction applied (2026-07-26).** The module-level `let` path consults
  `lookupLocal`; nested binders keep the full `lookup` walk, because §5.4's
  function-local ban is absolute and layer-blind. The fix narrows *which layer*
  is consulted, not whether the ban applies within a layer.
- **Executable conformance:** `compiler/src/conformance/prelude-occlusion.test.ts`
  — module-level `let` and `fun` occluding; an occluding `let` winning *at its
  own type* (the discriminator: if the prelude binding still won, the annotation
  would fail); a non-occluding module still seeing the prelude value; and three
  guards that the ban survives — a function-local `let` over a prelude name, a
  function-local `let` over a module name, and two module-level bindings of one
  name. The tests substitute their own prelude member rather than waiting for
  `Seq` to join, so the rule is pinned independently of that migration. Verified
  sensitive by blinding: 2 of the 7 go red, and they are the two `let` cases.
- **Relation to the arc:** this is a Phase 4 *prerequisite* of the same kind
  Phase 1's defects were — `Seq.hex` cannot join the prelude until a program may
  legally define its own `map` or `empty`. It is also the third `let`/`fun`
  asymmetry this arc has turned up (entry 1, entry 7, this one).
- **Correction to the correction (PR #89 finding F1, Fable).** The first fix
  gated on `#lambdaDepth === 0`, and that predicate is wrong: the block body of a
  *module-level* `let` runs at lambda depth 0 while being an inner layer. It
  therefore licensed exactly what §5.4's second half forbids, silently, and as a
  **regression** — the pre-fix compiler rejected both of these, the fixed one
  accepted them:

  ```
  let mine: Int = 1
  export let use: Int =
      let mine = 2          -- inner layer: must stay a hard error
      mine
  ```

  ```
  export let use: Int =
      let tally = 2         -- prelude value, inner layer: likewise
      tally
  ```

  The predicate is **scope identity, not nesting depth**: the module scope is the
  one constructed with the prelude layer as its parent, and it is now held in a
  field and compared directly. "Module level" is a fact about *which scope object
  this is*, and depth was only ever a proxy for it — one that happens to coincide
  everywhere except the case above.
- **The reusable part:** closing a hole by widening a permission is the shape that
  invites this. The first fix loosened a check and reasoned about *when* the
  loosened branch would be taken, rather than testing what it newly admitted. The
  three F1 pins and the three §5.4-ban guards must pass **together** — that
  conjunction, not either group alone, is what states the rule. Blinding
  discriminates the two states separately: reverting to the depth gate reddens
  only the F1 pins, reverting to `lookup` reddens only the occlusion tests.

### 10. A prelude name is not reachable qualified

- **Classification:** compiler defect against specification; no design change.
  **Pre-existing and general** — it is not about `Seq`. Found while preparing
  Phase 4 step 8.
- **Authority:** Modules §6.4, which exists to underwrite §5.4: "The occlusion
  rule's *prelude version stays reachable qualified* only works if **every
  prelude name has a qualified home** — a companion module it also lives in." §5.4
  states the consequence it depends on: after a module occludes `show`, "the
  prelude's version remains reachable qualified (`String.show` etc.)."
- **Defect origin:** the prelude is seeded as *bare* names only. `#seedPrelude`
  defines each member's terms in a fallback scope and registers its type names,
  but registers no module alias, so the module itself cannot be named. There is
  no path by which `Seq.next`, `Option.Some`, or `Result.Ok` resolves.
- **Reproduction:** every one of these reports `unknown name` for the qualifier,
  with no import line present:

  ```
  export let a: Option(Int) = Option.Some(1)
  export let b: Result(Int, Int) = Result.Ok(1)
  export let c: Seq(Int) = Seq.singleton(1)
  ```

  The bare spellings all compile. So the *unqualified* half of the prelude works
  and the *qualified* half does not exist.
- **Why it surfaces now.** Nothing depended on it before. While a module-level
  binder could not occlude a prelude value at all (defect 9), "the prelude's
  version remains reachable qualified" had nothing to protect: no program could
  shadow `Some`. Fixing defect 9 makes occlusion real, and `stdlib/Seq.hex`
  supplies twenty-odd occludable lowercase names — so the escape hatch §5.4
  promises is now load-bearing and missing.
- **Blocking relation to Phase 4 step 8.** The work order's F1 amendment requires
  that `Seq.iterate`/`map`/`filter`/`take` "keep compiling with identical types
  through the ordinary companion-dispatch path" *before* the compiler-known
  `SeqOperation` family is deleted. They cannot: `Seq.iterate` today still
  resolves to the intrinsic special case precisely *because* the qualifier does
  not resolve — the special case is guarded on `Seq` being unbound, and it is.
  Fixing this defect is expected to satisfy that guard as a side effect, since a
  registered prelude alias makes the guard false and routes the spelling to the
  prelude module. The deletion is not attemptable until then.
- **Correction applied (2026-07-26).** Each prelude member is registered under
  its basename, and qualified term and type lookups consult that registry after
  the explicit-alias map. The layering is the point and the first attempt got it
  wrong: registering members in the *same* map as `import * as` aliases made an
  explicit `import * as Seq from "./SeqCore"` collide with the prelude member and
  reddened 23 tests. §5.4 settles it — explicit imports are module-level
  bindings, prelude entries are the outer layer — so the members live in a
  fallback map and an explicit alias of the same name simply wins.
- **Executable conformance:** `compiler/src/conformance/prelude-qualified.test.ts`
  — qualified terms (`Option.Some`, `Result.Ok`, `Prelude.Less`) and qualified
  types (`Option.Option(Int)`); the bare spellings unchanged; a member that does
  not export the name reporting *that* rather than `unknown name`; **the §5.4 +
  §6.4 pairing itself** — a module that occludes a prelude value still reaching
  the prelude's version qualified, which is the guarantee the two sections make
  together; and two tests that an explicit alias of a prelude member's name wins
  without colliding. Blinding reddens 4 of the 7, and the 3 that stay green are
  the behaviours that already worked.
- **Correction to the correction (PR #90 finding F1, Fable).** The first fix
  resolved the name and stopped there, and the defect lives one level below
  resolution. A prelude member has **no namespace object to dot into** — unlike
  an explicit `import * as`, nothing declares one — so the qualified reference
  emitted as literal dotted text with no import synthesized:

  ```js
  const a = Option.Some(1);   // clean compile; ReferenceError on load
  export { a };
  ```

  Two halves of the emission contract were missed: the reference must compile to
  a plain name, and the symbol must join `#usedPreludeSymbols` so the
  used-names-only prelude import actually carries it.
- **The local name has to dodge the module's own bindings.** Importing the
  prelude's `tally` *as* `tally` collides with the module-level binding that
  occludes it — the very binding the qualified spelling exists to see past. So a
  prelude term reached qualified is imported under a distinguished local when the
  module binds that name, and under its own name otherwise.
- **The pin is a runtime round-trip, not a diagnostic.** The suite now executes
  the emitted module: a qualified constructor, a qualified nullary constructor, a
  second member's value, a bare and a qualified reference sharing one import,
  and — the case that forbids the lazy fix — an occluding module receiving
  **both** values, distinct. Blinding discriminates the two layers separately:
  against `main` 9 of the 12 redden, against the resolution-only parent 5 do, and
  those 5 are exactly the round-trips.
- **The reusable part:** this is the third silent-wrong-output finding of the arc
  (entries 8, 10, and #88's F1). The common shape is a *resolution* change whose
  test asks the *diagnostic* channel whether it worked. A clean compile is not
  evidence that a name resolves to anything at runtime; only running the emitted
  module is.
- **Still open (Phase 4 step 8):** the compiler-known operation guards
  (`Seq.iterate`/`map`/`filter`/`take`, and the `Map`/`Set`/`Vector`/`Node`
  families) test the *explicit* alias map only, so a prelude member does not yet
  outrank them. Closing that is what routes those spellings to companion
  dispatch, and it is only exercisable once `Seq.hex` joins the set — so it lands
  with the producer retyping rather than here.
- **Credit:** found by probing what `Seq.iterate` actually resolves to after
  `Seq.hex` joined the prelude, rather than assuming the term-level yield would
  hand it to companion dispatch. The intrinsic and the record print identically,
  so the discriminator was whether `next` — which only accepts the record —
  would take the result.

### 11. A constraint member could not occlude a prelude value

- **Classification:** compiler defect against specification; no design change.
  Found while landing Phase 4 steps 8–9, by an existing emitter test that
  declares `constraint Iterable<c>` with a member named `iterate`.
- **Authority:** Modules §5.4, exactly as for defect 9. A constraint member binds
  at module level, so the occlusion half applies to it: it may occlude a prelude
  name, and it may not collide with a sibling in its own layer.
- **Defect origin:** the same one-word asymmetry defect 9 fixed for `let`, at a
  binder form that fix did not reach. The constraint-member path tested
  `scope.lookup`, which walks out through the prelude layer.
- **Why it surfaces now:** for the same reason defect 9 did, one step later.
  `stdlib/Seq.hex` is the first prelude module to export lowercase *operation*
  names, and `iterate`, `map`, `filter`, and `fold` are all plausible constraint
  members. Until `Seq.hex` actually joined the set, nothing could collide.
- **Reproduction:** with `Seq.hex` in the prelude,
  ``constraint Walkable<c> = ... iterate(value: c): Int`` reports
  `` `iterate` is already bound ``, naming a line in `Seq.hex`.
- **Correction applied (2026-07-26).** The same scope-identity test defect 9's
  correction settled on: `lookupLocal` when the binder is in the module scope,
  the full `lookup` walk otherwise. Scope identity rather than nesting depth, per
  PR #89 finding F1.
- **Executable conformance:** `compiler/src/conformance/prelude-occlusion.test.ts`
  — a constraint member occluding a prelude value, plus two guards that the
  fix does not weaken the layer: two members of one name still collide, and a
  member colliding with a module-level `let` still collides. Verified sensitive:
  the occlusion test is red before the fix and the two guards are green both
  ways, so the fix is not simply disabling the check.
- **A fourth form, found while fixing PR #91's F1:** a module-level **binding
  pattern** (`let (take, keep) = (1, 2)`) tested `scope.lookup` too, so it could
  not occlude either. Same correction. That makes four forms — `let`, `fun`,
  constraint members, pattern binders — and finding the fourth *while fixing the
  consequences of having missed the third* is the strongest available evidence
  for the lesson below.
- **The reusable part:** defect 9's correction was applied where the defect was
  *found* rather than everywhere the rule holds, and each subsequent form was
  then found one at a time, by accident, at the cost of a defect each. A rule
  stated over "module-level binders" cannot be discharged by patching the forms
  that happen to be in front of you. Where the rule admits it, derive the answer
  from a structure that is closed by construction — as PR #91's F1 fix does, by
  taking every name `#declare` ever produced instead of listing binder syntax.

### 12. An exported `Seq` no longer faces JavaScript as an `Iterable` (open)

- **Classification:** **open question for ruling, not a defect with a known
  fix.** A capability regression introduced by Phase 4 steps 8–9 and pinned
  rather than left silent.
- **Authority in tension.** Three decided rules now disagree for `Seq`:
  - **FFI Part 3 §9.1** — an exported Hexagon `Seq` is a replayable JavaScript
    iterable: each `[Symbol.iterator]()` opens an independent cursor over the
    *same memoized* sequence. Its `.d.ts` face is `Iterable<a>`, and the exported
    value is "stronger than the face promises".
  - **FFI Part 7 §6** — an `export opaque` type's face is a TypeScript-only
    brand, and "the existing erased runtime value crosses out and back **by
    identity**". `Seq` became an `export opaque record` in this very arc.
  - **Ruling R1** — the memoizing inbound adapter is "the sole compiler-side
    constructor of `Seq` records".
- **What is true after this arc:** the `.d.ts` face is `Iterable<a>`, as Part 3
  and Part 7 §6.8 both say. The exported *value* is the record, which has no
  `[Symbol.iterator]`. Under the intrinsic the property held for free, because a
  `Seq` **was** a JS iterable; nothing replaced it.
- **It is not only exported values (PR #91 finding F2, Fable).** Every `Seq`
  position on an exported *function* has the same divergence, in both
  directions:

  ```
  export let total(values: Seq(Int)): Int = Seq.fold(values, 0, (a, b) => a + b)
  export let upTo(count: Int): Seq(Int) = Seq.take(Seq.iterate(1, x => x + 1), count)
  ```

  publish `(values: Iterable<number>) => number` and
  `(count: number) => Iterable<number>`, while `total`'s body drives `.pull` on
  whatever it is handed and `upTo` returns a record. **The parameter half is not
  merely undelivered, it is decided:** FFI Part 7 §7 *occasion 1* names "an
  incoming `Iterable<a>` parameter declared as `Seq(a)`" as the first of exactly
  three occasions requiring a stable module-level boundary wrapper, with a fresh
  per-value adapter per call (Part 3 §2.1). No such wrapper is generated. Any
  candidate answer must therefore cover value, parameter, and result positions
  uniformly — which constrains the answer space more than the value-only framing
  admitted, and is why occasion 1 being already-decided matters to the ruling.
- **Why it is not a one-line fix.** An emitted ESM binding is simultaneously the
  Hexagon interface and the JavaScript interface. Part 7 §7's mechanism — a
  stable module-level export wrapper — would therefore hand *Hexagon* importers
  the wrapped value, breaking `Seq.map` for every consumer. The three candidate
  answers each pay a different price:
  1. **a per-value `[Symbol.iterator]`** on the record (one shared method, so no
     closure per value) makes the face honest at every position including nested
     ones, but adds a property to the hottest allocation in the lazy-sequence
     core and puts representation knowledge at the record's own constructor,
     against R1's "sole constructor" clause — and still gives re-derivation, not
     §9.1's memoization, for a `.hex`-built `Seq`;
  2. **a dual-binding export protocol** (raw binding for Hexagon importers,
     wrapped binding for JavaScript) satisfies both faces, and is a change to the
     module emission contract for every module, not just `Seq`;
  3. **changing the face** to Part 7 §6's opaque brand makes the `.d.ts` match
     the value and drops §9.1's promise outright.
- **Why it is left open rather than chosen.** `Seq` is the pilot that `Vector`,
  `Set`, and `Map` inherit (ledger §5.2). A guess here is inherited three more
  times, which is the failure mode step 7's note names. The choice trades decided
  spec clauses against each other and against per-step cost — Fable's call.
- **Pinned, not absent:** `compiler/src/conformance/seq-unification.test.ts`
  asserts the current behaviour on both surfaces — the exported value *is* the
  record with a `pull` and no `[Symbol.iterator]`; an exported function publishes
  `Iterable<number>` in parameter and result position with no wrapper behind
  either; and the emitted `.d.ts` *does* say `Iterable<number>` throughout.
  Whichever answer lands, those tests fail and have to be rewritten deliberately.

### 13. An unsupported companion operation crashes on a literal argument (pre-existing)

- **Classification:** compiler crash, **pre-existing on `main`**, unrelated to
  this arc. Found by probing, not by a test; logged rather than fixed, to keep
  the unification reviewable.
- **Reproduction (reproduces on `main` at 4a95858):**

  ```
  let numbers: Vector(Int) = [1, 2]
  let extended = numbers.append(40)
  ```

  `compileProject` throws `TypeError: Cannot read properties of undefined`.
  Replacing `40` with a named binding produces the correct diagnostic instead —
  ``the companion of `Vector(Int)` has no operation `append` `` — which is what
  isolates it.
- **Defect origin:** the companion-dispatch path reports `#unsupported` and
  `break`s **without inferring the argument expressions**. An integer literal's
  `FromNat` requirement is recorded during inference, so materialization then
  dereferences a requirement list that was never filled.
- **Shape:** a diagnostic path that abandons a subtree it is still going to
  materialize. Any error path that returns early from inference is a candidate.

### 14. The synthesized prelude import could redeclare a module-level name

- **Classification:** compiler defect against specification; no design change.
  Found by Fable reviewing PR #91 (finding F1), by probing the *new surface* the
  PR created rather than by re-reading the self-report.
- **Authority:** Modules §6.4, the same rule defect 10 landed. A prelude term
  reached qualified — or by companion dispatch — is imported under a local that
  must clear the module's own bindings, because reaching `Result.tally` from a
  module that itself binds `tally` is precisely what §6.4 exists for.
- **Defect origin:** defect 10's fix chose that local against `#moduleLevelNames`,
  a set populated from `Fun`/`Let`/`Var` items only. Every other way to bind a
  module-level name was missed: named imports, extern declarations, constraint
  members, pattern binders. **The same enumerate-the-binder-forms mistake as
  defects 9 and 11**, one layer over.
- **Reproduction (both clean compile → `SyntaxError` on load):**

  ```
  import { take } from "./lib"
  let source: Seq(Int) = Seq.iterate(1, x => x + 1)
  export let out: Vector(Int) = Vector.fromSeq(Seq.take(source, 2))
  ```

  ```
  constraint Mappable<c> =
      map(value: c, transform: Int -> Int): c
  record Holder = { map: Int -> Int }
  let holder = Holder({ map = value => value * 2 })
  export let out: Int = holder.map(3)
  ```

  The second reaches it with **no prelude spelling in the source at all** — the
  field call alone registers a companion candidate.
- **Why it surfaces now.** The mechanism is defect 10's, but on `main` no prelude
  module exported a single lowercase term (checked, not assumed:
  `git show main:stdlib/*.hex`), so no local name could collide with one.
  `Seq.hex` supplies roughly twenty-five at once, and the companion-candidate
  mechanism triggers the collision from an ordinary field-call spelling. The
  exposure belongs to the PR that joined `Seq.hex`.
- **Correction applied (2026-07-26).** The local is no longer chosen at
  reference time — it cannot be, because the names to dodge are not yet known.
  Resolution records only *that* a prelude term is used and spells the reference
  by the term's own name; `#preludeImport`, which runs after every declaration
  has been resolved, chooses each local against a set that is **closed by
  construction** rather than enumerated: every name `#declare` ever produced
  (the single funnel for all binder forms, present and future) plus every local
  an import introduces. Free-name probing covers a collision with the
  distinguished form itself. Emission substitutes the import's local for the
  symbol, since the reference no longer carries it.
- **Executable conformance:** `compiler/src/conformance/prelude-qualified.test.ts`
  — a named import, a constraint member reached only through a field call, a
  module-level pattern binder, and an extern declaration, each against a prelude
  term of the same name. Three are runtime round-trips; the extern case asserts
  the emitted top level declares the name once. All four are red before the fix.
- **The reusable part:** the fix that "enumerates a bit more" is the fix that
  fails again. Deriving the set from `#declare` is safe in the broad direction —
  it includes parameters and body locals, so it distinguishes more locals than
  strictly needed — and a spare distinguished local costs nothing while a missed
  one is unloadable output.

### 15. The inbound adapter does not memoize a forcing failure

- **Classification:** compiler defect against specification. **Pre-existing** —
  carried unchanged from the intrinsic `seq` helper into the FFI Part 3 bridge
  pair. Recorded by Fable on PR #91 (finding F4) as a log entry rather than a fix,
  since the unification neither introduced nor worsened it. **Corrected 2026-07-28.**
- **Authority:** FFI Part 3 §7.1 — "**If forcing a sequence node fails, that node
  remembers the failure**: forcing the same persistent position again must not
  advance the iterator and must not repeat the foreign operation." §7.2 step 6
  repeats it: a throw at any step is memoized as that node's failure outcome.
- **What happens instead:** a throw from `next()`, from a `done`/`value` getter,
  or from the malformed-result check propagates without being recorded. Forcing
  the same position again calls `next()` again, advancing the foreign iterator —
  exactly what §7.1 forbids, and observable as skipped elements after a caught
  failure.
- **Why it matters more now than it did:** the adapter is no longer scaffolding.
  It is one of the two pieces ruling R1 retains permanently, and `Seq` is the
  pilot `Vector`/`Set`/`Map` inherit, so the omission would be inherited.
- **Shape of the fix:** the spine's memo cell needs a third state beside
  *unforced* and *forced* — *failed, with the thrown value* — replayed on every
  subsequent force of that position. It is a change to the one helper.
- **Correction applied (2026-07-28).** `seqFromIterable` (emitter.ts) wraps the
  whole forcing step — acquisition, `next()`, the malformed-result check, the
  `done` and `value` reads — in one `try`, stores the thrown value, and rethrows
  it on every later force of that position. Failure is now an outcome of the §4
  spine, the third state beside unforced and forced.
- **One cell serves the whole spine, and the argument is the entry's substance.**
  Only the frontier position is ever unforced: a tail node is constructed solely
  in `pull`'s success path, so position *i+1* exists only because *i* forced
  cleanly. A failure pushes nothing and leaves `__hex_done` false, so the
  frontier does not move and no position beyond a failed one can be reached. The
  guard that gates forcing — `index === values.length && !done` — is therefore
  already exactly "this is the frontier", and the replay check sits inside it,
  which is what keeps a failure from poisoning the buffered positions before it.
  A per-node cell would encode the same fact more expensively.
  **The argument assumes forcing is not reentrant** — that foreign code driven
  by one forcing does not itself pull the same spine. Under reentrancy "a
  failure pushes nothing" is voided: an inner forcing can record a failure that
  an outer, still-running forcing then overwrites with a value, leaving a stale
  error replayed at a position the source would have served. Issue #123 asks for
  the ruling (raised by Fable, review finding F3). It is not a consequence of the single cell — a per-node cell
  collides on the same node — and the pre-fix spine was already incoherent
  there, reordering elements rather than replaying a stale failure.
- **The stored cell is a box, not the thrown value.** JavaScript permits
  `throw undefined`, so `failure !== undefined` would otherwise misread a
  genuine failure as unforced and re-enter the foreign call — the defect again,
  in the fix, on the one input that looks like the sentinel.
- **Executable conformance:** `seq-unification.test.ts`, a describe block of six.
  Five are one per throwing operation §7.1 and §7.2 name — `next()`,
  `[Symbol.iterator]()`, a `done` getter, a `value` getter, and the adapter's own
  malformed-result `TypeError`; `return()`, the remaining operation in §7.1's
  list, is not covered because the adapter never invokes it (§8). Each forces
  **one persistent position twice** and asserts the second throw is `toBe` the
  first (identity, so replay is distinguished from a re-run that throws a
  look-alike) and that the foreign side was touched once. Each foreign source
  yields a good value on the call after the failing one, so a re-invocation shows
  up as a *success* where §7.1 demands a replayed failure.
- **The sixth test is the one that pins the paragraph above**, and it was missing
  from the first cut of this fix. The other five all fail at the head, so none of
  them can tell a correct spine from one that poisons every buffered position: a
  mutant with the replay check moved *outside* the frontier guard passes all
  five, and the whole file. The sixth buffers position 1, fails twice at position
  2, and re-reads position 1 — the only case here whose failing position is not
  the head. It is the executable form of "a failure is an outcome of that node".
- All six confirmed red against the pre-fix helper in a detached worktree,
  failing on the same discriminator: one throw recorded instead of two.
- **Bearing on `memoize`:** `Seq.memoize` is specified as "the same mechanism as
  FFI Part 3's inbound adapter" (Loops §6.4), and `Seq` is the pilot `Vector`,
  `Set`, and `Map` inherit. Fixing the spine before exposing it to a second
  caller is why this entry led its phase rather than following it.

### 16. A call could pass more evidence than the callee's scheme declares

- **Classification:** compiler defect against specification. **Pre-existing**
  (reproduced on merged `main` at 8d759a0 in a detached worktree), found while
  fixing defect 4 — the first defect-4 repair was blocked by it.
- **Authority:** FFI Part 9 §13 — duplicate-evidence elimination is **maximal
  constraints per variable, eliminated before ordering, and the same rule
  internally and publicly**. Constraints §6.1 fixes the trailing-evidence ABI:
  one argument per constraint the callee's scheme declares, positionally.
- **Reproduction (clean compile, runtime crash), no value position involved:**

  ```
  let negate(a) = 0 - a
  export let out: Int = negate(5)
  ```

  `TypeError: Cannot read properties of undefined (reading 'fromNat')`. Writing
  the signature — `let negate<a: Signed>(x: a): a = 0 - x` — works, and that
  discriminating pair is what located it.
- **Defect origin:** the two sides of the ABI were built by different rules.
  `#publicScheme` (the definition) declares a parameter only for constraints not
  discharged through another's evidence, so `negate` took one `Signed`
  dictionary. `#publicRequirements` (the call) kept every requirement
  instantiation produced — `Num` *and* `Signed` — so the call passed two. The
  `Num` dictionary landed in the `Signed` slot; `.subtract` was `undefined`.
- **Correction applied (2026-07-26).** Call and value references both go through
  one rule that mirrors the definition: among requirements on the **same type**,
  drop any that a sibling constraint implies. That is §13's wording exactly.
- **The first attempt was wrong, and the way it was wrong is the lesson.**
  Filtering per requirement on "its `evidenceConstraint` names another
  constraint" — the test `#publicScheme` uses — looks equivalent and is not. A
  **projection** carries the same marking: `Same` reached as
  `__hex_dictLabeled.same` from an enclosing dictionary names another constraint
  too, and it is the callee's one real argument. That filter dropped it, and an
  existing emitter test caught it. Redundancy is a property of a requirement
  *relative to its siblings*, not of a requirement alone.
- **Executable conformance:** in the same file — a direct call supplying only
  the maximal constraint, the annotated spelling pinned as the control that the
  two must agree, and the projection case that forbids the per-requirement
  filter. Verified sensitive by blinding the elimination independently of
  defect 4's fix: exactly two tests redden, and they are the two about arity.

## 2026-07-27 — demand-site settling consults only builtin `Unit` instances

- **Classification:** compiler defect against specification; no design change.
  Logged alongside the spec note that makes it stateable (Numeric Literals §6,
  settling at synthesized `Unit` obligations; the #76 arc). Pre-existing on
  `main` at the two older settling sites (discarded non-final items, loop
  bodies); the #76 fix extended the same helper to the else-less `then` branch,
  and corrects it here (issue #108).
- **Authority:** Numeric Literals §6 — settling requires that at least one
  constraint on the variable has no `Unit` instance, user `honor` instances
  included. A variable every one of whose constraints `Unit` satisfies is left
  alone, unifies with the synthesized `Unit`, and the program is accepted; the
  guard is what confines settling to diagnostic routing.
- **Defect origin:** the guard's two sides consult different evidence.
  `#defaultDiscardedLiteral` (checker.ts:3754) tests the `Unit` side against
  the builtin `supports` table only, while its companion `#canDefaultToInt`
  consults user instances on the `Int` side. A constraint satisfied at `Unit`
  only by a user `honor` is therefore treated as unsatisfiable at `Unit`: the
  variable settles to `Int`, the demand-site unification fails, and a program
  the specification accepts is rejected.
- **Reach:** all three settling sites. The discriminating case is a discarded
  expression whose type variable carries only user constraints honored at both
  `Unit` and `Int` — exotic, but a wrong rejection, not a message defect, which
  is why the spec states the symmetric guard rather than the implemented one.
- **Correction:** demand-site settling gets its own predicate,
  `#settlesAtUnitDemand`, consulting instances symmetrically — builtin
  `supports` *or* instance lookup, on both the `Int` and the `Unit` side. It is
  deliberately not expressed through `#canDefaultToInt`, which answers §4's
  different *policy* question (is the constraint in the closed defaultable
  list) for generalisation: §6 wants user instances consulted and §4 wants them
  ignored, so one predicate cannot serve both. That separation is what lets the
  §4 defect — generalisation defaulting is user-extensible, contradicting its
  closed list — be corrected independently; it remains open as issue #109.
  Structural settling continues to ride on `#canDefaultToInt`, since the §6
  note routes it through §4's rule rather than the demand-site guard.
- **Executable conformance:** `checker.test.ts` — a constraint honored at both `Int` and
  `Unit` is accepted at all three sites; the same shape honored at `Int` only
  still settles and reports; bare `Num`-only literals still settle at all three
  sites; and a declared type variable is never settled, at either the plain or
  the structured demand.
- **Credit:** surfaced reviewing the Numeric Literals §6 note for the #76 arc:
  the note's guard was checked against the helper it describes, and the
  asymmetry fell out of the comparison.

## 2026-07-28 — a binding's right-hand side was read with its layout block attached

- **Classification:** compiler defect against specification, with one
  accompanying specification addition (Functions §8.2's multi-item ruling, which
  no document had decided). Issue #98; pre-existing on `main` since before the
  #65 arc that surfaced it.
- **Authority:** Lexer & Layout §2.1 — every term binding opens a block, and "a
  single wrapped expression is simply the one-item case, so the ordinary
  multi-line RHS is unaffected". Functions §8.2 fixes the value restriction over
  what the right-hand side *is*.
- **Defect origin:** the block was left in the tree, so every rule that inspects
  a right-hand side inspected the wrapper instead. `#isValue` had a `Group` case
  and no `Block` case, so an indented RHS was not a syntactic value and did not
  generalize; `#checkCompleteExportSignature` saw a non-lambda and asked for a
  type annotation instead of a complete signature; and the emitter's four
  `value.kind === "Lambda"` sites, with the two in `specializations.ts`, skipped
  the binding, so a constrained one that *did* generalize got no dictionary
  parameter. Whether a `let` was polymorphic depended on where it sat on the
  page.
- **Reach:** three visible faces, and they are ordered by how loudly they fail.
  An un-annotated indented binding was silently monomorphic and failed only on
  reuse at a second type. With a declared type variable it failed on *every*
  concrete call, including a single monomorphic one, reporting `Int` — a type
  nobody wrote, produced by defaulting the un-generalized variable. A
  constrained one, once generalization was repaired, reached ``missing `Num`
  evidence during JavaScript emission`` (itself issue #100's internal invariant
  wearing a user diagnostic's clothes).

  Two more faces surfaced in review, both silently corrected here. The
  *parenthesized* spelling was broken wherever the reader was not `#isValue`:
  ``export let plus = (<a: Num>(x: a, y: a): a => x + y)`` was rejected with
  ``exported value `plus` requires a type annotation`` for a binding whose
  signature is written out in full. And `#checkFunctionAvailability`, which
  seeds each block's `available` set from that block's own items only, rejected
  a `fun` used inside a one-item block against Functions §7.2 even where the
  capture was textually initialized — the peel removes the block before that
  inner walk exists, so this case converges on the inline spelling's answer.
  The multi-item spelling of it still fails, on both trees: filed as issue #112,
  since the layer-blind walk is a defect of its own and only its wrapper face
  belongs here.
- **Correction:** one peel, in the resolver, at the three binding-value
  positions (`Let`, `Var`, `LetPattern`). `Parsed.unwrapBindingValue` removes
  the wrappers that do not change what a right-hand side means — parentheses,
  and a block whose one item is an expression — and the parser's
  `#dischargeTypeParameterLambda`, which had grown the same walk for issue #65's
  F1, now shares it. Deliberately *not* fixed by adding a `Block` case to
  `#isValue`, the repair the issue proposed: that fixes generalization alone and
  leaves the other seven readers wrong. Deliberately not done in the parser
  either, where it would have to answer §7.1's separate question about `fun`.
- **What is not peeled:** a multi-item block (Functions §8.2 now rules it not a
  value); a block whose one item is a binding rather than an expression
  (Statements §3.1 rejects it, unchanged); and `fun`'s right-hand side, whose
  §7.1 lambda-literal check asks what the RHS *is* rather than what it means —
  the one exception Lexer & Layout §2.1 now names, and whose diagnostic is
  issue #113.
- **Executable conformance:** `conformance/binding-value-wrappers.test.ts` — the
  spellings of one binding are executed and compared; a declared type variable
  survives the indented spelling at a single monomorphic call; an indented
  constrained binding runs at two element types (compiling is not enough, and
  the entire suite passed while emission was broken); a pattern binding's
  binders generalize, with one binder used at two types, which is what
  discriminates; a captured `let` is still promoted; the parenthesized spelling
  is pinned at both faces it was broken at; an exported constrained binding
  emits byte-identical JavaScript and `.d.ts` either way; and the five guards
  above are pinned. Eleven of the twelve behavioural tests fail on `main`; the
  twelfth is labelled as the control.
- **Blast radius:** none in-repo. No `.hex` source — `stdlib/` and
  `runtime/VectorTrie.hex` are all of them — writes a binding in the affected
  shape; every indented right-hand side there belongs to a function *header*,
  making it a body, which was never affected.
- **Credit:** Opus filed the defect out of the #65 arc rather than fixing it
  inside that PR; Fable's #99 review established that the narrow `#isValue` fix
  was not extractable, which is what sent this fix upstream of the checker.
