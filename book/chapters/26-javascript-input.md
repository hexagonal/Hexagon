# JavaScript Input

Hexagon is designed to enter an existing JavaScript program, not merely to produce a
JavaScript file at the end. A foreign binding begins with a declaration of what another
module provides:

```hexagon
extern from "tiny-json"
    type JsonValue
    fun parse(text: String) -> JsonValue
    fun stringify(value: JsonValue) -> String
    let VERSION as version: String
```

The block introduces ordinary module-level Hexagon names. `parse` and `stringify` are
functions, `version` is a value, and `JsonValue` is a nominal opaque foreign type. Each
callable declaration writes its effect arrow before its result, as the Effects chapter
taught: `->` here, because parsing and printing JSON touch nothing; `->!` wherever the
foreign code may touch the world, or whenever you do not know. Once introduced, they
participate in type checking like other bindings.

The declaration is checked; the JavaScript implementation is trusted. Hexagon verifies
that the declared types and syntax make sense, but it does not inspect every foreign
result at runtime to prove that the JavaScript author kept the contract.

## A boundary declaration is a contract

The direct cases cross unchanged:

| Hexagon type | Required JavaScript value | TypeScript face |
| --- | --- | --- |
| `Nat` | non-negative safe integral `number` | `number` |
| `Int` | safe integral `number` | `number` |
| `Float` | any `number` | `number` |
| `BigInt` | `bigint` | `bigint` |
| `Bool` | `boolean` | `boolean` |
| `String` | `string` | `string` |
| `Unit` result | `undefined` | `void` |

An extern annotation does not request a hidden numeric guard:

```hexagon
extern from "measurements"
    fun sampleCount() ->! Int
    fun temperature() ->! Float
    fun population() ->! BigInt
```

The binding author is asserting that `sampleCount` returns a safe integer. If the
foreign function returns `3.5`, the declaration is wrong. By contrast, an explicit
conversion whose purpose is to establish `Int` performs the required check:

```hexagon
let possiblePopulation = BigInt.toInt(population!())
```

`possiblePopulation` has type `Option(Int)`: the conversion checks whether the
`BigInt` fits safely before producing `Some`.

The dividing rule is useful beyond numbers:

> Declaring a foreign value to have a type is trusted. Explicitly converting or
> decoding an uncertain value is checked.

This keeps ordinary typed calls fast while leaving a clear door for defensive code at
untrusted inputs.

## Foreign bindings resemble JavaScript imports

Named foreign exports use JavaScript's foreign-name-first alias order:

```hexagon
extern from "tiny-json"
    fun parse as parseJson(text: String) -> JsonValue
    let VERSION as version: String
    type ForeignNode as Node
```

The name after `as` is the local Hexagon name. `fun` declares a callable export; `let`
declares a non-callable value.

These are the same two keywords ordinary declarations use, doing a different job, and
the first extern block you read may earn a double take: in ordinary declarations,
`let` is the everyday form and `fun` is reserved for recursion. That division works
because an ordinary definition has a body, and the body shows whether it is a function.
An extern declaration has no body, so the keyword says what a body would have
shown: at the boundary, `fun` means *callable* — and says nothing about recursion. The
compiler keeps the two spellings honest in both directions; a `let` with a parameter
list and a `fun` without one are each errors that name the correct rewrite, and a
`let` whose annotation is a function type counts as the first case.

Extern `let` also promises more than punctuation. It asserts that the foreign value is
stable: a JavaScript module that reassigns an export you declared `extern let` has
broken the declaration. A genuinely time-varying foreign value belongs behind an
accessor function on the JavaScript side, declared here with `fun`.

Bindings are private unless individually exported:

```hexagon
extern from "tiny-json"
    export fun parse(text: String) -> JsonValue
```

This creates a named export from the compiled Hexagon module. It does not modify the
foreign package.

JavaScript default exports use `default` only inside an extern declaration:

```hexagon
extern from "client-library"
    default fun createClient(config: Config) ->! Client
```

`createClient` is still an ordinary local name. Writing `export default fun ...` in the
extern block imports the JavaScript default and then re-exports the local binding as a
named Hexagon export; Hexagon modules themselves still have no default exports.

An effect-only foreign import is explicit:

```hexagon
extern import "telemetry/register"
```

