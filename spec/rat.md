# Hexagon Spec: `Rat`

**Status:** Decided (July 2026). Amended 2026-11-14 (#1542): a fraction is written and
taken apart with `//` (§3); `Rat` is a prelude module and a `Dec` enters it through
`FromDec` (§5, §10); `Rat` rounds to an integer five ways (§11). Amended 2026-11-14 (#1545):
a bottom or divisor written as a literal zero is refused when the program is compiled
(§3, §4, §8, §9; Division & Remainder §12).
**Scope:** The v1 exact rational type, its representation invariant, construction and
the `//` form, arithmetic, ordering, display, hashing, conversions with `Dec`, rounding
to an integer, JavaScript representation, and acceptance tests.
**Companions:** `operators-logic-precedence.md` (§6.4, the `//` form),
`pattern-matching.md` (§2.10, §7.2), `integer-widening.md` (§9, `FromDec`), `dec.md`,
`modules.md` (§5.3, §5.5), `integral-constraint.md`, `division-remainder.md`,
`numeric-literals.md`, `constraints.md`, and the future complete stdlib listing.

---

## 1. Doctrine

`Rat` is the exact fraction type. It is an opaque nominal value represented by two
`BigInt`s. Construction always reduces the fraction and keeps the bottom
positive, so equality and hashing can use the canonical pair directly.

An unsuffixed decimal literal is `Float` unless the checker already knows its target is
`Rat`: there it is promoted exactly, through `Rat`'s `FromBigInt` and `Frac` instances, so
`let half: Rat = 0.5` is `1/2` and `let tiny: Rat = 1e-9` is `1/1000000000` (Numeric
Literals §5.1, #525). The literal's written digits are read, never the parsed double. An
established `Float` value never becomes a `Rat`.

A fraction is written with `//`: `1 // 3` is one third, and `n // d` takes a fraction
apart in a pattern (§3). `Rat` is a prelude module, seated after `Dec` (§10), so neither
needs an import. A `Dec` enters a `Rat` wherever a `Rat` is the home, as an integer does
(Exact Integer Widening §9); a `Rat` becomes a `Dec` only through a named conversion that
states its places (§10).

## 2. Representation and invariant

The stdlib declaration has this semantic shape:

```hexagon
opaque record Rat derives Eq = {
    top: BigInt,
    bottom: BigInt,
}
```

Every observable `Rat` satisfies:

- `bottom > 0n`;
- `gcd(abs(top), bottom) == 1n`; and
- zero has the single representation `0n / 1n`.

The two-field object is the erased JavaScript representation. Opacity prevents
foreign Hexagon modules from constructing a non-canonical pair or reading fields
directly. JavaScript receives the ordinary opaque private-brand TypeScript face.

## 3. Construction and observation

```hexagon
Rat.create(top: BigInt, bottom: BigInt): Rat
Rat.top(value: Rat): BigInt
Rat.bottom(value: Rat): BigInt
```

`create` throws `DivideByZeroFault` when the bottom is zero, and a call of `create`
whose bottom is written as a literal zero is refused when the program is compiled
(Division & Remainder §12).
Otherwise it:

1. computes `g = top.gcd(bottom)` — `Integral<BigInt>`'s member, spelled as the dot call (Method Syntax §7; the qualified `BigInt.gcd` remains equally legal, #344) — with the Euclidean
   algorithm and its non-negative Euclidean remainder step;
2. divides both values by `g` with the `quot` member, dot-called the same way; and
3. negates both results when the reduced bottom is negative, so the canonical bottom
   is always positive and any negative sign is always carried by the top.

The accessors expose the canonical values, never mutable storage.

**The `//` form** writes a fraction and takes one apart, through `create`, `top`, and
`bottom` and nothing else (Operators §6.4; Pattern Matching §2.10):

```hexagon
let third = 1 // 3                  -- Rat.create(1, 3)
let same = 6 // 10 == 3 // 5        -- True: create reduces
match r
    0 // _ => "zero"
    n // 1 => "the whole number ${n}"
    n // d => "${n} over ${d}"
let n // d = 4 // -5                -- n = -4n, d = 5n
```

As a value, `top // bottom` is `create(top, bottom)`: both sides are integers, and a
zero bottom throws `DivideByZeroFault` with `Rat.create: bottom is zero` when it runs.
A bottom written as a literal zero never runs: `1 // 0` is refused when the program is
compiled, and `1 // zero` faults when it runs (Division & Remainder §12).
As a pattern it matches every `Rat` and binds its canonical top and bottom, so it is
a view of the canonical pair, not of construction history. `//` is a language form,
like `..`, and not a declared pattern: `Rat` exports no pattern, nothing is imported
to write it, and it names the prelude's `Rat` by identity, so a module that declares a
`Rat` of its own still writes the prelude's fraction with it (Intrinsics §7). `create`
remains the canonical constructor name; `//` is the spelling a program writes.

A `//` pattern that its literals show can never match is a dead case and is refused
(Pattern Matching §7.2): a literal bottom of zero or less, or two literal sides not in
lowest terms. The report gives the spelling that matches where one exists: `2 // 6`
names `1 // 3`, and `1 // -3` names `-1 // 3`; a zero bottom has none, and the report
says to remove the case. The programmer lowers the terms; the compiler names the
result.

## 4. Arithmetic

The v1 companion supplies `add`, `subtract`, `multiply`, `divide`, `negate`, and
`reciprocal`. Every result passes through `create`; implementations may cancel
common factors before multiplication as a transparent optimization.

Division checks its right operand explicitly and throws `DivideByZeroFault` with
the provenance-tagged message `Rat.divide: divisor is zero`. A divisor written as a
literal zero, at `/` or at `divide` in any spelling, is refused when the program is
compiled (Division & Remainder §12). `reciprocal(0)` throws the same exception
through the smart construction boundary; neither `reciprocal` nor `pow` is checked
when the program is compiled, since their zero is an operand, not a divisor. Addition and
multiplication never round. `Num<Rat>` owns those operations and defines
`fromNat(n)` as `n / 1`; `Signed<Rat>` adds subtraction, negation, and
`fromInt(n)` as `n / 1`. `FromBigInt<Rat>` supplies `fromBigInt(n)` as
`Rat.create(n, 1)`; the Nat/Int entries delegate to it through
`BigInt.fromNat` / `BigInt.fromInt`. `Frac<Rat>` owns exact division. Unlike `Frac<Float>`,
it never rounds and has no IEEE infinity or `NaN` result: a zero divisor throws
`DivideByZeroFault`.

`Pow<Rat>` owns exponentiation, **exact at either sign of the exponent** —
`pow(value: Rat, exponent: Int)` per the constraint's `Int` exponent seat
(Operators §6.3). A negative exponent inverts the base first, so `pow(2/3, -2)`
is exactly `9/4` — the case `Pow<Int>` structurally cannot serve. A fractional
exponent is refused by the seat's type, at compile time; no runtime guard
exists, and none is needed. A zero base with a negative exponent reaches the
existing `DivideByZeroFault` through the smart-construction boundary, like
every other vanishing denominator. What no `Rat` power will ever consult is
the base's factorization — perfect-power extraction is rejected permanently,
in any spelling (Operators §13; friendly-numerics tenet 5); the analytic power
belongs to the approximate world, through `Float.pow` (Operators §6.3.1). The
exponentiation itself is exact `BigInt` power on the canonical pair, through
the `BigInt.pow` door; nothing converts to `Float`, even internally.

## 5. Constraints

- `Eq<Rat>` compares the canonical top and bottom.
- `Ord<Rat>` compares cross-products exactly with `BigInt`; it never converts to
  `Float`.
- `Show<Rat>` emits `top/bottom`, including `/1` so the representation
  remains visible and unsurprising. The shown text is not the source spelling:
  `1 // 3` shows as `1/3`, the text `Rat.parse` reads (Numeric Parsing).
- `Hash<Rat>` combines the canonical `BigInt` top and bottom hashes.
- `Num<Rat>`, `Signed<Rat>`, and `Frac<Rat>` are provided. Num owns addition,
  multiplication, and exact `fromNat`; Signed extends it with subtraction, negation,
  and exact `fromInt`; Frac supplies exact division through `create`.
- `Pow<Rat>` is provided, exact at either sign of its `Int` exponent (§4); a
  fractional exponent is a type error at the seat, never a runtime throw.
- `Real<Rat>` provides exact same-type absolute value and `Sign` classification
  by comparison with zero (Constraints §7); neither operation converts to `Float`.
- `FromBigInt<Rat>` accepts arbitrary integers exactly; its ordinary evidence
  permits contextual BigInt-source widening under Numeric Literals §5.1.
- `FromDec<Rat>` accepts every `Dec` exactly, as the fraction `unscaled / 10^places`
  (`dec.md` §4); its member is `Rat.fromDec`, and its evidence permits a `Dec` to enter a
  `Rat` home (Exact Integer Widening §9).
- `Integral<Rat>` is not provided: a rational is not an integer.

## 6. Surface

The minimum v1 companion inventory is:

```hexagon
Rat.create
Rat.fromNat
Rat.fromInt
Rat.fromBigInt
Rat.fromDec
Rat.top
Rat.bottom
Rat.add
Rat.subtract
Rat.multiply
Rat.divide
Rat.negate
Rat.reciprocal
Rat.pow
Rat.round
Rat.roundEven
Rat.trunc
Rat.floor
Rat.ceil
Rat.toDec
Rat.toDecEven
Rat.toFloat
```

`top // bottom` is the language's spelling of `create` and of matching on `top` and
`bottom` (§3), not a companion operation.

All binary operations are subject-first and therefore dot-callable.

`Rat.toFloat` is the first sanctioned exit from the exact world (friendly-numerics
tenet 7). Within range it answers the **correctly rounded nearest double** —
one rounding, ties to even. Rounding error is what an approximation *is*; no
exception attends it, and no apology. It throws `FloatRangeFault` exactly where
the honest IEEE answer would not be an approximation at all: **the result must
be finite, and nonzero when the input is nonzero.** Overflow past `Float`'s
finite range would fabricate ±Infinity — infinite error — and the erasure of a
nonzero rational to `0` would be a total one; both ends fail the same one-line
guard. The fault's declared home is `stdlib/Float.hex`: the error is
`Float`'s range, stated once where any door from the exact world can share it
(the `DivideByZeroFault`-in-`Integral.hex` pattern), and the brand follows the
declaring module (Exceptions §7.1), so the home is chosen where the declaration
never needs to move. The reverse direction does not exist in any spelling — no
`fromFloat`, ever: precision may be spent, never minted (tenet 7).

Additional conversion conveniences belong to the stdlib listing and must not
weaken exactness; `toFloat` does not — it is an explicit, guarded exit, and
exactness ends only where the caller names its end.

## 7. Emission

`Rat` requires no compiler-special runtime representation. It is a normal opaque
record implemented in the prelude/stdlib using the primitive `BigInt` division and
`Integral` operations. This is intentional: Rat is the first conformance client of
those general mechanisms, not a privileged compiler type.

`toFloat` must round **once**. `Number(top) / Number(bottom)` is not correctly
rounded when either magnitude exceeds 2^53 — each `Number(…)` rounds, then the
division rounds again. The implementation aligns the quotient to 53 significant
bits by `BigInt` shifts and rounds a single time on the remainder
(scale-and-shift); the conformance suite must pin known double-rounding traps,
not merely round-trips.

## 8. Diagnostics

- A bottom written as a literal zero, at `//` or at `Rat.create` in any spelling, is
  refused when the program is compiled (Division & Remainder §12.5): "a fraction's
  bottom is never zero, so `1 // 0` has no value; write the bottom that was meant",
  with the note "a fraction's bottom written as a literal is checked when the program
  is compiled".
- Any other zero bottom reports `DivideByZeroFault` when it runs and rewrites toward a
  nonzero bottom or explicit validation before `Rat.create`.
- A divisor written as a literal zero, at `/` or at `Rat.divide` in any spelling, is
  refused when the program is compiled (Division & Remainder §12.5): "division by zero: `r / 0` has no value; write
  the divisor that was meant", with the note "a divisor written as a literal is checked
  when the program is compiled".
- Division by any other zero `Rat` reports `DivideByZeroFault` at `Rat.divide` with
  `Rat.divide: divisor is zero`.
- Attempts to access fields outside Rat's home module receive the standard opaque
  record diagnostic and point to `Rat.top` / `Rat.bottom`. A constructor or record
  pattern over `Rat` abroad is refused naming the fraction pattern: "cannot destructure
  opaque record `Rat`; match it with `top // bottom`".
- A `//` side that is a `Rat`, `Dec`, or `Float` is refused at that side with the
  division that was meant (Operators §6.4): "a fraction's top and bottom are integers,
  and `r` is a `Rat` — to divide, write `r / 2`", and at a `Dec` side
  `Rat.fromDec(d) / 2`. `1 // 2 // 3` is refused as a chain.
- A dead `//` pattern is refused as Pattern Matching §7.2 words it, with the spelling
  that matches where one exists: "this case is unreachable; a fraction comes apart in
  lowest terms with a positive bottom, so `2 // 6` never matches — write `1 // 3`"; at
  a zero bottom, "this case is unreachable; a fraction's bottom is never zero — remove
  the case".
- A non-integer exponent at `**` or `Rat.pow` is a compile-time type error at
  the `Int` exponent seat (Operators §6.3's fixit family), not a runtime report.
- A zero base with a negative exponent at `Rat.pow` reports `DivideByZeroFault`
  through the smart-construction boundary; no `Rat.pow`-specific message is
  minted for it.
- An out-of-range conversion at `Rat.toFloat` reports `FloatRangeFault` with the
  provenance-tagged message `Rat.toFloat: value does not fit in Float` — one
  message for both ends of the guard; which end failed is evident from the value.

## 9. Acceptance tests

```hexagon
Rat.create(2, 4) == Rat.create(1, 2)       -- true
Rat.create(1, -2) == Rat.create(-1, 2)     -- true
Rat.top(Rat.create(1, -2))                  -- -1
Rat.bottom(Rat.create(1, -2))               -- 2
Rat.create(0, 99) == Rat.create(0, 1)      -- true
Rat.create(1, 2) + Rat.create(1, 3)
    == Rat.create(5, 6)                         -- true
Rat.create(1, 2) / Rat.create(1, 3)
    == Rat.create(3, 2)                         -- true
show(Rat.create(10, 12))                      -- "5/6"
Rat.create(1, 0)                              -- ERROR: a fraction's bottom is never zero
Rat.create(1, zero)                           -- DivideByZeroFault, after let zero = 0
Rat.pow(Rat.create(2, 1), 10)
    == Rat.create(1024, 1)                        -- true
Rat.pow(Rat.create(2, 3), -2)
    == Rat.create(9, 4)                           -- true (negative exponent inverts, exact)
Rat.pow(Rat.create(4, 9), 0)  == Rat.create(1, 1) -- true (x ** 0 is 1/1)
Rat.pow(Rat.create(0, 1), -1)                 -- DivideByZeroFault
Rat.toFloat(Rat.create(1, 2))                 -- 0.5
Rat.toFloat(Rat.create(1, 3))                 -- 0.3333333333333333 (nearest double)
Rat.toFloat(Rat.create(-7, 4))                -- -1.75
Rat.toFloat(Rat.create(2 ** 1100, 1))         -- FloatRangeFault (would be Infinity)
Rat.toFloat(Rat.create(1, 2 ** 1100))         -- FloatRangeFault (nonzero would erase to 0)
1 // 3 == Rat.create(1, 3)                    -- true
6 // -4                                       -- -3/2
-1 // 3 == -(1 // 3)                          -- true: the sign belongs to the top
1 // 0                                        -- ERROR: a fraction's bottom is never zero
1 // zero                                     -- DivideByZeroFault: Rat.create: bottom is zero
Rat.create(1, 2) / 0                          -- ERROR: division by zero
Rat.reciprocal(0)                             -- DivideByZeroFault: not checked when compiled
let half: Rat = 1.50d - 1                     -- 1/2: the Dec enters the Rat home
(5 // 2).round()                              -- 3n
(-5 // 2).round()                             -- -3n
(5 // 2).roundEven()                          -- 2n
(7 // 2).roundEven()                          -- 4n
(-8 // 3).trunc()                             -- -2n
(-5 // 2).floor()                             -- -3n
(-5 // 2).ceil()                              -- -2n
```

The compiler conformance suite must execute the emitted JavaScript for normalization
and arithmetic; checking inferred types or snapshots alone is insufficient.

## 10. Dec conversions

Rat owns all conversions between the two types, being seated after `Dec` (Modules
§5.3; `dec.md` §4):

```text
Rat.fromDec(value: Dec): Rat
Rat.toDec(value: Rat, places: Int): Dec
Rat.toDecEven(value: Rat, places: Int): Dec
```

`dec.md` §4 owns their exact conversion and rounding contracts. Rat can use
prelude Dec's public constructor and accessors; Dec does not depend on Rat.
Places use `Int`; negative arguments throw `Dec.NegativeDecimalPlacesFault`
before arithmetic, as specified in `dec.md` §3.

`Rat` is a prelude module, seated after `Dec` and `FromDec` (Modules §5.5).
`Rat.fromDec` is the member of `FromDec<Rat>`, so the conversion is also silent: a
`Dec` enters a `Rat` wherever a `Rat` is the expression's home, as an integer does
(Exact Integer Widening §9), and `let share: Rat = 1.50d` is `3/2`. The other direction
stays named: a `Rat` reaches a `Dec` only through `toDec` or `toDecEven`, which state
the places and the tie rule, since most fractions have no exact decimal.

## 11. Rounding to an integer

```text
Rat.round(value: Rat): BigInt
Rat.roundEven(value: Rat): BigInt
Rat.trunc(value: Rat): BigInt
Rat.floor(value: Rat): BigInt
Rat.ceil(value: Rat): BigInt
```

Each returns an integer near the fraction, as a `BigInt`, computed exactly from the
canonical top and bottom with no `Float` intermediate. The five follow `Dec`'s
integer-rounding operations (`dec.md` §5, §7) rule for rule:

- `round` takes the nearest integer, and a fraction exactly halfway between two goes
  to the one further from zero: `(5 // 2).round()` is `3n`, and `(-5 // 2).round()`
  is `-3n`.
- `roundEven` takes the nearest integer, and a fraction exactly halfway goes to the even
  one: `(5 // 2).roundEven()` is `2n`, and `(7 // 2).roundEven()` is `4n`.
- `trunc` drops the fractional part, toward zero: `(-8 // 3).trunc()` is `-2n`.
- `floor` takes the greatest integer no greater than the fraction: `(-5 // 2).floor()`
  is `-3n`.
- `ceil` takes the least integer no less than the fraction: `(-5 // 2).ceil()` is `-2n`.

A whole number rounds to itself under all five. None can fail. They are companion
operations, not constraint members, for the reason `dec.md` §3 gives: `Float.round`
breaks ties to even and `Rat.round` and `Dec.round` away from zero, so no one member
could state the tie rule for every instance. To keep some decimal places instead, use
`toDec` (§10).
