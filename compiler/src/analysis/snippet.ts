/**
 * A repair's stand-ins as an editor's snippet: each one a tabstop, the first
 * selected for the dev to type over and Tab moving to the next (language-server
 * decision 5, point 3). LSP 3.18's snippet edits and Monaco's snippet session
 * read the same syntax.
 */

import type * as Diagnostics from "../support/diagnostics.js";
import type * as Source from "../support/source.js";

/** An edit written as a snippet, with the span it replaces. */
export interface Snippet {
  readonly span: Source.Span;
  readonly text: string;
}

/**
 * `edit` as a snippet, or none where it has no stand-ins or no snippet would
 * write what it writes.
 *
 * A snippet is written to begin a line. An editor indents a snippet's later
 * lines by the whitespace before it on its first line (VS Code and Monaco
 * both), and a fill's lines already carry their indentation: at a line's start
 * there is none to add. So an insertion that begins with the line break that
 * ends its line moves past that break, and writes the break after its lines
 * instead, which is the same text. Any other edit that begins inside a line
 * has no snippet, and is applied as written, with nothing selected.
 *
 * Past the last stand-in, Tab leaves the cursor at the end of the last line
 * written (`$0`), not at the start of the line after it.
 */
export function snippetOf(file: Source.File, edit: Diagnostics.Edit): Snippet | undefined {
  const { span, replacement, placeholders } = edit;
  if (placeholders === undefined || placeholders.length === 0) return undefined;
  let start = span.start.offset;
  let written = replacement;
  let shift = 0;
  if (span.start.column !== 0) {
    const lineBreak = /^\r?\n/.exec(replacement)?.[0];
    if (lineBreak === undefined || span.end.offset !== start || !file.text.startsWith(lineBreak, start)) {
      return undefined;
    }
    start += lineBreak.length;
    written = replacement.slice(lineBreak.length) + lineBreak;
    shift = lineBreak.length;
  }
  let text = "";
  let at = 0;
  placeholders.forEach(({ start: from, end: to }, index) => {
    text += `${escape(written.slice(at, from - shift))}\${${index + 1}:${escape(written.slice(from - shift, to - shift))}}`;
    at = to - shift;
  });
  // The final stop ends the last line written, where the dev finished typing:
  // an editor's default, the snippet's end, would be the start of the next.
  const lineEnd = /\r?\n$/.exec(written)?.[0] ?? "";
  text += `${escape(written.slice(at, written.length - lineEnd.length))}$0${lineEnd}`;
  const end = start + span.end.offset - span.start.offset;
  return {
    span: { fileId: span.fileId, start: file.positionAt(start), end: file.positionAt(end) },
    text,
  };
}

/** Text a snippet writes as it stands: `$`, `}` and `\` escaped. */
function escape(text: string): string {
  return text.replace(/[$}\\]/g, "\\$&");
}
