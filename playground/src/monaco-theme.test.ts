import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  darkPalette,
  hexagonDarkThemeData,
  hexagonLightThemeData,
  lightPalette,
  type HexagonPalette,
} from "./monaco-theme";

/**
 * Playground is downstream of the VS Code extension: the same seven families, the
 * same hex values. These tests read `.vscode/settings.json` directly, so a colour
 * changed there and not here fails the build rather than drifting silently.
 */
const settingsPath = fileURLToPath(new URL("../../.vscode/settings.json", import.meta.url));

interface ThemeRule {
  readonly name: string;
  readonly scope: string | readonly string[];
  readonly settings: { readonly foreground: string };
}

async function vsCodeFamilies(theme: string): Promise<Record<string, string>> {
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    "editor.tokenColorCustomizations": Record<string, { textMateRules: ThemeRule[] }>;
  };
  const rules = settings["editor.tokenColorCustomizations"][theme]?.textMateRules;
  if (rules === undefined) throw new Error(`missing ${theme} customization`);
  return Object.fromEntries(rules.map((r) => [r.name, r.settings.foreground]));
}

/** The palette entry each VS Code family name must equal. */
const familyToPaletteKey: Record<string, keyof HexagonPalette> = {
  "Hexagon literal data": "literal",
  "Hexagon commentary": "commentary",
  "Hexagon ordinary terms and symbolic operators": "ordinary",
  "Hexagon structural vocabulary": "structural",
  "Hexagon nominal names": "nominal",
  "Hexagon constraint names": "constraint",
  "Hexagon callable names": "callable",
  "Hexagon lexical errors": "error",
};

describe.each([
  ["[Light 2026]", lightPalette],
  ["[Dark 2026]", darkPalette],
])("%s", (theme, palette) => {
  test("every family matches the VS Code extension exactly", async () => {
    const families = await vsCodeFamilies(theme);
    for (const [family, key] of Object.entries(familyToPaletteKey)) {
      expect(`${family}=${palette[key]}`).toBe(`${family}=${families[family]}`);
    }
  });

  test("covers every family the VS Code side defines", async () => {
    const families = await vsCodeFamilies(theme);
    // `literal punctuation` is deliberately absent: it is the ordinary foreground,
    // and Playground has no separate token for it.
    const unmapped = Object.keys(families).filter(
      (name) => !(name in familyToPaletteKey) && name !== "Hexagon literal punctuation",
    );
    expect(unmapped).toEqual([]);
  });
});

describe("theme data", () => {
  test("scopes every rule to the Hexagon language so other panes are untouched", () => {
    for (const data of [hexagonLightThemeData, hexagonDarkThemeData]) {
      expect(data.rules.length).toBeGreaterThan(0);
      expect(data.rules.every((rule) => rule.token.endsWith(".hexagon"))).toBe(true);
    }
  });

  test("uses each palette colour at least once", () => {
    for (const [data, palette] of [
      [hexagonLightThemeData, lightPalette],
      [hexagonDarkThemeData, darkPalette],
    ] as const) {
      const used = new Set(data.rules.map((rule) => rule.foreground));
      for (const [key, colour] of Object.entries(palette)) {
        if (key === "background") continue;
        expect(`${key}:${used.has(colour.replace("#", "")) || used.has(colour)}`).toBe(
          `${key}:true`,
        );
      }
    }
  });

  test("keeps Playground's own editor background rather than the theme's", () => {
    expect(hexagonLightThemeData.colors?.["editor.background"]).toBe("#ffffff");
    expect(hexagonDarkThemeData.colors?.["editor.background"]).toBe("#111318");
  });

  test("inherits from the matching Monaco base so untouched tokens stay sane", () => {
    expect(hexagonLightThemeData.base).toBe("vs");
    expect(hexagonDarkThemeData.base).toBe("vs-dark");
    expect(hexagonLightThemeData.inherit).toBe(true);
    expect(hexagonDarkThemeData.inherit).toBe(true);
  });
});
