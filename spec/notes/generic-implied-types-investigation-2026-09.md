# Generic implied types: investigation brief

**Status:** Approved investigation agenda, non-normative; 2026-09-13.
**Tracking:** [Issue #916](https://github.com/hexagonal/Hexagon/issues/916).

This brief records the work to begin in a fresh session when James requests it.
It adopts no language rules, claims no inference result, and requests no immediate
implementation. Merging this brief does not complete the investigation or close
its issue.

## Purpose

Determine whether generic implied types can preserve Hexagon's derivability
guarantees while allowing inferred result types and inferred constraints on those
results. The motivating customer is [#348](https://github.com/hexagonal/Hexagon/issues/348):
could one absolute-value constraint serve ordinary real numeric types and a future
Complex type whose magnitude is scalar? Generic Iterable is an independent
customer; the result must justify a general capability, not an abs exception.

Hexagon should be secretly mathematical: algebra disciplines the design while
approachable capabilities and predictable exact conversions serve ordinary users.
Neither mathematical vocabulary nor annotations should become a tax for using
this capability.

## Starting boundary

Read the current owners and verify their implementation before proposing changes:

- [Annotation doctrine §2.4](../decisions-ml-dialect-annotations-2026-08.md):
  annotations restrict inference rather than add typing power. Rank-2 types and
  polymorphic recursion remain rejected; exports and determinacy requirements
  must be distinguished from annotation-enabled typing power.
- [Functions](../functions.md): rank-1 generalization, monomorphic recursive
  groups, and the specified checking schedule.
- [Constraints](../constraints.md): coherence, constructor-headed instances,
  constraint accumulation, and dictionary evidence.
- [Collections Part 2 §§5–7](../collections-part2-hash-and-type-members.md):
  implied types exist, but projection-bearing generic bounds and external
  projection references are restricted. Instance type-member definitions cannot
  refer to implied types, preventing recursive projection definitions.
- [Numeric Literals](../numeric-literals.md), [Friendly Numerics](../friendly-numerics.md),
  and [Effects](../effects.md): widening, defaulting, expected-type propagation,
  and effect inference must remain coherent with the extension.

Rust associated types are a useful precedent, not a proof of the inference
properties Hexagon requires. Distinguish decidable checking, terminating
inference, principal inferred descriptions, coherence, and annotation independence.

## Candidate to investigate, not a decision

Retain symbolic implied types in inferred generic signatures, together with
requirements inferred from their use. Derive implied results forwards from their
subjects; do not search for subjects merely to satisfy a desired result type.
Determine how equality constraints and ambiguity should behave under that
candidate, rather than assuming that ordinary unification already answers them.

For example, a generic use of absolute value could retain “the magnitude of a” as
its result. Adding two such results should infer the required numeric obligation
on that magnitude, without a handwritten bound enabling otherwise unavailable
typing power. These descriptions propose no surface syntax or constraint name.

Begin with existing coherence and instance/type-member restrictions. Any proposed
relaxation needs a separate justification and a decision from James. A unique
instance alone does not establish termination or principality.

Keep numeric contracts separate from inference machinery. Complex(Rat) need not
have rational magnitude: the magnitude of 1 + i is the square root of 2. Sharing
the name abs does not authorize a silent approximate conversion or a perfect-root
test. Likewise, an exact BigInt-to-Rat capability and permission for implicit
widening are separate decisions. The current Pow widening mechanism preserves
its result type and is not already a solution to result-type variation.

## Investigation sequence

1. Reconcile specification and implementation; state the precise guarantee to
   preserve and the smallest candidate fragment. Identify prior blockers before
   expanding the design.
2. Develop worked acceptance/refusal cases: generic abs, adding magnitudes,
   generic iteration, conflicting expected types, projection equalities,
   unresolved subjects, direct and mutual recursion, and interactions with
   widening, defaulting, and effects. Include annotation-removal comparisons
   respecting existing boundary requirements. These become future test
   obligations, not implementation requests in this brief.
3. Describe constraint generation, generalization, normalization/resolution,
   ambiguity handling, and evidence preservation. Give an argument for termination
   and principal inference within the fragment; explicitly record any unproved
   obligations. Examples alone are not a proof.
4. Obtain Sol Medium review of the argument and counterexamples. Recommend
   proceeding with a bounded design, narrowing it, or preserving the current
   restriction. Discuss substantial decisions with James individually before
   adoption.

The deliverable is a non-normative investigation report with the boundary,
examples, algorithm argument, limitations, and reviewed recommendation. Only
after James accepts the outcome should separate normative-specification and
implementation issues follow as appropriate. Two names for real absolute value
and complex magnitude remain an available outcome if the general mechanism does
not meet Hexagon's guarantees at an acceptable cost.

## Related work and division of labour

- [#190](https://github.com/hexagonal/Hexagon/issues/190) concerns preserving
  projection identity in checker output and return-annotation tooling. It is
  related evidence, not a substitute for this investigation; verify current
  implementation details rather than treating the issue's snapshot as current.
- [Semantic consolidation agenda](semantic-consolidation-questions-2026-09.md)
  (PR #900) owns the broader core/inference reconciliation questions.
- #350, the historical prerequisite in #348, is closed. Reassess actual blockers
  rather than reopening it based on the old discussion.

Astra writes specification and book material. Sol Medium implements and reviews.
Additional agents are Terra Medium. Terra Medium merges after applicable checks
and required decisions are complete. This brief's publication is authorized; the
investigation itself awaits James's fresh-session request.
