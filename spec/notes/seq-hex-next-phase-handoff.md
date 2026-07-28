# `Seq.hex` — next-phase hand-off

**Status:** Hand-off for a cold session, written 2026-07-28 by Opus at James's
request. Not a spec, not a work order amendment. The governing work order is
`spec/notes/seq-deintrinsification-plan.md`; on any conflict it wins, and the
specs it cites win over it.

**Read first, in this order:** this file → the work order (Phases 4 and 5, and
"Standing verification rules") → `spec/notes/compiler-conformance-defects.md`
entries **12** and **15** → `spec/loops-ranges-iteration.md` §6.4 →
`spec/ffi-part3-seq.md` §7.1/§7.2/§9.1 → `spec/stdlib-roadmap.md` §2 (the
`Seq.hex` obligation row, line 39) and §5.1 (the retention table, line 117).

---

## 0. Confirm the scope before writing code

James's framing: *"Seq.hex is nearly ready. Then `fromSeq`/`toSeq` in
Vector.hex. Then Vector.hex proceeds to its next phase."*

**§1 below is the recommended reading of "the next Seq.hex phase", derived from
what the corpus says is owed and not yet delivered.** It is a recommendation,
not an instruction James has confirmed. If his sense of "nearly ready" differs,
§1 is the only section that changes — everything else here is fact-finding that
stands either way. Confirm §1 with him before starting; it is one question, and
the alternatives are listed in §4.

---

## 1. Recommended scope: the memoizing spine, finished and exposed

Two items, coupled by construction — they are the same mechanism, and doing
either alone leaves the other's evidence unpinned.

### 1a. `memoize` does not exist

`Seq.memoize : Seq(a) -> Seq(a)` is a **decided v1 obligation**, not a candidate:

- `loops-ranges-iteration.md` §6.4 (line 188) — "**`memoize : Seq(a) -> Seq(a)`
  is the explicit opt-in** — it wraps any `Seq` in the runtime's memoizing spine
  (the same mechanism as FFI Part 3's inbound adapter) … the spine is
  runtime-provided, not `.hex` (a mutable buffer cannot be written under
  Statements §6.2)."
- `stdlib-roadmap.md` §2 obligation row (line 39) — `Seq.hex` "**includes the
  explicit `memoize` opt-in**".
- `stdlib-roadmap.md` §5.1 retention table (line 117) — what `Seq.hex` retains
  behind the private boundary is "memoizing spine (**`memoize`'s buffer** + the
  FFI Part 3 inbound adapter) and the `toJsIterable` bridge".

**It exists nowhere.** `memoize` appears in the repo only in prose: the
`Seq.hex` header comment (`stdlib/Seq.hex:18-19`), its embedded copy
(`compiler/src/prelude-sources.ts:41-42`), and the spec lines above. There is no
declaration, no helper, no test. Verified by grep across `compiler/src`,
`stdlib/`, `runtime/`.

The header comment already states *why* it cannot be `.hex` and *where* it must
live — this is the design, already made, waiting to be built:

> Neither the memoizing spine, the opt-in `memoize`, nor the two foreign shims
> (`fromJsIterator`, `toJsIterable`) can live in this file: all of them need a
> mutable buffer, and Statements §6.2 forbids mutable capture in closures. They
> are compiler/runtime-provided at the FFI Part 3 boundary.

