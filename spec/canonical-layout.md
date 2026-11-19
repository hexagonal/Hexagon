# Hexagon Spec: Canonical Layout

**Status:** Decided (November 2026). The layout that Format document and Format selection write (#1561; the formatter's stages are gathered under #1567). Amended 2026-11-16 (#1573): a head, which ends with its closing word, may be broken, though never before that word; a loop's body goes beneath its `do` (§5.3, §7.1, §9.3, §9.4, §10, §11). Amended 2026-11-16 (#1586): brackets whose only item is bracketed open and close with it, a lambda that is a call's last argument, a record's last field or a binding's value keeps its head on its line, and brackets of literals are filled (§5.2, §9.4, §10). Amended 2026-11-16 (#1590): an assignment is laid out as a binding is, its value beneath its `:=` (§5.3, §9.4, §10, §11). Amended 2026-11-16 (#1594): a list whose closing bracket begins its line ends with a comma, which Format document adds unless the third option, Leave trailing commas as written, is on, and a `<…>` list the author spreads opens as other brackets do (§1, §3, §5, §7, §9, §10–§14). Amended 2026-11-17 (#1598): the code inside a string's interpolation holes is spaced as code is anywhere, while a string's text is never changed and a hole is never broken (§1, §4–§7, §9.3, §10, §12, §13). Amended 2026-11-17 (#1602): each kind of construct has a width limit on one line, and a fourth option, Apply width limits, spreads a construct over its width limit, or a nested conditional or loop, though its line fits; Format document also leads the first alternative of a union written one alternative to a line with `|`, removes a trailing comma that a break leaves after a block, and opens a spread record declaration's braces on its `=`'s line (§1, §3, §6.3, §9, §10–§16). Amended 2026-11-19 (#PRNUM): every bracket is written tight, braces included, and a value, body or branch that begins with brackets that open keeps its opening bracket on the line of its `=`, `:=`, `=>`, `then` or `else` (§3.3, §5, §7.1, §7.4, §9.4, §10, §11, §13–§15).
**Scope:** What the two formatting commands change and what they refuse (§1–§2); the four options and the test any later option must pass (§3); line ends (§4), indentation (§5), blank lines (§6) and spacing within a line (§7); comments (§8); how a line longer than the Maximum line length is broken (§9); what the formatter leaves to the author (§13); the trailing comma it adds (§14); the width limit on each kind of construct, and the spreading of a construct over it (§15); the leading bar it adds to a union (§16).
**Not in scope:** Changes to tokens other than adding a trailing comma (§14), removing one that a break leaves after a block (§14), and adding a union's leading bar (§16): removing or adding parentheses or a degenerate `x: _`, removing a leading `|`, and moving imports. Each waits for a ruling of its own (§13). House style, which is how the standard library and the Book are written where the formatter leaves the author free: `notes/canonical-formatting-and-naming.md`. The editors' commands and settings screens, which are the implementation's (§12).
**Companions:** Lexer & Layout (blocks, the block-head inventory §2.1, the continuation tokens §2.3, heads and their closing words §2.4, lists and the trailing comma §7), Lexer §2 (line ends, tabs) and §7 (trivia), Comments §2–§4, Doc Comments §3–§4, Operators §3 and §11.3 (the conditional's shapes), Method Syntax §2.1 (the chain's shape), Unions §2, Modules §2–§3 (headers, closers, imports), Ascription §2, `notes/canonical-formatting-and-naming.md` (house style).

---

## 1. The ruling

> Format document rewrites the whitespace of a document into its canonical layout, adds the trailing commas of §14 and the leading bars of §16, removes the trailing commas §14 removes, and changes nothing else. It keeps every line break the author wrote in code and never joins two lines of code. It breaks a line of code only where the Maximum line length option is set and the line is longer, or where the Apply width limits option is on and the line holds a construct that §15 spreads. Blank lines are §6's.

Three guarantees follow, and an implementation checks each of them on every run (§12):

- **The text is the same.** The tokens, every comment and the text of every string are identical before and after, in the same order, apart from the trailing commas and leading bars the formatter adds and the trailing commas it removes (§14, §16). The tokens include those inside a string's interpolation holes, which are spaced as code is (§7.4). A line end is a line boundary, not text (Lexer §2.1), so a comment or string that spans lines is the same whichever line end separates them.
- **The program is the same.** The formatted document parses to the same tree. Hexagon is layout-sensitive (Lexer & Layout §1), so this is a separate guarantee from the first: an indentation change can change what a program means while leaving its tokens alone.
- **Formatting twice changes nothing.** A document Format document has written is unchanged by Format document under the same settings.

## 2. Format document and Format selection

### 2.1 Format document

**Format document** formats a whole `.hex` document. A document can hold several modules (Modules §2.2), and every one of them is formatted.

### 2.2 Format selection

**Format selection** formats part of a document. The selection widens to whole **top-level items**: the declarations, imports and statements at a module's top level, and the module headers and closers. A comment belongs to the item after it (§8.2). Comments with no item after them form one item of their own at the end of the document.

The **region** runs from the first line of the first item the selection touches, its comments included, to the last line of the last item it touches, together with the blank lines after that item, up to the next item. A selection that touches only blank lines between two items covers those blank lines.

Within the region, the result is exactly what Format document writes there, byte for byte. Outside the region, nothing changes.

The two commands can never disagree about a region. Part of a block cannot be formatted alone, since re-indenting part of a block can change what it means.

### 2.3 Refusals

A document with a syntax error anywhere in it is refused by both commands. They return no edits and report nothing of their own: the error is already reported. A document that parses but does not type-check is formatted.

The only other refusals are §8.2's, for a comment that leaves its code no room, and §12's safety check. Each returns no edits and says which line, or that the check failed.

### 2.4 Nothing formats unasked

The commands run only when the developer asks for them. Hexagon's tools do not format a document on save, on paste or while typing, and the Playground does not format by itself.

## 3. The options

### 3.1 Maximum line length

**Maximum line length** is either Unlimited or a number of characters (§9.2). The default is Unlimited, and under Unlimited no line is broken for its length. Set to a number, it breaks each longer line as §9 describes. Since the formatter never joins lines, a document formatted at one length is left alone at any greater length and at Unlimited.

### 3.2 Collapse extra spaces

**Collapse extra spaces** is either off or on. The default is off.

- **Off:** where §7 calls for one space, a wider gap the author wrote is kept, so code aligned in columns keeps its alignment.
- **On:** every gap in code where §7 calls for one space becomes exactly one space.

Either way, a missing space is added where §7 calls for one, a space is removed where §7 allows none, and the gap before a trailing comment is kept (§8.3).

### 3.3 The admission test for an option

These are the first four options, not necessarily the last. Any option must pass two tests:

1. **It starts off.** With the option at its default, the formatter writes exactly what it would write without the option.
2. **Two settings never undo each other.** Take any two settings, A and B. Once a document has been formatted under A and then under B, formatting it again under either A or B changes nothing.

All four pass. Maximum line length only adds line breaks, and no setting removes one. Collapse extra spaces only removes spaces, and no setting adds them back. Leave trailing commas as written only keeps the formatter from adding commas, and no setting removes one, except the comma after a block that §14 removes under every setting and no setting adds. A line's length counts a comma §14 would add whether or not it is written (§9.2), so adding the comma never carries a line past a limit it was formatted to. Apply width limits only adds line breaks, as Maximum line length does, together with the trailing commas §14 gives the brackets it opens, and the leading bar (§16) and blank line (§6.3) of a union it spreads, and no setting removes any of these. A width limit measures a construct spaced as Collapse extra spaces on spaces it, and without a trailing comma (§15.2), so the other options never change what it spreads.

An option where one setting adds what another removes fails the second test. Two developers with different settings would rewrite the same lines back and forth on every save. Padding inside record braces is the example: §7.1 rules on the space inside a bracket, and no option does.

### 3.4 Leave trailing commas as written

**Leave trailing commas as written** is either off or on. The default is off.

- **Off:** Format document adds a trailing comma wherever §14 calls for one.
- **On:** it adds none.

Either way, a comma the author wrote stays where it is, except one after a last item that a break leaves ending in a block, which §14 removes under either setting.

### 3.5 Apply width limits

**Apply width limits** is either off or on. The default is off.

- **Off:** a line is broken only where it is longer than the Maximum line length (§9).
- **On:** Format document also spreads a construct on one line that is wider than its width limit, or whose kind is never on one line, even where its line fits (§15).

Either way, nothing is joined: a construct within its width limit that the author spread stays spread (§13).

## 4. Line ends

- Every line ends with a line feed. A carriage return followed by a line feed, or a lone carriage return, becomes a line feed. Lexer §2.1 makes all three the same line boundary, and inside a multiline string each is the same `\n`, so no value changes.
- No line ends in spaces or tabs outside a string or comment. Whitespace after the last code on a line is removed. Whitespace inside a multiline string is content, and whitespace at the end of a comment is the comment's (§8.1); both stay, as does whitespace at the end of a line inside an interpolation hole (§7.4).
- A line holding only spaces or tabs becomes empty.
- The document ends with exactly one line feed after its last line. A document with no code and no comments becomes empty.
- A byte-order mark at the start of the document stays as it is (Lexer §2.1).

## 5. Indentation

### 5.1 The rule

Indentation is spaces, four to a level (Lexer & Layout §1). The editor's own indentation settings play no part.

A level of indentation says what a line is:

- **One level in** is for contents on their own lines: the lines of a block, the items between brackets that close on their own line, and the alternatives of a union.
- **Two levels in** is for the rest of a line, carried on.

An **item** is a line's place in the structure: a statement, arm or member of a block, an item between brackets, or a union alternative. The item a line continues is the innermost item that holds both the line's first token and the token before it.

Each line that begins with code sits at a level measured from a line above it. The first row of this table that applies decides:

| The line begins | It sits | Measured from |
|---|---|---|
| an item at a module's top level | at column 0 | — (Modules §2.1: nothing indents on the header's account) |
| the closing bracket of an open bracket pair (§5.2) | at the same level | the line holding the opening bracket |
| a comma, between the items of brackets, such as after an item that ends in a block (Lexer & Layout §7) | at the same level | the line holding the opening bracket |
| `else` or `catch`; or `then`, where the author wrote it at its item's column | at the same level | the line on which the item holding its `if`, `try` or `match` begins |
| an item of a block: a statement, an arm or a member | one level in | the line on which the construct that owns the block begins (§5.3) |
| a declaration's value, written beneath its `=` | one level in | the declaration's first line |
| a union alternative led by `\|` | one level in | the declaration's first line |
| an item between open brackets | one level in | the line holding the opening bracket |
| a token of Lexer & Layout §2.3's continuation set (`.`, `\|>`, `,`, and the binary operators listed there), written at its item's column | at the same level | the line on which the item begins |
| the rest of an item, after a block that the item holds has ended | at the same level | the line on which the item begins |
| anything else: the rest of a line, carried on | two levels in | the line on which the item it continues begins |

