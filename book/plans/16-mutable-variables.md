# Chapter Brief: Mutable Variables

## Purpose

Explain Hexagon's single, confined form of mutation and show why it remains an
implementation tool inside a function rather than mutable state shared by a program.

## Reader outcome

The reader can declare and update a local `var`, predict its type and `Unit` result,
recognize invalid assignment targets, and cross a lambda boundary by taking an
immutable snapshot.

## Governing specification

- `spec/statements-blocks-mutability.md`
- `spec/operators-logic-precedence.md` for `:=` grammar
- `spec/modules.md` for the absence of module-level mutable state

## Technical skeleton

1. `var` is a local mutable binding inside a function.
2. `:=` updates a bare `var` name and produces `Unit`.
3. A `var` is monomorphic and cannot change type.
4. Records, tuples, fields, parameters, and `let` names remain immutable.
5. A lambda may neither read nor assign an enclosing `var`.
6. Copying the current value to a `let` creates an immutable snapshot for callbacks.
7. Emission is direct JavaScript `let` and assignment with no `.d.ts` effect.

## Audit notes

- `var` is name-only, function-body-only, non-recursive, and never generalized.
- Do not introduce ref cells, compound assignment, mutable fields, or module-level
  `var`.
- Loop bodies are blocks rather than lambdas and may therefore update a `var` in the
  same function.
