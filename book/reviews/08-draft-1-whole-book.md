# Whole-Book Review: Draft 1

**Material reviewed:** all 25 feature chapters, their chapter briefs, the seven group
reviews, the continuity record, index ledger, writing guide, outline, feature
catalogue, and liveliness brief.

**Draft size:** approximately 34,000 words across the feature chapters, excluding
planning and review material.

**Status:** The feature-body first draft is complete and coherent. It is not yet a
publication draft: front matter, the held Getting Started chapter, the pedagogy pass,
the liveliness pass, executable output verification, and copy-editing remain.

## Overall result

Draft 1 succeeds as a concise language book rather than an expanded specification or
library manual. Every planned language feature receives a real explanation, an
ordinary use, and enough interaction with earlier material to place it within one
language. The manuscript has a recognizable argument:

> Hexagon organizes programs around immutable values and ordinary functions, adds
> explicit and coherent forms of abstraction and effects, and crosses into JavaScript
> without hiding the resulting runtime representation or public TypeScript surface.

That argument is present from the first `let` binding to the final constraint
dictionary. It does not need to be invented during revision; later passes need to make
it more visible and enjoyable.

No wholesale feature-chapter reorder is recommended. The current sequence has survived
both local group reviews and a continuous read.

## The structural spine

The chapters fall naturally into six parts:

1. Values and Functions — Chapters 1–6;
2. Data — Chapters 7–11;
3. Capabilities and Modules — Chapters 12–15;
4. State and Flow — Chapters 16–19;
5. Collections and Implied Types — Chapters 20–21; and
6. JavaScript and TypeScript — Chapters 22–25.

These divisions are now recorded in `OUTLINE.md`. They give the reader large-scale
progress markers without changing the short noun-based chapter titles.

Several order decisions deserve to remain:

- Layout follows the opening expression language. Earlier chapters teach indentation
  through simple examples; Chapter 5 then names the complete rule before declarations
  become more elaborate.
- Modules remains after Constraints and Derivation. Its full explanation needs
  instances, home modules, opacity, and generated behavior; moving it much earlier
  would either split the chapter or force those ideas to be previewed heavily.
- Mutable Variables precedes Loops, so loop accumulation is immediately useful.
- Sequences precedes Collections, establishing the lazy conversion currency before
  `Vector`, `Map`, and `Set` use it.
- Implied Types immediately follows the `Iterable<Bag(a)>` example that motivates
  them.
- Constraints in JavaScript remains last. It is the most specialized combination of
  the constraint, module, JavaScript-output, and TypeScript-output stories.

## Front matter and first contact

The current files begin with Expressions, which deliberately borrows function, type,
export, and module vocabulary. The chapter explains enough of the function and type
syntax to remain readable, but it should not also be responsible for installation,
running a program, root-module selection, and project orientation.

The held solution has two parts:

- a short Introduction containing a liveliness/story opening followed by a compact
  introduction to Hexagon as a language; and
- a separate **Getting Started** chapter, probably the new Chapter 1, containing the
  first runnable program, minimal project/tooling instructions, root-module execution,
  and the first clearly labelled Hexagon/JavaScript/TypeScript comparison.

The existing files have not been renumbered. That revision should happen deliberately
after the Getting Started content and toolchain facts are known.

A short unnumbered conclusion would also improve closure. It need not teach another
feature; it can return to the first program, show how the language's pieces now fit,
and direct the reader toward reference documentation and the specification.

## Pedagogy result

The manuscript generally introduces behavior before terminology:

- reusable inferred functions precede **let-polymorphism** and the value restriction;
- flexible record access precedes **row polymorphism**;
- concrete constraint use precedes dictionaries;
- ordinary collection iteration precedes **implied types**; and
- a plain JavaScript operation object precedes the complete constraint-dictionary
  boundary API.

This is one of Draft 1's strongest qualities. Technical names usually give the reader
a handle for something already visible rather than creating an abstraction in search
of an example.

The most demanding chapter is JavaScript Input. Its order is defensible and its rules
are accurate, but it combines extern syntax, trusted numeric boundaries, nullability,
borrowed arrays, adapted sequences, receivers, classes, callbacks, collections, and
foreign failure. During the late pedagogy pass, give this chapter special attention:
consider a short opening roadmap, stronger internal transitions, or a split only if a
continuous novice read shows that headings are not enough.

Implied Types is intentionally advanced. Its position, concrete `Bag(a)` hand-off,
and explicit restriction to owner contexts prevent it from burdening ordinary generic
programming. It may benefit from an “advanced feature” signpost in the final contents,
but it does not need to move.