For example:

```
export let map(source: Option(a), transform: a ->! b): Option(b) =
    match source with
        Some(value) => Some(transform!(value))
        None => None

let ready =
    configured and connected
            and notExpired(session)

let corners = [
    {x = 0, y = 0},
    {x = 1, y = 1},
]

let selected =
    numbers
    .filter(number => number > 3)
    .take(5)
```

A chain whose receiver stands in the middle of its item's first line is carried on like any other line, and its links stay aligned with each other:

```
let selected = numbers
        .filter(number => number > 3)
        .take(5)
```

### 5.2 Open brackets

A pair of `()`, `[]` or `{}`, or the `<` and `>` of a list such as a binder list (Lexer & Layout §7), is **open** when its closing bracket begins a line. The items between open brackets sit one level in from the line holding the opening bracket, and the closing bracket sits at that line's own indentation. An item begins on a line of its own when the opening bracket or a comma ends the line before it.

When the closing bracket does not begin a line, the lines between the brackets are the rest of a line carried on, two levels in:

```
let label = describe(firstName,
        lastName)
```

The formatter never opens a `<…>` list itself (§9.4); one is open only where the author has opened it. Its `>` may begin a line at its item's column or deeper, since `>` is a continuation token (Lexer & Layout §2.3), and the formatter puts it at the indentation of the line holding the `<` (§5.1).

Brackets whose only item is an open pair, written straight after the opening bracket and straight before the closing one, are not carried on. The lines between them are the inner pair's: its items sit one level in from the line holding both opening brackets, and the outer closing bracket follows the inner one on its line (§9.4 rule 2):

```
let piece =
    Piece({
        expr = Empty,
        kind = Setting(flags),
    })
```

### 5.3 The construct that owns a block

A block's lines are measured from the line on which the construct that owns the block **begins**, not from the line where its head ends. The owners are those of Lexer & Layout §2.1's inventory: a binding or member header for its body, an assignment for its value, `if` for the branch after `then`, the `else` clause for its branch, `match` and `catch` for their arms, an arm for its body, `try`, `attempt`, `assume`, `for` and `while` for their bodies, a lambda for its body, and a declaration head for its member block.

So a header, a guard or a head carried onto a second line does not push its block deeper, and nested blocks add up one level at a time:

```
export let clamp(reading: Option(Int),
        limit: Int): Int =
    match reading with
        Some(n) when n > 0
                and n < limit =>
            n
        _ => 0
```

The body of `clamp` is measured from the line where `export let` begins, and the arm's body from the line where the arm begins. A head carried on to its closing word is measured the same way (Lexer & Layout §2.4): its carried-on lines sit two levels in from its first line (§5.1), and its block one level in:

```
while remaining > 0
        and not cancelled(job) do
    remaining := step(remaining)
```

### 5.4 Lines the rows do not move, and what the rows keep

- **A line that begins inside a multiline string** keeps its indentation, whether it begins in the string's text, which is content, or in an interpolation hole (§7.4).
- **A line that begins inside a block comment** moves with its comment (§8.2).
- **A comment that begins its line** is placed by §8.2.

The rows are chosen to keep every relation the layout pass reads (Lexer & Layout §2). A block's lines share one column, deeper than the item that holds the block. `else` and `catch` stand at their item's column, where a dedent out of a branch must land. A line that begins with a continuation token at its item's column stays there, and continues the item rather than beginning a new one (Lexer & Layout §2.3). The rest of an item after a block it holds returns to the item's level, below the block it follows. Every other carried-on line stays deeper than the item it continues. The check of §12 guards the rest.

## 6. Blank lines

### 6.1 The author's blank lines

The formatter keeps the blank lines the author wrote, with a run of them capped at one. It removes them in four places:

- at the start and the end of the document;
- after a line that opens a block, before the block's first line;
- after a line that ends with the opening bracket of an open pair, before its first item;
- before a closing bracket that begins its line, and before `else` or `catch`.

Blank lines inside a string or a comment are never touched. In a string's text and in a comment they are content, and an interpolation hole keeps its lines as written (§7.4).

### 6.2 Blank lines the formatter adds

The formatter adds a blank line only **after** something, never before. It does so only at a module's top level and never reorders anything. It adds one in three places:

1. **After each run of imports**, when a declaration or statement follows it. A run is consecutive `import` and `extern import` items, with any comments between them.
2. **After a multi-line declaration**, when a declaration, import or statement follows it.
3. **After a module's closer**, when another module follows it.

Comments between the two do not matter: the added line goes directly after the imports, the declaration or the closer, ahead of any comment that follows. A module's header and closer are not what follows, so no blank line is added before a closer. Nothing that follows causes a blank line: not a doc comment, not a multi-line declaration, and not the end of the document. So a one-liner written directly above a multi-line declaration stays attached to it, unless the author separates them.

```
module Shapes

import Geometry

let unit = 1.0
let half = 0.5
let scale(factor: Float): Float =
    let doubled = factor * 2.0
    doubled * half

let area(side: Float): Float = side * side

end module Shapes
```

Here the formatter adds the blank line after `import Geometry` and the one after `scale`. The other blank lines are the author's. `half` stays attached to `scale`, which follows it.

### 6.3 One-liners and multi-line declarations

A top-level declaration is **multi-line** when one of its lines begins a second or later item of a block, such as a statement, an arm or a member, or begins a union alternative after another alternative written on its own line.

Every other declaration is a **one-liner**, however many lines it takes. A declaration whose value sits alone beneath its `=` is a one-liner. So is one carried on at two levels, a vector literal or record declaration with its brackets open one item per line, a chain, and a conditional whose branches are single lines.

