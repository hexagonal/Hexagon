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
 * VS Code theme's own background. It also owns which of these colours the generated
 * JavaScript and `.d.ts` panes draw on — see `generatedFamilies` — but not the colours
 * themselves. There is exactly one palette on the page.
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
 * A family: the palette entry it draws from, and the TextMate scopes it covers.
 *
 * In `hexagonFamilies` the key is the family's `name` in `.vscode/settings.json`, and
 * both halves are compared against that file, so a scope added to the grammar and
 * themed on only one side fails the build. Playground tokenizes with the VS Code
 * grammar itself (see `monaco-textmate.ts`), so these really are TextMate scopes and
 * not a parallel token vocabulary — which is what lets the comparison be an equality
 * rather than a translation table.
 *
 * `generatedFamilies` reuses the shape for the panes VS Code has no counterpart to,
 * where the key is only a label and the scopes are prefixes.
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
      "keyword.operator.arrow.impure.hexagon",
      "keyword.operator.arrow.linked.hexagon",
      "keyword.operator.mark.hexagon",
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
      "storage.modifier.variance.hexagon",
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
      "invalid.illegal.javascript-comment.hexagon",
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
 * The same families over VS Code's JavaScript and TypeScript grammars, which is what
 * the generated-code panes are tokenized with since they left Monarch behind. There is
 * no `.vscode/settings.json` counterpart to mirror — the panes exist only here — so
 * this table is Playground's own, and `monaco-theme.test.ts` holds it to the palette
 * and to the scopes those two grammars can actually emit.
 *
 * Six families, not eight. `constraint` has nothing to name in JavaScript, and the
 * literal punctuation family needs no rules: a quote is left to the editor foreground,
 * which is the colour that family carries anyway.
 *
 * These are prefixes, not whole scopes. The Hexagon table below spells every scope
 * outright because it must not shadow a sibling; that is impossible here, because a
 * prefix rule cannot carry the `.js`/`.ts` suffix that would make it specific. What
 * keeps the two apart instead is depth: every Hexagon scope is themed outright, so
 * Monaco's longest-prefix match finds the Hexagon rule first. `monaco-theme.test.ts`
 * asserts that for every scope the Hexagon grammars emit rather than trusting it.
 *
 * The overrides — a family listing a longer prefix another family already covers — are
 * where the Hexagon reading of a token differs from the shape of the scope name:
 *
 *   - `keyword.operator.expression` is `typeof`, `instanceof`, `in`, `void`, `delete`.
 *     Hexagon paints word operators structural and symbolic ones ordinary, and the
 *     grammar sorts them for us, so `keyword.operator` is ordinary and this is not.
 *   - `storage.type.function.arrow` is `=>`, which Hexagon paints ordinary with its
 *     other arrows, not structural with `function`.
 *   - `storage.type.numeric.bigint` is the `n` of `42n`, and `meta.delimiter.decimal`
 *     the `.` of `1.5`. Both grammars split them off the number; Hexagon's paints its
 *     bigint and float literals whole, so these rejoin the literal.
 *   - `constant.language.import-export-all` is the `*` of `export * from`, which is
 *     import syntax rather than the constant its scope name files it under.
 * Two entries are not overrides of anything above them. They are here to hold the
 * inherited `vs-dark` theme off scopes it would otherwise claim, and they are the two
 * ways that can happen:
 *
 *   - `variable.parameter` restates `variable` a segment deeper, because `vs-dark` has
 *     a rule at that exact depth and a base rule outranks a shorter rule of ours.
 *   - `meta.tag` ties with `vs-dark`'s rule of the same name rather than out-ranking
 *     it, and wins on order: the base's rules go in first, ours after.
 *
 * Only `vs-dark` carries either, so a leak from either is invisible in light mode.
 */
