# Group Review: Data Shapes and Patterns

**Chapters reviewed:** Records; Unions; Patterns.

**Status:** Reviewed as a consistent drafting group. This is not the late whole-book
pedagogy pass, and chapter numbers remain provisional.

## Coherence result

The group follows one strong progression:

1. records collect values that exist together, first by structure and then by nominal
   identity;
2. unions describe a value that has exactly one of several possible shapes; and
3. patterns take apart all the data shapes the reader has learned so far.

Combining structural and nominal records was the right choice. Their contrast is now
made in one place, with **record** introduced as the parent concept before the parallel
definitions of **structural record** and **nominal record**. The explicit crossings
into and out of nominal records then prepare constructor patterns without requiring a
second introduction to records.

## Integrated corrections

- Removed opacity from the records material. It depends on module visibility and
  belongs in the modules chapter, where opaque records and opaque unions can be taught
  together.
- Combined the former structural-record and nominal-record chapters into **Records**
  and repaired a remaining “next chapter” transition left by that merge.
- Simplified the union chapter title to **Unions** while retaining `Option` and `Result`
  as important applications rather than presenting the chapter as a library manual.
- Introduced **record**, **structural record**, and **nominal record** in parallel.
- Added the `()` pattern so every pattern form over data introduced by this point is
  represented.
- Made the foundational binder rule explicit: lowercase names bind, `_` ignores, and a
  name may not be bound twice within one whole pattern.
- Explicitly assigned vector, loop-binding, and `catch` patterns to the later chapters
  that teach their surrounding features.

## Pedagogical dependency check

Records depends naturally on tuples: the opening reservation grows from positional
data into named fields. Row polymorphism is named only after two concrete calls show
why a function can accept extra fields. The rare named row tail follows the common
`...` form and is clearly marked as something most readers will not write.

Unions depends on nominal declarations and function arity already being familiar.
It introduces only the small amount of pattern matching needed to inspect a union,
then promises the complete account immediately afterward. `Option` and `Result` make
closed alternatives useful without turning the chapter into a prelude reference.

The Patterns chapter arrives only after tuples, records, nominal records, and unions are
visible. Its examples can therefore explain nesting by following already understood
data shapes. Guards reuse Boolean conditions and comparison chains rather than adding
a second language for runtime tests.

The chapter deliberately postpones three integrations. Vector patterns need collection
syntax and representation; loop patterns need iteration; `catch` patterns need the
exception model. Deferring those examples prevents unfamiliar host features from
interrupting the core pattern explanation while preserving the rule that Hexagon has
one pattern language.

## Terminology and index check

- **Record** is the parent term; **structural** and **nominal** describe how record type
  identity is determined.
- **Row polymorphism** follows its observable behavior and is not required vocabulary
  for ordinary record use.
- **Union** remains the Hexagon term; “sum type” and “discriminated union” are supplied
  only as recognition aids.
- **Pattern**, **or-pattern**, **as-pattern**, **guard**, **exhaustiveness**, and
  **irrefutable pattern** each receive a direct definition near a motivating example.
- Principal definitions are represented in `INDEX-CANDIDATES.md`.

## Example continuity

The reservation example crosses the chapter boundary cleanly: a tuple becomes a record
when field names become useful, and record destructuring later becomes part of the
general pattern language. `Point` carries the nominal-record story from construction
and structural crossing into `Point({x, y})` pattern matching.

`DeliveryStatus` introduces constructors and the first exhaustive match, then returns
for or-patterns and as-patterns. `Option` and `Result` provide familiar nested patterns
without inventing throwaway union declarations. No returning example changes its type,
runtime representation, or earlier meaning.

## Technical surface check

- Structural field order, open inference, closed annotations, row tails, construction
  punning, and update restrictions agree with the products specification.
- Nominal construction, identity-preserving updates, explicit structural crossing, and
  ordinary-object JavaScript and TypeScript boundaries agree with the products and
  module specifications.
- Constructor arity, nullary values, recursive unions, `Option`, `Result`, tagged-object
  emission, and all-nullary string emission agree with the unions specification.
- Nested constructor/tuple/record patterns, literal restrictions, `()`, or/as binding
  rules, guards, irrefutability, exhaustiveness, reachability, and parameter-pattern
  parsing agree with the pattern-matching specification.
- The JavaScript representations shown in Records and Unions remain plain and readable;
  pattern matching adds tests and bindings rather than runtime pattern objects.

## Deferred to later reviews

- Opaque records and unions, including branded TypeScript boundary faces, belong to the
  modules chapter.
- Vector patterns, loop binding patterns, and exception `catch` patterns must be checked
  when their owning chapters are drafted.
- Derived equality and display behavior for records and unions belongs with constraints
  and deriving.
- The late pedagogy pass should reconsider whether the rare named row-tail annotation
  earns its space in the main narrative or should become a compact advanced aside.
- Final cross-references, chapter numbers, index locators, pacing, and the balance
  between structural records and nominal records remain whole-book concerns.

## Review result

After the integrated corrections, no known technical contradiction remains in Chapters
9–11 or between this group and Chapters 1–8. The sequence teaches compound shape,
alternative shape, and decomposition in the order a new reader needs them. Later
feature chapters still owe their pattern integrations, and the final pedagogy pass must
test the complete reading order from scratch.