Doc comments and other comments do not count. A documented one-liner is still a one-liner, and how documented one-liners are grouped is the author's choice.

Breaking a long line never creates or removes a line that begins a block's second item or a union's second alternative (§9.3). So Maximum line length never changes which declarations are multi-line, and a document's grouping is the same under every setting of it. Apply width limits changes it in one place only: a union of two or more alternatives that it spreads puts each alternative on a line of its own (§15.3), so the union becomes multi-line and a blank line follows it (§6.2). Since the formatter never joins lines, no setting turns a multi-line declaration back into a one-liner.

## 7. Spacing within a line

### 7.1 The rules

These rules govern the gaps between two code tokens on the same line. They do not apply to a line's indentation (§5), to a string's text or the inside of a comment, or to the gap before a trailing comment (§8.3). They do apply between the tokens of a string's interpolation hole (§7.4). Where two rows meet, the earlier row decides.

| Where | Spacing | Written |
|---|---|---|
| Either side of a binary operator: `+` `-` `*` `/` `**` `++`, the comparisons, `and` `or` `implies` `iff`, `band` `bor` `bxor` | one space | `a + b`, `2 ** n`, `x band mask` |
| Either side of `=`, `:=`, `=>`, `\|`, `\|>` and a type arrow (`->`, `->^`, `->~`, `->!`, `>->` and the other follows arrows) | one space | `let n = 1`, `x => x`, `a ->! b` |
| `..` and `//` | no space either side | `1..n - 1`, `1//2`, `n//d` |
| `.` | no space either side | `xs.length`, `Vector.at(xs, 1)` |
| Before `,` or `;`; after `,` or `;` | none before; one after, except none between a comma and `)`, `]`, `}` or a `>` that closes a list | `f(a, b)`, `let x = 1; let y = 2`, `f(a, b,)` |
| Before `:`; after `:` | none before; one after | `width: Float`, `(e: Type)`, `x: _: Num`, `<a: Num>` |
| Inside an interpolation hole's `${` and the `}` that closes it | none | `"${total}"`, `"${{x = 1}.x}"` |
| Inside `(` `)`, `[` `]`, `{` `}` and `<` `>` | none | `f(x)`, `[1, 2]`, `{top = 1, bottom = 2}`, `{x: Int}`, `{}`, `Pow<a: Num>` |
| `derives` after a declaration head, and the token on either side of it | one space | `union Ping derives (Eq, Show)`, `record Pair(a, b) derives (Eq, Show)` |
| An opening bracket after a name, a closing bracket or the `>` of a binder list | none | `f(x)`, `xs[i]`, `Vector(a)`, `Show<Ping>`, `<a: Ord>(x)` |
| A binder list's `<` after a keyword | none | `fun<a: Eq>`, `honor<a: Show>` |
| A prefix sign and its operand: unary `-`, variance `+` and `-`, spread `...` | none | `-x`, `Nullable(+a)`, `[_, ...rest]` |
| A keyword and the token on either side of it | one space | `match (a, b) with`, `if ready then 1 else 2`, `f(x) then` |
| Between two names, or a binder list's `>` and a name | one space | `<a: Show> Show<Rose(a)>` |
| Any other two tokens | as the author wrote them: a gap stays a gap (§7.3), and no gap stays none | |

Colons have one spacing everywhere. Every colon is tight on its left with one space after. This holds for a binding's annotation, an ascription, a constrained hole and a binder list alike. The space before a colon carries no meaning: horizontal whitespace is trivia, not a token (Lexer §7), and no rule of the lexer or the parser reads whether a colon touches what stands before it. Hexagon writes parameters in brackets and has no application by juxtaposition. Gleam is the same in both respects, and its documentation writes `fn add(x: Int, y: Int) -> Int`.

Brackets also have one spacing everywhere. Nothing stands inside a bracket's edges, whether the bracket is a call's or a tuple's parenthesis, a vector's or an index's square bracket, a binder list's `<` and `>`, an interpolation hole's braces or a record's. So a record is spaced alike as a type, a literal, a pattern and an update, as in `{x: Int}`, `{x = 1}`, `{x, y}` and `{p with x = 2}`, and as `show` prints it (Products §3.4). A tight `{` never meets the comment opener `{-`, since no record begins with `-` (Lexer & Layout §1).

`derives` is a keyword in the header of a `record`, `union` or foreign enum, before its `=` (Lexer §4.2). It lexes as a name, but it is spaced as a keyword, so its brackets never look like a call's: `union Ping derives (Eq, Show)`. Anywhere else `derives` is an ordinary name, and a function named `derives` is called tight, as in `derives(1)`.

`with` is spaced as a keyword where it closes a `match` head (Lexer §4.2), as in `match (a, b) with`. Written against the `)`, it would be a suffix construction instead, a gap the formatter never closes (§7.2).

### 7.2 Gaps the formatter never opens or closes

Some gaps carry meaning. Whether there is a gap there is never changed; how wide it is follows §7.3.

- **Between a closing parenthesis and a name.** A name written against `)` is the suffix seat (Pattern Declarations §3.1). With a space it is whatever it is elsewhere: `(r) as s` is an as-pattern, `(a bor b) band mask` an operator, and `match (a, b) with` a `match` head closed by its `with`. A `derives` after a declaration head's parameters is not such a name but the keyword, which §7.1 spaces: `record Pair(a, b) derives (Eq, Show)`.
- **Around a call mark.** A mark is written glued to its callee and to the argument list it governs (Lexer §8.1; Effects §3.2), as in `save!(x)` and `text |> Int.parse^`.

The formatter also never removes a space where removing it would make two tokens read as one, or would begin a comment. A unary minus applied to a negation keeps its space, as in `- -x`, since `--` begins a comment (Comments §2).

### 7.3 Extra spaces and tabs

Where §7.1 calls for one space, Collapse extra spaces decides what happens to a wider gap (§3.2). Where §7.1 allows none, every space is removed under either setting. Indentation is never collapsed: it is §5's.

A tab between code tokens becomes spaces (Lexer §2.2). Each tab advances to the next column that is a multiple of four, counted in code points on the line as the author wrote it, and the gap is then treated as spaces. The formatter writes no tab outside a string or comment.

### 7.4 Inside a string

A string's **text** is everything between its quotes apart from its interpolation holes. The text is never changed: its spaces, tabs and line breaks are part of the string's value. A **hole**, from its `${` to the `}` that closes it, holds code (Lexer §6.1). The gaps between its tokens on one line follow §7.1–§7.3, as gaps in code do anywhere, under either setting of Collapse extra spaces (§3.2). For example,

```
Debug.log("Does 10/12 = 5/6? ${10 // 12 == 5 // 6}")
let label = "${ count+1 } of ${total  -  skipped}"
```

becomes

```
Debug.log("Does 10/12 = 5/6? ${10//12 == 5//6}")
let label = "${count + 1} of ${total - skipped}"
```

with Collapse extra spaces on. With it off, `total  -  skipped` keeps its wider gaps, and every other change is the same.

- **A hole's own braces** take no space inside them (§7.1), as no bracket does: `${total}`. They are not a record's braces, and a record inside a hole is spaced as a record is anywhere, as in `${{x = 1}.x}`.
- **A string inside a hole** has text and holes of its own, and this section applies to them at any depth.
- **A comment inside a hole** is a comment. Its inside is never changed (§8.1), and the gap before a trailing comment is kept, never less than one space (§8.3).
- **Only the gaps between a hole's tokens on one line change.** A hole is never broken (§9.3). A hole the author wrote over several lines is a named limit: it keeps its line breaks and blank lines, the indentation of each line that begins inside it and any spaces at the end of such a line, and it takes no trailing comma (§4, §5.4, §6.1, §14). The layout pass does not read a hole's lines (Lexer §6.1), so §5's levels, which follow blocks and items, give them none to take, and how they are laid out waits for a ruling of its own. A `${` that ends its line and a `}` that begins one stay where they are.

## 8. Comments

### 8.1 The inside of a comment

The inside of a comment is never changed. This covers a line comment from `--` to the end of its line, and a block or doc comment from its opener to its closer. Its spacing, its line breaks and any trailing spaces all stay as written. The trailing spaces matter in a doc comment, whose content is Markdown (Doc Comments §3, §6). No comment is ever moved to another line, and no code is moved across a comment.

### 8.2 A comment that begins its line

