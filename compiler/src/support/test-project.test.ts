import { describe, expect, test } from "vitest";

import { runProject } from "./test-project.js";

/**
 * The harness links an executed program the way a host does, which is what the
 * tests that run a program to catch an unloadable one rely on: an importer and
 * an exporter that disagree on a name fail when the graph loads, not when the
 * name is first called. `vitest.config.ts` hands the harness's directory to
 * Node's loader for this; Vite's module runner would load the graph below and
 * answer `x`.
 */
describe("runProject links like a host", () => {
  const program = "module Main\n\nexport let x: Int = 1\n";

  test("a graph whose modules agree loads", async () => {
    expect((await runProject([["/main.hex", program]])).x).toBe(1);
  });

  test("an import its dependency does not export is refused at link time", async () => {
    const failure = await runProject([["/main.hex", program]], {
      // `Main` asks itself for a name it does not export: the one module this
      // program emits, at its address.
      transform: (path, javascript) =>
        path === "/main.hex"
          ? `import { __noSuchExport } from "./Main.js";\n${javascript}`
          : javascript,
    }).then(() => undefined, (error: unknown) => error);

    expect(failure).toBeInstanceOf(SyntaxError);
    expect(String(failure)).toContain("__noSuchExport");
  });
});
