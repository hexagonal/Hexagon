/**
 * What a colour hint's tooltip reads as, for every host that draws one: the
 * language server over LSP, and the Playground in Monaco. Written once, as
 * hover's text is (`hover-text.ts`), so the two cannot drift.
 */

import type { InlayHint } from "../queries/inlay-hints.js";

/**
 * The function's face, set as hover sets its first line, so the words in the
 * hint sit beside the arrow they read; nothing for a hint with no tooltip.
 */
export function inlayHintTooltipMarkdown(hint: InlayHint): string | undefined {
  return hint.tooltip === undefined ? undefined : `\`${hint.tooltip}\``;
}
