/**
 * Tests for the one part of the server that touches a filesystem.
 *
 * Following symlinks turns the workspace walk from a tree into a graph, and a
 * graph walked without memory does not terminate on its own. These cases are
 * the ones a real workspace produces — a linked source tree, a link back to an
 * ancestor, two names for one file — and none of them is visible to a test that
 * only exercises the protocol.
 */

import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { MANIFEST_NAME, normalizePath, settledPathSync } from "../../host/src/index.js";
import { removeTemporaryRoots, temporaryRoot } from "../../host/src/test-roots.js";
import { Workspace } from "./workspace.js";

let root = "";

/**
 * The `module Main` header every `main.hex` fixture below carries (Modules
 * §2.1), named so the offsets that used to be written against a headerless file
 * say what they are measuring from rather than carrying its length as a digit.
 */
const HEADER = "module Main\n\n";

async function makeRoot(): Promise<string> {
  root = await temporaryRoot("hexagon-workspace-");
  return root;
}

afterEach(async () => {
  root = "";
  await removeTemporaryRoots();
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
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await writeFile(join(path, "notes.md"), "not source\n");
    await mkdir(join(path, "node_modules"));
    await writeFile(join(path, "node_modules", "vendored.hex"), "module Vendored\n\n" + "let other: Int = 2\n");

    const { added, workspace } = await scan(path);
    expect(added).toBe(1);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);
  });

  test("follows a symlinked source tree", async () => {
    const path = await makeRoot();
    const real = join(path, "real");
    await mkdir(real);
    await writeFile(join(real, "linked.hex"), "module Linked\n\n" + "let value: Int = 1\n");
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
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
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
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "export let value: Int = 1\n");
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
    await writeFile(join(path, "a-real.hex"), "module AReal\n\n" + "export let value: Int = 1\n");
    await symlink(join(path, "a-real.hex"), join(path, "z-link.hex"), "file");
    const { workspace } = await scan(path);
    expect(workspace.session.paths).toHaveLength(1);

    // The walk dedupes by real path, but it chose which of the two names to
    // keep — and the user may well open the other one. Keying the buffer by its
    // URI would add a second module for one file, whose every declaration then
    // reports as a duplicate of itself.
    await workspace.openDocument({
      uri: workspace.uris.toUri(join(path, "z-link.hex")),
      getText: () => "module AReal\n\nexport let value: Int = 2\n",
    } as never);
    expect(workspace.session.paths).toHaveLength(1);
    const only = workspace.session.paths[0]!;
    expect(workspace.session.allDiagnostics().get(only)).toEqual([]);
  });

  test("a dangling symlink is skipped, not reported as an error", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await symlink(join(path, "absent.hex"), join(path, "broken.hex"), "file");

    const { added } = await scan(path);
    expect(added).toBe(1);
  });

  test("an open buffer is not overwritten by the file on disk", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    const { workspace } = await scan(path);
    const uri = workspace.uris.toUri(workspace.session.paths[0]!);

    // The buffer differs from disk by the *name* it declares, not by the value.
    // Asserting on the type would prove nothing: `Int` is `Int` in both texts,
    // so the assertion would hold just as well against the disk text it is
    // supposed to rule out.
    await workspace.openDocument({
      uri,
      getText: () => "module Main\n\nlet renamed: Int = 2\n",
    } as never);
    await workspace.setRoots([path], () => {});
    // Re-scanning must not clobber the buffer: the user's unsaved text is what
    // they are looking at, and disk is what they have not saved yet.
    expect(workspace.session.hover(workspace.session.paths[0]!, HEADER.length + 4)?.name).toBe("renamed");
  });

  /**
   * Runtime privilege, at the seat `runtimePaths` used to hold (#829).
   *
   * `Node(a)` is the hidden fixed-32 trie node: it resolves only inside a
   * privileged runtime module, which is what made the Hexagon repository greet
   * everyone with 38 errors that were not errors. The manifest answered it with
   * a per-file grant; the standard library is now the package `Hex` in full and
   * the two runtime modules are members of it, so the privilege follows **the
   * name the header declares** and no manifest is consulted at all.
   *
   * Two files, one letter apart in what matters: `module Runtime.VectorTrie` is
   * the member the compiler seats and privileges, and `module Trie` is an
   * ordinary module of the project that may not name `Node`. Private in both,
   * because the checker separately forbids `Node` from crossing an exported
   * signature — privilege lets a module *name* it, not publish it.
   */
  test("a module declaring a runtime member's name is privileged, and nothing else is", async () => {
    const path = await makeRoot();
    await writeFile(
      join(path, "trie.hex"),
      "module Trie\n\n" + "let size(node: Node(Int)): Int = 0\n",
    );
    const plain = await scan(path);
    const unprivileged = plain.workspace.session.allDiagnostics().get(
      plain.workspace.session.paths[0]!,
    )!;
    expect(unprivileged.length).toBeGreaterThan(0);
    expect(unprivileged.some(({ message }) => message.includes("Node"))).toBe(true);

    await rm(join(path, "trie.hex"));
    await writeFile(
      join(path, "VectorTrie.hex"),
      "module Runtime.VectorTrie\n\n" + "let size(node: Node(Int)): Int = 0\n",
    );
    const privileged = await scan(path);
    // The `Node` report is gone and the emitter's two-sided contract is what is
    // left — the stub declares none of the trie's operations. That report is
    // this assertion's whole value: it says the file's reports **reach** the
    // session, so the absence of the `Node` one is a fact about privilege
    // rather than about a file nobody is publishing. It asserted `[]` until
    // #829's review round 5, and passed because a project file adopted into a
    // runtime seat is not in the emitted closure the analysis indexed by, so
    // every report in it — type errors included — was dropped on the floor.
    expect(
      privileged.workspace.session.allDiagnostics().get(
        privileged.workspace.session.paths[0]!,
      )?.map(({ message }) => message),
    ).toEqual([
      "this module is `Runtime.VectorTrie` but declares no `empty`, `get`, " +
      "`set`, `append`, `prepend`, `slice`, `window`, `concat`, `nodeRun`",
    ]);
    // Analysed, not merely quiet: a file dropped from the session reports
    // nothing either, and that would pass the line above for the wrong reason.
    expect(privileged.workspace.session.paths.map((each) => each.split("/").at(-1)))
      .toEqual(["VectorTrie.hex"]);
  });

  /**
   * The manifest's two package fields reaching the session (#836 review N4).
   * Both are observable through the compile itself rather than through the
   * option object: `name` is the first segment of every module's full name
   * (Packages §2.3), and `dependencies` is what Modules §2.2's first-segment
   * rule reads.
   */
  test("the manifest's `name` becomes the project's own package name", async () => {
    const path = await makeRoot();
    // A dotted module whose first segment is the project's own name: lawful
    // where the project has no name, refused the moment it declares one
    // (Modules §2.2, Packages §2.5).
    await writeFile(join(path, "geo.hex"), "module Acme.Geometry\n\n" + "let value: Int = 1\n");

    const unnamed = await scan(path);
    expect([...unnamed.workspace.session.allDiagnostics().values()].flat()).toEqual([]);

    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ name: "Acme" }));
    const named = await scan(path);
    expect(
      [...named.workspace.session.allDiagnostics().values()].flat().map(({ message }) => message),
    ).toEqual([
      "`Acme.Geometry` begins with the name of the package `Acme`; a dotted module's " +
      "first segment cannot name a package in the program; rename the module",
    ]);
  });

  test("the manifest's `dependencies` widens the first-segment rule", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "tools.hex"), "module Bolt.Tools\n\n" + "let value: Int = 1\n");

    const unlisted = await scan(path);
    // `Bolt` names no package in the program, so the dotted name is ordinary.
    expect([...unlisted.workspace.session.allDiagnostics().values()].flat()).toEqual([]);

    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ dependencies: ["Bolt"] }));
    const listed = await scan(path);
    expect(
      [...listed.workspace.session.allDiagnostics().values()].flat().map(({ message }) => message),
    ).toEqual([
      "`Bolt.Tools` begins with the name of the package `Bolt`; a dotted module's " +
      "first segment cannot name a package in the program; rename the module",
    ]);
  });

  test("`exclude` keeps a directory out of the project entirely", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await mkdir(join(path, "examples"));
    await writeFile(join(path, "examples", "broken.hex"), "module Broken\n\n" + "let oops: Int = \n");

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
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await mkdir(join(path, "examples"));
    await writeFile(join(path, "examples", "broken.hex"), "module Broken\n\n" + "let oops: Int = \n");
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
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await writeFile(join(path, MANIFEST_NAME), "{ oops");
    const workspace = new Workspace();
    const { added } = await workspace.setRoots([path], () => {});
    // The manifest's own failure must not take language support down with it.
    expect(added).toBe(1);
    expect(workspace.manifestProblems()).toHaveLength(1);
    expect(workspace.session.hover(workspace.session.paths[0]!, HEADER.length + 4)?.name).toBe("value");
  });

  test("an excluded file stays out however it is touched", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await mkdir(join(path, "generated"));
    const generated = join(path, "generated", "broken.hex");
    await writeFile(generated, "module Broken\n\n" + "let oops: Int = \n");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["generated"] }));
    const { workspace } = await scan(path);
    expect(workspace.session.paths).toHaveLength(1);

    // Checking only at the walk means the next thing to touch the file puts it
    // back — and it then stays, so an exclusion lasts until a build runs or the
    // user opens the file once.
    const uri = workspace.uris.toUri(generated);
    await workspace.refreshFromDisk(uri);
    expect(workspace.session.paths).toHaveLength(1);

    await workspace.openDocument({ uri, getText: () => "module Broken\n\nlet oops: Int = \n" } as never);
    expect(workspace.session.paths).toHaveLength(1);

    workspace.updateDocument({ uri, getText: () => "module Broken\n\nlet oops: Int = 2\n" } as never);
    expect(workspace.session.paths).toHaveLength(1);
    expect([...workspace.session.allDiagnostics().values()].flat()).toEqual([]);
  });

  test("a file excluded while open does not return on the next keystroke", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await mkdir(join(path, "generated"));
    const generated = join(path, "generated", "broken.hex");
    await writeFile(generated, "module Broken\n\n" + "let oops: Int = \n");
    const { workspace } = await scan(path);
    const uri = workspace.uris.toUri(generated);
    await workspace.openDocument({ uri, getText: () => "module Broken\n\nlet oops: Int = \n" } as never);
    expect(workspace.session.paths).toHaveLength(2);

    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["generated"] }));
    await workspace.setRoots([path], () => {});
    expect(workspace.session.paths).toHaveLength(1);

    // The buffer is still open, so an edit still arrives. Without a check here
    // the workspace's contents would depend on whether the user has typed since
    // the manifest changed.
    workspace.updateDocument({ uri, getText: () => "module Broken\n\nlet oops: Int = 3\n" } as never);
    expect(workspace.session.paths).toHaveLength(1);
  });

  test("a file deleted on disk while open keeps its buffer through a rediscovery", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    const helper = join(path, "helper.hex");
    await writeFile(helper, "module Helper\n\n" + "let helped: Int = 1\n");
    const { workspace } = await scan(path);
    const uri = workspace.uris.toUri(helper);
    // Dirty: the buffer says something disk never did.
    await workspace.openDocument({
      uri,
      getText: () => "module Helper\n\nlet helped: Int = 2\n",
    } as never);
    expect(workspace.session.paths).toHaveLength(2);

    // A branch switch deletes files the editor keeps open, and the sweep is the
    // only thing that reads the deletion — the walk cannot find the file, so
    // only the buffer says it is still there. Removing it would take a module a
    // reader is looking at out of the program, and the save that would restore
    // it is the one thing they cannot then do.
    await rm(helper);
    await workspace.setRoots([path], () => {});
    const key = workspace.pathFor(uri);
    expect(workspace.session.paths).toHaveLength(2);
    expect(workspace.programs[0]!.holds(key)).toBe(true);
    // The buffer's text, not disk's: the file has no disk text left at all.
    expect(workspace.session.hover(key, "module Helper\n\nlet ".length)?.name).toBe("helped");
  });

  test("un-excluding restores an open file without waiting for a keystroke", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await mkdir(join(path, "generated"));
    const generated = join(path, "generated", "extra.hex");
    await writeFile(generated, "module Extra\n\n" + "let extra: Int = 2\n");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["generated"] }));
    const { workspace } = await scan(path);
    const uri = workspace.uris.toUri(generated);
    const document = { uri, getText: () => "module Extra\n\nlet extra: Int = 2\n" } as never;
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

  /**
   * `exclude` is a field of a manifest, and a manifest describes one package:
   * the entries in it are about that project's own files and reach no other
   * program's (Packages §2.1, D1). A workspace holds several programs now, and
   * the walk already reads it this way — each project is walked with its own
   * manifest's exclusions — so a door that consulted every manifest at once
   * would answer differently from the walk about the same file, and which
   * answer a reader got would depend on whether the walk or a watcher event
   * reached it first.
   */
  test("one root's exclusion does not reach another root's files", async () => {
    const path = await makeRoot();
    const a = join(path, "a");
    const b = join(path, "b");
    await mkdir(join(a, "gen"), { recursive: true });
    await mkdir(b, { recursive: true });
    await writeFile(join(a, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await writeFile(join(a, "gen", "g.hex"), "module G\n\n" + "let generated: Int = 2\n");
    await writeFile(join(b, "other.hex"), "module Other\n\n" + "let other: Int = 3\n");
    // B's manifest names a directory under A. A's own manifest excludes
    // nothing, so A keeps every file it has, and B — which the entry cannot
    // reach either, since nothing of B's lies there — keeps its own.
    await writeFile(join(b, MANIFEST_NAME), JSON.stringify({ exclude: [join(a, "gen")] }));

    const forwards = new Workspace();
    await forwards.setRoots([a, b], () => {});
    const backwards = new Workspace();
    await backwards.setRoots([b, a], () => {});
    // Two roots are two programs (D1), so the file set is read across them:
    // what is being pinned is which files survive, not which program holds one.
    const names = (w: Workspace) =>
      w.programs.flatMap(({ session }) => session.paths)
        .map((p) => p.split("/").at(-1))
        .sort();
    // And the answer does not depend on the order the roots arrive in, which is
    // what every manifest being read before any walk buys.
    expect(names(forwards)).toEqual(["g.hex", "main.hex", "other.hex"]);
    expect(names(backwards)).toEqual(["g.hex", "main.hex", "other.hex"]);

    // Stable across a reload: the trailing sweep asks the same question the
    // walk did, so nothing is added by one and taken away by the other.
    await forwards.setRoots([a, b], () => {});
    expect(names(forwards)).toEqual(["g.hex", "main.hex", "other.hex"]);
  });

  /**
   * The nested case, which is the one a user meets: a project inside a project
   * (D1). The parent's `exclude` is about the parent's sources, and the nested
   * project's files are the nested project's — its own manifest is where its
   * own `exclude` goes.
   */
  test("a parent project's `exclude` does not empty the nested project it names", async () => {
    const path = await makeRoot();
    const nested = join(path, "packages", "geometry");
    await mkdir(join(nested, "generated"), { recursive: true });
    await writeFile(
      join(path, MANIFEST_NAME),
      JSON.stringify({ exclude: [join(nested, "generated")] }),
    );
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await writeFile(join(nested, MANIFEST_NAME), JSON.stringify({ name: "Geometry" }));
    await writeFile(join(nested, "shape.hex"), "module Shape\n\n" + "let sides: Int = 4\n");
    await writeFile(
      join(nested, "generated", "table.hex"),
      "module Table\n\n" + "let size: Int = 2\n",
    );

    const workspace = new Workspace();
    await workspace.setRoots([path], () => {});
    const held = workspace.programs
      .flatMap(({ session }) => session.paths)
      .map((p) => p.split("/").at(-1))
      .sort();
    expect(held).toEqual(["main.hex", "shape.hex", "table.hex"]);
    // Its own program holds it, and holds it as project source: the file is
    // `Geometry.Table`, not something the parent excluded on its behalf.
    const table = workspace.pathFor(
      pathToFileURL(join(nested, "generated", "table.hex")).toString(),
    );
    expect(workspace.programFor(table)!.directory.endsWith("/geometry")).toBe(true);
    expect(workspace.isExcludedUri(pathToFileURL(join(nested, "generated", "table.hex")).toString()))
      .toBe(false);
  });

  /**
   * The same rule where the entry names the nested project's **own root**,
   * which is where the two readings used to part company.
   *
   * A directory holding a `hexagon.json` of its own is already outside the
   * enclosing package's files (Packages §2.2) and is a program of its own (D1),
   * so the parent's entry names nothing of the parent's and cannot delete it.
   * The failure this pins is that the answer used to depend on whether the user
   * had also opened that folder as an editor root: opened, the nested program
   * existed and the entry applied to nothing; not opened, the walk never saw
   * the boundary — an excluded directory was never read — and a whole program
   * disappeared. Two manifests, two worlds, and nothing in either of them
   * saying so.
   */
  test("a parent's `exclude` naming a nested project's root leaves it standing, root or not", async () => {
    const path = await makeRoot();
    const nested = join(path, "packages", "geometry");
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(path, MANIFEST_NAME),
      JSON.stringify({ name: "App", exclude: ["packages/geometry"] }),
    );
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await writeFile(join(nested, MANIFEST_NAME), JSON.stringify({ name: "Geometry" }));
    await writeFile(join(nested, "shape.hex"), "module Shape\n\n" + "let sides: Int = 4\n");
    const uri = pathToFileURL(join(nested, "shape.hex")).toString();
    const base = normalizePath(settledPathSync(path));

    // Both configurations, and the assertions are one list: the point is not
    // that either answer is defensible on its own but that they are the same.
    for (const roots of [[path], [path, nested]]) {
      const workspace = new Workspace();
      await workspace.setRoots(roots, () => {});
      const shape = workspace.pathFor(uri);
      expect(workspace.programs.map(({ directory }) => directory.slice(base.length)))
        .toEqual(["", "/packages/geometry"]);
      expect(workspace.programFor(shape)!.directory).toBe(`${base}/packages/geometry`);
      expect(workspace.isExcludedUri(uri)).toBe(false);
      expect(workspace.programFor(shape)!.session.paths).toContain(shape);
      // And the user is told, at the manifest carrying the entry, that the
      // thing they wrote does nothing — the alternative being an entry that
      // sits in the file forever, plainly ignored, with no way to learn why.
      expect(workspace.manifestProblems()).toEqual([{
        path: `${base}/${MANIFEST_NAME}`,
        line: 0,
        message:
          "hexagon.json `exclude` entry \"packages/geometry\" names a package of its own " +
          "(it holds a `hexagon.json`), which is never part of this project; " +
          "the entry has no effect",
        severity: "warning",
      }]);
    }
  });

  /**
   * The same, where the entry *contains* the nested project rather than naming
   * it — and here the entry is not inert, so nothing is dropped and nothing is
   * reported: `packages/loose.hex` really is this project's and really does
   * leave. Only the boundary escapes, which is the walk's business rather than
   * the manifest reader's.
   */
  test("a parent's `exclude` containing a nested project leaves it standing, root or not", async () => {
    const path = await makeRoot();
    const nested = join(path, "packages", "geometry");
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(path, MANIFEST_NAME),
      JSON.stringify({ name: "App", exclude: ["packages"] }),
    );
    await writeFile(join(path, "main.hex"), HEADER + "let value: Int = 1\n");
    await writeFile(join(path, "packages", "loose.hex"), "module Loose\n");
    await writeFile(join(nested, MANIFEST_NAME), JSON.stringify({ name: "Geometry" }));
    await writeFile(join(nested, "shape.hex"), "module Shape\n\n" + "let sides: Int = 4\n");
    const base = normalizePath(settledPathSync(path));

    for (const roots of [[path], [path, nested]]) {
      const workspace = new Workspace();
      await workspace.setRoots(roots, () => {});
      const shape = workspace.pathFor(pathToFileURL(join(nested, "shape.hex")).toString());
      expect(workspace.programs.map(({ directory }) => directory.slice(base.length)))
        .toEqual(["", "/packages/geometry"]);
      expect(workspace.programFor(shape)!.directory).toBe(`${base}/packages/geometry`);
      // The entry did its work on the project's own file, which is gone; the
      // nested project's is not.
      expect(
        workspace.programs
          .flatMap(({ session }) => session.paths)
          .map((each) => each.split("/").at(-1))
          .sort(),
      ).toEqual(["main.hex", "shape.hex"]);
      expect(workspace.manifestProblems()).toEqual([]);
    }
  });

  /**
   * Which bound stranded a buffer, and that it stops saying so when the bound
   * goes.
   *
   * `server.ts` turns each of these into a sentence; what is settled here is
   * that the question is answered by the bound that actually decided, that a
   * file some program holds and a file an `exclude` entry keeps out are both
   * *not* this notice's business — the first has real diagnostics and the
   * second has a better sentence naming a line the user wrote — and that
   * opening the folder is enough to end it.
   */
  test("a stranded buffer is told which bound stranded it, until the bound goes", async () => {
    const path = await makeRoot();
    const acme = join(path, "node_modules", "acme");
    await mkdir(join(acme, "vendor"), { recursive: true });
    await mkdir(join(path, "dist"), { recursive: true });
    await mkdir(join(path, "node_modules", "loose"), { recursive: true });
    await mkdir(join(path, "generated"), { recursive: true });
    await writeFile(
      join(path, MANIFEST_NAME),
      JSON.stringify({ name: "App", dependencies: ["Acme"], exclude: ["generated"] }),
    );
    await writeFile(join(path, "main.hex"), HEADER + "let value: Int = 1\n");
    await writeFile(join(path, "generated", "made.hex"), "module Made\n");
    await writeFile(join(path, "dist", "built.hex"), "module Built\n");
    await writeFile(join(path, "node_modules", "loose", MANIFEST_NAME), '{"name":"Loose"}');
    await writeFile(join(path, "node_modules", "loose", "stray.hex"), "module Stray\n");
    await writeFile(join(acme, MANIFEST_NAME), '{"name":"Acme"}');
    await writeFile(join(acme, "lib.hex"), "module Lib\n");
    await writeFile(join(acme, "vendor", MANIFEST_NAME), '{"name":"Vendored"}');
    await writeFile(join(acme, "vendor", "inside.hex"), "module Inside\n");
    const uriOf = (...names: readonly string[]): string =>
      pathToFileURL(join(path, ...names)).toString();

    const workspace = new Workspace();
    await workspace.setRoots([path], () => {});
    // Held: it has diagnostics of its own, and a notice saying it has none
    // would be the false one.
    expect(workspace.outsideEveryPackage(uriOf("main.hex"))).toBeUndefined();
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "acme", "lib.hex")))
      .toBeUndefined();
    // Excluded: `exclude` has its own sentence, and it is the better one.
    expect(workspace.outsideEveryPackage(uriOf("generated", "made.hex"))).toBeUndefined();
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "loose", "stray.hex")))
      .toEqual({ kind: "unlisted-dependency", name: "Loose", manifest: MANIFEST_NAME });
    expect(workspace.outsideEveryPackage(uriOf("dist", "built.hex")))
      .toEqual({ kind: "skipped-directory", directory: "dist" });
    // The bound is asked of the package the file would have joined, not of the
    // project: `node_modules` lies between the project and this file, but
    // nothing lies between `acme` and it except the vendored manifest — which
    // is the one thing here a reader can act on.
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "acme", "vendor", "inside.hex")))
      .toEqual({
        kind: "other-package",
        manifest: `node_modules/acme/vendor/${MANIFEST_NAME}`,
      });

    // And the notice ends when the reason does, which is the whole reason to
    // publish it: opening the vendored package's folder makes it a program.
    await workspace.setRoots([path, join(acme, "vendor")], () => {});
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "acme", "vendor", "inside.hex")))
      .toBeUndefined();
  });

  /**
   * The bound a sentence names is the one that would be there **last**, because
   * each way out only moves the file to the next bound down.
   *
   * Both bounds can answer at once, and the boundary is always the outer of the
   * two — the walk prunes the skipped names, so a boundary it reported is never
   * behind one, and any skipped name therefore lies below it. Naming the outer
   * one and promising *its* repair is what this pins against: every shape here
   * was measured doing exactly what the outer bound's sentence asked, and in
   * each the file was still nobody's source afterwards. In the first, the entry
   * the reader was told to write also draws a Packages §7 report of its own,
   * which is a sentence that damages the manifest it names.
   */
  test("a bound below defeats the repair above it, so the lower bound is the one named", async () => {
    const path = await makeRoot();
    const acme = join(path, "node_modules", "acme");
    const loose = join(path, "node_modules", "loose");
    const extra = join(acme, "node_modules", "extra");
    await mkdir(join(acme, "vendor", "dist"), { recursive: true });
    await mkdir(join(acme, "vendor", "node_modules", "inner"), { recursive: true });
    await mkdir(extra, { recursive: true });
    await mkdir(join(loose, "dist"), { recursive: true });
    await mkdir(join(loose, "vendor"), { recursive: true });
    await mkdir(join(path, "node_modules", ".cache"), { recursive: true });
    await writeFile(
      join(path, MANIFEST_NAME),
      JSON.stringify({ name: "App", dependencies: ["Acme"] }),
    );
    await writeFile(join(path, "main.hex"), HEADER + "let value: Int = 1\n");
    await writeFile(join(acme, MANIFEST_NAME), '{"name":"Acme"}');
    await writeFile(join(acme, "lib.hex"), "module Lib\n");
    await writeFile(join(acme, "vendor", MANIFEST_NAME), '{"name":"Vendored"}');
    await writeFile(join(acme, "vendor", "dist", "built.hex"), "module Built\n");
    await writeFile(join(acme, "vendor", "node_modules", "inner", MANIFEST_NAME), '{"name":"Inner"}');
    await writeFile(join(acme, "vendor", "node_modules", "inner", "deep.hex"), "module Deep\n");
    await writeFile(join(extra, MANIFEST_NAME), '{"name":"Extra"}');
    await writeFile(join(extra, "extra.hex"), "module Extra\n");
    await writeFile(join(loose, MANIFEST_NAME), '{"name":"Loose"}');
    await writeFile(join(loose, "stray.hex"), "module Stray\n");
    await writeFile(join(loose, "dist", "built.hex"), "module Built\n");
    await writeFile(join(loose, "vendor", MANIFEST_NAME), '{"name":"LooseVendored"}');
    await writeFile(join(loose, "vendor", "inside.hex"), "module Inside\n");
    await writeFile(join(path, "node_modules", ".cache", "junk.hex"), "module Junk\n");
    const uriOf = (...names: readonly string[]): string =>
      pathToFileURL(join(path, ...names)).toString();

    const workspace = new Workspace();
    await workspace.setRoots([path], () => {});

    // Under **Acme's** `node_modules`. The manifest that could list `Extra` is
    // Acme's, which sits under a `node_modules` and is not the reader's to
    // edit; writing `Extra` into this project's own `dependencies` leaves the
    // file exactly as stranded and adds an entry drawing a §7 report.
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "acme", "node_modules", "extra", "extra.hex")))
      .toEqual({ kind: "unreached-node-modules", inside: "Acme" });
    // Under the vendored package's own `dist`, so opening the vendored folder
    // — which the boundary's sentence would have offered — changes nothing.
    // The answer is the same before and after, which is the point.
    const built = uriOf("node_modules", "acme", "vendor", "dist", "built.hex");
    expect(workspace.outsideEveryPackage(built))
      .toEqual({ kind: "skipped-directory", directory: "dist" });
    await workspace.setRoots([path, join(acme, "vendor")], () => {});
    expect(workspace.outsideEveryPackage(built))
      .toEqual({ kind: "skipped-directory", directory: "dist" });
    await workspace.setRoots([path], () => {});

    // The `node_modules` of the **vendored** package, not of `Acme`: the bound
    // belongs to the boundary the walk stopped at, whose name this server never
    // read, so the sentence names no package. Naming `Acme` here would send the
    // reader to a manifest that has nothing to do with this file — which is
    // what asking the bounds in the other order does.
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "acme", "vendor", "node_modules", "inner", "deep.hex")))
      .toEqual({ kind: "unreached-node-modules", inside: undefined });

    // Under an unlisted package's own `dist`: listing `Loose` would leave the
    // file under a name no manifest can argue with.
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "loose", "dist", "built.hex")))
      .toEqual({ kind: "skipped-directory", directory: "dist" });
    // Inside a package vendored in an unlisted package: listing `Loose` would
    // not reach it either, but this folder can be opened.
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "loose", "vendor", "inside.hex")))
      .toEqual({
        kind: "other-package",
        manifest: `node_modules/loose/vendor/${MANIFEST_NAME}`,
      });
    // And a `node_modules` holding no package at all: there is nothing to list,
    // so nothing is offered.
    expect(workspace.outsideEveryPackage(uriOf("node_modules", ".cache", "junk.hex")))
      .toEqual({ kind: "unreached-node-modules", inside: undefined });
    // The shape that is still repairable, beside them, so that the guard above
    // is a rule and not a refusal to answer: `Loose` itself is one entry away.
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "loose", "stray.hex")))
      .toEqual({ kind: "unlisted-dependency", name: "Loose", manifest: MANIFEST_NAME });
  });

  /**
   * And the `dependencies` sentence is offered only where there is an entry to
   * write, which is a fact about the package's **manifest** and not about its
   * directory.
   *
   * §4.1 seats a package by the name its own `hexagon.json` declares, so a
   * package that declares none is reached by no entry at all. Telling a reader
   * to list it sends them to write the directory's name, which leaves the same
   * silence and adds an entry drawing a §7 report — the exact harm the rule
   * above is about, one step further in. This is not a contrived shape: `name`
   * is optional for a project nobody publishes (§2.1), and `npm link` puts
   * exactly such a project under `node_modules`.
   */
  test("a package with no name to list is named as a bound rather than offered", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "node_modules", "nameless"), { recursive: true });
    await mkdir(join(path, "node_modules", "broken"), { recursive: true });
    await mkdir(join(path, "node_modules", "shouty"), { recursive: true });
    await mkdir(join(path, "node_modules", "loose"), { recursive: true });
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ name: "App" }));
    await writeFile(join(path, "main.hex"), HEADER + "let value: Int = 1\n");
    // A linked workspace project: lawful, and nameless.
    await writeFile(join(path, "node_modules", "nameless", MANIFEST_NAME), "{}");
    await writeFile(join(path, "node_modules", "nameless", "n.hex"), "module N\n");
    await writeFile(join(path, "node_modules", "broken", MANIFEST_NAME), "{ not json");
    await writeFile(join(path, "node_modules", "broken", "b.hex"), "module B\n");
    // A `name` §2.1 refuses is no name either, and the judgement is the
    // compiler's: a host that accepted it would offer an entry no lookup seats.
    await writeFile(join(path, "node_modules", "shouty", MANIFEST_NAME), '{"name":"acme"}');
    await writeFile(join(path, "node_modules", "shouty", "s.hex"), "module S\n");
    await writeFile(join(path, "node_modules", "loose", MANIFEST_NAME), '{"name":"Loose"}');
    await writeFile(join(path, "node_modules", "loose", "stray.hex"), "module Stray\n");
    const uriOf = (...names: readonly string[]): string =>
      pathToFileURL(join(path, ...names)).toString();

    const workspace = new Workspace();
    await workspace.setRoots([path], () => {});
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "nameless", "n.hex")))
      .toEqual({
        kind: "nameless-dependency",
        manifest: `node_modules/nameless/${MANIFEST_NAME}`,
        unreadable: false,
      });
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "shouty", "s.hex")))
      .toEqual({
        kind: "nameless-dependency",
        manifest: `node_modules/shouty/${MANIFEST_NAME}`,
        unreadable: false,
      });
    // Unreadable is its own answer, because the reader's next step differs:
    // there may be a name in there, behind a comma.
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "broken", "b.hex")))
      .toEqual({
        kind: "nameless-dependency",
        manifest: `node_modules/broken/${MANIFEST_NAME}`,
        unreadable: true,
      });
    // Beside them, the shape that is still one entry away, so that the guard is
    // a rule and not a refusal to answer.
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "loose", "stray.hex")))
      .toEqual({ kind: "unlisted-dependency", name: "Loose", manifest: MANIFEST_NAME });

    // And writing a name into the nameless manifest is what ends it — the
    // repair the sentence points at, taken.
    await writeFile(
      join(path, "node_modules", "nameless", MANIFEST_NAME),
      JSON.stringify({ name: "Nameless" }),
    );
    await workspace.setRoots([path], () => {});
    expect(workspace.outsideEveryPackage(uriOf("node_modules", "nameless", "n.hex")))
      .toEqual({ kind: "unlisted-dependency", name: "Nameless", manifest: MANIFEST_NAME });
  });

  /**
   * A dependency the user also opened as a root of its own owns its **own**
   * `node_modules`, and that is what makes the sentence a repairable one.
   *
   * One directory is then two candidates — a project of the editor's and a
   * package of the outer project's closure — and which of them answers decides
   * what the reader is told. As a project it has a manifest they have open, so
   * a file inside a package of its `node_modules` is one entry away; as a
   * package it is a bound with nothing to offer. Every project is listed before
   * every package and the deepest search keeps the *first* at the maximum
   * length, which is what settles it, in either order the roots arrive.
   */
  test("a dependency opened as a root answers for its own `node_modules`", async () => {
    const path = await makeRoot();
    const acme = join(path, "node_modules", "acme");
    const extra = join(acme, "node_modules", "extra");
    await mkdir(extra, { recursive: true });
    await writeFile(
      join(path, MANIFEST_NAME),
      JSON.stringify({ name: "App", dependencies: ["Acme"] }),
    );
    await writeFile(join(path, "main.hex"), HEADER + "let value: Int = 1\n");
    await writeFile(join(acme, MANIFEST_NAME), '{"name":"Acme"}');
    await writeFile(join(acme, "lib.hex"), "module Lib\n");
    await writeFile(join(extra, MANIFEST_NAME), '{"name":"Extra"}');
    await writeFile(join(extra, "extra.hex"), "module Extra\n");
    const uri = pathToFileURL(join(extra, "extra.hex")).toString();

    const workspace = new Workspace();
    // With only the outer project open, `Acme` is a package of its closure and
    // the manifest that could list `Extra` is not the reader's to edit.
    await workspace.setRoots([path], () => {});
    expect(workspace.outsideEveryPackage(uri))
      .toEqual({ kind: "unreached-node-modules", inside: "Acme" });
    // Open `Acme` as well and the same directory is a project: its own
    // `hexagon.json` is on screen, and one entry in it seats the file.
    for (const roots of [[path, acme], [acme, path]]) {
      await workspace.setRoots(roots, () => {});
      expect(workspace.outsideEveryPackage(uri))
        .toEqual({ kind: "unlisted-dependency", name: "Extra", manifest: MANIFEST_NAME });
    }
  });


  /**
   * The third case of the same rule, and the only one that can change a report
   * in the user's **own** source: a dependency's `exclude` is about the
   * dependency's files, and every door has to read it.
   *
   * The walk does — `filesOf` walks each package of the closure with that
   * package's own manifest — so a door that asked the *project's* entries
   * instead put a module the package excluded into the package, by the accident
   * of the user opening one file inside a dependency. `import Acme.Secret` then
   * resolved, and the report on `main.hex` changed to a sentence about
   * something else.
   */
  test("a dependency's own `exclude` keeps its files out at every door", async () => {
    const build = async (): Promise<{ path: string; secret: string; workspace: Workspace }> => {
      const path = await makeRoot();
      await writeFile(
        join(path, MANIFEST_NAME),
        JSON.stringify({ name: "App", dependencies: ["Acme"] }),
      );
      await writeFile(
        join(path, "main.hex"),
        "module Main\n\nimport Acme.Secret\n\nlet used: Int = Secret.hidden\n",
      );
      const acme = join(path, "node_modules", "acme");
      await mkdir(join(acme, "generated"), { recursive: true });
      await writeFile(
        join(acme, MANIFEST_NAME),
        JSON.stringify({ name: "Acme", exclude: ["generated"] }),
      );
      await writeFile(join(acme, "lib.hex"), "module Lib\n\nexport let one: Int = 1\n");
      await writeFile(
        join(acme, "generated", "secret.hex"),
        "module Secret\n\nexport let hidden: Int = 7\n",
      );
      const workspace = new Workspace();
      await workspace.setRoots([path], () => {});
      return { path, secret: join(acme, "generated", "secret.hex"), workspace };
    };
    const refused = (workspace: Workspace, path: string): readonly string[] =>
      workspace.session
        .diagnostics(workspace.pathFor(pathToFileURL(join(path, "main.hex")).toString()))
        .map(({ message }) => message);
    const text = "module Secret\n\nexport let hidden: Int = 7\n";

    for (const door of ["open", "watcher", "rediscovery while open"] as const) {
      const { path, secret, workspace } = await build();
      // The walk already leaves it out, which is what the doors have to agree
      // with: `Acme` ships `generated/` and does not call it source.
      expect(refused(workspace, path)).toEqual([
        "no module `Acme.Secret`",
        "no module alias `Secret`",
      ]);
      const uri = pathToFileURL(secret).toString();
      if (door === "watcher") {
        await workspace.refreshFromDisk(uri);
      } else {
        await workspace.openDocument({ uri, getText: () => text } as never);
        if (door === "rediscovery while open") await workspace.setRoots([path], () => {});
      }
      const key = workspace.pathFor(uri);
      expect(workspace.isExcludedUri(uri)).toBe(true);
      expect(workspace.programs[0]!.holds(key)).toBe(false);
      expect(workspace.session.paths.map((p) => p.split("/").at(-1)).sort())
        .toEqual(["lib.hex", "main.hex"]);
      expect(refused(workspace, path)).toEqual([
        "no module `Acme.Secret`",
        "no module alias `Secret`",
      ]);
    }
  });

  /**
   * The mirror, and the one a user writes without thinking: `node_modules` is
   * inside the project directory, so a project entry matched against a
   * dependency's files empties every dependency of source — with no manifest
   * report, since the entry names a directory that is really there — and every
   * import of them refused for a reason nothing on screen names.
   */
  test("a project's `exclude` does not reach its dependencies", async () => {
    const build = async (exclude: readonly string[]): Promise<Workspace> => {
      const path = await makeRoot();
      await writeFile(
        join(path, MANIFEST_NAME),
        JSON.stringify({ name: "App", dependencies: ["Acme"], exclude }),
      );
      await writeFile(
        join(path, "main.hex"),
        "module Main\n\nimport Acme.Lib\n\nlet n: Int = Lib.one\n",
      );
      await mkdir(join(path, "examples"), { recursive: true });
      await writeFile(join(path, "examples", "broken.hex"), "module Broken\n\nlet oops: Int = \n");
      const acme = join(path, "node_modules", "acme");
      await mkdir(acme, { recursive: true });
      await writeFile(join(acme, MANIFEST_NAME), JSON.stringify({ name: "Acme" }));
      await writeFile(join(acme, "lib.hex"), "module Lib\n\nexport let one: Int = 1\n");
      const workspace = new Workspace();
      await workspace.setRoots([path], () => {});
      return workspace;
    };
    const names = (workspace: Workspace): readonly string[] =>
      workspace.session.paths.map((p) => p.split("/").at(-1)!).sort();

    // The entry is read — `examples/` is out — and it stops at the project's own
    // files: the dependency keeps its source and the import still resolves.
    const guarded = await build(["examples", "node_modules"]);
    expect(names(guarded)).toEqual(["lib.hex", "main.hex"]);
    expect([...guarded.allDiagnostics().values()].flat()).toEqual([]);
    // Identical but for the entry, so the comparison is about `exclude` alone.
    const open = await build(["examples"]);
    expect(names(open)).toEqual(names(guarded));
    expect([...open.allDiagnostics().values()].flat()).toEqual([]);
  });

  test("a file deleted from disk is gone after a rescan, with no watcher event", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await writeFile(join(path, "gone.hex"), "module Gone\n\n" + "let other: Int = 2\n");
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
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    const { workspace } = await scan(path);
    const uri = workspace.uris.toUri(workspace.session.paths[0]!);
    await workspace.openDocument({ uri, getText: () => "module Main\n\nlet value: Int = 2\n" } as never);

    // A branch switch deletes the file while the editor keeps its dirty buffer
    // open, and the watcher reports the delete. The buffer is still the truth:
    // dropping the file and its URI mapping would decline every later edit, so
    // the visibly open buffer loses diagnostics, hover, and navigation until
    // it is closed and reopened.
    await rm(join(path, "main.hex"));
    await workspace.deleteFile(uri);
    workspace.updateDocument({ uri, getText: () => "module Main\n\nlet renamed: Int = 2\n" } as never);
    expect(workspace.session.hover(workspace.session.paths[0]!, HEADER.length + 4)?.name).toBe("renamed");
  });

  /**
   * A watcher's delete arrives for a URI the walk may never have named, so the
   * path it settles to has to be the one the walk *would* have given the file —
   * which means resolving a path that is no longer there. Under a root reached
   * through a link (every project under `/var` or `/tmp` on macOS, and any
   * symlinked checkout anywhere) an unresolved spelling is a name no program
   * holds, so the erase erases nothing and the deleted module goes on
   * publishing diagnostics and taking part in resolution.
   */
  test("a deleted file is erased even though its own path no longer resolves", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await mkdir(join(path, "old"));
    await writeFile(join(path, "old", "a.hex"), "module Old.A\n");
    const { workspace } = await scan(path);
    expect(workspace.session.paths).toHaveLength(2);

    await rm(join(path, "old", "a.hex"));
    await workspace.deleteFile(pathToFileURL(join(path, "old", "a.hex")).toString());
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);
  });

  /**
   * The same delete with the file's **directory** gone too — a branch switch or
   * a `git rm -r`, which is how a directory of modules usually leaves. Only a
   * climb to the nearest ancestor that still exists answers here; stopping one
   * level up leaves the path spelled as the client spelled it.
   */
  test("a deleted file whose directory went with it is erased too", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await mkdir(join(path, "old", "deep"), { recursive: true });
    await writeFile(join(path, "old", "deep", "a.hex"), "module Old.A\n");
    await writeFile(join(path, "old", "deep", "b.hex"), "module Old.B\n");
    const { workspace } = await scan(path);
    expect(workspace.session.paths).toHaveLength(3);

    await rm(join(path, "old"), { recursive: true });
    for (const name of ["a.hex", "b.hex"]) {
      await workspace.deleteFile(pathToFileURL(join(path, "old", "deep", name)).toString());
    }
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);
  });

  /**
   * A `hexagon.json` reaches the compiler as a **record** (Packages §4.1),
   * never as a file — and the editor really does send one, because the manifest
   * is synchronised so the `dependencies` repair is measured against the buffer
   * it lands in. Seating it would put a JSON file into a program, and would
   * invalidate the whole analysis on every keystroke in it.
   */
  test("an open `hexagon.json` buffer is never seated in a program", async () => {
    const path = await makeRoot();
    await writeFile(join(path, MANIFEST_NAME), "{}\n");
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    const { workspace } = await scan(path);
    const before = { paths: [...workspace.session.paths], version: workspace.session.version };

    const uri = pathToFileURL(join(path, MANIFEST_NAME)).toString();
    await workspace.openDocument({ uri, getText: () => '{ "name": "App" }\n' } as never);
    workspace.updateDocument({ uri, getText: () => '{ "name": "Ap" }\n' } as never);
    expect(workspace.session.paths).toEqual(before.paths);
    expect(workspace.session.version).toBe(before.version);
  });

  test("dropping a root drops its files", async () => {
    const path = await makeRoot();
    const a = join(path, "a");
    const b = join(path, "b");
    await mkdir(a);
    await mkdir(b);
    await writeFile(join(a, "one.hex"), "module One\n\n" + "let one: Int = 1\n");
    await writeFile(join(b, "two.hex"), "module Two\n\n" + "let two: Int = 2\n");
    const workspace = new Workspace();
    await workspace.setRoots([a, b], () => {});
    // Two roots, two programs, one file each — and neither sees the other's
    // (D1): two open folders meet only through an installed dependency.
    expect(workspace.programs.map(({ session }) => session.paths.length)).toEqual([1, 1]);

    // `setRoots` names a replacement, not an addition. Leaving the old root's
    // program behind would make the method's name a lie the next caller trusts.
    await workspace.setRoots([a], () => {});
    expect(workspace.programs.flatMap(({ session }) => session.paths)
      .map((p) => p.split("/").at(-1))).toEqual(["one.hex"]);
  });

  test("an open buffer survives a rescan that does not find it", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    const { workspace } = await scan(path);
    const uri = workspace.uris.toUri(workspace.session.paths[0]!);
    await workspace.openDocument({ uri, getText: () => "module Main\n\nlet value: Int = 9\n" } as never);

    // The walk skips what the editor holds open, so an open file is never among
    // the walked paths — retiring on that basis alone would delete every buffer
    // the user has open on the next rescan.
    await workspace.setRoots([path], () => {});
    expect(workspace.session.paths).toHaveLength(1);
    expect(workspace.session.hover(workspace.session.paths[0]!, HEADER.length + 4)?.name).toBe("value");
  });

  test("a symlink does not smuggle an excluded directory back in", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "generated"));
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await writeFile(join(path, "generated", "broken.hex"), "module Broken\n\n" + "let broken: Int = \n");
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
  /**
   * An excluded directory **is** descended, and only for boundaries.
   *
   * It used not to be, and the reason was cost: a generated tree is excluded
   * because it is big, and listing every directory under it is most of what
   * `exclude` is asked to save. What changed is that a `hexagon.json` beneath
   * such a directory is a package of its own and a program of its own, which
   * §2.2 puts outside this project before any `exclude` is read — so an entry
   * that stopped the walk there deleted a program the entry never named, and
   * only when the user had not also opened that folder as a root. Finding the
   * boundary costs one `readdir` per directory in the excluded subtree, and
   * nothing else: no file is collected, no identity is resolved, and the
   * tooling directories still prune the descent.
   *
   * The unreadable subdirectory is what makes the *silence* observable. It is
   * reached now, and reporting it would put an error in the user's face about
   * a directory they told this host not to read.
   */
  test.skipIf(cannotDetectDescent)("an excluded directory is descended for boundaries alone, in silence", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "generated", "deep"), { recursive: true });
    await mkdir(join(path, "generated", "inner"), { recursive: true });
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await writeFile(join(path, "generated", "broken.hex"), "module Broken\n\n" + "let x: Int = \n");
    await writeFile(join(path, "generated", "inner", MANIFEST_NAME), '{"name":"Inner"}');
    await writeFile(join(path, "generated", "inner", "kept.hex"), "module Kept\n");
    await symlink(join(path, "generated"), join(path, "gen-link"), "dir");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["generated"] }));
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
    // The files stay out — the descent collects nothing — and the package
    // beneath the exclusion is a program with its own source.
    const base = normalizePath(settledPathSync(path));
    expect(workspace.programs.map(({ directory }) => directory.slice(base.length)))
      .toEqual(["", "/generated/inner"]);
    expect(
      workspace.programs.flatMap(({ session }) => session.paths).map((p) => p.split("/").at(-1)),
    ).toEqual(["main.hex", "kept.hex"]);
  });

  test("a symlink to a single excluded file is excluded too", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "generated"));
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await writeFile(join(path, "generated", "broken.hex"), "module Broken\n\n" + "let broken: Int = \n");
    await symlink(join(path, "generated", "broken.hex"), join(path, "alias.hex"), "file");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["generated"] }));

    const { added, workspace } = await scan(path);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);
    // The count, not just the final file set: the trailing sweep would remove
    // the alias afterwards either way, so only this says the walk never read it
    // — and the count is what the server reports to the user at startup.
    expect(added).toBe(1);
  });

  /**
   * A file's **identity** outlives one visit to it, and has to.
   *
   * `#erase` takes a removed file out of the path-identity maps, so the second
   * of two watcher events on one file finds no resolved name for it — and the
   * resolved name is the whole of the answer here, since the exclusion names a
   * directory this file reaches only through a link. Asking with one spelling
   * where the file has two says "not excluded", and the file the user excluded
   * comes back on a second save with nothing said.
   *
   * The identity is carried on the URI cache instead, which is what makes the
   * removal safe: it is re-established at the first door the file reaches, with
   * no syscall a keystroke has to pay for.
   */
  test("a file excluded through the name it resolves to stays out when the watcher fires twice", async () => {
    const base = await makeRoot();
    const path = join(base, "project");
    await mkdir(join(base, "outside"), { recursive: true });
    await mkdir(path);
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({}));
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await writeFile(
      join(base, "outside", "thing.hex"),
      "module Thing\n\n" + "export let n: Int = 1\n",
    );
    // The only way into the project, so the walk keys the file under the link's
    // spelling and its resolved name shares no prefix with it.
    await symlink(join(base, "outside"), join(path, "linked"), "dir");

    const workspace = new Workspace();
    await workspace.setRoots([path], () => {});
    expect(workspace.session.paths.map((p) => p.split("/").at(-1)).sort())
      .toEqual(["main.hex", "thing.hex"]);

    await writeFile(
      join(path, MANIFEST_NAME),
      JSON.stringify({ exclude: [join(base, "outside")] }),
    );
    await workspace.setRoots([path], () => {});
    const uri = pathToFileURL(join(path, "linked", "thing.hex")).toString();
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);

    // Two events, because one save is not the case that fails: the first erases
    // the file and its identity with it, and the second is the one that has to
    // find the identity again.
    for (const _ of [1, 2]) {
      await workspace.refreshFromDisk(uri);
      expect(workspace.isExcludedUri(uri)).toBe(true);
      expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);
    }
  });

  /**
   * And the map that is **not** cleared, for the reason measured here: which
   * spelling the walk chose for a resolved file is a fact about the workspace,
   * not about whether the file exists this second. Dropping it makes a file
   * recreated under its *other* name arrive as a path the project does not
   * contain — so a delete-then-restore, which `git checkout` does to whole
   * directories, leaves the file out of the program until a rediscovery.
   */
  test("a file the walk reached through a link rejoins under the name the walk chose", async () => {
    const base = await makeRoot();
    const path = join(base, "project");
    await mkdir(join(base, "outside"), { recursive: true });
    await mkdir(path);
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    const outside = join(base, "outside", "thing.hex");
    await writeFile(outside, "module Thing\n\n" + "export let n: Int = 1\n");
    await symlink(join(base, "outside"), join(path, "linked"), "dir");

    const workspace = new Workspace();
    await workspace.setRoots([path], () => {});
    const walked = workspace.pathFor(pathToFileURL(join(path, "linked", "thing.hex")).toString());
    expect(walked.endsWith("/project/linked/thing.hex")).toBe(true);

    await rm(outside);
    await workspace.deleteFile(pathToFileURL(join(path, "linked", "thing.hex")).toString());
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);

    // Restored, and the event names it the other way — which is what the
    // filesystem reports for a directory that is really over there.
    await writeFile(outside, "module Thing\n\n" + "export let n: Int = 2\n");
    await workspace.refreshFromDisk(pathToFileURL(outside).toString());
    expect(workspace.pathFor(pathToFileURL(outside).toString())).toBe(walked);
    expect(workspace.programs[0]!.holds(walked)).toBe(true);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1)).sort())
      .toEqual(["main.hex", "thing.hex"]);
  });

  test("overlapping rescans settle on one manifest's answer", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "gen"));
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await writeFile(join(path, "gen", "g.hex"), "module G\n\n" + "let generated: Int = 2\n");
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
    await writeFile(join(base, "real", "x.hex"), "module X\n\n" + "let value: Int = 1\n");
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

  test("excluding a link does not delete the file it points at", async () => {
    const path = await makeRoot();
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
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
    await writeFile(join(path, "lib", "kept.hex"), "module Kept\n\n" + "export let kept: Int = 1\n");
    await writeFile(
      join(path, "main.hex"),
      "module Main\n\n" + "import Kept\n\nlet used: Int = Kept.kept\n",
    );
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

  /**
   * The hazard class the path-keyed grant carried, gone with it.
   *
   * The real directory is outside the root, so the walk can only reach the file
   * through the link and always keys it under the link's spelling. When
   * privilege was matched by exact path equality, a manifest naming the file's
   * own path lost it entirely and `unknown generic type `Node`` came back with
   * nothing to explain it — which is why four tests stood here pinning the
   * grant under each name a file can be reached by. A declared name is the same
   * under every spelling, so the whole class has one case now.
   */
  test("a runtime member is privileged under whatever name the walk chose", async () => {
    const base = await makeRoot();
    const path = join(base, "project");
    await mkdir(join(base, "external", "runtime"), { recursive: true });
    await mkdir(path);
    await writeFile(
      join(base, "external", "runtime", "VectorTrie.hex"),
      "module Runtime.VectorTrie\n\n" + "let size(node: Node(Int)): Int = 0\n",
    );
    await symlink(join(base, "external", "runtime"), join(path, "rt-link"), "dir");

    const { workspace } = await scan(path);
    expect(workspace.session.paths.map((each) => each.split("/").at(-1)))
      .toEqual(["VectorTrie.hex"]);
    // No `Node` report: the privilege followed the declared name under the only
    // spelling this file has. The stub's incomplete wiring is the one report
    // left, and it is what says the file is being analysed at all.
    expect([...workspace.session.allDiagnostics().values()].flat().map(({ message }) => message))
      .toEqual([
        "this module is `Runtime.VectorTrie` but declares no `empty`, `get`, " +
        "`set`, `append`, `prepend`, `slice`, `window`, `concat`, `nodeRun`",
      ]);
  });

  test("opening an excluded file by its symlinked name does not add it", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "generated"));
    await writeFile(join(path, "main.hex"), "module Main\n\n" + "let value: Int = 1\n");
    await writeFile(join(path, "generated", "broken.hex"), "module Broken\n\n" + "let broken: Int = \n");
    await symlink(join(path, "generated"), join(path, "gen-link"), "dir");
    await writeFile(join(path, MANIFEST_NAME), JSON.stringify({ exclude: ["generated"] }));
    const { workspace } = await scan(path);

    // Exclusion has to hold at every door into the session, and opening the file
    // under the link is a door the walk never used.
    const uri = workspace.uris.toUri(join(path, "gen-link", "broken.hex"));
    const document = { uri, getText: () => "module Broken\n\nlet broken: Int = \n" };
    await workspace.openDocument(document as never);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);

    // And it must still hold on the next keystroke, which takes the sync path.
    workspace.updateDocument(document as never);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);
  });
});

