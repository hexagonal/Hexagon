# Chapter Brief: Functions and Application

## Purpose

Establish functions as Hexagon's ordinary unit of behavior: inferred by default,
genuinely n-ary, directly represented in JavaScript, and recursive only when declared
with `fun`.

## Reader outcome

After this chapter, the reader should be able to:

- define and call `let`-bound functions;
- write anonymous lambdas;
- treat functions as values;
- understand zero-, one-, and many-parameter functions;
- recognize arity errors and write explicit partial-application lambdas;
- annotate parameters, results, and type variables where useful;
- use subject-first parameter order;
- choose `let` for ordinary functions and `fun` for recursion;
- write direct and mutual recursion; and
- predict the distinct JavaScript emission of `let` and `fun` functions.

## Governing specification

- `spec/functions.md`
- `spec/statements-blocks-mutability.md` for blocks and binder classification
- `spec/operators-logic-precedence.md` only for small recursive examples

## Teaching boundaries

Preview, but defer full treatment of:

- Hindley–Milner generalization and the value restriction;
- constrained functions and the meaning of `<a: Constraint>`;
- pipes and operator precedence;
- tuples and destructuring;
- patterns in parameters; and
- FFI treatment of callbacks and exported polymorphism.

## Technical skeleton

1. Return to `orderTotal` as a function value.
2. Header syntax and its lambda equivalent.
3. Functions as arguments and results.
4. N-ary application, required call parentheses, and no currying.
5. Nullary functions and `Unit`.
6. Annotations and explicit type variables.
7. Subject-first parameter order.
8. `let` is non-recursive; `fun` introduces recursion.
9. Hoisting, captures, mutual recursion, and monomorphic recursive calls.
10. `let` arrows versus `fun` declarations in emitted JavaScript.

## Examples to preserve

- `orderTotal` returns as the established ordinary `let`-bound function.
- `withStandardDelivery = subtotal => orderTotal(subtotal, 5)` is the first explicit
  partial-application replacement.
- `factorial` is the first recursive `fun`.
- `isEven`/`isOdd` demonstrate mutual recursion.

## Audit notes

- Header syntax and explicit lambda syntax are equivalent.
- Function arity is real; parameter lists are not tuple parameters.
- `f()` passes no hidden `Unit` argument.
- `let` cannot refer to its own name, even from a nested lambda.
- A `fun` RHS must be syntactically a lambda; header syntax satisfies this.
- A `fun` may be used only after all transitive captures are initialized.
- Recursive uses are monomorphic even though external uses may be polymorphic.
