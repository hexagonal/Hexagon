# V1 Spec Corpus Inventory (Consolidation Part 1)

**Status:** Reviewed and approved by Sol (July 2026). Drafted per `v1-spec-consolidation-plan.md` Part 1, then corrected at the gate for already-applied FFI closeout edits, the orienting status of `type-system-overview.md`, and archive safety of the raw collections chat. **Inventory only** — no source spec was modified, no contradiction resolved, no prose rewritten. Method: status-line sweep of all 52 files; targeted searches (`Status`, `next touch`, `edit note`, hanging/open-question headers, `owed`, `provisional`, `TODO`); full bodies consulted only to resolve hits. §7 lists what was *not* fully audited.
**Classes:** N = canonical normative · R = canonical router/ledger · S = active supporting note · H = historical.
**Dispositions:** keep · canon = canonicalize (Part 6 pass) · supersede = consolidate into hosts, then archive · archive · review = James/Sol call needed.

---

## 1. Classification and disposition (52 files)

### 1.1 `spec/*.md`

| File | Class | Disposition | Notes |
|---|---|---|---|
| collections-part1-decisions.md | N | canon | decisions doc; §9 hanging (owned elsewhere); §1.3 rename ripple partly pending |
| collections-part2-hash-and-type-members.md | N | canon | §12 hanging; §13 edit notes: `Elem`→`Item` ripple + exceptions §10.4 note pending |
| collections-part3-vector.md | N | canon | §12 hanging; §13 note → products (trailing comma) pending |
| collections-part4-map-set.md | N | canon | §13 hanging; §14 notes → pattern-matching/operators/TS-guide pending; §17 correction records |
| collections-part5-iterable.md | N | canon | §16 notes (loops §5 table, P1/P2/P4 closures, primitive-types §5.1, TS-guide) — verify applied; §18 corrections |
| collections-roadmap.md | H | archive | Completed/historical by own status; home: Parts 1–5 |
| comments.md | N | keep | clean |
| constraints.md | N | canon | **§12 `implement`→`honor` rename ripple corpus-wide still to-do** (8 targets listed there); §9 hanging; own body still spells `implement` |
| decisions-batch-2026-07.md | N (cross-cutting closure) | supersede | "authoritative until consolidated into host specs"; §9 apply-on-next-touch table live; §10 hanging |
| decisions-sol-review-2026-07.md | N (cross-cutting closure) | supersede | same model; **hosts the Rewrite Rule (§E) and bare-call doctrine (§A)** — must gain canonical homes before archive |
| declarations-preamble.md | N | canon | pending notes block (l.234): targets incl. constraints diagnostics; slated to host Deferred-Goals Doctrine (method-syntax §15) |
| division-remainder.md | N | keep | one optional TS-guide note (l.171) |
| exceptions.md | N | canon | §10 hanging (incl. `finally` deferral); §13 prelude additions (`KeyError` from Coll P4); FFI §6.1/§7.5 discharges — verify applied |
| ffi-foreign-enums.md | N | canon (light) | ffi.md §11.2 boundary sentence applied; remove drafting-history scaffolding only |
| ffi-part1-boundary.md | N | canon (light) | Hex-alias closeout applied in §10; §8.1 Loops note marked applied — verify |
| ffi-part2-nullable-array.md | N | canon (light) | §5/§127 **Unions §8 supersession note pending** (→ §5.1 below); §11 open questions: none |
| ffi-part3-seq.md | N | canon (light) | §1 agenda edit note — target now historical, fold; §12 open: none |
| ffi-part4-extern-bindings.md | N | keep | §12 review resolutions retained (Part 6 may fold) |
| ffi-part5-extern-classes.md | N | keep | §13 resolutions retained; embedded provisional-visibility status is *recorded*, not live |
| ffi-part6-functions-callbacks.md | N | keep | §11 open: none; §12 clarifications confirmed |
| ffi-part7-exports.md | N | canon (light) | §10 discharges verified in Modules §11.4, Unions §6.4–§6.5, and Exceptions §7.5; remove applied-note scaffolding only |
| ffi-part9-exported-dictionaries.md | N | keep | §13.3 runtime-subpath layout = representative, owned by package spec |
| ffi-part10-js-map-set.md | N | canon (light) | §10 companion edits verified applied; remove applied-note scaffolding only |
| ffi-part11-js-value-errors.md | N | canon (light) | §10 cross-spec edits applied; global ledger creation is consolidation Part 4, not a missed propagation |
| ffi-zero-cost-fundamental-exports.md | N | canon | §13 recorded tensions (Constraints §6.4, Modules §11.5 wording) — verify reconciled; §17 corrections; §2.2 pre-v1 fundamental-set review = live gate |
| ffi.md | R | keep | Part 12 model file; §10 records applied promotion discharges; Part 4 still creates the permanent stdlib ledger |
| functions.md | N | canon (light) | **stale status style** ("Settled design", no date/convention); content current |
| integral-constraint.md | N | keep | clean |
| lexer-layout.md | N | keep | notes "compiler pass implemented" |
| lexer.md | N | keep | clean |
| loops-ranges-iteration.md | N | canon | §11 hanging (incl. **break/continue deep-dive owed**); §7 still spells `Elem` (P2 renamed `Item` — pending P5 §16 note); §12 lexer note — verify applied |
| method-syntax.md | N | canon | §12 hanging; **§15 pending notes: Preamble to host Deferred-Goals Doctrine; operators/products/modules/constraints/loops one-liners; stdlib inheritances; TS-guide chapter**; §16 correction |
| modules.md | N | canon | §12 hanging (package resolution, re-exports); **header still flags opaque-`.d.ts` as owed to FFI "§11.3"** — discharged by FFI P7; verify + stale §-pointer (§5.2 below) |
| numeric-literals.md | N | keep | clean |
| operators-logic-precedence.md | N | canon (light) | status "Decided (v1)" style variance; §10/§14 inbound notes pending from Coll P4 + method-syntax |
| pattern-matching.md | N | canon | pending-notes block (l.450) live; inbound notes from Statements §5 correction + Coll P4 §14 pending |
| primitive-types.md | N | canon (light) | inbound note from Coll P5 (§5.1 String iteration) — verify applied |
| products.md | N | canon | inbound notes pending: trailing comma (Coll P3), destructuring classification (Statements §5), method-syntax §15 one-liner |
| spec-roadmap.md | R | keep (Part 5 target) | remaining-work + pending-edits router; duplicates Statements §5 ripple list (owner = statements §331) |
| statements-blocks-mutability.md | N | canon | §5.4 correction + pending-notes block (l.331); §10 hanging |
| type-system-overview.md | R (non-authoritative orienting) | supersede after Part 3 | **badly stale**: "Products/Unions (forthcoming)", "owed" rows for long-Decided specs; use as input to `language.md`, then archive (§5.3 below) |
| unions.md | N | canon | **§8 provisional `Option.fromNullable/toNullable` superseded by FFI P2 §5 — note pending** (§5.1); §6.5 constructor-export question answered by FFI P7 — verify applied |

