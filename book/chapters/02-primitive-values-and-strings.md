# Primitive Values and Strings

The previous chapter calculated an order total from two `Int` values:

```hexagon
export let orderTotal(subtotal: Int, delivery: Int): Int =
  let total = subtotal + delivery
  total
```

`Int` is one of the **six primitive types**. These are the small values from which larger
programs are assembled:

| Hexagon type | Literal | JavaScript / TypeScript |
|---|---|---|
| `Int` | `42` | `number` |
| `Float` | `3.5` | `number` |
| `BigInt` | `42n` | `bigint` |
| `Bool` | `true` | `boolean` |
| `String` | `"ready"` | `string` |
| `Unit` | `()` | `undefined` / `void` return |

There are no wrapper objects around these values. An `Int` becomes an ordinary
JavaScript number, a `String` becomes an ordinary JavaScript string, and so on. The
differences Hexagon adds are checked before the program runs: an integer cannot be
silently mixed with a `BigInt`, a string cannot wander into a Boolean condition, and
interpolation cannot stringify a value that has no meaningful display form.

## `Int`: the ordinary whole number

Whole-number literals normally become `Int`:

```hexagon
let quantity = 4
let attendees = 12_500
let millisecondsPerSecond = 1_000
```

Underscores may separate digits for readability. They do not affect the value, and
Hexagon does not enforce groups of three. Each underscore must simply have a digit on
both sides, so `12_500` is legal while `_12500`, `12500_`, and `12__500` are not.

Strictly speaking, a bare integer literal begins as a numeric value whose exact type
can be determined by its surroundings. In an unconstrained binding such as the ones
above, Hexagon defaults it to `Int`. This distinction will become useful when we study
type inference and numeric constraints. For now, `Int` is the right expectation for an
ordinary whole number without a suffix.

An `Int` is represented by a JavaScript `number`, but Hexagon maintains a whole-number
invariant. Its exact range is:

```text
−(2^53 − 1) through 2^53 − 1
```

That is the same safe-integer range JavaScript exposes through
`Number.isSafeInteger`. It comfortably covers array positions, counters, timestamps,
file sizes, and money represented in minor units for most applications. It is not
arbitrary precision.

Arithmetic emits as direct JavaScript arithmetic:

```hexagon
let total = subtotal + delivery
```

```js
const total = subtotal + delivery;
```

The cost of that simplicity is an honest boundary: overflowing the safe range does not
throw. The underlying floating-point arithmetic may silently round. Code operating
near the boundary should use checked integer operations or choose `BigInt`. Writing a
literal already outside the safe range is caught earlier and suggests the `n` suffix.

## `Float`: fractional and scientific values

A numeric literal containing a decimal point or exponent is a `Float`:

```hexagon
let temperature = 21.5
let probability = 0.125
let populationEstimate = 1e9
let electronMass = 9.109_383_713_9e-31
```

Unlike a bare integer literal, these forms are always `Float`. `1e9` may describe a
whole mathematical number, but the exponent marks it as floating point.

`Float` is IEEE 754 double-precision floating point—the same value space as a
JavaScript number. It includes `NaN`, positive and negative infinity, and negative zero.
The familiar approximation rules apply:

```hexagon
let surprising = 0.1 + 0.2
```

The value of `surprising` is the same approximation JavaScript produces, commonly
displayed as `0.30000000000000004`. Hexagon does not hide that fact behind decimal
wrappers or special arithmetic. When exact decimal behavior matters, use an appropriate
library type rather than mistaking binary floating point for decimal arithmetic.

`Int` and `Float` are distinct Hexagon types even though both become `number` at the
JavaScript boundary. The distinction lets Hexagon reject fractional values where whole
numbers are required and give arithmetic the appropriate semantics. The generated
TypeScript type cannot preserve that distinction; both appear as `number`.

## `BigInt`: arbitrary precision by choice

Append `n` when a whole number must not be limited by the safe-integer range:

```hexagon
let exactPopulation = 9_007_199_254_740_993n
let cryptographicModulus = 340_282_366_920_938_463_463_374_607_431_768_211_507n
```

These literals have type `BigInt` and compile directly to JavaScript `bigint` values.
Their size is limited by available resources rather than a fixed numeric range.

The suffix is a visible decision. `BigInt` is valuable, but it is not a drop-in
replacement for JavaScript's ordinary numbers: many web APIs expect `number`, JSON
serialization does not accept `bigint` by default, and JavaScript itself rejects mixed
`number`/`bigint` arithmetic. Hexagon catches that mixture statically:

```hexagon
let small = 3
let large = 3n
let invalid = small + large
```

The final line is a type error. Convert deliberately in the direction appropriate to
the program. Converting `Int` to `BigInt` is exact; converting a `BigInt` back to `Int`
can fail when the value is outside the safe range.

## `Bool`: a condition, not a truthiness convention

`Bool` has the two values familiar from JavaScript:

```hexagon
true
false
```

What Hexagon does not inherit is JavaScript truthiness. A condition must have type
`Bool`. Empty strings, zero, collections, `Unit`, and user-defined values are not
implicitly converted:

```hexagon
if quantity then "many" else "none"
```

If `quantity` is an `Int`, this is a type error. State the condition being tested:

```hexagon
if quantity > 0 then "some" else "none"
```

The rule removes a large family of boundary cases—whether an empty collection is
truthy, whether `NaN` is false, whether an absent foreign value is present—from the
meaning of ordinary control flow.

## `String`: one literal form

Hexagon strings use double quotes:

```hexagon
let status = "ready"
let empty = ""
```

There is no separate template-string syntax. The ordinary string literal also supports
interpolation:

```hexagon
export let orderSummary(subtotal: Int, delivery: Int): String =
  let total = orderTotal(subtotal, delivery)
  "Order total: ${total}"
```

`${total}` evaluates the expression and inserts its human-readable display. For this
concrete `Int`, the emitted JavaScript can remain a direct template literal:

```js
export const orderSummary = (subtotal, delivery) => {
  const total = orderTotal(subtotal, delivery);
  return `Order total: ${total}`;
};
```

Interpolation is checked rather than universal. Internally it uses the `Show`
capability, which we will study with constraints. Numbers, Booleans, strings, `Unit`,
and many structured values have meaningful display forms. Functions do not. Hexagon
therefore rejects an attempt to interpolate a function instead of producing its source
text or JavaScript's occasional `[object Object]` embarrassment.

Displaying a string does not add quotation marks. If `customerName` is `"Mira"`, then
`"Hello, ${customerName}!"` produces `"Hello, Mira!"`.

### Multiline strings and escapes

The same double-quoted form may contain literal newlines:

```hexagon
let message = "First line
Second line"
```

The newline is part of the string. Familiar escapes include `\n`, `\t`, `\r`, `\\`,
`\"`, and Unicode codepoint escapes such as `\u{1F642}`.

Because `${` begins interpolation, write `\${` to include those characters literally:

```hexagon
let templateHelp = "Write \${name} to insert a name."
```

A dollar sign not followed by `{` needs no escape. The spelling `#{` is reserved for a
possible future debug-display form; write `\#{` when those literal characters must
appear together.

## Strings are sequences of codepoints

JavaScript stores strings as UTF-16 code units. Hexagon keeps that efficient native
representation, but it does not expose code units as the ordinary meaning of a text
position. String length, indexing, and traversal operate on Unicode codepoints.

Consider an ordinary greeting:

```hexagon
let greeting = "🙂 Hi!"
```

Hexagon regards this string as five codepoints: `🙂`, the space, `H`, `i`, and `!`.
JavaScript's `greeting.length` reports six because `🙂` occupies a UTF-16 surrogate
pair. Hexagon's string operations report five—the count that is useful when walking the
text as Unicode codepoints.

There is no separate `Char` primitive. Indexing or iterating a string produces a
one-codepoint `String`. Positions are one-based, like other Hexagon sequence positions.
Detailed indexing, slicing, and iteration belong with collections; the fact to retain
here is that text operations count codepoints rather than UTF-16 storage units.

A codepoint is still not necessarily what a person perceives as one written character.
The plain thumbs-up `👍` is one codepoint, like `🙂`. Add a skin tone and `👍🏽` becomes
two codepoints—thumbs-up plus modifier—even though a reader normally perceives one
emoji. Combining marks and other emoji sequences can be longer still.

That human-perceived unit is called a grapheme. Grapheme segmentation is a higher-level,
Unicode-aware library concern. Hexagon's primitive rule is stable and explicit rather
than pretending UTF-16 units, codepoints, and visible characters are always the same.

## `Unit`: one value, no interesting result

We met `Unit` when sequencing effects. It has exactly one value:

```hexagon
()
```

Returning to it here completes the primitive picture. `Unit` is a genuine type, not
the absence of a type. A function that prints a message and produces no interesting
result returns `Unit`. A block may sequence that call because the discarded value is
known to carry no information.

At runtime, `()` becomes `undefined`. In a TypeScript parameter or stored-value
position, its face is `undefined`; as a function return, idiomatic declarations use
`void`.

This is the same relationship we saw throughout the chapter: Hexagon adds a precise
static meaning while retaining the JavaScript value that naturally represents it.

## What to carry forward

Hexagon's primitive types are intentionally close to JavaScript without being ruled by
JavaScript's implicit conversions:

- `Int` is the ordinary safe-range whole number and usually the type of a bare integer
  literal;
- `Float` is IEEE 754 binary64 and is selected by a decimal point or exponent;
- `BigInt` is arbitrary precision, selected explicitly with `n`;
- `Bool` permits no truthiness conversions;
- `String` has one interpolating, multiline literal form and codepoint-based text
  operations; and
- `Unit` is the one-value type used when an expression has no interesting result.

All six use native JavaScript representations. Types make their distinctions visible to
Hexagon even where JavaScript or generated TypeScript erases one—most notably the
distinction between `Int` and `Float`.

Later chapters will explain how operators choose behavior for these types, how bare
integer literals participate in inference, how `Show` powers interpolation, and how
string indexing fits the broader collection model. For now, the primitive values are
ready to serve as the vocabulary of larger examples.
