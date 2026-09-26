import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";
import * as Typed from "../syntax/typed/index.js";

/**
 * Conformance for **container faces** (#1066) and **the argument's spine**
 * (#1096): Functions §4.3's literal forms, constructor application, argument
 * spine and component schedule, and Numeric Literals §5.1's and §6's pins for
 * them.
 *
 * A written face reaches a tuple, record, or vector literal's components and a
 * `union` or `record` constructor's arguments, and never an argument through
 * any other function's result. A call sees through exactly the forms its
 * expected types reach inward through: a lambda literal anywhere on an
 * argument's spine waits for the call's second pass (ruling A2 at depth), and
 * a value the call reads against a bare type variable of its callee's
 * parameters is a sibling in that variable's group.
 */

const HEADER = "module Main\n\nimport Rat\n\n";
const FIXTURES =
  "let n: Int = 3\n" +
  "let m: Nat = 2\n" +
  "let price: Dec = 2.50d\n" +
  "let c: Bool = True\n" +
  "let prices: Vector(Dec) = [price]\n" +
  "let ints: Vector(Int) = [n]\n" +
  "let ident<a>(x: a): a = x\n" +
  "let incInt(x: Int): Int = x + 1\n" +
  "let natF(x: Nat): Nat = x\n" +
  "let apply2<a>(x: a, h: (a) -> a): a = h(x)\n" +
  "record Point = {x: Dec, y: Dec}\n" +
  "record Point2(a) = {x: a, y: a}\n" +
  "record Wrapper(a) = {value: a}\n";

const refusals = (source: string): readonly string[] => projectDiagnostics(HEADER + FIXTURES + source);
const run = (source: string): Promise<Record<string, unknown>> => runMain(HEADER + FIXTURES + source);

/** The scheme the checker gave a top-level binding, as it renders it. */
function typeOf(source: string, name: string): string {
  const compiled = compileMain(HEADER + FIXTURES + source);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const typed = compiled.modules.find(({ source: file }) => file.path === "/main.hex")!.typed;
  const symbol = typed.symbols.find(
    (candidate) => candidate.name === name && candidate.bindingSpan.fileId === typed.fileId,
  );
  if (symbol === undefined) throw new Error(`no symbol \`${name}\``);
  return Typed.displayScheme(symbol.scheme);
}

/** §6's settled-callback report. */
const settled = (sibling: string, home: string, body: string, repairs: string, seat = "call"): string =>
  `\`${sibling}\` settled this ${seat}'s \`${home}\` before the callback was checked, and the ` +
  `callback's body returns \`${body}\` — a callback's body chooses no type for the values beside ` +
  `it; ${repairs}`;
const settledAtNat = settled("m", "Nat", "Int", "write `(m: Int)`, or annotate the callback: `(v: Int) => …`");

/** §6's function-result report. */
const functionResult = (call: string, type: string, repair: string): string =>
  `\`${call}\` is ${/^[AEIOU]/u.test(type) ? "an" : "a"} \`${type}\` — the type expected here does not ` +
  `reach an argument through a function's result; write \`${repair}\``;

