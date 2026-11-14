# Compiler Testing Doctrine

**Status:** Initial architecture decision. Binding on compiler test infrastructure; exact dependency versions and command spelling are selected and pinned during Foundation.

## 1. Tool choice

Hexagon uses **Vitest** as its primary TypeScript test framework.

Vitest owns test discovery, assertions, watch mode, filtering, snapshots, parallel execution, and coverage reporting. Tests import its APIs explicitly rather than relying on global `test`, `describe`, or `expect` names.

Hexagon additionally uses **fast-check** for property-based and generative tests. Fast-check complements Vitest; it is not a second test runner.

TypeScript type checking remains a separate required operation. Vitest's ability to execute TypeScript does not replace checking the compiler with the supported TypeScript toolchain.

Conceptually, the required development commands are:

```text
check          type-check compiler and tests
test           run the Vitest suite once
test:watch     run affected tests while files change
test:update    review and update approved golden expectations
coverage       run the suite with V8 coverage
```

Exact package scripts are established with the workspace configuration.

## 2. Why Vitest

The compiler needs fast focused tests during implementation and deterministic whole-pipeline tests in continuous integration. Vitest supplies a common TypeScript-oriented interface for both, with mature snapshot, filtering, project, coverage, IDE, and browser support.

Its browser support also allows the future playground build of the platform-neutral compiler core to be tested without adopting another test API. Browser tests remain a distinct test project because they exercise a different host; ordinary compiler tests run under Node.

Node's built-in test runner is capable but is not the project runner. Jest and Mocha are not used alongside Vitest. One runner and assertion vocabulary keeps tests and contributor instructions coherent.

The selected Vitest major must support the repository's minimum Node version. Dependency versions are pinned by the workspace manifest and lockfile rather than frozen forever in this doctrine.

## 3. Test layers

Hexagon uses five complementary layers.

### 3.1 Unit tests

Focused tests cover small algorithms and local invariants: lexical modes, layout transitions, parser productions, scope operations, union-find, row unification, generalisation, coverage matrices, elaboration, and printers.

Unit tests should normally live near the implementation they exercise when that makes ownership clear. Large shared fixture suites live under the compiler test tree.

### 3.2 Golden tests

Golden tests compare human-readable compiler artefacts against reviewed files:

- diagnostics and fix-its;
- token and syntax-tree renderings used for tests;
- inferred type displays;
- emitted JavaScript;
- emitted `.d.ts` declarations; and
- source-map views or decoded mappings.

Compiler outputs generally use explicit files rather than opaque snapshot entries. A representative fixture has this shape:

```text
test/fixtures/emit/functions/
  input.hex
  expected.js
  expected.d.ts
```

Explicit extensions preserve syntax highlighting and make each expected artefact easy to inspect. Vitest snapshots and inline snapshots remain appropriate for compact values such as one token sequence, a phase-qualified syntax-tree fragment, or a diagnostic object.

Golden files are committed to source control and reviewed as code. Continuous integration never updates them automatically.

### 3.3 Conformance tests

Normative examples from `spec/` become executable accepted or rejected programs. A conformance fixture records the governing specification path and section so a changed rule can be traced to all affected tests.

Conformance tests assert observable language behaviour, diagnostics required by the specification, or both. They should not depend on incidental debug representations unless the representation itself is the subject of the test.

### 3.4 Property tests

Fast-check generates inputs and shrinks failures to small counterexamples. It is used where a durable invariant is stronger than a list of examples, including:

- the lexer always advances or reports a diagnostic;
- produced spans are ordered and remain inside their source file;
- layout stacks close correctly at end-of-file;
- parsing and test-only printing round-trip over supported subsets;
- unification preserves equivalence and rejects occurs-check cycles;
- generalise and instantiate preserve the intended relationships; and
- exhaustiveness results agree with enumeration over small finite types.

Every property test must report its replay seed on failure. Continuous integration uses deterministic recorded configuration; a failing seed becomes an ordinary regression example when that makes the defect clearer.

