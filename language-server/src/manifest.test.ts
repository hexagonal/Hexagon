import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { MANIFEST_NAME, isExcluded, readManifest } from "./manifest.js";

let root = "";

async function rootWith(contents?: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "hexagon-manifest-"));
  if (contents !== undefined) await writeFile(join(root, MANIFEST_NAME), contents, "utf8");
  return root;
}

/**
 * Creates the paths a manifest names, so that a test about something else is
 * not also a test about whether they exist. An entry matching nothing is a
 * reported problem in its own right, and most of these fixtures would otherwise
 * carry that warning into assertions that have nothing to do with it.
 */
async function make(path: string, ...entries: readonly string[]): Promise<void> {
  for (const entry of entries) {
    await mkdir(dirname(join(path, entry)), { recursive: true });
    if (extname(entry) === "") await mkdir(join(path, entry), { recursive: true });
    else await writeFile(join(path, entry), "", "utf8");
  }
}

afterEach(async () => {
  if (root !== "") await rm(root, { recursive: true, force: true });
  root = "";
});

describe("readManifest", () => {
  test("a root with no manifest is not a problem", async () => {
    const path = await rootWith();
    const result = await readManifest(path);
    expect(result.present).toBe(false);
    expect(result.problems).toEqual([]);
    expect(result.manifest).toEqual({ runtimePaths: [], exclude: [] });
  });

  test("paths resolve against the manifest, not the process", async () => {
    const path = await rootWith(
      JSON.stringify({ runtimePaths: ["runtime/VectorTrie.hex"], exclude: ["examples"] }),
    );
    await make(path, "runtime/VectorTrie.hex", "examples");
    const result = await readManifest(path);
    // Relative to the manifest is the only reading that survives the project
    // being checked out somewhere else, or the server being launched elsewhere.
    expect(result.manifest.runtimePaths).toEqual([join(path, "runtime/VectorTrie.hex")]);
    expect(result.manifest.exclude).toEqual([join(path, "examples")]);
    expect(result.problems).toEqual([]);
  });

  test("a byte-order mark is not a syntax error", async () => {
    // VS Code writes one when `files.encoding` is `utf8bom`, and `JSON.parse`
    // then fails complaining about a character nobody can see.
    const path = await rootWith(`\uFEFF${JSON.stringify({ exclude: ["build"] })}`);
    await make(path, "build");
    const result = await readManifest(path);
    expect(result.problems).toEqual([]);
    expect(result.manifest.exclude).toEqual([join(path, "build")]);
  });

  test("a key's line is found by position, not by spelling anywhere", async () => {
    const path = await rootWith(
      ['{', '  "exclude": ["runtimePaths"],', '  "runtimePaths": "nope"', '}'].join("\n"),
    );
    await make(path, "runtimePaths");
    const result = await readManifest(path);
    // The string value on line 1 spells the key reported on line 2; a substring
    // search would point at the wrong line.
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.line).toBe(2);
  });

  test("malformed JSON is reported, not swallowed", async () => {
    const path = await rootWith("{ runtimePaths: [] }");
    const result = await readManifest(path);
    expect(result.present).toBe(true);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.message).toContain("not valid JSON");
    // Defaults still apply, so one broken manifest does not take the whole
    // workspace's language support down with it.
    expect(result.manifest).toEqual({ runtimePaths: [], exclude: [] });
  });

  test("a misspelled key is named, and points at its own line", async () => {
    const path = await rootWith(
      ['{', '  "runtimePath": [],', '  "exclude": []', '}'].join("\n"),
    );
    const result = await readManifest(path);
    // Silence here is expensive: the user believes they configured something,
    // sees no effect, and has nothing to look at. The near-miss is the common
    // case, so the message names both the key and what was expected.
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.message).toContain("`runtimePath`");
    expect(result.problems[0]!.message).toContain("`runtimePaths`");
    expect(result.problems[0]!.line).toBe(1);
  });

  test("wrong types are reported per field, and the rest still applies", async () => {
    const path = await rootWith(
      ['{', '  "runtimePaths": "runtime/VectorTrie.hex",', '  "exclude": ["build"]', '}'].join("\n"),
    );
    await make(path, "build");
    const result = await readManifest(path);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.message).toContain("must be an array");
    expect(result.manifest.runtimePaths).toEqual([]);
    expect(result.manifest.exclude).toEqual([join(path, "build")]);
  });

  test("an entry that is the workspace root is refused, not obeyed", async () => {
    // `""`, `"."` and `"./"` resolve *to* the root; `".."` and `"/"` resolve
    // above it and exclude it just as totally. Testing equality alone would
    // catch the first three and let the last two through silently.
    for (const entry of ["", ".", "./", "..", "/"]) {
      const path = await rootWith(JSON.stringify({ exclude: [entry] }));
      const result = await readManifest(path);
      // Each would exclude the entire project — every file, silently, with the
      // server reporting nothing at all. Nobody writes that on purpose.
      expect(result.manifest.exclude, entry).toEqual([]);
      expect(result.problems.map(({ message }) => message).join(" "), entry)
        .toContain("workspace root");
      await rm(path, { recursive: true, force: true });
    }
    root = "";
  });

  test("an entry that matches no file is reported rather than ignored", async () => {
    const path = await rootWith(
      ['{', '  "runtimePaths": ["runtime/Trie.hex"],', '  "exclude": ["Examples"]', '}'].join("\n"),
    );
    // The likeliest cause is a case the filesystem itself forgives: on macOS and
    // Windows the user's editor opens `Trie.hex` when the file is `trie.hex`, so
    // nothing anywhere else hints that this entry matches nothing — while the
    // privilege it was meant to grant silently does not happen, and the errors
    // it was written to remove come straight back.
    await make(path, "runtime/trie.hex", "examples");
    const result = await readManifest(path);
    expect(result.problems.map(({ line, severity }) => ({ line, severity }))).toEqual([
      { line: 1, severity: "warning" },
      { line: 2, severity: "warning" },
    ]);
    for (const problem of result.problems) expect(problem.message).toContain("matches no file");
    // Still applied: the entry is inert either way, and dropping it would mean
    // the manifest quietly said something different from what it says.
    expect(result.manifest.runtimePaths).toEqual([join(path, "runtime/Trie.hex")]);
  });

  test("a directory in `runtimePaths` is refused, not silently matched", async () => {
    const path = await rootWith(JSON.stringify({ runtimePaths: ["runtime"] }));
    await make(path, "runtime/Trie.hex");
    const result = await readManifest(path);
    // `exclude` takes a directory, so writing one here is the natural mistake —
    // and it matches no compiled file, leaving the errors the entry was written
    // to remove exactly where they were, with nothing to explain why.
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.severity).toBe("error");
    expect(result.problems[0]!.message).toContain("is a directory");
    expect(result.manifest.runtimePaths).toEqual([]);
  });

  test("a separator the exclusion honours is not called a mismatch", async () => {
    const path = await rootWith(JSON.stringify({ exclude: ["gen\\a.hex"] }));
    await make(path, "gen/a.hex");
    const result = await readManifest(path);
    // `isExcluded` compares through `comparablePath`, which reads a backslash as
    // a separator — so this entry really does exclude `gen/a.hex`. Splitting on
    // the platform's separator instead would report "has no effect" about an
    // entry that has one, which is worse than saying nothing.
    expect(result.problems).toEqual([]);
  });

  test("an entry outside the root is judged by existence, not spelling", async () => {
    const path = await rootWith(JSON.stringify({ exclude: ["../absent-sibling"] }));
    const result = await readManifest(path);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.message).toContain("matches no file");
  });

  test("a directory whose name begins with two dots is inside the root", async () => {
    const path = await rootWith(JSON.stringify({ exclude: ["..hidden"] }));
    await mkdir(join(path, "..hidden"));
    // `relative` returns `..hidden`, which starts with `..` without being the
    // parent — testing that as a prefix rather than as a whole component sends
    // a directory plainly inside the root down the outside-root path.
    const result = await readManifest(path);
    expect(result.problems).toEqual([]);
  });

  test("a name beginning with two dots is still checked for its case", async () => {
    const path = await rootWith(JSON.stringify({ exclude: ["..Hidden"] }));
    await mkdir(join(path, "..hidden"));
    // The consequence of taking the outside-root path is losing the exact-case
    // check, which is the whole point of the component walk. Only a filesystem
    // that ignores case can tell the two apart — everywhere else the entry
    // simply does not exist — so this asserts the outcome that holds on both
    // and discriminates where it can.
    const result = await readManifest(path);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.message).toContain("matches no file");
  });

  test("a mistake outranks an entry that merely matches nothing", async () => {
    const path = await rootWith(['{', '  "exclude": ["absent"],', '  "nope": []', '}'].join("\n"));
    const result = await readManifest(path);
    // Two different claims: a misspelled key is wrong today and always will be,
    // while `exclude: ["dist"]` in a fresh clone is only ahead of the build that
    // creates it. Reporting both as errors would teach a user to ignore both.
    expect(result.problems.map(({ severity }) => severity).sort()).toEqual(["error", "warning"]);
  });

  test("a non-object manifest is refused outright", async () => {
    const path = await rootWith('["runtime/VectorTrie.hex"]');
    const result = await readManifest(path);
    expect(result.problems.map(({ message }) => message)).toEqual([
      `${MANIFEST_NAME} must contain a JSON object`,
    ]);
  });
});

