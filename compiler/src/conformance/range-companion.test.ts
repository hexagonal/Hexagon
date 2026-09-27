import { describe, expect, test } from "vitest";

import { STDLIB_SOURCES } from "../stdlib-sources";
import { compileFiles, compileMain, runMain } from "../support/test-project.js";

/**
 * Conformance for **`stdlib/Range.hex`** (#1073): `Range` is its companion's
 * public type row, `Range.up`/`Range.down` are its two named constructors, and
 * `Iterable<Range>` is honored in source.
 *
 * What changed for a program:
 * - `Range.down(hi, lo)` exists, so a descending range is writable — and with it
 *   the slice's direction check, which nothing could reach before.
 * - A range has a companion, so `r.toSeq()` and `Range.toSeq(r)` resolve where
 *   Method Syntax §9 row 17 used to refuse the dot.
 * - A head written `Range.up(…)` or `Range.down(…)` counts natively, as `lo..hi`
 *   does (Loops §8) — recognised by the resolved binding, so a module's own `up`
 *   is an ordinary call.
 * - The `.d.ts` face is `Range`, imported from `./Hex/Range.js`, like the
 *   collections' (#1071), not `Hex.Range`.
 */

function javascript(source: string): string {
  const project = compileMain("module Main\n\n" + source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const main = project.modules.find(({ name }) => name === "Main");
  if (main === undefined) throw new Error("Main was not emitted");
  return main.javascript.text;
}

function declarations(source: string): string {
  const project = compileMain("module Main\n\n" + source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ name }) => name === "Main")!.declarations.text;
}

function diagnostics(source: string): readonly string[] {
  return compileMain("module Main\n\n" + source).diagnostics.map(({ message }) => message);
}

async function run(source: string): Promise<Record<string, unknown>> {
  return runMain("module Main\n\n" + source);
}

/** One function's body lines, for pins on the exact statement sequence. */
function lines(...text: readonly string[]): string {
  return text.join("\n");
}

/** Joins a range's values in iteration order, through the value path. */
const SPELL = "export fun spell(r: Range): String =\n" +
  "    var out = \"\"\n" +
  "    for i in r\n" +
  "        out := \"${out}${i},\"\n" +
  "    out\n";

describe("the constructors", () => {
  test("`Range.up` is `..` as a function; `Range.down` counts down; both are inclusive", async () => {
    const exports = await run(
      SPELL +
        "export let up: String = spell(Range.up(2, 5))\n" +
        "export let dots: String = spell(2..5)\n" +
        "export let down: String = spell(Range.down(5, 2))\n",
    );
    expect([exports["up"], exports["dots"], exports["down"]]).toEqual(["2,3,4,5,", "2,3,4,5,", "5,4,3,2,"]);
  });

  test("direction is never read from the bounds: a reversed pair is empty, an equal one has one value", async () => {
    const exports = await run(
      SPELL +
        "export let upEmpty: String = spell(Range.up(5, 2))\n" +
        "export let downEmpty: String = spell(Range.down(2, 5))\n" +
        "export let upOne: String = spell(Range.up(3, 3))\n" +
        "export let downOne: String = spell(Range.down(3, 3))\n",
    );
    expect([exports["upEmpty"], exports["downEmpty"], exports["upOne"], exports["downOne"]])
      .toEqual(["", "", "3,", "3,"]);
  });

  test("both are first-class functions", async () => {
    const exports = await run(
      SPELL +
        "let pick(descending: Bool): (Int, Int) -> Range =\n" +
        "    if descending then Range.down else Range.up\n" +
        "export let picked: String = spell(pick(True)(3, 1))\n",
    );
    expect(exports["picked"]).toBe("3,2,1,");
  });

  /**
   * `Range.hex` exports no `Range`-first function today, so the companion tie
   * is exercised with one appended in its real seat: a subject-first export is a
   * dot call on a range, as `Vector.hex`'s are on a vector (Method Syntax §4.1).
   */
  test("the companion's subject-first export is a dot call on a range", () => {
    const project = compileFiles([
      ["/main.hex", "module Main\n\nexport let n: Int = (1..3).width()\n"],
      ["/Range.hex", STDLIB_SOURCES["Range"]! + "\nexport fun width(values: Range): Int = 1\n"],
    ], { trustedStandardLibraryModules: new Set(["Range"]) });
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ name }) => name === "Main");
    expect(main?.javascript.text).toContain("const n = width(__range(1, 3));");
  });

  test("a written call stays a call to the member; `..` keeps its local helper", () => {
    const text = javascript(
      "export let a: Range = Range.up(1, 3)\n" +
        "export let b: Range = Range.down(3, 1)\n" +
        "export let c: Range = 1..3\n",
    );
    expect(text).toContain('import { up, down } from "./Hex/Range.js";');
    expect(text).toContain("const a = up(1, 3);");
    expect(text).toContain("const b = down(3, 1);");
    expect(text).toContain("const c = __range(1, 3);");
  });

  test("the companion's JavaScript: `up` is ordinary Hexagon, `down` a door over the descending helper", () => {
    const project = compileFiles([["/main.hex", "module Main\n\nexport let r: Range = Range.down(2, 1)\n"]]);
    const range = project.modules.find(({ source }) => source.path === "/Hex/Range.hex");
    if (range === undefined) throw new Error("Range.hex was not emitted");
    const text = range.javascript.text;
    expect(text).toContain("function up(lo, hi) {\n  return __range(lo, hi);\n}");
    expect(text).toContain("const down = __rangeDown;");
    expect(text).toContain("  return { start: __start, end: __end, descending: true,");
    expect(text).toContain("      for (let __value = __start; __value >= __end; __value -= 1) yield __value;");
  });
});

