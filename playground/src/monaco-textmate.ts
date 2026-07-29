/**
 * Playground's tokenizer: the VS Code extension's own TextMate grammar, run through
 * the engine VS Code runs it with (vscode-textmate over Oniguruma) and bridged into
 * Monaco.
 *
 * There used to be a second, hand-written Monarch grammar here (#161). One language
 * with two grammars meant every token-inventory change had to be made twice and
 * silently wasn't (#145). Monaco's native format is Monarch, but nothing obliges a
 * caller to use it: `setTokensProvider` takes any tokenizer that can label a line and
 * hand back a state, which is exactly what `IGrammar.tokenizeLine` does.
 *
 * TextMate is still a regex approximation — spec/lexer.md §8.1 makes `<` one token in
 * a binder and in a comparison, and §4.2's contextual keywords are keywords only by
 * position — so this does not make Playground right. It makes both editors wrong in
 * the same way, in one file. The layer that cannot be wrong is semantic tokens from
 * the compiler, which belongs to `language-server/` and is not started.
 */

import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import {
  INITIAL,
  parseRawGrammar,
  Registry,
  type IGrammar,
  type IOnigLib,
  type StateStack,
} from "vscode-textmate";

import hexagonGrammarSource from "../../editors/vscode/syntaxes/hexagon.tmLanguage.json?raw";
import playgroundModuleGrammarSource from "./playground-module.tmLanguage.json?raw";

export const hexagonLanguage = "hexagon";
export const hexagonScopeName = "source.hexagon";
export const playgroundModuleScopeName = "source.hexagon.playground";

/**
 * The grammar is imported from `editors/vscode` rather than copied, so there is one
 * file and no room for the two editors to disagree about what a token is. Vite inlines
 * it at build time; Playground ships no second copy.
 */
const grammarSources: Readonly<Record<string, string>> = {
  [hexagonScopeName]: hexagonGrammarSource,
  [playgroundModuleScopeName]: playgroundModuleGrammarSource,
};

export function createHexagonRegistry(onigLib: Promise<IOnigLib>): Registry {
  return new Registry({
    onigLib,
    loadGrammar: async (scopeName) => {
      const source = grammarSources[scopeName];
      // `parseRawGrammar` picks JSON over PLIST from the path's extension.
      return source === undefined ? null : parseRawGrammar(source, `${scopeName}.json`);
    },
    getInjections: (scopeName) =>
      scopeName === hexagonScopeName ? [playgroundModuleScopeName] : undefined,
  });
}

export async function loadHexagonGrammar(onigLib: Promise<IOnigLib>): Promise<IGrammar> {
  const grammar = await createHexagonRegistry(onigLib).loadGrammar(hexagonScopeName);
  if (grammar === null) throw new Error(`grammar ${hexagonScopeName} failed to load`);
  return grammar;
}

/**
 * Monaco resolves a theme rule by walking the token string's dot-separated segments,
 * so handing it the innermost TextMate scope verbatim turns `monaco-theme.ts`'s rules
 * into the same scope selectors `.vscode/settings.json` spells. Innermost-last is also
 * what `editors/vscode/src/grammar.test.ts` asserts, so a token that both editors see
 * resolves through one name in both.
 *
 * A token no rule claims — layout whitespace, an unrecognized character — carries only
 * `source.hexagon`, which no rule matches, so it lands on the editor foreground.
 *
 * `tokenizeLine` takes an optional per-line time budget, and this deliberately does not
 * pass one. Exceeding it does not report an error: it returns the tokens it managed and
 * a rule stack for a line it did not finish, so the line is silently mispainted and the
 * next one inherits the wrong state. A budget small enough to bound a pathological line
 * is also small enough to be tripped by the first call, which pays for compiling every
 * scanner in the grammar. Monaco already refuses to tokenize past
 * `maxTokenizationLineLength`, which is the guard the Monarch tokenizer ran under too.
 */
export function createHexagonTokensProvider(
  grammar: IGrammar,
): monaco.languages.TokensProvider {
  return {
    getInitialState: () => INITIAL as monaco.languages.IState,
    tokenize: (line, state) => {
      const result = grammar.tokenizeLine(line, state as unknown as StateStack);
      return {
        tokens: result.tokens.map((token) => ({
          startIndex: token.startIndex,
          scopes: token.scopes.at(-1) ?? hexagonScopeName,
        })),
        endState: result.ruleStack as monaco.languages.IState,
      };
    },
  };
}
