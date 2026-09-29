/**
 * The colour lattice's constants (Effects §1): what pure and impure are, how
 * two of them compare and join, and which mark and arrow each one gives.
 *
 * Every decision the checker makes about a colour **constant** goes through
 * this module; nothing else reads a constant's representation. The lattice has
 * two points today. A second axis of colour, or a third point, is then a change
 * here rather than at every colour decision in the checker (#1145, forewarned
 * by #1151).
 *
 * A constant is a `Mono` like any other in the checker (`kind: "Effect"`), so it
 * stands in a function's one colour slot beside a variable or a join, and every
 * structural walk reaches it.
 */

/** One point of the lattice. Only this module reads what is inside it. */
export interface ColourPoint {
  readonly kind: "Effect";
  readonly impure: boolean;
}

/** The bottom of the lattice: touches nothing the world can observe. */
export const PURE_POINT: ColourPoint = { kind: "Effect", impure: false };

/** The top of the lattice: may touch the world. */
export const IMPURE_POINT: ColourPoint = { kind: "Effect", impure: true };

/** Every point, bottom first: the choices a seat evaluates a body at (Effects §13.2). */
export const POINTS: readonly ColourPoint[] = [PURE_POINT, IMPURE_POINT];

/** Whether a point is the bottom: silence, the one exact promise (Effects §1). */
export function isBottom(point: ColourPoint): boolean {
  return !point.impure;
}

/** Whether a point is the top, which nothing stands above (Effects §2.6). */
export function isTop(point: ColourPoint): boolean {
  return point.impure;
}

/** Whether two points are the same point, whatever objects carry them. */
export function samePoint(left: ColourPoint, right: ColourPoint): boolean {
  return left.impure === right.impure;
}

/** Whether `left` is at most `right`. */
export function atMost(left: ColourPoint, right: ColourPoint): boolean {
  return !left.impure || right.impure;
}

/** The least point at least as effectful as both. */
export function joinPoints(left: ColourPoint, right: ColourPoint): ColourPoint {
  return left.impure || right.impure ? IMPURE_POINT : PURE_POINT;
}

/** The mark a call through an arrow of this point wears (Effects §3.1). */
export function markFor(point: ColourPoint): "bang" | undefined {
  return point.impure ? "bang" : undefined;
}

/** The arrow that spells this point (Effects §2, §10). */
export function arrowFor(point: ColourPoint): "->" | "->!" {
  return point.impure ? "->!" : "->";
}

/** The point's name in a report's words. */
export function pointName(point: ColourPoint): "pure" | "impure" {
  return point.impure ? "impure" : "pure";
}
