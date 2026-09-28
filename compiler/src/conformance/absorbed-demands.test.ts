/**
 * Conformance for **a demand absorbed by an equal one still settles** (#1125).
 *
 * Two demands of one constraint on one variable are one demand (Collections
 * Part 2 §5.4's functional dependency, Constraints §6.1): the variable keeps
 * one, and the other is dropped from its list. The dropped one is still the
 * evidence of the call that made it, so when the variable's type arrives it
 * must settle as the kept one does — selected where that one is, refused
 * where that one is — or the call is emitted with no evidence and a program
 * that compiled throws at run time.
 */

import { describe, expect, test } from "vitest";
import { compileMain, runProject } from "../support/test-project.js";

async function run(body: string): Promise<Record<string, unknown>> {
  return runProject([["/main.hex", "module Main\n\n" + body]]);
}

describe("the second demand settles with the first", () => {
  test("an implied-type-bearing constraint, settled by a later line", async () => {
    const exports = await run(
      "let f(xs) =\n" +
        "    let a = Iterable.toSeq(xs)\n" +
        "    let b = Iterable.toSeq(xs)\n" +
        "    let known: Vector(String) = xs\n" +
        "    String.fromSeq(a) ++ String.fromSeq(b)\n" +
        "export let main(): String = f([\"u\", \"v\"])\n",
    );
    expect((exports["main"] as () => string)()).toBe("uvuv");
  });

  test("a constraint without implied types", async () => {
    const exports = await run(
      "let f(xs) =\n" +
        "    let a = show(xs)\n" +
        "    let b = show(xs)\n" +
        "    let known: Vector(Int) = xs\n" +
        "    a ++ b\n" +
        "export let main(): String = f([1])\n",
    );
    expect((exports["main"] as () => string)()).toBe("[1][1]");
  });

  test("a user constraint at a user type", async () => {
    const exports = await run(
      "record Bag = {n: Int}\n" +
        "constraint Tagged<c> =\n    tag(x: c) -> String\n" +
        "honor Tagged<Bag> =\n    tag(b) = \"bag\"\n" +
        "let f(b) =\n" +
        "    let a = tag(b)\n" +
        "    let c = tag(b)\n" +
        "    let known: Bag = b\n" +
        "    a ++ c\n" +
        "export let main(): String = f(Bag({n = 1}))\n",
    );
    expect((exports["main"] as () => string)()).toBe("bagbag");
  });

  test("a base constraint absorbed by the one extending it", async () => {
    const exports = await run(
      "record Pt derives (Eq, Ord) = {x: Int}\n" +
        "let f(p, q) =\n" +
        "    let c = Ord.compare(p, q)\n" +
        "    let e = p == q\n" +
        "    let known: Pt = p\n" +
        "    e\n" +
        "export let main(): Bool = f(Pt({x = 1}), Pt({x = 1}))\n",
    );
    expect((exports["main"] as () => boolean)()).toBe(true);
  });
});

describe("every kind of absorbed demand settles", () => {
  test("an expression literal's demand, at a type settled later", async () => {
    const exports = await run(
      "let f(x) =\n" +
        "    let a = 1 < x <= 3\n" +
        "    let known: Dec = x\n" +
        "    a\n" +
        "export let main(): Bool = f(2.0d)\n" +
        "let g(x) =\n" +
        "    let v = [1, 2, x]\n" +
        "    let known: Dec = x\n" +
        "    Vector.length(v)\n" +
        "export let count(): Int = g(3.0d)\n",
    );
    expect((exports["main"] as () => boolean)()).toBe(true);
    expect((exports["count"] as () => number)()).toBe(3);
  });

  test("a module's own constraint at a primitive, and a base under its extension there", async () => {
    const exports = await run(
      "constraint Tagged<c> =\n    tag(x: c) -> String\n" +
        "honor Tagged<Int> =\n    tag(b) = \"int\"\n" +
        "constraint Base<c> =\n    base(x: c) -> String\n" +
        "constraint Ext<c: Base> =\n    ext(x: c) -> String\n" +
        "honor Base<Int> =\n    base(b) = \"b\"\n" +
        "honor Ext<Int> =\n    ext(b) = \"e\"\n" +
        "let f(b) =\n    let a = tag(b)\n    let c = tag(b)\n    let known: Int = b\n    a ++ c\n" +
        "let g(b) =\n    let e = ext(b)\n    let s = base(b)\n    let known: Int = b\n    e ++ s\n" +
        "export let main(): String = f(1) ++ g(1)\n",
    );
    expect((exports["main"] as () => string)()).toBe("intinteb");
  });

  test("equality under ordering at a union and at a tuple, by result", async () => {
    const exports = await run(
      "let f(p, q) =\n    let c = Ord.compare(p, q)\n    let e = p == q\n    let known: Bool = p\n    e\n" +
        "let g(p, q) =\n    let c = Ord.compare(p, q)\n    let e = p == q\n" +
        "    let known: (Int, Int) = p\n    e\n" +
        "export let unions(): Bool = f(True, True)\n" +
        "export let tuples(): Bool = g((1, 2), (1, 2))\n",
    );
    expect((exports["unions"] as () => boolean)()).toBe(true);
    expect((exports["tuples"] as () => boolean)()).toBe(true);
  });

  test("a demand absorbed twice, across a variable-to-variable unification", async () => {
    const exports = await run(
      "let f(x, y) =\n" +
        "    let a = show(x)\n    let b = show(y)\n    let c = show(x)\n" +
        "    let same = [x, y]\n" +
        "    let known: Vector(Int) = x\n" +
        "    a ++ b ++ c\n" +
        "export let main(): String = f([1], [2])\n",
    );
    expect((exports["main"] as () => string)()).toBe("[1][2][1]");
  });
});

describe("a refused kept demand refuses the absorbed one once", () => {
  test("no second report, and no evidence for an instance that does not exist", () => {
    expect(compileMain(
      "module Main\n\n" +
        "let f(xs) =\n" +
        "    let a = Iterable.toSeq(xs)\n" +
        "    let b = Iterable.toSeq(xs)\n" +
        "    let known: Int = xs\n" +
        "    b\n",
    ).diagnostics.map(({ message }) => message)).toEqual([
      "type `Int` has no `Iterable` instance; its only legal homes are the module declaring " +
        "`Iterable` and `Int`'s prelude companion module, both outside project source, so this " +
        "pair's honored set is closed — change the type, or go through the operations those " +
        "homes export",
    ]);
  });
});
