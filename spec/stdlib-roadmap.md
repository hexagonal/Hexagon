# Hexagon Stdlib Roadmap — Global Ledger

**Status:** Decided and promoted after Sol review (July 2026), then amended by James's v1 `Rat` and `PlainDate` decisions. Seeded from the approved inventory (`notes/v1-spec-inventory.md` §3.3), audited against `spec-roadmap.md` §5, and verified row-by-row against each originating specification; the review added omitted roadmap work, corrected status classes, and completed the division/`Show`/`Hash<Float>` obligations. **This is the sole global ledger for stdlib-owned work.** It designs nothing and resolves no ship/defer question.

**Ledger rules.** (1) Every future "stdlib listing" export or newly discovered stdlib debt adds or updates a row here — no other ledger exists. (2) Statuses: **v1 obligation** (the listing must deliver it), **ship/defer decision** (the listing session decides, under the recorded constraints), **post-v1 candidate** (explicitly field-evidence-gated or post-v1 by its owner). (3) "Fixed semantics" cites constraints already normative in the owning spec — the listing may not relax them. (4) Rows are discharged by the stdlib listing spec (to be drafted; this ledger routes to it); each row's discharge column names the area. (5) Conflicting status claims between live sources are recorded, not chosen. One staleness noted this pass: `spec-roadmap.md` §5 still says the `Int.div`/`Int.mod` deep-dive is "owed", but `division-remainder.md` (Decided) closes Operators §14.3a — the roadmap wording is stale, not a live conflict; flagged for consolidation Part 5.

---

## 1. Binding doctrine on the whole listing (constraints with owners, not work rows)

| Rule the listing must honor | Owner |
|---|---|
| Naming doctrine: subject-first, companion-qualified, cost-honest names | `collections-part1-decisions.md` §3; `functions.md` §5.4 |
| Subject-first now also determines **dot-callability** (exported ∧ first-parameter-`T`-headed) | `method-syntax.md` §4.2/§15 |
| Accessor pair: `[]` throws / `get` returns `Option`; `try` prefix, if ever used, means "does not throw" | `collections-part1-decisions.md` §3.3 |
| Every prelude name needs a **qualified home** | `modules.md` §6.4 |
| `NullableCase.*` and `JsKind.*` constructors are **qualified-only** (no bare prelude auto-import) | `ffi.md` §12 |
| Collections/stdlib boundary: structure in Collections Parts 1–5; **combinator families in the listing** | `collections-part5-iterable.md` §10 |
| `Option`/`Result` failure-type boundary: membership projections may be `Option`; structured decoding is `Result(_, JsConversionError)`; owned per spec | `ffi.md` §11.2 |
| Rewrite Rule applies to any listing-introduced diagnostics | `decisions-sol-review-2026-07.md` §E |

## 2. V1 obligations (18)