The seed is fixed centrally, by `vitest.setup.ts`, and not at each `fc.assert` call — a property test added later must not be able to omit it. Setting `HEXAGON_PROPERTY_SEED` overrides it for a run that wants different inputs. The seed varies per test *file*: most compiler properties generate a bare `fc.string()`, so a single suite-wide seed would make them all draw the identical sample, which is a narrower suite than the unseeded one it replaces rather than merely a frozen one.

A fixed seed means the suite's generated coverage no longer grows on its own. That is the right trade for the gate: a property that samples fresh inputs every run can fail on an input nobody can recover, which is a signal carrying no information (#198). Exploration beyond the pinned inputs belongs in a separate randomized job under §10, which records the seed it used so anything it finds arrives reproducible. No such job exists yet.

A pinned property protects only what its inputs actually reach, and for a compiler that is much less than it looks. The pinned 250 `fc.string()` inputs behind the elaborator property produce eight of Core's thirty-five expression kinds and one of its fifteen item kinds; almost all of them fail to parse. A property over `fc.string()` is therefore a crash-and-invariant guard, not coverage, and a rule worth protecting needs a written example too. Where a property is meant to reach real constructs, it needs a generator that builds them — as `layout.test.ts` does.

Generated tests do not replace carefully chosen boundary cases. They extend coverage into combinations a human is unlikely to enumerate.

A property that forbids a set of values must derive that set from the types wherever it can, rather than restate it, and its traversal must be exhaustive over the tree rather than name the cases someone thought of. #198 was both mistakes at once: a hand-written list of node kinds the elaborator must not emit, two of which it is *supposed* to emit, checked by a walker that entered under a third of the tree.

### 3.5 End-to-end tests

End-to-end fixtures compile Hexagon source, inspect its public artefacts where relevant, execute the emitted JavaScript in an isolated test environment, and compare observable results.

These tests prove that separately correct passes compose. They are deliberately fewer and broader than unit and conformance tests so the normal development loop remains fast.

### 3.6 Program I/O

`Hex.File`, `Hex.Stdio` and `Hex.Process` (`spec/program-io.md`) need
emitted-program runtime tests in addition to compiler conformance. What one
test process can see is in `src/conformance/program-io.test.ts`: the imports and
colours, and `File` against a directory of its own. What needs a process of its
own is `scripts/test-program-io.mjs`: after `npm run build` in `compiler/`, run
`node scripts/test-program-io.mjs`. Node is the one host (`environment.md` §7).
The harness also needs Python 3 and POSIX pseudo-terminal support, `bash`, and
`/dev/full` for the full-disk check, which it requires on Linux and skips, saying
so, elsewhere; it does not establish Windows terminal compatibility. It also
reads a file one byte longer than Node's longest string, which takes about
half a gigabyte of memory for a moment, and gives the same file as standard
input, which takes about a gigabyte and a half.

`Stdio` checks must distinguish stdout from stderr, verify exact UTF-8 bytes and
LF insertion, and exercise repeated writes, redirected files, actively drained
pipes, a terminal, and each ending of `spec/program-io.md` §4.3: a reader that
leaves, a full disk, and a slow reader after `Debug.log`. Multibyte text either
side of the writer's kept array's edge checks that no write is cut short, and
each of the four writers refuses a lone surrogate. Terminal checks must
distinguish the module's output from terminal-driver newline transformations.

The reads of standard input (§4.5) are checked from a redirected file, a
parent's pipe, `cat` through a pipe, a writer that pauses into a blocking pipe
and into one its parent made non-blocking, `/dev/null`, a closed stdin, a
directory, input too long for a string, and a terminal typed into through a
pseudo-terminal (`scripts/stdin-pty.py`): the exact text, the decoding as
`File`'s, a second read, and each ending's line and status.
The playground runs the same modules on its own stand-ins for Node, and its
tests compare what a program prints there with what it prints under Node
(`playground/src/execution-worker-io.test.ts`, a file of its own, since each
run keeps its modules in the test process).

## 4. Test host

Compiler tests use the deterministic in-memory test host described by `environment.md`. Tests should not depend on the developer's current directory, locale, timezone, filesystem ordering, terminal width, or unrelated environment variables.

Fixtures that specifically test the Node host or CLI may use temporary directories created for the test. Such tests remain separate from platform-neutral compiler-core tests and clean up their owned files.

Tests must not require network access. External JavaScript packages used by FFI fixtures are represented by local fixtures.

