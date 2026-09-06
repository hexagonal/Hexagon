/**
 * Discovery against real directories.
 *
 * Every fixture here is a real `node_modules` tree with real files and real
 * symlinks, because the rules Packages §4.1 states are about what npm actually
 * lays down: a hoisted install, a nested duplicate, a scoped name, a linked
 * workspace, two links to one directory. A stubbed filesystem would let this
 * file agree with its author's idea of npm rather than with npm.
 */

import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { Lookup } from "./lookup.js";
import { discoverProgram, discoverPrograms } from "./packages.js";
import { enclosingManifestDirectory, projectDirectories } from "./projects.js";
import {
  hexagonFilesUnder,
  nothingSeen,
  NOTHING_EXCLUDED,
  packageUnderNodeModules,
  skippedDirectoryBetween,
} from "./files.js";
import { normalizePath } from "./paths.js";
import { removeTemporaryRoots, temporaryRoot } from "./test-roots.js";

/**
 * How each root was **reached**, by its canonical spelling.
 *
 * Discovery answers in canonical paths and every assertion below is written in
 * them, so `tree` goes on returning one. But what a host is *handed* is the
 * spelling a client sent, and on the linked run that is a path through a
 * symlink — so every call that takes a directory takes `reached(…)`, and this
 * suite fails when something stops canonicalising what it was given. Whether a
 * plain temporary directory is already canonical is a property of the machine
 * (`test-roots.ts`), which is why it cannot be left to one.
 */
const reachedByReal = new Map<string, string>();

afterEach(async () => {
  reachedByReal.clear();
  await removeTemporaryRoots();
});

/** Writes a tree of files and answers with its canonical root. */
async function tree(files: Readonly<Record<string, string>>): Promise<string> {
  const held = normalizePath(await temporaryRoot("hexagon-host-"));
  for (const [path, text] of Object.entries(files)) {
    const at = join(held, path);
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, text, "utf8");
  }
  const root = normalizePath(await realpath(held));
  reachedByReal.set(root, held);
  return root;
}

/** A canonical path as a client would spell it — through the link, if any. */
function reached(path: string): string {
  for (const [real, spelling] of reachedByReal) {
    if (path === real) return spelling;
    if (path.startsWith(`${real}/`)) return `${spelling}${path.slice(real.length)}`;
  }
  return path;
}

async function link(root: string, from: string, to: string): Promise<void> {
  await mkdir(dirname(join(root, from)), { recursive: true });
  await symlink(join(root, to), join(root, from), "dir");
}

const manifest = (fields: Readonly<Record<string, unknown>>): string =>
  `${JSON.stringify(fields, undefined, 2)}\n`;

async function discover(directory: string) {
  return await discoverProgram(reached(directory), new Lookup());
}

function messages(program: { problems: readonly { message: string }[] }): readonly string[] {
  return program.problems.map(({ message }) => message);
}

describe("§4.1 — a hoisted install, the ordinary case", () => {
  test("a listed name is found at the project's own level, with its files", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/package.json": manifest({ name: "@acme/geometry", version: "2.1.0" }),
      "node_modules/acme/geometry.hex": "module Geometry\n",
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([]);
    expect(program.packages.map(({ record }) => record.name)).toEqual(["Acme"]);
    expect(program.packages[0]!.files.map(({ path }) => path.endsWith("geometry.hex")))
      .toEqual([true]);
    expect(program.files).toHaveLength(1);
  });

  /**
   * "The climb is what makes a workspace's hoisted layout work: `packages/app`
   * lists `Acme`, has no `node_modules` of its own, and the workspace root's
   * answers" (§4.1).
   */
  test("a package with no `node_modules` of its own climbs to the workspace root's", async () => {
    const root = await tree({
      "packages/app/hexagon.json": manifest({ dependencies: ["Acme"] }),
      "packages/app/main.hex": "module Main\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/geometry.hex": "module Geometry\n",
    });
    const program = await discover(join(root, "packages/app"));
    expect(messages(program)).toEqual([]);
    expect(program.packages.map(({ record }) => record.name)).toEqual(["Acme"]);
  });

  test("a scoped directory is a package root, and npm's name is not the Hexagon name", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n",
      "node_modules/@acme/geometry/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/@acme/geometry/geometry.hex": "module Geometry\n",
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([]);
    expect(program.packages[0]!.directory.endsWith("node_modules/@acme/geometry")).toBe(true);
  });

  test("an npm package with no manifest is read for nothing, and the name is unresolvable", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Lodash"] }),
      "main.hex": "module Main\n",
      "node_modules/lodash/package.json": manifest({ name: "lodash", version: "4.0.0" }),
      "node_modules/lodash/index.js": "export const x = 1;\n",
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([
      "no installed package declares `\"name\": \"Lodash\"`; install it, or check the " +
        "name in its `hexagon.json`",
    ]);
    expect(program.problems[0]!.path.endsWith("hexagon.json")).toBe(true);
  });
});

