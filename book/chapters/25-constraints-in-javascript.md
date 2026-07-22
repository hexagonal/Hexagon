# Constraints in JavaScript

Inside Hexagon, the type checker chooses the instance for a constrained call. JavaScript
does not have Hexagon's instance system, so the required operations must become
ordinary JavaScript values.

In JavaScript, a Hexagon constraint is represented by a small object containing the
operations required by that constraint. This object is called a **constraint
dictionary**.

For example, ignoring its private compiler brand, a generated `Eq<Customer>`
dictionary has the general shape:

```js
const customerEq = Object.freeze({
  equals: (left, right) => left.id === right.id,
  notEquals: (left, right) => !customerEq.equals(left, right),
});
```

A generic function can receive this object and call `customerEq.equals(...)`. There is
no runtime search, prototype lookup, or hidden class hierarchy. It is a JavaScript
object containing functions. **Dictionary** describes the object's job; it is not a
special kind of JavaScript object. Hexagon generates these dictionaries from lawful
instances rather than asking JavaScript callers to invent competing ones.

Most JavaScript callers should not have to pass a dictionary for ordinary primitive
types. Hexagon therefore gives constrained exports two complementary forms:

- direct named functions for fundamental types; and
- one dictionary-taking generic function for public user types.

## Fundamental types receive direct functions

Consider:

```hexagon
export let plus<a: Num>(left: a, right: a): a = left + right
```

Hexagon gives JavaScript callers direct functions for the fundamental numeric types:

```ts
export declare function plusNat(left: number, right: number): number;
export declare function plusInt(left: number, right: number): number;
export declare function plusFloat(left: number, right: number): number;
export declare function plusBigInt(left: bigint, right: bigint): bigint;
```

The complete fundamental set is:

```text
Nat  Int  Float  BigInt  Bool  String  Unit
```

This is a fixed language category. Records, unions, arrays, sequences, collections, and
user-defined types do not become fundamental merely because their JavaScript
representation happens to be simple.

Each constraint selects the fundamental types that actually honor it. `Num` applies to
`Nat`, `Int`, `Float`, and `BigInt`, so `plus` receives exactly those four functions. Another
constraint may produce a different subset.

The generated name preserves a distinction that TypeScript cannot express in its type
alone. `plusInt` and `plusFloat` both accept `number`, but they promise different
Hexagon semantics.

## Direct really means direct

Representative JavaScript for `plus` is unsurprising:

```js
export function plusNat(left, right) {
  return left + right;
}

export function plusInt(left, right) {
  return left + right;
}

export function plusFloat(left, right) {
  return left + right;
}

export function plusBigInt(left, right) {
  return left + right;
}
```

These functions take no dictionaries. They are not wrappers around a generic function
that performs dictionary calls internally. The compiler emits the concrete operation
for each type.

Direct code must still preserve Hexagon's semantics. For example, `Eq<Float>` treats
`NaN` as equal to itself. Its generated equality cannot use bare JavaScript `===`, even
though `===` would be shorter. Removing dictionary plumbing must not change the
language's rules.

## Several constrained types produce combinations

When a function has several constrained type variables, every permitted fundamental
combination receives a direct function. For a function whose first variable admits
`Int`, `Float`, and `BigInt`, and whose second admits `String`, `Bool`, and `Unit`, the
names include:

```text
combineIntString
combineFloatBool
combineBigIntUnit
```

Only combinations that satisfy every stated constraint are generated. An unconstrained
type variable stays generic and contributes no name suffix.

Renaming a type variable from `a` to `value` cannot change the JavaScript API. The
declared variable positions determine the suffix order; the variable spellings do not.

## User types use the generic function

Named functions cover the bounded fundamental set. Public user types share one generic
function under the original source name:

```ts
export declare function plus<a>(
  left: a,
  right: a,
  num: Num.Dictionary<a>,
): a;
```

The final `num` parameter is a constraint dictionary. The JavaScript implementation
uses its operations:

```js
export function plus(left, right, num) {
  return num.add(left, right);
}
```

A public `Rat` type with a public `Num<Rat>` dictionary can call it like this:

```ts
plus(half, third, Rat.num);
```

The generic function appears only when JavaScript can obtain every dictionary it needs
and at least one of them is for a non-fundamental type. If the necessary dictionaries
are private, exporting the function would give JavaScript callers an unusable entry
point, so the generic function is omitted.

The original source name remains reserved for this generic form even while it is
absent. Direct functions always carry type suffixes such as `plusNat` and `plusInt`.

## Dictionary types describe their objects

Each constraint owns a distinct TypeScript dictionary type:

```ts
Num.Dictionary<a>
Signed.Dictionary<a>
Eq.Dictionary<a>
Show.Dictionary<a>
```

There is no universal dictionary whose contents are guessed at runtime. The TypeScript
type states exactly which functions the object contains.

