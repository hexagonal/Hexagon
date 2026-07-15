import { helloWorld } from "./examples/hello-world";
import { insertIndentedLineBreak } from "./editor";
import type { CompilerResponse, PlaygroundDiagnostic } from "./protocol";
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
  errors: readonly string[];
  javascript: string;
  typeScriptPreview: string;
  types: readonly string[];
}

const state: PlaygroundState = {
  sourceVersion: 0,
  lastSuccessfulVersion: undefined,
  activeTab: "output",
  output: [],
  errors: [],
  javascript: "// JavaScript will appear after compilation.",
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
      <button type="button" data-action="examples">Examples</button>
      <button type="button" data-action="share" disabled>Share</button>
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
    </section>

    <section class="panel result-panel" aria-label="Compiler results">
      <div class="tabs" role="tablist" aria-label="Result views">
        <button role="tab" data-tab="output" aria-selected="true">Output</button>
        <button role="tab" data-tab="errors" aria-selected="false">Errors <span class="badge">0</span></button>
        <button role="tab" data-tab="javascript" aria-selected="false">JS</button>
        <button role="tab" data-tab="typeScriptPreview" aria-selected="false">.d.ts</button>
        <button role="tab" data-tab="types" aria-selected="false">Types</button>
      </div>
      <pre id="result-view" role="tabpanel" tabindex="0"></pre>
    </section>
  </section>

  <footer class="statusbar" aria-live="polite">
    <span id="compile-status">Compiler starting…</span>
    <span>Direct compiler worker · no LSP</span>
  </footer>
`;

const sourceEditor = requireElement<HTMLTextAreaElement>("#source-editor");
const resultView = requireElement<HTMLElement>("#result-view");
const compileStatus = requireElement<HTMLElement>("#compile-status");
const themeSelect = requireElement<HTMLSelectElement>("#theme-select");
const runButton = requireElement<HTMLButtonElement>("[data-action='run']");
runButton.title = "Execution is not enabled in this first playground round.";
const tabButtons = Array.from(app.querySelectorAll<HTMLButtonElement>("[data-tab]"));

sourceEditor.value = helloWorld.source;
themeSelect.value = themePreference;

themeSelect.addEventListener("change", () => {
  themePreference = parseThemePreference(themeSelect.value);
  writeThemePreference(themePreference);
  applyTheme();
});

systemTheme.addEventListener("change", () => {
  if (themePreference === "system") applyTheme();
});

// Workers are created at the UI boundary so either one can be replaced after
// failure without losing editor or application state.
const compilerWorker = new Worker(new URL("./compiler-worker.ts", import.meta.url), {
  type: "module",
});
let compileTimer: ReturnType<typeof setTimeout> | undefined;

compilerWorker.addEventListener("message", (event: MessageEvent<CompilerResponse>) => {
  const response = event.data;

  // Compilation can finish out of order. Publishing an older response would
  // attach diagnostics and generated code to source the user no longer sees.
  if (response.version !== state.sourceVersion) return;

  if (response.kind === "compile-success") {
    state.lastSuccessfulVersion = response.version;
    state.javascript = response.javascript;
    state.typeScriptPreview = response.typeScriptPreview;
    state.types = response.types.map(({ name, displayedType }) => `${name} : ${displayedType}`);
    state.errors = response.diagnostics.map(formatDiagnostic);
    compileStatus.textContent = `Compiled version ${response.version}`;
    runButton.disabled = true;
  } else {
    state.lastSuccessfulVersion = undefined;
    state.javascript = "// No JavaScript emitted for the current source.";
    state.typeScriptPreview =
      "// No TypeScript preview emitted for the current source.";
    state.types = [];
    state.errors = response.diagnostics.map(formatDiagnostic);
    compileStatus.textContent = `${state.errors.length} compiler message${state.errors.length === 1 ? "" : "s"}`;
    runButton.disabled = true;
  }

  // Continuous compilation updates every view without stealing the tab the
  // developer is inspecting. The status line and Errors badge signal failures.
  renderTabs();
  renderResult();
});

sourceEditor.addEventListener("input", () => {
  state.sourceVersion += 1;
  runButton.disabled = true;
  compileStatus.textContent = "Waiting to compile…";

  if (compileTimer !== undefined) clearTimeout(compileTimer);
  compileTimer = setTimeout(compileCurrentSource, 200);
});

sourceEditor.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) return;

  event.preventDefault();
  const edit = insertIndentedLineBreak(
    sourceEditor.value,
    sourceEditor.selectionStart,
    sourceEditor.selectionEnd,
  );
  sourceEditor.value = edit.text;
  sourceEditor.setSelectionRange(edit.caret, edit.caret);
  sourceEditor.dispatchEvent(new Event("input", { bubbles: true }));
});

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    state.activeTab = button.dataset.tab as ResultTab;
    renderTabs();
    renderResult();
  });
}

requireElement<HTMLButtonElement>("[data-action='examples']").addEventListener("click", () => {
  sourceEditor.value = helloWorld.source;
  sourceEditor.dispatchEvent(new Event("input"));
  sourceEditor.focus();
});

function compileCurrentSource(): void {
  compileStatus.textContent = "Compiling…";
  compilerWorker.postMessage({
    kind: "compile",
    version: state.sourceVersion,
    source: sourceEditor.value,
  });
}

function renderTabs(): void {
  for (const button of tabButtons) {
    const selected = button.dataset.tab === state.activeTab;
    button.setAttribute("aria-selected", String(selected));
  }

  const errorBadge = app.querySelector<HTMLElement>("[data-tab='errors'] .badge");
  if (errorBadge !== null) errorBadge.textContent = String(state.errors.length);
}

function renderResult(): void {
  const content: Record<ResultTab, string> = {
    output: state.output.length > 0
      ? state.output.join("\n")
      : "Execution is not enabled yet. Inspect JS, .d.ts, and Types.",
    errors: state.errors.length > 0 ? state.errors.join("\n\n") : "No errors.",
    javascript: state.javascript,
    typeScriptPreview: state.typeScriptPreview,
    types: state.types.length > 0 ? state.types.join("\n") : "Inferred types will appear after compilation.",
  };

  resultView.textContent = content[state.activeTab];
}

function formatDiagnostic(diagnostic: PlaygroundDiagnostic): string {
  const before = sourceEditor.value.slice(0, diagnostic.startOffset);
  const line = before.split(/\r\n|\r|\n/u).length;
  const lastLineBreak = Math.max(
    before.lastIndexOf("\n"),
    before.lastIndexOf("\r"),
  );
  const column = diagnostic.startOffset - lastLineBreak;
  return `${diagnostic.severity} at ${line}:${column} — ${diagnostic.message}`;
}

function applyTheme(): void {
  document.documentElement.dataset.theme = resolveTheme(
    themePreference,
    systemTheme.matches,
  );
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
