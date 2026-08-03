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
import type { BufferRange } from "./protocol";
import {
  boundedOffsets,
  codeActionKinds,
  hoverAnswersAtOffset,
  toCodeAction,
  toRenameEdits,
  toRenameLocation,
  type EditTarget,
  type MappedCodeAction,
  type MappedRenameLocation,
} from "./monaco-mapping";
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

/**
 * How long the caret must rest before the hover opens itself.
 *
 * Long enough that typing a word does not ask the worker once per character —
 * every keystroke moves the caret — and short enough that tapping a name and
 * looking at it does not feel like waiting. It sits under the 200ms the compile
 * is debounced by, so a pause answers the hover first.
 */
const CARET_HOVER_DELAY_MS = 150;

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
  hoverFollowsCaret: boolean,
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

  let hoverSpans: readonly BufferRange[] = [];
  /**
   * The model version `hoverSpans` describes, so text they no longer describe
   * cannot be gated on. Absent until the first answer arrives.
   */
  let hoverSpansVersion: number | undefined;
  let caretHoverTimer: ReturnType<typeof setTimeout> | undefined;
  let suppressChanges = false;
  let disposed = false;
  const changeListeners = new Set<() => void>();
  const changeSubscription = sourceModel.onDidChangeContent(() => {
    if (suppressChanges) return;
    for (const listener of changeListeners) listener();
  });
  const providers = registerLanguageProviders(sourceModel, services);
  /**
   * Opens the hover where a pointer would have, for a device with no pointer.
   *
   * Three things this has to get right, and #254 is the record of getting the
   * first two wrong.
   *
   * **What it gates on.** The session's own answer, asked for as a set of spans
   * (`hoverSpans`). It used to gate on the compile's type-occurrence table,
   * which answers a different question — where a *value* has a displayable type
   * — and so opened an empty hover on a record field and stayed shut on an
   * `export opaque` type parameter, a union's name, and a constraint in an
   * `honor` head. A gate not derived from the answer drifts from it; this one
   * is the answer, sampled.
   *
   * **How it asks Monaco.** `editor.action.showHover` defaults to
   * `HoverFocusOption.FocusIfVisible`, and with a hover already open that
   * *focuses the widget* rather than re-asking the provider — so the caret
   * would move, the hover would keep the old name's answer, and keyboard focus
   * would leave the text. `noAutoFocus` takes the branch that re-asks
   * (`hoverActions.js`), which is the whole intent: follow the caret.
   *
   * **What it costs.** One worker round trip per settled document, not per
   * keystroke. The spans are cached against the model version they describe, so
   * moving the caret around unchanged text asks nothing, and the debounce keeps
   * a burst of typing from asking at all until it stops. The session behind the
   * request holds its analysis until a file changes, so the hover that follows
   * is a lookup rather than a second project analysis.
   */
  const openHoverAtCaret = async (): Promise<void> => {
    const version = sourceModel.getVersionId();
    if (hoverSpansVersion !== version) {
      const spans = await services.hoverSpans(sourceModel.getValue());
      // The editor may have been torn down, or the user may have typed while
      // the worker was answering. Either way this answer describes text nobody
      // is looking at; the edit's own caret move has already scheduled another.
      if (disposed || sourceModel.getVersionId() !== version) return;
      hoverSpans = spans;
      hoverSpansVersion = version;
    }
    const position = sourceEditor.getPosition();
    if (position === null) return;
    if (!hoverAnswersAtOffset(hoverSpans, sourceModel.getOffsetAt(position))) return;
    sourceEditor.trigger("hexagon.ipadTypeAtCaret", "editor.action.showHover", {
      focus: "noAutoFocus",
    });
  };
  const cursorSubscription = hoverFollowsCaret
    ? sourceEditor.onDidChangeCursorPosition(() => {
        // Every caret move restarts the wait, including the ones a keystroke
        // causes. Typing therefore asks nothing until the user pauses, which is
        // also the only time an automatic hover would be wanted.
        if (caretHoverTimer !== undefined) clearTimeout(caretHoverTimer);
        caretHoverTimer = setTimeout(() => {
          caretHoverTimer = undefined;
          void openHoverAtCaret();
        }, CARET_HOVER_DELAY_MS);
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
    setTheme: (nextTheme) => monaco.editor.setTheme(toMonacoTheme(nextTheme)),
    dispose: () => {
      disposed = true;
      if (caretHoverTimer !== undefined) clearTimeout(caretHoverTimer);
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
 * All of them answer about one model — the source editor's — and the check is
 * not defensive: a provider is registered against a *language*, so a second
 * `hexagon` model would reach these too. The worker would answer it correctly,
 * since the source travels with every request; what would not be correct is the
 * staleness guard, because `currentVersion()` is the *source editor's* version
 * and a second model's replies would be matched against the wrong document's
 * edits.
 *
 * A refusal is a result, not a failure, so it is passed through rather than
 * filtered out. What the user then sees differs by feature, and #222 assumed it
 * did not. The assumption is recorded here because the code looks like it works.
 *
 * A **rename** refusal is shown only if it arrives before the prompt opens.
 * `resolveRenameLocation`'s `rejectReason` reaches `MessageController`, which
 * draws a real widget at the cursor. `provideRenameEdits`'s goes to
 * `INotificationService.info`, and standalone Monaco binds that to
 * `StandaloneNotificationService`, whose `notify` is `console.log`. So a
 * refusal the session can only reach by trying the rename — a name collision,
 * say — closes the box and says nothing.
 *
 * That is what makes `prepareRename`'s reachability check in `analysis.ts` more
 * than a courtesy: it moves the refusals it can predict onto the half of this
 * that a user can see.
 *
 * A **code action** refusal is not displayed to a Playground user at all.
 *
 * That is a measured result, deliberately not backed here by an account of why.
 * Four rounds of review produced four such accounts — "greyed out with the
 * reason as its label", "only under `Refactor…`", "no kind-filtered trigger
 * reaches one", then a six-item enumeration that was missing two triggers — and
 * each was wrong in a way the previous one's reasoning had hidden. Monaco's
 * partition of an action set into `allActions` and `validActions =
 * allActions.filter(a => !a.disabled)` (`codeAction.js`) is reached by more
 * paths than any of those attempts enumerated, and the paths do not agree with
 * each other.
 *
 * So: the finding is the observation, the account of it lives in #253 where it
 * can be corrected without touching code, and this comment claims nothing it did
 * not measure. Nothing here can force the refusal into view, because an enabled
 * action that silently does nothing is worse than a missing one.
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
          const target = editTarget(model);
          return {
            actions: actions.map((action) => toCodeAction(target, action)),
            dispose: () => {},
          };
        },
      },
      // Declared so `getCodeActionProviders` can skip this provider entirely
      // for a request it could not satisfy — the `source.*` actions, since the
      // automatic trigger asks with no filter at all and reaches every provider
      // regardless.
      //
      // Separately, and whether or not this is declared, `getCodeActions`
      // filters each provider's returned actions by kind (`filtersAction`, in
      // `codeAction/common/types.js`). That is why `context.only` is not read
      // above: the rule has one owner and it is not this file.
      { providedCodeActionKinds: codeActionKinds },
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
        const caret = new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column,
        );
        return toRenameLocation(
          subject,
          (start, end) => rangeFromOffsets(model, start, end),
          caret,
        );
      },
      provideRenameEdits: async (model, position, newName) => {
        // `undefined`, not `{ edits: [] }`, for a model this does not own: an
        // object without a `rejectReason` is an accepted answer to Monaco, so
        // an empty one would end the provider chain with a silent no-op.
        if (!owns(model)) return undefined;
        return toRenameEdits(
          editTarget(model),
          await services.rename(
            model.getValue(),
            model.getOffsetAt(position),
            newName,
          ),
        );
      },
    }),
  ];
  return { dispose: () => registrations.forEach((registration) => registration.dispose()) };
}

