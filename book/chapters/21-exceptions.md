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

Notice what the marks from Chapter 19 are *not* doing here. `requireName` is pure, and
the `throw` inside it costs nothing: throwing is not an effect. The effect discipline
tracks observable interaction with the world, and an exception is failure, not
interaction, so the two channels stay separate — a pure function may throw, and a pure
function may catch. `Int.div` divides or throws `DivideByZeroError` and is pure either
way. Purity promises that a call cannot touch the world; it has never promised that
the call must succeed.

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
        readConfiguration!(path)
    catch
        ParseError(line, message) =>
            log("Line ${line}: ${message}")
            defaultConfiguration
        NotFound => defaultConfiguration
```

The `try` body and every catch-arm body must produce the same type. Here successful
loading and both recovery paths produce `Configuration`. The `!` belongs to the file
read, not to the possibility of `ParseError`: failing is free, touching the disk is
not.

Catch arms are tried from top to bottom. Constructor, tuple, record, literal, or-, and
as-patterns may nest, and guards work as they do in `match`. Pattern binders are local
to their arm and may use familiar short names.

A catch arm may also name its constructor through a module, exactly as `match`
patterns can. The standard library's exceptions read naturally this way:

```hexagon
let scoreAt(scores: Vector(Int), index: Int): Int =
    try
        Vector.at(scores, index)
    catch
        Vector.IndexError(requested, size) =>
            log("asked for ${requested} of ${size}")
            0
```

The same spelling catches an imported module's exceptions — `Geo.ParseError(line,
message)` under a module alias — and it remains available when your own module
declares an exception of the same name, so the standard library's is never out of
reach.

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

There is no `finally`, by design. The cleanup problem `finally` was invented for is
really paired acquire-and-release, and that job belongs to a dedicated scoped-resource
construct — a future `use` binding — rather than to a bare cleanup block bolted onto
`try`. The emitter keeps JavaScript's own `try`/`finally` for such internal lowering,
so the surface language never needs the keyword.

## A `match` can catch what its scrutinee throws

The two constructs compose. A `match` written at the start of its own line may take a
`catch` clause, aligned with the `match` keyword, after the arms:

```hexagon
let compile(input: String): Output =
    match parse(input)
        Ok(ast) => generate(ast)
        Err(reason) => report(reason)
    catch
        ParseError(line, message) => reportAt(line, message)
```

The clause is a `catch` in every respect the previous sections described: the full
pattern language, guards, `JsError`, implicit rethrow of anything unmatched,
reachability still checked. Nothing about writing catch arms changes because they are
sitting under a `match` instead of a `try`.

What changes is *what they protect*. **A `catch` on a `match` guards the scrutinee, not
your arms — and that is the point.** `parse(input)` is inside the protected region.
`generate(ast)`, `report(reason)`, and any guard you attach to a data arm are outside
it. If `parse` returns, the data arms run exactly as an ordinary `match`'s do and the
catch arms are dead for that evaluation. If `parse` throws, the data arms never run and
the catch arms are tried instead.

That is a different expression from the one you get by wrapping the whole `match`:

```hexagon
-- The window is the scrutinee: a ParseError from `generate` escapes.
let narrow(input: String): Output =
    match parse(input)
        Ok(ast) => generate(ast)
        Err(reason) => report(reason)
    catch
        ParseError(line, message) => reportAt(line, message)

-- The window is everything: a ParseError from `generate` is caught here.
let wide(input: String): Output =
    try match parse(input)
        Ok(ast) => generate(ast)
        Err(reason) => report(reason)
    catch
        ParseError(line, message) => reportAt(line, message)
```

Both compile, and they read almost the same. In `narrow`, a `ParseError` raised inside
`generate` propagates to the caller — the handler was for parsing, and it stays for
parsing. In `wide`, that same failure is quietly rerouted into a message about a parse
error at some line, which is the bug the narrow form exists to make unwritable. Reach
for the clause when the handler belongs to the thing being matched; reach for
`try`/`catch` when it belongs to the whole computation.

The two sections keep their own laws. Every body — data arm and catch arm alike —
produces the one result type, as in any `match`. The data arms alone must be exhaustive:
a thrown exception is not a case of the scrutinee's type, so the clause discharges
nothing, and dropping `Err(reason)` above is still a missing-case error. The catch arms,
being arms over the open `Exn`, carry no exhaustiveness demand at all.

Only a `match` that *begins its line* can take a clause, because attachment is by
column and a mid-line head has no column a following line could sit at. So this does not
work:

```hexagon
let x = match parse(input)
    Ok(ast) => generate(ast)
    Err(reason) => report(reason)
catch                                  -- ERROR: aligned with the `let`, not the `match`
    ParseError(line, message) => reportAt(line, message)
```

The `catch` is at the `let`'s column, and the `let` is what owns that column. The fix is
one indent — move the `match` onto its own line as the binding's block, and the clause
has a head to align with:

```hexagon
let x =
    match parse(input)
        Ok(ast) => generate(ast)
        Err(reason) => report(reason)
    catch
        ParseError(line, message) => reportAt(line, message)
