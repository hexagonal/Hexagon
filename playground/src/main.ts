import {
  formatLocatedDiagnostic,
  locateDiagnostic,
  type LocatedDiagnostic,
} from "./diagnostics";
import {
  createTextareaSourceEditor,
  isIPadOS,
  supportsMonacoEditor,
  type EditorSubscription,
  type GeneratedCodeEditor,
  type SourceEditor,
} from "./editor";
import {
  exampleById,
  playgroundExamples,
} from "./examples";
import {
  formatEditionLabel,
  formatExportLabel,
  generatedSectionsPanel,
  renderGeneratedCodeView,
} from "./generated-code";
import { helloWorld } from "./examples/hello-world";
import { readStoredInput, readStoredSource, writeStoredInput, writeStoredSource } from "./persistence";
import { createLanguageServices, type LanguageServices } from "./language-services";
import type {
  CompilerMessage,
  ExecutionEvent,
  GeneratedSection,
  TypeOccurrence,
  ExecutableModule,
} from "./protocol";
import { exitStatusNote, outputSegments, type OutputChunk } from "./output-pane";
import { readSharedInput, readSharedSource, shareUrl } from "./sharing";
import {
  anyHintShown,
  hintShown,
  inputBoxShown,
  parseSettings,
  serializeSettings,
  settingRows,
  settingsStorageKey,
  type PlaygroundSettings,
} from "./settings";
import {
  parseThemePreference,
  resolveTheme,
  themeStorageKey,
  type ThemePreference,
} from "./theme";
import "./styles.css";

type ResultTab =
  | "output"
  | "errors"
  | "javascript"
  | "typeScriptPreview"
  | "types";

interface PlaygroundState {
  sourceVersion: number;
  lastSuccessfulVersion: number | undefined;
  activeTab: ResultTab;
  output: readonly OutputChunk[];
  diagnostics: readonly LocatedDiagnostic[];
  javascript: string;
  executionModules: readonly ExecutableModule[];
  entryPath: string;
  generatedJavaScript: readonly GeneratedSection[];
  generatedDeclarations: readonly GeneratedSection[];
  zeroEntryPointExports: readonly string[];
  javascriptView: string;
  typeScriptPreview: string;
  types: readonly TypeOccurrence[];
}

const state: PlaygroundState = {
  sourceVersion: 0,
  lastSuccessfulVersion: undefined,
  activeTab: "javascript",
  output: [],
  diagnostics: [],
  javascript: "// JavaScript will appear after compilation.",
  executionModules: [],
  entryPath: "/main.hex",
  generatedJavaScript: [],
  generatedDeclarations: [],
  zeroEntryPointExports: [],
  javascriptView: "source",
  typeScriptPreview: "// The TypeScript preview will appear after compilation.",
  types: [],
};

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
let themePreference = readThemePreference();
applyTheme();

const appElement = document.querySelector<HTMLElement>("#app");

if (appElement === null) {
  throw new Error("The playground requires an #app element.");
}

const app = appElement;

