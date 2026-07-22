# Dot Calls

Hexagon's subject-first convention makes a useful transformation easy to recognize:

```hexagon
Option.getOrElse(possibleName, "Guest")
```

When the receiver's type is known, the same operation has a **dot call**:

```hexagon
possibleName.getOrElse("Guest")
```

These are the same call. Hexagon rewrites the second form to the first during type
checking. The value does not acquire a JavaScript method, and no runtime lookup occurs.

## Three spellings emphasize different things

A subject-first companion operation commonly has three useful spellings:

```hexagon
Option.getOrElse(possibleName, "Guest")
possibleName |> Option.getOrElse("Guest")
possibleName.getOrElse("Guest")
```

All three mean `Option.getOrElse(possibleName, "Guest")`.

- The qualified form is explicit and canonical.
- The pipe emphasizes a value flowing through transformations.
- The dot form emphasizes an operation belonging with the receiver's type and supports
  familiar editor completion.

No single spelling must replace the others. A chain of transformations often reads
best as a pipe; several operations from one companion often read naturally with dots;
the qualified form is always available when maximum clarity matters.

When a dot chain spans several lines, align each leading dot with the receiver:

```hexagon
let selected =
    numbers
    .filter(number => number > 3)
    .map(number => number * 10)
    .take(5)
```

The leading dots continue the postfix expression. This alignment puts the receiver and
each operation on the same visual axis, matching the established layout for a multiline
pipe.

## Companion operations belong with a type

The Modules chapter established every nominal type's **home module** and its
**companion module** of exported operations. A function from that companion is
available after the dot when its first parameter is headed by the type.

Suppose the module declaring `Parcel` also exports:

```hexagon
record Parcel = {tracking: String, delivered: Bool}

export let status(parcel: Parcel): String =
    if parcel.delivered then "delivered" else "in transit"
```

For a `Parcel` value, these calls are equivalent:

```hexagon
Parcel.status(parcel)
parcel.status()
```

The function is **subject-first**, so the subject moves to the left of the dot and the
remaining arguments stay inside the call. A function such as `Parcel.new(tracking)`,
whose first parameter is not a `Parcel`, is not a companion operation and must remain
qualified.

The rule is based on the receiver's type, not on which unqualified names happen to be
imported. Imports cannot introduce competing method candidates. There is one companion
module and therefore one operation set to consult.

Primitive and prelude types follow the same idea through their fixed companions:
`String`, `Option`, `Result`, and later `Vector` and `Map` are not special runtime
objects. Their dot calls are still rewrites to ordinary functions.

A transparent type alias creates no new type or companion module. It uses the
companion of the type it expands to, just as it uses that type's operations elsewhere.

## A bare dot is still field access

The argument list is significant:

```hexagon
parcel.status       // field access, if Parcel has a field named status
parcel.status()     // dot call, when status is a companion operation
```

`value.name` without an immediate argument list never creates a bound method. It is
ordinary field access, just as it was in the records chapter. Hexagon does not silently
allocate a closure that remembers `value`.

If a record contains a callable field, calling the field remains possible:

```hexagon
(job.run)()
```

The parentheses explicitly make this field access followed by an ordinary call. They
also provide the field-side spelling when a name collision occurs.

Structural records have no companion module. For them, `value.callback(3)` simply
calls the `callback` field. Tuples likewise keep their existing `itemN` access and do
not gain companion operations.

## Collisions are resolved explicitly

A nominal record can have a field and a companion operation with the same name:

```hexagon
record Box = {size: Int}

export let size(box: Box): Int = box.size
```

The fused call is deliberately rejected:

```hexagon
box.size() // error: size could mean the field or Box.size
```

There is no silent “fields win” or “operations win” rule. Write the intended meaning:

```hexagon
box.size          // access the Int field
Box.size(box)     // call the companion operation
```

If the field itself were callable, `(box.size)()` would call it. The compiler suggests
that form only when it is actually valid.

The ambiguity is based on the name, not on whether the field happens to be callable.
Changing a field's type must not silently change which operation a program invokes.

## The receiver type must be known independently

A member name does not tell Hexagon which nominal type you intended:

```hexagon
let statusOf(value) = value.status()
```

With no other type information, this remains the long-established structural-record
meaning:
`value` must contain a callable field named `status`. Hexagon does not search every
companion module for a function with that name and guess `Parcel`.

Annotate the receiver when companion dispatch is the intention:

```hexagon
let statusOf(value: Parcel) = value.status()
```

Type information elsewhere in the same function may also establish the nominal type.
The important reader rule is:

> A dot call selects a companion operation only when the receiver's type is known
> independently. Otherwise it is a callable record-field requirement.

This preserves principal inference and ordinary row-polymorphic code. It also explains
a diagnostic that might otherwise be surprising: a generic function inferred from
`value.status()` cannot later accept a `Parcel`, because a nominal record does not
silently become the structural record that function requested. Add the annotation or
write `Parcel.status(value)` inside the function.

## Constraint members use direct calls

Constraint members are deliberately separate from companion operations:

```hexagon
let display<a: Show>(value: a): String = show(value)
```

Do not write `value.show()`. An abstract type variable does not identify one companion
module, and dot syntax does not search instances. Call `show(value)` directly or pipe
to the bare constrained function when it reads well:

```hexagon
value |> show
```

A concrete type could have an ordinary companion function also named `show`, but that
would be a separate monomorphic operation—not constraint dispatch in disguise.

## Dot calls disappear before JavaScript

The resolved dot-call node does not survive into emitted code:

```hexagon
let name = possibleName.getOrElse("Guest")
```

may emit as the ordinary imported function call:

```js
const name = getOrElse(possibleName, "Guest");
```

Field calls remain honest JavaScript property calls. No prototypes are changed, no
`this` value is introduced, and Hexagon values carry no method table.

There is likewise nothing method-shaped to add to `.d.ts` files. The emitted functions
retain their ordinary function signatures; records and unions retain their established
representations.

The editor can still offer method-like completion. After a receiver of known type, it
can combine visible fields with exported subject-first companion operations and label
which is which. This discoverability is a source-language service built on static type
information, not a sign of runtime objects.

## Summary

- `value.operation(args)` rewrites to a subject-first companion call;
- qualified, pipe, and dot spellings express the same underlying function call;
- only exported functions headed by the companion type are dot-callable;
- a bare `value.name` is always field access, never a bound method;
- structural records have callable fields but no companion operations;
- field/operation name collisions are errors with explicit alternative spellings;
- a companion receiver type must be known independently of the member name;
- constraint members such as `show` remain direct calls; and
- dot calls add no runtime methods, `this`, prototypes, or TypeScript methods.

Together, constraints, derivation, modules, and dot calls form Hexagon's capability
model: generic code asks for behavior, data types acquire standard behavior, ordinary
operations receive predictable homes, and subject-first functions remain convenient
to discover and call.
