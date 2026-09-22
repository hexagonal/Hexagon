# Experimental synchronous standard output

**Status:** Experimental contract drafted 2026-09-22 after API and LF decisions;
Sol Medium specification review found no actionable issues on the same date.
Implemented and validated locally; Sol Medium code review completed after the
runtime harness's pipe timeout was added.
Outside the prelude and book.
This contract does not promise a stable library API.

## 1. Modules and interface

`stdlib/Experimental/Stdio.hex` declares `Experimental.Stdio`, imported by
applications as `Hex.Experimental.Stdio`. It is a sibling of
`Experimental.File`: File operates on named files; Stdio operates on the
process's standard input/output channels. This first increment only writes
stdout and stderr. Stdin is deferred by the [Program IO Plan](notes/program-io-plan.md).

The adapter is `stdlib/Experimental/Node/Stdio.hex`, declaring
`Experimental.Node.Stdio`. The wrapper imports it as
`import Experimental.Node.Stdio as NodeStdio`. Both modules require explicit
imports and export these four operations only:

```text
write: String ->! Unit
writeLine: String ->! Unit
writeError: String ->! Unit
writeErrorLine: String ->! Unit
```

Each takes a parameter named `text`. `write` and `writeLine` target stdout;
`writeError` and `writeErrorLine` target stderr. All require `!` at call sites
and return Unit on success. Ordinary Hexagon bodies infer their effects;
private extern declarations explicitly use `->!`. No new compiler intrinsic,
type, exception, or prelude name is introduced.

```hexagon
module Main

import Hex.Experimental.File as File
import Hex.Experimental.Stdio as Stdio

export let echoFile(path: String): Unit =
    let text = File.readText!(path)
    Stdio.write!(text)
    Stdio.writeErrorLine!("Finished")
```

## 2. Text and newline semantics

Output is UTF-8. `write` and `writeError` insert no text. The line variants
append exactly one U+000A (LF), on every platform, even when the supplied text
already ends with a newline. Existing CRLF, CR, LF, NUL, and U+FEFF characters
are preserved. There is no newline normalization, trimming, Unicode
normalization, or inserted BOM. Lone surrogates follow the host UTF-8 encoder's
replacement behaviour, as with the file writer.

`writeLine!("")` writes one LF to stdout; `writeErrorLine!("")` does the same
to stderr. No separate blank-line operation, optional parameter, or overload
is added. `write!("")` and `writeError!("")` emit no bytes; this does not
promise that the host performs no operation or cannot report an error.

The API accepts strings, without formatting substitutions or automatic `Show`
conversion. Callers use interpolation or other explicit formatting.

## 3. Host operations, completion, and errors

The Node adapter uses `node:fs.writeFileSync(fd, text, "utf8")` with numeric
file descriptor 1 for stdout and 2 for stderr. The line variants add LF before
the write. These are existing process descriptors: the module does not open,
truncate, rewind, or close them. Repeated calls continue writing to the existing
destination. Do not implement the contract through `console.log` or
`process.stdout.write`, whose contracts differ from this synchronous writer.

Success means the synchronous host write has completed for the whole encoded
text. It does not promise that a downstream process has consumed the bytes,
that a terminal has displayed them, or that redirected output is durable.
There is no line-atomicity guarantee against concurrent writers or combined
display-order guarantee across stdout and stderr.

Host failures propagate under the existing [foreign-exception rules](exceptions.md).
The module does not normalize errors or add retry policy. A failed write may
already have emitted part of the text. In particular, a broken pipe or a host
nonblocking-descriptor failure must not be swallowed or reported as success.

The adapter name identifies the Node API, not an exclusive runtime requirement.
Node, Bun, and Deno are intended targets, but Stdio compatibility must be tested
independently of #1006. Record the actual tested versions and platform coverage
when implementing; runtime minima are not established by this draft. Browser
execution is unsupported. Programs which do not import these modules must not
emit or load them or acquire their `node:fs` dependency.

## 4. Relationship to Debug

`Debug.log` keeps its name, generic `Show` input, and pure-facing debugging
contract. Its evaluation-dependent multiplicity and ordering are defined in
[Effects §6.2](effects.md#62-the-trusted-purity-species). It remains the facility
for temporary probes without propagating an effect mark through the program.
Stdio is ordinary effectful program output; it has no unmarked alternative.

## 5. Required validation

Compiler conformance must cover explicit imports, inferred effects, rejection
of unmarked calls, private externs, public export shapes, embedded source parity,
and absence from programs which do not use the modules.

The runtime harness must compile the actual modules and run their emitted ESM.
Verify stdout and stderr independently, with exact bytes, for all four operations:
empty strings, Unicode, supplied BOM, NUL, existing line endings, added LF,
consecutive calls, and substantial output. Include both redirected files and
pipes with an actively draining reader; verify successful process completion
does not lose output. A pipe test must not deadlock by postponing its reader
until after the writer exits.

Exercise a controlled write failure and assert propagation rather than silent
success. Cover terminal use with a pseudo-terminal or recorded manual smoke
test, accounting for terminal-driver transformations separately from bytes
supplied by the module. Run on Node, Bun, and Deno and state coverage limits;
an unavailable runtime is not a passing compatibility result. If a host cannot
meet this contract, report the limitation before changing the API or guarantees.

### 5.1 Runtime harness

From `compiler/`, build once with `npm run build`, then run:

```sh
node scripts/test-experimental-stdio.mjs node
node scripts/test-experimental-stdio.mjs deno
node scripts/test-experimental-stdio.mjs bun
```

Each target runtime must be on PATH. The harness also requires Python 3 and a
POSIX pseudo-terminal implementation for its terminal checks. It disables the
terminal driver's output processing before comparing bytes. Windows terminal
coverage is not established by this harness.

Local emitted-program checks passed on macOS with Node 24.18.0, Deno 2.4.0,
and Bun 1.4.2: redirected files, actively drained pipes, separate stdout/stderr
pseudo-terminals, and controlled descriptor failures. These are tested versions,
not minimum-version claims. The CI workflow runs the Node harness on Linux;
its result for this change is not yet established.

Local regression validation also passed: the full compiler suite (5,950 passing
tests and one expected failure), compiler build and type check, host and
language-server suites and type checks, Playground suite and type check, the
existing Node file-I/O harness, and `git diff --check`. Two language-server
timeouts under concurrent suite load did not recur when the full language-server
suite ran alone.
