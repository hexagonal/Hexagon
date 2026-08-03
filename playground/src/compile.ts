import {
  Source,
  Typed,
  compileProject,
  emitJavaScript,
  emitTypeScriptPreview,
  collectTypeOccurrences,
  type Diagnostics,
} from "../../compiler/src/index";

import type {
  CompilerResponse,
  TypeOccurrence,
  PlaygroundDiagnostic,
} from "./protocol";
import { entryPath, layOutWorkspace, type WorkspaceLayout } from "./workspace";

/** Runs the platform-neutral compiler and adapts its result for the worker. */
export function compileSource(version: number, text: string): CompilerResponse {
  const layout = layOutWorkspace(text);
  if (layout.diagnostics.length > 0) {
    return {
      kind: "compile-failure",
      version,
      diagnostics: layout.diagnostics,
    };
  }
  return compileWorkspace(version, layout);
}

function compileWorkspace(
  version: number,
  layout: WorkspaceLayout,
): CompilerResponse {
  const files = layout.files.map(({ path, source }, index) =>
    new Source.File(Source.fileId(index), path, source)
  );
  const pathsByFileId = new Map(
    files.map(({ id, path }) => [Number(id), path] as const),
  );

  const project = compileProject(files);
  const outputs = project.modules.map((module) => ({
    module,
    javascript: emitJavaScript(module.core, {
      previewPrivateSpecializations: true,
      exportInstanceEvidence: module.source.path !== entryPath,
    }),
  }));
  const main = outputs.find(({ module }) => module.source.path === entryPath);
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
  // Diagnostics are anchored rather than mapped: every one of them has to be
  // shown, including the ones from a hosted library or the synthesized import
  // prefix, which no buffer offset covers. See `WorkspaceMap.anchor`.
  const mapOffset = (fileId: Source.FileId, offset: number): number =>
    layout.map.anchor(pathsByFileId.get(Number(fileId)) ?? "", offset);
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
    entryPath,
    generatedJavaScript: main.javascript.generatedSections,
    typeScriptPreview: preview.text,
    types: project.modules.flatMap(({ source, typed }) =>
      source.path.startsWith("/stdlib/") ? [] : collectBindingTypes(typed, mapOffset)
    ),
    typeOccurrences: project.modules.flatMap(({ source, typed }) =>
      source.path.startsWith("/stdlib/") ? [] : adaptTypeOccurrences(typed, mapOffset)
    ),
    diagnostics,
  };
}

function adaptTypeOccurrences(
  module: Typed.Module,
  mapOffset: (fileId: Source.FileId, offset: number) => number = (_fileId, offset) => offset,
): readonly TypeOccurrence[] {
  return collectTypeOccurrences(module).map(({ name, displayedType, span }) => ({
    name,
    displayedType,
    startOffset: mapOffset(span.fileId, span.start.offset),
    endOffset: mapOffset(span.fileId, span.end.offset),
  }));
}

function collectBindingTypes(
  module: Typed.Module,
  mapOffset: (fileId: Source.FileId, offset: number) => number = (_fileId, offset) => offset,
): readonly TypeOccurrence[] {
  const bindings: TypeOccurrence[] = [];
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
