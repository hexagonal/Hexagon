# Hexagon Spec: Lexer & Layout

**Status:** Decided (July 2026); compiler pass implemented. This document owns layout, blocks, `;`, and
brace disambiguation. The companion [Physical Lexer](lexer.md) specification owns
the complete physical token and keyword inventory, source coordinates, literals,
whitespace, comments-as-trivia, and lexical diagnostics.
**Scope:** blocks as pure layout, virtual delimiters, the explicit `;` separator, braces-are-records disambiguation, and the diagnostics these require.
**Companions:** Products spec (braces = records), Functions spec (block bodies of lambdas).

---

## 1. Blocks are pure layout; virtual delimiters are unspellable

Hexagon's layout pass inserts virtual tokens — internally **VOPEN**, **VSEP**, **VCLOSE** — to delimit and sequence blocks. Unlike Haskell's layout algorithm, these tokens **have no written form**: there is no explicit block syntax at all. This is the deliberate subtraction from the Haskell design: Haskell lets `{`/`;`/`}` be written explicitly, forcing braces to do double duty (blocks *and* records); Hexagon gives braces to records unconditionally (Products spec §3.1) by making block delimiters unspellable.

Consequences:

- **Indentation is the only block form.** The body of a lambda, an `if`/`then`/`else` branch, or any construct taking a block is either a single expression on the same line, or an indented block on following lines. A block's value is its final expression. Canonical Hexagon style uses four spaces for each indentation level; the layout grammar accepts any consistent deeper column.
- **`{` in source always begins a record** (type or literal), in every position. The parser has one rule, no context-dependence.
- **`{}` is the empty record**, never an empty block.

## 2. Layout algorithm (shape, for the implementer)

The pass runs between the physical lexer and the parser. The module itself is an
implicit block: emit VOPEN before its first token (or at EOF for an empty module),
and VCLOSE immediately before EOF. Nested blocks use the same mechanics:

- A construct expecting a block whose content starts on a **new line** at column C > enclosing indentation: emit VOPEN, record C on the indentation stack.
- Each subsequent line beginning exactly at C: emit VSEP before its first token.
- A line beginning at column < C: emit VCLOSE (popping repeatedly for multiple dedents), then resume comparison against the revealed enclosing context.
- Same-line (single-expression) bodies involve no virtual tokens.
- At an open block's indentation, a new logical item receives VSEP. Deeper
  indentation is a continuation of the current logical item by default; it does
  **not** open a block merely because it is deeper. This is what keeps a
  multi-line declaration, operator expression, or argument list together.
- `else` and `catch` at the enclosing indentation continue the preceding
  `if`/`try` item: any nested body is closed before the clause, but no VSEP is
  inserted between the body and its clause.
- **Interaction with the physical lexer:** string-interpolation holes do not participate in layout (Physical Lexer §6.1; Primitive Types §5.2). Columns are UTF-16 code-unit columns supplied by physical token spans; the layout pass consumes them as-is.
- The physical lexer rejects tabs in leading whitespace (Physical Lexer §2.2;
  Decisions Batch 2026-07 §4), so layout never expands tabs.

### 2.1 Complete block-head inventory

Because deeper indentation means continuation unless a block is expected, the
layout pass recognizes this closed set of block heads. `export` may prefix any
declaration head in the table without changing it.

| Block head at the end of a logical item | Opens on a following indented line |
|---|---|
| Lambda or match-arm `=>` with no same-line body | Body block |
| Layout `if` (no `then` after that `if`) | Consequence block |
| `for` or `while` head | Loop body |
| `match` head | Arm block |
| Bare `try` | Try body |
| `else` or `catch` with no same-line body | Clause body / arm block |
| `constraint ... =` or `honor ... =` | Member block |
| Function-header definition ending in `=` (`let f(...) =`, `fun f(...) =`, or a member header) | Function body block |

An ordinary binding RHS (`let x =`), and `record`, `union`, or `type` after
`=`, are continuations rather than blocks. In particular, indented union
alternatives receive no VOPEN. `finally` is reserved but is not a v1 block head.

### 2.2 Physical delimiters

Ordinary newlines inside `()`, `[]`, and `{}` are continuation whitespace and
do not produce virtual tokens. A genuine block head may still open a nested
layout block inside a delimiter—for example, a multiline lambda supplied as a
call argument. While that nested block is open, its own newlines and semicolons
use the ordinary block rules.

