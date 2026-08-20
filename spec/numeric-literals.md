# Hexagon Spec: Numeric Literals

**Status:** Decided (July 2026)
**Decision:** Roc-style polymorphic integer literals with `Int` defaulting. `1n` is monomorphic `BigInt`. Decimal literals are monomorphic `Float`.

This document is written for a future implementation session. It assumes the reader knows the existing `hexc` architecture: Algorithm J with union-find mutable type variables, level-based generalisation, constraints compiled to dictionary passing, and `honor` declarations as instance definitions.

---

## 1. Summary of the design

There are three literal forms:

| Syntax | Type | Elaboration |
|--------|------|-------------|
| `1`, `42`, `0` | `<a: Num> a` (polymorphic) | `fromNat(1) : α` with pending constraint `Num α` |
| `1n`, `42n` | `BigInt` (monomorphic, always) | the literal itself |
| `1.5`, `0.0`, `1e9` | `Float` (monomorphic, always) | the literal itself |

Key rules:

1. **Every** integer literal (no `n` suffix, no decimal point) elaborates uniformly to a call `fromNat(lit)` at a fresh type variable `α`, with constraint `Num α`. There is no syntactic detection of "polymorphic context" — polymorphism or monomorphism is an *inference outcome*, discovered by unification, never a property of the literal's location.
2. `fromNat : Nat -> a` is a method of the `Num` constraint. Every `Num` instance must implement it. It is total and exact for all planned instances (`Nat`, `Int`, `Float`, `BigInt`, `Rat`).
3. **Defaulting:** at generalisation time, any type variable that (a) is still unresolved and (b) carries a constraint set arising *solely from literal elaboration and other defaultable constraints* (see §4) is unified with `Int` instead of being generalised. Literal type variables are therefore **never** generalised. `let x = 1` gives `x : Int`, not `x : <a: Num> a`.
4. `1n` does **not** participate in the polymorphic scheme. The `n` suffix is a type annotation, exactly as in JavaScript. There is no `fromBigInt` method in `Num` (deliberately — see §7, Rejected alternatives).
5. Decimal literals do not participate either. `1.5 : Float`, always, in v1.
6. **Codegen guarantee:** when `α` resolves to `Int`, `Float`, or `BigInt`, the `fromNat` wrapper is erased and the literal is emitted respectively as `k`, `k.0`, or `kn`. The Float spelling deliberately preserves inferred type intent for a human reader even though `k` and `k.0` are identical JavaScript numbers. Only literals inside genuinely polymorphic (dictionary-taking) functions emit `dict.fromNat(k)`.
7. **Contextual numeric widening:** an established `Nat` may be injected through `Num<a>.fromNat`; an established `Int` may be injected through `Signed<a>.fromInt`. The target must be independently established — by an annotation, a concrete operand, a boundary, or the seat's expected type (Functions §4.3) — and widening never invents a polymorphic target merely to make an expression type-check. At an arithmetic operation whose expected type is concrete, that type is the operation's home: the operands widen in and the operation runs at the written type; where no expectation lands, exact unification wins first (§5.1).

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
                     -- plus : <a: Num> a -> a -> a

-- (d) Literal in a polymorphic body: stays generic via fromNat.
fun addOne x = add x 1
                     -- addOne : <a: Num> a -> a -> a's elaboration:
                     --   addOne x = add x (fromNat 1)
                     -- emits (dictionary style):
                     --   function addOne(dict, x) { return dict.add(x, dict.fromNat(1)); }

