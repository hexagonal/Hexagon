import { formatConsoleArguments } from "./execution";
import type {
  ExecuteOutput,
  ExecutionRequest,
  ExecutionResponse,
} from "./protocol";

/** Evaluates one emitted root module outside the compiler and UI workers. */
self.addEventListener("message", async (event: MessageEvent<ExecutionRequest>) => {
  const request = event.data;

  if (request.kind !== "execute") return;

  const browserLog = console.log.bind(console);
  console.log = (...values: unknown[]) => {
    browserLog(...values);
    const output: ExecuteOutput = {
      kind: "execute-output",
      version: request.version,
      line: formatConsoleArguments(values),
    };
    self.postMessage(output);
  };

  const moduleUrl = URL.createObjectURL(
    new Blob([request.javascript], { type: "text/javascript" }),
  );
  try {
    // A fresh Blob URL gives every explicit run normal ESM top-level semantics.
    // Console calls intentionally retain the worker's native browser console.
    await import(/* @vite-ignore */ moduleUrl);
    const response: ExecutionResponse = {
      kind: "execute-success",
      version: request.version,
    };
    self.postMessage(response);
  } catch (error: unknown) {
    const response: ExecutionResponse = {
      kind: "execute-failure",
      version: request.version,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
});
