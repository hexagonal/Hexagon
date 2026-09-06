/**
 * Protocol lifecycle and request dispatch.
 *
 * Every handler here is the same three steps: turn the protocol's coordinates
 * into the compiler's, ask the analysis session one question, turn the answer
 * back. No handler decides anything about Hexagon — when one looks like it is
 * about to, the decision belongs in `compiler/src/analysis` instead, which is
 * the boundary `language-server/README.md` draws and the reason this file stays
 * small.
 *
 * ## Cancellation and staleness
 *
 * There are no version checks here, and their absence is deliberate. Analysis is
 * synchronous: nothing yields between reading a document and returning an
 * answer, so a request runs entirely before an edit or entirely after it and can
 * never straddle one. A stamped version would have nothing to compare against,
 * and a cancellation token would have no point at which to take effect. Both
 * become necessary the moment analysis stops being synchronous.
 *
 * Diagnostics are the exception, because the server chooses when to publish
 * them rather than answering a request. They are debounced, so a burst of
 * keystrokes costs one analysis, and each publication reads the session at the
 * moment it fires — never text the user has already replaced.
 */

import {
  CodeActionKind,
  CompletionItemKind,
  DidChangeWatchedFilesNotification,
  ErrorCodes,
  FileChangeType,
  MarkupKind,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  ResponseError,
  TextDocuments,
  type CodeAction,
  type CompletionItem,
  type Connection,
  type Definition,
  type Hover,
  type InitializeParams,
  type InitializeResult,
  type Location,
  type MarkupContent,
  type Range,
  type SemanticTokens,
  type TextEdit,
  type WorkspaceEdit,
  uinteger,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hoverMarkdown,
  refused,
  type Completion,
  type Hover as SessionHover,
  type Source,
} from "../../compiler/src/index.js";
import { toLspDiagnostic } from "./diagnostics.js";
import {
  codeActionSupportOf,
  toLspCodeAction,
  wantsActions,
  type CodeActionSupport,
} from "./code-actions.js";
import { offsetOfPosition, rangeOfSpan } from "./positions.js";
import { Workspace } from "./workspace.js";
import { MANIFEST_NAME, type SeatedProblem } from "../../host/src/index.js";
import { LEGEND, encodeSemanticTokens } from "./semantic-tokens.js";

/**
 * How long to wait after an edit before analysing for diagnostics. Long enough
 * that a burst of keystrokes costs one analysis rather than one each, short
 * enough that a user who pauses to read sees the result already there.
 */
const DIAGNOSTIC_DELAY_MS = 150;

