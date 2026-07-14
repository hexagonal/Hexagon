# Constraints

A function that displays a value does not need to know every possible displayable
type. It needs one particular capability:

```hexagon
let labelled<a: Show>(value: a): String = "Value: ${value}"

let countLabel = labelled(3)
let nameLabel = labelled("Mira")
```

`<a: Show>` says that `a` may be any type with a `Show` **instance**. `Show` is a
**constraint**: a named obligation on a type. An instance supplies the operations that
discharge that obligation for one family of types.

This is **constrained polymorphism**. `labelled` remains generic, but not indiscriminate:
it accepts exactly the types Hexagon knows how to display.

## Constraints often arrive through inference

The annotation above documents the relationship, but Hexagon can infer it:

```hexagon
let labelled(value) = "Value: ${value}"
```

String interpolation uses `show`, so the inferred type says that the argument type
must honor `Show`. Operators behave similarly. `x == y` requires `Eq`; arithmetic such
as `x + y` requires `Num`; ordering comparisons require `Ord`.

Write an explicit binder when the capability is important documentation or when a
signature should deliberately be no more general:

```hexagon
let smaller<a: Ord>(left: a, right: a): a =
  if left < right then left else right
```

Several obligations use the familiar parenthesized list:

```hexagon
let describeEqual<a: (Eq, Show)>(left: a, right: a): String =
  if left == right then "Both are ${left}" else "They differ"
```

The angle brackets introduce a type variable and its obligations. Parentheses still
apply a type constructor: `Option(a)` is a type, while `<a: Show>` introduces a type
variable that must be displayable.

## A constraint declares the required operations

Programs may define capabilities of their own:

```hexagon
constraint Area<a> =
  area(value: a): Float
  describeArea(value: a): String = "Area: ${area(value)}"
```

The subject `a` is the type being described. A member without a body is required, so
every `Area` instance must provide `area`. A member with a body is a **default
operation**. Every `Area` instance receives `describeArea` automatically unless it
overrides that operation.

Use either operation like an ordinary function:

```hexagon
let reportArea<a: Area>(shape: a): String =
  describeArea(shape)
```

The default calls the `area` operation from whichever instance is in use. Call
`area(shape)` or `describeArea(shape)` directly. Constraint members are not object
methods and do not use dot-call syntax. That distinction will matter in the Dot Calls
chapter.

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
  equals(left: a, right: a): Bool
  notEquals(left: a, right: a): Bool = not equals(left, right)
```

An `Eq` instance must supply `equals`. It normally inherits `notEquals`, and the `!=`
operator calls that operation. An instance may override `notEquals` for efficiency,
but the meaning must remain the same:

```hexagon
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
  show(box) = "Box(${show(box.value)})"
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
show(box) = "Box(${show(box.value)})"
```

The outer `show` defines how to display the box. The inner `show(box.value)` displays
the value inside it, using the `Show<a>` instance required by the first part of the
header.

Put together, the declaration says: **if `a` can be displayed, then `Box(a)` can be
displayed**. `Box(Int)` uses the existing `Show<Int>` instance; `Box(String)` uses
`Show<String>`.

## A constraint may require another constraint

Ordering must agree with equality, so the prelude declares `Ord` with `Eq` as a
**superconstraint**:

```hexagon
constraint Ord<a: Eq> =
  compare(left: a, right: a): Ordering
```

Read the header from left to right: `Ord` implies `Eq`. A function requiring `Ord` may
therefore use both `compare` and `equals`, and a type cannot honor `Ord` unless it also
has an `Eq` instance.

`Ordering` is the union:

```hexagon
union Ordering = Less | Equal | Greater
```

Returning a union rather than a magic negative, zero, or positive integer makes all
three outcomes explicit and exhaustively matchable.

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
| `Num`, `Frac`, `Integral` | numeric operations at different levels |
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
- `Eq.equals` is required and `Eq.notEquals` defaults to its Boolean negation;
- an `honor` declaration supplies the unique instance of a constraint for a type;
- a superconstraint is an obligation implied by another constraint;
- coherence gives every constraint/type pair one program-wide meaning;
- the orphan rule places an instance with either its constraint or its type; and
- dictionaries appear only where JavaScript must preserve genuine polymorphism.

Writing every structural member by hand would become repetitive. The next chapter
shows how nominal records and unions can ask the compiler for lawful standard
instances while keeping that choice explicit.
