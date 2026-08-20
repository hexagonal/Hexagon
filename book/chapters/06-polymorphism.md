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
let makeEmpty(): Vector(a) = []

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
let makeIdentity(): (a -> a) = x => x

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
let double<a: Num>(value: a): a = value + value

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
    3.14 * radius ** 2
```

They also resolve an otherwise ambiguous producer or deliberately restrict a more
general body. Any subset of parameters and result may be annotated; inference fills the
rest.

Explicit type variables make relationships visible:

```hexagon
let identity(x: a): a = x
```

The lowercase `a` names the type chosen by each use — writing it in one position
introduces it, and repeating it says "the same type here." This annotation documents the
same polymorphism inferred for `let identity(x) = x`; it does not create a new power.

Later, constraints will refine the relationship:

```hexagon
let display<a: Show>(value: a): String = "${value}"
```

Read this provisionally as “for any displayable type `a`.” The constraints chapter will
explain how such obligations are declared and satisfied.

## A rigid variable bends without breaking

The functions chapter made the promise concrete: a written type variable is **rigid**
while its definition is checked — `rejected(value: a)` could not pass `value` to a
function demanding `Int`, because `a` stands for every type and cannot collapse to one.
Now that generalization is on the table, the interesting question is the other
direction: how much can a body ask of a rigid variable before the promise breaks?

More than you might expect:

```hexagon
let increment(value: a) = value + 1
```

This is legal. The `+` asks `a` to be numeric, and that requirement attaches to `a` as a
constraint — the same kind of obligation `display` wrote by hand as `<a: Show>` —
without ever narrowing `a` to one concrete type. Rigidity pins the *shape* of a type;
requirements discovered in the body accumulate beside it as constraints. `increment`
remains reusable at every numeric type, and `a` never stopped meaning "any type the
caller chooses."

If you come to Hexagon from OCaml or F#, pause here: this is a stronger promise than the
annotation you are used to. OCaml compiles `let f (x : 'a) = x + 1` by silently deciding
`'a` meant `int` all along. Hexagon never narrows a written variable — it either holds
the claim, gathering constraints as the body demands them, or rejects the definition.

## Leaving a hole in an annotation

Each parameter and result may be annotated or left off, and inference fills whatever is
unwritten. Sometimes the claim worth writing is only *part* of a type: this parameter is
a `Vector`, and its element type is inference's business. A **type hole**, written `_`,
leaves one position inside a written type to inference:

```hexagon
let padded(entries: Vector(_)): Vector(Int) = entries.append(0)
```

The hole holds an ordinary inference variable — exactly what an unannotated position
receives. Here the body settles it: appending `0` under a `Vector(Int)` result fixes the
element type, so `padded` takes a `Vector(Int)` — the annotation claims the constructor
and leaves the element to inference. Writing `entries: Vector(a)` here would be an
over-claim: `a` promises every element type, and this body cannot deliver that.

That is also the rule for choosing between the two spellings. When the position *is*
genuinely generic — nothing in the body fixes it — write the variable: `Vector(a)` makes
the checked claim, costs nothing, and is already the form an `export` would require. A
hole is the right spelling exactly where a variable would be refused.

One principle runs through everything this chapter has shown: **written is claimed,
unwritten is inferred**. A hole is how you write "unwritten" inside an annotation, and
the contrast with a type variable makes the principle visible:

```hexagon
let answer: _ = 42      // fine: the hole is filled by inference; answer is an Int
let general: a = 42     // error: a claims every type, and one number cannot deliver that
```

The hole leaves the type to inference, which defaults the bare literal to `Int`. The
variable claims generality — `general` at every type `a` — and `42` is not a value of
every type. Same position, one principle, different answers.

A hole covering an entire annotation, as in `answer: _`, is legal and means exactly what
omitting the annotation means — canonical Hexagon simply omits it. And where a signature
must be complete, a hole is not accepted: an exported function still writes its full
type, because a hole would un-write part of the module's contract.

## Constraining a hole

`increment` showed one way an obligation reaches a type: the body demands it, and the
constraint attaches unwritten. `display` previewed the other: `<a: Show>` writes the
obligation by hand. Both of those attach to a *named* variable. A hole can carry an
obligation too — and it is written right where the hole is:

```hexagon
let padded(entries: Vector(_ : Num)): Vector(Int) = entries.append(0)
```

Read `_ : Num` as "some type, inference's to find, that honors `Num`." The written
constraint is a requirement the filled type must satisfy: here inference fills the hole
with `Int`, `Int` honors `Num`, and the claim holds. It is a floor, not a ceiling — the
body stays free to demand more, exactly as `increment`'s body did.

`padded`'s parameter now has three possible spellings, and they form a ladder of claims:

```hexagon
entries: Vector(a)          // every element type — refused: this body delivers only Int
entries: Vector(_ : Num)    // some numeric element type — the strongest true claim
entries: Vector(_)          // some element type — true, but says less
```

Write the strongest claim that is true. The variable over-claims here, the bare hole
under-claims; the constrained hole says what this function asks of its elements before
the body says the rest.

Why does the hole's constraint sit *inside* the annotation, when `display` wrote its own
up front in angle brackets? Because a constraint's home follows from whether the thing it
governs has a **name**. A name lets several positions share one obligation, stated once:

```hexagon
let clamp<a: Ord>(value: a, low: a, high: a): a =
    if value < low then low
    else if value > high then high
    else value
```

Four positions, one `a`, one `<a: Ord>` — read it provisionally, as with `display`, as
“any type that can be ordered” — stated at the variable itself, not at whichever
parameter happens to mention it first. A hole has no name: there is nothing
for a binder to hold onto, so its obligation lives in the one place the hole exists.
Each form is at home exactly where the other cannot go — a named variable gathers its
constraints at the binder, and `Vector(a : Num)` is a parse error; a hole carries its
constraints inline, and a binder list cannot name a hole.

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
- annotations document, resolve, or deliberately narrow inferred types;
- a written type variable is **rigid**: the shape claim holds, constraints accumulate
  beside it, and it never collapses to one concrete type;
- a **type hole** `_` leaves one position of a written annotation to inference —
  written is claimed, unwritten is inferred;
- a hole may carry a written constraint — `Vector(_ : Num)` — a floor its filled type
  must satisfy: named variables take their constraints at the binder, holes take
  theirs inline, and each form lives exactly where the other cannot; and
- recursive calls within one `fun` group keep one consistent type.

With these rules in place, compound values can be introduced without stopping to label
every component. Hexagon will infer their shapes and preserve the relationships that
matter.
