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

1. computes `g = BigInt.gcd(top, bottom)` with the Euclidean
   algorithm and its non-negative Euclidean remainder step;
2. divides both values by `g` with `BigInt.quot`; and
3. negates both results when the reduced bottom is negative, so the canonical bottom
   is always positive and any negative sign is always carried by the top.

The accessors expose the canonical values, never mutable storage.

## 4. Arithmetic

The v1 companion supplies `add`, `subtract`, `multiply`, `divide`, `negate`, and
`reciprocal`. Every result passes through `create`; implementations may cancel
common factors before multiplication as a transparent optimization.

Division and `reciprocal(0)` throw `DivideByZeroError` through the same smart
construction boundary. Addition and multiplication never round. `Num<Rat>` owns
those operations and defines `fromNat(n)` as `n / 1`; `Signed<Rat>` adds subtraction,
negation, and `fromInt(n)` as `n / 1`.

## 5. Constraints

- `Eq<Rat>` compares the canonical top and bottom.
- `Ord<Rat>` compares cross-products exactly with `BigInt`; it never converts to
  `Float`.
- `Show<Rat>` emits `top/bottom`, including `/1` so the representation
  remains visible and unsurprising.
- `Hash<Rat>` combines the canonical `BigInt` top and bottom hashes.
- `Num<Rat>` and `Signed<Rat>` are provided. Num owns addition, multiplication, and
  exact `fromNat`; Signed extends it with subtraction, negation, and exact `fromInt`.
  `Integral<Rat>` and `Frac<Rat>` are not: a rational is not
  an integer, while v1 `Frac` owns IEEE-style `/` and is deliberately not the exact
  fraction abstraction.

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
```

All binary operations are subject-first and therefore dot-callable. Additional
conversion conveniences belong to the stdlib listing and must not weaken exactness.

## 7. Emission

`Rat` requires no compiler-special runtime representation. It is a normal opaque
record implemented in the prelude/stdlib using the primitive `BigInt` division and
`Integral` operations. This is intentional: Rat is the first conformance client of
those general mechanisms, not a privileged compiler type.

## 8. Diagnostics

- A zero bottom reports `DivideByZeroError` and rewrites toward a nonzero
  bottom or explicit validation before `Rat.create`.
- Division by a zero `Rat` reports `DivideByZeroError` through `Rat.create`.
- Attempts to access fields outside Rat's home module receive the standard opaque
  record diagnostic and point to `Rat.top` / `Rat.bottom`.

## 9. Acceptance tests

```hexagon
Rat.create(2, 4) == Rat.create(1, 2)       -- true
Rat.create(1, -2) == Rat.create(-1, 2)     -- true
Rat.top(Rat.create(1, -2))                  -- -1
Rat.bottom(Rat.create(1, -2))               -- 2
Rat.create(0, 99) == Rat.create(0, 1)      -- true
Rat.create(1, 2) + Rat.create(1, 3)
    == Rat.create(5, 6)                         -- true
show(Rat.create(10, 12))                      -- "5/6"
Rat.create(1, 0)                              -- DivideByZeroError
```

The compiler conformance suite must execute the emitted JavaScript for normalization
and arithmetic; checking inferred types or snapshots alone is insufficient.
