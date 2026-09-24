# Node compiler alpha: plan and contract

**Status:** Ready for implementation review, 2026-09-23. The user has selected a Node compiler
alpha and requested this written plan. The command and root behaviour in section
8, build-output behaviour in section 9, diagnostics behaviour in section 10 and
foreign JavaScript scope in section 11 and support policy in section 12 are
approved. Engineering choices are recorded separately from user approvals;
this document grants no publication authorization. The discovery-error
distinction in section 13.2 is also approved. Sections 13–16 record the source
audit, engineering recommendations and root-selection implementation design.

## 1. Goal

A user with a supported Node installation can install Hexagon from npm, check
and compile a project, and run the emitted JavaScript with Node without cloning
this repository or building the compiler's TypeScript.

Illustrative first-use commands:

```sh
npm install --save-dev @your-scope/hexagon
npx hexc check Main.hex
npx hexc build Main.hex --out-dir dist
node dist/Main.js
```

The npm name is a placeholder. The last command assumes the source declares
module `Main`; emitted paths follow module names and package layout, not source
filenames. These commands describe the intended product, not a tool available
today.

## 2. Existing foundations

- The [compiler](../compiler/src/index.ts) exposes `compileProject` and emits
  JavaScript and declaration text.
- The [Node host](../host/README.md) discovers projects, source files and
  installed Hexagon dependencies using `hexagon.json` and npm's directory layout.
- Standard-library sources are integrated with the compiler.
- Existing runtime scripts and CI exercise emitted experimental file and
  standard I/O programs on Node.
- The [compilation-root doctrine](../compiler/architecture/compilation-roots.md)
  establishes ordinary module evaluation, with no required or implicitly called
  `main` function. CLI spelling remains open there.

At the start of this plan, the compiler and host had private package manifests
and the missing product layer was the CLI, complete output writing,
distributable packaging and verification of the installed artifact. Sections 17
and 18 record implementation progress.

## 3. Delivery sequence

### Step 1: Agree on the alpha contract

Resolve the proposals and open decisions in sections 4 and 5. Review existing
module, package and foreign-import rules before fixing the output contract.
Record concrete command examples and acceptance criteria in this document.

**Done when:** the user approves the contract and the decisions needed for
implementation are explicit. Writing this draft does not complete that gate.

### Step 2: Implement the CLI

Connect the shared Node host to the compiler. Add argument handling, explicit
root selection, project discovery, terminal diagnostics, exit codes, help and
version output. Reuse existing ownership and dependency rules rather than
creating a second project model.

First implement the compiler root-selection prerequisite identified in section
13; the API at the start of this plan did not provide the approved boundary.

**Done when:** `check` works against real filesystem projects, reports source
locations and fails predictably for invalid arguments, unreadable inputs and
compiler errors. Build requests can reach the compiler and output-writer boundary.

### Step 3: Implement reliable build output

Write the complete emitted graph: ordinary modules, required standard-library
modules, runtime support and applicable declarations.
Preserve compiler-selected paths and import relationships. Implement the agreed
ESM boundary, output ownership, stale-file cleanup and failure behaviour.

**Done when:** representative emitted roots run under Node, repeated builds
remove obsolete owned artifacts safely, and failed compilation writes no output.

### Step 4: Package and verify installation

Build one npm release artifact containing the executable, compiled compiler and
host, and all required assets. Install its tarball into a clean directory outside
the checkout. Test the installed executable on the supported Node/platform matrix.

**Done when:** the acceptance cases in section 6 pass without repository files,
development dependencies or a TypeScript build on the user's machine.

### Step 5: Document and publish the alpha

Write a short getting-started guide and automate release creation and validation.
Choose the public npm name and alpha version/tag. Publish only after explicit
authorization; verify installation from the registry afterward.

**Done when:** a new user can follow the published guide using the registry
package, and the published version is verified through that same workflow.

## 4. First-release scope

