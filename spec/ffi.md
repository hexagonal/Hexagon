# Hexagon FFI: Consolidation and Conformance (Part 12)

**Status:** Decided and promoted after Sol review (July 2026). Drafted per `spec/notes/ffi-roadmap.md` Part 12; the draft's two bounded open questions and the naming-audit finding were resolved at promotion review and are recorded closed in §§11–12: the generated `Hex` alias uses **first-free numeric suffix probing** against every emitted top-level `.d.ts` identifier (§11.1); Foreign Enums' `fromJsT` **keeps `Option`**, with the precise `Option`-versus-`Result` boundary stated (§11.2); and the `NullableCase`/`JsKind` constructor collision is resolved by **qualified-only prelude exposure of both unions' constructors** (§12). Reconciliation corrections applied in place: the ESM invariant admits inbound `default fun`/`default let` bindings (§5.8); the checked-failure invariant permits explicitly owned `Option` projections (§5.10); Part 6's deferral is callback-*visible* `this` (§2, §9.2); stdlib obligations are split from ship-versus-defer candidates (§9.1); the `.d.ts` conformance row scopes the `Hex` import to need (§8). This document remains an **index, reconciliation layer, and conformance matrix — not a redesign and not a concatenation**.
**Scope:** Authority and reading model; component index; consolidated terminology; surface ownership router; cross-part invariants; master representation/face summary; the assembled diagnostic and acceptance matrices; consolidated deferrals; companion discharges; the closed review resolutions; the global naming audit.
**Not in scope:** any new FFI semantics (Parts 1–11 and Foreign Enums own everything); corpus-wide archival/removal of drafting history (`spec/notes/v1-spec-consolidation-plan.md`'s later consolidation, not this closeout); the stdlib listing (debts routed there are enumerated in §9.1, not designed here).

---

## 1. Authority and reading model

- **Parts 1–11 and `ffi-foreign-enums.md` remain normative.** They are not pasted here and are not demoted. The promotion amendments named in §§11–12 have been recorded in their owning parts, so this file introduces no parallel rule.
- **`ffi.md` is the canonical FFI entry point**: start here, follow the ownership map (§4) to the part that owns the question, and read detail there. Where two parts state the same rule, §5 names the single authoritative owner; the other statement is a restatement and yields to it.
- **Precedence within the corpus:** a part's own scope is authoritative for its topic; correction records and review-resolution sections (each part's §-stable practice) supersede the corrected text they annotate; this index supersedes nothing.
- Component (non-FFI) specs cited throughout — Exceptions, Modules, Unions, Products, Functions, Operators, Loops, Collections Parts 1–5, Constraints, Method Syntax — remain authoritative for their own subject matter exactly as each part records.

## 2. Component index

