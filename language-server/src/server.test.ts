/**
 * Protocol-level tests: a real client talking to the real server over a pipe
 * pair, exchanging real JSON-RPC.
 *
 * The point of testing at this level rather than by calling handlers is that
 * almost everything that goes wrong in a language server goes wrong *between*
 * the two halves — a capability not announced, a URI that does not round-trip,
 * a range off by a line, a notification never sent. None of that is visible to a
 * test that calls a handler directly.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  ExitNotification,
  InitializeRequest,
  InitializedNotification,
  PublishDiagnosticsNotification,
  ShutdownRequest,
  createProtocolConnection,
  type Diagnostic,
  type Hover,
  type InitializeResult,
  type Location,
  type ProtocolConnection,
} from "vscode-languageserver-protocol";
import {
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-languageserver-protocol/node.js";
import { createConnection } from "vscode-languageserver/node.js";
import { startServer } from "./server.js";

const HELPER = [
  "export union Colour =",
  "    | Red",
  "    | Green",
  "",
  "export let brighten(colour: Colour): Colour = colour",
  "",
].join("\n");

const MAIN = [
  'import {Colour, brighten, Red} from "./helper"',
  "",
  "let start: Colour = Red",
  "let finish: Colour = brighten(start)",
  "",
].join("\n");

/** Position of the `nth` occurrence of `needle`, as a zero-based line/character. */
function positionOf(text: string, needle: string, nth = 1): { line: number; character: number } {
  let offset = -1;
  for (let found = 0; found < nth; found += 1) {
    offset = text.indexOf(needle, offset + 1);
    if (offset < 0) throw new Error(`no occurrence ${nth} of ${JSON.stringify(needle)}`);
  }
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  return { line, character: offset - (before.lastIndexOf("\n") + 1) };
}

interface Harness {
  readonly client: ProtocolConnection;
  readonly root: string;
  readonly uriOf: (name: string) => string;
  readonly diagnosticsFor: (uri: string) => Promise<readonly Diagnostic[]>;
  readonly dispose: () => Promise<void>;
}

