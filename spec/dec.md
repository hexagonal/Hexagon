# Hexagon Spec: `Dec`

**Status:** Decided and implemented.
**Scope:** A fundamental prelude decimal type, exact arithmetic, explicit rounding,
numerical comparison and hashing, retained decimal places, and display.
**Companions:** `numeric-literals.md`, `constraints.md`,
`collections-part2-hash-and-type-members.md`, `primitive-types.md`,
`friendly-numerics.md`, `exceptions.md`, and `stdlib-roadmap.md`.

## 1. Purpose and place in the language

`Dec` represents finite decimal numbers exactly. It supports general decimal
calculations and provides explicit rounding operations useful for financial work.
Currency identity, exchange rates as domain values, settlement increments, allocation,
and locale-specific currency formatting belong to later library work.

`Dec` is a fundamental **prelude type**: users need no import to name the type or
its companion. It is an opaque nominal record implemented by Hexagon, not a new
compiler primitive, JavaScript primitive, or dependency on JavaScript's Decimal
proposal. The book introduces it in its Primitive Types chapter, where
"primitive" describes fundamental user-facing types rather than only their
JavaScript representations.

The intended home is `stdlib/Dec.hex`. Prelude placement must follow its actual
dependencies; it does not change the rules for user module shadowing or trust.

## 2. Value, representation, and decimal places

The semantic representation is:

```hexagon
opaque record Dec = {
    unscaled: BigInt,
    places: Int,
}
```

For unscaled integer (coefficient) `c` and decimal places `s`, the numerical value is `c × 10^(-s)`.
This notation describes the internal representation; it is not a public
constructor or new literal syntax.

Decimal places count digits **after the decimal point**, including retained zeros.
They are not a significant-digit precision budget. Each value carries its own
count; there are no scale-indexed types such as `Dec<2>`.

| Coefficient | Decimal places | Ordinary display |
|---|---:|---|
| `150n` | 2 | `1.50` |
| `1500n` | 3 | `1.500` |
| `-75n` | 2 | `-0.75` |
| `0n` | 2 | `0.00` |
| `3n` | 0 | `3` |

Trailing zeros are preserved in the stored representation. Normalization for
comparison or hashing does not remove them from the original value. The
coefficient has arbitrary integer precision within implementation resources;
decimal places range from `0` to `9_007_199_254_740_991` (`2^53 - 1`), inclusive,
the nonnegative `Int` range. No smaller decimal-specific
limit is imposed. This bounds the representation, not the memory or time needed
for arithmetic or display. Exact multiplication and powers check their retained
decimal-place sums/products before overflow and throw
`DecimalPlacesOverflowError(message: String)`, declared by
`Dec.hex`. The message identifies the operation. This error describes exceeding
the positive `Int` bound; it does not promise recovery from memory exhaustion or other
host resource limits.

This representation has no NaN, infinity, or negative zero. A rounded negative
value that becomes zero displays as `0`, `0.00`, or the corresponding requested
number of places, without a minus sign.

## 3. Constraints and the public operation names

The instances are `Num<Dec>`, `Signed<Dec>`, `Eq<Dec>`, `Ord<Dec>`,
`Show<Dec>`, `Hash<Dec>`, `Real<Dec>`, `Pow<Dec>`, and `FromBigInt<Dec>`.
`Num` and `Signed` are implemented explicitly;
numerical `Eq`, `Ord`, and matching `Hash` are also explicitly implemented.
`FromBigInt` follows the prerequisite contract in `integer-widening.md`.

`Dec` does **not** honor `Frac`, and has no `/` operator. No division function
omitting `places` is introduced, even for a quotient that happens to have
a terminating decimal expansion. Further constraint instances are not implied by
this list.

The following table gives semantic signatures, not declaration syntax. The
binary arithmetic functions are constraint members with their ordinary
qualified companion faces. Rounded arithmetic, decimal-place adjustments,
conversions, and integer-rounding functions are ordinary companion operations.
Conversions involving `Rat` belong to `Rat`; all other listed operations belong
to `Dec`.

