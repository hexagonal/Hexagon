# Functions

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

In inferred types, the same zero/one/many shape applies. A nullary function displays
as `() -> Result`, a unary function as `Input -> Result`, and an n-ary function as
`(First, Second) -> Result`. There is no one-item tuple, so a unary type does not grow
a one-item parameter list: `String -> String`, not `(String) -> String`. Parentheses
around a function type mean real grouping, as in `(String -> String) -> String`.

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
    log("Calculated ${total}")
    total
```

Nothing object-oriented or reflective happens here. `calculate` is a parameter whose
value happens to be callable. Its uses in the body tell inference that it accepts two
compatible arguments and returns a displayable result.

Anonymous functions are especially useful for small adaptations:

```hexagon
let withStandardDelivery = subtotal =>
    orderTotal(subtotal, 5)

let total = withStandardDelivery(80)
```

`withStandardDelivery` is a new one-parameter function. It supplies the standard
delivery amount that `orderTotal` still requires. Calling `withStandardDelivery(80)`
therefore calls `orderTotal(80, 5)`: the caller supplies the subtotal, while the lambda
supplies the fixed delivery charge.

## Arity is part of a function

**Arity** is a count of how many parts something takes. For a function, it is the
number of arguments the function accepts, so a two-parameter function has arity two.
More generally, **n-ary** means “having *n* parts,” where *n* might be zero, one, two,
or more.

Hexagon functions are genuinely n-ary: each function has a fixed arity. A function
declared with two parameters must be called with two arguments:

```hexagon
orderTotal(80, 12)    // two arguments: correct
orderTotal(80)        // error: expected 2 arguments, got 1
```

Call parentheses are always required. Hexagon has no whitespace application such as
`orderTotal 80 12`.

The expression `orderTotal(80)` is an incomplete call. Hexagon does not silently turn
it into another function waiting for the delivery argument. When a reusable adaptation
is useful, write an ordinary lambda such as `withStandardDelivery` above. The lambda's
one parameter and fixed argument remain visible, and all functions retain one calling
convention.

Functional-programming literature calls the automatic alternatives **currying** and
**partial application**. Hexagon does neither. You do not need either concept to use
Hexagon; the practical rule is simply that every call supplies exactly the number of
arguments its function declares.

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

A written type variable is a real promise:

```hexagon
let takesInt(value: Int) = value
let inferred(value) = takesInt(value)
let rejected(value: a) = takesInt(value) // error: a cannot quietly become Int
```

The unannotated `inferred` parameter becomes `Int` because its body requires `Int`.
The declared type variable in `rejected` says that the function is generic on purpose,
so the checker holds the body to that contract: while the definition is checked, a
written type variable is **rigid** — it stands for an arbitrary type and cannot
collapse to one concrete type. Such a variable may still acquire constraints from
operations in the body; the polymorphism chapter returns to exactly how much a rigid
variable can absorb without giving up its generality.

A type variable can also relate positions to one another:

```hexagon
let chooseFirst(first: a, second: a): a = first
```

The lowercase `a` means one type chosen afresh by each caller. Both parameters must
have that same type, and the result has it too. Writing `a` in its first position is
all it takes to introduce it — lowercase already marks a type variable, so `first: a`
says everything there is to say — and each repetition says “the same type here.”

When a type variable must also carry an obligation, the obligation is attached in an
explicit binder, written in angle brackets before the parameter list:
`let display<a: Show>(value: a): String` requires `a` to be a type that can be
displayed. Attaching constraints is the binder's entire job. It does not manufacture
polymorphism — `chooseFirst` is already generic without one — and a bare `<a>` binder
would only repeat what `first: a` has said, so it is never written. What `<a: Show>`
means belongs in the constraints chapter; the inference chapter will explain how an
unannotated function such as `x => x` becomes reusable at many types.

## Put the subject first

The `ignore` example from the Expressions chapter has a natural data-flow spelling:

```hexagon
auditOrder(order) |> ignore
```

The pipe `|>` sends the value on its left into the function on its right. This means
`ignore(auditOrder(order))`, the canonical deliberate-discard form we already know. The
operators chapter will cover pipes fully; for now, notice that the piped value becomes
the function's first argument.

Hexagon therefore conventionally places the value being operated on first:

```hexagon
let applyDiscount(subtotal, discount) = ...
let renameCustomer(customer, newName) = ...
let map(items, transform) = ...
```

This “subject-first” order reads naturally as an ordinary call and prepares functions
for dot calls and pipes. For example, `items |> map(transform)` inserts
`items` as the first argument, producing `map(items, transform)`. The convention avoids
APIs split between those two parameter orders according to whichever syntax happened
to inspire them.

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

Unlike `let`, `fun` never takes a right-hand side of its own. There is no
`fun factorial = ...` — not with a lambda, not with any other expression. A `fun`
shows its parameters in its header, and anything else is an error whose message
hands you the header rewrite. The discipline is not arbitrary: a recursive binding
must exist before its body can run, so creating it must involve no computation at
all, and a header can only ever describe a function. `let` remains the general
word — values, lambdas, whatever you like — while `fun` does one job and always
shows its shape. The one variation on that shape, a bare `fun` heading a block of
members, arrives with mutual recursion below.

### Declarations are read top-down

A binding — `let` or `fun` alike — can be used only after its declaration. A Hexagon
file reads in the order it runs: the values a function needs are declared above it,
and the code that ties everything together tends to sit at the bottom.

```hexagon
let message = "Orders are ready"
fun announce() = log(message)
announce()
```

Reversing the first two lines is an error: `announce`'s body would name `message`
before it exists. The compiler points at the reference and says where the declaration
actually sits — below — so the fix is always the same: move the declaration up.

This is the discipline of the ML family, and it buys a guarantee worth having: the
JavaScript a module emits can never read a binding before it is initialized, because
the order the compiler enforces in the source is the order the emitted module runs.

### Mutual recursion

Two functions that call each other are written as members of one **`fun` block**: the
keyword alone on its line, then the members indented beneath it.

```hexagon
fun
    isEven(n: Int): Bool =
        if n == 0 then
            True
        else
            if n > 0 then
                isOdd(n - 1)
            else
                isOdd(n + 1)

    isOdd(n: Int): Bool =
        if n == 0 then
            False
        else
            if n > 0 then
                isEven(n - 1)
            else
                isEven(n + 1)
