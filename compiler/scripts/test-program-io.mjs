// Run after `npm run build`: node scripts/test-program-io.mjs
// Compiles a program that imports `File`, `Stdio` and `Process`
// (`spec/program-io.md`) and runs its emitted ESM under Node, for what a test
// inside one process can't see: exact bytes on real descriptors, the writers'
// endings, standard input from files, pipes and a terminal, the arguments under
// each way of running Node, and the status a program finishes with.
import assert from "node:assert/strict";
import { constants as bufferConstants } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, ftruncateSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileProject, Source } from "../dist/index.js";

const node = process.execPath;

// Byte arrays compared by where they first differ: a diff of two arrays this
// long would take more memory than the run has.
function sameBytes(actual, expected, label) {
  if (actual.equals(expected)) return;
  let at = 0;
  while (at < actual.length && at < expected.length && actual[at] === expected[at]) at += 1;
  assert.fail(`${label}: ${actual.length} bytes where ${expected.length} were expected, first differing at byte ${at}`);
}
const root = mkdtempSync(join(tmpdir(), "hexagon-program-io-"));
try {
  const project = compileProject([new Source.File(Source.fileId(0), "/Main.hex", `module Main
import File
import Stdio
import Process

export let write(text: String): Unit = Stdio.write~(text)
export let writeLine(text: String): Unit = Stdio.writeLine~(text)
export let writeError(text: String): Unit = Stdio.writeError~(text)
export let writeErrorLine(text: String): Unit = Stdio.writeErrorLine~(text)

export let lines(count: Int): Unit =
    for n in 1..count
        Stdio.writeLine~("line \${n}")

// A probe first, which makes Node switch a piped stdout to non-blocking, then
// more than a pipe holds.
export let probeThenWrite(size: Int): Unit =
    Debug.log("probe")
    var text = "abcdefgh\\n"
    var length = 9
    while length < size
        text := text ++ text
        length := length * 2
    Stdio.write~(text)

export let showArguments(): Unit =
    for argument in Process.arguments~()
        Stdio.writeLine~("[\${argument}]")

export let setStatus(status: Int): Unit = Process.setExitStatus~(status)

export let read(path: String): String = File.readText!(path)

// One of the four writers, by number, refusing text with a lone surrogate.
export let guardedWrite(writer: Int, text: String): String =
    try
        match writer
            1 => Stdio.write~(text)
            2 => Stdio.writeLine~(text)
            3 => Stdio.writeError~(text)
            _ => Stdio.writeErrorLine~(text)
        "written"
    catch
        LoneSurrogateFault(_, position) => "refused at \${position}"

// Standard input, written back as it was read (section 4.5).
export let readAll(): Unit = Stdio.write~(Stdio.readText~())
export let readAllLossy(): Unit = Stdio.write~(Stdio.readTextLossy~())
export let readTwice(): Unit =
    let first = Stdio.readText~()
    let second = Stdio.readText~()
    Stdio.write~("[\${first}][\${second}]")

export let describeRead(path: String, lossy: Bool): String =
    try
        let _ = if lossy then File.readTextLossy!(path) else File.readText!(path)
        "read"
    catch
        File.FileError(File.Other(code), _, message) => "Other(\${code}) | \${message}"
        File.FileError(_, _, message) => "another reason | \${message}"
`)]);
  assert.deepEqual(project.diagnostics.map(({ message }) => message), []);
  const save = (path, content) => {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  };
  save("package.json", '{"type":"module"}');
  for (const module of project.modules) {
    save(module.path.replace(/^\//u, "").replace(/\.hex$/u, ".js"), module.javascript.text);
  }
  if (project.runtimeGlobals) {
    save(project.runtimeGlobals.path.replace(/^\//u, ""), project.runtimeGlobals.text);
  }
  const driver = (name, body) => save(name, `import * as Main from "./Main.js";\n${body}\n`);
  const run = (args, options = {}) =>
    spawnSync(node, args, { cwd: root, timeout: 60000, ...options });
  const shell = (command) =>
    spawnSync("bash", ["-c", command], { cwd: root, encoding: "utf8", timeout: 60000 });

  // --- Exact bytes, to a file, a drained pipe and a terminal (§4.1, §4.2) ---
  driver("case.mjs", `
Main.write("");
Main.write("é😀\\uFEFF\\0\\r\\nA\\rB\\n");
Main.writeLine("");
Main.writeLine("tail\\n");
Main.write("x".repeat(262144));
Main.write("€".repeat(21845));
Main.write("€".repeat(21846));
Main.write("€".repeat(30000));
Main.writeError("");
Main.writeError("𝕏\\uFEFF\\0\\r\\nC\\rD\\n");
Main.writeErrorLine("");
Main.writeErrorLine("error\\r\\n");
Main.writeError("y".repeat(262144));`);
  // The three runs of "€", three bytes each, sit at the writer's kept array's
  // edge: 65,535 bytes fit it, one more character does not, and 90,000 bytes
  // take an array of their own.
  const expectedOut = Buffer.from(
    "é😀﻿\0\r\nA\rB\n\ntail\n\n" + "x".repeat(262144) +
    "€".repeat(21845) + "€".repeat(21846) + "€".repeat(30000),
  );
  const expectedErr = Buffer.from("𝕏﻿\0\r\nC\rD\n\nerror\r\n\n" + "y".repeat(262144));

  const stdoutPath = join(root, "stdout.bin");
  const stderrPath = join(root, "stderr.bin");
  const outFd = openSync(stdoutPath, "w");
  const errFd = openSync(stderrPath, "w");
  try {
    const result = run(["case.mjs"], { stdio: ["ignore", outFd, errFd] });
    assert.equal(result.status, 0, `redirected output: ${result.error ?? result.signal ?? ""}`);
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
  sameBytes(readFileSync(stdoutPath), expectedOut, "redirected stdout bytes");
  sameBytes(readFileSync(stderrPath), expectedErr, "redirected stderr bytes");

  // Readers attach before the writer starts and drain both pipes while it
  // runs: waiting for the exit first would deadlock at the pipe's capacity.
  const piped = await new Promise((resolve, reject) => {
    const child = spawn(node, ["case.mjs"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("piped writer timed out"));
    }, 30000);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
  assert.equal(piped.code, 0, `pipe exit: ${piped.signal ?? ""}\n${piped.stderr}`);
  sameBytes(piped.stdout, expectedOut, "piped stdout bytes");
  sameBytes(piped.stderr, expectedErr, "piped stderr bytes");

  // A real pseudo-terminal. The helper turns off OPOST, which would otherwise
  // turn the LF the module writes into CRLF after it is written.
  const terminalOut = join(root, "terminal-stdout.bin");
  const terminalErr = join(root, "terminal-stderr.bin");
  const terminal = spawnSync("python3", [
    new URL("./stdio-pty.py", import.meta.url).pathname,
    terminalOut, terminalErr, node, "case.mjs",
  ], { cwd: root, encoding: "utf8", timeout: 35000 });
  assert.equal(terminal.status, 0, `terminal output: ${terminal.error ?? terminal.signal ?? terminal.stderr}`);
  sameBytes(readFileSync(terminalOut), expectedOut, "terminal stdout bytes");
  sameBytes(readFileSync(terminalErr), expectedErr, "terminal stderr bytes");

  // --- The endings (§4.3) ---
  driver("lines.mjs", "Main.lines(Number(process.argv[2]));");
  const headed = shell(`"${node}" lines.mjs 200000 2> head-stderr.txt | head -1; echo "\${PIPESTATUS[0]}"`);
  assert.equal(headed.stdout, "line 1\n141\n", "a reader that leaves ends the program with 141");
  assert.equal(readFileSync(join(root, "head-stderr.txt"), "utf8"), "", "and nothing on stderr");

  // `/dev/full` is Linux's, where CI runs these checks; elsewhere they are
  // skipped, and the closing line says so.
  const hasFull = existsSync("/dev/full");
  assert.ok(hasFull || process.platform !== "linux", "/dev/full is missing on Linux");
  if (hasFull) {
    const full = shell(`"${node}" lines.mjs 10 > /dev/full; echo "status $?"`);
    assert.equal(full.stdout, "status 1\n", "a full disk ends the program with 1");
    assert.equal(full.stderr, "cannot write to standard output: no space left on device\n");
    driver("errors.mjs", 'Main.writeErrorLine("to stderr");');
    const fullError = shell(`"${node}" errors.mjs 2> /dev/full; echo "status $?"`);
    assert.equal(fullError.stdout, "status 1\n", "a failing stderr ends the program with 1 too");
  }

  driver("probe.mjs", "Main.probeThenWrite(Number(process.argv[2]));");
  const slow = shell(`"${node}" probe.mjs 2097152 | (sleep 1; cat > slow.bin); echo "\${PIPESTATUS[0]}"`);
  assert.equal(slow.stdout, "0\n", `a slow reader after Debug.log: ${slow.stderr}`);
  const slowBytes = readFileSync(join(root, "slow.bin"));
  assert.equal(slowBytes.length, "probe\n".length + 9 * 2 ** 18, "every byte reaches a slow reader");
  assert.equal(slowBytes.subarray(0, 6).toString(), "probe\n");

  // --- Lone surrogates (§7) ---
  driver("lone.mjs", `
for (const writer of [1, 2, 3, 4]) Main.writeLine(Main.guardedWrite(writer, "ab\\uD83D\\uDE00c\\uD800d"));
Main.writeLine("after");`);
  const lone = run(["lone.mjs"], { encoding: "utf8" });
  assert.equal(lone.status, 0);
  assert.equal(lone.stdout, "refused at 5\n".repeat(4) + "after\n", "each writer refuses, and the program goes on");
  assert.equal(lone.stderr, "", "and nothing reaches stderr from the two that write there");

  // --- arguments (§5.1) ---
  driver("args.mjs", "Main.showArguments();");
  const shown = (result) => result.stdout.split("\n").filter((line) => line.startsWith("[")).join("\n");
  assert.equal(shown(run(["args.mjs", "a", "b c"], { encoding: "utf8" })), "[a]\n[b c]", "under a script");
  assert.equal(shown(run(["--no-warnings", "args.mjs", "a"], { encoding: "utf8" })), "[a]", "with options to Node first");
  assert.equal(shown(run(["args.mjs"], { encoding: "utf8" })), "", "with none");
  const code = 'import("./Main.js").then((Main) => Main.showArguments())';
  for (const spelling of [["-e", code], ["--eval", code], [`--eval=${code}`], ["-p", code], ["-pe", code]]) {
    assert.equal(shown(run([...spelling, "x", "y"], { encoding: "utf8" })), "[x]\n[y]", `under ${spelling[0]}`);
  }
  const raw = shell(`"${node}" args.mjs $'a\\xffb'`);
  assert.equal(raw.stdout, "[a�b]\n", "bytes that aren't UTF-8 arrive as U+FFFD");

  // --- setExitStatus (§5.2) ---
  driver("status.mjs", "for (const status of process.argv.slice(2)) Main.setStatus(Number(status));");
  for (const status of [0, 3, 255]) {
    assert.equal(run(["status.mjs", String(status)]).status, status, `status ${status}`);
  }
  assert.equal(run(["status.mjs", "5", "7"]).status, 7, "the last setting wins");
  for (const status of [256, -1]) {
    const refused = run(["status.mjs", String(status)], { encoding: "utf8" });
    assert.equal(refused.status, 1, `status ${status} is a fault`);
    assert.match(refused.stderr, /ExitStatusFault/u);
  }
  driver("thrown.mjs", 'Main.setStatus(3); throw new Error("uncaught");');
  assert.equal(run(["thrown.mjs"]).status, 1, "an uncaught throw after a setting ends with 1");

  // --- An uncaught FileError (§3.4) ---
  driver("missing.mjs", 'Main.read("missing.txt");');
  const missing = run(["missing.mjs"], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Error \[FileError\]: not found: missing\.txt/u);

  // --- Reading standard input (§4.5) ---
  driver("read.mjs", "Main.readAll();");
  driver("read-lossy.mjs", "Main.readAllLossy();");
  driver("read-twice.mjs", "Main.readTwice();");
  // More than a pipe holds, with every kind of line ending and a NUL.
  const input = Buffer.from("é😀\0\r\nA\rB\n" + "x".repeat(2 ** 20) + "€\n");
  writeFileSync(join(root, "input.bin"), input);
  const inputFd = openSync(join(root, "input.bin"), "r");
  try {
    const redirected = run(["read.mjs"], { stdio: [inputFd, "pipe", "pipe"], maxBuffer: 2 * input.length });
    assert.equal(redirected.status, 0, `stdin from a file: ${redirected.error ?? redirected.stderr}`);
    sameBytes(redirected.stdout, input, "stdin from a file");
  } finally {
    closeSync(inputFd);
  }
  const fromParent = run(["read.mjs"], { input, maxBuffer: 2 * input.length });
  assert.equal(fromParent.status, 0, `stdin from a parent's pipe: ${fromParent.error ?? fromParent.stderr}`);
  sameBytes(fromParent.stdout, input, "stdin from a parent's pipe");
  const fromCat = shell(`cat input.bin | "${node}" read.mjs > from-cat.bin; echo "\${PIPESTATUS[1]}"`);
  assert.equal(fromCat.stdout, "0\n", `stdin from cat: ${fromCat.stderr}`);
  sameBytes(readFileSync(join(root, "from-cat.bin")), input, "stdin from cat through a pipe");

  // A writer that pauses, into a blocking pipe and into one its parent made
  // non-blocking: the reader waits on `EAGAIN` and gets every byte.
  const pausing = "(printf a; sleep 0.3; printf b; sleep 0.3; printf c)";
  assert.equal(shell(`${pausing} | "${node}" read.mjs`).stdout, "abc", "a writer that pauses");
  const nonBlocking = "import fcntl, os, sys; "
    + "fcntl.fcntl(0, fcntl.F_SETFL, fcntl.fcntl(0, fcntl.F_GETFL) | os.O_NONBLOCK); "
    + "os.execvp(sys.argv[1], sys.argv[1:])";
  const unblocked = shell(`${pausing} | python3 -I -c '${nonBlocking}' "${node}" read.mjs`);
  assert.equal(unblocked.stdout, "abc", `a non-blocking pipe: ${unblocked.stderr}`);

  // Decoding, as `File.readText` decodes (§3.1).
  const notUtf8 = shell(`printf 'a\\xffb' | "${node}" read.mjs; echo "status $?"`);
  assert.equal(notUtf8.stdout, "status 1\n", "input that isn't UTF-8 ends the program with 1");
  assert.equal(notUtf8.stderr, "cannot read standard input: not UTF-8 at byte 2\n");
  const cutShort = shell(`printf 'ab\\xe2\\x82' | "${node}" read.mjs`);
  assert.equal(cutShort.stderr, "cannot read standard input: not UTF-8 at byte 3\n", "a sequence cut short at the end");
  assert.equal(shell(`printf 'a\\xffb' | "${node}" read-lossy.mjs`).stdout, "a\uFFFDb", "the lossy read replaces");
  for (const script of ["read.mjs", "read-lossy.mjs"]) {
    assert.equal(shell(`printf '\\xef\\xbb\\xbfa' | "${node}" ${script}`).stdout, "a", `${script} drops a BOM`);
    assert.equal(shell(`printf '\\xef\\xbb\\xbf\\xef\\xbb\\xbfa' | "${node}" ${script}`).stdout, "\uFEFFa", `${script} drops one BOM of two`);
  }

  // Empty input, and input already consumed.
  writeFileSync(join(root, "xyz.txt"), "xyz");
  assert.equal(shell(`"${node}" read-twice.mjs < /dev/null`).stdout, "[][]", "/dev/null");
  assert.equal(shell(`"${node}" read-twice.mjs <&-`).stdout, "[][]", "a closed stdin");
  assert.equal(shell(`"${node}" read-twice.mjs < xyz.txt`).stdout, "[xyz][]", "a second read of a file");
  assert.equal(shell(`printf xyz | "${node}" read-twice.mjs`).stdout, "[xyz][]", "a second read of a pipe");

  // A terminal: the read ends at Ctrl-D, and a second read answers what is
  // typed after it.
  const typed = spawnSync("python3", [
    "-I", new URL("./stdin-pty.py", import.meta.url).pathname, node, "read-twice.mjs",
  ], { cwd: root, encoding: "utf8", timeout: 35000 });
  assert.equal(typed.status, 0, `terminal input: ${typed.error ?? typed.signal ?? typed.stderr}`);
  assert.equal(typed.stdout, "[first line\nsecond\n][after\n]", "terminal input");

  // The other endings: a directory, and a line that can't be written.
  const directory = shell(`"${node}" read.mjs < /; echo "status $?"`);
  assert.equal(directory.stdout, "status 1\n", "a directory as stdin ends the program with 1");
  assert.equal(directory.stderr, "cannot read standard input: illegal operation on a directory\n");
  const unsaid = shell(`printf 'a\\xffb' | "${node}" read.mjs 2>&-; echo "status $?"`);
  assert.equal(unsaid.stdout, "status 1\n", "the status is 1 when the line itself can't be written");

  // --- A file too long for a string (§3.4) ---
  // Zero bytes are UTF-8, and one more of them than the longest string Node
  // makes is refused by either read as `Other`, never as a raw error. Given as
  // stdin, it ends the program instead (§4.5).
  const huge = join(root, "huge.txt");
  const hugeFd = openSync(huge, "w");
  try {
    ftruncateSync(hugeFd, bufferConstants.MAX_STRING_LENGTH + 1);
  } finally {
    closeSync(hugeFd);
  }
  driver("huge.mjs", 'for (const lossy of [false, true]) Main.writeLine(Main.describeRead(process.argv[2], lossy));');
  const tooLong = run(["huge.mjs", huge], { encoding: "utf8" });
  const longest = `0x${bufferConstants.MAX_STRING_LENGTH.toString(16)}`;
  for (const script of ["read.mjs", "read-lossy.mjs"]) {
    const ended = shell(`"${node}" ${script} < "${huge}"; echo "status $?"`);
    assert.equal(ended.stdout, "status 1\n", `${script}: input too long for a string ends the program with 1`);
    assert.equal(ended.stderr, `cannot read standard input: Cannot create a string longer than ${longest} characters\n`);
  }
  // Room the reader can't get ends the program as §4.5's other failures do,
  // never with a raw error. Linux enforces a limit on a process's address
  // space (`ulimit -v`). This one is what a fresh Node reaches plus 300 MB, so
  // the program starts but the reader's array can't double its way to the
  // input's 512 MB. Measured on Node 24.18.0, headroom from 25 MB to 800 MB
  // gave the line, except near 200 MB, where V8 ran out of its own heap
  // first (`FATAL ERROR: … JavaScript heap out of memory`, status 134), as it
  // does with no headroom. A failure of that shape here means the band moved.
  const linux = process.platform === "linux";
  if (linux) {
    const fresh = spawnSync(node, [
      "-e", 'import("node:process").then(() => console.log(/VmPeak:\\s+(\\d+)/u.exec(require("node:fs").readFileSync("/proc/self/status", "utf8"))[1]))',
    ], { encoding: "utf8" });
    assert.equal(fresh.status, 0, fresh.stderr);
    const limit = Number(fresh.stdout) + 300_000;
    const roomless = shell(`ulimit -v ${limit}; "${node}" read.mjs < "${huge}"; echo "status $?"`);
    assert.equal(roomless.stdout, "status 1\n", `no room for the input ends the program with 1: ${roomless.stderr}`);
    assert.match(roomless.stderr, /^cannot read standard input: [^\n]+\n$/u, "no room for the input: one line");
  }
  rmSync(huge);
  assert.equal(tooLong.status, 0, tooLong.stderr);
  const tooLongLine = `Other(ERR_STRING_TOO_LONG) | Cannot create a string longer than ${longest} characters: ${huge}\n`;
  assert.equal(tooLong.stdout, tooLongLine.repeat(2), "a text too long for a string is Other, naming the path");

  const skips = [
    ...(hasFull ? [] : ["the /dev/full checks skipped: no /dev/full"]),
    ...(linux ? [] : ["the memory-limit check skipped: not Linux"]),
  ];
  const skipped = skips.length === 0 ? "" : ` (${skips.join("; ")})`;
  console.log(`${process.version}: program I/O checks passed (bytes on files, pipes and terminals; endings; standard input; arguments; status; a text too long)${skipped}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
