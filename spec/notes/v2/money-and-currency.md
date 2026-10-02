# Money and Currency — v2 proposal

**Status:** Proposal for v2, written 2026-10-02. Not decided, and not v1 work. The
standard library's `Money` and `Currency` are v2. Users can build the same design
themselves in v1 (§7), once #1188 is fixed. Every code block except §5's sketch
comes from the prototype in Appendix A, which compiled and ran against `main` at
`4076a38f`; the outputs and error messages shown are the real ones.

**Origin.** A conversation outside the repository proposed `Money(C)` over `Dec`
with a phantom currency and a `Currency` trait, written in Scala and Haskell terms.
This note is that design checked against Hexagon as it is: what carries over, what
had to change, and what stays open.

---

## 1. Goal

`Dec` is the engine and does not change (`dec.md`). Money is not a new kind of
number. It is a `Dec` with three guarantees added:

1. **The currency is in the type.** Adding dollars to yen is a compile error.
2. **The scale is fixed per currency.** Every `Money(USD)` has exactly two decimal
   places and every `Money(JPY)` has none. So the `Dec`'s unscaled integer is
   always a count of the currency's minor units: cents, or whole yen.
3. **Rounding happens only at named doors.** Money arithmetic never rounds. A
   calculation that needs more places, such as tax or interest, leaves Money as a
   plain `Dec`, and comes back through a function that says how it rounds.

`dec.md` §1 already sends this work to later library work: "Currency identity,
exchange rates as domain values, settlement increments, allocation, and
locale-specific currency formatting".

## 2. The shape

```hexagon
module Money

export union USD = USD
export union EUR = EUR
export union JPY = JPY

opaque record Money(c) derives (Eq, Ord) = { amount: Dec }

export constraint Currency<c> =
    marker() -> c
    code(currency: c) -> String
    minorUnits(currency: c) -> Int

honor Currency<USD> =
    marker() = USD
    code(currency) = "USD"
    minorUnits(currency) = 2
```

**The phantom parameter.** No field of `Money(c)` uses `c`. It only makes
`Money(USD)` and `Money(JPY)` different types. That works because a declared type
is compared by name and arguments and is never opened up (Declarations Preamble
§3, which makes phantom parameters legal on `record` and `union`; §5.3 refuses
them on a `type` alias, where they would do nothing). Types are erased, so at
runtime a Money is `{ amount: {unscaled, places} }`.

`c` can be any type, so `Money(Int)` is a legal type. But no one can make one: the
record is opaque, and every door that builds a Money requires `Currency<c>`.

**Marker types.** `union USD = USD` declares a type `USD` and its only value, also
spelled `USD`. `Money(USD)` uses the type. `Money.of(19.99, Money.USD)` uses the
value, whose job is to bring its type into the call.

**Why every member mentions `c`.** A constraint member must mention its subject,
or no call could choose the instance (Constraints §2). So a member like
`minorUnits() -> Int` is refused. Two shapes satisfy the rule:

- `code` and `minorUnits` take the marker value, `currency: c`.
- `marker() -> c` mentions `c` in its result, so the expected type chooses the
  instance. Code that holds only a `Money(c)`, or only a type, reaches the
  currency's value through it:

```hexagon
let currencyOf<c: Currency>(money: Money(c)): c = marker()

honor<c: Currency> Show<Money(c)> =
    show(money) = "${money.amount.show()} ${code(currencyOf(money))}"
```

**Deriving.** `derives (Eq, Ord)` works and asks nothing of `c`; the markers derive
nothing. Both compare by value, through `Dec`'s own `Eq` and `Ord`.

**Why opaque.** There are two reasons:

- **The scale guarantee.** A transparent record would let outside code write
  `Money.Money({amount = 1.234})` at JPY. Measured: it compiles.
- **The TypeScript face.** An opaque type's `.d.ts` brand carries `c`
  (`{ readonly [MoneyBrand]: a }`), so TypeScript keeps currencies apart too. A
  transparent record's face drops it today (#1188).

## 3. Operations

