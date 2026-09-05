import { describe, expect, test } from "vitest";

import { runProject } from "../support/test-project.js";
import trieSource from "../../../stdlib/Runtime/VectorTrie.hex?raw";

/**
 * Conformance for the `.hex` trie backing `Vector(a)` (Collections Part 3 §4),
 * built over the hidden `Node` intrinsic — the persistent 32-way trie *deque*
 * (Part 1 §2). The *build* path: `append` lands elements in the tail buffer for
 * amortized O(1) and flushes a full tail into the trie as one leaf, growing a
 * level when it fills; `prepend` (§4's other end) walks `origin` downward through
 * the headroom below the live range and grows a fresh level at the *left* when it
 * runs out. The *update* path: `set` (§5.4) is a persistent overwrite; `slice`
 * (§6) re-windows `origin`/`capacity` over the shared trie, rebuilding only the
 * (<= 32-element) tail when the window moves it and then *trimming* the result's
 * height to the window's own. Vectors are built with the
 * spec-blessed `for i in 1..n` + `var`/`:=` accumulate and read back with
 * `get`/`size`, straddling the 32 and 32² = 1024 branch boundaries so real tail
 * flushes and level growth at both ends are exercised. Nothing here touches
 * `Vector`'s emission, so the Vector gate stays green.
 *
 * The runtime module (`stdlib/Runtime/VectorTrie.hex`, loaded via `?raw`) has only
 * internal declarations; each test appends `export let` probes to its source and
 * compiles the whole as one privileged runtime module, so `Tree`/`Node` never
 * cross a boundary.
 *
 * ## How the probe becomes a runtime module
 *
 * There is one route and no other (#829): a project's own file at the member's
 * **basename** declaring the member's **name** is adopted as that member, and
 * with the seat come both privileges — `Node(a)` and the intrinsic door. So the
 * probe is `/VectorTrie.hex` carrying `module Runtime.VectorTrie` verbatim, and
 * it really is the runtime every `Vector(a)` in this program is built on. The
 * host grant that used to compile a probe under a path of its own choosing is
 * gone; a path names nothing here.
 *
 * That has one consequence the harness has to pay for. A runtime module is
 * emitted only where the program reaches it, and a trie that serves no vector
 * is reached by nothing — so the project carries `TOUCH`, one ordinary module
 * holding one vector, whose emission is the edge that brings the trie along.
 * The probes' exports are still read off the trie module itself.
 */
const PROBE_PATH = "/VectorTrie.hex";

/**
 * One ordinary module with one vector in it, so the adopted trie is reached and
 * emitted. Nothing here is under test; it exists to be an importer.
 */
const TOUCH: readonly [string, string] = [
  "/Main.hex",
  "module Main\n\nlet sample: Vector(Int) = [1]\nexport let touched: Bool = Vector.isEmpty(sample)\n",
];

async function runTrie(probes: string): Promise<Record<string, unknown>> {
  // Through the whole project, with this file adopted as the runtime module: the
  // trie's own `isEmpty` returns `Bool`, and since #147 that names a prelude
  // declaration, so a prelude-free compilation of this module no longer typechecks.
  return runProject(
    [[PROBE_PATH, `${trieSource}\n${probes}`], TOUCH],
    { entry: PROBE_PATH },
  );
}

// `buildTo(n)` = [1, 2, ..., n] via repeated append. Constant-stack (`for` + var),
// no fold/recursion at the call site (the trie's insert recurses, bounded by height).
const BUILD =
  "fun buildTo(n: Int): TrieVector(Int) =\n" +
  "    var acc: TrieVector(Int) = empty\n" +
  "    for i in 1..n\n" +
  "        acc := append(acc, i)\n" +
  "    acc\n" +
  // buildDown(n) yields the same [1, 2, ..., n] by prepending n, n-1, ..., 1 —
  // every element enters at the front, so the whole origin/left-grow path runs.
  "fun buildDown(n: Int): TrieVector(Int) =\n" +
  "    var acc: TrieVector(Int) = empty\n" +
  "    for i in 1..n\n" +
  "        acc := prepend(acc, n - i + 1)\n" +
  "    acc\n" +
  // appendRange(v, lo, hi) appends lo, lo+1, ..., hi onto v.
  "fun appendRange(v: TrieVector(Int), lo: Int, hi: Int): TrieVector(Int) =\n" +
  "    var acc: TrieVector(Int) = v\n" +
  "    for i in lo..hi\n" +
  "        acc := append(acc, i)\n" +
  "    acc\n" +
  // prependN(v, n) prepends n elements (values 1999, 1998, ..., 2000 - n) onto v,
  // so the final front is 2000 - n; disjoint from any 1..k source.
  "fun prependN(v: TrieVector(Int), n: Int): TrieVector(Int) =\n" +
  "    var acc: TrieVector(Int) = v\n" +
  "    for i in 1..n\n" +
  "        acc := prepend(acc, 2000 - i)\n" +
  "    acc\n" +
  // state(v) is the representation a derivation is actually stated in:
  // `(origin, capacity, height, tailOffset(capacity))`. A probe is compiled as
  // part of the module, so it reads the private fields directly — and a height
  // asserted without its origin is not a claim about which elements the window
  // reads, which is why all four travel together.
  "fun state(v: TrieVector(Int)): (Int, Int, Int, Int) =\n" +
  "    (v.origin, v.capacity, v.height, tailOffset(v.capacity))\n";