describe("the literal forms hand each component its part (#1066)", () => {
  test("tuple, record, `with` update, and vector literals, each at Dec", async () => {
    const exports = await run(
      "let t: (Dec, Dec) = (n, 0.5)\n" +
        "let r: {x: Dec} = {x = n}\n" +
        "let p = Point({x = n, y = price})\n" +
        "let q = {p with x = n}\n" +
        "export let shown: (String, String, String, String, String) = " +
        "(t.item1.show(), t.item2.show(), r.x.show(), p.x.show(), q.x.show())\n",
    );
    expect(exports.shown).toEqual(["3", "0.5", "3", "3", "3"]);
    for (const [program, type] of [
      ["let v: Vector(Dec) = [n, 0.5]\n", "Vector(Dec)"],
      ["let v: Vector(Dec) = [n]\n", "Vector(Dec)"],
      ["let v: Vector((Dec, Dec)) = [(n, 1), (2, price)]\n", "Vector((Dec, Dec))"],
    ] as const) {
      expect(typeOf(program, "v"), program).toBe(type);
    }
  });

  test("a component meets any part at its turn, as a call's argument meets its parameter", () => {
    const wrap = "let wrap<a>(x: a): Option(a) = Some(x)\n";
    expect(typeOf(wrap + "let h<b>(o: Option(Dec), y: b): b = y\nfun outer(p) = h(wrap(p), p + 0.5)\n", "outer"))
      .toBe("Dec -> Dec");
    expect(typeOf(wrap + "fun outer(p) =\n    let t: (Option(Dec), _) = (wrap(p), p + 0.5)\n    t\n", "outer"))
      .toBe("Dec -> (Option(Dec), Dec)");
    expect(typeOf(wrap + "fun outer(p) =\n    let t: {o: Option(Dec), y: _} = {o = wrap(p), y = p + 0.5}\n    t\n", "outer"))
      .toBe("Dec -> {o: Option(Dec), y: Dec}");
  });

  test("an operation standing down as a vector's element is reported as a component's is", () => {
    const stoodDown = ["`f` is a `Float` and cannot enter `Dec`, so the multiplication could not run at `Dec`"];
    expect(refusals("let f: Float = 1.5\nlet a: Vector(Dec) = [f * 2, price]\n")).toEqual(stoodDown);
    expect(refusals("let f: Float = 1.5\nlet a: (Dec, Int) = (f * 2, 1)\n")).toEqual(stoodDown);
  });

  test("a `with` update's head is read as the overrides leave it", () => {
    expect(typeOf("let norm(q: Point): Dec = q.x\nfun outer(p) = {p with x = norm(p)}\n", "outer")).toBe("Point -> Point");
    expect(refusals("fun outer(r) = {r with count = r.total + 1}\n"))
      .toEqual(["record update cannot add fields; the input has no field `count`"]);
    expect(typeOf("fun outer(r) = {r with count = r.count + 1}\n", "outer"))
      .toBe("<a: Num> {count: a, ...b} -> {count: a, ...b}");
  });

  test("a match function as a tuple component lands its part", () => {
    expect(refusals(
      "let pair: ((Int) -> String, Int) = (match\n    k when k < 0 => \"negative\"\n    _ => \"other\"\n, 1)\n",
    )).toEqual([]);
  });

  test("a tuple literal of the wrong arity is the arity mismatch it is", () => {
    expect(refusals("let t: (Dec, Int) = (1, 2, 3)\n")).toEqual(["tuple arity mismatch: 2 and 3"]);
  });
});

describe("a constructor application's own expected type (#1066)", () => {
  test("reaches its arguments, through a forwarding form too", async () => {
    const exports = await run(
      "let a: Option(Dec) = Some(n)\n" +
        "let b: Result(Dec, String) = Ok(n)\n" +
        "let d: Option(Dec) = Some(n * 1.5)\n" +
        "let e: Option(Dec) = if c then Some(n) else None\n" +
        "let w: Wrapper(Dec) = Wrapper({value = n})\n" +
        "let show(o: Option(Dec)): String = match o\n    Some(x) => x.show()\n    None => \"none\"\n" +
        "export let shown: (String, String, String, String) = (show(a), show(d), show(e), w.value.show())\n",
    );
    expect(exports.shown).toEqual(["3", "4.5", "3", "3"]);
  });

  test("its multiplication runs at the face", () => {
    const compiled = compileMain(HEADER + FIXTURES + "let d: Option(Dec) = Some(n * 1.5)\n");
    expect(compiled.diagnostics).toEqual([]);
    const main = compiled.modules.find(({ name }) => name === "Main")!;
    const line = main.javascript.text.split("\n").find((text) => text.includes("const d ="))!;
    // The literal is the `d` literal of its digits, and the multiplication is
    // `Dec`'s, not JavaScript's.
    expect(line).toContain("unscaled: 15n, places: 1");
    expect(line).not.toMatch(/[\w)] \* [\w(]/u);
  });

  test("a companion dot call's receiver hands its element to a literal argument", () => {
    // The receiver's seat is settled before a landing argument elaborates
    // (Method Syntax §2.2), and a literal or constructor application lands.
    expect(typeOf("let pairs: Vector((Dec, Dec)) = [(price, price)]\nlet a = pairs.append((n, 0.5))\n", "a"))
      .toBe("Vector((Dec, Dec))");
    expect(typeOf("let opts: Vector(Option(Dec)) = [None]\nlet a = opts.append(Some(n))\n", "a"))
      .toBe("Vector(Option(Dec))");
  });

  test("a constructor in grouping parentheses is a constructor", () => {
    expect(typeOf("let a: Option(Dec) = (Some)(n)\n", "a")).toBe("Option(Dec)");
  });

  test("its expectation's colours are left for the seat, as a literal's parts' are", () => {
    // Effects §13.2's paired requirement: the inline and named spellings agree,
    // and the pin stands where the annotation writes the colour.
    const world = 'extern from "./io.js"\n    fun save(s: String) ->! Unit\nlet impure(): Unit = save!("x")\n';
    const at = (source: string): readonly string[] => {
      const text = HEADER + FIXTURES + world + source;
      return compileMain(text).diagnostics.map(({ primary }) => text.slice(primary.start.offset, primary.end.offset));
    };
    const inline = at("let p: Option(() -> Unit) = Some(impure)\n");
    expect(inline).toEqual(["Option(() -> Unit)"]);
    expect(at("let o = Some(impure)\nlet p: Option(() -> Unit) = o\n")).toEqual(inline);
    expect(at("let p: (() -> Unit, Int) = (impure, 1)\n")).toEqual(["(() -> Unit, Int)"]);
    // At an honor seat, the narrower-acceptance row stands at the annotation.
    expect(at(
      "constraint C<r> =\n    go(runner: r, b: () ->! Unit) -> Unit\nrecord R = { id: Int }\n" +
        "honor C<R> =\n    go(runner, b) =\n        let p: Option(() -> Unit) = Some(b)\n        ()\n",
    )).toEqual(["Option(() -> Unit)"]);
  });

  test("another head declines, with no propagation artifact", () => {
    expect(refusals("let a: Result(Dec, String) = Some(n)\n"))
      .toEqual(["type mismatch: expected Result(Dec, String), found Option(Int)"]);
  });
});

