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
const OTHER: readonly BufferRange[] = [{ startOffset: 0, endOffset: 3 }];

const ONE = "let one = 1\n";
const TWO = "let two = 2\n";

/** The text at a version, for a cache that only reads it when it will ask. */
const reading = (source: string) => () => source;

describe("createHoverSpanCache", () => {
  test("asks once for one version, however many times it is asked", async () => {
    const { ask, asked, release } = worker();
    const cache = createHoverSpanCache(ask);

    const first = cache.spansFor(1, reading(ONE));
    release[0]!(SPANS);
    expect(await first).toEqual(SPANS);

    const second = cache.spansFor(1, reading(ONE));
    const third = cache.spansFor(1, reading(ONE));
    // Counted before awaiting: a cache that wrongly re-asked would leave those
    // promises hanging on a reply nobody releases, and the failure would be a
    // five-second timeout rather than the sentence this test is about.
    expect(asked).toEqual([ONE]);
    expect([await second, await third]).toEqual([SPANS, SPANS]);
  });

  test("does not read the document when it is not going to ask", async () => {
    // The common case is a cache hit, and the caller's `read` materializes the
    // whole buffer into a string. On the device this runs on that is a cost per
    // caret rest, paid to answer from memory.
    const { ask, release } = worker();
    const cache = createHoverSpanCache(ask);

    let reads = 0;
    const read = () => {
      reads += 1;
      return ONE;
    };

    const first = cache.spansFor(1, read);
    release[0]!(SPANS);
    await first;
    expect(reads).toBe(1);

    await cache.spansFor(1, read);
    expect(reads).toBe(1);
  });

  test("shares one request with every caller that arrives while it is in flight", async () => {
    // The caret resting again before the first answer comes back. The first
    // request after an edit costs a project analysis, so this window is exactly
    // when the user is tapping around — a second request here is a second
    // analysis nobody asked for.
    const { ask, asked, release } = worker();
    const cache = createHoverSpanCache(ask);

    const waiting = [
      cache.spansFor(1, reading(ONE)),
      cache.spansFor(1, reading(ONE)),
      cache.spansFor(1, reading(ONE)),
    ];
    expect(asked).toEqual([ONE]);

    release[0]!(SPANS);
    expect(await Promise.all(waiting)).toEqual([SPANS, SPANS, SPANS]);
    expect(asked).toEqual([ONE]);
  });

  test("still shares one request after an older one settled under it", async () => {
    // Two in flight, the *older* answering first. The older one must not clear
    // the newer one's request on its way out, or a caller arriving next joins
    // nothing and posts a duplicate.
    const { ask, asked, release } = worker();
    const cache = createHoverSpanCache(ask);

    const stale = cache.spansFor(1, reading(ONE));
    cache.spansFor(2, reading(TWO));
    release[0]!(OTHER);
    await stale;

    cache.spansFor(2, reading(TWO));
    expect(asked).toEqual([ONE, TWO]);
  });

  test("does not remember an unanswered request as an empty answer", async () => {
    // `undefined` is a reply the worker faulted on or that never came, and it
    // is not the same as "the hover answers nowhere in this document". Caching
    // it would leave the caret hover silently dead until the next edit.
    const { ask, asked, release } = worker();
    const cache = createHoverSpanCache(ask);

    const refused = cache.spansFor(1, reading(ONE));
    release[0]!(undefined);
    expect(await refused).toBeUndefined();

    const retried = cache.spansFor(1, reading(ONE));
    expect(asked).toEqual([ONE, ONE]);
    release[1]!(SPANS);
    expect(await retried).toEqual(SPANS);
  });

  test("does remember a genuinely empty answer", async () => {
    // The other side of the rule above: a document the hover answers nowhere in
    // is a real answer, and asking again would be the per-caret-move cost this
    // cache exists to avoid.
    const { ask, asked, release } = worker();
    const cache = createHoverSpanCache(ask);

    const first = cache.spansFor(1, reading("\n"));
    release[0]!([]);
    expect(await first).toEqual([]);

    const second = cache.spansFor(1, reading("\n"));
    expect(asked).toEqual(["\n"]);
    expect(await second).toEqual([]);
  });

  test("asks again when the text changes, and keeps the newer answer", async () => {
    const { ask, asked, release } = worker();
    const cache = createHoverSpanCache(ask);

    const stale = cache.spansFor(1, reading(ONE));
    const fresh = cache.spansFor(2, reading(TWO));
    expect(asked).toEqual([ONE, TWO]);

    // Out of order, which is the case a version number exists for.
    release[1]!(SPANS);
    release[0]!(OTHER);
    expect(await fresh).toEqual(SPANS);
    expect(await stale).toEqual(OTHER);

    // The older answer resolved last and must not have displaced the newer one.
    const again = cache.spansFor(2, reading(TWO));
    expect(asked).toEqual([ONE, TWO]);
    expect(await again).toEqual(SPANS);
  });

  test("posts again after a request that threw, rather than rethrowing forever", async () => {
    // The real service never rejects. This takes any `ask`, and a rejected
    // promise left in the pending slot would be rethrown to every later caller
    // with nothing ever posted again — which the rejections alone cannot tell
    // apart from a retry, so the posts are what is counted.
    let posts = 0;
    const cache = createHoverSpanCache(() => {
      posts += 1;
      return posts === 1
        ? Promise.reject(new Error("worker gone"))
        : Promise.resolve(SPANS);
    });

    await expect(cache.spansFor(1, reading(ONE))).rejects.toThrow("worker gone");
    expect(await cache.spansFor(1, reading(ONE))).toEqual(SPANS);
    expect(posts).toBe(2);
  });
});
