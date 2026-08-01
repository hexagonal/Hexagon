# #205 / #207 — implementation hand-off

**Status:** Hand-off for a cold session, written 2026-08-01 by Opus at James's
request. Not a spec and not a ruling. The governing document is the closure doc
`spec/decisions-ml-dialect-generalization-2026-08.md`; on any conflict it wins,
and the host specs it has been consolidated into win over it.

**Branch:** `ml-generalization-variance-207`, eleven commits ahead of `main`,
43 files, +3058 / −165. **Not yet opened as a PR, and not ready to be** — see §5.

**Read first, in this order:** this file → the closure doc (§2, §4, §5, §6, and
all of §13) → `spec/functions.md` §8 → `spec/modules.md` §4.2.1 →
`spec/declarations-preamble.md` §2.1.

---

## 0. What was asked, and what state it is in

James, in session: *"Bringing out Hexagon's ML nature! #207 has been merged. Now
it is up to implement it. Implement it everywhere. Including book and
playground."* With the standing roles: cold **Opus** reviews the code, **James**
reviews the book himself, **Fable** writes any spec and Opus reviews it.

Everything asked for is built and committed. **Three cold review rounds have run
and all three returned REQUEST-CHANGES.** Rounds 1 and 2 are fully applied. Round
3's six defects are **open** and listed in §5; two of them (D5, D6) are user-
visible regressions against `main`, so **the branch is not mergeable as it
stands.** Read §5 before doing anything else with it.

The book has been read and approved by James, twice, including two prose
corrections he made directly. `book/DRAFT-3.md` is a **gitignored build artifact**
— run `bash book/build-draft.sh` after any chapter edit, or the reviewer reads a
stale file. That mistake cost a round trip in this session.

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

## 2. The four non-obvious things a future reader will get wrong

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
not fail **enshrined a regression as expected output** (§5 D5). Each round's work
was checked and each round's work was wrong in a new place.

Do not treat "the reviewer approved the last change" as covering the change
built on top of it. Re-verify the specimen, not just the assertion.

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

## 5. Round 3's six open defects — the blocking work

Verdict REQUEST-CHANGES, at `a87cd90`. All six were reproduced independently
before being written down here; D5 and D6 were re-measured against `main` in a
throwaway worktree. Ordered by what they cost, not by the reviewer's numbering.

### D5 — Step 1 regresses a working program, into a diagnostic with no rewrite

The one to fix first. With a non-defaultable constraint (`constraint Tag<a>`,
`fun describe<a: Tag>(value: a): String`):

```hexagon
let holder = { f = describe }
export let s: String = (holder.f)("x")
```

| | `main` | branch |
| --- | --- | --- |
| record literal, as above | compiles clean | `missing \`Tag\` evidence during JavaScript emission` + `\`holder\` needs constraint evidence in value position…` |
| `let holder = (describe, 1)` | 2 messages, one naming a rewrite | 1 message, naming none |

Cause, confirmed by mutation: §2.4's record-literal row makes `{ f = describe }` a
**value**, so it generalizes into a constrained *non-function* scheme — which the
corpus rejects, and rejects with a message phrased as an internal compiler
failure. Rejecting may well be right by §2.4; **the diagnostic is not**, and a
hard error naming no rewrite violates Preamble §1.1.

Worse, `value-list.test.ts` item (vi) — written in round 2 to fix a test that
could not fail — now asserts `missing \`Tag\` evidence during JavaScript emission`
as *expected output*. A regression is currently pinned as intended behaviour.
Fixing D5 means changing that test, not preserving it.

The closure doc records **no consequence for constrained references inside
aggregates**. This is a question for Fable, not a bug to be patched in the
checker on someone's judgement: what should `let holder = { f = describe }` mean?

### D6 — the branch accepts a program that is a guaranteed `ReferenceError`

```hexagon
let a = f()
fun f() = a
export let n: Int = a
export let s: String = a
```

Zero diagnostics on the branch; a type error on `main`. Item 7 quantifies `a` at
`∀t. t`, and the emitted module is `const a = f();` above `function f() { return
a; }` — `f` hoists, `a` does not, so this throws at module load.

