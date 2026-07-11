import type { CompilerRequest, CompilerResponse } from "./protocol";

/** Owns browser-side compiler state.
 *
 * The real worker will keep a persistent compiler analysis session so edits
 * can invalidate only affected work. This placeholder reports the missing
 * compiler explicitly instead of pretending that a surface form is supported.
 */
self.addEventListener("message", (event: MessageEvent<CompilerRequest>) => {
  const request = event.data;

  if (request.kind !== "compile") return;

  const response: CompilerResponse = {
    kind: "compile-failure",
    version: request.version,
    diagnostics: [
      {
        severity: "information",
        message: "The Hexagon compiler has not been connected to the playground yet.",
        startOffset: 0,
        endOffset: 0,
      },
    ],
  };

  self.postMessage(response);
});
