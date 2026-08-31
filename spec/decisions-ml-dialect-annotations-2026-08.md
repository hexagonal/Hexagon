# Hexagon Spec: Decisions — The Annotation Doctrine, and Type Holes

**Status:** Decided (August 2026; rulings on #317 and #326, carrying #315's record obligation; #368's derivability ruling, §2.4/§9.11, and its rank-2 retirement, §9.12). Closure document, authoritative until consolidated into host specs per README authority rule 3 — this document is added to rule 3's closure-document list in this same change; the standing is conferred there, not claimed here.
**Scope:** the annotation doctrine record — rigid variables, the two registers, the accumulate default, the derivability principle (§2–§3); type holes `_` in type position: semantics (§4), constrained holes `_ : C` (§4.4), positions (§5), diagnostics (§6), reporting (§7), conformance obligations (§8); rejected alternatives (§9); the edit-notes ledger (§10); implementation notes for `hexc` (§11).
**Not in scope:** expression ascription's own form and variable semantics (the Ascription spec, #307; §5.5 records only that ascription is a hole position);  the export completeness rule itself (Modules §4.1.1 owns it; §5.4 here only confirms holes do not satisfy it).
**Companions:** Functions §4.1–§4.2.1, §5, §8, §10; Modules §4.1.1; Constraints §1–§2.1 (the kind distinction and base-constraint entailment §4.4 and §9 lean on); Numeric Literals §4; Lexer §3.2; Statements & Mutability (binding annotations on `let`/`var`); Declarations Preamble §1.1 (the Rewrite Rule); `notes/default-parameters-plan.md` §7.1 (the term-position claim on `_`, declined there).

---

## 1. The ruling

> **Type holes.** A `_` in type position inside an annotation elaborates to a **fresh unification metavariable** — exactly the variable inference already creates for an unannotated position. It is never rigid, participates in unification, constraint accumulation, and numeric defaulting like any inference variable, and is subject to generalization (§8 of Functions) like any inference variable. The one normative fence: **a hole is filled with a monotype (plus whatever constraints its set carries, seeded or accumulated), never a scheme** (§4.2).
>
> **Positions.** Holes are legal in every type position inside an **inference-checked annotation** — parameter annotations, return annotations, and binding annotations on `let`/`var` — including nested type arguments, function-type components, tuple elements, and structural-record field types. The degenerate whole-type hole (`x: _`) is **legal and inert, and canonical formatting normalizes it to omission** (§5.2). Holes are rejected in every **total-contract position**: exported signatures, type-alias right-hand sides, record and union declarations, extern signatures, and constraint declarations (§5.4).
>
> **Constrained holes.** A hole — and only a hole — may carry a written constraint list: `_ : Show`, `_ : (Eq, Show)`, the constraint-list form of Functions §4.2. The list **seeds the metavariable's constraint set at introduction**: a requirement the fill must satisfy — a floor, never a cap — with everything downstream (accumulation, defaulting, generalization, instance checking) the ordinary machinery (§4.4). A named variable constrains at its binder, the one home a name affords, and a constraint suffix after any written type is a parse error (§4.4; §9 items 8–9).
>
> **Diagnostics and reporting.** An unfillable hole is an ordinary unification error; a hole that reaches generalization is governed by the ordinary generalization and defaulting rules. No new diagnostic family exists. The filled type is surfaced by hover, not by any warning (§7).
>
> **The doctrine, recorded.** Annotations are contracts: a written type variable is rigid — shape pinned, constraints still accumulating (§2). Hexagon's annotation system is Haskell's with `PartialTypeSignatures`, under a different — and deliberate — default (§3). The alternatives in §9 are rejected and not to be re-litigated.

## 2. The doctrine: written is claimed, unwritten is inferred

The type system runs on one axis. Everything **written is a checked claim**; everything **unwritten is inferred**. Functions §4.1 already states both halves for annotations: any subset of annotations may be given and inference fills the rest, and a written type variable is rigid while its definition is checked — "the annotation is a contract, not a hint."

### 2.1 The two registers

A written annotation engages two registers, and keeping them separate dissolves the standard confusion:

- **Shape.** Writing a type variable pins structure. `a` stands for an arbitrary type; it cannot be narrowed to `Int` or any other concrete type to satisfy the body. This is rigidity, and it is what "contract" means.
- **Constraints.** The constraint set is a separate register that **accumulates when unwritten**. `let numeric(value: a) = value + 1` is legal: the body's `+` adds `Num` to `a`'s constraint set, and the binding's scheme becomes `Num a => a -> a` — still fully general. `a` never *becomes* anything; the scheme *gains* a constraint.

Rigidity pins shape; it never suppresses demands discovered in the body (Functions §4.1's own sentence). The contrast with OCaml is exact: OCaml unifies an annotation variable away — `let f (x : 'a) = x + 1` compiles with `'a` silently decided to be `int`, generality destroyed. Hexagon never narrows a written variable; it either holds the claim (accumulating constraints as needed) or rejects the definition.

### 2.2 What a hole adds

The written/unwritten axis previously operated per annotation slot: a parameter is annotated or it is not. A hole makes "unwritten" expressible *inside* a written annotation: `xs: Vector(_)` claims the constructor and infers the element. Holes therefore complete the existing principle rather than adding a new rule — §4 gives the semantics no independent degrees of freedom.

### 2.3 Equality without generality is inference's business

There is no instrument that links two positions' types **without** claiming generality — a hypothetical "these two parameters have the same type, whatever it is." A written variable claims generality (§2.1); a hole claims no shape and links nothing (two holes are two independent metavariables; a constrained hole, §4.4, adds obligations to its one hole without linking it to anything). The gap is deliberate and permanent: inference already discovers equalities the body forces, and a linking-only annotation form is rejected in §9.6.

### 2.4 Derivability: annotations refuse, they never enable

Functions §4's preamble already carries the principle at annotation scope — annotations "never change what inference could derive except by restricting it" — and this section records it as doctrine at type-system scope. The claim is about derivation power, not legality: the corpus does gate legality on written types in places — an export's complete signature (Modules §4.1.1), and a match function whose parameter no seat determines (Pattern Matching §6.1's refusal; Functions §4.3's supplying seats count an annotated binding among several annotation-free routes) — and there the requirement is a boundary or determinacy rule, and the type the written form supplies is one inference works with wherever the same information arrives by any other route. What no written claim ever does is inject an assumption inference could not have reconstructed — above all, a *scheme* where inference holds a monotype, which is Haskell's signature rule for recursive groups and annotated polymorphic recursion with it. Such features are rejected in §9.11: each makes typability depend on which annotations are present, and one admitted case is the thin edge of the wedge toward a second, annotation-driven type system standing beside the inferred one. (Functions §4.2's rank-2 pathway, once recorded as an annotation-gated deferral, is retired by this ruling: such a gate is annotation-enabled typability by construction — §9.12.) Roc draws the same line: decidable principal inference, under which no annotation can make a type more flexible than deleting it would. The principle is generative, not merely defensive: complete inference is the platform whole-program features stand on, and the effects system is the standing exemplar — a definition's own effect colour is inferred from its body, never written in its header (Functions §4.1; Effects §2), a design coherent only because the checker reconstructs every type unaided. Features of that kind are meant to grow, and each one compounds the value of keeping the guarantee absolute. Functions §7.4's monomorphic knot is the principle made visible at recursion — it needs no enforcement beyond ordinary inference — and dictionary-sharing §6.2 states its emission-side face: a recursive occurrence sees a monotype and cannot demand new instantiations.

