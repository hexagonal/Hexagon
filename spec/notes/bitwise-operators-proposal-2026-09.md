# Bitwise operations and non-decimal literals — proposal

**Status:** Accepted design. Promotion into the normative specs waits only on
the constraint-effects implementation (the dependency below); until then this note
does not amend the operator inventory, lexer, or primitive types. §8 lists what
promotion changes.

**Dependency:** Complete and verify the constraint-effects work before promoting
this proposal, to avoid designing against drifting contracts. Constraint members
state their effects explicitly; instance bodies infer their effects and must
satisfy the member contracts. See the
[effect-contract proposal](constraint-effects-proposal-fable-2026-09.md) and
[Effects §13](../effects.md). Normative adoption of that work is not by itself
evidence that its implementation is complete.

**Lineage, in one line:** Erlang's words, Lean's precedence, Gleam's semantics.

## 1. Surface

Six operations share one constraint:

```hex
constraint Bitwise<a> =
    bitAnd(left: a, right: a) -> a
    bitOr(left: a, right: a) -> a
    bitXor(left: a, right: a) -> a
    bitNot(value: a) -> a
    shiftLeft(value: a, count: Int) -> a
    shiftRight(value: a, count: Int) -> a
```

The arrows are pure contracts. There is no superclass: arithmetic, ordering, and
hashing are not prerequisites.

The instance inventory is exactly `Int` and `BigInt`, and the constraint is
**sealed** (§6.2). There is no `Nat` instance — `bitNot` of a natural number is
negative, so `Nat` cannot honor the constraint whole — and no `Float`, `Bool`, or
collection instance.

Four operator spellings elaborate to the members, per
[Operators §1.1](../operators-logic-precedence.md):

| Spelling | Form | Elaborates to |
|---|---|---|
| `band` | binary infix | `Bitwise.bitAnd(left, right)` |
| `bor` | binary infix | `Bitwise.bitOr(left, right)` |
| `bxor` | binary infix | `Bitwise.bitXor(left, right)` |
| `bnot` | unary prefix | `Bitwise.bitNot(value)` |

These spellings select the same instance and must agree in behaviour:

```hex
left band right
Bitwise.bitAnd(left, right)
left.bitAnd(right)
```

Shifts are named operations only — `value.shiftLeft(count)`,
`value.shiftRight(count)`, and the qualified `Int.shiftLeft` / `BigInt.shiftRight`
forms. There are no shift keywords (Erlang's `bsl`/`bsr` are not adopted) and no
unsigned right shift: "unsigned" means something only at a fixed width, and §3.3
names that width where a program wants it.

Rotations, population count, leading/trailing-zero counts, bit testing, and 32-bit
multiplication (JavaScript's `Math.imul`) are outside this proposal.

```hex
let selected = flags band mask
let combined = selected bor extra
let changed = original bxor updated
let cleared = flags band bnot mask
let mixed = (value bxor salt).shiftLeft(3)
```

## 2. Implementations

The members are declared in the canonical companions, each over an unexported,
explicitly typed intrinsic-door declaration:

```hex
honor Bitwise<Int> =
    bitAnd(left, right) = nativeBitAnd(left, right)
    bitOr(left, right) = nativeBitOr(left, right)
    bitXor(left, right) = nativeBitXor(left, right)
    bitNot(value) = nativeBitNot(value)
    shiftLeft(value, count) = nativeShiftLeft(value, count)
    shiftRight(value, count) = nativeShiftRight(value, count)
```

`honor Bitwise<BigInt>` has the same shape over BigInt natives whose shift count is
an `Int`. The native names are local aliases; registering their intrinsic keys is
promotion work. Neither companion implements a member by using its own operator —
that would recursively select the member being defined
([Constraints §6](../constraints.md)).

## 3. Semantics

### 3.1 One semantics at both instances

Both instances compute **the true integer answer**: two's complement over the
unbounded integers, the semantics JavaScript gives BigInt. There is no 32-bit
projection anywhere in the constraint. The same value gives the same answer
whichever type holds it:

```hex
BigInt.fromInt(x band y) == BigInt.fromInt(x) band BigInt.fromInt(y)
```

- `bitNot(x)` is `-x - 1`.
- `shiftLeft(x, n)` is ⌊x · 2ⁿ⌋ and `shiftRight(x, n)` is ⌊x · 2⁻ⁿ⌋, for every
  `Int` count. A negative count shifts the other way; a right shift rounds toward
  negative infinity, so a long enough right shift reaches `0` or `-1`. The
  operations are total: no count is refused and no exception is thrown.

The laws are the ordinary ones, over the whole domain: `x band x == x`,
`bnot (bnot x) == x`, De Morgan, and — for non-negative counts — shifts compose:
`x.shiftLeft(a).shiftLeft(b) == x.shiftLeft(a + b)`, likewise `shiftRight`.

### 3.2 Int

`Int` keeps its `number` representation; nothing about the type changes. The
members compute the true answer on plain numbers:

- `bitAnd`, `bitOr`, `bitXor`: when both operands lie in the signed 32-bit range,
  JavaScript's native operator is already exact and is used. Otherwise each operand
  splits into a high part (⌊x / 2³²⌋, at most 21 bits) and a low 32-bit part; the
  operation acts on each part and the halves recombine.
- `bitNot`: `-x - 1`.
- `shiftLeft` / `shiftRight`: multiplication or floored division by a power of two,
  with the large-count ends answered directly (so a negative value never reaches
  `-0`).

Two edges follow `Int`'s ordinary overflow contract ([Primitive Types
§2.1](../primitive-types.md)) rather than adding a new one: `shiftLeft` past ±2⁵³
behaves as `x * 2 ** n` does, and a bitwise result on in-range operands can land
exactly on −2⁵³ (`bnot` of 2⁵³ − 1, for one).