/**
 * A type that is only well-formed when its argument is `true`.
 *
 * The constraint is the whole point. `X extends Y ? true : never` on its own
 * checks nothing — `never` is a legal type, so the failing case is as valid as
 * the passing one and `tsc` says nothing. Feeding the result through here makes
 * the mismatch an error.
 */
type Assert<T extends true> = T;

/**
 * That the optional fields carrying a refusal are spelled and typed Monaco's
 * way.
 *
 * Assignability does not check the *names*. `disabled`, `rejectReason` and
 * `kind` are all optional on Monaco's side, so a mapped value that misspells one
 * is still a legal `CodeAction` or `RenameLocation` — it just silently loses the
 * field, and a refused action ships as an enabled one with no edit. That is what
 * `Pick`'s `keyof` constraint catches, and it is the gap. Retyping a field is
 * caught at the provider registration too; `Assert` catches it here, nearer the
 * decision.
 */
type _CodeActionFields = Assert<
  Required<Pick<MappedCodeAction<monaco.Uri, monaco.Range>, "disabled" | "kind">> extends
    Required<Pick<monaco.languages.CodeAction, "disabled" | "kind">> ? true : false
>;

type _RenameLocationFields = Assert<
  Required<Pick<MappedRenameLocation<monaco.Range>, "rejectReason">> extends
    Required<Pick<monaco.languages.RenameLocation & monaco.languages.Rejection, "rejectReason">>
    ? true
    : false
>;

/**
 * A model as something edits can be written against.
 *
 * The `versionId` is read once, here, and stamped on every edit in the set. It
 * is the last guard on a race the worker's own version check does not cover: a
 * reply can be current when it arrives and stale by the time the user picks the
 * action out of a menu. Monaco validates every edit in a set before applying any
 * of them, so the document is never half rewritten against text that has moved
 * underneath it.
 *
 * How loudly it declines depends on which caller asked. The standalone bulk
 * editor signals a mismatch by throwing (`standaloneServices.js`); `rename.js`
 * catches that and shows "Rename failed to apply edits", while
 * `codeActionController.js` calls `applyCodeAction` without awaiting it, so a
 * code action's mismatch surfaces as an unhandled rejection instead. Safe in
 * both; presentable in one. Making the other presentable is the host's job, not
 * this function's.
 */
function editTarget(
  model: monaco.editor.ITextModel,
): EditTarget<monaco.Uri, monaco.Range> {
  return {
    uri: model.uri,
    versionId: model.getVersionId(),
    range: (startOffset, endOffset) => rangeFromOffsets(model, startOffset, endOffset),
  };
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
  const [boundedStart, boundedEnd] = boundedOffsets(
    startOffset,
    endOffset,
    model.getValueLength(),
  );
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
