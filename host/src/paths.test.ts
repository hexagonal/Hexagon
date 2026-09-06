/**
 * `settledPathSync`, on the platform whose spelling this file exists for.
 *
 * Every other test here runs against real directories, and this one cannot: the
 * hazard is that `realpathSync` answers in the **platform's** spelling, which on
 * Windows means back-slashes, while the climb below it rebuilds its answer with
 * forward ones. A machine that answers in one spelling can never show the two
 * disagreeing, so the one platform call is stubbed and nothing else is. What is
 * pinned is a property of this function alone: one spelling out, whatever came
 * in and whether or not the file is there.
 */

import { describe, expect, test, vi } from "vitest";

/** The directories the stubbed filesystem has, in the session's spelling. */
const EXISTING = new Set(["C:/proj", "C:/proj/src", "C:/proj/src/main.hex"]);

vi.mock("node:fs", () => ({
  realpathSync: (path: string): string => {
    const asked = path.replaceAll("\\", "/");
    if (!EXISTING.has(asked)) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    }
    // Windows' own answer: a resolved path, spelled with back-slashes.
    return asked.replaceAll("/", "\\");
  },
}));

const { settledPathSync } = await import("./paths.js");

describe("settledPathSync answers in one spelling", () => {
  test("a path that resolves", () => {
    expect(settledPathSync("C:\\proj\\src\\main.hex")).toBe("C:/proj/src/main.hex");
  });

  test("a path whose nearest existing ancestor resolves", () => {
    // The file has been deleted and its directory with it, which is the
    // ordinary shape of a branch switch. The climb finds `C:/proj` and
    // re-appends the missing tail.
    expect(settledPathSync("C:\\proj\\gone\\away\\main.hex")).toBe("C:/proj/gone/away/main.hex");
  });

  test("a path with no existing ancestor at all", () => {
    expect(settledPathSync("D:\\elsewhere\\main.hex")).toBe("D:/elsewhere/main.hex");
  });

  test("the two branches agree about one path", () => {
    // The same file, asked for while it is there and after it is gone: a
    // session that keyed it under two spellings would hold it twice, and the
    // second entry would report every declaration in it as a duplicate of
    // itself.
    const there = settledPathSync("C:\\proj\\src\\main.hex");
    EXISTING.delete("C:/proj/src/main.hex");
    try {
      expect(settledPathSync("C:\\proj\\src\\main.hex")).toBe(there);
    } finally {
      EXISTING.add("C:/proj/src/main.hex");
    }
  });
});
