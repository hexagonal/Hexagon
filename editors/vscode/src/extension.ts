/**
 * The VS Code side of Hexagon language support.
 *
 * This extension holds no knowledge of Hexagon. It starts
 * `hexagon-language-server` as a child process, hands it the workspace, and
 * lets `vscode-languageclient` route requests — so hover, diagnostics,
 * go-to-definition and find-references all come from the compiler, and adding a
 * feature to the server makes it appear here with no change to this file.
 *
 * Only three things are decided here, and all are about the editor rather than
 * the language: which server binary to run, when to restart it, and what a
 * hover sends when the pointer is inside a selection (`hover-selection.ts`),
 * which the protocol has no place for.
 */

import { join } from "node:path";
import * as vscode from "vscode";
import {
  HoverRequest,
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type Position,
  type ServerOptions,
} from "vscode-languageclient/node";
import { hoverSelection } from "./hover-selection.js";
import { trustedStandardLibraryProjects } from "./settings.js";

const LANGUAGE_ID = "hexagon";
/** The manifest's name, spelled here as the server spells it. */
const MANIFEST_NAME = "hexagon.json";
const CONFIGURATION_SECTION = "hexagon";
const CLIENT_ID = "hexagonLanguageServer";
const CLIENT_NAME = "Hexagon Language Server";

let client: LanguageClient | undefined;
/**
 * Increments on every start or stop. Starting a client is asynchronous, so a
 * second start can begin while the first is still awaiting `start()` — toggling
 * the enable setting during activation is enough. Each start captures the
 * generation it began in and touches the shared `client` only while that
 * generation is still current, so a losing start cannot clear the winner's
 * client and strand its child process.
 */
let generation = 0;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand("hexagon.restartLanguageServer", async () => {
      await stopClient();
      await startClient(context);
    }),
  );

  // Turning the server on or off, or pointing it at a different build, has to
  // take effect without reloading the window: the setting exists mostly for
  // developing the server, where a reload every iteration is the whole cost.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration(`${CONFIGURATION_SECTION}.languageServer`)) return;
      await stopClient();
      await startClient(context);
    }),
  );

  await startClient(context);
}

export async function deactivate(): Promise<void> {
  await stopClient();
}

async function startClient(context: vscode.ExtensionContext): Promise<void> {
  const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  if (configuration.get<boolean>("languageServer.enabled") !== true) return;

  generation += 1;
  const started = generation;
  const module = serverModule(context, configuration);
  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.stdio },
    // The debug server gets an inspector port so the server can be attached to
    // from the same window that is exercising it.
    debug: {
      module,
      transport: TransportKind.stdio,
      options: { execArgv: ["--nolazy", "--inspect=6019"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    initializationOptions: {
      trustedStandardLibraryProjects: trustedStandardLibraryProjects(configuration),
    },
    documentSelector: [
      { scheme: "file", language: LANGUAGE_ID },
      // `hexagon.json` too, for one reason: the server's not-a-dependency quick
      // fix edits it, and an edit measured against the last *saved* text lands
      // in the buffer the user is looking at. Where that buffer is longer than
      // what was saved, the range stops short and the tail survives the
      // replacement — a manifest that is no longer JSON, produced by a repair.
      // So the manifest is synchronised, the server reads the buffer, and the
      // edit carries the version it was measured against. By pattern rather
      // than by language id, because a user may have `hexagon.json` associated
      // with JSON, with JSONC, or with nothing at all.
      { scheme: "file", pattern: `**/${MANIFEST_NAME}` },
    ],
    synchronize: {
      // A `.hex` file can change without ever being opened — a branch switch, a
      // generated module — and the server needs to hear about it, because a
      // module it never sees can still be the reason an open one fails.
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.hex"),
    },
    outputChannelName: CLIENT_NAME,
    middleware: {
      // A pointer inside a selection hovers the selection: the server answers
      // with the type of the expression it names. As rust-analyzer's extension
      // does, the selection goes where the protocol has a position.
      provideHover: async (document, position, token, next) => {
        const selections = vscode.window.visibleTextEditors
          .filter((editor) => editor.document === document)
          .flatMap((editor) => editor.selections);
        const selection = hoverSelection(selections, position, starting.initializeResult?.capabilities);
        if (selection === undefined) return next(document, position, token);
        const converter = starting.code2ProtocolConverter;
        const answer = await starting.sendRequest(
          HoverRequest.type,
          {
            textDocument: converter.asTextDocumentIdentifier(document),
            position: converter.asRange(selection) as unknown as Position,
          },
          token,
        );
        return answer === null ? null : starting.protocol2CodeConverter.asHover(answer);
      },
    },
  };

  const starting = new LanguageClient(CLIENT_ID, CLIENT_NAME, serverOptions, clientOptions);
  if (generation === started) client = starting;
  try {
    await starting.start();
    // A newer start or a stop overtook this one while it was starting. Its
    // server is now nobody's, so it has to be shut down here or it outlives the
    // extension as an orphaned child process.
    if (generation !== started) await starting.stop();
  } catch (error) {
    if (generation === started) client = undefined;
    // A server that fails to start must say so: silently falling back to
    // highlighting alone looks like the features were never implemented.
    void vscode.window.showErrorMessage(
      `Hexagon language server failed to start: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function stopClient(): Promise<void> {
  generation += 1;
  const running = client;
  client = undefined;
  if (running === undefined) return;
  try {
    await running.stop();
  } catch {
    // `stop()` throws outright for a client that is still starting — the library
    // cannot interrupt a start in progress. Every caller stops in order to start
    // again, so letting that propagate would abort the restart and leave the
    // user with no server until the window reloads, reporting only an unhandled
    // rejection. Swallowing it is safe precisely because the generation moved:
    // the start still in flight will find itself overtaken and shut its own
    // server down when it completes.
  }
}

/**
 * The server to run: an explicitly configured build when there is one, and
 * otherwise the copy bundled beside this extension. The override exists so the
 * server can be developed against a real editor without reinstalling the
 * extension after every build.
 */
function serverModule(
  context: vscode.ExtensionContext,
  configuration: vscode.WorkspaceConfiguration,
): string {
  const configured = configuration.get<string>("languageServer.path")?.trim();
  if (configured !== undefined && configured !== "") return configured;
  return context.asAbsolutePath(join("dist", "server.cjs"));
}
