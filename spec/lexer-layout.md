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
- At an open block's indentation, a new logical item receives VSEP — *unless* the
  line begins with a token that can only continue an expression (§2.3), in which
  case it continues the preceding item. Deeper indentation is a continuation of
  the current logical item by default; it does **not** open a block merely because
  it is deeper. This is what keeps a multi-line declaration, operator expression,
  or argument list together.
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
| Conditional header ending in mandatory `then` | True-branch block |
| `for` or `while` head | Loop body |
| `match` head | Arm block |
| Bare `try` | Try body |
| `else` or `catch` with no same-line body | Clause body / arm block |
| `constraint ... =` or `honor ... =` | Member block |
| Term binding ending in `=` (`let x =`, `var x =`, `let f(...) =`, `fun f(...) =`, or a member header) | Binding body block |

**Every term binding opens a block.** A binding's indented RHS is a block whose
value is its final expression, exactly as for a function body — the parameter
list is irrelevant, so `let x =` and `let f(...) =` behave alike:

```
let x =
    let y = 40
    y + 2        -- x is 42
```

A single wrapped expression is simply the one-item case, so the ordinary
multi-line RHS is unaffected. "Unaffected" is load-bearing, and it binds every
rule that reads what a right-hand side *means*, not just its value: the one-item
block is peeled before the value restriction, the exported-signature check, or
evidence threading sees it, so moving a RHS to the next line cannot change what
the binding means (Functions §8.2, which also rules on the multi-item case).
The one exception is Functions §7.1, which asks what a `fun`'s right-hand side
**is** — a check on the written form, which is what group binding's zero-evaluation
guarantee rests on — and so refuses a lambda literal that arrives wrapped, in
parentheses or on the next line alike.

Type declarations are *not* term bindings:
`record`, `union`, and `type` after `=` remain continuations, which is what keeps
indented union alternatives free of VOPEN. A union *declaration head* is
recognized contextually since the Set milestone — `union` followed by the
declared type's name (lexer spec §4.2, #373) — so a term binding named `union`
(`let union = …`) opens its block like any other term binding, while the
declaration form's layout is unchanged. `finally` is reserved but is not a v1
block head.

### 2.3 Expression-continuation tokens

Because a term binding's RHS is now a block, a line at that block's own
indentation would ordinarily start a new item — which would break the aligned
multiline chain, where every line sits at one column:

```
export let selected: Seq(Int) =
    numbers
    .filter(number => number > 3)
    .take(5)
```

So a line beginning with a token that can only *continue* an expression, never
begin one, continues the preceding item and receives no VSEP. The closed set is
`.`, `|>`, the binary operators (`+`, `*`, `/`, `==`, `!=`, `>`, `<=`, `>=`,
`..`, `->`, `and`, `or`), `,`, and the closing delimiters `)`, `]`, `}`. The same
rule makes a leading-operator continuation read as one expression:

```
let total =
    40
    + 2          -- total is 42
```

**`-` is deliberately excluded**: it is both binary subtraction and unary
negation, so a leading `-` begins a new item. A continuation wanting subtraction
indents deeper or writes the operator at the end of the previous line. (F# and
Scala 3 carry the same wart for the same reason.)

**`<` is excluded for the same reason**: it is both the comparison operator and
the opening of a type-parameter lambda's binder list (Functions §4.2), so a
leading `<` begins a new item. A continuation wanting comparison takes the same
two repairs as subtraction. `>` stays in the set — it closes a binder list but
never opens one.

The rule is uniform across every block, **including the module's own**: at column
0, `let a = 1` followed by a line beginning `+ 2` continues the binding rather
than starting a declaration, so `a` is `3`. This is the rule applied consistently,
not an accident of the top level.

The set is closed against the *current* expression grammar: a token belongs only
while it cannot begin an expression. Any future syntax that makes a listed token
expression-initial must remove it here in the same change. `<` was the live case
and has now been discharged: landing Functions §4.2's type-parameter lambda form
made `<` expression-initial, and it left this set in the same change.

### 2.2 Physical delimiters

Ordinary newlines inside `()`, `[]`, and `{}` are continuation whitespace and
do not produce virtual tokens. A genuine block head may still open a nested
layout block inside a delimiter—for example, a multiline lambda supplied as a
call argument. While that nested block is open, its own newlines and semicolons
use the ordinary block rules.

**A closing delimiter ends every layout block its group opened.** *(Added
2026-07-31; the ruling defect-log finding 5 was waiting on.)* The offside rule
closes a block when a line begins at a shallower column, and a group's `)`, `]`,
or `}` may share a line with that block's last item — there is no dedent to see:

```
Seq({ pull = () => match next(source)
    None => None
    Some((value, rest)) => Some((value, rest)) })
```

The arm block is closed by the `}`, which is then the record literal's own
closer. Without this rule the block stays open and the parser reads `}` as the
next arm's pattern. The rule is positional, not a parse-error recovery: each
block records the delimiter depth it was opened at, and the blocks a group
encloses are exactly those whose recorded depth is **at least** the depth of the
group being closed — deeper nesting, larger number. Closing them needs no
feedback from the parser. Haskell reaches the same outcome through its
`parse-error(t)` side condition; Hexagon does not need one, because block heads
are a closed set (§2.1) and groups are physically delimited.

Two boundaries this rule does **not** cross. A block opened *before* the group
survives the group's closer — `match x` / `A => f({ y = 1 })` keeps its arm block
across the `}`, and any following arm is still a sibling. And an **unmatched**
closer closes nothing: it is already an error, and unwinding real blocks on a
stray character turns one diagnostic into a cascade.

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
| `x => { print(x) }` — brace-block habit; body parses as a record literal and fails (entries aren't `field = value`) | "Braces are record literals in Hexagon, not blocks. Write the block body on an indented line:" + a two-line fixit. (Mirror image of JS's own `=> ({})` wart; one good encounter defuses it.) |
| Trailing `;` at end of line/statement | "`;` separates statements; Hexagon lines don't end with one." |
| `;;` / leading `;` / empty statement | same family: "`;` must have a statement on both sides." |
| `;` inside `()`/`{}`/`<>` argument, tuple, record, or type-parameter context | "did you mean `,`? `;` only separates statements." |
| A `;`-sequence where a multi-statement lambda body was plausibly intended (lambda immediately preceding the `;` on the line) | append hint: "to give the lambda a multi-statement body, indent it on the following lines; `;` separates the *enclosing* block." |
| Inconsistent dedent (line at a column matching no open block) | standard offside error, naming the candidate columns. |
| A line beginning with an expression-continuation token (§2.3) that dedents past the item it would continue | append hint: "a leading operator continues the previous item only at that item's own indentation; indent it to the item's column, or end the previous line with the operator." (The bare "expected a newline or `;` between block items" is loud but unhelpful here.) |

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
| Every term binding opens a block (`let x =` alike to `let f(...) =`); type declarations stay continuations | §2.1 |
| A line starting with an expression-continuation token continues the preceding item (leading `-` excluded) | §2.3 |
| Module is an implicit block; clauses attach without VSEP | §2 |
