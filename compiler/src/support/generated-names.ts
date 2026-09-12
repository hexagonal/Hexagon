/** The fixed JavaScript and declaration-file binding for a suffix pattern. */
export function patternExportName(name: string): string {
  return `__patt_${name}`;
}
