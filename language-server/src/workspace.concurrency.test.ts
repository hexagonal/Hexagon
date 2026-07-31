/**
 * The tests that need the filesystem to hold still mid-operation.
 *
 * `setRoots` is called from a notification handler, and `vscode-jsonrpc` does
 * not await one before delivering the next — so a rescan really does overlap
 * with another rescan, with a document opening, and with a watcher-driven
 * reload. Every defect in that space has the same shape: a guard checked on
 * one side of an `await`, with the write it guards on the other, and the world
 * changing in between.
 *
 * None of these interleavings can be produced by timing alone, which is why
 * they live apart from `workspace.test.ts`: the filesystem is replaced with
 * one whose operations can be *parked*, so the overlapping call is guaranteed
 * to arrive inside the window rather than merely likely to.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test, vi } from "vitest";

/**
 * One pending park per operation, matched by path suffix rather than by call
 * count: the manifest reader and the walk share these operations, and a
 * counter would park in the wrong phase the moment either changes. A path only
 * the parked phase touches is unambiguous.
 */
const parks = new Map<string, { suffix: string; gate: Promise<void>; announce: () => void }>();

interface Parked {
  /** Resolved the moment the operation is actually parked, so a test can be sure. */
  readonly parked: Promise<void>;
  /** Lets the parked operation continue. */
  readonly release: () => void;
}

/** Parks the next call of this operation on a path ending in `suffix`, once. */
function parkNext(operation: "readdir" | "readFile" | "realpath", suffix: string): Parked {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let announce: () => void = () => {};
  const parked = new Promise<void>((resolve) => {
    announce = resolve;
  });
  parks.set(operation, { suffix, gate, announce });
  return { parked, release };
}

async function holdIfParked(operation: string, path: unknown): Promise<void> {
  const park = parks.get(operation);
  if (park === undefined || !String(path).endsWith(park.suffix)) return;
  parks.delete(operation);
  park.announce();
  await park.gate;
}

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      await holdIfParked("readdir", args[0]);
      return await actual.readdir(...args);
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      await holdIfParked("readFile", args[0]);
      return await actual.readFile(...args);
    },
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      await holdIfParked("realpath", args[0]);
      return await actual.realpath(...args);
    },
  };
});

const { MANIFEST_NAME } = await import("./manifest.js");
const { Workspace } = await import("./workspace.js");

let root = "";

afterEach(async () => {
  parks.clear();
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

  // The first call reads a manifest that excludes `gen`, computes exclusions
  // from it, and parks part-way through its walk — after the root, inside `src`.
  const { parked, release } = parkNext("readdir", "/src");
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

test("a buffer opened mid-scan is not overwritten by the scan's own read", async () => {
  root = await mkdtemp(join(tmpdir(), "hexagon-concurrent-"));
  await writeFile(join(root, "main.hex"), "let value: Int = 1\n");
  const workspace = new Workspace();

  // The scan checks that the file is not open, and then reads it. The document
  // opens inside that window, so the check passed on a world that has changed:
  // unguarded, the disk text lands on top of the user's unsaved edits.
  const { parked, release } = parkNext("readFile", "main.hex");
  const scan = workspace.setRoots([root], () => {});
  await parked;
  await workspace.openDocument({
    uri: pathToFileURL(join(root, "main.hex")).toString(),
    getText: () => "let renamed: Int = 2\n",
  } as never);
  release();
  await scan;

  expect(workspace.session.hover(workspace.session.paths[0]!, 4)?.name).toBe("renamed");
});

test("a reload in flight does not resurrect a file the manifest just excluded", async () => {
  root = await mkdtemp(join(tmpdir(), "hexagon-concurrent-"));
  await mkdir(join(root, "gen"));
  await writeFile(join(root, "main.hex"), "let value: Int = 1\n");
  await writeFile(join(root, "gen", "g.hex"), "let generated: Int = 2\n");
  const workspace = new Workspace();
  await workspace.setRoots([root], () => {});

  // A watcher event on `g.hex` starts a reload, which passes the exclusion
  // check — nothing is excluded yet — and parks inside its read. The manifest
  // then excludes `gen`, and the rescan's sweep retires the file. The reload's
  // write must not put it back: the exclusion the user just wrote would appear
  // to have no effect until the next event happened to touch the file.
  await writeFile(join(root, MANIFEST_NAME), JSON.stringify({ exclude: ["gen"] }));
  const { parked, release } = parkNext("readFile", "g.hex");
  const reload = workspace.refreshFromDisk(pathToFileURL(join(root, "gen", "g.hex")).toString());
  await parked;
  await workspace.setRoots([root], () => {});
  release();
  await reload;

  expect(workspace.session.paths.some((path) => path.endsWith("g.hex"))).toBe(false);
});

test("a reload in flight loses to a buffer that opened during it", async () => {
  root = await mkdtemp(join(tmpdir(), "hexagon-concurrent-"));
  await writeFile(join(root, "main.hex"), "let value: Int = 1\n");
  const workspace = new Workspace();
  await workspace.setRoots([root], () => {});

  // The reload checks that the file is not open, and then reads it. The user
  // opens it inside that window; the buffer is now the truth, and the disk
  // text the reload is holding must not be written over it.
  const uri = pathToFileURL(join(root, "main.hex")).toString();
  const { parked, release } = parkNext("readFile", "main.hex");
  const reload = workspace.refreshFromDisk(uri);
  await parked;
  await workspace.openDocument({
    uri,
    getText: () => "let renamed: Int = 2\n",
  } as never);
  release();
  await reload;

  expect(workspace.session.hover(workspace.session.paths[0]!, 4)?.name).toBe("renamed");
});

test("an edit before its open has settled does not invent a second file", async () => {
  root = await mkdtemp(join(tmpdir(), "hexagon-concurrent-"));
  const project = join(root, "workspace");
  await mkdir(project);
  await writeFile(join(project, "main.hex"), "export let value: Int = 1\n");
  // A link from outside the root, so the opened URI can never be the spelling
  // the walk kept: resolution is the only way the two can meet.
  await symlink(join(project, "main.hex"), join(root, "alias.hex"), "file");
  const workspace = new Workspace();
  await workspace.setRoots([project], () => {});
  expect(workspace.session.paths).toHaveLength(1);

  // The open is still resolving which session entry this URI is another name
  // for when the first keystroke arrives. Guessing the literal path would
  // write a second entry for one file — and that duplicate outlives the race,
  // reporting every declaration as a duplicate of itself from then on. The
  // edit can be declined instead, because the open reads the buffer's current
  // text once it settles.
  const uri = pathToFileURL(join(root, "alias.hex")).toString();
  const document = { uri, getText: () => "export let value: Int = 2\n" } as never;
  const { parked, release } = parkNext("realpath", "alias.hex");
  const opening = workspace.openDocument(document);
  await parked;
  workspace.updateDocument(document);
  release();
  await opening;

  expect(workspace.session.paths).toHaveLength(1);
});
