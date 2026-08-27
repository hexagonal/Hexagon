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
  CompletionItemKind,
  createProtocolConnection,
  type CompletionItem,
  type Diagnostic,
  type Hover,
  type CodeAction,
  type InitializeParams,
  type InitializeResult,
  type Location,
  type Range,
  type SemanticTokens,
  type TextEdit,
  type WorkspaceEdit,
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

/**
 * Applies a set of protocol edits to a text, back to front so that an earlier
 * replacement cannot move a later one. Tests assert on the *result* rather than
 * on the edit list: a rename is right when the file it produces is right, and a
 * list of ranges is only evidence about that.
 */
function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") lineStarts.push(index + 1);
  }
  const offsetOf = (position: { line: number; character: number }): number =>
    lineStarts[position.line]! + position.character;
  return [...edits]
    .sort((left, right) => offsetOf(right.range.start) - offsetOf(left.range.start))
    .reduce(
      (result, { range, newText }) =>
        result.slice(0, offsetOf(range.start)) + newText + result.slice(offsetOf(range.end)),
      text,
    );
}

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

/**
 * Decodes the protocol's flat token array back into `text:type` against the
 * source, using the legend the server announced.
 *
 * Decoding rather than asserting on the numbers is the point: the numbers are
 * relative, so a wrong one is only visible as the wrong *name* being coloured,
 * which is what a user would see. An assertion on the raw array would agree with
 * whatever the encoder did.
 */
function decodeTokens(
  text: string,
  data: readonly number[],
  legend: { readonly tokenTypes: readonly string[] },
): readonly string[] {
  const lines = text.split("\n");
  const decoded: string[] = [];
  let line = 0;
  let column = 0;
  for (let at = 0; at < data.length; at += 5) {
    const [deltaLine, deltaStart, length, type] = data.slice(at, at + 5) as [
      number, number, number, number, number,
    ];
    line += deltaLine;
    column = deltaLine === 0 ? column + deltaStart : deltaStart;
    decoded.push(`${lines[line]!.slice(column, column + length)}:${legend.tokenTypes[type]}`);
  }
  return decoded;
}

/**
 * How long a wait for a particular publication gives up after. Generous next to
 * the server's diagnostic debounce, and short enough to fail with its own
 * message rather than as an anonymous test timeout.
 */
const PUBLICATION_TIMEOUT_MS = 3_000;

interface Harness {
  readonly client: ProtocolConnection;
  readonly capabilities: InitializeResult["capabilities"];
  readonly root: string;
  readonly uriOf: (name: string) => string;
  readonly diagnosticsFor: (uri: string) => Promise<readonly Diagnostic[]>;
  readonly diagnosticsUntil: (
    uri: string,
    matches: (diagnostics: readonly Diagnostic[]) => boolean,
    waitingFor: string,
  ) => Promise<readonly Diagnostic[]>;
  /** Whatever has already arrived for a URI, without waiting for more. */
  readonly publishedFor: (uri: string) => readonly Diagnostic[] | undefined;
  readonly dispose: () => Promise<void>;
}

/**
 * Starts a server on an in-memory pipe pair over a real temporary workspace.
 *
 * `capabilities` is what the *client* declares. Most tests declare nothing,
 * which is the honest default for a protocol test: a server must work against a
 * client that announces the minimum. Code actions are the exception, since their
 * shape is chosen from what the client says it understands.
 */
