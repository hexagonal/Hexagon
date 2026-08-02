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
import {
  emitDeclarations,
  emitJavaScript,
  emittedModuleSpecifier,
  runtimeDeclarationsText,
  RUNTIME_DECLARATIONS_STEM,
} from "./passes/emitter/emitter.js";
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
  /**
   * The program's runtime declaration module (FFI Part 1 §8.3), or `undefined`
   * when no generated `.d.ts` mentions a `Hex.*` face.
   *
   * This is the first emission artefact belonging to no source file, which is
   * why it sits beside `modules` rather than inside one: the compiled project
   * was strictly per-module until §8.3 needed a program-scoped seat, and
   * obligation 3 is what grows it. The compile stays filesystem-free — the
   * artefact carries its intended path and a host performs the write.
   */
  readonly runtimeDeclarations: Emitted.RuntimeDeclarations | undefined;
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}

export interface ProjectOptions {
  /**
   * Paths compiled as privileged **runtime** modules — the ones allowed to spell
   * `Node(a)` (`resolve`'s `runtime` flag). Separate from prelude privilege,
   * which follows the injection path. A runtime module still sees the prelude,
   * which is what lets it name `Bool` at all since #147 made `Bool` a prelude
   * declaration rather than a primitive.
   */
  readonly runtimePaths?: readonly string[];
}

/** Compiles every supplied file in dependency-first order without filesystem access. */
export function compileProject(
  files: readonly Source.File[],
  options: ProjectOptions = {},
): CompiledProject {
  const runtimePaths = new Set((options.runtimePaths ?? []).map(normalizePath));
  const diagnostics = new Diagnostics.Bag();
  const sources = new Map(files.map((file) => [normalizePath(file.path), file]));
  const root = commonRoot([...sources.keys()]);
  const preludePaths = injectPrelude(sources, root);
  const preludeSet = new Set(preludePaths);
  // The runtime declaration module's basename, settled before any module is
  // emitted because every importer has to spell the same one (FFI Part 1 §8.3).
  const runtimeBasename = runtimeDeclarationsBasename(sources.keys(), root);
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
  // Every nominal the program has resolved, dependencies first. `ordered` is a
  // topological order and imports are acyclic (Modules §8), so a declaration is
  // in here before anything that could name it — and, because a type reference
  // can only follow an import, no cross-module strongly-connected component can
  // form behind the analysis's back. Only the variance analysis reads it; see
  // `Declarations` in `passes/checker/variance.ts` for why one module's own view
  // is the wrong source.
  const programNominals: { unions: Resolved.Union[]; records: Resolved.RecordDeclaration[] } = {
    unions: [],
    records: [],
  };
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
    // Consumers see every prelude module; a prelude module sees the members
    // *before it* in the list, and only those (Modules §5.5). Ordering the set
    // this way is what makes cycles impossible by construction, and it is why the
    // list order is normative rather than incidental. A prelude module never sees
    // itself or anything later, so the first member sees nothing.
    const preludeVisible = isPrelude
      ? preludePaths.slice(0, preludePaths.indexOf(path))
      : preludePaths;
    const preludeImports: PreludeImport[] = preludeVisible.flatMap((preludePath) => {
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
      // v1's standard-library privilege is prelude membership (`spec/intrinsics.md`
      // §5.2). It follows the *path*, so a project supplying its own file at a
      // prelude injection path is privileged in it — the stdlib-developing-itself
      // path, carrying the same trust model as the `Node` runtime flag precedent.
      privileged: isPrelude,
      ...(runtimePaths.has(path) ? { runtime: true } : {}),
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
    const typed = check(resolved, { importedSchemes, programNominals });
    programNominals.unions.push(...resolved.unions);
    programNominals.records.push(...resolved.records);
    const core = elaborate(typed);
    const result: CompiledModule = {
      source,
      parsed: parsedModule,
      resolved,
      typed,
      core,
      javascript: emitJavaScript(core, { exportInstanceEvidence: true }),
      declarations: emitDeclarations(core, {
        runtimeSpecifier: emittedModuleSpecifier(
          relativeSpecifier(path, `${root}/${runtimeBasename}.hex`),
        ),
      }),
    };
    compiled.set(path, result);
  }

  // Surface every module's own diagnostics on the project. `typed` accumulates
  // the lexing, layout, parsing, resolution, and checking stages; emission adds
  // its own. Without this a module that fails to compile reports success and
  // its broken JavaScript is handed back silently.
  // Each emission stage seeds its own bag with the diagnostics it was handed, so
  // `javascript` and `declarations` both re-carry everything `typed` produced and
  // a naive fold reports each one three times. The stages share diagnostic
  // *identity*, so a seen-set collapses the repeats without suppressing genuinely
  // distinct diagnostics that happen to read alike.
  const surfaced = new Set<Diagnostics.Diagnostic>();
  for (const path of ordered) {
    const module = compiled.get(path);
    if (module === undefined) continue;
    for (const stage of [module.typed, module.javascript, module.declarations]) {
      for (const diagnostic of stage.diagnostics) {
        if (surfaced.has(diagnostic)) continue;
        surfaced.add(diagnostic);
        diagnostics.add(diagnostic);
      }
    }
  }

  // Emit a prelude module only when something emitted imports it, so a project
  // that never touches its nominals is unchanged by the prelude's existence.
  // Since §5.5 lets prelude modules import each other, this is reachability
  // rather than a single hop: a module imported *only* by another prelude module
  // must still be emitted, or the emitted JavaScript carries an import of a file
  // that was never written — and that failure is silent, because the project
  // compiles clean.
  const importsOf = (path: string): readonly string[] =>
    (compiled.get(path)?.resolved.items ?? []).flatMap((item) =>
      item.kind === "Import" ? [resolveSpecifier(path, item.specifier)] : []
    );
  const emitted = new Set(ordered.filter((path) => !preludeSet.has(path)));
  const pending = [...emitted];
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    for (const target of importsOf(path)) {
      if (emitted.has(target)) continue;
      emitted.add(target);
      pending.push(target);
    }
  }

  const modules = ordered.flatMap((path) => {
    if (!emitted.has(path)) return [];
    const module = compiled.get(path);
    return module === undefined ? [] : [module];
  });

  return {
    modules,
    // Present exactly when some emitted `.d.ts` imports it (FFI Part 1 §8.3
    // obligation 3). A module that was compiled but not emitted writes no file,
    // so its faces are not an importer — which is why this reads the emitted
    // list rather than every module compiled.
    runtimeDeclarations: modules.some(({ declarations }) => declarations.importsRuntimeTypes)
      ? {
          kind: "RuntimeDeclarations",
          path: `${root}/${runtimeBasename}.d.ts`,
          text: runtimeDeclarationsText(),
        }
      : undefined,
    diagnostics: diagnostics.toArray(),
  };
}

