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
