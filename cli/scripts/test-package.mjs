// An npm installation test, deliberately outside the repository. Use the npm
// runner's own CLI path so this works with both POSIX and Windows npm installs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8"));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "run this script through npm run test:package");
const scratch = mkdtempSync(join(tmpdir(), "hexagon-package-"));
const cache = join(scratch, "npm-cache");
const project = join(scratch, "consumer with spaces");
mkdirSync(project);

function write(base, path, text) {
  const destination = join(base, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, text);
}
function command(executable, args, cwd, expected = 0) {
  const result = spawnSync(executable, args, {
    cwd, encoding: "utf8", timeout: 120000,
    env: { ...process.env, npm_config_cache: cache, npm_config_update_notifier: "false" },
  });
  assert.equal(result.status, expected,
    `${executable} ${args.join(" ")}\n${result.error ?? result.signal ?? ""}\n${result.stdout}\n${result.stderr}`);
  return result;
}
function npm(args, cwd) {
  return command(process.execPath, [npmCli, "--silent", ...args], cwd);
}
function pack(directory) {
  const packed = npm(["pack", "--json", "--pack-destination", scratch], directory);
  // A prepack generator reports what it refreshed before npm writes its JSON.
  const jsonStart = packed.stdout.indexOf("[");
  assert.notEqual(jsonStart, -1, `npm pack returned no JSON:\n${packed.stdout}`);
  const rows = JSON.parse(packed.stdout.slice(jsonStart));
  assert.equal(rows.length, 1);
  return join(scratch, rows[0].filename);
}

