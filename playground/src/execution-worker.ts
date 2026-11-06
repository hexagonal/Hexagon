import { describeFailure, formatConsoleArguments } from "./execution";
import { installHost, NODE_STAND_INS, type OutputStream, type PlaygroundHost } from "./host-modules";
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
  const post = (stream: OutputStream, text: string): void => {
    const output: ExecuteOutput = { kind: "execute-output", version: request.version, stream, text };
    self.postMessage(output);
  };
  console.log = (...values: unknown[]) => {
    browserLog(...values);
    post("stdout", `${formatConsoleArguments(values)}\n`);
  };
  // The run's terminal, which the `node:fs` and `node:process` stand-ins reach
  // (`spec/program-io.md` §6). `Stdio`'s text arrives through the same `post`
  // as `Debug.log`'s lines, so the pane shows the two in the order written, and
  // its reads answer the input box's text, read from its start on every run.
  const host: PlaygroundHost = {
    write: post,
    exitCode: undefined,
    exited: undefined,
    input: new TextEncoder().encode(request.input),
    inputRead: 0,
  };
  installHost(host);

  const moduleUrls = new Map<string, string>();
  try {
    for (const [specifier, source] of NODE_STAND_INS) {
      moduleUrls.set(
        specifier,
        URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
      );
    }
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
      exitStatus: host.exitCode ?? 0,
    };
    self.postMessage(response);
  } catch (error: unknown) {
    // A program the stand-in `process.exit` ended has finished, with the
    // status it was given, however the throw that stopped it was wrapped.
    if (host.exited !== undefined) {
      const ended: ExecutionResponse = {
        kind: "execute-success",
        version: request.version,
        exitStatus: host.exited,
      };
      self.postMessage(ended);
      return;
    }
    // Shown as `Show<Exn>` shows it, so the pane reads `BadPattern: missing )`
    // where a program printing the same failure would.
    const response: ExecutionResponse = {
      kind: "execute-failure",
      version: request.version,
      message: describeFailure(error),
    };
    self.postMessage(response);
  } finally {
    for (const moduleUrl of moduleUrls.values()) URL.revokeObjectURL(moduleUrl);
  }
});
