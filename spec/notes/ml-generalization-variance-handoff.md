# #205 / #207 — implementation hand-off

**Status:** Hand-off for a cold session, written 2026-08-01 by Opus at James's
request. Not a spec and not a ruling. The governing document is the closure doc
`spec/decisions-ml-dialect-generalization-2026-08.md`; on any conflict it wins,
and the host specs it has been consolidated into win over it.

**Branch:** `ml-generalization-variance-207`. **PR [#216](https://github.com/hexagonal/Hexagon/pull/216) is open against `main`** (opened 2026-08-02; §6.3
discharged). **Rounds 3–7 are fixed and applied
(§5, §5b–§5e).** Seven cold review rounds, seven REQUEST-CHANGES. **The review
budget is spent** — James capped it after round 5 — so the branch now goes to him
on the strength of what seven rounds found, not on a clean verdict, which no round
ever produced. §6 records what is known to be unreviewed; read it before merging,
because it is the honest statement of what this arc did *not* establish.

**Read first, in this order:** this file → the closure doc (§2, §4, §5, §6, and
all of §13) → `spec/functions.md` §8 → `spec/modules.md` §4.2.1 →
`spec/declarations-preamble.md` §2.1.

---

## 0. What was asked, and what state it is in

James, in session: *"Bringing out Hexagon's ML nature! #207 has been merged. Now
it is up to implement it. Implement it everywhere. Including book and
playground."* With the standing roles: cold **Opus** reviews the code, **James**
reviews the book himself, **Fable** writes any spec and Opus reviews it.

Everything asked for is built and committed. **Seven cold review rounds have run
and all seven returned REQUEST-CHANGES.** All seven are now fully applied: rounds
3–7 were fixed in the session of 2026-08-02 (§5, §5b–§5e), and each fix is held by
a test verified to fail when the fix is reverted. Two
needed rulings first, and Fable wrote both — closure doc §13.6, the evidence-seat
rule, then §13.6's own correction after round 4 found the rule missed every
destructuring binding.

*(This paragraph read "all four … round 3's six defects and round 4's nine" until
2026-08-02, when it was corrected on the way to opening the PR: it had been
written at round 4 and never caught up with rounds 5–7, which §5c–§5e record. A
stale count in a note whose subject is stale claims — §2d — is worth naming rather
than quietly fixing.)*

The book has been read and approved by James, twice, including two prose
corrections he made directly.

---

## 1. What shipped, by surface

**Step 1 — the syntactic-value list (closure doc §2).** Functions §8.2's list
gains references to immutable term bindings, module-qualified references, and
record literals whose field values are values. Excluded, deliberately: `var`
reads (§2.3), `extern` references (§13.4 — unobservable in v1), and bare
constraint-member references (§2.5 leaves the door where Constraints §2.2 left
it). `#isValue` → `#isImmutableTermReference` in `checker.ts`.

**Step 2 — the relaxed value restriction (§4).** An expansive `let` generalizes
exactly the variables that are unconstrained (clause a), covariant-only (clause
b), and level-admitted (clause c) — per variable, so one binding may quantify
some and leave others unsolved. `#generalize`'s `!allow` branch, with
`#declineClause` / `#declineReason`.

**The variance analysis (§5).** New `compiler/src/passes/checker/variance.ts`:
four-point lattice, sign multiplication, least fixpoint per strongly-connected
component of the type-declaration graph, dependencies first. New
`compiler/src/support/graph.ts` holds Tarjan, shared with the checker's existing
function ordering.

**Declared variance on `export opaque` (§6).** `+a` / `-a` sigils; bare is the
empty claim and means invariant; over-claim is a declaration-site hard error
naming a witness occurrence via a required secondary label (§13.1). Parser gains
`#takeVarianceSigil`, `#rejectVarianceSigil`, `#rejectVarianceSigilAtUse`.

**Everything else:** LSP under-claim code action and variance hover
(`queries/variance-claims.ts`, `analysis/session.ts`); the VS Code TextMate
grammar's `storage.modifier.variance.hexagon` scope and the Playground theme
entry; a new Playground `polymorphism` example; `stdlib/Seq.hex` now declares
`Seq(+a)`; book chapters 6 and 14.

---

## 2. The five non-obvious things a future reader will get wrong

### 2a. `Num` is the wrong specimen, and it will fool you three times

A `Num`-constrained variable is **settled by defaulting before anything is
observable** (Numeric Literals §4). This produced three separate false results in
this session, twice in tests that were written *specifically to observe* the
behaviour they could not observe:

- `let x = 42; let y = x` used at `Int` and `BigInt` compiles on `main` too — it
  is numeric widening (`const asBig = BigInt(y)`), not polymorphism. A literal's
  variable is settled at its own binding, so **no alias of it is ever
  constrained**, and item (vi) cannot be demonstrated with one.
