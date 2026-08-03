import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import onigWasmUrl from "vscode-oniguruma/release/onig.wasm?url";

import type { LocatedDiagnostic } from "./diagnostics";
import type {
  EditorSubscription,
  EditorTheme,
  GeneratedCodeEditor,
  SourceEditor,
} from "./editor";
import type { LanguageServices } from "./language-services";
import type { PlaygroundTextEdit, TypeOccurrence } from "./protocol";
import {
  createGrammarLoader,
  createTokensProvider,
  hexagonLanguage,
  hexagonScopeName,
  javascriptLanguage,
  javascriptScopeName,
  typescriptLanguage,
  typescriptScopeName,
} from "./monaco-textmate";
import { defineHexagonThemes, hexagonDarkTheme, hexagonLightTheme } from "./monaco-theme";

globalThis.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

/**
 * The Oniguruma regex engine, as WASM. This is the whole cost of tokenizing with the
 * VS Code grammar rather than a second hand-written one, and it is a marginal addition
 * to a page that already ships Monaco. `loadWASM` may be called only once per document.
 */
const onigLib = (async () => {
  await loadWASM(await fetch(onigWasmUrl));
  return {
    createOnigScanner: (sources: string[]) => new OnigScanner(sources),
    createOnigString: (text: string) => new OnigString(text),
  };
})();

monaco.languages.register({ id: hexagonLanguage, extensions: [".hex"] });

// Monaco accepts a promise here and repaints when it settles, so the editor opens on
// the first keystroke rather than waiting on the WASM. Until then the pane is unpainted
// — never mispainted.
//
// A failure to load leaves it unpainted permanently, which is a degradation the
// textarea fallback does not cover: Monaco itself started fine, so there is nothing to
// fall back from. Monaco attaches no rejection handler to this promise, so a rethrow
// would surface only as an unhandled rejection and again on dispose. It settles with an
// inert tokenizer instead, and says why once — an editor that silently stops colouring
// is a confusing thing to debug from a screenshot.
const unpainted: monaco.languages.TokensProvider = {
  getInitialState: () => ({ clone: () => unpainted.getInitialState(), equals: () => true }),
  tokenize: (_line, state) => ({ tokens: [{ startIndex: 0, scopes: "" }], endState: state }),
};

const loadGrammar = createGrammarLoader(onigLib);

const tokensProvider = (scopeName: string, languageId: string) =>
  loadGrammar(scopeName)
    .then((grammar) => createTokensProvider(scopeName, grammar))
    .catch((cause: unknown) => {
      console.error(`${languageId} syntax highlighting is unavailable`, cause);
      return unpainted;
    });

// The source editor is on screen from the first frame, so its grammar is asked for now.
monaco.languages.setTokensProvider(
  hexagonLanguage,
  tokensProvider(hexagonScopeName, hexagonLanguage),
);

// The generated panes ask for theirs only when Monaco first has a model of that
// language to tokenize, rather than when this module is evaluated. Passing a promise to
// `setTokensProvider` would have to build it here, which starts both fetches during
// startup, alongside the Oniguruma WASM the visible editor is waiting on.
//
// Worth being exact about what that does and does not save today: the JS pane is the
// default tab and `createMonacoEditors` builds both models up front, so in practice
// both grammars are still fetched during startup — just after the source editor is
// running rather than in competition with it. The saving becomes real if the panes are
// ever modelled lazily, and the registration is demand-driven either way.
//
// This also displaces the Monarch tokenizers the `basic-languages` contributions
// registered for these ids, because it is the same registry slot: both land in
// `TokenizationRegistry.registerFactory`, which drops whatever factory it finds already
// there. Ours wins by running second — the imports at the top of this file are
// evaluated before its body. The contributions keep the jobs Monarch is still the only
// source for: registering the ids at all, and supplying each language's brackets,
// comments, and folding rules.
for (const [languageId, scopeName] of [
  [javascriptLanguage, javascriptScopeName],
  [typescriptLanguage, typescriptScopeName],
] as const) {
  monaco.languages.registerTokensProviderFactory(languageId, {
    create: () => tokensProvider(scopeName, languageId),
  });
}

