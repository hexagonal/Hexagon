/**
 * Conversion of the compiler's name classifications into the protocol's
 * semantic-token encoding.
 *
 * Semantic tokens do not travel as objects. The protocol sends one flat array of
 * integers, five per token — line delta, start delta, length, type, modifier
 * bits — where each token is positioned *relative to the one before it*. That
 * makes the wire form compact and makes it completely unforgiving: a single
 * token out of order, or one that spans a line break, shifts every token after
 * it and mis-colours the rest of the file. Sorting and the single-line guarantee
 * are the compiler query's, so all that is left here is the arithmetic.
 *
 * The legend is the shared vocabulary: the client is told once, at
 * initialization, what the type and modifier numbers mean, and every later
 * response is read against it. Both lists therefore have to be **the same order
 * every time** — an index, not a name, is what crosses the wire.
 */

import type { SemanticTokens, SemanticTokensLegend } from "vscode-languageserver";
import type { SemanticToken, SemanticTokenType } from "../../compiler/src/index.js";

/**
 * The token types this server can produce, in the order their indices name them.
 * Everything here is one of LSP's standard types, so a theme the user already
 * has colours Hexagon without being taught to.
 */
const TOKEN_TYPES: readonly SemanticTokenType[] = [
  "function",
  "method",
  "variable",
  "parameter",
  "enum",
  "enumMember",
  "struct",
  "type",
  "interface",
];

/** Modifiers, likewise by index. Bit `n` of the fifth number is `MODIFIERS[n]`. */
const TOKEN_MODIFIERS: readonly string[] = ["declaration"];

export const LEGEND: SemanticTokensLegend = {
  tokenTypes: [...TOKEN_TYPES],
  tokenModifiers: [...TOKEN_MODIFIERS],
};

export function encodeSemanticTokens(tokens: readonly SemanticToken[]): SemanticTokens {
  const data: number[] = [];
  let previousLine = 0;
  let previousColumn = 0;
  for (const token of tokens) {
    const type = TOKEN_TYPES.indexOf(token.type);
    // A type the legend does not list has no number to send. Dropping the token
    // keeps the rest of the file correct; sending an out-of-range index would
    // leave the client to guess, and clients differ on whether that is fatal.
    if (type < 0) continue;
    const line = token.span.start.line;
    const column = token.span.start.column;
    const deltaLine = line - previousLine;
    data.push(
      deltaLine,
      deltaLine === 0 ? column - previousColumn : column,
      token.span.end.offset - token.span.start.offset,
      type,
      token.modifiers.reduce((bits, modifier) => {
        const at = TOKEN_MODIFIERS.indexOf(modifier);
        return at < 0 ? bits : bits | (1 << at);
      }, 0),
    );
    previousLine = line;
    previousColumn = column;
  }
  return { data };
}
