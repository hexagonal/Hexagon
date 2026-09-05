import {
  Source,
  Typed,
  compileProject,
  emitJavaScript,
  emitTypeScriptPreview,
  type CompiledModule,
  type Diagnostics,
} from "../../compiler/src/index";

import type {
  CompilerResponse,
  TypeOccurrence,
  PlaygroundDiagnostic,
} from "./protocol";
import { bufferPath, layOutWorkspace, type WorkspaceLayout } from "./workspace";

/** Runs the platform-neutral compiler and adapts its result for the worker. */
export function compileSource(version: number, text: string): CompilerResponse {
  return compileWorkspace(version, layOutWorkspace(text));
}

/**
 * The module the Playground builds and runs — **the last one the buffer
 * declares**.
 *
 * Hexagon has no entry function and no privileged name: a host selects a root
 * module and running it means evaluating its emitted ESM (Modules §8.3). So the
 * Playground has to choose, and it chooses the rule the document already reads
 * by: the modules a buffer declares are read top to bottom, helpers first and
 * the program last, which is where the splitter's trailing `/main.hex` sat and
 * where every example puts `module Main`. Nothing consults the name — a buffer
 * whose last module is `module Demo` runs `Demo` — and nothing consults which
 * module holds top-level effects, since a helper may print too and a program
 * that prints nothing is still a program.
 *
 * Read off the parse rather than the compile order: `compileProject` answers
 * dependency-first, so a helper imported by the program is *returned* first
 * however the buffer is written.
 */
function rootModuleOf(
  modules: readonly CompiledModule[],
): CompiledModule | undefined {
  return modules
    .filter(({ source }) => source.path === bufferPath)
    .reduce<CompiledModule | undefined>(
      (last, module) =>
        last === undefined ||
          module.parsed.span.start.offset > last.parsed.span.start.offset
          ? module
          : last,
      undefined,
    );
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
  const root = rootModuleOf(project.modules);
  const outputs = project.modules.map((module) => ({
    module,
    javascript: emitJavaScript(module.core, {
      previewPrivateSpecializations: true,
      // Every module but the root, which nothing imports: the JS pane shows the
      // root's emission, and the reserved evidence handles exist for importers.
      exportInstanceEvidence: module !== root,
      // Re-emitting has to keep the runtime modules' placement, which only
      // `compileProject` knows: guessing it would give a runtime module
      // an importer's emission — no export list — and give every
      // consumer an import of a path that is not there. Both compile clean and
      // fail at load, which is the failure mode this pane exists to catch.
      runtimes: module.runtimes,
      // Carried for the same reason and with the same failure mode: only
      // `compileProject` knows the source common root and the stem §8.3's probe
      // settled there, so a re-emission that guessed would give a contested
      // module an import of a path that is not there (FFI Part 7 §1.2).
      runtimeGlobalsSpecifier: module.runtimeGlobalsSpecifier,
      // Third of the same kind (#679): Algorithm S's candidate rows for the
      // pre-registered constraints are a fact about the *prelude*, and a prelude
      // module sees only the members before its own seat — so a re-emission
      // that recomputed them would give the earlier prelude modules a smaller
      // edition set than the shipped emission gave them.
      fundamentalInstances: project.fundamentalInstances,
    }),
  }));
  const main = outputs.find(({ module }) => module === root);
  if (main === undefined) {
    return {
      kind: "compile-failure",
      version,
      diagnostics: [{
        severity: "error",
        message: "this buffer declares no module to run: write `module Main`",
        startOffset: 0,
        endOffset: 0,
      }],
    };
  }

  // The program's own candidate rows, not the preview's guess at them (#679):
  // Algorithm S's answer for a pre-registered constraint is a fact about the
  // prelude, and re-emitting one module alone would plan a different edition set
  // than the pane beside it shows.
  const preview = emitTypeScriptPreview(main.module.core, project.fundamentalInstances);
  // Diagnostics are anchored rather than mapped: every one of them has to be
  // shown, including the ones from a hosted library, which no buffer offset
  // covers. See `WorkspaceMap.anchor`.
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
    executionModules: [
      // The program's runtime module leads the set (FFI Part 7 §1.2). It belongs
      // to no source file, so nothing derived from `project.modules` can carry
      // it — and unlike `hex.d.ts` it is *executable*: a contested program whose
      // execution set is built from the compiled modules alone dies at its first
      // import. Keyed by the `.hex` path `resolveModulePath` derives from the
      // `./hex.js` specifier its importers spell, like every other entry here.
      ...(project.runtimeGlobals === undefined ? [] : [{
        path: project.runtimeGlobals.path.replace(/\.js$/u, ".hex"),
        javascript: project.runtimeGlobals.text,
      }]),
      // Keyed by the module's **layout** path (Packages §6) and not by the file
      // the buffer supplied it under: since #829 the emitted specifiers are
      // computed from the two modules' full names, so `linkModule` resolves
      // `"./Hex/Option.js"` and finds nothing under `/stdlib/Option.hex`. The
      // hosted library copies are exactly where the two disagree, and they are
      // the ones every program imports.
      ...outputs.map(({ module, javascript }) => ({
        path: module.path,
        javascript: javascript.text,
      })),
    ],
    // The entry, by the same key, so the worker looks it up where it was put.
    entryPath: main.module.path,
    generatedJavaScript: main.javascript.generatedSections,
    // The `.d.ts` accounting and §3.4's list come from the project's own
    // declarations rather than a re-emission: `compileProject` emitted them from
    // the same `fundamentalInstances` this pane's JavaScript was re-emitted
    // from, so the two halves of §10's report are the same plan read twice.
    //
    // They are the *ordinary* emission's declarations, so they carry no private
    // editions — the JavaScript beside them does, because this pane asks for
    // them. That asymmetry is a fact about the artefacts and is reported as one:
    // a private edition weighs its bytes in the module and publishes no face.
    generatedDeclarations: main.module.declarations.generatedSections,
    zeroEntryPointExports: main.module.declarations.zeroEntryPointExports,
    typeScriptPreview: preview.text,
    // Type occurrences are for the editor's buffer, so they cover what the user
    // wrote — every module the buffer declares, and nothing else. Asked of the
    // *file* rather than by classifying modules: the hosted library copies and
    // the compiler's injected sources are alike in the only way that matters
    // here, which is that no position in them is a position in the buffer.
    types: project.modules.flatMap(({ source, typed }) =>
      source.path === bufferPath ? collectBindingTypes(typed, mapOffset) : []
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