defineHexagonThemes(monaco.editor);

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
  services: LanguageServices,
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
    javascriptLanguage,
  );
  const declarationsModel = replaceModel(
    "inmemory://hexagon/main.d.ts",
    "",
    typescriptLanguage,
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
  const providers = registerLanguageProviders(sourceModel, services);
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
      providers.dispose();
      changeSubscription.dispose();
      changeListeners.clear();
      sourceEditor.dispose();
      sourceModel.dispose();
    },
  };

  const generatedAdapter: GeneratedCodeEditor = {
    show: (language, generatedSource) => {
      const model = language === javascriptLanguage ? javascriptModel : declarationsModel;
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

/**
 * Every editor service, backed by the session in the compiler worker.
 *
 * All of them answer about one model — the source editor's — because that is the
 * only Hexagon document the Playground has. The generated panes are JavaScript
 * and TypeScript, and the check is not defensive: a provider is registered
 * against a *language*, so anything else opened as `hexagon` would reach these
 * too and be asked about text the worker has never seen.
 *
 * A refusal is a result, not a failure, so it is passed through rather than
 * filtered out. How far it then gets differs by feature, and #222 assumed
 * otherwise — the assumption is recorded here because the code looks like it
 * works and does not.
 *
 * A **rename** refusal is shown. `rename.js` collects `rejectReason` from
 * `resolveRenameLocation` and shows it at the cursor, and from
 * `provideRenameEdits` as a notification.
 *
 * A **code action** refusal is shown only under `Refactor…`. Monaco 0.55.1
 * partitions an action set into `allActions` and `validActions =
 * allActions.filter(a => !a.disabled)` (`codeAction.js:69`), and reaches for
 * `allActions` only when `includeDisabledActions` — which is
 * `!!trigger.filter?.include` (`codeActionController.js:176`). Quick Fix passes
 * no filter (`codeActionCommands.js:65`), and the lightbulb hides itself on
 * `validActions.length <= 0` (`lightBulbWidget.js:168`). So a diagnostic whose
 * only repair is refused shows no lightbulb, and `Ctrl+.` on it says "No code
 * actions available" — the reason the session went to the trouble of computing
 * is dropped by the host. Issue #253 carries the fix; nothing here can force it,
 * because an enabled action that silently does nothing is worse than a missing
 * one.
 */
function registerLanguageProviders(
  sourceModel: monaco.editor.ITextModel,
  services: LanguageServices,
): monaco.IDisposable {
  const owns = (model: monaco.editor.ITextModel): boolean => model === sourceModel;
  const registrations = [
    monaco.languages.registerHoverProvider(hexagonLanguage, {
      provideHover: async (model, position) => {
        if (!owns(model)) return undefined;
        const hover = await services.hover(
          model.getValue(),
          model.getOffsetAt(position),
        );
        if (hover === undefined) return undefined;
        return {
          contents: [{ value: hover.markdown }],
          range: rangeFromOffsets(model, hover.range.startOffset, hover.range.endOffset),
        };
      },
    }),
    monaco.languages.registerCodeActionProvider(
      hexagonLanguage,
      {
        provideCodeActions: async (model, range) => {
          if (!owns(model)) return undefined;
          const actions = await services.codeActions(model.getValue(), {
            startOffset: model.getOffsetAt(range.getStartPosition()),
            endOffset: model.getOffsetAt(range.getEndPosition()),
          });
          return {
            actions: actions.map((action) => ({
              title: action.title,
              kind: action.kind,
              ...(action.disabled === undefined
                ? { edit: workspaceEdit(model, action.edits) }
                : { disabled: action.disabled }),
            })),
            dispose: () => {},
          };
        },
      },
      // Declared so Monaco can skip this provider for a request it cannot
      // satisfy — which today means only the `source.*` actions (Organize
      // Imports and friends), since the automatic trigger asks with no filter
      // at all and reaches every provider regardless.
      //
      // What the declaration does buy unconditionally is the other half:
      // Monaco filters the returned actions by kind itself
      // (`codeAction.js`'s `filtersAction`), which is why `context.only` is
      // not read below. One owner for the rule, and it is not this file.
      { providedCodeActionKinds: ["quickfix", "refactor"] },
    ),
    monaco.languages.registerDefinitionProvider(hexagonLanguage, {
      provideDefinition: async (model, position) => {
        if (!owns(model)) return undefined;
        const ranges = await services.definitions(
          model.getValue(),
          model.getOffsetAt(position),
        );
        return ranges.map((found) => ({
          uri: model.uri,
          range: rangeFromOffsets(model, found.startOffset, found.endOffset),
        }));
      },
    }),
    monaco.languages.registerReferenceProvider(hexagonLanguage, {
      provideReferences: async (model, position) => {
        if (!owns(model)) return undefined;
        const ranges = await services.references(
          model.getValue(),
          model.getOffsetAt(position),
        );
        return ranges.map((found) => ({
          uri: model.uri,
          range: rangeFromOffsets(model, found.startOffset, found.endOffset),
        }));
      },
    }),
    monaco.languages.registerRenameProvider(hexagonLanguage, {
      // Asked before the user is prompted, so a name that cannot move says so
      // rather than opening a box whose every keystroke is going to be refused.
      resolveRenameLocation: async (model, position) => {
        if (!owns(model)) return undefined;
        const subject = await services.prepareRename(
          model.getValue(),
          model.getOffsetAt(position),
        );
        if (subject === undefined) return undefined;
        if ("refused" in subject) {
          const caret = new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          );
          return { range: caret, text: "", rejectReason: subject.refused };
        }
        return {
          range: rangeFromOffsets(
            model,
            subject.range.startOffset,
            subject.range.endOffset,
          ),
          text: subject.name,
        };
      },
      provideRenameEdits: async (model, position, newName) => {
        // Not `{ edits: [] }`: Monaco reads any object without a `rejectReason`
        // as this provider's accepted answer and stops asking the rest, so an
        // empty one would be a silent successful no-op rather than a pass.
        if (!owns(model)) return undefined;
        const result = await services.rename(
          model.getValue(),
          model.getOffsetAt(position),
          newName,
        );
        if (result === undefined) {
          return { edits: [], rejectReason: "there is no name here to rename" };
        }
        if ("refused" in result) return { edits: [], rejectReason: result.refused };
        return { edits: workspaceEdit(model, result.edits).edits };
      },
    }),
  ];
  return { dispose: () => registrations.forEach((registration) => registration.dispose()) };
}

/**
 * Edits against one model, stamped with the version they were computed for.
 *
 * `versionId` is the last guard on a race the worker's own version check does
 * not cover: a reply can be current when it arrives and stale by the time the
 * user picks the action out of the lightbulb menu. Monaco validates every edit
 * in the set before applying any of them, so the document is never half
 * rewritten against text that has moved underneath it — but the standalone bulk
 * editor signals the mismatch by throwing (`standaloneServices.js`), which
 * surfaces as an unhandled rejection rather than a message. Loud and safe beats
 * quiet and wrong; making it quiet is the host's job, not this function's.
 */
function workspaceEdit(
  model: monaco.editor.ITextModel,
  edits: readonly PlaygroundTextEdit[],
): monaco.languages.WorkspaceEdit {
  const versionId = model.getVersionId();
  return {
    edits: edits.map((edit) => ({
      resource: model.uri,
      versionId,
      textEdit: {
        range: rangeFromOffsets(model, edit.startOffset, edit.endOffset),
        text: edit.replacement,
      },
    })),
  };
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

function toMonacoTheme(theme: EditorTheme): string {
  return theme === "dark" ? hexagonDarkTheme : hexagonLightTheme;
}