## 3. The Haskell characterization

Hexagon's annotation system is **Haskell plus `PartialTypeSignatures`, with a different default**:

| Hexagon writes | Shape | Constraints | Haskell equivalent |
|---|---|---|---|
| `let f(x) = x + 1` | inferred | inferred | no signature |
| `let f(x: a) = x + 1` | claimed (rigid) | inferred (accumulates) | `f :: _ => a -> a` |
| `let f<a: Num>(x: a): a = x + 1` | claimed | claimed (§4.2: no silent strengthening) | `f :: Num a => a -> a` |
| exported `f` | claimed, mandatory | claimed, mandatory (Modules §4.1.1) | top-level-signature culture, enforced |

### 3.1 The default divergence is deliberate

Haskell's default reads a bare signature as a **complete contract** (constraints included); Hexagon's reads a bare annotation as **shape claim plus accumulation**. Hexagon's default is kept, and it is not an accident of implementation — it is entailed by two recorded decisions:

1. **No standalone signature lines** (Functions §4.1). Hexagon has no signature separate from the definition; annotations live on binders.
2. **"Any subset of annotations may be given; inference fills the rest"** (Functions §4.1). The annotation syntax is partial by design.

A complete-contract default imported into a partial-by-design syntax would (a) conscript every variable-annotated private function into constraint-binder ceremony, contradicting §4.2.1's own decision procedure (private functions write no binders); and (b) deem unwritten constraints "claimed empty" while the equally unwritten return type stays inferred — an asymmetry with no principle behind it. Haskell's complete-contract semantics already govern exactly the two positions where Hexagon writes a total claim: written constraint binder lists (Functions §4.2) and exports (Modules §4.1.1).