/**
 * D1 and D3: several programs over one file set.
 *
 * A dependency's source can sit in two programs' closures at once, and every
 * rule below is about what that costs a reader — one file, one identity, its
 * reports merged rather than doubled, and its buffer's text reaching both.
 */
describe("programs, and a file two of them hold", () => {
  const manifest = (fields: Readonly<Record<string, unknown>>): string =>
    `${JSON.stringify(fields, undefined, 2)}\n`;

  /** Two projects that both depend on one hoisted `Acme`. */
  async function sharedDependency(broken: boolean): Promise<{ path: string; acme: string }> {
    const path = await makeRoot();
    for (const project of ["a", "b"]) {
      await mkdir(join(path, project), { recursive: true });
      await writeFile(join(path, project, MANIFEST_NAME), manifest({ dependencies: ["Acme"] }));
      await writeFile(join(path, project, "main.hex"), "module Main\n\nimport Acme.Geometry\n");
    }
    await mkdir(join(path, "node_modules", "acme"), { recursive: true });
    await writeFile(join(path, "node_modules", "acme", MANIFEST_NAME), manifest({ name: "Acme" }));
    const acme = join(path, "node_modules", "acme", "geometry.hex");
    await writeFile(
      acme,
      broken
        ? "module Geometry\n\nexport let width: Int = \"oops\"\n"
        : "module Geometry\n\nexport let width: Int = 3\n",
    );
    return { path, acme };
  }

  test("two projects each hold the dependency, and each keeps its own analysis", async () => {
    const { path, acme } = await sharedDependency(false);
    const workspace = new Workspace();
    await workspace.setRoots([join(path, "a"), join(path, "b")], () => {});
    expect(workspace.programs).toHaveLength(2);
    const held = workspace.programs.filter((program) =>
      program.holds(workspace.pathFor(pathToFileURL(acme).toString()))
    );
    expect(held).toHaveLength(2);
    // And neither *owns* it: it is nobody's project source, so no editor root
    // is asked to answer for a file under `node_modules`.
    expect(held.every((program) => !program.owns(
      workspace.pathFor(pathToFileURL(acme).toString()),
    ))).toBe(true);
  });

  test("one fault in a shared dependency is published once, not once per program", async () => {
    const { path, acme } = await sharedDependency(true);
    const workspace = new Workspace();
    await workspace.setRoots([join(path, "a"), join(path, "b")], () => {});
    const key = workspace.pathFor(pathToFileURL(acme).toString());
    const reported = workspace.allDiagnostics().get(key) ?? [];
    // Both programs compile the file and both fail on it; a reader sees the
    // fault once (D3's "identical reports once").
    expect(reported).toHaveLength(1);
  });

  test("a buffer over a dependency's file reaches every program holding it", async () => {
    const { path, acme } = await sharedDependency(true);
    const workspace = new Workspace();
    await workspace.setRoots([join(path, "a"), join(path, "b")], () => {});
    const uri = pathToFileURL(acme).toString();
    await workspace.openDocument({
      uri,
      getText: () => "module Geometry\n\nexport let width: Int = 3\n",
    } as never);
    const key = workspace.pathFor(uri);
    expect(workspace.allDiagnostics().get(key) ?? []).toEqual([]);
    for (const program of workspace.programs) {
      expect(program.session.diagnostics(key)).toEqual([]);
    }
  });

  test("a file is answered by the program that owns it as project source", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "vendor"), { recursive: true });
    await writeFile(join(path, MANIFEST_NAME), manifest({}));
    await writeFile(join(path, "main.hex"), "module Main\n\nlet n: Int = 1\n");
    await writeFile(join(path, "vendor", MANIFEST_NAME), manifest({ name: "Vendor" }));
    await writeFile(join(path, "vendor", "thing.hex"), "module Thing\n\nlet n: Int = 1\n");
    const workspace = new Workspace();
    await workspace.setRoots([path], () => {});
    const main = workspace.pathFor(pathToFileURL(join(path, "main.hex")).toString());
    const thing = workspace.pathFor(pathToFileURL(join(path, "vendor", "thing.hex")).toString());
    expect(workspace.programFor(main)!.directory.endsWith("vendor")).toBe(false);
    expect(workspace.programFor(thing)!.directory.endsWith("vendor")).toBe(true);
  });

  test("a `.hex` file created under a dependency joins every program holding it", async () => {
    const { path } = await sharedDependency(false);
    const workspace = new Workspace();
    await workspace.setRoots([join(path, "a"), join(path, "b")], () => {});
    const added = join(path, "node_modules", "acme", "extra.hex");
    await writeFile(added, "module Extra\n\nexport let n: Int = 1\n");
    await workspace.refreshFromDisk(pathToFileURL(added).toString());
    const key = workspace.pathFor(pathToFileURL(added).toString());
    expect(workspace.programs.filter((program) => program.holds(key))).toHaveLength(2);
    // And it compiles as `Acme`'s, so its own name is `Acme.Extra`: seated in
    // the package it belongs to, never as either project's own source.
    for (const program of workspace.programs) {
      expect(program.owns(key)).toBe(false);
      expect(program.session.diagnostics(key)).toEqual([]);
    }
  });

  /**
   * The other half of that rule: a `node_modules` no closure reaches is nobody's
   * source, least of all the enclosing project's.
   *
   * `npm install`ing a Hexagon package and forgetting the `dependencies` entry
   * is the ordinary way to arrive here, and the server's watcher glob covers
   * every `.hex` in the workspace, so the install itself delivers the event to
   * this door and nothing else has to happen. Adopting the file
   * would compile the dependency's module under the *project's* package name
   * (Packages §2.2, §3.1) and answer the very import Packages §7's
   * not-a-dependency report exists to refuse — a correct refusal turning into a
   * silent resolution, with one watcher event and nothing said.
   */
  test("a file under an unlisted `node_modules` package is nobody's project source", async () => {
    const path = await makeRoot();
    await writeFile(join(path, MANIFEST_NAME), manifest({}));
    await writeFile(join(path, "main.hex"), "module Main\n\nimport Geometry\n");
    await mkdir(join(path, "node_modules", "acme"), { recursive: true });
    await writeFile(join(path, "node_modules", "acme", MANIFEST_NAME), manifest({ name: "Acme" }));
    const geometry = join(path, "node_modules", "acme", "geometry.hex");
    await writeFile(geometry, "module Geometry\n\nexport let width: Int = 3\n");

    const workspace = new Workspace();
    await workspace.setRoots([path], () => {});
    const main = workspace.pathFor(pathToFileURL(join(path, "main.hex")).toString());
    const refused = workspace.session.diagnostics(main).map(({ message }) => message);
    expect(refused).toContain("no module `Geometry`");

    const uri = pathToFileURL(geometry).toString();
    await workspace.refreshFromDisk(uri);
    const key = workspace.pathFor(uri);
    expect(workspace.programs[0]!.owns(key)).toBe(false);
    expect(workspace.programs[0]!.holds(key)).toBe(false);
    expect(workspace.session.paths).toHaveLength(1);
    // And the refusal still stands, which is the thing a reader would notice.
    expect(workspace.session.diagnostics(main).map(({ message }) => message)).toEqual(refused);
  });

  /**
   * The same bound for the rest of `files.ts`'s skipped names. They are one
   * host's convenience rather than a rule of the language, but a walk that
   * skips a build output and a door that adopts what it left behind disagree
   * about what the project is, and which answer a reader gets then depends on
   * whether a watcher happened to fire.
   */
  test("a file created under a skipped tooling directory is not adopted", async () => {
    const path = await makeRoot();
    await writeFile(join(path, MANIFEST_NAME), manifest({}));
    await writeFile(join(path, "main.hex"), "module Main\n\nlet n: Int = 1\n");
    const workspace = new Workspace();
    await workspace.setRoots([path], () => {});

    await mkdir(join(path, "dist"), { recursive: true });
    const generated = join(path, "dist", "generated.hex");
    await writeFile(generated, "module Generated\n\nlet n: Int = 1\n");
    const uri = pathToFileURL(generated).toString();
    await workspace.refreshFromDisk(uri);
    const key = workspace.pathFor(uri);
    expect(workspace.programs[0]!.owns(key)).toBe(false);
    expect(workspace.programs[0]!.holds(key)).toBe(false);
    expect(workspace.session.paths).toHaveLength(1);
  });

  /**
   * The bound is on what lies *between* a project and a file, never on the
   * project's own name: a user who opens `node_modules/acme` is working on
   * `Acme` (D1), and a file they create there is that project's own source.
   */
  test("a root inside `node_modules` still adopts its own new files", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "node_modules", "acme"), { recursive: true });
    const acme = join(path, "node_modules", "acme");
    await writeFile(join(acme, MANIFEST_NAME), manifest({ name: "Acme" }));
    await writeFile(join(acme, "geometry.hex"), "module Geometry\n\nlet n: Int = 1\n");
    const workspace = new Workspace();
    await workspace.setRoots([acme], () => {});

    const added = join(acme, "extra.hex");
    await writeFile(added, "module Extra\n\nlet n: Int = 2\n");
    const uri = pathToFileURL(added).toString();
    await workspace.refreshFromDisk(uri);
    expect(workspace.programs[0]!.owns(workspace.pathFor(uri))).toBe(true);
  });

  /**
   * npm's ordinary nested install: `App` lists `Acme`, `Acme` lists `Bolt`, and
   * `Bolt` is installed under `Acme`'s own `node_modules` because the two
   * versions of it could not be hoisted together. Both packages are in the
   * closure, and `Acme`'s directory **contains** `Bolt`'s, so a file under
   * `Bolt` is inside two packages at once.
   *
   * The deepest is the one it belongs to (Packages §2.2, "its files belong to
   * it alone, so no file ever has two full names"). Giving it to both compiles
   * one file twice, as `Acme.Lib` and as `Bolt.Lib`, and Modules §2.2's
   * duplicate rule then fires on the collision with the real `Acme.Lib` —
   * naming two files under `node_modules` that the reader did not write and
   * cannot correct.
   */
  test("a file created under a nested closure package joins it, not the package around it", async () => {
    const path = await makeRoot();
    await writeFile(join(path, MANIFEST_NAME), manifest({ name: "App", dependencies: ["Acme"] }));
    await writeFile(join(path, "main.hex"), "module Main\n\nimport Acme.Lib\n\nlet n: Int = Lib.one\n");
    const acme = join(path, "node_modules", "acme");
    const bolt = join(acme, "node_modules", "bolt");
    await mkdir(bolt, { recursive: true });
    await writeFile(join(acme, MANIFEST_NAME), manifest({ name: "Acme", dependencies: ["Bolt"] }));
    await writeFile(
      join(acme, "lib.hex"),
      "module Lib\n\nimport Bolt.Fresh\n\nexport let one: Int = Fresh.three\n",
    );
    await writeFile(join(bolt, MANIFEST_NAME), manifest({ name: "Bolt" }));
    await writeFile(join(bolt, "tool.hex"), "module Tool\n\nexport let two: Int = 2\n");

    const workspace = new Workspace();
    await workspace.setRoots([path], () => {});
    const lib = workspace.pathFor(pathToFileURL(join(acme, "lib.hex")).toString());
    expect(workspace.session.diagnostics(lib).map(({ message }) => message))
      .toContain("no module `Bolt.Fresh`");

    // Two files, because the two halves of the rule are separate facts: one has
    // a name only `Bolt` can supply, the other a name `Acme` already has.
    const fresh = join(bolt, "fresh.hex");
    await writeFile(fresh, "module Fresh\n\nexport let three: Int = 3\n");
    await workspace.refreshFromDisk(pathToFileURL(fresh).toString());
    const collide = join(bolt, "lib.hex");
    await writeFile(collide, "module Lib\n\nexport let four: Int = 4\n");
    await workspace.refreshFromDisk(pathToFileURL(collide).toString());

    // It joined `Bolt`: `Acme`'s own import of `Bolt.Fresh` now resolves.
    expect(workspace.session.diagnostics(lib)).toEqual([]);
    // And it did not also join `Acme`, which is what a duplicate would say.
    const everything = [...workspace.allDiagnostics().values()]
      .flat()
      .map(({ diagnostic }) => diagnostic.message);
    expect(everything).toEqual([]);
    for (const created of [fresh, collide]) {
      const key = workspace.pathFor(pathToFileURL(created).toString());
      expect(workspace.programs[0]!.holds(key)).toBe(true);
      expect(workspace.programs[0]!.owns(key)).toBe(false);
    }
  });

  /**
   * §2.2's bounds are the package's, not only the project's: a dependency's
   * `dist/` is no more its source than a project's is. Two doors reach a file
   * the walk left out — a watcher event, and an editor opening it — and the
   * third row here needs no watcher at all: the file is already on disk when
   * the workspace opens, and one go-to-file compiles it as `Acme.Gen`.
   */
  test("a file under a dependency's own skipped directories is nobody's source", async () => {
    const consumer = async (): Promise<{ path: string; acme: string; workspace: Workspace }> => {
      const path = await makeRoot();
      await writeFile(join(path, MANIFEST_NAME), manifest({ dependencies: ["Acme"] }));
      await writeFile(
        join(path, "main.hex"),
        "module Main\n\nimport Acme.Gen\n\nlet value: Int = Gen.made\n",
      );
      const acme = join(path, "node_modules", "acme");
      await mkdir(join(acme, "dist"), { recursive: true });
      await mkdir(join(acme, "node_modules", "unlisted"), { recursive: true });
      await writeFile(join(acme, MANIFEST_NAME), manifest({ name: "Acme" }));
      await writeFile(join(acme, "lib.hex"), "module Lib\n\nexport let one: Int = 1\n");
      await writeFile(
        join(acme, "node_modules", "unlisted", MANIFEST_NAME),
        manifest({ name: "Unlisted" }),
      );
      const workspace = new Workspace();
      await workspace.setRoots([path], () => {});
      return { path, acme, workspace };
    };
    const refused = (workspace: Workspace, path: string): readonly string[] =>
      workspace.session
        .diagnostics(workspace.pathFor(pathToFileURL(join(path, "main.hex")).toString()))
        .map(({ message }) => message);

    for (const [where, touch] of [
      ["dist", "watcher"],
      ["dist", "open"],
      [join("node_modules", "unlisted"), "watcher"],
    ] as const) {
      const { path, acme, workspace } = await consumer();
      expect(refused(workspace, path)).toContain("no module `Acme.Gen`");
      const generated = join(acme, where, "gen.hex");
      const text = "module Gen\n\nexport let made: Int = 9\n";
      await writeFile(generated, text);
      const uri = pathToFileURL(generated).toString();
      if (touch === "watcher") {
        await workspace.refreshFromDisk(uri);
      } else {
        await workspace.openDocument({ uri, getText: () => text } as never);
      }
      const key = workspace.pathFor(uri);
      expect(workspace.programs[0]!.holds(key)).toBe(false);
      expect(workspace.programs[0]!.owns(key)).toBe(false);
      // The refusal Packages §7 exists to draw still stands.
      expect(refused(workspace, path)).toContain("no module `Acme.Gen`");
    }
  });

  /**
   * §2.2's third exclusion, inside a dependency: a `hexagon.json` of its own
   * makes `vendor` a package of its own, and no closure of this program reaches
   * it. Adopting a file from it would compile `Vendored`'s module as `Acme`'s.
   */
  test("a file beneath a manifest of its own inside a dependency is not the dependency's", async () => {
    const path = await makeRoot();
    await writeFile(join(path, MANIFEST_NAME), manifest({ dependencies: ["Acme"] }));
    await writeFile(
      join(path, "main.hex"),
      "module Main\n\nimport Acme.Gen\n\nlet value: Int = Gen.made\n",
    );
    const acme = join(path, "node_modules", "acme");
    await mkdir(join(acme, "vendor"), { recursive: true });
    await writeFile(join(acme, MANIFEST_NAME), manifest({ name: "Acme" }));
    await writeFile(join(acme, "lib.hex"), "module Lib\n\nexport let one: Int = 1\n");
    await writeFile(join(acme, "vendor", MANIFEST_NAME), manifest({ name: "Vendored" }));

    const workspace = new Workspace();
    await workspace.setRoots([path], () => {});
    const main = workspace.pathFor(pathToFileURL(join(path, "main.hex")).toString());
    const before = workspace.session.diagnostics(main).map(({ message }) => message);
    expect(before).toContain("no module `Acme.Gen`");

    const added = join(acme, "vendor", "gen.hex");
    await writeFile(added, "module Gen\n\nexport let made: Int = 9\n");
    await workspace.refreshFromDisk(pathToFileURL(added).toString());
    expect(workspace.programs[0]!.holds(workspace.pathFor(pathToFileURL(added).toString())))
      .toBe(false);
    expect(workspace.session.diagnostics(main).map(({ message }) => message)).toEqual(before);
  });

  /**
   * The same bounds through the **rediscovery sweep**, which is the one route
   * that is not a door: a file the editor holds open is kept across a walk that
   * did not find it, and where it is kept has to be decided by asking this
   * walk's lists rather than by copying the last one's.
   *
   * `npm uninstall` with one of the package's files open is the ordinary way
   * here, and the file's own header is a decisive probe of which package it
   * ends up compiled under: `module Acme.Sub` is unlawful as `Acme`'s own
   * module (Modules §2.2's first segment) and perfectly lawful once `Acme` is
   * no longer in the program. Copied from the previous program, the file
   * survived in `held` with no package behind it — which is exactly how a
   * session compiles the project's **own** source.
   */
  test("dropping a dependency takes its open file out of the program", async () => {
    const path = await makeRoot();
    await writeFile(join(path, MANIFEST_NAME), manifest({ name: "App", dependencies: ["Acme"] }));
    await writeFile(join(path, "main.hex"), "module Main\n");
    const acme = join(path, "node_modules", "acme");
    await mkdir(acme, { recursive: true });
    await writeFile(join(acme, MANIFEST_NAME), manifest({ name: "Acme" }));
    const thing = join(acme, "thing.hex");
    const text = "module Acme.Sub\n\nexport let n: Int = 1\n";
    await writeFile(thing, text);

    const workspace = new Workspace();
    await workspace.setRoots([path], () => {});
    const refusal = "`Acme.Sub` begins with the name of the package `Acme`; a dotted " +
      "module's first segment cannot name a package in the program; rename the module";
    const everything = (): readonly string[] =>
      [...workspace.allDiagnostics().values()].flat().map(({ diagnostic }) => diagnostic.message);
    expect(everything()).toEqual([refusal]);

    const uri = pathToFileURL(thing).toString();
    await workspace.openDocument({ uri, getText: () => text } as never);
    expect(everything()).toEqual([refusal]);

    await writeFile(join(path, MANIFEST_NAME), manifest({ name: "App", dependencies: [] }));
    await workspace.setRoots([path], () => {});
    const key = workspace.pathFor(uri);
    // Out of the program entirely: `node_modules` lies between the project and
    // this file, so the project cannot own it, and no package of the closure
    // holds it any more.
    expect(workspace.programs[0]!.owns(key)).toBe(false);
    expect(workspace.programs[0]!.holds(key)).toBe(false);
    expect(workspace.session.paths.map((p) => p.split("/").at(-1))).toEqual(["main.hex"]);
    // And the refusal is gone because the module left, not because it was
    // quietly re-seated as `App`'s own — which would have said the same thing.
    expect(everything()).toEqual([]);
  });

  /**
   * The other half: a file the editor holds open **inside** a dependency, when
   * a `hexagon.json` appears beside it and ends the package there. The buffer
   * does not outrank the boundary.
   */
  test("a manifest appearing beside an open file takes it out of the package", async () => {
    const path = await makeRoot();
    await writeFile(join(path, MANIFEST_NAME), manifest({ dependencies: ["Acme"] }));
    await writeFile(
      join(path, "main.hex"),
      "module Main\n\nimport Acme.Sneak\n\nlet value: Int = Sneak.made\n",
    );
    const acme = join(path, "node_modules", "acme");
    await mkdir(join(acme, "vendor"), { recursive: true });
    await writeFile(join(acme, MANIFEST_NAME), manifest({ name: "Acme" }));
    await writeFile(join(acme, "lib.hex"), "module Lib\n\nexport let one: Int = 1\n");
    const sneak = join(acme, "vendor", "sneak.hex");
    const text = "module Sneak\n\nexport let made: Int = 9\n";
    await writeFile(sneak, text);

    const workspace = new Workspace();
    await workspace.setRoots([path], () => {});
    const main = workspace.pathFor(pathToFileURL(join(path, "main.hex")).toString());
    // No boundary yet, so `vendor` really is `Acme`'s and the import resolves.
    expect(workspace.session.diagnostics(main)).toEqual([]);
    const uri = pathToFileURL(sneak).toString();
    await workspace.openDocument({ uri, getText: () => text } as never);

    await writeFile(join(acme, "vendor", MANIFEST_NAME), manifest({ name: "Vendored" }));
    await workspace.setRoots([path], () => {});
    const key = workspace.pathFor(uri);
    expect(workspace.programs[0]!.holds(key)).toBe(false);
    expect(workspace.session.diagnostics(main).map(({ message }) => message))
      .toContain("no module `Acme.Sneak`");
  });
});

