# Program IO Plan

**Status:** Planning note, 2026-09-22. Proposed sequence, not an approved API
contract or a requirement to ship every capability before the library is useful.
The global work entry is in [the stdlib roadmap](../stdlib-roadmap.md).

## Purpose

Build a small, dependable set of program I/O facilities, starting with the
practical need to read Advent of Code input files and print answers. Grow it
in useful increments. The longer-term inventory is a direction for the library,
not a minimum standard that the first version must satisfy.

## Proposed sequence

| Stage | Capability | Purpose | Current position |
|---|---|---|---|
| 1 | Read/write whole text files | Load puzzle input; save results | Implemented in PR #1006 |
| 2 | Write stdout and stderr, with and without a newline | Print answers and keep diagnostics separate from results | Implemented, reviewed, and validated locally |
| 3 | Read command-line arguments | Accept an input filename rather than hardcoding it | Proposed next increment |
| 4 | Set an unsuccessful exit status | Let shells and scripts detect failure | Proposed next increment |
| 5 | Read all stdin until EOF | Accept redirected files and another command's output | Useful later |
| 6 | Read one line from stdin | Support interactive questions | Defer until needed |
| 7 | Basic path operations | Construct and inspect paths portably | Defer until concrete uses establish the surface |

Stages 5–7 are independent follow-ups; their order may change with actual need.
Binary I/O, general stream handles, asynchronous I/O, directory traversal, and
subprocess management are outside this plan's initial scope.

## 1. Whole text files: completed foundation

[PR #1006](https://github.com/hexagonal/Hexagon/pull/1006) supplies
`Hex.Experimental.File.readText` and `writeText`, backed by
`Hex.Experimental.Node.File`. The [experimental file contract](../experimental-file.md)
owns the exact semantics and runtime support.

This already meets the immediate input need for Advent of Code. It does not
need stdin support to be useful.

## 2. Standard output and standard error

Agreed module: `Hex.Experimental.Stdio`, a sibling of `Hex.Experimental.File`.
The adapter is `Hex.Experimental.Node.Stdio`. Operations:

```text
write: String ->! Unit
writeLine: String ->! Unit
writeError: String ->! Unit
writeErrorLine: String ->! Unit
```

`write` sends the supplied text to stdout; `writeError` sends it to stderr.
The line variants append exactly one LF on every platform. The functions are
effectful; `Debug.log` keeps its name and pure-facing debugging role. No blank-line
convenience is needed: pass `""` to a line operation. Callers explicitly format
other values into strings.

The [Stdio specification](../experimental-stdio.md) records the synchronous
UTF-8 contract, completion and failure semantics, and required validation.
Local implementation, Sol Medium review, and Node/Bun/Deno runtime checks are
complete. The specification records the
tested versions and platform limits.

## 3. Command-line arguments

Expose the arguments passed to the program so a user can supply an input path.
A proposed starting point is an immutable collection of user arguments without
the runtime executable or program entry path. Decide the exact collection,
effect contract, and host mapping before specifying an API. Argument parsing
and option syntax are a separate convenience layer, not required here.

## 4. Exit status

Allow a program to report unsuccessful completion to its caller. Distinguish
setting the status used when the program finishes from terminating immediately;
these have different implications for pending output and cleanup. Prefer to
explore setting the eventual status first. Decide the accepted values and
runtime behaviour before specifying an API.

## 5. Whole-input stdin

The proposed operation is `readAllText`, making the whole-input behaviour
explicit. It consumes the remaining input until EOF and holds the result in
memory. Redirected files finish when exhausted; pipes finish when their writers
close. At a terminal, Enter submits a line but does not finish the input, so
this is primarily a file-redirection and pipeline facility.

Decide BOM handling, decoding, repeated reads, and error behaviour in its own
contract. Matching the file reader's text policy is a proposal, not a decision
already made by this plan. Test empty input, multiple lines, Unicode, large
piped input, and EOF using compiled programs under each supported runtime.

## 6. Interactive line input

Add this when programs need to ask questions and accept Enter as submission.
Its design must distinguish a blank line from EOF and define line endings,
buffering, and interaction with whole-input reads. It is not a prerequisite
for file-based puzzle programs.

## 7. Paths

Start from demonstrated needs, such as joining a directory and filename or
extracting a filename. Decide native-platform versus explicit path conventions
and distinguish lexical manipulation from filesystem inspection. Do not promise
a broad path library before these choices are settled.

## Delivery approach

Use #1006 as the starting architectural pattern: explicitly imported experimental
modules, ordinary Hexagon wrappers over narrow host adapters, and tests of actual
emitted programs. Browser support and Node/Bun/Deno compatibility must be stated
per facility and established by evidence. Keep unused host dependencies out of
programs that do not import the facilities.

For each increment, check existing issues and prerequisites first. If a more
fundamental issue blocks progress, propose fixing it before extending the API.
Present substantial design decisions to James one at a time and wait for his
manual decision before implementation.

Astra writes the specifications and any needed conceptual book material. Sol
Medium implements and reviews specifications, book changes, and code. After
three implementation rounds ending in failures, stop for James to review.
Terra Medium handles authorized merges; unresolved decisions return to James,
and Sol Medium may handle merge trouble. While a long required GitHub Check is
healthy, report only failures. This plan itself authorizes no implementation,
publication, or merge.
