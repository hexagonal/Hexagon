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

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
import { removeTemporaryRoots, temporaryRoot } from "../../host/src/test-roots.js";

const HELPER = [
  "module Helper",
  "",
  "export union Colour =",
  "    | Red",
  "    | Green",
  "",
  "export let brighten(colour: Colour): Colour = colour",
  "",
].join("\n");

const MAIN = [
  "module Main",
  "",
  "import Helper",
  "",
  "let start: Helper.Colour = Helper.Red",
  "let finish: Helper.Colour = Helper.brighten(start)",
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
  const root = await temporaryRoot("hexagon-lsp-");
  for (const [name, text] of Object.entries(files)) {
    // Nested names are allowed so a fixture can lay down a `node_modules` tree:
    // a program's dependencies are directories, and a test that could only
    // write flat files could only test a project with none.
    await mkdir(dirname(join(root, name)), { recursive: true });
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
    const solo = await harness({ "main.hex": "module Main\n\nlet value: Int = 1\n" });
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
      position: positionOf(MAIN, "brighten"),
    }) as Hover | null;
    expect(hover).not.toBeNull();
    // One shape for every hover — what it is, then its type when it has one —
    // so the layout is not itself something to parse before the content.
    expect((hover!.contents as { value: string }).value).toBe(
      "value `brighten: Colour -> Colour`",
    );
    // The range is what the editor underlines; it must cover the name and no more.
    expect(hover!.range).toEqual({
      start: { line: 5, character: 35 },
      end: { line: 5, character: 43 },
    });
  });

  test("hover names a type without inventing a value type for it", async () => {
    const hover = await hex.client.sendRequest("textDocument/hover", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "Colour"),
    }) as Hover | null;
    expect((hover!.contents as { value: string }).value).toBe("union `Colour`");
  });

  test("go-to-definition crosses into a file that was never opened", async () => {
    const definition = await hex.client.sendRequest("textDocument/definition", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "brighten"),
    }) as Location[] | null;
    expect(definition).toHaveLength(1);
    // `helper.hex` is on disk and never opened, which is the whole point: a
    // definition usually lives in a module the user is not looking at.
    expect(definition![0]!.uri).toBe(hex.uriOf("helper.hex"));
    expect(definition![0]!.range).toEqual({
      start: { line: 6, character: 11 },
      end: { line: 6, character: 19 },
    });
  });

  test("find-references spans both files and both roles", async () => {
    const references = await hex.client.sendRequest("textDocument/references", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "Colour"),
      context: { includeDeclaration: true },
    }) as Location[] | null;
    const uris = new Set(references!.map(({ uri }) => uri));
    expect(uris).toEqual(new Set([hex.uriOf("helper.hex"), hex.uriOf("main.hex")]));
    // Five, not six: no import clause carries a name any more (#762), so
    // `/main.hex`'s mentions are the two annotations alone.
    expect(references!.length).toBe(5);

    const withoutDeclaration = await hex.client.sendRequest("textDocument/references", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "Colour"),
      context: { includeDeclaration: false },
    }) as Location[] | null;
    expect(withoutDeclaration!.length).toBe(4);
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
      "module Main",
      "",
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
      position: positionOf(MAIN, "brighten"),
    }) as CompletionItem[];
    const byLabel = new Map(offered.map((item) => [item.label, item]));
    expect(byLabel.get("brighten")).toMatchObject({
      kind: CompletionItemKind.Function,
      detail: "Colour -> Colour",
    });
    // The *type* is not offered bare: it is reached through the alias since
    // #762, and the type namespace here holds nothing for the spelling.
    expect(byLabel.get("Colour")).toBeUndefined();
    // The term half is offered bare, which is one spelling ahead of what the
    // resolver would accept — the offer is built from the symbols an import
    // makes reachable, and since #762 those are reachable only through the
    // alias. Pinned as the truth rather than asserted as the design: the
    // completion index's own reach is its arc's, not the import ruling's.
    expect(byLabel.get("Red")).toMatchObject({ kind: CompletionItemKind.Constructor });
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
    // The import line colours nothing: it carries a module alias, which is no
    // occurrence of a term or a type (#762).
    expect(decodeTokens(MAIN, result.data, provider.legend)).toEqual([
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
      position: positionOf(MAIN, "brighten"),
    }) as Range | null;
    expect(range).toEqual({
      start: { line: 5, character: 35 },
      end: { line: 5, character: 43 },
    });
  });

  test("rename edits every file, including one never opened", async () => {
    const edit = await hex.client.sendRequest("textDocument/rename", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "brighten"),
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

  /**
   * A rename plan's edits do not all write the same text (`RenameEdit.replacement`,
   * Foreign Enums §5.2): a literal `extern enum`'s generated `fromJsT`/`toJsT`
   * spell the type name they are derived from, so renaming the type has to write
   * `fromJsCardinality` where it writes `Cardinality` everywhere else.
   *
   * Pinned **at the protocol**, because that is where the fact is thrown away.
   * The session decides the per-edit text and this server copies it into
   * `newText`; a server that wrote `plan.newName` for every edit produced a
   * `WorkspaceEdit` that compiles to nothing, and every other test in this file
   * — and every test in the compiler's — went on passing, because none of them
   * has an edit whose text differs from the plan's name.
   */
  test("a rename writes each edit's own text, so a derived name follows its type", async () => {
    const bindings = "module Bindings\n\n" +
      'export extern enum Direction = "up" as Up | "down" as Down\n';
    const consumer = [
      "module Consumer",
      "",
      "import Bindings",
      "",
      "export let read(v: JsValue): Option(Bindings.Direction) = Bindings.fromJsDirection(v)",
      "",
    ].join("\n");
    const solo = await harness({ "bindings.hex": bindings, "consumer.hex": consumer });
    try {
      await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri: solo.uriOf("consumer.hex"),
          languageId: "hexagon",
          version: 1,
          text: consumer,
        },
      });
      const edit = await solo.client.sendRequest("textDocument/rename", {
        textDocument: { uri: solo.uriOf("consumer.hex") },
        // The first `Direction` on that line is the type in the annotation; the
        // second is inside `fromJsDirection`, which is the derived name.
        position: positionOf(consumer, "Direction"),
        newName: "Cardinality",
      }) as WorkspaceEdit;
      const changes = edit.changes!;
      expect(Object.keys(changes).sort()).toEqual(
        [solo.uriOf("bindings.hex"), solo.uriOf("consumer.hex")].sort(),
      );
      // `bindings.hex` was never opened; its declaration still moves, and the
      // generated names it declares have no text of their own to edit.
      expect(applyEdits(bindings, changes[solo.uriOf("bindings.hex")]!)).toBe(
        bindings.replaceAll("Direction", "Cardinality"),
      );
      const renamed = applyEdits(consumer, changes[solo.uriOf("consumer.hex")]!);
      expect(renamed).toContain("Option(Bindings.Cardinality)");
      expect(renamed).toContain("Bindings.fromJsCardinality(v)");
      // And the whole file, so nothing else moved and nothing was left behind.
      expect(renamed).toBe(consumer.replaceAll("Direction", "Cardinality"));
    } finally {
      await solo.dispose();
    }
  });

  /**
   * The **object-reading** form of `extern enum` (Foreign Enums §2.1, #779) over
   * the wire. The row lives inside an `extern from` block and is hoisted to a
   * module-level union by the parser, so what the editor asks about is a union
   * and a value — and the two foreign names beside them are not Hexagon seats
   * and answer nothing.
   */
  test("hover reads an object-reading `extern enum` as the union it is", async () => {
    const source = [
      "module Main",
      "",
      'extern from "keyboard"',
      "    enum Key as Direction = ARROW_UP as Up",
      "let start: Direction = Up",
      "",
    ].join("\n");
    const solo = await harness({ "main.hex": source });
    try {
      await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri: solo.uriOf("main.hex"),
          languageId: "hexagon",
          version: 1,
          text: source,
        },
      });
      const type = await solo.client.sendRequest("textDocument/hover", {
        textDocument: { uri: solo.uriOf("main.hex") },
        position: positionOf(source, "Direction", 2),
      }) as Hover | null;
      expect((type!.contents as { value: string }).value).toBe("union `Direction`");
      const member = await solo.client.sendRequest("textDocument/hover", {
        textDocument: { uri: solo.uriOf("main.hex") },
        position: positionOf(source, "Up", 2),
      }) as Hover | null;
      expect((member!.contents as { value: string }).value).toBe("value `Up: Direction`");
    } finally {
      await solo.dispose();
    }
  });

  /**
   * The other half of §5.2 over the wire: a generated name cannot be renamed on
   * its own, and the reason reaches the editor as a failed request rather than
   * as a silent `null`.
   */
  test("renaming a generated conversion is refused with the reason", async () => {
    const bindings = "module Bindings\n\n" +
      'export extern enum Direction = "up" as Up | "down" as Down\n';
    const consumer = [
      "module Consumer",
      "",
      "import Bindings",
      "",
      "export let read(v: JsValue): Option(Bindings.Direction) = Bindings.fromJsDirection(v)",
      "",
    ].join("\n");
    const solo = await harness({ "bindings.hex": bindings, "consumer.hex": consumer });
    try {
      await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri: solo.uriOf("consumer.hex"),
          languageId: "hexagon",
          version: 1,
          text: consumer,
        },
      });
      await expect(solo.client.sendRequest("textDocument/rename", {
        textDocument: { uri: solo.uriOf("consumer.hex") },
        position: positionOf(consumer, "fromJsDirection"),
        newName: "grab",
      })).rejects.toThrow(/generated from `extern enum Direction`/);
    } finally {
      await solo.dispose();
    }
  });

  test("a refused rename comes back as an error the editor can show", async () => {
    // The reason has to reach the user, and a failed request is the only channel
    // a rename has for saying one. `null` would read as "nothing to rename".
    await expect(hex.client.sendRequest("textDocument/rename", {
      textDocument: { uri: hex.uriOf("main.hex") },
      position: positionOf(MAIN, "brighten"),
      newName: "let",
    })).rejects.toThrow(/not a name Hexagon can read/);
  });

  test("diagnostics arrive for an edit, and are cleared when it is fixed", async () => {
    const uri = hex.uriOf("main.hex");
    const broken = `${MAIN}\nlet oops: Helper.Colour = Purple\n`;
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
    expect(reported[0]!.range.start.line).toBe(broken.split("\n").findIndex((line) => line.includes("Purple")));

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
    const solo = await harness({ "main.hex": "module Main\n\nlet broken: Int =\n" });
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
      "main.hex": "module Main\n\n" + "import Helper\nlet n: Int = Helper.absent\n",
      "helper.hex": "module Helper\n\n" + "export let present: Int = 1\n",
    });
    try {
      await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri: solo.uriOf("main.hex"),
          languageId: "hexagon",
          version: 1,
          text: "module Main\n\n" + "import Helper\nlet n: Int = Helper.absent\n",
        },
      });
      const reported = await solo.diagnosticsFor(solo.uriOf("main.hex"));
      expect(reported.map(({ message }) => message)).toEqual([
        "module `Helper` does not export `absent`",
      ]);
    } finally {
      await solo.dispose();
    }
  });

  test("the buffer wins over disk while a document is open", async () => {
    const solo = await harness({
      "helper.hex": "module Helper\n\n" + "export let two: Int = 2\n",
      "main.hex": "module Main\n\n" + "import Helper\n\nlet four: Int = Helper.two + Helper.two\n",
    });
    try {
      const helperUri = solo.uriOf("helper.hex");
      const mainUri = solo.uriOf("main.hex");
      await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri: mainUri,
          languageId: "hexagon",
          version: 1,
          text: "module Main\n\n" + "import Helper\n\nlet four: Int = Helper.two + Helper.two\n",
        },
      });
      await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri: helperUri,
          languageId: "hexagon",
          version: 1,
          text: "module Helper\n\n" + "export let two: Int = 2\n",
        },
      });
      // Deleting the export in the *buffer* must break the importer, even
      // though disk still has it. Unsaved edits are what the user sees.
      await solo.client.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri: helperUri, version: 2 },
        contentChanges: [{ text: "module Helper\n\n" + "export let three: Int = 3\n" }],
      });
      const reported = await solo.diagnosticsFor(mainUri);
      expect(reported.map(({ message }) => message)).toEqual([
        "module `Helper` does not export `two`",
        "module `Helper` does not export `two`",
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
      position: positionOf(MAIN, "brighten"),
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
      "main.hex": "module Main\n\nlet value: Int = 1\n",
      "hexagon.json": JSON.stringify({ exclude: ["generated"] }),
    });
    try {
      const mainUri = solo.uriOf("main.hex");
      await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri: mainUri,
          languageId: "hexagon",
          version: 1,
          text: "module Main\n\nlet value: Int = 1\n",
        },
      });
      await writeFile(join(solo.root, "generated.hex"), "module Generated\n\n" + "let oops: Int = \n");
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
      "main.hex": "module Main\n\nlet value: Int = 1\n",
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
    const solo = await harness({ "main.hex": "module Main\n\nlet value: Int = 1\n" });
    try {
      // Only a *root's* manifest is read. A vendored sub-project's has to be
      // skipped rather than fall through to the file handler, which would hand
      // JSON to the Hexagon parser and report its braces as syntax errors — in
      // a file the user never opened and cannot fix by editing Hexagon. It also
      // never triggers a reload, so the junk would sit there until some root
      // manifest happened to change.
      await mkdir(join(solo.root, "vendor"));
      const nested = join(solo.root, "vendor", "hexagon.json");
      await writeFile(nested, JSON.stringify({ exclude: [] }));
      const uri = pathToFileURL(nested).toString();
      await solo.client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri, type: 1 }],
      });

      // Something has to arrive before absence means anything, so this waits on
      // a real publication for another file and then checks the JSON got none.
      await writeFile(join(solo.root, "later.hex"), "module Later\n\n" + "let broken: Int = \n");
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
      "main.hex": "module Main\n\nlet value: Int = 1\n",
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

  /**
   * The same courtesy for the bounds §2.2 states, which are the ones a user
   * cannot see.
   *
   * An `exclude` entry is a line someone wrote and can go and read. These three
   * are facts about a directory somewhere above the file — a `node_modules`
   * nothing lists, a name this host never reads, a `hexagon.json` of some other
   * package's — and this PR sharpens the difference: a file inside a *listed*
   * dependency now gets full language support, and one inside its unlisted
   * neighbour gets silence, with nothing on screen to tell the two apart.
   *
   * One sentence per reason, because the way out differs: list the package,
   * open the folder, or rename the directory.
   */
  const open = async (
    solo: Harness,
    name: string,
    text: string,
  ): Promise<readonly Diagnostic[]> => {
    const uri = solo.uriOf(name);
    await solo.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId: "hexagon", version: 1, text },
    });
    return await solo.diagnosticsFor(uri);
  };

  test("a buffer under an unlisted package's `node_modules` says which entry is missing", async () => {
    const solo = await harness({
      "hexagon.json": JSON.stringify({ name: "App" }),
      "main.hex": "module Main\n\nlet value: Int = 1\n",
      "node_modules/loose/hexagon.json": JSON.stringify({ name: "Loose" }),
      "node_modules/loose/stray.hex": "module Stray\n\nlet n: Int = 1\n",
    });
    try {
      const reported = await open(solo, "node_modules/loose/stray.hex", "module Stray\n");
      expect(reported).toHaveLength(1);
      expect(reported[0]!.severity).toBe(3);
      // The package is named, and so is the manifest to write the entry in:
      // neither is guessable from the file, since a directory called
      // `acme-utils` may declare `Utils` and a reader with the dependency open
      // as a root of its own has two `hexagon.json` in front of them.
      expect(reported[0]!.message).toBe(
        "this file is in `Loose`, a package under `node_modules` this project does not list, " +
        "so it has no diagnostics, hover, or navigation; " +
        "add `Loose` to `dependencies` in `hexagon.json` to compile it",
      );

      // And it goes when the reason goes. The notice is only worth publishing
      // if it disappears the moment the user does what it asked.
      await writeFile(
        join(solo.root, "hexagon.json"),
        JSON.stringify({ name: "App", dependencies: ["Loose"] }),
      );
      await solo.client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri: solo.uriOf("hexagon.json"), type: 2 }],
      });
      const after = await solo.diagnosticsUntil(
        solo.uriOf("node_modules/loose/stray.hex"),
        (diagnostics) => !diagnostics.some(({ severity }) => severity === 3),
        "free of the not-a-dependency notice",
      );
      expect(after).toEqual([]);
    } finally {
      await solo.dispose();
    }
  });

  test("a buffer under a directory this host never reads names the directory", async () => {
    const solo = await harness({
      "hexagon.json": JSON.stringify({ name: "App" }),
      "main.hex": "module Main\n\nlet value: Int = 1\n",
      "dist/built.hex": "module Built\n\nlet n: Int = 1\n",
    });
    try {
      const reported = await open(solo, "dist/built.hex", "module Built\n");
      expect(reported).toHaveLength(1);
      expect(reported[0]!.severity).toBe(3);
      // Named, not merely alluded to: the reader has to be able to see that it
      // was their own `dist/`, and no `exclude` entry can argue with this one,
      // so the sentence offers no repair it cannot keep.
      expect(reported[0]!.message).toBe(
        "this file is under `dist`, which this language server never reads as project source, " +
        "so it has no diagnostics, hover, or navigation",
      );
    } finally {
      await solo.dispose();
    }
  });

  test("a buffer beneath a package vendored inside a dependency names that package", async () => {
    const solo = await harness({
      "hexagon.json": JSON.stringify({ name: "App", dependencies: ["Acme"] }),
      "main.hex": "module Main\n\nlet value: Int = 1\n",
      "node_modules/acme/hexagon.json": JSON.stringify({ name: "Acme" }),
      "node_modules/acme/lib.hex": "module Lib\n\nlet n: Int = 1\n",
      "node_modules/acme/vendor/hexagon.json": JSON.stringify({ name: "Vendored" }),
      "node_modules/acme/vendor/inside.hex": "module Inside\n\nlet n: Int = 1\n",
    });
    try {
      const reported = await open(
        solo,
        "node_modules/acme/vendor/inside.hex",
        "module Inside\n",
      );
      expect(reported).toHaveLength(1);
      expect(reported[0]!.severity).toBe(3);
      // Relative to the project the reader has open: a message carrying the
      // whole absolute prefix is a message they skip.
      expect(reported[0]!.message).toBe(
        "this file belongs to the package at `node_modules/acme/vendor/hexagon.json`, " +
        "which no open project reaches, so it has no diagnostics, hover, or navigation; " +
        "open its folder to work on it",
      );
    } finally {
      await solo.dispose();
    }
  });

  /**
   * And where no entry the reader could write would reach the file, the
   * sentence names the bound and promises nothing.
   *
   * Both of these used to draw the `dependencies` sentence, and following it
   * un-stranded neither: the manifest that could list `Extra` is `Acme`'s,
   * which sits under a `node_modules` and is not a file the reader edits, and a
   * tool's cache holds no package to name at all — the entry they were told to
   * write would draw a Packages §7 report of its own. One message with two
   * shapes, because "no package here" and "not this project's `node_modules`"
   * are the same fact about the reader's manifest.
   */
  test("a buffer under a `node_modules` no entry reaches is told so, and offered nothing", async () => {
    const solo = await harness({
      "hexagon.json": JSON.stringify({ name: "App", dependencies: ["Acme"] }),
      "main.hex": "module Main\n\nlet value: Int = 1\n",
      "node_modules/acme/hexagon.json": JSON.stringify({ name: "Acme" }),
      "node_modules/acme/lib.hex": "module Lib\n\nlet n: Int = 1\n",
      "node_modules/acme/node_modules/extra/hexagon.json": JSON.stringify({ name: "Extra" }),
      "node_modules/acme/node_modules/extra/extra.hex": "module Extra\n\nlet n: Int = 1\n",
      "node_modules/.cache/junk.hex": "module Junk\n\nlet n: Int = 1\n",
    });
    try {
      const nested = await open(
        solo,
        "node_modules/acme/node_modules/extra/extra.hex",
        "module Extra\n",
      );
      expect(nested).toHaveLength(1);
      expect(nested[0]!.severity).toBe(3);
      expect(nested[0]!.message).toBe(
        "this file is under the `node_modules` of `Acme`, which this project's " +
        "`hexagon.json` cannot reach, so it has no diagnostics, hover, or navigation",
      );

      const cached = await open(solo, "node_modules/.cache/junk.hex", "module Junk\n");
      expect(cached).toHaveLength(1);
      expect(cached[0]!.severity).toBe(3);
      expect(cached[0]!.message).toBe(
        "this file is under a `node_modules` directory and no package a project lists " +
        "holds it, so it has no diagnostics, hover, or navigation",
      );
    } finally {
      await solo.dispose();
    }
  });

  /**
   * And where the package is in the one place an entry reaches but declares no
   * name, the sentence says which manifest has none.
   *
   * The `dependencies` entry writes the name the package's own `hexagon.json`
   * declares (§4.1), and `name` is optional for a project nobody publishes
   * (§2.1) — so an `npm link`ed workspace package is a real, lawful shape with
   * nothing to list. Offering the entry here would have the reader write the
   * directory's name, get the same silence, and pick up a Packages §7 report on
   * a manifest that was fine before. Two shapes, because the reader's next step
   * differs: a manifest with no `name` needs one written, and a manifest that
   * would not parse may have a name in it already.
   */
  test("a buffer in a package with no name to list is told which manifest has none", async () => {
    const solo = await harness({
      "hexagon.json": JSON.stringify({ name: "App" }),
      "main.hex": "module Main\n\nlet value: Int = 1\n",
      "node_modules/nameless/hexagon.json": JSON.stringify({ dependencies: [] }),
      "node_modules/nameless/n.hex": "module N\n\nlet n: Int = 1\n",
      "node_modules/broken/hexagon.json": "{ not json",
      "node_modules/broken/b.hex": "module B\n\nlet n: Int = 1\n",
    });
    try {
      const nameless = await open(solo, "node_modules/nameless/n.hex", "module N\n");
      expect(nameless).toHaveLength(1);
      expect(nameless[0]!.severity).toBe(3);
      expect(nameless[0]!.message).toBe(
        "this file is under `node_modules` in a package whose " +
        "`node_modules/nameless/hexagon.json` declares no package name, " +
        "so it has no diagnostics, hover, or navigation, " +
        "and there is no name to add to `dependencies`",
      );

      const broken = await open(solo, "node_modules/broken/b.hex", "module B\n");
      expect(broken).toHaveLength(1);
      expect(broken[0]!.severity).toBe(3);
      expect(broken[0]!.message).toBe(
        "this file is under `node_modules` in a package whose " +
        "`node_modules/broken/hexagon.json` could not be read, " +
        "so it has no diagnostics, hover, or navigation, " +
        "and there is no name to add to `dependencies`",
      );

      // And the notice moves on when the manifest gains a name: the file is
      // then one `dependencies` entry away, and told so.
      await writeFile(
        join(solo.root, "node_modules", "nameless", "hexagon.json"),
        JSON.stringify({ name: "Nameless" }),
      );
      await solo.client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri: solo.uriOf("node_modules/nameless/hexagon.json"), type: 2 }],
      });
      const listed = await solo.diagnosticsUntil(
        solo.uriOf("node_modules/nameless/n.hex"),
        (diagnostics) => diagnostics.some(({ message }) => message.includes("`Nameless`")),
        "the sentence that names the entry to write",
      );
      expect(listed[0]!.message).toBe(
        "this file is in `Nameless`, a package under `node_modules` this project does not " +
        "list, so it has no diagnostics, hover, or navigation; " +
        "add `Nameless` to `dependencies` in `hexagon.json` to compile it",
      );
    } finally {
      await solo.dispose();
    }
  });

  test("un-excluding restores an open buffer without waiting for a keystroke", async () => {
    const solo = await harness({
      "main.hex": "module Main\n\nlet value: Int = 1\n",
      "hexagon.json": JSON.stringify({ exclude: ["vendor"] }),
    });
    try {
      await mkdir(join(solo.root, "vendor"));
      const vendored = join(solo.root, "vendor", "thing.hex");
      const text = "module Thing\n\n" + "export let vendored: Int = 7\n";
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
        position: { line: 2, character: 12 },
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
  const UNSIGNED = "module Main\n\n" + "export fun brighten(colour: Int) = colour + 1\n";

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
        .toBe("module Main\n\n" + "export fun brighten(colour: Int): Int = colour + 1\n");
    } finally {
      await solo.dispose();
    }
  });

  test("a refusal arrives greyed out, carrying its reason", async () => {
    // The result is an open record whose row comes from `r`, and `r` has no
    // type yet — so the type is not settled and nothing may be written. What
    // matters at this layer is that the user gets the sentence, not silence.
    const source = "module Main\n\n" + "export fun copy(r) = {...r}\n";
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
    const source = "module Main\n\n" + "export fun copy(r) = {...r}\n";
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
    "module Main",
    "",
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
    "module Point",
    "",
    "opaque record Point = {x: Float, y: Float}",
    "",
    "export let getX(p: Point): Float = p.x",
    "",
  ].join("\n");

  const RENDER = [
    "module Render",
    "",
    "export constraint Render<a> =",
    "    render(value: a) -> String",
    "",
  ].join("\n");

  const CONSUMER = [
    "module Main",
    "",
    "import Point",
    'import Render',
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
      start: { line: 2, character: 14 },
      end: { line: 2, character: 19 },
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
      start: { line: 2, character: 18 },
      end: { line: 2, character: 24 },
    });
  });
});