| Operation | Parameters | Result |
|---|---|---|
| `Dec.create` | `unscaled: BigInt, places: Int` | `Dec`, exact |
| `Dec.unscaled` | `Dec` | `BigInt`, unscaled integer |
| `Dec.places` | `Dec` | `Int`, retained decimal-place count |
| `Dec.same` | `Dec, Dec` | `Bool`, same unscaled integer and retained places |
| `Dec.add` / `+` | `Dec, Dec` | `Dec`, exact |
| `Dec.subtract` / binary `-` | `Dec, Dec` | `Dec`, exact |
| `Dec.negate` / unary `-` | `Dec` | `Dec`, exact |
| `Dec.multiply` / `*` | `Dec, Dec` | `Dec`, exact |
| `Dec.fromNat` | `Nat` | `Dec`, exact |
| `Dec.fromInt` | `Int` | `Dec`, exact |
| `Dec.fromBigInt` | `BigInt` | `Dec`, exact, zero decimal places |
| `Dec.abs` | `Dec` | `Dec`, exact, retaining decimal places |
| `Dec.sign` | `Dec` | `Sign` |
| `Dec.pow` / `**` | `Dec, exponent: Int` | `Dec`, exact; negative exponents rejected |
| `Dec.divide` | `Dec, Dec, places: Int` | `Dec`, school rounding |
| `Dec.divideEven` | `Dec, Dec, places: Int` | `Dec`, ties to even |
| `Dec.withPlaces` | `Dec, places: Int` | `Dec`, school rounding |
| `Dec.withPlacesEven` | `Dec, places: Int` | `Dec`, ties to even |
| `Dec.round` | `Dec` | `BigInt`, school rounding |
| `Dec.roundEven` | `Dec` | `BigInt`, ties to even |
| `Dec.floor` | `Dec` | `BigInt`, toward negative infinity |
| `Dec.ceil` | `Dec` | `BigInt`, toward positive infinity |
| `Dec.trunc` | `Dec` | `BigInt`, toward zero |
| `Rat.fromDec` | `Dec` | `Rat`, exact |
| `Rat.toDec` | `Rat, places: Int` | `Dec`, school rounding |
| `Rat.toDecEven` | `Rat, places: Int` | `Dec`, ties to even |
| `Dec.fromFloat` | `Float, places: Int` | `Dec`, school rounding |
| `Dec.fromFloatEven` | `Float, places: Int` | `Dec`, ties to even |
| `Dec.toFloat` | `Dec` | `Float`, correctly rounded, ties to even |

The rounded operations taking a final `places` parameter return a `Dec`
retaining **exactly** that many places. They have no operator spellings.
`divide` names division to requested places;
`withPlaces` names a returned value with the requested places; `Rat.toDec`
and `Dec.fromFloat` name conversions between types. Their `Even` variants use nearest
rounding with ties to even, not rounding every result to an even number.
There is no combined rounded multiplication: use exact multiplication followed
by `withPlaces` or `withPlacesEven`. The intermediate exact product must fit the
retained-place range, even if a later adjustment would reduce it.

Float intentionally uses a different naming convention: `Float.round` chooses
ties to even, and `Float.roundAway` chooses ties away from zero. Each type's
unmarked name carries its own domain's default: commercial rounding for `Dec`
and unbiased rounding for approximate computation. Conversions into `Dec` follow
`Dec`'s convention whatever their source, so `Dec.fromFloat` rounds ties away
from zero. The divergence is sound only because integer and place rounding are
companion operations, never constraint members: every call site names a concrete
type, and its reader can see which rule applies. A constraint member spelled
`round` would have to state one tie rule for every instance, so none may be
introduced until the two conventions are reconciled.

### Construction and observation

`Dec.create(unscaled, places)` stores the unscaled integer and retained
decimal-place count exactly: `Dec.create(500n, 2)` represents `5.00`.
`Dec.unscaled` returns that unscaled integer (`500n`); `Dec.places` returns
the count (`2`). These accessors support extensions and adapters. For everyday
inspection and display, prefer `show`, which returns `"5.00"` for this value.
Opacity prevents direct field deconstruction outside the module in Hexagon. The
ordinary JavaScript record remains inspectable, with fields `unscaled` and `places`. No `(x, y)dec`
construction/deconstruction pattern exists.

### Places arguments and validation

Every public places parameter and the `places` accessor use `Int`, including
`Rat.toDec`, `Rat.toDecEven`, `Dec.fromFloat`, and `Dec.fromFloatEven`. An ordinary `let places = 2` can therefore be
passed directly; differences between observed place counts use ordinary Int
subtraction. The stored `places: Int` field always remains nonnegative.

