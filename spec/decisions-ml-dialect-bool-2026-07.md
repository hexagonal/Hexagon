# Hexagon Spec: Decisions — The ML-Dialect Pivot and `union Bool`

**Status:** Decided (ruling on issue #147, 2026-07-29). The doctrine pivot (§1) is James's ruling, made in-session 2026-07-29 and recorded here; the Bool package (§2–§6) is Fable's spec ruling under that doctrine. Authoritative until consolidated into the host specs (README authority rule: decisions docs outrank older host-spec text they correct).
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
- **The constraint rows are derived, not decreed.** `Eq` (same constructor), `Ord` (declaration order), `Show` (constructor name), `Hash` (Collections Part 2's union algorithm) all come from the standard derivations. Bool's row in the per-type inventories (#137) becomes a pointer to the derivation, not a fiat list. Still no `Num`, no `Signed`, no truthiness: conditions require `Bool`, no coercion from any other type — that sentence survives verbatim.
- **Nullary constructors are values** (Unions §2.2): `True : Bool`, used bare; `True()` is the standard "value, not a function" error.

### 2.2 Literals: `True` and `False` are the constructors

There are no separate boolean literals. `True` and `False` are ordinary uppercase-start constructor names in the term namespace, module scope, prelude-imported everywhere — exactly like `None`.

**`true` and `false` remain hard keywords** (Lexer §4.1) and may never be used as names. Their only role is the redirect diagnostic, per the Rewrite Rule:

> `true` is reserved; Bool's constructors are `True` and `False` — write `True`.

Keeping them reserved is load-bearing twice over: it makes the JS-trained user's most probable spelling error a one-token fixit rather than an unbound-name puzzle, and it forecloses `let true = ...` forever, so the spelling stays available if a future edition ever wants it back.

### 2.3 `Show` flips to constructor names

`show True` is `"True"`; interpolation `"${flag}"` renders `True` or `False`. This is the standard derived union `Show` (Unions §7) and **supersedes** the lowercase JS-form ruling in Primitive Types §4/§7 (`String(x)`, `"true"`/`"false"`). Under the old doctrine the lowercase form was ruled *because* it was JS's; under §1 the constructor name is the display form, as it is for every other union. Correction records in Primitive Types §4 and §7.

### 2.4 Pattern matching: constructor patterns, ordinary exhaustiveness

`True` and `False` in patterns are nullary constructor patterns (Pattern Matching §2.2), not literal patterns. A `match` covering both constructors is exhaustive by **closed-constructor union checking** (Unions §4.3), the same machinery as every union. §4 below itemizes the carve-outs this deletes.

---

## 3. The representation pin

### 3.1 The ruling

> The compiler pins `Bool`'s runtime representation to the JS `boolean`: `True` emits `true`, `False` emits `false`, and the `.d.ts` type of `Bool` is `boolean`. This is the **single exception** to the all-nullary string rule (Unions §6.2), granted to exactly one declaration: the prelude's `Bool`. It is a *representation commitment* recorded in the specs that own representation — **not** a use of the intrinsic door (`spec/intrinsics.md`), whose doctrine links *operations*, not representations. No user declaration can request a pin; there is no annotation, no syntax, no extension point.

Precedent is OCaml exactly: `bool` is a genuine variant declared in the stdlib, and the compiler guarantees an immediate unboxed representation. The declaration owns the semantics; the representation is a compiler commitment, invisible from inside the language (`match` is the only eliminator, so Hexagon-side code cannot observe the difference between `"True"`-the-string and `true`-the-boolean).

### 3.2 Emission consequences

- `match` on `Bool` emits on the boolean itself: an `if`/ternary or `switch (b)` with `case true:`/`case false:` — emitter's judgment, same license as Unions §6.3's ternary permission.
- Derived-instance emission simplifies past the general string case: `Eq` is `===`; `Ord` needs **no declaration-index table** (the Unions §7 implementer note for string-case `Ord` does not apply) because JS `<` on booleans is `false < true` — the pin and the declaration order agree by construction; `Hash` hashes the boolean (edit note, Collections Part 2 §2.5); `Show` emits the two-way constant lookup to `"True"`/`"False"`.
- **The representation cliff (Unions §6.2) cannot occur**: adding a constructor to `Bool` is impossible — it is prelude source under compiler verification, and any third constructor is a compiler-integrity error, not a user-reachable state.
- Constructors referenced as values materialise per Unions §6.4 against the pinned representation: `const True = true;` at the export site. Exported signatures mentioning `Bool` continue to say `boolean` in `.d.ts`.

### 3.3 FFI: nothing moves

The boundary was `Bool ↔ boolean`, zero-cost, in both directions, before this ruling; the pin's entire purpose is that it still is. Extern declarations, callbacks, exports, `Nullable(Bool)` — all unchanged. FFI docs need only example-spelling updates (§6).

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
- **Compiling `Bool` to the strings `"False"`/`"True"` (no pin — the uniform §6.2 representation).** Rejected: every `if` in emitted code would branch on a string, every extern boolean would need conversion, and the `.d.ts` for the language's most common type would be a two-string union. This is the JavaScript-specific fact (§1) that earns the pin its place.

---

## 6. Edit-notes ledger

Applied in this ruling's PR (direct edits): **Primitive Types** (§1 table, §4, §7, §10 log, new §12 correction record), **Unions** (§6.2 pin exception, §8 prelude declaration, §10 log), **Lexer** (§4.1 literal-words group becomes the redirect group), **Pattern Matching** (§1 grammar comment, §2.2, §2.5, §7.1/§9 exhaustiveness listing, irrefutability table, witness example, guard-spelling examples).

Owed, applied on next touch of the target doc (README authority rule 4):

| Target | Note |
|---|---|
| Collections Part 2 §2.5 | `Hash<Bool>` row: derived union hash over the pinned representation (hash the boolean); no longer a primitive fiat row. |
| Operators & Logic | `and`/`or`/`not`/`iff`/`implies` operate on `Bool` unchanged; example spellings `true`/`false` → `True`/`False`; §5.1's literal-pattern cross-reference no longer includes Bool. |
| Collections Part 4 (Map/Set) | Predicate examples respell; `Hash<Bool>`/`Eq<Bool>` references now derived instances. |
| FFI Part 1 / Part 2 / zero-cost exports | Boundary mapping `Bool ↔ boolean` unchanged (cite §3.3); example spellings respell. |
| Type System Overview | Primitive enumeration drops Bool; Bool listed with prelude unions. |
| Loops & Iteration | `while` condition examples respell. |
| Corpus-wide standing rule | Any spec touched for any reason respells `true`/`false` to `True`/`False` in Hexagon-source examples in the touched sections (emitted-JS examples keep lowercase — they are JavaScript). |

## 7. Implementation notes (hexc — follow-up work, not this PR)

Lexer: `true`/`false` keep token kinds, now diagnostic-only (§2.2's redirect). Prelude: `Bool` declared in privileged prelude source; compiler verifies shape (exactly `False | True`, this order) the way the intrinsic door verifies its inventory. Representation: pin at the union-representation decision point (the §6.2 test gains a "is this the prelude Bool?" branch); `.d.ts` writer maps `Bool` → `boolean`. Checker: delete the Bool branch of the finite-literal-domain exhaustiveness path; Bool flows through closed-constructor checking. Conformance: the §4.1 acceptance test respelled; new tests for the redirect diagnostic, `show True`, derived `Ord` emission without an index table, and an extern round-trip proving zero-cost.

---

## 8. Decisions log

| Decision | Where |
|---|---|
| Doctrine: ML dialect targeting JS; TS-author test demoted to outcome; revisit-on-next-touch rule | §1 |
| `union Bool derives (Eq, Ord, Show, Hash) = False \| True` in the prelude; constructor order fixes derived Ord | §2.1 |
| `True`/`False` are the only spellings; `true`/`false` reserved with redirect diagnostic | §2.2 |
| `show True` = `"True"` (derived union Show; supersedes lowercase ruling) | §2.3 |
| Representation pinned to JS `boolean`; sole exception to Unions §6.2; not the intrinsic door; no user-reachable pin | §3 |
| FFI boundary unchanged | §3.3 |
| Exhaustiveness/literal-pattern/constraint-fiat/Show-fiat carve-outs deleted | §4 |
| Lowercase constructors, dual spellings, string representation, door-based pin: rejected | §5 |
