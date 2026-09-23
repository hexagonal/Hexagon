# Friendly Sequences — proposal

**Status:** Proposed, non-normative. Written 2026-09-06; revised 2026-09-23
following the simplified design discussion. The requirements below specify the
proposed behaviour, not current compiler support. Keep this document in
`spec/notes` until the implementation prerequisites in §8 are complete and the
inference obligations in §6 have been reviewed. Promotion is a separate step.

This revision supersedes the earlier framing of this note. Generic implied
types remain abandoned; no part of that investigation is revived here.

## 1. Principle

> Both loops and sequence parameters require a sequence, and the same
> adaptation rule supplies one from an iterable value.

An explicit sequence annotation supplies the same requirement. The consumer
establishes that a sequence is needed; the source type establishes which
`Iterable` instance supplies it.

A function that needs only sequential traversal takes `Seq(a)`. A collection
provides its sequence view by honoring `Iterable`, whose `Item` is the element
type and whose `toSeq` member produces that view. The compiler inserts that
member call at the boundaries specified below. Consumer authors need no second
`fromIterable` entry point beside `fromSeq`.

```hex
let words = ["red", "green", "blue"]
String.fromSeq(words)
```

The call means:

```hex
String.fromSeq(Iterable.toSeq(words))
```

This applies to user functions as well as standard-library functions. Functions
that need indexing, keyed lookup, updates, or a particular collection result
continue to use the appropriate collection type; this proposal does not replace
all collection APIs with sequence APIs.

`Iterable` is a constraint, not a common value type or a supertype of all
collections. `Seq(a)` is an immutable, lazy, possibly infinite sequence. Its
`next` operation returns an element and a successor sequence without consuming
the original. It therefore serves as a reusable sequence input, not a shared
mutable iterator. [Loops §6](../loops-ranges-iteration.md) owns that contract.

## 2. Where adaptation applies

The proposed supplying contexts are:

| Context | Source of the sequence requirement |
|---|---|
| `for pattern in source` | The loop construct requires sequential traversal |
| An argument to a known function parameter `Seq(a)` | The resolved parameter type |
| An immutable binding annotated `Seq(a)` | The binding annotation |
| A function body with a declared result `Seq(a)` | The result declaration |

A known parameter type may come from an instantiated inferred signature; it
need not be written on the callee. Constructor parameters are function
parameters too. Qualified calls, aliases with known signatures, pipes, and
resolved dot-call argument positions share the rule after ordinary resolution.
Conversion does not participate in choosing the callee or resolving a dot.

```hex
let words = ["red", "green"]
let view: Seq(String) = words       // adapt through Iterable.toSeq
let same = words                   // retain Vector(String)

let colors(): Seq(String) =
    ["red", "green"]               // adapt at the declared result
```

Existing expected-type forwarding from [Functions §4.3](../functions.md)
applies within these contexts: grouping, final expressions of blocks,
conditional and match result branches, and lambda bodies where the known
function expectation supplies a sequence result. It does not invent new
forwarding through arbitrary data structures. The result declaration above is
one direct way to supply the body expectation, not a restriction to named
functions.

The same written `Seq(a)` expectation in an expression ascription is treated
like a binding annotation, using the existing ascription supplying context in
Functions §4.3. This is spelling consistency for an explicit sequence demand,
not general propagation into existing values. Mutable bindings and assignment
are outside this proposal's supplying contexts; any extension there requires
separate review.

### 2.1 Branches adapt independently

Suppose `firstCollection: Seq(String)` and
`secondCollection: Vector(String)`:

```hex
let colors: Seq(String) =
    if useFirst then firstCollection else secondCollection
```

Its meaning is:

```hex
let colors: Seq(String) =
    if useFirst then firstCollection
    else Iterable.toSeq(secondCollection)
```

The destination comes from the annotation, before either branch supplies its
value. Each branch is checked against it independently. Only the selected
branch is evaluated, and its conversion occurs there. Both branches may instead
be different iterable collection types with the same element type.

Without an independently supplied sequence expectation, a sequence-valued
branch does not authorize conversion of its sibling. Ordinary branch inference
and unification apply; inference does not invent `Seq` as a common collection
type. Nor does this proposal make existing tuple, record, or other container
values forward expectations into their contents.

## 3. One adaptation rule

At an eligible expression boundary, under the existing deterministic checking
schedule:

1. Read the independently supplied destination. Its outer constructor must
   already be `Seq`; its element type may be an unsolved inference variable.
2. Establish the source expression's type once, preserving its own collection
   constructor. Do not first force that constructor to unify with `Seq`, retry
   the expression with a different interpretation, or use the sequence demand
   to select an overloaded meaning.
3. If the source is `Seq(b)`, unify `b` with the expected element type using
   ordinary unification. Use the original sequence unchanged.