### 3.2 What to draw from `PartialTypeSignatures`, and what to decline

Draw: the skolem-checking technique for rigid variables (the literature anchor Functions §4.1 already names once); the hole-elaboration model (wildcards become metavariables); hole reporting mapped to hover rather than warnings (§7). Decline: named wildcards (`_a` — §9.4); `ScopedTypeVariables`-style scoping accretion; higher-rank machinery (outside Functions §4.2's fence). Diagnostic vocabulary is unchanged: Hexagon says **declared type variable**, never "skolem" or "rigid type variable," in user-facing text.

## 4. Type holes: semantics

### 4.1 Elaboration

A `_` in type position elaborates to a fresh unification metavariable at the enclosing definition's level — the same variable, created the same way, as for an unannotated position. It carries no `declared` identity: it is never rigid, and no two holes are related (each `_` is its own metavariable; `(_, _)` may fill as `(Int, String)`). The unit is the **written** hole: when substitution copies an annotation into several positions — a parameterized type alias applied at a hole, `type Pair(a) = (a, a)` used as `Pair(_)` — every copy shares the one metavariable the written hole introduced. `Pair(_)` is a pair of one type, exactly as `Pair(Int)` is; two independent element types would un-write the alias's own contract.

Everything else follows from existing rules with no new clauses:

- **Unification** fills the hole from the body and use sites.
- **Constraint accumulation** applies as to any inference variable.
- **Numeric defaulting** (Numeric Literals §4) applies: `let n: _ = 42` infers `Int`.
- **Generalization** (Functions §8) applies: a hole nothing fixed generalizes exactly as an unannotated position would, subject to the same value-restriction and evidence-seat rules. `let count(entries: Vector(_)): Int = Vector.length(entries)` generalizes to `Vector(a) -> Int`.

### 4.2 The monotype fence

**A hole is filled with a monotype — plus whatever constraints its set carries, seeded (§4.4) or accumulated — never a scheme.** This is the ruling's one normative fence, and it is what keeps decidability untouched: holes add strictly *less* information than full annotations, and Hindley–Milner infers with zero annotations already. The undecidable neighbors — full System F inference, rank ≥ 3, polymorphic recursion — are all forms of *guessing polytypes*. At rank 1 the fence is trivially enforceable, and Functions §4.2's position restriction already fences rank-2 expression out of this pathway.

### 4.3 No lexical change

Lexer §3.2's bare-`_` wildcard token is reused; this is a type-grammar extension, not a lexer change. The token's three roles are in disjoint contexts: pattern position (the pattern wildcard), digit-flanked inside numeric literals (the separator, lexed away), and now type position (the hole). Pattern `_` and type `_` are cognates — "I decline to specify this position" — the pairing Haskell, Rust, and Scala all run. Term-position `_` remains dead: Functions §5 rejects placeholder shorthand, and the default-parameters plan (§7.1 there) declines `_` as an argument-position marker, so no term-position claim on the token survives.

### 4.4 Constrained holes

**Form.** A hole may carry a written constraint list: `_ : C` with a single constraint reference, `_ : (C1, C2)` with the parenthesized conjunction — Functions §4.2's constraint-list form, reused wholesale, base-constraint entailment included (a listed constraint's bases ride along unstated). The suffix is bounded — one constraint reference or one balanced parenthesized list — so the constrained hole is a closed type operand: `_ : Num -> a` is `(_ : Num) -> a`, and grouping parentheses remain available where a reader wants them. Only a hole admits the suffix. A constraint suffix after any written type — `x: Int : Num`, `Vector(a : Show)` — is a parse error (§9 items 8–9): a written type's instances are facts the checker already knows, and a named variable's constraint home is its binder.

**Why inline, and why only for holes — the complementary split.** A name is what lets several occurrences share one constraint statement: `<a: Num>(x: a, y: a)` states the fact once, at the variable's own level, indifferent to parameter order, gathered where exports publish their contract (Modules §4.1.1). Inline attachment on a named variable would either restate the constraint per occurrence or make its location an accident of which parameter mentions the variable first — so it is rejected (§9 item 8). A hole is nameless: no binder can reach it, so the inline suffix is not a second spelling of anything. It is the only possible constraint position for an unwritten type. Each form exists exactly where the other cannot: names constrain at binders, holes constrain inline.

**Semantics.** The listed constraints are added to the hole's fresh metavariable at introduction. This seeds the ordinary accumulation register (§2.1) — it is not a new judgment, and everything §4.1 says continues to hold. Discharge is by the ordinary machinery:

