# Option and Result convenience functions

**Status:** Reviewed API contract. The requested API names and reference
implementations came from the user. Option.toSeq relies on Option's prelude data
seat (Modules §5.5): Option's implementation is seated after Seq. Amended
2026-11-03 (#1427): `Result` holds a caught exception (`Result(a)`, the type
`attempt` gives), `mapError` is withdrawn, and both modules gain a conversion
to the other and presence predicates; `Result`'s seat precedes `Seq`'s,
and so `Option`'s full seat, which names it.

**Homes:** `stdlib/Option.hex` and `stdlib/Result.hex`, ordinary prelude modules.
Option's derived Eq/Show instances keep their existing meanings. No new
constraints, instances, exceptions, implicit conversions, or unqualified prelude
terms are introduced by these convenience functions.

## 1. Calling and effects

All functions are subject-first. The module-qualified, pipeline, and eligible
dot-call spellings use the existing call rules; no receiver dispatch special
case belongs to this API. For example:

```hexagon
Option.defaultValue(possibleName, "Guest")
possibleName |> Option.defaultValue("Guest")
possibleName.defaultValue("Guest")
```

Callback-taking functions take `->!` callbacks and follow what they are handed (Effects §2.4),
except the exception builders of `orThrow` and `toResult`, which are pure `() -> Exn` thunks.
Passing a callback that is pure and cannot fail yields a bare call; passing one
that is impure or may fail requires the matching mark on the outer
call (`^`, `~` or `!`). Conditional execution does not remove that static
requirement: such a callback still requires its mark at a concrete call even
when this execution takes the branch that skips that callback. The mark permits effects; it does not promise that an effect
occurs during that execution. Which branch skips it is defined per function below.
Handing a callback on to another callback-taking function needs nothing
special: each callback has its own colour (Effects §2.4). These functions
introduce no new effect inference rules.

The selected callback is called exactly once; the other branch does not invoke
it. Ordinary argument evaluation still applies before the function runs,
including evaluation of an expression that produces a callback. No callback is
stored for later execution by map, flatMap, or defaultWith.

A failure in a callback propagates unchanged: `Option.map^(name, parse)` wears
the `^` its callback brings. None of these functions catches a failure or
converts it to `None` or `Err`. A failure becomes data at the call with the
reading `?` (`Int.parse?(text)` is an `Option(Int)`; Effects §3.1), and over a
block with `attempt` (a `Result(a)`; Exceptions §8.2). Data becomes a
failure again with `orThrow` (§2, §3).

**The three ways a failure is carried** (Exceptions §1). An expected failure is
an exception, a broken assumption is a fault, and an answer that may be absent
is an `Option`. `Result` is none of these: it is the value that holds a caught
exception, so that an outcome can be kept, stored or handed on. Its error is
always an `Exn`. A program whose failures are data of its own, such as a
validator's list of problems, declares a union for them.

## 2. Option

The following definitions specify behavior and source-level signatures:

```hexagon
export let map(source: Option(a), transform: a ->! b): Option(b) =
    match source
        Some(value) => Some(transform!(value))
        None => None

export let flatMap(source: Option(a), transform: a ->! Option(b)): Option(b) =
    match source
        Some(value) => transform!(value)
        None => None

export let defaultValue(source: Option(a), fallback: a): a =
    match source
        Some(value) => value
        None => fallback

export let defaultWith(source: Option(a), fallback: () ->! a): a =
    match source
        Some(value) => value
        None => fallback!()

export let toSeq(source: Option(a)): Seq(a) =
    match source
        Some(value) => Seq.singleton(value)
        None => Seq.empty

export let orThrow(source: Option(a), failure: () -> Exn): a =
    match source
        Some(value) => value
        None => throw^(failure())

export let toResult(source: Option(a), failure: () -> Exn): Result(a) =
    match source
        Some(value) => Ok(value)
        None => Err(failure())

export let isSome(source: Option(a)): Bool =
    match source
        Some(_) => True
        None => False

export let isNone(source: Option(a)): Bool =
    match source
        Some(_) => False
        None => True
```

- map transforms a present payload; it does not flatten an Option returned by
  the callback. flatMap uses an Option-returning callback without adding another
  Some layer.
- defaultValue receives an already-evaluated fallback value. An expression used
  as that argument is evaluated even when source is Some.
- defaultWith invokes its thunk only for None. It does not call it for Some.
- toSeq produces zero or one elements, preserving the payload as supplied.
  It is pure, introduces no effectful pull, and follows the existing Seq
  traversal contract. Repeated traversals produce the same zero/one sequence;
  no conversion callback is postponed into traversal.
- orThrow returns a present payload, and for None throws the exception its
  thunk constructs. Its face is `(Option(a), () -> Exn) ->^ a`: it may fail on
  its own account, so every call wears `^`. The thunk is pure, so building the
  exception is pure and its construction, and the stack it captures,
  happen at the throw (Exceptions §4).
- toResult is the same choice kept as data: `Ok` of a present payload, and for
  None an `Err` of the exception its thunk constructs. It throws nothing, so its
  calls are bare. The thunk is called only for None, so an exception, and the
  stack it captures, is built only when it is kept.
- isSome and isNone answer whether a payload is present. They read the
  constructor only, so they ask for no `Eq` on the payload, where `o == None`
  would.

