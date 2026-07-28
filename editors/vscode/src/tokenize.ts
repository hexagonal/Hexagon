/**
 * Loads syntaxes/hexagon.tmLanguage.json through the same TextMate engine VS Code
 * uses (vscode-textmate over the Oniguruma WASM build), so a test asserts what the
 * editor would actually paint rather than what a regex looks like it should do.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as vsctm from "vscode-textmate";

const require = createRequire(import.meta.url);

export const scopeName = "source.hexagon";

export const grammarPath = fileURLToPath(
  new URL("../syntaxes/hexagon.tmLanguage.json", import.meta.url),
);

export const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

export interface Tokenized {
  /** The exact source text the token covers. */
  readonly text: string;
  /** Scopes innermost-last, as vscode-textmate reports them. */
  readonly scopes: readonly string[];
  readonly line: number;
  readonly startIndex: number;
}

let registryPromise: Promise<vsctm.Registry> | undefined;

function loadRegistry(): Promise<vsctm.Registry> {
  registryPromise ??= (async () => {
    const oniguruma = require("vscode-oniguruma") as typeof import("vscode-oniguruma");
    const wasm = await readFile(require.resolve("vscode-oniguruma/release/onig.wasm"));
    await oniguruma.loadWASM(wasm);

    return new vsctm.Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
        createOnigString: (text) => new oniguruma.OnigString(text),
      }),
      loadGrammar: async (requested) => {
        if (requested !== scopeName) return null;
        const raw = await readFile(grammarPath, "utf8");
        return vsctm.parseRawGrammar(raw, grammarPath);
      },
    });
  })();

  return registryPromise;
}

/**
 * Tokenizes `source` line by line, threading the rule stack exactly as an editor
 * does. Every token is returned, including whitespace-only ones — an invisible
 * character painted `invalid` is exactly the kind of thing a caller wants to see,
 * so filtering happens at the call site rather than here.
 *
 * spec/lexer.md §2.1 accepts LF, CRLF, and lone CR as physical line endings, and
 * VS Code hands the grammar a line with its ending already stripped.
 */
export async function tokenize(source: string): Promise<Tokenized[]> {
  const registry = await loadRegistry();
  const grammar = await registry.loadGrammar(scopeName);
  if (grammar === null) throw new Error(`grammar ${scopeName} failed to load`);

  const tokens: Tokenized[] = [];
  let ruleStack = vsctm.INITIAL;

  source.split(/\r\n|\r|\n/).forEach((line, lineIndex) => {
    const result = grammar.tokenizeLine(line, ruleStack);
    for (const token of result.tokens) {
      tokens.push({
        text: line.slice(token.startIndex, token.endIndex),
        scopes: token.scopes,
        line: lineIndex,
        startIndex: token.startIndex,
      });
    }
    ruleStack = result.ruleStack;
  });

  return tokens;
}

/** True when a token is ordinary layout whitespace carrying no scope of its own. */
const isPlainWhitespace = (token: Tokenized) =>
  token.text.trim() === "" && token.scopes.length === 1;

/**
 * The innermost scope carried by the token whose text is exactly `text`.
 * Throws when `text` occurs more than once, so a passing assertion can never be
 * one that silently checked a different occurrence than the one it names.
 */
export async function scopeOf(source: string, text: string): Promise<string | undefined> {
  const found = (await tokenize(source)).filter((token) => token.text === text);
  if (found.length > 1) {
    throw new Error(
      `${JSON.stringify(text)} occurs ${found.length} times; use scopePairs to say which`,
    );
  }
  return found[0]?.scopes.at(-1);
}

/** Every non-whitespace token's text paired with its innermost scope, in source order. */
export async function scopePairs(source: string): Promise<[string, string][]> {
  return (await tokenize(source))
    .filter((token) => !isPlainWhitespace(token))
    .map((token) => [token.text, token.scopes.at(-1) ?? scopeName]);
}