async function harness(
  files: Record<string, string>,
  capabilities: InitializeParams["capabilities"] = {},
): Promise<Harness> {
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

  const initialized = await client.sendRequest(InitializeRequest.type, {
    processId: null,
    rootUri: pathToFileURL(root).toString(),
    capabilities,
    workspaceFolders: [{ uri: pathToFileURL(root).toString(), name: "test" }],
  }) as InitializeResult;
  await client.sendNotification(InitializedNotification.type, {});

  /** The next publication for a URI, or the one already received. */
  const nextPublication = (uri: string, take: (diagnostics: Diagnostic[]) => void): void => {
    const seen = latest.get(uri);
    if (seen !== undefined) {
      latest.delete(uri);
      take(seen);
      return;
    }
    waiting.set(uri, take);
  };

  return {
    client,
    capabilities: initialized.capabilities,
    root,
    uriOf: (name) => pathToFileURL(join(root, name)).toString(),
    diagnosticsFor: (uri) => new Promise((resolve) => nextPublication(uri, resolve)),
    /**
     * Publications for a URI, consumed in order until one matches.
     *
     * The protocol carries no version on a publication and the server sends
     * none — deliberately, for the reason `server.ts` gives. So a test cannot
     * ask "the diagnostics for *my* edit"; the honest question is "the first
     * publication that says what I am waiting for", with everything before it
     * consumed rather than left behind to answer somebody else's wait. A server
     * that never says it fails here by timing out, naming what it was owed.
     */
    diagnosticsUntil: (uri, matches, waitingFor) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(uri);
          reject(new Error(
            `no publication for ${uri} was ${waitingFor} within ${PUBLICATION_TIMEOUT_MS}ms`,
          ));
        }, PUBLICATION_TIMEOUT_MS);
        const consider = (diagnostics: Diagnostic[]): void => {
          if (!matches(diagnostics)) {
            nextPublication(uri, consider);
            return;
          }
          clearTimeout(timer);
          resolve(diagnostics);
        };
        nextPublication(uri, consider);
      }),
    publishedFor: (uri) => latest.get(uri),
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
      expect(result.capabilities.renameProvider).toEqual({ prepareProvider: true });
      expect(result.capabilities.completionProvider).toEqual({ triggerCharacters: ["."] });
      expect(result.capabilities.semanticTokensProvider).toMatchObject({ full: true });
      // Withheld from *this* client because it declared no capabilities: every
      // action this server offers is a literal carrying its own edit, and a
      // client that cannot read one has nothing to apply.
      expect(result.capabilities.codeActionProvider).toBeUndefined();
      // Still withheld from everyone, and still deliberately: a capability
      // announced but unimplemented offers a command that silently does nothing.
      expect(result.capabilities.documentFormattingProvider).toBeUndefined();
      expect(result.capabilities.workspaceSymbolProvider).toBeUndefined();
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

  /**
   * `spec/doc-comments.md` §8, over the wire: hover and completion carry doc
   * content, and carry it as Markdown, which is the form §6 says it is in.
   */
  describe("documentation", () => {
    const DOCUMENTED = [
      "(** Brightens a colour.",
      "",
      "    Fenced, even:",
      "",
      "    ```",
      "    brighten(Red)",
      "    ``` *)",
      "export let brighten(colour: Int): Int = colour",
      "",
      "export record Box = {",
      "    (** How wide it is. *)",
      "    width: Int,",
      "}",
      "",
      "let probe: Int = 1",
      "",
    ].join("\n");

    let documented: Harness;

    beforeAll(async () => {
      documented = await harness({ "main.hex": DOCUMENTED });
      await documented.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri: documented.uriOf("main.hex"),
          languageId: "hexagon",
          version: 1,
          text: DOCUMENTED,
        },
      });
    });

    afterAll(async () => {
      await documented.dispose();
    });

    test("hover puts the content under the signature, as Markdown", async () => {
      const hover = await documented.client.sendRequest("textDocument/hover", {
        textDocument: { uri: documented.uriOf("main.hex") },
        position: positionOf(DOCUMENTED, "brighten", 2),
      }) as Hover | null;
      expect(hover!.contents).toEqual({
        kind: "markdown",
        // Verbatim under the signature: the fence and the blank lines are the
        // author's Markdown, and the separator is a blank line rather than a
        // `---`, which after a line of text is a heading marker.
        value: "value `brighten: Int -> Int`\n\n" +
          "Brightens a colour.\n\nFenced, even:\n\n```\nbrighten(Red)\n```",
      });
    });

    test("hover answers a record field, which has documentation and nothing else", async () => {
      const hover = await documented.client.sendRequest("textDocument/hover", {
        textDocument: { uri: documented.uriOf("main.hex") },
        position: positionOf(DOCUMENTED, "width"),
      }) as Hover | null;
      // No word in front of the name: the session found no identity to name,
      // and inventing one would be a guess the user cannot check.
      expect(hover!.contents).toEqual({
        kind: "markdown",
        value: "`width`\n\nHow wide it is.",
      });
    });

    test("completion carries it in `documentation`, keeping `detail` for the type", async () => {
      const offered = await documented.client.sendRequest("textDocument/completion", {
        textDocument: { uri: documented.uriOf("main.hex") },
        position: positionOf(DOCUMENTED, "= 1"),
      }) as CompletionItem[];
      const brighten = offered.find(({ label }) => label === "brighten");
      expect(brighten).toMatchObject({
        detail: "Int -> Int",
        documentation: {
          kind: "markdown",
          value: "Brightens a colour.\n\nFenced, even:\n\n```\nbrighten(Red)\n```",
        },
      });
      // An undocumented offer carries no empty section for a client to render.
      expect(offered.find(({ label }) => label === "probe")?.documentation)
        .toBeUndefined();
    });
  });

  test("completion offers what is in scope, with kinds and types", async () => {
    const offered = await hex.client.sendRequest("textDocument/completion", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "brighten", 2),
    }) as CompletionItem[];
    const byLabel = new Map(offered.map((item) => [item.label, item]));
    expect(byLabel.get("brighten")).toMatchObject({
      kind: CompletionItemKind.Function,
      detail: "Colour -> Colour",
    });
    expect(byLabel.get("Red")).toMatchObject({ kind: CompletionItemKind.Constructor });
    expect(byLabel.get("Colour")).toMatchObject({ kind: CompletionItemKind.Class });
  });

  test("completion after a dot answers about that module alone", async () => {
    const uri = hex.uriOf("main.hex");
    const probing = `${MAIN}let probe: Int = Option.\n`;
    const send = (text: string, version: number) =>
      hex.client.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    const completeAt = (position: { line: number; character: number }) =>
      hex.client.sendRequest("textDocument/completion", {
        textDocument: { uri },
        position,
      }) as Promise<CompletionItem[] | null>;

    await send(probing, 99);
    try {
      const start = positionOf(probing, "Option.");
      const afterDot = { line: start.line, character: start.character + "Option.".length };
      // A half-typed `Option.` does not parse, which is the whole point: this is
      // the buffer completion is always asked about.
      const qualified = await completeAt(afterDot);
      expect(qualified?.length).toBeGreaterThan(0);
      // `start` is in scope on this line and would be offered unqualified. After
      // the dot the user has said which module they mean, so it must not appear.
      expect(qualified!.some((item) => item.label === "start")).toBe(false);
      const unqualified = await completeAt(start);
      expect(unqualified!.some((item) => item.label === "start")).toBe(true);
    } finally {
      // Both edits provoke diagnostics nobody here asks about, and a
      // publication left unconsumed is the answer some later test's first wait
      // receives. Taking the probe's *before* restoring the text also keeps the
      // two edits out of one debounce window, so the restore is sure to publish
      // the clearing this then consumes.
      await hex.diagnosticsUntil(
        uri,
        (published) => published.length > 0,
        "reporting the half-typed `Option.`",
      );
      // Restored because every test after this one asks about `MAIN`.
      await send(MAIN, 100);
      await hex.diagnosticsUntil(
        uri,
        (published) => published.length === 0,
        "clearing the restored text",
      );
    }
  });

  test("semantic tokens arrive decoded onto the right names", async () => {
    const result = await hex.client.sendRequest("textDocument/semanticTokens/full", {
      textDocument: { uri: hex.uriOf("main.hex") },
    }) as SemanticTokens;
    // Decoded back through the legend the server announced, so the test reads
    // the file the way the editor does rather than trusting the numbers.
    const provider = hex.capabilities.semanticTokensProvider as {
      legend: { tokenTypes: string[]; tokenModifiers: string[] };
    };
    expect(decodeTokens(MAIN, result.data, provider.legend)).toEqual([
      "Colour:enum",
      "brighten:function",
      "Red:enumMember",
      "start:variable",
      "Colour:enum",
      "Red:enumMember",
      "finish:variable",
      "Colour:enum",
      "brighten:function",
      "start:variable",
    ]);
  });

  test("prepare-rename offers the identifier alone, not the clause around it", async () => {
    const range = await hex.client.sendRequest("textDocument/prepareRename", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "brighten", 2),
    }) as Range | null;
    expect(range).toEqual({
      start: { line: 3, character: 21 },
      end: { line: 3, character: 29 },
    });
  });

  test("rename edits every file, including one never opened", async () => {
    const edit = await hex.client.sendRequest("textDocument/rename", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "brighten", 2),
      newName: "lighten",
    }) as WorkspaceEdit;
    const changes = edit.changes!;
    expect(Object.keys(changes).sort()).toEqual(
      [hex.uriOf("helper.hex"), hex.uriOf("main.hex")].sort(),
    );
    // `helper.hex` was never opened by this client; the declaration still moves,
    // because the session holds the workspace rather than the open buffers.
    expect(applyEdits(HELPER, changes[hex.uriOf("helper.hex")]!)).toBe(
      HELPER.replaceAll("brighten", "lighten"),
    );
    expect(applyEdits(MAIN, changes[hex.uriOf("main.hex")]!)).toBe(
      MAIN.replaceAll("brighten", "lighten"),
    );
  });

  test("a refused rename comes back as an error the editor can show", async () => {
    // The reason has to reach the user, and a failed request is the only channel
    // a rename has for saying one. `null` would read as "nothing to rename".
    await expect(hex.client.sendRequest("textDocument/rename", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "brighten", 2),
      newName: "let",
    })).rejects.toThrow(/not a name Hexagon can read/);
  });

  test("diagnostics arrive for an edit, and are cleared when it is fixed", async () => {
    const uri = hex.uriOf("main.hex");
    const broken = `${MAIN}\nlet oops: Colour = Purple\n`;
    await hex.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: broken }],
    });
    const reported = await hex.diagnosticsUntil(
      uri,
      (published) => published.length > 0,
      "reporting the broken edit",
    );
    expect(reported.map(({ message }) => message)).toEqual(["unknown name `Purple`"]);
    expect(reported[0]!.source).toBe("hexagon");
    expect(reported[0]!.severity).toBe(1);
    expect(reported[0]!.range.start.line).toBe(5);

    await hex.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 3 },
      contentChanges: [{ text: MAIN }],
    });
    // Clearing is explicit: an editor removes squiggles only on an empty
    // publish, never by the server going quiet — so it is the wait itself that
    // carries the claim, and a server that went quiet times out here.
    expect(await hex.diagnosticsUntil(
      uri,
      (published) => published.length === 0,
      "clearing the fixed edit",
    )).toEqual([]);
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

  test("a manifest mistake outranks an entry that matches nothing", async () => {
    const solo = await harness({
      "main.hex": "let value: Int = 1\n",
      "hexagon.json": ['{', '  "exclude": ["absent"],', '  "nope": []', '}'].join("\n"),
    });
    try {
      const reported = await solo.diagnosticsFor(solo.uriOf("hexagon.json"));
      // Reported against the manifest itself, at two volumes: a misspelled key
      // is wrong today and always will be, while an entry naming a path that is
      // not there yet is only inert. Publishing both as errors would teach a
      // user to ignore the file that explains their configuration.
      expect(reported.map(({ severity }) => severity).sort()).toEqual([1, 2]);
      expect(reported.find(({ severity }) => severity === 2)!.message)
        .toContain("matches no file");
      // The protocol types a character as `uinteger`, which is 32-bit. A client
      // deserializing `Number.MAX_SAFE_INTEGER` into an unsigned 32-bit integer
      // fails or wraps; VS Code clamps, which is why nothing here would notice.
      for (const { range } of reported) expect(range.end.character).toBe(2 ** 31 - 1);
    } finally {
      await solo.dispose();
    }
  });

  test("a nested manifest is skipped, not read into the session as Hexagon", async () => {
    const solo = await harness({ "main.hex": "let value: Int = 1\n" });
    try {
      // Only a *root's* manifest is read. A vendored sub-project's has to be
      // skipped rather than fall through to the file handler, which would hand
      // JSON to the Hexagon parser and report its braces as syntax errors — in
      // a file the user never opened and cannot fix by editing Hexagon. It also
      // never triggers a reload, so the junk would sit there until some root
      // manifest happened to change.
      await mkdir(join(solo.root, "vendor"));
      const nested = join(solo.root, "vendor", "hexagon.json");
      await writeFile(nested, JSON.stringify({ runtimePaths: [] }));
      const uri = pathToFileURL(nested).toString();
      await solo.client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri, type: 1 }],
      });

      // Something has to arrive before absence means anything, so this waits on
      // a real publication for another file and then checks the JSON got none.
      await writeFile(join(solo.root, "later.hex"), "let broken: Int = \n");
      await solo.client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri: solo.uriOf("later.hex"), type: 1 }],
      });
      expect((await solo.diagnosticsFor(solo.uriOf("later.hex"))).length).toBeGreaterThan(0);
      expect(solo.publishedFor(uri)).toBeUndefined();
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

  /**
   * What a modern client declares. Both halves are read: literal support decides
   * whether the capability is announced at all, and disabled support decides
   * whether a refusal can be shown.
   */
  const MODERN: InitializeParams["capabilities"] = {
    textDocument: {
      codeAction: {
        codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } },
        disabledSupport: true,
      },
    },
  };

  /** A file whose exported function has not written its return type. */
  const UNSIGNED = "export fun brighten(colour: Int) = colour + 1\n";

  async function opened(
    text: string,
    capabilities: InitializeParams["capabilities"],
  ): Promise<Harness> {
    const solo = await harness({ "main.hex": text }, capabilities);
    await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: solo.uriOf("main.hex"), languageId: "hexagon", version: 1, text },
    });
    return solo;
  }

  test("a quick fix writes the inferred return type into the file", async () => {
    const solo = await opened(UNSIGNED, MODERN);
    try {
      expect(solo.capabilities.codeActionProvider)
        .toEqual({ codeActionKinds: ["quickfix"] });
      const reported = await solo.diagnosticsFor(solo.uriOf("main.hex"));
      const actions = await solo.client.sendRequest("textDocument/codeAction", {
        textDocument: { uri: solo.uriOf("main.hex") },
        range: { start: reported[0]!.range.start, end: reported[0]!.range.start },
        context: { diagnostics: reported },
      }) as CodeAction[] | null;
      expect(actions).not.toBeNull();
      expect(actions!.map(({ title }) => title)).toEqual(["Infer return type"]);
      const [action] = actions!;
      expect(action!.kind).toBe("quickfix");
      // Carrying the diagnostic is what lets an editor group the fix under the
      // error it repairs rather than listing it loose.
      expect(action!.diagnostics?.[0]!.message).toContain("requires a complete signature");
      const edits = action!.edit!.changes![solo.uriOf("main.hex")]!;
      expect(applyEdits(UNSIGNED, edits))
        .toBe("export fun brighten(colour: Int): Int = colour + 1\n");
    } finally {
      await solo.dispose();
    }
  });

  test("a refusal arrives greyed out, carrying its reason", async () => {
    // The result is an open record whose row comes from `r`, and `r` has no
    // type yet — so the type is not settled and nothing may be written. What
    // matters at this layer is that the user gets the sentence, not silence.
    const source = "export fun copy(r) = {...r}\n";
    const solo = await opened(source, MODERN);
    try {
      const reported = await solo.diagnosticsFor(solo.uriOf("main.hex"));
      const actions = await solo.client.sendRequest("textDocument/codeAction", {
        textDocument: { uri: solo.uriOf("main.hex") },
        range: { start: reported[0]!.range.start, end: reported[0]!.range.start },
        context: { diagnostics: reported },
      }) as CodeAction[] | null;
      expect(actions![0]!.disabled?.reason)
        .toContain("`r` has no type yet, so the result type of `copy` is not settled");
      // A disabled action must carry no edit: a client that applied one anyway
      // would make exactly the change the reason says not to.
      expect(actions![0]!.edit).toBeUndefined();
    } finally {
      await solo.dispose();
    }
  });

  test("a client that cannot grey one out is sent nothing instead", async () => {
    const source = "export fun copy(r) = {...r}\n";
    const solo = await opened(source, {
      textDocument: {
        codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } } },
      },
    });
    try {
      const reported = await solo.diagnosticsFor(solo.uriOf("main.hex"));
      const actions = await solo.client.sendRequest("textDocument/codeAction", {
        textDocument: { uri: solo.uriOf("main.hex") },
        range: { start: reported[0]!.range.start, end: reported[0]!.range.start },
        context: { diagnostics: reported },
      }) as CodeAction[] | null;
      // Not an enabled one: an action that looks applicable and is not is worse
      // than an action that is missing.
      expect(actions).toBeNull();
    } finally {
      await solo.dispose();
    }
  });

  test("a request for other kinds of action gets none of these", async () => {
    const solo = await opened(UNSIGNED, MODERN);
    try {
      const reported = await solo.diagnosticsFor(solo.uriOf("main.hex"));
      const actions = await solo.client.sendRequest("textDocument/codeAction", {
        textDocument: { uri: solo.uriOf("main.hex") },
        range: { start: reported[0]!.range.start, end: reported[0]!.range.start },
        context: { diagnostics: reported, only: ["source.organizeImports"] },
      }) as CodeAction[] | null;
      // This is what keeps a fix-on-save configured for imports from rewriting
      // a signature the user never asked it to touch.
      expect(actions).toBeNull();
    } finally {
      await solo.dispose();
    }
  });

  test("nothing is offered away from a diagnostic", async () => {
    const solo = await opened(UNSIGNED, MODERN);
    try {
      await solo.diagnosticsFor(solo.uriOf("main.hex"));
      const actions = await solo.client.sendRequest("textDocument/codeAction", {
        textDocument: { uri: solo.uriOf("main.hex") },
        range: {
          start: positionOf(UNSIGNED, "colour", 2),
          end: positionOf(UNSIGNED, "colour", 2),
        },
        context: { diagnostics: [] },
      }) as CodeAction[] | null;
      expect(actions).toBeNull();
    } finally {
      await solo.dispose();
    }
  });
});