4. Otherwise require a known source outer constructor. Resolve its unique
   global `Iterable` instance through the existing instance-resolution rules.
   Substitute the source type arguments into its `Item` binding and discharge
   the instance's prerequisites. Prerequisites never select among candidates.
5. Unify the resulting `Item` with the expected element type using ordinary
   unification. If successful, insert a call to the resolved `toSeq` member.
   Otherwise report the mismatch; there is no second conversion route.

`Vector(a)` has a known constructor even when its element type is generic.
A source that is only an unresolved or declared type variable does not provide
an instance head. This rule neither infers a generic `Iterable` bound nor adds
support for symbolic associated-type projections.

A destination `Seq(?a)` is sufficient: a `Vector(String)` source can establish
`?a = String`. A destination that is only `?t` is not sufficient. A later
argument or sibling expression establishing `?t = Seq(String)` does not cause
an earlier expression to be checked again. Follow Functions §4.3's existing
elaboration schedule; do not change runtime evaluation order.

Instance identity, prerequisites, visibility, and provider availability are
exactly those of the explicit member call. Adaptation grants no access to an
unavailable implementation or a provider imported only through a bare view.
A plain function named `toSeq` does not establish `Iterable` capability.

## 4. Loops use the same sequence supply

For `for pattern in source`, the loop itself supplies the sequence requirement.
Establish the source type and resolve its instance as in §3. The instance's
`Item` supplies the loop's element type; no element annotation is required.
An existing `Seq` passes through unchanged. Loop pattern checking,
irrefutability, scope, body type, and result type remain as specified by
[Collections Part 5 §3](../collections-part5-iterable.md) and
[Loops §2](../loops-ranges-iteration.md).

Conceptually the loop traverses the sequence supplied by `Iterable.toSeq(source)`.
This unifies the capability lookup and conversion meaning of loops and
ordinary sequence consumers; it does not turn a function call into a loop.
The current loop specification already uses this conversion conceptually.

Retain native traversal optimizations where canonical instance provenance
licenses them. A semantic sequence requirement does not require allocating a
sequence wrapper or replacing an existing native loop with cursor calls.
Optimized traversal must preserve the resolved instance's behaviour and the
source-defined-instance migration's cost requirements.

## 5. Meaning and deliberate limits

An inserted conversion behaves exactly like an explicit call to that resolved
`Iterable.toSeq` at the same boundary. Evaluate the source once and preserve
runtime evaluation order, exceptions, traversal order, laziness, and cost.
Do not add eager traversal, copying, memoization, or another foreign snapshot.
Foreign sequences observe the captured contents established by their existing
boundary contracts.

`Iterable.toSeq` has a pure constraint contract. Its source instance body has
inferred effects and must satisfy that contract. Automatic adaptation adds no
effect mark and does not hide effects from evaluating the source expression.
Effectful `Stream` remains outside `Iterable`.

The following are excluded:

- **Element conversion:** an established `Vector(Int)` supplies `Seq(Int)`,
  not `Seq(Float)`. No numeric conversion is mapped over elements; no new
  sequence-element expectation is pushed inward to retarget collection
  literals. Existing literal typing otherwise remains unchanged.
- **Structural conversion:** an existing `Option(Vector(a))` does not become
  `Option(Seq(a))`. A newly written constructor argument whose own parameter
  expects `Seq(a)` is an ordinary eligible argument.
- **Function conversion:** an existing function returning a vector does not
  become a function returning a sequence. Checking a newly written lambda
  body against a known sequence result is the ordinary body case in §2.
- **Method search:** a vector does not acquire `Seq` methods. A resolved
  `Seq.map(values, transform)` can adapt its argument; this rule does not make
  `values.map(transform)` resolve to `Seq.map`.
- **Other destinations:** no reverse conversion, automatic collection
  materialization, conversion chains, subtyping, or changes to `widens`.

All lawful instances follow the same rule. Strings supply codepoint strings;
maps supply entry tuples; sets preserve their specified traversal order. There
are no consumer-specific exceptions. An exhaustive consumer of an infinite
sequence can still fail to terminate.

Explicit `toSeq` remains useful when a programmer wants to establish a sequence
without a supplying context or select sequence operations explicitly. Reducing
its routine use does not remove the member or its existing spellings.

## 6. Hindley–Milner and elaboration obligations

Preserving Hexagon's Hindley–Milner inference discipline is a requirement of
adoption. The proposed rule introduces deterministic elaboration at a known
sequence demand; it must not introduce conversion search into unification.

The local type-preservation argument is simple: the selected instance supplies
`toSeq: c -> Seq(Item)`, the expression has type `c`, and ordinary unification
establishes `Item = a`. The inserted application therefore has type `Seq(a)`.
**That argument alone is not a proof of principal inference.**