### 1.2 `spec/notes/*.md`

| File | Class | Disposition | Notes |
|---|---|---|---|
| chatgpt-vector-map-set.md | H | archive | reviewed at Sol gate: RRB rejection/linear concat live in Collections P1 §2.2/P3 §8; rejected Ord-tree map and final HAMT rationale live in P1 §4/P4; no unique live obligation |
| collections-part5-review.md | H | archive | Sol review; findings applied via P5 §18 correction records |
| ffi-agenda.md | H | archive | self-marked Completed/historical; home: ffi.md |
| ffi-exported-dictionaries.md | H | archive | self-marked superseded; home: FFI P9 |
| ffi-proto-spec-questions.md | H | archive | self-marked superseded w/ promotion map; home: ffi.md §2 |
| ffi-roadmap.md | H | archive | self-marked Completed/historical; home: ffi.md |
| ffi-zero-cost-primitive-exports.md | H | archive | self-marked superseded; home: FFI P8 |
| hexagon-for-typescript-coders.md | S (active reader guide) | canon (Part 6, last) | **accumulated pending chapters/notes from ≥6 specs** (§3.2); body not audited |
| migration-handoff-queries.md | H | archive (**after** README lands) | hosts the house edit-note convention statement (l.26) — restate in `spec/README.md` (Part 2) before archiving |
| v1-spec-consolidation-plan.md | R | keep | the active plan |
| v1-spec-inventory.md | R | keep | this file |