describe("a face through a function's result (Numeric Literals §6's function-result report)", () => {
  const wrap = "let wrap<a>(x: a): Option(a) = Some(x)\n";

  test("names the call, its type, and the ascription that compiles", () => {
    expect(refusals(wrap + "let a: Option(Dec) = wrap(n)\n"))
      .toEqual([functionResult("wrap(n)", "Option(Int)", "wrap((n: Dec))")]);
    expect(refusals(wrap + "let a: Option(Dec) = wrap(0.5)\n"))
      .toEqual([functionResult("wrap(0.5)", "Option(Float)", "wrap((0.5: Dec))")]);
    expect(refusals("let a: Dec = ident(n * 1.5)\n"))
      .toEqual([functionResult("ident(n * 1.5)", "Float", "ident((n * 1.5: Dec))")]);
    // And each repair compiles.
    expect(refusals(wrap + "let a: Option(Dec) = wrap((n: Dec))\n")).toEqual([]);
    expect(refusals(wrap + "let a: Option(Dec) = wrap((0.5: Dec))\n")).toEqual([]);
    expect(refusals("let a: Dec = ident((n * 1.5: Dec))\n")).toEqual([]);
  });

  test("at an argument, in a branch, and as a literal's component", () => {
    const report = functionResult("ident(n * 1.5)", "Float", "ident((n * 1.5: Dec))");
    expect(refusals("let useD(x: Dec): Dec = x\nlet a = useD(ident(n * 1.5))\n")).toEqual([report]);
    expect(refusals("let a: Dec = if c then ident(n * 1.5) else price\n")).toEqual([report]);
    expect(refusals("let a: (Dec, Int) = (ident(n * 1.5), 1)\n")).toEqual([report]);
    expect(refusals(wrap + "let a: (Option(Dec), Int) = (wrap(n), 1)\n"))
      .toEqual([functionResult("wrap(n)", "Option(Int)", "wrap((n: Dec))")]);
  });

  test("through a forwarding form's branch, and as a vector's element", () => {
    const report = functionResult("wrap(n)", "Option(Int)", "wrap((n: Dec))");
    expect(refusals(wrap + "let a: Option(Dec) = if c then wrap(n) else None\n")).toEqual([report]);
    expect(refusals(wrap + "let a: (Option(Dec), Int) = (if c then wrap(n) else None, 1)\n")).toEqual([report]);
    expect(refusals(wrap + "let a: Vector(Option(Dec)) = [wrap(n)]\n")).toEqual([report]);
  });

  test("names every argument a repair ascribes, where the home's value stands", () => {
    const pick2 = "let pick2<a>(x: a, y: a): Option(a) = Some(x)\n";
    expect(refusals(pick2 + "let a: Option(Dec) = pick2(n, m)\n"))
      .toEqual([functionResult("pick2(n, m)", "Option(Int)", "pick2((n: Dec), m)")]);
    expect(refusals(pick2 + "let a: Option(Dec) = pick2(n, 0.5)\n"))
      .toEqual([functionResult("pick2(n, 0.5)", "Option(Float)", "pick2(n, (0.5: Dec))")]);
    expect(refusals(pick2 + "let a: Option(Dec) = pick2((n: Dec), m)\n")).toEqual([]);
    expect(refusals(pick2 + "let a: Option(Dec) = pick2(n, (0.5: Dec))\n")).toEqual([]);
  });

  test("is a seat's own: a type siblings settled among themselves was expected by no one", () => {
    const mismatch = ["type mismatch: expected Dec, found Int"];
    expect(refusals(wrap + "let pick<a>(x: a, y: a): a = x\nlet a = pick(Some(price), wrap(n))\n")).toEqual(mismatch);
    expect(refusals(wrap + "let a = [Some(price), wrap(n)]\n")).toEqual(mismatch);
    expect(refusals(wrap + "let a = if c then Some(price) else wrap(n)\n")).toEqual(mismatch);
    // A parameter written as a bare variable supplies no home.
    expect(refusals(wrap + "let a = prices.append(wrap(n))\n"))
      .toEqual(["type mismatch: expected Dec, found Option(Int)"]);
    // Nor does a sibling group an earlier argument settled, through a form.
    const settledBySibling = refusals(
      "let h3<a>(v: Vector(a), x: a): a = x\nlet a = h3(prices, if c then ident(n * 1.5) else price)\n",
    );
    expect(settledBySibling).toHaveLength(1);
    expect(settledBySibling[0]).not.toContain("through a function's result");
  });

  test("is withheld wherever its repair would not compile", () => {
    // The callee's constraint is not the face's: `Dec` carries no `Bitwise`.
    expect(refusals("let bits<a: Bitwise>(x: a): Option(a) = Some(x)\nlet a: Option(Dec) = bits(n)\n"))
      .toEqual(["type mismatch: expected Dec, found Int"]);
    // The variable is written inside another parameter.
    expect(refusals(
      "let pushOpt<a>(x: a, xs: Vector(a)): Option(a) = Some(x)\nlet a: Option(Dec) = pushOpt(n, ints)\n",
    )).toEqual(["type mismatch: expected Dec, found Int"]);
    // An argument at the variable's seats would not enter the face.
    expect(refusals("let f: Float = 1.5\nlet pick<a>(x: a, y: a): a = x\nlet a: Dec = pick(n, f)\n"))
      .toEqual(["type mismatch: expected Dec, found Float"]);
  });
});

