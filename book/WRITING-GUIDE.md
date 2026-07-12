# Writing Guide

## The promise

*The Hexagon Programming Language* is a thorough introduction and working guide to Hexagon. It covers every language feature, but it is not a second specification.

**Thorough, not comprehensive** means:

- no feature is silently omitted;
- important ideas receive enough explanation for a reader to use them confidently;
- representative interactions and common mistakes are taught;
- obscure edge cases, exhaustive grammar, compiler obligations, and design-history bookkeeping remain in `spec/` unless they materially help the reader.

The reader should finish the book understanding the language as a coherent whole, without having been made to read every rule that an implementer must know.

## Coherence before accumulation

The book's principal risk is **manuscript drift**: terminology, syntax, teaching order,
examples, inferred types, emitted JavaScript, and generated `.d.ts` output may each look
reasonable in isolation while quietly contradicting another chapter.

Coherence is therefore an initial design constraint and a recurring writing activity,
not a final editing pass. Draft the book in small increments, repeatedly return to its
global concepts, and allow explicit time for cross-chapter checks. When a chapter
establishes or changes a global fact, carry that fact through the manuscript while the
context is fresh.

The living [continuity record](CONTINUITY.md) defines the practice. Consult it before
each chapter, update it when the book establishes reusable terminology, examples, or
promises, and perform a broader continuity pass after each small group of chapters.

## The late pedagogy pass

After the body chapters exist, read the manuscript again from the position of a reader
who knows JavaScript or TypeScript but does not yet know Hexagon or the functional ideas
being taught. This **pedagogy pass** tests the dependency order of the book rather than
the correctness of individual chapters.

For every section, ask:

- Has every idea needed to understand this section already been taught?
- Is a term being used before the reader has been given a useful meaning for it?
- Does an example rely on syntax, inference, runtime behavior, or library knowledge that
  has only been explained later?
- Is a forward preview light enough to understand locally, or is it secretly carrying
  the teaching burden of a later chapter?
- Would moving this material later reduce qualification and cognitive load?

Material that depends on several earlier ideas should normally move later. Foundational
material should move earlier even if it was drafted later. Drafting order is not book
order, and chapter numbers remain provisional until this pass is complete.

Track obvious dependencies while drafting, but reserve time for the late whole-book
simulation: only then can we experience the accumulated assumptions in approximately
the order a new reader will encounter them. Reordering may require new transitions,
small recap sections, or replacing examples that depend on too much unexplained
machinery.

## Language guide, not library manual

The book teaches the standard library when it illuminates the language or enables a
realistic example. It does not catalogue APIs.

Collections, in particular, should teach persistence, iteration, access conventions,
constraints, and the relationship between `Vector`, `Map`, `Set`, and `Seq` through a
small number of representative programs. Exhaustive operation lists, constructor
variants, complexity tables, conversions, and per-function edge cases belong in API
documentation or a future library manual.

The same boundary applies elsewhere in the standard library: explain the organizing
ideas, teach the operations readers need for examples, and point them to reference
material for inventory. Completeness for this book means covering every **language
feature**, not reproducing every library member.

## The teaching pattern

Every feature should answer three questions:

1. **What is it?** Explain the feature in plain language.
2. **What is it for?** Show the problem it solves or the kind of program it makes clearer.
3. **What does it look like in use?** Give a complete, believable example rather than syntax in isolation.

Where it adds useful understanding, follow with the three-way view:

1. **Hexagon source**
2. **Emitted JavaScript**
3. **Generated TypeScript declaration**

This view demonstrates Hexagon's readable-JavaScript and honest-interop promises. It is not a ritual. Omit a leg when it would be obvious, redundant, or distracting—for example, when a feature has no public `.d.ts` consequence or the emitted JavaScript adds no insight.

Label the book's first three-way comparison clearly so the reader learns the convention. After that, prefer nearby prose, syntax highlighting, layout, or compact tabs/figures to repeated **Hexagon source**, **JavaScript output**, and **TypeScript declaration** headings. Restore an explicit label only when adjacent representations could genuinely be confused. Do not insert labels as comments inside code: examples should remain clean, valid, and ready to copy.

## Examples

Examples should be small enough to understand immediately but substantial enough to reveal purpose. Prefer names and situations from ordinary programs over `foo`, `bar`, and unexplained arithmetic.

An example should normally progress in this order:

1. establish the reader's need;
2. show the Hexagon code;
3. explain the important line or inference;
4. show JavaScript and `.d.ts` faces where useful; and
5. mention the most likely mistake or surprise.

Do not bury a feature's first useful example beneath qualifications. Teach the ordinary case first, then sharpen the model.

## Voice

The prose should be textbook-like in structure and reliability, but lively in voice.

- Be precise without sounding legalistic.
- Prefer direct explanations to academic terminology where both are accurate.
- Use technical terms when they give the reader a useful handle; explain them on first use.
- Let the language's character show: clarity, subject-first functions, pipes, readable output, and honest JavaScript interoperation are recurring themes rather than marketing slogans.
- Occasional wit and opinion are welcome when they illuminate the design.
- Do not make the reader feel examined. The book is a capable guide walking beside them.

The target is neither a chatty tutorial nor a research paper. It is a book a thoughtful programmer can learn from, return to, and enjoy reading.

## Relationship to the specification

The specification is normative; the book is explanatory.

When they differ, the specification wins and the book must be corrected. The book may simplify presentation, reorder concepts for teaching, and leave out implementer-only detail, but it must never teach a false rule.

The book should link to specification material sparingly. A reader should not need to leave a chapter to understand its main lesson. References are most useful for deliberately omitted edge cases or for readers who want the exact normative rule.

## Chapter standard

A finished chapter should:

- state what the reader will learn and why it matters;
- build from an ordinary motivating example;
- cover every feature assigned to the chapter;
- include Hexagon/JavaScript/`.d.ts` views where informative;
- explain important inference and runtime representation without drowning in compiler internals;
- identify common errors or misleading intuitions;
- connect the feature to concepts already taught; and
- record the concepts it assumes so the late pedagogy pass can verify its position;
- agree with the terminology, syntax, examples, inferred types, JavaScript, and `.d.ts`
  already established elsewhere in the manuscript;
- update the continuity record when it establishes something later chapters should
  reuse; and
- end with the reader able to write something useful.