export const generatedFamilies: Readonly<Record<string, HexagonFamily>> = {
  "Generated literal data": {
    palette: "literal",
    scopes: [
      "constant",
      "string",
      "support.constant",
      "storage.type.numeric.bigint",
      "meta.delimiter.decimal",
    ],
  },
  "Generated commentary": {
    palette: "commentary",
    scopes: [
      "comment",
      "punctuation.definition.comment",
      "punctuation.whitespace.comment",
      // The emitter translates a source comment into JavaScript's spelling
      // (spec/comments.md §6), so a Hexagon `(** … *)` arrives in the generated pane
      // as a JavaScript doc comment, and VS Code's grammar reads the JSDoc inside
      // it: `@param` is a storage type,
      // `{Vector}` a type name, the `@` and the braces punctuation. Hexagon's own
      // grammar has no such notion and paints the whole comment one colour, so
      // untranslated these render the same text as three colours here and one there.
      //
      // Every one is spelled out. `.jsdoc` is a suffix and Monaco matches on leading
      // segments, so no prefix reaches them; they are also each deeper than the family
      // rule that would otherwise claim them, which is what puts them here instead.
      "constant.language.access-type.jsdoc",
      "constant.language.symbol-type.jsdoc",
      "constant.other.description.jsdoc",
      "constant.other.email.link.underline.jsdoc",
      "entity.name.tag.inline.jsdoc",
      "entity.name.type.instance.jsdoc",
      "invalid.illegal.syntax.jsdoc",
      "keyword.operator.assignment.jsdoc",
      "keyword.operator.control.jsdoc",
      "meta.example.jsdoc",
      "punctuation.definition.block.tag.jsdoc",
      "punctuation.definition.bracket.angle.begin.jsdoc",
      "punctuation.definition.bracket.angle.end.jsdoc",
      "punctuation.definition.bracket.curly.begin.jsdoc",
      "punctuation.definition.bracket.curly.end.jsdoc",
      "punctuation.definition.bracket.square.begin.jsdoc",
      "punctuation.definition.bracket.square.end.jsdoc",
      "punctuation.definition.inline.tag.jsdoc",
      "punctuation.definition.optional-value.begin.bracket.square.jsdoc",
      "punctuation.definition.optional-value.end.bracket.square.jsdoc",
      "punctuation.definition.string.begin.jsdoc",
      "punctuation.definition.string.end.jsdoc",
      "punctuation.separator.pipe.jsdoc",
      "storage.type.class.jsdoc",
      "variable.other.description.jsdoc",
      "variable.other.jsdoc",
      "variable.other.link.underline.jsdoc",
    ],
  },
  "Generated ordinary terms and symbolic operators": {
    palette: "ordinary",
    scopes: [
      "keyword.operator",
      "storage.type.function.arrow",
      "variable",
      "variable.parameter",
      "support.variable",
      "entity.name.label",
      "entity.other.attribute-name",
      "meta.tag",
    ],
  },
  "Generated structural vocabulary": {
    palette: "structural",
    scopes: [
      "keyword.control",
      "keyword.generator",
      "keyword.other",
      "keyword.operator.expression",
      "keyword.operator.new",
      "keyword.operator.type.asserts",
      "keyword.operator.type.modifier",
      "storage",
      "constant.language.import-export-all",
    ],
  },
  "Generated nominal names": {
    palette: "nominal",
    scopes: [
      "entity.name.type",
      "entity.name.tag",
      "entity.other.inherited-class",
      "support.class",
      "support.type",
    ],
  },
  "Generated callable names": {
    palette: "callable",
    scopes: ["entity.name.function"],
  },
  "Generated lexical errors": {
    palette: "error",
    scopes: ["invalid"],
  },
};

/**
 * Monaco resolves a rule by walking the token string's dot-separated segments, so a
 * rule matches a scope and everything more specific than it. Every Hexagon scope is
 * therefore listed outright rather than abbreviated to a shared prefix. A rule for
 * `entity.name.type` would be inherited by `entity.name.type.parameter.hexagon`, which
 * belongs to the nominal family, *and* by `entity.name.type.constraint.hexagon`, which
 * does not — one rule, two families, and the more specific one loses.
 *
 * Two fully-spelled scopes cannot shadow each other, because both end `.hexagon` and
 * neither is then a dotted prefix of the other. Spelling them out is also what makes
 * them immune to the prefix rules above, which is the property the generated panes are
 * built on: a Hexagon token is claimed by the deeper, Hexagon-specific rule every time.
 */
const rulesFor = (palette: HexagonPalette): monaco.editor.ITokenThemeRule[] =>
  [...Object.values(generatedFamilies), ...Object.values(hexagonFamilies)].flatMap(
    (family) =>
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
