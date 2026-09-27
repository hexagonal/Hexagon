import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, runMain } from "../support/test-project.js";

/**
 * Conformance for **Loops §8's counting loop** (#1126) and for the loop head's
 * scope (#1127).
 *
 * A `..` written in a loop head never builds a `Range`: the loop counts, as a
 * JavaScript reader would have written it. The head is still evaluated exactly
 * as Loops §2.3's desugaring evaluates it — once, start before end — so every
 * shape below is also executed, and the executed tests are the ones that pin
 * what the text alone cannot: an end read once, the order of two effectful
 * bounds, a `var` end the body reassigns, each iteration's own binding.
 *
 * #1127 is the loop head's scope. Hexagon evaluates the head before the loop
 * variable exists (Loops §2.1, §2.3); JavaScript evaluates a `for…of` head
 * inside the variable's dead zone, and a counting loop's test inside its scope.
 * A head that mentions the loop variable's name is therefore read before the
 * loop, on every path.
 */

function javascript(source: string): string {
  const project = compileMain("module Main\n\n" + source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const main = project.modules.find(({ name }) => name === "Main");
  if (main === undefined) throw new Error("Main was not emitted");
  return main.javascript.text;
}

async function run(source: string): Promise<Record<string, unknown>> {
  return runMain("module Main\n\n" + source);
}

/** One function's body lines, for pins on the exact statement sequence. */
function lines(...text: readonly string[]): string {
  return text.join("\n");
}

const SUM = "export let sum(lo: Int, hi: Int): Int =\n" +
  "    var total = 0\n" +
  "    for i in lo..hi\n" +
  "        total := total + i\n" +
  "    total\n";

describe("the counting loop's shape (Loops §8)", () => {
  test("a literal range counts, and builds no Range", () => {
    const text = javascript(
      "export let total(): Int =\n" +
        "    var t = 0\n" +
        "    for i in 1..10\n" +
        "        t := t + i\n" +
        "    t\n",
    );

    expect(text).toContain("  for (let i = 1; i <= 10; i++) {\n    t = t + i;\n  }");
    expect(text).not.toContain("__range");
  });

  test("a parameter, a local `let`, and an outer loop variable stay in the test", () => {
    const text = javascript(
      "export let total(n: Int): Int =\n" +
        "    let m = n + 1\n" +
        "    var t = 0\n" +
        "    for i in 1..n\n" +
        "        for j in i..m\n" +
        "            for k in 1..i\n" +
        "                t := t + j + k\n" +
        "    t\n",
    );

    expect(text).toContain("for (let i = 1; i <= n; i++) {");
    expect(text).toContain("for (let j = i; j <= m; j++) {");
    expect(text).toContain("for (let k = 1; k <= i; k++) {");
    expect(text).not.toContain("const __");
  });

  test("a name that only contains the loop variable's is not a mention", () => {
    const text = javascript(
      "export let total(hi: Int, it: Int): Int =\n" +
        "    var t = 0\n" +
        "    for i in 1..hi\n" +
        "        t := t + i\n" +
        "    for i in it..3\n" +
        "        t := t + i\n" +
        "    t\n",
    );

    expect(text).toContain("for (let i = 1; i <= hi; i++) {");
    expect(text).toContain("for (let i = it; i <= 3; i++) {");
    expect(text).not.toContain("const __");
  });

  test("another module's `let`, read through its qualifier, stays in the test", () => {
    const project = compileFiles([
      ["/config.hex", "module Config\n\nexport let limit: Int = 3\n"],
      ["/main.hex", "module Main\n\nimport Config\n\n" +
        "export let total(): Int =\n" +
        "    var t = 0\n" +
        "    for i in 1..Config.limit\n" +
        "        t := t + i\n" +
        "    t\n"],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ name }) => name === "Main");

    expect(main?.javascript.text).toContain("  for (let i = 1; i <= Config.limit; i++) {");
  });

  test("a negative literal is a literal", () => {
    const text = javascript(
      "export let total(): Int =\n" +
        "    var t = 0\n" +
        "    for i in -3..-1\n" +
        "        t := t + i\n" +
        "    t\n",
    );

    expect(text).toContain("for (let i = -3; i <= -1; i++) {");
  });

  test("grouping parentheses and an ascription are read through", () => {
    const text = javascript(
      "export let total(n: Int): Int =\n" +
        "    var t = 0\n" +
        "    for i in (1..n)\n" +
        "        t := t + i\n" +
        "    for i in (1..n : Range)\n" +
        "        t := t + i\n" +
        "    t\n",
    );

    expect(text.split("for (let i = 1; i <= n; i++) {")).toHaveLength(3);
    expect(text).not.toContain("__range");
  });

  test("a computed end is read once, into a `const` before the loop", () => {
    const text = javascript(
      "let double(n: Int): Int = n * 2\n" +
        "export let total(n: Int): Int =\n" +
        "    var t = 0\n" +
        "    for i in 1..double(n)\n" +
        "        t := t + i\n" +
        "    t\n",
    );

    expect(text).toContain(lines(
      "  const __end = double(n);",
      "  for (let i = 1; i <= __end; i++) {",
    ));
  });

  test("a `var` end is read once: the body may assign it", () => {
    const text = javascript(
      "export let total(n0: Int): Int =\n" +
        "    var n = n0\n" +
        "    var t = 0\n" +
        "    for i in 1..n\n" +
        "        n := n + 1\n" +
        "        t := t + i\n" +
        "    t\n",
    );

    expect(text).toContain(lines(
      "  const __end = n;",
      "  for (let i = 1; i <= __end; i++) {",
    ));
  });

  test("a field read is read once", () => {
    const text = javascript(
      "export record Box = {height: Int}\n" +
        "export let levels(box: Box): Int =\n" +
        "    var t = 0\n" +
        "    for level in 2..box.height\n" +
        "        t := t + level\n" +
        "    t\n",
    );

    expect(text).toContain(lines(
      "  const __end = box.height;",
      "  for (let level = 2; level <= __end; level++) {",
    ));
  });

  test("a computed start moves out first, ahead of a computed end", () => {
    const text = javascript(
      "export let total(lo: () ->! Int, hi: () ->! Int): Int =\n" +
        "    var t = 0\n" +
        "    for i in lo!()..hi!()\n" +
        "        t := t + i\n" +
        "    t\n",
    );

    expect(text).toContain(lines(
      "  const __start = lo();",
      "  const __end = hi();",
      "  for (let i = __start; i <= __end; i++) {",
    ));
  });

  test("a computed start before a plain end stays in the loop", () => {
    const text = javascript(
      "let half(n: Int): Int = n.div(2)\n" +
        "export let total(n: Int): Int =\n" +
        "    var t = 0\n" +
        "    for i in half(n)..n\n" +
        "        t := t + i\n" +
        "    t\n",
    );

    expect(text).toContain("  for (let i = half(n); i <= n; i++) {");
    expect(text).not.toContain("const __");
  });

  test("a `_` head counts on a fresh name", async () => {
    const source = "let double(n: Int): Int = n * 2\n" +
      "export let total(n: Int): Int =\n" +
      "    var t = 0\n" +
      "    for _ in 1..10\n" +
      "        t := t + 1\n" +
      "    for _ in 1..double(n)\n" +
      "        t := t + 1\n" +
      "    t\n";
    const text = javascript(source);

    expect(text).toContain("  for (let __item = 1; __item <= 10; __item++) {\n    t = t + 1;\n  }");
    expect(text).toContain(lines(
      "  const __end = double(n);",
      "  for (let __item_1 = 1; __item_1 <= __end; __item_1++) {",
    ));
    expect(((await run(source))["total"] as (n: number) => number)(3)).toBe(16);
  });

  test("any other pattern head binds inside the body", () => {
    const text = javascript(
      "export let total(n: Int): Int =\n" +
        "    var t = 0\n" +
        "    for (_ as i) in 1..n\n" +
        "        t := t + i\n" +
        "    t\n",
    );

    expect(text).toContain(lines(
      "  for (let __item = 1; __item <= n; __item++) {",
      "    const i = __item;",
      "    t = t + i;",
    ));
  });

  test("a `Range` value iterates as one, beside a head that counts", () => {
    const text = javascript(
      "export let total(n: Int): Int =\n" +
        "    var t = 0\n" +
        "    let r = 1..n\n" +
        "    for i in r\n" +
        "        t := t + i\n" +
        "    for i in 1..n\n" +
        "        t := t + i\n" +
        "    t\n",
    );

    expect(text.split("function __range(__start, __end) {")).toHaveLength(2);
    expect(text).toContain("  const r = __range(1, n);\n  for (const i of r) {");
    expect(text).toContain("  for (let i = 1; i <= n; i++) {");
  });

  test("the standard library's trie counts natively", () => {
    const project = compileFiles([["/main.hex", "module Main\n\nexport let v: Vector(Int) = [1]\n"]]);
    const trie = project.modules.find(({ source }) => source.path === "/Hex/Runtime/VectorTrie.hex");
    if (trie === undefined) throw new Error("the trie was not emitted");

    expect(trie.javascript.text).toContain("  for (let step = 1; step <= exponent; step++) {");
    expect(trie.javascript.text).not.toContain("__range");
  });
});

