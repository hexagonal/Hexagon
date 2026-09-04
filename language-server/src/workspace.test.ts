/**
 * Tests for the one part of the server that touches a filesystem.
 *
 * Following symlinks turns the workspace walk from a tree into a graph, and a
 * graph walked without memory does not terminate on its own. These cases are
 * the ones a real workspace produces — a linked source tree, a link back to an
 * ancestor, two names for one file — and none of them is visible to a test that
 * only exercises the protocol.
 */

import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { MANIFEST_NAME } from "./manifest.js";
import { Workspace } from "./workspace.js";

let root = "";

async function makeRoot(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "hexagon-workspace-"));
  return root;
}

afterEach(async () => {
  if (root !== "") await rm(root, { recursive: true, force: true });
  root = "";
});

/** Scans a root, failing the test if the walk reported an error. */
async function scan(path: string): Promise<{ added: number; workspace: Workspace }> {
  const workspace = new Workspace();
  const errors: string[] = [];
  const { added } = await workspace.setRoots([path], (message: string) => errors.push(message));
  expect(errors).toEqual([]);
  return { added, workspace };
}

describe("the workspace walk", () => {
  test("finds Hexagon files and ignores everything else", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await writeFile(join(path, "notes.md"), "not source\n");
    await mkdir(join(path, "node_modules"));
    await writeFile(join(path, "node_modules", "vendored.hex"), "let other: Int = 2\n");

    const { added, workspace } = await scan(path);
    expect(added).toBe(1);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);
  });

  test("follows a symlinked source tree", async () => {
    const path = await makeRoot();
    const real = join(path, "real");
    await mkdir(real);
    await writeFile(join(real, "linked.hex"), "let value: Int = 1\n");
    await mkdir(join(path, "workspace"));
    await symlink(real, join(path, "workspace", "src"), "dir");

    // A directory entry that is a symlink reports as neither file nor directory,
    // so a walk that trusts `isDirectory()` alone silently finds nothing here —
    // and silence is indistinguishable from a workspace with no Hexagon in it.
    const { added } = await scan(join(path, "workspace"));
    expect(added).toBe(1);
  });

  test("a symlink loop terminates instead of multiplying the file", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await symlink(path, join(path, "loop"), "dir");

    // `ln -s . loop` makes a directory contain itself. Without memory the walk
    // descends until the path length stops it, and one file arrives as dozens of
    // modules at dozens of paths — each declaring `value`, each shadowing the
    // others. The scan must terminate, and it must find the file once.
    const { added, workspace } = await scan(path);
    expect(added).toBe(1);
    expect(workspace.session.paths).toHaveLength(1);
  });

  test("two links to one file are one module", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "export let value: Int = 1\n");
    await symlink(join(path, "main.hex"), join(path, "alias.hex"), "file");

    // Compiling one source twice would report every declaration in it as a
    // duplicate of itself, which is a diagnostic about the editor rather than
    // about the user's code.
    const { added, workspace } = await scan(path);
    expect(added).toBe(1);
    expect(workspace.session.allDiagnostics().get(workspace.session.paths[0]!)).toEqual([]);
  });

  test("opening a link to an already-scanned file does not double it", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "a-real.hex"), "export let value: Int = 1\n");
    await symlink(join(path, "a-real.hex"), join(path, "z-link.hex"), "file");
    const { workspace } = await scan(path);
    expect(workspace.session.paths).toHaveLength(1);

    // The walk dedupes by real path, but it chose which of the two names to
    // keep — and the user may well open the other one. Keying the buffer by its
    // URI would add a second module for one file, whose every declaration then
    // reports as a duplicate of itself.
    await workspace.openDocument({
      uri: workspace.uris.toUri(join(path, "z-link.hex")),
      getText: () => "export let value: Int = 2\n",
    } as never);
    expect(workspace.session.paths).toHaveLength(1);
    const only = workspace.session.paths[0]!;
    expect(workspace.session.allDiagnostics().get(only)).toEqual([]);
  });

  test("a dangling symlink is skipped, not reported as an error", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await symlink(join(path, "absent.hex"), join(path, "broken.hex"), "file");

    const { added } = await scan(path);
    expect(added).toBe(1);
  });

  test("an open buffer is not overwritten by the file on disk", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    const { workspace } = await scan(path);
    const uri = workspace.uris.toUri(workspace.session.paths[0]!);

    // The buffer differs from disk by the *name* it declares, not by the value.
    // Asserting on the type would prove nothing: `Int` is `Int` in both texts,
    // so the assertion would hold just as well against the disk text it is
    // supposed to rule out.
    await workspace.openDocument({
      uri,
      getText: () => "let renamed: Int = 2\n",
    } as never);
    await workspace.setRoots([path], () => {});
    // Re-scanning must not clobber the buffer: the user's unsaved text is what
    // they are looking at, and disk is what they have not saved yet.
    expect(workspace.session.hover(workspace.session.paths[0]!, 4)?.name).toBe("renamed");
  });

  test("`runtimePaths` privileges a module, and nothing else does", async () => {
    const path = await makeRoot();
    // `Node(a)` is the hidden trie node: it resolves only inside a privileged
    // runtime module. Without a manifest the server has no way to know which
    // files those are, which is what made the Hexagon repository greet everyone
    // with 38 errors that are not errors.
    // Private, because the checker separately forbids `Node` from crossing an
    // exported signature — privilege lets a module *name* it, not publish it.
    const runtime = "let size(node: Node(Int)): Int = 0\n";
    await writeFile(join(path, "trie.hex"), runtime);

    const plain = await scan(path);
    const unprivileged = plain.workspace.session.allDiagnostics().get(
      plain.workspace.session.paths[0]!,
    )!;
    expect(unprivileged.length).toBeGreaterThan(0);
    expect(unprivileged.some(({ message }) => message.includes("Node"))).toBe(true);

    await writeFile(
      join(path, MANIFEST_NAME),
      JSON.stringify({ runtimePaths: ["trie.hex"] }),
    );
    const privileged = await scan(path);
    expect(privileged.workspace.session.allDiagnostics().get(
      privileged.workspace.session.paths[0]!,
    )).toEqual([]);
  });

  test("`exclude` keeps a directory out of the project entirely", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await mkdir(join(path, "examples"));
    await writeFile(join(path, "examples", "broken.hex"), "let oops: Int = \n");

    const included = await scan(path);
    expect(included.added).toBe(2);
    expect([...included.workspace.session.allDiagnostics().values()].flat().length)
      .toBeGreaterThan(0);

    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["examples"] }));
    const excluded = await scan(path);
    expect(excluded.added).toBe(1);
    expect([...excluded.workspace.session.allDiagnostics().values()].flat()).toEqual([]);
  });

  test("reloading a manifest drops files it newly excludes", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await mkdir(join(path, "examples"));
    await writeFile(join(path, "examples", "broken.hex"), "let oops: Int = \n");
    const { workspace } = await scan(path);
    expect(workspace.session.paths).toHaveLength(2);

    // Rescanning alone cannot do this: a walk only ever adds. A file that has
    // left the project has to be taken out of the session, or its diagnostics
    // outlive the decision to exclude it.
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["examples"] }));
    await workspace.setRoots([path], () => {});
    expect(workspace.session.paths).toHaveLength(1);
    expect([...workspace.session.allDiagnostics().values()].flat()).toEqual([]);
  });

  test("a broken manifest still yields a working workspace", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await writeFile(join(path, MANIFEST_NAME), "{ oops");
    const workspace = new Workspace();
    const { added, manifests } = await workspace.setRoots([path], () => {});
    // The manifest's own failure must not take language support down with it.
    expect(added).toBe(1);
    expect(manifests.get(path)!.problems).toHaveLength(1);
    expect(workspace.session.hover(workspace.session.paths[0]!, 4)?.name).toBe("value");
  });

  test("an excluded file stays out however it is touched", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await mkdir(join(path, "generated"));
    const generated = join(path, "generated", "broken.hex");
    await writeFile(generated, "let oops: Int = \n");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["generated"] }));
    const { workspace } = await scan(path);
    expect(workspace.session.paths).toHaveLength(1);

    // Checking only at the walk means the next thing to touch the file puts it
    // back — and it then stays, so an exclusion lasts until a build runs or the
    // user opens the file once.
    const uri = workspace.uris.toUri(generated);
    await workspace.refreshFromDisk(uri);
    expect(workspace.session.paths).toHaveLength(1);

    await workspace.openDocument({ uri, getText: () => "let oops: Int = \n" } as never);
    expect(workspace.session.paths).toHaveLength(1);

    workspace.updateDocument({ uri, getText: () => "let oops: Int = 2\n" } as never);
    expect(workspace.session.paths).toHaveLength(1);
    expect([...workspace.session.allDiagnostics().values()].flat()).toEqual([]);
  });

  test("a file excluded while open does not return on the next keystroke", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await mkdir(join(path, "generated"));
    const generated = join(path, "generated", "broken.hex");
    await writeFile(generated, "let oops: Int = \n");
    const { workspace } = await scan(path);
    const uri = workspace.uris.toUri(generated);
    await workspace.openDocument({ uri, getText: () => "let oops: Int = \n" } as never);
    expect(workspace.session.paths).toHaveLength(2);

    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["generated"] }));
    await workspace.setRoots([path], () => {});
    expect(workspace.session.paths).toHaveLength(1);

    // The buffer is still open, so an edit still arrives. Without a check here
    // the workspace's contents would depend on whether the user has typed since
    // the manifest changed.
    workspace.updateDocument({ uri, getText: () => "let oops: Int = 3\n" } as never);
    expect(workspace.session.paths).toHaveLength(1);
  });

  test("un-excluding restores an open file without waiting for a keystroke", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await mkdir(join(path, "generated"));
    const generated = join(path, "generated", "extra.hex");
    await writeFile(generated, "let extra: Int = 2\n");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["generated"] }));
    const { workspace } = await scan(path);
    const uri = workspace.uris.toUri(generated);
    const document = { uri, getText: () => "let extra: Int = 2\n" } as never;
    await workspace.openDocument(document);
    expect(workspace.session.paths).toHaveLength(1);

    // A rescan reads disk and skips what the editor holds open, so a file that
    // has just stopped being excluded is in neither source: not on the walk's
    // list, and not re-applied from its buffer. It would stay missing until the
    // user happened to type in it — the same "depends on whether you typed"
    // failure as the opposite direction.
    await rm(join(path, MANIFEST_NAME));
    await workspace.setRoots([path], () => {});
    await workspace.openDocument(document);
    expect(workspace.session.paths).toHaveLength(2);
  });

  test("one root's exclusion does not depend on the order roots are walked", async () => {
    const path = await makeRoot();
    const a = join(path, "a");
    const b = join(path, "b");
    await mkdir(join(a, "gen"), { recursive: true });
    await mkdir(b, { recursive: true });
    await writeFile(join(a, "main.hex"), "let value: Int = 1\n");
    await writeFile(join(a, "gen", "g.hex"), "let generated: Int = 2\n");
    await writeFile(join(b, "other.hex"), "let other: Int = 3\n");
    // B's manifest excludes a directory under A. Reading every manifest before
    // any walk is what makes that hold whichever order the roots arrive in: the
    // walk already knows B's exclusion when it descends A, so `g.hex` is never
    // added in the first place. The trailing sweep would catch it too, but it
    // never has to here — deleting the sweep's exclusion branch leaves this test
    // green, which is why the claim belongs to the read order and not to it.
    await writeFile(join(b, MANIFEST_NAME), JSON.stringify({ exclude: [join(a, "gen")] }));

    const forwards = new Workspace();
    await forwards.setRoots([a, b], () => {});
    const backwards = new Workspace();
    await backwards.setRoots([b, a], () => {});
    const names = (w: Workspace) =>
      w.session.paths.map((p) => p.split("/").at(-1)).sort();
    expect(names(forwards)).toEqual(["main.hex", "other.hex"]);
    expect(names(backwards)).toEqual(["main.hex", "other.hex"]);

    // And reloading must not delete a file one root excludes and no later walk
    // restores — a sweep after every root would strand it until a restart.
    await forwards.setRoots([a, b], () => {});
    expect(names(forwards)).toEqual(["main.hex", "other.hex"]);
  });

  test("a file deleted from disk is gone after a rescan, with no watcher event", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await writeFile(join(path, "gone.hex"), "let other: Int = 2\n");
    const { workspace } = await scan(path);
    expect(workspace.session.paths).toHaveLength(2);

    // A branch switch deletes files without the editor reporting each one, and
    // a walk only ever adds — so without retiring what the walk no longer finds,
    // a deleted module keeps answering hover and definition forever.
    await rm(join(path, "gone.hex"));
    await workspace.setRoots([path], () => {});
    expect(workspace.session.paths).toHaveLength(1);
  });

  test("a disk delete does not silence an open buffer", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    const { workspace } = await scan(path);
    const uri = workspace.uris.toUri(workspace.session.paths[0]!);
    await workspace.openDocument({ uri, getText: () => "let value: Int = 2\n" } as never);

    // A branch switch deletes the file while the editor keeps its dirty buffer
    // open, and the watcher reports the delete. The buffer is still the truth:
    // dropping the file and its URI mapping would decline every later edit, so
    // the visibly open buffer loses diagnostics, hover, and navigation until
    // it is closed and reopened.
    await rm(join(path, "main.hex"));
    await workspace.deleteFile(uri);
    workspace.updateDocument({ uri, getText: () => "let renamed: Int = 2\n" } as never);
    expect(workspace.session.hover(workspace.session.paths[0]!, 4)?.name).toBe("renamed");
  });

  test("dropping a root drops its files", async () => {
    const path = await makeRoot();
    const a = join(path, "a");
    const b = join(path, "b");
    await mkdir(a);
    await mkdir(b);
    await writeFile(join(a, "one.hex"), "let one: Int = 1\n");
    await writeFile(join(b, "two.hex"), "let two: Int = 2\n");
    const workspace = new Workspace();
    await workspace.setRoots([a, b], () => {});
    expect(workspace.session.paths).toHaveLength(2);

    // `setRoots` names a replacement, not an addition. Leaving the old root's
    // files behind would make the method's name a lie the next caller trusts.
    await workspace.setRoots([a], () => {});
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["one.hex"]);
  });

  test("an open buffer survives a rescan that does not find it", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    const { workspace } = await scan(path);
    const uri = workspace.uris.toUri(workspace.session.paths[0]!);
    await workspace.openDocument({ uri, getText: () => "let value: Int = 9\n" } as never);

    // The walk skips what the editor holds open, so an open file is never among
    // the walked paths — retiring on that basis alone would delete every buffer
    // the user has open on the next rescan.
    await workspace.setRoots([path], () => {});
    expect(workspace.session.paths).toHaveLength(1);
    expect(workspace.session.hover(workspace.session.paths[0]!, 4)?.name).toBe("value");
  });

  test("a symlink does not smuggle an excluded directory back in", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "generated"));
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await writeFile(join(path, "generated", "broken.hex"), "let broken: Int = \n");
    // The walk follows symlinks on purpose, so an excluded directory has a
    // second name that the exclusion does not mention. Matching only the name
    // the walk arrived by would put every file back — with its diagnostics, the
    // exact thing `exclude` exists to silence.
    await symlink(join(path, "generated"), join(path, "gen-link"), "dir");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["generated"] }));

    const { workspace } = await scan(path);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);
    expect([...workspace.session.allDiagnostics().values()].flat()).toEqual([]);
  });

  // Skipped where the signal does not exist rather than passing on its absence.
  // Permission bits do not apply to root; and on Windows `chmod` on a directory
  // only toggles the read-only attribute, leaving `readdir` working — so the
  // test would pass whether or not the guard is there, which is worse than not
  // running it. `process.getuid` is itself undefined on Windows, so testing
  // only for root would have left exactly that case running.
  const cannotDetectDescent = process.platform === "win32" || process.getuid?.() === 0;
  test.skipIf(cannotDetectDescent)("an excluded directory reached by a link is not descended at all", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "generated", "deep"), { recursive: true });
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await symlink(join(path, "generated"), join(path, "gen-link"), "dir");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["generated"] }));
    // Rejecting the *files* inside an excluded directory would give the same
    // file set while still listing every directory under it, which is most of
    // the cost `exclude` is asked for — a generated tree is excluded because it
    // is big. An unreadable subdirectory makes that descent observable: reaching
    // it at all reports an error, so the guard is the difference between one
    // error and none, which no assertion about the file set can see.
    const unreadable = join(path, "generated", "deep");
    await chmod(unreadable, 0o000);

    const workspace = new Workspace();
    const errors: string[] = [];
    try {
      await workspace.setRoots([path], (message) => errors.push(message));
    } finally {
      // Restored whatever happened, or the temporary directory cannot be removed
      // and every later test in the file inherits the mess.
      await chmod(unreadable, 0o755);
    }
    expect(errors).toEqual([]);
  });

  test("a symlink to a single excluded file is excluded too", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "generated"));
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await writeFile(join(path, "generated", "broken.hex"), "let broken: Int = \n");
    await symlink(join(path, "generated", "broken.hex"), join(path, "alias.hex"), "file");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["generated"] }));

    const { added, workspace } = await scan(path);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);
    // The count, not just the final file set: the trailing sweep would remove
    // the alias afterwards either way, so only this says the walk never read it
    // — and the count is what the server reports to the user at startup.
    expect(added).toBe(1);
  });

  test("overlapping rescans settle on one manifest's answer", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "gen"));
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await writeFile(join(path, "gen", "g.hex"), "let generated: Int = 2\n");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["gen"] }));
    const workspace = new Workspace();

    // Overlapping calls that do not happen to interleave badly, which is the
    // ordinary case and worth pinning on its own. The damaging order — a second
    // call finishing while the first is parked mid-walk — needs the filesystem
    // held still, and lives in `workspace.concurrency.test.ts`.
    const first = workspace.setRoots([path], () => {});
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({}));
    const second = workspace.setRoots([path], () => {});
    await Promise.all([first, second]);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1)).sort())
      .toEqual(["g.hex", "main.hex"]);
  });

  test("two roots reaching one file through two names hold it once", async () => {
    const base = await makeRoot();
    await mkdir(join(base, "real"), { recursive: true });
    await writeFile(join(base, "real", "x.hex"), "let value: Int = 1\n");
    await symlink(join(base, "real"), join(base, "link"), "dir");

    // Deduplication that restarts at each root is no deduplication at all when
    // the duplicate spans roots — a monorepo folder opened beside a link into
    // it. The file would compile twice under two names, reporting every
    // declaration in it as a duplicate of itself.
    const workspace = new Workspace();
    const { added } = await workspace.setRoots([join(base, "link"), join(base, "real")], () => {});
    expect(added).toBe(1);
    expect(workspace.session.paths).toHaveLength(1);
    expect([...workspace.session.allDiagnostics().values()].flat()).toEqual([]);
  });

  test("a runtime module the walk never saw is still privileged", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "runtime"));
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await writeFile(
      join(path, MANIFEST_NAME),
      JSON.stringify({ runtimePaths: ["runtime/Trie.hex"] }),
    );
    const { workspace } = await scan(path);

    // Created after the scan — a branch switch, or the user — and delivered by
    // the watcher. The manifest named it before it existed, so privilege has to
    // survive the file arriving late.
    const runtime = join(path, "runtime", "Trie.hex");
    await writeFile(runtime, "let size(node: Node(Int)): Int = 0\n");
    await workspace.refreshFromDisk(pathToFileURL(runtime).toString());
    expect([...workspace.session.allDiagnostics().values()].flat()).toEqual([]);
  });

  test("an unsaved runtime module is privileged under the name as written", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "runtime"));
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await writeFile(
      join(path, MANIFEST_NAME),
      JSON.stringify({ runtimePaths: ["runtime/Trie.hex"] }),
    );
    const { workspace } = await scan(path);

    // A module that exists only as a buffer: the manifest names it and the walk
    // never saw it, so there is no recorded spelling to reuse. Nor is there a
    // file to resolve — an absent path resolves to itself — which is the case
    // the manifest's own unresolvable name is kept for, so that identity still
    // has something to match on.
    await workspace.openDocument({
      uri: workspace.uris.toUri(join(path, "runtime", "Trie.hex")),
      getText: () => "let size(node: Node(Int)): Int = 0\n",
    } as never);
    expect([...workspace.session.allDiagnostics().values()].flat()).toEqual([]);
  });

  test("an open runtime module keeps its privilege across a manifest reload", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "runtime"));
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({}));
    const { workspace } = await scan(path);

    // The module is created after the server started, so the first walk never
    // recorded a spelling for it, and it is open, so no later walk will either.
    const runtime = join(path, "runtime", "T.hex");
    await writeFile(runtime, "let size(node: Node(Int)): Int = 0\n");
    await workspace.openDocument({
      uri: workspace.uris.toUri(runtime),
      getText: () => "let size(node: Node(Int)): Int = 0\n",
    } as never);

    // Granting the privilege is the point of the file, and every grant is
    // rebuilt from scratch here — so a reload has to be able to reach a module
    // that identity alone cannot name. `#grantIfRuntime` cannot help: it answers
    // from `#pathOf`, which caches, so it fires once per URI and never again.
    await writeFile(
      join(path, MANIFEST_NAME),
      JSON.stringify({ runtimePaths: ["runtime/T.hex"] }),
    );
    await workspace.setRoots([path], () => {});
    expect([...workspace.session.allDiagnostics().values()].flat()).toEqual([]);
    // Still analysed, not merely quiet: a file dropped from the session also
    // reports nothing, and that would pass the assertion above for the wrong
    // reason entirely.
    expect(workspace.session.hover(workspace.uris.toPath(workspace.uris.toUri(runtime)), 4)?.name)
      .toBe("size");
  });

  test("a late runtime module is privileged under the name its route gave it", async () => {
    const base = await makeRoot();
    const path = join(base, "project");
    await mkdir(join(base, "external", "runtime"), { recursive: true });
    await mkdir(path);
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await symlink(join(base, "external", "runtime"), join(path, "rt-link"), "dir");
    await writeFile(
      join(path, MANIFEST_NAME),
      JSON.stringify({ runtimePaths: ["../external/runtime/Trie.hex"] }),
    );
    const { workspace } = await scan(path);

    // The walk never saw this file, so there is no recorded spelling to reuse —
    // and the route it arrives by names it through the link, which the manifest
    // does not mention. Identity is the resolved path, the one thing the two
    // spellings agree on.
    await writeFile(
      join(base, "external", "runtime", "Trie.hex"),
      "let size(node: Node(Int)): Int = 0\n",
    );
    await workspace.refreshFromDisk(pathToFileURL(join(path, "rt-link", "Trie.hex")).toString());
    expect([...workspace.session.allDiagnostics().values()].flat()).toEqual([]);
  });

  test("excluding a link does not delete the file it points at", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await symlink(join(path, "main.hex"), join(path, "alias.hex"), "file");
    // Resolving an exclusion's own components looks like the symmetrical thing
    // to do and silently deletes source: the link resolves to `main.hex`, so the
    // target leaves the project under its own legitimate name. Only the part of
    // the path the user did not write — the root — may be rewritten.
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["alias.hex"] }));

    const { workspace } = await scan(path);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);
  });

  test("excluding a linked directory does not delete the directory it points at", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "lib"));
    await writeFile(join(path, "lib", "kept.hex"), "export let kept: Int = 1\n");
    await writeFile(join(path, "main.hex"), 'import Kept\n\nlet used: Int = Kept.kept\n');
    await symlink(join(path, "lib"), join(path, "lib-link"), "dir");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["lib-link"] }));

    const { workspace } = await scan(path);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1)).sort())
      .toEqual(["kept.hex", "main.hex"]);
    // Over-exclusion does not merely lose files, it invents errors: a module
    // that vanishes takes every import of it down as unresolvable, so the user
    // is shown failures in code that is perfectly correct.
    expect([...workspace.session.allDiagnostics().values()].flat()).toEqual([]);
  });

  test("a runtime module keeps its privilege under the name the walk chose", async () => {
    const base = await makeRoot();
    const path = join(base, "project");
    await mkdir(join(base, "external", "runtime"), { recursive: true });
    await mkdir(path);
    // Private, because the checker separately forbids `Node` from crossing an
    // exported signature — privilege lets a module *name* it, not publish it.
    const runtime = "let size(node: Node(Int)): Int = 0\n";
    await writeFile(join(base, "external", "runtime", "Trie.hex"), runtime);
    // The real directory is outside the root, so the walk can only reach the
    // file through the link and always keys it under the link's spelling. The
    // compiler matches `runtimePaths` by exact equality against that key, so a
    // manifest naming the file's own path loses the privilege entirely, and
    // `unknown generic type `Node`` — the whole reason this file exists — comes
    // back with nothing to explain it. Placing it outside also makes that
    // certain rather than a matter of which name `readdir` returned first.
    await symlink(join(base, "external", "runtime"), join(path, "rt-link"), "dir");
    await writeFile(
      join(path, MANIFEST_NAME),
      JSON.stringify({ runtimePaths: ["../external/runtime/Trie.hex"] }),
    );

    const { workspace } = await scan(path);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["Trie.hex"]);
    expect([...workspace.session.allDiagnostics().values()].flat()).toEqual([]);
  });

  test("opening an excluded file by its symlinked name does not add it", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "generated"));
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await writeFile(join(path, "generated", "broken.hex"), "let broken: Int = \n");
    await symlink(join(path, "generated"), join(path, "gen-link"), "dir");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["generated"] }));
    const { workspace } = await scan(path);

    // Exclusion has to hold at every door into the session, and opening the file
    // under the link is a door the walk never used.
    const uri = workspace.uris.toUri(join(path, "gen-link", "broken.hex"));
    const document = { uri, getText: () => "let broken: Int = \n" };
    await workspace.openDocument(document as never);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);

    // And it must still hold on the next keystroke, which takes the sync path.
    workspace.updateDocument(document as never);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);
  });
});