Every operation accepting places rejects a negative argument with
`Dec.NegativeDecimalPlacesError(message: String)`, declared by `Dec.hex`.
The message identifies the public operation. Validate before arithmetic and
zero fast paths; for division this check precedes the zero-divisor check.
Negative places do not mean rounding to tens or hundreds. Valid counts keep
the existing range in §2; no clamping or silent narrowing is permitted.

### Decimal literals and literal patterns

The `d` suffix denotes a monomorphic `Dec` literal: `5d`, `5.00d`, and `0.050d`
have respectively zero, two, and three decimal places. Read written digits
exactly, never through `Float`. Underscores follow the existing numeric separator
placement rules and contribute neither value nor decimal-place count:
`1_000.00d` has two places and `0.123_456d` has six.

Using Lexer's `Digits` production, the grammar is `Digits ("." Digits)? "d"`.
A written decimal point requires digits on both sides: `0.5d` is valid; `.5d`
and `5.d` are not Dec literals. The suffix is lowercase and directly adjacent;
`5D` and `5_d` are invalid. Leading zeros follow the existing decimal rules:
`005.00d` has value five and two decimal places, and displays as `5.00`.
Remove separators and the point to obtain the exact non-negative BigInt
coefficient; count fractional digits, excluding separators, for the places.
The coefficient is not subject to the bare Int literal's safe-integer limit.

The literal denotes the canonical prelude `Hex.Dec` type even when a user module
or type shadows the name `Dec`. Lower it through the canonical stdlib constructor
or an equivalent representation-preserving internal form; an ordinary same-named
user module cannot intercept literal construction or acquire stdlib trust.
An annotation using a shadowing type name still names that user type and can
therefore mismatch a `d` literal; the literal contains no name lookup that could
override ordinary declaration precedence. Pattern literals use the same identity.

Exponent notation is not permitted: `5e2d` and `5.00e2d` are rejected. Ordinary
notation makes retained decimal places visible. This restriction is a notation
choice, not a claim that exponent notation inherently implies approximation.
Negative expressions follow ordinary unary negation and preserve decimal places.
Unsuffixed decimal-point or exponent literals remain `Float`.

`Dec` literals are also literal match patterns, using numerical `Eq`. Thus `5d`,
`5.0d`, and `5.00d` match the same values; a `5.00d` arm after a `5d` arm is
unreachable. The existing exact-type rules for literal patterns apply; this is
not a user-defined deconstruction pattern.
Negative Dec literal patterns use the same numerical equality, including zero.
The redundancy key ignores trailing zero representations and the sign of zero;
the expression's stored places remain intact. Bare integer patterns at an
established Dec position retain the existing `Num`/`Signed` and `Eq` rules.

## 4. Exact arithmetic and integer widening

For operands represented by `(c1, s1)` and `(c2, s2)`:

- Addition and subtraction use `s = max(s1, s2)`, align both coefficients to `s`
  by multiplying by powers of ten, then add or subtract them. The result retains
  `s`, including when it is zero numerically.
- Multiplication returns coefficient `c1 × c2` and places `s1 + s2`.
- Negation changes only the coefficient's sign and retains its decimal places.
- `fromNat` and `fromInt` store the exact integer coefficient at zero decimal
  places. Their result is not restricted by `Int` beyond the source type's own
  range.

All intermediate arithmetic is exact; these operations do not silently round to
a fixed number of digits or route through `Float`. Host resource limits (§2)
are not permission to substitute an approximate answer.

The following are Hexagon expressions, with their ordinary display in comments.
Later tables and `text` blocks use mathematical/display notation without suffixes:

```hexagon
1.50d + 2.005d  // 3.505
1.50d - 1.50d   // 0.00
1.50d * 2.00d   // 3.0000
3 * 1.50d      // 4.50
1.50d * 3      // 4.50
```

Coefficients multiply and decimal places **add**: powers of ten combine by
adding exponents. This is why a zero-place integer preserves the other operand's
decimal places under multiplication.

