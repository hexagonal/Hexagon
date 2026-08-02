# Polymorphism

Hexagon has been checking types since the first example, even when the source did not
name them:

```hexagon
let identity(x) = x
```

The parameter and result must have the same type because the result is the parameter
itself. Hexagon records that relationship without deciding that `x` must be an `Int`, a
`String`, or any other particular type.

This ability to write one definition that works at more than one type is
**polymorphism**. Many languages describe the same broad idea as **generics**. Hexagon
uses *polymorphism* here because the compiler can often infer it without explicit
generic declarations.

Type inference is not a system of clever conversions. It does not guess that a string
should become a number or that a missing field is probably optional. It follows the
relationships required by the program and reports when they cannot all be true.

## Types are optional, not absent

Consider a function from the opening chapter without annotations:

```hexagon
let orderTotal(subtotal, delivery) = subtotal + delivery
```

The `+` operator requires both operands and its result to share a numeric type. Hexagon
therefore infers a function that works for types supporting numeric addition. Adding
`Int` annotations deliberately narrows that general function to the public boundary we
used earlier:

```hexagon
let orderTotal(subtotal: Int, delivery: Int): Int =
    subtotal + delivery
```

Inference and annotation cooperate. The body still has to satisfy the written type;
annotations do not turn off checking.

## A `let`-bound function can be reused at several types

The unannotated identity function has one useful promise: whatever type goes in comes
back out.

```hexagon
let identity(x) = x

let answer = identity(42)
let greeting = identity("hello")
```

The first call uses `identity` with `Int`; the second uses it with `String`. These uses
do not compete. A reusable type is inferred at the `let` binding, and each call receives
a fresh use of that type relationship.

This behavior is **let-polymorphism**. The name matters less than the practical rule:
a suitable immutable value bound with `let` can be reused consistently at different
types.

The same applies to many ordinary helpers:

```hexagon
let chooseFirst(first, second) = first

let chosenNumber = chooseFirst(3, 4)
let chosenWord = chooseFirst("tea", "coffee")
```

The two parameter types are inferred independently because the function returns
`first` without using `second`. Separate calls receive fresh versions of both types, so
even the same parameter position may hold an `Int` in one call and a `String` in
another.

## A parameter has one type within one call

Polymorphism belongs to a reusable binding, not to an individual function parameter.
This attempted higher-order function fails:

```hexagon
let useAtTwoTypes(f) =
    ignore(f(1))
    f("hello")
```

Within one call to `useAtTwoTypes`, the parameter `f` has one type. Its first use says
that its argument is `Int`; its second says that the same argument position is
`String`. Both cannot hold.

This restriction keeps ordinary function parameters simple and predictable. A caller
may pass an `Int` function or a `String` function, but not one magical parameter whose
type changes from line to line inside the same call.

## Naming a value keeps it reusable

Reuse survives being given a name. A `let` whose right-hand side is a **value** — a
lambda, a literal, a constructor applied to values, a record or tuple of values, or a
plain reference to something already bound — stays as polymorphic as what it names.

```hexagon
let nothing = Seq.empty

let numbers = Seq.prepend(nothing, 42)
let words = Seq.prepend(nothing, "Briar")
```

`Seq.empty` is a reference to something already bound, so the right-hand side is a
value and the two lines below it are independent. This is a program worth being
explicit about, because it is the first one many people write and the first place a
language can quietly refuse: naming the empty sequence costs nothing.

The rule that decides this is the **value restriction**: a right-hand side that is
visibly a value is generalized in full. A right-hand side that must *run* — a call,
a `match`, an `if`, a multi-statement block — has already produced one particular
value by the time the binding exists, and full generalization is withheld from it.

## A computation is generalized in the parts nothing could have filled

Withheld *in full*, not withheld entirely. A computed right-hand side is examined one
type variable at a time, and a variable is still reusable when nothing in the value
could be holding one:

```hexagon
fun makeEmpty<a>(): Vector(a) = []

let blank = makeEmpty()

let counts: Vector(Int) = blank.append(1)
let labels: Vector(String) = blank.append("one")
```

`makeEmpty()` is a call, so `blank` is not a value. It is reusable anyway, because a
`Vector(a)` produced by a function that was told nothing about `a` cannot contain an
`a`: there was nothing for it to put in. Handing that same empty vector out at `Int`
and at `String` is safe because there is no element either use could disagree about.

Two things stop a variable from being reused, and both have the same shape — the value
might already hold something at that type, or might demand one.

**A variable the value could consume.** A function type has two sides, and the argument
side is the one that takes something in:

