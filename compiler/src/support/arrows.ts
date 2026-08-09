/**
 * How a function type's arrow is *displayed* (`spec/effects.md` §10, #364).
 *
 * Three renderers answer this question — the hover/`.d.ts` type printer, the
 * source writer, and the checker's diagnostic printer — over three different
 * representations of a type. What they must agree on is the text, so the text
 * lives here and nowhere else.
 *
 * The ruling display obeys:
 *
 * - a pure constant arrow is `->`, an impure constant `=>!`, a variable colour
 *   `=>` (§2.1–§2.3). Both constants always round-trip and are never numbered;
 * - the **undecorated `=>` is reserved for the faces whose write-back preserves
 *   meaning**, and that is a narrower set than "one variable". It takes exactly
 *   one distinct effect variable *and* at least one **inlet** occurrence of it —
 *   a parameter-position arrow — because those are the two things §2.2's linked
 *   reading needs to reproduce the displayed scheme: the grammar links every
 *   written `=>` into one variable, and the else-constant rule turns an
 *   inlet-less one into the impure constant;
 * - **everything else carrying variables is numbered** by first appearance,
 *   left to right: `=>¹`, `=>²`. That is every multi-variable face, and also a
 *   *lone* variable with no inlet — `(() -> String) =>¹ Int`, whose undecorated
 *   spelling would be read back as the impure constant and silently mean
 *   something else.
 *
 * The decorated spelling is **display-only**. It is not grammar and does not
 * lex — a pasted `=>¹` fails in the lexer, which is the point: a face that
 * cannot be written back fails loudly instead of silently relinking.
 */

/** The pure constant. */
export const PURE_ARROW = "->";

/** The impure constant (`spec/effects.md` §2.3). */
export const IMPURE_ARROW = "=>!";

/**
 * A variable colour's arrow: plain when the face writes back unchanged, and
 * carrying its display-only index when it does not.
 *
 * `index` is 1-based and is the variable's position in order of first
 * appearance across the whole displayed type expression.
 */
export function linkedArrow(index?: number): string {
  return index === undefined ? "=>" : `=>${superscript(index)}`;
}

const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** A non-negative integer in superscript digits — `12` becomes `¹²`. */
export function superscript(value: number): string {
  return [...String(value)].map((digit) => SUPERSCRIPT_DIGITS[Number(digit)] ?? digit).join("");
}
