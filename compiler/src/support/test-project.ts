/**
 * Test-only helpers for compiling and *executing* a whole project.
 *
 * Several conformance harnesses used to drive the passes directly over a single
 * module and execute the result from a `data:` URL. That stopped being a
 * faithful model of a Hexagon program when #147 made `Bool` a prelude union: a
 * module compiled with no prelude cannot type a condition, a guard, a
 * comparison, or a logic operator, because the declaration those name lives in
 * `stdlib/Bool.hex`. Real compilation always injects the prelude, so the
 * harnesses go through `compileProject` and link the emitted module graph here.
 *
 * The linker is a minimal ESM one: the compiler's own relative specifiers are
 * rewritten to the `data:` URLs of already-built modules. That is sound because
 * the module graph is acyclic and `compileProject` returns it dependency-first.
 */

import * as Source from "./source.js";
import { compileProject, type CompiledProject, type ProjectOptions } from "../project.js";

function resolveModulePath(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const directory = importer.slice(0, Math.max(0, importer.lastIndexOf("/")));
  const parts: string[] = [];
  for (const part of `${directory}/${specifier}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const path = `/${parts.join("/")}`;
  return path.endsWith(".js") ? `${path.slice(0, -3)}.hex` : path;
}

function link(
  javascript: string,
  importerPath: string,
  moduleUrls: ReadonlyMap<string, string>,
): string {
  return javascript.replace(
    /^(\s*import(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
    (statement, prefix: string, _quote: string, specifier: string) => {
      const target = resolveModulePath(importerPath, specifier);
      const url = target === undefined ? undefined : moduleUrls.get(target);
      return url === undefined ? statement : `${prefix}${JSON.stringify(url)};`;
    },
  );
}

/** Compiles the given files as one project, prelude included. */
export function compileFiles(
  files: readonly (readonly [string, string])[],
  options: ProjectOptions = {},
): CompiledProject {
  return compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
    options,
  );
}

/** Compiles one module as `/main.hex`, prelude included. */
export function compileMain(source: string): CompiledProject {
  return compileFiles([["/main.hex", source]]);
}

/** Every diagnostic message the project produced, in order. */
export function projectDiagnostics(source: string): readonly string[] {
  return compileMain(source).diagnostics.map(({ message }) => message);
}

/**
 * Compiles a project and executes it, returning `/main.hex`'s exports. Throws if
 * the project reported any diagnostic, so a harness cannot silently pass a
 * module the compiler rejected.
 */
export async function runProject(
  files: readonly (readonly [string, string])[],
  options: ProjectOptions & {
    readonly entry?: string;
    /**
     * Rewrites one module's emitted JavaScript before it is linked, for a
     * harness that has to instrument the compiler's own output — counting a
     * runtime module's descents, say. The rewrite happens *before* linking, so
     * the instrumented text keeps whatever imports the module was emitted with.
     */
    readonly transform?: (path: string, javascript: string) => string;
  } = {},
): Promise<Record<string, unknown>> {
  const project = compileFiles(files, options);
  if (project.diagnostics.length > 0) {
    throw new Error(
      `project did not compile cleanly:\n${
        project.diagnostics.map(({ message }) => `  ${message}`).join("\n")
      }`,
    );
  }
  const moduleUrls = new Map<string, string>();
  // The program's runtime module first, and on the same footing as a prelude
  // one: it is executable, and a contested program's very first import is of it
  // (FFI Part 7 §1.2). It belongs to no source file, so it is keyed by the
  // `.hex` path `resolveModulePath` derives from the `./hex.js` specifier its
  // importers spell.
  const runtimeGlobals = project.runtimeGlobals;
  if (runtimeGlobals !== undefined) {
    moduleUrls.set(
      runtimeGlobals.path.replace(/\.js$/u, ".hex"),
      `data:text/javascript;charset=utf-8,${encodeURIComponent(runtimeGlobals.text)}`,
    );
  }
  for (const module of project.modules) {
    const text = options.transform === undefined
      ? module.javascript.text
      : options.transform(module.source.path, module.javascript.text);
    const linked = link(text, module.source.path, moduleUrls);
    moduleUrls.set(
      module.source.path,
      `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
    );
  }
  // By path, never `modules[0]`: the prelude members share the project.
  const entry = options.entry ?? "/main.hex";
  return (await import(/* @vite-ignore */ moduleUrls.get(entry)!)) as Record<
    string,
    unknown
  >;
}

/** The same, for the common single-module case. */
export async function runMain(source: string): Promise<Record<string, unknown>> {
  return runProject([["/main.hex", source]]);
}
