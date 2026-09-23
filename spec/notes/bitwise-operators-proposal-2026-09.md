# Bitwise logic keywords and named shifts — proposal

**Status:** Proposed, non-normative; 2026-09-23. This note records James's
agreed hybrid design: the six-member `Bitwise` constraint, `AND`/`OR`/`XOR`/`NOT`
keywords, named shifts, and widened BigInt shift implementations. This revision
supersedes the earlier seven-keyword candidate. It remains in `spec/notes` for
further review, including feedback from other AIs; it does not authorize
implementation or amend the normative operator inventory.

**Dependency:** Complete and verify the constraint-effects work before promoting
this proposal, to avoid designing against drifting contracts. Constraint members
state their effects explicitly; instance and `widens` bodies infer their effects
and must satisfy the member contracts. See the
[effect-contract proposal](constraint-effects-proposal-fable-2026-09.md) and its
promotion record, and [Effects §13](../effects.md). Normative adoption of that
work is not by itself evidence that its implementation is complete.

## 1. Intended surface

Provide the basic bitwise operations for `Int` and `BigInt`, with behaviour
targeted at their JavaScript representations. Six operations share a constraint:

```hex
constraint Bitwise<a> =
    bitAnd(left: a, right: a) -> a
    bitOr(left: a, right: a) -> a
    bitXor(left: a, right: a) -> a
    bitNot(value: a) -> a
    shiftLeft(value: a, count: Int) -> a
    shiftRight(value: a, count: Int) -> a
```

The arrows express pure contracts. This is the supplied design with `: a`
member result headers updated to the explicit constraint-effect syntax. It
adds no superclass requirement: arithmetic, ordering, and hashing are not
prerequisites for using these operations.

The proposed standard instance inventory is exactly `Int` and `BigInt`.
There is no `Nat`, `Float`, `Bool`, or collection instance. Whether to prohibit
third-party instances is a separate adoption question (§7): limiting the
standard inventory does not automatically seal an ordinary constraint.

The proposed operator family has exactly four spellings:

| Spelling | Form | Meaning |
|---|---|---|
| `AND` | binary infix | `Bitwise.bitAnd(left, right)` |
| `OR` | binary infix | `Bitwise.bitOr(left, right)` |
| `XOR` | binary infix | `Bitwise.bitXor(left, right)` |
| `NOT` | unary prefix | `Bitwise.bitNot(value)` |

Operators elaborate to their named constraint members. These are equivalent
spellings selecting the same instance:

```hex
left AND right
Bitwise.bitAnd(left, right)
left.bitAnd(right)
```

`OR`, `XOR`, and prefix `NOT` have the corresponding member-call equivalence.
The member defines the operation; operator syntax provides a spelling for it.
This follows [Operators §1.1](../operators-logic-precedence.md), without adding
user-defined operators or reusing lowercase Bool operators by operand type.

Shifts use named operations only:

```hex
value.shiftLeft(count)
value.shiftRight(count)
value.unsignedShiftRight(count)   // Int only
```

Qualified forms remain available, including `Int.shiftLeft`,
`BigInt.shiftRight`, and `Int.unsignedShiftRight`.
`Int.unsignedShiftRight(value: Int, count: Int): Int` is a separate ordinary
companion operation with an inferred pure body. There are no `SHL`, `SHR`, or
`USHR` keywords and no symbolic bitwise operators in this proposal.
Unsigned right shift is not a seventh member of `Bitwise`: JavaScript has no
BigInt unsigned right shift, and a partial BigInt instance that throws for it
would misrepresent the shared capability.

Rotations, population count, leading/trailing-zero counts, and bit testing can
be separate library operations. They are outside this foundational constraint.

## 2. Source implementations and widened shifts

The proposed BigInt instance is the supplied source structure:

```hex
honor Bitwise<BigInt> =
    bitAnd(left, right) = nativeBitAnd(left, right)
    bitOr(left, right) = nativeBitOr(left, right)
    bitXor(left, right) = nativeBitXor(left, right)
    bitNot(value) = nativeBitNot(value)
    shiftLeft = widened
    shiftRight = widened

widens Bitwise.shiftLeft(value: BigInt, count: BigInt): BigInt =
    nativeShiftLeft(value, count)

widens Bitwise.shiftRight(value: BigInt, count: BigInt): BigInt =
    nativeShiftRight(value, count)
```

These declarations belong in the canonical `BigInt` companion. The `widens`
result annotations remain `: BigInt`: these are implementations with inferred
effects, not constraint headers. Each native is an unexported, explicitly typed
intrinsic-door declaration. Binary bit natives accept two `BigInt`s, the unary
native accepts one, and both native shifts accept a BigInt value and count.
The native names above are local aliases, not newly registered intrinsic keys.

