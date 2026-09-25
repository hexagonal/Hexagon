# Operators

We can now name values, work with primitive types, and define functions. Operators are
the compact vocabulary that connects those pieces:

```hexagon
let total = subtotal + delivery
let eligible = 0 <= discount <= 100 and not suspended
let message = "Order " ++ orderLabel ++ " is ready"
```

Hexagon uses symbols for algebra and comparisons, English words for logic, and a pipe
for feeding values through subject-first functions. The vocabulary is fixed. Programs
may define new types and teach them appropriate capabilities, but they cannot invent
new punctuation or give an existing operator an unrelated meaning.

This arrangement gives operators extensibility without turning parsing into a local
dialect. The constraints chapter will explain the mechanism. Here we will learn the
surface a programmer reads and writes.

## Arithmetic keeps its mathematical shape

The familiar arithmetic operators are available where the operand type supports them:

```hexagon
a + b
a - b
a * b
a / b
-a
a ** b
```

Addition, subtraction, multiplication, and negation work with the numeric primitive
types. Division `/` belongs to types honoring `Frac`, including `Float` and exact
`Rat` values:

```hexagon
import Rat

let average = 7.5 / 3.0
let threeHalves = (1, 2)rat / (1, 3)rat
```

The `rat` suffix constructs an exact fraction; `import Rat` makes that suffix
available. The patterns chapter explains how the same spelling takes a fraction
apart.

If both values are `Float`, this is IEEE 754 division and follows the same infinity and
`NaN` behavior as JavaScript. Rat division is exact and throws `DivideByZeroError` for
a zero divisor. `Int` and `BigInt` deliberately do not support `/`: whole-number
division must say which rounding and remainder convention it intends. Dec also has
no `/` operator: use `divide` or `divideEven` with the required decimal places.

Exponentiation uses `**`, not `^`, and associates to the right:

```hexagon
2 ** 3 ** 2       // 2 ** (3 ** 2), which is 512
```

The exponent is always an `Int`. `**` is the algebraist's power — repeated
multiplication, and its inverse where the type has reciprocals — so it is exact
wherever the type is, and the whole right-hand spine of a tower runs at `Int`
whatever the base is. Negative exponents are meaningful for `Float` and `Rat`;
at `Nat`, `Int`, and `BigInt` they throw `NegativeExponentError`, because the
fractional result cannot inhabit the type. Dec also rejects every negative exponent,
including a reciprocal that could be written as a finite decimal.

The other power — the analyst's `exp(y · ln x)`, with a fractional exponent — is
a named function rather than an operator, because it belongs only where
approximation is the contract:

```hexagon
Float.pow(2.0, 0.5)     // the nearest float to the square root of two
```

Writing `x ** 0.5` is a type error, and the message points here. `BigInt.pow`
is the matching door for an exponent too large to be an `Int`.

One precedence rule follows mathematics where JavaScript refuses the expression:

```hexagon
-2 ** 2           // -(2 ** 2), which is -4
```

Hexagon emits the necessary JavaScript parentheses:

```js
-(2 ** 2);
```

There are no negative numeric literals underneath this rule. `-42` is negation applied
to the positive literal `42`, normally folded into the direct emitted value.

## Integer division uses names

The `%` operator does not exist in Hexagon. Languages disagree about what remainder
means for negative values, and one anonymous symbol conceals the disagreement. Hexagon
uses names that state the convention:

```hexagon
Int.div(a, b)      // Euclidean quotient
Int.mod(a, b)      // Euclidean remainder
Int.quot(a, b)     // quotient rounded toward zero
Int.rem(a, b)      // truncated remainder: JavaScript's % convention
```

`mod` is the mathematical default. Its result is always non-negative and smaller than
the absolute value of the divisor:

```hexagon
Int.mod(-7, 3)     // 2
Int.mod(7, -3)     // 1
```

`rem` is the interoperation and porting form:

```hexagon
Int.rem(-7, 3)     // -1, as in JavaScript
```

`BigInt` provides the same four operations. A zero divisor at either integer type
throws `DivideByZeroError`. Floating point already has true division, so it provides
only `Float.mod` and `Float.rem`; invalid floating operations produce `NaN` rather than
throwing.

The important lesson is not to memorize a numeric-library inventory. It is that the
ordinary spelling records the semantic choice. Use `mod` for a canonical non-negative
residue and `rem` when JavaScript's machine convention is specifically required.

## Concatenation is not addition

Strings join with `++`:

```hexagon
let greeting = "Hello, " ++ customerName ++ "!"
```

Using `+` is a type error with a suggestion to use `++`. JavaScript overloads `+` for
both addition and string conversion, which makes mixed expressions depend on coercion
and operand order. Hexagon keeps numeric addition and concatenation separate.

For concrete strings, the emitted operation is still JavaScript `+`:

```js
const greeting = "Hello, " + customerName + "!";
```

The source distinction is a static guarantee, not a request for extra runtime
machinery. Interpolation remains preferable when a string is mostly text; `++` is
useful when joining values that are already strings.