This agrees with JavaScript wherever JavaScript's answer is the true integer: the
four bitwise operations when every operand fits in signed 32 bits, and shifts with a
count from 0 to 31 whose result fits in signed 32 bits. It differs only where
JavaScript truncated first — `1 << 31` is `-2147483648` in JavaScript and
`2147483648` here. Gleam's JavaScript target takes the same route, with the same
32-bit fast path.

### 3.3 The named 32-bit door

Code that wants JavaScript's 32-bit view says so, with two ordinary `Int`
companion functions — named lossy conversions, per friendly-numerics tenet 1:

| Function | Result | Emission |
|---|---|---|
| `Int.toInt32(x)` | the value in [−2³¹, 2³¹) congruent to `x` modulo 2³² | `x \| 0` |
| `Int.toUint32(x)` | the value in [0, 2³²) congruent to `x` modulo 2³² | `x >>> 0` |

Porting 32-bit JavaScript: `e | 0` becomes `e.toInt32()`; `e >>> 0` becomes
`e.toUint32()`; `x >>> n` becomes `x.toUint32().shiftRight(n)`; `x >> n` on 32-bit
data becomes `x.toInt32().shiftRight(n)`. `band`, `bor`, `bxor`, `+`, `-`, `*`, and
`shiftLeft` all commute with reduction modulo 2³², so a single reduction where the
JavaScript reduced gives the JavaScript answer while intermediates stay inside
±2⁵³. Right shifts do not commute with reduction; the absence of an unsigned right
shift puts the explicit conversion exactly where the 32-bit meaning lives.

### 3.4 BigInt

The semantics of §3.1 is BigInt's native semantics, so every member lowers to its
native operator; the `Int` count converts exactly (`BigInt(count)`), since
JavaScript never mixes `bigint` and `number`. Host limits on enormous BigInt results
remain applicable; this draft adds no exception wrapper, and promotion states their
treatment consistently with existing BigInt intrinsics.

## 4. Typing, evaluation, and effects

Binary operations require a common operand type honoring `Bitwise`; there is no
mixed `Int`/`BigInt` arithmetic, and existing numeric-literal rules give literals
their type. Shift values determine the instance; the count is always `Int`.

Operators are eager: operands are evaluated once, in ordinary call order. `band`
and `bor` do not short-circuit. Lowercase `and`, `or`, and `not` keep their `Bool`
semantics and parsing, and no spelling changes meaning by operand type. Because
`Bool` has no instance, reaching for the wrong family is a type error: `p band q`
on `Bool` and `x and y` on `Int` both refuse, and each refusal offers the other
spelling.

All six contracts are pure; instance effects are inferred and checked against them.
Effectful operand expressions keep their normal call marking — operator syntax
hides no operand effects.

