import { describe, expect, test } from "vitest";

import {
  readStoredSource,
  sourceStorageKey,
  writeStoredSource,
  type SourceStorage,
} from "./persistence";

describe("source persistence", () => {
  test("round-trips source under the stable storage key", () => {
    const values = new Map<string, string>();
    const storage: SourceStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    };

    writeStoredSource(storage, "let answer = 42");

    expect(values.get(sourceStorageKey)).toBe("let answer = 42");
    expect(readStoredSource(storage)).toBe("let answer = 42");
  });

  test("treats unavailable storage as an optional host facility", () => {
    const storage: SourceStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(readStoredSource(storage)).toBeUndefined();
    expect(() => writeStoredSource(storage, "source")).not.toThrow();
  });
});
