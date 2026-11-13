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
  BufferRange,
  PlaygroundCodeAction,
  PlaygroundCompletion,
  PlaygroundInlayHint,
  PlaygroundRenamePlan,
  PlaygroundRenameRefusal,
  PlaygroundSignatureHelp,
  PlaygroundTextEdit,
} from "./protocol";

/**
 * The kinds this Playground's code-action provider advertises.
 *
 * Named rather than written inline because it is a claim about the actions the
 * session emits: drop `"refactor"` and Monaco stops asking this provider under
 * a `refactor` filter, which is where the variance offer and the rewrites
 * between forms would appear.
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
  readonly command?: MappedSnippetCommand<Range>;
  readonly disabled?: string;
  readonly isPreferred?: boolean;
}

/**
 * The command that writes a repair as a snippet, its stand-ins selected in turn
 * (language-server decision 5). Standalone Monaco applies a code action's edit
 * as plain text whatever it is marked (`StandaloneBulkEditService` ignores
 * `insertAsSnippet`), so a repair with a snippet runs this instead, which hands
 * the snippet to the editor's snippet controller. `monaco.ts` registers it.
 */
export const INSERT_SNIPPET_COMMAND = "hexagon.insertSnippet";

/**
 * Its arguments: the document version the snippet was made against, the
 * snippet, and the same edit as plain text.
 */
export interface MappedSnippetCommand<Range> {
  readonly id: string;
  readonly title: string;
  readonly arguments: [versionId: number, snippet: MappedEdit<Range>, plain: MappedEdit<Range>];
}

/** Text and the range it replaces. */
export interface MappedEdit<Range> {
  readonly range: Range;
  readonly text: string;
}

/**
 * Runs the command where the document is still at the version the snippet was
 * made against: `insert` writes the snippet, or, where the editor has no
 * snippet controller to write it, `write` writes the plain edit, so the repair
 * is never lost. Nothing is written where the document has moved since, as
 * Monaco refuses a stale edit.
 */