describe("the argument's spine (#1096)", () => {
  const g5 = "let g5<t>(x: t, p: ((t) -> t, Int)): t = x\n";
  const g5s = "let g5s<t>(p: ((t) -> t, Int), x: t): t = x\n";
  const g6 = "let g6<t>(x: t, p: Option((t) -> t)): t = x\n";
  const g7 = "let g7<t>(x: t, p: Vector((t) -> t)): t = x\n";
  const g9 = "let g9<t>(x: t, p: {f: (t) -> t}): t = x\n";
  const g10 = "let g10<t>(x: t, p: Vector((Int, (t) -> t))): t = x\n";

  test("a callback anywhere on the spine chooses no home for the values beside it", () => {
    for (const program of [
      g5 + "let a = g5(m, ((v) => v + n, 1))\n",
      g5s + "let a = g5s(((v) => v + n, 1), m)\n",
      g6 + "let a = g6(m, Some((v) => v + n))\n",
      g7 + "let a = g7(m, [(v) => v + n])\n",
      g9 + "let a = g9(m, {f = (v) => v + n})\n",
      g10 + "let a = g10(m, [(1, (v) => v + n)])\n",
      "let a = apply2(m, if c then (v) => v + n else ident)\n",
      "let a = apply2(m, match c\n        True => (v) => v + n\n        False => ident)\n",
      "let a = apply2(m, if c then\n        let k2 = 1\n        (v) => v + n + k2\n    else ident)\n",
    ]) {
      expect(refusals(program), program).toEqual([settledAtNat]);
    }
  });

  test("its written face is part of the first pass", () => {
    for (const [program, name] of [
      [g5 + "let a = g5(m, ((v: Int) => v + n, 1))\n", "a"],
      [g5s + "let a = g5s(((v: Int) => v + n, 1), m)\n", "a"],
      [g6 + "let a = g6(m, Some((v: Int) => v + n))\n", "a"],
      [g7 + "let a = g7(m, [(v: Int) => v + n])\n", "a"],
      [g9 + "let a = g9(m, {f = (v: Int) => v + n})\n", "a"],
      [g10 + "let a = g10(m, [(1, (v: Int) => v + n)])\n", "a"],
      ["let a = apply2(m, if c then (v: Int) => v + n else ident)\n", "a"],
    ] as const) {
      expect(typeOf(program, name), program).toBe("Int");
    }
  });

  test("a named function on a value path is a value of the first pass", () => {
    expect(typeOf("let a = apply2(m, if c then (v) => v + n else incInt)\n", "a")).toBe("Int");
  });

  test("where a value checked at its turn settled the variable, the mismatch is the ordinary one", () => {
    expect(refusals("let a = apply2(m, if c then (v) => v + n else natF)\n"))
      .toEqual(["type mismatch: expected Nat, found Int"]);
  });

  test("a callback in grouping parentheses is a callback (#1099)", () => {
    expect(typeOf("let a = apply2(m, ((v: Int) => v + n))\n", "a")).toBe("Int");
    expect(typeOf("let a = apply2(m, ((v): Int => v + n))\n", "a")).toBe("Int");
    expect(refusals("let a = apply2(m, ((v) => v + n))\n")).toEqual([settledAtNat]);
  });

  test("a literal's component settling the call is named", () => {
    const g = "let g<t>(p: ((t) -> t, t)): Int = 1\n";
    expect(refusals(g + "let a = g(((v) => v * price, n))\n")).toEqual([
      settled("n", "Int", "Dec", "write `(n: Dec)`, or annotate the callback: `(v: Dec) => …`"),
    ]);
    expect(refusals(g + "let a = g(((v: Dec) => v * price, n))\n")).toEqual([]);
  });

  test("a match function as a tuple component at a callback-first signature reads its arms' type", () => {
    expect(refusals(
      "let cbFirst<a>(p: ((a) -> String, Int), xs: Vector(a)): Int = 1\n" +
        "let a = cbFirst((match\n    k when k < 0 => \"negative\"\n    _ => \"other\"\n, 1), ints)\n",
    )).toEqual([]);
  });

  test("the values on a spine are siblings, in either order", () => {
    const signatures =
      "let both<a>(x: a, y: Vector(a)): a = x\n" +
      "let bothR<a>(y: Vector(a), x: a): a = x\n" +
      "let both3<a>(y: Vector(a), z: Vector(a)): Vector(a) = y\n" +
      "let pairUp<t>(p: (t, t)): t = p.item1\n" +
      "let bothO<a>(x: a, o: Option(a)): a = x\n" +
      "let bothW<a>(x: a, w: Wrapper(a)): a = x\n";
    for (const [call, type] of [
      ["both(price, [n])", "Dec"],
      ["bothR([0.5], price)", "Dec"],
      ["both3(prices, [n])", "Vector(Dec)"],
      ["both3([n], prices)", "Vector(Dec)"],
      ["pairUp((n, price))", "Dec"],
      ["pairUp((price, n))", "Dec"],
      ["bothO(price, Some(n))", "Dec"],
      ["bothW(price, Wrapper({value = n}))", "Dec"],
      ["both(price, if c then [n] else prices)", "Dec"],
    ] as const) {
      expect(typeOf(signatures + `let a = ${call}\n`, "a"), call).toBe(type);
    }
  });

  test("a sibling's promoted literal enters its home", () => {
    const source = "let bothR<a>(y: Vector(a), x: a): Vector(a) = y\nlet a = bothR([0.5], price)\n";
    expect(typeOf(source, "a")).toBe("Vector(Dec)");
    const compiled = compileMain(HEADER + FIXTURES + source);
    const main = compiled.modules.find(({ name }) => name === "Main")!;
    const line = main.javascript.text.split("\n").find((text) => text.includes("const a ="))!;
    expect(line).toContain("unscaled: 5n, places: 1");
  });

  test("a value in grouping parentheses is a sibling as written", () => {
    const signatures =
      "let both<a>(x: a, y: Vector(a)): a = x\n" +
      "let pairUp<t>(p: (t, t)): t = p.item1\n" +
      "let bothO<a>(x: a, o: Option(a)): a = x\n" +
      "let bothW<a>(x: a, w: Wrapper(a)): a = x\n";
    for (const call of [
      "both(price, [(n)])",
      "pairUp(((n), price))",
      "pairUp((price, (n)))",
      "bothO(price, Some((n)))",
      "bothW(price, Wrapper({value = (n)}))",
      "both(price, if c then [(n)] else prices)",
    ]) {
      expect(typeOf(signatures + `let a = ${call}\n`, "a"), call).toBe("Dec");
    }
    expect(refusals("let g<t>(p: ((t) -> t, t)): Int = 1\nlet a = g(((v) => v * price, (n)))\n")).toEqual([
      settled("n", "Int", "Dec", "write `(n: Dec)`, or annotate the callback: `(v: Dec) => …`"),
    ]);
  });

  test("the groups are read before the first argument, and never revisited", () => {
    const k = "let k<a, b>(f: (a) -> b, p: (a, b)): Int = 1\nlet k2<a, b>(f: (a) -> b, x: a, y: b): Int = 1\n";
    expect(refusals(k + "let a = k(ident, (n, price))\n")).toEqual(refusals(k + "let a = k2(ident, n, price)\n"));
    expect(refusals(k + "let a = k(ident, (n, price))\n")).toHaveLength(1);
  });

  test("where the shapes part, a literal is one value", () => {
    expect(refusals("let pick<a>(x: a, y: a): a = x\nlet a = pick([n], [price])\n")).toHaveLength(1);
  });

  test("a `with` update's override joins no group, and its callback waits", () => {
    // `{rp with x = n}` is one value at the call: its override is checked
    // against its head's field, `Point2(Int)`'s `Int`.
    expect(typeOf(
      "let rp: Point2(Int) = Point2({x = 1, y = 2})\nlet both<a>(x: a, y: Point2(a)): a = x\n" +
        "let a = both(n, {rp with x = n})\n",
      "a",
    )).toBe("Int");
    expect(refusals(
      "let rf = {f = (q) => q}\nlet gw<t>(x: t, r: {f: (t) -> t}): t = x\n" +
        "let a = gw(m, {rf with f = (v) => v + n})\n",
    )).toEqual([settledAtNat]);
  });

  test("a dot call's receiver is on no spine", () => {
    expect(refusals("let a = [m].append(n)\n")).toHaveLength(1);
    expect(typeOf("let a = Vector.append([m], n)\n", "a")).toBe("Vector(Int)");
  });

  test("a literal whose shape the spine does not read receives what the schedule solved", () => {
    const vecDecToInt = "let vecDecToInt(v: Vector(Dec)): Int = 1\n";
    expect(refusals(vecDecToInt + "let pickF<a>(f: (a) -> Int, y: a): Int = 1\nlet a = pickF(vecDecToInt, [n])\n"))
      .toEqual([]);
    expect(refusals(vecDecToInt + "let pickF2<a>(y: a, f: (a) -> Int): Int = 1\nlet a = pickF2([n], vecDecToInt)\n"))
      .toHaveLength(1);
  });

  test("a constructor whose shape the spine does not read groups its own literal's fields", () => {
    for (const [program, name, type] of [
      ["let useV<b>(v: Vector(b)): b = v[1]\nlet a = useV([Point2({x = n, y = price})])\n", "a", "Point2(Dec)"],
      [
        "let pickP<a>(x: a, y: a): a = x\nlet p0: Point2(Dec) = Point2({x = price, y = price})\n" +
          "let a = pickP(Point2({x = n, y = price}), p0)\n",
        "a",
        "Point2(Dec)",
      ],
      ["let a = Point2({x = n, y = price})\n", "a", "Point2(Dec)"],
    ] as const) {
      expect(typeOf(program, name), program).toBe(type);
    }
    expect(typeOf("fun outer(h) = h(Point2({x = n, y = price}))\n", "outer")).toBe("(Point2(Dec) -> a) -> a");
  });

  test("a waiting lambda's written face lands in such a constructor's own first pass", () => {
    const holder = "union Holder2(a) = Holder2((a) -> a, a)\n";
    expect(typeOf(
      holder + "let pickP2<a>(x: a, y: a): a = x\nlet h0: Holder2(Int) = Holder2((q) => q, 1)\n" +
        "let a = pickP2(Holder2((v: Int) => v + n, m), h0)\n",
      "a",
    )).toBe("Holder2(Int)");
    expect(typeOf(holder + "let a = Holder2((v: Int) => v + n, m)\n", "a")).toBe("Holder2(Int)");
  });

  test("a stand-in's colour is held until the body closes", () => {
    const demand = refusals("let runBang(h: () ->! Unit): Unit = ()\nlet a = runBang(() => ())\n");
    expect(demand).toHaveLength(1);
    expect(refusals("let optBang(o: Option(() ->! Unit)): Unit = ()\nlet a = optBang(Some(() => ()))\n"))
      .toEqual(demand);
  });

  test("a nested stand-in of the wrong arity is §5's arity error", () => {
    expect(refusals(g6 + "let a = g6(m, Some((v, w) => v + w))\n")).toEqual(["function arity mismatch: 1 and 2"]);
    expect(refusals("let a = apply2(m, (v, w) => v + w)\n")).toEqual(["function arity mismatch: 1 and 2"]);
  });
});

