# Hexagon Language Server

The Hexagon language server: the process that exposes Hexagon language intelligence through Microsoft's Language Server Protocol (LSP).

Five slices are implemented, and a sixth has begun, over a compiler-owned analysis session: diagnostics, hover, go-to-definition and find-references; then semantic tokens, rename and completion; then quick fixes, the diagnostic-driven half of code actions, each plain one preferred and, beside a call's mark repair, one that applies every such repair in the file that is its report's only one; then documentation in hover and completion; then signature help and inlay hints. Refactorings have begun, with a pipeline and calls, a match function and its lambda, and a record's puns and its fields written out, each written as the other, a dot call written as its qualified call, arms with one body combined into one or split again, and a type alias introduced or written out. Formatting and workspace symbols are not, and the server does not announce them; a capability announced but unimplemented offers the user a command that silently does nothing.

This document states the boundary between the language server and the compiler. That boundary is the reason the server is small: every request handler converts coordinates, asks the session one question, and converts the answer back.

## Responsibility boundary

The language server owns protocol and editor integration:

- JSON-RPC transport and LSP lifecycle;
- client capability negotiation;
- opening, changing, saving, and closing documents;
- workspace and configuration events;
- request cancellation and stale-result handling;
- publishing diagnostics; and
- translating compiler service results into LSP response types.

The language server does **not** implement a second Hexagon frontend or type checker. Hexagon semantics and reusable language intelligence belong in `compiler/`, including:

- lexing, layout, parsing, resolution, and type checking;
- source positions, symbols, types, and diagnostics;
- hover information;
- go-to-definition and reference discovery;
- completion candidates;
- signature help;
- inlay hints;
- rename validation and edits;
- semantic token classification; and
- incremental analysis state.

This separation keeps the compiler usable by the command-line compiler, browser playground, tests, and future tools without introducing a dependency on LSP or Node process APIs.

Conceptually:

```text
editor or IDE
  <-> Language Server Protocol
language-server/
  <-> reusable analysis API
compiler/
```

## Structure

```text
language-server/
  README.md
  src/
    main.ts            process entry point and transport selection
    server.ts          lifecycle, capabilities, document sync, request dispatch
    workspace.ts       the file set: open buffers, disk, and precedence between them
    positions.ts       the single LSP-to-compiler coordinate boundary
    diagnostics.ts     conversion of compiler diagnostics to the protocol's shape
    semantic-tokens.ts the legend, and the protocol's relative token encoding
    code-actions.ts    quick fixes, and what shape of one a client understands
```

Tests sit beside their subject, with one exception: `workspace.concurrency.test.ts`
replaces `readdir` with one that can be parked mid-walk, so that two overlapping
rescans interleave on demand rather than by luck. It is a separate file because
that replacement would otherwise apply to every test in the workspace suite.

