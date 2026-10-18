/**
 * Conformance for Numeric Literals §5.1's **What the text decides** (#1195).
 *
 * A conversion reads two types, the value's and the seat's, and each must be
 * one the program's text decides (Method Syntax §3.1). A type only inference
 * gave — an untyped parameter's, gathered from its uses — converts nothing and
 * chooses no home, and a seat whose own type is one converts nothing. So the
 * line checked first types the value and decides nothing else: each pair below
 * is pinned in both line orders, and the two orders agree. Each refusal names
 * the written type, and the conversion, which needs none; both compile in
 * either order.
 */

import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics } from "../support/test-project.js";
import * as Typed from "../syntax/typed/index.js";

const fixtures = "module Main\n\n" +
  "let useInt(x: Int): Unit = ()\n" +
  "let useBig(x: BigInt): Unit = ()\n" +
  "let useFloat(x: Float): Unit = ()\n" +
  "let useNat(x: Nat): Unit = ()\n" +
  "let useFloatFn(g: (Float) -> Unit): Unit = ()\n" +
  "let useFloatResult(g: ((Int) -> Float) -> Unit): Unit = ()\n" +
  "let both(h: (a) -> Unit, y: a): Unit = ()\n" +
  "let both2(xs: Vector(a), y: a): Unit = ()\n" +
  "let gI(k: Int): Int = k\n" +
  "let big(): BigInt = 1n\n";

const article = (type: string): string => /^[AEIOU]/u.test(type) ? "an" : "a";

/** §6's report where a value whose type only inference gave would have widened. */
const notWidened = (name: string, from: string, to: string): string =>
  `\`${name}\` is ${article(from)} \`${from}\` only by inference, and an inferred type is not widened to ` +
  `\`${to}\`: write \`${name}: ${from}\` where \`${name}\` is made, or convert it — \`${to}.from${from}(${name})\``;

/** §6's report where such a value would have chosen its tree's home. */
const noHome = (name: string, from: string, home: string, giver: string): string =>
  `\`${name}\` is ${article(from)} \`${from}\` only by inference, and an inferred type chooses no home, so ` +
  `this expression runs at \`${home}\`, the home \`${giver}\` gives it: write \`${name}: ${from}\` where ` +
  `\`${name}\` is made`;

/** §6's report where the seat's type is the one only inference gave. */
const notWidenedInto = (name: string, seat: string, type: string, owner: string, from: string): string =>
  `\`${name}\` is not widened into ${seat}, ${article(type)} \`${type}\` only by inference: write ` +
  `\`${owner}\`'s type where it is made, or convert it — \`${type}.from${from}(${name})\``;

/** A function `f` with `head`, its body `lines` in the given order, then `()`. */
const body = (head: string, lines: readonly string[]): string =>
  `let f${head} =\n` + lines.map((line) => `    ${line}\n`).join("") + "    ()\n";

const refusals = (source: string): readonly string[] => projectDiagnostics(fixtures + source);

function typeOf(source: string, name: string): string {
  const compiled = compileMain(fixtures + source);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const typed = compiled.modules.find(({ source: file }) => file.path === "/main.hex")!.typed;
  const symbol = typed.symbols.find(
    (candidate) => candidate.name === name && candidate.bindingSpan.fileId === typed.fileId,
  );
  if (symbol === undefined) throw new Error(`no symbol \`${name}\``);
  return Typed.displayScheme(symbol.scheme);
}

