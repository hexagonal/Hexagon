# Manuscript Continuity

This is the book's living continuity record. Consult it before planning or drafting a
chapter, update it when a chapter establishes something global, and use it during every
revision pass.

## Principal risk

The principal risk is **manuscript drift**: terminology, syntax, teaching order,
examples, inferred types, emitted JavaScript, and generated `.d.ts` output may each be
locally plausible while quietly contradicting another chapter or weakening the book's
overall explanation.

This is not deferred to a final copy-edit. The book should be written incrementally,
with frequent returns to its global commitments. Extra time spent checking continuity
is part of the work, not schedule overrun.

## Continuity practice

For each chapter:

1. read this record and the relevant earlier chapters before planning;
2. identify which established concepts the chapter uses, extends, or qualifies;
3. verify syntax, inferred types, JavaScript, and `.d.ts` examples against the
   specification and against earlier examples;
4. prefer deliberate callbacks to silently re-explaining an idea with different words;
5. record any new global terminology, convention, example, or promise here; and
6. propagate a changed decision through every affected chapter immediately.

After each small group of chapters, perform a continuity pass across the manuscript so
that contradictions are found while their context is still fresh.

Near the end of drafting, perform a separate **pedagogy pass** from the perspective of a
reader encountering Hexagon for the first time. Verify that every chapter depends only
on ideas already taught, and reorder dependent ideas toward the end where necessary.
Drafting order is not final reading order.

## Global commitments

- The specification is normative; the book is explanatory.
- For planning and drafting, assume the v1 specification is complete. If it changes,
  update affected book material at that time.
- Hexagon source, emitted JavaScript, and generated TypeScript declarations must tell
  the same story.
- Introduce a term once, use it consistently, and distinguish deliberate teaching
  simplifications from later qualifications.
- Examples must remain valid when reused or extended. A callback inherits the facts
  established by its earlier appearance.
- The book teaches the language and the ideas exposed by its standard library; it is
  not a library API catalogue.

## Recurring examples and lively material

Record recurring examples, motifs, voices, and other lively material here when they are
designed. Repetition should create recognition and payoff—like a running joke or a
returning character—not accidental duplication. Each callback must remain consistent
with the technical and narrative facts established earlier.

No recurring lively material has been fixed yet.

## Pedagogical dependencies

Record what each drafted chapter assumes and what it prepares. This is evidence for the
late pedagogy pass, not a commitment to the current order.

### Values, Bindings, and Expressions

- Assumes only general programming experience.
- Lightly previews function headers, `Int`, arithmetic, `Order`, exports, and type
  annotations as scaffolding; these must remain locally understandable before their
  dedicated chapters.
- Establishes bindings, expressions, blocks, final-expression results, `Unit`, and
  deliberate discarding for later chapters.
- Its JavaScript and `.d.ts` comparison assumes basic familiarity with those languages,
  matching the book's intended reader.

### Primitive Values and Strings

- Assumes the distinction between expressions and bindings and the established role of
  `Unit`.
- Lightly previews conditions, comparisons, numeric constraints, interpolation through
  `Show`, conversion, string indexing, and companion-module operations.
- Establishes the six primitive types, their literal distinctions, and their native
  JavaScript/TypeScript faces for use throughout the book.
- Prepares operator semantics, type inference, constraints, FFI, and collections.

### Functions and Application

- Assumes expressions, bindings, blocks, primitive values, `Unit`, and the light
  conditional/arithmetic syntax already previewed.
- Lightly previews constraints, pipes, method syntax, and polymorphic
  generalization.
- Establishes lambdas, n-ary arity, calls, annotations, subject-first order, the
  `let`/`fun` distinction, and recursion.
- Prepares type inference, operators and pipes, patterns, constraints, and modules.

### Operators and Control Expressions

- Assumes primitive numeric distinctions, `Bool`, `String`, `Unit`, functions, blocks,
  n-ary calls, and subject-first parameter order.
- Lightly previews capability constraints, exceptions, ranges, indexing, assignment,
  and structured order data.
- Establishes the fixed operator vocabulary, comparison chains, word-based logic,
  expression-valued `if`, and first-argument pipe behavior.
- Completes the first four-chapter group and prepares type inference, constraints,
  loops, collections, and mutation.

