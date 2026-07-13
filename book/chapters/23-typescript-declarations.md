# TypeScript Declarations

Emitted JavaScript says how a Hexagon module runs. Its generated `.d.ts` file says what
TypeScript callers are invited to use.

For an exported binding:

```hexagon
export let greet(name: String): String = "Hello, ${name}!"
```

the build products agree:

```js
export const greet = name => `Hello, ${name}!`;
```

```ts
export declare const greet: (name: string) => string;
```

The declaration does not describe the function body. It describes the name, calling
shape, and boundary types of the ESM value that JavaScript exports.

## Declarations describe only the public surface

Private module bindings do not appear:

```hexagon
export let parse(source: String): Result(Document, ParseProblem) = ...
let normalizeWhitespace(source: String): String = ...
```

Only `parse` is part of the generated declaration. A readable private helper may still
exist in the JavaScript file, but another module has not been promised its name or
type.

This makes `.d.ts` output more than incidental compiler metadata. It is a compact
account of the supported foreign surface and belongs in API review alongside the
Hexagon exports themselves.

## Primitive types use familiar TypeScript faces

The six primitive types cross directly:

| Hexagon | TypeScript |
| --- | --- |
| `Int` | `number` |
| `Float` | `number` |
| `BigInt` | `bigint` |
| `Bool` | `boolean` |
| `String` | `string` |
| `Unit` value | `undefined` |
| `Unit` function result | `void` |

`Int` and `Float` intentionally share the `number` representation. TypeScript cannot
recover their different arithmetic rules from that representation, so a declaration
does not pretend that it can.

`Unit` has two useful faces. A stored or nested `Unit` value is `undefined`; a function
called for its effect conventionally returns `void`:

```hexagon
export let notify(message: String): Unit = print(message)
```

```ts
export declare const notify: (message: string) => void;
```

## Function arity and generic relationships remain visible

N-ary Hexagon functions become ordinary fixed-parameter TypeScript functions:

```hexagon
export let between(value: Int, lower: Int, upper: Int): Bool =
  lower <= value <= upper
```

```ts
export declare const between: (
  value: number,
  lower: number,
  upper: number,
) => boolean;
```

Inferred polymorphism becomes an ordinary generic signature:

```hexagon
export let chooseFirst(first, second) = first
```

```ts
export declare const chooseFirst: <a, b>(first: a, second: b) => a;
```

Generated binders retain Hexagon's lowercase style: `<a>`, `<k>`, and `<v>`. They are
ordinary TypeScript generic parameters, not special global names.

Constraints need additional boundary decisions because a JavaScript caller may need
evidence that Hexagon normally supplies automatically. The later Constrained Exports
chapter owns that surface; this chapter does not hide it beneath an inaccurate
constraint-free signature.

## Tuples and structural records stay structural

A tuple becomes a TypeScript tuple:

```hexagon
export let dimensions: (Int, Int) = (80, 24)
```

```ts
export declare const dimensions: [number, number];
```

A structural record becomes the object type a TypeScript author would expect:

```hexagon
export let guest = {name: "Mira", seats: 3}
```

```ts
export declare const guest: {name: string; seats: number};
```

Open row-polymorphic requirements become structural generic relationships where
needed, but callers see ordinary properties rather than a runtime row object. Field
order is irrelevant in both languages.

## Aliases remain when callers can use them

A public alias can preserve the vocabulary of the Hexagon API:

```hexagon
export type Coordinates = (Float, Float)
export let origin: Coordinates = (0.0, 0.0)
```

```ts
export type Coordinates = [number, number];
export declare const origin: Coordinates;
```

An unexported alias cannot leak an unusable private name. If an exported signature
mentions one, the generated declaration expands it:

```hexagon
type Label = String
export let label(code: Int): Label = ...
```

```ts
export declare const label: (code: number) => string;
```

This is another consequence of transparency: callers lose a private convenience name,
not a type boundary.

## Public records expose a type and constructor

An ordinary exported nominal record crosses with its structural representation and
supported constructor:

```hexagon
export record Point = {x: Float, y: Float}
```

```ts
export type Point = {x: number; y: number};
export declare function Point(value: {x: number; y: number}): Point;
```

TypeScript is structurally typed, so this face cannot preserve the complete nominal
distinction enforced between Hexagon record declarations. A TypeScript caller can
construct a structurally compatible object directly. The declaration stays honest
about the runtime POJO rather than inventing a wrapper that does not exist.

The exported constructor still matters: it is the discoverable, supported way for
JavaScript and TypeScript code to construct the value, and it remains useful if the API
later places behavior around its boundary.

## Unions become discriminated unions

A mixed or payload-carrying union becomes the familiar `tag` shape:

```hexagon
export union Delivery =
  Waiting
  | Sent(tracking: String)
  | Arrived
```

```ts
export type Delivery =
  | {tag: "Waiting"}
  | {tag: "Sent"; tracking: string}
  | {tag: "Arrived"};

export declare const Waiting: Delivery;
export declare function Sent(tracking: string): Delivery;
export declare const Arrived: Delivery;
```

