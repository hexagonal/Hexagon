// Run after `npm run build`: node scripts/test-experimental-stdio.mjs node|deno|bun
// Compile the real modules and execute their emitted ESM on the selected host.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileProject, Source } from "../dist/index.js";

const runtime = process.argv[2] ?? "node";
assert.ok(["node", "deno", "bun"].includes(runtime), "expected node, deno, or bun");
const version = spawnSync(runtime, ["--version"], { encoding: "utf8" });
assert.equal(version.status, 0, `${runtime} unavailable: ${version.error ?? version.stderr}`);
const root = mkdtempSync(join(tmpdir(), "hexagon-stdio-"));
try {
  const operations = ["write", "writeLine", "writeError", "writeErrorLine"];
  const exports = [
    ...["Stdio", "NodeStdio"].flatMap((alias) => operations.map((operation) =>
      `export let ${alias.toLowerCase()}_${operation}(text: String): Unit = ${alias}.${operation}!(text)`)),
  ].join("\n");
  const project = compileProject([new Source.File(Source.fileId(0), "/Main.hex", `module Main
import Hex.Experimental.Stdio as Stdio
import Hex.Experimental.Node.Stdio as NodeStdio
${exports}
`)]);
  assert.deepEqual(project.diagnostics, []);
  function save(path, content) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  save("package.json", '{"type":"module"}');
  for (const module of project.modules) {
    save(module.path.replace(/^\//u, "").replace(/\.hex$/u, ".js"), module.javascript.text);
  }
  if (project.runtimeGlobals) {
    save(project.runtimeGlobals.path.replace(/^\//u, ""), project.runtimeGlobals.text);
  }
  save("case.mjs", `
import * as Main from "./Main.js";
for (const prefix of ["stdio", "nodestdio"]) {
  Main[prefix + "_write"]("");
  Main[prefix + "_write"]("é😀\\uFEFF\\0\\r\\nA\\rB\\n");
  Main[prefix + "_writeLine"]("");
  Main[prefix + "_writeLine"]("tail\\n");
  Main[prefix + "_write"]("x".repeat(262144));
  Main[prefix + "_writeError"]("");
  Main[prefix + "_writeError"]("𝕏\\uFEFF\\0\\r\\nC\\rD\\n");
  Main[prefix + "_writeErrorLine"]("");
  Main[prefix + "_writeErrorLine"]("error\\r\\n");
  Main[prefix + "_writeError"]("y".repeat(262144));
}
`);
  save("failure.mjs", `
import assert from "node:assert/strict";
import { closeSync } from "node:fs";
import * as Main from "./Main.js";
for (const [fd, name] of [[1, "write"], [2, "writeError"]]) {
  closeSync(fd);
  for (const prefix of ["stdio", "nodestdio"]) {
    assert.throws(() => Main[prefix + "_" + name]("must fail"));
  }
}
`);
  const expectedOut = Buffer.from(("é😀\uFEFF\0\r\nA\rB\n\ntail\n\n" + "x".repeat(262144)).repeat(2));
  const expectedErr = Buffer.from(("𝕏\uFEFF\0\r\nC\rD\n\nerror\r\n\n" + "y".repeat(262144)).repeat(2));
  const args = (file) => runtime === "deno"
    ? ["run", "--no-prompt", "--allow-read", "--allow-write", file]
    : [file];

  // Redirect to real files: the second module must continue at the existing
  // descriptor position rather than truncating or reopening the destination.
  const stdoutPath = join(root, "stdout.bin");
  const stderrPath = join(root, "stderr.bin");
  const outFd = openSync(stdoutPath, "w");
  const errFd = openSync(stderrPath, "w");
  try {
    const result = spawnSync(runtime, args("case.mjs"), {
      cwd: root, stdio: ["ignore", outFd, errFd], timeout: 30000,
    });
    assert.equal(result.status, 0, `${runtime} redirected output: ${result.error ?? result.signal ?? ""}`);
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
  assert.deepEqual(readFileSync(stdoutPath), expectedOut, "redirected stdout bytes");
  assert.deepEqual(readFileSync(stderrPath), expectedErr, "redirected stderr bytes");

  // Attach readers before launching the writer and drain both pipes while it
  // runs. Waiting for exit before reading can deadlock at the pipe capacity.
  const piped = await new Promise((resolve, reject) => {
    const child = spawn(runtime, args("case.mjs"), {
      cwd: root, stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${runtime} piped writer timed out`));
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
  assert.equal(piped.code, 0, `${runtime} pipe exit: ${piped.signal ?? ""}\n${piped.stderr}`);
  assert.deepEqual(piped.stdout, expectedOut, "piped stdout bytes");
  assert.deepEqual(piped.stderr, expectedErr, "piped stderr bytes");

  // A real pseudo-terminal exercises terminal descriptors. The helper turns
  // off OPOST, which would otherwise transform LF (often into CRLF) after the
  // module writes it. Read both terminal masters while the writer runs.
  const terminalOut = join(root, "terminal-stdout.bin");
  const terminalErr = join(root, "terminal-stderr.bin");
  const terminal = spawnSync("python3", [
    new URL("./stdio-pty.py", import.meta.url).pathname,
    terminalOut, terminalErr, runtime, ...args("case.mjs"),
  ], { cwd: root, encoding: "utf8", timeout: 35000 });
  assert.equal(terminal.status, 0,
    `${runtime} terminal output: ${terminal.error ?? terminal.signal ?? terminal.stderr}`);
  assert.deepEqual(readFileSync(terminalOut), expectedOut, "terminal stdout bytes");
  assert.deepEqual(readFileSync(terminalErr), expectedErr, "terminal stderr bytes");

  const failed = spawnSync(runtime, args("failure.mjs"), {
    cwd: root, stdio: "ignore", timeout: 30000,
  });
  assert.equal(failed.status, 0, `${runtime} controlled write failure: ${failed.error ?? failed.signal ?? ""}`);
  console.log(`${version.stdout.trim().split("\n")[0]}: emitted Hexagon Stdio checks passed (files, drained pipes, terminals, failures)`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
