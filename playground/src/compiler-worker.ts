import type {
  CompilerRequest,
  CompilerResponse,
  ServiceReplyMessage,
} from "./protocol";
import { compileSource } from "./compile";
import { PlaygroundAnalysis } from "./analysis";

/**
 * The session, kept across messages.
 *
 * This is the whole reason the worker has state now. `compileSource` is one shot
 * by design — the JS, `.d.ts` and run panes want whole-program output every time
 * — but an editor request is one of many against text that has usually not
 * changed since the last one, and the session holds its analysis until a file
 * does change.
 */
const analysis = new PlaygroundAnalysis();

/** Owns browser-side compiler state without routing local work through LSP. */
self.addEventListener("message", (event: MessageEvent<CompilerRequest>) => {
  const request = event.data;

  if (request.kind === "compile") {
    self.postMessage(compile(request.version, request.source));
    return;
  }

  self.postMessage(serve(request));
});

function compile(version: number, source: string): CompilerResponse {
  try {
    return compileSource(version, source);
  } catch (error) {
    return {
      kind: "compile-failure",
      version,
      diagnostics: [
        {
          severity: "error",
          message: `Internal compiler error: ${describeError(error)}`,
          startOffset: 0,
          endOffset: 0,
        },
      ],
    };
  }
}

/**
 * One editor request, answered.
 *
 * A thrown error becomes a failure reply rather than an unhandled rejection in
 * the worker: the caller is holding a promise Monaco is waiting on, and a reply
 * that never arrives is an editor that stops answering after the first fault.
 */
function serve(
  request: Exclude<CompilerRequest, { readonly kind: "compile" }>,
): ServiceReplyMessage {
  const { id, version } = request;
  try {
    switch (request.kind) {
      case "hover":
        return {
          kind: "hover",
          id,
          version,
          hover: analysis.hover(request.source, request.offset),
        };
      case "code-actions":
        return {
          kind: "code-actions",
          id,
          version,
          actions: analysis.codeActions(request.source, request),
        };
      case "definition":
        return {
          kind: "definition",
          id,
          version,
          ranges: analysis.definitions(request.source, request.offset),
        };
      case "references":
        return {
          kind: "references",
          id,
          version,
          ranges: analysis.references(request.source, request.offset),
        };
      case "prepare-rename":
        return {
          kind: "prepare-rename",
          id,
          version,
          subject: analysis.prepareRename(request.source, request.offset),
        };
      case "rename":
        return {
          kind: "rename",
          id,
          version,
          result: analysis.rename(request.source, request.offset, request.newName),
        };
    }
  } catch (error) {
    return { kind: "service-failure", id, version, message: describeError(error) };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
