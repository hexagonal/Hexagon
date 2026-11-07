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

/** The part of a VS Code editor this decision reads. */
export interface EditorLike<Document, Selection> {
  readonly document: Document;
  readonly selections: readonly Selection[];
}

/** The part of the server's `initialize` answer this decision reads. */
export interface ServerCapabilitiesLike {
  readonly experimental?: unknown;
}

/**
 * The selection to send for a hover at `position` in `document`, or
 * `undefined` to send the position: the first selection of the editor the user
 * is working in (`activeTextEditor`) that is not empty and holds the pointer,
 * when that editor shows the document and the server reads a selection.
 *
 * A hover names a document and a position, never an editor, so the pane the
 * pointer is in is unknown. The active editor's selection is the one the user
 * is making, so it is the one sent: a selection left in another pane is never
 * sent, but with one document open in two panes, a pointer in the other pane
 * inside the range the active one has selected sends that selection.
 * rust-analyzer's extension makes the same choice, with the same limit.
 */
export function hoverSelection<Document, Position, Selection extends SelectionLike<Position>>(
  editor: EditorLike<Document, Selection> | undefined,
  document: Document,
  position: Position,
  capabilities: ServerCapabilitiesLike | undefined,
): Selection | undefined {
  const experimental = capabilities?.experimental;
  const reads = typeof experimental === "object" && experimental !== null &&
    (experimental as { readonly hoverRange?: unknown }).hoverRange === true;
  if (!reads || editor === undefined || editor.document !== document) return undefined;
  return editor.selections.find((selection) => !selection.isEmpty && selection.contains(position));
}
