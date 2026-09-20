# Primitive Types

The previous chapter calculated an order total from two `Int` values:

```hexagon
export let orderTotal(subtotal: Int, delivery: Int): Int =
    let total = subtotal + delivery
    total
```

`Int` is one of the fundamental types introduced in this chapter. These are the
small values from which larger programs are assembled. Most use JavaScript primitive
values directly; `Dec` carries the extra information needed for exact decimals.

| Hexagon type | Example value | JavaScript / TypeScript |
|---|---|---|
| `Nat` | `42` | `number` |
| `Int` | `42` | `number` |
| `Float` | `3.14` | `number` |
| `Dec` | `3.140d` | opaque record |
| `Bool` | `True` | `boolean` |
| `String` | `"ready"` | `string` |
| `BigInt` | `42n` | `bigint` |
| `Unit` | `()` | `undefined` / `void` return |

An `Int` becomes an ordinary JavaScript number and a `String` an ordinary JavaScript
string. Hexagon checks distinctions before the program runs: integer mixtures use
permitted exact conversions, a string cannot wander into a condition, and
interpolation requires a meaningful display form.

The chapter title uses "primitive" in the everyday sense of fundamental building
blocks. These types need no import, but they do not all have the same kind of
definition. `Bool` is a prelude union, met properly in [Unions](10-unions.md);
`Unit` is the empty tuple, whose family [Tuples](07-tuples.md) introduces. `Dec`
is an opaque record: its public operations control construction and arithmetic.
[Records](09-records.md) explains that protection later.

## `Nat`: non-negative by construction

`Nat` represents whole numbers from zero through JavaScript's maximum safe integer.
It has the same unboxed `number` representation as `Int`, but its type records that a
negative value has already been excluded:

```hexagon
let pageSize: Nat = 50
let retryLimit: Nat = 3
```

Nat is useful when non-negativity is the whole invariant and the value is counted,
displayed, compared, or iterated. At an untrusted boundary, `Nat.fromInt` returns an
`Option(Nat)`, allowing the program to validate once and carry the fact in the type.

Nat supports numeric literals, addition, and multiplication through `Num`. It does not
support subtraction or negation through `Signed`: those operations can leave the
non-negative domain. This makes Nat a useful refinement, not a replacement for Int.
Bare literals still default to Int, because ordinary application arithmetic often
needs subtraction:

```hexagon
let ordinary = 3        // Int
let counted: Nat = 3    // Nat
```

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

An unsuffixed numeric literal containing a decimal point or exponent is a `Float`:

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
displayed as `0.30000000000000004`. When exact decimal behavior matters, choose `Dec` and write the `d` suffix.
The choice of type determines which arithmetic the program performs.

`Int` and `Float` are distinct Hexagon types even though both become `number` at the
JavaScript boundary. The distinction lets Hexagon reject fractional values where whole
numbers are required and give arithmetic the appropriate semantics. The generated
TypeScript type cannot preserve that distinction; both appear as `number`.

When you deliberately want an `Int`, the operation's name says how the fractional part
is handled:

```hexagon
3.7.floor()       // 3: toward negative infinity
(-3.7).ceil()     // -3: toward positive infinity
(-3.7).trunc()    // -3: toward zero
2.5.round()       // 3: nearest, halfway values away from zero
2.5.roundEven()   // 2: nearest, halfway values to the even integer
3.5.roundEven()   // 4
```

`round` is the symmetric rule often taught at school: `(-2.5).round()` is `-3`, not the
`-2` JavaScript's asymmetric `Math.round` produces. `roundEven` differs only for exact
halfway values; choosing the even neighbour can reduce systematic tie bias when rounded
values are distributed across even and odd neighbours.

All five functions return `Int`, so they check the result against its safe range. A
`NaN`, an infinity, or a rounded result beyond that range throws `IntRangeError`. A zero
result is ordinary `Int` zero even when the source was negative: an IEEE negative-zero
sign does not cross into the integer world.

## `Dec`: exact decimals with retained places

Suppose an order uses decimal prices. Start with exact decimal inputs:

```hexagon
let price = 1.50d
let quantity = 3
let total = price * quantity
let receipt = "Total: ${total}"  // "Total: 4.50"
```

The `d` suffix chooses `Dec`. Its digits are read exactly, and it remembers how
many digits were written after the point, including zeros. `1.50d` retains two
**decimal places**. This counts fractional digits, not the total significant digits
in the number. `0.050d` retains three places; `5d` retains zero.