| Area | Proposal |
|---|---|
| Distribution | One npm package containing CLI, compiler, host and standard library |
| Executable | `hexc` |
| Checking | `hexc check <root.hex> [more-roots.hex ...]` |
| Building | `hexc build <root.hex> [more-roots.hex ...] [--out-dir <directory>]` |
| Information | `hexc --help` and `hexc --version` |
| Roots | Explicit source files; no automatic root selection |
| Discovery | Existing host and `hexagon.json` rules |
| Output directory | `dist` by default |
| Output | Complete required JavaScript graph and applicable `.d.ts` files |
| ESM boundary | Generated output `package.json` declaring `"type": "module"` |
| Execution | User invokes Node on the emitted root; no `hexc run` initially |
| Checking effects | Neither checking nor building evaluates user code |
| Compiler errors | Useful diagnostics, unsuccessful exit, no new output |
| Rebuilds | Remove obsolete compiler-owned files; preserve unrelated files |
| Node | One explicit minimum supported LTS version, verified in CI |
| Platforms | Linux, macOS and Windows, contingent on passing installation tests |
| Stability | Experimental release; no stable public compiler API promise |

Deferred: watch mode, bundling, source maps, standalone native executables,
automatic root selection, a dedicated package manager and completion of every
remaining language feature. Experimental library APIs retain their status.

## 5. Decision resolution

1. **Command and root contract: approved in section 8.** The approved
   behaviour is reconciled with existing compiler APIs in sections 13 and 16;
   output-path and auxiliary command details are in section 14.
2. **Output ownership and failures: user-facing behaviour approved in section 9.**
   Section 14 specifies ownership, overlap safeguards, manual edits, custom
   paths and filesystem failures. Implementation must validate those safeguards.
3. **Foreign JavaScript imports: alpha scope approved in section 11.**
   External output locations follow section 14, without a promise of automatic
   access to the project's `node_modules`.
4. **Diagnostics and process status: user-facing behaviour approved in section
   10.** Section 14 specifies formatting, stdout/stderr use and numeric exit codes.
5. **Compatibility: support policy approved in section 12.** Establish and test
   the exact minimum Node 24 update. Distinguish the version needed to run the
   compiler from requirements of emitted programs and explicitly selected host APIs.

The npm name, ownership and release credentials must be settled before
publication. They need not block the initial CLI implementation once the contract
above is approved.

## 6. Acceptance cases

Exercise these through the installed tarball's executable, not only compiler API
tests:

- Help and version work from outside the repository.
- A simple root checks, builds and executes on Node.
- Multiple modules and multiple explicit roots produce correct shared output.
- Standard-library use and runtime support resolve correctly.
- A separately installed Hexagon source dependency compiles and runs.
- Supported foreign imports work under the agreed deployment/output rules.
- Generated declarations resolve their emitted supporting files.
- Experimental file and standard I/O examples execute successfully on Node.
- Compiler errors report the source file and location, return failure and leave
  existing output untouched; `check` writes nothing.
- Invalid arguments, missing files and filesystem failures report actionable errors.
- Rebuilding removes obsolete owned output and preserves unrelated files.
- Paths containing spaces and platform-specific path forms work on each claimed OS.

The decisive release gate is a clean installation that can compile and run a
program with no access to the Hexagon checkout. The registry installation must
repeat the essential smoke cases after publication.

## 7. Progress

- [x] Save the delivery plan and contract.
- [x] Step 1: Approve user-facing behaviour and record the engineering design.
- [x] Step 2 prerequisite: Implement and validate compiler root selection.
- [x] Step 2: Implement the CLI.
- [x] Step 3: Implement reliable build output.
- [x] Step 4: Verify installed packages on Windows, Linux and macOS with Node 24.
- [ ] Step 5: Document, authorize, publish and verify the alpha.

## 8. Approved command and root behaviour

Approved by the user on 2026-09-23 following a walkthrough of the commands and
which files they compile:

- `hexc check Main.hex` checks the selected program, reports mistakes, and neither
  writes output nor runs the program.
- `hexc build Main.hex` checks the selected program and writes JavaScript into
  `dist` by default, under the project directory as approved in section 9.
- Users run the emitted root with Node, for example `node dist/Main.js` when the
  source declares module `Main`.
- Both commands require explicit source-file roots; the CLI does not guess them.
- Input file paths are interpreted relative to the invoking working directory.
- Checking and building cover the selected roots and their transitive imports.
  An unrelated unfinished example does not block compilation merely because it
  exists in the project. Discovery and project-structure validation may still
  inspect other files and report structural errors.
- Multiple roots are allowed when they belong to the same project.
- Simple projects without `hexagon.json` follow the existing host's implicit
  manifest and project-discovery rules.
- Execution evaluates the emitted module's top level. No function named `main`
  is required or called automatically.

These decisions approve the behaviour, not a claim that the current compiler
already implements every required boundary.

