# Program I/O: the deliberation record

**Status:** Notes, not normative. The write-ups James ruled on, 2026-11-04 for the v1 surface and 2026-11-05 for standard input, kept verbatim as they stood at each ruling, with a status line and, where an example indexed the arguments from `[0]`, a correction added after it. `spec/program-io.md` is the decided text. The parts were separate files during the deliberation, `IO-V1.md` (decision 1) and `IO-V1-D2.md` to `IO-V1-D5C.md`, then `STDIN-V1.md` and `STDIN-V1-D2.md` to `STDIN-V1-D4.md`, and refer to each other by those names. The probes and measurements they cite were run on the deliberation's branch and machine, and are not kept in the repository.

---

## A decided I/O surface for v1 (stdlib gaps, item 7)

**Status:** ruled (a) by James on 2026-11-04: v1 graduates `File.readText` and `writeText` and the four `Stdio` writers, adds the command-line arguments and an exit status, and supports Node only (he ruled the hosts Node-only the same morning, so the "Hosts" line under (a) below no longer holds). This was the write-up for that ruling, the first of item 7's decisions: what v1 promises about input and output. The decisions that follow from it are listed at the end, each to get its own write-up.

**Up front:**
- **Doctrine:** every operation here is `->!`, impure and may fail, and the colours already say so. The open doctrine question is the failure channel for a missing file (decision 2 below).
- **Colleague languages:** every general-purpose colleague ships these four things in its standard library: read a whole file, print to stdout and stderr, the command-line arguments, and an exit status. Gleam and Elm don't, because their platforms are split.
- **HM:** nothing here touches inference. These are ordinary functions with written types.

### What exists today (measured on main)

- **Files.** `Hex.Experimental.File` has `readText(path)` and `writeText(path, text)`. They read and write UTF-8, and `readText` drops one leading BOM.
- **Output.** `Hex.Experimental.Stdio` has `write`, `writeLine`, `writeError` and `writeErrorLine`. The line versions add exactly one LF.
- **Hosts.** Both modules are thin Hexagon wrappers over `node:fs`. They are tested on Node, Bun and Deno 2.4 or later, and say they do not support browsers. Their specs say "this contract does not promise a stable library API".
- **Colours.** Every operation is `->!`. Calling `File.readText` with no mark is refused: "this call is impure and may fail, so `File.readText` wants `!`, not no mark".
- **A missing file is a foreign throw.** A catch sees `JsError`, whose message is Node's own text: `ENOENT: no such file or directory, open '/nonexistent/input.txt'`. To tell "not found" from "permission denied", a program has to read that text or decode the error's `code`.
- **Programs run their top level.** There is no `main`. `let input = File.readText!("input.txt")` at module level compiles, and `node dist/Main.js` runs it.
- **What's missing:**
  - **Arguments.** There are none, so an Advent of Code program hard-codes its input path.
  - **An exit status.** There is no way to set one. An uncaught throw already exits with status 1 on Node (measured).
  - **stdin.** There is none, though Node reads piped stdin with `readFileSync(0, "utf8")` (measured).
- **The first program in the CLI README** imports `Hex.Experimental.Stdio`.
- **The playground** captures `console.log`, which is how `Debug.log` reaches its output pane. It leaves a `node:fs` import as written, and a browser can't resolve that. So a program that imports these modules can't run in the playground. I read this from `module-execution.ts` and haven't run it.

The Program IO Plan (`spec/notes/program-io-plan.md`, September) already orders the work:
1. whole files (done);
2. stdout and stderr (done);
3. arguments;
4. exit status;
5. all of stdin;
6. one line of stdin;
7. paths.

It leaves release scope open: "Later APIs and release scope remain undecided".

### The question

Does v1 promise a stable I/O library, and if so, which part of it?

### Colleague languages

| | Read a file | Print | Arguments | Exit status | All of stdin | A missing file |
|---|---|---|---|---|---|---|
| OCaml | `In_channel.with_open_text` + `input_all` (4.14) | `print_endline`, `prerr_endline` | `Sys.argv`, a value, program first | `exit n` | `In_channel.input_all stdin` | raises `Sys_error` with a string |
| Rust | `fs::read_to_string` | `println!`, `eprintln!` | `env::args()`, program first | `process::exit`, or `ExitCode` from `main` | `io::read_to_string(stdin())` | `io::Error` with an `ErrorKind` |
| Swift | `String(contentsOfFile:encoding:)` | `print` | `CommandLine.arguments`, a value, program first | `exit(n)` | `readLine()` in a loop | throws `CocoaError` with a code |
| F# | `File.ReadAllText` | `printfn`, `eprintfn` | `main`'s `argv`, no program | `main` returns an `int` | `stdin.ReadToEnd()` | throws `FileNotFoundException` |
| Haskell | `readFile` | `putStrLn`, `hPutStrLn stderr` | `getArgs`, in `IO`, no program | `exitWith`, `exitFailure` | `getContents` | `IOException`, tested by `isDoesNotExistError` |
| Kotlin | `File(path).readText()` | `println`, `System.err.println` | `main`'s `args`, no program | `exitProcess(n)` | `generateSequence(::readLine)` | throws `FileNotFoundException` |
| Gleam | none (the `simplifile` package) | `io.println`, `io.println_error` | none (the `argv` package) | none | none | (`simplifile`: a `FileError` union) |
| Elm | none: ports to JavaScript | none | flags to `init` | none | none | none |

