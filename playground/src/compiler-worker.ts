import type { CompilerRequest, CompilerResponse } from "./protocol";
import { compileSource } from "./compile";

/** Owns browser-side compiler state without routing local work through LSP. */
self.addEventListener("message", (event: MessageEvent<CompilerRequest>) => {
  const request = event.data;

  if (request.kind !== "compile") return;

  let response: CompilerResponse;
  try {
    response = compileSource(request.version, request.source);
  } catch (error) {
    response = {
      kind: "compile-failure",
      version: request.version,
      diagnostics: [
        {
          severity: "error",
          message:
            error instanceof Error
              ? `Internal compiler error: ${error.message}`
              : "Internal compiler error",
          startOffset: 0,
          endOffset: 0,
        },
      ],
    };
  }

  self.postMessage(response);
});
