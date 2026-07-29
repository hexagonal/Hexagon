import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// @ts-expect-error Internal Monaco modules intentionally have no declaration files.
import { TokenMetadata } from "monaco-editor/esm/vs/editor/common/encodedTokenAttributes.js";
// @ts-expect-error Internal Monaco modules intentionally have no declaration files.
import { TokenTheme } from "monaco-editor/esm/vs/editor/common/languages/supports/tokenization.js";
// @ts-expect-error Internal Monaco modules intentionally have no declaration files.
import { vs, vs_dark } from "monaco-editor/esm/vs/editor/standalone/common/themes.js";

import hexagonGrammarSource from "../../editors/vscode/syntaxes/hexagon.tmLanguage.json?raw";
import javascriptGrammarSource from "tm-grammars/grammars/javascript.json?raw";
import typescriptGrammarSource from "tm-grammars/grammars/typescript.json?raw";
import playgroundModuleGrammarSource from "./playground-module.tmLanguage.json?raw";
import {
  darkPalette,
  generatedFamilies,
  hexagonDarkThemeData,
  hexagonFamilies,
  hexagonLightThemeData,
  lightPalette,
  type HexagonPalette,
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
 * The scopes a grammar can put on a token, gathered from every `name` and `contentName`
 * it spells. Reading the grammar rather than a corpus means a rule that no example
 * happens to exercise is still covered.
 *
 * A grammar's own `name` is its identifier rather than a scope, so only dotted values
 * count; a `name` may also list several scopes at once, which VS Code's JavaScript
 * grammar does and Hexagon's does not.
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
      if ((key === "name" || key === "contentName") && typeof value === "string") {
        for (const scope of value.split(/\s+/)) if (scope.includes(".")) scopes.add(scope);
      } else if (key !== "name" && key !== "contentName") {
        walk(value);
      }
    }
  };
  walk(JSON.parse(source));
  return scopes;
}

/**
 * The generated-pane counterpart of `inheritsEditorForeground`: scope families the
 * theme deliberately leaves to the editor foreground, which is the ordinary colour.
 *
 * Prefixes here, because unlike the Hexagon list these cover hundreds of scopes that
 * are structural rather than lexical — `meta.*` marks a region, not a token, and only
 * ever surfaces as a token's innermost scope on layout whitespace. `punctuation` is the
 * same decision the Hexagon side makes one scope at a time: a brace is not the thing it
 * encloses. A `.jsdoc` punctuation scope is the exception and is claimed by the
 * commentary family, which out-ranks this list by being a rule rather than an absence.
 */
const fallsThroughToForeground = [
  "meta",
  "punctuation",
  "source.embedded",
  // The JavaScript grammar's names for expression regions, which follow no convention
  // and are listed one by one so a new one has to be looked at.
  "case-clause.expr",
  "cast.expr",
  "new.expr",
  "switch-block.expr",
  "switch-expression.expr",
  "switch-statement.expr",
];

const hexagonScopes = (): string[] => [
  ...grammarScopes(hexagonGrammarSource),
  ...grammarScopes(playgroundModuleGrammarSource),
];

const generatedScopes = (): string[] => [
  ...new Set([
    ...grammarScopes(javascriptGrammarSource),
    ...grammarScopes(typescriptGrammarSource),
  ]),
];

/**
 * The theme as Monaco actually builds it: `inherit: true` means the base theme's rules
 * go in first and ours after, and `editor.foreground` becomes the empty-token default.
 * Nothing shorter reproduces the two ways a rule can be reached — a base rule deeper
 * than ours wins on specificity, and a base rule at our depth loses on order — and both
 * are live here, because these families are keyed by prefix.
 *
 * Mirrors `StandaloneTheme.tokenTheme` in `standaloneThemeService.js`.
 */
