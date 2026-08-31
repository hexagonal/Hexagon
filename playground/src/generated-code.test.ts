import { describe, expect, test } from "vitest";

import type { GeneratedSection } from "./protocol";
import {
  formatEditionLabel,
  formatExportLabel,
  generatedSectionsPanel,
  renderGeneratedCodeView,
} from "./generated-code";

const javascript =
  "const plus = generic;\n" +
  "function plusInt(x, y) { return x + y; }\n" +
  "function plusFloat(x, y) { return x + y; }\n" +
  "export { plusInt };\n" +
  "export { plusFloat };\n";
const intStart = javascript.indexOf("function plusInt");
const intEnd = intStart + "function plusInt(x, y) { return x + y; }".length;
const floatStart = javascript.indexOf("function plusFloat");
const floatEnd = floatStart + "function plusFloat(x, y) { return x + y; }".length;
const sections: readonly GeneratedSection[] = [
  {
    kind: "FundamentalSpecialization",
    sourceName: "plus",
    generatedName: "plusInt",
    typeArguments: ["Int"],
    startOffset: intStart,
    endOffset: intEnd,
    bytes: intEnd - intStart,
  },
  {
    kind: "FundamentalSpecialization",
    sourceName: "plus",
    generatedName: "plusFloat",
    typeArguments: ["Float"],
    startOffset: floatStart,
    endOffset: floatEnd,
    bytes: floatEnd - floatStart,
  },
];

describe("renderGeneratedCodeView", () => {
  test("hides a family and its export plumbing in the source-shaped view", () => {
    const view = renderGeneratedCodeView(javascript, sections, "source");

    expect(view).toContain("const plus = generic;");
    expect(view).toContain("plus — 2 generated specializations hidden");
    expect(view).not.toContain("function plusInt");
    expect(view).not.toContain("export { plusInt }");
  });

  /**
   * The internal constrained export is Hexagon-to-Hexagon plumbing the source
   * never wrote (#430). Its neighbours in the same `export { … as … };` shape
   * are not: an evidence dictionary is a real cross-module binding, and a
   * boundary wrapper is the published face itself.
   */
  test("hides internal constrained exports and leaves the other aliased ones", () => {
    const plumbing = "const plus = generic;\n" +
      "function plusInt(x, y) { return x + y; }\n" +
      "export { plus as __plus };\n" +
      "export { total_1 as __total_1 };\n" +
      "export { __default_stamped };\n" +
      "export { __Eq_Rat_1 as __Eq_Rat };\n" +
      "export { totalBoundary as totalInt };\n";
    const start = plumbing.indexOf("function plusInt");
    const end = start + "function plusInt(x, y) { return x + y; }".length;
    const view = renderGeneratedCodeView(plumbing, [{
      kind: "FundamentalSpecialization",
      sourceName: "plus",
      generatedName: "plusInt",
      typeArguments: ["Int"],
      startOffset: start,
      endOffset: end,
      bytes: end - start,
    }], "source");

    expect(view).not.toContain("__plus");
    expect(view).not.toContain("__total_1");
    expect(view).toContain("export { __default_stamped };");
    expect(view).toContain("export { __Eq_Rat_1 as __Eq_Rat };");
    expect(view).toContain("export { totalBoundary as totalInt };");
  });

  test("returns the exact module or one annotated edition on request", () => {
    expect(renderGeneratedCodeView(javascript, sections, "complete")).toBe(javascript);
    expect(renderGeneratedCodeView(javascript, sections, "specialization:plusFloat")).toBe(
      `// plusFloat — plus<Float> · ${floatEnd - floatStart} B\n` +
        "function plusFloat(x, y) { return x + y; }\n",
    );
  });
});

/** One row in either artefact's list, with only the fields the report reads. */
function edition(
  sourceName: string,
  generatedName: string,
  typeArgument: string,
  bytes: number,
  startOffset = 0,
): GeneratedSection {
  return {
    kind: "FundamentalSpecialization",
    sourceName,
    generatedName,
    typeArguments: [typeArgument],
    startOffset,
    // Deliberately not `startOffset + bytes`: the offsets index the text as
    // JavaScript does and `bytes` is UTF-8, and this file's own fixtures must
    // not quietly assume the two agree.
    endOffset: startOffset + 1,
    bytes,
  };
}

/**
 * The generated-sections panel is Zero-Cost Fundamental Exports §10's report as
 * one host shows it: the two artefacts' sizes for each edition, and §3.4's list
 * of exports that publish no typed entry point at all.
 */
