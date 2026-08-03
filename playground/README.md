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
  its exact source span. The repairs themselves are offered in the editor, through
  Monaco's lightbulb, from the same `Session.codeActions()` VS Code reads.
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
Hexagon tokenization, compiler-owned diagnostic markers, quick fixes, hover,
go-to-definition, find-references, rename, and read-only JavaScript and `.d.ts`
models. Completion remains a later language-service slice. This gives the
playground the same editor foundation and familiar feel as the TypeScript Playground
and VS Code without moving language semantics into the UI.

The integration uses Monaco's supported ESM build through Vite and a separately
bundled editor worker, not its deprecated AMD distribution. Monaco is dynamically
imported so it does not delay the textarea, compiler worker, or unsupported devices.

**Tokenization is the VS Code extension's TextMate grammar, not a Playground grammar.**
`editors/vscode/syntaxes/hexagon.tmLanguage.json` is run through `vscode-textmate` over
the Oniguruma WASM build — the same pair VS Code itself uses — and bridged into Monaco
by `src/monaco-textmate.ts`. Monaco's native format is Monarch, and Playground did
maintain a second grammar in it until #161; one language with two grammars meant every
token-inventory change had to be made twice, and silently wasn't (#145). The cost of
consolidating is `onig.wasm`, 473 KB raw / 162 KB gzipped, on a page that already
ships Monaco.

Playground's own `module` / `end module` notation is not `.hex` syntax, so it is not in
the shared grammar. It lives in `src/playground-module.tmLanguage.json`, a TextMate
injection Playground alone loads.

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
`half + third`, selecting its imported `Signed<Rat>` evidence.

## Testing

Pure playground state and protocol adapters use Vitest under the repository testing
doctrine. The production build verifies Monaco's ESM and worker bundling. A distinct
Vitest browser project remains the next step for automated DOM-level Monaco behavior.

Two files cannot be loaded outside a browser — `src/monaco.ts` needs a DOM and
`src/compiler-worker.ts` needs a `Worker` — so the decisions are kept out of them:
`src/monaco-mapping.ts` holds the translation of session answers into Monaco's
shapes and imports Monaco not at all, and `src/compiler-service.ts` holds the
worker's dispatch. Both are tested directly. What remains in the two shells is
registration and plumbing, and it is kept short enough to read. Anything with a
condition in it belongs in the tested half.

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
    compiler-service.ts
    analysis.ts
    workspace.ts
    workspace-source.ts
    language-services.ts
    monaco-mapping.ts
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

### Editor services (#222)

- Monaco's providers are backed by the compiler's `AnalysisSession`, called
  directly from the compiler worker. There is no language server in the browser
  and there is not meant to be one.
- A quick fix is not an LSP feature. `Session.codeActions()` computes it; the
  server is one caller and Monaco is a second. Routing through a protocol would
  mean de-noding the server's workspace discovery, manifest resolution and file
  watching — none of which the Playground uses — to reuse a layer of LSP-typed
  translation. Session to Monaco is one hop.
- **Revisit if, and only if, web VS Code becomes a goal.** `editors/vscode` declares
  `main` and no `browser` entry, so Hexagon does not run in vscode.dev. Supporting
  that *requires* a server in a web worker, and the Playground could then ride the
  result. It is not a reason to build one now.
- The editor buffer is not any compiled file, so every coordinate crossing the
  boundary goes through one map (`src/workspace.ts`). It refuses rather than
  approximates: an edit landing in the synthesized import prefix, or in a hosted
  library, is declined. `anchor` is the single documented exception, and it exists
  because a diagnostic must always be shown somewhere.
- Prose a user reads is written once and shared. `hoverMarkdown` lives in the
  compiler because both hosts render Markdown; only the wrapper is protocol. Two
  hand-written copies is what produced the divergence #222 reported.
- A refusal is a result, so it is passed through rather than filtered out. What
  the user sees differs by feature, and #222's premise that "Monaco already
  implements them" is false for code actions. A rename refusal is shown; a
  code-action refusal is not displayed at all, and a rename refusal only if it
  arrives before the prompt opens — after that it goes to a notification
  service that standalone Monaco binds to `console.log`. Five review rounds
  produced five different explanations of *why*, each wrong, so the explanation
  lives in #253 — where it can be corrected without touching code — and the
  code comments claim only what was measured. The wrong answer would be to send the refusal as
  an *enabled* action: one that appears applicable and does nothing is worse
  than a missing one.

### Tokenization (#161)

- There is one Hexagon grammar, `editors/vscode/syntaxes/hexagon.tmLanguage.json`.
  Playground consumes it; it does not copy it and does not generate from it.
- Playground therefore tokenizes with `vscode-textmate` over Oniguruma, not Monarch.
- Playground-only syntax goes in a Playground-side injection, never in the shared
  grammar, which stays the `.hex` language.
- This makes the two editors wrong in the *same* way, which is the point. It does not
  make them right: `spec/lexer.md` §8.1's `<` and §4.2's contextual keywords are beyond
  regex by construction. The layer that cannot be wrong is semantic tokens from the
  compiler, and that belongs to `language-server/`, not here.