app.innerHTML = `
  <header class="topbar">
    <div>
      <p class="eyebrow">HEXAGON</p>
      <h1>Playground</h1>
    </div>
    <nav class="actions" aria-label="Playground actions">
      <label class="theme-control">
        <span>Theme</span>
        <select id="theme-select" aria-label="Theme">
          <option value="system">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
      <label class="example-control">
        <span>Example</span>
        <select id="example-select" aria-label="Example">
          <option value="">Choose…</option>
        </select>
      </label>
      <button class="settings-button" type="button" data-action="settings" aria-haspopup="dialog">
        <svg class="button-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg><span>Settings…</span>
      </button>
      <button type="button" data-action="share">Share</button>
      <button class="run-button" type="button" data-action="run" disabled>Run</button>
    </nav>
  </header>

  <section class="workspace">
    <section class="panel source-panel" aria-labelledby="source-heading">
      <header class="panel-heading">
        <h2 id="source-heading">Hexagon</h2>
        <span class="panel-note">main.hex</span>
      </header>
      <textarea
        id="source-editor"
        aria-label="Hexagon source"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      ></textarea>
      <div id="monaco-source-editor" class="monaco-editor-host" hidden></div>
      <label class="input-box" hidden>
        <span>Input</span>
        <textarea
          id="input-editor"
          rows="2"
          aria-label="Standard input"
          placeholder="Text the program reads with Stdio.readText"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        ></textarea>
      </label>
    </section>

    <section class="panel result-panel" aria-label="Compiler results">
      <div class="tabs" role="tablist" aria-label="Result views">
        <button role="tab" data-tab="output" aria-selected="false">Output</button>
        <button role="tab" data-tab="errors" aria-selected="false">Errors <span class="badge">0</span></button>
        <button role="tab" data-tab="javascript" aria-selected="true">JS</button>
        <button role="tab" data-tab="typeScriptPreview" aria-selected="false">.d.ts</button>
        <button role="tab" data-tab="types" aria-selected="false">Types</button>
        <div class="build-report" hidden>
          <span id="zero-entry-points" class="zero-entry-points" hidden></span>
          <label class="js-view-control" hidden>
            <span>View</span>
            <select id="js-view-select" aria-label="JavaScript generated-code view"></select>
          </label>
        </div>
      </div>
      <div id="result-view" role="tabpanel" tabindex="0">
        <div id="result-text"></div>
        <div id="monaco-generated-editor" class="monaco-editor-host" hidden></div>
      </div>
    </section>
  </section>

  <footer class="statusbar" aria-live="polite">
    <span id="compile-status">Compiler starting…</span>
    <span>Compiler analysis session · no LSP</span>
  </footer>

  <dialog id="settings-dialog" class="settings-dialog" aria-labelledby="settings-heading">
    <form method="dialog">
      <h2 id="settings-heading">Settings</h2>
      <div id="settings-rows"></div>
      <footer class="settings-actions">
        <button type="submit">Done</button>
      </footer>
    </form>
  </dialog>
`;

const sourceTextarea = requireElement<HTMLTextAreaElement>("#source-editor");
const inputTextarea = requireElement<HTMLTextAreaElement>("#input-editor");
const inputBox = requireElement<HTMLElement>(".input-box");
const settingsButton = requireElement<HTMLButtonElement>("[data-action='settings']");
const settingsDialog = requireElement<HTMLDialogElement>("#settings-dialog");
const settingsRows = requireElement<HTMLElement>("#settings-rows");
const sourceEditorContainer = requireElement<HTMLElement>("#monaco-source-editor");
const resultView = requireElement<HTMLElement>("#result-view");
const resultText = requireElement<HTMLElement>("#result-text");
const generatedEditorContainer = requireElement<HTMLElement>("#monaco-generated-editor");
const compileStatus = requireElement<HTMLElement>("#compile-status");
const themeSelect = requireElement<HTMLSelectElement>("#theme-select");
const exampleSelect = requireElement<HTMLSelectElement>("#example-select");
const shareButton = requireElement<HTMLButtonElement>("[data-action='share']");
const runButton = requireElement<HTMLButtonElement>("[data-action='run']");
const buildReportPanel = requireElement<HTMLElement>(".build-report");
const javaScriptViewControl = requireElement<HTMLElement>(".js-view-control");
const javaScriptViewSelect = requireElement<HTMLSelectElement>("#js-view-select");
const zeroEntryPointNote = requireElement<HTMLElement>("#zero-entry-points");
runButton.title = "Run the most recently compiled program.";
const tabButtons = Array.from(app.querySelectorAll<HTMLButtonElement>("[data-tab]"));

// The `Settings…` window's choices, each off until the dev turns it on. A
// page opened from a shared link that carries input shows the input box
// whatever they say, so its run reads what its author's did, until the dev
// turns the box on or off here.
let settings: PlaygroundSettings = readSettings();
let sharedInput: string | undefined = readSharedInput(new URL(window.location.href));
applyInputBoxSetting();
renderSettingRows();