export function startServer(connection: Connection): void {
  const documents = new TextDocuments(TextDocument);
  const workspace = new Workspace();
  /** URIs currently showing diagnostics, so they can be cleared when they stop. */
  const published = new Set<string>();
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  let watchedFilesRegistered = false;
  /** Read once at initialization: what shape of code action this client takes. */
  let codeActions: CodeActionSupport = { literals: false, disabled: false };
  let roots: readonly string[] = [];
  /** Whether this client applies a `WorkspaceEdit` that creates a file. */
  let createsFiles = false;

  const log = (message: string): void => connection.console.info(`[hexagon] ${message}`);
  const reportError = (message: string): void => connection.console.error(`[hexagon] ${message}`);

  connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
    roots = rootPathsOf(params);
    const { added } = await workspace.setRoots(roots, reportError);
    log(
      `initialized over ${roots.length} root(s); ${workspace.programs.length} program(s), ` +
        `${added} Hexagon file(s) found`,
    );
    createsFiles =
      params.capabilities.workspace?.workspaceEdit?.documentChanges === true;
    watchedFilesRegistered = params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
    codeActions = codeActionSupportOf(params.capabilities.textDocument?.codeAction);
    return {
      capabilities: {
        // Incremental sync keeps a large file's edits proportional to the edit
        // rather than to the file; `TextDocuments` applies them for us.
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        // `prepareProvider` is what lets the editor pre-select the identifier
        // and refuse before the user has typed a replacement, rather than
        // accepting a rename and then reporting that it was impossible.
        renameProvider: { prepareProvider: true },
        // `full` only: a range request would re-analyse the whole project to
        // answer about part of a file, so it would cost the same and say less.
        // No `delta` either — deltas are worth their bookkeeping when tokens are
        // expensive to produce, and these come straight out of an index that has
        // already been built for diagnostics.
        semanticTokensProvider: { legend: LEGEND, full: true },
        // `.` retriggers because a qualified request answers about a different
        // set entirely — the module's members rather than what is in scope — and
        // a client that kept filtering the previous list would show names that
        // cannot follow a dot. No `resolveProvider`: every item is complete when
        // it is sent, so there is nothing a second round trip would add.
        completionProvider: { triggerCharacters: ["."] },
        // Quick fixes only: every action this slice offers answers a diagnostic,
        // and declaring a kind the server never returns makes a client ask for
        // it on every save. No `resolveProvider` — an action arrives complete,
        // because the work that would justify deferring it is the work that
        // decides whether to offer the action at all.
        ...(codeActions.literals
          ? { codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] } }
          : {}),
      },
      serverInfo: { name: "Hexagon Language Server", version: "0.0.1" },
    };
  });

  connection.onInitialized(async () => {
    // The workspace is already analysed, so its diagnostics exist before any
    // document is opened. Waiting for a document event to publish them would
    // leave a user who opens a project and looks at the Problems panel — the
    // ordinary way to ask "what is broken here?" — seeing nothing at all.
    schedulePublish();
    if (!watchedFilesRegistered) return;
    // Files can change without ever being opened — a branch switch, a formatter,
    // a generated module. Without this the graph silently keeps stale text.
    await connection.client.register(DidChangeWatchedFilesNotification.type, {
      // A manifest decides what a program *is*, so a change to one can change
      // every answer, and it is watched like source. **Every** manifest, not
      // only a root's: a nested one is a package of its own and so a program of
      // its own (D1), and one under `node_modules` is a dependency arriving or
      // leaving.
      watchers: [{ globPattern: "**/*.hex" }, { globPattern: `**/${MANIFEST_NAME}` }],
    });
  });

  documents.onDidOpen(async ({ document }) => {
    await workspace.openDocument(document);
    schedulePublish();
  });

  documents.onDidChangeContent(({ document }) => {
    workspace.updateDocument(document);
    schedulePublish();
  });

  documents.onDidClose(async ({ document }) => {
    await workspace.closeDocument(document.uri);
    schedulePublish();
  });

  connection.onDidChangeWatchedFiles(async ({ changes }) => {
    let rediscover = false;
    for (const change of changes) {
      // **Every** manifest re-runs discovery, wherever it sits. A nested one is
      // a package of its own and so a program of its own (D1); one under
      // `node_modules` is a dependency arriving, leaving, or changing what it
      // depends on. Which manifest changed narrows nothing worth narrowing: one
      // project's `exclude` can hide a file another reaches, and a package's
      // `dependencies` changes what every program holding it compiles.
      //
      // By basename of the resolved path, not by URI suffix: a client spells a
      // URI its own way — VS Code percent-encodes a Windows drive colon where
      // `pathToFileURL` does not — and matching the string would mean a manifest
      // edit on Windows silently never reloaded anything, while falling through
      // would read a JSON file into a session as Hexagon source.
      if (basename(workspace.pathFor(change.uri)) === MANIFEST_NAME) {
        rediscover = true;
        continue;
      }
      // A `.hex` file, wherever it sits — a dependency's source under
      // `node_modules` included, which is refreshed in every program holding it
      // rather than in one.
      if (change.type === FileChangeType.Deleted) await workspace.deleteFile(change.uri);
      else await workspace.refreshFromDisk(change.uri);
    }
    if (rediscover) {
      await workspace.setRoots(roots, reportError);
      // A rescan reads disk, and it skips files the editor has open — so a file
      // that has just *stopped* being excluded would be left out of every
      // program until the user happened to type in it. Re-applying the buffers
      // is what makes the workspace independent of that.
      for (const document of documents.all()) await workspace.openDocument(document);
      log(`reloaded ${MANIFEST_NAME}; ${workspace.programs.length} program(s)`);
    }
    schedulePublish();
  });

  connection.onHover(({ textDocument, position }): Hover | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    const path = workspace.pathFor(textDocument.uri);
    const session = workspace.sessionFor(path);
    if (session === undefined) return null;
    const hover = session.hover(path, offsetOfPosition(document, position));
    if (hover === undefined) return null;
    return { contents: hoverContents(hover), range: rangeOfSpan(hover.span) };
  });

  connection.onDefinition(({ textDocument, position }): Definition | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    const path = workspace.pathFor(textDocument.uri);
    const session = workspace.sessionFor(path);
    if (session === undefined) return null;
    const found = session.definitions(path, offsetOfPosition(document, position));
    if (found.length === 0) return null;
    return found.map((definition): Location => ({
      uri: workspace.uris.toUri(definition.path),
      range: rangeOfSpan(definition.span),
    }));
  });

  connection.onReferences(({ textDocument, position, context }): Location[] | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    const path = workspace.pathFor(textDocument.uri);
    const session = workspace.sessionFor(path);
    if (session === undefined) return null;
    const found = session.references(path, offsetOfPosition(document, position), {
      includeDeclaration: context.includeDeclaration,
    });
    if (found.length === 0) return null;
    return found.map((reference): Location => ({
      uri: workspace.uris.toUri(reference.path),
      range: rangeOfSpan(reference.span),
    }));
  });

  connection.onCompletion(({ textDocument, position }): CompletionItem[] | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    const path = workspace.pathFor(textDocument.uri);
    const session = workspace.sessionFor(path);
    if (session === undefined) return null;
    const offered = session.completions(path, offsetOfPosition(document, position));
    if (offered.length === 0) return null;
    // `documentation` rather than `detail` for the doc content, though
    // `spec/doc-comments.md` §8 calls the surface "completion detail": the
    // protocol's `detail` is a plain string shown beside the label, and §8 asks
    // for Markdown, which only this field renders as such. `detail` goes on
    // carrying the type, which is what a reader scanning the list wants first.
    return offered.map((completion): CompletionItem => ({
      label: completion.name,
      kind: completionKindOf(completion.kind),
      ...(completion.detail === undefined ? {} : { detail: completion.detail }),
      ...(completion.documentation === undefined
        ? {}
        : { documentation: { kind: MarkupKind.Markdown, value: completion.documentation } }),
    }));
  });

  connection.onCodeAction(({ textDocument, range, context }): CodeAction[] | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    if (!wantsActions(context.only)) return null;
    const path = workspace.pathFor(textDocument.uri);
    const session = workspace.sessionFor(path);
    if (session === undefined) return null;
    const pathOfFile = (fileId: number): string | undefined =>
      session.pathOfFile(fileId as Source.FileId);
    const asked = {
      start: offsetOfPosition(document, range.start),
      end: offsetOfPosition(document, range.end),
    };
    // The client's own `context.diagnostics` are not consulted: they are the
    // ones it happens to be showing, which after an edit is the previous
    // analysis. The session's are the current ones, and an action built from
    // stale spans would edit the wrong characters.
    const offered = session.codeActions(path, asked);
    const actions = offered.flatMap((action) => {
      const converted = toLspCodeAction(action, codeActions, workspace.uris, pathOfFile);
      return converted === undefined ? [] : [converted];
    });
    actions.push(...manifestActions(workspace, path, asked, createsFiles));
    return actions.length === 0 ? null : actions;
  });

  connection.languages.semanticTokens.on(({ textDocument }): SemanticTokens => {
    // No `documents.get` guard here, unlike the position requests: those need a
    // document to convert a line/character pair, and this one does not ask about
    // a position at all. A file the session knows from the workspace scan can be
    // coloured whether or not this client has opened it.
    const path = workspace.pathFor(textDocument.uri);
    const session = workspace.sessionFor(path);
    if (session === undefined) return encodeSemanticTokens([]);
    return encodeSemanticTokens(session.semanticTokens(path));
  });

  // A refusal is shown to the user by failing the request: an editor renders the
  // error's message in place, which is the only channel a rename has for saying
  // why it will not proceed. Returning `null` instead would read as "nothing to
  // rename here" and leave the reason unsaid.
  connection.onPrepareRename(({ textDocument, position }): Range | ResponseError<void> | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    const path = workspace.pathFor(textDocument.uri);
    const session = workspace.sessionFor(path);
    if (session === undefined) return null;
    const subject = session.prepareRename(path, offsetOfPosition(document, position));
    if (subject === undefined) return null;
    if (refused(subject)) return new ResponseError(ErrorCodes.InvalidRequest, subject.refused);
    return rangeOfSpan(subject.span);
  });

  connection.onRenameRequest(({ textDocument, position, newName }): WorkspaceEdit | ResponseError<void> | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    const path = workspace.pathFor(textDocument.uri);
    const session = workspace.sessionFor(path);
    if (session === undefined) return null;
    const plan = session.rename(path, offsetOfPosition(document, position), newName);
    if (plan === undefined) return null;
    if (refused(plan)) return new ResponseError(ErrorCodes.InvalidRequest, plan.refused);
    const changes: Record<string, TextEdit[]> = {};
    for (const edit of plan.edits) {
      const uri = workspace.uris.toUri(edit.path);
      // `replacement` where the edit carries one — a name *derived* from the one
      // being renamed writes its own text (Foreign Enums §5.2's generated
      // conversions), and `newName` everywhere else, which is every other edit.
      (changes[uri] ??= []).push({
        range: rangeOfSpan(edit.span),
        newText: edit.replacement ?? plan.newName,
      });
    }
    return { changes };
  });

  connection.onShutdown(() => {
    if (publishTimer !== undefined) clearTimeout(publishTimer);
    publishTimer = undefined;
  });

  documents.listen(connection);
  connection.listen();

  function schedulePublish(): void {
    if (publishTimer !== undefined) clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      publishTimer = undefined;
      publishDiagnostics(connection, workspace, published, documents.all());
    }, DIAGNOSTIC_DELAY_MS);
  }
}

