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
 * built over the hidden `Node` intrinsic. This first slab is the *read* path —
 * `size`/`isEmpty`/`get` over a hand-built trie — proving `.hex` logic descends a
 * real multi-level 32-way trie via `Int.div`/`Int.mod`. The build path (append,
 * the tail buffer, `fromSeq`) and the origin/capacity deque follow in later
 * increments; nothing here touches `Vector`'s emission, so the Vector gate stays
 * green.
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

// Hand-built tries (the append builder is a later increment). A height-1 trie is
// a single leaf of up to 32 values; a height-2 trie is a branch of leaves.
const LEAF3 =
  "let leaf3: Tree(Int) = Leaf(Node.set(Node.set(Node.set(Node.empty(), 0, 10), 1, 20), 2, 30))\n" +
  "let v3: TrieVector(Int) = TrieVector({count: 3, height: 1, root: leaf3})\n";
const BRANCH33 =
  "let leafA: Tree(Int) = Leaf(Node.set(Node.set(Node.empty(), 0, 100), 1, 101))\n" +
  "let leafB: Tree(Int) = Leaf(Node.set(Node.empty(), 0, 132))\n" +
  "let branch: Tree(Int) = Branch(Node.set(Node.set(Node.empty(), 0, leafA), 1, leafB))\n" +
  "let v33: TrieVector(Int) = TrieVector({count: 33, height: 2, root: branch})\n";

describe("VectorTrie read path", () => {
  test("§7 size and isEmpty read the count field", async () => {
    const m = await runTrie(
      LEAF3 +
        "let vEmpty: TrieVector(Int) = TrieVector({count: 0, height: 1, root: Leaf(Node.empty())})\n" +
        "export let s3: Int = size(v3)\n" +
        "export let emptyTrue: Bool = isEmpty(vEmpty)\n" +
        "export let emptyFalse: Bool = isEmpty(v3)\n",
    );
    expect(m.s3).toBe(3);
    expect(m.emptyTrue).toBe(true);
    expect(m.emptyFalse).toBe(false);
  });

  test("§5 get reads every slot of a height-1 leaf", async () => {
    const m = await runTrie(
      LEAF3 +
        "export let g0: Int = get(v3, 0)\n" +
        "export let g1: Int = get(v3, 1)\n" +
        "export let g2: Int = get(v3, 2)\n",
    );
    expect(m.g0).toBe(10);
    expect(m.g1).toBe(20);
    expect(m.g2).toBe(30);
  });

  test("§5 get descends a height-2 branch across the 32-slot boundary", async () => {
    const m = await runTrie(
      BRANCH33 +
        "export let s33: Int = size(v33)\n" +
        "export let b0: Int = get(v33, 0)\n" +
        "export let b1: Int = get(v33, 1)\n" +
        "export let b32: Int = get(v33, 32)\n",
    );
    expect(m.s33).toBe(33);
    expect(m.b0).toBe(100);
    expect(m.b1).toBe(101);
    expect(m.b32).toBe(132); // first element of the second leaf
  });

  test("§5 get descends a height-3 trie across the 32-squared boundary", async () => {
    // Two branch levels: root -> branch -> leaf. Element 0 lives under the root's
    // first child; element 1024 (= 32²) under its second, exercising both digits
    // of the index at both levels.
    const m = await runTrie(
      "let leafLow: Tree(Int) = Leaf(Node.set(Node.empty(), 0, 7000))\n" +
        "let branchLow: Tree(Int) = Branch(Node.set(Node.empty(), 0, leafLow))\n" +
        "let leafHigh: Tree(Int) = Leaf(Node.set(Node.empty(), 0, 9000))\n" +
        "let branchHigh: Tree(Int) = Branch(Node.set(Node.empty(), 0, leafHigh))\n" +
        "let root3: Tree(Int) = Branch(Node.set(Node.set(Node.empty(), 0, branchLow), 1, branchHigh))\n" +
        "let v1025: TrieVector(Int) = TrieVector({count: 1025, height: 3, root: root3})\n" +
        "export let d0: Int = get(v1025, 0)\n" +
        "export let d1024: Int = get(v1025, 1024)\n",
    );
    expect(m.d0).toBe(7000);
    expect(m.d1024).toBe(9000); // crossed both branch levels
  });
});