/**
 * Packages, across the protocol: a project that has a dependency, a manifest
 * that is a program of its own, and the one repair whose edit is a file the
 * compiler does not hold.
 */
describe("packages and programs", () => {
  const manifest = (fields: Readonly<Record<string, unknown>>): string =>
    `${JSON.stringify(fields, undefined, 2)}\n`;

  /** Opens a file in the editor, which is what a code-action request needs. */
  async function open(
    workspace: Harness,
    name: string,
    text: string,
    languageId = "hexagon",
    version = 1,
  ): Promise<void> {
    await workspace.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: workspace.uriOf(name), languageId, version, text },
    });
  }

  /**
   * The edits one repair carries for a manifest, under either shape a client
   * can take: `documentChanges` where it announced support (which is what
   * carries the version an edit was measured against), `changes` where it did
   * not.
   */
  function manifestEditsOf(action: CodeAction, uri: string): readonly TextEdit[] {
    const changes = action.edit?.documentChanges;
    if (changes === undefined) return action.edit!.changes![uri]!;
    const seated = changes.find((change) =>
      "textDocument" in change && change.textDocument.uri === uri
    );
    return (seated as { edits: TextEdit[] }).edits;
  }

  /** The version a repair's edit was measured against, where it carries one. */
  function manifestVersionOf(action: CodeAction, uri: string): number | null | undefined {
    const seated = action.edit?.documentChanges?.find((change) =>
      "textDocument" in change && change.textDocument.uri === uri
    );
    if (seated === undefined) return undefined;
    return (seated as { textDocument: { version: number | null } }).textDocument.version;
  }

  /** The quick fix that writes the manifest, for a report on `main.hex`. */
  async function repairFor(workspace: Harness, name: string): Promise<CodeAction | undefined> {
    const reported = await workspace.diagnosticsFor(workspace.uriOf(name));
    const actions = await workspace.client.sendRequest("textDocument/codeAction", {
      textDocument: { uri: workspace.uriOf(name) },
      range: reported[0]!.range,
      context: { diagnostics: reported },
    }) as CodeAction[] | null;
    return actions?.find(({ title }) => title.includes("dependencies"));
  }

  const MAIN_WITH_DEPENDENCY = [
    "module Main",
    "",
    "import Acme.Geometry",
    "",
    "let width: Int = Geometry.width",
    "",
  ].join("\n");

  test("a dependency's modules are in the program, under its package name", async () => {
    const workspace = await harness({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": MAIN_WITH_DEPENDENCY,
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/geometry.hex": "module Geometry\n\nexport let width: Int = 3\n",
    });
    try {
      await open(workspace, "main.hex", MAIN_WITH_DEPENDENCY);
      await open(
        workspace,
        "node_modules/acme/geometry.hex",
        "module Geometry\n\nexport let width: Int = 3\n",
      );
      // The dependency's module resolved: `Geometry.width` is an `Int`, which
      // only a program holding `Acme`'s source can say.
      const hover = await workspace.client.sendRequest("textDocument/hover", {
        textDocument: { uri: workspace.uriOf("main.hex") },
        position: positionOf(MAIN_WITH_DEPENDENCY, "width", 2),
      }) as Hover | null;
      expect((hover?.contents as { value: string }).value).toContain("Int");
      // And the dependency's own file is in the program, answering about itself.
      const inside = await workspace.client.sendRequest("textDocument/hover", {
        textDocument: { uri: workspace.uriOf("node_modules/acme/geometry.hex") },
        position: { line: 2, character: 11 },
      }) as Hover | null;
      expect(inside).not.toBeNull();
      // Nothing was published, because nothing is wrong.
      expect(workspace.publishedFor(workspace.uriOf("main.hex")) ?? []).toEqual([]);
    } finally {
      await workspace.dispose();
    }
  });

  test("an installed package the project does not list draws the manifest repair", async () => {
    const workspace = await harness({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n\nimport Bolt.Util\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/geometry.hex": "module Geometry\n\nexport let width: Int = 3\n",
      "node_modules/bolt/hexagon.json": manifest({ name: "Bolt" }),
      "node_modules/bolt/util.hex": "module Util\n\nexport let n: Int = 1\n",
    }, {
      textDocument: {
        codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } } },
      },
      workspace: { workspaceEdit: { documentChanges: true } },
    });
    try {
      await open(workspace, "main.hex", "module Main\n\nimport Bolt.Util\n");
      const reported = await workspace.diagnosticsFor(workspace.uriOf("main.hex"));
      expect(reported.map(({ message }) => message)).toEqual([
        "`Bolt` is not a dependency of this package; add `\"Bolt\"` to `dependencies` " +
          "in `hexagon.json`",
      ]);
      const actions = await workspace.client.sendRequest("textDocument/codeAction", {
        textDocument: { uri: workspace.uriOf("main.hex") },
        range: reported[0]!.range,
        context: { diagnostics: reported },
      }) as CodeAction[] | null;
      const repair = actions?.find(({ title }) => title.includes("dependencies"));
      expect(repair?.title).toBe("add `\"Bolt\"` to `dependencies` in hexagon.json");
      const edits = manifestEditsOf(repair!, workspace.uriOf("hexagon.json"));
      expect(applyEdits(manifest({ dependencies: ["Acme"] }), edits)).toBe(
        manifest({ dependencies: ["Acme", "Bolt"] }),
      );
      // The `dependencies` **value** and nothing else: an edit over the whole
      // file would take an unrelated change with it, and the smallest edit that
      // says what the repair says is the array it is adding to.
      expect(edits).toHaveLength(1);
      expect(edits[0]!.range.start.line).toBe(1);
    } finally {
      await workspace.dispose();
    }
  });

  /**
   * The repair's edit is measured against the **buffer**, not against the last
   * text saved to disk.
   *
   * A manifest is re-read on the watcher's event, which fires on save — so with
   * `hexagon.json` open and edited, the server's copy is stale by exactly the
   * user's unsaved work. An edit ranged over the stale text lands in the live
   * document: where the buffer is **longer**, the range stops short and the
   * tail survives the replacement, which for a JSON file means a repair that
   * produces something that is not JSON.
   */
  const NOT_A_DEPENDENCY = {
    "main.hex": "module Main\n\nimport Bolt.Util\n",
    "node_modules/bolt/hexagon.json": '{\n  "name": "Bolt"\n}\n',
    "node_modules/bolt/util.hex": "module Util\n\nexport let n: Int = 1\n",
  } as const;

  const REPAIR_CAPABILITIES = {
    textDocument: {
      codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } } },
    },
    workspace: { workspaceEdit: { documentChanges: true } },
  };

  test("the repair edits the buffer the user is looking at, not the saved text", async () => {
    const workspace = await harness({
      ...NOT_A_DEPENDENCY,
      "hexagon.json": "{}\n",
    }, REPAIR_CAPABILITIES);
    try {
      // Longer than what was saved — the direction that used to leave a tail
      // behind and produce invalid JSON.
      const buffer = '{\n  "name": "App",\n  "dependencies": []\n}\n';
      await open(workspace, "main.hex", NOT_A_DEPENDENCY["main.hex"]);
      await open(workspace, "hexagon.json", buffer, "json", 7);
      const repair = await repairFor(workspace, "main.hex");
      const uri = workspace.uriOf("hexagon.json");
      expect(applyEdits(buffer, manifestEditsOf(repair!, uri)))
        .toBe('{\n  "name": "App",\n  "dependencies": [\n    "Bolt"\n  ]\n}\n');
      // Versioned, so a client whose document has moved on refuses the edit
      // rather than applying it to text it was never measured against.
      expect(manifestVersionOf(repair!, uri)).toBe(7);
    } finally {
      await workspace.dispose();
    }
  });

  test("the repair edits a buffer shorter than the saved text", async () => {
    const workspace = await harness({
      ...NOT_A_DEPENDENCY,
      "hexagon.json": '{\n  "name": "App",\n  "exclude": [\n    "generated"\n  ]\n}\n',
    }, REPAIR_CAPABILITIES);
    try {
      const buffer = '{\n  "name": "App"\n}\n';
      await open(workspace, "main.hex", NOT_A_DEPENDENCY["main.hex"]);
      await open(workspace, "hexagon.json", buffer, "json", 3);
      const repair = await repairFor(workspace, "main.hex");
      // No key to scope to, so the whole document is rewritten — and from the
      // buffer's value, which is what makes `exclude` (saved, then deleted)
      // absent rather than resurrected.
      expect(applyEdits(buffer, manifestEditsOf(repair!, workspace.uriOf("hexagon.json"))))
        .toBe('{\n  "name": "App",\n  "dependencies": [\n    "Bolt"\n  ]\n}\n');
    } finally {
      await workspace.dispose();
    }
  });

  test("with no buffer open the repair reads the manifest from disk", async () => {
    const workspace = await harness({
      ...NOT_A_DEPENDENCY,
      "hexagon.json": '{\n  "name": "App",\n  "dependencies": [\n    "Acme"\n  ]\n}\n',
    }, REPAIR_CAPABILITIES);
    try {
      await open(workspace, "main.hex", NOT_A_DEPENDENCY["main.hex"]);
      const repair = await repairFor(workspace, "main.hex");
      const uri = workspace.uriOf("hexagon.json");
      expect(applyEdits(
        '{\n  "name": "App",\n  "dependencies": [\n    "Acme"\n  ]\n}\n',
        manifestEditsOf(repair!, uri),
      )).toBe('{\n  "name": "App",\n  "dependencies": [\n    "Acme",\n    "Bolt"\n  ]\n}\n');
      // No document to version against; the client applies it to the file.
      expect(manifestVersionOf(repair!, uri)).toBeNull();
    } finally {
      await workspace.dispose();
    }
  });

  /**
   * A byte-order mark is stripped to parse and never to write. VS Code writes
   * one under `files.encoding: utf8bom`, and a repair that dropped it would
   * silently re-encode a file the user did not ask to re-encode — a whole-file
   * diff, from a one-entry fix.
   */
  test("the repair keeps a manifest's byte-order mark", async () => {
    const workspace = await harness({
      ...NOT_A_DEPENDENCY,
      "hexagon.json": `\uFEFF{}\n`,
    }, REPAIR_CAPABILITIES);
    try {
      await open(workspace, "main.hex", NOT_A_DEPENDENCY["main.hex"]);
      const repair = await repairFor(workspace, "main.hex");
      const written = applyEdits(
        `\uFEFF{}\n`,
        manifestEditsOf(repair!, workspace.uriOf("hexagon.json")),
      );
      expect(written).toBe(`\uFEFF{\n  "dependencies": [\n    "Bolt"\n  ]\n}\n`);
    } finally {
      await workspace.dispose();
    }
  });

  /**
   * JSON permits a key twice and `JSON.parse` keeps the **later** one, so the
   * entries this edit was built from are the later array's. Scoping the edit to
   * the earlier one writes valid JSON whose effective `dependencies` is
   * unchanged: the user clicks the fix, the report stays, and nothing says why.
   */
  test("the repair edits the `dependencies` the manifest actually parses to", async () => {
    const duplicated = '{\n  "dependencies": [\n    "A"\n  ],\n  "dependencies": [\n    "B"\n  ]\n}\n';
    const workspace = await harness({
      ...NOT_A_DEPENDENCY,
      "hexagon.json": duplicated,
    }, REPAIR_CAPABILITIES);
    try {
      await open(workspace, "main.hex", NOT_A_DEPENDENCY["main.hex"]);
      const repair = await repairFor(workspace, "main.hex");
      const written = applyEdits(
        duplicated,
        manifestEditsOf(repair!, workspace.uriOf("hexagon.json")),
      );
      expect(JSON.parse(written)["dependencies"]).toEqual(["B", "Bolt"]);
      expect(written).toBe(
        '{\n  "dependencies": [\n    "A"\n  ],\n  "dependencies": [\n    "B",\n    "Bolt"\n  ]\n}\n',
      );
    } finally {
      await workspace.dispose();
    }
  });

  /**
   * `JSON.stringify` always breaks lines with `\n`. A manifest saved on Windows
   * is `\r\n` throughout, and writing the one into the other leaves a file with
   * mixed endings — valid JSON, and a whole-file diff the next time the user's
   * editor normalizes it, out of a one-entry fix.
   */
  test("the repair keeps a manifest's line ending", async () => {
    const crlf = '{\r\n  "dependencies": []\r\n}\r\n';
    const workspace = await harness({
      ...NOT_A_DEPENDENCY,
      "hexagon.json": crlf,
    }, REPAIR_CAPABILITIES);
    try {
      await open(workspace, "main.hex", NOT_A_DEPENDENCY["main.hex"]);
      const repair = await repairFor(workspace, "main.hex");
      const written = applyEdits(crlf, manifestEditsOf(repair!, workspace.uriOf("hexagon.json")));
      expect(written).toBe('{\r\n  "dependencies": [\r\n    "Bolt"\r\n  ]\r\n}\r\n');
      expect(written.includes("\n") && !written.includes("\r\n")).toBe(false);
    } finally {
      await workspace.dispose();
    }
  });

  /** The same, for the branch that rewrites the whole document. */
  test("the whole-document rewrite keeps a manifest's line ending", async () => {
    const crlf = '{\r\n  "name": "App"\r\n}\r\n';
    const workspace = await harness({
      ...NOT_A_DEPENDENCY,
      "hexagon.json": crlf,
    }, REPAIR_CAPABILITIES);
    try {
      await open(workspace, "main.hex", NOT_A_DEPENDENCY["main.hex"]);
      const repair = await repairFor(workspace, "main.hex");
      const written = applyEdits(crlf, manifestEditsOf(repair!, workspace.uriOf("hexagon.json")));
      expect(written).toBe(
        '{\r\n  "name": "App",\r\n  "dependencies": [\r\n    "Bolt"\r\n  ]\r\n}\r\n',
      );
    } finally {
      await workspace.dispose();
    }
  });

  test("the repair is never offered inside a dependency's own source", async () => {
    const workspace = await harness({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/geometry.hex": "module Geometry\n\nimport Bolt.Util\n",
      "node_modules/bolt/hexagon.json": manifest({ name: "Bolt" }),
      "node_modules/bolt/util.hex": "module Util\n\nexport let n: Int = 1\n",
    }, {
      textDocument: {
        codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } } },
      },
      workspace: { workspaceEdit: { documentChanges: true } },
    });
    try {
      const uri = workspace.uriOf("node_modules/acme/geometry.hex");
      await open(workspace, "node_modules/acme/geometry.hex", "module Geometry\n\nimport Bolt.Util\n");
      const reported = await workspace.diagnosticsFor(uri);
      // The report is published against the dependency's own file (D3).
      expect(reported.map(({ message }) => message)).toEqual([
        "`Bolt` is not a dependency of this package; add `\"Bolt\"` to `dependencies` " +
          "in `hexagon.json`",
      ]);
      const actions = await workspace.client.sendRequest("textDocument/codeAction", {
        textDocument: { uri },
        range: reported[0]!.range,
        context: { diagnostics: reported },
      }) as CodeAction[] | null;
      // `Acme`'s manifest sits under `node_modules`: not a file the user wrote,
      // and not one an editor should offer to write.
      expect(actions?.some(({ title }) => title.includes("dependencies")) ?? false).toBe(false);
    } finally {
      await workspace.dispose();
    }
  });

  test("a manifest's own problems are published against the manifest that carries them", async () => {
    const workspace = await harness({
      "hexagon.json": manifest({ dependencies: ["Bolt"] }),
      "main.hex": "module Main\n",
      "node_modules/bolt/hexagon.json": manifest({ name: "Bolt", dependencies: ["Missing"] }),
      "node_modules/bolt/util.hex": "module Util\n\nexport let n: Int = 1\n",
    });
    try {
      const reported = await workspace.diagnosticsFor(
        workspace.uriOf("node_modules/bolt/hexagon.json"),
      );
      expect(reported.map(({ message }) => message)).toEqual([
        "no installed package declares `\"name\": \"Missing\"`; install it, or check " +
          "the name in its `hexagon.json`",
      ]);
    } finally {
      await workspace.dispose();
    }
  });

  test("a nested manifest is a program of its own, invisible to the enclosing one", async () => {
    const workspace = await harness({
      "hexagon.json": manifest({}),
      "main.hex": "module Main\n\nimport Thing\n",
      "vendor/hexagon.json": manifest({ name: "Vendor" }),
      "vendor/thing.hex": "module Thing\n\nexport let n: Int = 1\n",
    });
    try {
      // `Thing` belongs to the nested package, which the project does not list
      // and cannot see: two open folders meet only through a dependency (D1).
      const reported = await workspace.diagnosticsFor(workspace.uriOf("main.hex"));
      expect(reported.map(({ message }) => message)).toEqual(["no module `Thing`"]);
      // And the nested program compiles its own file, cleanly — nothing was
      // published against it, and it answers about itself.
      expect(workspace.publishedFor(workspace.uriOf("vendor/thing.hex")) ?? []).toEqual([]);
      await open(workspace, "vendor/thing.hex", "module Thing\n\nexport let n: Int = 1\n");
      const hover = await workspace.client.sendRequest("textDocument/hover", {
        textDocument: { uri: workspace.uriOf("vendor/thing.hex") },
        position: { line: 2, character: 11 },
      }) as Hover | null;
      expect(hover).not.toBeNull();
    } finally {
      await workspace.dispose();
    }
  });

  /**
   * D3's related information for the report that names a package the reader
   * cannot see: the offending package has no source they can act on, and its
   * `hexagon.json` is the one text of it they can. The compiler marks the seat;
   * the label only reaches the editor if a host seats the manifest as a file.
   */
  test("the whole-program first-segment report points at the other package's manifest", async () => {
    const workspace = await harness({
      "hexagon.json": manifest({ dependencies: ["Bolt", "Acme"] }),
      "main.hex": "module Main\n\nexport let n: Int = 1\n",
      "node_modules/bolt/hexagon.json": manifest({ name: "Bolt" }),
      "node_modules/bolt/tools.hex": "module Acme.Tools\n\nexport let n: Int = 1\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/geometry.hex": "module Geometry\n\nexport let width: Int = 3\n",
    });
    try {
      const uri = workspace.uriOf("node_modules/bolt/tools.hex");
      const reported = await workspace.diagnosticsUntil(
        uri,
        (diagnostics) => diagnostics.length > 0,
        "the whole-program first-segment report",
      );
      expect(reported[0]!.message).toBe(
        "module `Acme.Tools` of package `Bolt` begins with the name of the package " +
          "`Acme`, also in this program; drop the dependency that brings `Acme` or " +
          "the one that brings `Bolt`, or combine them once `Acme` is renamed or " +
          "`Bolt` renames its module",
      );
      expect(reported[0]!.relatedInformation).toEqual([{
        location: {
          uri: workspace.uriOf("node_modules/acme/hexagon.json"),
          // The `"name"` line of `Acme`'s own manifest — the value a reader
          // would change, found by the key that names it.
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 16 } },
        },
        message: "`Acme` is declared here",
      }]);
    } finally {
      await workspace.dispose();
    }
  });

  /**
   * The same label, in a program that compiles an **injected** module.
   *
   * A manifest's identity is minted by `AnalysisSession.referenceFile`, and the
   * members of `Hex` a program reaches are minted by `compileProject` — two
   * allocators, which must not hand out one number twice. They did: the first
   * woven member landed on exactly the last manifest's id, `pathOfFile`
   * preferred the analysis, and the editor was handed a related-information
   * link to a `/Hex/Show.hex` that is nowhere on disk. Any generic over a
   * prelude constraint fires it, which is why the fixture above — whose
   * `main.hex` compiles no injected module — cannot see it.
   */
  test("the manifest keeps its identity in a program that compiles `Hex` members", async () => {
    const workspace = await harness({
      "hexagon.json": manifest({ dependencies: ["Bolt", "Acme"] }),
      "main.hex": "module Main\n\nexport fun f<a: Show>(x: a): String = show(x)\n",
      "node_modules/bolt/hexagon.json": manifest({ name: "Bolt" }),
      "node_modules/bolt/tools.hex": "module Acme.Tools\n\nexport let n: Int = 1\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/geometry.hex": "module Geometry\n\nexport let width: Int = 3\n",
    });
    try {
      const reported = await workspace.diagnosticsUntil(
        workspace.uriOf("node_modules/bolt/tools.hex"),
        (diagnostics) => diagnostics.length > 0,
        "the whole-program first-segment report",
      );
      expect(reported[0]!.relatedInformation?.[0]!.location.uri)
        .toBe(workspace.uriOf("node_modules/acme/hexagon.json"));
    } finally {
      await workspace.dispose();
    }
  });

  /**
   * The window a vendored `.hex` file has before the manifest beside it
   * arrives, and that it closes — **with the file open in a buffer**, which is
   * the rediscovery sweep's decision rather than the walk's.
   *
   * A package vendored inside a dependency is unpacked file by file, so between
   * one watcher event and the next its sources really are the dependency's and
   * its modules really do resolve. The manifest watcher is what ends that: the
   * boundary arrives, discovery re-runs, and `Acme` stops at `vendor`. The
   * sweep used to put an open buffer back where the *previous* program had it,
   * so the file kept its seat inside `Acme` and the window never closed at all
   * for anyone who had the file open.
   */
  test("a manifest arriving beside an open buffer ends the package there", async () => {
    const workspace = await harness({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n\nimport Acme.Sneak\n\nlet value: Int = Sneak.made\n",
      "node_modules/acme/hexagon.json": manifest({ name: "Acme" }),
      "node_modules/acme/lib.hex": "module Lib\n\nexport let one: Int = 1\n",
    });
    try {
      const uri = workspace.uriOf("main.hex");
      expect(
        (await workspace.diagnosticsUntil(
          uri,
          (diagnostics) => diagnostics.length > 0,
          "the import of a module nothing supplies to be refused",
        )).map(({ message }) => message),
      ).toContain("no module `Acme.Sneak`");

      const sneak = join(workspace.root, "node_modules/acme/vendor/sneak.hex");
      const text = "module Sneak\n\nexport let made: Int = 9\n";
      await mkdir(dirname(sneak), { recursive: true });
      await writeFile(sneak, text, "utf8");
      await workspace.client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri: pathToFileURL(sneak).toString(), type: 1 }],
      });
      // Correct while it lasts: no boundary exists yet, so `vendor` is `Acme`'s
      // own directory and the module in it is `Acme.Sneak`.
      expect(
        await workspace.diagnosticsUntil(
          uri,
          (diagnostics) => diagnostics.length === 0,
          "the vendored file to join the package around it",
        ),
      ).toEqual([]);

      await open(workspace, "node_modules/acme/vendor/sneak.hex", text);
      const boundary = join(workspace.root, "node_modules/acme/vendor/hexagon.json");
      await writeFile(boundary, manifest({ name: "Vendored" }), "utf8");
      await workspace.client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri: pathToFileURL(boundary).toString(), type: 1 }],
      });
      expect(
        (await workspace.diagnosticsUntil(
          uri,
          (diagnostics) => diagnostics.length > 0,
          "the boundary to take the vendored module back out of `Acme`",
        )).map(({ message }) => message),
      ).toContain("no module `Acme.Sneak`");
    } finally {
      await workspace.dispose();
    }
  });

  test("a `hexagon.json` written under `node_modules` re-runs discovery", async () => {
    const workspace = await harness({
      "hexagon.json": manifest({ dependencies: ["Acme"] }),
      "main.hex": "module Main\n\nimport Acme.Geometry\n",
      "node_modules/acme/geometry.hex": "module Geometry\n\nexport let width: Int = 3\n",
    });
    try {
      const uri = workspace.uriOf("main.hex");
      // No manifest at the package yet: it is a JavaScript package, read for
      // nothing, and the name resolves to nothing.
      expect((await workspace.diagnosticsFor(uri)).length).toBeGreaterThan(0);
      const installed = join(workspace.root, "node_modules/acme/hexagon.json");
      await writeFile(installed, manifest({ name: "Acme" }), "utf8");
      await workspace.client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri: pathToFileURL(installed).toString(), type: 1 }],
      });
      expect(
        await workspace.diagnosticsUntil(
          uri,
          (diagnostics) => diagnostics.length === 0,
          "the installed package to be found",
        ),
      ).toEqual([]);
    } finally {
      await workspace.dispose();
    }
  });
});
