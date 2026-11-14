/**
 * A grouped callee is a value, and applying it is a call (#1272). The checker
 * keeps `(show)` a reference carrying its own evidence (Functions §10, "a
 * called member"); emission moves that evidence onto the call, so `(show)(n)`
 * runs as `show(n)` does rather than answering an eta-expanded wrapper. These
 * all compiled clean before the fix, so each row asserts the running answer.
 */

import { describe, expect, test } from "vitest";

import { compileMain, runMain, runProject } from "../support/test-project.js";

const run = (body: string): Promise<Record<string, unknown>> => runMain("module Main\n\n" + body);

describe("#1272 a grouped constrained callee is called", () => {
  test.each([
    [
      "a grouped prelude member in a function body",
      "export let grouped(n: Int): String = (show)(n)\nexport let out: String = grouped(5)\n",
      "5",
    ],
    ["a doubly grouped member", "export let out: String = ((show))(5)\n", "5"],
    ["a grouped qualified member", "export let out: String = (Show.show)(5)\n", "5"],
    [
      "a grouped member at a constrained variable",
      "let f<a: Show>(x: a): String = (show)(x)\nexport let out: String = f(5) ++ f(True)\n",
      "5True",
    ],
    ["a grouped member around a grouped member", "export let out: String = (show)((show)(1))\n", "1"],
    [
      "a grouped user member",
      "constraint Desc<a> =\n    d(x: a) -> String\nhonor Desc<Int> =\n    d(x) = \"i\"\n" +
        "let n: Int = 5\nexport let out: String = (d)(n)\n",
      "i",
    ],
    [
      "a grouped constrained function",
      "let twice<a: Num>(x: a): a = x + x\nexport let out: Int = (twice)(2)\n",
      4,
    ],
    [
      "a grouped member with no operator face",
      "let n: Int = 3\nexport let out: Int = (Signed.negate)(n)\n",
      -3,
    ],
  ])("%s", async (_shape, body, out) => {
    expect(await run(body)).toMatchObject({ out });
  });

  test("a grouped two-argument member", async () => {
    expect(await run("export let out: Ordering = (Ord.compare)(1, 2)\n"))
      .toMatchObject({ out: { tag: "Less" } });
  });

  test("a grouped imported constrained function", async () => {
    const exports = await runProject([
      ["/lib.hex", "module Lib\n\nexport let f<a: Show>(x: a): String = show(x)\n"],
      ["/main.hex", "module Main\n\nimport Lib\n\nexport let out: String = (Lib.f)(5)\n"],
    ]);
    expect(exports).toMatchObject({ out: "5" });
  });

  test("emits what the bare spelling emits", () => {
    const body = (callee: string): string => {
      const compiled = compileMain(
        `module Main\n\nexport let out(n: Int): String = ${callee}(n)\n`,
      );
      expect(compiled.diagnostics).toEqual([]);
      return compiled.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    };
    expect(body("(show)")).toBe(body("show"));
  });
});

describe("#1272 controls", () => {
  test("a grouped plain function", async () => {
    expect(await run("let inc(x: Int): Int = x + 1\nexport let out: Int = (inc)(1)\n"))
      .toMatchObject({ out: 2 });
  });

  test("a member bound as a value, then called", async () => {
    expect(await run("let r: (Int) -> String = show\nexport let out: String = r(1)\n"))
      .toMatchObject({ out: "1" });
  });
});
