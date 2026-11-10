/**
 * A dot call written as its qualified call: a refactoring between forms the
 * spec defines as one another.
 *
 * `receiver.name(args…)` on a companion operation **is**
 * `CompanionOf(T).name(receiver, args…)` (Method Syntax §1: "After resolution,
 * a dot call is an ordinary qualified function call"). So `s.area()` is
 * `Geo.area(s)` once the checker has resolved the dot to `Geo`'s `area`, and
 * the rewrite asks the checker only which operation the dot reached, never a
 * type of its own.
 *
 * - **Only a companion operation.** A constraint member's qualified spelling
 *   is its open call, where the receiver joins the operands rather than
 *   closing before the dot (§1, §2.2), so the two can type differently; and a
 *   field called through the dot is not a call of the module at all.
 * - **Spelled as this module names it:** the alias of the import that brings
 *   the home module, or the prelude module's own name; in the home module, the
 *   operation's bare name, unless a binder in the item would capture it. A
 *   dot reaching a module this one never imports (§4.2's import-insensitivity)
 *   has no spelling here, and the rewrite is refused naming the import.
 * - **One way only.** The reverse needs the receiver's head decided by the
 *   text (§3.1), which is a question for the checker, not for a rewrite.
 *
 * Each rewrite is checked by parsing what it leaves: the new call must read as
 * the dot call with its receiver moved into the argument list, and the rest of
 * the item as before (`same-reading.ts`).
 */

import * as Source from "../support/source.js";
import type * as Parsed from "../syntax/parsed/index.js";
import type * as Resolved from "../syntax/resolved/index.js";
import type * as Typed from "../syntax/typed/index.js";
import { type Refactoring, rewrite, textOf } from "./rewrite.js";
import { keepsReadingWith, type TextEdit } from "./same-reading.js";

/** The rewrite of the dot call whose `.name` holds `[start, end]`, if it is one. */
export function dotQualifiedRefactorings(
  file: Source.File,
  module: Parsed.Module,
  typed: Typed.Module,
  start: number,
  end: number,
  homes: Homes,
): readonly Refactoring[] {
  const call = dotCallAt(file, module, start, end);
  if (call === undefined) return [];
  const { callee } = call;
  const name = callee.field.text;
  const symbol = companionOperation(typed, call);
  if (symbol === undefined) return [];
  const spelled = spellingOf(typed, symbol, name, call.span.start.offset, homes);
  if (spelled === undefined) return [];
  if ("refused" in spelled) {
    return [{ title: `Write the dot call as \`${spelled.spelling}(…)\``, disabled: spelled.refused }];
  }
  const { spelling } = spelled;
  const title = `Write the dot call as \`${spelling}(…)\``;
  if (!spelling.includes(".")) {
    const item = module.items.find(({ span }) => span.start.offset <= call.span.start.offset && call.span.end.offset <= span.end.offset);
    if (item !== undefined && bindersIn(item).has(name)) {
      return [{ title, disabled: `\`${name}\` is bound here as well, so \`${name}(…)\` could call that instead.` }];
    }
  }
  const open = openParen(file, module, call);
  if (open === undefined) return [];
  const receiver = callee.receiver.kind === "Group" ? callee.receiver.expression : callee.receiver;
  const inner = file.span(open + 1, call.span.end.offset - 1);
  const kept = [receiver.span, inner];
  const mark = call.markSpan === undefined ? "" : textOf(file, call.markSpan);
  // The arguments as written, after the receiver: a comment in an empty list
  // stays where it was, and a list begun on its own line keeps that line.
  const args = file.text.slice(inner.start.offset, inner.end.offset);
  const rest = call.arguments.length === 0
    ? (args.trim() === "" ? "" : ` ${args.trim()}`)
    : `${/^\s/u.test(args) ? "," : ", "}${args}`;
  const text = `${spelling}${mark}(${textOf(file, receiver.span)}${rest})`;
  return [rewrite(file, module, title, call, { texts: [text], kept }, (edit) => readsAsQualified(file, module, edit, call))];
}

export type DotCall = Parsed.CallExpr & { readonly callee: Parsed.AccessExpr };

/** What the spelling asks of the project beyond this module. */
export interface Homes {
  /** This module's full name (Packages §2.3). */
  readonly here: string;
  /** The full name of the module that declares an operation. */
  readonly homeOf: (symbol: Resolved.SymbolId) => string | undefined;
  /** The name this module imports a module by, as the compiler's own import repair writes it. */
  readonly importName: (fullName: string) => string;
}

/**
 * The dot call whose dot or name holds `[start, end]`: a call of `e.name`
 * written with its argument list straight after (Method Syntax §2.1). A field
 * read in parentheses, `(e.name)(…)`, is not one, and its callee is a group.
 */
export function dotCallAt(file: Source.File, module: Parsed.Module, start: number, end: number): DotCall | undefined {
  let found: DotCall | undefined;
  const walk = (node: unknown): void => {
    if (found !== undefined) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.kind === "Call" && (record.callee as Parsed.Expr | undefined)?.kind === "Access") {
      const call = record as unknown as DotCall;
      const { field } = call.callee;
      const dot = file.text.lastIndexOf(".", field.span.start.offset);
      if (dot >= 0 && dot <= start && end <= field.span.end.offset) {
        found = call;
        return;
      }
    }
    for (const key of Object.keys(record)) if (key !== "span") walk(record[key]);
  };
  walk(module.items);
  return found;
}

/**
 * The companion operation the checker resolved this dot call to (Method Syntax
 * §3.4), or `undefined` where it resolved to anything else or to nothing. The
 * checked call is the qualified call the dot is, at the dot call's own span; a
 * pipe stage written as a dot call (`x |> y.f(z)`) is checked at the pipe's,
 * and is never this rewrite's, since moving `y` into the list leaves `x` first.
 */
