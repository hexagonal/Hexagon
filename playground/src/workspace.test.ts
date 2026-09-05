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

/**
 * The header `layOutWorkspace` mints for the entry (Modules §2.1, #829).
 *
 * Every entry file carries it, so "unprefixed" now means "prefixed by this and
 * nothing else" — which is what the equipment assertions below measure against.
 */
const MAIN_HEADER = "module Main\n\n";

/** A buffer whose mention of `Rat` earns the equipment prefix. */
const equipped = "let half = Rat.create(1, 2)\n";

describe("layOutWorkspace", () => {
  test("puts the whole buffer in `/main.hex` behind a synthesized prefix", () => {
    const { files } = layOutWorkspace(equipped);

    const main = files.find(({ path }) => path === entryPath);
    expect(main?.source.endsWith(equipped)).toBe(true);
    expect(prefixLength(equipped)).toBeGreaterThan(MAIN_HEADER.length);
  });

  test("prepends an equipment import only for a companion the buffer names", () => {
    const equippedMain = layOutWorkspace(equipped).files.find(
      ({ path }) => path === entryPath,
    );
    const bareMain = layOutWorkspace("Debug.log(\"hello\")\n").files.find(
      ({ path }) => path === entryPath,
    );

    expect(equippedMain?.source).toContain(
      'import Rat',
    );
    expect(bareMain?.source).toBe(MAIN_HEADER + "Debug.log(\"hello\")\n");
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
      .toEqual(['import Rat']);
  });

  test("a buffer declaring its own `Rat` keeps the line, and it collides with nothing", () => {
    const own = layOutWorkspace(
      "record Rat = {top: Int, bottom: Int}\nlet half = Rat({top = 1, bottom = 2})\n",
    ).files.find(({ path }) => path === entryPath);

    // The alias binds nothing in the type namespace, so the declaration wins
    // outright and there is nothing to drop. The gate that used to drop the
    // named half — and the whole declared-type scan behind it — went with it.
    expect(own?.source).toContain('import Rat');
    expect(own?.source).not.toContain("import { Rat }");
  });

  test("keeps out of the way of a buffer that writes the import itself", () => {
    const own = 'import Rat\n' +
      "let half = Rat.create(1, 2)\n";
    const main = layOutWorkspace(own).files.find(({ path }) => path === entryPath);

    // Two aliases of one name is the alias namespace's collision rule
    // (Modules §5.2), and it is reported at the second line — the user's own,
    // beneath a first line no buffer shows. So the equipment stands down: the
    // entry is the buffer, unprefixed, and the import it compiles against is
    // the one the user can see.
    expect(main?.source).toBe(MAIN_HEADER + own);
    expect(prefixLength(own)).toBe(MAIN_HEADER.length);
  });

  test("suppresses on the alias the buffer binds, not the module it names", () => {
    const source = "module Helper\n" +
      "    export let twice(n: Int): Int = n * 2\n" +
      "end module Helper\n" +
      'import Helper as Rat\n' +
      "Debug.log(\"${Rat.twice(3)}\")\n";
    const main = layOutWorkspace(source).files.find(({ path }) => path === entryPath);

    // Nothing about the equipment's *file* is what collides — the bound name
    // is. A buffer aliasing anything at all as `Rat` has claimed it.
    //
    // The needle is the line the equipment would prepend, `import Rat`, since
    // #829 made that line path-free: a `"./stdlib/Rat"` specifier is a
    // spelling nothing emits any more, so testing for it could not fail.
    expect(main?.source).not.toContain("import Rat\n");
  });

  test("keeps the line for a buffer whose own import is the named half", () => {
    const named = 'import { Rat } from "./stdlib/Rat"\n' +
      "let half: Rat = Rat.create(1, 2)\n";
    const main = layOutWorkspace(named).files.find(({ path }) => path === entryPath);

    // The named half binds a type, the injected line binds an alias, and the
    // two namespaces do not meet: this shape compiles with both lines, and the
    // alias is what `Rat.create` reaches. Suppressing here would take the
    // qualified face away from a buffer that never asked.
    //
    // Read from the front, not with `toContain`: the buffer's own import line
    // spells enough of the injected one to satisfy a substring search that the
    // prefix had gone missing.
    expect(main?.source.startsWith(MAIN_HEADER + "import Rat\n"))
      .toBe(true);
    expect(main?.source.endsWith(named)).toBe(true);
  });

  test("reads an alias import the buffer does not spell as one line", () => {
    // A legal import head is not a line. Comments are trivia between its
    // tokens, and it may break across lines — each of these binds `Rat` as
    // firmly as the plain spelling, and each drew the collision back while the
    // scan read text instead of tokens.
    const suppressed = (source: string): boolean =>
      layOutWorkspace(source).files.find(({ path }) => path === entryPath)
        ?.source === MAIN_HEADER + source;

    expect(suppressed(
      "import (* the exact one *) Rat\n" +
        "let half = Rat.create(1, 2)\n",
    )).toBe(true);
    expect(suppressed(
      "import\n    Rat\n" +
        "let half = Rat.create(1, 2)\n",
    )).toBe(true);
  });

  test("reads an import head inside a string as the string it is", () => {
    const quoted = 'let advice = "write import Rat from ./stdlib/Rat"\n' +
      "let half = Rat.create(1, 2)\n";
    const main = layOutWorkspace(quoted).files.find(({ path }) => path === entryPath);

    // One token, no head — the buffer's `Rat.create` still gets its module.
    expect(main?.source.startsWith(MAIN_HEADER + "import Rat\n"))
      .toBe(true);
  });

  test("reads a commented-out import as the comment it is", () => {
    const commented = '// import Rat\n' +
      "let half = Rat.create(1, 2)\n";
    const main = layOutWorkspace(commented).files.find(({ path }) => path === entryPath);

    // A comment is trivia and holds no tokens, so a line the user has commented
    // out binds nothing and stands down for nothing — the shape a buffer
    // mid-edit is in.
    expect(main?.source.startsWith(MAIN_HEADER + "import Rat\n"))
      .toBe(true);
    expect(prefixLength(commented)).toBeGreaterThan(MAIN_HEADER.length);
  });

  test("finds no alias at all in a buffer that does not lex", () => {
    const midEdit = 'let advice = "unterminated\n' +
      'import Rat\n' +
      "let half = Rat.create(1, 2)\n";
    const main = layOutWorkspace(midEdit).files.find(({ path }) => path === entryPath);

    // The open string swallows the import head into a token of its own, so the
    // scan finds fewer heads rather than phantom ones and the line goes in
    // regardless — the direction a half-typed buffer should fail in. What the
    // user sees is the lex error they are in the middle of fixing; the alias
    // collision waits until there is an alias to collide with.
    expect(main?.source.startsWith(MAIN_HEADER + "import Rat\n"))
      .toBe(true);
  });

  test("leaves a module block's own alias to that block's file", () => {
    const source = "module Helper\n" +
      '    import Rat\n' +
      "    export let one(): Int = 1\n" +
      "end module Helper\n" +
      "let half = Rat.create(1, 2)\n";
    const main = layOutWorkspace(source).files.find(({ path }) => path === entryPath);

    // A block's file never carries the prefix, so an alias inside one collides
    // with nothing and must not disarm the entry's line — which is why the
    // scan reads `/main.hex`'s masked text rather than the whole buffer, the
    // opposite of the mention gate below.
    expect(main?.source.startsWith(MAIN_HEADER + "import Rat\n"))
      .toBe(true);
  });

  /**
   * The Playground's `module X` / `end module X` headers and the language's
   * `import X` head now spell the same word, and #565's contextual rule
   * is what keeps them from meeting: the language reads `module` only in the one
   * position after `import`, and a header never stands there.
   *
   * Two directions, both pinned here because the two forms are the Playground's
   * alone to hold apart. A header does not read as an import head — it is masked
   * out of `/main.hex` before the alias scan sees the text at all, and it binds
   * no alias even when its own name is a companion's. And an import head is not
   * read as a header — `parseWorkspaceSource` finds block headers by their own
   * line shape, so the injected line and a user's own are ordinary text to it.
   */
  test("a `module` block header is no import head, and vice versa", () => {
    const withBlock = "module Helper\n" +
      "    export fun twice(n: Int): Int = n * 2\n" +
      "end module Helper\n" +
      "let half = Rat.create(1, 2)\n";
    const { files } = layOutWorkspace(withBlock);
    const main = files.find(({ path }) => path === entryPath);

    // The header bound nothing, so the mention of `Rat` still earns its line,
    // and the block's own synthesized import stands beside it — the same head,
    // written by the Playground rather than the user.
    expect(main?.source.split("\n").filter((line) => line.startsWith("import")))
      .toEqual([
        'import Rat',
        'import Helper',
      ]);
    // And the block is still a file of its own, masked out of the entry: the
    // header's `module` never reached the language's grammar.
    expect(files.find(({ path }) => path === "/Helper.hex")?.source)
      .toBe("    module Helper\n\n" + "    export fun twice(n: Int): Int = n * 2\n");
    expect(main?.source).not.toContain("end module Helper");
  });

  test("reads a mention at identifier boundaries, not as a substring", () => {
    // `Ratio` is not `Rat`, and neither is the `Rat` inside it. Over-approximate
    // the other way — a comment counts — because a spare import is harmless and
    // a missing one fails a compile against text the buffer does not show.
    const spelled = (source: string): boolean =>
      layOutWorkspace(source).files.find(({ path }) => path === entryPath)
        ?.source.includes("import Rat") ?? false;

    expect(spelled("let Ratio = 1\nlet myRat2 = 2\n")).toBe(false);
    expect(spelled("// a Rat is exact\nlet one = 1\n")).toBe(true);
    expect(spelled("let one = 1 // Rat\n")).toBe(true);
  });

  test("hosts every library source whether or not it is auto-imported", () => {
    // Hosting is availability: `Rat` stays a file the compiler can resolve an
    // ordinary `import` against even when nothing prepends one.
    const { files } = layOutWorkspace("Debug.log(\"hello\")\n");

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
      "Debug.log(\"${Helper.twice(3)}\")\n";
    const { files } = layOutWorkspace(source);

    const helper = files.find(({ path }) => path === "/Helper.hex");
    // The block's body behind the header #829 makes every file declare — the
    // name is the one the block's own `module` line wrote.
    expect(helper?.source).toBe("    module Helper\n\n" + "    export fun twice(n: Int): Int = n * 2\n");
    // Masked rather than removed, so every offset after it is still the
    // buffer's own — which is the property the map relies on.
    const main = files.find(({ path }) => path === entryPath);
    expect(main?.source).toContain("Debug.log(\"${Helper.twice(3)}\")");
    expect(main?.source).not.toContain("export fun twice");
  });

  test("reports the notation's own errors instead of guessing at a split", () => {
    const { diagnostics } = layOutWorkspace("module Helper\nlet one = 1\n");

    expect(diagnostics).toMatchObject([{ severity: "error" }]);
  });
});

describe("WorkspaceMap", () => {
  test("round-trips every offset of a document with no module blocks", () => {
    const source = "let one = 1\nDebug.log(\"${one}\")\n";
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
      "Debug.log(\"${Helper.twice(3)}\")\n";
    const { map } = layOutWorkspace(source);
    const inside = source.indexOf("twice");

    const at = map.locate(inside);

    // The block's file is its body behind a synthesized header, so the offset
    // is the buffer's own less the block's opening line and plus that header.
    expect(at).toEqual({
      path: "/Helper.hex",
      offset: inside - "module Helper\n".length + "    module Helper\n\n".length,
    });
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
      "Debug.log(\"${Helper.twice(3)}\")\n";
    const { map } = layOutWorkspace(source);
    const after = source.indexOf("Debug.log(");

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
