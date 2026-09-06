/**
 * Which files a project or a package holds, on disk.
 *
 * "Every `.hex` file beneath the manifest's directory belongs to the package —
 * `node_modules`, the host's output directory, and any directory holding a
 * `hexagon.json` of its own excluded" (Packages §2.2). Those three exclusions
 * and the manifest's own `exclude` are this file's whole subject, and the walk
 * below is where a nested manifest becomes a **boundary** rather than a note:
 * a file beneath one belongs to that package alone, so no file ever has two
 * full names.
 *
 * The walk follows symlinks on purpose — a monorepo that links its source tree
 * in is an ordinary layout — which makes the tree a graph, so identity is the
 * resolved path throughout.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { MANIFEST_NAME, isExcluded } from "./manifest.js";
import { messageOf, normalizePath, realPathOf } from "./paths.js";

const HEXAGON_EXTENSION = ".hex";

/**
 * `node_modules`, and the **tooling directories** this host skips beside it.
 *
 * Only the first is a rule of the language: Packages §2.2 bounds a package's
 * files at its `node_modules`, and `exclude` is the field a project uses for
 * everything else. The rest — `.git`, a build output, a coverage report, an
 * editor's own directory, an agent's — are one host's convenience. None of them
 * is a language rule, and none is a claim about what those names mean; they are
 * here because a walk that descended into them would compile a stale worktree
 * or a vendored checkout in every project on the machine, before anyone thought
 * to write an `exclude`.
 *
 * The cost is paid deliberately: a `.hex` file under one of these names is not
 * in the project and says so nowhere, and no `exclude` entry can un-skip one, so
 * a project that really keeps source under such a name renames the directory.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".claude",
  ".vscode",
  "dist",
  "coverage",
]);

/**
 * Whether reaching `path` from `directory` passes **through** one of those
 * names.
 *
 * The walk's bound, asked as a question rather than published as a list. A host
 * seats files the walk never handed it — a watcher event on a newly created
 * `.hex`, an editor opening one — and every such door has to apply the same
 * bound or the walk's answer is only advisory: a `.hex` under a project's
 * `node_modules` would join the project as its **own** source, which is
 * Packages §2.2 broken and the dependency's module compiled under the
 * project's package name rather than its own.
 *
 * Only the components strictly between the two count. `directory` may itself
 * carry a skipped name — a dependency's directory lies under a `node_modules`,
 * and its files are that package's — and the last component is the file, not a
 * directory. A `path` that is not beneath `directory` at all crosses nothing;
 * whether it is beneath it is the caller's question, asked separately.
 */
export function crossesSkippedDirectory(directory: string, path: string): boolean {
  const root = normalizePath(directory);
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const target = normalizePath(path);
  if (!target.startsWith(prefix)) return false;
  const components = target.slice(prefix.length).split("/");
  return components.slice(0, -1).some((name) => SKIPPED_DIRECTORIES.has(name));
}

/** A discovered file, with the identity that makes two names for it one file. */
export interface FoundFile {
  readonly path: string;
  readonly realPath: string;
}

/**
 * The merged exclusions, held under both names a path can be reached by.
 *
 * A symlink means one file has two names, and `exclude` matches names. Keeping
 * only one spelling makes the check depend on which name the walk happened to
 * arrive by, which is the sort of thing that works everywhere the author tested
 * and nowhere else.
 */
export interface Exclusions {
  /** As written in the manifest, resolved against it but not through links. */
  readonly literal: readonly string[];
  /** The same entries under the root's *resolved* name, links below it intact. */
  readonly real: readonly string[];
}

export const NOTHING_EXCLUDED: Exclusions = { literal: [], real: [] };

/** Whether a path is excluded under either of the two names it can have. */
export function excludes(
  exclude: Exclusions,
  path: string,
  realPath: string | undefined,
): boolean {
  if (exclude.literal.length === 0) return false;
  if (isExcluded(path, exclude.literal)) return true;
  return realPath !== undefined && isExcluded(realPath, exclude.real);
}

/**
 * What a walk has already been to, by resolved path.
 *
 * Following symlinks means the tree is a graph: `ln -s . loop` makes a
 * directory contain itself, and a walk with no memory descends it until the
 * path length stops it, turning one file into dozens of modules that all shadow
 * each other. Identity has to be the resolved path, since two links to one
 * place are two names for it — and the same for files, where compiling one
 * twice reports every declaration in it as a duplicate of itself.
 */
