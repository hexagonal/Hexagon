# Math

**Status:** Normative. Decided by James on 2026-09-19 and implemented in the
standard library, compiler, and Playground. The repository has no command-line
compiler yet, so the CLI exercise remains tracked in
[the stdlib ledger](stdlib-roadmap.md#2-v1-obligations-24).

**Home:** `stdlib/Math.hex`, an ordinary standard-library module seated in the
prelude. Every module therefore sees the `Math` module alias without an import.
This document owns its public surface and numerical contract.

## 1. Scope and ownership

`Math` provides concrete `Float` mathematical functions. Its surface follows
[Standard ML's Math](https://smlfamily.github.io/Basis/math.html), excluding
`pow`. It introduces no type, constraint, instance, exception, operator, or
bare term name: prelude injection supplies the module alias, while calls stay
module-qualified, such as `Math.sin(angle)`. These exports do not become
operations on the `Float` companion.

Power remains owned by `Pow` and `Float`: the constraint and `**` take an
`Int` exponent; `Float.pow` accepts a `Float` exponent through its existing
widened declaration. Rounding, classification, infinity, and NaN remain in
`Float`. This decision adds no further mathematical conveniences.

## 2. Public interface

The following is an interface inventory, not a proposed new declaration form.
Each function is pure, does not throw for any `Float` input, and returns `Float`.
Existing numeric contextual-widening rules apply normally.

```text
Math.pi: Float
Math.e: Float

Math.sqrt(value: Float): Float
Math.sin(angle: Float): Float
Math.cos(angle: Float): Float
Math.tan(angle: Float): Float
Math.asin(value: Float): Float
Math.acos(value: Float): Float
Math.atan(value: Float): Float
Math.atan2(y: Float, x: Float): Float
Math.exp(value: Float): Float
Math.ln(value: Float): Float
Math.log10(value: Float): Float
Math.sinh(value: Float): Float
Math.cosh(value: Float): Float
Math.tanh(value: Float): Float
```

## 3. Numerical reference

The numeric behaviour is that of the corresponding
[ECMAScript 2026 Math operations (17th edition)](https://262.ecma-international.org/17.0/#sec-math-object).
`ln` maps to `log`; `pi` and `e` map to `PI` and `E`.
This adopts their behaviour on Number values representing Hexagon floats,
not JavaScript argument coercion or its object API. Future ECMAScript changes
do not silently amend this contract.

Angles use radians. Constants are the nearest binary64 values of π and e.
Square root is correctly rounded; other function results use the reference's
implementation-approximated accuracy contract. Cross-engine last-bit identity
is not promised. Any NaN argument produces a NaN result; preservation of its
payload or sign is not promised.

In the tables, `±` means matching signs, and π denotes an approximated angle
when used as a returned value. Signed zeros are preserved where specified,
even though Hexagon equality equates them. These numeric rules do not change
Hexagon's `Eq<Float>` or `Ord<Float>`.

### 3.1 Unary boundaries

| Operation | `+0` | `-0` | `+Infinity` | `-Infinity` | Other domain boundary |
|---|---|---|---|---|---|
| `sqrt` | `+0` | `-0` | `+Infinity` | `NaN` | Negative inputs: `NaN` |
| `sin`, `tan` | `+0` | `-0` | `NaN` | `NaN` | — |
| `cos` | `1` | `1` | `NaN` | `NaN` | — |
| `asin` | `+0` | `-0` | `NaN` | `NaN` | Outside `[-1, 1]`: `NaN`; at `±1`: ±π/2 |
| `acos` | π/2 | π/2 | `NaN` | `NaN` | Outside `[-1, 1]`: `NaN`; at `1`: `+0`; at `-1`: π |
| `atan` | `+0` | `-0` | π/2 | −π/2 | See §3.3 |
| `exp` | `1` | `1` | `+Infinity` | `+0` | — |
| `ln`, `log10` | `-Infinity` | `-Infinity` | `+Infinity` | `NaN` | Negative inputs: `NaN`; at `1`: `+0` |
| `sinh` | `+0` | `-0` | `+Infinity` | `-Infinity` | — |
| `cosh` | `1` | `1` | `+Infinity` | `+Infinity` | — |
| `tanh` | `+0` | `-0` | `1` | `-1` | — |

### 3.2 Two-argument inverse tangent

`atan2(y, x)` uses both signs to choose the angle of `(x, y)`.
It must not be implemented as `atan(y / x)`.

| `y` | `x` | Result |
|---|---|---|
| `±0` | Positive, or `+0` | `±0` |
| `±0` | Negative, or `-0` | ±π |
| Positive finite, nonzero | `±0` | π/2 |
| Negative finite, nonzero | `±0` | −π/2 |
| Finite nonzero `±y` | `+Infinity` | `±0` |
| Finite nonzero `±y` | `-Infinity` | ±π |
| `±Infinity` | Finite | ±π/2 |
| `±Infinity` | `+Infinity` | ±π/4 |
| `±Infinity` | `-Infinity` | ±3π/4 |

The NaN-result rule takes precedence over this table. Positive and negative in
its first two rows include the corresponding infinities.

### 3.3 Mathematical range and rounded endpoints

For finite inputs, the mathematical result of `atan` lies strictly between
−π/2 and π/2. The returned `Float` approximates that result and may equal the
floating-point representation of either endpoint. Infinite inputs return
approximations of the corresponding endpoints.

For example, `atan(10²⁰)` is mathematically below π/2, but its nearest float
equals the float used for π/2. Consequently, `Math.atan(x) < Math.pi / 2`
is not a promised test for all finite positive `x`. Implementations must not
clamp the rounded answer to a lower float to manufacture that inequality.

The mathematical ranges of `asin`, `acos`, and `atan2` are respectively
`[-π/2, π/2]`, `[0, π]`, and `[-π, π]`; their returned angles are approximations.
An expression using `Math.pi` is itself floating-point arithmetic, not an
exact symbolic endpoint.

## 4. SML review resolutions

The SML manual's signed result for `cosh(-Infinity)` is not adopted:
the answer is positive infinity. Its strict finite-`atan` range describes
the mathematical function; §3.3 states the separate representation contract.
Its discussion of tangent singularities does not promise that
`Math.tan(Math.pi / 2)` returns infinity: the argument is an approximation.

## 5. Implementation and conformance obligations

Public declarations and documentation belong to source in `stdlib/Math.hex`.
Native mathematical capabilities use the existing
[intrinsic mechanism](intrinsics.md); no compiler-owned public `Math` namespace
or special call-resolution rule is introduced. Intrinsic key choices are
implementation details. Constants may use ordinary Float literals.

Use the corresponding native mathematical operations rather than algebraic
substitutions with different rounding, overflow, or signed-zero behaviour.
In particular, `sqrt` is not fractional power, and hyperbolic functions are
not naive compositions of `exp`. Implementation must preserve the existing
`Float.pow` behaviour and must add no `Math.pow` export.

Each operation is an exported door row whose lowering is the one native call, so
a call is inlined as that call (Intrinsics §8.3): `Math.sqrt(x)` emits
`Math.sqrt(x)`, and `Math.ln(x)` emits `Math.log(x)`.

Conformance must cover the full interface, NaN in every argument position,
the boundary tables, domain-adjacent inputs, ordinary finite values, and
finite inputs whose `atan` rounds to an endpoint. Check the sign of zero
through a sign-sensitive observation such as reciprocal infinity; ordinary
Hexagon equality alone cannot test it. Approximate-angle assertions must
respect §3's accuracy contract rather than require cross-engine bit identity.

Module qualification and execution through the Playground's shipped stdlib
distribution are conformance obligations and are implemented. Before the
ledger entry is discharged, exercise the same surface through the CLI and its
shipped stdlib distribution once the repository contains that host.
