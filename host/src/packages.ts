/**
 * Discovery: from an editor root or a working directory to a **program**.
 *
 * This is the loop Packages §4.1 describes and D2 assigns to a host: start at
 * the project's record, resolve its entries from its own directory, and for
 * each newly reached canonical directory read its manifest, its version, and
 * its files and resolve *its* entries from *its* directory, until no new
 * directory is reached. What the closure then *is* — acyclic, one copy per
 * name, the project's name unclaimed — is the compiler's to say, and
 * `validatePackageSet` says it.
 *
 * The split is not decoration. Nothing here judges a package: a name's shape,
 * a duplicate, a cycle, an unresolvable entry are all reported by the compiler
 * over records, so a second mechanism for finding directories changes this file
 * and no rule. And nothing in the compiler spells `node_modules`.
 */

import { join } from "node:path";
import {
  validatePackageSet,
  type PackageProblem,
  type PackageRecord,
  type ProgramPackage,
  type ResolvedEdge,
} from "../../compiler/src/index.js";
import {
  hexagonFilesUnder,
  nothingSeen,
  NOTHING_EXCLUDED,
  type Exclusions,
  type FoundFile,
  type Walked,
} from "./files.js";
import {
  isExcluded,
  manifestKeyLine,
  MANIFEST_NAME,
  readManifest,
  type Manifest,
  type ManifestProblem,
  type ManifestResult,
} from "./manifest.js";
import { Lookup } from "./lookup.js";
import { normalizePath, realPathOf } from "./paths.js";
import { manifestPathOf, projectDirectories } from "./projects.js";

/** A problem to publish, against the manifest that carries the entry (D3). */
export interface SeatedProblem {
  /** The manifest file the report is published against. */
  readonly path: string;
  /** Zero-based line within it. */
  readonly line: number;
  readonly message: string;
  readonly severity: "error" | "warning";
}

/** One package of a program, as discovery found it. */
export interface DiscoveredPackage {
  /** The canonical directory — the package's identity (Packages §4.3). */
  readonly directory: string;
  readonly manifestPath: string;
  readonly manifest: Manifest;
  /**
   * The manifest's own text, so a host can seat a span in it: Packages §7's
   * whole-program report points its reader at the *other* package's manifest,
   * and a package's manifest is the only text of it a consumer can act on (D3).
   */
  readonly manifestText: string;
  /** The record the compiler resolves this package's imports against. */
  readonly record: ProgramPackage;
  /** Its own `.hex` files, beneath its manifest and within its bounds (§2.2). */
  readonly files: readonly FoundFile[];
  readonly isProject: boolean;
}

/** One program: a project directory, its closure, and what is wrong with it. */
export interface Program {
  /** The project's canonical directory. */
  readonly directory: string;
  /** False where the project runs under the implicit empty manifest (§2.5). */
  readonly hasManifest: boolean;
  readonly manifest: Manifest;
  readonly manifestPath: string;
  /** The project's own files. */
  readonly files: readonly FoundFile[];
  /** The dependency closure, the project excluded, in the compiler's order. */
  readonly packages: readonly DiscoveredPackage[];
  /** What the project's own lookup answers with (§4.1's *installed*). */
  readonly installed: ReadonlySet<string>;
  readonly problems: readonly SeatedProblem[];
  /** The nested `hexagon.json` directories beneath it — programs of their own. */
  readonly nested: readonly string[];
}

/**
 * Discovers one program rooted at a project directory.
 *
 * `lookup` is shared across the programs of one run so that a level shared by
 * two projects is scanned once; pass a fresh one per run, because a run answers
 * over the disk as it was when it started.
 */