/**
 * The arrow trio over the wire (#364; Effects §10's display obligation).
 *
 * The obligation is that a *reader* can see a face, and the reader is an
 * editor — so the compiler's own display tests, which call the analysis session
 * directly, are not the whole of it. This block asks the real server, over real
 * JSON-RPC, for the hover text an editor would show, on all three arrows at
 * once: a constant-impure consumer, a numbered variable face, and a pure one.
 *
 * The test could not be written before this milestone: the flag decided the
 * grammar, and the server never set it, so a file spelling `=>` or `?` did not
 * lex here at all.
 *
 * `Stream.fold` is the specimen the ruling names for `->!`, and it is reached
 * as an ordinary prelude member from a file that declares no stream of its own.
 */
describe("hover renders the arrow trio", () => {
  const TRIO = [
    "export let held: Int = Stream.fold",
    "",
    "export let compose(first: String ->? String, second: String ->? String): (String ->? String) =",
    "    (document) => second?(first?(document))",
    "",
    "export let twice(step: Int -> Int, value: Int): Int = step(step(value))",
    "",
    "extern from \"./world.js\"",
    "    export conduit fun runner(step: () ->? String): Int",
    "",
  ].join("\n");

  let hex: Harness;

  beforeAll(async () => {
    hex = await harness({ "main.hex": TRIO, "world.js": "" });
    await hex.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: hex.uriOf("main.hex"), languageId: "hexagon", version: 1, text: TRIO },
    });
  });

  afterAll(async () => {
    await hex.dispose();
  });

  /** The hover text an editor would show where `needle` is written. */
  async function hovered(needle: string, nth = 1): Promise<string> {
    const hover = await hex.client.sendRequest("textDocument/hover", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(TRIO, needle, nth),
    }) as Hover | null;
    expect(hover).not.toBeNull();
    return (hover!.contents as { value: string }).value;
  }

  test("`->!` reaches the editor, on the face the ruling names", async () => {
    // `stream.md` §4.4's canonical worked example: a linked callback beside a
    // constant-impure self. Nothing here is numbered — one variable is what a
    // written signature spells, so the face writes back unchanged.
    //
    // The module's own doc comment rides along, which is the second half of
    // what a reader needs: the face says the callback decides nothing about
    // termination, and the sentence says what does.
    expect(await hovered("fold")).toBe(
      "value `fold: (Stream(a), b, (b, a) ->? b) ->! b`\n\n" +
      "Reduces the whole stream to one value, left to right, starting from\n" +
      "`initial`. It pulls to exhaustion, so it does not return on an ambient\n" +
      "source.",
    );
  });

  test("a face with two colours arrives numbered", async () => {
    // Effects §10's own specimen, and the one case that is still numbered
    // after #405: `compose`'s parameters share one variable and its own colour
    // is a second, unconstrained one. Two distinct colours is what the written
    // grammar cannot spell — it links every `->?` in a signature into one — so
    // the numbers are what say so. They are display-only: pasted back into
    // source they fail at the lexer, which is the point of numbering rather
    // than normalizing.
    expect(await hovered("compose")).toBe(
      "value `compose: (String ->?¹ String, String ->?¹ String) ->?² String ->?¹ String`",
    );
  });

  test("a pure face says nothing about colour", async () => {
    expect(await hovered("twice")).toBe("value `twice: (Int -> Int, Int) -> Int`");
  });

  test("a `conduit` boundary row reaches the editor as the linked face it is", async () => {
    // #409's keyword is declaration surface only: what it seats is one colour
    // variable at the outer arrow and at every `->?` slot, and what a reader
    // sees is therefore an ordinary single-variable face, undecorated. Asked of
    // the real server because the boundary row is the one face in the language
    // whose colour is *claimed* rather than inferred from a body.
    expect(await hovered("runner")).toBe("value `runner: (() ->? String) ->? Int`");
  });
});

