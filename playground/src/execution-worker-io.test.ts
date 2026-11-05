import { beforeAll, describe, expect, test } from "vitest";

import { chunksAt, execute, failureAt, harness, installWorkerHarness } from "./execution-worker-harness";

/**
 * Node's own modules, for comparing the playground with Node. The playground
 * is typed for the browser, so each is named by what these tests call.
 */
interface NodeFs {
  readonly mkdtempSync: (prefix: string) => string;
  readonly mkdirSync: (path: string, options?: { readonly recursive: boolean }) => unknown;
  readonly writeFileSync: (path: string, data: string) => void;
  readonly rmSync: (path: string, options: { readonly recursive: boolean; readonly force: boolean }) => void;
}
interface NodeOs {
  readonly tmpdir: () => string;
  readonly constants: { readonly errno: { readonly EROFS: number } };
}
interface NodePath {
  readonly join: (...parts: string[]) => string;
  readonly dirname: (path: string) => string;
}
interface NodeChildProcess {
  readonly spawnSync: (
    command: string,
    args: readonly string[],
    options: { readonly cwd: string; readonly encoding: "utf8" },
  ) => { readonly stdout: string; readonly stderr: string; readonly status: number | null };
}
interface NodeUtil {
  readonly getSystemErrorMessage: (errno: number) => string;
}

async function nodeModule<T>(specifier: string): Promise<T> {
  return await import(/* @vite-ignore */ specifier) as T;
}

function nodeProcess(): { readonly execPath: string } {
  return (globalThis as unknown as { readonly process: { readonly execPath: string } }).process;
}

beforeAll(installWorkerHarness);

/**
 * The playground as a terminal (`spec/program-io.md` §6, test 11). A program
 * that imports `File`, `Stdio` and `Process` runs on the playground's own
 * `node:fs` and `node:process`, and prints what it prints under Node run with
 * no arguments: the same stdout and stderr, in the order written, with the
 * same status.
 */
