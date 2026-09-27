import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for **per-function generated names** (#1129, Lexer §3.2).
 *
 * A function is already a scope, so the emitter numbers a generated name within
 * the function that declares it, as a person reuses `end` in each function they
 * write. Every function in the emitted JavaScript counts, whoever wrote it: a
 * `fun` or a lambda, and any function the emitter writes — an immediately-
 * invoked arrow, an eta-expansion wrapper, a derived walk, an instance factory.
 *
 * What stays apart is what could clash: a nested function avoids every name
 * its enclosing functions already hold, a module-level temporary is reserved in
 * every function after it, and a module-level binding the emitter mints from
 * inside a function — a hoisted dictionary, an import's local — is numbered
 * across the whole module. The executed tests are the ones that pin what the
 * text alone cannot: each function reads its own name, and a module never
 * declares one twice.
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

/** One top-level `const name = …` binding's text, through its closing line. */
function binding(text: string, name: string): string {
  const start = text.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`no binding \`${name}\``);
  const end = text.indexOf("\n};\n", start);
  return text.slice(start, end < 0 ? undefined : end + 3);
}

const LOOPS = "export record Box = { size: Int }\n" +
  "\n" +
  "export let first(b: Box): Int =\n" +
  "    var total = 0\n" +
  "    for i in 1..b.size\n" +
  "        total := total + i\n" +
  "    total\n" +
  "\n" +
  "export let second(b: Box): Int =\n" +
  "    var total = 0\n" +
  "    for i in 1..b.size\n" +
  "        total := total + i\n" +
  "    for i in 1..b.size\n" +
  "        total := total + i\n" +
  "    total\n" +
  "\n" +
  "export let nested(b: Box): Int =\n" +
  "    var total = 0\n" +
  "    for i in 1..b.size\n" +
  "        let up = (c: Box): Int =>\n" +
  "            var t = 0\n" +
  "            for j in 1..c.size\n" +
  "                t := t + j\n" +
  "            t\n" +
  "        let twice = (c: Box): Int =>\n" +
  "            var t = 0\n" +
  "            for j in 1..c.size\n" +
  "                t := t + 2 * j\n" +
  "            t\n" +
  "        total := total + up(b) + twice(b)\n" +
  "    total\n";

describe("a function numbers its own generated names", () => {
  test("sibling functions reuse a name; one function numbers its second", async () => {
    const text = javascript(LOOPS);

    expect(binding(text, "first")).toContain(
      "  const __end = b.size;\n  for (let i = 1; i <= __end; i++) {",
    );
    const second = binding(text, "second");
    expect(second).toContain("  const __end = b.size;\n  for (let i = 1; i <= __end; i++) {");
    expect(second).toContain("  const __end_1 = b.size;\n  for (let i = 1; i <= __end_1; i++) {");
    expect(text).not.toContain("__end_2");

    const module = await run(LOOPS);
    const box = { size: 3 };
    expect((module["first"] as (b: unknown) => number)(box)).toBe(6);
    expect((module["second"] as (b: unknown) => number)(box)).toBe(12);
  });

  test("a nested function avoids the names its enclosing function holds", async () => {
    const nested = binding(javascript(LOOPS), "nested");

    // The loop's `__end` is live around both lambdas, so each numbers past it
    // — and, as siblings, both land on the same `_1`.
    expect(nested).toContain("  const __end = b.size;\n  for (let i = 1; i <= __end; i++) {");
    expect(nested.split("const __end_1 = c.size;")).toHaveLength(3);
    expect(nested).not.toContain("__end_2");

    const module = await run(LOOPS);
    // Each lambda reads its own end: 2 × (3 + 6).
    expect((module["nested"] as (b: unknown) => number)({ size: 2 })).toBe(18);
  });

  test("a module-level temporary is reserved in every function after it", async () => {
    const source = "export union Side = Left(value: Int) | Right(value: Int)\n" +
      "\n" +
      "export let early(s: Side): Int = match s\n" +
      "    Left(l) => l\n" +
      "    Right(r) => 0 - r\n" +
      "\n" +
      "let Left(amount) | Right(amount) = Left(42)\n" +
      "\n" +
      "export let late(s: Side): Int = match s\n" +
      "    Left(l) => l + amount\n" +
      "    Right(r) => amount - r\n";
    const text = javascript(source);

    // `early` was emitted before the module's temporary existed, and nothing
    // it says can read it; `late` can see it, so numbers past it.
    expect(binding(text, "early")).toContain("  const __match = s;");
    expect(text).toContain('\nconst __match = { tag: "Left", value: 42 };\n');
    expect(binding(text, "late")).toContain("  const __match_1 = s;");

    const module = await run(source);
    expect((module["early"] as (s: unknown) => number)({ tag: "Right", value: 5 })).toBe(-5);
    expect((module["late"] as (s: unknown) => number)({ tag: "Left", value: 1 })).toBe(43);
    expect((module["late"] as (s: unknown) => number)({ tag: "Right", value: 2 })).toBe(40);
  });
});

