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
 * Analysis is synchronous and fast enough that a request cannot observe an edit
 * midway: nothing yields between reading the document and returning the answer.
 * That is what makes the version checks here cheap rather than ceremonial — they
 * catch the case that *can* happen, a request whose document changed between the
 * client sending it and the server picking it up, and it is why the server does
 * not yet need to thread a cancellation token into the compiler.
 *
 * Diagnostics are the exception, because the server chooses when to publish
 * them. They are debounced, and a publish that a newer edit has overtaken is
 * dropped rather than sent, so an editor is never shown squiggles computed from
 * text the user has already replaced.
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
import { rangeOfSpan } from "./positions.js";
import { Workspace } from "./workspace.js";

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

  const log = (message: string): void => connection.console.info(`[hexagon] ${message}`);

  connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
    const roots = rootPathsOf(params);
    let discovered = 0;
    for (const root of roots) {
      discovered += await workspace.addRoot(root, (message) => connection.console.error(`[hexagon] ${message}`));
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
    if (!watchedFilesRegistered) return;
    // Files can change without ever being opened — a branch switch, a formatter,
    // a generated module. Without this the graph silently keeps stale text.
    await connection.client.register(DidChangeWatchedFilesNotification.type, {
      watchers: [{ globPattern: "**/*.hex" }],
    });
  });

  documents.onDidOpen(({ document }) => {
    workspace.openDocument(document);
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
    for (const change of changes) {
      if (change.type === FileChangeType.Deleted) workspace.deleteFile(change.uri);
      else await workspace.refreshFromDisk(change.uri);
    }
    schedulePublish();
  });

  connection.onHover(({ textDocument, position }): Hover | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    const path = workspace.uris.toPath(textDocument.uri);
    const hover = workspace.session.hover(path, document.offsetAt(position));
    if (hover === undefined) return null;
    return { contents: hoverContents(hover.name, hover.target, hover.displayedType), range: rangeOfSpan(hover.span) };
  });

  connection.onDefinition(({ textDocument, position }): Definition | null => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return null;
    const path = workspace.uris.toPath(textDocument.uri);
    const found = workspace.session.definitions(path, document.offsetAt(position));
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
    const found = workspace.session.references(path, document.offsetAt(position), {
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
      publishDiagnostics(connection, workspace, published);
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
  for (const uri of published) {
    if (stillReporting.has(uri)) continue;
    connection.sendDiagnostics({ uri, diagnostics: [] });
  }
  published.clear();
  for (const uri of stillReporting) published.add(uri);
}

function hoverContents(name: string, target: Target, displayedType: string | undefined): MarkupContent {
  const heading = displayedType === undefined
    ? `${describe(target)} \`${name}\``
    : `\`${name}: ${displayedType}\``;
  return { kind: "markdown", value: heading };
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
