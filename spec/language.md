# Hexagon — Core-Language Router

**Status:** Decided and promoted after Sol review (July 2026), per `notes/v1-spec-consolidation-plan.md` Part 3. This is a conceptual map and ownership router, not a specification: focused specifications own every language rule and win on divergence. Corpus entry point: `README.md`.

## 1. Orientation

Hexagon is an ML-family language designed to produce readable JavaScript and accurate TypeScript declarations; functions, data, modules, emission, and the JS boundary are owned respectively by `functions.md`, `products.md` / `unions.md`, `modules.md`, feature-specific emission sections, and `ffi.md`. This file supplies a reading path only.

## 2. Dependency and reading order

1. **Lexical structure** — `lexer.md`, `lexer-layout.md`, `comments.md`, `numeric-literals.md`
2. **Declarations** — `declarations-preamble.md`, `functions.md`, `statements-blocks-mutability.md`
3. **Name resolution and modules** — `modules.md` §5; dot-call resolution belongs to `method-syntax.md`
4. **Types and data** — `primitive-types.md`, `products.md`, `unions.md`, `rat.md`
5. **Constraints** — `constraints.md`, `integral-constraint.md`, `collections-part2-hash-and-type-members.md`
6. **Control flow and calls** — `operators-logic-precedence.md`, `pattern-matching.md`, `exceptions.md`, `loops-ranges-iteration.md`, `division-remainder.md`, `method-syntax.md`
7. **Collections** — `collections-part1-decisions.md` through `collections-part5-iterable.md`; Loops owns base iteration semantics, while Collections Part 5 owns the finalized and user-opened `Iterable` instance table
8. **Runtime representation and emission** — representation/emission sections in the owning feature specs, routed below
9. **FFI** — enter through `ffi.md`, never by loading every part

## 3. Ownership router

| Area | Questions routed here | Normative owner(s) |
|---|---|---|
| Lexical structure | tokens, literals, comments, layout, separators | `lexer.md`; `lexer-layout.md`; `comments.md`; `numeric-literals.md` |
| Declarations and local scope | declaration forms, functions, binders, blocks, mutation | `declarations-preamble.md`; `functions.md`; `statements-blocks-mutability.md` |
| Names and modules | namespaces, imports/exports, visibility, module graph, ordinary qualification | `modules.md` |
| Types and data | primitives, tuples, records, rows, nominal data, unions, exact rationals | `primitive-types.md`; `products.md`; `unions.md`; `rat.md` |
| Constraints | declarations, instances, coherence, dictionaries, type members | `constraints.md`; `integral-constraint.md`; `collections-part2-hash-and-type-members.md` |
| Control and calls | operators, patterns, exceptions, loops, division, companion dot calls | `operators-logic-precedence.md`; `pattern-matching.md`; `exceptions.md`; `loops-ranges-iteration.md`; `division-remainder.md`; `method-syntax.md` |
| Collections | shared doctrine and the `Vector`, `Map`, `Set`, and `Iterable` components | `collections-part1-decisions.md` through `collections-part5-iterable.md` |
| Representation and emission | runtime shapes and emitted JavaScript for each feature | `functions.md`; `products.md`; `unions.md`; `exceptions.md`; `modules.md`; Loops and Collections owners; `ffi.md` for boundary-visible forms |
| FFI | boundary terminology, ownership routing, faces, and conformance | `ffi.md` |

## 4. Navigational vocabulary

| Term | Use when navigating | Current owner |
|---|---|---|
| layout / VSEP | lexical block structure | `lexer-layout.md` |
| head / sequential binder | scope classification | `statements-blocks-mutability.md` §5 |
| value restriction | generalisation boundary | `functions.md` §8 |
| row polymorphism | structural-record typing | `products.md` §4 |
| companion module | type-operation qualification | `modules.md` §5.3 |
| dot call / `DotCall` goal | type-directed companion-call resolution | `method-syntax.md` |
| Deferred-Goals Doctrine | postponed inference decisions | `method-syntax.md` §10 *(interim owner)* |
| `honor` / coherence | constraint-instance system | `constraints.md` |
| accessor pair | shared indexed/keyed-access doctrine | `collections-part1-decisions.md` §3.3 |
| `Seq` persistence | sequence-position model | `loops-ranges-iteration.md` §6 |
| Rewrite Rule | corpus-wide diagnostic doctrine | `decisions-sol-review-2026-07.md` §E *(interim owner)* |
| trusted boundary | foreign-declaration contract | `ffi-part1-boundary.md` §1; routed by `ffi.md` |

The canonical namespaces are **terms, types, constraints, and module aliases**; constructors inhabit the term namespace (`modules.md` §5).

## 5. Ownership boundaries

| Boundary question | Owner |
|---|---|
| What source form exists? | lexical/declaration spec plus the feature owner |
| What does a name denote? | `modules.md`; `method-syntax.md` for dot-call resolution |
| Is a program well typed? | the relevant type/data owner plus `constraints.md` where required |
| What runtime form or JavaScript is emitted? | the feature's representation/emission section |
| What is visible across the JavaScript boundary? | `ffi.md` and the part it routes to |
| Which library operations ship? | pending `stdlib-roadmap.md`, constrained by the owning language specs |

## 6. Outstanding work

Language, package, and post-v1 work routes through `spec-roadmap.md`. Stdlib-owned work will route exclusively through `stdlib-roadmap.md` after consolidation Part 4; until then its approved inventory is `notes/v1-spec-inventory.md` §3.3. This router owns no debt or deferral list.