The public constraint requires an `Int` count. The wider implementation accepts
`BigInt`; the existing `widens` mechanism derives the required member by exact
Int-to-BigInt conversion of the count. This follows the existing
[`BigInt` power implementation](../../stdlib/BigInt.hex) and
[Constraints §4.7](../constraints.md). There is one implementation per shift,
not independent Int-count and BigInt-count algorithms.

The distinction between the member's contract face and the companion's wider
face follows the existing `widens` rules. A generic `Bitwise<a>` consumer uses
an `Int` count. The BigInt companion's wider operation accepts a BigInt count.
Qualified and dot-call access to that wider face follows the existing `widens`
rules, with no shift-operator elaboration or new overload-resolution rule.
Verify both member-contract and wider-companion calls at adoption.

The `Int` companion directly implements the six members through typed native
operations with Int operands and Int counts. Its separate unsigned shift uses
the Number unsigned-right-shift native. Neither companion implements a member
by using its own operator: that would recursively select the member being
defined. [Constraints §6](../constraints.md) owns this source-authority rule.

## 3. Representation semantics

The semantic reference is ECMAScript's
[Number operations](https://tc39.es/ecma262/2024/#sec-numeric-types-number) and
[BigInt operations](https://tc39.es/ecma262/2024/#sec-numeric-types-bigint).
These are representation-specific operations, not a promise of one common
fixed-width integer algebra across both instances.

### 3.1 Int

`Int` retains its ordinary Number representation and arithmetic semantics.
Bitwise operations use the 32-bit projection; they do not operate on all of an
Int's potentially 53 significant integer bits.

`AND`, `OR`, `XOR`, and `NOT` use signed 32-bit operands and results. `shiftLeft`
and `shiftRight` also produce signed 32-bit results; `shiftRight` extends the
sign. Shift counts use the JavaScript unsigned conversion and reduction modulo
32. `unsignedShiftRight` uses
zero extension and returns an Int in the range 0 through 4294967295.

No new overflow checks or negative-count rejection are proposed. In particular,
a negative Int shift count is reduced modulo 32, not interpreted as reversal.

Examples, using candidate syntax:

```hex
4294967296 AND -1   // 0: high bits do not survive the 32-bit projection
Int.shiftLeft(1, 32)             // 1: count reduces to zero
Int.shiftLeft(1, -1)             // -2147483648: count reduces to 31
Int.shiftRight(-1, 1)            // -1
Int.unsignedShiftRight(-1, 0)    // 4294967295
```

Let `P(x)` denote the signed 32-bit projection. Laws must acknowledge it:
`x AND x = P(x)` and `NOT (NOT x) = P(x)`, not necessarily `x`. The constraint
must not promise Boolean-algebra identities over the full Int domain that its
native projection does not satisfy. This is consistent with the forward warning
in [Primitive Types](../primitive-types.md) about any future bitwise feature.

### 3.2 BigInt

BigInt bitwise operations use unbounded signed two's-complement semantics.
Complement is `-x - 1`. Counts are not reduced modulo 32. Negative counts reverse
the shift direction; right shift rounds toward negative infinity. No unsigned
right shift is supplied. Host limits on enormous BigInt results remain applicable.

Examples of native-equivalent results:

```hex
BigInt.shiftLeft(8n, -1n)    // 4n
BigInt.shiftRight(-3n, 1n)   // -2n
BigInt.shiftLeft(1n, 32n)    // 4294967296n
```

Thus Int and BigInt agree on the named operations' broad purpose but differ
in width, count handling, and truncation. Documentation must show these
differences beside the operations, rather than implying that changing the
operand type preserves every result.

This draft adds no custom exception wrapper for native allocation or size
limits. Promotion must state their treatment consistently with existing BigInt
intrinsics; a pure effect contract does not promise totality or bounded memory.

## 4. Typing, evaluation, and effects

Binary bit operations require a common operand type `a` honoring `Bitwise`.
There is no automatic mixed Int/BigInt arithmetic introduced here. Existing
numeric-literal rules determine how literals acquire the required type.
Shift values determine the instance; counts follow the contract or lawful
wider face described in §2. `Int.unsignedShiftRight` requires an Int value
and an Int count; a BigInt value is a static error, not a generated JavaScript
TypeError. BigInt has no `unsignedShiftRight` companion operation.

Operators are eager: evaluate operands once in the ordinary call evaluation
order. `AND` and `OR` do not short-circuit. Existing lowercase `and`, `or`, and
`not` retain their Bool semantics and parsing. Capitalization must never make
the same token change meaning according to operand type.

All six constraint contracts are pure. Instance and wider-body effects are
inferred and checked against those contracts under the completed effects work.
An effectful implementation is rejected. Effectful expressions producing
operands still require their normal call marking; operator syntax hides no
operand effects.

Source member calls, operator calls, and qualified/dot calls must agree in
behaviour. Canonical primitive operations should retain readable native
JavaScript emission under the existing operator/member emission doctrine.
Generic calls use ordinary constraint evidence. No runtime dispatch based on
JavaScript operand values substitutes for static instance selection.

## 5. Candidate lexical and precedence design

This section is a concrete review candidate, not an adopted grammar.

The four uppercase spellings would be case-sensitive hard operator keywords,
recognized only as complete tokens. `AND` would differ from `and` and `And`;
`ANDROID` would remain an identifier. They would no longer be available as
ordinary uppercase identifiers, including constructor and module names.
There is no case-insensitive matching or user-defined operator facility.

A candidate precedence order, tightest first, is:

1. Existing postfix forms and exponentiation.
2. Prefix `NOT`, alongside unary numeric negation.
3. Existing multiplication and addition levels, unchanged relative to each other.
4. `AND`, then `XOR`, then `OR`, at three left-associative levels.
5. Existing range and comparison levels, followed by the unchanged lowercase
   logical operators and pipe.

This makes `flags AND mask == 0` mean `(flags AND mask) == 0`. Shifts have
ordinary function-call precedence: `value.shiftLeft(n + 1)` needs no new
operator level. Prefix `NOT` binds more tightly than
comparison, unlike lowercase logical `not`. Parentheses remain the preferred
way to clarify dense mixed bit expressions. Exact unary/exponent parsing and
range interactions must be reviewed against the full existing grammar before
promotion; the above does not silently amend its numbered table.

The cost of this candidate is three new infix precedence levels, four reserved
words, and an uppercase operator category. Review must assess those costs along
with the readability of isolated examples.

## 6. Hybrid rationale and review scope

The selected proposal separates bitwise logic from movement of bits. `AND`,
`OR`, `XOR`, and `NOT` form a recognizable vocabulary; `shiftLeft`, `shiftRight`,
and `unsignedShiftRight` use readable operation names rather than abbreviations.

```hex
let selected = flags AND mask
let combined = selected OR extra
let changed = original XOR updated
let cleared = flags AND NOT mask
let mixed = (value XOR salt).shiftLeft(3)
```

Lowercase Bool `and` and `or` remain short-circuiting structural forms. The
uppercase operators are eager constraint-member calls. They are distinct
spellings with fixed meanings, not one spelling overloaded between mechanisms.
Named bit operations remain available alongside the four operators.

The hybrid removes the earlier shift mnemonics, their precedence level, and
any need for an Int-only operator exception: unsigned shift is simply an Int
companion operation. Symbolic alternatives were considered, but the chosen
proposal uses words for these operations. They are not alternate spellings
included in this design.

Capitalization remains a deliberate new convention. Uppercase starts currently
signal type, constraint, constructor, and module roles in the
[lexer](../lexer.md); these four reserved tokens would be explicit exceptions.
Review should assess confusion between `and` and `AND`, the different prefix
precedence of `not` and `NOT`, and visual prominence in realistic code.

The hybrid is the agreed basis of this spec-worthy note. Keeping it proposed
allows external feedback and review of the exact grammar and semantic details;
it does not leave seven-keyword, symbolic, and hybrid surfaces simultaneously
specified as alternatives. Any change of direction should revise this note
explicitly before promotion.

## 7. Adoption questions and acceptance evidence

Resolve these design questions before promotion:

1. Review the agreed four-keyword hybrid for fit with Hexagon, especially
   capitalization and readability. Confirm token reservation and full precedence
   before adopting the grammar.
2. Does “only Int and BigInt” mean the standard inventory or a sealed constraint?
   A sealed constraint requires an explicit exception to ordinary instance
   extensibility and ownership rules; do not introduce that restriction by
   an undocumented compiler whitelist.
3. Confirm native Int count wrapping and negative BigInt count reversal as
   the intended public behaviour, and document the precise wider-face access
   for BigInt-count shifts under existing `widens` rules.

After the effects dependency and these decisions, promotion must update the
operator inventory and lexer, primitive instance inventories, constraint
registration/module exposure, literal and `widens` interactions, and intrinsic
ownership together. Current specifications explicitly exclude bitwise operators;
this note does not override them.

Implementation acceptance must include all six operations on both instances,
Int projection beyond 32 bits, sign-bit and unsigned results, zero/31/32/negative
counts, BigInt sign extension and count reversal, and the wider/native route.
Test direct members, all four operators, named shifts, aliases, generic evidence, exact
count conversion, pure-contract rejection, and emitted JavaScript. Parsing
checks must cover Bool/bitwise mixtures, complete-token keyword recognition,
precedence, and once-only eager evaluation. Verify no accidental BigInt unsigned shift,
Nat/Float/Bool instance, mixed-representation native call, or recursive
operator-defined primitive body is admitted.

This note does not request implementation, publication, or normative promotion.
