# Hexagon Spec: Lexer & Layout

**Status:** Decided (July 2026) — but deliberately **partial**: this document records only the layout/block/`;`/brace decisions made in the Products design session. The full lexer specification (token inventory, string-interpolation mode stack, numeric-literal lexing, UTF-16 column tracking, comments, keywords) is owed; existing decisions that touch the lexer live in their own specs (Numeric Literals §3/§8, Primitive Types §5.2/§5.4/§8) and are cross-referenced, not restated.
**Scope:** blocks as pure layout, virtual delimiters, the explicit `;` separator, braces-are-records disambiguation, and the diagnostics these require.
**Companions:** Products spec (braces = records), Functions spec (block bodies of lambdas).

---

## 1. Blocks are pure layout; virtual delimiters are unspellable

Hexagon's layout pass inserts virtual tokens — internally **VOPEN**, **VSEP**, **VCLOSE** — to delimit and sequence blocks. Unlike Haskell's layout algorithm, these tokens **have no written form**: there is no explicit block syntax at all. This is the deliberate subtraction from the Haskell design: Haskell lets `{`/`;`/`}` be written explicitly, forcing braces to do double duty (blocks *and* records); Hexagon gives braces to records unconditionally (Products spec §3.1) by making block delimiters unspellable.

Consequences:

- **Indentation is the only block form.** The body of a lambda, an `if`/`then`/`else` branch, or any construct taking a block is either a single expression on the same line, or an indented block on following lines. A block's value is its final expression.
- **`{` in source always begins a record** (type or literal), in every position. The parser has one rule, no context-dependence.
- **`{}` is the empty record**, never an empty block.

## 2. Layout algorithm (shape, for the implementer)

The pass runs between the raw lexer and the parser, standard offside-rule mechanics:

- A construct expecting a block whose content starts on a **new line** at column C > enclosing indentation: emit VOPEN, record C on the indentation stack.
- Each subsequent line beginning exactly at C: emit VSEP before its first token.
- A line beginning at column < C: emit VCLOSE (popping repeatedly for multiple dedents), then resume comparison against the revealed enclosing context.
- Same-line (single-expression) bodies involve no virtual tokens.
- **Interaction with existing lexer decisions:** string-interpolation holes do not participate in layout (Primitive Types §5.2 — expression-level, inside a token as far as layout is concerned). Columns are tracked per the existing UTF-16 scheme; the layout pass consumes those columns as-is.
- Tabs: [owed to the full lexer spec — recommend hard error on tabs in leading whitespace rather than a tab-width convention; flagged, not decided.]

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
- **`;` is illegal inside brackets** — record literals, tuple literals, argument lists, type-parameter lists all use `,`. A `;` there → "did you mean `,`?". This keeps the token's meaning unique: `;` is exclusively block-level sequencing.
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
| Tabs-in-indentation policy | flagged, owed to full lexer spec (§2) |
