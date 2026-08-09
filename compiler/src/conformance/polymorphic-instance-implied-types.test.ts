import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for polymorphic instances whose implied type binding names the
 * instance's own binders (#388; Collections Part 2 §5.3, Constraints §4.3).
 *
 * §5.3's law is one sentence: checking proceeds with the substitution applied,
 * so in `honor<a> Iterable<Bag(a)> = type Item = a; ...` the binding's `a` IS
 * the header's — one variable, not two same-spelled rigids. The checker
 * elaborates each instance's bindings once, beside the subject, and every
 * consumer reads that store; these tests pin each consumer separately:
 * member checking (definition), requirement discharge (the `for` desugaring's
 * evidence route), the imported-instance seeding path, and §5.3's closed set
 * for the binding's variables.
 *
 * The `Bag(String)` fixtures are load-bearing where they look redundant: with
 * `Int` elements a *skipped* projection discharge leaves the loop variable
 * unconstrained and numeric defaulting quietly lands it on `Int`, so the test
 * passes for the wrong reason. Only a non-default element type makes a missing
 * discharge observable.
 */

const messagesOf = (files: readonly (readonly [string, string])[]): readonly string[] =>
  compileFiles(files).diagnostics.map(({ message }) => message);

/**
 * Nothing, since #353: `stdlib/Iterable.hex` is a prelude member, so the name
 * is in scope and a source redeclaration is refused (Constraints §5.1.1). Kept
 * as a binding rather than deleted at each site so that what every test below
 * pins — the instance header's binders reaching its `type Item` binding — is
 * visibly unchanged from when they were written.
 */
const iterable = "";

const bag = "record Bag(a) = {items: Vector(a)}\n" +
  "\n" +
  "honor<a> Iterable<Bag(a)> =\n" +
  "    type Item = a\n" +
  "    toSeq(bag) = Vector.toSeq(bag.items)\n" +
  "\n";

describe("the binding's variable is the header's (§5.3)", () => {
  test("the polymorphic instance checks", () => {
    expect(projectDiagnostics(iterable + bag)).toEqual([]);
  });

  test("a member annotation may name the header's binders", () => {
    expect(projectDiagnostics(iterable +
      "record Bag(a) = {items: Vector(a)}\n" +
      "\n" +
      "honor<a> Iterable<Bag(a)> =\n" +
      "    type Item = a\n" +
      "    toSeq(bag: Bag(a)) = Vector.toSeq(bag.items)\n")).toEqual([]);
  });

  test("a variable outside the header's binders is refused, not minted", () => {
    expect(projectDiagnostics(iterable +
      "record Bag(a) = {items: Vector(a)}\n" +
      "\n" +
      "honor<a> Iterable<Bag(a)> =\n" +
      "    type Item = b\n" +
      "    toSeq(bag) = Vector.toSeq(bag.items)\n")).toContain(
      "`b` is not one of this instance's binders; an implied type " +
        "binding may mention only in-scope type names and the instance's own binders",
    );
  });
});

describe("the projection instantiates at the use (requirement discharge)", () => {
  test("`for` iterates a Bag(Int) through evidence dispatch", async () => {
    const main = await runMain(iterable + bag +
      "export fun run(ignored: Int): Int =\n" +
      "    var sum = 0\n" +
      "    for number in Bag({items = [2, 3, 3]})\n" +
      "        sum := sum + number\n" +
      "    sum\n");
    expect((main["run"] as (ignored: number) => number)(0)).toBe(8);
  });

  test("the projection at Bag(String) is String, so summing it is refused", () => {
    // The load-bearing negative: this diagnostic exists only if `Item`
    // actually instantiated to `String` at the use.
    const messages = projectDiagnostics(iterable + bag +
      "fun total(bag: Bag(String)): Int =\n" +
      "    var sum = 0\n" +
      "    for number in bag\n" +
      "        sum := sum + number\n" +
      "    sum\n");
    expect(messages).toContain("type mismatch: expected Int, found String");
  });
});

describe("the instance crosses the module boundary (seeding path)", () => {
  const library = ["/bags.hex", iterable.replace("constraint", "export constraint") +
    "export record Bag(a) = {items: Vector(a)}\n" +
    "\n" +
    "honor<a> Iterable<Bag(a)> =\n" +
    "    type Item = a\n" +
    "    toSeq(bag) = Vector.toSeq(bag.items)\n"] as const;

  test("an importer's `for` discharges against the imported instance", async () => {
    const main = await runProject([
      library,
      ["/main.hex", "import { Bag } from \"./bags\"\n" +
        "\n" +
        "export fun run(ignored: Int): Int =\n" +
        "    var sum = 0\n" +
        "    for number in Bag({items = [4, 5]})\n" +
        "        sum := sum + number\n" +
        "    sum\n"],
    ]);
    expect((main["run"] as (ignored: number) => number)(0)).toBe(9);
  });

  test("the imported projection at Bag(String) is String, not defaulted", () => {
    const messages = messagesOf([
      library,
      ["/main.hex", "import { Bag } from \"./bags\"\n" +
        "\n" +
        "fun total(bag: Bag(String)): Int =\n" +
        "    var sum = 0\n" +
        "    for number in bag\n" +
        "        sum := sum + number\n" +
        "    sum\n"],
    ]);
    expect(messages).toContain("type mismatch: expected Int, found String");
  });
});
