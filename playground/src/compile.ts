import {
  Source,
  Typed,
  applyLayout,
  check,
  compileProject,
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
import { parseWorkspaceSource } from "./workspace-source";

/** Runs the platform-neutral compiler and adapts its result for the worker. */
export function compileSource(version: number, text: string): CompilerResponse {
  const workspace = parseWorkspaceSource(text);
  if (workspace.diagnostics.length > 0) {
    return {
      kind: "compile-failure",
      version,
      diagnostics: workspace.diagnostics,
    };
  }
  if (workspace.modules.length > 0) {
    return compileWorkspace(version, text, workspace);
  }

  const source = new Source.File(Source.fileId(0), "main.hex", text);
  const typed = check(resolve(parse(applyLayout(lex(source)))));
  const core = elaborate(typed);
  const javascript = emitJavaScript(core, { previewPrivateSpecializations: true });
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
    executionModules: [{ path: "/main.hex", javascript: javascript.text }],
    entryPath: "/main.hex",
    generatedJavaScript: javascript.generatedSections,
    typeScriptPreview: typeScriptPreview.text,
    types: inferredBindings(typed),
    diagnostics,
  };
}

function compileWorkspace(
  version: number,
  combinedSource: string,
  workspace: ReturnType<typeof parseWorkspaceSource>,
): CompilerResponse {
  const files = workspace.modules.map((module, index) =>
    new Source.File(Source.fileId(index), module.path, module.text)
  );
  const mainId = Source.fileId(files.length);
  files.push(new Source.File(mainId, "/main.hex", workspace.mainText));

  const project = compileProject(files);
  const outputs = project.modules.map((module) => ({
    module,
    javascript: emitJavaScript(module.core, { previewPrivateSpecializations: true }),
  }));
  const main = outputs.find(({ module }) => module.source.path === "/main.hex");
  if (main === undefined) {
    return {
      kind: "compile-failure",
      version,
      diagnostics: [{
        severity: "error",
        message: "playground workspace did not produce main.hex",
        startOffset: 0,
        endOffset: 0,
      }],
    };
  }

  const preview = emitTypeScriptPreview(main.module.core);
  const sourceOffsets = new Map<number, (offset: number) => number>();
  workspace.modules.forEach((module, index) => {
    sourceOffsets.set(index, (offset) => module.sourceOffset + offset);
  });
  sourceOffsets.set(Number(mainId), (offset) =>
    Math.max(0, Math.min(combinedSource.length, offset - workspace.mainPrefixLength))
  );
  const mapOffset = (fileId: Source.FileId, offset: number): number =>
    sourceOffsets.get(Number(fileId))?.(offset) ?? 0;
  const diagnostics = adaptDiagnostics([
    ...project.diagnostics,
    ...outputs.flatMap(({ javascript }) => javascript.diagnostics),
    ...preview.diagnostics,
  ], mapOffset);

  if (diagnostics.some(({ severity }) => severity === "error")) {
    return { kind: "compile-failure", version, diagnostics };
  }

  return {
    kind: "compile-success",
    version,
    javascript: main.javascript.text,
    executionModules: outputs.map(({ module, javascript }) => ({
      path: module.source.path,
      javascript: javascript.text,
    })),
    entryPath: "/main.hex",
    generatedJavaScript: main.javascript.generatedSections,
    typeScriptPreview: preview.text,
    types: project.modules.flatMap(({ typed }) => inferredBindings(typed, mapOffset)),
    diagnostics,
  };
}

function inferredBindings(
  module: Typed.Module,
  mapOffset: (fileId: Source.FileId, offset: number) => number = (_fileId, offset) => offset,
): readonly InferredBinding[] {
  const bindings: InferredBinding[] = [];
  const seen = new Set<Typed.Binding["symbol"]>();
  const publish = (binding: Typed.Binding): void => {
    if (seen.has(binding.symbol)) return;
    seen.add(binding.symbol);
    bindings.push({
      name: binding.name,
      displayedType: Typed.displayScheme(binding.scheme),
      startOffset: mapOffset(binding.span.fileId, binding.span.start.offset),
      endOffset: mapOffset(binding.span.fileId, binding.span.end.offset),
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
  mapOffset: (fileId: Source.FileId, offset: number) => number = (_fileId, offset) => offset,
): readonly PlaygroundDiagnostic[] {
  const seen = new Set<string>();
  const result: PlaygroundDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.severity,
      diagnostic.message,
      mapOffset(diagnostic.primary.fileId, diagnostic.primary.start.offset),
      mapOffset(diagnostic.primary.fileId, diagnostic.primary.end.offset),
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      severity: diagnostic.severity,
      message: diagnostic.message,
      startOffset: mapOffset(diagnostic.primary.fileId, diagnostic.primary.start.offset),
      endOffset: mapOffset(diagnostic.primary.fileId, diagnostic.primary.end.offset),
    });
  }

  return result;
}
