import { describe, expect, test } from "vitest";

import { entryPath, layOutWorkspace } from "./workspace";

/** What the auto-imported equipment adds in front of every buffer, unseen. */
function prefixLength(): number {
  const { files } = layOutWorkspace("");
  const main = files.find(({ path }) => path === entryPath);
  return main?.source.length ?? 0;
}

describe("layOutWorkspace", () => {
  test("puts the whole buffer in `/main.hex` behind a synthesized prefix", () => {
    const source = "let one = 1\n";
    const { files } = layOutWorkspace(source);

    const main = files.find(({ path }) => path === entryPath);
    expect(main?.source.endsWith(source)).toBe(true);
    expect(main?.source.length).toBe(source.length + prefixLength());
  });

  test("makes a real file of each module block and blanks it out of `/main.hex`", () => {
    const source = "module Helper\n" +
      "    export fun twice(n: Int): Int = n * 2\n" +
      "end module Helper\n" +
      "log(\"${Helper.twice(3)}\")\n";
    const { files } = layOutWorkspace(source);

    const helper = files.find(({ path }) => path === "/Helper.hex");
    expect(helper?.source).toBe("    export fun twice(n: Int): Int = n * 2\n");
    // Masked rather than removed, so every offset after it is still the
    // buffer's own — which is the property the map relies on.
    const main = files.find(({ path }) => path === entryPath);
    expect(main?.source).toContain("log(\"${Helper.twice(3)}\")");
    expect(main?.source).not.toContain("export fun twice");
  });

  test("reports the notation's own errors instead of guessing at a split", () => {
    const { diagnostics } = layOutWorkspace("module Helper\nlet one = 1\n");

    expect(diagnostics).toMatchObject([{ severity: "error" }]);
  });
});

describe("WorkspaceMap", () => {
  test("round-trips every offset of a document with no module blocks", () => {
    const source = "let one = 1\nlog(\"${one}\")\n";
    const { map } = layOutWorkspace(source);

    for (let offset = 0; offset <= source.length; offset += 1) {
      const at = map.locate(offset);
      expect(at?.path).toBe(entryPath);
      expect(map.toBuffer(at!.path, at!.offset)).toBe(offset);
    }
  });

  test("round-trips a module body through its own virtual file", () => {
    const source = "module Helper\n" +
      "    export fun twice(n: Int): Int = n * 2\n" +
      "end module Helper\n" +
      "log(\"${Helper.twice(3)}\")\n";
    const { map } = layOutWorkspace(source);
    const inside = source.indexOf("twice");

    const at = map.locate(inside);

    expect(at).toEqual({ path: "/Helper.hex", offset: inside - "module Helper\n".length });
    expect(map.toBuffer("/Helper.hex", at!.offset)).toBe(inside);
  });

  test("puts text above a module block in `/main.hex`, not in the block", () => {
    const source = "let one = 1\n" +
      "module Helper\n" +
      "    export fun twice(n: Int): Int = n * 2\n" +
      "end module Helper\n";
    const { map } = layOutWorkspace(source);
    const above = source.indexOf("one");

    // An offset before a block is *below* that block's start, which is a
    // different thing from being inside it. Every other case here has the
    // block at the top of the buffer, where the distinction cannot show.
    const at = map.locate(above);

    expect(at?.path).toBe(entryPath);
    expect(map.toBuffer(entryPath, at!.offset)).toBe(above);
  });

  test("puts text after a module block back where the user typed it", () => {
    const source = "module Helper\n" +
      "    export fun twice(n: Int): Int = n * 2\n" +
      "end module Helper\n" +
      "log(\"${Helper.twice(3)}\")\n";
    const { map } = layOutWorkspace(source);
    const after = source.indexOf("log(");

    const at = map.locate(after);

    expect(at?.path).toBe(entryPath);
    expect(map.toBuffer(entryPath, at!.offset)).toBe(after);
  });

  test("refuses an offset inside the synthesized import prefix", () => {
    const { map } = layOutWorkspace("let one = 1\n");

    // The prefix is real text in `/main.hex` and no part of the buffer. An
    // edit landing there has no honest home, and answering with offset zero
    // would put it in front of the user's first line.
    for (let offset = 0; offset < prefixLength(); offset += 1) {
      expect(map.toBuffer(entryPath, offset)).toBeUndefined();
    }
    expect(map.toBuffer(entryPath, prefixLength())).toBe(0);
  });

  test("refuses a file the buffer does not contain", () => {
    const { map } = layOutWorkspace("let one = 1\n");

    expect(map.toBuffer("/stdlib/Vector.hex", 0)).toBeUndefined();
    expect(map.toBufferRange("/stdlib/Vector.hex", { start: 0, end: 4 }))
      .toBeUndefined();
  });

  test("refuses a span with only one end in the buffer, whichever end that is", () => {
    const source = "let one = 1\n";
    const { map } = layOutWorkspace(source);
    const last = prefixLength() + source.length;

    // Starting in the synthesized prefix…
    expect(
      map.toBufferRange(entryPath, { start: prefixLength() - 1, end: prefixLength() + 3 }),
    ).toBeUndefined();
    // …and running off the end, which is the half a clamp would silently keep.
    expect(map.toBufferRange(entryPath, { start: last - 3, end: last + 1 }))
      .toBeUndefined();
    expect(map.toBufferRange(entryPath, { start: last - 3, end: last }))
      .toEqual({ startOffset: source.length - 3, endOffset: source.length });
  });

  test("refuses an offset outside the buffer entirely", () => {
    const source = "let one = 1\n";
    const { map } = layOutWorkspace(source);

    expect(map.locate(-1)).toBeUndefined();
    expect(map.locate(source.length + 1)).toBeUndefined();
    expect(map.locate(source.length)).toBeDefined();
  });

  test("anchors a diagnostic that refuses to map, rather than losing it", () => {
    const source = "let one = 1\n";
    const { map } = layOutWorkspace(source);

    expect(map.anchor("/stdlib/Vector.hex", 400)).toBe(0);
    expect(map.anchor(entryPath, 0)).toBe(0);
    expect(map.anchor(entryPath, prefixLength() + source.length + 99)).toBe(
      source.length,
    );
  });
});
