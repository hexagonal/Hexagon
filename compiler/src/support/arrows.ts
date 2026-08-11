/**
 * How a function type's arrow is *displayed* (`spec/effects.md` §10, #364;
 * respelled #405).
 *
 * Three renderers answer this question — the hover/`.d.ts` type printer, the
 * source writer, and the checker's diagnostic printer — over three different
 * representations of a type. What they must agree on is the text, so the text
 * lives here and nowhere else.
 *
 * The ruling display obeys:
 *
 * - one arrow, three marks: `->` pure, `->?` a variable colour, `->!` the
 *   impure constant (§2.1–§2.3) — the call trichotomy's own marks. Both
 *   constants always round-trip and are never numbered;
 * - a face with **exactly one** distinct effect variable displays it
 *   undecorated, `->?`, wherever it stands. That is what the grammar spells,
 *   since a written signature links every `->?` into one variable (§2.2);
 * - a face with **more than one** — which inference produces and the grammar
 *   cannot express — numbers them by first appearance, left to right: `->?¹`,
 *   `->?²`.
 *
 * #405 dropped a third case. The predecessor also numbered a *lone* variable
 * with no inlet occurrence, because the else-constant rule read an inlet-less
 * `=>` back as the impure constant and the undecorated spelling would have
 * silently meant something else. With that rule withdrawn the spelling is
 * exactly right about the colour, and a paste into a position that cannot host
 * it is Effects §4.4's error — which explains the problem in a sentence, where
 * a lexer failure only reports one. Numbering marks what the grammar cannot
 * express, not what the checker will refuse.
 *
 * The decorated spelling is **display-only**. It is not grammar and does not
 * lex — a pasted `->?¹` fails in the lexer, which is the point: a face that
 * cannot be written back fails loudly.
 */

/** The pure constant. */
export const PURE_ARROW = "->";

/** The impure constant (`spec/effects.md` §2.3). */
export const IMPURE_ARROW = "->!";

/**
 * A variable colour's arrow: plain when the face writes back unchanged, and
 * carrying its display-only index when it does not.
 *
 * `index` is 1-based and is the variable's position in order of first
 * appearance across the whole displayed type expression.
 */
export function linkedArrow(index?: number): string {
  return index === undefined ? "->?" : `->?${superscript(index)}`;
}

const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** A non-negative integer in superscript digits — `12` becomes `¹²`. */
export function superscript(value: number): string {
  return [...String(value)].map((digit) => SUPERSCRIPT_DIGITS[Number(digit)] ?? digit).join("");
}
