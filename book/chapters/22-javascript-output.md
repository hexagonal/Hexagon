# JavaScript Output

Hexagon is not interpreted by a hidden virtual machine. It compiles to JavaScript, and
the JavaScript is intended to remain recognizable to a person reading a stack trace,
debugging a production build, or reviewing generated code.

Readable output does not mean that every source line receives a mechanical textual
substitution. Pattern matching needs tests; persistent vectors need a persistent
runtime representation; Unicode codepoint access cannot use JavaScript's code-unit
brackets. It means that the output tells the same story as the source without hiding
ordinary behavior behind unnecessary machinery.

## Native values stay native

Hexagon's primitive values are already JavaScript values:

| Hexagon | JavaScript |
| --- | --- |
| `Int`, `Float` | `number` |
| `BigInt` | `bigint` |
| `Bool` | `boolean` |
| `String` | `string` |
| `Unit` | `undefined` |

The compiler keeps native operations when JavaScript has the required semantics:

```hexagon
let circumference(radius: Float): Float = 2.0 * 3.14 * radius
let welcome(name: String): String = "Hello, ${name}!"
```

```js
const circumference = radius => 2.0 * 3.14 * radius;
const welcome = name => `Hello, ${name}!`;
```

Hexagon does not box numbers to remember their source types. The checker has already
done that work. Where the languages differ—Euclidean integer division, codepoint
indexing, checked collection access—the compiler emits an explicit operation that
preserves Hexagon's rule rather than using a deceptively similar JavaScript operator.

## Functions keep their calling shape

Ordinary `let`-bound functions emit as arrow functions. Recursive `fun` declarations
emit as hoisted function declarations:

```hexagon
let double(x: Int): Int = x * 2

fun factorial(n: Int): Int =
  if n == 0 then 1 else n * factorial(n - 1)
```

```js
const double = x => x * 2;

function factorial(n) {
  return n === 0 ? 1 : n * factorial(n - 1);
}
```

N-ary Hexagon functions remain n-ary JavaScript functions in the same argument order.
There is no curried wrapper, tuple packing, implicit `this`, or object allocation around
an ordinary call.

Blocks become JavaScript blocks, with their final value returned when the surrounding
expression needs it. Local `var` and `:=` become JavaScript `let` and assignment. The
restrictions Hexagon checked—such as the lambda boundary around mutable variables—need
no runtime policing after a program is accepted.

## Types erase when values need nothing extra

Removing a compile-time distinction from output is called **erasure**. Type
annotations, inferred type variables, and transparent aliases normally erase because
JavaScript evaluates values rather than Hexagon type expressions.

```hexagon
type Coordinates = (Float, Float)

let position: Coordinates = (3.0, 4.0)
```

```js
const position = [3.0, 4.0];
```

Tuples are ordinary arrays. Structural records are ordinary objects:

```hexagon
let guest = {name: "Mira", seats: 3}
let expanded = {...guest, seats: 4}
```

```js
const guest = {name: "Mira", seats: 3};
const expanded = {...guest, seats: 4};
```

A nominal record is also the plain object at runtime. Applying its constructor
directly records a source-level identity but needs no wrapper:

```hexagon
record Point = {x: Float, y: Float}
let point = Point({x: 3.0, y: 4.0})
```

```js
const point = {x: 3.0, y: 4.0};
```

If the constructor itself is used as a first-class function, the compiler can emit the
honest identity function `value => value`. The wrapper appears only because JavaScript
then needs a function value.

## Unions remain visible data

A union with any payload-carrying constructor emits every alternative as a tagged
plain object. Consider:

```hexagon
export union Delivery =
  Waiting
  | Sent(tracking: String)
  | Arrived

export let describe(delivery: Delivery): String =
  match delivery
    Waiting => "waiting"
    Sent(tracking) => "sent as ${tracking}"
    Arrived => "arrived"
```

The generated JavaScript has this general shape:

```js
export const Waiting = {tag: "Waiting"};
export const Sent = tracking => ({tag: "Sent", tracking});
export const Arrived = {tag: "Arrived"};

export const describe = delivery => {
  switch (delivery.tag) {
    case "Waiting": return "waiting";
    case "Sent": return `sent as ${delivery.tracking}`;
    case "Arrived": return "arrived";
  }
};
```

The tag is readable in a debugger. Named payloads remain named fields. Nullary values
inside a mixed union are shared objects because immutable union values have no
observable identity.

When every constructor is nullary, the smaller honest representation is a string:

```hexagon
union Direction = North | East | South | West
```

`North` emits as `"North"`, and a match becomes a switch over strings. Adding the
first payload constructor later changes this external representation to tagged
objects, which is one reason public union evolution deserves care.

## Source conveniences become direct calls

Pipes preserve first-argument insertion:

```hexagon
dishes |> rinse |> wash |> dry
```