- `{ f = double }` cannot discriminate the emitter's binding-RHS gate, because a
  `Num` reference's evidence is a *concrete instance*, not an unresolved
  dictionary, so the eta-expansion is taken either way.
- A book example asserting "its first use fixes it" was false for the same
  reason.

**Use a user-declared non-defaultable constraint** (the tests use `Tag` and
`Conjure`) whenever the observation is about a constrained variable surviving a
binding. Constraint syntax is `constraint Tag<a> =` / `honor Tag<Int> =`, not
`where`.

### 2b. A test that passes is not a test that works

Round 2 mutation-tested every fix from round 1 and found **three held by no test
at all** — including the soundness fix that motivated the round. Deleting the fix
left all 1011 tests green. Two newly written tests could not fail either.

The standing rule this established, and the one to keep: **revert the change and
watch the test fail, or the test does not exist.** `cp` the file aside and `cp`
it back — never `git checkout`, which has silently eaten uncommitted work in this
repo twice.

Round 3 applied that standard to the *rest* of the branch and found four more
unheld changes (§5 D1, D2, D4, and the LSP wire shape). Assume nothing on this
branch is covered until it has been mutated.

### 2c. The variance table must be program-wide, not module-wide

A nominal can be reached without being imported — through a re-exported alias, or
through an imported function's type. Such a declaration is in no
`module.records`, so a per-module table read it as invariant in one module and
covariant one import away, which is exactly what §6.4 forbids. `programNominals`
is threaded `compileProject` → `CheckOptions` → `VarianceTable` for this reason
and no other. The uniformity property is a test: *adding an import the module
makes no use of must not change an answer.*

Per-SCC solving is **not** what makes §6.4 hold — §6.3's inside/outside rule is.
A comment claiming otherwise was corrected; do not reintroduce it.

### 2d. Every round found its defects inside the previous round's fix

This is the arc's most transferable fact and it should change how the remaining
work is done. Round 2 found three of round 1's fixes untested. Round 3 found that
round 1's *rewrite of a test* had deleted the only variable that could
discriminate on its subject (§5 D3), and that round 2's fix for a test that could
not fail **enshrined a regression as expected output** (§5 D5).

**Round 4 continued the pattern, and its instance is the sharpest yet: the defect
was in round 3's own measurement.** Round 3's D5 table reported that `let holder =
(describe, 1)` produced "2 messages, one naming a rewrite" on `main`. It does not
— it compiles clean. The row had been measured with `pair.0`, and `.0` lexes as a
Float literal, so the diagnostics being compared were parse noise. That false row
was copied into this note, from this note into the brief that commissioned §13.6,
and from there into the ruling's own prose, where it survived until the
implementation contradicted it. Four documents carried it because each trusted the
one before.

The rule that catches this class: **a specimen that produces a diagnostic you did
not predict is a broken specimen until proven otherwise.** The malformed tuple
reported `a Float literal needs a digit before \`.\`` every single time it was
run, in three separate sessions, and each reader treated it as noise beside the
message they were looking for rather than as evidence the program was not the one
they meant to write.

Do not treat "the reviewer approved the last change" as covering the change
built on top of it. Re-verify the specimen, not just the assertion.

---

### 2e. A test can be untestable-by-construction, and look like coverage

Distinct from §2b, and it has now cost two rounds. §2b's failure is *no test*.
This one is *a test whose specimen makes the right and the wrong implementation
give the same answer*. It passes, it names its subject, it reads as coverage, and
it holds nothing.

- Round 3's `Set(a)` specimen for the variance clause. `Set` demands `a: Hash`, so
  clause (a) declined the variable **whatever the variance row said** — flipping
  the row could not change the outcome. The replacement needed an *unconstrained*
  variable in an invariant position, which is a different specimen, not a
  correction to the assertion.
- Round 5's x-d, the `as` battery row. It puts the `as` at the pattern **root**,
  where the component type and the scrutinee type coincide — so it cannot tell
  "read the component" from "read the whole value", which is exactly the
  distinction the lines it appears to cover exist to make. Dropping those lines
  left all 1038 tests green.

The question that catches it is not "is there a test?" but **"would this test have
distinguished the wrong implementation from the right one?"** — which you answer by
building the wrong implementation and running it, not by reading the test. That is
the same discipline as §2b, applied to the *specimen* rather than to the assertion.

---

## 3. Two decisions that went further than the review asked

Both were filed as comment repairs and turned out to be behaviour.

**Captured expansive bindings now reach item 7.** A `let` captured by a function
used to be installed as a monomorphic placeholder, gated on its RHS being a
syntactic value. That gate was right while generalization was all-or-nothing and
wrong the moment item 7 landed: the ruling's own headline example stopped
generalizing as soon as any function mentioned it. Every captured `let` is
promoted now; `var` keeps the placeholder unconditionally.

