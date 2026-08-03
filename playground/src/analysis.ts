/**
 * The Playground's editor services, answered by the compiler's own
 * `AnalysisSession`.
 *
 * There is no language server here and there is not meant to be one. A quick fix
 * is not an LSP feature: `Session.codeActions()` computes it, and the server is
 * one caller of that method — the one that serves VS Code over a pipe. Monaco is
 * a second caller. Routing through a protocol would mean de-noding the server's
 * workspace discovery and manifest resolution, neither of which the Playground
 * has any use for, to reuse a layer of LSP-typed translation. Session to Monaco
 * is one hop and gives the same answers.
 *
 * Two things this layer owes its caller. Every coordinate it returns is an
 * *editor buffer* offset, because the buffer is the only document the user has;
 * the virtual files stop here. And every answer it cannot express in buffer
 * coordinates is refused rather than approximated — a rename whose edits reach
 * into a hosted library is declined with a reason, not performed on the half of
 * itself that fits.
 *
 * The session outlives each request. It holds its analysis until a file changes,
 * so a hover after a code action on unchanged text costs a lookup rather than a
 * compile.
 */

import { AnalysisSession, hoverMarkdown, type CodeAction, type Source } from "../../compiler/src/index";

import type {
  BufferRange,
  PlaygroundCodeAction,
  PlaygroundHover,
  PlaygroundRenamePlan,
  PlaygroundRenameRefusal,
  PlaygroundRenameSubject,
  PlaygroundTextEdit,
} from "./protocol";
import { layOutWorkspace, type WorkspaceLayout, type WorkspaceMap } from "./workspace";

/**
 * Shown when a repair or a rename is real but reaches code the buffer does not
 * contain — a hosted library, or the imports the Playground writes for the user.
 * A sentence rather than a code, because every host that shows a refusal shows
 * it as prose.
 */
const OUTSIDE_DOCUMENT = "this would edit code the Playground does not show";

export class PlaygroundAnalysis {
  readonly #session = new AnalysisSession();

  hover(source: string, offset: number): PlaygroundHover | undefined {
    const layout = this.#sync(source);
    const at = layout?.map.locate(offset);
    if (layout === undefined || at === undefined) return undefined;
    const hover = this.#session.hover(at.path, at.offset);
    if (hover === undefined) return undefined;
    const range = this.#rangeOfSpan(layout.map, at.path, hover.span);
    // Unreachable today, like the two other refusals of this shape — see
    // `#action`. `locate` never lands in a file the map cannot invert, so the
    // span it asks about always comes back.
    if (range === undefined) return undefined;
    return { markdown: hoverMarkdown(hover), range };
  }

  definitions(source: string, offset: number): readonly BufferRange[] {
    const layout = this.#sync(source);
    const at = layout?.map.locate(offset);
    if (layout === undefined || at === undefined) return [];
    // A definition in a hosted library has nowhere to go: the Playground shows
    // one document, and `Vector.hex` is not in it. Dropping it leaves the editor
    // saying there is no definition, which is the truth about what it can open.
    return inBufferOrder(
      this.#session
        .definitions(at.path, at.offset)
        .flatMap(({ path, span }) =>
          toRange(layout.map.toBufferRange(path, offsetsOf(span)))
        ),
    );
  }

  references(source: string, offset: number): readonly BufferRange[] {
    const layout = this.#sync(source);
    const at = layout?.map.locate(offset);
    if (layout === undefined || at === undefined) return [];
    // Mentions the buffer cannot show are dropped for the same reason as a
    // definition's: there is nowhere to peek to. Unlike a rename, this is a
    // reading, not an edit, so an incomplete one is a smaller list rather than
    // a broken program.
    return inBufferOrder(
      this.#session
        .references(at.path, at.offset)
        .flatMap(({ path, span }) =>
          toRange(layout.map.toBufferRange(path, offsetsOf(span)))
        ),
    );
  }

