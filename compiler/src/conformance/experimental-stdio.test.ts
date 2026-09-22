import { describe, expect, test } from "vitest";
import { compileMain, projectDiagnostics } from "../support/test-project.js";
import { STDLIB_SOURCES } from "../stdlib-sources.js";

const imports = `module Main
import Hex.Experimental.Stdio as Stdio
import Hex.Experimental.Node.Stdio as NodeStdio
`;
const operations = ["write", "writeLine", "writeError", "writeErrorLine"] as const;

describe("experimental synchronous standard output", () => {
  test("both imports export four effectful string writers and keep the extern private", () => {
    const calls = ["Stdio", "NodeStdio"].flatMap((alias) =>
      operations.map((operation) =>
        `export let ${alias.toLowerCase()}_${operation}(text: String): Unit = ${alias}.${operation}!(text)\n`)).join("");
    const project = compileMain(imports + calls);
    expect(project.diagnostics).toEqual([]);
    for (const name of ["Hex.Experimental.Stdio", "Hex.Experimental.Node.Stdio"]) {
      const module = project.modules.find((module) => module.name === name)!;
      expect(module).toBeDefined();
      for (const operation of operations) {
        expect(module.declarations.text).toContain(`const ${operation}: (text: string) => void`);
      }
      expect(module.declarations.text).not.toContain("writeFileSync");
    }
    expect(project.modules.find(({ name }) => name === "Hex.Experimental.Node.Stdio")!
      .javascript.text).toContain('from "node:fs"');
  });

  test.each(["Stdio", "NodeStdio"])("%s calls require effect marks", (alias) => {
    for (const operation of operations) {
      const diagnostics = projectDiagnostics(imports +
        `export let work(text: String) = ${alias}.${operation}(text)\n`);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.join("\n")).toContain("!");
    }
  });

  test("unused modules add no filesystem dependency", () => {
    const project = compileMain("module Main\nexport let answer: Int = 42\n");
    expect(project.diagnostics).toEqual([]);
    expect(project.modules.some(({ name }) => name.includes("Stdio"))).toBe(false);
    expect(project.modules.some(({ javascript }) => javascript.text.includes("node:fs"))).toBe(false);
  });

  const originals = import.meta.glob("../../../stdlib/Experimental/**/Stdio.hex", {
    eager: true, query: "?raw", import: "default",
  }) as Record<string, string>;

  test("embedded sources match both canonical modules", () => {
    expect(Object.keys(originals)).toHaveLength(2);
    for (const source of Object.values(originals)) {
      const name = /^module\s+(\S+)/u.exec(source)![1]!;
      expect(STDLIB_SOURCES[name]).toBe(source);
    }
  });
});
