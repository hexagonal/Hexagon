# Chapter Brief: Primitive Values and Strings

## Purpose

Give readers a practical model of Hexagon's six primitive types and show that their
JavaScript-native representations are a deliberate part of the language design. Spend
the most teaching time on numeric distinctions, interpolation, and Unicode behavior;
avoid turning the chapter into a catalogue of primitive-module functions.

## Reader outcome

After this chapter, the reader should be able to:

- choose among `Int`, `Float`, and `BigInt`;
- recognize the literal syntax of all six primitive types;
- understand integer safe-range and floating-point limitations;
- use numeric separators;
- rely on `Bool` without JavaScript truthiness;
- write interpolated and multiline strings;
- understand that string positions and traversal use Unicode codepoints; and
- predict the JavaScript and TypeScript faces of primitive values.

## Governing specification

- `spec/primitive-types.md`
- `spec/numeric-literals.md`
- `spec/division-remainder.md` only for the boundary between number kinds
- `spec/operators-logic-precedence.md` only where primitive operator use is visible

## Teaching boundaries

Preview, but defer full treatment of:

- `Num`, `Frac`, `Show`, and constraint inference;
- operator elaboration, precedence, division, and comparison semantics;
- indexing, slicing, and collection iteration;
- derived display for structured values; and
- the complete standard-library API for primitive companion modules.

## Technical skeleton

1. Return to the order example and inspect its concrete values.
2. The six primitive types and their JS/TS representations.
3. `Int`: default whole numbers, safe range, and silent overflow boundary.
4. `Float`: decimal/exponent literals and IEEE 754 honesty.
5. `BigInt`: explicit arbitrary precision and no mixed arithmetic.
6. `Bool`: no truthiness.
7. `String`: one literal form, interpolation through display, multiline text, escapes.
8. Unicode codepoints, no `Char`, and one-based positions.
9. `Unit` as the returning concept from the preceding chapter.
10. A compact boundary comparison and working summary.

## Examples to preserve

- `orderSummary` extends the established `orderTotal` example with interpolation.
- `attendees = 12_500` is the first numeric-separator example.
- `exactPopulation = 9_007_199_254_740_993n` distinguishes `BigInt` from `Int`.
- `"𝕏y"` has two codepoints even though JavaScript reports three UTF-16 code units.

## Audit notes

- Bare integer literals are polymorphic during inference but default to `Int`; do not
  falsely teach that their type is fixed lexically.
- A decimal point or exponent makes a literal monomorphic `Float`.
- `Int` and `Float` both emit as JS/TS `number`; `BigInt` emits as `bigint`.
- `Unit` emits as `undefined` and appears as `void` only in TS return position.
- Interpolation requires `Show`; it is not universal JavaScript coercion.
- Strings use codepoints for language operations, despite JS's UTF-16 storage.