describe("an untyped parameter at two number seats: refused in either order", () => {
  test("`useInt(p)` and `useBig(p)`", () => {
    expect(refusals(body("(p)", ["useInt(p)", "useBig(p)"]))).toEqual([notWidened("p", "Int", "BigInt")]);
    expect(refusals(body("(p)", ["useBig(p)", "useInt(p)"]))).toEqual(["type mismatch: expected Int, found BigInt"]);
  });

  test("into `Float`, from `Nat`, at a range operand, and in a comparison", () => {
    for (const [lines, first] of [
      [["useInt(p)", "useFloat(p)"], notWidened("p", "Int", "Float")],
      [["useNat(p)", "useInt(p)"], notWidened("p", "Nat", "Int")],
      [["useInt(p)", "let x: Float = p * 2.0"], notWidened("p", "Int", "Float")],
      [["useInt(p)", "let b = p < big()"], notWidened("p", "Int", "BigInt")],
    ] as const) {
      expect(refusals(body("(p)", lines)), lines.join("; ")).toEqual([first]);
      expect(refusals(body("(p)", [...lines].reverse())), lines.join("; ")).toHaveLength(1);
      expect(refusals(body("(p)", [...lines].reverse()))[0], lines.join("; ")).toMatch(/^type mismatch: expected (Int|Nat), found /u);
    }
    const range = ["let r = p..q", "let w: BigInt = p"];
    expect(refusals(body("(p, q)", range))).toEqual([notWidened("p", "Int", "BigInt")]);
    expect(refusals(body("(p, q)", [...range].reverse()))).toHaveLength(1);
  });

  test("a vector beside a defaulted literal", () => {
    for (const made of ["let n = 0", "var n = 0"]) {
      const lines = [made, "let a = [k, n]", "useNat(k)"];
      expect(refusals(body("(k)", lines)), made).toEqual(["type mismatch: expected Nat, found Int"]);
      expect(refusals(body("(k)", [made, "useNat(k)", "let a = [k, n]"])), made)
        .toEqual([notWidened("k", "Nat", "Int")]);
    }
  });

  test("a lambda's parameter, and a `let` made from a parameter", () => {
    expect(refusals("let f() =\n    let g = (p) =>\n        useInt(p)\n        useBig(p)\n    ()\n"))
      .toEqual([notWidened("p", "Int", "BigInt")]);
    expect(refusals(body("(p)", ["let q = p", "useInt(q)", "useBig(q)"]))).toEqual([notWidened("q", "Int", "BigInt")]);
  });
});

describe("an untyped parameter chooses no home", () => {
  test("the home its other values choose, in either order", () => {
    const lines = ["useFloat(p)", "let y = p + n"];
    expect(refusals(body("(p, n: Int)", lines))).toEqual([noHome("p", "Float", "Int", "n")]);
    expect(refusals(body("(p, n: Int)", [...lines].reverse()))).toEqual([notWidened("p", "Int", "Float")]);
  });

  test("an open type an earlier line constrained, at a home without its demand", () => {
    const lines = ["let z = value / value", "let w = count * value"];
    expect(refusals(body("(count: Int, value)", lines))).toEqual([
      "`value` is generic only by inference, carrying `Frac` from its other uses, and an inferred type chooses " +
        "no home, so this expression runs at `Int`, the home `count` gives it, which has no `Frac` instance: " +
        "declare its type where `value` is made — `<a: Frac>` and `value: a`",
    ]);
    // Declared, or converted with no written type, it stays generic in either order.
    for (const [head, chosen] of [["<a: Frac>(count: Int, value: a)", lines], ["(count: Int, value)", [lines[0]!, "let w = Signed.fromInt(count) * value"]]] as const) {
      expect(refusals(body(head, chosen)), head).toEqual([]);
      expect(refusals(body(head, [...chosen].reverse())), head).toEqual([]);
    }
  });

  test("an earlier line's constraint makes it generic in neither order", () => {
    for (const lines of [["let a = p + 1", "let b = p + n"], ["let b = p + n", "let a = p + 1"]]) {
      expect(typeOf(body("(p, n: Nat)", lines), "f"), lines.join("; ")).toBe("(Nat, Nat) -> Unit");
    }
  });
});

