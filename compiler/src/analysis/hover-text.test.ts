import { describe, expect, test } from "vitest";

import * as Source from "../support/source.js";
import type { Target } from "../queries/occurrences.js";
import { hoverMarkdown } from "./hover-text.js";

const span = new Source.File(Source.fileId(0), "/main.hex", "x").span(0, 1);

const hover = (fields: {
  readonly name: string;
  readonly target?: Target;
  readonly displayedType?: string;
  readonly documentation?: string;
}) => ({ span, ...fields });

/**
 * The word in front of a name, for every kind a name can denote.
 *
 * Exhaustive by construction rather than by choice: `Target` is a closed union
 * and `describeTarget` switches on it without a default, so a new kind stops
 * compiling here as well as there. Each row is a string a user reads, which is
 * why they are spelled out rather than derived.
 */
const kinds: readonly (readonly [Target, string])[] = [
  [{ kind: "value", symbol: 1 as never }, "value"],
  [{ kind: "union", union: 1 as never }, "union"],
  [{ kind: "record", record: 1 as never }, "record"],
  [{ kind: "extern-type", externType: 1 as never }, "foreign type"],
  [{ kind: "constraint", name: "Show" }, "constraint"],
];

describe("hoverMarkdown", () => {
  test.each(kinds)("names a %o as its kind", (target, word) => {
    expect(hoverMarkdown(hover({ name: "x", target, displayedType: "Int" })))
      .toBe(`${word} \`x: Int\``);
  });

  test("omits the type for a name the checker gave no scheme", () => {
    expect(hoverMarkdown(hover({ name: "Shade", target: kinds[1]![0] })))
      .toBe("union `Shade`");
  });

  test("omits the kind word for a name with no identity, keeping the docs", () => {
    // An `honor` member or a record field: `spec/doc-comments.md` §8 asks that
    // it still answer, and documentation is the whole of what there is to say.
    expect(hoverMarkdown(hover({ name: "show", documentation: "Renders it." })))
      .toBe("`show`\n\nRenders it.");
  });

  test("separates documentation by a blank line, never a rule", () => {
    // `---` under a line of text is a Markdown *heading* marker, which would
    // silently restyle the signature above it.
    const rendered = hoverMarkdown(hover({
      name: "twice",
      target: kinds[0]![0],
      displayedType: "Int -> Int",
      documentation: "Doubles it.",
    }));

    expect(rendered).toBe("value `twice: Int -> Int`\n\nDoubles it.");
    expect(rendered).not.toContain("---");
  });

  test("passes documentation through as Markdown, unfenced and unescaped", () => {
    // §6 makes the content Markdown and §8 asks for it rendered as Markdown, so
    // fencing or escaping it here would show the user the syntax instead.
    expect(
      hoverMarkdown(hover({
        name: "x",
        target: kinds[0]![0],
        displayedType: "Int",
        documentation: "See `Vector.length` and *note* the [link](x).",
      })),
    ).toBe("value `x: Int`\n\nSee `Vector.length` and *note* the [link](x).");
  });
});