Separators do not count as digits: `1_000.00d` retains two places. A written point
needs digits on both sides, so use `0.5d`, not `.5d` or `5.d`. Dec literals use
ordinary notation; `5e2d` is not permitted.

Addition and subtraction retain the larger operand's decimal-place count:

```hexagon
1.50d + 2.005d  // 3.505
1.50d - 1.50d   // 0.00
0.1d + 0.2d    // 0.3, exactly
```

Multiplication adds the counts. Internally, a Dec stores an arbitrary-precision
integer coefficient and a decimal-place count: `1.50d` is `150` divided by `100`,
and `2.00d` is `200` divided by `100`. Multiplying the coefficients gives `30000`;
multiplying the denominators gives `10000`. The result therefore has four places:

```hexagon
1.50d * 2.00d  // 3.0000
1.50d * 2     // 3.00
```

An established `Nat`, `Int`, or `BigInt` can enter Dec exactly at zero decimal
places. That explains why multiplying by the integer `2` preserves two places.
There is no conversion from `Float` to `Dec`: an approximate input cannot recover
its intended decimal digits. Begin with exact inputs instead.

Retained places affect display, while equality and ordering compare numbers:

```hexagon
1.50d == 1.500d          // True
1.50d.show()             // "1.50"
1.500d.show()            // "1.500"
```

Consequently, `5d` and `5.00d` also denote the same map key and match the same
values in a pattern. A `5.00d` arm after a `5d` arm is unreachable. Later chapters
return to collections and matching; neither treats the displayed zeros as a new
numerical value.

Division requires a rounding choice because a quotient such as one third has no
finite exact decimal expansion. Dec has no `/` operator. Choose the result's
places explicitly:

```hexagon
1d.divideTo(3d, 2)             // 0.33
1d.divideTo(8d, 2)             // 0.13
1d.divideToEven(8d, 2)         // 0.12
4.50d.multiplyTo(0.15d, 2)    // 0.68
1.245d.withDecimalPlaces(2)   // 1.25
```

These operations round once from the exact answer and retain exactly the requested
places. Their default rule is nearest, with ties away from zero. Each has an
`Even` variant choosing the even final digit at a tie: `withDecimalPlacesEven`
and `multiplyToEven` follow the same rule as `divideToEven`. They differ only at
ties; they do not round every answer to an even number. Increasing the places
appends zeros without changing the number.

As with Float, `round`, `roundEven`, `floor`, `ceil`, and `trunc` round to whole
numbers. For Dec they return `BigInt`, so large whole-number results stay exact:
`(-2.5d).round()` returns `-3n`, while `(-2.5d).roundEven()` returns `-2n`.

Use `show` for everyday inspection. For an adapter needing the stored parts,
`5.00d.value()` returns the unscaled integer `500n`, and
`5.00d.decimalPlaces()` returns `2`. `Dec.create(500n, 2)` constructs that same
value. The accessor called `value` does not return five as a whole number.

Dec has no NaN, infinity, or negative zero. Its coefficient is limited by available
resources; its decimal-place count uses Nat's full range. Exact multiplication
and powers throw `DecimalPlacesOverflowError` if the retained count exceeds that
range. Large permitted counts can still demand more memory than a machine has.
Dec supplies decimal arithmetic and display; currency identity and currency
formatting belong to the application's domain.

## `Bool`: a condition, not a truthiness convention

`Bool` has the two values familiar from JavaScript, spelled the way Hexagon spells the
cases of any union — capitalised:

```hexagon
True
False
```

They are not literals. `True` and `False` are the two constructors of the prelude's

```hexagon
union Bool derives (Eq, Ord, Show, Hash) = False | True
```

which is a declaration you could have written yourself. Nothing about it is built in
except one thing the compiler promises quietly: a `Bool` is a JavaScript `boolean` at
runtime and a `boolean` in the generated TypeScript, so nothing is paid at the boundary
for the extra honesty. [Unions](10-unions.md) returns to this.

The lowercase `true` and `false` are reserved words that mean nothing. Writing one is an
error, and the error names its own fix — "write `True`" — because a JavaScript
programmer's fingers will type it for years.

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
truthy, whether `NaN` counts as `False`, whether an absent foreign value is present—from
the meaning of ordinary control flow.

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
capability, which we will study with constraints. Numbers, strings, `Unit`, and many
structured values have meaningful display forms; so does a `Bool`, which displays as its
constructor name, `True` or `False`, exactly as any other union case does. Functions do
not have a display form. Hexagon
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