describe("a seat whose type only inference gave converts nothing", () => {
  test("an untyped callee's parameter", () => {
    const lines = ["useFloatFn(g)", "g(n)"];
    expect(refusals(body("(g, n: Int)", lines)))
      .toEqual([notWidenedInto("n", "`g`'s parameter", "Float", "g", "Int")]);
    expect(refusals(body("(g, n: Int)", [...lines].reverse()))).toHaveLength(1);
  });

  test("a sibling group's variable an untyped argument solved", () => {
    const lines = ["useFloatFn(g)", "both(g, n)"];
    expect(refusals(body("(g, n: Int)", lines)))
      .toEqual([notWidenedInto("n", "the type `g` gave", "Float", "g", "Int")]);
    expect(refusals(body("(g, n: Int)", [...lines].reverse()))).toHaveLength(1);
    // A module's function decides the variable: `n` widens into it.
    expect(refusals("let f(n: Int) = both(useFloat, n)\n")).toEqual([]);
  });

  test("a lambda result an untyped callee's parameter lands", () => {
    const lines = ["useFloatResult(g)", "g((x) => n)"];
    expect(refusals(body("(g, n: Int)", lines)))
      .toEqual([notWidenedInto("n", "`g`'s parameter", "Float", "g", "Int")]);
    expect(refusals(body("(g, n: Int)", [...lines].reverse()))).toHaveLength(1);
    const written = "(g: ((Int) -> Float) -> Unit, n: Int)";
    expect(refusals(body(written, lines))).toEqual([]);
    expect(refusals(body(written, [...lines].reverse()))).toEqual([]);
  });

  test("a local function's parameter inference gave, through what it captures", () => {
    const lines = ["let g = (x) => ignore([x, p])", "useInt(p)", "g(n)"];
    expect(refusals(body("(p, n: Nat)", lines)))
      .toEqual([notWidenedInto("n", "`g`'s parameter", "Int", "g", "Nat")]);
    expect(refusals(body("(p, n: Nat)", [lines[0]!, lines[2]!, lines[1]!]))).toEqual([notWidened("p", "Nat", "Int")]);
    // Written, the parameter is a seat the text decides, whatever the function captures.
    const written = ["let g = (x: Int) => ignore([x, p])", "useInt(p)", "g(n)"];
    expect(refusals(body("(p, n: Nat)", written))).toEqual([]);
    expect(refusals(body("(p, n: Nat)", [written[0]!, written[2]!, written[1]!]))).toEqual([]);
    // A local function that captures nothing undecided types its parameter by its own body.
    expect(refusals(body("(n: Nat)", ["let g = (x) => useInt(x)", "g(n)"]))).toEqual([]);
  });

  test("a sibling group's variable a value only inference typed in part solved", () => {
    const lines = ["let v = [p]", "useFloat(p)", "both2(v, n)"];
    expect(refusals(body("(p, n: Int)", lines)))
      .toEqual([notWidenedInto("n", "the type `v` gave", "Float", "v", "Int")]);
    expect(refusals(body("(p, n: Int)", [lines[0]!, lines[2]!, lines[1]!]))).toEqual([notWidened("p", "Int", "Float")]);
    expect(refusals(body("(p, n: Int)", ["let v: Vector(Float) = [p]", "useFloat(p)", "both2(v, n)"]))).toEqual([]);
  });

  test("a `var` made from an untyped parameter", () => {
    const lines = ["var x = p", "useFloat(p)", "x := n"];
    expect(refusals(body("(p, n: Int)", lines))).toEqual([notWidenedInto("n", "`x`", "Float", "x", "Int")]);
    expect(refusals(body("(p, n: Int)", ["var x = p", "x := n", "useFloat(p)"])))
      .toEqual([notWidened("p", "Int", "Float")]);
  });
});

describe("the spellings that compile, in either order", () => {
  test("the written type", () => {
    for (const [head, lines] of [
      ["(p: Int)", ["useInt(p)", "useBig(p)"]],
      ["(p: Int)", ["useInt(p)", "useFloat(p)"]],
      ["(p: Float, n: Int)", ["useFloat(p)", "let y = p + n"]],
      ["(k: Nat)", ["let n = 0", "let a = [k, n]", "useNat(k)"]],
      ["(g: (Float) -> Unit, n: Int)", ["useFloatFn(g)", "g(n)"]],
      ["(g: (Float) -> Unit, n: Int)", ["useFloatFn(g)", "both(g, n)"]],
      ["(p, n: Int)", ["var x: Float = p", "useFloat(p)", "x := n"]],
    ] as const) {
      expect(refusals(body(head, lines)), head).toEqual([]);
      const [first, ...rest] = lines;
      const swapped = first!.startsWith("let n") || first!.startsWith("var x")
        ? [first!, ...[...rest].reverse()]
        : [...lines].reverse();
      expect(refusals(body(head, swapped)), `${head} swapped`).toEqual([]);
    }
  });

  test("the conversion, which needs no written type", () => {
    for (const lines of [
      ["useInt(p)", "useBig(BigInt.fromInt(p))"],
      ["useInt(p)", "useFloat(Float.fromInt(p))"],
      ["useNat(p)", "useInt(Int.fromNat(p))"],
    ]) {
      expect(refusals(body("(p)", lines)), lines.join("; ")).toEqual([]);
      expect(refusals(body("(p)", [...lines].reverse())), lines.join("; ")).toEqual([]);
    }
  });

  test("values the text decides widen as ever", () => {
    expect(refusals(body("()", ["var n = 0", "useBig(n)", "useInt(n)"]))).toEqual([]);
    expect(refusals(body("(xs: Vector(Int))", ["let n = xs.length()", "useInt(n)", "useBig(n)"]))).toEqual([]);
    expect(refusals(body("(n: Int)", ["let y = n * 2.0", "useBig(n)"]))).toEqual([]);
  });
});

