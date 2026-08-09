/**
 * Module-graph path arithmetic, shared by the passes that have to *name* one
 * module from inside another.
 *
 * It lives in `support` rather than in `project.ts` because it now has two
 * consumers that cannot see each other: whole-project orchestration, which
 * writes the relative specifier a prelude import is emitted with, and the
 * checker, whose Collections Part 5 §3.3 diagnostic names the *file* a nominal
 * was declared in. `project.ts` imports the checker, so the checker cannot
 * import `project.ts`, and a second copy of this arithmetic would be wrong only
 * for the paths the two copies disagreed about — exactly the drift the
 * `resolveSpecifier` comment already refuses for the inverse direction.
 */

/**
 * The `./`- or `../`-prefixed route from the module at `from` to the path
 * `toParts` names, `toParts` already split and stripped of empty segments.
 *
 * The comparison stops one short of `toParts`'s end because the last segment is
 * the target *file*, never a directory the two paths could share.
 */
function relativeRoute(from: string, toParts: readonly string[]): string {
  const fromDirectory = from.split("/").slice(0, -1).filter((part) => part !== "");
  let index = 0;
  while (
    index < fromDirectory.length &&
    index < toParts.length - 1 &&
    fromDirectory[index] === toParts[index]
  ) {
    index += 1;
  }
  const up = fromDirectory.length - index;
  const down = toParts.slice(index).join("/");
  return up > 0 ? `${"../".repeat(up)}${down}` : `./${down}`;
}

/**
 * A relative **import specifier** `from` a module to the `to` path, inverse to
 * `resolveSpecifier`. Extensionless, because that is how Hexagon source spells
 * an import.
 */
export function relativeSpecifier(from: string, to: string): string {
  return relativeRoute(from, to.replace(/\.hex$/u, "").split("/").filter((part) => part !== ""));
}

/**
 * A relative **file path** `from` a module to the `to` path, extension intact.
 *
 * The distinction from `relativeSpecifier` is not cosmetic: a diagnostic that
 * tells the user which file to open is naming a file (`./bag.hex`), while an
 * import specifier names a module (`./bag`). Collections Part 5 §3.3 spells the
 * former, deliberately — "the message names a file, not an import specifier".
 */
export function relativeFilePath(from: string, to: string): string {
  return relativeRoute(from, to.split("/").filter((part) => part !== ""));
}