/**
 * Publishes one round of diagnostics for every file the session holds.
 *
 * A file that has stopped producing diagnostics has to be told so explicitly —
 * an editor clears squiggles only on an empty publish, never by omission. But
 * sending an empty list for every clean file on every keystroke would be a lot
 * of traffic saying nothing, so only files that were previously reporting get
 * the clearing message.
 */
function publishDiagnostics(
  connection: Connection,
  workspace: Workspace,
  published: Set<string>,
  open: readonly TextDocument[],
): void {
  const stillReporting = new Set<string>();
  // Merged across every program that holds the file (D3): identical reports
  // once, different ones each, and a file cleared only when no program still
  // reports on it — which is what the empty entries this map carries do.
  for (const [path, diagnostics] of workspace.allDiagnostics()) {
    const uri = workspace.uris.toUri(path);
    if (diagnostics.length === 0) continue;
    stillReporting.add(uri);
    connection.sendDiagnostics({
      uri,
      diagnostics: diagnostics.map(({ diagnostic, pathOfFile }) =>
        toLspDiagnostic(diagnostic, workspace.uris, pathOfFile)
      ),
    });
  }
  // A manifest's own problems are reported against the manifest, not against
  // anyone's Hexagon — a dependency's `hexagon.json` under `node_modules`
  // included, since that is the file whose reader can act on the report (D3).
  // Silently ignoring a misspelled key would leave a user staring at
  // diagnostics they believe they configured away, with nothing to explain why.
  const byManifest = new Map<string, SeatedProblem[]>();
  for (const problem of workspace.manifestProblems()) {
    const seated = byManifest.get(problem.path);
    if (seated === undefined) byManifest.set(problem.path, [problem]);
    else seated.push(problem);
  }
  for (const [path, seated] of byManifest) {
    const uri = workspace.uris.toUri(path);
    stillReporting.add(uri);
    connection.sendDiagnostics({
      uri,
      diagnostics: seated.map((problem) => ({
        severity: problem.severity === "error"
          ? DiagnosticSeverity.Error
          : DiagnosticSeverity.Warning,
        // The protocol types a character as `uinteger`, which is 32-bit.
        // `Number.MAX_SAFE_INTEGER` exceeds it: VS Code clamps, but a client
        // deserializing into an unsigned 32-bit integer fails or wraps.
        range: {
          start: { line: problem.line, character: 0 },
          end: { line: problem.line, character: uinteger.MAX_VALUE },
        },
        message: problem.message,
        source: "hexagon",
      })),
    });
  }
  // An excluded file the user has open would otherwise be simply dead: coloured
  // by the grammar, with a server visibly running, and answering nothing. That
  // reads as a broken server rather than as a deliberate exclusion, and the
  // user's next move is to report a bug instead of opening `hexagon.json`.
  // Saying so costs one publication and cannot be mistaken for a compiler error.
  for (const document of open) {
    if (!workspace.isExcludedUri(document.uri)) continue;
    // Through the remembered pairing like every other publication here, rather
    // than the document's own URI. They agree for an open document, since its
    // spelling is the first one seen — but reaching past `toUri` is how the two
    // drift apart, and `published` is keyed by whatever this sends.
    const uri = workspace.uris.toUri(workspace.pathFor(document.uri));
    stillReporting.add(uri);
    connection.sendDiagnostics({
      uri,
      diagnostics: [{
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        message:
          `this file is excluded from the project by \`${MANIFEST_NAME}\`, ` +
          "so it has no diagnostics, hover, or navigation",
        source: "hexagon",
      }],
    });
  }
  for (const uri of published) {
    if (stillReporting.has(uri)) continue;
    connection.sendDiagnostics({ uri, diagnostics: [] });
  }
  published.clear();
  for (const uri of stillReporting) published.add(uri);
}