| Part | Topic | File | Principal surface / decision | Key dependencies | Deferrals / exported debts |
|---|---|---|---|---|---|
| 1 | Boundary doctrine & type mapping | `ffi-part1-boundary.md` | trusted-declaration doctrine; four categories; master table; nested-adapter hard error (§5.3); numeric trust; `JsError` door; `Hex` namespace, `Hex.Range` | Exceptions §6; Primitive Types; Loops §8 | `Hex`-alias scheme (**resolved**, §11.1 here); async/Promise semantics |
| 2 | `Nullable` & borrowed `Array` | `ffi-part2-nullable-array.md` | zero-wrapper `Nullable` + idempotence; `NullableCase`/`toCase`; borrowed `Array` stability contract; accessor pair; `.length` rewrite error; conversion suite | Part 1; Collections Parts 1/3/5 | flow narrowing (language deep dive); default parameters |
| 3 | `Seq` interoperation | `ffi-part3-seq.md` | one-iterator memoizing adapter; fresh adapter per crossing, no identity cache; replayable export; no deterministic disposal | Part 1 §2.3/§5.3; Loops §6 | single-pass iterator type; async iteration; callback-position adapters |
| 4 | `extern` modules & bindings | `ffi-part4-extern-bindings.md` | `extern from` block; foreign-name-first `as`; `fun`/`let` split; `type`; `default`; `extern import`; elision rule; `extern let` stability | Part 1; Modules §2–§3/§8.1 | globals; CommonJS; overloads; rest; string export names; generics (family) |
| 5 | Receiver members & classes | `ffi-part5-extern-classes.md` | `method`/`get`/`set` subject-first; fresh-read rule; honest-`Unit` set; stable convention-preserving wrappers; `extern class` = opaque type + flat companions; `new as create`; statics; all-or-nothing visibility; dot-call reach | Parts 1/4; Method Syntax | typed upcasts across foreign inheritance; symbol-keyed members; selective visibility; subclass-dependent APIs |
| 6 | Functions & callbacks | `ffi-part6-functions-callbacks.md` | identity calling convention; exact arity / no runtime validation; `Unit` discarding rule; exception round trips; representation-direct-only callbacks; same-object identity; callback `this` ignored | Parts 1/3/4/5; Functions §5/§9; Exceptions §6–§7 | adapting callbacks; wrapper caches; async callbacks; callback-**visible** `this` and receiver-aware callback types (invocation-supplied `this` is already ignored and unobservable in v1) |
| 7 | Exports & `.d.ts` | `ffi-part7-exports.md` | export correspondence; named-ESM-only; lowercase binders; `Hex` import; records/unions/constructor materialization; representation cliff warning; **uniform opaque brand**; exceptions incl. nullary function shape; direct-vs-wrapper rule | Parts 1/3/6; Modules §11; Unions §6; Exceptions §7 | — (constrained exports routed to 8–9) |
| 8 | Zero-cost fundamental exports | `ffi-zero-cost-fundamental-exports.md` | closed six-type set; Algorithms S/G/N; complete-public-assignment trigger; base-name reservation; collision hard errors; ABI events | Parts 7/9; Constraints §6 | pre-v1 fundamental-set review (§2.2 there) |
| 9 | Exported dictionaries | `ffi-part9-exported-dictionaries.md` | `Constraint.Dictionary<a>` completed-member shape + inference-bearing brand; instance-home rule for handles/factories; public-evidence closure; (ordinal, constraint) suffix; maximal-constraint elimination; direct export unless ABI plumbing; dictionary ABI | Parts 7/8; Constraints §5–§6; Modules §7 | variadic evidence seam; package ABI metadata (package spec) |
| 10 | `JsMap` / `JsSet` | `ffi-part10-js-map-set.md` | borrowed views, `ReadonlyMap`/`ReadonlySet` faces; no-`Hash` native equality (stated loudly); `jsMap[k]`+`KeyError`, `has`-before-`get`, no fusion; no set brackets; 2 `Iterable` rows; `fromSeq`; 4 snapshot conversions, inward cycle-checked `Result` | Parts 1/2/3/11; Collections Parts 1/4/5; Operators §10 | `keys`/`values` projections; set algebra; mutable door; `WeakMap`/`WeakSet` |
| 11 | `JsValue`, decoding, conversion failure | `ffi-part11-js-value-errors.md` | `JsValue` (`unknown` face, absorbs nullish); total property-free `kind`; strict scalar decoders + `toArray`; **`JsConversionError` = ordinary data** (`{reason, path}`); closed 5-segment path vocabulary; conservative `JsError.message`/`stack`; two-channel doctrine | Parts 1/2/10; Exceptions §6 | composable decoder family (stdlib ledger); `toJsMap`/`toJsSet` (cross-realm revisit bar) |
| — | Foreign enums | `ffi-foreign-enums.md` | `extern enum` = foreign-backed nullary union over stable enum-object members; `Object.is` matching; generated checked `fromJsT`; reverse mappings ignored | Parts 1/4; Unions | `const enum`, flags, literal unions excluded; `fromJsT` keeps `Option` (**resolved**, §11.2 here) |

## 3. Common terminology (consolidated by reference; no alternatives exist)

