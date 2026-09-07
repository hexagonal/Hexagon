# Hexagon FFI Part 10: JavaScript `Map` and `Set`

**Status:** Decided and promoted after Sol review (July 2026). Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §9 plus the semantic obligations Collections Part 4 §10 pinned for the FFI. Review confirmed the bracket package, native equality divergence, two-step `has`/`get` lowering, the absence of set brackets, and direct `fromSeq` construction with fresh-adapter semantics at each foreign crossing. Part 11 is authoritative for `JsValue` (faces `unknown`), ordinary-data `JsConversionError`, structured failure paths (fields, 1-based indices, map keys/values, set elements; cycles report current and first-seen paths), and the shape/cycle-`Err` versus hostile-throw-`JsError` split. **Amended (#875):** `JsMap(k, v)` and `JsSet(a)` move from borrowed foreign views to **captured foreign collections** (Part 1 §2.2) — the borrow contract of §2 is replaced by the capture contract, every "fresh read" and "live ≡ snapshot" clause below is retired, and the correction record is §14; with this amendment no borrowed view remains in the corpus. **Implementation:** the types and §6's two `Iterable` rows (#396) and §3's companions `stdlib/JsMap.hex`/`stdlib/JsSet.hex` through the intrinsic door (#792; `spec/intrinsics.md` §3.2) are in the compiler — conformance `compiler/src/conformance/js-map-set.test.ts`; the bracket (§4), the set-bracket refusal (§5), and the four conversions (§7) are absent until built, under Part 2 §9.1's doctrine (#793–#796).
**Scope:** The captured foreign collection types `JsMap(k, v)` and `JsSet(a)`: names, `.d.ts` faces, capture contract; the read-only accessor surfaces; the `jsMap[key]` bracket and its lowering; the deliberate absence of `JsSet` brackets; iteration and the two `Iterable` rows; direct eager construction from `Seq`; the four conversions with the inward cycle-checked `Result`; boundary legality of parameters; diagnostics.
**Not in scope:** `JsConversionError`'s declaration, accessor surface, and general decoding machinery (Part 11 — this part states its collection-specific path obligations and links forward); persistent `Map`/`Set` semantics (Collections Part 4 — consumed); `Array(a)` (Part 2); any mutable foreign collection surface (**deferred**, §9); `WeakMap`/`WeakSet` (§9).
**Companions:** Part 1 §2.2/§3/§4.1/§5.3/§5.4 (captured category; failure doctrine; the master-table row this part finalizes; nested-adapter restriction; the capture walk and its refusals); Part 2 (the `Array` precedent: the capture contract of §6.2 there, native iteration over the captured value, lazy `toSeq`); Part 3 (Seq persistence; deferred-traversal retention); Collections Part 1 §3.3 (the accessor pair); Collections Part 4 §4/§10/§12.2 (bracket/`KeyError`; pinned conversion semantics; the set-bracket rejection); Collections Part 5 §4/§8 (instance table; iteration); Operators §10 (bracket grammar); Exceptions §6 (`JsError`).

---

## 1. Doctrine: names, category, faces

The foreign mutable collections cross as **captured foreign collections** (Part 1 §2.2):

| Type | JS runtime representation | `.d.ts` face | Category |
|---|---|---|---|
| `JsMap(k, v)` | a fresh native JS `Map` — Hexagon's snapshot of the foreign map | `ReadonlyMap<k, v>` | captured |
| `JsSet(a)` | a fresh native JS `Set` — Hexagon's snapshot of the foreign set | `ReadonlySet<a>` | captured |

These names and faces are final, replacing Part 1 §4.1's provisional row (edit note, §10). Both are **captured**: the value Hexagon holds is a fresh native `Map` or `Set`, built at the crossing from the foreign collection's entries and sharing no storage with it, and what foreign code receives at any `JsMap`/`JsSet` position is a fresh copy in turn (§2). Nothing is wrapped or adapted; something is copied, once per crossing, in both directions. Hexagon exposes **no mutation** — no `set`, `add`, `delete`, `clear`, and no write-position brackets (§4.5). They are foreign doors, not Hexagon collections: the persistent `Map(k, v)` and `Set(a)` remain the workhorses, and the separation is permanent (Collections Part 4 §1). What distinguishes a `JsMap` from a `Map` after this amendment is no longer *whose storage it is* — both are Hexagon's — but its **equality regime** (§4.3: SameValueZero on the native collection, no `Hash`) and its **shape at the boundary** (a native `Map`, faced as `ReadonlyMap`, at the cost of one linear copy per crossing).

The `.d.ts` faces are TypeScript's native readonly interfaces, not `Hex.` types — a `JsMap` is a native `Map` in the caller's own vocabulary, and the face says only that the value is read through `ReadonlyMap`'s surface; the copy the caller receives is theirs, and what they do to it changes nothing Hexagon holds.

---

## 2. The capture contract

> **A `JsMap(k, v)` or `JsSet(a)` value is captured at acquisition: the collection Hexagon holds is a fresh native `Map`/`Set` holding the foreign collection's entries as they were at the crossing, and it never changes. Foreign mutation of the original afterwards is not observable through the Hexagon value, its `size`, its lookups, or any sequence derived from it. A later acquisition may yield a different value.**

This is Part 2 §6.2's contract applied to keyed storage, under Part 1 §5.4's one mechanism:

- **Where the capture happens** is Part 1 §5.4's position table: every declared boundary position whose type names `JsMap` or `JsSet` — extern results and arguments, an `extern let` once at initialization, receiver members' slots, exported functions through their conversion wrapper, callbacks at each invocation, `JsValue.from`'s argument. The copy runs in **both directions**. A Hexagon-to-Hexagon call never copies.
- **What the copy is.** For `JsMap(k, v)`: a fresh native `Map` built from the source's entries **in the source's own iteration order** (native insertion order, §6.2), each entry read exactly once through the source's iteration protocol, its key carried through Part 1 §5.4's walk at `k` and its value through the walk at `v` — by identity for every type but a captured collection or a function naming one. For `JsSet(a)`: a fresh native `Set` built the same way from the source's elements at `a`. The copy has the source's `size`. **No collapse or reordering arises in the copy**: keys and elements carried by identity are exactly as distinct under SameValueZero as they were in the source, and a key or element that is itself a captured collection becomes a fresh object, distinct from everything (see §4.3 for what that means for lookups). The emitter's spelling of the copy is its own; the read-each-entry-once-in-order contract is what an exotic or subclassed source can observe.
- **Nested collections** are captured layer by layer as the declared type directs — `JsMap(String, Array(Int))` copies the outer map and every array value; `JsMap(String, JsMap(String, Int))` copies both levels. A `JsMap` or `JsSet` beneath an identity-crossing container (`Vector(JsSet(Int))`, `Map(String, JsMap(k, v))`) is Part 1 §5.4 item 1's refusal; the other refusals apply as written there.
- **Cost.** Linear in the source's `size`, plus the key and value walks, at every crossing — accepted as the price of the guarantee (Part 1 §5.4). Afterwards the captured collection costs what a native `Map`/`Set` costs: `size`, `has`, and `get` are O(1), and the compiler may share or hoist any of them, since a value has no fresh-read rule.
- **Effects.** The copy performs none of its own. The acquisition is coloured by the row that performs it (Part 4 §4.5); a `->` row returning a `JsMap` is the author's claim that the foreign function is pure, and the reads of the resulting value are Effects §6.2 species (c) whatever the row's colour.
- **Stability during capture; identity.** A source whose iteration protocol throws — a proxied or subclassed `Map`, a hostile entry — throws out of the frame performing the crossing through the ordinary `JsError` path (Part 1 §7); a foreign mutation that races the copy — an iterator trap mutating the map being read — leaves *that acquisition's* contents unspecified (Part 1 §3.1) and nothing else. A captured collection has no identity relation to its source and none to another capture of it: two acquisitions are two values, a round trip is two copies, nothing is cached. Once captured, the value is a genuine native `Map`/`Set` whose `has`/`get`/`size` are the platform's own and cannot throw (§4.4).
- **Fresh collections Hexagon makes** — `fromSeq`'s (§6.5), `Map.toJsMap`/`Set.toJsSet`'s (§7.2) — are captured values from birth: made by Hexagon, held by Hexagon, unreachable from foreign code until they cross, at which point they are copied like any other. There is no "stable while exclusively held" clause, because every `JsMap`/`JsSet` value is exclusively held, always.
- **What is not promised.** Nothing about the foreign original. A binding that wants the original — its identity, its live contents, its zero-copy cost — binds an opaque extern `type` with `->!` accessors (Part 1 §2.2), which is a foreign capability and deliberately not this type.

---

## 3. Core surfaces

The complete v1 surfaces. Lookup operations carry **no `Hash` constraint** — equality is the native map's, not Hexagon's (§4.3):

| Function | Type | Notes |
|---|---|---|
| `JsMap.size` | `JsMap(k, v) -> Int` | the captured map's native `size` — a read of a value |
| `JsMap.get` | `(JsMap(k, v), k) -> Option(v)` | total sibling of the bracket; §4.2's lowering |
| `JsMap.containsKey` | `(JsMap(k, v), k) -> Bool` | native `has` |
| `JsMap.entries` | `JsMap(k, v) -> Seq((k, v))` | **definitional synonym of `toSeq`** (§6.3) |
| `JsMap.toSeq` | `JsMap(k, v) -> Seq((k, v))` | lazy over the captured map; §6.3 |
| `JsMap.fromSeq` | `Seq((k, v)) -> JsMap(k, v)` | eager, fresh native collection, Hexagon-held from birth; §6.5 |

| Function | Type | Notes |
|---|---|---|
| `JsSet.size` | `JsSet(a) -> Int` | the captured set's native `size` — a read of a value |
| `JsSet.contains` | `(JsSet(a), a) -> Bool` | native `has`; the only Boolean read, and the membership spelling (§5) |
| `JsSet.toSeq` | `JsSet(a) -> Seq(a)` | lazy over the captured set; §6.3 |
| `JsSet.fromSeq` | `Seq(a) -> JsSet(a)` | eager, fresh native collection, Hexagon-held from birth; §6.5 |

`entries` exists on `JsMap` because persistent `Map` has it (Collections Part 4 §7.3) and the mirror costs one alias; it is defined as equal to `toSeq`, not separately specified. `keys`/`values` projections and set-algebra reads are deliberately absent from the core (§9). Every surface here reads the captured collection, a value: `size` is the native `size` of a `Map` nothing else can reach, and the compiler may cache, hoist, or share it as it shares any pure read (Effects §6.2, species (c)). Part 5 §3.1's fresh-read rule is about `->!` foreign properties and does not apply to a captured value; the per-call discipline this sentence once imposed pending #875 is spent.

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
5. Nothing can change the map between the `has` and the `get`: the receiver is a captured collection (§2) that only Hexagon can reach, and Hexagon has no mutation surface on it. The two-step order exists for step 3's distinction alone; no atomicity question arises.

Representative emission:

```js
const m = mapExpr, k = keyExpr;
if (!m.has(k)) throw $mkExn("KeyError", "", {});
const v = m.get(k);
```

### 4.3 Equality: native, not structural — stated prominently

> **`jsMap[k]`, `JsMap.get`, `JsMap.containsKey`, and `JsSet.contains` use the native collection's key equality — SameValueZero, which is reference identity for objects. Persistent `Map`/`Set` lookup uses Hexagon's structural `Hash`/`equals`. Same bracket syntax, different equality regime — the foreign door does not consult `Hash`, and no `Hash` constraint appears anywhere on this part's surfaces.**

Consequences, documented:

- **Primitive keys — and `Bool` — behave identically on both sides**: Hexagon `Eq` on `Nat`/`Int`/`Float`/`String`/`BigInt`/`Unit` — every primitive — and on `Bool`, since #147 the prelude union pinned to the JS `boolean`, *is* SameValueZero on its JS representation (Collections Part 4 §10.1; for `Bool`, as the derived union `Eq` over the pinned representation — `===` on booleans, Unions §6.2/§8): all `NaN`s are one key, `-0`/`+0` unify, in both regimes *(enumeration corrected 2026-07-28, #141; `Bool`'s grounds restated 2026-07-29, #147, in the same edit as Collections Part 4 §10.1 — the two statements are change-controlled together per Part 4 §18 note 4; records: Collections Part 4 §18)*.
- **Structural keys are reference-identity lookups.** A record-typed key finds an entry only via the exact object reference; an equal-looking value is a different key. Legal, occasionally what a binding needs, and nearly useless as a structural index — which is what the conversions (§7) exist for. The capture (§2) carries keys **by identity**, so a key object Hexagon obtained by any other route — another extern's result, the map's own traversal — still finds its entry in the captured map. The one exception is a key that is itself a captured collection (`JsMap(Array(Int), v)`): the copy makes it a fresh object, so it matches only the very key the captured map's own traversal yields, never a key supplied from outside. Such maps are traversed, not looked up into; recorded, not repaired — a structural key wants the conversions.
- The absence of `Hash` also means **`JsMap(Hex.Range, v)` is satisfiable** where `Map(Range, v)` is not (`Range` has no `Hash`, Part 4 §4.4). A `Range`-typed bracket element on a `JsMap` whose key type is `Range` is an ordinary key lookup — **`JsMap` has no slicing**, so no `Range`-means-slice reading exists here to compete with it. Part 4 §4.4's "unsatisfiable" escape hatch does not port; the resolution rule (receiver + element type select the meaning) does.

### 4.4 Two failure doors

Honest absence alone produces `KeyError` (bracket) or `None` (`get`). **A throw from a hostile or proxied source follows the ordinary foreign-throw path — `JsError`** (Part 1 §7; Exceptions §6) — and it can happen in exactly one place: during the capture (§2), when the source's iteration protocol is driven. Once captured, the value is a genuine native `Map` whose `has`/`get`/`size` are the platform's own and do not throw. The two doors never mix: `KeyError` is never synthesized from a foreign throw, and a capture failure is never an absence.

### 4.5 What the bracket is not

- **No bracket assignment, ever**: `[]` never appears in write position corpus-wide (Collections Part 1 §3.3), and a captured collection has no mutation surface for it to reach anyway (§1).
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

| Type | `type Item` | `toSeq` (the member) |
|---|---|---|
| `JsMap(k, v)` | `(k, v)` | `JsMap.toSeq` (≡ `entries`) |
| `JsSet(a)` | `a` | `JsSet.toSeq` |

`for (key, value) in jsMap` and `for x in jsSet` therefore work exactly as for the persistent collections (Part 5 §3), tuple destructuring included.

### 6.2 The order contract

Both iterate in **native insertion order** — the order JavaScript defines for `Map`/`Set` iteration. This is stronger than the persistent collections' arbitrary-but-stable contract (Part 4 §7.1) and is stated as the foreign object's own contract, inherited, not manufactured: the view adds nothing and hides nothing.

### 6.3 `toSeq`, `entries`, and deferred traversal

`JsMap.toSeq`/`JsSet.toSeq` are **lazy over the captured collection**, allocating no second copy — the `Array.toSeq` shape (Part 2 §9). `JsMap.entries` is a definitional synonym of `JsMap.toSeq`, mirroring the persistent `Map.toSeq ≡ entries` correspondence (Part 4 §7.3); the collections conversion doctrine is satisfied because the suite name `toSeq` is the primary spelling and `entries` introduces no second behavior.

- The resulting `Seq` obeys full `Seq` persistence (Part 3 §4–§5): positions are persistent, forcing memoizes, and the implementation may hold one native iterator behind a memoizing spine — the collection it iterates is a stable value (§2), so when the iterator is driven is unobservable.
- **A deferred traversal extends nothing**: the sequence may be forced at any time and observes the same entries, because the captured collection cannot change. Escaping sequences carry no obligation with them.
- A convenient consequence of the representations: JS `Map` iteration yields two-element arrays, and Hexagon tuples **are** plain JS arrays (Part 1 §4.1) — the native entry is already a representation-correct `(k, v)` tuple. Zero adaptation.

### 6.4 Emission license

Native `for...of` emission over the captured collection (or its native iterator) is **permitted and preferred** for loops and combinators, exactly as for `Array` (Part 2 §8.2): iteration copies nothing at iteration time because the crossing already did, and a native iterator over a `Map` nobody else can reach is a traversal of a value. The captured collection is a genuine native `Map`/`Set`, so its iterator is the platform's and does not throw; exotic sources throw during the capture (§2), not here.

### 6.5 Direct construction from `Seq`

```hexagon
JsMap.fromSeq : Seq((k, v)) -> JsMap(k, v)
JsSet.fromSeq : Seq(a) -> JsSet(a)
```

Both functions are **unconstrained, eager, shallow constructors of a fresh native collection**. They consume the source once in traversal order, perform no structural hashing or decoding, and therefore return the collection directly rather than `Result`. An infinite source diverges. A throw while advancing a foreign-backed source follows `JsError`; there is no cycle check because native insertion never traverses the inserted key, value, or element.

Duplicate handling is exactly native construction semantics:

- `JsMap.fromSeq` uses SameValueZero/reference identity. A later equal key replaces the value while retaining the native map's original key position and stored key representative.
- `JsSet.fromSeq` uses SameValueZero/reference identity and retains the native set's first stored representative and position.

The result is a captured value from birth (§2): Hexagon-held, unreachable from foreign code, copied when it crosses. Each call creates a new collection and consumes its input once. Reusing the same **Hexagon `Seq`** in two calls replays that persistent memoizing sequence, producing two distinct collections with the same entries. When an exported `fromSeq` is called twice from JavaScript with the same foreign `Iterable`, Part 3 creates a **fresh adapter at each boundary crossing**: a replayable iterable is traversed twice, while a single-shot generator is advanced by the first call and the second observes its then-current (normally exhausted) state. No adapter or collection identity cache is introduced. This is precisely the observable behavior of invoking `new Map(iterable)` or `new Set(iterable)` twice.

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

All four are **eager shallow conversions** (Part 1 §5.1): the named outer collection changes representation; keys, values, and elements retain their runtime values and identities. They never share storage with a persistent collection, and — since the `JsMap`/`JsSet` side is a captured value (§2) — never with foreign code either. Nested conversion is the caller's explicit map, as everywhere.

### 7.2 Outward: total

`Map.toJsMap`/`Set.toJsSet` are **total** — no constraint, no failure mode. Hexagon values are acyclic by construction, insertion into a native collection performs no traversal, and every Hexagon value has a JS representation by definition. Semantics pinned by Collections Part 4 §10.1–10.2, now normative at the boundary:

- primitive and `Bool` keys/elements are faithful (SameValueZero alignment; nothing collapsed, split, or lost — Part 4 §10.1);
- structural keys become **reference-identity** keys: the converted map is a snapshot for JS consumption, not a shared structural index, and JS cannot look up by reconstruction;
- the fresh native collection is a captured value from birth (§2), Hexagon's own; when it crosses to a foreign consumer, that consumer receives a copy to own outright, and the value Hexagon holds is untouched by whatever the consumer does.

### 7.3 Inward: checked, collapsing, cycle-aware

`Map.fromJsMap`/`Set.fromJsSet` traverse the source — a captured `JsMap`/`JsSet`, a stable value, so the traversal is of Hexagon's own collection and nothing foreign can race it — in **its own iteration order** (native insertion order) and perform the destination's hashing/equality work — which is why they carry `<k: Hash>`/`<a: Hash>` while nothing else in this part does. Semantics:

- **Deterministic equality collapse.** Reference-distinct JS keys converting to `equals`-equal Hexagon keys collapse; **for maps, the later entry wins** in source iteration order (Collections Part 4 §10.3 — conversion is morally `fromEntries` over the entry sequence). Set conversion collapses `equals`-equal elements to one, with nothing observable about which (Part 4 §10.3, preserved verbatim).
- **Cyclic structural-key ingestion is a defined checked failure**, not a contract violation: hashing inherently traverses the key, so the check lives lawfully in the conversion (Part 1 §3.2 names exactly this case). A cycle encountered while ingesting a key/element yields `Err(JsConversionError)`.
- **The failure is all-or-nothing**: `Err` returns no partial collection and leaves no observable state.
- **Path obligations, linked to Part 11**: failures originating in these shallow conversions use the collection-specific *map key* or *set element* segment (identifying the entry by its source iteration position where nothing better exists), composed with Part 11's field and 1-based index segments for the nested position inside the key or element, and report a cycle's **current path and first-seen path**. Part 11's general path vocabulary also includes *map value*, but no Part 10 conversion traverses a value, so that segment cannot originate here. `JsConversionError`'s ordinary-data declaration is Part 11's; this part consumes, never redesigns.
- **What is *not* checked**: values (`v`) are never traversed — conversion is shallow, so a cyclic or malformed object behind a declared value type is an ordinary trusted-declaration violation (Part 1 §3.1), exactly as it is at every other crossing. The check exists where the operation inherently traverses; nowhere else.
- Hostile sources — throwing iterators, exotic proxies — surface through `JsError` at the *capture* that produced the `JsMap`/`JsSet` (§2, §4.4), before this conversion ever runs; the conversion itself traverses a genuine native collection. A structural key whose own `hash`/`equals` reaches foreign code and throws remains a `JsError` from inside the conversion (§4.4's split, applied here: shape/cycle failures are `Err`; foreign throws are `JsError`).

---

## 8. Boundary legality of parameters

`k`, `v`, and `a` follow the general rules, applied at declaration site (Part 1 §5.3–§5.4): representation-direct and captured types nest freely (`JsMap(String, Array(Int))` and `JsSet(Hex.Vector<Float>)` are legal faces — the first captured layer by layer, the second carrying its `Vector` elements by identity); **adapter-requiring types are rejected** inside the captured collection (`JsMap(String, Seq(Int))` is the Part 1 §5.3 hard error, with its named rewrite: convert at a controlled boundary or restructure the declaration); and a `JsMap`/`JsSet` **beneath an identity-crossing container**, inside a Hexagon opaque type's representation, in an exception payload, or as an exported value binding takes Part 1 §5.4's refusals. Nothing new — the rules are cited, not extended.

---

## 9. Deferred surfaces (recorded, not designed)

1. **`JsMap.keys` / `JsMap.values` projections** — derivable today as `Seq` combinators over `toSeq`; stdlib-listing candidates alongside the persistent `Map`'s own §7.3 family.
2. **Set-algebra reads over `JsSet`** (`isSubsetOf` etc.) — convert and use `Set`, or bind a JS helper; no core surface.
3. **A writable foreign collection door** — v1 exposes no mutation on any captured collection; a mutable door, if ever, is a new category discussion, not an accessor addition — and a live view of the foreign original is already spelled as an opaque extern handle with `->!` accessors (Part 1 §2.2).
4. **`WeakMap`/`WeakSet`** — not observable collections (no size, no iteration); nothing here fits them. Any future binding is opaque-extern-type territory (Part 4 §5).

---

## 10. Companion discharges applied at promotion

- **ffi-part1-boundary.md §4.1** — the provisional `JsMap`/`JsSet` row is finalized: names `JsMap(k, v)`/`JsSet(a)`; faces `ReadonlyMap<k, v>`/`ReadonlySet<a>`; category **captured** *(#875; borrowed at promotion)*; failure = trusted contents, capture cost (this part §2), inward conversions converted & checked (this part §7.3). The §10 "not yet decided" marker clears.
- **collections-part4-map-set.md §10.4** — the owed list is discharged: names and accessor surfaces (this part §3), cyclic-key failure shape (§7.3, `Result` + Part 11's `JsConversionError`), value conversion is shallow (§7.1).
- **collections-part5-iterable.md §4** — the provided-instance table gains the two FFI-declared rows of this part §6.1, marked FFI-owned like the `Array(a)` row.

---

## 11. Diagnostics checklist

| Situation | Diagnostic / behavior | Owner |
|---|---|---|
| `jsMap[k]` on an absent key | runtime `KeyError` (nullary, prelude; Part 4 §4.3 reused) | §4.1 |
| absent key via `JsMap.get` | `None` — never throws | §4.2 |
| foreign throw during the capture (a hostile or proxied source's iteration protocol) | runtime `JsError` path; never `KeyError`, never `Err` | §2, §4.4 |
| cyclic structural key/element during `fromJsMap`/`fromJsSet` | `Err(JsConversionError)` with current + first-seen paths (Part 11's shape) | §7.3 |
| bracket in write position (`jsMap[k] := v`) | existing corpus-wide error: `[]` is read-only (Collections Part 1 §3.3); no mutation surface exists on a captured collection | §4.5 |
| bracket on `JsSet` (`jsSet[x]`) | hard error; rewrite named: "a set has no payload to retrieve; membership is `JsSet.contains(s, x)`" | §5 |
| slicing attempt (`jsMap[range]`, key type not `Range`) | ordinary type error (element type vs key type); no slicing meaning exists | §4.3, §4.5 |
| adapter-requiring type in `k`/`v`/`a` | Part 1 §5.3's hard error at declaration site | §8 |
| `JsMap`/`JsSet` beneath an identity-crossing container, in an opaque representation, in an exception payload, as an exported value binding; `JsValue.from` at an unresolved variable | Part 1 §5.4's refusals (single owner; this part inherits) | §8 |
| foreign mutation racing the capture copy | not detectable — unspecified contents for that acquisition alone (Part 1 §3.1); the value, once made, is stable | §2 |

---

## 12. Review resolution

Sol review added `JsMap.fromSeq` and `JsSet.fromSeq` (§6.5). The direct constructors avoid a needless `Hash` constraint and persistent intermediate, preserve native equality and duplicate behavior, and make the finite-collection `toSeq`/`fromSeq` suite complete. Review also fixed the failure-path wording in §7.3: *map value* remains part of Part 11's general vocabulary but cannot originate in Part 10's shallow conversions.

---

## 13. Decisions log (quick reference)

| Decision | Where |
|---|---|
| Final names `JsMap(k, v)`/`JsSet(a)`; faces `ReadonlyMap<k, v>`/`ReadonlySet<a>` (native TS, not `Hex.`); **captured** foreign collections *(#875; formerly borrowed zero-copy views, §14)*; no mutation surface; permanent separation from persistent `Map`/`Set`, now by equality regime and boundary shape rather than by ownership | §1 |
| *(#875)* Capture contract: a fresh native `Map`/`Set` built at every declared crossing, both directions, entries read once each in insertion order, keys/values/elements walked at their declared types (Part 1 §5.4); no collapse arises in the copy; nested layers captured in turn; linear cost accepted; copy performs no effect; hostile sources throw `JsError` during capture and never after; racing mutation unspecified for that acquisition only; no identity relation, no cache; fresh collections captured from birth; the borrow contract, the escaped-`Seq` extension, "stable while exclusively held", and live ≡ snapshot are retired | §2 |
| Surfaces: `size`/`get`/`containsKey`/`entries`/`toSeq`/`fromSeq` (map), `size`/`contains`/`toSeq`/`fromSeq` (set); `entries` ≡ `toSeq` definitionally; every read is a read of a value, freely shared or hoisted *(#875; "fresh reads, never cached" retired)*; **no `Hash` anywhere on lookup or direct native construction** | §3 |
| `jsMap[k]` legal, read-only, yields `v`, throws nullary prelude `KeyError` on absence; `JsMap.get` total sibling | §4.1 |
| Lowering (both accessors): map and key evaluated once; **native `has` before `get`**; present `undefined` ≠ absence; **fusion into `get`+`undefined`-test forbidden even when `v` looks `undefined`-free**; nothing can change the captured map between the two *(#875; the borrow-violation clause retired)* | §4.2 |
| **Equality divergence stated prominently**: native SameValueZero/reference identity, vs persistent structural `Hash`; primitives faithful both regimes; structural keys = reference lookups; `JsMap(Range, v)` satisfiable — `Range` element is a key lookup; no slicing | §4.3 |
| Two failure doors: honest absence → `KeyError`/`None`; a hostile/proxied source throws `JsError` during the capture, and the captured native collection's own operations never throw; never mixed | §4.4 |
| No bracket assignment; no slicing; no `at`/positional indexing | §4.5 |
| `JsSet`: no brackets, no `get`; membership is `JsSet.contains`; four rejected spellings recorded (predicate brackets / query echo / O(n) representative / O(n) positional) | §5 |
| `Iterable` rows: `JsMap` yields `(k, v)` (native entries are already tuple-representation arrays), `JsSet` yields elements; native insertion order; lazy `toSeq` over the captured collection with full `Seq` persistence, extending no obligation; native `for...of` licensed as a traversal of a value | §6 |
| `JsMap.fromSeq`/`JsSet.fromSeq`: unconstrained eager shallow construction of a fresh native collection; native duplicate/equality semantics; each call consumes once, with a fresh Part 3 adapter at each foreign boundary crossing and no identity cache | §6.5 |
| Conversions: `Map.toJsMap`/`Map.fromJsMap`/`Set.toJsSet`/`Set.fromJsSet`; eager shallow conversions between two Hexagon-held values; outward total (structural keys → reference identity, primitives faithful); inward `<Hash>`-constrained, later-entry-wins collapse, **cycle during key ingestion → `Err(JsConversionError)`** (all-or-nothing) with collection-specific path segments per Part 11; values never traversed (trusted) | §7 |
| Parameters obey Part 1 §5.3–§5.4 at declaration site; adapter-requiring nesting rejected; captured nesting copied layer by layer; Part 1 §5.4's refusals inherited | §8 |
| Deferred: `keys`/`values`, set algebra, writable door, `WeakMap`/`WeakSet` | §9 |
| Edit notes: Part 1 table row finalized (category captured, #875); Collections Part 4 §10.4 discharged; Part 5 table +2 rows | §10 |
| `Bool` line of the §4.3 faithfulness statement restated after #147 (`Bool` = prelude union pinned to `boolean`; guarantee unchanged, grounds now derived union `Eq` over the pin; restated together with Collections Part 4 §10.1 per its §18 note 4) | §4.3 |

---

## 14. Correction record: the #875 ruling — from borrowed views to captured collections

**What changed.** `JsMap(k, v)` and `JsSet(a)` were zero-copy borrowed views under §2's stability contract — foreign code owned the native collection and promised to hold its entries, elements, and size still while Hexagon, or any `Seq` derived from the view, might observe it; on that promise live and snapshot observation coincided, native iteration was licensed, and the two-step bracket lowering needed no atomicity. The ruling replaces the contract with a capture: the collection Hexagon holds is a fresh native `Map`/`Set` made at the crossing, in both directions (§2; Part 1 §2.2, §5.4). The surfaces (§3), the bracket and its lowering (§4.1–§4.2), the equality regime (§4.3), the set-bracket refusal (§5), the `Iterable` rows and their order (§6.1–§6.2), `fromSeq` (§6.5), the four conversions (§7), and the faces are unchanged; what each of them meant by stability is now the value's own. `Array` made the same move first under #876 (Part 2 §13.2), and this part follows on the same mechanism; with it, no borrowed view remains in the corpus and Part 1 §2.2's retiring clause is spent.

**Why.** `JsMap.size` and `JsSet.size` were pure-faced reads of storage foreign code could vary, held honest by the foreign owner's promise and a rule that the compiler must not hoist the read. A pure collection denotes stable contents, and forbidding an optimisation does not establish purity — purity in Hexagon is a fact about values. The finding was made on these two operations; the repair is the category's.

**Consequences specific to keyed storage, recorded here so they are not rediscovered:**

- **No collapse in the copy.** Keys and elements cross the capture by identity, so their SameValueZero distinctness is preserved exactly; the captured map has the source's `size`, and the equality divergence of §4.3 is untouched — a structural key is still a reference-identity key, and a key object obtained by any route still finds its entry.
- **Captured keys.** A key or element type that is itself a captured collection (`JsMap(Array(Int), v)`, `JsSet(Array(Int))`) is copied by the walk, so the captured collection's keys are fresh objects that only its own traversal can produce. Legal, traversable, unlookupable from outside; §4.3 says so. The rewrite for a structural index is, as ever, the conversions.
- **The atomicity clause is spent**, not repaired: §4.2's has-before-get order exists for the present-`undefined` distinction, and there is no longer a second party who could act between the two steps.
- **`JsError` moves to the capture.** A hostile or proxied source can throw only while its iteration protocol is driven at the crossing; the captured value is a genuine native collection whose operations are the platform's own. §4.4, §6.4, and §7.3 are respelled accordingly.
- **`toJsMap`/`toJsSet` are Hexagon-to-Hexagon.** The outward conversions produce a captured value Hexagon holds; the crossing that hands it to a consumer is what copies. Part 11 §13.1's deferred classification decoders (`JsValue.toJsMap`/`toJsSet`), if they ever land, would be captures like `JsValue.toArray` (Part 11 §4.2).

**The temporary exception this amendment removes.** Between #876 and this ruling, `Array` was captured while this part's pair was still borrowed, and a borrowed `JsMap`/`JsSet` was a container Part 1 §5.4's walk did not enter. One temporary development-stage exception therefore stood, as supported use: storage reachable through a borrowed `JsMap`/`JsSet` remained under the former §2's borrow contract **in both crossing directions**, whichever side built the collection — inbound, an `Array(a)` extracted from a borrowed map could remain borrowed rather than captured; outbound, handing a foreign consumer a map Hexagon built (`fromSeq`, `Map.toJsMap`) transferred the outer collection but not the retained Hexagon arrays inside it, which the consumer had to keep stable wherever Hexagon retained the ability to observe them, escaped closures and deferred traversals included. It was an exception to enforced snapshot isolation, never to purity, and it was documented apart from the reserved-internal-name route, which is a violation and not a use. **This ruling removes it**: the pair is captured, the walk enters it, a captured collection among its keys, values, or elements is captured in turn, and snapshot protection holds in both directions with no exception left in the corpus. Part 1 §2.2 and Part 2 §12 point here for the record.

**Rejected alternatives** are Part 2 §13.2's, which apply here without change and are not restated: the no-hoist rule; inbound-only copying; runtime classification (`instanceof Map` being realm-bound is the very obstacle Part 11 §13.1 records); freezing (which does not reach native `Map`/`Set` at all — `Object.freeze` leaves `set` and `add` working, which is why freezing could never have been the mechanism for this part); copying through identity-crossing containers; an identity cache for conversion wrappers. One alternative is this part's alone: **converting `JsMap` into the structural-key persistent `Map` at the crossing.** Rejected, per the ruling: it changes the equality regime the type exists to preserve (§4.3), demands a `Hash` the surfaces deliberately lack, and is already available, explicitly and checked, as `Map.fromJsMap` (§7.3).