Counts: 41 `spec/` + 11 `notes/` = 52. N=38 · R=5 · S=1 · H=8. Dispositions: keep 15 · canon 26 (12 light) · supersede 3 · archive 8 (1 gated) · review 0.

---

## 2. Canonical owner for repeated doctrine

| Doctrine | Canonical owner | Restatements / drift risk |
|---|---|---|
| Rewrite Rule (hard error ⇒ named rewrite; no warning tier) | decisions-sol-review §E | cited corpus-wide; **owner is a supersede-class doc — needs a permanent home (Preamble?) before archive** |
| Deferred-Goals Doctrine | method-syntax §10 (interim) | §15 note: move to declarations-preamble on consolidation |
| Trusted boundary / two failure kinds | FFI P1 §1/§3 | all FFI parts restate by citation (ffi.md §5 names owners) |
| Wrapper occasions / stable identity vs fresh adapters | FFI P6 §1 (set); P3 §2.1 (adapters); P7 §7 (emission) | ffi.md §5.3–5.4 |
| Accessor pair (`[]` throws / `get` total) | Collections P1 §3.3 | P3/P4/FFI P2/P10 instantiate |
| SameValueZero `Eq<Float>` | Decisions Batch §1 | **supersede-class owner** — host = primitive-types on consolidation |
| Subject-first convention | Functions §5.4 (record) + Operators §8 (pipe) | method-syntax §4.2 makes it load-bearing |
| Union/exception runtime representations | Unions §6; Exceptions §7 | FFI P7 consumes |
| ESM emission (one module ↔ one ESM; named imports) | Modules §11 | FFI P4/P7 consume |
| `KeyError` declaration | Collections P4 §4.3 (housed in prelude via Exceptions §13) | FFI P10 reuses |
| Nullish idempotency (incl. `Nullable(JsValue)`) | FFI P11 §8 | propagated rule verified in P2 §2.1/§12 |
| FFI terminology set | ffi.md §3 | none permitted |

---

## 3. Active obligations register

### 3.1 Open/hanging questions (live, by carrier)

| Carrier | Items (compressed) |
|---|---|
| constraints §9 | recorded not-decided items (incl. named-instance/newtype pressure family) |
| exceptions §10 | `finally`/resource mgmt (keyword reserved); checked-ness; others |
| modules §12 | package/bare-specifier resolution; re-exports; Elm-strict coexistence (v2); constraint-member selective import; formatter policy |
| loops §11 | **break/continue deep-dive owed**; others recorded |
| method-syntax §12 | constraint-member dot access (expected permanent no); bound methods (no); stdlib inventories; three-spellings watch |
| statements §10 | recorded not-decided items |
| decisions-batch §10 / sol-review hanging | recorded; ride with supersede pass |
| collections P1 §9 / P2 §12 / P3 §12 / P4 §13 / P5 §14 | "owned elsewhere, non-blocking" routers — verify each owner still live during Part 6 |
| FFI parts | none open (P2 §11 / P3 §12 / P6 §11 = closed; P4 §12, P5 §13, P11 §§12–13, ffi.md §§11–12 = resolved records) |
| Language-level deferrals | flow narrowing deep dive (FFI P2 §2.5); async spec (FFI P1 §4.4); v2 items in spec-roadmap |

### 3.2 Pending cross-spec edit notes (origin → target; unapplied or unverified)

