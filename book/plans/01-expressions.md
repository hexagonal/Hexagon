# Chapter Brief: Expressions

## Purpose

Give the reader Hexagon's basic model of computation before teaching its larger type
and data features: expressions produce values; bindings give values names; blocks
sequence the two without a separate semantic category of statements.

This is the first drafted chapter, but not necessarily the eventual Chapter 1. The
Introduction and Preface will be written after the body of the book.

## Reader outcome

After this chapter, the reader should be able to:

- introduce immutable names with `let`;
- distinguish a binding from an expression;
- read and write an indentation-delimited block;
- predict that a block's final expression supplies its value and type;
- recognize effect-only expressions through `Unit`;
- avoid accidentally discarding a computed value;
- use `ignore` when discarding is intentional; and
- understand why sequential bindings do not shadow or rebind names.

## Governing specification

- `spec/statements-blocks-mutability.md` §§1–5 and §8
- `spec/lexer-layout.md` §1 (only the reader-visible layout model)
- `spec/modules.md` §2 and §8 (module top-level exception and effects)
- `spec/primitive-types.md` §9 (`Unit`)
- `spec/functions.md` §§3 and 6 (function-body scaffolding and non-recursive `let`)

## Teaching boundaries

Preview, but defer full treatment of:

- function syntax and inference;
- primitive types, interpolation, and operators;
- layout mechanics, explicit semicolons, and comments;
- pattern bindings;
- `var` and assignment;
- recursion and `fun`; and
- modules and execution order.

## Technical skeleton

1. A small calculation: immutable values flowing through names.
2. Expressions produce values; bindings introduce names.
3. Blocks are sequences whose final expression is their result.
4. `Unit` makes effectful sequencing explicit.
5. Discarded values are errors; `ignore` is the deliberate escape hatch.
6. Names accumulate: sequential `let` bindings cannot shadow.
7. Source, JavaScript, and `.d.ts` view of a small exported function.
8. Working summary and forward links.

## Examples to preserve

- `orderTotal`: the first three-way source/JavaScript/`.d.ts` comparison.
- `prepareOrder`: demonstrates an effect followed by a returned value.
- `ignore(auditOrder(order))`: the canonical first intentional-discard example.

These names and their established facts must be recorded in `book/CONTINUITY.md` if
they survive revision.

## Audit notes

- Do not call a binding an expression or give it a type.
- Do not apply the final-expression rule to the module top level.
- A non-final expression must have type `Unit`; describe failures as discarded-value
  errors rather than unification failures.
- `ignore` is a prelude function, not syntax.
- State the no-shadowing rule narrowly here: sequential `let` names may not reuse an
  in-scope name. Head-binder shadowing belongs with functions and patterns.
