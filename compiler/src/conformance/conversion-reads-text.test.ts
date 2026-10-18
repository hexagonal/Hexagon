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
  "let both(h: (a) -> Unit, y: a): Unit = ()\n" +
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

describe("a knot member's unwritten result is one only inference gave", () => {
  test("refused at a `Float` seat in either member order", () => {
    const a = "    a(n: Int): Float =\n        let y = b(n)\n        let x: Float = y\n        x\n";
    const b = "    b(n) = if n == 0 then 0 else\n        let y = a(n - 1)\n        n\n";
    const report = "`y` is an `Int` only by inference, and an inferred type is not widened to `Float`: " +
      "write `y: Int` where `y` is made, or convert it — `Float.fromInt(y)`";
    expect(refusals("fun\n" + a + b)).toHaveLength(1);
    expect(refusals("fun\n" + b + a)).toEqual([report]);
  });
});
