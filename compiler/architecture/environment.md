# Compiler Implementation and Environment

**Status:** Initial architecture decision. Exact package names, minimum versions, ECMAScript target profiles, and command-line syntax remain open. The testing tools are fixed separately by `testing.md`.

## 1. Four distinct questions

Hexagon keeps four concerns separate:

1. **Implementation language:** the language in which `hexc` source is written.
2. **Build toolchain:** the tools that check and compile the `hexc` source.
3. **Compiler host:** the environment in which a particular build of `hexc` runs.
4. **Program target:** the environments in which JavaScript emitted from Hexagon may run.

Choosing Node as the initial command-line host does not make Hexagon output Node-specific. Choosing TypeScript as the implementation language does not constrain the language accepted by `hexc` or the JavaScript it emits.

## 2. Implementation language

`hexc` is written in **TypeScript 7 or later**.

The compiler should use TypeScript deliberately: discriminated unions for phase representations, exhaustive switches, readonly data where appropriate, explicit public pass contracts, and the phase-qualified naming doctrine in `naming.md`.

The implementation is not initially self-hosted. Rewriting the compiler in Hexagon may be an interesting distant milestone, but it is not a v1 requirement and must not distort the first implementation.

## 3. TypeScript's Go-based toolchain

TypeScript 7's compiler and tooling are implemented as a native port in Go. This affects the speed and implementation of the TypeScript toolchain; it does **not** change the language of the `hexc` source.

Conceptually:

```text
hexc TypeScript source
  -> TypeScript 7 toolchain (implemented in Go)
  -> JavaScript build of hexc
```

The native toolchain is attractive for a compiler project because fast checking and builds support a large, strongly typed codebase. Hexagon should depend on the standard supported TypeScript package rather than on internal Go APIs.

Current upstream reference: [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

## 4. Compiler core and host adapters

The compiler core must be platform-neutral. Lexing, layout, parsing, resolution, checking, elaboration, and emission must not directly import Node filesystem, process, terminal, or path APIs.

Host capabilities are supplied through explicit interfaces. Conceptually:

```text
CompilerHost
  read source
  resolve module
  report or collect diagnostics
  provide compiler options
  receive emitted files
```

The exact interface is designed during Foundation, but its purpose is fixed: compiler semantics must not depend on a global filesystem or process.

Expected adapters:

- **Node host:** the initial CLI and ordinary local/project compilation.
- **Browser host:** in-memory source files for the playground, normally run in a Web Worker.
- **Test host:** deterministic in-memory files and captured output for unit, golden, and conformance tests.

Other adapters may be added without changing compiler passes.

## 5. Initial command-line environment

The first `hexc` command runs under **Node.js**.

Node is the pragmatic initial CLI host because it supplies filesystem access, process arguments, package installation, ESM loading, and integration with the JavaScript/TypeScript project ecosystem. The CLI is a thin Node adapter over the platform-neutral compiler core.

The intended launch shapes are conceptually:

```text
hexc <inputs/options>
npx hexc <inputs/options>
```

The npm package name, precise commands, project-file convention, watch mode, exit codes, and minimum Node version remain to be specified before release.

An installed CLI may eventually be packaged as a standalone executable, but that is a distribution choice rather than a compiler-semantics decision.

## 6. Programmatic and browser launch

The compiler core also exposes a programmatic API. The Node CLI calls that API; it does not contain a second compiler pipeline.

The playground will use a browser-compatible build of the same core with an in-memory browser host. Compilation should normally happen in a Web Worker so typechecking cannot block the user interface.

The browser build need not include Node project discovery, filesystem traversal, or terminal formatting. Those are adapter capabilities, not core compiler features.

## 7. JavaScript target doctrine

Hexagon emits portable, readable **ECMAScript modules**. Its goal is to produce JavaScript suitable for the environments in which modern JavaScript runs, including:

- browsers;
- Node.js servers and command-line programs;
- alternative server runtimes such as Deno and Bun;
- Web Workers and serverless/edge workers; and
- application shells and embedded environments that accept compatible ESM.

This is a portability doctrine, not a claim that every generated program runs unchanged everywhere. JavaScript environments share the language but not all host APIs. A program using the DOM belongs in a browser; a program importing Node filesystem APIs belongs in Node or a compatible host.

`hexc` must not insert Node-specific dependencies into otherwise portable output. Environment-specific capability enters through the program's explicit imports and FFI declarations.

## 8. Runtime portability

The Hexagon runtime should be environment-neutral ESM wherever practical. Core helpers and persistent collections must not depend on Node globals.

Platform-specific runtime integrations, if needed, live in explicit adapters or packages rather than in the universal runtime entry point. Importing a platform-neutral Hexagon module must not accidentally pull a filesystem, DOM, or process dependency into its output.

## 9. ECMAScript levels and compatibility

“Anywhere JavaScript runs” requires a concrete compatibility policy. Engines differ in supported ECMAScript features, and some output may need downleveling. The default selection rule is fixed by `javascript-target.md`: modern ESM using a release-frozen snapshot of features that have reached Baseline Widely Available, intersected with the other JavaScript hosts Hexagon claims to support.

Before the emitter is implemented, Hexagon must still specify:

- the v1 snapshot date and resulting feature inventory;
- the minimum supported Node version;
- whether `hexc` supports additional output profiles directly;
- which features require runtime helpers;
- how target choices interact with readable-output guarantees.

Older-environment downleveling is delegated to established JavaScript tooling. `hexc` does not insert general compatibility polyfills automatically.

## 10. Generated declarations

`.d.ts` output describes the JavaScript module emitted by `hexc`; it does not describe the Node CLI or expose compiler implementation details. A portable Hexagon module receives portable declarations. Environment-specific declarations arise only from its explicit foreign dependencies and exported surface.

## 11. Non-goals

The initial architecture does not promise:

- that the CLI itself runs unchanged in every JavaScript environment;
- that all host APIs are abstracted into one universal standard library;
- that `hexc` contains its own package manager or bundler;
- that Hexagon downlevels to every historical JavaScript engine; or
- that the compiler is compiled to native machine code merely because TypeScript's own toolchain is written in Go.

## 12. Decisions and open items

### Decided

- `hexc` source is TypeScript 7 or later.
- TypeScript's native Go implementation is the build/typechecking toolchain, not the source language of `hexc`.
- Node is the initial CLI host.
- The compiler core is platform-neutral and accessed through host adapters.
- The playground uses a browser build of the same compiler core.
- emitted programs are portable readable ESM unless their own explicit dependencies make them environment-specific.
- The default JavaScript feature set follows the release-frozen Baseline Widely Available doctrine in `javascript-target.md`.
- Older-environment downleveling is delegated to ordinary JavaScript tooling; `hexc` does not inject general compatibility polyfills.

### Open

- package manager, formatting, and build tools;
- npm package and executable names;
- minimum Node version;
- CLI commands and project configuration;
- compiler host interface details;
- v1 JavaScript-target snapshot, feature inventory, and minimum Node version;
- optional additional compatibility profiles; and
- standalone executable packaging.
