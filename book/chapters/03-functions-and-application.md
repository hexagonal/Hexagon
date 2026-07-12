# Functions and Application

The first function in this book was deliberately ordinary:

```hexagon
export let orderTotal(subtotal: Int, delivery: Int): Int =
  let total = subtotal + delivery
  total
```

Functions are Hexagon's everyday way to organize behavior. They accept values, produce
values, and can themselves be stored, passed, and returned like any other value. Types
are usually inferred, argument lists mean what they look like, and the emitted
JavaScript remains recognizable.

The unusual-looking part for a JavaScript reader may be the word `let`. In Hexagon,
ordinary named functions are immutable value bindings. The separate word `fun` is
reserved for functions that need recursion.

## A function is a value

The header form gives a name, parameters, and a body:

```hexagon
let orderTotal(subtotal, delivery) =
  subtotal + delivery
```

Hexagon infers the types from the body and its uses. Annotations can make the intended
boundary explicit, as they did in the opening example, but they are not required merely
to make the compiler understand a function.

The header is convenient syntax for binding a lambda:

```hexagon
let orderTotal = (subtotal, delivery) =>
  subtotal + delivery
```

These definitions mean exactly the same thing. They are not two subtly different kinds
of function. Use the header form for an ordinary named definition and the lambda form
when the function itself appears inside a larger expression.

A lambda with one parameter may omit its parentheses:

```hexagon
subtotal => subtotal + 5
```

Parentheses remain useful when annotations are present or when visual grouping helps:

```hexagon
(subtotal: Int) => subtotal + 5
```

Constructing a lambda does not run its body. It creates a function value that can be
called later.

## Passing functions around

Because a function is a value, it can be given another name:

```hexagon
let calculate = orderTotal
let total = calculate(80, 12)
```

It can also be passed to a function that controls when or how it is called:

```hexagon
let logResult(calculate, subtotal, delivery) =
  let total = calculate(subtotal, delivery)
  print("Calculated ${total}")
  total
```

Nothing object-oriented or reflective happens here. `calculate` is a parameter whose
value happens to be callable. Its uses in the body tell inference that it accepts two
compatible arguments and returns a displayable result.

Anonymous functions are especially useful for small adaptations:

```hexagon
let withStandardDelivery = subtotal => orderTotal(subtotal, 5)
let total = withStandardDelivery(80)
```

`withStandardDelivery` is a new one-parameter function. It supplies the standard
delivery amount that `orderTotal` still requires.

## Arity is part of a function

Hexagon functions are genuinely n-ary. A function declared with two parameters must be
called with two arguments:

```hexagon
orderTotal(80, 12)    // two arguments: correct
orderTotal(80)        // error: expected 2 arguments, got 1
```

Call parentheses are always required. Hexagon has no whitespace application such as
`orderTotal 80 12`.

There is also no automatic currying or partial application. The expression
`orderTotal(80)` is an incomplete call, not a new function waiting for its second
argument. Write the lambda you mean:

```hexagon
let addDelivery = delivery => orderTotal(80, delivery)
```

The explicit lambda makes argument order and evaluation visible. It also avoids a
second, hidden calling convention: all functions are called the same way.

A two-element tuple is one value; two arguments are two values supplied to a
two-parameter function. Hexagon does not convert between them implicitly. When tuples
arrive later, passing one tuple to a two-parameter function will still be an arity
error.

## Zero parameters means zero arguments

A function may have no parameters:

```hexagon
let currentGreeting() = "Hello"
let greeting = currentGreeting()
```

The lambda form uses an empty parameter list:

```hexagon
let currentGreeting = () => "Hello"
```

This function receives no hidden value. Although `()` is also the literal value of
`Unit`, calling `currentGreeting()` passes zero arguments, just as the emitted
JavaScript does.

Nullary functions are useful when evaluation time matters—for example, reading a clock
or asking a foreign API for its current state. If a value is fixed, bind the value
directly rather than wrapping it in a function.

## Annotations document and restrict

Parameter annotations appear beside parameters, and a result annotation follows the
parameter list:

```hexagon
let orderTotal(subtotal: Int, delivery: Int): Int =
  subtotal + delivery
```

Any subset may be annotated. Inference fills the remainder:

```hexagon
let orderTotal(subtotal: Int, delivery) =
  subtotal + delivery
```

Annotations are checked against the body. They can document a public boundary or
deliberately restrict a function, but they cannot promise behavior the definition does
not support. Hexagon has no separate signature line that can drift away from the
definition; the type belongs on the definition it describes.

Explicit type variables use angle brackets:

```hexagon
let chooseFirst<a>(first: a, second: a): a = first
```

The lowercase `a` means one type chosen afresh by each caller. Both parameters must
have that same type, and the result has it too. The body would support this without the
explicit `<a>`; naming it makes the relationship visible.

