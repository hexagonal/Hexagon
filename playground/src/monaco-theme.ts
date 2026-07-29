import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import { hexagonLanguage } from "./monaco-language";

/**
 * The Hexagon colour families, kept identical to the VS Code extension's
 * `editor.tokenColorCustomizations` for `[Light 2026]` / `[Dark 2026]`.
 *
 * The VS Code side is authoritative — `editors/vscode/THEME-COLORS.md` records the
 * reasoning, and `monaco-theme.test.ts` fails if these values drift from
 * `.vscode/settings.json`. Playground never invents a colour of its own.
 *
 * What it *does* own is the surface behind the code: Playground's page chrome sets
 * `--editor-background`, so the editor blends into the page rather than adopting the
 * VS Code theme's own background.
 */
export interface HexagonPalette {
  /** Matches Playground's `--editor-background`, not the VS Code theme's. */
  readonly background: string;
  readonly ordinary: string;
  readonly structural: string;
  readonly nominal: string;
  readonly constraint: string;
  readonly callable: string;
  readonly literal: string;
  readonly commentary: string;
  readonly error: string;
}

export const lightPalette: HexagonPalette = {
  background: "#ffffff",
  ordinary: "#1f2328",
  structural: "#0550ae",
  nominal: "#267f99",
  constraint: "#a4128c",
  callable: "#8250df",
  literal: "#38761d",
  commentary: "#6e7781",
  error: "#cf222e",
};

export const darkPalette: HexagonPalette = {
  background: "#111318",
  ordinary: "#BBBEBF",
  structural: "#58a6ff",
  nominal: "#4EC9B0",
  constraint: "#dd82cf",
  callable: "#d2a8ff",
  literal: "#7ee787",
  commentary: "#8b949e",
  error: "#ffa198",
};

export const hexagonLightTheme = "hexagon-light";
export const hexagonDarkTheme = "hexagon-dark";

/**
 * Monarch appends `tokenPostfix` (defaulting to `.<languageId>`) to every token it
 * emits, so these selectors reach Hexagon source only. The generated JavaScript and
 * `.d.ts` panes share the editor theme and keep the base theme's own colours, which
 * is correct — they are not Hexagon.
 */
const rulesFor = (palette: HexagonPalette): monaco.editor.ITokenThemeRule[] => {
  const token = (name: string, foreground: string) => ({
    token: `${name}.${hexagonLanguage}`,
    foreground,
  });
  return [
    token("comment", palette.commentary),
    token("keyword", palette.structural),
    token("type.identifier", palette.nominal),
    token("type.constraint", palette.constraint),
    token("entity.function", palette.callable),
    token("number", palette.literal),
    token("string", palette.literal),
    token("invalid", palette.error),
    // Terms, operators, and punctuation all sit at the ordinary foreground, matching
    // the VS Code side where the last two are left to inherit `editor.foreground`.
    token("identifier", palette.ordinary),
    token("operator", palette.ordinary),
    token("delimiter", palette.ordinary),
  ];
};

const themeFor = (
  base: "vs" | "vs-dark",
  palette: HexagonPalette,
): monaco.editor.IStandaloneThemeData => ({
  base,
  inherit: true,
  rules: rulesFor(palette),
  colors: {
    "editor.background": palette.background,
    "editor.foreground": palette.ordinary,
  },
});

export const hexagonLightThemeData = themeFor("vs", lightPalette);
export const hexagonDarkThemeData = themeFor("vs-dark", darkPalette);

/** Registers both themes; call once before the first editor is created. */
export function defineHexagonThemes(
  editor: Pick<typeof monaco.editor, "defineTheme">,
): void {
  editor.defineTheme(hexagonLightTheme, hexagonLightThemeData);
  editor.defineTheme(hexagonDarkTheme, hexagonDarkThemeData);
}