describe("the counting loop runs as the range would (Loops §2.3, §3.4)", () => {
  test("ordinary, single-element, and empty ranges", async () => {
    const sum = (await run(SUM))["sum"] as (lo: number, hi: number) => number;

    expect(sum(1, 4)).toBe(10);
    expect(sum(-2, 2)).toBe(0);
    expect(sum(3, 3)).toBe(3);
    expect(sum(5, 1)).toBe(0);
    expect(sum(1, 0)).toBe(0);
  });

  test("each iteration's closure keeps its own value", async () => {
    const exports = await run(
      "export let captured(): String =\n" +
        "    var fs: Vector(() -> Int) = []\n" +
        "    for i in 1..3\n" +
        "        fs := fs.append(() => i)\n" +
        "    var out = \"\"\n" +
        "    for f in fs\n" +
        "        out := \"${out}${f()}\"\n" +
        "    out\n",
    );

    expect((exports["captured"] as () => string)()).toBe("123");
  });

  test("a computed end is evaluated once", async () => {
    const exports = await run(
      "export let total(hi: () ->! Int): Int =\n" +
        "    var t = 0\n" +
        "    for i in 1..hi!()\n" +
        "        t := t + i\n" +
        "    t\n",
    );
    let calls = 0;

    expect((exports["total"] as (hi: () => number) => number)(() => {
      calls += 1;
      return 4;
    })).toBe(10);
    expect(calls).toBe(1);
  });

  test("the start is evaluated before the end", async () => {
    const exports = await run(
      "export let total(lo: () ->! Int, hi: () ->! Int): Int =\n" +
        "    var t = 0\n" +
        "    for i in lo!()..hi!()\n" +
        "        t := t + i\n" +
        "    t\n",
    );
    const order: string[] = [];
    const total = exports["total"] as (lo: () => number, hi: () => number) => number;

    expect(total(() => (order.push("lo"), 2), () => (order.push("hi"), 4))).toBe(9);
    expect(order).toEqual(["lo", "hi"]);
  });

  test("a `var` end the body reassigns does not move the end", async () => {
    const exports = await run(
      "export let total(n0: Int): Int =\n" +
        "    var n = n0\n" +
        "    var t = 0\n" +
        "    for i in 1..n\n" +
        "        n := n + 1\n" +
        "        t := t + i\n" +
        "    t\n",
    );

    expect((exports["total"] as (n: number) => number)(4)).toBe(10);
  });

  test("an inner loop bounded by the outer loop's variable", async () => {
    const exports = await run(
      "export let triangle(n: Int): Int =\n" +
        "    var t = 0\n" +
        "    for i in 1..n\n" +
        "        for j in 1..i\n" +
        "            t := t + 1\n" +
        "    t\n",
    );

    expect((exports["triangle"] as (n: number) => number)(4)).toBe(10);
  });
});

