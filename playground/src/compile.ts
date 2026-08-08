import {
  Source,
  Typed,
  compileProject,
  emitJavaScript,
  emitTypeScriptPreview,
  isInjectedModule,
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
      // Re-emitting has to keep the runtime modules' placement, which only
      // `compileProject` knows: guessing it would give a runtime module
      // an importer's emission — no export list — and give every
      // consumer an import of a path that is not there. Both compile clean and
      // fail at load, which is the failure mode this pane exists to catch.
      runtimes: module.runtimes,
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
    // Type occurrences are for the editor's buffer, so they cover what the user
    // wrote: the hosted `/stdlib/` copies are out, and so is anything the
    // compiler injected — the trie runtime is real source with real bindings
    // (`radix`, `empty`, `nodeRun`) that belong to no position in the buffer.
    types: project.modules.flatMap(({ source, typed }) =>
      source.path.startsWith("/stdlib/") || isInjectedModule(source.path)
        ? []
        : collectBindingTypes(typed, mapOffset)
    ),
    diagnostics,
  };
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
