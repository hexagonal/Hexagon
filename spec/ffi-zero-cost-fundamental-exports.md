# Hexagon Spec: Zero-Cost Fundamental Exports

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing — see **correction records §17**. Normative promotion of `spec/notes/ffi-zero-cost-primitive-exports.md`. This is a **component FFI spec**: it fixes the JavaScript/TypeScript export surface of constrained-polymorphic Hexagon functions — and only that. It is **not** the general FFI spec and does not begin it; extern syntax, boundary type mapping, and the rest of the FFI agenda remain owed to the FFI consolidation session.
**Scope:** The closed fundamental type set and its pre-v1 review obligation; the normative specialization-set algorithm (which named dictionary-free entry points exist) including the full lawful Cartesian product for multiple constrained variables; the generic base-name edition and its public-evidence trigger; the deterministic naming algorithm, base-name reservation, and hard collision errors; the required-emission contract separated from optimizer freedom; `.d.ts` faces for specializations (lowercase Hexagon-originated binders); ABI events; diagnostics; acceptance tests including the code-size acceptance obligation.
**Not in scope:** **Everything about dictionaries themselves** — evidence shapes, `Constraint.Dictionary<a>` declarations, handle ownership and names (`Num.int`, `Rat.num`), parameterized factories (`Vector.show(...)`), trailing-evidence ordering, superconstraint nesting, branding, validation, and cross-package dictionary ABI — is owned normatively by FFI Part 9 (`ffi-part9-exported-dictionaries.md`); this document consumes those rules by reference and redesigns nothing. Also not in scope: extern declaration syntax; `Array(a)`/`Map`/`Set` boundary packages; `JsValue`; the internal (Hexagon-side) dictionary-passing scheme (Constraints §6, refined in direction by Part 9).
**Companions:** FFI Part 9 (`ffi-part9-exported-dictionaries.md`; dictionary ABI consumed); `spec/notes/ffi-exported-dictionaries.md` (historical decision source); `spec/notes/ffi-proto-spec-questions.md` §8; Constraints §4–§6 (lawfulness, coherence, dictionary compilation); Functions §4/§8 (typed forms, generalization); Primitive Types §1 (fundamental JS representations); Numeric Literals §5 (`fromInt` erasure); Decisions Batch 2026-07 §1.5 (`Eq<Float>` emission); Modules §4/§11 (export prefix, ESM emission).

Written for a future implementation session against the existing `hexc` architecture: Algorithm J, union-find tyvars, dictionary passing, whole-program compilation, readable-JS emission with `.d.ts`, `@hexagon/runtime`.

---

## 1. Doctrine

Hexagon's zero-cost concrete-type rule extends through the JavaScript boundary:

> **An exported constrained-polymorphic function generates direct monomorphic entry points for every lawful fundamental-type specialization. These entry points take no dictionaries and contain concrete emitted operations. A generic trailing-dictionary edition is added only when the compiled public instance graph contains a complete publicly obtainable evidence assignment with at least one non-fundamental component (§4.1).**

The resulting hybrid surface:

```text
fundamental concrete types   -> named direct specializations
public non-fundamental types -> base-name generic dictionary edition
private/internal types       -> no effect on the JS export surface
```

- **Bounded code growth is deliberately accepted** in exchange for direct primitive entry points (§10 carries the measurement obligation). The design is analogous in purpose — not mechanism — to runtimes that specialize generic code for value types: JavaScript lacks the required generic runtime facility, so Hexagon exposes the specializations as named ESM functions.
- **Public capability, never internal call sites** (§5): whole-program typing determines internal specializations, but private implementation choices never reshape the foreign API.
- **The base name belongs to the generic edition** (§7): specializations are suffixed; user types never multiply named exports — they share the one dictionary edition.
- **Hexagon `export` promises Hexagon visibility; the foreign typed surface is this spec's.** `export` is the language's only cross-module visibility mechanism (Modules §1) and its contract is to Hexagon consumers. Presence on the JavaScript/TypeScript surface is *defined by this document's algorithms* and may lawfully be empty (§3.4) — a **stated exception** to the export-correspondence reading of Modules §11.1, not an accident of the algorithms.

---

## 2. The fundamental type set

### 2.1 The closed set

```text
Int   Float   BigInt   Bool   String   Unit
```

**"Fundamental" is a language category, not an inference from runtime size, representation, or current engine performance.** `Date`, `Array(a)`, `Nullable(a)`, the runtime collections (`Vector`, `Map`, `Set`, `Seq`, `Range`), records, unions, and user types do not enter the set merely because their JS representation is small or native (rejected alternative §11.1).

### 2.2 Pre-v1 review obligation

