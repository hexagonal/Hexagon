# Friendly Sequences — proposal

**Status:** Proposed, non-normative; 2026-09-06. Records James's requested
sequence-seat convenience and the simple, bounded design discussed with him.
Merging this note records a proposal; it does not adopt a language rule or
claim compiler support. Normative specification and implementation follow
separately after review.

## 1. The proposal

> A function that asks only for a sequence should accept any collection that
> can supply one.

When a seat independently expects `Seq(a)`, accept a value whose known source
type honors `Iterable` with `Item = a`, inserting that instance's `toSeq`.
An existing `Seq(a)` passes through unchanged.

This is one specific language rule. It introduces no syntax, general implicit
conversion facility, conversion search, overload ranking, or subtyping relation.
The only destination is `Seq`; the only conversion is the unique `Iterable`
instance's member. A plain function named `toSeq` confers no capability.

```hex
let words = ["red", "green", "blue"]
String.fromSeq(words)
```

The call means exactly:

```hex
String.fromSeq(Iterable.toSeq(words))
```

A future `String.join` taking a `Seq(String)` parameter would equally accept:

```hex
String.join(", ", words)
```

`String.fromSeq` exists in this checkout. `String.join` remains a stdlib listing
item; its example illustrates the proposed call behavior, not a shipped API.
User functions taking `Seq(a)` receive the same convenience automatically.

## 2. Existing foundations

[Collections Part 5 §§2–4](../collections-part5-iterable.md) already defines
`Iterable` through its associated `Item` and `toSeq` member. Its coherent
instances include `Vector`, `Map`, `Set`, `String`, `Range`, `Seq`, and the
borrowed foreign collections. Provided instances need not appear as source
`honor` declarations in each companion module.

A `for` head already resolves the source's instance and conceptually converts
once before traversal. This proposal extends that convenience to ordinary
sequence seats; it does not redefine loops or their pattern rules.

`Seq` retains its persistent functional-cursor semantics. Renaming `Iterable`
is a separate question and is not required here. Generic `Iterable` binders
and deferred associated-type inference are also outside this proposal: a
consumer can continue to take `Seq(a)`, with conversion at its caller.

## 3. Checking and elaboration

At an expression seat, under the existing deterministic checking schedule:

1. Read the destination independently supplied by the seat. Its outer
   constructor must already be `Seq`; its item type may be unsolved.
2. Establish the source expression's type once. Do not change its collection
   constructor to satisfy the destination, or retry it under another meaning.
3. For source `Seq(b)`, use ordinary unification of `b` with the destination
   item type. No conversion is needed.
4. Otherwise, require the source's outer constructor to be known. Resolve its
   unique applicable `Iterable` instance using existing instance rules, and
   substitute source type arguments into the instance's `Item` binding.
5. Unify that item type with the destination item type, using ordinary
   unification only. If successful, insert the resolved member call. Otherwise
   report a type mismatch; do not try a second route.

The source can contain type variables: `Vector(a)` has a known outer
constructor. A bare unresolved or declared type variable supplies no instance
head and does not gain an inferred `Iterable` bound through this rule.
Existing instance prerequisites still have to be satisfied.

A destination `Seq(?a)` suffices: `Vector(String)` can establish `?a = String`.
A destination that is only `?t` does not trigger conversion. Ordinary inference
continues, preserving the collection type; there is no later replay merely
because another expression subsequently establishes a sequence destination.

```hex
let words = ["red", "green"]       // Vector(String)
let view: Seq(String) = words      // inserts toSeq
let same = words                  // Vector(String)
```

Use the supplying seats and value-forwarding forms of
[Functions §4.3](../functions.md): annotated bindings, ascriptions, known call
parameters, and expected return/body positions reached by that schedule.
Known constructor parameters count as call parameters. Expectations can reach
branches and lambda bodies through the existing forwarding rules. The
normative follow-up must specify the insertion point without prematurely
unifying a source collection with `Seq` during expectation propagation.

Call spellings share the rule after ordinary resolution: qualified calls,
function aliases with known signatures, pipes, and resolved dot-call argument
seats. Method lookup itself is unchanged. A vector does not acquire `Seq`
methods through conversion search.

## 4. Deliberate boundaries

- **One direction:** iterable source to `Seq`. No automatic collection
  materialization, reverse conversion, or conversion chains.
