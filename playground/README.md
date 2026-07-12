# Hexagon Playground

This folder will contain the browser-based Hexagon playground: an interactive place to write Hexagon, inspect what the compiler understood and emitted, and run the resulting JavaScript.

The experience is inspired by the TypeScript Playground without attempting to copy its interface exactly. The primary view is a Hexagon editor beside a result panel with user-facing tabs for runtime output, compiler errors, emitted JavaScript, generated TypeScript declarations, and inferred top-level types.

## Product shape

The initial desktop layout is:

```text
┌─────────────────────────────┬─────────────────────────────┐
│ Hexagon                     │ Output  Errors  JS  .d.ts   │
│                             ├─────────────────────────────┤
│ source editor               │ selected result             │
│                             │                             │
└─────────────────────────────┴─────────────────────────────┘
 status                              Run  Examples  Share
```

On narrow screens the result panel moves below the source editor. The source always remains the primary editable surface; generated artefacts are read-only.

### Result tabs

- **Output** shows text and values produced by executing the last successful compilation.
- **Errors** shows structured compiler diagnostics and runtime failures. Selecting a compiler diagnostic focuses its source span; safe fix-its may be applied from here.
- **JS** shows readable ECMAScript modules emitted by Hexagon.
- **.d.ts** shows the supported TypeScript declaration surface.
- **Types** shows a compact list of inferred top-level binding types.

Compiler-development views such as Tokens, Parsed, Resolved, Typed, and Core may be added behind an **Internals** control. They are useful for teaching and implementation but must not crowd the normal language experience.

## Vertical-slice doctrine

Hexagon is implemented through thin, complete language slices:

```text
specification
  -> lexer and layout
  -> parser
  -> resolver
  -> type checker
  -> elaboration
  -> JavaScript and .d.ts emission
  -> tests
  -> playground example
```

A feature is playground-ready when its accepted syntax travels honestly through every required phase, its important rejected forms have intentional diagnostics, its output is test-covered, and a curated example demonstrates it. A parser-only feature must not appear as though it is supported.

This rule provides a usable result after every slice and tests compiler architecture against a real consumer from the beginning.

## Responsibility boundary

The playground owns browser interaction and presentation:

- editor models, panels, tabs, and responsive layout;
- compiler and execution worker lifecycles;
- source versions and stale-result rejection;
- example selection, local persistence, settings, and sharing;
- conversion of structured analysis results into editor decorations; and
- safe presentation of runtime output and failures.

The playground does not implement Hexagon semantics. The platform-neutral core in `compiler/` owns compilation, source positions, diagnostics, inferred types, and reusable language queries. The playground calls those APIs directly inside a Web Worker.

The standalone server in `language-server/` adapts the same compiler services to LSP. The browser playground does not route local queries through LSP or duplicate the language server.

```text
compiler analysis services
  ├── language-server/  -> Language Server Protocol
  └── playground/       -> browser editor adapters
```

## Worker architecture

Compilation and execution are separate activities:

```text
Playground UI
  -> Compiler Web Worker
  <- diagnostics, JavaScript, .d.ts, inferred types

Run command
  -> isolated Execution Worker using the last successful JavaScript
  <- output, completion, or runtime failure
```

The compiler worker prevents analysis from blocking the editor. Each request and result carries a monotonically increasing source version. A result for an older version is discarded rather than displayed against newer source.

Editing compiles automatically after a short debounce. It never runs the program automatically: Hexagon programs may have effects. **Run** executes only the most recent successful compilation. When the current source contains errors, the UI visibly marks generated artefacts and output as belonging to an earlier version or clears them.

Execution occurs outside the compiler worker. A runaway execution can be terminated by replacing its worker without losing the compiler state or editor contents. The complete execution security and host-capability policy must be decided before arbitrary programs are run in a deployed playground.

## Editor direction

**Monaco Editor is the decided primary editor.** Hexagon wants the IDE-like experience it provides: diagnostics, hover, completion, definition navigation, semantic highlighting, and read-only JavaScript and `.d.ts` models. This deliberately gives the playground the same editor foundation and familiar feel as the TypeScript Playground and VS Code.

Use Monaco's supported ESM build. Do not build new integration against its deprecated AMD distribution. The dependency is not installed by this scaffold because the repository package manager and bundler remain open; choosing those tools will determine the exact worker and asset configuration, not whether Monaco is used.

Monaco does not officially support mobile browsers. The playground is therefore Monaco-first on supported desktop browsers and retains a plain textarea editor for mobile, unsupported environments, initial loading, or editor-startup failure. The fallback must still support source editing, compilation, diagnostics in the Errors tab, generated views, and explicit Run; richer inline language services may be unavailable there. Switching to or from the fallback must preserve the current source and source version.

The present scaffold's textarea is that fallback, not a competing editor choice. Monaco replaces it in place when the editor integration initializes successfully.

The editor adapter must consume compiler source positions through one explicit conversion boundary. It must not introduce a second position convention.

## Examples

Curated examples are grouped by language concept and appear only once their complete slice is available. Each example includes a stable identifier, title, description, source, and optional governing specification references.

Where practical, example source should be derived from or shared with conformance fixtures and book examples. The repository must avoid three manually copied versions that can drift independently.

The scaffold contains a `hello-world` placeholder to establish the metadata shape. It does not claim that the compiler currently accepts the program.

## Testing

Pure playground state and protocol adapters use Vitest under the repository testing doctrine. Browser integration uses a distinct Vitest browser project once Monaco and the browser build exist.

Tests must cover at least:

- stale compiler results never replacing current results;
- compile errors never causing automatic execution;
- Run selecting the last successful matching compilation;
- execution-worker replacement after timeout or failure;
- diagnostic position conversion;
- tab accessibility and keyboard operation; and
- narrow-screen layout behaviour.

End-to-end playground tests complement, but never replace, compiler conformance tests.

## Current scaffold

```text
playground/
  README.md
  index.html
  src/
    main.ts
    styles.css
    protocol.ts
    compiler-worker.ts
    execution-worker.ts
    examples/
      hello-world.ts
```

The current UI is deliberately dependency-light. It establishes layout, tab semantics, state boundaries, and worker message contracts. Compilation and execution return explicit “not available” results until the compiler API and safe runner exist.

## Initial delivery order

1. Select the workspace package manager, bundler, and remaining application structure.
2. Make the static shell build and run in development and production modes.
3. Integrate Monaco's ESM build while preserving the textarea fallback.
4. Connect the platform-neutral compiler core through the compiler worker.
5. Render structured diagnostics and maintain version-correct generated views.
6. Add hover and inferred top-level types.
7. Implement isolated explicit execution and captured output.
8. Add curated examples, local persistence, and shareable URLs.
9. Add optional compiler-internal views for development and teaching.

## Decision record

### Initial editor decision

- Monaco Editor is the primary supported desktop editor.
- Integration uses Monaco's ESM build, not its deprecated AMD build.
- The dependency is installed when the repository package manager and bundler are established.
- A plain textarea remains the mobile, unsupported-browser, loading, and failure fallback.
- Both editor paths share one source state and compiler position-conversion boundary.
