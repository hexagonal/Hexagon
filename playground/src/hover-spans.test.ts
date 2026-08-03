import { describe, expect, test } from "vitest";

import { createHoverSpanCache } from "./hover-spans";
import type { BufferRange } from "./protocol";

/** A worker whose replies are released by hand, so timing is a test input. */
function worker() {
  const asked: string[] = [];
  const release: ((spans: readonly BufferRange[] | undefined) => void)[] = [];
  const ask = (source: string): Promise<readonly BufferRange[] | undefined> => {
    asked.push(source);
    return new Promise((resolve) => release.push(resolve));
  };
  return { ask, asked, release };
}

const SPANS: readonly BufferRange[] = [{ startOffset: 4, endOffset: 7 }];

describe("createHoverSpanCache", () => {
  test("asks once for one version, however many times it is asked", async () => {
    const { ask, asked, release } = worker();
    const cache = createHoverSpanCache(ask);

    const first = cache.spansFor(1, "let one = 1\n");
    release[0]!(SPANS);
    expect(await first).toEqual(SPANS);
    expect(await cache.spansFor(1, "let one = 1\n")).toEqual(SPANS);
    expect(await cache.spansFor(1, "let one = 1\n")).toEqual(SPANS);

    expect(asked).toHaveLength(1);
  });

  test("shares one request with every caller that arrives while it is in flight", async () => {
    // The caret resting again before the first answer comes back. On iPadOS the
    // first request after an edit is the expensive one, so this window is
    // exactly when the user is tapping around — a second request here is a
    // second project analysis nobody asked for.
    const { ask, asked, release } = worker();
    const cache = createHoverSpanCache(ask);

    const waiting = [
      cache.spansFor(1, "let one = 1\n"),
      cache.spansFor(1, "let one = 1\n"),
      cache.spansFor(1, "let one = 1\n"),
    ];
    expect(asked).toHaveLength(1);

    release[0]!(SPANS);
    expect(await Promise.all(waiting)).toEqual([SPANS, SPANS, SPANS]);
    expect(asked).toHaveLength(1);
  });

  test("does not remember an unanswered request as an empty answer", async () => {
    // `undefined` is a reply that was dropped as stale or never came, and it is
    // not the same as "the hover answers nowhere in this document". Caching it
    // would leave the caret hover silently dead until the next edit.
    const { ask, asked, release } = worker();
    const cache = createHoverSpanCache(ask);

    const refused = cache.spansFor(1, "let one = 1\n");
    release[0]!(undefined);
    expect(await refused).toBeUndefined();

    const retried = cache.spansFor(1, "let one = 1\n");
    expect(asked).toHaveLength(2);
    release[1]!(SPANS);
    expect(await retried).toEqual(SPANS);
  });

  test("does remember a genuinely empty answer", async () => {
    // The other side of the rule above: a document the hover answers nowhere in
    // is a real answer, and asking again would be the per-caret-move cost this
    // cache exists to avoid.
    const { ask, asked, release } = worker();
    const cache = createHoverSpanCache(ask);

    const first = cache.spansFor(1, "\n");
    release[0]!([]);
    expect(await first).toEqual([]);
    expect(await cache.spansFor(1, "\n")).toEqual([]);

    expect(asked).toHaveLength(1);
  });

  test("asks again when the text changes, and keeps the newer answer", async () => {
    const { ask, asked, release } = worker();
    const cache = createHoverSpanCache(ask);

    const stale = cache.spansFor(1, "let one = 1\n");
    const fresh = cache.spansFor(2, "let two = 2\n");
    expect(asked).toEqual(["let one = 1\n", "let two = 2\n"]);

    // Out of order, which is the case a version number exists for.
    release[1]!(SPANS);
    release[0]!([{ startOffset: 0, endOffset: 0 }]);
    expect(await fresh).toEqual(SPANS);
    expect(await stale).toEqual([{ startOffset: 0, endOffset: 0 }]);

    // The older answer resolved last and must not have displaced the newer one.
    expect(await cache.spansFor(2, "let two = 2\n")).toEqual(SPANS);
    expect(asked).toHaveLength(2);
  });
});