What they agree on:
- The four basics are standard library, not a package, in every language whose platform has a file system.
- Errors are typed by kind: an error kind (Rust), a code (Swift), a predicate (Haskell), or a class (F#, Kotlin). Only OCaml hands back a bare string.
- Arguments split. OCaml, Rust and Swift include the program. F#, Haskell and Kotlin give only the user's arguments, as Node programs do with `process.argv.slice(2)`.

### The options

**(a) Graduate the tested surface, and add arguments and an exit status.**
- Contents: `File.readText` and `writeText`, the four `Stdio` writers, the user's arguments, and a way to set the exit status. This is stages 1 to 4 of the plan.
- Hosts: Node, Bun and Deno. Browsers are named as unsupported.
- Costs:
  - v1 makes a promise about these names and types.
  - Graduation waits on decisions 2 to 5 below. The missing-file decision matters most, because a stable `readText` that throws Node's text is the thing #1427's failure channels were ruled to avoid.
  - The book needs a short chapter.
  - The playground needs a decision (decision 5).

**(b) Graduate what exists, and add arguments as experimental.**
- Costs:
  - An Advent of Code program either hard-codes its path or imports one experimental module beside two stable ones.
  - The missing-file decision is needed just the same, because `readText` graduates.

**(c) Ship v1 with all I/O under `Experimental`, and say so.**
- Costs:
  - The first program anyone writes imports `Experimental`, and v1's promise doesn't cover it.
  - When I/O graduates, every program's imports change, which is churn.
  - It is honest, though, and costs no design work now.

### Doctrine fit

- **Effects.** All three options keep every operation `->!`, which is already true and already enforced.
- **Failure channels (#1427).** These favour (a) over (c) in the end. A missing input file is something the caller plans for, so it is an exception the caller can match by kind. That is the same reasoning that gave decoders `JsConversionError(reason, path)`. (b) and (a) both need that decision before anything graduates.
- **No re-elaboration, the conversion rules, and HM** are untouched by every option.

### What would revisit it

- Asynchronous I/O. Hexagon has no `async`; a v2 design would add asynchronous siblings, and these synchronous operations would stay.
- A browser target with its own I/O story.
- A real `@hexagon/runtime` package (FFI Part 1 §8.3), which could change where the host adapters live but not their faces.

### Recommendation

**(a)**, taken in this order, each its own decision:
1. **Scope:** this write-up.
2. **A missing file and other host errors:** keep `JsError`, or add a Hexagon exception with a reason, such as `NotFound`, `PermissionDenied`, `IsDirectory`, or other with the host's code, plus the path and a message. I expect to recommend the exception, by #1427's route and the `JsConversionError` precedent.
3. **Arguments:** a value or an impure call; with or without the program; a `Vector(String)`.
4. **The exit status:** set the status to report at the end, or exit at once. The plan already prefers setting it.
5. **Names, hosts and the playground:** for example `Hex.File`, `Hex.Stdio` and `Hex.Process`, what a browser does when it imports one, and whether the playground maps `Stdio` to its output pane.

Then the book, then stdin (stage 5), which is additive and can come after v1.

---

## What a failing file operation throws (v1 I/O, decision 2 of 5)

**Status:** ruled (b) by James on 2026-11-04: a failing file operation throws `FileError(reason, path, message)`. This was the write-up for that ruling, the second of the five decisions in `IO-V1.md`. Decision 1 (a) is approved (2026-11-04): v1 graduates `File.readText` and `writeText` and the four `Stdio` writers, adds the command-line arguments and an exit status, and supports Node only.

**Up front:**
- **Doctrine decides the channel.** Exceptions §1 gives "a missing file" as its example of an exception: "an expected failure, one a caller should plan for". So it is tracked by the fail colour, it is not a fault and not an `Option`, and the calls stay `->!`. I'm asking you only to confirm that reading. The open question is the exception's shape.
- **Colleague languages:** all of them let a program tell "not found" from "permission denied" without reading message text, and most carry the path.
- **HM:** nothing here touches inference. Every option is an exception and, at most, a union, all with written types.

### What happens today (measured)

- `File.readText` and `writeText` call `node:fs` and let its throw through, so a program catches `JsError`.
- **A Hexagon program can't tell the kinds apart.** `JsValue` has no reader for a property such as `code`, so the only handle is `JsError.message(e)`, which is Node's own text: `ENOENT: no such file or directory, open 'input.txt'`.
- **Uncaught,** the program exits with status 1, and Node prints its error with a stack through `Hex/Experimental/Node/File.js`.
- **What Node throws** (Node 24.18.0 on Linux, except where noted):

| Failure | Node's `code` | Node's `path` |
|---|---|---|
| read a missing file | `ENOENT` | the path |
| write into a missing directory | `ENOENT` | the path |
| read or write with an empty path | `ENOENT` | `''` |
| read a directory | `EISDIR` | none |
| write to a directory | `EISDIR` | the path |
| a path through a file (`afile/x.txt`) | `ENOTDIR` | the path |
| no permission (Node 22, unprivileged user) | `EACCES` | the path |
| a 300-character name | `ENAMETOOLONG` | the path |
| a NUL in the path | `ERR_INVALID_ARG_VALUE`, a `TypeError` thrown before any file is touched | none |

Two things follow from the table. Node doesn't always say which path failed. And its codes are POSIX names plus a few of Node's own. I measured on Linux only; Node reports Windows errors under the same names through libuv's mapping, which I haven't run.

### The question

When `File.readText` or `writeText` fails, what does the program catch?

### Colleague languages

| | What fails | How a program tells the kind | The path | A kind added later |
|---|---|---|---|---|
| Rust | `io::Error` | `kind()` gives an `ErrorKind`: `NotFound`, `PermissionDenied`, `IsADirectory` and `NotADirectory` (since 1.83), …, `Other` | not carried; the `fs-err` crate exists to add it | fine: `ErrorKind` is `#[non_exhaustive]` |
| OCaml | Stdlib: `Sys_error` of a string. `Unix`: `Unix_error` of a code, the function and its argument | Stdlib: only by the text. `Unix`: the code variant, which ends in `EUNKNOWNERR of int` | in the text; the argument | `Unix`: an unknown code arrives as `EUNKNOWNERR` |
| Haskell | `IOException` | predicates: `isDoesNotExistError`, `isPermissionError`, … | `ioeGetFileName` | fine: a new predicate |
| Swift | `CocoaError` | its `code`: `.fileReadNoSuchFile`, `.fileReadNoPermission`, … | in the error's user info | fine: the codes are a struct of constants |
| Kotlin, Java | `FileNotFoundException`; NIO: `NoSuchFileException`, `AccessDeniedException`, … | the class | `getFile()` (NIO) | fine: a new subclass |
| F#, .NET | `FileNotFoundException`, `DirectoryNotFoundException`, `UnauthorizedAccessException`, … | the class | `FileName`, on some | fine: a new subclass |
| Python | `OSError`'s subclasses: `FileNotFoundError`, `PermissionError`, `IsADirectoryError`, `NotADirectoryError`, … | the class, or `errno` | `filename` | fine: a new subclass |
| Gleam (`simplifile`) | `Result(String, FileError)` | `FileError` is a union of about 45 POSIX codes, plus `NotUtf8` and a bare `Unknown` | not carried | breaks a `case` that lists every variant |

What they agree on:
- Every one lets a program tell the kind without reading text, except OCaml's Stdlib.
- **There are two styles.** Rust, OCaml's `Unix`, Haskell, Swift and Gleam put the kind inside one error, as data. Java, .NET and Python give each kind its own class under a common base, and catching the base catches any file failure. The second style needs subclassing.
- **Most carry the path.** Rust and Gleam don't.

### The options

**(a) Keep the foreign throw, `JsError`.**
- There is nothing to build.
- Costs:
  - The contract is Node's text. A program that plans for a missing file looks for `"ENOENT"` inside `JsError.message`, or writes its own `extern` to read `code`.
  - It goes against `JsError`'s own description, "a value JavaScript threw that Hexagon did not". A stable `File.readText` is Hexagon's operation.
  - It is the case #1427's ruling was made for. Decoders got `JsConversionError` rather than letting JavaScript's errors through.

**(b) One Hexagon exception that carries a reason, the path and a message.**

```hexagon
export union FileErrorReason =
    | NotFound
    | PermissionDenied
    | IsDirectory
    | NotDirectory
    | Other(code: String)

export exception FileError(reason: FileErrorReason, path: String, message: String)
```

- It has `JsConversionError(reason, path, message)`'s shape.
- **The reasons** cover every row of the table:
  - `ENOENT` is `NotFound`;
  - `EACCES` and `EPERM` are `PermissionDenied`;
  - `EISDIR` is `IsDirectory`;
  - `ENOTDIR` is `NotDirectory`;
  - everything else is `Other`, with Node's code: `"ENAMETOOLONG"`, `"ENOSPC"`, `"ERR_INVALID_ARG_VALUE"`.
- **The path** is the one the caller passed, so it is there even where Node leaves it out, as when a directory is read.
- **The message** is one line in Hexagon's words, such as `not found: input.txt`, and Node's own text for `Other`. Uncaught, Node prints it as `Error [FileError]: not found: input.txt` and exits with status 1. I measured this with a stand-in exception of the same name.
- **What programs write.** An Advent of Code program writes `File.readText!("input.txt")`, as it does today. A program that plans for a missing file writes:
  ```hexagon
  let config = try File.readText!("config.txt") catch
      File.FileError(File.NotFound, _, _) => ""
  ```
  I checked this pattern's spelling with a probe module.
- Costs:
  - **The set of reasons is fixed once v1 ships.** Hexagon can't mark a union as open to new cases, so adding one later breaks every `match` that lists them all. A probe with one case missing reports "match is missing cases: `Other(_)`". A catch arm that names one reason is unaffected. Moving a code out of `Other` later would also change what a program already matching `Other("…")` sees.
  - `Other`'s code is Node's vocabulary, as OCaml's `EUNKNOWNERR` and Rust's raw OS code are the system's. With Node the only host, that vocabulary is stable.
  - The adapter needs one more guarded read of the thrown value, of `.code`, beside the read `JsError.message` already makes of `.message`.

**(c) One exception per kind: `FileNotFound(path)`, `FilePermissionDenied(path)`, and so on.**
- This is the style of Java, .NET and Python.
- Costs:
  - Hexagon exceptions have no common base. So "any file failure" is one catch arm per kind, or `_`, which catches every other failure too.
  - The module has more names.
- Its one advantage: a kind added later is a new exception, and catch arms needn't be exhaustive, so nothing breaks.

### Doctrine fit

- **The channel** is Exceptions §1's, as above. All three options keep `->!`, so the colours, the marks, `?`, `attempt` and `assume` work the same in each.
- **#1427's route.** The standard library's own failures are Hexagon exceptions with data, such as `JsConversionError` and `RegexError`. `JsError` is the door for what foreign code throws. That favours (b) or (c) over (a).
- **"Name it, don't repair it"** (Way 5). The reason names the failure, and the message names it for a reader.
- **"JS says what to provide, ML its shape."** Node provides `code`, and a union is the ML shape. Gleam, the ML closest to this platform, chose the same shape.
- **HM** is untouched.

### What this leaves for the next write-ups

- **2b, malformed UTF-8.** Today `readText` turns bad bytes into U+FFFD silently: the bytes `a`, `0xFF`, `b` read back as `a�b` (measured). Lexer §2.1 makes ill-formed source a loading error. Rust and Swift refuse such a file, and so does Python with its default error handling. Kotlin's `readText` and .NET replace the bytes. If v1 refuses, (b) gains one reason, such as `NotUtf8`, before v1 ships, so nothing breaks.
- **2c, a failed write to stdout or stderr,** such as a closed pipe in `program | head -1`. The `Stdio` writers could throw this exception, throw one of their own, or end the program quietly as C and Go programs do. The choice changes their colour, so it gets its own write-up.

### What would revisit it

- A way to mark a union as open to new cases, which would let the set of reasons grow after v1.
- A second host, whose codes would need mapping onto the same reasons.

### Recommendation

**(b)**, with the five reasons above. The names `FileError` and `FileErrorReason` are provisional until decision 5, which may prefer `File.Error`.

---

## Malformed UTF-8 in `readText` (v1 I/O, decision 2b)

**Status:** ruled (c) by James on 2026-11-04: `readText` refuses, and `readTextLossy` (name provisional until decision 5) is today's replacing read. This was the write-up for that ruling, the follow-up that decision 2 (`IO-V1-D2.md`) named. Decision 2 is ruled (b) (2026-11-04): a failing file operation throws `FileError(reason, path, message)`. This question decides whether that union gains one more reason before v1 ships.

**Up front:**
- **Doctrine leans one way.** Way 5 is "name it, don't repair it", and Lexer §2.1 already refuses ill-formed `.hex` source. Your own view, that a text file is UTF-8 with no BOM, makes a file that isn't UTF-8 not a text file.
- **Colleague languages split three ways.** Rust, Swift, Python, Haskell, Java's NIO and Gleam refuse the file. Kotlin, .NET and Node replace the bad bytes. OCaml and Go don't decode at all.
- **HM:** nothing here touches inference.

### What happens today (measured, Node 24.18.0)

- `readText` calls `readFileSync(path, "utf8")`, which replaces each ill-formed sequence with U+FFFD and says nothing. The bytes `a`, `0xFF`, `b` read back as `a�b`.
- Its doc comment says so: "malformed UTF-8 uses replacement decoding".
- **Source files are stricter.** Lexer §2.1 says: "A host reading `.hex` bytes decodes UTF-8 strictly; an ill-formed byte sequence is a source-loading error."

### The question

When the file `readText` reads isn't well-formed UTF-8, does the program get text with U+FFFD in it, or a `FileError`?

### Colleague languages

| | Reading a file as text when its bytes aren't UTF-8 | The other way in |
|---|---|---|
| Rust | `fs::read_to_string` fails with `ErrorKind::InvalidData` | `fs::read`, then `String::from_utf8_lossy` |
| Swift | `String(contentsOfFile:encoding: .utf8)` throws | read `Data`, then decode it with repair |
| Python | `open(path).read()` raises `UnicodeDecodeError` by default | `errors="replace"` |
| Haskell | `readFile` throws an `IOException` under a UTF-8 locale | `Data.ByteString` |
| Java (NIO) | `Files.readString` throws `MalformedInputException` | `Files.readAllBytes` |
| Gleam (`simplifile`) | `read` returns `Error(NotUtf8)` | `read_bits` |
| Kotlin | `File.readText()` replaces with U+FFFD | none needed |
| .NET (current) | `File.ReadAllText` replaces with U+FFFD | pass `new UTF8Encoding(false, throwOnInvalidBytes: true)` to make it throw |
| Node | `readFileSync(path, "utf8")` replaces with U+FFFD | `TextDecoder` with `fatal: true` refuses |
| OCaml, Go | read bytes and don't decode | none needed |

What this shows:
- Where a language refuses, it also has a way in for a damaged file: bytes, or a decoder that repairs.
- Where a language replaces, it never tells the program that a byte was replaced.

### The options

**(a) Keep replacing, and say so in the contract.**
- `readText` never fails over encoding.
- Costs:
  - The repair is silent. A file in another encoding, such as a CSV saved by older Excel in Windows-1252, reads `café` as `caf�`. The program goes on with wrong data and no report.
  - It makes up characters that aren't in the file.
  - Source files and data files then follow opposite rules.

**(b) Refuse: `readText` throws `FileError(NotUtf8, path, message)`.**
- `FileErrorReason` gains a sixth case, `NotUtf8`, which is `simplifile`'s name; decision 5 settles names. Adding it now, before v1 ships, breaks nothing.
- **The message** names the path and the offset of the first bad byte, for example `not UTF-8 at byte 1234: input.txt`. The offset comes from a second scan of the bytes, made only when a read has already failed.
- **The BOM rule doesn't change.** The strict decoder, `TextDecoder("utf-8", { fatal: true })`, already drops exactly one leading BOM, which is what `readText` does today (measured: `EF BB BF 61` decodes to `a`).
- **It costs nothing in speed.** On a 64 MB file, today's read took 259 to 448 ms, and reading the bytes then decoding them strictly took 176 to 208 ms. That's over three runs on a loaded machine, so the numbers are noisy, but strict decoding was never slower.
- Costs:
  - A program that has to read a file that isn't UTF-8 can't do it with v1's `File`. It needs an `extern` until Hexagon has bytes or a repairing read.
  - One more reason in the union.

**(c) Refuse, and also ship a repairing sibling now, such as `readTextLossy` (Rust's word).**
- This follows your rule for BOMs: the standard function is strict, and a variant exists where it makes sense.
- Costs:
  - A name to settle now, for a need nobody has asked for yet.
  - Adding the sibling later breaks nothing, so there is no deadline for it.

### Doctrine fit

- **"Name it, don't repair it"** (Way 5): (a) repairs silently, while (b) and (c) name the failure.
- **Lexer §2.1** decodes source strictly. With (b) or (c), Hexagon reads every text file by the same rule.
- **Strings as codepoints** (your #1410 ruling): U+FFFD is a real codepoint, so (a) doesn't break `String`. But the codepoints it hands over aren't the file's.
- **The failure channel** is decision 2's. A file in the wrong encoding is something a caller can plan for, so it is an exception, by Exceptions §1.
- **HM:** untouched.

### What this leaves

- **The write side.** A `String` can hold a lone surrogate only if it came from foreign code, since Lexer §2.1 refuses one in source. `writeText` currently writes such a surrogate as U+FFFD. I'll take that up with decision 5 unless you want it settled here.
- **stdin** (stage 5, after v1) would follow whatever rule this decision sets.

### What would revisit it

- Bytes in the standard library, which would give a damaged file a way in, as `fs::read` does in Rust.
- A real need to read legacy encodings, which would want a decoder that takes the encoding as a parameter.

### Recommendation

**(b).** `readText` refuses a file that isn't well-formed UTF-8 with `FileError(NotUtf8, path, message)`, and the message names the first bad byte. A repairing sibling can follow whenever someone needs one, without breaking anything.

---

## What a failed write to stdout or stderr does (v1 I/O, decision 2c)

**Status:** ruled (c) by James on 2026-11-04: the writers are `->~`, a reader leaving ends the program with status 141, and any other failure ends it with one line and status 1. He confirmed the `EAGAIN` fix the same day. This was the write-up for that ruling, the last part of decision 2 (`IO-V1-D2.md`). Decision 2 is ruled (b): a failing file operation throws `FileError(reason, path, message)`. Decision 2b is ruled (c): `readText` refuses a file that isn't UTF-8, and `readTextLossy` replaces the bad bytes. This one asks what the four `Stdio` writers do when a write fails. The answer decides their colour.

**Up front:**
- **Doctrine leans one way.** Exceptions §1 says an exception is "an expected failure, one a caller should plan for". No caller can plan for its own output failing:
  - when the reader has gone, the output is no longer wanted;
  - when the disk is full, the only place left to say so is stderr.

  So I recommend that these failures end the program rather than throw. The writers would then be `->~`, impure and unable to fail.
- **Colleague languages.** The languages that track failure in types keep their everyday print outside that tracking:
  - Swift's `print` doesn't throw;
  - Rust's `println!` returns no `Result`; it panics;
  - Koka's `println` has the `console` effect and no `exn`.

  When the reader goes away, the languages split three ways:
  - C and Go end quietly, with status 141;
  - Rust and Python print an error;
  - Java and .NET carry on as if the write had worked.
- **HM:** untouched. The writers' types are written, and only their arrow changes, from `->!` to `->~`.
- **I found a bug on the way.** A program that calls `Debug.log` and then writes with `Stdio` fails with `EAGAIN` when its reader is slow. The fix needs no ruling, only your confirmation. It's at the end.

### What happens today (measured, Node 24.18.0, Linux)

The writers call `writeFileSync` on descriptor 1 or 2 and let Node's throw through as a `JsError`. The test program writes 200,000 lines to stdout, then "finished" to stderr.

| Where the output goes | What happens | Exit status |
|---|---|---|
| a file, `/dev/null`, or a pipe read to the end | everything is written, then "finished" | 0 |
| `\| head -1`: the reader leaves | `Error: EPIPE: broken pipe, write` and a stack through `Hex/Experimental/Node/Stdio.js`, on stderr | 1 |
| `> /dev/full`: the disk is full | `Error: ENOSPC: no space left on device, write` and a stack | 1 |
| stderr's reader leaves | nothing visible, since the error has nowhere to go; the program stops before "finished" | 1 |
| stdout closed (`>&-`) | Node reopens it on `/dev/null`, so every write "succeeds" | 0 |

A program can catch the broken pipe today: `try go!(200000) catch JsError(e) => …` caught `EPIPE: broken pipe, write`.

### The question

When a write to stdout or stderr fails, does the program get an exception it can catch, or does the program end?

### Colleague languages

Measured here with the same program in each language, where the language is installed:

| | The reader leaves (`\| head -1`) | The disk is full (`> /dev/full`) |
|---|---|---|
| C (gcc) | ends quietly, status 141 | output lost, then "finished", status 0 |
| Go 1.24.7 | ends quietly, status 141 | output lost, then "finished", status 0 |
| Rust 1.97.0 | panics: "failed printing to stdout: Broken pipe (os error 32)", status 101 | panics: "failed printing to stdout: No space left on device (os error 28)", status 101 |
| Python 3.13.18 | `BrokenPipeError` traceback, status 1 | `OSError: [Errno 28] No space left on device`, status 1 |
| Java (Kotlin's `println` uses the same stream) | carries on: "finished", status 0 | carries on: "finished", status 0 |
| Node's `console.log` | carries on: "finished", status 0 | carries on: "finished", status 0 |
| Node's `process.stdout.write` | unhandled `'error'` event, status 1 | unhandled `'error'` event, status 1 |

From their documentation and source:
- **Go** does this on purpose, and only for stdout and stderr: "A write to a broken pipe on file descriptors 1 or 2 (standard output or standard error) will cause the program to exit with a SIGPIPE signal. A write to a broken pipe on some other file descriptor will take no action on the SIGPIPE signal, and the write will fail with a [syscall.EPIPE] error." (`os/signal`)
- **Python** gives a whole note to the broken pipe. It recommends wrapping the entry point to catch `BrokenPipeError`, redirecting stdout to `/dev/null`, and exiting with status 1.
- **Rust** has turned the broken pipe into an error since 2014. Its `-Zon-broken-pipe=kill` flag, nightly only (tracking issue #97889), ends the program the way C does. `println!` "Panics if writing to io::stdout fails."
- **.NET** on Unix: on `EPIPE`, "Broken pipe... likely due to being redirected to a program that ended, so simply pretend we were successful". On `EAGAIN`, it waits until it can write and tries again. Any other error throws.
- **Swift's** `print` is declared without `throws`. **Koka's** `println` is `(s : string) : console ()`.
- I couldn't confirm OCaml or Haskell. Neither is installed here, and their documentation doesn't say.

What the tables show:
- **The reader leaving** gets one of three answers. C and Go end quietly, Rust and Python report it, and Java and .NET ignore it. Python and Rust both offer a way out of reporting it.
- **On a full disk,** C, Go and Java lose the output and report success. Rust and Python name the failure.
- **Where failure is typed,** the everyday print stays out of it. A program that has to handle a failed write uses a second, explicit writer, such as Rust's `writeln!` on a handle, which returns a `Result`.

### The options

**(a) Every failure throws a tracked exception, and the writers stay `->!`.**
- This is Python's model, and Hexagon's today.
- Which exception, and its name, belong to decision 5. `FileError`'s path slot has no natural value for stdout.
- Costs:
  - `program | head -1` prints an error and exits 1, unless the program catches it at the top. That is Python's experience, which its documentation needs a whole note to work around.
  - Every function that prints may fail. So the fail colour no longer picks out the failures a caller should plan for.

**(b) The reader leaving ends the program quietly with status 141. Every other failure throws, and the writers stay `->!`.**
- This is Go's split for stdout and stderr, with the other failures tracked.
- Costs: (a)'s colour cost stays, for failures such as a full disk that no caller plans for either.

**(c) The reader leaving ends the program quietly with status 141. Any other failure ends it with one line on stderr and status 1. The writers become `->~`.**
- A program writes `Stdio.writeLine~(answer)`.
- **The message** is Hexagon's own one line, such as `cannot write to standard output: no space left on device`. Decision 5 settles the wording.
- **141 is 128 plus SIGPIPE's number, 13.** That is the status a shell reports for C, for Go, and for `yes | head -1` (measured: 141).
  - Node ignores SIGPIPE, so the program can't end by the signal itself. It exits with the same number instead.
  - A shell sees the same `$?`. A parent process that reads the raw wait status sees an exit rather than a signal.
- **Measured with a prototype adapter:** `| head -c 10` gives status 141 and an empty stderr.
- Costs:
  - **No `catch` sees the ending,** just as none sees Ctrl-C. Hexagon has no such ending today, though decision 4 may add "end now" for the exit status anyway.
  - **A program that must keep running when its output fails,** such as a long-running service, can't do it with these writers. A `->!` writer beside them, like Rust's `writeln!`, could come later without breaking anything.
  - **Under `set -o pipefail`,** `program | head -1` fails the pipeline, just as `yes | head -1` does.
  - **An exported Hexagon function that prints,** called from a JavaScript application, ends that application when its stdout reader leaves, as a C library's print would.
  - **About ten `Stdio…!` call sites become `~`.** They are in tests, the CLI's README and the experimental spec. The book doesn't use `Stdio`.

**(d) Ignore the failure and carry on, as Java, .NET and Node's `console.log` do.**
- Way 5 rules this out, because the program reports success when its output was lost. The experimental spec forbids it too. It is listed for completeness.

### Doctrine fit

- **Exceptions §1.** An exception is for a failure "a caller should plan for: a parse error, a missing file, a timeout".
  - A missing file has a plan: a default, or a message.
  - A reader that left, or a full disk under stdout, has none at the call. The only plan is to stop.
  - Of the options Way 5 allows, only (c) keeps the fail colour meaning "plan for this".
- **Effects §6.1:** "`->~` claims that a function that is impure never fails". Under (c) the claim is true: a write either finishes or the program ends. The adapter catches every throw, which keeps it true.
- **Way 5, "name it, don't repair it".** (c) names both endings: the shell's own status for a reader that left, and a message for anything else. (d) repairs silently, which is how C, Go and Java treat a full disk.
- **Way 6, Swift as the effects precedent.** Swift's `print` doesn't throw.
- **HM:** untouched.

### The `EAGAIN` bug

- **What happens.** `Debug.log` writes through Node's `console.log`, and that makes Node switch stdout's pipe to non-blocking. After that, a `Stdio` write to a pipe whose reader is slower than the program fails with `EAGAIN: resource temporarily unavailable`.
  - A program logged "starting", then wrote 2,000 lines into `| (sleep 1; wc -c)`. It stopped after 64,512 bytes, with status 1.
  - Without the `Debug.log`, or with a fast reader, the same program wrote all 2,018,902 bytes.
- **Nothing failed.** The pipe was full and the descriptor wouldn't wait, where an ordinary blocking write would have waited.
  - So the writer waits about a millisecond and tries again, until the text is written. That finishes the write the program asked for, and repairs nothing.
  - .NET's console writer does the same: on `EAGAIN` it waits until it can write, "and loop around to do another write".
  - Rust's `println!` documentation warns about the case: "Writing to non-blocking stdout can cause an error, which will lead this macro to panic."
- **This fix goes in whichever option you choose.** I'm asking only that you confirm it. It replaces the experimental spec's line "The module does not normalize errors or add retry policy."
- **Measured with a prototype adapter:**
  - The slow-reader program wrote all 2,018,902 bytes, then "finished", after 759 waits.
  - The prototype is about a fifth slower on 200,000 one-line writes: medians of 438 ms today and 537 ms, over 11 runs on a loaded machine. The PR will tune it and report the numbers.

### What this leaves

- **Decision 4, the exit status.** (c)'s two statuses, 141 and 1, stay whatever decision 4 says about a status the program sets.
- **Decision 5, names:** the message's wording, and under (a) or (b), the exception.
- **stdin,** after v1: a failed read is a different question, since a program can plan for its input.

### What would revisit it

- A program that needs to keep going after its output fails. That would add a `->!` writer beside the four, which breaks nothing.
- A second host.

### Recommendation

**(c).** The four writers become `->~`.
- A reader leaving ends the program quietly with status 141.
- Any other failure ends it with one line on stderr and status 1.
- The `EAGAIN` fix goes in whichever way you rule.

---

## The command-line arguments (v1 I/O, decision 3)

**Status:** ruled (a) by James on 2026-11-04: `arguments: () ->~ Vector(String)`, the user's arguments only. He confirmed the U+FFFD contract the same day. This was the write-up for that ruling, the third of the five decisions in `IO-V1.md`. Decisions 1, 2, 2b and 2c are ruled (2026-11-04):

**Correction (2026-11-04, after the ruling):** the examples below index the arguments from `[0]`, but a `Vector` is indexed from 1 (Collections Part 3), so the first argument is `[1]`, and `[0]` throws `IndexFault`. In option (c), "index 0" and "index 1" are likewise `[1]` and `[2]`. The ruling is unaffected.
- `File` and `Stdio` graduate, Node only;
- a failing file operation throws `FileError`;
- `readText` is strict and `readTextLossy` replaces bad bytes;
- a failed write to stdout or stderr ends the program.

This one decides how a program gets the words typed after its name, such as `node dist/Main.js input.txt`.

**Up front:**
- **Doctrine leans one way.** Effects §1 names "reading input" first among the things that make a function impure, and the arguments are input. So I recommend a call, `() ->~ Vector(String)`, that is impure and cannot fail, and not a value.
- **Colleague languages:**
  - Where effects are typed, the arguments are an effectful read: Koka's `get-args` is `ndet`, and Haskell's `getArgs` is in `IO`.
  - Where they aren't, the arguments are often a plain value: OCaml's `Sys.argv`, and Swift's `CommandLine.arguments`, which a program can even assign to.
  - On the program's name, they split. Koka, Haskell, F#, Kotlin, Gleam and Node's own argument parser give only the user's arguments. OCaml, Swift, Rust, Go and Python put the program first.
- **HM:** nothing here touches inference. The type is written, and it is a function of no arguments.

### What happens today (measured, Node 24.18.0, Linux)

- **Hexagon has no way to read the arguments,** so an Advent of Code program writes its input path into its source.
- **What Node holds.** `process.argv` is Node's path, then the script's absolute path, then the user's words:
  - `node a.mjs input.txt -- --flag` gives `["input.txt", "--", "--flag"]` after the first two. Node passes everything after the script through untouched, `--` included.
  - Node's own options before the script aren't there: `node --max-old-space-size=100 a.mjs` adds nothing.
  - Under `node -e`, there is no script, so the user's words start one place earlier. Node's own `util.parseArgs` gets this right by default: `node -e '…parseArgs…' one two` gives `["one", "two"]`.
- **Bytes that aren't UTF-8 are replaced before any code sees them.** An argument with the bytes `a`, `0xFF`, `b` arrives as `a�b`, with U+FFFD. `caf` and a Windows-1252 `é` arrives as `caf�`. An argument that starts with a BOM keeps its U+FEFF.

### The question

Are the arguments a value or a call, and do they include the program?

### Colleague languages

| | How a program gets them | Effectful in the type? | The program's name first? | Bytes that aren't Unicode |
|---|---|---|---|---|
| Koka | `get-args(): ndet list<string>` | yes, `ndet` | no; `get-argv()` gives the whole command line | not documented |
| Haskell | `getArgs`, in `IO` | yes | no ("not including the program name"); `getProgName` gives it | decoded; a `ByteString` version gives "the exact bytes" |
| F#, Kotlin | `main`'s parameter | no | no | |
| Gleam (`argv`) | `load() -> Argv(runtime, program, arguments)` | no | no; `program` is a field of its own | not documented |
| OCaml | `Sys.argv : string array` | no; a value | yes: "The first element is the command name used to invoke the program." | bytes, not decoded |
| Swift | `static var arguments: [String] { get set }` | no; a settable value | yes: "The name of the executed program is the first argument." | not documented |
| Rust | `env::args() -> Args` | no | yes: "traditionally the path of the executable, but it can be set to arbitrary text, and might not even exist" | panics; `args_os` gives the raw form |
| Node | `process.argv` | no | yes, twice: Node's path, then the script's | replaced with U+FFFD (measured) |

What the table shows:
- **Typed effects make the read an effect.** Koka and Haskell, the two languages here that type effects, both do. The languages that make the arguments a value don't track effects at all.
- **Languages that leave the program out give it its own name** where it's needed: Haskell's `getProgName`, Koka's `get-argv`, Gleam's `program` field.
- **Element 0 is unreliable where it's included.** Rust's documentation warns against relying on it, and under Node it's two paths, neither of which is what the user typed.

### The options

**(a) A call, `arguments: () ->~ Vector(String)`, with only the user's arguments.**
- A program writes:
  ```hexagon
  let path = Process.arguments~()[0]
  let input = File.readText!(path)
  ```
  The module's name and the function's name belong to decision 5.
- **What it gives:**
  - the words after the script, as Node's `util.parseArgs` finds them, `node -e` included;
  - each call returns a fresh `Vector(String)`;
  - it cannot fail.
- Costs:
  - **A mark, `~`.** Most programs read the arguments once, at the top, where reading the file already makes the code impure. A function handed the path as a parameter stays pure.
  - **Each call copies Node's array.** A program that calls it in a loop copies it each time.

**(b) A value, `arguments: Vector(String)`, with only the user's arguments, read once when the program starts.**
- **Effects §6.2 species (b) would allow it.** That species admits "a read the runtime performs at most once and then owns", and the hash table's per-process seed is read that way.
- A program writes `Process.arguments[0]`, with no mark.
- Costs:
  - **A pure function can then depend on how the program was started,** and its colour won't show it. A library function deep inside a program could read the command line, and a reader who sees no mark is told it reads nothing.
  - **It's a reading of species (b) that no member makes today.** Every member keeps still something the program already holds, or never asked for: a thrown value, an iterator handed in, the hash seed. The arguments are new information from outside, which is what Effects §1 calls input.

**(c) Either shape, with the program first.**
- This is the OCaml, Swift, Rust, Go and Python convention.
- Costs:
  - **Under Node, "the program" is two paths,** Node's and the script's. Either choice puts a path from `dist/` at index 0, and the user's first word at index 1, so every program skips index 0.
  - **Rust's documentation warns that element 0 "might not even exist".**

### The text the arguments carry

Hexagon can't do for arguments what 2b does for files. Node has already replaced any bad bytes with U+FFFD before Hexagon's code runs, and an argument may also hold a real U+FFFD. So refusing on U+FFFD would refuse good input. The contract says so plainly:
- the arguments are the host's decoding of the command line;
- under Node, bytes that aren't UTF-8 arrive as U+FFFD;
- nothing strips a BOM.

That fits your view that a dev should think only in UTF-8, since every argument is a well-formed string. This part is the host's to decide, not a choice for you, so I'm asking only that you confirm it.

### Doctrine fit

- **Effects §1:** "The world colour says whether a function is impure: whether it may interact observably with the world, reading input, writing output, consulting a clock or an entropy source…". (a) follows that sentence directly. (b) needs the species-(b) exception stretched to cover input.
- **"A reader who sees no mark may assume that the call is pure"** (Effects §1). Under (a), that promise keeps meaning that a function's answer comes from its arguments. Under (b), the command line becomes a hidden argument to every pure function.
- **Pure collections denote stable contents.** A fresh `Vector(String)` per call is a value from the moment it's returned.
- **HM:** untouched.

### What this leaves

- **Decision 4,** the exit status.
- **Decision 5,** names and hosts:
  - the module's and the function's names;
  - what `arguments` does in the playground, which has no command line.
- **Option parsing,** such as `--part 2`, is a library question for later. Node's `util.parseArgs` exists for a JavaScript program meanwhile.
- **The program's own path,** if a program ever needs it, would be a call of its own, like Haskell's `getProgName`, and breaks nothing.

### What would revisit it

- **A `main` function.** Hexagon programs run their top level, so a parameter has nowhere to go today. If Hexagon gains an entry function, the arguments could become its parameter, as in F# and Kotlin.
- **A host that hands over the raw bytes,** which would allow a strict reading like 2b's.

### Recommendation

**(a).** `arguments: () ->~ Vector(String)` returns only the user's arguments, as Node's own parser finds them, and cannot fail. Arguments that aren't UTF-8 arrive as U+FFFD, because the host has already decoded them.

---

## The exit status (v1 I/O, decision 4)

**Status:** ruled (a) by James on 2026-11-04: `setExitStatus: Int ->~ Unit`, values 0 to 255, and no "end now" in v1. This was the write-up for that ruling, the fourth of the five decisions in `IO-V1.md`. Ruled so far (2026-11-04):

**Correction (2026-11-04, after the ruling):** the examples below index the arguments from `[0]`, but a `Vector` is indexed from 1 (Collections Part 3), so the first argument is `[1]`, and `[0]` throws `IndexFault`. The ruling is unaffected.
- `File` and `Stdio` graduate, Node only;
- a failing file operation throws `FileError`;
- `readText` is strict, and `readTextLossy` replaces bad bytes;
- a failed write to stdout or stderr ends the program, with status 141 when the reader has left and 1 otherwise;
- `arguments: () ->~ Vector(String)` gives the user's arguments.

This one decides how a program reports that it failed, so that a shell or a script can tell.

**Up front:**
- **Doctrine and Node point the same way.** Node's documentation says that, rather than calling `process.exit()`, code "*should* set the `process.exitCode` and allow the process to exit naturally". Rust's documentation says the same of its `exit`. So I recommend that v1 only sets the status the program reports when it finishes, `Int ->~ Unit`, and has no "end now".
- **Colleague languages:**
  - Most have an "end now" that never returns: OCaml's `exit : int -> 'a`, Rust's `exit(code: i32) -> !`, Kotlin's `exitProcess(status: Int): Nothing`, Go's `os.Exit`.
  - Node and .NET also have a status that is set and then reported at the end: `process.exitCode` and `Environment.ExitCode`.
  - Rust prefers returning an `ExitCode` from `main`, and Python's `sys.exit` is really an exception.
- **HM:** the setter is an ordinary `Int ->~ Unit`. An "end now" would need a result type that unifies with anything, as `throw`'s does. That can't be written as an extern in v1, since generic externs aren't part of v1 (probe: "generic extern declarations are not part of Hexagon v1"). So it would be a new intrinsic.

### What happens today (measured, Node 24.18.0, Linux)

- **Hexagon has no way to set the status.** A program ends with 0, or with 1 from an uncaught exception or fault.
- **Node's status that is set and reported at the end:**
  - `process.exitCode = 3` ends with 3.
  - If an uncaught throw follows `process.exitCode = 3`, the program ends with 1. The failure wins.
- **Node wraps values outside 0 to 255:** 256 ends with 0, which is success; 300 ends with 44; and -1 ends with 255. A program that sets 256 would report success.
- **Node refuses values that aren't whole numbers.** `1.5` throws `ERR_OUT_OF_RANGE`.
- **"End now" loses output that is still on its way.** I logged 100,000 lines with `console.log`, which is what `Debug.log` uses, into a reader that waits a second, then ended:

  | How the program ended | Lines that arrived |
  |---|---|
  | `process.exit(0)` | 6,656 |
  | `process.exitCode = 0`, then finishing | 100,000 |

  `Stdio`'s writes are synchronous, so they aren't lost either way. What an "end now" drops is `Debug.log`'s pending output.

### The question

Does v1 set a status that the program reports when it finishes, end the program at once with a status, or both?

### Colleague languages

| | End now | Set a status reported at the end | What the values are |
|---|---|---|---|
| OCaml | `exit : int -> 'a`, which flushes output and runs `at_exit` callbacks | none | `int`; an uncaught exception gives 2 |
| Rust | `exit(code: i32) -> !`; "no destructors … will be run" | `main` returns an `ExitCode`, which the docs prefer | `ExitCode::SUCCESS`, `FAILURE`, `From<u8>` |
| Kotlin | `exitProcess(status: Int): Nothing` | none | `Int` |
| Go | `os.Exit(code int)`; "deferred functions are not run" | none | "For portability, the status code should be in the range [0, 125]." |
| .NET | `Environment.Exit(int)`; `finally` blocks don't run | `Environment.ExitCode { get; set; }` | 32-bit |
| Python | `sys.exit` raises `SystemExit`, which can be caught | none | "Most systems require it to be in the range 0–127" |
| Node | `process.exit(code)`, which may lose pending output | `process.exitCode` | wraps outside 0–255 (measured) |

What the table shows:
- **The ML family makes "end now" a function that never returns,** typed like `throw`.
- **The newer platform documentation steers away from it.** Rust prefers returning an `ExitCode` from `main`. Node says to set `exitCode` and let the program finish, and adds that "throwing an *uncaught* error and allowing the process to terminate accordingly is safer than calling `process.exit()`."
- **Nobody agrees on the range.** Go advises 0 to 125, Python 0 to 127, and Rust's docs say that "On most Unix-like platforms, only the eight least-significant bits are considered."

### The options

**(a) Set the status reported at the end: `setExitStatus: Int ->~ Unit`.**
- Decision 5 settles the name.
- **The values** are 0 to 255. Anything else is a fault, since Node would turn 256 into a success.
- **The last setting wins.** An uncaught exception or fault still ends the program with 1, and 2c's endings still give 141 and 1.
- **A program that stops early does so by its own control flow** (this compiled, with stand-ins for the library functions):
  ```hexagon
  let args = Process.arguments~()
  if Vector.isEmpty(args) then
      Stdio.writeErrorLine~("usage: node dist/Main.js <input>")
      Process.setExitStatus~(2)
  else
      solve!(args[0])
  ```
  Deeper in a program, it throws, and catches at the top to print the message and set the status. Rust's `main` returning a `Result` follows the same route.
- Costs:
  - **A program can't stop from deep inside with a status of its own choosing** without passing control back up to the top. An uncaught exception gives 1, with Node's error printout.
  - **Code after the setting still runs,** so a program has to arrange not to do further work.

**(b) End now: `exit: Int ->~ a`.**
- This is OCaml's, Rust's and Kotlin's shape.
- Costs:
  - **`Debug.log`'s pending output is lost** (measured above).
  - **It is a third way out of a function, beside returning and throwing, and it's the program's own choice.** A library function that calls it ends any JavaScript application that imports it.
  - **It needs a new intrinsic,** since a generic extern isn't part of v1.

**(c) Both.**
- This is what Node and .NET offer.
- Costs: (b)'s costs, and two ways to do one thing.

### Doctrine fit

- **Exceptions §1:** "a number that does not fit" is one of a fault's own examples. So a status outside 0 to 255 is a fault, not something to wrap. Wrapping would repair it (Way 5), and turn 256 into a success.
- **Effects:** setting the status is impure, and it can't fail on a valid value, so its arrow is `->~`.
- **Under (a), a Hexagon function still ends only by returning or by throwing,** apart from 2c's ending, which the environment causes rather than the program. Under (b), any call could end the program, and no `catch` sees it.
- **"JS says what to provide, ML its shape."** Node provides the status that's set and reported at the end, and recommends it. The value is a plain `Int`, as OCaml's `exit` takes, rather than a union like Rust's `ExitCode`. The fault keeps the `Int` honest.
- **HM:** (a) is untouched. (b) needs an intrinsic with `throw`'s typing.

### What this leaves

- **Decision 5:** the names of the setter and of the fault, and what the playground does with a status.
- **Whether 126 to 255 should also be refused,** as Go's advice would have it. 126 and 127 mean "couldn't run" to a shell, and 128 plus n means "killed by signal n". I left them allowed, because Hexagon itself uses 141, and a program may want to report one, such as 130 after Ctrl-C.

### What would revisit it

- **An entry function, `main`.** Its result could carry the status, as Rust's and F#'s do.
- **A real need to stop from deep inside.** `exit` could then be added beside the setter without breaking anything.

### Recommendation

**(a).** `setExitStatus: Int ->~ Unit` takes values 0 to 255 and treats anything else as a fault. The last setting wins, and the program reports it when it finishes. An uncaught exception or fault still gives 1, and there is no "end now" in v1.

---

## Where the I/O operations live, and their names (v1 I/O, decision 5a)

**Status:** ruled (a) by James on 2026-11-04, `writeTextBom` included. This was the write-up for that ruling, the first part of the last of the five decisions in `IO-V1.md`. Decisions 1 to 4 are ruled (2026-11-04). This part settles the modules and the names. Two more parts follow: 5b, the playground and the browser, and 5c, writing a string that holds a lone surrogate.

**Correction (2026-11-04, after the ruling):** the examples below index the arguments from `[0]`, but a `Vector` is indexed from 1 (Collections Part 3), so the first argument is `[1]`, and `[0]` throws `IndexFault`. The ruling is unaffected.

**Up front:**
- **Precedent decides most of it.**
  - `Regex` and `Rat` are the standard library's modules outside the prelude, reached by `import Regex` and `import Rat` ("the rest of `Hex`", Packages §2.4).
  - The standard library's exceptions carry their subject in the name: `RegexError`, `JsConversionError`, `NumberFormatError`.

  I recommend three modules outside the prelude, `File`, `Stdio` and `Process`, with an exception called `FileError`.
- **Colleague languages.** Printing is usually always available: Rust's `println!`, Haskell's `putStrLn`, Kotlin's `println`. Files, arguments and exit usually sit in a module the program names: Rust's `std::fs`, `std::env` and `std::process`; Haskell's `System.Environment` and `System.Exit`; Go's `os`; Python's `sys`; Koka's `std/os/env`. OCaml puts all of it in its always-available `Stdlib`.
- **HM:** names only; inference is untouched.

### What's there today

- **Two modules:** `Hex.Experimental.File` and `Hex.Experimental.Stdio`, each imported explicitly, each over a Node adapter module, `Hex.Experimental.Node.File` and `Hex.Experimental.Node.Stdio`. The adapters exist so that other hosts could have their own; with Node the only host, they no longer have that job.
- **The prelude** is every module that every program sees without an import. Today every prelude module works on every host: `Debug` writes through `console.log`, which a browser has too.
- **Modules §5.5 makes every prelude exception and fault a bare name,** and calls that set closed: "An addition is a design ruling".
- **A prelude union's constructors are spelled through the union's own module,** as in `JsConversionReason.Shape`. Outside the prelude, they're spelled through the module that declares them, as in `File.NotFound`. I checked both spellings with probes for decision 2.
- **An exception named plain `Error` loses its name when it goes uncaught.** I measured two stand-ins in one module:
  - `exception Error(…)` prints as `Error: not found: input.txt`, which can't be told from a JavaScript error;
  - `exception FileError(…)` prints as `Error [FileError]: not found: input.txt`.

### The question

Are the three modules in the prelude or imported, and what are they and their operations called?

### The options

**(a) Three modules outside the prelude: `Hex.File`, `Hex.Stdio` and `Hex.Process`.**
- A program imports them as it imports `Regex`:
  ```hexagon
  module Main

  import File
  import Stdio
  import Process

  let input = File.readText!(Process.arguments~()[0])
  Stdio.writeLine~("${solve(input)}")
  ```
  This compiled with stand-in modules of these names, as did the catch arm below.
- **What each module holds:**

  | Module | Name | Type | Note |
  |---|---|---|---|
  | `File` | `readText` | `String ->! String` | strict UTF-8, one leading BOM dropped (2b) |
  | | `readTextLossy` | `String ->! String` | bad bytes become U+FFFD, one leading BOM dropped (2b) |
  | | `writeText` | `(String, String) ->! Unit` | path, then text; writes no BOM |
  | | `writeTextBom` | `(String, String) ->! Unit` | **new:** one BOM, then the text as given |
  | | `FileError` | `exception FileError(reason: FileErrorReason, path: String, message: String)` | decision 2 |
  | | `FileErrorReason` | `NotFound`, `PermissionDenied`, `IsDirectory`, `NotDirectory`, `NotUtf8`, `Other(code: String)` | decisions 2 and 2b |
  | `Stdio` | `write`, `writeLine`, `writeError`, `writeErrorLine` | `String ->~ Unit` | the experimental names; 2c's colour |
  | `Process` | `arguments` | `() ->~ Vector(String)` | decision 3 |
  | | `setExitStatus` | `Int ->~ Unit` | decision 4 |
  | | `ExitStatusFault` | `fault ExitStatusFault(status: Int)` | a status outside 0 to 255 (decision 4) |

- **A program that plans for a missing file** writes `File.FileError(File.NotFound, path, _)` in a catch arm.
- **`writeTextBom`** is your rule from earlier today: "standard functions write no BOMs. Bom versions of functions can be allowed where sensible", such as a CSV file meant for Excel.
  - It writes U+FEFF, then the text exactly as given. So `writeTextBom` followed by `readText` gives back the text.
  - The name avoids `With`, which Collections Part 1 §3.4 keeps for producers.
  - It's an addition to decision 1's list. Leave it out if you'd rather it waited.
- **The experimental modules and their Node adapters go away,** with no redirects, since nothing has been released. Each module calls `node:fs` itself.
- Costs:
  - **An import line per module.** A typical Advent of Code program has the three above.
  - **`File.FileError` says "file" twice.** That's the price `Regex` already pays with `Syntax.RegexError`.

**(b) The same three modules in the prelude, reached with no import, as `Debug` is.**
- A program writes `File.readText!(…)` with no import lines.
- Costs:
  - **The prelude would hold modules that only work under Node.** A browser program could call `File.readText!` with nothing in its text saying it needs a host with files, and fail only when it runs.
  - **`FileError` would join Modules §5.5's closed bare set,** which needs a ruling of its own.
  - **The reasons would move to a module of their own,** spelled `FileErrorReason.NotFound`, as `JsConversionReason.Shape` is.

**(c) One module for all of it, such as `Io` or `System`.**
- This is Go's `os`, and close to OCaml's `Stdlib`.
- Costs:
  - **The names have to carry what the module name no longer does,** such as `Io.readFile` and `Io.writeErrorLine`.
  - **Arguments, the exit status and files are three subjects.** Rust, Haskell and Koka keep them apart.

### Smaller name choices inside (a)

- **`FileError`, not `File.Error`.** An exception named `Error` prints like a JavaScript error when uncaught (measured above), and `show` would print `Error: …` as well. `RegexError` and `JsConversionError` are the precedent.
- **`FileErrorReason`, not `FileReason`.** `JsConversionError`'s reason union is `JsConversionReason`, which would suggest `FileReason`. But that reads as "a file's reason". The union's name is written only in a type annotation, since its constructors are spelled `File.NotFound`.
- **`readTextLossy`.** This is Rust's word (`from_utf8_lossy`), and the name we've used since 2b.
- **`Process`, `arguments` and `setExitStatus`.**
  - `Process` is Node's word and Rust's.
  - `arguments` is spelled out, as Hexagon's names are.
  - `setExitStatus` is POSIX's "exit status" and the plan's word. Node and .NET say "exit code".

### Doctrine fit

- **Packages §2.4 and Modules §5.5:** the prelude is what every program sees. Keeping the Node-only modules out of it keeps that true on every host. An import line then states, in the program's text, that it needs files and a command line.
- **Modules §5.5's closed bare set:** (a) adds nothing to it, while (b) would need a ruling.
- **Collections Part 1 §3.4:** `writeTextBom` keeps `With` for producers.
- **HM:** untouched.

### What this leaves

- **5b, the playground and the browser:**
  - what happens when a program that imports these modules runs in the browser;
  - whether the playground shows `Stdio` output in its output pane.

  If it does, `Stdio` would work on every host, and that might reopen whether `Stdio` alone belongs in the prelude.
- **5c, a lone surrogate on write.** A `String` holds one only if it came from foreign code. Today `writeText` and `Stdio` write it as U+FFFD.

### What would revisit it

- **A second host.** It would bring back an adapter layer, but not a public one.
- **`Stdio` working in the browser** (see 5b above).

### Recommendation

**(a).** Make three modules outside the prelude, `Hex.File`, `Hex.Stdio` and `Hex.Process`, with the names in the table, `writeTextBom` included. The experimental modules and their adapters go.

---

## The playground and the I/O modules (v1 I/O, decision 5b)

**Status:** ruled (a) by James on 2026-11-04. This was the write-up for that ruling, the second part of decision 5. 5a is ruled (a) (2026-11-04): `Hex.File`, `Hex.Stdio` and `Hex.Process` sit outside the prelude and work under Node. This part decides what the playground, which runs programs in the browser, does with a program that imports them. You asked for it to note how the TypeScript Playground behaves; that section comes first.

**Up front:**
- **The TypeScript Playground's model** is "this is a browser, and Node isn't here":
  - the editor type-checks Node code;
  - Run executes what the browser can, and shows `console.log` and `console.error` in its Logs panel, each tagged;
  - the first use of a Node API stops the run with the browser's own error;
  - the output before that point stays.
- **Hexagon can do one better,** because it owns the modules a program calls, where TypeScript doesn't own Node's. I recommend that the playground behave like a terminal running the program with no arguments, in an empty directory that can't be written to:
  - `Stdio` writes to the output pane;
  - `Process.arguments~()` is empty;
  - the exit status shows at the end;
  - `File` reports `NotFound` on a read and a read-only error on a write.

  So a program behaves exactly as it would under Node in that situation.
- **Doctrine:** no rule bends. Every answer the playground gives is one Node gives in some real situation.
- **HM:** untouched. Nothing about compiling changes.

### How the TypeScript Playground behaves

The live site, typescriptlang.org, is blocked by this environment's network policy, so I read its source (`microsoft/TypeScript-Website`, `packages/playground/src/sidebar/runtime.ts`, `packages/sandbox`, `packages/ata`). Then I ran its run step in Chromium 153: `eval` of the emitted JavaScript, with `console` replaced by its logging wrapper.

- **The editor knows Node.** Its automatic type acquisition maps `fs`, `process` and any `node:` import to `node`, and fetches `@types/node`. So Node code type-checks in the editor.
- **Run executes the emitted JavaScript in the page.** Its `console.log`, `console.error` and `console.warn` go to the Logs panel, tagged `[LOG]`, `[ERR]` and `[WRN]`, in order. On a throw, the panel adds "Executed JavaScript Failed:" and the error's message.
- **What the panel shows** (each run reproduced in Chromium):

  | The program | The Logs panel |
  |---|---|
  | `import * as fs from "fs"` (the default module setting, ESNext) | `[ERR]: Executed JavaScript Failed:`, then `[ERR]: Cannot use import statement outside a module` |
  | `require("fs")` (module setting CommonJS) | `… require is not defined` |
  | `console.log("before")`, then `process.argv` | `[LOG]: before`, then `… process is not defined` |
  | `console.log("before")`, then `process.exitCode = 2` | `[LOG]: before`, then `… process is not defined` |
  | `console.log("out")`, then `console.error("err")` | `[LOG]: out`, then `[ERR]: err` |

- **In short:** it type-checks Node code, runs anything that doesn't touch Node, keeps the error channel visible and separate, and stops at the first Node API with the browser's message.

### What Hexagon's playground does today (measured)

- **It compiles a program with the whole standard library,** so `import File` type-checks, as TypeScript's editor does with Node's types.
- **It runs the emitted modules in a worker,** each from a Blob URL. `console.log` is routed to the output pane, which is where `Debug.log` lands.
- **A module that imports `node:fs` makes the whole program fail to load.** In Chromium, importing such a module through a Blob URL, as the worker does, fails with `TypeError: Failed to fetch dynamically imported module: blob:null/…`.
  - Nothing runs, not even the output that comes before the first file read.
  - The message doesn't name `node:fs`.
  - This is worse than TypeScript's behaviour on both counts.

### The question

When a program that imports `File`, `Stdio` or `Process` runs in the playground, what happens?

### The options

**(a) The playground stands in for a terminal: no arguments, and an empty directory that can't be written to.**
- **`Stdio.write` and `writeLine`** go to the output pane, in order with `Debug.log`'s lines. **`writeError` and `writeErrorLine`** go to the same pane, marked as errors, as TypeScript's `[ERR]` is.
- **`Process.arguments~()`** gives an empty `Vector`, which is what a program run with no arguments gets.
- **`Process.setExitStatus~(2)`** shows at the end of the run, as "exit status 2". A status of 0 shows nothing.
- **`File.readText!`** throws `FileError(NotFound, path, …)`, and **`File.writeText!`** throws `FileError(Other("EROFS"), path, …)`, Node's code for a read-only file system. A program that plans for a missing file runs its plan.
- **How:** the playground links its own small `node:fs` and `node:process` beneath the three modules, so the modules themselves are the same bytes under Node and in the browser.
- Costs:
  - **The stand-ins have to stay in step with what the three modules call.** A test runs the same programs under Node and in the playground, and compares what they print.
  - **A program can't read a real input file in the playground.** A way to give it files, like the Go playground's extra files, would be a later feature, and adding it breaks nothing.

**(b) TypeScript's way: Node-only calls stop the run.**
- The program loads, and `Debug.log` reaches the pane. The first call to `File`, `Stdio` or `Process` stops the run with a message naming it, such as "`Stdio.writeLine` needs Node, and the playground runs in the browser". The output before it stays.
- Costs:
  - **A program that prints with `Stdio` can't be shown in the playground.** Its author would have to switch to `Debug.log`, which is a debugging probe and isn't meant for real output (Effects §6.2, species (a)).
  - **The pane would need its own way to tell a stopped run from a program that failed.**

**(c) The playground refuses a program that imports them, before running it.**
- It shows a message such as "this program imports `File`, which needs Node".
- Costs: the same as (b), and even the `Debug.log` lines never run.

### Doctrine fit

- **Under (a), nothing is pretended.** Every answer is one Node gives:
  - an empty `Vector` for a program run with no arguments;
  - `NotFound` for a file that isn't there;
  - `EROFS` for a directory that can't be written to.

  A program that works in the playground works under Node in that situation, and the playground never shows a program doing something it couldn't do under Node.
- **Debug.log stays a probe.** (a) gives real output a real channel in the playground, instead of pushing authors toward `Debug.log`.
- **Decision 1 (Node only) is unchanged.** The playground isn't a host for Hexagon programs in general; it's a teaching tool with its own terminal. A web page that imports these modules outside the playground still fails to load, because nothing there stands in for Node.
- **HM:** untouched.

### What this leaves

- **5c,** a lone surrogate on write.
- **A playground "files" feature,** to give `readText` something to read. That's for later.
- **Whether `Stdio` belongs in the prelude,** which 5a noted. It stays out: (a) makes `Stdio` work in the playground, not in the browser in general.

### What would revisit it

- **A playground that runs programs on a server,** as Rust's, Go's and Kotlin's do. It would then have a real stdout, real arguments and real files.
- **Hexagon targeting the browser as a host,** which would need its own answer for each module.

### Recommendation

**(a).** The playground runs a program like a terminal with no arguments, in an empty directory that can't be written to:
- `Stdio` goes to the output pane, with stderr marked;
- `arguments` is empty;
- a non-zero exit status shows at the end;
- `File` answers as Node would there, with `NotFound` on a read and `EROFS` on a write.

---

## Writing a string that holds a lone surrogate (v1 I/O, decision 5c)

**Status:** ruled (b) by James on 2026-11-04: the six writers refuse text that holds a lone surrogate with `LoneSurrogateFault(position)`, before writing anything, and `String.toWellFormed` is the repair. This was the write-up for that ruling, the last part of decision 5, and the last I/O decision before the graduation PR. Decision 2b ruled that `readText` refuses a file that isn't UTF-8. This is the same question for writing: what `File.writeText`, `File.writeTextBom` and the four `Stdio` writers do with text that UTF-8 cannot represent.

**Up front:**
- **What can't be written.** A Hexagon `String` can hold a lone surrogate only when foreign code supplies it: the lexer refuses one in source, and `String.fromCodepoint` never makes one. The String spec keeps such a surrogate intact through every string operation. UTF-8 has no encoding for it.
- **Doctrine leans one way.** Way 5 is "name it, don't repair it", and 2b already refuses to make up characters when reading. So I recommend that writing such a string be refused, with a fault that names the position. A new `String.toWellFormed`, JavaScript's own name, would be the explicit repair.
- **Colleague languages.**
  - Python refuses, both writing a file and printing.
  - Java refuses in `Files.writeString`, but prints `?`.
  - Node writes U+FFFD.
  - Rust's `String` can't hold a lone surrogate at all.
- **HM:** untouched.

### What happens today (measured, Node 24.18.0)

- **`writeText` and the `Stdio` writers pass the string to `node:fs`,** which writes each lone surrogate as `EF BF BD`, U+FFFD. The text `a`, U+D800, `b` becomes `61 EF BF BD 62`.
- **Nothing reports the replacement.** Reading the file back gives `a�b`, so the round trip that 2b protects on reading is broken here on writing.
- **JavaScript itself has both sides.** `"a\uD800b".isWellFormed()` is `false`, and `toWellFormed()` gives `"a�b"`. `encodeURIComponent` refuses the same string with `URIError: URI malformed`.

### The question

When the text handed to a writer holds a lone surrogate, does the writer replace it with U+FFFD, or refuse?

### Colleague languages

| | Writing a file | Printing | The explicit repair |
|---|---|---|---|
| Python 3.13 | `UnicodeEncodeError: 'utf-8' codec can't encode character '\ud800' in position 1: surrogates not allowed`; the file is left empty, since it was truncated first | the same error | `errors="replace"` |
| Java | `Files.writeString` throws `UnmappableCharacterException` | `System.out.println` writes `?` (`61 3F 62`) | an encoder set to replace |
| Node | writes U+FFFD | writes U+FFFD | `toWellFormed()` |
| Rust | a `String` can't hold one: `String::from_utf16` refuses with `LoneSurrogate`, and `from_utf16_lossy` gives `"a�b"` | | `from_utf16_lossy` |

All of these are measured here.

What the table shows:
- **Python refuses, and Java's file writer does.** Each also has a named way to replace.
- **Where a language replaces silently, the replacement isn't what the program wrote:** Java's printing writes `?`, and Node writes U+FFFD.

### The options

**(a) Keep replacing with U+FFFD.**
- Nothing to build.
- Costs:
  - **It makes up a character** that isn't in the text, silently: the repair that 2b turned down when reading.
  - **The writing side then disagrees with the reading side.** Read strictly and write with repair, and a round trip can change the text without anything saying so.

**(b) Refuse with a fault: `LoneSurrogateFault(position: Int)`, with `String.toWellFormed` as the repair.**
- **It applies to all six writers.** The check runs before any byte is written, so a refused `writeText` leaves the file exactly as it was. Python's leaves it empty, as measured above.
- **The message names the position** in Hexagon's 1-based codepoints, and the repair: "the text holds a lone surrogate at codepoint 12, which UTF-8 cannot write; repair it with `String.toWellFormed` first".
- **`String.toWellFormed(text)`** is new. It answers the text with each lone surrogate replaced by U+FFFD, and is JavaScript's own name for that (ES2024). A program that wants Node's old behaviour writes `File.writeText!(path, text.toWellFormed())`.
- **Why a fault, not an exception.**
  - Exceptions §1 gives "a number that does not fit" as a fault, and text that doesn't fit UTF-8 is the same kind of broken assumption.
  - It's the program's data that is wrong, not the world, so it isn't one of 2c's endings.
  - A fault leaves the colours alone: `Stdio` stays `->~`, and `File` stays `->!` only for its file failures.
  - It would be declared in `String`, beside `toWellFormed`. As a prelude fault, it joins the bare names by category (Modules §5.5), which needs no separate ruling.
- Costs:
  - **A check before each write.** It's free for text with no character above U+00FF: V8 stores such text one byte per character, and `isWellFormed` answered in 0.0 ms on 64 million characters. For other text it costs about as much as the write itself: 47 to 138 ms on 64 million characters, against 131 ms for writing them to `/dev/null`.
  - **One function added to `String`.**

**(c) Refuse in `File` with a tracked `FileError(NotUtf8, …)`, and with a fault in `Stdio`.**
- This reuses 2b's reason for the write side.
- Costs:
  - **Two channels for one cause.**
  - **`FileError`'s reasons are about the file, and this is about the text.**

### Doctrine fit

- **Way 5, "name it, don't repair it":**
  - (a) repairs silently.
  - (b) names the problem, and the repair is the program's own explicit call.
- **Decision 2b, and your view that a dev should think only in UTF-8.** (b) makes every byte Hexagon writes well-formed UTF-8 that is exactly the text it was given, or nothing is written.
- **The String spec.** It says string operations must "neither reject it nor replace it with U+FFFD". Writing isn't a string operation, and `toWellFormed` replaces only because the program asked it to.
- **Exceptions §1:** a fault is a broken assumption, as above.
- **HM:** untouched.

### What this leaves

- **The graduation PR,** which carries every I/O ruling.
- **stdin,** after v1. Reading it would follow 2b's strictness.

### What would revisit it

- **A need to write bytes or other encodings.** That would need a byte type, which v1 doesn't have.
- **A host that hands Hexagon a string type that can't hold a lone surrogate.** The check would then be unneeded.

### Recommendation

**(b).** The six writers refuse text that holds a lone surrogate, with `LoneSurrogateFault(position)`, before writing anything. `String.toWellFormed` is added as the explicit repair.

---

## Reading standard input in v1 (stdlib gaps, after item 7)

**Status:** ruled (a) by James on 2026-11-05: v1 reads all of stdin, in `Stdio`, and nothing else; line input stays stage 6. This was the write-up for that ruling, decision 1 of 4. It is the first of the stdin decisions the Program IO Plan leaves open (stage 5, "Read all stdin until EOF"), and `program-io.md` puts out of scope for now. The decisions that follow from it are listed at the end, each to get its own write-up.

**Up front:**
- **Doctrine:** reading input is impure (Effects §1), so every option here is at least `->~`. Effects §6.1 says `->~` never fails. So a `->~` reader has to end the program when the read fails, as the writers do (decision 2c). A reader whose failures a caller can plan for is `->!`. That choice is decision 3, under the failure-channel ruling (exception, fault or `Option`).
- **Colleague languages:** every general-purpose colleague with a console reads all of stdin in its standard library, except Swift, which reads lines. Gleam and Elm have no stdin at all, as they have no files.
- **HM:** nothing here touches inference. These are ordinary functions with written types.

### What exists today (measured on main, Node 24.18.0)

- **Hexagon has no stdin.** `program-io.md` lists "Reading standard input, whole or by line (Program IO Plan stages 5 and 6)" under Not in scope.
- **An Advent of Code program takes a path.** `File.readText!(Process.arguments~()[1])` compiles, and `node Day05.js input.txt` runs it. What doesn't work is `node Day05.js < input.txt`, or `cat input.txt | node Day05.js`.
- **Node reads all of descriptor 0 with `readFileSync(0)`.** Measured with a probe script:

  | stdin | What `readFileSync(0)` does |
  |---|---|
  | a file, `< input.txt` | the file's bytes; 100 MB in 0.08 s |
  | a pipe, `printf xyz \|` | the bytes; 100 MB in 0.54 s |
  | a slow writer, `(printf a; sleep 1; printf b) \|` | waits, and gets both |
  | a pipe from a Node parent, written half a second apart | waits, and gets both |
  | `< /dev/null`, or stdin closed with `<&-` | nothing, `""`: Node reopens a closed descriptor 0 on `/dev/null` |
  | a terminal | waits for Ctrl-D, and gets every line typed before it |
  | a directory, `< /` | throws `EISDIR` |
  | a non-blocking pipe whose writer is slow | throws `EAGAIN`, having read nothing |

- **The last row has a fix.** A loop of `readSync` that waits about a millisecond on `EAGAIN` gets every byte. That is the writers' wait (decision 2c), and in my measurement it waited 410 times over half a second. The loop also reads a 100 MB pipe in 0.19 s.
- **Where non-blocking stdin comes from.** It only happens when a parent sets `O_NONBLOCK` on a descriptor it shares. I set it with `fcntl` before starting Node to measure it. I haven't found a common shell setup that does it.
- **A second whole read gets `""`.** The input has been consumed, for a file and for a pipe alike.
- **Not measured:** Windows. CI installs the CLI there, but nothing reads stdin there yet.

### The question

What does v1 read from standard input?

### Colleague languages

| | All of stdin | One line | Bytes that aren't UTF-8 |
|---|---|---|---|
| OCaml | `In_channel.input_all stdin` (4.14) | `In_channel.input_line`, `None` at the end | not decoded: a `string` is bytes |
| Rust | `io::read_to_string(io::stdin())` | `stdin().read_line`, or `lines()` | an error with `ErrorKind::InvalidData` |
| Swift | none: `readLine()` in a loop | `readLine()`, `nil` at the end | replaced with U+FFFD |
| F# | `stdin.ReadToEnd()` | `stdin.ReadLine()`, `null` at the end | replaced with U+FFFD |
| Haskell | `getContents` (lazy) | `getLine`, which throws at the end | an exception |
| Kotlin | `System.in.bufferedReader().readText()` | `readln()`, or `readlnOrNull()` | replaced with U+FFFD |
| Python | `sys.stdin.read()` | `input()` | `UnicodeDecodeError` by default |
| Go | `io.ReadAll(os.Stdin)` | `bufio.Scanner` | not decoded: bytes |
| Gleam, Elm | none | none | |

What they agree on:
- **Whole input is the common case.** It is standard library everywhere except Swift, Gleam and Elm.
- **One line is as common,** but it belongs to interactive programs. Each colleague has to say how a blank line differs from the end of input (`Option`, `nil`, `null`, or an exception), and that is the Plan's stage 6.
- **Bad bytes split exactly as files do.** Rust, Haskell and Python refuse them, while Swift, F# and Kotlin replace them. Decision 2b put `File` on both sides: `readText` refuses them, and `readTextLossy` replaces them.

### The options

**(a) All of stdin, in `Stdio`, and nothing else.** One read that consumes the input to its end and answers it as text, with what decisions 2 to 4 settle.
- **What it gives:** `node Day05.js < input.txt`, and any pipeline into a program. With `Process.arguments`, a program can take its input either way.
- **Why `Stdio`:** it is standard input and output, as C's `stdio.h` and Haskell's `System.IO` are. A separate `Stdin` module would be one more import for one function.
- **Cost:** at a terminal, the read waits for Ctrl-D, because Enter submits a line but doesn't end the input. A user who runs the program and starts typing sees nothing until then. The Plan says as much ("primarily a file-redirection and pipeline facility"), and a program that asks questions waits for stage 6.
- **Implementation:** a `readSync` binding in the existing `extern from "node:fs"` block, the decoders `File` already has, and the writers' wait. The loop can be ordinary Hexagon over `readSync`, as the writers' loop is over `writeSync`. It needs a byte array to read into and a way to join the chunks, and whether those come from `node:buffer` or from a door key is for the spec to settle. I haven't built it.

**(b) All of stdin, and one line at a time.** As (a), plus a line read such as `readLine: () -> Option(String)`.
- **Cost:** stage 6's questions arrive now:
  - a blank line against the end of input;
  - `\r\n` against `\n`;
  - what a line read leaves for a later whole read.
- **Node has no synchronous line read,** so the module would read a chunk and keep the rest between calls. That is state the writers don't need, and the playground would have to model it too.
- **Advent of Code doesn't need it.** Every puzzle's input is a file, read whole and split with `lines()`.

**(c) No stdin in v1.** Programs take a path with `Process.arguments`, as they can today.
- **Cost:** `node Day05.js < input.txt` doesn't work. A pipeline can't feed a Hexagon program, and a user who knows the idiom from Python or Rust templates hits the gap first.
- **Saves:** decisions 2 to 4, and their implementation.

### Recommendation

**(a).** It is the one read every colleague with a console ships, and it is the gap's own row ("`node Day05.js < input.txt` works"). It reuses the decoders, the wait, and the `Stdio` module that v1 already has. Line input stays stage 6, so a blank line against the end of input is decided when an interactive program needs it, not before.

**What would revisit it:** a program that has to ask the user something, which brings in stage 6; Windows becoming a host that CI runs programs on, where descriptor 0 at a console behaves differently and isn't measured here.

### Decisions that follow (a), one write-up each

1. This one: scope.
2. **The text and the names.** Should stdin follow `File`'s text policy (strict UTF-8 with a lossy sibling, one leading BOM dropped), or be lossy only? And what are the names: `readText` and `readTextLossy` as in `File`, or the Plan's `readAllText`, which says it reads to the end?
3. **Failures and the arrow.** Should the read be `->~` and end the program on a failure, as the writers do, or `->!` with an exception a caller can catch? And where does text that isn't UTF-8 go? `EAGAIN` waits either way.
4. **The playground.** Is stdin empty there, as `< /dev/null` is, or does the playground get an input box beside the editor?

**Readings to confirm with the spec, not decisions:**
- a second read answers `""`, as Node does;
- stdin closed or `/dev/null` answers `""`;
- a directory on stdin is a failure under decision 3.

---

## Stdin's text and names (stdin decision 2 of 4)

**Status:** ruled (a) by James on 2026-11-05: `Stdio.readText()` is strict and `Stdio.readTextLossy()` replaces bad bytes, each dropping one leading BOM, as `File`'s pair does. This was the write-up for that ruling. Decision 1 is ruled (a): v1 reads all of stdin, in `Stdio`, and nothing else (`STDIN-V1.md`). This decision settles what that read does with the bytes and what it is called. How a refused read fails is decision 3.

**Up front:**
- **Doctrine:** your text view decides most of this: "the Hexagon user should only think about UTF-8, no BOM, no other encodings". Decision 2b applied it to files: a strict `readText`, and a `readTextLossy` a program asks for by name. One policy for all text input keeps the library to one rule.
- **Colleague languages:** every colleague below reads stdin with the same decoder it uses for files, and most give the two reads the same verb.
- **HM:** nothing here touches inference.

### What exists today (measured on main, Node 24.18.0)

- **`File`'s text policy** (decision 2b, `program-io.md` §3):
  - `readText` refuses bytes that aren't UTF-8 with `FileError(NotUtf8, …)`, whose message names the first bad byte;
  - `readTextLossy` replaces each bad sequence with U+FFFD;
  - both drop one leading BOM.

  The two decoders are door keys `File` declares. `Stdio` can declare the same keys, and the two rows bind one lowering, as `File` and `Stdio` already share `stringIsWellFormed`.
- **On Linux, `File.readText!("/dev/stdin")` reads stdin today, with that policy.** I built a program with `hexc` and ran it:
  - from a pipe, `one\ntwo` gave two lines;
  - a leading BOM was dropped;
  - `a\xffb` ended the program with `Error [FileError]: not UTF-8 at byte 2: /dev/stdin` and status 1;
  - a non-blocking pipe with a slow writer worked, because opening the path makes a fresh descriptor.

  It isn't an idiom to teach. Windows has no `/dev/stdin`, and nothing documents it.
- **The Plan's name** is `readAllText`, chosen "making the whole-input behaviour explicit".

### The question

Which text policy does stdin's read follow, and what is each function called?

### Colleague languages

| | All of stdin | A whole file | Bytes that aren't UTF-8 |
|---|---|---|---|
| Rust | `io::read_to_string(stdin())` | `fs::read_to_string(path)` | refused, both |
| Kotlin | `System.in.bufferedReader().readText()` | `File(path).readText()` | replaced, both |
| F# | `stdin.ReadToEnd()` | `File.ReadAllText(path)` | replaced, both |
| Haskell | `getContents` | `readFile path` | an exception, both |
| Python | `sys.stdin.read()` | `open(path).read()` | `UnicodeDecodeError` by default, both |
| OCaml | `In_channel.input_all stdin` | `In_channel.input_all` on the file's channel | bytes, both |
| Go | `io.ReadAll(os.Stdin)` | `os.ReadFile(path)` | bytes, both |

What they agree on:
- **One policy:** none of them decodes stdin differently from a file.
- **One verb, mostly:** Rust, Kotlin, OCaml and Go give the two reads the same name, or the same function. .NET is the exception, with `ReadToEnd` beside `ReadAllText`.
- **Kotlin's pair is the nearest fit:** `readText()` reads to the end, `readLine()` reads one line, and the same names serve files and streams. Stage 6 would add the second.

### The options

**(a) `File`'s policy and `File`'s names.** `Stdio.readText()` refuses bytes that aren't UTF-8, and `Stdio.readTextLossy()` replaces them. Each drops one leading BOM.
- **What it gives:** one rule across all of Hexagon's text input, and one name for "the whole text" in both modules. A program moving from `File.readText!(path)` to stdin changes the module and drops the argument.
- **Cost:** two functions, as `File` has. `readText` doesn't say it reads to the end, so at a terminal it waits for Ctrl-D. Its doc says so, as Plan §5 asks.

**(b) `File`'s policy, with the Plan's names.** `readAllText()` and `readAllTextLossy()`.
- **What it gives:** the name says it reads until the input ends, which matters at a terminal.
- **Cost:** two spellings of "the whole text", `File.readText` beside `Stdio.readAllText`, for one meaning. That is .NET's split, and the longer name is paid at every call site.

**(c) Lossy only.** One function, `Stdio.readText()`, that replaces bad bytes. This is Swift's, F#'s and Kotlin's choice for stdin.
- **What it gives:** one function, and a read that never refuses on bytes.
- **Cost:** the same input refuses when read by path and is silently repaired when piped in. That contradicts decision 2b, where you made strict the default and lossy something a program asks for by name. A stray byte in a puzzle's input would show as U+FFFD with no word about it.

**(d) Strict only.** One function, `Stdio.readText()`, that refuses.
- **Cost:** a program that wants to cope with stray bytes can't, except by reading `/dev/stdin` as a path on Linux. `File` gives both reads, and stdin would give half.

### Recommendation

**(a).** Decision 2b already chose the policy for text input. Stdin applying it differently would be a second rule for one kind of thing, which no colleague does. The names follow from the same reasoning: one meaning, one name, as Rust, Kotlin, OCaml and Go have it. With stage 6's `readLine` later, `Stdio` would read the way Kotlin's streams do.

**What would revisit it:**
- a byte API, which v1 doesn't have;
- encodings other than UTF-8, which your text view leaves out;
- a Windows console. I haven't measured what Node hands a program reading one.

**Readings to confirm with the spec:**
- only a BOM at the very start of the input is dropped, as with `File`;
- `readTextLossy`'s output is always well-formed, as `File.readTextLossy`'s is.

---

## When reading stdin fails (stdin decision 3 of 4)

**Status:** ruled (a) by James on 2026-11-05: both reads are `->~`, and a failure ends the program with one line on stderr and status 1, as the writers' failures do. This was the write-up for that ruling. Decisions 1 and 2 are ruled (a): v1 reads all of stdin in `Stdio`, as `Stdio.readText()`, which refuses bytes that aren't UTF-8, and `Stdio.readTextLossy()`, which replaces them (`STDIN-V1.md`, `STDIN-V1-D2.md`). This decision settles what each read does when it can't answer, and so its arrow.

**Up front:**
- **Doctrine:** the failure-channel ruling gives an exception to failures a caller plans for, a fault to a programmer's mistake, and `Option` to something that isn't there. Decision 2c added a fourth for output: some failures end the program, quietly or with one line, and no `catch` sees them. Effects §6.1 says `->~` never fails, so a `->~` read must end the program when it can't answer.
- **Colleague languages:** all of them let the caller see a failed read, as a `Result` or an exception. None ends the program itself. An Advent of Code program usually ends anyway, with Rust's `.unwrap()` or an uncaught exception.
- **HM:** nothing here touches inference.

### What can go wrong (measured on Node 24.18.0, unless marked)

- **Bytes that aren't UTF-8,** for `readText` only. The input is a file or a pipe the user chose.
- **A directory on stdin,** `< /`. Node's read throws `EISDIR: illegal operation on a directory, read`.
- **Input too long for a string,** past about 512 MB. Both decoders throw `ERR_STRING_TOO_LONG`, as they do for `File`.
- **Anything else the system reports,** such as `EIO` from a terminal that has gone away. I haven't produced one.
- **Not failures:**
  - `EAGAIN`, which waits (decision 1's measurement);
  - an empty or closed stdin, which answers `""`;
  - on Windows, possibly an `EOF` error from a console. It isn't measured, and would be the end of the input.
- **The input is gone once read.** Whatever the read decides, a second read answers `""`. So after `readText` has refused, a program can't read the same input lossily, as it can with a file.
- **An uncaught exception today** prints a stack trace. Measured with `File.readText!("/dev/stdin")` on `a\xffb`: 20 lines on stderr, including `Error [FileError]: not UTF-8 at byte 2: /dev/stdin`, then status 1.

### The question

When `readText` or `readTextLossy` can't answer, does the program end, or does the caller get an exception it can catch?

### Colleague languages

| | A failed read of stdin | Bytes that aren't UTF-8 |
|---|---|---|
| Rust | `Err(io::Error)` | `Err` with `ErrorKind::InvalidData` |
| Haskell | throws an `IOException` | throws |
| Python | raises `OSError` | raises `UnicodeDecodeError` |
| Go | returns an `error` | bytes, no decoding |
| OCaml | raises `Sys_error` | bytes, no decoding |
| F#, Kotlin | throw an `IOException` | replaced |
| Swift | `readLine()` answers `nil` | replaced |

What they agree on:
- **The caller sees the failure.** Every colleague hands it back. Decision 2c chose to differ for output: ending is what Unix programs do, and a write's failure isn't the program's to fix.
- **What callers do with it** is mostly stop: `.unwrap()`, `expect`, or no handler at all.

### The options

**(a) Both reads are `->~`. A failure ends the program, as the writers' failures do.** One line on stderr and status 1:
- `cannot read standard input: not UTF-8 at byte 2`, counted from 1 as `File`'s is;
- `cannot read standard input: illegal operation on a directory`, which is Node's description without its code, as the writers word theirs.

A call is `Stdio.readText~()`.
- **What it gives:**
  - `Stdio` is `->~` throughout, with one kind of failure: one line and status 1.
  - A program that wants to cope with stray bytes asks for that before reading, by calling `readTextLossy`. Afterwards there is nothing to recover, because the input is gone.
  - A puzzle program's first line stays `let input = Stdio.readText~()`.
- **Cost:**
  - A program can't put its own message or status on a failed read. A tool that wants "expected UTF-8 puzzle input" and status 2 can't have them.
  - It differs from every colleague, as 2c did for output.

**(b) Both reads are `->!`, and a failure throws a tracked exception.** That could be `File.FileError` with a stand-in path such as `"standard input"`, or a new `StdinError(reason, message)` in `Stdio`.
- **What it gives:**
  - The colleagues' answer.
  - A program can catch the failure, say what it likes, and set its own status.
  - Uncaught, it ends the program with status 1, as today's measurement shows.
- **Cost:**
  - Every call carries a mark promising a recovery that mostly isn't there: the input is consumed, so a `catch` can't retry, and can't read lossily.
  - `FileError` would put a path that isn't one in a field a program reads. A new exception is one more type and one more set of reasons to keep.
  - Uncaught, the user sees a stack trace instead of one line.

**(c) Mixed: bytes that aren't UTF-8 throw a tracked exception, and every other failure ends the program.** `readText` is `->!`, and `readTextLossy`, which can't meet bad bytes, is `->~`.
- **What it gives:** a catch for the one failure that comes from the data rather than the system.
- **Cost:**
  - `Stdio` has both channels, and its two reads have different arrows.
  - The catch still can't recover the input. To make it worth catching, the exception would have to carry the text. Rust's `FromUtf8Error` hands back its bytes, which is the precedent, but v1 has no byte type, so it would have to carry the lossy text. That makes it a third read hidden in an exception.

### Recommendation

**(a).** For stdin, an exception would mark every call with a plan the program can't carry out. The input is read once, so the only response left after a refusal is to stop. That is what (a) does, with a line the user can read, not a stack trace. The one useful choice, keeping stray bytes, comes before the read, and `readTextLossy` already offers it.

(a) also keeps `Stdio` to the single rule 2c gave it: a standard stream that can't be used ends the program. And it matches what an Advent of Code program usually does in every colleague anyway.

**What would revisit it:**
- Stage 6's line input. An interactive program could ask again after a bad line, so a line read might want a catchable failure.
- A program that needs its own status for a bad input. It can read lossily and check for U+FFFD itself, and if that proves common, the status of the ending is what to revisit.

**Readings to confirm with the spec:**
- the failure line's wording isn't normative, as the writers' isn't (`program-io.md` §4.3);
- the line's write to stderr may itself fail, and the status is 1 all the same;
- a failure after some bytes were read leaves nothing for a later read to answer, which is `""`.

---

## Stdin in the playground (stdin decision 4 of 4)

**Status:** ruled (b) by James on 2026-11-05, "keep the input box small, though (in visual size)": an input box whose text is the program's stdin, as with `< input.txt`, kept small on the page. This was the write-up for that ruling. Decisions 1 to 3 are ruled (a): v1 reads all of stdin in `Stdio`, as `Stdio.readText()` and `Stdio.readTextLossy()`, and both are `->~`, so a failed read ends the program with one line and status 1 (`STDIN-V1.md`, `STDIN-V1-D2.md`, `STDIN-V1-D3.md`). This decision settles what the two reads answer in the playground, which runs programs in the browser.

**Up front:**
- **Doctrine:** decision 5b gave the playground one rule: every answer it gives is one Node gives in some real situation, so a program never behaves there in a way it couldn't under Node. All three options below keep that rule, because each matches a real way of running a program: `< /dev/null`, `< input.txt`, or a terminal. 5b's rejected alternatives are binding, so stopping or refusing a program that reads stdin isn't an option (`program-io.md` §11.11).
- **Colleague playgrounds:** most give a program no input. Try It Online and Compiler Explorer take input before the run. The Rust Playground has taken it while the program runs since 2023. All three run programs on a server, where Hexagon's playground runs them in the browser.
- **HM:** nothing here touches inference, or the language.

### What exists today (measured on main, Chromium 153)

- **The playground stands in for `node:fs` and `node:process`** (`playground/src/host-modules.ts`). Its `node:fs` has `readFileSync`, `writeFileSync` and `writeSync`. The stdin read will call `readSync`, so under every option the stand-in gains one. Without it, any program importing `Stdio` would fail to link, writers included.
- **§6 says the playground runs a program "as a terminal would run it with no arguments".** At a real terminal, reading all of stdin waits for Ctrl-D. So §6 needs a sentence on stdin whichever option is chosen.
- **The playground has no way to take data in.** `File.readText!` always answers `NotFound`. Today the only way to get a puzzle's input into a playground program is to paste it into a string literal. Hexagon's strings can span lines, but `"`, `\` and `${` in the input need escaping, and the program is then a different one from the program that runs under Node.
- **Sharing and storage:** a shared link carries the source in its fragment (`#code=…`), and the browser keeps the source between visits.
- **A text box in the browser** (a `<textarea>`, measured):
  - it turns `\r\n` and a lone `\r` into `\n`;
  - text typed into it arrives with U+FFFD already in place of a lone surrogate, though a script can set one;
  - a 29 KB puzzle-shaped input in a shared link made a 37 KB link, which Chromium opened and read back whole. A 1.5 MB link also worked, and a 3 MB link failed to open, as Chromium's 2 MB limit on a URL predicts.
- **Waiting for input during a run.** The program runs in a worker, and a read must answer before the call returns. For the worker to wait while the page collects typing, it needs `SharedArrayBuffer` and `Atomics.wait`. In Chromium these are missing from both the page and its worker unless the page is served with the cross-origin isolation headers (COOP and COEP); with the headers, both have them. The playground deploys to GitHub Pages (`actions/deploy-pages`), which doesn't let a site set its own headers.

### The question

What does a program that reads stdin get in the playground?

### Colleague playgrounds

| | Runs on | Standard input |
|---|---|---|
| Go Playground | a server | none: "The only communication a playground program has to the outside world is by writing to standard output and standard error." |
| Kotlin Playground | a server | none: `readLine()` answers `null`, per a 2020 forum thread. Program arguments can be set in its settings |
| TypeScript Playground | the browser | none: there is no `process` (5b's measurement) |
| OCaml Playground, SwiftFiddle | | no input field on the page |
| Try It Online | a server | Input and Arguments boxes, filled before the run; "a client-side permalink that encodes code and input directly in the URL" |
| Compiler Explorer | a server | `stdin` and `args` sent with the run (its API's `executeParameters`) |
| Rust Playground | a server, over a WebSocket | while the program runs, since PR #995 (2023): a field whose Enter sends one line, and a "Close stdin" button that ends the input. Its issue #22, asking for input given before the run, has been open since 2016 |

What they agree on:
- **No input is the common answer,** and it is the answer of the one colleague that runs in the browser.
- **Where there is input, it comes either before the run or during it.** Before the run is the simpler choice, and it is what a puzzle program needs. During the run is what an interactive program needs, which is stage 6.

### The options

**(a) Stdin is empty, as it is with `< /dev/null`.** Both reads answer `""`.
- **What it gives:**
  - the smallest change, a stand-in `readSync` that answers 0;
  - nothing for the page to show or keep.
- **Cost:**
  - A program that reads its input runs on nothing, and nothing says why, unless the output pane adds a note.
  - A puzzle program can't be run in the playground as written, only rewritten with its input in a literal.
- **Later:** adding (b) breaks nothing, because an empty box is (a).

**(b) An input box: its text is the program's stdin, as with `< input.txt`.** Each run reads the box's text from the start, and an empty box gives `""`, as (a) does.
- **What it gives:**
  - `let input = Stdio.readText~()` runs unchanged in the playground and under Node. Paste a puzzle's input into the box, then press Run.
  - It is Try It Online's model, and Compiler Explorer's.
  - The read still answers at once. The run carries the box's text, and the stand-in answers from it, so no headers or waiting are involved.
- **Cost:**
  - the box and its place on the page;
  - keeping its text in browser storage beside the source, and carrying it in a shared link when it isn't empty, as Try It Online's permalink does;
  - tests for each of those.
  - The page grows a control that only programs reading stdin use.

**(c) Interactive: the run waits at the read while the user types, as the Rust Playground does.** A button ends the input, as Ctrl-D does at a terminal.
- **What it gives:** the closest match to a terminal, and the start of what stage 6 needs.
- **Cost:**
  - **The worker can't wait without cross-origin isolation.** That means a different host, or a service worker that adds the headers to every response, which is a known workaround.
  - **Stage 6 arrives early.** A whole read only answers once the end-of-input button is pressed, so the field mostly serves line input, which decision 1 left for stage 6.
  - **A run can now hang,** waiting for a button, and the pane needs a way to show that and to stop it.

### Recommendation

**(b).** The point of v1's stdin is that `node Day05.js < input.txt` works. The playground is where someone tries Hexagon before installing anything, and (b) lets the same program take the same input there, with no edits. The box is the one way the playground can take data in, because files always answer `NotFound`. It needs no new browser machinery, since the text is known before the run starts.

(a) is the answer if the playground should stay as small as it is. It loses nothing for good, because (b) can be added later without changing any answer (a) gives. (c) solves stage 6's problem before stage 6, at the cost of a hosting change.

**What would revisit it:**
- Stage 6's line input, which would want (c) and so cross-origin isolation.
- A way to give the playground files, which 5b noted as a later feature. An arguments box would come with it, since an argument in the playground can only name a file that isn't there.

**Readings to confirm with the spec (under (b)):**
- every run starts from the box's whole text, as a new process reads a fresh file, and a second read in the run answers `""`;
- the box's line breaks reach the program as `\n`, because the browser turns `\r\n` into `\n`;
- the stand-in encodes the box's text as UTF-8, so `readText` never refuses in the playground;
- `Process.arguments~()` stays empty, and there is no arguments box.