describe("a function the emitter writes is a function too", () => {
  test("an immediately-invoked arrow numbers within itself", async () => {
    const source = "export union Tree = Leaf(value: Int) | Branch(child: Tree)\n" +
      "\n" +
      "export let depth(tree: Tree, steps: Int): Int =\n" +
      "    var node = tree\n" +
      "    for level in 1..steps\n" +
      "        node := match node\n" +
      "            Branch(child) => child\n" +
      "            Leaf(_) => node\n" +
      "    match node\n" +
      "        Leaf(value) => value\n" +
      "        Branch(_) => 0 - 1\n" +
      "\n" +
      "export let guarded(n: Int): Int =\n" +
      "    (try n\n" +
      "    catch\n" +
      "        _ => n) + (try 0\n" +
      "    catch\n" +
      "        _ => 0)\n";
    const text = javascript(source);

    // The loop body's `match` is a value, so it is an arrow of its own, and the
    // `__match` inside it is gone by the time the function's own `match` runs.
    const depth = binding(text, "depth");
    expect(depth).toContain("    node = (() => {\n      const __match = node;");
    expect(depth).toContain("\n  const __match = node;\n  switch (__match.tag) {");
    expect(depth).not.toContain("__match_1");
    // Each `try` operand is its own arrow, with its own `catch` binding.
    const guarded = binding(text, "guarded");
    expect(guarded.split("} catch (__error) {")).toHaveLength(3);
    expect(guarded).not.toContain("__error_1");

    const module = await run(source);
    const tree = { tag: "Branch", child: { tag: "Branch", child: { tag: "Leaf", value: 7 } } };
    expect((module["depth"] as (t: unknown, s: number) => number)(tree, 1)).toBe(-1);
    expect((module["depth"] as (t: unknown, s: number) => number)(tree, 2)).toBe(7);
    expect((module["guarded"] as (n: number) => number)(4)).toBe(4);
  });

  test("a `fun` declaration, a block, and loops in value position each number within themselves", async () => {
    const source = "export record Box = { size: Int }\n" +
      "\n" +
      "fun sumTo(b: Box): Int =\n" +
      "    var total = 0\n" +
      "    for i in 1..b.size\n" +
      "        total := total + i\n" +
      "    total\n" +
      "\n" +
      "fun sumTwice(b: Box): Int =\n" +
      "    var total = 0\n" +
      "    for i in 1..b.size\n" +
      "        total := total + 2 * i\n" +
      "    total\n" +
      "\n" +
      "export let viaFun(b: Box): Int = sumTo(b) + sumTwice(b)\n" +
      "\n" +
      "export let blocks(b: Box): Int =\n" +
      "    let a =\n" +
      "        var t = 0\n" +
      "        for i in 1..b.size\n" +
      "            t := t + i\n" +
      "        t\n" +
      "    let c =\n" +
      "        var t = 0\n" +
      "        for i in 1..b.size\n" +
      "            t := t + 2 * i\n" +
      "        t\n" +
      "    a + c\n" +
      "\n" +
      "export let loops(b: Box): Int =\n" +
      "    var t = 0\n" +
      "    let u =\n" +
      "        for i in 1..b.size\n" +
      "            t := t + i\n" +
      "    let w =\n" +
      "        for i in 1..b.size\n" +
      "            t := t + 2 * i\n" +
      "    t\n" +
      "\n" +
      "export let whiles(b: Box): Int =\n" +
      "    var t = 0\n" +
      "    var k = 0\n" +
      "    let u =\n" +
      "        while k < 1\n" +
      "            for i in 1..b.size\n" +
      "                t := t + i\n" +
      "            k := k + 1\n" +
      "    let w =\n" +
      "        while k < 2\n" +
      "            for i in 1..b.size\n" +
      "                t := t + 2 * i\n" +
      "            k := k + 1\n" +
      "    t\n";
    const text = javascript(source);

    expect(text).toContain("function sumTo(b) {\n  let total = 0;\n  const __end = b.size;");
    expect(text).toContain("function sumTwice(b) {\n  let total = 0;\n  const __end = b.size;");
    expect(binding(text, "blocks")).toContain(
      "  const c = (() => {\n    let t = 0;\n    const __end = b.size;",
    );
    expect(binding(text, "loops")).toContain("  const w = (() => {\n    const __end = b.size;");
    expect(binding(text, "whiles")).toContain(
      "  const w = (() => {\n    while (k < 2) {\n      const __end = b.size;",
    );
    expect(text).not.toContain("__end_1");

    const module = await run(source);
    const box = { size: 3 };
    expect((module["viaFun"] as (b: unknown) => number)(box)).toBe(18);
    expect((module["blocks"] as (b: unknown) => number)(box)).toBe(18);
    expect((module["loops"] as (b: unknown) => number)(box)).toBe(18);
    expect((module["whiles"] as (b: unknown) => number)(box)).toBe(18);
  });

  test("each comparison chain numbers its operands afresh", async () => {
    const source = "export let chains(f: () -> Int): Bool =\n" +
      "    f() < f() < f() and f() < f() < f()\n";
    const chains = binding(javascript(source), "chains");

    // One chain needs three names, as a person would; the next reuses them.
    expect(chains.split("const __compare_2 = f();")).toHaveLength(3);
    expect(chains).not.toContain("__compare_3");

    const module = await run(source);
    let count = 0;
    expect((module["chains"] as (f: () => number) => boolean)(() => ++count)).toBe(true);
    expect(count).toBe(6);
  });

  test("a derived walk numbers within itself, beside its sibling walks", async () => {
    const source = "export let order(a: (Vector(Int), Vector(Int)), b: (Vector(Int), Vector(Int))): Ordering =\n" +
      "    Ord.compare(a, b)\n" +
      "\n" +
      "export let digest(a: (Vector(Int), Vector(Int))): Int = Hash.hash(a)\n" +
      "\n" +
      "export let before: Ordering = order(([1], [2, 3]), ([1], [2, 4]))\n" +
      "export let same: Bool = digest(([1], [2])) == digest(([1], [2]))\n";
    const text = javascript(source);

    // Both halves of each tuple walk under the bare binders.
    expect(text).toContain("const __order0 = (() => { const __rightStep = __right[0][Symbol.iterator]();");
    expect(text).toContain("const __order1 = (() => { const __rightStep = __right[1][Symbol.iterator]();");
    expect(text).toContain("for (const __element of __value[0])");
    expect(text).toContain("for (const __element of __value[1])");
    expect(text).toContain("for (const __leftElement of __left[1])");
    expect(text).not.toMatch(/__(?:leftElement|rightElement|rightStep|step|order|element|hash)_1/u);

    const module = await run(source);
    expect(module["before"]).toEqual({ tag: "Less" });
    expect(module["same"]).toBe(true);
  });

  test("an unapplied `JsValue.from` wrapper numbers its own parameter", () => {
    const text = javascript(
      "export let converters(xs: Array(Int), ys: Array(String)): (JsValue, JsValue) =\n" +
        "    let f: (Array(Int)) -> JsValue = JsValue.from\n" +
        "    let g: (Array(String)) -> JsValue = JsValue.from\n" +
        "    (f(xs), g(ys))\n",
    );

    expect(text).toContain("  const f = __released => __capture(__capturePlans, 0, __released);");
    expect(text).toContain("  const g = __released => __capture(__capturePlans, 1, __released);");
  });

  test("an eta-expansion wrapper numbers its own parameters", () => {
    const text = javascript(
      "let bump<a: Show>(xs: Vector(String), x: a): Vector(String) = xs ++ [show(x)]\n" +
        "\n" +
        "export let both<a: Show>(xs: Vector(a), ys: Vector(a)): Vector(String) =\n" +
        "    xs.toSeq().fold([], bump) ++ ys.toSeq().fold([], bump)\n",
    );

    const both = binding(text, "both");
    expect(both.split("(__arg0, __arg1) => bump(__arg0, __arg1, __Show_a)")).toHaveLength(3);
    expect(text).not.toContain("__arg0_1");
  });

  test("an instance factory numbers its own record", () => {
    const text = javascript(
      "export union Wrap(a) derives Show = Wrap(item: a)\n" +
        "export union Pair(a) derives Show = Pair(left: a, right: a)\n",
    );

    expect(text).toContain("const __Show_Wrap = __Show_a => {\n  const __instance = {");
    expect(text).toContain("const __Show_Pair = __Show_a => {\n  const __instance = {");
    expect(text).not.toContain("__instance_1");
  });

  test("a nested derived walk still numbers past the walk around it", async () => {
    // A walk is a function, but the inner one runs inside the outer and reads
    // its binder: reusing `__leftElement` there would be a TDZ fault.
    const source = "export let same(x: Vector(Vector(Int)), y: Vector(Vector(Int))): Bool =\n" +
      "    x == y\n" +
      "\n" +
      "export let agree: Bool = same([[1, 2], [3]], [[1, 2], [3]])\n" +
      "export let differ: Bool = same([[1, 2], [3]], [[1, 2], [4]])\n";
    const text = javascript(source);

    expect(text).toContain("for (const __leftElement of __left) {");
    expect(text).toContain("for (const __leftElement_1 of __leftElement) {");

    const module = await run(source);
    expect(module["agree"]).toBe(true);
    expect(module["differ"]).toBe(false);
  });
});

