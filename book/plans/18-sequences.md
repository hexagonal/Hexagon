# Chapter Brief: Sequences

## Purpose

Explain `Seq(a)` as Hexagon's lazy immutable sequence and common iteration currency,
with a persistent functional cursor rather than a public mutable iterator.

## Reader outcome

The reader can transform and iterate a sequence, understand when work and effects
happen, use `Seq.next`, and predict its JavaScript and TypeScript boundary face.

## Governing specification

- `spec/loops-ranges-iteration.md` §6
- `spec/collections-part5-iterable.md`
- `spec/notes/ffi-proto-spec-questions.md` for persistent boundary adaptation direction

## Technical skeleton

1. `Seq(a)` is concrete, lazy, immutable, and possibly infinite.
2. Transformations such as `map`, `filter`, and `take` defer work.
3. `Seq.next` returns `Option((a, Seq(a)))` and never consumes the original position.
4. Loops pull on demand through the same protocol.
5. `iterate` converts a concrete iterable to `Seq` through static instance selection.
6. Collection conversion uses `toSeq` and `fromSeq` without an API inventory.
7. The JS/TS face is `Iterable<a>`, with adaptation preserving Hexagon persistence.

## Audit notes

- Do not promise a particular `Seq` representation.
- Avoid making unsettled producer/comprehension syntax central; no `seq { yield }`.
- Preserve the distinction between laziness and memoized persistent positions.
- Mention effects occur when elements are demanded, not when a pipeline is declared.