It introduces no name and runs the foreign module's top-level effects. Foreign module
specifiers are paths or package names because they follow JavaScript resolution; a
Hexagon import names a module and carries no specifier at all.

## `Nullable` is the foreign nullish door

Hexagon does not make every type nullable. A JavaScript API that may return `null` or
`undefined` says so with `Nullable(a)`:

```hexagon
extern from "browser-profile"
    fun displayName() ->! Nullable(String)
```

`Nullable(a)` crosses with no wrapper and has the TypeScript face
`a | null | undefined`. It is not `Option(a)`. `Option` remains the ordinary Hexagon
union `Some(a) | None`, while `Nullable` describes foreign representation.

When both JavaScript absence values mean the same thing, convert once:

```hexagon
let name = Nullable.toOption(displayName!())
```

When the API distinguishes them, preserve all three cases:

```hexagon
match Nullable.toCase(displayName!())
    NullableCase.Undefined => "not supplied"
    NullableCase.Null => "explicitly blank"
    NullableCase.Value(name) => name
```

`Nullable.null` and `Nullable.undefined` supply explicit values to foreign calls.
There are no ambient `null` or `undefined` literals that can silently enter an ordinary
Hexagon type. Predicates such as `Nullable.isNull` return `Bool`; they do not introduce
TypeScript-style flow narrowing. Use `toOption` or `toCase` to extract the value.

Extern functions retain fixed arity. When a JavaScript API treats an omitted argument
as `undefined`, declare that position as `Nullable(a)` and pass
`Nullable.undefined` explicitly. The boundary does not add a second optional-argument
calling convention to Hexagon.

## `Array` is captured; `Vector` is persistent

`Array(a)` is a JavaScript array in Hexagon's hands. Its TypeScript face is
`ReadonlyArray<a>`, and crossing it copies:

```hexagon
extern from "score-service"
    fun recentScores() ->! Array(Int)
```

When `recentScores!()` returns, Hexagon takes a snapshot of the array the JavaScript
side produced and keeps the snapshot. The JavaScript side keeps its original and may
push to it, sort it, or empty it; the `Array(Int)` Hexagon holds does not change,
and neither does any sequence derived from it. The copy runs the other way too: an
`Array` handed to an extern, or returned from an exported function, arrives as a fresh
array, so nothing JavaScript does to what it received reaches the value Hexagon
retains. Hexagon exposes no mutation operation for `Array`, and the copy is what makes
that a fact rather than a request — a pure collection denotes stable contents, and
`Array.length(xs)` is a read of a value, which the compiler may share like any other.

The price is one linear copy per crossing, in the array and in anything inside it that
is itself a foreign collection: an `Array(Array(Int))` is copied layer by layer, while
an `Array(Vector(Int))` copies the outer array and carries the vectors, which are
already Hexagon values, by identity. A binding that cannot pay that copy, or that needs
the JavaScript array itself — its identity, its live contents — declares an opaque
extern type and reads it through the `->!` accessors the receiver-member section
below introduces. That is a foreign capability, spelled as one; `Array(a)` is a value.

Choose a persistent collection when you want its operations:

```hexagon
let scores = Array.toVector(recentScores!())
let withBonus = Vector.append(scores, 100)
```

`Array.toVector` eagerly builds a `Vector`. `Vector.toArray` and `Array.fromSeq`
eagerly create a fresh array, which is Hexagon's until it crosses — and is copied again
when it does. `Array.toSeq` is lazy over the captured array, and the sequence may be
forced whenever you like.

Some shapes are refused rather than left unprotected, because the copy cannot reach
them: a foreign collection nested inside a `Vector`, `Map`, `Set`, `Seq`, or `Stream`
at the boundary (`Vector(Array(Int))` — convert the elements with `Array.toVector`
first); an `exception` whose payload holds one (carry a `Vector`, or a persistent
`Map` or `Set`); and an exported *value* of such a type, since one live binding is what
JavaScript and every Hexagon importer would share, and a copy would be the very thing
they shared. Export a function instead, whose result is copied on the way out.

A callback whose signature names an `Array` is accepted, but not unchanged: each
crossing makes a fresh wrapper that copies the arrays going each way, so the same
function object no longer crosses by identity. An API that registers and removes
listeners by identity wants a small JavaScript shim that keeps the wrapper and returns
a disposal handle. The callbacks section below draws the line between this case and
the one that is refused.