Before v1 freezes, perform **one explicit inventory review** of commonly used JavaScript primitive-like values. The review may add a type only by a language-design decision recorded in this document; it must not replace the closed set with a representation heuristic. (Revisit bar, §12.1.)

### 2.3 `.d.ts` faces of the fundamentals

Per Primitive Types §1 / Type System Overview §4, for use in §8's generated signatures:

| Fundamental | Parameter face | Return face |
|---|---|---|
| `Int` | `number` | `number` |
| `Float` | `number` | `number` |
| `BigInt` | `bigint` | `bigint` |
| `Bool` | `boolean` | `boolean` |
| `String` | `string` | `string` |
| `Unit` | `undefined` | `void` |

`Int` and `Float` specializations of one function may therefore carry identical TypeScript signatures (`plusInt`/`plusFloat`, both over `number`). This is deliberate: the names carry the semantic distinction the erased types cannot.

---

## 3. The specialization set: Algorithm S (normative)

### 3.1 Eligible declarations

Algorithm S applies to every **exported function declaration whose generalized scheme carries at least one constrained type variable** (`export let f<...> = ...` / `export fun f<...>(...) = ...`, Functions §4/§8). Exported monomorphic functions, unexported functions, and non-function exports are untouched by this spec. (Constrained non-function exported *values*, should the generalization rules ever admit one, are not covered here and are recorded for the FFI consolidation — §13.3.)

### 3.2 The algorithm

For an eligible export `f` with type variables `v1 … vn` **in declared order**, where `C(vi)` is the (possibly empty) set of constraints attached to `vi`:

1. **Partition** the variables: `vi` is *specializing* iff `C(vi)` is non-empty. Unconstrained variables never specialize (§3.3).
2. **Candidates per specializing variable:**
   `candidates(vi) = { F ∈ FundamentalSet | every K ∈ C(vi) has a lawful instance K<F> }`.
   Lawfulness is the ordinary Constraints §4/§5 judgment over the compiler/runtime-provided fundamental instances — e.g. `Num → {Int, Float, BigInt}`; `Show`/`Eq` → whichever members of the closed set carry those instances per the prelude. No new instance judgment is introduced.
3. **Lawful tuples:** the full Cartesian product of `candidates(vi)` over the specializing variables, in declared order. If any `candidates(vi)` is empty, the product is empty (§3.4). **A tuple is generated only when every chosen fundamental type satisfies all constraints attached to its corresponding variable** — there is no partial tuple and no cross-variable constraint (Hexagon constraints attach to single binders).
4. **Emit one specialization per lawful tuple** `t = (F1, …, Fk)`:
   - **name:** per Algorithm N (§6);
   - **signature:** `f`'s scheme with each specializing `vi` substituted by its `Fi`; unconstrained variables remain generic binders (§3.3); faces per §2.3;
   - **body:** the direct monomorphic elaboration of `f`'s body at `t`, under the required-emission contract (§8).
5. **Check names** for collisions (§6.2); any collision is a hard compile error.

**No arbitrary combination cap exists.** The implementation must **measure** emitted code and `.d.ts` size (§10); a future threshold, opt-in, or alternative grouping requires field evidence and an explicit design decision — it is never silently introduced by an optimizer (rejected alternative §11.5).

**Specializations are unconditional** for an eligible export: they are generated whether or not any Hexagon source calls `f` at those types. A JS consumer may import `plusFloat` even when no Hexagon code calls `plus` at `Float` (§5).

### 3.3 Unconstrained type variables *(normative clarification — see §13.1)*

An unconstrained variable needs no evidence and therefore gains nothing from specialization; it stays a lowercase generic binder in every generated signature and contributes **no suffix element** to the name:

```hexagon
export let tag<a: Show, b>(x: a, y: b): String = ...
```

```ts
export declare function tagInt<b>(x: number, y: b): string;
export declare function tagString<b>(x: string, y: b): string;
// etc.: suffix elements come from `a` only
```

### 3.4 The zero-entry-point case: a stated exception to export correspondence *(reviewed and upgraded — see §17.2)*

If the lawful-tuple product is empty (some constrained variable has no fundamental candidates — e.g. a user constraint with no fundamental instances) **and** the §4 trigger is not met, the export contributes **no typed entry point to the foreign module surface at all**. This is **legal, not an error**, and it is doctrine, not an edge case (§1, last bullet):

