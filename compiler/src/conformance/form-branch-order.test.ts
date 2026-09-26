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
 * against another: which is written first decides nothing. Where several
 * cannot meet it, the expression gives one report, at the first, each other
 * a label on it (ruling N3, option 3). A vector literal's elements meet a
 * part outside the tower the same way.
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
  "let incInt(x: Int): Int = x + 1\n" +
  "exception Oops\n";

/**
 * Each report as `[the text its primary spans, its message]`, and, where it
 * carries labels, `[…, [[the text a label spans, its message], …]]`.
 */
function reports(source: string): readonly (readonly unknown[])[] {
  const text = HEADER + FIXTURES + source;
  const at = (span: { start: { offset: number }; end: { offset: number } }): string =>
    text.slice(span.start.offset, span.end.offset);
  return compileMain(text).diagnostics.map(({ primary, message, labels }) =>
    labels === undefined || labels.length === 0
      ? [at(primary), message]
      : [at(primary), message, labels.map((label) => [at(label.span), label.message])]
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

  test("a declared variable counts as written; a part left open keeps the join (ruling B3 (a))", () => {
    const declared = "`a` is a declared type variable, but the body requires `Int`; change the annotation to " +
      "`Int`, or remove it to let the type be inferred";
    for (const program of [
      "fun gk<a>(o: Option(a)): Option(a) = if c then o1 else o\n",
      "fun gk<a>(o: Option(a)): Option(a) = if c then o else o1\n",
      "fun gv<a>(o: Option(a)): Vector(Option(a)) = [o1, o]\n",
      "fun gv<a>(o: Option(a)): Vector(Option(a)) = [o, o1]\n",
    ]) {
      expect(reports(program), program).toEqual([["o1", declared]]);
    }
    // No written type says which path is wrong: the paths join first, and the
    // disagreement is the form's, as ever — a hole the form's own constructor
    // filled included.
    const takeA = "let takeA<a>(x: Option(a)): Unit = ()\n";
    for (const [program, at, message] of [
      ["let r: Option(_) = if c then o1 else od\n", "if c then o1 else od", "type mismatch: expected Int, found Dec"],
      ["let r: Option(_) = if c then od else o1\n", "if c then od else o1", decFoundInt],
      [takeA + "let r = takeA(if c then o1 else od)\n", "if c then o1 else od", "type mismatch: expected Int, found Dec"],
      [takeA + "let r = takeA(if c then od else o1)\n", "if c then od else o1", decFoundInt],
      ["let r: Option(_) = if c then Some(price) else o1\n", "if c then Some(price) else o1", decFoundInt],
      // A `match` joins at its arms, as ever: the later arm.
      ["let r: Option(_) = match c\n    True => o1\n    False => od\n", "od", "type mismatch: expected Int, found Dec"],
    ] as const) {
      expect(reports(program), program).toEqual([[at, message]]);
    }
    // A vector literal's elements are a literal's components: the first to
    // meet the open part fills it, as a tuple's components do.
    expect(reports("let v: Vector(Option(_)) = [o1, od]\n")).toEqual([["od", "type mismatch: expected Int, found Dec"]]);
    expect(reports("let v: Vector(Option(_)) = [od, o1]\n")).toEqual([["o1", decFoundInt]]);
    expect(reports("let od2: Option(Dec) = od\nlet v: Vector(Option(_)) = [o1, od, od2]\n")).toEqual([
      ["od", "type mismatch: expected Int, found Dec", [["od2", "`od2` is an `Option(Dec)`"]]],
    ]);
  });

  test("a path's refusal is what its check reports at the path; its label is what the path was", () => {
    // A demand made elsewhere, validated as a path's check solves a variable,
    // keeps its own report where it was made.
    for (const program of [
      "let h(p) =\n    let q = p + 1\n    let r: String = if c then p else n\n    r\n",
      "let h(p) =\n    let q = p + 1\n    let r: String = if c then n else p\n    r\n",
    ]) {
      expect(reports(program), program).toEqual([
        ["1", "integer literal cannot have type `String`"],
        ["n", "type mismatch: expected String, found Int"],
      ]);
    }
    // A label says what the path was before its check, or repeats its report.
    expect(reports("let r: String = if c then n else 1\n")).toEqual([
      ["n", "type mismatch: expected String, found Int", [["1", "integer literal cannot have type `String`"]]],
    ]);
    expect(reports("let ident<a>(x: a): a = x\nlet r: String = if c then n else ident(1)\n")).toEqual([
      ["n", "type mismatch: expected String, found Int", [["ident(1)", "integer literal cannot have type `String`"]]],
    ]);
    expect(reports("let fr<a>(x: a): Option(Dec) = if c then o1 else x\n"))
      .toEqual([["o1", decFoundInt, [["x", "`x` is an `a`"]]]]);
    expect(reports("let u: Unit = ()\nlet r: Option(Dec) = if c then u else u\n")).toEqual([
      ["u", "type mismatch: expected Option(Dec), found Unit", [["u", "`u` is a `Unit`"]]],
    ]);
  });

  test("several paths refused are one report, at the first, the others its labels", () => {
    const folded = [["o1", decFoundInt, [["o2", "`o2` is an `Option(Int)`"]]]];
    expect(reports("let r: Option(Dec) = if c then o1 else o2\n")).toEqual(folded);
    expect(reports("let r: Option(Dec) = match n\n    0 => od\n    1 => o1\n    _ => o2\n")).toEqual(folded);
    expect(reports("let r: Option(Dec) = if c then (if c then o1 else od) else o2\n")).toEqual(folded);
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
      ["wrap(n)", report, [["wrap(m)", "`wrap(m)` is an `Option(Nat)`"]]],
    ]);
  });

  test("the function-result report is a seat's own: a face siblings settled was expected by no one", () => {
    expect(reports(
      "let h3<t>(x: t, v: Vector(t), y: t): t = x\nlet ods: Vector(Option(Dec)) = [od]\n" +
        "let r = h3(if c then wrap(n) else od, ods, od)\n",
    )).toEqual([["wrap(n)", decFoundInt]]);
  });

  test("a waiting lambda of the wrong arity on a path is refused at itself", () => {
    expect(reports("let takeF(f: (Int) -> Int): Unit = ()\nlet r = takeF(if c then (x, y) => x else incInt)\n"))
      .toEqual([["(x, y) => x", "function arity mismatch: 1 and 2"]]);
  });

  test("a declared variable is refused once, where it first declines", () => {
    expect(reports("let fr<a>(x: a, y: a): Option(Dec) = if c then x else y\n")).toEqual([[
      "x",
      "`a` is a declared type variable, but the body requires `Option(Dec)`; change the annotation to " +
        "`Option(Dec)`, or remove it to let the type be inferred",
    ]]);
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
    // It is one of the expression's refused paths: the others fold into it.
    expect(reports("let r: String = if c then price * f else n\n"))
      .toEqual([[...conflict[0]!, [["n", "`n` is an `Int`"]]]]);
    expect(reports("let r: Dec = if c then (if c then f else \"x\") + price else \"y\"\n")).toEqual([[
      "f",
      "`f` is a `Float` and cannot enter `Dec`, the home `: Dec` writes; convert it explicitly — " +
        "`Dec.fromFloat(f, places)`",
      [["\"x\"", "`\"x\"` is a `String`"], ["\"y\"", "`\"y\"` is a `String`"]],
    ]]);
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
    // The first path refused carries the report; the other is its label.
    expect(reports("let r: Dec = if c then \"x\" else f\n"))
      .toEqual([["\"x\"", string, [["f", "`f` is a `Float`"]]]]);
    expect(reports("let r: Dec = if c then f else \"x\"\n"))
      .toEqual([["f", entry, [["\"x\"", "`\"x\"` is a `String`"]]]]);
    expect(reports("let r: Dec = if c then f else if c then g else \"x\"\n"))
      .toEqual([["f", entry, [["g", "`g` is a `Float`"], ["\"x\"", "`\"x\"` is a `String`"]]]]);
    expect(reports("let r: Dec = if c then \"x\" else n\n")).toEqual([["\"x\"", string]]);
    expect(reports("let r: Dec = if c then n else \"x\"\n")).toEqual([["\"x\"", string]]);
    expect(reports("let ident<a>(x: a): a = x\nlet r: Dec = if c then ident(n * 1.5) else \"x\"\n")).toEqual([
      [
        "ident(n * 1.5)",
        functionResult("ident(n * 1.5)", "Float", "ident((n * 1.5: Dec))"),
        [["\"x\"", "`\"x\"` is a `String`"]],
      ],
    ]);
    // At a dot call's receiver too, where neither receiver report is owed.
    expect(reports("let r: Dec = (if c then f else \"x\").add(price)\n"))
      .toEqual([["f", entry, [["\"x\"", "`\"x\"` is a `String`"]]]]);
    // A numeric tree's declining values are one home refused (#827): once.
    expect(reports("let r: Dec = if c then f else g\n")).toEqual([["f", entry]]);
  });

  test("a declared variable declines in its own words; an operation that stood down says nothing more", () => {
    expect(reports("let fd<a: Num>(x: a): Dec = if c then x else \"x\"\n")).toEqual([
      [
        "x",
        "`a` is a declared type variable, but the body requires `Dec`; change the annotation to `Dec`, " +
          "or remove it to let the type be inferred",
        [["\"x\"", "`\"x\"` is a `String`"]],
      ],
    ]);
    // A path whose operation stood down is refused at itself, with #808's
    // report, once; a numeric tree's is given at its seat, as ever.
    const stoodDown = [
      "n * f",
      "`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`",
    ] as const;
    expect(reports("let r: Dec = if c then n * f else \"x\"\n"))
      .toEqual([[...stoodDown, [["\"x\"", "`\"x\"` is a `String`"]]]]);
    expect(reports("let r: Dec = if c then \"x\" else n * f\n"))
      .toEqual([["\"x\"", "type mismatch: expected Dec, found String", [["n * f", "`n * f` is a `Float`"]]]]);
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
    // Lambda-literal elements too, checked after the others (#1066's schedule).
    for (const program of [
      "let v: Vector((Int) -> Option(Dec)) = [(x) => o1, (x) => od]\n",
      "let v: Vector((Int) -> Option(Dec)) = [(x) => od, (x) => o1]\n",
    ]) {
      expect(reports(program), program).toEqual([["(x) => o1", decFoundInt]]);
    }
    expect(reports("let v: Vector((Int) -> Option(Dec)) = [(x) => o1, (x) => o2]\n"))
      .toEqual([["(x) => o1", decFoundInt, [["(x) => o2", "`(x) => o2` is a `(Int) -> Option(Int)`"]]]]);
    expect(reports("let v: Vector(Option(Dec)) = [o1, od, o2]\n"))
      .toEqual([["o1", decFoundInt, [["o2", "`o2` is an `Option(Int)`"]]]]);
    // A refused `match` is one `ERROR` value: nothing it holds meets the part.
    expect(reports("let v: Vector(Option(Dec)) = [match zzz\n    _ => o1]\n").map(([at]) => at))
      .toEqual(["zzz", "zzz"]);
    expect(reports("let v: Vector(Option(Dec)) = [wrap(n), od]\n"))
      .toEqual([["wrap(n)", functionResult("wrap(n)", "Option(Int)", "wrap((n: Dec))")]]);
    expect(reports("let v: Vector(String) = [1, n]\n"))
      .toEqual([["1", "integer literal cannot have type `String`", [["n", "`n` is an `Int`"]]]]);
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
    // A path refused for its type says nothing more about its colour, at the
    // form or at the seat, in either order.
    const impureI = 'let impureI(x: Int): Option(Int) =\n    save!("x")\n    Some(x)\n' +
      "let pureD(x: Int): Option(Dec) = od\n";
    for (const program of [
      "let v: Vector((Int) -> Option(Dec)) = [impureI]\n",
      "let p: (Int) -> Option(Dec) = if c then impureI else pureD\n",
      "let p: (Int) -> Option(Dec) = if c then pureD else impureI\n",
      "let t: ((Int) -> Option(Dec), Int) = (impureI, 1)\n",
    ]) {
      expect(reports(world + impureI + program), program).toEqual([["impureI", decFoundInt]]);
    }
    // Two colours merged at the form are still the form's to report (#1109
    // owns the wording).
    expect(reports(world + "let p: () -> Unit = if c then pureU else impure\n").map(([at]) => at))
      .toEqual(["if c then pureU else impure"]);
  });
});
