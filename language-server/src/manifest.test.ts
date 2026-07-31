import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { MANIFEST_NAME, isExcluded, readManifest } from "./manifest.js";

let root = "";

async function rootWith(contents?: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "hexagon-manifest-"));
  if (contents !== undefined) await writeFile(join(root, MANIFEST_NAME), contents, "utf8");
  return root;
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
    const result = await readManifest(path);
    // Relative to the manifest is the only reading that survives the project
    // being checked out somewhere else, or the server being launched elsewhere.
    expect(result.manifest.runtimePaths).toEqual([join(path, "runtime/VectorTrie.hex")]);
    expect(result.manifest.exclude).toEqual([join(path, "examples")]);
    expect(result.problems).toEqual([]);
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
    const result = await readManifest(path);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.message).toContain("must be an array");
    expect(result.manifest.runtimePaths).toEqual([]);
    expect(result.manifest.exclude).toEqual([join(path, "build")]);
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

  test("a prefix match respects directory boundaries", () => {
    // `examples-of-things` is not inside `examples`, and a naive `startsWith`
    // would exclude it — silently, since an excluded file reports nothing.
    expect(isExcluded("/p/examples-of-things/main.hex", ["/p/examples"])).toBe(false);
    expect(isExcluded("/p/other.hex", ["/p/one.hex"])).toBe(false);
  });
});