- **Unchanged elements:** an established `Vector(Int)` supplies `Seq(Int)`,
  not `Seq(Float)`. This rule does not map numeric conversions over items.
  Literal typing remains governed by its existing rules; no new inward
  element expectation is introduced by sequence adaptation.
- **No structural lifting:** an established `Option(Vector(a))` does not
  become `Option(Seq(a))`, nor does an established container get traversed to
  adapt its components. A newly written constructor argument that itself
  expects `Seq(a)` is an ordinary eligible seat.
- **No function adaptation:** an established function returning `Vector(a)`
  does not become a function returning `Seq(a)`. A lambda body checked against
  a known `Seq(a)` return seat may use the rule at that body.
- **No inferred common collection type:** unrelated collection types do not
  cause inference to invent `Seq` as their common destination. Branches with
  an independently supplied `Seq` expectation may each adapt at that seat.
- **No alternate dispatch:** conversion does not choose a different callee,
  resolve a method collision, or reopen a failed expression.

## 5. Meaning and soundness obligation

The inserted call must behave exactly like an explicit call to the resolved
`Iterable.toSeq` at that boundary. Evaluate the source once, preserve existing
runtime evaluation order, and perform conversion at that point. Do not add
memoization, eager traversal, copying, or snapshotting. Existing sequence
values pass through unchanged.

Traversal order, laziness, exceptions, and cost are those of the existing
instance. Purity does not promise termination or constant cost. Borrowed
foreign collections retain their existing stability and observation contracts;
conversion does not turn a borrow into an owned snapshot. Effectful `Stream`
remains outside `Iterable`, as specified by [Stream §5](../stream.md).

The type-preservation argument is local: an instance supplies
`toSeq : c -> Seq(Item)`; the source has type `c`; ordinary unification proves
`Item = a`; therefore the elaborated call has the required `Seq(a)` type.
This relies on existing instance coherence and lawful conversion contracts.
The implementation must additionally preserve the established inference and
generalization rules; conversion insertion is a real application, not a
representation cast or a license to generalize an expression differently.

Uniformity has visible consequences. Because strings iterate over codepoint
strings, the proposed `String.join("-", "cat")` produces `"c-a-t"`. Maps supply
entry tuples; sets supply their specified traversal order. No consumer-specific
exceptions are proposed. Infinite sequences remain possible, and an exhaustive
consumer may not terminate.

## 6. Relationship to Friendly Numerics and widens

[Friendly Numerics](../friendly-numerics.md) supplies the design analogy:
a known destination can admit an input through a designated conversion,
without guessing what the programmer meant. Here the destination asks for
traversal, and the instance supplies its canonical sequence view. This does
not claim that collection-to-sequence conversion is a numeric embedding.

[`widens`, Constraints §4.7](../constraints.md) similarly keeps one
implementation and derives a narrower member through certified conversions.
It is an analogy, not a dependency. **Leave `widens` unchanged.** No new
`widens` declaration is required on a sequence consumer, and this proposal
does not extend its declaration checks or alter its effect contracts.

## 7. Follow-up specification and acceptance evidence

Before implementation, promote the chosen rule into its owning specifications:
Functions for seat timing and forwarding, Collections Part 5 for instance
resolution and conversion, and any affected generalization or FFI wording.
Keep loop semantics and method selection intact. Audit statements that currently
require explicit sequence conversion. This note does not supersede them.

Conformance should demonstrate:

- `String.fromSeq` and a user `Seq(a)` consumer accept vectors; a generic
  element type is inferred from the source's `Item`.
- Provided collection instances and a lawful user instance follow the same
  route; `Seq` identity and current direct `for` behavior remain intact.
- Known call aliases, pipes, annotated bindings, forwarded branches, and
  lambda return seats agree with their explicit-conversion forms.
- Missing instances, mismatched items, unknown source heads, and unknown
  destinations follow the stated refusals or ordinary inference.
- Nested containers, established function values, and numeric element
  conversion do not acquire implicit adapters.
- Method lookup and elaboration order remain deterministic, including a
  destination fixed only by a later sibling; no speculative retry occurs.
- Evaluation happens once and in order; lazy and borrowed-view behavior matches
  explicit `toSeq`, including exceptions and observation timing.
- Generalization remains valid for conversion applications, and no effectful
  stream is admitted through the new rule.

The delivery criterion is the complete bounded rule, not a collection-specific
shortcut in `String` or a compiler special case that accepts vectors alone.
