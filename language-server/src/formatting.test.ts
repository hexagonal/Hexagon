import { describe, expect, test } from "vitest";
import { DEFAULT_FORMAT_SETTINGS, formatOptionsOf, formatSettingsOf } from "./formatting.js";

describe("the formatting settings", () => {
  test("take a whole number of at least one as the line length, and anything else as Unlimited", () => {
    expect(formatSettingsOf({ maximumLineLength: 100 }).maximumLineLength).toBe(100);
    for (const value of [null, undefined, 0, -5, 80.5, "80", "unlimited", true]) {
      expect(formatSettingsOf({ maximumLineLength: value }).maximumLineLength).toBeUndefined();
    }
  });

  test("keep both options off for a client that sends nothing, or nothing it understands", () => {
    for (const value of [undefined, null, 3, "x", {}, { collapseExtraSpaces: "yes" }]) {
      expect(formatSettingsOf(value)).toEqual(DEFAULT_FORMAT_SETTINGS);
    }
    expect(formatSettingsOf({ collapseExtraSpaces: true }).collapseExtraSpaces).toBe(true);
  });

  test("hand the compiler Unlimited where no line length is set", () => {
    expect(formatOptionsOf(DEFAULT_FORMAT_SETTINGS)).toEqual({ maximumLineLength: "unlimited", collapseExtraSpaces: false });
    expect(formatOptionsOf({ maximumLineLength: 72, collapseExtraSpaces: true }))
      .toEqual({ maximumLineLength: 72, collapseExtraSpaces: true });
  });
});