- A concrete fill meets ordinary instance resolution: `let f(x: _ : Num) = x and True` fails with the ordinary missing-instance error — the body fills the hole at `Bool`, and no `Num<Bool>` instance exists.
- A hole that generalizes carries its seeded constraints into the scheme alongside any accumulated ones: `let f(x: _ : Show) = x` receives `Show a => a -> a`.
- Defaulting consults the constraint set as always: `let n: _ : Num = 42` gives `n : Int`.

**A floor, never a cap.** The written list is a requirement the fill must satisfy, not a completeness contract: accumulation continues past it (§9 item 10 rejects the cap reading). Completeness is a property of a *claimed scheme*; a fill is a monotype that honors whatever it honors — `Int` honors far more than `Num`. The no-silent-strengthening contract stays where schemes are claimed: written binder lists (Functions §4.2) and exports (Modules §4.1.1).

**Substitution.** The unit is the written hole (§4.1), constraints included: when alias substitution copies `Pair(_ : Num)`'s hole into both components of `type Pair(a) = (a, a)`, the copies share the one metavariable and its one seeded constraint — one `Num` obligation, not two.

**Style.** A constrained hole is never inert, so S11's normalization does not touch it (§5.2). S12 extends by its own words: where a constrained hole would generalize, the variable-plus-binder was writable, and canonical Hexagon writes it — `f<a: Show>(x: a)`, not `f(x: _ : Show)`; the constrained hole is canonical exactly where the variable would be refused, the concrete-but-inferred position carrying a constraint requirement — `entries: Vector(_ : Num)` whose body fixes the element at `Int`. Canonical formatting never rewrites one form into the other: that transform invents a name and edits a binder list, which is authorship, not formatting. Canonical spacing sets the constraint colon off with spaces — `x: _ : Num`, never `x: _: Num` — keeping the annotation colon and the constraint colon visually distinct; binder lists are untouched (`<a: Num>`).

## 5. Positions

### 5.1 Legal positions

A hole may appear in **any type position inside an inference-checked annotation**. The inference-checked annotation positions are:

- parameter annotations (`x: Vector(_)`),
- return annotations (`let f(x): _ -> Bool = ...` and plain `let f(x): Vector(_) = ...`),
- binding annotations on `let` and `var` statements (`let n: _ = 42`),
- expression ascriptions (`(parse(raw) : Vector(_))` — the Ascription spec; §5.5). *(added 2026-08-06, #307)*

Within such an annotation, every type position admits a hole: type arguments (`Map(String, _)`), function-type parameters and results (`(_ -> Bool)`), tuple elements (`(_, Int)`), structural-record field types (`{ name: _ }`), and nesting of all of these.

### 5.2 The degenerate whole-type hole

A bare `_` as the entire annotation — `x: _` in a parameter list, `let n: _ = 42` — is **legal and inert**: it means exactly what omitting the annotation means. Canonical Hexagon **normalizes it away**: the formatter drops the degenerate annotation, leaving the bare binder — `f(x: _, y)` becomes `f(x, y)` (review-package item S11 in `notes/canonical-formatting-and-naming.md`). Legality is uniformity — a hole is a type expression, and no position carve-out exists; it also keeps annotations editable (deleting `Vector(...)` around a hole must not manufacture a parse error) and gives the proof pair (§6.2) its binding-annotation spelling (chosen while expression ascription was out of the language; the ascription spelling exists now — Ascription spec §3.2 — and the pair stands as written). Holes *inside* a written type (`Vector(_)`) are ordinary canonical Hexagon and are not normalized. A **constrained** whole-type hole is different: `x: _ : C` carries a claim, is not inert, and is kept (§4.4).

### 5.3 Constraint binder lists

No hole may appear in a `<...>` binder list — a written list is a contract (Functions §4.2), and a hole would un-write it. The accumulate default already expresses "infer my constraints": omit the binder. No new rule is needed to enforce this: the grammar has no hole-shaped position in a binder list (the binder is a name, and a constraint reference is an uppercase name), so `<a: _>` and `<_: C>` are parse errors today and remain so. The complement — a constraint written *on* a hole — lives inline (§4.4) precisely because no binder can name a hole; the two rules are one split, names at binders and holes inline, with no position where both forms are writable.

### 5.4 The fence: total-contract positions

A hole is rejected in every position the corpus defines as a **total written contract**:

| Position | Owner of the totality rule |
|---|---|
| Exported signatures — function parameters, results, binders, and an exported value binding's annotation | Modules §4.1.1 |
| Type-alias right-hand sides | Declarations Preamble §4–§5 |
| `record` and `union` declaration field/slot types | Products / Unions |
| Extern signatures, all FFI declaration forms | FFI Parts 4–5 |
| Constraint declarations (member signatures, subjects) | Constraints |
| `honor` instance heads (the subject type and its arguments) | Constraints |
| `exception` declaration slot types | Exceptions |
| `honor` implied-type choices | Constraints / Collections Part 2 |

The `exception` and implied-type rows follow from the same sentence that admits the others: written types checked against no body, where an unsolved variable would seat silently. These are declaration surfaces, not inference surfaces: nothing checks a body against them from which a hole could be filled — or, for exports, the completeness requirement is the point and a hole would un-write part of the module's contract. Rejecting holes at exports also keeps them entirely out of the `.d.ts` facing machinery (FFI Part 7): no emitted face can contain a hole.

Each fence rejection is a hard error naming the rewrite (§6.3), per the Rewrite Rule.

### 5.5 Expression ascription

An ascription `(e : T)` is an inference-checked annotation position and holes apply there by this ruling's §5.1 rule — `(e : Vector(_))` claims the constructor and infers the element. *(This section pre-committed the rule while the ascription arc was paused; the arc resumed and ruled 2026-08-06, #307 — the Ascription spec now cites this rule and owns everything else about the form, its variable semantics included.)*

### 5.6 Canonical choice: the variable, not the hole, where the claim is true

Where a written variable would hold — the position is genuinely generic — canonical Hexagon writes the variable, not a hole (review-package item S12). The two spellings scheme identically there, and the variable is the checked claim: a later edit that fixes the position fails at the definition instead of quietly monomorphizing a private helper, and a signature written with variables promotes to `export` unchanged (Modules §4.1.1 demands the total claim there anyway). A hole is canonical exactly where a variable would be refused — the concrete-but-inferred position: claim the constructor, leave the element to the body that fixes it. Scratch text mid-edit is not governed; canonical formatting never was a typing aid's business. This is §2's axis applied to style: write the strongest true claim.

## 6. Diagnostics

### 6.1 No new family

- **Unfillable hole:** an ordinary unification error. The hole's span is a valid attribution site; the existing conflict-attribution machinery (Functions §10's rows) governs which end of the conflict the caret lands on.
- **Hole undetermined at generalization:** the ordinary rules apply — the variable generalizes if Functions §8 permits, or defaulting (Numeric Literals §4) or the ambiguity rules take it. Leaving a hole unresolved is not an error; it is inference.
- **Unsatisfiable seeded constraint** (§4.4): the ordinary missing-instance error, arising at whatever use fixes the fill; the hole's span is a valid attribution site, as above.
- There is no "unfilled hole" warning and no hole-specific error family.

