# Numeric text parsing

**Status:** Decided (#1049, #1253 step 9c, 2026-10-18). One design for every numeric type, so the conventions are set once.

**Owns:** each numeric type's `parse`, its grammar, `NumberFormatError`, and the round-trip law. **Companions:** Lexer §5 (the literal grammar this reads), Exceptions §1 and §8 (exceptions and their bridges), Effects §3.1 (the reading, and its widening), Functions §4.3 (where a reading's value meets its seat), `dec.md` (`Dec`'s places), `rat.md`, Primitive Types §3 (the ranges).

## 1. Doctrine

- **One `parse` per numeric type, and it may fail.** Bad text is a failure a caller should plan for, so `parse` throws an exception, which the fail colour tracks (Exceptions §1). There is no second, `Option`-returning version of any parser: the caller picks the form at the call (#1151 Q13), and the same call serves all three.
  - `Int.parse^(text)` passes the failure up, so the enclosing function may fail.
  - `Int.parse?(text)` reads it as data: `Some(n)`, or `None` (Effects §3.1).
  - `assume Int.parse^("8080")` says the text is known to be good: a failure there is the fault `AssumptionFault` (Exceptions §8.3).
  - `attempt Int.parse^(text)` keeps the exception as data, a `Result(Int, Exn)` (Exceptions §8.2).
- **`parse` reads a number the way Hexagon writes one.** The grammar is the type's literal (Lexer §5), with an optional sign in front, so the language has one grammar for numbers, decided once. What `show` writes that no literal can (`NaN` and the infinities, a `Rat`'s `/`) is added, so every value's text reads back.
- **Locale-free, by definition.** Locale-aware parsing belongs to the i18n library.

## 2. The surface

| Function | Face | Home |
|---|---|---|
| `Int.parse(text: String)` | `String ->^ Int` | `stdlib/Int.hex` |
| `Nat.parse(text: String)` | `String ->^ Nat` | `stdlib/Nat.hex` |
| `BigInt.parse(text: String)` | `String ->^ BigInt` | `stdlib/BigInt.hex` |
| `Float.parse(text: String)` | `String ->^ Float` | `stdlib/Float.hex` |
| `Dec.parse(text: String)` | `String ->^ Dec` | `stdlib/Dec.hex` |
| `Rat.parse(text: String)` | `String ->^ Rat` | `stdlib/Rat.hex` (`import Rat`) |

Each is pure and may fail on its own account, so every call wears `^` or a reading.

## 3. The grammar

**The sign.** A literal never carries a sign in Hexagon (Lexer §5: "a leading sign is never part of the physical token"), so `parse` states its own: an optional `+` or `-` before the literal. `Nat` takes neither. Hexagon has no unary `+` in code; text from outside writes one, and it has one meaning.

| Type | Accepts, after the optional sign | Examples |
|---|---|---|
| `Int`, `BigInt` | Lexer §5's integer literal: decimal digits, or `0x`, `0o` or `0b` and digits of that base, with `_` between two digits | `42`, `-5`, `+5`, `007`, `1_000`, `0xFF`, `0o777`, `0b1010`, `-0x10` |
| `Nat` | the same, with no sign | `5`, `0x10` |
| `Float` | decimal digits, an optional `.` and fraction digits, an optional exponent (`e` or `E`, an optional sign, digits): Lexer §5's float literal, or a decimal integer, since `show` writes `4.0` as `4`. Also `NaN`, `Infinity` and `-Infinity`, exactly as `show` writes them | `1.5`, `-0.25`, `1e+21`, `1.5e-7`, `4`, `NaN` |
| `Dec` | Lexer §5's `Dec` literal without its `d`: decimal digits and an optional `.` and fraction digits | `1.50`, `-0.05`, `12` |
| `Rat` | `top/bottom`, each an integer literal as `BigInt` reads it, the sign only on the top and the bottom not zero; or an integer alone, which is that integer over one | `1/3`, `-1/3`, `6/4`, `5` |

**Consequences**, each one Lexer §5's:
- **Leading zeros are decimal.** `007` is seven: only a `0` followed by `x`, `o` or `b` is a base prefix.
- **A point has digits on both sides.** `.5` and `5.` are refused, as they are in source.
- **A `Dec` takes no exponent.** It would hide the places (`dec.md` §3), and §7 shows what it would cost.
- **A `Float` is decimal only.** `0x10` is not a `Float`.
- **`_` sits between two digits.** It never leads, trails, or touches `.`, `e`, a sign, or a base prefix.

**Refused everywhere:**
- the empty text, and any whitespace, leading or trailing: trim first, `Int.parse^(text.trim())`;
- uppercase base prefixes (`0X10`);
- the `n` and `d` suffixes;
- digits outside ASCII;
- a second sign (`+-5`);
- `NaN` and the infinities with any other spelling (`nan`, `+Infinity`, `-NaN`).

**The value:**
- **Integers are exact.** For `Int` and `Nat`, an integer outside the type's range is a failure (§4), not a fault: untrusted text that is too long is expected, where an arithmetic result that is too big is a bug (`IntRangeFault`).
- **A `Float` is correctly rounded**, by the host's own conversion. Text past the range rounds to `Infinity` or to zero, as the hardware's rounding does.
- **A `Dec`'s places are the digits after its point**, so `"1.50"` keeps two (`dec.md` §2).
- **A `Rat` is reduced**, so `"6/4"` reads as `3/2`. A zero bottom is a failure (§4), not `DivideByZeroFault`.

## 4. `NumberFormatError`

```hexagon
exception NumberFormatError(message: String)
```

- **The prelude's second exception** (Exceptions §8.5), beside `JsError`. It is declared where the operation that throws it lives, the earliest of the six in the prelude's order: `stdlib/Int.hex`, as `IntRangeFault`, which `Float`'s rounding throws too, is. Like every prelude throwable it is bare by category (Modules §5.5), and qualified it is `Int.NumberFormatError`.
- **One exception for every type**, for text that is not a number of the type and for one outside its range. Tracking records whether, not which (Effects §1), and a caller who wants to know which reads the message.
- **The message quotes the text**, then says what it is not:
  - `"12x" is not an Int`, `"-5" is not a Nat`, `".5" is not a Float`, `"1/0" is not a Rat`;
  - for an integer outside `Int`'s or `Nat`'s range, `"9007199254740992" is out of range for Int`.
  - The quoted text is cut short: past 40 code points it is the first 37 and `…`, so untrusted text cannot make a message as long as itself.
  - It is escaped where the quotation would be ambiguous: a `"` and a `\` take a backslash, and a control character is written `\u` and four hex digits.
- **What a caught one says**: `show` gives `NumberFormatError: "12x" is not an Int` (Exceptions §8.6).

## 5. The round-trip law

`T.parse(show(x))` gives back `x`, for every `x` of every type:
- for `Int`, `Nat`, `BigInt` and `Rat`, `==`;
- for `Dec`, `same`, so the places are kept;
- for `Float`, every value but `NaN` by `==`, and `NaN`'s text reads back as `NaN`. `-0.0` shows as `0` and reads back as `0`, which is `==` to it.

## 6. A reading's `Option` widens

Effects §3.1 owns this; it is recorded here because parsing is where it is met first. A reading is `Some` of its call. So where it meets a written `Option(T)`, the call's result widens into `T` exactly as `Some(…)` written around the call would (Functions §4.3):

```hexagon
let id(text: String): Option(BigInt) = Int.parse?(text)      -- an Int, widened inside Some
```

The widening is of the call's result, inside `Some`; the `Option` is never converted. Only the numeric widenings apply (Numeric Literals §5.1), and only toward a type the program writes.

## 7. Cost, and `Dec`'s guard

- **Every parse is one linear pass over its text.** The grammar check is a regular expression whose every repetition is unambiguous, so no text makes it backtrack, and the conversion is the host's.
- **No short text can ask for a large value.** `Dec` takes no exponent, so a `Dec`'s places and digits are never more than its text has characters, and the same holds of every other type's digits. Every later operation is bounded by the text's own size: comparing two values with different places scales one to the other's, hashing strips trailing zeros in doubling strides, and `show` writes the digits out.
- **Measured** with V8's `BigInt`: a 1,000,000-digit text parses in about 30 ms, rescales for a comparison in about 46 ms, and shows in about 74 ms. Ten times the digits takes about thirteen times the time.
- **There is no decimal-specific cap** (`dec.md` §12). A program reading untrusted text of unbounded length bounds its length first, as it would for any input.

## 8. Implementation

- **Each type's `parse` is ordinary Hexagon over one private scanner** (Intrinsics §3.2): `numberParseInt`, `numberParseNat`, `numberParseBigInt`, `numberParseFloat` and `numberParseDec`.
  - `Int` and `Nat` answer `Some(None)` for an integer outside their range, so the message can say which failure it was.
  - Every prelude module that throws `NumberFormatError` keys `numberFormatMessage`, so the message is worded and cut the same way. `Rat.hex` is ordinary source, which the door does not reach, so it writes the same rule in Hexagon, and a test holds the two to the same output.
- **The scan is JavaScript for two reasons, both the host's.** The conversions are host capabilities: `BigInt(…)` in four bases, and a correctly rounded `Number(…)`. And the seat: `Int.hex`, `Nat.hex`, `Float.hex` and `BigInt.hex` are seated before `String.hex`, so no text can be walked in Hexagon there.
- **The verdict over each answer, and the throw, are Hexagon.** `Rat.parse` is Hexagon throughout, over `BigInt.parse?` readings and `String.split`.

## 9. Diagnostics

| Situation | Report |
|---|---|
| `Int.parse(text)` with no mark | "this call may fail, so `parse` wants `^`, not no mark" + fixit `^` (Effects §9) |
| A reading's `Option` at a written `Option(T)` its call's result cannot widen into | the ordinary mismatch: "type mismatch: expected String, found Int" |

## 10. Decisions log

| Decision | Ruled |
|---|---|
| One tracked `parse` per type, read at the call; no `Option` twins | #1151 Q13 (2026-09-28) |
| The exception is `NumberFormatError(message: String)`, for bad and out-of-range text alike; the message quotes the text, cut short. `ParseError` was declined: users declare that name, and a user's own would silently occlude the prelude's (Modules §5.4) | James, 2026-10-18 |
| The grammar is Lexer §5's literal for the type, without its suffix, after an optional `+` or `-` (`Nat`: none), plus `NaN`/`Infinity`/`-Infinity` for `Float` and `top/bottom` for `Rat`. Unary `+` in code stays out | James, 2026-10-18 |
| A reading's `Option` widens as `Some(…)` around its call would | James, 2026-10-18 |
| No decimal-specific cap: with no exponent, a value's places and digits never exceed its text's length | by doctrine (`dec.md` §12), 2026-10-18 |
