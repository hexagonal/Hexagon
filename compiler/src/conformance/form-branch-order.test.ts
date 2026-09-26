import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

/**
 * Conformance for **each value path meets its expectation at its own turn**
 * (#1107): Functions §4.3's forwarding forms, Numeric Literals §5.1's and §6's
 * order removed outside the tower, and Effects §3.4's second exception
 * extended to a form's value paths (ruling A′).
 *
 * Under a concrete expected type, each branch of an `if`, each arm of a
 * `match` or `try`, a `try`'s body and a block's final expression meet that
 * type on their own — types at the path, colours freshened — and then join,
 * so the colours still merge at the form (Effects §13.2). No path is measured
 * against another: which is written first decides nothing, and every path
 * that cannot meet the type is reported at itself (ruling (i)). A vector
 * literal's elements meet a part outside the tower the same way.
 */

const HEADER = "module Main\n\nimport Rat\n\n";
const FIXTURES =
  "let n: Int = 3\n" +
  "let m: Nat = 2\n" +
  "let price: Dec = 2.50d\n" +
  "let f: Float = 1.5\n" +
  "let g: Float = 2.5\n" +
  "let c: Bool = True\n" +
  "let o1: Option(Int) = Some(n)\n" +
  "let o2: Option(Int) = None\n" +
  "let od: Option(Dec) = Some(price)\n" +
  "let wrap<a>(x: a): Option(a) = Some(x)\n" +
  "exception Oops\n";

/** Each report as `[the text its primary spans, its message]`. */
function reports(source: string): readonly (readonly [string, string])[] {
  const text = HEADER + FIXTURES + source;
  return compileMain(text).diagnostics.map(({ primary, message }) =>
    [text.slice(primary.start.offset, primary.end.offset), message] as const
  );
}

const run = (source: string): Promise<Record<string, unknown>> => runMain(HEADER + FIXTURES + source);

const decFoundInt = "type mismatch: expected Dec, found Int";

/** Numeric Literals §6's function-result report. */
const functionResult = (call: string, type: string, repair: string): string =>
  `\`${call}\` is ${/^[AEIOU]/u.test(type) ? "an" : "a"} \`${type}\` — the type expected here does not ` +
  `reach an argument through a function's result; write \`${repair}\``;