At the JavaScript boundary Hexagon accepts every JavaScript string, including the
unusual strings that contain an unmatched UTF-16 surrogate. Such a value is preserved
as one codepoint-sized item rather than rejected or silently changed to `�`. Source
files and `\u{...}` escapes remain Unicode-scalar text, so ordinary Hexagon source does
not create these values; the rule keeps foreign strings exact and round-trippable.

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
Unicode-sensitive library behavior uses compiler-shipped Unicode 17.0.0 data rather
than inheriting whichever Unicode version happens to be installed in the host runtime.

## `BigInt`: arbitrary precision by choice

Most programs use `Int` and `Float`. The `n` suffix means what it means in JavaScript:
this literal itself is a `BigInt`. It is the preferred compact annotation when no
surrounding context pins the type, and it is mandatory when a payload exceeds Int's
safe range:

```hexagon
let exactPopulation = 9_007_199_254_740_993n
let cryptographicModulus = 340_282_366_920_938_463_463_374_607_431_768_211_507n
```

These literals have type `BigInt` and compile directly to JavaScript `bigint` values.
Their size is limited by available resources rather than a fixed numeric range.

When a parameter or annotation already requires BigInt, bare digits are the recommended
spelling:

```hexagon
let oneThird = Rat.create(1, 3)
```

Both arguments are pinned by `Rat.create`'s BigInt parameters, so the emitted JavaScript
is `Rat.create(1n, 3n)`. The suffix communicates a type decision; it need not repeat one
the surrounding program has already made.

The suffix is a visible decision. `BigInt` is valuable, but it is not a drop-in
replacement for JavaScript's ordinary numbers: many web APIs expect `number`, JSON
serialization does not accept `bigint` by default, and JavaScript itself rejects mixed
`number`/`bigint` arithmetic. Hexagon can supply the exact integer conversion:

```hexagon
let small = 3
let large = 3n
let total = small + large  // 6n: small enters BigInt exactly
```

An established `Rat` destination can likewise accept a BigInt without losing any
integer digits:

```hexagon
import Rat
let count = 9_007_199_254_740_993n
let exact: Rat = count
let half = count * Rat.create(1, 2)
```

This friendliness has a boundary. BigInt does not implicitly enter Float, and
converting it back to Int can fail outside the safe range. Those operations remain
explicit. A BigInt literal still has its own type; the surrounding destination
licenses any exact conversion.

## `Unit`: one value, no interesting result

We met `Unit` when sequencing effects. It has exactly one value:

```hexagon
()
```

Returning to it here completes the primitive picture. `Unit` is a genuine type, not
the absence of a type. A function that prints a message and produces no interesting
result returns `Unit`. A block may sequence that call because the discarded value is
known to carry no information.

Those parentheses are not a coincidence of spelling. `Unit` is the empty tuple — a
tuple with no positions — and that is the whole reason it has exactly one value: with
nothing to fill in, there is nothing to vary. [Tuples](07-tuples.md) introduces the
rest of the family.

At runtime, `()` becomes `undefined`. In a TypeScript parameter or stored-value
position, its face is `undefined`; as a function return, idiomatic declarations use
`void`.

This is the same relationship we saw throughout the chapter: Hexagon adds a precise
static meaning while retaining the JavaScript value that naturally represents it.

## Summary

These fundamental types give ordinary values distinct meanings:

- `Nat` records a non-negative safe-range whole number without changing its JS representation;
- `Int` is the ordinary signed safe-range whole number and usually the type of a bare integer
  literal;
- `Float` is IEEE 754 binary64 and is selected by an unsuffixed decimal point or exponent;
- `Dec` uses the `d` suffix for exact decimal arithmetic and retained decimal places;
- `Bool` is the condition type, with constructors `True` and `False` and no truthiness
  conversions;
- `String` has one interpolating, multiline literal form and codepoint-based text
  operations;
- `BigInt` provides arbitrary precision; `n` pins an otherwise unpinned literal and is mandatory beyond Int's range; and
- `Unit` is the one-value type — the empty tuple — used when an expression has no
  interesting result.

Most of these types use JavaScript primitive representations. Dec uses an opaque
record to retain its exact coefficient and decimal places. Types make distinctions
visible to Hexagon even where JavaScript or generated TypeScript erases them,
notably the distinction between `Int` and `Float`.

Later chapters will explain how operators choose behavior for these types, how bare
integer literals participate in inference, how `Show` powers interpolation, and how
string indexing fits the broader collection model. For now, the primitive values are
ready to serve as the vocabulary of larger examples.