function composedTheme(
  themeData: typeof hexagonLightThemeData,
  base: { rules: Array<{ token: string; foreground?: string }> },
  // Substituted for `editor.foreground` so a scope that reached no rule at all is
  // distinguishable from one a rule painted. They are the same colour in the real
  // theme, by design — `ordinary` *is* the foreground — which is exactly what makes a
  // scope nobody claimed indistinguishable from a scope claimed correctly.
  foreground?: string,
): { colourOf: (scope: string) => string; idOf: (scope: string) => number } {
  const rules = [
    ...base.rules,
    { token: "", foreground: foreground ?? themeData.colors?.["editor.foreground"] },
    ...themeData.rules,
  ].flatMap((rule) =>
    rule.foreground === undefined ? [] : [{ token: rule.token, foreground: rule.foreground }],
  );
  const theme = TokenTheme.createFromRawTokenTheme(rules, []);
  const idOf = (scope: string): number =>
    TokenMetadata.getForeground(theme.match(0, scope)) as number;
  return {
    idOf,
    colourOf: (scope) => theme.getColorMap()[idOf(scope)]?.toString().toLowerCase(),
  };
}

const themes = [
  ["light", hexagonLightThemeData, vs, lightPalette],
  ["dark", hexagonDarkThemeData, vs_dark, darkPalette],
] as Array<
  [string, typeof hexagonLightThemeData, { rules: [] }, HexagonPalette]
>;

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

test("paints every scope the Hexagon grammars can emit, or knowingly leaves it inherited", () => {
  const themed = new Set(Object.values(hexagonFamilies).flatMap((family) => family.scopes));
  const unaccounted = hexagonScopes().filter(
    (scope) => !themed.has(scope) && !inheritsEditorForeground.includes(scope),
  );
  expect(unaccounted.toSorted()).toEqual([]);
});

test("themes and exempts only scopes the Hexagon grammars really emit", () => {
  // The inverse of the test above, and the reason it is here: a scope deleted from the
  // grammar would otherwise linger indefinitely in both this file and
  // `.vscode/settings.json`, painting nothing and looking load-bearing.
  const emitted = new Set(hexagonScopes());
  const stale = [
    ...Object.values(hexagonFamilies).flatMap((family) => family.scopes),
    ...inheritsEditorForeground,
  ].filter((scope) => !emitted.has(scope));
  expect(stale.toSorted()).toEqual([]);
});

test("claims only prefixes VS Code's JavaScript and TypeScript grammars really use", () => {
  // The same staleness guard for the generated panes. A prefix is legitimate as long as
  // some scope sits at or beneath it, so this catches a rule left behind by a
  // `tm-grammars` bump — including one written for a scope that never existed.
  const emitted = generatedScopes();
  const unused = Object.values(generatedFamilies)
    .flatMap((family) => family.scopes)
    .filter((prefix) => !emitted.some((scope) => scope === prefix || scope.startsWith(`${prefix}.`)));
  expect(unused.toSorted()).toEqual([]);
});

