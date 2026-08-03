/**
 * What the compiler worker does with a message, separated from being a worker.
 *
 * `compiler-worker.ts` is the four lines that reach for `self`; everything with
 * a decision in it is here, so it can be exercised without a `Worker` and a DOM.
 * That split exists because this layer's guarantees — that every request is
 * answered, that a thrown error becomes a reply rather than a silence — are the
 * kind that read as obviously true and are not.
 */

import type {
  CompilerRequest,
  CompilerResponse,
  ServiceReplyMessage,
} from "./protocol";
import { compileSource } from "./compile";
import { PlaygroundAnalysis } from "./analysis";

export interface CompilerService {
  handle(request: CompilerRequest): CompilerResponse | ServiceReplyMessage;
}

/**
 * The editor half of a session, as this file needs it.
 *
 * Named as an interface only so a test can supply one that throws. `serve`'s
 * promise is that a fault becomes a reply rather than a silence, and a promise
 * about faults is worth exactly as much as the fault you can stage.
 */
export type EditorAnalysis = Pick<
  PlaygroundAnalysis,
  "hover" | "definitions" | "references" | "codeActions" | "prepareRename" | "rename"
>;

/**
 * A service holding one session for the life of the worker.
 *
 * `compileSource` is one shot by design — the JS, `.d.ts` and Run panes want
 * whole-program output every time — but an editor request is one of many against
 * text that has usually not changed since the last one, and the session holds
 * its analysis until a file does.
 */
export function createCompilerService(
  analysis: EditorAnalysis = new PlaygroundAnalysis(),
): CompilerService {
  return {
    handle: (request) =>
      request.kind === "compile"
        ? compile(request.version, request.source)
        : serve(analysis, request),
  };
}

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
 * A thrown error becomes a failure reply rather than an unhandled rejection: the
 * caller is holding a promise Monaco is waiting on, and a reply that never
 * arrives is an editor that stops answering after the first fault.
 */
function serve(
  analysis: EditorAnalysis,
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
