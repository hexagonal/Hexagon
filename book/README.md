# The Hexagon Programming Language

This folder contains the reader-facing Hexagon book. Its first feature-body draft
contains 25 chapters; front matter and the planned whole-book revision passes remain.
The normative language specification remains in `spec/`.

The draft title page is [`FRONTMATTER.md`](FRONTMATTER.md).
The reader-facing chapter list is [`CONTENTS.md`](CONTENTS.md).
The generated single-file review copy is `DRAFT-1.md`. Rebuild it after chapter edits
with `./build-draft.sh`; generated Markdown and PDF drafts are intentionally ignored,
and the individual chapter files remain the manuscript source of truth.

See the [writing guide](WRITING-GUIDE.md) for the book's coverage, teaching pattern, and voice.

The [continuity record](CONTINUITY.md) captures the manuscript's principal risk and
the global concepts that every chapter must preserve.

The planned post-draft [liveliness pass](LIVELINESS-PASS.md) records the recurring-story
direction and the intention to replace tonally flat examples without distracting the
first draft from correctness and teaching order.

The current book structure lives in the [outline](OUTLINE.md).

The [feature catalogue](FEATURES.md) records the reader-facing language features
covered by the draft.

Draft chapters live in [`chapters/`](chapters/). Their working briefs and technical
skeletons live in [`plans/`](plans/).

Completed multi-chapter consistency passes are recorded in [`reviews/`](reviews/).
The first complete feature-body assessment is
[`reviews/08-draft-1-whole-book.md`](reviews/08-draft-1-whole-book.md).