This distinction prevents `ReadonlyArray<a>` from becoming an optimistic foreign name
for `Vector(a)`. One is a JavaScript array Hexagon owns a copy of; the other is a
Hexagon persistent value with a persistent collection's operations.

## `Seq` strengthens an iterable at the boundary

JavaScript's iterable protocol includes both replayable collections and single-shot
generator objects. Neither shape alone promises Hexagon's persistent sequence
positions. A top-level extern declaration may nevertheless request `Seq(a)`:

```hexagon
extern from "number-stream"
    fun values() ->! Seq(Int)
```

Hexagon accepts a JavaScript `Iterable<number>` and installs one lazy memoizing adapter.
The foreign iterator is requested on first demand. Each forced sequence position
remembers its value, end, or foreign failure, so asking for the same position again
does not advance the iterator or repeat its effects.

An exported Hexagon `Seq(a)` faces JavaScript as `Iterable<a>`, with each JavaScript
traversal receiving an independent cursor over the same persistent sequence. The
TypeScript face is necessarily weaker than the Hexagon guarantee, but the exported
behavior remains replayable.

Adaptation is supported at the top level, where the wrapper is visible and controlled.
It is not silently pushed inside a direct aggregate:

```hexagon
extern from "stream-groups"
    fun groups() ->! Array(Seq(Int)) // error: nested Seq adaptation would be hidden
```

The outer `Array` is captured as it crosses, while each arbitrary iterable inside
would need its own persistent adapter — installed inside the copy, out of sight. Use an explicit conversion or a small JavaScript
facade instead of asking the compiler to traverse and wrap a hidden graph.

## Foreign members become subject-first functions

JavaScript receiver calls can enter Hexagon without adding `this` or classes to the
Hexagon language:

```hexagon
extern from "url-tools"
    export type SearchParams

    export method get(
        params: SearchParams,
        key: String,
    ) ->! Nullable(String)
```

Hexagon sees an ordinary subject-first function, `->!` because a lookup on foreign
state may observe the world:

```hexagon
SearchParams.get!(params, "name")
params.get!("name")
```

The emitted call restores JavaScript's receiver convention:

```js
params.get("name");
```

The first visible parameter is always the Hexagon subject. A first-class reference
such as `let lookup = SearchParams.get` receives a stable wrapper that continues to
perform the JavaScript call `params.get(key)` rather than detaching the property
function.

Properties use equally direct declarations:

```hexagon
extern from "web-response"
    export type Response
    export get status(response: Response) ->! Int
    export set timeout as setTimeout(response: Response, value: Int) ->! Unit
```

A `->!` getter performs a fresh property read on every call and the call wears `!`;
foreign properties may vary, compute, or throw. A `->` getter is a purity claim over
data a contract holds still. A `set` declaration grants an explicit write capability,
returns `Unit`, and always writes `->!`: a write to foreign state is an effect.
Merely declaring a getter does not make the property writable from Hexagon.

## Foreign classes remain foreign

An extern class describes a JavaScript class as one opaque foreign type plus companion
operations:

```hexagon
extern from "node:url"
    export class URL as Url
        new as create(text: String) -> Url
        static method canParse(text: String) -> Bool
        method toString(url: Url) ->! String
        get hostname(url: Url) ->! String
```

Hexagon calls `Url.create(text)`, `Url.canParse(text)`, `Url.toString!(url)`, and
`Url.hostname!(url)`. JavaScript receives `new URL(text)`, a static receiver call, an
instance receiver call, and a property read respectively. A constructor writes and
checks the class's own type after its arrow; `create` writes `->` because constructing a
`URL` touches nothing, where a constructor that opened a connection would write `->!`.

`class`, `new`, `method`, `get`, and `set` describe the foreign calling convention.
They do not introduce inheritance, subclassing, overriding, implicit receivers, or a
class-valued Hexagon type. The resulting Hexagon surface remains an opaque type with
ordinary companion functions.

## Foreign enums become closed unions

JavaScript has no single enum runtime type. TypeScript numeric and string enums,
frozen constant objects, symbol-valued objects, and class-like singleton collections
all commonly expose the same useful shape: an object whose stable properties contain
the possible values.