export async function discoverProgram(
  directory: string,
  lookup: Lookup,
  onError: (message: string) => void = () => {},
): Promise<Program> {
  const projectDirectory = normalizePath(await realPathOf(directory));
  const projectResult = await readManifest(projectDirectory);
  const projectManifest = projectResult.manifest;
  const exclusions = await exclusionsOf(projectDirectory, projectManifest);
  const walked = await hexagonFilesUnder(
    projectDirectory,
    exclusions,
    nothingSeen(),
    onError,
  );

  const project: PackageRecord = {
    name: projectManifest.name,
    dependencies: projectManifest.dependencies,
    directory: projectDirectory,
    ...(projectManifest.version === undefined ? {} : { version: projectManifest.version }),
    installed: await lookup.installedAt(projectDirectory),
  };

  const edges: ResolvedEdge[] = [];
  /** Every package the closure reaches, by canonical directory, in DFS order. */
  const reached = new Map<string, DiscoveredPackage>();
  /** Each manifest's own problems, for the ones that enter the set. */
  const manifests = new Map<string, { path: string; text: string; problems: readonly ManifestProblem[] }>();
  manifests.set(projectDirectory, {
    path: manifestPathOf(projectDirectory),
    text: projectResult.text,
    problems: projectResult.problems,
  });

  /** Every manifest read in full, by canonical directory — never read twice. */
  const read = new Map<string, ManifestResult>();
  const readOnce = async (directory: string): Promise<ManifestResult> => {
    const known = read.get(directory);
    if (known !== undefined) return known;
    const result = await readManifest(directory);
    read.set(directory, result);
    return result;
  };

  /** Every package's own files, walked once per directory (§2.2's bounds). */
  const walks = new Map<string, Promise<Walked>>();
  const filesOf = (directory: string, manifest: Manifest): Promise<Walked> => {
    const known = walks.get(directory);
    if (known !== undefined) return known;
    const walk = (async () =>
      await hexagonFilesUnder(
        directory,
        await exclusionsOf(directory, manifest),
        nothingSeen(),
        onError,
      ))();
    walks.set(directory, walk);
    return walk;
  };

  const resolveEntries = async (record: PackageRecord): Promise<void> => {
    for (const name of record.dependencies) {
      const answer = await lookup.lookup(name, record.directory);
      // Only an answer — one candidate at the nearest declaring level — is
      // followed; two are §4.3's refusal, which the compiler draws over the
      // edge. Membership is `validatePackageSet`'s to decide and this does not
      // decide it: what the guard buys is that discovery never reads the files
      // and never runs the lookups of a package the rules refuse.
      const answers = answer.candidates.length === 1;
      const candidates: PackageRecord[] = [];
      for (const candidate of answer.candidates) {
        // A package the lookup **answers with** is validated in full (§4.1);
        // the level scan that found it read one field. This is where the rest
        // of its manifest is read, and it is read for no other root.
        const full = await readOnce(candidate.directory);
        candidates.push({
          name: candidate.name,
          dependencies: full.manifest.dependencies,
          directory: candidate.directory,
          ...(full.manifest.version === undefined ? {} : { version: full.manifest.version }),
          // §7's stage-one row is a fact about the *files* a package ships, so
          // the compiler is told it rather than asked to find it. Only an
          // answering candidate is walked, and the project is not one of them:
          // an editor root with no `.hex` in it yet is a project starting, not
          // a distribution shipped wrong.
          ...(answers && candidate.directory !== projectDirectory
            ? { hasSource: (await filesOf(candidate.directory, full.manifest)).files.length > 0 }
            : {}),
        });
      }
      edges.push({ from: record.directory, name, candidates, unreadable: answer.unreadable });
      if (!answers) continue;
      const answered = answer.candidates[0]!;
      if (answered.directory === projectDirectory) continue;
      if (reached.has(answered.directory)) continue;
      const own = await readOnce(answered.directory);
      const installed = await lookup.installedAt(answered.directory);
      const files = await filesOf(answered.directory, own.manifest);
      const next: PackageRecord = {
        name: own.manifest.name,
        dependencies: own.manifest.dependencies,
        directory: answered.directory,
        ...(own.manifest.version === undefined ? {} : { version: own.manifest.version }),
        installed,
      };
      manifests.set(answered.directory, {
        path: manifestPathOf(answered.directory),
        text: own.text,
        problems: own.problems,
      });
      reached.set(answered.directory, {
        directory: answered.directory,
        manifestPath: manifestPathOf(answered.directory),
        manifest: own.manifest,
        manifestText: own.text,
        record: {
          name: own.manifest.name,
          dependencies: own.manifest.dependencies,
          installed,
        },
        files: files.files,
        isProject: false,
      });
      await resolveEntries(next);
    }
  };
  await resolveEntries(project);

  const validated = validatePackageSet(project, edges);
  const problems: SeatedProblem[] = [];
  /**
   * A manifest's **own** reports, for the project and for every package that
   * entered the set (§4.1): "a package that enters the set is checked for its
   * own `dependencies`", while "a manifest the walk merely scans is a candidate
   * for the name it declares and nothing more".
   *
   * `manifests` is that rule rather than a filter over it: an entry is written
   * exactly where a lookup **answered** with a package, so a manifest the scan
   * merely read has no entry here and there is nothing to suppress. §2.1's
   * `name` refusals need no clause of their own for the same reason and one
   * step earlier — a manifest whose `name` this spec refuses declares no name at
   * all (`readManifest` drops it), so no lookup can answer with it, so it can
   * never be a package whose problems are published.
   *
   * The **project's** manifest is checked in full, and no other is: §4.1 says
   * what a package that enters the set is checked for, and it is its own
   * `dependencies`; §2.1 makes every other field the host's. So a dependency's
   * `exclude` is honoured and never reported on, and a key this reader does not
   * know is read past in silence — a package's author is not this manifest's
   * reader, the file sits under `node_modules` where nothing a user writes
   * survives the next install, and `exclude: ["dist"]` naming a directory the
   * published tarball does not carry is the ordinary shape of a published
   * package rather than a fault.
   */
  for (const [directory, manifest] of manifests) {
    for (const problem of manifest.problems) {
      if (directory !== projectDirectory && problem.scope !== "language") continue;
      problems.push({
        path: manifest.path,
        line: problem.line,
        message: problem.message,
        severity: problem.severity,
      });
    }
  }
  for (const problem of validated.problems) {
    problems.push(seat(problem, manifests.get(problem.directory)));
  }

  const ordered = validated.packages.flatMap(({ directory: at }) => {
    const found = reached.get(at);
    return found === undefined ? [] : [found];
  });
  return {
    directory: projectDirectory,
    hasManifest: projectResult.present,
    manifest: projectManifest,
    manifestPath: manifestPathOf(projectDirectory),
    files: walked.files,
    packages: ordered,
    installed: project.installed ?? new Set(),
    problems,
    nested: walked.nested,
  };
}

