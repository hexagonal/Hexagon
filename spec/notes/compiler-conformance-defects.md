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
  ``\`tally\` is already bound``. The same module written `export fun tally(...)`
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
