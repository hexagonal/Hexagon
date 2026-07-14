# JavaScript Input

Hexagon is designed to enter an existing JavaScript program, not merely to produce a
JavaScript file at the end. A foreign binding begins with a declaration of what another
module provides:

```hexagon
extern from "tiny-json"
  type JsonValue
  fun parse(text: String): JsonValue
  fun stringify(value: JsonValue): String
  let VERSION as version: String
```

The block introduces ordinary module-level Hexagon names. `parse` and `stringify` are
functions, `version` is a value, and `JsonValue` is a nominal opaque foreign type. Once
introduced, they participate in type checking like other bindings.

The declaration is checked; the JavaScript implementation is trusted. Hexagon verifies
that the declared types and syntax make sense, but it does not inspect every foreign
result at runtime to prove that the JavaScript author kept the contract.

## A boundary declaration is a contract

The direct cases cross unchanged:

| Hexagon type | Required JavaScript value | TypeScript face |
| --- | --- | --- |
| `Int` | safe integral `number` | `number` |
| `Float` | any `number` | `number` |
| `BigInt` | `bigint` | `bigint` |
| `Bool` | `boolean` | `boolean` |
| `String` | `string` | `string` |
| `Unit` result | `undefined` | `void` |

An extern annotation does not request a hidden numeric guard:

```hexagon
extern from "measurements"
  fun sampleCount(): Int
  fun temperature(): Float
  fun population(): BigInt
```

The binding author is asserting that `sampleCount` returns a safe integer. If the
foreign function returns `3.5`, the declaration is wrong. By contrast, an explicit
conversion whose purpose is to establish `Int` performs the required check:

```hexagon
let possiblePopulation = BigInt.toInt(population())
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
  fun parse as parseJson(text: String): JsonValue
  let VERSION as version: String
  type ForeignNode as Node
```

The name after `as` is the local Hexagon name. `fun` declares a callable export; `let`
declares a non-callable value. Unlike an ordinary Hexagon function declaration, an
extern `fun` has no body and says nothing about recursion.

Bindings are private unless individually exported:

```hexagon
extern from "tiny-json"
  export fun parse(text: String): JsonValue
```

This creates a named export from the compiled Hexagon module. It does not modify the
foreign package.

JavaScript default exports use `default` only inside an extern declaration:

```hexagon
extern from "client-library"
  default fun createClient(config: Config): Client
```

`createClient` is still an ordinary local name. Writing `export default fun ...` in the
extern block imports the JavaScript default and then re-exports the local binding as a
named Hexagon export; Hexagon modules themselves still have no default exports.

An effect-only foreign import is explicit:

```hexagon
extern import "telemetry/register"
```

It introduces no name and runs the foreign module's top-level effects. Foreign module
specifiers may be package names because they follow JavaScript resolution rather than
the relative `.hex` module rules.

## `Nullable` is the foreign nullish door

Hexagon does not make every type nullable. A JavaScript API that may return `null` or
`undefined` says so with `Nullable(a)`:

```hexagon
extern from "browser-profile"
  fun displayName(): Nullable(String)
```

`Nullable(a)` crosses with no wrapper and has the TypeScript face
`a | null | undefined`. It is not `Option(a)`. `Option` remains the ordinary Hexagon
union `Some(a) | None`, while `Nullable` describes foreign representation.

When both JavaScript absence values mean the same thing, convert once:

```hexagon
let name = Nullable.toOption(displayName())
```

When the API distinguishes them, preserve all three cases:

```hexagon
match Nullable.toCase(displayName())
  Undefined => "not supplied"
  Null => "explicitly blank"
  Value(name) => name
```

`Nullable.null` and `Nullable.undefined` supply explicit values to foreign calls.
There are no ambient `null` or `undefined` literals that can silently enter an ordinary
Hexagon type. Predicates such as `Nullable.isNull` return `Bool`; they do not introduce
TypeScript-style flow narrowing. Use `toOption` or `toCase` to extract the value.

Extern functions retain fixed arity. When a JavaScript API treats an omitted argument
as `undefined`, declare that position as `Nullable(a)` and pass
`Nullable.undefined` explicitly. The boundary does not add a second optional-argument
calling convention to Hexagon.

## `Array` is borrowed; `Vector` is persistent

`Array(a)` is the readonly foreign view of a JavaScript array. Its TypeScript face is
`ReadonlyArray<a>`, and crossing it does not copy:

```hexagon
extern from "score-service"
  fun recentScores(): Array(Int)
```

JavaScript owns the underlying storage. While Hexagon—or a deferred traversal created
from it—may still observe the array, foreign code must keep its length, order, and
elements stable. Hexagon deliberately exposes no mutation operation for `Array`.

Choose an explicit conversion when stable ownership matters:

```hexagon
let borrowed = recentScores()
let stable = Array.toVector(borrowed)
```

`Array.toVector` eagerly creates a persistent snapshot. `Vector.toArray` creates a
fresh JavaScript array. `Array.toSeq` is lazy and zero-copy under the same stability
contract; `Array.fromSeq` eagerly creates a fresh array.

This distinction prevents `ReadonlyArray<a>` from becoming an optimistic foreign name
for `Vector(a)`. One is borrowed JavaScript storage; the other is a Hexagon persistent
value.

## `Seq` strengthens an iterable at the boundary

JavaScript's iterable protocol includes both replayable collections and single-shot
generator objects. Neither shape alone promises Hexagon's persistent sequence
positions. A top-level extern declaration may nevertheless request `Seq(a)`:

```hexagon
extern from "number-stream"
  fun values(): Seq(Int)
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
  fun groups(): Array(Seq(Int)) // error: nested Seq adaptation would be hidden
```

The outer `Array` promises zero-copy indexing, while each arbitrary iterable inside
could need a new persistent adapter. Use an explicit conversion or a small JavaScript
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
  ): Nullable(String)
```

Hexagon sees an ordinary subject-first function:

```hexagon
SearchParams.get(params, "name")
params.get("name")
```

The emitted call restores JavaScript's receiver convention:

```js
params.get("name");
```

The first visible parameter is always the Hexagon subject. A first-class reference
such as `let lookup = SearchParams.get` receives a stable wrapper that continues to
call `params.get(key)` rather than detaching the JavaScript property function.

Properties use equally direct declarations:

```hexagon
extern from "web-response"
  export type Response
  export get status(response: Response): Int
  export set timeout as setTimeout(response: Response, value: Int): Unit
```

Every `get` call performs a fresh property read; foreign properties may vary, compute,
or throw. A `set` declaration grants an explicit write capability and returns `Unit`.
Merely declaring a getter does not make the property writable from Hexagon.

## Foreign classes remain foreign

An extern class describes a JavaScript class as one opaque foreign type plus companion
operations:

```hexagon
extern from "node:url"
  export class URL as Url
    new as create(text: String)
    static method canParse(text: String): Bool
    method toString(url: Url): String
    get hostname(url: Url): String
```

Hexagon calls `Url.create(text)`, `Url.canParse(text)`, `Url.toString(url)`, and
`Url.hostname(url)`. JavaScript receives `new URL(text)`, a static receiver call, an
instance receiver call, and a property read respectively.

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

  fun current(): Direction
  fun move(direction: Direction): Unit
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

Unlike an ordinary all-nullary union, whose values are constructor-name strings, this
foreign-backed union retains the actual member values. `Up` is `Direction.Up`—`"UP"`
in this example—and `move(Up)` passes that value straight back to JavaScript. Numeric,
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

The declaration is trusted. It promises that the listed properties exist, remain
stable, have distinct non-nullish values, and are the only values produced by foreign
functions typed as `Direction`. This keeps enum values representation-direct even
inside arrays, records, and callbacks. When the producer is genuinely uncertain, use
the generated checked conversion:

```hexagon
match fromJsDirection(rawValue)
  Some(direction) => describe(direction)
  None => "unknown direction"
```

`fromJsDirection` has type `(JsValue) -> Option(Direction)` and checks membership
against the captured foreign values. `toJsDirection` widens a known member to
`JsValue` without changing it. These are ordinary module bindings: for a local enum
named `T`, the generated names are `fromJsT` and `toJsT`. A name collision is a compile
error rather than a silently mangled public API.

An ordinary `extern class` remains opaque. Describing static singleton instances with
`extern enum` is an explicit stronger promise that the listed instances form a closed
set; it does not expose construction, inheritance, or arbitrary instances. TypeScript
`const enum` has no runtime object and therefore needs a JavaScript facade or an
explicit primitive binding. Bitflags are combinations rather than alternatives and
should cross as `Int` or an opaque foreign type.

## Direct callbacks keep their identity

A callback can cross unchanged when all of its parameter and result types are already
representation-direct:

```hexagon
extern from "event-source"
  type Event
  type Target

  fun addListener(target: Target, callback: (Event) -> Unit): Unit
  fun removeListener(target: Target, callback: (Event) -> Unit): Unit
```

Passing the same Hexagon function to both operations passes the same JavaScript
function object. Arguments retain their declared order, `Unit` returns as `undefined`,
and any JavaScript-supplied callback `this` is ignored because Hexagon has no binding
for it.

A callback whose nested signature would require adaptation is rejected. For example,
`(Seq(Int)) -> Unit` would need a fresh persistent wrapper on every invocation, raising
lifetime and identity questions. Bind a representation-direct callback and convert at
an explicit point, or place a small JavaScript adapter beside the foreign library.

## Collection conversions are shallow

Conversions name the one outer representation they change:

```hexagon
let jsScores = Map.toJsMap(scores)
let copiedBack = Map.fromJsMap(jsScores)

let jsGuests = Set.toJsSet(guests)
let copiedGuests = Set.fromJsSet(jsGuests)
```

These are snapshots between persistent Hexagon collections and foreign mutable
JavaScript collections. They do not share table storage. Conversion is shallow: keys,
elements, and values retain their declared runtime identities rather than undergoing
an automatic recursive graph conversion.

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
  JavaScript module vocabulary;
- representation-direct values cross unchanged, while explicit narrowing operations
  perform checks;
- `Nullable(a)` is the nullish foreign door and remains distinct from `Option(a)`;
- `Array(a)` is a zero-copy readonly borrow, while `Vector(a)` is persistent storage;
- a top-level foreign iterable may be adapted into a persistent memoized `Seq(a)`;
- `method`, `get`, `set`, and `class` produce ordinary subject-first Hexagon companion
  operations while preserving JavaScript calling conventions;
- `extern enum` gives stable foreign object members a closed nullary-union view while
  retaining their original JavaScript values;
- representation-direct callbacks cross with stable function identity;
- collection conversions are explicit and shallow; and
- foreign throws use `JsError`, while uncertain `JsValue` data requires explicit
  decoding.

Ordinary values now cross in both directions with their costs and trust visible. The
final chapter handles the unusual exported function whose type still depends on a
constraint: it must offer direct concrete calls without making generic JavaScript
callers guess how Hexagon instance selection works.
