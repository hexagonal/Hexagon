# Chapter Brief: Dot Calls

## Purpose

Teach type-directed dot calls as erased sugar for subject-first companion functions,
including their relationship to qualified calls, pipes, fields, inference, and
constraint members.

## Reader outcome

The reader can choose among qualified, pipe, and dot spellings; predict which function
a dot call selects; resolve field collisions; and know when an annotation is required.

## Governing specification

- `spec/method-syntax.md`
- `spec/modules.md` companion and home-module rules
- `spec/products.md` field access and row polymorphism
- `spec/constraints.md` member-call distinction

## Technical skeleton

1. Three spellings, one subject-first call.
2. Dot calls rewrite to companion operations.
3. Eligible companion operations are exported and subject-first.
4. Bare dots remain fields; no bound methods.
5. Field/operation collisions are hard errors with explicit rewrites.
6. Unknown receiver types retain callable-record-field inference.
7. Constraint members remain direct calls.
8. Emission, `.d.ts`, and completion.

## Audit notes

- Describe the useful source rule, not the internal deferred-goal algorithm.
- Member names never infer a nominal receiver type.
- Transparent aliases inherit the expanded type's companion.
- Structural records have fields only; tuples retain only `itemN` behavior.
- Dot calls add no runtime methods, prototypes, `this`, or `.d.ts` methods.
