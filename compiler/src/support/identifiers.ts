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
