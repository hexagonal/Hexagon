# Chapter Brief: Patterns

## Purpose

Expand the union, tuple, and record patterns already seen into one coherent grammar:
nested constructor, tuple, record, literal, or-, and as-patterns with guards, exact
exhaustiveness, reachability, and irrefutable binding positions.

## Reader outcome

The reader can choose and compose patterns, bind useful sub-values, use guards for
runtime conditions, understand why some patterns are illegal in `let` and parameter
positions, and respond to missing/unreachable-case diagnostics.

## Governing specification

- `spec/pattern-matching.md`
- `spec/unions.md` §4 baseline
- `spec/products.md` destructuring and nominal crossings

## Technical skeleton

1. Patterns describe shapes and bind names; they do not run expressions.
2. Nested constructors, tuples, and open record patterns.
3. Literal patterns and the permanent Float-literal exclusion.
4. Or-patterns and the same-bindings rule.
5. As-patterns and guards.
6. Exhaustiveness, reachability, and guarded-arm coverage.
7. Irrefutable patterns in `let` and lambda parameters; tuple depth rule.
8. Readable emission at a high level.
9. Later vector, loop, and catch extensions remain one pattern language.

## Examples to preserve

- Nested `Option` patterns reuse the previous chapter.
- A `DeliveryStatus` match uses an or-pattern and an `as` binding.
- `Point({x, y})` is the nominal-record destructuring spelling.

## Audit notes

- Guards contribute nothing to exhaustiveness.
- Infinite literal domains require a catch-all; `Bool` can be covered exactly.
- `()` is the sole `Unit` pattern and is exhaustive by itself.
- Record patterns are open and never write `...`.
- Every or-pattern alternative binds the same names at compatible types.
- Binding positions accept only patterns that match every value of the known type.