### 6.2 The proof pair

Two annotations, one principle, different answers — normative examples for spec and conformance suite alike:

```hexagon
let n: _ = 42    -- legal: the hole is an inference variable; Numeric Literals §4 defaults it, n : Int
let n: a = 42    -- error: defaulting reaches the declared variable, and rigidity refuses the narrowing
```

The two halves meet the **same rule** and diverge there. At a value binding, Numeric Literals §4's defaulting reaches the variable in both cases: the hole is an ordinary inference variable and accepts the default (`n : Int`); the declared variable is rigid, so the attempted `a := Int` fails as Functions §10's *forced-to-a-concrete-type* row ("`a` is a declared type variable, but the body requires `Int`…", naming the rewrite). The evidence-seat row (Functions §8.2, §10) is a different member of the declared-variable family: it governs constraints defaulting cannot discharge on a non-function value binding, and expansive bindings answer to §8.7 — a hole is indifferent to all of this, because it is never rigid. No clause anywhere mentions holes and defaulting together; the different answers fall out of *written is claimed, unwritten is inferred* meeting one defaulting rule.

### 6.3 Fence diagnostics

A hole in a total-contract position is a hard error at the hole's span, naming the position's totality rule and the rewrite:

- Export: "an exported signature is complete (Modules §4.1.1); replace `_` with the intended type."
- Declaration surfaces (alias / record / union / extern / constraint): "a `T` declaration writes its types in full; replace `_` with the intended type."
- `honor` heads: "an `honor` declaration names its subject in full; replace `_` with the intended type."

The exact wording is the implementation's, the two obligations — name the totality rule, name the rewrite — are not.

## 7. Reporting

The filled type is surfaced by **hover, not diagnostics**. Hexagon has no warning tier (Declarations Preamble §1.1), so GHC's hole-warning behavior has no Hexagon analogue and none is wanted. Hover at a hole's span shows the elaborated type as generalized at the binding — the LSP already renders schemes for hover (its occurrence machinery and doc-comment integration are unaffected). Completion and other tooling surfaces treat a hole as they treat any type position.

## 8. Conformance obligations