## 9. Approved build-output behaviour

Approved by the user on 2026-09-23:

- The default output directory is `dist` within the project directory.
- Hexagon maintains a record of the files it generated.
- A successful rebuild replaces its generated files and removes obsolete
  generated files from the previous build.
- Unrelated files are preserved. If a new generated file would overwrite an
  unrelated file, the build stops with a clear explanation.
- Compilation errors leave the previous build untouched. The command clearly
  reports that the new build failed.

For example, if an earlier build generated `dist/Greeting.js` and the new program
no longer needs it, the next successful build removes it. A user-created
`dist/notes.txt` remains untouched.

The ownership-record format and filesystem-write failure mechanism are specified
as engineering choices in section 14. This approval does not establish crash-atomic
output replacement or a policy for user edits to previously generated files.

## 10. Approved diagnostics behaviour

Approved by the user on 2026-09-23:

- Source diagnostics show the filename, line number, relevant source and a plain
  explanation. Failures without a source location, such as invalid arguments,
  explain the problem without inventing one.
- Errors prevent a build; warnings allow it.
- Commands return a process status that lets editors and automated builds
  distinguish success from failure.
- Unexpected compiler failures are clearly identified as internal compiler
  errors rather than attributed to the user's program.
- A failed rebuild caused by compilation errors explicitly reports:
  `Build failed. Previous output was left unchanged.` This statement is used only
  when true; filesystem-write failures require their own accurate report.

Exact numeric exit codes and formatting mechanics are delegated engineering
details, recorded in section 14.

## 11. Approved foreign JavaScript scope

Approved by the user on 2026-09-23, following the existing
[foreign-import rules](ffi-part4-extern-bindings.md) and [package layout](packages.md):

- Users install JavaScript npm dependencies with npm. Generated programs load
  those dependencies through normal runtime resolution.
- Users place their own JavaScript files where the emitted imports expect them.
  The alpha CLI does not automatically copy or bundle foreign files.
- Foreign import specifiers are preserved. Relative paths resolve from the
  emitted importing module, not the Hexagon source file.
- For example, `dist/Main.js` importing `"./helper.js"` requires a file at
  `dist/helper.js`. A user-provided helper is unrelated output and is preserved
  during rebuilds, subject to the collision refusal in section 9.
- Successful compilation checks the Hexagon side of the boundary. It does not
  guarantee that foreign dependencies exist or behave as declared. Missing
  dependencies fail when Node loads the program.
- The getting-started material includes a working npm dependency example and a
  local JavaScript example. Automatic copying is deferred.

Output relocation does not make JavaScript dependencies self-contained. The
custom-output policy in section 14 respects that existing boundary.

## 12. Approved Node and platform support policy

Approved by the user on 2026-09-23:

- Node 24 LTS is the first supported Node version family.
- Installation guidance recommends the latest Node 24 update.
- Testing establishes the exact minimum supported Node 24 update; it is not
  inferred from the developer's installed version.
- Installation, compilation and execution are tested on Windows, macOS and Linux
  before those platforms are advertised as supported.
- Older and newer Node version families receive no compatibility promise until
  tested. This initial scope does not permanently restrict Hexagon to Node 24.

The user's local shell was verified during this discussion as running Node
v24.18.0 through Homebrew's `node@24` package. No upgrade was needed to match
the selected version family. That observation is not a minimum-version test.

CI must name the approved Node family explicitly rather than use a moving
`lts/*` selection for the alpha compatibility gate. The minimum-version test and
latest-update test should both exercise the installed release artifact.

## 13. Source audit and compiler prerequisite

Inspected on 2026-09-23. This is source inspection, not a packaged-runtime test.

| Boundary | Finding |
|---|---|
| Root selection | `compiler/src/project.ts`: `ProjectOptions` has no roots option. `compileProject` gathers supplied sources and visits every seated module. Passing all discovered files therefore checks unrelated bodies. |
| Output selection | Emission starts from all ordinary compiled modules. Required edges also include companion operations, specializations and runtime imports; source-written imports alone are insufficient. |
| Discovery | `host/src/packages.ts`: `discoverPrograms` takes directory roots and can return nested projects. The CLI must select the project owning each requested file. |
| Packaging | Host sources import `../../compiler/src/index.js`, and the host has no production build script. Copying the host directory into a package does not make it independently installable. |
| Artifacts | The writer must consume all three `CompiledProject` categories: `modules`, `runtimeDeclarations` and `runtimeGlobals`, preserving their compiler-provided layout. |
| Diagnostics | Source spans, secondary labels, notes and fixes already exist. Terminal rendering belongs in the CLI. |
| Bundle precedent | The language server already bundles its compiler/host imports with esbuild. The CLI can package the same internal boundaries without runtime repository imports. |