Emission follows the operator/member doctrine of Operators §1.1. At `BigInt` every
spelling emits the native operator (`&`, `|`, `^`, `~`, `<<`, `>>`). At `Int` every
spelling keeps the call, as `**` does at its guarded instances. Generic calls use
ordinary constraint evidence; no runtime dispatch on JavaScript operand values
substitutes for static instance selection.

## 5. Lexical design and precedence

### 5.1 Keywords

`bnot` is a **hard keyword** (Lexer §4.1, word operators). It reserves bare seats
only; §4.4's name seats still admit it.

`band`, `bor`, and `bxor` are **contextual keywords** (Lexer §4.2): each is the
operator in the seat directly after a complete operand, and an ordinary name
everywhere else. Hexagon has no juxtaposition application, so a name directly after
a complete operand is otherwise always an error — the argument `union`, `widens`,
and `module` already rest on, and the infix position `when`, `with`, and `as`
already occupy. `band` is an English word, and a local named `band` stays usable:

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

Because a contextual `band`, `bor`, or `bxor` can begin an expression, none joins
[Lexer & Layout §2.3](../lexer-layout.md)'s continuation set — the rule `-` and `<`
already follow. A continuation wanting one indents deeper or ends the previous line
with the operator.

Constraint members keep non-keyword names (Lexer §4.4), which is why the members
are `bitAnd` and its siblings.

### 5.2 Precedence

[Operators §1.3](../operators-logic-precedence.md) takes Lean 4's core precedences,
and this proposal adopts them in full. Lean ranks `&&&` 60, `^^^` 58, `|||` 55 —
three levels between addition (65) and comparison (50), in that order — and the
prefix `~~~` at 100, above power (75). Boolean algebra agrees: conjunction binds
tighter than disjunction. The table becomes, tightest first:

| Level | Operators | Associativity |
|---|---|---|
| 1 | `.` `f(...)` `xs[...]` | left |
| 2 | `bnot` | prefix |
| 3 | `**` | right |
| 4 | `-` (unary) | prefix |
| 5 | `*` `/` | left |
| 6 | `+` `-` `++` | left |
| 7 | `band` | left |
| 8 | `bxor` | left |
| 9 | `bor` | left |
| 10 | `..` | none |
| 11 | `==` `!=` `<` `>` `<=` `>=` | chaining |
| 12 | `not` | prefix |
| 13 | `and` | left |
| 14 | `or` | left |
| 15 | `implies` | right |
| 16 | `iff` | left |
| 17 | `\|>` | left |

Consequences: `flags band mask == 0` is `(flags band mask) == 0`;
`a + b band c` is `(a + b) band c`; `bnot x ** 2` is `(bnot x) ** 2` while
`-x ** 2` stays `-(x ** 2)`. Lean has no range operator, so the placement above
`..` is Hexagon's own: range endpoints are numbers, and `0..n band mask` is
`0..(n band mask)`. Shifts are named calls at level 1, tighter than Lean's 75.
Existing levels 2–5 move down one (to 3–6) and levels 6–13 move down four (to
10–17); every diagnostic that quotes a level number changes with them.

## 6. Rationale

### 6.1 Why now

[Operators §13](../operators-logic-precedence.md) recorded "no v1 use case at the
language level; stdlib functions if ever needed." That changes because bitwise
operations are wanted in the language. The uses: hash mixing and checksums written
in Hexagon; the `Hex.Runtime.HashTrie` bit algebra that sits behind intrinsic doors
today because Hexagon had no bitwise operators ([Intrinsics](../intrinsics.md));
FFI flag masks; colour and field packing; binary encodings.

### 6.2 Sealing

The constraint is sealed at `Int` and `BigInt`. The tower rungs are already closed
for the same reason — the language's own tools stay out of reach of conflicting
instances — and here a user `honor Bitwise<Bool>` would reopen the trap Operators
§1.2 names: two spellings of logic, with different evaluation and precedence.
Promotion states the sealing as a documented rule, never an undocumented compiler
whitelist.

### 6.3 Words, not symbols

Operators §1.2 spells logic in words. The symbolic alternatives are out on grounds
of Hexagon's style: `^` is permanently unused (§13) and `|` belongs to unions and
patterns. Erlang's `band`/`bor`/`bxor`/`bnot` keep the lowercase word-operator
family intact and leave the uppercase-start roles of
[Lexer §3.1](../lexer.md) untouched.