let sourceEditor: SourceEditor = createTextareaSourceEditor(sourceTextarea);
let generatedCodeEditor: GeneratedCodeEditor | undefined;
let sourceSubscription: EditorSubscription = sourceEditor.onDidChange(handleSourceChange);
sourceEditor.setSource(readInitialSource());
inputTextarea.value = readInitialInput();
// The box is the run's standard input (`spec/program-io.md` §6). Editing it
// needs no compile: the next run reads whatever it holds then.
inputTextarea.addEventListener("input", () => writeCurrentInput(inputTextarea.value));
themeSelect.value = themePreference;
for (const example of playgroundExamples) {
  const option = document.createElement("option");
  option.value = example.id;
  option.textContent = example.title;
  exampleSelect.append(option);
}
exampleSelect.value = playgroundExamples.find(
  ({ source }) => source === sourceEditor.getSource(),
)?.id ?? "";

themeSelect.addEventListener("change", () => {
  themePreference = parseThemePreference(themeSelect.value);
  writeThemePreference(themePreference);
  applyTheme();
  refreshEditorThemes();
});

systemTheme.addEventListener("change", () => {
  if (themePreference === "system") applyTheme();
  if (themePreference === "system") refreshEditorThemes();
});

// Workers are created at the UI boundary so either one can be replaced after
// failure without losing editor or application state.
const compilerWorker = new Worker(new URL("./compiler-worker.ts", import.meta.url), {
  type: "module",
});
let compileTimer: ReturnType<typeof setTimeout> | undefined;
let executionWorker: Worker | undefined;
let executionTimer: ReturnType<typeof setTimeout> | undefined;

// The same worker answers editor requests from a long-lived `AnalysisSession`.
// One worker rather than two so both halves see one compiler build.
//
// They do not share a compilation: `compileSource` builds its own files for the
// JS, `.d.ts` and Run panes, and the session compiles again on the first request
// after an edit. That is the cost of keeping whole-program emission out of the
// interactive path, and it is paid once per edit, not once per request.
const languageServices = createLanguageServices(
  {
    post: (request) => compilerWorker.postMessage(request),
    listen: (receive) =>
      compilerWorker.addEventListener("message", (event: MessageEvent<CompilerMessage>) =>
        receive(event.data)
      ),
    onFailure: (notify) => compilerWorker.addEventListener("error", () => notify()),
  },
  () => state.sourceVersion,
);

// The editor's view of those services: the inlay hints the settings show, and
// none asked for while they show none.
const shownLanguageServices: LanguageServices = {
  ...languageServices,
  inlayHints: async (source, range) => {
    if (!anyHintShown(settings)) return [];
    const hints = await languageServices.inlayHints(source, range);
    return hints.filter(({ kind }) => hintShown(kind, settings));
  },
};

compilerWorker.addEventListener("message", (event: MessageEvent<CompilerMessage>) => {
  const response = event.data;
  if (response.kind !== "compile-success" && response.kind !== "compile-failure") return;

  // Compilation can finish out of order. Publishing an older response would
  // attach diagnostics and generated code to source the user no longer sees.
  if (response.version !== state.sourceVersion) return;

  if (response.kind === "compile-success") {
    state.lastSuccessfulVersion = response.version;
    state.javascript = response.javascript;
    state.executionModules = response.executionModules;
    state.entryPath = response.entryPath;
    state.generatedJavaScript = response.generatedJavaScript;
    state.generatedDeclarations = response.generatedDeclarations;
    state.zeroEntryPointExports = response.zeroEntryPointExports;
    state.typeScriptPreview = response.typeScriptPreview;
    state.types = response.types;
    state.diagnostics = response.diagnostics.map((diagnostic) =>
      locateDiagnostic(sourceEditor.getSource(), diagnostic)
    );
    compileStatus.textContent = `Compiled version ${response.version}`;
    runButton.disabled = false;
  } else {
    state.lastSuccessfulVersion = undefined;
    state.javascript = "// No JavaScript emitted for the current source.";
    state.executionModules = [];
    state.entryPath = "/main.hex";
    state.generatedJavaScript = [];
    state.generatedDeclarations = [];
    state.zeroEntryPointExports = [];
    state.typeScriptPreview =
      "// No TypeScript preview emitted for the current source.";
    state.types = [];
    state.diagnostics = response.diagnostics.map((diagnostic) =>
      locateDiagnostic(sourceEditor.getSource(), diagnostic)
    );
    compileStatus.textContent = `${state.diagnostics.length} compiler message${state.diagnostics.length === 1 ? "" : "s"}`;
    runButton.disabled = true;
  }

  sourceEditor.publishDiagnostics(state.diagnostics);

  // Continuous compilation updates every view without stealing the tab the
  // developer is inspecting. The status line and Errors badge signal failures.
  renderTabs();
  renderResult();
});

