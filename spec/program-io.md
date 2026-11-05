# Stdlib listing: program I/O (`File`, `Stdio`, `Process`)

**Status:** Decided 2026-11-04, ruled by James in five decisions (`notes/program-io-deliberation.md` is the deliberation record). Spec-only; implementation #1461. This document replaces the experimental contracts for `Hex.Experimental.File` and `Hex.Experimental.Stdio`, and discharges the program I/O row of `stdlib-roadmap.md` §2 for v1. Its companion edits are:
- `string-text-processing.md` §1 and the new §13, where `String.toWellFormed` and `LoneSurrogateFault` are declared (§7), and §10, where BOM handling at text input names `File.readText` and `File.readTextLossy`;
- Modules §5.5 and Exceptions §8.5, where `LoneSurrogateFault` joins the prelude's faults;
- `stdlib-roadmap.md` §2's program I/O row;
- `notes/program-io-plan.md`, whose stages 1 to 4 this document settles;
- `compiler/architecture/environment.md` §7 and `javascript-target.md` §5, §6 and §11, where Node is the one supported host.

**Home:** three modules outside the prelude, `stdlib/File.hex`, `stdlib/Stdio.hex` and `stdlib/Process.hex`, declared `module File`, `module Stdio` and `module Process`. A program reaches them as it reaches `Regex` and `Rat`, by `import File`, `import Stdio` and `import Process` (Packages §2.4).

**Not in scope:**
- Reading standard input, whole or by line (Program IO Plan stages 5 and 6).
- Paths and their operations (stage 7), directories, and file metadata.
- Bytes, and encodings other than UTF-8. v1 has no byte type.
- Asynchronous I/O, streams and subprocesses.
- Ending the program at once with a status (§5.2), and option parsing over the arguments.

