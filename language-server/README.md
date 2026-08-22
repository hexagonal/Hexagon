# Hexagon Language Server

The Hexagon language server: the process that exposes Hexagon language intelligence through Microsoft's Language Server Protocol (LSP).

Four slices are implemented over a compiler-owned analysis session: diagnostics, hover, go-to-definition and find-references; then semantic tokens, rename and completion; then quick fixes, the diagnostic-driven half of code actions; then documentation in hover and completion. Formatting, refactoring actions and workspace symbols are not, and the server does not announce them; a capability announced but unimplemented offers the user a command that silently does nothing.

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
    manifest.ts        `hexagon.json`: what the project says it is
    positions.ts       the single LSP-to-compiler coordinate boundary
    diagnostics.ts     conversion of compiler diagnostics to the protocol's shape
    semantic-tokens.ts the legend, and the protocol's relative token encoding
    code-actions.ts    quick fixes, and what shape of one a client understands
```

Tests sit beside their subject, with one exception: `workspace.concurrency.test.ts`
replaces `readdir` with one that can be parked mid-walk, so that two overlapping
rescans interleave on demand rather than by luck. It is a separate file because
that replacement would otherwise apply to every test in the workspace suite.

There is no `connection.ts`: `vscode-languageserver` owns JSON-RPC framing and lifecycle, and no separate `requests/` directory, because each handler is small enough that separating them would cost more indirection than it removes. `documents.ts` is likewise absent — `TextDocuments` from the same package applies incremental changes.

Protocol adapters stay thin. A handler asks the compiler service a semantic question and converts the answer to LSP structures; when one looks like it is about to decide something about Hexagon, the decision belongs in `compiler/src/analysis` instead.

Two rules keep the process honest. Nothing may write to stdout except protocol messages — a stray `console.log` corrupts the stream and the client disconnects with no useful error — so the server logs through `connection.console`. And the workspace module is the only part that touches a filesystem, because the compiler is deliberately free of one.

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
hover(path, offset)       what it is, its type if it has one, its documentation
codeActions(path, range)  the repairs offered here, refusals included
pathOfFile(fileId)        the file a span's numeric identity names
```

Positions crossing this API are UTF-16 offsets into the named file, never line and character pairs — see below.

An analysis retains every module's resolved *and* typed tree, since a code action asks the checker's own answer for a declaration and the two must be read together. Analysis is recomputed lazily and wholly: any change discards it and the next question rebuilds it. That is a decision, not a placeholder. Reanalyzing this repository's own `stdlib/` and `runtime/` after an edit measures a median of about 40ms — well inside the delay diagnostics are debounced by — so incremental reuse would buy nothing yet and would have to guess what is worth keeping before any query exists to say. A rename adds roughly one more compilation on top of whatever the session already holds, since it recompiles an edited copy and compares the two; it is not on the keystroke path.

Eight compiler queries sit behind these answers, and each exists because no other part of the compiler still knows what it knows:

- `queries/occurrences.ts` indexes every name that denotes something together with what it denotes — values, unions, records, foreign types, and constraints. Definitions, references, rename and semantic tokens all read this one table. It reads the resolved tree for identity, the parsed tree for constraints, the source for a head name inside a wider span, and the *typed* tree for one thing only: the operation name of a dot call, which nothing earlier has decided the meaning of.
- `queries/type-occurrences.ts` gives hover its types, keyed by the same spans.
- `queries/symbol-facts.ts` records, per value symbol, how it was bound *and* whether the checker gave it a function type. The two come apart constantly: `let brighten(colour) = …` is a `let`, `extern fun` and `extern let` are both `extern`, and `let g = f` is a function with no parameter list anywhere.
- `queries/documentation.ts` indexes the doc content the parser attached (`spec/doc-comments.md` §4), under both the names a declaration introduces and the declaration's own first token — an editor holds a name, and the two are the same offset only for the forms that begin with theirs. It also answers by *position*, for the five documentable places the occurrence index has no identity for at all: an `honor` member's name is a bare string in the resolved tree, a record field is not a symbol, a `type` alias is expanded away, and no occurrence walk visits an implied type's name — a constraint's `type` member or an `honor` block's binding of it.
- `queries/semantic-tokens.ts` classifies names, and only names — see below.
- `queries/completions.ts` answers what could be written at an offset, from a scope record the resolver now keeps.
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
rather than a tree, and has to: `Vector.` does not parse. The reading is lexical
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

## Quick fixes

