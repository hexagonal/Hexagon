import { describe, expect, test } from "vitest";

import { entryPath, layOutWorkspace } from "./workspace";

/**
 * What the synthesized prefix adds in front of *this* buffer, unseen.
 *
 * Per buffer rather than once for all of them: the equipment prefix is gated on
 * what the source names, so the buffers below that never say `Rat` have no
 * prefix at all, and a fixed length taken from one of them would let the tests
 * that turn on the prefix pass without one.
 */
function prefixLength(source: string): number {
  const { files } = layOutWorkspace(source);
  const main = files.find(({ path }) => path === entryPath);
  return (main?.source.length ?? 0) - source.length;
}

/** A buffer whose mention of `Rat` earns the equipment prefix. */
const equipped = "let half = Rat.create(1, 2)\n";

describe("layOutWorkspace", () => {
  test("puts the whole buffer in `/main.hex` behind a synthesized prefix", () => {
    const { files } = layOutWorkspace(equipped);

    const main = files.find(({ path }) => path === entryPath);
    expect(main?.source.endsWith(equipped)).toBe(true);
    expect(prefixLength(equipped)).toBeGreaterThan(0);
  });

  test("prepends an equipment import only for a companion the buffer names", () => {
    const equippedMain = layOutWorkspace(equipped).files.find(
      ({ path }) => path === entryPath,
    );
    const bareMain = layOutWorkspace("log(\"hello\")\n").files.find(
      ({ path }) => path === entryPath,
    );

    expect(equippedMain?.source).toContain(
      'import * as Rat from "./stdlib/Rat"',
    );
    expect(bareMain?.source).toBe("log(\"hello\")\n");
  });

  test("injects the companion idiom's one line and nothing beside it", () => {
    const main = layOutWorkspace(equipped).files.find(
      ({ path }) => path === entryPath,
    );

    // Since Modules §5.1 rule 2's companion fallback (#531) the alias answers
    // the bare `Rat` face too, so the named half this used to carry beside it
    // is gone. One import line for one module, which is what §5.3's idiom says
    // a consumer writes.
    expect(main?.source).not.toContain("import { Rat }");
    expect(main?.source.trimEnd().split("\n").filter((line) => line.startsWith("import")))
      .toEqual(['import * as Rat from "./stdlib/Rat"']);
  });

  test("a buffer declaring its own `Rat` keeps the line, and it collides with nothing", () => {
    const own = layOutWorkspace(
      "record Rat = {top: Int, bottom: Int}\nlet half = Rat({top = 1, bottom = 2})\n",
    ).files.find(({ path }) => path === entryPath);

    // The alias binds nothing in the type namespace, so the declaration wins
    // outright and there is nothing to drop. The gate that used to drop the
    // named half — and the whole declared-type scan behind it — went with it.
    expect(own?.source).toContain('import * as Rat from "./stdlib/Rat"');
    expect(own?.source).not.toContain("import { Rat }");
  });

  test("reads a mention at identifier boundaries, not as a substring", () => {
    // `Ratio` is not `Rat`, and neither is the `Rat` inside it. Over-approximate
    // the other way — a comment counts — because a spare import is harmless and
    // a missing one fails a compile against text the buffer does not show.
    const spelled = (source: string): boolean =>
      layOutWorkspace(source).files.find(({ path }) => path === entryPath)
        ?.source.includes("./stdlib/Rat") ?? false;

    expect(spelled("let Ratio = 1\nlet myRat2 = 2\n")).toBe(false);
    expect(spelled("// a Rat is exact\nlet one = 1\n")).toBe(true);
    expect(spelled("let one = 1 // Rat\n")).toBe(true);
  });

  test("hosts every library source whether or not it is auto-imported", () => {
    // Hosting is availability: `Rat` stays a file the compiler can resolve an
    // ordinary `import` against even when nothing prepends one.
    const { files } = layOutWorkspace("log(\"hello\")\n");

    expect(files.map(({ path }) => path)).toEqual([
      "/stdlib/Option.hex",
      "/stdlib/Vector.hex",
      "/stdlib/Rat.hex",
      entryPath,
    ]);
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
    const { map } = layOutWorkspace(equipped);

    // The prefix is real text in `/main.hex` and no part of the buffer. An
    // edit landing there has no honest home, and answering with offset zero
    // would put it in front of the user's first line.
    for (let offset = 0; offset < prefixLength(equipped); offset += 1) {
      expect(map.toBuffer(entryPath, offset)).toBeUndefined();
    }
    expect(map.toBuffer(entryPath, prefixLength(equipped))).toBe(0);
  });

  test("refuses a file the buffer does not contain", () => {
    const { map } = layOutWorkspace("let one = 1\n");

    expect(map.toBuffer("/stdlib/Vector.hex", 0)).toBeUndefined();
    expect(map.toBufferRange("/stdlib/Vector.hex", { start: 0, end: 4 }))
      .toBeUndefined();
  });

  test("refuses a span with only one end in the buffer, whichever end that is", () => {
    const source = equipped;
    const prefix = prefixLength(source);
    const { map } = layOutWorkspace(source);
    const last = prefix + source.length;

    // Starting in the synthesized prefix…
    expect(
      map.toBufferRange(entryPath, { start: prefix - 1, end: prefix + 3 }),
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
    const source = equipped;
    const { map } = layOutWorkspace(source);

    expect(map.anchor("/stdlib/Vector.hex", 400)).toBe(0);
    expect(map.anchor(entryPath, 0)).toBe(0);
    expect(map.anchor(entryPath, prefixLength(source) + source.length + 99)).toBe(
      source.length,
    );
  });
});