/**
 * The case the owns-first rule exists for: a workspace package that is both an
 * editor root of its own and a linked dependency of its neighbour.
 */
describe("a file one program owns and another holds", () => {
  const manifest = (fields: Readonly<Record<string, unknown>>): string =>
    `${JSON.stringify(fields, undefined, 2)}\n`;

  test("the program that owns it as project source answers, whatever the root order", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "app", "node_modules"), { recursive: true });
    await mkdir(join(path, "acme"), { recursive: true });
    await writeFile(join(path, "app", MANIFEST_NAME), manifest({ dependencies: ["Acme"] }));
    await writeFile(join(path, "app", "main.hex"), "module Main\n\nimport Acme.Geometry\n");
    await writeFile(join(path, "acme", MANIFEST_NAME), manifest({ name: "Acme" }));
    const geometry = join(path, "acme", "geometry.hex");
    await writeFile(geometry, "module Geometry\n\nexport let width: Int = 3\n");
    await symlink(join(path, "acme"), join(path, "app", "node_modules", "acme"), "dir");

    const workspace = new Workspace();
    // `app` first, so the program that merely *holds* the file comes first in
    // root order and would answer under a first-holder rule.
    await workspace.setRoots([join(path, "app"), join(path, "acme")], () => {});
    const key = workspace.pathFor(pathToFileURL(geometry).toString());
    expect(workspace.programs.filter((program) => program.holds(key))).toHaveLength(2);
    // The author of `acme/geometry.hex` edits `acme`, so `acme`'s program is
    // the one whose repairs and renames they can act on.
    expect(workspace.programFor(key)!.directory.endsWith("/acme")).toBe(true);
  });

  /**
   * And the same for a file created **after** discovery, which is the one a
   * user meets: they add a module to their own package while its consumer is
   * open beside it. Answering with the consumer would take the file's own
   * project's repairs away — `projectManifestOf` is `undefined` for a program
   * that holds the file only as a dependency's source, so Packages §7's
   * not-a-dependency quick fix would be withheld in exactly the project whose
   * manifest it should edit.
   */
  test("a file created in a package that is also a root joins the program that owns it", async () => {
    const path = await makeRoot();
    await mkdir(join(path, "app", "node_modules"), { recursive: true });
    await mkdir(join(path, "acme"), { recursive: true });
    await writeFile(join(path, "app", MANIFEST_NAME), manifest({ dependencies: ["Acme"] }));
    await writeFile(join(path, "app", "main.hex"), "module Main\n\nimport Acme.Geometry\n");
    await writeFile(join(path, "acme", MANIFEST_NAME), manifest({ name: "Acme" }));
    await writeFile(
      join(path, "acme", "geometry.hex"),
      "module Geometry\n\nexport let width: Int = 3\n",
    );
    await symlink(join(path, "acme"), join(path, "app", "node_modules", "acme"), "dir");

    const workspace = new Workspace();
    await workspace.setRoots([join(path, "app"), join(path, "acme")], () => {});
    const added = join(path, "acme", "extra.hex");
    await writeFile(added, "module Extra\n\nexport let depth: Int = 4\n");
    await workspace.refreshFromDisk(pathToFileURL(added).toString());
    const key = workspace.pathFor(pathToFileURL(added).toString());

    // Both programs have it — `app` compiles it as `Acme.Extra` — and the one
    // that owns it answers.
    expect(workspace.programs.filter((program) => program.holds(key))).toHaveLength(2);
    expect(workspace.programs.filter((program) => program.owns(key))).toHaveLength(1);
    expect(workspace.programFor(key)!.directory.endsWith("/acme")).toBe(true);
    expect(workspace.projectManifestOf(key)?.path).toBe(
      workspace.pathFor(pathToFileURL(join(path, "acme", MANIFEST_NAME)).toString()),
    );
    for (const program of workspace.programs) {
      expect(program.session.diagnostics(key)).toEqual([]);
    }
  });
});

