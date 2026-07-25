import { describe, expect, test } from "vitest";

import * as Source from "../support/source.js";
import { lex } from "../passes/lexer/lexer.js";
import { applyLayout } from "../passes/layout/layout.js";
import { parse } from "../passes/parser/parser.js";
import { resolve } from "../passes/resolver/resolver.js";
import { check } from "../passes/checker/checker.js";
import { elaborate } from "../passes/elaborator/elaborator.js";
import { emitJavaScript } from "../passes/emitter/emitter.js";
import trieSource from "../../../runtime/VectorTrie.hex?raw";

/**
 * Conformance for the `.hex` trie backing `Vector(a)` (Collections Part 3 §4),
 * built over the hidden `Node` intrinsic — the persistent 32-way trie *deque*
 * (Part 1 §2). The *build* path: `append` lands elements in the tail buffer for
 * amortized O(1) and flushes a full tail into the trie as one leaf, growing a
 * level when it fills; `prepend` (§4's other end) walks `origin` downward through
 * the headroom below the live range and grows a fresh level at the *left* when it
 * runs out. The *update* path: `set` (§5.4) is a persistent overwrite; `slice`
 * (§6) re-windows `origin`/`capacity` over the shared trie, rebuilding only the
 * (<= 32-element) tail when the window moves it. Vectors are built with the
 * spec-blessed `for i in 1..n` + `var`/`:=` accumulate and read back with
 * `get`/`size`, straddling the 32 and 32² = 1024 branch boundaries so real tail
 * flushes and level growth at both ends are exercised. Nothing here touches
 * `Vector`'s emission, so the Vector gate stays green.
 *
 * The runtime module (`runtime/VectorTrie.hex`, loaded via `?raw`) has only
 * internal declarations; each test appends `export let` probes to its source and
 * compiles the whole as one privileged runtime module, so `Tree`/`Node` never
 * cross a boundary.
 */