| Surface / question | Origin | Fixed semantics | Revisit bar | Discharge |
|---|---|---|---|---|
| `Ordering` prelude union | `decisions-batch-2026-07.md` §3; routed by `spec-roadmap.md` §5 | `union Ordering = Less \| Equal \| Greater`; all-nullary string representation; `derives (Eq, Show)` on the prelude declaration | — | listing: prelude inventory |
| `ignore` | `statements-blocks-mutability.md` (discard rule; diagnostic names `ignore(...)`; emission `ignore(e)` → `e;`) | required by the discard diagnostic's own rewrite; identity-discard semantics | — | listing: prelude inventory |
| `throw : Exn -> a` | `exceptions.md` §1/§4 | ordinary prelude function, not a keyword; diverges (fresh result variable) | — | listing: prelude inventory |
| `Result.attempt` | `exceptions.md` §8.2 | prelude addition as specified there; `Exn` error side; `.d.ts` face per `exceptions.md` §7.5 | — | listing: prelude inventory |
| Integer division/remainder companion surface (`Int`/`BigInt` `div`/`mod`/`quot`/`rem`; `Float.mod`/`rem`) | `division-remainder.md` (final; closes Operators §14.3a); routed by `spec-roadmap.md` §5 | complete inventory, conventions, and zero-divisor behavior are fixed by `division-remainder.md`; the listing records them without reopening the deep dive | — | listing: numeric |
| `Float` instances (`Eq`/`Ord`, and `Hash<Float>` normalization) | `decisions-batch-2026-07.md` §1; `collections-part2-hash-and-type-members.md` §2.3/§2.5 | `Eq<Float>` = SameValueZero; `Ord<Float>` = consistent total order (`NaN` after `+Infinity`, `±0` equal); `Hash<Float>` normalizes `-0` with `+0` and every NaN bit pattern to one hash value | — | listing: prelude instances |
| Required `Show` instances already mandated by type and collection owners | `primitive-types.md` §7; `products.md` §2.5/§3.4; `unions.md` §7; `collections-part3-vector.md` §8; `collections-part4-map-set.md` §8.3 | display semantics and conditional constraints are fixed by owners; the listing records the instance inventory rather than redefining it | — | listing: prelude instances |
| `memoFix` / open-recursion support surface | `functions.md` §7.5 | the blessed idiom for memoized recursion; behavior sketched normatively there (map + local `fun go` + `f(go, n)`) | — | listing: prelude functions |
| `Rat` rational type: focused specification plus stdlib module | `integral-constraint.md` §1/§9; `division-remainder.md`; `numeric-literals.md` §5; James's v1 decision | v1 requirement; numerator and denominator are represented with `BigInt` (fixed, not revisitable), with Euclidean normalization, fixed integer division conventions, and exact integral `fromInt`; the focused spec fixes encapsulation, exact runtime shape, and API | — | focused `Rat` spec, then listing: numeric types |
| `PlainDate` date-only type: focused specification plus stdlib module | James's v1 decision (July 2026); Temporal `PlainDate` naming precedent | v1 requirement; `export opaque record PlainDate = {year: Int, month: Int, day: Int}` with only valid proleptic ISO 8601 dates inhabiting the type; smart construction and parsing validate; accessors expose all three components; canonical ISO rendering; derived `Eq`/`Hash` and manual chronological `Ord` (year, then month, then day); no time, time zone, non-ISO calendar, or locale formatting surface | — | focused `PlainDate` spec, then listing: date types + `stdlib/PlainDate.hex` |
| Composable `JsValue` decoder family: field/record traversal, element-wise decoders, `nullable`/`oneOf`/defaults, map/set decoders | `ffi.md` §9.1.1; `ffi-part11-js-value-errors.md` §9.1/§13.2 | built over Part 11's primitives, `JsConversionError` structure, closed 5-segment path vocabulary; `Err` vs `JsError` channel doctrine | — | listing: FFI/decoding |
| Qualified companion homes for `NullableCase.Undefined/Null/Value` and all ten `JsKind.*` constructors | `ffi.md` §9.1.2/§12 | qualified-only exposure; representations unchanged; ordinary companion qualification | — | listing: prelude inventory |
| Combinator families for `Vector`/`Map`/`Set`/`Seq` — **producing the v1 ship-list is the obligation; individual combinators remain listing decisions** | `collections-part5-iterable.md` §10; `collections-part3-vector.md` §12.2 (`reverse` needed by §6.3 idiom; `sort` referenced by `collections-part4-map-set.md` §7.1 guidance) | subject-first; complexity contracts per owning collection specs; `Seq`-consuming combinators constant-stack (`loops-ranges-iteration.md` §6; `ffi-part3-seq.md` §6) | — | listing: collections combinators |
| `iterate` qualified home (`Iterable.iterate` or equivalent) | `collections-part5-iterable.md` §2.3/§4 (via `modules.md` §6.4 invariant) | `iterate` is an ordinary prelude term; member of `Iterable` | — | listing: prelude inventory |
| Companion inventories for `Range`, `Seq`, the primitives, and the prelude nominals `Option`/`Result`/`Ordering` (what exists to dot-call; membership of each inventory remains a listing decision) | `method-syntax.md` §12.3 (+§14(k) `Option.getOrElse` as the worked companion example); `collections-part5-iterable.md` §4; `unions.md` §8 | dot-callability mechanism fixed (§1); `Range` iteration semantics per `loops-ranges-iteration.md` §3/§5; `Option`/`Result` declarations fixed by `unions.md` §8 | — | listing: per-type companions |
| Wrapper-key pattern's first customer (`CiString`) | `collections-part2-hash-and-type-members.md` §4.5 ("first customer owed"); §12.1 | wrapper-key mechanism fixed (compiler-provided `Hash`/`Eq` via `derives`); **folding semantics undecided** (full case fold vs `toLowerCase`-family — §12.1, decided at the listing) | — | listing: string/key types |
| Hostile-specimen constraint-library exercise (ten unrelated user constraints; collision-pressure measurement) | `decisions-sol-review-2026-07.md` §A.5 | pre-registered process obligation; outcome feeds §A's qualified-as-default question and `method-syntax.md` §12.1 | if collisions prove constant, qualified-as-default returns | listing session (report) |
| Subject-first convention enforcement audit across the completed listing | `spec-roadmap.md` §5; `collections-part1-decisions.md` §3 | subject-first is binding doctrine (§1); every adopted companion operation is checked against it and the dot-callability consequences | — | listing session (process) |

## 3. Ship/defer decisions (11; the listing session decides, constraints recorded)

