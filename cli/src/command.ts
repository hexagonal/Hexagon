import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import {
  compileProject,
  Source,
  type ProjectOptions,
  type ProjectPackage,
} from "../../compiler/src/index.js";
import {
  discoverPrograms,
  messageOf,
  normalizePath,
  type FoundFile,
  type Program,
} from "../../host/src/index.js";
import { artifactsOf, emittedRootPaths } from "./artifacts.js";
import { HELP, parseArguments, UsageError, VERSION } from "./arguments.js";
import { renderDiagnostic, renderSeatedProblem } from "./diagnostics.js";
import { OutputError, writeOutput } from "./output.js";

interface CommandContext {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly write?: typeof writeOutput;
}

class ProjectError extends Error {
  override readonly name = "ProjectError";
}

/** Runs one invocation and returns the process status without exiting its host. */
export async function runCommand(
  arguments_: readonly string[],
  context: CommandContext,
): Promise<number> {
  try {
    const invocation = parseArguments(arguments_);
    if (invocation.kind === "help") {
      context.stdout(HELP);
      return 0;
    }
    if (invocation.kind === "version") {
      context.stdout(`${VERSION}\n`);
      return 0;
    }

    const roots = await validateRoots(invocation.roots, context.cwd);
    const discoveryFailures: string[] = [];
    const programs = await discoverPrograms(
      roots.map((path) => dirname(path)),
      (message) => discoveryFailures.push(message),
    );
    if (discoveryFailures.length > 0) throw new ProjectError(discoveryFailures.join("\n"));
    const program = ownerOf(roots[0]!, programs);
    if (program === undefined) {
      throw new ProjectError(`root is excluded from its project or is not a project source: ${roots[0]}`);
    }
    for (const root of roots.slice(1)) {
      if (ownerOf(root, programs) !== program) {
        throw new ProjectError(`all roots must belong to the same project; ${root} does not belong to ${program.directory}`);
      }
    }

    const manifestText = new Map<string, string>();
    manifestText.set(program.manifestPath, await readableText(program.manifestPath, !program.hasManifest));
    for (const dependency of program.packages) {
      manifestText.set(dependency.manifestPath, dependency.manifestText);
    }
    for (const problem of program.problems) {
      context.stderr(`${renderSeatedProblem(problem, manifestText.get(problem.path))}\n`);
    }
    if (program.problems.some(({ severity }) => severity === "error")) {
      if (invocation.kind === "build") {
        context.stderr("Build failed. Previous output was left unchanged.\n");
      }
      return 1;
    }

    const loaded = await loadProgram(program, roots);
    const compiled = compileProject(loaded.files, {
      ...optionsOf(program, loaded.packages),
      roots: loaded.rootIds,
    });
    for (const diagnostic of compiled.diagnostics) {
      context.stderr(`${renderDiagnostic(diagnostic, loaded.sources)}\n`);
    }
    if (compiled.diagnostics.some(({ severity }) => severity === "error")) {
      if (invocation.kind === "build") {
        context.stderr("Build failed. Previous output was left unchanged.\n");
      }
      return 1;
    }
    if (invocation.kind === "check") return 0;

    const outputDirectory = invocation.outputDirectory === undefined
      ? resolve(program.directory, "dist")
      : resolve(context.cwd, invocation.outputDirectory);
    const protectedPaths = [
      ...program.files.map(({ path }) => path),
      program.manifestPath,
      ...program.packages.flatMap((dependency) => [
        dependency.manifestPath,
        ...dependency.files.map(({ path }) => path),
      ]),
    ];
    await (context.write ?? writeOutput)({
      projectDirectory: program.directory,
      outputDirectory,
      artifacts: artifactsOf(compiled),
      roots,
      version: VERSION,
      protectedPaths,
      dependencyDirectories: program.packages.map(({ directory }) => directory),
    });
    const entries = emittedRootPaths(compiled, outputDirectory);
    context.stdout(
      entries.length === 0
        ? `Built ${compiled.modules.length} modules in ${outputDirectory}\n`
        : `Built ${compiled.modules.length} modules. Emitted roots:\n${entries.map((path) => `  ${path}`).join("\n")}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      context.stderr(`hexc: ${error.message}\nRun 'hexc --help' for usage.\n`);
      return 2;
    }
    if (error instanceof ProjectError || error instanceof OutputError) {
      context.stderr(`hexc: ${error.message}\n`);
      return 1;
    }
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    context.stderr(`hexc ${VERSION}: internal compiler error\n${detail}\n`);
    return 3;
  }
}

async function validateRoots(arguments_: readonly string[], cwd: string): Promise<readonly string[]> {
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const argument of arguments_) {
    if (extname(argument).toLowerCase() !== ".hex") {
      throw new UsageError(`root must be a .hex source file: ${argument}`);
    }
    const written = resolve(cwd, argument);
    let details;
    try {
      details = await stat(written);
    } catch (error) {
      throw new ProjectError(`cannot read root ${written}: ${messageOf(error)}`);
    }
    if (!details.isFile()) throw new UsageError(`root is not a file: ${written}`);
    let canonical: string;
    try {
      canonical = normalizePath(await realpath(written));
    } catch (error) {
      throw new ProjectError(`cannot resolve root ${written}: ${messageOf(error)}`);
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    roots.push(canonical);
  }
  return roots;
}

function ownerOf(root: string, programs: readonly Program[]): Program | undefined {
  return programs.find((program) =>
    program.files.some(({ path, realPath }) => path === root || realPath === root)
  );
}

interface LoadedProgram {
  readonly files: readonly Source.File[];
  readonly packages: readonly ProjectPackage[];
  readonly rootIds: readonly Source.FileId[];
  readonly sources: ReadonlyMap<number, Source.File>;
}

async function loadProgram(program: Program, roots: readonly string[]): Promise<LoadedProgram> {
  let nextId = 0;
  const sources = new Map<number, Source.File>();
  const idsByRealPath = new Map<string, Source.FileId>();
  const load = async (found: FoundFile): Promise<Source.File> => {
    const id = Source.fileId(nextId);
    nextId += 1;
    let text: string;
    try {
      text = await readFile(found.path, "utf8");
    } catch (error) {
      throw new ProjectError(`cannot read source ${found.path}: ${messageOf(error)}`);
    }
    const source = new Source.File(id, found.path, text);
    sources.set(Number(source.id), source);
    idsByRealPath.set(found.realPath, source.id);
    idsByRealPath.set(found.path, source.id);
    return source;
  };
  const files = await Promise.all(program.files.map(load));
  const packages: ProjectPackage[] = [];
  for (const dependency of program.packages) {
    packages.push({ record: dependency.record, files: await Promise.all(dependency.files.map(load)) });
  }
  const rootIds = roots.map((path) => idsByRealPath.get(path)).filter((id): id is Source.FileId => id !== undefined);
  if (rootIds.length !== roots.length) {
    throw new ProjectError("one or more roots disappeared or became excluded during discovery");
  }
  return { files, packages, rootIds, sources };
}

function optionsOf(program: Program, packages: readonly ProjectPackage[]): ProjectOptions {
  return {
    dependencies: program.manifest.dependencies,
    installed: program.installed,
    ...(program.manifest.name === undefined ? {} : { packageName: program.manifest.name }),
    ...(packages.length === 0 ? {} : { packages }),
  };
}

async function readableText(path: string, absentIsEmpty: boolean): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (absentIsEmpty) return "";
    throw new ProjectError(`cannot read manifest ${path}: ${messageOf(error)}`);
  }
}
