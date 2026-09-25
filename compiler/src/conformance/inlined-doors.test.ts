/**
 * Intrinsics §8.3's inlined rows: an exported door row whose lowering is one
 * JavaScript expression naming each operand once, in order, with no helper, is
 * written at its call as that expression. The semantics is the lowering's, so
 * every pin here is either emitted text or the value the inline text computes.
 */
import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

const HEADER = "module Main\n\n";

function mainJavaScript(source: string): string {
  const project = compileMain(HEADER + source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

describe("each inlined row emits its lowering at the call", () => {
  test.each([
    ["Math.sqrt(x)", "Math.sqrt(x)"],
    ["Math.sin(x)", "Math.sin(x)"],
    ["Math.cos(x)", "Math.cos(x)"],
    ["Math.tan(x)", "Math.tan(x)"],
    ["Math.asin(x)", "Math.asin(x)"],
    ["Math.acos(x)", "Math.acos(x)"],
    ["Math.atan(x)", "Math.atan(x)"],
    ["Math.atan2(x, y)", "Math.atan2(x, y)"],
    ["Math.exp(x)", "Math.exp(x)"],
    ["Math.ln(x)", "Math.log(x)"],
    ["Math.log10(x)", "Math.log10(x)"],
    ["Math.sinh(x)", "Math.sinh(x)"],
    ["Math.cosh(x)", "Math.cosh(x)"],
    ["Math.tanh(x)", "Math.tanh(x)"],
    ["Float.rem(x, y)", "x % y"],
  ])("%s", (call, emitted) => {
    const text = mainJavaScript(`export let f(x: Float, y: Float): Float = ${call}\n`);
    expect(text).toContain(`const f = (x, y) => ${emitted};`);
    expect(text).not.toContain("import");
  });

  test.each([
    ["Nullable.isNull(v)", "Bool", "v === null"],
    ["Nullable.isUndefined(v)", "Bool", "v === undefined"],
  ])("%s", (call, result, emitted) => {
    const text = mainJavaScript(`export let f(v: Nullable(Int)): ${result} = ${call}\n`);
    expect(text).toContain(`const f = v => ${emitted};`);
  });

  test("the foreign collections' reads, tests, and constructors", () => {
    const text = mainJavaScript(
      "let a(xs: Array(Int)): Int = Array.length(xs)\n" +
        "let m(map: JsMap(String, Int)): Int = JsMap.size(map)\n" +
        "let s(set: JsSet(Int)): Int = JsSet.size(set)\n" +
        'let mh(map: JsMap(String, Int)): Bool = JsMap.containsKey(map, "k")\n' +
        "let sh(set: JsSet(Int)): Bool = JsSet.contains(set, 1)\n" +
        "let mf(pairs: Seq((String, Int))): JsMap(String, Int) = JsMap.fromSeq(pairs)\n" +
        "let sf(values: Seq(Int)): JsSet(Int) = JsSet.fromSeq(values)\n" +
        "export let n: Int = 0\n",
    );
    expect(text).toContain("const a = xs => xs.length;");
    expect(text).toContain("const m = map => map.size;");
    expect(text).toContain("const s = set => set.size;");
    expect(text).toContain('const mh = map => map.has("k");');
    expect(text).toContain("const sh = set => set.has(1);");
    expect(text).toContain("const mf = pairs => new Map(pairs);");
    expect(text).toContain("const sf = values => new Set(values);");
    expect(text).not.toContain("import");
  });
});

describe("every spelling of a call inlines, and a reference stays a function", () => {
  test("qualified, dot, and pipe stage emit alike", () => {
    const text = mainJavaScript(
      "export let q(x: Float): Float = Math.sqrt(x)\n" +
        "export let p(x: Float): Float = x |> Math.sqrt\n" +
        "export let d(set: JsSet(Int)): Bool = set.contains(2)\n",
    );
    expect(text).toContain("const q = x => Math.sqrt(x);");
    expect(text).toContain("const p = x => Math.sqrt(x);");
    expect(text).toContain("const d = set => set.has(2);");
  });

  test("a value reference is the exported function", async () => {
    const source =
      "let root: (Float) -> Float = Math.sqrt\n" +
      "let r: (Float, Float) -> Float = Float.rem\n" +
      "export let a: Float = root(9.0)\nexport let b: Float = r(7.0, 4.0)\n";
    const text = mainJavaScript(source);
    expect(text).toMatch(/import \{ sqrt \} from "\.\/Hex\/Math\.js";/u);
    expect(text).toContain("const root = sqrt;");
    expect(text).toContain("const r = rem;");
    expect(await runMain(HEADER + source)).toMatchObject({ a: 3, b: 3 });
  });
});

describe("an inlined row binds as the expression it becomes", () => {
  test("operator rows bracket what JavaScript would regroup", async () => {
    const source =
      "let x: Float = 7.0\nlet y: Float = 2.0\n" +
      "export let a: Float = Float.rem(x, y * 3.0)\n" +
      "export let b: Float = Float.rem(x - 1.0, y) * 2.0\n" +
      "export let c: Float = Float.rem(Float.rem(x, 4.0), y)\n" +
      "export let d: Float = Float.rem(x, Float.rem(y, 4.0))\n" +
      "export let e: Float = -Float.rem(x, y)\n";
    const text = mainJavaScript(source);
    expect(text).toContain("const a = x % (y * 3.0);");
    expect(text).toContain("const b = (x - 1.0) % y * 2.0;");
    expect(text).toContain("const c = x % 4.0 % y;");
    expect(text).toContain("const d = x % (y % 4.0);");
    expect(await runMain(HEADER + source)).toMatchObject({ a: 1, b: 0, c: 1, d: 1, e: -1 });
  });

  test("a read or test is made on its receiver, bracketed when it is looser", async () => {
    const source =
      "let pick(flag: Bool, a: Array(Int), b: Array(Int)): Array(Int) = if flag then a else b\n" +
      "export let n(a: Array(Int), b: Array(Int)): Int = Array.length(pick(True, a, b)) + 1\n" +
      "export let m(a: Array(Int), b: Array(Int), flag: Bool): Int = (if flag then a else b).length()\n" +
      "export let s(values: Seq(Int)): Int = JsSet.fromSeq(values).size()\n";
    const text = mainJavaScript(source);
    expect(text).toContain("const n = (a, b) => pick(true, a, b).length + 1;");
    expect(text).toContain("const m = (a, b, flag) => (flag ? a : b).length;");
    expect(text).toContain("const s = values => new Set(values).size;");
  });

  test("an inlined operand inside another inlined row keeps its grouping", async () => {
    const source =
      "let x: Float = 2.0\n" +
      "export let a: Float = Math.sqrt(Float.rem(x * 8.0, 7.0) + 7.0)\n" +
      "export let b: Bool = Nullable.isNull(Nullable.null) == True\n";
    const text = mainJavaScript(source);
    expect(text).toContain("const a = Math.sqrt(x * 8.0 % 7.0 + 7.0);");
    expect(await runMain(HEADER + source)).toMatchObject({ a: 3, b: true });
  });
});

describe("the global is spelled in the calling module's vocabulary", () => {
  test("a module whose own `Math`, `Map`, and `Set` contest the globals steps around them", async () => {
    const source =
      "export union Contested = Math(Int) | Map(Int) | Set(Int)\n" +
      "export let r: Float = Math.sqrt(16.0)\n" +
      "export let m(pairs: Seq((String, Int))): JsMap(String, Int) = JsMap.fromSeq(pairs)\n" +
      "export let s(values: Seq(Int)): JsSet(Int) = JsSet.fromSeq(values)\n";
    const text = mainJavaScript(source);
    expect(text).not.toMatch(/[^_]Math\.sqrt\(/u);
    expect(text).toMatch(/const r = \w+\.sqrt\(16\.0\);/u);
    expect(text).not.toMatch(/new (Map|Set)\(/u);
    expect(await runMain(HEADER + source)).toMatchObject({ r: 4 });
  });
});