async function runTrie(probes: string): Promise<Record<string, unknown>> {
  const file = new Source.File(Source.fileId(0), "/VectorTrie.hex", `${trieSource}\n${probes}`);
  const resolved = resolve(parse(applyLayout(lex(file))), { runtime: true });
  expect(resolved.diagnostics).toEqual([]);
  const typed = check(resolved);
  expect(typed.diagnostics).toEqual([]);
  const javascript = emitJavaScript(elaborate(typed));
  expect(javascript.diagnostics).toEqual([]);
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(javascript.text)}`;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

// `buildTo(n)` = [1, 2, ..., n] via repeated append. Constant-stack (`for` + var),
// no fold/recursion at the call site (the trie's insert recurses, bounded by height).
const BUILD =
  "fun buildTo(n: Int): TrieVector(Int) =\n" +
  "    var acc: TrieVector(Int) = empty()\n" +
  "    for i in 1..n\n" +
  "        acc := append(acc, i)\n" +
  "    acc\n" +
  // buildDown(n) yields the same [1, 2, ..., n] by prepending n, n-1, ..., 1 —
  // every element enters at the front, so the whole origin/left-grow path runs.
  "fun buildDown(n: Int): TrieVector(Int) =\n" +
  "    var acc: TrieVector(Int) = empty()\n" +
  "    for i in 1..n\n" +
  "        acc := prepend(acc, n - i + 1)\n" +
  "    acc\n" +
  // appendRange(v, lo, hi) appends lo, lo+1, ..., hi onto v.
  "fun appendRange(v: TrieVector(Int), lo: Int, hi: Int): TrieVector(Int) =\n" +
  "    var acc: TrieVector(Int) = v\n" +
  "    for i in lo..hi\n" +
  "        acc := append(acc, i)\n" +
  "    acc\n";

describe("VectorTrie build path (append + tail flush + growth)", () => {
  test("§2 tail-only vectors (size <= 32) round-trip through append", async () => {
    const m = await runTrie(
      BUILD +
        "export let s3: Int = size(buildTo(3))\n" +
        "export let empty0: Bool = isEmpty(buildTo(0))\n" +
        "export let empty3: Bool = isEmpty(buildTo(3))\n" +
        "export let g0: Int = get(buildTo(3), 0)\n" +
        "export let g2: Int = get(buildTo(3), 2)\n" +
        "export let full31: Int = get(buildTo(32), 31)\n",
    );
    expect(m.s3).toBe(3);
    expect(m.empty0).toBe(true);
    expect(m.empty3).toBe(false);
    expect(m.g0).toBe(1);
    expect(m.g2).toBe(3);
    expect(m.full31).toBe(32);
  });

  test("§4 the first tail flush (32 -> 33) moves elements into the trie", async () => {
    const m = await runTrie(
      BUILD +
        "export let s33: Int = size(buildTo(33))\n" +
        "export let rootFirst: Int = get(buildTo(33), 0)\n" + // now in the trie
        "export let rootLast: Int = get(buildTo(33), 31)\n" + // last trie element
        "export let tail33: Int = get(buildTo(33), 32)\n", // the new tail element
    );
    expect(m.s33).toBe(33);
    expect(m.rootFirst).toBe(1);
    expect(m.rootLast).toBe(32);
    expect(m.tail33).toBe(33);
  });

  test("§7 a height-2 vector reads every position after many flushes", async () => {
    const m = await runTrie(
      BUILD +
        "let v100 = buildTo(100)\n" +
        "export let s100: Int = size(v100)\n" +
        "export let a0: Int = get(v100, 0)\n" +
        "export let a31: Int = get(v100, 31)\n" + // end of leaf 0
        "export let a32: Int = get(v100, 32)\n" + // start of leaf 1
        "export let a63: Int = get(v100, 63)\n" +
        "export let a95: Int = get(v100, 95)\n" + // end of leaf 2
        "export let a99: Int = get(v100, 99)\n", // in the tail
    );
    expect(m.s100).toBe(100);
    expect(m.a0).toBe(1);
    expect(m.a31).toBe(32);
    expect(m.a32).toBe(33);
    expect(m.a63).toBe(64);
    expect(m.a95).toBe(96);
    expect(m.a99).toBe(100);
  });

  test("§4 growth past 32² = 1024 builds a height-3 trie", async () => {
    // Growth to height 3 is flush #33, which fires on the 1057th append (a flush
    // fires at element 32k+1); flush #34, at element 1089, is the first to take
    // insertLeaf's recursive arm (leaf 33 -> root child 1, childPos != 0). So
    // buildTo(1100) is the shallowest build that lands a fully-formed height-3
    // trie: root holds indices 0..1087 (34 leaves), the tail holds 1088..1099.
    // The probes straddle every region — the original subtree under the root's
    // first child, the growth spine and the recursed leaf under its second, and
    // the tail.
    const m = await runTrie(
      BUILD +
        "let big = buildTo(1100)\n" +
        "export let s1100: Int = size(big)\n" +
        "export let b0: Int = get(big, 0)\n" + // deep under old root, now root child 0
        "export let b1023: Int = get(big, 1023)\n" + // last leaf under root child 0
        "export let b1024: Int = get(big, 1024)\n" + // first under root child 1 (growth spine)
        "export let b1055: Int = get(big, 1055)\n" + // last of the spine's leaf
        "export let b1056: Int = get(big, 1056)\n" + // first of the recursed leaf (flush #34)
        "export let b1087: Int = get(big, 1087)\n" + // last element in the trie
        "export let b1088: Int = get(big, 1088)\n" + // first tail element
        "export let b1099: Int = get(big, 1099)\n", // final element (in the tail)
    );
    expect(m.s1100).toBe(1100);
    expect(m.b0).toBe(1);
    expect(m.b1023).toBe(1024);
    expect(m.b1024).toBe(1025);
    expect(m.b1055).toBe(1056);
    expect(m.b1056).toBe(1057);
    expect(m.b1087).toBe(1088);
    expect(m.b1088).toBe(1089);
    expect(m.b1099).toBe(1100);
  });
});

describe("VectorTrie prepend path (origin + left growth)", () => {
  test("§4 tail singleton, first left-grow, and the 32→33 boundary", async () => {
    const m = await runTrie(
      BUILD +
        "export let s1: Int = size(buildDown(1))\n" +
        "export let one: Int = get(buildDown(1), 0)\n" + // empty prepend -> tail singleton
        "export let s3: Int = size(buildDown(3))\n" +
        "export let a0: Int = get(buildDown(3), 0)\n" +
        "export let a2: Int = get(buildDown(3), 2)\n" +
        "export let s33: Int = size(buildDown(33))\n" +
        "export let b0: Int = get(buildDown(33), 0)\n" + // front, deep in a grown level
        "export let b31: Int = get(buildDown(33), 31)\n" +
        "export let b32: Int = get(buildDown(33), 32)\n",
    );
    expect(m.s1).toBe(1);
    expect(m.one).toBe(1);
    expect(m.s3).toBe(3);
    expect(m.a0).toBe(1);
    expect(m.a2).toBe(3);
    expect(m.s33).toBe(33);
    expect(m.b0).toBe(1);
    expect(m.b31).toBe(32);
    expect(m.b32).toBe(33);
  });

  test("§4 many prepends grow left past 32² = 1024 and read every region", async () => {
    const m = await runTrie(
      BUILD +
        "let v = buildDown(1050)\n" +
        "export let s: Int = size(v)\n" +
        "export let x0: Int = get(v, 0)\n" + // the last-prepended element, deepest at the left
        "export let x31: Int = get(v, 31)\n" +
        "export let x32: Int = get(v, 32)\n" +
        "export let x1023: Int = get(v, 1023)\n" +
        "export let x1024: Int = get(v, 1024)\n" +
        "export let x1049: Int = get(v, 1049)\n",
    );
    expect(m.s).toBe(1050);
    expect(m.x0).toBe(1);
    expect(m.x31).toBe(32);
    expect(m.x32).toBe(33);
    expect(m.x1023).toBe(1024);
    expect(m.x1024).toBe(1025);
    expect(m.x1049).toBe(1050);
  });

  test("§4 append after a left-grow (the two ends share one trie)", async () => {
    const m = await runTrie(
      BUILD +
        "fun mixed(): TrieVector(Int) =\n" +
        "    var acc: TrieVector(Int) = buildDown(40)\n" + // forces a left-grow, origin > 0
        "    for i in 41..80\n" +
        "        acc := append(acc, i)\n" + // appends must route past the prepended front
        "    acc\n" +
        "let v = mixed()\n" +
        "export let s: Int = size(v)\n" +
        "export let f: Int = get(v, 0)\n" +
        "export let mid: Int = get(v, 39)\n" +
        "export let join: Int = get(v, 40)\n" +
        "export let last: Int = get(v, 79)\n",
    );
    expect(m.s).toBe(80);
    expect(m.f).toBe(1);
    expect(m.mid).toBe(40);
    expect(m.join).toBe(41);
    expect(m.last).toBe(80);
  });
});

describe("VectorTrie set (§5.4 persistent overwrite)", () => {
  test("update lands in the tree and the tail without disturbing neighbours", async () => {
    const m = await runTrie(
      BUILD +
        "let v = set(set(buildTo(100), 50, 999), 99, 777)\n" + // index 50 in the tree, 99 in the tail
        "export let s: Int = size(v)\n" +
        "export let at50: Int = get(v, 50)\n" +
        "export let at49: Int = get(v, 49)\n" +
        "export let at51: Int = get(v, 51)\n" +
        "export let at99: Int = get(v, 99)\n" +
        "export let at98: Int = get(v, 98)\n",
    );
    expect(m.s).toBe(100);
    expect(m.at50).toBe(999);
    expect(m.at49).toBe(50);
    expect(m.at51).toBe(52);
    expect(m.at99).toBe(777);
    expect(m.at98).toBe(99);
  });
});

describe("VectorTrie slice (§6 windowing over the shared trie)", () => {
  test("general window, O(1) end slices, sub-tail window, empty and full", async () => {
    const m = await runTrie(
      BUILD +
        "let big = buildTo(100)\n" +
        "export let gs: Int = size(slice(big, 10, 20))\n" + // general middle window -> 11..20
        "export let g0: Int = get(slice(big, 10, 20), 0)\n" +
        "export let g9: Int = get(slice(big, 10, 20), 9)\n" +
        "export let ds: Int = size(slice(big, 5, 100))\n" + // dropFirst-shaped -> reuse path
        "export let d0: Int = get(slice(big, 5, 100), 0)\n" +
        "export let d94: Int = get(slice(big, 5, 100), 94)\n" +
        "export let ls: Int = size(slice(big, 0, 98))\n" + // dropLast keeping tail offset -> reuse
        "export let l97: Int = get(slice(big, 0, 98), 97)\n" +
        "export let ws: Int = size(slice(big, 50, 55))\n" + // window shorter than a tail -> liveStart
        "export let w0: Int = get(slice(big, 50, 55), 0)\n" +
        "export let w4: Int = get(slice(big, 50, 55), 4)\n" +
        "export let es: Int = size(slice(big, 7, 7))\n" + // empty
        "export let fs: Int = size(slice(big, 0, 100))\n" + // full
        "export let f99: Int = get(slice(big, 0, 100), 99)\n",
    );
    expect(m.gs).toBe(10);
    expect(m.g0).toBe(11);
    expect(m.g9).toBe(20);
    expect(m.ds).toBe(95);
    expect(m.d0).toBe(6);
    expect(m.d94).toBe(100);
    expect(m.ls).toBe(98);
    expect(m.l97).toBe(98);
    expect(m.ws).toBe(5);
    expect(m.w0).toBe(51);
    expect(m.w4).toBe(55);
    expect(m.es).toBe(0);
    expect(m.fs).toBe(100);
    expect(m.f99).toBe(100);
  });

  test("slice of a prepend-built vector and of a height-3 trie", async () => {
    const m = await runTrie(
      BUILD +
        "export let ps: Int = size(slice(buildDown(100), 10, 20))\n" +
        "export let p0: Int = get(slice(buildDown(100), 10, 20), 0)\n" +
        "export let p9: Int = get(slice(buildDown(100), 10, 20), 9)\n" +
        "let tall = buildTo(1056)\n" +
        "export let ts: Int = size(slice(tall, 500, 1050))\n" +
        "export let t0: Int = get(slice(tall, 500, 1050), 0)\n" +
        "export let t549: Int = get(slice(tall, 500, 1050), 549)\n",
    );
    expect(m.ps).toBe(10);
    expect(m.p0).toBe(11);
    expect(m.p9).toBe(20);
    expect(m.ts).toBe(550);
    expect(m.t0).toBe(501);
    expect(m.t549).toBe(1050);
  });

  test("append onto a slice shares and correctly overwrites the trie", async () => {
    // A slice shares the original (untrimmed) tree; appending onto it must land
    // disjoint values without ever reading a stale shared slot. Values 1000+ are
    // disjoint from the 1..100 source so any mis-read shows.
    const m = await runTrie(
      BUILD +
        // no flush: a couple of appends stay in the rebuilt tail
        "let a = appendRange(slice(buildTo(100), 0, 50), 1000, 1001)\n" +
        "export let as: Int = size(a)\n" +
        "export let a49: Int = get(a, 49)\n" +
        "export let a50: Int = get(a, 50)\n" +
        "export let a51: Int = get(a, 51)\n" +
        // 56 appends: cross tail flushes that rewrite shared tree slots 1 and 2
        "let b = appendRange(slice(buildTo(100), 0, 50), 1000, 1055)\n" +
        "export let bs: Int = size(b)\n" +
        "export let b0: Int = get(b, 0)\n" +
        "export let b49: Int = get(b, 49)\n" +
        "export let b50: Int = get(b, 50)\n" +
        "export let b70: Int = get(b, 70)\n" + // internal 70 -> a flush-rewritten slot
        "export let b105: Int = get(b, 105)\n" +
        // append onto an origin > 0 window
        "let c = appendRange(slice(buildTo(100), 40, 90), 1000, 1030)\n" +
        "export let cs: Int = size(c)\n" +
        "export let c0: Int = get(c, 0)\n" +
        "export let c49: Int = get(c, 49)\n" +
        "export let c50: Int = get(c, 50)\n" +
        "export let c80: Int = get(c, 80)\n",
    );
    expect(m.as).toBe(52);
    expect(m.a49).toBe(50);
    expect(m.a50).toBe(1000);
    expect(m.a51).toBe(1001);
    expect(m.bs).toBe(106);
    expect(m.b0).toBe(1);
    expect(m.b49).toBe(50);
    expect(m.b50).toBe(1000);
    expect(m.b70).toBe(1020);
    expect(m.b105).toBe(1055);
    expect(m.cs).toBe(81);
    expect(m.c0).toBe(41);
    expect(m.c49).toBe(90);
    expect(m.c50).toBe(1000);
    expect(m.c80).toBe(1030);
  });
});
