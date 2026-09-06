/**
 * The temporary directory a test runs its workspace in — under **both** of the
 * spellings a real editor root can have.
 *
 * A project directory settles by its canonical path (`host/projects.ts`), while
 * a client keeps sending the workspace folder it was given. Where the two
 * differ, every file in the workspace has two names, and a server that let both
 * of them exist answers `null` to hover, definition, references and rename in a
 * workspace that looks perfectly ordinary. That is not exotic: on macOS `/var`
 * is a link to `/private/var`, so it is every project under a temporary
 * directory, and anywhere it is a symlinked checkout or a linked `$HOME`.
 *
 * A suite whose roots are canonical cannot see any of it, and *whether* they
 * are is a property of the machine — this Mac's `TMPDIR` is under `/var` and a
 * Linux runner's is `/tmp`. So the suite runs twice, and the second run reaches
 * every root through a link it makes itself, which is non-canonical on every
 * platform rather than on the author's. `package.json`'s `test` script runs both
 * (`vitest.linked.config.ts` sets the variable); nothing else changes.
 */

import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Whether this run reaches its roots through a link. See the header. */
const LINKED = process.env["HEXAGON_TEST_LINKED_ROOT"] === "1";

/** Every directory a run has made, so a link's target is removed with it. */
const made: string[] = [];

/**
 * A fresh temporary directory, reached the way this run reaches roots.
 *
 * The link is *above* the returned directory rather than at it, so the path a
 * test hands the server has a resolved spelling that differs in its prefix —
 * which is the shape `/var` → `/private/var` has, and the shape that breaks a
 * server keying files by the client's spelling.
 */
export async function temporaryRoot(prefix: string): Promise<string> {
  const holder = await mkdtemp(join(tmpdir(), prefix));
  made.push(holder);
  if (!LINKED) return holder;
  await mkdir(join(holder, "real"));
  await symlink(join(holder, "real"), join(holder, "reached"), "dir");
  return join(holder, "reached");
}

/** Removes everything `temporaryRoot` made, links and targets alike. */
export async function removeTemporaryRoots(): Promise<void> {
  while (made.length > 0) {
    await rm(made.pop()!, { recursive: true, force: true });
  }
}