describe("the component schedule, on no spine (#1066)", () => {
  test("a callback's body chooses no home for the components beside it", () => {
    const f2 = "let f2<t>(g: (Int) -> ((t) -> t, t)): Int = 1\n";
    expect(refusals(f2 + "let a = f2((x) => ((v) => v * price, n))\n")).toEqual([
      settled("n", "Int", "Dec", "write `(n: Dec)`, or annotate the callback: `(v: Dec) => …`", "tuple"),
    ]);
    expect(refusals(f2 + "let a = f2((x) => ((v: Dec) => v * price, n))\n")).toEqual([]);
    const fr = "let fr<t>(g: (Int) -> {h: (t) -> t, y: t}): Int = 1\n";
    expect(refusals(fr + "let a = fr((x) => {h = (v) => v * price, y = n})\n")).toEqual([
      settled("n", "Int", "Dec", "write `(n: Dec)`, or annotate the callback: `(v: Dec) => …`", "record"),
    ]);
  });

  test("components at one variable close alone, in source order", () => {
    const f = "let f<a>(g: (Int) -> (a, a)): a = g(1).item1\n";
    expect(typeOf(f + "let a = f((x) => (price, n))\n", "a")).toBe("Dec");
    expect(refusals(f + "let a = f((x) => (n, price))\n")).toHaveLength(1);
  });

  test("a callback one level down is checked within its component's turn", () => {
    expect(typeOf(
      "let f4<t>(g: (Int) -> (Option((t) -> t), t)): t = g(1).item2\n" +
        "let a = f4((x) => (Some((v) => v * price), n))\n",
      "a",
    )).toBe("Dec");
  });
});

describe("the deferred-lambda pair, at depth (#1096)", () => {
  const fixtures = "let one: Int = 1\nlet useFloat(x: Float): Float = x\nlet useNat(x: Nat): Nat = x\n";

  test("a callback's position relative to its non-lambda siblings is unobservable", () => {
    const first = "let f5<a, b, c>(p: ((a) -> b, Int), q: c): Int = 1\n";
    const second = "let f5<a, b, c>(q: c, p: ((a) -> b, Int)): Int = 1\n";
    expect(typeOf(fixtures + first + "fun outer(p) = f5(((x) => useFloat(p), 1), p + one)\n", "outer"))
      .toBe("Int -> Int");
    expect(typeOf(fixtures + second + "fun outer(p) = f5(p + one, ((x) => useFloat(p), 1))\n", "outer"))
      .toBe("Int -> Int");
    expect(refusals(fixtures + first + "fun outer(p) = f5(((x) => useNat(p), 1), p + one)\n")).toHaveLength(1);
    expect(refusals(fixtures + second + "fun outer(p) = f5(p + one, ((x) => useNat(p), 1))\n")).toHaveLength(1);
  });
});
