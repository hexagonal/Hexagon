# Hexagon Spec: Numeric Literals

**Status:** Decided (July 2026)
**Decision:** Roc-style polymorphic integer literals with `Int` defaulting. `1n` is monomorphic `BigInt`. Decimal literals are monomorphic `Float`.

This document is written for a future implementation session. It assumes the reader knows the existing `hexc` architecture: Algorithm J with union-find mutable type variables, level-based generalisation, constraints compiled to dictionary passing, `implement` blocks as instance definitions.

---

## 1. Summary of the design

There are three literal forms:

| Syntax | Type | Elaboration |
|--------|------|-------------|
| `1`, `42`, `0` | `Num a => a` (polymorphic) | `fromInt(1) : α` with pending constraint `Num α` |
| `1n`, `42n` | `BigInt` (monomorphic, always) | the literal itself |
| `1.5`, `0.0`, `1e9` | `Float` (monomorphic, always) | the literal itself |

Key rules:

1. **Every** integer literal (no `n` suffix, no decimal point) elaborates uniformly to a call `fromInt(lit)` at a fresh type variable `α`, with constraint `Num α`. There is no syntactic detection of "polymorphic context" — polymorphism or monomorphism is an *inference outcome*, discovered by unification, never a property of the literal's location.
2. `fromInt : Int -> a` is a method of the `Num` constraint. Every `Num` instance must implement it. It is total and exact for all planned instances (`Int`, `Float`, `BigInt`, `Rat`).
3. **Defaulting:** at generalisation time, any type variable that (a) is still unresolved and (b) carries a constraint set arising *solely from literal elaboration and other defaultable constraints* (see §4) is unified with `Int` instead of being generalised. Literal type variables are therefore **never** generalised. `let x = 1` gives `x : Int`, not `x : Num a => a`.
4. `1n` does **not** participate in the polymorphic scheme. The `n` suffix is a type annotation, exactly as in JavaScript. There is no `fromBigInt` method in `Num` (deliberately — see §7, Rejected alternatives).
5. Decimal literals do not participate either. `1.5 : Float`, always, in v1.
6. **Codegen guarantee:** when `α` resolves to `Int` (by unification or defaulting), the `fromInt` wrapper is erased and the plain JS number literal is emitted. Only literals inside genuinely polymorphic (dictionary-taking) functions emit `dict.fromInt(1)`.

---

## 2. Motivating examples (expected behaviour)

These are the acceptance tests for the design.

```
-- (a) Bare literal binding: defaulting fires.
let x = 1            -- x : Int          emits: const x = 1;

-- (b) BigInt literal: monomorphic, no elaboration.
let y = 1n           -- y : BigInt       emits: const y = 1n;

-- (c) Polymorphic function, no literals: ordinary let-polymorphism.
fun plus a b = add a b
                     -- plus : Num a => a -> a -> a

-- (d) Literal in a polymorphic body: stays generic via fromInt.
fun addOne x = add x 1
                     -- addOne : Num a => a -> a -> a's elaboration:
                     --   addOne x = add x (fromInt 1)
                     -- emits (dictionary style):
                     --   function addOne(dict, x) { return dict.add(x, dict.fromInt(1)); }

-- (e) Literal pinned by unification: fromInt erased.
fun halve x = Float.divide x 2
                     -- 2 elaborates to fromInt(2) : α, Num α
                     -- Float.divide forces α := Float
                     -- emits: function halve(x) { return x / 2; }
                     -- (the emitted 2 is Float's fromInt applied at compile time — see §5)

-- (f) Mixed constraints, still defaultable.
let s = toString (add 1 2)
                     -- α carries {Num α, Show α}; α unresolved at generalisation;
                     -- both constraints are defaultable ⇒ α := Int ⇒ s : String
                     -- emits: const s = Int.toString(1 + 2)  (or the folded "3", see §5)

-- (g) BigInt suffix never coerces.
fun f x = add x 1n   -- f : BigInt -> BigInt   (1n pins the tyvar to BigInt)
add 1.5 1n           -- TYPE ERROR: Float vs BigInt. No implicit numeric conversion, ever.

-- (h) Explicit conversion is the escape hatch.
Rat.fromBigInt 123456789012345678901n   -- big literal into a Rat: explicit, honest
```

---

## 3. Elaboration (during inference, Algorithm J)

When the inferencer reaches an integer literal `k` (lexed token: digits, no `.`, no `n`, no exponent):

1. Allocate a fresh type variable `α` at the current level.
2. Record the constraint `Num α`, tagged with provenance `LiteralConstraint(span, k)`. Provenance is load-bearing: it is used both for defaulting eligibility (§4) and for error messages (§6).
3. The elaborated term is `App(NumMethod("fromInt", α), IntLit(k))` — i.e. the literal node in the typed AST is *already* a `fromInt` call. Do not keep a separate "maybe-polymorphic literal" node that gets rewritten later; there is exactly one representation, and the "monomorphic case" is an *optimisation on resolved types* (§5), not a different elaboration.