/**
 * **One answer per file, whatever route reached it.**
 *
 * Four rounds of review found the same family of defect four times: a bound the
 * walk applies and a door does not, or a bound one door applies and another
 * does not. Each was found by driving one shape through one route, and each fix
 * was pinned by a test of that shape and that route — which is why the next
 * shape, or the next route, could break the same way.
 *
 * So this is the table itself. Every shape Packages §2.2 and §2.1 distinguish
 * is driven through every way a file reaches a program — the walk, an editor
 * opening it, an edit arriving for it, a watcher event on it, a watcher event
 * on a file created *after* discovery, and a rediscovery with the buffer still
 * open — and every route must give the same three answers: which program owns
 * it as project source, which programs hold it at all, and whether it is
 * excluded. A route that disagrees with the walk makes the walk's answer
 * advisory, and which answer a user gets then depends on what they happened to
 * click.
 */
describe("one answer per file, whatever route reached it", () => {
  const manifest = (fields: Readonly<Record<string, unknown>>): string =>
    `${JSON.stringify(fields, undefined, 2)}\n`;

  /**
   * The workspace every case is built in: a project with a nested project, a
   * listed dependency that nests one of its own, two installed packages nobody
   * lists, a vendored package inside the dependency, and both `exclude`s.
   */
  const TREE: Readonly<Record<string, string>> = {
    // `node_modules` sits in the project's `exclude` on purpose, and it is the
    // shape of every `.gitignore`: a project's entry must bound the project's
    // own files and reach into no dependency of it. The other direction — a
    // dependency's entry reaching its own files — is `"generated"` below. Both
    // halves of "one manifest's `exclude` is about that package's own files"
    // are then driven through all six routes, rather than one of them being
    // pinned at the walk alone.
    [MANIFEST_NAME]: manifest({
      name: "App",
      dependencies: ["Acme"],
      exclude: ["excluded", "node_modules"],
    }),
    "main.hex": "module Main\n",
    "target.hex": "module Target\n\nexport let n: Int = 1\n",
    "fresh.hex": "module Fresh\n",
    "excluded/kept-out.hex": "module KeptOut\n",
    "dist/built.hex": "module Built\n",
    ".claude/agent.hex": "module Agent\n",
    ["sub/" + MANIFEST_NAME]: manifest({ name: "Sub" }),
    "sub/inner.hex": "module Inner\n",
    ["node_modules/loose/" + MANIFEST_NAME]: manifest({ name: "Loose" }),
    "node_modules/loose/stray.hex": "module Stray\n",
    ["node_modules/acme/" + MANIFEST_NAME]:
      manifest({ name: "Acme", dependencies: ["Bolt"], exclude: ["generated"] }),
    "node_modules/acme/lib.hex": "module Lib\n",
    "node_modules/acme/extra.hex": "module Extra\n",
    "node_modules/acme/generated/made.hex": "module Made\n",
    ["node_modules/acme/vendor/" + MANIFEST_NAME]: manifest({ name: "Vendored" }),
    "node_modules/acme/vendor/inside.hex": "module Inside\n",
    ["node_modules/acme/node_modules/bolt/" + MANIFEST_NAME]: manifest({ name: "Bolt" }),
    "node_modules/acme/node_modules/bolt/tool.hex": "module Tool\n",
    ["node_modules/acme/node_modules/spare/" + MANIFEST_NAME]: manifest({ name: "Spare" }),
    "node_modules/acme/node_modules/spare/idle.hex": "module Idle\n",
  };

  /** One shape of that tree, and the answer every route must give about it. */
  interface Shape {
    /** The file under test, relative to the workspace root. */
    readonly file: string;
    /** The editor roots to open, relative to the workspace root; `.` is it. */
    readonly roots: readonly string[];
    /** The program holding it as **project** source, or nothing. */
    readonly owner: string | undefined;
    /** Every program holding it at all, project source or a package's. */
    readonly holders: readonly string[];
    /** Whether a manifest's `exclude` is what keeps it out, rather than §2.2. */
    readonly excluded: boolean;
    /** A link to make instead of a file to write, where the shape is one. */
    readonly linkTo?: string;
  }

  const SHAPES: Readonly<Record<string, Shape>> = {
    "the project's own source": {
      file: "fresh.hex",
      roots: ["."],
      owner: ".",
      holders: ["."],
      excluded: false,
    },
    "a file the project excludes": {
      file: "excluded/kept-out.hex",
      roots: ["."],
      owner: undefined,
      holders: [],
      excluded: true,
    },
    "a file the dependency excludes": {
      file: "node_modules/acme/generated/made.hex",
      roots: ["."],
      owner: undefined,
      holders: [],
      excluded: true,
    },
    "a nested project's file": {
      file: "sub/inner.hex",
      roots: ["."],
      owner: "sub",
      holders: ["sub"],
      excluded: false,
    },
    // No package of any closure contains it, so the deepest package directory
    // that does is the project — and the project's entry does cover it. §2.2
    // keeps it out of the project's own files either way; the honest answer to
    // "is a manifest what keeps it out" is yes once the project excludes the
    // directory, and it is stated rather than left to be discovered.
    "a file of an installed package nobody lists": {
      file: "node_modules/loose/stray.hex",
      roots: ["."],
      owner: undefined,
      holders: [],
      excluded: true,
    },
    // The direction the project's own entry must *not* reach: `node_modules`
    // is excluded by the project, and the file is a listed dependency's own
    // source, so the entry deciding about it is the dependency's.
    "a listed dependency's file under a `node_modules` the project excludes": {
      file: "node_modules/acme/lib.hex",
      roots: ["."],
      owner: undefined,
      holders: ["."],
      excluded: false,
    },
    "a listed dependency's own file": {
      file: "node_modules/acme/extra.hex",
      roots: ["."],
      owner: undefined,
      holders: ["."],
      excluded: false,
    },
    "a file of a package nested inside the dependency": {
      file: "node_modules/acme/node_modules/bolt/tool.hex",
      roots: ["."],
      owner: undefined,
      holders: ["."],
      excluded: false,
    },
    "a file under the dependency's own unlisted `node_modules`": {
      file: "node_modules/acme/node_modules/spare/idle.hex",
      roots: ["."],
      owner: undefined,
      holders: [],
      excluded: false,
    },
    "a file beneath a manifest inside the dependency": {
      file: "node_modules/acme/vendor/inside.hex",
      roots: ["."],
      owner: undefined,
      holders: [],
      excluded: false,
    },
    "a file under the project's output directory": {
      file: "dist/built.hex",
      roots: ["."],
      owner: undefined,
      holders: [],
      excluded: false,
    },
    "a file under a tooling directory": {
      file: ".claude/agent.hex",
      roots: ["."],
      owner: undefined,
      holders: [],
      excluded: false,
    },
    "a second name for a file the project holds": {
      file: "alias.hex",
      linkTo: "target.hex",
      roots: ["."],
      owner: ".",
      holders: ["."],
      excluded: false,
    },
    "a dependency opened as a root of its own": {
      file: "node_modules/acme/extra.hex",
      roots: [".", "node_modules/acme"],
      owner: "node_modules/acme",
      holders: [".", "node_modules/acme"],
      excluded: false,
    },
  };

  const ROUTES = ["walk", "open", "edit", "watcher", "created", "reopened"] as const;
  type Route = typeof ROUTES[number];

  /** What the file under test says, so a shape's module has one name. */
  const textOf = (shape: Shape): string =>
    TREE[shape.linkTo ?? shape.file] ?? "module Unwritten\n";

  /** Lays the tree down, leaving out the file under test where a route needs it. */
  async function layout(root: string, omit: string | undefined): Promise<void> {
    for (const [name, text] of Object.entries(TREE)) {
      await mkdir(join(root, name, ".."), { recursive: true });
      if (name === omit) continue;
      await writeFile(join(root, name), text);
    }
  }

  /** Which program a label names, and the label a program's directory wears. */
  const labelOf = (directory: string, base: string): string =>
    directory === base ? "." : directory.slice(base.length + 1);

  async function drive(shape: Shape, route: Route): Promise<void> {
    const root = await makeRoot();
    const base = normalizePath(settledPathSync(root));
    const created = route === "created";
    await layout(root, created && shape.linkTo === undefined ? shape.file : undefined);
    const make = async (): Promise<void> => {
      if (shape.linkTo === undefined) await writeFile(join(root, shape.file), textOf(shape));
      else await symlink(join(root, shape.linkTo), join(root, shape.file), "file");
    };
    if (!created) await make();

    const workspace = new Workspace();
    const roots = shape.roots.map((each) => each === "." ? root : join(root, each));
    await workspace.setRoots(roots, () => {});
    const uri = pathToFileURL(join(root, shape.file)).toString();
    const text = textOf(shape);
    switch (route) {
      case "walk":
        break;
      case "open":
        await workspace.openDocument({ uri, getText: () => text } as never);
        break;
      case "edit":
        workspace.updateDocument({ uri, getText: () => text } as never);
        break;
      case "watcher":
        await workspace.refreshFromDisk(uri);
        break;
      case "created":
        await make();
        await workspace.refreshFromDisk(uri);
        break;
      case "reopened":
        await workspace.openDocument({ uri, getText: () => text } as never);
        await workspace.setRoots(roots, () => {});
        break;
    }

    const key = workspace.pathFor(uri);
    const labels = (holds: (program: (typeof workspace.programs)[number]) => boolean) =>
      workspace.programs.filter(holds).map(({ directory }) => labelOf(directory, base)).sort();
    expect(labels((program) => program.owns(key)))
      .toEqual(shape.owner === undefined ? [] : [shape.owner]);
    expect(labels((program) => program.holds(key))).toEqual([...shape.holders].sort());
    // Held and seated are one fact: a path in a session no program admits to
    // holding is compiled and answered about by nobody.
    expect(labels((program) => program.session.paths.includes(key)))
      .toEqual([...shape.holders].sort());
    expect(workspace.isExcludedUri(uri)).toBe(shape.excluded);
    // And the program that answers questions about it is the one that owns it,
    // falling back to the first that holds it — never nothing where one does.
    const answering = workspace.programs
      .map(({ directory }) => labelOf(directory, base))
      .find((label) => shape.holders.includes(label));
    const asked = workspace.programFor(key);
    expect(asked === undefined ? undefined : labelOf(asked.directory, base))
      .toBe(shape.owner ?? answering);
  }

  for (const [name, shape] of Object.entries(SHAPES)) {
    test(name, async () => {
      for (const route of ROUTES) {
        // The route is named in the failure, because a table's whole value is
        // knowing which cell disagreed with the others.
        try {
          await drive(shape, route);
        } catch (failure) {
          throw new Error(`${name}, reached by the ${route}`, { cause: failure });
        }
      }
    });
  }
});
