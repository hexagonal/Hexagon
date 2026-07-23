# Chapter Brief: Tuples

## Purpose

Introduce the smallest compound data shape: a fixed number of positional values. Use
tuples to make multiple results and the argument-versus-value distinction concrete,
without teaching records or general pattern matching yet.

## Reader outcome

The reader can construct, infer, access, destructure, return, and pass tuples; can
distinguish a tuple value from an n-ary argument list; and can predict JS array and TS
tuple representations.

## Governing specification

- `spec/products.md` §§1–2
- `spec/pattern-matching.md` for the current tuple-pattern rules
- `spec/functions.md` §5 for tuple versus argument lists

## Technical skeleton

1. Several values travelling together.
2. Construction and heterogeneous inferred types.
3. No one-element tuple; `()` remains Unit.
4. `itemN` access.
5. Destructuring and `_`.
6. Returning several results.
7. One tuple argument versus several function arguments.
8. JS array and TS tuple faces.

## Examples to preserve

- `("Mira", 3)` is the first tuple and reads as a small useful fact.
- `minMax` returns `(smallest, largest)`.
- `move(3.0, 4.0)` versus `move(coordinates)` pays off the argument distinction deferred
  from the functions chapter.

## Audit notes

- Tuples have arity at least two; parentheses around one value are grouping.
- Access is one-based `item1`, `item2`, and emits zero-based JS indexing.
- Tuples are immutable structural values represented by JS arrays.
- Do not teach named tuple elements; names suggest records.
- Keep pattern examples simple even though the later pattern chapter expands them.