export function runSnippetCommand<Range>(
  versionId: number,
  [madeAt, snippet, plain]: MappedSnippetCommand<Range>["arguments"],
  insert: ((range: Range, text: string) => void) | undefined,
  write: (range: Range, text: string) => void,
): void {
  if (versionId !== madeAt) return;
  if (insert === undefined) write(plain.range, plain.text);
  else insert(snippet.range, snippet.text);
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
 * for. An action with a snippet carries the command that writes it instead of
 * its edit.
 */
export function toCodeAction<Uri, Range>(
  target: EditTarget<Uri, Range>,
  action: PlaygroundCodeAction,
): MappedCodeAction<Uri, Range> {
  if (action.disabled !== undefined) return { title: action.title, kind: action.kind, disabled: action.disabled };
  // A repair of one edit, as every fill is, is written as a snippet; one of
  // several is written as it stands, each edit's text as the session wrote it.
  const [only, ...others] = action.edits;
  const snippet = others.length === 0 ? only?.snippet : undefined;
  return {
    title: action.title,
    kind: action.kind,
    ...(only === undefined || snippet === undefined
      ? { edit: toWorkspaceEdit(target, action.edits) }
      : {
        command: {
          id: INSERT_SNIPPET_COMMAND,
          title: action.title,
          arguments: [
            target.versionId,
            { range: target.range(snippet.startOffset, snippet.endOffset), text: snippet.text },
            { range: target.range(only.startOffset, only.endOffset), text: only.replacement },
          ],
        },
      }),
    // What "Auto Fix" applies on its own (the session's `preferred`).
    ...(action.preferred === true ? { isPreferred: true } : {}),
  };
}

/**
 * The name of a `monaco.languages.CompletionItemKind` member — named rather than
 * numbered because this file may not import Monaco, and `monaco.ts` asserts that
 * every one of these is a real member.
 */
export type CompletionIconKind =
  | "Function"
  | "Variable"
  | "Constructor"
  | "Class"
  | "Module"
  | "Field"
  | "Method";

/**
 * The icon a completion kind is shown with — the language server's
 * `completionKindOf`, entry for entry, so VS Code and the Playground draw the
 * same list.
 *
 * Total over strings rather than over the compiler's union, because the session
 * gains kinds and this file should not be the reason a new one is dropped. A kind
 * it does not know is drawn as a variable, the same icon a plain value gets:
 * the one that claims least about what the name is.
 */
export function completionKindOf(kind: string): CompletionIconKind {
  switch (kind) {
    case "function":
      return "Function";
    case "constructor":
      return "Constructor";
    case "type":
      return "Class";
    case "module":
      return "Module";
    case "field":
      return "Field";
    // A companion operation and a constraint member are both called after the
    // dot, so both are methods to an editor; a member's mark tells them apart.
    case "operation":
    case "member":
      return "Method";
    case "parameter":
    case "value":
    default:
      return "Variable";
  }
}

/**
 * `documentation` is Monaco's `IMarkdownString`, untrusted: the text is a doc
 * comment, written by whoever wrote the code being completed, and a trusted
 * string would let it run `command:` links.
 */
export interface MappedCompletionItem<Range> {
  /** Monaco's `CompletionItemLabel` where there is a mark to show beside the name. */
  readonly label: string | { readonly label: string; readonly description: string };
  readonly kind: CompletionIconKind;
  readonly insertText: string;
  readonly range: Range;
  readonly detail?: string;
  readonly documentation?: { readonly value: string; readonly isTrusted: false };
}

/**
 * One offered name as Monaco's.
 *
 * The same fields the language server sends (`onCompletion` in `server.ts`):
 * the type as `detail`, which is the plain string beside the label, the
 * documentation as Markdown, and a member's mark as the label's description,
 * where the server puts it in `labelDetails`. `range` is the partial name being typed, which is
 * what Monaco filters the list against as typing continues and what accepting
 * an item replaces — every item gets the same one.
 */
export function toCompletionItem<Range>(
  completion: PlaygroundCompletion,
  range: Range,
): MappedCompletionItem<Range> {
  return {
    label: completion.mark === undefined
      ? completion.name
      : { label: completion.name, description: completion.mark },
    kind: completionKindOf(completion.kind),
    insertText: completion.name,
    range,
    ...(completion.detail === undefined ? {} : { detail: completion.detail }),
    ...(completion.documentation === undefined
      ? {}
      : { documentation: { value: completion.documentation, isTrusted: false as const } }),
  };
}

/** Monaco's `IMarkdownString`, untrusted for the reason `MappedCompletionItem`'s is. */
interface UntrustedMarkdown {
  readonly value: string;
  readonly isTrusted: false;
}

/** Monaco's `SignatureHelp`, from the fields the language server sends. */
export interface MappedSignatureHelp {
  readonly signatures: readonly {
    readonly label: string;
    readonly documentation?: UntrustedMarkdown;
    readonly parameters: readonly { readonly label: [number, number] }[];
    readonly activeParameter: number;
  }[];
  readonly activeSignature: number;
  readonly activeParameter: number;
}

/**
 * The call the caret is in, as Monaco's signature help.
 *
 * The same fields the language server sends (`toLspSignatureHelp` in
 * `server.ts`), with each parameter named by its place in the label. Monaco
 * reads places, and only a place tells the two `Int`s of `(Int, Int) -> Int`
 * apart.
 */
export function toSignatureHelp(help: PlaygroundSignatureHelp): MappedSignatureHelp {
  return {
    signatures: [{
      label: help.label,
      ...(help.documentation === undefined
        ? {}
        : { documentation: { value: help.documentation, isTrusted: false as const } }),
      parameters: help.parameters.map((parameter) => ({
        label: [parameter.range[0], parameter.range[1]],
      })),
      activeParameter: help.activeParameter,
    }],
    activeSignature: 0,
    activeParameter: help.activeParameter,
  };
}

/** Monaco's `InlayHint`, from the fields the language server sends. */
export interface MappedInlayHint<Position> {
  readonly label: string;
  readonly position: Position;
  /** A member of Monaco's `InlayHintKind`, by name, as `CompletionIconKind` is. */
  readonly kind?: "Type";
  readonly paddingLeft?: boolean;
  readonly tooltip: UntrustedMarkdown;
}

/**
 * A hint as Monaco draws it: the same fields the language server sends
 * (`toLspInlayHints` in `language-server/src/inlay-hints.ts`). A type is a
 * `Type` hint. A colour is neither a type nor a parameter name, so it has no
 * kind: words, set off from the line they end. Each has the face it is a piece
 * of as its tooltip. A regex group's number has no kind either, and sits
 * against the `(` it numbers, with its group's hover as its tooltip. No hint
 * carries an edit: a hint is shown, never written.
 */
export function toInlayHint<Position>(
  hint: PlaygroundInlayHint,
  position: Position,
): MappedInlayHint<Position> {
  const tooltip = { value: hint.tooltip, isTrusted: false as const };
  if (hint.kind === "type") return { label: hint.label, position, kind: "Type", tooltip };
  if (hint.kind === "regexGroup") return { label: hint.label, position, tooltip };
  return { label: hint.label, position, paddingLeft: true, tooltip };
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
 *
 * Both sentences currently reach the console rather than the screen — standalone
 * Monaco's notification service is `console.log` — so they are written for
 * whoever is reading a log, not for a user. `monaco.ts` has the detail, and #253
 * covers giving a refusal somewhere to be seen.
 */
export function toRenameEdits<Uri, Range>(
  target: EditTarget<Uri, Range>,
  result: PlaygroundRenamePlan | PlaygroundRenameRefusal | undefined,
): MappedWorkspaceEdit<Uri, Range> & { readonly rejectReason?: string } {
  if (result === undefined) {
    return { edits: [], rejectReason: "Hexagon has no rename for this position." };
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
 * Whether a hover would answer at this offset, from the spans the session
 * published for the text the caret is in.
 *
 * Closed at both ends, which is not a convenience here but the session's own
 * rule: `occurrencesAt`, `DocumentationIndex.covering` and `siteAt` all treat a
 * caret resting immediately after a name as being on it — the position a tap
 * most often leaves it in — so a gate that stopped one short of the end would
 * refuse to open exactly where the hover has an answer.
 *
 * The predecessor of this function looked one offset *back* to buy the same
 * behaviour from a half-open table. That was a faithful local translation of a
 * table which was itself answering a different question, which is the part #254
 * was about; reading the published end inclusively is what the session means.
 */
export function hoverAnswersAtOffset(
  spans: readonly BufferRange[],
  offset: number,
): boolean {
  return spans.some(({ startOffset, endOffset }) =>
    offset >= startOffset && offset <= endOffset
  );
}

/**
 * The selection a hover at `offset` sends in place of its position, or
 * `undefined` to send the position: the first selection that is not empty and
 * holds the pointer, its ends included, as Monaco's `containsPosition` reads
 * one. The hover then answers with the type of the expression the selection
 * names. The VS Code extension makes the same choice for the language server
 * (`editors/vscode/src/hover-selection.ts`).
 */
export function hoverSelectionAt(
  selections: readonly BufferRange[],
  offset: number,
): BufferRange | undefined {
  return selections.find(({ startOffset, endOffset }) =>
    startOffset !== endOffset &&
    Math.min(startOffset, endOffset) <= offset && offset <= Math.max(startOffset, endOffset)
  );
}

/**
 * Whether the caret hover opens at `offset`: whether the hover it opens has an
 * answer. A caret inside a selection hovers the selection (`hoverSelectionAt`),
 * so there the question is whether the selection names an expression, which
 * only the worker can say; elsewhere it is the published spans' (#254).
 */
export async function caretHoverAnswers(
  spans: readonly BufferRange[],
  selections: readonly BufferRange[],
  offset: number,
  hoverSelection: (selection: BufferRange) => Promise<unknown>,
): Promise<boolean> {
  const selected = hoverSelectionAt(selections, offset);
  return selected === undefined ? hoverAnswersAtOffset(spans, offset) : (await hoverSelection(selected)) !== undefined;
}