Constraints can be attached in the same position—`<a: Show>`, for example—but their
meaning belongs in the constraints chapter. Explicit type parameters name or restrict
polymorphism; they do not manufacture it. The inference chapter will explain how an
unannotated function such as `x => x` becomes reusable at many types.

## Put the subject first

Hexagon's convention is to place the value being operated on first:

```hexagon
let applyDiscount(subtotal, discount) = ...
let renameCustomer(customer, newName) = ...
let map(items, transform) = ...
```

This “subject-first” order reads naturally as an ordinary call and prepares functions
for method-style calls and pipes. Later, `items |> map(transform)` will insert `items`
as the first argument. The convention avoids APIs split between `map(items, transform)`
and `map(transform, items)` according to whichever syntax happened to inspire them.

It is a convention rather than a different function mechanism. A function may put its
parameters in any order, but reusable APIs should make composition feel predictable.

## Ordinary functions use `let`

Use `let` whenever a function does not call itself:

```hexagon
let double(n) = n * 2
let describeOrder(order) = "Order ${order}"
```

Like every `let`, the function name is not in scope inside its own right-hand side:

```hexagon
let factorial(n: Int): Int =
  if n <= 1 then 1 else n * factorial(n - 1)
```

This is an error even though the self-reference sits inside the function body. `let` is
non-recursive. The diagnostic points to the intended tool: use `fun`.

The separation makes the common case explicit. Most functions do not participate in a
recursive knot, so they receive ordinary sequential `let` scope and emit as ordinary
`const`-bound arrows.

## Recursion uses `fun`

Change the binding word when self-reference is part of the definition:

```hexagon
fun factorial(n: Int): Int =
  if n <= 1 then 1 else n * factorial(n - 1)
```

The body must be a lambda, either through this header form or written directly:

```hexagon
fun factorial = (n: Int): Int =>
  if n <= 1 then 1 else n * factorial(n - 1)
```

A non-function right-hand side is not legal under `fun`. Nor can an arbitrary function-
producing call be placed there. This syntactic rule ensures that creating a recursive
binding performs no computation before the function exists.

### Hoisting without temporal surprises

A `fun` name is in scope throughout its enclosing block, supporting direct and mutual
recursion. A function with no outer local dependencies can even be called before its
textual definition.

When a recursive function captures an outer binding, Hexagon also checks that the
captured value has been initialized before the function is used:

```hexagon
fun announce() = print(message)
let message = "Orders are ready"
announce()
```

This order is valid. Moving `announce()` above the `message` binding is an error:
`message` would not yet exist at the call. JavaScript might expose this as a temporal
dead-zone failure at runtime; Hexagon rejects it during compilation. If one local
`fun` calls another, their captured dependencies are considered transitively.

### Mutual recursion

Two `fun` declarations may refer to each other:

```hexagon
fun isEven(n: Int): Bool =
  if n == 0 then true else isOdd(n - 1)

fun isOdd(n: Int): Bool =
  if n == 0 then false else isEven(n - 1)
```

The pair forms one recursive group. Calls between their bodies are valid regardless of
textual order. If either function captures an outer local value, the combined group is
usable only after all captures required by either function are initialized.

Recursive calls use one consistent type inside the group. A recursive function may be
generic for outside callers, but it cannot recursively call itself at unrelated types
on different steps. This ban on polymorphic recursion keeps inference predictable; the
type-inference chapter will put the rule in its wider context.

## The JavaScript remains direct

The distinction between ordinary and recursive bindings has a visible, unsurprising
JavaScript form.

```hexagon
let orderTotal(subtotal, delivery) = subtotal + delivery

fun factorial(n: Int): Int =
  if n <= 1 then 1 else n * factorial(n - 1)
```

emits in this shape:

```js
const orderTotal = (subtotal, delivery) => subtotal + delivery;

function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
}
```

`let` becomes a `const` holding an arrow function at its textual position. Recursive
`fun` becomes a hoisted JavaScript function declaration. Calls remain ordinary n-ary
calls; no tuple allocation, currying helper, or wrapper object appears.

This output is not only pleasant to inspect. Its shape explains the source rules:
`let` has sequential initialization, while `fun` receives the hoisted form recursion
requires.

## What to carry forward

- Ordinary named functions use `let`; recursive functions use `fun`.
- Header syntax is convenient spelling for a lambda binding.
- Functions are values and may be passed, stored, and returned.
- Calls require parentheses, and arity is checked exactly.
- Partial application is an explicit lambda, not an implicit calling mode.
- Zero-parameter functions receive zero arguments; `()` remains the `Unit` value.
- Annotations document or restrict types, while inference remains the normal source of
  polymorphism.
- Subject-first parameter order prepares APIs for pipes and method-style calls.
- `fun` supports direct and mutual recursion while checking that captured values are
  initialized before use.

We can now write useful transformations, callbacks, and recursive definitions. The next
step is to explain more fully what Hexagon has already been doing in these examples:
inferring types, deciding which bindings are reusable at many types, and rejecting the
few cases where that reuse would be unsound.