- The export remains fully functional for its actual audience: **Hexagon consumers**, who import it, honor the constraint for their own types, and call it — the ordinary library pattern `export` exists to serve (Modules §1). A hard error here would forbid legitimate Hexagon-to-Hexagon code over a JS-surface concern, and has no Rewrite-Rule-compliant fixit (§11.7).
- The correspondence exception is narrower than it looks: the internal evidence-taking form may still appear in the emitted ESM as **plumbing** where cross-module dictionary access needs it (Modules §11.5) — outside `.d.ts`, unsupported. What is absent is the *typed, supported* surface.
- **Visibility obligations** (both binding): generated documentation must state that the export currently has no JavaScript entry points and what would create them (a lawful fundamental instance, or evidence completing a §4.1 assignment); and the §10 build report must **list every zero-entry-point export by name**, so an author targeting JS consumers can inspect the truth at build time rather than discovering it from a missing import.
- Pre-registered v2 relief, if field evidence shows authors surprised: an **opt-in** "must be JS-callable" export annotation that turns this exact situation into the hard error, where the author has declared the intent the compiler would otherwise have to guess (§11.7).

---

## 4. The generic base-name edition: Algorithm G (normative)

### 4.1 The trigger *(corrected — see §17.1)*

The base-name generic edition is emitted **iff** there exists at least one **complete, publicly obtainable evidence assignment** for the function's constrained variables, **at least one component of which is non-fundamental**. Precisely: an assignment of a **publicly nameable type** `Ti` to each specializing variable `vi` (a *type*, not a bare constructor — `Vector(String)` qualifies where `Vector` alone is not well-kinded) such that

1. for every `vi` and every `K ∈ C(vi)`, evidence for `K` at `Ti` is **publicly obtainable**, and
2. at least one `Ti` is non-fundamental.