No Eq, Show, or other payload constraint is required by these functions.
Constructor matching is not equality testing. Opaque payloads and payloads that
lack instances can be carried and transformed normally.

The conversion remains Option.toSeq, not Seq.fromOption. This request does not
make Option honor Iterable and does not implement contextual conversion at a
Seq-expected position. Those would require their own contracts.

## 3. Result

```hexagon
export union Result(a) =
    | Ok(value: a)
    | Err(error: Exn)

export let map(source: Result(a), transform: a ->! b): Result(b) =
    match source
        Ok(value) => Ok(transform!(value))
        Err(error) => Err(error)

export let flatMap(source: Result(a), transform: a ->! Result(b)): Result(b) =
    match source
        Ok(value) => transform!(value)
        Err(error) => Err(error)

export let defaultValue(source: Result(a), fallback: a): a =
    match source
        Ok(value) => value
        Err(_) => fallback

export let defaultWith(source: Result(a), fallback: Exn ->! a): a =
    match source
        Ok(value) => value
        Err(error) => fallback!(error)

export let orThrow(source: Result(a)): a =
    match source
        Ok(value) => value
        Err(failure) => throw^(failure)

export let toOption(source: Result(a)): Option(a) =
    match source
        Ok(value) => Some(value)
        Err(_) => None

export let isOk(source: Result(a)): Bool =
    match source
        Ok(_) => True
        Err(_) => False

export let isErr(source: Result(a)): Bool =
    match source
        Ok(_) => False
        Err(_) => True
```

- map changes only the success payload type. flatMap can produce success or
  failure; its callback's `Err` is kept as it is.
- defaultValue has the same eager-argument behavior as Option.defaultValue.
- defaultWith invokes its callback only for Err and passes it the caught
  exception. This differs intentionally from Option.defaultWith's thunk.
- orThrow returns an Ok payload and throws an Err's exception, with the stack
  it was constructed with. Its face is `Result(a) ->^ a`. It is the inverse of
  `attempt` (Exceptions §8.2, §8.4).
- toOption keeps an Ok payload as Some and drops an Err's exception. It throws
  nothing. Conversions between data are named for their target (`toSeq`,
  `toOption`, `toResult`), as Collections Part 1 §3.1's conversion suite is;
  they are not readings, which belong to calls that may fail (Effects §3.1).
- isOk and isErr answer which constructor is present.
- There is no mapError. The error is always an `Exn`; a program that wants a
  different exception catches and throws again, and one whose failures are data
  of its own declares a union for them (§1).

No Eq, Show, or other payload constraint is introduced. Propagating an
untouched payload does not transform or clone that payload. These definitions
make no additional JavaScript wrapper-object identity promise beyond the
existing union representation contract.

## 4. Source ownership and documentation

Implement these definitions in their canonical stdlib source modules and
regenerate the embedded source snapshot. They need no new runtime intrinsic.
Existing module/prelude qualification rules expose them; Option's early data
seat exposes none of them.

**Seats** (Modules §5.5). `Result.hex` takes its seat just before `Seq.hex`,
and so before `Option.hex`'s full seat, which follows `Seq.hex`: that lets
`Option.toResult` name `Result`. `Result.hex` needs only `Option`'s data seat,
which is earlier still: its `toOption` applies `Some` and `None`, and calls
none of `Option`'s functions, and it names nothing of `Seq`'s.

The older getOrElse spelling appears in illustrative specification and book
examples but is not an implemented Option export. Update active examples to
`defaultValue`; do not introduce a compatibility alias or change the requested
name to preserve an old illustration. Keep historical review reports as history.
Book additions should explain transformations, chaining, and eager versus lazy
fallbacks conceptually, leaving the exhaustive API contract in this document
and source documentation.

## 5. Conformance requirements

Implementation and review must cover:

1. Both branches of every operation, with changed output types for map,
   nested map versus flattened flatMap, and an Err passed through
   Result.map and Result.flatMap unchanged.
2. Callback invocation counts and received arguments, including skipped branches
   and the exception passed to Result.defaultWith.
3. Observable eager fallback-expression evaluation versus conditional invocation
   of defaultWith, without confusing callback-expression evaluation with calling
   the callback.
4. Pure and effectful callback calls, callbacks handed on, and rejection of
   missing or inappropriate call marks under the existing effect rules.
5. Exception propagation from selected callbacks and no callback execution on
   the opposite branch.
6. Qualified, pipeline, and dot-call use, with meaningful unconstrained and
   non-instance-bearing payloads; absence of accidental Eq/Show obligations.
7. Zero/one Option.toSeq results and repeated traversal, with actual runtime
   verification.
8. orThrow's throw for None and Err, its `^` mark, and canonical union
   behavior remaining intact;
   generated stdlib source consistency and public hover/declaration signatures.
9. toResult's thunk called only for None, toOption and toResult as bare calls
   reached by the dot, the round trips `attempt` → `orThrow` and
   `toResult` → `toOption`, the four predicates on both constructors, and
   `Option.toResult` compiling at `Option.hex`'s seat.
10. `Result` with one type argument everywhere: a second argument is refused
    with the ordinary arity report.

Focused checks do not substitute for the repository's required broader checks
before publication. This list describes required validation, not tests already
run for the new API.
