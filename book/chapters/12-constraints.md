# Constraints

A function that displays a value does not need to know every possible displayable
type. It needs one particular capability:

```hexagon
export let labelled<a: Show>(value: a): String = "Value: ${value}"

let countLabel = labelled(3)
let nameLabel = labelled("Mira")
```

`<a: Show>` says that `a` may be any type with a `Show` **instance**. `Show` is a
**constraint**: a named obligation on a type. An instance supplies the operations that
discharge that obligation for one family of types.

This is **constrained polymorphism**. `labelled` remains generic, but not indiscriminate:
it accepts exactly the types Hexagon knows how to display.

## Constraints often arrive through inference

The exported annotation above publishes and pins the relationship, but a private
helper leaves its constraints to inference:

```hexagon
let labelled(value: a) = "Value: ${value}"
```

String interpolation uses `show`, so the inferred type says that the argument type
must honor `Show`. Operators behave similarly. `x == y` requires `Eq`; addition and
multiplication require `Num`; subtraction and negation require `Signed`; ordering
comparisons require `Ord`.

Write an explicit binder when the capability is important documentation or when a
signature should deliberately be no more general:

```hexagon
export let smaller<a: Ord>(left: a, right: a): a =
    if left < right then left else right
```

Several obligations use the familiar parenthesized list:

```hexagon
export let describeEqual<a: (Eq, Show)>(left: a, right: a): String =
    if left == right then "Both are ${left}" else "They differ"
```

The angle brackets introduce a type variable and its obligations. Parentheses still
apply a type constructor: `Option(a)` is a type, while `<a: Show>` introduces a type
variable that must be displayable.

A written binder list is a contract, not a starting point for inference to
strengthen. If a body uses `value.hash()`, `<a: Eq>` is rejected because `Eq` does not
provide `Hash`; the canonical repair is `<a: Hash>`. In the other direction,
`<a: Hash>` already provides `Eq` through its base constraint, so equality needs no
repeated `Eq` entry. (The one written constraint list that *is* a starting point is a
type hole's — the polymorphism chapter's `Vector(_ : Num)` — a floor inference may
build past, because a hole claims no scheme for a contract to complete.)

## A constraint declares the required operations

Programs may define capabilities of their own:

```hexagon
constraint Area<a> =
    area(value: a) -> Float
    describeArea(value: a) -> String = "Area: ${area(value)}"
```

The subject `a` is the type being described. A member without a body is required, so
every `Area` instance must provide `area`. A member with a body is a **default
operation**. Every `Area` instance receives `describeArea` automatically unless it
overrides that operation.

The arrow before each result is the member's **effect contract**. A member header has no
body to infer an effect from, so it writes one: `-> Float` promises callers a pure
operation, and every `Area` instance's `area` must check pure. A member may promise less —
`read(source: a) ->! String` says an instance *may* read the world — and the contract is
then a ceiling, not a description: an instance whose body never touches the world honors
it, an instance that does honors it too, and neither changes what a caller sees. Every
call through the member — bare, qualified, or with a dot — wears the contract's mark,
the `!` the Effects chapter introduces, so `source.read!()` is spelled the same
whichever instance answers. That chapter has the effect discipline itself; what matters
here is that the constraint, not the instance, decides the mark.

Use either operation like an ordinary function:

```hexagon
let reportArea(shape: a) =
    describeArea(shape)
```

The default calls the `area` operation from whichever instance is in use. Call
`area(shape)` or `describeArea(shape)` directly — and on a value whose type is known,
the dot spelling works too: `shape.area()` means the same call. Constraint members are
ordinary functions either way, not object methods; the Dot Calls chapter explains how
the dot finds them.

## `honor` supplies an instance

Suppose a program declares a nominal rectangle:

```hexagon
record Rectangle = {width: Float, height: Float}

honor Area<Rectangle> =
    area(rectangle) = rectangle.width * rectangle.height
```