| Surface / question | Origin | Fixed semantics | Revisit bar | Discharge |
|---|---|---|---|---|
| `Map.merge` family, `Map.update`/`filter`/`mapValues`/`getOr`/`containsValue`; `Set.map`/`filter` | `collections-part4-map-set.md` §13.1; `getOr` also `collections-part1-decisions.md` §3.3 | `merge`'s key-representative rule bound by `collections-part4-map-set.md` §5.4 (values last-wins; key representatives first-wins/left-wins); `<Hash>` constraints per §2.2 | — | listing: Map/Set combinators |
| `Exn` instances (`Show<Exn>`, any constraint on `Exn`) | `exceptions.md` §10.3–10.4 (**presumption: none in v1 — requires confirmation here**); `collections-part2-hash-and-type-members.md` §4.2 (no `Hash<Exn>`, enforced) | if confirmed none, the listing records the absence as deliberate; `Hash<Exn>` is already syntactically foreclosed | — | listing: prelude instances |
| `Range` `Eq`/`Show`, and dependent `Hash<Range>` | `loops-ranges-iteration.md` §3.6 (**still open**); `collections-part4-map-set.md` §13.2 | until decided, `Range` keys in persistent collections are unsatisfiable — **that absence is load-bearing for `collections-part4-map-set.md` §4.4's slicing dismissal; deciding this must re-check it** (`JsMap` needs no `Hash`, `ffi-part10-js-map-set.md` §4.3, so the foreign door already changed the landscape once) | — | listing: prelude instances |
| `Float.ieeeEquals` / raw-IEEE escape hatches | `decisions-batch-2026-07.md` §10.2 (explicitly the stdlib listing's decision) | `Eq<Float>` stays SameValueZero regardless; any escape hatch is a named function, never an instance change | — | listing: numeric |
| `toJsMap`/`toJsSet` classification decoders | `ffi.md` §9.1.3; `ffi-part11-js-value-errors.md` §13.1 | strict, non-coercing decoding returning `Result(_, JsConversionError)`; `Err` = data wrongness, hostile throws travel `JsError` (`ffi-part11-js-value-errors.md` §1) | **absence of a portable property-free classifier**: `instanceof` fails cross-realm; the workable intrinsic brand checks are awkward throw-based probes | listing: FFI/decoding |
| `JsMap.keys`/`JsMap.values` projections; `JsSet` algebra reads | `ffi.md` §9.1.4; `ffi-part10-js-map-set.md` §9.1–9.2 | derivable via `toSeq` combinators or conversion; borrowed-view semantics fixed by `ffi-part10-js-map-set.md` | field demand | listing: FFI collections |
| `Nullable` conveniences / conversion aliases | `ffi.md` §9.1.5 | must honor `ffi-part2-nullable-array.md`'s companion surface and its supersession of Unions §8 spellings | — | listing: FFI/Nullable |
| Monomorphic per-type `show`/`toString`-style companion exports (`Int.show` etc.) | `method-syntax.md` §7/§12.4 | mechanism indifferent (ordinary companion call if shipped; never constraint dispatch via dot) | — | listing: per-type companions |
| `String.join(sep, xs)` and string conveniences | `collections-part5-iterable.md` §5.3/§14.2 | `String.fromSeq` concatenation contract fixed (§5.3, incl. linear-complexity implementation note); `join` supplements, never replaces | — | listing: String |
| `Hash` for prelude unions (`Ordering` et al., via `derives` on prelude declarations) | `collections-part2-hash-and-type-members.md` §12.3 | derivable-only `Hash` doctrine (§4) | — | listing: prelude instances |
| Numeric narrowing set (`Int.fromFloat`, kin) | `ffi-part1-boundary.md` §6 ("if included") | checked, `Option`-returning, `Number.isSafeInteger` discipline; `BigInt.toInt` already core | — | listing: numeric |

## 4. Post-v1 candidates (3; explicitly field-evidence-gated by their owners)

| Surface / question | Origin | Fixed semantics | Revisit bar | Discharge |
|---|---|---|---|---|
| `Set.isSupersetOf` | `collections-part4-map-set.md` §12.3 ("candidate at most, only if field usage shows the flipped call is a real pain") | flipped-argument `isSubsetOf` exists | field evidence | listing (post-v1 review) |
| Public `Range.toSeq` | `collections-part5-iterable.md` §14.3 ("candidate at most") | `Range` iterates without it; its `iterate` is runtime-internal | field demand | listing (post-v1 review) |
| Grapheme-cluster iteration for `String` | `collections-part5-iterable.md` §5.1 | named stdlib function if ever; the `Iterable` instance is codepoints permanently | field demand | listing (post-v1 review) |

## 5. Discharge and maintenance

- Each row is discharged when the stdlib listing spec lands the surface (or records the defer) and this ledger's row is updated to point at the landing section; rows never silently disappear.
- The listing session inherits this ledger as its agenda; anything it adds mid-session gets a row first (ledger rule 1).
- Language/package/v2 deferrals that are **not** stdlib-owned stay in `spec-roadmap.md`; the FFI's non-stdlib deferrals stay in `ffi.md` §9.2. No row is duplicated across ledgers.