Five conformance tests in `sequential-placeholder-scope.test.ts` and
`generalized-captured-lets.test.ts` were asserting the pre-#205 answer and passing
only because the capture path never consulted item 7. Their specimen moved to one
item 7 still declines. **Defect 7's invariant is untouched** — a placeholder must
never be quantified into a sibling's scheme — what changed is which bindings are
placeholders.

The soundness argument, which a future change must preserve: the three ways a
shared binding can be unsound to generalize are all item 7's clauses, it asks them
whichever path the binding took, and a declined variable is sunk back to `level`
so it can no more be quantified into a sibling's scheme than a placeholder could.
Round 2 attacked this and could not break it, reporting that two independent
guards make the dangerous shape unreachable — the resolver's use-before-binding
rejection, and `#checkFunctionAvailability`'s `fun`↔`let` cycle rejection.

**Round 3 disproved the second leg, and the earlier version of this note repeated
it as an invariant to preserve. It is not one.** `#checkFunctionAvailability` is
*order-sensitive*: it fires only when the `fun` is textually before the `let`.
See §5 D6 for the program that gets through. Do not rely on that guard's reach
without re-measuring it.

**A soundness hole predating #205.** `#instanceKey` keys on a head constructor
only, so `honor Def<Box(Int)>` was selected for `Def(Box(?1))` with nothing
unifying the instance's declared subject against the type discharged. The variable
came away with an empty requirement list — precisely what clause (a) is licensed
to quantify — and a binding annotated `String` compiled holding `7`.
`#pinInstanceSubject` freshens the instance's own parameters and unifies. The
defect is older and independent of #205; it became reachable at scale because
clause (a) reads requirement lists. Pinned by
`compiler/src/conformance/instance-subject-pinning.test.ts`, both specimens
verified to compile silently on `main`.

---

## 4. Spec work, and what it owes

Fable authored §13 of the closure doc — five rulings, each applied to its hosts
in the same change. §13.1 the witness label, §13.2 nothing else may generalize a
`var`'s type, §13.3 the constrained alias emits the bare reference, §13.4 externs
and the value list stay deliberately unstated, §13.5 the use-site sigil message.

§13.5 is worth reading for its doctrine, which generalizes past this branch: **a
message clause the emitter cannot make true in general is not permitted on the
strength of being right in the easy case.** The struck clause was a worked
rewrite built from the token after the sigil — the whole argument list only at
arity 1, so `Pair(+Int, String)` was told to write `Pair(Int)`, and three of four
shapes produced a fresh error when applied.