describe("§4.1 — the nearest level answers", () => {
  test("a copy at a farther level is shadowed for that walk", async () => {
    const root = await tree({
      "app/hexagon.json": manifest({ dependencies: ["Acme"] }),
      "app/main.hex": "module Main\n",
      "app/node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "app/node_modules/acme/package.json": manifest({ version: "2.0.0" }),
      "app/node_modules/acme/geometry.hex": "module Geometry\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/package.json": manifest({ version: "1.0.0" }),
      "node_modules/acme/geometry.hex": "module Geometry\n",
    });
    const program = await discover(join(root, "app"));
    expect(messages(program)).toEqual([]);
    expect(program.packages[0]!.directory).toBe(`${root}/app/node_modules/acme`);
  });

  /**
   * §9 (e)'s nested duplicate in full: `Bolt` finds its own copy from its own
   * directory, the project finds the root's, and the program would hold both.
   */
  test("two entries reaching two directories are refused, with versions", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Acme", "Bolt"] }),
      "main.hex": "module Main\n",
      "node_modules/@acme/geometry/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/@acme/geometry/package.json": manifest({ version: "2.1.0" }),
      "node_modules/@acme/geometry/geometry.hex": "module Geometry\n",
      "node_modules/@bolt/tools/hexagon.json": manifest({ name: "Bolt", dependencies: ["Acme"] }),
      "node_modules/@bolt/tools/tools.hex": "module Tools\n",
      "node_modules/@bolt/tools/node_modules/@acme/geometry/hexagon.json": manifest({
        name: "Acme",
      }),
      "node_modules/@bolt/tools/node_modules/@acme/geometry/package.json": manifest({
        version: "1.4.0",
      }),
    });
    const program = await discover(root);
    expect(messages(program)).toContain(
      "package `Acme` is installed twice: `node_modules/@acme/geometry` (2.1.0) and " +
        "`node_modules/@bolt/tools/node_modules/@acme/geometry` (1.4.0); a program " +
        "holds one copy of each Hexagon package",
    );
  });

  test("two roots at one level declaring the requested name are refused", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n",
      "node_modules/acme-a/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme-a/package.json": manifest({ version: "1.0.0" }),
      "node_modules/acme-b/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme-b/package.json": manifest({ version: "1.0.0" }),
    });
    const program = await discover(root);
    expect(messages(program)).toContain(
      "package `Acme` is installed twice: `node_modules/acme-a` (1.0.0) and " +
        "`node_modules/acme-b` (1.0.0); a program holds one copy of each Hexagon package",
    );
    // No package entered the set: a lookup that met two roots answered with none.
    expect(program.packages).toEqual([]);
  });

  test("a copy nobody lists is refused by nothing", async () => {
    const root = await tree({
      "hexagon.json": manifest({}),
      "main.hex": "module Main\n",
      "node_modules/acme-a/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme-b/hexagon.json": manifest({ name: "Acme" }),
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([]);
  });
});

describe("§4.3 — directory identity is the canonical path", () => {
  test("two links to one package are one copy", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Acme", "Bolt"] }),
      "main.hex": "module Main\n",
      "packages/acme/hexagon.json": manifest({ name: "Acme" }),
      "packages/acme/geometry.hex": "module Geometry\n",
      "node_modules/@bolt/tools/hexagon.json": manifest({ name: "Bolt", dependencies: ["Acme"] }),
      "node_modules/@bolt/tools/tools.hex": "module Tools\n",
    });
    await link(root, "node_modules/acme", "packages/acme");
    await link(root, "node_modules/@acme/geometry", "packages/acme");
    const program = await discover(root);
    expect(messages(program)).toEqual([]);
    expect(program.packages.filter(({ record }) => record.name === "Acme")).toHaveLength(1);
  });

  /**
   * A workspace package installed as a link "resolves from its real directory,
   * which is where its own hoisted dependencies are found" (§4.1).
   */
  test("a linked package resolves its own entries from its real directory", async () => {
    const root = await tree({
      "app/hexagon.json": manifest({ dependencies: ["Acme"] }),
      "app/main.hex": "module Main\n",
      "packages/acme/hexagon.json": manifest({ name: "Acme", dependencies: ["Bolt"] }),
      "packages/acme/geometry.hex": "module Geometry\n",
      "node_modules/bolt/hexagon.json": manifest({ name: "Bolt" }),
      "node_modules/bolt/util.hex": "module Util\n",
    });
    await link(root, "app/node_modules/acme", "packages/acme");
    const program = await discover(join(root, "app"));
    // `Bolt` is nowhere under `app/`; only the real directory's climb finds it.
    expect(messages(program)).toEqual([]);
    expect(program.packages.map(({ record }) => record.name)).toEqual(["Acme", "Bolt"]);
  });

  test("a workspace link back to the project closes a cycle, and adds no package", async () => {
    const root = await tree({
      "app/hexagon.json": manifest({ name: "MyApp", dependencies: ["Bolt"] }),
      "app/main.hex": "module Main\n",
      "packages/bolt/hexagon.json": manifest({ name: "Bolt", dependencies: ["MyApp"] }),
      "packages/bolt/tools.hex": "module Tools\n",
    });
    await link(root, "app/node_modules/bolt", "packages/bolt");
    await link(root, "packages/bolt/node_modules/myapp", "app");
    const program = await discover(join(root, "app"));
    expect(messages(program)).toContain("dependency cycle: `MyApp` → `Bolt` → `MyApp`");
    expect(program.packages.map(({ record }) => record.name)).toEqual(["Bolt"]);
  });

  test("the project's own name installed elsewhere is refused at the project's manifest", async () => {
    const root = await tree({
      "hexagon.json": manifest({ name: "Acme", dependencies: ["Bolt"] }),
      "main.hex": "module Main\n",
      "node_modules/@bolt/tools/hexagon.json": manifest({ name: "Bolt", dependencies: ["Acme"] }),
      "node_modules/@bolt/tools/tools.hex": "module Tools\n",
      "node_modules/@acme/geometry/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/@acme/geometry/geometry.hex": "module Geometry\n",
    });
    const program = await discover(root);
    expect(messages(program)).toContain(
      "this project declares `\"name\": \"Acme\"`, and `Acme` is also installed at " +
        "`node_modules/@acme/geometry`; a program holds one package of each name",
    );
    expect(program.problems.find(({ message }) => message.startsWith("this project"))!.path)
      .toBe(`${root}/hexagon.json`);
  });
});

