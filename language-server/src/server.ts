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
  DidChangeWatchedFilesNotification,
  FileChangeType,
  TextDocumentSyncKind,
  TextDocuments,
  type Connection,
  type Definition,
  type Hover,
  type InitializeParams,
  type InitializeResult,
  type Location,
  type MarkupContent,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath } from "node:url";
import type { Source, Target } from "../../compiler/src/index.js";
import { toLspDiagnostic } from "./diagnostics.js";
import { offsetOfPosition, rangeOfSpan } from "./positions.js";
import { Workspace } from "./workspace.js";
import { MANIFEST_NAME, type ManifestResult } from "./manifest.js";

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
  let roots: readonly string[] = [];
  /** Each root's manifest problems, republished whenever diagnostics are. */
  const manifests = new Map<string, ManifestResult>();

  const log = (message: string): void => connection.console.info(`[hexagon] ${message}`);
  const reportError = (message: string): void => connection.console.error(`[hexagon] ${message}`);

  connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
    roots = rootPathsOf(params);
    let discovered = 0;
    for (const root of roots) {
      const { added, manifest } = await workspace.addRoot(root, reportError);
      discovered += added;
      manifests.set(root, manifest);
    }
    log(`initialized over ${roots.length} root(s); ${discovered} Hexagon file(s) found`);
    watchedFilesRegistered = params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
    return {
      capabilities: {
        // Incremental sync keeps a large file's edits proportional to the edit
        // rather than to the file; `TextDocuments` applies them for us.
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
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
      if (change.uri.endsWith(`/${MANIFEST_NAME}`)) {
        manifestChanged = true;
        continue;
      }
      if (change.type === FileChangeType.Deleted) await workspace.deleteFile(change.uri);
      else await workspace.refreshFromDisk(change.uri);
    }
    if (manifestChanged) {
      // Which root's manifest changed does not narrow the work: a root's
      // `exclude` can hide a file another root's manifest privileges, so the
      // cheap thing and the correct thing are the same size here.
      for (const root of roots) {
        manifests.set(root, (await workspace.reloadManifest(root, reportError)).manifest);
      }
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
      publishDiagnostics(connection, workspace, published, manifests);
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
    const uri = workspace.uris.toUri(`${root}/${MANIFEST_NAME}`);
    if (result.problems.length > 0) stillReporting.add(uri);
    else if (!published.has(uri)) continue;
    connection.sendDiagnostics({
      uri,
      diagnostics: result.problems.map((problem) => ({
        severity: 1 as const,
        range: {
          start: { line: problem.line, character: 0 },
          end: { line: problem.line, character: Number.MAX_SAFE_INTEGER },
        },
        message: problem.message,
        source: "hexagon",
      })),
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