/**
 * Modules §5.1 rule 2's companion fallback, over the wire (#531).
 *
 * The fallback resolves a bare name through a module alias, in both the type
 * and the constraint namespace. What it resolves *to* is the exporter's own
 * declaration — the same one the qualified spelling reaches — so the editor
 * answers must be indistinguishable from the qualified case: the hover names
 * the declaration, and go-to-definition lands in the module the user did not
 * open. Asked of the real server because "resolves" and "the editor can follow
 * it" are different claims, and the second is the one a reader of §5.3's idiom
 * actually experiences.
 */
describe("the companion fallback reaches the editor", () => {
  const POINT = [
    "opaque record Point = {x: Float, y: Float}",
    "",
    "export let getX(p: Point): Float = p.x",
    "",
  ].join("\n");

  const RENDER = [
    "export constraint Render<a> =",
    "    render(value: a): String",
    "",
  ].join("\n");

  const CONSUMER = [
    'import module Point from "./point"',
    'import module Render from "./render"',
    "",
    "export let norm(p: Point): Float = Point.getX(p)",
    "",
    "export let label<a: Render>(x: a): String = Render.render(x)",
    "",
  ].join("\n");

  let hex: Harness;

  beforeAll(async () => {
    hex = await harness({
      "point.hex": POINT,
      "render.hex": RENDER,
      "main.hex": CONSUMER,
    });
    await hex.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: hex.uriOf("main.hex"),
        languageId: "hexagon",
        version: 1,
        text: CONSUMER,
      },
    });
  });

  afterAll(async () => {
    await hex.dispose();
  });

  /** The hover text an editor would show at the `nth` occurrence of `needle`. */
  async function hovered(needle: string, nth = 1): Promise<string | null> {
    const hover = await hex.client.sendRequest("textDocument/hover", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(CONSUMER, needle, nth),
    }) as Hover | null;
    return hover === null ? null : (hover.contents as { value: string }).value;
  }

  /** Where go-to-definition lands at the `nth` occurrence of `needle`. */
  async function definedAt(needle: string, nth = 1): Promise<readonly Location[]> {
    return await hex.client.sendRequest("textDocument/definition", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(CONSUMER, needle, nth),
    }) as Location[];
  }

  test("hover on a fallback-resolved type names the declaration", async () => {
    // The second `Point` in the file: the import line's alias comes first, then
    // the annotation — which is the one the fallback answers.
    expect(await hovered("Point", 2)).toBe("record `Point`");
  });

  test("go-to-definition on it crosses into the companion module", async () => {
    const definition = await definedAt("Point", 2);
    expect(definition).toHaveLength(1);
    expect(definition[0]!.uri).toBe(hex.uriOf("point.hex"));
    expect(definition[0]!.range).toEqual({
      // `opaque record Point` — the head is one word since #590, so the name
      // starts seven columns earlier than it did under `export opaque`.
      start: { line: 0, character: 14 },
      end: { line: 0, character: 19 },
    });
  });

  test("hover on a fallback-resolved constraint names the declaration", async () => {
    expect(await hovered("Render", 2)).toBe("constraint `Render`");
  });

  test("go-to-definition on it crosses into the declaring module", async () => {
    const definition = await definedAt("Render", 2);
    expect(definition).toHaveLength(1);
    expect(definition[0]!.uri).toBe(hex.uriOf("render.hex"));
    expect(definition[0]!.range).toEqual({
      start: { line: 0, character: 18 },
      end: { line: 0, character: 24 },
    });
  });
});
