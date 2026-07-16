import { describe, expect, test } from "vitest";

import { formatLocatedDiagnostic, locateDiagnostic } from "./diagnostics";

describe("playground diagnostics", () => {
  test("converts compiler offsets to one-based line and column coordinates", () => {
    const diagnostic = locateDiagnostic("first\r\nsecond\nthird", {
      severity: "error",
      message: "broken",
      startOffset: 14,
      endOffset: 19,
    });

    expect(diagnostic).toMatchObject({ line: 3, column: 1 });
    expect(formatLocatedDiagnostic(diagnostic)).toBe(
      "error at 3:1 — broken",
    );
  });

  test("locates the first character at 1:1", () => {
    expect(locateDiagnostic("source", {
      severity: "warning",
      message: "start",
      startOffset: 0,
      endOffset: 1,
    })).toMatchObject({ line: 1, column: 1 });
  });
});
