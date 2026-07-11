# FFI Spec — Session Agenda

**Status:** Planning note (July 2026). Not a spec. Agenda for the FFI session, with the pre-decided List-representation package recorded so it isn't relitigated.

## Pre-decided (from the List-representation discussion, July 2026)

- `List(a)` = persistent vector (32-way bit-partitioned trie, Clojure/Immutable.js lineage), provided by a Hexagon-owned runtime package (`@hexagon/runtime`). Spec pins semantics and complexity bounds (O(log₃₂ n) get/set, O(1) amortized push), not a third-party library. Immutable.js (MIT) may serve as a temporary private backend and as a property-testing oracle.
- `List` crosses the FFI boundary as itself; `List.toArray` is the egress door.
- `Array(a)` = readonly foreign door for incoming JS arrays; `.d.ts` ↦ `ReadonlyArray<T>`; mirrors the Nullable/Option pattern. Indexing/slicing per existing partiality doctrine; no update operations; `Array.toList` / `List.toArray` conversions.
- Boundary conversion is type-directed and per-layer, driven by the declared extern type.
- Rejected alternative to document in the spec: plain JS arrays (frozen / convention / copy-on-write) — the zero-dependency option.

## Agenda

1. `extern` declaration syntax and module placement (Modules spec now filed; same export-prefix rules presumed).
2. Type mapping at the boundary: `List` (settled above), `Array(a)` ↦ `ReadonlyArray<T>`, `Nullable(T)` ↔ `Option`, per-layer type-directed conversion.
3. `JsValue` final name + accessor set — Exceptions §10.2 owes at minimum `JsError.message : (JsValue) -> String`, `JsError.stack : (JsValue) -> Option(String)`.
4. Union-representation stability contract for JS consumers, incl. the all-nullary representation cliff (Unions §6.2).
5. `opaque` types in `.d.ts` (Modules §11.3) — branded/nominal TS shape TBD.
6. Dictionaries at exported polymorphic boundaries (Constraints §6.4).
7. Confirmations: `Seq` does not cross the boundary in v1; no mutable array type in v1.

## Session opener

Draft the List-representation package above into a proper closure note (Decisions Batch style) before starting the FFI spec.
