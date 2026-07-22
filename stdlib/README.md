# Hexagon standard library source

This directory holds Hexagon-written v1 standard-library modules as they become
executable conformance clients of the compiler. They are ordinary source modules,
not compiler intrinsics.

- `Rat.hex` implements exact rational arithmetic over `BigInt`. Its constructor
  normalizes through Euclidean `BigInt.gcd` and exact quotient operations.
- `Integral.hex` declares the generic Euclidean integer family supplied by the
  compiler's coherent `Int` and `BigInt` instances.

The package/prelude loader remains project-system work; tests compile these modules
through the platform-neutral compiler pipeline before they are added to a packaged
runtime.