Existing numeric widening applies: an established `Nat` can enter through
`Num<Dec>.fromNat`, and an established `Int` through `Signed<Dec>.fromInt`, when
`Dec` is independently established as the target. Both operand orders are covered.
No dedicated mixed-type multiplication instance is necessary. The explicit
`Dec.fromBigInt(value: BigInt): Dec` equals `Dec.create(value, 0)`.
Under the prerequisite `integer-widening.md` design, it is the required member
of `FromBigInt<Dec>` and also serves automatic BigInt-source injection. The
existing `fromNat` and `fromInt` entries delegate through exact BigInt conversion
to that member. Ordinary function naming alone never grants implicit widening.

Unsuffixed decimal-point and exponent literals remain `Float`. This specification
does not infer `Dec` from a `Float` literal or silently convert `Float` into `Dec`.
The only way from `Float` to `Dec` is the named rounding door below.

### Exact conversion to `Rat`

`Rat.fromDec(value: Dec): Rat` preserves the numerical value exactly. For stored
coefficient `c` and decimal places `s`, it returns the canonical rational value
`c / 10^s`, with normalization following the existing `Rat` contract. There is
no rounding or intermediate `Float` conversion. For example, `Rat.fromDec(1.50d)`
returns the same rational as `Rat.create(3, 2)`.

Retained decimal places are not preserved: `Rat` represents the numerical value,
not the decimal presentation. This is a named conversion, not implicit widening.
Ordinary resource limits still apply. All conversions involving `Rat` are owned
by `Rat`, an ordinary imported module that can use the prelude `Dec` type and its
public constructor and accessors. `Dec` does not depend on or import `Rat`.
`Rat` remains outside the prelude; its public import policy is unchanged.

### Conversion from `Rat` to requested decimal places

`Rat.toDec(value: Rat, places: Int): Dec` uses school rounding;
`Rat.toDecEven(value: Rat, places: Int): Dec` uses ties to even.
Both round once from the exact rational using §5 and retain exactly the requested
decimal places. Neither uses a `Float` intermediate or implicit conversion.
Decimal places are required even for a terminating rational.

For example, converting `Rat.create(1, 8)` to two decimal places yields `0.13`
through `Rat.toDec` and `0.12` through `Rat.toDecEven`. Converting
`Rat.create(1, 2)` to two places yields `0.50` through either operation.
Ordinary resource limits apply.

### Rounded conversion from `Float`

`Dec.fromFloat(value: Float, places: Int): Dec` uses school rounding;
`Dec.fromFloatEven(value: Float, places: Int): Dec` uses ties to even. Both
round the float's exact stored binary value once, using §5, to exactly the
requested places. The places argument is required. There is no conversion that
keeps a float's full binary expansion: that would claim an exactness the value
never had (Friendly Numerics tenet 7). With places, the caller names the
precision being spent, exactly as `Float.round` names it at zero places.

The binary value is what rounds, not the digits a programmer wrote:

```text
fromFloat(0.1 + 0.2, 2) = 0.30
fromFloat(12.34, 2)     = 12.34
fromFloat(2.675, 2)     = 2.67   // the double nearest 2.675 lies below it
fromFloat(0.125, 2)     = 0.13   // an exact binary tie
fromFloatEven(0.125, 2) = 0.12
fromFloat(-0.0, 2)      = 0.00
```

`NaN` and both infinities have no decimal value and throw
`DecRangeError(message: String)`, declared by `Dec.hex`. The message identifies
the operation. Negative places are rejected first (§3). Every finite float,
subnormals included, converts; its exact value is always a finite decimal.

These conversions belong to `Dec` because `Float.hex` sits before `Dec.hex` in
the prelude order and cannot name `Dec`.

### Explicit conversion to `Float`

`Dec.toFloat(value: Dec): Float` follows `Rat.toFloat`: round the exact numerical
value once to the nearest representable `Float`, with ties to even. Throw the
existing `FloatRangeError` if the rounded result would be infinite or if a
nonzero value would round to zero. Zero converts to `0.0`; representable nonzero
subnormal results are permitted. Error messages identify `Dec.toFloat`.

This named conversion deliberately permits loss of precision. It introduces no
implicit widening to `Float` and no reverse conversion from `Float`. Retained
decimal places are not preserved by the result.

### Exact powers

`Pow<Dec>` supplies `Dec.pow(value: Dec, exponent: Int): Dec` and `**`.
For a non-negative exponent `n`, the result has coefficient `c^n` and
`places = s * n`. Exponent zero returns the multiplicative identity at
zero decimal places, including for a zero base. No rounding occurs.

