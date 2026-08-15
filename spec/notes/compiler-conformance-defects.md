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

- **Classification:** **FIXED 2026-07-31.** Was: limitation observed, awaiting a
  layout owner's ruling before it could be called a defect. The ruling is now in
  Lexer & Layout §2.2 — *a closing delimiter ends every layout block its group
  opened* — and it went the way that makes this a defect: both shapes were always
  meant to work.
- **Observation:** writing the pull step inline as
  `Seq({ pull: () => match next(source)` with the arms on following lines makes
  the layout algorithm close the record literal at the first arm
  ("expected `}` after record fields", "expected `)` after arguments"). The same
  applies to a multi-line lambda passed as a call argument.
- **Impact on the `Seq` core:** none, since 2026-07-31. Formerly: each combinator
  bound its step to a local `let` and then wrapped it.

*(Corrected 2026-07-31, issue #177 — at the time of this correction the finding
was still open; the Resolution below closes it later the same day. What #177 got
wrong was the scope claimed for it.)* Two inline spellings were conflated. Only
the one above failed:

```
Seq({ pull = () => match next(source)      -- fails: this finding
    None => None
    Some((value, rest)) => Some((...)) })

Seq({ pull = () =>                          -- parses clean, and always did
    match next(source)
        None => None
        Some((value, rest)) => Some((...))
})
```

Verified at `9e135be` — the commit that introduced `stdlib/Seq.hex` and the file
comment generalizing this finding to "the step cannot be written inline as the
record-field value" — and again on `main`: the second shape is clean at both, the
first fails at both with these same messages. The comment's generalization was
false when written, and ten combinators were shaped around it until #177 collapsed
them onto the working spelling; `stdlib/Seq.hex` no longer depends on this finding
either way, and `layout.test.ts` now pins the working shapes so the confusion
cannot recur silently.

Note for whoever takes the ruling: the canonical examples in
`seq-core-representation.md` §4.1 are written in the **failing** spelling, so they
do not compile as printed. That note is a closed rationale archive, so it is left
as-is rather than edited; this paragraph is the record.

**Resolution *(2026-07-31)*.** Fixed in the layout pass, and the ruling above is
the answer to that note: the §4.1 **examples** are now legal exactly as printed.
The archive's own prose is a separate matter and is left frozen — its §9 still
says "§4.1's inline `match` does not parse", which is now false; that sentence is
superseded here, not edited there. The cause was narrower than "a
multi-line `match` cannot be a record-field value" — the `match` was never the
problem. Any layout block whose group's closer shares a line with the block's
last item was left open, so a lambda body block ended by `})` failed the same
way with no `match` anywhere. Blocks now close at that closer.

Conformance: `delimiter-closed-blocks.test.ts` asserts byte-identity of emitted
JavaScript between the two spellings — the claim is not that both are accepted
but that they are the same program — plus `layout.test.ts`'s positional cases,
its `]`/wrong-kind-closer/interpolation guards, and a bracket-and-indentation
property test. Mutation-tested in three directions, counted over those two files:
removing the rule reddens 7, over-closing by one bracket level reddens 10
(including the guard that a block opened *before* the group survives its closer),
and dropping the semicolon amendment below reddens 1.

**One behavioural amendment rode this fix.** `validateSemicolon` treated any
same-line token as "a statement on the right", so once blocks began closing at
delimiters, `id(match p` … `False => 0;)` was accepted in silence while its
dedented twin still reported §5's trailing-`;` error — the two spellings
disagreeing on the very invariant this change exists to establish. A closer is
never a statement, so it no longer counts. The combination was unreachable before
(the parse errors this fix removes used to mask it), which is why no test caught
it and why it is recorded here rather than as its own finding.

`stdlib/Seq.hex` was **not** rewritten onto the newly legal spelling. #177 chose
its current shape on the merits (uniform across the loop-bearing combinators,
which have nothing to put on the `=>` line); this fix removes a constraint rather
than settling a style question.

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

### 12. An exported `Seq` no longer faces JavaScript as an `Iterable` (ruled 2026-07-28 — FFI Part 3 §9.4–§9.7; implemented 2026-08-02, PR #226)

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

