export interface TextEdit {
  readonly text: string;
  readonly caret: number;
}

/** Inserts a line break carrying the current line's leading spaces. */
export function insertIndentedLineBreak(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextEdit {
  const lineStart = Math.max(
    text.lastIndexOf("\n", selectionStart - 1),
    text.lastIndexOf("\r", selectionStart - 1),
  ) + 1;
  const beforeCaret = text.slice(lineStart, selectionStart);
  const indentation = beforeCaret.match(/^ */u)?.[0] ?? "";
  const insertion = `\n${indentation}`;

  return {
    text: text.slice(0, selectionStart) + insertion + text.slice(selectionEnd),
    caret: selectionStart + insertion.length,
  };
}
