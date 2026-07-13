# Chapter Brief: Derivation

## Purpose

Explain opt-in compiler generation of `Eq`, `Ord`, `Show`, and `Hash` instances for nominal
records and unions, including the structural laws each generated instance follows.

## Reader outcome

The reader can choose appropriate derived capabilities, predict equality, ordering,
and display behavior, diagnose an underivable field, and choose a hand-written
instance when representation is not meaning.

## Governing specification

- `spec/decisions-batch-2026-07.md` §2
- `spec/products.md` structural constraint semantics
- `spec/unions.md` §7
- `spec/constraints.md` coherence and superconstraints

## Technical skeleton

1. Nominal capabilities are opt-in.
2. `derives` header sugar and `honor ... = derive` core form.
3. Structural tuples and records derive automatically.
4. Record equality, ordering, and display.
5. Union equality, declaration-order ordering, and display.
6. Parameterized derivation and failure diagnostics.
7. When to write a custom instance.
8. Emission and boundary behavior.

## Audit notes

- Final spelling is `honor Eq<Point> = derive`, despite the older decision document's
  superseded `implement` spelling.
- Only `Eq`, `Ord`, `Show`, and `Hash` are derivable.
- `Ord` requires `Eq`.
- `Hash` requires a derived `Eq` and cannot be hand-written by users.
- Nominal derivation is opt-in; structural tuple/record instances are automatic.
- Union ordering follows declaration order, not emitted string order.
