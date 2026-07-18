import {
  formatLocatedDiagnostic,
  locateDiagnostic,
  type LocatedDiagnostic,
} from "./diagnostics";
import {
  createTextareaSourceEditor,
  supportsMonacoEditor,
  type EditorSubscription,
  type GeneratedCodeEditor,
  type SourceEditor,
} from "./editor";
import {
  exampleById,
  playgroundExamples,
} from "./examples";
import { groupGeneratedSections, renderGeneratedCodeView } from "./generated-code";
import { helloWorld } from "./examples/hello-world";
import { readStoredSource, writeStoredSource } from "./persistence";
import type {
  CompilerResponse,
  ExecutionEvent,
  GeneratedJavaScriptSection,
  InferredBinding,
  ExecutableModule,
} from "./protocol";
import { readSharedSource, shareUrl } from "./sharing";
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
  output: readonly string[];
  diagnostics: readonly LocatedDiagnostic[];
  javascript: string;
  executionModules: readonly ExecutableModule[];
  entryPath: string;
  generatedJavaScript: readonly GeneratedJavaScriptSection[];
  javascriptView: string;
  typeScriptPreview: string;
  bindings: readonly InferredBinding[];
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
  javascriptView: "source",
  typeScriptPreview: "// The TypeScript preview will appear after compilation.",
  bindings: [],
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
    </section>

    <section class="panel result-panel" aria-label="Compiler results">
      <div class="tabs" role="tablist" aria-label="Result views">
        <button role="tab" data-tab="output" aria-selected="false">Output</button>
        <button role="tab" data-tab="errors" aria-selected="false">Errors <span class="badge">0</span></button>
        <button role="tab" data-tab="javascript" aria-selected="true">JS</button>
        <button role="tab" data-tab="typeScriptPreview" aria-selected="false">.d.ts</button>
        <button role="tab" data-tab="types" aria-selected="false">Types</button>
        <label class="js-view-control" hidden>
          <span>View</span>
          <select id="js-view-select" aria-label="JavaScript generated-code view"></select>
        </label>
      </div>
      <div id="result-view" role="tabpanel" tabindex="0">
        <div id="result-text"></div>
        <div id="monaco-generated-editor" class="monaco-editor-host" hidden></div>
      </div>
    </section>
  </section>

  <footer class="statusbar" aria-live="polite">
    <span id="compile-status">Compiler starting…</span>
    <span>Direct compiler worker · no LSP</span>
  </footer>
