// Run after `npm run build`: node scripts/test-experimental-file.mjs node|deno|bun
// Deno 2.4.0 or newer is required for node:fs to preserve an initial UTF-8 BOM.
// Compile real Hexagon modules, then execute their unmodified ESM on each host.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileProject, Source } from "../dist/index.js";

const runtime = process.argv[2] ?? "node";
assert.ok(["node", "deno", "bun"].includes(runtime), "expected node, deno, or bun");
const version = spawnSync(runtime, ["--version"], { encoding: "utf8" });
assert.equal(version.status, 0, `${runtime} unavailable: ${version.error ?? version.stderr}`);
const root = mkdtempSync(join(tmpdir(), "hexagon-file-"));
try {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", `module Main
import Hex.Experimental.File as File
import Hex.Experimental.Node.File as NodeFile
export let read(path: String): String = File.readText!(path)
export let rawRead(path: String): String = NodeFile.readText!(path)
export let write(path: String, text: String): Unit = File.writeText!(path, text)
export let rawWrite(path: String, text: String): Unit = NodeFile.writeText!(path, text)
`)]);
  assert.deepEqual(project.diagnostics, []);
  function save(path, text) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, text);
  }
  save("package.json", '{"type":"module"}');
  for (const data of project.dataUnits) {
    save(data.path.replace(/^\//u, "").replace(/\.hex$/u, ".js"), data.javascript.text);
  }
  for (const module of project.modules) {
    save(module.path.replace(/^\//u, "").replace(/\.hex$/u, ".js"), module.javascript.text);
  }
  if (project.runtimeGlobals) {
    save(project.runtimeGlobals.path.replace(/^\//u, ""), project.runtimeGlobals.text);
  }
  save("check.mjs", `
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { read, rawRead, write, rawWrite } from "./Main.js";
const cases = ["", "\\uFEFF", "\\uFEFF\\uFEFFx", "x\\uFEFFy", "𝕏😀é\\r\\nnext\\n\\0end"];
for (const text of cases) {
  writeFileSync("input.txt", text, "utf8");
  assert.equal(rawRead("input.txt"), text);
  assert.equal(read("input.txt"), text.startsWith("\\uFEFF") ? text.slice(1) : text);
}
writeFileSync("input.txt", new Uint8Array([0x61, 0xff, 0x62]));
assert.equal(read("input.txt"), "a\\uFFFDb");
assert.equal(rawRead("input.txt"), "a\\uFFFDb");
for (const writer of [write, rawWrite]) {
  for (const text of ["long initial content", "é😀\\r\\n\\0x", "\\uFEFFkept", "", "\\uD800"]) {
    writer("output.txt", text);
    assert.deepEqual(new Uint8Array(readFileSync("output.txt")), new TextEncoder().encode(text));
  }
  assert.throws(() => writer("missing-parent/output.txt", "text"));
}
assert.throws(() => read("does-not-exist.txt"));
assert.throws(() => rawRead("does-not-exist.txt"));
console.log("text-file runtime checks passed");
`);
  function run(file, permissions = []) {
    const args = runtime === "deno" ? ["run", "--no-prompt", ...permissions, file] : [file];
    const result = spawnSync(runtime, args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, `${runtime} ${file}: ${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  }
  run("check.mjs", ["--allow-read", "--allow-write"]);
  if (runtime === "deno") {
    // Static ESM loading needs no read grant. Existing input avoids mistaking
    // a missing-file error for permission enforcement; writes are denied too.
    save("denied.mjs", `
import assert from "node:assert/strict";
import { read, rawRead, write, rawWrite } from "./Main.js";
for (const reader of [read, rawRead]) {
  assert.throws(() => reader("input.txt"), /Requires read access/);
}
for (const writer of [write, rawWrite]) {
  assert.throws(() => writer("output.txt", "denied"), /Requires write access/);
}
`);
    run("denied.mjs");
  }
  console.log(`${version.stdout.trim().split("\n")[0]}: emitted Hexagon file checks passed`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
