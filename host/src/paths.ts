/**
 * One spelling of a path, for everything in the toolchain that compares two.
 *
 * A second, nearly-identical normalizer is the shape of bug this file exists to
 * prevent: two spellings of one file become two files, and the disagreement
 * shows up only on the path shape the author did not have — a UNC share, a
 * drive letter — where it then fails silently. The language server's session
 * keys by this, the walk compares against it, and `hexagon.json`'s `exclude`
 * matches under it, so it lives where all three can reach it.
 */

import { realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * The compiler's spelling: `/`-separated, `.` and `..` resolved.
 *
 * The leading `//` of a UNC path is kept, because it is part of the **root**
 * rather than a repeated separator: `//server/share` names a share, and
 * `/server/share` names a directory called `server` at the filesystem root — a
 * different place, on a machine that may not have one. Collapsing it made every
 * path under a Windows share compare equal to a path that does not exist.
 */
export function normalizePath(path: string): string {
  const forward = path.replaceAll("\\", "/");
  // Exactly two: three or more is POSIX's ordinary "one separator", and only
  // the two-slash form is the one Windows reads as a share.
  const unc = forward.startsWith("//") && !forward.startsWith("///");
  const absolute = forward.startsWith("/");
  const parts: string[] = [];
  for (const part of forward.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${unc ? "//" : absolute ? "/" : ""}${parts.join("/")}`;
}

/**
 * The **root** a normalized path stands on, as a prefix: `/` for POSIX, `C:`
 * for a drive, `//server/share` for a UNC share, and the empty string for a
 * relative path.
 *
 * A climb needs it because a root is where climbing stops, and rebuilding one
 * is how a walk comes to look for `/C:/proj/node_modules` on a machine whose
 * paths start `C:/`: every level then misses, and a lookup that finds no level
 * answers with no candidates rather than with an error.
 */
export function pathRoot(path: string): string {
  const normalized = normalizePath(path);
  if (normalized.startsWith("//")) {
    const [server, share] = normalized.slice(2).split("/");
    return share === undefined ? normalized : `//${server}/${share}`;
  }
  if (normalized.startsWith("/")) return "/";
  const first = normalized.split("/")[0] ?? "";
  return /^[A-Za-z]:$/u.test(first) ? first : "";
}

/**
 * The directory above this one, or nothing where it **is** a root.
 *
 * `dirname` alone does not answer this: on a POSIX runtime it takes `C:/proj`
 * to `C:` and then to `.`, so a loop that stops only at `dirname`'s fixed point
 * climbs past a Windows root into the current working directory. Stopping at
 * `pathRoot` is what makes one climb correct on every path shape.
 */
export function parentDirectoryOf(directory: string): string | undefined {
  const at = normalizePath(directory);
  if (at === pathRoot(at)) return undefined;
  const parent = normalizePath(dirname(at));
  return parent === at ? undefined : parent;
}

/** `directory` with one more component, without rebuilding its root. */
export function childDirectory(directory: string, name: string): string {
  const at = normalizePath(directory);
  return at.endsWith("/") ? `${at}${name}` : `${at}/${name}`;
}

/**
 * A path with every link followed, or the path itself if it cannot resolve.
 *
 * This is the project's and the package's **identity** (Packages §4.3): two
 * links reaching one directory are one copy, never two, and a file two roots
 * reach is one file. A path that cannot resolve — a dangling link, a directory
 * removed mid-walk — answers with itself, so the caller keeps a key rather than
 * a failure.
 */
export async function realPathOf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/**
 * The same identity, **synchronously**, and for a path that may not be there.
 *
 * Two departures from `realPathOf`, each with a caller that needs it. The first
 * is the blocking call: a language server answers hover, definition and rename
 * synchronously, and each has to settle which file the client's URI names
 * before it can ask anything about it. There is no correct guess — a root
 * reached through a link, which on macOS is every project under `/var` and
 * anywhere is a symlinked checkout or `$HOME`, spells every file under it twice
 * — so it is this call or a `null` answer in a workspace that looks perfectly
 * ordinary. It is made once per URI and remembered.
 *
 * The second is the **nearest existing ancestor**, however far up it is.
 * `realPathOf` answers with the path itself when nothing is there, which is the
 * right answer for identity and the wrong one for agreement: a file just
 * created, or just deleted, would wear a spelling no other path in the session
 * uses, so the new file would join no program and the deleted one would be
 * erased from none. Resolving the nearest ancestor that is still there and
 * re-appending the missing tail gives it the spelling it will have.
 *
 * One level up is not enough, and the case is ordinary: a branch switch or a
 * `git rm -r` takes a file **and its directory**, so the watcher's delete
 * arrives for a path with two missing components, and stopping at one would
 * leave it under the client's own spelling — which under a root reached through
 * a link is a name no program holds, so the deleted module is erased from none
 * and keeps publishing diagnostics until the next rediscovery. The climb costs
 * one `realpath` per missing level, is made once per URI and remembered, and
 * ends at the root at the latest. A path with no existing ancestor at all —
 * only a root that is not there — answers with its own name, in the one
 * spelling this function ever answers in.
 */
export function settledPathSync(path: string): string {
  try {
    // Normalized here as well as on the climb below. One function answering in
    // two spellings is the hazard this file exists to remove: on Windows
    // `realpathSync` hands back back-slashes while the climb rebuilds its
    // answer with forward ones, so a caller that did not normalize what it got
    // would hold one file under two names depending on nothing more than
    // whether the file was there.
    return normalizePath(realpathSync(path));
  } catch {
    const normalized = normalizePath(path);
    const tail: string[] = [];
    let at: string | undefined = normalized;
    while (at !== undefined) {
      const parent: string | undefined = parentDirectoryOf(at);
      if (parent === undefined) return normalized;
      tail.unshift(at.slice(parent.endsWith("/") ? parent.length : parent.length + 1));
      try {
        const resolved = normalizePath(realpathSync(parent));
        return tail.reduce((built, component) => childDirectory(built, component), resolved);
      } catch {
        at = parent;
      }
    }
    return normalized;
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
