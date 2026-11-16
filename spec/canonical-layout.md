# Hexagon Spec: Canonical Layout

**Status:** Decided (November 2026). The layout that Format document and Format selection write (#1561; the formatter's stages are gathered under #1567). Amended 2026-11-16 (#1573): a head, which ends with its closing word, may be broken, though never before that word; a loop's body goes beneath its `do` (§5.3, §7.1, §9.3, §9.4, §10, §11). Amended 2026-11-16 (#1586): brackets whose only item is bracketed open and close with it, a lambda that is a call's last argument, a record's last field or a binding's value keeps its head on its line, and brackets of literals are filled (§5.2, §9.4, §10). Amended 2026-11-16 (#1590): an assignment is laid out as a binding is, its value beneath its `:=` (§5.3, §9.4, §10, §11).
**Scope:** What the two formatting commands change and what they refuse (§1–§2); the two options and the test any later option must pass (§3); line ends (§4), indentation (§5), blank lines (§6) and spacing within a line (§7); comments (§8); how a line longer than the Maximum line length is broken (§9); what the formatter leaves to the author (§13).
**Not in scope:** Changes to tokens: removing or adding parentheses, a leading `|`, a trailing comma or a degenerate `x: _`, and moving imports. Each waits for a ruling of its own (§13). House style, which is how the standard library and the Book are written where the formatter leaves the author free: `notes/canonical-formatting-and-naming.md`. The editors' commands and settings screens, which are the implementation's (§12).
**Companions:** Lexer & Layout (blocks, the block-head inventory §2.1, the continuation tokens §2.3, heads and their closing words §2.4), Lexer §2 (line ends, tabs) and §7 (trivia), Comments §2–§4, Doc Comments §3–§4, Operators §3 and §11.3 (the conditional's shapes), Method Syntax §2.1 (the chain's shape), Unions §2, Modules §2–§3 (headers, closers, imports), Ascription §2, `notes/canonical-formatting-and-naming.md` (house style).

---

## 1. The ruling

> Format document rewrites the whitespace of a document into its canonical layout and changes nothing else. It keeps every line break the author wrote in code and never joins two lines of code. It breaks a line of code only where the Maximum line length option is set and the line is longer. Blank lines are §6's.

Three guarantees follow, and an implementation checks each of them on every run (§12):

- **The text is the same.** The tokens, every comment and every string are identical before and after, in the same order. A line end is a line boundary, not text (Lexer §2.1), so a comment or string that spans lines is the same whichever line end separates them.
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

**Maximum line length** is either Unlimited or a number of characters (§9.2). The default is Unlimited, and under Unlimited no line is ever broken. Set to a number, it breaks each longer line as §9 describes. Since the formatter never joins lines, a document formatted at one length is left alone at any greater length and at Unlimited.

### 3.2 Collapse extra spaces

**Collapse extra spaces** is either off or on. The default is off.

- **Off:** where §7 calls for one space, a wider gap the author wrote is kept, so code aligned in columns keeps its alignment.
- **On:** every gap in code where §7 calls for one space becomes exactly one space.

Either way, a missing space is added where §7 calls for one, a space is removed where §7 allows none, and the gap before a trailing comment is kept (§8.3).

### 3.3 The admission test for an option

These are the first two options, not necessarily the last. Any option must pass two tests:

1. **It starts off.** With the option at its default, the formatter writes exactly what it would write without the option.
2. **Two settings never undo each other.** Take any two settings, A and B. Once a document has been formatted under A and then under B, formatting it again under either A or B changes nothing.

Both options pass. Maximum line length only adds line breaks, and no setting removes one. Collapse extra spaces only removes spaces, and no setting adds them back.

An option where one setting adds what another removes fails the second test. Two developers with different settings would rewrite the same lines back and forth on every save. Padding inside record braces is the example: it is a rule (§7.1), not an option.

## 4. Line ends

- Every line ends with a line feed. A carriage return followed by a line feed, or a lone carriage return, becomes a line feed. Lexer §2.1 makes all three the same line boundary, and inside a multiline string each is the same `\n`, so no value changes.
- No line ends in spaces or tabs outside a string or comment. Whitespace after the last code on a line is removed. Whitespace inside a multiline string is content, and whitespace at the end of a comment is the comment's (§8.1); both stay.
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
    { x = 0, y = 0 },
    { x = 1, y = 1 }
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

A pair of `()`, `[]` or `{}` is **open** when its closing bracket begins a line. The items between open brackets sit one level in from the line holding the opening bracket, and the closing bracket sits at that line's own indentation. An item begins on a line of its own when the opening bracket or a comma ends the line before it.

When the closing bracket does not begin a line, the lines between the brackets are the rest of a line carried on, two levels in:

```
let label = describe(firstName,
        lastName)
```

Brackets whose only item is an open pair, written straight after the opening bracket and straight before the closing one, are not carried on. The lines between them are the inner pair's: its items sit one level in from the line holding both opening brackets, and the outer closing bracket follows the inner one on its line (§9.4 rule 2):

```
let piece =
    Piece({
        expr = Empty,
        kind = Setting(flags)
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

- **A line that begins inside a multiline string** is the string's content and keeps its indentation.
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

Blank lines inside a string or a comment are content, and are never touched.

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

Formatting never creates or removes a line that begins a block's second item or a union's second alternative (§9). So Maximum line length never changes which declarations are multi-line, and a document's grouping is the same under every setting.

## 7. Spacing within a line

### 7.1 The rules

These rules govern the gaps between two code tokens on the same line. They do not apply to a line's indentation (§5), to the inside of a string or comment, or to the gap before a trailing comment (§8.3). Where two rows meet, the earlier row decides.

| Where | Spacing | Written |
|---|---|---|
| Either side of a binary operator: `+` `-` `*` `/` `**` `++`, the comparisons, `and` `or` `implies` `iff`, `band` `bor` `bxor` | one space | `a + b`, `2 ** n`, `x band mask` |
| Either side of `=`, `:=`, `=>`, `\|`, `\|>` and a type arrow (`->`, `->^`, `->~`, `->!`, `>->` and the other follows arrows) | one space | `let n = 1`, `x => x`, `a ->! b` |
| `..` and `//` | no space either side | `1..n - 1`, `1//2`, `n//d` |
| `.` | no space either side | `xs.length`, `Vector.at(xs, 1)` |
| Before `,` or `;`; after `,` or `;` | none before; one after | `f(a, b)`, `let x = 1; let y = 2` |
| Before `:`; after `:` | none before; one after | `width: Float`, `(e: Type)`, `x: _: Num`, `<a: Num>` |
| Inside `{` and `}` with something between them | one space | `{ top = 1, bottom = 2 }` |
| `{}` | no space | `{}` |
| Inside `(` `)`, `[` `]` and `<` `>` | none | `f(x)`, `[1, 2]`, `Pow<a: Num>` |
| `derives` after a declaration head, and the token on either side of it | one space | `union Ping derives (Eq, Show)`, `record Pair(a, b) derives (Eq, Show)` |
| An opening bracket after a name, a closing bracket or the `>` of a binder list | none | `f(x)`, `xs[i]`, `Vector(a)`, `Show<Ping>`, `<a: Ord>(x)` |
| A binder list's `<` after a keyword | none | `fun<a: Eq>`, `honor<a: Show>` |
| A prefix sign and its operand: unary `-`, variance `+` and `-`, spread `...` | none | `-x`, `Nullable(+a)`, `[_, ...rest]` |
| A keyword and the token on either side of it | one space | `match (a, b) with`, `if ready then 1 else 2`, `f(x) then` |
| Between two names, or a binder list's `>` and a name | one space | `<a: Show> Show<Rose(a)>` |
| Any other two tokens | as the author wrote them: a gap stays a gap (§7.3), and no gap stays none | |

Colons have one spacing everywhere. Every colon is tight on its left with one space after. This holds for a binding's annotation, an ascription, a constrained hole and a binder list alike. The space before a colon carries no meaning: horizontal whitespace is trivia, not a token (Lexer §7), and no rule of the lexer or the parser reads whether a colon touches what stands before it. Hexagon writes parameters in brackets and has no application by juxtaposition. Gleam is the same in both respects, and its documentation writes `fn add(x: Int, y: Int) -> Int`.

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

Lines are broken only when Maximum line length is set to a number, and only a line longer than that number. Every other line keeps the breaks it has and gains none. A line broken in two is measured again, and each part that is still too long is broken in turn.

### 9.2 The length of a line

A line's length is the number of Unicode code points on it, from its first character to its last. Its indentation counts; its line end does not. A trailing comment and the gap before it do not count.

Code points are the measure in version one. The measure may later become display width, so that a wide character counts as two. That change is safe: since the formatter never joins lines, a document formatted under one measure is at most broken further under the other.

### 9.3 What is never broken

- **A string**, its interpolation holes included, and **a comment**.
- **A union's alternatives** are never split onto lines of their own, since that would change which declarations are multi-line (§6.3).
- **Before a closing word.** `then`, `do` and `with` end the last line of their head (Lexer & Layout §2.4), and no break is made before one. A closing word the author wrote at the start of a line stays there, since the formatter never joins lines (§1), but the formatter never puts one there.
- **Anywhere the program would read differently afterwards.** Every break is made only where the tree stays the same (§1). Where several items share a line, separated by `;`, only the last of them is broken.

A line with nothing left to break stays long, and the formatter does not report it.

### 9.4 How a line is broken

The formatter breaks the **outermost** structure of a too-long line first, and stops as soon as every line fits. It uses the contents shape wherever there is something to open, and carries a line on at two levels only where nothing can be opened. It never adds a trailing comma. Each kind of structure breaks in one shape, except that a lambda or a bare `match` that is a binding's value, a call's last argument or a record's last field first tries keeping its head on its line (rules 1 and 2):

1. **A binding, declaration, assignment, arm or lambda.** The value goes beneath its `=`, or the body beneath its `=>`, one level in (§5). An assignment is laid out as a binding is: what §9.4 says of a binding and its `=` holds for an assignment and its `:=`. A value that is a lambda or a bare `match` stays on its `=`'s line, and only the lambda's body goes beneath its `=>`, where a bare `match`'s arms always are. Only where that line, ending with the `=>` or with `match`, is still too long does the value go beneath the `=` instead, and its body is then moved beneath the `=>` only if that line is too long in turn. Any other value ends the same whether the author began it on the header line or beneath it. A header that is itself too long, before its `=`, opens its parameter brackets. A lambda that is a call's last argument, or the value of a record's last field, keeps its head on the line where the brackets open (rule 2). Any other lambda passed as an argument sits inside the call's brackets, which are outside it and so open first.
2. **Brackets.** Their contents go one item per line, and the closing bracket takes a line of its own at the indentation of the opening bracket's line. Three kinds of brackets take a shape of their own:
    - **Brackets whose only item is a vector literal, a record or a tuple** open and close with it, as in `Map.fromVector([` … `])` and `Regex({` … `})`. The opening brackets share a line, and so do the closing brackets. The inner brackets' contents break as this rule says for them, one level in (§5.2).
    - **A call whose last argument is a lambda or a bare `match`**, or a record whose last field's value is one, keeps everything before the lambda's body on the line where its brackets open. Only the body goes beneath the `=>`, one level in (§5.3), where a bare `match`'s arms always are, and the closing bracket takes a line of its own. Only where that line, ending with the `=>` or with `match`, is still too long do the brackets open one item per line instead, with the lambda's head, or `match`, beginning the last of them, and the body is then moved beneath the `=>` only if that line is too long in turn (rule 1). A record that is a call's only item takes this shape inside the first shape, as in `Seq({ pull = () =>`.
    - **Brackets whose items are all literals, or tuples of literals,** open as other brackets do, and their contents are filled: each line holds as many items as fit, and at least one, and a line breaks only after a comma. A literal here is a numeric literal (Lexer §5), with or without a leading `-`, or a string with no interpolation hole that ends on the line where it begins. A tuple counts only when every item in it is a literal, so a tuple of tuples does not, nor does `()`. Literals and such tuples may be mixed.

    A line that holds several items of open brackets (§5.2), whose opening bracket is on an earlier line, is broken between those items, after their commas, before anything inside them breaks: one item to a line, or filled where the brackets are filled. The lines around it stay as they are, since the formatter never joins lines (§1), so a filled list is not filled again from its start.
3. **A chain** of two or more links, where each link is a dot call or a `|>` stage, takes Method Syntax §2.1's form. The receiver ends its line, and every link takes a line of its own. Where the receiver begins its line, as it does once a value is beneath its `=`, the links sit at the receiver's level; otherwise they are carried on, two levels in (§5.1). Every link is broken, or none. A chain breaks before the brackets inside its links do. A dot after an uppercase name is a module qualifier and never breaks; nor does a field path such as `order.customer.name`. A single link is not a chain, and its brackets open instead.
4. **A conditional** takes Operators §11.3's multiline shape. `then` stays on the condition's line, each branch goes on a line of its own one level in (§5.3), and `else` takes its item's level (§5.1), which is under `if` wherever `if` begins the line, as it does once a value is beneath its `=`. An `else` and its `if` stay on one line. Every branch of the conditional is broken, or none. A condition still too long once the branches are beneath it breaks as a head does (rule 7), and `then` ends its last line.
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
        ("de", "German"), ("es", "Spanish")
    ])
