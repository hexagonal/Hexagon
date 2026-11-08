import { afterEach, describe, expect, test, vi } from "vitest";

import { createLanguageServices, type ServiceChannel } from "./language-services";
import type { CompilerMessage, CompilerRequest } from "./protocol";

interface Harness {
  readonly channel: ServiceChannel;
  readonly sent: CompilerRequest[];
  reply(message: CompilerMessage): void;
  fail(): void;
}

function harness(): Harness {
  const sent: CompilerRequest[] = [];
  const listeners: ((message: CompilerMessage) => void)[] = [];
  const failures: (() => void)[] = [];
  return {
    sent,
    channel: {
      post: (request) => void sent.push(request),
      listen: (receive) => void listeners.push(receive),
      onFailure: (notify) => void failures.push(notify),
    },
    reply: (message) => {
      for (const listener of listeners) listener(message);
    },
    fail: () => {
      for (const notify of failures) notify();
    },
  };
}

describe("createLanguageServices", () => {
  afterEach(() => void vi.restoreAllMocks());

  test("carries the current version and the text the answer is about", async () => {
    const { channel, sent, reply } = harness();
    const services = createLanguageServices(channel, () => 7);

    const answer = services.hover("let one = 1\n", 4);
    expect(sent).toMatchObject([
      { kind: "hover", version: 7, source: "let one = 1\n", offset: 4 },
    ]);
    reply({
      kind: "hover",
      id: 0,
      version: 7,
      hover: { markdown: "value `one: Int`", range: { startOffset: 4, endOffset: 7 } },
    });

    expect(await answer).toMatchObject({ markdown: "value `one: Int`" });
  });

  test("asks where the hover answers without naming a position", async () => {
    // The one request with no offset in it: the caller needs the answer before
    // the caret is anywhere in particular. See `HoverSpansRequest`.
    const { channel, sent, reply } = harness();
    const services = createLanguageServices(channel, () => 7);

    const answer = services.hoverSpans("let one = 1\n");
    expect(sent).toMatchObject([{ kind: "hover-spans", version: 7, source: "let one = 1\n" }]);
    reply({
      kind: "hover-spans",
      id: 0,
      version: 7,
      ranges: [{ startOffset: 4, endOffset: 7 }],
    });

    expect(await answer).toEqual([{ startOffset: 4, endOffset: 7 }]);
  });

  test("says it has no answer about spans, rather than answering empty", async () => {
    // The one service that must not use the empty answer for a dropped reply.
    // Its caller caches what it gets against the text it describes, so `[]`
    // here would be remembered as "the hover answers nowhere in this document"
    // and the caret hover would go quiet until the next edit. See
    // `createHoverSpanCache`.
    const { channel, reply } = harness();
    let version = 3;
    const services = createLanguageServices(channel, () => version);

    const answer = services.hoverSpans("let one = 1\n");
    version = 4;
    reply({ kind: "hover-spans", id: 0, version: 3, ranges: [{ startOffset: 4, endOffset: 7 }] });

    expect(await answer).toBeUndefined();
  });

  test("drops a reply about text the user has since changed", async () => {
    const { channel, sent, reply } = harness();
    let version = 3;
    const services = createLanguageServices(channel, () => version);

    const answer = services.codeActions("let one = 1\n", {
      startOffset: 0,
      endOffset: 0,
    });
    version = 4;
    reply({
      kind: "code-actions",
      id: 0,
      version: 3,
      actions: [{ title: "Infer return type", kind: "quickfix", edits: [] }],
    });

    // Settled, and settled empty: a promise left hanging leaves Monaco showing
    // a spinner over the source for the rest of the session.
    expect(await answer).toEqual([]);
  });

  test("asks for completions at the caret and hands back the session's list", async () => {
    const { channel, sent, reply } = harness();
    const services = createLanguageServices(channel, () => 5);
    const source = "module Main\n\nlet v = Vector.le";

    const answer = services.completions(source, source.length);
    expect(sent).toMatchObject([
      { kind: "completion", version: 5, source, offset: source.length },
    ]);
    const completions = {
      items: [{ name: "length", kind: "function", detail: "Vector(a) -> Int" }],
      range: { startOffset: source.length - 2, endOffset: source.length },
    };
    reply({ kind: "completion", id: 0, version: 5, completions });

    expect(await answer).toEqual(completions);
  });

  test("drops a completion list about text the user has since changed", async () => {
    const { channel, reply } = harness();
    let version = 3;
    const services = createLanguageServices(channel, () => version);

    const answer = services.completions("module Main\n\nlet v = Vector.", 27);
    version = 4;
    reply({
      kind: "completion",
      id: 0,
      version: 3,
      completions: {
        items: [{ name: "length", kind: "function" }],
        range: { startOffset: 27, endOffset: 27 },
      },
    });

    // Settled, not left hanging, and with nothing: its range describes text
    // that is no longer on screen.
    expect(await answer).toBeUndefined();
  });

  test("settles a completion request the worker could not answer", async () => {
    const { channel, reply } = harness();
    const services = createLanguageServices(channel, () => 1);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const answer = services.completions("let one = 1\n", 4);
    reply({ kind: "service-failure", id: 0, version: 1, message: "boom" });

    expect(await answer).toBeUndefined();
  });

  test("asks for signature help at the caret and hands back the session's answer", async () => {
    const { channel, sent, reply } = harness();
    const services = createLanguageServices(channel, () => 2);
    const source = "module Main\n\nlet sum = add(1, ";

    const answer = services.signatureHelp(source, source.length);
    expect(sent).toMatchObject([
      { kind: "signature-help", version: 2, source, offset: source.length },
    ]);
    const help = {
      label: "add: (Int, Int) -> Int",
      parameters: [{ range: [6, 9] as const }, { range: [11, 14] as const }],
      activeParameter: 1,
    };
    reply({ kind: "signature-help", id: 0, version: 2, help });

    expect(await answer).toEqual(help);
  });

  test("asks for the inlay hints in a range and hands back the session's; none for a dropped reply", async () => {
    const { channel, sent, reply } = harness();
    let version = 5;
    const services = createLanguageServices(channel, () => version);
    const source = "module Main\n\nlet double(n) = n * 2\n";

    const answer = services.inlayHints(source, { startOffset: 13, endOffset: 35 });
    expect(sent).toMatchObject([
      { kind: "inlay-hints", version: 5, source, startOffset: 13, endOffset: 35 },
    ]);
    const hints = [{ offset: 25, label: ": Int", kind: "type" as const, tooltip: "`double: Int -> Int`" }];
    reply({ kind: "inlay-hints", id: 0, version: 5, hints });
    expect(await answer).toEqual(hints);

    const stale = services.inlayHints(source, { startOffset: 13, endOffset: 35 });
    version = 6;
    reply({ kind: "inlay-hints", id: 1, version: 5, hints });
    expect(await stale).toEqual([]);
  });

  test("asks for a hover over a selection with its end, and for selection ranges", async () => {
    const { channel, sent, reply } = harness();
    const services = createLanguageServices(channel, () => 3);
    const source = "module Main\n\nlet n = 1 + 2\n";

    const hover = services.hover(source, 21, 26);
    const ranges = services.selectionRanges(source, [23]);
    expect(sent).toMatchObject([
      { kind: "hover", version: 3, source, offset: 21, end: 26 },
      { kind: "selection-ranges", version: 3, source, offsets: [23] },
    ]);
    const shown = { markdown: "`Int`", range: { startOffset: 21, endOffset: 26 } };
    const grown = [[{ startOffset: 21, endOffset: 26 }, { startOffset: 13, endOffset: 26 }]];
    reply({ kind: "hover", id: 0, version: 3, hover: shown });
    reply({ kind: "selection-ranges", id: 1, version: 3, ranges: grown });

    expect(await hover).toEqual(shown);
    expect(await ranges).toEqual(grown);
  });

  test("a hover at a position sends no end", async () => {
    const { channel, sent } = harness();
    const services = createLanguageServices(channel, () => 1);
    void services.hover("let one = 1\n", 4);
    expect(sent[0]).not.toHaveProperty("end");
  });

  test("settles a selection-range request the worker could not answer with none", async () => {
    const { channel, reply } = harness();
    const services = createLanguageServices(channel, () => 1);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const answer = services.selectionRanges("let one = 1\n", [4]);
    reply({ kind: "service-failure", id: 0, version: 1, message: "boom" });

    expect(await answer).toEqual([]);
  });

  test("matches replies to requests by id, whatever order they arrive in", async () => {
    const { channel, reply } = harness();
    const services = createLanguageServices(channel, () => 1);

    const first = services.definitions("let one = 1\n", 4);
    const second = services.references("let one = 1\n", 4);
    reply({ kind: "references", id: 1, version: 1, ranges: [{ startOffset: 4, endOffset: 7 }] });
    reply({ kind: "definition", id: 0, version: 1, ranges: [] });

    expect(await second).toEqual([{ startOffset: 4, endOffset: 7 }]);
    expect(await first).toEqual([]);
  });

  test("says so when the worker could not answer a request at all", async () => {
    const { channel, reply } = harness();
    const services = createLanguageServices(channel, () => 1);
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});

    const answer = services.codeActions("let one = 1\n", {
      startOffset: 0,
      endOffset: 0,
    });
    reply({ kind: "service-failure", id: 0, version: 1, message: "boom" });

    // The empty answer is the same one a stale reply produces, so the report is
    // the entire difference between the two: a service that has started
    // throwing looks exactly like a service with nothing to say.
    expect(await answer).toEqual([]);
    expect(reported).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });

  test("settles everything outstanding when the worker itself fails", async () => {
    const { channel, fail } = harness();
    const services = createLanguageServices(channel, () => 1);

    const hover = services.hover("let one = 1\n", 4);
    const rename = services.rename("let one = 1\n", 4, "two");
    fail();

    expect(await hover).toBeUndefined();
    expect(await rename).toBeUndefined();
  });

  test("settles a request made after the worker failed, and posts nothing", async () => {
    const { channel, sent, fail } = harness();
    const services = createLanguageServices(channel, () => 1);

    // A worker whose module fails to evaluate dies before anything is
    // outstanding, so draining what is pending drains nothing: it is every
    // later request that would otherwise hang.
    fail();

    expect(await services.hover("let one = 1\n", 4)).toBeUndefined();
    expect(await services.definitions("let one = 1\n", 4)).toEqual([]);
    expect(sent).toEqual([]);
  });
});