`;

const sourceTextarea = requireElement<HTMLTextAreaElement>("#source-editor");
const sourceEditorContainer = requireElement<HTMLElement>("#monaco-source-editor");
const resultView = requireElement<HTMLElement>("#result-view");
const resultText = requireElement<HTMLElement>("#result-text");
const generatedEditorContainer = requireElement<HTMLElement>("#monaco-generated-editor");
const compileStatus = requireElement<HTMLElement>("#compile-status");
const themeSelect = requireElement<HTMLSelectElement>("#theme-select");
const exampleSelect = requireElement<HTMLSelectElement>("#example-select");
const shareButton = requireElement<HTMLButtonElement>("[data-action='share']");
const runButton = requireElement<HTMLButtonElement>("[data-action='run']");
const javaScriptViewControl = requireElement<HTMLElement>(".js-view-control");
const javaScriptViewSelect = requireElement<HTMLSelectElement>("#js-view-select");
runButton.title = "Run the most recently compiled program.";
const tabButtons = Array.from(app.querySelectorAll<HTMLButtonElement>("[data-tab]"));

let sourceEditor: SourceEditor = createTextareaSourceEditor(sourceTextarea);
let generatedCodeEditor: GeneratedCodeEditor | undefined;
let sourceSubscription: EditorSubscription = sourceEditor.onDidChange(handleSourceChange);
sourceEditor.setSource(readInitialSource());
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

compilerWorker.addEventListener("message", (event: MessageEvent<CompilerResponse>) => {
  const response = event.data;

  // Compilation can finish out of order. Publishing an older response would
  // attach diagnostics and generated code to source the user no longer sees.
  if (response.version !== state.sourceVersion) return;

  if (response.kind === "compile-success") {
    state.lastSuccessfulVersion = response.version;
    state.javascript = response.javascript;
    state.executionModules = response.executionModules;
    state.entryPath = response.entryPath;
    state.generatedJavaScript = response.generatedJavaScript;
    state.typeScriptPreview = response.typeScriptPreview;
    state.bindings = response.types;
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
    state.typeScriptPreview =
      "// No TypeScript preview emitted for the current source.";
    state.bindings = [];
    state.diagnostics = response.diagnostics.map((diagnostic) =>
      locateDiagnostic(sourceEditor.getSource(), diagnostic)
    );
    compileStatus.textContent = `${state.diagnostics.length} compiler message${state.diagnostics.length === 1 ? "" : "s"}`;
    runButton.disabled = true;
  }

  sourceEditor.publishDiagnostics(state.diagnostics);
  sourceEditor.publishBindings(state.bindings);

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
  state.bindings = [];
  state.generatedJavaScript = [];
  sourceEditor.publishDiagnostics([]);
  sourceEditor.publishBindings([]);
  writeCurrentSource(sourceEditor.getSource());
  runButton.disabled = true;
  compileStatus.textContent = "Waiting to compile…";
  renderResult();

  if (compileTimer !== undefined) clearTimeout(compileTimer);
  compileTimer = setTimeout(compileCurrentSource, 200);
}

runButton.addEventListener("click", runCurrentProgram);
shareButton.addEventListener("click", shareCurrentSource);
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
  const shared = shareUrl(new URL(window.location.href), sourceEditor.getSource());
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
      state.output = [...state.output, response.line];
      renderResult();
      return;
    }
    state.output = response.kind === "execute-success"
      ? state.output.length === 0 ? ["Program completed."] : state.output
      : [...state.output, `Runtime error: ${response.message}`];
    compileStatus.textContent = response.kind === "execute-success"
      ? `Ran version ${version}`
      : `Version ${version} failed at runtime`;
    finishExecution();
    renderResult();
  });
  executionWorker.addEventListener("error", (event) => {
    if (version !== state.sourceVersion) return;
    state.output = [...state.output, `Execution worker failed: ${event.message}`];
    compileStatus.textContent = `Version ${version} failed at runtime`;
    finishExecution();
    renderResult();
  });
  executionWorker.postMessage({
    kind: "execute",
    version,
    modules: state.executionModules,
    entryPath: state.entryPath,
  });
  executionTimer = setTimeout(() => {
    if (version !== state.sourceVersion) return;
    state.output = [...state.output, "Execution stopped after 2 seconds."];
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
  renderJavaScriptViewControl();
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

  const content: Record<ResultTab, string> = {
    output: state.output.length > 0
      ? state.output.join("\n")
      : executionWorker === undefined
        ? "Run the program to execute its latest successful compilation."
        : "Program is running…",
    errors: "",
    javascript: displayedJavaScript(),
    typeScriptPreview: state.typeScriptPreview,
    types: state.bindings.length > 0
      ? state.bindings.map(({ name, displayedType }) => `${name} : ${displayedType}`).join("\n")
      : "Inferred types will appear after compilation.",
  };

  resultText.textContent = content[state.activeTab];
}

function renderJavaScriptViewControl(): void {
  const visible = state.activeTab === "javascript" &&
    state.generatedJavaScript.length > 0;
  javaScriptViewControl.hidden = !visible;
  if (!visible) return;

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
  const groups = groupGeneratedSections(state.generatedJavaScript);
  for (const [sourceName, sections] of groups) {
    const bytes = sections.reduce((total, section) => total + section.bytes, 0);
    const group = document.createElement("optgroup");
    group.label = `${sourceName} (${sections.length}, ${bytes} B)`;
    for (const section of sections) {
      group.append(createOption(
        `specialization:${section.generatedName}`,
        `${section.generatedName} · ${section.typeArguments.join(", ")} · ${section.bytes} B`,
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
    );
    sourceSubscription.dispose();
    sourceEditor.dispose();
    sourceEditor = editors.source;
    generatedCodeEditor = editors.generated;
    sourceSubscription = sourceEditor.onDidChange(handleSourceChange);
    sourceEditor.publishDiagnostics(state.diagnostics);
    sourceEditor.publishBindings(state.bindings);
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
