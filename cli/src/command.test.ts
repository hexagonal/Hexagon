import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { runCommand } from "./command.js";
import type { writeOutput } from "./output.js";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function workspace(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hexc-command-"));
  temporary.push(root);
  for (const [relative, text] of Object.entries(files)) {
    const path = join(root, relative);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, text, "utf8");
  }
  return root;
}

function capture(root: string, write?: typeof writeOutput) {
  let stdout = "";
  let stderr = "";
  return {
    context: {
      cwd: root,
      stdout: (text: string) => { stdout += text; },
      stderr: (text: string) => { stderr += text; },
      ...(write === undefined ? {} : { write }),
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe("CLI project integration", () => {
  test("check selects a manifestless root, ignores an unrelated body error, and writes nothing", async () => {
    const root = await workspace({
      "Main.hex": "module Main\n\nexport let answer: Int = 42\n",
      "Draft.hex": "module Draft\n\nlet broken: Int = False\n",
    });
    let writes = 0;
    const io = capture(root, async () => { writes += 1; });
    expect(await runCommand(["check", "Main.hex"], io.context)).toBe(0);
    expect(writes).toBe(0);
    expect(io.stderr()).toBe("");
  });

  test("build hands artifacts and root metadata to the writer and reports the emitted entry", async () => {
    const root = await workspace({
      "hexagon.json": "{}\n",
      "src/Main.hex": "module Main\n\nexport let answer: Int = 42\n",
    });
    let request: Parameters<typeof writeOutput>[0] | undefined;
    const io = capture(root, async (given) => { request = given; });
    expect(await runCommand(["build", "src/Main.hex"], io.context)).toBe(0);
    const canonicalRoot = await realpath(root);
    expect(request?.projectDirectory).toBe(canonicalRoot);
    expect(request?.outputDirectory).toBe(join(canonicalRoot, "dist"));
    expect([...request!.artifacts.keys()]).toEqual(expect.arrayContaining(["Main.js", "Main.d.ts", "package.json"]));
    expect(request?.roots).toEqual([join(canonicalRoot, "src/Main.hex")]);
    expect(io.stdout()).toContain(join(canonicalRoot, "dist/Main.js"));
  });

  test("an excluded explicit root fails before compilation", async () => {
    const root = await workspace({
      "hexagon.json": '{"exclude":["drafts"]}\n',
      "Main.hex": "module Main\n",
      "drafts/Bad.hex": "module Bad\n",
    });
    const io = capture(root);
    expect(await runCommand(["check", "drafts/Bad.hex"], io.context)).toBe(1);
    expect(io.stderr()).toContain("excluded from its project");
  });
});