*Publicly obtainable* means there is a public **evidence expression** for it: a public handle per the exported-dictionaries public-exposure rule (constraint publicly nameable; `Ti`'s constructors publicly nameable; every signature component of the handle/factory public; the lawful instance present in the compiled graph), or a public factory applied to inputs that are themselves recursively publicly obtainable — e.g. `Vector.show(Show.string)` is the obtainable evidence for `Show` at `Vector(String)`.

- **Completeness is load-bearing.** The generic function requires evidence for *every* constrained variable; if any variable's constraints have no publicly obtainable evidence at *any* public type — fundamental or not — no JavaScript caller could lawfully call the edition, and it is not emitted. For ordinary prelude-constraint functions (`plus<a: Num>`) this rule coincides exactly with "some public non-fundamental instance exists", because fundamental evidence for prelude constraints is constraint-owned and public; the completeness condition matters only for multi-variable and user-constraint cases (§17.1).
- **Private types and internal call sites never cause the edition to appear** (§5). Conversely, a qualifying public assignment causes it to appear **even if no Hexagon source instantiates `f` at those types** — JavaScript callers sit outside Hexagon call-site analysis.
- Adding the public instance that first completes a qualifying assignment adds the base-name export: an **additive ABI change** (§9). Removing the evidence that last sustains one removes it: breaking.

### 4.2 The edition's shape (by reference)

When triggered, the edition is exported under the **source base name** with the source parameters unchanged and constraint evidence as a **trailing suffix**, typed with constraint-qualified dictionary types and lowercase Hexagon-originated binders:

```ts
export declare function plus<a>(
  x: a,
  y: a,
  num: Num.Dictionary<a>,
): a;
```

Evidence ordering, dictionary type declarations, handle/factory homes, superconstraint nesting, branding, and validation are **FFI Part 9's**; this document adds no rule to any of them and defers entirely.

---

## 5. Public capability, never internal call sites (normative)

The foreign export surface of a module is a function of exactly two inputs:

1. the module's **exported declarations** (Algorithm S), and
2. the **public instance graph** of the whole program (Algorithm G).

It is **never** a function of private types, unexported declarations, or which call sites exist in Hexagon source. Consequences, each normative:

- A private type honoring the constraint does not create the generic edition.
- An internal Hexagon call to `f` at any type creates nothing foreign.
- Removing every Hexagon call to `f` removes nothing foreign.
- Fundamental specializations exist unconditionally for eligible exports (§3.2).

---

## 6. Names: Algorithm N (normative)

### 6.1 The naming rule

```text
specialization name = source export name
                    ++ fundamental type names of the specializing variables,
                       in declared type-variable order
```

- Type names are spelled exactly as the language spells them — `Int`, `Float`, `BigInt`, `Bool`, `String`, `Unit` — concatenated with no separator: `plus + Int → plusInt`; `combine + Int + String → combineIntString`.
- **Declared type-variable order, never constraint order and never parameter-occurrence order.** Alpha-renaming type variables in source cannot change any generated name (the names use *type* names and *positions*, not variable spellings) — consistent with the dictionaries note's ordinal-based ABI stance.
- Unconstrained variables contribute nothing (§3.3).
- **The source base name is reserved for the generic dictionary edition.** It is never used by a specialization, including when the edition is currently absent — reservation is what keeps the §4.1 trigger an *additive* ABI event.

### 6.2 Collisions are hard errors

A generated specialization name that collides with any explicit public export of the same module is a **hard compile error**:

```hexagon
export let plusInt(x: Int, y: Int): Int = x + y
export let plus<a: Num>(x: a, y: a): a = x + y
-- ERROR: generated specialization `plusInt` conflicts with exported `plusInt`;
--        rename one of the exports
```

Two **generated** names colliding (two eligible exports whose expansions produce the same identifier) is equally a hard error, naming both originating declarations and their type tuples *(normative clarification — see §13.1)*. **No silent mangling, numeric suffixing, or winner-by-source-order rule is permitted for ABI names** (rejected alternative §11.3). The fix is always a source rename, stated in the diagnostic.

---

## 7. Worked example (single variable)

```hexagon
export let plus<a: Num>(x: a, y: a): a = x + y
```

Always-generated fundamental entry points (candidates(`a`) under `Num` = {Int, Float, BigInt}):

```ts
export declare function plusInt(x: number, y: number): number;
export declare function plusFloat(x: number, y: number): number;
export declare function plusBigInt(x: bigint, y: bigint): bigint;
```

```js
export function plusInt(x, y) {
  return x + y;
}
export function plusFloat(x, y) {
  return x + y;
}
export function plusBigInt(x, y) {
  return x + y;
}
```

If (and only if) a public non-fundamental `Num` instance exists — public `Rat` plus public `Rat.num` — the module additionally exports the §4.2 generic edition. JavaScript sees:

```ts
plusInt(10, 20);
plusFloat(1.5, 2.5);
plusBigInt(10n, 20n);
plus(half, third, Rat.num);   // only with the public Rat evidence in the graph
```

---

## 8. Required emission versus optimizer freedom

### 8.1 Required (normative; the ABI)

1. **Every lawful specialization is a public named ESM export** appearing in the module's `.d.ts`, with the deterministic §6 name and the §2.3 faces.
2. **Direct bodies, dictionary-free.** A specialization's call path contains **no dictionary construction, passing, or member dispatch**. It is the concrete emission the existing specs already fix for that type — e.g. a `Num<Int>` body emits native `+`; an `Eq<Float>` body emits the SameValueZero form `a === b || (Number.isNaN(a) && Number.isNaN(b))` or its `$hex` helper (Decisions Batch §1.5); `fromInt` erases (Numeric Literals §5).
3. **Specializations are not wrappers over the generic edition** (rejected alternative §11.2). Calling one never touches evidence.
4. **Observable behaviour** of `fXY(args)` is exactly `f` instantiated at `(X, Y)` per the language semantics — same result, same exceptions, same evaluation order.
5. **The generic edition, when triggered, is exported under the base name** with trailing evidence per the dictionaries note; when not triggered it is absent, and the base name exports nothing.
6. **Determinism:** the export set and every name are a pure function of the module's exported declarations and the public instance graph (§5). Two compilations of the same program produce identical foreign surfaces.
7. **Source maps and generated documentation must identify** each specialization's originating Hexagon declaration and its fundamental type tuple.
8. **Semantic correctness never depends on tree shaking.** Bundlers *may* drop unused named specializations; the compiler must emit a correct module without assuming they will.

### 8.2 Optimizer freedom (non-normative; bounded by §8.1)

- **Fragment sharing:** specializations may share private implementation fragments — including one shared function re-exported under several names where bodies coincide (`plusInt`/`plusFloat`) — provided the observable emission stays direct and no dictionary dispatch is reintroduced on any shared path.
- **Inline vs helper:** per-site choice between inline expressions and on-demand `$hex` prelude helpers, per the existing emission doctrine (Decisions Batch §1.5, Unions §6.4).
- **Internal call sites are a separate question entirely.** A concrete internal call `plus(20, 22)` may emit `20 + 22`; it need not call exported `plusInt`, nor route through any export. Internal known-concrete calls emit the best direct code available; genuinely polymorphic internal functions carry trailing evidence (dictionaries note §1). Export generation and internal expression optimization never constrain each other.
- Ordering of exports in the emitted file, doc-comment placement, and `.d.ts` formatting are unconstrained.

---

## 9. ABI events

1. Fundamental specializations are public named ESM exports appearing in `.d.ts`; their names are deterministic under §6. Renaming the source export renames every specialization: **an ABI event**.
2. **Adding or removing a constraint** on an eligible export, or changing the fundamental set (§2.2 review), may add or remove specializations: **an ABI event**.
3. **Adding or removing a lawful fundamental instance for an existing constraint** may add or remove named specializations — even when neither the constraint declaration nor the fundamental set changes (`candidates(vi)` moves, §3.2): **an ABI event**.
4. **The first complete qualifying evidence assignment** (§4.1) adds the base-name generic edition: an **additive** ABI event. Removing the evidence that sustains the **last** qualifying assignment removes it: a **breaking** ABI event.
5. Constraint-*member* changes affect the dictionary ABI (owned by the dictionaries note) but need not change any specialization name.
6. The pre-v1 fundamental-set review (§2.2) is the last free moment for set changes; afterwards §2's set is frozen ABI input.

---

## 10. Code-size acceptance (binding on the implementation)

The Cartesian product is accepted **provisionally, with instrumentation as the condition**:

- The compiler must **make available, per emitted module, the emitted JS size and `.d.ts` size attributable to generated specializations** (count and bytes), so real exported APIs produce the field evidence the revisit bar (§12.2) requires. The same report must **list every zero-entry-point export** (§3.4) — the visibility half of that exception's bargain.
- **"Report" means a compiler-generated report or build metadata, produced via an instrumentation/reporting mode** — normal builds need not print byte accounting to the terminal. The obligation is that the information exists and is one flag away, not that every build is noisy.
- No threshold is enforced in v1. Any future cap, opt-in annotation, or grouping scheme enters by explicit design decision against that measured evidence — never as a silent optimizer behaviour (§3.2, §11.5).

---

## 11. Rejected alternatives (do not re-litigate)

### 11.1 Representation-heuristic fundamental set

Admitting `Date`, `Array`, `Nullable`, or "anything small/native" to the set by runtime-representation reasoning. Rejected: the set is a language category with ABI consequences; a heuristic set drifts with engines and imports permanent names from temporary performance facts. The §2.2 review admits members only by language-design decision.

### 11.2 Specializations as wrappers over the generic edition

`plusInt = (x, y) => plus(x, y, Num.int)`. Rejected: reintroduces dictionary dispatch on exactly the entry points whose reason to exist is its absence; also couples the specializations' existence to the generic edition's (which is conditional). Fragment sharing that preserves direct emission remains permitted (§8.2).

### 11.3 Silent collision handling

Mangling, numeric suffixes, or winner-by-source-order when a generated name collides. Rejected for ABI names without qualification: a silently renamed export is a silently broken consumer. Collisions are hard errors with a rename fixit (§6.2).

### 11.4 Per-user-type named-export explosion

Generating `plusRat`, `plusCustomer`, … for public user types. Rejected, permanently: user types are unbounded and the surface would grow with the ecosystem rather than the language; public user instances compose through the **one** generic dictionary edition. (This is the load-bearing half of the hybrid: the closed set bounds the named surface.)

### 11.5 Optimizer-imposed combination caps

Any implicit limit on the Cartesian product. Rejected: the export surface is ABI (§8.1.6) and must be a deterministic function of declarations and the public graph; a size-triggered cap would make the foreign API depend on codegen internals. Caps, if ever, arrive by explicit design against §10's measurements.

### 11.6 Call-site-driven export surface

Emitting specializations or the generic edition only where Hexagon source instantiates the function. Rejected: JS callers are invisible to call-site analysis; the surface would flap under private refactors, violating §5. Public capability is the only trigger.

### 11.7 Hard error on zero-entry-point exports

Rejecting `export let f<a: MyConstraint>(...)` at compile time when no foreign entry point results ("cannot expose `f` to JavaScript: …"). Considered on review (§17.2) and rejected: **`export` is the language's only cross-module visibility mechanism** (Modules §1), and its primary audience is Hexagon consumers — the error would forbid ordinary Hexagon-to-Hexagon library exports over a JS-surface concern the author may not have. It also fails the Rewrite Rule (Sol-review closure §E.2): no local, mechanical rewrite preserves the Hexagon-side intent ("remove `export`" breaks Hexagon consumers; "add a fundamental instance" may be meaningless for the constraint) — and a restriction with no rewrite is returned to design by that rule's own converse. The legitimate concern — an author targeting JS silently getting nothing — is served instead by §3.4's two visibility obligations, with the **opt-in must-be-JS-callable annotation** pre-registered as v2 relief: the hard error exactly where the intent it enforces has been declared.

### 11.8 Unconditional generic edition

Always emitting the base-name edition, even with no public usable non-fundamental evidence. Rejected: it would export a function whose required evidence arguments no JS caller can lawfully obtain — a dead, misleading entry point. Conditional emission keeps the surface honest, and the trigger is additive when the first public instance arrives (§4.1).

---

## 12. Revisit bars (recorded, binding on future sessions)

1. **Fundamental set:** one pre-v1 inventory review (§2.2), by language category, decision recorded here. After freeze, changes are §9.2 ABI events.
2. **Cartesian expansion:** revisit only with §10's measured output from real exported APIs.
3. **Naming:** revisit only on demonstrated collision frequency or unusable generated identifiers in the field.
4. **Never** make the public surface depend on private/internal call sites (§5 — a doctrine bar, not a revisit bar).
5. **Never** replace the generic dictionary edition with automatic per-user-type export explosion (§11.4).

---

## 13. Recorded clarifications and tensions (for Sol / the FFI consolidation)

### 13.1 Normative clarifications this promotion added to the note

Three gaps in the proto-note required rules to make the algorithms total; each is decided above in the only direction consistent with the note's own doctrine, and each is **flagged here for review** rather than silently interpolated:

1. **Unconstrained type variables do not specialize** and contribute no suffix element (§3.3) — forced by "dictionary-free" (they carry no evidence to erase).
2. **The zero-entry-point case is legal**, with visibility obligations, not an error (§3.4) — *reviewed: upgraded from algorithmic edge case to a stated doctrine exception to export correspondence, hard-error alternative rejected with reasons (§11.7, §17.2)*.
3. **Generated-vs-generated name collisions are hard errors** naming both origins (§6.2) — the note stated only the generated-vs-explicit case.

### 13.2 Contradictions with landed specs, recorded — not resolved here

1. **Constraints §6.4's former blanket claim** that nothing constraint-shaped appears in `.d.ts` is refined by FFI Part 9: generic editions expose evidence parameters and public instances expose handles/factories; monomorphic exports and Hexagon source remain dictionary-free. The refinement has been applied to Constraints §6.4.
2. **Modules §11.5's former plumbing-only claim** is likewise refined: public handles/factories (`Rat.num`, `Vector.show`) are stable generated exports independent of current consumption under Part 9's public-evidence closure. The refinement has been applied to Modules §11.5.
3. **Constraints §6.1's former leading-parameter convention** for internal dictionary passing is superseded by FFI Part 9's trailing maximal-evidence suffix. Constraints §6.1 now records that refinement; this document merely depends on it for §4.2.

### 13.3 Deferred edge

Exported constrained-polymorphic **non-function values**, should generalization ever produce one, are unhandled here (§3.1) and belong to the FFI consolidation.

---

## 14. Diagnostics checklist

| Situation | Error / behaviour |
|---|---|
| Generated specialization collides with an explicit public export | **hard error:** "generated specialization `plusInt` conflicts with exported `plusInt`; rename one of the exports" |
| Two generated specializations collide | **hard error** naming both originating declarations and their type tuples; fixit: rename one source export |
| Eligible export with no lawful fundamental tuple and no §4 trigger | legal — a stated exception to export correspondence (§3.4); generated documentation states the export has no JavaScript entry points and what would create them; the §10 build report lists it by name |
| Generic edition absent (no public usable non-fundamental evidence) | not an error; generated documentation points JS callers to the named fundamental specializations (dictionaries note §11.6) |
| JS caller passes evidence to a specialization / omits evidence on the generic edition | dictionaries-note territory (its §11); no rule added here |
| Non-exported constrained function | no foreign surface, no diagnostic — nothing about this spec applies |

---

## 15. Decisions log

| # | Decision | § |
|---|---|---|
| 1 | Hybrid surface doctrine: named dictionary-free fundamental specializations + conditional base-name generic edition; private/internal never affects the public surface | §1, §5 |
| 2 | **Closed fundamental set: `Int`, `Float`, `BigInt`, `Bool`, `String`, `Unit`** — a language category, never a representation heuristic | §2.1, §11.1 |
| 3 | One explicit pre-v1 fundamental-set inventory review; additions only by language-design decision | §2.2 |
| 4 | Algorithm S: per-variable fundamental candidates by ordinary lawfulness; **full lawful Cartesian product** over constrained variables; specializations unconditional for eligible exports; no combination cap | §3.2 |
| 5 | Unconstrained type variables stay generic binders; no suffix element *(clarification, flagged §13.1)* | §3.3 |
| 6 | Zero-entry-point case legal — a **stated doctrine exception to export correspondence** (`export` promises Hexagon visibility; the foreign typed surface is this spec's); documentation + build-report visibility obligations; hard-error alternative rejected; opt-in must-be-JS-callable annotation pre-registered v2 — corrected, §17.2 | §1, §3.4, §11.7 |
| 7 | Algorithm G: generic edition iff a **complete, publicly obtainable evidence assignment** exists for all constrained variables with **at least one non-fundamental component** (nameability-based, recursively obtainable); coincides with the simpler per-variable reading for prelude constraints; additive when first completed — corrected, §17.1 | §4 |
| 8 | Algorithm N: base name ++ fundamental type names in **declared type-variable order**; alpha-renaming can never change a name; **base name reserved** for the generic edition even while absent | §6.1 |
| 9 | **All generated-name collisions are hard errors**; no mangling/suffixing/source-order winners for ABI names | §6.2, §11.3 |
| 10 | Required emission: direct dictionary-free bodies (never wrappers over the generic edition), deterministic surface, semantic equivalence, source-map/doc attribution, no tree-shaking dependence | §8.1 |
| 11 | Optimizer freedom bounded: fragment sharing and inline/helper choice allowed; **internal call sites are a separate question** and never route through exports by requirement | §8.2 |
| 12 | Lowercase Hexagon-originated `.d.ts` binders (`a`, `b`, `k`, `v`) throughout generated signatures; dictionary details owned by FFI Part 9 | §4.2, Scope |
| 13 | ABI events enumerated: constraint/set changes, first-public-instance additivity, rename ripple; member changes are dictionary-ABI only | §9 |
| 14 | **Code-size acceptance:** per-module measurement of specialization JS/`.d.ts` size is a binding implementation obligation; caps only ever by explicit design against that evidence | §10, §12.2 |
| 15 | Per-user-type export explosion rejected permanently; user types share the one generic edition | §11.4 |
| 16 | Constraints §6.4 / Modules §11.5 wording contradictions recorded for the FFI consolidation, unresolved here | §13.2 |

---

## 16. Acceptance tests (golden: exported surface, `.d.ts`, emitted JS, diagnostics)

```
-- (a) Single constrained variable: unconditional specializations, direct bodies
export let plus<a: Num>(x: a, y: a): a = x + y
-- exports (no public non-fundamental Num in graph):
--   plusInt, plusFloat, plusBigInt        (and nothing under the name `plus`)
--   plusInt emits: export function plusInt(x, y) { return x + y; }
-- No dictionary object, parameter, or member access appears in any of the three.

-- (b) Required emission is the concrete semantics, per type
export let same<a: Eq>(x: a, y: a): Bool = x == y
--   sameInt emits:    x === y
--   sameFloat emits:  x === y || (Number.isNaN(x) && Number.isNaN(y))
--                     (or the __hex_floatEquals helper — Decisions Batch §1.5)
-- The two bodies differ: proof the specializations are direct emissions, not
-- one shared generic body behind two names.

-- (c) Generic edition appears exactly on public evidence (additive ABI)
-- program 1: record Rat = ... (private)  → no `plus` export, (a)'s surface only
-- program 2: export record Rat ... ; honor Num<Rat> = ... (public type, lawful instance)
--   → `plus` base-name edition appears:
--     export declare function plus<a>(x: a, y: a, num: Num.Dictionary<a>): a;
--   and plusInt/plusFloat/plusBigInt are unchanged (names, signatures, bodies).

-- (d) Internal calls never shape the surface
let internal = plus(20, 22)        -- emits: const internal = 20 + 22;
-- No Hexagon call to plus at Float exists anywhere; plusFloat is exported anyway.
-- A private type honoring Num changes nothing foreign.

-- (e) Multiple constrained variables: full lawful Cartesian product, declared order
export let combine<a: Show, b: Eq>(x: a, y: b): String = ...
-- names: combine{S}{E} for every S with Show ∈ prelude(S), E with Eq ∈ prelude(E),
-- suffix order a-then-b: combineIntInt, combineIntString, combineFloatBool,
-- combineStringBigInt, ...  Never combineStringInt for (a=Int, b=String).

-- (f) Unconstrained variables stay generic
export let tag<a: Show, b>(x: a, y: b): String = ...
--   export declare function tagInt<b>(x: number, y: b): string;
-- one suffix element only; `b` is a lowercase binder in .d.ts.

-- (g) Collision: hard error, no mangling
export let plusInt(x: Int, y: Int): Int = x + y
export let plus<a: Num>(x: a, y: a): a = x + y
-- ERROR: generated specialization `plusInt` conflicts with exported `plusInt`;
--        rename one of the exports

-- (h) Zero-entry-point case: legal, visible, and still a working Hexagon export
constraint Weighty<a> = weight(x: a): Float        -- no fundamental instances
export let heaviest<a: Weighty>(xs: Vector(a)): Option(a) = ...
-- with no public non-fundamental Weighty instance: no foreign typed entry
-- points. Not an error: another Hexagon module may `import { heaviest }`,
-- honor Weighty<Grams>, and call it — that is what `export` is for.
-- Obligations checked: generated docs state the absence and the two ways an
-- entry point would appear; the §10 build report lists `heaviest` by name.

-- (i) Determinism / ABI stability
-- Recompiling an unchanged program yields byte-identical export names and .d.ts
-- signatures for all generated entry points. Alpha-renaming `a` to `t` in source
-- changes nothing foreign.

-- (j) Attribution and measurement (harness obligations, not goldens)
-- Source maps + generated docs map each specialization to its originating
-- declaration and type tuple (§8.1.7). The build reports per-module JS and
-- .d.ts bytes attributable to specializations (§10).

-- (k) Trigger completeness: one uncallable variable blocks the edition (§17.1)
constraint Weighty<a> = weight(x: a): Float        -- no fundamental instances
export let describe<a: Show, b: Weighty>(x: a, y: b): String = ...
-- Public non-fundamental Show evidence exists (e.g. Vector.show); but with no
-- publicly obtainable Weighty evidence for ANY public type, no complete
-- assignment exists → no `describe` generic edition. (Specializations: none
-- either — candidates(b) is empty — so this export has no foreign entry
-- points, per §3.4.)
export record Grams = {n: Float}
honor Weighty<Grams> = ...                          -- public type, lawful instance
-- Now (a=Vector(...), b=Grams)-style complete assignments exist with a
-- non-fundamental component → the `describe` generic edition appears. Additive.
```

---

## 17. Correction records (July 2026, pre-landing review)

Applied **in place** above; the corrected section is marked. Recorded per house rule: defect origin, rationale, rejected alternative marked do-not-relitigate.

### 17.1 Algorithm G: the trigger requires a complete evidence assignment (§4.1 corrected)

- **Defect:** §4.1 originally triggered the generic edition when *any one* constrained variable had usable public non-fundamental evidence, asserting the other variables could never block because fundamental dictionaries are public. The assertion is false for user constraints: in `combine<a: CustomA, b: CustomB>` with public non-fundamental `CustomA` evidence but no publicly obtainable `CustomB` dictionary for **any** type (a user constraint need not have fundamental instances at all), the emitted edition would require evidence no JavaScript caller can lawfully obtain — exactly the dead, misleading entry point §11.7 rejects the unconditional edition for.
- **Origin:** over-generalizing from the prelude constraints, whose fundamental handles are constraint-owned and always public; "always dischargeable" was true of `Num`/`Eq`/`Show` and silently universalized to all constraints.
- **Correction:** the trigger is existence of at least one **complete, publicly obtainable evidence assignment for all constrained variables, with at least one non-fundamental component** (§4.1). For single-variable prelude-constraint exports this coincides exactly with the previous reading; only multi-variable and user-constraint cases change — from emitting an uncallable export to emitting nothing. Acceptance test (k) pins the case.
- **Rejected alternative (do not relitigate):** the per-variable trigger ("any one variable has public non-fundamental evidence"), and any variant that can emit a generic edition lacking a lawful complete call — both fail §11.7's own honesty standard.
- **Credit:** Sol.

### 17.2 The zero-entry-point export: upgraded from edge case to stated doctrine exception (§1, §3.4 corrected; §11.7 added)

- **Defect:** §3.4 presented "an `export` with no foreign entry point" as a legal algorithmic edge case with a documentation note. The reviewer identified what was actually at stake: it conflicts with the export-correspondence reading of Modules §11.1 (a Hexagon export corresponds to an ESM export), and a user can explicitly write `export` and silently receive no JavaScript surface — a fact the document neither elevated to doctrine nor made visible at build time.
- **Origin:** treating the case as a totality obligation of Algorithm S (make the function total, move on) rather than as a decision about what `export` *means* at the foreign boundary.
- **Correction:** the reviewer's primary recommendation — a hard compile error — was **evaluated and rejected** (§11.7): `export` is the language's only cross-module visibility mechanism and its contract runs to Hexagon consumers, for whom such an export is fully functional; the error would forbid ordinary Hexagon-to-Hexagon library code, and no Rewrite-Rule-compliant fixit exists (Sol-review closure §E.2 returns such a restriction to design). The reviewer's alternative — deliberate acceptance, **recognized as a stated exception to export correspondence** — is adopted in full: doctrine bullet added (§1: "Hexagon `export` promises Hexagon visibility; the foreign typed surface is this spec's"), the correspondence exception scoped precisely (plumbing exports per Modules §11.5 already sat outside `.d.ts`; what may be absent is the typed, supported surface), and the silent-nothing concern answered with **two binding visibility obligations** (generated-docs statement + named listing in the §10 build report) plus a pre-registered v2 opt-in must-be-JS-callable annotation that provides exactly the recommended error where the author has declared JS-facing intent.
- **Rejected alternative (do not relitigate):** the unconditional hard error on zero-entry-point exports (§11.7). Revisit only via the pre-registered opt-in annotation, on field evidence of author surprise.
- **Credit:** Sol (the finding and the exception framing); the disposition between his two offered resolutions is this document's, per the Rewrite Rule.