**Companions:**
- Effects §1 (reading input is impure), §6.1 (`->~` never fails) and §6.2 (`Debug.log`, species (a)).
- Exceptions §1 (exception or fault), §7 (branded representation) and §8.5 (the prelude's throwables).
- Modules §5.5 (the prelude) and Packages §2.4 (the rest of `Hex`).
- `string-text-processing.md` §1 (a lone surrogate is one codepoint), §10 (BOM handling) and §13 (`toWellFormed`, `LoneSurrogateFault`).
- FFI Part 11 §5 (`JsConversionError`, whose shape `FileError` shares).

---

## 1. Doctrine

- **The programmer thinks only in UTF-8.** Text read from a file is well-formed UTF-8, or the read is refused, unless the function's name says it repairs. Text Hexagon writes is UTF-8 with no byte-order mark, unless the function's name says it writes one. The arguments arrive as Node has already decoded them (§5.1).
- **Name it, don't repair it.** A file that isn't UTF-8 is refused, with the reason named, rather than read with made-up characters. A repairing read exists, and its name says what it does (`readTextLossy`).
- **The fail colour means "plan for this"** (Exceptions §1). A missing file is a failure a caller plans for, so the file operations are `->!` and throw the tracked `FileError`. Nobody plans for their own output failing: when the reader has gone the output is no longer wanted, and when the disk is full the only place left to say so is stderr. So the `Stdio` writers end the program instead, and are `->~`.
- **Node is the one host.** The three modules call `node:fs` and `node:process` themselves, with no adapter layer. A program that imports none of them stays a portable ES module.
- **They are outside the prelude.** The prelude is what every program sees on every host, and these modules work only under Node and in the playground (§6). An import line states, in the program's text, that the program needs files or a command line.

## 2. The surface

```hexagon
module File

export union FileErrorReason =
    | NotFound
    | PermissionDenied
    | IsDirectory
    | NotDirectory
    | NotUtf8
    | Other(code: String)

export exception FileError(reason: FileErrorReason, path: String, message: String)

export let readText(path: String): String                  // ->!
export let readTextLossy(path: String): String             // ->!
export let writeText(path: String, text: String): Unit     // ->!
export let writeTextBom(path: String, text: String): Unit  // ->!
```

```hexagon
module Stdio

export let write(text: String): Unit           // ->~
export let writeLine(text: String): Unit       // ->~
export let writeError(text: String): Unit      // ->~
export let writeErrorLine(text: String): Unit  // ->~
```

```hexagon
module Process

export fault ExitStatusFault(status: Int)

export let arguments(): Vector(String)          // ->~
export let setExitStatus(status: Int): Unit     // ->~
```

The colours in the comments are the inferred ones; each body's foreign calls carry them. A typical program:

```hexagon
module Main

import File
import Stdio
import Process

let input = File.readText!(Process.arguments~()[1])
Stdio.writeLine~("${solve(input)}")
```

- **Constructors are spelled through the module,** as `File.NotFound`, since `File` is outside the prelude. The union's own name is written only in a type annotation.
- **The exception is `FileError`, not `File.Error`.** An exception named `Error` prints like a JavaScript error when uncaught, and `show` would print `Error: …` too. `RegexError` and `JsConversionError` carry their subject in the same way.
- **`setExitStatus` and `ExitStatusFault`** are §5.2's.

## 3. `File`

### 3.1 Reading

- **`readText(path)`** reads the whole file synchronously and decodes it as UTF-8, strictly.
  - A file that isn't well-formed UTF-8 throws `FileError(NotUtf8, path, message)` (§3.4).
  - Exactly one leading U+FEFF is dropped. An empty file and a file holding only a BOM both read as `""`. Two leading BOMs leave one, and a U+FEFF anywhere else stays.
  - Everything else is kept as it is: CRLF, CR, LF, NUL, and a missing final newline. There is no newline normalization, Unicode normalization or trimming.
  - UTF-16 and UTF-32 are not detected. Such a file is refused as `NotUtf8`, unless its bytes happen to be well-formed UTF-8.
- **`readTextLossy(path)`** reads as `readText` does, except that it never refuses for the text: each ill-formed sequence becomes U+FFFD, as the WHATWG decoder replaces it (`TextDecoder` without `fatal`). It drops one leading BOM, as `readText` does.
- **A read is not a byte round trip.** It drops the BOM, and `readTextLossy` can lose bytes.

### 3.2 Writing

- **`writeText(path, text)`** writes `text` as UTF-8, creating the file or truncating and overwriting it. It adds no BOM and no newline. A U+FEFF that `text` holds is written like any other character.
- **`writeTextBom(path, text)`** writes one U+FEFF, then `text` exactly as `writeText` would. So `writeTextBom` followed by `readText` gives back `text`. It is for readers that want a BOM, such as a CSV file meant for Excel.
- **Neither creates a missing parent directory.** That is `FileError(NotFound, …)`.
- **Neither is atomic or durable.** A failed write may already have changed the file, and success does not promise the bytes have reached the disk.
- **Text holding a lone surrogate is refused** before anything is written, so the file is left as it was (§7).

### 3.3 Paths

A path is handed to Node unchanged. A relative path is resolved against the working directory. There is no `~` expansion, URL parsing or normalization. Symbolic links are followed as Node follows them.

### 3.4 `FileError`

Every failure a `File` operation meets in the file system, or in a file's bytes, throws `FileError(reason, path, message)`. No other exception, and no `JsError`, leaves the module. The one fault a `File` operation throws is §7's.

- **The reason** comes from Node's error code:

  | Node's code | `reason` |
  |---|---|
  | `ENOENT` | `NotFound` |
  | `EACCES`, `EPERM` | `PermissionDenied` |
  | `EISDIR` | `IsDirectory` |
  | `ENOTDIR` | `NotDirectory` |
  | `ERR_ENCODING_INVALID_ENCODED_DATA`, from `readText`'s strict decoding: the bytes aren't well-formed UTF-8 | `NotUtf8` |
  | anything else, such as `ENAMETOOLONG`, `ENOSPC`, `EROFS` or `ERR_INVALID_ARG_VALUE` | `Other(code)`, with Node's code |

- **The path** is the one the caller passed, so it is there even where Node's error leaves it out, as when a directory is read.
- **The message** is one line for a reader. It names the path, and for `NotUtf8` the first bad byte. Its wording is not normative, as `JsConversionError`'s isn't (FFI Part 11 §5.1): a program reads `reason` and `path`, never the text. The implementation words it this way:

  | `reason` | `message` |
  |---|---|
  | `NotFound` | `not found: input.txt` |
  | `PermissionDenied` | `permission denied: input.txt` |
  | `IsDirectory` | `is a directory: input.txt` |
  | `NotDirectory` | `not a directory: input.txt` |
  | `NotUtf8` | `not UTF-8 at byte 1234: input.txt` |
  | `Other(code)` | Node's own message, such as `ENAMETOOLONG: name too long, open '…'` |

  The bad byte is the first one that is not part of the file's longest well-formed prefix. It is counted from 1 at the file's first byte, BOM included, as Hexagon counts positions in a `String`. Finding it takes a second scan of the bytes, made only after a read has failed.
- **A program that plans for a missing file** names the reason in a catch arm:

  ```hexagon
  let config = try File.readText!("config.txt") catch
      File.FileError(File.NotFound, _, _) => ""
  ```

- **Uncaught,** a `FileError` ends the program as any uncaught exception does. Node prints it as `Error [FileError]: not found: input.txt`, and the status is 1.
- **The set of reasons is closed.** A `match` that lists all six is exhaustive. Adding a reason, or moving a code out of `Other`, is a breaking change and needs a ruling.

## 4. `Stdio`

### 4.1 Text and newlines

- **The output is UTF-8.** `write` and `writeError` add nothing to the text. `writeLine` and `writeErrorLine` add exactly one LF, U+000A, on every platform, even when the text already ends with a newline.
- **Nothing else changes:** CRLF, CR, LF, NUL and U+FEFF in the text are written as they are. No BOM is added.
- **`writeLine~("")` writes one LF,** and `write~("")` writes nothing. There is no blank-line operation.
- **The writers take a `String`.** A program formats other values with interpolation or `show`.

### 4.2 Where the text goes, and when a write is done

- **`write` and `writeLine` write to the process's stdout, descriptor 1. `writeError` and `writeErrorLine` write to stderr, descriptor 2.** The module never opens, closes or rewinds them, and every call writes after the one before.
- **A write is synchronous.** It returns once all of the text's bytes have been handed to the descriptor, which may take more than one system write. It does not promise that a reader has consumed them or a terminal shown them.
- **Nothing orders stdout against stderr,** and nothing keeps a line whole against another process writing to the same descriptor.
- **The writers don't go through `console.log` or `process.stdout.write`.** Node makes those asynchronous on some descriptors, pipes among them on Linux and macOS.

### 4.3 When a write can't finish

When a write fails, the writer ends the program. No `catch` sees the ending, just as none sees Ctrl-C, and so the writers are `->~` (Effects §6.1). (Text a writer can't encode is a fault, raised before anything is written, §7.)

- **The descriptor would block (`EAGAIN`).** This is not a failure. Node switches a piped stdout to non-blocking once anything has gone through `console.log`, which `Debug.log` does. A write to a slow reader then finds the pipe full. The writer waits about a millisecond and writes the rest, and keeps on until all of it is written.
- **The reader has gone (`EPIPE`).** The program ends at once, quietly, with status 141, which is 128 plus SIGPIPE's number, 13. Nothing is printed. This is the status a shell reports for `yes | head -1`, and for a C or Go program in the same place. Node ignores SIGPIPE, so the program exits with the number rather than by the signal: a shell sees the same `$?`, and a parent that reads the raw wait status sees an exit.
- **Any other failure,** such as a full disk (`ENOSPC`). The program ends at once with status 1, after one line on stderr:

  ```text
  cannot write to standard output: no space left on device
  ```

  The line names the stream, `standard output` or `standard error`, and then the system's description of the error, as Node gives it without its code. Its wording is not normative, as `FileError`'s message isn't (§3.4). When stderr is the stream that failed, the line still goes to stderr, and the status is 1 even if that write fails too.
- **What this costs:**
  - A program that has to keep running when its output fails, such as a long-running service, can't do that with these writers. A `->!` writer beside them could come later without breaking anything.
  - Under `set -o pipefail`, `program | head -1` fails the pipeline, as `yes | head -1` does.
  - An exported Hexagon function that writes with `Stdio`, called from a JavaScript application, ends that application when its reader leaves, as a C library's print would.

### 4.4 `Debug.log`

`Debug.log` keeps its name, its `Show` input and its pure face. It is a probe, Effects §6.2's species (a), and its lines' number and order follow evaluation (§6.2). `Stdio` is a program's real output, with no unmarked form.

## 5. `Process`

### 5.1 `arguments`

- **`arguments~()` answers the arguments the user passed to the program,** and nothing before them: not Node's executable, its options, or the script's path.
  - These are the arguments Node's `util.parseArgs` takes by default: `process.argv` from its third element, or from its second when Node ran code given on its command line (`-e`, `-p`, and every other spelling of those options, such as `--eval=…` and `-pe`) and there is no script.
  - So `node main.js input.txt` answers `["input.txt"]`, and `Process.arguments~()[1]` is `"input.txt"`.
- **It is `->~`.** Reading the arguments is reading input, which is impure (Effects §1), and it cannot fail. It reads `process.argv` each time it is called.
- **The text is what Node gives.** Node decodes the arguments as UTF-8 before a program sees them, so an argument whose bytes aren't UTF-8 arrives with U+FFFD in place of each bad sequence. No Hexagon program can see the original bytes. Nothing strips a BOM.

### 5.2 `setExitStatus`

- **`setExitStatus~(status)` sets the status the program reports when it finishes.** It doesn't end the program. The last setting wins, and a program that never sets one finishes with 0.
- **The status is 0 to 255.** Anything else throws `ExitStatusFault(status)`, since Node would wrap it: 256 would report success, and -1 would report 255.
- **Other endings win.** An uncaught exception or fault still ends the program with 1. §4.3's endings still give 141 and 1.
- **There is no "end now" in v1.** A program that has to stop from deep inside returns to its top first, or lets an exception go uncaught.
- **The lowering sets `process.exitCode`,** as Node's documentation recommends: "Rather than calling `process.exit()` directly, the code *should* set the `process.exitCode` and allow the process to exit naturally".

## 6. The playground

The playground runs programs in the browser, where Node isn't there. It runs a program that imports these modules as a terminal would run it with no arguments, in an empty directory on a read-only file system. Its answers are the ones Node gives there for a path naming a file in that directory.

- **`Stdio.write` and `writeLine`** go to the output pane, in order with `Debug.log`'s lines. **`writeError` and `writeErrorLine`** go to the same pane, marked as errors.
- **`Process.arguments~()`** answers an empty `Vector`.
- **`Process.setExitStatus~(n)`** shows at the end of the run as `exit status n`, when `n` isn't 0. An uncaught exception or fault shows as the playground shows any uncaught throw.
- **`File.readText!` and `File.readTextLossy!`** throw `FileError(NotFound, path, …)`. **`File.writeText!` and `File.writeTextBom!`** throw `FileError(Other("EROFS"), path, …)`, Node's code for a read-only file system, with Node's message for it. They answer so for every path, where Node would answer some paths differently, such as one naming the directory itself (`IsDirectory`), or a write through a directory that isn't there (`NotFound`).
- **How:** the playground links its own small `node:fs` and `node:process` beneath the three modules. The modules themselves are the same in the browser as under Node. A test runs the same programs in both and compares what they print (§10, test 11).
- **Nothing else changes for the browser.** A web page outside the playground that imports these modules fails to load, since nothing there stands in for Node.

## 7. Text holding a lone surrogate

A `String` holds a lone surrogate only when foreign code supplies one: the lexer refuses one in source, and `String.fromCodepoint` never makes one (`string-text-processing.md` §1, §9). Every string operation keeps it intact. UTF-8 has no encoding for it.

- **The six writers refuse such text,** `writeText`, `writeTextBom` and the four `Stdio` writers alike. They throw `LoneSurrogateFault(message, position)`, where `position` is the 1-based codepoint position of the first lone surrogate in the text the call was given.
- **The check comes before anything is written.** A refused `writeText` leaves the file exactly as it was, neither created nor truncated. A refused `Stdio` write writes no byte of its text, and no LF.
- **It is a fault, not an exception** (Exceptions §1). The program's own data is wrong, not the world. So the colours don't change: the `File` writers stay `->!` for their file failures only, and the `Stdio` writers stay `->~`.
- **The message names the position and the repair,** such as `the text holds a lone surrogate at codepoint 12, which UTF-8 cannot write; repair it with String.toWellFormed first`. Its wording is not normative, as `FileError`'s isn't (§3.4).
- **The repair is the program's own call,** `String.toWellFormed(text)` (`string-text-processing.md` §13). It answers the text with each lone surrogate replaced by U+FFFD. A program that wants the replacement Node would have made writes `File.writeText!(path, text.toWellFormed())`.
- **The fault is declared in `String`,** beside `toWellFormed`. As a prelude fault, it is bare by category (Modules §5.5): a program catches `LoneSurrogateFault(_, position)` with no import.
- **The playground refuses the same text,** since the modules are the same there.

So the six writers write only well-formed UTF-8, and text they can't encode writes nothing.

## 8. Hosts and emission

- **Node is the one supported host,** at the versions the CLI supports. Bun and Deno are not claimed.
- **The modules call `node:fs` and `node:process` themselves.** There is no adapter module and no host-neutral layer beneath them.
- **A program that imports none of the three emits no import of `node:fs` or `node:process`,** and stays a plain ES module.
- **A browser** is not a host for these modules, apart from the playground (§6).

## 9. Implementation requirements

- **The three modules,** with a `(** *)` doc on every export, purpose first. Each export's body carries its colour; the `node:fs` and `node:process` bindings are private.
- **`FileError`'s reason** comes from the thrown error's `code`, through one guarded read beside the one `JsError.message` makes.
- **The strict read** decodes with `TextDecoder("utf-8", { fatal: true })`, which drops exactly one leading BOM. The lossy read decodes without `fatal`.
- **The `Stdio` writer** writes with `writeSync`, carries on after a partial write, waits and retries on `EAGAIN`, and ends the program on any other error as §4.3 says. It catches every throw, which keeps `->~` true.
- **`arguments`** finds where the user's arguments start as `util.parseArgs` does, from whether Node ran code given on its command line. Checking `process.execArgv` for the four long and short spellings is not enough: Node 24.18.0 records `--eval=…` and `-pe` as written.
- **`setExitStatus`** checks the range, then sets `process.exitCode`.
- **The playground's stand-ins** for `node:fs` and `node:process` answer only what the three modules call, as §6 says.
- **The lone surrogate check** runs over the whole text before the first byte is written, through the `stringIsWellFormed` key below. Text whose characters are all at or below U+00FF can't hold a surrogate, and a host that stores such text one byte per character answers at once (measured: JavaScript's `isWellFormed` took 0.0 ms on 64 million such characters). For other text the check costs about as much as encoding it. The position the fault names is found by ordinary Hexagon, after the check has failed.
- **`String.toWellFormed`** answers its text unchanged when it holds no lone surrogate.
- **The bare-set conformance test** (`compiler/src/conformance/prelude-bare-set.test.ts`) counts what Modules §5.5 counts: twenty-seven names, eighteen throwables, fifteen faults. `stdlib/README.md`'s count follows.
- **The experimental modules go,** with their Node adapters and their specs, and nothing redirects to them.

**The door keys.** The three modules call `node:fs` and `node:process` through ordinary `extern` blocks, so the playground can stand in beneath them. What JavaScript itself must do goes through these private keys of the intrinsic door (intrinsics §4.1 points here). `Process` needs none.

| Key | Row | Declared in | What it does |
| :--- | :--- | :--- | :--- |
| `stringIsWellFormed` | `(text: String) -> Bool` | `String`, `File`, `Stdio` | `text.isWellFormed()` |
| `stringToWellFormed` | `(text: String) -> String` | `String` | `text.toWellFormed()` |
| `jsErrorReadCode` | `(error: JsValue) -> JsValue` | `File`, `Stdio` | one guarded read of `.code`, kept as `JsError.message`'s read of `.message` is |
| `fileDecodeStrict` | `(bytes: JsValue) -> JsValue` | `File` | the text, decoded with `TextDecoder("utf-8", { fatal: true })`, or `undefined` for bytes that aren't UTF-8 |
| `fileDecodeLossy` | `(bytes: JsValue) -> String` | `File` | the text, decoded with `TextDecoder("utf-8")` |
| `fileFirstBadByte` | `(bytes: JsValue) -> Int` | `File` | the 1-based offset of the first byte that doesn't begin or continue a well-formed sequence |
| `stdioEncode` | `(text: String) -> JsValue` | `Stdio` | the UTF-8 bytes of well-formed text, through `TextEncoder` |
| `stdioByteLength` | `(bytes: JsValue) -> Int` | `Stdio` | the number of bytes `stdioEncode` gave |
| `stdioPause` | `() ->~ Unit` | `Stdio` | waits about a millisecond, through `Atomics.wait` |

- **Where a key is declared twice,** the rows bind one lowering (intrinsics §3.3). `File` and `Stdio` can't reach `String`'s private row, so each declares its own.
- **The decoding, encoding, error-code and pause keys are host capabilities.** Hexagon has no byte type, no way to catch a getter, and no way to wait (`stdlib-roadmap.md` §5.1). What each answer means, and every throw, is ordinary Hexagon over it.
- **The two string keys are there for their cost.** Both operations can be written in ordinary Hexagon over `toCodepoint`, which answers `None` for a lone surrogate (`string-text-processing.md` §1). But measured on Node 24.18.0, a check written that way took 384 ms on a million ASCII characters, where encoding them took 1.8 ms and `isWellFormed` under 0.01 ms. On 200,000 lines of 22 characters it took 1,626 ms, against 3.2 ms. That is two hundred times the encoding the check guards, on every write. This is `stdlib-roadmap.md` §5.1's last ground, measured performance evidence, and `string-text-processing.md` §11 names the exception.

## 10. Acceptance tests

1. **Imports.** `import File`, `import Stdio` and `import Process` resolve; a program that uses one without importing it is refused as any unimported module is. A program that imports none emits no `node:fs` or `node:process` import.
2. **Colours.** An unmarked call of each export is refused. `File`'s take `!`, and `Stdio`'s and `Process`'s take `~`.
3. **Reasons.** Each reason in §3.4's table, with a message naming the path: a missing file, a missing parent directory, an unreadable file (as a user without the permission), a directory, a path through a file, a name too long.
4. **Strict and lossy reads.** `61 FF 62` is refused by `readText` with a message naming byte 2, and `readTextLossy` reads `a�b`. A truncated sequence at the end is refused at its first byte. `EF BB BF 61` reads as `"a"` both ways, and `EF BB BF EF BB BF 61` as `"\u{FEFF}a"`.
5. **Writes.** The exact bytes of `writeText` and `writeTextBom`, with Unicode, CRLF, NUL and a supplied U+FEFF; truncation of a longer file; and `writeTextBom` followed by `readText` giving back the text.
6. **Catching.** `File.FileError(File.NotFound, path, _)` catches a missing file, and an uncaught `FileError` prints `Error [FileError]: …` with status 1.
7. **`Stdio` bytes.** Exact bytes on stdout and stderr for all four writers: the empty string, Unicode, a supplied BOM, NUL, existing line endings, the added LF, consecutive calls, and output larger than a pipe's buffer, to a file and to a pipe read to its end.
8. **`Stdio` endings.** `| head -1` ends with status 141 and an empty stderr. `> /dev/full` ends with one line on stderr and status 1. A program that calls `Debug.log`, then writes 2 MB into a reader that sleeps for a second, writes every byte and finishes with 0. A terminal check through a pseudo-terminal, with the terminal's own output processing turned off.
9. **`arguments`.** Under a script, under `node -e`, `-p`, `--eval=…` and `-pe`, with options to Node before the script, and with an argument whose bytes aren't UTF-8.
10. **`setExitStatus`.** 0, 3 and 255 end with that status; 256 and -1 throw `ExitStatusFault`; the last of two settings wins; an uncaught throw after a setting ends with 1.
11. **The playground.** Programs that write with `Stdio`, read the arguments and set a status print the same text in the playground as under Node with no arguments, in the same order, with stderr marked and the exit status shown. `File`'s answers in the playground are §6's, and the `EROFS` message matches the one Node gives for a write on a read-only file system.
12. **Lone surrogates.** Each of the six writers, given text holding a lone surrogate (from a foreign function), throws `LoneSurrogateFault` with the first one's position, where a well-formed pair before it counts as one codepoint. `writeText` and `writeTextBom` leave an existing file unchanged and create no missing one. A `Stdio` writer writes nothing, and the program goes on if the fault is caught. `toWellFormed` replaces each lone surrogate with U+FFFD, keeps a well-formed pair, and answers well-formed text unchanged. `LoneSurrogateFault` is bare in a catch arm.

## 11. Rejected alternatives (do not re-litigate)

### 11.1 Graduating less (decision 1)

- **Graduating files and output, with the arguments experimental.** An Advent of Code program would either hard-code its path or import one experimental module beside two stable ones.
- **Shipping v1 with all I/O under `Experimental`.** The first program anyone writes would import `Experimental`, and v1's promise wouldn't cover it. When I/O graduated, every program's imports would change.

### 11.2 Letting Node's errors through as `JsError` (decision 2)

- The contract would be Node's text. A program that plans for a missing file would look for `"ENOENT"` inside `JsError.message`, or write its own `extern` to read `code`.
- It goes against `JsError`'s own description, "a value JavaScript threw that Hexagon did not". A stable `File.readText` is Hexagon's operation.
- It is the case #1427's ruling was made for: decoders got `JsConversionError` rather than letting JavaScript's errors through.

### 11.3 One exception per kind of failure (decision 2)

`FileNotFound(path)`, `FilePermissionDenied(path)` and so on, the style of Java, .NET and Python. Hexagon exceptions have no common base, so "any file failure" would be one catch arm per kind, or `_`, which catches every other failure too. The module would also have more names.

### 11.4 Replacing bad bytes by default (decision 2b)

Node's `readFileSync(path, "utf8")` makes up U+FFFD for each bad sequence and says nothing. A file in another encoding, such as a CSV saved by older Excel in Windows-1252, reads `café` as `caf�`, and the program goes on with wrong data and no report. Source files and data files would follow opposite rules. The repair is kept, under a name that says so, `readTextLossy`.

### 11.5 Throwing when a write to stdout fails (decision 2c)

- **Every failure a tracked exception, the writers `->!`,** as Python does. `program | head -1` would print an error and exit 1, unless the program catches it at the top. Every function that prints would be marked as one that may fail, so the fail colour would no longer pick out the failures a caller plans for.
- **Ending quietly when the reader leaves, as Go does, with every other failure a tracked exception.** The second cost stays, for failures such as a full disk that no caller plans for either.

### 11.6 Carrying on when a write fails (decision 2c)

As Java, .NET and Node's `console.log` do. The program would report success when its output was lost.

### 11.7 The arguments as a value, or with the program first (decision 3)

- **A value, `Process.arguments`, read once when the program starts.** Effects §6.2's species (b) would have to stretch to admit it. Its members keep still something the program already holds, or never asked for, and the arguments are new information from outside, which Effects §1 calls input. A pure function could then depend on how the program was started, and its colour wouldn't show it.
- **The program's path first,** the OCaml, Swift, Rust, Go and Python convention. Under Node, "the program" is two paths, Node's and the script's, so every program would skip what comes before the user's first argument. Rust's documentation warns that its element "might not even exist".

### 11.8 Ending the program now with a status (decision 4)

`exit: Int ->~ a`, the shape of OCaml's, Rust's and Kotlin's.
- It would be a third way out of a function, beside returning and throwing, and the program's own choice: any call could end the program, and no `catch` would see it. A library function that called it would end any JavaScript application that imported it.
- It loses output still on its way: of 100,000 lines logged with `console.log`, which `Debug.log` uses, into a reader that waited a second, `process.exit(0)` delivered 6,656, where setting `process.exitCode` and finishing delivered all of them.
- It would need a new intrinsic with `throw`'s typing.
- Offering it beside `setExitStatus`, as Node and .NET do, adds these costs and two ways to do one thing.

It can be added later without breaking anything.

### 11.9 Wrapping an exit status outside 0 to 255 (decision 4)

Node turns 256 into 0, a success. That is a silent repair of a number that does not fit, which Exceptions §1 makes a fault.

### 11.10 The modules in the prelude, or one module for all of it (decision 5a)

In the prelude, a browser program could call `File.readText!` with nothing in its text saying it needs a host with files, and `FileError` would need a ruling to join Modules §5.5's closed bare set. One module, such as `Io`, would have to carry in each name what the module name no longer says, and arguments, the exit status and files are three subjects that Rust, Haskell and Koka keep apart.

### 11.11 Stopping or refusing a program in the playground (decision 5b)

- **The TypeScript Playground's way,** stopping the run at the first Node API with the browser's own error. A program that prints with `Stdio` couldn't be shown there, and its author would switch to `Debug.log`, which is a probe and not real output. The pane would also need its own way to tell a stopped run from a program that failed.
- **Refusing the program before running it.** The same costs, and even the `Debug.log` lines would never run.

### 11.12 Writing U+FFFD in place of a lone surrogate (decision 5c)

What Node does, silently. It makes up a character that isn't in the text, the repair 2b turned down when reading, and the writing side would then disagree with the reading side: read strictly and write with repair, and a round trip can change the text without anything saying so. Where a language replaces silently, the replacement isn't what the program wrote either: Java's printing writes `?`.

### 11.13 Refusing in `File` with `FileError(NotUtf8, …)`, and with a fault in `Stdio` (decision 5c)

It would give one cause two channels. And `FileError`'s reasons are about the file, where this is about the text.

## 12. Precedents consulted

- **Files:** Rust's `fs::read_to_string` and `String::from_utf8_lossy`; Swift's `String(contentsOfFile:encoding:)`; Python's `open`; Haskell's `readFile`; Java's `Files.readString`; Gleam's `simplifile`, whose `read` answers `Error(NotUtf8)`; Kotlin's `File.readText`; .NET's `File.ReadAllText`; Node's `readFileSync` and `TextDecoder`. OCaml and Go read bytes and don't decode them.
- **Output:** C, Go (`os/signal`: "A write to a broken pipe on file descriptors 1 or 2 … will cause the program to exit with a SIGPIPE signal"), Rust's `println!` and `-Zon-broken-pipe`, Python's note on `BrokenPipeError`, .NET's console stream on Unix, Swift's `print`, and Koka's `println`.
- **Arguments:** Node's `process.argv` and `util.parseArgs`, Koka's `get-args`, Haskell's `getArgs`, F#'s and Kotlin's `main` parameter, Gleam's `argv`, OCaml's `Sys.argv`, Swift's `CommandLine.arguments`, and Rust's `env::args`.
- **Exit status:** Node's `process.exitCode` and `process.exit`, .NET's `Environment.ExitCode` and `Exit`, Rust's `ExitCode` and `exit`, OCaml's `exit`, Kotlin's `exitProcess`, Go's `os.Exit`, and Python's `sys.exit`.
- **Lone surrogates on write:** Python, which refuses writing a file and printing (`UnicodeEncodeError`, with `errors="replace"` as the repair); Java's `Files.writeString`, which refuses, and `System.out.println`, which writes `?`; Node, which writes U+FFFD, and JavaScript's `isWellFormed` and `toWellFormed` (ES2024); Rust, whose `String` can't hold one (`String::from_utf16` refuses, `from_utf16_lossy` replaces).
- **The playground:** the TypeScript Playground, and the Rust, Go and Kotlin playgrounds, which run programs on a server.