### 13.1 Required compiler work

Add opt-in root selection in the compiler, preserving the current whole-project
default for existing callers. The CLI supplies canonical identities of selected
project source files. The compiler owns package-aware resolution and traversal;
the CLI must not maintain a second import parser or compile everything and hide
errors afterward.

Root selection must respect module activation, coherence,
companion availability and compiler-generated runtime dependencies. Multiple
roots are checked together. Output selection must use the compiler's complete
dependency information, including declarations, not a text scan of emitted code.

### 13.2 Approved diagnostic boundary

The module specification makes project-wide identity and layout rules apply to
unimported modules too. Discovery parses files to find those declarations, and
some malformed source cannot be reliably separated into headers and bodies.

**Approved by the user on 2026-09-23:** discover and parse all project/package sources,
retaining lexical, syntax and module-identity errors across that discovery set;
resolve/check module bodies only when the selected program requires them. An
unrelated example with a type error does not block a build, but malformed syntax
or conflicting module names can. Excluding unfinished files through the existing
manifest is the way to remove them from discovery entirely.

This clarifies section 8's structural-error exception and narrows the earlier
plain-language promise about unfinished examples. The user approved this
distinction after the audit identified the discovery requirement.

Section 16 specifies the API and diagnostic staging. Selecting a file selects
all modules declared in it; this is an explicit build selection, not an implicit
import or execution relationship between modules sharing a file.

## 14. Engineering recommendations

These are engineering choices proposed to complete the contract, not additional
user approvals or implemented features.

### 14.1 Commands and paths

- Support `--help`, `--version`, `check`, `build` and `--` to end option parsing.
  Unknown options and missing option values are usage errors.
- Canonicalize source-file identities, deduplicate repeated arguments and reject
  directories or non-`.hex` roots. Explicit roots do not override exclusions.
- Resolve manifest ownership using the shared host. Without an enclosing
  manifest, use the first root's parent as the implicit project directory;
  other roots must belong to that same discovered project. A manifest establishes
  a wider project when needed.
- Resolve explicit relative `--out-dir` paths from the working directory. The
  default is still the project's `dist`, independently of the working directory.
- Allow external output directories, documenting that foreign dependencies must
  be available from their emitted locations. Do not copy `node_modules` or
  promise arbitrary relocation of foreign imports.
- Print emitted root paths on successful builds so users can find their entry
  files without guessing from source filenames.

### 14.2 Output ownership and failures

- Reserve `.hexc-output.json` within output for a versioned record of the owning
  canonical project directory, compiler version, roots, generated relative paths
  and content hashes.
- Each successful invocation replaces that output directory's previous build
  set. Build multiple roots together or use separate output directories to keep
  independently built programs.
- Treat generated `package.json` as an owned artifact. A pre-existing unowned
  file at that path is a collision even when its contents match.
- Refuse malformed or unsupported ownership records and another project's output.
  Do not infer ownership from a generated-looking filename.
- Check saved hashes before overwriting or deleting owned files. Refuse to destroy
  manual changes and identify the file the user needs to preserve. Missing owned
  files may be regenerated.
- Validate all artifact/record paths for containment, duplicates and filesystem
  case collisions. Refuse symlink traversal in output and reserved metadata paths.
  Never recursively delete the output directory.
- Reject output at the project root, inside a dependency directory, or over any
  source or manifest. Custom output must not become a new source-discovery input.
- Complete compilation and collision checks before changing generated files.
  Stage replacement artifacts, back up affected owned files and commit the
  ownership record last. Attempt rollback on handled write failures.
- Do not promise whole-directory crash atomicity. If recovery fails, report the
  affected files and recovery location; never claim unchanged output after partial
  writes. An output lock rejects concurrent writers, and an interrupted-transaction
  marker prevents the next build from silently accepting partial output.

### 14.3 Diagnostics

- Exit `0` for success (including warnings/help/version), `1` for compilation,
  project or filesystem failures, `2` for invalid invocation and `3` for an
  unexpected internal failure.