| Term | Meaning | Owner |
|---|---|---|
| **representation-direct** | value already has its declared JS representation; crosses unchanged | Part 1 §2.1 |
| **borrowed foreign view** | zero-copy foreign-owned storage, observed under a stability contract | Part 1 §2.2 (instances: Part 2 §6, Part 10 §2) |
| **adapted foreign capability** | supported top-level wrapper establishing stronger Hexagon semantics (`Iterable<a>` → `Seq(a)`) | Part 1 §2.3, Part 3 |
| **converted value** | explicit eager named operation building a new representation | Part 1 §2.4 |
| **trusted declaration / contract violation** | declarations are believed; violation ⇒ unspecified affected observations, no runtime checks | Part 1 §1/§3.1 |
| **defined checked failure** | a named conversion/decoder's own specified failure — distinct from contract violation | Part 1 §3.3 |
| **identity crossing** | the runtime object *is* the value on both sides (`Vector`, opaque values, functions) | Part 1 §4.2 |
| **stable module-level wrapper** | named boundary-function wrapper allocated once with its ESM binding; identity-stable | Part 6 §1 (occasions), Part 7 §7 (emission) |
| **fresh per-value adapter** | per adapted value, created at each crossing; never identity-cached | Part 3 §2.1 |
| **shallow conversion** | named conversions change only the collection they name; elements keep value and identity | Part 1 §5.1 |
| **Hexagon-owned value vs. borrowed foreign view** | `Hex.*` persistent values cross by identity; `Array`/`JsMap`/`JsSet` are observed foreign storage | Part 1 §4.1 |
| **`JsError` (thrown control) vs. `JsConversionError` (data in `Err`)** | foreign throws travel the one exception door; checked wrongness is an ordinary record in `Err`; never mixed | Part 11 §1 (channel doctrine), Exceptions §6 (`JsError` itself) |
| **`.d.ts` face vs. runtime representation** | what TypeScript is told vs. what the value is; faces may be weaker (`Seq` → `Iterable`), never false | Part 1 §4.1; Part 7 §2 |

## 4. Surface ownership map

| You are asking about… | Go to |
|---|---|
| what a type looks like across the boundary; category; failure doctrine; nested-position legality | Part 1 (§4 table; §5.3) |
| `Nullable` companion surface, `toCase`, `Option` conversions; `Array` accessors, slices, sparse holes, stability | Part 2 |
| foreign iterables, `Seq` adapters, retention, iterator closure, exported replayability | Part 3 |
| `extern from`, aliasing, `fun`/`let`, `type`, `default`, `extern import`, elision, annotations | Part 4 |
| `method`/`get`/`set`, receiver wrappers, `extern class`, `new as create`, statics, class visibility, dot calls on extern types | Part 5 |
| foreign enums (`extern enum`, `fromJsT`) | `ffi-foreign-enums.md` |
| arity, calling convention, `Unit`, callbacks, callback identity, exception round trips | Part 6 |
| what gets exported, `.d.ts` shapes, constructors, opaque brands, exceptions-for-JS, wrapper-vs-direct | Part 7 |
| fundamental specializations, generated names, the generic-edition trigger | Part 8 |
| dictionary types, evidence handles/factories, suffix ordering, dictionary ABI | Part 9 |
| `JsMap`/`JsSet` surfaces, brackets, iteration, conversions, `fromSeq` | Part 10 |
| `JsValue`, `kind`, strict decoders, `JsConversionError`, paths, `JsError.message`/`stack` | Part 11 |

## 5. Cross-part invariants (stated once; owners authoritative)

