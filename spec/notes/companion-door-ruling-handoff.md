# The companion private-door ruling — cold-session hand-off

**Status:** Hand-off for a cold session, written 2026-07-28 by Opus at James's
request. Not a spec, not a work order. Its sibling is
`spec/notes/seq-hex-next-phase-handoff.md`, which still governs the `Seq.hex`
phase; this note covers the one thing that phase turned out to be blocked on.

**Your job in the new session is one thing:** fire Fable, in the **spec-designer
seat**, to cogitate and rule on **issue #125**. The brief is §2, ready to send.
Everything else here exists so you can answer Fable's questions and judge its
answer without re-deriving this session.

**Read first, in this order:** this file → `gh issue view 125` → `spec/modules.md`
§5.1–§5.4 → `spec/stdlib-roadmap.md` §5.2 → the anchors in §5 below.

---

## 0. How this came about, in four steps

1. Defect 15 (the inbound adapter did not memoize a forcing failure) was fixed
   and merged as **PR #124** (`d689b9c`). Reviewed by Fable; the emitter diff
   landed unchanged and every required change was to the *evidence*. Details in
   `spec/notes/compiler-conformance-defects.md` entry 15.
2. That left the other half of the phase: **`Seq.memoize`**, a decided v1
   obligation that exists nowhere in the repo but prose.
3. Scoping it produced a happy result and a blocking one. Happy: **there is no
   new spine to write** (§3). Blocking: `Seq.hex` cannot name the compiler
   implementation it needs, because it declares its own type (§4).
4. James's reading — that a companion declaring its own type is perfectly
   sensible, and that if Hexagon cannot express it that is a spec problem — was
   tested against the corpus. It *is* expressible and blessed; the missing piece
   is narrower and is already an undischarged obligation. Filed as **#125**.

---

## 1. What the ruling is, in one paragraph

A companion module that declares its own type has **no spelling for the
compiler-provided implementation of an operation it publicly owns**. The
compiler's private door is spelled as the companion's *public qualified name* —
`Vector.at(values, index)` inside `stdlib/Vector.hex:43` means "the compiler's
`at`", not "the companion's `at`". Modules §5.2 gives that syntax two positions,
module and constructor; the intrinsic is a third meaning with no spelling of its
own, riding on whichever position happens to be unbound. `Seq.hex` declares
`record Seq(a)`, so in that file the constructor is bound and the door is gone.

**#125 carries the full case, both spikes, and five numbered decision points.
Do not restate it to Fable — point at it.**

---

## 2. The brief, ready to send

Fire Fable as a subagent with `model: fable`, cold context. Send this verbatim
unless James has amended it (see §3).

> You are Fable, in the SPEC-WRITING seat on the Hexagon language project
> (repo root: /Users/jamesmccomb/Projects/hexagon). This is a RULING, not an
> implementation task. Opus did the fact-finding and deliberately did not guess
> the answer; the arc has been careful not to bake guesses into the pilot that
> Vector, Map, and Set inherit.
>
> ## The ruling wanted
>
> Issue #125: a companion module that declares its own type has no spelling for
> the compiler-provided implementation of an operation it publicly owns. Read the
> issue first — it carries the full evidence, two spike results, and five numbered
> decision points. Your job is to decide those five and write the spec text.
>
> ## Required reading, in order
>
> 1. Issue #125 (`gh issue view 125`).
> 2. `spec/modules.md` §5.1-§5.4 — the companion-module idiom, "resolved by
>    position", and the occlusion rule. This is DECIDED and is not what you are
>    reopening; it is the constraint your answer must sit inside.
> 3. `spec/stdlib-roadmap.md` §5.2 items 1-7 — the migration template that already
>    demands a "narrow private intrinsic door" and a "private boundary". Your
>    ruling discharges an obligation written there.
> 4. `spec/method-syntax.md` §4 (`CompanionOf`) — companion dispatch targets the
>    nominal type's home module, so the door must not perturb it.
> 5. The code the ruling governs: `compiler/src/passes/resolver/resolver.ts:1310-1350`
>    (the door's guards, and the `Node` precedent at :1334/:1967),
>    `compiler/src/passes/checker/checker.ts:256` and `:1342-1375` (`#seqRecord`,
>    `#sequence`, and the occlusion property the fallback must not undo),
>    `stdlib/Vector.hex:38-51` (the public-name door in use today),
>    `stdlib/Seq.hex` (the companion that already declares its own type).
>
> ## What is NOT yours to change here
>
> - The companion-module idiom itself (Modules §5.2/§5.3). It is decided, and the
>   evidence says it works — `Seq.hex` declares `record Seq(a)` and exports 22
>   operations with a green suite. If you conclude the idiom must change, say so
>   explicitly and stop; do not fold it into this ruling.
> - Defect 12 (exported `Seq` no longer faces JS as an `Iterable`). Separate
>   ruling, also yours, not this one. Do not let this answer presuppose it.
> - `Seq.memoize`'s implementation. It is ready and blocked only on you: no new
>   spine is needed, `seqFromIterable(seqToIterable(s))` composes the existing R1
>   pair, verified against every Loops §6.4 property.
>
> ## Deliverable
>
> Spec text, in the file you judge owns it (say why you chose it), deciding all
> five points in #125: the spelling, the gate, the user-facing visibility and
> diagnostics, the `#seqRecord` self-declaration fallback, and whether/how the
> public-name door is deprecated for `Vector`/`Map`/`Set`.
>
> Follow the house conventions: stable section numbers, edit notes for any other
> spec your ruling touches, the Rewrite Rule for any new diagnostic, and a
> decisions-log line. Where you reject an alternative, record the rejection and
> its price — the prior art in #125 (OCaml `external`, Haskell `foreign import`,
> Rust `extern "rust-intrinsic"`, Scala companions) is the comparison set, and the
> observation that none of them spells a primitive as `Self.publicName` is the
> argument to engage with rather than restate.
>
> You may read and run anything. Do not modify `main`, do not commit, do not push.
> If you need to test what the compiler currently accepts, use a detached worktree —
> and the standing rule applies: do not argue from when the code changed, test what
> the code accepts.

