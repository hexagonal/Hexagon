# A same-type absolute-value constraint

**Status:** Superseded by `Real`, 2026-09-14. The adopted contract is
[Constraints §7](../constraints.md): `Real<a: (Num, Ord)>` supplies same-type
`abs` and `sign -> Sign`, with instances for `Nat`, `Int`, `BigInt`, `Float`,
and `Rat`. The earlier `Abs` API and future-work wording below are historical,
not the current contract.

**Original status:** Non-normative proposal, 2026-09-13. Records James's chosen design
direction for a dedicated `Abs` constraint and JavaScript-compatible floating-point
absolute value. This note proposes the library contract; it does not implement
it or amend the normative specifications.

## Proposed API

```hexagon
export constraint Abs<a: Num> =
    abs(value: a) -> a
```

`Abs` is a numeric capability with `Num` as its base and one pure member.
Honoring `Abs` requires and supplies `Num`; it supplies neither `Signed` nor
`Ord`. Honoring `Num`, `Signed`, or `Ord` does not require honoring `Abs`.
There is no implied result type.
The operation returns the same type as its input: in particular, `Int` absolute
value remains `Int`, even though its result is nonnegative.

Propose making `Abs` available through the prelude, like the other standard
numeric constraints. Ordinary member resolution applies to `abs`, `Abs.abs`,
and receiver calls; this proposal adds no special inference or widening rule.
A generic wrapper around `abs(x)` needs only `Abs` on the type of `x`. A helper
that also adds two absolute values still needs only `Abs`: its base supplies
the required numeric operations.

```hexagon
let doubledAbs<a: Abs>(x: a): a =
    abs(x) + abs(x)
```

The base expresses the public promise that absolute values support numeric
arithmetic, even when an implementation of `abs` does not use those operations.
`Num` alone does not establish an ordering or a number-line model; this proposal
adds no `Ord` base. All four proposed initial subjects already honor `Num`.
No result projection, result equality, or new `where` syntax is needed.

## JavaScript runtime budget

James's runtime boundary is ordinary constraint dictionaries: additional runtime
machinery for generic implied types is not acceptable. This proposal fits that
boundary. Its generic operation uses the existing dictionary-passing model with
an `abs` member and the existing base-dictionary route to `Num`;
it requires no new result-evidence containers, lazy result
accessors, construction caches, or runtime type representations. Existing
specialization and primitive emission policies can apply as usual.

Generic implied types have been abandoned, and their investigation and design
notes have been removed. This proposal uses the existing constraint system.

## Standard instances

| Subject | Result | Proposed behavior |
|---|---|---|
| `Nat` | `Nat` | Identity on every valid value. |
| `Int` | `Int` | Exact nonnegative absolute value. |
| `BigInt` | `BigInt` | Exact nonnegative absolute value, with no conversion to `Float`. |
| `Float` | `Float` | JavaScript `Math.abs` behavior on numeric inputs, including special values. |

These four instances are the requested initial scope. `Int` has the symmetric
safe range `−(2^53−1)` through `2^53−1`, so the absolute value of its minimum is
representable; there is no asymmetric minimum-integer overflow case. See
[Primitive Types](../primitive-types.md).

An exact `Abs<Rat>` instance also fits this contract naturally: retain the
positive denominator and take the absolute value of the numerator. It is an
additional recommendation, rather than an expansion of the four-type initial
scope already chosen. It needs no approximate conversion or implied result.

## Float: JavaScript behavior