A comment that begins its line takes the indentation of the next line that begins with code. With no such line after it in the document, it goes to column 0. It belongs to that line's item: Format selection takes them together (§2.2), and an added blank line goes before the comment, not between it and its item (§6.2).

A comment that spans lines moves as a unit. Every line of it shifts by the same number of columns, so a doc comment's content, which is measured from its lines' common indentation, stays the same. If a move to the left would cut into the text of a later line, the later lines stay as written and only the first line moves.

A line that begins with a block comment and continues with code is placed by its code. The code goes where §5 puts it, and the comment stands before it. The gap between the comment and the code is an ordinary gap, like one where §7.1 calls for one space: it is kept as written, it becomes one space under Collapse extra spaces (§3.2), and it is never less than one space. Where the comment does not fit before the code with that gap, the gap shrinks as far as it must. Where even one space leaves no room for the comment, the formatter refuses the document and names the line (§2.3).

### 8.3 A comment after code

A comment after the last code on its line is a **trailing comment**. The gap before it is kept as written, with a minimum of one space, under either setting of Collapse extra spaces. When its line is broken (§9), it stays after the token it followed.

## 9. A line that is too long

### 9.1 When a line is broken

A line is broken in two cases only: where Maximum line length is set to a number and the line is longer than that number, and where Apply width limits is on and the line holds a construct that §15 spreads. Every other line keeps the breaks it has and gains none. A line broken in two is looked at again, and each part that is still too long, or still holds such a construct, is broken in turn.

### 9.2 The length of a line

A line's length is the number of Unicode code points on it, from its first character to its last. Its indentation counts; its line end does not. A trailing comment and the gap before it do not count. Where §14 would add a trailing comma with Leave trailing commas as written off, the line counts it whether or not it is written, so a line measures the same under either setting of the option (§3.4). With the option on, such a line is broken once its written length reaches the limit. In the same way, a line counts a leading bar that §16 would add to it, whether or not the bar is written yet.

Code points are the measure in version one. The measure may later become display width, so that a wide character counts as two. That change is safe: since the formatter never joins lines, a document formatted under one measure is at most broken further under the other.

### 9.3 What is never broken

- **A string**, its interpolation holes included, and **a comment**. The tokens inside a hole are spaced as code is (§7.4), but no line is broken there.
- **A union's alternatives** are never split onto lines of their own to shorten a line, since that would change which declarations are multi-line (§6.3). Only Apply width limits puts them on lines of their own (§15.3).
- **Before a closing word.** `then`, `do` and `with` end the last line of their head (Lexer & Layout §2.4), and no break is made before one. A closing word the author wrote at the start of a line stays there, since the formatter never joins lines (§1), but the formatter never puts one there.
- **Anywhere the program would read differently afterwards.** Every break is made only where the tree stays the same (§1). Where several items share a line, separated by `;`, only the last of them is broken.

A line with nothing left to break stays long, and the formatter does not report it.

### 9.4 How a line is broken

The formatter breaks the **outermost** structure of a too-long line first, and stops as soon as every line fits. A line that holds a construct §15 spreads is broken in the same way, and breaking stops once that construct is spread as well (§15.3). It uses the contents shape wherever there is something to open, and carries a line on at two levels only where nothing can be opened. The brackets it opens take a trailing comma where §14 calls for one. Each kind of structure breaks in one shape, except that a lambda or a bare `match` that is a binding's value, a call's last argument or a record's last field first tries keeping its head on its line (rules 1 and 2), and a value, body or branch that begins with an opening bracket keeps it on its line wherever its brackets open (rules 1 and 4):

1. **A binding, declaration, assignment, arm or lambda.** The value goes beneath its `=`, or the body beneath its `=>`, one level in (§5). An assignment is laid out as a binding is: what §9.4 says of a binding and its `=` holds for an assignment and its `:=`. A value that is a lambda or a bare `match` stays on its `=`'s line, and only the lambda's body goes beneath its `=>`, where a bare `match`'s arms always are. Only where that line, ending with the `=>` or with `match`, is still too long does the value go beneath the `=` instead, and its body is then moved beneath the `=>` only if that line is too long in turn. A value or body that begins with an opening bracket, `(`, `[` or `{`, goes beneath its `=` or `=>` only where, once there, the brackets it begins with stay closed. Where they would open, it stays on the line of its `=` or `=>`, and they open there instead: the opening bracket ends that line, and the closing bracket begins a line at that line's indentation, followed by the rest of the value (rule 2). So the formatter never leaves a value's opening bracket alone on the line beneath its `=` or `=>`. Any other value ends the same whether the author began it on the header line or beneath it. A value that begins with an opening bracket and that the author began beneath its `=` stays there, brackets and all, since the formatter never joins lines (§1). A header that is itself too long, before its `=`, opens its parameter brackets. A lambda that is a call's last argument, or the value of a record's last field, keeps its head on the line where the brackets open (rule 2). Any other lambda passed as an argument sits inside the call's brackets, which are outside it and so open first.
2. **Brackets.** Their contents go one item per line, and the closing bracket begins a line of its own at the indentation of the opening bracket's line, keeping after it whatever followed it, as in `).gcd(s)`. A `<…>` list is never opened here (§5.2). Three kinds of brackets take a shape of their own:
    - **Brackets whose only item is a vector literal, a record or a tuple** open and close with it, as in `Map.fromVector([` … `])` and `Regex({` … `})`. The opening brackets share a line, and so do the closing brackets. The inner brackets' contents break as this rule says for them, one level in (§5.2).
    - **A call whose last argument is a lambda or a bare `match`**, or a record whose last field's value is one, keeps everything before the lambda's body on the line where its brackets open. Only the body goes beneath the `=>`, one level in (§5.3), where a bare `match`'s arms always are, and the closing bracket takes a line of its own. Where the body stays on the `=>`'s line instead, because the brackets it begins with open there (rule 1), the closing bracket of the call or record follows the body's on its line, as in `))`. Only where that line, ending with the `=>` or with `match`, is still too long do the brackets open one item per line instead, with the lambda's head, or `match`, beginning the last of them, and the body is then moved beneath the `=>` only if that line is too long in turn (rule 1). A record that is a call's only item takes this shape inside the first shape, as in `Seq({pull = () =>`.
    - **Brackets whose items are all literals, or tuples of literals,** open as other brackets do, and their contents are filled: each line holds as many items as fit, and at least one, and a line breaks only after a comma. A literal here is a numeric literal (Lexer §5), with or without a leading `-`, or a string with no interpolation hole that ends on the line where it begins. A tuple counts only when every item in it is a literal, so a tuple of tuples does not, nor does `()`. Literals and such tuples may be mixed.

    A line that holds several items of open brackets (§5.2), whose opening bracket is on an earlier line, is broken between those items, after their commas, before anything inside them breaks: one item to a line, or filled where the brackets are filled. The lines around it stay as they are, since the formatter never joins lines (§1), so a filled list is not filled again from its start.
3. **A chain** of two or more links, where each link is a dot call or a `|>` stage, takes Method Syntax §2.1's form. The receiver ends its line, and every link takes a line of its own. Where the receiver begins its line, as it does once a value is beneath its `=`, the links sit at the receiver's level; otherwise they are carried on, two levels in (§5.1). Every link is broken, or none. A chain breaks before the brackets inside its links do. A dot after an uppercase name is a module qualifier and never breaks; nor does a field path such as `order.customer.name`. A single link is not a chain, and its brackets open instead.
4. **A conditional** takes Operators §11.3's multiline shape. `then` stays on the condition's line, each branch goes on a line of its own one level in (§5.3), and `else` takes its item's level (§5.1), which is under `if` wherever `if` begins the line, as it does once a value is beneath its `=`. An `else` and its `if` stay on one line. A branch that begins with an opening bracket stays on the line of its `then` or `else` wherever its brackets would open beneath it, as a value does after its `=` (rule 1): they open there, and the closing bracket begins a line at that line's indentation, with any `else` on the line after it. Every branch of the conditional is broken, or none. A condition still too long once the branches are beneath it breaks as a head does (rule 7), and `then` ends its last line.
5. **An operator.** An expression whose outermost structure is an operator has nothing to open. It is carried on at two levels, broken before each of its loosest operators, so that each carried-on line begins with an operator and holds one operand (§9.5). An operator the author wrote at the end of a line is not broken before: it stays where it is (§9.5).
6. **A loop** whose body is on its head's line puts the body beneath `do`, one level in (§5.3), as an arm's body goes beneath its `=>`.
7. **A head**, the text from its keyword to its closing word (Lexer & Layout §2.4), breaks only once nothing else on its line is left to break: a value beneath its `=`, a body beneath its `=>` or `do`, and a conditional's branches beneath it. It then breaks as any expression does, by rules 2, 3 and 5: its brackets open, its chain breaks, or its operator is carried on two levels in from the head's first line. Its closing word ends its last line (§9.3), and its block stays one level in (§5.3).

