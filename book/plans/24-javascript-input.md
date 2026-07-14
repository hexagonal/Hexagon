# Chapter Brief: JavaScript Input

## Purpose

Teach how Hexagon binds existing JavaScript modules and crosses values honestly:
trusted `extern` declarations, explicit nullability, borrowed arrays, adapted
sequences, receiver members, classes, foreign enums, callbacks, and shallow collection
conversions.

## Reader outcome

The reader can write an ordinary extern binding, choose a boundary type that states the
real JavaScript representation, call receiver-based APIs without introducing objects
into Hexagon's type system, and know when crossing is direct, borrowed, adapted, or an
explicit conversion.

## Teaching order

1. `extern` is a checked declaration and a trusted implementation contract.
2. Named, aliased, default, value, type, and effect bindings.
3. Representation-direct values and the numeric trust rule.
4. `Nullable(a)` keeps foreign absence explicit and separate from `Option(a)`.
5. `Array(a)` is a zero-copy readonly borrow; `Vector(a)` is a stable persistent value.
6. A top-level `Seq(a)` boundary receives a persistent memoizing adapter.
7. `method`, `get`, `set`, and `class` describe JavaScript calling conventions while
   producing ordinary subject-first Hexagon functions.
8. `extern enum` presents stable foreign object members as a closed nullary union while
   retaining their actual runtime values; uncertain input uses generated `fromJsT`.
9. Representation-direct callbacks retain ordinary function identity.
10. Explicit collection conversions are shallow snapshots where appropriate.
11. Foreign throws use `JsError`; uncertain `JsValue` data requires explicit decoding.

## Continuity constraints

- Keep `Option(a)` as a real Hexagon union; never imply it erases to nullish values.
- Keep `Array(a)` distinct from persistent `Vector(a)` and expose no array mutation.
- Do not imply that arbitrary JavaScript iterators already satisfy persistent `Seq`
  semantics.
- Keep subject-first argument order; receiver restoration is an emission rule only.
- State that ordinary extern declarations are trusted rather than silently validated.
- Keep ordinary nullary unions string-backed; only `extern enum` captures foreign
  member values, and its listed values must be stable and distinct.
- Keep conversions shallow and reject hidden nested adaptation.
- Avoid an exhaustive binding or conversion API catalogue.
