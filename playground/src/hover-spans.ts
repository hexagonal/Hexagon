/**
 * The caret-driven hover's memory of where the hover answers.
 *
 * On iPadOS the Playground opens the hover as the caret moves rather than
 * waiting to be hovered, and so has to decide whether to open one *before* it
 * has an answer to show. The decision is made against the spans `Session.hover`
 * would answer at (#254). Those come from the worker, and this is the piece that
 * keeps one document from asking for them more than once.
 *
 * It is separated from `monaco.ts` because every rule below is about timing and
 * none of them is about Monaco — and each of the mistakes worth making here is
 * invisible in a code read:
 *
 * **One request per version, shared.** A caret resting inside the window of an
 * earlier request must not post a second one for the same text. The first
 * request after an edit is the expensive one — it costs a project analysis — so
 * that window is exactly when a user is tapping around.
 *
 * **An unanswered request is not an answer.** The service returns `undefined`
 * for a reply that never came: the worker faulted on this request, or the
 * channel to it has failed. Storing that as "the hover answers nowhere" would be
 * believed until the next edit, leaving the feature silently dead for the
 * document the user is looking at.
 *
 * **A late answer does not displace a newer one.** Two requests can be in
 * flight and can settle in either order, so the one that finishes last is not
 * the one that describes the text on screen.
 *
 * The source is taken as a thunk because the common case is a cache hit, and
 * materializing a whole document into a string to answer from memory is a cost
 * the caret pays on every rest.
 */

import type { BufferRange } from "./protocol";

export interface HoverSpanCache {
  /**
   * The spans for the text `read` returns, which the caller says is `version`.
   *
   * Resolves to `undefined` when the worker did not answer; the caller should
   * neither gate on that nor remember it. Any version the caller likes, as long
   * as it changes whenever the text does. `read` is called only when this cache
   * is actually going to ask.
   */
  spansFor(
    version: number,
    read: () => string,
  ): Promise<readonly BufferRange[] | undefined>;
}

export function createHoverSpanCache(
  ask: (source: string) => Promise<readonly BufferRange[] | undefined>,
): HoverSpanCache {
  let cached: { readonly version: number; readonly spans: readonly BufferRange[] } | undefined;
  let pending: {
    readonly version: number;
    readonly answer: Promise<readonly BufferRange[] | undefined>;
  } | undefined;
  /** The version of the most recent request started, whatever has settled. */
  let latest: number | undefined;

  return {
    async spansFor(version, read) {
      if (cached?.version === version) return cached.spans;
      if (pending?.version !== version) {
        pending = { version, answer: ask(read()) };
        latest = version;
      }
      const asked = pending;
      let spans: readonly BufferRange[] | undefined;
      try {
        spans = await asked.answer;
      } finally {
        // Cleared only if nothing newer has replaced it: a request begun while
        // this one was in flight is the one a later caller is waiting on.
        // In `finally` so that an `ask` which rejects — the real one does not,
        // but this takes any — cannot leave a dead promise nailed in place,
        // rethrown to every later caller and never retried.
        if (pending === asked) pending = undefined;
      }
      if (spans === undefined) return undefined;
      // Answered honestly to *this* caller either way — it asked about this
      // text and this is that text's answer — but the cache slot belongs to the
      // newest request. Two can be in flight, and the one that settles last is
      // not the one describing what is on screen. No monotonic version is
      // assumed; the question asked is only "is this still the latest".
      if (latest === version) cached = { version, spans };
      return spans;
    },
  };
}