Payload constructors are functions. Nullary constructors within this mixed union are
shared values.

An all-nullary union becomes a string-literal union:

```ts
export type Direction = "North" | "East" | "South" | "West";
export declare const North: Direction;
export declare const East: Direction;
export declare const South: Direction;
export declare const West: Direction;
```

This declaration is pleasant to use in TypeScript and exactly matches the emitted
strings. Adding a payload constructor changes the whole representation to tagged
objects and is therefore a breaking foreign-boundary change.

## Opaque types hide their representation twice

An opaque export must not reveal in TypeScript what Hexagon hid from other Hexagon
modules:

```hexagon
export opaque record UserId = {value: Int}

export let fromInt(value: Int): UserId = UserId({value})
export let value(userId: UserId): Int = userId.value
```

Its declaration uses a private `unique symbol` brand:

```ts
declare const userIdBrand: unique symbol;

export type UserId = {
  readonly [userIdBrand]: never;
};

export declare const fromInt: (value: number) => UserId;
export declare const value: (userId: UserId) => number;
```

The raw field and constructor are absent. TypeScript code receives a nominal-looking
token that it cannot fabricate structurally through ordinary typed code.

This brand is TypeScript-only. The JavaScript value remains the representation used
inside the Hexagon module; no wrapper, runtime tag, or validation object is added.
Untyped JavaScript still relies on the module's documented boundary contract.

Opaque unions use the same principle. Their alternatives and representation remain
absent while explicitly exported smart constructors and observers receive ordinary
signatures.

## Runtime-owned values name their runtime types

Persistent collections are not described as native arrays, maps, or sets:

```ts
import type * as Hex from "@hexagon/runtime";

export declare const path: Hex.Vector<Point>;
export declare const lookup: Hex.Map<string, Point>;
export declare const visited: Hex.Set<string>;
```

`Hex` is a generated local namespace alias for runtime types, not a global object.
The visible names prevent a TypeScript caller from assuming mutable native collection
semantics.

`Seq(a)` deliberately uses JavaScript's iterable protocol at the boundary:

```hexagon
export let events(): Seq(Event) = ...
```

```ts
export declare const events: () => Iterable<Event>;
```

The runtime preserves Hexagon's persistent sequence positions while TypeScript callers
receive the familiar `Iterable` surface.

Hexagon exceptions appear as branded `Error` types. Payload fields remain visible for
an exported exception, while `Exn` itself faces as `Error`. A nullary exception crosses
to JavaScript as a constructor function so every call can capture a fresh stack.

## Source-only mechanisms stay out

Generated declarations contain no entries for:

- local variables, loops, matches, pipes, or dot-call syntax;
- private declarations;
- `Iterable.Item` or iteration instances;
- derived operations that were not exported as ordinary functions; or
- internal dictionary objects that no foreign caller can name.

These mechanisms affect checking or implementation, not the supported TypeScript
surface. When compiler-produced evidence genuinely becomes callable public API—as it
can for constrained polymorphic exports—it appears deliberately under the rules of the
later dedicated chapter.

## A declaration is not the Hexagon type checker

TypeScript describes the JavaScript boundary, not every source-language guarantee. It
does not encode:

- the distinction between `Int` and `Float` once both are `number`;
- one-based vector indexing or the exceptions thrown by asserting access;
- exhaustiveness already checked inside Hexagon code;
- the value restriction or Hexagon's inference rules;
- the absence of hidden effects; or
- all nominal distinctions of non-opaque record declarations.

Trying to simulate every rule would make declarations elaborate while still failing
to reproduce Hexagon. The useful contract is narrower: the declaration accurately
describes the values and functions a TypeScript caller can receive and invoke.

Ordinary boundary calls are trusted typed contracts, as they are between TypeScript
modules. Runtime validation belongs in explicit decoders and checked conversion
functions, not in an invisible wrapper around every export.

## Declaration changes are API changes

Changing a private implementation without changing `.d.ts` is usually invisible to a
foreign caller. Changing an exported name, parameter order, generic relationship, data
shape, opacity boundary, or union representation changes the public contract.

Generated declarations therefore deserve source control and review like other API
artifacts. A concise diff can reveal that a seemingly internal Hexagon edit has widened
or broken the JavaScript/TypeScript surface.

The following chapters will put this boundary to work: first by importing and exporting
ordinary JavaScript values, then by exposing constrained polymorphism without making
ordinary concrete calls pay for it.

## Summary

- a `.d.ts` file describes the supported public types of the emitted ESM module;
- private bindings remain absent even when their JavaScript is readable;
- primitive, function, tuple, record, and union faces use idiomatic TypeScript;
- public aliases remain useful names, while private aliases expand;
- ordinary nominal records expose their honest structural runtime shape;
- opaque records and unions use TypeScript-only brands and hide their representation;
- persistent collections appear as `Hex.Vector`, `Hex.Map`, and `Hex.Set`, while
  `Seq(a)` appears as `Iterable<a>`;
- source-only checking and syntax do not clutter the declaration; and
- declaration changes are foreign API changes and should be reviewed accordingly.