## 3. The explicit `;`

`;` is a **real token**, grammatically interchangeable with VSEP: a block's items are separated by *either* a layout-inserted VSEP *or* an explicit `;`. This permits multiple statements on one line:

```
let x = 1; let y = 2
print(x)
```

All three items are siblings in one block — two contributed by the `;` line, one by layout.

**The governing principle (one sentence, determines every edge case):**

> `;` may appear exactly where a newline-at-current-block-indentation could appear, and means exactly that.

### 3.1 `;` never opens a block

Only indentation opens blocks. Therefore in

```
let f = x => print(x); print("done")
```

the lambda's one-line body is the single expression `print(x)`; the `;` separates statements of the **enclosing** block ("bind `f`, then print done"). This matches what the equivalent two-line layout would mean — `;` is a compressed newline, nothing more. It is also a foreseeable JS-developer trip hazard; see §5 for the required diagnostic.

### 3.2 Hygiene rules (statement on both sides)

Analogous to the numeric `_` rule (digit on both sides — Primitive Types §8):

- **No leading `;`, no trailing `;`, no `;;`**, no empty statements. Trailing `;` gets the targeted message in §5, not a generic parse error. (Hexagon's `;` is a *separator*, not a *terminator*; the spec picks separator and says so loudly once.)
- **`;` is illegal inside brackets** — record literals, tuple literals, argument lists, type-parameter lists all use `,`. A `;` there → "did you mean `,`?". This keeps the token's meaning unique: `;` is exclusively block-level sequencing. Layout diagnoses the structurally delimited `()`/`[]`/`{}` cases. Because `<` and `>` are also comparison tokens, the parser diagnoses the type-parameter case with the same required message once it knows that context.
- **The top level of a module is a block**; `;` works there under the same rules. No special case.

### 3.3 Emission

None. Block structure is explicit in the AST before codegen; emitted JS uses ordinary JS semicolons per its own formatter, with no relationship to whether the source used `;` or newlines.

## 4. Brace disambiguation: there is none (by design)

Because block delimiters are unspellable, the parser needs **no** brace disambiguation logic. Every `{` is a record. The cost is paid instead in diagnostics for JS muscle memory (§5), which is the right place to pay it: one good error message versus permanent grammar ambiguity.

## 5. Required diagnostics

These are binding on the implementation, same status as the Functions spec's diagnostics table:

| Situation | Message (shape) |
|---|---|
| `x => { print(x) }` — brace-block habit; body parses as a record literal and fails (entries aren't `field: value`) | "Braces are record literals in Hexagon, not blocks. Write the block body on an indented line:" + a two-line fixit. (Mirror image of JS's own `=> ({})` wart; one good encounter defuses it.) |
| Trailing `;` at end of line/statement | "`;` separates statements; Hexagon lines don't end with one." |
| `;;` / leading `;` / empty statement | same family: "`;` must have a statement on both sides." |
| `;` inside `()`/`{}`/`<>` argument, tuple, record, or type-parameter context | "did you mean `,`? `;` only separates statements." |
| A `;`-sequence where a multi-statement lambda body was plausibly intended (lambda immediately preceding the `;` on the line) | append hint: "to give the lambda a multi-statement body, indent it on the following lines; `;` separates the *enclosing* block." |
| Inconsistent dedent (line at a column matching no open block) | standard offside error, naming the candidate columns. |

## 6. Decisions log

| Decision | Where |
|---|---|
| Block delimiters virtual and unspellable (VOPEN/VSEP/VCLOSE); indentation is the only block form | §1–2 |
| Braces always records; `{}` = empty record; no parser disambiguation | §1, §4; Products spec §3.1 |
| `;` real token, ≡ VSEP; "compressed newline" principle | §3 |
| `;` never opens a block | §3.1 |
| Separator not terminator: no leading/trailing/doubled `;`; illegal inside brackets; top level is a block | §3.2 |
| `x => { ... }` and trailing-`;` diagnostics mandatory | §5 |
| Tabs in leading whitespace are rejected before layout | §2; Physical Lexer §2.2 |
| Deeper indentation is continuation by default; block heads are a closed inventory | §2–2.1 |
| Module is an implicit block; clauses attach without VSEP | §2 |