Every negative exponent throws the existing `NegativeExponentError` from
`Pow.hex`, including where a particular reciprocal would terminate exactly.
Its documentation must be broadened from integer types to include this instance.
Before computing the coefficient power, check the decimal-place product exactly;
if it exceeds the positive `Int` range, throw rather than wrap, round, or reduce retained
places. Throw the same `DecimalPlacesOverflowError` used by exact multiplication.
Ordinary computation and memory limits still apply.

For example, `1.50d ** 2` has coefficient `22500n` and four decimal places,
displaying as `2.2500`. A zero coefficient does not bypass the decimal-place
overflow check.

## 5. Rounding rules

**School rounding** means nearest, with exact ties **away from zero**, matching
Hexagon's `Float.roundAway`. **Banker's rounding** means nearest, with exact ties to
the result whose final retained digit is even, matching `Float.round`.
They differ only at exact ties.

For an exact numerical answer `x` and requested places `s`, round the exact
quantity `x × 10^s` to an integer under the selected rule. That integer is the
result coefficient, and `s` is its retained decimal places.

An integer-only characterization is sufficient for implementation: express the
magnitude of the scaled answer as `n / d`, with `n >= 0` and `d > 0`. Obtain
`q = quot(n, d)` and `r = rem(n, d)` exactly. If `2r < d`, retain `q`; if `2r > d`,
increment it. At `2r == d`, school rounding increments it; ties-to-even increments
it only when `q` is odd. Restore the original sign afterwards. Exact integer
answers have `r = 0` and remain unchanged.

| Exact answer | Requested places | School | Banker's |
|---|---:|---|---|
| `1.234` | 2 | `1.23` | `1.23` |
| `1.245` | 2 | `1.25` | `1.24` |
| `1.255` | 2 | `1.26` | `1.26` |
| `-1.245` | 2 | `-1.25` | `-1.24` |
| `9.995` | 2 | `10.00` | `10.00` |

Each operation rounds **once**, directly from its exact mathematical input or
answer to the requested places. There is no ambient rounding context and no
intermediate `Float` conversion or earlier rounding step.

## 6. Multiplication and division to decimal places

Multiplication is exact; round its result separately with `withPlaces` or
`withPlacesEven`. There is no combined rounded-multiplication operation.

Division, place adjustment, and Rat-to-Dec conversion must keep internal place
bookkeeping exact. A valid final place count must not fail merely because an
unmaterialized intermediate sum exceeds Int's range. Cancel place differences
or use exact integer bookkeeping as needed. Ordinary resource limits remain.

`divide` and `divideEven` round the exact rational quotient directly to the
requested places. They must handle both terminating and repeating quotients
without first selecting an intermediate decimal precision.

```text
withPlaces(4.50 * 0.15, 2) = 0.68
withPlaces(4.50 * 0.15, 3) = 0.675
divide(1, 8, 2) = 0.13
divideEven(1, 8, 2) = 0.12
divide(1, 3, 2) = 0.33
divide(3, 2, 2) = 1.50
divide(-1, 8, 2) = -0.13
divideEven(-1, 8, 2) = -0.12
divide(1, -8, 2) = -0.13
divideEven(-1, -8, 2) = 0.12
```

Division checks for a zero divisor by numerical value, independent of its places,
and throws the existing `DivideByZeroError` declared by `Integral.hex`. Messages
identify the operation (`Dec.divide: divisor is zero` or
`Dec.divideEven: divisor is zero`). No Java exception type is introduced.

## 7. Changing places and rounding to an integer

`withPlaces` and `withPlacesEven` apply §5 to an existing value. Reducing
places can change its number; increasing places appends zeros without changing
its number. Requesting its existing places preserves both its number and places.

```text
withPlaces(1.256, 2) = 1.26
withPlacesEven(1.245, 2) = 1.24
withPlaces(1.5, 2) = 1.50
withPlaces(0, 2) = 0.00
```

`round` and `roundEven` select the nearest integer using the same two rules and
return it as a `BigInt`. They do not return a zero-place `Dec` or narrow the result
to `Int`. For example, `round(-2.5)` yields `-3n`, while `roundEven(-2.5)` yields
`-2n`. Large integer results remain exact subject to ordinary BigInt resources.

