# Chapter Brief: Constraints

## Purpose

Explain how generic code asks for capabilities, how types supply them through `honor`,
and why global coherence makes the result predictable and cheap.

## Reader outcome

The reader can read and write constrained functions, declare a small constraint,
supply an instance, understand base constraints and the orphan rule, and recognize
when dictionaries do or do not survive into JavaScript.

## Governing specification

- `spec/constraints.md`
- `spec/integral-constraint.md`
- collection specifications for `Hash` and `Iterable`
- `spec/modules.md` for instance visibility and the orphan rule

## Technical skeleton

1. A constraint names a capability required of a type.
2. Constrained binders and inferred constraints.
3. Constraint declarations, required operations, and default operations.
4. Default operations and `Eq.notEquals`.
5. `honor` declarations and instance checking.
6. Base constraints.
7. Coherence, overlap, and the orphan rule.
8. Prelude capability map without becoming an API inventory.
9. Dictionary compilation, monomorphic erasure, and the JS/TS boundary.

## Examples to preserve

- `Show` gives a small generic label function.
- `Area` and `Rectangle` are the canonical user-defined constraint and instance.
- `Ord` requiring `Eq` demonstrates a base constraint.

## Audit notes

- Use final keyword `honor`, never the superseded `implement` spelling.
- Members are called directly; they are not dot-callable companion operations.
- Members without bodies are required; members with bodies are overridable defaults.
- `Eq.equals` is required; `Eq.notEquals` defaults to `not equals(...)`; `!=` uses it.
- Defaults may call other members, but circular inherited defaults can recurse forever;
  the book warns readers to ground defaults in required operations.
- One instance per constraint/type constructor, program-wide.
- Instances are global once their module participates in the program.
- Genuinely polymorphic JavaScript carries dictionaries after the source arguments as
  trailing evidence.
- Nothing constraint-shaped appears in ordinary `.d.ts` output.