```

One more error is worth expecting. A clause whose scrutinee cannot possibly throw is
dead code, and dead handlers are errors here exactly as dead arms are:

```hexagon
match result                           -- ERROR: this `catch` can never run:
    Ok(ast) => generate(ast)           -- evaluating result cannot throw
    Err(reason) => report(reason)
catch
    ParseError(_, _) => fallback
```

Reading a variable throws nothing, so nothing could reach those arms. The compiler only
claims this where it is certain — a bare variable or a plain literal. It never tries to
prove that a *call* cannot throw, because nothing in the language would let it: throwing
is not an effect, and a pure function may throw.

## Foreign failures enter through `JsError`

JavaScript may throw an `Error`, a string, `null`, or any other value. Hexagon exposes
all foreign throwables through one prelude exception:

```hexagon
exception JsError(error: JsValue)
```

Catch it like another constructor:

```hexagon
try
    callForeignParser!(input)
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
Result.attempt : (() ->? a) ->? Result(a, Exn)
```

It runs a nullary function and returns `Ok(value)` on normal completion or `Err(error)`
when anything is thrown — Hexagon or foreign; a foreign throwable arrives as
`Err(JsError(…))`:

```hexagon
let loaded: Result(Configuration, Exn) =
    Result.attempt!(() => readConfiguration!(path))
```

Both `->?` are the same variable, as always: `attempt` is a conduit, exactly as
effectful as the thunk it is handed. Reading configuration touches the disk, so the
thunk's body wears `!` and the `attempt` call does too; hand it a pure thunk and the
whole call is pure and bare. A pure-only face would refuse exactly the
boundary-wrapping calls this function exists for.

This is an explicit bridge, not a coercion between `Exn` and `Result`. Once captured,
the caller handles the outcome with ordinary union pattern matching.

## Exceptions remain recognizable JavaScript errors

A Hexagon exception is a genuine JavaScript `Error` object extended with plain fields:

```js
Object.assign(new Error("unexpected token"), {
  $hex: "parser",
  name: "ParseError",
  line: 12
});
```

The `$hex` brand distinguishes Hexagon exceptions from foreign errors, and it says *whose*
they are: its value is the declaring module's identity — the project-root-relative path
with the extension dropped, so `parser.hex` brands `"parser"` and `client/errors.hex`
brands `"client/errors"`. `name` identifies the constructor. Identity is therefore the
pair, which is why two modules that each declare `exception Boom` declare two different
exceptions and a catch arm for one never catches the other. There are no generated
exception classes or `instanceof` chains.

Every mention of a nullary exception constructs a fresh `Error` so its stack points to
the useful site. This differs intentionally from allocation-free nullary union values:
exceptions are cold-path diagnostic objects, not ordinary data alternatives.

An exported exception has an equally direct TypeScript face:

```ts
type ParseError = Error & {
  readonly $hex: "parser";
  readonly name: "ParseError";
  readonly line: number;
};
```

Catch emission first checks the brand, then the exception name, and automatically rethrows
anything unmatched.

A JavaScript consumer gets that discrimination ready-made rather than hand-written. Every
exported exception constructor carries a guard, and a module exporting one also exports a
general guard for the first question a `catch` asks:

```ts
export declare function ParseError(line: number, message: string): ParseError;
export declare namespace ParseError {
  function is(err: unknown): err is ParseError;
}
export declare function isHexError(
  err: unknown,
): err is Error & { readonly $hex: string; readonly name: string };
```

Both are TypeScript type predicates, so a branch narrows an `unknown` catch binding to the
published face. Neither exists on the Hexagon side: the domestic eliminator is `catch`.

Documentation crosses the boundary in the same spirit. One documentation-comment
sentence is recognized — ``Throws `ParseError` when the input is malformed.`` — and an
exported declaration carrying it gains a matching `@throws` tag in its emitted JSDoc,
so a TypeScript consumer's hover lists what a call may throw. This is documentation,
not typing: nothing verifies the claim, but the sentence and its tag travel with the
declaration.

## Summary

- predictable failure belongs in `Result` or another closed union;
- independently declared exception constructors all produce the open type `Exn`;
- constructing an exception and throwing it are separate operations;
- throwing is not an effect: a pure function may throw, and a pure function may catch;
- `throw` never returns and can occupy any expected result position;
- `try`/`catch` is an expression using the established pattern language, and a catch
  arm may name its constructor through a module;
- a line-initial `match` may take a `catch` clause of its own, guarding the scrutinee's
  evaluation and nothing else;
- unmatched exceptions are implicitly rethrown, while reachability is still checked;
- there is no `finally`; paired acquire-and-release is a future `use` binding's job;
- all foreign throwables enter through `JsError`;
- `Result.attempt` converts exceptional computation into explicit union data and is
  exactly as effectful as the thunk it runs; and
- Hexagon exceptions are branded JavaScript `Error` values, not classes.

Together, local mutation, loops, lazy iteration, and exceptions cover sequential and
effectful computation without making effects ambient. Mutation stays inside a
function, iteration resolves statically, laziness is represented by immutable values,
and exceptional flow crosses one explicit open-error channel.
