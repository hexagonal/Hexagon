import { describe, expect, test } from "vitest";

import * as Source from "../support/source.js";
import type { Target } from "../queries/occurrences.js";
import { hoverMarkdown } from "./hover-text.js";

const span = new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + "x").span(0, 1);

const hover = (fields: {
  readonly name: string;
  readonly target?: Target;
  readonly displayedType?: string;
  readonly documentation?: string;
}) => ({ span, ...fields });

/**
 * The word in front of a name, for every kind a name can denote.
 *
 * Keyed by `Target["kind"]` rather than listed, so this is exhaustive by the
 * type checker and not by my counting: a seventh kind added to `Target` fails to
 * compile here as well as in `describeTarget`'s switch. Each value is a string
 * a user reads, so they are spelled out rather than derived from the kind.
 */
const words: Record<Target["kind"], string> = {
  "value": "value",
  "union": "union",
  "record": "record",
  "extern-type": "foreign type",
  "constraint": "constraint",
  "module": "module",
};

/** One `Target` per kind, with a payload the renderer never looks at. */
const targets: Record<Target["kind"], Target> = {
  "value": { kind: "value", symbol: 1 as never },
  "union": { kind: "union", union: 1 as never },
  "record": { kind: "record", record: 1 as never },
  "extern-type": { kind: "extern-type", externType: 1 as never },
  "constraint": { kind: "constraint", name: "Show" },
  "module": { kind: "module", name: "Geometry" },
};

const kinds = Object.entries(words).map(
  ([kind, word]) => [targets[kind as Target["kind"]]!, word] as const,
);

describe("hoverMarkdown", () => {
  test.each(kinds)("names a %o as its kind", (target, word) => {
    expect(hoverMarkdown(hover({ name: "x", target, displayedType: "Int" })))
      .toBe(`${word} \`x: Int\``);
  });

  test("omits the type for a name the checker gave no scheme", () => {
    expect(hoverMarkdown(hover({ name: "Shade", target: targets.union })))
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
      target: targets.value,
      displayedType: "Int -> Int",
      documentation: "Doubles it.",
    }));

    expect(rendered).toBe("value `twice: Int -> Int`\n\nDoubles it.");
    expect(rendered).not.toContain("---");
  });

  test("carries a numbered arrow face through unchanged", () => {
    // The one sentence every host draws (#364): the arrow trio and its
    // display-only indices are ordinary characters in the code span, so nothing
    // here may normalize, escape or transliterate them on the way out.
    const rendered = hoverMarkdown(hover({
      name: "compose",
      target: targets.value,
      displayedType: "(String =>¹ String, String =>¹ String) =>² String =>¹ String",
    }));
    expect(rendered).toBe(
      "value `compose: (String =>¹ String, String =>¹ String) =>² String =>¹ String`",
    );
  });

  test("passes documentation through as Markdown, unfenced and unescaped", () => {
    // §6 makes the content Markdown and §8 asks for it rendered as Markdown, so
    // fencing or escaping it here would show the user the syntax instead.
    expect(
      hoverMarkdown(hover({
        name: "x",
        target: targets.value,
        displayedType: "Int",
        documentation: "See `Vector.length` and *note* the [link](x).",
      })),
    ).toBe("value `x: Int`\n\nSee `Vector.length` and *note* the [link](x).");
  });
});
