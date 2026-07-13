# Tuples

Sometimes two values belong together without needing names for the parts. A guest and
the number of seats they requested can travel as one tuple:

```hexagon
let reservation = ("Mira", 3)
```

The tuple is one value containing two positions. Its inferred type records both:

```text
(String, Int)
```

Tuples are useful for small, local groupings: coordinates, a value paired with a count,
or several results returned from one function. When the positions need enduring domain
names, a record will usually communicate more clearly.

## Positions may have different types

A tuple fixes its number of positions and the type of each position:

```hexagon
let status = ("ready", true, 3)
```

This has type `(String, Bool, Int)`. The positions do not need a shared element type;
the tuple's type remembers each separately.

Two tuples have the same type when they have the same number of positions and matching
types in each position:

```hexagon
let first = ("Mira", 3)
let second = ("Noah", 2)
```

Both are `(String, Int)`. Reversing one to `(3, "Mira")` produces the distinct type
`(Int, String)`.

## Parentheses do not always make a tuple

A tuple has at least two positions:

```hexagon
(x, y)       // tuple
(x, y, z)    // tuple
(x)          // grouped expression: just x
()           // Unit
```

There is no one-element tuple. This keeps `(value)` as ordinary grouping, matching the
function and operator syntax already in use. The empty-looking case is not a tuple
either: `()` is the single value of `Unit`.

## Positional access is explicit

Tuple positions are available through `item1`, `item2`, and so on:

```hexagon
let reservation = ("Mira", 3)
let guest = reservation.item1
let seats = reservation.item2
```

The numbering is one-based, like Hexagon's sequence positions. The tuple type tells the
compiler that `guest` is `String` and `seats` is `Int`.

An access outside the tuple's arity is a compile error:

```hexagon
reservation.item3 // error: this tuple has 2 positions
```

For a quick access, `itemN` is direct. When several positions are needed, destructuring
usually reads better.

## Destructuring binds the positions

A tuple pattern on the left of `let` gives several positions names at once:

```hexagon
let (guest, seats) = reservation
print("${guest} requested ${seats} seats")
```

The pattern must have the same arity as the tuple. These names are ordinary sequential
`let` bindings, so the earlier no-rebinding rule applies to each one.

Use `_` for a position that is intentionally irrelevant:

```hexagon
let (guest, _) = reservation
```

Unlike `ignore`, `_` prevents a name from being introduced at all. `ignore(expression)`
evaluates a value-producing expression for its effect and discards the result; `_` is a
pattern position saying “do not bind this component.”

## Functions can return several results

A function still returns one value, but that value may be a tuple:

```hexagon
let minMax(first: Int, second: Int): (Int, Int) =
  if first <= second then (first, second) else (second, first)

let (smallest, largest) = minMax(8, 3)
```

The caller receives one two-position result and destructures it. This is useful when
the results are naturally consumed together and their meaning is obvious near the call.
If callers repeatedly need to remember which string is which, a record with named fields
will be safer.

Tuples can also carry intermediate state without mutation:

```hexagon
let nextPosition(x: Int, y: Int): (Int, Int) =
  (x + 1, y + 1)
```

## One tuple is not several arguments

The difference between one compound value and several arguments becomes important at
a function call:

```hexagon
let move(x: Float, y: Float): String = "Move to ${x}, ${y}"
let coordinates = (3.0, 4.0)

move(3.0, 4.0)       // two arguments
move(coordinates)     // one tuple argument: arity error
```

`move` declares two parameters, so every call supplies two arguments. A tuple containing
two positions remains one value; Hexagon does not silently unpack it into an argument
list.

Destructure explicitly when that is the intended crossing:

```hexagon
let (x, y) = coordinates
move(x, y)
```

Or define a function that deliberately accepts one tuple parameter:

```hexagon
let movePoint(point: (Float, Float)): String =
  let (x, y) = point
  "Move to ${x}, ${y}"

movePoint(coordinates)
```

The two interfaces are visibly different, and their arity is checked before the
program runs.

## The boundary representation is ordinary

A Hexagon tuple is represented by a JavaScript array:

```hexagon
export let origin: (Float, Float) = (0.0, 0.0)
```

```js
export const origin = [0.0, 0.0];
```

```ts
export declare const origin: [number, number];
```

Positional access remains readable after its one-based Hexagon spelling is translated:

```hexagon
origin.item2
```

```js
origin[1]
```

The array is a runtime representation, not permission to resize or mutate the tuple in
Hexagon. Its arity and position types remain fixed statically.

## Summary

- a tuple is one immutable value with two or more typed positions;
- positions may have different types;
- `(x)` is grouping and `()` is `Unit`, not a tuple;
- `itemN` accesses positions with one-based spelling;
- tuple patterns bind several positions and `_` skips one;
- returning a tuple is returning one compound value; and
- a tuple argument is not automatically unpacked into several function arguments.

Tuples give us positional structure. The next chapter gives useful type names to shapes
like these; records will later provide the named-field alternative.
