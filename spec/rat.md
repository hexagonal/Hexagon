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
`BigInt`s. Construction always reduces the fraction and keeps the denominator
positive, so equality and hashing can use the canonical pair directly.

Decimal literals remain `Float`; v1 does not infer `Rat` from `0.5`. Exactness is
requested visibly through `Rat.create(1n, 2n)` or an operation returning `Rat`.

## 2. Representation and invariant

The stdlib declaration has this semantic shape:

```hexagon
export opaque record Rat derives Eq = {
  numerator: BigInt,
  denominator: BigInt,
}
```

Every observable `Rat` satisfies:

- `denominator > 0n`;
- `gcd(abs(numerator), denominator) == 1n`; and
- zero has the single representation `0n / 1n`.

The two-field object is the erased JavaScript representation. Opacity prevents
foreign Hexagon modules from constructing a non-canonical pair or reading fields
directly. JavaScript receives the ordinary opaque private-brand TypeScript face.

## 3. Construction and observation

```hexagon
Rat.create(numerator: BigInt, denominator: BigInt): Rat
Rat.numerator(value: Rat): BigInt
Rat.denominator(value: Rat): BigInt
```

`create` throws `ZeroDenominatorError` when the denominator is zero. Otherwise it:

1. computes `g = BigInt.gcd(numerator, denominator)` with the Euclidean
   algorithm and its non-negative Euclidean remainder step;
2. divides both values by `g` with `BigInt.quot`; and
3. negates both results when the reduced denominator is negative.

The accessors expose the canonical values, never mutable storage.

## 4. Arithmetic

The v1 companion supplies `add`, `subtract`, `multiply`, `divide`, `negate`, and
`reciprocal`. Every result passes through `create`; implementations may cancel
common factors before multiplication as a transparent optimization.

Division and `reciprocal(0)` throw `ZeroDenominatorError` through the same smart
construction boundary. Addition and multiplication never round. `Num<Rat>` uses
this family and defines `fromInt(n)` as `n / 1`.

## 5. Constraints

- `Eq<Rat>` compares the canonical numerator and denominator.
- `Ord<Rat>` compares cross-products exactly with `BigInt`; it never converts to
  `Float`.
- `Show<Rat>` emits `numerator/denominator`, including `/1` so the representation
  remains visible and unsurprising.
- `Hash<Rat>` combines the canonical `BigInt` numerator and denominator hashes.
- `Num<Rat>` is provided. `Integral<Rat>` and `Frac<Rat>` are not: a rational is not
  an integer, while v1 `Frac` owns IEEE-style `/` and is deliberately not the exact
  fraction abstraction.

## 6. Surface

The minimum v1 companion inventory is:

```hexagon
Rat.create
Rat.numerator
Rat.denominator
Rat.add
Rat.subtract
Rat.multiply
Rat.divide
Rat.negate
Rat.reciprocal
```

All binary operations are subject-first and therefore dot-callable. Additional
conversion conveniences belong to the stdlib listing and must not weaken exactness.

## 7. Emission

`Rat` requires no compiler-special runtime representation. It is a normal opaque
record implemented in the prelude/stdlib using the primitive `BigInt` division and
`Integral` operations. This is intentional: Rat is the first conformance client of
those general mechanisms, not a privileged compiler type.

## 8. Diagnostics

- A zero denominator reports `ZeroDenominatorError` and rewrites toward a nonzero
  denominator or explicit validation before `Rat.create`.
- Division by a zero `Rat` reports `ZeroDenominatorError` through `Rat.create`.
- Attempts to access fields outside Rat's home module receive the standard opaque
  record diagnostic and point to `Rat.numerator` / `Rat.denominator`.

## 9. Acceptance tests

```hexagon
Rat.create(2n, 4n) == Rat.create(1n, 2n)       -- true
Rat.create(1n, -2n) == Rat.create(-1n, 2n)     -- true
Rat.create(0n, 99n) == Rat.create(0n, 1n)      -- true
Rat.create(1n, 2n) + Rat.create(1n, 3n)
  == Rat.create(5n, 6n)                         -- true
show(Rat.create(10n, 12n))                      -- "5/6"
Rat.create(1n, 0n)                              -- ZeroDenominatorError
```

The compiler conformance suite must execute the emitted JavaScript for normalization
and arithmetic; checking inferred types or snapshots alone is insufficient.
