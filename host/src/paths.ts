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

/** The directory a path sits in, `/`-separated and normalized. */
export function directoryOf(path: string): string {
  const normalized = normalizePath(path);
  const at = normalized.lastIndexOf("/");
  return at <= 0 ? "/" : normalized.slice(0, at);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
