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

  const compiled = new Map<string, CompiledModule>();
  let symbolBase = 0;
  let unionBase = 0;
  let recordBase = 0;
  for (const path of ordered) {
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
    const resolved = resolve(parsedModule, {
      imports,
      symbolBase,
      unionBase,
      recordBase,
    });
    symbolBase = nextId(resolved.symbols.map(({ id }) => Number(id)), symbolBase);
    unionBase = nextId(resolved.unions.map(({ id }) => Number(id)), unionBase);
    recordBase = nextId(resolved.records.map(({ id }) => Number(id)), recordBase);
    const typed = check(resolved, { importedSchemes });
    const core = elaborate(typed);
    const result: CompiledModule = {
      source,
      parsed: parsedModule,
      resolved,
      typed,
      core,
      javascript: emitJavaScript(core),
      declarations: emitDeclarations(core),
    };
    compiled.set(path, result);
  }

  return {
    modules: ordered.flatMap((path) => {
      const module = compiled.get(path);
      return module === undefined ? [] : [module];
    }),
    diagnostics: diagnostics.toArray(),
  };
}

function nextId(ids: readonly number[], fallback: number): number {
  return ids.length === 0 ? fallback : Math.max(fallback, ...ids.map((id) => id + 1));
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