  codeActions(
    source: string,
    range: BufferRange,
  ): readonly PlaygroundCodeAction[] {
    const layout = this.#sync(source);
    const start = layout?.map.locate(range.startOffset);
    const end = layout?.map.locate(range.endOffset);
    if (layout === undefined || start === undefined || end === undefined) return [];
    // A selection running from one module block into another names no single
    // file, and the session asks about one. Nothing is offered rather than
    // silently answering about whichever end came first.
    if (start.path !== end.path) return [];
    return this.#session
      .codeActions(start.path, { start: start.offset, end: end.offset })
      .map((action) => this.#action(layout.map, action));
  }

  prepareRename(
    source: string,
    offset: number,
  ): PlaygroundRenameSubject | PlaygroundRenameRefusal | undefined {
    const layout = this.#sync(source);
    const at = layout?.map.locate(offset);
    if (layout === undefined || at === undefined) return undefined;
    const subject = this.#session.prepareRename(at.path, at.offset);
    if (subject === undefined || "refused" in subject) return subject;
    const range = this.#rangeOfSpan(layout.map, at.path, subject.span);
    // Also unreachable today: the subject's span is the identifier the cursor
    // is on, and the cursor is in the buffer by construction. The mentions
    // below are the reachable half of the same question.
    if (range === undefined) return { refused: OUTSIDE_DOCUMENT };
    // Asked of the mentions the rename would move, not only of the identifier
    // under the cursor, so the box does not open on a name that is going to be
    // refused the moment the user presses Enter. The session's own prepare
    // answers about the subject alone and keeps its mentions private, so they
    // are re-derived here from the occurrence index — cheap, where asking
    // `rename` would re-analyse the project to verify a name nobody typed yet.
    //
    // Every mention at the offset, deliberately unnarrowed. `#renameSubject`
    // additionally drops the ones spelled differently from the innermost, so
    // this can in principle refuse a rename that would have succeeded — and it
    // is left that way because no input has been found where the two sets
    // differ, so narrowing would be guarding a case nobody can produce. Refusal
    // is also the side to be wrong on: declining a rename that would have worked
    // costs a retry, and a prompt that rejects every keystroke costs the
    // feature.
    const reachable = this.#session.references(at.path, at.offset);
    if (
      reachable.some(({ path, span }) =>
        layout.map.toBufferRange(path, offsetsOf(span)) === undefined
      )
    ) {
      return { refused: OUTSIDE_DOCUMENT };
    }
    return { name: subject.name, range };
  }

  rename(
    source: string,
    offset: number,
    newName: string,
  ): PlaygroundRenamePlan | PlaygroundRenameRefusal | undefined {
    const layout = this.#sync(source);
    const at = layout?.map.locate(offset);
    if (layout === undefined || at === undefined) return undefined;
    const result = this.#session.rename(at.path, at.offset, newName);
    if (result === undefined || "refused" in result) return result;
    const edits: PlaygroundTextEdit[] = [];
    for (const { path, span } of result.edits) {
      const range = layout.map.toBufferRange(path, offsetsOf(span));
      // Every mention moves or none does. A rename that quietly skipped the
      // ones it could not reach would leave the program naming two things.
      if (range === undefined) return { refused: OUTSIDE_DOCUMENT };
      edits.push({ ...range, replacement: newName });
    }
    return { newName: result.newName, edits };
  }

  /**
   * The buffer as virtual files, with the session holding exactly those.
   *
   * Nothing is analysed while the Playground's own `module` notation is broken:
   * an unclosed block means the split into files is a guess, and answering from
   * a guessed split is worse than answering nothing. The compile path reports
   * those errors, so the user is already being told.
   */
  #sync(source: string): WorkspaceLayout | undefined {
    const layout = layOutWorkspace(source);
    if (layout.diagnostics.length > 0) return undefined;
    const present = new Set(layout.files.map(({ path }) => path));
    for (const path of this.#session.paths) {
      if (!present.has(path)) this.#session.removeFile(path);
    }
    for (const { path, source: text } of layout.files) {
      this.#session.setFile(path, text);
    }
    return layout;
  }

  /**
   * One repair in buffer coordinates.
   *
   * An action whose edits do not all land in the buffer becomes a refusal rather
   * than disappearing, for the same reason the session refuses rather than
   * dropping: the user can see the problem the fix answers, and an offer that
   * silently never arrives leaves them with nothing to read.
   *
   * No action reaches that branch today, and no test covers it, because every
   * edit the session emits carries the path of the file its diagnostic was
   * reported against — `session.ts` records the same thing about its own
   * equivalent. It is written as behaviour rather than an assertion because the
   * alternative is to encode "the session will never do that" in the one place
   * that would go wrong silently if it did.
   */
  #action(map: WorkspaceMap, action: CodeAction): PlaygroundCodeAction {
    const kind = action.kind === "refactor" ? "refactor" : "quickfix";
    if (action.disabled !== undefined) {
      return { title: action.title, kind, edits: [], disabled: action.disabled };
    }
    const edits: PlaygroundTextEdit[] = [];
    for (const edit of action.edits) {
      const range = map.toBufferRange(edit.path, offsetsOf(edit.span));
      if (range === undefined) {
        return { title: action.title, kind, edits: [], disabled: OUTSIDE_DOCUMENT };
      }
      edits.push({ ...range, replacement: edit.replacement });
    }
    return { title: action.title, kind, edits };
  }

  /**
   * A span the session reported about `path`, as a buffer range.
   *
   * A span names its file by number, not by path, so the number is looked up
   * rather than assumed to be the queried file's. Both callers today ask about
   * spans the session took from occurrences in the file they queried, so the
   * lookup changes no answer and no test can tell it apart from using `queried`
   * directly. It is one map read to not depend on that.
   */
  #rangeOfSpan(
    map: WorkspaceMap,
    queried: string,
    span: Source.Span,
  ): BufferRange | undefined {
    const owner = this.#session.pathOfFile(span.fileId) ?? queried;
    return map.toBufferRange(owner, offsetsOf(span));
  }
}

function offsetsOf(span: Source.Span): { readonly start: number; readonly end: number } {
  return { start: span.start.offset, end: span.end.offset };
}

function toRange(range: BufferRange | undefined): readonly BufferRange[] {
  return range === undefined ? [] : [range];
}

/**
 * Sorted by where the user will look, which is not the order these arrive in.
 *
 * `Session.references` orders by path and then by offset — right for a host with
 * one editor per file, wrong here, where every path collapses into one document
 * and path order is not document order: a module block declared above the code
 * that uses it becomes `/Name.hex`, which sorts against `/main.hex` by spelling
 * rather than by position. `Session.definitions` does not sort at all. Neither
 * ordering is this file's to rely on, so both are replaced by the only one that
 * means anything to a reader of a single buffer.
 *
 * It does not deduplicate. A record's declaration is both a type and a
 * constructor and so is listed twice, which the language server does too; making
 * the Playground quietly differ is how the divergence #222 was filed about
 * started.
 */
function inBufferOrder(ranges: readonly BufferRange[]): readonly BufferRange[] {
  return [...ranges].sort((left, right) => left.startOffset - right.startOffset);
}
