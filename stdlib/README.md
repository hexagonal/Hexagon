# Hexagon standard library source

This directory holds Hexagon-written v1 standard-library modules as they become
executable conformance clients of the compiler. They are ordinary source modules,
not compiler intrinsics.

- `Show.hex`, `Num.hex`, `Signed.hex`, `Frac.hex`, `Pow.hex`, `Concat.hex`,
  `Eq.hex`, `Hash.hex`, `Ord.hex`, `Integral.hex`, and `Iterable.hex` are the
  **declaring modules** of the eleven constraints the compiler pre-registers. A
  constraint member is an export of its declaring module (#335), so these files
  are what put `show`, `add`, `equals`, `compare`, `div`, `toSeq` and the rest
  into bare scope everywhere; all eleven are prelude members, in the
  seats-before-uses order `compiler/src/prelude.ts` records. `Iterable.hex`
  seats after `Seq.hex`, whose type its member signature names.
- `Rat.hex` implements exact rational arithmetic over `BigInt`. Its constructor
  normalizes through Euclidean `BigInt.gcd` and exact quotient operations, and
  its arithmetic lives in its `honor` blocks — a member definition is a
  module-level binding, so a module-level `let add` beside `honor Num<Rat>`
  would be the ordinary rebinding refusal.
- `Option.hex` declares the canonical optional-value union used by total
  standard-library accessors.
- `Vector.hex`, `Map.hex`, and `Set.hex` own the public collection companions,
  each declaring its representation-sensitive operations through the intrinsic
  door (`spec/intrinsics.md` §3.2) onto the injected runtime tries
  (`runtime/VectorTrie.hex`, `runtime/HashTrie.hex`); everything above those
  declarations is ordinary Hexagon. `Seq.hex` declares `Seq(a)` itself and its
  combinator core.
- `JsKind.hex` and `JsValue.hex` are FFI Part 11's pair. `JsValue.hex` is the
  companion of the boundary type `JsValue` — the type of a JavaScript value
  about which Hexagon asserts nothing — and holds the total injection `from`,
  the total property-free classification `kind`, the five strict non-coercing
  scalar decoders, and the ordinary `JsConversionError` data they fail with.
  Only the classification and six representation-honest identities cross the
  intrinsic door; every guard above them is ordinary Hexagon here, and the five
  unchecked crossings are unexported, so §1's "no unsafe casts in v1" holds by
  construction. `JsKind.hex` exists so that `JsKind`'s ten constructors have the
  qualified home `spec/ffi.md` §12 requires of them: they are reached as
  `JsKind.Null` and are not auto-imported as bare prelude terms.
- `Debug.hex` holds the debugging probe: `log<a: Show>(value: a)` renders any
  showable value and writes it to the console through the door's one **species
  (a)** row (`spec/effects.md` §6.2), which stays at `String` and is unexported
  beneath it. The face is pure because nothing in the language can read that
  channel back, and `trace` is the expression-shaped form above `log`. It takes
  the last prelude seat, and its sink is captured when its emitted module
  initializes — the condition §6.2 attaches to the pure face.

The complete package/prelude loader and the final boundary of the fundamental
stdlib remain project-system and stdlib-listing work. The Playground begins that
boundary with a deliberately small host manifest: it supplies the canonical
`Option.hex`, `Vector.hex`, and `Rat.hex` modules to every workspace rather than
maintaining example-local copies.
