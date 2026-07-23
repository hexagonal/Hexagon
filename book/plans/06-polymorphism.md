# Chapter Brief: Polymorphism

## Purpose

Explain the type behavior already visible in earlier examples without turning the
chapter into an inference-algorithm lecture. Emphasize observable rules: inferred
relationships, let-polymorphism, lambda-parameter monomorphism, the value restriction,
numeric defaulting, annotations, and monomorphic recursive calls.

## Reader outcome

The reader can predict common inferred types, understand why a `let`-bound identity is
reusable at several types, recognize the value restriction, add useful annotations, and
understand the narrow boundary around recursive polymorphism.

## Governing specification

- `spec/functions.md` §§4 and 8
- `spec/numeric-literals.md`
- `spec/type-system-overview.md` §§1–2
- `spec/statements-blocks-mutability.md` §7

## Technical skeleton

1. Inference discovers relationships rather than guessing conversions.
2. An unannotated identity function.
3. Let-polymorphism: fresh use at each call.
4. Lambda parameters remain one type per call.
5. The value restriction and a function-producing call: `let` is necessary but not
   sufficient for generalization.
6. Bare integer defaulting.
7. Annotations document or narrow; they do not enable ordinary inference.
8. Recursive calls are monomorphic.
9. Types erase from ordinary emitted JavaScript.

## Examples to preserve

- `identity` used at `Int` and `String` is the canonical let-polymorphism example.
- `useAtTwoTypes` with `ignore(f(1))` is the canonical lambda-parameter error and
  returns to deliberate discarding.
- `makeIdentity()` demonstrates the value restriction without requiring collections.

## Audit notes

- Do not expose Algorithm J, union-find, levels, metavariables, or unification internals.
- A bare literal binding defaults to `Int`; literals inside generic numeric functions
  can remain constraint-directed.
- Explicit type variables describe/restrict inferred polymorphism; they do not create it.
- Recursive calls in a `fun` group use the group's monomorphic type.
- Do not suggest rank-2 polymorphism or first-class polymorphic lambda parameters.