| Group | Function | Result |
|---|---|---|
| Entering | `of(amount: Dec, currency: c)` | `Money(c)`, rounded to the currency's places, ties away from zero |
| | `ofEven(amount: Dec, currency: c)` | the same, ties to even |
| | `fromDec(amount: Dec)` | `Money(c)`, currency chosen by the expected type |
| | `zero(currency: c)` | `Money(c)` |
| Staying | `add`, `subtract`, `negate` | `Money(c)`; never rounds |
| | `==`, `<`, … | through the derived `Eq` and `Ord` |
| | `allocate(money, weights: Vector(Nat))` | `Vector(Money(c))` that sums exactly to `money` |
| Leaving | `amount(money)` | `Dec` |
| | `times(money, factor: Dec)` | `Dec`, exact, with places added as `Dec` multiplication adds them |
| | `ratio(left, right, places: Int)` | `Dec`, through `Dec.divide` |
| Crossing | `rate(factor: Dec, from: a, to: b)` | `Rate(a, b)` |
| | `convert(money: Money(a), rate: Rate(a, b))` | `Money(b)`, ties away from zero |
| | `convertEven` | the same, ties to even |

**Rounding follows `Dec`.** `dec.md` §5 makes the plain name round ties away from
zero and gives an `Even` sibling for ties to even. Money does the same: `of` and
`ofEven`, `convert` and `convertEven`. There is no rounding-mode argument.

**Two ways in.** The marker door names the currency at the call:

```hexagon
let price = Money.of(19.999, Money.USD)       // 20.00 USD
```

The annotation door lets the declared type choose it:

```hexagon
let fee: Money.Money(Money.EUR) = Money.fromDec(9.995)   // 10.00 EUR
```

