/**
 * Tests for the one part of the server that touches a filesystem.
 *
 * Following symlinks turns the workspace walk from a tree into a graph, and a
 * graph walked without memory does not terminate on its own. These cases are
 * the ones a real workspace produces — a linked source tree, a link back to an
 * ancestor, two names for one file — and none of them is visible to a test that
 * only exercises the protocol.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const { added } = await workspace.addRoot(path, (message) => errors.push(message));
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

    await workspace.openDocument({
      uri,
      getText: () => "let value: Int = 2\n",
    } as never);
    await workspace.addRoot(path, () => {});
    // Re-scanning must not clobber the buffer: the user's unsaved text is what
    // they are looking at, and disk is what they have not saved yet.
    expect(workspace.session.hover(workspace.session.paths[0]!, 4)?.displayedType).toBe("Int");
    const definition = workspace.session.definitions(workspace.session.paths[0]!, 4);
    expect(definition).toHaveLength(1);
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
    await workspace.reloadManifest(path, () => {});
    expect(workspace.session.paths).toHaveLength(1);
    expect([...workspace.session.allDiagnostics().values()].flat()).toEqual([]);
  });

  test("a broken manifest still yields a working workspace", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "let value: Int = 1\n");
    await writeFile(join(path, MANIFEST_NAME), "{ oops");
    const workspace = new Workspace();
    const { added, manifest } = await workspace.addRoot(path, () => {});
    // The manifest's own failure must not take language support down with it.
    expect(added).toBe(1);
    expect(manifest.problems).toHaveLength(1);
    expect(workspace.session.hover(workspace.session.paths[0]!, 4)?.name).toBe("value");
  });
});
