# #205 / #207 — implementation hand-off

**Status:** Hand-off for a cold session, written 2026-08-01 by Opus at James's
request. Not a spec and not a ruling. The governing document is the closure doc
`spec/decisions-ml-dialect-generalization-2026-08.md`; on any conflict it wins,
and the host specs it has been consolidated into win over it.

**Branch:** `ml-generalization-variance-207`, eleven commits ahead of `main`,
43 files, +3058 / −165. **Not yet opened as a PR** — see §5.

**Read first, in this order:** this file → the closure doc (§2, §4, §5, §6, and
all of §13) → `spec/functions.md` §8 → `spec/modules.md` §4.2.1 →
`spec/declarations-preamble.md` §2.1.

---

## 0. What was asked, and what state it is in

James, in session: *"Bringing out Hexagon's ML nature! #207 has been merged. Now
it is up to implement it. Implement it everywhere. Including book and
playground."* With the standing roles: cold **Opus** reviews the code, **James**
reviews the book himself, **Fable** writes any spec and Opus reviews it.

Everything asked for is built and committed. Three cold review rounds have run;
rounds 1 and 2 returned REQUEST-CHANGES and both are fully applied. **Round 3 was
in flight when this was written** and its verdict is not in this document — check
for it before opening the PR (§5).

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

## 2. The three non-obvious things a future reader will get wrong

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
**Neither guard is protected by a test that says it is load-bearing here.** That
is the first thing to check if this area is ever touched again.

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

## 5. What is left

1. **Round 3's verdict.** In flight when this was written. Apply it, then open
   the PR. Every round so far has found something real; do not skip a round on
   the assumption that the last one exhausted the defects.
2. **Open the PR.** Base `main`. The eleven commits tell the story in order and
   should not be squashed into one.
3. **#212 is a pre-existing crash this branch makes more visible.** A dot call to
   a missing companion operation with a bare numeric literal argument throws
   `TypeError` in `#materializeUnwidenedExpr` instead of reporting. Chapter 6's
   new example uses `blank.append(1)`; it compiles where the `Vector` companion
   is in scope (the Playground auto-imports it, and chapter 20 already uses the
   spelling), but a reader copying it into a bare project gets the crash.
   Reproduces on `main`.
4. **#206's stakes are raised by this branch, not caused by it.** Per-variable
   generalization means a scheme can quantify some variables and leave others
   unsolved, and hover renders the two identically. The closure doc §4.5 says
   this graduates #206 from annoyance to teachability requirement.
5. **#132 likewise** — emitted `.d.ts` is invalid for a polymorphic non-function
   binding (`const empty: Seq<a>` with unbound `a`), which is exactly the shape
   Step 1 multiplies.

---

## 6. Verification, as it stands

Compiler 1015, language-server 111, editors/vscode 149, playground 117 — all
passing, `tsc --noEmit` clean in the compiler. `npm run generate:prelude` was
re-run after `Seq.hex` gained its sigil; re-run it after any stdlib edit or
`prelude-sources.ts` goes stale.

The acceptance test is the program the whole ruling exists for, and it lives in
`relaxed-generalization.test.ts`:

```hexagon
let e = empty
export let ys: Int = Seq.length(cons(42, e))
export let xs: Int = Seq.length(cons("Briar", e))
```

Naming the empty sequence costs nothing. That is the sentence the branch is for.
