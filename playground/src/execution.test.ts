import { describe, expect, test } from "vitest";

import { formatConsoleArguments } from "./execution";

describe("execution output", () => {
  test("formats primitive and generated tuple values", () => {
    expect(formatConsoleArguments(["answer", 42, true, 7n, ["Hearts", 10]])).toBe(
      "answer 42 true 7n [Hearts, 10]",
    );
  });

  test("bounds recursive host values", () => {
    const value: { self?: unknown } = {};
    value.self = value;

    expect(formatConsoleArguments([value])).toBe("{self: [Circular]}");
  });
});
