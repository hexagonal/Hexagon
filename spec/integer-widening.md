# Hexagon Spec: Exact integer widening through `BigInt`

**Status:** Decided and implemented locally (20 September 2026), independently
reviewed by Sol Medium. The user approved the
conversion routes below and delegated their detailed design. Sol Medium's spec
review and independent compiler feasibility audit found no remaining material
issues. This specification owns the capability and exact-integer construction
laws; Numeric Literals §5.1 owns the contextual widening and target selection.
**Scope:** A destination capability for exact `BigInt` conversion, its bounded
contextual-widening rule, and shared integer construction for `Rat` and `Dec`.
**Companions:** `numeric-literals.md`, `constraints.md`, `friendly-numerics.md`,
`modules.md`, `method-syntax.md`, `rat.md`, and `dec.md`.

## 1. The agreed shape

```text
Nat ──┐
Int ──┼──→ BigInt ──→ Rat
      │           └─→ Dec
BigInt┘
```

`Nat` and `Int` enter `BigInt` exactly. A destination that accepts every integer
exactly provides one `fromBigInt` implementation. `Rat` constructs the integer
over denominator one; `Dec` constructs the integer at zero decimal places.

The diagram describes the construction path for these exact destinations. It
does not replace the existing direct `Nat`/`Int` widenings to `Float`, nor permit
`BigInt` to widen to `Float`. No rounding, value-dependent conversion acceptance,
or runtime trial of alternative paths is introduced.

## 2. The destination capability

Add a prelude constraint declared in `stdlib/FromBigInt.hex`:

```hexagon
module FromBigInt

export constraint FromBigInt<a: Signed> =
    fromBigInt(value: BigInt) -> a
```

The name states the promise directly. `Signed` supplies the existing `Num` and
signed-arithmetic contract; this capability adds exact construction from arbitrary
integers. It has one required member and no defaults or implied type members.
Conversion has no numeric range restriction, subject to ordinary resource limits.

The member must preserve the integer's mathematical value. It agrees with
`Num.fromNat` and `Signed.fromInt` on their respective source ranges and respects
integer addition, multiplication, and negation under the destination's numeric
semantics. An instance must not silently round, clamp, wrap, or reject integers
because they exceed a destination-specific finite range. As with existing numeric
instance laws, these are author/reviewer obligations, not algebraic compiler
optimizations.

In particular, for each valid source value:

```text
fromBigInt(BigInt.fromNat(n)) == Num.fromNat(n)
fromBigInt(BigInt.fromInt(i)) == Signed.fromInt(i)
```

Initial instances:

| Destination | `fromBigInt` meaning |
|---|---|
| `BigInt` | Identity |
| `Rat` | `Rat.create(value, 1)` |
| `Dec` | `Dec.create(value, 0)` |

`Nat`, `Int`, and `Float` do not honor this capability. The capability is available
to user-defined numeric types under the ordinary instance ownership and coherence
rules. It is not limited by a compiler list of permitted destination type names.

An ordinary export named `fromBigInt` does not opt a type into widening. Only
evidence for the canonical prelude `FromBigInt` constraint does so. Shadowing its
module name or declaring a similarly shaped user constraint grants no compiler
behaviour.

## 3. Keep the existing smaller-integer contracts

`Num.fromNat` and `Signed.fromInt` remain required, with their existing public
signatures and literal-elaboration roles. No parent-constraint defaults can be
injected by honoring a child constraint. No instance is synthesized implicitly.

For `Rat` and `Dec`, their implementations delegate explicitly:

```text
fromNat(value) = fromBigInt(BigInt.fromNat(value))
fromInt(value) = fromBigInt(BigInt.fromInt(value))
```

These are semantic equations; implementations use the ordinary instance-member
syntax and name resolution. `BigInt` retains its existing primitive exact
`fromNat` and `fromInt` implementations and supplies identity `fromBigInt`, so
delegation has no cycle.

This realizes the diagram without three independent construction algorithms and
without teaching the checker to search conversion chains. For generic targets
bounded only by `Num` or `Signed`, the existing conversion dictionaries still
suffice. A user-defined destination may use other equivalent implementations;
agreement of the three entries is part of its `FromBigInt` law.

## 4. Add one bounded source rule

Extend Numeric Literals §5.1 with one additional source case:

```text
source expression : BigInt
target is independently established
FromBigInt<target> evidence is available
───────────────────────────────────────────
source widens to target through fromBigInt
```

The existing `Nat` and `Int` rules are unchanged. In particular, the checker does
not choose between direct conversion and a searched indirect path. For those
sources it still calls `fromNat` or `fromInt`; §3 gives the implementations their
single shared exact-integer construction path.

