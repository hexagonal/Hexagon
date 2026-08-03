/**
 * The editor's side of the compiler worker.
 *
 * Monaco asks its providers questions about a model and expects promises back.
 * The answers come from an `AnalysisSession` in the worker, so this is the piece
 * that turns one into the other: it posts a request, remembers the promise, and
 * settles it when the matching reply arrives.
 *
 * Two rules it keeps, both about not leaving the editor waiting.
 *
 * **Every request settles.** A reply that is dropped — because the user has
 * typed since, or because the worker faulted — still resolves its promise, with
 * the empty answer for that request. A provider whose promise never settles
 * leaves Monaco showing a spinner over the source for the rest of the session.
 *
 * **A stale reply is discarded, not shown.** The source travels with the
 * request, so an answer always describes the text it was asked about; the
 * version says whether that text is still on screen. Applying a code action
 * computed against text the user has already changed is the failure this
 * prevents, and it is the one that would silently corrupt the document.
 */

import type {
  BufferRange,
  CompilerRequest,
  CompilerMessage,
  PlaygroundCodeAction,
  PlaygroundHover,
  PlaygroundRenamePlan,
  PlaygroundRenameRefusal,
  PlaygroundRenameSubject,
  ServiceReplyMessage,
} from "./protocol";

/** What Monaco's providers are given; the worker is not visible past here. */
export interface LanguageServices {
  hover(source: string, offset: number): Promise<PlaygroundHover | undefined>;
  codeActions(
    source: string,
    range: BufferRange,
  ): Promise<readonly PlaygroundCodeAction[]>;
  definitions(source: string, offset: number): Promise<readonly BufferRange[]>;
  references(source: string, offset: number): Promise<readonly BufferRange[]>;
  prepareRename(
    source: string,
    offset: number,
  ): Promise<PlaygroundRenameSubject | PlaygroundRenameRefusal | undefined>;
  rename(
    source: string,
    offset: number,
    newName: string,
  ): Promise<PlaygroundRenamePlan | PlaygroundRenameRefusal | undefined>;
}

/** The transport, narrowed to what this file needs so tests can supply their own. */
export interface ServiceChannel {
  post(request: CompilerRequest): void;
  /** Registers a reply listener; the channel may also deliver compile results. */
  listen(receive: (message: CompilerMessage) => void): void;
  /** Fires when the transport itself failed and no further replies will arrive. */
  onFailure(notify: () => void): void;
}

export function createLanguageServices(
  channel: ServiceChannel,
  currentVersion: () => number,
): LanguageServices {
  const pending = new Map<number, (reply: ServiceReplyMessage | undefined) => void>();
  let nextId = 0;
  // Latched, not merely drained. The requests that matter most are the ones
  // made *after* the fault: a worker whose module fails to evaluate has nothing
  // outstanding to drain, and every hover from then on would wait on a reply
  // that cannot come.
  //
  // Latching does mean a fault the worker could have survived stops the editor
  // services for the life of the page. That is the deliberate trade: `serve` and
  // `compile` already catch everything they can answer, so an `error` event
  // reaching here is something neither of them could.
  let failed = false;

  channel.listen((message) => {
    if (message.kind === "compile-success" || message.kind === "compile-failure") return;
    const settle = pending.get(message.id);
    if (settle === undefined) return;
    pending.delete(message.id);
    if (message.kind === "service-failure") {
      console.error(`Hexagon editor service failed: ${message.message}`);
      settle(undefined);
      return;
    }
    settle(message.version === currentVersion() ? message : undefined);
  });

  channel.onFailure(() => {
    failed = true;
    const waiting = [...pending.values()];
    pending.clear();
    for (const settle of waiting) settle(undefined);
  });

  const ask = (
    build: (id: number, version: number) => CompilerRequest,
  ): Promise<ServiceReplyMessage | undefined> => {
    if (failed) return Promise.resolve(undefined);
    const id = nextId;
    nextId += 1;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      channel.post(build(id, currentVersion()));
    });
  };

  return {
    async hover(source, offset) {
      const reply = await ask((id, version) => ({
        kind: "hover",
        id,
        version,
        source,
        offset,
      }));
      return reply?.kind === "hover" ? reply.hover : undefined;
    },
    async codeActions(source, range) {
      const reply = await ask((id, version) => ({
        kind: "code-actions",
        id,
        version,
        source,
        ...range,
      }));
      return reply?.kind === "code-actions" ? reply.actions : [];
    },
    async definitions(source, offset) {
      const reply = await ask((id, version) => ({
        kind: "definition",
        id,
        version,
        source,
        offset,
      }));
      return reply?.kind === "definition" ? reply.ranges : [];
    },
    async references(source, offset) {
      const reply = await ask((id, version) => ({
        kind: "references",
        id,
        version,
        source,
        offset,
      }));
      return reply?.kind === "references" ? reply.ranges : [];
    },
    async prepareRename(source, offset) {
      const reply = await ask((id, version) => ({
        kind: "prepare-rename",
        id,
        version,
        source,
        offset,
      }));
      return reply?.kind === "prepare-rename" ? reply.subject : undefined;
    },
    async rename(source, offset, newName) {
      const reply = await ask((id, version) => ({
        kind: "rename",
        id,
        version,
        source,
        offset,
        newName,
      }));
      return reply?.kind === "rename" ? reply.result : undefined;
    },
  };
}
