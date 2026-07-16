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
  const bindings: InferredBinding[] = [];
  const seen = new Set<Typed.Binding["symbol"]>();
  const publish = (binding: Typed.Binding): void => {
    if (seen.has(binding.symbol)) return;
    seen.add(binding.symbol);
    bindings.push({
      name: binding.name,
      displayedType: Typed.displayScheme(binding.scheme),
      startOffset: binding.span.start.offset,
      endOffset: binding.span.end.offset,
    });
  };

  for (const item of module.items) {
    if (item.kind === "Let" || item.kind === "Fun") publish(item.binding);
    if (item.kind === "LetPattern") visitPatternBindings(item.pattern, publish);
  }
  return bindings;
}

function visitPatternBindings(
  pattern: Typed.Pattern,
  visit: (binding: Typed.Binding) => void,
): void {
  switch (pattern.kind) {
    case "Binding":
      visit(pattern.binding);
      return;
    case "As":
      visitPatternBindings(pattern.pattern, visit);
      visit(pattern.binding);
      return;
    case "Or":
      for (const alternative of pattern.alternatives) {
        visitPatternBindings(alternative, visit);
      }
      return;
    case "Tuple":
      for (const element of pattern.elements) visitPatternBindings(element, visit);
      return;
    case "Record":
      for (const field of pattern.fields) visitPatternBindings(field.pattern, visit);
      return;
    case "Constructor":
      for (const argument of pattern.arguments) visitPatternBindings(argument, visit);
      return;
    default:
      return;
  }
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
