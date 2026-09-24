# Option and Result convenience functions

**Status:** Reviewed API contract. The requested API names and reference
implementations came from the user. Option.toSeq relies on Option's prelude data
seat (Modules §5.5): Option's implementation is seated after Seq.

**Homes:** `stdlib/Option.hex` and `stdlib/Result.hex`, ordinary prelude modules.
The existing canonical unions, Option's derived Eq/Show instances, and
Result.attempt keep their existing meanings. No new constructors, constraints,
instances, exceptions, implicit conversions, or unqualified prelude terms are
introduced by these convenience functions.

## 1. Calling and effects

All functions are subject-first. The module-qualified, pipeline, and eligible
dot-call spellings use the existing call rules; no receiver dispatch special
case belongs to this API. For example:

```hexagon
Option.defaultValue(possibleName, "Guest")
possibleName |> Option.defaultValue("Guest")
possibleName.defaultValue("Guest")
```

Callback-taking functions use the existing linked `->?` effect mechanism.
Passing a pure callback yields a pure call; passing an effectful callback
requires the appropriate effect mark on the outer call. Conditional execution
does not remove that static effect requirement: an effectful callback still
requires `!` at a concrete call even when this execution takes the branch that
skips that callback. The mark permits effects; it does not promise that an effect
occurs during that execution. Which branch skips it is defined per function below.
Propagation through another effect-polymorphic function uses the
existing `?` form. These functions introduce no new effect inference rules.

The selected callback is called exactly once; the other branch does not invoke
it. Ordinary argument evaluation still applies before the function runs,
including evaluation of an expression that produces a callback. No callback is
stored for later execution by map, flatMap, mapError, or defaultWith.

Exceptions from callbacks propagate unchanged. None of these functions catches
an exception or converts it to None or Err. Result.attempt remains the separate
exception-to-data operation.

## 2. Option

The following definitions specify behavior and source-level signatures:

```hexagon
export let map(source: Option(a), transform: a ->? b): Option(b) =
    match source
        Some(value) => Some(transform?(value))
        None => None

export let flatMap(source: Option(a), transform: a ->? Option(b)): Option(b) =
    match source
        Some(value) => transform?(value)
        None => None

export let defaultValue(source: Option(a), fallback: a): a =
    match source
        Some(value) => value
        None => fallback

export let defaultWith(source: Option(a), fallback: () ->? a): a =
    match source
        Some(value) => value
        None => fallback?()

export let toSeq(source: Option(a)): Seq(a) =
    match source
        Some(value) => Seq.singleton(value)
        None => Seq.empty
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

No Eq, Show, or other payload constraint is required by these functions.
Constructor matching is not equality testing. Opaque payloads and payloads that
lack instances can be carried and transformed normally.

The conversion remains Option.toSeq, not Seq.fromOption. This request does not
make Option honor Iterable and does not implement contextual conversion at a
Seq-expected position. Those would require their own contracts.

## 3. Result

```hexagon
export let map(source: Result(a, e), transform: a ->? b): Result(b, e) =
    match source
        Ok(value) => Ok(transform?(value))
        Err(error) => Err(error)

export let flatMap(source: Result(a, e), transform: a ->? Result(b, e)): Result(b, e) =
    match source
        Ok(value) => transform?(value)
        Err(error) => Err(error)

export let mapError(source: Result(a, e), transform: e ->? f): Result(a, f) =
    match source
        Ok(value) => Ok(value)
        Err(error) => Err(transform?(error))

export let defaultValue(source: Result(a, e), fallback: a): a =
    match source
        Ok(value) => value
        Err(_) => fallback

export let defaultWith(source: Result(a, e), fallback: e ->? a): a =
    match source
        Ok(value) => value
        Err(error) => fallback?(error)
```

- map changes only the success payload type. flatMap can produce success or
  failure, but keeps the same error type e in the input and callback result.
- mapError changes only the error payload type; it does not transform an Ok
  payload or turn it into an error.
- defaultValue has the same eager-argument behavior as Option.defaultValue.
- defaultWith invokes its callback only for Err and passes the actual error
  payload to it. This differs intentionally from Option.defaultWith's thunk.

No Eq, Show, or other payload/error constraint is introduced. Propagating an
untouched payload does not transform or clone that payload. These definitions
make no additional JavaScript wrapper-object identity promise beyond the
existing union representation contract.

## 4. Source ownership and documentation

Implement these definitions in their canonical stdlib source modules and
regenerate the embedded source snapshot. They need no new runtime intrinsic.
Existing module/prelude qualification rules expose them; Option's early data
seat exposes none of them.

The older getOrElse spelling appears in illustrative specification and book
examples but is not an implemented Option export. Update active examples to
`defaultValue`; do not introduce a compatibility alias or change the requested
name to preserve an old illustration. Keep historical review reports as history.
Book additions should explain transformations, chaining, and eager versus lazy
fallbacks conceptually, leaving the exhaustive API contract in this document
and source documentation.

## 5. Conformance requirements

Implementation and review must cover:

1. Both branches of every operation, with changed output types for map and
   mapError, nested map versus flattened flatMap, and unchanged error types for
   Result.flatMap.
2. Callback invocation counts and received arguments, including skipped branches
   and the error passed to Result.defaultWith.
3. Observable eager fallback-expression evaluation versus conditional invocation
   of defaultWith, without confusing callback-expression evaluation with calling
   the callback.
4. Pure and effectful callback calls, propagation through `?`, and rejection of
   missing or inappropriate call marks under the existing effect rules.
5. Exception propagation from selected callbacks and no callback execution on
   the opposite branch.
6. Qualified, pipeline, and dot-call use, with meaningful unconstrained and
   non-instance-bearing payloads; absence of accidental Eq/Show obligations.
7. Zero/one Option.toSeq results and repeated traversal, with actual runtime
   verification.
8. Existing Result.attempt and canonical union behavior remaining intact;
   generated stdlib source consistency and public hover/declaration signatures.

Focused checks do not substitute for the repository's required broader checks
before publication. This list describes required validation, not tests already
run for the new API.