/** Starts a server on an in-memory pipe pair over a real temporary workspace. */
async function harness(files: Record<string, string>): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "hexagon-lsp-"));
  for (const [name, text] of Object.entries(files)) {
    await writeFile(join(root, name), text, "utf8");
  }

  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const server = createConnection(
    new StreamMessageReader(clientToServer),
    new StreamMessageWriter(serverToClient),
  );
  startServer(server);

  const client = createProtocolConnection(
    new StreamMessageReader(serverToClient),
    new StreamMessageWriter(clientToServer),
  );
  const latest = new Map<string, Diagnostic[]>();
  const waiting = new Map<string, (diagnostics: Diagnostic[]) => void>();
  client.onNotification(PublishDiagnosticsNotification.type, ({ uri, diagnostics }) => {
    const waiter = waiting.get(uri);
    if (waiter !== undefined) {
      // Delivered straight to the waiter and *not* cached: leaving a copy
      // behind makes the next wait return the publication just consumed.
      waiting.delete(uri);
      waiter(diagnostics);
      return;
    }
    latest.set(uri, diagnostics);
  });
  client.listen();

  await client.sendRequest(InitializeRequest.type, {
    processId: null,
    rootUri: pathToFileURL(root).toString(),
    capabilities: {},
    workspaceFolders: [{ uri: pathToFileURL(root).toString(), name: "test" }],
  });
  await client.sendNotification(InitializedNotification.type, {});

  return {
    client,
    root,
    uriOf: (name) => pathToFileURL(join(root, name)).toString(),
    /** The next publication for a URI, or the one already received. */
    diagnosticsFor: (uri) =>
      new Promise((resolve) => {
        const seen = latest.get(uri);
        if (seen !== undefined) {
          latest.delete(uri);
          resolve(seen);
          return;
        }
        waiting.set(uri, resolve);
      }),
    dispose: async () => {
      await client.sendRequest(ShutdownRequest.type, undefined);
      await client.sendNotification(ExitNotification.type);
      client.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}

describe("the Hexagon language server", () => {
  let hex: Harness;

  beforeAll(async () => {
    hex = await harness({ "helper.hex": HELPER, "main.hex": MAIN });
    await hex.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: hex.uriOf("main.hex"), languageId: "hexagon", version: 1, text: MAIN },
    });
  });

  afterAll(async () => {
    await hex.dispose();
  });

  test("announces exactly the capabilities this slice implements", async () => {
    const solo = await harness({ "main.hex": "let value: Int = 1\n" });
    try {
      // A capability announced but unimplemented is worse than one withheld:
      // the editor offers the user a command that silently does nothing.
      const result = await solo.client.sendRequest(InitializeRequest.type, {
        processId: null,
        rootUri: null,
        capabilities: {},
      }) as InitializeResult;
      expect(result.capabilities.hoverProvider).toBe(true);
      expect(result.capabilities.definitionProvider).toBe(true);
      expect(result.capabilities.referencesProvider).toBe(true);
      expect(result.capabilities.textDocumentSync).toBe(2);
      expect(result.capabilities.completionProvider).toBeUndefined();
      expect(result.capabilities.renameProvider).toBeUndefined();
      expect(result.capabilities.documentFormattingProvider).toBeUndefined();
    } finally {
      await solo.dispose();
    }
  });

  test("hover reports the checker's type at a use", async () => {
    const hover = await hex.client.sendRequest("textDocument/hover", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "brighten", 2),
    }) as Hover | null;
    expect(hover).not.toBeNull();
    // One shape for every hover — what it is, then its type when it has one —
    // so the layout is not itself something to parse before the content.
    expect((hover!.contents as { value: string }).value).toBe(
      "value `brighten: Colour -> Colour`",
    );
    // The range is what the editor underlines; it must cover the name and no more.
    expect(hover!.range).toEqual({
      start: { line: 3, character: 21 },
      end: { line: 3, character: 29 },
    });
  });

  test("hover names a type without inventing a value type for it", async () => {
    const hover = await hex.client.sendRequest("textDocument/hover", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "Colour", 2),
    }) as Hover | null;
    expect((hover!.contents as { value: string }).value).toBe("union `Colour`");
  });

  test("go-to-definition crosses into a file that was never opened", async () => {
    const definition = await hex.client.sendRequest("textDocument/definition", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "brighten", 2),
    }) as Location[] | null;
    expect(definition).toHaveLength(1);
    // `helper.hex` is on disk and never opened, which is the whole point: a
    // definition usually lives in a module the user is not looking at.
    expect(definition![0]!.uri).toBe(hex.uriOf("helper.hex"));
    expect(definition![0]!.range).toEqual({
      start: { line: 4, character: 11 },
      end: { line: 4, character: 19 },
    });
  });

  test("find-references spans both files and both roles", async () => {
    const references = await hex.client.sendRequest("textDocument/references", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "Colour", 2),
      context: { includeDeclaration: true },
    }) as Location[] | null;
    const uris = new Set(references!.map(({ uri }) => uri));
    expect(uris).toEqual(new Set([hex.uriOf("helper.hex"), hex.uriOf("main.hex")]));
    expect(references!.length).toBe(6);

    const withoutDeclaration = await hex.client.sendRequest("textDocument/references", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "Colour", 2),
      context: { includeDeclaration: false },
    }) as Location[] | null;
    expect(withoutDeclaration!.length).toBe(5);
  });

  test("a position with nothing at it answers null, not an empty list", async () => {
    // An empty array is a valid answer meaning "no locations"; null is the one
    // that lets an editor fall back to its own behaviour. For a blank column
    // there is genuinely nothing, so null is the honest reply.
    const hover = await hex.client.sendRequest("textDocument/hover", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: { line: 1, character: 0 },
    });
    expect(hover).toBeNull();
  });

  test("diagnostics arrive for an edit, and are cleared when it is fixed", async () => {
    const uri = hex.uriOf("main.hex");
    const broken = `${MAIN}\nlet oops: Colour = Purple\n`;
    await hex.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: broken }],
    });
    const reported = await hex.diagnosticsFor(uri);
    expect(reported.map(({ message }) => message)).toEqual(["unknown name `Purple`"]);
    expect(reported[0]!.source).toBe("hexagon");
    expect(reported[0]!.severity).toBe(1);
    expect(reported[0]!.range.start.line).toBe(5);

    await hex.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 3 },
      contentChanges: [{ text: MAIN }],
    });
    // Clearing is explicit: an editor removes squiggles only on an empty
    // publish, never by the server going quiet.
    expect(await hex.diagnosticsFor(uri)).toEqual([]);
  });

  test("a broken workspace reports before any document is opened", async () => {
    const solo = await harness({ "main.hex": "let broken: Int =\n" });
    try {
      // The Problems panel is the ordinary way to ask "what is wrong here?", and
      // it is reachable without opening a file. Waiting for a document event to
      // publish would answer that question with silence.
      const reported = await solo.diagnosticsFor(solo.uriOf("main.hex"));
      expect(reported.length).toBeGreaterThan(0);
    } finally {
      await solo.dispose();
    }
  });

  test("an unopened file's diagnostics reach the editor too", async () => {
    const solo = await harness({
      "main.hex": 'import {absent} from "./helper"\n',
      "helper.hex": "export let present: Int = 1\n",
    });
    try {
      await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri: solo.uriOf("main.hex"),
          languageId: "hexagon",
          version: 1,
          text: 'import {absent} from "./helper"\n',
        },
      });
      const reported = await solo.diagnosticsFor(solo.uriOf("main.hex"));
      expect(reported.map(({ message }) => message)).toEqual([
        "module `./helper` does not export `absent`",
      ]);
    } finally {
      await solo.dispose();
    }
  });

  test("the buffer wins over disk while a document is open", async () => {
    const solo = await harness({
      "helper.hex": "export let two: Int = 2\n",
      "main.hex": 'import {two} from "./helper"\n\nlet four: Int = two + two\n',
    });
    try {
      const helperUri = solo.uriOf("helper.hex");
      const mainUri = solo.uriOf("main.hex");
      await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri: mainUri,
          languageId: "hexagon",
          version: 1,
          text: 'import {two} from "./helper"\n\nlet four: Int = two + two\n',
        },
      });
      await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri: helperUri, languageId: "hexagon", version: 1, text: "export let two: Int = 2\n" },
      });
      // Deleting the export in the *buffer* must break the importer, even
      // though disk still has it. Unsaved edits are what the user sees.
      await solo.client.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri: helperUri, version: 2 },
        contentChanges: [{ text: "export let three: Int = 3\n" }],
      });
      const reported = await solo.diagnosticsFor(mainUri);
      expect(reported.map(({ message }) => message)).toEqual([
        "module `./helper` does not export `two`",
        "unknown name `two`",
        "unknown name `two`",
      ]);

      // Closing without saving hands the file back to disk, which still has it.
      await solo.client.sendNotification(DidCloseTextDocumentNotification.type, {
        textDocument: { uri: helperUri },
      });
      expect(await solo.diagnosticsFor(mainUri)).toEqual([]);
    } finally {
      await solo.dispose();
    }
  });

  test("a saved document keeps answering after the save", async () => {
    const uri = hex.uriOf("main.hex");
    await hex.client.sendNotification(DidSaveTextDocumentNotification.type, {
      textDocument: { uri },
    });
    const hover = await hex.client.sendRequest("textDocument/hover", {
      textDocument: { uri },
      position: positionOf(MAIN, "brighten", 2),
    }) as Hover | null;
    expect(hover).not.toBeNull();
  });

  test("a request for a document the server has not been told about answers null", async () => {
    const hover = await hex.client.sendRequest("textDocument/hover", {
      textDocument: { uri: hex.uriOf("helper.hex") },
      position: { line: 4, character: 12 },
    });
    // `helper.hex` is in the workspace but was never opened, so the server has
    // no buffer to resolve the position against and must not guess.
    expect(hover).toBeNull();
  });

  test("a manifest edit reloads however the client spells its URI", async () => {
    const solo = await harness({
      "main.hex": "let value: Int = 1\n",
      "hexagon.json": JSON.stringify({ exclude: ["generated"] }),
    });
    try {
      const mainUri = solo.uriOf("main.hex");
      await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri: mainUri,
          languageId: "hexagon",
          version: 1,
          text: "let value: Int = 1\n",
        },
      });
      await writeFile(join(solo.root, "generated.hex"), "let oops: Int = \n");
      await writeFile(join(solo.root, "hexagon.json"), JSON.stringify({}));

      // A client spells a URI its own way — VS Code percent-encodes a Windows
      // drive colon where `pathToFileURL` does not. Matching manifest changes by
      // URI *string* means a manifest edit silently reloads nothing, forever, on
      // the platform the author did not test. `%68` is `h`: the same file, spelt
      // differently, standing in for that class of difference.
      const respelled = solo.uriOf("hexagon.json").replace(/hexagon\.json$/u, "%68exagon.json");
      await solo.client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri: respelled, type: 2 }],
      });
      // Diagnostics for the newly-included file are the proof the reload
      // happened at all; their exact wording is the compiler's business.
      const reported = await solo.diagnosticsFor(solo.uriOf("generated.hex"));
      expect(reported.length).toBeGreaterThan(0);
    } finally {
      await solo.dispose();
    }
  });

  test("an open file that is excluded says so rather than going quiet", async () => {
    const solo = await harness({
      "main.hex": "let value: Int = 1\n",
      "hexagon.json": JSON.stringify({ exclude: ["vendor"] }),
    });
    try {
      await mkdir(join(solo.root, "vendor"));
      const vendored = join(solo.root, "vendor", "thing.hex");
      await writeFile(vendored, "let broken: Int = \n");
      const uri = pathToFileURL(vendored).toString();
      await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId: "hexagon", version: 1, text: "let broken: Int = \n" },
      });
      // Silence would read as a broken server: the grammar still colours the
      // buffer and the server is visibly running, so the user reports a bug
      // instead of opening `hexagon.json`.
      const reported = await solo.diagnosticsFor(uri);
      expect(reported).toHaveLength(1);
      expect(reported[0]!.severity).toBe(3);
      expect(reported[0]!.message).toContain("excluded from the project");
      expect(reported.some(({ message }) => message.includes("expected"))).toBe(false);
    } finally {
      await solo.dispose();
    }
  });

  test("un-excluding restores an open buffer without waiting for a keystroke", async () => {
    const solo = await harness({
      "main.hex": "let value: Int = 1\n",
      "hexagon.json": JSON.stringify({ exclude: ["vendor"] }),
    });
    try {
      await mkdir(join(solo.root, "vendor"));
      const vendored = join(solo.root, "vendor", "thing.hex");
      const text = "export let vendored: Int = 7\n";
      await writeFile(vendored, text);
      const uri = pathToFileURL(vendored).toString();
      await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId: "hexagon", version: 1, text },
      });
      expect((await solo.diagnosticsFor(uri))[0]!.message).toContain("excluded");

      await writeFile(join(solo.root, "hexagon.json"), JSON.stringify({}));
      await solo.client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri: solo.uriOf("hexagon.json"), type: 2 }],
      });
      expect(await solo.diagnosticsFor(uri)).toEqual([]);

      // The rescan reads disk and skips what the editor holds open, so nothing
      // re-adds this buffer unless the server does it. Without that the file is
      // in neither source and stays dead until the user types.
      const hover = await solo.client.sendRequest("textDocument/hover", {
        textDocument: { uri },
        position: { line: 0, character: 12 },
      }) as Hover | null;
      expect(hover).not.toBeNull();
      expect((hover!.contents as { value: string }).value).toContain("vendored");
    } finally {
      await solo.dispose();
    }
  });
});
