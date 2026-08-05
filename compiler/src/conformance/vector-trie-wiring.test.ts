import { describe, expect, test } from "vitest";

import { compileFiles, runMain, runProject } from "../support/test-project.js";
import { VECTOR_RUNTIME_OPERATIONS } from "../passes/emitter/emitter.js";
import trieSource from "../../../runtime/VectorTrie.hex?raw";

/**
 * Conformance for the wiring that makes a `Vector(a)` the Collections Part 3 §4
 * trie: the representation contract, the emission shapes §3.6 and §6.2 pin, the
 * complexity §4 and §7 pin, and the import surface the runtime module is
 * reached through.
 *
 * This is deliberately not a second `vector.test.ts`. That file asserts on the
 * *results* of operations and never on the representation, which is what lets it
 * hold across a change of backing — and it passed this milestone unedited, which
 * is the strongest single statement about it. What is pinned here is precisely
 * what that file must not look at: which JavaScript is emitted, which module it
 * comes from, what a crossed value is, and what the operations cost.
 *
 * ## The two things emission knows
 *
 * A vector's whole compiler-side contract is two sentences. **Every vector value
 * carries `[Symbol.iterator]`**, which is what `Hex.Vector<a> extends
 * Iterable<a>` promises and what `for x in`, spread, `Array.from`, `show`,
 * `hash`, and `Map.fromVector` all reach it through. **Every other operation is
 * a call into `runtime/VectorTrie.hex`**, whose export list
 * (`VECTOR_RUNTIME_OPERATIONS`) is the complete inventory. No emitted JavaScript
 * reads a `TrieVector`'s fields; the trie algebra is Hexagon.
 */

/** One project's emitted JavaScript, by source path. */
function emitted(files: readonly (readonly [string, string])[], path: string): string {
  const project = compileFiles(files);
  expect(project.diagnostics).toEqual([]);
  const module = project.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module.javascript.text;
}

/** `/main.hex`'s emitted JavaScript for a one-module program. */
function mainJavaScript(source: string): string {
  return emitted([["/main.hex", source]], "/main.hex");
}

/** Every source path a project emits, in dependency order. */
function emittedPaths(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).modules.map(({ source }) => source.path);
}

