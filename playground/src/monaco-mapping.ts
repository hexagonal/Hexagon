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
 * index and the model is what could not be loaded.
 *
 * The result types are structural, which buys less than it looks like. Ordinary
 * assignability catches a missing *required* field and nothing else: spell
 * `disabled` as `disabledReason` and every one of these still assigns to
 * Monaco's `CodeAction`, because an optional field that is absent is a legal
 * `CodeAction` and a stray one is not an excess-property error away from a
 * literal. `monaco.ts` therefore asserts the optional names field by field, and
 * the tests here pin the values. Neither alone is enough.
 */

import type {
  PlaygroundCodeAction,
  PlaygroundRenamePlan,
  PlaygroundRenameRefusal,
  PlaygroundTextEdit,
  TypeOccurrence,
} from "./protocol";

/**
 * The kinds this Playground's code-action provider advertises.
 *
 * Named rather than written inline because it is a claim about the actions the
 * session emits: drop `"refactor"` and Monaco stops asking this provider under
 * a `refactor` filter, which is where the variance offer would appear.
 */
export const codeActionKinds: readonly string[] = ["quickfix", "refactor"];

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
 * The edits a rename would make, or the reason there are none.
 *
 * `undefined` and a refusal both become a rejection, because Monaco reads any
 * result *without* a `rejectReason` as this provider's accepted answer and stops
 * asking the others — so an empty edit set would be a silent successful no-op.
 * The two do not share a sentence: a refusal has the session's own words, and
 * `undefined` gets one that names no cause, since it stands for a name that is
 * not there, an unclosed `module` block, a reply dropped as stale, and a worker
 * fault alike.
 */
export function toRenameEdits<Uri, Range>(
  target: EditTarget<Uri, Range>,
  result: PlaygroundRenamePlan | PlaygroundRenameRefusal | undefined,
): MappedWorkspaceEdit<Uri, Range> & { readonly rejectReason?: string } {
  if (result === undefined) {
    return { edits: [], rejectReason: "Hexagon has no rename for this position" };
  }
  if ("refused" in result) return { edits: [], rejectReason: result.refused };
  return toWorkspaceEdit(target, result.edits);
}

/**
 * The identifier a rename would start from, or the reason it will not run.
 *
 * A refusal still needs a range and a text, because the shape has neither
 * optional; they are the caret and the empty string, since there is no subject
 * to describe — and Monaco discards both. `RenameSkeleton` collects the
 * `rejectReason`, moves on, and rebuilds a location from the word under the
 * cursor, then shows the reason at the *editor's* position. So the two filler
 * fields satisfy the type and nothing else, which is worth knowing before
 * anyone spends effort making them more accurate.
 */
export function toRenameLocation<Range>(
  subject:
    | {
      readonly name: string;
      readonly range: { readonly startOffset: number; readonly endOffset: number };
    }
    | { readonly refused: string },
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

/**
 * Both offsets brought inside a document of this length, start first.
 *
 * A span from the worker describes text the model had when the request was sent,
 * and the model may be shorter now. Monaco throws on a position past the end, so
 * this is what stops a stale hover from taking the editor down; the range it
 * produces is wrong, and a wrong highlight on a hover that is about to be
 * replaced is the cheap failure.
 */
export function boundedOffsets(
  startOffset: number,
  endOffset: number,
  length: number,
): readonly [number, number] {
  const start = Math.min(Math.max(0, startOffset), length);
  return [start, Math.max(start, Math.min(endOffset, length))];
}

/**
 * Whether the compile that produced `types` found anything at this offset.
 *
 * Looks one offset back as well, so a caret resting immediately after a name is
 * still on it — the position a tap most often leaves it in.
 */
export function typeOccurrenceAtOffset(
  types: readonly TypeOccurrence[],
  offset: number,
): TypeOccurrence | undefined {
  const at = (candidate: number): TypeOccurrence | undefined =>
    types.find(({ startOffset, endOffset }) =>
      candidate >= startOffset && candidate < endOffset
    );
  return at(offset) ?? (offset > 0 ? at(offset - 1) : undefined);
}