describe("a form's value paths meet a concrete expectation each at its own turn (#1107)", () => {
  test("the wrong branch is reported, once, in either branch order", () => {
    for (const [program, mirror] of [
      ["let r: Option(Dec) = if c then o1 else od\n", "let r: Option(Dec) = if c then od else o1\n"],
      [
        "let r: Option(Dec) = match c\n    True => o1\n    False => od\n",
        "let r: Option(Dec) = match c\n    True => od\n    False => o1\n",
      ],
      [
        "let r: Option(Dec) = try o1\n    catch\n        _ => od\n",
        "let r: Option(Dec) = try od\n    catch\n        _ => o1\n",
      ],
      [
        "let r: Option(Dec) = if c then (if c then o1 else od) else od\n",
        "let r: Option(Dec) = if c then od else (if c then od else o1)\n",
      ],
      [
        "let r: Option(Dec) =\n    let z = 1\n    if c then o1 else od\n",
        "let r: Option(Dec) =\n    let z = 1\n    if c then od else o1\n",
      ],
      ["let r = (if c then o1 else od : Option(Dec))\n", "let r = (if c then od else o1 : Option(Dec))\n"],
      [
        "let takeO(x: Option(Dec)): Unit = ()\nlet r = takeO(if c then o1 else od)\n",
        "let takeO(x: Option(Dec)): Unit = ()\nlet r = takeO(if c then od else o1)\n",
      ],
      [
        "fun h(): Option(Dec) = if c then o1 else od\n",
        "fun h(): Option(Dec) = if c then od else o1\n",
      ],
    ] as const) {
      expect(reports(program), program).toEqual([["o1", decFoundInt]]);
      expect(reports(mirror), mirror).toEqual([["o1", decFoundInt]]);
    }
  });

  test("every path that cannot meet the type is reported at itself (ruling (i))", () => {
    expect(reports("let r: Option(Dec) = if c then o1 else o2\n"))
      .toEqual([["o1", decFoundInt], ["o2", decFoundInt]]);
    expect(reports("let r: Option(Dec) = match n\n    0 => od\n    1 => o1\n    _ => o2\n"))
      .toEqual([["o1", decFoundInt], ["o2", decFoundInt]]);
  });

  test("a function's call on any path draws the function-result report", () => {
    const report = functionResult("wrap(n)", "Option(Int)", "wrap((n: Dec))");
    for (const program of [
      "let r: Option(Dec) = if c then wrap(n) else Some(price)\n",
      "let r: Option(Dec) = if c then Some(price) else wrap(n)\n",
      "let r: Option(Dec) = if c then wrap(n) else None\n",
    ]) {
      expect(reports(program), program).toEqual([["wrap(n)", report]]);
    }
    expect(reports("let r: Option(Dec) = match c\n    True => wrap(n)\n    False => wrap(m)\n")).toEqual([
      ["wrap(n)", report],
      ["wrap(m)", functionResult("wrap(m)", "Option(Nat)", "wrap((m: Dec))")],
    ]);
  });

  test("a gated tower operation on a path is one value of it", () => {
    const refused = [["n + 1", "type mismatch: expected String, found Int"]];
    expect(reports("let r: String = if c then n + 1 else \"x\"\n")).toEqual(refused);
    expect(reports("let r: String = if c then \"x\" else n + 1\n")).toEqual(refused);
    // One refused on its own says nothing more, at the form or at the seat.
    const conflict = [[
      "f",
      "`f` is a `Float` and `price` a `Dec`; an expression's arithmetic runs at one type, and neither " +
        "enters the other; convert one explicitly — `Dec.fromFloat(f, places)`",
    ]];
    for (const program of [
      "let r: String = if c then price * f else \"x\"\n",
      "let r: String = if c then \"x\" else price * f\n",
      "let r: Option(Dec) = if c then price * f else od\n",
    ]) {
      expect(reports(program), program).toEqual(conflict);
    }
  });

  test("the programs that compiled still compile, at the written type", async () => {
    const exports = await run(
      "let r: Option(Dec) = if c then Some(n) else od\n" +
        "let s: Option(Dec) = match c\n    True => None\n    False => Some(0.5)\n" +
        "let h: (Int) -> Dec = if c then (x) => x else (x) => price\n" +
        "export let shown: (String, String, String) = " +
        "(r.map((v) => v.show()).defaultValue(\"none\"), s.map((v) => v.show()).defaultValue(\"none\"), h(4).show())\n",
    );
    expect(exports.shown).toEqual(["3", "none", "4"]);
  });
});

