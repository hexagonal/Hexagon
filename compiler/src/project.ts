/** Whole-project orchestration for Hexagon's acyclic relative module graph. */

import * as Diagnostics from "./support/diagnostics.js";
import * as Source from "./support/source.js";
import type * as Parsed from "./syntax/parsed/index.js";
import type * as Resolved from "./syntax/resolved/index.js";
import type * as Typed from "./syntax/typed/index.js";
import type * as Core from "./syntax/core/index.js";
import type * as Emitted from "./emission/index.js";
import { lex } from "./passes/lexer/lexer.js";
import { applyLayout } from "./passes/layout/layout.js";
import { parse } from "./passes/parser/parser.js";
import { moduleInterface, resolve } from "./passes/resolver/resolver.js";
import { check } from "./passes/checker/checker.js";
import { elaborate } from "./passes/elaborator/elaborator.js";
import { emitDeclarations, emitJavaScript } from "./passes/emitter/emitter.js";
import type { PreludeImport } from "./passes/resolver/resolver.js";
import { PRELUDE_MODULES } from "./prelude.js";

export interface CompiledModule {
  readonly source: Source.File;
  readonly parsed: Parsed.Module;
  readonly resolved: Resolved.Module;
  readonly typed: Typed.Module;
  readonly core: Core.Module;
  readonly javascript: Emitted.JavaScript;
  readonly declarations: Emitted.Declarations;
}

export interface CompiledProject {
  readonly modules: readonly CompiledModule[];
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}