Without the annotation, `Money.fromDec(1)` is refused: "`Currency` is not a
defaultable constraint; add a type annotation to pin it". The literals in both are
`Dec` already (#525: a decimal literal promotes at a concrete expected `Dec`).

**Leaving and coming back.** Tax is the typical case:

```hexagon
let total = Money.of(21.50, Money.USD)
let taxDue = Money.of(total.times(0.0825), Money.USD)   // times: 1.773750; of: 1.77 USD
```

The only rounding is the `of`, written where the reader can see it.

**`allocate`.** Splitting money by weights is where naive code loses or invents a
cent. The prototype works in minor units:

1. Each share gets the floor of `units × weight ÷ total weight`.
2. The units left over (fewer than the number of non-zero weights) go out one at a
   time, in order, to shares with a non-zero weight.
3. A negative amount is split by magnitude and the sign put back. A zero weight
   gets exactly zero, and weights that sum to zero throw `DivideByZeroError`.

```hexagon
Money.of(100, Money.USD).allocate([1, 1, 1])     // 33.34, 33.33, 33.33
Money.of(-0.05, Money.USD).allocate([3, 0, 7])   // -0.02, 0.00, -0.03
```

This is Fowler's `allocate` from the Money pattern. Which share gets the leftover
units is open (§8, Q5).

**Exchange rates.** `Rate(from, to)` is phantom at both ends, so a rate can only be
applied to its own source currency:

```hexagon
let usdToJpy = Money.rate(151.2345, Money.USD, Money.JPY)
total.convert(usdToJpy)    // 3252 JPY
yen.convert(usdToJpy)      // refused: expected USD, found JPY
```

## 4. No `Num`, and what that costs

Money does not honor `Num`. Hexagon's tower is split by operator:

| Constraint | Members | Operators |
|---|---|---|
| `Num` | `add`, `multiply`, `fromNat` | `+`, `*`, bare literals |
| `Signed<a: Num>` | `subtract`, `negate`, `fromInt` | `-` |
| `Frac<a: Signed>` | `divide` | `/` |

Honoring `Num` would bring two things Money must not have:

- **`*`.** Dollars times dollars is not money, and `Dec` multiplication doubles the
  places, which breaks the scale guarantee.
- **`fromNat`.** `let m: Money(USD) = 5` would compile, and the reader can't tell
  whether that means dollars or cents.

`-` lives in `Signed`, which requires `Num`, so Money can't have `-` either. Money
therefore uses named functions: `subtotal.add(tax).subtract(discount)` instead of
`subtotal + tax - discount`. Today `price + price` is refused: "type `Money(USD)`
has no `Num` instance".

**Getting the operators back would be a language change.** The original
conversation suggested an `Additive` trait below `Num` holding `+`, `-`, `negate`
and zero. In Hexagon, `Num` is not that trait, because it includes `*`. Adding it
would reorganise the closed tower: `Num` and `Signed` would lose members, every
numeric type would gain an honor, `+` and `-` would go through the new rung, and
friendly numerics' expected-type lift would have to learn it. That is Q1. Money
works without it; only the operators wait on it.

## 5. Currencies known only at runtime

A phantom currency helps only when the currency is known at compile time. A
currency read from data, such as a database column, needs a value that carries its
currency at runtime: `{ currency: CurrencyCode, amount: Dec }`, whose operations
check that the currencies match and return a `Result`. A door from it into typed
Money would check once, at the edge:

```hexagon
Money.expect(tagged, Money.USD)   // Result(Money(USD), CurrencyMismatch)
```

Not prototyped. Q8.

## 6. The original conversation's claims, checked

| Claim | In Hexagon |
|---|---|
| Money can't simply be a `Num` instance, because `Num` gives `*` and `/` | Half right. `Num` gives `*` (and literals), but `/` is `Frac`, and `Dec` doesn't honor `Frac` (`Dec.divide` takes a places count) |
| Split `Num` into `Additive` and `Num` | Possible only as a change to the closed tower (§4, Q1) |
| Rounding back into Money uses `Dec`'s private rescale | Not needed: `Dec.withPlaces`, `withPlacesEven`, `places`, `unscaled` and `create` are public. Money wraps a `Dec`; it doesn't share `Dec`'s record |
| `round(d, mode: Rounding)` | Hexagon pairs names instead (`of` / `ofEven`), per `dec.md` §5 |
| `trait Currency(C)` with `minorUnits: Int` | Refused: a member must mention `c` (§2) |
| Scala 3's `using` | Hexagon's `<c: Currency>` binder, which reads like Scala's context bound. Hexagon drops the scoping: one instance per type, found by type alone, never passed by hand (Constraints §5) |
| A transparent record would lose the phantom | Wrong inside Hexagon, where a declared record is nominal. Right at the TypeScript boundary, where the face drops it (#1188) |
| `c` is not an associated type | Right. An implied type is decided by the `honor`; `c` is chosen by the caller |

## 7. What v1 already gives users

All of §2–§3 compiles today with no language change. A user can also add a
currency of their own in their own module:

```hexagon
module Crypto
import Money

export union BTC = BTC

honor Money.Currency<BTC> =
    marker() = BTC
    code(currency) = "BTC"
    minorUnits(currency) = 8

// Money.of(0.123456789, BTC) shows as 0.12345679 BTC
```

The honor lives beside the marker, so this is not an orphan instance (Constraints
§5.3). A second `Currency<USD>` in another module is refused as an orphan.

**The v1 dependency is #1188.** A non-opaque phantom type loses its parameter in
the `.d.ts`, so TypeScript callers could mix currencies. An opaque Money is already
fine.

**Diagnostics noticed while prototyping (not filed):**

- A currency mismatch reports the innermost pair, `expected JPY, found USD`,
  rather than `expected Money(JPY), found Money(USD)`.
- An unannotated `Money.fromDec(1)` says it "cannot default to `Int`", which is the
  generic wording and reads oddly for a currency.

## 8. Open questions for v2

- **Q1. Operators.** Add a rung below `Num` so Money gets `+` and `-` (§4), or keep
  named functions for good.
- **Q2. Where the markers live.** The standard library could ship one marker per
  ISO 4217 currency (about 180 types plus their minor units), or users could
  declare the ones they need, as in §7. James's post-v1 commitment of 2026-08-08,
  not yet written into the spec, is to build cultural data such as calendars and
  currencies natively rather than delegate to JavaScript's `Intl`. That points at
  shipping them. The cost is owning the data: ISO 4217 changes slowly, but it does
  change.
- **Q3. One door or two.** Keep both the marker door (`of(amount, USD)`) and the
  annotation door (`fromDec(amount)` at `Money(USD)`), or only one.
- **Q4. An `Amount(c)` type.** In this design, intermediate results are plain
  `Dec`, so nothing stops a USD calculation being rounded into `Money(EUR)`.
  `Amount(c)` would be the same record with the currency kept and no places rule:
  `times` would return `Amount(c)`, and `of` would take one. Haskell's `safe-money`
  draws the same line between a `Dense` and a `Discrete` amount.
- **Q5. Who gets the leftover units in `allocate`.** First come, as prototyped, or
  largest remainder, which is fairer when weights are uneven.
- **Q6. Cash rounding.** Some currencies are settled in steps larger than their
  minor unit (Swiss francs in 0.05). That is a second scale, separate from
  `minorUnits`; `dec.md` §1 calls it "settlement increments".
- **Q7. Display.** `Show` gives `21.50 USD`. Locale formatting (symbols, grouping,
  where the sign and symbol go) belongs to the i18n work, not to `Show`.
- **Q8. Runtime-tagged money** (§5): its type, its mismatch error, and the door
  into typed Money.
- **Q9. Where rates come from.** The same 2026-08-08 discussion made live sources
  such as exchange rates a `Stream` seam, so Money itself stays pure. `Rate` would also
  need an inverse, which needs a places count, since `1 ÷ rate` is rarely exact.

---

## Appendix A. The prototype

`Money.hex`, as compiled and run for this note:

```hexagon
module Money

export union USD = USD
export union EUR = EUR
export union JPY = JPY

opaque record Money(c) derives (Eq, Ord) = { amount: Dec }

opaque record Rate(from, to) = { factor: Dec }

export constraint Currency<c> =
    marker() -> c
    code(currency: c) -> String
    minorUnits(currency: c) -> Int

honor Currency<USD> =
    marker() = USD
    code(currency) = "USD"
    minorUnits(currency) = 2

honor Currency<EUR> =
    marker() = EUR
    code(currency) = "EUR"
    minorUnits(currency) = 2

honor Currency<JPY> =
    marker() = JPY
    code(currency) = "JPY"
    minorUnits(currency) = 0

let currencyOf<c: Currency>(money: Money(c)): c = marker()

export let of<c: Currency>(amount: Dec, currency: c): Money(c) =
    Money({amount = amount.withPlaces(minorUnits(currency))})

export let ofEven<c: Currency>(amount: Dec, currency: c): Money(c) =
    Money({amount = amount.withPlacesEven(minorUnits(currency))})

export let fromDec<c: Currency>(amount: Dec): Money(c) = of(amount, marker())

export let zero<c: Currency>(currency: c): Money(c) = of(0, currency)

export let amount(money: Money(c)): Dec = money.amount

export let add(left: Money(c), right: Money(c)): Money(c) =
    Money({amount = left.amount + right.amount})

export let subtract(left: Money(c), right: Money(c)): Money(c) =
    Money({amount = left.amount - right.amount})

export let negate(money: Money(c)): Money(c) = Money({amount = -money.amount})

export let times(money: Money(c), factor: Dec): Dec = money.amount * factor

export let ratio(left: Money(c), right: Money(c), places: Int): Dec =
    Dec.divide(left.amount, right.amount, places)

export let allocate(money: Money(c), weights: Vector(Nat)): Vector(Money(c)) =
    let places = money.amount.places()
    let units = money.amount.unscaled()
    var total = 0n
    for weight in weights
        total := total + BigInt.fromNat(weight)
    if total == 0n then
        throw(DivideByZeroError("Money.allocate: the weights sum to zero"))
    else
        let magnitude = units.abs()
        var floors: Vector((BigInt, Bool)) = []
        var given = 0n
        for weight in weights
            let share = (magnitude * BigInt.fromNat(weight)).quot(total)
            floors := floors.append((share, weight > 0))
            given := given + share
        var left = magnitude - given
        var shares: Vector(Money(c)) = []
        for (share, weighted) in floors
            let extra = if weighted and left > 0n then 1n else 0n
            left := left - extra
            let signed = if units < 0n then -(share + extra) else share + extra
            shares := shares.append(Money({amount = Dec.create(signed, places)}))
        shares

export let rate(factor: Dec, from: a, to: b): Rate(a, b) = Rate({factor})

export let convert<b: Currency>(money: Money(a), rate: Rate(a, b)): Money(b) =
    of(money.amount * rate.factor, marker())

export let convertEven<b: Currency>(money: Money(a), rate: Rate(a, b)): Money(b) =
    ofEven(money.amount * rate.factor, marker())

honor<c: Currency> Show<Money(c)> =
    show(money) = "${money.amount.show()} ${code(currencyOf(money))}"
```

What a call compiles to: types are erased, the marker is a tagged object, and the
`Currency` instance is an extra argument.

```js
const price = __of(({ unscaled: 19999n, places: 3 }), Money.USD, __Currency_USD);
```
