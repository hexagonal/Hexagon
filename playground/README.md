# Hexagon Playground

This folder will contain the browser-based Hexagon playground: an interactive place to write Hexagon, inspect what the compiler understood and emitted, and run the resulting JavaScript.

The current slices compile live, run the latest successful compilation, and expose errors, emitted JavaScript, an
inspection-only TypeScript preview, and inferred top-level types. Primitive
parameter and result annotations, directly recursive `fun`, and first-argument
pipes are accepted, including partially annotated parameter lists. The first host
operation, `console.log(...)`, accepts any number of typed arguments, returns
`Unit`, and writes to both the Output tab and the execution worker's browser console.
Supported desktop browsers load Monaco asynchronously for Hexagon editing and
read-only generated-code models; the textarea remains live until Monaco succeeds.

The Playground also supplies a deliberately small, provisional **fundamental
stdlib** from the repository's canonical Hexagon sources. `Rat` is its first module:
Playground programs use the real opaque type and its globally coherent instances,
not an example-local reimplementation. “Fundamental” names the current host-supplied
foundation, not a closed inventory; the complete boundary remains stdlib-listing and
project-loader work. This is distinct from the compiler's **fundamental
specializations**, which are generated monomorphic editions of generic functions.

## Try it

```sh
cd playground
npm install
npm run dev
```

Open the local address printed by Vite. Edit `main.hex`, inspect **Errors**,
**JS**, **.d.ts**, and **Types**, then choose **Run**. The **Output** tab receives
`console.log(...)` output. Top-level bindings do not need `export`: the
`.d.ts` tab uses the compiler's inspection-only TypeScript preview while preserving
ordinary Hexagon visibility. This path calls the compiler directly in a Web Worker;
it does not use the language server or LSP.

The playground opens on **JS** and begins with a commented tour of the supported
language. Its comments and blank lines between top-level features also appear in
the emitted JavaScript, so the first view demonstrates the readable-output doctrine.

### Single-document module blocks

The playground has one host-only workspace extension for multi-module examples:

```hexagon
module Mगणित
export fun जोड़(left: Int, right: Int): Int = left + right
end module Mगणित

console.log(Mगणित.जोड़(20, 22))
```

The block becomes a real virtual `Mगणित.hex` file and the remaining source receives
the equivalent of `import * as Mगणित from "./Mगणित"`. Block contents deliberately
stay at column one: adding or removing the wrapper never requires reindentation. The
closing name must exactly repeat the opener, blocks cannot nest, and names must be
unique uppercase-start identifiers. Diagnostics retain their positions in the
combined document, and **Run** executes the emitted modules with ordinary ESM
linkage.

This notation belongs to the playground document format, not the Hexagon language.
Real `.hex` projects continue to use one module per file; `module` and `end` remain
ordinary identifiers outside these exact playground delimiter lines.

The Theme selector offers **System**, **Dark**, and **Light**. System is the default
and follows live operating-system colour-scheme changes. The selected preference is
remembered in browser `localStorage`; if storage is unavailable, it still applies
for the lifetime of the current page.

Edited source is also restored from `localStorage`. A source-bearing Share URL takes
precedence on startup, stores source entirely in the URL fragment, and therefore does
not send program text to the static host. The Example selector offers only programs
that pass the complete current compiler pipeline.

## GitHub Pages

The repository workflow publishes the playground to
<https://hexagonal.zone/Hexagon/> after a successful push to `main`. It tests
and checks both the compiler and playground before deploying the static Vite build.
The deployed worker contains the platform-neutral compiler as browser JavaScript;
no compiler or application server runs behind the site.

The repository owner must enable the workflow once in **Settings → Pages → Build
and deployment → Source → GitHub Actions**. The workflow can also be started
manually from the Actions tab.

The ordinary `npm run build` retains Vite's root base for local work. The deployment
uses `npm run build:pages`, which sets the project-site base to `/Hexagon/`.

The experience is inspired by the TypeScript Playground without attempting to copy
its interface exactly. The primary view is a Hexagon editor beside a result panel
with user-facing tabs for runtime output, compiler errors, emitted JavaScript, the
TypeScript preview, and inferred top-level types.

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

- **Output** shows captured `console.log(...)` lines plus execution completion,
  timeout, and runtime-failure status. Calls also retain the worker's native browser
  console behaviour for DevTools.