```js
dry(wash(rinse(dishes)));
```

Dot calls resolve to companion functions before JavaScript emission:

```hexagon
possibleName.getOrElse("Guest")
```

```js
getOrElse(possibleName, "Guest");
```

Neither form introduces a runtime pipeline or method lookup. JavaScript receives the
ordinary function composition that the Hexagon source expressed more fluently.

Pattern matching likewise becomes tests, field reads, and local bindings. The compiler
has already checked exhaustiveness and reachability, so it need not ship a runtime
pattern engine or pattern objects.

## Generated capabilities become ordinary code

Derivation generates the same kind of instance operations that a programmer could
write directly. A derived record equality becomes field comparisons; a union display
operation becomes a tag switch. There is no reflection over field names at each call.

At a concrete use, constraints also disappear into the selected operation. Integer
addition remains `+`, and equality for an ordinary primitive uses the implementation
required by its known `Eq` instance.

Only genuinely generic JavaScript needs to receive operations as data. The source:

```hexagon
let labelled<a: Show>(value: a): String = "Value: ${value}"
```

may retain a trailing dictionary parameter:

```js
const labelled = (value, showDict) => `Value: ${showDict.show(value)}`;
```

The original value parameters stay in their source order. Dictionary evidence follows
them as explicit compiler plumbing rather than altering the subject-first calling
convention. The later Constrained Exports chapter explains when such a generic edition
becomes part of a public JavaScript API.

## Runtime support should be visible when it matters

Some Hexagon values promise semantics that native JavaScript values do not provide.
Those values use the Hexagon runtime openly:

```hexagon
let numbers = [1, 2, 3]
let changed = Vector.set(numbers, 2, 20)
```

```js
import { Vector } from "@hexagon/runtime";

const numbers = Vector.of(1, 2, 3);
const changed = Vector.set(numbers, 2, 20);
```

Using a native array here would falsely suggest mutable updates and different indexing
behavior. `Map` and `Set` likewise remain persistent runtime values rather than native
mutable tables.

`Seq` uses JavaScript's iterable protocol, with adaptation where necessary to preserve
the functional cursor rule that calling `Seq.next` does not consume the supplied
position. Syntactic integer ranges in loops still emit as direct counting loops rather
than allocating range or sequence objects.

Hexagon exceptions are genuine JavaScript `Error` objects with visible brand, name,
and payload fields. A small helper or emitted test preserves implicit rethrow and the
distinction between Hexagon exceptions and foreign thrown values. Generated exception
classes and deep `instanceof` hierarchies are unnecessary.

The principle is not “never use a runtime.” It is “use runtime support exactly where
the value's promised semantics require it, and leave the call visible.”

## Evaluation order survives translation

Hexagon evaluates operands, arguments, record fields, tuple elements, and collection
elements left to right. The emitter preserves that order even when it rewrites the
surrounding expression.

Comparison chains are a useful example:

```hexagon
lower() <= value() <= upper()
```

Each operand runs once. Generated temporaries may appear so JavaScript neither repeats
`value()` nor changes the source order. Those names are evidence of the semantic rule,
not accidental noise.

The same honesty applies to loops and matches: a loop source evaluates once; a match
scrutinee evaluates once; a pipe does not duplicate its subject.

## The module graph remains ESM

One Hexagon module becomes one ESM module. Named exports remain named exports, private
bindings remain local, and import dependencies remain visible:

```hexagon
import { prepare } from "./prepare"
import "./telemetry"

export let run(order: Order): Receipt = prepare(order)
```

```js
import { prepare } from "./prepare.js";
import "./telemetry.js";

export const run = order => prepare(order);
```

Because Hexagon import graphs are acyclic, the emitted graph does not rely on
JavaScript's partially initialized cycle behavior. ESM itself performs the dependency
loading and top-level execution described in the Modules chapter.

## Readable does not mean public

Generated JavaScript contains implementation details needed to run the program. A
private helper may remain plainly visible in the file, and a compiler-generated
dictionary may have an understandable name, but neither fact makes it a supported API.

The public contract is the module's exports together with its generated TypeScript
declaration. Read the JavaScript to understand behavior; read the `.d.ts` to understand
what another JavaScript or TypeScript module is invited to depend on.

## Summary

- primitive values, ordinary functions, tuples, records, and ESM structure stay close
  to native JavaScript;
- erasure removes type-only distinctions when runtime values need no representation;
- unions remain readable tagged objects, or strings when every constructor is nullary;
- pipes and dot calls become ordinary calls, while patterns become ordinary tests;
- derivation generates direct operations instead of runtime reflection;
- genuinely generic constrained code may retain trailing dictionary evidence;
- persistent collections and functional sequences use explicit runtime support where
  native JavaScript would provide different semantics;
- generated code preserves single evaluation and left-to-right order; and
- readable implementation output is distinct from the supported public API.
