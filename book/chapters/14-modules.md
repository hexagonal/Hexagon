# Modules

As a program grows, its declarations need homes and its public surface needs edges.
In Hexagon, the rule is deliberately small:

> A file is a module, and a module is a file.

A `.hex` file needs no `module` header. Its path identifies it, and another file
chooses how to name what it imports.

Suppose `geometry.hex` contains:

```hexagon
export record Point = {x: Float, y: Float}

export let distanceFromOrigin(point: Point): Float =
    Float.pow(point.x ** 2 + point.y ** 2, 0.5)

let origin = Point({x = 0.0, y = 0.0})
```

`Point` and `distanceFromOrigin` are public. `origin` is private to this file. Privacy
is the default; there is no separate export list elsewhere that can drift away from
the declarations.

## Exports publish declarations by name

`export` prefixes a module-level declaration:

```hexagon
export let answer: Int = 42
export let double(x: Int): Int = x * 2
export type Coordinates = (Float, Float)
export record Point = {x: Float, y: Float}
export union Direction = North | East | South | West
export exception ParseError(line: Int)
```

Hexagon has named exports only. There is no `export default`, and an import always
names the module it binds.

A declaration exports the things it introduces. Exporting a record publishes its type
and constructor. Exporting a union publishes its type and constructors. Exporting a
constraint publishes the constraint and its operations. An instance is different: it
is part of whole-program coherence rather than a name callers import, so `export` does
not apply to `honor`.

An unexported name is genuinely inaccessible from another module. Qualification is not
a privacy escape hatch, and emitted JavaScript simply does not export the private
binding.

## Imports bind modules

An import brings one module into scope under a name you choose. That is the whole of
it: there is no form that imports a single function, type, or constructor by name.

```hexagon
import Geo from "./geometry"

let point = Geo.Point({x = 3.0, y = 4.0})
let distance = Geo.distanceFromOrigin(point)
```

Module paths are relative string literals with the extension omitted. The alias begins
with an uppercase letter, and every export is reached through it: terms, types,
constructors, and constraints alike. Qualification works in term, type, and pattern
positions:

```hexagon
let length(point: Geo.Point): Float = Geo.distanceFromOrigin(point)
```

A reader of the consuming file can see where every name comes from without opening
another file. That is the property the rule buys, and it is why the line reads like a
JavaScript default import but is not one. JavaScript's `import Geo from "./geometry"`
asks for a default export; Hexagon has none, and the same spelling binds the whole
module. The uppercase alias is the tell.

Module aliases are namespaces, not values:

```hexagon
let saved = Geo // error: modules are not values
```

They cannot be passed to a function, returned, or stored in a record. Functions and
records already provide those forms of program data.

## A bare name is a declaration

When a qualified spelling is more than a file wants to write, the file declares the
bare name itself. A module-level `let` binds a function or a value and keeps its
polymorphism; a `type` alias names a type:

```hexagon
import Geo from "./geometry"

let distance = Geo.distanceFromOrigin
type Point = Geo.Point
```

Each of these is an ordinary declaration, so it obeys the ordinary rules: it is private
unless exported, and it collides with other declarations the way any binding does. An
import cannot introduce a name that silently shadows one of yours, because an import
introduces no bare names at all.

Constructors have two doors of their own, neither needing a declaration. The first is
the companion idiom below: an alias spelled like an exported type also answers for that
type and for a same-named record constructor. The second is the `match` arm. The
constructors of the scrutinee's type may be written bare in a pattern, whatever module
declared them:

```hexagon
import Direction from "./direction"

let turn(d: Direction): Direction =
    match d
        North => Direction.East
        East => Direction.South
        South => Direction.West
        West => Direction.North
```

The pattern side reads the constructor off the type the compiler already knows the
scrutinee to have, so `North` in an arm means `Direction.North` unless this file
declares a `North` of its own. The expression side has no such anchor, which is why the
arm bodies spell the constructor qualified. A constructor you declared in this file
wins the bare spelling in both places; the door only opens where the name would
otherwise be unknown.

## Modules are imported for their names