- Write diagnostics and failure summaries to stderr; help, version and successful
  build summaries to stdout. Colour is unnecessary for the alpha.
- Render one-based lines/columns, source excerpts, secondary labels and notes.
  Preserve the compiler's diagnostic content rather than matching message text.
- Include tool version and stack information for internal failures; ordinary
  program mistakes do not display JavaScript stacks.

### 14.4 Release packaging and compatibility

Create a dedicated `cli/` workspace. Bundle its executable, compiler and host as
an ESM Node artifact with a `#!/usr/bin/env node` entry and npm `bin` mapping.
Bundling the tool is independent of bundling user programs, which is deferred.
Include license and getting-started documentation; exclude test infrastructure.
Do not expose a stable compiler-library API from the first CLI package.

Generate embedded standard-library sources during release preparation or verify
that checked-in generated sources match their canonical inputs. All required
assets must be in the tarball. Installation must not build TypeScript or read
files from the development checkout.

Use an alpha prerelease version and the npm `alpha` tag. Installation examples
must include that tag until a deliberate release to `latest`. The public package
name and publishing identity remain release-time decisions.

Determine the minimum Node 24 update with installed-artifact tests, then record
the exact tested range in `engines.node`. Neither the TypeScript target nor the
developer's version proves minimum-version compatibility. Test that minimum and
the latest Node 24 update on each claimed OS.

## 15. Next work and additional acceptance cases

The discovery-error distinction is approved and the root-selection design is
recorded in section 16. Implement and test that compiler prerequisite before
connecting the CLI and output writer. Publication remains separately authorized.

Add these acceptance cases to section 6:

- An unimported module's type error does not fail a selected-root check; importing
  it does. Structural errors remain project-wide. Syntax-error expectations
  follow the decision in section 13.2.
- Multiple legal modules in a selected file are all roots; shared dependencies
  are handled consistently, and conflicting activated instances are refused.
- Companion, specialization and runtime dependencies all appear in runnable
  output.
- Existing whole-project compiler callers retain their previous behaviour.
- Nested manifests, exclusions, manifestless projects and symlink aliases have
  consistent ownership between CLI and editor.
- A foreign helper survives rebuilding. Collisions and manually edited generated
  files fail before output changes.
- Corrupt ownership records, concurrent builds, interrupted transactions and
  simulated write failures cannot produce false success or unsafe cleanup.
- Installed-tarball tests exercise JavaScript execution and TypeScript declaration
  consumption, including all four compiler artifact categories.

Audit validation: source inspection and Markdown whitespace checking only. No
CLI/compiler implementation or runtime compatibility tests were performed here.

## 16. Root-selection implementation design

This section is the engineering design for the approved selection behaviour.
It changes the compilation request, not the language's module or import rules.

### 16.1 API and identities

Add an optional `roots: readonly Source.FileId[]` field to `ProjectOptions`.
Each identity must name a file supplied in `compileProject`'s first argument,
not a dependency or embedded standard-library file. The host retains ownership
and path validation; the compiler stays filesystem-free.

An omitted field preserves current whole-project behaviour. A provided empty
list or unknown root identity is invalid API usage and throws a clear argument
error. The CLI rejects missing roots before invoking the compiler. Repeated
identities are deduplicated. Each selected file contributes all its declared
modules, including the ordinary structural diagnostics of invalid declarations.
Dependencies between those modules remain explicit imports.

Return root-to-emitted-module metadata with `CompiledProject` so the CLI can
report output entry paths without deriving them from filenames or reparsing
source. A selected file can have multiple entries. Add this result metadata
without removing or changing existing artifact fields.

The result field is `roots: readonly CompiledRoot[]`, where each row has
`fileId: Source.FileId`, `sourcePath: string` and
`modules: readonly { name: string; path: string }[]`.
Rows follow deduplicated request order; modules follow their source declaration
order. Paths use the compiler's existing `.hex` layout-address convention, which
the output writer converts to `.js`/`.d.ts`. Omitted-root requests return an empty
metadata array rather than inventing execution entry points.

### 16.2 Discovery, recognition and activation

Keep three distinct operations:

1. **Discovery:** read/lex/layout/parse all supplied source, build the complete
   package/module index and enforce project-wide identity rules. Preserve all
   diagnostics from these phases under section 13.2.
