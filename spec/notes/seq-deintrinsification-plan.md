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

## Phase 3 — prelude mechanism (Modules §5.5)

5. **Ordered intra-prelude visibility.** Today prelude scope reaches only
   non-prelude modules; extend it so each prelude module sees the members
   *before it* in `PRELUDE_MODULES`, and only those. Test: a prelude module
   using `Option` with no import line compiles; a prelude module referencing a
   *later* member fails.
6. **Drift guard.** The embedded-copy-matches-`stdlib/` test extends to
   `Seq.hex` when it joins the set.

## Phase 4 — `Seq.hex` and the unification

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
   single `export let empty: Seq(a) = Seq({ pull: () => None })` compiles and
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
