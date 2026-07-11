# FFI Specification Roadmap

**Status:** Staged drafting plan. The proto-spec remains the decision record until each part is promoted.

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

**Decision readiness:** Ready.

## Part 2 — `Nullable` and borrowed `Array`

**Target:** `spec/ffi-part2-nullable-array.md`

Specify raw `a | null | undefined` representation, `Nullable.null`, `Nullable.undefined`, inspection and conversion functions including `toCase`; then specify zero-copy readonly arrays, the foreign stability contract, native iteration, shallow element treatment, and explicit copying conversions.

Default parameters and TypeScript-style flow narrowing are outside this part. Record `.toCase` as the preferred Hexagon alternative to narrowing.

**Decision readiness:** Ready.

## Part 3 — `Seq` interoperation

**Target:** `spec/ffi-part3-seq.md`

Specify top-level `Iterable<a>` input, persistent memoizing adaptation, replayable exported traversal, iterative rather than recursive implementation, retention behaviour, iterator closure, malformed results, throws, and the v1 restriction on nested adapter-requiring positions.

Single-pass `Iterator<a>`, async iteration, callback-position adapters, and a separate resource-managed stream type are deferred.

**Decision readiness:** Ready.

## Part 4 — Extern modules and bindings

**Target:** `spec/ffi-part4-extern-bindings.md`

Specify `extern from`, named and aliased bindings, `fun` versus `let`, the diagnostic for a callable declared with `let`, default imports, `extern import`, module effects, and type-only declarations. Keep the surface recognizably analogous to JavaScript module syntax and TypeScript declaration syntax.

Receiver members and classes belong to Part 5.

**Decision readiness:** Ready.

## Part 5 — Extern receiver members and classes

**Target:** `spec/ffi-part5-extern-classes.md`

Specify `method`, `get`, `set`, receiver binding, `extern class`, instance and static members, visibility, construction with `new as create`, subclassing exclusions, and diagnostics. `method` is used by analogy: companion modules offer methods in the same user-facing sense that classes do, while ordinary modules offer functions.

`create` is the cultural default name for a companion constructor function; it is guidance rather than an enforced special name.

**Decision readiness:** Ready.

## Part 6 — Functions and callbacks

**Target:** `spec/ffi-part6-functions-callbacks.md`

Specify arity, currying/lowering at the boundary, `Unit`, thrown foreign exceptions, and the v1 representation-direct callback subset.

Defer callback `this`, callbacks requiring boundary adapters, async callbacks, stable wrapper identity caches, and callback forms involving `Seq` or other difficult adapted types.

**Decision readiness:** Ready.

## Part 7 — Hexagon exports and TypeScript declarations

**Target:** `spec/ffi-part7-exports.md`

Specify ESM export correspondence, generated `.d.ts` declarations, records, unions, opaque branded values, exceptions, constructor exports, direct exports versus stable wrappers, and the union representation cliff. Include lowercase Hexagon-style generic binders in Hexagon-originated declarations.

Constrained functions are referenced here but governed by Parts 8 and 9.

**Decision readiness:** Ready.

## Part 8 — Zero-cost fundamental exports

**Target:** `spec/ffi-zero-cost-fundamental-exports.md`

Specify the closed six-type fundamental set, direct named specializations, the lawful Cartesian product, names and collisions, conditional generic edition, public-capability analysis, ABI effects, implementation obligations, and acceptance tests.

**Status:** Drafted by Fable; Sol review in progress.

## Part 9 — Exported dictionaries

**Target:** `spec/ffi-part9-exported-dictionaries.md`

**Supporting note:** `spec/notes/ffi-exported-dictionaries.md`

Specify constraint-owned dictionary types such as `Num.Dictionary<a>`, ordinary public handles such as `Num.int`, parameterized dictionary factories such as `Vector.show(Show.string)`, trailing evidence parameters, public-evidence closure, and the relationship to Part 8's base-name generic edition.

Do not repeat Part 8's specialization algorithm.

**Decision readiness:** Ready after the Part 8 review is settled.

## Part 10 — JavaScript `Map` and `Set`

**Target:** `spec/ffi-part10-js-map-set.md`

Specify the foreign mutable collection types, their names and accessors, identity semantics, snapshot conversion in both directions, shallow nested values, and their separation from Hexagon persistent `Map` and `Set`.

**Decision readiness:** Not ready. Resolve the remaining name/accessor questions first.

## Part 11 — Unknown foreign values and conversion failure

**Target:** `spec/ffi-part11-js-value-errors.md`

Specify `JsValue` or its replacement, explicit checked decoding, conversion-failure representation, path information for nested failures, cyclic foreign structures, and the boundary between trusted extern declarations and defensive decoding.

**Decision readiness:** Not ready. `JsValue`, failure shape, and cycle policy remain open.

## Part 12 — Consolidation and conformance

**Target:** `spec/ffi.md`

Create the FFI index and common terminology, reconcile cross-part references, remove duplicated doctrine, assemble a complete diagnostic and acceptance matrix, and update the general specification roadmap. The preceding part files remain normative rather than being pasted into one enormous document.

**Decision readiness:** Last.

## Recommended feed order

Draft Parts 1–7 in order, then Part 9. Part 8 already exists and should be corrected before Part 9 is drafted. While Fable handles ready parts, James and Sol can close Parts 10 and 11. Part 12 happens only after every earlier part is stable.

This ordering keeps each Fable session bounded and prevents a late decision about `JsValue`, cycles, or JavaScript mutable collections from forcing a rewrite of the already settled core.
