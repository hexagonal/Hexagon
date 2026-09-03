# Hexagon Spec: Friendly Numerics

**Status:** Doctrine, named and decided (August 2026, #517).
**Scope:** The design doctrine governing Hexagon's entire numeric surface: the seven tenets, the two-worlds shape of the tower, and the comparative position against the ML family. This file names principles and points at the specifications that enforce them.
**Not in scope:** Any language rule. Every rule cited here lives in its owning spec, and where this file's phrasing and an owning spec appear to disagree, the owning spec wins — this file is doctrine, not a second rulebook.
**Companions:** Numeric Literals (literal machinery, defaulting, contextual widening, the expected-type lift), Operators (the arithmetic family, `Pow`, mathematics-first precedence), Functions §4.3 (the elaboration schedule expectations ride), Primitive Types, `rat.md`, `division-remainder.md`, `integral-constraint.md`.

---

## 1. The doctrine

> Arithmetic in Hexagon behaves the way arithmetic behaves in mathematics, or it refuses to behave at all. It never silently does a third thing.

Every ML in Hexagon's ancestry has felt the desire behind this sentence and stopped partway. Haskell made literals polymorphic and kept `fromIntegral` ceremony at every variable crossing — its community's oldest standing complaint. F# adopted type-directed widening over a normative checking order and applied it only to finished results, so `let x: float = 1 / 3` compiles to `0.0`: integer division first, faithful conversion of the wrong answer second. OCaml split the operators (`+` and `+.`); SML overloaded one spelling with `int` defaulting; both declined the question. Hexagon's friendliness is contractual: it obeys a written face or refuses, and converts exactly or not at all. Hexagon names the desire as doctrine and follows it to its conclusions; the tenets below are those conclusions, and each one is enforced by normative text elsewhere in this corpus.

The doctrine's diagnostic specimen is the program that has trapped C learners for fifty years:

```hexagon
let toCelsius(f: Int): Float = (f - 32) * 5 / 9   // real division, correct for every input
let exact(f: Int): Rat = (f - 32) * 5 / 9         // the same expression, exact
let broken(f: Int) = (f - 32) * 5 / 9             // compile error: no algebra was named
```

Correct, exact, or refused. Never a silent `0`.

## 2. The tenets

1. **Mathematics first.** ℕ ⊂ ℤ ⊂ ℚ are facts, and the checker agrees with the algebra it models: exact embeddings may be silent (Numeric Literals §5.1's contextual widening — two conversions, evidence-directed, never the lossy direction), and every lossy or unrelated conversion is a named call. Precedence itself follows mathematics over JavaScript (Operators §1.3).

2. **The written type is the arithmetic's home.** At a tower member call — an operator, or the same member spelled bare, qualified, piped, or by the dot — whose seat lands a concrete expected type carrying the member's constraint instance, the operation runs *at that type* — operands widen in; the whole written tree lifts (Numeric Literals §5.1's expected-type lift, riding Functions §4.3's normative elaboration schedule). An established value follows the written face exactly as a literal does, so `let r: Rat = count + count` is exact `Rat` addition, not `Int` addition converted after the damage. Every spelling of a tower member is the one operation, elaborated through the same widening: `count.multiply(price)` is `Float` exactly as `count * price` is, and `let r: BigInt = i.add(j)` is `BigInt` addition exactly as `i + j` is under that face (Method Syntax §1). The receiver decides what is called; the operation decides where it runs.

3. **Precision is free.** Declaring the honest type — `Nat` for a count, `Rat` for an exact quantity — costs its users nothing at the boundaries, because the exact embeddings are silent. The incentive gradient of the type system points toward truthful signatures, never toward the imprecise type that spares callers ceremony.

4. **Refuse rather than guess.** Where no written face names an algebra and none is derivable, the program is refused — never given a silently-chosen arithmetic. `/` always means fractional division and `Int` deliberately has no `Frac` instance, so `1 / 3` without a face is a compile error rather than `0` (Operators §6.1; integer division is the named `Integral` family, `division-remainder.md`). Defaulting stays maximally dumb — one candidate type, `Int`, closed list (Numeric Literals §4) — precisely so that no second candidate ever guesses on the user's behalf.

5. **Algebra commutes with definedness.** Whether an operation succeeds is a statable predicate of its operands — the exponent is an integer (a predicate strong enough to be the exponent seat's *type*, Operators §6.3); the divisor is nonzero — never an accident of the data's structure, such as a base's prime factorization. Meaning-preserving rewrites must never move the throw boundary: a design under which `(2 * 8) ** (1/2)` succeeds while `2 ** (1/2) * 8 ** (1/2)` throws is disqualified outright, in any spelling, operator or named (Operators §13's perfect-power rejection record).

6. **Partiality is type-owned and honest.** Where a type's algebra runs out, the operation throws an exception named for why, declared by the owning surface: `NegativeExponentError` where a fractional result cannot be an `Int` (Operators §6.3), `DivideByZeroError` where ℚ has no quotient (`rat.md`). Guards are the same species everywhere in the tower: one simple predicate, one named error — and where the predicate can be a *type*, it is one instead of a guard, which is the tenet's strongest form: `Pow`'s `Int` exponent seat retired the fractional-exponent exception entirely (Operators §6.3).

7. **Two worlds, one-way membrane: precision may be spent, never minted.** The tower spans two worlds: the exact world — `Nat` ⊂ `Int`, `BigInt`, `Rat`, where arithmetic means what it says — and the approximate world: `Float`, alone, honestly IEEE. `Float` promises approximation, so anything may honestly become one: safe-range integers cross silently because they are exactly representable (Numeric Literals §5.1's two conversions), and the exact world's named exits are sanctioned — `Rat.toFloat` (`rat.md` §6) and `BigInt.toFloat` (Primitive Types §6): the nearest double in range, throwing where the answer would not *be* an approximation. `Rat` promises precision, so only precise things may enter it — `fromNat`, `fromInt`, `fromBigInt`, `create`, all exact (`rat.md` §5–§6, whose `Ord` row never converts to `Float` even internally) — and no `fromFloat` exists in any spelling, ever, because a `Float` entering `Rat` would receive manufactured exactness: the double nearest `0.1` "converts" to `3602879701896397/36028797018963968`, representation-faithful and meaning-false. Exits from `Float` toward the exact world, where provided, are named doors that state their re-interpretation (`floor`, `round`, truncation); a conversion cannot recover what the value meant, only re-read what it stores.

## 3. What the doctrine governs

A proposed numeric feature — a new tower member, a new conversion, a literal form, an operator instance — must clear all seven tenets before its own design discussion begins; a proposal that fails one is settled by citing the tenet, not by re-arguing it. The tenets themselves change only the way any doctrine in this corpus changes: deliberately, in their own design session, with this file amended to match.

**The tower's rungs are the language's own.** `Num`, `Signed`, `Frac`, `Pow`, `Integral` — a closed list, fixed in Numeric Literals §5.1. They are the tools the language offers, and they stay closed so that no user declaration can put them in conflict: a type joins the tower by honoring the rungs, as `Rat` did and as a user's `Decimal` may, and a user constraint bounded on `Num` is a constraint outside the tower — welcome, ordinary, and served by the ordinary seat widening. The international and cultural surface — currencies, calendars — is a decision about what the standard library ships under this doctrine, never a limit on what a user may honor.

This file states no rule and hosts no conformance obligation. The rules live with their owners, cited above; the owners' conformance sections enforce them.
