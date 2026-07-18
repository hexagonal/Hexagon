import type { LocatedDiagnostic } from "./diagnostics";
import type { TypeOccurrence } from "./protocol";

export interface TextEdit {
  readonly text: string;
  readonly caret: number;
}

export interface EditorSubscription {
  dispose(): void;
}

export type EditorTheme = "dark" | "light";

/** Common source-editor boundary shared by Monaco and the textarea fallback. */
export interface SourceEditor {
  getSource(): string;
  setSource(source: string): void;
  focus(): void;
  selectOffsets(startOffset: number, endOffset: number): void;
  onDidChange(listener: () => void): EditorSubscription;
  publishDiagnostics(diagnostics: readonly LocatedDiagnostic[]): void;
  publishTypes(types: readonly TypeOccurrence[]): void;
  setTheme(theme: EditorTheme): void;
  dispose(): void;
}

/** Read-only generated-code boundary; plain text remains the startup fallback. */
export interface GeneratedCodeEditor {
  show(language: "javascript" | "typescript", source: string): void;
  hide(): void;
  setTheme(theme: EditorTheme): void;
  dispose(): void;
}

/** Keeps unsupported narrow or touch-first environments on the textarea path. */
export function supportsMonacoEditor(
  hasFinePointer: boolean,
  viewportWidth: number,
): boolean {
  return hasFinePointer && viewportWidth > 760;
}

/** Adapts the always-available textarea without leaking DOM details to the app. */
export function createTextareaSourceEditor(
  element: HTMLTextAreaElement,
): SourceEditor {
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const handleInput = (): void => notify();
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" || event.isComposing) return;

    event.preventDefault();
    const edit = insertIndentedLineBreak(
      element.value,
      element.selectionStart,
      element.selectionEnd,
    );
    element.value = edit.text;
    element.setSelectionRange(edit.caret, edit.caret);
    notify();
  };
  element.addEventListener("input", handleInput);
  element.addEventListener("keydown", handleKeyDown);

  return {
    getSource: () => element.value,
    setSource: (source) => {
      element.value = source;
    },
    focus: () => element.focus(),
    selectOffsets: (startOffset, endOffset) => {
      element.setSelectionRange(startOffset, endOffset);
    },
    onDidChange: (listener) => {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    publishDiagnostics: () => {},
    publishTypes: () => {},
    setTheme: () => {},
    dispose: () => {
      listeners.clear();
      element.removeEventListener("input", handleInput);
      element.removeEventListener("keydown", handleKeyDown);
    },
  };
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