There is no import that loads a module for its effects alone. A pure Hexagon module
holds no state, so it cannot register anything at load time; the idiom for a setup
effect is an exported function the importer calls, `Telemetry.init()`, where the reader
can see when it runs. A module that exists to be run is a root module, covered below,
not something another file imports. Instances need no loading step either: naming a
type brings its home module, and with it the instances declared there, into the
program.

## Companion modules give operations a home

The **home module** of a nominal type is the file that declares it. The
standard-library spelling `Vector.append` is not a special namespace mechanism. It is
the ordinary module pattern applied consistently: exported functions in a type's home
module operate on that type.

A user-defined type can follow the same pattern. In `point.hex`:

```hexagon
export record Point = {x: Float, y: Float}

export let translate(point: Point, dx: Float, dy: Float): Point =
    {point with x = point.x + dx, y = point.y + dy}
```

A consumer gives the module the type's own name:

```hexagon
import Point from "./point"

let start: Point = Point({x = 1.0, y = 2.0})
let moved = Point.translate(start, 3.0, 4.0)
```

One line, three readings. `Point.` selects the module. `Point` in type position selects
the type, because the module exports a type spelled like the alias. Bare `Point(...)`
selects the constructor, for the same reason, in an expression and in a pattern. These
are the companion fallbacks: where the alias's own spelling names nothing in the type
or term namespace, a same-spelled export of the aliased module answers. A module whose
type is not spelled like its alias takes the qualified spelling, or a `type` alias of
your own. Many modules choose a plural alias instead; the companion spelling is
available without a special module system.

Dot calls build on this exact organization. If `translate` is exported and subject
first, `start.translate(3.0, 4.0)` resolves to the companion operation.

## Opaque exports hide representation

Sometimes callers should know that a type exists without being able to depend on its
fields or alternatives. `opaque` publishes the nominal type while keeping its
representation inside its home module. It stands where `export` would stand — the two
words fill one slot, and a declaration head carries at most one of them; a head with
neither stays private, as always. There is no `export opaque`: hiding the
representation of a type nobody else can see would assert nothing, so the one word
already says both *exported* and *hidden*.

```hexagon
opaque record UserId = {value: Int}

export let fromInt(value: Int): UserId = UserId({value})
export let value(userId: UserId): Int = userId.value
```

Outside this file, callers can name `UserId` and use the exported functions. They
cannot call the private `UserId` constructor, read `.value`, destructure the record, or
update it by spreading fields.

This hiding is **opacity**: a module exposes a type and selected operations while
withholding the type's representation. It creates a useful boundary for invariants.
For example, a smart constructor may reject negative identifiers before creating a
`UserId`, knowing outside code cannot bypass it.

Opaque unions hide all their constructors in the same way:

```hexagon
opaque union Handle =
    FileHandle(descriptor: Int)
    | NetworkHandle(socket: Int)
```

The home module can still construct and match both alternatives. Consumers use its
exported smart constructors and observers. Opacity hides structure, not capabilities:
derived `Eq` or `Show` behavior and other lawful instances continue to work globally.

Aliases cannot be opaque because an alias is transparent by definition. When a named
abstraction is required, use a nominal record or union.

## A parameterized opaque type says what it promises

Hiding the representation hides something callers were relying on without knowing it.
Consider a sequence type whose parameter appears only in what it hands out:

```hexagon
opaque record Box(a) = {open: () -> Option(a)}

export let emptyBox(): Box(a) = Box({open = () => None})
```

Inside this module the compiler can see that a `Box` only ever produces an `a`. Outside
it, nobody can — the representation is exactly what `opaque` withheld. So a caller who
writes

```hexagon
let empty = emptyBox()
```

gets a binding whose element type is fixed by its first use, because as far as the
outside world is told, a `Box` might be holding an `a` already.

Write a `+` on the parameter and the promise crosses the boundary:

```hexagon
opaque record Box(+a) = {open: () -> Option(a)}
```

