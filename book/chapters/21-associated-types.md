# Associated Types

The Collections chapter ended with one deliberately underexplained line:

```hexagon
honor<a> Iterable<Bag(a)> =
  type Item = a
  iterate(bag) = Vector.toSeq(bag.items)
```

`iterate` is an ordinary constraint operation. `type Item = a` answers a different
kind of question: *what type does this collection produce when it is iterated?*

The `Iterable` constraint asks that question by declaring a type of its own:

```hexagon
constraint Iterable<c> =
  type Item
  iterate(xs: c): Seq(Item)
```

`Item` is an **associated type**: a type member declared by a constraint and chosen by
each instance of that constraint.

## The instance chooses the type

A normal type parameter is chosen at a use of a generic declaration. In this function,
each caller may choose `a`:

```hexagon
let identity<a>(value: a): a = value
```

An associated type works in the opposite direction. Once the program has chosen the
`Iterable<Vector(String)>` instance, that instance determines its one `Item` type:
`String`. The caller does not make a second independent choice.

The standard instances follow this pattern:

| Iterable type | Its `Item` |
| --- | --- |
| `Range` | `Int` |
| `Vector(a)` | `a` |
| `Seq(a)` | `a` |
| `Map(k, v)` | `(k, v)` |
| `Set(a)` | `a` |
| `String` | `String`—one codepoint at a time |

This is why a map loop receives tuples without another annotation:

```hexagon
for (key, value) in scores
  print("${key}: ${value}")
```

The compiler finds `Iterable<Map(String, Int)>`, whose `Item` is `(String, Int)`, and
checks the tuple pattern against that type.

## A constraint declares a type member

Inside a constraint body, an associated type is introduced by `type` and an
uppercase-start name:

```hexagon
constraint Iterable<c> =
  type Item
  iterate(xs: c): Seq(Item)
```

There is no `=` on the declaration line because the constraint does not choose the
answer. `Item` is available throughout that constraint body, so operation signatures
may use it. Declaring type members before the operations that mention them is the
clearest style, though their scope does not depend on textual order.

A constraint may declare more than one associated type. The grammar is general rather
than tailored to iteration:

```hexagon
constraint Conversion<c> =
  type Input
  type Output
  convert(conversion: c, value: Input): Output
```

This constraint describes a conversion object whose source and result types are fixed
by its instance. Neither type is independently selected on each call to `convert`.

## An instance binds every associated type

An `honor` body supplies the type with the same `type` keyword followed by `=`:

```hexagon
record ParsePort = {fallback: Int}

honor Conversion<ParsePort> =
  type Input = String
  type Output = Result(Int, String)

  convert(parser, text) =
    parsePort(text, parser.fallback)
```

For this instance, `convert` has the effective type:

```text
(ParsePort, String) -> Result(Int, String)
```

The type bindings are part of the instance's answer. Every associated type declared by
the constraint must be bound exactly once. Leaving out `Output`, binding `Input` twice,
or adding an undeclared `Error` type is a compile error that names the offending member.

An instance binding may use its own type parameters:

```hexagon
honor<a> Iterable<Bag(a)> =
  type Item = a
  iterate(bag) = Vector.toSeq(bag.items)
```

Within the `honor` body, `Item` means the chosen type `a`. Optional annotations on its
operations may use that name:

```hexagon
honor<a> Iterable<Bag(a)> =
  type Item = a
  iterate(bag: Bag(a)): Seq(Item) = Vector.toSeq(bag.items)
```

The shorter inferred annotations are normally easier to read, but the explicit form
shows that type members and operation checking agree.

## Associated names belong to their constraints

The full identity of an associated type is its owner constraint together with its
member name. `Iterable.Item` and `Source.Item` are different associated types.

Consequently, two constraints in one module may both declare `Item`:

```hexagon
constraint Source<s> =
  type Item
  read(source: s): Option((Item, s))

constraint Sink<s> =
  type Item
  write(sink: s, value: Item): s
```

There is no collision. Bare `Item` means `Source`'s member inside the `Source` body and
its instances; it means `Sink`'s member inside the `Sink` body and its instances.
Outside those places, neither bare name is in scope.

