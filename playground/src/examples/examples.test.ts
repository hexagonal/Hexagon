import { describe, expect, test } from "vitest";

import { compileSource } from "../compile";
import { exampleById, playgroundExamples } from "./index";

/** Rewrites compiler-owned relative imports to data-URL modules, as the worker does. */
function resolveModulePath(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const directory = importer.slice(0, Math.max(0, importer.lastIndexOf("/")));
  const parts: string[] = [];
  for (const part of `${directory}/${specifier}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const path = `/${parts.join("/")}`;
  return path.endsWith(".js") ? `${path.slice(0, -3)}.hex` : path;
}

describe("curated playground examples", () => {
  test("have stable unique ids and compile through the complete worker pipeline", () => {
    expect(new Set(playgroundExamples.map(({ id }) => id)).size).toBe(
      playgroundExamples.length,
    );

    for (const [version, example] of playgroundExamples.entries()) {
      expect(exampleById(example.id)).toBe(example);
      expect(compileSource(version, example.source).kind).toBe("compile-success");
    }
  });

  /**
   * Compiling is not the assertion that matters. During the `Seq`
   * de-intrinsification the compiler suite went green on a change that left the
   * shipped `vectors` example emitting unloadable JavaScript — a clean compile
   * whose modules do not link, which is the failure mode the conformance
   * defect log keeps recording (entries 8 and 10). The examples are the
   * product's front page, so they are executed here, not just typechecked.
   */
  test("run to completion through the worker's module linking", async () => {
    const log = console.log;
    try {
      for (const [version, example] of playgroundExamples.entries()) {
        const compiled = compileSource(version, example.source);
        expect(compiled.kind).toBe("compile-success");
        if (compiled.kind !== "compile-success") continue;

        const moduleUrls = new Map<string, string>();
        for (const module of compiled.executionModules) {
          const linked = module.javascript.replace(
            /^(\s*import(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
            (statement, prefix: string, _quote: string, specifier: string) => {
              const target = resolveModulePath(module.path, specifier);
              const url = target === undefined ? undefined : moduleUrls.get(target);
              return url === undefined ? statement : `${prefix}${JSON.stringify(url)};`;
            },
          );
          moduleUrls.set(
            module.path,
            `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
          );
        }

        const printed: string[] = [];
        console.log = (...values: readonly unknown[]) => {
          printed.push(values.map((value) => String(value)).join(" "));
        };
        await import(/* @vite-ignore */ moduleUrls.get(compiled.entryPath)!);
        console.log = log;
        // Every curated example prints something; silence means it died early.
        expect({ id: example.id, printed: printed.length > 0 })
          .toEqual({ id: example.id, printed: true });
      }
    } finally {
      console.log = log;
    }
  });
});
