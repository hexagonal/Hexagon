# Hexagon Spec Roadmap

**Status:** Planning note (July 2026) — snapshot after Pattern Matching; **updated July 2026** after Declarations Preamble, Modules, and Collections Part 1 decisions landed, and to log the §5 binder-class correction to the Statements spec (see "Pending cross-spec edits").
**Purpose:** Inventory of remaining language-definition specs with their recorded debts, and a recommended sequencing. Update as specs land; each completed spec should strike its entry and migrate any newly-discovered debts.

**Filed to date:** Primitive Types, Numeric Literals, Functions, Type System Overview, Products, Lexer & Layout, Unions, Constraints, Exceptions, Statements/Blocks/Mutability (§5 revised July 2026), Loops/Ranges/Iteration, Operators/Logic/Precedence, Comments, Integral Constraint, Division & Remainder, Decisions Batch 2026-07, Pattern Matching, **Declarations Preamble**, **Modules**, **Collections Part 1 decisions** (parts 2–5 outstanding).

---

## Tier 1 — Blocking v1 (core language cannot close without these)

### 1. Modules — **LANDED** (modules.md, July 2026)
All listed debts discharged there (qualification, constraint-member namespacing, prelude-occlusion rule retiring Statements §10.2, orphan rule's "home module"). Hanging: package/bare-specifier resolution, re-exports, `opaque` `.d.ts` (→ FFI).

### 2. Declarations preamble — **LANDED** (declarations-preamble.md, July 2026)
Header grammar, `type` aliases, `derives` placement: all discharged.

### 3. Collections — **IN PROGRESS** (Part 1 decisions filed; parts 2–5 per collections-roadmap.md)
- `List(a)`: representation (plain JS arrays presumably; immutability story needs deciding) and API surface.
- `Concat<List>` (Operators §7 owes it).
- Indexing/slicing partiality restatement (Decisions Batch §5.4); negative-index confirmation (presumed absent).
- `Map` / `Set` — ship or defer.
- **List patterns** (`[]`, `[a, b]`, head/rest) — the one hole the Pattern Matching spec knowingly left (its §11.1); this spec owns them as its integration with the pattern grammar.
- `Seq` user-facing API beyond what Loops fixed.

### 4. FFI / extern
- `JsValue`: final name and accessor set (Exceptions §10.2 owes `JsError.message`, `JsError.stack` at minimum).
- `Nullable(T)` ↔ `Option` conversions.
- `extern` declaration syntax; type mapping at the boundary beyond what `.d.ts` emission implies.
- Union-representation stability contract for JS consumers — the all-nullary representation cliff documentation (Unions §6.2 promised it).

---

## Tier 2 — Needed for a usable v1, not core semantics

### 5. Stdlib listing
Consolidation debt; many specs point at it: `Ordering`, `ignore`, `Result.attempt`, `Int.div`/`Int.mod` final form (deep-dive owed — Operators §14.3a reopened floored vs Euclidean), `Float` instance semantics, `Range` `Eq`/`Show` (Loops §3.6 still open), `throw`, `Show` instances, subject-first convention enforcement, `memoFix` / open-recursion patterns.

### 6. Full lexer
Lexer & Layout covers layout; remaining crumbs:
- Interior tabs / tabs-after-code (Decisions Batch §9.2 left to this spec; recommendation on record: legal but formatter-normalised).
- Complete keyword table — now including `when`, pattern-position `as`, reserved `finally`.
- Identifier and escape minutiae.

### 7. Program structure / entry point
Never touched anywhere: what a Hexagon program *is* — main function? top-level effects? module initialization order? Small, but required before `hexc` can emit a runnable artifact.

---

## Tier 3 — Explicitly deferred (v2 / on-demand; recorded, not owed for v1)

- **Associated types / user-facing `Iterable`** — v2 on first demand (Decisions Batch §6); calibration wants a specimen. `AsyncSeq` does *not* depend on it.
- **Async / `AsyncSeq`** — committed direction, own spec; promise-rejection channel flagged by Exceptions §10.3.
- **`break` / `continue` deep-dive** — owed from the loops session ("not yet, prove the need").
- **Generators / `yield`** — explicitly deferred.
- **`finally`** — deferred with the resource-management questions (Exceptions §10.1); keyword reserved.
- **BigInt** full treatment — opt-in type, deferred from v1 core.
- **Pattern-spec deferrals** — range patterns (guards cover it), named-slot constructor patterns, string prefix patterns (not planned), closed-record patterns (evidence-gated).

---

## Pending cross-spec edits (apply on next touch of each doc)

### From the Statements §5 correction (July 2026): `let`-pattern binders are sequential
External review (July 2026) caught §5's enumeration misclassifying `let`-destructuring names as head binders — contradicting §5's own definition and permitting silent rebinding (`let x = 10; let (x, y) = getPair()`). Corrected in statements-blocks-mutability.md §5/§5.4: binder class is decided by the proper-subterm criterion (positional), not by pattern-ness; every name a `let`/`var`/`fun` LHS binds is sequential. Rejected alternative (state-threading idiom) recorded in §5.4; `var`-destructuring pressure logged as Statements §10.6. Statements §9.2 items 5–8 carry the full edit text; owed to:

- **pattern-matching.md** — companions line, §6.3, §14.4 discharge wording, decisions-log row "All pattern binders are head binders."
- **products.md §2.4** — destructuring classification cross-reference.
- **modules.md §10** — new near-miss diagnostic: uppercase binder-position name matching a module alias → "`Json` is a module alias; binders are lowercase — did you mean `json`?"
- **hexagon-for-typescript-coders.md** — destructuring chapter: `const { name } = user` shadowing is TS muscle memory; the Hexagon `let` form errors; rename with `{name: n}` or use a match/lambda-head position.

Also noted for the record: the reviewer's proposed "module aliases must be unshadowable" restriction was rejected as unnecessary — the uppercase case rule already forecloses it structurally. The adjacent real hazard (module alias vs *nullary constructor* coexistence) is already the Modules §5.2 v2 candidate; the review counts as one datum toward it.

---

## Recommended order and rationale

~~Declarations preamble → Modules →~~ **Collections (parts 2–5) ⇄ FFI** (Collections Part 1 has already edited the FFI agenda; either order now works — per collections-roadmap.md), with the Stdlib listing accreting alongside, and Full Lexer + Program Structure slotted wherever convenient (both are small and nearly dependency-free).

Rationale (original, preserved): the preamble unblocked header-grammar questions; Modules was the biggest unknown and both collections and FFI cite it (orphan rule, qualification). Collections-before-FFI was preferred because list patterns and `List` representation inform the boundary contracts, but Part 1's decisions (Hexagon-owned persistent vector; `Array(a)` as readonly foreign-door type) have de-coupled the ordering. This preserves the property that made past sessions smooth: each spec's dependencies are decided before it needs them.
