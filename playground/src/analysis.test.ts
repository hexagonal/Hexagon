import { describe, expect, test } from "vitest";

import { PlaygroundAnalysis } from "./analysis";
import { compileSource } from "./compile";
import type { BufferRange, PlaygroundTextEdit } from "./protocol";

/** The source reported on the issue: a quick fix the site offered nothing for. */
const factorial = "export fun factorial(n: Int) =\n" +
  "    if n <= 1 then\n" +
  "        1\n" +
  "    else\n" +
  "        n * factorial(n - 1)\n";

/** Where a name first appears in the buffer, as an offset inside it. */
function at(source: string, name: string, occurrence = 0): number {
  let index = -1;
  for (let seen = 0; seen <= occurrence; seen += 1) {
    index = source.indexOf(name, index + 1);
    if (index < 0) throw new Error(`\`${name}\` does not occur ${occurrence + 1} times`);
  }
  return index + 1;
}

function applied(source: string, edits: readonly PlaygroundTextEdit[]): string {
  return [...edits]
    .sort((left, right) => right.startOffset - left.startOffset)
    .reduce(
      (text, edit) =>
        text.slice(0, edit.startOffset) + edit.replacement + text.slice(edit.endOffset),
      source,
    );
}

function text(source: string, range: BufferRange): string {
  return source.slice(range.startOffset, range.endOffset);
}

describe("code actions", () => {
  test("offers the reported `Infer return type` fix on a recursive export", () => {
    const analysis = new PlaygroundAnalysis();
    const caret = at(factorial, "factorial");

    const actions = analysis.codeActions(factorial, {
      startOffset: caret,
      endOffset: caret,
    });

    const fix = actions.find(({ title }) => title.startsWith("Infer return type"));
    expect(fix).toBeDefined();
    expect(fix?.disabled).toBeUndefined();
    expect(fix?.kind).toBe("quickfix");
  });

  test("its edits are buffer offsets, and applying them makes the source compile", () => {
    const analysis = new PlaygroundAnalysis();
    const caret = at(factorial, "factorial");
    expect(compileSource(1, factorial).kind).toBe("compile-failure");

    const fix = analysis
      .codeActions(factorial, { startOffset: caret, endOffset: caret })
      .find(({ title }) => title.startsWith("Infer return type"));
    const repaired = applied(factorial, fix?.edits ?? []);

    expect(repaired).toContain("export fun factorial(n: Int): Int =");
    expect(compileSource(2, repaired)).toMatchObject({ kind: "compile-success" });
  });

  test("passes a refused repair through, carrying the reason it was refused", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "export fun m(x: Int) = [x]\nexport fun m(y) = [m(y)]\n";
    const caret = at(source, "m", 1);

    const [action, ...rest] = analysis.codeActions(source, {
      startOffset: caret,
      endOffset: caret,
    });

    expect(rest).toEqual([]);
    expect(action?.title).toBe("Infer return type");
    expect(action?.edits).toEqual([]);
    expect(action?.disabled).toContain("`m` is already bound");
  });

  test("answers nothing for a selection straddling two virtual files", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "module Helper\n" +
      "    export fun twice(n: Int) = n * 2\n" +
      "end module Helper\n" +
      "console.log(Helper.twice(3))\n";

    const actions = analysis.codeActions(source, {
      startOffset: at(source, "twice"),
      endOffset: source.length,
    });

    expect(actions).toEqual([]);
  });

  test("offers nothing while the workspace notation is broken", () => {
    const analysis = new PlaygroundAnalysis();
    const unclosed = `module Helper\n${factorial}`;

    expect(
      analysis.codeActions(unclosed, { startOffset: 0, endOffset: unclosed.length }),
    ).toEqual([]);
    expect(analysis.hover(unclosed, at(unclosed, "factorial"))).toBeUndefined();
  });
});

