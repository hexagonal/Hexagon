/**
 * The one test that needs the filesystem to hold still mid-walk.
 *
 * `setRoots` is called from a notification handler, and `vscode-jsonrpc` does
 * not await one before delivering the next — so two quick saves of
 * `hexagon.json` really do overlap. What makes that dangerous is that each call
 * is a *replacement*: it clears the merged manifests, recomputes the
 * exclusions, walks, and then sweeps away whatever its own walk did not find.
 * Interleaved, one call's sweep runs against another call's file set, and the
 * result belongs to neither manifest.
 *
 * The interleaving cannot be produced by timing alone, which is why this lives
 * apart from `workspace.test.ts`: it replaces `readdir` with one that can be
 * parked, so the second call is *guaranteed* to arrive inside the first one's
 * walk rather than merely likely to.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

/**
 * Parks the first `readdir` of a directory whose name ends in `parkAt`, once.
 *
 * Matched by name rather than by call count because the manifest reader also
 * reads directories — that is how it checks an entry's exact spelling — and a
 * counter would park in the wrong phase the moment that check changes. A
 * subdirectory only the walk descends is unambiguous.
 */
let parkAt: string | undefined;
let gate: Promise<void> | undefined;
/** Resolved the moment the walk is actually parked, so the test can be sure. */
let announceParked: () => void = () => {};

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      if (gate !== undefined && parkAt !== undefined && String(args[0]).endsWith(parkAt)) {
        const held = gate;
        gate = undefined;
        announceParked();
        await held;
      }
      return await actual.readdir(...args);
    },
  };
});

const { MANIFEST_NAME } = await import("./manifest.js");
const { Workspace } = await import("./workspace.js");

let root = "";

afterEach(async () => {
  gate = undefined;
  parkAt = undefined;
  if (root !== "") await rm(root, { recursive: true, force: true });
  root = "";
});

test("a rescan that starts mid-walk does not sweep the other one's files", async () => {
  root = await mkdtemp(join(tmpdir(), "hexagon-concurrent-"));
  await mkdir(join(root, "gen"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "main.hex"), "let value: Int = 1\n");
  await writeFile(join(root, "gen", "g.hex"), "let generated: Int = 2\n");
  await writeFile(join(root, "src", "s.hex"), "let sourced: Int = 3\n");
  await writeFile(join(root, MANIFEST_NAME), JSON.stringify({ exclude: ["gen"] }));
  const workspace = new Workspace();

  let release = (): void => {};
  parkAt = "/src";
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const parked = new Promise<void>((resolve) => {
    announceParked = resolve;
  });

  // The first call reads a manifest that excludes `gen`, computes exclusions
  // from it, and parks part-way through its walk — after the root, inside `src`.
  const first = workspace.setRoots([root], () => {});
  // Waited for rather than assumed: the manifest read before the walk is real
  // I/O of unknown length, so yielding a tick or two would sometimes issue the
  // second call before the first had started walking at all — which is a
  // different interleaving, and one the queue is not what fixes.
  await parked;
  // The manifest changes and a second call arrives while the first is parked.
  await writeFile(join(root, MANIFEST_NAME), JSON.stringify({}));
  const second = workspace.setRoots([root], () => {});
  // Give the second call the chance to run to completion before releasing the
  // first — that is the damaging order, where the first then resumes holding
  // exclusions the second has already replaced and sweeps against a file set it
  // never walked. Raced rather than awaited: serialized, the second call cannot
  // finish until the first does, and awaiting it here would deadlock the very
  // behaviour being tested.
  await Promise.race([second, new Promise((resolve) => setTimeout(resolve, 200))]);
  release();
  await Promise.all([first, second]);

  // Unserialized, the first call resumes holding exclusions the second has
  // already replaced, and its sweep retires `g.hex` — a file the second call
  // put there on purpose. The answer is then neither manifest's: the newer one
  // said to include it and the older one never saw it.
  expect(workspace.session.paths.map((path) => path.split("/").at(-1)).sort())
    .toEqual(["g.hex", "main.hex", "s.hex"]);
});