2. **Recognition:** retain enough declaration/interface information to recognize
   selected data, companion providers and instance providers, including a
   provider that is unavailable because its implementation was not activated.
   Recognition is not a request to check that provider's implementation body.
3. **Activation:** selected root modules seed full-module traversal. Full imports
   activate implementations. Existing implicit prelude availability remains
   unchanged. Only required bodies are resolved, checked and elaborated.

The current implementation builds provider tables after resolving every full
source. Simply shortening `ordered` would lose unavailable-provider information;
continuing to resolve/check every source would violate root selection. Separate
the interface-recognition work from activated-body work explicitly, reusing the
compiler's declaration and data machinery rather than inventing CLI inference.

Recognition may inspect declarations outside the activated set. Its diagnostics
become relevant when the selected program needs that interface; unrelated body
errors do not. An unavailable provider remains unavailable and receives the
existing full-import repair. Searching for providers must never activate one.

### 16.3 Diagnostic and cycle boundaries

Keep diagnostic provenance at the phase or operation that produces it. Do not
classify errors by message text or discard errors solely by source filename:
one file may contain both needed and unneeded modules or parts.

| Diagnostic | Selected-root request |
|---|---|
| Host read/manifest/package-set failure | Retained for the discovered project/package set |
| Lexing, layout, parsing, module naming or duplicate/layout identity | Retained across discovered source |
| Unresolved import in an unused implementation | Not reported unless that import is needed to obtain a required interface/data part |
| Invalid selected data declaration or required signature | Reported |
| Error in an unselected implementation body | Not reported |
| Full/data dependency cycle | Reported when reached in the required part graph |
| Instance coherence conflict | Judged over activated implementations according to the existing rules |
| Backend/declaration-emission failure | Reported for required output |

The compiler currently resolves imports, accumulates data selections and visits
cycles across all seated modules. Move those semantic obligations behind the
required-part traversal for an explicit-root request. Merely changing the final
emission seed does not satisfy this contract. Standard-library initialization
and cache invariants must remain valid in both request modes.

### 16.4 Output closure

Seed output with the selected full roots and traverse the complete compiler
dependency information. Include declaration-only dependencies as well as
executable imports. Existing specialization, companion,
instance-member, enum and runtime edges must remain represented.

Do not turn an output edge into a new source-language activation rule. Provider
availability is decided before emission; emission materializes the support that
the already-valid selected program requires. Derive program-level runtime
artifacts from the final emitted set as the compiler already does.

Keep stable ordering for a fixed request and test cold and warm standard-library
caches. File IDs, module layout and nominal identity must not depend on whether
an unrelated implementation body was checked.

### 16.5 Implementation slices and focused evidence

1. Introduce the request/result metadata with omitted-roots regression tests and
   invalid-root API tests.
2. Separate discovery/recognition diagnostics from required-body work. Test one
   unused type error, the same file with a syntax error, and duplicate names.
3. Implement required traversal. Test multiple roots, multiple modules
   in one root file, unused unresolved imports and unreachable versus reachable
   cycles.
4. Verify provider recognition, activation and coherence in both request modes.
5. Verify complete JavaScript/declaration output closure and cold/warm cache
   equivalence. Execute emitted graphs on Node, then run affected compiler and
   editor suites before the CLI consumes the new API.

The implementation must be reviewed for semantic-boundary changes, especially
provider recognition and cycle diagnostics. If these require changing an owning
language specification rather than adding the approved request mode, return that
specific decision to the user before proceeding.

## 17. Implementation record

The first implementation change adds compiler root selection and root metadata,
keeps interactive analysis sessions in whole-project mode, and adds declaration
recognition for inactive implementations.

`compiler/scripts/test-root-selection.mjs` writes all artifact categories into a
temporary directory outside the checkout, executes the selected roots with Node,
and type-checks a TypeScript consumer against their declarations. It is wired
into the existing CI runtime-test step. This is compiler output validation, not
yet installation testing of a CLI tarball.

Validation on local Node v24.18.0:

- Compiler suite: 198 files, 6,017 passing tests and one expected failure.
- Language server: 170 passing tests in each of its ordinary and linked runs.
- Playground: 238 passing tests.
- Compiler, host, language-server and Playground typechecks passed; compiler build
  passed.
- Selected-root disk execution and TypeScript declaration consumption passed.
- Existing emitted file and standard I/O scripts passed on Node.
- `git diff --check` passed.