/**
 * Packages §7's not-a-dependency repair, as an applied edit.
 *
 * The report names a line in `hexagon.json` and the compiler marks it rather
 * than writing it: a manifest is not a file the compiler holds — it arrives as
 * a record (§4.1) — so the entry is the compiler's to name and the file is the
 * host's to write. Offered **only** where the file drawing the report is a
 * project the editor holds: the resolving package of a report inside a
 * dependency is that dependency, whose manifest sits under `node_modules` and
 * is not a file a user wrote or should be asked to edit.
 *
 * The whole manifest is rewritten from its parsed value rather than spliced,
 * because `hexagon.json` is JSON — no comments to lose — and a splice into an
 * array a user may have written on one line, several lines, or with a trailing
 * entry is three ways to produce invalid JSON for one repair.
 */
function manifestActions(
  workspace: Workspace,
  path: string,
  asked: { start: number; end: number },
  createsFiles: boolean,
): readonly CodeAction[] {
  // One guard, in one place: `projectManifestOf` answers only for a file some
  // program holds as its **own** source, which is the whole of the rule above.
  // Asking it again here would be a second copy of it, and a second copy is one
  // that can be relaxed on its own.
  const manifest = workspace.projectManifestOf(path);
  if (manifest === undefined) return [];
  const program = workspace.programFor(path);
  if (program === undefined) return [];
  // A manifest that is not there has to be created, which needs a client that
  // applies file operations; one that cannot is offered nothing rather than an
  // edit it would silently drop.
  if (manifest.text === undefined && !createsFiles) return [];
  const offered = new Map<string, CodeAction>();
  for (const diagnostic of program.session.diagnostics(path)) {
    const entry = diagnostic.manifestDependency?.packageName;
    if (entry === undefined) continue;
    if (diagnostic.primary.end.offset < asked.start) continue;
    if (diagnostic.primary.start.offset > asked.end) continue;
    if (offered.has(entry)) continue;
    const text = manifestText(manifest.text, entry);
    if (text === undefined) continue;
    const uri = workspace.uris.toUri(manifest.path);
    const range = wholeDocument(manifest.text ?? "");
    offered.set(entry, {
      title: `add \`"${entry}"\` to \`dependencies\` in ${MANIFEST_NAME}`,
      kind: CodeActionKind.QuickFix,
      ...(manifest.text === undefined
        ? {
          edit: {
            documentChanges: [
              { kind: "create", uri, options: { ignoreIfExists: true } },
              {
                textDocument: { uri, version: null },
                edits: [{ range, newText: text }],
              },
            ],
          },
        }
        : { edit: { changes: { [uri]: [{ range, newText: text }] } } }),
    });
  }
  return [...offered.values()];
}

