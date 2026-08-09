# Exceptions

Hexagon uses two different tools for two different kinds of failure.

When callers can reasonably anticipate every outcome, return data:

```hexagon
let parsePort(text: String): Result(Int, ParseProblem) = ...
```

`Result` is a closed union. A caller can match every possible error and the compiler
can verify that nothing was forgotten.

Exceptions serve failures that cannot be enumerated so neatly: broken assumptions,
failed foreign calls, unavailable resources, or errors that must propagate through
code whose result type should not permanently include them all. Hexagon gives these
values the open type `Exn`.

## Exception declarations add constructors to `Exn`

Declare exceptions at module level:

```hexagon
exception NotFound
exception ParseError(line: Int, message: String)
exception Timeout(millis: Int)
```

Each declaration introduces a constructor whose result type is `Exn`. Payload
constructors follow the same n-ary rules as union constructors:

```hexagon
let error: Exn = ParseError(12, "unexpected token")
```

A nullary exception is used without parentheses:

```hexagon
let missing: Exn = NotFound
```

Exception payload types must be concrete. There is no parameterized exception
declaration corresponding to `Option(a)` or `Result(a, e)`; every independently
declared constructor joins the same open `Exn` type.

Payload slots may be named or unnamed, following the all-or-none constructor rule. The
name `message` has a useful special role: it must be `String` and becomes the message of
the underlying JavaScript `Error`. The representation also reserves `name`, `stack`,
and `$`-initial field names.

## Constructing is separate from throwing

An exception is an ordinary first-class value. It can be bound, passed, stored, and
thrown later. Throwing uses an ordinary function call:

```hexagon
throw(ParseError(12, "unexpected token"))
throw(error)
```

`throw` never returns. Its result can therefore fit wherever the surrounding expression
expects a value:

```hexagon
let requireName(possibleName: Option(String)): String =
    match possibleName
        Some(name) => name
        None => throw(NotFound)
```

The function still returns `String` when it returns normally.

The stack trace is captured when the exception value is constructed, as it is for
JavaScript `Error`. Constructing beside the `throw` therefore records the useful throw
site. If an exception is constructed and stored for later, its stack points to that
earlier construction site.

## `try` and `catch` form an expression

A `catch` block is like a `match` block, except that the value being matched is the
thrown exception and unmatched cases are automatically rethrown instead of producing
an exhaustiveness error:

```hexagon
let loadConfiguration(path: String): Configuration =
    try
        readConfiguration(path)
    catch
        ParseError(line, message) =>
            print("Line ${line}: ${message}")
            defaultConfiguration
        NotFound => defaultConfiguration
```

The `try` body and every catch-arm body must produce the same type. Here successful
loading and both recovery paths produce `Configuration`.

Catch arms are tried from top to bottom. Constructor, tuple, record, literal, or-, and
as-patterns may nest, and guards work as they do in `match`. Pattern binders are local
to their arm and may use familiar short names.

An exception thrown while evaluating a catch arm is not caught again by that same
`catch`; it propagates outward.

## Missing cases propagate automatically

Unlike a `match`, a `catch` is not required to be exhaustive. `Exn` is open: another
module or JavaScript itself may introduce a failure this module has never heard of.

An exception that matches no arm is **implicitly rethrown**. The previous example
handles `ParseError` and `NotFound`; `Timeout` and every other exception continue to an
enclosing handler without requiring a final boilerplate arm.

A wildcard catches everything:

```hexagon
try
    riskyOperation()
catch
    _ => fallback
```

Use that breadth deliberately—it includes both Hexagon and foreign failures. Reachability
is still checked: an arm after `_`, a duplicate constructor arm, or a second `JsError`
arm is an error.

`Exn` cannot be inspected with an ordinary `match`. A closed union can prove
exhaustiveness; an open exception type cannot. Use `try`/`catch` as its elimination
form.

There is no `finally` form. `try`/`catch` handles recovery and propagation, not an
additional unconditional cleanup block.

## Foreign failures enter through `JsError`

JavaScript may throw an `Error`, a string, `null`, or any other value. Hexagon exposes
all foreign throwables through one prelude exception:

```hexagon
exception JsError(error: JsValue)
```

Catch it like another constructor:

```hexagon
try
    callForeignParser(input)
catch
    JsError(error) => handleForeignError(error)
```

The payload is an opaque `JsValue`; Hexagon does not pretend that arbitrary thrown
JavaScript values share a reliable structural type. Appropriate foreign-access
functions can inspect what a particular boundary promises.

If no `JsError` or wildcard arm matches, the original foreign value is rethrown with
its identity and stack intact. Directly rethrowing a caught foreign value preserves it
too:

```hexagon
JsError(error) =>
    if canRecover(error) then fallback else throw(JsError(error))
```

This wrapping is virtual in the common catch and rethrow paths; Hexagon need not
allocate another error merely to classify the foreign one.

## `Result.attempt` returns to the data world

When a program wants to capture any exceptional outcome as an explicit value,
`Result.attempt` has this type:

```text
Result.attempt : (() -> a) -> Result(a, Exn)
```

It runs a nullary function and returns `Ok(value)` on normal completion or `Err(error)`
when anything is thrown:

```hexagon
let loaded: Result(Configuration, Exn) =
    Result.attempt(() => readConfiguration(path))
```

This is an explicit bridge, not a coercion between `Exn` and `Result`. Once captured,
the caller handles the outcome with ordinary union pattern matching.

## Exceptions remain recognizable JavaScript errors

A Hexagon exception is a genuine JavaScript `Error` object extended with plain fields:

```js
Object.assign(new Error("unexpected token"), {
  $hex: true,
  name: "ParseError",
  line: 12
});
```

The `$hex` brand distinguishes Hexagon exceptions from foreign errors; `name` identifies
the constructor. There are no generated exception classes or `instanceof` chains.

Every mention of a nullary exception constructs a fresh `Error` so its stack points to
the useful site. This differs intentionally from allocation-free nullary union values:
exceptions are cold-path diagnostic objects, not ordinary data alternatives.

An exported exception has an equally direct TypeScript face:

```ts
type ParseError = Error & {
  $hex: true;
  name: "ParseError";
  line: number;
};
```

`Exn` itself appears as `Error` at the TypeScript boundary. Catch emission first checks
the brand, then the exception name, and automatically rethrows anything unmatched.

## Summary

- predictable failure belongs in `Result` or another closed union;
- independently declared exception constructors all produce the open type `Exn`;
- constructing an exception and throwing it are separate operations;
- `throw` never returns and can occupy any expected result position;
- `try`/`catch` is an expression using the established pattern language;
- unmatched exceptions are implicitly rethrown, while reachability is still checked;
- all foreign throwables enter through `JsError`;
- `Result.attempt` converts exceptional computation into explicit union data; and
- Hexagon exceptions are branded JavaScript `Error` values, not classes.

Together, local mutation, loops, lazy iteration, and exceptions cover sequential and
effectful computation without making effects ambient. Mutation stays inside a
function, iteration resolves statically, laziness is represented by immutable values,
and exceptional flow crosses one explicit open-error channel.
