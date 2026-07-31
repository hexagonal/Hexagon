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
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { refused, type Completion, type Source, type Target } from "../../compiler/src/index.js";
import { toLspDiagnostic } from "./diagnostics.js";
import {
  codeActionSupportOf,
  toLspCodeAction,
  wantsQuickFixes,
  type CodeActionSupport,
} from "./code-actions.js";
import { offsetOfPosition, rangeOfSpan } from "./positions.js";
import { Workspace } from "./workspace.js";
import { MANIFEST_NAME, type ManifestResult } from "./manifest.js";
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
  /** Each root's manifest problems, republished whenever diagnostics are. */
  const manifests = new Map<string, ManifestResult>();
  /**
   * The *path* of each root's own manifest — the only ones that are read.
   * Compared by path rather than by URI string on purpose: a client spells a URI
   * its own way, and VS Code percent-encodes a Windows drive colon
   * (`file:///c%3A/…`) where `pathToFileURL` does not. Matching the string would
   * mean a manifest edit on Windows silently never reloaded anything.
   */
  const manifestPaths = new Set<string>();

  const log = (message: string): void => connection.console.info(`[hexagon] ${message}`);
  const reportError = (message: string): void => connection.console.error(`[hexagon] ${message}`);

  connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
    roots = rootPathsOf(params);
    const { added, manifests: read } = await workspace.setRoots(roots, reportError);
    for (const [root, result] of read) manifests.set(root, result);
    for (const root of roots) manifestPaths.add(workspace.uris.toPath(manifestUriOf(root)));
    log(`initialized over ${roots.length} root(s); ${added} Hexagon file(s) found`);
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
      // The manifest decides what the project *is*, so a change to it can change
      // every answer — not only which files exist, but whether a module may name
      // `Node(a)` at all. It has to be watched like source.
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
    let manifestChanged = false;
    for (const change of changes) {
      // Only a *root's* manifest is ever read, so a nested one — a vendored
      // sub-project, a package that carries its own — must not trigger a full
      // reread of every root on every save. It still has to be skipped rather
      // than fall through, or its JSON would be read into the session as
      // Hexagon source.
      if (manifestPaths.has(workspace.uris.toPath(change.uri))) {
        manifestChanged = true;
        continue;
      }
      // By basename of the resolved path, not by URI suffix: the same class of
      // respelling that made the root-manifest match silent applies here too,
      // and falling through would read a JSON file into the session as Hexagon.
      if (basename(workspace.uris.toPath(change.uri)) === MANIFEST_NAME) continue;
      if (change.type === FileChangeType.Deleted) await workspace.deleteFile(change.uri);
      else await workspace.refreshFromDisk(change.uri);
    }
    if (manifestChanged) {
      // Which root's manifest changed does not narrow the work: one root's
      // `exclude` can hide a file another root's manifest privileges, so the
      // cheap thing and the correct thing are the same size here.
      const { manifests: read } = await workspace.setRoots(roots, reportError);
      manifests.clear();
      for (const [root, result] of read) manifests.set(root, result);
      // A rescan reads disk, and it skips files the editor has open — so a file
      // that has just *stopped* being excluded would be left out of the session
      // entirely until the user happened to type in it. Re-applying the buffers
      // is what makes the workspace independent of that.
      for (const document of documents.all()) await workspace.openDocument(document);
      log(`reloaded ${MANIFEST_NAME}`);
    }
    schedulePublish();
  });

  connection.onHover(({ textDocument, position }): Hover | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    const path = workspace.uris.toPath(textDocument.uri);
    const hover = workspace.session.hover(path, offsetOfPosition(document, position));
    if (hover === undefined) return null;
    return { contents: hoverContents(hover.name, hover.target, hover.displayedType), range: rangeOfSpan(hover.span) };
  });

  connection.onDefinition(({ textDocument, position }): Definition | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    const path = workspace.uris.toPath(textDocument.uri);
    const found = workspace.session.definitions(path, offsetOfPosition(document, position));
    if (found.length === 0) return null;
    return found.map((definition): Location => ({
      uri: workspace.uris.toUri(definition.path),
      range: rangeOfSpan(definition.span),
    }));
  });

  connection.onReferences(({ textDocument, position, context }): Location[] | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    const path = workspace.uris.toPath(textDocument.uri);
    const found = workspace.session.references(path, offsetOfPosition(document, position), {
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
    const path = workspace.uris.toPath(textDocument.uri);
    const offered = workspace.session.completions(path, offsetOfPosition(document, position));
    if (offered.length === 0) return null;
    return offered.map((completion): CompletionItem => ({
      label: completion.name,
      kind: completionKindOf(completion.kind),
      ...(completion.detail === undefined ? {} : { detail: completion.detail }),
    }));
  });

  connection.onCodeAction(({ textDocument, range, context }): CodeAction[] | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    if (!wantsQuickFixes(context.only)) return null;
    const path = workspace.uris.toPath(textDocument.uri);
    const pathOfFile = (fileId: number): string | undefined =>
      workspace.session.pathOfFile(fileId as Source.FileId);
    // The client's own `context.diagnostics` are not consulted: they are the
    // ones it happens to be showing, which after an edit is the previous
    // analysis. The session's are the current ones, and an action built from
    // stale spans would edit the wrong characters.
    const offered = workspace.session.codeActions(path, {
      start: offsetOfPosition(document, range.start),
      end: offsetOfPosition(document, range.end),
    });
    const actions = offered.flatMap((action) => {
      const converted = toLspCodeAction(action, codeActions, workspace.uris, pathOfFile);
      return converted === undefined ? [] : [converted];
    });
    return actions.length === 0 ? null : actions;
  });

  connection.languages.semanticTokens.on(({ textDocument }): SemanticTokens => {
    // No `documents.get` guard here, unlike the position requests: those need a
    // document to convert a line/character pair, and this one does not ask about
    // a position at all. A file the session knows from the workspace scan can be
    // coloured whether or not this client has opened it.
    const path = workspace.uris.toPath(textDocument.uri);
    return encodeSemanticTokens(workspace.session.semanticTokens(path));
  });

  // A refusal is shown to the user by failing the request: an editor renders the
  // error's message in place, which is the only channel a rename has for saying
  // why it will not proceed. Returning `null` instead would read as "nothing to
  // rename here" and leave the reason unsaid.
  connection.onPrepareRename(({ textDocument, position }): Range | ResponseError<void> | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    const path = workspace.uris.toPath(textDocument.uri);
    const subject = workspace.session.prepareRename(path, offsetOfPosition(document, position));
    if (subject === undefined) return null;
    if (refused(subject)) return new ResponseError(ErrorCodes.InvalidRequest, subject.refused);
    return rangeOfSpan(subject.span);
  });

  connection.onRenameRequest(({ textDocument, position, newName }): WorkspaceEdit | ResponseError<void> | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    const path = workspace.uris.toPath(textDocument.uri);
    const plan = workspace.session.rename(path, offsetOfPosition(document, position), newName);
    if (plan === undefined) return null;
    if (refused(plan)) return new ResponseError(ErrorCodes.InvalidRequest, plan.refused);
    const changes: Record<string, TextEdit[]> = {};
    for (const edit of plan.edits) {
      const uri = workspace.uris.toUri(edit.path);
      (changes[uri] ??= []).push({ range: rangeOfSpan(edit.span), newText: plan.newName });
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
      publishDiagnostics(connection, workspace, published, manifests, documents.all());
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
  manifests: ReadonlyMap<string, ManifestResult>,
  open: readonly TextDocument[],
): void {
  const analysed = workspace.session.allDiagnostics();
  const pathOfFile = (fileId: number): string | undefined =>
    workspace.session.pathOfFile(fileId as Source.FileId);
  const stillReporting = new Set<string>();
  for (const [path, diagnostics] of analysed) {
    const uri = workspace.uris.toUri(path);
    if (diagnostics.length === 0) continue;
    stillReporting.add(uri);
    connection.sendDiagnostics({
      uri,
      diagnostics: diagnostics.map((diagnostic) =>
        toLspDiagnostic(diagnostic, workspace.uris, pathOfFile)
      ),
    });
  }
  // A malformed manifest is reported against the manifest, not against anyone's
  // Hexagon. Silently ignoring a misspelled key would leave a user staring at
  // diagnostics they believe they configured away, with nothing to explain why.
  for (const [root, result] of manifests) {
    if (!result.present) continue;
    const uri = manifestUriOf(root);
    // A manifest that has stopped reporting is cleared by the trailing sweep
    // below, which is where every other file's clearing happens; publishing an
    // empty list here as well would send it twice.
    if (result.problems.length === 0) continue;
    stillReporting.add(uri);
    connection.sendDiagnostics({
      uri,
      diagnostics: result.problems.map((problem) => ({
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
    const uri = workspace.uris.toUri(workspace.uris.toPath(document.uri));
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
 * One shape for every hover: what the name is, then its type when it has one.
 * A value and a union reading differently would make the hover's own layout
 * something the user has to parse before the content.
 */
function hoverContents(name: string, target: Target, displayedType: string | undefined): MarkupContent {
  const signature = displayedType === undefined ? `\`${name}\`` : `\`${name}: ${displayedType}\``;
  return { kind: "markdown", value: `${describe(target)} ${signature}` };
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

function describe(target: Target): string {
  switch (target.kind) {
    case "value":
      return "value";
    case "union":
      return "union";
    case "record":
      return "record";
    case "extern-type":
      return "foreign type";
    case "constraint":
      return "constraint";
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

/** The URI of a root's own manifest, built the same way every time it is needed. */
function manifestUriOf(rootPath: string): string {
  return pathToFileURL(join(rootPath, MANIFEST_NAME)).toString();
}
