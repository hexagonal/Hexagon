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
