import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

import { grammarPath, repositoryRoot } from "./tokenize.js";

interface ThemeRule {
  readonly name: string;
  readonly scope: string | readonly string[];
  readonly settings: {
    readonly foreground: string;
  };
}

interface WorkspaceSettings {
  readonly "editor.tokenColorCustomizations": Record<
    string,
    { readonly textMateRules: readonly ThemeRule[] }
  >;
}

const settingsPath = `${repositoryRoot}/.vscode/settings.json`;

const deliberatelyInherited = new Set([
  "meta.extern.hexagon",
  "meta.extern.enum.hexagon",
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
]);

async function emittedScopes(): Promise<Set<string>> {
  const grammar = JSON.parse(await readFile(grammarPath, "utf8")) as unknown;
  const scopes = new Set<string>();

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "name" && typeof child === "string" && child.endsWith(".hexagon")) {
        scopes.add(child);
      } else {
        visit(child);
      }
    }
  }

  visit(grammar);
  return scopes;
}

async function customizations(): Promise<WorkspaceSettings> {
  return JSON.parse(await readFile(settingsPath, "utf8")) as WorkspaceSettings;
}

function rulesFor(settings: WorkspaceSettings, theme: string): readonly ThemeRule[] {
  const customization = settings["editor.tokenColorCustomizations"][theme];
  if (customization === undefined) throw new Error(`missing ${theme} customization`);
  return customization.textMateRules;
}

describe.each(["[Light 2026]", "[Dark 2026]"])("%s Hexagon colors", (theme) => {
  test("use exact Hexagon scopes so the base theme cannot outrank them", async () => {
    const settings = await customizations();
    const rules = rulesFor(settings, theme);
    const selectors = rules.flatMap(({ scope }) =>
      typeof scope === "string" ? [scope] : scope
    );

    expect(selectors.every((selector) => selector.endsWith(".hexagon"))).toBe(true);
    expect(selectors.every((selector) => !selector.includes(" "))).toBe(true);
    expect(new Set(selectors).size).toBe(selectors.length);
  });

  test("color every non-punctuation scope the grammar emits", async () => {
    const settings = await customizations();
    const rules = rulesFor(settings, theme);
    const colored = new Set(
      rules.flatMap(({ scope }) => typeof scope === "string" ? [scope] : scope),
    );
    const expected = new Set(
      [...await emittedScopes()].filter((scope) => !deliberatelyInherited.has(scope)),
    );

    expect(colored).toEqual(expected);
  });
});

test("Dark 2026 preserves Light 2026's semantic color families", async () => {
  const settings = await customizations();
  const families = (theme: string) =>
    Object.fromEntries(
      rulesFor(settings, theme).map(({ scope, ...rule }) => [
        rule.name,
        {
          foreground: rule.settings.foreground,
          scopes: typeof scope === "string" ? [scope] : scope,
        },
      ]),
    );
  const light = families("[Light 2026]");
  const dark = families("[Dark 2026]");

  expect(Object.keys(dark)).toEqual(Object.keys(light));
  expect(Object.fromEntries(Object.entries(dark).map(([name, family]) =>
    [name, family.scopes]
  ))).toEqual(
    Object.fromEntries(Object.entries(light).map(([name, family]) =>
      [name, family.scopes]
    )),
  );
  expect(Object.fromEntries(Object.entries(dark).map(([name, family]) =>
    [name, family.foreground]
  ))).toEqual({
    "Hexagon literal data": "#7ee787",
    "Hexagon commentary": "#8b949e",
    // `Dark 2026`'s own `editor.foreground`, deliberately: brackets, commas and the
    // other punctuation this customization leaves unscoped inherit that value, so a
    // scoped ordinary term and an inherited bracket must render identically or the
    // ordinary family would look like a highlight rather than the baseline.
    "Hexagon ordinary terms and symbolic operators": "#BBBEBF",
    "Hexagon structural vocabulary": "#58a6ff",
    "Hexagon nominal names": "#4EC9B0",
    "Hexagon constraint names": "#dd82cf",
    "Hexagon callable names": "#d2a8ff",
    "Hexagon lexical errors": "#ffa198",
    "Hexagon literal punctuation": "#BBBEBF",
  });
});