/** Where a package-set problem is published, and on which line (D3). */
function seat(
  problem: PackageProblem,
  manifest: { path: string; text: string } | undefined,
): SeatedProblem {
  const path = manifest?.path ?? normalizePath(join(problem.directory, MANIFEST_NAME));
  return {
    path,
    line: manifest === undefined
      ? 0
      : manifestKeyLine(manifest.text, problem.key, problem.entry),
    message: problem.message,
    severity: "error",
  };
}

/**
 * A manifest's `exclude` entries under both names the walk can reach a file by.
 *
 * The second spelling exists because the walk follows symlinks, so a file's
 * resolved path can have a prefix no manifest ever writes — on macOS `/var` is a
 * link to `/private/var`, which is every path under a temporary directory. Only
 * an entry's **containing directory** is resolved to bridge that: the entry's
 * own last component is left exactly as written, because excluding a link
 * `alias.hex` must not take its target out of the project under the target's
 * own legitimate name.
 *
 * The containing directory, and not merely the root, because a project's own
 * root is canonical here and an *absolute* entry is not: a user pastes what
 * their shell showed them, which on macOS is `/var/folders/…` where the walk
 * says `/private/var/folders/…`. Rebasing the root would bridge nothing — the
 * two spellings of the root are already the same string — and the entry would
 * quietly match no file, which is the one failure `exclude` must never have.
 */
export async function exclusionsOf(
  directory: string,
  manifest: Manifest,
): Promise<Exclusions> {
  if (manifest.exclude.length === 0) return NOTHING_EXCLUDED;
  const literal: string[] = [];
  const real: string[] = [];
  for (const entry of manifest.exclude) {
    const written = normalizePath(entry);
    literal.push(written);
    real.push(await resolvedContainer(written));
  }
  return { literal, real };
}

/**
 * An entry under its containing directory's resolved name, its own last
 * component untouched — and itself where that directory cannot be resolved,
 * which is an entry naming a directory chain that is not there.
 */
async function resolvedContainer(entry: string): Promise<string> {
  const at = entry.lastIndexOf("/");
  if (at <= 0) return entry;
  const container = entry.slice(0, at);
  const resolved = normalizePath(await realPathOf(container));
  return `${resolved}${entry.slice(at)}`;
}

/** Merges several roots' exclusions, for a host that holds more than one. */
export function mergedExclusions(all: readonly Exclusions[]): Exclusions {
  return {
    literal: all.flatMap(({ literal }) => literal),
    real: all.flatMap(({ real }) => real),
  };
}

/**
 * Every program a set of editor roots describes: each root's own project, and
 * every project nested beneath one (`environment.md` §4, D1).
 *
 * One `discoverProgram` per project directory, however many roots reach it —
 * `projectDirectories` claims a directory before asking what is nested beneath
 * it, so the walk that answers that question is the same one that reads the
 * project's files. One `Lookup` serves the run, so a `node_modules` two projects
 * share is scanned once.
 */
export async function discoverPrograms(
  roots: readonly string[],
  onError: (message: string) => void = () => {},
): Promise<readonly Program[]> {
  const lookup = new Lookup(onError);
  const discovered = new Map<string, Program>();
  const directories = await projectDirectories(roots, async (directory) => {
    const program = await discoverProgram(directory, lookup, onError);
    discovered.set(program.directory, program);
    return program.nested;
  });
  return directories.flatMap(({ directory }) => {
    const program = discovered.get(directory);
    return program === undefined ? [] : [program];
  });
}
