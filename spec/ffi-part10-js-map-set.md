# Hexagon FFI Part 10: JavaScript `Map` and `Set`

**Status:** Decided and promoted after Sol review (July 2026). Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §9 plus the semantic obligations Collections Part 4 §10 pinned for the FFI. Review confirmed the bracket package, native equality divergence, two-step `has`/`get` lowering, the absence of set brackets, and direct `fromSeq` construction with fresh-adapter semantics at each foreign crossing. Part 11 is authoritative for `JsValue` (faces `unknown`), ordinary-data `JsConversionError`, structured failure paths (fields, 1-based indices, map keys/values, set elements; cycles report current and first-seen paths), and the shape/cycle-`Err` versus hostile-throw-`JsError` split.
**Scope:** The foreign borrowed collection types `JsMap(k, v)` and `JsSet(a)`: names, `.d.ts` faces, borrow contract; the read-only accessor surfaces; the `jsMap[key]` bracket and its lowering; the deliberate absence of `JsSet` brackets; iteration and the two `Iterable` rows; direct eager construction from `Seq`; the four snapshot conversions with the inward cycle-checked `Result`; boundary legality of parameters; diagnostics.
**Not in scope:** `JsConversionError`'s declaration, accessor surface, and general decoding machinery (Part 11 — this part states its collection-specific path obligations and links forward); persistent `Map`/`Set` semantics (Collections Part 4 — consumed); `Array(a)` (Part 2); any mutable foreign collection surface (**deferred**, §9); `WeakMap`/`WeakSet` (§9).
**Companions:** Part 1 §2.2/§3/§4.1/§5.3 (borrowed category; failure doctrine; the master-table row this part finalizes; nested-adapter restriction); Part 2 (the `Array` borrowed-view precedent: stability contract, native iteration license, lazy `toSeq`); Part 3 (Seq persistence; deferred-traversal retention); Collections Part 1 §3.3 (the accessor pair); Collections Part 4 §4/§10/§12.2 (bracket/`KeyError`; pinned conversion semantics; the set-bracket rejection); Collections Part 5 §4/§8 (instance table; iteration); Operators §10 (bracket grammar); Exceptions §6 (`JsError`).

---

## 1. Doctrine: names, category, faces

The foreign mutable collections cross as **borrowed foreign views**:

| Type | JS runtime representation | `.d.ts` face | Category |
|---|---|---|---|
| `JsMap(k, v)` | native JS `Map` | `ReadonlyMap<k, v>` | borrowed |
| `JsSet(a)` | native JS `Set` | `ReadonlySet<a>` | borrowed |

These names and faces are final, replacing Part 1 §4.1's provisional row (edit note, §10). Both are **zero-copy**: Hexagon holds the foreign object itself and observes it; nothing is wrapped, copied, or adapted at the crossing. Hexagon exposes **no mutation** — no `set`, `add`, `delete`, `clear`, and no write-position brackets (§4.5). They are foreign doors, not Hexagon collections: the persistent `Map(k, v)` and `Set(a)` remain the workhorses, and the separation is permanent (Collections Part 4 §1).

The `.d.ts` faces are TypeScript's native readonly interfaces, not `Hex.` types — a `JsMap` *is* the caller's own `Map`, and the face says only that Hexagon will not mutate it.

---

## 2. The borrow contract

Foreign code owns the underlying `Map`/`Set` and must keep its **entries, elements, and size stable** while Hexagon — including any deferred traversal derived from the view (§6.3) — may observe it. This is Part 2's `Array` stability contract, applied to keyed storage:

