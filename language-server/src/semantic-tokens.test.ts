import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import type { SemanticToken } from "../../compiler/src/index.js";
import { LEGEND, encodeSemanticTokens } from "./semantic-tokens.js";

/** A token at a position, with no file behind it: only the geometry matters. */
function token(
  line: number,
  column: number,
  length: number,
  type: SemanticToken["type"],
  modifiers: SemanticToken["modifiers"] = [],
): SemanticToken {
  const position = (at: number) => ({ offset: at, line, column: at });
  return {
    span: {
      fileId: 0 as SemanticToken["span"]["fileId"],
      start: position(column),
      end: position(column + length),
    },
    type,
    modifiers,
  };
}

describe("encodeSemanticTokens", () => {
  test("positions each token relative to the one before it", () => {
    const { data } = encodeSemanticTokens([
      token(0, 4, 5, "function", ["declaration"]),
      token(0, 12, 3, "parameter"),
      token(3, 2, 4, "enum"),
    ]);
    expect(data).toEqual([
      // line 0, column 4, length 5, `function` (index 0), `declaration` (bit 0)
      0, 4, 5, 0, 1,
      // same line, so the column is relative to the previous token's column
      0, 8, 3, 3, 0,
      // three lines on, so the column is absolute again
      3, 2, 4, 4, 0,
    ]);
  });

  test("the first token on a line carries its column, not a delta", () => {
    // The rule the encoding actually states: a start delta is relative only
    // within one line. Carrying the previous line's column across a line break
    // shifts every token on the new line, and the shift compounds.
    const { data } = encodeSemanticTokens([
      token(0, 30, 2, "variable"),
      token(1, 4, 2, "variable"),
    ]);
    expect(data.slice(5)).toEqual([1, 4, 2, 2, 0]);
  });

  test("every type the compiler can produce has a number in the legend", () => {
    // A type missing from the legend has nothing to send and is dropped, so the
    // colour would simply not appear — a silence nothing else would report.
    const produced: SemanticToken["type"][] = [
      "function",
      "method",
      "variable",
      "parameter",
      "enum",
      "enumMember",
      "struct",
      "type",
      "interface",
    ];
    for (const type of produced) expect(LEGEND.tokenTypes).toContain(type);
    const { data } = encodeSemanticTokens(produced.map((type, at) => token(at, 0, 1, type)));
    expect(data).toHaveLength(produced.length * 5);
  });

  test("an empty file encodes to an empty array, not to nothing", () => {
    expect(encodeSemanticTokens([])).toEqual({ data: [] });
  });
});

describe("the repository's semantic colours", () => {
  /**
   * Semantic tokens *override* the TextMate grammar wherever they apply, so a
   * type in the legend with no colour of its own does not fall back to the
   * grammar's carefully chosen one — it falls back to the base theme's, and the
   * name changes colour the moment the server connects. Every type the server
   * can send therefore needs a rule, in both themes.
   */
  test("colour every type the legend can send, in both themes", async () => {
    const settings = JSON.parse(
      await readFile(new URL("../../.vscode/settings.json", import.meta.url), "utf8"),
    ) as {
      "editor.semanticTokenColorCustomizations": Record<
        string,
        { readonly enabled: boolean; readonly rules: Record<string, string> }
      >;
    };
    const customizations = settings["editor.semanticTokenColorCustomizations"];
    for (const theme of ["[Light 2026]", "[Dark 2026]"]) {
      const customization = customizations[theme];
      expect(customization, `missing ${theme} customization`).toBeDefined();
      // Some themes ship with semantic highlighting off, and the rules are then
      // simply never consulted.
      expect(customization!.enabled).toBe(true);
      expect(Object.keys(customization!.rules).sort()).toEqual([...LEGEND.tokenTypes].sort());
    }
  });
});