function handleSourceChange(): void {
  stopExecution();
  state.sourceVersion += 1;
  state.output = [];
  state.diagnostics = [];
  state.types = [];
  state.generatedJavaScript = [];
  state.generatedDeclarations = [];
  state.zeroEntryPointExports = [];
  sourceEditor.publishDiagnostics([]);
  writeCurrentSource(sourceEditor.getSource());
  runButton.disabled = true;
  compileStatus.textContent = "Waiting to compile…";
  renderResult();

  if (compileTimer !== undefined) clearTimeout(compileTimer);
  compileTimer = setTimeout(compileCurrentSource, 200);
}

runButton.addEventListener("click", runCurrentProgram);
shareButton.addEventListener("click", shareCurrentSource);
settingsButton.addEventListener("click", () => settingsDialog.showModal());
// A click on the backdrop, outside the window's own box, closes it too.
settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});
javaScriptViewSelect.addEventListener("change", () => {
  state.javascriptView = javaScriptViewSelect.value;
  renderResult();
});

exampleSelect.addEventListener("change", () => {
  const example = exampleById(exampleSelect.value);
  if (example === undefined) return;
  sourceEditor.setSource(example.source);
  handleSourceChange();
  exampleSelect.value = example.id;
  sourceEditor.focus();
});

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    state.activeTab = button.dataset.tab as ResultTab;
    renderTabs();
    renderResult();
  });
}

function compileCurrentSource(): void {
  compileStatus.textContent = "Compiling…";
  compilerWorker.postMessage({
    kind: "compile",
    version: state.sourceVersion,
    source: sourceEditor.getSource(),
  });
}

async function shareCurrentSource(): Promise<void> {
  const shared = shareUrl(new URL(window.location.href), sourceEditor.getSource(), runInput());
  window.history.replaceState(null, "", shared);

  try {
    if (navigator.clipboard === undefined) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(shared.href);
    compileStatus.textContent = "Share URL copied to clipboard.";
  } catch {
    compileStatus.textContent = "Share URL added to the address bar.";
  }
}

function runCurrentProgram(): void {
  if (state.lastSuccessfulVersion !== state.sourceVersion) return;

  stopExecution();
  state.output = [];
  state.activeTab = "output";
  runButton.disabled = true;
  compileStatus.textContent = "Running…";
  renderTabs();
  renderResult();

  const version = state.sourceVersion;
  executionWorker = new Worker(new URL("./execution-worker.ts", import.meta.url), {
    type: "module",
  });
  executionWorker.addEventListener("message", (event: MessageEvent<ExecutionEvent>) => {
    if (event.data.version !== version || version !== state.sourceVersion) return;
    const response = event.data;
    if (response.kind === "execute-output") {
      state.output = [...state.output, { stream: response.stream, text: response.text }];
      renderResult();
      return;
    }
    if (response.kind === "execute-success") {
      const status = exitStatusNote(response.exitStatus);
      state.output = status !== undefined
        ? [...state.output, status]
        : state.output.length === 0
          ? [{ stream: "note", text: "Program completed." }]
          : state.output;
    } else {
      state.output = [...state.output, { stream: "note", text: `Runtime error: ${response.message}` }];
    }
    compileStatus.textContent = response.kind === "execute-success"
      ? `Ran version ${version}`
      : `Version ${version} failed at runtime`;
    finishExecution();
    renderResult();
  });
  executionWorker.addEventListener("error", (event) => {
    if (version !== state.sourceVersion) return;
    state.output = [...state.output, { stream: "note", text: `Execution worker failed: ${event.message}` }];
    compileStatus.textContent = `Version ${version} failed at runtime`;
    finishExecution();
    renderResult();
  });
  executionWorker.postMessage({
    kind: "execute",
    version,
    modules: state.executionModules,
    entryPath: state.entryPath,
    input: runInput(),
  });
  executionTimer = setTimeout(() => {
    if (version !== state.sourceVersion) return;
    state.output = [...state.output, { stream: "note", text: "Execution stopped after 2 seconds." }];
    compileStatus.textContent = `Version ${version} timed out`;
    finishExecution();
    renderResult();
  }, 2_000);
}