describe("a tree holding a value outside the tower meets a numeric face path by path (#1107)", () => {
  test("a numeric value enters the face or draws the entry report; any other is an ordinary mismatch", () => {
    const entry = "`f` is a `Float` and cannot enter `Dec`, the home `: Dec` writes; convert it explicitly — " +
      "`Dec.fromFloat(f, places)`";
    const string = "type mismatch: expected Dec, found String";
    expect(reports("let r: Dec = if c then \"x\" else f\n")).toEqual([["\"x\"", string], ["f", entry]]);
    expect(reports("let r: Dec = if c then f else \"x\"\n")).toEqual([["f", entry], ["\"x\"", string]]);
    expect(reports("let r: Dec = if c then \"x\" else n\n")).toEqual([["\"x\"", string]]);
    expect(reports("let r: Dec = if c then n else \"x\"\n")).toEqual([["\"x\"", string]]);
    expect(reports("let ident<a>(x: a): a = x\nlet r: Dec = if c then ident(n * 1.5) else \"x\"\n")).toEqual([
      ["ident(n * 1.5)", functionResult("ident(n * 1.5)", "Float", "ident((n * 1.5: Dec))")],
      ["\"x\"", string],
    ]);
    // A numeric tree's declining values are one home refused (#827): once.
    expect(reports("let r: Dec = if c then f else g\n")).toEqual([["f", entry]]);
  });

  test("a declared variable declines in its own words; an operation that stood down says nothing more", () => {
    expect(reports("let fd<a: Num>(x: a): Dec = if c then x else \"x\"\n")).toEqual([
      ["x", "`a` is a declared type variable, but the body requires `Dec`; change the annotation to `Dec`, " +
        "or remove it to let the type be inferred"],
      ["\"x\"", "type mismatch: expected Dec, found String"],
    ]);
    // A path whose operation stood down is refused at itself, with #808's
    // report, once; a numeric tree's is given at its seat, as ever.
    const stoodDown = [
      "n * f",
      "`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`",
    ] as const;
    const string = ["\"x\"", "type mismatch: expected Dec, found String"] as const;
    expect(reports("let r: Dec = if c then n * f else \"x\"\n")).toEqual([stoodDown, string]);
    expect(reports("let r: Dec = if c then \"x\" else n * f\n")).toEqual([string, stoodDown]);
    expect(reports("let r: Dec = if c then n * f else price\n")).toEqual([["Dec", stoodDown[1]]]);
  });
});

describe("a vector literal's elements meet a part outside the tower each at its own turn (#1107)", () => {
  test("in either element order, and inside a form", () => {
    for (const program of [
      "let v: Vector(Option(Dec)) = [o1, od]\n",
      "let v: Vector(Option(Dec)) = [od, o1]\n",
      "let v: Vector(Option(Dec)) = [if c then o1 else od]\n",
      "let v: Vector(Option(Dec)) = [if c then od else o1]\n",
      "let takeV(v: Vector(Option(Dec))): Unit = ()\nlet r = takeV([if c then o1 else od])\n",
    ]) {
      expect(reports(program), program).toEqual([["o1", decFoundInt]]);
    }
    expect(reports("let v: Vector(Option(Dec)) = [wrap(n), od]\n"))
      .toEqual([["wrap(n)", functionResult("wrap(n)", "Option(Int)", "wrap((n: Dec))")]]);
    expect(reports("let v: Vector(String) = [1, n]\n")).toEqual([
      ["1", "integer literal cannot have type `String`"],
      ["n", "type mismatch: expected String, found Int"],
    ]);
  });
});

describe("the colours still meet where they met (Effects §3.4, §13.2)", () => {
  const world = 'extern from "./io.js"\n    fun save(s: String) ->! Unit\n' +
    'let impure(): Unit = save!("x")\nlet pureU(): Unit = ()\n';

  test("a path's colour meets the seat with the whole form, as a constructor's does", () => {
    const refusal = "a `->` arrow promises purity, and this function performs effects — the demand is written " +
      "`->`, the function's face `->?` or `->!`";
    const atSeat = [["Option(() -> Unit)", refusal]];
    expect(reports(world + "let p: Option(() -> Unit) = Some(impure)\n")).toEqual(atSeat);
    expect(reports(world + "let p: Option(() -> Unit) = if c then Some(impure) else None\n")).toEqual(atSeat);
    expect(reports(world + "let p: Option(() -> Unit) = if c then None else Some(impure)\n")).toEqual(atSeat);
    expect(reports(world + "let v: Vector(Option(() -> Unit)) = [Some(impure), None]\n"))
      .toEqual([["Vector(Option(() -> Unit))", refusal]]);
    // Two colours merged at the form are still the form's to report (#1109
    // owns the wording).
    expect(reports(world + "let p: () -> Unit = if c then pureU else impure\n").map(([at]) => at))
      .toEqual(["if c then pureU else impure"]);
  });
});
