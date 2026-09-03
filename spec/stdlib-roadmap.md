# Hexagon Stdlib Roadmap — Global Ledger

**Status:** Decided and promoted after Sol review (July 2026), then amended by James's v1 `Rat` and `PlainDate` decisions. Seeded from the approved inventory (`notes/v1-spec-inventory.md` §3.3), audited against `spec-roadmap.md` §5, and verified row-by-row against each originating specification; the review added omitted roadmap work, corrected status classes, and completed the division/`Show`/`Hash<Float>` obligations. **This is the sole global ledger for stdlib-owned work.** It designs nothing and resolves no ship/defer question.

**Ledger rules.** (1) Every future "stdlib listing" export or newly discovered stdlib debt adds or updates a row here — no other ledger exists. (2) Statuses: **v1 obligation** (the listing must deliver it), **ship/defer decision** (the listing session decides, under the recorded constraints), **post-v1 candidate** (explicitly field-evidence-gated or post-v1 by its owner). (3) "Fixed semantics" cites constraints already normative in the owning spec — the listing may not relax them. (4) Rows are discharged by the stdlib listing spec (to be drafted; this ledger routes to it); each row's discharge column names the area. (5) Conflicting status claims between live sources are recorded, not chosen. One staleness noted this pass: `spec-roadmap.md` §5 still says the `Int.div`/`Int.mod` deep-dive is "owed", but `division-remainder.md` (Decided) closes Operators §14.3a — the roadmap wording is stale, not a live conflict; flagged for consolidation Part 5.

