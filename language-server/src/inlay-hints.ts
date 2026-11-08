/**
 * Inlay hints across the protocol boundary (`compiler/src/queries/inlay-hints.ts`
 * decides what they are; this only translates and filters).
 *
 * Two settings, `hexagon.inlayHints.types` and `hexagon.inlayHints.colours`,
 * both on by default (LANGUAGE-SERVER-D3.md, ruled (a)). The editor's own
 * `editor.inlayHints.enabled` stands above both, so a dev who wants hints only
 * while holding a key sets that, as for any language.
 *
 * A hint carries no `textEdits`: a written type binds, so a hint is never
 * written on a double-click (the plan's doctrine point 3). Writing one is
 * "add annotation"'s job, which compiles the edit first.
 */

import { InlayHintKind, MarkupKind, type InlayHint, type Position } from "vscode-languageserver";
import { inlayHintTooltipMarkdown, type InlayHint as SessionInlayHint } from "../../compiler/src/index.js";

export interface InlayHintSettings {
  /** The types inference gave the places a dev could have written one. */
  readonly types: boolean;
  /** A function's colour in words, at the end of its header's line. */
  readonly colours: boolean;
}

export const DEFAULT_INLAY_HINT_SETTINGS: InlayHintSettings = { types: true, colours: true };

/**
 * The settings in a `workspace/configuration` answer for `hexagon.inlayHints`.
 * Anything that is not a boolean, or not there, keeps its default: a client
 * that knows nothing of these settings shows every hint.
 */
export function inlayHintSettingsOf(value: unknown): InlayHintSettings {
  const flag = (name: keyof InlayHintSettings): boolean => {
    const read = (value as Record<string, unknown> | null | undefined)?.[name];
    return typeof read === "boolean" ? read : DEFAULT_INLAY_HINT_SETTINGS[name];
  };
  return { types: flag("types"), colours: flag("colours") };
}

/** The session's hints as the protocol's, those the settings turn off left out. */
export function toLspInlayHints(
  hints: readonly SessionInlayHint[],
  positionAt: (offset: number) => Position,
  settings: InlayHintSettings,
): InlayHint[] {
  return hints.flatMap((hint): InlayHint[] => {
    if (hint.kind === "type") {
      if (!settings.types) return [];
      return [{ position: positionAt(hint.offset), label: hint.label, kind: InlayHintKind.Type }];
    }
    if (!settings.colours) return [];
    // Neither a type nor a parameter name, so no kind: words, set off from
    // the line they end, with the face whose arrow they read beside them.
    const tooltip = inlayHintTooltipMarkdown(hint);
    return [{
      position: positionAt(hint.offset),
      label: hint.label,
      paddingLeft: true,
      ...(tooltip === undefined ? {} : { tooltip: { kind: MarkupKind.Markdown, value: tooltip } }),
    }];
  });
}
