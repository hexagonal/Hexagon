# Unions

A delivery cannot be simultaneously pending, dispatched, and delivered. It is exactly
one of those alternatives:

```hexagon
union DeliveryStatus =
  | Pending
  | Dispatched(tracking: String)
  | Delivered
```

A **union** declares one nominal type with a closed set of possible shapes. Each
alternative begins with an uppercase **constructor**. Because the set is known, the
compiler can later prove that every possibility has been handled.

This is sometimes called a sum type or discriminated union elsewhere. In Hexagon,
**union** is the source-language term.

## Constructors make union values

`Pending` and `Delivered` carry no data. They are values and are written without empty
parentheses:

```hexagon
let queued: DeliveryStatus = Pending
let finished: DeliveryStatus = Delivered
```

`Dispatched` carries a payload, so it is an ordinary function-like constructor:

```hexagon
let travelling: DeliveryStatus = Dispatched("HX-2048")
```

Its declared slot name `tracking` documents the data and becomes the readable
JavaScript field name. Construction remains positional: there is no named-argument
call syntax.

Payload constructors follow the same rules as functions. Parentheses are required,
arity is checked, and constructors may be passed as values. Nullary constructors are
different: `Pending()` is an error because `Pending` is already a value.

A constructor may have several named or several unnamed slots, but it cannot mix the
two styles in one payload:

```hexagon
union Shape =
  | Circle(radius: Float)
  | Rectangle(width: Float, height: Float)
  | Point
```

The name `tag` is reserved inside union payloads because emitted JavaScript uses it to
identify the constructor.

## `match` handles every alternative

Union values expose no common payload fields. Even though emitted JavaScript contains
a `tag`, Hexagon code does not inspect `.tag` or `.tracking` directly. A `match`
expression handles the alternatives:

```hexagon
let displayStatus(status: DeliveryStatus): String =
  match status
    Pending => "Waiting to leave"
    Dispatched(code) => "In transit: ${code}"
    Delivered => "Delivered"
```

Constructor patterns are positional, so `Dispatched(code)` binds the payload to the
local name `code`. `_` may ignore a payload:

```hexagon
Dispatched(_) => "In transit"
```

`match` is an expression. Every arm produces one compatible result type, and the
scrutinee is evaluated exactly once.

Every constructor must be covered. Leaving out `Delivered` is a compile error, not a
warning. A wildcard arm `_` can deliberately cover everything not listed, although
spelling out the constructors usually lets the compiler protect the program when the
union later grows.

An arm that can never be reached is also an error. For example, nothing may follow `_`
because the wildcard already matches every value. The next chapter develops this
exhaustiveness and reachability model across the full pattern language.

## Unions can be parameterized and recursive

Type parameters let one family of alternatives carry many types:

```hexagon
union LoadState(a) =
  | Loading
  | Loaded(value: a)
  | Failed(message: String)
```

`Loaded(42)` has type `LoadState(Int)`; `Loaded("ready")` has type
`LoadState(String)`.

Unlike aliases, unions may be recursive because the nominal constructor provides a
real step in the data:

```hexagon
union IntTree =
  | Leaf
  | Node(left: IntTree, value: Int, right: IntTree)
```

Each `Node` contains smaller tree values. A later recursive function can inspect them
with `match` until it reaches `Leaf`.

## `Option` represents possible absence

Hexagon's prelude declares:

```hexagon
union Option(a) = Some(value: a) | None
```

Use `Some(value)` when a value exists and `None` when it does not:

```hexagon
let findGuest(id: Int): Option(String) =
  if id == 42 then Some("Mira") else None
```

The caller must handle both cases:

```hexagon
let greeting =
  match findGuest(42)
    Some(name) => "Hello, ${name}!"
    None => "Guest not found"
```

`Option(a)` is not secretly `a | undefined`. Its constructors remain distinct even
when `a` is itself an `Option`, so `Some(None)` and `None` cannot collapse into the same
runtime value. JavaScript nullability is a boundary concern with explicit conversions,
not the representation of ordinary Hexagon absence.

## `Result` represents success or recoverable failure

The second standard union is:

```hexagon
union Result(a, e) = Ok(value: a) | Err(error: e)
```

The first type parameter is the success value and the second is the error value:

```hexagon
let validatePort(port: Int): Result(Int, String) =
  if 1 <= port <= 65535
    Ok(port)
  else
    Err("port must be between 1 and 65535")
```

A result makes failure part of the function's ordinary return type. The caller chooses
how to recover:

```hexagon
let message =
  match validatePort(8080)
    Ok(port) => "Listening on ${port}"
    Err(problem) => "Invalid port: ${problem}"
```

Exceptions remain available for exceptional control flow, but `Result` is the common
fit when failure is expected and the caller should decide what it means.

## The JavaScript representation stays readable

When any constructor carries data, every value of that union is a tagged plain object:

```hexagon
Dispatched("HX-2048")
```

```js
{tag: "Dispatched", tracking: "HX-2048"}
```

An exported union produces the discriminated TypeScript union a TS author would
normally write:

```ts
export type DeliveryStatus =
  | {tag: "Pending"}
  | {tag: "Dispatched"; tracking: string}
  | {tag: "Delivered"};
```

Payload constructors cross as functions; nullary constructors in a mixed union cross
as shared values.

If every constructor is nullary, Hexagon uses an even smaller representation:

```hexagon
export union Direction = North | East | South | West
```

```ts
export type Direction = "North" | "East" | "South" | "West";
```

At runtime, `North` is simply the string `"North"`. Adding a payload constructor later
changes the entire union to tagged objects, so that change is a JavaScript-boundary
breaking change even though Hexagon matches continue to use the same source model.

## Summary

- a union is one nominal type with a closed set of constructors;
- nullary constructors are values, while payload constructors behave like functions;
- construction and constructor patterns are positional;
- `match` is an expression and is the only way to inspect a union value;
- missing and unreachable arms are compile errors;
- unions may have type parameters and recursive payloads;
- `Option(a)` represents a value that may be absent;
- `Result(a, e)` represents success or recoverable failure; and
- unions emit as readable tagged objects, or strings when every constructor is nullary.

The basic constructor patterns above are only the beginning. The next chapter combines
constructors, tuples, records, literals, alternatives, whole-value bindings, and guards
into one pattern language.
