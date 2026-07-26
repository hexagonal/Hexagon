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

### 3. `project.diagnostics` reports each diagnostic three times

- **Classification:** compiler defect; aggregation introduced with #78.
- **Defect origin:** `compileProject` folds `typed`, `javascript`, and
  `declarations` diagnostics into one bag, but all three carry the *same*
  accumulated list, so every diagnostic is added once per stage.
- **Impact:** the channel is honest — nothing is hidden, which is what the poison
  test guards — but diagnostic counts are meaningless and output is noisy. A
  single ill-typed binding reports 3 errors; a parse failure reports 3 of each.

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
