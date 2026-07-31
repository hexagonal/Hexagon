/**
 * What a project knows about each of its value symbols, gathered once.
 *
 * Two editor services need the same three facts and neither can get them from
 * the resolved tree alone. `SymbolKind` records how a name was *bound*, not what
 * it holds, and in Hexagon those come apart constantly: `let brighten(colour) =
 * …` is a `let`, `extern fun` and `extern let` are both `extern`, and
 * `let g = f` is a function nobody wrote a parameter list for. Colouring or
 * listing all of those as ordinary bindings is precisely the confident wrongness
 * that resolution-backed answers exist to remove.
 *
 * The checker already knows, and its answer is structural — a `Function` type,
 * not an arrow read out of a rendered string.
 *
 * **Project-wide on purpose.** A function declared in one module and used in
 * another has to look the same in both, and a per-module table would only know
 * the declarations that module could see. Symbol identities are unique across a
 * project, so one table serves every file.
 */

import type * as Resolved from "../syntax/resolved/index.js";
import * as Typed from "../syntax/typed/index.js";

export interface SymbolFacts {
  readonly kind: Resolved.SymbolKind;
  /** Whether the checker's type for this symbol is a function type. */
  readonly functionValued: boolean;
  /** The scheme as a reader sees it, for hover text and completion detail. */
  readonly displayedType: string;
}

export function collectSymbolFacts(
  modules: readonly { readonly typed: Typed.Module }[],
): ReadonlyMap<number, SymbolFacts> {
  const facts = new Map<number, SymbolFacts>();
  for (const { typed } of modules) {
    for (const symbol of typed.symbols) {
      // First writer wins: a module's `symbols` carries imported symbols too, so
      // the same identity is seen once per importer, and every copy agrees.
      if (facts.has(Number(symbol.id))) continue;
      facts.set(Number(symbol.id), {
        kind: symbol.kind,
        functionValued: symbol.scheme.type.kind === "Function",
        displayedType: Typed.displayScheme(symbol.scheme),
      });
    }
  }
  return facts;
}
