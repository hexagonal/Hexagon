import { expect } from "vitest";

import { compileSource } from "./compile";
import type { ExecutionRequest } from "./protocol";

/**
 * The execution worker, loaded into the test environment, for the test files
 * that run programs through it. Each file calls `installWorkerHarness` in its
 * own `beforeAll`, and vitest gives each file a process of its own: every run
 * imports its modules under fresh URLs that the module registry keeps, so one
 * file's runs would otherwise add up.
 *
 * The worker registers its listener on `self` at import time and builds module
 * URLs with `URL.createObjectURL`, neither of which the test environment
 * provides — and Node cannot `import()` a `blob:` URL at all. Both are stubbed
 * below. The object-URL stub answers a `data:` URL carrying a per-call counter,
 * which models the one property of blob URLs these tests depend on: **every
 * call yields a distinct module identity**. That is the browser's guarantee,
 * not the worker's, and substituting bare `data:` URLs would model the
 * opposite, since the registry keys those by their text.
 */

export interface WorkerHarness {
  readonly send: (request: ExecutionRequest) => Promise<void>;
  readonly posted: unknown[];
  readonly native: string[];
}

export const harness: WorkerHarness = {
  send: () => Promise.reject(new Error("worker not loaded")),
  posted: [],
  native: [],
};

/** Stubs what the worker needs, then loads it and points `harness` at it. */
export async function installWorkerHarness(): Promise<void> {
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
}

/**
 * One compiled program, in the shape the worker is asked to run it.
 *
 * The header is written here rather than in each body below: since #829 every
 * buffer declares its module (Modules §2.1), and none of these tests is about
 * that — they are about what the worker does with the modules it is handed.
 */
export function execute(version: number, source: string): ExecutionRequest {
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
export function chunksAt(
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
export function outputAt(posted: readonly unknown[], version: number): readonly string[] {
  return chunksAt(posted, version).map(({ text }) => text.endsWith("\n") ? text.slice(0, -1) : text);
}

/** The failure this run posted to the UI, if it failed. */
export function failureAt(posted: readonly unknown[], version: number): string | undefined {
  const failure = posted.find((message): message is { kind: string; version: number; message: string } =>
    typeof message === "object" && message !== null &&
    (message as { kind?: unknown }).kind === "execute-failure" &&
    (message as { version?: unknown }).version === version
  );
  return failure?.message;
}