describe("the runtime module's two-sided contract", () => {
  /**
   * `runtime/VectorTrie.hex` exports nothing at the Hexagon level — every
   * operation's type names the private `TrieVector` — so the emitter writes the
   * JavaScript export list from a fixed inventory. A name in the inventory that
   * the module does not declare would be a `SyntaxError` in generated code
   * rather than a diagnostic, so the two sides are checked against each other.
   */
  test("every inventory operation is declared by the trie module", () => {
    for (const operation of VECTOR_RUNTIME_OPERATIONS) {
      expect(trieSource).toMatch(new RegExp(`^(fun|let) ${operation}\\b`, "mu"));
    }
  });

  test("the emitted runtime module exports exactly the inventory", () => {
    const javascript = emitted([["/main.hex", "export let v: Vector(Int) = [1]\n"]], "/VectorTrie.hex");
    expect(javascript).toContain(`export { ${VECTOR_RUNTIME_OPERATIONS.join(", ")} };`);
  });

  /**
   * The discipline `runtime/VectorTrie.hex`'s header states, made checkable.
   * The module sees the whole prelude before its seat, and a vector literal,
   * bracket, pattern, or `Vector.` call written in it would make the emitted
   * `VectorTrie.js` import `Vector.js` — which already imports this one. That
   * cycle is created at emission and recorded by no `Import` item, so the
   * module graph's own acyclicity check cannot see it. An empty import list is
   * the property that forecloses it.
   */
  test("the emitted runtime module imports nothing", () => {
    const javascript = emitted([["/main.hex", "export let v: Vector(Int) = [1]\n"]], "/VectorTrie.hex");
    expect(javascript.match(/^\s*import\b.*$/gmu) ?? []).toEqual([]);
  });

  /** A file in the injection seat that is not the trie is reported, not emitted broken. */
  test("a foreign file at the injection path is refused rather than mis-exported", () => {
    const project = compileFiles([
      ["/main.hex", "export let v: Vector(Int) = [1]\n"],
      ["/VectorTrie.hex", "let unrelated: Int = 1\n"],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toContain(
      "this file sits at the vector runtime's injection path but declares " +
        "no `empty`, `size`, `get`, `set`, `append`, `prepend`, `slice`, " +
        "`window`, `concat`, `nodeRun`",
    );
  });
});

describe("the import surface", () => {
  /**
   * The guarantee in both directions. A program with no vector must not carry
   * the trie runtime at all, and one with only a literal must carry the trie
   * and *not* the `Vector.hex` companion — the prelude member stays out of a
   * program that never names it, which the trie's arrival must not change.
   */
  test("no vector, no trie runtime", () => {
    const files = [["/main.hex", "export let n: Int = 1 + 2\n"]] as const;
    expect(emittedPaths(files)).toEqual(["/main.hex"]);
    expect(mainJavaScript("export let n: Int = 1 + 2\n")).not.toContain("VectorTrie");
  });

  test("a literal alone carries the trie and not the companion", () => {
    const files = [["/main.hex", "export let v: Vector(Int) = [1, 2, 3]\n"]] as const;
    expect(emittedPaths(files)).toEqual(["/VectorTrie.hex", "/main.hex"]);
    const javascript = emitted(files, "/main.hex");
    expect(javascript).toContain(
      'import { empty as __hex_trieEmpty, append as __hex_trieAppend } from "./VectorTrie.js";',
    );
    expect(javascript).not.toContain('from "./Vector.js"');
  });

  /** The import names only what the module reached, in inventory order. */
  test("a bracket read imports the size and get it needs, and no more", () => {
    const javascript = mainJavaScript(
      "let v: Vector(Int) = [1, 2, 3]\nexport let head: Int = v[1]\n",
    );
    expect(javascript).toContain(
      'import { empty as __hex_trieEmpty, size as __hex_trieSize, ' +
        'get as __hex_trieGet, append as __hex_trieAppend } from "./VectorTrie.js";',
    );
  });
});

describe("§3.6 pattern emission", () => {
  /**
   * The pinned shape, read against the trie's 0-based internals. `size === n`
   * for a fixed length, `size >= k` when a rest absorbs the remainder, reads by
   * `get`, and a `slice` for a rest *binder* only.
   *
   * **Where reality and the pin differ, and why.** §3.6 spells the shape as
   * method calls on the value (`xs.size`, `xs.get(0)`, `xs.slice(2)`). A
   * `TrieVector` carries exactly one method — `[Symbol.iterator]`, the
   * representation contract — and the trie's operations are module-level
   * Hexagon functions, so the emitted form is `size(xs)`, `get(xs, 0)`,
   * `slice(xs, 2, size(xs))` under the import's generated locals. Every
   * structural element the section pins is present; the spelling is a call
   * rather than a method.
   */
  test("a fixed-length pattern tests the exact size and reads by index", () => {
    const javascript = mainJavaScript(
      "export let sum: Int = match [1, 2]\n" +
        "    [a, b] => a + b\n" +
        "    _ => 0\n",
    );
    expect(javascript).toMatch(/__hex_trieSize\(__hex_match0\) === 2/u);
    expect(javascript).toContain("const a = __hex_trieGet(__hex_match0, 0);");
    expect(javascript).toContain("const b = __hex_trieGet(__hex_match0, 1);");
    expect(javascript).not.toContain("__hex_vectorSlice");
  });

  test("a rest binder tests `>=` and slices the remainder", () => {
    const javascript = mainJavaScript(
      "export let n: Int = match [1, 2, 3]\n" +
        "    [a, b, ...rest] => a + b\n" +
        "    _ => 0\n",
    );
    expect(javascript).toMatch(/__hex_trieSize\(__hex_match0\) >= 2/u);
    expect(javascript).toContain(
      "const rest = __hex_trieSlice(__hex_match0, 2, __hex_trieSize(__hex_match0));",
    );
  });

  /** An anonymous rest binds nothing, so it must not pay §3.5's slice. */
  test("an anonymous rest emits no slice", () => {
    const javascript = mainJavaScript(
      "export let n: Int = match [1, 2, 3]\n" +
        "    [a, ...] => a\n" +
        "    _ => 0\n",
    );
    expect(javascript).toMatch(/__hex_trieSize\(__hex_match0\) >= 1/u);
    expect(javascript).not.toContain("__hex_vectorSlice");
  });

  /** Slots after the rest count from the end — what makes `[...init, last]` mean it. */
  test("a trailing slot is read from the end and bounds the rest's window", () => {
    const javascript = mainJavaScript(
      "export let n: Int = match [1, 2, 3]\n" +
        "    [...init, last] => last\n" +
        "    _ => 0\n",
    );
    expect(javascript).toContain(
      "const last = __hex_trieGet(__hex_match0, __hex_trieSize(__hex_match0) - 1);",
    );
    expect(javascript).toContain(
      "const init = __hex_trieSlice(__hex_match0, 0, __hex_trieSize(__hex_match0) - 1);",
    );
  });

  /** The behaviour those shapes have to produce, at sizes that cross the branch factor. */
  test("every pattern form destructures a real trie", async () => {
    const main = await runMain(
      "fun build(n: Int): Vector(Int) =\n" +
        "    var acc: Vector(Int) = []\n" +
        "    for i in 1..n\n" +
        "        acc := Vector.append(acc, i)\n" +
        "    acc\n" +
        "let big = build(100)\n" +
        "export let firstOf: Int = match big\n" +
        "    [head, ...] => head\n" +
        "    [] => 0\n" +
        "export let lastOf: Int = match big\n" +
        "    [..., tail] => tail\n" +
        "    [] => 0\n" +
        "export let ends: (Int, Int) = match big\n" +
        "    [first, ..., last] => (first, last)\n" +
        "    _ => (0, 0)\n" +
        "export let middle: Vector(Int) = match big\n" +
        "    [_, _, ...rest] => rest\n" +
        "    _ => []\n" +
        "export let init: Vector(Int) = match build(40)\n" +
        "    [...front, _] => front\n" +
        "    _ => []\n" +
        "export let exact: Int = match [7, 8]\n" +
        "    [a, b] => a + b\n" +
        "    _ => 0\n",
    );
    expect(main["firstOf"]).toBe(1);
    expect(main["lastOf"]).toBe(100);
    expect(main["ends"]).toEqual([1, 100]);
    expect([...(main["middle"] as Iterable<number>)]).toEqual(
      Array.from({ length: 98 }, (_, index) => index + 3),
    );
    expect([...(main["init"] as Iterable<number>)]).toEqual(
      Array.from({ length: 39 }, (_, index) => index + 1),
    );
    expect(main["exact"]).toBe(15);
  });
});

describe("the representation contract", () => {
  /**
   * The FFI round-trip. A vector handed to JavaScript is spreadable,
   * `Array.from`-able, and `for…of`-able — the three things `Hex.Vector<a>
   * extends Iterable<a>` licenses a consumer to do — and the same value read
   * twice yields the same elements, because a trie is persistent.
   */
  test("a crossed vector iterates, spreads, and replays", async () => {
    const main = await runMain(
      "fun build(n: Int): Vector(Int) =\n" +
        "    var acc: Vector(Int) = []\n" +
        "    for i in 1..n\n" +
        "        acc := Vector.append(acc, i)\n" +
        "    acc\n" +
        "export let small: Vector(Int) = [10, 20, 30]\n" +
        "export let blank: Vector(Int) = []\n" +
        "export let big: Vector(Int) = build(1100)\n",
    );
    const small = main["small"] as Iterable<number>;
    expect([...small]).toEqual([10, 20, 30]);
    expect(Array.from(small)).toEqual([10, 20, 30]);
    expect([...small]).toEqual([10, 20, 30]);
    const seen: number[] = [];
    for (const value of small) seen.push(value);
    expect(seen).toEqual([10, 20, 30]);

    expect([...(main["blank"] as Iterable<number>)]).toEqual([]);
    // Past 32 and past 32² — the tail, the tree, and a height-3 trie, so the
    // iterator's region handling is exercised rather than only its tail case.
    expect([...(main["big"] as Iterable<number>)]).toEqual(
      Array.from({ length: 1100 }, (_, index) => index + 1),
    );
  });

  test("every vector value carries the traversal method itself", async () => {
    const main = await runMain(
      "export let literal: Vector(Int) = [1]\n" +
        "export let blank: Vector(Int) = []\n" +
        "export let grown: Vector(Int) = Vector.append([1], 2)\n" +
        "export let fronted: Vector(Int) = Vector.prepend([1], 0)\n" +
        "export let windowed: Vector(Int) = [1, 2, 3][2..3]\n" +
        "export let replaced: Vector(Int) = Vector.set([1, 2], 1, 9)\n" +
        "export let joined: Vector(Int) = [1] ++ [2]\n" +
        "export let converted: Vector(Int) = Vector.fromSeq(Vector.toSeq([1, 2]))\n",
    );
    for (const name of [
      "literal", "blank", "grown", "fronted", "windowed", "replaced", "joined", "converted",
    ]) {
      const value = main[name] as Record<symbol, unknown>;
      expect(typeof value[Symbol.iterator]).toBe("function");
    }
  });

  /**
   * The brand is a TypeScript-only phantom (FFI Part 1 §8.3): nothing carries
   * `"~hex"` at runtime, so the pin is on the declaration text and on the face
   * a vector-typed export renders through.
   */
  test("the `.d.ts` face is the branded runtime `Vector`", () => {
    const project = compileFiles([["/main.hex", "export let v: Vector(Int) = [1]\n"]]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.declarations.text).toContain("Hex.Vector<number>");
    expect(project.runtimeDeclarations?.text).toContain(
      'export interface Vector<a> extends Iterable<a> { readonly "~hex": "Vector"; }',
    );
    // …and the phantom stays phantom: no emitted value carries the brand.
    expect(main.javascript.text).not.toContain("~hex");
  });
});

describe("§4/§7 complexity", () => {
  /**
   * §7 pins `length` at O(1), and the trie meets it with two field reads. The
   * witness is a *poisoned* vector: a value that answers every field but throws
   * if anything traverses it. `Vector.length` must still answer.
   *
   * The control is the same value handed to something that genuinely traverses.
   * Without it this test passes on a vector nothing poisoned, which is the
   * "test that cannot fail" this exists to avoid — the poison has to be shown
   * to be live before its silence means anything.
   */
  test("length answers without traversing", async () => {
    const main = await runMain(
      "fun build(n: Int): Vector(Int) =\n" +
        "    var acc: Vector(Int) = []\n" +
        "    for i in 1..n\n" +
        "        acc := Vector.append(acc, i)\n" +
        "    acc\n" +
        "export let big: Vector(Int) = build(5000)\n" +
        "export fun measure(values: Vector(Int)): Int = Vector.length(values)\n" +
        "export fun render(values: Vector(Int)): String = \"${values}\"\n",
    );
    // Delegates every field to a real trie, and refuses to be walked.
    const poisoned = Object.create(main["big"] as object) as object;
    Object.defineProperty(poisoned, Symbol.iterator, {
      value: () => {
        throw new Error("the vector was traversed");
      },
    });

    const measure = main["measure"] as (values: unknown) => number;
    expect(measure(poisoned)).toBe(5000);

    // The control: the poison is live, so anything that walks does fail.
    const render = main["render"] as (values: unknown) => string;
    expect(() => render(poisoned)).toThrow("the vector was traversed");
  });

  /**
   * §4's structural sharing, asserted by object identity rather than by timing.
   *
   * An `append` that lands in the tail leaves the tree untouched, so the result
   * shares the original's `root` — the whole point of a persistent trie, and the
   * property a copying implementation would silently lose while passing every
   * behavioural test. An end `slice` re-windows over the same trie, so it shares
   * `root` *and* `tail`, which is §4's "effectively O(1)" note made visible.
   *
   * Reading `.root` is representation knowledge, and this is the one place the
   * suite has it: a sharing claim cannot be made from the outside.
   *
   * The base is 100 elements, not three, and that is the whole difference
   * between a pin and a decoration. Every trie of 32 or fewer elements has the
   * *shared empty's* root, so at that size `grown.root === base.root` holds
   * however the vector was built — an implementation that rebuilt from scratch
   * on every append would pass it. Past the first tail flush the root is a real
   * tree, and identity means what it says.
   */
  test("append shares the tree it did not touch, and an end slice shares both", async () => {
    const main = await runMain(
      "fun build(n: Int): Vector(Int) =\n" +
        "    var acc: Vector(Int) = []\n" +
        "    for i in 1..n\n" +
        "        acc := Vector.append(acc, i)\n" +
        "    acc\n" +
        "export let base: Vector(Int) = build(100)\n" +
        "export let grown: Vector(Int) = Vector.append(base, 101)\n" +
        "export let dropped: Vector(Int) = Vector.dropLast(base)\n" +
        "export let front: Vector(Int) = Vector.dropFirst(base)\n",
    );
    const trie = (name: string) => main[name] as { root: unknown; tail: unknown };
    // The base is deep enough to have a tree of its own.
    expect(trie("base").root).not.toBe(
      (await runMain("export let blank: Vector(Int) = []\n"))["blank"],
    );
    // An append into a non-full tail leaves the tree alone…
    expect(trie("grown").root).toBe(trie("base").root);
    // …and copies the tail, so the original is intact.
    expect(trie("grown").tail).not.toBe(trie("base").tail);
    expect([...(main["base"] as Iterable<number>)]).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
    // §4's end-slice note: a window that leaves the tail where it was reuses
    // both fields, which is what "effectively O(1)" means.
    expect(trie("dropped").root).toBe(trie("base").root);
    expect(trie("dropped").tail).toBe(trie("base").tail);
    expect(trie("front").root).toBe(trie("base").root);
    expect(trie("front").tail).toBe(trie("base").tail);
  });

  /** One shared empty, since a `TrieVector` is immutable and two are alike. */
  test("every empty vector is the same value", async () => {
    const main = await runMain(
      "export let a: Vector(Int) = []\n" +
        "export let b: Vector(String) = []\n" +
        "export let c: Vector(Int) = Vector.empty\n" +
        "export let d: Vector(Int) = [1, 2][5..9]\n",
    );
    expect(main["b"]).toBe(main["a"]);
    expect(main["c"]).toBe(main["a"]);
    expect(main["d"]).toBe(main["a"]);
  });

  /**
   * The iterator walks nodes, not elements. Reading it out of the emitted text
   * is the pin that keeps it that way: an implementation that reached for `get`
   * per element would be correct, pass everything else here, and quietly be
   * O(n log32 n) on every loop a program writes.
   */
  test("the emitted iterator descends per node rather than per element", () => {
    const javascript = emitted([["/main.hex", "export let v: Vector(Int) = [1]\n"]], "/VectorTrie.hex");
    expect(javascript).toContain("function* __hex_vectorIterate() {");
    expect(javascript).toContain("nodeRun(this, __hex_index)");
    expect(javascript).toContain("__hex_index += __hex_run;");
  });
});

describe("§5 indexed access over the trie", () => {
  /** The bracket, `at`, and `set` all raise §5.5's payload, index as passed. */
  test.each([
    ["bracket, past the end", "values[9]", 9, 3],
    ["bracket, zero", "values[0]", 0, 3],
    ["bracket, negative", "values[-1]", -1, 3],
    ["at, zero", "Vector.at(values, 0)", 0, 3],
    ["at, past the end from the front", "Vector.at(values, 4)", 4, 3],
    ["at, past the start from the end", "Vector.at(values, -4)", -4, 3],
    ["set, past the end", "Vector.length(Vector.set(values, 9, 0))", 9, 3],
  ])("%s", async (_label, expression, index, size) => {
    const main = await runMain(
      "let values: Vector(Int) = [10, 20, 30]\n" +
        `export fun boom(ignored: Int): Int = ${expression}\n`,
    );
    let thrown: unknown;
    try {
      (main["boom"] as (ignored: number) => unknown)(0);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      name: "IndexError",
      $hex: true,
      index,
      size,
      message: `index ${index} out of bounds for size ${size}`,
    });
  });

  /** Deep in a height-3 trie, where a bounds check over a size field could drift. */
  test("the payload's size is the trie's own, at every depth", async () => {
    const main = await runMain(
      "fun build(n: Int): Vector(Int) =\n" +
        "    var acc: Vector(Int) = []\n" +
        "    for i in 1..n\n" +
        "        acc := Vector.append(acc, i)\n" +
        "    acc\n" +
        "let big = build(1100)\n" +
        "export fun boom(ignored: Int): Int = big[1101]\n" +
        "export fun deep(ignored: Int): Int = big[1100]\n",
    );
    expect((main["deep"] as (n: number) => number)(0)).toBe(1100);
    expect(() => (main["boom"] as (n: number) => number)(0)).toThrow(
      "index 1101 out of bounds for size 1100",
    );
  });
});

describe("§6 slicing over the trie", () => {
  test("magnitude clamps and direction throws", async () => {
    const main = await runMain(
      "let values: Vector(Int) = [10, 20, 30]\n" +
        "export let inside: Vector(Int) = values[2..3]\n" +
        "export let past: Vector(Int) = values[2..99]\n" +
        "export let outside: Vector(Int) = values[5..9]\n" +
        "export let backwards: Vector(Int) = values[3..1]\n" +
        "export let whole: Vector(Int) = values[1..3]\n",
    );
    const elements = (name: string) => [...(main[name] as Iterable<number>)];
    expect(elements("inside")).toEqual([20, 30]);
    expect(elements("past")).toEqual([20, 30]);
    expect(elements("outside")).toEqual([]);
    expect(elements("backwards")).toEqual([]);
    expect(elements("whole")).toEqual([10, 20, 30]);

  });

  /**
   * §6.3's direction check survived the move to the trie, and is still
   * unreachable from Hexagon: the only descending `Range` comes from
   * `rangeDown` or a function returning one, and v1 has no such producer — the
   * emitter's `range` helper hardcodes `descending: false`. So what is pinned
   * is the guard's presence and its payload's shape, ahead of the clamping,
   * which is the ordering §6.3 requires: direction faults *before* magnitude
   * clamps, so a descending window never quietly answers empty.
   */
  test("the descending guard still precedes the clamping", () => {
    const javascript = mainJavaScript(
      "let v: Vector(Int) = [1, 2, 3]\nexport let w: Vector(Int) = v[2..3]\n",
    );
    const helper = javascript.slice(javascript.indexOf("function __hex_vectorSlice"));
    const body = helper.slice(0, helper.indexOf("\n}"));
    expect(body).toContain('__hex_error.name = "SliceError"');
    expect(body).toContain("__hex_error.start = __hex_range.start");
    expect(body).toContain("__hex_error.end = __hex_range.end");
    expect(body.indexOf("descending")).toBeLessThan(body.indexOf("__hex_trieWindow"));
  });

  /** §6.2's shape: one call, the runtime's own clamping, modulo the 0-based offset. */
  test("a slice emits one guarded call into the trie's window", () => {
    const javascript = mainJavaScript(
      "let v: Vector(Int) = [1, 2, 3]\nexport let w: Vector(Int) = v[2..3]\n",
    );
    expect(javascript).toContain("__hex_vectorSlice(v, __hex_range(2, 3))");
    expect(javascript).toContain("__hex_trieWindow(__hex_values, __hex_range.start - 1, __hex_range.end)");
  });

  test("windows of a large trie clamp at both ends", async () => {
    const main = await runMain(
      "fun build(n: Int): Vector(Int) =\n" +
        "    var acc: Vector(Int) = []\n" +
        "    for i in 1..n\n" +
        "        acc := Vector.append(acc, i)\n" +
        "    acc\n" +
        "let big = build(1100)\n" +
        "export let mid: Vector(Int) = big[500..520]\n" +
        "export let tailward: Vector(Int) = big[1090..5000]\n" +
        "export let front: Vector(Int) = big[-50..3]\n",
    );
    const elements = (name: string) => [...(main[name] as Iterable<number>)];
    expect(elements("mid")).toEqual(
      Array.from({ length: 21 }, (_, index) => index + 500),
    );
    expect(elements("tailward")).toEqual(
      Array.from({ length: 11 }, (_, index) => index + 1090),
    );
    expect(elements("front")).toEqual([1, 2, 3]);
  });
});

describe("§8 instances over the trie", () => {
  /**
   * Cross-construction equality is the representation-leak detector: two
   * vectors built by different routes have different tries — different
   * `origin`, different `height`, a different tail — and must still compare
   * equal. Nested vectors run the parameterized instance twice (Constraints
   * §4.3), which is where an equality that compared *tries* rather than
   * elements would show.
   */
  test("equality, order, show, and hash agree across construction routes", async () => {
    const main = await runMain(
      "fun ups(n: Int): Vector(Int) =\n" +
        "    var acc: Vector(Int) = []\n" +
        "    for i in 1..n\n" +
        "        acc := Vector.append(acc, i)\n" +
        "    acc\n" +
        "fun downs(n: Int): Vector(Int) =\n" +
        "    var acc: Vector(Int) = []\n" +
        "    for i in 1..n\n" +
        "        acc := Vector.prepend(acc, n - i + 1)\n" +
        "    acc\n" +
        "export let sameHundred: Bool = ups(100) == downs(100)\n" +
        "export let sameHash: Bool = hash(ups(100)) == hash(downs(100))\n" +
        "export let slicedEquals: Bool = ups(50)[10..20] == ups(20)[10..20]\n" +
        "export let differs: Bool = ups(100) == ups(99)\n" +
        "export let shown: String = \"${[1, 2, 3]}\"\n" +
        "export let blankShown: String = \"${Vector.empty}\"\n" +
        "export let nested: Bool = [[1, 2], [3]] == [[1, 2], [3]]\n" +
        "export let nestedShown: String = \"${[[1, 2], [3]]}\"\n" +
        "export let nestedHash: Bool = hash([[1, 2], [3]]) == hash([[1, 2], [3]])\n" +
        "export let prefixLess: Bool = [1, 2] < [1, 2, 0]\n" +
        "export let firstUnequalDecides: Bool = [1, 3] > [1, 2, 99]\n" +
        "export let equalOrder: Bool = [1, 2] <= [1, 2]\n" +
        "export let longerGreater: Bool = ups(101) > ups(100)\n" +
        "export let joined: Vector(Int) = ups(40) ++ ups(40)\n",
    );
    expect(main["sameHundred"]).toBe(true);
    expect(main["sameHash"]).toBe(true);
    expect(main["slicedEquals"]).toBe(true);
    expect(main["differs"]).toBe(false);
    expect(main["shown"]).toBe("[1, 2, 3]");
    expect(main["blankShown"]).toBe("[]");
    expect(main["nested"]).toBe(true);
    expect(main["nestedShown"]).toBe("[[1, 2], [3]]");
    expect(main["nestedHash"]).toBe(true);
    expect(main["prefixLess"]).toBe(true);
    expect(main["firstUnequalDecides"]).toBe(true);
    expect(main["equalOrder"]).toBe(true);
    expect(main["longerGreater"]).toBe(true);
    expect([...(main["joined"] as Iterable<number>)]).toEqual([
      ...Array.from({ length: 40 }, (_, index) => index + 1),
      ...Array.from({ length: 40 }, (_, index) => index + 1),
    ]);
  });

  /** `++` is the trie's own `concat`, so the left operand's trie is not copied. */
  test("concat grows out of the left operand", async () => {
    const main = await runMain(
      "export let left: Vector(Int) = [1, 2, 3]\n" +
        "export let joined: Vector(Int) = left ++ [4]\n" +
        "export let withNothing: Vector(Int) = left ++ []\n",
    );
    const trie = (name: string) => main[name] as { root: unknown };
    expect(trie("joined").root).toBe(trie("left").root);
    expect([...(main["withNothing"] as Iterable<number>)]).toEqual([1, 2, 3]);
  });

  /** The `Map`/`Set` consumers take a vector whole, through the contract. */
  test("Map and Set build from a vector without knowing it is a trie", async () => {
    const main = await runMain(
      "let table: Map(Int, String) = Map.fromVector([(1, \"one\"), (2, \"two\")])\n" +
        "let members: Set(Int) = Set.fromVector([3, 1, 2, 1])\n" +
        "export let looked: String = table[2]\n" +
        "export let held: Bool = Map.containsKey(table, 1)\n" +
        "export let counted: Int = Set.size(members)\n",
    );
    expect(main["looked"]).toBe("two");
    expect(main["held"]).toBe(true);
    expect(main["counted"]).toBe(3);
  });
});

describe("§9 strings did not follow the vector", () => {
  /**
   * String indexing shares the doctrine and no longer shares the code. The
   * helpers used to reach the vector ones over a codepoint array; a string is
   * not a trie, so each now carries its own array reading — and it must stay
   * array reading, or `s[i]` would build a 32-way trie to read one character.
   */
  test("the string helpers touch no trie operation", () => {
    const javascript = mainJavaScript(
      'export let letter: String = "héllo"[2]\n' +
        'export let part: String = "héllo"[2..4]\n',
    );
    const helpers = javascript.slice(0, javascript.indexOf("\nexport"));
    expect(helpers).toContain("function __hex_stringIndex");
    expect(helpers).toContain("function __hex_stringSlice");
    expect(javascript).not.toContain("VectorTrie");
    expect(javascript).not.toContain("__hex_vectorIndex");
    expect(javascript).not.toContain("__hex_vectorSlice");
  });

  test("string indexing and slicing behave exactly as before", async () => {
    const main = await runMain(
      'let s: String = "héllo"\n' +
        "export let second: String = s[2]\n" +
        "export let window: String = s[2..4]\n" +
        "export let clamped: String = s[2..99]\n" +
        "export fun boom(ignored: Int): String = s[9]\n",
    );
    expect(main["second"]).toBe("é");
    expect(main["window"]).toBe("éll");
    expect(main["clamped"]).toBe("éllo");
    let thrown: unknown;
    try {
      (main["boom"] as (ignored: number) => unknown)(0);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: "IndexError", $hex: true, index: 9, size: 5 });
  });
});

describe("the trie runtime is reached from wherever a module sits", () => {
  /** A module in a subdirectory spells the specifier relative to itself. */
  test("a nested module reaches up to the injected root", async () => {
    const files = [
      ["/src/deep/leaf.hex", "export let values: Vector(Int) = [1, 2]\n"],
      ["/src/main.hex", 'import { values } from "./deep/leaf"\n' +
        "export let total: Int = Vector.length(values)\n"],
    ] as const;
    const javascript = emitted(files, "/src/deep/leaf.hex");
    expect(javascript).toContain('from "../VectorTrie.js"');
    expect(await runProject(files, { entry: "/src/main.hex" })).toMatchObject({ total: 2 });
  });
});
