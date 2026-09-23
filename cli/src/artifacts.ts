import { isAbsolute, resolve } from "node:path";
import type { CompiledProject } from "../../compiler/src/index.js";

export function artifactsOf(project: CompiledProject): ReadonlyMap<string, string> {
  const artifacts = new Map<string, string>();
  const add = (path: string, text: string): void => {
    const relative = artifactPath(path);
    if (artifacts.has(relative)) throw new Error(`internal compiler error: duplicate emitted path ${relative}`);
    artifacts.set(relative, text);
  };
  for (const unit of [...project.modules, ...project.dataUnits]) {
    add(replaceExtension(unit.path, ".js"), unit.javascript.text);
    add(replaceExtension(unit.path, ".d.ts"), unit.declarations.text);
  }
  if (project.runtimeDeclarations !== undefined) {
    add(project.runtimeDeclarations.path, project.runtimeDeclarations.text);
  }
  if (project.runtimeGlobals !== undefined) add(project.runtimeGlobals.path, project.runtimeGlobals.text);
  add("/package.json", '{\n  "type": "module"\n}\n');
  return artifacts;
}

export function emittedRootPaths(
  project: CompiledProject,
  outputDirectory: string,
): readonly string[] {
  return project.roots.flatMap(({ modules }) =>
    modules.map(({ path }) => resolve(outputDirectory, artifactPath(replaceExtension(path, ".js"))))
  );
}

function replaceExtension(path: string, extension: string): string {
  if (!path.endsWith(".hex")) throw new Error(`internal compiler error: invalid emitted path ${path}`);
  return `${path.slice(0, -4)}${extension}`;
}

function artifactPath(path: string): string {
  if (!path.startsWith("/") || isAbsolute(path.slice(1)) || path.includes("\\")) {
    throw new Error(`internal compiler error: unsafe emitted path ${path}`);
  }
  const relative = path.slice(1);
  if (relative === "" || relative.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`internal compiler error: unsafe emitted path ${path}`);
  }
  return relative;
}