describe("§4.1 — a manifest the walk cannot use", () => {
  test("an unparseable manifest a lookup answered around is silent", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/geometry.hex": "module Geometry\n",
      "node_modules/@junk/x/hexagon.json": "{ not json",
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([]);
  });

  test("an unparseable manifest is named in the report of the lookup that scanned it", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n",
      "node_modules/@acme/geometry/hexagon.json": "{ not json",
    });
    const program = await discover(root);
    expect(messages(program)[0]).toContain(
      "(`node_modules/@acme/geometry/hexagon.json` could not be read:",
    );
  });

  test("a scanned manifest declaring `Hex` is a candidate for no name and draws nothing", async () => {
    const root = await tree({
      "hexagon.json": manifest({}),
      "main.hex": "module Main\n",
      "node_modules/x/hexagon.json": manifest({ name: "Hex" }),
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([]);
  });

  test("a dependency's own `name` refusal draws nothing; the project's draws §2.1's", async () => {
    const root = await tree({
      "hexagon.json": manifest({ name: "acme" }),
      "main.hex": "module Main\n",
      "node_modules/x/hexagon.json": manifest({ name: "acme" }),
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([
      "a package name is one uppercase-start identifier: write `\"Acme\"`",
    ]);
  });

  /** D3: a dependency's own unresolvable entry reports against its own manifest. */
  test("a dependency's own entry reports against the dependency's manifest", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Bolt"] }),
      "main.hex": "module Main\n",
      "node_modules/bolt/hexagon.json": manifest({ name: "Bolt", dependencies: ["Missing"] }),
      "node_modules/bolt/tools.hex": "module Tools\n",
    });
    const program = await discover(root);
    const report = program.problems.find(({ message }) => message.includes("Missing"))!;
    expect(report.path).toBe(`${root}/node_modules/bolt/hexagon.json`);
    // Seated on the entry's own line, not on the field's.
    expect(report.line).toBe(3);
  });

  /**
   * §4.1: "What a package that enters the set is checked for is its own
   * `dependencies`" — and §2.1 makes every other field the host's. The
   * project's manifest is checked in full; a dependency's is not.
   */
  test("a package that entered the set draws its `dependencies` refusals", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Bolt"] }),
      "main.hex": "module Main\n",
      "node_modules/bolt/hexagon.json": manifest({ name: "Bolt", dependencies: ["hex"] }),
      "node_modules/bolt/tools.hex": "module Tools\n",
    });
    const program = await discover(root);
    expect(program.problems).toEqual([{
      path: `${root}/node_modules/bolt/hexagon.json`,
      line: 3,
      message: "`\"hex\"` is not a package name; `dependencies` expects a Hexagon package " +
        "name, as the dependency's `hexagon.json` declares it — for a JavaScript " +
        "dependency, declare it in `package.json` and bind it with `extern from \"hex\"`",
      severity: "error",
    }]);
  });

  test("a package that entered the set draws none of the host's own field reports", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Bolt"] }),
      "main.hex": "module Main\n",
      "node_modules/bolt/hexagon.json": manifest({
        name: "Bolt",
        exclude: ["nowhere"],
        description: "a package",
      }),
      "node_modules/bolt/tools.hex": "module Tools\n",
    });
    const program = await discover(root);
    // The unknown key and the `exclude` warning are both about a file its reader
    // did not write, cannot edit, and npm overwrites.
    expect(messages(program)).toEqual([]);
  });

  test("the project's own manifest is still checked in full", async () => {
    const root = await tree({
      "hexagon.json": manifest({ exclude: ["nowhere"], description: "a project" }),
      "main.hex": "module Main\n",
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([
      "unknown hexagon.json key `description`; expected `name`, `dependencies`, `exclude`",
      "hexagon.json `exclude` entry \"nowhere\" matches no file or directory, so it " +
        "has no effect (check the spelling, including its case)",
    ]);
  });

  /**
   * A dependency's `exclude` is **honoured** even though it is never reported
   * on: §2.1 makes it the host's field, and reading it is what the host does
   * with a host field.
   */
  test("a dependency's `exclude` is honoured in silence", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Bolt"] }),
      "main.hex": "module Main\n",
      "node_modules/bolt/hexagon.json": manifest({ name: "Bolt", exclude: ["generated"] }),
      "node_modules/bolt/tools.hex": "module Tools\n",
      "node_modules/bolt/generated/out.hex": "module Out\n",
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([]);
    expect(program.packages[0]!.files.map(({ path }) => path))
      .toEqual([`${root}/node_modules/bolt/tools.hex`]);
  });

  test("a merely-scanned package's own problems are published nowhere", async () => {
    const root = await tree({
      "hexagon.json": manifest({}),
      "main.hex": "module Main\n",
      "node_modules/bolt/hexagon.json": manifest({ name: "Bolt", nonsense: true }),
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([]);
  });
});

describe("§4.1 — *installed*, the diagnostic set", () => {
  test("an unlisted installed package is in the set and enters no closure", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/geometry.hex": "module Geometry\n",
      "node_modules/bolt/hexagon.json": manifest({ name: "Bolt" }),
    });
    const program = await discover(root);
    expect([...program.installed].sort()).toEqual(["Acme", "Bolt"]);
    expect(program.packages.map(({ record }) => record.name)).toEqual(["Acme"]);
  });

  test("a name two roots declare at one level is not installed", async () => {
    const root = await tree({
      "hexagon.json": manifest({}),
      "main.hex": "module Main\n",
      "node_modules/acme-a/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme-b/hexagon.json": manifest({ name: "Acme" }),
    });
    const program = await discover(root);
    expect(program.installed.has("Acme")).toBe(false);
  });

  test("a nearer level's answer settles the name for the whole walk", async () => {
    const root = await tree({
      "app/hexagon.json": manifest({}),
      "app/main.hex": "module Main\n",
      "app/node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme-a/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme-b/hexagon.json": manifest({ name: "Acme" }),
    });
    const program = await discover(join(root, "app"));
    expect(program.installed.has("Acme")).toBe(true);
  });

  /**
   * "A copy at a farther level answers that lookup never" — so a name a nearer
   * level leaves *unanswered*, by declaring it at two roots, is not rescued by
   * a farther level's single copy.
   */
  test("a name a nearer level left unanswered is not installed from a farther one", async () => {
    const root = await tree({
      "app/hexagon.json": manifest({}),
      "app/main.hex": "module Main\n",
      "app/node_modules/acme-a/hexagon.json": manifest({ name: "Acme" }),
      "app/node_modules/acme-b/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
    });
    const program = await discover(join(root, "app"));
    expect(program.installed.has("Acme")).toBe(false);
  });

  /**
   * §4.1: "a candidate exists only for a name this spec accepts". A root whose
   * manifest declares `"Hex"`, or a lowercase name, is a candidate for no name,
   * so it is in nobody's installed set either.
   */
  test("a root declaring a name this spec refuses is installed for nothing", async () => {
    const root = await tree({
      "hexagon.json": manifest({}),
      "main.hex": "module Main\n",
      "node_modules/x/hexagon.json": manifest({ name: "Hex" }),
      "node_modules/y/hexagon.json": manifest({ name: "acme" }),
      "node_modules/z/hexagon.json": manifest({ name: "Acme.Tools" }),
      "node_modules/ok/hexagon.json": manifest({ name: "Ok" }),
    });
    const program = await discover(root);
    expect([...program.installed]).toEqual(["Ok"]);
  });

  test("a level's `.bin` and lockfile are not package roots", async () => {
    const root = await tree({
      "hexagon.json": manifest({}),
      "main.hex": "module Main\n",
      "node_modules/.package-lock.json": "{}",
      "node_modules/.bin/thing": "#!/bin/sh\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
    });
    const program = await discover(root);
    expect([...program.installed]).toEqual(["Acme"]);
  });
});

