# FFI Specification Roadmap

**Status:** Completed and historical (July 2026). Parts 1–12 and Foreign Enums are promoted; `spec/ffi.md` is the canonical entry point.

The FFI is deliberately divided into small normative documents. Each drafting pass has one target file. Fable should modify only that file; cross-references, roadmap updates, and propagation into older specifications are Sol's work.

## Drafting rule

For every part, give Fable:

1. this roadmap;
2. `ffi-proto-spec-questions.md` as the decision source;
3. any specifically named supporting note; and
4. the instruction: **write or revise only the target specification file; do not update any other document.**

If a genuine decision is missing, the draft should record it as an open question rather than inventing a rule. Sol and James resolve it before the part is finalized.

## Part 1 — Boundary doctrine and type mapping

**Target:** `spec/ffi-part1-boundary.md`

Specify the trusted, fast boundary; the direct/borrowed/adapted/converted categories; the master Hexagon-to-JavaScript/TypeScript type table; shallow nested conversion; numeric trust; foreign throws; and the `Hex` runtime type namespace.

Do not fully specify `Array`, `Nullable`, or `Seq` here. State their category and link forward to their own parts.

**Status:** Decided and promoted (July 2026).

## Part 2 — `Nullable` and borrowed `Array`

**Target:** `spec/ffi-part2-nullable-array.md`

Specify raw `a | null | undefined` representation, `Nullable.null`, `Nullable.undefined`, inspection and conversion functions including `toCase`; then specify zero-copy readonly arrays, the foreign stability contract, native iteration, shallow element treatment, and explicit copying conversions.

Default parameters and TypeScript-style flow narrowing are outside this part. Record `.toCase` as the preferred Hexagon alternative to narrowing.

**Status:** Decided and promoted (July 2026).

## Part 3 — `Seq` interoperation

**Target:** `spec/ffi-part3-seq.md`

Specify top-level `Iterable<a>` input, persistent memoizing adaptation, replayable exported traversal, iterative rather than recursive implementation, retention behaviour, iterator closure, malformed results, throws, and the v1 restriction on nested adapter-requiring positions.

Single-pass `Iterator<a>`, async iteration, callback-position adapters, and a separate resource-managed stream type are deferred.

**Status:** Decided and promoted (July 2026).

## Part 4 — Extern modules and bindings

**Target:** `spec/ffi-part4-extern-bindings.md`

Specify `extern from`, named and aliased bindings, `fun` versus `let`, the diagnostic for a callable declared with `let`, default imports, `extern import`, module effects, and type-only declarations. Keep the surface recognizably analogous to JavaScript module syntax and TypeScript declaration syntax.

Receiver members and classes belong to Part 5.

**Status:** Decided and promoted after Sol review (July 2026). Review fixed unused-import elision, `extern let` stability, opaque-branded exported extern types, and monomorphic v1 extern declarations.

## Part 5 — Extern receiver members and classes

**Target:** `spec/ffi-part5-extern-classes.md`

Specify `method`, `get`, `set`, receiver binding, `extern class`, instance and static members, visibility, construction with `new as create`, subclassing exclusions, and diagnostics. `method` is used by analogy: companion modules offer methods in the same user-facing sense that classes do, while ordinary modules offer functions.

`create` is the cultural default name for a companion constructor function; it is guidance rather than an enforced special name.

**Status:** Decided and promoted after Sol review (July 2026). Review confirmed flat foreign inheritance for v1, dot-call coverage through the extern type's binding module, cultural class-versus-standalone guidance, and exact property accessor arities.

## Part 6 — Functions and callbacks

**Target:** `spec/ffi-part6-functions-callbacks.md`

Specify arity, currying/lowering at the boundary, `Unit`, thrown foreign exceptions, and the v1 representation-direct callback subset.

Defer callback `this`, callbacks requiring boundary adapters, async callbacks, stable wrapper identity caches, and callback forms involving `Seq` or other difficult adapted types.

