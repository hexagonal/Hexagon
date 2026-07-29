import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

/**
 * The Hexagon colour families, kept identical to the VS Code extension's
 * `editor.tokenColorCustomizations` for `[Light 2026]` / `[Dark 2026]`.
 *
 * The VS Code side is authoritative; `editors/vscode/README.md` records which
 * distinctions the grammar draws and why. `monaco-theme.test.ts` reads
 * `.vscode/settings.json` and fails if either the colours or the scope lists here
 * drift from it, so Playground never invents a colour or a family of its own.
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
 * A VS Code family: the palette entry it draws from, and the TextMate scopes it
 * covers. Keyed by the family's `name` in `.vscode/settings.json`, and both halves are
 * compared against that file, so a scope added to the grammar and themed on only one
 * side fails the build.
 *
 * Playground now tokenizes with the VS Code grammar itself (see `monaco-textmate.ts`),
 * so these really are TextMate scopes and not a parallel token vocabulary — which is
 * what lets the comparison be an equality rather than a translation table.
 */
export interface HexagonFamily {
  readonly palette: Exclude<keyof HexagonPalette, "background">;
  readonly scopes: readonly string[];
}

export const hexagonFamilies: Readonly<Record<string, HexagonFamily>> = {
  "Hexagon literal data": {
    palette: "literal",
    scopes: [
      "constant.character.escape.hexagon",
      "constant.numeric.integer.hexagon",
      "constant.numeric.float.hexagon",
      "constant.numeric.bigint.hexagon",
      "string.quoted.double.hexagon",
    ],
  },
  "Hexagon commentary": {
    palette: "commentary",
    scopes: [
      "comment.block.documentation.hexagon",
      "comment.block.hexagon",
      "comment.line.documentation.hexagon",
      "comment.line.double-slash.hexagon",
      "punctuation.definition.comment.hexagon",
      "punctuation.definition.comment.begin.hexagon",
      "punctuation.definition.comment.end.hexagon",
    ],
  },
  "Hexagon ordinary terms and symbolic operators": {
    palette: "ordinary",
    scopes: [
      "meta.embedded.line.hexagon",
      "variable.other.hexagon",
      "variable.other.definition.hexagon",
      "variable.parameter.hexagon",
      "variable.language.wildcard.hexagon",
      "keyword.operator.arithmetic.hexagon",
      "keyword.operator.comparison.hexagon",
      "keyword.operator.assignment.hexagon",
      "keyword.operator.concat.hexagon",
      "keyword.operator.pipe.hexagon",
      "keyword.operator.range.hexagon",
      "keyword.operator.spread.hexagon",
      "keyword.operator.bar.hexagon",
      "keyword.operator.arrow.hexagon",
      "keyword.operator.type.arrow.hexagon",
    ],
  },
  "Hexagon structural vocabulary": {
    palette: "structural",
    scopes: [
      "keyword.control.hexagon",
      "keyword.control.import.hexagon",
      "storage.type.hexagon",
      "storage.type.function.hexagon",
      "storage.modifier.hexagon",
      "keyword.other.as.hexagon",
      "keyword.other.from.hexagon",
      "keyword.other.derives.hexagon",
      "keyword.other.when.hexagon",
      "keyword.other.with.hexagon",
      "keyword.other.ffi.hexagon",
      "keyword.operator.word.hexagon",
    ],
  },
  "Hexagon nominal names": {
    palette: "nominal",
    scopes: [
      "entity.name.type.hexagon",
      "entity.name.namespace.hexagon",
      "entity.name.type.parameter.hexagon",
    ],
  },
  "Hexagon constraint names": {
    palette: "constraint",
    scopes: ["entity.name.type.constraint.hexagon"],
  },
  "Hexagon callable names": {
    palette: "callable",
    scopes: ["entity.name.function.hexagon"],
  },
  "Hexagon lexical errors": {
    palette: "error",
    scopes: [
      "invalid.illegal.reserved-identifier.hexagon",
      "invalid.illegal.reserved-redirect-word.hexagon",
      "invalid.illegal.numeric-base.hexagon",
      "invalid.illegal.numeric-literal.hexagon",
      "invalid.illegal.unknown-escape.hexagon",
      "invalid.illegal.unicode-escape.hexagon",
      "invalid.illegal.reserved-interpolation.hexagon",
      "invalid.illegal.unmatched-comment-close.hexagon",
      "invalid.illegal.operator.hexagon",
      "invalid.illegal.character.hexagon",
      "invalid.illegal.whitespace.hexagon",
      "invalid.illegal.tab-indentation.hexagon",
      "invalid.illegal.bidirectional-control.hexagon",
    ],
  },
  // Ordinary foreground, but its own family on the VS Code side: a string's quotes and
  // an interpolation's `${`/`}` are punctuation around literal data, not literal data.
  // The Monarch tokenizer had no token for them and the old test had to exempt the
  // family; with real scopes Playground can spell it.
  "Hexagon literal punctuation": {
    palette: "ordinary",
    scopes: [
      "punctuation.definition.string.begin.hexagon",
      "punctuation.definition.string.end.hexagon",
      "punctuation.section.interpolation.begin.hexagon",
      "punctuation.section.interpolation.end.hexagon",
    ],
  },
};

/**
 * Monaco resolves a rule by walking the token string's dot-separated segments, so a
 * rule matches a scope and everything more specific than it. Every scope is therefore
 * listed outright rather than abbreviated to a shared prefix. A rule for
 * `entity.name.type` would be inherited by `entity.name.type.parameter.hexagon`, which
 * belongs to the nominal family, *and* by `entity.name.type.constraint.hexagon`, which
 * does not — one rule, two families, and the more specific one loses.
 *
 * Two fully-spelled scopes cannot shadow each other, because both end `.hexagon` and
 * neither is then a dotted prefix of the other. That is the same property that keeps
 * these rules confined to Hexagon: the generated JavaScript and `.d.ts` panes share
 * this theme and keep their own base-theme colours.
 */
const rulesFor = (palette: HexagonPalette): monaco.editor.ITokenThemeRule[] =>
  Object.values(hexagonFamilies).flatMap((family) =>
    family.scopes.map((scope) => ({ token: scope, foreground: palette[family.palette] })),
  );

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
