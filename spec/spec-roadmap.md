# Hexagon Spec Roadmap — Remaining Work

**Status:** Planning note (July 2026), rewritten at consolidation Part 5 (`notes/v1-spec-consolidation-plan.md`) as a **remaining-work router**. Completed components route through the canonical indexes; stdlib-owned work routes exclusively through `stdlib-roadmap.md`; this file lists only what is still open, with owners. It decides nothing.

## 1. Completed (pointers, not narratives)

- **Core language** — every focused spec Decided; ownership map and reading sets: `README.md`; conceptual router: `language.md`.
- **Collections Parts 1–5** — complete; owners per `README.md` (`collections-roadmap.md` retired to history).
- **FFI Parts 1–12 + Foreign Enums** — complete; canonical entry point, invariants, and conformance: `ffi.md`.
- **Lexer & Layout** — complete; compiler passes implemented (`lexer.md`, `lexer-layout.md`).
- **Program structure / entry point** — closed by `modules.md` §8.3: selected root modules run through ordinary ESM evaluation; no special `main`.

## 2. Active v1 sequence (ordered; the order is deliberate)

1. **Finish the corpus consolidation** — `notes/v1-spec-consolidation-plan.md` Parts 6–9 (focused-spec canonicalization, historical archive, reconciliation audit, Sol closeout). Parts 1–5 are done (inventory, `README.md`, `language.md`, `stdlib-roadmap.md`, this rewrite).
2. **Implement the promoted v1 `Rat` specification in the stdlib listing** — `rat.md` now fixes the `BigInt` representation, canonical normalization, minimum companion surface, instances, emission boundary, and acceptance tests. Euclidean division and `Integral` remain its load-bearing foundations (`division-remainder.md`; `integral-constraint.md`). V1 decimal literals remain governed by `numeric-literals.md`; no literal polymorphism is implied.
3. **Close the stdlib listing against `stdlib-roadmap.md`** — the sole global ledger. All obligations, ship/defer questions, and post-v1 candidates (including the `Rat` ledger row) live there and are not reproduced here.

## 3. Language and package deferrals (v2 / on-demand; recorded, not owed for v1)

| Deferral | Owner / revisit bar |
|---|---|
| Implied types — v2 remainder (deferred `Item(α)` goals, `Item(c)` syntax, obligations on type members, generic `Iterable` binders); restricted concrete user `Iterable` **shipped in v1**; `derive via` pre-registered as user-`Hash` candidate | `decisions-batch-2026-07.md` §6 as amended by `collections-part1-decisions.md` §6.4; `collections-part2-hash-and-type-members.md` §11; v2 on first demand |
| Async / `AsyncSeq` — committed direction, own spec; independent of implied types | promise-rejection channel flagged in `exceptions.md` §10 item 2; boundary constraints routed by `ffi.md` §9.2 |
| `break` / `continue` deep-dive | `loops-ranges-iteration.md` §9 item 4 (field evidence; "prove the need") |
| Generators / `yield` | `loops-ranges-iteration.md` §11 item 3 (own coroutine spec if revisited) |
| `finally` / resource management; keyword reserved | `exceptions.md` §10.1 |
| Pattern-spec deferrals — range patterns (guards cover it), named-slot constructor patterns, string prefix patterns (not planned), closed-record patterns (evidence-gated) | `pattern-matching.md` |
| Package system — bare-specifier resolution, lockfile story, re-exports, cross-package coherence/interface files, dictionary-ABI metadata, runtime-subpath layout | `modules.md` §12.1–12.2; `ffi-part9-exported-dictionaries.md` §11/§13.3 |
| Flow-sensitive narrowing — language/type-system deep dive with the recorded comparison bar | `ffi-part2-nullable-array.md` §2.5 |
| Module-alias vs nullary-constructor coexistence (Elm-strict) — v2 candidate on field evidence; the Statements-§5 review counts as one datum | `modules.md` §5.2 |
| Future numeric systems and hierarchy stress test — Complex numbers and matrices; discussion may happen before v2, implementation is unscheduled | §3.1 below |
| FFI-owned deferrals (async callbacks and adapters, mutable/weak foreign collections, generic externs, overloads/rest, globals/CommonJS, unsafe casts, …) | routed wholesale by `ffi.md` §9.2 — not re-listed here |

### 3.1 Future numeric systems and hierarchy stress test

Complex numbers and matrices are recorded as future numeric-system candidates, possibly
after v2. They are not implementation commitments, but they participate in any earlier
discussion of the `Num` → `Signed` → `Frac` hierarchy because they expose assumptions
that the primitive types do not. The public constraint spelling under discussion is
**`Frac`**, consistent with `Eq`, `Ord`, and `Num`; do not expand it to `Fractional`.

This grid records questions for that discussion, not current or promised instances:

| Candidate type | `Num` | `Signed` | `Frac` | `Integral` | `Ord` |
|---|---:|---:|---:|---:|---:|
| `BigInt` | yes | yes | no | yes | yes |
| `Rat` | yes | yes | yes | no | yes |
| `Float` | yes | yes | yes | no | yes |
| `Complex(a)` | if `a` supports it | if `a` supports it | possibly | no | no |
| square `Matrix(n, a)` | if `a` supports it | if `a` supports it | generally no | no | no |
| rectangular `Matrix(r, c, a)` | generally no | generally no | no | no | no |

Design guards for the eventual discussion:

- `Signed` must not extend `Ord`: Complex supports negation and subtraction without a
  natural total order.
- `abs` need not return the subject type: a Complex magnitude is scalar.
- `Num` must not promise commutative multiplication: square-matrix multiplication is
  noncommutative.
- Square matrices may fit the closed `Num`/`Signed` hierarchy when their elements do,
  but are not generally `Frac` because inversion is partial.
- Rectangular matrix multiplication changes dimensions and belongs in explicit
  companion operations rather than a closed same-subject `Num` member.
- The hierarchy fails this stress test if it must invent an ordering for Complex,
  pretend matrices are always divisible, or fragment every arithmetic operation into
  its own constraint.

## 4. Pending cross-spec edits (compressed; full edit text lives with the owner)

Per the house convention (README authority rule 4), pending notes live in their originating documents and are applied at consolidation Part 6. The remaining ripple large enough to track here:

- **Statements §5 correction** (`let`-pattern binders are sequential) — owner: `statements-blocks-mutability.md` §5/§5.4, full edit text in its §9.2 items 5–8; targets: `pattern-matching.md`, `products.md` §2.4, `modules.md` §10 (near-miss diagnostic), `notes/hexagon-for-typescript-coders.md`.

The complete pending-note registry, per originating document, is `notes/v1-spec-inventory.md` §3.2 (approved; consumed by Part 6).

## 5. After v1

Post-v1 stdlib candidates live in `stdlib-roadmap.md` §4; language/package v2 items live in §3 above with their owners. Nothing else is on the roadmap.
