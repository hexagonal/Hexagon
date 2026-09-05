import { describe, expect, test } from "vitest";

import { bufferPath, layOutWorkspace } from "./workspace";

/** A buffer with two modules in it — the language's own notation (Modules §2.2). */
const twoModules = "module Helper\n" +
  "\n" +
  "export fun twice(n: Int): Int = n * 2\n" +
  "\n" +
  "end module Helper\n" +
  "\n" +
  "module Main\n" +
  "\n" +
  "import Helper\n" +
  "\n" +
  "Debug.log(\"${Helper.twice(3)}\")\n";

describe("layOutWorkspace", () => {
  test("hands the compiler the buffer, verbatim and whole", () => {
    const { files } = layOutWorkspace(twoModules);

    const buffer = files.find(({ path }) => path === bufferPath);
    // Not "starts with" or "contains": since #829 there is no prefix, no minted
    // header and no masking, so the file the compiler reads is the string the
    // user typed and every offset in it is already an editor offset.
    expect(buffer?.source).toBe(twoModules);
  });

  test("makes no file of a module block", () => {
    const { files } = layOutWorkspace(twoModules);

    // The buffer's two modules are two modules of one file, which is what the
    // language says a file holding two headers holds. The splitter that used to
    // mint `/Helper.hex` is gone with the notation it was written for.
    expect(files.map(({ path }) => path)).toEqual([
      "/stdlib/Option.hex",
      "/stdlib/Vector.hex",
      "/stdlib/Rat.hex",
      bufferPath,
    ]);
  });

  test("hosts every library source, imported or not", () => {
    // Hosting is availability, and since #831 it is only that: `Rat` is a file
    // the compiler can resolve an ordinary `import Rat` against, and no line is
    // ever written into the user's buffer on its account.
    const { files } = layOutWorkspace("module Main\n\nDebug.log(\"hello\")\n");

    const rat = files.find(({ path }) => path === "/stdlib/Rat.hex");
    expect(rat?.source.startsWith("module Rat\n")).toBe(true);
    expect(files.find(({ path }) => path === bufferPath)?.source)
      .toBe("module Main\n\nDebug.log(\"hello\")\n");
  });
});

describe("WorkspaceMap", () => {
  test("round-trips every offset of the buffer", () => {
    const { map } = layOutWorkspace(twoModules);

    for (let offset = 0; offset <= twoModules.length; offset += 1) {
      const at = map.locate(offset);
      expect(at?.path).toBe(bufferPath);
      expect(map.toBuffer(at!.path, at!.offset)).toBe(offset);
    }
  });

  test("refuses a file the buffer does not contain", () => {
    const { map } = layOutWorkspace("module Main\n\nlet one = 1\n");

    expect(map.toBuffer("/stdlib/Vector.hex", 0)).toBeUndefined();
    expect(map.toBufferRange("/stdlib/Vector.hex", { start: 0, end: 4 }))
      .toBeUndefined();
    expect(map.locate(0)?.path).toBe(bufferPath);
  });

  test("refuses a span with only one end in the buffer, whichever end that is", () => {
    const source = "module Main\n\nlet one = 1\n";
    const { map } = layOutWorkspace(source);

    // Running off the end is the half a clamp would silently keep.
    expect(map.toBufferRange(bufferPath, { start: source.length - 3, end: source.length + 1 }))
      .toBeUndefined();
    expect(map.toBufferRange(bufferPath, { start: source.length - 3, end: source.length }))
      .toEqual({ startOffset: source.length - 3, endOffset: source.length });
  });

  test("refuses an offset outside the buffer entirely", () => {
    const source = "module Main\n\nlet one = 1\n";
    const { map } = layOutWorkspace(source);

    expect(map.locate(-1)).toBeUndefined();
    expect(map.locate(source.length + 1)).toBeUndefined();
    expect(map.locate(source.length)).toBeDefined();
  });

  test("anchors a diagnostic that refuses to map, rather than losing it", () => {
    const source = "module Main\n\nlet one = 1\n";
    const { map } = layOutWorkspace(source);

    expect(map.anchor("/stdlib/Vector.hex", 400)).toBe(0);
    expect(map.anchor(bufferPath, 0)).toBe(0);
    expect(map.anchor(bufferPath, source.length + 99)).toBe(source.length);
  });
});