Round 3 could not turn it into a type unsoundness (the binding never produces a
value) and reported it as accepted-nonsense, not a soundness break. Believe that
distinction, but note the guard error it exposes: `#checkFunctionAvailability`
rejects this shape **only when the `fun` is written first** — swap the two lines
and it reports properly. See §3.

### D1, D2, D4 — three more live changes held by no test

- **D1** `variable.instance = ERROR` (`checker.ts` ~4170). Delete it: suite stays
  green, but `let y: a = double(42)` gains a second diagnostic contradicting the
  first. The two tests over that program use `toContain` / `.some()`, so an extra
  message is invisible; `toEqual([…])` would hold it. The comment above the line
  also describes the pre-`fc37345` symptom and no longer reproduces.
- **D2** Three arms of `#lowerLevels` — `Function`, `Tuple`, and
  `Vector`/`Set`/`Array`/`Node` — are load-bearing for **§13.2**, the rule Fable
  wrote *because* item 7 made it observable, and none is tested. Only `Record`
  and `Union`/`NominalRecord` are covered. Statements & Mutability §7.2, added by
  this branch, mandates an assertion (`:=` at a second type) that was never
  written.
- **D4** `resolver.ts:1249`, `declaredParameters` on the resolved **union**.
  Delete that one line and every `export opaque union Box(+a)` claim is silently
  ignored, in-module and cross-module, with the suite green. The record
  equivalent at 1286 is well covered; unions are tested only for the over-claim
  error and the parse errors.

### D3 — a test that still cannot fail for its subject

`relaxed-generalization.test.ts:45`, "§4.4 an invariant constructor declines what
a covariant one grants". Its single diagnostic comes from the specimen's **first
line alone** — `fun makeEmpty<a: Hash>(): Set(a) = Set.empty()` already reports
on its own. The binding and the two conflicting uses contribute nothing; flipping
the `Set` row to `["co"]` leaves the test green.

This is round 1's doing: the test previously used a `Map(k, v)` specimen whose
`v` was unconstrained, and the rewrite deleted the only variable that could
discriminate on the row. Both versions were wrong, in opposite ways.

### Nits round 3 recorded

LSP wire shape is unheld (three surviving mutations: `kind: "refactor"` →
`QuickFix`, `diagnostics: []` vs. omitted, and dropping `underClaims`' range
filter); `#verifyVarianceClaims`'s witness choice (first vs. last occurrence) is
unheld; `COMPILER_CLAIMS`'s `Node` row is unheld and cannot be tested from source
(recorded so it is not mistaken for coverage); `fc37345`'s removal of the rigid
guard from `#defaultRemainingVariables` is unobservable on HEAD and is
dead-code deletion rather than the behaviour fix its commit message frames it as;
and `spec/modules.md` §4.2.1 plus closure doc §6.3 quote the over-claim message
with a trailing period the compiler does not emit — §10's checklist row and the
book are correct, so it is the two prose quotations that need conforming (Fable's,
not the implementation's).

---

## 6. What is left after §5

1. **Fix §5.** D5 needs a ruling from Fable before code moves.
2. **A fourth review round.** Every round so far has found real defects inside
   the previous round's fix; see §2d.
3. **Open the PR.** Base `main`. The commits tell the story in order and should
   not be squashed into one.
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
   Step 1 multiplies.

---

## 7. Verification, as it stands

Compiler 1015, language-server 111, editors/vscode 149, playground 117 — all
passing, `tsc --noEmit` clean in the compiler. `npm run generate:prelude` was
re-run after `Seq.hex` gained its sigil; re-run it after any stdlib edit or
`prelude-sources.ts` goes stale.

Those counts are not a health report. Round 3's D1, D2, D4 and the LSP nits are
all changes this green suite does not touch; see §2b.

The acceptance test is the program the whole ruling exists for, and it lives in
`relaxed-generalization.test.ts`:

```hexagon
let e = empty
export let ys: Int = Seq.length(cons(42, e))
export let xs: Int = Seq.length(cons("Briar", e))
```

Naming the empty sequence costs nothing. That is the sentence the branch is for.
