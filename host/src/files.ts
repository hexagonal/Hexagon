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
import { messageOf, realPathOf } from "./paths.js";

export const HEXAGON_EXTENSION = ".hex";

/**
 * Directories never worth walking, whatever a project contains.
 *
 * `node_modules` is Packages §2.2's own exclusion; the rest are the host's
 * output and the tool directories every project has. `.claude` joins them
 * because an agent's scratch notes are not a project's source, and a `.hex`
 * example pasted into one would otherwise compile with it.
 */
export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".vscode",
  ".claude",
]);

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

export function entryKind(entry: { isFile(): boolean; isDirectory(): boolean }): EntryKind {
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