- **Errors** shows structured compiler diagnostics. Selecting a diagnostic focuses
  its exact source span; safe fix-its may be applied here when the compiler supplies
  them in a future slice.
- **JS** shows readable ECMAScript modules emitted by Hexagon in a read-only Monaco
  model on supported desktop browsers. Generated specialization families are
  summarized in the default source-shaped view; the view selector exposes the
  complete module or any individual edition with its concrete types and byte size.
- **.d.ts** shows an inspection-only TypeScript preview for representable top-level
  bindings, also in a read-only Monaco model. It does not promote private Hexagon
  bindings into public exports.
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

Execution occurs outside the compiler worker. Every Run creates a fresh execution
worker, and completion, failure, or the two-second timeout terminates it without
losing compiler state or editor contents. The current accepted language surface
exposes only the compiler-defined console operation; the host-capability policy must
be revisited before broader FFI access can expose arbitrary browser facilities.

## Editor direction

**Monaco Editor is the primary desktop editor.** The current integration provides
Hexagon tokenization, compiler-owned diagnostic markers, inferred-type hover on
top-level binding names, and read-only JavaScript and `.d.ts` models. Completion and
definition navigation remain later language-service slices. This gives the
playground the same editor foundation and familiar feel as the TypeScript Playground
and VS Code without moving language semantics into the UI.

The integration uses Monaco's supported ESM build through Vite and a separately
bundled editor worker, not its deprecated AMD distribution. Monaco is dynamically
imported so it does not delay the textarea, compiler worker, or unsupported devices.

Monaco does not officially support mobile browsers. The playground is therefore Monaco-first on supported desktop browsers and retains a plain textarea editor for mobile, unsupported environments, initial loading, or editor-startup failure. The fallback must still support source editing, compilation, diagnostics in the Errors tab, generated views, and explicit Run; richer inline language services may be unavailable there. Switching to or from the fallback must preserve the current source and source version.

The textarea is that fallback, not a competing editor choice. One `SourceEditor`
adapter owns source reads, changes, focus, selections, diagnostics, binding hovers,
and theme changes across both implementations. Monaco replaces the textarea only
after both source and generated-code editors initialize successfully.

The editor adapter must consume compiler source positions through one explicit conversion boundary. It must not introduce a second position convention.

## Examples

Curated examples are grouped by language concept and appear only once their complete slice is available. Each example includes a stable identifier, title, description, source, and optional governing specification references.

Where practical, example source should be derived from or shared with conformance fixtures and book examples. The repository must avoid three manually copied versions that can drift independently.

The curated set contains the initial `hello-world` tour plus focused recursion,
union/match, and exact `Rat` programs. Every example is compiler-tested and
demonstrates a top-level `console.log(...)` effect without requiring public exports.
The `Rat` example exercises the canonical fundamental stdlib module through
`half + third`, selecting its imported `Num<Rat>` evidence.

## Testing

Pure playground state and protocol adapters use Vitest under the repository testing
doctrine. The production build verifies Monaco's ESM and worker bundling. A distinct
Vitest browser project remains the next step for automated DOM-level Monaco behavior.

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
    diagnostics.ts
    editor.ts
    execution.ts
    monaco.ts
    persistence.ts
    sharing.ts
    examples/
      index.ts
      hello-world.ts
      patterns.ts
      recursion.ts
```

The current UI keeps compiler, editor, and execution ownership separate. Compilation
runs through the complete compiler pipeline in a dedicated worker, Monaco uses its
own editor worker, and explicit Run evaluates the latest successful JavaScript in a
fresh execution worker with a two-second timeout.

## Initial delivery order

1. Exercise the direct compiler loop with the textarea fallback.
2. **Implemented:** clickable structured diagnostics with exact source selection.
3. **Implemented:** Monaco's ESM build with a lossless textarea fallback.
4. **Implemented:** binding-span hovers, markers, and generated-code models.
5. **Implemented:** isolated explicit execution with captured and native console output.
6. **Implemented:** curated examples, local persistence, and shareable URLs.
7. Add optional compiler-internal views for development and teaching.

## Decision record

### Initial editor decision

- Monaco Editor is the primary supported desktop editor.
- Integration uses Monaco's ESM build, not its deprecated AMD build.
- Monaco is dynamically imported and its editor worker is bundled separately by Vite.
- A plain textarea remains the mobile, unsupported-browser, loading, and failure fallback.
- Both editor paths share one source state and compiler position-conversion boundary.
