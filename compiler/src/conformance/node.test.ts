import { describe, expect, test } from "vitest";

import * as Source from "../support/source.js";
import { lex } from "../passes/lexer/lexer.js";
import { applyLayout } from "../passes/layout/layout.js";
import { parse } from "../passes/parser/parser.js";
import { resolve } from "../passes/resolver/resolver.js";
import { check } from "../passes/checker/checker.js";
import { elaborate } from "../passes/elaborator/elaborator.js";
import { emitJavaScript } from "../passes/emitter/emitter.js";

/**
 * Behavioural conformance for the hidden `Node` trie intrinsic (persistent-
 * collections design note §4): a fixed-32, immutable, runtime-private array node
 * with `empty`/`get`/`set`/`copy`, addressed 0..31. Assertions are on the results
 * of the operations — persistence, copy-on-write, slot independence — and on the
 * visibility gate: `Node` is nameable only inside a privileged runtime module.
 *
 * This is milestone 1 of the trie arc; the `.hex` trie over `Node` and the rewire
 * of `Vector`'s emission come next. The plain-array `Vector` backing is untouched,
 * so the Vector conformance gate stays green throughout.
 */

/** Compiles one privileged runtime module and executes its exports. */
async function runRuntime(source: string): Promise<Record<string, unknown>> {
  const file = new Source.File(Source.fileId(0), "/runtime.hex", source);
  const resolved = resolve(parse(applyLayout(lex(file))), { runtime: true });
  expect(resolved.diagnostics).toEqual([]);
  const typed = check(resolved);
  expect(typed.diagnostics).toEqual([]);
  const javascript = emitJavaScript(elaborate(typed));
  expect(javascript.diagnostics).toEqual([]);
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(javascript.text)}`;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

/** The diagnostic messages a source produces, resolved with the given options. */
function diagnose(source: string, options: { readonly runtime?: boolean } = {}): readonly string[] {
  const file = new Source.File(Source.fileId(0), "/runtime.hex", source);
  // The checker carries resolver diagnostics forward, so `typed.diagnostics` is
  // the union of both phases.
  return check(resolve(parse(applyLayout(lex(file))), options)).diagnostics.map((d) => d.message);
}

describe("Node intrinsic conformance", () => {
  test("§4 get reads back what set wrote, across the whole 0..31 range", async () => {
    const m = await runRuntime(
      "fun build(): Int =\n" +
        "    let a = Node.set(Node.empty(), 0, 10)\n" +
        "    let b = Node.set(a, 5, 20)\n" +
        "    let c = Node.set(b, 31, 30)\n" +
        "    Node.get(c, 0) + Node.get(c, 5) + Node.get(c, 31)\n" +
        "export let sum: Int = build()\n" +
        "export let first: Int = Node.get(Node.set(Node.empty(), 0, 7), 0)\n" +
        "export let last: Int = Node.get(Node.set(Node.empty(), 31, 9), 31)\n",
    );
    expect(m.sum).toBe(60);
    expect(m.first).toBe(7);
    expect(m.last).toBe(9);
  });

  test("§5.1 set is immutable: the input node is never mutated", async () => {
    const m = await runRuntime(
      "fun persists(): Bool =\n" +
        "    let base = Node.set(Node.empty(), 0, 1)\n" +
        "    let derived = Node.set(base, 0, 999)\n" +
        "    Node.get(base, 0) == 1 and Node.get(derived, 0) == 999\n" +
        "fun neighbours(): Bool =\n" +
        "    let base = Node.set(Node.set(Node.empty(), 3, 30), 4, 40)\n" +
        "    let updated = Node.set(base, 3, 99)\n" +
        "    Node.get(updated, 3) == 99 and Node.get(updated, 4) == 40 and Node.get(base, 3) == 30\n" +
        "export let immutable: Bool = persists()\n" +
        "export let intact: Bool = neighbours()\n",
    );
    expect(m.immutable).toBe(true);
    expect(m.intact).toBe(true);
  });

  test("§4 copy clones a node whose slots move independently of the origin", async () => {
    const m = await runRuntime(
      "fun clones(): Bool =\n" +
        "    let base = Node.set(Node.empty(), 3, 7)\n" +
        "    let clone = Node.copy(base)\n" +
        "    let changed = Node.set(clone, 3, 8)\n" +
        "    Node.get(base, 3) == 7 and Node.get(clone, 3) == 7 and Node.get(changed, 3) == 8\n" +
        "export let independent: Bool = clones()\n",
    );
    expect(m.independent).toBe(true);
  });

  test("emits raw array operations and the copy-on-write helper", async () => {
    const file = new Source.File(
      Source.fileId(0),
      "/runtime.hex",
      "export let one: Int = Node.get(Node.copy(Node.set(Node.empty(), 0, 1)), 0)\n",
    );
    const javascript = emitJavaScript(
      elaborate(check(resolve(parse(applyLayout(lex(file))), { runtime: true }))),
    );
    expect(javascript.diagnostics).toEqual([]);
    expect(javascript.text).toContain("new Array(32)");
    expect(javascript.text).toMatch(/\.slice\(\)/u);
    expect(javascript.text).toMatch(/function \w*nodeSet/u);
  });
});

describe("Node intrinsic visibility gate", () => {
  test("`Node` is an unknown name in ordinary (non-runtime) modules", () => {
    const file = new Source.File(
      Source.fileId(0),
      "/main.hex",
      "export let leak: Int = Node.get(Node.empty(), 0)\n",
    );
    const resolved = resolve(parse(applyLayout(lex(file))));
    expect(resolved.diagnostics.length).toBeGreaterThan(0);
    expect(resolved.diagnostics.some((d) => /Node/u.test(d.message))).toBe(true);
  });
});

/**
 * `Node` deliberately has no `Eq`/`Show`/`Hash`/`Iterable` instance and is
 * unspellable in a type annotation, so a `Node` value can never reach the
 * emitter's structural machinery or cross a module/export boundary. Those doors
 * are the only guard: the derived-instance emitters fall back *silently* (hash
 * to `0`, equals to `===`), so a future checker change that let a `Node` slip
 * through would miscompile with no error. These cases pin every door shut, even
 * inside a privileged runtime module where `Node` is otherwise in scope.
 */
describe("Node intrinsic contract (leak-proof rejections)", () => {
  test("`Node` has no `Eq` instance", () => {
    const messages = diagnose("export let leak: Bool = Node.empty() == Node.empty()\n", { runtime: true });
    expect(messages.some((m) => m.includes("Node") && m.includes("`Eq` instance"))).toBe(true);
  });

  test("`Node` has no `Show` instance", () => {
    const messages = diagnose('export let s: String = "${Node.empty()}"\n', { runtime: true });
    expect(messages.some((m) => m.includes("Node") && m.includes("`Show` instance"))).toBe(true);
  });

  test("`Node` has no `Hash` instance", () => {
    const messages = diagnose("export let h: Int = hash(Node.set(Node.empty(), 0, 1))\n", { runtime: true });
    expect(messages.some((m) => m.includes("Node") && m.includes("`Hash` instance"))).toBe(true);
  });

  test("`Node` has no `Iterable` instance", () => {
    const messages = diagnose(
      "fun count(): Int =\n" +
        "    var total = 0\n" +
        "    for x in Node.empty()\n" +
        "        total := total + 1\n" +
        "    total\n" +
        "export let z: Int = count()\n",
      { runtime: true },
    );
    expect(messages.some((m) => m.includes("Node") && m.includes("`Iterable` instance"))).toBe(true);
  });

  test("a `Node` value cannot be exported: every export door needs a spellable type", () => {
    const messages = diagnose("export let n = Node.set(Node.empty(), 0, 7)\n", { runtime: true });
    expect(messages.some((m) => m.includes("requires a type annotation"))).toBe(true);
  });

  test("`Node` is unspellable in a type annotation, even in a runtime module", () => {
    // The safety net for milestone 2: when `Node(a)` annotation syntax is wired,
    // it must stay `runtime`-gated and excluded from exported signatures, or this
    // — the last thing keeping a `Node` from crossing a boundary — comes undone.
    const messages = diagnose("export fun f(n: Node(Int)): Int = Node.get(n, 0)\n", { runtime: true });
    expect(messages.some((m) => m.includes("Node"))).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
  });
});
