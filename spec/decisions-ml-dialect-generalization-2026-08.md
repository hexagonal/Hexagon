# Hexagon Spec: Decisions — Generalization Relaxed, and Declared Variance

**Status:** Decided (ruling on issue #205, 2026-08-01). Fable's spec ruling under the ML-dialect doctrine (`decisions-ml-dialect-bool-2026-07.md` §1), commissioned by James in-session 2026-08-01 ("ML nature, here we come"). Provenance: `notes/value-restriction-and-variance.md` (Opus's analysis, James's framing), adopted where cited and corrected where the in-session review found it wrong (§1.2). Authoritative until consolidated into the host specs, per README authority rule 3 — this document is added to rule 3's closure-document list in this same PR; the standing is conferred there, not claimed here.
**Scope:** Step 1 — the syntactic-value list gains references and record literals (§2); the reframed rationale — the value restriction is Hexagon's monomorphism restriction (§3); Step 2 — the relaxed value restriction, with the unconstrained clause (§4); the variance analysis (§5); variance and `export opaque`: declared claims, bare-means-invariant, the over-claim error (§6); the intrinsic parametricity obligation (§7); tooling surfaces (§8); rejected alternatives (§9); the edit-notes ledger (§10); implementation notes for `hexc` (§11); the decisions log (§12).
**Not in scope:** Higher-kinded types, monomorphic recursion (Functions §7.4), the no-currying and rank-1 decisions — all verified untouched (§4.6). The hover-conflation and diagnostic-misattribution defects (#206 — independent compiler/LSP work; §8.3 records why this ruling raises their stakes). FFI Part 4 §12.4's deferral of generic foreign externs — the *coupling* is recorded (§3, §4.2, §10), the deferral itself is unchanged.
**Companions:** Functions §4.1–§4.2.1, §7, §8 (host of Step 1 and Step 2's operative rules); Modules §4.2 (host of the variance-claim semantics — new §4.2.1 there); Declarations Preamble §2.1 (host of the sigil grammar); Statements & Mutability §6.2/§6.4; Constraints §6; Numeric Literals §3/§5; `intrinsics.md` §3.4/§4.2; FFI Part 4 §12.4; Loops §6.4 (`memoize`).

---

## 1. The ruling

> **Step 1 (SML parity).** Functions §8.2's syntactic-value list gains: a **reference — possibly module-qualified — to an immutable term binding**, and a **record literal whose field values are values** (repairing an omission the stdlib already leans on). A `var` read is not on the list (§2.3). Both of the motivating snippets compile (§2.5).
>
> **The rationale, corrected.** The value restriction is load-bearing in Hexagon — but as **Hexagon's monomorphism restriction**, protecting constraint coherence under the evaluate-once rule, not as armor against a mutation hole that Hexagon cannot even express (§3). Functions §8.2's rationale text is replaced.
>
> **Step 2 (the relaxed value restriction).** A `let` RHS that is not a syntactic value still generalizes **exactly those type variables that are unconstrained and covariant-only** in the binding's inferred type, per variable, levels admitting as always (§4). The unconstrained clause is Hexagon's own addition to Garrigue's rule, and it is load-bearing (§4.3).
>
> **Variance.** Transparent types get inferred variance — the definition is public, the computation leaks nothing (§5). Parameterized `export opaque` types take **declared claims**: `+a` covariant, `-a` contravariant, **bare `a` invariant — the empty claim, and legal** (§6). Claims are verified against the representation in the home module; an unsupportable claim is a hard error at the declaration naming a witness occurrence. Nothing crosses an opaque boundary that the author did not write.
>
> **Intrinsics.** Generic intrinsics take a parametricity obligation making their declared schemes' variance semantically true (§7) — the third leg of Step 2's soundness.

### 1.1 The program

James, on hitting the original rejection: *"If code works in OCaml and SML and fails in Hexagon, this is a sign that I have wandered off the path somewhere."* Hexagon's §8.2 list was SML '97's non-expansive list with variables deleted; this ruling puts them back, then takes the OCaml step too. The empty-sequence program — the exact shape a JavaScript developer writes on day one — is the acceptance test:

```hexagon
let e = empty
let ys = cons(42n, e)
let xs = cons("Briar", e)      -- accepted after Step 1
```

### 1.2 Provenance, and what the review corrected

The analysis note (`notes/value-restriction-and-variance.md`) supplied the ladder, the §12.4 coupling, the opacity principle, and the verified reproductions; it is adopted where this document cites it. The in-session review (Fable, 2026-08-01) corrected three of its claims, and the corrections are part of this ruling:

1. **The "no dictionaries" claim was wrong.** Constraints §6.1 compiles constrained functions with a trailing evidence suffix; monomorphic erasure is the call-site norm, not the whole mechanism. The note's `let x = 42` evidence proves only that *literal* elaboration (`fromNat(payload)`, lexer-range-capped — Numeric Literals §3) is per-use re-runnable and exact. That property is special to syntactic values, and §3 below is built on the distinction.
2. **Step 2 was missing a clause.** Garrigue's ⊥-subsumption argument does not extend to constrained variables — there is no least `Num` type, and evidence must come from somewhere. OCaml never faces this (no type classes). Without the unconstrained clause, Step 2 reopens the §3 dilemma on day one.
3. **The note's SML-comparison table overstated Functions §8.2 on records** (its Hexagon column was not among its verified claims). §8.2's actual list had no record-literal row, while `Seq.hex`'s own `empty` is `Seq({ pull = ... })` — a constructor applied to a record literal. §2.4 repairs the list; whether the v1 implementation already conformed to the repaired or the written list is a conformance question (§11.1), deliberately left to the test suite rather than asserted here.

**Verified in this ruling:** every spec quotation, against the current corpus. **Not verified here:** implementation behavior beyond what the note itself reproduced (its §1 lists what was run); §11's conformance items exist precisely because this document declines to assert them.

---

## 2. Step 1: the value list, completed

### 2.1 The rule

Functions §8.2's syntactic-value list becomes (normative text, applied to the host in this PR):

> a lambda literal, a literal, a **reference — possibly module-qualified — to an immutable term binding** (a `let`, a `fun`, a parameter, a pattern binder, or an import; never a `var` read, §2.3), a constructor application of values, a **record literal whose field values are values**, or a tuple of values.

"Possibly module-qualified" is load-bearing: SML's non-expansive category is the *long* identifier, and `let e = Seq.empty` must generalize for the same reason `let e = empty` does. A qualified reference resolves through Modules §5.1 to the same imported binding; the value test reads the resolution, not the punctuation — the same posture as §8.2's existing read-through rule for parentheses and layout.

### 2.2 Why this is sound, including for constrained bindings

A reference evaluates nothing — it is a lookup of an already-bound immutable value. The two classical hazards:

- **Allocation:** impossible. A reference manufactures no state; there is nothing fresh to share unsoundly. (SML includes variables for exactly this reason; Hexagon's deletion of the row bought no soundness — §9.1.)
- **Sharing:** guarded by **levels**, which Functions §8 already mandates ("Algorithm J with … level-based generalization"). Generalization quantifies only variables not free in the environment; `(x) => { let e = x; ... }` quantifies nothing, because `x`'s variable belongs to the environment. The restriction guards allocation, levels guard sharing, and a reference allocates nothing. (§11.1 makes the alias case a required conformance test rather than an assumption about the implementation.)

Constrained bindings ride along soundly, and this deserves its sentence because it is where Step 2 will *not* ride along: a reference shares the **unapplied entity**. `let y = x` where `x : Num a => a` aliases the literal's payload constant; `let g = f` where `f` is a constrained function aliases the evidence-suffix-taking function value (Constraints §6.1). No evidence is discharged at the binding, so nothing is computed at one representation and reused at another. The generalized alias is exactly as polymorphic, and exactly as cheap, as the original.

### 2.3 `var` reads stay expansive

A `var` read is not on the list. Doctrine: a syntactic value is code whose meaning does not depend on when it runs (§8's closing symmetry with hoisting); a `var` read is a state observation and fails that test by definition. Recorded to prevent re-litigation as an inconsistency: levels would protect the typing anyway (the `var`'s monotype lives in the environment — Statements §6.1, Functions §8.4), so this exclusion is doctrine hygiene, not a soundness necessity. It also keeps §8.4 ("`var` never generalizes") free of exceptions at one remove.

### 2.4 The record repair

The written list omitted record literals while the corpus's own stdlib leaned on them: `export let empty: Seq(a) = Seq({ pull = () => None })` is a constructor application **of a record literal**, and every module-level producer in `Seq.hex` has that shape. The repaired list names record literals explicitly, with the same recursive condition as tuples (field values must be values). A conformance correction record entry goes in Functions §12 (ledger, §10); the test suite must pin the behavior on both the bare record literal (`let r = { pull = () => None }`) and the constructor-wrapped shape (§11.1).

### 2.5 The motivating snippets, worked

- `let e = empty` — RHS is a reference to `Seq.empty`, a value; `e : Seq(a)` generalized; `ys` and `xs` instantiate independently. Accepted.
- `let e: Seq(a) = empty` — the annotation makes `a` rigid *while the RHS is checked* (Functions §4.1); quantification happens *after, at the binding* (§4.2.1 states this composition for `id`). The RHS is a value under §2.1, so the binding generalizes for the same reason the unannotated form does. This is a confirmation of existing composition, not a new rule — the note's question 3, answered as it recommended: **confirm, do not decide** (conformance test, §11.1).
- **Constraint-member references:** if a bare, unapplied constraint member is a legal term at all, its reference is non-expansive like any other and sound by §2.2's aliasing argument. Whether it *is* a legal term belongs to Constraints §2.2's call-style rules; this ruling neither opens nor closes that door (edit note recorded, §10).

---

## 3. The rationale, corrected: this is Hexagon's monomorphism restriction

Functions §8.2's rationale text claimed the restriction guards against "mutation and effects", naming `var` and effectful FFI calls as occupants of the classic ML hole. Neither occupies it:

- **The mutation hole is inexpressible.** Statements §6.4: no ref cells, no mutable fields, no module-level `var`; §6.2: a lambda may neither read nor assign an outer `var`. `val r = ref []` has no Hexagon spelling — the hole is not guarded, it is absent.
- **No foreign call returns a type containing a variable.** FFI Part 4 §12.4 makes every foreign extern declaration monomorphic in v1, so "effectful FFI calls" cannot produce a generalizable variable either. **Coupling, recorded both ways:** §12.4 is a deferral, not a permanence; lifting it must revisit this section and §4.2's soundness legs, and parameterized extern types — opaque by construction — must then take §6's declared claims, bare meaning invariant (edit note, §10).

What the restriction actually guards is the coexistence of two commitments the corpus makes elsewhere:

- **Evidence lives only in genuinely polymorphic functions** (Constraints §6.1); monomorphic code erases dictionaries entirely.
- **A binding's RHS evaluates exactly once**, at its textual position (Functions §9; Statements doctrine).

Generalize an expansive constrained binding — `let y = double(42)` at `Num a => a` — and one of the two must break: either the once-computed value is shared across instantiations at several representations (**incoherent**: the computation is representation-sensitive — overflow and precision differ between `Int` and `BigInt`), or the binding abstracts over evidence and re-evaluates per use (**observable**: effects and cost multiply; Haskell's exact disease, the one its monomorphism restriction exists to contain). The value restriction is what makes the dilemma unreachable: it is **Hexagon's monomorphism restriction**, and Hexagon needs no second one.

Why `let x = 42` is not a counterexample, precisely: a literal is a syntactic value, its elaboration is `fromNat(payload)` re-run per use (Numeric Literals §5's contextual selection), and the lexer's range cap (`0 <= k <= 2^53 - 1`, Numeric Literals §3) keeps every instance's `fromNat` total *and exact*. Per-use re-elaboration of a range-guarded payload is coherent; per-use conversion of an arbitrary computed result is not. That line — between re-runnable elaboration and already-run computation — is the value restriction, stated semantically.

The replacement rationale text is applied to Functions §8.2 in this PR (ledger, §10). The old text's workaround sentence survives unchanged: call the producer where the element type is known, or annotate.

---

## 4. Step 2: the relaxed value restriction

### 4.1 The rule

> At a `let` binding whose RHS is **not** a syntactic value, generalization is **per-variable**: quantify exactly those type variables of the binding's inferred type that
>
> (a) are **unconstrained** — no constraint in the binding's residual constraint set mentions the variable, directly or through a variable it has been unified with;
> (b) are **covariant-only** — every occurrence in the binding's inferred type is in a covariant position under §5's analysis (transparent constructors by inference; opaque constructors by their declared claims, §6; `->` flips its argument);
> (c) pass **level admission** — not free in the environment, exactly as for values.
>
> Every other variable stays an unsolved monomorphic `?n`, first-use-pins-it, exactly as before. Applied to Functions §8 as new item 7 (ledger, §10).

`fun` bindings are untouched — their RHSs are always lambdas (Functions §7.1), always values.

### 4.2 Soundness, and its three legs

The argument is Garrigue's (relaxed value restriction, 2004): a value whose type mentions `?1` only covariantly and only unconstrained already *has* type `T[⊥]` — nothing in it can produce or consume a `?1` — and covariant subsumption gives `T[a]` for every `a`; quantification is therefore semantically free. In Hexagon the "nothing can produce one" premise rests on three legs, each normative:

1. **Parametricity of pure Hexagon code.** A pure producer typed `() -> Vector(a)` can construct no element (it can only throw or diverge, Exceptions notwithstanding — no value at type `a` is ever produced).
2. **Monomorphic foreign externs** (FFI Part 4 §12.4). No foreign call returns a type containing a variable, so the boundary cannot smuggle an element in at a type the checker never saw. Lifting §12.4 must revisit this rule — the coupling of §3, restated because this is where it bites.
3. **Intrinsic parametricity** (§7). Generic intrinsics are the one trusted genericity in v1; the obligation makes their declared variance semantically true.

### 4.3 The unconstrained clause (decided; do not re-litigate)

Clause (a) is not in Garrigue's rule because OCaml has nothing for it to say: no type classes, no evidence. Hexagon must add it, and it is load-bearing: a constrained variable occurs covariantly at the root of `Num ?1 => ?1`, so the variance test alone would generalize `let y = double(42)` — straight into §3's dilemma (no least `Num` type for the ⊥ argument; no evaluation point for the evidence). Constrained variables at expansive bindings never generalize. The workaround is §3's, unchanged: bind where the type is known, or annotate.

### 4.4 Worked examples

- `let xs = makeEmpty()` with `makeEmpty : () -> Vector(a)` — `?1` unconstrained, covariant-only (`Vector` transparent-or-claimed `+`), not free in the environment: **generalizes**. §8.2's own former counterexample compiles; this is the case SML also rejects, and the reason Step 2 exists.
- `let y = double(42)` — `?1` constrained (`Num`): **declined** per §4.3; defaulting proceeds as today (Numeric Literals, defaulting).
- `let m = memoize(e)` where `e : Seq(a)` generalized — `Seq` claims `+a` (§5.5, §11.4), `seqMemoize` is parametric (§7): **generalizes**. The memoized spine shared across instantiations can hold only values pulled from a source that, by parametricity, never produced any.
- The multi-item block (Functions §8.2's `lookup` example) — still not a value (blocks of more than one item are not read through, unchanged), so item 7 governs: with `lookup : ?k -> ?v`, the argument variable `?k` occurs contravariantly and is **declined** (first use pins it); `?v` occurs covariantly, is unconstrained, and **generalizes** — soundly, because the once-loaded table, typed with no known element type, can contain no elements (leg 1). Partial generalization is the intended reading of "per-variable" (§4.5). The host example's annotation changes accordingly (ledger, §10).

### 4.5 Per-variable, not all-or-nothing

A binding may end up with a scheme quantifying some variables while others sit unsolved awaiting their first use. This is the behavior OCaml users already live with, and it is the reason #206 (display of quantified vs unsolved variables) graduates from annoyance to teachability requirement — recorded there, not solved here.

### 4.6 What Step 2 does not touch (verified)

- **Rank-1**: generalization still produces outermost-`forall` schemes only; nothing here builds a `forall` left of an arrow; Functions §4.2's position restriction is untouched.
- **Monomorphic recursion** (Functions §7.4): constrains the knot inside an SCC before generalization; untouched.
- **No currying / n-ary arity**: about function shape and emission; orthogonal.
- **Higher-kinded types**: the variance analysis ranges over the fixed, fully applied constructors of §5; no abstraction over constructors is introduced anywhere in this ruling.

---

## 5. The variance analysis

### 5.1 The lattice and the rules

Per constructor parameter, one of four points: **unused**, **covariant** (`+`), **contravariant** (`−`), **invariant** (`±`, both). Occurrences are classified by sign, starting at `+` for the type's root:

- `s -> t`: `t` keeps the current sign; each parameter type in `s` **flips** it.
- Tuple components, record fields, and union constructor payloads keep the current sign (all Hexagon data is immutable; there is no field position that reads *and* writes).
- `T(t1, …, tn)`: each `ti`'s occurrences take the current sign **multiplied** by `T`'s variance in that slot (`+` preserves, `−` flips, `±` makes every occurrence beneath it invariant, unused erases).
- Aliases are transparent (Preamble §4): expand, then classify.
- Recursive nominal types: least fixpoint — start every parameter at *unused*, re-classify until stable. Termination is immediate from the four-point lattice's finite height.

A parameter's variance is the join of its occurrence signs; a parameter occurring both `+` and `−` is `±`.

### 5.2 What Hexagon's restrictions buy the analysis

The only source of `−` is function-argument position, because Statements §6.4 leaves the language **no mutable type constructor** — the classic source of forced invariance (a readable-writable cell) does not exist. The only source of `±` is a parameter genuinely occurring on both sides of an arrow (`type Endo(a) = a -> a`). The analysis is accordingly small: signs, multiplication, one fixpoint.

### 5.3 Where each constructor's variance comes from

| constructor | variance |
|---|---|
| transparent `record` / `union` / `type` alias | **inferred** from the definition — it is public; the computation leaks nothing a reader could not derive |
| parameterized `export opaque` | the **declared claim** (§6) — used uniformly by every module, the home module included |
| extern types | v1: monomorphic (FFI Part 4 §12.4) — no parameters, no question. Forward rule, recorded now: if parameterized extern types are ever admitted, they are opaque by construction and take declared claims, bare meaning invariant |
| intrinsically implemented opaque types (`Seq`, the collection companions) | the declared claim, like any opaque type — made semantically honest by §7's obligation |

### 5.4 What variance is *not* (James's question, 2026-08-01, answered normatively)

Variance is a property of the **constructor**, fixed once at its declaration — it is not part of any type expression. Use sites, annotations included, always write `Seq(a)`, never `Seq(+a)` (parse error, Preamble §2.1): there is no "dropping" a sigil at an annotation, because no annotation ever carries one. `let x: Seq(a) = y` is therefore an ordinary annotated binding — `a` rigid while the RHS is checked, generalized at the binding (Functions §4.2.1's composition) — and `Seq`'s covariance participates in it not at all. The analysis answers **exactly one question — may this variable be generalized (Functions §8.7's clause (b), and §6.3's verification)** — and introduces **no subtyping**: unification remains equality-based, `Seq(Nat)` and `Seq(Int)` remain unrelated types, and no value is ever implicitly coerced between instantiations. (Garrigue's ⊥-subsumption is the *soundness argument* for quantifying, not a coercion the checker performs.)

### 5.5 Worked: `Seq`

```
Seq(a) = { pull: () -> Option((a, Seq(a))) }
```

Field `pull` at `+` → function *result* keeps `+` → `Option` covariant (transparent union, inferred) → tuple components keep `+` → `a` at `+`, and the recursive `Seq(a)` occurrence stabilizes at the fixpoint. **`a` is covariant in `Seq`**; the stdlib declares the claim (`Seq(+a)`) in the sweep this ruling schedules (§11.4).

---

## 6. Variance and `export opaque`: declared claims

### 6.1 Grammar (host: Declarations Preamble §2.1)

A type parameter may carry a **variance sigil** — `+a` (covariant claim) or `-a` (contravariant claim) — **only when the declaration is `export opaque`**:

```hexagon
export opaque record Seq(+a) = { pull: () -> Option((a, Seq(a))) }
export opaque record Sink(-a) = { accept: a -> Log }
export opaque record Registry(k, +v) = ...      -- claims are per-parameter
```

- On a transparent `record`/`union`, or on `type`: parse error — "variance is inferred for transparent types; remove the `+`" (Rewrite Rule form; the sigil buys nothing the public definition doesn't already say — §9.6).
- A sigil is **not** a constraint; Preamble §2.2's rejection of constrained header parameters (`record Sorted(a: Ord)`) is untouched, and `<>` still never appears in a data-declaration header.
- Use sites are unchanged: `Seq(Int)`, never `Seq(+Int)` — the sigil is declaration syntax only.

### 6.2 Bare means invariant: the empty claim

A bare parameter on an opaque declaration is legal and claims nothing: outside the home module the parameter is treated as **invariant**. This is the `derives` doctrine applied to the next capability, and the two sentences of Modules §4.2 that decide it are quoted because they are the whole argument: an opaque type is "a black box" whose opacity "hides *structure*, not *capabilities*" — and every capability that crosses today (`derives`, arity) crosses because **the author wrote it**. The principle, now stated once and owned here:

> **What crosses an opaque boundary must be declared, not inferred.**

Inferred variance would violate it with a concrete cost: `Seq` is covariant today; add one private `consume: a -> Unit` field and every *client module's* generalization behavior changes, silently — a private representation edit with downstream type consequences is precisely the "fake abstraction" Modules §4.2 refuses, arriving by another door.

### 6.3 Verification, and the over-claim error

The home module sees the full definition ("derivation happens in the home module, where nothing is hidden" — the same sentence funds this), so the compiler computes the true variance per §5 and checks every claim at the declaration:

- `+a` is legal iff every occurrence of `a` in the representation is covariant (computed *unused* or `+`).
- `-a` is legal iff every occurrence is contravariant (computed *unused* or `−`).
- Bare is always legal.

An unsupportable claim is a **hard error at the declaration, naming a witness occurrence**:

> `a` cannot be declared covariant in `Seq`: field `consume` uses `a` in argument position (Seq.hex:31). Remove the `+`, or change the field.

This is the design's teaching surface as much as its safety surface: the author who cannot state variance theory is shown the exact line that blocks the claim, at the moment it matters, with both legal exits named (Rewrite Rule, Preamble §1.1). A later representation edit that violates a standing claim errors **here**, at the author's declaration — never downstream in a stranger's module. Declaring *less* than the representation supports is legal everywhere and forever: under-claiming reserves the right to add the `consume` field later.

### 6.4 Claims are used uniformly, home module included

Every consumer of the constructor — Step 2's covariance test above all — reads the **declared claim**, inside and outside the home module alike. The home module gets no private view: a program must not compile in its home module and fail identically-written elsewhere. (The computed variance is used exactly once, for §6.3's verification.)

### 6.5 Emission note (recorded, not applied)

TypeScript has had declaration-site variance annotations since 4.7 (`out T` / `in T`); the `.d.ts` face of an exported opaque type may carry them, mapped from the declared claims. FFI Part 7 owns `.d.ts` mechanics; edit note recorded (§10), applied on next touch there.

---

## 7. The intrinsic parametricity obligation

Host: `intrinsics.md` §4.2's verification list gains a fourth commitment (ledger, §10):

> **Parametricity is part of the contract.** A generic intrinsic's implementation may move, store, and return values at its type parameters; it must never fabricate them, coerce them, or inspect them by type. Consequence: the variance of the declared scheme is semantically true of the implementation — the third leg of the relaxed rule's soundness (Functions §8.7).

Why it must be written: §5's analysis reads the Hexagon-visible definition, and intrinsics are exactly the values the checker trusts *beyond* that definition (`intrinsics.md` §3.4 grants them the genericity §12.4 denies the foreign boundary). A stateful generic intrinsic that stored values at one instantiation and surfaced them at another would make a `+` claim a lie no analysis could catch. **Audit record (2026-08-01):** the v1 inventory passes — `seqMemoize`, the sharpest case (stateful, generic, covariant result), stores in its spine only values pulled from its source, which is monotone; the collection-companion operations are element-transporting throughout. A new inventory entry accepts this obligation alongside key and arity verification.

---

## 8. Tooling surfaces

### 8.1 The over-claim error

§6.3's text, rows added to the Preamble and Modules diagnostics checklists (ledger, §10). The witness occurrence — constructor field, position, line — is required content, not garnish.

### 8.2 The under-claim affordance is the LSP's, not the compiler's

Hexagon has **no warning tier** (Preamble §1.1), and an under-claim is not wrong — it is the empty claim, chosen or not. The affordance therefore lives in the LSP as an information-level code action on the declaration, offered when a bare parameter's computed variance is `+` or `−`:

> `a` is covariant in `Seq`'s representation — declare `Seq(+a)` to let client code like `let e = Seq.empty` stay polymorphic.

Phrased in **consequences, not lattice vocabulary**; one keystroke to apply, because the fix text is the computed truth the compiler already holds from §6.3's machinery. Hover on a parameterized opaque type's parameter shows both facts: the declared claim, and the representation's computed variance.

### 8.3 The display debt this ruling raises (recorded; owned by #206)

Step 2's per-variable outcome (§4.5) means one binding can carry quantified, unsolved, and rigid variables at once — three behaviors that today all render as `a`. #206 owns the fix (hover differentiation, and the pinned-by-use diagnostic pointing at the pinning use rather than "the body"); Functions §10 gains the normative diagnostic row in this PR so the message contract is fixed even before the implementation moves.

---

## 9. Rejected alternatives (do not re-litigate)

1. **Keeping variables off the value list** (status quo ante). The deletion from SML's list bought nothing: allocation is impossible for a reference, sharing was already levels' job, and the cost was rejecting the first program every newcomer writes.
2. **`+` as the default claim on opaque parameters.** A default is an inferred commitment: every author silently ships the maximal API contract, and the later `consume` field becomes a breaking change nobody signed. The strong claim must be opt-in.
3. **Mandatory sigils (bare as an error) on parameterized opaque exports.** Forces an invariance spelling into existence that no precedent language needed (OCaml, Scala, C#, TS all spell invariance as *nothing*); breaks the `derives` analogy, where absence of a claim is legal and means "capability not granted"; breaks every existing parameterized opaque export; buys no soundness — under-claiming is safe. The LSP affordance (§8.2) recovers the discoverability that mandatoriness was for.
4. **Inferred variance through `opaque`.** Fake abstraction (§6.2): private edits with downstream type consequences, the exact failure Modules §4.2 exists to refuse.
5. **Generalizing constrained variables at expansive bindings** (Step 2 without §4.3). The §3 dilemma: representation-incoherence or observable re-evaluation. Haskell's wart, imported wholesale.
6. **Sigils on transparent declarations as checked documentation.** Redundant surface — the definition is public and the inference is total; a second spelling of a derivable fact invites drift and buys a parse rule.
7. **A monomorphism restriction instead of (or alongside) the value restriction.** Redundant: §3 shows the value restriction already *is* Hexagon's; Haskell needs a separate MR only because laziness denies it a usable value restriction.

---

## 10. Edit-notes ledger

Applied in this PR:

- **`functions.md`** — §8 item 2: the completed value list (§2.1) and the corrected rationale (§3), revised in place with dated markers; the multi-item-block passage's outcome annotation updated (§4.4); new item 7: the relaxed rule (§4.1, with the soundness legs and the do-not-relitigate clause); the closing hoisting-symmetry sentence adjusted (*full* generalization is the privilege of values); §10: the pinning-use diagnostic row (§8.3); §12: conformance correction record entry for the record-literal omission (§2.4).
- **`modules.md`** — new §4.2.1: variance claims (§6.1–§6.5 semantics; grammar pointer to the Preamble); §10: the over-claim error row; §14: decisions-log rows.
- **`declarations-preamble.md`** — §2.1: the sigil grammar bullet (§6.1), including the not-a-constraint clarification against §2.2; diagnostics table: the sigil-on-transparent and over-claim rows.
- **`intrinsics.md`** — §4.2: the parametricity commitment and audit record (§7); §13: decisions-log row.
- **`README.md`** — authority rule 3: this document added to the closure-document list.
- **`notes/value-restriction-and-variance.md`** — status line updated: ruled here; retained as provenance with its three corrections named.

Recorded here, applied on next touch of the target (authority rule 4):

- **`ffi-part4-extern-bindings.md` §12.4 / §11 item 7** — lifting the generic-extern deferral must revisit §3's rationale and §4.2's soundness legs; parameterized extern types, if admitted, take declared variance claims, bare meaning invariant (§5.3).
- **`constraints.md` §6.1** — the property "dictionary records appear only inside genuinely polymorphic functions" is protected by Functions §8's restriction; add the cross-reference (§3).
- **`constraints.md` §2.2** — if bare unapplied member references are ever ruled terms, note §2.5's non-expansiveness rider here.
- **`ffi-part7`** (`.d.ts` mechanics) — declared claims may emit TypeScript `out`/`in` (§6.5).
- **`loops-ranges-iteration.md` §6.4** — `memoize`'s bullet may cite the §7 audit record.

---

## 11. Implementation notes for `hexc` (not this PR; umbrella issue to follow #205)

### 11.1 Step 1 (checker; small)

Extend the syntactic-value test per §2.1. Required conformance tests, each currently an assumption this document declined to make: (i) the two motivating snippets; (ii) the module-qualified form `let e = Seq.empty`; (iii) the annotated form `let e: Seq(a) = empty` (§2.5's composition); (iv) a bare record-literal RHS and the constructor-wrapped `Seq({...})` shape (§2.4 — pin whether the shipped checker already conformed to the repaired list); (v) the levels guard: `(x) => { let e = x; ... }` must quantify nothing; (vi) a constrained alias `let y = x` at two representations emitting one shared payload with per-use elaboration.

### 11.2 Step 2 (checker + parser; the real work)

Variance computation per §5 (memoized per declaration; fixpoint over SCCs of the type-declaration dependency graph); the per-variable relaxed generalization in Algorithm J's bind rule (§4.1's three clauses); the Preamble sigil grammar and its two parse errors; §6.3's verification with witness capture (span of the blocking occurrence). Emission is untouched: generalization is types-only, and unconstrained variables carry no evidence by construction.

### 11.3 LSP

§8.2's code action and hover; both read the same computed-variance table as §6.3. #206 is separate work but shares the classifier.

### 11.4 Stdlib sweep

Declare claims on the parameterized opaque exports (`Seq(+a)`, `Vector(+a)`, the Map/Set family per their representations' actual variance — computed, then declared, then reviewed). Small, mechanical, and a natural first exercise of §8.2's code action. Sequenced after Step 2 lands in the checker.

---

## 12. Decisions log

| Decision | Where |
|---|---|
| Value list gains references (module-qualified included) and record literals; `var` reads stay expansive | §2 |
| Rationale corrected: the value restriction is Hexagon's monomorphism restriction — constraint coherence under evaluate-once; mutation hole inexpressible; §12.4 coupling recorded both ways | §3 |
| Relaxed rule: expansive bindings generalize unconstrained, covariant-only, level-admitted variables, per-variable | §4.1 |
| The unconstrained clause is load-bearing and Hexagon's own; constrained variables never generalize at expansive bindings | §4.3 |
| Soundness legs: parametricity, monomorphic foreign externs, intrinsic parametricity | §4.2, §7 |
| Variance: four-point lattice, sign multiplication, fixpoint; `−` only from argument position (no mutable constructors) | §5 |
| Transparent types infer; opaque types declare; claims used uniformly, home module included | §5.3, §6.4 |
| Sigils `+a`/`-a` legal only on parameterized `export opaque`; bare = invariant = the empty claim (the `derives` doctrine); not mandatory, not defaulted | §6.1–§6.2, §9.2–§9.3 |
| Over-claim: declaration-site hard error naming a witness occurrence; under-claim: legal, LSP code action, no warning tier | §6.3, §8.2 |
| What crosses an opaque boundary must be declared, not inferred | §6.2 |
| James's directives, in-session 2026-08-01: `Seq(+a)` spelling reads fine; simplification resolved as bare-means-invariant; LSP quickfix adopted | §6, §8.2 |
