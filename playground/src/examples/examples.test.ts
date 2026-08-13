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

/**
 * Both tests below compile every curated example through the whole pipeline,
 * prelude included, so their cost tracks the prelude's size — and the prelude
 * gained a twenty-third member at the Set step (#373). Under a parallel suite
 * run that took the first one past vitest's 5s default, while it passes
 * comfortably in isolation, which is the signature of a budget rather than a
 * regression. Stated once here and applied to both, since the second does
 * strictly more work than the first.
 */
const PIPELINE_TIMEOUT = 30_000;

describe("curated playground examples", () => {
  test("have stable unique ids and compile through the complete worker pipeline", () => {
    expect(new Set(playgroundExamples.map(({ id }) => id)).size).toBe(
      playgroundExamples.length,
    );

    for (const [version, example] of playgroundExamples.entries()) {
      expect(exampleById(example.id)).toBe(example);
      expect(compileSource(version, example.source).kind).toBe("compile-success");
    }
  }, PIPELINE_TIMEOUT);

  /**
   * Compiling is not the assertion that matters. During the `Seq`
   * de-intrinsification the compiler suite went green on a change that left the
   * shipped `vectors` example emitting unloadable JavaScript — a clean compile
   * whose modules do not link, which is the failure mode the conformance
   * defect log keeps recording (entries 8 and 10). The examples are the
   * product's front page, so they are executed here, not just typechecked.
   *
   * Every module is prefixed with the example's id before it becomes a `data:`
   * URL, because the registry caches those by their full text and the emitted
   * prelude is identical for every example. Sharing one instance of `Debug.js`
   * across the loop would share the sink it captured at initialization, and
   * every example after the first would print into the previous example's
   * collector. The worker gets this for free — a fresh `Blob` URL per run is a
   * fresh module graph — and the prefix is how the harness earns it.
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
            `data:text/javascript;charset=utf-8,${
              encodeURIComponent(`// ${example.id}\n${linked}`)
            }`,
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
  }, PIPELINE_TIMEOUT);
});
