# Records

The tuple `("Mira", 3)` is convenient while both positions are obvious. As the data
grows, names become more valuable than brevity:

```hexagon
let reservation = {
  guest: "Mira",
  seats: 3,
  confirmed: false
}
```

This is a **record**: one value whose components are identified by field names. More
specifically, it is a **structural record**: its type comes from its fields rather than
from a declaration. Hexagon infers that type directly:

```text
{guest: String, seats: Int, confirmed: Bool}
```

Use a tuple when positions tell the story. Use a record when names do.

## Fields define the structure

A record literal uses `name: expression`; a record type uses `name: Type`:

```hexagon
let origin: {x: Float, y: Float} = {x: 0.0, y: 0.0}
```

Field order does not change the type. `{x: Float, y: Float}` and
`{y: Float, x: Float}` describe the same structure, although emitted JavaScript keeps
the literal's written order. A field name may appear only once in a literal or type.

The empty record is `{}` in both value and type position. This pays off the rule from
the Layout chapter: braces always mean records, never blocks.

Read a field with dot access:

```hexagon
let guest = reservation.guest
let seatCount = reservation.seats
```

The record type tells Hexagon that `guest` is `String` and `seatCount` is `Int`. Asking
for an absent field is a compile error that names the fields the record actually has.

## A function can require only the fields it uses

An unannotated function may infer a flexible record requirement:

```hexagon
let guestName(reservation) = reservation.guest

let first = guestName({guest: "Mira", seats: 3})
let second = guestName({guest: "Noah", confirmed: true})
```

Both calls work. `guestName` requires a record containing a `guest` field of one
consistent type; it does not care which additional fields travel beside it.

This is **row polymorphism**: the function is polymorphic over the record fields it
does not mention. In ordinary inferred code, the machinery stays invisible. The useful
reader-facing rule is simply:

> A function that only reads particular fields can accept records containing at least
> those fields.

This flexibility is specific to records. It is not a general subtyping relationship,
and it does not turn nominal types into structural ones.

## An annotation is closed unless it says otherwise

Write `...` when an annotation should permit additional fields:

```hexagon
let guestName(reservation: {guest: String, ...}): String =
  reservation.guest
```

Without `...`, the annotation is exact:

```hexagon
let exactGuest(reservation: {guest: String}): String =
  reservation.guest

exactGuest({guest: "Mira", seats: 3}) // error: extra field seats
```

The compiler can suggest `...` when the extra fields were probably intentional.

Very occasionally, two annotations must preserve the same unknown remainder. A named
tail expresses that relationship:

```hexagon
let renameGuest(
  reservation: {guest: String, ...r},
  guest: String
): {guest: String, ...r} =
  {...reservation, guest: guest}
```

The `r` means that every additional input field is also present in the result. Most
code lets inference discover this relationship and never writes a named tail.

## Updates create a new record

Records are immutable. A spread update makes a shallow copy and replaces selected
fields:

```hexagon
let confirmedReservation = {...reservation, confirmed: true}
```

Exactly one spread is permitted, and it must come first. Every overridden field must
already exist and keep its field type:

```hexagon
{...reservation, seats: 4}          // same record type
{...reservation, table: "window"} // error: update cannot add a field
```

This is deliberately an update operation, not unrestricted object merging. The result
has the same type as the input, and the source emits as the same readable JavaScript
spread.

`{...reservation}` with no overrides is also legal. For a structural record it is an
ordinary shallow copy; later in this chapter, the same spelling gains an additional
role for nominal records.

## Punning removes repeated names

When a field and its source binding share a name, the shorter form is available:

```hexagon
let guest = "Ari"
let seats = 2
let reservation = {guest, seats, confirmed: false}
```

Here `{guest, seats}` means `{guest: guest, seats: seats}`, matching JavaScript's
object shorthand exactly. The explicit form remains useful when the names differ.

A simple record pattern uses the same visual idea to bind fields:

```hexagon
let {guest, seats} = reservation
```