function finishExecution(): void {
  if (executionTimer !== undefined) clearTimeout(executionTimer);
  executionTimer = undefined;
  executionWorker?.terminate();
  executionWorker = undefined;
  runButton.disabled = state.lastSuccessfulVersion !== state.sourceVersion;
}

function stopExecution(): void {
  if (executionTimer !== undefined) clearTimeout(executionTimer);
  executionTimer = undefined;
  executionWorker?.terminate();
  executionWorker = undefined;
}

function renderTabs(): void {
  for (const button of tabButtons) {
    const selected = button.dataset.tab === state.activeTab;
    button.setAttribute("aria-selected", String(selected));
  }

  const errorBadge = app.querySelector<HTMLElement>("[data-tab='errors'] .badge");
  if (errorBadge !== null) {
    errorBadge.textContent = String(state.diagnostics.length);
  }
  renderBuildReport();
}

function renderResult(): void {
  resultView.classList.toggle("diagnostics-view", state.activeTab === "errors");
  const generatedLanguage = state.activeTab === "javascript"
    ? "javascript"
    : state.activeTab === "typeScriptPreview"
      ? "typescript"
      : undefined;
  if (generatedLanguage !== undefined && generatedCodeEditor !== undefined) {
    resultText.hidden = true;
    generatedCodeEditor.show(
      generatedLanguage,
      generatedLanguage === "javascript"
        ? displayedJavaScript()
        : state.typeScriptPreview,
    );
    return;
  }

  generatedCodeEditor?.hide();
  resultText.hidden = false;
  if (state.activeTab === "errors") {
    renderDiagnostics();
    return;
  }
  if (state.activeTab === "output" && state.output.length > 0) {
    renderOutput();
    return;
  }

  const content: Record<ResultTab, string> = {
    output: executionWorker === undefined
        ? "Run the program to execute its latest successful compilation."
        : "Program is running…",
    errors: "",
    javascript: displayedJavaScript(),
    typeScriptPreview: state.typeScriptPreview,
    types: state.types.length > 0
      ? state.types.map(({ name, displayedType }) => `${name} : ${displayedType}`).join("\n")
      : "Inferred types will appear after compilation.",
  };

  resultText.textContent = content[state.activeTab];
}

/**
 * §3.4's other visibility obligation, which the list alone does not discharge:
 * what would create an entry point. The wording is the exception's own — the
 * absence is legal, and the export keeps working for the audience `export`
 * exists to serve.
 *
 * §3.4 names two remedies and this names one. The other — evidence completing a
 * §4.1 assignment, which would reach the export through Algorithm G — was driven
 * through `compileSource` and changes nothing: Algorithm G is unimplemented, and
 * whether its edition would carry a `.d.ts` face at all is #423's open question.
 * A tooltip that offered it would be sending an author to do work that does not
 * currently produce the entry point it promises. The sentence says nothing about
 * why the second remedy is missing, because that is a compiler fact with an open
 * issue attached and not something for this host to adjudicate.
 */
const ZERO_ENTRY_POINT_EXPLANATION =
  "Zero-Cost Fundamental Exports §3.4: these exports publish no typed entry " +
  "point, which is legal, not an error. A lawful fundamental instance of the " +
  "constraint would create one. They remain working Hexagon exports that " +
  "another module can import, honor the constraint for, and call.";

/**
 * The generated-sections panel — Zero-Cost Fundamental Exports §10's report, as
 * much of it as one host shows.
 *
 * Its two halves are gated separately on purpose. The view select needs editions
 * to select between; §3.4's list does not, and the case where a module minted
 * nothing at all is exactly the case where its author most needs to be told why
 * (§16(h)). A panel gated on the edition list alone would go dark there.
 */