## Comparisons can form chains

Equality uses `==` and `!=`. Ordering uses `<`, `>`, `<=`, and `>=`:

```hexagon
status == "ready"
quantity != 0
subtotal < limit
```

These operators are type-directed. Numbers, strings, and Booleans have defined equality
and ordering. Functions do not have meaningful equality, so comparing two functions is
a compile error rather than JavaScript reference comparison leaking into the language.

Hexagon reads a run of comparisons as a chain:

```hexagon
0 <= discount <= 100
```

This means:

```hexagon
0 <= discount and discount <= 100
```

The middle expression is evaluated once, even when it is a call rather than a simple
name. Chains short-circuit from left to right.

The direction must remain consistent. `a < b > c` is rejected; write the two comparisons
with `and` when that unusual relationship is intentional. `!=` does not chain, because
`a != b != c` is too easily mistaken for “all three are distinct.” Equality may appear
within an otherwise consistently directed chain.

## Logic uses words

Boolean logic is written with `not`, `and`, `or`, `implies`, and `iff`:

```hexagon
eligible and not suspended
isAdmin or ownsOrder
winGame implies getPizza
leftValid iff rightValid
```

All operands must be `Bool`; truthiness never enters the calculation.

Evaluation is precise:

- `and` evaluates its right side only when the left side is `True`;
- `or` evaluates its right side only when the left side is `False`;
- `implies` describes a promise: `winGame implies getPizza` means “if we win, we get
  pizza.” The right side is checked only when the left side is `True`; and
- `iff` means the two Boolean values agree, so it evaluates both sides.

The pizza promise is broken only if `winGame` is `True` and `getPizza` is `False`. If
we do not win, this particular promise makes no demand about pizza. `implies` is less
common than `and` or `or` in application code, but when a rule really is a promise, it
says that rule directly.

Hexagon emits the corresponding native JavaScript logic. The words are the language's
only spellings: `&&`, `||`, and bare `!` are not alternative operators.

These five words are worth a second glance now that you know, from Chapter 2, that
`Bool` is a union the prelude declares. Unions are inspected with `match` and nothing
else — that is the rule the next chapters lean on constantly — and these operators are
`Bool`'s one exception to it, along with the condition of an `if` or a `while`. They can
be, because a `Bool` is a real JavaScript `boolean` underneath, so `and` really is `&&`
and `not` really is `!`, with no inspection happening at all.

`not` binds less tightly than a comparison, matching mathematical and plain-English
reading:

```hexagon
not status == "cancelled"
```

means:

```hexagon
not (status == "cancelled")
```

## Bitwise operations use words too

Masks, flags, packed fields, and hash functions work on the bits of an integer. Hexagon
spells those operations with words, like logic, so the two families can never be
confused:

```hexagon
let readable = 0b100
let writable = 0b010

let permissions = readable bor writable        // 6
let canWrite = permissions band writable != 0  // True
let withoutWrite = permissions band bnot writable
```

`band`, `bor`, and `bxor` are bitwise and, or, and exclusive or; `bnot` flips every
bit. Shifts are named operations rather than operators:

```hexagon
let packed = 0x12.shiftLeft(8) bor 0x34  // 0x1234
let high = packed.shiftRight(8)          // 0x12
```

A shift by a negative count shifts the other way, and a right shift rounds toward
negative infinity, so shifting a negative number far enough to the right reaches `-1`.

The operations work on `Int` and `BigInt`, and they compute the true integer answer at
both. That is the main difference from JavaScript, whose operators first cut every
number down to 32 bits:

```hexagon
let big = 1.shiftLeft(31)                 // 2147483648
let wrapped = 1.shiftLeft(31).toInt32()   // -2147483648, what JavaScript's 1 << 31 gives
```

When code really does mean 32-bit arithmetic, such as a hash ported from JavaScript, it
says so with `toInt32` or `toUint32` where the JavaScript reduced: `e | 0` becomes
`e.toInt32()`, and `e >>> 0` becomes `e.toUint32()`. There is no unsigned right shift;
`x >>> n` is written `x.toUint32().shiftRight(n)`, because "unsigned" only means
something once the width is named.

At `BigInt` the words compile to JavaScript's own operators, because JavaScript's
`bigint` already has exactly this meaning:

```hexagon
let masked = big band 0xFFn
```

```js
const masked = big & 0xFFn;
```

At `Int`, JavaScript's operators would give the 32-bit answer, so each operation
compiles to a call instead.

Integers of different types meet at the wider one, as they do under `+`: a `Nat` and an
`Int` give an `Int`, and an `Int` and a `BigInt` give a `BigInt`. `Nat` has no bitwise
operations of its own, because `bnot` of a natural number is negative. A written `Int`
type runs them on natural numbers, exactly as it runs subtraction:

```hexagon
let bits: Int = count band 0xF   // count : Nat
```

