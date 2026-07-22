# Expressions

Hexagon programs are made from values and functions that transform them. Before we
meet the language's richer types, it helps to understand the small mechanism beneath
almost everything else: an expression produces a value, and a binding gives a value a
name.

Here is a complete function that calculates the total cost of an order:

```hexagon
export let orderTotal(subtotal: Int, delivery: Int): Int =
    let total = subtotal + delivery
    total
```

The first line introduces the function `orderTotal`. Inside its body, `let` gives the
result of `subtotal + delivery` the name `total`. The final line is simply the value the
function returns.

There is no `return` keyword. There is also no punctuation marking the beginning and
end of the body. Indentation forms the block, and the block's final expression supplies
its result.

This chapter concentrates on that model. The examples necessarily borrow a little
function and type syntax from later chapters, but you do not need to understand all of
it yet. Read `subtotal: Int` as “the parameter `subtotal` contains an integer,” and
read `: Int` after the parameter list as “this function produces an integer.” Hexagon
can usually infer those types; they are written here to keep our first examples
unambiguous.

## Expressions produce values

An expression is a piece of a program that produces a value. Literals are expressions:

```hexagon
42
"ready"
true
()
```

So are calculations and function calls:

```hexagon
subtotal + delivery
orderTotal(80, 12)
formatOrder(order)
```

Larger forms such as conditionals and pattern matches are expressions too. That will
matter later: choosing between two branches does not merely perform control flow; it
produces the value of the chosen branch.

Hexagon does not divide its executable language into “expressions over here” and
“statements over there.” A call made for its effect is still an expression. Assignment,
when we eventually introduce local mutation, is an expression as well.

There is one important exception to this expression-first account: a **binding** does
not produce a value. It introduces a name.

## Bindings introduce names

The ordinary immutable binding begins with `let`:

```hexagon
let quantity = 4
let unitPrice = 25
let subtotal = quantity * unitPrice
```

Each right-hand side is an expression. Hexagon evaluates it, then makes the resulting
value available under the name on the left. After these three bindings, `quantity`
names `4`, `unitPrice` names `25`, and `subtotal` names `100`.

The bindings themselves have no value and no type. The names do: `quantity`,
`unitPrice`, and `subtotal` each refer to values whose inferred type is `Int`. This
distinction may sound fussy, but it explains several otherwise surprising rules. In
particular, a binding cannot be used where a value is required, and a block cannot use
a final binding as its result.

`let` is immutable. There is no later line that changes which value `subtotal` names.
When a calculation has a new stage, give that stage a new, descriptive name:

```hexagon
let subtotal = quantity * unitPrice
let discountedSubtotal = applyDiscount(subtotal, discount)
let finalTotal = discountedSubtotal + delivery
```

This is not merely a restriction. Stable names let a reader understand a calculation
without tracking which version of a variable happens to be current. Hexagon does have
a deliberately confined form of local mutation for algorithms that benefit from it,
but immutable `let` bindings remain the normal way to describe values flowing through
a program.

## A block takes the value of its final expression

A function body can contain several bindings and expressions. Together they form a
block:

```hexagon
let invoiceTotal(subtotal: Int, delivery: Int, handling: Int): Int =
    let deliveredTotal = subtotal + delivery
    let finalTotal = deliveredTotal + handling
    finalTotal
```

Indentation tells us that all three lines belong to the function body. The first two
items are bindings. The last item is an expression, so its value becomes the value of
the block. Here the final expression is `finalTotal`, an `Int`; the block and function
therefore produce an `Int`.

The final expression need not be a bare name:

```hexagon
let orderTotal(subtotal: Int, delivery: Int): Int =
    subtotal + delivery
```

A one-expression block is the simplest block. Introducing `total` in the opening
example did not change the result; it merely gave an important intermediate value a
name.

The same rule will apply inside conditionals, pattern-match arms, exception handlers,
and other nested blocks. Learn it once: **the final expression is the value of the
block**.

### A block cannot end with a binding

Consider this attempted function:

```hexagon
let orderTotal(subtotal: Int, delivery: Int): Int =
    let total = subtotal + delivery
```

The body introduces `total` and then ends. But a binding exists to make a name
available to what follows it; here nothing follows. More fundamentally, the function
promises an `Int`, while its body has no final expression and therefore no value.

Hexagon rejects the block and points at the likely omission: did you mean to finish
with `total`?

```hexagon
let orderTotal(subtotal: Int, delivery: Int): Int =
    let total = subtotal + delivery
    total
```

This rule applies to nested blocks as well as function bodies. The top level of a
module is the deliberate exception. A module is a sequence of declarations and
top-level effects, not a value-producing block, so a source file may quite reasonably
end with an exported binding.

## Sequencing effects with `Unit`

Some expressions are useful because of what they do rather than the value they
calculate. Printing a message is the standard small example:

```hexagon
print("Preparing order")
```

The call is still an expression, but its result type is `Unit`. `Unit` has one ordinary
value, written `()`. It communicates that there is no interesting result to use. At the
JavaScript boundary, `Unit` corresponds to `undefined` (`void` in a function return
position in TypeScript declarations).

