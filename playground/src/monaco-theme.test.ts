import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// @ts-expect-error Internal Monaco modules intentionally have no declaration files.
import { TokenMetadata } from "monaco-editor/esm/vs/editor/common/encodedTokenAttributes.js";
// @ts-expect-error Internal Monaco modules intentionally have no declaration files.
import { TokenTheme } from "monaco-editor/esm/vs/editor/common/languages/supports/tokenization.js";

import hexagonGrammarSource from "../../editors/vscode/syntaxes/hexagon.tmLanguage.json?raw";
import playgroundModuleGrammarSource from "./playground-module.tmLanguage.json?raw";
import {
  darkPalette,
  hexagonDarkThemeData,
  hexagonFamilies,
  hexagonLightThemeData,
  lightPalette,
} from "./monaco-theme";

/**
 * Playground is downstream of the VS Code extension: the same nine families, the same
 * hex values, and — since #161 put both editors on one grammar — the same TextMate
 * scopes. These tests read `.vscode/settings.json` directly, so a colour or a scope
 * changed there and not here fails the build rather than drifting silently.
 */
const settingsPath = fileURLToPath(new URL("../../.vscode/settings.json", import.meta.url));

interface ThemeRule {
  readonly name: string;
  readonly scope: string | readonly string[];
  readonly settings: { readonly foreground: string };
}

async function vsCodeRules(theme: string): Promise<readonly ThemeRule[]> {
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    "editor.tokenColorCustomizations": Record<string, { textMateRules: ThemeRule[] }>;
  };
  const rules = settings["editor.tokenColorCustomizations"][theme]?.textMateRules;
  if (rules === undefined) throw new Error(`missing ${theme} customization`);
  return rules;
}

describe.each([
  ["[Light 2026]", lightPalette],
  ["[Dark 2026]", darkPalette],
])("%s", (theme, palette) => {
  test("every family matches the VS Code extension exactly", async () => {
    const families = Object.fromEntries(
      (await vsCodeRules(theme)).map((rule) => [rule.name, rule.settings.foreground]),
    );
    for (const [name, family] of Object.entries(hexagonFamilies)) {
      expect(`${name}=${palette[family.palette]}`).toBe(`${name}=${families[name]}`);
    }
  });

  test("covers every family the VS Code side defines, and invents none", async () => {
    const names = (await vsCodeRules(theme)).map((rule) => rule.name);
    expect(Object.keys(hexagonFamilies).toSorted()).toEqual(names.toSorted());
  });

  test("claims the same scopes for each family as the VS Code side", async () => {
    for (const rule of await vsCodeRules(theme)) {
      const scopes = typeof rule.scope === "string" ? [rule.scope] : rule.scope;
      expect(`${rule.name}: ${hexagonFamilies[rule.name]?.scopes.join(" ")}`).toBe(
        `${rule.name}: ${scopes.join(" ")}`,
      );
    }
  });
});

/**
 * The scopes both grammars can put on a token, gathered from every `name` they spell.
 * Reading the grammar rather than a corpus means a rule that no example happens to
 * exercise is still covered.
 */
function grammarScopes(source: string): Set<string> {
  const scopes = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "name" && typeof value === "string" && value.endsWith(".hexagon")) {
        scopes.add(value);
      } else if (key !== "name") {
        walk(value);
      }
    }
  };
  walk(JSON.parse(source));
  return scopes;
}

/**
 * Scopes the VS Code side deliberately keeps out of its customization so they inherit
 * `editor.foreground`. That inherited colour and the ordinary family's are the same
 * value on purpose, so a scoped term and an unscoped bracket render identically —
 * which is why leaving these alone costs nothing and colouring them would be noise.
 *
 * Listed one by one rather than matched by prefix: a new punctuation scope should have
 * to be argued about here, not absorbed silently.
 */