Now `empty` above is reusable at any element type, in every module. `+a` says *this
type only produces `a`*; `-a` says the opposite, *it only consumes one*, which is the
right claim for a type like `Sink(-a) = {accept: a -> Unit}`. A bare parameter claims
nothing, which is why the first version behaved as it did.

The direction a parameter is used in is its **variance**. `+a` is *covariant*, `-a` is
*contravariant*, and a bare parameter is *invariant* — three answers, two of which
need a sigil. Other languages spell the same three with `out` and `in` keywords, or
with nothing at all. Hexagon needs them only here: for a transparent type the compiler
reads the direction off the definition, and the previous chapter's rule about which
variables a computed binding keeps is that same analysis, applied to the types it can
see through.

The compiler checks the claim against the representation, at the declaration:

```hexagon
opaque record Sink(+a) = {accept: a -> Unit}   // error
```

> `a` cannot be declared covariant in `Sink`: field `accept` uses `a` in argument
> position. Remove the `+`, or change the field

Claiming *less* than the representation supports is always allowed, and is worth
knowing about: a bare `Box(a)` reserves the right to add a field that takes an `a` in
later, without that being a breaking change for anybody. Claiming more is what the
error above prevents, and it is reported where the author can act on it rather than in
a stranger's module months later. This is the same principle as `derives`: what
crosses an opaque boundary is declared, never inferred.

Transparent records and unions take no sigil — their definition is public, so there is
nothing to declare that a reader could not already see. Nor does a use site: an
annotation is always written `Box(Int)`, never `Box(+Int)`. The claim belongs to the
type, once, where it is declared.

## Public faces must remain usable

Every exported term writes a complete signature. Values have a type annotation.
Functions annotate every parameter and their result, and constrained functions
write every independent constraint:

```hexagon
export let defaultLimit: Int = 100

export let smaller<a: Ord>(left: a, right: a): a =
    if left < right then left else right
```

Do not repeat base constraints. If `Hash` builds on `Eq`, write `<a: Hash>`,
not `<a: (Eq, Hash)>`; the `Hash` evidence already carries equality. The compiler
checks all of these boundary requirements. Private module-level functions keep
their lighter annotation pattern as a style convention, with inferred results
and constraints.

An exported function cannot mention a private nominal type:

```hexagon
record Token = {text: String}

export let parse(source: String): Token = ... // error
```

The caller could neither name nor use the result. Export `Token`, perhaps opaquely, or
keep `parse` private.

Exported types answer to the same rule. A field of an exported record, a constructor
payload of an exported union or exception, and the target of an exported type alias
are all part of the module's public face, and a private type can hide in any of them
as easily as in a signature:

```hexagon
record Token = {text: String}

export record Cursor = {at: Int, token: Token} // error, at the field
```

The compiler points at the mention itself — here the `token` field — and, here as in
the signature case above, a second marker on `Token`'s own declaration shows where
the missing `export` would go. The remedy is the same pair: export `Token`, perhaps
opaquely, or keep `Cursor` private.

A private type alias is different. Since an alias is only another name for its
expansion, the public signature may expose the underlying type instead of leaking the
private alias — though if the expansion itself is a private type, that is the same
leak by another name, and the compiler refuses it the same way.

An exported constraint's member signatures answer to the same rule, for the same
reason. A member like `peek(x: a): Token` with `Token` private asks an importer to
produce and handle a value whose type they can neither name nor build; the compiler
refuses it at the member, with the same marker on `Token`'s declaration and the same
remedy — export `Token`, perhaps opaquely, or keep the constraint private.

The other way around is fine, and useful: a *private* constraint may gate an
exported function (`export fun use<a: Priv>(x: a): Int`). The constraint never
crosses the boundary — callers pass with a type this module honors, and nobody
outside can honor `Priv` at a new type. That closed world is the point: it is how a
module offers an operation over exactly the types it chooses, and no others.

Module boundaries do not change polymorphism. The complete annotation pins an
export's public contract, while checking still verifies it against the same
polymorphic type system used for private bindings.

## Names remain predictable

Two imports that bind the same alias are an error, and the importer chooses the
aliases, so the fix is always local:

