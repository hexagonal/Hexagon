/**
 * The session's answers in the shapes Monaco's providers return.
 *
 * Separated from `monaco.ts` for the reason `compiler-service.ts` was separated
 * from `compiler-worker.ts`: this is the part with decisions in it, and the file
 * it came from cannot be loaded without a DOM. #222 calls this translation "a
 * field copy", and a field copy is exactly the kind of code that is wrong in one
 * field and looks right.
 *
 * Nothing here imports Monaco, even as a type. A range and a URI arrive already
 * made, through `EditTarget`, because building a range needs the model's line
 * index and the model is what could not be loaded. The result types are
 * structural, and `monaco.ts` is where they are checked against the real ones.
 */

import type { PlaygroundCodeAction, PlaygroundTextEdit } from "./protocol";

/**
 * The document an edit is against.
 *
 * `versionId` is stamped on every edit so Monaco can refuse to apply one whose
 * document has moved since — the last guard on a race the worker's own version
 * check does not cover, because a reply can be current when it arrives and stale
 * by the time the user picks the action out of a menu.
 */
export interface EditTarget<Uri, Range> {
  readonly uri: Uri;
  readonly versionId: number;
  range(startOffset: number, endOffset: number): Range;
}

export interface MappedTextEdit<Uri, Range> {
  readonly resource: Uri;
  readonly versionId: number;
  readonly textEdit: { readonly range: Range; readonly text: string };
}

/**
 * `edits` is a mutable array, against this file's habits, because Monaco's
 * `WorkspaceEdit` declares one and a `readonly` array is not assignable to it.
 * The alternative is a cast at the boundary, which would hide exactly the kind
 * of shape mismatch this file exists to keep the compiler watching.
 */
export interface MappedWorkspaceEdit<Uri, Range> {
  readonly edits: MappedTextEdit<Uri, Range>[];
}

export interface MappedCodeAction<Uri, Range> {
  readonly title: string;
  readonly kind: string;
  readonly edit?: MappedWorkspaceEdit<Uri, Range>;
  readonly disabled?: string;
}

export interface MappedRenameLocation<Range> {
  readonly range: Range;
  readonly text: string;
  readonly rejectReason?: string;
}

export function toWorkspaceEdit<Uri, Range>(
  target: EditTarget<Uri, Range>,
  edits: readonly PlaygroundTextEdit[],
): MappedWorkspaceEdit<Uri, Range> {
  return {
    edits: edits.map((edit) => ({
      resource: target.uri,
      versionId: target.versionId,
      textEdit: {
        range: target.range(edit.startOffset, edit.endOffset),
        text: edit.replacement,
      },
    })),
  };
}

/**
 * One repair as Monaco's.
 *
 * A refused action carries `disabled` and no `edit`, never both and never
 * neither: an action with an empty edit set is one Monaco will happily apply to
 * no effect, which is the outcome the refusal exists to avoid being mistaken
 * for.
 */
export function toCodeAction<Uri, Range>(
  target: EditTarget<Uri, Range>,
  action: PlaygroundCodeAction,
): MappedCodeAction<Uri, Range> {
  return action.disabled === undefined
    ? { title: action.title, kind: action.kind, edit: toWorkspaceEdit(target, action.edits) }
    : { title: action.title, kind: action.kind, disabled: action.disabled };
}

/**
 * The identifier a rename would start from, or the reason it will not run.
 *
 * A refusal still needs a range and a text, because the shape is not optional;
 * they are the caret and the empty string, since there is no subject to
 * describe. Monaco reads `rejectReason` first and shows it at that position.
 */
export function toRenameLocation<Range>(
  subject: { readonly name: string; readonly range: { readonly startOffset: number; readonly endOffset: number } } | { readonly refused: string },
  range: (startOffset: number, endOffset: number) => Range,
  caret: Range,
): MappedRenameLocation<Range> {
  return "refused" in subject
    ? { range: caret, text: "", rejectReason: subject.refused }
    : {
      range: range(subject.range.startOffset, subject.range.endOffset),
      text: subject.name,
    };
}
