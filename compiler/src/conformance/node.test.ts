import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";
import trieSource from "../../../stdlib/Runtime/VectorTrie.hex?raw";

import * as Source from "../support/source.js";
import { lex } from "../passes/lexer/lexer.js";
import { applyLayout } from "../passes/layout/layout.js";
import { parse } from "../passes/parser/parser.js";
import { resolve } from "../passes/resolver/resolver.js";
import { check } from "../passes/checker/checker.js";
import { elaborate } from "../passes/elaborator/elaborator.js";
import { emitJavaScript, emitTypeScriptPreview } from "../passes/emitter/emitter.js";

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

/**
 * ## How a specimen becomes a privileged runtime module
 *
 * By being one — there is no other route since #829, and in particular no path
 * a host can name. A project's own file at a runtime member's **basename**
 * declaring the member's **name** is adopted as that member; everything else is
 * an ordinary module. So a `Node` specimen here is `stdlib/Runtime/VectorTrie.hex`'s
 * own text with the specimen appended, filed at `/VectorTrie.hex`: the trie is
 * the module `Runtime.VectorTrie` *is*, and the specimen rides in it.
 *
 * Appending to the real source rather than stubbing it is not ceremony. The
 * emitter writes this module's JavaScript export list from a fixed inventory
 * (`VECTOR_RUNTIME_OPERATIONS`) and reports an operation the module does not
 * declare, so a specimen alone in the seat would draw a diagnostic that has
 * nothing to do with `Node`.
 */
const RUNTIME_PATH = "/VectorTrie.hex";

/**
 * One ordinary module with one vector in it, so the adopted trie is reached and
 * emitted (a runtime module serving nothing is emitted nowhere). Nothing here is
 * under test; it exists to be an importer.
 */
const TOUCH: readonly [string, string] = [
  "/Main.hex",
  "module Main\n\nlet sample: Vector(Int) = [1]\nexport let touched: Bool = Vector.isEmpty(sample)\n",
];

/**
 * Compiles one privileged runtime module and executes its exports. Through the
 * whole project: a runtime module still sees the prelude, and since #147 that is
 * what lets it name `Bool` at all.
 */
async function runRuntime(source: string): Promise<Record<string, unknown>> {
  return runProject(
    [[RUNTIME_PATH, `${trieSource}\n${source}`], TOUCH],
    { entry: RUNTIME_PATH },
  );
}

/**
 * The diagnostic messages a source produces. `runtime: true` puts the specimen
 * inside the adopted runtime member; without it the specimen is an ordinary
 * module of the project, which is the whole of the visibility gate.
 */
function diagnose(source: string, options: { readonly runtime?: boolean } = {}): readonly string[] {
  return compileFiles(
    options.runtime === true
      ? [[RUNTIME_PATH, `${trieSource}\n${source}`]]
      : [["/Ordinary.hex", "module Ordinary\n\n" + source]],
  ).diagnostics.map(({ message }) => message);
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

  // Through the project, not the bare passes: the module's `Int` literals need
  // `stdlib/Int.hex`'s `Num<Int>` since #344, exactly as its `Bool` needed
  // `stdlib/Bool.hex` since #147.
  test("emits raw array operations and the copy-on-write helper", () => {
    const project = compileFiles([
      [RUNTIME_PATH, `${trieSource}\n` +
        "export let one: Int = Node.get(Node.copy(Node.set(Node.empty(), 0, 1)), 0)\n"],
      TOUCH,
    ]);
    expect(project.diagnostics).toEqual([]);
    const text = project.modules
      .find(({ source }) => source.path === RUNTIME_PATH)!.javascript.text;
    expect(text).toContain("new Array(32)");
    expect(text).toMatch(/\.slice\(\)/u);
    expect(text).toMatch(/function \w*nodeSet/u);
  });
});

