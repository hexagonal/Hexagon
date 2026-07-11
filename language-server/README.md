# Hexagon Language Server

This folder will contain the Hexagon language server: the process that exposes Hexagon language intelligence through Microsoft's Language Server Protocol (LSP).

Implementation has not started. The initial purpose of this document is to establish the boundary between the language server and the compiler before source files or protocol dependencies are chosen.

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

## Expected structure

The exact files will be chosen when implementation begins. The anticipated shape is:

```text
language-server/
  README.md
  src/
    server.ts          protocol lifecycle and capability negotiation
    connection.ts      JSON-RPC/LSP transport adapter
    documents.ts       open-document versions and text synchronization
    workspace.ts       projects, roots, configuration, and file events
    diagnostics.ts     conversion and publication of diagnostics
    requests/          thin adapters for hover, definition, rename, and others
```

Protocol adapters should remain thin. A request module asks the compiler service a semantic question, checks that its result still belongs to the current document version, and converts the answer to LSP structures.

## Compiler service requirement

The language server must not invoke the batch CLI for every request. The compiler will expose a persistent analysis session that can retain and invalidate work across edits. Its eventual API should support operations such as:

```text
open or update a source file
remove a source file
analyze affected modules
retrieve diagnostics
query the symbol or type at a position
find definitions and references
prepare and perform a rename
request completions
request semantic tokens
```

The precise API belongs to the compiler architecture. The language server consumes it and supplies workspace files, document versions, cancellation, and configuration.

## Correctness principles

- Every response is associated with the document version from which it was computed.
- Results from superseded analysis are discarded rather than published against newer text.
- LSP positions are converted at one explicit boundary to the compiler's source-position representation.
- Compiler diagnostics remain the semantic source of truth; this package only translates and publishes them.
- Cancellation is propagated into compiler queries where practical.
- Request ordering must not make compiler results nondeterministic.
- The server must remain responsive while analysis is running.
- Editor-specific behaviour is kept out of the shared compiler services.

## Initial delivery order

The first vertical slice should provide:

1. process startup, initialization, shutdown, and logging;
2. incremental document synchronization;
3. compiler-backed diagnostics for an open file;
4. hover using resolved and typed compiler information; and
5. go-to-definition using stable compiler symbol identities.

Completion, references, rename, semantic tokens, formatting, code actions, and other protocol features should follow as the necessary compiler services become stable. Features should not be simulated with textual guesses when semantic information is required.

## Implementation and distribution

The language server is expected to be written in TypeScript and initially hosted by Node.js. The package and dependency choices, supported LSP version, executable name, transport modes, logging policy, project discovery, and editor-extension packaging remain open.

A likely executable name is `hexagon-language-server`, but it is not fixed by this document. Editor extensions should launch or connect to this server; they should not contain separate compiler implementations.

## Code readability

Language-server code follows the compiler's readability principles: comments explain protocol concepts, concurrency assumptions, version checks, and reasons for non-obvious behaviour rather than repeating visible TypeScript types. Protocol terminology should be introduced in ordinary language where a reader may not already know LSP internals.
