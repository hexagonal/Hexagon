import type { ExecutionRequest, ExecutionResponse } from "./protocol";

/** Runs emitted programs separately from compilation.
 *
 * Execution remains disabled until the playground has an explicit sandbox,
 * timeout, module-loading, and host-capability policy. Keeping this worker
 * separate now prevents those concerns from entering the compiler worker.
 */
self.addEventListener("message", (event: MessageEvent<ExecutionRequest>) => {
  const request = event.data;

  if (request.kind !== "execute") return;

  const response: ExecutionResponse = {
    kind: "execute-failure",
    version: request.version,
    message: "Program execution is not available in the playground scaffold yet.",
    output: [],
  };

  self.postMessage(response);
});