The declaration reads naturally: this program **honors** the `Area` obligation for
`Rectangle`. The compiler already knows the required member type from the constraint,
so annotations inside the `honor` block are usually redundant. `Rectangle` inherits
the default `describeArea`; only the required `area` operation must be written.

An instance may override a default when it can provide a more useful or more efficient
version:

```hexagon
honor Area<Rectangle> =
    area(rectangle) = rectangle.width * rectangle.height
    describeArea(rectangle) =
        "${rectangle.width} × ${rectangle.height}: ${area(rectangle)} square units"
```

This is an alternative to the preceding instance, not a second instance: coherence
still permits only one `Area<Rectangle>` declaration. Calls made by a default or
override use the completed instance, including any other overridden operations.

Every required member must appear exactly once. A misspelling is not a new helper:

```hexagon
honor Area<Rectangle> =
    arrea(rectangle) = rectangle.width * rectangle.height
// error: Area has no member arrea; the instance is missing area
```

## Equality provides a default inequality

The prelude uses the same mechanism for `Eq`:

```hexagon
constraint Eq<a> =
    equals(left: a, right: a) -> Bool
    notEquals(left: a, right: a) -> Bool = not equals(left, right)
```

An `Eq` instance must supply `equals`. It normally inherits `notEquals`, and the `!=`
operator calls that operation. An instance may override `notEquals` for efficiency,
but the meaning must remain the same:

```text
notEquals(left, right) == not equals(left, right)
```

Hexagon does not define equality and inequality recursively in terms of each other.
There is one required foundation and one reusable default, so omitting both can never
produce an accidental recursive loop.

That safeguard does not prove that every user-written default will finish. Defaults
are ordinary functions and may call other operations in the same constraint. If two
defaults do nothing but call each other and an instance inherits both, calling either
will recurse forever. Keep defaults grounded in required operations, as `notEquals` is
grounded in `equals`.

An instance is not a value. It has no name to pass around, cannot be declared inside a
function, and cannot be selected manually at a call site. Hexagon selects it from the
constraint and the subject type.

Parameterized types can have parameterized instances. Their binders state what must be
true of the contained types:

```hexagon
honor<a: Show> Show<Box(a)> =
    show(box) = "Box(${box.value.show()})"
```

Read the header in two parts:

```hexagon
<a: Show>
```

This introduces the contained type `a` and requires it to have a `Show` instance.
Then:

```hexagon
Show<Box(a)>
```

states the new obligation being supplied: a `Show` instance for `Box(a)`.

The body provides `Show`'s required member:

```hexagon
show(box) = "Box(${box.value.show()})"
```

The outer `show` defines how to display the box. The inner `box.value.show()` displays
the value inside it, using the `Show<a>` instance required by the first part of the
header. Why the dot call and not a bare `show(box.value)`? Inside this body, `show` is
the very member being defined, and a member never calls its own name. Recursion into
`Show` is spelled through dispatch instead: the dot call says "use the instance for
this value's type," which is exactly what is meant.

Put together, the declaration says: **if `a` can be displayed, then `Box(a)` can be
displayed**. `Box(Int)` uses the existing `Show<Int>` instance; `Box(String)` uses
`Show<String>`.

## A constraint may require another constraint

Ordering must agree with equality, so the prelude declares `Ord` with `Eq` as a
**base constraint**:

```hexagon
constraint Ord<a: Eq> =
    compare(left: a, right: a) -> Ordering
```

Read the header from left to right: `Ord` extends `Eq`. A function requiring `Ord` may
therefore use both `compare` and `equals`, and a type cannot honor `Ord` unless it also
has an `Eq` instance.

The numeric hierarchy uses the same mechanism:

```hexagon
constraint Num<a> =
    add(left: a, right: a) -> a
    multiply(left: a, right: a) -> a
    fromNat(value: Nat) -> a

constraint Signed<a: Num> =
    subtract(left: a, right: a) -> a
    negate(value: a) -> a
    fromInt(value: Int) -> a

constraint Frac<a: Signed> =
    divide(left: a, right: a) -> a
```

Nat honors Num but not Signed. Int, Float, BigInt, Rat, and Dec honor both. A function that
only adds or multiplies is consequently as general as it honestly can be, while a
Signed dictionary carries its Num dictionary in one parent slot rather than requiring
two independent dictionary parameters. Float and Rat additionally honor Frac: Float
division follows IEEE 754, while Rat division is exact. Int and BigInt keep their named
division families because their quotient conventions need to remain explicit. Dec
also omits Frac: its division requires a requested decimal-place count.

`FromBigInt` adds a different promise: the type can represent every integer
exactly, subject to available resources.

```hexagon
constraint FromBigInt<a: Signed> =
    fromBigInt(value: BigInt) -> a
```

BigInt, Rat, and Dec honor it; Int and Float do not. An independently established
destination with this capability can receive BigInt values automatically:

```hexagon
let scale<a: FromBigInt>(count: BigInt, value: a): a = count * value
```

The bound supplies both exact integer conversion and Signed's arithmetic. A
Signed bound alone would not suffice: it only promises conversion from Int.
Rat and Dec delegate their Nat and Int conversion entries through BigInt to each
type's exact constructor. Declaring an ordinary function named `fromBigInt` does not opt a
type into automatic conversion; the constraint instance carries that promise.

`Ordering` is the union:

```hexagon
union Ordering = Less | Equal | Greater
```

Returning a union rather than a magic negative, zero, or positive integer makes all
three outcomes explicit and exhaustively matchable.

## Instances are read top-down

An instance is read where its `honor` is written, the way a function is read where it
is defined (chapter 3). Code below the honor can use the instance; code above it
cannot:

```hexagon
record Point = {x: Int, y: Int}

let early(point: Point): String = "${point}"
// error: `Show<Point>` is used here, and its honor is declared below it;
//        declarations are read top-down — move the honor above this use

honor Show<Point> =
    show(point) = "(${point.x}, ${point.y})"

let late(point: Point): String = "${point}"   // fine
```

Every way of relying on an instance counts as a use: interpolation, an operator, a
member call in any spelling, and a generic call such as `sort(points)` that is handed
the instance. So does another honor that builds on it: `honor Ord<Point>` stands below
`honor Eq<Point>`, because `Ord` requires `Eq`. Types are different. `Point` may appear
in a type annotation anywhere in the module, above or below its declaration, because a
type does nothing when the module runs.

An honor's own body sees its own instance. A recursive type can display its parts with
the instance being defined:

```hexagon
union Tree = Leaf | Node(Tree, Int, Tree)

honor Show<Tree> =
    show(tree) = match tree
        Leaf => "."
        Node(left, value, right) => "(${left} ${value} ${right})"
```

Interpolating `left` and `right` uses `Show<Tree>` inside its own honor. Like a `fun`,
an honor is a **knot**: its body may refer to what it defines. The member still never
calls its own name, as `Box` showed; recursion goes through the instance.

When two honors need each other, neither can stand above the other. Declare them
together in an **honor group**: `honor` on a line of its own, with the instances
indented below it and written without the keyword:

```hexagon
record Ping = {label: Int, next: Option(Pong)}
record Pong = {label: Int, back: Option(Ping)}

honor
    Show<Ping> =
        show(ping) = match ping.next
            Some(pong) => "Ping(${ping.label} ${pong})"
            None => "Ping(${ping.label})"
    Show<Pong> =
        show(pong) = match pong.back
            Some(ping) => "Pong(${pong.label} ${ping})"
            None => "Pong(${pong.label})"
```

Inside the group each instance sees the other, in either order, as the members of a
`fun` block see each other, and code below the group sees both. A group is for honors
that really call each other. When one honor merely relies on another, order them
instead, and write the one it relies on first.