describe("theme data", () => {
  test("carries both tables, and every Hexagon rule names a Hexagon scope", () => {
    // The Hexagon half stays fully spelled — that is what makes it out-rank the prefix
    // half rather than merely be declared after it. The generated half is the inverse:
    // no prefix may end `.hexagon`, or it would be claiming Hexagon scopes.
    const hexagon = Object.values(hexagonFamilies).flatMap((family) => family.scopes);
    const generated = Object.values(generatedFamilies).flatMap((family) => family.scopes);
    expect(hexagon.every((scope) => scope.endsWith(".hexagon"))).toBe(true);
    expect(generated.every((prefix) => !prefix.endsWith(".hexagon"))).toBe(true);
    for (const data of [hexagonLightThemeData, hexagonDarkThemeData]) {
      expect(data.rules.map((rule) => rule.token).toSorted()).toEqual(
        [...generated, ...hexagon].toSorted(),
      );
    }
  });

  test.each(themes)(
    "%s resolves every Hexagon scope to its own family through Monaco's own matcher",
    (_label, themeData, base, palette) => {
      // The rules are only correct if Monaco agrees, and Monaco resolves them through a
      // dot-segment trie rather than by string equality: a rule is inherited by every
      // scope beneath it, so an abbreviated rule can hand one family another's colour.
      // Nothing short of building the real theme catches that, so this builds it.
      //
      // Since the generated panes joined this theme that is no longer a formality. Their
      // families are keyed by prefix, and `variable`, `comment`, `constant`, `string` and
      // `keyword.control` all sit above scopes on this list. Every one is out-ranked
      // here only because the Hexagon side spells its scopes in full.
      const { colourOf } = composedTheme(themeData, base);
      for (const [name, family] of Object.entries(hexagonFamilies)) {
        for (const scope of family.scopes) {
          expect(`${scope} in ${name} -> ${colourOf(scope)}`).toBe(
            // Monaco normalizes a colour's case on the way in.
            `${scope} in ${name} -> ${palette[family.palette].toLowerCase()}`,
          );
        }
      }
    },
  );

  test.each(themes)(
    "%s leaves the Hexagon scopes it does not claim on the editor foreground",
    (_label, themeData, base, palette) => {
      // These land on the editor foreground, which is the ordinary family's colour, so
      // an exempt bracket and a scoped term render alike.
      //
      // That shared colour is also why this cannot tell "no rule matched" from "a rule
      // matched and it was an ordinary one" — Monaco's colour map dedupes by hex, so
      // both come back as id 1. The structural test below is what holds a generated
      // prefix off these scopes; this one holds the colour.
      const { colourOf } = composedTheme(themeData, base);
      for (const scope of [...inheritsEditorForeground, "source.hexagon"]) {
        expect(`${scope} -> ${colourOf(scope)}`).toBe(
          `${scope} -> ${palette.ordinary.toLowerCase()}`,
        );
      }
    },
  );

  test("no generated prefix out-ranks a Hexagon rule or reaches an exempt Hexagon scope", () => {
    // The whole basis for mixing prefix rules and spelled rules in one theme, asserted
    // on the tables rather than on the colours they produce — because the two halves
    // share a palette, a prefix that wrongly claimed an ordinary Hexagon scope would
    // hand it the colour it already had and no comparison of colours would notice.
    //
    // Monaco takes the deepest matching rule, and the later one where two tie. Ties
    // cannot arise: a tie needs a generated prefix ending `.hexagon`, which the theme
    // data test rules out. So depth alone decides, and every Hexagon scope must have a
    // Hexagon rule deeper than any prefix reaching it — or no prefix reaching it at all,
    // which is what the exempt scopes need, having no rule of their own to win with.
    const claims = (rule: string, scope: string): boolean =>
      scope === rule || scope.startsWith(`${rule}.`);
    const depth = (token: string): number => token.split(".").length;
    const generated = Object.values(generatedFamilies).flatMap((family) => family.scopes);
    const spelled = Object.values(hexagonFamilies).flatMap((family) => family.scopes);

    const misclaimed = hexagonScopes().flatMap((scope) => {
      const reaching = generated.filter((prefix) => claims(prefix, scope));
      if (reaching.length === 0) return [];
      const own = spelled.filter((rule) => claims(rule, scope));
      const deepestOwn = own.length === 0 ? 0 : Math.max(...own.map(depth));
      return Math.max(...reaching.map(depth)) < deepestOwn
        ? []
        : [`${scope} <- ${reaching.toSorted().join(", ")}`];
    });
    expect(misclaimed.toSorted()).toEqual([]);
  });

  test.each(themes)(
    "%s claims every scope the generated panes can emit, or knowingly falls through",
    (_label, themeData, base, palette) => {
      // Two failures at once, because a scope has two ways to come out wrong here.
      //
      // It can leak: the base theme this inherits from has its own rules for `keyword`,
      // `string`, `comment`, `constant` and `variable` — written for Monarch token
      // names, but dotted, so they match TextMate scopes just as happily. An unclaimed
      // scope does not fall to the editor foreground, it falls to VS Code's default
      // colours, and the pane ends up in two palettes at once. `variable.parameter` is
      // why this runs over both themes: only `vs-dark` carries a rule at that depth, so
      // the leak it caused was invisible in light mode.
      //
      // Or it can simply go unclaimed, which is the quieter failure and the reason for
      // the sentinel. `ordinary` and the editor foreground are the same colour, so a
      // scope no family names still *looks* right; that is how a whole doc comment's
      // worth of JSDoc scopes sat in the wrong families behind a passing test.
      const sentinel = "#ff00ff";
      const { colourOf } = composedTheme(themeData, base, sentinel);
      const claimed = new Set(
        Object.entries(palette).flatMap(([key, colour]) =>
          key === "background" ? [] : [colour.toLowerCase()],
        ),
      );
      const unaccounted = generatedScopes().flatMap((scope) => {
        const colour = colourOf(scope);
        if (claimed.has(colour)) return [];
        if (colour !== sentinel) return [`${scope} -> leaked to ${colour}`];
        const exempt = fallsThroughToForeground.some(
          (prefix) => scope === prefix || scope.startsWith(`${prefix}.`),
        );
        return exempt ? [] : [`${scope} -> claimed by nothing`];
      });
      expect(unaccounted.toSorted()).toEqual([]);
    },
  );

  test.each(themes)(
    "%s paints everything inside a doc comment as commentary",
    (_label, themeData, base, palette) => {
      // The invariant the JSDoc scopes are in the commentary family for, stated where a
      // reader will find it: a `.jsdoc` scope occurs only inside
      // `comment.block.documentation`, so whatever the grammar names it after, it is
      // comment text and Hexagon paints comment text one colour.
      //
      // This has to be its own assertion. The sentinel test above cannot see it — every
      // one of these does resolve to a palette colour and half of them match an exempt
      // prefix — and "resolves to some colour" was never going to catch a scope in the
      // wrong family. Only naming the expected family does.
      const { colourOf } = composedTheme(themeData, base);
      const jsdoc = generatedScopes().filter((scope) => scope.endsWith(".jsdoc"));
      expect(jsdoc.length).toBeGreaterThan(20);
      const miscoloured = jsdoc.flatMap((scope) =>
        colourOf(scope) === palette.commentary.toLowerCase()
          ? []
          : [`${scope} -> ${colourOf(scope)}`],
      );
      expect(miscoloured.toSorted()).toEqual([]);
    },
  );

  test.each(themes)(
    "%s resolves each generated family's own prefixes to that family",
    (_label, themeData, base, palette) => {
      // Overrides make the order these are declared in irrelevant and the depth
      // decisive: `keyword.operator` is ordinary but `keyword.operator.expression` is
      // structural, `storage` is structural but `storage.type.function.arrow` is not.
      const { colourOf } = composedTheme(themeData, base);
      for (const [name, family] of Object.entries(generatedFamilies)) {
        for (const scope of family.scopes) {
          expect(`${scope} in ${name} -> ${colourOf(scope)}`).toBe(
            `${scope} in ${name} -> ${palette[family.palette].toLowerCase()}`,
          );
        }
      }
    },
  );

  test.each(themes)(
    "%s gives the generated panes the families a Hexagon reading of them wants",
    (_label, themeData, base, palette) => {
      // Spot checks at the level the prefixes are actually chosen at: real scopes, from
      // the emitter's real output, whose family is a judgement rather than a rewrite of
      // the scope name. See `generatedFamilies` for why each of these lands where it
      // does.
      const { colourOf } = composedTheme(themeData, base);
      const expected: Record<string, keyof HexagonPalette> = {
        "entity.name.function.js": "callable",
        "entity.name.type.alias.ts": "nominal",
        "support.type.primitive.ts": "nominal",
        "variable.other.readwrite.js": "ordinary",
        "variable.parameter.js": "ordinary",
        "variable.other.constant.js": "ordinary",
        "meta.object-literal.key.js": "ordinary",
        "keyword.control.flow.js": "structural",
        "storage.type.js": "structural",
        "storage.modifier.ts": "structural",
        "keyword.operator.expression.typeof.js": "structural",
        "constant.language.import-export-all.js": "structural",
        "keyword.operator.arithmetic.js": "ordinary",
        "storage.type.function.arrow.js": "ordinary",
        "keyword.operator.type.annotation.ts": "ordinary",
        "constant.numeric.decimal.js": "literal",
        "storage.type.numeric.bigint.js": "literal",
        "meta.delimiter.decimal.period.js": "literal",
        "string.quoted.double.js": "literal",
        "constant.language.boolean.true.js": "literal",
        "comment.line.double-slash.js": "commentary",
        "punctuation.definition.comment.js": "commentary",
        // Quotes and separators are literal *punctuation*, which the Hexagon side files
        // under the ordinary colour rather than the literal one.
        "punctuation.definition.string.begin.js": "ordinary",
        "punctuation.terminator.statement.js": "ordinary",
        "punctuation.accessor.js": "ordinary",
        "invalid.illegal.newline.js": "error",
      };
      for (const [scope, family] of Object.entries(expected)) {
        expect(`${scope} -> ${colourOf(scope)}`).toBe(
          `${scope} -> ${palette[family].toLowerCase()}`,
        );
      }
    },
  );

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