| Origin | Targets still owed |
|---|---|
| constraints §12 (**honor rename, v2**) | declarations-preamble, decisions-batch, modules, statements, loops, collections P1, collections-roadmap(→archive n/a), ffi-agenda/spec-roadmap (verify) — **plus constraints' own body** |
| statements §331 + spec-roadmap l.61 | pattern-matching (4 spots), products §2.4, modules §10 (near-miss diagnostic), TS-guide |
| decisions-batch §9 (l.221) | its host-spec application table — until applied, batch governs |
| declarations-preamble l.234 | constraints diagnostics neighborhood + listed targets |
| pattern-matching l.450 block | its listed targets — until applied, doc governs |
| collections P2 §13 | `Elem`→`Item` ripple (P1, loops §7, …); exceptions §10.4 note |
| collections P3 §13 | products trailing-comma rule |
| collections P4 §14 | pattern-matching idiom note; operators §14 bracket-dispatch note; TS-guide Map/Set chapter |
| collections P5 §16 | loops §5 table finalization; P1 §6 normative marks; P2 §8 discharge; P4 closures; primitive-types §5.1; TS-guide `for..in` — **verify which applied** |
| division-remainder l.171 | TS-guide one-liner (optional) |
| method-syntax §15 | preamble (Deferred-Goals host); operators §10/§14; products §3.2/§2.3; modules §5.3/§11; constraints §2.2; loops §7; stdlib listing (3 inheritances); TS-guide chapter; collections dot-spelling examples |
| FFI P2 §5 | **unions §8 supersession** (provisional spellings) |
| FFI P1 §10 / P7 §10 / P10 §10 / P11 §10 / ffi.md §10 | companion propagation verified applied at the Sol gate; Part 4 creates the permanent stdlib ledger, and Part 6 may remove the applied-note scaffolding |

### 3.3 Stdlib debts and candidates (feed Part 4 ledger)

| Item | Status | Source |
|---|---|---|
| Composable `JsValue` decoder family | **v1 obligation** | ffi.md §9.1.1; FFI P11 §9/§13.2 |
| `Rat` focused specification and stdlib module | **v1 obligation** | `BigInt` numerator/denominator representation fixed; Integral Constraint §1/§9; Division & Remainder; James's v1 decisions |
| Qualified homes `NullableCase.*` / `JsKind.*` | **v1 obligation** | ffi.md §9.1.2/§12 |
| `toJsMap`/`toJsSet` classification (cross-realm bar) | ship/defer | ffi.md §9.1.3; P11 §13.1 |
| `JsMap.keys`/`values`; `JsSet` algebra | ship/defer | ffi.md §9.1.4; P10 §9 |
| `Nullable` conveniences / conversion aliases | ship/defer | ffi.md §9.1.5 |
| `getOr(m, k, default)` | candidate | Coll P1 §3.3 |
| `Map.merge` family (+ key-representative rule bound by P4 §5.4) | candidate w/ fixed semantics | Coll P4 §5.3 |
| separator `join` | candidate | Coll P5 §14.2 |
| Seq/collection combinator listing | v1 obligation (inventory) | Coll P5 §10 |
| monomorphic per-type `show`-style companions | decision owed | method-syntax §7/§12.4 |
| subject-first ⇒ dot-callability constraint on all companions | binding rule on listing | method-syntax §15 |
| `Range`/`Seq`/primitive companion inventories | v1 obligation (inventory) | method-syntax §12.3; Coll P5 |
| prelude qualified-home guarantee (`§6.4`) | binding rule | modules §6.4 |
| `Int.fromFloat` etc. numeric narrowing set | candidate | FFI P1 §6 |

### 3.4 Diagnostic / emission / ABI / acceptance duty carriers (owners that must survive consolidation)

| Duty family | Owners |
|---|---|
| Diagnostics checklists | lexer §末, functions §10, unions §9, exceptions §9, modules §10, method-syntax §9, statements, pattern-matching, collections P3/P4 §9, FFI P2 §10, P4 §13, P5 §11, P6 §9, P7 §11, P8 §14, P9 §12, P10 §11, P11 §11; assembled router: ffi.md §7 |
| Emission duties | functions §9, unions §6, exceptions §7, modules §11, lexer-layout, collections P3/P4 §11, FFI P3 §6, P5 §2–§6, P6 §1/§3, P7, P8 §8, P10 §4.2/§6.4 |
| ABI commitments | FFI P8 §9 (+§2.2 pre-v1 set review gate), P9 §11, P7 §4.1 (cliff), foreign-enums §7.3 |
| Acceptance obligations | method-syntax §14, modules §13, foreign-enums §9, FFI P6 §10, P7 §9, P8 §16, ffi.md §8 (10-category matrix); collections P3/P4 §16 |
| LSP obligations | method-syntax §8.4 (normative) |

