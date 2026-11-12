/**
 * What signature help reads as, for every host that shows it: the language
 * server over LSP, and the Playground in Monaco. Written once, as hover's text
 * is (`hover-text.ts`), so the two cannot drift.
 */

import type { SignatureHelp } from "../queries/signature-help.js";

/**
 * The text under the signature: the gloss, one line each (Effects §10), then
 * the declaration's documentation — hover's own order — or nothing when there
 * is neither.
 */
export function signatureMarkdown(help: SignatureHelp): string | undefined {
  const parts = [...help.colourOwners ?? [], ...help.documentation === undefined ? [] : [help.documentation]];
  return parts.length === 0 ? undefined : parts.join("\n\n");
}
