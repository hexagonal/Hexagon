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

Generated tests do not replace carefully chosen boundary cases. They extend coverage into combinations a human is unlikely to enumerate.

### 3.5 End-to-end tests

End-to-end fixtures compile Hexagon source, inspect its public artefacts where relevant, execute the emitted JavaScript in an isolated test environment, and compare observable results.

These tests prove that separately correct passes compose. They are deliberately fewer and broader than unit and conformance tests so the normal development loop remains fast.

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

Tests may run in parallel only when they do not mutate shared compiler state or shared fixture files. A failure that depends on test order is a correctness defect, not an accepted limitation of the runner.

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
  message: "`;` separates statements; Hexagon lines don't end with one.",
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