Use the numeric semantics of
[ECMAScript Math.abs](https://tc39.es/ecma262/2025/multipage/numbers-and-dates.html#sec-math.abs).
JavaScript's coercions from strings, null, and other nonnumeric inputs are not
part of the typed `Float -> Float` contract.

| Input | Result |
|---|---|
| Negative finite nonzero value | Its positive counterpart |
| Positive finite nonzero value | The input value |
| Negative zero | Positive zero |
| Positive zero | Positive zero |
| Negative infinity | Positive infinity |
| Positive infinity | Positive infinity |
| `NaN` | `NaN` |

This operation is pure and total over `Float`; none of these inputs throws.
For finite values it introduces no rounding, overflow, or underflow: taking
absolute value only removes the sign. Infinity remains infinite and `NaN`
remains `NaN`; no finiteness check or range exception is introduced.

Hexagon already preserves both floating-point zeros in arithmetic while equating
them under `Eq` and `Ord`, hashing them alike, and showing both as `"0"`.
Absolute value canonicalizes either zero to positive zero. Existing equality,
comparison, hashing, display, and pattern semantics are unchanged. For example,
`1.0 / abs(-0.0)` must produce positive infinity; equality with `0.0` alone
cannot verify that the sign was removed. `Float.isNan(abs(Float.nan))` must be
`True`; Hexagon's `NaN` equality differs from JavaScript's `===`, so do not use
`x != x` as the detector. See [Float's source contract](../../stdlib/Float.hex).

A comparison-based implementation such as `if x < 0.0 then -x else x` is
insufficient for `Float`: it leaves negative zero unchanged. The implementation
must preserve the full table above, for example by using the host's `Math.abs`.
JavaScript `Math.abs` does not accept BigInt, so the BigInt instance requires
its own exact implementation.

## Meaning and laws

`abs` denotes ordinary absolute value, not an arbitrary same-type transformation.
For the proposed integer instances it is nonnegative, preserves nonnegative
inputs, and returns zero exactly for zero. Applying it twice has the same
result as applying it once. For signed integer inputs, `abs(-x) = abs(x)`.
The `Nat` instance is identity throughout its domain.

For `Float`, the special-value table is authoritative. Ordinary finite
absolute-value properties apply, with both zeros producing positive zero.
Do not describe `NaN` as a nonnegative real number or infer mathematical
positivity from Hexagon's total `Ord<Float>` order. Algebraic statements involving
additional arithmetic retain that arithmetic's existing safe-range and IEEE
qualifications; they are not compiler rewrite permissions. These semantic
requirements do not implicitly add `Eq`, `Ord`, or `Signed` dictionaries.
`Num` is supplied by the explicitly declared base.

## Complex numbers and other magnitudes

A future complex magnitude operation is separate from `Abs`. It may be named
`Complex.norm`, but this note does not settle that spelling, its result domain,
or whether a general `Norm` constraint is useful. Scalar complex magnitude
must not be forced into `abs : a -> a`, nor wrapped back into a complex result
merely to satisfy that signature.

The exactness question belongs to that future API: the magnitude of `1 + i`
is `sqrt(2)`, which cannot be represented by `Rat`. This proposal makes no
promise of a total exact `Complex(Rat) -> Rat` norm or a silent conversion to
`Float`. Vector and matrix norms likewise require their own design.

`Signed` continues to describe subtraction, negation, and integer injection.
This proposal adds no `Positive | Negative | Zero` classification to it and
places no ordering requirement on complex numbers.

## Supersession and follow-up

This replaces the earlier shared real/complex `abs` recommendation and its
abs-led `where`, implied-result obligation, contract/module, representation,
and construction follow-up notes. Those notes are removed to avoid competing
`Abs` contracts.

The broader generic-implied-types work has also been abandoned and removed.
No continuation of that work is proposed here. Existing supported implied-type
features are outside this cleanup.

Before implementation, promote the accepted contract into the relevant
[Constraints](../constraints.md), [Primitive Types](../primitive-types.md), and
[stdlib roadmap](../stdlib-roadmap.md) specifications and coordinate the
prelude declaration, companion instances, generated library artifacts, and
public exports. Any Rat addition should be recorded explicitly in its own
[specification](../rat.md).

Implementation acceptance coverage should include all four result types,
generic member/dictionary calls (including addition through an `Abs` bound's
`Num` base), Nat identity, both Int range endpoints, large
BigInt values, Float finite values and every special-value row. Verify positive
zero through a sign-sensitive observation such as reciprocal division. These
are future verification requirements, not tests run or functionality shipped
by this note.
