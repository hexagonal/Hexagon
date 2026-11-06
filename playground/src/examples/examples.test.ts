import { describe, expect, test } from "vitest";

import { compileSource } from "../compile";
import { exampleById, playgroundExamples } from "./index";
import { regexes } from "./regexes";
import { runModules } from "./run-modules";

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
   * The Regex tutorial's other path: its written pattern, broken, is refused
   * when the program compiles (`spec/regex.md` §8), underlined at the codepoint
   * that goes wrong, with what to write instead. Nothing runs.
   */
  test("refuse the Regex tutorial's broken pattern when it compiles, at the bad codepoint", () => {
    const broken = regexes.source.replace('{2})$")', '{2}$")');
    expect(broken).not.toBe(regexes.source);

    const compiled = compileSource(0, broken);

    expect(compiled.kind).toBe("compile-failure");
    if (compiled.kind !== "compile-failure") return;
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "missing `)` for the group opened here; close it, or write `\\\\(` for a literal",
    ]);
    const [{ startOffset, endOffset }] = compiled.diagnostics as [typeof compiled.diagnostics[number]];
    expect(broken.slice(startOffset, endOffset)).toBe("(");
    expect(broken.slice(startOffset, startOffset + 7)).toBe("(?<day>");
  }, PIPELINE_TIMEOUT);
});

/**
 * Compiles `source` and runs it as the worker would (`runModules`).
 */
async function execute(
  id: string,
  version: number,
  source: string,
): Promise<{ readonly printed: readonly string[]; readonly threw: boolean; readonly failure: unknown }> {
  const compiled = compileSource(version, source);
  expect(compiled.kind).toBe("compile-success");
  if (compiled.kind !== "compile-success") return { printed: [], threw: false, failure: undefined };
  return runModules(id, compiled.executionModules, compiled.entryPath);
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
    "a.c is a pattern; on abc it says True",
    "(a is not a pattern",
    "(a)(b) has 2 groups",
    "[z-a]: range `z-a` is reversed; write `a-z`, at position 4",
  ]],
]);
