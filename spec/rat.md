# Hexagon Spec: `Rat`

**Status:** Decided (July 2026).
**Scope:** The v1 exact rational type, its representation invariant, construction,
arithmetic, ordering, display, hashing, JavaScript representation, and acceptance
tests.
**Companions:** `integral-constraint.md`, `division-remainder.md`,
`numeric-literals.md`, `constraints.md`, and the future complete stdlib listing.

---

## 1. Doctrine

`Rat` is the exact fraction type. It is an opaque nominal value represented by two
`BigInt`s. Construction always reduces the fraction and keeps the bottom
positive, so equality and hashing can use the canonical pair directly.

Decimal literals remain `Float`; v1 does not infer `Rat` from `0.5`. Exactness is
requested visibly through `Rat.create(1, 2)` or an operation returning `Rat`.

## 2. Representation and invariant

The stdlib declaration has this semantic shape:

```hexagon
export opaque record Rat derives Eq = {
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

`create` throws `DivideByZeroError` when the bottom is zero. Otherwise it:

1. computes `g = top.gcd(bottom)` — `Integral<BigInt>`'s member, spelled as the dot call (Method Syntax §7; the qualified `BigInt.gcd` remains equally legal, #344) — with the Euclidean
   algorithm and its non-negative Euclidean remainder step;
2. divides both values by `g` with the `quot` member, dot-called the same way; and
3. negates both results when the reduced bottom is negative, so the canonical bottom
   is always positive and any negative sign is always carried by the top.

The accessors expose the canonical values, never mutable storage.

## 4. Arithmetic

The v1 companion supplies `add`, `subtract`, `multiply`, `divide`, `negate`, and
`reciprocal`. Every result passes through `create`; implementations may cancel
common factors before multiplication as a transparent optimization.

Division checks its right operand explicitly and throws `DivideByZeroError` with
the provenance-tagged message `Rat.divide: divisor is zero`. `reciprocal(0)`
throws the same exception through the smart construction boundary. Addition and
multiplication never round. `Num<Rat>` owns those operations and defines
`fromNat(n)` as `n / 1`; `Signed<Rat>` adds subtraction, negation, and
`fromInt(n)` as `n / 1`; `Frac<Rat>` owns exact division. Unlike `Frac<Float>`,
it never rounds and has no IEEE infinity or `NaN` result: a zero divisor throws
`DivideByZeroError`.

`Pow<Rat>` owns exponentiation under the **integer-exponent guard** (Operators
§6.3): `pow(x, y)` is exact for integer-valued exponents of either sign — the
predicate is a canonical bottom of `1n` — and a negative exponent inverts the
base first, so `pow(2/3, -2/1)` is exactly `9/4`, the case `Pow<Int>`
structurally cannot serve. A non-integer exponent throws
`FractionalExponentError`, declared in `stdlib/Pow.hex` beside
`NegativeExponentError`: an irrational result cannot be a `Rat`. A zero base
with a negative integer exponent reaches the existing `DivideByZeroError`
through the smart-construction boundary, like every other vanishing denominator.
Where the two conditions overlap, the integrality guard is checked **first** —
`pow(0/1, -1/2)` throws `FractionalExponentError`, not `DivideByZeroError` — so
the guard stays a predicate of the exponent alone, decided before the base is
consulted. The guard's predicate is statable of the operands alone, never of
the base's factorization — perfect-power extraction is rejected permanently, in
any spelling (Operators §13; friendly-numerics tenet 5). The exponentiation itself is exact `BigInt` power on
the canonical pair; nothing converts to `Float`, even internally.

## 5. Constraints

- `Eq<Rat>` compares the canonical top and bottom.
- `Ord<Rat>` compares cross-products exactly with `BigInt`; it never converts to
  `Float`.
- `Show<Rat>` emits `top/bottom`, including `/1` so the representation
  remains visible and unsurprising.
- `Hash<Rat>` combines the canonical `BigInt` top and bottom hashes.
- `Num<Rat>`, `Signed<Rat>`, and `Frac<Rat>` are provided. Num owns addition,
  multiplication, and exact `fromNat`; Signed extends it with subtraction, negation,
  and exact `fromInt`; Frac supplies exact division through `create`.
- `Pow<Rat>` is provided under the integer-exponent guard (§4): exact at
  integer-valued exponents of either sign, `FractionalExponentError` otherwise.
- `Integral<Rat>` is not provided: a rational is not an integer.

## 6. Surface

The minimum v1 companion inventory is:

```hexagon
Rat.create
Rat.top
Rat.bottom
Rat.add
Rat.subtract
Rat.multiply
Rat.divide
Rat.negate
Rat.reciprocal
Rat.pow
Rat.toFloat
```

All binary operations are subject-first and therefore dot-callable.

`Rat.toFloat` is the sanctioned exit from the exact world (friendly-numerics
tenet 7). Within range it answers the **correctly rounded nearest double** —
one rounding, ties to even. Rounding error is what an approximation *is*; no
exception attends it, and no apology. It throws `FloatRangeError` exactly where
the honest IEEE answer would not be an approximation at all: **the result must
be finite, and nonzero when the input is nonzero.** Overflow past `Float`'s
finite range would fabricate ±Infinity — infinite error — and the erasure of a
nonzero rational to `0` would be a total one; both ends fail the same one-line
guard. The exception's declared home is `stdlib/Float.hex`: the error is
`Float`'s range, stated once where any door from the exact world can share it
(the `DivideByZeroError`-in-`Integral.hex` pattern), and the brand follows the
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

- A zero bottom reports `DivideByZeroError` and rewrites toward a nonzero
  bottom or explicit validation before `Rat.create`.
- Division by a zero `Rat` reports `DivideByZeroError` at `Rat.divide` with
  `Rat.divide: divisor is zero`.
- Attempts to access fields outside Rat's home module receive the standard opaque
  record diagnostic and point to `Rat.top` / `Rat.bottom`.
- A non-integer exponent at `Rat.pow` reports `FractionalExponentError` with the
  provenance-tagged message `Rat.pow: exponent is not an integer`.
- A zero base with a negative exponent at `Rat.pow` reports `DivideByZeroError`
  through the smart-construction boundary; no `Rat.pow`-specific message is
  minted for it.
- An out-of-range conversion at `Rat.toFloat` reports `FloatRangeError` with the
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
Rat.create(1, 0)                              -- DivideByZeroError
Rat.pow(Rat.create(2, 1), Rat.create(10, 1))
    == Rat.create(1024, 1)                        -- true
Rat.pow(Rat.create(2, 3), Rat.create(-2, 1))
    == Rat.create(9, 4)                           -- true (negative exponent inverts, exact)
Rat.pow(Rat.create(4, 9), Rat.create(1, 2))   -- FractionalExponentError
Rat.pow(Rat.create(0, 1), Rat.create(-1, 1))  -- DivideByZeroError
Rat.pow(Rat.create(0, 1), Rat.create(-1, 2))  -- FractionalExponentError (guard checked first)
Rat.toFloat(Rat.create(1, 2))                 -- 0.5
Rat.toFloat(Rat.create(1, 3))                 -- 0.3333333333333333 (nearest double)
Rat.toFloat(Rat.create(-7, 4))                -- -1.75
Rat.toFloat(Rat.create(2 ** 1100, 1))         -- FloatRangeError (would be Infinity)
Rat.toFloat(Rat.create(1, 2 ** 1100))         -- FloatRangeError (nonzero would erase to 0)
```

The compiler conformance suite must execute the emitted JavaScript for normalization
and arithmetic; checking inferred types or snapshots alone is insufficient.