---

## 3. Two things to settle with James before firing — SETTLED 2026-07-28

Both were open when this note was first written. James answered both, and the
brief in §2 was amended accordingly before firing. **The §2 text above is the
pre-amendment draft; the sent brief carried these two changes.** Recorded also as
a comment on #125.

1. **The companion idiom is IN scope and reopenable.** James overrode the
   draft's fence. His instinct is that module name / type name / constructor
   sharing a spelling, "resolved by position", may be what left the third
   meaning homeless. The sent brief tells Fable it may rule against the idiom,
   but must then price what becomes of `Seq.hex`'s 22 exports and `Vector.hex`'s
   ~10 door rows, and must record why the narrower answer (keep the idiom, add a
   distinct private spelling) was rejected if it was available. **Consequence to
   watch:** this ruling can come back much larger than a spelling.
2. **Decision point 5 is Fable's to decide in full.** Not priced-and-returned.
   The deprecation schedule goes into spec text bound to each companion's
   self-declaration milestone; if a milestone cannot be fixed yet, the ruling
   must name the fact that would fix it. **Consequence to watch:** this commits
   `Vector`/`Map`/`Set` to migration work at those milestones.

Still out of scope, unchanged: defect 12's ruling, and `Seq.memoize`'s
implementation.

---

## 4. The facts a cold session will want, so it need not re-derive them

### 4.1 `Seq.memoize` needs no new spine — verified

`memoize(s) ≡ seqFromIterable(seqToIterable(s))`, the two R1 bridge helpers
composed. Run against the post-#124 helpers copied verbatim, this satisfies every
property Loops §6.4 asks of it: construction runs nothing; the first traversal
derives and the second replays with **zero** further source steps while the
unmemoized original still doubles its step count; an infinite source forces only
what is reached, and shares it; and #124's failure memoization is inherited — a
failing source replays the identical error object and is touched once.

Two independent grounds now point at this implementation. The second is the
prelude order: members see only those before them, so `Vector.hex` must land
**after** `Seq.hex` (its signatures name `Seq(a)`; `Seq.hex` names no `Vector` —
verified, no cycle). `Seq.hex` therefore can never depend on `Vector`, which rules
out any "buffer into a `Vector`" implementation on its own.

So the emitter side is **one row**. Everything else is the door.

### 4.2 Why `Seq.` cannot be the door — and why the obvious diagnosis is wrong

It is **not** the `#namedModule` guard. A prelude module never sees itself
(`project.ts:134`), so that guard still passes inside `Seq.hex`. It is
`scope.lookup("Seq")`: the file declares `record Seq(a)` at `stdlib/Seq.hex:26`,
so `Seq` is a bound name there and `Seq.memoize` is a **field access on the
constructor**. Spike 1 in #125 shows the emitted `(Seq.memoize)(source)` and the
resulting type error.

An earlier version of this analysis blamed prelude membership and was wrong. The
control experiment settles it: adding `Vector.hex` to `PRELUDE_MODULES` and
regenerating compiles clean, with `at` still emitting `__hex_vectorAt`. **Prelude
membership is harmless; self-declaration is what closes the door.**

### 4.3 The second obstacle, which only a spike would have found

