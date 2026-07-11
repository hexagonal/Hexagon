# Compilation Roots and Running Modules

**Status:** Initial architecture decision. Binding on compiler and CLI behaviour; exact command spelling and project-configuration syntax remain open.

## 1. Doctrine

Hexagon has **no special language-level entry point**. There is no required `main` function, no reserved `main` name, and no distinguished function signature that turns a module into an application.

A compiler host selects one or more **root modules**. Imports determine the rest of each root's acyclic source graph. Evaluating a selected root module runs its top level according to [Modules §8](../../spec/modules.md#8-loading).

```text
selected root module
  -> imported modules, depth-first in source order
  -> root module top level
```

This is the ordinary ESM model with Hexagon's stricter acyclic graph and deterministic initialization rules. Program structure does not require a second ordering file or a wrapper invented by the language.

## 2. Building roots

A build request supplies one or more source files as roots. For each root, the compiler:

1. resolves its transitive import graph;
2. rejects any cycle;
3. checks whole-graph rules such as instance coherence;
4. compiles the modules required by that root; and
5. emits ordinary ESM and the applicable `.d.ts` files.

Two roots may share modules. The project system should avoid compiling shared unchanged modules twice while preserving the same result as independent compilation.

There is no semantic distinction between a "library module" and an "application module." A module may export values, perform top-level `Unit` effects, do both, or do neither. Whether a consumer imports an emitted module or selects it to run is a host and tooling decision.

## 3. Running a root

A run request selects exactly one root module. The compiler produces its ESM graph, then the chosen host evaluates the emitted root module. Its imports and top-level items execute under the Modules specification; no generated call to `main` is inserted.

Conceptually:

```text
hexc build app.hex
hexc run app.hex
```

These spellings communicate the intended operations but do not freeze the final CLI syntax.

For example:

```hexagon
import { greet } from "./greeting"

print(greet("Hexagon"))
```

Selecting this file as the run root evaluates `greeting` first and then calls `print` at the root module's top level.

## 4. `main` is ordinary

`main` is an ordinary lowercase identifier. A program may declare, export, import, or call a function named `main`, but the compiler and runtime attach no special meaning to it:

```hexagon
let main() = print("not called automatically")
```

The declaration above does nothing unless ordinary program evaluation calls `main()`. A diagnostic, editor, or project template must not imply otherwise.

This keeps module semantics uniform: importing a module and running it as a root differ only in which module the host asks ESM to evaluate, not in hidden language behaviour.

## 5. Arguments, exit status, and host capabilities

Command-line arguments, process exit, environment variables, filesystem access, browser globals, and similar facilities are host capabilities. They do not enter through a magic `main` signature.

Portable Hexagon code receives such capabilities through explicit standard-library or FFI modules. The names and APIs of those modules belong to the standard-library and FFI work; this document fixes only that the root mechanism does not provide implicit parameters or process semantics.

A Node CLI adapter may translate an uncaught exception or failed compilation into a process exit status. That is CLI behaviour, not the type or return value of a Hexagon entry function.

## 6. Browser and test hosts

The browser playground runs a synthetic in-memory root module using the same compiler operation. Explicit Run evaluates that root in the execution sandbox; editing and compilation alone do not evaluate it.

The test host may select fixture modules as roots and capture their emitted files or observable top-level behaviour. It must not require fixtures to declare `main`.

## 7. Project configuration

A future project file may name default build roots, a default run root, output locations, and target profiles. Such configuration saves command-line repetition; it does not create new language semantics.

Open tooling details include:

- final `build` and `run` command spelling;
- how roots are discovered or listed in a project file;
- output-directory and shared-module layout;
- watch-mode invalidation across several roots; and
- host-specific execution and exit-code policy.

None of these may introduce a mandatory or implicitly invoked `main`.

## 8. Decision record

### Initial decision

- Hexagon has no special `main` or language-level entry function.
- Compiler hosts select root modules; imports determine their graphs.
- Evaluating the selected root's ordinary ESM top level runs the program.
- Build accepts one or more roots; run selects one root.
- Library and application are tooling roles, not distinct module kinds.
- Arguments and process behaviour enter through explicit host APIs, not an entry-function signature.
- Project configuration may choose roots but cannot change these semantics.