describe("§2.2 / §2.5 — what a project holds, and where one begins", () => {
  test("a nested manifest is a program of its own and leaves the enclosing project", async () => {
    const root = await tree({
      "hexagon.json": manifest({}),
      "main.hex": "module Main\n",
      "vendor/hexagon.json": manifest({ name: "Vendor" }),
      "vendor/thing.hex": "module Thing\n",
    });
    const program = await discover(root);
    expect(program.files.map(({ path }) => path)).toEqual([`${root}/main.hex`]);
    expect(program.nested).toEqual([`${root}/vendor`]);
  });

  /**
   * A boundary inside a **dependency** is carried the same way. A host seats
   * files the walk never handed it — a watcher event, an editor opening one —
   * so it has to be able to ask where the package it is about stops, and the
   * walk is the only thing that knows.
   */
  test("a dependency carries the boundaries beneath it, not only the files above them", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/lib.hex": "module Lib\n",
      "node_modules/acme/vendor/hexagon.json": manifest({ name: "Vendored" }),
      "node_modules/acme/vendor/thing.hex": "module Thing\n",
    });
    const program = await discover(root);
    const acme = program.packages[0]!;
    expect(acme.files.map(({ path }) => path)).toEqual([`${root}/node_modules/acme/lib.hex`]);
    expect(acme.nested).toEqual([`${root}/node_modules/acme/vendor`]);
  });

  /**
   * An absolute `exclude` entry pasted in the spelling the user's own shell
   * shows them — `/var/folders/…` where the walk says `/private/var/folders/…`
   * — still matches. `exclude` failing silently is the one failure this field
   * must never have.
   */
  test("an absolute `exclude` entry in an unresolved spelling still excludes", async () => {
    const root = await tree({
      "real/main.hex": "module Main\n",
      "real/generated/out.hex": "module Out\n",
    });
    await link(root, "reached", "real");
    // Written as the user reached the project, through the link — which is not
    // the spelling the walk resolves every path to.
    await writeFile(
      join(root, "real", "hexagon.json"),
      manifest({ exclude: [`${root}/reached/generated`] }),
      "utf8",
    );
    const program = await discover(join(root, "reached"));
    expect(program.directory).toBe(`${root}/real`);
    expect(program.files.map(({ path }) => path)).toEqual([`${root}/real/main.hex`]);
  });

  test("a directory with no manifest is a project under the implicit empty manifest", async () => {
    const root = await tree({ "main.hex": "module Main\n" });
    const program = await discover(root);
    expect(program.hasManifest).toBe(false);
    expect(program.manifest.name).toBeUndefined();
    expect(program.manifest.dependencies).toEqual([]);
    expect(program.files).toHaveLength(1);
  });

  test("`node_modules` and the skipped directories are not the project's source", async () => {
    const root = await tree({
      "hexagon.json": manifest({}),
      "main.hex": "module Main\n",
      "dist/out.hex": "module Out\n",
      ".claude/notes.hex": "module Notes\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/geometry.hex": "module Geometry\n",
    });
    const walked = await hexagonFilesUnder(root, NOTHING_EXCLUDED, nothingSeen(), () => {});
    expect(walked.files.map(({ path }) => path)).toEqual([`${root}/main.hex`]);
  });

  test("a package beneath an excluded directory is still a boundary the walk reports", async () => {
    const root = await tree({
      "hexagon.json": manifest({ name: "App", exclude: ["packages"] }),
      "main.hex": "module Main\n",
      "packages/loose.hex": "module Loose\n",
      "packages/geometry/hexagon.json": manifest({ name: "Geometry" }),
      "packages/geometry/shape.hex": "module Shape\n",
    });
    const excluded = [`${root}/packages`];
    const walked = await hexagonFilesUnder(
      root,
      { literal: excluded, real: excluded },
      nothingSeen(),
      () => {},
    );
    // The entry does bound this package's own files, `packages/loose.hex`
    // among them. What it cannot do is delete the package below it: §2.2 puts
    // `packages/geometry` outside this project's files before any `exclude` is
    // read, so the boundary is the walk's to report either way — and reporting
    // it is what makes the nested project exist whether or not the user happens
    // to have opened that folder as a root of its own.
    expect(walked.files.map(({ path }) => path)).toEqual([`${root}/main.hex`]);
    expect(walked.nested).toEqual([`${root}/packages/geometry`]);
  });

  /**
   * And the descent stops at the root, which is what keeps the boundary hunt
   * from finding programs that are nobody's.
   *
   * The walk follows links deliberately, so an excluded entry naming a link out
   * of the root would otherwise take the descent to a directory elsewhere on
   * the machine and report its `hexagon.json` — and a boundary becomes a
   * program, with its own files, its own diagnostics, and a root the user never
   * opened.
   */
  test("an excluded link out of the root reports no boundary from outside it", async () => {
    const outside = await tree({
      "pkg/hexagon.json": manifest({ name: "Elsewhere" }),
      "pkg/far.hex": "module Far\n",
    });
    const root = await tree({
      "hexagon.json": manifest({ name: "App", exclude: ["gen"] }),
      "main.hex": "module Main\n",
    });
    await symlink(outside, join(root, "gen"), "dir");
    const excluded = [`${root}/gen`];
    const walked = await hexagonFilesUnder(
      root,
      { literal: excluded, real: excluded },
      nothingSeen(),
      () => {},
    );
    expect(walked.files.map(({ path }) => path)).toEqual([`${root}/main.hex`]);
    expect(walked.nested).toEqual([]);
  });

  /**
   * Which package under a `node_modules` would hold a file — the question a
   * host asks before it tells anyone to write a `dependencies` entry.
   *
   * Everything here is measured against a real tree, because the answer is a
   * fact about npm's layout and about which directories hold a `hexagon.json`,
   * and a stub would only agree with this file's author.
   */
  test("`packageUnderNodeModules` finds the package a `dependencies` entry would reach", async () => {
    const root = await tree({
      "hexagon.json": manifest({ name: "App" }),
      "node_modules/loose/hexagon.json": manifest({ name: "Loose" }),
      "node_modules/loose/stray.hex": "module Stray\n",
      "node_modules/loose/dist/built.hex": "module Built\n",
      "node_modules/loose/vendor/hexagon.json": manifest({ name: "Vendored" }),
      "node_modules/loose/vendor/inside.hex": "module Inside\n",
      "node_modules/@scope/tool/hexagon.json": manifest({ name: "Tool" }),
      "node_modules/@scope/tool/tool.hex": "module Tool\n",
      "node_modules/.cache/junk.hex": "module Junk\n",
      "node_modules/deep/inner/pkg/hexagon.json": manifest({ name: "Deep" }),
      "node_modules/deep/inner/pkg/deep.hex": "module Deep\n",
    });
    const under = (path: string) => packageUnderNodeModules(root, join(root, path));

    // Directly inside a level root: the one shape an entry reaches.
    expect(under("node_modules/loose/stray.hex"))
      .toEqual({ root: `${root}/node_modules/loose`, nested: undefined });
    // A scoped name is two components and still one root (§4.1).
    expect(under("node_modules/@scope/tool/tool.hex"))
      .toEqual({ root: `${root}/node_modules/@scope/tool`, nested: undefined });
    // Inside the root, but inside a package of its own within it: listing the
    // root would not reach this file, and the caller has to be able to see so.
    expect(under("node_modules/loose/vendor/inside.hex"))
      .toEqual({ root: `${root}/node_modules/loose`, nested: `${root}/node_modules/loose/vendor` });
    // A skipped name below the root bounds the search: what is under `dist` is
    // `dist`'s business, and a manifest beneath one is not a package to open.
    expect(under("node_modules/loose/dist/built.hex"))
      .toEqual({ root: `${root}/node_modules/loose`, nested: undefined });
    // No package at all — a tool's cache is not a package, and there is nothing
    // to list.
    expect(under("node_modules/.cache/junk.hex")).toBeUndefined();
    // Nor is a manifest deeper than the layout puts one: no name resolves to
    // it, so calling it the package to list would be a repair that does
    // nothing. This has to agree with `lookup.ts`'s own scan.
    expect(under("node_modules/deep/inner/pkg/deep.hex")).toBeUndefined();
    // Not under a `node_modules` at all, and not under `root` at all.
    expect(packageUnderNodeModules(root, join(root, "main.hex"))).toBeUndefined();
    expect(packageUnderNodeModules(root, "/elsewhere/node_modules/a/x.hex")).toBeUndefined();
    // The first bound has to be the `node_modules`: a `node_modules` inside a
    // `dist` is inside a directory nothing reads.
    expect(packageUnderNodeModules(root, join(root, "dist/node_modules/a/x.hex")))
      .toBeUndefined();
  });

  test("a folder opened inside a package belongs to that package's project", async () => {
    const root = await tree({
      "hexagon.json": manifest({ name: "Acme" }),
      "src/main.hex": "module Main\n",
    });
    expect(await enclosingManifestDirectory(join(root, "src"))).toBe(root);
  });

  test("two roots reaching one directory are one project, and nesting is found once", async () => {
    const root = await tree({
      "hexagon.json": manifest({}),
      "main.hex": "module Main\n",
      "vendor/hexagon.json": manifest({ name: "Vendor" }),
    });
    await link(root, "alias", ".");
    const found = await projectDirectories(
      [reached(root), reached(join(root, "alias"))],
      async (at) => {
        const walked = await hexagonFilesUnder(at, NOTHING_EXCLUDED, nothingSeen(), () => {});
        return walked.nested;
      },
    );
    expect(found.map(({ directory }) => directory)).toEqual([root, `${root}/vendor`]);
    expect(found[0]!.roots).toHaveLength(2);
  });

  test("a root inside a package yields the package's project, not a second one", async () => {
    const root = await tree({
      "hexagon.json": manifest({ name: "Acme" }),
      "src/main.hex": "module Main\n",
    });
    const found = await projectDirectories([reached(join(root, "src"))], async () => []);
    expect(found.map(({ directory, hasManifest }) => [directory, hasManifest])).toEqual([
      [root, true],
    ]);
  });
});