So `memoize`'s Hexagon-visible face is a declaration in `Seq.hex` whose
implementation crosses the private boundary — the "narrow private intrinsic
door" pattern of `stdlib-roadmap.md` §5.2 item 2, *not* a new intrinsic
operation family (the arc just **deleted** one; see the work order's Phase 4
note on PR #85 finding F1, and do not reintroduce that shape).

**The mechanism already exists to build on:** `seqFromIterable`, the emitter
helper at `compiler/src/passes/emitter/emitter.ts:3527`, is exactly the
memoizing spine — a `__hex_values` buffer, lazy `[Symbol.iterator]()`
acquisition at first pull, §7.2 protocol order. Its comment block is the best
description of the intended semantics in the repo. `memoize` wants the same
spine over a `Seq` source instead of a foreign iterator.

### 1b. Defect 15 — the spine does not memoize a failure

`compiler-conformance-defects.md` entry 15 (line 828). **Open, pre-existing,
logged by Fable on PR #91 as finding F4 rather than fixed**, because the
unification neither introduced nor worsened it.

FFI Part 3 §7.1: "**If forcing a sequence node fails, that node remembers the
failure**: forcing the same persistent position again must not advance the
iterator and must not repeat the foreign operation." §7.2 step 6 repeats it.

What happens instead: a throw from `next()`, from a `done`/`value` getter, or
from the malformed-result check propagates **without being recorded**. Forcing
the same position again calls `next()` again, advancing the foreign iterator —
observable as skipped elements after a caught failure.

The defect log states the fix shape: the memo cell needs a third state beside
*unforced* and *forced* — **failed, with the thrown value** — replayed on every
subsequent force of that position. It is a change to the one helper.

### Why the two belong in one phase

`memoize` is specified as "the same mechanism as FFI Part 3's inbound adapter".
If that mechanism is shipped to a second caller while it still violates §7.1,
the defect is duplicated rather than inherited-and-fixed — and `Seq` is the
pilot `Vector`/`Set`/`Map` inherit (ledger §5.2), so it would be duplicated
three more times after that. Fix the spine, then expose it.

---

## 2. What is explicitly NOT in this phase

**Defect 12 — the exported-`Seq`-as-`Iterable` divergence — is blocked on a
ruling that is Fable's, not this session's.** Do not guess it, do not
work around it, do not let a `memoize` design quietly presuppose an answer.

`compiler-conformance-defects.md` entry 12 (line 681). FFI Part 3 §9.1 says an
exported Hexagon `Seq` is a replayable JavaScript iterable; the value is now a
record with no `[Symbol.iterator]`, while the `.d.ts` face still says
`Iterable<a>`. It covers **value, parameter, and result** positions — the
parameter half is *decided* spec (Part 7 §7 occasion 1), not merely undelivered.
Three candidate answers, each paying a different price, are enumerated in the
entry. Current behaviour is pinned in
`compiler/src/conformance/seq-unification.test.ts`, so whichever answer lands,
those tests fail deliberately.

**Why this matters to §1:** §9.1's "export boundary memoizes unconditionally"
and `memoize`'s opt-in spine are the same machinery viewed from two sides. A
`memoize` implementation is legitimate and useful without the ruling — but if
you find yourself needing to decide *what an exported `Seq` is* in order to
finish it, stop and hand that back. That is the ruling, and it is the one thing
this arc has been careful not to guess.

Also out of scope: `fromJsIterator` / `toJsIterable` as public Hexagon surface
(named in the header comment, exist nowhere; `toJsIterable` is in §5.1's
retention list, so it is owed — but it is FFI-boundary surface, and entangled
with defect 12); anything in `Vector.hex`; Phase 5 item 11.

---

## 3. Where `Seq.hex` actually stands

`stdlib/Seq.hex`, 265 lines, `PRELUDE_MODULES[2]` (after `Prelude.hex`,
`Option.hex`; before `Result.hex`) — `compiler/src/prelude.ts:32`.

Declaration: `export opaque record Seq(a) = { pull: () -> Option((a, Seq(a))) }`.
The intrinsic `Seq` type-kind, the `SeqOperation` family, and
`runtime/SeqCore.hex` are **deleted**; `Seq` is reached only as a declaration.

Present surface (22 exports): `next`; `empty`, `singleton`, `cons`, `iterate`,
`map`, `take`, `takeWhile`, `unfold`, `zipWith`, `zip`, `concat`; `filter`,
`drop`, `dropWhile`, `flatMap` (+ private `flatMapWith`); `fold`, `length`,
`forEach`, `find`, `any`, `all`.

Two house patterns in the file, both deliberate, both explained in its comments —
preserve them:

- Each combinator binds its pull step as a **local `let` lambda** before wrapping
  it, because a multi-line `match` as a record-field value makes the layout
  algorithm close the record literal at the first arm (defect log finding 5,
  **unruled**; owner is lexer-layout; the local-`let` form stands meanwhile).
- A combinator that may consume many source elements per output element uses a
  **`while` threading a `var` cursor, never self-recursion** — Loops §6.5
  promises no TCO. The sentinel `var searching` stands in for the absent `break`
  (Loops §9.4). See `filter`, `drop`, `dropWhile`, `flatMapWith`.

Test coverage: `compiler/src/conformance/seq.test.ts` (386 lines, behavioural,
written representation-blind — laziness, short-circuiting, boundaries, a 50k
constant-stack run, persistence), `seq-stdlib.test.ts` (114), and
`seq-unification.test.ts` (504, pins defect 12's current behaviour).

---

## 4. If §1 is not what James meant

The other readings of "nearly ready", so redirection is cheap:

1. **Combinator ship-list.** `stdlib-roadmap.md` §2 (line 38) makes *producing
   the v1 ship-list* the obligation; individual combinators are listing
   decisions. If `Seq.hex` is short a combinator James wants, that is a listing
   question first — it is not this session's to decide unilaterally.
2. **Defect 12 first.** Legitimate, but it is a **ruling**, so it means spawning
   Fable to rule, not implementing. See §5.
3. **`toJsIterable` as public surface.** Owed by §5.1, but entangled with
   defect 12; doing it first probably forces the ruling anyway.
4. **Nothing — declare `Seq.hex` done and move to `Vector.hex`.** Defensible if
   `memoize` is accepted as deferrable. It would leave a decided §2 obligation
   row undischarged, so the ledger row should say so rather than go quiet.

---

## 5. Seats, and how this session should run

Per James's standing policy (2026-07-28) and `seq-deintrinsification-plan.md`
"Roles, restated":

- **You (Opus) are the main session model.** Do the implementation in-session.
- **Fable is the expensive one, spawned as a subagent for exactly two jobs:**
  spec-writing and code review. Defect 12's ruling is spec work → Fable.
- **You never sign a verdict on your own work.** Self-report, hand off to James.
- **There is one GitHub account**, so a Fable review returns *prose*, not a
  GitHub approval. That is expected. Never post another agent's approval, and
  never route around GitHub's same-account block (this was attempted on PR #119
  and correctly refused).
- **James decides and merges. Merge commits only — never squash.**

Standing verification rules from the work order, which this arc has repeatedly
found to be load-bearing:

- **Honest-channel protocol:** when touching a reporting path, write the failing
  probe first, watch it fail, then fix.
- **A test that cannot fail on the old code proves nothing.** Confirm each new
  regression test red against `main` before claiming it as evidence (stash or a
  detached worktree). This caught a false claim on PR #119 and a false "latent"
  claim in Phase 3.
- **Do not argue from when the code changed; test what the old code accepted.**
  That exact reasoning error produced the Phase 3 correction (defect 8).
- Keep both suites green and `tsc` clean at every merge point: `cd compiler &&
  npx vitest run && npx tsc -p tsconfig.json --noEmit`, and `cd playground &&
  npm test && npm run check`.
- The canonical-formatting-and-naming pass is an **end-of-feature ritual**, not
  per-increment.
- Every observation leaves the log as "filed as #N" or "dropped, because X" —
  never as neither.

**Drift guard:** `stdlib/Seq.hex` has an embedded copy at
`compiler/src/prelude-sources.ts`, regenerated with `npm run generate:prelude`
from `compiler/`. A conformance test asserts they never diverge, written
generically over `PRELUDE_MODULES`. Any edit to `Seq.hex` must regenerate.

---

## 6. Downstream, for scope control only — do not do this work

James's stated order after this phase:

1. **`Vector.hex`'s `toSeq`/`fromSeq` become real `.hex`.** They currently
   delegate to compiler core operations (`stdlib/Vector.hex:48,51` →
   `checker.ts:1434-1435`). The work order already scouted the replacement and
   **verified it typechecks**: `toSeq` over `Seq.unfold`, `fromSeq` over
   `Seq.fold`, with no bridge at all (Phase 4, step 8's "blocking question"
   paragraph). `stdlib-roadmap.md` §5 item 6 gives the direction — "public
   declarations and Hexagon-expressible behavior live in canonical `.hex`
   source; only irreducible operations cross the private boundary".
2. **`Vector.hex`'s own arc** — Phase 5 item 11. Its extra weight over `Seq` is
   its **syntax surface**: literals, brackets, slicing, rest patterns. A known
   residue is already pinned: occluding `Vector` cannot redirect the `[...]`
   literal, which is dedicated syntax wired to the intrinsic (work order,
   Phase 2 carry-forward). That arc begins from an assertion, not a discovery.