describe("the playground runs program I/O as a terminal would", () => {
  const PROGRAM = `import File
import Stdio
import Process

Debug.log("a probe line")
Stdio.write~("partial ")
Stdio.writeLine~("then whole")
Stdio.write~("\\u{FEFF}starts with a byte-order mark\\n")
Stdio.writeError~("\\u{FEFF}to stderr ")
Stdio.writeErrorLine~("with a line")
Stdio.writeLine~("arguments: \${Process.arguments~().length()}")
let described = try File.readText!("input.txt") catch
    File.FileError(File.NotFound, path, message) => "NotFound \${path} | \${message}"
    File.FileError(_, _, message) => "other: \${message}"
    _ => "something else"
Stdio.writeLine~(described)
Process.setExitStatus~(3)
`;

  /** The program's two streams and status under Node, in an empty directory. */
  async function underNode(): Promise<{ stdout: string; stderr: string; status: number | null }> {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await nodeModule<NodeFs>("node:fs");
    const { tmpdir } = await nodeModule<NodeOs>("node:os");
    const { join, dirname } = await nodeModule<NodePath>("node:path");
    const { spawnSync } = await nodeModule<NodeChildProcess>("node:child_process");
    const request = execute(100, PROGRAM);
    const root = mkdtempSync(join(tmpdir(), "playground-io-"));
    try {
      const program = join(root, "program");
      for (const module of request.modules) {
        const path = join(program, module.path.replace(/\.hex$/u, ".js"));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, module.javascript);
      }
      writeFileSync(join(program, "package.json"), '{"type":"module"}');
      const empty = join(root, "empty");
      mkdirSync(empty);
      const result = spawnSync(nodeProcess().execPath, [join(program, request.entryPath.replace(/\.hex$/u, ".js"))], {
        cwd: empty, encoding: "utf8",
      });
      return { stdout: result.stdout, stderr: result.stderr, status: result.status };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test("the same text on each stream, in order, and the same status", async () => {
    harness.posted.length = 0;
    await harness.send(execute(100, PROGRAM));
    const chunks = chunksAt(harness.posted, 100);
    const playgroundOut = chunks.filter(({ stream }) => stream === "stdout").map(({ text }) => text).join("");
    const playgroundErr = chunks.filter(({ stream }) => stream === "stderr").map(({ text }) => text).join("");

    expect(chunks.map(({ stream }) => stream)).toEqual([
      "stdout", "stdout", "stdout", "stdout", "stderr", "stderr", "stdout", "stdout",
    ]);
    expect(playgroundOut).toBe(
      "a probe line\npartial then whole\n\uFEFFstarts with a byte-order mark\narguments: 0\n" +
      "NotFound input.txt | not found: input.txt\n",
    );
    expect(playgroundErr).toBe("\uFEFFto stderr with a line\n");
    expect(harness.posted.at(-1)).toEqual({ kind: "execute-success", version: 100, exitStatus: 3 });

    const node = await underNode();
    expect(node).toEqual({ stdout: playgroundOut, stderr: playgroundErr, status: 3 });
  }, 120_000);

  /**
   * A write meets a read-only file system, whatever the path, with the message
   * Node gives for one: its code, the system's description, the call and the
   * path. The description is read from Node itself rather than written here.
   */
  test("a write is refused as a read-only file system refuses it", async () => {
    const { getSystemErrorMessage } = await nodeModule<NodeUtil>("node:util");
    const { constants } = await nodeModule<NodeOs>("node:os");
    harness.posted.length = 0;
    await harness.send(execute(104, `import File
import Stdio
for path in ["out.txt", "/somewhere/else.txt"]
    let written = try
        File.writeTextBom!(path, "text")
        "written"
    catch
        File.FileError(File.Other(code), p, message) => "Other(\${code}) \${p} | \${message}"
        _ => "something else"
    Stdio.writeLine~(written)
`));
    const erofs = getSystemErrorMessage(-constants.errno.EROFS);
    expect(chunksAt(harness.posted, 104).map(({ text }) => text).join("")).toBe(
      `Other(EROFS) out.txt | EROFS: ${erofs}, open 'out.txt'\n` +
      `Other(EROFS) /somewhere/else.txt | EROFS: ${erofs}, open '/somewhere/else.txt'\n`,
    );
  }, 120_000);

  test("a status of 0 is not shown, and an uncaught failure shows as any throw does", async () => {
    harness.posted.length = 0;
    await harness.send(execute(101, "import Process\nProcess.setExitStatus~(0)\n"));
    expect(harness.posted.at(-1)).toEqual({ kind: "execute-success", version: 101, exitStatus: 0 });

    await harness.send(execute(102,
      "import File\nimport Process\nProcess.setExitStatus~(4)\nlet text = File.readText!(\"missing.txt\")\n",
    ));
    expect(failureAt(harness.posted, 102)).toBe("FileError: not found: missing.txt");
  }, 120_000);
});

/**
 * Standard input in the playground (`spec/program-io.md` §6, test 14): the
 * input box's text, read as a program run with `< input.txt` reads that file.
 * The box's own CRLF-to-LF conversion is the browser's, and is not modelled
 * here.
 */
describe("the playground reads the input box as standard input", () => {
  const PROGRAM = `import Stdio

let first = Stdio.readText~()
let second = Stdio.readText~()
Stdio.writeLine~("[\${first}] then [\${second}]")
`;

  /** The program's stdout under Node, with `input` in a file given as stdin. */
  async function underNode(input: string): Promise<string> {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await nodeModule<NodeFs>("node:fs");
    const { tmpdir } = await nodeModule<NodeOs>("node:os");
    const { join, dirname } = await nodeModule<NodePath>("node:path");
    const { spawnSync } = await nodeModule<NodeChildProcess>("node:child_process");
    const request = execute(200, PROGRAM);
    const root = mkdtempSync(join(tmpdir(), "playground-stdin-"));
    try {
      for (const module of request.modules) {
        const path = join(root, module.path.replace(/\.hex$/u, ".js"));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, module.javascript);
      }
      writeFileSync(join(root, "package.json"), '{"type":"module"}');
      writeFileSync(join(root, "input.txt"), input);
      const entry = join(root, request.entryPath.replace(/\.hex$/u, ".js"));
      const result = spawnSync("bash", ["-c", `"$0" "$1" < input.txt`, nodeProcess().execPath, entry], {
        cwd: root, encoding: "utf8",
      });
      expect(result.stderr).toBe("");
      return result.stdout;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test.each([
    ["some lines", "one\ntwo\n"],
    ["Unicode and a leading byte-order mark", "\uFEFFé😀\tx"],
    ["an empty box", ""],
  ])("%s print as they do under Node", async (_name, input) => {
    harness.posted.length = 0;
    await harness.send(execute(201, PROGRAM, input));
    const printed = chunksAt(harness.posted, 201).map(({ text }) => text).join("");
    expect(printed).toBe(`[${input.replace(/^\uFEFF/u, "")}] then []\n`);
    expect(harness.posted.at(-1)).toEqual({ kind: "execute-success", version: 201, exitStatus: 0 });
    expect(await underNode(input)).toBe(printed);
  }, 120_000);

  test("every run reads the box from its start", async () => {
    harness.posted.length = 0;
    const request = execute(202, PROGRAM, "again");
    await harness.send(request);
    await harness.send({ ...request, version: 203 });
    for (const version of [202, 203]) {
      expect(chunksAt(harness.posted, version).map(({ text }) => text).join("")).toBe("[again] then []\n");
    }
  }, 120_000);

  test("the lossy read answers the same text", async () => {
    harness.posted.length = 0;
    await harness.send(execute(204, "import Stdio\nStdio.write~(Stdio.readTextLossy~())\n", "a\r\nb"));
    expect(chunksAt(harness.posted, 204).map(({ text }) => text).join("")).toBe("a\r\nb");
  }, 120_000);
});
