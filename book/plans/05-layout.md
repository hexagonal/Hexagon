# Chapter Brief: Layout

## Purpose

Turn the indentation conventions already used throughout the book into an explicit,
reliable source-reading model. Teach only programmer-visible layout behavior, not the
compiler's virtual-token algorithm.

## Reader outcome

The reader can recognize block boundaries, choose same-line or indented bodies, use
semicolons correctly, avoid JavaScript brace-block habits, and write line or nested
block comments without disturbing layout.

## Governing specification

- `spec/lexer-layout.md`
- `spec/comments.md`
- `spec/decisions-batch-2026-07.md` §4 for leading tabs

## Technical skeleton

1. Return to the final-expression block model.
2. Indentation opens and closes blocks.
3. Same-line bodies are single expressions.
4. Braces always mean records.
5. Semicolons put same-level items on one line; they do not terminate statements or
   open blocks.
6. Line and nested block comments.
7. Comment-only lines do not affect layout.
8. Working summary.

## Examples to preserve

- `shippingLabel` returns as the nested-layout example.
- `dishes |> rinse |> wash |> dry` appears in a nested function body as a continuity
  callback, not as a new pipe lesson.
- A nested `/* outer /* inner */ outer */` comment is the memorable difference from JS.

## Audit notes

- Tabs in leading whitespace are a hard error.
- `;` is a separator, never a terminator; no leading, trailing, or doubled form.
- `;` never opens a lambda body.
- `{}` is the empty record, never an empty block.
- `///` and `/** */` are reserved but currently behave as ordinary comments.
