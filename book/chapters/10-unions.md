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
    if 1 <= port <= 65535 then
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

## `Bool` represents truth or falsity

The third standard union is the one you have been using since Chapter 2:

```hexagon
union Bool derives (Eq, Ord, Show, Hash) = False | True
```

Everything this chapter has said applies to it without an asterisk. `True` and `False`
are nullary constructors, so they are values and are used bare. A `match` over both is
exhaustive, and a `match` over one of them is the ordinary missing-case error:

```hexagon
let label(flag: Bool): String =
    match flag
        True => "on"
        False => "off"
```

`Bool` derives its four capabilities the way any union declaration derives them, and the
constructor order in the declaration is what makes `False < True` when it is compared.
Displaying one gives its constructor name: `show(True)` is `"True"`, and `"${flag}"`
renders `True` or `False`.

There is exactly one thing the compiler does for `Bool` that it will not do for a union
you write. A `Bool` value is a JavaScript `boolean` — `True` emits `true`, `False` emits
`false`, and an exported signature mentioning `Bool` says `boolean` in the generated
declarations. That is a promise about representation, not about meaning, and it is not
observable from inside Hexagon: every way of consuming a `Bool` — `match`, `and`, `or`,
`not`, `implies`, `iff`, and the condition of an `if` or a `while` — behaves the same
either way. The promise exists so that the language's most common type costs nothing at
the JavaScript boundary, which is precisely the kind of JavaScript-specific fact that
earns a JavaScript-specific answer.

The precedent is OCaml, where `bool` is likewise an ordinary declared variant that the
compiler happens to represent immediately. Hexagon is an ML dialect, and this is what
being one looks like in the small: a type that most languages targeting JavaScript would
build in, described instead by the machinery the language already has.

## The JavaScript representation stays readable

When any constructor carries data, every value of that union is a tagged plain object:

```hexagon
Dispatched("HX-2048")
```

```js
{tag: "Dispatched", tracking: "HX-2048"}
```

An exported union produces the discriminated TypeScript union a TypeScript consumer can
read and narrow without help:

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

`Bool` is the single exception to that rule, and the previous section explains why: its
representation is pinned to the JavaScript `boolean` rather than to the strings
`"True"`/`"False"`. No declaration you write can ask for such a pin, and `Bool` cannot
gain a third constructor, so the breaking change described above cannot reach it.

## Summary

- a union is one nominal type with a closed set of constructors;
- nullary constructors are values, while payload constructors behave like functions;
- construction and constructor patterns are positional;
- `match` is an expression and is the only way to inspect a union value;
- missing and unreachable arms are compile errors;
- unions may have type parameters and recursive payloads;
- `Option(a)` represents a value that may be absent;
- `Result(a, e)` represents success or recoverable failure;
- `Bool` is the prelude union `False | True`, ordinary in every respect except that its
  representation is pinned to the JavaScript `boolean`; and
- unions emit as readable tagged objects, or strings when every constructor is nullary.

The basic constructor patterns above are only the beginning. The next chapter combines
constructors, tuples, records, literals, alternatives, whole-value bindings, and guards
into one pattern language.