describe("§4.1 — the walk's shape", () => {
  test("an ancestor named `node_modules` contributes no level of its own", () => {
    const lookup = new Lookup();
    expect(lookup.levelDirectories("/a/node_modules/b")).toEqual([
      "/a/node_modules/b/node_modules",
      "/a/node_modules",
      "/node_modules",
    ]);
  });

  /**
   * The climb keeps the path's **root**, whatever shape it has.
   *
   * A level list built by re-prefixing components with `/` asks for
   * `/C:/proj/node_modules`, which is nowhere — and a level that is not there
   * is not an error, so every `dependencies` entry on Windows would resolve to
   * nothing while reporting only "no installed package declares…". Under UNC it
   * lost the share and invented a level above it. Neither needs a Windows
   * runner to pin: the level list is a pure function of the path.
   */
  test("a drive letter, a UNC share and a POSIX root each keep their root", () => {
    const lookup = new Lookup();
    expect(lookup.levelDirectories("C:/proj")).toEqual([
      "C:/proj/node_modules",
      "C:/node_modules",
    ]);
    expect(lookup.levelDirectories("C:\\proj\\node_modules\\acme")).toEqual([
      "C:/proj/node_modules/acme/node_modules",
      "C:/proj/node_modules",
      "C:/node_modules",
    ]);
    // `//server/share` is one root: there is no `//server/node_modules` above a
    // share, and a level list that named one would scan a path that cannot
    // exist.
    expect(lookup.levelDirectories("//server/share/proj")).toEqual([
      "//server/share/proj/node_modules",
      "//server/share/node_modules",
    ]);
    expect(lookup.levelDirectories("/proj/node_modules/acme")).toEqual([
      "/proj/node_modules/acme/node_modules",
      "/proj/node_modules",
      "/node_modules",
    ]);
  });

  /**
   * The walk's bound, asked as a question, for the doors a host opens that the
   * walk never sees. Only the components *between* the two count: a dependency
   * lives under a `node_modules` and its own files are still its own.
   */
  test("`skippedDirectoryBetween` names what lies between a root and a file", () => {
    // The name, not a yes: a host telling a user why their buffer is dead has
    // to say which directory decided it, and `node_modules` and `dist` are
    // different sentences with different repairs.
    expect(skippedDirectoryBetween("/proj", "/proj/node_modules/acme/geometry.hex"))
      .toBe("node_modules");
    expect(skippedDirectoryBetween("/proj", "/proj/dist/generated.hex")).toBe("dist");
    expect(skippedDirectoryBetween("/proj", "/proj/src/main.hex")).toBeUndefined();
    // The root's own name is not between anything.
    expect(skippedDirectoryBetween("/proj/node_modules/acme", "/proj/node_modules/acme/g.hex"))
      .toBeUndefined();
    // Nor is the file's, which is a file and not a directory.
    expect(skippedDirectoryBetween("/proj", "/proj/dist")).toBeUndefined();
    // A path that is not beneath the root at all crosses nothing; whether it is
    // beneath it is the caller's separate question.
    expect(skippedDirectoryBetween("/proj", "/other/dist/x.hex")).toBeUndefined();
    // A whole component, never a prefix of one.
    expect(skippedDirectoryBetween("/proj", "/proj/distribution/x.hex")).toBeUndefined();
    // The **outermost** one wins — the one nearest the root, which is the one
    // that stopped the walk first and so the one that decided. The
    // `node_modules` below it is inside a directory nothing ever read.
    expect(skippedDirectoryBetween("/proj", "/proj/dist/node_modules/a/g.hex")).toBe("dist");
    // Separators are normalized first, so a Windows spelling reads the same.
    expect(skippedDirectoryBetween("C:\\proj", "C:\\proj\\node_modules\\a\\g.hex"))
      .toBe("node_modules");
  });

  /**
   * A package's directory is its identity (Packages §4.3), so it is absolute
   * and canonical at every call. A relative one is refused rather than climbed:
   * the climb walks it down to `""`, whose `node_modules` child is
   * `/node_modules` — a level at the filesystem root that belongs to nobody,
   * scanned on behalf of a caller whose own `node_modules` was never looked at,
   * and a wrong answer that reads exactly like a right one.
   */
  test("a relative directory is refused rather than climbed to the filesystem root", () => {
    const lookup = new Lookup();
    expect(() => lookup.levelDirectories("relative/dir")).toThrow(
      /absolute directory/u,
    );
    expect(() => lookup.levelDirectories("")).toThrow(/absolute directory/u);
    // A drive-relative path is relative too: `C:proj` names a place only the
    // process's own per-drive working directory can settle.
    expect(() => lookup.levelDirectories("proj")).toThrow(/absolute directory/u);
  });

  /**
   * The leading `//` of a UNC path is part of its root, not a repeated
   * separator: `/server/share` is a directory at the filesystem root, on a
   * machine that may well not have one.
   */
  test("`normalizePath` keeps a UNC prefix and collapses everything else", () => {
    expect(normalizePath("//server/share/proj/./sub")).toBe("//server/share/proj/sub");
    expect(normalizePath("\\\\server\\share\\proj")).toBe("//server/share/proj");
    expect(normalizePath("///a//b")).toBe("/a/b");
    expect(normalizePath("/a/b/../c")).toBe("/a/c");
    expect(normalizePath("C:\\proj\\sub")).toBe("C:/proj/sub");
  });
});