describe("a local function's call is decided by its own text (Method Syntax §3.1)", () => {
  test("its body decides, whatever it captures beside", () => {
    const g = "let g(k: Int): Int = k\n";
    expect(refusals(g + body("(n)", ["let h = () => g(n)", "let x: Float = h()"]))).toEqual([]);
    expect(refusals(g + body("(n)", ["let h = (m) => g(m)", "let x: Float = h(n)"]))).toEqual([]);
    expect(refusals(g + body("(n)", ["fun h() = g(n)", "let x: Float = h()"]))).toEqual([]);
  });

  test("a body made from what it captures decides as that does", () => {
    const lines = ["useInt(p)", "let h = () => p", "useBig(h())"];
    expect(refusals(body("(p)", lines))).toEqual([
      "`h()` is an `Int` only by inference, and an inferred type is not widened to `BigInt`: " +
        "write `h`'s result type, or convert it — `BigInt.fromInt(h())`",
    ]);
    expect(refusals(body("(p)", ["let h = (): Int => p", "useInt(p)", "useBig(h())"]))).toEqual([]);
  });

  test("a curried local function, and a recursive one, by the paths that decide them", () => {
    expect(refusals(body("(n)", ["let h = (a: Int) => (b: Int) => gI(n)", "let y: Float = h(1)(2)"]))).toEqual([]);
    expect(refusals(body("(n)", [
      "fun loop(i: Int) = if i > 0 then loop(i - 1) else gI(n)",
      "let y: Float = loop(3)",
    ]))).toEqual([]);
    // A recursion whose other path the text does not decide decides nothing.
    expect(refusals(body("(p)", [
      "fun loop(i: Int) = if i > 0 then loop(i - 1) else p",
      "useInt(p)",
      "let y: Float = loop(3)",
    ]))).toEqual(["`loop(3)` is an `Int` only by inference, and an inferred type is not widened to `Float`: " +
      "write `loop`'s result type, or convert it — `Float.fromInt(loop(3))`"]);
  });

  test("a recursive call anywhere but a value path ties the result, in either order", () => {
    const loop = "fun loop(i: Int) =\n        ignore([loop(0), p])\n        if i > 0 then loop(i - 1) else 0";
    const first = refusals(body("(p)", ["useInt(p)", loop, "let y: Float = loop(3)"]));
    const last = refusals(body("(p)", [loop, "let y: Float = loop(3)", "useInt(p)"]));
    expect(first).toHaveLength(1);
    expect(last).toEqual(["type mismatch: expected Int, found Float"]);
    // Local functions that call one another are read as one.
    const block = "fun\n        a(i: Int) =\n            ignore([b(0), p])\n            if i > 0 then b(i - 1) else 0\n" +
      "        b(i: Int) = a(i)";
    expect(refusals(body("(p)", ["useInt(p)", block, "let y: Float = a(3)"]))).toHaveLength(1);
    expect(refusals(body("(p)", [block, "let y: Float = a(3)", "useInt(p)"]))).toHaveLength(1);
  });

  test("a local function's unwritten parameter is decided only where the function is, whole", () => {
    // `p` may be typed above `g` or below it: the parameter it captures is a
    // seat in neither case.
    const g = "let g = (x) => ignore([x, p])";
    const into = notWidenedInto("n", "`g`'s parameter", "Int", "g", "Nat");
    expect(refusals(body("(p, n: Nat)", ["useInt(p)", g, "g(n)"]))).toEqual([into]);
    expect(refusals(body("(p, n: Nat)", [g, "useInt(p)", "g(n)"]))).toEqual([into]);
    // A body that settles the parameter itself still captures `p`: written, it is a seat.
    const settled = "let g = (x) =>\n        useFloat(x)\n        ignore(p)";
    expect(refusals(body("(p, n: Int)", [settled, "g(n)", "useInt(p)"]))).toHaveLength(1);
    expect(refusals(body("(p, n: Int)", [settled, "useInt(p)", "g(n)"]))).toHaveLength(1);
    const written = "let g = (x: Float) =>\n        useFloat(x)\n        ignore(p)";
    expect(refusals(body("(p, n: Int)", [written, "g(n)", "useInt(p)"]))).toEqual([]);
    expect(refusals(body("(p, n: Int)", [written, "useInt(p)", "g(n)"]))).toEqual([]);
  });

  test("a chain of local functions reads in time linear in its length", () => {
    const lines = ["let h0 = () => gI(m)", "let h1 = () => gI(m)"];
    for (let k = 2; k < 60; k += 1) lines.push(`let h${k} = () => if c then h${k - 1}() else h${k - 2}()`);
    lines.push("let y: Float = h59()");
    const start = Date.now();
    expect(refusals(body("(m, c: Bool)", lines))).toEqual([]);
    expect(Date.now() - start).toBeLessThan(20_000);
    // And inside a knot's member, where what it reads of the open members holds while the knot is open.
    const inKnot = ["        let h0 = () => m1(0)", "        let h1 = () => m1(1)"];
    for (let k = 2; k < 60; k += 1) inKnot.push(`        let h${k} = () => if c then h${k - 1}() else h${k - 2}()`);
    inKnot.push("        let y: Float = h59()", "        0");
    const knotStart = Date.now();
    expect(refusals("fun\n    m0(c: Bool): Int =\n" + inKnot.join("\n") +
      "\n    m1(i: Int): Int = if i > 0 then m0(True) else i\n")).toEqual([]);
    expect(Date.now() - knotStart).toBeLessThan(20_000);
  });

  test("a curried local function's written inner parameter, through a `let` of its application", () => {
    const lines = ["let h = (a) => (b: Float) => ignore([a, p])", "let k = h(p)", "k(n)", "useInt(p)"];
    expect(refusals(body("(p, n: Int)", lines))).toEqual([]);
    expect(refusals(body("(p, n: Int)", [lines[0]!, lines[1]!, lines[3]!, lines[2]!]))).toEqual([]);
    expect(refusals(body("(p, n: Int)", ["let h = (a) => (b: Float) => ignore([a, p])", "h(p)(n)", "useInt(p)"]))).toEqual([]);
  });

  test("a lambda a pattern takes apart is read as a call; the report offers the conversion", () => {
    expect(refusals(body("(n)", ["let (h, k) = (() => gI(n), 0)", "let y: Float = h()"]))).toEqual([
      "`h()` is an `Int` only by inference, and an inferred type is not widened to `Float`; " +
        "convert it — `Float.fromInt(h())`",
    ]);
    expect(refusals(body("(n)", ["let (h, k) = (() => gI(n), 0)", "let y: Float = Float.fromInt(h())"]))).toEqual([]);
  });

  test("a generic local function's result is each call's, not its own text's", () => {
    const lines = ["useInt(p)", "let ap = (g: (a) -> b, x: a): b => g(x)", "let z: BigInt = ap((u) => p, 1)"];
    expect(refusals(body("(p)", lines))).toHaveLength(1);
    expect(refusals(body("(p: Int)", lines))).toEqual([]);
  });

  test("inside a knot, in either member order", () => {
    const b = "    b(n: Int): Int =\n        let y = if n == 0 then 0.0 else a(n - 1)\n        n\n";
    const a = "    a(n) =\n        let h = () => b(n)\n        let x: Float = h()\n        0.0\n";
    expect(refusals("fun\n" + b + a)).toEqual([]);
    expect(refusals("fun\n" + a + b)).toEqual([]);
  });
});

