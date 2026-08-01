# Hexagon Spec: Decisions — Generalization Relaxed, and Declared Variance

**Status:** Decided (ruling on issue #205, 2026-08-01). Fable's spec ruling under the ML-dialect doctrine (`decisions-ml-dialect-bool-2026-07.md` §1), commissioned by James in-session 2026-08-01 ("ML nature, here we come"). Provenance: `notes/value-restriction-and-variance.md` (Opus's analysis, James's framing), adopted where cited and corrected where the in-session review found it wrong (§1.2). Authoritative until consolidated into the host specs, per README authority rule 3 — this document is added to rule 3's closure-document list in this same PR; the standing is conferred there, not claimed here.
**Scope:** Step 1 — the syntactic-value list gains references and record literals (§2); the reframed rationale — the value restriction is Hexagon's monomorphism restriction (§3); Step 2 — the relaxed value restriction, with the unconstrained clause (§4); the variance analysis and the **compiler-side claim table** for constructors without declaration sites (§5); variance and `export opaque`: declared claims, bare-means-invariant, the over-claim error (§6); the intrinsic parametricity obligation (§7); tooling surfaces (§8); rejected alternatives (§9); the edit-notes ledger (§10); implementation notes for `hexc` (§11); the decisions log (§12); the implementation-question rulings, added 2026-08-01 under #207 (§13).
**Not in scope:** Higher-kinded types, monomorphic recursion (Functions §7.4), the no-currying and rank-1 decisions — all verified untouched (§4.6). The hover-conflation and diagnostic-misattribution defects (#206 — independent compiler/LSP work; §8.3 records why this ruling raises their stakes), and the invalid-`.d.ts` defect for polymorphic non-function bindings (#132 — pre-existing, stakes likewise raised; §11.2). FFI Part 4 §12.4's deferral of generic foreign externs — the *coupling* is recorded (§3, §4.2, §10), the deferral itself is unchanged.
**Companions:** Functions §4.1–§4.2.1, §7, §8 (host of Step 1 and Step 2's operative rules); Modules §4.2 (host of the variance-claim semantics — new §4.2.1 there); Declarations Preamble §2.1 (host of the sigil grammar); Statements & Mutability §6.2/§6.4; Constraints §6; Numeric Literals §3/§4/§5; `intrinsics.md` §3.3/§3.4/§4.2/§9 (the non-declared types, the trust argument, the self-declaration schedule that retires table rows); FFI Part 1 §3.1, Part 2, Part 10 (the borrowed-view classification, §5.3), Part 4 §12.4; `runtime/VectorTrie.hex` (the `Vector(+a)` derivation); Loops §6.4 (`memoize`).

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

Constrained bindings ride along soundly, and this deserves its sentence because it is where Step 2 will *not* ride along: a reference shares the **unapplied entity**. `let y = x` where `x : Num a => a` aliases the literal's payload constant; `let g = f` where `f` is a constrained function aliases the evidence-suffix-taking function value (Constraints §6.1). No evidence is discharged at the binding, so nothing is computed at one representation and reused at another. The generalized alias is exactly as polymorphic, and exactly as cheap, as the original. *(The emitted shape of the constrained alias is normative since 2026-08-01 — Constraints §6.1, §13.3 here.)*

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

Why a polymorphic literal binding is not a counterexample, precisely: a literal is a syntactic value, its elaboration is `fromNat(payload)` re-run per use (Numeric Literals §5's contextual selection), and the lexer's range cap (`0 <= k <= 2^53 - 1`, Numeric Literals §3) keeps every instance's `fromNat` total *and exact*. Per-use re-elaboration of a range-guarded payload is coherent; per-use conversion of an arbitrary computed result is not. That line — between re-runnable elaboration and already-run computation — is the value restriction, stated semantically. (One care in choosing the demonstration: `Num` alone is defaultable, so bare `let x = 42` may be resolved to `Int` by Numeric Literals §4 before any of this is observable — the case that *exhibits* the mechanism is a literal under a non-defaultable constraint. The mechanism, not the specimen, carries the argument.)

The replacement rationale text is applied to Functions §8.2 in this PR (ledger, §10). The old text's workaround sentence survives unchanged: call the producer where the element type is known, or annotate.

---

## 4. Step 2: the relaxed value restriction

### 4.1 The rule

> At a `let` binding whose RHS is **not** a syntactic value, generalization is **per-variable**: quantify exactly those type variables of the binding's inferred type that
>
> (a) are **unconstrained** — the variable does not occur free in the argument of any constraint in the binding's residual constraint set;
> (b) are **covariant-only** — every occurrence in the binding's inferred type is in a covariant position under §5's analysis (transparent constructors by inference; opaque constructors by their declared claims, §6; `->` flips its argument);
> (c) pass **level admission** — not free in the environment, exactly as for values.
>
> Every other variable stays an unsolved monomorphic `?n`, first-use-pins-it, exactly as before. Applied to Functions §8 as new item 7 (ledger, §10).

Clause (a) reads *occurrence in the constraint's argument*, compound arguments included: `Show(Vector(?1))` constrains `?1`. A variable occurring **only** in a constraint and not in the binding's type at all is not item 7's case in either direction — that is the ambiguity path (Numeric Literals §6), unchanged by this ruling.

**Annotated expansive bindings.** An annotation's variables are rigid while the RHS is checked (Functions §4.1) and quantify at the binding (§4.2.1's composition); at an expansive binding the quantification step is item 7's, so a rigid variable is subject to the same three clauses. If every annotation variable passes, the binding generalizes and the annotation is satisfied — `let xs: Vector(a) = makeEmpty()` works exactly like its unannotated form. If any is **declined**, the binding is a **hard error at the declaration** — a rigid variable can neither be quantified nor pinned by a use — in Functions §4.1's existing diagnostic family, naming the clause that actually fired: "`a` is a declared type variable, but this right-hand side is a computation that cannot be generalized in `a` (`a` is constrained by `Num`)" — or, for clause (b), "(`a` occurs in argument position)" — "; bind where the type is known, or remove the annotation." The export consequence, since Modules §4.1.1 makes signatures mandatory there: an exported expansive binding whose variable item 7 declines has **no legal signature** — the same error fires, and its rewrite is the same two exits. Conformance items in §11.1.

`fun` bindings are untouched — their RHSs are always lambdas (Functions §7.1), always values.

### 4.2 Soundness, and its three legs

The argument is Garrigue's (relaxed value restriction, 2004): a value whose type mentions `?1` only covariantly and only unconstrained already *has* type `T[⊥]` — nothing in it can produce or consume a `?1` — and covariant subsumption gives `T[a]` for every `a`; quantification is therefore semantically free. In Hexagon the "nothing can produce one" premise rests on three legs, each normative:

1. **Parametricity of pure Hexagon code.** A pure producer typed `() -> Vector(a)` can construct no element — it can only throw or diverge, and neither produces a value at type `a`. Exceptions are not a side door: their payloads admit no type variables (Exceptions §2), so nothing polymorphic rides one out.
2. **Monomorphic foreign externs** (FFI Part 4 §12.4). No foreign call returns a type containing a variable, so the boundary cannot smuggle an element in at a type the checker never saw. Lifting §12.4 must revisit this rule — the coupling of §3, restated because this is where it bites.
3. **Intrinsic parametricity** (§7). Generic intrinsics are the one trusted genericity in v1; the obligation makes their declared variance semantically true.

### 4.3 The unconstrained clause (decided; do not re-litigate)

Clause (a) is not in Garrigue's rule because OCaml has nothing for it to say: no type classes, no evidence. Hexagon must add it, and it is load-bearing: a constrained variable occurs covariantly at the root of `Num ?1 => ?1`, so the variance test alone would generalize `let y = double(42)` — straight into §3's dilemma (no least `Num` type for the ⊥ argument; no evaluation point for the evidence). Constrained variables at expansive bindings never generalize. The workaround is §3's, unchanged: bind where the type is known, or annotate.

### 4.4 Worked examples

- `let xs = makeEmpty()` with `makeEmpty : () -> Vector(a)` — `?1` unconstrained, covariant-only (`Vector(+a)` by the compiler-side claim table, §5.3), not free in the environment: **generalizes**. §8.2's own former counterexample compiles; this is the case SML also rejects, and the reason Step 2 exists. The outcome is contingent on the table row — a compiler-known type without a row or claim is invariant, and item 7 declines its variables.
- `let y = double(42)` — `?1` constrained (`Num`): **declined** per §4.3. **Defaulting and item 7, ruled here:** a clause-(a)-declined variable is *not* "a type variable that would otherwise be quantified" in Numeric Literals §4's sense — item 7's decision *is* the quantification decision, so defaulting does not fire on its account, and the variable behaves exactly as at a pre-#205 expansive binding: unsolved, first use pins it. Anything else would be circular (defaulting conditioned on a quantification that is conditioned on the constraint defaulting would remove). Edit note to `numeric-literals.md` §4 recorded (§10).
- `let m = memoize(e)` where `e : Seq(a)` generalized — `Seq(+a)` (transitionally by table row, then by `Seq.hex`'s written sigil — §5.3, §11.4), `seqMemoize` parametric (§7): **generalizes**. The memoized spine shared across instantiations can hold only values pulled from a source that, by parametricity, never produced any.
- The multi-item block (Functions §8.2's `lookup` example, with the signatures the argument depends on: `load : () -> Table(k, v)` and `find : (Table(k, v), k) -> v`, `Table` a transparent record) — still not a value (blocks of more than one item are not read through, unchanged), so item 7 governs: with `lookup : ?k -> ?v`, the argument variable `?k` occurs contravariantly and is **declined** (first use pins it); `?v` occurs covariantly, is unconstrained, and **generalizes** — soundly, because the once-loaded table, typed with no known element type, can contain no elements (leg 1). Had `find` instead demanded `<k: Hash>`, `?k` would be declined by clause (a) rather than clause (b) — the example's answer depends on the signatures, which is why they are written. Partial generalization is the intended reading of "per-variable" (§4.5). The host example changes accordingly (ledger, §10).

### 4.5 Per-variable, not all-or-nothing

A binding may end up with a scheme quantifying some variables while others sit unsolved awaiting their first use. This is the behavior OCaml users already live with, and it is the reason #206 (display of quantified vs unsolved variables) graduates from annoyance to teachability requirement — recorded there, not solved here.

### 4.6 What Step 2 does not touch (verified)

- **Rank-1**: generalization still produces outermost-`forall` schemes only; nothing here builds a `forall` left of an arrow; Functions §4.2's position restriction is untouched.
- **Monomorphic recursion** (Functions §7.4): constrains the knot inside an SCC before generalization; untouched.
- **No currying / n-ary arity**: about function shape and emission; orthogonal.
- **Higher-kinded types**: the variance analysis ranges over the fixed, fully applied constructors of §5; no abstraction over constructors is introduced anywhere in this ruling.
- **Exceptions**: payloads admit no type variables (Exceptions §2), so no throw carries a polymorphic value past the checker — leg 1 of §4.2 holds against them.
- **Implied type members** (Collections Part 2): unreferenceable in type expressions in v1 (§7.3 there), so no occurrence of a variable can hide inside one.

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

The only source of `−` is function-argument position, because Statements §6.4 leaves the language **no Hexagon-owned mutable type constructor** — the classic source of forced invariance (a readable-writable cell) does not exist in the language. The borrowed foreign views (`Array`, `JsMap`, `JsSet` — FFI Parts 2, 10) are the exception: they are views of genuinely mutable foreign objects whose stability is a boundary *contract*, not a language guarantee, and §5.3 makes them invariant rather than let the analysis lean on a contract. The only Hexagon-side source of `±` is a parameter genuinely occurring on both sides of an arrow (`type Endo(a) = a -> a`). The analysis is accordingly small: signs, multiplication, one fixpoint.

### 5.3 Where each constructor's variance comes from

| constructor | variance |
|---|---|
| transparent `record` / `union` / `type` alias | **inferred** from the definition — it is public; the computation leaks nothing a reader could not derive |
| parameterized `export opaque` with a declaration site (`Seq`, and every user type) | the **declared claim** (§6) — used uniformly by every module, the home module included (`Seq` transitionally excepted — see the claim table below) |
| extern types | v1: monomorphic (FFI Part 4 §12.4) — no parameters, no question. Forward rule, recorded now: if parameterized extern types are ever admitted, they are opaque by construction and take declared claims, bare meaning invariant |
| **compiler-known parameterized types the compiler implements and owns outright** (`Vector` — no declaration of the *name* exists; `Vector.hex` is a companion over the compiler's representation core — and `Node`, the hidden fixed-32 slot intrinsic under it, `runtime/VectorTrie.hex`; `intrinsics.md` §3.3, #126) | a row in the **compiler-side claim table** (below) |
| **compiler-known parameterized types that are borrowed foreign views** (`Array`, `Nullable` and `NullableCase` — FFI Part 2; `JsMap`, `JsSet` — FFI Part 10) | **invariant in v1.** For `Array`/`JsMap`/`JsSet`: their stability is a boundary contract (FFI Part 1 §3.1, Part 2 §6.2, Part 10 §2), not a language guarantee, and a variance claim may not rest on a contract. For `Nullable`/`NullableCase`, representation-direct and holding nothing mutable: no declaration site and no ruling yet — invariant is the conservative default, not a mutability verdict. A claim for any of them needs its own ruling |

**The compiler-side claim table** *(this ruling establishes it)*: compiler-owned parameterized types with no Hexagon declaration site take their claims from a compiler-owned table. Rows come in two grades, and the difference is the warrant:

- **Verified rows** — the representation *is* Hexagon-visible, in a privileged runtime module, and §6.3's machinery checks the row against it exactly as it would a written sigil, re-verifying on every representation edit. Variance is computed from the **representation** — the type declarations — never from the module's operations (`append(trie, value: a)` puts `a` in argument position, as any consumer of any covariant type does; operations are not occurrences).
- **Trusted rows** — no Hexagon-visible representation exists (or none the emitter yet targets), and §7's parametricity obligation is the row's entire warrant (the implementer is the compiler; the trust argument is `intrinsics.md` §3.4's). **`Node(+a)` is a trusted row**: a fixed-32 immutable slot type, read-only from Hexagon, its disposition owned by #126 (the reopener for this row).

**`Vector(+a)` is trusted today, and upgrades to verified at the emitter-wiring milestone.** `runtime/VectorTrie.hex` writes the representation in Hexagon, but its own header says the public face is wired by the emitter at a later milestone — today `Vector` ships from `@hexagon/runtime`'s JS trie (Collections Part 3 §4), so there is nothing for §6.3 to check yet, and until the wiring the row rests on §7's obligation against that JS trie. The derivation that becomes the check at upgrade, shown now because it is already sound against `VectorTrie.hex`: given `Node(+a)`, `a` under `Node(a)` is `+`; `Tree(a) = Leaf(values: Node(a)) | Branch(children: Node(Tree(a)))` reaches `+` at the fixpoint; both of `TrieVector`'s `a`-bearing fields (`root`, `tail`) sit at `+` with no arrow-argument position anywhere. From the upgrade on, a future `a`-in-argument-position field in `VectorTrie.hex` breaks at the row, not silently.

This is not a reversal of `intrinsics.md` §4.2's "types are normative in the declaration, not in any compiler-side table": that clause governs constructors that *have* a declaration to be normative in. The table is the placeholder for a declaration that does not exist yet, holds only what no declaration can hold today, and dies at the same `intrinsics.md` §9 self-declaration milestones — when a companion gains a real declaration, its claim moves into the source as a written sigil and the row is deleted.

**The transitional `Seq` row, stated as the exception it is:** `Seq` *has* a declaration site, and §6.2 makes its bare parameter a written claim of invariant — so the table carries **`Seq(+a)` transitionally, and `Seq` is, by this row alone and until §11.4's sweep writes the sigil into `Seq.hex`, the corpus's single constructor whose bare parameter does not mean invariant.** Dated, deliberate, and retired by the sweep. Precedence, defined once: a written **sigil** supersedes a table row for the same constructor; after the sweep, exactly one claim source per constructor is an invariant — a constructor holding both a table row and a written sigil is a build-time assertion failure, never a silent precedence question (conformance item, §11.1).

### 5.4 What variance is *not* (James's question, 2026-08-01, answered normatively)

Variance is a property of the **constructor**, fixed once at its declaration — it is not part of any type expression. Use sites, annotations included, always write `Seq(a)`, never `Seq(+a)` (parse error, Preamble §2.1): there is no "dropping" a sigil at an annotation, because no annotation ever carries one. `let x: Seq(a) = y` is therefore an ordinary annotated binding — `a` rigid while the RHS is checked, generalized at the binding (Functions §4.2.1's composition) — and `Seq`'s covariance participates in it not at all. The analysis answers **exactly one question — may this variable be generalized (Functions §8.7's clause (b), and §6.3's verification)** — and introduces **no subtyping**: unification remains equality-based, `Seq(Nat)` and `Seq(Int)` remain unrelated types, and no value is ever implicitly coerced between instantiations. (Garrigue's ⊥-subsumption is the *soundness argument* for quantifying, not a coercion the checker performs.)

### 5.5 Worked: `Seq`

```
Seq(a) = { pull: () -> Option((a, Seq(a))) }
```

Field `pull` at `+` → function *result* keeps `+` → `Option` covariant (transparent union, inferred) → tuple components keep `+` → `a` at `+`, and the recursive `Seq(a)` occurrence stabilizes at the fixpoint. **`a` is covariant in `Seq`** — carried transitionally by the claim table's `Seq(+a)` row (§5.3), then written into `Seq.hex` as the sigil by the sweep this ruling schedules (§11.4), retiring the row.

---

## 6. Variance and `export opaque`: declared claims

### 6.1 Grammar (host: Declarations Preamble §2.1)

A type parameter may carry a **variance sigil** — `+a` (covariant claim) or `-a` (contravariant claim) — **only when the declaration is `export opaque`**:

```hexagon
export opaque record Seq(+a) = { pull: () -> Option((a, Seq(a))) }
export opaque record Sink(-a) = { accept: a -> Unit }
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

> `a` cannot be declared covariant in `Seq`: field `consume` uses `a` in argument position. Remove the `+`, or change the field.
>
> *(Message form revised 2026-08-01, §13.1: the witness's location rides a required secondary diagnostic label at the occurrence's span — never the message text.)*

This is the design's teaching surface as much as its safety surface: the author who cannot state variance theory is shown the exact line that blocks the claim, at the moment it matters, with both legal exits named (Rewrite Rule, Preamble §1.1). A later representation edit that violates a standing claim errors **here**, at the author's declaration — never downstream in a stranger's module. Declaring *less* than the representation supports is legal everywhere and forever: under-claiming reserves the right to add the `consume` field later.

**Recursive occurrences during verification** *(normative; the fixpoint and the claim give different answers, so the choice must be written)*: while verifying the declarations of one SCC of the type-declaration dependency graph, occurrences of constructors **inside that SCC** contribute their **computed fixpoint** (§5.1's least-fixpoint iteration runs over the whole SCC at once); constructors **outside the SCC** contribute their **declared claims** (or table rows, §5.3). A self-recursive declaration is the one-member case: `Seq`'s own recursive occurrence in §5.5's derivation contributes the fixpoint, not the bare-parameter reading. Verification is the *only* consumer of computed variance (§6.4); everywhere else, SCC membership is irrelevant and the claim governs.

### 6.4 Claims are used uniformly, home module included

Every consumer of the constructor — Step 2's covariance test above all — reads the **declared claim**, inside and outside the home module alike. The home module gets no private view: a program must not compile in its home module and fail identically-written elsewhere. (The computed variance is used exactly once, for §6.3's verification.)

### 6.5 Emission note (recorded, not applied)

TypeScript has had declaration-site variance annotations since 4.7 (`out T` / `in T`); the `.d.ts` face of an exported opaque type may carry them, mapped from the declared claims. FFI Part 7 owns `.d.ts` mechanics; edit note recorded (§10), applied on next touch there.

---

## 7. The intrinsic parametricity obligation

Host: `intrinsics.md` §4.2's verification list gains a fourth commitment (ledger, §10):

> **Parametricity is part of the contract.** A generic intrinsic's implementation may move, store, and return values at its type parameters; it must never fabricate them, coerce them, or inspect them by type. Consequence: the variance of the declared scheme is semantically true of the implementation — the third leg of the relaxed rule's soundness (Functions §8.7).

Why it must be written: §5's analysis reads the Hexagon-visible definition, and intrinsics are exactly the values the checker trusts *beyond* that definition (`intrinsics.md` §3.4 grants them the genericity §12.4 denies the foreign boundary). A stateful generic intrinsic that stored values at one instantiation and surfaced them at another would make a `+` claim a lie no analysis could catch. The obligation extends to the compiler-side claim table's **trusted rows** (§5.3) — a row with no Hexagon-visible representation to verify against, or none the emitter yet targets (`Node(+a)`; `Vector(+a)` until its wiring milestone), rests on this obligation alone. **Verified rows** do not: their representations are checked per §6.3, and the obligation covers only the trusted leaves beneath them (`Node` beneath `Vector`, from the upgrade on).

**Scope of the obligation today, stated honestly:** the v1 intrinsic inventory holds exactly one entry, `seqMemoize` — the sharpest possible case (stateful, generic, covariant result). Whether its lowering satisfies parametricity — that the spine stores only values pulled from the source sequence, fabricating and inspecting none — is an assertion about implementation behavior, and this document routes those to the conformance suite (§11.1) rather than asserting them. The collection-companion operations are **not yet in the inventory** (they still ride the doors `intrinsics.md` §9 deprecates); each accepts this obligation as it arrives, alongside key and arity verification.

---

## 8. Tooling surfaces

### 8.1 The over-claim error

§6.3's text; the row lives in the Modules diagnostics checklist, the two sigil parse errors in the Preamble's (ledger, §10). The witness occurrence — constructor field, position, line — is required content, not garnish. *(Revised 2026-08-01, §13.1: the three parts split across the diagnostic's two channels. The message names the field and the position; the **line** is carried by a required secondary label at the witness occurrence's span, which every host renders as file:line. The label discharges the location requirement; the earlier `(Seq.hex:31)` spelling inside the message text is superseded and must not be read back in.)*

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

- **`functions.md`** — §8 item 2: the completed value list (§2.1) and the corrected rationale (§3), revised in place with dated markers; the multi-item-block passage's outcome annotation updated (§4.4); new item 7: the relaxed rule (§4.1, with the soundness legs and the do-not-relitigate clause); the closing hoisting-symmetry sentence adjusted (*full* generalization is the privilege of values); §10: two rows — the pinning-use diagnostic (§8.3) and the annotated-expansive declined-variable error (§4.1); §12: conformance correction record entry for the record-literal omission (§2.4).
- **`modules.md`** — new §4.2.1: variance claims (§6.1–§6.5 semantics; grammar pointer to the Preamble); §10: the over-claim error row; §14: one decisions-log row.
- **`declarations-preamble.md`** — §2.1: the sigil grammar bullet (§6.1), including the not-a-constraint clarification against §2.2; diagnostics table: the sigil-on-transparent and sigil-at-use-site rows; §9: decisions-log row.
- **`intrinsics.md`** — §4.2: the parametricity commitment, its conformance routing, and the claim-table reconciliation clause (§7, §5.3); §13: decisions-log row.
- **`README.md`** — authority rule 3: this document added to the closure-document list; file-index rows for this document and (closing a pre-existing gap) the #171 comments closure doc.
- **`spec-roadmap.md`** — §4: the #205 ripple row, compressing this section's recorded-not-applied list.
- **`notes/value-restriction-and-variance.md`** — status line updated: ruled here; retained as provenance with its three corrections named.

Recorded here, applied on next touch of the target (authority rule 4):

- **`ffi-part4-extern-bindings.md` §12.4 / §11 item 7** — lifting the generic-extern deferral must revisit §3's rationale and §4.2's soundness legs; parameterized extern types, if admitted, take declared variance claims, bare meaning invariant (§5.3). *(Extended 2026-08-01, §13.4 — a fourth face of the same coupling:)* lifting §12.4 must also rule on whether references to extern bindings join Functions §8.2's value list — deliberately unstated in v1, where no extern type contains a variable and the classification is unobservable; the future ruling must weigh §12.2's stability-assertion doctrine there (an `extern let`'s immutability is a boundary contract, not a language guarantee) before resting a soundness-bearing classification on it, the same scruple §5.3 applies to the borrowed views.
- **`numeric-literals.md` §4** — a variable item 7 declines under clause (a) is not "a type variable that would otherwise be quantified"; defaulting does not fire on item 7's account (§4.4's ruling).
- **`constraints.md` §6.1** — the property "dictionary records appear only inside genuinely polymorphic functions" is protected by Functions §8's restriction; add the cross-reference (§3). *(Applied 2026-08-01 — §13.3's touch of Constraints §6.1 carried it in.)*
- **`constraints.md` §2.2** — if bare unapplied member references are ever ruled terms, note §2.5's non-expansiveness rider here.
- **`ffi-part7`** (`.d.ts` mechanics) — declared claims may emit TypeScript `out`/`in` (§6.5).
- **`loops-ranges-iteration.md` §6.4** — `memoize`'s bullet may cite §7's parametricity obligation and conformance item §11.1 (viii).

---

## 11. Implementation notes for `hexc` (not this PR; umbrella issue to follow #205)

### 11.1 Step 1 (checker; small)

Extend the syntactic-value test per §2.1. Required conformance tests, each currently an assumption this document declined to make: (i) the two motivating snippets; (ii) the module-qualified form `let e = Seq.empty`; (iii) the annotated form `let e: Seq(a) = empty` (§2.5's composition); (iv) a bare record-literal RHS and the constructor-wrapped `Seq({...})` shape (§2.4 — pin whether the shipped checker already conformed to the repaired list); (v) the levels guard: `(x) => { let e = x; ... }` must quantify nothing; (vi) a constrained alias `let y = x` at two representations emitting one shared payload with per-use elaboration; (vii) annotated expansive bindings, both arms of §4.1's rule (all-variables-pass generalizes; any-declined errors at the declaration, exported and not); (viii) `seqMemoize`'s lowering satisfies §7's parametricity (stores only pulled values — the spine fabricates and inspects nothing); (ix) the single-claim-source invariant: after §11.4's sweep, a constructor holding both a claim-table row and a written sigil is a build-time assertion failure (§5.3); and, from the emitter-wiring milestone that upgrades `Vector(+a)` to a verified row, that row recomputes on every `runtime/VectorTrie.hex` edit.

### 11.2 Step 2 (checker + parser; the real work)

Variance computation per §5 (memoized per declaration; fixpoint over SCCs of the type-declaration dependency graph, with §6.3's inside-SCC/outside-SCC occurrence rule); the compiler-side claim table and its written-claim-supersedes rule (§5.3); the per-variable relaxed generalization in Algorithm J's bind rule (§4.1's three clauses, the defaulting non-interaction of §4.4, and the annotated-binding rule); the Preamble sigil grammar and its two parse errors; §6.3's verification with witness capture (span of the blocking occurrence). **JS emission** is untouched: generalization is types-only, and unconstrained variables carry no evidence by construction. `.d.ts` emission is *not* untouched in practice: #132 (emitted `.d.ts` invalid for a polymorphic non-function binding — `const empty: Seq<a>` with unbound `a`) describes exactly the shape Step 1 multiplies, and this ruling raises its stakes the same way it raises #206's.

### 11.3 LSP

§8.2's code action and hover; both read the same computed-variance table as §6.3. #206 is separate work but shares the classifier.

### 11.4 Stdlib sweep

Declare claims on the parameterized opaque exports that **have declaration sites**: today that is `Seq(+a)` (retiring its transitional table row, §5.3). `Vector` has no declaration to annotate — its claim lives in the compiler-side table until its `intrinsics.md` §9 self-declaration milestone gives it one, at which point the sigil moves into source and the row dies. The Map/Set family follows the same path at their milestones (claims computed from their representations, then declared, then reviewed). Sequenced after Step 2 lands in the checker; the `Seq.hex` edit is one sigil and a natural first exercise of §8.2's code action.

---

## 12. Decisions log

| Decision | Where |
|---|---|
| Value list gains references (module-qualified included) and record literals; `var` reads stay expansive | §2 |
| Rationale corrected: the value restriction is Hexagon's monomorphism restriction — constraint coherence under evaluate-once; mutation hole inexpressible; §12.4 coupling recorded both ways | §3 |
| Relaxed rule: expansive bindings generalize unconstrained, covariant-only, level-admitted variables, per-variable | §4.1 |
| The unconstrained clause is load-bearing and Hexagon's own; constrained variables never generalize at expansive bindings | §4.3 |
| Soundness legs: parametricity, monomorphic foreign externs, intrinsic parametricity | §4.2, §7 |
| Variance: four-point lattice, sign multiplication, fixpoint; `−` only from argument position among Hexagon-owned constructors (borrowed foreign views carved out as invariant) | §5 |
| Transparent types infer; opaque types declare; claims used uniformly, home module included | §5.3, §6.4 |
| Sigils `+a`/`-a` legal only on parameterized `export opaque`; bare = invariant = the empty claim (the `derives` doctrine); not mandatory, not defaulted | §6.1–§6.2, §9.2–§9.3 |
| Over-claim: declaration-site hard error naming a witness occurrence; under-claim: legal, LSP code action, no warning tier | §6.3, §8.2 |
| What crosses an opaque boundary must be declared, not inferred | §6.2 |
| Compiler-owned parameterized types without declaration sites: compiler-side claim table in two grades — verified rows checked against visible representations per §6.3, trusted rows on §7's obligation alone (`Node(+a)`, reopener #126; `Vector(+a)` trusted today, verified at the emitter-wiring milestone with the derivation as the check) — plus the dated transitional `Seq(+a)` exception; borrowed foreign views invariant in v1; a written sigil supersedes a row; post-sweep, one claim source per constructor is a build-time invariant | §5.3 |
| Verification's SCC rule: inside-SCC occurrences contribute the computed fixpoint, outside-SCC the declared claim | §6.3 |
| Clause-(a)-declined variables are not "otherwise quantified": defaulting does not fire on item 7's account | §4.4 |
| Annotated expansive bindings: rigid variables face the same three clauses; a declined one is a declaration-site error (exports inherit it via mandatory signatures) | §4.1 |
| Adopted per James's directives, in-session 2026-08-01: the `+a`/`-a` sigil spelling; bare-means-invariant as the simplification; the LSP code-action affordance | §6.1–§6.2, §8.2 |
| Over-claim witness location: message names the field and the position; a **required** secondary label at the witness occurrence's span carries the line; `(file:line)` in the message text superseded (2026-08-01, #207) | §13.1; Modules §4.2.1, §10 |
| Nothing else may generalize a `var`'s type — an observable rule, not an implementation nicety; hosted at Functions §8.4, asserted at Statements §6.1/§7.2 (2026-08-01, #207) | §13.2 |
| The constrained alias emits the bare reference when the binding discharges no evidence; eta-expansion reserved for in-scope evidence; boundary = dischargeability (2026-08-01, #207) | §13.3; Constraints §6.1, Functions §9 |
| Extern references and the value list: deliberately unstated in v1 (unobservable under FFI Part 4 §12.4); fourth face of the §12.4 coupling, must weigh §12.2's stability-assertion doctrine when lifted (2026-08-01, #207) | §13.4; ledger §10 |
| Use-site sigil message: the lead imperative is the Rewrite Rule's rewrite, span on the sigil; the worked re-spelling clause struck — unreproducible past arity 1 (2026-08-01, cold review) | §13.5; Declarations Preamble §2.1, §8, §9 |

---

## 13. Implementation questions, ruled *(added 2026-08-01; #207's four questions, and a fifth from cold review)*

The `hexc` implementation of this ruling (branch `ml-generalization-variance-207`) returned four questions only the spec could settle; cold review of the same implementation then surfaced a fifth (§13.5). The rulings below share this document's authority; each is applied to the hosts it names in the same change that adds its subsection. Nothing here amends §1–§12's decisions — §6.3's message form and §8.1's witness sentence are revised in place with markers pointing back here.

### 13.1 The over-claim witness's location is a label, not message text

**Ruling.** §8.1's required content — constructor field, position, line — splits across the diagnostic's two channels: the **message** names the field (or constructor slot) and the position in prose; the **line** is carried by a required secondary diagnostic label at the witness occurrence's span, which every host already renders as file and line. The label **discharges the location requirement in full** — stated explicitly so no later reader re-derives a `(file:line)` parenthetical from the superseded example text. A message without the witness label does not conform.

Why the split is right, not a concession: the checker holds a `fileId`-bearing span, and no pass below the host knows a path — the corpus's diagnostic structure deliberately separates source attribution from presentation. And the parenthetical's file component was always vacuous: a record's fields and a union's constructor slots are part of the type's own declaration, so the witness is by construction in the file the reader is already looking at. The label points at the exact occurrence — better than prose coordinates, and honest about who owns rendering.

Applied: Modules §4.2.1 (message + label sentence, marker), Modules §10 (row), Modules §14 (log row), §6.3 and §8.1 here (markers).

### 13.2 Nothing else may generalize a `var`'s type (observable rule)

**Ruling.** This is an **observable rule**, not an implementation obligation, and it is hosted at Functions §8.4 — the completed sentence: *`var` never generalizes, and nothing else may generalize a `var`'s type either.* The variables of a `var`'s monotype belong to the environment for the whole of the `var`'s scope; no binding in that scope — §8.2's values and item 7's expansive bindings alike — may quantify them, and any use anywhere in the scope, an assignment included, pins them.

Why it must be normative: the failing program is written in the surface language. `var v = empty`, then `let e = v` — expansive, so before #205 it quantified nothing and the exclusion was invisible — then `e` used at two element types, then `v := ...`: the assignment pins a variable `e`'s scheme had already quantified, and one shared, assignable binding is observed at several types at once. Item 7 created the first expansive bindings that quantify, so the second half of §8.4's sentence had to be written the day item 7 landed. The implementation's mechanism — sinking a `var`'s type to its block's level at the point the `var` is bound, so level admission refuses the variables everywhere above it — is a correct realization and stays an implementation note; the rule is stated in terms of environment membership, not levels.

Applied: Functions §8.4 (the completed item, dated); Statements §6.1 (pointer) and §7.2 (the alias test assertion); Statements §11 (log row). The conflicting-use diagnostic is Functions §10's existing pinning-use row; no new row.

### 13.3 The constrained alias emits the bare reference

**Ruling.** The emitted shape is **normative** — Functions §9's opening sentence ("emission shape is part of the contract") already commits to that — and it lives in Constraints §6.1, which owns the evidence ABI; Functions §9 carries a pointer. The rule: a binding whose RHS is a bare reference to a constrained function, where the binding discharges **none** of the reference's constraints (§2.2's generalized alias), emits the bare name — `const twice = double;` — and every consumer appends the trailing evidence suffix it would have appended to the original. Where evidence for the reference's constraints **is** in scope — a constrained function used as a value inside a genuinely polymorphic function whose own suffix supplies the dictionaries — the reference denotes the evidence-applied value and emits as the eta-expansion closing over that evidence, unchanged. The boundary is **evidence dischargeability at the reference**, never the reference's syntax.

This is §2.2's "shares the unapplied entity … exactly as polymorphic, and exactly as cheap" made operational; the previous behavior (eta-expanding the no-evidence case) built a wrapper of the unsuffixed arity that silently dropped the caller's dictionaries, and is recorded in the host as the rejected shape so it is not rebuilt.

Applied: Constraints §6.1 (the rule, plus §10's pending cross-reference note, applied on the same touch and so marked in the ledger), Constraints §10 (log row), Functions §9 (pointer bullet).

### 13.4 Externs and the value list: deliberately unstated

**Ruling.** Functions §8.2's list says **nothing** about `extern` bindings, deliberately. Under FFI Part 4 §12.4 every extern is monomorphic, so an extern reference has no type variable for either §8.2 or item 7 to quantify — the classification is unobservable in v1, and the corpus does not spend normative text on invisible distinctions. The list is not extended, and no host text changes.

The exclusion becomes visible the day §12.4 is lifted, and the answer then is **not** obvious: an `extern let`'s immutability is a stability *assertion* — a boundary contract, not a language guarantee (FFI Part 4 §4.4, §12.2) — and §5.3 already refuses to let a soundness-bearing classification (variance) rest on a boundary contract. Whether value-ness may rest on one is the same question, and it gets its own ruling at lifting time. Recorded as the **fourth face of the existing §12.4 coupling** — one coupling, one ledger entry — by extending §10's `ffi-part4` bullet rather than opening a separate note.

The other two absent kinds need nothing: `var` reads are §2.3's explicit exclusion, and the bare constraint-member reference stays exactly where §2.5 left it — whether it is a term at all is Constraints §2.2's question, neither opened nor closed here.

### 13.5 The use-site sigil message: the imperative is the rewrite *(from cold review, 2026-08-01)*

**Ruling.** The Declarations Preamble §2.1 use-site diagnostic loses its trailing worked-rewrite clause. The normative message, with the diagnostic's span on the sigil itself, is:

> remove the `+` — variance is declared on the type's declaration, never written at a use site

The struck clause ("; write `Seq(Int)`") re-spelled the corrected application, and the re-spelling was an artifact of the arity-1 example it was drafted from. Reproducing it in general means re-printing the entire argument list with the sigil deleted — the parser holds tokens, not text, and no type printer exists at that stage — and the reviewer verified that the shipped approximation (echoing the one token after the sigil) hands the author a fresh error in three of four shapes: `Pair(+Int, String)` → "write `Pair(Int)`" (wrong arity), `Pair(Int, +String)` → "write `Pair(String)`" (wrong argument), `Box(+Vector(Int))` → "write `Box(Vector)`" (dropped inner argument). A worked rewrite that manufactures new errors is a Rewrite Rule violation wearing the Rewrite Rule's clothes.

The fix is not a better printer. Preamble §1.1 demands a **named local rewrite**, not a re-spelling of the author's code — and the lead imperative already is one: "remove the `+`", with the caret on the `+`, names an exact single-token edit that is correct at every arity, every argument shape, every nesting depth. This is §13.1's channel discipline read from the other side: there the message stopped carrying what the label channel owns (location); here it stops carrying what no channel can produce faithfully (a reprint of surrounding source). The doctrine, stated once so it need not be re-derived: **a message clause the emitter cannot make true in general is not permitted on the strength of being right in the easy case.** The declaration-site sigil messages are untouched — their "remove the `+`" carries no re-spelling and never did.

Applied: Declarations Preamble §2.1 (the use-site sentence now carries the message, the span requirement, and the marker), Preamble §8 (row revised), Preamble §9 (log row); §12 here (log row).
