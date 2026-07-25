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
 * built over the hidden `Node` intrinsic. This slab is the *build* path: `append`
 * lands elements in the tail buffer for amortized O(1), and flushes a full tail
 * into the trie as one leaf — growing the trie a level when it fills. Vectors are
 * built by repeated `append` (the spec-blessed `for i in 1..n` + `var`/`:=`
 * accumulate) and read back with `get`/`size`, straddling the 32 and 32² = 1024
 * branch boundaries so a real trie's tail flush and level growth are exercised.
 * Nothing here touches `Vector`'s emission, so the Vector gate stays green.
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
    const m = await runTrie(
      BUILD +
        "let big = buildTo(1056)\n" +
        "export let s1056: Int = size(big)\n" +
        "export let b0: Int = get(big, 0)\n" +
        "export let b1000: Int = get(big, 1000)\n" +
        "export let b1023: Int = get(big, 1023)\n" + // last of the height-2 fill
        "export let b1024: Int = get(big, 1024)\n" + // first after growth to height 3
        "export let b1055: Int = get(big, 1055)\n", // final element (in the tail)
    );
    expect(m.s1056).toBe(1056);
    expect(m.b0).toBe(1);
    expect(m.b1000).toBe(1001);
    expect(m.b1023).toBe(1024);
    expect(m.b1024).toBe(1025);
    expect(m.b1055).toBe(1056);
  });
});