## One type gets one answer

Hexagon permits at most one instance for each constraint and type constructor in the
whole program. There cannot be two competing definitions of `Ord<Rectangle>` whose
selection depends on imports or call-site context.

This property is called **coherence**: the same constrained operation has the same
meaning everywhere. It protects more than aesthetics. A map or set cannot safely be
built with one notion of equality and queried with another.

The **orphan rule** prevents conflicts from being created at a distance. An `honor`
declaration for a constraint and type must live in either:

- the module that declares the constraint; or
- the module that declares the type.

This leaves each library a legitimate place to supply an instance while preventing an
unrelated third module from inventing a competing answer. Instances are not imported
or exported individually; once their module is part of the program, they participate
globally.

Instance heads remain deliberately simple. They describe one type constructor, such
as `Rectangle` or `Box(a)`, rather than special cases such as `Box(Int)`. Instance
selection is therefore a lookup, not an open-ended search.

## The prelude constraints form a small vocabulary

The important organizing ideas are more useful than a catalogue of member functions:

| Constraint | Capability |
| --- | --- |
| `Eq` | equality |
| `Ord` | total ordering, with `Eq` |
| `Show` | human-readable display |
| `Num`, `Signed`, `Frac`, `Integral` | numeric operations at different levels |
| `FromBigInt` | exact construction from arbitrary integers, with `Signed` |
| `Concat`, `Pow` | concatenation and exponentiation |
| `Hash` | hashing consistent with equality for hashed collections |
| `Iterable` | producing values for iteration |

An operator or library function may introduce one of these obligations through
inference. The error names the missing instance and the operation that required it.
Later chapters will meet `Hash` and `Iterable` through collections and loops, where
their purpose is concrete. Ordinary iteration uses concrete source types, while
reusable consumers take `Seq(a)` so their element type remains explicit.

## Concrete code remains concrete

Conceptually, a polymorphic function receives a small object containing the operations
its constraints require. Such an object is called a **dictionary**. In genuinely
generic emitted JavaScript, it may be visible:

```js
const labelled = (value, showDict) => `Value: ${showDict.show(value)}`;
```

Source arguments remain in their original order; any dictionary arguments follow them
as a trailing implementation detail. This preserves the subject-first position used
by ordinary calls, pipes, and later dot calls.

At a call whose type is already known, Hexagon selects the instance at compile time and
uses the direct operation. Integer addition remains `+`; displaying an integer remains
an ordinary conversion. Dictionary objects are plumbing for code that truly remains
polymorphic, not a tax placed on every value.

Constraints and instances do not become TypeScript interfaces or runtime classes.
Ordinary generated `.d.ts` files describe the callable JavaScript surface; they contain
nothing instance-shaped. The later FFI chapters handle the special choices involved in
exporting constrained polymorphic functions.

## Summary

- a constraint names operations required of a type;
- `<a: Show>` introduces a type variable with a `Show` obligation;
- constraints are inferred from interpolation, operators, and constrained calls;
- constraint operations with bodies provide overridable defaults;
- a member's arrow is its **effect contract**: a ceiling every instance is compared
  against, and the mark every call through the member wears;
- `Eq.equals` is required and `Eq.notEquals` defaults to its Boolean negation;
- an `honor` declaration supplies the unique instance of a constraint for a type;
- an instance is used below its `honor`; an honor's body sees its own instance, and
  honors that need each other form an honor group;
- a base constraint is an obligation that another constraint builds on;
- coherence gives every constraint/type pair one program-wide meaning;
- the orphan rule places an instance with either its constraint or its type; and
- dictionaries appear only where JavaScript must preserve genuine polymorphism.

Writing every structural member by hand would become repetitive. The next chapter
shows how nominal records and unions can ask the compiler for lawful standard
instances while keeping that choice explicit.
