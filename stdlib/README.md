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
- `Array.hex` is FFI Part 2's companion of the borrowed `Array(a)` — a
  zero-copy readonly view of a JavaScript array that foreign code owns. It is
  the companion for `JsValue.hex`'s reason: the type is compiler-owned and has
  no Hexagon declaration site, so the module addressable under the name is what
  answers for it. Its whole surface is the minimal decode loop: `length`
  (§6.3's one door row, the native `.length` read), and `get`, which is
  ordinary Hexagon over that row and the bracket. The asserting read `xs[i]` is
  an *expression form* and so is the emitter's lowering rather than an export
  here, exactly as `Vector`'s bracket and `Map`'s are; out of bounds it raises
  `Vector.hex`'s `IndexError`, the one such declaration in the corpus. There is
  no mutation surface and no `set`.
- `JsKind.hex`, `JsPathSegment.hex`, `JsConversionReason.hex`, and
  `JsValue.hex` are FFI Part 11's four. `JsValue.hex` is the companion of the
  boundary type `JsValue` — the type of a JavaScript value about which Hexagon
  asserts nothing — and holds the total injection `from`, the total
  property-free classification `kind`, the five strict non-coercing scalar
  decoders, the one structural decoder `toArray`, and the ordinary
  `JsConversionError` data they fail with. Only the classification, two
  predicates and seven representation-honest identities cross the intrinsic
  door; every guard above them is ordinary Hexagon here, and the six unchecked
  crossings are unexported.

  `toArray`'s probe is a door row of its own rather than a reuse of `kind`'s,
  and the split is the specification's: §3 requires `kind` to guard its
  `Array.isArray` so that no input makes the classification throw, and §4.2
  requires `toArray` *not* to, because a throwing probe is foreign control flow
  rather than a verdict about the data. A revoked proxy therefore classifies as
  `JsKind.Object` and throws out of `toArray`.

  That last sentence is the whole of what this module contributes to §1's "no
  unsafe casts in v1", and it is worth stating the standing exactly: the claim
  holds by the **prelude-injection privilege gate**, not by construction. A
  `"hex:intrinsic"` block is legal only in privileged source (`spec/intrinsics.md`
  §5.2's trust model), so ordinary user code cannot declare `asIntUnchecked` for
  itself — the same standing every other door in the library has, and the same
  standing `Vector.hex`'s trie rows have. Inside the gate the guarantee is the
  reviewed decoder above each crossing, and nothing stronger.
- The other three files each declare one union and exist so that its
  constructors have the qualified home `spec/ffi.md` §12 requires (as extended
  for #511): `JsKind.Null`, `JsPathSegment.Index(3)`,
  `JsConversionReason.Shape`. None of the twenty-one constructors is
  auto-imported as a bare prelude term, so the prelude spends none of `Shape`,
  `Range`, `Cycle`, `Field`, `Index`, `MapKey`, `MapValue`, `SetElement`, or the
  ten kind names on a user's behalf. `JsKind` also derives `Eq` and `Show`, so
  `kind(v) == JsKind.Number` is the ordinary comparison it looks like.
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
