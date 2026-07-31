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
 */

import {
  CodeActionKind,
  type CodeAction as LspCodeAction,
  type CodeActionClientCapabilities,
  type TextEdit,
} from "vscode-languageserver";
import type { CodeAction } from "../../compiler/src/index.js";
import { rangeOfSpan, type UriPaths } from "./positions.js";
import { toLspDiagnostic } from "./diagnostics.js";

/** What this client can be sent, read once from its declared capabilities. */
export interface CodeActionSupport {
  readonly literals: boolean;
  readonly disabled: boolean;
}

export function codeActionSupportOf(
  capabilities: CodeActionClientCapabilities | undefined,
): CodeActionSupport {
  return {
    literals: capabilities?.codeActionLiteralSupport !== undefined,
    disabled: capabilities?.disabledSupport === true,
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

/** Whether a request asking for particular kinds wants quick fixes. */
export function wantsQuickFixes(only: readonly string[] | undefined): boolean {
  if (only === undefined) return true;
  return only.some((kind) => selects(kind, CodeActionKind.QuickFix));
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
  const diagnostic = toLspDiagnostic(action.diagnostic, uris, pathOfFile);
  if (action.disabled !== undefined) {
    return {
      title: action.title,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      disabled: { reason: action.disabled },
    };
  }
  const changes: Record<string, TextEdit[]> = {};
  for (const edit of action.edits) {
    const uri = uris.toUri(edit.path);
    (changes[uri] ??= []).push({ range: rangeOfSpan(edit.span), newText: edit.replacement });
  }
  return {
    title: action.title,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: { changes },
  };
}