try {
  const tarball = pack(workspace);
  write(project, "package.json", '{"name":"alpha-consumer","version":"1.0.0","private":true}\n');
  npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", tarball], project);
  const installed = join(project, "node_modules", ...manifest.name.split("/"));
  const bin = resolve(installed, manifest.bin.hexc);
  assert.ok(existsSync(bin));
  assert.ok(existsSync(join(installed, "LICENSE")));
  assert.ok(!existsSync(join(installed, "node_modules")), "tool must not require a nested development install");
  const version = npm(["exec", "--offline", "--", "hexc", "--version"], project);
  assert.ok(version.stdout.includes(manifest.version));
  function hexc(args, expected = 0) {
    return command(process.execPath, [bin, ...args], project, expected);
  }
  assert.ok(hexc(["--help"]).stdout.includes("check"));
  hexc(["unknown-command"], 2);

  // Install a real local tarball containing both Hexagon source and foreign JS.
  const dependency = join(scratch, "dependency");
  write(dependency, "package.json", JSON.stringify({
    name: "alpha-helper", version: "1.0.0", type: "module", exports: "./index.js",
    files: ["hexagon.json", "Lib.hex", "index.js"],
  }));
  write(dependency, "hexagon.json", '{"name":"Demo"}\n');
  write(dependency, "Lib.hex", "module Lib\nexport let answer: Int = 42\n");
  write(dependency, "index.js", 'export function suffix() { return " from npm"; }\n');
  npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", pack(dependency)], project);
  write(project, "hexagon.json", '{"dependencies":["Demo"]}\n');
  const main = `module Main
import Demo.Lib
import Hex.Experimental.Stdio as Stdio
import bare Token from Types
extern from "alpha-helper"
    fun suffix() -> String
export let answer: Int = Lib.answer
export let token: Token = Token.One
Stdio.writeLine!("Hello" ++ suffix())
`;
  write(project, "Main.hex", main);
  write(project, "Types.hex", `module Types
export union Token = One | Two
export let unfinished: Int = "unused body"
`);
  write(project, "Unused.hex", 'module Unused\nexport let broken: Int = "unused body"\n');
  hexc(["check", "Main.hex"]);
  assert.ok(!existsSync(join(project, "dist")), "check must write no output");
  hexc(["build", "Main.hex"]);
  assert.ok(existsSync(join(project, "dist", "Main.d.ts")));
  assert.ok(!existsSync(join(project, "dist", "Types.js")));
  assert.ok(!existsSync(join(project, "dist", "Unused.js")));
  assert.equal(command(process.execPath, ["dist/Main.js"], project).stdout, "Hello from npm\n");

  // The emitted declaration graph must be consumable as shipped. This uses
  // the CLI workspace's development compiler only as a test harness; the
  // installed Hexagon package itself carries no TypeScript dependency.
  write(project, "consumer.mts", `import { answer, token } from "./dist/Main.js";
const checkedAnswer: number = answer;
const checkedToken: typeof token = token;
void checkedAnswer;
void checkedToken;
`);
  write(project, "tsconfig.json", JSON.stringify({
    compilerOptions: {
      target: "ES2024",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
    },
    files: ["consumer.mts"],
  }, null, 2));
  const typescriptCli = join(workspace, "node_modules", "typescript", "bin", "tsc");
  assert.ok(existsSync(typescriptCli), "package smoke requires the workspace TypeScript dev dependency");
  command(process.execPath, [typescriptCli, "-p", "tsconfig.json"], project);

  // A failed compilation cannot quietly replace the previous successful build.
  const oldMain = readFileSync(join(project, "dist", "Main.js"), "utf8");
  write(project, "Main.hex", 'module Main\nexport let answer: Int = "wrong"\n');
  const failed = hexc(["build", "Main.hex"], 1);
  assert.match(failed.stderr, /Main\.hex/u);
  assert.match(failed.stderr, /unchanged/u);
  assert.equal(readFileSync(join(project, "dist", "Main.js"), "utf8"), oldMain);

  // The local helper is supplied by the author. Rebuilding must preserve it
  // while removing the now-obsolete generated Demo/Lib.js from the old root.
  write(project, "dist/helper.js", 'export function greet() { return "Local helper"; }\n');
  write(project, "Main.hex", `module Main
import Hex.Experimental.Stdio as Stdio
extern from "./helper.js"
    fun greet() -> String
Stdio.writeLine!(greet())
`);
  hexc(["build", "Main.hex"]);
  assert.ok(!existsSync(join(project, "dist", "Demo", "Lib.js")));
  assert.equal(command(process.execPath, ["dist/Main.js"], project).stdout, "Local helper\n");
  assert.equal(readFileSync(join(project, "dist/helper.js"), "utf8"),
    'export function greet() { return "Local helper"; }\n');

  // A user edit is not disposable merely because the file was once generated.
  write(project, "dist/Main.js", "// hand edit\n");
  hexc(["build", "Main.hex"], 1);
  assert.equal(readFileSync(join(project, "dist/Main.js"), "utf8"), "// hand edit\n");

  // A separate, manifestless project exercises the first-root-directory rule.
  const simple = join(scratch, "manifestless");
  write(simple, "Main.hex", "module Main\nexport let value: Int = 7\n");
  command(process.execPath, [bin, "build", "Main.hex"], simple);
  assert.ok(existsSync(join(simple, "dist/Main.js")));

  // Multiple explicit roots share one compile, and every module declared in a
  // selected file becomes an emitted root. Relative custom output is resolved
  // from the invoking directory, even when that directory is nested.
  const acceptance = join(scratch, "root acceptance");
  const nestedCwd = join(acceptance, "nested cwd");
  write(acceptance, "hexagon.json", "{}\n");
  write(acceptance, "Both.hex",
    "module First\nexport let first: Int = 1\nend module First\n" +
    "module Second\nexport let second: Int = 2\n");
  write(acceptance, "Other.hex", "module Third\nexport let third: Int = 3\n");
  mkdirSync(nestedCwd, { recursive: true });
  command(process.execPath, [
    bin, "build", "../Both.hex", "../Other.hex", "--out-dir", "../custom output",
  ], nestedCwd);
  for (const module of ["First", "Second", "Third"]) {
    assert.ok(existsSync(join(acceptance, "custom output", `${module}.js`)));
  }
  const missing = command(process.execPath, [bin, "check", "Missing.hex"], acceptance, 1);
  assert.match(missing.stderr, /cannot read root/u);

  // Experimental.File's Node adapter is exercised through the installed CLI
  // and its unmodified emitted graph, including one write and subsequent read.
  write(acceptance, "FileMain.hex", `module FileMain
import Hex.Experimental.File as File
import Hex.Experimental.Stdio as Stdio
File.writeText!("file-output.txt", "text-file runtime checks passed")
Stdio.writeLine!(File.readText!("file-output.txt"))
`);
  command(process.execPath, [bin, "build", "FileMain.hex"], acceptance);
  assert.equal(command(process.execPath, ["dist/FileMain.js"], acceptance).stdout,
    "text-file runtime checks passed\n");
  assert.equal(readFileSync(join(acceptance, "file-output.txt"), "utf8"),
    "text-file runtime checks passed");

  // A module-only case rename must replace every owned path component, even
  // on a case-insensitive filesystem where Foo and FOO address the same entry.
  const renamed = join(scratch, "case-renamed module");
  write(renamed, "hexagon.json", "{}\n");
  write(renamed, "Main.hex", `module Foo.Bar.Main
import Hex.Experimental.Stdio as Stdio
Stdio.writeLine!("old module")
`);
  command(process.execPath, [bin, "build", "Main.hex"], renamed);
  assert.equal(command(process.execPath, ["dist/Foo/Bar/Main.js"], renamed).stdout,
    "old module\n");
  assert.ok(readdirSync(join(renamed, "dist")).includes("Foo"));

  write(renamed, "Main.hex", `module FOO.Bar.Main
import Hex.Experimental.Stdio as Stdio
Stdio.writeLine!("renamed module")
`);
  command(process.execPath, [bin, "build", "Main.hex"], renamed);
  assert.equal(command(process.execPath, ["dist/FOO/Bar/Main.js"], renamed).stdout,
    "renamed module\n");
  const topLevelEntries = readdirSync(join(renamed, "dist"));
  assert.ok(topLevelEntries.includes("FOO"), `expected FOO in ${topLevelEntries.join(", ")}`);
  assert.ok(!topLevelEntries.includes("Foo"), `stale Foo remained in ${topLevelEntries.join(", ")}`);
  assert.deepEqual(readdirSync(join(renamed, "dist", "FOO", "Bar")).sort(), [
    "Main.d.ts",
    "Main.js",
  ]);
  console.log(`${manifest.version}: installed hexc package checks passed on ${process.version} (${process.platform})`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
