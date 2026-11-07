/**
 * Which selection a hover sends in place of its position.
 *
 * The protocol's hover carries a position, and nothing about what is selected,
 * so "select an expression and hover it to see its type" needs the client to
 * send the selection itself. The server says it reads one there
 * (`experimental.hoverRange`, rust-analyzer's name for the same extension), and
 * then a hover whose pointer is inside a selection sends that selection.
 *
 * Kept apart from `extension.ts` so the decision is testable without VS Code:
 * it needs only what a selection can answer.
 */

/** The part of a VS Code selection this decision reads. */
export interface SelectionLike<Position> {
  readonly isEmpty: boolean;
  contains(position: Position): boolean;
}

/** The part of the server's `initialize` answer this decision reads. */
export interface ServerCapabilitiesLike {
  readonly experimental?: unknown;
}

/**
 * The selection to send for a hover at `position`, or `undefined` to send the
 * position: the first selection, among those the editors showing the document
 * hold, that is not empty and holds the pointer, when the server reads one.
 */
export function hoverSelection<Position, Selection extends SelectionLike<Position>>(
  selections: readonly Selection[],
  position: Position,
  capabilities: ServerCapabilitiesLike | undefined,
): Selection | undefined {
  const experimental = capabilities?.experimental;
  const reads = typeof experimental === "object" && experimental !== null &&
    (experimental as { readonly hoverRange?: unknown }).hoverRange === true;
  if (!reads) return undefined;
  return selections.find((selection) => !selection.isEmpty && selection.contains(position));
}
