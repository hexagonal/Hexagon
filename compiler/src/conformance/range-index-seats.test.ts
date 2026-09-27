import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

/**
 * Conformance for **`..`'s operands and the bracket's index as ordinary seats**
 * (#1133; Numeric Literals §5.1's seat list, Loops §3.1, Collections Part 3
 * §5.1).
 *
 * Each form is checked as the function it stands for: `lo..hi` as
 * `Range.up(lo, hi)`, a position `xs[i]` as `Vector.at(xs, i)`, a key `m[k]` as
 * `Map.get(m, k)`. So an established `Nat` widens into each seat exactly as it
 * widens into those functions' arguments, and a value that cannot enter is
 * refused with the seat's type named as the one expected — never the
 * backwards "expected Nat, found Int" the forms used to report.
 *
 * The bracket has two readings, a position and a slice, chosen by its index's
 * type, so an index closes on its own first — except where its written shape
 * has already chosen: a tower operation is never a `Range`, so `xs[k - 1]` is
 * a position and runs at `Int`.
 */

function javascript(source: string): string {
  const project = compileMain("module Main\n\n" + source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const main = project.modules.find(({ name }) => name === "Main");
  if (main === undefined) throw new Error("Main was not emitted");
  return main.javascript.text;
}

function diagnostics(source: string): readonly string[] {
  return compileMain("module Main\n\n" + source).diagnostics.map(({ message }) => message);
}

async function run(source: string): Promise<Record<string, unknown>> {
  return runMain("module Main\n\n" + source);
}

/** Joins a range's values in iteration order, through the value path. */
const SPELL = "export fun spell(r: Range): String =\n" +
  "    var out = \"\"\n" +
  "    for i in r\n" +
  "        out := \"${out}${i},\"\n" +
  "    out\n";

const SUM = "export fun sum(n: Nat): Int =\n" +
  "    var t = 0\n" +
  "    for i in 1..n\n" +
  "        t := t + i\n" +
  "    t\n";

describe("`..` is checked as `Range.up` is (Loops §3.1, §3.2)", () => {
  test("an established `Nat` widens into either operand, in a loop head and outside one", async () => {
    const exports = await run(
      SPELL + SUM +
        "export fun from(n: Nat): Range = n..(n + 2)\n" +
        "export fun upTo(n: Nat): Range = Range.up(1, n)\n" +
        "let count: Nat = 3\n" +
        "export let top: Int = sum(count)\n" +
        "export let dots: String = spell(1..count)\n" +
        "export let twin: String = spell(upTo(count))\n" +
        "export let shifted: String = spell(from(count))\n",
    );
    expect([exports["top"], exports["dots"], exports["twin"], exports["shifted"]])
      .toEqual([6, "1,2,3,", "1,2,3,", "3,4,5,"]);
  });

  test("an operand is a tree of its own faced by `Int`: `1..(n - 1)` subtracts at `Int`", async () => {
    const exports = await run(
      SPELL +
        "export fun below(n: Nat): Range = 1..(n - 1)\n" +
        "export fun twin(n: Nat): Range = Range.up(1, n - 1)\n" +
        "export let three: String = spell(below(4))\n" +
        "export let none: String = spell(below(0))\n" +
        "export let same: String = spell(twin(4))\n",
    );
    expect([exports["three"], exports["none"], exports["same"]]).toEqual(["1,2,3,", "", "1,2,3,"]);
  });

  test("a `var` and a `let` holding a `Nat` widen as a parameter does", () => {
    expect(diagnostics(
      "export fun a(): Range =\n" +
        "    var v: Nat = 3\n" +
        "    1..v\n" +
        "export fun b(n: Nat): Range =\n" +
        "    let k = n\n" +
        "    k..k\n",
    )).toEqual([]);
  });

  test("a value that cannot enter `Int` is refused, and the seat's `Int` is the one expected", () => {
    expect(diagnostics("export fun r(b: BigInt): Range = 1..b\n"))
      .toEqual(["type mismatch: expected Int, found BigInt"]);
    expect(diagnostics("export fun r(x: Float): Range = x..10\n"))
      .toEqual(["type mismatch: expected Int, found Float"]);
    expect(diagnostics("export fun r(x: Dec): Range = 1..x\n"))
      .toEqual(["type mismatch: expected Int, found Dec"]);
    expect(diagnostics("export let r: Range = 1..2.5\n"))
      .toEqual(["type mismatch: expected Int, found Float"]);
    // The face reaches into the operand's arithmetic, and binds there.
    expect(diagnostics("export fun r(x: Float): Range = 1..(x * 2.0)\n"))
      .toEqual(["`x` is a `Float` and cannot enter `Int`, so the multiplication could not run at `Int`"]);
  });
});

describe("a position is checked as `Vector.at`'s `Int` (Collections Part 3 §5.1, §9)", () => {
  test("an established `Nat` widens into a `Vector`'s and a `String`'s position", async () => {
    const exports = await run(
      "export fun pick(xs: Vector(String), k: Nat): String = xs[k]\n" +
        "export fun letter(s: String, k: Nat): String = s[k]\n" +
        "export fun next(xs: Vector(String), k: Nat): String = xs[k + 1]\n" +
        "export let second: String = pick([\"a\", \"b\", \"c\"], 2)\n" +
        "export let third: String = letter(\"xyz\", 3)\n" +
        "export let last: String = next([\"a\", \"b\", \"c\"], 2)\n",
    );
    expect([exports["second"], exports["third"], exports["last"]]).toEqual(["b", "z", "c"]);
  });

  test("an `Array`'s position takes a `Nat` too", () => {
    expect(diagnostics(
      "export fun pick(xs: Array(Int), k: Nat): Int = xs[k]\n" +
        "export fun before(xs: Array(Int), k: Nat): Int = xs[k - 1]\n",
    )).toEqual([]);
  });

  test("arithmetic written in the brackets is a position, and runs at `Int`", async () => {
    const exports = await run(
      "let xs: Vector(String) = [\"a\", \"b\", \"c\"]\n" +
        "export fun previous(k: Nat): String = xs[k - 1]\n" +
        "export fun grouped(k: Nat): String = xs[((k - 1))]\n" +
        "export fun qualified(k: Nat): String = xs[Signed.subtract(k, 1)]\n" +
        "export fun piped(k: Nat): String = xs[k |> Signed.subtract(1)]\n" +
        "export fun letter(s: String, k: Nat): String = s[k - 1]\n" +
        "export let spelled: String =\n" +
        "    \"${previous(3)}${grouped(3)}${qualified(2)}${piped(2)}${letter(\"xyz\", 2)}\"\n",
    );
    expect(exports["spelled"]).toBe("bbaax");
  });

  test("the position is the one `Vector.at` reads, and no widening is written", () => {
    const text = javascript("export fun previous(xs: Vector(Int), k: Nat): Int = xs[k - 1]\n");
    expect(text).toContain("return __vectorIndex(xs, k - 1);");
  });

  test("a `Range` still slices, written or named", async () => {
    const exports = await run(
      "let xs: Vector(Int) = [10, 20, 30, 40]\n" +
        "export fun show(v: Vector(Int)): String =\n" +
        "    var out = \"\"\n" +
        "    for x in v\n" +
        "        out := \"${out}${x},\"\n" +
        "    out\n" +
        "export fun head(k: Nat): Vector(Int) = xs[1..k]\n" +
        "export fun window(k: Nat): Vector(Int) = xs[(k - 1)..k]\n" +
        "export fun named(r: Range): Vector(Int) = xs[r]\n" +
        "export fun prefix(s: String, k: Nat): String = s[1..k]\n" +
        "export let a: String = show(head(2))\n" +
        "export let b: String = show(window(3))\n" +
        "export let c: String = show(named(Range.up(3, 4)))\n" +
        "export let d: String = prefix(\"hexagon\", 3)\n",
    );
    expect([exports["a"], exports["b"], exports["c"], exports["d"]])
      .toEqual(["10,20,", "20,30,", "30,40,", "hex"]);
  });

  test("an index whose shape does not choose closes on its own, as a dot call's receiver does", () => {
    const refusal = "type `Nat` has no `Signed` instance";
    // The dot: its receiver closes first, and its name need not be a tower
    // member's, so its shape chooses nothing.
    const dot = diagnostics("export fun r(xs: Vector(Int), k: Nat): Int = xs[k.subtract(1)]\n");
    expect(dot).toHaveLength(1);
    expect(dot[0]).toContain(refusal);
    // A forwarding form may yield a `Range`, so its shape chooses nothing either.
    const branch = diagnostics(
      "export fun r(xs: Vector(Int), k: Nat, c: Bool): Int = xs[if c then k - 1 else 1]\n",
    );
    expect(branch).toHaveLength(1);
    expect(branch[0]).toContain(refusal);
  });

  test("a value that cannot enter the position is refused, and `Int` is the one expected", () => {
    expect(diagnostics("export fun r(xs: Vector(Int), b: BigInt): Int = xs[b]\n"))
      .toEqual(["type mismatch: expected Int, found BigInt"]);
    expect(diagnostics("export fun r(s: String, x: Float): String = s[x]\n"))
      .toEqual(["type mismatch: expected Int, found Float"]);
    expect(diagnostics("export fun r(xs: Array(Int), b: BigInt): Int = xs[b]\n"))
      .toEqual(["type mismatch: expected Int, found BigInt"]);
    expect(diagnostics("export fun r(xs: Vector(Int), x: Float): Int = xs[x * 2.0]\n"))
      .toEqual(["`x` is a `Float` and cannot enter `Int`, so the multiplication could not run at `Int`"]);
  });

  test("a negation, `bnot`, a qualified shift and a longer chain are arithmetic too", async () => {
    const exports = await run(
      "let xs: Vector(String) = [\"a\", \"b\", \"c\"]\n" +
        "export fun chain(k: Nat): String = xs[k * 2 - 3]\n" +
        "export let spelled: String = chain(3)\n",
    );
    expect(exports["spelled"]).toBe("c");
    expect(diagnostics(
      "export fun negated(xs: Vector(Int), k: Nat): Int = xs[-k]\n" +
        "export fun complement(xs: Vector(Int), k: Nat): Int = xs[bnot k]\n" +
        "export fun shifted(xs: Vector(Int), k: Nat): Int = xs[Bitwise.shiftLeft(k, 1)]\n",
    )).toEqual([]);
  });
});

describe("a key is checked at the map's key type, as `Map.get`'s is (Collections Part 4, FFI Part 10 §4.1)", () => {
  test("an established `Nat` widens into an `Int` key, and arithmetic runs at the key type", async () => {
    const exports = await run(
      "let names: Map(Int, String) = Map.fromVector([(1, \"one\"), (2, \"two\")])\n" +
        "export fun name(k: Nat): String = names[k]\n" +
        "export fun before(k: Nat): String = names[k - 1]\n" +
        "export let spelled: String = \"${name(2)} ${before(2)}\"\n",
    );
    expect(exports["spelled"]).toBe("two one");
  });

  test("an established `Nat` widens into a `Rat` key through `Rat`'s own conversion", async () => {
    const exports = await run(
      "import Rat\n\n" +
        "let one: Rat = 1\n" +
        "let names: Map(Rat, String) = Map.fromVector([(one, \"one\")])\n" +
        "export fun name(k: Nat): String = names[k]\n" +
        "export let spelled: String = name(1)\n",
    );
    expect(exports["spelled"]).toBe("one");
  });

  test("a `JsMap`'s key takes a `Nat` too", () => {
    expect(diagnostics("export fun r(m: JsMap(Int, String), k: Nat): String = m[k]\n")).toEqual([]);
  });

  test("a declared key variable carrying `Num` is a target, as at `Map.get`", () => {
    expect(diagnostics(
      "export fun r<k: (Num, Hash)>(m: Map(k, String), j: Nat): String = m[j]\n" +
        "export fun g<k: (Num, Hash)>(m: Map(k, String), j: Nat): Option(String) = Map.get(m, j)\n",
    )).toEqual([]);
  });

  test("an inferred key variable is unified with, as at `Map.get`, whichever line gave it `Num` first", () => {
    const refusal = ["type mismatch: expected Nat, found Float"];
    const call = "let m: Nat = 2\nlet found = look(2.5, m)\n";
    // `a + 1` gives `a` its `Num` before the bracket is checked, or after it.
    const before = (read: string): string =>
      "fun look(a, k: Nat) =\n" +
      "    let t = a + 1\n" +
      "    let mm = Map.fromVector([(a, \"x\")])\n" +
      `    ${read}\n` + call;
    const after = (read: string): string =>
      "fun look(a, k: Nat) =\n" +
      "    let mm = Map.fromVector([(a, \"x\")])\n" +
      `    let v = ${read}\n` +
      "    let t = a + 1\n" +
      "    v\n" + call;
    expect(diagnostics(before("mm[k]"))).toEqual(refusal);
    expect(diagnostics(after("mm[k]"))).toEqual(refusal);
    expect(diagnostics(before("Map.get(mm, k)"))).toEqual(refusal);
    expect(diagnostics(after("Map.get(mm, k)"))).toEqual(refusal);
  });

  test("the key type faces the whole index, as `Map.get`'s does", () => {
    expect(diagnostics(
      "export fun decimal(mm: Map(Dec, String)): String = mm[1.5]\n" +
        "export fun decimalTwin(mm: Map(Dec, String)): Option(String) = Map.get(mm, 1.5)\n" +
        // A dot call's receiver takes its seat's expected type (Method Syntax
        // §2.2), so at a key the face reaches `k`; at a position, which has no
        // face until the index has closed, the same index is refused (above).
        "export fun dot(mm: Map(Int, String), k: Nat): String = mm[k.subtract(1)]\n" +
        "export fun dotTwin(mm: Map(Int, String), k: Nat): Option(String) = Map.get(mm, k.subtract(1))\n",
    )).toEqual([]);
  });

  test("a `Nat` widens into a `BigInt` key through a written conversion", () => {
    const text = javascript("export fun r(mm: Map(BigInt, String), k: Nat): String = mm[k]\n");
    expect(text).toMatch(/return __mapIndex\(mm, BigInt\(k\), \w+\);/u);
  });

  test("the map settles the key's type, so the refusal is `JsMap.get`'s, with no function-result report", () => {
    const wrap = "let wrap<a>(x: a): Option(a) = Some(x)\nlet n: Int = 3\n";
    expect(diagnostics(wrap + "export fun r(m: JsMap(Option(Dec), String)): String = m[wrap(n)]\n"))
      .toEqual(["type mismatch: expected Dec, found Int"]);
    expect(diagnostics(
      wrap + "export fun r(m: JsMap(Option(Dec), String)): Option(String) = JsMap.get(m, wrap(n))\n",
    )).toEqual(["type mismatch: expected Dec, found Int"]);
  });

  test("a value that cannot enter the key is refused, and the key type is the one expected", () => {
    expect(diagnostics("export fun r(m: Map(String, Int), k: Nat): Int = m[k]\n"))
      .toEqual(["type mismatch: expected String, found Nat"]);
    expect(diagnostics("export fun r(m: JsMap(String, Int), k: Nat): Int = m[k]\n"))
      .toEqual(["type mismatch: expected String, found Nat"]);
  });
});

describe("a widened bound stays in the counting loop's test (Loops §8)", () => {
  test("a widening that writes nothing is read through: the loop counts to the name", () => {
    const text = javascript(
      SUM +
        "export fun twin(n: Nat): Int =\n" +
        "    var t = 0\n" +
        "    for i in Range.up(1, n)\n" +
        "        t := t + i\n" +
        "    t\n" +
        "export fun down(n: Nat): Int =\n" +
        "    var t = 0\n" +
        "    for i in Range.down(n, 1)\n" +
        "        t := t + i\n" +
        "    t\n",
    );
    expect(text).toContain(
      "function sum(n) {\n  let t = 0;\n  for (let i = 1; i <= n; i++) {\n    t = t + i;\n  }\n  return t;\n}",
    );
    expect(text).toContain(
      "function twin(n) {\n  let t = 0;\n  for (let i = 1; i <= n; i++) {\n    t = t + i;\n  }\n  return t;\n}",
    );
    expect(text).toContain("  for (let i = n; i >= 1; i--) {");
    expect(text).not.toContain("__end");
  });

  test("arithmetic around the name is still read once, before the loop", () => {
    const text = javascript(
      "export fun below(n: Nat): Int =\n" +
        "    var t = 0\n" +
        "    for i in 1..(n - 1)\n" +
        "        t := t + i\n" +
        "    t\n",
    );
    expect(text).toContain("  const __end = n - 1;\n  for (let i = 1; i <= __end; i++) {");
  });

  test("a conversion that writes something is not silent: `BigInt(…)` binds as the call it is", () => {
    const text = javascript("export fun f(x: BigInt, n: Nat, m: Nat): BigInt = x * (n + m : Nat)\n");
    expect(text).toContain("return x * BigInt(n + m);");
  });

  test("a `Nat` `var` bound is read once: the body may assign it", () => {
    const text = javascript(
      "export fun count(): Int =\n" +
        "    var v: Nat = 3\n" +
        "    var t = 0\n" +
        "    for i in 1..v\n" +
        "        t := t + i\n" +
        "    t\n",
    );
    expect(text).toContain("  const __end = v;\n  for (let i = 1; i <= __end; i++) {");
  });
});