`#seqRecord` is `module.preludeRecords.get("Seq")` (`checker.ts:256`), empty in
the module that declares `Seq`. **The checker cannot name `Seq(a)` while checking
`Seq.hex`**, so a door row typed `Seq(a) -> Seq(a)` cannot type itself through
`#sequence` (`checker.ts:1347`). It needs a fallback to the declaring module's own
record, gated so it does not undo the occlusion property documented at
`checker.ts:1342-1346`. Decision point 4 in #125.

### 4.4 Four customers, not one

stdlib-roadmap §5.2: `Seq.hex` declares the type "before and as the pilot for
`Vector`/`Set`/`Map`". `Vector.hex` has ~10 rows reached through the public-name
door today, all genuinely irreducible (HAMT trie operations). Whatever spelling
lands is inherited three times. This is the reason the ruling is worth Fable's
time rather than an afternoon's choice.

---

## 5. Verified anchors (2026-07-28, `main` at `d689b9c`)

| What | Where |
| --- | --- |
| The door's guards; `Node` precedent | `resolver.ts:1322`, `:1334`, `:1967` |
| `#seqRecord`; `#sequence` | `checker.ts:256`, `:1347` (occlusion note `:1342-1346`) |
| Prelude self-exclusion; `resolve` call (never passes `runtime`) | `project.ts:134`, `:147` |
| The R1 pair | `emitter.ts:3527` (`seqFromIterable`), `:3581` (`seqToIterable`) |
| The public-name door in use | `stdlib/Vector.hex:13,43,46,48,51` |
| The self-declaration | `stdlib/Seq.hex:26` |
| Prelude member list (normative order) | `compiler/src/prelude.ts:32` |

**Drift guard:** `stdlib/Seq.hex` has an embedded copy at
`compiler/src/prelude-sources.ts`, regenerated with `npm run generate:prelude`
from `compiler/`. A conformance test asserts they never diverge. Any edit to a
prelude `.hex` must regenerate. The generator keeps its own copy of the member
list at `compiler/scripts/generate-prelude.mjs:16` — adding a prelude module
means editing **both** it and `prelude.ts`.

---

## 6. Seats, and how the session should run

Per James's standing policy and `seq-deintrinsification-plan.md` "Roles,
restated":

- **You (Opus) are the main session model.** Implementation happens in-session.
- **Fable is the expensive one, spawned as a subagent for exactly two jobs:**
  spec-writing and code review. This ruling is spec work → Fable.
- **You never sign a verdict on your own work.** Self-report, hand off to James.
- **One GitHub account**, so a Fable review returns *prose*, not an approval.
  Never post another agent's approval; never route around GitHub's same-account
  block (attempted once on PR #119 and correctly refused).
- **James decides and merges. Merge commits only — never squash.**

Standing verification rules, which this arc has repeatedly found load-bearing:

- **Honest-channel protocol:** when touching a reporting path, write the failing
  probe first, watch it fail, then fix.
- **A test that cannot fail on the old code proves nothing.** Confirm each new
  regression test red against `main` before claiming it as evidence.
- **Name the wrong implementation before writing the tests.** PR #124's review
  turned entirely on this: five tests all failing at the head could not see a
  mutant that poisoned every buffered position. For `memoize` the mutant is
  `memoize(s) = s`, and a suite that only drains twice and compares elements
  passes on it — so every test must assert *effect counts*, and the suite must be
  confirmed red against the identity stub.
- **Do not argue from when the code changed; test what the old code accepted.**
- Keep both suites green and `tsc` clean at every merge point: `cd compiler &&
  npx vitest run && npx tsc -p tsconfig.json --noEmit`, and `cd playground &&
  npm test && npm run check`.
- Every observation leaves the log as "filed as #N" or "dropped, because X" —
  never as neither.

---

## 7. After the ruling

1. **Implement the door as ruled**, and `Seq.memoize` through it. One emitter
   row (§4.1), one checker row plus the `#seqRecord` fallback (§4.3), whatever
   resolver shape the ruling fixes, and the declaration in `Seq.hex`.
2. **Then the rest of the `Seq.hex` phase** — see
   `spec/notes/seq-hex-next-phase-handoff.md`, whose §1a is what remains of it.
3. **Still explicitly out:** defect 12's ruling (Fable's, separate), and
   `toJsIterable`/`fromJsIterator` as public surface (owed by stdlib-roadmap
   §5.1, entangled with defect 12).
4. James's stated order after that: `Vector.hex`'s `toSeq`/`fromSeq` become real
   `.hex` (the work order verified that version typechecks), then `Vector`'s own
   arc, whose extra weight is its syntax surface.

**Open issues from this arc, for triage:** #117 (structured fixes lexer-only —
needs a ruling), #118 (module-alias diagnostic names no rewrite), #120/#121/#122
(the Operators §11.4 family, from PR #119), #123 (reentrant `Seq` forcing —
raised by Fable as review finding F3 on #124), #125 (this ruling).
