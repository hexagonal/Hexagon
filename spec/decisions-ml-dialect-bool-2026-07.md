# Hexagon Spec: Decisions — The ML-Dialect Pivot and `union Bool`

**Status:** Decided (ruling on issue #147, 2026-07-29). The doctrine pivot (§1) is James's ruling, made in-session 2026-07-29 and recorded here; the Bool package (§2–§6) is Fable's spec ruling under that doctrine; §3.5's source-file ruling is James's, from the PR #148 review round; §3.6's structural-satisfaction ruling is James's, from the compiler review of the #147 ripple commit (2026-07-29), recorded by the reviewer. Authoritative until consolidated into the host specs, per README authority rule 3 — this document is added to rule 3's closure-document list in this same PR; the standing is conferred there, not claimed here.
**Scope:** The design-doctrine pivot (§1); the reclassification of `Bool` from primitive to prelude union (§2); the representation pin (§3); what the reclassification deletes (§4); rejected alternatives (§5); the edit-notes ledger (§6); implementation notes for `hexc` (§7).
**Not in scope:** Any other consequence of the pivot beyond Bool — the pivot licenses revisiting TS-author-justified rulings *on next touch* (§1.2), it does not reopen them here. FFI boundary semantics (unchanged — §3 explains why). The `Debug` constraint (still v2).
**Companions:** Unions (host of §§2–3's normative text), Primitive Types (host of the correction records), Pattern Matching (host of §4's deletions), Lexer (host of the literal-word redirect), Declarations Preamble §1.1 (Rewrite Rule), Constraints (derivation mechanism), Collections Part 2 §2.5 (`Hash`).

---

## 1. The doctrine pivot: an ML dialect with a first-class JS target

### 1.1 The ruling

> Hexagon is an **ML dialect that targets JavaScript**, in the posture of F# with Fable: the language's semantics and surface belong to the ML family; JavaScript is the compilation target it serves excellently. **"What a TS author would hand-write" is demoted from design principle to valued outcome.** Readable JS and honest `.d.ts` remain goals the emitter pursues wherever they do not constrain the language; they no longer adjudicate language-design questions.

Before this ruling, the TS-author test was cited as the *justifying* doctrine for representation and display decisions (Unions §1/§6.5, Primitive Types §7's "toString unless JS is stupid", and threaded through the FFI corpus). Those decisions mostly survive the pivot on their own merits — a string-tagged POJO is *also* the natural unboxed sum representation, and sane `toString` output is *also* just sane. What changes is the tiebreaker: where ML-family semantics and TS-native surface genuinely conflict, **the ML answer now wins by default**, and the JS-specific answer must earn its place by pointing at something JavaScript-specific (representation at a zero-cost boundary, `n`-ary parameter passing, literal emission into JS source).

### 1.2 Blast radius, contained

This ruling does **not** reopen every decision the TS-author test ever justified. The rule is:

- A standing decision whose recorded rationale rests *solely* on the TS-author test is **revisitable on next touch** of its host spec — file an issue, argue it under the new doctrine, apply on ruling. It is not void meanwhile.
- A standing decision with independent rationale (performance, interop correctness, diagnostics quality) stands unchanged; the pivot removes one of its citations, not its force.
- "Rejected alternatives (do not re-litigate)" sections remain binding. The pivot is *new information* in the sense those sections contemplate, but invoking it still requires an issue and a ruling, never a silent edit.

The first and motivating consequence is Bool (§2). No other consequence is ruled here.

---

## 2. `Bool` is a prelude union

### 2.1 The declaration

```
union Bool derives (Eq, Ord, Show, Hash) = False | True
```

`Bool` leaves the primitive set (Primitive Types §1's table drops to six primitives; correction record there) and joins `Option` and `Result` in the prelude (Unions §8). It is an ordinary all-nullary union in every semantic respect — declaration, constructors-as-values, `match`, exhaustiveness, derivation — with exactly one privilege: the representation pin (§3).

- **Constructor order is `False | True`**, Haskell's order, so derived `Ord` (constructor declaration order, Unions §7) yields `False < True` — preserving the previously ruled ordering without a bespoke instance.
- **The constraint rows are derived, not decreed.** `Eq` (same constructor), `Ord` (declaration order), `Show` (constructor name), `Hash` (Collections Part 2's union algorithm) all come from the standard derivations — and because the declaration lives in real prelude source (§3.5), they arrive through the **ordinary derivation door** (Collections Part 2 §4.3, trivially satisfied: `Eq` derived in the same header), not as compiler-provided instances. Bool's row in the per-type inventories (#137) becomes a pointer to the derivation, not a fiat list. Still no `Num`, no `Signed`, no truthiness: conditions require `Bool`, no coercion from any other type — that sentence survives verbatim.
- **Nullary constructors are values** (Unions §2.2): `True : Bool`, used bare; `True()` is the standard "value, not a function" error.

### 2.2 Literals: `True` and `False` are the constructors

There are no separate boolean literals. `True` and `False` are ordinary uppercase-start constructor names in the term namespace, module scope, prelude-imported everywhere — exactly like `None`.

**`true` and `false` remain hard keywords** (Lexer §4.1) and may never be used as names. Their only role is the redirect diagnostic, per the Rewrite Rule:

> `true` is reserved; Bool's constructors are `True` and `False` — write `True`.

Keeping them reserved is load-bearing twice over: it makes the JS-trained user's most probable spelling error a one-token fixit rather than an unbound-name puzzle, and it forecloses `let true = ...` forever, so the spelling stays available if a future edition ever wants it back.

### 2.3 `Show` flips to constructor names

`show True` is `"True"`; interpolation `"${flag}"` renders `True` or `False`. This is the standard derived union `Show` (Unions §7) and **supersedes** the lowercase JS-form ruling in Primitive Types §4/§7 (`String(x)`, `"true"`/`"false"`). Under the old doctrine the lowercase form was ruled *because* it was JS's; under §1 the constructor name is the display form, as it is for every other union. Correction records in Primitive Types §4 and §7.

**Recorded with eyes open: this is the ruling's one silent behavior change.** Every other consequence surfaces as a hard error with a fixit; `show`/interpolation output flips from `"true"` to `"True"` in previously legal programs with no diagnostic, because nothing is wrong — the display form changed. §7's conformance list must include an interpolation test asserting the new output, so the flip is at least pinned by the suite.

### 2.4 Pattern matching: constructor patterns, ordinary exhaustiveness

`True` and `False` in patterns are nullary constructor patterns (Pattern Matching §2.2), not literal patterns. A `match` covering both constructors is exhaustive by **closed-constructor union checking** (Unions §4.3), the same machinery as every union. §4 below itemizes the carve-outs this deletes.

---

## 3. The representation pin

### 3.1 The ruling

> The compiler pins `Bool`'s runtime representation to the JS `boolean`: `True` emits `true`, `False` emits `false`, and the `.d.ts` type of `Bool` is `boolean`. This is the **single exception** to the all-nullary string rule (Unions §6.2), granted to exactly one declaration: the prelude's `Bool`. *(Since #771 there is no string rule — every union is tagged objects — and the pin reads as an instance of the representation principle at the head of Unions §6: JavaScript has the concept, so the value becomes it.)* It is a *representation commitment* recorded in the specs that own representation — **not** a use of the intrinsic door (`spec/intrinsics.md`), whose doctrine links *operations*, not representations. No user declaration can request a pin; there is no annotation, no syntax, no extension point.

Precedent is OCaml exactly: `bool` is a genuine variant declared in the stdlib, and the compiler guarantees an immediate unboxed representation. The declaration owns the semantics; the representation is a compiler commitment, invisible from inside the language — no Hexagon program can distinguish `"True"`-the-string from `true`-the-boolean, because every eliminator of `Bool` (`match`, and the operator eliminators §3.4 names) is representation-blind at the source level. *(Corrected 2026-07-29, review of PR #148: an earlier draft of this sentence said "`match` is the only eliminator," which is false for `Bool` specifically — see §3.4.)*

### 3.2 Emission consequences

- `match` on `Bool` emits on the boolean itself: an `if`/ternary or `switch (b)` with `case true:`/`case false:` — emitter's judgment, same license as Unions §6.3's ternary permission.
- Derived-instance emission simplifies past the general string case: `Eq` is `===`; `Ord` needs **no declaration-index table** (the Unions §7 implementer note on declaration indices does not apply) because JS `<` on booleans is `false < true` — the pin and the declaration order agree by construction; `Hash` hashes the boolean (edit note, Collections Part 2 §2.5); `Show` emits the two-way constant lookup to `"True"`/`"False"`.
- **The representation cliff (Unions §6.2; retired for every union by #771) cannot occur**: adding a constructor to `Bool` is impossible — it is prelude source under compiler verification, and any third constructor is a compiler-integrity error, not a user-reachable state.
- Constructors referenced as values materialise per Unions §6.4 against the pinned representation: `const True = true;` at the export site. Exported signatures mentioning `Bool` continue to say `boolean` in `.d.ts`.

### 3.3 FFI: nothing moves

The boundary was `Bool ↔ boolean`, zero-cost, in both directions, before this ruling; the pin's entire purpose is that it still is. Extern declarations, callbacks, exports, `Nullable(Bool)` — all unchanged. One FFI table needed a direct edit (Part 1 §4.1's all-nullary row now names its `Bool` exemption); the rest is example spelling (§6). `Bool` also **remains in the zero-cost fundamental set** (`ffi-zero-cost-fundamental-exports.md` §2.1): that set is a language category defined by enumeration, not an inference from type classification, so reclassification does not move it — Algorithm G's fundamental/non-fundamental split is unaffected.

### 3.4 Bool is an eliminator exception, and the pin is what licenses it

*(Added 2026-07-29 in response to PR #148 review finding 1.)* Unions §1 holds "`match` is the only eliminator." `Bool` is the **single exception**, and always was in substance: the five logic operators are structural forms monomorphic on `Bool` with **mandated native emission** — `and`/`or` to `&&`/`||`, `not` to `!`, `implies` to `!a || b`, `iff` to `a === b` (Operators §4) — and `if`/`while` conditions consume a `Bool` directly (Operators §11, Loops). Every one of those emissions is legal **only because of the §3.1 pin**: against the unpinned string representation, `&&` on `"False"` would be truthy nonsense. This dependency now runs in both directions on the record — Unions §1/§8 carve the exception, and the ledger's Operators row (§6) names the license — so a future session revisiting the pin knows exactly what breaks. Note that this is also the strongest §1.1-test argument *for* the pin: the operator eliminators are the JavaScript-specific fact that earns `boolean` its place.

### 3.5 The declaration's home: privileged prelude source, not spec text

*(Added 2026-07-29; James's ruling, resolving the review-round question "is the prelude Bool declaration spec text or a `.hex` source file?")* **It is a `.hex` source file** — real, compilable prelude source on the `Seq.hex` model: the natural home is the `Bool` companion module (Method Syntax §4's `CompanionOf` substrate), compiler-verified to contain exactly `union Bool derives (Eq, Ord, Show, Hash) = False | True` in that order, the way the intrinsic door verifies its inventory.

This choice is load-bearing for instance provenance. In a source file, the `derives` clause is the **ordinary derivation door** — Collections Part 2 §4.3's rule is satisfied trivially (`Eq` derived in the same header), exactly as it would be for any user union. Nothing is smuggled: Part 2 §4.4's ban ("a future stdlib author cannot smuggle a `Hash` instance into a `.hex` source file any more than a user can") targets hand-written and spec-blessed instances, and `Bool` uses neither — even the prelude obtains `Hash` only through the door users use. `Bool` thereby becomes a demonstration of §4.4, not an exception to it. The consequence: **`Eq<Bool>`/`Ord<Bool>`/`Show<Bool>`/`Hash<Bool>` cease to be compiler/runtime-provided instances.** Part 2 §2.5's `Hash<Bool>` row changes provenance (direct edit, correction record §18 there), and the change is propagated to its two normative dependents per Part 4 §18 note 4's own procedure — edit notes against Collections Part 4 §10.1 and FFI Part 10 §4.3, ledger §6. The pin (§3.1) remains the declaration's **only** privilege, precisely as the intrinsic door is `Seq.hex`'s only privilege. *(2026-07-29: §3.6 records how the compiler **satisfies** direct requirements for these four instances — structurally, without consulting them — and why that glosses rather than retracts this paragraph's provenance sentence.)*

### 3.6 Satisfaction of the four constraints: structural at direct use sites

*(Added 2026-07-29; James's ruling on the question flagged for review in the #147 ripple commit, discharging that review's condition (b): the decision lived only in a code comment, and this section is its record.)*

> A **direct** requirement for `Eq`, `Ord`, `Show`, or `Hash` on the pinned `Bool` — one whose subject is the ground type `Bool` at the requirement site — is satisfied **structurally**: the compiler emits the derivation inline and does not consult the declared instance. The four instances remain exactly what §3.5 says they are — real, derived through the ordinary door by the `derives` clause in `Bool.hex`, and present in the emitted prelude, whose `Bool.js` exports the four dictionaries. A `Bool` reaching a *generic* constraint is unchanged: it travels as ordinary evidence, and the dictionary value built at the ground call site is the structural one.

**This glosses §3.5's "cease to be compiler-provided instances"; it does not retract or narrow it.** That sentence is a *provenance* claim in Collections Part 2 §4.4's sense: a provided instance is one whose existence and content the compiler decrees with no source form. `Bool`'s instances have a source form — the declaration's own `derives` clause — and structural satisfaction creates no instance at all: it occupies no coherence slot (Constraints §5.1) and introduces nothing a program could name. This section is a *satisfaction* claim: which evidence a direct requirement selects. Provenance: the declaration's, through the door users use. Satisfaction: computed in place. Both sentences are true, and each bounds the other.

The grounds, stated as grounds rather than assurances:

1. **The orphan rule forecloses any competing instance** (Constraints §5.3). `honor Eq<Bool> = derive` outside `Bool`'s home module is a hard error, and the alias route is closed too — `type Flag = Bool` then `honor Show<Flag>` resolves through the alias to the union and is the same orphan. The derivation of the prelude declaration is therefore the only instance that can ever exist, so "structural versus declared" is two computations of one answer, never a system with two answers.
2. **Structural and derived are not two implementations that agree; they are the same functions.** The compiler builds the declared instances' member bodies and the call-site inline evidence from the one set of derivation emitters (equals, compare, show, hash); the exported dictionary bodies in `Bool.js` and the inline dictionaries at use sites were diffed in review and are identical. There is no second implementation to drift.
3. **Nothing observable distinguishes inlining from consulting.** Dictionaries are ABI, not surface, and Constraints §6.1 already holds that **"monomorphic erasure is the norm and the point"**: at a call site where the constrained variable resolves to a concrete type, the dictionary is selected at compile time and known slots are inlined. A ground requirement on `Bool` *is* the monomorphic case; structural satisfaction is §6.1's own erasure, reached through the union derivation rather than a primitive table, with coherence (§5.1) supplying the uniqueness that makes the erasure sound.

This is the move the checker already makes for tuples, vectors, and structural records — the "automatic compiler-derived instances" of types that have no constructor name to key an instance on (Constraints §4.5, §9.3 resolved) — extended to the one nominal type whose representation the compiler owns. The difference for `Bool` is that declared instances *also* exist; grounds 1–3 are what make the coexistence coherent. §3.5's "only privilege" inventory is likewise unchanged: nothing here is granted *to the declaration* — inlining selected evidence is a liberty §6.1 gives the compiler at every monomorphic site, exercised today for the primitives' tables; the pin is merely what makes `Bool`'s inlined evidence this small.

**The warrant is §3.5's shape verification, which is now built, and it is the warrant rather than ceremony.** "Agrees by construction" holds only while the declaration says what the structural code assumes. Two things would go silently wrong against a drifted declaration: the emitter maps the constructor named `True` to `true` and *every other constructor* to `false`; and derived `Ord` emits `(l ? 1 : 0) - (r ? 1 : 0)` on the strength of the declaration order `False | True`. The checker therefore verifies the resolved declaration wherever it is in scope — every module that can name the prelude `Bool`, the declaring module included — checking that it is exactly: no type parameters; two constructors, both nullary, named `False` then `True` in that order; all four constraints derived. Anything else is a hard compiler-integrity error naming the constructor order found. Conformance proves the check fires by substituting a reversed and a three-constructor `Bool.hex` at the prelude injection path — compiling the stdlib itself being the one way to substitute a prelude module.

**Motivation, honestly stated.** A module's interface is computed before checking, and consumers *re-export* the instances their imports carry, so pruning an unused instance from an import after checking breaks not the consumer but the consumer's consumers — this was tried and reverted in the ripple commit. Under instance selection, naming `Bool` in any signature would drag four dead dictionary imports into nearly every emitted module, unprunable for that reason. Under this ruling the synthesized prelude imports omit `Bool`'s dictionaries at resolution time — the interface is honest before anyone reads it — and `fun f(a: Bool, b: Bool): Bool = a == b` emits `a === b` with no imports at all. `Bool.js` still exports the four dictionaries; nothing imports them, and their presence is the artifact-level truth of §3.5's claim that the instances are real.

> **Edit note (2026-08-04, #153 / PR #264).** The paragraph above is kept as
> written because its verified claims still hold; its *mechanism* is
> superseded. Availability no longer rides the synthesized prelude import at
> all: every module receives the visible prelude instances directly
> (`Resolved.Module.preludeInstances`), the synthesized import carries none,
> interfaces no longer transit them, and emission imports exactly the
> dictionaries a compiled body references — from the declaring module, with no
> re-export. Three clauses read differently under that: the "consumers
> *re-export* the instances their imports carry" motivation is now false for
> prelude-sourced instances (#263 Part 1, 2026-08-04, closed the last route —
> an explicit import of a prelude module now carries no instance evidence
> either, so no channel transits a prelude instance at all; carriage on
> non-prelude imports is untouched and remains load-bearing); the
> four-dead-imports scenario cannot occur for
> *any* prelude module, because an unreferenced dictionary emits nothing; and
> `Bool`'s exclusion now lives in the availability channel rather than the
> import, on a changed ground — not unprunability but truthfulness: a `Bool`
> requirement is answered by the pin, so a universe holding no `Bool` instance
> is the honest state to report against. Its one observable effect is that an
> orphan `honor Eq<Bool>` reports only the orphan error, with no
> duplicate-instance collision. What the paragraph verified is re-verified:
> `a == b` on `Bool` emits `a === b` with no imports, and `Bool.js` still
> exports the four dictionaries. Reopener (c)'s fallback below is
> correspondingly cheaper than recorded: selecting the declared instances
> would today produce referenced imports at use sites, not dead imports
> everywhere.

**Pre-registered reopeners**, so a future session need not re-derive them: (a) any feature that makes instance *identity* observable — dictionary reflection, scoped or overridable instances, instance-level FFI export; (b) any divergence between derived-instance emission and structural emission — a hand-tuned `Hash<Bool>`, say, which would also collide with §3.5's door doctrine on its way in; (c) a ruling that §3.5's sentence governs *selection* to the letter, not provenance. In each case the fallback is known and correct: select the declared instances and accept the dead imports until interfaces become prunable — observationally identical today, and strictly worse emission.

---

## 4. What the reclassification deletes

Each item is a simplification: a special case that existed *because* Bool was a primitive with union-like aspirations.

1. **The exhaustiveness carve-out.** Pattern Matching's finite-literal-domain listing ("unions …, `Bool` via literals, `Unit`, and tuples/records thereof") loses its Bool clause — Bool is now the "unions" clause. The acceptance test ("a `match` on `Bool` with `true`/`false` arms is exhaustive with no `_`") survives with `True`/`False` spellings, now exercising the union path.
2. **Bool literal patterns.** The literal-pattern type list shrinks to `Int`, `String` (never `Float`, unchanged). The `Eq`-elaboration note simplifies: every literal pattern is `Int` or `String`, both on the `===` fast path.
3. **Decreed constraint rows.** Primitive Types §4's "Standard constraints" fiat list becomes the derivation pointer (§2.1 above).
4. **The `Show` special row.** Primitive Types §7's table drops its Bool row to a correction pointer; Bool joins the derived structural show story.

The witness-rendering rule (Pattern Matching: "literals for finite literal domains (`false`)") re-examples to a constructor witness (`False`), which the union witness machinery already renders.

---

## 5. Rejected alternatives (do not re-litigate)

- **Keeping primitive Bool.** The standing design, correct under the superseded doctrine, re-arguable only by reversing §1 itself. Its cost under the new doctrine: four permanent decree-sites (exhaustiveness, literal patterns, constraint fiat, Show fiat) for a type the union machinery describes for free.
- **Lowercase constructors (`union Bool = false | true`, OCaml's spelling).** Rejected: it carves a two-name exception into the uppercase-constructor rule (Unions §2, Functions §2), which is the parse-level mechanism distinguishing constructors from binders in patterns — a load-bearing rule this spec corpus cites constantly. OCaml can afford lowercase constructors because its pattern grammar resolves them differently; Hexagon's case rule is structural, and exceptions to structural rules metastasize. The migration-comfort argument is served adequately by the §2.2 redirect diagnostic.
- **`true`/`false` as alias literals for the constructors (both spellings legal).** Rejected: two spellings for the two most common values in the language is a permanent style war and a diff-noise generator; the corpus's own words-only doctrine (Operators §1.2) rejects duplicate spellings on exactly this ground. One spelling, one redirect.
- **Pinning via the intrinsic door.** Rejected on the door's own doctrine (Intrinsics §1: linkage for *declared operations*); a representation is not an operation, and widening the door to carry representations would re-found it for one customer.
- **A spec-text-only declaration (no source form).** Rejected (James, 2026-07-29 — §3.5): if `Bool`'s declaration were spec prose rather than compilable prelude source, its instances would have to be compiler-provided, colliding with Collections Part 2 §4.4's no-source-form doctrine for provided `Hash` — an exception where the source-file route needs none. The `Seq.hex` precedent decides it: privileged stdlib source with exactly one compiler-granted privilege is the established shape.
- **Compiling `Bool` to the strings `"False"`/`"True"` (no pin — the then-uniform all-nullary string representation; since #771 the unpinned alternative would be the tagged objects `{tag: "True"}`, and the rejection holds a fortiori).** Rejected: every `if` in emitted code would branch on a string, every extern boolean would need conversion, and the `.d.ts` for the language's most common type would be a two-string union. This is the JavaScript-specific fact (§1) that earns the pin its place.

---

## 6. Edit-notes ledger

*(Rewritten 2026-07-29 in response to PR #148 review findings 1, 2, 4, 9 — the original ledger understated two normative dependencies as respellings, omitted FFI Part 10 entirely, and carried wrong §-references; this version is audited against the actual section map of each target.)*

Applied in this ruling's PR (direct edits): **Primitive Types** (§1 table, §4, §7 rule + table row, §10 log, new §12 correction record), **Unions** (§1 doctrine carve, §6 lead-in, §6.2 pin exception, §8 prelude declaration, §10 log), **Lexer** (§4.1 redirect group + position-aware diagnostic, §10 required-diagnostics rows, §12 log), **Pattern Matching** (§2 grammar inventory comment, §2.5, §3 guard spellings, §5.1 irrefutability table, §6.1 examples, §7.1 exhaustiveness listing, §7.2, §7.3 witness rendering, §10 rejected-alternatives rows, §13 log, §15 acceptance tests), **Collections Part 2** (§2.5 `Hash<Bool>` provenance + closing sentence and lead-in, §4.4 scope clause, new §18 correction record), **FFI Part 1** (§4.1 all-nullary row exemption, §5 primitive-requirements note), **Operators & Logic** (§14.3a stale edit note against the deleted Primitive Types fiat list: discharged), **README** (rule 3 list, ownership map), **spec-roadmap** (§4 ripple registration).

Owed, applied on next touch of the target doc (README authority rule 4):

| Target | Note |
|---|---|
| Operators & Logic §4, §11 | **Normative dependency, not a respelling:** the native emission of the five logic operators (`&&`, `\|\|`, `!`, `!a \|\| b`, `===`) and of `if`/`while` conditions consuming `Bool` directly is **licensed by the §3 representation pin** (§3.4 here; Unions §8 carries the carve). State the license where the emission is mandated. Example spellings respell. **Discharged 2026-07-29** — the #147 ripple PR (new Operators §4.5 states the license and the eliminator exception; §4.1/§4.3/§11.1 point at it; §5.1 fast path reclassified; spellings respelled). |
| Collections Part 4 §10.1, §18 | **Normative dependency, not a respelling:** §10.1's faithfulness guarantee is stated over "every primitive, and exactly the `Hash`-bearing primitive inventory of Part 2 §2.5" — both qualifying clauses now stale for `Bool`. The guarantee **still holds** (pin ⇒ `Eq<Bool>` is `===` on booleans ⇒ SameValueZero), but its grounds for `Bool` become "derived union `Eq` over the pinned representation"; restate the lead-in and amend §18 note 2's `Bool` line. Filed per §18 note 4's own change-control procedure. Predicate examples respell. **Discharged 2026-07-29** — the #147 ripple PR, together with FFI Part 10 §4.3 per the procedure. |
| FFI Part 10 §4.3 | Mirror of the Part 4 §10.1 item (the two enumerations are change-controlled together per Part 4 §18 note 4); same restatement. **Discharged 2026-07-29** — the #147 ripple PR, in the same edit as the Part 4 row. |
| FFI Part 2 / zero-cost exports | Boundary mapping `Bool ↔ boolean` unchanged (§3.3); zero-cost §2.1's "unions do not enter the set" sentence gains a clarifying clause (`Bool` is in by enumeration; membership is a language category, §3.3 here); example spellings respell. **Discharged 2026-07-29** — the #147 ripple PR (zero-cost §2.1 clause added, §2.3 face grounds pointed at the pin; FFI Part 2 audited — it carries no stale spelling and no `Bool`-classification text, so no edit was needed there). |
| `ffi.md` §"native primitives" list | `Bool` reclassifies to the prelude-union clause with a pin pointer; face unchanged (`boolean`). **Discharged 2026-07-29** — the #147 ripple PR (§6 master-table rows). |
| Method Syntax §3.4 receiver-shape table + §4.1 companion table | `Bool` moves from the **Primitive** rows to the prelude-nominal rows (both tables list it under Primitive); `CompanionOf(Bool)` = the `Bool` companion module, now also the declaration's home (§3.5). Dispatch outcome unchanged — the move is classification hygiene, flagged because dot-call dispatch has proven sensitive to symbol classification (#134's fun-vs-extern lesson). **Discharged 2026-07-29** — the #147 ripple PR (both tables moved; amendment note under §4.1). |
| Collections Part 5 §4 non-iterables list | `Bool` reclassifies from the primitive clause to the prelude-union clause (`Option`/`Result` company); still not iterable. **Discharged 2026-07-29** — the #147 ripple PR (§4 note; record §18.3 there). |
| Type System Overview | Primitive enumeration drops Bool; Bool listed with prelude unions. (Non-authoritative router; lowest priority.) **Discharged 2026-07-29** — the #147 ripple PR (doctrine-prose pass: §3's primitive row drops `Bool` with a Primitive Types §12 pointer; prelude-union row added — `Option`, `Result`, `Bool` — citing Unions §8 and the §6.2 pin). |
| Loops & Iteration | `while` condition examples respell. **Discharged 2026-07-29** — the #147 ripple PR (`while True` in §4/§9/§12; no primitive-classification text found). |
| Corpus-wide standing rule | Any spec touched for any reason respells `true`/`false` to `True`/`False` in Hexagon-source examples in the touched sections (emitted-JS examples keep lowercase — they are JavaScript). *(Standing — never discharged.)* |

## 7. Implementation notes (hexc — follow-up work, not this PR)

Lexer: `true`/`false` keep token kinds, now diagnostic-only (§2.2's redirect). Prelude: `Bool` declared in privileged prelude source; compiler verifies shape (exactly `False | True`, this order) the way the intrinsic door verifies its inventory. Representation: pin at the union-representation decision point (the §6.2 test gains a "is this the prelude Bool?" branch); `.d.ts` writer maps `Bool` → `boolean`. Checker: delete the Bool branch of the finite-literal-domain exhaustiveness path; Bool flows through closed-constructor checking. Conformance: the §4.1 acceptance test respelled; new tests for the redirect diagnostic, `show True`, derived `Ord` emission without an index table, and an extern round-trip proving zero-cost.

*(Amended 2026-07-29, post-ripple.)* The shape verification above is **built**: checker-resident, run in every module that can name the prelude `Bool` — each module verifies the declaration as its own resolved view carries it, seeded interface copies included, so a drift between what `Bool.hex` declares and what a consumer was handed is also caught (§3.6) — with a hard compiler-integrity error naming the constructor order found. A consequence, by design: a single integrity failure reports once per module in the project, since each module's view is independently verified; the duplication is the breadth's receipt, and the path is unreachable in a real build. Conformance substitutes a reversed and a three-constructor `Bool.hex` at the injection path to prove the check fires. Direct requirements for the four constraints are satisfied structurally per §3.6, and the synthesized prelude imports omit `Bool`'s dictionaries accordingly. The conformance list additionally gained, from the ripple review: a composite-`Show` regression — a record, tuple, and constructor payload containing a `Bool` — pinning the parenthesization of the pinned two-way lookup (a bare ternary under `+`-concatenation displayed the wrong value, silently), and `Set(Bool)`/`Map(Bool, _)` coverage exercising `Hash` over the pinned representation.

---

## 8. Decisions log

| Decision | Where |
|---|---|
| Doctrine: ML dialect targeting JS; TS-author test demoted to outcome; revisit-on-next-touch rule | §1 |
| `union Bool derives (Eq, Ord, Show, Hash) = False \| True` in the prelude; constructor order fixes derived Ord | §2.1 |
| `True`/`False` are the only spellings; `true`/`false` reserved with redirect diagnostic | §2.2 |
| `show True` = `"True"` (derived union Show; supersedes lowercase ruling) | §2.3 |
| Representation pinned to JS `boolean`; sole exception to Unions §6.2; not the intrinsic door; no user-reachable pin | §3 |
| FFI boundary unchanged; `Bool` stays in the zero-cost fundamental set by enumeration | §3.3 |
| `Bool` is the sole exception to "`match` is the only eliminator"; the operator eliminators' native emission is licensed by the pin | §3.4; Unions §1/§8 |
| The declaration is real prelude source (`Seq.hex` model, `Bool` companion module, compiler-verified shape); instances arrive via the ordinary derivation door, ceasing to be compiler-provided; pin = the only privilege | §3.5; Collections Part 2 §2.5/§18 |
| Direct `Eq`/`Ord`/`Show`/`Hash` requirements on the pinned `Bool` are satisfied structurally; §3.5's provenance sentence glossed, not amended; the shape verifier (built) is the warrant; reopeners pre-registered | §3.6 |
| Exhaustiveness/literal-pattern/constraint-fiat/Show-fiat carve-outs deleted | §4 |
| Lowercase constructors, dual spellings, string representation, door-based pin: rejected | §5 |
