/**
 * Which directories are **programs** (`compiler/architecture/environment.md`
 * §4, D1).
 *
 * One independent compilation context per project directory. A project
 * directory is the nearest directory at or above a root that holds a
 * `hexagon.json`; a root with no manifest at it or above it is a project under
 * an implicit empty manifest (Packages §2.5). A root *inside* a
 * `node_modules` is no exception and needs none: a user who opens
 * `node_modules/acme` is working on `Acme`, and answering with the enclosing
 * project would compile their edits under someone else's name. What
 * `node_modules` bounds is a package's **files** (§2.2, `files.ts`), not what
 * counts as a project. Two facts follow, and they are the whole of this file:
 *
 * - **An editor root inside a package belongs to that package's project.** The
 *   nearest manifest at or above the root decides, so opening `src/` of a
 *   package never creates a second project there and never discards the owning
 *   manifest. Ownership is settled before the implicit manifest is read.
 * - **A nested manifest is a project of its own, and leaves the enclosing
 *   one.** Packages §2.2 already says its files belong to it alone; here that
 *   makes it a second program, discovered by the enclosing project's own walk
 *   (`files.ts` reports the boundaries it stopped at).
 *
 * Identity is the canonical path throughout, so two roots reaching one
 * directory — a monorepo folder opened beside a link into it — are one project,
 * and roots never split an owned package.
 */

import { join } from "node:path";
import { holdsManifest, MANIFEST_NAME } from "./manifest.js";
import { normalizePath, parentDirectoryOf, realPathOf } from "./paths.js";

/** One program's root directory. */
export interface ProjectDirectory {
  /** The canonical directory — the project's identity. */
  readonly directory: string;
  /** Whether a `hexagon.json` sits at it (false → the implicit empty manifest). */
  readonly hasManifest: boolean;
  /** The editor roots that reached it, in the order the client sent them. */
  readonly roots: readonly string[];
}

/**
 * The project directories a set of editor roots describes, deduped by canonical
 * path and ordered by the root that first reached each.
 *
 * A root's own project comes before the projects nested beneath it, so a host
 * that answers a query "by the first program holding the file, in root order"
 * asks the enclosing project first.
 */
export async function projectDirectories(
  roots: readonly string[],
  nestedOf: (directory: string) => Promise<readonly string[]>,
): Promise<readonly ProjectDirectory[]> {
  const found = new Map<string, { hasManifest: boolean; roots: string[] }>();
  const claim = (directory: string, hasManifest: boolean, root: string): boolean => {
    const known = found.get(directory);
    if (known !== undefined) {
      if (!known.roots.includes(root)) known.roots.push(root);
      return false;
    }
    found.set(directory, { hasManifest, roots: [root] });
    return true;
  };
  for (const root of roots) {
    const canonical = normalizePath(await realPathOf(root));
    const owner = await enclosingManifestDirectory(canonical);
    const directory = owner ?? canonical;
    const fresh = claim(directory, owner !== undefined, root);
    // The nested walk is the enclosing project's own, so it runs once per
    // project rather than once per root: a second root reaching one project
    // finds the same boundaries, and finding them again would only cost.
    if (!fresh) continue;
    // Breadth-first, so a project's own nested packages keep the order the walk
    // met them in: the list is read in order by a host deciding which program
    // answers for a file, and an order that depends on a stack's direction
    // would decide that by accident.
    const pending = [directory];
    for (let at = 0; at < pending.length; at += 1) {
      for (const nested of await nestedOf(pending[at]!)) {
        if (claim(nested, true, root)) pending.push(nested);
      }
    }
  }
  return [...found].map(([directory, { hasManifest, roots: reached }]) => ({
    directory,
    hasManifest,
    roots: reached,
  }));
}

/**
 * The nearest directory at or above `from` holding a `hexagon.json`, or nothing.
 *
 * Walking up is what makes "a folder opened inside a package belongs to that
 * package's project" true (D1). It climbs to the filesystem root: a manifest is
 * a deliberate file, and the alternative — stopping at some depth — would make
 * ownership depend on how deep the user's checkout happens to sit.
 */
export async function enclosingManifestDirectory(
  from: string,
): Promise<string | undefined> {
  let at: string | undefined = normalizePath(from);
  while (at !== undefined) {
    if (await holdsManifest(at)) return at;
    at = parentDirectoryOf(at);
  }
  return undefined;
}

/** The path of a directory's own manifest, spelled once. */
export function manifestPathOf(directory: string): string {
  return normalizePath(join(directory, MANIFEST_NAME));
}
