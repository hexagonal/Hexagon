import type { Diagnostics, Source } from "../../compiler/src/index.js";

export function renderDiagnostic(
  diagnostic: Diagnostics.Diagnostic,
  sources: ReadonlyMap<number, Source.File>,
): string {
  const source = sources.get(Number(diagnostic.primary.fileId));
  const path = source?.path ?? `<source ${Number(diagnostic.primary.fileId)}>`;
  const position = diagnostic.primary.start;
  const output = [
    `${path}:${position.line + 1}:${position.column + 1}: ${diagnostic.severity}: ${diagnostic.message}`,
  ];
  if (source !== undefined) output.push(...excerpt(source, diagnostic.primary, ""));
  for (const label of diagnostic.labels ?? []) {
    const labelSource = sources.get(Number(label.span.fileId));
    if (labelSource === undefined) {
      output.push(`  = ${label.message}`);
      continue;
    }
    output.push(
      `  --> ${labelSource.path}:${label.span.start.line + 1}:${label.span.start.column + 1}`,
      ...excerpt(labelSource, label.span, label.message),
    );
  }
  for (const note of diagnostic.notes ?? []) output.push(`  = note: ${note}`);
  return output.join("\n");
}

function excerpt(source: Source.File, span: Source.Span, label: string): readonly string[] {
  const line = source.text.split(/\r\n|\r|\n/u)[span.start.line] ?? "";
  const lineNumber = String(span.start.line + 1);
  const width = lineNumber.length;
  const end = span.end.line === span.start.line ? span.end.column : line.length;
  const carets = "^".repeat(Math.max(1, end - span.start.column));
  return [
    `${" ".repeat(width)} |`,
    `${lineNumber} | ${line}`,
    `${" ".repeat(width)} | ${" ".repeat(span.start.column)}${carets}${label === "" ? "" : ` ${label}`}`,
  ];
}

export function renderSeatedProblem(problem: {
  readonly path: string;
  readonly line: number;
  readonly message: string;
  readonly severity: "error" | "warning";
}, text: string | undefined): string {
  const output = [`${problem.path}:${problem.line + 1}:1: ${problem.severity}: ${problem.message}`];
  const sourceLine = text?.split(/\r\n|\r|\n/u)[problem.line];
  if (sourceLine !== undefined) {
    const number = String(problem.line + 1);
    output.push(`${" ".repeat(number.length)} |`, `${number} | ${sourceLine}`, `${" ".repeat(number.length)} | ^`);
  }
  return output.join("\n");
}
