/**
 * How a function type's arrow is *displayed* (`spec/effects.md` §10).
 *
 * Three renderers answer this question — the hover/`.d.ts` type printer, the
 * source writer, and the checker's diagnostic printer — over three different
 * representations of a type. What they must agree on is the text, so the text
 * lives here and nowhere else.
 *
 * A displayed face is a face the grammar can write: `->` pure, `->!` the impure
 * constant or a callback's colour on the callback's own arrows, and `>->` a
 * colour that depends on the callbacks the signature is handed. No colour is
 * numbered: a finished face depends on all of its callbacks or on none (§2.4).
 */

/** The pure constant. */
export const PURE_ARROW = "->";

/** The impure constant, and a callback's colour on its own arrows (`spec/effects.md` §2.3). */
export const IMPURE_ARROW = "->!";

/** A colour that depends on what the signature is handed (`spec/effects.md` §2.2). */
export const FOLLOWS_ARROW = ">->";
