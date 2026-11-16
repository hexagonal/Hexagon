# Hexagon Spec: Lexer & Layout

**Status:** Decided (July 2026); compiler pass implemented. Revised 2026-11-13 (#1538): §1 and §4 say that `{-` opens a comment, not a brace. Amended 2026-11-14 (#1542): §2.3 keeps `//` out of the continuation tokens, and §2.1's declared-pattern example is `clock`. Amended 2026-11-16 (#1573): a head that holds an expression ends with its closing word, `then`, `do` or `with`, and deeper lines and open brackets carry it on until that word (§1, §2.1, §2.2, §2.4, §5, §6); a `then` at its item's column continues the item, as `else` and `catch` do (§2). Amended 2026-11-16 (#1590): a line ending in an assignment's `:=` opens a block, as a line ending in a binding's `=` does (§2.1, §6). This document owns layout, blocks, `;`, and
brace disambiguation. The companion [Physical Lexer](lexer.md) specification owns
the complete physical token and keyword inventory, source coordinates, literals,
whitespace, comments-as-trivia, and lexical diagnostics.
**Scope:** blocks as pure layout, virtual delimiters, where a block head ends, the explicit `;` separator, braces-are-records disambiguation, and the diagnostics these require.
**Companions:** Products spec (braces = records), Functions spec (block bodies of lambdas), Operators §11 (the conditional's head), Loops §2 and §4 (the loops' heads), Pattern Matching §6.1 and §6.7 (the `match` head and the match function).

---

## 1. Blocks are pure layout; virtual delimiters are unspellable

Hexagon's layout pass inserts virtual tokens — internally **VOPEN**, **VSEP**, **VCLOSE** — to delimit and sequence blocks. Unlike Haskell's layout algorithm, these tokens **have no written form**: there is no explicit block syntax at all. This is the deliberate subtraction from the Haskell design: Haskell lets `{`/`;`/`}` be written explicitly, forcing braces to do double duty (blocks *and* records); Hexagon gives braces to records unconditionally (Products spec §3.1) by making block delimiters unspellable.

Consequences:

- **Indentation is the only block form.** The body of a lambda, an `if`/`then`/`else` branch, a loop, or any construct taking a block is either a single expression on the same line, or an indented block on following lines; a `match`'s arms are always the block (§2.4). An **expression block's** value is its final expression, and its final item must be an expression — a block-final binding is a compile error (Statements §3.1); a member block has no value (§2.1's kinds). Canonical Hexagon style uses four spaces for each indentation level; the layout grammar accepts any consistent deeper column.
- **A `{` token always begins a record** (type or literal), in every position. The parser has one rule, no context-dependence. `{` followed directly by `-` is not a `{` token: the lexer reads it as a block comment's opener (Comments §3), which costs no record, since after `{` a record begins with a field name, `...` or `}`, and an update with its head, a name or a dotted path (Products §3.1, §3.3).
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
  item: any nested body is closed before the clause, but no VSEP is inserted
  between the body and its clause. A `then` there continues the item in the
  same way, so a conditional's `then` may stand on a line of its own at the
  item's column (Operators §11.3); `do` and `with` do not (§2.4). Which construct owns a
  continued `catch` is the parser's question, answered by column: it belongs to
  the construct whose head begins that logical item — a `try` (even when the
  try-body is a `match`), or a `match` head opening its line (the match catch
  clause, Exceptions §5.4). A `catch` continuing an item headed by anything
  else — a binding whose RHS ends in a mid-line `match`, say — is the
  Exceptions §9 alignment error; the layout pass itself stays agnostic.
- **Interaction with the physical lexer:** string-interpolation holes do not participate in layout (Physical Lexer §6.1; Primitive Types §5.2). Columns are UTF-16 code-unit columns supplied by physical token spans; the layout pass consumes them as-is.
- The physical lexer rejects tabs in leading whitespace (Physical Lexer §2.2;
  Decisions Batch 2026-07 §4), so layout never expands tabs.

### 2.1 Complete block-head inventory

Because deeper indentation means continuation unless a block is expected, the
layout pass recognizes this closed set of block heads. `export` may prefix any
declaration head in the table without changing it — the parser separately
refuses it before a `fun` block head (Functions §7.3; layout stays agnostic).

| Block head at the end of a logical item | Opens on a following indented line |
|---|---|
| Lambda or match-arm `=>` with no same-line body | Body block |
| Conditional head ending in its mandatory `then` (§2.4) | True-branch block |
| `for` or `while` head ending in its mandatory `do` (§2.4) | Loop body |
| `match` head ending in its mandatory `with` (§2.4), or the bare `match` that is the match function, whose head holds nothing (Pattern Matching §6.7) | Arm block |
| Bare `try` | Try body |
| Bare `attempt` or `assume` (Exceptions §8.2, §8.3) | Body block |
| `else` or `catch` with no same-line body | Clause body / arm block |
| `constraint ... =` or `honor ... =` | Member block |
| A `fun` head ending its logical item — the keyword alone, or with its binder list (`fun<a: Eq>`), no member on the line (Functions §7.3) | `fun` member block |
| An `honor` head ending its logical item — the keyword alone, or with a binder list (`honor<a: Show>`, which the parser refuses, Constraints §8), no instance on the line (Constraints §4.8) | Honor group (member block) |
| An honor group's item ending in `=` — `Show<Ping> =`, `<a: Show> Show<Rose(a)> =` (Constraints §4.8) | Member block |
| A `pattern` head ending its logical item — the name, alone or with its binder list, component list, and result type (`pattern clock(hours: Int, minutes: Int): Time`, `pattern parts`; Pattern Declarations §2.1). The alias form `pattern rgb = Color.rgb` opens nothing: a deeper-indented following line is a continuation of the item, as everywhere, and the alias rule reads the one name it finds there (Pattern Declarations §3.4) | `pattern` member block |
| `extern from "specifier"` head (FFI Part 4 §2.2 — one item per line under ordinary layout; the row was owed from that part and is added with the kind taxonomy) | Member block |
| An `extern class` head — `class` and its name, alias or modifiers, ending its logical item (FFI Part 5 §6.1). **Optional:** a head followed by no deeper-indented line is a class with no members and complete, never "expected an indented block" | Member block |
| Term binding ending in `=` (`let x =`, `var x =`, `let f(...) =`, `fun f(...) =`, or a member header — a `fun` block's member lines included) | Binding body block |
| Assignment ending in `:=` (`total :=`; Statements §6.3) | Value block |

A hard keyword standing in a name seat (Lexer §4.4) is a name, not a head, and not
§2.3's continuation operator: straight after a `.` (`let kind = ev.match` ending its
line opens nothing), straight before a label's `:` or `=`, or as a declaration's
name — straight after `let`, `var`, or `fun`, or in an FFI row's name seats, straight
after `method`, `get`, or `set` at the head of the item, past only `export`,
`static`, and `default` (`method match(text: String,
pattern: RegExp) ->! Bool` opens nothing) *(#982, #1014)*. A member-block item's head
is not a name seat, and a label seat lies inside a bracket pair, so `or` or `and`
beginning a line keeps §2.3's continuation reading.

*(#700 terminology.)* The right column sorts into three kinds, and the head
decides which: **expression blocks** — bodies, binding blocks and an assignment's
value block, item sequences whose final expression is the block's value
(Statements §3) —
**arm blocks** — a `match`'s or `catch`'s arms — and **member blocks** —
the `constraint`, `honor` (an honor's members, and an honor group's honors), `extern from`, `extern class`, `fun`, and `pattern` heads' bodies, plus the
module's own implicit block: sequences that declare rather than compute — no
value, no final-expression law (Statements §3.1; the module top level also
runs `Unit`-typed items, Modules §8.2). A member block is not an expression —
nothing assigns, passes, or returns one; what it binds is what gets used.
Layout knows no difference: one mechanism serves all three kinds.

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
*(#700.)* No exception remains: the once-recorded one — Functions §7.1's
written-form check on a `fun` right-hand side — retired with the `fun` RHS
itself. `fun` is header-only, so the zero-evaluation guarantee block binding
rests on is now the grammar's, and there is no `fun` RHS whose wrapping could
matter.

**An assignment opens a block as a binding does.** A line ending in `:=` opens a
block, and the value assigned is the block's value, its final expression
(Statements §6.3). So an assignment's value is laid out as a binding's: on the
`:=` line, alone on the lines beneath it, or as several items:

```
total :=
    let doubled = count * 2
    doubled + 1
```

A single wrapped expression is again the one-item case, and assigns what it would
assign written on the `:=` line.

Type declarations are *not* term bindings:
`record`, `union`, and `type` after `=` remain continuations, which is what keeps
indented union alternatives free of VOPEN. A union *declaration head* is
recognized contextually since the Set milestone — `union` followed by the
declared type's name (lexer spec §4.2, #373) — so a term binding named `union`
(`let union = …`) opens its block like any other term binding, while the
declaration form's layout is unchanged. `finally` is reserved but is never a
block head — Hexagon has no `finally` (Exceptions §10.1).

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

**`band`, `bor`, and `bxor` are excluded for the same reason**: each is the
bitwise operator only directly after a complete operand and an ordinary name
everywhere else (Lexer §4.2), so a line beginning with one can begin an
expression — `band.play()` is a new item. A continuation wanting one takes the
same two repairs. `bnot` is a prefix operator and begins an expression, like
`not`.

**`//` is excluded for another reason**: it cannot begin an expression, but a line
that begins with it is far more often the C-family comment habit than a fraction
split across lines. A leading `//` therefore begins a new item, where the parser
refuses it as a fraction with no top and names `--` (Comments §3.1). A
continuation wanting a fraction takes the same two repairs as subtraction.

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

**Brackets hold a head open.** A line that ends inside a bracket pair opens a
block only for a block head that stands inside that pair, such as a lambda's `=>`
written as an argument, and never for a head outside it. Such a head goes on
through the brackets to its closing word (§2.4):

```
while waiting(first,
        second) do
    step()
```

**A closing delimiter ends every layout block its group opened.** *(Added
2026-07-31; the ruling defect-log finding 5 was waiting on.)* The offside rule
closes a block when a line begins at a shallower column, and a group's `)`, `]`,
or `}` may share a line with that block's last item — there is no dedent to see:

```
Seq({ pull = () => match next(source) with
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
survives the group's closer — `match x with` / `A => f({ y = 1 })` keeps its arm block
across the `}`, and any following arm is still a sibling. And an **unmatched**
closer closes nothing: it is already an error, and unwinding real blocks on a
stray character turns one diagnostic into a cascade.

### 2.4 Heads and their closing words

A **head** is the part of a construct that comes before its body or its arms. A
head that holds an expression ends with a **closing word**:

| Head | What it holds | Closing word |
|---|---|---|
| `if` | the condition (Operators §11) | `then` |
| `while` | the condition (Loops §4) | `do` |
| `for` | the pattern, `in` and the source (Loops §2.1) | `do` |
| `match` | the scrutinee (Pattern Matching §6.1) | `with` |

A head that holds nothing needs none: a bare `try`, `attempt` or `assume`, `else`,
`catch`, and the bare `match` that is the match function (Pattern Matching §6.7).
An `else if` is an `else` followed by an ordinary conditional, whose head ends
with its own `then`.

```
if ready then
    start()

while remaining > 0 do
    remaining := step(remaining)

for (name, total) in totals do
    print("${name}: ${total}")

match parse(input) with
    Some(n) => n
    None => 0
```

**A head is unfinished until its closing word, and an unfinished head is no
block head.** Its logical item goes on, so §2's ordinary rule applies: a line
deeper than the item continues it, as a guard continues before its arm's `=>`
and a binding's header before its `=`. The closing word, ending a line, makes the
head a block head (§2.1), and the block opens on the lines that follow:

```
while remaining > 0
        and not cancelled(job) do
    remaining := step(remaining)
```

Brackets hold a head open as well (§2.2), and the head goes on after they close,
to its closing word.

**A head holds nothing open.** Only deeper lines carry it on. A line at the
item's column, or to its left, ends the item as it ends any other, unless it is
one of §2.3's continuation lines or one of §2's clauses. A head whose expression
meets anything but its closing word is the parser's error: the end of its item, or
a token that cannot continue the expression. It is reported at the head's
keyword: "`while` requires `do`" and its twins (Operators §15, Loops §10.2,
Pattern Matching §12). A forgotten closing word therefore takes in only the deeper
lines after its head, never the rest of the block. In this a head differs from a
bracket, whose group stays open until it is closed.

**No block opens inside an unfinished head**, except within brackets (§2.2). A
nested head whose closing word ends a deeper line of it opens nothing there, and
the lines after go on continuing the item. So the lines a forgotten closing word
takes in open no block and close none: the layout pass reports nothing among them,
and the head's report is the only one they draw. A form with a block of its own
that a head holds, such as a `match` with its arms, is written in parentheses,
where its block opens as in any bracket pair (§2.2):

```
for x in (match cached with
        Some(xs) => xs
        None => []) do
    visit(x)
```

**Where a closing word stands.** The canonical spelling ends the head's last line
with its closing word (Canonical Layout §9.3). None of the closing words can
continue the expression before it, so one may also begin a deeper line of the
head, the OCaml layout, which is legal but not canonical. A `then` at the item's
own column continues the item as well (§2). A `do` or a `with` there does not: it
begins a new item, and the head before it is reported as missing its closing
word, with the report naming the move (Loops §10.2, Pattern Matching §12). A `do`
that begins an item with no such head before it is the `do … while` habit, refused
as such (Loops §10.2).

**A body on the head's line.** A closing word followed by more on its line opens
no block: the rest of the item is the body, one expression, as after `=>` (§1),
so `while n > 0 do n := n - 1` is a whole loop. A `match`'s arms are the
exception, always a block (Pattern Matching §6.1), so `with` always ends its line.
`;` opens no block here either (§3.1): in `for x in xs do visit(x); finish()`, the
loop's body is `visit(x)`, and `finish()` runs once, after the loop.

**What the layout pass reads.** It decides from tokens alone where a head ends. A
`then` closes the nearest unfinished `if` head before it in its item, and a `do`
the nearest unfinished `for` or `while` head, each at its own bracket depth. A
`with` closes a `match` head where the scrutinee could end before it (Lexer §4.2):
at the `match`'s bracket depth, after at least one token of the scrutinee, and
directly after a token that can end an operand (a name, a literal, a closing
bracket or a call mark), but not written against a `)`, which is the suffix
seat. Any other `with` is a name, and a record update's
`with` stands inside braces, where it meets no head. So `match with with` matches
a value named `with`. A `match` that ends its line holds nothing: it is the match
function, so a scrutinee begins on its `match`'s line.

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
- **The top level of a module is a block**; `;` works there under the same rules. No special case. A file's column-0 items are split into modules by the `module Name` header and the `end module Name` closer (Modules §2.1–§2.2), and that split is the parser's: the layout algorithm sees one column-0 sequence and knows nothing of headers.

### 3.3 Emission

None. Block structure is explicit in the AST before codegen; emitted JS uses ordinary JS semicolons per its own formatter, with no relationship to whether the source used `;` or newlines.

## 4. Brace disambiguation: there is none (by design)

Because block delimiters are unspellable, the parser needs **no** brace disambiguation logic. Every `{` token is a record. The one lexical neighbour, `{-`, is decided by its two characters before any token reaches the parser: it opens a comment, and `{ -`, with a space, is a brace followed by a minus. The cost is paid instead in diagnostics for JS muscle memory (§5), which is the right place to pay it: one good error message versus permanent grammar ambiguity.

## 5. Required diagnostics

These are binding on the implementation, same status as the Functions spec's diagnostics table:

| Situation | Message (shape) |
|---|---|
| `x => { print(x) }` — brace-block habit; body parses as a record literal and fails (entries aren't `field = value`) | "Braces are record literals in Hexagon, not blocks. Write the block body on an indented line:" + a two-line fixit. (Mirror image of JS's own `=> ({})` wart; one good encounter defuses it.) |
| Trailing `;` at end of line/statement | "`;` separates statements; Hexagon lines don't end with one" |
| `;;` / leading `;` / empty statement | same family: "`;` must have a statement on both sides" |
| `;` inside `()`/`{}`/`<>` argument, tuple, record, or type-parameter context | "did you mean `,`? `;` only separates statements" |
| A `;`-sequence where a multi-statement lambda body was plausibly intended (lambda immediately preceding the `;` on the line) | append hint: "to give the lambda a multi-statement body, indent it on the following lines; `;` separates the *enclosing* block." |
| The same, where a loop's body on its head's line immediately precedes the `;` (§2.4) | append hint: "to give the loop a multi-statement body, indent it on the following lines; `;` separates the *enclosing* block." |
| Inconsistent dedent (line at a column matching no open block) | standard offside error, naming the candidate columns. |
| A line beginning with an expression-continuation token (§2.3) that dedents past the item it would continue | append hint: "a leading operator continues the previous item only at that item's own indentation; indent it to the item's column, or end the previous line with the operator." (The bare "expected a newline or `;` between block items" is loud but unhelpful here.) |

## 6. Decisions log

| Decision | Where |
|---|---|
| Block delimiters virtual and unspellable (VOPEN/VSEP/VCLOSE); indentation is the only block form | §1–2 |
| Braces always records; `{}` = empty record; no parser disambiguation | §1, §4; Products spec §3.1 |
| *(#1538)* `{-` opens a comment, not a brace, and costs no record | §1, §4; Comments §3 |
| `;` real token, ≡ VSEP; "compressed newline" principle | §3 |
| `;` never opens a block | §3.1 |
| Separator not terminator: no leading/trailing/doubled `;`; illegal inside brackets; top level is a block | §3.2 |
| `x => { ... }` and trailing-`;` diagnostics mandatory | §5 |
| Tabs in leading whitespace are rejected before layout | §2; Physical Lexer §2.2 |
| Deeper indentation is continuation by default; block heads are a closed inventory | §2–2.1 |
| Every term binding opens a block (`let x =` alike to `let f(...) =`); type declarations stay continuations | §2.1 |
| A line starting with an expression-continuation token continues the preceding item (leading `-` excluded) | §2.3 |
| Module is an implicit block; clauses attach without VSEP | §2 |
| `catch` continues a preceding `match` item exactly as it continues `try` — the match catch clause (Exceptions §5.4); attachment by column, no new layout machinery | §2 |
| A scrutinee-less `match` head opens its arm block through the same inventory row — the match function (Pattern Matching §6.7) needs no new layout rule | §2.1 |
| A `fun` head ending its logical item opens the member block; member lines are ordinary term-binding rows; the once-recorded §7.1 read-through exception retired with the `fun` RHS (#700) | §2.1 |
| An `honor` head ending its logical item opens the honor group (a member block), and each item's `C<T> =` opens that honor's member block (#1227) | §2.1 |
| Block-kind terminology (#700): expression blocks (value), arm blocks, member blocks (`constraint`/`honor`/`extern from`/`fun`/module top level — they declare rather than compute, and are not expressions); one layout mechanism serves all three; the `extern from` row joins the inventory (owed from FFI Part 4 §2.2) | §2.1, §1 |
| *(#1573)* A head that holds an expression ends with its closing word: `if … then`, `while … do`, `for … in … do`, `match … with`; a head that holds nothing needs none. An unfinished head is no block head: deeper lines carry it on, as they carry a guard or a header, and brackets hold it open; it holds nothing open itself, and no block opens inside it outside brackets, so a forgotten closing word is one report at the head's keyword. A closing `with` is recognised from tokens: at the `match`'s depth, directly after a token that can end an operand. A closing word may begin a deeper line (legal, not canonical); `then` at the item's column continues the item as `else` and `catch` do, while `do` and `with` there begin a new item. More after the closing word on its line is a one-line body, a `match`'s arms excepted | §2, §2.1, §2.2, §2.4 |
| *(#1590)* A line ending in `:=` opens a block, as a line ending in a binding's `=` does: an assignment's value is laid out as a binding's, on the `:=` line, alone beneath it, or as several items whose final expression is the value | §2.1 |