function renderBuildReport(): void {
  const report = generatedSectionsPanel(
    state.generatedJavaScript,
    state.generatedDeclarations,
    state.zeroEntryPointExports,
  );
  const visible = state.activeTab === "javascript" && report.hasContent;
  buildReportPanel.hidden = !visible;
  zeroEntryPointNote.hidden = report.zeroEntryPointNote === undefined;
  zeroEntryPointNote.textContent = report.zeroEntryPointNote ?? "";
  // The line is elided where the list is long, so the title repeats it in full
  // before saying what it means: a truncated §3.4 list would hide the very names
  // the obligation exists to publish.
  zeroEntryPointNote.title = report.zeroEntryPointNote === undefined
    ? ""
    : `${report.zeroEntryPointNote}\n\n${ZERO_ENTRY_POINT_EXPLANATION}`;
  javaScriptViewControl.hidden = report.exports.length === 0;
  if (!visible || report.exports.length === 0) return;

  const validViews = new Set([
    "source",
    "complete",
    ...state.generatedJavaScript.map(({ generatedName }) =>
      `specialization:${generatedName}`
    ),
  ]);
  if (!validViews.has(state.javascriptView)) state.javascriptView = "source";

  javaScriptViewSelect.replaceChildren();
  javaScriptViewSelect.append(
    createOption("source", "Source-shaped"),
    createOption("complete", "Complete emitted module"),
  );
  for (const entry of report.exports) {
    const group = document.createElement("optgroup");
    group.label = formatExportLabel(entry);
    for (const edition of entry.editions) {
      group.append(createOption(
        `specialization:${edition.section.generatedName}`,
        formatEditionLabel(edition),
      ));
    }
    javaScriptViewSelect.append(group);
  }
  javaScriptViewSelect.value = state.javascriptView;
}

function displayedJavaScript(): string {
  return renderGeneratedCodeView(
    state.javascript,
    state.generatedJavaScript,
    state.javascriptView,
  );
}

function createOption(value: string, label: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}


/**
 * The run's text, stdout and stderr in the order written, with stderr's marked
 * as errors are (`spec/program-io.md` §6), and the playground's notes muted.
 */
function renderOutput(): void {
  resultText.replaceChildren(...outputSegments(state.output).map(({ stream, text }) => {
    if (stream === "stdout") return document.createTextNode(text);
    const span = document.createElement("span");
    span.className = stream === "stderr" ? "output-stderr" : "output-note";
    span.textContent = text;
    return span;
  }));
}

function renderDiagnostics(): void {
  resultText.replaceChildren();
  if (state.diagnostics.length === 0) {
    resultText.textContent = "No errors.";
    return;
  }

  const list = document.createElement("ol");
  list.className = "diagnostic-list";
  for (const diagnostic of state.diagnostics) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `diagnostic diagnostic-${diagnostic.severity}`;
    button.textContent = formatLocatedDiagnostic(diagnostic);
    button.addEventListener("click", () => focusDiagnostic(diagnostic));
    item.append(button);
    list.append(item);
  }
  resultText.append(list);
}

function focusDiagnostic(diagnostic: LocatedDiagnostic): void {
  const sourceLength = sourceEditor.getSource().length;
  const start = Math.min(diagnostic.startOffset, sourceLength);
  const end = Math.max(start, Math.min(diagnostic.endOffset, sourceLength));
  sourceEditor.focus();
  sourceEditor.selectOffsets(start, end);
}

async function initializeMonaco(): Promise<void> {
  if (!supportsMonacoEditor(
    window.matchMedia("(pointer: fine)").matches,
    window.innerWidth,
  )) return;

  try {
    const { createMonacoEditors } = await import("./monaco");
    const editors = createMonacoEditors(
      sourceTextarea,
      sourceEditorContainer,
      generatedEditorContainer,
      sourceEditor.getSource(),
      resolveCurrentEditorTheme(),
      isIPadOS(
        navigator.userAgent,
        navigator.platform,
        navigator.maxTouchPoints,
      ),
      shownLanguageServices,
    );
    sourceSubscription.dispose();
    sourceEditor.dispose();
    sourceEditor = editors.source;
    generatedCodeEditor = editors.generated;
    sourceSubscription = sourceEditor.onDidChange(handleSourceChange);
    sourceEditor.publishDiagnostics(state.diagnostics);
    renderResult();
  } catch (error: unknown) {
    console.error("Monaco failed to start; retaining the textarea fallback.", error);
  }
}