/**
 * The basename the runtime declaration module claims at the source common root:
 * the first free of `hex`, `hex1`, `hex2`, … (FFI Part 1 §8.3).
 *
 * §10's probing discipline, lifted from identifiers to filenames: a user module
 * whose own emission claims `hex.js`/`hex.d.ts` **at that root** keeps its name
 * and the generated file moves. The comparison is case-insensitive because
 * case-colliding filesystems exist, and a program that compiled here and
 * overwrote a file there would be the worst possible way to find that out.
 *
 * Only files directly at the root can collide — a deeper module emits into its
 * own directory. The probe runs over every source there, which is a superset of
 * the emitted ones: the only sources that go unemitted are unreached prelude
 * modules, whose basenames are fixed (`Bool`, `Prelude`, `Option`, `Seq`,
 * `Result`) and never `hex`, so the superset costs nothing today. Over-claiming
 * would only ever move the generated file, which nothing outside this compile
 * names; under-claiming would silently overwrite a user's.
 */
function runtimeDeclarationsBasename(paths: Iterable<string>, root: string): string {
  const claimed = new Set<string>();
  for (const path of paths) {
    const directory = path.slice(0, Math.max(0, path.lastIndexOf("/")));
    if (directory !== root) continue;
    claimed.add(path.slice(path.lastIndexOf("/") + 1).replace(/\.hex$/, "").toLowerCase());
  }
  if (!claimed.has(RUNTIME_DECLARATIONS_STEM)) return RUNTIME_DECLARATIONS_STEM;
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${RUNTIME_DECLARATIONS_STEM}${suffix}`;
    if (!claimed.has(candidate)) return candidate;
  }
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
 *
 * `root` is the caller's, not recomputed here: the runtime declaration module
 * is placed at the same root (FFI Part 1 §8.3) and the two must not be able to
 * disagree about where that is.
 */
function injectPrelude(sources: Map<string, Source.File>, root: string): readonly string[] {
  const paths = [...sources.keys()];
  if (paths.length === 0) return [];
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

/**
 * The path an import specifier names, from the module that wrote it.
 *
 * Exported because it is a rule about the module graph rather than a detail of
 * compiling one: an editor asking which module a name was imported from has to
 * answer it the same way the compiler did, and a second copy that drifted would
 * be wrong only for the imports it disagreed about.
 */
export function resolveSpecifier(importer: string, specifier: string): string {
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
