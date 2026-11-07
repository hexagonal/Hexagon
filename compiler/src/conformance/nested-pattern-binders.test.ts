/**
 * Every binder a checker-clean pattern names is bound at run time, and a test
 * a pattern makes covers all of it (#215). These compile clean either way, so
 * each row asserts the running answer.
 */

import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

const run = (body: string): Promise<Record<string, unknown>> => runMain("module Main\n\n" + body);

describe("#215 a nested `as` binds at every destructuring seat", () => {
  test.each([
    ["an `as` inside an `as`", "let (g as h) as k = 1\nexport let out: Int = g + h + k\n", 3],
    ["a tuple slot", "let (g as h, n) = (1, 2)\nexport let out: Int = g + h + n\n", 4],
    ["a record field", "let { f = q as r } = { f = 5 }\nexport let out: Int = q + r\n", 10],
    [
      "a constructor payload",
      "union Box = Box(Int)\nlet f(b: Box): Int =\n    let Box(g as h) = b\n    g + h\nexport let out: Int = f(Box(5))\n",
      10,
    ],
    ["a lambda's tuple parameter", "let f = ((g as h, n)) => g + h + n\nexport let out: Int = f((1, 2))\n", 4],
    ["a lambda's record parameter", "let f = ({a = p as q}) => p + q\nexport let out: Int = f({a = 1})\n", 2],
    [
      "a function's constructor parameter",
      "union UserId = UserId(Int)\nlet f(UserId(n as m)): Int = n + m\nexport let out: Int = f(UserId(1))\n",
      2,
    ],
    [
      "a `for` head",
      "let total(ps: Vector((Int, Int))): Int =\n    var t = 0\n    for (x as z, y) in ps\n        t := t + x + y + z\n    t\nexport let out: Int = total([(1, 2)])\n",
      4,
    ],
    [
      "under an or-pattern",
      "union U = P(Int) | Q(Int)\nlet f(u: U): Int =\n    let (P(x as y) | Q(x as y)) = u\n    x + y\nexport let out: Int = f(Q(4))\n",
      8,
    ],
  ])("%s", async (_seat, body, out) => {
    expect(await run(body)).toMatchObject({ out });
  });

  test("the bound value is evaluated once", () => {
    const compiled = compileMain(
      "module Main\n\nlet mk(): (Int, Int) = (1, 0)\nlet (a as b, c) = mk()\nexport let out: Int = a + b + c\n",
    );
    expect(compiled.diagnostics).toEqual([]);
    const main = compiled.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text.match(/\bmk\(\)/gu)).toHaveLength(1);
  });
});

describe("#215 an or-pattern inside a vector", () => {
  test("with binders, its alternatives are arms", async () => {
    expect(await run(
      "fun f(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [(x | x)] => x\n" +
      "        _ => 0\n" +
      "export let a: Int = f([7])\n" +
      "export let b: Int = f([7, 8])\n",
    )).toMatchObject({ a: 7, b: 0 });
  });

  test("without binders, the length test still holds", async () => {
    expect(await run(
      "fun f(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [1 | 2] => 10\n" +
      "        _ => 0\n" +
      "export let twoThenFive: Int = f([2, 5])\n" +
      "export let two: Int = f([2])\n" +
      "export let three: Int = f([3])\n",
    )).toMatchObject({ twoThenFive: 0, two: 10, three: 0 });
  });

  test("in a slot after a rest, and in the rest itself", async () => {
    expect(await run(
      "fun f(v: Vector(Int)): Int =\n" +
      "    match v\n" +
      "        [...(r | r), 1 | 2] => r.length()\n" +
      "        _ => 100\n" +
      "export let a: Int = f([5, 6, 2])\n" +
      "export let b: Int = f([5, 6, 3])\n",
    )).toMatchObject({ a: 2, b: 100 });
  });
});

describe("#215 an or-pattern with binders in a `for` head", () => {
  test("binds in each pass", async () => {
    expect(await run(
      "let total(ps: Vector((Int, Int))): Int =\n" +
      "    var t = 0\n" +
      "    for ((x | x), y) in ps\n" +
      "        t := t + x + y\n" +
      "    t\n" +
      "export let out: Int = total([(1, 2), (3, 4)])\n",
    )).toMatchObject({ out: 10 });
  });
});
