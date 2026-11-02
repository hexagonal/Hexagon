import { describe, expect, test } from "vitest";

import { compileSource } from "../compile";
import { describeFailure } from "../execution";
import { exampleById, playgroundExamples } from "./index";
import { regexes } from "./regexes";

/**
 * The tests below compile through the whole pipeline, prelude included, so
 * their cost tracks the prelude's size — and the prelude gained a
 * twenty-third member at the Set step (#373). Under a parallel suite run that
 * took the first one past vitest's 5s default, while it passes comfortably in
 * isolation, which is the signature of a budget rather than a regression.
 * Stated once here and applied to each.
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
   * product's front page, so they are executed here, not just typechecked, by
   * `execute` below.
   */
  test("run to completion through the worker's module linking", async () => {
    for (const [version, example] of playgroundExamples.entries()) {
      const { printed, threw, failure } = await execute(example.id, version, example.source);
      if (threw) throw failure;
      // Every curated example prints something; silence means it died early.
      expect({ id: example.id, printed: printed.length > 0 })
        .toEqual({ id: example.id, printed: true });
      const expected = EXPECTED_OUTPUT.get(example.id);
      if (expected !== undefined) expect({ id: example.id, printed }).toEqual({ id: example.id, printed: expected });
    }
  }, PIPELINE_TIMEOUT);

  /**
   * The Regex tutorial's other path: its written pattern, broken, stops the
   * program as it loads, before anything prints, with a fault that says what
   * is wrong and where. The pane shows the line `describeFailure` gives.
   */
  test("stop the Regex tutorial at load with its pattern's fault and position", async () => {
    const broken = regexes.source.replace('{2})$")', '{2}$")');
    expect(broken).not.toBe(regexes.source);

    const { printed, threw, failure } = await execute("regexes-broken", 0, broken);

    expect(printed).toEqual([]);
    expect(threw).toBe(true);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).name).toBe("BadPatternFault");
    expect(describeFailure(failure))
      .toBe("BadPatternFault: missing `)` for the group opened here (position: 39)");
  }, PIPELINE_TIMEOUT);
});

/**
 * Compiles `source` and runs it as the worker would, answering what it printed
 * and whether it threw, and what. A program may throw `undefined`, so `threw`
 * says whether it did.
 *
 * The modules are written to a fresh directory at their own addresses and the
 * entry is imported from there, so the compiler's relative specifiers resolve
 * as written. A fresh directory is a fresh module graph: the emitted prelude is
 * identical for every example, and sharing one instance of `Debug.js` across
 * runs would share the sink it captured at initialization, so every run after
 * the first would print into the previous run's collector. The worker gets the
 * same from a fresh `Blob` URL per module per run, which Node cannot import. A
 * `data:` URL per module, the stand-in this harness used before, copies every
 * dependency's text into each importer's URL, so its length grows with the
 * number of paths through the graph, and it passed what a string can hold once
 * `Vector.js` imported the `Ord` dictionaries its sorts take.
 *
 * `vite.config.ts` hands the `hex-example-` directories to Node's own loader,
 * which refuses a graph whose modules disagree on a name when it links, as the
 * browser does; Vite's module runner would load it. Node is reached through
 * non-literal specifiers because the playground carries no Node type
 * definitions.
 */
async function execute(
  id: string,
  version: number,
  source: string,
): Promise<{ readonly printed: readonly string[]; readonly threw: boolean; readonly failure: unknown }> {
  const compiled = compileSource(version, source);
  expect(compiled.kind).toBe("compile-success");
  if (compiled.kind !== "compile-success") return { printed: [], threw: false, failure: undefined };

  const fsName = "node:fs";
  const osName = "node:os";
  const pathName = "node:path";
  const urlName = "node:url";
  const fs = await import(/* @vite-ignore */ fsName) as {
    mkdtempSync: (prefix: string) => string;
    mkdirSync: (path: string, options: { recursive: boolean }) => void;
    writeFileSync: (path: string, data: string) => void;
    rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
  };
  const os = await import(/* @vite-ignore */ osName) as { tmpdir: () => string };
  const paths = await import(/* @vite-ignore */ pathName) as {
    join: (...parts: string[]) => string;
    dirname: (of: string) => string;
  };
  const url = await import(/* @vite-ignore */ urlName) as {
    pathToFileURL: (of: string) => { readonly href: string };
  };

  const root = fs.mkdtempSync(paths.join(os.tmpdir(), `hex-example-${id}-`));
  const log = console.log;
  const printed: string[] = [];
  try {
    fs.writeFileSync(paths.join(root, "package.json"), '{ "type": "module" }\n');
    const fileOf = (path: string): string =>
      paths.join(root, path.replace(/^\//u, "").replace(/\.hex$/u, ".js"));
    for (const module of compiled.executionModules) {
      const target = fileOf(module.path);
      fs.mkdirSync(paths.dirname(target), { recursive: true });
      fs.writeFileSync(target, module.javascript);
    }
    console.log = (...values: readonly unknown[]) => {
      printed.push(values.map((value) => String(value)).join(" "));
    };
    try {
      await import(/* @vite-ignore */ url.pathToFileURL(fileOf(compiled.entryPath)).href);
    } catch (failure: unknown) {
      return { printed, threw: true, failure };
    }
    return { printed, threw: false, failure: undefined };
  } finally {
    console.log = log;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * The whole output of the examples whose lines a test pins, so that a change
 * to one of these tutorials shows as a change to what it prints.
 */
const EXPECTED_OUTPUT: ReadonlyMap<string, readonly string[]> = new Map([
  ["regexes", [
    "2026-10-31: year 2026, month 10, day 31",
    "31/10/2026: not an ISO date",
    "2026-1-5: not an ISO date",
    "x2026-10-31: not an ISO date",
    "2026-13-45: year 2026, month 13, day 45",
    "is 1999-12-31 a date? True",
  ]],
]);
