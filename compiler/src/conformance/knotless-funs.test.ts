/**
 * `knotlessFuns` (Functions §3.2, house note N6): the `fun` members whose knot,
 * as the checker types it (§7.3, §7.4), is themselves alone and unnamed. The
 * house test reads it to keep `fun` for recursion; these pin what it answers.
 */

import { describe, expect, test } from "vitest";

import { knotlessFuns } from "../passes/checker/checker.js";
import { compileMain } from "../support/test-project.js";

/** The names `knotlessFuns` gives for `Main`, written as `source`. */
function knotless(source: string): readonly string[] {
  const main = compileMain(`module Main\n\n${source}`).typedModules.find(({ modulePath }) =>
    modulePath === "/Main.hex"
  );
  if (main === undefined) throw new Error("Main was not checked");
  expect(main.diagnostics).toEqual([]);
  return knotlessFuns(main).map(({ name }) => name);
}

describe("knotlessFuns", () => {
  test("a `fun` that names nothing of its own is knotless", () => {
    expect(knotless("fun double(n: Int) = n * 2\n")).toEqual(["double"]);
  });

  test("a `fun` that calls itself is its own knot", () => {
    expect(knotless("fun count(n: Int): Int = if n == 0 then 0 else count(n - 1)\n")).toEqual([]);
  });

  test("members of a block that call each other are one knot, and an independent member is not in it", () => {
    expect(knotless(
      "fun\n" +
        "    isEven(n: Int): Bool = if n == 0 then True else isOdd(n - 1)\n" +
        "    isOdd(n: Int): Bool = if n == 0 then False else isEven(n - 1)\n" +
        "    halve(n: Int): Int = Int.div(n, 2)\n",
    )).toEqual(["halve"]);
  });

  test("a `fun` that only calls another function is knotless", () => {
    expect(knotless(
      "fun count(n: Int): Int = if n == 0 then 0 else count(n - 1)\n" +
        "fun twice(n: Int) = count(n) + count(n)\n",
    )).toEqual(["twice"]);
  });

  test("a local `fun` is read as a module's is", () => {
    expect(knotless(
      "let outer(n: Int) =\n" +
        "    fun inner(m: Int) = m + 1\n" +
        "    fun down(m: Int): Int = if m == 0 then 0 else down(m - 1)\n" +
        "    inner(down(n))\n",
    )).toEqual(["inner"]);
  });

  test("a `let` is never named", () => {
    expect(knotless("let double(n: Int) = n * 2\n")).toEqual([]);
  });
});