const inheritsEditorForeground = [
  "punctuation.accessor.hexagon",
  "punctuation.section.parens.begin.hexagon",
  "punctuation.section.parens.end.hexagon",
  "punctuation.section.brackets.begin.hexagon",
  "punctuation.section.brackets.end.hexagon",
  "punctuation.section.braces.begin.hexagon",
  "punctuation.section.braces.end.hexagon",
  "punctuation.separator.comma.hexagon",
  "punctuation.separator.colon.hexagon",
  "punctuation.separator.semicolon.hexagon",
  // Scopes the whole `extern from` block, so it only ever surfaces as a token's
  // innermost scope on layout whitespace.
  "meta.extern.hexagon",
];

test("paints every scope the grammars can emit, or knowingly leaves it inherited", () => {
  const themed = new Set(hexagonLightThemeData.rules.map((rule) => rule.token));
  const emitted = [
    ...grammarScopes(hexagonGrammarSource),
    ...grammarScopes(playgroundModuleGrammarSource),
  ];
  const unaccounted = emitted.filter(
    (scope) => !themed.has(scope) && !inheritsEditorForeground.includes(scope),
  );
  expect(unaccounted.toSorted()).toEqual([]);
});

test("themes and exempts only scopes the grammars really emit", () => {
  // The inverse of the test above, and the reason it is here: a scope deleted from the
  // grammar would otherwise linger indefinitely in both this file and
  // `.vscode/settings.json`, painting nothing and looking load-bearing.
  const emitted = new Set([
    ...grammarScopes(hexagonGrammarSource),
    ...grammarScopes(playgroundModuleGrammarSource),
  ]);
  const stale = [
    ...hexagonLightThemeData.rules.map((rule) => rule.token),
    ...inheritsEditorForeground,
  ].filter((scope) => !emitted.has(scope));
  expect(stale.toSorted()).toEqual([]);
});

describe("theme data", () => {
  test("scopes every rule to the Hexagon language so other panes are untouched", () => {
    for (const data of [hexagonLightThemeData, hexagonDarkThemeData]) {
      expect(data.rules.length).toBeGreaterThan(0);
      expect(data.rules.every((rule) => rule.token.endsWith(".hexagon"))).toBe(true);
    }
  });

  test("resolves every scope to its own family through Monaco's own matcher", () => {
    // The rules are only correct if Monaco agrees, and Monaco resolves them through a
    // dot-segment trie rather than by string equality: a rule is inherited by every
    // scope beneath it, so an abbreviated rule can hand one family another's colour.
    // Nothing short of building the real theme catches that, so this builds it.
    const theme = TokenTheme.createFromRawTokenTheme(
      hexagonLightThemeData.rules.map((rule) => ({
        token: rule.token,
        foreground: rule.foreground,
      })),
      [],
    );
    const colourOf = (scope: string) =>
      theme
        .getColorMap()
        [TokenMetadata.getForeground(theme.match(0, scope))]?.toString()
        .toLowerCase();

    for (const [name, family] of Object.entries(hexagonFamilies)) {
      for (const scope of family.scopes) {
        expect(`${scope} in ${name} -> ${colourOf(scope)}`).toBe(
          // Monaco normalizes a colour's case on the way in.
          `${scope} in ${name} -> ${lightPalette[family.palette].toLowerCase()}`,
        );
      }
    }
  });

  test("leaves the scopes it does not claim on the editor foreground", () => {
    const theme = TokenTheme.createFromRawTokenTheme(
      hexagonLightThemeData.rules.map((rule) => ({
        token: rule.token,
        foreground: rule.foreground,
      })),
      [],
    );
    // Colour id 1 is the theme's default foreground: no rule was inherited at all,
    // which is what the `inheritsEditorForeground` list asserts about these scopes.
    for (const scope of [...inheritsEditorForeground, "source.hexagon"]) {
      expect(`${scope}:${TokenMetadata.getForeground(theme.match(0, scope))}`).toBe(
        `${scope}:1`,
      );
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