describe("D1 — one program per project directory", () => {
  test("a root's own project comes before the projects nested beneath it", async () => {
    const root = await tree({
      "hexagon.json": manifest({}),
      "main.hex": "module Main\n",
      "vendor/hexagon.json": manifest({ name: "Vendor" }),
      "vendor/thing.hex": "module Thing\n",
      "vendor/deeper/hexagon.json": manifest({ name: "Deeper" }),
      "vendor/deeper/deep.hex": "module Deep\n",
    });
    const programs = await discoverPrograms([reached(root)]);
    expect(programs.map(({ directory }) => directory)).toEqual([
      root,
      `${root}/vendor`,
      `${root}/vendor/deeper`,
    ]);
    // Each holds its own files and no other's.
    expect(programs.map(({ files }) => files.map(({ path }) => path))).toEqual([
      [`${root}/main.hex`],
      [`${root}/vendor/thing.hex`],
      [`${root}/vendor/deeper/deep.hex`],
    ]);
  });

  test("two roots see each other only through an installed dependency", async () => {
    const root = await tree({
      "a/hexagon.json": manifest({}),
      "a/main.hex": "module Main\n",
      "b/hexagon.json": manifest({ name: "Bee" }),
      "b/bee.hex": "module Bee\n",
    });
    const programs = await discoverPrograms([reached(join(root, "a")), reached(join(root, "b"))]);
    expect(programs.map(({ directory }) => directory)).toEqual([`${root}/a`, `${root}/b`]);
    expect(programs[0]!.packages).toEqual([]);
  });
});

