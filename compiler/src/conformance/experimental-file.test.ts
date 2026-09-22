import { describe, expect, test } from "vitest";
import { compileMain, projectDiagnostics } from "../support/test-project.js";
import { STDLIB_SOURCES } from "../stdlib-sources.js";

const imports = `module Main
import Hex.Experimental.File as File
import Hex.Experimental.Node.File as NodeFile
`;

describe("experimental synchronous text files", () => {
  test("ordinary imports expose both effectful operations and keep externs private", () => {
    const project = compileMain(imports + `
export let read(path: String): String = File.readText!(path)
export let readRaw(path: String): String = NodeFile.readText!(path)
export let write(path: String, text: String): Unit = File.writeText!(path, text)
export let writeRaw(path: String, text: String): Unit = NodeFile.writeText!(path, text)
`);
    expect(project.diagnostics).toEqual([]);
    for (const name of ["Hex.Experimental.File", "Hex.Experimental.Node.File"]) {
      const module = project.modules.find((module) => module.name === name)!;
      expect(module).toBeDefined();
      expect(module.declarations.text).toContain("readText");
      expect(module.declarations.text).toContain("writeText");
      expect(module.declarations.text).not.toMatch(/readFileSync|writeFileSync/u);
    }
    expect(project.modules.find(({ name }) => name === "Hex.Experimental.Node.File")!
      .javascript.text).toContain('from "node:fs"');
  });

  test.each(["File", "NodeFile"])("%s requires effect marks for reads and writes", (module) => {
    for (const call of [`${module}.readText(path)`, `${module}.writeText(path, "text")`]) {
      const diagnostics = projectDiagnostics(imports + `export let work(path: String) = ${call}\n`);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.join("\n")).toContain("!");
    }
  });

  test("unused file modules introduce no runtime filesystem dependency", () => {
    const project = compileMain("module Main\nexport let answer: Int = 42\n");
    expect(project.diagnostics).toEqual([]);
    expect(project.modules.some(({ name }) => name.startsWith("Hex.Experimental."))).toBe(false);
    expect(project.modules.some(({ javascript }) => javascript.text.includes("node:fs"))).toBe(false);
  });

  const originals = import.meta.glob("../../../stdlib/Experimental/**/*.hex", {
    eager: true, query: "?raw", import: "default",
  }) as Record<string, string>;

  test("both embedded modules match their canonical sources", () => {
    expect(Object.keys(originals)).toHaveLength(2);
    for (const source of Object.values(originals)) {
      const name = /^module\s+(\S+)/u.exec(source)![1]!;
      expect(STDLIB_SOURCES[name]).toBe(source);
    }
  });
});