let total =
    Vector.fold(values, 0, (sum, value) =>
        sum + value * weight
    )
```

Each value goes beneath its `=` first, since the binding is the outermost structure, and is still too long there. The only item of `Map.fromVector` is a vector literal, so the two open together, and the vector holds only tuples of literals, so it is filled. The lambda is `fold`'s last argument, so only its body moves. Had `Vector.fold(values, 0, (sum, value) =>` still been too long, the call's brackets would have opened one argument per line.

A line already inside open brackets breaks between its items, and the lines around it stay as they are. With the limit at 50, the third line of

```
let primes =
    Set.fromVector([
        2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47,
        53, 59
    ])
```

is filled again by itself:

```
let primes =
    Set.fromVector([
        2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31,
        37, 41, 43, 47,
        53, 59
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
7. **Token changes in version one.** These include dropping `x: _`, whose author may be on the way to `x: _: Num`, removing parentheses, moving imports and adding a trailing comma. A whitespace-only formatter carries the strongest check there is, identical tokens (§1), and each token change needs its own ruling.
8. **A continuation indented one level, or aligned under an opening bracket.** One level makes a carried-on line look like the first line of a block. Alignment under a bracket moves whenever a name is renamed. Two levels has precedent. Google's Java style indents a block +2 and a continuation at least +4, and Python's PEP 8 adds a level where a continuation would otherwise line up with the body.
9. **A spaced colon, or a spacing that depends on the colon's role.** One alternative wrote a binding's annotation tight but an ascription and a constrained hole's constraint colon spaced, as in `(e : Type)` and `x: _ : Num`. Another spaced every colon, as in `x : Int`. One spacing is simpler to read and to teach. Tight suits a language whose parameters are bracketed, as Gleam's are (§7.1).
10. **Record braces written tight**, as in `{x = 1}`. Elm's guide writes `{ first = "John", last = "Hobson", age = 81 }`, and ocamlformat adds a space inside a record's braces by default. The space also keeps a record clear of the comment opener `{-`.
11. **`//` spaced as `1 // 2`.** `//` sits at level 5, tighter than `*` and `/` (Operators §3), so `half * 1//2` reads as it groups. Julia writes a fraction tight, as `2//3` (Operators §6.4).
12. **Formatting part of a declaration.** Re-indenting part of a block can change what it means. Format selection widens to whole top-level items, as Prettier's range formatting widens to whole statements.
13. **Formatting a document with a syntax error, as far as it parses.** Without a tree, the formatter cannot show that the program is unchanged (§1).
14. **Formatting on save, on paste, or in the Playground by default.** Nothing formats unasked (§2.4).
15. **Blank lines added before something**, such as before a doc comment, a multi-line declaration or a module's closer. Also, a fixed number of blank lines between declarations, and recognising a run of aliases by its shape. Each would be the formatter guessing at the author's grouping. Blank lines are added only after something (§6.2).
16. **Counting physical lines to tell a one-liner from a multi-line declaration.** Maximum line length would then change a document's grouping (§6.3).
17. **A doc comment making its declaration multi-line.** For the formatter it does not (§6.3). The house style for documented functions is separate.
18. **A closing word at the start of a line**, as OCaml writes `then` beneath its condition. It is legal (Lexer & Layout §2.4), and an author's stays where it is written (§1), but the formatter ends a head's last line with its closing word, where it shows that the block follows (§9.3).
19. **Brackets set apart from their only item**, as in `Map.fromVector(` / `[` … `]` / `)`. The outer brackets show nothing that the inner ones do not, so the two extra lines and the extra level carry no meaning (§9.4 rule 2).
20. **Opening a call's brackets before its last argument's lambda.** It gives the lambda's head a line of its own and its body a second level. A lambda's head stays on the call's line, as JavaScript formatted by Prettier keeps a last-argument function's, and as a Swift trailing closure stands after its call (§9.4 rule 2).
21. **Filling every list, or none.** Filled expressions are hard to pick out, and an edit to one moves the line breaks of all those after it. Filling none turns a table of a hundred short values into a hundred lines. In a list of literals, which item begins a line carries no meaning, so filling costs nothing there (§9.4 rule 2).
22. **An assignment's value carried on at two levels**, as the rest of a line is (§5.1). An assignment's value is what it assigns, as a binding's value is what it binds, so the two are laid out alike: the value goes beneath the `:=`, one level in, where it is a block (Lexer & Layout §2.1; §9.4 rule 1).

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
- **Spec examples written before §7.1**: about 200 fractions spaced as `1 // 3` (most of them in Operators, Pattern Matching and `Rat`), and about 150 record braces written tight, as `{x = 1}`. Each is respelt when its section is next touched. The examples that show the C comment habit, such as `let y = 2 // a note`, stay as they are.

The compiler's two reports that spell an ascription for the author, Ascription §5's and Numeric Literals §6's, follow the tight colon in #1569.

Applied with the closing words (#1573): **Lexer & Layout §2** lists `then` beside `else` and `catch` as a clause that continues the preceding item at its item's column.

Applied with the assignment's block (#1590): **Lexer & Layout §2.1** lists a line ending in `:=` among the block heads, and **Statements §6.3 and Operators §12** say that the value beneath it is a block.

## 12. Conformance

An implementation of the formatter (#1562) must meet these conditions.

1. **It checks the three guarantees of §1 on every run:** identical tokens, comments and strings; an identical tree; and a second run that changes nothing. If any check fails, it refuses the document, returns no edits, and says that formatting failed (§2.3).
2. **Settings never fight.** Its tests show §3.3's second test for the two options, and that §6.3's grouping is the same under every setting.
3. **Mangled input comes back canonical.** A document whose whitespace has been scrambled, without changing its meaning, formats to the same result as the original.
4. **The standard library is canonical.** Every standard-library file is unchanged by Format document at Maximum line length 100 with Collapse extra spaces on, the house settings (#1563).
5. **Format selection agrees with Format document.** It is computed from the whole-document result and returns only the edits inside its region (§2.2).

The language server serves both commands (#1564), and the VS Code extension relies on it (#1565). The Playground offers both commands in its editor, and both options in its Settings… window (#1566). A `hexc format` command with a check mode belongs to version one with the rest of the command line, and calls the same core. The Book's code samples are written in canonical layout. The Book does not describe formatting.

## 13. What the formatter leaves to the author

The formatter deliberately leaves these choices to the author. The house style for the standard library and the Book is written in `notes/canonical-formatting-and-naming.md`.

- **Where lines break**, except in a line longer than the Maximum line length. This covers which line a keyword stands on, such as `match x with` on the header line or on a line of its own. It also covers whether a short conditional is written on one line or several, and whether brackets are open.
- **Grouping by blank lines**, beyond the three places the formatter adds one (§6.2) and the cap of one.
- **Extra spaces that align columns**, while Collapse extra spaces is off, and a wide gap before a trailing comment.
- **The tokens:** parentheses, a leading `|` on a union's first alternative, a trailing comma, `;` or a new line, a degenerate `x: _`, the fused `fun f(…) = …` or a `fun` block, and the order and place of imports. Each token-level rule that other chapters name for "the formatter" waits for a ruling of its own. Until then, the canonical spelling is the author's to write.
- **Comments**: what they say, which line they are on, and the shape of a doc comment.
- **Which side of an operator the author breaks a line on.** An operator the author writes at the end of a line stays there. Only the breaks the formatter makes put the operator first (§9.5).