describe("§4.1 — the level scan reads one field", () => {
  test("a scanned root's `exclude` is not validated, and its `package.json` not read", async () => {
    // A root nobody resolves to, whose manifest would draw a warning if it were
    // validated: the level scan reads its `name` and stops, so a level holding
    // hundreds of packages costs one small read each rather than a full check.
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/geometry.hex": "module Geometry\n",
      "node_modules/junk/hexagon.json": manifest({ name: "Junk", exclude: ["nowhere"] }),
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([]);
  });

  test("a package the lookup answers with has its `dependencies` read", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Junk"] }),
      "main.hex": "module Main\n",
      "node_modules/junk/hexagon.json": manifest({ name: "Junk", dependencies: ["Missing"] }),
      "node_modules/junk/junk.hex": "module Junk\n",
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([
      "no installed package declares `\"name\": \"Missing\"`; install it, or check the " +
        "name in its `hexagon.json`",
    ]);
  });

  /**
   * The guard that keeps the level scan cheap: two candidates are §4.3's
   * refusal, and neither one's manifest, files, or own lookups are read.
   */
  test("neither of two candidates at one level has its own entries resolved", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n",
      // Each carries a `dependencies` entry §4.4 refuses, which a package that
      // *entered* the set would publish — so whichever the walk would reach
      // first, reaching either shows.
      "node_modules/acme-a/hexagon.json": manifest({ name: "Acme", dependencies: ["hex"] }),
      "node_modules/acme-a/a.hex": "module A\n",
      "node_modules/acme-b/hexagon.json": manifest({ name: "Acme", dependencies: ["hex"] }),
      "node_modules/acme-b/b.hex": "module B\n",
    });
    const program = await discover(root);
    // The installed-twice report and nothing else: neither candidate's own
    // `dependencies` were resolved, and neither manifest's problems published.
    expect(messages(program)).toEqual([
      "package `Acme` is installed twice: `node_modules/acme-a` and `node_modules/acme-b`; " +
        "a program holds one copy of each Hexagon package",
    ]);
  });
});

