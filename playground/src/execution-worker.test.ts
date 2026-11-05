import { beforeAll, describe, expect, test } from "vitest";

import { compileSource } from "./compile";
import type { ExecutionRequest, ExecutionResponse } from "./protocol";

/**
 * The execution worker's console contract, which #407 turned from an
 * incidental into something a program depends on.
 *
 * `Debug.log` is pure because it captures its sink when its module initializes
 * rather than reading `console.log` per call (`spec/effects.md` §6.2). The
 * worker replaces `console.log` to route a run's output into the results pane,
 * and it does so *before* importing the module graph — so what a probe captures
 * is the wrapper, which is the behaviour the Playground wants. Two things
 * follow, and both are asserted below: the ordering has to hold, and a second
 * run has to give the graph a second initialization, or its probe would still
 * be holding the first run's wrapper.
 *
 * The worker registers its listener on `self` at import time and builds module
 * URLs with `URL.createObjectURL`, neither of which the test environment
 * provides — and Node cannot `import()` a `blob:` URL at all. Both are stubbed
 * below. The object-URL stub answers a `data:` URL carrying a per-call counter,
 * which models the one property of blob URLs this file depends on: **every call
 * yields a distinct module identity**. That is the browser's guarantee, not the
 * worker's, and substituting bare `data:` URLs would model the opposite, since
 * the registry keys those by their text.
 */

interface WorkerHarness {
  readonly send: (request: ExecutionRequest) => Promise<void>;
  readonly posted: unknown[];
  readonly native: string[];
}

const harness: WorkerHarness = {
  send: () => Promise.reject(new Error("worker not loaded")),
  posted: [],
  native: [],
};

