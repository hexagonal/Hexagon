import type { PlaygroundDiagnostic } from "./protocol";

export interface LocatedDiagnostic extends PlaygroundDiagnostic {
  readonly line: number;
  readonly column: number;
}

/** Adds one-based source coordinates while retaining the compiler's exact offsets. */
export function locateDiagnostic(
  source: string,
  diagnostic: PlaygroundDiagnostic,
): LocatedDiagnostic {
  const before = source.slice(0, diagnostic.startOffset);
  const lastLineBreak = Math.max(
    before.lastIndexOf("\n"),
    before.lastIndexOf("\r"),
  );
  return {
    ...diagnostic,
    line: before.split(/\r\n|\r|\n/u).length,
    column: diagnostic.startOffset - lastLineBreak,
  };
}

export function formatLocatedDiagnostic(diagnostic: LocatedDiagnostic): string {
  return `${diagnostic.severity} at ${diagnostic.line}:${diagnostic.column} — ${diagnostic.message}`;
}