function companionOperation(typed: Typed.Module, call: DotCall): Resolved.SymbolId | undefined {
  const site = typed.dotSites.find(({ name }) => name.start.offset === call.callee.field.span.start.offset);
  if (site === undefined) return undefined;
  let symbol: Resolved.SymbolId | undefined;
  const walk = (node: unknown): void => {
    if (symbol !== undefined) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.kind === "Call") {
      const checked = record as unknown as Typed.CallExpr;
      if (
        checked.span.start.offset === call.span.start.offset && checked.span.end.offset === call.span.end.offset &&
        checked.callee.kind === "Name"
      ) {
        symbol = checked.callee.symbol;
        return;
      }
    }
    for (const key of Object.keys(record)) if (key !== "span" && key !== "type") walk(record[key]);
  };
  walk(typed.items);
  const operation = site.candidates.find((candidate) => candidate.kind === "Operation" && candidate.symbol === symbol);
  return operation === undefined ? undefined : symbol;
}

/**
 * How this module spells the operation qualified at `at`: through an import
 * above it whose alias reaches the home module (Modules §3.1; an alias is read
 * top-down in term position, §3), or the prelude module's own name where no
 * import's alias takes it (§5.4); bare in the home module itself. Refused, with
 * the spelling it would have had, where this module has no name for it there:
 * the dot reached a module no import here brings (Method Syntax §8.2) or one
 * imported only below the call, or a prelude module whose name an import here
 * gives another.
 */
function spellingOf(
  typed: Typed.Module,
  symbol: Resolved.SymbolId,
  name: string,
  at: number,
  homes: Homes,
): { readonly spelling: string; readonly refused?: string } | undefined {
  const imports = typed.items.filter((item): item is Typed.ImportItem => item.kind === "Import");
  const bringing = imports.filter(({ form }) => form.kind === "Namespace" && form.names.some((each) => each.symbol === symbol));
  const above = bringing.find(({ span }) => span.end.offset <= at);
  if (above?.form.kind === "Namespace") return { spelling: `${above.form.alias}.${name}` };
  for (const { form, moduleName } of imports) {
    if (form.kind !== "Named" || !form.names.some((each) => each.symbol === symbol)) continue;
    // A prelude member is addressable by its full name's last segment,
    // `Hex.Vector` as `Vector`, where no import's alias claims it (§5.4).
    const alias = moduleName.split(".").at(-1)!;
    const spelling = `${alias}.${name}`;
    const taken = imports.find(({ form }) => form.kind === "Namespace" && form.alias === alias);
    return taken === undefined ? { spelling } : {
      spelling,
      refused: `\`${alias}\` here names \`${taken.moduleName}\`, imported as \`${alias}\`, so \`${spelling}(…)\` ` +
        `would not reach the prelude's \`${alias}\`.`,
    };
  }
  const home = homes.homeOf(symbol);
  if (home === undefined) return undefined;
  if (home === homes.here) return { spelling: name };
  const spelling = `${home.split(".").at(-1)}.${name}`;
  const imported = homes.importName(home);
  return {
    spelling,
    refused: bringing.length > 0
      ? `This module imports \`${imported}\` below this call, and an import is read from where it stands (Modules §3). ` +
        `Move \`import ${imported}\` above the call first.`
      : `This module does not import \`${imported}\`, where \`${name}\` is declared. Write \`import ${imported}\` first.`,
  };
}

/**
 * Every name a binder in the item spells: a pattern's, an `as`'s, a
 * parameter's, a local declaration's. A bare call of the operation is safe
 * where its name is none of them, which asks more than scope would and never
 * less: module-level names cannot be rebound, so only these could capture it.
 */
function bindersIn(item: unknown): ReadonlySet<string> {
  const names = new Set<string>();
  const add = (name: unknown): void => {
    const text = (name as Parsed.Name | undefined)?.text;
    if (typeof text === "string") names.add(text);
  };
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (["Binding", "As", "Let", "Var", "Fun"].includes(record.kind as string)) add(record.name);
    if (Array.isArray(record.parameters)) for (const parameter of record.parameters) add((parameter as Parsed.Parameter).name);
    for (const key of Object.keys(record)) if (key !== "span") walk(record[key]);
  };
  walk(item);
  return names;
}

/**
 * Where the call's argument list opens: the first `(` after its name and mark,
 * past spaces, line breaks and comments. Read from the text, since a call
 * inside a string's `${…}` has no tokens of its own in the file's.
 */
function openParen(file: Source.File, module: Parsed.Module, call: DotCall): number | undefined {
  let at = (call.markSpan ?? call.callee.field.span).end.offset;
  for (;;) {
    const comment = module.comments.find(({ span }) => span.start.offset === at);
    if (comment !== undefined) at = comment.span.end.offset;
    else if (/\s/u.test(file.text[at] ?? "")) at += 1;
    else break;
  }
  return file.text[at] === "(" && file.text[call.span.end.offset - 1] === ")" ? at : undefined;
}

/**
 * Whether the edited item reads as before with the dot call read as the
 * qualified call it is: the new call's arguments the dot call's receiver and
 * then its arguments, its mark the dot call's. Exported, with `dotCallAt`, for
 * its tests, which hand it edits the rewrite never writes.
 */
export function readsAsQualified(file: Source.File, module: Parsed.Module, edit: TextEdit, call: DotCall): boolean {
  return keepsReadingWith(file, module, edit, call.span, (before, after) => {
    // The call written spans the replacement, so its callee is the spelling
    // and nothing else, and its mark is read with the rest of it.
    const { receiver } = before.callee as Parsed.AccessExpr;
    return { ...before, callee: after.callee, arguments: [receiver, ...before.arguments] };
  });
}
