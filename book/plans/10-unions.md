# Chapter Brief: Unions

## Purpose

Teach closed alternatives as nominal data, constructors as ordinary terms, exhaustive
elimination, readable tagged-JavaScript representation, and the standard `Option` and
`Result` types.

## Reader outcome

The reader can declare and construct unions, distinguish nullary values from payload
constructors, write an exhaustive basic `match`, use `Option` and `Result`, and predict
the two union runtime representations.

## Governing specification

- `spec/unions.md`
- `spec/declarations-preamble.md`
- `spec/modules.md` for the ordinary exported face

## Technical skeleton

1. A union enumerates the possible shapes of one nominal type.
2. Nullary and payload constructors; named slots; recursion.
3. A first exhaustive `match` expression.
4. `Option` for possible absence and `Result` for recoverable outcomes.
5. Tagged POJOs and the all-nullary string special case.
6. Honest `.d.ts` discriminated unions and constructor exports.

## Examples to preserve

- `DeliveryStatus = Pending | Dispatched(tracking: String) | Delivered`.
- `displayStatus` is the canonical first union match.
- `Option(a)` and `Result(a, e)` retain their standard `Some`/`None` and `Ok`/`Err`
  declarations.

## Audit notes

- Payload constructors are n-ary functions; nullary constructors are bare values.
- Constructors and patterns are positional even when emitted payload fields are named.
- `match` is the only union eliminator; direct `.tag` access is illegal.
- Exhaustiveness and reachability are hard errors.
- `Option(a)` is not represented as `a | undefined`.