The closure doc's §10 ledger still carries edit notes **recorded, not applied**,
to be discharged on next touch of each target: `ffi-part4` §12.4/§11 item 7 (now
with §13.4's fourth face), `numeric-literals.md` §4, `constraints.md` §2.2,
`ffi-part7`, `loops-ranges-iteration.md` §6.4.

---

## 5. Round 3's six defects — all fixed, and how each is held

Fixed 2026-08-02. Every fix below was mutation-tested: the change was reverted
with `cp`, the test was watched to fail, and the file was restored. A fix with no
failing-on-revert test is not recorded here as done, because §2b says it is not
done.

### D5 — a working program regressed into an unrepresentable scheme

**Ruled before code moved.** Fable wrote closure doc **§13.6, the evidence-seat
rule**: evidence has exactly one seat, a function's trailing parameter suffix
(Constraints §6.1), so generalization quantifies a *constrained* variable only at
a binding whose own type is a function. At any other value binding a variable
still constrained after defaulting declines and is pinned by its first use —
which is what every expansive binding already does, and what this binding did
before #205. Hosted at Functions §8 item 2, §10's new row, and Constraints §6.1.

Implemented in `#generalize` (`checker.ts`), in the `allow` path, after
defaulting — the ordering is §13.6's and is deliberate. Measured, three shapes,
before and after:

| specimen | `main` | branch, round 3 | branch now |
| --- | --- | --- | --- |
| `let holder = { f = describe }` | clean | 2 errors | clean, `main`'s emission byte for byte |
| `let pair = (describe, 1)` | clean | 2 errors | clean |
| `let h = Holder({ f = describe })` | clean | 2 errors | clean |

**The correction round 4 made, and it changed the ruling's prose:** round 3's D5
table said `main` already erred on the tuple. It does not — see §2d for how a
malformed specimen carried that claim through four documents. All three aggregate
shapes compiled clean on `main`; **Step 1 regressed all three together**, because
a reference to a constrained function only became a value at Step 1. §13.6 is a
regression fix for the category, not a mixed fix-and-improvement. The closure doc
carries a dated correction note at §13.6, §11.1 item (x), and §12's log row.

Held by five tests replacing item (vi) in `value-list.test.ts`, which had pinned
the regression as expected output: the three shapes compile and pin; a
second-type use gets Functions §10's pinning diagnostic *at the use*; the
annotated arm reports at the declaration and **both exits its message names are
themselves compiled**; and an unconstrained aggregate still generalizes in full
(the rule reads the residual constraint set, not the shape — declining on shape
would un-do Step 1 for every `Seq.hex` producer). Three mutations checked:
disabling the rule, declining on shape alone, and dropping the annotated arm —
4, 16 and 1 failures **scoped to `value-list.test.ts` alone** (17 tests). Whole-
suite, the middle one is 372. State the scope when you quote a mutation count:
round 4 could not reproduce "16" against the full suite and was right not to.

### D6 — a guaranteed `ReferenceError` accepted

`#checkFunctionAvailability` read `#funCaptures`, which is fed from the
*future*-sequential lookup and therefore records **forward references only**. A
`fun` naming a binding written above it captured nothing as far as the guard
could see, so `let a = f()` above `fun f() = a` reported nothing while the same
two lines swapped reported properly.

Fixed in `resolver.ts` by deriving each `fun`'s captures from its resolved body,
intersected with the item list's own sequential bindings — direction-agnostic by
construction, and the intersection is what keeps it free of false positives (a
body's parameters and inner `let`s are different symbols). Both orders now
report, transitively too (`f` → `g` → `a`). Held in `resolver.test.ts`, with the
three legal shapes asserted alongside so the fix cannot pass by over-reporting.

### D1 — a contradictory second diagnostic

`variable.instance = ERROR` confirmed load-bearing: deleting it leaves the suite
green but adds *`the body requires \`Int\`; change the annotation to \`Int\``*
beside a message that says to **remove** the annotation. The comment above the
line described the pre-`fc37345` symptom and no longer reproduced; it now
describes the real one. The three `(vii)` tests moved from `toContain`/`.some()`
to whole-list `toEqual` — `toContain` cannot see an extra message, and for three
rounds it did not.

### D2 — three `#lowerLevels` arms load-bearing for §13.2, untested

Statements & Mutability §7.2's alias assertion had never been written. Four tests
added, one per uncovered arm (`Vector`/`Set`/`Array`/`Node`, `Tuple`, `Function`)
plus §7.2's `:=` half. Each specimen puts an **unconstrained, covariant** variable
behind a `var`, so clauses (a) and (b) both pass and level admission is the only
thing that can decline — which is the arm under test. Neutering any one arm turns
exactly one specimen silent. The `Function` specimen uses a variable in **result**
position deliberately: an argument-position variable is contravariant and clause
(b) would decline it whatever its level, so it could not discriminate.

### D4 — every union variance claim silently ignorable

`resolver.ts:1249`'s `declaredParameters` on the resolved union: replace it with
`[]` and every `export opaque union Box(+a)` claim is discarded, in-module and
cross-module, suite green. Three tests added — the union's claim believed, the
same union bare declining, and the claim travelling with the import — mirroring
the record coverage that already existed.

### D3 — a test that could not fail for its subject

The `Set(a)` specimen's whole diagnostic came from its **first line**:
`Set.empty()` does not typecheck there, so the binding and the two conflicting
uses contributed nothing. It had a second flaw the reviewer did not name: `Set(a)`
demands `a: Hash`, so **clause (a) declined the variable whatever the variance row
said** — flipping the row could not change the answer, and the replacement had to
fix that too, not just the first-line error.

Replaced with two user records differing in exactly one field — `Co(a) = { items:
Vector(a) }` and `Inv(a) = { items: Vector(a), sink: a -> Unit }`, whose extra
contravariant occurrence joins to invariant. `a` is unconstrained in both, so
clauses (a) and (c) pass in both and clause (b) is the only thing between them.
Mutating the variance `join` so `co ∨ contra = co` makes it fail.

### The nits, also closed

- **LSP wire shape.** Three surviving mutations, all now held: the variance offer
  goes out as a `refactor` (not a quickfix); its `diagnostics` field is **omitted
  rather than sent empty** — with a control test asserting a quickfix still
  carries one, so the omission cannot be mistaken for the field having stopped
  being sent; and `underClaims`' range filter is scoped to the request (a cursor
  two lines away is offered nothing).
- **The witness choice.** `find` vs `findLast` was invisible because every
  specimen in the suite had exactly one witness. A two-witness record now pins the
  *first* occurrence, message and label together.
- **The trailing period.** `spec/modules.md` §4.2.1 and closure doc §6.3 quoted
  the over-claim message with a final period the compiler does not emit; both
  conformed by Fable, verified against `checker.ts:5086-5088`.
- **`COMPILER_CLAIMS`'s `Node` row** remains untestable from source. Recorded, not
  fixed, so it is not mistaken for coverage.
- **`fc37345`'s removal of the rigid guard from `#defaultRemainingVariables`** is
  unobservable on HEAD. It is dead-code deletion, not the behaviour fix its commit
  message frames it as. Nothing to change in the code; the commit message is
  history and is left alone, recorded here instead.


## 5b. Round 4's nine findings — all fixed

Round 4 was the first genuinely cold seat of the arc: a fresh agent with its own
context, which is where the independence comes from — a model switch inside the
authoring window does not create one. Verdict REQUEST-CHANGES. Every finding was
reproduced independently here before being acted on, and all nine reproduce.

### The blocker — the seat rule missed every destructuring binding

`#inferPattern` calls `#generalize` once per *component*, so a function-typed
component of a non-function aggregate passed the seat test, generalized still
carrying its constraint, and hit the wall §13.6 exists to remove. Six shapes that
compile and run on `main` were hard errors: tuple, record, nested tuple, `as`
form, and the same inside a `fun` body and a nested block.

**The emission was wrong, not just the diagnostic** — the part that matters:

```js
const [g, n] = [__hex_arg00 => describe(__hex_arg00, undefined), 1];   // branch
const [g, n] = [__hex_arg00 => describe(__hex_arg00, __hex_instance_Tag_String), 1];   // main
```

one arity narrower than the suffix its caller appends, the dictionary dropped —
the shape Constraints §6.1 records "so it is not rebuilt". Silencing the message
alone would have shipped a runtime `TypeError`.

**Why the invariant did not catch it, which is the transferable part.** `g`'s
scheme *is* function-typed, so the shipped invariant — *every generalized scheme
with a residual constraint set has a function type* — held literally while the
program still reached the emitter with no seat. The type half is necessary and
not sufficient; the missing half is **provenance**. Fable restated it as a
conjunction (§13.6): every such scheme **(i) describes the binding's entire
evaluated value** — the root binder or an `as` name at the root, never a pattern
component — **and (ii) that value's type is a function type.**

Fixed by computing the seat bit once at the `LetPattern` from the pruned RHS type
and threading it through `#inferPattern` into `#generalize` as `evaluated`. Held
by §11.1's x-a…x-f; **x-g** is the required mutation — restoring the
component-type read fails exactly the five destructuring tests and nothing else.

*One instruction in the ruling turned out vacuous and was not built:* threading an
annotation span through the pattern path. An annotated destructuring binding
(`let (g, n): (Int, Int) = …`) is a **parse error** — `expected \`=\` after
\`let\` pattern` — so there is no such binding to key a declaration-site error on.

### The scoped retirement — and a spec sentence that was false when written

Constraints §6.1 claimed the two emission-time messages were retired. Neither was.
Worse, the property was unreachable as stated: `let g = Some(describe)` with `g`
never used reaches the evidence branch **identically on `main`**, so the sentence
was untrue independently of the destructuring gap.

Fable rescoped it to what the rule can deliver: *on a module the checker accepts,
no value reaches emission needing evidence at a non-function type.* Implemented as
`#alreadyDiagnosed` in the emitter — silence on a module that already carries
checker errors (the checker's report names the rewrite; a second one phrased as an
internal failure is the Preamble §1.1 duplicate the ruling struck), and on a
checker-clean module a message that can only be read as a compiler defect.

**`Some(describe)` drops from two diagnostics to one.** That is a deliberate change
to a surface `main` ships, pinned as an exact list by x-f.

**One deviation from the ruling, made knowingly.** §13.6 permits an *assertion* on
the checker-clean path. The implementation reports instead of throwing. Every round
of this arc has found a residual hole in the previous round's fix, and turning an
unknown remaining hole into a hard crash trades a wrong diagnostic for a dead
compiler. If a later round establishes the invariant under adversarial search,
`#reportUnreachableEvidence` is the line to harden.

### The rest

- **The `LetPattern` line in D6's fix was held by nothing.** Deleting it left the
  whole suite green while silencing a guaranteed `ReferenceError`. Now pinned.
- **D6 did not reach a `fun` nested in a `fun` body.** `itemNameReferences`
  returned `[]` for `Fun` items, so the walk stopped at the outer body. Fixed
  rather than recorded — both callers are that one guard, so widening it was
  contained.
- **The fix rejects a legal program.** `let k = () => a` inside a body, never
  invoked, now reports. The comment claimed the `sequential` intersection kept the
  guard "free of false positives"; that was false. Kept the conservatism —
  narrowing means deciding reachability, and `(() => a)()` shows that is not a
  syntactic question — corrected the comment, and pinned the behaviour so it
  cannot drift silently.
- **`variable.level = level` in the seat block is unheld.** Deleting it leaves the
  suite green and neither the author nor the reviewer could build a discriminating
  specimen. Kept for the Defect 7 invariant, and **labelled uncovered in the
  source** rather than left looking tested — the same treatment as
  `COMPILER_CLAIMS`'s `Node` row.
- **The annotated-arm message did not agree in number** — "its \`Tag\`, \`Other\`
  constraint". Fixed and held.
- **A mutation count in §5 was unreproducible** because it did not state its
  scope. Corrected in place.


## 5c. Round 5's findings — all fixed

Verdict REQUEST-CHANGES. Reproduced here before being acted on. **Two of the five
were direct refutations of claims this note made**, which is the reason to read
§2b and §2d again rather than trusting a summary — including this one.

### The blocker — the case §13.6 blessed and the battery never touched

§13.6's own second consequence says a `let` pattern that reads through to a bare
binder over a function-typed RHS **keeps** the seat. The checker implements that
correctly. The emitter did not know a `LetPattern` could be a binding position at
all, so it eta-expanded a *generalized* constrained alias to the unsuffixed arity:

```js
const g = __hex_arg00 => describe(__hex_arg00, undefined);
const s = g("x", __hex_instance_Tag_String);
```

The dropped dictionary again — one shape over from where round 4 fixed it — and
this time behind the new *"this is a defect in the compiler … please report it"*
message, on a program `main` compiles **and runs**. Three spellings: `let (g) =
describe`, `let (g) as h = …`, `let (_) as h = …`.

Fixed at the gate, not per shape: `#emitBindingValue`'s binding-position flag is
now computed from the pattern (`patternNamesWholeValue`), so a read-through binder
emits §13.3's bare `const g = describe` and destructuring patterns keep the
eta-expansion. Held by x-i, which asserts the **emitted text and the runtime
answer** — a diagnostics-only probe passes on all three while the program throws.

### The two refutations

**"`variable.level = level` cannot be discriminated" was false.** §5b recorded it
as unheld *and unholdable*, on the strength of two seats failing to find a
specimen. Round 5 found one: a **sibling** binding whose own type is a function
never enters the seat block, so an unsunk variable is quantified into its scheme
unconditionally — `let holder = { f = describe }` then `let k = () => holder.f`
gives `k` an evidence parameter and strips `holder`'s aggregate of its dictionary.
Pinned by x-k. *"We could not build one" is a fact about the search, not about the
code, and this note stated it as the latter.*

**"Every fix is mutation-tested" was false.** The `As` arm's two `evaluated`
arguments were not: dropping them leaves all 1038 tests green while regressing a
nested `as` to exactly round 4's blocker. The battery's x-d puts its `as` at the
pattern **root**, where the component type and the scrutinee type coincide — so it
is an equivalent-mutant test for the lines it appears to cover. Pinned properly by
x-j.

**This is the second time in the arc that a test looked like coverage while
testing a case where both readings agree.** The first was round 3's `Set(a)`
specimen, where clause (a) declined the variable whatever the variance row said.
That failure mode is distinct from an untested line and is not caught by asking
"is there a test?" — only by asking *"would this test have distinguished the wrong
implementation from the right one?"*

### The rest

- **The assertion message over-claimed.** It cited §13.6's non-function guarantee
  while firing from `#dictionary`'s general path, which also serves function-typed
  values and derived `Eq`/`Hash` evidence. Reworded to claim only what it knows: an
  evidence lookup found nothing on a module the checker accepted. Fable then ruled
  the split explicitly — the *quiet* half is class-wide, the *assert* half is the
  non-function case's only.
- **The retirement was stated as one program and is a class.** Every
  already-diagnosed module reaching the missing-evidence path loses the second
  message. x-f now pins four members instead of one.
- **Two spec sentences did not match the implementation.** The annotated-scrutinee
  sentence described an unwritable program — annotated destructuring is a parse
  error — and was struck. "Every name a pattern binds" is false for constructor
  patterns; Fable kept it normative and made it **#213's acceptance target**
  rather than scoping an off-by-one into the language.
- **#213 filed** — constructor-pattern components can never generalize
  (`#constructorShape` opens them at the binding's level where the sibling arms
  open one level in). Pre-existing on `main`. Pinned by x-h as a `test.fails`, so
  it goes red the moment the defect is fixed.

### One surviving mutation, recorded as equivalent rather than as a gap

Forcing `patternNamesWholeValue` to `true` leaves everything green. That is
provable equivalence, not missing coverage: the gate's other condition needs every
evidence entry to be an *unresolved* dictionary, which only a generalized
constrained scheme produces, and under a destructuring pattern such a scheme is
the constrained non-function §13.6 forbids. The restriction is kept as the
emitter's own statement of the correspondence, so a future regression in the
checker's seat rule surfaces as a wrong diagnostic rather than as silently bare
names. The argument is in the source so the next reader inherits it.


## 5d. Round 6's findings — all fixed

Verdict REQUEST-CHANGES. Three defects plus a stale comment. The blocker is round
5's blocker one pattern shape over, for the third round running.

### The blocker — `Or` at a pattern root

`patternNamesWholeValue` enumerated `Binding`/`Wildcard`/`As` and omitted `Or`.
The checker's `Or` arm generalizes each alternative's binder against the
*scrutinee* type, so `let (g | g) = describe` kept the seat there while the
emitter eta-expanded it to the unsuffixed arity — the dropped dictionary again,
behind the "this is a defect in the compiler" message, on a program `main`
compiles and runs. `let (g | g) as h = describe` was correct, which localises it
to the bare-`Or` root exactly.

Fixed by recursing: `Or` names the whole value iff every alternative does. Held by
x-i, which asserts the emitted text and the runtime answer.

### The `As` arm's *second* `evaluated` was still unheld — §5c was wrong

§5c said both of the `As` arm's `evaluated` arguments were "pinned properly by
x-j". Only the recursion argument was. Dropping the one on the as-binder's own
`#generalize` leaves the entire suite green.

**x-j could not see it for the reason §2e describes**: its specimens use the
*inner* binder, which runs first, declines, and sinks the variable — so by the
time the as-binder generalizes, the level filter has emptied the set and both
readings agree. A `_` inner sinks nothing, and only there does the second argument
decide. This is §2e's failure mode occurring inside the fix for §2e.

One claim in round 6's report does **not** hold: it says x-j asserts a clean
compile on two programs that crash at runtime. Both x-j specimens use the inner
binder and both run to `"string"`. The crash belongs to the *as*-name, which is
#214 below.

### #214 — filed, not fixed here

A nested `as` binder is never emitted: `let (g as h, n) = (describe, 1)` then
using `h` compiles clean and throws `ReferenceError: h is not defined`.
Pre-existing on `main`, emission-only (the checker types it correctly), and **the
only shape found in six rounds where a checker-clean program compiles to runnable
JavaScript that is simply wrong.** It bears on two spec sentences that promise
decline-and-pin "for every bound name, the `as` name included" — true of the
types, not observable in the emitted module.

### The stale comment

`checker.ts`'s note on `variable.level = level` still said the line was unheld and
that no specimen could discriminate it. Round 5 built one and x-k pins it. The
comment now says so, and says what the mistake was: *"no specimen was found" is a
fact about the search, and it was written down as a fact about the code.*

### One assertion of mine that did not discriminate, caught in the same round

The first draft of x-i's second half claimed the `Or` recursion was what made the
behaviour right. It is not discriminable: replacing the recursion with a blanket
`true` leaves it green, because a destructuring alternative's RHS is an aggregate
and the branch it would unlock needs the constrained non-function scheme §13.6
forbids. Same equivalence as the predicate as a whole. The comment now states what
the assertion delivers rather than what it looks like it delivers — §2e applied to
this file's own new test, one round earlier than usual.


## 5e. Round 7's findings — the last round

Verdict REQUEST-CHANGES. One defect new on this branch; the rest pre-existing and
filed. Round 7 also delivered the enumeration it was asked for, which is the most
useful artefact of the whole review sequence.

### The blocker — the gate's *other* conjunct

Rounds 5 and 6 fixed the bare-alias gate's first conjunct (binding position). The
second is all-or-nothing — *every* evidence entry unresolved — and an ordinary
**partial annotation** makes its middle case reachable:

```hexagon
fun pair<a: Tag, b: Tag>(x: a, y: b): String = label(y)
let g: (String, b) -> String = pair
export let s: String = g("a", True)
```

`Tag a` is discharged at the binding; `Tag b` stays residual because the scheme
quantifies it. That fell into the eta case, which passed `undefined` for the
residual while every consumer appended a dictionary for it, against a wrapper one
parameter short. `main` reports this program properly; the branch turned a good
diagnostic into *"this is a defect in the compiler, not in your program"*.

Fixed by threading residual evidence as trailing wrapper parameters, minted in
`dictionaryEntries`' order — by (variable, constraint) — so consumers' suffixes
line up. Held by x-l, which asserts the emitted arity **and** the runtime answer,
at one and at two residuals; the two-residual case is what makes the ordering
observable, and reversing the sort fails it.

### The enumeration — why the seventh blocker was not where six rounds looked

Round 7 checked every `Core.Pattern` kind at a `let` root and nested, against both
the checker's seat decision and the emitter's binding-position decision, and
concluded that **`patternNamesWholeValue` cannot be false while the checker keeps
the seat**: every destructuring kind unifies the RHS with a non-function, and the
refutable kinds are refused at a `let`. So the shape-by-shape divergence that cost
rounds 4, 5 and 6 is now closed by argument, not just by cases. The seventh defect
was in the gate's other dimension entirely — which is where it had to be, and
nobody had looked there because the previous three all rhymed.

### Recorded, not pinned: two `evaluated` threadings that are equivalent *today*

The `Or` arm's and the `Constructor` arm's `evaluated` arguments can both be
dropped with the suite green. Neither is dead, and neither rests on the argument
the other equivalents rest on: both are masked by components being opened at the
binding's own level rather than one level in — the same off-by-one as #213. **Both
go live the moment #213 lands**, and (x-h) is #213's acceptance test, so the two
must be checked together or they will land unheld together. Comments at both sites
say so.

### Filed, not fixed — #215, and the worst class in the arc

Round 7 swept `#emitPattern` deliberately (round 6 had found #214 by accident) and
the family is seven shapes, not one, including **every pattern parameter in the
language** — parameter patterns desugar to `LetPatternItem`s. Two further bugs are
worse than a `ReferenceError`: an or-pattern inside a vector emits a dead arm
(`&& false`), and a binder-free one emits an unparenthesised `||` that defeats the
length test, so `[1 | 2]` matches `[2, 5]`. **Wrong answers, no crash, no
diagnostic** — the only such shapes found in seven rounds. All pre-existing on
`main`, all in #215, which supersedes #214's scope.


## 6. What is left

1. **James's call, on evidence rather than on a verdict.** Seven rounds, seven
   REQUEST-CHANGES, every finding fixed or filed. No round ever came back clean,
   so "the reviews stopped finding things" is not available as a reason to merge;
   what is available is that the last round closed the shape-by-shape divergence
   *by argument* (§5e) rather than by another case, and that the remaining known
   defects are all pre-existing on `main` and filed (#213, #215).
2. **What seven rounds did not review**, stated so it is not mistaken for
   covered: the variance analysis beyond its claim table (`variance.ts`,
   `support/graph.ts` — ~510 new lines, the largest unreviewed surface); the LSP
   and editor surfaces (`queries/variance-claims.ts`, `analysis/session.ts`, the
   code action, hover, the TextMate scope, the Playground example — suites green,
   never mutated); `.d.ts` emission for the new shapes (#132's family); and the
   `for`-loop head binding position, which round 7 could not exercise because
   `for (a as b) in …` does not parse.
3. **~~Open the PR.~~ Done** — [#216](https://github.com/hexagonal/Hexagon/pull/216), base `main`, 22 commits left unsquashed because
   they tell the story in order. All four suites and `tsc --noEmit` were
   re-verified green at §7's exact counts immediately before pushing, and
   `generate:prelude` regenerates byte-identical.
4. **#212 is a pre-existing crash this branch makes more visible.** A dot call to
   a missing companion operation with a bare numeric literal argument throws
   `TypeError` in `#materializeUnwidenedExpr` instead of reporting. Chapter 6's
   new example uses `blank.append(1)`; it compiles where the `Vector` companion
   is in scope (the Playground auto-imports it, and chapter 20 already uses the
   spelling), but a reader copying it into a bare project gets the crash.
   Reproduces on `main`.
5. **#206's stakes are raised by this branch, not caused by it.** Per-variable
   generalization means a scheme can quantify some variables and leave others
   unsolved, and hover renders the two identically. The closure doc §4.5 says
   this graduates #206 from annoyance to teachability requirement.
6. **#132 likewise** — emitted `.d.ts` is invalid for a polymorphic non-function
   binding (`const empty: Seq<a>` with unbound `a`), which is exactly the shape
   Step 1 multiplies. Note that §13.6 *reduces* this surface: a constrained
   non-function binding no longer generalizes at all, so the invalid shapes are
   now only the unconstrained ones.


---

## 7. Verification, as it stands

Compiler 1046 plus one expected failure (x-h, #213's acceptance pin),
language-server 113, editors/vscode 149, playground 117 — all passing,
`tsc --noEmit` clean in the compiler. `npm run generate:prelude` was
re-run after `Seq.hex` gained its sigil; re-run it after any stdlib edit or
`prelude-sources.ts` goes stale.

**These counts mean more than the last set did, and only for that reason.** When
this section last read 1015, the suite was green over D1, D2, D4 and the LSP
nits — four live changes it did not touch. Every one of those is now held by a
test watched to fail with its subject reverted, and so is each of round 3's other
defects (§5). What the number still cannot tell you is whether anything *else* on
the branch is unheld: §2b's standard has been applied to every change a review
has named, not to every change on the branch. Assume the rest is uncovered until
it has been mutated.

The acceptance test is the program the whole ruling exists for, and it lives in
`relaxed-generalization.test.ts`:

```hexagon
let e = empty
export let ys: Int = Seq.length(prepend(e, 42))
export let xs: Int = Seq.length(prepend(e, "Briar"))
```

Naming the empty sequence costs nothing. That is the sentence the branch is for.