/** Compiles every supplied file in dependency-first order without filesystem access. */
export function compileProject(files: readonly Source.File[]): CompiledProject {
  const diagnostics = new Diagnostics.Bag();
  const sources = new Map(files.map((file) => [normalizePath(file.path), file]));
  const preludePaths = injectPrelude(sources);
  const preludeSet = new Set(preludePaths);
  const parsed = new Map<string, Parsed.Module>();
  for (const [path, file] of sources) {
    parsed.set(path, parse(applyLayout(lex(file))));
  }

  const ordered: string[] = [];
  const visiting: string[] = [];
  const visited = new Set<string>();
  const visit = (path: string): void => {
    if (visited.has(path)) return;
    const cycleStart = visiting.indexOf(path);
    if (cycleStart >= 0) {
      const module = parsed.get(path);
      if (module !== undefined) {
        diagnostics.add({
          severity: "error",
          message: `import cycle: ${[...visiting.slice(cycleStart), path].join(" -> ")}`,
          primary: module.span,
        });
      }
      return;
    }
    const module = parsed.get(path);
    if (module === undefined) return;
    visiting.push(path);
    for (const item of module.items) {
      if (
        (item.kind === "ExternBlock" || item.kind === "ExternImport") &&
        (item.specifier.startsWith("./") || item.specifier.startsWith("../")) &&
        sources.has(resolveSpecifier(path, item.specifier))
      ) {
        diagnostics.add({
          severity: "error",
          message: "use `import` for Hexagon modules; `extern from` is for foreign JavaScript",
          primary: item.span,
        });
        continue;
      }
      if (item.kind !== "Import") continue;
      const target = resolveSpecifier(path, item.specifier);
      if (!sources.has(target)) {
        diagnostics.add({
          severity: "error",
          message: `cannot resolve module \`${item.specifier}\` from \`${path}\``,
          primary: item.span,
        });
      } else {
        visit(target);
      }
    }
    visiting.pop();
    visited.add(path);
    ordered.push(path);
  };
  for (const path of sources.keys()) visit(path);
  // Prelude modules compile before their consumers, and their identities live in a
  // reserved high range so consumer ids stay stable whether or not a prelude is present.
  for (const path of preludePaths) {
    const index = ordered.indexOf(path);
    if (index >= 0) ordered.splice(index, 1);
  }
  ordered.unshift(...preludePaths);

  const compiled = new Map<string, CompiledModule>();
  let symbolBase = 0;
  let unionBase = 0;
  let recordBase = 0;
  let externTypeBase = 0;
  let preludeSymbolBase = PRELUDE_ID_BASE;
  let preludeUnionBase = PRELUDE_ID_BASE;
  let preludeRecordBase = PRELUDE_ID_BASE;
  let preludeExternTypeBase = PRELUDE_ID_BASE;
  for (const path of ordered) {
    const isPrelude = preludeSet.has(path);
    const source = sources.get(path)!;
    const parsedModule = parsed.get(path)!;
    const imports = new Map<string, ReturnType<typeof moduleInterface>>();
    const importedSchemes = new Map<Resolved.SymbolId, Typed.Scheme>();
    for (const item of parsedModule.items) {
      if (item.kind !== "Import") continue;
      const dependency = compiled.get(resolveSpecifier(path, item.specifier));
      if (dependency === undefined) continue;
      imports.set(item.specifier, moduleInterface(dependency.resolved));
      for (const symbol of dependency.typed.symbols) {
        importedSchemes.set(symbol.id, symbol.scheme);
      }
    }
    // Consumers see every compiled prelude module; prelude modules see none (no
    // self-injection, and they do not depend on one another).
    const preludeImports: PreludeImport[] = isPrelude ? [] : preludePaths.flatMap((preludePath) => {
      const preludeCompiled = compiled.get(preludePath);
      if (preludeCompiled === undefined) return [];
      for (const symbol of preludeCompiled.typed.symbols) {
        importedSchemes.set(symbol.id, symbol.scheme);
      }
      return [{
        interface: moduleInterface(preludeCompiled.resolved),
        specifier: relativeSpecifier(path, preludePath),
      }];
    });
    const resolved = resolve(parsedModule, {
      imports,
      symbolBase: isPrelude ? preludeSymbolBase : symbolBase,
      unionBase: isPrelude ? preludeUnionBase : unionBase,
      recordBase: isPrelude ? preludeRecordBase : recordBase,
      externTypeBase: isPrelude ? preludeExternTypeBase : externTypeBase,
      ...(preludeImports.length === 0 ? {} : { prelude: preludeImports }),
    });
    if (isPrelude) {
      preludeSymbolBase = nextId(resolved.symbols.map(({ id }) => Number(id)), preludeSymbolBase);
      preludeUnionBase = nextId(resolved.unions.map(({ id }) => Number(id)), preludeUnionBase);
      preludeRecordBase = nextId(resolved.records.map(({ id }) => Number(id)), preludeRecordBase);
      preludeExternTypeBase = nextId(
        resolved.externTypes.map(({ externType }) => Number(externType)),
        preludeExternTypeBase,
      );
    } else {
      // Prelude identities are reserved above PRELUDE_ID_BASE; excluding them keeps
      // each consumer's own id range identical to a prelude-free compilation.
      const local = (id: number): boolean => id < PRELUDE_ID_BASE;
      symbolBase = nextId(resolved.symbols.map(({ id }) => Number(id)).filter(local), symbolBase);
      unionBase = nextId(resolved.unions.map(({ id }) => Number(id)).filter(local), unionBase);
      recordBase = nextId(resolved.records.map(({ id }) => Number(id)).filter(local), recordBase);
      externTypeBase = nextId(
        resolved.externTypes.map(({ externType }) => Number(externType)).filter(local),
        externTypeBase,
      );
    }
    const typed = check(resolved, { importedSchemes });
    const core = elaborate(typed);
    const result: CompiledModule = {
      source,
      parsed: parsedModule,
      resolved,
      typed,
      core,
      javascript: emitJavaScript(core, { exportInstanceEvidence: true }),
      declarations: emitDeclarations(core),
    };
    compiled.set(path, result);
  }

  // Surface every module's own diagnostics on the project. `typed` accumulates
  // the lexing, layout, parsing, resolution, and checking stages; emission adds
  // its own. Without this a module that fails to compile reports success and
  // its broken JavaScript is handed back silently.
  for (const path of ordered) {
    const module = compiled.get(path);
    if (module === undefined) continue;
    for (const diagnostic of module.typed.diagnostics) diagnostics.add(diagnostic);
    for (const diagnostic of module.javascript.diagnostics) diagnostics.add(diagnostic);
  }

  // Emit a prelude module only when some consumer imports from it, so a project
  // that never touches its nominals is unchanged by the prelude's existence.
  const preludeUsed = (preludePath: string): boolean => ordered.some((path) =>
    !preludeSet.has(path) &&
    (compiled.get(path)?.resolved.items ?? []).some((item) =>
      item.kind === "Import" && resolveSpecifier(path, item.specifier) === preludePath
    )
  );

  return {
    modules: ordered.flatMap((path) => {
      if (preludeSet.has(path) && !preludeUsed(path)) return [];
      const module = compiled.get(path);
      return module === undefined ? [] : [module];
    }),
    diagnostics: diagnostics.toArray(),
  };
}

