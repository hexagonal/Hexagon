import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js";

import type { LocatedDiagnostic } from "./diagnostics";
import type {
  EditorSubscription,
  EditorTheme,
  GeneratedCodeEditor,
  SourceEditor,
} from "./editor";
import type { TypeOccurrence } from "./protocol";
import { hexagonLanguage, hexagonTokens } from "./monaco-language";

globalThis.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

monaco.languages.register({ id: hexagonLanguage, extensions: [".hex"] });
monaco.languages.setMonarchTokensProvider(hexagonLanguage, hexagonTokens);

export interface MonacoEditors {
  readonly source: SourceEditor;
  readonly generated: GeneratedCodeEditor;
}

/** Starts Monaco atomically so a failure leaves the textarea fully operational. */
export function createMonacoEditors(
  textarea: HTMLTextAreaElement,
  sourceContainer: HTMLElement,
  generatedContainer: HTMLElement,
  source: string,
  theme: EditorTheme,
  showTypesAtCaret: boolean,
): MonacoEditors {
  const sourceModel = replaceModel("inmemory://hexagon/main.hex", source, hexagonLanguage);
  const sourceEditor = monaco.editor.create(sourceContainer, {
    model: sourceModel,
    automaticLayout: true,
    fontSize: 14,
    insertSpaces: true,
    minimap: { enabled: false },
    padding: { top: 14 },
    scrollBeyondLastLine: false,
    tabSize: 4,
    theme: toMonacoTheme(theme),
  });
  const javascriptModel = replaceModel(
    "inmemory://hexagon/main.js",
    "",
    "javascript",
  );
  const declarationsModel = replaceModel(
    "inmemory://hexagon/main.d.ts",
    "",
    "typescript",
  );
  const generatedEditor = monaco.editor.create(generatedContainer, {
    model: javascriptModel,
    automaticLayout: true,
    fontSize: 14,
    minimap: { enabled: false },
    padding: { top: 14 },
    readOnly: true,
    renderLineHighlight: "none",
    scrollBeyondLastLine: false,
    theme: toMonacoTheme(theme),
  });

  sourceContainer.hidden = false;
  textarea.hidden = true;

  let types: readonly TypeOccurrence[] = [];
  let suppressChanges = false;
  let caretTypeActivated = false;
  let disposed = false;
  const changeListeners = new Set<() => void>();
  const changeSubscription = sourceModel.onDidChangeContent(() => {
    if (suppressChanges) return;
    for (const listener of changeListeners) listener();
  });
  const hoverProvider = monaco.languages.registerHoverProvider(hexagonLanguage, {
    provideHover: (model, position) => {
      if (model !== sourceModel) return undefined;
      const offset = model.getOffsetAt(position);
      const occurrence = typeOccurrenceAtOffset(types, offset, showTypesAtCaret);
      if (occurrence === undefined) return undefined;
      return {
        contents: [{ value: `\`${occurrence.name} : ${occurrence.displayedType}\`` }],
        range: rangeFromOffsets(model, occurrence.startOffset, occurrence.endOffset),
      };
    },
  });
  const showTypeAtCaret = (): void => {
    const position = sourceEditor.getPosition();
    if (position === null) return;
    const offset = sourceModel.getOffsetAt(position);
    if (typeOccurrenceAtOffset(types, offset, true) === undefined) return;
    queueMicrotask(() => {
      if (disposed) return;
      sourceEditor.trigger(
        "hexagon.ipadTypeAtCaret",
        "editor.action.showHover",
        undefined,
      );
    });
  };
  const cursorSubscription = showTypesAtCaret
    ? sourceEditor.onDidChangeCursorPosition(() => {
        caretTypeActivated = true;
        showTypeAtCaret();
      })
    : undefined;

  const sourceAdapter: SourceEditor = {
    getSource: () => sourceModel.getValue(),
    setSource: (nextSource) => {
      if (sourceModel.getValue() === nextSource) return;
      suppressChanges = true;
      sourceModel.setValue(nextSource);
      suppressChanges = false;
    },
    focus: () => sourceEditor.focus(),
    selectOffsets: (startOffset, endOffset) => {
      const range = rangeFromOffsets(sourceModel, startOffset, endOffset);
      sourceEditor.setSelection(range);
      sourceEditor.revealRangeInCenterIfOutsideViewport(range);
    },
    onDidChange: (listener): EditorSubscription => {
      changeListeners.add(listener);
      return { dispose: () => void changeListeners.delete(listener) };
    },
    publishDiagnostics: (diagnostics) => {
      monaco.editor.setModelMarkers(
        sourceModel,
        "hexagon",
        diagnostics.map((diagnostic) => markerFromDiagnostic(sourceModel, diagnostic)),
      );
    },
    publishTypes: (nextTypes) => {
      types = nextTypes;
      if (caretTypeActivated) showTypeAtCaret();
    },
    setTheme: (nextTheme) => monaco.editor.setTheme(toMonacoTheme(nextTheme)),
    dispose: () => {
      disposed = true;
      cursorSubscription?.dispose();
      hoverProvider.dispose();
      changeSubscription.dispose();
      changeListeners.clear();
      sourceEditor.dispose();
      sourceModel.dispose();
    },
  };

  const generatedAdapter: GeneratedCodeEditor = {
    show: (language, generatedSource) => {
      const model = language === "javascript" ? javascriptModel : declarationsModel;
      if (model.getValue() !== generatedSource) model.setValue(generatedSource);
      generatedEditor.setModel(model);
      generatedContainer.hidden = false;
      generatedEditor.layout();
    },
    hide: () => {
      generatedContainer.hidden = true;
    },
    setTheme: (nextTheme) => monaco.editor.setTheme(toMonacoTheme(nextTheme)),
    dispose: () => {
      generatedEditor.dispose();
      javascriptModel.dispose();
      declarationsModel.dispose();
    },
  };

  return { source: sourceAdapter, generated: generatedAdapter };
}

