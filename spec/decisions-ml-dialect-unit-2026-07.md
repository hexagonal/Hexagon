# Hexagon Spec: Decisions — `Unit` is the Empty Tuple

**Status:** Decided (ruling on issue #159, 2026-07-30). Fable's spec ruling under the ML-dialect doctrine (`decisions-ml-dialect-bool-2026-07.md` §1), commissioned by James in-session 2026-07-30; the issue's analysis (James with Opus) is adopted where cited. Authoritative until consolidated into the host specs, per README authority rule 3 — this document is added to rule 3's closure-document list in this same PR; the standing is conferred there, not claimed here.
**Scope:** The reclassification of `Unit` from primitive to the empty tuple (§2); the type's name and what `()` is *not* (§3); the arity-0 representation clause (§4); the no-observable-change evidence (§5); what the reclassification deletes (§6); rejected alternatives (§7); the edit-notes ledger (§8); implementation notes for `hexc` (§9).
**Not in scope:** Any change to function arity or parameter lists — Functions §5.3's zero-ary domain `() -> T` is *load-bearing for* this ruling and untouched *by* it (§3). The FFI boundary (unchanged — §4.3). The book's "primitive types" grouping (#158, ruled separately on that issue). Multi-line comment syntax (forthcoming, its own issue).
**Companions:** Products §2 (host of the normative text — new §2.7 there), Primitive Types (host of the correction record, §13 there), Pattern Matching (the dissolved `Unit` pattern and exhaustiveness clause), Functions §5.3 (the zero-ary domain), Constraints §4.5 (automatic structural instances), Modules §2 (structural types belong to no module).

---

## 1. The ruling

> `Unit` is the **empty tuple** — the arity-0 member of the tuple family (Products §2) — and leaves the primitive set. `()` remains the type's only value literal and becomes exactly what the corpus already calls it: the empty-tuple literal, the nullary case of the tuple form. `Unit` remains the type's only name (§3). The JS representation remains `undefined`, restated as the arity-0 clause of the tuple representation rule (§4). No v1 program observes any change (§5).

This is the doctrine pivot's second consequence, and its cheapest. The corpus had already written the truth before the doctrine caught up: Primitive Types §9 introduced `Unit` for "the Standard-ML-flavoured function design, where every function takes exactly one thing — a single value, a tuple, or **the empty tuple `()`**", and Products §2.1 called `()` "the nullary case of the tuple family". SML — the tradition those words name — presents unit as the empty product; OCaml likewise names the type (`unit`) and spells the value `()`. The reclassification does not adopt a new design; it retires the classification that disagreed with the design's own description.

The record-update re-spelling (`{p with f = 42}`, Products §9) and `union Bool` (#147) preceded this ruling in the same doctrine arc; James's framing for the arc is that these are the small changes that complete the ML surface.

---

## 2. What `Unit` is now

### 2.1 The tuple family has every arity except one

Products §2.1's "arity ≥ 2" becomes **"arity 0, or 2 and above"**: `()` is the empty tuple, `(e)` is grouping (unchanged — there are still no 1-tuples), `(e1, e2, …)` are the positional products. The arity hole at one is the same hole it always was, created by grouping parens, not by this ruling; it costs the one sentence Products §2.1 now carries (#159 open question 1, answered).

Consequences, each an ordinary tuple fact applied at zero:

- **The `()` pattern is the arity-0 tuple pattern.** A tuple pattern is irrefutable iff its components are — vacuously true at zero. The dedicated "Unit pattern" row (Pattern Matching §5.1) folds into the tuple row; the special case is not replaced, it stops existing (issue analysis, adopted).
- **Exhaustiveness routes through the tuple clause.** Pattern Matching §7.1's finite-domain listing drops its standalone `Unit` entry; a `match` on `Unit` with a `()` arm is exhaustive with no `_` via "tuples of finite domains", at zero components.
- **`itemN` at arity 0 is the ordinary arity error.** `().item1` reports Products §2.3's existing message with K = 0: "this tuple has 0 components; there is no item1". No `Unit`-specific wording exists or is needed.
- **Constraints are the automatic structural instances** (Constraints §4.5), componentwise at zero components: `Eq` is the vacuous conjunction (`true`), `Ord` the vacuous lexicographic comparison (`Equal`), `Show` the zero-element parenthesization (`"()"`), `Hash` the empty fold (a constant). Defined iff every component type has the constraint — vacuously satisfied, so `Unit` carries all four unconditionally, as it always has. Like every structural type, user-closed: no `honor` may target it (Constraints §9.3). Neither `Num` nor `Signed`, structurally — no tuple has them; the former fiat sentence becomes a consequence.

### 2.2 Diagnostics and display vocabulary (binding)

Diagnostics and the type pretty-printer say **`Unit`**, never "the 0-tuple", "the empty tuple", or `()`-as-a-type. The reclassification is spec-internal vocabulary in the same way "row" is (Products §4): a user sees `Unit` in every inferred type, hover, and error, exactly as today. Prose in this corpus may say "the empty tuple" when the *classification* is the point.

---

## 3. The name: `Unit` is the type's only spelling, and `()` is not a type

### 3.1 The ruling

> `()` is **not a type expression**. In type syntax, parentheses mean what they mean today and nothing more: grouping `(T)`, tuple types `(T1, T2, …)` at arity ≥ 2, and the parameter list of a function type — where `() -> T` is the **zero-parameter domain**, which Functions §5.3 holds "is not a type". The empty tuple's type is written `Unit`, and only `Unit`. (#159 open question 2, answered as the issue recommended.)

This is load-bearing, not taste. If `()` were a type, `() -> T` would collapse into `Unit -> T` — and Functions §5.3 exists to keep those apart: `() -> T` takes no argument; `Unit -> T` takes one argument that happens to be `Unit`. That distinction is the n-ary, no-currying parameter design at its boundary, and James re-affirmed the design against SML-style single-parameter functions on 2026-07-30 (rejected again; do not re-propose). The asymmetry — value spelled `()`, type spelled `Unit` — is SML's and OCaml's exactly: both name the type and spell only the value with parens. Haskell's `()`-as-both is the spelling this section forecloses (§7).

### 3.2 Where the name lives

`Unit` remains a **compiler-known type name**, exactly as language-provided as the tuple syntax itself. It does not become a prelude declaration: structural types have no declarations, no home module (Modules §2), and no derivation door to walk through — which is why nothing here needs the `Bool.hex` machinery of #147 §3.5 (no source file, no shape verifier, no privileged declaration). There is also nothing to write on an alias's right-hand side, since §3.1 keeps `()` out of type syntax; a prelude `type Unit = ()` is unspellable by construction, not merely undeclared.

What changes is only what the name *denotes*: an opaque primitive before, the arity-0 structural product now. `CompanionOf(Unit)` remains the fixed prelude companion module (Method Syntax §4.3) — keyed to the name, dispatch outcome unchanged; the receiver-classification tables move `Unit`'s row as classification hygiene (ledger, §8), flagged because dot-call dispatch has proven sensitive to symbol classification (#134's lesson).

---

## 4. The representation clause

### 4.1 The ruling

> Tuple representation is **arity-indexed**: at arity ≥ 2, a plain JS array (Products §2.6, unchanged); at arity 0, **`undefined`** — with the `.d.ts` face `void` in return position and `undefined` elsewhere (unchanged from Primitive Types §9 / FFI Part 1 §4.1).

### 4.2 A clause, not a pin (#159 open question 3, answered)

#147's pin is a *privilege granted to a declaration* — the sole exception to a representation rule that would otherwise apply, carried by prelude source under a shape verifier. This ruling has no declaration to privilege and no rule being excepted: it is a clause **of** the structural representation rule, in the same way the `.d.ts` faces already differ by arity. The principled ground: a tuple is an array *because it has positions*; the 0-tuple has none, so "nothing" is the honest unboxed representation, and `undefined` is JavaScript's spelling of nothing — a JS function that returns `Unit` is a JS function that returns nothing. Emitting `[]` would allocate an object to say nothing (§7). Under the doctrine (`decisions-ml-dialect-bool-2026-07.md` §1.1) this is precisely the licensed kind of JS-specific fact: representation at a zero-cost boundary.

The clause is a redescription of existing behaviour — `Unit` emits `undefined` today — so unlike #147 there is no emission consequence at all; §5 carries the evidence.

### 4.3 Safety condition, audited (#159 open question 4, answered)

The clause is sound only if nothing consumes a tuple **arity-generically at runtime** — code that would do `value[0]` or `value.length` on "some tuple" would break on an `undefined`. Audited at ruling time against `hexc`:

- All four structural derivations (`#derivedEquals`, `#derivedCompare`, `#derivedShow`, `#derivedHash`, `compiler/src/passes/emitter/emitter.ts`) bake component indices at **emission time**, per concrete type; no runtime loop over tuple components exists.
- Destructuring and `itemN` are arity-checked at compile time and emit fixed indices.
- Hexagon has **no arity polymorphism** — Functions §5.2's parameter-list polymorphism is post-v1. That feature is this clause's **pre-registered reopener**: if it ever lands, its design must either exclude arity 0 from generic traversal or revisit this clause first.

### 4.4 FFI: nothing moves

`Unit ↔ undefined` was zero-cost in both directions before this ruling and still is: Part 1 §4.1's `Unit` row, Part 6 §3's discarding rule for declared-`Unit` foreign results, the `() -> r` no-manufactured-argument rule, and the `Nullable`-is-unrelated caution all survive verbatim. One table needs a clarifying note (Part 1 §4.1's Tuple row now has an arity-0 exemption pointing here — ledger); the rest is classification prose, not behaviour.

---

## 5. No observable change: the evidence

#147 had one silent behaviour change (the `Show` flip) and recorded it with eyes open. This ruling has **none**, and the claim is verified rather than asserted — the fiat answers and the structural answers were compared at ruling time (#159 open question 5, answered):

| Operation | Fiat (Primitive Types §9, today) | Structural at arity 0 (emitter, verified) | Agree |
|---|---|---|---|
| `show ()` | constant `"()"` (§7 table) | zero-element branch emits `'"()"'` | ✓ |
| `() == ()` | `undefined === undefined` → `true` | vacuous conjunction emits `true` | ✓ |
| `compare((), ())` | `0` (`Equal`) | `lexicographicComparison([])` emits `0` | ✓ |
| `hash(())` | `stableHash(undefined)` = `0` | empty `mixHash` fold, seed `0` | ✓ |

The hash row is the strong one: not merely "both constant" but **the same constant**, so even a persisted hash or a `Set(Unit)` membership computed under the old regime is valid under the new. The zero-element branches already exist in the emitter's tuple cases — the reclassification does not add them; it makes them load-bearing. The decree in Primitive Types §7 ("JS would give `"undefined"` — stupid; replaced") is not replaced by a different answer: it **becomes a derivation computing the same answer** (issue analysis, adopted verbatim — it was the striking evidence).

The empty *record* `{}` is the precedent already shipping: a zero-field structural product whose derived instances come from the same zero-element branches (`'"{}"'`, vacuous `true`). The 0-tuple joins machinery that was never arity-1-plus to begin with.

---

## 6. What the reclassification deletes

Each item is a special case that existed because `Unit` was a primitive with product-like aspirations:

1. **The standalone `Unit` clause in exhaustiveness** (Pattern Matching §7.1's finite-domain listing) — dissolved into "tuples thereof" at arity 0.
2. **The dedicated `()` "Unit pattern"** (Pattern Matching §2's grammar comment, §2.3, §5.1's table row) — now the arity-0 tuple pattern; irrefutability is the tuple rule, vacuously.
3. **Primitive Types §9's fiat constraint rows** (`Eq`/`Ord`/`Show`/`Hash` "trivially") — now the automatic structural instances, with "trivially" made precise as "vacuously, at zero components". The "neither `Num` nor `Signed`" decree becomes a structural consequence.
4. **Primitive Types §7's `Unit` Show row as a decree** — the table row survives as a record of the *output*, re-grounded as the derived structural show (jurisdiction clause extended: tuples exit to Products §2.5, as unions already exit to Unions §7).
5. **The checker's fiat inventory row** (`Unit: ["Eq", "Ord", "Show", "Hash"]` in `supports()`) — implementation, §9.

Nothing is deleted from Functions: §5.3's `() -> T` / `Unit -> T` distinction, its diagnostics, and the eta-wrap seam are untouched and newly cited as load-bearing (§3.1).

---

## 7. Rejected alternatives (do not re-litigate)

- **A one-case union** (`union Unit = …` — the #147 analogy, James's first framing, moved off in the issue and recorded there so it is not re-proposed). Three costs the product framing does not pay: the constructor must be spelled, and `()` as a constructor is *punctuation* — a larger carve into the uppercase-start rule than the lowercase constructors #147 §5 rejected to protect it, while naming it `Unit` instead yields dual spellings (Operators §1.2's words-only doctrine kills that); `show ()` would flip to `"Unit"`, a silent display change replacing an output Primitive Types §7 chose deliberately — and a worse flip than #147's; and it recategorises against the corpus's own SML framing, which presents unit as the empty product, not a sum.
- **`()` as a type expression** (Haskell's spelling). Collapses `() -> T` into `Unit -> T`, destroying Functions §5.3's zero-ary domain and, with it, the boundary of the n-ary no-currying design — SML-style single-parameter functions were re-rejected by James 2026-07-30. Independently: two spellings for one type, against the one-name doctrine. The redirect diagnostic is specified in Products §6 (bare `()` in type position names `Unit` and the one legal `()` type-syntax role).
- **A prelude source declaration** (the `Bool.hex` route, #147 §3.5). Nothing to declare: structural types have no declarations, no home module, and their instances arrive without a door (Constraints §4.5); and the alias form is unspellable while §3.1 holds. Adopting the route anyway would manufacture the machinery — source file, shape verifier, provenance story — that this ruling's whole cheapness consists in not needing.
- **Keeping primitive `Unit`.** The standing design, correct under the superseded doctrine; re-arguable only by reversing the pivot itself. Its cost under the new doctrine: four permanent decree-sites (pattern, exhaustiveness, constraint fiat, Show fiat) for a type the tuple machinery describes for free — the exact mirror of #147 §5's first row.
- **Emitting the uniform tuple representation `[]`.** Every effect-only function in the language would allocate an array to say nothing; `.d.ts` return faces become `[]` instead of `void`; the "a `Unit` function is a JS function that returns nothing" interop story — the best sentence in the old §9 — dies. This is the JavaScript-specific fact (§1.1 of the doctrine) that earns `undefined` its place.

---

## 8. Edit-notes ledger

Applied in this ruling's PR (direct edits): **Products** (§2.1 arity, §2.5 zero-arity sentence, §2.6 arity clause + emission row, new §2.7 normative host, §6 diagnostics row, §7 log, new §10 correction record), **Primitive Types** (scope line to five primitives, §1 table row retained for the representation fact, §7 rule's jurisdiction clause + table row, §9 pointer, §10 log, new §13 correction record), **Pattern Matching** (§2 grammar comments, §2.3, §5.1 irrefutability row, §7.1 exhaustiveness listing, §13 log), **README** (rule 3 list, ownership map), **Type System Overview** (router rows), **spec-roadmap** (§4 ripple registration).

Owed, applied on next touch of the target doc (README authority rule 4):

| Target | Note |
|---|---|
| Collections Part 2 §2.5 | `Hash<Unit>`'s row changes provenance: from the primitive inventory's "constant" to the automatic structural tuple instance at arity 0 — same constant (§5). The row moves from the primitive listing to wherever that table records structural `Hash`; algorithm and consistency rule unchanged. |
| Collections Part 4 §10.1 + FFI Part 10 §4.3 | **Normative dependency, the #147-shaped one:** both lead-ins enumerate "every primitive, exactly the `Hash`-bearing primitive inventory of Part 2 §2.5", which goes stale for `Unit` a second time. The faithfulness guarantee **still holds** — one value, crossing as `undefined`; Part 4 §18's own `Unit` line already argues it — but its grounds become "structural `Eq` at arity 0 over the `undefined` representation". Restate both lead-ins in one edit; the two are change-controlled together per Part 4 §18 note 4. **Also stale in §18 itself** *(review finding 2, completed at verification)*: note 2's `Bool`-bullet parenthetical ("the six primitives are one clause") and note 3's "closed seven-primitive inventory" count `Unit` among the primitives, note 4's "closed at seven / six primitives since #147" counts drop to five, and note 4's procedure — written only for *adding* a primitive — gains the clause #147's and #159's own restatements have both exercised in practice: a *reclassification out of* the primitive set equally touches these lines, with grounds restated rather than a type added. |
| FFI Part 1 §4.1 | `Unit` row keeps its face verbatim; the **Tuple** row gains the arity-0 exemption note ("arity ≥ 2; the empty tuple is `Unit`, row above" — §4 here). §5's primitive-requirements prose reclassifies `Unit` if it names it. |
| `ffi.md` §6 master table | The `Nat`/…/`Unit` "native primitives" row: `Unit` reclassifies to a tuple-family clause with a §4 pointer; face unchanged (`void`-in-return). |
| Method Syntax §3.4 receiver-shape table + §4.1 companion table | `Unit` moves from the **Primitive** rows, joining `Bool`'s #147 move; `CompanionOf(Unit)` remains the fixed prelude companion (§3.2 here). Dispatch outcome unchanged — classification hygiene, flagged for the #134 reason. |
| Collections Part 5 §4 | The non-iterables note: `Unit`'s membership grounds respell from the primitive clause to the tuple clause (tuples are §3.2 concrete-non-iterable; arity 0 included). Still not iterable. |
| Functions §5.3 | Cross-references to "Primitive Types §9" remain valid (§9 is a pointer, house rule); on next touch, "constraint memberships are fixed in Primitive Types §9" may respell to name Products §2.5/§2.7 directly. No behavioural content changes. |

**No corpus-wide respelling rule is needed** — unlike #147, no spelling changes anywhere: `Unit` is still written `Unit`, `()` is still written `()`. The ledger above is the whole ripple.

---

## 9. Implementation notes (hexc — follow-up work, not this PR)

- **Checker:** `Unit` and the arity-0 tuple type must be *one type*. Whether the internal representation re-founds `Primitive "Unit"` as `Tuple []` or keeps the primitive node as an interned synonym is the implementer's choice; what may not survive is two types that need a unification bridge. Delete the `supports()` fiat row; `Unit` routes through the structural-tuple constraint path, whose zero-element branches already exist and produce the §5 constants. **The fiat row has a second consumer** *(review finding 5)*: the Numeric Literals §6 demand-site settling path (`#settlesAtUnitDemand` → `#satisfiedAt(name, "Unit")`) consults it, so a naive deletion regresses #109/#135's defaulting diagnostics — that path must route through the structural answer (or keep an explicit `Unit` case) in the same change.
- **Parser:** no token changes. `()` already lexes as one form; it reclassifies as the tuple literal at arity 0, and the `()` pattern as the tuple pattern at arity 0. Bare `()` in type position gets the §7 redirect diagnostic ("the empty tuple's type is written `Unit`; `()` in type syntax is only the zero-parameter domain `() -> T`").
- **Emitter:** the tuple representation decision point gains the arity-0 → `undefined` branch (today the constant lives in the `Primitive` branches). **"The decision point" is three sites, not one** *(review finding 4)*: the derivations above, the tuple *literal* expression (which would emit `[]`), and irrefutable tuple-pattern destructuring (where a generic `const [] = e` on an `undefined` is a runtime TypeError) — all arity-0 cases must route to the `undefined` representation. All are emission-time; §4.3's runtime audit is unaffected. The `Primitive`-branch fast paths in the four derivations may stay — they compute the §5 constants — or fold into the tuple branches; either way the outputs are pinned. **The `.d.ts` writer is unchanged only under the interned-synonym choice** *(review finding 3)*: if the checker re-founds `Unit` as `Tuple []`, `renderType`'s tuple case would print `[]`, so it must gain the arity-0 case (`void` in return position, `undefined` elsewhere — §4.1's faces, never `[]`).
- **Conformance:** `show ()` = `"()"` and the composite `show (((), 1))` (zero case inside a positive-arity case); `() == ()`, `compare`, `hash` constants pinned — `hash(())` specifically pinned to `0` (the §5 continuity fact); `().item1` reports the K = 0 arity message; a `match` on `Unit` with a `()` arm is exhaustive with no `_`, now exercising the tuple path; the Functions §10 thunk/`Unit`-taking diagnostics still fire unchanged (the §3.1 regression guard); the type-position `()` redirect fires, and `() -> T` annotations still parse.

---

## 10. Decisions log

| Decision | Where |
|---|---|
| `Unit` is the empty tuple; leaves the primitive set; tuple family = every arity except one | §1, §2.1; Products §2.7 |
| `()` pattern = arity-0 tuple pattern; exhaustiveness via the tuple clause; `itemN` arity error covers K = 0 | §2.1 |
| Constraints = automatic structural instances, vacuous at zero; user-closed; no `Num`/`Signed` structurally | §2.1; Constraints §4.5 |
| Diagnostics and pretty-printer say `Unit`, never "0-tuple"/"empty tuple"/`()`-as-type | §2.2 |
| `()` is not a type expression; `() -> T` stays the zero-ary domain; type's one name is `Unit`; redirect diagnostic | §3.1; Products §6 |
| `Unit` = compiler-known name for a structural type; no prelude declaration, no shape verifier; `CompanionOf(Unit)` unchanged | §3.2 |
| Representation: tuple rule is arity-indexed; arity 0 = `undefined`, `void`-in-return — a clause, not a pin; redescription of existing behaviour | §4.1–§4.2 |
| Safety audited: no arity-generic tuple traversal exists; parameter-list polymorphism (Functions §5.2) pre-registered as the reopener | §4.3 |
| FFI unchanged; Part 1 Tuple row gains the arity exemption note | §4.4, §8 |
| Zero observable change, verified per operation; `hash(())` = `0` continuity | §5 |
| One-case union, `()`-as-type, prelude source declaration, primitive status quo, `[]` emission: rejected | §7 |
