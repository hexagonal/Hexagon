/**
 * A repository rule rather than a rule about programs: no source file in the
 * toolchain carries a literal NUL byte.
 *
 * A separator between the parts of a deduplication key is naturally written
 * `\u0000`, and a string holding the byte itself reads identically in every
 * editor. The difference is invisible where it is written and total everywhere
 * else: `grep` and `rg` call a file holding a NUL *binary* and answer no
 * matches in it — silently, exit 0, no message — so every symbol the file
 * defines stops existing for the two search tools everyone uses, and a
 * `grep`-driven rename walks straight past it. `git grep` survives only by
 * accident, sniffing the first 8000 bytes.
 *
 * It lives in `host/` because the host is the package that walks the tree and
 * because its suite is quick; nothing about it is the host's subject.
 */

import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** The repository root: this file is `<root>/host/src/sources.test.ts`. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The five packages' source trees. */
const SOURCE_DIRECTORIES = [
  "compiler/src",
  "host/src",
  "language-server/src",
  "editors/vscode/src",
  "playground/src",
];

async function filesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [directory];
  for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) found.push(path);
    }
  }
  return found;
}

describe("the toolchain's own sources", () => {
  it("carry no literal NUL byte", async () => {
    const offenders: string[] = [];
    let examined = 0;
    for (const directory of SOURCE_DIRECTORIES) {
      for (const path of await filesUnder(join(ROOT, directory))) {
        examined += 1;
        if ((await readFile(path)).includes(0)) {
          offenders.push(path.slice(ROOT.length));
        }
      }
    }
    // The count guards the guard: a walk that found nothing would pass this
    // test without reading a byte, and it has a repository layout to be wrong
    // about.
    expect(examined).toBeGreaterThan(200);
    expect(offenders).toEqual([]);
  });
});
