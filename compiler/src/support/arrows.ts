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

/** The constant that may fail and touches no world (`spec/effects.md` §1). */
export const CARET_ARROW = "->^";

/** The constant that may touch the world and cannot fail (`spec/effects.md` §1). */
export const TILDE_ARROW = "->~";

/** The arrow that marks exactly these colours (`spec/effects.md` §1's alphabet). */
export function markedArrow(world: boolean, fail: boolean): string {
  return world ? fail ? IMPURE_ARROW : TILDE_ARROW : fail ? CARET_ARROW : PURE_ARROW;
}

/** One colour of an arrow as its display reads it: silent, a constant, or following callbacks. */
export type ShownColour = "silent" | "constant" | "follows";

/**
 * The arrow a function type displays for its two colours (`spec/effects.md`
 * §10). On a callback's own arrows and anywhere else inside a parameter type,
 * the arrow marks each colour that is not silent. On a face's spine, colours
 * that follow callbacks show `>->`; a colour that follows beside a constant
 * shows its constant, as §2.4's widening makes every face; and constants show
 * the arrow that marks them.
 */
export function displayedArrow(
  world: ShownColour,
  fail: ShownColour,
  place: "spine" | "callback" | "inside",
): string {
  if (place !== "spine") return markedArrow(world !== "silent", fail !== "silent");
  if (world === "follows" || fail === "follows") {
    return world === "constant" || fail === "constant" ? IMPURE_ARROW : FOLLOWS_ARROW;
  }
  return markedArrow(world === "constant", fail === "constant");
}