A `Unit`-producing expression can appear before the final expression of a block:

```hexagon
let prepareOrder(order: Order): Order =
    print("Preparing order")
    order
```

The first line of the body is evaluated for its printing effect. Its uninteresting
`Unit` value is discarded, and evaluation continues. The final expression is `order`,
so the whole block returns the original `Order`.

This gives sequencing a simple type rule:

- a binding may appear before later items because its purpose is to introduce names;
- a non-final expression must produce `Unit`, because its value will be discarded; and
- the final expression may produce any type, and that becomes the block's type.

The rule catches an easy mistake.

## Accidentally discarded values are errors

Suppose `auditOrder` examines an order and returns a report:

```hexagon
let prepareOrder(order: Order): Order =
    auditOrder(order)
    print("Preparing order")
    order
```

If `auditOrder(order)` returns an `AuditReport`, placing it before the end of the block
would calculate the report and immediately throw it away. In many languages that is
legal, perhaps with a warning. Hexagon treats it as an error:

```text
this expression's value is discarded — its type is `AuditReport`;
wrap it in `ignore(...)` if discarding is intentional
```

This often reveals a real bug. Perhaps the report was meant to be returned, bound to a
name, passed to another function, or inspected before continuing. Hexagon does not ask
the reader—or a linter—to guess whether the omission matters.

If evaluating the expression matters but its result genuinely does not, say so with
`ignore`:

```hexagon
let prepareOrder(order: Order): Order =
    ignore(auditOrder(order))
    print("Preparing order")
    order
```

`ignore` is an ordinary prelude function: it accepts a value of any type and produces
`Unit`. Its name records the decision for the next reader. It is not a keyword, and `_`
is not an alternative spelling for discarded values.

The emitted JavaScript need not perform a meaningless call to an `ignore` helper. When
`ignore(auditOrder(order))` is used this way, it can emit as the ordinary JavaScript
expression statement:

```js
auditOrder(order);
```

Hexagon's stricter source rule costs nothing at runtime. It makes intent visible before
emitting the direct JavaScript operation.

## Names accumulate instead of changing meaning

Within a sequence of bindings, a new `let` name may not reuse a name already in scope:

```hexagon
let subtotal = quantity * unitPrice
let subtotal = subtotal + delivery
```

The second binding is an error. Hexagon does not read it as assignment, and it does not
silently create a new `subtotal` that hides the first one.

Use a name that identifies the new stage:

```hexagon
let subtotal = quantity * unitPrice
let totalWithDelivery = subtotal + delivery
```

The benefit becomes larger in a long, indentation-based block. A reference to
`subtotal` keeps the same meaning throughout the rest of its scope; a reader does not
need to search upward for the most recent declaration with that spelling.

The complete shadowing rule distinguishes these sequential bindings from parameters
and pattern variables whose scopes are visibly attached to a function, loop, or match
arm. Those head binders may reuse familiar local names. We will return to that
distinction when those constructs give it a concrete purpose. For now, the practical
rule is straightforward: when one `let` calculation follows another, give each stage a
fresh name.

## The three faces of a public function

Hexagon is designed to live inside JavaScript and TypeScript projects. For important
features, this book will occasionally compare three representations:

1. the Hexagon source you write;
2. the readable JavaScript the compiler emits; and
3. the TypeScript declaration seen by typed JavaScript consumers.

Here is our opening function again.

**Hexagon source**

```hexagon
export let orderTotal(subtotal: Int, delivery: Int): Int =
    let total = subtotal + delivery
    total
```

**JavaScript output**

```js
export const orderTotal = (subtotal, delivery) => {
  const total = subtotal + delivery;
  return total;
};
```

**TypeScript declaration**

```ts
export declare const orderTotal: (
  subtotal: number,
  delivery: number,
) => number;
```

The forms differ, but they tell the same story. The immutable Hexagon binding becomes
`const`. The block's final expression becomes a JavaScript `return`. Hexagon's `Int`
uses JavaScript's `number` representation and therefore appears as `number` in the
declaration. No wrapper object or runtime type machinery is needed.

This three-way comparison will return when a feature changes the runtime representation
or the public type surface. We will omit it when the result would add no understanding.

## Summary

The chapter's model is small enough to remember as a handful of rules:

- expressions produce values;
- bindings introduce names and are not themselves expressions;
- `let` names immutable values;
- a block's final expression supplies its value and type;
- non-final expressions must produce `Unit`;
- accidentally discarded values are errors, while `ignore` makes deliberate discarding
  explicit; and
- sequential bindings accumulate fresh names instead of changing an existing name's
  meaning.

These rules will reappear throughout the book. Functions give blocks their most common
home. Conditionals and pattern matching make their value-producing nature more visible.
Local mutation provides a narrow, explicit alternative when a changing value really is
the clearest tool. In each case, we will build on the same distinction: expressions
produce values; bindings give those values names.
