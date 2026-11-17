/**
 * The leading bars Format document adds (Canonical Layout §16).
 *
 * A union whose alternatives stand one to a line beneath its `=`, each
 * beginning a line of its own, leads its first alternative with `|` as it
 * leads the others, a lone alternative included. No other union gains one,
 * and no bar is ever removed. The bar changes no tree (Unions §2).
 */

import { read, type Reading } from "./analysis.js";
import type * as Lexed from "../syntax/lexed/index.js";

/** Adds §16's leading bars to a document that parses. */
export function addBars(text: string): string {
  const reading = read(text);
  if (reading.syntaxError) return text;
  const sites = barSites(reading);
  if (sites.size === 0) return text;
  const tokens = reading.lexed.tokens;
  let out = "";
  let from = 0;
  for (const index of [...sites].sort((left, right) => left - right)) {
    const offset = tokens[index]!.span.start.offset;
    out += text.slice(from, offset) + "| ";
    from = offset;
  }
  return out + text.slice(from);
}

const cache = new WeakMap<Reading, ReadonlySet<number>>();

/**
 * The tokens §16 would put a leading bar before, by index: the first token of
 * the first alternative of each union it covers that has no bar yet. A line's
 * length counts the bar whether or not it is written (§9.2).
 */
export function barSites(reading: Reading): ReadonlySet<number> {
  const known = cache.get(reading);
  if (known !== undefined) return known;
  const sites = new Set<number>();
  if (!reading.syntaxError) {
    const tokens = reading.lexed.tokens;
    const starts = new Map<number, number>();
    tokens.forEach(({ span }, index) => starts.set(span.start.offset, index));
    for (const module of reading.modules) {
      for (const item of module.items) {
        if (item.kind !== "Union") continue;
        const site = siteOf(tokens, starts, item);
        if (site !== undefined) sites.add(site);
      }
    }
  }
  cache.set(reading, sites);
  return sites;
}

function siteOf(
  tokens: readonly Lexed.Token[],
  starts: ReadonlyMap<number, number>,
  item: { readonly span: { readonly start: { readonly offset: number } }; readonly constructors: readonly { readonly span: { readonly start: { readonly offset: number } } }[] },
): number | undefined {
  // `union` itself, not a foreign enum written in a union's shape.
  let head = starts.get(item.span.start.offset);
  if (head === undefined) return undefined;
  if (tokens[head]!.kind === "Export") head += 1;
  const word = (index: number): string | undefined => {
    const token = tokens[index];
    return token !== undefined && "text" in token ? (token as { readonly text: string }).text : undefined;
  };
  if (word(head) === "opaque") head += 1;
  if (word(head) !== "union") return undefined;
  const firsts = item.constructors.map(({ span }) => starts.get(span.start.offset));
  if (firsts.length === 0 || firsts.some((first) => first === undefined)) return undefined;
  // Each alternative, with its bar where it has one, begins a line of its own.
  const beginsLine = (index: number): boolean =>
    index === 0 || tokens[index - 1]!.span.end.line < tokens[index]!.span.start.line;
  const leads = firsts.map((first) => tokens[first! - 1]?.kind === "Bar" ? first! - 1 : first!);
  if (!leads.every(beginsLine)) return undefined;
  const first = firsts[0]!;
  // Already led by its bar.
  if (leads[0] !== first) return undefined;
  return first;
}
