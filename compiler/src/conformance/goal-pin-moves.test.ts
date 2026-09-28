/**
 * Conformance for **a dot-call goal's pin moving with its receiver** (#1154).
 *
 * Method Syntax §3.1's pinning rule: a pending goal pins every variable it
 * mentions — its receiver, its argument types, its result — to its owner
 * region, the region of the receiver's variable. That region is not fixed when
 * the goal is made: a later unification can sink the receiver outward
 * (`let same = [x, n]` makes `x` the enclosing function's `n`). The pin must
 * move with it, or a binding closing in between quantifies what the goal will
 * settle, and a use made before the deadline keeps a copy the settlement never
 * reaches — typed at anything the program likes.
 */

import { describe, expect, test } from "vitest";
import { compileFiles } from "../support/test-project.js";
import * as Typed from "../syntax/typed/index.js";

const world = "extern from \"./world.js\"\n" +
  "    export fun save(document: String) ->! Unit\n\n";

const store = "constraint Store<s> =\n" +
  "    put(x: s) ->! Unit\n\n" +
  "honor Store<Int> =\n" +
  "    put(x) = save!(\"x\")\n\n";

function compile(body: string) {
  return compileFiles([["/main.hex", "module Main\n\n" + world + store + body]]);
}

function refusals(body: string): readonly string[] {
  return compile(body).diagnostics.map(({ message }) => message);
}

function typeOf(body: string, name: string): string {
  const compiled = compile(body);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const typed = compiled.modules.find(({ source }) => source.path === "/main.hex")!.typed;
  const symbol = typed.symbols.find(
    (candidate) => candidate.name === name && candidate.bindingSpan.fileId === typed.fileId,
  );
  if (symbol === undefined) throw new Error(`no symbol \`${name}\``);
  return Typed.displayScheme(symbol.scheme);
}

/** `helper`'s goal waits on `x`, which `same` makes the outer `n`; defaulting settles it. */
const moved = (member: string): string =>
  "let run(n) =\n" +
  "    let helper(x) =\n" +
  `        let act = ${member}\n` +
  "        let same = [x, n]\n" +
  "        act\n" +
  "    let k = n + 1\n" +
  "    helper(n)\n";

describe("a goal whose receiver moved out settles into the uses made before it", () => {
  test("the result, through an effectful member", () => {
    expect(typeOf(moved("() => x.put!()"), "run")).toBe("Int -> () ->! Unit");
  });

  test("the result, through a pure member", () => {
    expect(typeOf(moved("() => x.show()"), "run")).toBe("Int -> () -> String");
  });

  test("an argument's type", () => {
    expect(typeOf(moved("(y) => x.compare(y)"), "run")).toBe("Int -> Int -> Ordering");
  });

  test("a use at another type is refused", () => {
    expect(refusals(moved("() => x.put!()") + "let bad: String = run(1)!()\n")).toEqual([
      "type mismatch: expected String, found Unit",
    ]);
    expect(refusals(moved("() => x.show()") + "let bad: Int = run(1)()\n")).toEqual([
      "type mismatch: expected Int, found String",
    ]);
    expect(refusals(moved("(y) => x.compare(y)") + "let bad = run(1)(\"s\")\n")).toEqual([
      "type mismatch: expected Int, found String",
    ]);
  });

  test("a goal that takes the fallback shares one result with its uses", () => {
    expect(typeOf(
      "let run(n) =\n" +
        "    let helper(x) =\n" +
        "        let act = () => x.make()\n" +
        "        let same = [x, n]\n" +
        "        act\n" +
        "    helper(n)\n",
      "run",
    )).toBe("{make: () -> a, ...b} -> () -> a");
  });
});

describe("a goal's argument types are pinned to its receiver's region", () => {
  test("even where the receiver never moves", () => {
    expect(refusals(
      "let run(n) =\n" +
        "    let helper = (y) => n.compare(y)\n" +
        "    let bad = helper(\"s\")\n" +
        "    let k = n + 1\n" +
        "    helper\n",
    )).toEqual(["type mismatch: expected Int, found String"]);
  });

  test("a callback's colour is compared, not quantified away", () => {
    const control = refusals(
      "let run(s: Seq(Int)) =\n" +
        "    let helper = (cb) =>\n" +
        "        let u = s.map(cb)\n" +
        "        cb\n" +
        "    let bad = helper((i) => save!(\"x\"))\n" +
        "    bad\n",
    );
    expect(control).toEqual([
      "a `->` arrow promises purity, and this function performs effects — the demand is written " +
        "`->`, the function's face `->?` or `->!`",
    ]);
    expect(refusals(
      "let run(s) =\n" +
        "    let helper = (cb) =>\n" +
        "        let u = s.map(cb)\n" +
        "        cb\n" +
        "    let bad = helper((i) => save!(\"x\"))\n" +
        "    let t: Seq(Int) = s\n" +
        "    bad\n",
    )).toEqual(control);
  });

  test("a goal written inside a pending goal's callback belongs to that goal's region", () => {
    expect(typeOf(
      "let run(s) =\n" +
        "    let t = s.map((i) => i.show())\n" +
        "    let u: Seq(Int) = s\n" +
        "    t\n",
      "run",
    )).toBe("Seq(Int) -> Seq(String)");
    expect(typeOf(
      "let run(s) =\n" +
        "    let go = () => s.forEach!((y) => y.put!())\n" +
        "    let t: Seq(Int) = s\n" +
        "    go\n",
      "run",
    )).toBe("Seq(Int) -> () ->! Unit");
  });
});

describe("the pin holds however the goal settles", () => {
  test("settled opportunistically, after a use", () => {
    expect(typeOf(
      "let run(n) =\n" +
        "    let helper(x) =\n" +
        "        let act = () => x.show()\n" +
        "        let same = [x, n]\n" +
        "        act\n" +
        "    let early = helper(n)\n" +
        "    let k: Int = n\n" +
        "    early\n",
      "run",
    )).toBe("Int -> () -> String");
  });

  test("a chain, whose second receiver is the first goal's result", () => {
    expect(typeOf(moved("() => x.show().length()"), "run")).toBe("Int -> () -> Int");
  });

  test("a chain tied in reverse: each pin can sink the next goal's region", () => {
    expect(typeOf(
      "let run(n) =\n" +
        "    let helper(x, y, z) =\n" +
        "        let a = () => y.length()\n" +
        "        let b = z.show()\n" +
        "        let c = x.add(1)\n" +
        "        let tie1 = [b, y]\n" +
        "        let tie2 = [c, z]\n" +
        "        (a, [x, n])\n" +
        "    let k = n + 1\n" +
        "    helper(n, \"s\", 1).item1\n",
      "run",
    )).toBe("Int -> () -> Int");
  });
});