## Established chapter material

### Values, Bindings, and Expressions

- Core formulation: **expressions produce values; bindings introduce names**.
- Core block formulation: **the final expression is the value of the block**.
- `Unit` explains why effectful expressions may be sequenced before a block's result.
- `ignore(auditOrder(order))` is the first intentional-discard example.
- `orderTotal(subtotal, delivery)` is the first drafted explicit
  Hexagon/JavaScript/`.d.ts` comparison. It takes and returns `Int`; JavaScript and
  TypeScript represent these as `number`. Reconsider its “first comparison” framing
  after the Introduction is written.
- `prepareOrder(order)` prints before returning the unchanged order. If reused, `Order`,
  `auditOrder`, and `AuditReport` must retain the facts established in the chapter.
- The full head-binder/sequential-binder distinction is deliberately previewed but
  deferred until functions and patterns provide concrete examples.

### Primitive Values and Strings

- Primitive boundary table: `Int`/`Float` → `number`, `BigInt` → `bigint`, `Bool` →
  `boolean`, `String` → `string`, and `Unit` → `undefined` (`void` in TS return
  position).
- Bare integer literals normally default to `Int`; decimal-point and exponent literals
  are `Float`; the `n` suffix selects `BigInt`.
- `Int` is exact only in JavaScript's safe-integer range and direct arithmetic may
  silently round beyond it.
- `Bool` has no truthiness conversion.
- `orderSummary` extends `orderTotal` and is the first interpolation example:
  `"Order total: ${total}"`.
- Interpolation is display through `Show`, not universal coercion. Full constraint
  teaching remains deferred.
- `"🙂 Hi!"` is the canonical codepoint example: five Hexagon codepoints, six
  JavaScript UTF-16 code units. `👍` is one codepoint; `👍🏽` is two codepoints but one
  perceived grapheme. Hexagon has no `Char`; one codepoint is represented by `String`.

### Functions and Application

- Core formulation: **ordinary functions use `let`; recursion uses `fun`**.
- Header definitions and explicitly bound lambdas are equivalent.
- Functions are genuinely n-ary; calls require parentheses and supply the declared
  number of arguments. Incomplete calls are errors.
- `withStandardDelivery = subtotal => orderTotal(subtotal, 5)` is the first adapting
  lambda and continues the order example. Explain it concretely as
  `withStandardDelivery(80)` → `orderTotal(80, 5)` before naming currying or partial
  application.
- `auditOrder(order) |> ignore` is the first pipe spelling and deliberately returns to
  Chapter 1's canonical discard example before multi-argument pipe insertion is shown.
- `factorial` is the canonical direct-recursion example. `isEven`/`isOdd` are the
  canonical mutual-recursion pair.
- Subject-first parameter order is introduced here and should recur in pipes,
  method-style calls, constraints, and collection examples.
- JS emission convention established: `let` function → `const` arrow; `fun` → hoisted
  function declaration.
- Generalization, the value restriction, lambda-parameter monomorphism, and constrained
  functions are previewed but remain owned by later chapters.

### Operators and Control Expressions

- Fixed vocabulary: symbols for algebra/comparison, words for logic; no user-defined
  operators.
- `/` is fractional. Integer `div`/`mod` are Euclidean; `quot`/`rem` are truncated,
  with `rem` matching JavaScript `%`.
- `0 <= discount <= 100` is the canonical comparison chain. Chain operands evaluate
  once; directions cannot mix; `!=` does not chain.
- `and`, `or`, and `implies` short-circuit; `iff` evaluates both operands.
- Inline `if` requires `else`; else-less layout `if` has type `Unit`.
- Canonical pipe continuation:
  `subtotal |> applyDiscount(discount) |> orderTotal(delivery)`. Pipe means
  first-argument insertion and relies on the subject-first convention.
- `-2 ** 2` means `-(2 ** 2)` and evaluates to `-4`.
- The chapter closes the first drafting group. Its review is recorded in
  `reviews/01-opening-foundations.md`.

## Review history

### Opening Foundations

- Chapters 1–4 reviewed together after their initial drafts.
- Result: coherent enough to continue; four small corrections integrated.
- Known pedagogy loops and later reconsiderations are recorded in
  `reviews/01-opening-foundations.md`.
