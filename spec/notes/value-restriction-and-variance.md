# Note: the value restriction, and the variance analysis behind relaxing it

**Status:** RULED — `../decisions-ml-dialect-generalization-2026-08.md` (#205, 2026-08-01). Retained as provenance. Three claims were corrected by the ruling's review (closure doc §1.2): §5.2's "no dictionary" claim (Constraints §6.1 is dictionary-compiled; the literal case proves less than claimed), Step 2's missing unconstrained clause (Garrigue's ⊥ argument does not cover constrained variables), and §4's Hexagon "records" row (Functions §8.2's written list had no record row — repaired by the ruling). The §3 tooling defect is filed as #206.
**Purpose:** James wants Hexagon to accept a program SML and OCaml both accept and Hexagon rejects. This note records what was found, separates what was verified from what was asserted, and puts three questions in front of a ruling. It also answers one question James raised directly — what `opaque` ought to do about variance — and argues it from Modules §4.2 rather than from OCaml's precedent.
**Companions:** Functions §8 (generalization, the value restriction), §7.4 (monomorphic recursion), §4.1–§4.2.1 (rigid annotation variables, binders); Statements & Mutability §6.2/§6.4 (`var`, no ref cells); Modules §4.2 (`export opaque`); FFI Part 4 §12.4 (generic foreign externs deferred); `spec/intrinsics.md` §3.4; numeric-literals.md §6.

---

## 1. Provenance, and the honesty boundary

James hit this while exploring, not while implementing. The analysis below is Opus's, developed with him in Fable's absence; the framing is his.

**Verified by running the compiler** — every claim in §2, §3, §5.1 and §5.2 was reproduced against the real checker and emitter in this workspace, on throwaway tests since deleted. Where a number or a message appears, it was observed.

**Not verified, stated from knowledge** — every claim about what SML, OCaml, or Haskell does. There is no `ocaml`, `sml`, `mlton`, or `ghc` on this machine, and installing a toolchain was out of scope. These claims are stated precisely enough to be checked, and they should be checked before a ruling rests on them. They are the load-bearing premise of the whole note, so this matters.

---

## 2. What James hit

*(Era syntax, deliberately — Collections Part 1 §10.1. These are the observed runs, and they were run before the 2026-08-02 rename of `Seq.cons` to the subject-first `Seq.prepend(rest, value)`; the recorded diagnostics belong to these exact programs, so the specimens are not renamed. The living acceptance program in current syntax is `decisions-ml-dialect-generalization-2026-08.md` §1.1.)*

```hexagon
let e = empty
let ys = cons(42n, e)
let xs = cons("Briar", e)      -- type mismatch: expected String, found BigInt
```

`42n` is monomorphic `BigInt` (numeric-literals.md §17), so the first use pins `e := Seq(BigInt)` and the second fails.

This is **correct per Functions §8.2**. Its list of syntactic values is "a lambda literal, a literal, a constructor application of values, or a tuple of values". A **bare variable reference is not on it**, so `let e = empty` does not generalize; `e` is `Seq(?1)` and, in §8.2's own words, "the first use fixes it, permanently."

James then tried to annotate his way out, and this is the more interesting half:

```hexagon
let e: Seq(a) = empty
let ys = cons(42n, e)          -- `a` is a declared type variable, but the body requires `BigInt`
```

**One use is enough to fail.** The annotation did not make `e` polymorphic — it made `a` *rigid* (§4.1): one specific type, chosen by the definition, that no use site may pin. The user who reaches for an annotation to *request* polymorphism is the one still refused.

**This one does fall out, and does not need its own ruling.** Rigidity is not defeating generalization here; it is rigidity with *nothing to generalize it*. §4.2.1 already states the composition, about `id`: "`a` is introduced by `x: a`, **rigid while the definition is checked** (§4.1), **and generalized at the binding** (§8)." Rigid governs how the RHS is *checked*; quantification happens after, at the binding. §8.2 blocks the second step for this RHS category, stranding a lone rigid variable in a monotype for the first use to collide with. Verified on today's compiler — same annotation shape, RHS on §8.2's list, two instantiations, no complaint:

```hexagon
let f: a -> a = (x) => x     -- rigid `a`, exactly as in `Seq(a)`
let n = f(1)
let b = f(True)              -- compiles clean; hover shows `a -> a`
```

So under step 1 the annotated form generalizes for the same reason the unannotated one does, and both of James's snippets work. Worth confirming rather than assuming, but it is a confirmation, not a decision.

Note also that the diagnostic misattributes: "the body requires `BigInt`" — the body is `empty` and requires nothing. The *use* requires it. Minor, but it is what sent James looking in the wrong place.

---

## 3. A tooling defect that caused the confusion, worth fixing regardless

Three different things are spelled `a`, and hover renders all three identically:

| written | what `a` is | behaviour | hover shows |
|---|---|---|---|
| `let f = (x) => x` | quantified | polymorphic; each use instantiates fresh | `a -> a` |
| `let e = empty` | unsolved `?1` | monomorphic; first use fixes it forever | `Seq(a)` |
| `let e: Seq(a) = empty` | rigid skolem | fixed but unknown; no use may pin it | `Seq(a)` |

The middle row is §8.2's own worked example of a binding that is *not* polymorphic, and it hovers identically to the first. James read `Seq(a)`, drew the conclusion every ML text licenses, and was contradicted by the next line he typed.

A fourth, adjacent: `let x = 42` alone hovers as `Int`, but is genuinely `Num a => a` (§5.2 below proves it). So the display also hides generality it *does* have.

This is the same family as **#190** ("A constraint projection is not a quantified variable, and only the checker can tell them apart") — different mechanism, same failure: one spelling for things that behave differently. It is independent of everything else here and could be fixed without any ruling.

---

## 4. Where Hexagon sits relative to the tradition it names

§8.2 calls its rule "**ML-style**". Set the lists side by side:

| non-expansive form | SML '97 | Hexagon §8.2 |
|---|---|---|
| constants / literals | yes | yes |
| `fn` / lambda literals | yes | yes |
| constructor applications of non-expansive args | yes | yes |
| tuples and records of non-expansive | yes | yes |
| type-constrained non-expansive | yes | — |
| **variables** | **yes** | **no** |

Hexagon's list is SML's with variables deleted. James's reaction to this is the reason the note exists: *"If code works in OCaml and SML and fails in Hexagon, this is a sign that I have wandered off the path somewhere."*

**Why SML can safely include variables** — the argument that matters, because Hexagon already owns the machinery:

The value restriction guards **allocation**: an expression that manufactures fresh mutable state must not be generalized (`val r = ref []`). A variable reference allocates nothing; it is a lookup.

The *aliasing* case is guarded by a **different** mechanism:

```sml
val r = ref []    (* r : ?1 list ref — ?1 free in the environment *)
val s = r         (* non-expansive, so generalize — but ?1 is free in the env, so nothing quantifies *)
```

Generalization quantifies only variables not free in the environment. Functions §8 already specifies "level-based generalization", which *is* that discipline. So: the value restriction guards allocation, levels guard sharing, and for a variable reference allocation is impossible and levels already cover sharing.

**OCaml goes further** — Garrigue's *relaxed value restriction* (2004) generalizes type variables occurring only in **covariant** positions even for expansive expressions. That reaches §8.2's own counter-example, `let xs = makeEmpty()`. James wants this too, which is what pulls variance into scope.

---

## 5. Is the value restriction load-bearing in Hexagon at all?

This is the question that may collapse the others, and it should be asked first.

### 5.1 There is no mutable cell type

Statements & Mutability §6.4: "**No ref cells, no mutable fields, no compound assignment, no module-level `var`.**" §1's doctrine: `var` is local, monomorphic, and **invisible across every lambda boundary** (§6.2) — it cannot escape into any type.

So `val r = ref []` is not *rejected* in Hexagon. It is **inexpressible**. The classic ML hole has no syntax here.

§8.2's stated rationale names two occupants of that territory: `var`, and "effectful FFI calls". `var` cannot reach a type. That leaves the FFI carrying the entire justification alone.

### 5.2 The constraint machinery is already ahead of the question

James asked whether constraints complicate this. They do the opposite. Hexagon **already generalizes constrained value bindings**, verified:

```hexagon
let x = 42                  -- Num a => a, genuinely generalized
export let a: Int = x
export let c: BigInt = x    -- compiles clean; Int and BigInt are materially different representations
```

emitting

```js
const x = 42;
const a = x;
const c = BigInt(x);        // per-use conversion, one shared constant
```

No dictionary, no recomputation, correct at both instances. **Hexagon has no monomorphism restriction and does not appear to need one** — `Num` is representation-directed here (numeric-literals.md §6). The hard case already ships; the unconstrained case James wants is strictly easier.

### 5.3 The FFI coupling — the part to check hardest

The residual worry is a stateful foreign value whose Hexagon type contains a variable. The canonical shape: FFI Part 3 §2.1's **inbound memoizing `Seq` adapter**. Generalize a binding of one, use it at two instantiations, and both share a single memoized spine holding foreign values typed two ways. That is a genuine hole, and it is the shape §8.2's "effectful FFI calls" gestures at.

**But it may already be closed in v1**, by an unrelated rule: FFI Part 4 §12.4 makes **generic foreign externs a hard error**, verified —

```
export fun identity<a>(x: a): a   ->  hard error
export fun identity(x: a): a      ->  hard error   (the ban reads the signature, not just the binder)
```

With no generic foreign extern, no foreign call can *return* a type containing a variable, so there is nothing to generalize unsoundly. Intrinsics are generic (`spec/intrinsics.md` §3.4) but compiler-implemented and trusted.

**If that reasoning holds, the value restriction in Hexagon v1 currently guards nothing** — and its justification is *coupled to §12.4*. Relaxing one would require revisiting the other, which is a coupling worth writing down whichever way this goes.

I would not have Fable take that on my word. It is the single claim in this note most likely to be wrong, because it is an argument from absence over a surface (the FFI) I did not exhaustively audit. `Seq.memoize` is a stateful *intrinsic* returning a covariant type, and is the first place I would look for a counterexample.

---

## 6. The ladder, if the restriction survives §5

- **Step 1 — SML parity.** Add "a variable reference" to §8.2's non-expansive list. One line; the machinery (levels) is already present; **no variance needed**. Fixes **both** of James's snippets (§2) — annotated and not, since both RHSs are the variable reference `empty`.
- **Step 2 — OCaml parity.** Garrigue's relaxed value restriction. Needs a variance analysis Hexagon does not have, which drags in §7 and the whole `opaque` question. Fixes the *function-call* case, `let xs = makeEmpty()` — which **SML rejects too**, and which James has not yet hit.

They are separable, and step 1 does not depend on step 2. James wants both, and should have both — but the asymmetry is worth seeing before pricing them together: **everything that actually bit him is on the near side of step 1**, and step 2 carries essentially all of the cost in this note. If §7.2's annotation price is judged too high, step 1 still stands alone and still fixes §2.

---

## 7. Variance, and what `opaque` ought to do

### 7.1 The analysis itself is cheap here

Signs multiply. Starting at `+`: in `s -> t`, `t` keeps the sign and `s` flips it; for `T(a)`, look up `T`'s variance in that slot and multiply. The lattice has four points — unused, covariant `+`, contravariant `−`, invariant `±` — and recursive types need a least fixpoint (start at *unused*, iterate to stability).

**Hexagon has no invariance from mutation**, because §6.4 leaves no mutable type constructor. The only source of `−` is function-argument position; the only source of `±` is a variable landing in both (`type Endo(a) = a -> a`). This is materially simpler than the same analysis in a language with mutable containers.

Worked on the type that motivated this:

```
Seq(a) = { pull: () -> Option((a, Seq(a))) }
```

field `pull` immutable `+` → function result keeps `+` → `Option` covariant → tuple covariant → **`a` is covariant in `Seq`**, at the fixpoint. So Garrigue's rule would fire for `Seq`.

### 7.2 James's question: ought variance leak through `opaque`?

His instinct that "ML dialect targeting JavaScript" underdetermines this is right. But Hexagon has already ruled on the underlying principle twice, in Modules §4.2, and the two rulings point the same way.

**First**, on what opacity is for:

> An opaque record without field privacy would be **fake abstraction**; outside its home module an opaque record is a black box.

**Second**, on what nonetheless crosses:

> Derived instances are unaffected … This is deliberate: **opacity hides *structure*, not *capabilities***.

Variance is a capability fact, not a layout fact — a statement about how a parameter may be *used*, not how the value is laid out. By the second ruling it belongs on the crossing side, alongside `derives`. So "hide it entirely" is the wrong frame, and **option (C) — opaque types are invariant by default — is also self-defeating**: `Seq` is `export opaque record Seq(a)`, so a rule that makes opaque types invariant kills the relaxed value restriction for precisely the type that motivated the exercise.

But look at *how* the things that cross actually cross. `derives (Eq, Show)` is **written**. The arity in `Seq(a)` is **written**. Nothing crosses an opaque boundary today that the author did not put in the declaration.

That is the principle, and it is Hexagon's own rather than OCaml's:

> **What crosses an opaque boundary must be declared, not inferred.**

Inferred variance would violate it, and the cost is concrete: `Seq` is covariant today; add one private field `consume: a -> Unit` and `a` becomes invariant, silently breaking client modules that did nothing wrong. A private representation edit would have downstream type consequences — which is the "fake abstraction" §4.2 refuses, arriving by a different door.

**So the recommendation is:**

- **Transparent `record`/`union`: infer.** The definition is public; a computed variance leaks nothing a reader could not already derive. No syntax, no burden.
- **`export opaque`: require it declared**, and have the compiler *verify* the declaration against the definition. A representation change that violates the declared variance is then an error **at the declaration**, where the author is, instead of downstream in a stranger's module.

This lands on OCaml's answer (`type +'a t`) — but arrives there from §4.2's doctrine rather than by precedent, which matters, because it means the rule generalizes to the *next* inferable property somebody wants to leak.

The cost is honest and should be stated plainly: **it is new syntax**, on a modifier that currently takes none, and the house bar for a new form is concrete demand. The demand here is concrete — without it, either opacity lies or step 2 dies — but it is Fable's call whether that clears the bar.

Spelling is not proposed here. `opaque record Seq(+a)` is the obvious import; whether Hexagon wants sigils, words, or something else is a separate and smaller question, and it should not be settled by defaulting to OCaml's punctuation.

### 7.3 What variance does *not* touch

James asked whether this endangers his three restrictions. It does not:

- **Higher-rank types** — generalizing a `let` produces a rank-1 scheme, outermost `forall`. Rank-2 is a `forall` *left of an arrow*; nothing here creates one, and §4.2's position restriction on `<...>` is untouched.
- **Polymorphic recursion** (§7.4) — that rule constrains the recursive knot *inside* an SCC, where the type is a not-yet-generalized monotype. Generalization happens after the SCC closes. Untouched.
- **No currying** — about the shape and emission of function values. Orthogonal.

---

## 8. Questions for the ruling

1. **Does the value restriction guard anything in Hexagon v1?** (§5) With no ref cells, no mutable fields, a `var` that cannot escape a lambda, and generic foreign externs banned by FFI Part 4 §12.4 — is there a reachable unsoundness? If not, the ruling is a reframing of §8.2, not an amendment to its list. **If yes, the counterexample should go in §8.2**, which today asserts the restriction is "load-bearing, not precautionary" without one.
2. **If it does: step 1, step 2, or both?** (§6) And does the ruling record the §12.4 coupling either way?
3. **`let e: Seq(a) = empty`** — *confirm, do not decide.* (§2) It resolves itself: rigidity governs checking, quantification happens after at the binding, and §4.2.1 already states that composition for `id`. Under step 1 it generalizes for the same reason the unannotated form does. Demoted from an open question to a thing to verify once the change is made.
4. **Does variance cross `opaque` declared or inferred?** (§7.2) The recommendation is *declared, verified at the declaration*; the counter-case is that new syntax on `opaque` is too high a price, in which case step 2 is confined to transparent types and `Seq` does not benefit.

---

## 9. Not being asked here

- The hover conflation (§3) is a compiler defect, fixable now, independent of every ruling above.
- Nothing in this note proposes touching §7.4, the currying decision, or the rank-1 restriction.
- The spelling of a variance annotation (§7.2), if one is wanted.
