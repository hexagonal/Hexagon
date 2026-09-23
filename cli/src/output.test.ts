import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputError, writeOutput } from "./output.js";

const injectedFailure = vi.hoisted(() => ({ destinationSuffix: undefined as string | undefined }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (oldPath: string, newPath: string): Promise<void> => {
      if (
        injectedFailure.destinationSuffix !== undefined &&
        newPath.endsWith(injectedFailure.destinationSuffix)
      ) {
        injectedFailure.destinationSuffix = undefined;
        throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
      }
      await actual.rename(oldPath, newPath);
    },
  };
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  injectedFailure.destinationSuffix = undefined;
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("writeOutput", () => {
  it("records ownership, removes stale owned files, and preserves unrelated files", async () => {
    const fixture = await createFixture();
    await write(fixture, new Map([["old/Old.js", "old\n"], ["package.json", "{}\n"]]));
    await writeFile(join(fixture.output, "notes.txt"), "mine\n");

    await write(fixture, new Map([["Main.js", "main\n"], ["package.json", "{\"type\":\"module\"}\n"]]));

    await expect(readFile(join(fixture.output, "Main.js"), "utf8")).resolves.toBe("main\n");
    await expect(readFile(join(fixture.output, "notes.txt"), "utf8")).resolves.toBe("mine\n");
    await expect(lstat(join(fixture.output, "old/Old.js"))).rejects.toMatchObject({ code: "ENOENT" });
    const record = JSON.parse(await readFile(join(fixture.output, ".hexc-output.json"), "utf8"));
    expect(record).toMatchObject({
      formatVersion: 1,
      projectDirectory: await realpath(fixture.project),
      compilerVersion: "0.1.0",
      roots: [fixture.root],
    });
    expect(record.files.map((file: { path: string }) => file.path)).toEqual([
      "Main.js",
      "package.json",
    ]);
  });

  it("refuses unowned collisions, including package.json", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.output);
    await writeFile(join(fixture.output, "package.json"), "{}\n");

    await expect(write(fixture, new Map([["package.json", "{}\n"]]))).rejects.toThrow(
      /unowned file/u,
    );
    await expect(readFile(join(fixture.output, "package.json"), "utf8")).resolves.toBe("{}\n");
  });

  it("allows a case-only rename of verified owned output but refuses an unowned spelling", async () => {
    const fixture = await createFixture();
    await write(fixture, new Map([["Main.js", "old\n"]]));

    await write(fixture, new Map([["MAIN.js", "new\n"]]));

    await expect(readFile(join(fixture.output, "MAIN.js"), "utf8")).resolves.toBe("new\n");
    const record = JSON.parse(await readFile(join(fixture.output, ".hexc-output.json"), "utf8"));
    expect(record.files.map((file: { path: string }) => file.path)).toEqual(["MAIN.js"]);

    const unowned = await createFixture();
    await mkdir(unowned.output);
    await writeFile(join(unowned.output, "Main.js"), "mine\n");
    await expect(write(unowned, new Map([["MAIN.js", "generated\n"]]))).rejects.toThrow(
      /case-collides/u,
    );
    await expect(readFile(join(unowned.output, "Main.js"), "utf8")).resolves.toBe("mine\n");
  });

  it("allows a wholly owned directory case rename and preserves unrelated directory contents", async () => {
    const fixture = await createFixture();
    await write(fixture, new Map([["Foo/Bar/Baz/Main.js", "old\n"]]));
    await write(fixture, new Map([["FOO/Bar/Baz/Main.js", "new\n"]]));
    await expect(readFile(join(fixture.output, "FOO/Bar/Baz/Main.js"), "utf8")).resolves.toBe(
      "new\n",
    );

    const withHelper = await createFixture();
    await write(withHelper, new Map([["Foo/Bar/Baz/Main.js", "old\n"]]));
    await writeFile(join(withHelper.output, "Foo/helper.js"), "mine\n");
    await expect(
      write(withHelper, new Map([["FOO/Bar/Baz/Main.js", "new\n"]])),
    ).rejects.toThrow(/case-collides/u);
    await expect(readFile(join(withHelper.output, "Foo/helper.js"), "utf8")).resolves.toBe("mine\n");
  });

  it.each([
    ["the first renamed artifact", join("FOO", "Bar", "Baz", "Main.js")],
    ["a later artifact", join("z", "Last.js")],
  ])("restores nested original spelling when applying %s fails", async (_label, failureSuffix) => {
    const fixture = await createFixture();
    const originalPath = "Foo/Bar/Baz/Main.js";
    const renamedPath = "FOO/Bar/Baz/Main.js";
    await write(fixture, new Map([[originalPath, "old\n"]]));

    injectedFailure.destinationSuffix = failureSuffix;
    await expect(
      write(fixture, new Map([[renamedPath, "new\n"], ["z/Last.js", "last\n"]])),
    ).rejects.toThrow(/previous output was restored/u);
    await expect(readFile(join(fixture.output, originalPath), "utf8")).resolves.toBe("old\n");
    expect(await readdir(fixture.output)).toContain("Foo");
    expect(await readdir(join(fixture.output, "Foo"))).toContain("Bar");
    expect(await readdir(join(fixture.output, "Foo/Bar"))).toContain("Baz");
    const record = JSON.parse(await readFile(join(fixture.output, ".hexc-output.json"), "utf8"));
    expect(record.files.map((file: { path: string }) => file.path)).toEqual([originalPath]);

    await write(fixture, new Map([[originalPath, "after rollback\n"]]));
    await expect(readFile(join(fixture.output, originalPath), "utf8")).resolves.toBe(
      "after rollback\n",
    );
  });

  it("restores original path spelling after a failed case-only replacement", async () => {
    const fixture = await createFixture();
    await write(fixture, new Map([["Main.js", "old\n"]]));

    injectedFailure.destinationSuffix = join("z", "Last.js");
    await expect(
      write(fixture, new Map([["MAIN.js", "new\n"], ["z/Last.js", "last\n"]])),
    ).rejects.toThrow(/previous output was restored/u);
    const recordAfterFailure = JSON.parse(
      await readFile(join(fixture.output, ".hexc-output.json"), "utf8"),
    );
    expect(recordAfterFailure.files.map((file: { path: string }) => file.path)).toEqual(["Main.js"]);
    await expect(readFile(join(fixture.output, "Main.js"), "utf8")).resolves.toBe("old\n");

    await write(fixture, new Map([["Main.js", "after rollback\n"]]));
    await expect(readFile(join(fixture.output, "Main.js"), "utf8")).resolves.toBe(
      "after rollback\n",
    );
  });

  it("does not mistake a distinct unowned case variant for the old owned file", async () => {
    const fixture = await createFixture();
    await write(fixture, new Map([["Main.js", "owned\n"]]));
    const distinctVariant = await writeFile(join(fixture.output, "MAIN.js"), "unowned\n", {
      flag: "wx",
    }).then(
      () => true,
      (error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          return false;
        }
        throw error;
      },
    );
    if (!distinctVariant) return;

    await expect(write(fixture, new Map([["MAIN.js", "generated\n"]]))).rejects.toThrow(
      /case-collides|unowned file/u,
    );
    await expect(readFile(join(fixture.output, "Main.js"), "utf8")).resolves.toBe("owned\n");
    await expect(readFile(join(fixture.output, "MAIN.js"), "utf8")).resolves.toBe("unowned\n");
  });

  it("refuses to overwrite or delete manually changed owned output", async () => {
    const fixture = await createFixture();
    await write(fixture, new Map([["Main.js", "generated\n"]]));
    await writeFile(join(fixture.output, "Main.js"), "manual\n");

    await expect(write(fixture, new Map())).rejects.toThrow(/Main\.js was modified/u);
    await expect(readFile(join(fixture.output, "Main.js"), "utf8")).resolves.toBe("manual\n");
  });

  it("rejects an active lock without changing output", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.output);
    await writeFile(join(fixture.output, ".hexc-output.lock"), "held");

    await expect(write(fixture, new Map([["Main.js", "main\n"]]))).rejects.toThrow(
      /Cannot acquire the output lock/u,
    );
    await expect(lstat(join(fixture.output, "Main.js"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses malformed metadata and another project's ownership", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.output);
    await writeFile(join(fixture.output, ".hexc-output.json"), "not JSON");
    await expect(write(fixture, new Map())).rejects.toThrow(/malformed JSON/u);

    const otherProject = join(fixture.holder, "other");
    await mkdir(otherProject);
    await writeFile(
      join(fixture.output, ".hexc-output.json"),
      JSON.stringify({
        formatVersion: 1,
        projectDirectory: await realpath(otherProject),
        compilerVersion: "0.1.0",
        roots: [],
        files: [],
      }),
    );
    await expect(write(fixture, new Map())).rejects.toThrow(/another project/u);
  });

  it("rejects case collisions and symbolic-link traversal", async () => {
    const fixture = await createFixture();
    await expect(
      write(fixture, new Map([["Main.js", "one"], ["main.js", "two"]])),
    ).rejects.toThrow(/Case-colliding/u);

    await mkdir(fixture.output);
    const outside = join(fixture.holder, "outside");
    await mkdir(outside);
    await symlink(outside, join(fixture.output, "linked"));
    await expect(write(fixture, new Map([["linked/Main.js", "main"]]))).rejects.toThrow(
      /traverses symbolic link/u,
    );
    await expect(lstat(join(outside, "Main.js"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back installed files after a handled apply failure", async () => {
    const fixture = await createFixture();
    await write(fixture, new Map([["A.js", "old\n"]]));

    injectedFailure.destinationSuffix = join("z", "Last.js");
    await expect(
      write(fixture, new Map([["A.js", "new\n"], ["z/Last.js", "last\n"]])),
    ).rejects.toThrow(/previous output was restored/u);

    await expect(readFile(join(fixture.output, "A.js"), "utf8")).resolves.toBe("old\n");
    await expect(lstat(join(fixture.output, "z/Last.js"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(fixture.output, ".hexc-output-interrupted"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("blocks a build after an interrupted transaction marker", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.output);
    await writeFile(
      join(fixture.output, ".hexc-output-interrupted"),
      JSON.stringify({ recoveryDirectory: join(fixture.output, "recovery") }),
    );
    await expect(write(fixture, new Map())).rejects.toThrow(/interrupted build/u);
  });

  it("keeps case-distinct canonical project identities separate when the filesystem does", async () => {
    const holder = await mkdtemp(join(tmpdir(), "hexc-output-case-owner-"));
    temporaryDirectories.push(holder);
    const upperProject = join(holder, "App");
    const lowerProject = join(holder, "app");
    await mkdir(upperProject);
    const supportsDistinctCase = await mkdir(lowerProject).then(
      () => true,
      (error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          return false;
        }
        throw error;
      },
    );
    if (!supportsDistinctCase) return;
    const canonicalUpper = await realpath(upperProject);
    const canonicalLower = await realpath(lowerProject);
    if (canonicalUpper === canonicalLower) return;

    const upperRoot = join(upperProject, "Main.hex");
    const lowerRoot = join(lowerProject, "Main.hex");
    await writeFile(upperRoot, "module Main\n");
    await writeFile(lowerRoot, "module Main\n");
    const output = join(holder, "output");
    await writeOutput({
      projectDirectory: upperProject,
      outputDirectory: output,
      artifacts: new Map([["Main.js", "upper\n"]]),
      roots: [upperRoot],
      version: "0.1.0",
      protectedPaths: [upperRoot],
      dependencyDirectories: [],
    });

    await expect(
      writeOutput({
        projectDirectory: lowerProject,
        outputDirectory: output,
        artifacts: new Map([["Main.js", "lower\n"]]),
        roots: [lowerRoot],
        version: "0.1.0",
        protectedPaths: [lowerRoot],
        dependencyDirectories: [],
      }),
    ).rejects.toThrow(/another project/u);
    await expect(readFile(join(output, "Main.js"), "utf8")).resolves.toBe("upper\n");

    await writeOutput({
      projectDirectory: upperProject,
      outputDirectory: lowerProject,
      artifacts: new Map(),
      roots: [upperRoot],
      version: "0.1.0",
      protectedPaths: [upperRoot],
      dependencyDirectories: [],
    });
  });
});

interface Fixture {
  holder: string;
  project: string;
  output: string;
  root: string;
}

async function createFixture(): Promise<Fixture> {
  const holder = await mkdtemp(join(tmpdir(), "hexc-output-test-"));
  temporaryDirectories.push(holder);
  const project = join(holder, "project");
  await mkdir(project);
  const root = join(project, "Main.hex");
  await writeFile(root, "module Main\n");
  return { holder, project, output: join(project, "dist"), root };
}

async function write(fixture: Fixture, artifacts: ReadonlyMap<string, string>): Promise<void> {
  await writeOutput({
    projectDirectory: fixture.project,
    outputDirectory: fixture.output,
    artifacts,
    roots: [fixture.root],
    version: "0.1.0",
    protectedPaths: [fixture.root],
    dependencyDirectories: [],
  });
}

it("exports OutputError for callers to classify policy failures", () => {
  expect(new OutputError("failure")).toBeInstanceOf(Error);
});
