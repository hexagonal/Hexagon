import { describe, expect, test } from "vitest";

import { parseThemePreference, resolveTheme } from "./theme";

describe("theme preference", () => {
  test("defaults missing and unknown stored values to system", () => {
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("sepia")).toBe("system");
  });

  test("preserves each supported preference", () => {
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("light")).toBe("light");
  });

  test("follows the operating system only in system mode", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});
