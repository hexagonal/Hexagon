/**
 * What a hint's tooltip reads as, for every host that draws one: the language
 * server over LSP, and the Playground in Monaco. Written once, as hover's text
 * is (`hover-text.ts`), so the two cannot drift.
 */

import type { InlayHint } from "../queries/inlay-hints.js";

/**
 * The face the hint is a piece of, set as hover sets its first line, so a
 * piece is read beside the whole it belongs to, and a colour's words beside
 * the arrow they read. A `fun` block's head has one face for each member, one
 * line each, set apart as hover sets its owner lines. A regex group's number
 * shows its group's hover, which is Markdown already.
 */
export function inlayHintTooltipMarkdown(hint: InlayHint): string {
  // A group's number carries its group's hover, worded already.
  if (hint.kind === "regexGroup") return hint.tooltip;
  return hint.tooltip.split("\n").map((face) => `\`${face}\``).join("\n\n");
}
