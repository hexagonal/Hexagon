# Hexagon Spec: Collections Part 5 — `Iterable` & Collections Closeout

**Status:** Decided (July 2026); pre-landing corrections incorporated in place (§18). Fifth and final part of the Collections effort. The authoritative operational specification of v1 `Iterable`: the resolution and typing of `for p in e`, the finalized provided-instance table (nine rows: six collections-owned, three FFI-owned), table-opening for user instances, static-resolution emission, the collections/stdlib boundary, and the transients decision. Written against Collections Parts 1–4, Constraints, Loops/Ranges/Iteration, Pattern Matching, and Modules; none re-litigated.
**Scope:** The `for p in e` resolution algorithm and four-way failure taxonomy (unsolved-metavariable vs rigid-type-variable split; the two-legal-homes user-nominal message); the provided instance table (§4); `Iterable<String>` with `Item = String` and the `String.toSeq`/`String.fromSeq` conversion pair (`fromSeq` = concatenation, full contract §5.3); the collection-conversion-suite domain (finite collections; `Range` and `Seq` exempt with reasons); `iterate` as a real prelude term; user-instance mechanics, discoverability, and provided-instance collisions; the "writing your own collection" recipe, normative, with `Bag(a)`; static-resolution emission; the combinator-surface boundary; transients runtime-internal only.
**Not in scope:** The `Iterable` declaration and type-member grammar (Part 2 §5–§8 — consumed, not restated); the v2 associated-types remainder (deferred `Item(α)` goals, `Item(c)` reference syntax, member obligations, `Iterable` binders, `derive via` — Part 2 §11, Part 1 §6.3); the combinator families themselves (`stdlib-roadmap.md` ledger, decided at the stdlib listing; boundary drawn in §10); `AsyncSeq` and any `for await` form (Loops §11.4); **everything normative about the borrowed foreign views `Array(a)`, `JsMap(k, v)`, `JsSet(a)`** — types, borrow contracts, observation semantics, conversions, emission, `.d.ts` faces (FFI Parts 2 and 10; §4 records their instance rows, §6 the discharged `Array` ownership); the foreign (`.d.ts`) representation of constraints on exported polymorphic functions (FFI spec; see §9.3); `String.join`-style conveniences (stdlib listing).
**Companions:** Collections Part 1 (§6.1/§6.5 made normative here; §9.5/§9.6 closed); Collections Part 2 (§8 declaration; §7.2 binder ban; §9 diagnostics extended); Collections Part 3 (§8 `Iterable<Vector>` row; §9 linear idiom cashed by §5 here); Collections Part 4 (§7.2 rows; §13.1/§13.4 closed here); Loops/Ranges/Iteration (§2.3 desugaring; §5 table finalized as §4 here; §6 `Seq`; §7.1 judgment made normative as instance lookup); Pattern Matching (§5 five-positions gate); Modules (§7 instance globality and orphan rule; §7.6 discoverability); Constraints (§5.1 coherence; §2.2 members); FFI Part 2 (§§6, 8–9: the `Array(a)` obligation discharged); FFI Part 3 (`Seq(a)` boundary crossing); FFI Part 10 (§6 `JsMap`/`JsSet` rows); Primitive Types (§5.1 String indexing).

---

## 1. Doctrine

- **The table is the constraint.** The Loops §5 iterable table *is* `Iterable`'s instance table (Part 2 §8); this document finalizes its v1 rows and opens it to users. There is no second mechanism, no registry beside the constraint system.
- **"You can write a real collection" is a v1 requirement, and `for x in myBag` is its floor** (Part 1 §6.1, discharged here). The whole tax is one small `honor` block.
- **v1 iteration is monomorphic.** The projection-bearing binder ban (Part 2 §7.2) means every `for..in` site knows its collection's outer constructor at compile time. Static instance resolution and dictionary-free loop emission are therefore *consequences*, not optimisations (§9.1).
- **Iterable and "in the conversion suite" are different properties.** Every **finite collection type** provides `toSeq`/`fromSeq` under exactly those names — deliberately including `String` (§5). `Range` is iterable but is not a collection: it is exempt (`Range.fromSeq` has no natural meaning; a public `Range.toSeq` is at most a stdlib-listing candidate). `Seq` is the conversion **currency itself** and needs no identity wrappers to satisfy a slogan; it crosses the FFI boundary through FFI Part 3's explicit adapters. `Array(a)` is a suite member (decided by FFI Part 2 §8.3; §6 here). Third-party collections are expected to provide the pair as part of the recipe (§8.1).
- **Structure here, combinators there.** The collections specs own what a collection *is*; the stdlib listing owns the combinator families over it (§10). The Part 1 §3 naming doctrine binds both.

---

## 2. The constraint, the member, and the table

### 2.1 The declaration (by reference)

```
constraint Iterable<c> =
  type Item
  iterate(xs: c): Seq(Item)
```

Normative home: Part 2 §8 (declaration, `Item` naming, projection-bearing status, binder and reference bans). Nothing is redeclared here; this document is its operational half, exactly as Part 2's not-in-scope line promised.

### 2.2 The judgment is instance lookup

