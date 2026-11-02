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
 * The emitted modules are written to a fresh directory at their own addresses,
 * so the compiler's relative specifiers resolve as they would for any host, and
 * the entry is imported from there. A linker that rewrote each specifier to a
 * dependency's `data:` URL used to stand here; it copied every dependency's
 * text into each importer's URL, re-encoded at every level, so a module's URL
 * grew with the number of paths to it through the graph rather than with the
 * graph, and the Regex modules' passed what a string can hold.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import * as Source from "./source.js";
import { compileProject, type CompiledProject, type ProjectOptions } from "../project.js";

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

/**
 * Compiles one module as `/main.hex`, prelude included.
 *
 * The source declares its own module (Modules §2.1) — this helper mints no
 * header, so a harness that omits one meets the same refusal a user's file
 * does, and the header a harness writes is the one the compiler reads.
 */
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
  // One directory per run, never reused: a module's URL is its identity to the
  // host's module cache, so two runs must not share a path.
  const root = mkdtempSync(join(tmpdir(), "hex-run-"));
  const write = (address: string, text: string): void => {
    const target = join(root, address.replace(/^\//u, ""));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  };
  write("package.json", '{ "type": "module" }\n');
  // The program's runtime module on the same footing as a prelude one: it is
  // executable, and a contested program's very first import is of it (FFI
  // Part 7 §1.2).
  const runtimeGlobals = project.runtimeGlobals;
  if (runtimeGlobals !== undefined) write(runtimeGlobals.path, runtimeGlobals.text);
  for (const module of project.modules) {
    // Written at the module's **address** — its full name laid out as a path
    // (Packages §6) — because that is what the emitted specifiers name since
    // #829; a source file's own name and place appear nowhere in the emitted
    // graph.
    const text = options.transform === undefined
      ? module.javascript.text
      : options.transform(module.source.path, module.javascript.text);
    write(module.path.replace(/\.hex$/u, ".js"), text);
  }
  // By module, never `modules[0]`: the prelude members share the project. The
  // entry is named the way a compiler host names a root — by module name
  // (Modules §8.3) — with a source path still accepted, since a harness that
  // has one file in mind may name its file.
  const entry = options.entry ?? "Main";
  const entryModule = project.modules.find(({ name, path, source }) =>
    name === entry || path === entry || source.path === entry
  );
  if (entryModule === undefined) {
    throw new Error(`no module \`${entry}\` in the compiled project`);
  }
  const url = pathToFileURL(join(root, entryModule.path.replace(/^\//u, "").replace(/\.hex$/u, ".js")));
  return (await import(/* @vite-ignore */ url.href)) as Record<string, unknown>;
}

/** The same, for the common single-module case. */
export async function runMain(source: string): Promise<Record<string, unknown>> {
  return runProject([["/main.hex", source]]);
}

/**
 * A public door row's written claims (#1071, `spec/intrinsics.md` §3.3), read
 * off the compiled companion that declares it: `["co"]` for `Vector(+a)`, and
 * `"inv"` for a bare parameter. This is the claim every consumer of the type
 * reads, and the one the row is checked at.
 */
export function publicRowClaims(
  project: CompiledProject,
  companionPath: string,
  typeName: string,
): readonly string[] {
  const module = project.modules.find(({ source }) => source.path === companionPath);
  for (const item of module?.typed.items ?? []) {
    if (item.kind !== "ExternBlock") continue;
    for (const declaration of item.declarations) {
      if (declaration.kind === "ExternType" && declaration.localName === typeName) {
        return (declaration.parameters ?? []).map(({ claim }) => claim ?? "inv");
      }
    }
  }
  throw new Error(`${companionPath} declares no row for \`${typeName}\``);
}
