# FFI Spec — Session Agenda

**Status:** Completed and historical (July 2026). Fully discharged by FFI Parts 1–12 and Foreign Enums; `spec/ffi.md` is the canonical entry point. This remains drafting history, not a spec.
**Companion context:** `spec/notes/ffi-proto-spec-questions.md` — bounded proto-spec decision surface; `spec/notes/ffi-zero-cost-primitive-exports.md` — fundamental specialization package; `spec/notes/ffi-exported-dictionaries.md` — generic dictionary edition, public evidence, and ABI.

## Pre-decided (from the Vector-representation discussion, July 2026; renamed per Collections Part 1 §1)

- `Vector(a)` = persistent vector (32-way bit-partitioned trie, Clojure/Immutable.js lineage), provided by a Hexagon-owned runtime package (`@hexagon/runtime`). Spec pins semantics and complexity bounds (O(log₃₂ n) get/set, O(1) amortized push), not a third-party library. Immutable.js (MIT) may serve as a temporary private backend and as a property-testing oracle. *(Representation and complexity since made normative: Collections Parts 1 §2 and 3.)*
- `Vector` crosses the FFI boundary as itself; `Vector.toArray` is the egress door (naming confirmed subject-first, Part 3 §13).
- `Array(a)` = readonly foreign door for incoming JS arrays; `.d.ts` ↦ `ReadonlyArray<a>`; mirrors the Nullable/Option pattern. Indexing/slicing per existing partiality doctrine; no update operations. Conversions: see item 10 — the earlier `Array.toList` / `List.toArray` spellings are **stale** (pre-rename) and superseded.
- Boundary conversion is type-directed and per-layer, driven by the declared extern type.
- Rejected alternative to document in the spec: plain JS arrays (frozen / convention / copy-on-write) — the zero-dependency option.

## Agenda

1. `extern` declaration syntax and module placement (Modules spec now filed; same export-prefix rules presumed).
2. Type mapping at the boundary: `Vector` (settled above), `Array(a)` ↦ `ReadonlyArray<a>`, `Nullable(a)` ↔ `Option`, per-layer type-directed conversion.
3. `JsValue` final name + accessor set — Exceptions §10.2 owes at minimum `JsError.message : JsValue -> String`, `JsError.stack : JsValue -> Option(String)`.
4. Union-representation stability contract for JS consumers, incl. the all-nullary representation cliff (Unions §6.2).
5. `opaque` types in `.d.ts` (Modules §11.3) — branded/nominal TS shape TBD.
6. **Constrained-polymorphic exports — proto-decided:** direct named specializations for the closed fundamental set plus a base-name trailing-dictionary edition when public usable non-fundamental evidence exists. Public instances receive type-owned handles/factories (`Rat.num`, `Vector.show(...)`); dictionary types are constraint-qualified with lowercase Hexagon binders (`Num.Dictionary<a>`). See both companion notes; the normative FFI spec consolidates them and refines Constraints §6.1/§6.4.
7. **`Seq(a)` boundary package** — Loops §6.5 already decides that `Seq(a)` crosses as JS `Iterable<a>`; do not reopen that direction. Specify the inbound adaptation that preserves persistent `Seq.next` for replayable iterables and single-shot iterator objects, including memoization, retention, failure, and iterator-closing semantics. Confirm only that no mutable Hexagon array type ships in v1.
8. **Acyclicity scope** — *decided* (Sol-review closure §D): acyclicity is a property of Hexagon source edges only; `extern` imports are leaf edges; extern modules may sit in JS-internal cycles; `hexc` never inspects or certifies foreign graphs. The FFI spec writes the paragraph.
9. **`Map`/`Set` boundary conversions** (Collections Part 4 §10): `Map.toJsMap`/`Map.fromJsMap`, `Set.toJsSet`/`Set.fromJsSet` — names pre-registered; conversions are shallow snapshots; primitive-key faithfulness normative via SameValueZero alignment; Hexagon→JS reference-identity caveat; JS→Hexagon collapse later-entry-wins in source iteration order. Owed: final `JsMap`/`JsSet` accessor surface and cyclic-key conversion failure mode.
10. **The `Array(a)` iteration package — proto-decided:** zero-copy borrowed readonly JS array with a foreign stability obligation; native iteration; `Iterable<Array(a)>`; `Array.toSeq` lazy/borrowed, `Array.fromSeq` eager fresh array, `Array.toVector` stable snapshot, `Vector.toArray` fresh array; shallow conversions; `ReadonlyArray<a>` face. Normative spec must finish exact lifetime/iterator-closing wording.

## Session opener

Promote the bounded proto-decisions and companion notes into one normative FFI spec, resolving the remaining Map/Set failure, `JsValue`, and diagnostics packages without reopening closed directions.
