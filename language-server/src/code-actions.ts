/**
 * Translation of the session's repairs into the protocol's code actions.
 *
 * Two protocol facts shape everything here, and both are about what a *client*
 * can be relied on to understand.
 *
 * **Literal support.** A code action was originally a `Command` — a name and an
 * identifier the server runs later — and only later became a literal carrying
 * its own edit. A client that never learned the newer form cannot apply an edit
 * this server sends, so nothing is sent to one: every action here is an edit,
 * and there is no command behind any of them to fall back to.
 *
 * **Disabled support.** An action a client may not apply, shown greyed out with
 * the reason, is newer still. It is the shape a refusal has to take — the
 * session answers "here is the repair, and here is why it must not be made", and
 * dropping the second half would leave a user waiting for a lightbulb that never
 * arrives. A client that cannot show one is sent no such action rather than an
 * enabled one, because an action that appears applicable and is not is worse
 * than an action that is missing.
 *
 * **Snippet support.** A repair that writes stand-ins for code not written yet
 * selects each one for the dev to type over, Tab moving to the next
 * (language-server decision 5), where the client takes LSP 3.18's snippet
 * edits. Any other client is sent the same text as a plain edit.
 */

import {
  CodeActionKind,
  type CodeAction as LspCodeAction,
  type CodeActionClientCapabilities,
  type Range,
  type TextEdit,
  type WorkspaceEdit,
  type WorkspaceEditClientCapabilities,
} from "vscode-languageserver";
import type { CodeAction } from "../../compiler/src/index.js";
import { rangeOfSpan, type UriPaths } from "./positions.js";
import { toLspDiagnostic } from "./diagnostics.js";

/** What this client can be sent, read once from its declared capabilities. */
export interface CodeActionSupport {
  readonly literals: boolean;
  readonly disabled: boolean;
  /** Snippet edits, which a text document edit carries (`documentChanges`). */
  readonly snippets?: true;
}

/**
 * LSP 3.18's snippet edit, and the capability that announces it, both newer
 * than the protocol library this server is built on (3.17).
 */
interface SnippetTextEdit {
  readonly range: Range;
  readonly snippet: { readonly kind: "snippet"; readonly value: string };
}

export function codeActionSupportOf(
  capabilities: CodeActionClientCapabilities | undefined,
  workspaceEdit?: WorkspaceEditClientCapabilities,
): CodeActionSupport {
  const snippets = workspaceEdit?.documentChanges === true &&
    (workspaceEdit as { readonly snippetEditSupport?: boolean }).snippetEditSupport === true;
  return {
    literals: capabilities?.codeActionLiteralSupport !== undefined,
    disabled: capabilities?.disabledSupport === true,
    ...(snippets ? { snippets: true } : {}),
  };
}

/**
 * Whether an offered kind is one a request asked for.
 *
 * `only` lists kind *prefixes*, and the match runs the opposite way from the one
 * that is easy to assume: an entry selects the kinds *below* it, so `quickfix`
 * selects `quickfix.spelling` while `quickfix.spelling` does not select
 * `quickfix`. The empty string is the prefix of everything. Getting the
 * direction wrong is what would make a fix-on-save configured for imports
 * rewrite a signature the user never asked it to touch.
 */
export function selects(requested: string, offered: string): boolean {
  return requested === "" || requested === offered || offered.startsWith(`${requested}.`);
}

/**
 * Whether a request asking for particular kinds wants anything this server
 * offers. Two families now: quick fixes for diagnostics, and refactors: the
 * variance claim (closure doc §8.2) and the rewrites between forms. A request
 * narrowed to `refactor` used to be answered with nothing at all, because the
 * only question asked was about quick fixes.
 */
export function wantsActions(only: readonly string[] | undefined): boolean {
  if (only === undefined) return true;
  return only.some((kind) =>
    selects(kind, CodeActionKind.QuickFix) || selects(kind, CodeActionKind.Refactor)
  );
}

/**
 * One session action as the protocol's, or nothing when this client could not
 * make sense of it.
 */
export function toLspCodeAction(
  action: CodeAction,
  support: CodeActionSupport,
  uris: UriPaths,
  pathOfFile: (fileId: number) => string | undefined,
): LspCodeAction | undefined {
  if (!support.literals) return undefined;
  if (action.disabled !== undefined && !support.disabled) return undefined;
  // An action may answer no diagnostic: a refactor, such as the offer to declare
  // variance an opaque type's representation already supports, which Hexagon,
  // having no warning tier, reports nowhere (closure doc §8.2), or a rewrite the
  // dev asked for. `diagnostics` is then omitted rather than sent empty: a client
  // groups an action under the problem it fixes, and this one fixes no problem.
  const diagnostics = action.diagnostic === undefined
    ? undefined
    : [toLspDiagnostic(action.diagnostic, uris, pathOfFile)];
  const kind = action.kind === "refactor" ? CodeActionKind.Refactor : CodeActionKind.QuickFix;
  if (action.disabled !== undefined) {
    return {
      title: action.title,
      kind,
      ...(diagnostics === undefined ? {} : { diagnostics }),
      disabled: { reason: action.disabled },
    };
  }
  return {
    title: action.title,
    kind,
    ...(diagnostics === undefined ? {} : { diagnostics }),
    // The repair an editor applies on its own ("Auto Fix") is a plain one; a
    // suggestion never is (Declarations Preamble §1.1), nor one that writes
    // stand-ins for code not written yet.
    ...(action.preferred === true
      ? { isPreferred: true }
      : action.suggestion === true || action.placeholders === true
      ? { isPreferred: false }
      : {}),
    edit: workspaceEditOf(action, support, uris),
  };
}

/**
 * The action's edits: as snippets, where it has one and the client takes them,
 * in the text document edits a snippet edit travels in, versionless as the
 * plain form is; plain edits keyed by URI otherwise.
 */
function workspaceEditOf(action: CodeAction, support: CodeActionSupport, uris: UriPaths): WorkspaceEdit {
  if (support.snippets === true && action.edits.some(({ snippet }) => snippet !== undefined)) {
    const byUri = new Map<string, (TextEdit | SnippetTextEdit)[]>();
    for (const edit of action.edits) {
      const uri = uris.toUri(edit.path);
      if (!byUri.has(uri)) byUri.set(uri, []);
      byUri.get(uri)!.push(
        edit.snippet === undefined
          ? { range: rangeOfSpan(edit.span), newText: edit.replacement }
          : { range: rangeOfSpan(edit.snippet.span), snippet: { kind: "snippet", value: edit.snippet.text } },
      );
    }
    return {
      documentChanges: [...byUri].map(([uri, edits]) => ({
        textDocument: { uri, version: null },
        // The 3.17 library's type has no snippet edit in it.
        edits: edits as TextEdit[],
      })),
    };
  }
  const changes: Record<string, TextEdit[]> = {};
  for (const edit of action.edits) {
    const uri = uris.toUri(edit.path);
    (changes[uri] ??= []).push({ range: rangeOfSpan(edit.span), newText: edit.replacement });
  }
  return { changes };
}