`floor`, `ceil`, and `trunc` also return `BigInt`, computed exactly without a
`Float` intermediate. `floor` selects the greatest integer no greater than the
value; `ceil` selects the least integer no less than it; `trunc` discards the
fractional part toward zero. For `-1.75d`, their results are respectively `-2n`,
`-1n`, and `-1n`. Numerically integral inputs remain unchanged numerically under
all five integer-rounding operations, regardless of retained decimal places.

Rounding at different points can legitimately produce different results. For
example, rounding a `0.675` discount to two places before subtracting it from
`4.50` gives `3.82`; subtracting it exactly and then school-rounding `3.825` gives
`3.83`. The caller chooses where to spend precision by choosing the operations.

## 8. Numerical equality, ordering, and hashing

`Eq<Dec>` compares numerical values: `1.50 == 1.500` and `0.00 == 0` are true.
`notEquals` is its negation. A difference in decimal places does not throw.

`Dec.same(left: Dec, right: Dec): Bool` is a separate ordinary companion
operation. It returns true exactly when both stored `unscaled` integers and both
stored `places` counts are equal. It compares representation, not JavaScript
object identity: separately constructed values with the same two parts are the
same. It does not normalize, round, or change either value.

```hexagon
2.0d == 2.00d                  // True
2.0d.same(2.00d)               // False
2.00d.same(Dec.create(200n, 2)) // True
0d.same(0.00d)                 // False
```

This operation does not supply a constraint instance or operator. `equals`,
`compare`, and `hash` remain numerical; map/set key equivalence and pattern
matching are unchanged. Documentation comments must name the two compared parts.

`Ord<Dec>` gives a total numerical order agreeing with `Eq`, comparing exactly
across decimal places. It returns `Ordering.Equal` exactly for numerically equal
values. No `ScaleMismatch` exception is part of this design.

One canonical key for equality and hashing is obtained by removing factors of
ten from a nonzero coefficient while its places remain positive, decrementing
places each time. Every zero uses key `(0n, 0)`. Thus both `(150n, 2)` and
`(1500n, 3)` have key `(15n, 1)`. This key is an internal mathematical device,
not a new public API and not a replacement for the stored presentation.
The tuple's structural or lexicographic order is not Dec's numerical order;
`Ord` must compare the represented numbers exactly.