An `extern enum` gives that object a closed Hexagon union view:

```hexagon
extern from "direction"
    enum Direction derives (Eq, Show) =
        | Up
        | Down

    fun current() ->! Direction
    fun move(direction: Direction) ->! Unit
```

The foreign module might contain a TypeScript string enum:

```ts
export enum Direction {
  Up = "UP",
  Down = "DOWN",
}
```

Inside Hexagon, `Up` and `Down` are ordinary nullary constructors. Matching is closed
and exhaustive:

```hexagon
let describe(direction: Direction): String =
    match direction
        Up => "up"
        Down => "down"
```

Unlike an ordinary all-nullary union, whose values are shared tagged objects, this
foreign-backed union retains the actual member values. `Up` is `Direction.Up`—`"UP"`
in this example—and `move!(Up)` passes that value straight back to JavaScript. Numeric,
string, symbol, and singleton-object members all use the same rule. The compiler reads
each declared property once and matches with JavaScript identity through `Object.is`.

Foreign and local names can differ using the usual foreign-name-first order:

```hexagon
extern from "keyboard"
    enum Key as Direction =
        | ARROW_UP as Up
        | ARROW_DOWN as Down
```

The member list is always explicit. The compiler does not inspect `Object.values` or
guess from TypeScript declarations; that would mistake the reverse entries of numeric
TypeScript enums for additional alternatives and would make exhaustiveness depend on
runtime discovery.

A declaration that reads an object is trusted. It promises that the listed properties
exist, remain stable, have distinct non-nullish values, and are the only values produced by foreign
functions typed as `Direction`. This keeps enum values representation-direct even
inside arrays, records, and callbacks. When the producer is genuinely uncertain, use
the generated checked conversion:

```hexagon
match fromJsDirection(rawValue)
    Some(direction) => describe(direction)
    None => "unknown direction"
```

`fromJsDirection` has type `JsValue -> Option(Direction)` and checks membership
against the declared member values. `toJsDirection` widens a known member to
`JsValue` without changing it. These are ordinary module bindings: for a local enum
named `T`, the generated names are `fromJsT` and `toJsT`. A name collision is a compile
error rather than a silently mangled public API.

Some foreign alternatives have no object at all. A TypeScript literal union such as
`"asc" | "desc"` is inlined at every use, and a `const enum` is erased before it
reaches JavaScript. For those, the same declaration takes its literal form, written at
module scope with each value in place of a member name:

```hexagon
export extern enum Order = "asc" as Ascending | "desc" as Descending

extern enum Tri =
    | true as Yes
    | false as No
    | null as Unknown
```

Nothing is read: the constants are the literals themselves, a match becomes a
`switch` over them, and the generated `.d.ts` says exactly what a TypeScript author
would have written:

```ts
export type Order = "asc" | "desc";
export declare const Ascending: Order;
export declare const Descending: Order;
```

The value is always written out, so `"Up" as Up` is a coincidence of one API, not a
rule. Strings, integers, booleans, `null` and `undefined` may mix freely, as long as the
values are distinct. A `null` or `undefined` member is a member of the set, not an
absence. `Tri` names `null` and not `undefined`, so an `undefined` arriving at a
`Tri`-typed slot is out of set, exactly as `"maybe"` would be, and `Nullable(Tri)` is
refused, because the wrapper could not tell absence from `Unknown`. An API that means
absence by `undefined` beside a `null` member says so with a fourth line,
`| undefined as Missing`; an enum naming both nullish values needs no wrapper, and
`Nullable(Tri)` is then simply `Tri`.

An ordinary `extern class` remains opaque. Describing static singleton instances with
`extern enum` is an explicit stronger promise that the listed instances form a closed
set; it does not expose construction, inheritance, or arbitrary instances. Bitflags are
combinations rather than alternatives and should cross as `Int` or an opaque foreign
type.

## Direct callbacks keep their identity

A callback can cross unchanged when all of its parameter and result types are already
representation-direct:

```hexagon
extern from "event-source"
    type Event
    type Target

    fun addListener(target: Target, callback: Event -> Unit) ->! Unit
    fun removeListener(target: Target, callback: Event -> Unit) ->! Unit
```

