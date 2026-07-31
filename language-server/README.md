# Hexagon Language Server

The Hexagon language server: the process that exposes Hexagon language intelligence through Microsoft's Language Server Protocol (LSP).

The first slice is implemented — diagnostics, hover, go-to-definition, and find-references — over a compiler-owned analysis session. Completion, rename, semantic tokens, formatting, and code actions are not, and the server does not announce them; a capability announced but unimplemented offers the user a command that silently does nothing.

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
    positions.ts       the single LSP-to-compiler coordinate boundary
    diagnostics.ts     conversion of compiler diagnostics to the protocol's shape
```

There is no `connection.ts`: `vscode-languageserver` owns JSON-RPC framing and lifecycle, and no separate `requests/` directory, because each handler is small enough that separating them would cost more indirection than it removes. `documents.ts` is likewise absent — `TextDocuments` from the same package applies incremental changes.

Protocol adapters stay thin. A handler asks the compiler service a semantic question and converts the answer to LSP structures; when one looks like it is about to decide something about Hexagon, the decision belongs in `compiler/src/analysis` instead.

Two rules keep the process honest. Nothing may write to stdout except protocol messages — a stray `console.log` corrupts the stream and the client disconnects with no useful error — so the server logs through `connection.console`. And the workspace module is the only part that touches a filesystem, because the compiler is deliberately free of one.

## Compiler service

The language server does not invoke the batch CLI for every request. `compiler/src/analysis/session.ts` exposes `AnalysisSession`, a persistent session the server holds open:

```text
setFile(path, text)       add a file or replace its text
removeFile(path)          drop a file
version                   increments on every mutation
diagnostics(path)         one file's diagnostics
allDiagnostics()          every held file's, empty lists included
definitions(path, offset) where the name at this offset is declared
references(path, offset)  every occurrence of what it denotes
hover(path, offset)       what it is, and its type if it has one
pathOfFile(fileId)        the file a span's numeric identity names
```

Positions crossing this API are UTF-16 offsets into the named file, never line and character pairs — see below.

Analysis is recomputed lazily and wholly: any change discards it and the next question rebuilds it. That is a decision, not a placeholder. Reanalyzing the entire standard library after an edit measures around 19ms, inside a keystroke's budget, so incremental reuse would buy nothing yet and would have to guess what is worth keeping before any query exists to say. Rename, completion, and semantic tokens will extend this API rather than the server.

The query behind definitions and references is `compiler/src/queries/occurrences.ts`, which indexes every name that denotes something together with what it denotes — values, unions, records, foreign types, and constraints.

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
5. go-to-definition using stable compiler identities; and
6. find-references over values, type names, and constraints.

Find-references arrived with the slice rather than after it because it shares one index with go-to-definition: both ask the same question of the same table, and building one without the other would have meant writing the traversal twice.

Completion, rename, semantic tokens, formatting, code actions, and workspace symbols follow as the necessary compiler services become stable. Features are not simulated with textual guesses when semantic information is required — where this slice reads source text, it is to locate a name the tree already said was there, never to decide what the name means.

## Implementation and distribution

TypeScript, hosted by Node.js, speaking LSP through `vscode-languageserver` and `vscode-languageserver-textdocument`. Those are real dependencies rather than a hand-rolled JSON-RPC layer: framing, lifecycle, and protocol types are exactly the parts this document calls thin, and the repository already depends on `vscode-textmate` and `vscode-oniguruma` for the same reason.

`npm run build` bundles the server and the compiler it embeds into `dist/server.cjs` with esbuild. The bundle is CommonJS because `vscode-languageserver` requires its Node entry point at runtime, which an ESM bundle cannot satisfy. The executable is `hexagon-language-server`; it defaults to stdio when launched with no transport flag, so running it by hand to diagnose a problem does something useful instead of printing a usage error.

Editor extensions launch this server. They do not contain separate compiler implementations; `editors/vscode` is a client and a grammar, nothing more.

## Code readability

Language-server code follows the compiler's readability principles: comments explain protocol concepts, concurrency assumptions, version checks, and reasons for non-obvious behaviour rather than repeating visible TypeScript types. Protocol terminology should be introduced in ordinary language where a reader may not already know LSP internals.