describe("generatedSectionsPanel", () => {
  test("carries both artefacts' bytes for an export that minted editions", () => {
    const panel = generatedSectionsPanel(
      [edition("stamp", "stampInt", "Int", 66), edition("stamp", "stampFloat", "Float", 70)],
      [edition("stamp", "stampInt", "Int", 66), edition("stamp", "stampFloat", "Float", 68)],
      [],
    );

    expect(panel.hasContent).toBe(true);
    expect(panel.zeroEntryPointNote).toBeUndefined();
    expect(panel.exports).toEqual([{
      sourceName: "stamp",
      editions: [
        { section: expect.objectContaining({ generatedName: "stampInt" }), declarationBytes: 66 },
        { section: expect.objectContaining({ generatedName: "stampFloat" }), declarationBytes: 68 },
      ],
      // §10 asks for two sizes rather than a total precisely because they
      // differ: `stampFloat` weighs 70 bytes of body and 68 of face.
      javaScriptBytes: 136,
      declarationBytes: 134,
      facesMissing: 0,
    }]);
    expect(formatExportLabel(panel.exports[0]!)).toBe("stamp (2, 136 B JS · 134 B .d.ts)");
    expect(formatEditionLabel(panel.exports[0]!.editions[1]!)).toBe(
      "stampFloat · Float · 70 B JS · 68 B .d.ts",
    );
  });

  /**
   * The common case in this pane rather than an exotic one: the JavaScript is
   * re-emitted with `previewPrivateSpecializations`, and a private declaration
   * reaches no `.d.ts`. Reporting `0 B .d.ts` would be a measurement claim about
   * an artefact that carries no row at all.
   */
  test("says a private edition published no face rather than zero bytes", () => {
    const panel = generatedSectionsPanel(
      [edition("plus", "plusInt", "Int", 40), edition("plus", "plusFloat", "Float", 44)],
      [],
      [],
    );

    expect(panel.exports[0]).toMatchObject({ declarationBytes: 0, facesMissing: 2 });
    expect(formatExportLabel(panel.exports[0]!)).toBe("plus (2, 84 B JS · no .d.ts faces)");
    expect(formatEditionLabel(panel.exports[0]!.editions[0]!)).toBe(
      "plusInt · Int · 40 B JS · no .d.ts face",
    );
  });

  /**
   * The pairing key, pinned on the only shape that can tell the two candidate
   * keys apart: two constrained declarations where the private one's editions
   * are rendered **first**. That is the default example's own shape, not a
   * contrivance — this pane previews private editions and the `.d.ts` beside it
   * has none of them, so the lists differ in membership and not merely in
   * length.
   *
   * Pairing by position reads green on every other fixture in this file and
   * inverts here: `secret` is credited with `stamp`'s faces and `stamp` reports
   * having published none, which is the report saying the opposite of the truth
   * about both declarations at once.
   */
  test("pairs an edition with its own face where a private export is rendered first", () => {
    const panel = generatedSectionsPanel(
      [
        edition("secret", "secretNat", "Nat", 40),
        edition("secret", "secretInt", "Int", 44),
        edition("stamp", "stampNat", "Nat", 66),
        edition("stamp", "stampFloat", "Float", 70),
      ],
      [edition("stamp", "stampNat", "Nat", 66), edition("stamp", "stampFloat", "Float", 68)],
      [],
    );

    expect(panel.exports.map(({ sourceName }) => sourceName)).toEqual(["secret", "stamp"]);
    expect(formatExportLabel(panel.exports[0]!)).toBe("secret (2, 84 B JS · no .d.ts faces)");
    expect(formatExportLabel(panel.exports[1]!)).toBe("stamp (2, 136 B JS · 134 B .d.ts)");
    expect(panel.exports[0]).toMatchObject({ declarationBytes: 0, facesMissing: 2 });
    expect(panel.exports[1]).toMatchObject({ declarationBytes: 134, facesMissing: 0 });
    // Each face lands on the edition that rendered it, not on the one that
    // happens to sit at its index in the other artefact's list.
    expect(formatEditionLabel(panel.exports[1]!.editions[1]!)).toBe(
      "stampFloat · Float · 70 B JS · 68 B .d.ts",
    );
  });

  /**
   * §16(h): `heaviest` is bound by a constraint no fundamental type honors, so
   * the lawful tuple product is empty and nothing is minted. The panel has to
   * render anyway — this is the one case where an author targeting JS consumers
   * would otherwise learn the truth from a missing import (§3.4).
   */
  test("still has content where nothing was generated and an export has no entry point", () => {
    const panel = generatedSectionsPanel([], [], ["heaviest"]);

    expect(panel.exports).toEqual([]);
    expect(panel.zeroEntryPointNote).toBe("No JavaScript entry points: heaviest");
    expect(panel.hasContent).toBe(true);
  });

  test("lists every zero-entry-point export beside the editions of the others", () => {
    const panel = generatedSectionsPanel(
      [edition("stamp", "stampInt", "Int", 66)],
      [edition("stamp", "stampInt", "Int", 66)],
      ["heaviest", "describe"],
    );

    expect(panel.zeroEntryPointNote).toBe("No JavaScript entry points: heaviest, describe");
    expect(panel.exports).toHaveLength(1);
  });

  test("goes dark for a module whose exports are all unconstrained", () => {
    const panel = generatedSectionsPanel([], [], []);

    expect(panel).toEqual({ exports: [], zeroEntryPointNote: undefined, hasContent: false });
  });

  /**
   * `bytes` is UTF-8 and the offsets are JavaScript string indexes. A `.d.ts`
   * row spans the edition's doc block, which is where an author's own prose
   * lives, so this is the artefact where the two diverge in practice — and a
   * label computed from the span would under-report the file on disk.
   */
  test("labels a section by its UTF-8 bytes and not by the width of its span", () => {
    const face = edition("stamp", "stampInt", "Int", 148);
    const panel = generatedSectionsPanel([edition("stamp", "stampInt", "Int", 66)], [face], []);

    expect(face.bytes).toBeGreaterThan(face.endOffset - face.startOffset);
    expect(formatExportLabel(panel.exports[0]!)).toContain("148 B .d.ts");
    expect(formatEditionLabel(panel.exports[0]!.editions[0]!)).toContain("148 B .d.ts");
  });
});
