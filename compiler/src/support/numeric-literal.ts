/**
 * An integer literal's two readings — its separator-free spelling, and its
 * canonical printing.
 *
 * Shared because two passes need the second and would otherwise each write it
 * (#897): the **emitter**, which must not echo the reader's spelling into
 * JavaScript, and the **checker**, whose coverage matrix keys a literal's
 * identity on its value (Pattern Matching §7.2). They are the same rule — what
 * `007` *is* — so they are one function.
 */

/** A numeric literal's spelling with Lexer §5's `_` separators dropped. */
export function cleanDigits(spelling: string): string {
  return spelling.replaceAll("_", "");
}

/**
 * An integer literal, printed canonically.
 *
 * Lexer §5 legalises leading zeroes — "`00`, `01`, and `00.5` have no octal
 * meaning" — and stores the spelling as written. JavaScript does not: `007` is a
 * legacy octal literal, which strict-mode code refuses with a SyntaxError, and
 * every emitted module is strict; `007n` is not even that, but an outright
 * SyntaxError. So every seat that emits an integer literal prints its **value**,
 * and the sign rides along where the spelling carried one (a pattern's signed
 * literal — Pattern Matching §2.5 — is the only seat that does).
 */
export function canonicalIntegerLiteral(decimal: string): string {
  const digits = cleanDigits(decimal);
  const negative = digits.startsWith("-");
  const magnitude = (negative ? digits.slice(1) : digits).replace(/^0+(?=\d)/u, "");
  return `${negative ? "-" : ""}${magnitude}`;
}

/**
 * A `Float` literal, printed so JavaScript reads the value Hexagon lexed.
 *
 * The reader's spelling is kept — `1.00`, `1.0e0` and `10e-1` each emit as
 * written, which is what an expression-side `Float` literal has always done —
 * with one repair, and it is `canonicalIntegerLiteral`'s: Lexer §5 legalises
 * leading zeroes before the point ("`00.5` ha[s] no octal meaning"), and
 * JavaScript refuses `00.5` and `0007.50` outright as SyntaxErrors. So the
 * integer part loses its leading zeroes and nothing else moves.
 */
export function canonicalFloatLiteral(spelling: string): string {
  const digits = cleanDigits(spelling);
  const negative = digits.startsWith("-");
  const magnitude = negative ? digits.slice(1) : digits;
  return `${negative ? "-" : ""}${magnitude.replace(/^0+(?=\d)/u, "")}`;
}
