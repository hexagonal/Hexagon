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

/** The compiler's spelling: `/`-separated, `.` and `..` resolved. */
export function normalizePath(path: string): string {
  const forward = path.replaceAll("\\", "/");
  const absolute = forward.startsWith("/");
  const parts: string[] = [];
  for (const part of forward.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
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
 * The second is the **nearest existing ancestor**. `realPathOf` answers with
 * the path itself when nothing is there, which is the right answer for identity
 * and the wrong one for agreement: a file just created, or just deleted, would
 * wear a spelling no other path in the session uses, so the new file would join
 * no program and the deleted one would be erased from none. Resolving the
 * directory and rejoining the name gives it the spelling it will have. A path
 * whose every ancestor is gone answers with itself.
 */
export function settledPathSync(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // Not the whole chain: one step up is where a create and a delete both sit,
    // and a loop climbing to the filesystem root would spend a syscall per
    // level on a path that is simply misspelled.
    const forward = path.replaceAll("\\", "/");
    const at = forward.lastIndexOf("/");
    if (at <= 0) return path;
    try {
      return `${realpathSync(forward.slice(0, at))}/${forward.slice(at + 1)}`;
    } catch {
      return path;
    }
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
