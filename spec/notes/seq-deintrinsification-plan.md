# Seq de-intrinsification — compiler alignment work order

**Status:** Active work order (Fable → Opus, 2026-07-26). The spec now leads and
the compiler is behind it; this note sequences the alignment. Authorities:
Loops §6.1/§6.4/§6.5/§6.6 (the type, persistence policy, emission,
representation), Modules §5.4/§5.5 (occlusion; prelude mechanism),
stdlib-roadmap.md §2 (the `Seq.hex` obligation) and §5 (migration doctrine),
FFI Part 3 (boundary, unchanged), and `compiler-conformance-defects.md`
(2026-07-26 entries, defects 1–6). Rationale archive:
`seq-core-representation.md` §9. This note decides nothing; on any conflict the
cited owner wins.

**Roles, restated:** Opus implements, self-reports, opens PRs, and reminds
James after review; Fable reviews and issues verdicts; James decides and
merges. Merge commits only — never squash. The canonical-formatting-and-naming
pass is an end-of-feature ritual, not per-increment.

## Phase 0 — land the spec (this PR)

The spec changes are in the working tree on branch `seq-core`, uncommitted.
Commit them on top of the branch's five existing commits and open **one PR**
from `seq-core`. Files:

- `spec/loops-ranges-iteration.md` — §6.1 declared-type paragraph; §6.4
  persistence policy (re-derivation default, `memoize` opt-in, memoizing export
  boundary); §6.5 representation decided; new §6.6.
- `spec/modules.md` — new §5.5 (prelude = ordered set of ordinary modules;
  intra-prelude visibility; no `import` lines in prelude source; compiler
  resolution never outranks declarations); §14 decisions-log row.
- `spec/stdlib-roadmap.md` — §2 obligation row (count 18→19); §5.1 `Seq.hex`
  row; §5.2 order note.
- `spec/notes/compiler-conformance-defects.md` — defect 6 (resolution order).
- `spec/notes/seq-core-representation.md` — status closed; §9 review outcome.
- `spec/notes/seq-deintrinsification-plan.md` — this note.

A sensible split: one commit for the owning-spec amendments (loops, modules,
ledger), one for the notes. Do not fold unrelated changes in. James merges.

## Phase 1 — checker prerequisites

Both are prerequisites, not siblings, of the unification: once `Seq` is opaque,
`next` plus `Option((a, Seq(a)))` destructuring is the *entire* public face,
and both are broken. Each fix lands with the Seq-free reproduction from the
defect log pinned as a conformance test, plus the Seq-shaped cases.

1. **Defect 1 — recursive caller must instantiate a generic annotated callee's
   scheme.** Repro: recursive `repeat` calling generic `ident` (defect log
   §6-entry 1). Likely locus: the 2026-07-24 rigid-type-variable change —
   rigidity was correctly given to the *definition being checked* and
   incorrectly extended to the callee's scheme at call sites inside recursive
   definitions. Tests: the `repeat`/`ident` repro; a recursive `map` over a
   record-of-closure calling an annotated `next`; the non-recursive control
   (already fine) pinned against regression.
2. **Defect 2 — a tuple pattern directly beneath a constructor pattern counts
   as covering.** Repro: `Some((value, rest))` / `Ok((value, rest))` (defect
   log entry 2). Distinct from the arity diagnostic, which is correct and must
   stay. Tests: Option and Result forms; a tuple-in-tuple-in-constructor
   nesting; exhaustiveness still *fails* when an arm is genuinely missing.
