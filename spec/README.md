# Hexagon Specification Corpus — Canonical Index

**Status:** Decided and promoted after Sol review (July 2026), per `notes/v1-spec-consolidation-plan.md` Part 2 and the approved Part 1 inventory (`notes/v1-spec-inventory.md`). This is the entry point for the whole corpus: authority rules, the ownership map, and minimal reading sets. It states no language rule and summarizes none.

## Authority rules

1. **The focused specifications below are normative.** This index and the router files only navigate; where an index and an owning spec appear to disagree, the owning spec wins.
2. **Archived notes are non-normative.** Everything under `notes/archive/` (populated in consolidation Part 7) is drafting history: excluded from default reading sets, unable to override any promoted spec. Until Part 7 lands, files marked *historical* in the inventory have the same standing in place.
3. **Cross-cutting closure documents** (`decisions-batch-2026-07.md`, `decisions-sol-review-2026-07.md`) are **authoritative until consolidated into their host specs**; where a host has not yet applied a recorded decision, the closure document governs.
4. **Edit-note convention:** a cross-spec correction is recorded as an *edit note in the originating document* and applied on next touch of the target; until applied, the originating document governs that point.
5. **Section numbers are stable forever.** Specs never renumber; they append, or add correction records / review-resolution sections that supersede the text they annotate in place.
6. **The Rewrite Rule** is doctrine corpus-wide. Its current owner is `decisions-sol-review-2026-07.md` §E; it is slated for a permanent host during consolidation. This index does not restate it.

## Live corpus ownership map

Every normative owner appears exactly once. The explicitly marked router and guide rows are live navigation material, not authorities.

| Area | File | Owns |
|---|---|---|
| Lexical | `lexer.md` | tokens, literals lexically, strings, comments interface |
| Lexical | `lexer-layout.md` | layout, blocks, `;`, indentation rules |
| Lexical | `comments.md` | comment forms |
| Lexical | `numeric-literals.md` | numeric literal grammar, defaulting |
| Declarations | `declarations-preamble.md` | declaration forms, headers, order-insensitivity |
| Declarations | `functions.md` | lambdas, `let`/`fun`, arity, application, generalization, function emission |
| Declarations | `statements-blocks-mutability.md` | statements, blocks, `var`/mutability, binder classes |
| Declarations | `modules.md` | files-as-modules, import/export, visibility, acyclicity, ESM emission |
| Router | `type-system-overview.md` | non-authoritative legacy orientation; superseded by `language.md` at Part 3 |
| Types | `primitive-types.md` | `Int`/`Float`/`BigInt`/`Bool`/`String`/`Unit`, `Show`/display |
| Types | `products.md` | tuples, structural/nominal records, rows, field access |
| Types | `unions.md` | `union` declarations, `match` surface, representations |
| Types | `integral-constraint.md` | the `Integral` constraint |
| Types | `rat.md` | exact `BigInt`-backed rational values |
| Types | `constraints.md` | constraints, `honor` instances, coherence, dictionaries, defaults |
| Control | `operators-logic-precedence.md` | operator inventory, precedence, pipe, `if/then/else`, bracket grammar |
| Control | `pattern-matching.md` | patterns, exhaustiveness, binders |
| Control | `exceptions.md` | `exception`, `throw`, `try`/`catch`, `JsError`, branded representation |
| Control | `loops-ranges-iteration.md` | `for`/`while`, `Range`, `Seq` semantics, `Iterable` machinery |
| Control | `method-syntax.md` | dot calls, `CompanionOf`, DotCall goals, Deferred-Goals Doctrine (interim host) |
| Control | `division-remainder.md` | division/remainder/modulo semantics |
| Collections | `collections-part1-decisions.md` | foundational decisions: `Vector` choice, naming doctrine, accessor pair |
| Collections | `collections-part2-hash-and-type-members.md` | `Hash`, constraint `type` members |
| Collections | `collections-part3-vector.md` | `Vector(a)` full spec |
| Collections | `collections-part4-map-set.md` | persistent `Map`/`Set`, brackets/`KeyError`, JS-boundary semantics |
| Collections | `collections-part5-iterable.md` | user `Iterable`, instance table, `String` iteration, closeout |
| Closure docs | `decisions-batch-2026-07.md` | six cross-spec decisions (incl. SameValueZero `Eq<Float>`) until hosted |
| Closure docs | `decisions-sol-review-2026-07.md` | seven review resolutions (incl. Rewrite Rule §E) until hosted |
| FFI | `ffi.md` | **FFI entry point**: index, terminology, invariants, conformance (Part 12) |
| FFI | `ffi-part1-boundary.md` | boundary doctrine, categories, master type table |
| FFI | `ffi-part2-nullable-array.md` | `Nullable`, `NullableCase`, borrowed `Array` |
| FFI | `ffi-part3-seq.md` | `Seq` boundary adaptation and export |
| FFI | `ffi-part4-extern-bindings.md` | `extern from`/`import`, bindings, `type`, `default` |
| FFI | `ffi-part5-extern-classes.md` | `method`/`get`/`set`, `extern class`, receiver wrappers |
| FFI | `ffi-part6-functions-callbacks.md` | calling convention, arity, `Unit`, callbacks |
| FFI | `ffi-part7-exports.md` | export correspondence, `.d.ts`, opaque brands, constructors |
| FFI | `ffi-zero-cost-fundamental-exports.md` | fundamental specializations (Algorithms S/G/N), ABI events |
| FFI | `ffi-part9-exported-dictionaries.md` | dictionary types, evidence handles/factories, dictionary ABI |
| FFI | `ffi-part10-js-map-set.md` | borrowed `JsMap`/`JsSet`, brackets, conversions |
| FFI | `ffi-part11-js-value-errors.md` | `JsValue`, `kind`, strict decoding, `JsConversionError`, paths |
| FFI | `ffi-foreign-enums.md` | `extern enum` |
| Routers | `spec-roadmap.md` | remaining work, deferrals, pending cross-spec edits (Part 5 target) |
| Guides | `notes/hexagon-for-typescript-coders.md` | active reader guide (supporting, non-normative) |

