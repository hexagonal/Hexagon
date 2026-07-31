/**
 * The VS Code side of Hexagon language support.
 *
 * This extension holds no knowledge of Hexagon. It starts
 * `hexagon-language-server` as a child process, hands it the workspace, and
 * lets `vscode-languageclient` route requests — so hover, diagnostics,
 * go-to-definition and find-references all come from the compiler, and adding a
 * feature to the server makes it appear here with no change to this file.
 *
 * Only two things are decided here, and both are about the editor rather than
 * the language: which server binary to run, and when to restart it.
 */

import { join } from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";

const LANGUAGE_ID = "hexagon";
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
    documentSelector: [{ scheme: "file", language: LANGUAGE_ID }],
    synchronize: {
      // A `.hex` file can change without ever being opened — a branch switch, a
      // generated module — and the server needs to hear about it, because a
      // module it never sees can still be the reason an open one fails.
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.hex"),
    },
    outputChannelName: CLIENT_NAME,
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
  await running.stop();
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