## 5. Determinism and isolation

Given the same sources and options, a compiler test must produce byte-for-byte stable output. Test infrastructure therefore fixes or normalizes:

- file and module ordering;
- generated symbol ordering;
- path separators and fixture roots;
- line endings;
- timestamps and random seeds;
- locale-sensitive rendering; and
- concurrency-sensitive collection order.

§4 excludes *unrelated* environment variables. `HEXAGON_PROPERTY_SEED` (§3.4) is a related one — the only variable the compiler's own test code reads — and it moves determinism rather than removing it: unset, the seed is fixed; set, a job has chosen a different fixed seed rather than an unpredictable one. A run that sets it says so on stderr, since an exported value would otherwise change what the gate tests invisibly.

Tests may run in parallel only when they do not mutate shared compiler state or shared fixture files. A failure that depends on test order is a correctness defect, not an accepted limitation of the runner.

Test files share processes. `vitest.config.ts` deals every test file but one into eight `shared-` projects with isolation off, so a worker runs several files of its project in turn and keeps one module graph, one checked standard library (#987) and one `globalThis` across them. A test file therefore leaves the process as it found it: whatever it installs on `globalThis`, stubs, or puts into module state, it removes or resets before it ends, and a counter it reads is reset or read as a difference rather than assumed to start at zero. A test that needs a process nobody else has touched — because it resets the standard-library cache, freezes it, or counts its seats — goes in the `isolated` project, which keeps Vitest's process per file. `standard-library-cache.test.ts` is the only one.

Continuous integration runs the suite as four jobs on separate machines. `HEXAGON_TEST_SHARD=k/n`, read only by `vitest.config.ts`, keeps every n-th of those nine projects starting at the k-th, so n jobs between them run each project exactly once and a project's files still share one worker; unset, the whole suite runs. It chooses which tests run, never what a test computes.

## 6. Diagnostics testing

A diagnostic golden should show the information a Hexagon user sees:

- severity and message;
- source location and highlighted span;
- relevant secondary locations;
- notes and hints;
- fix-it edits; and
- stable ordering when several diagnostics are produced.

Tests should prefer a purpose-built deterministic diagnostic renderer over snapshots of internal objects. Internal fields may be tested separately when they carry an invariant not visible in rendered output.

Recovery tests must also assert useful subsequent diagnostics. Merely confirming that malformed input does not crash is necessary but insufficient.

## 7. Coverage

Vitest's V8 coverage identifies unexercised implementation paths. Coverage is evidence, not a target that overrides test quality. The project does not add low-value assertions merely to reach a percentage.

The Foundation configuration will establish an initial reporting policy after the first vertical slice provides representative code. Any enforced threshold should rise from measured evidence and apply sensibly to generated files, unreachable guards, and host adapters.

Semantic coverage matters more than line coverage. Reviews should ask which language rules, error paths, phase invariants, and representation decisions remain untested.

## 8. Performance tests

Benchmarks are kept separate from correctness tests. Wall-clock thresholds inside ordinary Vitest tests are prohibited except for deliberately generous termination guards.

Compiler performance work needs warm-up, repeated measurement, controlled inputs, and recorded baselines. The benchmark tool and regression policy will be selected when representative compiler workloads exist.

Correctness tests may still assert structural cost bounds, such as preventing an unexpectedly multiplied specialization set, when those bounds are deterministic and part of the language or emission contract.

## 9. Test readability

Tests follow `readability-and-comments.md`. A test name states the behaviour being protected. Comments explain language rules, unusual setup, or why a case is a regression; they do not narrate assertions.

Prefer small test helpers that speak in compiler concepts:

```ts
expectDiagnostic(source, {
  message: "`;` separates statements; Hexagon lines don't end with one",
});
```

Helpers must not hide the phase being exercised or silently discard diagnostics. When a helper compiles through several phases, its name or documentation should say so.

## 10. Continuous integration contract

Before a change is accepted, continuous integration runs at least:

1. TypeScript type checking;
2. the complete non-browser Vitest suite in non-watch mode;
3. golden-file verification without updates; and
4. platform-neutral build checks needed by the browser compiler core.

Browser tests, coverage reports, randomized stress runs, and benchmarks may run in separate jobs according to their cost. The required job matrix is established when those components exist.

Committed `.only` tests are rejected. Skipped or todo tests must state why they are disabled and point to the decision or work item that will resolve them.

## 11. Decision record

### Initial decision

- Vitest is the single primary test runner and assertion framework.
- Fast-check supplies property-based and generative testing within Vitest.
- TypeScript checking is required separately from test execution.
- Compiler artefacts normally use explicit, reviewable golden fixture files.
- Unit, golden, conformance, property, and end-to-end tests have distinct roles.
- Tests use deterministic hosts and do not require network access.
- Coverage informs testing but does not replace semantic judgment.
- Benchmarks remain separate from correctness tests.

### #198 — property seeds are pinned centrally

The nine compiler properties had run unseeded since they were written, against §5's requirement that test infrastructure fix random seeds. `vitest.setup.ts` now fixes the seed for all of them, per file, and `HEXAGON_PROPERTY_SEED` is the documented way to move it. A test asserts that fast-check actually received the seed: `fc.configureGlobal` validates nothing and the setup file is outside `tsconfig.json`'s `include`, so a misspelled key there would silently restore the very condition this record exists to end.

The defect that surfaced this was not the seeding, though. The elaborator property's list of forbidden node kinds named two kinds Core legitimately has, so any input reaching an indexing expression failed the property on a tree the elaborator got right; `""[0]` does it with no diagnostics. Its walker also recursed into eleven of Core's thirty-five expression kinds and two of its fifteen item kinds, leaving anything nested inside a `Fun`, `Match`, `Vector`, or `Try` unreachable. Both are now derived from the trees and checked by `tsc`.

The seeding was still worth doing, but it is not what closed the defect — a written regression example is, because the generated inputs never reach an `Index` node at all.

### #985 — the test budget is what the work costs

The suite ran under Vitest's default 5000 ms `testTimeout` from the start. Its conformance tests compile whole projects, and on a two-core continuous-integration runner under full parallel load many of them finish within a second of that budget. Every red run on `main` the default produced was a timeout on one of those tests, never a failed assertion, and the same test passed alone. Raising one test's budget at a time only chose which test would go red next.

`vitest.config.ts` now sets the budget to 30 s for the whole compiler suite. §8's prohibition on wall-clock thresholds inside tests stands: this threshold lives in the runner's configuration, not in a test, and it is a termination guard of the deliberately generous kind §8 allows. Budgets written at a call site remain and still apply where they are larger. A genuinely hung test now takes 30 s to fail rather than 5, which is the accepted price. The other packages' suites keep the default until one of them shows the same pattern.

### #1258 — the language server's budget, and a wait behind a compile

The language server's suite was the next to show #985's pattern. From late September to mid-October, ten of the twelve red continuous-integration runs were one test, every time a timeout and never a failed assertion. That test trusts a standard-library project, so the server compiles the whole standard library from source before it publishes anything. Runners come in two speeds: on the fast ones the test took 1.8–2.2 s, and on the slow ones 2.7–3.0 s. Its wait gave up after the harness's 3 s, which was chosen as generous next to the server's diagnostic debounce, not to cover a compile. The suite also ran under Vitest's 5000 ms default, and another test that copies and walks the standard library took 3.5–3.7 s on the slow runners.

`language-server/vitest.config.ts` now sets the same 30 s budget as the compiler, and `vitest.linked.config.ts` inherits it. A wait that stands behind a standard-library compile names its own 15 s limit (`STANDARD_LIBRARY_PUBLICATION_TIMEOUT_MS`), and every other `diagnosticsUntil` wait keeps 3 s, since it stands behind the checked standard library the process keeps (#987), not a compile from source. Both are termination guards of the kind §8 allows. The durable lever, as in #985, is a cheaper standard-library compile.

### #987 — the cache's pins are a freeze and a counter

`compileProject` keeps the checked standard library between compiles (#987), which makes two things testable that had not been.

The first is that nothing downstream writes to what is now shared. `support/deep-freeze.ts` freezes a value and everything under it, replacing the `Map` and `Set` mutators `Object.freeze` leaves working with ones that throw, and `resetStandardLibraryCache({ freezeEntries: true })` puts every cached seat through it. A corpus of programs then compiles against the frozen prefix, so a write anywhere in the checker, the elaborator or the emitter fails at the write rather than as a wrong answer three compiles later. The freeze is a test hook rather than the shipped behaviour: freezing the whole standard library on each chain build costs more than the chain saves, and the pin needs it once.

The corpus holds **refusing** programs as well as clean ones. A refusal reads what a clean compile never asks for — the import repair that answers "would `import Rat` work?", the pattern doors an unknown suffix offers — and both of those walk the shared module set; a refusal carrying fixes also drives `validatePatternFixes`, which compiles the whole program again from inside the compile, against the same frozen chain.

The second is that the cache is used at all. `standardLibraryCacheStatistics()` reports seats checked against seats reused, so "the standard library is checked once per process" is a count. §8's prohibition is why: the claim is about repeated work, and a duration would be a worse measurement of it as well as a forbidden one. Its `compiles` counts what the host asked for; the re-entries `validatePatternFixes` makes are a fact about a refusal's fixes, not about the host, and are left out.

Both are test-only exports of `project.ts` rather than a test double. A double would have to reimplement the chain to say anything about it, and the chain is the thing under test.

### Standard-library dependencies preserve the cache contract

Packages §2.4 requires dependency ordering for ordinary library modules after
the fixed prelude/runtime sequence. The resulting sequence is shared by checking
and the cache; reordering only checking underneath a cache keyed by another
sequence is invalid. An unchanged standard library must still reuse its complete
chain across programs, without reparsing or rechecking it.

Regression coverage must include an ordinary library module importing another
whose name sorts later, and a trusted replacement that changes import edges and
therefore changes the required order. Reuse ends at the first incompatible seat;
the remainder is rebuilt using the new order, with correct allocator state.
Cold and warm compiles must agree on diagnostics and emitted output, including
after restoring the original sources. A cycle must remain diagnosed across
repeated compiles rather than becoming a reusable, apparently clean dependency
chain. These checks accompany the existing frozen-structure and reuse-counter
tests; the fix must preserve the cache's avoided work as well as its answers.

### Test files share a warm standard library

Under Vitest's default every test file had a fresh process, so the standard library was checked again for each of the suite's 278 files: about a third of all the work the suite did, and the bulk of the continuous-integration job that gates every merge. The cache #987 added keeps the checked standard library for the life of a process, so the remedy is to let files share processes rather than to make the compile cheaper.

One shared pool for the whole suite was tried first and does not fit in memory. A worker keeps everything a file leaves behind, and an executed program leaves its whole module graph, since Node's loader never unloads a module; the harnesses that still link through `data:` URLs leave the most. Run that way the suite's files retain several gigabytes between them, and on a four-core, 16 GB machine workers crossed Node's default heap or were killed by the system. So the shared files are dealt round-robin, by sorted path, into eight projects. Vitest runs projects in turn and retires a worker when the next file belongs to another project, so each worker carries about an eighth of the leftovers and the standard library is checked a few dozen times rather than 278. Even an eighth peaked near 1.8 GB of heap, close to Node's default limit on such a machine, so shared workers run with a 4 GB heap; three of them still fit. The projects are dealt from the files Vitest's default pattern finds, read once when the configuration loads, so watch mode needs a restart to see a new test file. Adding or removing a file moves later files to other projects, so a latent order dependence may first show on an unrelated change; §5 says it is fixed in the test. On four cores the full suite took 17m39s isolated and 7m00s–7m18s this way, with every test passing; shuffled file order costs some of the reuse and took 10m41s–11m14s, also passing. A smaller retained graph — the `data:` linkers moving to `runProject` — would let the projects be fewer; it is not needed for this.

`standard-library-cache.test.ts` resets and freezes the cache and counts its seats, and so needs a process nobody else has touched; a ninth project keeps it isolated. Sharing a process makes §5's rule about order a live one rather than a theoretical one: a file that leaves state behind can now change another file's answer. The suite was run repeatedly, including with file order shuffled, before the change landed. A test that turns out to depend on order is fixed in the test, not moved to the isolated project, unless — like the cache test — it needs a fresh process by design.