**Status:** Decided and promoted after Sol review (July 2026). Review confirmed foreign-`Unit` result discarding and the function-typed extern-`let` error, preserved branded exceptions on foreign-frame re-entry, and made receiver independence explicit for raw inbound function values.

## Part 7 — Hexagon exports and TypeScript declarations

**Target:** `spec/ffi-part7-exports.md`

Specify ESM export correspondence, generated `.d.ts` declarations, records, unions, opaque branded values, exceptions, constructor exports, direct exports versus stable wrappers, and the union representation cliff. Include lowercase Hexagon-style generic binders in Hexagon-originated declarations.

Inherit Part 4 §5/§12.3's decision that an exported extern `type` receives a Hexagon-generated opaque branded declaration rather than re-exporting foreign package typings.

Constrained functions are referenced here but governed by Parts 8 and 9.

**Status:** Decided and promoted after Sol review (July 2026). Review confirmed `never` faces for generic nullary constants, export-triggered stable constructor materialization, and one private-symbol brand mechanism; constrained generic editions wrap only when ABI plumbing requires it.

## Part 8 — Zero-cost fundamental exports

**Target:** `spec/ffi-zero-cost-fundamental-exports.md`

Specify the closed seven-type fundamental set, direct named specializations, the lawful Cartesian product, names and collisions, conditional generic edition, public-capability analysis, ABI effects, implementation obligations, and acceptance tests.

**Status:** Decided and promoted after Sol review (July 2026); correction records are in §17 of the target specification.

## Part 9 — Exported dictionaries

**Target:** `spec/ffi-part9-exported-dictionaries.md`

**Supporting note:** `spec/notes/ffi-exported-dictionaries.md`

Specify constraint-owned dictionary types such as `Signed.Dictionary<a>`, ordinary public handles such as `Signed.int`, parameterized dictionary factories such as `Vector.show(Show.string)`, trailing evidence parameters, public-evidence closure, and the relationship to Part 8's base-name generic edition.

Do not repeat Part 8's specialization algorithm.

**Status:** Decided and promoted after Sol review (July 2026). Review confirmed the unified instance-home naming rule and maximal-constraint evidence canonicalization; runtime package subpaths remain representative pending package design.

## Part 10 — JavaScript `Map` and `Set`

**Target:** `spec/ffi-part10-js-map-set.md`

Specify the foreign mutable collection types, their names and accessors, identity semantics, snapshot conversion in both directions, shallow nested values, and their separation from Hexagon persistent `Map` and `Set`.

**Status:** Decided and promoted after Sol review (July 2026). Review confirmed `JsMap` brackets, rejected `JsSet` brackets, fixed native equality and `has`-before-`get`, and added direct eager `fromSeq` constructors with fresh-adapter semantics per crossing.

## Part 11 — Unknown foreign values and conversion failure

**Target:** `spec/ffi-part11-js-value-errors.md`

Specify `JsValue` or its replacement, explicit checked decoding, conversion-failure representation, path information for nested failures, cyclic foreign structures, and the boundary between trusted extern declarations and defensive decoding.

**Status:** Decided and promoted after Sol review (July 2026). Review confirmed the ten-kind inventory, ordinary-data `JsConversionError`, total identity injection, conservative throwable accessors, revoked-proxy split, explicit `Nullable(JsValue)` collapse, and the stdlib ownership of composable decoders; native map/set classification decoders are deferred with a cross-realm revisit bar.

## Part 12 — Consolidation and conformance

**Target:** `spec/ffi.md`

Create the FFI index and common terminology, reconcile cross-part references, remove duplicated doctrine, assemble a complete diagnostic and acceptance matrix, and update the general specification roadmap. The preceding part files remain normative rather than being pasted into one enormous document.

**Status:** Decided and promoted after Sol review (July 2026).

## Recommended feed order

Completed: Parts 1–11 remain normative components and Part 12 is the compact FFI index and conformance closeout; the component specs were not pasted into it.

This ordering keeps each Fable session bounded and prevents a late decision about `JsValue`, cycles, or JavaScript mutable collections from forcing a rewrite of the already settled core.