1. **No implicit deep conversion.** Named conversions are shallow; an extern signature is a recursive representation contract, never a traversal request. — Part 1 §5.1–5.2.
2. **No general defensive validation of trusted declarations.** Checks live only in named operations establishing invariants or protocol-required minimums. — Part 1 §1/§3.2.
3. **Wrapper occasions are a closed set:** adapted top-level positions; receiver members; constrained generic editions *only when public ABI plumbing requires one* (a matching internal trailing-evidence function exports directly). — Part 6 §1 (the set); Part 7 §7 + Part 9 §9 (the direct-export correction).
4. **Every named boundary-function wrapper is module-level and identity-stable; per-value adapters may be fresh** — the wrapper/adapter distinction is never blurred. — Part 6 §1; Part 3 §2.1.
5. **V1 callback signatures are representation-direct**, recursively; the same JS function object crosses both ways; adapter-requiring callback signatures are hard errors. — Part 6 §5.
6. **Borrowed views expose no mutation and require foreign stability**; under valid use, live and snapshot observation coincide, licensing native iteration and two-step lowerings. — Part 1 §2.2; Part 2 §6; Part 10 §2.
7. **`Seq` positions are persistent; adapters memoize one outcome per node; every crossing gets a fresh adapter and repeated crossings of single-shot sources observe current position** (rewrite: cross once, share the `Seq`). — Part 3 §2.1/§4.
8. **ESM only; named exports only, in one direction**: bindings import ESM, and an inbound extern declaration **may bind a JavaScript default export** (`default fun`/`default let`, and `default class` per Part 5) — but Hexagon **emits named exports only and never emits its own default export**; `export` is the sole foreign-export permission (one stated exception: Part 8 §3.4). — Part 4 §1–§2/§6; Part 7 §1.
9. **All nominal opaque `.d.ts` faces use the one non-exported-`unique symbol` brand mechanism** — opaque records, opaque unions, extern types, extern class types; dictionary brands are the same mechanism with an inference-bearing slot. — Part 7 §5; Part 9 §2.2.
10. **Checked wrongness is ordinary data; foreign throws travel `JsError`; the channels never mix and neither is synthesized from the other.** The composable decoding surface reports wrongness as `Err(JsConversionError)` so reasons and paths compose; **explicitly owned partial projections may instead return `Option` where their specification says so** (the generated foreign-enum `fromJsT` is the blessed instance — §11.2). No claim is made that every checked operation returns `Result`. — Part 11 §1/§5; Foreign Enums §5.2.
11. **Nullish absorption is one idempotency principle over a closed designated set:** `Nullable(Nullable(a)) ≡ Nullable(a)`, `Nullable(JsValue) ≡ JsValue`; no structural nullish analysis. — Part 11 §8 (Part 2 carries the propagated rule).
12. **Part 10's shallow conversions originate `MapKey`/`SetElement` path segments only — never `MapValue`**, which is reserved for genuinely value-traversing conversions. — Part 11 §6.3; Part 10 §7.3.

## 6. Master representation and TypeScript-face summary

Final names and faces only; the authoritative full table is **Part 1 §4.1**, detail per owner:

| Family | Runtime representation | `.d.ts` face | Detail |
|---|---|---|---|
| `Int`/`Float`/`BigInt`/`Bool`/`String`/`Unit` | native primitives; `Unit` = `undefined` | `number`/`number`/`bigint`/`boolean`/`string`/`void`-in-return | Part 1 §4/§6 |
| tuples / structural records / nominal records | JS arrays / POJOs | TS tuples / structural object types | Part 1; Part 7 §3 |
| unions / `Option(a)` / exceptions | tagged POJOs; all-nullary = strings; branded `Error` | discriminated unions; string unions; `Error & {$hex…}` | Unions §6; Exceptions §7; Part 7 §4/§6 |
| `Nullable(a)` | `a \| null \| undefined` (zero wrapper) | the same union | Part 2 |
| `Array(a)` | borrowed foreign JS array | `ReadonlyArray<a>` | Part 2 §6 |
| `Seq(a)` | runtime sequence / inbound memoizing adapter | `Iterable<a>` (export is stronger: replayable) | Part 3 |
| `Vector` / persistent `Map` / `Set` / `Range` | runtime objects, identity crossing | `Hex.Vector<a>` / `Hex.Map<k,v>` / `Hex.Set<a>` / `Hex.Range` | Part 1 §8 |
| `JsMap(k,v)` / `JsSet(a)` | borrowed native `Map`/`Set` | `ReadonlyMap<k,v>` / `ReadonlySet<a>` | Part 10 |
| `JsValue` | any JS value, identity | `unknown` | Part 11 |
| opaque families (opaque record/union, extern `type`, extern class) | erased/foreign value, identity | generated private-symbol brand | Part 7 §5 |
| `extern enum` | captured foreign member values | per `ffi-foreign-enums.md` §7.2 | Foreign Enums |
| functions/callbacks | n-ary JS functions, same order, same object | function types | Part 6 |
| dictionaries (JS-facing evidence) | frozen-where-practical runtime records | `Constraint.Dictionary<a>` (branded) | Part 9 |