- **RULED (2026-07-28, Fable in the spec seat).** The ruling is FFI Part 3
  §9.4 (mechanism at every position), §2.2 (inbound door: genuine `Seq` by
  identity), §9.5 (binding `Vector`/`Set`/`Map` inheritance, with Part 1 §8.2),
  §9.6 (rejected alternatives with prices), §9.7 (`toJsIterable` discharged by
  merger into the face + `Seq.memoize`); companions annotated: Part 7 §6/§7,
  Part 1 §8.2, Loops §6.4/§6.5, ledger §5.1. In one line: **the iterable face is
  representation** — every `Seq` value carries one shared `[Symbol.iterator]`
  whose traversals share a lazily created per-value memoized boundary view
  (§9.1's seven properties, verified against the composed R1 pair including
  #124's failure memoization); value and result positions are direct;
  parameter positions get occasion 1's stable wrapper over the §2.2 door;
  Hexagon-internal traversal never drives the face. None of the three "disagreeing"
  rules gives way: §9.1 holds in full, Part 7 §6 holds (a representation member
  is not a boundary artifact; identity crossing is now also *delivered* inbound),
  and R1 is amended, not broken (the compiler-side representation family grows
  from the pair to four named members). Part 1 §4.1's outbound row had stated
  the representation contract all along.
- **The pinning-test schedule the implementer inherits** (do not rediscover it;
  all in `seq-unification.test.ts`, the "boundary face (FFI Part 3)" describe)
  — *spent 2026-08-02: the implementer has acted (PR #226), and the resolution
  below settles this schedule item by item. It is kept as written because it is
  the record the settlement reads against. Its coordinates are the
  pre-implementation file's — measured, four of the five moved (`:324`→`:314`
  and `:353`→`:358`, both retitled; `:373`→`:423`; `emitter.test.ts:351`→
  `:365`), and the quoted assertion spellings inside those four are likewise
  pre-implementation; only the first (`:288`) still lands, line and title
  verbatim, on the test it names:*
  - *":288 a Seq crosses out to JavaScript as an Iterable"* — `.d.ts`-only;
    **stays green, keep unchanged.**
  - *":324 an exported function's Seq positions face JavaScript as the record
    too"* — the two `.d.ts` assertions **stay**; the two JS assertions become
    wrong and are the deliberate reds: `toContain("const total = values =>
    fold(values, 0,")` (the binding becomes the stable wrapper) and
    `not.toContain("__hex_seqFromIterable")` (the wrapper reaches the inbound
    door). Replace with runtime round-trips per the file's own doctrine:
    (a) a JS caller passes a plain array to `total` and gets the sum (adapter
    ran); (b) identity pass-through — `export let same(values: Seq(Int)):
    Seq(Int) = values`; from JS, `same(counted) === counted` for an exported
    `Seq`, while `same([1, 2])` returns a non-array `Seq` that iterates
    `1, 2`; (c) a second `.hex` module imports `total` and calls it with a
    `.hex`-built `Seq` — wrapper transparency for Hexagon importers;
    (d) `[...upTo(3)]` yields `[1, 2, 3]` (result position, no wrapper).
  - *":353 an exported Seq faces JavaScript as the record, not yet as an
    Iterable"* — `expect(counted[Symbol.iterator]).toBeUndefined()` **inverts**
    (that is the headline red). Replace the test with §9.1 conformance:
    `typeof counted[Symbol.iterator] === "function"`; spreading twice yields
    `[1, 2, 3]` twice; two interleaved cursors advance independently;
    memoization via an extern `tick()` counter in the pipeline — two full JS
    traversals leave the counter at 3, not 6; and channel separation — a
    Hexagon-side export that folds the same `Seq` still re-derives (counter
    grows per Hexagon traversal) per Loops §6.4. `typeof counted.pull` may stay
    (the record representation is unchanged).
  - *":373 a foreign `Seq` result enters through the inbound adapter, not
    raw"* — the intent stands; the emitted-name regex
    (`__hex_seqFromIterable(...)`) survives only if the emitter keeps that
    spelling for the door, which is latitude — prefer rewriting it behavioural.
    Add the door's new half: an extern `echo(values: Seq(Int)): Seq(Int)`
    implemented in JS as the identity returns the very spine — observable
    because traversing the round-tripped effectful `Seq` twice from Hexagon
    re-derives (ticks double) instead of replaying a silently added memo layer.
  - The failure-memoization describe and everything above the boundary-face
    describe are unaffected; `emitter.test.ts:351`'s `.d.ts` face assertion
    stays. Every new red must be confirmed red against pre-ruling `main` per
    the standing rule.
- **Resolution *(2026-08-02)*.** Implemented and merged 2026-08-02 as PR #226
  ("Build defect 12: give every `Seq` its JavaScript face" — merge `847cdbb`,
  sole build commit `06505b0`). Settled against the merged compiler test by
  test, not inherited from the PR text:
  - **The headline inversion landed.** The record-not-yet-Iterable test is now
    `seq-unification.test.ts`'s "an exported Seq faces JavaScript as an
    Iterable, by representation": `typeof counted[Symbol.iterator]` is a
    function on the very value whose `pull` stays, and the value export is the
    raw ESM binding. The `.d.ts`-only test and the schedule's two staying
    `.d.ts` assertions are unchanged; every hunk the build commit makes in
    `seq-unification.test.ts` falls inside the boundary-face describe; the
    `emitter.test.ts` face assertion stayed (the commit's only change there is
    the door's new spelling).
  - **The §9.4 substance landed in a new file**, `seq-boundary-view.test.ts`,
    not in `seq-unification.test.ts` as the schedule assumed — one describe
    per §9.4 property, plus channel separation and wrapper transparency.
    Repeat spreads, two independently advancing cursors, the side-effect
    counter reading 3 (not 6) after two full foreign traversals — the probe is
    spelt `note`/`steps`, not `tick` — and the internal channel re-deriving
    the same value foreign cursors replay (Loops §6.4) are all there, most
    sharper than scheduled (interleaved cursors are additionally checked by
    per-position force counts).
  - **The parameter position landed as scheduled and then some**: a JS caller
    passes an array, a `Set`, and a single-shot generator; the cross-module
    Hexagon importer exists twice over — the scheduled smoke form plus a form
    the schedule did not ask for, non-re-adaptation observed by derivation
    count. The two old JS assertions inverted exactly as named, with one
    spelling shift: the wrapper reaches the door as `__hex_seqInbound` (§2.2's
    door landed as its own fourth family member, not a use of
    `__hex_seqFromIterable`), so the schedule's emitted-name regex survives
    rewritten to the new name rather than behavioural — with behavioural
    companions added (a foreign function receives a working iterable; a
    foreign non-`Seq` iterable is still adapted freshly). The `echo` extern
    landed stronger than scheduled: spine identity is asserted directly
    (`returned === sentOut`), which subsumes the ticks-double observation.
  - **Two scheduled observations have no test in the landed suite** — recorded
    as residue rather than silently dropped: *(1)* the identity pass-through
    in the schedule's own composition (`export let same(values: Seq(Int)):
    Seq(Int) = values`; from JS, `same(counted) === counted`, and
    `same([1, 2])` a non-array `Seq` iterating `1, 2`) exists in neither file.
    Its halves are each proven — door identity via the extern round trip,
    wrapper non-re-adaptation by derivation count, result-position directness
    — but no test drives an exported wrapper from JavaScript and observes
    object identity on a returned `Seq`, and nothing surfaces the wrapper's
    adapter product as a JavaScript value. *(2)* `[...upTo(3)]` — an
    element-exact spread of a *function-result* `Seq` from JavaScript; the
    landed suite spreads function results only by length (property 7's
    collection test) and spreads value exports element-exactly.
    **(1) done (2026-08-03, #247)** — `seq-unification.test.ts`'s "a genuine
    `Seq` handed back at a `Seq` parameter crosses by identity" adds both
    halves. Read the residue above as written and no wider: the *composition*
    was already driven — the spine-reclamation fixture's `advance`/`elementAt`
    both take occasion 1's wrapper and are called from JavaScript with a
    genuine `Seq` — and it is the **object-identity observation** that was
    missing, which is what that clause says. Measured while closing it:
    removing the door's identity branch reddens seven other tests besides the
    new one, so this was never a silently-failing path; what the new test alone
    catches at runtime is the *other* half, a wrapper omitted for a
    `Seq`-in/`Seq`-out export.
    **(2) done (2026-08-03, #248)** — `seq-unification.test.ts`'s "a `Seq`
    returned from a call crosses element-exactly, and replays": elements,
    `pull`, two replays, and result-directness stated by identity against a
    value export the same module publishes. **Correct the sentence above while
    reading it**, which (1)'s own discharge overtook: since #247's test landed
    (2026-08-03), a call result *is* spread element-exactly — `same([1, 2])` —
    so what was missing by then was narrower, a result whose elements originate
    in Hexagon rather than in the argument that went in. What this test holds
    **alone** is not that: it is the only place two *distinct* `Seq` values
    built by one emitting module cross the boundary, so it is what fails if
    `seqIterate` keeps a single shared view instead of keying per value —
    §9.4's own property 1 and 2 tests survive that mutation, each traversing
    one value. Recorded against over-reading: three other mutations kill it
    *along with* many others (a single-shot boundary view, ten; adapting a
    `Seq` result to a plain iterable, and re-adapting it into a fresh `Seq`,
    both gated to exports with no `Seq` parameter and both counted over prelude
    modules too — a different gate gives a very different number, which is why
    the gate is stated rather than the count alone).
  - **Beyond the schedule**, `seq-memoize.test.ts` changed too: `memoize`'s
    export takes occasion 1's wrapper, and `Seq.hex`'s own `.d.ts` face became
    `Iterable<a>` — the `Seq`-shaped debt-family member recorded by edit note
    in Part 3 §9.5 (2026-08-02). Confirmation of each new red against
    pre-ruling `main` is asserted by the build commit's message
    (mutation-verified), not re-checked here.
- **Filed separately, found while binding §9.5** (not this ruling's to fix):
  the emitted `.d.ts` faces for `Vector`/`Map`/`Set`/`Range` are
  `ReadonlyArray`/`ReadonlyMap`/`ReadonlySet`/bare `Iterable<number>`
  (emitter.ts `renderType`), diverging from Part 1 §4.1/§8's decided `Hex.*`
  branded faces — pre-existing, and `ReadonlyMap`/`ReadonlySet` promise API
  the HAMT records do not have. Needs its own defect entry / issue.
  **Done (2026-08-03, recorded under #242): the entry is #128** — ruled at
  FFI Part 1 §8.3 (2026-08-02), implemented and merged 2026-08-03 (`882ed2c`).
  `renderType` now emits the branded `Hex.*` faces, declared in a
  program-scoped emitted `hex.d.ts` that each mentioning `.d.ts` imports
  type-only; conformance is `runtime-collection-faces.test.ts`. Do not
  re-file.

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
  the ruling (raised by Fable, review finding F3) — **ruled 2026-08-02, FFI Part
  3 §7.3; see the last entry in this file**. It is not a consequence of the single cell — a per-node cell
  collides on the same node — and the pre-fix spine was already incoherent
  there, reordering elements rather than replaying a stale failure.
  **Superseded 2026-08-02 (#131).** The shared buffer this whole argument is
  stated over is gone; the cell is per node, because §5 requires the *values* to
  be per node and §4 puts failure in the same memo. Read the bullet above as a
  record of why one cell was enough *then*, not as a description of the code.
  Three of its sentences do not survive, and are listed because the temptation
  is to assume they do:
  - "The guard that gates forcing … is therefore already exactly 'this is the
    frontier', and the replay check sits inside it, which is what keeps a
    failure from poisoning the buffered positions before it." The replay check
    is now *outside* the forcing guard, and non-poisoning rests entirely on the
    cell being per node. Verified by mutation: moving the box back to the
    adapter's scope while leaving everything else per node reddens `a failure
    does not poison the positions already forced before it` — a failure mode the
    buffer did not have.
  - "A failure pushes nothing and leaves `__hex_done` false." Neither referent
    survives. Nothing is pushed anywhere, and `__hex_done` was reinstated by
    #131's first review round and then deleted outright by the #123 ruling
    (entry below), which makes the collision it guarded against impossible.
    *(This bullet said "half survives, `__hex_done` still exists" between #131
    and #123; it was true for those hours and is recorded as having been so.)*
  - "A per-node cell would encode the same fact more expensively." That is an
    argument against the representation §5 requires and #131 shipped.
  - "An inner forcing can record a failure that an outer, still-running forcing
    then overwrites with a value, leaving a stale error replayed at a position
    the source would have served." The overwrite cannot happen at all since the
    #123 ruling: there is no second forcing to do the overwriting. (Between #131
    and #123 it was prevented differently, by store guards that are now gone.)

  The reentrancy caveat was #123's, and #123 is **ruled** (2026-08-02, FFI Part
  3 §7.3): the collision this bullet reasons about — two forcings of one
  position — cannot occur, because the second forcing is refused. The reason the
  bullet gave for leaving it open (a per-node cell collides on the same node)
  was right, and is why the answer had to come from refusing rather than from
  choosing a winner.
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

## 2026-07-28 — generalisation-time defaulting was user-extensible

- **Classification:** compiler defect against specification; no design change.
  Issue #109; pre-existing on `main`, filed out of Fable's review of the #76 fix
  and left open there deliberately (see the 2026-07-27 entry) so that the two
  questions about one helper could be corrected in the right order.
- **Authority:** Numeric Literals §4 — the defaultable set is "a hard-coded set
  in the compiler, **not user-extensible**", and its consequence list is
  explicit about this exact case: a tyvar with `{Num α, SomeUserConstraint α}`
  "does **not** default; proceeds to ordinary generalisation if the binding
  form allows it, or produces an ambiguity error if it doesn't. Error message
  should name the non-defaultable constraint (§6)." §7 rejects Haskell-style
  extensible defaulting as a *design*, so this is not room the spec left.
- **Defect origin:** `#canDefaultToInt` answered §4's policy question with §6's
  semantic evidence — builtin `supports` **or** a user `honor` instance at
  `Int`. A user constraint honored at `Int` therefore joined the closed list,
  which is precisely the extensibility §4 forbids:

  ```
  constraint Conjure<a> =
      make(): a
  honor Conjure<Int> =
      make() = 1
  let v = make()
  ```

  compiled clean, with `v` silently `Int`.
- **Reach:** wider than literals. The test is stated over *constraints*, not
  provenance, so any variable a user constraint reached — a literal's (§3), or
  one constrained only by use — defaulted through that user's instance, at both
  §4 sites (`#generalize` and the end-of-module leftovers) and at the structural
  settling that §6 routes through §4's rule.
- **Correction:** `#canDefaultToInt` reads the compiler's own `Int` instance
  table and never `#instances`. The split #108 prepared is what made this a
  one-predicate change: `#satisfiedAt` keeps answering §6's semantic question
  *with* user instances, and the two no longer share an answer. Alongside it,
  §6's blocked-defaulting report now exists at §4's ambiguity point — the
  end-of-module pass, the last place the blocking constraint can still be named
  — reporting at the literal where one is in the set (naming it, per §6) and at
  the *use* of the blocked scheme otherwise. That last part took a second pass:
  a requirement copied out of a scheme inherits the **declaration's** span, so
  the first spelling carets the constraint member's signature — another
  module's source, for an imported constraint — for a report about the caller.
  `#instantiate` now records the use site on each copy, and the report prefers
  it. (The pre-existing missing-instance report has the same wart and is left
  alone here: it is a defect of its own, filed as #136, not this arc's.) A
  declared variable is never reported: an annotation already pins it, so
  nothing about it was blocked (the Rewrite Rule).
- **One knock-on inside §6's own machinery.** Structural settling (§6's last
  paragraph) settles a discarded branch's literals by §4's rule, so under the
  closed set a component can now *survive* into a mandatory fixit —
  `(make(), 2)` reported as ``(?2, Int)``. §6 requires survivors there to be
  "named rather than numbered", the same sentence that excepts declared
  variables, so survivors take source-shaped display names: ``(a, Int)``. The
  name is display-only and never participates in unification, which is what
  keeps it distinct from `rigidName`.
- **A second, silent defect surfaced with it.** A parameterized instance's own
  parameter — the `a` of `honor<a: Render> Render<Box(a)>` — was not quantified,
  so `#defaultRemainingVariables` treated it as an unresolved inference
  variable and, where the parameter's constraint had any `Int` instance, bound
  it to `Int`. Unobservable before (nothing downstream reads the pruned
  variable; the dictionary factory is built from the resolved item), it became
  a wrong ambiguity report the moment §6's diagnostic existed. Fixed the way
  the constraint *subject* three declarations below it already was: quantified
  at the header that binds it.
- **What it costs, stated plainly.** A literal under a user constraint now
  requires an annotation — `render(Box({value = 42}))` becomes
  `let boxed: Box(Int) = Box({value = 42})`. That is §4's consequence list
  working as written, and the emitter test that carried the old spelling was
  updated rather than exempted; but it is the user-visible price of the closed
  list, and it is worth knowing that the corpus chose it deliberately (§7).
  Blast radius otherwise none in-repo: all seven `stdlib/` modules compile with
  no blocked-defaulting report, checked by compiling each one.
- **Left open, filed as #135:** §4 enumerates *five* defaultable constraints
  and the compiler's closed set is the eight-name `Int` table (`Pow`, `Hash`,
  and `Integral` besides). The fix keeps the table, because Integral §8's
  diagnostics row requires `gcd(4, 6)` to resolve to `Int` "as usual" and the
  five-name reading makes it an ambiguity error. Which of the two is the rule
  is a spec ruling, not an implementation choice — the user-extensibility
  defect is closed either way. **Ruled (Fable, 2026-07-28, on #135):** the
  property is the rule and the list was its v1.1 snapshot, so the compiler is
  conformant. Fable then wrote the correction record into Numeric Literals §4
  and refreshed the two restatements (§8 item 4; Type System Overview §2's
  pillar 4, edited directly — the README classifies that document as a
  non-authoritative router, and an echo of a rule has no authority to defer).
  §4 now stops enumerating: membership *is* "the compiler ships this
  constraint's `Int` instance". The per-type inventories in Primitive Types
  §2/§6 have the same drift and are #137.
- **Executable conformance:** `checker.test.ts` — the issue's repro reports
  instead of defaulting and leaves `v` a variable; the annotation §6 names
  compiles; a literal under a user constraint reports at the literal, naming it
  and the blocking constraint, with the span pinned; unified literals collapse
  to one report; a declared type variable is never reported; `{Num, Integral}`
  and `{Num, Show}` still default to `Int`; and a parameterized instance's
  parameter is clean. Both report locations are pinned by span, not just by
  message — the caret is the half that was wrong first — and the structural
  survivor's name is pinned at both mandatory fixits. Verified sensitive by
  blinding each part independently: restoring the user-instance lookup reddens
  the closed-set test alone; removing the quantification reddens the
  parameterized-instance test and the emitter's dictionary-factory test;
  dropping the use-site span reddens the closed-set test; and dropping the
  survivor naming reddens the structured-branch test.
- **Credit:** Fable, in the #76 review, separated the `Unit` side (#108) from
  the `Int` side (#109) of one helper and predicted that splitting the
  predicates would let the second be corrected without undoing the first, which
  is how it went. Fable's review of this fix then found both defects in the new
  §6 machinery — the caret on the declaration and the numbered survivor —
  neither of which the author's own tests covered, since both tests asserted
  the message and the message was right.

## 2026-08-02 — the memoizing spine retained via a central array

- **Classification:** compiler defect against specification; no design change.
  Issue #131; pre-existing on `main`, filed out of Fable's review of the
  intrinsic-door / `Seq.memoize` implementation as "pre-existing defect A" and
  deliberately left open there, since that change neither created nor worsened
  it.
- **Authority:** FFI Part 3 §5, which decides the representation in as many
  words — "Memoization is represented by **persistent lazy nodes, not a
  permanent central history array**" — and then spends that decision on two
  clauses: "once an older position is unreachable, ordinary garbage collection
  may reclaim its cached prefix", and the user-facing space rule that
  "advancing while retaining only the current cursor permits unreachable
  prefixes to be collected".
- **Defect origin:** `seqFromIterable` memoized into a single `__hex_values`
  array in the adapter's scope, closed over by every node it handed out. Every
  node therefore held every forced value, including the ones before it, so
  retaining *any* position retained the entire forced prefix. Advancing while
  retaining only the cursor retained everything — the exact case §5 promises
  costs nothing.
- **What was *not* wrong, and stayed that way:** §5's other two clauses were
  already satisfied and are untouched. No cache limit evicts reachable history
  (there is no cache limit), and the shared iterator state keeps no
  back-reference to the head. The defect was the representation and the
  reclamation property §5 derives from rejecting it.
- **Why it mattered more than when it was written:** until `Seq.memoize` landed
  (Loops §6.4, #125), this spine backed only boundary-crossed values, and §5's
  space rule is written for that audience. `memoize` lowers to the same spine by
  design — §6.4 names it as "the same mechanism as FFI Part 3's inbound
  adapter" — so pure Hexagon programs that never touch the FFI inherited a cost
  strictly worse than the one the spec documents for them.
- **Correction:** the memo moved into the nodes. A node holds its own outcome
  and, on success, a direct reference to its successor, so references run
  head-to-tail only and the adapter scope holds no node at all. Retaining
  position *i* retains the forced suffix from *i* and none of **this spine's**
  prefix, which is §5's representation as written.
- **That qualifier is load-bearing, and was added after review.** The adapter
  keeps `__hex_source` and the iterator it acquired, which is state §5 permits
  it to share. But when the source is itself a `Seq` — both `seqMemoize` and
  `seqIterate` build the spine over `seqToIterable(s)`, whose generator closes
  over `s`'s head — that pins the *source's* head, and a source that stores
  rather than re-derives still has its prefix pinned through it.
  `Seq.memoize` over an inbound-adapted `Seq`, which is a likely thing to write,
  therefore still retains everything. A second retention channel, in the driver
  rather than in the memo, reproduced independently and filed as **#230**. The
  first draft of this entry claimed the reclamation property without the
  qualifier, and its two tests were built on re-deriving sources, which is
  exactly the shape where an over-general claim cannot be caught by its own
  coverage.
- **The failure cell moved with it.** Entry 15's shared `__hex_failure` box was
  argued from the buffer's frontier guard; per §4 each node memoizes exactly one
  outcome, and end / `(value, tail)` / failure are the three, so failure belongs
  in the node beside the value. The box stays a box — JavaScript permits
  `throw undefined`. Entry 15 carries the supersession note, including which of
  its sentences do not survive.
- **`__hex_done` stayed shared, and the first draft deleted it.** *(Reinstated by
  this round, then deleted outright by the #123 ruling — last entry — which makes
  the collision below impossible. Read this bullet in the past tense.)* Exhaustion is a
  property of the source, not of a position, and §5's division puts it exactly
  where the iterator is. The argument for deleting it was that the frontier is
  now structural — a tail is built solely in the success path, and is reachable
  only if that outcome won its node's memo, so the reachable nodes form a chain
  of which at most the last member is unforced. That much is true. What it misses
  is that **the frontier can sit behind an ended source**: one forcing of a node
  can see the source end while a reentrant forcing of the same node got a value
  and won, so the node hands out a tail the source has nothing left for.
  Without the flag, forcing that tail calls `next()` on an iterator that already
  reported done — verified against the deleted version, which drives a third
  `next()` where the flag stops at two.
- **A step is written once, and a failure never over one — two review rounds to
  get there.** The first draft guarded neither store, so a reentrant inner
  forcing's outcome was overwritten by the outer's and two tails of *the same
  position* went on to yield different elements: `Seq` persistence itself
  failing, where the buffer it replaced had merely reordered them. Round 1
  guarded both stores on the node being unforced, which fixed that and made §4's
  "each node memoizes exactly one outcome" an invariant the code holds rather
  than a sentence it cites. Round 2 found that spelling had a defect of its own,
  on #123's own reproduction: when the *inner* forcing throws and the outer
  succeeds, the inner's failure was written first and won, so the head answered
  with that throw forever and took the whole sequence with it — where the buffer
  had returned the outer's value. So a step now clears a failure stored beside
  it, while a failure is stored only into a node holding neither. Both
  directions of the collision are pinned by a test, and each reddens alone.
  **Removed 2026-08-02 by the #123 ruling (FFI Part 3 §7.3), along with the
  shared `done` flag above.** Both were repairs for a collision between two
  forcings of one position, and §7.3 refuses the second forcing outright, so
  forcings of a spine are serialized and no collision can occur: each node is
  forced exactly once, and the source cannot report end while an unforced node
  exists. The reasoning is recorded in the new entry below, with the evidence
  for it — including an instrumented build in which the whole suite reaches none
  of the three conditions. What the two rounds bought was not wasted: they are
  what established that the alternatives to refusing were all silently wrong.
- **What this does not buy, stated plainly.** Besides #230 above: a
  JavaScript-side traversal pins the prefix for its duration and beyond —
  `seqToIterable`'s generator closes over the head, and §9.4's boundary view is
  retained by the value for the value's lifetime. Both of those are deliberate,
  the second being §5's own 2026-07-28 addendum. §5's clause is about a program
  advancing a cursor, which is why the conformance below advances it in Hexagon
  rather than driving it from the test.
- **Executable conformance:** `seq-unification.test.ts`, two describe blocks.
  - *Reclamation*, two tests — the inbound adapter over a foreign iterable, and
    `Seq.memoize` over a pure Hexagon sequence, since #131's urgency is that the
    two are one spine. Each walks a 200-element sequence to position 150, keeps
    only the cursor, and asserts that `WeakRef`s to positions 0, 1, 40 and 100
    have all cleared, then that the cursor still answers. Collection is observed
    the way §9.4 property 7's test observes it (`--expose-gc` exposed and
    withdrawn in-process, so it runs on every ordinary `vitest run`), and the
    elements are tuples because a `WeakRef` needs an object. Both sources
    re-derive, which is what makes the memo the only possible holder — and is
    the qualifier #230 is about.
  - *Reentrancy*, four tests, pinning invariants rather than a semantics —
    **all four superseded 2026-08-02 by the #123 ruling**, which replaced the
    invariants they pinned with a refusal. They are recorded here because the
    collisions they described are what the ruling was made against, and because
    two of them drove the emitted helper by name on the belief that a reentrant
    source "has to hold the node being forced, which no Hexagon program can hand
    it". That belief was false in a way worth remembering: no Hexagon *module*
    can, but a third module handing the value to the foreign one is an ordinary
    program shape, and it is the shape the replacement tests use.
  - **Verified sensitive, by mutation, each part separately.** Restoring the
    pre-fix helper reddens both reclamation tests, and also the agreement test —
    on `sameTail`, for an unrelated reason: the buffer allocated a fresh tail
    object on every pull, so node identity was never a property it had. (That
    assertion is node identity, a fact about the representation; `sameValue` and
    the drive equality are the invariant.) Reintroducing a shared values array
    while keeping the per-node successor reddens the two reclamation tests and
    only those, so they pin central retention and not merely "the arm changed".
    Dropping the step guard reddens the agreement test; dropping the failure
    guard, the first non-poisoning test alone; dropping the failure *clear*, the
    second alone; deleting `__hex_done`, the exhaustion test alone; moving the
    failure box back to the adapter's scope, entry 15's non-poisoning test
    alone. Two tests written here did not redden the mutation they were written
    for and were replaced or added to — an earlier exhaustion test survived the
    `__hex_done` deletion, and round 1's failure guard was shipped with no test
    at all until round 2 found it. (Four of these mutations no longer have
    targets — the step guard, the failure guard, the failure clear, and
    `__hex_done` — because §7.3 removed the code they mutate. Restoring the
    pre-fix helper and reintroducing a shared values array still redden the two
    reclamation tests, which are untouched.)
- **Left open at the time, and since closed:** reentrant forcing (#123) — ruled
  2026-08-02, FFI Part 3 §7.3, entry below — and #230, still open. What this
  entry recorded about reentrancy was that the per-node memo differed from the
  buffer in two ways rather than matching it: the losing forcing's element was
  dropped where the buffer reordered it, and the position after a reentrant
  forcing was served from the source where the buffer replayed a stale failure.
  Both readings were right, and both are moot — §7.3 refuses the second forcing,
  so there is no loser.
- **Credit:** Fable, reviewing the intrinsic-door implementation, read §5's
  representation sentence against the helper source and filed the divergence
  rather than folding it into an unrelated review. Two cold Opus rounds then
  found, between them, the unqualified retention claim (twice — round 1's fix
  left it standing on `seqMemoize`, the one helper where it always bites), the
  `__hex_done` deletion, the missing store guards, and the poisoning that round
  1's own guards introduced. Both rounds worked by running the two helper
  versions side by side in a standalone script, which is what made "same as
  before" a checkable claim rather than an assumed one.

## 2026-08-02 — reentrant forcing lost an element, silently (the #123 ruling)

- **Classification:** a **ruling**, and a conformance fix that follows from it.
  Unlike every other entry here, the specification did *not* already decide this
  — FFI Part 3 §4 and §7.1 described forcing as an atomic step with one outcome
  and said nothing about foreign code re-entering the spine mid-forcing. Issue
  #123 was filed by Fable as a ruling request against exactly that gap. The
  ruling is now **§7.3–§7.4**; this entry records why it went the way it did and
  what the implementation lost as a result. (§7.4 — the error kind — is the spec
  seat's, written after this entry; see the amended error-kind bullet below.)
- **What the gap cost, and why no rule could have made it lossless.** Two
  forcings of one position each advance the source, and only one result can be
  that position's memoized outcome. This is an impossibility, not a survey: the
  reentrant forcing needs a value the enclosing `next()` has not returned yet,
  so lossless *and* order-preserving would require the inner forcing to wait for
  the outer, which single-threaded synchronous JavaScript cannot express. So the
  other element is lost or the sequence is reordered, and both silently: a four-element foreign sequence came back
  from `Vector.fromSeq` with three, the reentrant traversal and the enclosing
  one agreeing on the short answer, and nothing raised anywhere. No test in the
  suite could see it, because both observers were wrong the same way.
- **The reachability claim in the issue was wrong, and that mattered.** #123
  recorded the case as unreachable from the conformance harness — "its data-URL
  modules cannot be circular" — and described the real program shape as a
  circular ESM import. No cycle is needed. A third module hands the `Seq` to the
  foreign module that the sequence's own derivation calls, which is an ordinary
  program and is what the conformance tests now do. Believing it exotic is part
  of why it stayed open, and is why the ruling is not "unspecified".
- **What the platform already did, checked before ruling.** Every spine whose
  source is a `seqToIterable` generator — every `Seq.memoize` (Loops §6.4) and
  every §9.4 boundary view — already had the reentrant advance refused by
  JavaScript itself: `TypeError: Generator is already running`, with the
  enclosing traversal completing correctly and losing nothing. Only a foreign
  iterator whose `next()` is an ordinary function reached the incoherent path.
  That measurement is what turned option 3 in the issue ("detect and reject",
  costed there as inventing a failure mode §7.2 says the adapter does not have)
  into the *conservative* option: it conforms one case to the platform.
- **The consequence review found, recorded rather than ruled (#232).** A refusal
  reaching a *second* spine is memoized there by §7.1 like any other throw out of
  a source — and that is the common case, because a reentrant traversal usually
  arrives through the §9.4 boundary view, JavaScript's route into a `Seq` value.
  (Not its only route: foreign code that calls an exported Hexagon function
  re-enters through the internal channel instead, and poisons nothing.) The
  value is then finished as an `Iterable` to JavaScript, while the Hexagon-side
  traversal completes correctly. §7.3's first draft said the opposite ("does not
  touch the memo", "the enclosing forcing is unaffected otherwise"), which was
  true only of the Hexagon side.
  **Two repairs were tried, and the second one works.** Brand the refusal with
  its raiser and decline to memoize one you did not raise: the value reads as an
  *empty* sequence instead, because the refusal travels out through
  `seqToIterable`'s generator, a generator that has thrown is completed, and the
  next forcing reads `done` off it and memoizes end. Silent truncation for a
  persistent error is the wrong trade. But the completion is an artifact of the
  driver being a generator, and nothing in Part 3 requires one: emit
  `seqToIterable` as an explicit cursor and the same brand keeps the foreign
  face working — measured, whole suite green but for the test pinning today's
  behaviour. Both halves land together or not at all, and `seqToIterable` is half
  of R1 and the internal `for x in` driver, so **#232** owns it rather than this
  ruling. §7.3's bullet is written as behaviour, not as a decision, for that
  reason. The second review round found this; the first had accepted the
  one-repair reasoning.
- **Why not "unspecified" (the issue's option 1).** It was the cheapest and it
  reads like the rest of §4, and Part 1 §3.1's unspecified-observation doctrine
  looks like a fit. It is not one. §3.1 is about foreign code violating a
  declaration; here the foreign code satisfies its declaration exactly and the
  program contains no lie. Reentrancy is a cyclic value dependency — and a pure
  Hexagon program cannot build one, since `let` is non-recursive (checked: the
  checker says so in as many words) and a closure cannot capture a `var`
  (Statements §6.2), so the cycle always runs through the boundary without
  running through misbehaviour. Leaving it unspecified would have left silent
  element loss in a program with nothing wrong on its face.
- **Why not "success supersedes" (option 2).** It picks a different loser. The
  element the other forcing consumed is still gone.
- **Correction, and what it deleted.** One `forcing` flag per spine; a pull that
  would begin forcing while one is in flight throws before touching the source,
  the memo, or the iterator. The check sits **before** the `try` — the reentrant
  pull is of the very node being forced, so a throw from inside would memoize as
  that node's failure and poison the position the enclosing forcing is about to
  answer. Because forcings are now serialized, three mechanisms added between
  #131 and this ruling are unreachable and are gone: the shared `done` flag, the
  first-writer guard on the step store, and the guard on the failure store.
- **The unreachability argument, and how far the evidence goes.** Forcings of a
  spine cannot interleave (single-threaded, synchronous, the flag set at the top
  of the forcing step and cleared in `finally`), so each node is forced exactly
  once; and an unforced node exists only because its predecessor's `next()`
  returned not-done, so **this spine** cannot have observed end while one
  exists. The per-spine qualifier is not decoration: two adapters over one
  self-iterable foreign iterator can drive each other's shared cursor to
  exhaustion, and one will then call `next()` on an exhausted iterator. That is
  §2.1's documented "repeated crossings of a single-pass generator observe its
  current position", it behaves identically on `main` (the deleted flag was per
  spine too), and it is not what the deletion turns on.
  That is an argument from the code, not a proof. It was checked by building the
  compiler with the three conditions instrumented to throw and running the whole
  suite: 1103 tests, none reached. **Evidence of non-reach, not proof of
  unreachability** — the honest statement, and the reason the argument is
  written down where a reviewer can attack it.
- **What this does not do.** It does not govern re-derivation. The internal
  channel builds no memo, so a derivation that observes its own sequence there
  re-derives from the head each time and recurses — and because Loops §6.5
  declines tail-call elimination, it **fails fast with a stack overflow**. The
  first draft said "does not terminate" and cited §6.5 for it, which is
  backwards: §6.5 is the reason such a program *does* terminate, loudly. Nothing
  detects it and nothing needs to, and §7.3 says so rather than leaving the
  boundary rule to be read as a language-wide one.
- **Where the check lawfully lives, which the first draft never asked.** Part 1
  §3.1 is argued against at length above; **§3.2** is the section that says
  validation happens *only* in an enumerated set of places, and a reentrancy
  guard is in none of them. The answer is that §3.2 governs validation of
  *foreign values* and this validates the adapter's own state — but a ruling
  marked do-not-re-litigate must not step past a normative "only" in silence,
  so §7.3 now makes it.
- **The error kind, honestly.** The first draft said `TypeError` was the kind
  "because" the platform already used it for generator sources. That does not
  follow: the check now precedes the platform's, so the rule *replaces*
  `TypeError: Generator is already running` in both cases rather than deferring
  to it. §7.2's "no separate Hexagon error type" is a sound reason on its own
  and is now the only one given — with the alternative named (`vectorAt` raises
  a branded `IndexError`; the same shape was available) and its cost stated: a
  `JsError` payload is interrogable only by message.
  **Overruled 2026-08-02 by the spec seat — FFI Part 3 §7.4.** §7.2's reason
  turned out not to reach either: that sentence licenses the platform's own
  minimum protocol check spoken in the platform's voice, and §7.3's lawful-home
  paragraph rests on this check being no such thing — the same fact cannot make
  the check lawful and the `TypeError` apt. The kind is the declared domestic
  `exception ReentrancyError` (nullary, `Seq.hex`-exported, the branded
  Exceptions §7.1 representation, same canonical message), with `JsError`-via-
  manufactured-`TypeError` recorded against re-litigation in §7.4 — its
  "interrogable only by message" cost is a contradiction, not a cost, since
  message text is exactly what programs must not depend on. The emitter's throw
  and the conformance expectations pinning `TypeError`/`constructor.name` change
  with §7.4's implementation, which postdates this entry.
- **Executable conformance:** `seq-unification.test.ts`, describe block "forcing
  is not reentrant (FFI Part 3 §7.3)", six tests, all in the ordinary program
  shape — no probe reaches into the helper by name any more. The refused force
  costs the enclosing traversal nothing (the headline, `[10, 20, 30, 40]` where
  the pre-ruling spine gave `[20, 30, 40]`); an already-forced position replays
  normally from inside a forcing, which is §7.3's carve-out; an uncaught
  reentrant throw becomes that position's failure by §7.1; a swallowed refusal
  ends the value's JavaScript face and keeps saying so, which is #232's
  behaviour pinned against the truncating repair; reentry from
  `[Symbol.iterator]()` is refused too, since §3 defers acquisition to the first
  pull and it therefore runs inside a forcing; and a generator source fails
  identically, which is the uniformity claim checked rather than asserted.
  Only the *value* arm of §7.3's replay carve-out has a test, and that is
  complete rather than partial: an end or a failure has no successor node, so no
  forcing of that spine can be in flight behind one, and those two arms are
  unreachable from inside a forcing rather than untested. §7.3 says so.
  **Verified sensitive:** reverting the arm to its pre-ruling state reddens five
  of the six (not the replay test, which passed before); moving the reentrancy
  check inside the `try` reddens four; and the rejected brand-the-refusal repair
  reddens the swallowed-refusal test with `[]` in place of the elements, which
  is why that bullet is recorded rather than ruled.
- **The error kind, ruled by the spec seat (§7.4), and what shipped of it.**
  Fable took the spec seat on the ruling after two implementing-seat rounds and
  overruled the `TypeError`/`JsError` choice: the refusal is a condition Hexagon
  detects in state Hexagon owns, so Exceptions §1's one-door doctrine puts it
  behind a declared constructor. `exception ReentrancyError` — nullary on
  `KeyError`'s model, declared in §7.4 and exported by `stdlib/Seq.hex`, raised
  inline as Exceptions §7.1's representation exactly as the emitted `IndexError`
  and `SliceError` are. The argument that decided it, and which the implementing
  seat had missed: §7.2's `TypeError` is licensed as *the platform's own minimum
  protocol check*, while §7.3's guard is lawful precisely because it is **not** a
  protocol check — the same fact cannot license the check and select its error
  kind.
  **The throw shipped; recognition did not, and could not.** Reviewing the
  ruling turned up a general gap: *no* declared exception is catchable today —
  `JsError` included — because a constructor named in a `catch` pattern does not
  resolve, and the qualified spelling the corpus tells users to write is not
  parseable as a pattern at all. Filed as **#234**. `ReentrancyError` is
  therefore exactly as catchable as `IndexError` is, and the conformance asserts
  what is observable: the `$hex` brand and the `name`, never the message, which
  §7.4 makes non-normative.
- **Credit:** Fable filed the gap as a ruling request rather than a bug, and was
  right that it was one. Two cold Opus rounds on #131 established, between them,
  that every non-refusing rule for the collision is silently wrong — which is
  the argument this ruling rests on, arrived at by trying the alternatives and
  watching each break something. A cold Opus round on the ruling itself found
  the memoization consequence, the backwards §6.5 citation, the unasked §3.2
  question, and the circular error-kind justification — and independently
  reproduced every claim of fact the draft made, which is the only reason the
  rest of it stands.

## 2026-08-15 — block-level `fun` rebinding checks were same-block only (#456)

- **Classification:** compiler defect against specification; no design change.
- **Authority:** Statements §5.1 rule 1 — a sequential binder may not reuse any
  name in scope, at any nesting depth — with `fun` names named sequential
  binders explicitly (§5's classification and the doctrine bullet). Modules
  §5.4 supplies the one layering: module-level binders may occlude a prelude
  name; function-local binders occlude nothing.
- **Defect origin:** the fun-group predeclare in the resolver checked rebinding
  with `lookupLocal` — the current scope's own map only. That got module-level
  occlusion right by accident and silently licensed every block-level shape the
  rule bans: a nested block's `fun` rebinding an outer `let`, an outer `var`,
  or the enclosing lambda's own parameter, all compiling clean while the same
  claimant spelled `let` or `var` was refused. The legality of a rebinding
  turned on the claimant's keyword — the same inconsistency shape #455 removed
  for pending names.
- **Correction:** the predeclare's lookup takes the layered form the `Let` case
  already uses — `lookupLocal` when the scope *is* the module scope, full
  `lookup` otherwise. Scope identity, not depth (the PR #89 finding F1 lesson,
  recorded at the `Let` site). The pending-name arbitration (#455) composes
  unchanged: with the full lookup, a `fun` claimant inside an occluding
  module-level binding's RHS now finds the prelude symbol and correctly hands
  it to the pending diagnostic rather than rule 1.
- **Executable conformance:** the guard for this defect is the resolver test
  pinning the three banned shapes (nested-block `fun` vs outer `let`, vs outer
  `var`, vs the enclosing parameter) — it fails on a `lookupLocal` revert. The
  prelude-occlusion conformance suite pins that module-level `fun` occlusion
  survives. `conformance/pending-binder.test.ts` *asserts* the `fun`/`let`
  diagnostic parity inside an occluding binding's RHS but does not pin this
  fix (under the reverted lookup that site's `existing` is undefined and the
  pending arm fires anyway) — it is a regression floor there, not the guard.
  No stdlib source declares a block-level `fun`, so the full-suite run is the
  no-regression guard.
- **Credit:** found by a cold Opus review round on #455 — its fun-site probes
  established the gap and that it predated the branch under review; James
  ordered the fix in-session.
