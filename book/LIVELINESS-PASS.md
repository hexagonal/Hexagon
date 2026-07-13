# Liveliness Pass

This is the working brief for a dedicated revision after the complete first draft.
The first draft should concentrate on technical accuracy, teaching order, and
manuscript continuity. It does not need to solve liveliness chapter by chapter.

## Purpose

Programming textbooks have a tendency to become dull even when their explanations are
correct. A sustained book needs moments of surprise, character, recognition, and
payoff alongside its technical progression.

The liveliness pass will revisit examples, transitions, callbacks, and occasional
asides from the perspective of an interested reader whose attention must be earned
over hundreds of pages. It is a separate pass rather than an invitation to improvise
disconnected jokes during the first draft.

## Example direction

Move away from accountancy-shaped examples as the manuscript's default. Orders,
invoices, accounts, and similarly realistic business records are serviceable but
quickly become grey when repeated.

Prefer examples that are a little sillier while remaining technically transparent.
The reader should still understand the data and intended result immediately. A lively
example succeeds when it makes the language feature more memorable; it fails when the
reader has to decode the joke before decoding the code.

Not every example needs to belong to the recurring story. Some concepts will remain
clearest with strings, coordinates, collections, or a small familiar process. The aim
is a livelier manuscript, not thematic uniformity.

## Candidate recurring story: Lancelot's quest

An Arthurian story is the leading candidate for the book's recurring comic world:

- Lancelot is a Knight of the Round Table.
- He must undertake a quest to defeat a dragon.
- Lancelot is afraid of the unknown. He has only read about dragons in *The Dragon
  Book*—an unobtrusive allusion to the classic compiler textbook.
- Merlin helps him and encourages him to learn the magical language Hexagon.
- Medieval, knightly, magical, and quest-related examples recur as the language grows.

This world has a natural connection to Hexagon's vocabulary. In particular,
**constraint** and **honor** already sound like obligations accepted by a knight. The
connection should be enjoyed without pretending that the language feature derives its
technical meaning from Arthurian legend.

Possible material includes knights honoring constraints, quests represented by
unions, inventories and parties represented by collections, spells composed through
pipes, uncertain dangers represented by `Option` or `Result`, and dragons encountered
through pattern matching. These are possibilities for the later pass, not assignments
that should distort the first draft's teaching order.

## Running-story principles

- Establish the characters and facts once, then preserve narrative continuity just as
  strictly as technical continuity.
- Return to earlier material for recognition and payoff. A running story works for the
  same reason as a running joke: the return itself creates pleasure.
- Let examples advance or revisit the quest rather than repeatedly resetting to an
  unrelated medieval noun list.
- Keep each example locally understandable. A reader who has forgotten the story must
  still be able to learn the feature.
- Prefer gentle wit to constant punchlines. The book should feel companionable, not as
  though it is performing at the reader.
- Keep allusions optional. Understanding *The Dragon Book* reference must never be
  required to understand dragons, compilers, or Hexagon.
- Do not force the story onto serious material where a direct example is clearer.
- Do not allow narrative callbacks to change established types, values, chronology,
  character facts, or technical behavior.

## Pass procedure

After the first draft exists:

1. read the manuscript as a continuous book and mark stretches that become tonally
   flat or accumulate interchangeable business examples;
2. design the small story spine before rewriting individual examples;
3. decide which existing examples should remain, which can enter the Arthurian world,
   and which need a different lively premise;
4. introduce returning characters and motifs before relying on them;
5. build callbacks deliberately, including a few delayed payoffs;
6. recheck every changed example's syntax, inferred types, emitted JavaScript, `.d.ts`
   output, and pedagogical dependencies;
7. read for tone, removing jokes that are strained, too frequent, distracting, or
   dependent on specialist knowledge; and
8. perform a final continuity pass across both the technical manuscript and the story.

The liveliness pass must cooperate with the late pedagogy pass. If a rewritten example
depends on a feature the reader has not yet learned, simplify it or move it; charm does
not excuse a dependency error.

## Existing seeds

The manuscript already contains small pieces of lively material that may survive or
be adapted:

- `winGame implies getPizza`, explained as a promise;
- `dishes |> rinse |> wash |> dry`, a familiar left-to-right process;
- `let greeting = "🙂 Hi!"`, which makes codepoint behavior visible;
- `3.14` as the canonical `Float` literal and a mild allusion to pi; and
- the three equivalent `Option.getOrElse` spellings, whose clarity gives the language
  itself some character.

These need not all enter Lancelot's story. The later pass should preserve variety as
well as continuity.
