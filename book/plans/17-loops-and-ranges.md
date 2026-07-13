# Chapter Brief: Loops and Ranges

## Purpose

Teach Hexagon's two loops, inclusive integer ranges, loop patterns, and the static rule
that connects a concrete iterable type to its element type.

## Reader outcome

The reader can write `for` and `while` loops, accumulate with a local `var`, predict
range boundaries and emptiness, destructure iterable elements safely, and understand
why a generic function should accept `Seq(a)` rather than an unknown iterable type.

## Governing specification

- `spec/loops-ranges-iteration.md`
- `spec/collections-part5-iterable.md`
- `spec/pattern-matching.md` for full irrefutable loop patterns
- `spec/statements-blocks-mutability.md` for loop-body and binder rules

## Technical skeleton

1. `for pattern in expression` evaluates its source once.
2. Loops and their bodies are `Unit`-typed.
3. `Range`, `..`, `range`, and `rangeDown` are inclusive and integer-only.
4. Reversed bounds produce empty ranges rather than changing direction.
5. `while` reevaluates a `Bool` condition before every iteration.
6. Loop patterns use the established pattern language and must be irrefutable.
7. Iteration resolution is static from the source's known outer type.
8. Native JavaScript loop emission remains visible.

## Audit notes

- The Patterns chapter supersedes the original bare-name-only loop head.
- `String` iteration yields one-codepoint `String` values.
- Keep associated types and user-defined `Iterable` machinery out of this chapter;
  reusable consumers take `Seq(a)` instead.
- There is no `break` or `continue`.
