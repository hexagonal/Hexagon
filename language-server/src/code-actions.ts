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

/**
 * Whether a request asking for particular kinds wants anything this server
 * offers. Two families now: quick fixes for diagnostics, and the one refactor
 * that offers a variance claim (closure doc §8.2). A request narrowed to
 * `refactor` used to be answered with nothing at all, because the only question
 * asked was about quick fixes.
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
  // An action may answer no diagnostic. Exactly one does — the offer to declare
  // variance an opaque type's representation already supports — because Hexagon
  // has no warning tier and an under-claim is not wrong, so nothing reports it
  // to attach to (closure doc §8.2). `diagnostics` is then omitted rather than
  // sent empty: a client groups an action under the problem it fixes, and this
  // one fixes no problem.
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
  const changes: Record<string, TextEdit[]> = {};
  for (const edit of action.edits) {
    const uri = uris.toUri(edit.path);
    (changes[uri] ??= []).push({ range: rangeOfSpan(edit.span), newText: edit.replacement });
  }
  return {
    title: action.title,
    kind,
    ...(diagnostics === undefined ? {} : { diagnostics }),
    edit: { changes },
  };
}
