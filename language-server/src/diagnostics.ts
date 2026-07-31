/**
 * Translation of compiler diagnostics into the protocol's shape.
 *
 * The compiler's diagnostics are the semantic source of truth; nothing here
 * decides whether something is wrong, only how to say it over LSP. That means
 * the message text is passed through unchanged — Hexagon's diagnostics are
 * written to be read, and rewording them here would fork the wording that the
 * terminal, the playground, and the editor each show.
 *
 * Two things do have to be decided, because LSP has no direct equivalent:
 *
 * - **Labels and notes.** A compiler diagnostic can carry secondary labels
 *   pointing elsewhere and free-standing notes. Labels become
 *   `relatedInformation`, which editors render as jump-to links. Notes have no
 *   span, so they are appended to the message rather than dropped — losing a
 *   note would lose the sentence that usually explains the fix.
 * - **Fixes.** A diagnostic's structured edits are not published here. They
 *   belong to a code-action request, which a later slice adds; announcing them
 *   as diagnostics would show a user a repair they cannot apply.
 */

import {
  DiagnosticSeverity,
  type Diagnostic as LspDiagnostic,
  type DiagnosticRelatedInformation,
} from "vscode-languageserver";
import type { Diagnostics } from "../../compiler/src/index.js";
import { rangeOfSpan, type UriPaths } from "./positions.js";

const SOURCE = "hexagon";

export function toLspDiagnostic(
  diagnostic: Diagnostics.Diagnostic,
  uris: UriPaths,
  pathOfFile: (fileId: number) => string | undefined,
): LspDiagnostic {
  const related: DiagnosticRelatedInformation[] = [];
  for (const label of diagnostic.labels ?? []) {
    const path = pathOfFile(Number(label.span.fileId));
    if (path === undefined) continue;
    related.push({
      location: { uri: uris.toUri(path), range: rangeOfSpan(label.span) },
      message: label.message,
    });
  }
  const notes = diagnostic.notes ?? [];
  return {
    severity: severityOf(diagnostic.severity),
    range: rangeOfSpan(diagnostic.primary),
    message: notes.length === 0
      ? diagnostic.message
      : [diagnostic.message, ...notes].join("\n\n"),
    source: SOURCE,
    ...(related.length === 0 ? {} : { relatedInformation: related }),
  };
}

function severityOf(severity: Diagnostics.Diagnostic["severity"]): DiagnosticSeverity {
  switch (severity) {
    case "error":
      return DiagnosticSeverity.Error;
    case "warning":
      return DiagnosticSeverity.Warning;
    case "information":
      return DiagnosticSeverity.Information;
  }
}