---

## 4. Two-source disagreements (recorded, not resolved)

All four have a *declared* governing side (pending-note mechanism); none is an undecided dispute, but each is a live textual disagreement until applied:

1. **unions.md §8** (`Option.fromNullable`/`toNullable`) **vs ffi-part2-nullable-array.md §5** (companion-owned `Nullable.*` spellings). P2 declares supersession; Unions text unedited.
2. **loops-ranges-iteration.md §7** (`Elem`) **vs collections-part2 §** (`Item` rename). P2/P5 govern; Loops text unedited.
3. **constraints.md (body, `implement`) vs corpus (`honor`)** — constraints §11 decides `honor`; §12 ripple (incl. its own body) unapplied across 8 files.
4. **type-system-overview.md** ("forthcoming"/"owed" rows) **vs landed corpus** — orienting doc never updated post-landings; governing side = the landed specs.

Possible stale pointer (verify, may be nothing): **modules.md header** says opaque-`.d.ts` "flagged §11.3" while the flag lives in §11 item 4 (cited elsewhere as §11.4) and was discharged by FFI P7 §5 — confirm Sol's application and fix the §-pointer during Part 6.

---

## 5. Archive candidates and the canonical home that makes each safe

| Candidate | Safe-making home | Gate |
|---|---|---|
| collections-roadmap.md | Collections P1–P5 (+P5 §16 closeout) | none — self-marked |
| notes/ffi-agenda.md, ffi-roadmap.md, ffi-proto-spec-questions.md, ffi-exported-dictionaries.md, ffi-zero-cost-primitive-exports.md | ffi.md (index) + owning parts | none — all self-marked |
| notes/collections-part5-review.md | Coll P5 §18 correction records | none |
| notes/chatgpt-vector-map-set.md | Coll P1 §2.2/§4 + P3 §8 + P4 | none — full body reviewed at Sol gate; canonical specs preserve the useful rationale and reject the note's obsolete Ord-keyed proposal |
| notes/migration-handoff-queries.md | conventions → `spec/README.md` (Part 2); items long resolved | **after README states the edit-note convention** |
| type-system-overview.md | `spec/language.md` (Part 3) | **after Part 3 lands**; it is an explicitly non-authoritative orienting predecessor, not a normative source |
| decisions-batch-2026-07.md, decisions-sol-review-2026-07.md | hosts named in their own §9/propagation tables (+Rewrite Rule → Preamble) | **only after Part 6 consolidation applies every row** |

---

## 6. Notes for the Part 2–6 passes (pointers, no design)

- `spec/README.md` (Part 2) must restate: edit-note house convention; stable-§ rule; Rewrite Rule pointer; archive non-normativity.
- Part 4 ledger seeds = §3.3 verbatim.
- Part 5 (spec-roadmap) absorbs §3.1's language deferrals and drops applied pending-edit rows.
- Part 6 dependency order suggestion consistent with plan: preamble/statements/pattern-matching (correction folds) → constraints (+rename ripple) → modules/unions/products → loops/collections → FFI light passes → type-system-overview rewrite-or-archive decision → TS-coders guide last.
- `type-system-overview.md`: use as non-authoritative input to Part 3's `language.md`, then archive after the new router lands; do not canonicalize its stale rules in place.

## 7. Not fully audited (recorded per plan §"stop cleanly")

1. Body of `notes/hexagon-for-typescript-coders.md` (classification from header + inbound-note evidence only). The raw collections chat was fully reviewed at the Sol gate.
2. Whether Sol has applied each non-FFI *verify-applied* item in §3.2 (especially Collections P5 §16 targets). The FFI P7/P10/P11 closeout targets and Method Syntax's extern-nominal coverage were verified at the Sol gate.
3. Per-section confirmation that every collections "hanging question owned elsewhere" row's owner is still live.
4. `book/` directory — outside `spec/`, outside this inventory's mandate.
5. Line-level naming audit outside FFI (ffi.md §12 covered FFI); corpus-wide name audit is Part 8's.