This binds the `guest` and `seats` fields and ignores the unmentioned `confirmed`
field. The pattern-matching chapter will extend this syntax with renaming, nesting,
literals, and guards.

## The boundary is an ordinary object

Structural records require no wrapper:

```hexagon
export let origin: {x: Float, y: Float} = {x: 0.0, y: 0.0}
```

```js
export const origin = {x: 0.0, y: 0.0};
```

```ts
export declare const origin: {x: number; y: number};
```

Field access and spread updates retain their JavaScript spellings. Static immutability
and inferred field requirements add guarantees without changing the runtime shape.

## A declaration gives a record identity

A structural record is identified by its fields. Sometimes a program needs a stronger
promise: two values should remain different even when their underlying fields happen
to look alike.

```hexagon
record UserId = {value: Int}
record OrderId = {value: Int}
```

`UserId` and `OrderId` are **nominal records**. Their types come from their
declarations—their names—not merely from their fields. They are therefore **nominal
types**: a function expecting `UserId` will reject an `OrderId`.

This is the crucial contrast:

- a structural record is identified by the fields it contains;
- a nominal record is identified by its `record` declaration.

A `type` alias can give a structural record another name, but it remains structural.
Use `type` for a better name; use `record` when the program needs a distinct type.

## A nominal record has a constructor

Construct a nominal record by calling its uppercase constructor with the exact
structural record it declares:

```hexagon
let userId = UserId({value: 42})
```

The constructor is an ordinary one-argument function. All declared fields are
required, extra fields are rejected, and its result has type `UserId` rather than
`{value: Int}`.

Once constructed, ordinary record operations remain available:

```hexagon
let rawValue = userId.value
let nextUserId = {...userId, value: userId.value + 1}
```

The update preserves nominal identity: `nextUserId` is still `UserId`. The compiler
checks `value` against the declaration, and the JavaScript remains a plain object
spread.

## Crossing back to structure is explicit

A nominal record does not silently become a structural record, even when it visibly
has the required fields:

```hexagon
record Point = {x: Float, y: Float}

let xCoordinate(point: {x: Float, ...}): Float = point.x
let point = Point({x: 3.0, y: 4.0})

xCoordinate(point)      // error: Point is nominal
xCoordinate({...point}) // accepted
```

The copy `{...point}` deliberately crosses from `Point` to its structural definition,
`{x: Float, y: Float}`. Nothing crosses implicitly, so inference never has to guess
whether a value should retain or discard its identity.

The direction into the nominal type is equally explicit: call `Point(...)`.

```text
structural record --Point(...)--> Point --{...point}--> structural record
```

## Nominal records can have type parameters

```hexagon
record Box(a) = {value: a}

let numberBox = Box({value: 42})
let wordBox = Box({value: "hello"})
```

The inferred types are `Box(Int)` and `Box(String)`. `Box(a)` remains nominal: it does
not unify with `{value: a}` or with another record declaration that happens to contain
the same field.

## An exported nominal record stays an ordinary object

An exported record exposes its type and constructor. Its JavaScript value is still the
object itself:

```hexagon
export record Point = {x: Float, y: Float}
```

```ts
export type Point = {x: number; y: number};
export declare function Point(value: {x: number; y: number}): Point;
```

TypeScript is structurally typed, so this ordinary boundary face cannot preserve
Hexagon's nominal distinction. Hexagon enforces the identity within Hexagon code while
keeping the external representation honest.

## Summary

- record fields give compound data useful names;
- a structural record's type is determined by its fields, regardless of field order;
- inferred field access can accept records with additional fields;
- row polymorphism is the name for flexibility over unmentioned fields;
- record annotations are closed unless they contain `...`;
- spread updates replace existing fields and produce a new record;
- `{field}` is shorthand for `{field: field}` in value and pattern positions;
- `record` creates a nominal type with an uppercase constructor;
- nominal-record updates preserve identity, while `{...value}` explicitly crosses to
  a structural record; and
- structural and nominal records are both plain JavaScript objects at runtime.

Records describe values that contain all their fields together. Unions, next, describe
values that can take one of several alternative shapes.
