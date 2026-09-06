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
import { Workspace, type OutsideEveryPackage } from "./workspace.js";
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
  /**
   * Whether this client takes a `WorkspaceEdit`'s `documentChanges` — which is
   * what carries a file creation *and* the document version an edit was
   * measured against. A client without it gets the versionless `changes` form.
   */
  let documentChanges = false;

  /**
   * The open **Hexagon** documents — every synchronised `hexagon.json` left out.
   *
   * The extension synchronises manifests so that the `dependencies` repair is
   * measured against the buffer it lands in (`manifestActions`), so the open set
   * now holds documents that are not source. That a manifest is never *seated*
   * is `Workspace`'s rule and is written once, there; this answers a different
   * question — which open documents the two loops below are about, since
   * neither re-opening a manifest as source nor telling its reader it is
   * excluded from the project says anything true.
   */
  const sourceDocuments = (): readonly TextDocument[] =>
    documents.all().filter(({ uri }) => basename(workspace.pathFor(uri)) !== MANIFEST_NAME);

  const log = (message: string): void => connection.console.info(`[hexagon] ${message}`);
  const reportError = (message: string): void => connection.console.error(`[hexagon] ${message}`);

  connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
    roots = rootPathsOf(params);
    const { added } = await workspace.setRoots(roots, reportError);
    log(
      `initialized over ${roots.length} root(s); ${workspace.programs.length} program(s), ` +
        `${added} Hexagon file(s) found`,
    );
    documentChanges =
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
      //
      // A glob is a **request**, and the client decides what it really watches:
      // VS Code's `files.watcherExclude` defaults to `**/node_modules/*/**`, so
      // the events this asks for under `node_modules` are the ones least likely
      // to be delivered. Nothing here depends on getting them. Every answer such
      // an event would refresh is also reached by opening or closing a file, by
      // any other manifest changing, and by the next rediscovery — so where a
      // client does send them the only thing they buy is that the workspace
      // catches up without the user doing anything.
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
      for (const document of sourceDocuments()) await workspace.openDocument(document);
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
    actions.push(...manifestActions(workspace, path, asked, documentChanges, documents.all()));
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
      publishDiagnostics(connection, workspace, published, sourceDocuments());
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
  // A file the user has open that no program holds would otherwise be simply
  // dead: coloured by the grammar, with a server visibly running, and answering
  // nothing. That reads as a broken server rather than as a deliberate bound,
  // and the user's next move is to report a bug instead of opening
  // `hexagon.json`. Saying so costs one publication and cannot be mistaken for
  // a compiler error.
  //
  // One sentence per **reason**, because the ways out are different: an
  // `exclude` entry is a line the user wrote and can delete, an unlisted
  // dependency is a `dependencies` entry they can add, a package with a
  // manifest of its own is a folder they can open, and a tooling directory is
  // a fact about this host that no manifest can argue with. A single "this
  // file is not in the project" would tell them nothing they could act on.
  for (const document of open) {
    const excluded = workspace.isExcludedUri(document.uri);
    const outside = excluded ? undefined : workspace.outsideEveryPackage(document.uri);
    if (!excluded && outside === undefined) continue;
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
        message: outside === undefined
          ? `this file is excluded from the project by \`${MANIFEST_NAME}\`, ` +
            "so it has no diagnostics, hover, or navigation"
          : reasonSentence(outside),
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
 * What to tell a user whose open buffer is nobody's source, per §2.2 bound.
 *
 * Each sentence names the bound, and where there is a way out it is a thing the
 * user can do rather than a rule they can read: list the package, open the
 * folder. Two of the four promise nothing, and both are deliberate. A tooling
 * directory has no way out by design — `files.ts` says so in as many words — so
 * naming it is the whole message, and that is what lets the reader see it was
 * their `dist/` and not something the server invented. A `node_modules` no
 * entry of theirs reaches has no way out *for them*: `Workspace` offers the
 * `dependencies` repair only where writing it would really seat the file, and
 * this is the sentence left where it would not.
 */
function reasonSentence(outside: OutsideEveryPackage): string {
  const dead = "so it has no diagnostics, hover, or navigation";
  switch (outside.kind) {
    case "unlisted-dependency":
      return `this file is under \`node_modules\` of a package this project does not list, ` +
        `${dead}; add it to \`dependencies\` in \`${MANIFEST_NAME}\` to compile it`;
    case "unreached-node-modules":
      return outside.inside === undefined
        ? `this file is under a \`node_modules\` directory and no package a project lists ` +
          `holds it, ${dead}`
        : `this file is under the \`node_modules\` of \`${outside.inside}\`, which this ` +
          `project's \`${MANIFEST_NAME}\` cannot reach, ${dead}`;
    case "skipped-directory":
      return `this file is under \`${outside.directory}\`, which this language server never ` +
        `reads as project source, ${dead}`;
    case "other-package":
      return `this file belongs to the package at \`${outside.manifest}\`, which no open ` +
        `project reaches, ${dead}; open its folder to work on it`;
  }
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
 * ## The text the edit is measured against
 *
 * **The buffer, whenever the editor holds one.** `Workspace` reads a manifest
 * from disk and refreshes it when the watcher fires, which is on *save* — so
 * with `hexagon.json` open and edited, a range measured against the server's
 * copy lands in a document that is no longer that text. Replacing more than the
 * range covers throws away what the user typed; replacing less leaves the tail
 * of the buffer after the replacement, which for a buffer longer than the last
 * save is a `hexagon.json` that is no longer JSON. So the extension
 * synchronises every `hexagon.json` (`editors/vscode`'s `documentSelector`),
 * this takes the text from the open document where there is one, and the edit
 * carries that document's **version** wherever the client accepts one — which
 * is what makes the client refuse it rather than misapply it if a keystroke
 * beats it.
 *
 * ## What it replaces
 *
 * The `dependencies` **value** where the file already has one, and the whole
 * document only where it does not. A whole-file rewrite is the smallest correct
 * edit for a key that has to be *added* — `hexagon.json` is JSON, so there are
 * no comments to lose — but it is not smallest for a key that is already there,
 * and it discards any unrelated edit elsewhere in the file that the same round
 * trip did not know about.
 */
function manifestActions(
  workspace: Workspace,
  path: string,
  asked: { start: number; end: number },
  documentChanges: boolean,
  open: readonly TextDocument[],
): readonly CodeAction[] {
  // One guard, in one place: `projectManifestOf` answers only for a file some
  // program holds as its **own** source, which is the whole of the rule above.
  // Asking it again here would be a second copy of it, and a second copy is one
  // that can be relaxed on its own.
  const manifest = workspace.projectManifestOf(path);
  if (manifest === undefined) return [];
  const program = workspace.programFor(path);
  if (program === undefined) return [];
  // The buffer wins over the server's copy, because it is the text the edit
  // lands in. Found by settled path rather than by URI string, like every other
  // pairing here: the client spells a URI its own way.
  const buffer = open.find((document) => workspace.pathFor(document.uri) === manifest.path);
  const current = buffer?.getText() ?? manifest.text;
  // A manifest that is not there has to be created, which needs a client that
  // applies file operations; one that cannot is offered nothing rather than an
  // edit it would silently drop.
  if (current === undefined && !documentChanges) return [];
  const offered = new Map<string, CodeAction>();
  for (const diagnostic of program.session.diagnostics(path)) {
    const entry = diagnostic.manifestDependency?.packageName;
    if (entry === undefined) continue;
    if (diagnostic.primary.end.offset < asked.start) continue;
    if (diagnostic.primary.start.offset > asked.end) continue;
    if (offered.has(entry)) continue;
    const edit = manifestEdit(current, entry);
    if (edit === undefined) continue;
    const uri = buffer?.uri ?? workspace.uris.toUri(manifest.path);
    offered.set(entry, {
      title: `add \`"${entry}"\` to \`dependencies\` in ${MANIFEST_NAME}`,
      kind: CodeActionKind.QuickFix,
      ...(current === undefined
        ? {
          edit: {
            documentChanges: [
              { kind: "create", uri, options: { ignoreIfExists: true } },
              { textDocument: { uri, version: null }, edits: [edit] },
            ],
          },
        }
        : documentChanges
        // Versioned where the client takes one: an edit measured against a
        // buffer is only correct against that buffer, and a client that has
        // moved on refuses it rather than applying it to different text.
        ? {
          edit: {
            documentChanges: [
              { textDocument: { uri, version: buffer?.version ?? null }, edits: [edit] },
            ],
          },
        }
        : { edit: { changes: { [uri]: [edit] } } }),
    });
  }
  return [...offered.values()];
}

/**
 * The edit that adds one `dependencies` entry, or nothing where the manifest
 * cannot take one.
 *
 * Scoped to the `dependencies` value where the file already has an array there,
 * and to the whole document only where the key has to be added. `current` is
 * `undefined` for a manifest that does not exist yet, whose whole text is
 * written from scratch.
 */
function manifestEdit(current: string | undefined, entry: string): TextEdit | undefined {
  const text = current ?? "";
  // A byte-order mark is stripped to parse and never to write: VS Code writes
  // one under `files.encoding: utf8bom`, and a rewrite that dropped it would
  // silently re-encode a file the user did not ask to re-encode.
  const mark = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  let value: unknown = {};
  if (current !== undefined) {
    try {
      value = JSON.parse(text.slice(mark.length));
    } catch {
      // A manifest that does not parse already has a report of its own against
      // it, and rewriting it would throw away whatever the user was typing.
      return undefined;
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const listed = record["dependencies"];
  if (listed !== undefined && !Array.isArray(listed)) return undefined;
  const entries = Array.isArray(listed) ? [...listed] : [];
  if (entries.includes(entry)) return undefined;
  entries.push(entry);
  // `JSON.stringify` always breaks lines with `\n`, and a manifest saved on
  // Windows is `\r\n` throughout. Writing the one into the other leaves a file
  // with mixed endings — valid JSON, and a diff that touches every line the
  // next time the user's editor normalizes it.
  const newline = newlineOf(text);
  const span = listed === undefined ? undefined : dependenciesValueSpan(text);
  if (span === undefined) {
    const rewritten = JSON.stringify({ ...record, dependencies: entries }, undefined, 2);
    return {
      range: wholeDocument(text),
      newText: `${mark}${rewritten}\n`.replaceAll("\n", newline),
    };
  }
  return {
    range: { start: positionAt(text, span.start), end: positionAt(text, span.end) },
    // Re-indented under the key's own indentation, so the array a reader sees
    // is the array `JSON.stringify` would have written in a whole-file rewrite.
    newText: JSON.stringify(entries, undefined, 2)
      .split("\n")
      .map((line, at) => (at === 0 ? line : `${span.indent}${line}`))
      .join(newline),
  };
}

/**
 * The line ending this text already uses: `\r\n` where the first break is one,
 * and `\n` where there is no break to read.
 *
 * The *first* break rather than a count, because a file with mixed endings is
 * already being asked an unanswerable question and its opening line is the one
 * a reader would call the file's own.
 */
function newlineOf(text: string): string {
  const at = text.indexOf("\n");
  return at > 0 && text[at - 1] === "\r" ? "\r\n" : "\n";
}

/**
 * Where the top-level `dependencies` **value** sits in a manifest's text, and
 * how far its key is indented.
 *
 * A hand-written scan rather than a JSON parser with spans, because the only
 * question is where one top-level key's value starts and ends, and the answer
 * has to be over the *bytes* \u2014 `JSON.parse` gives a value with no positions,
 * and a regular expression over a file that may contain the word
 * `"dependencies"` inside a string somewhere else would find the wrong one.
 * Nothing here validates: the text has already parsed by the time this is
 * asked.
 */
function dependenciesValueSpan(
  text: string,
): { start: number; end: number; indent: string } | undefined {
  let depth = 0;
  let at = 0;
  // **The last** top-level `dependencies`, not the first. JSON permits a key
  // twice and `JSON.parse` keeps the later one, so the entries this edit was
  // built from are the later array's — writing them over the earlier one
  // produces valid JSON whose effective `dependencies` is unchanged, and the
  // user clicks the fix, watches the report stay, and is told nothing.
  let found: { start: number; end: number; indent: string } | undefined;
  while (at < text.length) {
    const character = text[at]!;
    if (character === '"') {
      const end = endOfString(text, at);
      // A key is a string at the object's own depth followed by a colon; a
      // value that happens to spell `dependencies` is at a greater depth or has
      // no colon after it.
      const after = skipSpace(text, end);
      if (depth === 1 && text[after] === ":" && text.slice(at, end) === '"dependencies"') {
        const start = skipSpace(text, after + 1);
        const close = text[start] === "[" ? endOfArray(text, start) : undefined;
        // A value that is not an array, or an array that never closes, leaves
        // nothing to scope to — and the scan carries on rather than answering,
        // because a *later* `dependencies` may be the one that parsed. Where
        // the last one is the unscopable one the whole-document rewrite is the
        // answer, and it is the branch that collapses the duplicate anyway.
        found = close === undefined
          ? undefined
          : { start, end: close, indent: indentOfLine(text, at) };
        at = close ?? start;
        continue;
      }
      at = end;
      continue;
    }
    if (character === "{" || character === "[") depth += 1;
    if (character === "}" || character === "]") depth -= 1;
    at += 1;
  }
  return found;
}

/** The offset one past a string literal starting at `at`, escapes honoured. */
function endOfString(text: string, at: number): number {
  let index = at + 1;
  while (index < text.length) {
    if (text[index] === "\\") index += 2;
    else if (text[index] === '"') return index + 1;
    else index += 1;
  }
  return text.length;
}

/** The offset one past the array starting at `at`. */
function endOfArray(text: string, at: number): number | undefined {
  let depth = 0;
  let index = at;
  while (index < text.length) {
    const character = text[index]!;
    if (character === '"') {
      index = endOfString(text, index);
      continue;
    }
    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return undefined;
}

function skipSpace(text: string, at: number): number {
  let index = at;
  while (index < text.length && /\s/u.test(text[index]!)) index += 1;
  return index;
}

/** The whitespace opening the line `at` lies on. */
function indentOfLine(text: string, at: number): string {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  return /^[\t ]*/u.exec(text.slice(start, at))![0];
}

/** A byte offset as the protocol's line and character. */
function positionAt(text: string, offset: number): { line: number; character: number } {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length - 1, character: before.at(-1)!.length };
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