export interface Seen {
  readonly directories: Set<string>;
  readonly files: Set<string>;
}

export function nothingSeen(): Seen {
  return { directories: new Set(), files: new Set() };
}

/** What one walk found: the package's files, and the packages beneath it. */
export interface Walked {
  readonly files: readonly FoundFile[];
  /**
   * The canonical directories the walk **stopped at** because they hold a
   * `hexagon.json` of their own — a package of its own (Packages §2.2), and a
   * program of its own (`environment.md` §4). The walk reports them rather than
   * being told them, so one traversal answers both questions and the two can
   * never disagree about where a boundary is.
   */
  readonly nested: readonly string[];
}

/**
 * Every `.hex` file the package rooted at `root` holds, and every nested
 * package boundary the walk met.
 *
 * `seen` is one walk's memory, not the toolchain's: a file belongs to exactly
 * one package, and the boundary rule is what guarantees that, so sharing a
 * memory between two packages' walks could only hide a file from the package
 * that owns it.
 */
export async function hexagonFilesUnder(
  root: string,
  exclude: Exclusions,
  seen: Seen,
  onError: (message: string) => void,
): Promise<Walked> {
  const found: FoundFile[] = [];
  const nested: string[] = [];
  const pending = [root];
  const walked = seen.directories;
  const collected = seen.files;
  const rootIdentity = await realPathOf(root);
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    const directoryIdentity = await realPathOf(directory);
    // Excluded under the name it resolves to, not only the name it was reached
    // by. `gen -> generated` beside an excluded `generated/` is one directory
    // with two names, and the walk follows links on purpose, so checking the
    // literal path alone lets every file in it back into the project under a
    // spelling the manifest never mentions.
    //
    // Before the cycle check claims the identity, not after: an excluded link
    // would otherwise mark its target as already walked, and the target — a
    // real directory under its own name — would be skipped as though it had
    // been visited, taking every module in it out of the project.
    if (excludes(exclude, directory, directoryIdentity)) continue;
    if (walked.has(directoryIdentity)) continue;
    walked.add(directoryIdentity);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      onError(`could not list ${directory}: ${messageOf(error)}`);
      continue;
    }
    // A manifest of its own makes this directory a package of its own, and its
    // files belong to it alone (Packages §2.2). The root is exempt: its manifest
    // is the one this walk is *for*.
    if (directoryIdentity !== rootIdentity && entries.some(isManifest)) {
      nested.push(directoryIdentity);
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      // A symlink reports as neither a file nor a directory, so a workspace that
      // links its source tree in — a common monorepo layout — would otherwise
      // get no language support at all, silently. `stat` follows the link to ask
      // what it actually points at.
      const kind = entry.isSymbolicLink() ? await resolvedKind(path) : entryKind(entry);
      if (kind === "directory") {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        pending.push(path);
      } else if (kind === "file" && entry.name.endsWith(HEXAGON_EXTENSION)) {
        const realPath = await realPathOf(path);
        // Excluded before deduplicated, not after. An excluded name that is a
        // link would otherwise claim its target's identity on the way out, and
        // the target — a legitimate file under its own name, reached later in
        // the same walk — would be dropped as a duplicate of something that is
        // not in the project at all.
        if (excludes(exclude, path, realPath)) continue;
        if (collected.has(realPath)) continue;
        collected.add(realPath);
        found.push({ path, realPath });
      }
    }
  }
  return { files: found, nested };
}

function isManifest(entry: { name: string; isDirectory(): boolean }): boolean {
  return entry.name === MANIFEST_NAME && !entry.isDirectory();
}

type EntryKind = "file" | "directory" | "other";

function entryKind(entry: { isFile(): boolean; isDirectory(): boolean }): EntryKind {
  if (entry.isDirectory()) return "directory";
  return entry.isFile() ? "file" : "other";
}

/** What a symlink points at, or `other` when it dangles or cannot be read. */
async function resolvedKind(path: string): Promise<EntryKind> {
  try {
    return entryKind(await stat(path));
  } catch {
    return "other";
  }
}