An associated type also claims no module-level type name. A module may declare an
ordinary `type Item = ...` without colliding with a constraint's member. The local
constraint context makes the intended owner unambiguous.

Duplicate type members *within one constraint* remain an error, just like duplicate
operation members.

## Coherence fixes the choice program-wide

An associated type does not create a second instance system. It belongs to the same
`honor` declaration as the constraint's operations:

```text
one constraint + one type constructor = one instance answer
```

If the program has one lawful `Iterable<Bag(a)>` instance, it also has one answer for
`Bag(a)`'s `Item`. Another module cannot provide a competing item type without already
violating the ordinary coherence rule.

The orphan rule is unchanged. An instance must live with either its constraint or the
type it honors. A `Bag` library naturally places its `Iterable<Bag(a)>` instance in
`Bag`'s home module, beside `Bag.toSeq`.

Opacity also changes nothing. The home module can honor `Iterable` for an opaque
collection because it can see the hidden representation. Consumers cannot see the
fields, but they can iterate the value through the globally coherent instance.

## Associated types are not general type projections

Hexagon deliberately supports the useful concrete form without allowing arbitrary
associated-type expressions elsewhere. `Item` may appear in its owning constraint body
and `honor` bodies, but source code cannot write an external type such as:

```hexagon
Item(Bag(Int))
Iterable.Item(Bag(Int))
```

Nor can an unknown type variable be constrained by a constraint that declares an
associated type:

```hexagon
let collect<c: Iterable>(source: c) = ... // error
```

If `c` is still unknown, determining and carrying its `Item` would require a more
powerful form of type-level projection. Hexagon keeps that machinery out of inference.
The diagnostic points reusable iteration code toward the concrete currency already
established:

```hexagon
let collect<a>(source: Seq(a)): Vector(a) = Vector.fromSeq(source)
```

Callers convert at the boundary:

```hexagon
collect(Bag.toSeq(bag))
collect(Map.toSeq(scores))
```

Associated types therefore remain an advanced extension of instances rather than a
requirement for ordinary generic code. They add a useful fixed relationship without
turning type inference into open-ended type-level computation.

## Concrete use remains straightforward

The restriction does not prevent the operations that motivated the feature:

- a user may declare a constraint with one or more associated types;
- an instance at a known type may bind them;
- code may call the constraint's operations when the subject type is concrete; and
- `for` may use the statically known `Iterable` instance for its source.

```hexagon
let next = iterate(bag)              // Seq(Int), when bag: Bag(Int)
let converted = convert(parser, "8080")
```

In each case, the outer subject type identifies one instance, and that instance fixes
the associated result types. No runtime search or caller-selected type argument is
involved.

Associated types cannot declare their own obligations. A form such as
`type Item: Show` is not part of the language. An operation can still require and use
the concrete types made available within an instance, but the associated declaration
itself remains only a type choice.

## Type members erase before the boundary

An associated type is compile-time information. `type Item = a` emits no JavaScript
property, constructor, or reflection record. The concrete `iterate` operation emits as
the ordinary function selected by the instance.

At a loop whose source type is known, instance selection is static:

```hexagon
for value in bag
  print(value)
```

has the same general output shape as calling `Bag.toSeq(bag)` and iterating the
resulting JavaScript iterable. There is no runtime lookup of `Item`.

Nothing associated-type-shaped appears in generated `.d.ts` files either. `Item` is
not an exported TypeScript member, and an `Iterable` instance is not a public object.
Exported ordinary functions expose their already-resolved parameter and result types.

## Summary

- an associated type is a type member declared by a constraint and chosen by each
  instance;
- normal type parameters are caller-selected, while an instance fixes its associated
  types;
- constraints declare `type Name`, and `honor` bodies bind `type Name = T`;
- an instance must bind every associated type exactly once;
- a constraint may declare multiple associated types;
- associated names belong to their owner constraints and do not occupy module-level
  type names;
- ordinary coherence and the orphan rule govern the type choices together with the
  instance's operations;
- associated type names are confined to their owning constraint and instance bodies;
- constraints with associated types cannot constrain otherwise unknown type variables,
  so reusable iteration APIs continue to accept `Seq(a)`; and
- associated types erase and add no runtime or `.d.ts` machinery.
