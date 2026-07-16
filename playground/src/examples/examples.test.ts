import { describe, expect, test } from "vitest";

import { compileSource } from "../compile";
import { exampleById, playgroundExamples } from "./index";

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
});