Before promotion, the design review must account for:

- Principal inference in the presence of the specified contextual elaboration,
  rigid annotation variables, and existing constraint inference.
- The interaction with the existing annotation/derivability doctrine: an
  annotated binding can deliberately request a converted value while an
  unannotated binding retains the collection. State the precise compatibility
  or necessary focused amendment in the owning specification; do not silently
  claim that this behaviour is ordinary unification alone.
- Generalization and the value restriction: an inserted conversion is a real
  application, not a representation cast. Apply the existing rules to the
  elaborated expression; no variable gains polymorphism by hiding that call.
- A precise insertion point that preserves source constructor inference while
  allowing expected sequence types to reach eligible branches and bodies.
- Independence from incidental traversal of the checker, with no replay after
  later constraints, guessed collection heads, or new deferred projections.

If satisfying these obligations requires reviving the abandoned generic
implied-types machinery, return the design for reconsideration rather than
expanding its scope under this proposal.

## 7. Acceptance evidence

Promotion and subsequent implementation must distinguish specification review
from executable conformance. The implementation acceptance suite must cover:

1. Library and user `Seq(a)` consumers accepting standard and user iterable
   collections; element inference from `Item`; identity for an existing `Seq`.
2. Equivalent resolved call spellings, annotated bindings, declared results,
   ascriptions, forwarded blocks/branches, and expected lambda results.
3. A `Seq` branch and a non-`Seq` iterable branch under an independent `Seq`
   expectation; different iterable branches; only the selected branch running.
4. Unannotated bindings retaining their collection types and mixed branches
   without a sequence expectation receiving ordinary typing, not adaptation.
5. Missing instances, unavailable providers, unsatisfied prerequisites,
   mismatched elements, unknown source heads, and destinations fixed too late.
6. Refusal of element, nested-container, existing-function, and method-search
   adaptations; rejection of effectful `toSeq` instances and `Stream` sources.
7. The existing checking order, generalization, rigid-variable, and recursion
   rules, including examples that would expose unsound extra polymorphism.
8. Exactly-once source evaluation, evaluation order, exception timing,
   persistence, laziness, and equivalence to explicit conversion.
9. Loop behaviour and native optimization costs, with canonical and user
   instances distinguished by provenance rather than spelling.
10. Foreign snapshots remaining stable after mutation on the JavaScript side,
    including lazy sequences retained beyond the crossing that captured them.

## 8. Prerequisites and promotion

The agreed delivery order is:

1. **Boundary snapshots implemented.** Captured `Array`, `JsMap`, and `JsSet`
   behaviour must be implemented and verified, not merely specified. The
   owners are [FFI boundary](../ffi-part1-boundary.md),
   [Array](../ffi-part2-nullable-array.md), and
   [JsMap/JsSet](../ffi-part10-js-map-set.md). Domestic immutable collections
   do not need new snapshots to make their traversal pure.
2. **Effect marking aligned with the contract/implementation distinction.**
   Constraint members state their effect contracts; instance bodies infer
   their effects and are checked against those contracts. See the
   [effect-contract proposal](constraint-effects-proposal-fable-2026-09.md)
   and its promotion record pointing to [Effects §13](../effects.md).
3. **Standard Iterable instances authoritative in Hexagon source.** Complete
   the [source-defined Iterable proposal](source-defined-iterable-proposal-2026-09.md):
   each standard collection's canonical home owns its `honor Iterable` block
   and `toSeq` implementation, replacing the corresponding hidden provided
   row. Private storage intrinsics and justified native optimizations remain
   permitted. Resolve the `Seq`/`Iterable` loading dependency, `Range`'s source
   home, and the `JsMap.entries` delegation cycle as that proposal requires.
4. **Review and promote Friendly Sequences.** After those implementation gates
   and §6's design obligations are satisfied, promote the rule into Functions,
   Collections Part 5, Loops, and the affected annotation/generalization
   owners. Then implement and verify the full bounded rule.

This is a dependency plan, not a claim that all earlier implementation work is
missing. As inspected on 2026-09-23, the constraint is already declared in
[`Iterable.hex`](../../stdlib/Iterable.hex), and
[`String.hex`](../../stdlib/String.hex) already owns `honor Iterable<String>`.
The source-defined-instance note records that first slice as adopted and the
remaining rows as proposed. The snapshot and effect notes likewise record
normative promotions; those records alone do not establish complete runtime
conformance. Verify completion against the implementation when advancing a gate.

In particular, “source-defined `Iterable.toSeq`” means the actual instance
member bodies in collection homes, not moving the constraint out of
`Iterable.hex` or adding ordinary exported functions alongside its members.
Until promotion, this note supersedes no normative rule requiring explicit
conversion and authorizes no compiler change.