describe("a module-level binding minted inside a function stays module-wide", () => {
  test("two hoisted structural dictionaries with one spelling", async () => {
    // Dictionary Sharing §5's flattening is not injective: both tuples spell
    // `Show_Int_Int_Int`. Each is hoisted from inside a different function, and
    // both bind at the top of the module, so the second numbers past the first.
    const source = "export let left(): String = show(((1, 2), 3))\n" +
      "\n" +
      "export let right(): String = show((1, (2, 3)))\n";
    const text = javascript(source);

    expect(text).toContain("const __Show_Int_Int_Int = ");
    expect(text).toContain("const __Show_Int_Int_Int_1 = ");

    const module = await run(source);
    expect((module["left"] as () => string)()).toBe("((1, 2), 3)");
    expect((module["right"] as () => string)()).toBe("(1, (2, 3))");
  });

  test("two inherited defaults' imports with one spelling", async () => {
    // Each import local is minted inside its own instance's scope; both bind at
    // the top of the module, so the second numbers past the first.
    const files = [
      ["/stamps.hex", "module Stamps\n\n" + [
        "export constraint Stamp<a> =",
        "    mark(subject: a) -> String",
        "    stamped(subject: a) -> String = \"<\" ++ mark(subject) ++ \">\"",
        "",
      ].join("\n")],
      ["/seals.hex", "module Seals\n\n" + [
        "export constraint Seal<a> =",
        "    press(subject: a) -> String",
        "    stamped(subject: a) -> String = \"seal \" ++ press(subject)",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Stamps",
        "import Seals",
        "",
        "record Ticket = {serial: String}",
        "",
        "honor Stamps.Stamp<Ticket> =",
        "    mark(t) = t.serial",
        "",
        "honor Seals.Seal<Ticket> =",
        "    press(t) = t.serial",
        "",
        "export fun both(): String =",
        "    Stamps.stamped(Ticket({serial = \"7\"})) ++ Seals.stamped(Ticket({serial = \"8\"}))",
        "",
      ].join("\n")],
    ] as const;
    const project = compileFiles(files);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const text = project.modules.find(({ name }) => name === "Main")!.javascript.text;

    expect(text).toContain('import { __default_stamped } from "./Stamps.js";');
    expect(text).toContain('import { __default_stamped as __default_stamped_1 } from "./Seals.js";');

    const module = await runProject(files);
    expect((module["both"] as () => string)()).toBe("<7>seal 8");
  });

  test("two hoisted factory applications with one spelling", async () => {
    const source = "export union B(a) derives Show = B(item: a)\n" +
      "export union B_C(a) derives Show = B_C(item: a)\n" +
      "export union D derives Show = D\n" +
      "export union C_D derives Show = C_D\n" +
      "\n" +
      "export let one(): String = show(B(C_D))\n" +
      "\n" +
      "export let two(): String = show(B_C(D))\n";
    const text = javascript(source);

    expect(text).toContain("const __Show_B_C_D = __Show_B(__Show_C_D);");
    expect(text).toContain("const __Show_B_C_D_1 = __Show_B_C(__Show_D);");

    const module = await run(source);
    expect((module["one"] as () => string)()).toBe("B(C_D)");
    expect((module["two"] as () => string)()).toBe("B_C(D)");
  });
});
