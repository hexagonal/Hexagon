import type { CompilerRequest } from "./protocol";
import { createCompilerService } from "./compiler-service";

/**
 * Owns browser-side compiler state without routing local work through LSP.
 *
 * Everything with a decision in it is in `compiler-service.ts`; this file is the
 * part that cannot be tested without a `Worker`, and it is kept to the size
 * where reading it is enough.
 */
const service = createCompilerService();

self.addEventListener("message", (event: MessageEvent<CompilerRequest>) => {
  self.postMessage(service.handle(event.data));
});
