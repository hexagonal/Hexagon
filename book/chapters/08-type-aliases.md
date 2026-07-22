# Type Aliases

The tuple chapter used `(Float, Float)` for coordinates. If that shape appears across a
module, a name can communicate its role:

```hexagon
type Coordinates = (Float, Float)
```

The alias can now appear wherever the tuple type could appear:

```hexagon
let origin: Coordinates = (0.0, 0.0)

let move(point: Coordinates, offset: Coordinates): Coordinates =
    let (x, y) = point
    let (dx, dy) = offset
    (x + dx, y + dy)
```

`Coordinates` gives the type a useful name. It does not create a new runtime value or a
new kind of tuple.

## An alias names an existing type

Type aliases are transparent. `Coordinates` and `(Float, Float)` are two spellings for
the same Hexagon type:

```hexagon
let coordinates: Coordinates = (3.0, 4.0)
let rawPair: (Float, Float) = coordinates
```

No conversion is required in either direction. Access, destructuring, inference, and
function calls behave exactly as they do for the expanded tuple.

This is useful for readability but not for separation. These declarations do not create
distinct identifiers:

```hexagon
type UserId = Int
type OrderId = Int

let userId: UserId = 42
let orderId: OrderId = userId // allowed: both are Int
```

If accidentally mixing `UserId` and `OrderId` must be rejected, an alias is the wrong
tool. Nominal records and unions will provide types whose identity is distinct even when
their runtime representation is simple.

## Aliases can have parameters

A parameterized alias names a family of related shapes:

```hexagon
type Entry(k, v) = (k, v)
```

Each use supplies both type arguments:

```hexagon
let score: Entry(String, Int) = ("Mira", 10)
let flag: Entry(Int, Bool) = (7, true)
```

Type parameters begin with lowercase letters. Concrete type names begin with uppercase
letters. Here `k` and `v` stand for types chosen at each use, while `String`, `Int`, and
`Bool` name particular types.

An alias is always fully applied. `Entry(String)` is not a type waiting for a later
argument; it is an error saying that `Entry` expects two type arguments. This mirrors
the language's function stance: the number of required arguments—its arity—remains
explicit.

Every declared alias parameter must appear in its body:

```hexagon
type Broken(a) = String // error: a is unused
```

An unused parameter suggests that the declaration says it varies when its actual shape
does not.

## Aliases cannot be recursive

An alias must eventually expand to an existing non-alias type shape. It cannot define
itself directly or through a cycle:

```hexagon
type Loop = Loop // error

type Left = Right
type Right = Left // error
```

Blindly expanding either example would never reach a type. Recursive data instead needs
a real constructor—normally a `union`—that gives each step a concrete shape. We will
meet that mechanism later.

The recursion ban does not prevent an alias from naming a type that is itself recursive.
It prevents aliases from trying to manufacture recursion through textual expansion.

## Declarations share a recognizable shape

`type` is one member of Hexagon's declaration family. Later chapters will introduce:

```hexagon
record Point = ...
union Shape = ...
constraint Displayable<a> = ...
exception ParseError(...)
```

Their meanings differ, but their headers follow related visual rules:

- the declared name begins with an uppercase letter;
- declarations with bodies place them after `=` and use ordinary layout when they span
  lines.

Aliases, records, and unions put optional type parameters in parentheses after the
name. Constraints introduce their subject in angle brackets, while exception
parentheses describe a constructor payload rather than type parameters; an exception
declaration needs no `=` body. The dedicated chapters will make each variation
concrete.

This shared shape makes a module's vocabulary easy to scan. It does not mean that every
declaration creates the same things: an alias is transparent, a record or union is
nominal, a constraint states an obligation, and an exception introduces a throwable
constructor.

Declarations of these types belong at module level. They do not appear midway through a
function body. Local executable work remains values, functions, expressions, and the
limited local bindings already introduced.

## Declaration order is not dependency order

Module-level type declarations may refer to declarations written later in the same
module:

```hexagon
type Start = Coordinates
type Coordinates = (Float, Float)
```

The compiler considers the module's declarations together rather than forcing a
top-to-bottom ordering ceremony. Recursive aliases remain illegal; order-insensitivity
does not change their expansion rule.

Two declarations cannot introduce the same type name in one module. The error is about
duplicate identity, not source order: moving one above the other does not choose a
winner.

## Aliases at the JavaScript boundary

Aliases have no JavaScript emission because JavaScript receives the underlying values:

```hexagon
export type Coordinates = (Float, Float)
export let origin: Coordinates = (0.0, 0.0)
```

```js
export const origin = [0.0, 0.0];
```

TypeScript declarations can preserve the useful public name:

```ts
export type Coordinates = [number, number];
export declare const origin: Coordinates;
```

Hexagon keeps aliases visible in types and diagnostics where that improves
understanding. Expansion wins when it must—for example, when a private alias appears in
a public signature and exposing the private name would make the declaration unusable.

## Summary

- a `type` alias gives an existing type shape a reusable name;
- aliases are transparent and create no new type identity;
- parameterized aliases must be fully applied and use every parameter;
- aliases cannot define recursive expansion cycles;
- type declarations live at module level and may refer forward within the module; and
- aliases erase from JavaScript while useful public names can remain in `.d.ts` files.

The distinction between a name and an identity is now explicit. Records and unions will
use declarations to create genuinely distinct types; aliases remain the lightweight
tool for naming a shape we already have.