function readInitialSource(): string {
  const shared = readSharedSource(new URL(window.location.href));
  if (shared !== undefined) return shared;
  try {
    return readStoredSource(localStorage) ?? helloWorld.source;
  } catch {
    return helloWorld.source;
  }
}

function writeCurrentSource(source: string): void {
  try {
    writeStoredSource(localStorage, source);
  } catch {
    // Accessing the storage object itself can fail in restricted contexts.
  }
}

/** A shared link's input, else what this browser kept, else an empty box. */
function readInitialInput(): string {
  const shared = readSharedInput(new URL(window.location.href));
  if (shared !== undefined) return shared;
  try {
    return readStoredInput(localStorage) ?? "";
  } catch {
    return "";
  }
}

function writeCurrentInput(input: string): void {
  try {
    writeStoredInput(localStorage, input);
  } catch {
    // Accessing the storage object itself can fail in restricted contexts.
  }
}

/** The run's standard input: the box's text while it is on the page, else none. */
function runInput(): string {
  return inputBox.hidden ? "" : inputTextarea.value;
}

function applyInputBoxSetting(): void {
  inputBox.hidden = !inputBoxShown(settings, sharedInput);
}

/** One checkbox per setting, under its group's heading, each saved as it changes. */
function renderSettingRows(): void {
  settingsRows.replaceChildren();
  let fieldset: HTMLFieldSetElement | undefined;
  for (const row of settingRows) {
    if (fieldset === undefined || fieldset.dataset.group !== row.group) {
      fieldset = document.createElement("fieldset");
      fieldset.dataset.group = row.group;
      const legend = document.createElement("legend");
      legend.textContent = row.group;
      fieldset.append(legend);
      settingsRows.append(fieldset);
    }
    const label = document.createElement("label");
    label.className = "setting-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `setting-${row.key}`;
    checkbox.checked = row.key === "inputBox" ? !inputBox.hidden : settings[row.key];
    checkbox.addEventListener("change", () => changeSetting(row.key, checkbox.checked));
    const name = document.createElement("span");
    name.className = "setting-name";
    name.textContent = row.label;
    const description = document.createElement("span");
    description.className = "setting-description";
    description.append(...withCode(row.description));
    label.append(checkbox, name, description);
    fieldset.append(label);
  }
}

function changeSetting(key: keyof PlaygroundSettings, on: boolean): void {
  settings = { ...settings, [key]: on };
  writeSettings(settings);
  if (key === "inputBox") {
    sharedInput = undefined;
    applyInputBoxSetting();
  } else {
    sourceEditor.refreshInlayHints();
  }
}

/** Text with its backquoted spans set as code. */
function withCode(text: string): Node[] {
  return text.split("`").map((piece, index) => {
    if (index % 2 === 0) return document.createTextNode(piece);
    const code = document.createElement("code");
    code.textContent = piece;
    return code;
  });
}

function readSettings(): PlaygroundSettings {
  try {
    return parseSettings(localStorage.getItem(settingsStorageKey));
  } catch {
    return parseSettings(undefined);
  }
}

function writeSettings(next: PlaygroundSettings): void {
  try {
    localStorage.setItem(settingsStorageKey, serializeSettings(next));
  } catch {
    // Storage can be unavailable in restricted browsing contexts; the page
    // still honours the settings for the rest of its lifetime.
  }
}

function applyTheme(): void {
  document.documentElement.dataset.theme = resolveTheme(
    themePreference,
    systemTheme.matches,
  );
}

function refreshEditorThemes(): void {
  const theme = resolveCurrentEditorTheme();
  sourceEditor.setTheme(theme);
  generatedCodeEditor?.setTheme(theme);
}

function resolveCurrentEditorTheme(): "dark" | "light" {
  return resolveTheme(themePreference, systemTheme.matches);
}

function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(themeStorageKey));
  } catch {
    return "system";
  }
}

function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(themeStorageKey, preference);
  } catch {
    // Storage can be unavailable in restricted browsing contexts; the current
    // page still honours the selected preference for the rest of its lifetime.
  }
}

function requireElement<T extends Element>(selector: string): T {
  const element = app.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing playground element: ${selector}`);
  return element;
}

renderTabs();
renderResult();
compileCurrentSource();
void initializeMonaco();