So in `let x = if c then f(a, b) else g(c)`, the value goes beneath the `=` first, then the conditional takes its shape, and only then, if a branch is still too long, do its brackets open. An assignment such as `best := if c then f(a, b) else g(c)` breaks the same way, its value going beneath the `:=` first.

With the limit at 40, for example:

```
let names = people.map(person => person.name)
let selected = numbers.filter(number => number > 3).take(5)
```

becomes

```
let names =
    people.map(person => person.name)
let selected =
    numbers
    .filter(number => number > 3)
    .take(5)
```

The first line fits once its value is beneath the `=`. The second still does not fit there, and its chain breaks.

Brackets break the same way, with the limit at 50:

```
let codes = Map.fromVector([("en", "English"), ("fr", "French"), ("de", "German"), ("es", "Spanish")])
let total = Vector.fold(values, 0, (sum, value) => sum + value * weight)
```

becomes

```
let codes =
    Map.fromVector([
        ("en", "English"), ("fr", "French"),
        ("de", "German"), ("es", "Spanish"),
    ])
let total =
    Vector.fold(values, 0, (sum, value) =>
        sum + value * weight
    )
```

Each value goes beneath its `=` first, since the binding is the outermost structure, and is still too long there. The only item of `Map.fromVector` is a vector literal, so the two open together, and the vector holds only tuples of literals, so it is filled. The vector's closing bracket begins its line, so its last item takes a comma (§14). The lambda is `fold`'s last argument, so only its body moves, and since its body is a block, `fold`'s brackets take no comma. Had `Vector.fold(values, 0, (sum, value) =>` still been too long, the call's brackets would have opened one argument per line.

A line already inside open brackets breaks between its items, and the lines around it stay as they are. With the limit at 50, the third line of

```
let primes =
    Set.fromVector([
        2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47,
        53, 59,
    ])
```

is filled again by itself:

```
let primes =
    Set.fromVector([
        2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31,
        37, 41, 43, 47,
        53, 59,
    ])
```

A head breaks the same way, with its closing word kept at the end. With the limit at 40,

```
while remaining > 0 and not cancelled(job) do
    remaining := step(remaining)
```

becomes

```
while remaining > 0
        and not cancelled(job) do
    remaining := step(remaining)
```

The head's expression is an operator, so it is carried on at its loosest operator, `and`, and `do` ends the carried-on line.

A value that begins with its brackets keeps them on its `=`'s line wherever they open. With the limit at 50,

```
let corners = [Point(0, 0), Point(width, 0), Point(width, height)]
let greeting = ("Good morning", nameOf(person), today)
```

becomes

```
let corners = [
    Point(0, 0),
    Point(width, 0),
    Point(width, height),
]
let greeting =
    ("Good morning", nameOf(person), today)
```

Beneath its `=`, the vector would still be too long and its brackets would open, so it stays on the `=`'s line and they open there. The tuple fits on a line of its own, so it goes beneath its `=` as any other value does.

### 9.5 Which side of the operator

Where the formatter breaks a line at an operator, the carried-on line begins with the operator. With the limit at 30, for example:

```
let total =
    first * second + third * fourth + fifth
```

becomes

```
let total =
    first * second
            + third * fourth
            + fifth
```

The formatter never moves an operator across a line end. An operator the author wrote at the end of a line stays there, on the line with the operand before it, since the formatter keeps every line break the author wrote (§1):

```
let total =
    first * second +
            third * fourth
```

Both are legal. A line indented deeper than its item continues the item whatever token begins it (Lexer & Layout §2).

## 10. Rejected alternatives (do not re-litigate)