Independent Sol Medium review is complete. Its two findings were fixed and
rechecked: runtime globals now include data-unit requirements, and data-only
traversal retains required import-conflict diagnostics while ignoring unrelated
missing imports. This compiler prerequisite alone did not provide a `hexc`
executable. Section 18 records the subsequent command and packaging work.
These compiler checks do not establish Windows/Linux release compatibility;
those remain installed-artifact gates.

## 18. CLI and local package implementation

The `cli/` workspace now provides `hexc check`, `hexc build`, help, version,
explicit roots and custom output directories. It uses the shared host's project
and dependency discovery and the compiler's selected-root API. Diagnostics retain
source locations and excerpts; expected failures use the approved exit codes.

The output writer handles all compiler artifact categories and writes an ESM
`package.json`. Its ownership record tracks generated paths and hashes. Rebuilds
remove stale owned artifacts, preserve unrelated helpers and refuse to overwrite
manual changes or unowned collisions. Locking, staging, backups and recovery
markers implement the handled-failure contract in section 14.2.

The npm tarball contains a bundled executable, package metadata, license and
getting-started guide. It requires no compiler checkout or development install
at runtime. The private name `hexagon-cli-workspace` and version
`0.1.0-alpha.0` are local packaging placeholders; no registry publication has
occurred. Build preparation regenerates the embedded standard library.

`cli/scripts/test-package.mjs` packs and installs the tool in a temporary project
outside the checkout and exercises its installed executable. The local tested
host is Node v24.18.0 on macOS. `.github/workflows/cli.yml` runs installation
checks for Node 24.18.0 and the latest Node 24 update on macOS, Linux and Windows.
All six jobs passed for commit `1a2bc4c` in
[the platform run](https://github.com/hexagonal/Hexagon/actions/runs/35871205022).
The minimum-version jobs ran v24.18.0 on all three systems; the `24` selector ran
v24.21.0 on Linux and v24.20.0 on macOS and Windows. Subsequent jobs explicitly
check for the latest update rather than relying on cached runner versions.

Local validation:

- CLI typecheck passed, including an isolated source tree with only the CLI's
  development dependencies available.
- CLI and writer suite: 5 files, 29 passing tests.
- Installed-tarball checks passed: command help/version and failures, checking
  without output, compilation and execution, Hexagon/npm dependencies, bare data,
  strict TypeScript declaration consumption, multiple roots and modules, custom
  output from a nested working directory, standard I/O and file reads/writes.
- Rebuild checks passed for stale cleanup, preservation of foreign helpers,
  refusal of manual generated-file edits and unchanged output on compiler errors.
- Writer regression tests cover lock/recovery records, malformed ownership,
  collisions, symlinks, handled-write rollback and case-only owned-file/directory
  renaming, including recovery of original names after a failed write.
  Case-distinct project ownership is tested when the filesystem supports it.
- Packaging regenerated 49 embedded standard-library sources with no source
  drift. The tarball contains exactly the executable, README, license and package
  metadata.

### Nested directory-rename fix

After authorization to continue, the remaining `Foo.Bar.Main` to `FOO.Bar.Main`
rebuild failure was fixed. The writer now removes verified-owned empty descendant
directories deepest-first. It tracks newly created output parents so rollback
restores original spelling even if the first artifact cannot be installed.
Tests cover nested renames, first and later write failures, subsequent rebuilds
and refusal to disturb unrelated helpers. The installed-tarball test also builds,
renames, rebuilds and executes this exact module example, checking the actual
directory spelling. All 28 CLI/writer tests and the installed-package checks pass
on local Node v24.18.0/macOS. Independent focused review found no remaining
blocker in the nested rename or rollback fixes. This was followed by the Windows
portability fixes and platform validation below.

### Platform validation and publication preparation

[PR #1011](https://github.com/hexagonal/Hexagon/pull/1011) contains this work.
Windows CI exposed checkout line-ending drift and a native-path versus normalized
root comparison. Scoped Git attributes now keep canonical stdlib inputs and their
generated embedding LF-only. The CLI normalizes discovered paths for ownership,
source identities and root lookup. The 29-test suite and installed-package checks
pass; independent review accepted both fixes. Normalized paths retain drive and
UNC identities, and native paths remain usable for filesystem reads.

Next release work is to choose the public npm name and publishing identity, obtain publication
authorization, then verify a registry installation. The local installation guide
is `cli/README.md`.