/** Reserved id floor for prelude identities, above any realistic per-project count. */
const PRELUDE_ID_BASE = 1_000_000;

function nextId(ids: readonly number[], fallback: number): number {
  return ids.length === 0 ? fallback : Math.max(fallback, ...ids.map((id) => id + 1));
}

/**
 * Injects each implicit prelude module at the common root of the project's
 * sources, unless the project already supplies a file there (e.g. compiling the
 * stdlib itself, where the on-disk copy wins). Returns the normalized prelude
 * paths in compilation order; empty for an empty project.
 */
function injectPrelude(sources: Map<string, Source.File>): readonly string[] {
  const paths = [...sources.keys()];
  if (paths.length === 0) return [];
  const root = commonRoot(paths);
  // Prefer a project file that already provides a prelude module (by basename,
  // wherever it lives — e.g. /stdlib/Option.hex), so the embedded fallback never
  // creates a duplicate that would collide with the project's own declarations.
  const existingByBasename = new Map<string, string>();
  for (const path of paths) {
    const basename = path.slice(path.lastIndexOf("/") + 1);
    if (!existingByBasename.has(basename)) existingByBasename.set(basename, path);
  }
  let maxId = Math.max(-1, ...[...sources.values()].map((file) => Number(file.id)));
  return PRELUDE_MODULES.map((module) => {
    const existing = existingByBasename.get(module.basename);
    if (existing !== undefined) return existing;
    const path = normalizePath(`${root}/${module.basename}`);
    maxId += 1;
    sources.set(path, new Source.File(Source.fileId(maxId), path, module.source));
    return path;
  });
}

/** Longest shared directory prefix of the given file paths. */
function commonRoot(paths: readonly string[]): string {
  const directories = paths.map((path) => path.split("/").slice(0, -1));
  let common = directories[0] ?? [];
  for (const parts of directories.slice(1)) {
    let index = 0;
    while (index < common.length && index < parts.length && common[index] === parts[index]) {
      index += 1;
    }
    common = common.slice(0, index);
  }
  return common.join("/");
}

/** A relative specifier `from` a module to the `to` path, inverse to resolveSpecifier. */
function relativeSpecifier(from: string, to: string): string {
  const fromDirectory = from.split("/").slice(0, -1).filter((part) => part !== "");
  const toParts = to.replace(/\.hex$/, "").split("/").filter((part) => part !== "");
  let index = 0;
  while (
    index < fromDirectory.length &&
    index < toParts.length - 1 &&
    fromDirectory[index] === toParts[index]
  ) {
    index += 1;
  }
  const up = fromDirectory.length - index;
  const down = toParts.slice(index).join("/");
  return up > 0 ? `${"../".repeat(up)}${down}` : `./${down}`;
}

function resolveSpecifier(importer: string, specifier: string): string {
  const directory = importer.slice(0, Math.max(0, importer.lastIndexOf("/")));
  const candidate = normalizePath(`${directory}/${specifier}`);
  return candidate.endsWith(".hex") ? candidate : `${candidate}.hex`;
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}