```hexagon
import MapView from "./map-view"
import ChartView from "./chart-view"

let renderMap = MapView.render
let renderChart = ChartView.render
```

Nothing an import does can change the meaning of a name you declared, because an
import declares nothing but its alias.

The prelude sits in an outer scope layer, and it puts very little into it bare: the
constructors `True`, `False`, `Some`, `None`, `Ok`, `Err`, the exceptions, `ignore`, and
`show`. Type and constraint names such as `Option` and `Show` are always in scope; every
other prelude term is reached by the dot or by its module name — `Seq.map`, `Int.compare`,
`Debug.log` — so the words you want for your own program stay yours. A module-level
declaration may deliberately use one of the bare names and becomes the unqualified meaning
throughout that module; the prelude operation remains available through its qualified
home. Function-local bindings remain stricter and cannot silently replace an existing
name.

This balance prevents every future prelude addition from breaking module-level code
while retaining the book's established rule that names do not quietly change meaning
inside a function.

## Imports form an acyclic graph

Hexagon rejects every import cycle, including cycles used only for types:

```text
./a → ./b → ./a
```

Mutually recursive declarations belong in one module. The acyclic rule gives programs
a deterministic initialization order and avoids JavaScript's partially initialized
cycle behavior.

A module's imports load depth-first in source order, each module exactly once, before
that module's own top level runs. Within one module, executable top-level items run in
source order.

Top-level expressions are allowed when they produce `Unit`:

```hexagon
import Console from "./console"

Console.print("application loaded")
```

The ordinary discarded-value rule still applies. A meaningful non-`Unit` value must
be bound or explicitly ignored.

## A root module runs without a special `main`

Hexagon assigns no special meaning to a function named `main`. A compiler host selects
a root module; evaluating the resulting ESM graph loads its imports and performs its
top-level effects.

```hexagon
import Server from "./server"

Server.start(configuration)
```

That file can be selected as an application root or imported by another module. The
language does not impose a second entry-point mechanism on top of ordinary module
evaluation.

Pure Hexagon modules also contain no mutable module state. `var` is function-local, so
an export exposes values and functions rather than a cell that another file can
change. Foreign JavaScript may of course hide state behind an imported function; that
is an interoperation concern, not module-level Hexagon mutation.

## Modules emit as modules

One Hexagon file emits as one ESM file. The source:

```hexagon
import Point from "./point"

export let origin: Point = Point({x = 0.0, y = 0.0})
let label = "origin"
```

has a direct JavaScript shape:

```js
import * as Point from "./point.js";

export const origin = {x: 0.0, y: 0.0};
const label = "origin";
```

Private declarations remain ordinary private ESM bindings. The module import lowers to
JavaScript's own namespace import, `import * as Point`; a name the file reaches through
the alias is spelled on that local, and a record construction erases into its object
literal before any name is needed. Where a file reaches several of a module's names, the
compiler may use named imports instead; either shape means the same program.

Companion modules now give every exported subject-first operation an unambiguous home.
The next chapter uses that fact to explain the convenient dot-call spelling.

## Summary

- one `.hex` file is one module, identified by its path and requiring no header;
- declarations are private unless prefixed with `export`;
- an import binds one module under an alias the importer chooses, and nothing else;
  a module is imported for its names, never loaded for its effects;
- a bare name is a declaration of your own, a companion fallback, or a constructor in
  a `match` arm;
- module aliases are namespaces, not first-class values;
- companion modules give subject-first operations a predictable qualified home;
- `opaque` exports the type name alone, hiding a record's fields or a union's constructors outside its home;
- a parameterized opaque type declares what it promises with `+a` or `-a`, checked
  against its representation; a bare parameter claims nothing;
- exported terms have complete signatures with explicit maximal constraints;
- public faces — signatures, fields, payloads, alias targets, and constraint member signatures — cannot leak private nominal types (though a private constraint may gate an exported function);
- instances are global over the imported program graph rather than exported names;
- imports are acyclic and initialize dependencies before dependants;
- a selected root runs through ordinary top-level module evaluation, without `main`;
  and
- Hexagon modules emit directly as ESM modules.
