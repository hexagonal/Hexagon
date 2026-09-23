import { describe, expect, test } from "vitest";
import { resolve } from "node:path";
import { compileProject, Source } from "../../compiler/src/index.js";
import { artifactsOf, emittedRootPaths } from "./artifacts.js";

describe("compiler artifact mapping", () => {
  test("writes module JavaScript, declarations, runtime support, and the ESM boundary", () => {
    const source = new Source.File(
      Source.fileId(0),
      "/project/main.hex",
      "module Main\n\nexport record Set = { items: Vector(Int) }\n" +
        "export let n(s: Set): Int = Vector.length(s.items)\n",
    );
    const compiled = compileProject([source], { roots: [source.id] });
    expect(compiled.diagnostics).toEqual([]);
    const artifacts = artifactsOf(compiled);
    expect([...artifacts.keys()]).toEqual(expect.arrayContaining([
      "Main.js",
      "Main.d.ts",
      "hex.js",
      "hex.d.ts",
      "package.json",
    ]));
    const output = resolve("out");
    expect(emittedRootPaths(compiled, output)).toEqual([resolve(output, "Main.js")]);
  });
});