Use the existing target-establishment, checking-order, exact-unification-first,
and expected-type-lift rules. An annotation, established parameter type, concrete
operand, or existing constrained type variable can establish the destination.
Widening does not invent a fresh destination variable or add a `FromBigInt` bound
to make an otherwise unconstrained expression succeed.

The following are intended examples, with ordinary `import Rat` where needed:

```hexagon
let count: BigInt = 3n
let fraction: Rat = count
let total = count * Rat.create(1, 2)
let reversed = Rat.create(1, 2) * count

let scale<a: FromBigInt>(count: BigInt, value: a): a = count * value
```

Both `count * 1.50d` and `1.50d * count` produce
`4.50d`. Existing `Nat`/`Int` forms produce that same retained decimal-place count.

For a target type variable, use its declared or otherwise established capability
evidence. A `Signed` bound alone does not promise acceptance of arbitrary-size
integers. Explicit `FromBigInt.fromBigInt` calls may of course infer the member's
ordinary declared constraint, as any constraint-member call does; that is distinct
from inventing evidence during automatic widening.

The existing bounded argument pass also handles BigInt sources: an earlier
BigInt argument must not prematurely bind a shared parameter when another
already-elaborated argument in that pass independently establishes a licensed
destination for the same parameter — the arguments at one shared parameter being
siblings of one expression tree (Numeric Literals §5.1's expression home, #1062).
This changes neither expression elaboration order nor runtime evaluation order.

A `FromBigInt` bound on the callee's freshly instantiated parameter does not
itself establish a destination. With no independently established target, a
BigInt argument must unify exactly as BigInt; `identity(1n)` must not invent a
new constrained result or require an unavailable conversion dictionary. A
caller-owned rigid variable or an already-constrained inferred caller variable
can establish a target. The same evidence may arrive through corresponding
container arguments or explicitly shared record fields; unknown row-tail
contents establish nothing. Unrelated parameter variables do not share targets,
and a callback's borrowed expectation cannot establish itself as a destination.

Types provisionally selected inside a nested arithmetic expression by an
expected type retain the existing expected-home and stand-down rules. They
must not be treated as independently fixed source types merely because they
currently display as BigInt. This remains bounded argument checking, not a
new unrestricted inference search.

When operand-based comparison/arithmetic home selection needs to distinguish
the fixed integer sources, prefer an independently established non-Nat/Int/BigInt
numeric destination over those sources; otherwise prefer BigInt, then Int, then
Nat. Conversions must still be licensed by actual evidence. This neither guesses
a third destination nor overrides an already established expected home. For
example, BigInt with Rat selects Rat in either operand order; BigInt with Int
selects BigInt; BigInt with Float is still rejected. Two unrelated non-source
destinations remain subject to the existing exact-unification/refusal rules.

Same-type `BigInt` expressions unify normally, with no identity conversion call
required. Every inserted conversion evaluates its source once and preserves the
existing evaluation order. Runtime dispatch uses ordinary constraint dictionaries;
there is no new dictionary representation or general conversion registry.

## 5. Arithmetic, dots, and literal boundaries

`FromBigInt` is a conversion capability, **not an additional arithmetic tower
rung**. The existing closed tower remains `Num`, `Signed`, `Frac`, `Pow`, `Integral`,
and `Bitwise` (`bitwise.md` §5.1). Its existing expected-type lift can now inject BigInt-source operands
into a home that carries both the requested arithmetic instance and `FromBigInt`.
It must not lift the argument of `fromBigInt` itself from `BigInt` to its result
type; that argument's declared type remains `BigInt`.

An expected `Rat` home therefore evaluates a BigInt addition as Rat addition,
just as an expected Rat home already governs Int-source arithmetic. Where no
home is established, BigInt arithmetic remains BigInt arithmetic. A standalone
BigInt division expression does not gain `Frac` or default to `Rat`.

The rule applies at ordinary value seats and all existing spellings of tower
member calls: operators, qualified, pipe, and dot. Keep receiver-based member
resolution and the existing stand-down/refusal rules. It must not search Rat or
Dec members on a BigInt receiver merely because a conversion exists. Comparisons
use their existing ordinary seat widening; `Eq` and `Ord` do not become tower
rungs.

BigInt joins Nat and Int in Method Syntax's fixed-source ownership clause for
unhonored canonical tower members. This adds `Frac.divide` to its owned dot
spellings: under an expected Rat home `big.divide(otherBig)` matches `/`.
Without a legal home it still refuses for missing `Frac<BigInt>` and does not
invent a Float or Rat destination. BigInt's existing `pow` door remains its door;
user-constraint members are not added to ownership. Completion marks the owned
unhonored member as requiring a face.

`Pow` retains its declared exponent seat. This proposal does not widen a BigInt
exponent down to `Int`, change Dec's negative-exponent rejection, or change
BigInt's existing widened power companion. No reverse integer conversion is added.
For example, unannotated `2n ** -2` remains a BigInt operation and throws its
negative-exponent error. With `let r: Rat = 2n ** -2`, the independently expected
Rat home converts the base and uses Rat's negative-power semantics; the exponent
stays Int. Dec similarly keeps its own rejection of negative exponents.

The conversion member itself has no subject-receiver dot spelling: its parameter
is the BigInt source, not its destination subject. Use
`FromBigInt.fromBigInt(value)` with a determined result type, or an honoring
companion such as `Rat.fromBigInt(value)`.

The `n` suffix still denotes a monomorphic BigInt literal. `let n = 3n` is BigInt;
`let r: Rat = 3n` is an ordinary contextual conversion of that BigInt value.
There is no polymorphic BigInt-literal elaboration, and `fromBigInt` is not added
to `Num`. Existing bare integer payload limits and defaulting are unchanged.

Literal patterns do not perform contextual numeric widening. A `3n` pattern is
still a BigInt pattern and is refused at a Rat or Dec subject; use the target's
own supported pattern form. Dec's `d` literal design remains independent.

## 6. Deliberately absent conversions

- No `BigInt` to `Float`, `Int`, or `Nat` implicit conversion, even when a
  particular value happens to fit.
- No `Float` to `Rat` or `Dec` conversion.
- No implicit `Rat` to `Dec`, `Dec` to `Rat`, or exact-to-Float conversion beyond
  the existing `Nat`/`Int` rules. Named conversion APIs remain named.
- No general transitive closure over exported functions or instances. In
  particular, `BigInt -> Rat -> Float` is not an implicit route.
- No new conversion from an arbitrary `Integral` source. Its current contract
  is integer division, not a canonical integer-extraction operation.

## 7. Implementation obligations and prerequisite order

Implement and validate this capability with BigInt and Rat first. Dec can then
join through an ordinary instance when its module is implemented; the compiler
must not depend on Dec being present to establish this mechanism.

Place `FromBigInt` after `Signed` and before its honoring modules in the prelude.
Its signature names only the compiler primitive `BigInt` and its subject, so it
does not depend on the later BigInt companion implementation. Register canonical
constraint identity, base/member metadata, and ordinary dictionary evidence;
regenerate embedded standard-library sources and check host consumers.

Use exact primitive Nat/Int-to-BigInt conversions in the delegated entries.
Migrate any destination's ordinary same-named export to its instance member
without retaining duplicate declarations. Preserve its qualified companion face.
Rat remains an ordinary imported module; Dec's planned prelude membership does
not move Rat into the prelude or create a dependency in the reverse direction.

Update the owners together before marking the proposal implemented: Numeric
Literals §5.1 and its literal/rejected-alternative wording, Constraints inventory,
Friendly Numerics' two-route description, relevant Method Syntax and Functions
references, Rat's conversion inventory, Dec's instance/construction sections,
and the prelude/stdlib inventory. Historical rejection of a polymorphic `n`
literal remains valid; a blanket ban on BigInt-source widening does not.

Audit every two-source compiler path, not just the direct widening helper:
reachability and exact-acceptance checks, argument deferral, comparison home
selection, expected-type lift and stand-down/door checks, typed/core conversion
nodes, elaboration, emission, and type-occurrence reporting. Retain the existing
source-provenance checks for canonical constraint identities.

## 8. Acceptance cases

- BigInt to Rat at annotations, argument/return/assignment seats, both operand
  orders, comparison seats, and existing tower call spellings.
- Values beyond the Int safe range stay exact. Nat/Int inputs of both signs
  (where applicable) agree with the corresponding BigInt inputs.
- Generic `a: FromBigInt` dispatch works through ordinary evidence; `a: Signed`
  alone does not accept a BigInt input. Unconstrained expressions do not acquire
  a destination type or capability merely to permit conversion.
- Expected-type lifting performs the operation in the target type; closed tower
  and non-tower stand-down behaviour remain intact, including the exponent seat.
- Monomorphic `n` literals widen only at expression seats; mismatched literal
  patterns are rejected and bare literal defaulting/range rules are unchanged.
- Negative controls for all §6 exclusions and for a user-defined ordinary
  `fromBigInt` function without the canonical capability instance.
- A lawful user nominal instance works without a hard-coded destination entry.
- Source expressions are evaluated once in order; inferred effects and generated
  public declarations retain the existing constraint-boundary contracts.
- BigInt identity and Rat's delegated fromNat/fromInt entries do not recurse.
- Repeat positive cases against Dec's zero-place integer injection
  and exact retained-place multiplication, keeping Rat conversions Rat-owned.

The dedicated `integer-widening-arguments.test.ts` checks independent target
evidence, exact BigInt inference, structural and generic targets, and runtime
evaluation order.
