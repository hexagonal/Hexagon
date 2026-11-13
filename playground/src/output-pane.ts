/**
 * What the results pane's Output tab shows for a run (`spec/program-io.md` §6):
 * the text the program wrote, in the order it wrote it, with stderr's marked,
 * then the playground's own notes, such as an exit status that isn't 0.
 */

/** One stretch of the pane: program text from one stream, or a note of ours. */
export interface OutputChunk {
  readonly stream: "stdout" | "stderr" | "note";
  readonly text: string;
}

/** The pane's text for one stream, ready to show as a run of one style. */
export interface OutputSegment {
  readonly stream: OutputChunk["stream"];
  readonly text: string;
}

/**
 * The chunks as the pane shows them. Neighbouring chunks of one stream join,
 * since text need not end a line, and a note always starts a line of its own.
 */
export function outputSegments(chunks: readonly OutputChunk[]): readonly OutputSegment[] {
  const segments: OutputSegment[] = [];
  let atLineStart = true;
  for (const chunk of chunks) {
    if (chunk.text === "") continue;
    const text: string = chunk.stream !== "note"
      ? chunk.text
      : atLineStart ? `${chunk.text}\n` : `\n${chunk.text}\n`;
    const last = segments.at(-1);
    if (last !== undefined && last.stream === chunk.stream) {
      segments[segments.length - 1] = { stream: chunk.stream, text: last.text + text };
    } else {
      segments.push({ stream: chunk.stream, text });
    }
    atLineStart = text.endsWith("\n");
  }
  return segments;
}

/** The note a finished run adds: its status, when it isn't 0. */
export function exitStatusNote(status: number): OutputChunk | undefined {
  return status === 0 ? undefined : { stream: "note", text: `Exit status ${status}.` };
}