`npm test` runs the suite **twice**, the second time with every workspace root
reached through a symlink (`vitest.linked.config.ts`, read by
`host/src/test-roots.ts` — canonicalisation is the host's, so the helper and the
discipline live there, and `host/`'s own suite doubles the same way). A project
settles by its canonical path while a client keeps sending the folder it was
given, and where the two differ every file has two names — which on macOS is
every project under a temporary directory, and anywhere is a symlinked checkout
or `$HOME`. Whether a single run covers that is a property of the machine's
`TMPDIR`, so the second run makes the link itself.

There is no `connection.ts`: `vscode-languageserver` owns JSON-RPC framing and lifecycle, and no separate `requests/` directory, because each handler is small enough that separating them would cost more indirection than it removes. `documents.ts` is likewise absent — `TextDocuments` from the same package applies incremental changes.

Protocol adapters stay thin. A handler asks the compiler service a semantic question and converts the answer to LSP structures; when one looks like it is about to decide something about Hexagon, the decision belongs in `compiler/src/analysis` instead.

Two rules keep the process honest. Nothing may write to stdout except protocol messages — a stray `console.log` corrupts the stream and the client disconnects with no useful error — so the server logs through `connection.console`. And the host package and the workspace module are the only parts that touch a filesystem, because the compiler is deliberately free of one — `host/` answers what a program *is* on disk (the project directory, its files, where its dependencies are found), which the language server shares with every other Node-hosted tool rather than answering for itself.

## Compiler service

The language server does not invoke the batch CLI for every request. `compiler/src/analysis/session.ts` exposes `AnalysisSession`, a persistent session the server holds open:

```text
setFile(path, text)       add a file or replace its text
removeFile(path)          drop a file
configure(options)        replace the compilation options
version                   increments on every mutation
diagnostics(path)         one file's diagnostics
allDiagnostics()          every held file's, empty lists included
definitions(path, offset) where the name at this offset is declared
references(path, offset)  every occurrence of what it denotes
hover(path, offset)       what it is, its type if it has one, its documentation;
                          off a name, the type of the expression there
hoverSelection(path, start, end)
                          the type of the expression a selection names
selectionRanges(path, offsets)
                          what "Expand Selection" grows through from each offset
codeActions(path, range)  the repairs offered here, refusals included, the
                          plain ones preferred, and a file's mark repairs at once
pathOfFile(fileId)        the file a span's numeric identity names
referenceFile(path, text) gives a non-Hexagon file an identity, uncompiled
```

Positions crossing this API are UTF-16 offsets into the named file, never line and character pairs — see below.

An analysis retains every module's resolved *and* typed tree, since a code action asks the checker's own answer for a declaration and the two must be read together. Analysis is recomputed lazily and wholly: any change discards it and the next question rebuilds it. That is a decision, not a placeholder. Reanalyzing this repository's own `stdlib/` and `runtime/` after an edit measures a median of about 40ms — well inside the delay diagnostics are debounced by — so incremental reuse would buy nothing yet and would have to guess what is worth keeping before any query exists to say. A rename adds roughly one more compilation on top of whatever the session already holds, since it recompiles an edited copy and compares the two; it is not on the keystroke path.

Eleven compiler queries sit behind these answers, and each exists because no other part of the compiler still knows what it knows:

- `queries/occurrences.ts` indexes every name that denotes something together with what it denotes — values, unions, records, foreign types, and constraints. Definitions, references, rename and semantic tokens all read this one table. It reads the resolved tree for identity, the parsed tree for constraints, the source for a head name inside a wider span, and the *typed* tree for one thing only: the operation name of a dot call, which nothing earlier has decided the meaning of.
- `queries/type-occurrences.ts` gives hover its types, keyed by the same spans.
- `queries/symbol-facts.ts` records, per value symbol, how it was bound *and* whether the checker gave it a function type. The two come apart constantly: `let brighten(colour) = …` is a `let`, `extern fun` and `extern let` are both `extern`, and `let g = f` is a function with no parameter list anywhere.
- `queries/documentation.ts` indexes the doc content the parser attached (`spec/doc-comments.md` §4), under both the names a declaration introduces and the declaration's own first token — an editor holds a name, and the two are the same offset only for the forms that begin with theirs. It also answers by *position*, for the five documentable places the occurrence index has no identity for at all: an `honor` member's name is a bare string in the resolved tree, a record field is not a symbol, a `type` alias is expanded away, and no occurrence walk visits an implied type's name — a constraint's `type` member or an `honor` block's binding of it.
- `queries/semantic-tokens.ts` classifies names, and only names — see below.
- `queries/completions.ts` answers what could be written at an offset, from a scope record the resolver now keeps.
- `queries/signature-help.ts` answers which call's arguments the caret is in, and which parameter it is on — see below.
- `queries/syntax-nodes.ts` reads the parsed tree as one shape of node — what each piece of the text is (an expression, a name, a part of an expression's own syntax, or anything else) and what it holds — for the type of an expression and for "Expand Selection".
- `queries/expression-types.ts` answers the type of the expression a selection or a position names, from the checked tree by span — see below.
- `queries/type-spelling.ts` writes a type back out as source: which nominal types this module has a *name* for, and what to call each type variable.
- `queries/return-annotation.ts` finds the function a missing return type belongs to and where the colon goes.

## Semantic tokens, rename, and completion

Each of the three is shaped by one decision worth stating outright.

**Semantic tokens classify names and nothing else.** No keywords, operators,
literals, comments or punctuation, because semantic tokens *override* the
TextMate grammar wherever the two overlap, and the grammar already gets those
exactly right. Publishing a second opinion would fork one answer across two
implementations that nothing keeps in step. What a grammar cannot know is what a
*name* means — `Colour` is a union here and a record there, `size` is a function
in one module and a parameter in the next — and that is the whole of what this
adds. The consequence that matters most: when a file stops parsing this query
goes quiet and the grammar carries on colouring, where a classifier that also
owned keywords would take the file's colour down with the parse.

Because they override, every type in the legend needs a colour of its own or the
name silently changes colour the moment the server connects — falling back not to
the grammar's chosen colour but to the base theme's. The repository's own palette
therefore carries `editor.semanticTokenColorCustomizations` beside its TextMate
rules, mapping both onto the same three families, and a test fails if a legend
entry has no rule.

**Rename is verified by re-analysis, not by a scope calculation.** Working out by
hand which binder a moved name would fall under means writing Hexagon's scoping
rules a second time, in a place nothing keeps honest. Instead the edit is applied
to a copy of the project, the compiler is asked what it now sees, and the rename
is refused unless the result means exactly what the original did. Two things have
to hold: no diagnostic may appear that was not there before, which catches the
collisions Statements §5.1 makes errors in the compiler's own words; and **every
name in the project must go on denoting what it denotes now**. The second is the
one that matters, because **capture produces no diagnostic at all** — rename a
module-level `colour` to `tone` where a match arm already binds `tone` and the
arm's body quietly stops meaning what it did, with every type still checking.

That second test is asked of *every* site rather than only of the renamed name's
own mentions, and the difference is not academic. `x.op()` is companion dispatch,
which the checker settles **by name** against the operations in scope, so giving
a second function the name `tag` can move `Pale.tag()` from one function to
another — with no diagnostic, and at a site spelled neither `mark` nor `tag` but
however its own module spells it. No test confined to the renamed identity can
see that one. Denotations are compared as the *place a declaration sits* rather
than as a symbol number, since identities are minted per compilation and two runs
cannot be compared by them.

A pre-existing diagnostic that mentions the renamed name is not evidence of
breakage: it re-renders under the new spelling and would otherwise look new, so
the name is blanked out of both sides before they are counted.

A refusal is a result rather than an error: a name the project does not own, a
spelling Hexagon will not read as the same kind of name, an edit that would change
what the code means. Each reaches the user as a failed request, which is the only
channel a rename has for saying why. Spelling is checked by *lexing* the proposed
name and comparing the token to the old one's, so keywords and the
capitalized/uncapitalized split are decided by the lexer that owns them rather
than by a copy that would fall behind. The reserved `__` prefix is the one rule
that cannot be borrowed that way: it is position-dependent — the foreign side of
an FFI `as` alias is exempt — so the lexer emits the token and a *parser* selects
the message, and a proposed spelling in isolation has no position to read. A
rename target is unambiguously a Hexagon name seat, so the refusal for it is
written out here, in its own sentence, rather than inherited.

An alias is the case that makes the rule visible. `import {Shade as Other}` gives
one identity two spellings, and renaming `Shade` must rewrite the clause's
*imported* name while leaving `Other` alone — the clause goes on aliasing, it
just aliases a differently-spelled declaration. Renaming through `Other` moves
only the mentions spelled `Other`. Restricting each rename to the spelling under
the cursor is what makes both halves complete rather than partial, and the
occurrence index publishes both names of an aliasing clause so that neither is
missed.

A dot call is a third spelling of the same idea and the reason the index reads
the typed tree carefully. Dispatch is on the *declared* name, so
`Pale.brighten()` is legal in a module that imported `brighten as b`, and the
checker's typed name for that call is the local `b` while its span covers the
eight characters the source wrote. The index publishes what the source wrote.
Taking the typed name instead put an occurrence spelled `b` over the last
character of `brighten`, which every consumer then read as a name disagreeing
with its own span.

Because a dot call's operation name is in the index, it is also a mention for
find-references and a token for colouring — `Pale.brighten()` was invisible to
all three before.

**Completion is the one question the rest of the compiler cannot answer.** Every
other query reads a finished tree, where each name has already become an
identity; completion asks about names that are not there yet, so it needs the
layers a name would have been chosen from — which resolution consumes and
discards. `Resolved.Module.scopes` is the resolver writing those layers down as
it opens them: a region of source, the names it binds, and the offset each
becomes visible from, because a sequential `let` scopes over the rest of its
block rather than over all of it. Nesting is recovered by containment rather than
a parent pointer, so a reader does not replay the walk that produced it.

Two things follow from the buffer being half-typed at the moment of the request.
Telling a qualified request (`Vector.`) from an unqualified one reads source text
rather than a tree, and has to: the parser keeps `Vector.` only as a recovery
node, since a module is no value. The reading is lexical
only — which identifier precedes the dot, by `spec/lexer.md` §3's own definition
of an identifier — and nothing about meaning is read from text. And a scope
region ends at its last *token*, which is not where a user asks: pressing Enter
inside a function puts the cursor past every region that matters. A region
therefore also reaches an offset separated from its end by nothing but
whitespace, bounded by indentation: a region records whether it *is* a body,
whose own start column is where its contents sit, or a construct with a head
that sits at that column itself. A cursor in a block's column is inside the
block; a cursor in a match arm's column is writing the next arm, and the previous
arm's binder has gone.

**After a value's dot, completion reads what the dot decided.** Method Syntax
§8.4 asks for exactly the candidates the dot resolves against: a head-known
nominal's visible fields, its companion's operations and the members honored at
it, marked as members; a declared type variable's bound members; a record row's
known fields; and, for a subject the program's text does not decide, no
companion operations and no members, only the fields a bare read reaches there.
Operations and members the dot may not reach are left out: in the home module's
own file, an operation declared below the dot, in a `fun` block the dot stands
inside (§4.4), or whose own `let` the dot is in, and a member whose honor
stands below the dot outside its knot (Constraints §4.8). The list opens the
moment the dot is typed: the parser keeps a dot nothing follows yet (`q.`) with
an empty name, and the receiver is resolved and typed as it would be with a
name after it. That is a judgment the checker makes at the dot, and it cannot be recovered
afterwards from the receiver's solved type: inference can learn the type on a
later line after the dot has already been refused because the text did not
decide it (§3.5), and offering from the solved type would offer calls the
compiler then refuses. So the checker writes each dot's judgment down as it
makes it — `Typed.Module.dotSites`, keyed by the name after the dot — and
completion reads that record and nothing else. A member carries its
constraint, which the server shows beside the label; a tower member a `Nat`,
`Int` or `BigInt` owns without honoring its rung is marked as needing a
written type.

Completion does not narrow by position: a type annotation gets value names
offered alongside type names, because knowing an offset is in type position means
having a parse. Every candidate carries its kind, so a wrong-kind suggestion
costs a glance — where guessing from a broken parse would drop the right answers.
It says nothing inside a comment, which cannot hold code, and does answer inside
a string, which can hold an interpolation where names belong. Where a comment
*ends* turns on whether it was closed rather than on whether it is a block: a
closed block's span runs one past its `*)`, so a caret there is already outside
it, while an unterminated one runs to the end of the file and that last offset is
exactly where the caret sits as it is being typed. Closure is counted, since
block comments nest and a text ending in `*)` is not proof of it.

## Signature help

While a call's arguments are being written, the editor shows the callee's line
exactly as hover shows it — `map: (Vector(a), a ->! b) >-> Vector(b)` — with the
parameter the caret is on highlighted, its declared name under it, and the
declaration's documentation below that. The face is the declaration's, not this
call's instance of it, since the arguments are still being written, and the
colours stay in the arrow, where hover shows them. Where hover shows something
narrower, so does signature help: a constraint member whose colour waits on its
instance shows that instance's face once the call decides it (a member whose
contract is `->!`, called on a value whose instance is pure, reads `->`), and a
record field holding a function shows the field's type in that record.

Nothing here is computed afresh. The call is the innermost one in the checked
tree whose parentheses hold the caret; the parser keeps a call it could not
close (`add(q, ` is a call whose second argument is an error), so the moment the
user is typing is the moment there is one to read. The face is the type
occurrence hover reads at the callee's name. A receiver (`v.map(`) or a piped
value (`x |> f(`) is the call's first argument without being written inside the
parentheses, so it counts first, and the highlight lands on the parameter the
text in front of the caret fills; past that, it is the commas the lexer finds
between the arguments, so one inside a comment or a string is not one. The `(`
may stand after spaces, line breaks and comments, and an unclosed call reaches
over the same after what the parser kept, to the next token; the comments are
the ones the lexer already found.

Each parameter is named by where it stands in the label, for a client that
reads that (`labelOffsetSupport`, which VS Code and the Playground both do): in
`(Int, Int) -> Int` only the place tells the two `Int`s apart. A client that
does not gets the protocol's fallback, the parameter's text. A parameter's name
comes from the declaration where it has one — a `fun`, a `let` bound to a
lambda, an `extern fun`, a constraint member, a constructor or an exception
whose slots are named. A constructor's unnamed slot, a record field holding a
function and a pattern parameter have none to show.

Two calls get no help. A prelude member that stands behind an operator (`add`,
`concat`, `shiftLeft`, …), called by name — bare, through its constraint or on
its subject (`add(1, `, `Num.add(1, `, `1.add(`) — is kept by the checker as a
constraint call with no callee of its own, so there is no type at the name to
read, for hover either. A `|>` stage written without parentheses (`x |> f`) has
none to be inside. When more arguments are written than the callee takes, the
active parameter is past the last one, and VS Code and the Playground show no
highlight.

## The type of an expression, and Expand Selection

Select `Vector.first(["a", "b"])` and hover it, and the hover shows
`Option(String)`: the type the expression has there (OCaml's type enclosing,
Rust's range hover). The protocol's hover carries a position and nothing about
what is selected, so the server announces `experimental.hoverRange`, as
rust-analyzer does, and a hover request may carry a range where it has a
position; the VS Code extension sends the selection when the pointer is inside
one, and the Playground does the same. Off a name, a hover answers the same way
at an operator, a bracket, a comma, a literal or a keyword: hovering `*` in
`1 + 2 * 3` shows `Int`. A name keeps hover's own answer, what it denotes and
its documentation; a caret just after a `)` is on it, as a caret just after a
name is on the name.

The rule, from the piece the selection or the pointer names outward: an
expression answers with its type; a part of an expression's own syntax (a
`match` arm's `=>`, a record field's `=`, a string's text) is the expression's;
a pattern, a type annotation, a declaration or a binder answers nothing. A
selection names the smallest piece holding it, so selecting `+ 2` in
`1 + 2 * 3` names the whole sum, and one inside a record field or a `match` arm
names the expression it belongs to; a selected name answers with its type here,
the instance (`Vector.first` selected reads `Vector(String) -> Option(String)`,
where hover on `first` shows `Vector(a) -> Option(a)`).

Nothing is computed afresh. The pieces are the parsed tree's, which keeps every
piece the source wrote; the type is the checked tree's, read by span. Where the
checker folded a piece into the one around it, so that it has no type of its own
(a module qualifier, a method's `receiver.name`, a `|>` stage's call), the piece
answers nothing rather than borrowing its parent's type. Where the checker
converted the expression in place, the answer is the type the text has and the
type it became: `[1, 2]` where a `Seq(Int)` is wanted reads `Vector(Int)`,
"converted to `Seq(Int)` here" (Rust's "coerced to"). A decimal-point literal
at a `Frac` type (`1.5e1` at `Rat`) is that type's own literal, though the
checker builds it from a `BigInt`.

"Expand Selection" (`textDocument/selectionRange`) grows from the caret through
the same pieces, innermost first: a name, the expression around it, the next,
out to the declaration and the module; a pattern and a type grow through their
own kinds, and a caret in a comment starts at the comment. In a program still
being written, where the parser makes a piece over text another already has (a
`for` with no body yet), the text is the first piece's.

Each hover letters its own type from `a`, as hover on a name does, so inside
`let pair(m: b, xs: Vector(a))` the selection `xs` reads `Vector(a)`.

## Inlay hints

Inferred types are drawn faintly where they could be written, and a function's
colour in words where nothing can be written (LANGUAGE-SERVER-D3.md, ruled
(a)). Each hint is a piece of a declaration's face, at the place a header
gives that piece:

```text
let total<a: Num>(rows: Vector(Vector(a))): a = Vector.fold(rows, 0, (sum: a, row: Vector(a)) => …)
let report<a: (Num, Show)>(rows: Vector(Vector(a))): Unit =    impure; cannot fail
```

The binder list stands after the name (Functions §4.2), each parameter's type
after the parameter, the result after the parameter list. A `fun` block's
members take no list of their own, so theirs stands on the block's head,
`fun<a: (Eq, Signed)>`, one list for the block (§7.3), a block in a body
included. A variable the head declares is every member's that writes its
spelling, so an entry whose spelling another member of the block writes for its
own (two members' own `a`s, constrained or not, written anywhere in them, through
an alias too) would tie the two: that piece of the face has no place, and is left
out. A list the dev wrote takes the entries it leaves out, before its `>`
(`<a: Show, b: Show>`), since a declaration takes one list. A header has no
place for its outer arrow, since a definition's colour is inferred and never
written (Functions §4.1), so the colour is shown in hover's words (Effects §10's
gloss) at the end of the line the header ends on, only where the arrow is not
`->`. On a one-line function that more code follows on its line
(`let a() = save!("x"); let b() = 1`), the words stand at the function's own
end, so they read as its. A `let` or `var` with no written type shows its type
after its name, a constrained one its binder list there too, and one that
writes its binder list on its name shows its type after the list, where
`: type` is written (#1047). A lambda's parameters show theirs, a bare
`x => …` in the parentheses a written type needs; a `let` pattern's names show
theirs, an `as` name included. An instance's member shows its parameters and
its colour, but not its result, which the parser does not yet take there
(#1484). Not hinted: what is written (a hole, `x: _`, included), a lambda's
result, a lambda that is a binding's whole value (the binding's type already
says it), a record field's pun (`{guest}` has no place for a type), a pattern
outside a `let`, a pattern parameter, and a type with an error in it, nor a
colour whose face has one, a colour in error included (it reads as the impure
arrow, but claims nothing).

Every hint's tooltip is the whole face of the declaration it is a piece of,
lettered as the hints are and set as hover sets its first line
(`inlayHintTooltipMarkdown`, shared with the Playground): a parameter's is its
function's, a colour's is the face whose arrow its words read, a lambda's is
its type, and a `fun` block head's has each member's face, one line each.

One declaration is lettered once (`Typed.Letters`). Hover letters each name's
type from `a` on its own, so `first: a` and `second: a` stand beside
`pairUp: (a, b) -> (a, b)`; drawn side by side, as hints are, that would claim
a tie the function does not have, since a type variable written anywhere in one
declaration is one variable (Functions §4.1). The dev's own spellings come
first, from every annotation position, ascriptions and a lambda's written result
included, and a minted letter never takes one the declaration writes anywhere,
even one written only in a binder list or inside a type alias's arguments.
Through an alias nothing is paired, since an alias may reorder its arguments,
so a hint there takes a letter of its own, and is not one a dev could write
back. A local's own variables take letters the declaration does not use, and a
`fun` block's members letter together, since the head's list is every
member's (§7.3). A callback parameter
shows the face's own arrow, `() ->! a`, where hover on the parameter shows the
enclosing function's colour passing through, which a parameter type cannot
write.

A hint is never written: it carries no `textEdits`, because a written type binds
(a type variable becomes rigid, an open record row closes), so double-clicking
one does nothing. Written into the 110 programs of the book and the Playground
that have type hints, every hint but a pattern's (a pattern takes no type; its
hint is display only, as rust-analyzer's is), each program compiles to the same
faces. Where a face is a display a source cannot write, the hint shows it as
hover does: a local's captured colour, a function under a type argument read
both ways, and a knot's shared variable with no constraint, which only a
`<a>` on the block's head can declare, and which the head's hint, being the
members' faces' lists, does not show. A binding whose lambda writes its own
binder list shows the binding's true type, which the checker refuses written
beside that list today (#1483); the same issue refuses the entries the hint
adds to that list while the lambda's other parameters are unwritten.

A literal handed to `Regex.compile` shows each capturing group's number just
before its `(`, the number `Regex.group` reads it by, with the group's hover as
its tooltip (`queries/regex-groups.ts`). Which `(` opens which group is the
program's own `Regex.Syntax`'s to say (`regex.md` §5): the server never reads a
pattern for itself. Hover inside such a literal answers about its groups: on a
group, the innermost one there, its number, its name and how a match reads it;
elsewhere in the literal, its groups in order. A literal the build refused shows
its report and fixes instead.

Three settings, `hexagon.inlayHints.types`, `hexagon.inlayHints.colours` and
`hexagon.inlayHints.regexGroups`, all off until the dev turns them on, are read
from the client through `workspace/configuration`, and read again when the
client says they changed, after which the server asks it to redraw. A client
that cannot be asked shows no hint. The editor's own
`editor.inlayHints.enabled` stands above all three, so a dev who wants hints
only while holding Ctrl+Alt (Ctrl+Option on macOS) sets that, as for any
language.
Types are shown whole, since a cut type is not one a dev could write, so the
extension sets `editor.inlayHints.maximumLength` to `0` for Hexagon files (VS
Code cuts a line's hints at 43 characters otherwise), and the Playground sets
the same.

## Quick fixes

Code actions arrive in two halves, and this is the first: **every action answers
a diagnostic**. Refactorings the user asks for out of nowhere are the second half
(below). The split is not tidiness. It is what bounds the cost: an action is
computed only where the caret is on an error the user can already see, which is
rare and deliberate. A refactoring could apply on nearly every line, which is why
those are offered only when the dev asks (below).

Two sources feed the same request. A compiler diagnostic may carry its own
`fixes`, written at the point the problem was found — the lexer's redirect from
a JavaScript-spelled block comment to `(* … *)` is one, and it has existed
unreachable since #171, because nothing but a code action can offer it. Those
pass through unchanged. Everything else is computed on demand, because it needs
the whole project rather than the pass that found the fault.

**`Infer return type`** is the first computed one. Modules §4.1.1 requires an
exported function to annotate its result; the type is never in doubt, since
inference has already worked it out, so the repair is a question of writing it
down. Three things stand between the inferred type and text that means the same:

**A type has to be spelled the way *this* module can name it.** The name a type
carries is its declaration's, and `import {Colour as Shade}` leaves that name
bound to nothing here. So the module's own bindings are read for a spelling —
its declarations, the local half of each import clause, the prelude's names, and
`Alias.Name` for a type reached only through a namespace import — and where
there is none, the action is refused rather than written under a name that does
not resolve. The same reading is what catches occlusion in both directions: a
module that declares its own `Option` cannot spell the prelude's, and one that
declares its own `Unit` cannot spell the language's. This is the one place the
server's rendering deliberately differs from the hover's: `Typed.displayScheme`
renders for a reader, where `?` and `t7` are honest, and this renders for a
writer, where they are not.

**A type variable has to keep the name the signature gave it.** `Typed` records
a variable as an identity and nothing more, so the pairing is recovered by
walking each written annotation beside the type inferred for it: the `a` in
`fun listOf(value: a)` is the same variable the result is built from. Variables
the signature never wrote get a fresh letter, avoiding the ones it did.

**The edit is compiled before it is offered.** An annotation is not a comment: a
type variable written in one is rigid while that definition is checked (Functions
§4.1), so writing down what inference derived can restrict what the definition is
allowed to mean. The edited project is compiled and the result compared — the
function's type must render identically, and no diagnostic may appear anywhere
that was not there before. The case that justifies the expense produces no
diagnostic at all: `export fun m() = keep((r) => {...r})` returns the *open*
record function `{...a} -> {...a}`, and writing that as its result closes the
row, since a written face reaches no argument through a function's result
(Functions §4.3, #1066), leaving a function whose result accepts only the empty
record and an error message nowhere.

A declaration that does not typecheck is refused before any of that. Inference
does not stop at an unknown name — it yields a variable — so the repair on offer
would be `: a`, which is true of the broken text and wrong the moment the name is
fixed, at which point the rigid annotation is what gets blamed.

The signature counts as much as the body, which is easy to get wrong on the
grounds that a parameter's type is a local complaint about one word. It is not:
the checker gives that parameter a fresh variable and the result generalizes over
it. `export fun m(x: I) = [x]` — a user two keystrokes into `Int` — infers
`Vector(a)`, and writing that down turns the finished word into ``  `a` is a
declared type variable, but the body requires `Int` ``, blaming a signature the
user never wrote for a typo they have already fixed.

The exception is the errors reporting the missing signature itself — the
annotations, and the constraints that cannot be declared without them. Those are
the absence of the thing being written, so neither is a reason to refuse to write
it, and the checker marks them `incompleteSignature` rather than leaving them to
be recognised. Marking is the point: plenty of errors report at a declaration's
*name* and only these two are answered by writing a signature. `` `m` is already
bound `` reports there too and is a real reason to wait, because a rebinding
conflict leaves the body's type unresolved and the repair would again be `: a`.

The cost of asking about the whole declaration is that errors which provably
cannot change the result type refuse anyway: `export fun m(x: Bogus) = 42` waits,
though the answer is `Int` under every repair of `Bogus`. That is the same
trade the body half already makes, and it errs towards the explained refusal.

That question is asked three times, because the diagnostics can only answer the
first. Any error reported *inside* the declaration is this function's. But a body
that stops parsing takes its own report with it: the parser carets whatever token
it stopped on and then synchronizes forward, so `= {a = x` complains at the next
declaration's first keyword — or at the end of the file when there is no next
declaration — and neither position nor width tells that apart from a complaint
about the file. The other two questions are therefore asked of the text, and they are the two
ways a declaration stops early. **Does the body leave a bracket open?** — `= {a =
x` ran off the end. **Does the declaration end where a declaration may end?** —
`= x, y)` parses as `x` and abandons the rest, and `Int` is not the type of the
tuple being written.

That second question is put to *layout*, because the parser puts it to layout
too: after an item it accepts `VSep`, `Semicolon`, `VClose` or the end, and
anything else is "expected a newline or `;` between block items" followed by
recovery eating the remains. Asking layout rather than reasoning about lines is
the point. A comma or a closing bracket at the start of a line is an
*expression continuation*, so no separator is emitted before it and `= x\n, y)`
is the same event as `= x, y)` — where a rule about same-line tokens concludes
the opposite. One consequence is a decision rather than a side effect: a
*finished* body followed by a stray `}` on the next line is refused too, because
it is the same event and no test on token positions can separate the two. A
repair derived from a file the compiler gave up reading is the one worth waiting
on. An unclosed *parameter list* is a separate answer with its own sentence —
not a broken type, but no place to put one.

**A refusal is still an action**, greyed out and carrying its reason, exactly as
a `RenameRefusal` is a result rather than an error. Each of the three above
produces a sentence a user can act on. Dropping them would leave a user waiting
for a lightbulb that never comes, with nothing to say why — and this is the
family of repair where the reason is the interesting part.

The protocol decides how much of that a given client sees. A code action was once
a `Command` and only later became a literal carrying its own edit; a client that
never learned the newer form has nothing here it can apply, so the capability is
not announced to one at all. A disabled action is newer still, and a client that
cannot grey one out is sent nothing rather than an action that looks applicable
and is not.

The request does not consult the client's own `context.diagnostics`. Those are
the ones it happens to be showing, which after an edit describe the previous
analysis; the session's are current, and an action built from stale spans edits
the wrong characters.

## Refactorings

The second half of code actions answers no diagnostic: the dev asks for a
rewrite. The first are the ones where the spec defines one form as the other, so
the rewrite keeps the program's meaning by definition:

- **Write the pipeline as calls**, on a pipe's `|>` or a stage's name:
  `xs |> Seq.map(f) |> Seq.take(3)` becomes `Seq.take(Seq.map(xs, f), 3)`. A
  stage is the call that takes the pipe's left side first (Operators §8), its
  mark kept: `x |> save!` is `save!(x)`.
- **Write the calls as a pipeline**, on a call's name or just before its `(`:
  the call and the calls nested in its first argument, innermost first. A dot
  call ends the chain, since its receiver is not its first argument as written;
  an upper-case name before a `.` is a module only where the prelude or an
  import brings one of that name, so `None.defaultValue(2)` is a dot call. A
  call over several lines, on a line of its own, becomes a stage to a line,
  aligned as Lexer Layout §2.3's multiline chain is.
- **Write the lambda as a match function**, on a lambda's head or its `match`
  line: `(shape) => match shape` and its arms become `match` and the same arms,
  since a match function is `$x => match $x` for a binder no source can name
  (Pattern Matching §6.7). Refused, with the reason, where the lambda says more
  than a match function can: its parameter named in an arm, a written type, a
  `catch` clause. A function's header (`let size(shape) = match shape`) is not
  offered it.
- **Write the match function as a lambda**, on its `match`: the parameter is
  `value`, or the first of `value2`, `value3`… that no arm spells.
- **Write the field `x` as a pun**, and **Write the pun `x` out**, on a
  record's field, in a literal, an update or a pattern alike: `x = x` and `x`,
  since a pun is its field written out (Pattern Matching §2.4 and §9). A
  selection takes the fields it touches, and the record's brace, its `with` or
  the record it updates takes every field ("Write the fields as puns", "Write
  the puns out"). A field whose value is anything but its own name has no
  pun.
- **Write the dot call as `Geo.area(…)`**, on a dot call's `.` or name:
  `s.area()` becomes `Geo.area(s)`, its mark and arguments kept, since a dot
  call on a companion operation is that qualified call (Method Syntax §1). The
  module is spelled as this one names it: the alias of the import that brings
  it, a prelude module's own name (`Vector.length(xs)`), or, in the
  operation's home module, nothing at all (`area(s)`). A constraint member's
  dot call is not offered it, since its qualified call is its open call, where
  the receiver joins the operands rather than closing before the dot (§2.2);
  nor is a field called through the dot. One way only: a qualified call
  written as a dot call needs its receiver's type decided by the text (§3.1),
  which is a question for the checker. Refused, with the reason, where the dot
  reached a module this one does not import (the reason names the import to
  write) or imports only below the call, since an import is read from where it
  stands (Modules §3); where an import here takes a prelude module's name as
  its alias; and where a binder in the item spells the bare name the home
  module would write.
- **Combine the 2 arms with this body**, on an arm's pattern or arrow, or on a
  selection of two or more arms, whole lines included: the run of adjacent arms around it
  whose bodies read the same (a body begun on the line after its arrow as the
  one written after it) becomes one arm, its pattern the or-pattern of theirs
  in their order, since arms are tried top to bottom and an or-pattern's
  alternatives left to right (Pattern Matching §8). Only adjacent arms: moving
  one past another changes which wins where their patterns overlap. Refused,
  with the reason, where an arm has a `when` guard, which runs once after the
  first of its alternatives that matches where separate arms run theirs in
  turn (§3), so the forms differ wherever two patterns match one value; and
  where the arms bind different names, or a name at types the checker kept
  apart, since §2.6 binds each name at one type and unifying two that
  inference kept apart would narrow the function. The types are read from the
  checker's one solve, never worked out again; a record type's fields in
  another order are the same type, and so is a colour joined from others in
  another order. The refusal shows the two types only where neither holds a
  variable, whose letter need not be the one the source writes, and they
  show differently with their fields in one order. Where the checker could
  not read the names an arm binds, as with a constructor its scrutinee's type
  does not have, it is not offered.
- **Split the arm into one per alternative**, on an arm whose pattern is an
  or-pattern, or on the whole arm selected, under a top-level `as` too, written
  in parentheses or not: one arm per alternative, those of an or-pattern among
  them included, each with the `as` and the body, in their order. Refused on a
  guarded arm, for the same reason, and where a comment stands where the split
  writes nothing: between alternatives, or inside the parentheses around an
  `as`, before its first alternative or after its name. An or-pattern inside a pattern
  (`Some(0 | 1)`) is not offered it.
- **Write the alias out**, on a use of a `type` alias of this module: the
  alias's body, the use's arguments in place of its parameters, in parentheses
  where it would otherwise parse as another type (`Handler(Int) -> Unit` is
  `(Int -> Unit) -> Unit`), since an alias and its expansion are one type
  (Declarations Preamble §4) and only what hovers and the `.d.ts` file show
  changes (§6). **Write the alias out everywhere**, on the alias's name where
  it is declared: every use in its module, and the declaration with them
  unless something else names it, another module where it is exported or an
  honor's subject; where another item shares its line, the declaration goes
  with the `;` between them. Refused, with the reason, where a `_` given for a
  parameter the body writes twice would become two types, since one written
  hole is one type through the alias; where a comment in the body, on the
  declaration or beside it, or a documentation comment above it, would be
  copied, lost or left out of place; and in the parameters and result a
  constraint's member writes, or the parameters an honor's member writes,
  where the constraint's implied type takes a name the body writes, which
  there would mean the implied type, as the resolver reads it. Another alias
  the body names means the module's types wherever it is used, above the
  constraint or below it (Declarations Preamble §7.2), so it is written as it
  is. A name an implied type takes there is not the alias, and is not offered
  it; in an honor member's body it is, since an implied type cannot be
  written in a type there (Collections Part 2 §7.3). A use of an alias
  another module exports (`Geo.Segment`, or `Segment` through the companion
  fallback) is written out too, each name in its body spelled as this module
  reaches that type: through this module's import of the module that declares
  it, bare where the companion fallback reaches it, and a prelude or
  compiler-owned type bare, or through the prelude's module where a
  declaration here takes its name. An
  alias the other module keeps to itself is written out in its place, since
  this module cannot name it. Refused, with the reason: naming the import,
  where this module does not import the module that declares a type the body
  names; where the body names a type its module does not export; and where a
  type this module reaches takes the name of a compiler-owned or prelude type
  the body names, and no other spelling reaches it. Not offered where the
  other module reports the body.
- **Introduce a type alias**, on a type, or a selection of one: `type NewType`
  above the item, its body the type, and the alias in the type's place. The
  type's variables are the alias's parameters, in the order the type first
  writes them, so it uses every one (§5.3); `NewType` is the first of
  `NewType`, `NewType2`… the module does not write, one stand-in in both places
  for the dev to type once, written from the start of the line where another
  item shares it, in the line break of the line it goes above. Refused, with
  the reason, where an alias could not hold the type: a `_` in it, a following arrow (§5.1.1), or a named row tail,
  which is fresh at each use of an alias. An `honor`'s subject is not offered
  it, since an alias carries no instances of its own (§4). **Introduce a type
  alias for its 3 places** stands beside it where the module writes the type
  more than once: the alias in every place that reads as the type, laid out
  however it is and type variables matched by name, declared above the first
  of them, the one stand-in in every place. A place in a constraint's or an
  honor's member signature that writes a name the implied type takes is not
  counted, and is not offered the one-place entry either. Refused where a
  comment inside the type in another place would be lost.

**Each rewrite is checked by parsing what it leaves** (`queries/same-reading.ts`):
the top-level item the edit lies in is parsed again, and the two trees must be
the same once a pipe is read as its call, parentheses as what they hold, a
lambda that matches its one parameter as its match function, and a pun as its
field written out, comments included. A dot call's rewrite is checked the same
way, with the new call read as the dot call whose receiver has moved into its
argument list; combining and splitting arms, with the arms read as they are
with the run combined or the arm split, an or-pattern inside another read as
its alternatives in place; an alias written out or introduced, with the alias
read as its body at the use.
That is what decides where the result needs parentheses, as an operand does and
an argument does not, and it catches what a writer of text could get wrong about
layout. It asks no type, so it is no second solver.

**A rewrite that would lose something is refused.** The rewrite keeps the text
of each argument, callee, mark and arm, so a comment between them has nowhere
to go. A `//` comment it would keep inside the new form would run over what the
rewrite writes after it on its line. A mark after a stage's own argument list
(`x |> g(2)!`) marks nothing today (#1491) and would be dropped. A refused
rewrite shows greyed out with its reason in the `Refactor…` menu; an editor's
Ctrl+. list leaves it out.

**Offered only when asked.** An editor asks for code actions on its own as the
caret moves, to decide whether to show its light bulb, and nearly every line has
a call. So the rewrites come only when the dev asks, from the `Refactor…` menu
or a key, as TypeScript's own rewrites do: the session takes `invoked`, and the
server passes the request's `triggerKind`, a client that does not say being taken
as asking. The server announces `refactor` beside `quickfix`, since a client asks
its `Refactor…` menu only of a server that does.

### A type written down, or removed

The next keep the program's meaning by checking it, since a written type binds
(`queries/written-types.ts`):

- **Write down the inferred type of `x`**, on one place an inlay hint stands:
  a parameter of a function or lambda, a `let` or `var`, a header's result
  (**…the inferred result type of `f`**, from its `)` to its `=`), or a binder
  list (**…the inferred binder list of `f`**, on the name or `fun` keyword it
  goes after, or the entries a written one lacks). It writes what the hint
  shows, letters included, each type and constraint spelled as this module
  names it (`Metric.Scale` where the module imports `Metric`), as `Infer return
  type` spells one; a row's tail the hint shows as `{...}` is written with a
  letter, `{...a}`. A callback's arrow is written as the hint shows it, since a
  callback's arrow says what the function accepts (Effects §10):
  `run(f: () ->! a)` for `let run(f) = f!()`.
- **Write down this header's types**, on a function's name where two or more
  of its places are unwritten: every one of them in one edit, checked once.
  It completes an exported function's signature, except a `fun` block
  member's binder list, which goes on the block's head (Modules §4.1.1): the
  head's own action writes it, on the `fun` keyword.
- **Remove the written type of `x`**, and of a result or binder list, on a
  written type at any of those places, or the name it follows: the reverse.
  Never on an exported term's, whose signature Modules §4.1.1 requires whole,
  a `fun` block's head included where a member is exported.

**Each is checked by compiling the edit**, as `Infer return type` is. A type
variable written in an annotation is rigid while its definition is checked
(Functions §4.1), so writing a type down can change what a definition means,
and removing one hands a decision from the text to inference. The edited
project is compiled, and the edit is refused, with the reason, unless no report
appears anywhere that was not there before, every face in the module renders as
it did, and the type of every name the module declares is the same, its locals
and parameters included. The last is what a face alone misses: removing
`: Float` from `let m: Float = n`, in a function whose result is a `Float`,
reports nothing and changes no face, but makes `m` an `Int`. A declaration's
names are compared with one set of letters, so a tie between two of them is
compared too, a row's tail's included: removing `: a` from `y` in
`(x: a, y: a) => x` leaves each of `x` and `y` an `a` on its own, but unties
them. A refusal shows the comparison's letters, minted in order, which are not
always the ones the source writes. Writing `fun copy(r) = {...r}`'s result
alone, `: {...a}`, closes the row and makes `copy` take only `{}`, so it is
refused; the whole header, `copy(r: {...a}): {...a}`, keeps its type. The
reports that a signature is incomplete are counted rather than compared, since
writing a piece of one changes what they say.

Refused before any of that, with the reason: a declaration that does not
check, and for a `fun` block's member any member of its block, since they are
checked together; a type this module cannot spell, or one holding an error; a
result's or a binding's arrow whose colour follows a callback, shown `>->`,
which `Infer return type` refuses too; and a `let` pattern's variable, whose
hint shows a type the grammar has no place for, since a pattern destructures a
value (Pattern Matching §2.4). A definition's own colour, its outer arrow, is
never written (Functions §4.1, #355). Like the rest, these come only when
asked, and are never preferred.

## Correctness principles

- LSP positions are converted at one explicit boundary, `positions.ts`, to the compiler's source-position representation. Both count UTF-16 code units and number lines from zero, so a span crossing outward is a rename rather than a computation; only the inward direction needs the document's line index, which is why that direction takes a `TextDocument`.
- URIs convert to paths by remembered pairing, not by string surgery. `file:///c:/A` and `file:///C:/a` can name one file, so the server records the URI each path came from and converts back by lookup.
- Compiler diagnostics remain the semantic source of truth; this package only translates and publishes them. Message text passes through unchanged — rewording here would fork what the terminal, the playground, and the editor each show.
- Results from superseded analysis are not published against newer text. Diagnostics are debounced, and only the latest analysis is sent.
- Request ordering must not make compiler results nondeterministic.
- Editor-specific behaviour is kept out of the shared compiler services.
- **A diagnostic is anchored where it was drawn, and merged where several programs draw it.** A report is published against the file and span that caused it — a dependency's file under `node_modules` included — with its other locations carried as related information. A file several programs hold gets one merged list: identical reports appear once, genuinely different ones each appear, and the file is cleared only when no active program still reports on it. Publishing per program instead would double every error in a shared dependency; publishing only the first program's would hide what the second alone can see.

Two principles from this document's first draft turned out to describe a problem this design does not have, and are recorded here rather than silently dropped. **Per-response version stamping** and **cancellation propagation** both assume a request can observe an edit midway through being answered. Analysis is synchronous, so nothing yields between reading a document and returning an answer; a request either runs entirely before an edit or entirely after it. Both become real the moment analysis stops being synchronous, and that is the change that should bring them back.

## Delivered, and what follows

The first vertical slice provides:

1. process startup, initialization, shutdown, and logging;
2. incremental document synchronization, with open buffers taking precedence over disk;
3. compiler-backed diagnostics for every file in the workspace, not only open ones;
4. hover using resolved and typed compiler information;
5. go-to-definition using stable compiler identities;
6. find-references over values, type names, and constraints; and
7. a `hexagon.json` manifest saying what the project is, whose `dependencies` are resolved and compiled with it.

Find-references arrived with the slice rather than after it because it shares one index with go-to-definition: both ask the same question of the same table, and building one without the other would have meant writing the traversal twice.

The second adds:

8. semantic tokens over names, layered on the TextMate grammar rather than replacing it;
9. rename, with a preparation step, across every file the project owns; and
10. completion, unqualified, after a module name, and after a value's dot.

The third adds:

11. quick fixes: a diagnostic's own repairs, and `Infer return type` for an
    exported function that did not write one — verified by compiling the edit,
    and refused in the open with its reason when it cannot be made.

The fourth adds:

12. documentation (`spec/doc-comments.md` §8) in hover and completion, rendered
    as the Markdown §6 says it is — including at the positions that reach
    neither emitted artifact, which is what makes documenting a local binder or
    an `honor` member worth doing at all.

The fifth adds:

13. signature help while a call's arguments are written, in VS Code and the
    Playground;
14. the type of any expression, on a selection or off a name, and "Expand
    Selection", in both; and
15. inlay hints: inferred types where they could be written, and a function's
    colour in words, in both.

The sixth begins with:

16. refactorings between forms the spec defines as one another, in both: a
    pipeline and calls, either way; a match function and its lambda, either
    way; a record's puns and its fields written out, either way; a dot call
    as its qualified call, that way only; arms with one body and an
    or-pattern's arm, either way; and a type and a `type` alias for it,
    either way; and
17. the inferred type written down where a hint stands, a whole header's at
    once, and a written type removed, in both, each checked by compiling it.

Formatting and workspace symbols follow as the necessary compiler services become stable. Features are not simulated with textual guesses when semantic information is required — where these slices read source text, it is to locate a name the tree already said was there, or to read a half-typed line no tree describes yet, never to decide what a name means.

## Implementation and distribution

TypeScript, hosted by Node.js, speaking LSP through `vscode-languageserver` and `vscode-languageserver-textdocument`. Those are real dependencies rather than a hand-rolled JSON-RPC layer: framing, lifecycle, and protocol types are exactly the parts this document calls thin, and the repository already depends on `vscode-textmate` and `vscode-oniguruma` for the same reason.

`npm run build` bundles the server and the compiler it embeds into `dist/server.cjs` with esbuild. The bundle is CommonJS because `vscode-languageserver` requires its Node entry point at runtime, which an ESM bundle cannot satisfy. The executable is `hexagon-language-server`; it defaults to stdio when launched with no transport flag, so running it by hand to diagnose a problem does something useful instead of printing a usage error.

Editor extensions launch this server. They do not contain separate compiler implementations; `editors/vscode` is a client and a grammar, nothing more.

## `hexagon.json`

A directory holding a manifest is a **project**, and one program is compiled per
project directory (`compiler/architecture/environment.md` §4). Without a
manifest at it or above it, a directory is still a project — under an *implicit
empty manifest* (Packages §2.5) — and is "every `.hex` file underneath, compiled
together", which is a guess that goes wrong in a way a server cannot recover
from alone.

```json
{
  "name": "Acme",
  "dependencies": ["Bolt"],
  "exclude": ["examples"]
}
```

**`name`** and **`dependencies`** are the *language's* fields (Packages §2.1):
the package's own name, which is the first segment of every module's full name,
and the packages its modules may import.

`dependencies` are **resolved**, by the `host/` package, the way Node resolves a
requested name: from the asking package's own directory — its `node_modules`,
then each ancestor's, outward — reading the `hexagon.json` of every package root
at each level, with the *nearest* level declaring the name answering. A copy at a
farther level is shadowed for that walk and never read; a package nobody lists is
never sought; and a directory holding no `hexagon.json` is a JavaScript package
(Packages §4.4), read for nothing. What the resolved set then *is* — one copy per
name, acyclic, the project's own name unclaimed — the compiler decides, and its
reports are published against the manifest that carries the entry, a dependency's
own `hexagon.json` under `node_modules` included.

A dependency's source is compiled with the program, so its modules answer hover
and definition like any other, under their full names (`Acme.Geometry`). An
import naming an installed package the manifest does not list draws Packages §7's
report, whose repair is an applied edit adding the entry — offered only where the
manifest is a project the editor holds, never one under `node_modules`.

That edit is measured against the manifest **as the editor holds it**. A
manifest is re-read on the watcher's event, which fires on save, so with
`hexagon.json` open and edited the server's copy is stale by exactly the user's
unsaved work — and an edit ranged over stale text lands in the live document,
where a buffer longer than the last save keeps its tail past the replacement and
the repair produces something that is not JSON. So the extension synchronises
every `hexagon.json` as well as every `.hex` file, and this is the only thing it
synchronises them for: a manifest is JSON, and one seated in a session would be
compiled as Hexagon. The edit replaces the `dependencies` **value** where the
file already has one — so an unrelated change elsewhere survives — the whole
document only where the key has to be added, and carries the buffer's version
wherever the client accepts one, so a client whose document has moved on refuses
the edit rather than misapplying it.

**`exclude`** — path prefixes that are not part of the project: generated output,
deliberately-broken examples, a vendored copy. Matching is by exact path or
directory prefix rather than by glob; a glob language is a design decision with
its own edge cases, and prefixes answer every case that motivated this. Entries
are resolved against the manifest's own directory, which is the only reading
that survives the project being checked out somewhere else.

The field reaches **that package's own files and no other's**. A manifest
belongs to a package, and the walk reads it that way: each project and each
installed dependency is walked with its own entries and nobody else's. The
server asks the same manifest at every door — the one belonging to the deepest
package directory containing the file, which is the package whose source that
file would be. Three cases follow from the one rule, and all three are ordinary:

- a manifest naming a path inside a **nested project**, or inside a sibling
  root, is naming files that project's own manifest answers for. Keeping a file
  out of a nested project is an entry in *its* `hexagon.json`. An entry naming
  the nested project's own directory is the same rule at its edge: §2.2 puts
  that whole directory outside the parent's files before any `exclude` is read,
  so the entry names nothing of the parent's, the nested program stands whether
  or not its folder is also an editor root, and the manifest that wrote the
  entry is told it has no effect;
- a project's entry does not reach its **dependencies**. `node_modules` lies
  inside the project directory, so `exclude: ["node_modules"]` — what a user
  writes out of `.gitignore` habit — would otherwise empty every dependency of
  source, with no report and every import of them refused for a reason nothing
  names;
- a **dependency's** entry does reach its own files, at the doors as well as in
  the walk. A package that excludes a `generated/` it does not ship as source is
  taken at its word however the file is touched; otherwise opening one file
  inside a dependency would add a module the package excluded, and change a
  report in the reader's own code.

None of this could be inferred. Treating `examples/` as excluded because of its
name would be the same mistake as inferring meaning from a name anywhere else in
this compiler — a project has to say so. Nothing else is in the file: no build
configuration, no compiler flags. Those need designing rather than inventing,
and nothing yet needs them.

A fourth field, **`runtimePaths`**, stood here until #829: the modules compiled
with runtime privilege, the ones allowed to name `Node(a)`, the hidden fixed-32
trie node — without which opening this repository greeted a user with 38 errors
reading ``unknown generic type `Node` ``, none of them real. The standard
library is now the package `Hex` in full and the runtime modules are registered
members of it (`stdlib/Runtime/VectorTrie.hex` declaring `module Runtime.VectorTrie`).
Privilege follows compiler-established source provenance, not a module's name,
filename, or directory. Ordinary projects use the compiler's embedded sources;
a same-named project module does not gain their authority. A manifest still
carrying `runtimePaths` draws the unknown-key report.

Developing the standard library itself requires an explicit editor-host grant.
VS Code supplies it through the user-only
`hexagon.languageServer.trustedStandardLibraryProjects` setting, a default-empty
list of absolute project roots. Only an exact canonical root match receives the
compiler's registered replacement inventory; nested and neighbouring projects
remain ordinary, and opening the same root through a symlink preserves the grant.
Editor hosts pass this list in `initializationOptions.trustedStandardLibraryProjects`
as absolute filesystem paths, not file URIs. Relative paths, missing directories,
and malformed entries do not grant authority.
The compiler checks missing, ambiguous, or mismatched replacements rather than
guessing. Workspace settings and manifests cannot enable the grant. Project
rediscovery and session reconfiguration preserve the host's explicit choice.

A missing manifest is the ordinary case and is silent. A *malformed* one is
reported as a diagnostic against `hexagon.json` itself, including an unknown key
and an `exclude` entry that resolves to the workspace root, because a mistake
that quietly did nothing would leave a user staring at diagnostics they believed
they had configured away. A broken manifest never takes language support down
with it: defaults apply and the workspace still works.

That is the **project's** manifest. A dependency's, under `node_modules`, draws
only the language's own refusals — its `dependencies` entries (Packages §2.1,
§4.4) — because §2.1 makes every other field the host's, and because nothing a
user could type in that file survives the next install. Its `exclude` is
honoured in silence — honoured at every door, as the section above says, and
reported on nowhere — and an unknown key is read past.

An entry that names nothing is reported too, as a warning rather than an error,
and checked inside the root by exact spelling rather than by asking whether the
path opens. macOS and Windows will happily open `Trie.hex` when the file is
`trie.hex`, so the user's own editor gives no hint that the entry matches
nothing here, where comparison is exact — an exclusion that silently excludes
nothing brings back every diagnostic it was written to remove. It is a
warning because `exclude: ["dist"]` in a fresh clone is legitimately ahead of
the build that creates it, and reporting that as an error would teach a user to
ignore the mistakes that are real. An entry *outside* the root is judged by
existence alone — there is no chain of directories below the root to walk down
— so a mis-cased one there goes unreported on a filesystem that ignores case.

`exclude` accepts a file or a directory alike.

An excluded file that the user opens says so, as one informational diagnostic.
Going quiet instead would read as a broken server — the grammar still colours the
buffer and the server is visibly running — and the user's next move would be to
report a bug rather than to open `hexagon.json`.

So does a file that §2.2's own bounds put outside every package, and there the
sentence names **which** bound, because each has a different way out: directly
inside a package of this project's own `node_modules` that it does not list (add
the `dependencies` entry, naming both the package and the manifest to write it
in), beneath a `hexagon.json` of some other package (open that folder), or under
`dist`, `.git` and the rest of the tooling list (a fact about this host that no
manifest argues with, so that sentence offers no repair). The entry is offered
only where there is a name to write: a package whose own `hexagon.json` declares
none — an `npm link`ed workspace project, since `name` is optional for a package
nobody publishes — is named as a bound instead, because writing the directory's
name would leave the same silence and draw a Packages §7 report besides. The
bound named is the one that would still be there **last**, since
each way out only moves the file to the next bound down: a file under
`node_modules/acme/vendor/dist` is told about `dist` and not about `vendor`,
whose folder it could open to no effect, and one under a *dependency's* own
`node_modules` is told whose it is and offered nothing, because the manifest
that could list it is that dependency's and not the reader's. These are the
bounds a user cannot see — each is a fact about a directory above the file
rather than a line anyone wrote — and this PR sharpens the need: a file inside a
*listed* dependency now gets full language support, and one inside its unlisted
neighbour gets none, with nothing on screen to tell them apart. Each notice
clears the moment its reason does.

Every manifest is watched like source, wherever it sits, since a change to one
can change what the programs are: a `hexagon.json` written beneath a project is a
package of its own and so a program of its own, and one written under
`node_modules` is a dependency arriving. Any of them re-runs discovery.

## Known limits

Listed rather than hidden, because each is a place where the server is knowingly
less than it looks.

- **The set of workspace roots is fixed at initialization.** A folder added to
  or removed from the workspace afterwards is not noticed: the server neither
  declares `workspace.workspaceFolders` nor handles the change notification, so
  the fix is to reload the window. Handling it is a small change — `setRoots`
  already replaces the whole file set — but it needs the capability declared and
  a test that adding a folder brings its modules into the graph.
- **`exclude` matches paths, and a path is one of the names a file has.** A
  file is checked under both the name the walk reached it by and the name it
  resolves to, so a symlink cannot smuggle an excluded directory back in. An
  entry's **containing directory** is resolved and its own last component is
  not, so excluding a link excludes that link and not the file it points at —
  the reverse would silently delete source — while an absolute entry pasted in
  the shell's spelling still matches the walk's. Matching remains
  case-sensitive on filesystems that are not, which is why a mis-cased entry is
  reported rather than silently doing nothing.
- **Initialization waits for the workspace scan.** `initialize` walks the root
  and reads every `.hex` file before replying, so that the first request is
  answered against a whole module graph rather than a partial one. On a very
  large tree that delay is visible at startup. Scanning in the background instead
  would trade a slow start for a window where go-to-definition silently misses.
- **A file the walk never saw is keyed by its resolved name.** `Workspace.pathFor`
  settles every URI to one spelling — the one the walk chose where it found the
  file, and the resolved one otherwise — so a symlink, a linked root and a
  file created since the last walk all reach one session entry. What is not
  settled is a client that spells one *path* two ways without a link between
  them, `file:///c:/A` beside `file:///C:/a`: those are two paths, hence two
  entries, and no client observed so far sends both.
- **Constraints declared in a module cannot be used from another.** The compiler
  has no channel for exporting one, so a cross-module `honor` does not resolve.
  Go-to-definition on a constraint therefore only ever answers within a module,
  and the built-in `Eq`/`Ord`/`Show`/`Hash` are known to the checker rather than
  declared in Hexagon, so they have nowhere to jump to at all. Renaming one is
  refused for the same reason: there is no declaration to rewrite.
- **A constraint is its name, project-wide.** Constraints have no identity beyond
  their spelling, so renaming a declared one rewrites every mention of that name
  in every module — including a same-named constraint that was never related to
  it. That follows from the identity model rather than from this code, and it is
  the one rename whose blast radius is larger than a reader would guess.
- **A documented `honor` member, record field or `type` alias hovers, and does
  nothing else.** None of the three has an identity in the occurrence index — a
  member implementation's name is a bare string in the resolved tree, a field is
  not a symbol, an alias is expanded away — so hover answers them from the
  documentation index alone, with the content and the name and no type. Without
  documentation they are exactly as silent as before, and find-references,
  rename and semantic tokens still pass over all three. Giving an `honor`
  member a real identity is the fix, and it is a change to the resolver rather
  than to anything here. Renaming a constraint member shows the cost today: the
  implementations do not move with it, and the rename is *refused* — verified,
  against the compiler's own `instance is missing required member` — rather
  than silently half-applied.
- **A `type` alias is not offered by completion.** The type tables carry unions,
  records and foreign types; an alias resolves away before either the tables or
  the occurrence index see it. Documentation reaches it on hover and nowhere
  else.
- **An `honor` block's documentation answers on the constraint in its head.**
  The block introduces no name of its own, so that is where a reader points to
  ask what the instance is for, and there the instance's documentation wins over
  the constraint's. The constraint's own still answers at its declaration and at
  every other mention, and when the block is undocumented the head shows the
  constraint's — but a reader who documented both and expected the constraint's
  text at the head will see the other one.
- **A pattern that binds nothing documents nothing anyone can read.**
  `(** … *) let (_, _) = pair` attaches without error, per §5, and has no name to
  file the content under. It is the one documentable position where hover is
  silent by construction rather than by a missing identity.
- **Completion does not know what kind of thing belongs at the cursor.** Value
  names, type names and module names are offered together, each carrying its
  kind. Narrowing would need a parse of the line being typed, which is the line
  that does not parse.
- **After a dot nothing follows yet, the receiver is a value only where it is
  nothing else.** The parser keeps `q.` with an empty name, and the checker
  records its judgment as for any dot. A path whose first name is a module
  (`Vector.`, `Lib.`, `Regex.Syntax.`) is read as a qualifier, from the text,
  so `Lib.value.` offers nothing until a name follows, where `Lib.value.x`
  does. A call, index, mark or further dot written straight after the dot
  (`q.(1)`) meets the recovery node it always did.
- **Completion offers no constraint names.** They appear only in `<a: C>` and
  `honor C<T>`, positions this does not detect, and the built-in set lives in the
  checker rather than in any table a query can read.
- **Completion answers inside a string literal.** A string can hold an
  interpolation, where names genuinely belong, and telling the two apart needs
  the token stream rather than the text. Comments are suppressed, since a comment
  cannot hold code — except a JavaScript-spelled `/* … */`, which the lexer
  redirects rather than records, so nothing marks it as a comment to suppress
  inside. While a `(*` is still unclosed its comment runs to the end of the file,
  and completion is silent for the rest of it; that is the same shape as the
  highlighting bail-out in #162 and #174.
- **A module alias cannot be renamed.** `import module H` binds `H` in a namespace
  the occurrence index does not model, so a request on it answers "nothing to
  rename here" rather than refusing.
- **Rename re-analyses the whole project to verify one request** — one
  compilation of the edited copy, then a whole-project denotation comparison
  against the original. That is affordable on the same measurement that makes
  whole-project analysis affordable, and it is not on the keystroke path.
- **The "no new diagnostic" test compares messages with the renamed name blanked
  out of them**, so that a pre-existing error mentioning either spelling is not
  read as breakage. The cost is that two diagnostics differing *only* in those
  names count as one: a collision that moves from the old name onto the new one
  can pass this test. The denotation comparison is the load-bearing check, and
  the user still sees the error.
- **A broken declaration makes its *callers* provisional, and only its own is
  checked.** `export fun size(v: Int) = helper(v)` where `helper` is the one
  with the mistake has nothing wrong inside it, so the repair is offered — and
  the type it writes came through the broken call. Fixing `helper` then leaves a
  rigid annotation that blames the signature. Catching it would mean deciding
  which of a file's errors this declaration's type depends on, which is a
  question about the checker's inference graph rather than about source spans.

  The reach of this is narrower than it looks, because the checker's `Error`
  type is not spellable and refusing to spell it catches the direct cases. With
  `let helper(x: Int) = missingName`, the result *is* that type and the action
  refuses. It slips through only when the error is wrapped in something that can
  be written: `let helper(x: Int) = [missingName]` gives `Vector` of it, and
  `: Vector(a)` is offered.
- **An exported value that is not a function gets nothing at all.** `export let
  size = helper` reports `exported value \`size\` requires a type annotation`,
  and no action answers it — not even a refusal, because there is no return type
  to write and the colon would go somewhere else entirely. It is the gap a user
  is most likely to meet, and it is the next action rather than a limit of this
  one.
- **Only the return type is inferred, and one diagnostic can ask for more.** The
  checker's message asks for every missing annotation at once, so completing the
  signature of a function whose parameters are also unannotated leaves the error
  standing with a shorter message. That is fine where the result does not depend
  on the missing piece — `export fun m(x) = 1` is `Int` however `x` is typed —
  and it is refused where it does, which is the next entry. Parameter types are
  the next action to be written.
- **A result standing on an un-annotated parameter waits for it.** An
  un-annotated parameter gets a fresh type variable and the result generalizes
  over it, so `export fun m(x) = [x]` infers `Vector(a)` for the same reason
  `m(x: I) = [x]` does — one keystroke earlier, and far more common. Writing that
  down and then typing `x: Int` blames the annotation for a signature the user
  never wrote.

  The test is asked of the tree, because the checker's one message cannot say
  which half of the signature is missing, and it is asked as *reachability*
  rather than containment: **while any parameter is bare, does the result mention
  a variable no annotated parameter's type contains?** Containment is too narrow
  — a constraint's implied type (Collections Part 2 §5) makes the result a
  projection variable that no parameter's type contains while being determined by
  one. A variable standing in an annotated parameter's type is one the user wrote
  and is invariant under any completion of the rest, so `m(x: a, y) = [x, y]` is
  `Vector(a)` whatever `y` becomes and is offered.
- **A projection is only caught while a parameter is bare.** `peek(x: a) =
  get(x)` above has every parameter annotated, so the check above does not run,
  and `: b` is offered for a variable the constraint will pin. Telling a
  projection from a genuinely quantified variable needs the checker to emit which
  is which — it knows and does not — so this is #190 rather than a rule that
  could be written here.
- **A type variable written inside the body is not paired with the result's.**
  A body-level `let held: z = value` declares `z` in the same rigid scope as the
  signature, and nothing pairs it with the variable the result is built from, so
  the annotation would be minted as `a` and the two would collide. In practice
  the entry above usually gets there first, because the body's `z` reaches the
  result through `value`. Pairing body annotations properly means walking the
  body. Where it does not get there first, compiling the edit does: that is what
  the verification step is for, and it has inputs of its own — `export fun m() =
  (r) => {...r}` has no parameters at all, and its open row still closes when
  written.
- **A type alias is written as what it expands to.** `type Name = String` is
  transparent to the checker, and the inferred type carries no memory of the
  alias, so the action writes `String` where a reader would have written `Name`.
- **`Infer return type` costs one extra compilation of the project** per
  declaration it is offered for, on a request the editor sends whenever the
  caret moves. It is bounded by needing a diagnostic under the caret, and by the
  same measurement that makes rename affordable, but it is real in two ways: a
  project big enough for whole-project analysis to be slow makes the lightbulb
  slow at exactly those spots, and a *selection* covering many unsigned exports
  pays for each of them. The repair is offered once per declaration, not once
  per diagnostic, which is what keeps the usual case at one.
- **A selection covering several unsigned exports offers several identically
  titled actions.** The title says what the repair does, not which declaration
  it does it to, so in that one case the menu entries are told apart only by
  their previews. A caret on one error — how a quick fix is normally reached —
  offers exactly one.
- **Each type written down or removed costs one compilation of the project**
  per action offered, and a caret on a function's name can offer three: its
  binder list, its whole header, and a written binder list's removal. Only what
  stands at the caret, or where a selection starts, is offered, so a selection
  across a module costs what its first place does. They are computed when the
  dev asks for refactorings, not as the caret moves, but a client that does not
  say why it asks (no `triggerKind`) is answered as if the dev asked, so there
  each caret move onto a place pays for its actions.
- **A prelude module that no other module references is not compiled**, so it has
  no tokens, no completions, and cannot be renamed within. This is only visible
  in a project that compiles the standard library itself, and it can make a
  rename there refuse: dropping the last reference to such a module removes it
  from the graph, and the verification then finds the rewritten spans gone.

## Code readability

Language-server code follows the compiler's readability principles: comments explain protocol concepts, concurrency assumptions, version checks, and reasons for non-obvious behaviour rather than repeating visible TypeScript types. Protocol terminology should be introduced in ordinary language where a reader may not already know LSP internals.