describe("hover", () => {
  test("names what the value is, the way the language server does", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "let xs = [1, 2, 3]\nconsole.log(Vector.length(xs))\n";

    const hover = analysis.hover(source, at(source, "xs"));

    expect(hover?.markdown).toBe("value `xs: Vector(Int)`");
    expect(text(source, hover?.range ?? { startOffset: 0, endOffset: 0 })).toBe("xs");
  });

  test("carries documentation, which the occurrence table never could", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "(** Doubles what it is given. *)\n" +
      "fun twice(n: Int): Int = n * 2\n" +
      "console.log(twice(3))\n";

    const hover = analysis.hover(source, at(source, "twice", 1));

    expect(hover?.markdown).toBe(
      "value `twice: Int -> Int`\n\nDoubles what it is given.",
    );
  });

  test("answers inside a module block, where offsets are the block's own", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "module Helper\n" +
      "    export fun twice(n: Int): Int = n * 2\n" +
      "end module Helper\n" +
      "console.log(Helper.twice(3))\n";

    const hover = analysis.hover(source, at(source, "twice"));

    expect(hover?.markdown).toBe("value `twice: Int -> Int`");
    expect(text(source, hover?.range ?? { startOffset: 0, endOffset: 0 })).toBe("twice");
  });
});

describe("definition and references", () => {
  test("goes from a use to the declaration that binds it", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "fun twice(n: Int): Int = n * 2\nconsole.log(twice(3))\n";

    const [definition, ...rest] = analysis.definitions(source, at(source, "twice", 1));

    expect(rest).toEqual([]);
    expect(definition?.startOffset).toBe(source.indexOf("twice"));
    expect(text(source, definition!)).toBe("twice");
  });

  test("crosses a module block in both directions", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "module Helper\n" +
      "    export fun twice(n: Int): Int = n * 2\n" +
      "end module Helper\n" +
      "console.log(Helper.twice(3))\n";

    const [definition] = analysis.definitions(source, at(source, "twice", 1));

    expect(definition?.startOffset).toBe(source.indexOf("twice"));
  });

  test("reports every mention, at the offsets the user can see", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "fun twice(n: Int): Int = n * 2\nconsole.log(twice(twice(3)))\n";

    const found = analysis.references(source, at(source, "twice"));

    expect(found).toEqual([
      { startOffset: 4, endOffset: 9 },
      { startOffset: 43, endOffset: 48 },
      { startOffset: 49, endOffset: 54 },
    ]);
  });

  test("orders mentions by the document, not by the virtual file they came from", () => {
    const analysis = new PlaygroundAnalysis();
    // `/Zed.hex` sorts after `/main.hex`, and its block is above main's text.
    // Passing the session's own order through would list the two uses before
    // the declaration they sit below on screen.
    const source = "module Zed\n" +
      "    export fun twice(n: Int): Int = n * 2\n" +
      "end module Zed\n" +
      "console.log(Zed.twice(Zed.twice(3)))\n";

    const found = analysis.references(source, at(source, "twice"));

    expect(found.map(({ startOffset }) => startOffset)).toEqual(
      [...found.map(({ startOffset }) => startOffset)].sort((a, b) => a - b),
    );
    expect(found[0]?.startOffset).toBe(source.indexOf("twice"));
    expect(found).toHaveLength(3);
  });

  test("has nowhere to go for a name declared in a hosted library", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "console.log(Vector.length([1, 2, 3]))\n";

    expect(analysis.definitions(source, at(source, "length"))).toEqual([]);
  });
});