Code actions arrive in two halves, and this is the first: **every action answers
a diagnostic**. Refactorings the user asks for out of nowhere — extract this,
inline that — are the second half and are not here. The split is not tidiness. It
is what bounds the cost: an action is computed only where the caret is on an
error the user can already see, which is rare and deliberate, where a refactoring
menu must answer every cursor movement.

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
diagnostic at all: `fun copy(r) = {...r}` infers the *open* record `{...a} ->
{...a}`, and writing that type closes it, leaving a function that accepts only
the empty record and an error message nowhere.

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

## Correctness principles

- LSP positions are converted at one explicit boundary, `positions.ts`, to the compiler's source-position representation. Both count UTF-16 code units and number lines from zero, so a span crossing outward is a rename rather than a computation; only the inward direction needs the document's line index, which is why that direction takes a `TextDocument`.
- URIs convert to paths by remembered pairing, not by string surgery. `file:///c:/A` and `file:///C:/a` can name one file, so the server records the URI each path came from and converts back by lookup.
- Compiler diagnostics remain the semantic source of truth; this package only translates and publishes them. Message text passes through unchanged — rewording here would fork what the terminal, the playground, and the editor each show.
- Results from superseded analysis are not published against newer text. Diagnostics are debounced, and only the latest analysis is sent.
- Request ordering must not make compiler results nondeterministic.
- Editor-specific behaviour is kept out of the shared compiler services.

Two principles from this document's first draft turned out to describe a problem this design does not have, and are recorded here rather than silently dropped. **Per-response version stamping** and **cancellation propagation** both assume a request can observe an edit midway through being answered. Analysis is synchronous, so nothing yields between reading a document and returning an answer; a request either runs entirely before an edit or entirely after it. Both become real the moment analysis stops being synchronous, and that is the change that should bring them back.

## Delivered, and what follows

The first vertical slice provides:

1. process startup, initialization, shutdown, and logging;
2. incremental document synchronization, with open buffers taking precedence over disk;
3. compiler-backed diagnostics for every file in the workspace, not only open ones;
4. hover using resolved and typed compiler information;
5. go-to-definition using stable compiler identities;
6. find-references over values, type names, and constraints; and
7. a `hexagon.json` manifest saying which modules are privileged and which files are not the project.

Find-references arrived with the slice rather than after it because it shares one index with go-to-definition: both ask the same question of the same table, and building one without the other would have meant writing the traversal twice.

The second adds:

8. semantic tokens over names, layered on the TextMate grammar rather than replacing it;
9. rename, with a preparation step, across every file the project owns; and
10. completion, unqualified and after a module name.

The third adds:

11. quick fixes: a diagnostic's own repairs, and `Infer return type` for an
    exported function that did not write one — verified by compiling the edit,
    and refused in the open with its reason when it cannot be made.

The fourth adds:

12. documentation (`spec/doc-comments.md` §8) in hover and completion, rendered
    as the Markdown §6 says it is — including at the positions that reach
    neither emitted artifact, which is what makes documenting a local binder or
    an `honor` member worth doing at all.

Formatting, refactoring code actions and workspace symbols follow as the necessary compiler services become stable. Features are not simulated with textual guesses when semantic information is required — where these slices read source text, it is to locate a name the tree already said was there, or to read a half-typed line no tree describes yet, never to decide what a name means.

## Implementation and distribution

TypeScript, hosted by Node.js, speaking LSP through `vscode-languageserver` and `vscode-languageserver-textdocument`. Those are real dependencies rather than a hand-rolled JSON-RPC layer: framing, lifecycle, and protocol types are exactly the parts this document calls thin, and the repository already depends on `vscode-textmate` and `vscode-oniguruma` for the same reason.

`npm run build` bundles the server and the compiler it embeds into `dist/server.cjs` with esbuild. The bundle is CommonJS because `vscode-languageserver` requires its Node entry point at runtime, which an ESM bundle cannot satisfy. The executable is `hexagon-language-server`; it defaults to stdio when launched with no transport flag, so running it by hand to diagnose a problem does something useful instead of printing a usage error.

Editor extensions launch this server. They do not contain separate compiler implementations; `editors/vscode` is a client and a grammar, nothing more.

## `hexagon.json`

A workspace root may carry a manifest saying what the project is. Without one,
the root is "every `.hex` file underneath, compiled together", which is a guess
that goes wrong in two ways a server cannot recover from alone.

```json
{
  "runtimePaths": ["runtime/VectorTrie.hex"],
  "exclude": ["examples"]
}
```

**`runtimePaths`** — modules compiled with runtime privilege, the ones allowed to
name `Node(a)`, the hidden fixed-32 trie node. The compiler has always modelled
this (`ProjectOptions.runtimePaths`) but nothing could tell a *server* which
files they were, so opening this repository used to greet a user with 38 errors
reading ``unknown generic type `Node` `` — none of them real.