The literal's payload `k` is validated at lex time: it must be an exact f64 integer, i.e. `|k| <= 2^53 - 1`. A bare literal outside that range is a **compile error** with a fixit suggesting the `n` suffix ("integer literal exceeds Int range; write `...n` for a BigInt, or use an explicit conversion"). Rationale: the payload is an `Int` (f64-integer-invariant) by construction, so `fromInt` never receives a value it can't represent, and every instance's `fromInt` stays total *and exact*.

`1n` literals: elaborate directly to `BigIntLit(k)` with type `BigInt`. No type variable, no constraint. Payload is arbitrary precision (store as string or JS bigint in the AST).

Decimal literals: elaborate directly to `FloatLit`, type `Float`. (Future work note: these *could* become `Frac`-polymorphic via a `fromFloat` method, but this is explicitly deferred — the `Rat` instance of `fromFloat` is exact binary conversion, which is not what a user writing `0.1` means, and resolving that tension is a design task, not an implementation task.)

### Interaction with the existing pipeline

- Constraint recording uses the same machinery as constraints introduced by calls to `Num`-constrained functions. Nothing new in `unify`. The four cases of `unify` are untouched.
- Levels: `α` is allocated at the current level like any other tyvar, so it participates in level-based generalisation checks normally. The defaulting rule (§4) runs *inside* the generalisation step, before the "escapes-current-level ⇒ generalise" decision.
- Value restriction / `var` rule: unaffected. Defaulting makes literal tyvars monomorphic, which is strictly *more* conservative than generalisation, so `var x = 1` (had it been at risk) simply gets `x : Int`, which is what the `var`-no-generalisation rule wanted anyway.

---

## 4. Defaulting rule

Run at generalisation time, per binding group, immediately before quantification:

> For each type variable `α` that would otherwise be quantified: if `α`'s constraint set is non-empty and every constraint on `α` is **defaultable**, unify `α := Int` (this must succeed by construction, since all defaultable constraints have an `Int` instance — assert this). Otherwise leave `α` to the ordinary generalisation path.

**Defaultable constraints (v1, closed list):** `Num`, `Eq`, `Ord`, `Show`. All four have `Int` instances in the prelude. The list is a hard-coded set in the compiler, not user-extensible. Maximally dumb on purpose: "unresolved literal var ⇒ Int, always, no negotiation." Do not import Haskell's numeric-defaulting machinery (multiple candidate types, module-local `default` declarations, the interaction with user classes); that machinery is one of Haskell's most complained-about corners, and Hexagon's rule avoids it by having exactly one candidate type and a closed constraint list.

Consequences worth asserting in tests:

- A tyvar with `{Num α}` only: defaults. (`let x = 1`)
- A tyvar with `{Num α, Show α}`: defaults. (`toString (add 1 2)`)
- A tyvar with `{Num α, SomeUserConstraint α}`: does **not** default; proceeds to ordinary generalisation if the binding form allows it, or produces an ambiguity error if it doesn't. Error message should name the non-defaultable constraint (§6).
- A tyvar with an empty constraint set: never defaults (it's not a literal var; ordinary generalisation applies).
- Defaulting is per-tyvar, not per-binding: `let pair = (1, 1.5)` defaults the first component's tyvar to `Int` independently; the `1.5` was never polymorphic.

Note the closed list means a literal used *only* under a user-defined constraint keeps `Num` in its set too (elaboration always adds `Num`), so the "solely defaultable" test correctly fails on the user constraint, not on `Num`.

---

## 5. Codegen

Two regimes, determined entirely by whether `α` is resolved to a concrete type at emission:

**Resolved (the overwhelmingly common case).** Erase the `fromInt` call and emit the concrete literal directly:

- `α = Int` → emit `k` (plain JS number). `Int.fromInt` is the identity; do not emit an identity call.
- `α = Float` → emit `k` (plain JS number; `Float.fromInt` on an in-range payload is also representational identity in JS).
- `α = BigInt` → emit `kn`. (`BigInt.fromInt` folded at compile time. This arises when unification pins a bare literal to BigInt via surrounding code, e.g. `add x 1` with `x : BigInt`.)
- `α = Rat` → emit the canonical-form constructor call with constant arguments, e.g. `Rat.fromInt(k)` or, if you implement constant folding for it, the direct `{num: kn, den: 1n}` fast-path constructor. Either is acceptable; the fast path is a nice-to-have.
- Any other instance type → emit `TheType.fromInt(k)` monomorphically (direct call, no dictionary).

**Unresolved-because-polymorphic** (literal inside a function generalised over `Num a`): the dictionary parameter is already in scope by the existing `implement` compilation story; `fromInt` is one more slot in the `Num` dictionary record. Emit `dict.fromInt(k)`. No new mechanism.

This preserves the readable-JS goal: monomorphic code — nearly all code — contains plain `1` and `1n` literals indistinguishable from hand-written JS. Only genuinely generic functions show dictionary plumbing, and they already did for `add`.

**Dictionary shape change:** `Num` dictionaries gain a `fromInt` field. Every existing and future `implement Num T` must supply it. Prelude instances:

```
Int.fromInt    = identity
Float.fromInt  = identity            (payload guaranteed within 2^53 by lexer, §3)
BigInt.fromInt = n => BigInt(n)
Rat.fromInt    = n => mkFast(BigInt(n), 1n)
```

All four are total and exact. This is a checked property of the design: keep it true for future instances, and document it as a law of `Num` (`fromInt` must be an exact ring homomorphism from Int — `fromInt(a+b) == add(fromInt a)(fromInt b)`, etc.).

---

## 6. Error messages

Elaboration changes the *character* of type errors involving literals, and this is where Haskell beginners bleed. Budget for special-cased reporting using the `LiteralConstraint` provenance from §3:

- When unification fails and one side traces to a literal's `α`, report it as a literal-type mismatch, not a constraint failure. Prefer: `This literal is used as Float here but as BigInt there` over `Cannot satisfy Num constraint arising from...`.
- When defaulting is blocked by a non-defaultable constraint (§4), the error must name the blocking constraint and the literal's location, and suggest an annotation: `The literal 1 at <span> has constraint MyConstraint, which prevents defaulting to Int. Add a type annotation to pin its type.`
- Never surface the name `fromInt` in an error for code the user wrote without mentioning it. The elaboration is invisible machinery; errors should speak in terms of the literal.
- LSP hover on a bare literal in polymorphic position should show `Num a => a` (matching the round-trip-consistency rule for signatures); hover on a defaulted or pinned literal shows the concrete type.

---

## 7. Rejected alternatives (do not re-litigate without new information)

**Fully monomorphic literals** (`1 : Int` always). Rejected because `fun addOne x = add x 1` collapses to `Int -> Int`, forcing duplication of any generic numeric code that mentions a constant. The polymorphic scheme costs one `Num` method plus one defaulting rule and recovers Haskell/Roc ergonomics.

**Context-dependent rewriting** ("rewrite the literal to `fromInt` when it appears in a polymorphic context"). Rejected as an implementation strategy — not because the observable behaviour is wrong, but because "polymorphic context" is not syntactically detectable; it is an inference outcome. In `fun f x = add x 1`, whether the `1` is polymorphic depends on what later unification pins `x` to. The uniform elaborate-always + erase-when-resolved strategy (§3, §5) produces the behaviour the context-dependent intuition wants, with a rule that can actually be implemented in one pass.

**`1n` as a polymorphic Num literal** (elaborating via `fromBigInt : BigInt -> a` in `Num`). Rejected for two reasons. (1) It hollows out the suffix: if both `1` and `1n` are polymorphic, `n` no longer means "this is a BigInt", breaking the JS developer's correct intuition — the suffix is supposed to *be* the type annotation, as in JS. (2) It forces `fromBigInt` into `Num`, whose `Float` instance is silently lossy for values beyond 2^53 (`fromBigInt(2n**60n)` rounds without a peep). Haskell's `fromInteger` has exactly this wart; Hexagon doesn't need it because the polymorphic `Int`-payload literal covers every exact case, and oversized literals go through explicit conversions (`Rat.fromBigInt ...n`).

**Haskell-style generalisation of bare literal bindings** (`let x = 1` giving `x : Num a => a`). Rejected: conflicts with the "no defaulting negotiation" goal, produces dictionary-abstracted values where users expect constants, and interacts badly with the value-restriction-adjacent rules already in place (`var` never generalises). Defaulting to `Int` at generalisation is strictly simpler and matches Roc.

**Haskell-style extensible defaulting** (multiple candidate types, `default` declarations). Rejected: single candidate (`Int`), closed defaultable-constraint list, no per-module configuration. See §4.

**Polymorphic decimal literals via `Frac`/`fromFloat`.** Deferred, not rejected — but blocked on a real design question (exact-binary vs decimal-intended conversion for `Rat`), so v1 pins `1.5 : Float`.

---

## 8. Implementation checklist

1. **Lexer:** ensure three distinct token kinds (IntLit, BigIntLit, FloatLit). Range-check IntLit payload against 2^53−1; emit the fixit error otherwise. BigIntLit payload stored losslessly.
2. **Prelude / constraint defs:** add `fromInt : Int -> a` to the `Num` constraint declaration; implement it in the four prelude instances (§5 table); document the exact-homomorphism law.
3. **Inference:** elaborate IntLit per §3 (fresh tyvar, `Num` constraint with `LiteralConstraint` provenance, `fromInt` application node). BigIntLit/FloatLit type directly.
4. **Generalisation:** insert the defaulting pass per §4, with the closed defaultable set {Num, Eq, Ord, Show}. Assert successful unification with Int.
5. **Codegen:** erase resolved `fromInt` per §5 (identity folding for Int/Float, `n`-suffix folding for BigInt, constructor call for Rat/others); dictionary slot for the polymorphic case.
6. **Diagnostics:** literal-aware unification errors, blocked-defaulting error, no `fromInt` leakage (§6).
7. **LSP:** hover types per §6; signature round-trip consistency (`Num a => a -> a -> a` etc.) unchanged.
8. **Tests:** the eight examples in §2 as golden tests (inferred type + emitted JS), plus the §4 consequence list, plus an error-message snapshot for (g) and the blocked-defaulting case.
