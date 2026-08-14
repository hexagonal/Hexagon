import { describe, expect, test } from "vitest";

import type { GeneratedJavaScriptSection } from "./protocol";
import { renderGeneratedCodeView } from "./generated-code";

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
const sections: readonly GeneratedJavaScriptSection[] = [
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