// Counts `nodeRun` calls for a full traversal, and sums the elements it yields,
// so a wrong run length shows as a wrong sum rather than passing on the count
// alone. Shared by the `nodeRun` describe, which is what it was written for, and
// by the trim's, which asks the same question of a window's own shape.
const WALK =
  "fun walk(v: TrieVector(Int)): (Int, Int) =\n" +
  "    var calls = 0\n" +
  "    var total = 0\n" +
  "    var index = 0\n" +
  "    for step in 1..size(v)\n" +
  "        if index < size(v) then\n" +
  "            let (leafValues, offset, run) = nodeRun(v, index)\n" +
  "            calls := calls + 1\n" +
  "            var seen = 0\n" +
  "            for inner in 1..run\n" +
  "                total := total + Node.get(leafValues, offset + seen)\n" +
  "                seen := seen + 1\n" +
  "            index := index + run\n" +
  "    (calls, total)\n";

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

  test("update on origin > 0 vectors (sliced window and prepend-built trie)", async () => {
    // set is otherwise only exercised at origin 0; a sliced window has a nonzero
    // origin and a rebuilt tail, and a prepend-built trie has a large origin.
    const m = await runTrie(
      BUILD +
        "let w = set(set(slice(buildTo(100), 40, 90), 0, 111), 49, 222)\n" + // window 41..90; idx 0 tree, 49 tail
        "export let ws: Int = size(w)\n" +
        "export let w0: Int = get(w, 0)\n" +
        "export let w1: Int = get(w, 1)\n" +
        "export let w48: Int = get(w, 48)\n" +
        "export let w49: Int = get(w, 49)\n" +
        "let p = set(buildDown(100), 3, 555)\n" +
        "export let p2: Int = get(p, 2)\n" +
        "export let p3: Int = get(p, 3)\n" +
        "export let p4: Int = get(p, 4)\n",
    );
    expect(m.ws).toBe(50);
    expect(m.w0).toBe(111);
    expect(m.w1).toBe(42);
    expect(m.w48).toBe(89);
    expect(m.w49).toBe(222);
    expect(m.p2).toBe(3);
    expect(m.p3).toBe(555);
    expect(m.p4).toBe(5);
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
    // A slice shares whatever subtree the trim left it holding, so appending onto
    // it must land disjoint values without ever reading a stale shared slot —
    // and now the trie it grows is the *small* one. `slice(buildTo(100), 0, 50)`
    // takes the rebuild path (newOff = tailOffset(50) = 32, the original's is 96)
    // and then trims: its tree range [0, 32) is under root child 0, so the root
    // becomes that shared leaf and the window is (0, 50, height 1, tailOffset 32).
    // `slice(buildTo(100), 40, 90)` likewise trims to (8, 58, height 1, 32).
    // Both therefore *regrow* — the flushes below fill a fresh height-1 root and
    // then grow it a level — where before the trim they overwrote slots of the
    // original height-2 tree. Values 1000+ are disjoint from the 1..100 source so
    // any mis-read shows.
    const m = await runTrie(
      BUILD +
        // no flush: a couple of appends stay in the rebuilt tail
        "let a = appendRange(slice(buildTo(100), 0, 50), 1000, 1001)\n" +
        "export let ashape: (Int, Int, Int, Int) = state(slice(buildTo(100), 0, 50))\n" +
        "export let as: Int = size(a)\n" +
        "export let a49: Int = get(a, 49)\n" +
        "export let a50: Int = get(a, 50)\n" +
        "export let a51: Int = get(a, 51)\n" +
        // 56 appends: two tail flushes. The first fills the trimmed height-1 root
        // (leafPos 1 == its capacity) and so grows a level; the second inserts at
        // leaf 2 of the new height-2 root. Both write slots the window owns.
        "let b = appendRange(slice(buildTo(100), 0, 50), 1000, 1055)\n" +
        "export let bshape: (Int, Int, Int, Int) = state(b)\n" +
        "export let bs: Int = size(b)\n" +
        "export let b0: Int = get(b, 0)\n" +
        "export let b49: Int = get(b, 49)\n" +
        "export let b50: Int = get(b, 50)\n" +
        "export let b70: Int = get(b, 70)\n" + // internal 70 -> a flushed leaf
        "export let b105: Int = get(b, 105)\n" +
        // append onto an origin > 0 window, itself trimmed to height 1
        "let c = appendRange(slice(buildTo(100), 40, 90), 1000, 1030)\n" +
        "export let cshape: (Int, Int, Int, Int) = state(c)\n" +
        "export let cs: Int = size(c)\n" +
        "export let c0: Int = get(c, 0)\n" +
        "export let c49: Int = get(c, 49)\n" +
        "export let c50: Int = get(c, 50)\n" +
        "export let c80: Int = get(c, 80)\n",
    );
    expect(m.ashape).toEqual([0, 50, 1, 32]);
    expect(m.bshape).toEqual([0, 106, 2, 96]);
    expect(m.cshape).toEqual([8, 89, 2, 64]);
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

describe("VectorTrie slice height trim (§6 a window pays its own logarithm)", () => {
  /**
   * A window re-windows over the original trie, and keeping the original's
   * `height` made every later `get`/`set` on it descend levels the window does
   * not span: a ten-element window of a height-3 vector charged three levels per
   * read for the rest of its life, and held the whole original tree live against
   * collection. `slice` now trims — while the window's *tree* range
   * `[origin, tailOffset(capacity))` lies under a single child of the root, that
   * child becomes the root and `origin`/`capacity` rebase by its offset; a range
   * that is empty (a wholly tail-resident window) drops the tree outright.
   *
   * The fit check is over the tree range and not over `capacity - 1`, because
   * `capacity` may exceed `radix^height` by up to 32 — the tail can sit past the
   * root's address space — and the last-index form would refuse sound trims.
   *
   * `height` is representation, and reading it is the only way to make the claim
   * at all; the probes therefore assert the whole state tuple, and pin values at
   * both window ends and inside alongside. A height right for the wrong origin
   * is a trie that reads the wrong elements, and only the values catch that.
   */
  test("§6 the tree range decides: one child descends, two children do not", async () => {
    // buildTo(100) is (0, 100, height 2, tailOffset 96): the tree holds internal
    // [0, 96) as three leaves, the tail [96, 100).
    const m = await runTrie(
      BUILD +
        "let big = buildTo(100)\n" +
        // [40, 90): rebuild path (newOff = tailOffset(90) = 64 != 96). Tree range
        // [40, 64): 40/32 = 1 and 63/32 = 1, one child, so the root becomes leaf 1
        // and all three indices rebase by 1*32 -> (8, 58, height 1, tailOffset 32).
        "export let mid: (Int, Int, Int, Int) = state(slice(big, 40, 90))\n" +
        "export let mid0: Int = get(slice(big, 40, 90), 0)\n" +
        "export let mid23: Int = get(slice(big, 40, 90), 23)\n" + // last tree element
        "export let mid24: Int = get(slice(big, 40, 90), 24)\n" + // first tail element
        "export let mid49: Int = get(slice(big, 40, 90), 49)\n" +
        // [30, 70): tree range [30, 64) straddles leaves 0 and 1 (30/32 = 0,
        // 63/32 = 1), so the loop exits on its first check and nothing is trimmed.
        "export let straddle: (Int, Int, Int, Int) = state(slice(big, 30, 70))\n" +
        "export let str0: Int = get(slice(big, 30, 70), 0)\n" +
        "export let str39: Int = get(slice(big, 30, 70), 39)\n" +
        // The end slices: reuse path, and their tree ranges [0, 96) / [1, 96) span
        // leaves 0..2, so they trim nothing and hand `root`/`tail` back untouched.
        // That is what keeps §4's "effectively O(1)" note — and the object-identity
        // pins in `vector-trie-wiring.test.ts` — true.
        "export let dropLast: (Int, Int, Int, Int) = state(slice(big, 0, 99))\n" +
        "export let dropFirst: (Int, Int, Int, Int) = state(slice(big, 1, 100))\n" +
        // A height-3 source: buildTo(1100) is (0, 1100, 3, 1088). Tree range
        // [100, 896) is under top child 0 (100/1024 = 895/1024 = 0), a rebase of
        // 0 that still drops a level; the next check straddles (100/32 = 3,
        // 895/32 = 27), so exactly one level goes.
        "let tall = buildTo(1100)\n" +
        "export let one: (Int, Int, Int, Int) = state(slice(tall, 100, 900))\n" +
        "export let one0: Int = get(slice(tall, 100, 900), 0)\n" +
        "export let one799: Int = get(slice(tall, 100, 900), 799)\n" +
        // Two levels in one slice: tree range [1050, 1056) is under top child 1
        // (both /1024 = 1) -> rebase 1024 giving (26, 36, 2, 32); then [26, 32) is
        // under sub-child 0 (both /32 = 0) -> rebase 0, height 1.
        "export let two: (Int, Int, Int, Int) = state(slice(tall, 1050, 1060))\n" +
        "export let two0: Int = get(slice(tall, 1050, 1060), 0)\n" +
        "export let two5: Int = get(slice(tall, 1050, 1060), 5)\n" + // last tree element
        "export let two6: Int = get(slice(tall, 1050, 1060), 6)\n" + // first tail element
        "export let two9: Int = get(slice(tall, 1050, 1060), 9)\n",
    );
    expect(m.mid).toEqual([8, 58, 1, 32]);
    expect(m.mid0).toBe(41);
    expect(m.mid23).toBe(64);
    expect(m.mid24).toBe(65);
    expect(m.mid49).toBe(90);
    expect(m.straddle).toEqual([30, 70, 2, 64]);
    expect(m.str0).toBe(31);
    expect(m.str39).toBe(70);
    expect(m.dropLast).toEqual([0, 99, 2, 96]);
    expect(m.dropFirst).toEqual([1, 100, 2, 96]);
    expect(m.one).toEqual([100, 900, 2, 896]);
    expect(m.one0).toBe(101);
    expect(m.one799).toBe(900);
    expect(m.two).toEqual([26, 36, 1, 32]);
    expect(m.two0).toBe(1051);
    expect(m.two5).toBe(1056);
    expect(m.two6).toBe(1057);
    expect(m.two9).toBe(1060);
  });

  test("§6 the child-span boundary and its neighbours", async () => {
    // The three windows either side of the leaf-1 boundary of buildTo(100), each
    // derived from the algorithm rather than from the shape of its neighbours.
    const m = await runTrie(
      BUILD +
        "let big = buildTo(100)\n" +
        // [32, 64): newOff = tailOffset(64) = 32, so the tail is rebuilt from
        // internal [32, 64) — the whole window. treeEnd 32 <= origin 32, so the
        // tail-only collapse fires: indices rebase by 32 and the tree is dropped,
        // giving (0, 32, 1, 0) — a full 32-slot pure-tail window.
        "export let atBoundary: (Int, Int, Int, Int) = state(slice(big, 32, 64))\n" +
        "export let ab0: Int = get(slice(big, 32, 64), 0)\n" +
        "export let ab31: Int = get(slice(big, 32, 64), 31)\n" +
        "export let abn: Int = size(slice(big, 32, 64))\n" +
        // [31, 64): one element earlier, and the collapse no longer applies —
        // treeEnd 32 > origin 31. Tree range [31, 32) is under leaf 0 (both
        // /32 = 0), a rebase of 0, so the descent leaves (31, 64, 1, 32): a
        // one-element tree residue with the other 32 in the tail.
        "export let below: (Int, Int, Int, Int) = state(slice(big, 31, 64))\n" +
        "export let bl0: Int = get(slice(big, 31, 64), 0)\n" + // the tree residue
        "export let bl1: Int = get(slice(big, 31, 64), 1)\n" + // first tail element
        "export let bl32: Int = get(slice(big, 31, 64), 32)\n" +
        "export let bln: Int = size(slice(big, 31, 64))\n" +
        // [32, 65): one element later, and newOff = tailOffset(65) = 64 moves the
        // tail. Tree range [32, 64) is under leaf 1 (32/32 = 63/32 = 1), so the
        // root becomes leaf 1 and everything rebases by 32 -> (0, 33, 1, 32).
        "export let above: (Int, Int, Int, Int) = state(slice(big, 32, 65))\n" +
        "export let av0: Int = get(slice(big, 32, 65), 0)\n" +
        "export let av31: Int = get(slice(big, 32, 65), 31)\n" + // last tree element
        "export let av32: Int = get(slice(big, 32, 65), 32)\n" + // the single tail element
        "export let avn: Int = size(slice(big, 32, 65))\n",
    );
    expect(m.atBoundary).toEqual([0, 32, 1, 0]);
    expect(m.ab0).toBe(33);
    expect(m.ab31).toBe(64);
    expect(m.abn).toBe(32);
    expect(m.below).toEqual([31, 64, 1, 32]);
    expect(m.bl0).toBe(32);
    expect(m.bl1).toBe(33);
    expect(m.bl32).toBe(64);
    expect(m.bln).toBe(33);
    expect(m.above).toEqual([0, 33, 1, 32]);
    expect(m.av0).toBe(33);
    expect(m.av31).toBe(64);
    expect(m.av32).toBe(65);
    expect(m.avn).toBe(33);
  });

  test("§6 a wholly tail-resident window drops the tree, on both slice paths", async () => {
    const m = await runTrie(
      BUILD +
        "let big = buildTo(100)\n" +
        // Rebuild path. [50, 55): newOff = tailOffset(55) = 32, the tail is rebuilt
        // at slots 18..22, and treeEnd 32 <= origin 50 collapses to (18, 23, 1, 0)
        // — `tailOffset(23)` is 0, and 23 - 32... the rebase by 32 is what leaves
        // the tail's own slot indices (internal - tailOffset) unchanged.
        "export let small: (Int, Int, Int, Int) = state(slice(big, 50, 55))\n" +
        "export let sm0: Int = get(slice(big, 50, 55), 0)\n" +
        "export let sm4: Int = get(slice(big, 50, 55), 4)\n" +
        "export let smn: Int = size(slice(big, 50, 55))\n" +
        // Reuse path. [97, 100): newOff = tailOffset(100) = 96 is the original's,
        // so `root` and `tail` are handed over as-is; then treeEnd 96 <= origin 97
        // collapses to (1, 4, 1, 0), sharing that very tail node — old slot
        // `internal - 96` and new slot `internal - 96 - 0` are the same slot.
        "export let end: (Int, Int, Int, Int) = state(slice(big, 97, 100))\n" +
        "export let en0: Int = get(slice(big, 97, 100), 0)\n" +
        "export let en2: Int = get(slice(big, 97, 100), 2)\n" +
        "export let enn: Int = size(slice(big, 97, 100))\n" +
        // A prepend-built source, whose origin is large: buildDown(100) is
        // (957, 1057, 3, 1056). [10, 20) gives internal [967, 977), newOff =
        // tailOffset(977) = 960, and treeEnd 960 <= origin 967 collapses it to
        // (7, 17, 1, 0) — a height-3 trie reduced to a bare tail node.
        "export let down: (Int, Int, Int, Int) = state(slice(buildDown(100), 10, 20))\n" +
        "export let dn0: Int = get(slice(buildDown(100), 10, 20), 0)\n" +
        "export let dn9: Int = get(slice(buildDown(100), 10, 20), 9)\n",
    );
    expect(m.small).toEqual([18, 23, 1, 0]);
    expect(m.sm0).toBe(51);
    expect(m.sm4).toBe(55);
    expect(m.smn).toBe(5);
    expect(m.end).toEqual([1, 4, 1, 0]);
    expect(m.en0).toBe(98);
    expect(m.en2).toBe(100);
    expect(m.enn).toBe(3);
    expect(m.down).toEqual([7, 17, 1, 0]);
    expect(m.dn0).toBe(11);
    expect(m.dn9).toBe(20);
  });

  test("§6 slicing an already-trimmed window trims again from its own root", async () => {
    const m = await runTrie(
      BUILD +
        "let big = buildTo(100)\n" +
        "let tall = buildTo(1100)\n" +
        // slice(big, 40, 90) is (8, 58, 1, 32). Slicing [10, 20) of *that* gives
        // internal [18, 28) with newOff = tailOffset(28) = 0, so the tail is
        // rebuilt at slots 18..27 from the window's own leaf, and treeEnd 0 <=
        // origin 18 collapses -> (18, 28, 1, 0). The second slice reads through
        // the first's trimmed root, not the original's.
        "let inner = slice(slice(big, 40, 90), 10, 20)\n" +
        "export let innerState: (Int, Int, Int, Int) = state(inner)\n" +
        "export let in0: Int = get(inner, 0)\n" +
        "export let in9: Int = get(inner, 9)\n" +
        "export let inn: Int = size(inner)\n" +
        // slice(tall, 100, 900) is (100, 900, 2, 896). Slicing [0, 700) of it is
        // internal [100, 800), newOff = tailOffset(800) = 768; the tree range
        // [100, 768) straddles (100/32 = 3, 767/32 = 23), so this one does not
        // trim — a second slice is not obliged to shrink, only permitted to.
        "let outer = slice(slice(tall, 100, 900), 0, 700)\n" +
        "export let outerState: (Int, Int, Int, Int) = state(outer)\n" +
        "export let ou0: Int = get(outer, 0)\n" +
        "export let ou699: Int = get(outer, 699)\n" +
        "export let oun: Int = size(outer)\n",
    );
    expect(m.innerState).toEqual([18, 28, 1, 0]);
    expect(m.in0).toBe(51);
    expect(m.in9).toBe(60);
    expect(m.inn).toBe(10);
    expect(m.outerState).toEqual([100, 800, 2, 768]);
    expect(m.ou0).toBe(101);
    expect(m.ou699).toBe(800);
    expect(m.oun).toBe(700);
  });

  test("§5.4 get and set on a trimmed window reach both regions", async () => {
    const m = await runTrie(
      BUILD +
        "let big = buildTo(100)\n" +
        // slice(big, 90, 100) takes the reuse path (newOff 96 is the original's)
        // and trims: tree range [90, 96) is under leaf 2 (both /32 = 2), rebase 64
        // -> (26, 36, 1, 32). Logical 0 is internal 26, in the height-1 tree;
        // logical 9 is internal 35, in the tail.
        "let w = slice(big, 90, 100)\n" +
        "export let wState: (Int, Int, Int, Int) = state(w)\n" +
        "let u = set(set(w, 0, 111), 9, 222)\n" +
        "export let u0: Int = get(u, 0)\n" +
        "export let u1: Int = get(u, 1)\n" +
        "export let u8: Int = get(u, 8)\n" +
        "export let u9: Int = get(u, 9)\n" +
        // The original is untouched: `set` is persistent through the trim too.
        "export let w0: Int = get(w, 0)\n" +
        "export let w9: Int = get(w, 9)\n" +
        // And on the two-level descent, whose root is a leaf two levels down.
        "let t = slice(buildTo(1100), 1050, 1060)\n" +
        "export let t5: Int = get(set(t, 5, 9999), 5)\n" +
        "export let t4: Int = get(set(t, 5, 9999), 4)\n",
    );
    expect(m.wState).toEqual([26, 36, 1, 32]);
    expect(m.u0).toBe(111);
    expect(m.u1).toBe(92);
    expect(m.u8).toBe(99);
    expect(m.u9).toBe(222);
    expect(m.w0).toBe(91);
    expect(m.w9).toBe(100);
    expect(m.t5).toBe(9999);
    expect(m.t4).toBe(1055);
  });

  test("§4 appends onto a collapsed window flush into its own small tree", async () => {
    // slice(buildTo(100), 50, 55) is (18, 23, 1, 0): no tree at all. 21 appends
    // fill the tail to internal 31 (capacity 32, tailOffset still 0, a full tail),
    // the next flushes it as the root leaf — `insertLeaf` at height 1 replacing
    // the empty root — and the rest start a fresh tail, ending at (18, 44, 1, 32).
    // The flushed leaf is the node that already held the window, so the values
    // below the origin ride along dead and the live ones must still read out.
    const m = await runTrie(
      BUILD +
        "let f = appendRange(slice(buildTo(100), 50, 55), 1000, 1020)\n" +
        "export let fState: (Int, Int, Int, Int) = state(f)\n" +
        "export let fn: Int = size(f)\n" +
        "export let f0: Int = get(f, 0)\n" + // internal 18, in the flushed leaf
        "export let f4: Int = get(f, 4)\n" + // internal 22, the window's last
        "export let f5: Int = get(f, 5)\n" + // internal 23, the first append
        "export let f13: Int = get(f, 13)\n" + // internal 31, the last pre-flush slot
        "export let f14: Int = get(f, 14)\n" + // internal 32, first of the fresh tail
        "export let f25: Int = get(f, 25)\n",
    );
    expect(m.fState).toEqual([18, 44, 1, 32]);
    expect(m.fn).toBe(26);
    expect(m.f0).toBe(51);
    expect(m.f4).toBe(55);
    expect(m.f5).toBe(1000);
    expect(m.f13).toBe(1008);
    expect(m.f14).toBe(1009);
    expect(m.f25).toBe(1020);
  });

  test("§4 concat and nodeRun still walk a trimmed window by node", async () => {
    const m = await runTrie(
      BUILD + WALK +
        "let big = buildTo(100)\n" +
        // Left is (8, 58, 1, 32), right is (0, 10, 1, 0) — both trimmed, and
        // disjoint in value. `concat` appends 10 elements onto the left: six fill
        // its tail (capacity 64, tail full at 32). The seventh finds it full, so
        // it flushes the tail as a leaf — which fills the height-1 root, and
        // `flushLeaf` grows a level — and seeds the fresh tail with that seventh
        // value; the last three follow it there, leaving four in the tail at
        // (8, 68, 2, 64). `nodeRun` must report runs over that new shape.
        "let cc = concat(slice(big, 40, 90), slice(big, 0, 10))\n" +
        "export let ccState: (Int, Int, Int, Int) = state(cc)\n" +
        "export let ccn: Int = size(cc)\n" +
        "export let cc0: Int = get(cc, 0)\n" +
        "export let cc49: Int = get(cc, 49)\n" + // last of the left window
        "export let cc50: Int = get(cc, 50)\n" + // first of the right window
        "export let cc59: Int = get(cc, 59)\n" +
        "export let ccWalk: (Int, Int) = walk(cc)\n" +
        // The trimmed windows themselves: [40, 90) walks its leaf residue (24) and
        // then its tail (26) — 2 descents for 50 elements; the two-level descent
        // walks 6 then 4.
        "export let midWalk: (Int, Int) = walk(slice(big, 40, 90))\n" +
        "export let twoWalk: (Int, Int) = walk(slice(buildTo(1100), 1050, 1060))\n",
    );
    const sumBetween = (lo: number, hi: number) =>
      ((lo + hi) * (hi - lo + 1)) / 2;
    expect(m.ccState).toEqual([8, 68, 2, 64]);
    expect(m.ccn).toBe(60);
    expect(m.cc0).toBe(41);
    expect(m.cc49).toBe(90);
    expect(m.cc50).toBe(1);
    expect(m.cc59).toBe(10);
    expect(m.ccWalk).toEqual([3, sumBetween(41, 90) + sumBetween(1, 10)]);
    expect(m.midWalk).toEqual([2, sumBetween(41, 90)]);
    expect(m.twoWalk).toEqual([2, sumBetween(1051, 1060)]);
  });
});

describe("VectorTrie nodeRun (§4 sequential reading)", () => {
  /**
   * `nodeRun` is what makes a whole-vector traversal O(n): it answers with the
   * leaf `Node` holding an index *and how far that leaf reaches*, so a walker
   * descends once per node rather than once per element. The emitted
   * `[Symbol.iterator]` is that walk, and this is the pin under it.
   *
   * The count is exact and checkable, which is why it is asserted rather than
   * timed: a walk of `n` elements makes exactly `ceil(n / 32)` calls when every
   * region is full, and one more only where a region boundary splits a node.
   * An implementation that answered with a run of 1 — correct, and quietly
   * O(n log32 n) — would report `n` here.
   */
  test("a full walk descends once per node, not once per element", async () => {
    const m = await runTrie(
      BUILD + WALK +
        "export let tiny: (Int, Int) = walk(buildTo(5))\n" +
        "export let exact: (Int, Int) = walk(buildTo(32))\n" +
        "export let overflowing: (Int, Int) = walk(buildTo(33))\n" +
        "export let hundred: (Int, Int) = walk(buildTo(100))\n" +
        "export let tall: (Int, Int) = walk(buildTo(1100))\n" +
        "export let blank: (Int, Int) = walk(empty)\n",
    );
    const sum = (n: number) => (n * (n + 1)) / 2;
    // Append-built vectors are left-packed, so every run is a full node except
    // the last: exactly ceil(n / 32) descents.
    expect(m.tiny).toEqual([1, sum(5)]);
    expect(m.exact).toEqual([1, sum(32)]);
    expect(m.overflowing).toEqual([2, sum(33)]);
    expect(m.hundred).toEqual([4, sum(100)]);
    expect(m.tall).toEqual([35, sum(1100)]);
    expect(m.blank).toEqual([0, 0]);
  });

  test("a windowed or prepend-built trie still walks by node", async () => {
    const m = await runTrie(
      BUILD + WALK +
        // Prepend-built: the front sits mid-node, so the first run is partial
        // and every later one is full — 100 elements over 5 descents, not 4.
        "export let fronted: (Int, Int) = walk(buildDown(100))\n" +
        // A window whose origin is mid-node: same shape, offset elsewhere. The
        // trim leaves it (8, 58, height 1, 32), so the two runs are its leaf
        // residue and its tail.
        "export let windowed: (Int, Int) = walk(slice(buildTo(100), 40, 90))\n" +
        // Wholly inside the tail — one descent, and after the collapse there is
        // no tree left to descend at all.
        "export let inTail: (Int, Int) = walk(slice(buildTo(100), 50, 55))\n",
    );
    const sumBetween = (lo: number, hi: number) =>
      ((lo + hi) * (hi - lo + 1)) / 2;
    expect((m.fronted as number[])[1]).toBe(sumBetween(1, 100));
    expect((m.fronted as number[])[0]).toBeLessThanOrEqual(5);
    expect((m.windowed as number[])[1]).toBe(sumBetween(41, 90));
    expect((m.windowed as number[])[0]).toBeLessThanOrEqual(3);
    expect(m.inTail).toEqual([1, sumBetween(51, 55)]);
  });
});

describe("VectorTrie prepend after slice (§4 states only slice can reach)", () => {
  // Prepend onto a nonzero origin is unreachable by building alone: appends hold
  // origin fixed and prepends drive it downward from a level's top slot, so the
  // arms that meet an origin left *mid-structure* by something else are a slice's
  // to reach. Since the trim, a non-collapsed window always has
  // `origin < tailOffset(capacity)` — the descent stops at the smallest covering
  // root, whose tree range still contains the origin — and a collapsed one always
  // has `tailOffset(capacity) == 0`, its capacity being 1..32. So prepend's tail
  // branch (`newOrigin >= off`) is now reached only with `off == 0`, and each test
  // below states the state family it lands in rather than the one a window used
  // to have.
  test("§4 the tail branch of prepend (a collapsed window with origin > 0)", async () => {
    // slice(buildTo(100), 50, 55) collapses to (18, 23, height 1, tailOffset 0):
    // the whole window is tail-resident and the tree was dropped. prepend sees
    // origin 18 > 0 and newOrigin 17 >= off 0, so it writes tail slot 17.
    const m = await runTrie(
      BUILD +
        "let w = slice(buildTo(100), 50, 55)\n" +
        "export let wState: (Int, Int, Int, Int) = state(w)\n" +
        "let v = prepend(w, 999)\n" +
        "export let vState: (Int, Int, Int, Int) = state(v)\n" +
        "export let s: Int = size(v)\n" +
        "export let e0: Int = get(v, 0)\n" +
        "export let e1: Int = get(v, 1)\n" +
        "export let e5: Int = get(v, 5)\n",
    );
    expect(m.wState).toEqual([18, 23, 1, 0]);
    expect(m.vState).toEqual([17, 23, 1, 0]);
    expect(m.s).toBe(6);
    expect(m.e0).toBe(999);
    expect(m.e1).toBe(51);
    expect(m.e5).toBe(55);
  });

  test("§4 prepends exhaust a collapsed window's tail and force a left regrow", async () => {
    // From (18, 23, 1, 0), 18 prepends walk origin down to 0 through the tail.
    // The 19th has no headroom, so it grows a level at the left: span = 32^1 = 32,
    // the (empty) root drops into slot 1, and origin/capacity rebase by 32 to give
    // (31, 55, height 2, tailOffset 32) — the front now sits in the tree, and the
    // tail's slots are unmoved because 32 is a multiple of radix. The 20th writes
    // internal 30 < 32, so it descends: root childPos 30 != span - 1, meaning it
    // must read the child the 19th just created. Ending state (30, 55, 2, 32).
    const m = await runTrie(
      BUILD +
        "let v = prependN(slice(buildTo(100), 50, 55), 20)\n" +
        "export let vState: (Int, Int, Int, Int) = state(v)\n" +
        "export let s: Int = size(v)\n" +
        "export let e0: Int = get(v, 0)\n" + // final front = 2000 - 20
        "export let e19: Int = get(v, 19)\n" +
        "export let e20: Int = get(v, 20)\n" + // start of the original window
        "export let e24: Int = get(v, 24)\n",
    );
    expect(m.vState).toEqual([30, 55, 2, 32]);
    expect(m.s).toBe(25);
    expect(m.e0).toBe(1980);
    expect(m.e19).toBe(1999);
    expect(m.e20).toBe(51);
    expect(m.e24).toBe(55);
  });

  test("§4 the tree branch of prepend: a leaf slot, a fresh child, an existing child", async () => {
    // Three windows, three arms of the write, each derived from its own state.
    //
    // (a) slice(buildTo(100), 40, 90) trims to (8, 58, height 1, 32). newOrigin 7
    //     is below the offset, so it descends — onto a `Leaf` root, where the
    //     write is the slot directly. Slot 7 held internal 39 (value 40), dead
    //     below the window, and is overwritten.
    //
    // (b) slice(buildTo(100), 32, 100) takes the reuse path (newOff 96 is the
    //     original's) and does *not* trim: its tree range [32, 96) straddles
    //     leaves 1 and 2, leaving (32, 100, height 2, 96). newOrigin 31 gives
    //     childIndex 0 and childPos 31 == span - 1, the fresh-child arm — so the
    //     stale shared leaf 0 (values 1..32, all below the window) is discarded
    //     rather than read, which is exactly what that arm is for.
    //
    // (c) slice(buildTo(1100), 1050, 1090) also takes the reuse path (newOff 1088)
    //     and then trims one level: tree range [1050, 1088) is under top child 1,
    //     rebase 1024 -> (26, 66, height 2, 64), where [26, 64) straddles and the
    //     descent stops. newOrigin 25 gives childIndex 0 and childPos 25 !=
    //     span - 1, so the write must READ the existing child 0 — the arm an
    //     absent-child read would crash on.
    const m = await runTrie(
      BUILD +
        "let a = slice(buildTo(100), 40, 90)\n" +
        "export let aState: (Int, Int, Int, Int) = state(a)\n" +
        "let ap = prepend(a, 777)\n" +
        "export let apState: (Int, Int, Int, Int) = state(ap)\n" +
        "export let as: Int = size(ap)\n" +
        "export let a0: Int = get(ap, 0)\n" +
        "export let a1: Int = get(ap, 1)\n" +
        "export let a50: Int = get(ap, 50)\n" +
        "let b = slice(buildTo(100), 32, 100)\n" +
        "export let bState: (Int, Int, Int, Int) = state(b)\n" +
        "let bp = prepend(b, 888)\n" +
        "export let bpState: (Int, Int, Int, Int) = state(bp)\n" +
        "export let bs: Int = size(bp)\n" +
        "export let b0: Int = get(bp, 0)\n" +
        "export let b1: Int = get(bp, 1)\n" +
        "export let b68: Int = get(bp, 68)\n" +
        "let c = slice(buildTo(1100), 1050, 1090)\n" +
        "export let cState: (Int, Int, Int, Int) = state(c)\n" +
        "let cp = prepend(c, 999)\n" +
        "export let cpState: (Int, Int, Int, Int) = state(cp)\n" +
        "export let cs: Int = size(cp)\n" +
        "export let c0: Int = get(cp, 0)\n" +
        "export let c1: Int = get(cp, 1)\n" +
        "export let c40: Int = get(cp, 40)\n",
    );
    expect(m.aState).toEqual([8, 58, 1, 32]);
    expect(m.apState).toEqual([7, 58, 1, 32]);
    expect(m.as).toBe(51);
    expect(m.a0).toBe(777);
    expect(m.a1).toBe(41);
    expect(m.a50).toBe(90);
    expect(m.bState).toEqual([32, 100, 2, 96]);
    expect(m.bpState).toEqual([31, 100, 2, 96]);
    expect(m.bs).toBe(69);
    expect(m.b0).toBe(888);
    expect(m.b1).toBe(33);
    expect(m.b68).toBe(100);
    expect(m.cState).toEqual([26, 66, 2, 64]);
    expect(m.cpState).toEqual([25, 66, 2, 64]);
    expect(m.cs).toBe(41);
    expect(m.c0).toBe(999);
    expect(m.c1).toBe(1051);
    expect(m.c40).toBe(1090);
  });

  test("§4 tail-resident boundary slices of a prepend-built height-3 trie", async () => {
    // buildDown(60) is (997, 1057, height 3, tailOffset 1056): a left-grown trie
    // with a partially-populated left child. Both windows below are wholly
    // tail-resident, so the trim collapses them and the partial child — most of
    // it dead headroom — is released rather than carried.
    //
    // [27, 40) is internal [1024, 1037); newOff = tailOffset(1037) = 1024, so the
    // tail is rebuilt at slots 0..12 and treeEnd 1024 <= origin 1024 collapses to
    // (0, 13, 1, 0). [59, 60) is internal [1056, 1057), which is the reuse path
    // (newOff 1056 is the original's) and collapses to (0, 1, 1, 0), sharing that
    // tail node. Both then have origin 0, so prepend takes the left-grow arm:
    // span 32, the empty root into slot 1, and a fresh spine written at
    // newOrigin = span - 1 = 31.
    const m = await runTrie(
      BUILD +
        "export let source: (Int, Int, Int, Int) = state(buildDown(60))\n" +
        "let cw = slice(buildDown(60), 27, 40)\n" + // window 28..40
        "export let cwState: (Int, Int, Int, Int) = state(cw)\n" +
        "let c = prepend(cw, 888)\n" +
        "export let cState: (Int, Int, Int, Int) = state(c)\n" +
        "export let cs: Int = size(c)\n" +
        "export let c0: Int = get(c, 0)\n" +
        "export let c1: Int = get(c, 1)\n" +
        "export let c13: Int = get(c, 13)\n" +
        "let dw = slice(buildDown(60), 59, 60)\n" + // window [60]
        "export let dwState: (Int, Int, Int, Int) = state(dw)\n" +
        "let d = prepend(dw, 777)\n" +
        "export let dState: (Int, Int, Int, Int) = state(d)\n" +
        "export let ds: Int = size(d)\n" +
        "export let d0: Int = get(d, 0)\n" +
        "export let d1: Int = get(d, 1)\n",
    );
    expect(m.source).toEqual([997, 1057, 3, 1056]);
    expect(m.cwState).toEqual([0, 13, 1, 0]);
    expect(m.cState).toEqual([31, 45, 2, 32]);
    expect(m.cs).toBe(14);
    expect(m.c0).toBe(888);
    expect(m.c1).toBe(28);
    expect(m.c13).toBe(40);
    expect(m.dwState).toEqual([0, 1, 1, 0]);
    expect(m.dState).toEqual([31, 33, 2, 32]);
    expect(m.ds).toBe(2);
    expect(m.d0).toBe(777);
    expect(m.d1).toBe(60);
  });
});