```hexagon
fun makeIdentity<a>(): (a -> a) = x => x

let generatedIdentity = makeIdentity()
let number = generatedIdentity(1)
let word = generatedIdentity("hello")
```

`a` appears as `generatedIdentity`'s argument as well as its result, so it is not the
kind of variable that can be given away freely. The binding holds one function of one
type, a use fixes which, and the two calls above cannot both hold — so the pair is
rejected.

**A variable with a capability attached.** A constrained variable stands for a type
that carries operations, and those operations are chosen once, when the right-hand
side runs:

```hexagon
fun double<a: Num>(value: a): a = value + value

let doubled = double(42)
```

`doubled` is one number, computed once, with one set of arithmetic operations already
selected. Reusing it at another numeric type would mean reusing a result that was
computed with the wrong ones — `Int` and `BigInt` do not overflow alike. So a
constrained variable is never reused at a computed binding; `doubled` settles on a
single numeric type, here the `Int` that unconstrained whole numbers default to.

That second rule is the whole reason the value restriction exists in Hexagon. It is
not, as it is in some languages, a guard against mutation: Hexagon has no mutable
cells to smuggle a value through, and no foreign function may return a type with a
variable in it. What it protects is the promise that a binding's right-hand side runs
exactly once.

When a variable does get fixed, the response is not a type-system trick. Call the
producer where the intended type is known, add a concrete annotation, or keep the
reusable behavior behind a lambda.

The first of the two rules — whether a value could be holding an `a`, or could take
one — is a question about a type's **variance**. Where a type's definition is public,
the compiler answers that question by reading the definition. A type that hides its
definition has to declare the answer instead, and that is what the `+a` and `-a` of
the modules chapter are for.

## Bare whole numbers default to `Int`

A bare integer literal begins with a numeric capability rather than a permanently fixed
type. Context may select another numeric type:

```hexagon
let addOne(x: BigInt): BigInt = x + 1
```

Here the surrounding `BigInt` fixes the bare `1` as `BigInt`, so the emitted literal is
`1n`.

When no context chooses a type, Hexagon defaults the literal to `Int`:

```hexagon
let retries = 3 // Int
```

There is one default, not a negotiation among several numeric types. A decimal point or
exponent still selects `Float` directly, while the `n` suffix selects `BigInt` directly.

## Annotations are for clarity and boundaries

Annotations are useful when they communicate intent:

```hexagon
export let circleArea(radius: Float): Float =
    3.14 * radius ** 2.0
```

They also resolve an otherwise ambiguous producer or deliberately restrict a more
general body. Any subset of parameters and result may be annotated; inference fills the
rest.

Explicit type variables make relationships visible:

```hexagon
let identity<a>(x: a): a = x
```

The lowercase `a` names the type chosen by each use. This annotation documents the same
polymorphism inferred for `let identity(x) = x`; it does not create a new power.

Later, constraints will refine the relationship:

```hexagon
let display<a: Show>(value: a): String = "${value}"
```

Read this provisionally as “for any displayable type `a`.” The constraints chapter will
explain how such obligations are declared and satisfied.

## Recursive calls keep one type

A recursive `fun` may be reusable at several types from the outside, just like another
generalized function. Inside its own recursive group, however, every recursive call
uses one consistent type. It cannot call itself with an unrelated type on a later step.

This rejects **polymorphic recursion**. The restriction is valuable because ordinary
inference can determine recursive function types without asking programmers for a
special proof or a more powerful annotation language. Generic recursive functions such
as collection traversal still work; only the recursive knot itself stays at one type.

## Inferred types do not burden the JavaScript

For ordinary concrete code, types disappear:

```hexagon
let identity(x) = x
let answer = identity(42)
```

```js
const identity = x => x;
const answer = identity(42);
```

Inference provides static guarantees without adding wrappers or runtime type tests.
Constrained functions sometimes require extra compilation machinery while genuinely
polymorphic, but concrete uses remain direct; that story belongs with constraints and
the JavaScript boundary.

## Summary

- inference discovers required type relationships and rejects contradictions;
- a `let` whose initializer is a value — a lambda, a literal, a constructor
  application, a record or tuple of values, or a reference to something already
  bound — is as reusable as what it names;
- a lambda parameter has one type within each call;
- a computed initializer is still reusable in the parts nothing could have filled: a
  variable is fixed when the value could consume it, or when it carries a capability
  that was chosen while the initializer ran;
- unconstrained whole-number literals default to `Int`;
- annotations document, resolve, or deliberately narrow inferred types; and
- recursive calls within one `fun` group keep one consistent type.

With these rules in place, compound values can be introduced without stopping to label
every component. Hexagon will infer their shapes and preserve the relationships that
matter.
