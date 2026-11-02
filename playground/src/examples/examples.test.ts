import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, test } from "vitest";

import { compileSource } from "../compile";
import { exampleById, playgroundExamples } from "./index";

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
   * Each example's modules are written to a fresh directory at their own
   * addresses and the entry is imported from there, so the compiler's relative
   * specifiers resolve as written. A fresh directory is a fresh module graph:
   * the emitted prelude is identical for every example, and sharing one
   * instance of `Debug.js` across the loop would share the sink it captured at
   * initialization, so every example after the first would print into the
   * previous example's collector. The worker gets the same from a fresh `Blob`
   * URL per module per run, which Node cannot import. A `data:` URL per module,
   * the stand-in this harness used before, copies every dependency's text into
   * each importer's URL, so its length grows with the number of paths through
   * the graph, and it passed what a string can hold once `Vector.js` imported
   * the `Ord` dictionaries its sorts take.
   */
  test("run to completion through the worker's module linking", async () => {
    const log = console.log;
    try {
      for (const [version, example] of playgroundExamples.entries()) {
        const compiled = compileSource(version, example.source);
        expect(compiled.kind).toBe("compile-success");
        if (compiled.kind !== "compile-success") continue;

        const root = mkdtempSync(join(tmpdir(), `hex-example-${example.id}-`));
        writeFileSync(join(root, "package.json"), '{ "type": "module" }\n');
        const fileOf = (path: string): string =>
          join(root, path.replace(/^\//u, "").replace(/\.hex$/u, ".js"));
        for (const module of compiled.executionModules) {
          const target = fileOf(module.path);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, module.javascript);
        }

        const printed: string[] = [];
        console.log = (...values: readonly unknown[]) => {
          printed.push(values.map((value) => String(value)).join(" "));
        };
        await import(/* @vite-ignore */ pathToFileURL(fileOf(compiled.entryPath)).href);
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
