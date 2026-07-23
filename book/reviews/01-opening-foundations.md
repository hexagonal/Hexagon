# Group Review: Opening Foundations

**Chapters reviewed:** Expressions; Primitive Types;
Functions; Operators.

**Status:** Reviewed twice as a consistent drafting group. This is not the late
whole-book pedagogy pass, and chapter numbers remain provisional.

## Coherence result

The group has a stable conceptual progression:

1. expressions produce values and bindings introduce names;
2. primitive values give those expressions a concrete vocabulary;
3. functions organize transformations of those values; and
4. operators, conditionals, and pipes connect the values and functions.

The central ideas recur without changing meaning. `Unit` moves from sequencing to its
primitive representation and then to nullary/effectful functions. The final-expression
rule returns in multiline conditionals. Subject-first parameter order is introduced with
functions through `auditOrder(order) |> ignore`, then paid off fully by the pipe.
Native JavaScript representation remains consistent across all four chapters.

## Integrated corrections

- Replaced a misleading `price * tax` example with an additive order calculation. The
  original happened to typecheck while teaching a nonsensical everyday formula.
- Renamed `withHandling` to `withStandardDelivery` so the fixed argument agrees with
  `orderTotal`'s established `delivery` parameter.
- Changed the concatenation example from an untyped `orderNumber` to `orderLabel`,
  making it clear that `++` joins strings rather than displaying an integer.
- Made the TypeScript return face of `Unit` definitive: `void` in function return
  position, `undefined` elsewhere.

Later reader review and the second group pass also:

- replaced the abstract Unicode example with `"🙂 Hi!"`, `👍`, and `👍🏽`;
- moved specialist `BigInt` material after the common `Bool` and `String` types;
- rewrote incomplete calls around the concrete `withStandardDelivery` lambda;
- deferred the tuple/argument distinction until tuples are visible;
- introduced pipes by returning to `auditOrder(order) |> ignore`;
- reduced captured-value initialization to the reader-facing rule “captured values must
  be ready”;
- taught implication through the `winGame implies getPizza` promise;
- taught a pipe chain through `dishes |> rinse |> wash |> dry`;
- made the mutual-recursion example terminate for negative as well as positive `Int`;
- moved polymorphic-recursion rules to the future type-inference chapter; and
- removed the unnecessary currying comparison from the pipe chapter.

## Pedagogical dependency check

The group contains two intentional dependency loops that are currently manageable:

- Chapter 1 needs a small amount of function and type syntax before the functions and
  primitive chapters. It explains the annotations locally and uses only one simple
  function shape.
- The functions chapter needs arithmetic and `if` for useful recursion before the
  operators chapter. Those forms are familiar to the target reader and the recursive
  examples pin their types explicitly; the operators chapter then supplies the formal
  account.

These are lightweight previews rather than hidden teaching obligations. Reconsider
them during the late pedagogy pass, when the Introduction and final chapter order exist.

## Terminology check

- **Expression**, **binding**, **block**, **final expression**, and **Unit** are stable.
- **Parameter**, **argument**, **arity**, **lambda**, and **subject-first** are introduced
  before the pipe depends on them.
- **Capability** is used as an informal preview; **constraint** remains the later formal
  term.
- `let` consistently means an ordinary immutable/non-recursive binding; `fun`
  consistently marks recursion.

## Example continuity

The order examples now form one small thread:

- `orderTotal` introduces bindings, blocks, and the JS/TS boundary;
- `orderSummary` adds checked interpolation;
- `withStandardDelivery` demonstrates an explicit adapting lambda after a concrete
  incomplete-call explanation; and
- `applyDiscount` followed by `orderTotal` demonstrates first-argument piping.

The thread is useful but already frequent. The next drafting group should not force an
order example where another domain would teach the idea more naturally. A later return
should provide recognition or payoff, not merely reuse familiar nouns.

`"🙂 Hi!"` (followed by `👍`/`👍🏽`), `factorial`, and `isEven`/`isOdd` remain separate
canonical examples with no conflicting facts. The mutual-recursion pair steps toward
zero from either sign.

## Technical surface check

- All shown function arities and pipe rewrites agree.
- Numeric literal and primitive boundary claims agree.
- JavaScript emission consistently uses `const` arrows for `let` functions and function
  declarations for `fun`.
- `.d.ts` primitive faces agree across chapters.
- Integer `div`/`mod` and `quot`/`rem` terminology follows the final Euclidean decision.
- Comparison, logic, conditional, and precedence claims agree with the specification.
- The mutual-recursion example steps toward zero for both positive and negative `Int`
  inputs.

## Deferred to later reviews

- Whether the opening chapter should remain before primitives and functions.
- Whether the three-way comparison first belongs in the eventual Introduction.
- Whether the operator chapter should be split if its density becomes conspicuous
  beside later chapters.
- Final pacing, lively material, transitions, and the overall length of each chapter.

## Second-pass result

No known technical contradiction remains in the four chapters. Polymorphic recursion
is deliberately absent until type inference gives the reader the concepts needed to
understand it. The next multi-chapter review should treat this document as the baseline
rather than reconstructing the history from commits.