1. The proof pair (§6.2), both halves, with the second half's diagnostic pinned to Functions §10's forced-to-a-concrete-type row.
2. Degenerate-hole inertness: `let f(x: _) = x` and `let f(x) = x` receive identical schemes; likewise for a binding annotation.
3. A constructor-claim hole: `xs: Vector(_)` accepts a vector argument, rejects a non-vector, and generalizes the element when nothing fixes it.
4. Independence: two holes in one annotation fill independently (`(_, _)` at `(Int, String)`).
5. Accumulation through a hole: a body applying `+` to a hole-typed parameter yields a `Num`-constrained scheme, not an error and not `Int` (absent defaulting pressure).
6. Fence errors at each §5.4 position — including an `honor` head — each naming its rewrite.
7. `<a: _>` and `<_: C>` remain parse errors.
8. Hover at a hole's span reports the filled type.
9. One written hole is one metavariable through alias substitution: with `type Pair(a) = (a, a)`, a `Pair(_)` parameter rejects `(1, "two")`, and its unfixed element schemes as one shared variable.
10. A seeded constraint reaches the scheme: `let f(x: _ : Show) = x` receives `Show a => a -> a` — seeded, not accumulated, since the body demands nothing.
11. A seeded constraint refuses a bad fill: `let f(x: _ : Num) = x and True` errors with the ordinary missing-instance diagnostic.
12. Defaulting through a constrained hole: `let n: _ : Num = 42` gives `n : Int`.
13. Grammar boundaries: `_ : Num -> a` parses as `(_ : Num) -> a`; in a tuple type, `(_ : Num, Int)`'s comma belongs to the tuple; the conjunction `_ : (Eq, Show)` seeds both constraints; `x: Int : Num` and `Vector(a : Show)` are parse errors.
14. Seeding survives substitution as one obligation: with `type Pair(a) = (a, a)`, a `Pair(_ : Num)` parameter left unfixed schemes as one shared `Num`-constrained variable.
15. *(#368.)* The identity suffix at the knot (Functions §7.4), pinned on **emitted JS plus runtime execution**, never emitted JS alone — the arc began as a silent miscompile: self-recursion (single- and multi-constraint, the suffix read in the callee's own order), unannotated mutual cross-calls, a value-position recursive occurrence, and the asymmetric knot both ways (a member whose suffix is empty calling a sibling whose suffix is not). For the asymmetric knot the normative outcomes are pinned outcome-by-outcome: where the callee-only variable's constraints admit defaulting, the module compiles and **runs**, the cross-call passing the defaulted ground dictionary; where they do not (an `Eq`-only element variable nothing fixes), the module is **refused** on the ambiguity path (`decisions-ml-dialect-generalization-2026-08.md` §4.1's Step 2 and §13; Numeric Literals §4/§6), the refusal's wording the implementation's to supply within that path's family — the cited bullets are literal-centric and this shape has no literal. The two shapes #368 records as nonconforming — an internal compiler error on the defaultable variant, a clean compile with an under-applied cross-call on the other — are different passes (checker ambiguity vs. emitter arity), so a fix to one does not discharge the other.
16. *(#368.)* Both §10 message fences (Functions §10's polymorphic-recursion row): the rigid-vs-concrete message surfaces no type the body did not demand; the rigid-vs-rigid message carries the SCC hint with per-member qualification and never the same-name advice. The concrete-instantiation refusal inside a knot (a sibling calling a headed member at a concrete type) keeps the rigid-vs-concrete message, correct in kind.

## 9. Rejected alternatives (do not re-litigate)

1. **OCaml/F#-style unifiable annotation variables.** A written `'a` that silently unifies to `int` makes the annotation a hint, not a contract, and destroys generality without a diagnostic — the exact footgun §2.1 records. Rejected; Hexagon's written variables are rigid.
2. **The warn-and-narrow middle ground** (F#'s FS0064: warn, then monomorphize anyway). Hexagon has no warning tier, and a claim that quietly narrows is a broken claim whether or not a warning fires.
3. **Haskell's complete-contract default for bare annotations.** Rejected by the entailment argument of §3.1: it conscripts private annotations into binder ceremony and invents a claimed-empty/inferred asymmetry between constraints and result types.
4. **Named wildcards** (`_a`, GHC's `NamedWildCards`): a middle thing between a hole and a declared variable — links positions like a variable, fills like a hole. Two spellings away from each existing concept, and its use cases are covered by writing the variable (generality intended) or letting inference link positions (generality not claimed). Rejected.
5. **Term-position holes** (placeholder arguments, partial-application shorthand). Already rejected at Functions §5 and declined again by the default-parameters plan; the type-position meaning now standing makes any future term-position claim on `_` a re-litigation of both.
6. **A linking-without-generality instrument** (§2.3). Inference already links what the body forces; an annotation form that links without claiming would be a third variable-like concept with no claim semantics. Permanently declined.
7. **Rejecting the degenerate whole-type hole.** Considered (a bare `_` claims nothing, so forcing its deletion keeps every annotation meaningful) and declined for the position carve-out it requires and the editing hazard. What the rejection wanted, canonical formatting delivers without a language rule: the degenerate hole is legal, inert, and normalized to omission (§5.2).
8. **Inline constraint attachment on named variables** — `(x: a : Num)` — and the full binder elimination it invites (inline replacing `<...>` on function headers and `honor` prefixes, angle brackets contracting to `constraint`/`honor` heads). Rejected on the name's power: a name states a constraint once for all occurrences, at the variable's own level; first-occurrence inline attachment relocates the statement whenever parameters reorder, per-occurrence attachment is restatement, and exports gather constraints as front-matter (Modules §4.1.1) — the same gathering pressure that produced `where` clauses elsewhere. The binder remains the one constraint home for named variables. `constraint` heads were never in question: their `<...>` is the application-form kind distinction (Constraints §1), not binder ceremony.
9. **Constraint claims on written types** — `x: Int : Num`, `Vector(a : Show)`. Parse error. Where the claim is true it is redundant (a written type's instances are facts the checker already knows), and the named-variable spelling is item 8's rejection; a claim form that is either redundant or refused earns no grammar.
10. **Cap semantics for the seeded list** (reading `_ : C` as a completeness contract on the fill). Rejected: completeness governs claimed schemes, and a fill is a monotype that honors whatever it honors. A cap would also make `_ : C` reject programs a bare `_` accepts — a form that *adds* rejections by claiming *less* than a binder does would be incoherent.
11. **Annotation-enabled typability** — Haskell's signature rule for recursive definitions (a signed member of an SCC participates at its declared scheme), and with it annotated polymorphic recursion. It would make the two-headed mutual group legal (`fun isEven<a: Eq>` / `fun isOdd<a: Eq>`, refused by Functions §7.4 because two declarations' rigids can never be one variable) — but only by making an annotation load-bearing for typability, against §2.4's derivability principle, and by letting a recursive occurrence demand new instantiations where dictionary-sharing §6.2 relies on it seeing a monotype. The refused spelling has legal neighbors of identical meaning (a headless knot; a single head every sibling reaches generically; a non-recursive wrapper carrying the contract — the only spelling where two or more functions of one knot must export, Functions §7.4), so the rule would buy expressiveness a wrapper already delivers, at the price of a second type system. Rejected permanently; the mutual-group presentation takes Functions §10's SCC hint, not a semantics change.
12. **Rank-2 types through an annotation gate** — retiring the pathway Functions §4.2 and §11 once recorded as a deferral ("rank-2 has its own annotation-gated pathway"). Rank-2 typability is decidable in isolation (rank ≥ 3 is the undecidable neighbor, §4.2 of this document), but it has no principal types and no inference story any practical language ships: every real implementation gates it behind written signatures, which is annotation-enabled typability by construction — exactly §2.4's violation, and the reason the deferral cannot be redeemed. What the feature would buy, the language already answers: a polymorphic function as an argument is what a constraint bound delivers (the dictionary is this language's polytype argument), and scoped mutation needs no `runST`-style phantom because `var` is structurally confined (Statements & Mutability §6.2). Extern declarations are unaffected — an extern is a boundary axiom, fully annotated because there is no source to infer from (§2.4's boundary category), and FFI Part 4 §12.4's generic-externs deferral is rank-1 genericity, untouched. Hexagon is a rank-1, HM-derivable language; that sentence is the whole rule.

## 10. Edit-notes ledger

Applied in the #317 change:

- **Functions §4.1** gains the hole surface paragraph (pointer here for semantics, positions, fence).
- **Functions §11** gains the cross-reference entry.
- **README** registers this document (authority rule 3 and the closure-docs ownership row).
- **`notes/canonical-formatting-and-naming.md`** gains items S11 (degenerate holes normalize to omission; §5.2) and S12 (the variable, not the hole, where the claim is true; §5.6).
- **Book, Functions chapter**: **rigid** named where the declared-variable trio is first taught.
- **Book, Polymorphism chapter**: the rigid-variable deepening, the type-holes section, the OCaml/F# contrast, the Summary additions, and the continuity record's new commitments.

Applied in the #326 change:

- **Functions §4.1**: the hole surface paragraph gains the constrained-hole sentence (pointer here).
- **`notes/canonical-formatting-and-naming.md`**: S11 gains the not-inert clause for constrained holes; S12 gains the constrained-hole extension and the constraint-colon spacing.
- **Book, Polymorphism chapter**: the constrained-holes section beside the type-holes section — `Vector(_ : Num)` on the established `padded` example, the claim-ladder, and the complementary split taught against a multi-occurrence binder.
- **Book, Constraints chapter**: the contract sentence scoped to binder lists, with the constrained-hole floor noted as the deliberate contrast.

Applied in the #368 change:

- **§2.4** records the derivability principle (anchored on Functions §4's preamble sentence); **§9.11** the annotation-enabled-typability rejection; **§9.12** the rank-2 retirement (ruled in the same arc after the review surfaced the standing tension); **§8** items 15–16 the conformance obligations.
- **Functions §4.2** and **§11**: the "annotation-gated pathway" sentences are rewritten from deferral to rejection, each citing §9.12; the Not-in-scope line here drops its rank-2 clause.
- **Functions §7.4** gains the two knot corollaries (identity evidence suffix over the shared variables; a declared head admits no instantiation inside the knot, wrapper-only where two or more functions of one knot export); **Functions §10**'s polymorphic-recursion row pins the SCC hint and both message fences.
- **Book**: no edit — the Polymorphism chapter's "Recursive calls keep one type" section already teaches the derivability ground ("without asking programmers for a special proof or a more powerful annotation language").

To apply on next touch of the target:

- **Constraints §6.1**: one sentence — SCC-internal references take the identity suffix over shared variables, Functions §7.4's corollary; the value-position recursive occurrence is its evidence-in-scope shape (pointer there).
- **dictionary-sharing §6.2**: its quoted rigid-variable diagnostic now falls under Functions §10's polymorphic-recursion row and carries the SCC hint when the occurrence is a self/SCC reference.

- **Modules §4.1.1**, both on one touch: (i) one sentence — a hole does not satisfy the completeness requirement (this document §5.4); (ii) *(#368/#700)* its complete-signature advice ("write `<a: Eq>`") needs a carve-out for functions in a recursive knot, where the advised spelling can be the refused one and the wrapper is the legal spelling (Functions §7.4).
- **Lexer §3.2** (or its §14 summary table): the wildcard token's roles now include type position; pointer here.
- **Numeric Literals §4**: optionally cite the proof pair (§6.2) as an example of defaulting reaching a hole.
- **Functions §10**: on consolidation, the fence rows (§6.3) and the proof-pair rows (§6.2) join the diagnostics checklist.
- **Constraints §1**: the "one grammar for binders" bullet gains a pointer — the constraint-list form also attaches inline to holes (§4.4 here); binders themselves are unchanged.

## 11. Implementation notes for `hexc`

Non-normative; recorded so the implementation lands where the ruling points.

- **Lexer:** no change. The `Wildcard` token exists (Lexer §3.2).
- **Parser:** the type-operand grammar gains a `Wildcard` case producing a `Hole` annotation node carrying its span. No auto-closing, layout, or precedence interaction. For §4.4: after the `Wildcard` operand, an optional `:` followed by a constraint list — the same constraint-list sub-grammar binder lists use — stored on the `Hole` node; the suffix is bounded (one reference or one balanced parenthesized list), so it introduces no arrow or precedence interaction. No other type operand admits the suffix.
- **Resolver:** `Hole` passes through. The fence (§5.4) is enforced where each total-contract surface is classified — resolver or checker, implementer's choice, provided the error carries the hole's span. A constrained hole's constraint references resolve exactly as binder-list references do; the fence needs no new case, since the suffix rides the hole.
- **Checker:** `Hole` elaborates as a fresh non-rigid variable at the current level — the same freshening as an unannotated position, with no declared name attached. No unification, generalization, defaulting, or evidence change follows; rigidity attaches only to named annotation variables, which holes are not. For §4.4: seed the freshened metavariable's constraint set with the resolved list at elaboration; the per-written-hole metavariable identity (§4.1) already carries the set through alias substitution, and everything downstream is unchanged. A projection-bearing constraint — one declaring an implied type — is refused on a hole with the binder position's own diagnostic: Collections Part 2 §7.2's v1 restriction reads "cannot constrain a type variable," and a hole's metavariable is one.
- **Hover:** resolve a hole's span to its elaborated type as generalized at the binding; schemes display with the existing machinery (constraints included, so a constrained hole needs nothing new).
- **TextMate grammar / Playground:** color a type-position `_` with the type-variable scope. Pattern-position `_` is unaffected. A constrained hole's constraint reference should color as binder-list references do — expected already covered by the existing rules; verify against the Playground.
- **Conformance:** §8's list, one observation per item.