The canonical routers `language.md`, `spec-roadmap.md`, and `stdlib-roadmap.md` are
promoted. Newly discovered stdlib debt is recorded only in `stdlib-roadmap.md`.

## Minimal reading sets

Load the set for the task; add files only when a cited section demands it. `ffi.md` §4 routes within the FFI without loading all parts.

| Task | Read |
|---|---|
| **Parser** | Base: `lexer.md`, `lexer-layout.md`, `comments.md`, `declarations-preamble.md`, `functions.md` §3–§5, `operators-logic-precedence.md`, `pattern-matching.md` (grammar), `statements-blocks-mutability.md`; add the ownership-map file for the feature syntax being changed (FFI syntax routes through `ffi.md`) |
| **Resolver / checker** | `declarations-preamble.md`, `functions.md`, `statements-blocks-mutability.md`, `modules.md`, `products.md`, `unions.md`, `constraints.md`, `integral-constraint.md`, `method-syntax.md`, `pattern-matching.md`, `numeric-literals.md` (defaulting), closure docs (rules not yet hosted) |
| **Emitter** | `functions.md` §9, `unions.md` §6, `products.md` (representation), `exceptions.md` §7, `modules.md` §11, `loops-ranges-iteration.md`, `collections-part3-vector.md` / `collections-part4-map-set.md` (emission notes), `ffi.md` + owning parts per feature (especially Parts 7–9) |
| **Modules work** | `modules.md`, `declarations-preamble.md`, `constraints.md` §5 (coherence/orphans), `ffi-part4-extern-bindings.md`, `ffi-part7-exports.md` |
| **Collections work** | `collections-part1-decisions.md` through `collections-part5-iterable.md`, `loops-ranges-iteration.md`; for the JS boundary add `ffi-part10-js-map-set.md` |
| **FFI work** | `ffi.md` first, then the owning part(s) via its §4 router; `exceptions.md` §6–§7 and `modules.md` §11 as cited |
| **Stdlib work** | `collections-part1-decisions.md` §3 (naming/accessor doctrine), `collections-part5-iterable.md` §10, `method-syntax.md` §4/§15 (dot-callability constraints), `ffi.md` §9.1, `stdlib-roadmap.md` *(pending)*; prelude rules in `modules.md` §6 |
| **Documentation work** | `notes/hexagon-for-typescript-coders.md`, `type-system-overview.md` *(orienting, stale — prefer `language.md` once it lands)*, `spec-roadmap.md`, this file |

## Historical material

Superseded roadmaps, proto-specs, reviews, and imported chats identified by the approved inventory move to `notes/archive/` in consolidation Part 7. They are non-normative, excluded from every reading set above, and may never override a promoted specification; consult them only to research how a decision was reached.