describe("a loop variable may shadow a name its own head reads (#1127)", () => {
  test("a counting loop's end: read before the loop, the counter keeps its name", async () => {
    const source = "export let total(n: Int): Int =\n" +
      "    var t = 0\n" +
      "    for n in 1..n\n" +
      "        t := t + n\n" +
      "    t\n";

    expect(javascript(source)).toContain(lines(
      "  const __end = n;",
      "  for (let n = 1; n <= __end; n++) {",
    ));
    expect(((await run(source))["total"] as (n: number) => number)(4)).toBe(10);
  });

  test("a counting loop's start", async () => {
    const source = "export let total(n: Int): Int =\n" +
      "    var t = 0\n" +
      "    for n in n..10\n" +
      "        t := t + n\n" +
      "    t\n";

    expect(javascript(source)).toContain(lines(
      "  const __start = n;",
      "  for (let n = __start; n <= 10; n++) {",
    ));
    expect(((await run(source))["total"] as (n: number) => number)(8)).toBe(27);
  });

  test("a `Vector` head", async () => {
    const source = "let total(xs: Vector(Int)): Int =\n" +
      "    var t = 0\n" +
      "    for xs in xs\n" +
      "        t := t + xs\n" +
      "    t\n" +
      "export let run(): Int = total([1, 2, 3])\n";

    expect(javascript(source)).toContain(lines(
      "  const __source = xs;",
      "  for (const xs of __source) {",
    ));
    expect(((await run(source))["run"] as () => number)()).toBe(6);
  });

  test("a `String` head", async () => {
    const source = "export let count(s: String): Int =\n" +
      "    var t = 0\n" +
      "    for s in s\n" +
      "        t := t + 1\n" +
      "    t\n";

    expect(javascript(source)).toContain(lines(
      "  const __source = s;",
      "  for (const s of __source) {",
    ));
    expect(((await run(source))["count"] as (s: string) => number)("héllo")).toBe(5);
  });

  test("a `Seq` head", async () => {
    const source = "let total(s: Seq(Int)): Int =\n" +
      "    var t = 0\n" +
      "    for s in s\n" +
      "        t := t + s\n" +
      "    t\n" +
      "export let run(): Int = total([1, 2, 3].toSeq())\n";

    expect(javascript(source)).toContain(lines(
      "  const __source = __seqToIterable(s);",
      "  for (const s of __source) {",
    ));
    expect(((await run(source))["run"] as () => number)()).toBe(6);
  });

  test("a head that does not mention the loop variable stays in the loop", () => {
    const text = javascript(
      "export let count(s: String): Int =\n" +
        "    var t = 0\n" +
        "    for c in s\n" +
        "        t := t + 1\n" +
        "    t\n",
    );

    expect(text).toContain("  for (const c of s) {");
    expect(text).not.toContain("__source");
  });

  test("the negative baseline: in the loop, the head throws before its first iteration", async () => {
    // What shipped before #1127, executed: the head reads the loop variable
    // inside its own dead zone.
    const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(
      "export const count = s => {\n" +
        "  let t = 0;\n" +
        "  for (const s of s) {\n" +
        "    t = t + 1;\n" +
        "  }\n" +
        "  return t;\n" +
        "};\n" +
        "// counting-loop baseline\n",
    )}`;
    const exports = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;

    expect(() => (exports["count"] as (s: string) => number)("abc")).toThrow(ReferenceError);
  });
});
