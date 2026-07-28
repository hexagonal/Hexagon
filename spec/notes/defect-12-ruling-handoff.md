# Defect 12 — the exported-`Seq`-as-`Iterable` ruling: hand-off

**Status:** Hand-off written 2026-07-28 by Opus at James's request, on the
merge of the #125 intrinsic-door ruling. Not a spec, not a work order. Its
siblings are `companion-door-ruling-handoff.md` (the #125 arc, now closed) and
`seq-hex-next-phase-handoff.md` (which still governs the `Seq.hex` phase).

**The one job:** fire Fable, in the **spec-designer seat**, to rule on
**defect 12**. The brief is §3. Everything else here exists so the session can
answer Fable's questions and judge its answer without re-deriving the ground.

**Read first, in this order:** this file →
`spec/notes/compiler-conformance-defects.md` entry 12 (line 681) →
`spec/ffi-part3-seq.md` §9.1 → `spec/ffi-part7-exports.md` §6 and §7 →
the anchors in §5.

---

## 1. What the ruling is, in one paragraph

Three decided rules disagree for `Seq`. **FFI Part 3 §9.1** says an exported
Hexagon `Seq` is a replayable JavaScript iterable — each `[Symbol.iterator]()`
opens an independent cursor over the *same memoized* sequence. **FFI Part 7 §6**
says an `export opaque` type's face is a TypeScript-only brand and the runtime
value crosses out and back **by identity** — and `Seq` became an
`export opaque record` during the de-intrinsification arc. **Ruling R1** makes
the memoizing inbound adapter the sole compiler-side constructor of `Seq`
records. Today the `.d.ts` face says `Iterable<a>` and the exported value is a
record with a `pull` and no `[Symbol.iterator]`. Under the old intrinsic the
property held for free, because a `Seq` *was* a JS iterable; nothing replaced it.

**The defect entry carries the full case and the three candidate answers with
their prices. Do not restate it to Fable — point at it.**

---

## 2. Three facts found while writing this brief that the defect entry predates

These are the reason this hand-off is worth more than a pointer. **All three
narrow or re-price candidate 1** (a per-value `[Symbol.iterator]` on the record),
which the entry describes as costing "a property on the hottest allocation in
the lazy-sequence core" and as giving "re-derivation, not §9.1's memoization".

### 2.1 Three sibling types already do exactly what candidate 1 proposes

The objection has live counterexamples in the same emitter:

- **`Range`** — `emitter.ts:3449-3457` builds `{ start, end, descending,
  *[Symbol.iterator]() { … } }`. Its FFI face is `Hex.Range`, an **opaque
  branded interface extending `Iterable<number>`** (Part 1). So the corpus
  already has a type whose face is an opaque brand *and* whose value carries
  `[Symbol.iterator]` to make an `Iterable` promise honest. That is candidate 1's
  exact shape, already blessed and shipped.
- **`Map` and `Set`** — `emitter.ts:3362-3363` build record-shaped values
  (`root`, `size`) that also carry `[Symbol.iterator]`. These are two of the
  three collections that **inherit `Seq`'s answer** (ledger §5.2), and they
  already pay the cost the objection treats as prohibitive.

This does not decide the ruling. It means candidate 1 must be rejected on
grounds other than novelty or cost-in-principle, if it is rejected.

### 2.2 The memoization objection has an answer that did not exist when the entry was written

The entry's second charge against candidate 1 is that it "still gives
re-derivation, not §9.1's memoization, for a `.hex`-built `Seq`". That is true of
`seqToIterable` **alone** — its own comment says so (`emitter.ts:3581-3588`:
"Re-iterating restarts from the head, which is persistence, not memoization").

But `seqFromIterable(seqToIterable(s))` composes the R1 pair into a memoizing
spine, and that composition was **verified against every Loops §6.4 property**
while scoping `Seq.memoize` — construction runs nothing, first traversal derives,
second replays with zero further source steps, infinite sources force only what
is reached, and #124's failure memoization is inherited. So a `[Symbol.iterator]`
that drives *that* composition rather than a bare `seqToIterable` would satisfy
§9.1's memoization clause. Whether it should is Fable's call; that it *can* is
new information.

### 2.3 The intrinsic door now exists

PR #127 (ruling on #125, `spec/intrinsics.md`) landed the
`extern from "hex:intrinsic"` declaration form. `Seq.hex` can now name a
compiler-provided implementation under its own roof. When defect 12 was logged
it could not — which is part of why candidate 1's "puts representation knowledge
at the record's own constructor, against R1's sole-constructor clause" read as
a hard constraint. **The door may open a fourth answer** (a declared
boundary-facing operation rather than a property on every value). It also fixes
where `toJsIterable` would live if the ruling wants it — an obligation the
retention table (`stdlib-roadmap.md` §5.1) already owes and that is entangled
with this defect.

`intrinsics.md` §8.3 is deliberately neutral on defect 12: it says `memoize`'s
declared type is `Seq(a) -> Seq(a)` and whatever this ruling makes of an
exported `Seq`'s JS face applies to it uniformly with every other combinator.
Nothing in #125 pre-commits this answer.

---

## 3. The brief, ready to send

Fire Fable as a subagent with `model: fable`, cold context.

> You are Fable, in the SPEC-DESIGNING seat on the Hexagon language project
> (repo root: /Users/jamesmccomb/Projects/hexagon). This is a RULING, not an
> implementation task. Opus did the fact-finding and deliberately did not guess
> the answer.
>
> ## The ruling wanted
>
> **Defect 12** — an exported Hexagon `Seq` no longer faces JavaScript as an
> `Iterable`. Three decided rules disagree (FFI Part 3 §9.1, FFI Part 7 §6,
> ruling R1), and the divergence covers **value, parameter, and result**
> positions. Read `spec/notes/compiler-conformance-defects.md` entry 12 first —
> it carries the full case, the three-way authority tension, and three candidate
> answers with their prices. Decide it and write the spec text.
>
> ## Required reading, in order
>
> 1. `spec/notes/compiler-conformance-defects.md` entry 12 (line 681).
> 2. `spec/ffi-part3-seq.md` §9.1 (the replayability promise) and §2.1 (the
>    fresh-per-value adapter rule), §7.1/§7.2 (the protocol).
> 3. `spec/ffi-part7-exports.md` §6 (the opaque brand, and §6.8's face) and §7
>    (direct export vs stable wrapper — **occasion 1 is already decided spec**
>    and is the parameter half of this defect).
> 4. `spec/ffi-part6-functions-callbacks.md` §1 (the wrapper-occasions table §7
>    points at).
> 5. `spec/stdlib-roadmap.md` §5.1 (the retention table — `toJsIterable` is owed
>    and is entangled with this) and §5.2 (`Seq` is the pilot `Vector`/`Set`/`Map`
>    inherit).
> 6. `spec/intrinsics.md` — NEW, landed today (ruling on #125). The intrinsic
>    door did not exist when defect 12 was logged.
> 7. The code: `compiler/src/conformance/seq-unification.test.ts` (pins the
>    current behaviour on both surfaces; whichever answer lands, these fail
>    deliberately and get rewritten), `compiler/src/passes/emitter/emitter.ts`
>    at `:3362-3363` (Map/Set values), `:3449-3457` (Range), `:3527`
>    (`seqFromIterable`), `:3581` (`seqToIterable`).
>
> ## Three facts the defect entry predates — verify them, then use them
>
> Opus found these while briefing you; they bear directly on candidate 1 and are
> not in the entry. Check each rather than taking them on trust.
>
> 1. **Three sibling types already carry `[Symbol.iterator]` on the value.**
>    `Range` (`emitter.ts:3449-3457`) does it while its FFI face is an opaque
>    branded interface extending `Iterable<number>` — candidate 1's exact shape,
>    already shipped. `Map` and `Set` (`:3362-3363`) do it on record-shaped
>    values, and they are two of the three collections that inherit this answer.
>    So "it adds a property to the hottest allocation" is a cost the corpus
>    already pays three times; if candidate 1 is rejected it needs a sharper
>    reason.
> 2. **The memoization objection has an answer.** `seqToIterable` alone gives
>    persistence, not memoization — its own comment says so. But
>    `seqFromIterable(seqToIterable(s))` composes the R1 pair into a memoizing
>    spine, verified against every Loops §6.4 property while scoping
>    `Seq.memoize`. A `[Symbol.iterator]` driving that composition would satisfy
>    §9.1's memoization clause.
> 3. **The intrinsic door now exists** (`spec/intrinsics.md`, merged today).
>    `Seq.hex` can name a compiler-provided implementation under its own roof,
>    which it could not when the entry was written. This may open a fourth answer
>    beyond the entry's three, and it fixes where `toJsIterable` would live.
>
> ## Scope
>
> - **In:** the value, parameter, and result positions, ruled uniformly — the
>   entry is explicit that a value-only answer under-constrains the problem, and
>   that Part 7 §7 occasion 1 (the `Iterable<a>` parameter declared as `Seq(a)`)
>   is already-decided spec that no wrapper currently implements.
> - **In, firmly — James's instruction:** `toJsIterable` as public Hexagon
>   surface, owed by the stdlib-roadmap §5.1 retention table. Land it as part of
>   this ruling and discharge the obligation; do not return it as still-owed. The
>   defect entry treats it as separable FFI-boundary surface — James has decided
>   it travels with this answer, because the face and the operation that exposes
>   it should not be ruled apart. `spec/intrinsics.md` fixes where it can live.
> - **In, firmly — James's instruction:** `Vector`, `Set`, and `Map` are **bound
>   now**, not advised. `Seq` is the pilot they inherit (ledger §5.2), and a guess
>   inherited three times is the failure mode this defect was left open to avoid.
>   State what each inherits as binding spec, and price anything one of them
>   cannot pay. Note `Map` and `Set` values already carry `[Symbol.iterator]`
>   (`emitter.ts:3362-3363`), so part of their inheritance may already be paid —
>   check rather than assume.
> - **Out:** the companion-module idiom and the intrinsic door's spelling — ruled
>   today in `spec/intrinsics.md`, do not reopen. `Seq.memoize`'s implementation.
>   Anything else in `Vector.hex`.
>
> ## Deliverable
>
> Spec text in the file(s) you judge own it (say why). Decide: which of the three
> faces gives way and which holds; the mechanism at each of the three positions;
> what `Vector`/`Set`/`Map` inherit; and what happens to the pinning tests in
> `seq-unification.test.ts` (they encode the current divergence, so name which
> assertions become wrong and what replaces them — do not leave that to the
> implementer to guess).
>
> House conventions: stable section numbers, edit notes for any spec your ruling
> touches, the Rewrite Rule for any new diagnostic, a decisions-log line. Where
> you reject an alternative, record the rejection and its price.
>
> You may read and run anything. Do not commit, do not push, do not modify
> `main`'s committed state — leave spec text as uncommitted working-tree changes.
> If you need to test what the compiler currently accepts, use a detached
> worktree, and the standing rule applies: **do not argue from when the code
> changed; test what the code accepts.**

---

## 4. Questions settled with James before firing — SETTLED 2026-07-28

Both were open when this note was drafted; James answered both and §3's brief
was amended before firing. Both answers widen the ruling.

1. **`toJsIterable` is FIRMLY IN SCOPE.** Not the drafted "conditionally in".
   The ruling must land it as public Hexagon surface and discharge the §5.1
   retention-table obligation, rather than returning it as still-owed. James's
   reasoning: the face and the operation that exposes it should not be ruled
   apart. **Consequence to watch:** this pulls FFI-boundary surface into a ruling
   the defect entry framed as being about the face alone.
2. **`Vector`, `Set`, and `Map` are BOUND NOW, not advised.** Fable must state
   what each inherits as binding spec and price anything one of them cannot pay.
   Same call James made on #125's decision point 5. **Consequence to watch:**
   three companions acquire binding obligations before their arcs begin — though
   §2.1's finding suggests `Map`/`Set` may already pay part of it.

---

## 5. Verified anchors (2026-07-28, after PR #127)

| What | Where |
| --- | --- |
| The defect, full case + 3 candidates | `spec/notes/compiler-conformance-defects.md:681` |
| Replayability promise | `spec/ffi-part3-seq.md` §9.1 |
| Opaque brand / identity crossing | `spec/ffi-part7-exports.md` §6 |
| Wrapper occasions; occasion 1 = the parameter half | `spec/ffi-part7-exports.md` §7 |
| Current behaviour, pinned | `compiler/src/conformance/seq-unification.test.ts` (the "boundary face (FFI Part 3)" describe at :287) |
| `Range` value carries `[Symbol.iterator]` | `emitter.ts:3449-3457` |
| `Map`/`Set` values carry `[Symbol.iterator]` | `emitter.ts:3362-3363` |
| The R1 pair | `emitter.ts:3527` (`seqFromIterable`), `:3581` (`seqToIterable`, with the persistence-not-memoization comment) |
| The intrinsic door | `spec/intrinsics.md` (PR #127) |

**Drift guard:** `stdlib/Seq.hex` has an embedded copy at
`compiler/src/prelude-sources.ts`, regenerated with `npm run generate:prelude`
from `compiler/`. A conformance test asserts they never diverge. Any edit to a
prelude `.hex` must regenerate.

---

## 6. Seats, and standing rules

Unchanged from the #125 arc:

- **Opus is the main session model**; implementation happens in-session.
- **Fable is spawned as a subagent for exactly two jobs:** spec-writing and code
  review. This is spec work → Fable.
- **Neither model signs a verdict on its own work.** On #125, Opus reviewed
  Fable's ruling and returned five findings, three of them inside the binding
  schedule; Fable verified and fixed all five. Do that again.
- **One GitHub account**, so a Fable review returns *prose*, not an approval.
- **James decides and merges. Merge commits only — never squash.**

Verification rules this arc has repeatedly found load-bearing:

- **Honest-channel protocol:** when touching a reporting path, write the failing
  probe first, watch it fail, then fix.
- **A test that cannot fail on the old code proves nothing.** Confirm each new
  regression test red against `main` before claiming it as evidence.
- **Name the wrong implementation before writing the tests.**
- Keep both suites green and `tsc` clean at every merge point: `cd compiler &&
  npx vitest run && npx tsc -p tsconfig.json --noEmit`, and `cd playground &&
  npm test && npm run check`.
- Every observation leaves the log as "filed as #N" or "dropped, because X" —
  never as neither.

---

## 7. Open issues for triage

#117 (structured fixes lexer-only — needs a ruling), #118 (module-alias
diagnostic names no rewrite), #120/#121/#122 (the Operators §11.4 family),
#123 (reentrant `Seq` forcing), #126 (retire the unreachable `#runtime` flag —
blocked on the intrinsic door being implemented).

**After defect 12:** implement the intrinsic door and `Seq.memoize` through it
(`companion-door-ruling-handoff.md` §7), then the rest of the `Seq.hex` phase,
then `Vector.hex`'s `toSeq`/`fromSeq` as real `.hex`, then `Vector`'s own arc.