## 7. Non-decimal integer literals

Bitwise code needs masks written in their own base, so this proposal adds
hexadecimal, binary, and octal integer literals.

```text
HexInteger = "0x" HexDigit ("_"? HexDigit)*      HexDigit = [0-9a-fA-F]
OctInteger = "0o" [0-7] ("_"? [0-7])*
BinInteger = "0b" [01] ("_"? [01])*

Integer = Digits | HexInteger | OctInteger | BinInteger
BigInt  = (Digits | HexInteger | OctInteger | BinInteger) "n"
```

- **Compatibility.** These forms are lexical errors today (Lexer §5), so no valid
  program changes meaning. A leading `0` followed by digits stays decimal: `007` is
  `7`. A leading `0` followed by `x`, `o`, or `b` is a base prefix.
- **Case.** The prefix is lowercase only; `0X`, `0O`, and `0B` are diagnosed with a
  lowercase fix-it, as `1N` is. Hex digits may be either case and are emitted as
  written.
- **Underscores.** The JavaScript rule already decided in [Primitive Types
  §8](../primitive-types.md): a digit on both sides, so `0xFF_FF` is legal and
  `0x_FF`, `0xFF_`, and `0xFF_n` are not.
- **Suffixes and forms.** `n` makes a BigInt (`0xFFn`). There is no Dec or Float
  form in these bases: `d` and `e` are hex digits, so `0xFFd` is the integer 4093
  and `0x1e5` is 485. A fractional or exponent form (`0x1.5`, `0b1e3`) is one
  malformed numeric literal. A digit outside the base (`0b102`, `0o8`) and a prefix
  with no digits (`0x`) are malformed literals, not a valid literal followed by a
  name.
- **Meaning.** A literal denotes the plain number: `0xFFFFFFFF` is 4294967295,
  never −1. A negative value is unary minus applied to a literal. The type rules,
  the bare range limit of 2⁵³ − 1 with its `n` fix-it, and the literal-pattern rules
  are exactly those of decimal integer literals.
- **Emission.** A literal is emitted in its source base and spelling; JavaScript
  accepts all three bases, underscores, and the `n` suffix.

`Show` stays decimal. Formatting in another base (`Int.toHex`, `Int.toBinary`, or a
radix form) is a separate follow-up.

## 8. Promotion and acceptance

Promotion updates together: Operators §1.1 (elaboration table), §2 (inventory), §3
(precedence table and renumbering), and §13 (the bitwise row); Lexer §4.1 (`bnot`),
§4.2 (`band`, `bor`, `bxor`), and §5 (literal grammar); Lexer & Layout §2.3 (the
exclusion); Primitive Types §2 (the bitwise forward note, replaced by §3 here) and
§8 (bases); the constraint's prelude registration and seat order — `Bitwise.hex`
seats before the `Int` and `BigInt` companions; the `Int` and `BigInt` instance
inventories; intrinsic keys; the syntax-highlighting grammar (which can only
approximate §5.1's contextual rule; the language server is exact).

Acceptance evidence:

- All six operations at both instances, checked against BigInt as the oracle over
  random `Int` pairs across the full safe range, and at the 32-bit boundaries,
  bit 31, 2³², and −2⁵³.
- Shift counts of 0, 31, 32, 53, very large, and negative, at both instances;
  right shifts of negative values reaching `-1`, never `-0`.
- `toInt32` and `toUint32` at the boundaries, and a ported 32-bit hash matching its
  JavaScript original.
- Direct members, all four operators, qualified and dot calls, generic evidence,
  pure-contract rejection, and emitted JavaScript at both instances.
- Parsing: precedence at every new level, Bool/bitwise mixtures and their
  cross-spelling fix-its, once-only eager evaluation, `band` as a name in every
  seat, a leading `band` starting a new item, and `bnot` reserved in bare seats.
- Literals: every row of §7, including `007`, `0xFFd`, `0x1e5`, the uppercase
  prefix fix-it, and emission in the source base.
- No `Nat`, `Float`, or `Bool` instance, no user instance of the sealed constraint,
  no unsigned right shift, and no recursive operator-defined primitive body.

Promotion and implementation begin once the constraint-effects implementation has
landed and been verified.
