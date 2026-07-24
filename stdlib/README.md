# Hexagon standard library source

This directory holds Hexagon-written v1 standard-library modules as they become
executable conformance clients of the compiler. They are ordinary source modules,
not compiler intrinsics.

- `Rat.hex` implements exact rational arithmetic over `BigInt`. Its constructor
  normalizes through Euclidean `BigInt.gcd` and exact quotient operations.
- `Integral.hex` declares the generic Euclidean integer family supplied by the
  compiler's coherent `Int` and `BigInt` instances.
- `Option.hex` declares the canonical optional-value union used by total
  standard-library accessors.
- `Vector.hex` owns the public Vector companion while delegating only
  representation-sensitive operations to the compiler/runtime core.

The complete package/prelude loader and the final boundary of the fundamental
stdlib remain project-system and stdlib-listing work. The Playground begins that
boundary with a deliberately small host manifest: it supplies the canonical
`Option.hex`, `Vector.hex`, and `Rat.hex` modules to every workspace rather than
maintaining example-local copies.