describe("`toSeq` at a range, by every spelling", () => {
  test("dot, companion-qualified, and the constraint's own spelling", async () => {
    const exports = await run(
      "export let dot: Int = Seq.length((1..4).toSeq())\n" +
        "export let qualified: Int = Seq.length(Range.toSeq(Range.down(3, 1)))\n" +
        "export let member: Int = Seq.length(Iterable.toSeq(Range.up(1, 2)))\n",
    );
    expect([exports["dot"], exports["qualified"], exports["member"]]).toEqual([4, 3, 2]);
  });

  test("a descending range's sequence runs downward", async () => {
    const exports = await run(
      "export let first: Int = match Seq.next(Range.toSeq(Range.down(9, 1)))\n" +
        "    Some((head, _)) => head\n" +
        "    None => 0\n",
    );
    expect(exports["first"]).toBe(9);
  });
});

describe("the counting loop over `Range.up` / `Range.down` (Loops §8)", () => {
  test("both count natively, and neither imports its constructor", () => {
    const text = javascript(
      "export fun total(n: Int): Int =\n" +
        "    var t = 0\n" +
        "    for i in Range.up(1, n)\n" +
        "        t := t + i\n" +
        "    for i in Range.down(n, 1)\n" +
        "        t := t + i\n" +
        "    t\n",
    );
    expect(text).toContain("  for (let i = 1; i <= n; i++) {");
    expect(text).toContain("  for (let i = n; i >= 1; i--) {");
    expect(text).not.toContain("Range.js");
    expect(text).not.toContain("__range");
  });

  test("the bounds follow `..`'s rules: a computed end is read once, a computed start ahead of it", () => {
    const text = javascript(
      "let half(n: Int): Int = n.div(2)\n" +
        "export fun total(n: Int, lo: () ->! Int, hi: () ->! Int): Int =\n" +
        "    var t = 0\n" +
        "    for i in Range.down(n, half(n))\n" +
        "        t := t + i\n" +
        "    for i in Range.down(half(n), n)\n" +
        "        t := t + i\n" +
        "    for i in Range.down(hi!(), lo!())\n" +
        "        t := t + i\n" +
        "    t\n",
    );
    expect(text).toContain(lines(
      "  const __end = half(n);",
      "  for (let i = n; i >= __end; i--) {",
    ));
    expect(text).toContain("  for (let i = half(n); i >= n; i--) {");
    expect(text).toContain(lines(
      "  const __start = hi();",
      "  const __end_1 = lo();",
      "  for (let i = __start; i >= __end_1; i--) {",
    ));
  });

  test("the loop runs as the range would", async () => {
    const exports = await run(
      "export fun collect(hi: Int, lo: Int): String =\n" +
        "    var out = \"\"\n" +
        "    for i in Range.down(hi, lo)\n" +
        "        out := \"${out}${i},\"\n" +
        "    out\n",
    );
    const collect = exports["collect"] as (hi: number, lo: number) => string;
    expect([collect(4, 1), collect(2, 2), collect(1, 4)]).toEqual(["4,3,2,1,", "2,", ""]);
  });

  test("the high bound is evaluated before the low, as the call's arguments are", async () => {
    const exports = await run(
      "export fun total(hi: () ->! Int, lo: () ->! Int): Int =\n" +
        "    var t = 0\n" +
        "    for i in Range.down(hi!(), lo!())\n" +
        "        t := t + i\n" +
        "    t\n",
    );
    const order: string[] = [];
    const total = exports["total"] as (hi: () => number, lo: () => number) => number;
    expect(total(() => (order.push("hi"), 3), () => (order.push("lo"), 1))).toBe(6);
    expect(order).toEqual(["hi", "lo"]);
  });

  test("a loop variable shadowing a bound is read before the loop (#1127)", async () => {
    const source = "export fun total(n: Int): Int =\n" +
      "    var t = 0\n" +
      "    for n in Range.down(n, 1)\n" +
      "        t := t + n\n" +
      "    t\n";
    expect(javascript(source)).toContain(lines(
      "  const __start = n;",
      "  for (let n = __start; n >= 1; n--) {",
    ));
    expect(((await run(source))["total"] as (n: number) => number)(4)).toBe(10);
  });

  test("the licence is the binding, not the spelling: a module's own `up` is a call", () => {
    const text = javascript(
      "let up(lo: Int, hi: Int): Range = lo..hi\n" +
        "export fun total(n: Int): Int =\n" +
        "    var t = 0\n" +
        "    for i in up(1, n)\n" +
        "        t := t + i\n" +
        "    t\n",
    );
    expect(text).toContain("  for (const i of up(1, n)) {");
  });

  test("a `Range.down` value iterates as one", () => {
    const text = javascript(
      "export fun total(n: Int): Int =\n" +
        "    var t = 0\n" +
        "    let r = Range.down(n, 1)\n" +
        "    for i in r\n" +
        "        t := t + i\n" +
        "    t\n",
    );
    expect(text).toContain("  const r = down(n, 1);\n  for (const i of r) {");
  });
});