Loops §7.1's judgment **Iterable(τ) = ε** is hereby defined normatively as: *look up the unique global `Iterable` instance whose head constructor is τ's outer constructor; ε is that instance's `Item` binding under the substitution of τ's arguments.* Uniqueness is coherence (Constraints §5.1); globality is Modules §7.1; user rows enter per §7 here. The judgment's shape is unchanged from Loops — it was always a functional-dependency table; the table simply has a public door now.

### 2.3 `iterate` is a real prelude term

With Part 2 §8's promotion, `iterate` is an ordinary constraint member: a module-scope term name (Constraints §2.2), callable at concrete types by head-constructor lookup (Part 2 §7.2) — `iterate("abc") : Seq(String)`, `iterate(myBag) : Seq(Int)`. Consequences, stated once:

- **Loops §2.3's reference desugaring now names this member.** The `iterate(e)` in the desugaring, formerly described as compiler-internal, is the constraint member itself; the desugaring is otherwise character-for-character unchanged (edit note, §16).
- **Qualified home:** per the Modules §6.4 invariant, the stdlib listing must give `iterate` a qualified home; `Iterable.iterate` is the presumed companion-module spelling. Ordinary prelude occlusion applies (Modules §5.4): a module-level user `iterate` occludes the bare name module-wide; the qualified form stays reachable.
- `Seq.next` and the functional-cursor protocol are untouched (Loops §6.2).

---

## 3. `for p in e`: resolution and typing

### 3.1 The algorithm (normative)

For `for p in e` with body `b`:

1. Typecheck `e` **once**, yielding τ. (`e` is evaluated once at runtime, before iteration — Loops §2.3, unchanged.)
2. Resolve τ's **outer type constructor**. If it is not known — τ is an unsolved metavariable or a rigid (binder-bound) type variable — fail per §3.2.
3. Look up the unique global `Iterable` instance for that constructor (§2.2). If none exists, fail per §3.2.
4. Substitute τ's arguments into the instance's `Item` binding, yielding the element type ε.
5. Check the loop pattern `p` against ε. `p` is a full pattern; its binders are **head binders** (Statements §5, via Pattern Matching's loop-head position).
6. Require `p` to be **irrefutable at ε** (Pattern Matching §5 — the one gate, no loop-specific dialect).
7. Check `b` against `Unit` (Loops §2.2, unchanged, including the discard-error phrasing).
8. The whole expression has type `Unit`.

Steps 5–6 consume Part 4 §7.2's supersession of Loops §2.1: loop heads are one of Pattern Matching's five positions; `for (k, v) in m` is the canonical beneficiary.

### 3.2 Failure taxonomy — four cases

The single Loops §7.1 unsolved-case message is hereby **split**: an annotation fixes a metavariable; it cannot fix a rigid variable, and telling the user to annotate a generic parameter is a false trail. The rigid case reuses Part 2 §9's binder-ban hint verbatim, because it is the same fact surfacing at a use site.

| τ at step 2/3 | Error |
|---|---|
| Unsolved metavariable | "cannot determine what `xs` iterates over; add a type annotation" (unchanged) |
| Rigid type variable (a binder of the enclosing function or instance) | "`xs` has the generic type `c`, and `Iterable` cannot constrain a type variable in v1; take a `Seq(a)` parameter instead" |
| Concrete constructor, no instance, **not** a user nominal type | "`Int` is not iterable" + a conversion hint where one exists |
| Concrete constructor, no instance, **user nominal type** | the two-legal-homes form, §3.3 |

### 3.3 The user-nominal diagnostic names both legal homes

For a user nominal `T` with no instance, the message is the loop-side face of the instance-discoverability obligation (Modules §7.6). The compiler always knows both legal homes — the orphan rule's search space of size two — and the message names **both**, leading with the actionable one:

> `Bag(Int)` is not iterable. Define `honor<a> Iterable<Bag(a)>` in `./bag.hex`, which declares `Bag`. The only other legal home is the prelude module declaring `Iterable`. Alternatively, convert with `Bag.toSeq`-style functions, or take a `Seq(a)` parameter.

The prelude home is not user-editable, but naming it makes the two-home rule accurate and explains *why no third module can provide the instance* — the orphan rule handed to the user as a closed search space, not a hint. This subsumes Part 1 §6.4's earlier hint amendment, upgraded to name the files.

---

## 4. Provided instances: the finalized v1 table

All compiler/runtime-provided (Part 2 §4.4 wording — specified normatively, no source form). This is the complete v1 table: the first six rows are collections-owned; the final three are FFI-owned borrowed views.

| Type | `type Item` | `iterate` | Fixed by |
|---|---|---|---|
| `Range` | `Int` | the range's progression (ascending or descending per the value; Loops §3) | Loops §3/§5 |
| `Vector(a)` | `a` | `Vector.toSeq` | Part 3 §8 |
| `Seq(a)` | `a` | identity | Loops §6 |
| `Map(k, v)` | `(k, v)` | `Map.toSeq` (≡ `entries`) | Part 4 §7.2 |
| `Set(a)` | `a` | `Set.toSeq` | Part 4 §7.2 |
| `String` | `String` (one codepoint) | `String.toSeq` | **§5 here** |
| `Array(a)` | `a` | `Array.toSeq` | FFI Part 2 §8 |
| `JsMap(k, v)` | `(k, v)` | `JsMap.toSeq` (≡ `entries`) | FFI Part 10 §6 |
| `JsSet(a)` | `a` | `JsSet.toSeq` | FFI Part 10 §6 |

Notes:

- The final three rows inherit their observation and emission semantics from their owning FFI parts; this table records their coherent `Iterable` instances rather than restating those borrow contracts.
- `Range` participates in iteration but not in the conversion suite (§1); its `iterate` is runtime-internal. `Seq`'s row is the identity — the currency needs no conversion into itself.
- No other v1 type is iterable. In particular `Option`/`Result` are not (matching is their consumption form), and `Bool`/`Int`/`Float`/`Unit`/functions are the §3.2 concrete-non-iterable case.
- This table closes Loops §11.6 and is the finalized Loops §5 inventory (Loops now defers here by reference).

---

## 5. `String`: iterable, and its conversion suite

### 5.1 The instance — `Item = String`, one codepoint per item

`Iterable<String>` is provided, with `type Item = String`; each item is a **one-codepoint `String`**, in codepoint order. This closes the question Loops §11.6 left open, in the only way it could close:

- Hexagon has no `Char` (Primitive Types §5.1); a one-codepoint `String` is the established unit — it is exactly what `s[i]` returns (Part 3 §9).
- Part 2 §8 already carried `String` in the provided-row inventory; Part 3 §9 already tells users "the linear idiom is `for c in s`". This section makes both honest.
- **`for c in s` is O(n) total** — a single pass — which is precisely the escape from the O(n²) bracket-in-a-loop trap Part 3 §9 warns about. The doc states the pairing: brackets for occasional access, the loop for traversal.
- Grapheme-cluster iteration, if it ever ships, is a named stdlib function (mirroring Part 3 §9's indexing stance); the instance is codepoints, permanently.

### 5.2 `String.toSeq`

`String.toSeq : String -> Seq(String)` — the codepoint sequence, in order. Lazy (a `Seq` view over an immutable string is safe by construction); O(1) to create, O(n) to exhaust. **There is no `String.codepoints` synonym** — Loops §11.6's interim name is not introduced; the uniform suite name is the API (rejected alternative, §13.1).

### 5.3 `String.fromSeq` — concatenation, full contract

`String.fromSeq : Seq(String) -> String` — concatenates the elements. The contract, normative:

- **Empty sequence produces `""`.**
- **Elements concatenate in the sequence's traversal order.**
- **Elements may be strings of any length** — `""`, one codepoint, many. `fromSeq` is forgiving, like every `from*` constructor (`Vector.fromSeq` accepts any `Seq`, not only ones produced by `Vector.toSeq`); semantically it is the fold of `++` (`Concat<String>`, Operators §7) over the sequence.
- **No Unicode normalization occurs.** The result is exactly the codepoint concatenation of the inputs; `fromSeq` never inspects, folds, or canonicalizes content.
- **Eager; an infinite `Seq` diverges** (the `from*` family stance, Part 3 §7.2 / Part 4 §3.4).
- **Complexity: linear in the total input/output length.** *Implementation note (binding on the emitter/runtime):* collect chunks and join (`parts.join("")`-shaped); the fold-of-`++` description above is **semantic only** and must not license quadratic repeated immutable concatenation.
- **Round-trip law, one-sided:** `String.fromSeq(String.toSeq(s)) == s`, for every `s`. The converse makes no chunk-boundary claim: `toSeq(fromSeq(xs))` yields one-codepoint items, not `xs`'s original chunks.

This keeps the finite-collection conversion suite (§1) exception-free where it applies. A separator-taking `join` is a stdlib-listing candidate (§14.2) and does not replace this.

---

## 6. `Array(a)`: ownership decided here, discharged by FFI Part 2

### 6.1 The obligation, discharged

The *direction* — the foreign door is iterable — was decided here as a binding obligation on the v1 FFI spec (`Iterable<Array(a)>` with `type Item = a` and `iterate = Array.toSeq`) and was never FFI's to reopen. Everything that gives the row meaning was FFI's to define, and FFI Part 2 has discharged it in full; nothing about `Array` iteration remains open, and none of it is restated here:

- **Stability and observation.** FFI Part 2 §6.2 fixes the borrowed stability contract; §6.5 resolves the observation question this section deliberately left to it — under the contract, live and snapshot iteration are observationally identical, so native `for...of` emission is licensed (§8.2 there).
- **The instance.** FFI Part 2 §8 provides `Iterable<Array(a)>` under exactly the obligated shape; the row appears in §4 here. Suite membership is decided: `Array(a)` joins the finite-collection conversion suite (§8.3 there; doctrine §1 here).
- **The conversion surface.** FFI Part 2 §9 fixes the four names — `Array.toSeq` / `Array.fromSeq` / `Array.toVector` / `Vector.toArray` — with their laziness/freshness and shallow-element semantics.

The resolution algorithm (§3), the recipe (§8), and the domestic emission rules (§9) were designed to be, and are, unaffected by the discharge.

---

## 7. User instances: the table opens

### 7.1 What a user writes

Exactly the Part 2 §5.3 form — nothing loop-specific:

```
honor<a> Iterable<Bag(a)> =
  type Item = a
  iterate(bag) = toSeq(bag)
```

Exactly-once member binding, the (constraint, constructor) coherence slot, and the orphan rule (home of `Iterable` — the prelude — or home of `Bag`) all apply unchanged (Part 2 §5.3–§5.4, Modules §7.2). Writing the instance adds the row; §3's resolution needs nothing else. The instance is legal on `record` and `union` types alike, `opaque` or not — opacity hides structure, not capabilities (Modules §4.2).

### 7.2 Globality and discoverability

Instances are global over the import graph (Modules §7.1). For the home-module instance the graph does the work by construction: **no `Bag` value can exist in a program whose graph excludes `bag.hex`**, so wherever a `Bag` flows, its instance is already present — including into modules that never name `Bag` (values carried by inference). The effect-import pattern (Modules §3.4) is therefore *not needed* for `Iterable` on your own collection and is deliberately not taught in the recipe (Modules §7.6: nearly vestigial in v1). What the user needs when something goes wrong is §3.3's diagnostic, which hands them the orphan rule's search space of size two.

### 7.3 Collisions with provided instances

Provided rows occupy ordinary coherence slots (Part 2 §4.4). A user `honor Iterable<Vector(a)>` fails the **orphan rule** first — the user's file declares neither `Iterable` nor `Vector` — and when the head constructor is a provided row, the orphan error appends the useful fact: *"the prelude already provides `Iterable<Vector(a)>`."* (A duplicate-instance error proper is unreachable for prelude pairs from user code: satisfying the orphan rule would require editing the prelude.) User-vs-user duplicates follow Modules §7.3 unchanged: same module at the second declaration, cross-module at whole-program check naming both sites.

---

## 8. The recipe and the worked example: `Bag(a)`

### 8.1 The recipe (Part 1 §6.5, now normative)

A third-party collection in v1 is complete with:

1. **`toSeq` / `fromSeq`** as ordinary exported functions (the finite-collection conversion suite, §1);
2. **one `honor Iterable` instance** delegating to `toSeq` — this is `for..in`;
3. element constraints (e.g. `<a: Hash>`) in its own signatures **only where an operation genuinely consults them**.

The whole tax is one small instance. Anything more (combinators, instances like `Eq`) is ordinary library surface, not iteration machinery.

### 8.2 The example

```
-- bag.hex — a multiset: an opaque record over Map(a, Int) counts
export opaque record Bag(a) = {counts: Map(a, Int)}

export fun fromSeq<a: Hash>(items: Seq(a)): Bag(a) = ...
export fun add<a: Hash>(bag: Bag(a), x: a): Bag(a) = ...
export fun count<a: Hash>(bag: Bag(a), x: a): Int = ...   -- 0 when absent
export fun size(bag: Bag(a)): Int = ...                    -- total multiplicity
export fun toSeq<a>(bag: Bag(a)): Seq(a) = ...
  -- each element repeated `count` times, elements grouped; see order note below

honor<a> Iterable<Bag(a)> =
  type Item = a
  iterate(bag) = toSeq(bag)
```

```
-- consumer.hex
import * as Bag from "./bag"

let bag = Bag.fromSeq(Vector.toSeq([1, 2, 2, 3]))
var total = 0
for x in bag                 -- Item = Int; resolution: head constructor Bag → the instance
  total := total + x         -- 8

-- The generic form remains unwritable in v1, exactly as designed:
fun sum<c: Iterable>(xs: c): Int = ...
  -- ERROR: `Iterable` declares an associated type and cannot constrain a
  --        type variable; take a `Seq(a)` parameter instead   (Part 2 §7.2/§9)

-- The idiom:
fun sum(xs: Seq(Int)): Int = ...
sum(Bag.toSeq(bag))          -- 8
```

What the example fixes, normatively:

- **Constraint placement is honest:** `fromSeq`/`add`/`count` need `<a: Hash>` (they consult the backing `Map`'s keys); `toSeq`, `size`, and the `Iterable` instance need **nothing** — iteration never hashes. A user whose element type lacks `Hash` can still iterate a `Bag` handed to them; they simply cannot build one.
- **The instance lives in the type's home module** (`bag.hex`) — the ordinary orphan-legal choice, and the one §3.3's diagnostic points at.
- **Opacity and instances compose:** `Bag` is `export opaque`; consumers cannot see `counts`, but `for x in bag` works, because the instance was declared where nothing is hidden.
- **The order contract is inherited and must be stated:** `Bag.toSeq`'s cross-element order is its backing `Map`'s iteration order — deterministic for a value within one execution, unspecified, unstable across runs (Part 4 §7.1). A user collection's docs inherit the obligation to say so; this one just did.

---

## 9. Emission — forced consequences

### 9.1 No dictionaries at loop sites — a consequence, not a choice

The binder ban (Part 2 §7.2) makes every `for..in` site monomorphic in the iterable's outer constructor, so the compiler always knows the concrete instance statically. There is no program in which a runtime instance lookup *could* occur at a loop; dictionary-free emission is total. (Dictionaries can still appear where any constraint's do — inside genuinely polymorphic functions — but never introduced by iteration, which no binder can carry.)

### 9.2 The emission table

Loops §8 is restated **by reference and unchanged** — in particular the counting-loop erasure for syntactic ranges remains **mandatory**, and nothing in the general story below weakens it. What this document adds:

| Case | Emission |
|---|---|
| Syntactic range head (`1..n`, `range(...)`, `rangeDown(...)`) | native counting loop — Loops §8, mandatory, unchanged |
| `Vector` / `Map` / `Set` / `Seq` | `for (const x of e)` — every emitted value is a JS iterable (Loops §6.5, Part 3, Part 4 §11) |
| `Map` with tuple head | `for (const [k, v] of m.entries())`-shaped (Part 4 §11) |
| `String` | `for (const c of s)` — native JS string iteration is codepoint-wise, which is exactly §5.1's semantics; zero helpers (strings are immutable, so no observation question arises) |
| `Range` value through a variable | general path over the materialised range object (Loops §8, unchanged) |
| **User instance** | statically resolved `iterate` call: `const s = Bag_toSeq(bag); for (const x of s)`-shaped — a fresh name for the once-evaluated source (Loops §2.3), then the general path over the emitted `Seq` |

(`Array(a)`, `JsMap`, and `JsSet` emission is owned by FFI Parts 2 and 10, which license native iteration under their borrow contracts — §6.)

The user-instance call is the ordinary emitted module function (here `Bag_toSeq` via the instance's `iterate` body), never dictionary access. Where the instance's `iterate` is a trivial delegation, the emitter may inline through it; observable behaviour per Loops §2.3 either way.

### 9.3 Laziness and `.d.ts`

- `for x in s` over a `Seq` pulls elements **on demand** (the functional cursor, Loops §6.2/§6.5); an infinite `Seq` loops forever, computing each element only as reached — exit is via `throw` or process end, per the `while true` stance (Loops §4).
- **No `Iterable`, `Item`, or `Iterable`-instance machinery appears in `.d.ts`.** The constraint cannot leak by construction (no binder can carry it — Part 2 §8), instances are never exports (Modules §11.5), and the v1 reference ban keeps `Item` out of every signature. **The foreign representation of *other* constraints on exported polymorphic functions (e.g. `Bag.fromSeq`'s `<a: Hash>`) is owned by the FFI spec** — see the bounded exported-dictionaries direction (`spec/notes/ffi-exported-dictionaries.md`); this document asserts nothing about it. (`Seq(a)` itself faces as `Iterable<a>` — Loops §6.5 — which is a statement about `Seq`, not about the constraint.)

---

## 10. The collections / stdlib-listing boundary — decided

The roadmap's leaning is fixed as the rule:

- **The collections specs (Parts 1–5) own:** the types and names; representation references and complexity contracts; construction (literals, `fromVector`, `from*` eagerness); the core access surface (the accessor pair, `at`, slicing); the update doctrine (upsert, forgiving removal, representative retention); set algebra; the provided instances (`Eq`/`Ord`/`Show`/`Hash`/`Concat`/`Iterable`); the conversion suite (`toSeq`/`fromSeq` on every finite collection, §1); patterns; operator boundaries.
- **The stdlib listing owns:** the combinator families over every collection and `Seq`, plus `String.join`-style conveniences — **and the v1 ship-list vs deferred split within them** — inventoried in `stdlib-roadmap.md` and decided at the listing session under the Part 1 §3 naming doctrine, which binds there in full (banned families, subject-first, `Option`-shaped totality).

The test for future placement: *does it define what the structure is, or what you can do over it?* Structure here; doing there.

---

## 11. Transients — runtime-internal only (decided)

The runtime **may** batch internal construction and bulk operations with transient (`withMutations`-style) mutation — `fromSeq`/`fromEntries`/`fromVector`, set algebra, `String.fromSeq` — behind the persistent API. **No public transient API ships in v1**: no `withMutations`, no transient handle types, no scoped-mutation blocks.

Rationale: a public transient is an observable mutable collection value, in a language whose entire mutation story is `var` confinement inside function bodies (Statements §6) — it would be the one value-shaped mutable thing in the language, with an aliasing story (escape, capture, double-commit) that v1 has no machinery to police. The public need transients serve elsewhere is bulk-construction speed, which the runtime achieves internally with zero surface (the Immutable.js precedent: its own `withMutations` is how its constructors are fast; users of *Hexagon's* constructors get that for free). Revisit in v2 only on benchmark evidence from real Hexagon code that **userland** batching — not stdlib-internal construction — is a measured bottleneck; the honest v2 shapes would be syntactic and scoped, not a mutable handle.

This resolves Part 4 §13.4. Rejected alternative recorded at §13.4 below.

---

## 12. Diagnostics checklist

New rows first; inherited rows by reference (unchanged, listed for the consolidated picture).

| Situation | Error / hint | § |
|---|---|---|
| `for x in xs`, `xs` an unsolved metavariable | "cannot determine what `xs` iterates over; add a type annotation" | §3.2 (Loops §7.1, unchanged) |
| `for x in xs`, `xs : c` a rigid binder variable | "`xs` has the generic type `c`, and `Iterable` cannot constrain a type variable in v1; take a `Seq(a)` parameter instead" | **§3.2 (new split)** |
| Non-iterable concrete type, not user-nominal | "`Int` is not iterable" (+ conversion hint where one exists) | §3.2 |
| Non-iterable user nominal type | two-legal-homes form: the type's home file with the `honor` fixit, the prelude as the only other legal home, and the `toSeq`/`Seq(a)` alternatives | **§3.3 (new)** |
| `honor` of a provided-row head outside the prelude | orphan-rule error + "the prelude already provides `Iterable<Vector(a)>`" | **§7.3 (new hint)** |
| Projection-bearing constraint on a binder | Part 2 §9 row, unchanged | Part 2 §7.2 |
| `Item` in a type expression | Part 2 §9 row, unchanged | Part 2 §7.3 |
| Missing / extra / duplicate `type Item` binding in `honor` | Part 2 §9 rows, unchanged | Part 2 §5.3 |
| Refutable loop-head pattern | the uniform irrefutability-gate error | Pattern Matching §5; Part 4 §9 |
| Assignment to a loop binder | "`x` is a loop variable and cannot be assigned; declare a `var`" | Loops §2.1 |
| Non-`Unit` final expression in a loop body | discard error, loop provenance | Loops §2.2 |
| User-vs-user duplicate instance | Modules §7.3 phrasing, modulo the honor-era noun: **"duplicate instance of `Iterable<Bag>`"** | §7.3 |

`String.fromSeq` produces no new diagnostics (total; divergence on infinite input is documented, not diagnosed).

---

## 13. Rejected alternatives (do not re-litigate)

### 13.1 `String.codepoints` as a synonym for `String.toSeq`

Loops §11.6's interim name. Rejected: the conversion suite exists so conversion names never need looking up; a domain synonym for the *most mechanical* member of the suite would undercut the suite's one virtue at its first extension. (Contrast Part 4 §3.4's `entries`/`toSeq` synonym pair, which earns its keep because `entries` is entrenched domain vocabulary with `keys`/`values` siblings; "codepoints" has no such family.) The word "codepoint" lives in the docs, not the API.

### 13.2 `String.toSeq` without `String.fromSeq`

Keeps the suite honest on collections proper and documents `String` as a partial participant. Rejected: within its domain — finite collections (§1) — the suite invariant is only mechanical if it has no asterisks, and the missing direction has an obvious, total, law-abiding meaning (concatenation). The cost of shipping it is one line; the cost of the asterisk is permanent.

### 13.3 Strict codepoints-only `String.fromSeq`

Requiring every element to be one codepoint and throwing otherwise — the exact inverse of `toSeq`. Rejected: it adds a runtime scan and a brand-new failure mode with no customer; it is out of character with the forgiving `from*` family (every other `fromSeq` accepts any `Seq` of the right element type); and the round-trip law holds under concatenation anyway.

### 13.4 Public transients (`withMutations`, transient handles)

Rejected per §11: an observable mutable collection value contradicts the `var`-confinement mutation story and imports an aliasing discipline v1 cannot police. Internal batching captures the performance without the surface. Revisit-bar: v2, on benchmarks of userland (not stdlib-internal) bulk mutation from real Hexagon code.

### 13.5 Declaring the normative `Iterable<Array(a)>` row in this document

The draft of this spec did exactly that, with native `for..of` emission mandated and observation semantics left open. Rejected on review (correction record §18.1): the two positions cannot coexist — native JS array iteration has JavaScript's mutation-observation behaviour and cannot implement snapshot semantics if the FFI spec were to choose them; a normative row whose meaning is undefined is not a decision. The direction (Array is iterable) was kept as a binding obligation on FFI (§6.1); the meaning lives where it can be defined coherently, and now is defined there (FFI Part 2 §§6.5, 8).

### 13.6 Teaching the effect-import pattern in the recipe

Rejected per §7.2: for a home-module instance the pattern is structurally unnecessary (no value of the type can exist without its module in the graph), and the Modules §13(i) annotation exists precisely to keep it from reading as daily idiom. The recipe teaches that the graph does the work; the diagnostic (§3.3) covers the failure path.

---

## 14. Hanging questions (owned elsewhere; recorded, non-blocking)

1. *(discharged)* **The `Array(a)` package** — decided in full by **FFI Part 2** (§§6, 8–9): borrow contract, `Iterable<Array(a)>`, live≡snapshot observation, native-iteration emission, the four conversion names, suite membership, `.d.ts` face, shallow element treatment. See §6.
2. **`String.join(sep, xs)`** and other string conveniences → stdlib listing (§5.3).
3. **Public `Range.toSeq`** → stdlib listing, candidate at most (§1, §4).
4. **The v2 associated-types remainder** — deferred `Item(α)` goals, `Item(c)` reference syntax, obligations on type members, `Iterable` binders, `derive via`, `Hash` on user collection types → unchanged, per Part 2 §11 / Part 1 §6.3; nothing here moves it.
5. **`AsyncSeq` and asynchronous iteration** → the async spec (Loops §11.4, unchanged; it does not depend on anything here).

---

## 15. Decisions log

| # | Decision | § |
|---|---|---|
| 1 | Iterable(τ)=ε defined as global-instance lookup on τ's outer constructor; the Loops table is the instance table, operationally | §2.2 |
| 2 | `iterate` is an ordinary prelude term; Loops §2.3's desugaring names the member; qualified home owed to the stdlib listing (`Iterable.iterate` presumed) | §2.3 |
| 3 | Normative 8-step algorithm for `for p in e`; pattern heads per Pattern Matching's five positions, irrefutability-gated; body `Unit`; source evaluated once | §3.1 |
| 4 | **Unsolved-vs-rigid diagnostic split**: metavariable → annotate; rigid binder variable → `Seq(a)` parameter hint | §3.2 |
| 5 | User-nominal not-iterable error names **both legal homes** (the Modules §7.6 discoverability obligation's loop-side face), leading with the actionable one | §3.3 |
| 6 | The v1 core provided table is exactly six rows: `Range`, `Vector`, `Seq`, `Map`, `Set`, `String`; plus the FFI-owned borrowed views `Array(a)` (obligated §6.1, discharged FFI Part 2 §8), `JsMap(k, v)`, `JsSet(a)` (FFI Part 10 §6); nothing else iterable in v1 | §4, §6 |
| 7 | **`Iterable<String>`: `Item = String`, one codepoint per item** — Loops §11.6 closed; graphemes stay named-function territory | §5.1 |
| 8 | `String.toSeq` lazy codepoint view; **no `codepoints` synonym** | §5.2, §13.1 |
| 9 | **`String.fromSeq` ships: concatenation**, full contract — `""` on empty, traversal order, any-length elements, no normalization, eager, linear with join-not-fold implementation note, one-sided round-trip law | §5.3 |
| 10 | **Conversion-suite domain fixed: finite collection types.** `String` joins; `Range` exempt (not a collection); `Seq` is the currency itself; `Array` membership → FFI; third parties via the recipe | §1, §5.3 |
| 11 | **`Iterable<Array(a)>` decided as a binding v1 FFI obligation** (`Item = a`, `iterate = Array.toSeq`); row meaning, conversions, observation semantics, and emission owned by FFI — discharged in full by FFI Part 2 | §6, §13.5 |
| 12 | Provided-row `honor` collisions surface as orphan errors + "the prelude already provides…" hint; duplicate-proper unreachable for prelude pairs from user code | §7.3 |
| 13 | Recipe normative (`toSeq`/`fromSeq` + one delegating instance + honest constraint placement); effect-import pattern deliberately untaught; user collections inherit and must state their order contract | §8 |
| 14 | **Emission: static instance resolution is total** (consequence of the binder ban); Loops §8 erasure mandatory and untouched; `String` emits native `for..of`; no `Iterable`/`Item`/instance machinery in `.d.ts` — other constraints' foreign representation deferred to FFI | §9 |
| 15 | Collections/stdlib boundary fixed: structure in Parts 1–5, combinator families (and their v1 ship-list) in the stdlib listing under the Part 1 §3 doctrine | §10 |
| 16 | **Transients runtime-internal only; no public API in v1**; v2 revisit-bar = userland benchmarks | §11 |

---

## 16. Edit notes to companion specs, and closeout

### 16.1 Edit notes (live)

The roadmap and agenda edits queued at landing were applied then; the companion-spec edits to Loops/Ranges/Iteration and Collections Parts 1, 2, and 4 have since been applied in their owners (verified at consolidation) and their rows removed. Two remain live, on the house apply-on-next-touch convention:

| Doc | Edit | When |
|---|---|---|
| **primitive-types.md** | §5.1: note String iteration decided — `for c in s`, one-codepoint items, O(n) single pass (pointer §5 here). | on next touch |
| **hexagon-for-typescript-coders.md** | `for..in` chapter — Hexagon's `for..in` is JS's `for..of` done right (Loops §1 doctrine); tuple heads over `Map`; String loops are codepoint-correct (unlike naive JS index loops); "write your own collection" sidebar = §8's recipe; the generic-`Iterable` rejection with the `Seq(a)` idiom. | on next touch |

### 16.2 Closeout confirmations

- **Part 1 §6.4's amendments are reflected**: Decisions Batch 2026-07 §6 stands as amended (the restricted form is v1; the full feature v2); Loops §11.1 was re-scoped by Part 2 §14; the main roadmap's Tier-3 associated-types entry carries the re-scope and the `derive via` pointer.
- **The Part 2 §14 `Elem` → `Item` rename ripple**: this document and Part 1 use `Item` throughout; the residual historical `Elem` spellings in Decisions Batch 2026-07 ride the consolidation supersede pass, not an edit note here.
- With Part 5 filed, the Collections effort's outstanding export is the stdlib listing's inherited items (§10, ledgered in `stdlib-roadmap.md`); the FFI inheritance (§14.1, Part 4 §10.4) has been discharged by FFI Parts 2 and 10.

---

## 17. Acceptance tests (golden: inferred type, runtime value, emitted JS, diagnostics)

```
-- (a) Every provided row loops, with the right element type
for i in 1..3            -- i : Int      (counting-loop emission, mandatory)
  ...
for x in [10, 20]        -- x : Int      (Vector)
  ...
for c in "héllo"         -- c : String   (one codepoint; emits for (const c of s))
  ...
for x in Set.fromVector([1, 2])   -- x : Int
  ...

-- (b) Map: tuple head; vector-pattern head still gated
for (k, v) in m          -- irrefutable tuple head; emits for (const [k, v] of ...)
  ...
for [k, v] in m          -- ERROR: this pattern can fail; use match (Part 4 §9)
  ...

-- (c) String conversion suite (contract per §5.3)
String.toSeq("ab")                          -- Seq(String): "a", "b"
String.fromSeq(String.toSeq(s)) == s        -- true, for every s (one-sided round trip)
String.fromSeq(Vector.toSeq(["ab", "", "c"]))  -- "abc" (any-length elements; concat)
String.fromSeq(Seq.empty)                   -- ""
-- No golden test asserts chunk-boundary preservation through toSeq ∘ fromSeq.

-- (d) The Bag example end-to-end (per §8.2)
let bag = Bag.fromSeq(Vector.toSeq([1, 2, 2, 3]))   -- fromSeq needs Hash<Int>: provided
var total = 0
for x in bag                                -- iteration needs no Hash
  total := total + x                        -- total = 8
-- emits: const s = Bag_toSeq(bag); for (const x of s) { total = total + x; }

-- (e) Rigid vs unsolved: two different errors
fun f<c>(xs: c) =
  for x in xs                               -- ERROR: `xs` has the generic type `c`, and
    ...                                     --   Iterable cannot constrain a type variable
                                            --   in v1; take a Seq(a) parameter instead
fun g() =
  let xs = deserialize(input)               -- suppose xs : α, unsolved
  for x in xs                               -- ERROR: cannot determine what `xs` iterates
    ...                                     --   over; add a type annotation

-- (f) Non-iterable: plain vs user-nominal (two legal homes)
for x in 42                                 -- ERROR: `Int` is not iterable
  ...
for x in widget                             -- widget : Widget, user record, no instance
  ...                                       -- ERROR: `Widget` is not iterable. Define
                                            --   honor Iterable<Widget> in ./widget.hex,
                                            --   which declares Widget. The only other
                                            --   legal home is the prelude module
                                            --   declaring Iterable. Alternatively,
                                            --   convert or take a Seq(a) parameter.

-- (g) Provided-row collision: orphan error with the prelude hint
honor<a> Iterable<Vector(a)> =              -- in user code
  type Item = a
  iterate(xs) = Vector.toSeq(xs)
-- ERROR: orphan instance — this module declares neither `Iterable` nor `Vector`;
--        the prelude already provides Iterable<Vector(a)>

-- (h) User-vs-user duplicate (same module)
honor<a> Iterable<Bag(a)> = ...             -- second declaration in bag.hex
-- ERROR at the second declaration: duplicate instance of Iterable<Bag>

-- (i) Once-evaluation of the source
for x in expensive()                        -- expensive() called exactly once
  ...
-- emits: const s = expensive_result_path; for (const x of s) { ... }

-- (j) Infinite Seq: lazy pull, no divergence before the loop
-- nats: an infinite Seq of 1, 2, 3, ... (producer illustrative — any infinite
-- Seq specimen serves; the combinator surface is the stdlib listing's)
for n in nats
  if n > 3 then throw(Done()) else consume(n)   -- consume : Int -> Unit
-- pulls 1, 2, 3, 4; consumes 1, 2, 3; throws on 4; each element computed on
-- demand; nothing materialized

-- (k) var mutation in loop bodies keeps working (blocks, not lambdas)
var acc = ""
for c in "abc"
  acc := acc ++ c                           -- acc = "abc"

-- (l) No Iterable machinery in .d.ts
-- bag.hex's emitted bag.d.ts contains no Iterable, no Item, no Iterable-instance
-- object — nothing iteration-shaped. (The .d.ts representation of the Hash
-- constraint on fromSeq/add/count is the FFI spec's business and is asserted
-- neither way here.)
```

---

## 18. Correction records (incorporated)

Two pre-landing review corrections were applied in place; this anchor records that they are incorporated. The same review's smaller tightenings — the conversion-suite domain (§1, §5.3, §13.2), the completed two-legal-homes diagnostic (§3.3), the full `String.fromSeq` contract (§5.3), acceptance-test repairs (§17) — are simply part of the normative text above.

### 18.1 `Array(a)` iteration: normative ownership transferred to FFI

The draft declared the `Iterable<Array(a)>` row normatively here while leaving its observation semantics to FFI; the positions cannot coexist (native iteration fixes observation behaviour). Corrected: the row became a binding FFI obligation (§6), since discharged by FFI Part 2. Rejected alternative, do not relitigate: §13.5.

### 18.2 The `.d.ts` claim narrowed to `Iterable` machinery

§9.3 originally claimed no constraint machinery of any kind appears in `.d.ts`; the foreign representation of *other* constraints on exported polymorphic functions is the FFI spec's (bounded exported-dictionaries direction, `spec/notes/ffi-exported-dictionaries.md`). Corrected in §9.3 and test (l). Do not restate the unconditional non-leakage slogan in any collections document — its scope is monomorphic exports plus this constraint's by-construction guarantee.