3. *(Cheap, optional, same phase)* **Defect 3** — deduplicate the ×3
   stage-aggregation in `project.diagnostics`. The poison test must stay red
   under blinding after the fix (re-verify sensitivity, don't assume it).

## Phase 2 — resolver conformance (defect 6)

4. **Declarations before intrinsics.** Reorder the type-annotation path so
   user/prelude declarations (aliases, unions, records, extern types) are
   consulted before the intrinsic branch; intrinsics become fallback-only.
   During the transition `Seq`/`Vector`/`Set`/`Map` remain in the fallback;
   after Phase 4, `Seq` leaves it. Tests: a user `record Vector(a)` (or any
   still-intrinsic name) is coherently occluded — annotation, constructor, and
   companion dispatch all reach the record; the term-level yield
   (resolver.ts:1165 behavior) pinned; boundary intrinsics (`Array`,
   `Nullable`) still resolve when no declaration competes.

   *(Landed 2026-07-26.)* The record table moved up beside the alias, extern, and
   union tables; the two later record lookups it superseded are gone, so one
   lookup now serves the applied and nullary forms and the asymmetry cannot
   return by halves. Coverage in
   `compiler/src/conformance/resolution-order.test.ts`; sensitivity verified by
   blinding (10 of 22 red without the resolver change). Two things a later phase
   should know. **Phase 4 is unblocked but not pre-empted:** `Seq` the *name* is
   now available to a declaration, yet the intrinsic type-kind and its producers
   are untouched, so a `record Seq(a)` still would not unify with what
   `Map.keys`/`Vector.toSeq`/`for ... in`/`Seq.iterate` yield — step 8 is still
   the whole job. `runtime/SeqCore.hex`'s header, which asserted the defect as a
   fact of the language, has been corrected to say this. **A residue belongs to
   `Vector`, not here:** occluding `Vector` cannot redirect the `[...]` literal,
   which is dedicated syntax wired to the intrinsic, so a literal under a user
   `record Vector(a)` still gives the same-name mismatch. That is exactly the
   syntax surface Phase 5 item 11 already names as `Vector`'s extra weight; it is
   pinned as known residue so that arc begins from an assertion. `Seq` has no
   literal form, so nothing here reaches Phase 4.

## Phase 3 — prelude mechanism (Modules §5.5)

5. **Ordered intra-prelude visibility.** Today prelude scope reaches only
   non-prelude modules; extend it so each prelude module sees the members
   *before it* in `PRELUDE_MODULES`, and only those. Test: a prelude module
   using `Option` with no import line compiles; a prelude module referencing a
   *later* member fails.
6. **Drift guard.** The embedded-copy-matches-`stdlib/` test extends to
   `Seq.hex` when it joins the set.

   *(Landed 2026-07-26.)* Item 5 is a two-line change in `project.ts` —
   `preludePaths.slice(0, indexOf(path))` for a prelude module, the whole list
   for a consumer. **The emission bug it exposes was the real work of this
   phase.** Prelude modules were emitted only when a *non-prelude* consumer
   imported them, so a member reachable only through another prelude member was
   dropped while the importer's emitted JavaScript still named it — a clean
   compile producing unloadable output, exactly the class the poison test exists
   to catch. Emission is now reachability from the non-prelude modules, and a
   general invariant is pinned: every relative import in the emitted output names
   an emitted module. Phase 4 would have hit this the moment `Seq.hex` used
   `Option`.

   *(Corrected after review.)* I first reported that bug as **latent** — enabled
   and fixed by the same commit, so never a divergence. Fable tested the claim
   instead of accepting it and it is false: the old predicate ignored
   prelude-to-prelude importers *whatever the import's origin*, and an explicit
   `import` line between project-supplied prelude-basename files needed no §5.5
   visibility and was always legal. It reproduces on `main`. Logged as **defect
   8**, with that reproduction pinned as a second entry channel alongside the
   synthesized one. The reasoning error is worth keeping: I argued from *when the
   code changed* rather than testing *what the old code accepted*.

   Item 6 needed writing, not extending: **the drift test did not exist**, though
   `prelude.ts`'s header has always claimed "a test asserts the two never drift".
   The three embedded copies had not in fact drifted. It is now written
   generically over `PRELUDE_MODULES` rather than over three names, so `Seq.hex`
   is covered the moment it joins the set with no edit here — which is what this
   item asks for. It also asserts every member *has* a canonical `stdlib/`
   original, so a member embedded without one fails rather than passing vacuously.

   Not done, deliberately: §5.5's "no `import` lines in prelude source" is
   unenforced. The section justifies it pedagogically and specifies no
   diagnostic, and whether it is an error or a lint is a real question rather
   than an oversight — raising it rather than silently deciding it. Coverage in
   `compiler/src/conformance/prelude-mechanism.test.ts`.

## Phase 4 — `Seq.hex` and the unification

*(Steps 8 and 9 landed 2026-07-26, as one coupled change. Phase 4 is complete;
what remains of the arc is Phase 5. Two prerequisites found while attempting
step 8 — defects 9 and 10 — landed ahead of it in PRs #89 and #90.)*

**What landed.** `stdlib/Seq.hex` is `PRELUDE_MODULES[2]`, after `Option.hex`.
The intrinsic `Seq` type-kind, the `SeqOperation` expression family across all
four trees, and `runtime/SeqCore.hex` are **deleted**. `Seq(a)` is now reached
only as a declaration: the resolver's intrinsic fallback list is
`Vector`/`Set`/`Array`/`Nullable`, and `Seq` is not in it.

- **Naming a prelude declaration's identity** — the plumbing step 8 called "the
  substance of the work" — is `preludeRecords` on the resolved, typed, and core
  modules: prelude record identities by name, kept *separate* from the record
  table a module may occlude (§5.4). A module that declares its own
  `record Seq(a)` shadows the name without redirecting `Map.keys`. Every
  compiler-side producer (`Map.keys`/`values`/`entries`/`toSeq`, `Set.toSeq`,
  `Vector.toSeq`/`fromSeq`) and consumer (`Map.fromSeq`/`fromEntries`,
  `Set.fromSeq`, `Vector.fromSeq`) is typed against that identity.
- **The R1 pair** is `seqFromIterable` (memoizing inbound adapter, the sole
  compiler-side constructor of `Seq` records) and `seqToIterable` (outbound
  driver — a `while` over `pull`, never recursion, per Loops §6.5). Producing
  rows go through the first, consuming rows and `for x in` (R3) and extern
  boundaries in both directions through the second. HAMT traversal stays
  runtime-owned and composes with the pair, as R1 says.
- **The compiler-known operation family is deleted, not repointed** (PR #85
  finding F1). `Seq.iterate`/`map`/`filter`/`take` are ordinary qualified
  references to prelude functions; `source.map(f)` is ordinary companion
  dispatch on a nominal record. The remaining guards (`Map`/`Set`/`Vector`/
  `Node`/`Int`/`BigInt`/`Float`) now test `#namedModule`, so a prelude member
  outranks the compiler's own machinery at every one of them, not just `Seq`'s.
- **`stdlib/Vector.hex` is unchanged.** R4 retypes the bare rows rather than
  converting the wrappers, so `toSeq`/`fromSeq` keep delegating to operations
  that now yield and accept the record. The blind spot the experiment found — a
  bare `Vector.fromSeq` against a `Seq.iterate` — is pinned as a runtime
  round-trip, and the two shipped playground examples that first caught it are
  now *executed* by `playground/src/examples/examples.test.ts`, not merely
  compiled.
- **Step 9's behavioural suite passes textually unedited.** `seq.test.ts` was
  written representation-blind for this moment; retiring `runtime/SeqCore.hex`
  emptied its `CORE`/`IMPORT` constants and changed nothing else. Laziness,
  short-circuiting, boundaries, the 50k constant-stack run, and persistence all
  hold against the prelude record.

**Review corrections (Fable, PR #91).** Three landed in the PR. **Defect 14
(F1, blocking):** the synthesized prelude import chose its local against a
*list* of binder forms, so a named import, a constraint member, an extern
declaration, or a pattern binder of the same name redeclared the identifier —
clean compile, `SyntaxError` at load, and reachable from a bare field call with
no prelude spelling in the source. The local is now chosen in `#preludeImport`,
after resolution, against a set closed by construction (every name `#declare`
produced, plus every import local). **Defect 12 widened (F2):** the divergence
covers parameter and result positions of exported functions too, and Part 7 §7
occasion 1 makes the parameter wrapper *decided* spec rather than merely
undelivered — so the ruling now has a larger, more constrained statement to
answer. **F3:** the adapter's `done` check was strict equality, not §7.2's
boolean coercion; `{ done: 1 }` terminates native iteration and looped here. The
adjacent object-result check §7.2 requires in the same sentence landed with it,
and §3's no-speculative-acquisition guarantee is now stated in the helper.
**Defect 15 (F4, logged not fixed):** the adapter does not memoize a forcing
failure, against §7.1 — pre-existing in the intrinsic helper, carried into the
R1 pair.

**Two findings from the implementation, both logged.** Defect 11 — a **constraint member** could not
occlude a prelude value, the same asymmetry defect 9 fixed for `let`, at a binder
form that fix did not reach; fixed here. Defect 13 — an unsupported companion
operation with a literal argument **crashes the compiler**; pre-existing on
`main`, unrelated, logged not fixed.

**One thing deliberately not delivered, and it needs a ruling: defect 12.** FFI
Part 3 §9.1 says an exported Hexagon `Seq` is a replayable JavaScript iterable.
Under the intrinsic that held for free because a `Seq` *was* an iterable; it is a
record now and nothing replaced it, while the `.d.ts` face is still
`Iterable<a>`. It is not a one-line fix: an emitted ESM binding is
simultaneously the Hexagon and the JavaScript interface, so Part 7 §7's
export-wrapper mechanism would break Hexagon importers of `Seq.map`. The three
candidate answers trade FFI Part 3 §9.1, Part 7 §6, ruling R1's "sole
constructor" clause, and per-step allocation cost against each other. `Seq` is
the pilot `Vector`/`Set`/`Map` inherit, so the guess would be inherited three
more times. Current behaviour is pinned in both halves so any answer breaks the
test deliberately. See defect 12 for the full statement.

*(Step 8's original entry follows.)*

*(Step 7's original entry follows.)*
`stdlib/Seq.hex` is written and validated, and a **prerequisite defect found by
attempting the join is fixed** (defect 9: a module-level `let` could not occlude
a prelude value — `Seq.hex` is the first prelude module to export lowercase
names, so §5.4's guarantee had never been exercised for values). All three of
step 7's asks were confirmed real rather than assumed: the `emptyCore`/`empty`
split collapses, and both the defect-1 and defect-2 workarounds revert. The whole
representation-blind behavioural suite passes against the new file unchanged.

**`Seq.hex` has not joined `PRELUDE_MODULES` yet, deliberately.** Joining it was
tried, and the result is informative: with defect 9 fixed, the entire suite
passes except `stdlib/Vector.hex`'s `toSeq`/`fromSeq`, whose `Seq(a)` annotation
now means the record while the intrinsic they delegate to still yields the
intrinsic. That single failure is step 8 stated as a test. Joining before step 8
would leave the two coexisting under one name — the half-unified state Phase 2's
carry-forward warned about — so the membership commit belongs with the repointing.

**The blocking question (for Fable).** Step 8 says the `toSeq`-family emissions
"construct or consume the record via the runtime bridges". A record emits as a
plain object, but `Option` emits as *constructors imported from `./Option.js`* —
so such a bridge would hardcode the prelude's runtime representation into
compiler-owned helper strings, which no helper does today. The alternative is
that the expressible conversions become ordinary `.hex`: `toSeq` over
`Seq.unfold`, `fromSeq` over `Seq.fold`, with no bridge at all. **Verified: that
version typechecks.** stdlib-roadmap §5 item 6 appears to settle the direction —
"public declarations and Hexagon-expressible behavior live in canonical `.hex`
source; only irreducible operations cross the private boundary" — and §5.1's
`Seq.hex` row names what is retained as exactly the memoizing spine, `memoize`'s
buffer, and the FFI Part 3 / `toJsIterable` bridges. What still needs a ruling is
where the line falls for the cases doctrine pulls the other way on: `Map`/`Set`
traversal, which §5 item 3 keeps "over a retained tuned HAMT core", and the
`for x in` desugaring, which §5's closing paragraph makes a compiler
responsibility. Step 8's shape depends on that line.

7. **Write `stdlib/Seq.hex`** from `runtime/SeqCore.hex`: rename
   `SeqCore`→`Seq`; **revert the defect-1 workaround** (`(source.pull)()` →
   `next(source)` in recursive bodies — home-module code may still use `pull`
   where it is genuinely wanted, but the protocol call is the canonical form);
   **revert the defect-2 workaround** (restore `Some((value, rest))` arms);
   keep the local-`let` step form (the layout observation, finding 5, is
   unruled — the local binding is acceptable house style meanwhile); add the
   §5.5 header comment; no import lines. Declaration becomes
   `export opaque record Seq(a)`. Join `PRELUDE_MODULES` after `Option.hex`.

   *(Amended after PR #86.)* The `emptyCore`/`empty` split was forced by the
   capture-penalty bug (defect 1) expressing through the annotation, not by
   rigid-export semantics: defect 7's fix aligns captured with uncaptured, and an
   annotated value-`let` generalizes in both. At Phase 4, first test whether a
   single `export let empty: Seq(a) = Seq({ pull = () => None })` compiles and
   serves every internal use; if it does, ship that and delete the split and its
   comment — the prelude is exemplary code and must not carry a workaround for a
   fixed bug.
8. **Repoint the producers.** Checker: the intrinsic `kind: "Seq"` sites route
   to the prelude record's reserved identity — the producers are
   `Map.keys`/`values`/`entries`/`toSeq`, `Set.toSeq`, `Vector.toSeq`/`fromSeq`,
   and the `for x in` desugaring. Emitter: `toSeq`-family emissions construct
   or consume the record via the runtime bridges; the `.d.ts` face of `Seq(a)`
   stays `Iterable<a>` at boundary positions (FFI Part 3 — the bridges own it;
   internal opacity and the boundary face are independent, both decided).

   *(Amendment, Fable, PR #85 review finding F1.)* Beyond the producers, the
   **compiler-known operation family is deleted, not repointed**: the resolver's
   `SeqOperation` special case (`Seq.iterate`/`map`/`filter`/`take` when `Seq`
   is unbound, resolver.ts:1165), the checker's `#seqOperationType` shape and
   the `#seqDotCalls` dot-call path (checker.ts:190/:1254), and the emitter's
   `SeqOperation` lowerings. The same source spellings must keep compiling with
   identical types through the ordinary companion-dispatch path against prelude
   `Seq.hex` — pin them with conformance tests *before* deleting the special
   case.
9. **Delete** the intrinsic `Seq` type-kind and `runtime/SeqCore.hex`; port the
   conformance suite from `SeqCore`-as-extra-module to prelude `Seq`; keep the
   poison test and the defect reproductions as permanent pins. The suite's
   behavioural assertions (laziness, short-circuiting, boundaries, persistence,
   50k constant-stack runs) must pass unchanged — they were written
   representation-blind for exactly this moment.

## Phase 5 — after

10. **Defect 4** (missing `Num` evidence reaching runtime as `undefined`) —
    independent of this arc, most severe in absolute terms; next after the
    unification lands.
11. **`Vector`, `Set`, `Map`** follow the proven template (ledger §5.2), each
    as its own arc. `Vector`'s extra weight is its syntax surface (literals,
    brackets, slicing, rest patterns). Not this work order.

## Standing verification rules

- The honest-channel protocol applies to every phase: when touching a
  reporting path, write the failing probe first, watch it fail, then fix.
- Each phase is a separately reviewable PR; keep both suites green and `tsc`
  clean at every merge point.
- Self-reports are input to review. The verdict on each phase is Fable's;
  the merge is James's.

## Open, non-blocking

- Layout ruling on multi-line `match` as a record-field value / lambda argument
  (defect log finding 5) — owner: lexer-layout. The local-`let` form stands
  meanwhile.
- Issue filing for defects 1–4/6 on GitHub — James's call; the defect log is
  the canonical record either way.