## Continuity result

The book's repeated global promises remain consistent:

- `let` is immutable; `var` is local, monomorphic, and cannot cross a lambda boundary;
- functions are n-ary, subject-first by convention, and never implicitly curried;
- tuples, records, and unions retain one stable relationship between source shape,
  JavaScript representation, and TypeScript face;
- nominal identity is explicit inside Hexagon while runtime values remain plain;
- constraints are coherent, concrete operations stay direct, and dictionaries are
  reserved for genuinely generic code;
- persistent collections remain distinct from native mutable JavaScript containers;
- evaluation is left-to-right and source expressions are evaluated once; and
- emitted JavaScript and generated `.d.ts` describe related but different contracts:
  runtime behavior and supported public type surface.

The final four chapters successfully gather these promises rather than contradicting
the feature chapters that introduced them.

## Integrated corrections

The whole-book read found and corrected several forms of manuscript drift:

- Functions no longer says inference is the immediate next step when Operators and
  Layout intervene.
- Operators no longer tells the reader to pause for an invisible drafting-group
  review; it now leads directly into Layout.
- Chapter-number cross-references were replaced with chapter titles so the held
  Getting Started insertion cannot silently make them false.
- Constraint dictionaries are consistently introduced as small operation objects,
  matching their concrete JavaScript explanation in the final chapter.
- Dot Calls no longer uses type-theory-flavored **evidence** language for an
  independently known receiver type.
- Standalone library type displays for `Seq.next` and `Result.attempt` are marked as
  type text rather than copyable Hexagon declarations.
- Several reader-facing paragraphs that discussed the book's drafting design were
  rewritten as direct explanations of the language.
- Missing index candidates were added for binding, constructors, currying, generics,
  `honor`, `ignore`, partial application, and root modules.
- The continuity dependency ledger now follows the actual capability/module chapter
  order and includes the previously missing Constraints, Derivation, and Dot Calls
  entries.
- README, feature-catalogue, and outline status language now reflects an existing
  Draft 1 rather than a book that has not begun.

## Liveliness result

The manuscript is intentionally liveliness-light, and the continuous read confirms
the need for the planned pass. Orders, deliveries, reservations, guests, coordinates,
and scores are individually clear but become tonally interchangeable when accumulated.
The problem is most visible in the opening third, precisely where the book most needs
to earn attention.

The Arthurian direction is well suited to the technical sequence. It can supply values
and functions early, records and unions for knights and quests, `honor` constraints,
pattern-matched dangers, persistent supplies, sequences of encounters, and a later
foreign boundary. The story should create callbacks rather than replace every example.

The Introduction will contain the story's first small movement. The later liveliness
pass should then decide which existing examples enter that world and preserve the
technical types, chronology, and outputs of every callback.

## Length and density

At roughly 34,000 prose-and-code words, the feature body is compact for a 25-chapter
language book. That is not a defect. Code blocks, tables, front matter, Getting
Started, transitions, liveliness additions, and final apparatus will increase the page
count substantially without requiring library-manual padding.

The revision goal should be **more connective tissue where a new reader needs it**, not
uniform expansion. Layout and Tuples are short because their ideas are bounded.
JavaScript Input and the opening chapters are longer because they carry more teaching
work. Preserve that variation.

## Work remaining after Draft 1

1. Write the short two-movement Introduction.
2. Decide and write Getting Started, then perform the resulting renumbering once.
3. Perform the dedicated pedagogy pass from the position of a JavaScript/TypeScript
   programmer new to Hexagon.
4. Design the recurring story spine and perform the liveliness pass.
5. Run every source/output/declaration example through compiler-backed golden tests
   when the relevant tooling is available.
6. Choose and enforce one house spelling style during copy-editing; Draft 1 currently
   mixes forms such as *behavior* with *catalogue* and *dependants*.
7. Complete the glossary/index from `INDEX-CANDIDATES.md`, add final cross-references,
   and decide whether to include exercises or a small continuing project.
8. Write a short conclusion and final reader directions.

## Final verdict

Draft 1 has achieved the difficult part: it explains Hexagon as one language rather
than as 25 unrelated features. Its principal risk—manuscript drift—has been controlled
well enough that the remaining work is revision, orientation, verification, and voice,
not reconstruction.

The next pass should not reopen every language decision. It should help a new reader
enter the manuscript, move through it without premature dependencies, remember it, and
enjoy returning to ideas that have already been established.
