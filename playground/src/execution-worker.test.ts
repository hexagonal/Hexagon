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

/** One compiled program, in the shape the worker is asked to run it. */
function execute(version: number, source: string): ExecutionRequest {
  const compiled = compileSource(version, source);
  expect(compiled.kind).toBe("compile-success");
  if (compiled.kind !== "compile-success") throw new Error("did not compile");
  return {
    kind: "execute",
    version,
    modules: compiled.executionModules,
    entryPath: compiled.entryPath,
  };
}

/** The lines this run posted to the UI, in order. */
function outputAt(posted: readonly unknown[], version: number): readonly string[] {
  return posted
    .filter((message): message is { kind: string; version: number; line: string } =>
      typeof message === "object" && message !== null &&
      (message as { kind?: unknown }).kind === "execute-output"
    )
    .filter((message) => message.version === version)
    .map(({ line }) => line);
}

describe("the results pane receives a run's output", () => {
  test("a `log` call arrives as one line, and the run succeeds", async () => {
    harness.posted.length = 0;
    harness.native.length = 0;

    await harness.send(execute(1, 'Debug.log("routed to the pane")\n'));

    expect(outputAt(harness.posted, 1)).toEqual(["routed to the pane"]);
    expect(harness.posted.at(-1)).toEqual(
      { kind: "execute-success", version: 1 } satisfies ExecutionResponse,
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
