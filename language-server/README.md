# Hexagon Language Server

The Hexagon language server: the process that exposes Hexagon language intelligence through Microsoft's Language Server Protocol (LSP).

Two slices are implemented over a compiler-owned analysis session: diagnostics, hover, go-to-definition and find-references, then semantic tokens, rename and completion. Formatting, code actions and workspace symbols are not, and the server does not announce them; a capability announced but unimplemented offers the user a command that silently does nothing.

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
hover(path, offset)       what it is, and its type if it has one
pathOfFile(fileId)        the file a span's numeric identity names
```

Positions crossing this API are UTF-16 offsets into the named file, never line and character pairs — see below.

Analysis is recomputed lazily and wholly: any change discards it and the next question rebuilds it. That is a decision, not a placeholder. Reanalyzing the entire standard library after an edit measures around 19ms, inside a keystroke's budget, so incremental reuse would buy nothing yet and would have to guess what is worth keeping before any query exists to say.

Four compiler queries sit behind these answers, and each exists because no other part of the compiler still knows what it knows:

- `queries/occurrences.ts` indexes every name that denotes something together with what it denotes — values, unions, records, foreign types, and constraints. Definitions, references, rename and semantic tokens all read this one table.
- `queries/symbol-facts.ts` records, per value symbol, how it was bound *and* whether the checker gave it a function type. The two come apart constantly: `let brighten(colour) = …` is a `let`, `extern fun` and `extern let` are both `extern`, and `let g = f` is a function with no parameter list anywhere.
- `queries/semantic-tokens.ts` classifies names, and only names — see below.
- `queries/completions.ts` answers what could be written at an offset, from a scope record the resolver now keeps.

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
collisions Statements §5.1 makes errors in the compiler's own words; and the
renamed identity's mentions must be exactly the spans that were rewritten. The
second is the one that matters, because **capture produces no diagnostic at all**
— rename a module-level `colour` to `tone` where a match arm already binds `tone`
and the arm's body quietly stops meaning what it did, with every type still
checking.

A refusal is a result rather than an error: a name the project does not own, a
spelling Hexagon will not read as the same kind of name, an edit that would change
what the code means. Each reaches the user as a failed request, which is the only
channel a rename has for saying why. Spelling is checked by *lexing* the proposed
name and comparing the token to the old one's, so keywords, the reserved `__hex_`
prefix, and the capitalized/uncapitalized split are all decided by the lexer that
owns them rather than by a copy that would fall behind.

An alias is the case that makes the rule visible. `import {Shade as Other}` gives
one identity two spellings, and renaming `Shade` must rewrite the clause's
*imported* name while leaving `Other` alone — the clause goes on aliasing, it
just aliases a differently-spelled declaration. Renaming through `Other` moves
only that module's mentions. Restricting each rename to the spelling under the
cursor is what makes both halves complete rather than partial, and the occurrence
index publishes both names of an aliasing clause so that neither is missed.

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
whitespace, bounded by indentation so that a cursor back in column zero is not
still inside the function above it.

Completion does not narrow by position: a type annotation gets value names
offered alongside type names, because knowing an offset is in type position means
having a parse. Every candidate carries its kind, so a wrong-kind suggestion
costs a glance — where guessing from a broken parse would drop the right answers.

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

Formatting, code actions and workspace symbols follow as the necessary compiler services become stable. Features are not simulated with textual guesses when semantic information is required — where these slices read source text, it is to locate a name the tree already said was there, or to read a half-typed line no tree describes yet, never to decide what a name means.

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
- **Completion does not know what kind of thing belongs at the cursor.** Value
  names, type names and module names are offered together, each carrying its
  kind. Narrowing would need a parse of the line being typed, which is the line
  that does not parse.
- **Completion offers no constraint names.** They appear only in `<a: C>` and
  `honor C<T>`, positions this does not detect, and the built-in set lives in the
  checker rather than in any table a query can read.
- **A blank line in column zero can still see the preceding function's
  parameters.** Scope regions reach over trailing whitespace so that pressing
  Enter inside a function still answers, bounded by the indentation of the line
  the region started on. A lambda's region starts at `fun`, in column zero, so
  the bound does not exclude it there. Its *body's* locals are correctly
  excluded, and offering a few names too many costs a glance where offering none
  would break the common case.
- **Rename re-analyses the whole project to verify one request.** That is a
  second full compilation per rename, on the same measurement that makes whole-
  project analysis affordable. It is not on the keystroke path.

## Code readability

Language-server code follows the compiler's readability principles: comments explain protocol concepts, concurrency assumptions, version checks, and reasons for non-obvious behaviour rather than repeating visible TypeScript types. Protocol terminology should be introduced in ordinary language where a reader may not already know LSP internals.