/** The manifest as it reads with one more `dependencies` entry, or nothing. */
function manifestText(current: string | undefined, entry: string): string | undefined {
  let value: unknown = {};
  if (current !== undefined) {
    try {
      value = JSON.parse(current.replace(/^\uFEFF/u, ""));
    } catch {
      // A manifest that does not parse already has a report of its own against
      // it, and rewriting it would throw away whatever the user was typing.
      return undefined;
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const listed = record["dependencies"];
  const entries = Array.isArray(listed) ? [...listed] : [];
  if (listed !== undefined && !Array.isArray(listed)) return undefined;
  if (entries.includes(entry)) return undefined;
  entries.push(entry);
  return `${JSON.stringify({ ...record, dependencies: entries }, undefined, 2)}\n`;
}

/** The range covering a whole document, so an edit replaces all of it. */
function wholeDocument(text: string): Range {
  const lines = text.split("\n");
  return {
    start: { line: 0, character: 0 },
    end: { line: lines.length - 1, character: lines.at(-1)!.length },
  };
}

/**
 * The session's hover as the protocol carries it. The sentence itself is
 * `hoverMarkdown`, shared with every other host that draws one; all that is
 * added here is the wrapper that says which markup it is.
 */
function hoverContents(hover: SessionHover): MarkupContent {
  return { kind: "markdown", value: hoverMarkdown(hover) };
}

/**
 * The protocol's icon for a completion. Hexagon's kinds and LSP's do not line up
 * one to one, so each is mapped to the nearest thing a client already draws:
 * `Constructor` for a union's constructors, `Module` for a companion module.
 */
function completionKindOf(kind: Completion["kind"]): CompletionItemKind {
  switch (kind) {
    case "function":
      return CompletionItemKind.Function;
    case "parameter":
      return CompletionItemKind.Variable;
    case "constructor":
      return CompletionItemKind.Constructor;
    case "type":
      return CompletionItemKind.Class;
    case "module":
      return CompletionItemKind.Module;
    case "value":
      return CompletionItemKind.Variable;
  }
}

/**
 * Workspace roots, preferring the folders a modern client sends over the single
 * deprecated path. A root that is not a `file:` URI is skipped rather than
 * guessed at: there is no directory behind it to scan.
 */
function rootPathsOf(params: InitializeParams): readonly string[] {
  const folders = params.workspaceFolders ?? [];
  if (folders.length > 0) {
    return folders.flatMap(({ uri }) => {
      try {
        return [fileURLToPath(uri)];
      } catch {
        return [];
      }
    });
  }
  return typeof params.rootPath === "string" ? [params.rootPath] : [];
}