`band`, `bor`, and `bxor` are operators only directly after an operand. Anywhere else
they are ordinary names, so a variable called `band` still works. The two families
refuse each other's types, and each refusal names the spelling that was probably meant:
`p band q` on `Bool` suggests `and`, and `x and y` on `Int` suggests `band`. JavaScript's
`&`, `|`, `^`, `~`, `<<`, and `>>` are not Hexagon operators, and writing one draws the
same kind of redirect.

## A conditional produces a value

An inline conditional has both branches and produces the value of the selected one:

```hexagon
let shippingLabel =
    if international then "International" else "Domestic"
```

The condition must be `Bool`, and both branches must produce the same type. A
value-producing conditional states both paths: there is no `then`-less `if`, and
no value-producing `if` without `else` — an expression must say what it produces
on every path.

Longer branches keep `then` on the condition line and use layout for both branches:

```hexagon
let shippingLabel =
    if international then
        let region = destinationRegion(order)
        "International: ${region}"
    else
        "Domestic"
```

Each branch is a block, so the final-expression rule from the first chapter applies.
The first branch ends in a `String`, the second branch is a one-expression block, and
the whole `if` produces `String`.

Conditionals that exist only for an effect may leave the `else` path unwritten:

```hexagon
if delayed then
    Debug.log("Order delayed")
```

The missing branch is `()`, the unit value — the compiler supplies it. This is not
a special statement form; it is the same expression model: the conditional produces
`Unit` on both paths, one of them written for you. It also means an else-less `if`
can only produce `Unit` — if the `then` branch produces anything else, the compiler
asks for an explicit `else` branch to say what the other path produces.

## Pipes show the flow of values

We have already seen a single value sent into `ignore`. A longer chain makes the flow
especially clear:

```hexagon
dishes |> rinse |> wash |> dry
```

Read it from left to right: take the dishes, rinse them, wash them, then dry them. The
equivalent nested calls run in the opposite visual direction:

```hexagon
dry(wash(rinse(dishes)))
```

Each function receives the result of the preceding step. When a function needs other
arguments, the pipe inserts its left side as the first argument:

```hexagon
subtotal |> applyDiscount(discount)
```

rewrites to:

```hexagon
applyDiscount(subtotal, discount)
```

This is why the functions chapter established subject-first parameter order. A sequence
of transformations can now read in data-flow order:

```hexagon
let total = subtotal |> applyDiscount(discount) |> orderTotal(delivery)
```

The equivalent nested call is:

```hexagon
let total = orderTotal(applyDiscount(subtotal, discount), delivery)
```

A pipe chain proceeds from left to right and is rewritten before type inference; there
is no pipe object or runtime helper in the emitted code.

The right side may already contain the remaining arguments precisely because Hexagon
functions are n-ary.

## Precedence: the useful shape

From tightest to loosest, the operator groups are:

| Order | Forms |
|---|---|
| Tightest | field access `.`, calls `()`, indexing `[]` |
| | `bnot` |
| | exponentiation `**` |
| | unary `-` |
| | `*`, `/` |
| | `+`, `-`, `++` |
| | `band` |
| | `bxor` |
| | `bor` |
| | range `..` |
| | comparisons |
| | `not` |
| | `and` |
| | `or` |
| | `implies` |
| | `iff` |
| Loosest infix | pipe <code>&#124;&gt;</code> |

Most of this is the familiar mathematical order. The two rules most worth remembering
are that exponentiation binds inside unary minus on its left, and `not` applies to a
comparison before it applies to surrounding logic. The bitwise words sit between
arithmetic and comparison, `band` tightest, so `flags band mask == 0` compares the
masked value with zero, as it reads.

Conditionals and lambdas extend to the right rather than occupying an infix level:

```hexagon
x => x |> normalize
1 + if discounted then reduction else 0
```

The entire pipe is the lambda body, and the entire conditional is the right operand of
`+`. Parentheses remain available whenever making the grouping visible helps a reader.

## Summary

- Operator spellings are fixed; capability constraints determine which types support
  the algebraic and comparison operators.
- `/` is fractional division. Integer division and remainder use named operations whose
  names distinguish Euclidean `div`/`mod` from truncated `quot`/`rem`.
- Strings concatenate with `++`, not numeric `+`.
- Comparison chains are directional, short-circuiting, and single-evaluation.
- Logic uses words, requires `Bool`, and has explicit short-circuit rules.
- Bitwise operations use words too — `band`, `bor`, `bxor`, `bnot` — with named shifts,
  and compute the true integer answer at `Int` and `BigInt`; `toInt32` and `toUint32`
  name the 32-bit view.
- `if` is an expression; its branches are ordinary value-producing blocks.
- `|>` inserts its left side as the first argument and then disappears.
- Precedence follows mathematics, with `not` below comparisons and pipes looser than
  the rest of the infix vocabulary.

These forms complete the small expression language used throughout the opening
chapters. Before adding more of the type system, the next chapter makes explicit the
layout rules that have already been shaping every multi-line example.