```

Inside the block, every member's body sees every member, earlier and later alike. This
is the one place a name may be used above its declaration, and it exists because mutual
recursion cannot be written without it. Member lines repeat no keyword — each is the
familiar header form, minus the `fun` the block head already said — and a lone
`fun factorial(n) = ...` is simply the block with one member, fused onto the head line.

The block is the *only* place mutual recursion lives. Two separate `fun` declarations,
even adjacent ones, are two independent definitions: the earlier cannot name the later,
and trying draws an error that says exactly what to do — only members of one `fun`
block recurse together; wrap both definitions as its members.

To everything outside it, the block is invisible: it binds no name of its own, and its
members are ordinary functions of the module, usable below the block like any other
declaration. When some members are implementation details, export only the ones that
aren't — the `export` word goes on the member's own line:

```hexagon
fun
    walk(order: String, depth: Int): Int = ...
    export itemCount(order: String): Int = walk(order, 0)
```

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
`fun` becomes a JavaScript function declaration. Calls remain ordinary n-ary
calls; no argument-packing, currying helper, or wrapper object appears.

This output is not only pleasant to inspect. Its shape explains the source rules:
`let` has sequential initialization, while the function-declaration form lets the
members of a `fun` block call each other. The block itself leaves no trace in the
JavaScript — each member becomes its own `function` declaration, in order, right
where the block stood.

## Summary

- Ordinary named functions use `let`; recursive functions use `fun`.
- Header syntax is convenient spelling for a lambda binding — and a `fun` never takes
  a right-hand side: it always shows its header.
- Functions are values and may be passed, stored, and returned.
- Calls require parentheses, and arity is checked exactly.
- An incomplete call is an error; write an explicit lambda when a new adapted function
  is useful.
- Zero-parameter functions receive zero arguments; `()` remains the `Unit` value.
- Annotations document or restrict types, while inference remains the normal source of
  polymorphism.
- Subject-first parameter order prepares APIs for pipes and dot calls.
- Declarations are read top-down: every binding is used after its declaration.
- `fun` supports direct and mutual recursion; the `fun` block is the one scope where
  names are visible before their declarations, and each member exports individually.

We can now write useful transformations, callbacks, and recursive definitions. A later
chapter will explain more fully what Hexagon has already been doing in these examples:
inferring types, deciding which bindings are reusable at many types, and rejecting the
few cases where that reuse would be unsound. First, we will complete the expression
language and make its layout rules explicit.
