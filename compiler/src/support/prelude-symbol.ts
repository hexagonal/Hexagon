/**
 * One export of one prelude module, as a **single module** sees it.
 *
 * The symbol is read off the synthesized prelude import, which is where the
 * resolver records the identity a bare or qualified reference landed on: both
 * spellings resolve to the one symbol (Modules §6.4), so one check covers both,
 * and an occluding module's own binding has a different symbol and never
 * matches (Modules §5.4).
 *
 * It lives here rather than in either pass because two passes ask it of the
 * same program and must not answer differently — the checker refuses the
 * release seat `JsValue.from` (FFI Part 11 §2) at exactly the binding the
 * emitter erases, and `Prelude.ignore`'s emission reads the same channel. One
 * membership function at every door: a second copy is a second answer waiting
 * to drift. `Core.ImportItem` **is** `Resolved.ImportItem`, so the one signature
 * serves both trees.
 *
 * Absent inside the declaring module itself, which has no import of its own to
 * read — the self-blindness the prelude tables document — with no fallback
 * because none is owed: no prelude member calls the name it declares, and a
 * missing entry costs an un-erased call rather than a wrong one.
 */

import type * as Resolved from "../syntax/resolved/index.js";

export function preludeExportSymbol(
  imports: readonly Resolved.ImportItem[],
  basename: string,
  exported: string,
): Resolved.SymbolId | undefined {
  for (const item of imports) {
    if (!item.synthesized) continue;
    if (item.form.kind !== "Named") continue;
    if (item.specifier.slice(item.specifier.lastIndexOf("/") + 1) !== basename) continue;
    for (const name of item.form.names) {
      if (name.imported === exported && name.typeOnly !== true) return name.symbol;
    }
  }
  return undefined;
}