describe("Node intrinsic visibility gate", () => {
  test("`Node` is an unknown name in ordinary (non-runtime) modules", () => {
    const file = new Source.File(
      Source.fileId(0),
      "/main.hex",
      "module Main\n\n" + "export let leak: Int = Node.get(Node.empty(), 0)\n",
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
    const messages = diagnose("export let h: Int = Hash.hash(Node.set(Node.empty(), 0, 1))\n", { runtime: true });
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

  test("`Node(a)` is unspellable in ordinary (non-runtime) modules", () => {
    const messages = diagnose("fun f(n: Node(Int)): Int = 0\n");
    expect(messages.some((m) => m.includes("unknown generic type") && m.includes("Node"))).toBe(true);
  });

  test("an exported signature may not name `Node`, even in a runtime module", () => {
    const messages = diagnose("export fun f(n: Node(Int)): Int = Node.get(n, 0)\n", { runtime: true });
    expect(messages.some((m) => m.includes("Node") && m.includes("no public form"))).toBe(true);
  });

  test("an exported union with a `Node`-typed slot is rejected", () => {
    // The exported constructor `Pack` would be a JS-callable function taking a
    // forgeable array, and `Node(a)` would render as `Array<a>` in the `.d.ts`.
    // The blessed shape keeps the union private (see below). The names are the
    // specimen's own rather than the trie's, because the specimen is compiled
    // *inside* `stdlib/Runtime/VectorTrie.hex`, which declares a `Tree` already.
    const messages = diagnose(
      "export union Bag(a) =\n" +
        "    | Pack(values: Node(a))\n" +
        "    | Fan(children: Node(Bag(a)))\n",
      { runtime: true },
    );
    expect(messages.some((m) => m.includes("union `Bag`") && m.includes("no public form"))).toBe(true);
  });

  test("an exported exception with a `Node`-typed slot is rejected", () => {
    const messages = diagnose("export exception Corrupt(node: Node(Int))\n", { runtime: true });
    expect(messages.some((m) => m.includes("exception `Corrupt`") && m.includes("no public form"))).toBe(true);
  });

  test("an exported type alias may not name `Node`, but a private one is fine", () => {
    const exported = diagnose("export type Slots = Node(Int)\n", { runtime: true });
    expect(exported.some((m) => m.includes("type alias `Slots`") && m.includes("no public form"))).toBe(true);
    // A private alias is useful internal shorthand for the trie; every leak path
    // *from* it (a slot or a signature that uses it) is caught after inlining.
    const private_ = diagnose(
      "type IntSlots = Node(Int)\n" +
        "fun firstSlot(node: IntSlots): Int = Node.get(node, 0)\n" +
        "export let first: Int = firstSlot(Node.set(Node.empty(), 0, 5))\n",
      { runtime: true },
    );
    expect(private_).toEqual([]);
  });

  test("an extern declaration may not name `Node` (the foreign boundary)", () => {
    const messages = diagnose(
      "extern from \"host\"\n    fun sink(node: Node(Int)): Unit\n",
      { runtime: true },
    );
    expect(messages.some((m) => m.includes("extern") && m.includes("Node"))).toBe(true);
  });

  test("the blessed shape: private `Tree`/`Node` internals behind public-typed exports", () => {
    // What the real trie uses — the union and `Node` live entirely inside the
    // module; the exported signatures are public-typed (here `Int`).
    const messages = diagnose(
      "union Bag(a) =\n" +
        "    | Pack(values: Node(a))\n" +
        "    | Fan(children: Node(Bag(a)))\n" +
        "fun packHead(bag: Bag(Int)): Int = match bag\n" +
        "    Pack(values) => Node.get(values, 0)\n" +
        "    Fan(_) => 0 - 1\n" +
        "export fun demo(): Int = packHead(Pack(Node.set(Node.empty(), 0, 5)))\n",
      { runtime: true },
    );
    expect(messages).toEqual([]);
  });
});

/**
 * FFI Part 7 §14.1's `Node` bullet. `Array(a)` faces TypeScript as the immutable
 * `ReadonlyArray<a>` (issue #228), but `Node(a)` keeps the mutable `Array<a>`:
 * that is the honest shape of the hidden trie node, and nothing about it is a
 * borrowed foreign view. The face is reachable only through the inspection
 * preview, which renders a module's private declarations too — every export door
 * is shut above, so the shipped `.d.ts` never names it. This is the pin
 * `array-readonly-face.test.ts` defers here for.
 */
describe("the `Node(a)` face is the mutable `Array<a>` (FFI Part 7 §14.1)", () => {
  test("Node-typed bindings preview as `Array<…>`, and reach no shipped `.d.ts`", () => {
    const compiled = compileFiles([
      [RUNTIME_PATH, `${trieSource}\n` +
        "let anySlots = Node.empty()\n" +
        "let intSlots: Node(Int) = Node.set(anySlots, 0, 7)\n" +
        "export let firstSlot: Int = Node.get(intSlots, 0)\n"],
      TOUCH,
    ]);
    expect(compiled.diagnostics).toEqual([]);
    const module = compiled.modules.find(({ source }) => source.path === RUNTIME_PATH);
    if (module === undefined) throw new Error(`no ${RUNTIME_PATH} in the compiled project`);
    // `anySlots` is generalized and faces as its `never` instantiation (§14.1's
    // third row); `intSlots` is the ordinary `Node(Int)`. Both are mutable.
    const preview = emitTypeScriptPreview(module.core).text;
    expect(preview).toContain("declare const anySlots: Array<never>;\n");
    expect(preview).toContain("declare const intSlots: Array<number>;\n");
    expect(preview).toContain("export declare const firstSlot: number;\n");
    // The shipped face carries the export and nothing `Node`-shaped: every
    // export door above is shut, so no `Array<…>` reaches the `.d.ts` at all.
    expect(module.declarations.text).toContain("export declare const firstSlot: number;\n");
    expect(module.declarations.text).not.toContain("Array<");
  });
});

describe("Node annotations enable the recursive trie shape", () => {
  test("§4 a `Bag(a) = Pack(Node(a)) | Fan(Node(Bag(a)))` union round-trips a value", async () => {
    const m = await runRuntime(
      "union Bag(a) =\n" +
        "    | Pack(values: Node(a))\n" +
        "    | Fan(children: Node(Bag(a)))\n" +
        "fun packValue(bag: Bag(Int), slot: Int): Int = match bag\n" +
        "    Pack(values) => Node.get(values, slot)\n" +
        "    Fan(_) => 0 - 1\n" +
        "fun buildPack(): Bag(Int) = Pack(Node.set(Node.set(Node.empty(), 0, 10), 1, 20))\n" +
        "fun buildFan(): Bag(Int) = Fan(Node.set(Node.empty(), 0, buildPack()))\n" +
        "export let leaf0: Int = packValue(buildPack(), 0)\n" +
        "export let leaf1: Int = packValue(buildPack(), 1)\n" +
        "export let nested: Int = match buildFan()\n" +
        "    Fan(children) => packValue(Node.get(children, 0), 1)\n" +
        "    Pack(_) => 0 - 1\n",
    );
    expect(m.leaf0).toBe(10);
    expect(m.leaf1).toBe(20);
    expect(m.nested).toBe(20);
  });
});
