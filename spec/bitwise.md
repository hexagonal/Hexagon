# Hexagon Spec: Bitwise Operations and Non-Decimal Literals

**Status:** Decided (September 2026). Promoted from `notes/bitwise-operators-proposal-2026-09.md`.
**Scope:** The `Bitwise` prelude constraint, its `Int` and `BigInt` instances, the four
word operators `band`, `bor`, `bxor`, and `bnot`, the named shifts, the named 32-bit
conversions `Int.toInt32` and `Int.toUint32`, their emission, and hexadecimal, octal,
and binary integer literals.
**Not in scope:** Rotations, population count, leading- and trailing-zero counts, bit
testing, and 32-bit multiplication (JavaScript's `Math.imul`); formatting integers in
another base (`Int.toHex` or a radix form); typed flag sets (#1031).
**Companions:** Operators §1.1, §2, §3 (elaboration, inventory, precedence); Lexer §4.1,
§4.2, §5 (keywords and literal grammar); Lexer & Layout §2.3 (continuation set);
Primitive Types §2, §6, §8; Constraints §5.1.1 (pre-registration), §5.3 (orphan rule),
§7 (registry); Numeric Literals §4 (defaulting), §5.2 (literal emission); Intrinsics
§4.1 (keys); Foreign Enums §8.2 (flag masks).

**Lineage, in one line:** Erlang's words, Lean's precedence, Gleam's semantics.

---

## 1. Doctrine

> **Bitwise operations compute the true integer answer.** Both instances act on
> two's-complement integers of unbounded width, which is the semantics JavaScript gives
> `bigint`. No 32-bit projection exists anywhere in the constraint. Code that wants
> JavaScript's 32-bit view says so, through a named conversion (§4.3).

Bitwise operations are part of the language because the language needs them. Uses
include hash mixing and checksums written in Hexagon, FFI flag masks, colour and field
packing, and binary encodings.

## 2. The constraint

```hex
constraint Bitwise<a> =
    bitAnd(left: a, right: a) -> a
    bitOr(left: a, right: a) -> a
    bitXor(left: a, right: a) -> a
    bitNot(value: a) -> a
    shiftLeft(value: a, count: Int) -> a
    shiftRight(value: a, count: Int) -> a
```

The arrows are pure contracts, as every prelude member's are (Constraints §7). `Bitwise`
has no base constraint: arithmetic, ordering, and hashing are not prerequisites. The
shift count is always `Int`, whatever the subject type.

`Bitwise` is **pre-registered** (Constraints §5.1.1). Its name resolves in every module,
it cannot be redeclared, and the operators reach it by its one identity. Its declaring
module is `stdlib/Bitwise.hex`. A constraint declaration seats as early as its member
headers allow (Modules §5.5), and these headers name only the subject and `Int`, so
`Bitwise.hex` seats among the leading constraint declarations. It must seat before
`Int.hex` and `BigInt.hex`, which honor it.

The members are not in bare scope (Modules §5.5). They are reached by the dot
(`x.bitAnd(y)`, `x.shiftLeft(3)`) and by qualification through the constraint's module
or an honoring companion (`Bitwise.bitAnd(x, y)`, `Int.shiftRight(x, 2)`).

### 2.1 Instances

The standard instances are `Int` and `BigInt`, declared in their companions.

`Nat`, `Float`, and `Bool` have no instance, and no program can supply one. By the
orphan rule (Constraints §5.3), `honor Bitwise<T>` belongs in `Bitwise`'s module or
`T`'s. For these types both homes are prelude source, so no project module can write
the declaration. `Nat` is left out because `bitNot` of a natural number is negative,
so `Nat` cannot honor the constraint whole. `Bool` is left out so that logic has one
spelling (Operators §1.2).

A type a program declares may honor `Bitwise` in its own module, as a user `Decimal`
joins the numeric tower (Friendly Numerics). The operators then elaborate to its members
like any other instance's. Nothing seals the constraint beyond the orphan rule.

### 2.2 Laws

As in Constraints §7, the laws are what instances are written and reviewed against;
nothing checks them. The shipped instances keep them over their whole domain, with the
`Int` edges stated in §4.2.

- `bitAnd`, `bitOr`, and `bitXor` are associative and commutative. `bitAnd` and `bitOr`
  are idempotent and distribute over each other.
- `bitNot` is an involution, and De Morgan holds:
  `bitNot(bitAnd(x, y)) == bitOr(bitNot(x), bitNot(y))`.
- `bitXor(x, x)` is zero, and `bitXor(x, bitNot(x))` is `bitNot` of zero.
- For non-negative counts, shifts compose: `x.shiftLeft(a).shiftLeft(b) ==
  x.shiftLeft(a + b)`, and likewise `shiftRight`. A shift by a negative count is the
  opposite shift by its magnitude.

## 3. Operators

Four word operators elaborate to the members (Operators §1.1):

| Spelling | Form | Elaborates to |
|---|---|---|
| `band` | binary infix | `Bitwise.bitAnd(left, right)` |
| `bor` | binary infix | `Bitwise.bitOr(left, right)` |
| `bxor` | binary infix | `Bitwise.bitXor(left, right)` |
| `bnot` | unary prefix | `Bitwise.bitNot(value)` |

Every spelling of a member selects the same instance and has the same meaning:
`left band right`, `Bitwise.bitAnd(left, right)`, and `left.bitAnd(right)`.

The shifts have no operator. They are named calls: `value.shiftLeft(count)`,
`value.shiftRight(count)`, and the qualified forms. There is no unsigned right shift.
"Unsigned" means something only at a fixed width, and §4.3 names that width where a
program wants it.

```hex
let selected = flags band mask
let combined = selected bor extra
let changed = original bxor updated
let cleared = flags band bnot mask
let mixed = (value bxor salt).shiftLeft(3)
```

### 3.1 Keywords

`bnot` is a hard keyword (Lexer §4.1). Like every hard keyword, it is reserved in bare
seats only, and Lexer §4.4's name seats admit it (`x.bnot` is a field).

`band`, `bor`, and `bxor` are contextual keywords (Lexer §4.2). Each is the operator in
the seat directly after a complete operand, and an ordinary name everywhere else.
Hexagon has no juxtaposition application, so a name directly after a complete operand
is otherwise always an error. The same argument supports `union`, `widens`, and
`module`, and `when`, `with`, and `as` already occupy that infix seat. `band` is an
English word, and a local named `band` stays usable:

```hex
let x = flags band mask      // operator: follows an operand
let band = Band("Pixies")    // name
play(band)                   // name

let y =
    flags band               // operator at line end: y continues
        mask
let z = flags
band.play()                  // new item: a leading band never continues
```

Because a contextual `band`, `bor`, or `bxor` can begin an expression, none of them is
in the continuation set of Lexer & Layout §2.3. This is the rule `-` and `<` already
follow. A continuation that wants one indents deeper, or ends the previous line with
the operator.

Constraint members keep non-keyword names (Lexer §4.4), which is why the members are
named `bitAnd` and its siblings.

### 3.2 Precedence

The operators take Lean 4's levels: `&&&` 60, `^^^` 58, `|||` 55, all between addition
(65) and comparison (50), and the prefix `~~~` at 100, above power (75). In Operators
§3's table, tightest first:

| Level | Operators | Associativity |
|---|---|---|
| 2 | `bnot` | prefix |
| 3 | `**` | right |
| 4 | `-` (unary) | prefix |
| 5 | `*` `/` | left |
| 6 | `+` `-` `++` | left |
| 7 | `band` | left |
| 8 | `bxor` | left |
| 9 | `bor` | left |
| 10 | `..` | none |
| 11 | comparisons | chaining |

Consequences:

- `flags band mask == 0` is `(flags band mask) == 0`.
- `a + b band c` is `(a + b) band c`.
- `a bor b band c` is `a bor (b band c)`: conjunction binds tighter than disjunction,
  as in Boolean algebra.
- `bnot x ** 2` is `(bnot x) ** 2`, while `-x ** 2` stays `-(x ** 2)`.
- `bnot f(x)` is `bnot (f(x))`: postfix forms stay at level 1.

Lean has no range operator, so placing the operators above `..` is Hexagon's own choice.
Range endpoints are numbers, so `0..n band mask` is `0..(n band mask)`. Shifts are named
calls at level 1, tighter than Lean's 75.

## 4. Semantics

### 4.1 One semantics at both instances

Both instances compute the true integer answer: two's complement over the unbounded
integers. Whichever type holds a value, the answer is the same:

```hex
BigInt.fromInt(x band y) == BigInt.fromInt(x) band BigInt.fromInt(y)
```

- `bitNot(x)` is `-x - 1`.
- `shiftLeft(x, n)` is ⌊x · 2ⁿ⌋ and `shiftRight(x, n)` is ⌊x · 2⁻ⁿ⌋, for every `Int`
  count. A negative count shifts the other way. A right shift rounds toward negative
  infinity, so a long enough right shift reaches `0` for a non-negative value and `-1`
  for a negative one.
- The operations are total. No count is refused and nothing is thrown, except where a
  host limit on `BigInt` size applies (§4.4).

### 4.2 `Int`

`Int` keeps its `number` representation. The members compute the true answer on plain
numbers:

- **`bitAnd`, `bitOr`, `bitXor`.** When both operands lie in the signed 32-bit range,
  JavaScript's native operator is already exact and is used. Otherwise each operand
  splits into a high part, ⌊x / 2³²⌋ (at most 21 bits and signed), and a low part,
  x − high · 2³², in [0, 2³²). The operation acts on each pair of parts, and the parts
  recombine as high · 2³² + low.
- **`bitNot`** is `-x - 1`.
- **`shiftLeft` and `shiftRight`** are multiplication by, or floored division by, a power
  of two. The ends are answered directly, not computed. A zero value shifts to `0`. A
  right shift by a count past the value's magnitude answers `0` or `-1`, so a negative
  value never reaches `-0`.

Two edges follow `Int`'s ordinary overflow contract (Primitive Types §2.1) instead of
adding a new one. A `shiftLeft` whose result passes ±2⁵³ gives the f64 product that
`x * 2 ** n` gives for a nonzero `x`. And a bitwise result on in-range operands can land
exactly on −2⁵³: `bnot` of 2⁵³ − 1 is one example.

These results agree with JavaScript wherever JavaScript's answer is the true integer.
That covers the three binary operations and `~` when every operand fits in signed 32
bits, and shifts with a count from 0 to 31 whose result fits in signed 32 bits. They
differ only where JavaScript truncated first. For example, `1 << 31` is `-2147483648` in
JavaScript and `1.shiftLeft(31)` is `2147483648` here. Gleam's JavaScript target takes
the same route, with the same 32-bit fast path.

### 4.3 The named 32-bit conversions

Code that wants JavaScript's 32-bit view says so with two ordinary `Int` companion
functions. They are named lossy conversions, per friendly-numerics tenet 1:

| Function | Result | Emission |
|---|---|---|
| `Int.toInt32(x)` | the value in [−2³¹, 2³¹) congruent to `x` modulo 2³² | `x \| 0` |
| `Int.toUint32(x)` | the value in [0, 2³²) congruent to `x` modulo 2³² | `x >>> 0` |

Both are subject-first, so `x.toInt32()` and `x.toUint32()` are their dot spellings.

To port 32-bit JavaScript:

- `e | 0` becomes `e.toInt32()`, and `e >>> 0` becomes `e.toUint32()`.
- `x >>> n` becomes `x.toUint32().shiftRight(n)`.
- `x >> n` on 32-bit data becomes `x.toInt32().shiftRight(n)`.

JavaScript reduces a shift count modulo 32, so these rewrites assume a count from 0 to
31, which is what 32-bit code writes.

`band`, `bor`, `bxor`, `+`, `-`, `*`, and `shiftLeft` all commute with reduction modulo
2³². So one reduction where the JavaScript reduced gives the JavaScript answer, as long
as intermediates stay inside ±2⁵³. Right shifts do not commute with reduction. Because
there is no unsigned right shift, the explicit conversion goes exactly where the 32-bit
meaning lives.

### 4.4 `BigInt`

§4.1's semantics is BigInt's native semantics, so every member lowers to its native
operator. JavaScript never mixes `bigint` and `number`, so the `Int` count converts
exactly with `BigInt(count)`. The host's limit on BigInt size applies to shifts as it
applies to all BigInt growth (Operators §6.3.1). No Hexagon exception wraps that limit.

## 5. Typing, evaluation, and effects

A binary operation needs one operand type that honors `Bitwise`. There is no mixed
`Int`/`BigInt` operation, and no contextual widening joins the operands. The value of a
shift decides the instance, and the count is checked at `Int` independently, as the
exponent of `**` is (Operators §6.3).

A literal operand is typed by the ordinary literal rules. `Bitwise` joins the
defaultable set through Numeric Literals §4's rule, since it is a pre-registered
constraint whose `Int` instance the prelude supplies. So `let x = 12 band 10` is the
`Int` `8`, and `0xFF band x` takes `x`'s type.

The operators are eager. Operands are evaluated once each, in ordinary call order.
`band` and `bor` do not short-circuit.

Lowercase `and`, `or`, and `not` keep their `Bool` semantics and parsing, and no
spelling changes meaning by operand type. Reaching for the wrong family is a type
error, because `Bool` has no `Bitwise` instance and `Int` is not `Bool`: `p band q` on
`Bool` and `x and y` on `Int` both refuse, and each refusal offers the other spelling
(§8).

All six contracts are pure. Instance effects are inferred and checked against them
(Effects §13). Effectful operand expressions keep their normal call marks: operator
syntax hides no operand effect.

## 6. Emission

Emission follows the operator/member doctrine of Operators §1.1 and Constraints §6.1.
Every spelling of a member emits alike: the operator, the dot, and the qualified form.

- **At `BigInt`**, JavaScript's operator is the member's meaning, so it is what is
  emitted: `&`, `|`, `^`, `~`, `<<`, `>>`. The count converts: `x.shiftLeft(n)` emits
  `x << BigInt(n)`. A literal count converts the same way, `x.shiftLeft(3)` emitting
  `x << BigInt(3)`, because the shape follows the algebra and never a value
  (Constraints §6.1).
- **At `Int`**, no JavaScript operator carries the member's meaning, so every spelling
  keeps the call to the instance's member seat. This is what `**` does at `Int`, where
  `3 ** 2` emits `__Pow_Int.pow(3, 2)`.
- **In a generic body**, calls use ordinary constraint evidence. No runtime dispatch on
  JavaScript operand values stands in for static instance selection.

`Int.toInt32` and `Int.toUint32` emit their table's operators.

## 7. Implementations and intrinsic keys

Each companion declares its instance over unexported intrinsic-door rows (Intrinsics
§3.2). No member body is written with its own operator, because that would select the
member being defined (Constraints §6.1).

```hex
honor Bitwise<Int> =
    bitAnd(left, right) = nativeBitAnd(left, right)
    bitOr(left, right) = nativeBitOr(left, right)
    bitXor(left, right) = nativeBitXor(left, right)
    bitNot(value) = -value - 1
    shiftLeft(value, count) = nativeShiftLeft(value, count)
    shiftRight(value, count) = nativeShiftRight(value, count)
```

`bitNot` is ordinary Hexagon over `Signed`'s members: a strictly simpler operation, and
a different slot from the one being defined. The strictly-simpler doctrine therefore
sends it to source rather than to the door. This holds at both instances; at `BigInt`
the body is `-value - 1`, and emission still writes `~` (§6).

The shifts could also be written in Hexagon, over `Pow` and `Integral`, but each shift
would then pass a negative-exponent guard and a Euclidean division. That is the
hot-path cost the door exists to avoid (Intrinsics §3.2's `Hex.Runtime.HashTrie`
reasoning), so the shifts cross the door. The same argument applies to `toInt32` and
`toUint32`, which `Int.mod` could express.

The keys (Intrinsics §4.1):

| Companion | Keys |
|---|---|
| `Int.hex` | `intBitAnd`, `intBitOr`, `intBitXor`, `intShiftLeft`, `intShiftRight` (the members of §4.2); `intToInt32`, `intToUint32` (the §4.3 conversions, cores of plain exports) |
| `BigInt.hex` | `bigIntBitAnd`, `bigIntBitOr`, `bigIntBitXor`, `bigIntShiftLeft`, `bigIntShiftRight` (native operators; the shift keys convert their `Int` count) |

`Hex.Runtime.HashTrie`'s bit algebra keeps its own keys. Its population counts are not
`Bitwise` members, and each of its rows lowers to one fixed 32-bit JavaScript
expression.

## 8. Non-decimal integer literals

Bitwise code needs masks written in their own base, so integer literals may be written
in hexadecimal, octal, or binary.

```text
HexInteger = "0x" HexDigit ("_"? HexDigit)*      HexDigit = [0-9a-fA-F]
OctInteger = "0o" [0-7] ("_"? [0-7])*
BinInteger = "0b" [01] ("_"? [01])*

Integer = Digits | HexInteger | OctInteger | BinInteger
BigInt  = (Digits | HexInteger | OctInteger | BinInteger) "n"
```

- **Leading zeros.** A leading `0` followed by digits stays decimal: `007` is `7`. A
  leading `0` followed by `x`, `o`, or `b` is a base prefix.
- **Case.** The prefix is lowercase only. `0X`, `0O`, and `0B` are diagnosed with a
  lowercase fix-it, as `1N` is. Hex digits may be either case and are emitted as
  written.
- **Underscores.** JavaScript's rule, already decided in Primitive Types §8, applies: a
  digit on both sides. So `0xFF_FF` is legal, and `0x_FF`, `0xFF_`, and `0xFF_n` are
  not.
- **Suffixes.** `n` makes a BigInt: `0xFFn`. There is no Dec or Float form in these
  bases. `d` and `e` are hex digits, so `0xFFd` is the integer 4093 and `0x1e5` is 485.
  A `d` suffix in the octal and binary bases would give one letter two meanings across
  the three bases, so it is not admitted there either. A Dec from a mask goes through
  the ordinary literal rule: `let price: Dec = 0xFF` is `Num<Dec>.fromNat` of 255.
- **Malformed forms.** A fractional or exponent form (`0x1.5`, `0b1e3`) is one malformed
  numeric literal. So is a digit outside the base (`0b102`, `0o8`), and a prefix with no
  digits (`0x`). None of them is a valid literal followed by a name. `0x1.show()` is a
  literal followed by a dot call, as `1.show()` is.
- **Meaning.** A literal denotes the plain number: `0xFFFFFFFF` is 4294967295, never −1.
  A negative value is unary minus applied to a literal. The type rules, the bare range
  limit of 2⁵³ − 1 with its `n` fix-it, and the literal-pattern rules are exactly those
  of decimal integer literals. Every seat that admits an integer literal admits all
  four bases, including a literal `extern enum` member (Foreign Enums §2.4).
- **Emission.** A literal is emitted in its source base. JavaScript accepts all three
  bases, underscores, and the `n` suffix. Emitting separators is optional, as Primitive
  Types §8 already allows. At `Float`, a non-decimal literal emits in its source base
  without Numeric Literals §5.2's `.0` spelling, because JavaScript has no fractional
  hex form.

`Show` stays decimal.

## 9. Diagnostics

| Situation | Error / fixit |
|---|---|
| `p band q`, `p bor q`, `p bxor q`, `bnot p` at `Bool` | the missing-instance report, whose pair is closed (Modules §7.6) + fixit naming the logic spelling: `and`, `or`, `!=`, or `not` respectively |
| `x and y`, `x or y`, `not x` at a type honoring `Bitwise` | the ordinary `Bool` type error + fixit "for bitwise conjunction write `band`" (resp. `bor`, `bnot`) |
| `honor Bitwise<Bool>` (or `Float`, `Nat`) in project source | the orphan-rule refusal at the declaration (Constraints §5.3): both homes are prelude source |
| Mixed `Int`/`BigInt` operands | ordinary type mismatch; no widening offered |
| Non-`Int` shift count | the seat's type error (the count is a concrete `Int` parameter, §5) |
| `&`, `^`, `~` in source | invalid character, with a redirect: "Hexagon spells bitwise and `band`" (resp. `bxor`, with "for a power write `**`" at `^`; `bnot` at `~`) |
| `\|` directly after a complete operand in expression position | parse error + "Hexagon spells bitwise or `bor`" |
| Glued `<<`, `>>`, or `>>>` after a complete operand | parse error + "Hexagon has no shift operators; write `x.shiftLeft(n)`" (resp. `shiftRight`; at `>>>`, "`x.toUint32().shiftRight(n)`") |
| `0X`, `0O`, `0B` | lexical error + lowercase fixit |
| `0x`, `0b102`, `0o8`, `0x1.5`, `0b1e3`, `0xFF_n`, `0x_FF` | one malformed-numeric-literal diagnostic (Lexer §10) |
| `let bnot = …`, `bnot` as a lambda binder | the hard-keyword rows of Lexer §10 |

## 10. Rejected alternatives (do not re-litigate without new information)

| Rejection | Reasoning |
|---|---|
| JavaScript's 32-bit operators on `Int` (Elm's choice) | The same value would give different answers at `Int` and `BigInt`, and `1 << 31` would be negative. §4.3's named conversions provide the 32-bit view where a program wants it. |
| Symbols (`&`, `\|`, `^`, `~`, `<<`, `>>`) | `^` stays permanently unused (Operators §13), and `\|` belongs to unions and patterns. Logic is spelled in words (Operators §1.2), and the bitwise family follows it. |
| Uppercase `AND`, `OR`, `XOR`, `NOT` | They break the uppercase-start roles of Lexer §3.1. |
| `bsl` and `bsr` shift keywords | Unfamiliar spellings for a named operation that reads well as a call. |
| An unsigned right shift | "Unsigned" is meaningful only at a fixed width; `toUint32` names the width (§4.3). |
| Sealing `Bitwise` at `Int` and `BigInt` | The orphan rule already refuses every prelude type. A seal would add a mechanism whose only further effect is refusing a program's own type. |
| A `Nat` instance | `bitNot` leaves ℕ. |
| A `d` suffix in non-decimal bases | `d` is a hex digit; §8. |

## 11. Acceptance tests

```text
-- (a) Semantics at both instances, BigInt as the oracle
-- for random Int pairs across the full safe range, and at the 32-bit boundaries,
-- bit 31, 2³², and −2⁵³:
BigInt.fromInt(x band y) == BigInt.fromInt(x) band BigInt.fromInt(y)   -- and bor, bxor, bnot
1.shiftLeft(31)                  -- 2147483648
(-1).shiftRight(100)             -- -1, never -0
(-5).shiftRight(1)               -- -3 (floored)
5.shiftLeft(-1)                  -- 2 (negative count reverses)
0.shiftLeft(5000)                -- 0
-- shift counts 0, 31, 32, 53, very large, and negative, at both instances

-- (b) The 32-bit conversions
4294967295.toInt32()             -- -1
(-1).toUint32()                  -- 4294967295
-- a ported 32-bit hash (e.g. FNV-1a) matches its JavaScript original

-- (c) Spellings and emission
x band y      Bitwise.bitAnd(x, y)      x.bitAnd(y)      Int.bitAnd(x, y)
-- all four emit the Int member seat call; at BigInt all four emit x & y
bnot b                           -- at BigInt, emits ~b
b.shiftLeft(n)                   -- at BigInt, emits b << BigInt(n)
-- generic <a: Bitwise> bodies use evidence; a member body that is not pure is refused

-- (d) Parsing
flags band mask == 0             -- (flags band mask) == 0
a bor b band c                   -- a bor (b band c)
bnot x ** 2                      -- (bnot x) ** 2
0..n band mask                   -- 0..(n band mask)
let band = 3                     -- binds; band(x), x.band, {band = 1} are names
-- a leading band on a new line starts a new item; let bnot = 1 is refused
-- p band q at Bool and x and y at Int refuse with the cross-spelling fixits
-- operands are evaluated once each, left to right; band does not short-circuit

-- (e) Literals
0xFF  0o777  0b1010  0xFF_FF  0xFFn  007           -- 255 511 10 65535 255n 7
0xFFd                            -- 4093
0x1e5                            -- 485
0XFF                             -- error, fixit 0xFF
0b102  0o8  0x  0x1.5  0x_FF     -- one malformed literal each
-- each literal emits in its source base; 0xFFFFFFFF is 4294967295

-- (f) Instances
-- no Nat, Float, or Bool instance can be written in project source;
-- a program's own record may honor Bitwise in its module, and band on it
-- elaborates to its member; no unsigned right shift exists
```

## 12. Edit notes applied elsewhere

- **Operators:** §1.1 elaboration rows; §2 inventory; §3 table (17 levels); §13 row
  replaced; §15, §16, and §17 rows.
- **Lexer:** §4.1 `bnot`; §4.2 `band`, `bor`, `bxor`; §5 grammar; §8.3 and §10 rows;
  §11 acceptance.
- **Lexer & Layout §2.3:** the exclusion.
- **Primitive Types:** §2 and §6 literals, constraint lists, and the 32-bit
  conversions; the former bitwise forward note replaced; §8 bases.
- **Constraints:** §5.1.1 inventory (fourteen names); §7 registry.
- **Modules:** the counts of pre-registered names.
- **Numeric Literals §5.2:** non-decimal emission.
- **Intrinsics:** §3.2 key notes; §4.1 pointer.
- **Foreign Enums §8.2:** flag masks bind as `Int` and use these operators.
