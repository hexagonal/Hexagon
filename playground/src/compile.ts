import {
  Source,
  Typed,
  applyLayout,
  check,
  elaborate,
  emitJavaScript,
  emitTypeScriptPreview,
  lex,
  parse,
  resolve,
  type Diagnostics,
} from "../../compiler/src/index";

import type {
  CompilerResponse,
  InferredBinding,
  PlaygroundDiagnostic,
} from "./protocol";

/** Runs the platform-neutral compiler and adapts its result for the worker. */
export function compileSource(version: number, text: string): CompilerResponse {
  const source = new Source.File(Source.fileId(0), "main.hex", text);
  const typed = check(resolve(parse(applyLayout(lex(source)))));
  const core = elaborate(typed);
  const javascript = emitJavaScript(core);
  const typeScriptPreview = emitTypeScriptPreview(core);
  const diagnostics = adaptDiagnostics([
    ...javascript.diagnostics,
    ...typeScriptPreview.diagnostics,
  ]);

  if (diagnostics.some(({ severity }) => severity === "error")) {
    return { kind: "compile-failure", version, diagnostics };
  }

  return {
    kind: "compile-success",
    version,
    javascript: javascript.text,
    typeScriptPreview: typeScriptPreview.text,
    types: inferredBindings(typed),
    diagnostics,
  };
}

function inferredBindings(module: Typed.Module): readonly InferredBinding[] {
  return module.items.flatMap((item) =>
    item.kind === "Let" || item.kind === "Fun"
      ? [
          {
            name: item.binding.name,
            displayedType: Typed.displayScheme(item.binding.scheme),
            startOffset: item.binding.span.start.offset,
            endOffset: item.binding.span.end.offset,
          },
        ]
      : [],
  );
}

function adaptDiagnostics(
  diagnostics: readonly Diagnostics.Diagnostic[],
): readonly PlaygroundDiagnostic[] {
  const seen = new Set<string>();
  const result: PlaygroundDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.severity,
      diagnostic.message,
      diagnostic.primary.fileId,
      diagnostic.primary.start.offset,
      diagnostic.primary.end.offset,
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      severity: diagnostic.severity,
      message: diagnostic.message,
      startOffset: diagnostic.primary.start.offset,
      endOffset: diagnostic.primary.end.offset,
    });
  }

  return result;
}
