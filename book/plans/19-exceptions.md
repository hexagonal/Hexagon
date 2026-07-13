# Chapter Brief: Exceptions

## Purpose

Teach Hexagon's open exception type, pattern-based handling, foreign-error door, and
the boundary between predictable `Result` values and unpredictable exceptional flow.

## Reader outcome

The reader can declare, construct, throw, and catch exceptions; predict implicit
rethrow and reachability; handle foreign throwables; and convert exceptional code to a
`Result` with `Result.attempt`.

## Governing specification

- `spec/exceptions.md`
- `spec/pattern-matching.md` for the full catch-pattern grammar
- `spec/modules.md` for module-level declarations and qualification

## Technical skeleton

1. Predictable failure is union data; exceptions handle open, unpredictable failure.
2. `exception` declarations add concrete constructors to `Exn`.
3. Construction and `throw` are separate; `throw` can inhabit any result position.
4. `try`/`catch` is an expression with pattern arms.
5. Catch is non-exhaustive by design and unmatched exceptions rethrow implicitly.
6. `JsError` is the single door for foreign thrown values.
7. `Result.attempt` converts exceptional computation to `Result(a, Exn)`.
8. Runtime values are branded JavaScript `Error` objects with honest `.d.ts` faces.

## Audit notes

- The Patterns chapter supersedes the original flat-pattern restriction for catch arms.
- Payload types are concrete; there are no polymorphic exceptions.
- Nullary exceptions construct fresh values to capture useful stacks.
- `match` cannot inspect `Exn`; use `catch`.
- Do not promise `finally` or typed structure for arbitrary `JsValue` payloads.