-- (e) Literal pinned by unification: fromNat erased.
fun halve x = Float.divide x 2
                     -- 2 elaborates to fromNat(2) : α, Num α
                     -- Float.divide forces α := Float
                     -- emits: function halve(x) { return x / 2.0; }
                     -- (the emitted 2 is Float's fromNat applied at compile time — see §5)

-- (f) Mixed constraints, still defaultable.
let s = toString (add 1 2)
                     -- α carries {Num α, Show α}; α unresolved at generalisation;
                     -- both constraints are defaultable ⇒ α := Int ⇒ s : String
                     -- emits: const s = Int.toString(1 + 2)  (or the folded "3", see §5)

-- (g) BigInt suffix never coerces outward.
fun f x = add x 1n   -- f : BigInt -> BigInt   (1n pins the tyvar to BigInt)
add 1.5 1n           -- TYPE ERROR: Float vs BigInt; neither operand is Int.

-- (h) Explicit conversion is the escape hatch.
Rat.fromBigInt 123456789012345678901n   -- big literal into a Rat: explicit, honest

-- (i) BigInt parameter positions pin bare literals.
Rat.create(1, 3)                        -- emits: Rat.create(1n, 3n)

-- (j) An established Int widens into an independently established Signed target.
let count: Int = 3
let cost: Float = 1.50
let total = count * cost                -- Float.fromInt(count) * cost : Float

-- (k) A written face is the arithmetic's home: the operation runs at the annotated type.
let exact: Rat = count + count          -- Rat addition of two injected Ints (§5.1's lift)
let mean: Float = count / 2             -- Frac<Float> division; Int alone has no Frac
```

**BigInt spelling convention.** The `n` suffix is idiomatic when no surrounding
context pins the type (`let y = 1n`), where it is the cheapest annotation, and is
mandatory when the payload exceeds the bare-literal safe range. In an already
`BigInt`-typed position, bare digits are preferred: `Rat.create(1, 3)`. Thus examples
(h) and (i) demonstrate both halves of the convention side by side.

---

## 3. Elaboration (during inference, Algorithm J)

When the inferencer reaches an integer literal `k` (lexed token: digits, no `.`, no `n`, no exponent):

1. Allocate a fresh type variable `α` at the current level.
2. Record the constraint `Num α`, tagged with provenance `LiteralConstraint(span, k)`. Provenance is load-bearing: it is used both for defaulting eligibility (§4) and for error messages (§6).
3. The elaborated term is `App(NumMethod("fromNat", α), NatLit(k))` — i.e. the literal node in the typed AST is *already* a `fromNat` call. Do not keep a separate "maybe-polymorphic literal" node that gets rewritten later; there is exactly one representation, and the "monomorphic case" is an *optimisation on resolved types* (§5), not a different elaboration.

The literal's payload `k` is validated at lex time: it must be an exact non-negative f64 integer, i.e. `0 <= k <= 2^53 - 1`. A bare literal outside that range is a **compile error** with a fixit suggesting the `n` suffix ("integer literal exceeds Int range; write `...n` for a BigInt, or use an explicit conversion"). Rationale: the payload is a `Nat` within the shared safe-integer range by construction, so `fromNat` never receives a value an instance cannot represent, and every instance's `fromNat` stays total *and exact*. Negative source forms remain unary `negate` applied to a non-negative literal payload.

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

**Defaultable constraints (v1.1, closed list):** `Num`, `Signed`, `Eq`, `Ord`, `Show`. All five have `Int` instances in the prelude. The list is a hard-coded set in the compiler, not user-extensible. Maximally dumb on purpose: "unresolved literal var ⇒ Int, always, no negotiation." Do not import Haskell's numeric-defaulting machinery (multiple candidate types, module-local `default` declarations, the interaction with user classes); that machinery is one of Haskell's most complained-about corners, and Hexagon's rule avoids it by having exactly one candidate type and a closed constraint list.

Consequences worth asserting in tests:

- A tyvar with `{Num α}` only: defaults. (`let x = 1`)
- A tyvar with `{Num α, Show α}`: defaults. (`toString (add 1 2)`)
- A tyvar with `{Num α, SomeUserConstraint α}`: does **not** default; proceeds to ordinary generalisation if the binding form allows it, or produces an ambiguity error if it doesn't. Error message should name the non-defaultable constraint (§6).
- A tyvar with an empty constraint set: never defaults (it's not a literal var; ordinary generalisation applies).
- Defaulting is per-tyvar, not per-binding: `let pair = (1, 1.5)` defaults the first component's tyvar to `Int` independently; the `1.5` was never polymorphic.

Note the closed list means a literal used *only* under a user-defined constraint keeps `Num` in its set too (elaboration always adds `Num`), so the "solely defaultable" test correctly fails on the user constraint, not on `Num`.

> **Ordering note (#304).** Within the boundary this rule runs at, defaulting precedes Method Syntax §3.5's row fallback: a pending `DotCall` goal whose receiver settles here re-fires its head-known trigger and resolves as dispatch — `42.show()` means `Show`'s member at `Int`, exactly as bare `show(42)` does. Method Syntax §3.3/§3.5 own the sequencing; nothing about *this* rule's test or its closed list changes, and the ordering reclassifies only programs that were guaranteed errors before it (the fallback row meets the receiver's defaultable constraints, which no row can discharge).

> **Correction (2026-07-28, #135).** The v1.1 list above was a snapshot of a property, not the rule. The rule: **a constraint is defaultable exactly when its `Int` instance ships with the compiler** — membership in the builtin instance table, closed against user code. A user `honor C<Int>` never makes `C` defaultable (§7's rejection of extensible defaulting, unchanged); the set grows only when the language itself adds a prelude constraint whose `Int` instance the compiler supplies. As of this correction the set is `Num`, `Signed`, `Eq`, `Ord`, `Show`, `Pow`, `Hash`, `Integral`. The last three postdate this document, and Integral §8's diagnostics row — a bare `gcd(4, 6)` resolves to `Int` "as usual" — already depended on this reading; taking the five-name list literally would turn that row into an ambiguity error, which is how the drift surfaced (#109, then #135). This document now stops enumerating: a future prelude constraint with a compiler-shipped `Int` instance joins the set by the rule, with no amendment here. The rule box's parenthetical assertion is unchanged and has become the definition — the unification with `Int` succeeds by construction because membership *means* "has a compiler-shipped `Int` instance". Everything else in this section stands, including the guard note directly above: a user constraint still blocks defaulting, and still fails the "solely defaultable" test on itself rather than on `Num`.
>
> *(#344 — where the `Int` instances live moved; the rule did not.)* "Membership in the builtin instance table" now reads: **a pre-registered constraint whose `Int` instance the prelude supplies** — a wired row while `Int` was compiler-wired, the source `honor` block in `stdlib/Int.hex` since its companion milestone. The set is unchanged by the move, and "closed against user code" is now structural rather than merely decreed: the orphan rule (Constraints §5.3, with the companion as `Int`'s home module) leaves no site where user source could legally honor a pre-registered constraint at `Int`, so consulting the instance table for the membership test can no longer see anything user-supplied.

---

## 5. Codegen

### 5.1 Contextual widening of Nat and Int expressions

The checker admits two exact, evidence-directed contextual conversions:

```text
Γ ⊢ expression : Nat    Γ ⊢ Num<target>    target is independently established
───────────────────────────────────────────────────────────────────────────────
Γ ⊢ expression ⇑ target    elaborates as Num<target>.fromNat(expression)

Γ ⊢ expression : Int    Γ ⊢ Signed<target>    target is independently established
──────────────────────────────────────────────────────────────────────────────────
Γ ⊢ expression ⇑ target    elaborates as Signed<target>.fromInt(expression)
```

“Independently established” means that the target is fixed by an annotation, a concrete
operand or argument, a branch or assignment boundary, an already-constrained type
variable — or the seat's **expected type** (Functions §4.3), a written face arriving where
an annotation could have been written. It is not a fresh inference variable whose only
reason to acquire `Num` would be the proposed conversion. Where no expectation lands,
exact unification has priority. The substitution these tests read is the one Functions
§4.3's normative elaboration schedule built: the schedule is the semantics, and two
programs differing only in the order of sibling expressions sharing an undetermined
variable may widen differently, by design (Functions §4.3's ordering pin).

**The expected-type lift — the written type is the arithmetic's home.** At an arithmetic
operation (the `Num`/`Signed`/`Frac`/`Pow` operators, unary negation included) whose
expected type is **concrete** and carries the operator's constraint instance, the expected
type **is** the operation's common type: each operand reaches it by exact unification or
by the two conversions above, and the operation's evidence is selected at it. The
expectation reaches operands recursively — an operand seat of a lifted operation expects
the same type — so a whole arithmetic expression runs at its written type. An expectation
that is a variable, or a concrete type without the instance, lifts nothing: the operation
elaborates from its operands alone, exactly as below. The distinction the lift turns on:
widening a **value** is always exact, but which *algebra an operation runs in* decides
what the value is — and the lift decides it for the written face.

```hexagon
let r: Rat = count + count    // Rat addition of two injected Ints — exact at any magnitude
let r: Rat = 1 + 2            // Rat addition already — literals are polymorphic, nothing to lift
let x: Int = n - m            // n, m : Nat — both widen; Signed<Int> subtraction, possibly negative
let mean: Float = sum / size  // sum, size : Int — Frac<Float> division; Int has no Frac and needs none here
let s = count + count         // no written face: Int addition, as ever
```

The first line is the rule's reason. Without the lift, `count + count` runs at `Int` and
only the finished sum is injected — an exact conversion of a sum the silent-overflow
`Int` addition may already have folded past 2^53. The lift closes the asymmetry between
the first two lines: literals always followed the written face, and established values
now do too. The third and fourth lines are the lift's own acceptances — an operation
whose operand types alone support no instance (`Nat` has no `Signed`, `Int` no `Frac`)
is well-typed exactly when a written face names an algebra that embeds them. The last
line is its boundary: a binding without an annotation has no written face, and arithmetic
happens at the type written on *its own* seat, never one written somewhere later —
`let s = count + count` then `let r: Rat = s` widens the finished `Int` value, exactly
as written. Consequences:

```hexagon
count + count       // Int; no written face, exact match, no widening
count * cost        // Float when cost : Float — the operand establishes the target
plus(count, 1.5)    // Float; selects the Float instantiation of plus
let value: Rat = count        // value widening at the annotation — exact for any Int

let scale<a: Signed>(count: Int, value: a): a = count * value
// generic body: num.multiply(fromInt(count), value), using one Signed<a> dictionary

let repeat<a: Num>(count: Nat, value: a): a = count * value
// generic body: multiply(fromNat(count), value), using Num<a> evidence

let addCount = (count: Int, value) => count + value
// inferred (Int, Int) -> Int; widening does not manufacture Num<a>
```

The source must be exactly `Nat` or `Int`, and the matching rule above is fixed. In
particular, `Int * Nat` widens the `Nat` to `Int`; it never attempts the unsafe
`Int -> Nat` direction. There is no reverse `Float -> Int` conversion, no implicit
`BigInt -> Float`, and no conversion between two unrelated numeric subjects.
A nominal target participates only when its home has explicitly supplied a lawful
`honor Num<T>` and, for Int widening, `honor Signed<T>`; neither is derivable. This is
an evidence-directed injection, not numeric subtyping or a promotion lattice.

Emission follows the selected instance. `Nat -> Int`, `Nat -> Float`, and `Int -> Float`
erase because they use the JavaScript `number` representation; either source into
`BigInt` emits `BigInt(value)`. A concrete nominal instance emits `fromNat` or `fromInt`
as selected; a genuinely polymorphic target emits the corresponding dictionary call.
The source expression is evaluated exactly once and ordinary evaluation order is preserved.
A lifted operation emits the home type's operation over the injected operands —
`let r: Rat = count + count` emits `Rat`'s addition of two `Rat.fromInt` calls — each
operand converted once, in source order; where the home type erases (`Float`), the
lifted emission is byte-identical to the unlifted one.

### 5.2 Literal emission

Two regimes, determined entirely by whether `α` is resolved to a concrete type at emission:

**Resolved (the overwhelmingly common case).** Erase the `fromNat` call and emit the concrete literal directly:

- `α = Nat` → emit `k` (plain JS number). `Nat.fromNat` is the identity.
- `α = Int` → emit `k` (plain JS number). `Int.fromNat` is the identity; do not emit an identity call.
- `α = Float` → emit `k.0`. `Float.fromNat` remains representationally erased — `k` and `k.0` are the same JavaScript number — while the decimal spelling preserves the inferred Hexagon type for a human reading the generated code.
- `α = BigInt` → emit `kn`. (`BigInt.fromNat` folded at compile time. This arises when unification pins a bare literal to BigInt via surrounding code, e.g. `add x 1` with `x : BigInt`.)
- `α = Rat` → emit the canonical-form constructor call with constant arguments, e.g. `Rat.fromNat(k)` or, if you implement constant folding for it, the direct `{top: kn, bottom: 1n}` fast-path constructor. Either is acceptable; the fast path is a nice-to-have.
- Any other instance type → emit `TheType.fromNat(k)` monomorphically (direct call, no dictionary).

**Unresolved-because-polymorphic** (literal inside a function generalised over `Num a`): the dictionary parameter is already in scope under the existing `honor` compilation story; `fromNat` is one more slot in the `Num` dictionary record. Emit `dict.fromNat(k)`. No new mechanism.

This preserves the readable-JS goal: monomorphic code — nearly all code — contains direct `1`, `1.0`, and `1n` literals, with the spelling retaining the resolved fundamental type where JavaScript's representation otherwise cannot. Only genuinely generic functions show dictionary plumbing, and they already did for `add`.

**Dictionary shape change:** `Num` dictionaries gain a `fromNat` field. Every existing and future `honor Num<T>` must supply it. Prelude instances:

```
Nat.fromNat    = identity
Int.fromNat    = identity
Float.fromNat  = identity            (payload guaranteed within 2^53 by lexer, §3)
BigInt.fromNat = n => BigInt(n)
Rat.fromNat    = n => mkFast(BigInt(n), 1n)
```

All five are total and exact. This is a checked property of the design: keep it true for future instances, and document it as a law of `Num`: `fromNat` preserves zero, addition, and multiplication over Nat payloads.

`Signed` dictionaries extend `Num` through one `num` parent slot and add
`subtract`, `negate`, and `fromInt`. `fromInt` is total and exact for `Int`, `Float`,
`BigInt`, and `Rat`; for non-negative inputs it agrees with `num.fromNat`, and for
negative inputs it agrees with negating the corresponding natural magnitude.

---

## 6. Error messages

Elaboration changes the *character* of type errors involving literals, and this is where Haskell beginners bleed. Budget for special-cased reporting using the `LiteralConstraint` provenance from §3:

- When unification fails and one side traces to a literal's `α`, report it as a literal-type mismatch, not a constraint failure. Prefer: `This literal is used as Float here but as BigInt there` over `Cannot satisfy Num constraint arising from...`.
- When defaulting is blocked by a non-defaultable constraint (§4), the error must name the blocking constraint and the literal's location, and suggest an annotation: `The literal 1 at <span> has constraint MyConstraint, which prevents defaulting to Int. Add a type annotation to pin its type.`
- Never surface the name `fromNat` in an error for code the user wrote without mentioning it. The elaboration is invisible machinery; errors should speak in terms of the literal.
- LSP hover on a bare literal in polymorphic position should show `<a: Num> a` (matching the round-trip-consistency rule for signatures — the display is source-shaped, Functions §5.1); hover on a defaulted or pinned literal shows the concrete type.

**Settling at synthesized `Unit` obligations.** Three positions carry a `Unit` obligation the language inserts rather than the user writing it: a discarded non-final block item (Statements §3.2), a loop body (Loops §2.2; `while` identically, Loops §4), and the `then` branch of an else-less `if` (Operators §11.2). A type variable that meets such an obligation is settled to `Int` at that point, ahead of §4's generalisation-time defaulting — provided `Int` satisfies every constraint on the variable and at least one of those constraints has no `Unit` instance. The rule is stated over constraints, not provenance: a literal's variable (§3) is the common case, but a variable constrained only by use (`x + x`) settles identically, and there is no reason to give the two different reports. A **declared** type variable is excluded — an annotation pins it, so settling it would report that annotation as requiring the `Int` the settling itself invented, naming a rewrite that repairs nothing (the Rewrite Rule, Declarations Preamble §1.1).

Without settling, the variable unifies with the synthesized `Unit` structurally and *succeeds* — and the loss is not silence but the wrong voice. The literal's `Num` requirement fails at that same binding, and this section's first rule, doing exactly its job, reports it as `integer literal cannot have type Unit`: literal-voiced, correct, and the wrong position's message, naming the literal where the position should have named the discard or the missing `else`. Settling first makes the unification fail at the demand site, so the position's own report fires — the discard diagnostic, the loop-body report (Loops §10.2), or the mandatory add-an-`else` fixit (Operators §15) — with the first and last naming `Int`. This is a diagnostic-routing rule, not a second defaulting rule: the no-`Unit`-instance guard means it fires only where the binding's own requirement validation was about to fail anyway, so no accepted program's type changes, and §4 — single candidate, closed list, generalisation time — is untouched. User-written `Unit` annotations are out of scope; only the three synthesized obligations above qualify.

A branch or item whose type is *structured* — `(1, 2)`, `[1, 2]` — can never be the demanded `Unit`, so its report is certain before any settling. Its literals settle to `Int` too, by §4's rule rather than the guard above — declared variables again excepted, and named rather than numbered where they survive — so that the report names `(Int, Int)`, or `(Int, a)`, rather than leaking inference variables into a message the Rewrite Rule makes mandatory.

> **Edit note (for Operators §15, applied on next touch):** the "Else-less `if` whose `then` branch is not `Unit`" row covers a bare-literal `then` branch: the literal settles to `Int` before the `Unit` unification (Numeric Literals §6), so this row's fixit fires — naming `Int` — rather than the bind-time `integer literal cannot have type Unit` report.

> **Edit note (for Statements §3.2, applied on next touch):** the discarded-value report covers a bare-literal non-final item: the literal settles to `Int` before the `Unit` unification (Numeric Literals §6), so the discard diagnostic fires and reports the discarded type as `Int` — rather than the bind-time `integer literal cannot have type Unit` report.

---

## 7. Rejected alternatives (do not re-litigate without new information)

**Fully monomorphic literals** (`1 : Int` always). Rejected because `fun addOne x = add x 1` collapses to `Int -> Int`, forcing duplication of any generic numeric code that mentions a constant. The polymorphic scheme costs one `Num` method plus one defaulting rule and recovers Haskell/Roc ergonomics.

**Context-dependent rewriting** ("rewrite the literal to `fromNat` when it appears in a polymorphic context"). Rejected as an implementation strategy — not because the observable behaviour is wrong, but because "polymorphic context" is not syntactically detectable; it is an inference outcome. In `fun f x = add x 1`, whether the `1` is polymorphic depends on what later unification pins `x` to. The uniform elaborate-always + erase-when-resolved strategy (§3, §5) produces the behaviour the context-dependent intuition wants, with a rule that can actually be implemented in one pass.

**`1n` as a polymorphic Num literal** (elaborating via `fromBigInt : BigInt -> a` in `Num`). Rejected for two reasons. (1) It hollows out the suffix: if both `1` and `1n` are polymorphic, `n` no longer means "this is a BigInt", breaking the JS developer's correct intuition — the suffix is supposed to *be* the type annotation, as in JS. (2) It forces `fromBigInt` into `Num`, whose `Float` instance is silently lossy for values beyond 2^53 (`fromBigInt(2n**60n)` rounds without a peep). Haskell's `fromInteger` has exactly this wart; Hexagon doesn't need it because the polymorphic `Nat`-payload literal covers every exact case, and oversized literals go through explicit conversions (`Rat.fromBigInt ...n`).

**Haskell-style generalisation of bare literal bindings** (`let x = 1` giving `x : <a: Num> a`). Rejected: conflicts with the "no defaulting negotiation" goal, produces dictionary-abstracted values where users expect constants, and interacts badly with the value-restriction-adjacent rules already in place (`var` never generalises). Defaulting to `Int` at generalisation is strictly simpler and matches Roc.

**Haskell-style extensible defaulting** (multiple candidate types, `default` declarations). Rejected: single candidate (`Int`), closed defaultable-constraint list, no per-module configuration. See §4.

**Polymorphic decimal literals via `Frac`/`fromFloat`.** Deferred, not rejected — but blocked on a real design question (exact-binary vs decimal-intended conversion for `Rat`), so v1 pins `1.5 : Float`.

---

## 8. Implementation checklist

1. **Lexer:** ensure three distinct token kinds (IntLit, BigIntLit, FloatLit). Range-check IntLit payload against 2^53−1; emit the fixit error otherwise. BigIntLit payload stored losslessly.
2. **Prelude / constraint defs:** add `fromNat : Nat -> a` to `Num` and `fromInt : Int -> a` to `Signed`; implement the five `Num` and four `Signed` prelude instances (§5 table); document the exact-homomorphism law.
3. **Inference:** elaborate IntLit per §3 (fresh tyvar, `Num` constraint with `LiteralConstraint` provenance, `fromNat` application node). BigIntLit/FloatLit type directly.
4. **Generalisation:** insert the defaulting pass per §4, testing membership against the compiler's own `Int` instance table — the closed defaultable set of §4's correction record, not the v1.1 five-name list *(corrected 2026-07-28, #135)*. Assert successful unification with Int.
5. **Codegen:** implement contextual Nat and Int widening per §5.1; erase resolved literal `fromNat` per §5.2 (`k` for Nat/Int, readable `k.0` identity folding for Float, `kn` folding for BigInt, constructor call for Rat/others); dictionary slots for polymorphic cases.
6. **Diagnostics:** literal-aware unification errors, blocked-defaulting error, no `fromNat` leakage (§6).
7. **LSP:** hover types per §6; signature round-trip consistency (`<a: Num> a -> a -> a` etc.) unchanged.
8. **Tests:** the eight examples in §2 as golden tests (inferred type + emitted JS), plus the §4 consequence list, plus an error-message snapshot for (g) and the blocked-defaulting case.