1. **Re-laying every line to fit a width.** Prettier, for example, prints an expression on one line whenever it fits. Hexagon is layout-sensitive, so every break a re-layer chooses is a place it could change meaning. Re-laying would also rewrite much of a document on its first run. The formatter keeps the author's breaks, as swift-format does by default (`respectsExistingLineBreaks`), and gofmt has no line length limit at all.
2. **Joining lines that would fit on one.** This applies to a multiline conditional too (Operators §11.3). Joining would let a short Maximum line length and a long one rewrite the same lines back and forth (§3.3).
3. **A limit on by default.** Maximum line length starts at Unlimited, as every option starts off (§3.3). The standard library's 100 is a house setting.
4. **An option where one setting adds what another removes**, such as padding inside record braces as a choice. It fails §3.3's second test.
5. **Alignment the formatter makes.** gofmt lines up the columns of a struct's fields and comments. Hexagon's formatter never creates alignment. It only keeps the author's, while Collapse extra spaces is off.
6. **Collapsing the author's alignment by default.** A developer who aligns columns would lose them on the first run. Collapse extra spaces is an option, and it starts off.
7. **Token changes in version one**, other than the trailing comma (§14), added or removed after a block, and a union's leading bar (§16). These include dropping `x: _`, whose author may be on the way to `x: _: Num`, removing parentheses and moving imports. A formatter that changes whitespace, and adds or removes only commas and bars that change no tree, carries the strongest check there is: identical tokens apart from those commas and bars (§1). Each other token change needs its own ruling.
8. **A continuation indented one level, or aligned under an opening bracket.** One level makes a carried-on line look like the first line of a block. Alignment under a bracket moves whenever a name is renamed. Two levels has precedent. Google's Java style indents a block +2 and a continuation at least +4, and Python's PEP 8 adds a level where a continuation would otherwise line up with the body.
9. **A spaced colon, or a spacing that depends on the colon's role.** One alternative wrote a binding's annotation tight but an ascription and a constrained hole's constraint colon spaced, as in `(e : Type)` and `x: _ : Num`. Another spaced every colon, as in `x : Int`. One spacing is simpler to read and to teach. Tight suits a language whose parameters are bracketed, as Gleam's are (§7.1).
10. **Record braces written with a space inside**, as in `{ x = 1 }`, while every other bracket is tight. With none, nothing stands inside any bracket's edges, and a record's braces agree with a hole's (§7.1, §7.4). The colleagues that pad a record's braces do so for reasons Hexagon does not have. Elm breaks a record with a comma leading each line, and the space after `{` lines the first field up with the fields after each `, `; Hexagon ends each line with its comma (§14) and lines nothing up. OCaml and F# have openers that begin with a bracket, such as `[|`, `{<` and `{|`, and ocamlformat and Fantomas pad every bracket, a list's included, which keeps them clear of those; Hexagon's one such opener is the comment's `{-`, and no record begins with `-` (Lexer & Layout §1). In Rust, JavaScript and C#, braces are also blocks, and a record is spaced as a block is; Hexagon's braces are never a block (Lexer & Layout §1), and Go, whose braces are blocks as well, writes its literals tight, as `Point{X: 1}`. Haskell writes a record tight on one line, and so does `show` (Products §3.4).
11. **`//` spaced as `1 // 2`.** `//` sits at level 5, tighter than `*` and `/` (Operators §3), so `half * 1//2` reads as it groups. Julia writes a fraction tight, as `2//3` (Operators §6.4).
12. **Formatting part of a declaration.** Re-indenting part of a block can change what it means. Format selection widens to whole top-level items, as Prettier's range formatting widens to whole statements.
13. **Formatting a document with a syntax error, as far as it parses.** Without a tree, the formatter cannot show that the program is unchanged (§1).
14. **Formatting on save, on paste, or in the Playground by default.** Nothing formats unasked (§2.4).
15. **Blank lines added before something**, such as before a doc comment, a multi-line declaration or a module's closer. Also, a fixed number of blank lines between declarations, and recognising a run of aliases by its shape. Each would be the formatter guessing at the author's grouping. Blank lines are added only after something (§6.2).
16. **Counting physical lines to tell a one-liner from a multi-line declaration.** Maximum line length would then change a document's grouping (§6.3).
17. **A doc comment making its declaration multi-line.** For the formatter it does not (§6.3). House text adds only a blank line on either side of a documented function (`notes/canonical-formatting-and-naming.md` H3).
18. **A closing word at the start of a line**, as OCaml writes `then` beneath its condition. It is legal (Lexer & Layout §2.4), and an author's stays where it is written (§1), but the formatter ends a head's last line with its closing word, where it shows that the block follows (§9.3).
19. **Brackets set apart from their only item**, as in `Map.fromVector(` / `[` … `]` / `)`. The outer brackets show nothing that the inner ones do not, so the two extra lines and the extra level carry no meaning (§9.4 rule 2).
20. **Opening a call's brackets before its last argument's lambda.** It gives the lambda's head a line of its own and its body a second level. A lambda's head stays on the call's line, as JavaScript formatted by Prettier keeps a last-argument function's, and as a Swift trailing closure stands after its call (§9.4 rule 2).
21. **Filling every list, or none.** Filled expressions are hard to pick out, and an edit to one moves the line breaks of all those after it. Filling none turns a table of a hundred short values into a hundred lines. In a list of literals, which item begins a line carries no meaning, so filling costs nothing there (§9.4 rule 2).
22. **An assignment's value carried on at two levels**, as the rest of a line is (§5.1). An assignment's value is what it assigns, as a binding's value is what it binds, so the two are laid out alike: the value goes beneath the `:=`, one level in, where it is a block (Lexer & Layout §2.1; §9.4 rule 1).
23. **Lists spread over lines without a trailing comma**, as in the ML family: Elm and Haskell allow none, and put the comma at the start of each line instead. With a comma after every item, adding, removing or moving an item changes only its own lines. Go requires the comma in such a list, and Prettier, rustfmt and Black add it (§14).
24. **Adding the comma only to brackets the formatter opens itself.** A formatted document would then hold both spellings, depending on who broke each line (§14).
25. **Removing a trailing comma**, from a one-line list or while Leave trailing commas as written is on. One setting would then remove what another adds, which fails §3.3's second test. A comma on a one-line list is the author's to keep or remove (§13).
26. **A comma that ends a block**, so that a lambda whose body is beneath its `=>` could take its comma on the body's last line. The layout pass would have to close blocks at a comma, and a comma also separates the items of a `<…>` list, which the layout pass does not track as brackets (Lexer & Layout §2.2, §3.2), so it would close blocks that are still open. A list whose last item ends in a block takes no comma instead (§14).
27. **Leaving an interpolation hole as written.** A hole holds code, and the spaces between its tokens are no part of the string's value, so spacing them changes nothing the program computes. Left as written, `${10 // 12 == 5 // 6}` would disagree with the same code written outside a string, `10//12 == 5//6`. Prettier spaces the code inside a JavaScript template literal's `${…}` in the same way, and keeps it on its line (§7.4).
28. **A space inside a hole's braces**, as in `${ total }`. A hole's braces enclose one expression, as parentheses do, and Hexagon writes every bracket tight (§7.1). Swift's hole is a pair of parentheses, `\(total)`. Prettier spaces a JavaScript object's braces and writes a template literal's hole tight, side by side as `${{ x: 1 }.x}` (§7.4).
29. **Leaving it to the author whether a construct that fits is spread**, as "a genuinely short conditional stays on one line" did. Whoever wrote each line decided what "short" meant, so one file held the same construct in two shapes. Each kind of construct has exactly one rule (§15.1).
30. **A width limit that is a share of Maximum line length**, such as 60 percent of it. A width limit describes how much a reader takes in at once, not the width of a window. rustfmt's limits, which its documentation calls ratios, stay fixed at every line length of 100 or less in its source. Where Maximum line length is less than a width limit, the line limit is reached first (§15.2).
31. **Measuring a width limit on the whole line**, indentation and the rest of the line included. The same conditional would then be one line at the left margin and spread inside a nested block (§15.2).
32. **Counting items instead of width**, such as spreading a record of three or more fields. Width tracks what reads as dense more closely, and one unit for every kind is simpler (§15.2).
33. **A width limit for vectors, tuples, one-argument calls, arithmetic and function headers.** A vector of short literals reads as a table at any width, and a dense tuple is dense because of a call inside it, which its own width limit spreads. A call with one argument, spread, only moves its argument down a line and adds a line holding `)`. Two sibling functions whose headers are 77 and 86 wide would be laid out unalike for the sake of nine characters (§15.1).
34. **Never putting a conditional used for its effect on one line**, as rustfmt never puts an `if` without `else` on one line. An `if` without `else` is an `if` with an implied `else ()` (Operators §11.2), and OCaml writes `if c then x := y` on one line. A loop with a one-line body takes a width limit in the same way. Only nesting is never on one line (§15.1).
35. **A width limit for nested conditionals**, so that `if a then b else if c then d else e` stays on one line when short. Nesting is where width is the wrong measure: the reader must find which `else` belongs to which `if` (§15.1).
36. **A tighter width limit for a conditional inside an argument, a field or an index.** The call's own width limit already spreads most of these, since the conditional makes the argument list wide, and a width limit that depends on the seat would be a second number for one kind (§15.1).
37. **Leaving a multi-line union's first bar to the author.** A formatted document would hold both spellings, `Shape` and `| Shape`, beneath the same kind of `=`, as it would hold both spellings of a list if only some had their trailing comma (item 24). Unions §2 already gives every alternative of a multi-line union its bar (§16).
38. **An option to leave a union's bars as written**, as Leave trailing commas as written does for commas. The bar-led spelling is the one Unions §2 records for a multi-line union, and for any formatter, so there is no second house to serve (§16).
39. **A bar only where a union has two or more alternatives.** `union Id =` with `Wrap(Int)` beneath it would then be spelled unlike the same union with a second alternative, and adding that alternative would change the first one's line too. The bar follows where the alternatives stand, not how many there are (§16).
40. **A value's opening bracket alone on the line beneath its `=`**, with the value's contents a further level in, as in `let reservation =` with a lone `{` beneath it. The line holds nothing but the bracket, and it lays a record value out unlike a record declaration, which keeps `record Flags = {` on one line (§15.3). Rust, Go, Swift, TypeScript and Gleam open such a value on its `=`'s line. A value that begins otherwise, such as `Map.fromVector([`, still goes beneath its `=`, since its first line holds more than a bracket (§9.4 rule 1).
41. **A closing bracket at the end of its last item's line**, as Lisp writes it, to match the opening bracket kept on its `=`'s line. The last item could then take no trailing comma (§14), adding an item would change the line above it, and nothing would show, at the indentation where the value began, where it ends. The opening bracket has a line to join, the one that introduces its value, and the closing bracket has none (§5.2, §9.4 rule 1).

## 11. Edit notes to existing specs

Applied in this change:

- **Ascription:** every colon in its examples and its report is written tight: `(e: T)`, `(e: _: Num)`, `(42: Int)`. §3.2 and §9 item 6 say that the author writes the degenerate `(e: _)` as `(e)`, and that a formatter rule to drop it waits for its own ruling (§13 here).
- **`decisions-ml-dialect-annotations-2026-08.md`:** §4.4's style paragraph writes the constraint colon tight, `x: _: Num`, and every constrained hole and ascription in the document is respelt to match. Its header, §4.4, §5.2 and §9 say the author omits the degenerate hole, as Ascription does.
- **Functions §4.1 and §4.3, Numeric Literals §4 and §6, Effects §2.6:** constrained holes and ascriptions are written tight, and Functions §4.1 says the author omits the degenerate hole.
- **Operators §11.3:** the formatter never collapses the multiline conditional (§1 here).
- **`notes/canonical-formatting-and-naming.md`:** S11 and S12 are respelt and point here, F1 points to §5, and a new §5 records the house settings.
- **`notes/canonical-formatting-plan.md` §5:** the same correction as Operators §11.3.
- **README and Language:** the ownership map, the documentation reading set and the lexical-structure lists name this chapter.

On next touch:

- **Comments §4**, whose "the formatter may frown" sentence points to §8.2 here.
- **Modules §3, Pattern Declarations §3.3, Pattern Matching §6.5 and Constraints §5.4** speak of the formatter moving imports, removing redundant parentheses and deleting a bare binder. Each is a token-level rule awaiting its own ruling (§13).