## 7. Complete diagnostic matrix

Assembled by phase and ownership; wordings and Rewrite-Rule remedies live with the owners — nothing new is introduced here.

**Extern declaration syntax and aliasing (compile):** callable-with-`let` / `fun`-without-params → Part 4 §4.2; function-typed extern `let` → Part 6 §2.4; case-illegal foreign name needs alias → Part 4 §3.2; `as` on `default` → Part 4 §6; bodies / missing annotations → Part 4 §1; specifier names a Hexagon module → Part 4 §2.1; generic extern declaration → Part 4 §12.4; extern-enum member list problems → Foreign Enums §2/§8.

**Receiver/class shape (compile):** missing subject; non-crossable receiver; wrong-class subject; `get`/`set` arity; non-`Unit` `set`; getter/setter name clash (alias rewrite); `new` without `as`; per-member `export`; `extends` → all Part 5 §11.

**Unsupported nesting and callbacks (compile):** adapter-requiring type in a direct aggregate/borrowed container → Part 1 §5.3 (single owner; Parts 2/3/8/10 inherit); adapter-requiring callback signature → Part 6 §5.4 (three named rewrites).

**Exports, names, collisions (compile):** generated specialization/name collisions and generated-vs-generated → Part 8 §6.2; handle/factory-vs-explicit-export collision → Part 9 §12; import/binding collisions → Modules §5 (Part 4 §3.2 inherits); `Hex`-alias and brand-identifier collisions in generated `.d.ts` → emitter obligations, Part 1 §8 / Part 7 §5 (alias algorithm fixed at §11.1 here).

**Constrained exports and evidence (compile + TS-side):** missing/mismatched evidence (TS brand catches) → Part 9 §12; absent generic edition documentation pointer → Part 9 §12; ABI incompatibility report → Part 9 §11.

**Borrowed views and brackets (compile + runtime):** `.length` habit → Part 2 §6.3; write-position brackets → Collections Part 1 §3.3 (Parts 2/10 inherit); `jsSet[x]` → Part 10 §5; absent key → `KeyError`/`None` per Part 10 §4; out-of-bounds/`IndexError`, slice behavior → Part 2 §6.3 (Collections Part 3 doctrine).

**Checked decoding (runtime, defined results — not errors):** `Shape`/`Range`/`Cycle` reasons with paths → Part 11 §5–§6; enum `fromJsT` miss → `None`, Foreign Enums §5.2 (`Option` boundary recorded at §11.2 here); revoked-proxy asymmetry (`kind` total vs `toArray` → `JsError`) → Part 11 §3/§4.2.

**Deliberately not diagnosed (contract violations; unspecified observations):** numeric contract violations; borrowed-view mutation during a borrow (incl. between `has`/`get`, under an escaped `Seq`); wrong-arity/ill-typed JS calls into exports; `extern let` reassignment; fabricated dictionaries/brands; resource-owning iterators fed to `Seq` — Part 1 §3.1 owns the doctrine; Parts 2/3/4/6/9/10 record the instances.

## 8. Acceptance and conformance matrix

Each row: the observable claim an implementation must satisfy, and the owner whose acceptance material (tests, worked examples, algorithms) defines it. Component test sketches are not duplicated here.