function typeOccurrenceAtOffset(
  types: readonly TypeOccurrence[],
  offset: number,
  includePrevious: boolean,
): TypeOccurrence | undefined {
  const at = (candidate: number): TypeOccurrence | undefined =>
    types.find(({ startOffset, endOffset }) =>
      candidate >= startOffset && candidate < endOffset
    );
  return at(offset) ?? (includePrevious && offset > 0 ? at(offset - 1) : undefined);
}

function replaceModel(uri: string, source: string, language: string): monaco.editor.ITextModel {
  const modelUri = monaco.Uri.parse(uri);
  monaco.editor.getModel(modelUri)?.dispose();
  return monaco.editor.createModel(source, language, modelUri);
}

function markerFromDiagnostic(
  model: monaco.editor.ITextModel,
  diagnostic: LocatedDiagnostic,
): monaco.editor.IMarkerData {
  const range = rangeFromOffsets(model, diagnostic.startOffset, diagnostic.endOffset);
  return {
    ...range,
    message: diagnostic.message,
    severity: toDiagnosticSeverity(diagnostic.severity),
    source: "Hexagon",
  };
}

function rangeFromOffsets(
  model: monaco.editor.ITextModel,
  startOffset: number,
  endOffset: number,
): monaco.Range {
  const boundedStart = Math.min(startOffset, model.getValueLength());
  const boundedEnd = Math.max(boundedStart, Math.min(endOffset, model.getValueLength()));
  const start = model.getPositionAt(boundedStart);
  const end = model.getPositionAt(boundedEnd);
  return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
}

function toDiagnosticSeverity(
  severity: LocatedDiagnostic["severity"],
): monaco.MarkerSeverity {
  switch (severity) {
    case "error":
      return monaco.MarkerSeverity.Error;
    case "warning":
      return monaco.MarkerSeverity.Warning;
    case "information":
      return monaco.MarkerSeverity.Info;
  }
}

function toMonacoTheme(theme: EditorTheme): "vs" | "vs-dark" {
  return theme === "dark" ? "vs-dark" : "vs";
}