describe("rename", () => {
  test("moves every mention, in buffer coordinates", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "fun twice(n: Int): Int = n * 2\nconsole.log(twice(twice(3)))\n";

    const result = analysis.rename(source, at(source, "twice"), "double");

    expect(result).toMatchObject({ newName: "double" });
    if (result === undefined || "refused" in result) return;
    const renamed = applied(source, result.edits);
    expect(renamed).toBe(
      "fun double(n: Int): Int = n * 2\nconsole.log(double(double(3)))\n",
    );
    expect(compileSource(1, renamed)).toMatchObject({ kind: "compile-success" });
  });

  test("renames across a module block, rewriting the exporting file too", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "module Helper\n" +
      "    export fun twice(n: Int): Int = n * 2\n" +
      "end module Helper\n" +
      "console.log(Helper.twice(3))\n";

    const result = analysis.rename(source, at(source, "twice"), "double");

    if (result === undefined || "refused" in result) throw new Error("expected a plan");
    expect(applied(source, result.edits)).toBe(
      "module Helper\n" +
        "    export fun double(n: Int): Int = n * 2\n" +
        "end module Helper\n" +
        "console.log(Helper.double(3))\n",
    );
  });

  test("refuses a name whose mentions reach a hosted library", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "console.log(Vector.length([1, 2, 3]))\n";

    const result = analysis.rename(source, at(source, "length"), "size");

    expect(result).toMatchObject({ refused: expect.any(String) });
  });

  test("prepares the identifier the editor should pre-fill", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "fun twice(n: Int): Int = n * 2\nconsole.log(twice(3))\n";

    const subject = analysis.prepareRename(source, at(source, "twice", 1));

    expect(subject).toMatchObject({ name: "twice" });
    if (subject === undefined || "refused" in subject) return;
    expect(text(source, subject.range)).toBe("twice");
  });

  test("refuses at prepare time whatever `rename` would refuse afterwards", () => {
    const analysis = new PlaygroundAnalysis();
    const source = "console.log(Vector.length([1, 2, 3]))\n";
    const caret = at(source, "length");

    // The identifier itself is in the buffer, so a prepare that asked only
    // about the subject would open the rename box on a name whose mentions
    // reach `/stdlib/Vector.hex` — and refuse the moment the user pressed
    // Enter.
    expect(analysis.prepareRename(source, caret)).toEqual({
      refused: "this would edit code the Playground does not show",
    });
    expect(analysis.rename(source, caret, "size")).toEqual({
      refused: "this would edit code the Playground does not show",
    });
  });
});

describe("the session across requests", () => {
  test("answers about the newest source it was asked about, not the first", () => {
    const analysis = new PlaygroundAnalysis();
    const before = "fun twice(n: Int): Int = n * 2\nconsole.log(twice(3))\n";
    const after = "fun thrice(n: Int): Int = n * 3\nconsole.log(thrice(3))\n";

    expect(analysis.hover(before, at(before, "twice"))?.markdown).toBe(
      "value `twice: Int -> Int`",
    );
    expect(analysis.hover(after, at(after, "thrice"))?.markdown).toBe(
      "value `thrice: Int -> Int`",
    );
    // Back again: the session is not a one-way ratchet, and the second answer
    // did not come from a cache keyed on anything but the text.
    expect(analysis.hover(before, at(before, "twice"))?.markdown).toBe(
      "value `twice: Int -> Int`",
    );
  });

  test("forgets a module block the user deleted", () => {
    const analysis = new PlaygroundAnalysis();
    const helper = "module Helper\n" +
      "    export fun twice(n: Int): Int = n * 2\n" +
      "end module Helper\n";
    const caller = "module Extra\n" +
      '    import * as Helper from "./Helper"\n' +
      "    export fun quadruple(n: Int): Int = Helper.twice(Helper.twice(n))\n" +
      "end module Extra\n" +
      "console.log(Extra.quadruple(3))\n";

    const both = `${helper}${caller}`;
    expect(analysis.hover(both, at(both, "twice", 1))?.markdown).toBe(
      "value `twice: Int -> Int`",
    );
    // A file left behind by a missing `removeFile` would go on satisfying
    // `Extra`'s import, so the session would answer about a module the user
    // deleted while the compile pane reported it missing.
    expect(analysis.hover(caller, at(caller, "twice"))).toBeUndefined();
  });
});
