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
 *
 * Node's own loader links the directory, not Vite's module runner:
 * `vitest.config.ts` externalizes it by its `hex-run-` prefix. The runner
 * turns imports into property reads, so a module importing a name its
 * dependency never exported would load and fail only when the name was
 * called; Node refuses it at link time, as a host does.
 *
 * Node is reached through non-literal specifiers, as in `typescript-check.ts`:
 * the package carries no Node type definitions, and the compiler core names no
 * host module.
 */

import * as Source from "./source.js";
import { compileProject, type CompiledProject, type ProjectOptions } from "../project.js";

/** How many programs `runProject` has run in this process; see its directory. */
let runs = 0;

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
     * The program's runtime module is handed in too, under its own path
     * (`/hex.js`), since the runtime record is made there (FFI Part 11 §1).
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
  const fsName = "node:fs";
  const osName = "node:os";
  const pathName = "node:path";
  const urlName = "node:url";
  const fs = await import(/* @vite-ignore */ fsName) as {
    mkdtempSync: (prefix: string) => string;
    mkdirSync: (path: string, options: { recursive: boolean }) => void;
    writeFileSync: (path: string, data: string) => void;
    rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
  };
  const os = await import(/* @vite-ignore */ osName) as { tmpdir: () => string };
  const paths = await import(/* @vite-ignore */ pathName) as {
    join: (...parts: string[]) => string;
    dirname: (of: string) => string;
  };
  const url = await import(/* @vite-ignore */ urlName) as {
    pathToFileURL: (of: string) => { readonly href: string };
  };

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

  // One directory per run, never reused: a module's URL is its identity to the
  // host's module cache, so two runs must not share a path. The directory is
  // removed after the run and `mkdtemp` could hand its name out again, so the
  // process's own count of runs is part of the name.
  runs += 1;
  const root = fs.mkdtempSync(paths.join(os.tmpdir(), `hex-run-${runs}-`));
  const fileOf = (address: string): string =>
    paths.join(root, address.replace(/^\//u, "").replace(/\.hex$/u, ".js"));
  const write = (file: string, text: string): void => {
    fs.mkdirSync(paths.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  try {
    write(paths.join(root, "package.json"), '{ "type": "module" }\n');
    // The program's runtime module on the same footing as a prelude one: it is
    // executable, and a contested program's very first import is of it (FFI
    // Part 7 §1.2).
    const runtimeGlobals = project.runtimeGlobals;
    if (runtimeGlobals !== undefined) {
      write(
        fileOf(runtimeGlobals.path),
        options.transform === undefined
          ? runtimeGlobals.text
          : options.transform(runtimeGlobals.path, runtimeGlobals.text),
      );
    }
    for (const module of project.modules) {
      // Written at the module's **address** — its full name laid out as a path
      // (Packages §6) — because that is what the emitted specifiers name since
      // #829; a source file's own name and place appear nowhere in the emitted
      // graph.
      const text = options.transform === undefined
        ? module.javascript.text
        : options.transform(module.source.path, module.javascript.text);
      write(fileOf(module.path), text);
    }
    // The whole graph is linked and evaluated once the entry's import settles,
    // and the emitted modules import nothing later, so the directory can go.
    const entryUrl = url.pathToFileURL(fileOf(entryModule.path)).href;
    return (await import(/* @vite-ignore */ entryUrl)) as Record<string, unknown>;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
