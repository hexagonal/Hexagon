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

Hexagon has named exports only. There is no `export default`, and an import always says
which name it receives.

A declaration exports the things it introduces. Exporting a record publishes its type
and constructor. Exporting a union publishes its type and constructors. Exporting a
constraint publishes the constraint and its operations. An instance is different: it
is part of whole-program coherence rather than a name callers import, so `export` does
not apply to `honor`.

An unexported name is genuinely inaccessible from another module. Qualification is not
a privacy escape hatch, and emitted JavaScript simply does not export the private
binding.

## Imports can be direct or qualified

Hexagon's import rules are similar to JavaScript's ES module rules. Named imports,
aliases, qualified module imports, and effect-only imports all have familiar forms;
the details below state Hexagon's exact rules.

Module paths are relative string literals with the extension omitted:

```hexagon
import { Point, distanceFromOrigin } from "./geometry"
```

A named import brings the exported name into the current module. One record import
brings both the type and its constructor because the record declaration introduced
both:

```hexagon
let point: Point = Point({x = 3.0, y = 4.0})
let distance = distanceFromOrigin(point)
```

Union constructors are separate exported names. Import whichever alternatives the
module uses:

```hexagon
import { Direction, North, South } from "./direction"
```

An alias resolves a collision or gives a more specific local name:

```hexagon
import { area as circleArea } from "./circle"
import { area as rectangleArea } from "./rectangle"
```

For sustained qualified use, bind a module alias:

```hexagon
import * as Geo from "./geometry"

let point = Geo.Point({x = 3.0, y = 4.0})
let distance = Geo.distanceFromOrigin(point)
```

Qualification works in term, type, and pattern positions:

```hexagon
let length(point: Geo.Point): Float = Geo.distanceFromOrigin(point)
```

Module aliases begin with an uppercase letter. They are namespaces, not values:

```hexagon
let saved = Geo // error: modules are not values
```

They cannot be passed to a function, returned, or stored in a record. Functions and
records already provide those forms of program data.

## Effect imports load without binding names

The fourth import form brings a module into the program graph without introducing a
local name:

```hexagon
import "./telemetry"
```

This is useful when the imported module has deliberate top-level effects. It can also
make an orphan-legal instance available to the whole program without importing an
ordinary value from its module.

Effect imports should be rare and conspicuous. Most modules expose values and
functions, leaving callers to decide when effects occur.

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

A consumer may import the type and give the module the same name:

```hexagon
import { Point } from "./point"
import * as Point from "./point"

let start: Point = Point({x = 1.0, y = 2.0})
let moved = Point.translate(start, 3.0, 4.0)
```

The type, constructor, and module alias occupy different namespaces. Type position
selects the type, bare `Point(...)` selects the constructor, and `Point.` selects the
module. Many modules instead choose a plural alias, but the companion spelling is
available without a special module system.

Dot calls build on this exact organization. If `translate` is exported and subject
first, `start.translate(3.0, 4.0)` resolves to the companion operation.

## Opaque exports hide representation

Sometimes callers should know that a type exists without being able to depend on its
fields or alternatives. `export opaque` publishes the nominal type while keeping its
representation inside its home module.

```hexagon
export opaque record UserId = {value: Int}

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
export opaque union Handle =
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
export opaque record Box(a) = {open: () -> Option(a)}

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
export opaque record Box(+a) = {open: () -> Option(a)}
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
export opaque record Sink(+a) = {accept: a -> Unit}   // error
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

## Public signatures must remain usable

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

A private type alias is different. Since an alias is only another name for its
expansion, the public signature may expose the underlying type instead of leaking the
private alias.

Module boundaries do not change polymorphism. The complete annotation pins an
export's public contract, while checking still verifies it against the same
polymorphic type system used for private bindings.

## Names remain predictable

Two named imports that would introduce the same name in one namespace are an error.
Use an alias or qualification rather than relying on import order:

```hexagon
import { render as renderMap } from "./map-view"
import { render as renderChart } from "./chart-view"
```

The prelude sits in an outer scope layer. A module-level declaration may deliberately
use the same name and becomes the unqualified meaning throughout that module; the
prelude operation remains available through its qualified home. Function-local
bindings remain stricter and cannot silently replace an existing name.

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
import { print } from "./console"

print("application loaded")
```

The ordinary discarded-value rule still applies. A meaningful non-`Unit` value must
be bound or explicitly ignored.

## A root module runs without a special `main`

Hexagon assigns no special meaning to a function named `main`. A compiler host selects
a root module; evaluating the resulting ESM graph loads its imports and performs its
top-level effects.

```hexagon
import { runServer } from "./server"

runServer(configuration)
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
import { Point } from "./point"

export let origin: Point = Point({x = 0.0, y = 0.0})
let label = "origin"
```

has a direct JavaScript shape:

```js
import { Point } from "./point.js";

export const origin = Point({x: 0.0, y: 0.0});
const label = "origin";
```

Private declarations remain ordinary private ESM bindings. Effect imports remain bare
imports. Qualified source calls resolve statically, so emitted code may use precise
named imports rather than constructing runtime module objects.

Companion modules now give every exported subject-first operation an unambiguous home.
The next chapter uses that fact to explain the convenient dot-call spelling.

## Summary

- one `.hex` file is one module, identified by its path and requiring no header;
- declarations are private unless prefixed with `export`;
- imports may be named, aliased, namespace-qualified, or effect-only;
- module aliases are namespaces, not first-class values;
- companion modules give subject-first operations a predictable qualified home;
- `export opaque` hides a record's fields or a union's constructors outside its home;
- a parameterized opaque type declares what it promises with `+a` or `-a`, checked
  against its representation; a bare parameter claims nothing;
- exported terms have complete signatures with explicit maximal constraints;
- public signatures cannot leak private nominal types;
- instances are global over the imported program graph rather than exported names;
- imports are acyclic and initialize dependencies before dependants;
- a selected root runs through ordinary top-level module evaluation, without `main`;
  and
- Hexagon modules emit directly as ESM modules.