| Category | Observable claim | Owner |
|---|---|---|
| Parsing & checking | extern blocks/members/enums parse per grammar; all §7 compile diagnostics fire with their named rewrites; nested-adapter and callback rejections fire at declaration site | Parts 4–6, 1 §5.3; Foreign Enums §9 |
| Readable JS emission | bindings emit named ESM imports; calls emit at declared arity with source order; receiver members emit receiver forms; brackets emit the two-step `has`/`get`; match/constructor emission per component specs | Parts 4–6, 10; Modules §11; Unions §6 |
| `.d.ts` emission | one `.d.ts` per module; **exactly one type-only `Hex` import, present only when a `Hex.*` face is needed** (§11.1's alias probing on collision); lowercase binders in declared order; faces per §6 exactly (final names, no provisional forms); cliff warning present on all-nullary unions | Part 7; Part 1 §8; §11.1 |
| Identity & wrapper allocation | representation-direct exports/functions are the raw objects; each wrapper occasion allocates exactly one module-level wrapper with stable identity; direct export of matching trailing-evidence functions | Parts 6 §1, 7 §7, 9 §9; Part 5 §2.3 |
| Iterator persistence & crossings | `Seq.next` never consumes; one iterator, one memoized outcome per node; fresh adapter per crossing; exported `Seq` yields independent cursors; protocol failures memoized; native protocol access order | Part 3 §§2–7 |
| Callbacks & exceptions | same function object both directions; extra JS args harmless; Hexagon throws stay branded through foreign frames; foreign throws land in `JsError`'s branch; `Unit` results discarded inbound, genuine `undefined` outbound | Part 6 §§2–5, §10 |
| Opaque branding & constructors | brand-only faces for all four opaque families; no runtime artifact; constructors materialized at export (records, unions, exceptions — nullary exceptions function-shaped with fresh stacks) | Part 7 §§3–6 |
| Constrained specialization & dictionary ABI | Algorithm S/G/N surfaces exactly; base-name reservation; handles/factories per instance-home rule; suffix by (ordinal, constraint) after maximal-constraint elimination; frozen-where-practical dictionaries; ABI events as listed | Part 8 §§3–10, §16; Part 9 §§3–8, §11 |
| Map/Set behavior | native-equality lookups with no `Hash`; bracket/`KeyError` semantics incl. present-`undefined`; no fusion; insertion-order iteration; four conversions' collapse/cycle semantics; `fromSeq` construction | Part 10 §§3–7 |
| `JsValue` & decoding | ten-kind total property-free `kind` (revoked proxy → `Object`); strict decoders' exact success conditions; `toArray` unguarded probe → `JsError`; path composition, 1-based positions, current+first-seen cycle paths; conservative `message`/`stack` per algorithm | Part 11 §§3–7 |

## 9. Deferred and externally owned work (consolidated, not designed)

### 9.1 V1 stdlib work (global ledger per `v1-spec-consolidation-plan.md`)

**Obligations — the stdlib listing must deliver these:**

1. **The composable `JsValue` decoder family** — field/record traversal, element-wise decoders, `nullable`/`oneOf`/defaults, and map/set decoders, built over Part 11's primitives, error structure, and path vocabulary. A real v1 stdlib debt; ledger entry issued by Part 11 §10.
2. **Qualified companion homes for `NullableCase.*` and `JsKind.*` constructors** (§12's resolution) — the prelude inventory must provide both.

**Candidates — ship-versus-defer decisions the listing owns, each with its recorded revisit bar; none is a mandatory v1 surface:**

3. **`toJsMap`/`toJsSet` classification decoders** — carrying Part 11 §13.1's cross-realm revisit bar (no portable `Array.isArray`-equivalent).
4. **`JsMap.keys`/`JsMap.values` projections and `JsSet` algebra reads** (Part 10 §9 — derivable today via `toSeq` combinators or conversion).
5. FFI-adjacent companion conveniences referenced by the parts (e.g. `Nullable` helpers, conversion aliases) — whatever the listing adopts must honor the decided semantics and update the ledger.

### 9.2 Post-v1 language/FFI deferrals (each with its recorded owner and revisit bar)

- **Async/Promise integration** — `AsyncSeq`, rejection channels, promise-returning/async callbacks (Part 1 §4.4; Part 3 §10; Part 6 §8).
- **Overloads; rest/variadic; optional/default parameters** (Part 4 §11; Part 6 §8) — variadic trailing-evidence extraction pre-registers runtime brand validation (Part 9 §10).
- **CommonJS binding forms; ambient globals; arbitrary-string export names; symbol-keyed members** (Part 4 §11; Part 5 §12).
- **Generic extern declarations/classes** — deferred as one family (Part 4 §12.4).
- **Callback adapters, wrapper identity caches, callback-visible `this` and receiver-aware callback types** (Part 6 §8; single concrete-foundational-API revisit bar). Invocation-supplied `this` is not deferred — it is already ignored and unobservable (Part 6 §6).
- **Mutable foreign collections; `WeakMap`/`WeakSet`** (Part 10 §9).
- **Unsafe casts** — excluded by doctrine; any proposal re-argues Part 11 §1.
- **Single-pass/resource-managed stream type** (Part 3 §10 — must not be called `Seq`).
- **Typed upcasts across foreign inheritance** (Part 5 §13.1); **selective class-member visibility** (Part 5 §7); **opaque callables/constructor objects as values** (Part 4 §11; Part 5 §12).
- **Flow-sensitive narrowing** — a language/type-system deep dive, not FFI (Part 2 §2.5).
- **Package/runtime-subpath layout, dictionary-ABI metadata, cross-package resolution** — the package-system design (Modules §12.1; Part 9 §11/§13.3).

## 10. Companion discharges applied at promotion

1. **`spec/notes/ffi-roadmap.md`** — mark Parts 4–12 statuses current (all drafted; 1–11 Decided) and the roadmap itself Completed/historical, mirroring `collections-roadmap.md`'s closeout.
2. **`spec/notes/ffi-proto-spec-questions.md`** — every section is now promoted (§§1–4 → Part 1–3 corpus, §5 → Parts 4–5, §6 → Part 6, §7 → Part 7, §8 → Parts 8–9, §9 → Part 10, §10 → Part 11, §11–§12 discharged); mark superseded/historical with the promotion map.
3. **`spec/notes/ffi-agenda.md`**, **`spec/notes/ffi-exported-dictionaries.md`**, **`spec/notes/ffi-zero-cost-primitive-exports.md`** — fully discharged/promoted; mark historical.
4. **`ffi-part1-boundary.md` §10 and `ffi-part7-exports.md` §2.1** — the `Hex`-alias scheme is **fixed** at §11.1 here (first-free numeric suffix probing over all emitted top-level `.d.ts` identifiers; generated alias only, user exports never renamed): close Part 1 §10.1 with a pointer, and add the one-line algorithm reference to Part 7 §2.1. The row-finalization markers for `JsMap`/`JsSet`/`JsValue` are already cleared.
5. **Verify applied** (issued earlier, listed for closure): Part 11 §10's four notes (Part 1 row; Exceptions §6.1; Part 2 nullability propagation; stdlib ledger entry); Part 7 §10's three (Modules §11.4; Unions §6.5; Exceptions §7.5); Part 5 §9's Method Syntax coverage extension; Part 10 §10's three (Part 1 row; Collections Part 4 §10.4; Collections Part 5 §4 rows).
6. **`spec-roadmap.md`** — the FFI milestone is complete; the planned v1 corpus consolidation precedes the stdlib listing.
7. **`ffi-foreign-enums.md` §5.2 and `ffi-part11-js-value-errors.md` §4** — record §11.2's resolved boundary, one sentence each: generated closed-set membership projections (`fromJsT`) return `Option`; the composable decoder family uses `Result(_, JsConversionError)`; other explicitly owned partial projections may use `Option` where their specification says so.
8. **`ffi-part2-nullable-array.md` §3 and `ffi-part11-js-value-errors.md` §3** — one line each recording §12's resolution: `NullableCase` and `JsKind` constructors are qualified-only in the prelude inventory (no bare auto-import); representations unchanged.
9. **Stdlib-listing ledger** — add §9.1's obligation 2 (qualified companion homes for both unions' constructors) alongside the decoder-family entry Part 11 already issued; §9.1's candidates 3–5 enter as ship-versus-defer rows with their revisit bars, not obligations.

## 11. Review resolutions (closed at promotion)

*(Retitled from "Open questions"; §-numbers stable.)*

### 11.1 The deterministic `Hex`-alias collision scheme — resolved

**Sources:** Part 1 §8/§10.1 formerly required deterministic resolution no later than Part 12; Part 7 §2.1 restated that requirement. Before Part 12 no part stated the algorithm; it is fixed here and propagated back to both owners:

> **First-free numeric suffix probing on the generated import alias:** try `Hex`, then `Hex1`, `Hex2`, …, taking the first candidate that collides with **no top-level identifier emitted in that `.d.ts` file, regardless of TypeScript namespace** (exported types, exported terms, generated brand symbols, other generated aliases — one flat check, since a namespace import alias occupies both TS spaces and per-namespace subtlety buys nothing). **Only the generated import alias is ever renamed; a user export is never renamed.** `Hex` remains the normal spelling — the probe moves past it only in the rare module that itself emits a top-level `Hex`.

The scheme is deterministic (a pure function of the emitted identifier set) and is recorded in Part 7 §2.1 (§10.4).

### 11.2 Foreign-enum `fromJsT` versus Part 11's decoding doctrine — resolved

**Sources:** Foreign Enums §5.2 (`fromJsT : JsValue -> Option(T)`); Part 11 (`Result(_, JsConversionError)` for its decoding surface). **Resolution: `fromJsT` keeps `Option`**, and the precise boundary is:

- **generated closed-set membership projections** (the foreign-enum `fromJsT` family) return `Option` — a miss has one meaning and no structure worth a reason or path;
- **the composable `JsValue` decoder family** uses `Result(_, JsConversionError)`, so reasons and paths compose through nested traversals;
- **other explicitly owned partial projections may use `Option` when their own specification says so.**

Deliberately **not** claimed: that every single-reason check uses `Option`, or that every checked conversion uses `Result`. The boundary is ownership-explicit, not shape-inferred; a new conversion states its failure type in its owning spec. The one-sentence recordings in Foreign Enums §5.2 and Part 11 §4 were applied under §10.7.

## 12. Global naming audit (finding resolved at promotion)

Method: all public FFI-introduced names (types, constructors, exceptions, constraints, functions, companion modules, generated exports) checked across parts, per-namespace, accounting for Hexagon's separate term/type/constructor namespaces (Modules §5) and prelude occlusion (Modules §6).

**Clean (cross-namespace coexistence, correct by rule):** `Array` type vs. `JsKind`'s `Array` constructor; `Range` type vs. `JsConversionReason`'s `Range` constructor; `String`/`Bool`/`BigInt` types vs. `JsKind` constructors; `Value` (`NullableCase`) unique among constructors; `KeyError`/`IndexError`/`SliceError`/`JsError`/`JsConversionError` distinct; generated specialization names collision-checked by Part 8 §6.2 at compile time by construction; companion-module names (`Nullable`, `JsValue`, `JsMap`, `JsSet`, `JsError`) unique in the module-alias namespace.

**One genuine same-namespace collision, found and resolved:**

> **`Undefined` and `Null` are constructors of both `NullableCase(a)` (Part 2 §3) and `JsKind` (Part 11 §3)** — two prelude unions sharing two constructor names in the constructor namespace, which the prelude cannot auto-import unqualified (Modules §5). The representations differ (`NullableCase` is mixed → tagged POJOs; `JsKind` is all-nullary → the strings `"Undefined"`/`"Null"`), so this was a source-namespace question only.
>
> **Resolution:** **all constructors of both utility unions are qualified-only in the prelude inventory** — not just the colliding pair:
>
> ```text
> NullableCase.Undefined   NullableCase.Null   NullableCase.Value(value)
>
> JsKind.Undefined   JsKind.Null   JsKind.Bool     JsKind.Number   JsKind.BigInt
> JsKind.String      JsKind.Symbol JsKind.Function JsKind.Array    JsKind.Object
> ```
>
> This is ordinary companion-module qualification (Modules §5.3) — the constructors are simply **not auto-imported as bare prelude terms**; qualified constructor use in expressions and patterns is the existing `Geo.Circle(r)` mechanism, nothing new. Runtime representations are unchanged. Uniform qualification for both whole unions (rather than the colliding pair alone) keeps each union's constructor surface one-rule. **The stdlib inventory must provide both qualified homes** (§9.1's obligation 2).

No other same-namespace collision was found.

---

*Drafting history, per-part review trails, and superseded notes are deliberately retained in the component files; their archival belongs to the later v1 corpus consolidation (`spec/notes/v1-spec-consolidation-plan.md`), not to this closeout.*
