/**
 * How a function type's arrow is *displayed* (`spec/effects.md` §10), and what
 * a written one says on each colour (§2.2).
 *
 * Three renderers answer this question — the hover/`.d.ts` type printer, the
 * source writer, and the checker's diagnostic printer — over three different
 * representations of a type. What they must agree on is the text, so the text
 * lives here and nowhere else.
 *
 * A displayed face is a face the grammar can write. Each colour is silent, the
 * constant, or passing through what the signature is handed, and each pairing
 * has one spelling: the four constants `->`, `->^`, `->~` and `->!`, and the
 * five following arrows, which name between their `>`s the colours that pass
 * through and after them a colour done on its own account. No colour is
 * numbered: a finished face depends on all of its callbacks or on none, on
 * each colour (§2.4).
 */

/** The pure constant. */
export const PURE_ARROW = "->";

/** The impure constant, and a callback's colour on its own arrows (`spec/effects.md` §2.3). */
export const IMPURE_ARROW = "->!";

/** Both colours pass through what the signature is handed (`spec/effects.md` §2.2). */
export const FOLLOWS_ARROW = ">->";

/** The constant that may fail and is pure (`spec/effects.md` §1). */
export const CARET_ARROW = "->^";

/** The constant that is impure and cannot fail (`spec/effects.md` §1). */
export const TILDE_ARROW = "->~";

/**
 * A following arrow as written (`spec/effects.md` §2.2), named for its tokens:
 * `linked` is `>->`; `linkedTilde` `>~>` and `linkedCaret` `>^>` pass one
 * colour through; `linkedTildeCaret` `>~>^` and `linkedCaretTilde` `>^>~` add
 * the other colour on the function's own account.
 */
export type FollowingArrow = "linked" | "linkedTilde" | "linkedTildeCaret" | "linkedCaret" | "linkedCaretTilde";

/** Whether a written arrow is a following arrow. */
export function isFollowing(effect: string | undefined): effect is FollowingArrow {
  return effect !== undefined && effect.startsWith("linked");
}

/** The colours a written following arrow passes through; none for a constant. */
export function passesThrough(effect: string | undefined): { readonly world: boolean; readonly fail: boolean } {
  switch (effect) {
    case "linked":
      return { world: true, fail: true };
    case "linkedTilde":
    case "linkedTildeCaret":
      return { world: true, fail: false };
    case "linkedCaret":
    case "linkedCaretTilde":
      return { world: false, fail: true };
    default:
      return { world: false, fail: false };
  }
}

/**
 * The colours a written arrow names as the constant: a constant's marks, and
 * what a following arrow names after its second `>`.
 */
export function ownMarks(effect: string | undefined): { readonly world: boolean; readonly fail: boolean } {
  switch (effect) {
    case "bang":
      return { world: true, fail: true };
    case "tilde":
    case "linkedCaretTilde":
      return { world: true, fail: false };
    case "caret":
    case "linkedTildeCaret":
      return { world: false, fail: true };
    default:
      return { world: false, fail: false };
  }
}

/**
 * The arrow that passes these colours through and names the rest as their
 * constants: a following arrow where some colour passes through, and the
 * constant that marks the others where none does. A colour passing through
 * is never named again after the second `>`.
 */
export function arrowNaming(
  through: { readonly world: boolean; readonly fail: boolean },
  own: { readonly world: boolean; readonly fail: boolean },
): string {
  if (through.world && through.fail) return FOLLOWS_ARROW;
  if (through.world) return own.fail ? ">~>^" : ">~>";
  if (through.fail) return own.world ? ">^>~" : ">^>";
  return markedArrow(own.world, own.fail);
}

/**
 * The following arrow that passes these colours through and names the other
 * as its own, or `undefined` where nothing passes through: a constant then.
 */
export function followingArrow(
  through: { readonly world: boolean; readonly fail: boolean },
  own: { readonly world: boolean; readonly fail: boolean },
): FollowingArrow | undefined {
  if (through.world && through.fail) return "linked";
  if (through.world) return own.fail ? "linkedTildeCaret" : "linkedTilde";
  if (through.fail) return own.world ? "linkedCaretTilde" : "linkedCaret";
  return undefined;
}

/**
 * The constant a refused following arrow reads as (`spec/effects.md` §4.4):
 * each colour it passes through or names after its second `>` becomes its
 * constant, and the other stays silent. Only what cannot be true goes: the
 * colour's dependence on a callback, never the colour.
 */
export function constantMarks(effect: string | undefined): { readonly world: boolean; readonly fail: boolean } {
  const through = passesThrough(effect);
  const own = ownMarks(effect);
  return { world: through.world || own.world, fail: through.fail || own.fail };
}

/** A written arrow's text: absent is `->`. */
export function writtenArrowText(effect: string | undefined): string {
  return arrowNaming(passesThrough(effect), ownMarks(effect));
}

/** The arrow that marks exactly these colours (`spec/effects.md` §1's alphabet). */
export function markedArrow(world: boolean, fail: boolean): string {
  return world ? fail ? IMPURE_ARROW : TILDE_ARROW : fail ? CARET_ARROW : PURE_ARROW;
}

/** One colour of an arrow as its display reads it: silent, a constant, or following callbacks. */
export type ShownColour = "silent" | "constant" | "follows";

/**
 * The arrow a function type displays for its two colours (`spec/effects.md`
 * §10). On a callback's own arrows and anywhere else inside a parameter type,
 * the arrow marks each colour that is not silent. On a face's spine, each
 * colour is named in its own state: the colours that follow callbacks between
 * a following arrow's `>`s, a constant after them, or a constant arrow where
 * no colour follows.
 */
export function displayedArrow(
  world: ShownColour,
  fail: ShownColour,
  place: "spine" | "callback" | "inside",
): string {
  if (place !== "spine") return markedArrow(world !== "silent", fail !== "silent");
  return arrowNaming(
    { world: world === "follows", fail: fail === "follows" },
    { world: world === "constant", fail: fail === "constant" },
  );
}
