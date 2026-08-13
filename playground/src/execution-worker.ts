import { formatConsoleArguments } from "./execution";
import { linkModule } from "./module-execution";
import type {
  ExecuteOutput,
  ExecutionRequest,
  ExecutionResponse,
} from "./protocol";

/**
 * The worker's own console, captured **once**, before any run has wrapped it.
 *
 * Taken here rather than inside the handler because the handler's wrapper is
 * what it would otherwise capture: a second run would route through the first
 * run's wrapper, which posts under the first run's version, and the layers
 * would accumulate one deep per execution.
 */
const browserLog = console.log.bind(console);

/** Evaluates one emitted root module outside the compiler and UI workers. */
self.addEventListener("message", async (event: MessageEvent<ExecutionRequest>) => {
  const request = event.data;

  if (request.kind !== "execute") return;

  // Before the modules are built, and before they are imported. A probe that
  // captures its sink at initialization — `Debug.log` does, by the ruling that
  // makes it pure — captures whatever is standing when its module first
  // evaluates, which is this wrapper. The ordering is the contract that puts
  // a program's output in the results pane.
  console.log = (...values: unknown[]) => {
    browserLog(...values);
    const output: ExecuteOutput = {
      kind: "execute-output",
      version: request.version,
      line: formatConsoleArguments(values),
    };
    self.postMessage(output);
  };

  const moduleUrls = new Map<string, string>();
  try {
    for (const module of request.modules) {
      const linked = linkModule(module.javascript, module.path, moduleUrls);
      moduleUrls.set(
        module.path,
        URL.createObjectURL(new Blob([linked], { type: "text/javascript" })),
      );
    }
    const moduleUrl = moduleUrls.get(request.entryPath);
    if (moduleUrl === undefined) throw new Error(`missing entry module ${request.entryPath}`);
    // A fresh Blob URL gives every explicit run normal ESM top-level semantics:
    // each `createObjectURL` is a new module identity, so the graph is rebuilt
    // rather than answered from the registry, and a module that captured
    // something at initialization captures it again against this run's wrapper.
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
    for (const moduleUrl of moduleUrls.values()) URL.revokeObjectURL(moduleUrl);
  }
});