describe("§7 — an installed package that ships no Hexagon source", () => {
  test("a package with a manifest and no `.hex` draws the stage-one row", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/package.json": manifest({ name: "@acme/geometry", version: "2.1.0" }),
      "node_modules/acme/dist/index.js": "export const x = 1;\n",
    });
    const program = await discover(root);
    expect(program.problems).toEqual([{
      path: `${root}/hexagon.json`,
      line: 2,
      message: "`Acme` ships no Hexagon source; a Hexagon package is installed as source " +
        "until compiled distribution exists",
      severity: "error",
    }]);
  });

  /** Seated at the manifest carrying the entry, like every other §7 row (D3). */
  test("a dependency's own sourceless entry reports against the dependency's manifest", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Bolt"] }),
      "main.hex": "module Main\n",
      "node_modules/bolt/hexagon.json": manifest({ name: "Bolt", dependencies: ["Acme"] }),
      "node_modules/bolt/tools.hex": "module Tools\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
    });
    const program = await discover(root);
    expect(program.problems).toEqual([{
      path: `${root}/node_modules/bolt/hexagon.json`,
      line: 3,
      message: "`Acme` ships no Hexagon source; a Hexagon package is installed as source " +
        "until compiled distribution exists",
      severity: "error",
    }]);
  });

  test("a package whose only `.hex` its own `exclude` removes ships none", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme", exclude: ["generated"] }),
      "node_modules/acme/generated/out.hex": "module Out\n",
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([
      "`Acme` ships no Hexagon source; a Hexagon package is installed as source " +
        "until compiled distribution exists",
    ]);
  });

  test("an installed package nobody lists draws nothing, and the project draws nothing", async () => {
    const root = await tree({
      "hexagon.json": manifest({}),
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
    });
    const program = await discover(root);
    // The project's own emptiness is a project starting, not a distribution
    // shipped wrong; the unlisted package is in no closure.
    expect(messages(program)).toEqual([]);
  });
});