beforeAll(async () => {
  const host = globalThis as unknown as {
    self?: unknown;
    Blob: typeof Blob;
    URL: { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void };
    console: { log: (...values: unknown[]) => void };
  };

  const blobText = new WeakMap<object, string>();
  const OriginalBlob = host.Blob;
  host.Blob = class StubBlob {
    constructor(parts: readonly string[]) {
      blobText.set(this, parts.join(""));
    }
  } as unknown as typeof Blob;
  expect(OriginalBlob).toBeTypeOf("function");

  let objectUrls = 0;
  host.URL.createObjectURL = (blob: Blob): string => {
    objectUrls += 1;
    const text = blobText.get(blob as unknown as object) ?? "";
    return `data:text/javascript;charset=utf-8,${
      encodeURIComponent(`// object url ${objectUrls}\n${text}`)
    }`;
  };
  host.URL.revokeObjectURL = () => undefined;

  // Captured before the worker module is imported, because the worker binds its
  // own native sink at exactly that moment. Everything it writes through comes
  // here, run after run.
  const native: string[] = [];
  host.console.log = (...values: unknown[]) => {
    native.push(values.map((value) => String(value)).join(" "));
  };

  let handler: ((event: { data: ExecutionRequest }) => unknown) | undefined;
  const posted: unknown[] = [];
  host.self = {
    addEventListener: (_type: string, listener: (event: { data: ExecutionRequest }) => unknown) => {
      handler = listener;
    },
    postMessage: (message: unknown) => {
      posted.push(message);
    },
  };

  await import("./execution-worker");

  Object.assign(harness, {
    posted,
    native,
    send: async (request: ExecutionRequest): Promise<void> => {
      await handler!({ data: request });
    },
  });
});

/**
 * One compiled program, in the shape the worker is asked to run it.
 *
 * The header is written here rather than in each body below: since #829 every
 * buffer declares its module (Modules §2.1), and none of these tests is about
 * that — they are about what the worker does with the modules it is handed.
 */
function execute(version: number, source: string): ExecutionRequest {
  const compiled = compileSource(version, `module Main\n\n${source}`);
  expect(compiled.kind).toBe("compile-success");
  if (compiled.kind !== "compile-success") throw new Error("did not compile");
  return {
    kind: "execute",
    version,
    modules: compiled.executionModules,
    entryPath: compiled.entryPath,
  };
}

/** What this run posted to the pane, in order, as stream and text. */
function chunksAt(
  posted: readonly unknown[],
  version: number,
): readonly { readonly stream: string; readonly text: string }[] {
  return posted
    .filter((message): message is { kind: string; version: number; stream: string; text: string } =>
      typeof message === "object" && message !== null &&
      (message as { kind?: unknown }).kind === "execute-output"
    )
    .filter((message) => message.version === version)
    .map(({ stream, text }) => ({ stream, text }));
}

/** The lines this run's `Debug.log` calls posted to the UI, in order. */
function outputAt(posted: readonly unknown[], version: number): readonly string[] {
  return chunksAt(posted, version).map(({ text }) => text.endsWith("\n") ? text.slice(0, -1) : text);
}

describe("the results pane receives a run's output", () => {
  test("a `log` call arrives as one line, and the run succeeds", async () => {
    harness.posted.length = 0;
    harness.native.length = 0;

    await harness.send(execute(1, 'Debug.log("routed to the pane")\n'));

    expect(outputAt(harness.posted, 1)).toEqual(["routed to the pane"]);
    expect(harness.posted.at(-1)).toEqual(
      { kind: "execute-success", version: 1, exitStatus: 0 } satisfies ExecutionResponse,
    );
    // The worker keeps writing to the browser console as well, once per call.
    expect(harness.native).toEqual(["routed to the pane"]);
  });

  /**
   * The ordering contract. The wrapper is installed before the graph is
   * imported, so the sink `Debug.js` captures at initialization is the wrapper
   * and not the native console — which is why a probe reaches the pane at all.
   */
  test("a probe capturing at initialization captures the wrapper", async () => {
    harness.posted.length = 0;
    harness.native.length = 0;

    await harness.send(execute(2,
      "export let announce(message: String): Unit = Debug.log(message)\n" +
      'Debug.log("during initialization")\n',
    ));

    expect(outputAt(harness.posted, 2)).toEqual(["during initialization"]);
  });

  /**
   * The layering test, and the reason the native sink is captured at the
   * worker's own module scope. Taking it inside the handler would make each run
   * capture the previous run's wrapper: the second run's single `log` would post
   * twice — once under version 3, once under the stale version 2 — and a third
   * run would post three times. It would also mean the pane's output survived
   * only as long as nobody ran anything else.
   */
  test("two consecutive runs each post exactly once, under their own version", async () => {
    harness.posted.length = 0;
    harness.native.length = 0;

    await harness.send(execute(3, 'Debug.log("first run")\n'));
    await harness.send(execute(4, 'Debug.log("second run")\n'));

    expect(outputAt(harness.posted, 3)).toEqual(["first run"]);
    expect(outputAt(harness.posted, 4)).toEqual(["second run"]);
    expect(harness.native).toEqual(["first run", "second run"]);
  });

  /**
   * The staleness half of the same fact, from the probe's side. The second run
   * gets fresh object URLs, so `Debug.js` initializes again and captures the
   * second run's wrapper; a graph answered from the registry would still hold
   * the first run's, and this run's line would be posted under version 5.
   */
  test("a second run's output is not attributed to the first", async () => {
    harness.posted.length = 0;

    await harness.send(execute(5, 'Debug.log("run five")\n'));
    await harness.send(execute(6, 'Debug.log("run six")\n'));

    expect(outputAt(harness.posted, 5)).toEqual(["run five"]);
    expect(outputAt(harness.posted, 6)).toEqual(["run six"]);
  });
});

/** The failure this run posted to the UI, if it failed. */
function failureAt(posted: readonly unknown[], version: number): string | undefined {
  const failure = posted.find((message): message is { kind: string; version: number; message: string } =>
    typeof message === "object" && message !== null &&
    (message as { kind?: unknown }).kind === "execute-failure" &&
    (message as { version?: unknown }).version === version
  );
  return failure?.message;
}

/**
 * An uncaught throw reaches the pane as `Show<Exn>` would show it: its name,
 * then its message when it has one. The message alone used to stand here, which
 * dropped the name and left an exception without a `message` slot as nothing.
 */
describe("an uncaught throw is reported by name", () => {
  test("with its message, and after the lines printed before it", async () => {
    harness.posted.length = 0;

    await harness.send(execute(7,
      "exception BadPattern(message: String)\n" +
      'Debug.log("before the throw")\n' +
      'let boom: Int = throw^(BadPattern("missing )"))\n',
    ));

    expect(outputAt(harness.posted, 7)).toEqual(["before the throw"]);
    expect(failureAt(harness.posted, 7)).toBe("BadPattern: missing )");
  });

  test("as a fault's name and message, for a fault", async () => {
    harness.posted.length = 0;

    await harness.send(execute(10,
      "fault BadPatternFault(message: String)\n" +
      'let boom: Int = throw(BadPatternFault("missing )"))\n',
    ));

    expect(failureAt(harness.posted, 10)).toBe("BadPatternFault: missing )");
  });

  test("as its name alone when it has no message", async () => {
    harness.posted.length = 0;

    await harness.send(execute(8, "exception Oops\nlet boom: Int = throw^(Oops)\n"));

    expect(failureAt(harness.posted, 8)).toBe("Oops");
  });

  /**
   * The pane's line is the line `Show<Exn>` gives for the same value: each
   * program catches the throw once and logs it, then throws it uncaught. The
   * `toString` slot is the case JavaScript's own `error.toString()` would get
   * wrong, by calling a string; the thrown values are foreign throws that are
   * not `Error`s at all; and only the standard library's own `JsError`, built
   * before it is thrown, is seen through, and only once.
   */
  test.each([
    ["an exception with a message slot", "exception BadPattern(message: String)\n", 'BadPattern("missing )")', "BadPattern: missing )"],
    ["an exception with a toString slot", "exception Weird(toString: String, message: String)\n", 'Weird("x", "slot shadows")', "Weird: slot shadows"],
    ["a thrown string", "", 'JsError(JsValue.from("oops"))', "oops"],
    ["a thrown object", "", 'JsError(JsValue.from({ name = "X", message = "y" }))', "X: y"],
    ["a thrown object whose name is not a string", "", 'JsError(JsValue.from({ name = 42, message = "y" }))', "y"],
    ["a JsError built before it is thrown", 'let built = JsError(JsValue.from("late"))\n', "built", "late"],
    ["a JsError built around a JsError", 'let built = JsError(JsValue.from(JsError(JsValue.from("x"))))\n', "built", "JsError"],
    ["an exception of the program's own named JsError", "exception JsError(error: String)\n", 'JsError("payload")', "JsError"],
    ["a thrown function", "let thrown = (n: Int) => n + 1\n", "JsError(JsValue.from(thrown))", "thrown"],
  ])("as Show<Exn> shows it, for %s", async (_case, declarations, failure, expected) => {
    harness.posted.length = 0;

    await harness.send(execute(9,
      declarations +
      `let caught = try\n    throw^(${failure})\ncatch\n    error => "\${error}"\n` +
      "Debug.log(caught)\n" +
      `let boom: Int = throw^(${failure})\n`,
    ));

    expect(outputAt(harness.posted, 9)).toEqual([expected]);
    expect(failureAt(harness.posted, 9)).toBe(expected);
  });
});

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
Stdio.writeError~("to stderr ")
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
      "stdout", "stdout", "stdout", "stderr", "stderr", "stdout", "stdout",
    ]);
    expect(playgroundOut).toBe(
      "a probe line\npartial then whole\narguments: 0\n" +
      "NotFound input.txt | not found: input.txt\n",
    );
    expect(playgroundErr).toBe("to stderr with a line\n");
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
