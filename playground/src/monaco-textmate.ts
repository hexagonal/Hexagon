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
 * The generated-code panes go through the same bridge, on VS Code's own JavaScript and
 * TypeScript grammars. They were the last Monarch tokenizers on the page: Monaco ships
 * one for each and registers it from `*.contribution.js`, but Monarch cannot tell a
 * function name from any other identifier, so the callable family had nothing to paint
 * and the panes read as a different language than the source above them. The scope
 * inventory is also what lets `monaco-theme.ts` colour all three panes from one table.
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

export const hexagonLanguage = "hexagon";
export const hexagonScopeName = "source.hexagon";
/** Monaco registers both ids itself, from the `basic-languages` contributions. */
export const javascriptLanguage = "javascript";
export const typescriptLanguage = "typescript";
export const javascriptScopeName = "source.js";
export const typescriptScopeName = "source.ts";

/**
 * The Hexagon grammar is imported from `editors/vscode` rather than copied, so there is
 * one file and no room for the two editors to disagree about what a token is. Vite
 * inlines it at build time; Playground ships no second copy.
 *
 * **One grammar, since #829.** The Playground's `module X` / `end module X`
 * notation and the language's own header are one form now (Modules §2.1), so
 * the injection that used to paint the notation is gone: the shared grammar
 * paints the header as it paints every declaration head, and both editors agree
 * about the line by construction rather than by two rules that nearly match. A
 * `module foo` the Playground still opens a virtual file for paints as ordinary
 * code — the host's own squiggle is what says the name is wrong, which is the
 * report §2.1 owes it.
 *
 * The other two are VS Code's, taken from `tm-grammars` rather than vendored, and they
 * are an order of magnitude larger than Hexagon's. They load through a dynamic import,
 * which splits them out of the entry chunk; `monaco.ts` is what decides they are not
 * fetched at all until a generated pane is first tokenized.
 */
const grammarSources: Readonly<Record<string, () => Promise<string>>> = {
  [hexagonScopeName]: async () => hexagonGrammarSource,
  [javascriptScopeName]: async () =>
    (await import("tm-grammars/grammars/javascript.json?raw")).default,
  [typescriptScopeName]: async () =>
    (await import("tm-grammars/grammars/typescript.json?raw")).default,
};

/**
 * Monaco's default `editor.maxTokenizationLineLength`. `MonarchTokenizer` reads that
 * setting and returns a single unscoped token for any line at or over it; the adapter
 * behind `setTokensProvider` does no such thing, so a provider that wants the bound has
 * to apply it itself. Without it a pasted megabyte-long line blocks the main thread for
 * seconds — a protection the Monarch tokenizer had and this must not quietly drop.
 */
const maxTokenizedLineLength = 20_000;

/**
 * One registry over all three grammars, so the Oniguruma library is handed over once and
 * a grammar is compiled once however many panes ask for it. Nothing is read until a
 * `load` call names a scope, which is what keeps the two large grammars off the entry
 * chunk.
 */
export function createGrammarLoader(
  onigLib: Promise<IOnigLib>,
): (scopeName: string) => Promise<IGrammar> {
  const registry = new Registry({
    onigLib,
    loadGrammar: async (scopeName) => {
      const source = grammarSources[scopeName];
      // `parseRawGrammar` picks JSON over PLIST from the path's extension.
      return source === undefined ? null : parseRawGrammar(await source(), `${scopeName}.json`);
    },
  });
  return async (scopeName) => {
    const grammar = await registry.loadGrammar(scopeName);
    if (grammar === null) throw new Error(`grammar ${scopeName} failed to load`);
    return grammar;
  };
}

/**
 * Monaco resolves a theme rule by walking the token string's dot-separated segments,
 * so handing it the innermost TextMate scope verbatim turns `monaco-theme.ts`'s rules
 * into the same scope selectors `.vscode/settings.json` spells. Innermost-last is also
 * what `editors/vscode/src/grammar.test.ts` asserts, so a token that both editors see
 * resolves through one name in both.
 *
 * A token no rule claims — layout whitespace, an unrecognized character — carries only
 * the grammar's root scope, which no rule matches, so it lands on the editor foreground.
 * That is why the root scope is what a skipped line is labelled with too, and why it is
 * passed in rather than assumed: `source.js` has to be inert for the same reason
 * `source.hexagon` does.
 *
 * A long line is skipped rather than tokenized, mirroring what `MonarchTokenizer` does
 * and preserving the incoming state so the line is a no-op rather than a state reset.
 *
 * `tokenizeLine` also takes an optional per-line *time* budget, and this deliberately
 * does not pass one. Exceeding it does not report an error: it returns the tokens it
 * managed plus a rule stack for a line it never finished, so the line is silently
 * mispainted and every line after it inherits the wrong state. A budget small enough to
 * bound a pathological line is also small enough to be tripped by the first call, which
 * pays for compiling every scanner in the grammar. Length is the honest bound here.
 */
export function createTokensProvider(
  scopeName: string,
  grammar: IGrammar,
): monaco.languages.TokensProvider {
  return {
    getInitialState: () => INITIAL as monaco.languages.IState,
    tokenize: (line, state) => {
      if (line.length >= maxTokenizedLineLength) {
        return { tokens: [{ startIndex: 0, scopes: scopeName }], endState: state };
      }
      const result = grammar.tokenizeLine(line, state as unknown as StateStack);
      return {
        tokens: result.tokens.map((token) => ({
          startIndex: token.startIndex,
          // vscode-textmate always carries the root scope, so `scopes` is never empty.
          scopes: token.scopes[token.scopes.length - 1]!,
        })),
        endState: result.ruleStack as monaco.languages.IState,
      };
    },
  };
}
