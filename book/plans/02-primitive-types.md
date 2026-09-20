# Chapter Brief: Primitive Types

## Purpose

Give readers a practical model of Hexagon's fundamental prelude types and show how their
representations support their semantics, including Dec's opaque record. Spend
the most teaching time on numeric distinctions, interpolation, and Unicode behavior;
avoid turning the chapter into a catalogue of primitive-module functions.

## Reader outcome

After this chapter, the reader should be able to:

- choose among `Int`, `Float`, `Dec`, and `BigInt`;
- recognize the literal syntax of the fundamental types;
- understand integer safe-range and floating-point limitations;
- use numeric separators;
- rely on `Bool` without JavaScript truthiness;
- write interpolated and multiline strings;
- understand that string positions and traversal use Unicode codepoints; and
- predict the JavaScript and TypeScript faces of primitive values.

## Governing specification

- `spec/primitive-types.md`
- `spec/numeric-literals.md`
- `spec/dec.md`
- `spec/division-remainder.md` only for the boundary between number kinds
- `spec/operators-logic-precedence.md` only where primitive operator use is visible

## Teaching boundaries

Preview, but defer full treatment of:

- `Signed`, `Frac`, `Show`, and constraint inference;
- operator elaboration, precedence, division, and comparison semantics;
- indexing, slicing, and collection iteration;
- derived display for structured values; and
- the complete standard-library API for primitive companion modules.

## Technical skeleton

1. Return to the order example and inspect its concrete values.
2. The fundamental prelude types and their JS/TS representations.
3. `Int`: default whole numbers, safe range, and silent overflow boundary.
4. `Float`: unsuffixed decimal/exponent literals and IEEE 754 honesty;
   `Dec`: exact `d` literals, retained places, numerical equality, and explicit rounding.
5. `Bool`: no truthiness.
6. `String`: one literal form, interpolation through display, multiline text, escapes.
7. Unicode codepoints, no `Char`, and one-based positions.
8. `BigInt`: arbitrary precision, exact integer widening, and explicit lossy exits.
9. `Unit` as the returning concept from the preceding chapter.
10. A compact boundary comparison and working summary.

## Examples to preserve

- `orderSummary` extends the established `orderTotal` example with interpolation.
- `attendees = 12_500` is the first numeric-separator example.
- `exactPopulation = 9_007_199_254_740_993n` distinguishes `BigInt` from `Int`.
- `"🙂 Hi!"` has five codepoints even though JavaScript reports six UTF-16 code units;
  `👍🏽` then distinguishes codepoints from human-perceived graphemes.

## Audit notes

### `Dec` teaching contract

`spec/dec.md` records the settled first-release contract. The chapter now incorporates
this contract; implementation validation is tracked in the specification:

- Introduce `Dec` as a fundamental prelude type alongside the other number types.
  Replace the seven-type count and the claim that chapter membership requires a
  JavaScript primitive representation. `Dec` is an opaque nominal record; it
  does not become a compiler primitive.
- Teach exact finite decimals, retained decimal places (`1.50`), and the
  difference from significant-digit precision and `Float`.
- Explain that there is no conversion from `Float` to `Dec`, just as there is
  none from `Float` to `Rat`: converting an approximate input cannot recover
  its intended exact value. Begin with exact inputs instead; converting the
  stored binary approximation exactly would not recover the intended decimal.
- Present `show` as the preferred way to inspect or display a `Dec` in ordinary
  use: `5.00d.show()` returns `"5.00"`. Introduce `places` for code needing
  the count, and `unscaled` for extensions and adapters needing the unscaled integer:
  `5.00d.places()` returns `2`, while `5.00d.unscaled()` returns `500n`.
  Places use `Int`, with negative arguments rejected.
- Explain that multiplication adds decimal places: `1.50 * 2.00` displays as
  `3.0000`, while multiplying by a zero-place integer preserves two places.
- Show numerical equality despite different retained places, and explicit
  rounding through `divide` and `withPlaces`, with their respective `Even`
  variants. Round products by adjusting the exact multiplication result. `roundEven` names nearest rounding with ties to even,
  not rounding every value to an even number. Division has no `/` operator.
- Teach exact `d` literals (`5d`, `5.00d`, `0.050d`), preserved fractional digits,
  separators excluded from the digit count, digits on both sides of a written
  decimal point (`0.5d`, not `.5d` or `5.d`), and no exponent notation. Rewrite
  the mathematical examples above with `d` suffixes when used as executable code.
- Explain the potentially surprising consequence of numerical equality: `5d`
  and `5.00d` denote the same map key and match the same values. A `5.00d` match
  arm after `5d` is unreachable; retained places are not part of literal matching.
- Runtime text parsing is deferred until other numeric types establish its
  conventions. Use literals and `Dec.create` in this chapter. No `(x, y)dec`
  deconstruction pattern is provided.
- Once `spec/integer-widening.md` is implemented, teach that established Nat,
  Int, and BigInt values can enter Dec exactly at zero decimal places. Explain
  the shared BigInt route briefly; leave the `FromBigInt` capability and its
  instance obligations to the constraints chapter. No implicit Float input or
  Rat/Dec cross-conversion follows from integer friendliness.
- Keep currency identity and formatting outside the core introduction.

### Current chapter checks

- Bare integer literals are polymorphic during inference but default to `Int`; do not
  falsely teach that their type is fixed lexically.
- An unsuffixed decimal point or exponent makes a literal monomorphic `Float`; `d` selects Dec.
- `Int` and `Float` both emit as JS/TS `number`; `BigInt` emits as `bigint`.
- `Unit` emits as `undefined` and appears as `void` only in TS return position.
- Interpolation requires `Show`; it is not universal JavaScript coercion.
- Strings use codepoints for language operations, despite JS's UTF-16 storage.
