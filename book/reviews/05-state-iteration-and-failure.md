# Group Review: State, Iteration, and Failure

**Chapters reviewed:** Mutable Variables; Loops and Ranges; Sequences; Exceptions.

**Status:** Reviewed as a consistent drafting group. This is not the late whole-book
pedagogy pass, and chapter numbers remain provisional.

## Coherence result

The group follows a useful progression:

1. mutable variables provide confined changing state inside one function;
2. loops give that state its principal iterative use;
3. sequences explain the lazy immutable values consumed by general iteration; and
4. exceptions add the separate possibility that ordinary evaluation may not complete.

Each feature remains bounded. A `var` cannot cross a lambda or module boundary. A loop
resolves its source and element type statically. A sequence advances by returning a new
position rather than exposing a mutable cursor. An unmatched exception propagates
through one explicit open error type. The chapters therefore broaden the account of
effects without undoing the earlier value-and-function model.

## Integrated corrections

- Renamed **Local Mutation** to **Mutable Variables**, matching familiar developer
  vocabulary without suggesting that Hexagon values themselves mutate.
- Renamed **Lazy Sequences** to **Sequences** because laziness is an inherent property
  of `Seq(a)`, not a separate sequence category in the book.
- Simplified **Loops, Ranges, and Iteration** to **Loops and Ranges** under the
  short-noun-title convention; iteration is already the chapter's subject.
- Replaced the lambda-boundary example's unexplained `map` dependency with a
  self-contained local lambda, preserving the exact capture error and snapshot repair.
- Gave the refutable loop-pattern example an explicit `Seq(Option(Int))` source so its
  only intended failure is pattern refutability rather than missing iterability.
- Corrected the hypothetical exported sequence declaration to
  `export declare const visibleSquares: Iterable<number>`.
- Removed `Iterable`'s declaration, `Item`, associated-type terminology, and the
  abstract-binder failure from the loops chapter. Ordinary readers now receive the
  concrete rule: every iterable type has one statically determined element type, and
  reusable consumers accept `Seq(a)`.
- Updated the previous group review so it no longer promises associated-type teaching
  in the loops chapter. That mechanism belongs with later collection-extension or
  advanced material.
- Added the direct mental model that `catch` is like `match`, except its scrutinee is
  the thrown exception and unmatched cases are rethrown rather than rejected as
  non-exhaustive.
- Sharpened the reachability example from a vague “second foreign catch” to a second
  `JsError` arm.

## Pedagogical dependency check

Mutable Variables depends only on immutable bindings, block results, `Unit`, functions,
inference, and record updates already established. The chapter does not wait for loops
to explain its rules, but ends by handing its most important use to the next chapter.
The snapshot example makes the lambda boundary concrete without requiring collection
or sequence knowledge.

Loops and Ranges then pays off `var` immediately with `sumTo` and `countdown`. It reuses
the pattern chapter's irrefutability gate rather than inventing loop-specific
destructuring. `Seq(a)` is previewed only as an explicitly explained iterable source;
the following chapter owns laziness and the cursor model. Removing associated types
was the right dependency correction: library-extension machinery no longer interrupts
the ordinary act of writing a loop.

Sequences arrives after loops, `Option`, tuples, pattern matching, pipes, and lambdas.
That lets `Seq.next` be explained entirely through familiar pieces. **Functional
cursor** earns its technical name only after the reader has seen `Some((value, rest))`
and learned that the original position remains unchanged. Representative combinators
show laziness without turning the chapter into a library catalogue.

Exceptions appears only after `Result`, unions, and the complete pattern language. The
chapter can therefore lead with the predictable-failure-versus-exception distinction
and explain `catch` by comparison with `match`. Its position at the end of this group
is sound. The late pedagogy pass should still test moving it nearer JavaScript
interoperation, where `JsError` and the boundary representation gain more surrounding
context; whatever its final position, it must remain after `Result` and pattern
matching.

## Terminology and index check

- **Mutable variable** is the approachable chapter concept; **assignment** names the
  `:=` operation. “Monomorphic” and “immutable binding” correctly reuse earlier terms.
- **Range** names the first-class inclusive integer progression. Ascending and
  descending behavior is explained before implementation or emission.
- **Sequence** and **functional cursor** receive direct definitions. Laziness,
  immutability, and possible infinitude are properties rather than competing sequence
  categories.
- **Exception**, **Exn**, **implicit rethrow**, and **JsError** distinguish the open
  failure channel from `Result`'s closed data.
- Associated types deliberately receive no reader-facing definition or index entry in
  this group.
- Principal terms are represented in `INDEX-CANDIDATES.md`.

## Example continuity

The assignment examples preserve Chapter 1's rule that `let` names do not change
meaning and Chapter 9's rule that records update by producing new values. The snapshot
example preserves Chapter 3's ordinary lambda capture model by copying a current value
to `let` before crossing the boundary.

`sumTo` carries mutable state naturally into a range loop. Tuple and constructor loop
patterns reuse the exact irrefutability rule from Chapter 11. `Seq(Option(Int))` makes
the refutable `Some(value)` counterexample technically complete.

The sequence pipeline returns to pipes and subject-first companion functions. Its
`Seq.next` examples reuse `Option` and nested tuple patterns without changing their
meaning. Exceptions return to `Result` only through the explicit `Result.attempt`
bridge; no coercion or subtyping relationship is introduced.

## Technical surface check

- `var` placement, name-only binding, monomorphism, assignment typing, immutable
  products, lambda confinement, snapshotting, direct JS emission, and lack of `.d.ts`
  impact agree with the statements and mutability specification.
- `for` once-evaluation, `Unit` bodies, full irrefutable patterns, inclusive ranges,
  explicit descending ranges, empty reversed ranges, `while`, and native loop emission
  agree with the loop, pattern, and iterable specifications.
- `Seq` laziness, persistence, `Seq.next`, functional external iteration, demand-timed
  effects, conversion naming, and the `Iterable<a>` TypeScript face agree with the
  sequence and collection specifications.
- Exception declarations, concrete payloads, first-class construction, divergence of
  `throw`, full catch patterns, implicit rethrow, `JsError`, fresh nullary exceptions,
  branded `Error` emission, and branded TypeScript faces agree with the exception and
  pattern specifications.
- No example requires mutable capture, runtime iterable lookup, a mutable iterator,
  exception classes, or hidden TypeScript methods.

## Deferred to later reviews

- Collection-extension material must explain user-defined `Iterable`, its `Item`
  member, associated types, instance placement, and the `toSeq` delegation recipe.
- Persistent collections must demonstrate `toSeq`/`fromSeq` without turning the book
  into an API manual, and must add vector patterns in their owning context.
- JavaScript interoperation must complete the `JsValue` access story and verify inbound
  iterable adaptation while preserving persistent `Seq.next` positions.
- Modules must complete exception qualification, instance globality, and the absence
  of module-level mutable state.
- The late pedagogy pass must reconsider the final position of Exceptions, check the
  light `Seq` preview in Loops and Ranges, and retest all chapter numbering and
  transitions after any move.

## Review result

After the integrated corrections, no known technical contradiction remains in
Chapters 16–19 or between this group and Chapters 1–15. Mutable state leads naturally
to looping; loops lead naturally to lazy sequence values; exceptions remain a separate
open control-flow channel introduced only after closed error data and patterns are
understood. The advanced extension and boundary obligations are explicitly assigned
to later chapters rather than leaking into the ordinary reader path.
