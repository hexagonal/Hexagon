import { helloWorld } from "./examples/hello-world";
import type { CompilerResponse, ExecutionResponse } from "./protocol";
import "./styles.css";

type ResultTab = "output" | "errors" | "javascript" | "declarations" | "types";

interface PlaygroundState {
  sourceVersion: number;
  lastSuccessfulVersion: number | undefined;
  activeTab: ResultTab;
  output: readonly string[];
  errors: readonly string[];
  javascript: string;
  declarations: string;
  types: readonly string[];
}

const state: PlaygroundState = {
  sourceVersion: 0,
  lastSuccessfulVersion: undefined,
  activeTab: "output",
  output: [],
  errors: ["The compiler is not connected yet."],
  javascript: "// JavaScript will appear after a successful compilation.",
  declarations: "// TypeScript declarations will appear here.",
  types: [],
};

const app = document.querySelector<HTMLElement>("#app");

if (app === null) {
  throw new Error("The playground requires an #app element.");
}

app.innerHTML = `
  <header class="topbar">
    <div>
      <p class="eyebrow">HEXAGON</p>
      <h1>Playground</h1>
    </div>
    <nav class="actions" aria-label="Playground actions">
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
        <button role="tab" data-tab="errors" aria-selected="false">Errors <span class="badge">1</span></button>
        <button role="tab" data-tab="javascript" aria-selected="false">JS</button>
        <button role="tab" data-tab="declarations" aria-selected="false">.d.ts</button>
        <button role="tab" data-tab="types" aria-selected="false">Types</button>
      </div>
      <pre id="result-view" role="tabpanel" tabindex="0"></pre>
    </section>
  </section>

  <footer class="statusbar" aria-live="polite">
    <span id="compile-status">Compiler connection pending</span>
    <span>Browser scaffold</span>
  </footer>
`;

const sourceEditor = requireElement<HTMLTextAreaElement>("#source-editor");
const resultView = requireElement<HTMLElement>("#result-view");
const compileStatus = requireElement<HTMLElement>("#compile-status");
const runButton = requireElement<HTMLButtonElement>("[data-action='run']");
const tabButtons = Array.from(app.querySelectorAll<HTMLButtonElement>("[data-tab]"));

sourceEditor.value = helloWorld.source;

// Workers are created at the UI boundary so either one can be replaced after
// failure without losing editor or application state.
const compilerWorker = new Worker(new URL("./compiler-worker.ts", import.meta.url), {
  type: "module",
});
let executionWorker = createExecutionWorker();
let compileTimer: ReturnType<typeof setTimeout> | undefined;

compilerWorker.addEventListener("message", (event: MessageEvent<CompilerResponse>) => {
  const response = event.data;

  // Compilation can finish out of order. Publishing an older response would
  // attach diagnostics and generated code to source the user no longer sees.
  if (response.version !== state.sourceVersion) return;

  if (response.kind === "compile-success") {
    state.lastSuccessfulVersion = response.version;
    state.javascript = response.javascript;
    state.declarations = response.declarations;
    state.types = response.types.map(({ name, displayedType }) => `${name} : ${displayedType}`);
    state.errors = response.diagnostics.map(({ message }) => message);
    compileStatus.textContent = `Compiled version ${response.version}`;
    runButton.disabled = false;
  } else {
    state.errors = response.diagnostics.map(({ message }) => message);
    compileStatus.textContent = `${state.errors.length} compiler message${state.errors.length === 1 ? "" : "s"}`;
    runButton.disabled = true;
    state.activeTab = "errors";
  }

  renderTabs();
  renderResult();
});

executionWorker.addEventListener("message", handleExecutionResponse);

sourceEditor.addEventListener("input", () => {
  state.sourceVersion += 1;
  runButton.disabled = true;
  compileStatus.textContent = "Waiting to compile…";

  if (compileTimer !== undefined) clearTimeout(compileTimer);
  compileTimer = setTimeout(compileCurrentSource, 200);
});

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    state.activeTab = button.dataset.tab as ResultTab;
    renderTabs();
    renderResult();
  });
}

runButton.addEventListener("click", () => {
  if (state.lastSuccessfulVersion !== state.sourceVersion) return;

  state.output = [];
  executionWorker.postMessage({
    kind: "execute",
    version: state.sourceVersion,
    javascript: state.javascript,
  });
});

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

function handleExecutionResponse(event: MessageEvent<ExecutionResponse>): void {
  const response = event.data;

  if (response.version !== state.sourceVersion) return;

  state.output = response.output;
  state.activeTab = response.kind === "execute-success" ? "output" : "errors";

  if (response.kind === "execute-failure") {
    state.errors = [...state.errors, response.message];
    executionWorker.terminate();
    executionWorker = createExecutionWorker();
    executionWorker.addEventListener("message", handleExecutionResponse);
  }

  renderTabs();
  renderResult();
}

function createExecutionWorker(): Worker {
  return new Worker(new URL("./execution-worker.ts", import.meta.url), {
    type: "module",
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
    output: state.output.length > 0 ? state.output.join("\n") : "Run a successfully compiled program to see its output.",
    errors: state.errors.length > 0 ? state.errors.join("\n\n") : "No errors.",
    javascript: state.javascript,
    declarations: state.declarations,
    types: state.types.length > 0 ? state.types.join("\n") : "Inferred types will appear after compilation.",
  };

  resultView.textContent = content[state.activeTab];
}

function requireElement<T extends Element>(selector: string): T {
  const element = app.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing playground element: ${selector}`);
  return element;
}

renderTabs();
renderResult();
compileCurrentSource();