A dictionary contains the constraint's complete operation set, including operations
with defaults. `Eq.Dictionary<a>` therefore contains both `equals` and `notEquals`,
even when the Hexagon instance inherited `notEquals`:

```ts
declare const eqDictionaryBrand: unique symbol;

export interface Dictionary<a> {
  readonly [eqDictionaryBrand]: a;
  readonly equals: (left: a, right: a) => boolean;
  readonly notEquals: (left: a, right: a) => boolean;
}
```

The private TypeScript brand prevents an unrelated object with coincidentally similar
fields from being accepted accidentally. Ordinary calls remain trusted boundary calls;
Hexagon does not deeply inspect every dictionary object at runtime. Compiler-produced
dictionaries should be frozen where practical.

## Dictionaries have predictable homes

Fundamental dictionaries live with the constraint:

```ts
Num.nat
Num.int
Num.float
Num.bigInt
Signed.int
Signed.float
Signed.bigInt
Eq.string
Show.bool
```

A public user-type dictionary lives with that type under the lowercase constraint
name:

```ts
Rat.num
Rat.signed
Customer.eq
Customer.show
```

These are ordinary ESM exports from companion modules. `Rat.num` is module
qualification, not a property installed on a global `Rat` object or prototype.

Some dictionaries depend on other dictionaries. Hexagon exports an ordinary factory
function for them:

```ts
Vector.show(Show.string)
Option.eq(Eq.int)
Map.show(Show.string, Show.int)
```

`Vector.show(Show.string)` returns the dictionary for `Show<Vector(String)>`. The
factory takes the element dictionary needed to build the collection dictionary.

## Dictionary parameters come last

Ordinary source parameters retain their order. Dictionary parameters are appended at
the right edge:

```hexagon
export let inspect<a: (Eq, Show), b: Ord>(subject: a, other: b): String = ...
```

```ts
export declare function inspect<a, b>(
  subject: a,
  other: b,
  eqA: Eq.Dictionary<a>,
  showA: Show.Dictionary<a>,
  ordB: Ord.Dictionary<b>,
): string;
```

This preserves Hexagon's subject-first convention:

```text
subject and ordinary arguments first
constraint dictionaries last
```

Pipes and dot calls keep supplying the first ordinary argument. Generating a direct
function removes only the dictionary parameters; it never moves a source parameter.

Dictionary order is stable: declared type-variable position first, then constraint
name. A superconstraint is stored inside the more specific dictionary. An
`Ord.Dictionary<a>` therefore includes its required `Eq.Dictionary<a>`, and a caller
passes the `Ord` dictionary rather than repeating both.

## Public declarations determine the JavaScript API

The generated JavaScript surface depends on:

- the module's exported constrained functions; and
- the public dictionaries available in the compiled program.

It does not depend on private types, private dictionaries, or which calls happen inside
Hexagon. Removing the last internal use of `plus(Int, Int)` does not remove `plusNat` and `plusInt`.
Adding a private `Num<Secret>` instance does not add the generic `plus` function.

JavaScript callers are invisible to Hexagon's analysis of internal calls. Keeping the
foreign surface tied to public declarations makes it stable under private refactoring.

A constrained export may have no JavaScript entry point. This happens when no
fundamental type honors its constraint and JavaScript cannot obtain dictionaries for a
public user type. The export remains usable by other Hexagon modules. Generated
documentation and build reports identify the missing JavaScript surface.

## Generated names are public API

A direct-function name is the source export name followed by its fundamental type
names:

```text
plus + Int = plusInt
combine + Int + String = combineIntString
```

If a generated name collides with an explicit export or another generated name, the
compiler reports an error naming both declarations. It never silently adds numbers,
mangles the name, or chooses one export by source order.

Renaming the source function renames every generated function. Changing constraints,
fundamental instances, public dictionaries, dictionary members, factory parameters, or
dictionary-parameter order can also change the JavaScript and TypeScript API. Packages
that exchange dictionaries must use compatible Hexagon runtime dictionary formats.

## Summary

- a constraint dictionary is a JavaScript object containing the operations required by
  one Hexagon constraint;
- exported constrained functions receive direct dictionary-free functions for every
  permitted fundamental-type combination;
- the fundamental set is `Nat`, `Int`, `Float`, `BigInt`, `Bool`, `String`, and `Unit`;
- generated names append fundamental type names in declared variable order;
- unconstrained type variables remain generic and add no suffix;
- public user types share a generic function under the original source name;
- generic dictionary parameters come after all ordinary source parameters;
- dictionary types describe complete, branded operation objects;
- fundamental dictionaries live with constraints, user dictionaries live with types,
  and dependent dictionaries are created by factories;
- private implementation choices never reshape the JavaScript API; and
- generated names and dictionary shapes are public compatibility commitments.

Ordinary concrete calls remain direct. Genuinely generic JavaScript calls remain
possible by passing small, explicit objects containing the required operations.
