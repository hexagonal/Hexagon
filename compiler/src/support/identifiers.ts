/**
 * `spec/lexer.md` §3's identifier, as patterns the queries can share.
 *
 * The lexer produces identifiers; these recognize them after the fact, which
 * source queries need in the two places a tree cannot help. One is narrowing a
 * span that covers more than its name (`M.Box(Int)`); the other is reading the
 * text a user has half-typed, where there is no tree yet at all.
 *
 * Spelled once, here, because the failure mode of a second copy is quiet.
 * `[A-Za-z_$]\w*` looks like this pattern and is not: an ASCII-start name with a
 * non-ASCII tail matches it *partially*, so `TRésultat` comes back as `TR` and
 * the "no identifier here" fallback never fires. A pattern that fails outright
 * is safe; one that half-succeeds is the one that ships.
 */

import { titlecase, uppercase } from "../passes/lexer/unicode-17.js";

export const IDENTIFIER_START = "[\\p{ID_Start}$_]";
export const IDENTIFIER_CONTINUE = "[\\p{ID_Continue}$_\\u200C\\u200D]";

/** A whole identifier and nothing else. */
export const IDENTIFIER = new RegExp(
  `^${IDENTIFIER_START}${IDENTIFIER_CONTINUE}*$`,
  "u",
);

const ONE_START = new RegExp(`^${IDENTIFIER_START}$`, "u");
const ONE_CONTINUE = new RegExp(`^${IDENTIFIER_CONTINUE}$`, "u");

export function isIdentifierStart(character: string): boolean {
  return ONE_START.test(character);
}

export function isIdentifierContinue(character: string): boolean {
  return ONE_CONTINUE.test(character);
}

/**
 * Lexer §3.1's `UpperName` start, over the lexer's **own** tables.
 *
 * `uppercase` and `titlecase` are the generated Unicode 17.0.0 tables the lexer
 * scans names with, imported rather than restated: §3.1 requires the compiler to
 * ship these tables and not inherit a host's Unicode version, and a second
 * spelling of the class is a second answer to "does this name begin uppercase"
 * that drifts a release at a time. `[A-Z]` is the copy that has already been
 * written twice and is wrong in the same quiet way the header above describes —
 * it agrees with the lexer on `Acme` and disagrees on `Résultat`.
 *
 * The class is `Uppercase = Yes` **or** `General_Category = Lt`, both halves,
 * because that is the whole of §3.1's rule: `ǅurđević` is an `UpperName` though
 * `ǅ` has `Uppercase = No`.
 *
 * The tables are surrogate-pair alternations and must be composed **without**
 * the `u` flag, which is why this is anchored by composition rather than shared
 * with `IDENTIFIER`'s `\p{…}` fragments — those are embedded into `u`-flagged
 * patterns by the query seats and the two cannot be one regex.
 */
const UPPER_NAME_START = new RegExp(`^(?:${uppercase.source}|${titlecase.source})$`);

/**
 * The first code point of `text`, or `undefined` where `text` is empty.
 *
 * Where the first character is astral, `text[0]` and `charAt(0)` answer with
 * half a surrogate pair, and half a pair has no Unicode property worth testing:
 * `𝐀bc` comes back as not uppercase-start, and upper-casing that half rebuilds
 * the name unchanged rather than raising its first letter.
 */
export function firstCodePoint(text: string): string | undefined {
  const codePoint = text.codePointAt(0);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

/** Whether `text` begins with an `UpperName`'s first codepoint (Lexer §3.1). */
export function beginsUpperName(text: string): boolean {
  const first = firstCodePoint(text);
  return first !== undefined && UPPER_NAME_START.test(first);
}

/** Whether `text` is a whole `UpperName` and nothing else (Lexer §3.1). */
export function isUpperName(text: string): boolean {
  return IDENTIFIER.test(text) && beginsUpperName(text);
}

/**
 * The code point ending at `at`, with where it starts.
 *
 * Reading backwards a UTF-16 code unit at a time would split a surrogate pair
 * and test half a character against a Unicode property, which answers `false`
 * for every astral identifier — a name in a script outside the basic plane would
 * silently stop being a name.
 */
export function codePointBefore(
  text: string,
  at: number,
): { readonly character: string; readonly start: number } | undefined {
  if (at <= 0) return undefined;
  const last = text.charCodeAt(at - 1);
  if (last >= 0xdc00 && last <= 0xdfff && at >= 2) {
    const first = text.charCodeAt(at - 2);
    if (first >= 0xd800 && first <= 0xdbff) {
      return { character: text.slice(at - 2, at), start: at - 2 };
    }
  }
  return { character: text.slice(at - 1, at), start: at - 1 };
}

/** Walks back over identifier characters, answering where the name starts. */
export function identifierStartBefore(text: string, at: number): number {
  let start = at;
  for (;;) {
    const previous = codePointBefore(text, start);
    if (previous === undefined || !isIdentifierContinue(previous.character)) return start;
    start = previous.start;
  }
}