**Recorded under rule 5 (2026-08-02, #237 ruling).** `ffi.md` §9.1 heads itself *"V1 stdlib work (global ledger per `v1-spec-consolidation-plan.md`)"*, which reads against rule 1's "no other ledger exists". Both are live and neither is chosen here. The reconciling reading, and the one this file works to: **`ffi.md` §9.1 is the FFI spec's local index into this ledger, not a second ledger** — every one of its five entries already has a row here (verified: §9.1.1 and §9.1.2 in §2; §9.1.3, §9.1.4, and §9.1.5 in §3), and one of its items describes itself as issued to a ledger elsewhere ("ledger entry issued by Part 11 §10", item 1; item 5 says the listing "must … update the ledger"; items 2–4 say nothing either way). Two consequences are recorded rather than legislated. First, **on the competing reading only** — the one where §9.1 is a second ledger — §6's closing "no row is duplicated across ledgers" would be false of those five rows; on the index reading it is not violated at all, since an index is not a ledger. The clause's own scope is the two ledgers §6 names, `spec-roadmap.md` and `ffi.md` §9.2. Second, and independent of which reading wins: a document that discovers stdlib debt owes a row **here** first, whatever it also mirrors. `ffi-part2-nullable-array.md` §9.1 carries the edit note that conforms `ffi.md` §9.1's heading on next touch. The consolidation pass owns the final wording.

**Also recorded under rule 5 (same date, same ruling): the `Array(a)` conversion-quartet row in §2 does not fit its status class cleanly.** Rule 2 defines **v1 obligation** as work *the listing* must deliver, and rule 4 discharges rows through the stdlib listing spec; that row's discharge column instead names compiler/stdlib implementation, and the row says outright that nothing in it is the listing's to decide. **v1 obligation** is still the right home — rule 1 mandates a row for newly discovered stdlib debt, and both other classes fit worse (the semantics are fixed by a Decided spec, so there is no ship/defer question, and nothing about it is post-v1) — but the class was built for design work the listing resolves, and this is implementation debt against contracts already normative.

**And the misfit is not new with this row — it is already general across §2**, which is the more useful thing for the consolidation pass to know. Four existing v1-obligation rows discharge somewhere other than the listing spec: integer division/remainder ("compiler landed; listing: numeric inventory"), `Rat` ("`rat.md` + `stdlib/Rat.hex` landed"), `PlainDate` ("focused `PlainDate` spec, then listing"), and `Seq.hex` ("migration plan: `spec/notes/seq-deintrinsification-plan.md`" — not the listing at all). Rule 4 is therefore already read loosely across the table, and rule 2's "the listing must deliver it" already means "this is a v1 requirement, and the listing records it" for a good part of §2. Recorded, not resolved: the pass may want a fourth status, or may want rules 2 and 4 widened to match what the table already does.

---

## 1. Binding doctrine on the whole listing (constraints with owners, not work rows)

| Rule the listing must honor | Owner |
|---|---|
| Naming doctrine: subject-first, companion-qualified, cost-honest names | `collections-part1-decisions.md` §3; `functions.md` §5.4 |
| Subject-first now also determines **dot-callability** (exported ∧ first-parameter-`T`-headed, unioned with honored subject-first members since #304/#335) | `method-syntax.md` §4.2/§15 |
| Accessor pair: `[]` throws / `get` returns `Option`; `try` prefix, if ever used, means "does not throw" | `collections-part1-decisions.md` §3.3 |
| Every prelude name needs a **qualified home** | `modules.md` §6.4 |
| **In stdlib source the dot call is the canonical spelling wherever the dot resolves**: a subject-first member or `T`-headed function on a head-known or bound receiver is written `a.rem(b)`, `values.length()`, never `Integral.rem(a, b)`; the qualified spelling is reserved for what the dot cannot reach — members that are not subject-first (`Num.fromNat`: the subject appears only in the result), functions whose first parameter is not `T`-headed (`Vector.fromSeq`), values (`Seq.empty`), constructors (`Ordering.Less`), a receiver with no companion to dispatch to — a tuple, `()`, a structural record, a function, or a nominal with no companion module (`Range`: `Iterable.toSeq(range)`) — a vector literal for `Eq`'s, `Ord`'s, and `Hash`'s members, whose instances at `Vector` are structural and carry no dot (`Hash.hash([1, 2])`; Modules §5.5), a spelling the dot refuses as claimed twice (Method Syntax §6), a receiver whose type is not known at the call (Method Syntax §3.5's row fallback), and a prelude module's own export used inside the module that exports it (`Float.hex`'s `mod` calls its own `rem(left, right)` bare — a prelude module cannot see itself, so `left.rem(right)` there finds no companion). Source style, cutting the qualifier count to what carries information; what a call elaborates to is unchanged (Method Syntax §1) | `modules.md` §5.5; `method-syntax.md` §1, §3.4 |
| **The bare set is closed at sixteen names** — the prelude's eight exception constructors; `True`, `False`, `Some`, `None`, `Ok`, `Err`; `ignore`; `show`. Every other prelude export is reached by the dot or its qualified home: no other function, no other union constructor (`Ordering.Less`, `JsKind.Null`), no other constraint member. A listing row spends no bare vocabulary unless it declares an exception; an addition to the set is a design ruling, never a listing entry. `Ordering` is homed at `stdlib/Ordering.hex`; `Prelude.hex` homes `ignore` alone | `modules.md` §5.5 |
| `NullableCase.*`, `JsKind.*`, `JsConversionReason.*`, and `JsPathSegment.*` constructors are qualified-only — by the row above's default; `ffi.md` §12 is the record of the first case | `modules.md` §5.5; `ffi.md` §12 |
| Collections/stdlib boundary: structure in Collections Parts 1–5; **combinator families in the listing** | `collections-part5-iterable.md` §10 |
| `Option`/`Result` failure-type boundary: membership projections may be `Option`; structured decoding is `Result(_, JsConversionError)`; owned per spec | `ffi.md` §11.2 |
| Rewrite Rule applies to any listing-introduced diagnostics | `decisions-sol-review-2026-07.md` §E |
| **No declared-but-throwing stubs.** A shipped Hexagon-owned operation exists when it works: one the listing cannot yet implement is *absent* — no declaration, no export, no `.d.ts` entry — and the owning spec is the forward contract that reserves its name. Governs **shipped Hexagon-owned surface** — the stdlib, prelude, and runtime modules the toolchain ships, and its compiler-provided operations. It does not reach user code or development-time scaffolding; the fence is the release artifact. **There is no exception clause** *(added 2026-08-02, #237 ruling; routed here for discoverability — the doctrine reaches shipped surface generally but is written in a document titled for `Nullable`/`Array`. This row first read "governs callable surface only", which paraphrased a carve-out the ruling's own round 2 withdrew unreplaced; since this table is the route by which most readers meet the rule, the withdrawn wording had to go from here too)* | `ffi-part2-nullable-array.md` §9.1 (rejected alternatives, with prices, §9.2) |

## 2. V1 obligations (23)

| Surface / question | Origin | Fixed semantics | Revisit bar | Discharge |
|---|---|---|---|---|
| `Ordering` prelude union | `decisions-batch-2026-07.md` §3; routed by `spec-roadmap.md` §5; `modules.md` §5.5 | `union Ordering = Less \| Equal \| Greater`; tagged-object representation like every union (Unions §6.2); `derives (Eq, Show)` on the prelude declaration; constructors qualified-only — `Ordering.Less` — so the union is homed at `stdlib/Ordering.hex` | — | listing: prelude inventory |
| `ignore` | `statements-blocks-mutability.md` §3.3 (discard rule; diagnostic names `ignore(...)`; position-sensitive erasure) | required by the discard diagnostic's own rewrite; identity-discard semantics | — | **Landed** *(#313)*: ordinary source in `stdlib/Prelude.hex` (`export let ignore(value: a): Unit = ()`), no door key by the strictly-simpler law; applied-call erasure per §3.3; listing: prelude inventory |
| `throw : Exn -> a` | `exceptions.md` §1/§4 | ordinary prelude function, not a keyword; diverges (fresh result variable) | — | listing: prelude inventory |
| `Result.attempt` | `exceptions.md` §8.2 | prelude addition as specified there; `Exn` error side; `.d.ts` face per `exceptions.md` §7.5 | — | listing: prelude inventory |
| Integer division/remainder companion surface (`Int`/`BigInt` `div`/`mod`/`quot`/`rem`; `Float.mod`/`rem`) | `division-remainder.md` (final; closes Operators §14.3a); routed by `spec-roadmap.md` §5 | complete inventory, conventions, and zero-divisor behavior are fixed by `division-remainder.md`; compiler operations and runtime semantics implemented; the listing records them without reopening the deep dive | — | compiler landed; listing: numeric inventory |
| `Float` instances (`Eq`/`Ord`, and `Hash<Float>` normalization) | `decisions-batch-2026-07.md` §1; `collections-part2-hash-and-type-members.md` §2.3/§2.5 | `Eq<Float>` = SameValueZero; `Ord<Float>` = consistent total order (`NaN` after `+Infinity`, `±0` equal); `Hash<Float>` normalizes `-0` with `+0` and every NaN bit pattern to one hash value | — | listing: prelude instances |
| Required `Show` instances already mandated by type and collection owners | `primitive-types.md` §7; `products.md` §2.5/§3.4; `unions.md` §7; `collections-part3-vector.md` §8; `collections-part4-map-set.md` §8.3 | display semantics and conditional constraints are fixed by owners; the listing records the instance inventory rather than redefining it | — | listing: prelude instances |
| `memoFix` / open-recursion support surface | `functions.md` §7.5 | the blessed idiom for memoized recursion; behavior sketched normatively there (map + local `fun go` + `f(go, n)`) | — | listing: prelude functions |
| `Rat` rational type: focused specification plus stdlib module | `rat.md`; `integral-constraint.md` §1/§9; `division-remainder.md`; `numeric-literals.md` §5 | v1 requirement; top and bottom are represented with `BigInt`, with Euclidean normalization, fixed integer division conventions, and exact `Num.fromNat` / `Signed.fromInt`; `rat.md` fixes encapsulation, runtime shape, API, operations, and instances | — | `rat.md` + `stdlib/Rat.hex` landed; Playground consumes the canonical module through its provisional fundamental stdlib manifest; listing records numeric inventory and ultimately owns that manifest's boundary |
| `PlainDate` date-only type: focused specification plus stdlib module | James's v1 decision (July 2026); Temporal `PlainDate` naming precedent | v1 requirement; `opaque record PlainDate = {year: Int, month: Int, day: Int}` with only valid proleptic ISO 8601 dates inhabiting the type; smart construction and parsing validate; accessors expose all three components; canonical ISO rendering; derived `Eq`/`Hash` and manual chronological `Ord` (year, then month, then day); no time, time zone, non-ISO calendar, or locale formatting surface | — | focused `PlainDate` spec, then listing: date types + `stdlib/PlainDate.hex` |
| Composable `JsValue` decoder family: field/record traversal, element-wise decoders, `nullable`/`oneOf`/defaults, map/set decoders | `ffi.md` §9.1.1; `ffi-part11-js-value-errors.md` §9.1/§13.2 | built over Part 11's primitives, `JsConversionError` structure, closed 5-segment path vocabulary; `Err` vs `JsError` channel doctrine | — | listing: FFI/decoding |
| Qualified companion homes for `NullableCase.Undefined/Null/Value`, all ten `JsKind.*` constructors, and all eight `JsConversionReason.*`/`JsPathSegment.*` constructors (#511) | `ffi.md` §9.1.2/§12 | qualified-only exposure; representations unchanged; ordinary companion qualification | — | listing: prelude inventory |
| Combinator families for `Vector`/`Map`/`Set`/`Seq` — **producing the v1 ship-list is the obligation; individual combinators remain listing decisions** | `collections-part5-iterable.md` §10; `collections-part3-vector.md` §12.2 (`reverse` needed by §6.3 idiom; `sort` referenced by `collections-part4-map-set.md` §7.1 guidance) | subject-first; complexity contracts per owning collection specs; `Seq`-consuming combinators constant-stack (`loops-ranges-iteration.md` §6; `ffi-part3-seq.md` §6) | — | listing: collections combinators |
| **The `Array(a)` conversion quartet — `Array.toSeq` / `Array.fromSeq` / `Array.toVector` / `Vector.toArray` — is fully specified; `Vector.toArray` and `Array.toVector` have shipped and `Array.toSeq`/`Array.fromSeq` are unimplemented** *(added 2026-08-02, #237 ruling; this row is the debt's only ledger entry, rule 1)* | `ffi-part2-nullable-array.md` §9 (the contracts) and §9.1 (the finding of fact, the shipping doctrine, and the order); suite membership `collections-part5-iterable.md` §1/§6 + `ffi-part2-nullable-array.md` §8.3 | Every contract is already normative and the listing may not relax any of it: `Array.toSeq` lazy zero-copy over the borrow, `Array.fromSeq`/`Array.toVector`/`Vector.toArray` eager and fresh, all four shallow (FFI Part 1 §5.1), all four total with no checked failure mode, stability per §6.2. **Absence, never a stub** — until an operation can be implemented exactly as §9 specifies it has no declaration, no export, and no `.d.ts` entry (§9.1; the retracted `NotImplemented` interim is rejected at §9.2 item 1). No partial shipping. Companion home for `Vector.toArray` is `stdlib/Vector.hex`; the intrinsic door is the designed route and its gate is **open** — a `"hex:intrinsic"` block is legal in prelude members (`intrinsics.md` §5.2), and `Vector.hex` is one since the `Vector` milestone landed (`intrinsics.md` §3.2, §9.2), declaring its seven boundary operations through the door already; `vectorToArray` is the eighth key in that block. Extending `CollectionOperation` is foreclosed for `Vector`: its rows in that family are gone (`intrinsics.md` §9.2), as is the public-name door. **`Vector.toArray` shipped by that route (#238).** The *family* is not retiring — `Node` outlives it and #223 owns the terminus. (Full statement: `ffi-part2-nullable-array.md` §9.1 obligation 2.) `.d.ts` face per FFI Part 1 §4.1's `Array(a)` row as it stands at ship time (#228, once open against it, fixed 2026-08-04, `0134ce1`) **Order, per James: outbound before inbound — a one-item priority, not a two-way partition.** `Vector.toArray` first (#238, shipped), the direction #128's face narrowing exposes; `Array.toSeq`/`Array.fromSeq`/`Array.toVector` later and separately motivated (`Array.toVector` since shipped, as the `arrayToVector` key in `stdlib/Array.hex`'s block — #237, the ruling that named it) — note `Array.fromSeq` is **outbound** too (it builds a fresh JS array), so "outbound first" ranks `Vector.toArray`, it does not split the quartet in two. Obligation sources differ: Collections Part 5 §1's suite doctrine obliges the `toSeq`/`fromSeq` pair, while `Array.toVector` was owed to a live corpus dependency, Pattern Matching §11.1's "convert with `Array.toVector`", which its landing discharges | — (obligation, not gated; #237 fixes the order only and grants no item a v1 exemption) | compiler/stdlib implementation — `Vector.toArray` (#238) and `Array.toVector` (#237, the ruling that named it) landed; the `toSeq`/`fromSeq` pair next, then this row; listing records the inventory. **Note the shape of the debt: this is implementation, not design** — nothing here is the listing's to decide |
| `Seq.hex` as a **prelude module declaring the type** — `opaque record Seq(a)` + `next` + combinator core in one module, joining the prelude set after `Option.hex`; includes the explicit `memoize` opt-in (re-derivation default per Loops §6.4); **`Seq` de-intrinsifies before `Vector` and pilots the pattern `Vector`/`Set`/`Map` inherit** (decided 2026-07-26) | `loops-ranges-iteration.md` §6.1/§6.4/§6.6; `modules.md` §5.5; rationale `spec/notes/seq-core-representation.md` | opacity load-bearing (`pull` private to home); no `import` lines in prelude source (Modules §5.5); export boundary memoizes regardless of internal default (`ffi-part3-seq.md` §9.1) | — | migration plan: `spec/notes/seq-deintrinsification-plan.md` |
| `toSeq` qualified home — `Iterable.toSeq` *(#353)* | `collections-part5-iterable.md` §2.3/§4 (via `modules.md` §6.4 invariant) | **Landed**: `stdlib/Iterable.hex` is the declaring module and the member is its export, so `Iterable.toSeq` is the qualified home outright; the per-collection `toSeq` spellings are its honored-member reads (Modules §5.3) | — | landed |
| **`stdlib/Stream.hex`** — the impure sequence as a prelude module: `Stream(+a)`, `next`, `map`/`filter`, intrinsic-door `fromSeq` (`streamFromSeq`), consumers `collect`/`fold`/`forEach`/`find`; `Random`/`Clock` are the intended first customers (their module designs are future specs) *(#355)* | `stream.md` (the complete surface; nothing here is the listing's to widen); `effects.md` §7 | **Landed** at `stdlib/Stream.hex`. Surface, refusals (`take`/`drop`, `Iterable`, replay), and the `Option`-per-pull call are fixed by `stream.md`. The outbound `IterableIterator(a)` face (FFI Part 3 §14.2) is specified and **not yet implemented** — exported `Stream` values face as the opaque brand until the per-crossing shim lands (absence, never a stub; the quartet row's doctrine); issue #384 tracks it | field evidence reopens only what `stream.md` names (its §2, §4.2 revisit bars) | landed |
| **The `Seq` migration** — five strict-consumer callback arrows `->`→`=>` (`fold`/`forEach`/`find`/`any`/`all`), six `?` body marks, `memoize`'s species (b) doc sentence, and the module-doc purity posture sentence *(#355)* | `effects.md` §7 (branch (ii)); Loops §6.4 as amended; the migrated text is `stdlib/Seq.hex` itself | **Landed** at `stdlib/Seq.hex`; the fixture copy is retired (one source of truth) | — | landed; `book/chapters/18-sequences.md` corrected and `book/chapters/19-streams.md` added (the sibling chapter) |
| Companion inventories for `Range`, `Seq`, the primitives, and the prelude nominals `Option`/`Result`/`Ordering` (what exists to dot-call; membership of each inventory remains a listing decision) | `method-syntax.md` §12.3 (+§14(k) `Option.getOrElse` as the worked companion example); `collections-part5-iterable.md` §4; `unions.md` §8 | dot-callability mechanism fixed (§1); `Range` iteration semantics per `loops-ranges-iteration.md` §3/§5; `Option`/`Result` declarations fixed by `unions.md` §8 | — | listing: per-type companions |
| Wrapper-key pattern's first customer (`CiString`) | `collections-part2-hash-and-type-members.md` §4.5 ("first customer owed"); §12.1 | wrapper-key mechanism fixed (compiler-provided `Hash`/`Eq` via `derives`); **folding semantics undecided** (full case fold vs `toLowerCase`-family — §12.1, decided at the listing) | — | listing: string/key types |
| Hostile-specimen constraint-library exercise (ten unrelated user constraints; collision-pressure measurement) | `decisions-sol-review-2026-07.md` §A.5 | **retired** (#742): qualified-as-default was adopted for prelude members on vocabulary grounds, not collision pressure (`modules.md` §5.5; `constraints.md` §2.2), so the question the exercise fed is closed and no measurement reopens it | — | discharged |
| Subject-first convention enforcement audit across the completed listing | `spec-roadmap.md` §5; `collections-part1-decisions.md` §3 | subject-first is binding doctrine (§1); every adopted companion operation is checked against it and the dot-callability consequences | — | listing session (process) |
| **`stdlib/Debug.hex`** — the debug probe (#407; surface widened at #419; influence: Elm's `Debug` module) | `effects.md` §6.2 species (a), which names the member; `intrinsics.md` §3.2 | `log<a: Show>(value: a): Unit` — Hexagon's version of `console.log`, not `console.log` precisely: any operand honoring `Show`, rendered through `show` (identity at `String`, Primitive Types §7) — ordinary Hexagon above the unexported `debugLog(message: String): Unit` intrinsic key, pure-faced, sink captured at module initialization (§6.2's caveat is part of the row's contract); the boundary face is a constrained export's (FFI Part 7 §7: `.d.ts` = Part 8's fundamental specializations, generic edition internal-named with its Part 9 evidence suffix — `trace`'s existing shape), accepted; `trace<a: Show>(label: String, value: a): a` — Elm's `Debug.log` shape under Haskell's name — renders `label: value` through `log` and returns `value` unchanged, ordinary Hexagon above it; both reached as `Debug.log`/`Debug.trace` (`modules.md` §5.5 — neither is in the bare set; the qualifier says what the row's own contract says, that this is a probe and not logging). **Consequences:** `Float`'s natural logarithm is `ln` (decided when bare `log` was spent, and it stands on its own name); a value without `Show` (a function, a foreign brand) is refused at compile time, unlike `console.log`; and this is not real logging — species (a) forfeits multiplicity and ordering, so a counted or ordered log is a banged extern, permanently. `Debug.hex` is also the seat the v2 `Debug` constraint takes if it comes (Primitive Types §5.4) | — | landed with #407; widened with #419; listing: prelude inventory |

## 3. Ship/defer decisions (11; the listing session decides, constraints recorded)

| Surface / question | Origin | Fixed semantics | Revisit bar | Discharge |
|---|---|---|---|---|
| `Map.merge` family, `Map.update`/`filter`/`mapValues`/`getOr`/`containsValue`; `Set.map`/`filter` | `collections-part4-map-set.md` §13.1; `getOr` also `collections-part1-decisions.md` §3.3 | `merge`'s key-representative rule bound by `collections-part4-map-set.md` §5.4 (values last-wins; key representatives first-wins/left-wins); `<Hash>` constraints per §2.2 | — | listing: Map/Set combinators |
| `Exn` instances (`Show<Exn>`, any constraint on `Exn`) | `exceptions.md` §10.3–10.4 (**presumption: none in v1 — requires confirmation here**); `collections-part2-hash-and-type-members.md` §4.2 (no `Hash<Exn>`, enforced) | if confirmed none, the listing records the absence as deliberate; `Hash<Exn>` is already syntactically foreclosed | — | listing: prelude instances |
| `Range` `Eq`/`Show`, and dependent `Hash<Range>` | `loops-ranges-iteration.md` §3.6 (**still open**); `collections-part4-map-set.md` §13.2 | until decided, `Range` keys in persistent collections are unsatisfiable — **that absence is load-bearing for `collections-part4-map-set.md` §4.4's slicing dismissal; deciding this must re-check it** (`JsMap` needs no `Hash`, `ffi-part10-js-map-set.md` §4.3, so the foreign door already changed the landscape once) | — | listing: prelude instances |
| `Float.ieeeEquals` / raw-IEEE escape hatches | `decisions-batch-2026-07.md` §10.2 (explicitly the stdlib listing's decision) | `Eq<Float>` stays SameValueZero regardless; any escape hatch is a named function, never an instance change | — | listing: numeric |
| `toJsMap`/`toJsSet` classification decoders | `ffi.md` §9.1.4; `ffi-part11-js-value-errors.md` §13.1 | strict, non-coercing decoding returning `Result(_, JsConversionError)`; `Err` = data wrongness, hostile throws travel `JsError` (`ffi-part11-js-value-errors.md` §1) | **absence of a portable property-free classifier**: `instanceof` fails cross-realm; the workable intrinsic brand checks are awkward throw-based probes | listing: FFI/decoding |
| `JsMap.keys`/`JsMap.values` projections; `JsSet` algebra reads | `ffi.md` §9.1.5; `ffi-part10-js-map-set.md` §9.1–9.2 | derivable via `toSeq` combinators or conversion; borrowed-view semantics fixed by `ffi-part10-js-map-set.md` | field demand | listing: FFI collections |
| `Nullable` conveniences / conversion aliases | `ffi.md` §9.1.6 | must honor `ffi-part2-nullable-array.md`'s companion surface and its supersession of Unions §8 spellings | — | listing: FFI/Nullable |
| ~~Monomorphic per-type `show`/`toString`-style companion exports~~ **settled by construction (#304/#335)**: `3.show()` is `Show`'s member at `Int` and `Int.show` its qualified spelling; a duplicate monomorphic export is the rebinding error in the honoring module, the refusal across modules | `method-syntax.md` §7/§12.4; `constraints.md` §4.6 | nothing left for the listing to decide | — | listing: per-type companions |
| `String.join(sep, xs)` and string conveniences | `collections-part5-iterable.md` §5.3/§14.2 | `String.fromSeq` concatenation contract fixed (§5.3, incl. linear-complexity implementation note); `join` supplements, never replaces | — | listing: String |
| `Hash` for prelude unions (`Ordering` et al., via `derives` on prelude declarations) | `collections-part2-hash-and-type-members.md` §12.3 | derivable-only `Hash` doctrine (§4) | — | listing: prelude instances |
| Numeric narrowing set (`Int.fromFloat`, kin) | `ffi-part1-boundary.md` §6 ("if included") | checked, `Option`-returning, `Number.isSafeInteger` discipline; `BigInt.toInt` already core | — | listing: numeric |

## 4. Post-v1 candidates (4; gated by their owners on field evidence, or on a dependency that is itself deferred)

| Surface / question | Origin | Fixed semantics | Revisit bar | Discharge |
|---|---|---|---|---|
| `Set.isSupersetOf` | `collections-part4-map-set.md` §12.3 ("candidate at most, only if field usage shows the flipped call is a real pain") | flipped-argument `isSubsetOf` exists | field evidence | listing (post-v1 review) |
| Public `Range.toSeq` | `collections-part5-iterable.md` §14.3 ("candidate at most") | the member `toSeq` reaches `Range` through its instance; the open question is only a *qualified* `Range.toSeq` home, since no `Range` companion module exists | field demand | listing (post-v1 review) |
| Grapheme-cluster iteration for `String` | `collections-part5-iterable.md` §5.1 | named stdlib function if ever; the `Iterable` instance is codepoints permanently | field demand | listing (post-v1 review) |
| **A non-retaining streaming export for `Seq`** *(added 2026-07-28, James's decision on the defect-12 ruling)* | `ffi-part3-seq.md` §9.7 (which forecloses `toJsIterable` and routes a genuinely distinct surface here under ledger rule 1); the retention cost is §5's addendum | The capability is an outbound view that lets JavaScript traverse a `Seq` **without** the §9.4 boundary view's memoization, and therefore without pinning the forced prefix for the value's lifetime. It is neither the identity nor `memoize` — the two meanings §9.7 forecloses. **It is not named `toJsIterable`**: the name must say *streaming*/*single-pass*, per the same decision. Semantics, spelling, and whether it needs an opt-out of §9.1's unconditional export memoization are the ruling's, not fixed here | **Not field demand.** Part 3 §10's deferred single-pass/resource-aware type is the enabler; §9.2 already binds it ("must not be called `Seq` and must not weaken `Seq` persistence"). Revisit when that type is designed | its own focused ruling (tracked as issue #129), then this row |

## 5. Long-term canonical source for every standard-library companion

**Status:** Long-term implementation-architecture plan approved by James (July
2026); deliberately incremental and not a v1 public-surface blocker.

Every standard-library companion must ultimately have canonical Hexagon source. A
reader following `Type.operation` must be able to find the companion's public
declarations, documentation, and all Hexagon-expressible implementation in a `.hex`
module rather than discovering that the whole surface exists only as
resolver/checker/emitter special cases. This rule covers primitive companions and
ordinary prelude/stdlib types alike.

Canonical Hexagon source does not require every operation to be implemented purely in
Hexagon. A module may cross a narrow, explicitly declared private intrinsic or runtime
boundary where the language cannot express the operation. The `.hex` module still
owns the public surface and explains that boundary. Compiler inlining and specialized
lowering remain implementation choices. This does **not** change already-decided
public names or semantics, and it is not motivated by a performance problem: source
ownership and optimized lowering are separate decisions.

### 5.1 Hexagon-first implementation doctrine

Standard-library behavior is authored in Hexagon whenever Hexagon can express it
with equivalent asymptotic complexity and acceptable generated code. A private
intrinsic/runtime implementation is justified only by at least one of:

- a host capability Hexagon cannot express (for example native BigInt quotient and
  remainder while the public language has neither BigInt `/` nor `%`);
- access to an intentionally opaque or performance-critical representation;
- a required compiler transformation rather than a library operation (for example
  counting-loop erasure or constraint-evidence specialization); or
- measured performance evidence showing that the Hexagon implementation cannot yet
  produce acceptable code.

Even then, canonical `.hex` source owns the public declarations, documentation, and
the visible call into the narrow private boundary. “Authored in Hexagon” does not ban
inlining, specialization, helper selection, or other semantics-preserving compiler
optimization.

The current compiler-owned surface yields this migration inventory:

| Canonical source | Hexagon-owned behavior | Narrow intrinsic/runtime residue |
| :--- | :--- | :--- |
| `BigInt.hex` | **landed** (#344): Euclidean `div`/`mod`, iterative `gcd`, divide-first `lcm`, the zero-divisor and negative-exponent guards, `toInt`'s range check, `toFloat`'s overflow guard (#533 — `FloatRangeError`, shared from `Float.hex` per Primitive Types §3; the edge that seats this companion after `Float.hex` in the prelude order), and the public instances (`Num`, `Signed`, `Eq`, `Ord`, `Show`, `Pow`, `Hash`, `Integral`) as source `honor` blocks. The **`BigInt.pow` door** joined at #541 and took the declaration form at #546 — `widens Pow.pow(value: BigInt, exponent: BigInt): BigInt` (Constraints §4.7), the exact power at exponents past `Int`'s range, one written body carrying the negative-exponent guard, whose restriction over the exact `Int -> BigInt` conversion **is** the `Pow<BigInt>` member, derived and accounted for in the block as `pow = widened` | the fifteen-key primop inventory of intrinsics §3.2 — every own-operation member body plus the conversions' unchecked cores (`bigIntAdd` … `bigIntToFloatUnchecked`), per Constraints §6.1's door-backed law |
| `Int.hex` | **landed** (#344): Euclidean `div`/`mod`, iterative `gcd`, the zero-divisor and negative-exponent guards, the checked family (`checkedAdd`/`checkedSub`/`checkedMul` as exact pre-checks — Primitive Types §2.1), and the public instances (`Num`, `Signed`, `Eq`, `Ord`, `Show`, `Pow`, `Hash`, `Integral`) as source `honor` blocks | the twelve-key primop inventory of intrinsics §3.2 (`intAdd` … `intRem`) — every own-operation member body except the keyless self-identity `fromInt`, per Constraints §6.1's door-backed law and its strictly-simpler counterpart |
| `Nat.hex` | **landed** (#344): the Euclidean `div`/`mod` and iterative `gcd` member bodies (coinciding value-wise with the truncated pair on the non-negative domain), the zero-divisor guards, the checked boundary conversion `fromInt`'s sign check (Primitive Types §1), and the public instances (`Num`, `Eq`, `Ord`, `Show`, `Pow`, `Hash`, `Integral`) as source `honor` blocks. `Pow<Nat>`'s member gained the family's **negative-exponent guard** at #541: the `Int` exponent seat makes a negative exponent spellable here, where the old homogeneous member's `Nat` seat refused it by type | the ten-key primop inventory of intrinsics §3.2 (`natAdd` … `natFromIntUnchecked`) — every own-operation member body plus the one conversion core |
| `Float.hex` | **landed** (#344): `mod` over `rem` (the Euclidean adjustment, Division & Remainder §5 — the only Hexagon-above-the-door logic; no guards exist at `Float`) and the public instances (`Num`, `Signed`, `Frac`, `Eq`, `Ord`, `Show`, `Pow`, `Hash`) as source `honor` blocks. The IEEE special-value surface joined at #358: `infinity` and `nan` as exact float divisions and `isNan`/`isFinite` over `Eq<Float>`, all four door-free plain exports — the detectors are load-bearing rather than convenience, since SameValueZero makes `x != x` uniformly `False` and Primitive Types §3 owns the reading. One exception joined at #526 without a guard joining with it: `FloatRangeError`, declared here and thrown by nothing in this file, because the range that fails is `Float`'s and the brand follows the declaring module — `Rat.toFloat` is its first thrower and the reason it exists, `BigInt.toFloat` its second (#533), and every door from an exact type into `Float` shares it rather than minting its own. The **`Float.pow` door** joined at #541 and took the declaration form at #546 — `widens Pow.pow(value: Float, exponent: Float): Float` (Constraints §4.7), the analytic power, total and honestly IEEE, one written body whose restriction to integer exponents **is** the `Pow<Float>` member, derived and accounted for as `pow = widened`. The wider wrapper surface (`Math` selections) stays a listing item | the twelve-key primop inventory of intrinsics §3.2 (`floatAdd` … `floatRem`) — every own-operation member body except the keyless composed `fromNat`, plus the one crossing conversion and the one plain-export core |
| `String.hex` | **landed** (#344): the public instances (`Eq`, `Ord`, `Show`, `Concat`, `Hash`) as source `honor` blocks, `Show`'s identity body keyless in ordinary Hexagon; companion algorithms (`length`, `join`, the codepoint bridge) stay listing/collections items — `fromSeq` left that list at #353, landed through the door per Part 5 §5.3's binding join note | the primop inventory of intrinsics §3.2: four keys from the landing (`stringConcat`, `stringEquals`, `stringCompare`, `stringHash`) — the codepoint-order walk among them, inexpressible without a codepoint API — and a fifth at #353, `stringFromSeq`, the plain-export row |
| `Seq.hex` | **the `Seq(a)` declaration itself** (`opaque record`, Loops §6.6) plus `next` and the combinator core (`iterate`, `map`, `filter`, `take`, `fold`, and the ship-list) | memoizing spine (`memoize`'s buffer + the FFI Part 3 inbound adapter) and the boundary traversal face (FFI Part 3 §9.4 — formerly listed as "the `toJsIterable` bridge"; see the 2026-07-28 edit note below) |
| `Vector.hex` | **landed** (#218): companion API in ordinary Hexagon above the eight-key boundary inventory of intrinsics §3.2 (`vectorLength` … `vectorFromSeq`, and `vectorToArray` for FFI Part 2 §9's outbound conversion); combinators stay a listing item | the persistent-vector representation core — landed as `runtime/VectorTrie.hex` (#299/#303) and wired at the emitter milestone (#306) |
| `Map.hex` | **landed** (#370): the Collections Part 4 §6.1 core in ordinary Hexagon above the seven-key inventory of intrinsics §3.2 (`empty`'s generalizing wrapper, `isEmpty`/`containsKey` over `size`/`get`, `keys`/`values` as projections of one `entries` traversal, the `toSeq`/`fromSeq` synonyms, `fromEntries`'s fold, `fromVector`), plus the `KeyError` prelude declaration; combinators stay a listing item | the seven-key inventory (`mapEmpty` … `mapEntries`) onto `runtime/HashTrie.hex`'s emitted module — six direct aliases of its operations, `mapEmpty` answering its one shared empty constant — the HAMT representation core the previous form of this row named |
| `Set.hex` | **landed** (#373): the Collections Part 4 §6.2 core in ordinary Hexagon above the eight-key inventory of intrinsics §3.2 (`empty`'s generalizing wrapper, `isEmpty` over `size`, the whole algebra — `union`/`intersect`/`difference`/`isSubsetOf` as §5.3's operations, specified iterate-one-side-and-modify (§2.2) and implemented to §2.2's min-/left-side bounds — and the `fromSeq`/`fromVector` pair); combinators stay a listing item | the eight-key inventory (`setEmpty` … `setLookup`; `setElements` surfacing as the §6.2 `toSeq`, `setLookup` unexported beneath `intersect`) onto `runtime/HashTrie.hex`'s emitted module through the wrapper record #373 ruled (`HashSet` over `HashTrie(a, Unit)`, carrying element-only iteration) — the HAMT membership/insertion/removal the previous form of this row named |
| `Range.hex` | public constructors and companion functions | iterator bridge; counting-loop erasure remains a compiler transformation |
| `Option.hex` / `Result.hex` | declarations, instances, and ordinary combinators | only genuine foreign-boundary helpers, if any |
| Prelude constraint sources | declarations and primitive `honor` blocks | derivation, evidence selection, and specialization |
| Prelude exception/function sources | public declarations and wrappers | JS `throw`, `Error` construction, hashing primitives, and other host operations |

*(Edit note, 2026-07-28, defect 12 ruling — FFI Part 3 §9.7.)* The `Seq.hex`
row's "`toJsIterable` bridge" residue is **discharged by merger**, not still
owed. The bridge is the boundary traversal face itself — every `Seq` value
carries `[Symbol.iterator]` as representation (FFI Part 3 §9.4), runtime-provided
exactly where this table kept it — and the public operation the obligation
imagined is `Seq.memoize` (Loops §6.4; declared per `spec/intrinsics.md` §3.2),
since after the ruling a distinct public `toJsIterable` could mean only the
identity or `memoize` itself. No second name ships (naming doctrine, §1). A
genuinely distinct future conversion surface (single-pass export, `JsValue`
integration) enters as a new row under ledger rule 1. The same ruling binds the
`Vector`/`Set`/`Map` boundary-face inheritance — FFI Part 3 §9.5 and Part 1
§8.2 — with no new residue added to their rows.

`stdlib/Vector.hex` now discharges the decided core companion surface from
Collections Part 3, backed by the narrow representation operations listed in that
spec. `stdlib/Option.hex` supplies the canonical `Option(a)` declaration required
by its total accessors. The broader Vector combinator ship-list (`map`, `filter`,
`fold`, `reverse`, `sort`, and the remaining listing candidates) remains a
separate obligation of the listing session.

The persistent HAMT implementation once embedded as an emitted TypeScript
string was especially misplaced: its structural core may remain a tuned runtime
component, but Map/Set public operations and derivable algebra should not live in the
emitter. *(Discharged in full, #373: the structural core is `runtime/HashTrie.hex`
(#365), `Map`'s public operations are `stdlib/Map.hex` source (#370), and `Set`'s
are `stdlib/Set.hex` source — the embedded string retired entire at the Set
milestone, as intrinsics §9.2 scheduled.)* Likewise,
compiler-known `Seq` algorithms and primitive-instance tables are
library source awaiting a sufficiently complete prelude loader, not language
semantics.

### 5.2 Incremental sequence

Proceed a piece at a time:

1. **Stage 1 — `BigInt.hex`:** establish `stdlib/BigInt.hex` as the canonical home
   of the existing `BigInt.*` surface without inventing a runtime namespace object.
   It is the first worked example of the all-companions rule, not a one-off cleanup.
   *(Amended and discharged, #344: the "package/prelude loader boundary" this stage
   anticipated is not how the home was established — the primitive companions join
   the **prelude set** itself, so prelude membership supplies both the module and
   the door privilege (intrinsics §5.2), and no loader-designation mechanism
   exists or is owed.)*
2. Reduce BigInt's compiler-owned boundary to the genuinely irreducible native
   operations that public Hexagon cannot express (`BigInt` truncated
   quotient/remainder while `BigInt` has no `/` and Hexagon has no `%`). Give those
   operations a narrow private intrinsic door rather than treating the whole
   companion as intrinsic. *(2026-07-28: the door now has its normative spelling —
   the `extern from "hex:intrinsic"` declaration form, `spec/intrinsics.md`
   (ruling on #125). Items 2 and 6's "private boundary" is that door; the
   schedule retiring the transitional public-name and primitive doors is its §9,
   with `BigInt.hex` inheriting the form at this stage with no further ruling.
   **Implemented 2026-07-28**: the form, the gate, and inventory verification are
   in the compiler, with `Seq.memoize` as the first customer through it. `BigInt`
   inherits the *form* with no new machinery — it adds inventory keys and their
   lowerings. **Superseded on the gate (#344):** this note anticipated widening
   privilege to loader-designated modules because `BigInt.hex` would not be a
   prelude member; it is one (stage 1 as amended), so the first bullet's prelude
   privilege covers it and no widening happened — intrinsics §5.2 records the
   reconciliation.)* **Discharged (#344)** — the keys landed with `BigInt.hex`
   (intrinsics §3.2's third worked example).
3. Move derived operations into understandable Hexagon source: Euclidean `div`/`mod`,
   iterative `gcd`, divide-first `lcm`, zero checks, and Hexagon exception branding.
   *(Discharged, #344: all of these are ordinary source in `BigInt.hex`; the
   branded exceptions live in their constraint homes — `DivideByZeroError` in
   `Integral.hex`, `NegativeExponentError` in `Pow.hex` — with the
   division-remainder §7 message shapes.)*
4. Move the coherent `Integral<BigInt>` instance to the appropriate canonical source
   home once prelude instance loading supports it; preserve the one-implementation,
   two-spellings contract between the companion functions and constraint members.
   *(Discharged, and strengthened, #344: **every** `BigInt` instance is a source
   `honor` block in `BigInt.hex`, not `Integral` alone — the member-is-real law
   (Constraints §4.6) leaves no coherent halfway point, since a companion cannot
   export a member's spelling beside its wired instance. The one-implementation,
   two-spellings contract survives as Modules §5.3's uniform access: `BigInt.div`
   *is* the member, qualified.)*
5. Retain compiler inlining/specialization latitude and readable generated JavaScript;
   a function being authored in `BigInt.hex` must not forbid an optimized helper or
   direct native operation after checking.
6. Record the resulting source/runtime/intrinsic pattern as the standard companion
   template: public declarations and Hexagon-expressible behavior live in canonical
   `.hex` source; only irreducible operations cross the private boundary.
7. Apply that template one companion at a time across the complete standard-library
   inventory — including `Int`, `Float`, other primitives, collections, sequences,
   ranges, and prelude nominal types. No big-bang rewrite; each stage lands as a
   usable, reviewable vertical slice.

After the BigInt worked example, the preferred order is:

1. primitive constraint declarations and their canonical instances — the declarations half is discharged (#335): every pre-registered constraint has canonical prelude source (`Show.hex`, `Num.hex`, `Signed.hex`, `Frac.hex`, `Pow.hex`, `Concat.hex`, `Eq.hex`, `Hash.hex`, `Ord.hex`, `Integral.hex`; the eleventh, `Iterable.hex`, joined at #353); the instances half is the companion arc (#344), landed per companion in the fixed order `BigInt`, `Int`+`Nat`, `Float`+`String` — **complete**; Constraints §5.3's wired-row-retirement law governed each landing and no wired instance remains;
2. `Seq.hex`, retaining only the memoizing spine and iterator bridge — **advanced from preference to decided obligation (2026-07-26): `Seq.hex` declares the type itself and joins the prelude set, before and as the pilot for `Vector`/`Set`/`Map`; see the §2 obligation row and `spec/notes/seq-deintrinsification-plan.md`**;
3. Map/Set algebra over a retained tuned HAMT core — *the core landed as `runtime/HashTrie.hex` (#365), the Map half as `stdlib/Map.hex` (#370, per the sequencing note below), and the Set half as `stdlib/Set.hex` (#373) — **complete***;
4. `Option.hex` and `Result.hex`; and
5. the remaining primitive and collection companions, one bounded slice at a time.

*(Edit note, 2026-07-28, #125 ruling.)* For the collection companions this
preferred order is **superseded by James's sequencing**: the `Vector` arc runs
next, before Map/Set (`spec/notes/seq-deintrinsification-plan.md` Phase 5
item 11), reversing item 3's placement relative to `Vector`, which this list
reached only at item 5. `spec/intrinsics.md` §9.2 binds the door-deprecation
milestones to that sequencing, not to this list. The order among items 1 and 4
and the primitives within item 7 is unchanged and still owed here.

Parsing, resolution, checking, exhaustiveness, derivation, evidence selection,
specialization, representation lowering, counting-loop erasure, and JavaScript FFI
mechanics are language/compiler responsibilities and are not candidates for migration
merely because their implementations also contain reusable-looking code.

The first motivation is explanatory and architectural: `stdlib/Rat.hex` should lead a
reader to a real `BigInt.hex` implementation, and the same trail must eventually exist
for every standard-library companion. Performance must be measured separately and is
not a reason to keep public declarations or derivable library algorithms hidden in
the compiler.

## 6. Discharge and maintenance

- Each row is discharged when the stdlib listing spec lands the surface (or records the defer) and this ledger's row is updated to point at the landing section; rows never silently disappear.
- The listing session inherits this ledger as its agenda; anything it adds mid-session gets a row first (ledger rule 1).
- Language/package/v2 deferrals that are **not** stdlib-owned stay in `spec-roadmap.md`; the FFI's non-stdlib deferrals stay in `ffi.md` §9.2. No row is duplicated across ledgers.
