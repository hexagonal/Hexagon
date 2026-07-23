# Chapter Brief: Operators

## Purpose

Teach Hexagon's fixed operator vocabulary, its mathematical precedence, expression-valued
conditionals, comparison chains, word-based logic, and subject-first pipe. Connect these
forms to the primitive and function model already established without teaching the full
constraint system prematurely.

## Reader outcome

After this chapter, the reader should be able to:

- use arithmetic, exponentiation, concatenation, comparison, and logical operators;
- distinguish floating division from named integer division and remainder operations;
- read the precedence table and recognize its few intentional departures from JS;
- write safe comparison chains;
- predict short-circuit behavior;
- use inline and canonical multiline `if … then … else` expressions;
- use `|>` as first-argument insertion; and
- understand that operators are a fixed language vocabulary rather than user-defined
  punctuation.

## Governing specification

- `spec/operators-logic-precedence.md`
- `spec/division-remainder.md`
- `spec/primitive-types.md`
- `spec/functions.md` for pipe insertion and lambda interaction

## Teaching boundaries

Preview, but defer full treatment of:

- constraint declarations, instances, and dictionary passing;
- ranges, indexing, slicing, and assignment semantics;
- `match` expressions;
- exception declarations and catching arithmetic errors; and
- every primitive companion-module numeric function.

## Technical skeleton

1. Fixed operators over typed values.
2. Arithmetic and exponentiation.
3. Why integer division and remainder use names.
4. String concatenation.
5. Equality, ordering, and comparison chains.
6. Word-based Boolean logic and short-circuiting.
7. Inline and canonical multiline conditionals as expressions.
8. The pipe as first-argument insertion.
9. The compact precedence table and two notable parses.
10. Direct JavaScript emission and working summary.

## Examples to preserve

- `0 <= discount <= 100` is the canonical comparison chain.
- `eligible and not suspended` introduces word-based logic.
- `winGame implies getPizza` explains implication as a promise rather than through a
  formal Boolean rewrite.
- `dishes |> rinse |> wash |> dry` is the canonical pipe chain and is explained as a
  familiar process rather than through associativity terminology.
- `subtotal |> applyDiscount(discount) |> orderTotal(delivery)` continues the order
  example and demonstrates subject-first insertion.
- `-2 ** 2 == -4` is the precedence example where Hexagon follows mathematics.

## Audit notes

- Operators are fixed sugar for constraint members; users cannot define new operators.
- `/` requires `Frac`; `Int` and `BigInt` use named division families.
- `mod` is Euclidean and non-negative; `rem` is JS/C-style truncated remainder.
- `and`, `or`, and `implies` short-circuit; `iff` evaluates both operands.
- Comparison chains evaluate each source operand once and reject mixed directions and
  chained `!=`.
- Pipes insert as the first argument and disappear before type inference.
- Every `if` requires both `then` and `else`; canonical multiline formatting keeps
  `then` on the condition line and indents both branches.
