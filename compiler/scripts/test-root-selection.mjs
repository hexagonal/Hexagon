// Run after npm run build. Exercise the selected graph as real files under Node,
// including declaration-only artifacts that a JavaScript execution cannot test.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProject, Source } from "../dist/index.js";

const inputs = [
  ["/main.hex", `module Main
import Support
import bare Token from Types
import bare Vectors from Types
import bare Wrapper from Types
export fun id(value: Wrapper): Wrapper = value
export let answer: Int = Support.answer
export let token: Token = Token.One
`],
  ["/other.hex", `module Other
import Support
export let answer: Int = Support.answer
`],
  ["/support.hex", "module Support\nexport let answer: Int = 42\n"],
  ["/types.hex", `module Types
export union Token = One | Two
export type Vectors(a) = Vector(a)
export record Set = { value: Int }
export type Wrapper = Set
export let unfinished: Int = "not an Int"
`],
  ["/unused.hex", "module Unused\nexport let unfinished: Int = \"not an Int\"\n"],
];
const files = inputs.map(([path, text], index) =>
  new Source.File(Source.fileId(index), path, text));
const project = compileProject(files, { roots: [files[0].id, files[1].id] });
assert.deepEqual(project.diagnostics, []);
assert.deepEqual(project.roots, [
  { fileId: files[0].id, sourcePath: "/main.hex", modules: [{ name: "Main", path: "/Main.hex" }] },
  { fileId: files[1].id, sourcePath: "/other.hex", modules: [{ name: "Other", path: "/Other.hex" }] },
]);
assert.equal(project.modules.filter(({ name }) => name === "Support").length, 1);
assert.ok(!project.modules.some(({ name }) => name === "Unused" || name === "Types"));
assert.ok(project.dataUnits.length > 0, "bare imports must produce their data artifacts");
assert.ok(project.runtimeGlobals, "the transitive Set data unit requires runtime globals");
assert.ok(project.runtimeDeclarations, "Vector faces require runtime declarations");

const directory = mkdtempSync(join(tmpdir(), "hexagon-selected-roots-"));
try {
  function save(path, text) {
    const destination = join(directory, path.replace(/^\//u, ""));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, text);
  }
  save("package.json", '{"type":"module"}\n');
  for (const artifact of [...project.dataUnits, ...project.modules]) {
    save(artifact.path.replace(/\.hex$/u, ".js"), artifact.javascript.text);
    save(artifact.path.replace(/\.hex$/u, ".d.ts"), artifact.declarations.text);
  }
  save(project.runtimeGlobals.path, project.runtimeGlobals.text);
  save(project.runtimeDeclarations.path, project.runtimeDeclarations.text);
  save("check.mjs", `import assert from "node:assert/strict";
import * as Main from "./Main.js";
import * as Other from "./Other.js";
assert.equal(Main.answer, 42);
assert.equal(Other.answer, 42);
assert.deepEqual(Main.token, { tag: "One" });
assert.deepEqual(Main.id({ value: 9 }), { value: 9 });
console.log("selected-root ESM execution passed");
`);
  save("consumer.ts", `import { answer, token, id } from "./Main.js";
const count: number = answer;
const one: { readonly tag: "One" } | { readonly tag: "Two" } = token;
const wrapped: { value: number } = id({ value: 9 });
void [count, one, wrapped];
`);
  save("tsconfig.json", JSON.stringify({
    compilerOptions: {
      strict: true, noEmit: true, module: "NodeNext", target: "ES2024",
      skipLibCheck: false,
    },
    include: ["**/*.ts"],
  }));
  function run(args, label) {
    const result = spawnSync(process.execPath, args, {
      cwd: directory, encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.status, 0,
      `${label}: ${result.error ?? result.signal ?? ""}\n${result.stdout}\n${result.stderr}`);
    if (result.stdout) process.stdout.write(result.stdout);
  }
  run(["check.mjs"], "Node execution");
  run([fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url)),
    "--project", "tsconfig.json"], "declaration consumption");
  console.log("selected-root declaration consumption passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