describe("a knot member's unwritten result is one only inference gave", () => {
  test("refused at a `Float` seat in either member order", () => {
    const a = "    a(n: Int): Float =\n        let y = b(n)\n        let x: Float = y\n        x\n";
    const b = "    b(n) = if n == 0 then 0 else\n        let y = a(n - 1)\n        n\n";
    const report = "`y` is an `Int` only by inference, and an inferred type is not widened to `Float`: " +
      "write `y: Int` where `y` is made, or convert it — `Float.fromInt(y)`";
    expect(refusals("fun\n" + a + b)).toHaveLength(1);
    expect(refusals("fun\n" + b + a)).toEqual([report]);
  });

  test("a parameter its declaration leaves unwritten is no seat to widen into, in either member order", () => {
    const a = "    a(n: Int): Float =\n        c(n)\n";
    const c = (parameter: string): string => `    c(${parameter}): Float =\n        let y = a(0)\n        x\n`;
    expect(refusals("fun\n" + a + c("x"))).toHaveLength(1);
    expect(refusals("fun\n" + c("x") + a)).toEqual([notWidenedInto("n", "`c`'s parameter", "Float", "c", "Int")]);
    // Written, the parameter is a seat the text decides, and `n` widens into it.
    expect(refusals("fun\n" + a + c("x: Float"))).toEqual([]);
    expect(refusals("fun\n" + c("x: Float") + a)).toEqual([]);
  });
});