**`exclude`** — path prefixes that are not part of the project: generated output,
deliberately-broken examples, a vendored copy. Matching is by exact path or
directory prefix rather than by glob; a glob language is a design decision with
its own edge cases, and prefixes answer every case that motivated this.

Both are resolved against the manifest's own directory, which is the only reading
that survives the project being checked out somewhere else.

Neither could be inferred. Treating `runtime/` as privileged because of its name
would be the same mistake as inferring meaning from a name anywhere else in this
compiler — a project has to say so. Nothing else is in the file: no dependency
resolution, no build configuration, no compiler flags. Those need designing
rather than inventing, and nothing yet needs them.

A missing manifest is the ordinary case and is silent. A *malformed* one is
reported as a diagnostic against `hexagon.json` itself, including an unknown key
and an `exclude` entry that resolves to the workspace root, because a mistake
that quietly did nothing would leave a user staring at diagnostics they believed
they had configured away. A broken manifest never takes language support down
with it: defaults apply and the workspace still works.

An entry that names nothing is reported too, as a warning rather than an error,
and checked inside the root by exact spelling rather than by asking whether the
path opens. macOS and Windows will happily open `Trie.hex` when the file is
`trie.hex`, so the user's own editor gives no hint that the entry matches
nothing here, where comparison is exact — a privileged module that is silently
not privileged brings back the very errors it was written to remove. It is a
warning because `exclude: ["dist"]` in a fresh clone is legitimately ahead of
the build that creates it, and reporting that as an error would teach a user to
ignore the mistakes that are real. An entry *outside* the root is judged by
existence alone — there is no chain of directories below the root to walk down
— so a mis-cased one there goes unreported on a filesystem that ignores case.

The two fields are not symmetrical, and the asymmetry is reported rather than
left to be discovered: `exclude` accepts a file or a directory, while
`runtimePaths` accepts only files, because privilege is granted per module. A
directory in `runtimePaths` is an error, not a silent no-match.

An excluded file that the user opens says so, as one informational diagnostic.
Going quiet instead would read as a broken server — the grammar still colours the
buffer and the server is visibly running — and the user's next move would be to
report a bug rather than to open `hexagon.json`.

The manifest is watched like source, since a change to it can change every
answer.

## Known limits

Listed rather than hidden, because each is a place where the server is knowingly
less than it looks.

- **One manifest per workspace root, at the root.** Nested projects inside one
  root are not modelled: a `hexagon.json` deeper in the tree is watched but never
  read, and a root's `exclude` cannot be overridden below it.
- **The set of workspace roots is fixed at initialization.** A folder added to
  or removed from the workspace afterwards is not noticed: the server neither
  declares `workspace.workspaceFolders` nor handles the change notification, so
  the fix is to reload the window. Handling it is a small change — `setRoots`
  already replaces the whole file set — but it needs the capability declared and
  a test that adding a folder brings its modules into the graph.
- **`exclude` matches paths, and a path is one of the names a file has.** A
  file is checked under both the name the walk reached it by and the name it
  resolves to, so a symlink cannot smuggle an excluded directory back in. The
  *entry* is not resolved, only re-rooted, so excluding a link excludes that
  link and not the file it points at — the reverse would silently delete source.
  The consequence is that an entry whose own intermediate components pass
  through a link will not match a file reached by the resolved route. Matching
  also remains case-sensitive on filesystems that are not, which is why a
  mis-cased entry is reported rather than silently doing nothing.
- **Initialization waits for the workspace scan.** `initialize` walks the root
  and reads every `.hex` file before replying, so that the first request is
  answered against a whole module graph rather than a partial one. On a very
  large tree that delay is visible at startup. Scanning in the background instead
  would trade a slow start for a window where go-to-definition silently misses.
- **Two URI spellings of one file would be two files.** See `positions.ts`; no
  client observed so far sends more than one spelling.
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
- **A prelude module that no other module references is not compiled**, so it has
  no tokens, no completions, and cannot be renamed within. This is only visible
  in a project that compiles the standard library itself, and it can make a
  rename there refuse: dropping the last reference to such a module removes it
  from the graph, and the verification then finds the rewritten spans gone.

## Code readability

Language-server code follows the compiler's readability principles: comments explain protocol concepts, concurrency assumptions, version checks, and reasons for non-obvious behaviour rather than repeating visible TypeScript types. Protocol terminology should be introduced in ordinary language where a reader may not already know LSP internals.
