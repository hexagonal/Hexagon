# Chapter Brief: JavaScript Output

## Purpose

Gather the readable-emission promise that earlier chapters demonstrated feature by
feature. Show what stays native, what erases, what rewrites, what generates ordinary
code, and what needs an explicit runtime value.

## Reader outcome

The reader can inspect emitted JavaScript and recognize the source program's values,
evaluation order, module structure, data representations, and small amount of runtime
support without needing to understand compiler phases.

## Teaching order

1. Readable output preserves the program's story.
2. Native values and functions stay native.
3. Type-only distinctions erase while runtime data remains honest.
4. Pipes, dot calls, patterns, and derivation become direct code.
5. Truly generic constraints retain trailing dictionary evidence.
6. Persistent collections, sequences, ranges, and exceptions use explicit runtime
   support where native JavaScript has different semantics.
7. ESM structure and evaluation order remain visible.

## Continuity constraints

- Do not imply textual source-to-source translation; readability is constrained by
  semantics.
- Keep all-nullary unions as strings and mixed unions uniformly tagged objects.
- Keep tuples as arrays, records as POJOs, and nominal record construction erased when
  directly applied.
- State that runtime helpers exist where native JS would lie about Hexagon semantics.
- Keep dictionary evidence trailing and limited to genuinely generic code.