- Violation does not create memory unsafety; affected contents, order, size, lookup, and traversal observations are **unspecified** (Part 1 §3.1).
- An escaped `Seq` extends the borrow obligation through its possible consumption lifetime (§6.3).
- A freshly constructed native collection (e.g. `Map.toJsMap`'s result, §7.2) is stable while exclusively held by Hexagon; the obligation becomes relevant once foreign code can alias it.
- Under valid use, **live observation and snapshot observation are observationally identical** — which is what licenses native iteration (§6.4) and the two-step bracket lowering (§4.2) without copies or atomicity machinery.

---

## 3. Core surfaces

The complete v1 surfaces. Lookup operations carry **no `Hash` constraint** — equality is the native map's, not Hexagon's (§4.3):

| Function | Type | Notes |
|---|---|---|
| `JsMap.size` | `JsMap(k, v) -> Int` | fresh read of native `size` |
| `JsMap.get` | `(JsMap(k, v), k) -> Option(v)` | total sibling of the bracket; §4.2's lowering |
| `JsMap.containsKey` | `(JsMap(k, v), k) -> Bool` | native `has` |
| `JsMap.entries` | `JsMap(k, v) -> Seq((k, v))` | **definitional synonym of `toSeq`** (§6.3) |
| `JsMap.toSeq` | `JsMap(k, v) -> Seq((k, v))` | lazy, zero-copy; §6.3 |
| `JsMap.fromSeq` | `Seq((k, v)) -> JsMap(k, v)` | eager, fresh native collection; §6.5 |

| Function | Type | Notes |
|---|---|---|
| `JsSet.size` | `JsSet(a) -> Int` | fresh read of native `size` |
| `JsSet.contains` | `(JsSet(a), a) -> Bool` | native `has`; the only Boolean read, and the membership spelling (§5) |
| `JsSet.toSeq` | `JsSet(a) -> Seq(a)` | lazy, zero-copy; §6.3 |
| `JsSet.fromSeq` | `Seq(a) -> JsSet(a)` | eager, fresh native collection; §6.5 |

`entries` exists on `JsMap` because persistent `Map` has it (Collections Part 4 §7.3) and the mirror costs one alias; it is defined as equal to `toSeq`, not separately specified. `keys`/`values` projections and set-algebra reads are deliberately absent from the core (§9). `size` reads follow Part 5 §3.1's fresh-read discipline: never cached or hoisted — the foreign collection may change between (contract-permitted) observations.

---

## 4. The bracket: `jsMap[key]`

### 4.1 Semantics

`jsMap[k]` with `jsMap : JsMap(k, v)` is **legal, read-only, yields `v`, and throws the existing nullary prelude `KeyError` when the key is absent** — Collections Part 1 §3.3's accessor pair, instantiated at the boundary exactly as Part 4 §4.1 instantiated it for persistent `Map`: brackets assert presence and fail loudly at the fault site; `JsMap.get` is the total `Option(v)` sibling. `KeyError` is Part 4 §4.3's declaration, reused, not redeclared — including its nullary rationale (a foreign key is even less payload-able than a polymorphic one) and the non-normative best-effort message-rendering license.

Grammar is unchanged: the same postfix bracket (Operators §10), meaning selected during checking by receiver and element types. `[]` remains a compiler-owned structural form; granting it to the compiler-known `JsMap` creates no user-extensible bracket surface.

### 4.2 The lowering (normative)

For both `jsMap[k]` **and** `JsMap.get(jsMap, k)`:

1. **The map and key expressions are evaluated exactly once each**, map first (the ordinary receiver-first order).
2. The lowering calls native **`has` before `get`**: `has(k)` false → throw `KeyError` (bracket) / return `None` (`get`); true → `get(k)` supplies the result / `Some(result)`.
3. **A present `undefined` value remains distinguishable from absence.** This is the entire reason for step 2: native `get` alone returns `undefined` for both, and `v` may lawfully include `undefined` (`Nullable(a)`, `Unit`, opaque extern types).
4. **The emitter must not fuse this into a single `get` plus an `undefined` test — even when `v`'s type appears unable to contain `undefined`.** One lowering, no type-directed variants. (Decided; the uniformity is the contract, and opaque types make the "appears unable" judgment untrustworthy anyway.)
5. Foreign mutation between the `has` and the `get` is a **borrow-contract violation** (§2) with unspecified observations; **no atomicity is promised**, and none is needed against a conforming foreign owner.

Representative emission:

```js
const m = mapExpr, k = keyExpr;
if (!m.has(k)) throw $mkExn("KeyError", "", {});
const v = m.get(k);
```

### 4.3 Equality: native, not structural — stated prominently

> **`jsMap[k]`, `JsMap.get`, `JsMap.containsKey`, and `JsSet.contains` use the native collection's key equality — SameValueZero, which is reference identity for objects. Persistent `Map`/`Set` lookup uses Hexagon's structural `Hash`/`equals`. Same bracket syntax, different equality regime — the foreign door does not consult `Hash`, and no `Hash` constraint appears anywhere on this part's surfaces.**

Consequences, documented:

- **Primitive keys behave identically on both sides** — Hexagon `Eq` on `Int`/`Float`/`String`/`Bool` *is* SameValueZero (Collections Part 4 §10.1): all `NaN`s are one key, `-0`/`+0` unify, in both regimes.
- **Structural keys are reference-identity lookups.** A record-typed key finds an entry only via the exact object reference; an equal-looking value is a different key. Legal, occasionally what a binding needs, and nearly useless as a structural index — which is what the conversions (§7) exist for.
- The absence of `Hash` also means **`JsMap(Hex.Range, v)` is satisfiable** where `Map(Range, v)` is not (`Range` has no `Hash`, Part 4 §4.4). A `Range`-typed bracket element on a `JsMap` whose key type is `Range` is an ordinary key lookup — **`JsMap` has no slicing**, so no `Range`-means-slice reading exists here to compete with it. Part 4 §4.4's "unsatisfiable" escape hatch does not port; the resolution rule (receiver + element type select the meaning) does.

### 4.4 Two failure doors

Honest absence alone produces `KeyError` (bracket) or `None` (`get`). **Throws from hostile or proxied `has`/`get`/`size` operations follow the ordinary foreign-throw path — `JsError`** (Part 1 §7; Exceptions §6) — exactly as a throwing extern `get` does (Part 5 §3.1: a foreign operation may compute, vary, or throw). The two doors never mix: `KeyError` is never synthesized from a foreign throw, and a conforming native `Map` never throws from `has`/`get`.

### 4.5 What the bracket is not

- **No bracket assignment, ever**: `[]` never appears in write position corpus-wide (Collections Part 1 §3.3), and a borrowed view has no mutation surface for it to reach anyway (§1).
- **No slicing**: windows are positional; maps have no positions (Part 4 §4.4). `jsMap[range]` is a key lookup iff `k` is `Range` (§4.3), otherwise an ordinary type error.
- **No `at`, no integer positional indexing** — same doctrine, plus §5's O(n) honesty.

---

## 5. `JsSet` has no brackets and no `get`

Recorded with its full rationale, against re-litigation:

> **Brackets retrieve a payload selected by a position or key. A set has membership but no associated payload — its elements *are* its keys, with nothing further to retrieve.** Membership is spelled `JsSet.contains`.

The rejected spellings, each with its specific defect:

1. **`jsSet[x] : Bool`** — brackets never answer predicates. A Boolean-returning bracket would fork `[]`'s meaning by receiver type (retrieval on `Vector`/`Map`/`String`/`JsMap`, predicate on sets), destroying the one-rule teachability the accessor pair exists for — Collections Part 4 §12.2's rejection, extended verbatim to the foreign door.
2. **`jsSet[x] : a` returning the query** — not retrieval; the caller already holds `x`. A bracket that hands back its own argument is ceremony.
3. **`jsSet[x] : a` returning the stored representative** — genuine retrieval semantics exist here in principle (representatives are real, Collections Part 4 §5.4), but native `Set` **cannot produce the stored element without an O(n) scan**: JS offers `has`, never a lookup of the stored member. An O(n) bracket would lie about cost (Collections Part 1 §3's naming doctrine). Symmetric with the persistent side: `Set(a)` offers no representative accessor either — `contains` is its only Boolean read.
4. **`jsSet[i]` integer indexing** — falsely suggests positional structure (insertion order is an iteration contract, not an index), and is also O(n).

---

## 6. Iteration

### 6.1 The two `Iterable` rows (FFI-declared)

This part declares the compiler/runtime-provided instances, extending Collections Part 5 §4's table by two FFI-owned rows (edit note, §10):

| Type | `type Item` | `iterate` |
|---|---|---|
| `JsMap(k, v)` | `(k, v)` | `JsMap.toSeq` (≡ `entries`) |
| `JsSet(a)` | `a` | `JsSet.toSeq` |

`for (key, value) in jsMap` and `for x in jsSet` therefore work exactly as for the persistent collections (Part 5 §3), tuple destructuring included.

### 6.2 The order contract

Both iterate in **native insertion order** — the order JavaScript defines for `Map`/`Set` iteration. This is stronger than the persistent collections' arbitrary-but-stable contract (Part 4 §7.1) and is stated as the foreign object's own contract, inherited, not manufactured: the view adds nothing and hides nothing.

### 6.3 `toSeq`, `entries`, and deferred traversal

`JsMap.toSeq`/`JsSet.toSeq` are **lazy and zero-copy over the borrowed collection** — the `Array.toSeq` shape (Part 2). `JsMap.entries` is a definitional synonym of `JsMap.toSeq`, mirroring the persistent `Map.toSeq ≡ entries` correspondence (Part 4 §7.3); the collections conversion doctrine is satisfied because the suite name `toSeq` is the primary spelling and `entries` introduces no second behavior.

- The resulting `Seq` obeys full `Seq` persistence (Part 3 §4–§5): positions are persistent, forcing memoizes, and the implementation may hold one native iterator behind a memoizing spine — under a valid borrow, live and snapshot observations coincide (§2), so the choice is unobservable.
- **A deferred traversal extends the stability obligation**: the borrow lasts while any derived `Seq` position may still be consumed (§2). Escaping sequences are the canonical long-borrow hazard and the documentation must say so.
- A convenient consequence of the representations: JS `Map` iteration yields two-element arrays, and Hexagon tuples **are** plain JS arrays (Part 1 §4.1) — the native entry is already a representation-correct `(k, v)` tuple. Zero adaptation.

### 6.4 Emission license

Native `for...of` emission over the view (or its native iterator) is **permitted and preferred** for loops and combinators, exactly as for `Array` (Part 2): iteration does not copy merely to enforce a condition the borrow contract already requires. Iterator-protocol throws from exotic sources follow `JsError` (Part 3 §7).

### 6.5 Direct construction from `Seq`

```hexagon
JsMap.fromSeq : Seq((k, v)) -> JsMap(k, v)
JsSet.fromSeq : Seq(a) -> JsSet(a)
```

Both functions are **unconstrained, eager, shallow constructors of a fresh native collection**. They consume the source once in traversal order, perform no structural hashing or decoding, and therefore return the collection directly rather than `Result`. An infinite source diverges. A throw while advancing a foreign-backed source follows `JsError`; there is no cycle check because native insertion never traverses the inserted key, value, or element.

Duplicate handling is exactly native construction semantics:

- `JsMap.fromSeq` uses SameValueZero/reference identity. A later equal key replaces the value while retaining the native map's original key position and stored key representative.
- `JsSet.fromSeq` uses SameValueZero/reference identity and retains the native set's first stored representative and position.

Each call creates a new collection and consumes its input once. Reusing the same **Hexagon `Seq`** in two calls replays that persistent memoizing sequence, producing two distinct collections with the same entries. When an exported `fromSeq` is called twice from JavaScript with the same foreign `Iterable`, Part 3 creates a **fresh adapter at each boundary crossing**: a replayable iterable is traversed twice, while a single-shot generator is advanced by the first call and the second observes its then-current (normally exhausted) state. No adapter or collection identity cache is introduced. This is precisely the observable behavior of invoking `new Map(iterable)` or `new Set(iterable)` twice.

---

## 7. Conversions

### 7.1 The four functions

The established names, preserved from Collections Part 4 §10 (subject-first, pre-registered there):

```hexagon
Map.toJsMap   : Map(k, v) -> JsMap(k, v)
Map.fromJsMap : <k: Hash> JsMap(k, v) -> Result(Map(k, v), JsConversionError)
Set.toJsSet   : Set(a) -> JsSet(a)
Set.fromJsSet : <a: Hash> JsSet(a) -> Result(Set(a), JsConversionError)
```

All four are **eager shallow snapshots** (Part 1 §5.1): the named outer collection changes representation; keys, values, and elements retain their runtime values and identities. They never share mutable native storage with a persistent collection. Nested conversion is the caller's explicit map, as everywhere.

### 7.2 Outward: total

`Map.toJsMap`/`Set.toJsSet` are **total** — no constraint, no failure mode. Hexagon values are acyclic by construction, insertion into a native collection performs no traversal, and every Hexagon value has a JS representation by definition. Semantics pinned by Collections Part 4 §10.1–10.2, now normative at the boundary:

- primitive keys/elements are faithful (SameValueZero alignment; nothing collapsed, split, or lost);
- structural keys become **reference-identity** keys: the converted map is a snapshot for JS consumption, not a shared structural index, and JS cannot look up by reconstruction;
- the fresh native collection is stable while exclusively Hexagon-held (§2) and is the foreign consumer's to own once handed over.

### 7.3 Inward: checked, collapsing, cycle-aware

`Map.fromJsMap`/`Set.fromJsSet` traverse the source in **its own iteration order** (native insertion order) and perform the destination's hashing/equality work — which is why they carry `<k: Hash>`/`<a: Hash>` while nothing else in this part does. Semantics:

- **Deterministic equality collapse.** Reference-distinct JS keys converting to `equals`-equal Hexagon keys collapse; **for maps, the later entry wins** in source iteration order (Collections Part 4 §10.3 — conversion is morally `fromEntries` over the entry sequence). Set conversion collapses `equals`-equal elements to one, with nothing observable about which (Part 4 §10.3, preserved verbatim).
- **Cyclic structural-key ingestion is a defined checked failure**, not a contract violation: hashing inherently traverses the key, so the check lives lawfully in the conversion (Part 1 §3.2 names exactly this case). A cycle encountered while ingesting a key/element yields `Err(JsConversionError)`.
- **The failure is all-or-nothing**: `Err` returns no partial collection and leaves no observable state.
- **Path obligations, linked to Part 11**: failures originating in these shallow conversions use the collection-specific *map key* or *set element* segment (identifying the entry by its source iteration position where nothing better exists), composed with Part 11's field and 1-based index segments for the nested position inside the key or element, and report a cycle's **current path and first-seen path**. Part 11's general path vocabulary also includes *map value*, but no Part 10 conversion traverses a value, so that segment cannot originate here. `JsConversionError`'s ordinary-data declaration is Part 11's; this part consumes, never redesigns.
- **What is *not* checked**: values (`v`) are never traversed — conversion is shallow, so a cyclic or malformed object behind a declared value type is an ordinary trusted-declaration violation (Part 1 §3.1), exactly as it is at every other crossing. The check exists where the operation inherently traverses; nowhere else.
- Hostile sources — throwing iterators, exotic proxies — surface through `JsError` (§4.4's split, applied here: shape/cycle failures are `Err`; foreign throws are `JsError`).

---

## 8. Boundary legality of parameters

`k`, `v`, and `a` follow the general rules, applied at declaration site (Part 1 §5.3): representation-direct and borrowed types nest freely (`JsMap(String, Array(Int))`, `JsSet(Hex.Vector<Float>)` are legal faces); **adapter-requiring types are rejected** inside the borrowed container (`JsMap(String, Seq(Int))` is the Part 1 §5.3 hard error, with its named rewrite: convert at a controlled boundary or restructure the declaration). Nothing new — the rule is cited, not extended.

---

## 9. Deferred surfaces (recorded, not designed)

1. **`JsMap.keys` / `JsMap.values` projections** — derivable today as `Seq` combinators over `toSeq`; stdlib-listing candidates alongside the persistent `Map`'s own §7.3 family.
2. **Set-algebra reads over `JsSet`** (`isSubsetOf` etc.) — convert and use `Set`, or bind a JS helper; no core surface.
3. **A writable foreign collection door** — v1 exposes no mutation on any borrowed view; a mutable door, if ever, is a new category discussion, not an accessor addition.
4. **`WeakMap`/`WeakSet`** — not observable collections (no size, no iteration); nothing here fits them. Any future binding is opaque-extern-type territory (Part 4 §5).

---

## 10. Companion discharges applied at promotion

- **ffi-part1-boundary.md §4.1** — the provisional `JsMap`/`JsSet` row is finalized: names `JsMap(k, v)`/`JsSet(a)`; faces `ReadonlyMap<k, v>`/`ReadonlySet<a>`; category borrowed; failure = stability contract (this part §2), inward conversions converted & checked (this part §7.3). The §10 "not yet decided" marker clears.
- **collections-part4-map-set.md §10.4** — the owed list is discharged: names and accessor surfaces (this part §3), cyclic-key failure shape (§7.3, `Result` + Part 11's `JsConversionError`), value conversion is shallow (§7.1).
- **collections-part5-iterable.md §4** — the provided-instance table gains the two FFI-declared rows of this part §6.1, marked FFI-owned like the `Array(a)` row.

---

## 11. Diagnostics checklist

| Situation | Diagnostic / behavior | Owner |
|---|---|---|
| `jsMap[k]` on an absent key | runtime `KeyError` (nullary, prelude; Part 4 §4.3 reused) | §4.1 |
| absent key via `JsMap.get` | `None` — never throws | §4.2 |
| foreign throw from `has`/`get`/`size`/iterators | runtime `JsError` path; never `KeyError` | §4.4, §6.4 |
| cyclic structural key/element during `fromJsMap`/`fromJsSet` | `Err(JsConversionError)` with current + first-seen paths (Part 11's shape) | §7.3 |
| bracket in write position (`jsMap[k] := v`) | existing corpus-wide error: `[]` is read-only (Collections Part 1 §3.3); no mutation surface exists on a borrowed view | §4.5 |
| bracket on `JsSet` (`jsSet[x]`) | hard error; rewrite named: "a set has no payload to retrieve; membership is `JsSet.contains(s, x)`" | §5 |
| slicing attempt (`jsMap[range]`, key type not `Range`) | ordinary type error (element type vs key type); no slicing meaning exists | §4.3, §4.5 |
| adapter-requiring type in `k`/`v`/`a` | Part 1 §5.3's hard error at declaration site | §8 |
| foreign mutation during an extant borrow (incl. between `has` and `get`, or under an escaped `Seq`) | not detectable — contract violation, unspecified observations | §2, §4.2 |

---

## 12. Review resolution

Sol review added `JsMap.fromSeq` and `JsSet.fromSeq` (§6.5). The direct constructors avoid a needless `Hash` constraint and persistent intermediate, preserve native equality and duplicate behavior, and make the finite-collection `toSeq`/`fromSeq` suite complete. Review also fixed the failure-path wording in §7.3: *map value* remains part of Part 11's general vocabulary but cannot originate in Part 10's shallow conversions.

---

## 13. Decisions log (quick reference)

| Decision | Where |
|---|---|
| Final names `JsMap(k, v)`/`JsSet(a)`; faces `ReadonlyMap<k, v>`/`ReadonlySet<a>` (native TS, not `Hex.`); borrowed zero-copy views; no mutation surface; permanent separation from persistent `Map`/`Set` | §1 |
| Borrow contract: entries/elements/size stable while Hexagon or any derived deferred traversal may observe; escaped `Seq` extends the borrow; fresh collections stable while exclusively held; live ≡ snapshot under valid use | §2 |
| Surfaces: `size`/`get`/`containsKey`/`entries`/`toSeq`/`fromSeq` (map), `size`/`contains`/`toSeq`/`fromSeq` (set); `entries` ≡ `toSeq` definitionally; fresh reads, never cached; **no `Hash` anywhere on lookup or direct native construction** | §3 |
| `jsMap[k]` legal, read-only, yields `v`, throws nullary prelude `KeyError` on absence; `JsMap.get` total sibling | §4.1 |
| Lowering (both accessors): map and key evaluated once; **native `has` before `get`**; present `undefined` ≠ absence; **fusion into `get`+`undefined`-test forbidden even when `v` looks `undefined`-free**; mutation between the two = borrow violation, no atomicity promised | §4.2 |
| **Equality divergence stated prominently**: native SameValueZero/reference identity, vs persistent structural `Hash`; primitives faithful both regimes; structural keys = reference lookups; `JsMap(Range, v)` satisfiable — `Range` element is a key lookup; no slicing | §4.3 |
| Two failure doors: honest absence → `KeyError`/`None`; hostile/proxied operation throws → `JsError`; never mixed | §4.4 |
| No bracket assignment; no slicing; no `at`/positional indexing | §4.5 |
| `JsSet`: no brackets, no `get`; membership is `JsSet.contains`; four rejected spellings recorded (predicate brackets / query echo / O(n) representative / O(n) positional) | §5 |
| `Iterable` rows: `JsMap` yields `(k, v)` (native entries are already tuple-representation arrays), `JsSet` yields elements; native insertion order; lazy zero-copy `toSeq` with full `Seq` persistence; native `for...of` licensed | §6 |
| `JsMap.fromSeq`/`JsSet.fromSeq`: unconstrained eager shallow construction of a fresh native collection; native duplicate/equality semantics; each call consumes once, with a fresh Part 3 adapter at each foreign boundary crossing and no identity cache | §6.5 |
| Conversions: `Map.toJsMap`/`Map.fromJsMap`/`Set.toJsSet`/`Set.fromJsSet`; eager shallow snapshots; outward total (structural keys → reference identity, primitives faithful); inward `<Hash>`-constrained, later-entry-wins collapse, **cycle during key ingestion → `Err(JsConversionError)`** (all-or-nothing) with collection-specific path segments per Part 11; values never traversed (trusted) | §7 |
| Parameters obey Part 1 §5.3 at declaration site; adapter-requiring nesting rejected | §8 |
| Deferred: `keys`/`values`, set algebra, writable door, `WeakMap`/`WeakSet` | §9 |
| Edit notes: Part 1 table row finalized; Collections Part 4 §10.4 discharged; Part 5 table +2 rows | §10 |