The compiler's two reports that spell an ascription for the author, Ascription §5's and Numeric Literals §6's, follow the tight colon in #1569.

Applied with the closing words (#1573): **Lexer & Layout §2** lists `then` beside `else` and `catch` as a clause that continues the preceding item at its item's column.

Applied with the assignment's block (#1590): **Lexer & Layout §2.1** lists a line ending in `:=` among the block heads, and **Statements §6.3 and Operators §12** say that the value beneath it is a block.

Applied with the trailing comma (#1594): **Lexer & Layout §7** says that every list in brackets may end with a comma, and gives its limits, with their reports in §5. **Products §3.1** and **Collections Part 3 §2** point to it. **`notes/canonical-formatting-and-naming.md`** gains H8, and its examples carry the comma.

Applied with the width limits (#1602): **Operators §11.3** and **`notes/canonical-formatting-plan.md` §5** say that a conditional stays on one line up to its width limit of 60, and that an `else if` chain never does. **`notes/canonical-formatting-and-naming.md`** rewords F3 and gains H9, which restates §15.1's table and adds the half the formatter does not do. **Unions §2** says that Format document writes the leading bar of a union whose alternatives stand one to a line (§16 here).

Applied with tight brackets (#PRNUM): **Operators §11.3** says that a branch that begins with brackets spread over lines opens them on its `then` or `else` line. **Lexer, Products, Pattern Matching, FFI Part 1 and Statements** quote their reports with tight braces. **`notes/canonical-formatting-and-naming.md`** rewords H5 and H9 and gains H11, which says where house text puts a value's brackets.

## 12. Conformance

An implementation of the formatter (#1562) must meet these conditions.

1. **It checks the three guarantees of §1 on every run:** identical tokens, those inside interpolation holes included, comments and string text, apart from the trailing commas and leading bars it adds and the trailing commas it removes (§14, §16); an identical tree; and a second run that changes nothing. If any check fails, it refuses the document, returns no edits, and says that formatting failed (§2.3).
2. **Settings never fight.** Its tests show §3.3's second test for the four options, and that §6.3's grouping is the same under every setting of the first three.
3. **Mangled input comes back canonical.** A document whose whitespace has been scrambled, without changing its meaning, formats to the same result as the original.
4. **The standard library is canonical.** Every standard-library file is unchanged by Format document at Maximum line length 100, with Collapse extra spaces on, Leave trailing commas as written off and Apply width limits on, the house settings (#1563, #1602).
5. **Format selection agrees with Format document.** It is computed from the whole-document result and returns only the edits inside its region (§2.2).
6. **It can name every construct in the wrong shape.** A check reports each construct on one line that §15 spreads, and each construct that house text writes on one line but that is spread (`notes/canonical-formatting-and-naming.md` H9, with the exceptions it lists). A test runs it over the standard library, the Playground's tutorials and the Book's samples (#1602).

The language server serves both commands (#1564), and the VS Code extension relies on it (#1565). The Playground offers both commands in its editor, and the four options in its Settings… window (#1566). A `hexc format` command with a check mode belongs to version one with the rest of the command line, and calls the same core. The Book's code samples are written in canonical layout. The Book does not describe formatting.

## 13. What the formatter leaves to the author

The formatter deliberately leaves these choices to the author. The house style for the standard library and the Book is written in `notes/canonical-formatting-and-naming.md`.

- **Where lines break**, except in a line longer than the Maximum line length, and in a construct that Apply width limits spreads (§15). This covers which line a keyword stands on, such as `match x with` on the header line or on a line of its own. It also covers whether a construct within its width limit is written on one line or several, and whether brackets are open. While Apply width limits is off, it covers a construct over its width limit too. It covers whether a value stands on its `=`'s line or beneath it, so an opening bracket the author wrote alone beneath an `=` stays there (§9.4 rule 1). House text decides these by its table and its rules (`notes/canonical-formatting-and-naming.md` H5, H9, H11).
- **Grouping by blank lines**, beyond the three places the formatter adds one (§6.2) and the cap of one.
- **Extra spaces that align columns**, while Collapse extra spaces is off, and a wide gap before a trailing comment.
- **The tokens:** parentheses, a leading `|` on any union §16 does not cover, `;` or a new line, a degenerate `x: _`, the fused `fun f(…) = …` or a `fun` block, and the order and place of imports. Each token-level rule that other chapters name for "the formatter" waits for a ruling of its own. Until then, the canonical spelling is the author's to write.
- **A trailing comma that §14 does not add**: one on a list whose closing bracket does not begin a line, such as a one-line list, and every one while Leave trailing commas as written is on. The formatter removes no comma but those §14 removes.
- **Comments**: what they say, which line they are on, and the shape of a doc comment.
- **Strings**: their text, and the line breaks, indentation and line-end spaces of a hole written over several lines (§7.4).
- **Which side of an operator the author breaks a line on.** An operator the author writes at the end of a line stays there. Only the breaks the formatter makes put the operator first (§9.5).

## 14. Trailing commas

Every list in brackets may end with a comma after its last item (Lexer & Layout §7). Unless Leave trailing commas as written is on (§3.4), Format document writes one after the last item of every list in open brackets, whose closing bracket begins a line (§5.2), whether the author opened them or the formatter did (§9.4). Go has the same rule, and there such a list must end with a comma. It holds for brackets with one item to a line and for filled brackets alike:

```
let corners = [
    {x = 0, y = 0},
    {x = 1, y = 1},
]

let primes = [
    2, 3, 5, 7, 11, 13,
    17, 19, 23, 29,
]
```

A `<…>` list takes it too, where the author has opened one (§5.2):

```
export let same<
    a: Eq,
    b: Eq,
>(left: (a, b), right: (a, b)): Bool = left == right
```

The comma goes directly after the last item, ahead of any comment on its line. A list that already ends with a comma gains no second one. The comma is one of the two tokens the formatter adds, beside a union's leading bar (§16), and it changes no tree (§1). A line's length counts it (§9.2). Format selection adds the commas that Format document adds within its region (§2.2).

No comma is added in three cases:

- **Where the closing bracket does not begin a line.** A list on one line takes none, and neither do brackets carried on, whose closing bracket follows their last item, as in `describe(firstName,` with `lastName)` beneath it (§5.2). Where brackets open and close with their only item (§5.2; §9.4 rule 2), the inner closing bracket begins its line and takes the comma, and the outer one follows it on that line and takes none:

    ```
    let piece =
        Piece({
            expr = Empty,
            kind = Setting(flags),
        })
    ```

- **After an item that ends in a block**, such as a lambda whose body is beneath its `=>`, or a `match` whose arms follow it. A comma at the end of the block's last line would be read inside the block (Lexer & Layout §7). So a call whose last argument is such a lambda (§9.4 rule 2) ends without one:

    ```
    let total =
        Vector.fold(values, 0, (sum, value) =>
            sum + value * weight
        )
    ```

- **Inside brackets that hold no list**: parentheses that group one item, such as one expression written on a line of its own between `(` and `)`, and the brackets of an index or a slice. With a comma the parentheses would hold a one-item tuple, which Hexagon does not have, and an index holds one expression (Lexer & Layout §7).

The formatter removes a trailing comma in one place only: after a last item that a break it makes leaves ending in a block, such as a conditional, a loop or a lambda's body spread inside brackets (§9.4, §15.3). A comma at the end of the block's last line would be read inside the block, and the closing bracket ends the block and the list together (Lexer & Layout §7), so the list is written as a list whose last item ends in a block is. With Apply width limits on,

```
chunks.append(
    if code >= 65 and code <= 90 then String.toLower(point) else point,
)
```

becomes

```
chunks.append(
    if code >= 65 and code <= 90 then
        String.toLower(point)
    else
        point
)
```

It does so under every setting, since the comma has nowhere else to stand, and none adds it back. A comma between two items, after one that a break leaves ending in a block, separates them and cannot go: it begins a line of its own, at the brackets' indentation (§5.1), the one place Lexer & Layout §7 leaves it. Every other trailing comma stays: one on a list whose closing bracket does not begin a line, and every one while Leave trailing commas as written is on (§13).

## 15. Wide constructs

A construct that fits on its line can still be too dense to read there. Each kind of construct has one rule for whether it may stand on one line: a width limit, or never. With Apply width limits on (§3.5), Format document spreads a construct written on one line that breaks its rule. The other half of the rule, writing a construct within its width limit on one line, is house style, since the formatter never joins lines (§1, §15.4).

### 15.1 The kinds

| Kind | On one line | Spread, it takes |
|---|---|---|
| A conditional, with or without `else` | up to 60 | each branch on a line of its own (§9.4 rule 4) |
| A loop with a one-line body | up to 60 | its body beneath `do` (§9.4 rule 6) |
| A chain of two or more links, dot calls or `\|>` stages | up to 60 | each link on a line of its own (§9.4 rule 3) |
| The arguments of a call or constructor, two or more | up to 60 | its brackets open (§9.4 rule 2) |
| A record literal | up to 60 | its braces open (§9.4 rules 1 and 2) |
| A record declaration | up to 60 | its braces open where they stand, one field to a line, its value kept on its `=`'s line (§9.4 rules 1 and 2) |
| A union declaration | up to 60 | its alternatives beneath its `=`, one to a line, each led by `|` (§15.3, §16) |
| A lambda | up to 60 | its body beneath its `=>` (§9.4 rule 1) |
| A match arm | up to 80 | its body beneath its `=>` (§9.4 rule 1) |
| An `and` or `or` expression | up to 80 | carried on, each of its loosest operators beginning a line (§9.4 rule 5) |
| An `else if` chain; a conditional that holds another conditional; a loop whose body is a loop or a conditional | never | each branch on a line of its own, in every link of a chain; a loop's body beneath `do` (§9.4 rules 4 and 6) |

Every other construct has no width limit of its own, and the Maximum line length alone decides it: a vector, a tuple, a call or constructor with one argument, arithmetic and `++`, a function header, and any construct this table does not name.

Each construct is held to its own row, wherever it stands. So an arm whose body is a conditional stays on one line only while the arm is within 80 and the conditional within 60. A conditional holds another wherever the other stands inside it, its condition included. Every conditional in an `else if` chain is part of the chain, so none of its links stands on one line, and `else` keeps its `if` beside it on the line (§9.4 rule 4). So `if a then 1 else if b then 2 else 3`, though only 35 wide, is spread.

### 15.2 What a width limit measures

A width limit counts Unicode code points, as a line's length does (§9.2). It measures the construct's own text as it would read on one line, from its first token to its last. That text is spaced as §7 spaces it with Collapse extra spaces on, a comment inside it counts as written, and a trailing comma does not count, since a list on one line takes none (§14). The construct's indentation, and whatever else shares its line, do not count. So the same construct takes the same shape at any depth.

The arguments of a call or constructor are measured alone, from the first token after its `(` to the last before its `)`. The name in front is not what makes a call dense. Every other kind is measured whole: a conditional from its `if`, a loop from its `for` or `while`, a chain from the first token of its receiver, a lambda from its parameters, an arm from its pattern, and a declaration from its first token to its last, `export` and its `derives` clause included.

The width limits are fixed numbers. They do not change with the Maximum line length: where that length is less than a width limit, the line limit is reached first. A construct within its width limit on a line longer than the limit is broken by §9 as any such line is.

A construct stands **on one line** when its first token and its last share a line. For the arguments of a call or constructor, and for a record literal, these are its brackets, `(` and `)` or `{` and `}`. A record declaration is on one line when its braces are, and a union declaration when all its alternatives are, wherever its `=` stands. So brackets that are open (§5.2), whether one item to a line or filled (§9.4 rule 2), are not on one line.

### 15.3 What Apply width limits does

With the option on, Format document **spreads** each construct on one line (§15.2) that is wider than its width limit, or whose row says never. The line holding it is broken as §9.4 breaks a line that is too long, outermost structure first, until the construct takes the shape its row gives. So a binding's value goes beneath its `=` before a conditional in it is spread, and a lambda that is a call's last argument keeps its head on the call's line while its body goes beneath its `=>` (§9.4 rules 1 and 2). Where §9.4 tries one shape first and moves to another only where a line is still too long, as it does for a lambda's head, spreading moves on only where a line is still too long or still holds a construct that this section spreads. Each line is then looked at again (§9.1), so a construct inside the one just spread is spread in turn where its own row calls for it.

With the limit at 100, for example:

```
let label = if count > 1000 then "many thousands of items" else "only a few items"
let total = Vector.fold(values, 0, (sum, value) => sum + value * weight + correction(value))
```

becomes

```
let label =
    if count > 1000 then
        "many thousands of items"
    else
        "only a few items"
let total =
    Vector.fold(values, 0, (sum, value) =>
        sum + value * weight + correction(value)
    )
```

Both lines fit within 100. The conditional is 70 wide and `fold`'s arguments are 67, each over its width limit of 60, so each is spread, its binding's value first going beneath the `=`. The lambda is 56 wide, within its own width limit, and its body goes beneath its `=>` only because that is the shape of the call it ends.

Breaking outermost first breaks what stands around the construct as well, even where that is within its own width limit or has none, such as a call with one argument. With the limit at 100,

```
print(if total > 100 then "large enough for the yearly report" else "too small")
```

becomes

```
print(
    if total > 100 then
        "large enough for the yearly report"
    else
        "too small"
)
```

The conditional is 73 wide. The call's brackets open first, since the call is the outermost structure, and only then is the conditional spread. Its last branch is a block, so the brackets take no comma (§14).

A construct that is not on one line is left as it is, whatever its width: the option spreads only what stands on one line. So brackets the author opened stay as they are, while a record declaration with its braces closed on the line beneath its `=` is spread, its braces opening on that line, where the author put them (§9.4 rule 1). A construct in a place that §9.3 never breaks, such as a string's interpolation hole, stays on its line too.

A union declaration has no shape in §9.4, since breaking a long line never splits its alternatives (§9.3). Spread, its alternatives go beneath its `=`, one level in and one to a line, and §16 leads the first with a `|` as the others are led. Where it has two or more alternatives, the union is then multi-line, so a blank line follows it (§6.2, §6.3). With the limit at 100,

```
union Reason = Shape | Range | Cycle(firstSeen: Vector(Int)) | Other(text: String)
```

which is 82 wide, becomes

```
union Reason =
    | Shape
    | Range
    | Cycle(firstSeen: Vector(Int))
    | Other(text: String)
```

A record declaration is spread as any value that begins with its brackets is (§9.4 rule 1): its braces open where they stand, one field to a line, and its value stays on its `=`'s line, so the closing brace stands at the declaration's column. With the limit at 100,

```
record Flags = {folded: Bool, multiLine: Bool, dotAll: Bool, extended: Bool}
```

which is 76 wide, becomes

```
record Flags = {
    folded: Bool,
    multiLine: Bool,
    dotAll: Bool,
    extended: Bool,
}
```

### 15.4 What stays the author's

The formatter never puts a spread construct on one line, even one within its width limit, since it never joins lines (§1). House text makes that move by hand, and a test holds it to both halves of the table (`notes/canonical-formatting-and-naming.md` H9; §12). While Apply width limits is off, a construct over its width limit also stays as the author wrote it (§13).

## 16. A union's leading bar

Format document writes a `|` before the first alternative of a union whose alternatives stand one to a line beneath its `=`, each beginning a line of its own. What decides it is where the alternatives stand, not how many there are, so a lone alternative written beneath the `=` takes the bar too. Every alternative then begins with its `|`, as Unions §2 writes a multi-line union, so adding, removing or moving an alternative changes only its own lines:

```
union Reason =
    | Shape
    | Range
    | Cycle(firstSeen: Vector(Int))

union Id =
    | Wrap(Int)
```

The bar goes directly before the alternative's first token, with one space after it (§7.1), below any comment on the lines above. A union whose first alternative already has its bar gains no second one. The bar changes no tree, since the two spellings are one declaration (Unions §2). It is the one token the formatter adds besides the trailing comma (§14), and a line's length counts it. Format selection adds the bars that Format document adds within its region (§2.2).

No bar is added to any other union, for example:

- **A union on one line**, such as `union Tree = Leaf | Node(Tree, Int, Tree)`, or one whose alternatives share a line beneath its `=`. Unions §2 writes a one-line union without the bar.
- **A union whose alternatives are not each on a line of their own**, such as one whose first alternative stands on its `=` line, as in `union Reason = Shape` with `| Range` beneath it. A bar there would read `union Reason = | Shape`.

No option turns the bar off. The formatter never removes a bar, from a one-line union or from anywhere else (§13).
