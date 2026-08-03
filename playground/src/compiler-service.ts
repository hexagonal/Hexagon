/**
 * What the compiler worker does with a message, separated from being a worker.
 *
 * `compiler-worker.ts` is the part that reaches for `self`; everything with a
 * decision in it is here, so it can be exercised without a `Worker`.
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
 * Named as an interface only so a test can supply one that throws. Both halves
 * of this file promise that a fault becomes a reply rather than a silence, and a
 * promise about faults is worth exactly as much as the fault you can stage — so
 * both halves are injectable, including the compile.
 */
export type EditorAnalysis = Pick<
  PlaygroundAnalysis,
  "hover" | "definitions" | "references" | "codeActions" | "prepareRename" | "rename"
>;

export interface CompilerServiceParts {
  /**
   * Called once, not per request. A factory rather than an instance so that
   * "once" is something a test can count; injecting an instance would be used
   * the same number of times either way, which is why the lifetime went
   * unpinned until it was asked about.
   */
  readonly createAnalysis?: () => EditorAnalysis;
  readonly compile?: (version: number, source: string) => CompilerResponse;
}

/**
 * A service holding one session for the life of the worker.
 *
 * `compileSource` is one shot by design — the JS, `.d.ts` and Run panes want
 * whole-program output every time — but an editor request is one of many against
 * text that has usually not changed since the last one, and the session holds
 * its analysis until a file does. A session per request would still be correct,
 * since every request carries its own source; it would just recompile the
 * project on each one.
 */
export function createCompilerService(parts: CompilerServiceParts = {}): CompilerService {
  const analysis = (parts.createAnalysis ?? (() => new PlaygroundAnalysis()))();
  const compileWith = parts.compile ?? compileSource;
  return {
    handle: (request) =>
      request.kind === "compile"
        ? compile(compileWith, request.version, request.source)
        : serve(analysis, request),
  };
}

function compile(
  compileWith: (version: number, source: string) => CompilerResponse,
  version: number,
  source: string,
): CompilerResponse {
  try {
    return compileWith(version, source);
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
