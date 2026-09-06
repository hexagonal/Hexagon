/**
 * Discovery against real directories.
 *
 * Every fixture here is a real `node_modules` tree with real files and real
 * symlinks, because the rules Packages §4.1 states are about what npm actually
 * lays down: a hoisted install, a nested duplicate, a scoped name, a linked
 * workspace, two links to one directory. A stubbed filesystem would let this
 * file agree with its author's idea of npm rather than with npm.
 */

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { Lookup } from "./lookup.js";
import { discoverProgram, discoverPrograms } from "./packages.js";
import { enclosingManifestDirectory, projectDirectories } from "./projects.js";
import { hexagonFilesUnder, nothingSeen, NOTHING_EXCLUDED } from "./files.js";
import { normalizePath } from "./paths.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

/** Writes a tree of files and answers with its canonical root. */
async function tree(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hexagon-host-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    const at = join(root, path);
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, text, "utf8");
  }
  return normalizePath(await realpath(root));
}

async function link(root: string, from: string, to: string): Promise<void> {
  await mkdir(dirname(join(root, from)), { recursive: true });
  await symlink(join(root, to), join(root, from), "dir");
}

const manifest = (fields: Readonly<Record<string, unknown>>): string =>
  `${JSON.stringify(fields, undefined, 2)}\n`;

async function discover(directory: string) {
  return await discoverProgram(directory, new Lookup());
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
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/package.json": manifest({ version: "1.0.0" }),
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
      "node_modules/@bolt/tools/hexagon.json": manifest({ name: "Bolt", dependencies: ["Acme"] }),
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
      "node_modules/@acme/geometry/hexagon.json": manifest({ name: "Acme" }),
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
    });
    const program = await discover(root);
    const report = program.problems.find(({ message }) => message.includes("Missing"))!;
    expect(report.path).toBe(`${root}/node_modules/bolt/hexagon.json`);
    // Seated on the entry's own line, not on the field's.
    expect(report.line).toBe(3);
  });

  test("a package that entered the set is checked in full, against its own manifest", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Bolt"] }),
      "main.hex": "module Main\n",
      "node_modules/bolt/hexagon.json": manifest({ name: "Bolt", nonsense: true }),
    });
    const program = await discover(root);
    expect(program.problems).toEqual([{
      path: `${root}/node_modules/bolt/hexagon.json`,
      line: 2,
      message: "unknown hexagon.json key `nonsense`; expected `name`, `dependencies`, `exclude`",
      severity: "error",
    }]);
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
    const found = await projectDirectories([root, join(root, "alias")], async (at) => {
      const walked = await hexagonFilesUnder(at, NOTHING_EXCLUDED, nothingSeen(), () => {});
      return walked.nested;
    });
    expect(found.map(({ directory }) => directory)).toEqual([root, `${root}/vendor`]);
    expect(found[0]!.roots).toHaveLength(2);
  });

  test("a root inside a package yields the package's project, not a second one", async () => {
    const root = await tree({
      "hexagon.json": manifest({ name: "Acme" }),
      "src/main.hex": "module Main\n",
    });
    const found = await projectDirectories([join(root, "src")], async () => []);
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
    const programs = await discoverPrograms([root]);
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
    const programs = await discoverPrograms([join(root, "a"), join(root, "b")]);
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
      "node_modules/junk/hexagon.json": manifest({ name: "Junk", exclude: ["nowhere"] }),
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([]);
  });

  test("a package the lookup answers with is validated in full", async () => {
    const root = await tree({
      "hexagon.json": manifest({ dependencies: ["Junk"] }),
      "main.hex": "module Main\n",
      "node_modules/junk/hexagon.json": manifest({ name: "Junk", exclude: ["nowhere"] }),
    });
    const program = await discover(root);
    expect(messages(program)).toEqual([
      "hexagon.json `exclude` entry \"nowhere\" matches no file or directory, so it " +
        "has no effect (check the spelling, including its case)",
    ]);
  });
});
