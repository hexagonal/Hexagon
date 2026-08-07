# Hexagon standard library source

This directory holds Hexagon-written v1 standard-library modules as they become
executable conformance clients of the compiler. They are ordinary source modules,
not compiler intrinsics.

- `Show.hex`, `Num.hex`, `Signed.hex`, `Frac.hex`, `Pow.hex`, `Concat.hex`,
  `Eq.hex`, `Hash.hex`, `Ord.hex`, and `Integral.hex` are the **declaring
  modules** of the constraints the compiler pre-registers. A constraint member
  is an export of its declaring module (#335), so these files are what put
  `show`, `add`, `equals`, `compare`, `div` and the rest into bare scope
  everywhere; all ten are prelude members, in the seats-before-uses order
  `compiler/src/prelude.ts` records. `Iterable` has no file: it is
  pre-registered by name only, owned by the collections arc.
- `Rat.hex` implements exact rational arithmetic over `BigInt`. Its constructor
  normalizes through Euclidean `BigInt.gcd` and exact quotient operations, and
  its arithmetic lives in its `honor` blocks — a member definition is a
  module-level binding, so a module-level `let add` beside `honor Num<Rat>`
  would be the ordinary rebinding refusal.
- `Option.hex` declares the canonical optional-value union used by total
  standard-library accessors.
- `Vector.hex` owns the public Vector companion while delegating only
  representation-sensitive operations to the compiler/runtime core.

The complete package/prelude loader and the final boundary of the fundamental
stdlib remain project-system and stdlib-listing work. The Playground begins that
boundary with a deliberately small host manifest: it supplies the canonical
`Option.hex`, `Vector.hex`, and `Rat.hex` modules to every workspace rather than
maintaining example-local copies.