`Hash<Dec>` must give numerically equal values equal hashes, independent of their
retained places. Its algorithm is unspecified beyond the existing Hash laws;
hashing the canonical key is a valid implementation. Hashing the original fields
structurally is not. `Dec`'s trusted Hexagon-owned module may supply matching
member-block `Eq` and `Hash` under Collections Part 2 §4.4 (#969); it must not
derive `Hash` beside that numerical `Eq`. Its numerical `Ord` is likewise
explicit, rather than derived from the stored fields.

Consequently, equal Decs with different places denote the same map key or set
element. Existing collection representative-retention rules determine which
stored representation remains observable; inserting an equal value does not
grant permission to canonicalize away that representative's decimal places.

Arithmetic laws use this numerical equality, not field identity. In particular,
`x + negate(x) == fromNat(0)` holds even when the left side displays as `0.00`
and the right side as `0`.

`Real<Dec>` expresses placement on the real number line. Retained decimal places
do not change that placement: `5d` and `5.00d` occupy the same point. `abs`
returns the absolute numerical value while preserving decimal places; `sign`
uses the numerical value alone and follows the existing `Sign` conventions.

## 9. Ordinary display and foreign representation

`Show<Dec>` writes ordinary base-ten notation with exactly the stored number of
decimal places. At zero places it writes an integer with no decimal point. At
positive places it writes a decimal point and all fractional digits, padding
zeros on either side as necessary; there is always an integer digit before the
point. Only negative nonzero values have a minus sign.

It writes no currency symbol, grouping separator, exponent notation, or type
suffix. Interpolation uses this same `Show`. The retained places are visible:
`1.50` and `1.500` compare equal but show differently.

The foreign representation follows the ordinary opaque-record rules, including
the opaque TypeScript face. No JavaScript Decimal primitive or special FFI
conversion is introduced. Public parsing is deferred (§12); no additional
serialization API is proposed. Ordinary display is not a promise of native JSON
support for BigInt-backed data.

## 10. Implementation and teaching obligations

Register the type and companion in the prelude, preserve ordinary nominal ownership and dictionary
dispatch, and regenerate embedded sources. Both Playground and language-server
consumers must observe the same prelude and widening behaviour.

The Primitive Types book chapter must introduce `Dec` alongside `Int`, `Float`,
and `BigInt`, explain coefficient multiplication versus addition of decimal
places, and distinguish numerical equality from retained display. The chapter
defines its scope as fundamental prelude types rather than requiring a
JavaScript primitive representation. The compiler's primitive-type
classification is unchanged.

## 11. Acceptance cases for the implementation

- Exact arithmetic preserves §4's places, including mixed-place addition,
  cancellation to zero, and multiplication with integer operands on either side.
- Test positive and negative ties, even and odd tie neighbours, non-ties,
  rounding carry into a new integer digit, and a negative value rounding to zero.
- Every operation accepting `places` returns exactly the requested places, including zero and increasing
  the places of an already exact answer. Its parameter is `Int`; negative arguments throw before zero fast paths.
  Cover inferred `let places = 2`, accessor subtraction, and negative places on
  construction, both adjustment/division variants, and both Rat conversions.
- Repeating division rounds correctly for every combination of operand signs;
  every zero-divisor representation throws
  the existing `DivideByZeroError`. No `/` or `Frac<Dec>` is available.
- Detect double rounding: rounding `1.249` directly to one place yields `1.2`,
  not the `1.3` obtained by first rounding to two places.
- `same` distinguishes equal numerical values with different places, including
  zero; accepts independently constructed matching representations; and rejects
  different unscaled integers at the same places, including opposite signs.
- Numerical equality and order agree across decimal places. Hashes agree for nonzero
  trailing-zero variants and all zero variants. Map/set lookup and representative
  retention must be exercised, not only direct hash calls.
- Arbitrarily large coefficients beyond Int's safe range stay exact in arithmetic,
  comparison, display, and integer rounding. No path converts through `Float`.
- A prelude `Dec` is usable as a written type and companion without import;
  established `Int`/`Nat` operands widen through the existing instance machinery.
  Unsuffixed decimal-point literals remain `Float`; BigInt-source widening uses
  the prerequisite `FromBigInt` capability rather than a Dec-specific exception.
- Display preserves leading fractional zeros and trailing retained zeros;
  interpolation agrees. Foreign output remains an ordinary opaque record.
- Constructors and accessors preserve the unscaled integer and decimal places.
  Literal tests cover trailing zeros, separators, exponent rejection, large
  coefficients, and numerical matching/redundancy across different spellings.
- Multiplication and powers detect decimal-place overflow without allocating
  enormous values; include zero coefficients, exponent zero, and negative powers.
- Division, place adjustment, and Rat conversion do not inherit a hypothetical exact intermediate's retained-
  place overflow; include zero-coefficient cases that can finish without allocating
  enormous powers of ten. Literal identity is canonical under module/type shadowing.
- `abs` preserves places; `sign` is numerical. All five integer-rounding methods
  cover negative and positive fractions and numerically integral values.
- Rational conversions cover exact values and both tie rules. `toFloat` covers
  ties to even, finite overflow, nonzero underflow to zero, and subnormal results.
- `fromFloat` and `fromFloatEven` cover both tie rules at exact binary ties,
  values whose written digits suggest a tie the binary value does not hold,
  negative zero, the largest finite float and the smallest subnormal, `NaN` and
  both infinities, and negative places ahead of the finiteness check.
- Equality is false between a number and its tenfold neighbours (`5` and `0.5`),
  and between nearby values at different places (`1.5` and `1.51`).
- As a quality check on the implementation, not a Hash law: `5`, `0.5`, `0.05`,
  and `50` hash differently, showing the hashed key includes its place count.

## 12. Deferred work

Runtime text parsing is deferred to one design covering every numeric type
(#1049). No parser name, grammar, result type, or exception is adopted here. The
source-literal rules are independent of a future runtime text parser.

The nonnegative `Int` decimal-place range and `DecimalPlacesOverflowError` are
settled (§2). Host resource limits do not imply a smaller decimal-specific cap.
No construction/deconstruction pattern is included.