Passing the same Hexagon function to both operations passes the same JavaScript
function object. Arguments retain their declared order, `Unit` returns as `undefined`,
and any JavaScript-supplied callback `this` is ignored because Hexagon has no binding
for it.

A callback whose signature names an `Array` is accepted, but not unchanged: each
crossing makes a fresh wrapper that copies the arrays going each way, so the two calls
above would not match, and the disposal-handle shim from the `Array` section is the
remedy. A callback whose signature would need *adaptation* — `Seq(Int) -> Unit` — is
refused outright, because its elements arrive after the crossing has returned and
there is no frame left in which to adapt them. Bind a representation-direct callback
and convert at an explicit point, or place a small JavaScript adapter beside the
foreign library.

## Collection conversions are shallow

Conversions name the one outer representation they change:

```hexagon
let jsScores = Map.toJsMap(scores)
let copiedBack = Map.fromJsMap(jsScores)

let jsGuests = Set.toJsSet(guests)
let copiedGuests = Set.fromJsSet(jsGuests)
```

These convert between two Hexagon values: a persistent `Map` and a `JsMap`, which is a
native JavaScript `Map` that Hexagon owns. A `JsMap` or `JsSet` declared at a boundary
is captured exactly as an `Array` is, and one Hexagon makes for itself is its own from
birth; either way no foreign code holds it, so `JsMap.size` is a read of a value. They
do not share table storage. Conversion is shallow: keys, elements,
and values retain their declared runtime identities rather than undergoing an
automatic recursive graph conversion.

Primitive map keys cross faithfully because Hexagon and JavaScript agree on their
relevant equality. Object-shaped keys require care. A JavaScript `Map` finds such a key
by object identity, so reconstructing an equal-looking object does not recover the
original entry; callers must retain the converted key reference. In the other
direction, several JavaScript keys can collapse to one Hexagon-equal key. When that
happens, the later entry in JavaScript iteration order supplies the retained value.

The same principle applies to `Vector.toArray`. Converting
`Vector(Vector(Int))` produces `Array(Vector(Int))`, not `Array(Array(Int))`. A nested
conversion is another explicit operation, with another visible cost.

## Foreign failure stays foreign until decoded

A throw from an extern function, property, iterator, or callback enters the exception
model through `JsError`, as established in the Exceptions chapter. Hexagon does not
pretend that every JavaScript throwable is an `Error`; the original value remains
available for deliberate foreign handling.

Use `JsValue` only when a binding genuinely cannot state a more precise foreign type.
Turning an uncertain value into `Int`, a record, or another Hexagon invariant requires
an explicit checked decoder. Such an operation states its `Option`, `Result`, or
exception failure instead of hiding validation inside every extern call.

## Summary

- an `extern` declaration introduces checked Hexagon bindings under a trusted foreign
  implementation contract;
- foreign `fun`, `let`, `type`, default, alias, and effect forms remain close to
  JavaScript module vocabulary, with `fun` marking callables and `let` stable values;
- representation-direct values cross unchanged, while explicit narrowing operations
  perform checks;
- `Nullable(a)` is the nullish foreign door and remains distinct from `Option(a)`;
- `Array(a)`, `JsMap(k, v)`, and `JsSet(a)` are captured at every crossing — copied in,
  copied out — while `Vector(a)` is persistent storage;
- a top-level foreign iterable may be adapted into a persistent memoized `Seq(a)`;
- every callable extern declaration writes its effect arrow before its result — `->!`
  when in doubt, `->` as a trusted claim, `->?` for one as effectful as its callbacks —
  with setters `->!` only and constructors naming the class's own type;
- `method`, `get`, `set`, and `class` produce ordinary subject-first Hexagon companion
  operations while preserving JavaScript calling conventions;
- `extern enum` gives stable foreign object members, or written literal values, a closed nullary-union view while
  retaining their original JavaScript values;
- representation-direct callbacks cross with stable function identity;
- collection conversions are explicit and shallow; and
- foreign throws use `JsError`, while uncertain `JsValue` data requires explicit
  decoding.

Ordinary values now cross in both directions with their costs and trust visible. The
final chapter handles the unusual exported function whose type still depends on a
constraint: it must offer direct concrete calls without making generic JavaScript
callers guess how Hexagon instance selection works.