describe("a slice refuses a descending range (Collections Part 3 §6.3)", () => {
  test("a vector slice throws `SliceError` with the endpoints as written", async () => {
    const exports = await run(
      "export fun take(xs: Vector(Int)): Vector(Int) = xs[Range.down(3, 1)]\n" +
        "export let values: Vector(Int) = [1, 2, 3, 4]\n",
    );
    let thrown: unknown;
    try {
      (exports["take"] as (xs: unknown) => unknown)(exports["values"]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: "SliceError", start: 3, end: 1 });
  });

  test("a string slice throws it too", async () => {
    const exports = await run("export fun take(text: String): String = text[Range.down(3, 1)]\n");
    expect(() => (exports["take"] as (text: string) => string)("hello"))
      .toThrow(expect.objectContaining({ name: "SliceError", start: 3, end: 1 }));
  });

  test("an ascending `Range.up` slices as `..` does", async () => {
    const exports = await run("export let part: String = \"hello\"[Range.up(2, 4)]\n");
    expect(exports["part"]).toBe("ell");
  });
});

describe("the type and its face", () => {
  test("`Range` takes no arguments, by every route", () => {
    expect(diagnostics("export let r: Range(Int) = 1..2\n"))
      .toEqual(["type `Range` expects 0 arguments, but 1 were provided"]);
    expect(diagnostics("export let r: Range.Range = 1..2\n")).toEqual([]);
  });

  test("a face written through a source alias takes rung 3, as the collections' do", () => {
    expect(declarations(
      "import Hex.Range as R\n" +
        "export fun f(r: R.Range): R.Range = r\n" +
        "export let bare: Range = 1..2\n",
    )).toBe(
      'import type { Range } from "./Hex/Range.js";\n' +
        'import type * as R from "./Hex/Range.js";\n' +
        "export declare function f(r: R.Range): R.Range;\n" +
        "export declare const bare: Range;\n",
    );
  });

  /**
   * The seats whose published type is the *body's* — a function's return, an
   * annotated `let` — take the written qualifier, as a nominal's do: the body
   * `1..3` carries none, and the face is the author's.
   */
  test("a written return and an annotated `let` keep their qualifier", () => {
    expect(declarations(
      "import Hex.Range as R\n" +
        "export fun g(): R.Range = 1..3\n" +
        "export let h: R.Range = 1..3\n",
    )).toBe(
      'import type * as R from "./Hex/Range.js";\n' +
        "export declare function g(): R.Range;\n" +
        "export declare const h: R.Range;\n",
    );
  });

  test("a program's own `Iterable<Range>` is an orphan", () => {
    expect(diagnostics(
      "honor Iterable<Range> =\n    type Item = Int\n    toSeq(r) = Seq.empty\n",
    )).toContain("orphan instance: this module declares neither `Iterable` nor the instance subject");
  });
});
