# Hexagon Spec: Numeric Literals

**Status:** Decided (July 2026); §5.1 amended September 2026 for #808 — the tower is a closed list and the expected-type lift governs every spelling of a tower member call.
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
7. **Contextual numeric widening:** an established `Nat` may be injected through `Num<a>.fromNat`; an established `Int` may be injected through `Signed<a>.fromInt`. The target must be independently established — by an annotation, a concrete operand, a boundary, or (at a tower member call only, through the expected-type lift) the seat's expected type — and widening never invents a polymorphic target merely to make an expression type-check. At a tower member call — an operator, or the same member spelled bare, qualified, as a pipe stage, or by the dot (Method Syntax §1; #808) — whose expected type is concrete **and carries the member's constraint instance**, that type is the operation's home: the operands widen in and the operation runs at the written type — at `**`, the base alone; the exponent seat is the member's concrete `Int` parameter and never joins (§5.1, Operators §6.3) — without the instance, or where no expectation lands, the operation elaborates from its operands and exact unification wins first (§5.1).

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

Decimal literals: elaborate directly to `FloatLit`, type `Float`. (Future work note: decimal-literal polymorphism is explicitly deferred — a design task, not an implementation task (#525). It cannot ride a `fromFloat` method: a `Rat` `fromFloat` exists in no spelling, ever (friendly-numerics tenet 7) — the exact binary conversion of the double nearest `0.1` is not what a user writing `0.1` means, and a `Float` entering `Rat` would receive manufactured exactness — so any future design must carry the literal's written digits, never the parsed double.)

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
variable — or, **at a tower member call the expected-type lift below governs**, the
seat's expected type (Functions §4.3), a written face arriving where an annotation could
have been written. The expectation route exists only through the lift: at every other
position an expectation establishes no widening target of its own (Functions §4.3's
ordering pin), and a value reaches a written face by the seat's ordinary widening, as
this list always allowed. The target is never a fresh inference variable whose only
reason to acquire `Num` would be the proposed conversion. Where no expectation lands,
exact unification has priority. The substitution these tests read is the one Functions
§4.3's normative elaboration schedule built: the schedule is the semantics, and two
programs differing only in the order of sibling expressions sharing an undetermined
variable may widen differently, by design (Functions §4.3's ordering pin).

**The tower** *(#808)*. The tower is the closed family of constraints whose members this
section's conversions and lift serve: `Num`, `Signed`, `Frac`, `Pow`, and `Integral` — the
prelude's rungs, and no others. Each rung owns the exact conversion from the type below it
(`Num.fromNat`, `Signed.fromInt`), and a type's widenings are exactly the slots it fills:
no rung owns a conversion from `BigInt` (§7), so `BigInt` is never a source, and `Frac`
owns no conversion from `Rat` (`Float` honors `Frac`), which is friendly-numerics tenet
7's membrane stated as a missing member. `Eq` and `Ord` are not rungs: a comparison across
widths (`i < b`, `i.compare(b)`) widens because the member's seats are widening targets
like any seat, not through the lift. **The rungs are the language's own and the list is
closed.** A type — `Rat`, or a user's `Decimal` — joins the tower by honoring the rungs
lawfully (below), never by adding one; a user constraint bounded on `Num` is an ordinary
constraint outside the tower, served by the ordinary seat widening and nothing more. The
closure is what keeps Method Syntax §4.2's ownership clause finite — a collision at the
source types is then always an author's own honoring, never the existence of a constraint
elsewhere — and the tower's behaviour statable in one paragraph; a new rung is a design
ruling on the footing of a new prelude bare name (Modules §5.5). A **tower member call**
is a call of a subject-first member of a rung whose result type is the subject, in
whatever spelling — operator, bare, qualified, pipe stage, or dot; the operators are its
everyday spellings and elaborate to nothing else (Operators §1.1). The tower member
**spellings** — the names that can spell such a call — are exactly `add` and `multiply`
(`Num`), `subtract` and `negate` (`Signed`), `divide` (`Frac`), `pow` (`Pow`), and `div`,
`mod`, `quot`, `rem`, and `gcd` (`Integral`); this list, and each spelling's rung, is what
Method Syntax §2.2's receiver rule reads.

**The expected-type lift — the written type is the arithmetic's home.** At a tower member
call — the `Num`/`Signed`/`Frac`/`Pow` operators, unary negation included; the member
spelled bare, qualified through its constraint, as a pipe stage, or by the dot (Method
Syntax §1, §7), a companion-qualified spelling being a written face, below; `Integral`'s
`div`, `mod`, `quot`, `rem`, and `gcd` included, though no operator spells them *(#808)* —
whose expected type is **concrete** and carries the member's constraint instance, the
expected type **is** the operation's common type: each operand reaches it by exact
unification or by the two conversions above, and the operation's evidence is selected at
it. Where an operand can reach it by neither — a `Float` under a `Rat` face, a user type
under `BigInt` — the lift **stands down**: the operation elaborates from its operands
alone, exactly as below, and whatever mismatch remains surfaces where the result meets its
seat (`let total: Rat = count * price` is refused at the binding rather than at the
operation) — and that refusal names the operand that declined the face, so the report
keeps the information the lift's own refusal carried: "`price` is a `Float` and cannot
enter `Rat`, so the multiplication ran at `Float`" (§6). No accepted program changes,
because a declined operation's result must still fit what consumes it; a refusal becomes
an acceptance only where the surrounding program types, as at a dot chain whose outer call
is a companion export (Method Syntax §2.2's receiver rule). The expectation reaches
operands recursively — an operand seat of a lifted operation expects the same type, a dot
call's receiver included under Method Syntax §2.2's receiver rule, which hands it the
call's expectation before it elaborates when the spelling's rung is honored at the face —
so a whole arithmetic expression runs at its written type in every spelling, `(a +
b).multiply(c)` and `a.add(b).multiply(c)` as much as `(a + b) * c`. At `**` the common
type governs the **base seat only**: the exponent seat is the member's concrete `Int`
parameter (Operators §6.3), an ordinary written-`Int` seat that neither joins the common
type nor receives the outer expectation — this rule applies *into* it independently, with
`Int` as the written face, which is how the right spine of an exponent tower runs at `Int`
whatever the base's home. An expectation that is a variable, or a concrete type without
the instance, lifts nothing: the operation elaborates from its operands alone, exactly as
below. The distinction the lift turns on: widening a **value** is always exact, but which
*algebra an operation runs in* decides what the value is — and the lift decides it for the
written face.

```hexagon
let r: Rat = count + count    // Rat addition of two injected Ints — exact at any magnitude
let r: Rat = 1 + 2            // Rat addition already — literals are polymorphic, nothing to lift
let x: Int = n - m            // n, m : Nat — both widen; Signed<Int> subtraction, possibly negative
let mean: Float = sum / size  // sum, size : Int — Frac<Float> division; Int has no Frac and needs none here
let s = count + count         // no written face: Int addition, as ever
let whole: BigInt = count.add(count)    // the same lift, spelled by the dot — BigInt addition
let next: BigInt = count |> Num.add(1)  // and as a pipe stage — never Int addition injected after
```

A **companion**-qualified spelling of a member (`Float.multiply`, `Int.multiply`) is not a
further spelling of the open call but a **written face** of it (Modules §5.3's migration
principle keeps `Int.multiply` substitutable for a plain `Int.multiply(a: Int, b: Int):
Int`): operands widen *into* it and it lifts nothing beyond itself — `Float.multiply(count,
price)` runs at `Float`; `Int.multiply(count, price)` refuses, exactly as `let t: Int =
count * price` does.

The first line is the rule's reason. Without the lift, `count + count` runs at `Int` and
only the finished sum is injected — an exact conversion of a sum the silent-overflow `Int`
addition may already have folded past 2^53. The lift closes the asymmetry between the
first two lines: an established value follows the written face exactly as a literal does.
The third and fourth lines are the lift's own acceptances — an operation whose operand
types alone support no instance (`Nat` has no `Signed`, `Int` no `Frac`) is well-typed
exactly when a written face names an algebra that embeds them. The last line is its
boundary: a binding without an annotation has no written face, and arithmetic happens at
the type written on *its own* seat, never one written somewhere later — `let s = count +
count` then `let r: Rat = s` widens the finished `Int` value, exactly as written. Said
without faces: the *lift* works within one expression — an expected type travels to a
subexpression through the forms Functions §4.3 forwards through, and at a tower member
call the operand seats are the lift's own channel, the one §4.3 names as not forwarding; a seat's own expected type establishes the target directly, per the list above — and what stops it is a binding: a separate binding is a separate expression, which has whatever type the first was given; its value still widens at its own seat, as `let r:
BigInt = s` shows, but its arithmetic has already run. The instance gate is equally a boundary, and it is what keeps every *instance-gated* decline identical to the ungated elaboration (the operand stand-down above declines differently: its result then meets a seat that refuses it):
at `let t: T = a ** b` (`a, b : Int`) for a nominal `T` honoring `Num` and `Signed` but
not `Pow`, the expectation lifts nothing, so the power runs at `Int` and the finished
value injects, exactly as this section always read. The gate's remaining subjects are
exactly such user nominals: since `Rat` honors `Pow` (Operators §6.3), every tower face
reachable by injection carries the constraint of every operator whose operand elaboration
can land at `Nat` or `Int` — `+`, `-`, `*`, `**`, unary negation — so no in-tower written
face is ever gated out: a tower face either lifts or (where the operand elaboration itself
has no instance, as at `Int` division) refuses. Consequences:

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
operand converted once, in source order. For the `Num`/`Signed` operators at an erasing
home (`Float`), the lifted emission is byte-identical to the result-injected one — the
same JavaScript `+`/`-`/`*` on the same doubles. The lift's home selection is
observable exactly where the instances differ: at a wider-than-f64 home (`BigInt`,
`Rat`), where it is the exactness this rule exists for, and at `**`, where the base's
home decides the guard: `let x: Float = a ** b` selects `Pow<Float>` — total, a negative
exponent an ordinary float reciprocal power — and `let r: Rat = a ** b` selects
`Pow<Rat>` — exact at either sign — where operand-driven selection took `Pow<Int>` with
its negative-exponent throw (Operators §6.3). The exponent `b` stays an `Int` in every
one of these: only the base's algebra moves with the written face.

Conformance pins the lift owes (fixtures: `n, m : Nat`; `a, b, c, count, sum, size : Int`;
`b` value 4; `negOne : Int`, value −1): the two acceptances (`let x: Int = n - m`;
`let mean: Float = sum / size` and `let r: Rat = a / b`); one observable-exactness case
at a wider-than-f64 home (a `Rat` or `BigInt` sum whose `Int` elaboration would fold
past 2^53, value-checked); the `Pow` home selections (`let x: Float = 2 ** negOne`
yields `0.5`, no guard; `let r: Rat = b ** negOne` yields exactly `1/4`, value-checked —
the negative exponent `Pow<Int>` would have thrown on; in both, the exponent seat stays
`Int` — the lift moves the base alone); the base-seat-only boundary (`let x: Float =
a ** b` leaves `b : Int` at the exponent seat — no conversion of `b` to `Float` is
emitted or permitted); the gated decline at the gate's remaining subject
(`let t: T = a ** b` for a user nominal `T` honoring `Num` and `Signed` but not `Pow` —
`Int` power, result injected); the no-face boundary (`let s = count + count` stays
`Int`); and the recursion depth (`let r: Rat = (a + b) * c` runs entirely at `Rat`). *(#808.)*
Since the lift governs every spelling (further fixtures: `big : BigInt`; `price :
Float`), the spelled rows: `let r: BigInt = a.add(c)`, `let r: BigInt = Num.add(a, c)`,
`let r: BigInt = a |> Num.add(c)`, and `let q: BigInt = Integral.div(a, c)` each run at
`BigInt` (the additions value-checked past 2^53); the operand-driven rows `a.add(big)`,
`big.add(a)`, `count.multiply(price)`, and `price.multiply(count)` accepted at the wider
operand's type; `Int.multiply(count, price)` refused as a written face; and `let d: Int = n.subtract(m)` accepted through Method Syntax §4.2's ownership clause with both `Nat`s injected. The receiver rule and the stand-down owe two more (#808, after #815's review): the dot-chain recursion `let r: BigInt = a.add(b).multiply(c)` value-checked past 2^53 against `(a + b) * c`; and the stand-down's report, `let total: Rat = count * price` refused *at the binding*, its message naming `price` as the operand that could not enter `Rat`.

### 5.2 Literal emission

Two regimes, determined entirely by whether `α` is resolved to a concrete type at emission:

**Resolved (the overwhelmingly common case).** Erase the `fromNat` call and emit the concrete literal directly:

- `α = Nat` → emit `k` (plain JS number). `Nat.fromNat` is the identity.
- `α = Int` → emit `k` (plain JS number). `Int.fromNat` is the identity; do not emit an identity call.
- `α = Float` → emit `k.0`. `Float.fromNat` remains representationally erased — `k` and `k.0` are the same JavaScript number — while the decimal spelling preserves the inferred Hexagon type for a human reading the generated code.
- `α = BigInt` → emit `kn`. (`BigInt.fromNat` erased: the literal *is* a `BigInt` at this type, §1 rule 6 — a type fact, not a constant-folding of a value. This arises when unification pins a bare literal to BigInt via surrounding code, e.g. `add x 1` with `x : BigInt`.)
- `α = Rat` → emit the canonical-form constructor call with constant arguments, e.g. `Rat.fromNat(k)` or the direct `{top: kn, bottom: 1n}` fast-path constructor — the literal's `Rat` form, a type fact as in the `BigInt` row, not a folding of a value. Either is acceptable; the fast path is a nice-to-have.
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

**Polymorphic decimal literals.** The polymorphism is deferred, not rejected (#525) — but the `fromFloat` route to it *is* rejected: a `Rat` `fromFloat` exists in no spelling, ever (friendly-numerics tenet 7 — exact binary conversion would mint exactness the double never had), so the open design question is how a literal's written digits reach an exact instance, not which conversion to bless. v1 pins `1.5 : Float`.

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