describe("isExcluded", () => {
  test("matches a file exactly and a directory by prefix", () => {
    const exclude = ["/p/examples", "/p/one.hex"];
    expect(isExcluded("/p/one.hex", exclude)).toBe(true);
    expect(isExcluded("/p/examples/broken.hex", exclude)).toBe(true);
    expect(isExcluded("/p/examples", exclude)).toBe(true);
  });

  test("a Windows-shaped path is excluded like any other", () => {
    // Both operands reach `isExcluded` with native separators: the walk builds
    // them with `join`, the manifest with `resolve`. Comparing raw is right on
    // POSIX by coincidence and wrong on Windows always — and wrong silently,
    // because an exclusion that never matches looks like one nobody wrote.
    expect(isExcluded("C:\\repo\\generated\\a.hex", ["C:\\repo\\generated"])).toBe(true);
    expect(isExcluded("C:/repo/generated/a.hex", ["C:\\repo\\generated"])).toBe(true);
    expect(isExcluded("C:\\repo\\src\\a.hex", ["C:\\repo\\generated"])).toBe(false);
  });

  test("a trailing separator on an entry does not stop it matching", () => {
    expect(isExcluded("/p/examples/a.hex", ["/p/examples/"])).toBe(true);
    expect(isExcluded("/p/examples", ["/p/examples/"])).toBe(true);
  });

  test("a prefix match respects directory boundaries", () => {
    // `examples-of-things` is not inside `examples`, and a naive `startsWith`
    // would exclude it — silently, since an excluded file reports nothing.
    expect(isExcluded("/p/examples-of-things/main.hex", ["/p/examples"])).toBe(false);
    expect(isExcluded("/p/other.hex", ["/p/one.hex"])).toBe(false);
  });
});
