import { describe, expect, test } from "vitest";

import {
  inputStorageKey,
  readStoredInput,
  readStoredSource,
  sourceStorageKey,
  writeStoredInput,
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

  test("keeps the input box's text under its own key", () => {
    const values = new Map<string, string>();
    const storage: SourceStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    };

    expect(readStoredInput(storage)).toBeUndefined();
    writeStoredSource(storage, "let answer = 42");
    writeStoredInput(storage, "1\n2\n");

    expect(values.get(inputStorageKey)).toBe("1\n2\n");
    expect(readStoredInput(storage)).toBe("1\n2\n");
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
    expect(readStoredInput(storage)).toBeUndefined();
    expect(() => writeStoredInput(storage, "input")).not.toThrow();
  });
});
