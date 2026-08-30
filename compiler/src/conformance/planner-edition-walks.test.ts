import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

/**
 * Conformance for the specialization planner carrying its assignment into an
 * edition's **types** as well as its evidence (issue #675).
 *
 * An exported constrained function mints seven monomorphic editions — one per
 * fundamental type. `specializeItem` used to rewrite only the dictionary
 * evidence: a `Dictionary` node over a specialized variable became `Primitive`
 * for the five primitives, or `Structural` for `Bool` and `Unit`, which left the
 * primitive set at #147 and #159. The walked component *types* stayed
 * `Variable`. The four derived walks are type-directed, so every one of them
 * took its `Variable` arm, rebuilt a reference to the dictionary parameter the
 * edition no longer takes, and reported
 * `missing \`Ord\`/\`Show\`/\`Hash\` evidence during JavaScript emission` — seven
 * ICEs per program, with `undefined.compare(...)` left in the emitted JS.
 *
 * The repair is one substitution, not a new arm: an edition's body is now the
 * generic body read under the assignment, so its types and its evidence agree
 * and every existing type-directed arm fires where a hand-written ground program
 * at the same types fires it. That is what most of this file measures — not
 * "no ICE", which a weaker fix could also buy, but **ground parity**: the
 * edition's dictionary is textually the one a ground program emits.
 *
 * Two families had to be cured by the one mechanism, and both are exercised at
 * runtime here. The five primitive editions carry `Primitive` evidence; `Bool`
 * and `Unit` carry `Structural` evidence, and a repair that only taught the
 * dispatchers about `Primitive` would have left those two reporting.
 *
 * The controls are the other half. A generic body still takes its evidence
 * parameter and emits exactly what it always did; an unexported function mints
 * no editions at all; a `Hash` binder mints none either, because no fundamental
 * type's row honors `Hash`. None of those emissions moved by a byte.
 *
 * Every program here is textually distinct on purpose: two programs whose
 * emitted JS is byte-identical share one `data:` URL module instance, so a copy
 * of another test's source would silently assert against that test's module.
 */

/** One module's emitted JavaScript, with the project's diagnostics asserted empty. */
function javascript(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

/**
 * One hoisted dictionary of a *ground* program, verbatim.
 *
 * The parity pins below read a hand-written program's dictionary and look for
 * the same text inside an edition-bearing module. Dictionary CSE hoists both to
 * the same `const __<Constraint>_<Type>...` name, so the line is a complete
 * answer to "does this edition emit what a ground program emits" — the body, the
 * licensed inline arms, and the name.
 */
function groundDictionary(source: string, name: string): string {
  const line = javascript(source).split("\n").find((text) => text.startsWith(`const ${name} = `));
  expect(line, `no hoisted \`${name}\` in the ground program`).toBeDefined();
  return line!;
}

describe("the derived walks reach an edition's substituted component types", () => {
  test("`#derivedCompare` over a tuple, at all four kinds of element", async () => {
    const source = [
      "export let ranks<a: Ord>(x: (a, Int), y: (a, Int)): Bool =",
      "    x < y",
      "",
      "let lowCount: (Int, Int) = (1, 9)",
      "let highCount: (Int, Int) = (2, 0)",
      "let unmarked: (Bool, Int) = (False, 9)",
      "let marked: (Bool, Int) = (True, 0)",
      "let onlyNothing: (Unit, Int) = ((), 1)",
      "let laterNothing: (Unit, Int) = ((), 2)",
      "let firstWord: (String, Int) = (\"a\", 9)",
      "let secondWord: (String, Int) = (\"b\", 0)",
      "",
      "export let byCount: Bool = ranks(lowCount, highCount)",
      "export let byMark: Bool = ranks(unmarked, marked)",
      "export let byNothing: Bool = ranks(onlyNothing, laterNothing)",
      "export let byWord: Bool = ranks(firstWord, secondWord)",
      "",
    ].join("\n");
    const emitted = javascript(source);
    // The base defect's own signature: an edition's walk spelled a dictionary
    // parameter it does not take, and `#dictionary` rendered `undefined`.
    expect(emitted).not.toContain("undefined.");
    // Each ground call routes to its edition rather than to the generic body.
    for (const edition of ["Int", "Bool", "Unit", "String"]) {
      expect(emitted).toContain(`ranks${edition}(`);
    }
    const module = await runMain(source);
    // The head decides in the first three; the tail decides nowhere, because
    // every pair's heads differ. `Unit`'s heads are equal, so its tail decides.
    expect(module.byCount).toBe(true);
    expect(module.byMark).toBe(true);
    expect(module.byNothing).toBe(true);
    expect(module.byWord).toBe(true);
  });

  test("`#derivedShow` over a tuple, `Bool` and `Unit` included", async () => {
    const source = [
      "export let caption<a: Show>(x: (a, Int)): String =",
      "    \"${x}\"",
      "",
      "let counted: (Int, Int) = (4, 5)",
      "let flagged: (Bool, Int) = (True, 6)",
      "let empty: (Unit, Int) = ((), 7)",
      "let worded: (String, Int) = (\"z\", 8)",
      "",
      "export let countText: String = caption(counted)",
      "export let flagText: String = caption(flagged)",
      "export let emptyText: String = caption(empty)",
      "export let wordText: String = caption(worded)",
      "",
    ].join("\n");
    expect(javascript(source)).not.toContain("undefined.");
    const module = await runMain(source);
    // `Bool`'s rendering is the union's own — `"True"`, not the host's
    // `String(x)` — which is exactly what the edition's `Structural` evidence
    // over `stdlib/Bool.hex`'s declaration buys (#147).
    expect(module.countText).toBe("(4, 5)");
    expect(module.flagText).toBe("(True, 6)");
    expect(module.emptyText).toBe("((), 7)");
    // A `String` component of a derived `show` is its own text, unquoted.
    expect(module.wordText).toBe("(z, 8)");
  });

  test("`#derivedEquals` over a tuple", async () => {
    const source = [
      "export let twinned<a: Eq>(x: (a, Int), y: (a, Int)): Bool =",
      "    x == y",
      "",
      "let oneTwo: (Int, Int) = (1, 2)",
      "let alsoOneTwo: (Int, Int) = (1, 2)",
      "let threeTwo: (Int, Int) = (3, 2)",
      "let trueFour: (Bool, Int) = (True, 4)",
      "let falseFour: (Bool, Int) = (False, 4)",
      "let nothingFive: (Unit, Int) = ((), 5)",
      "let nothingSix: (Unit, Int) = ((), 6)",
      "",
      "export let sameCounts: Bool = twinned(oneTwo, alsoOneTwo)",
      "export let otherCounts: Bool = twinned(oneTwo, threeTwo)",
      "export let sameMarks: Bool = twinned(trueFour, falseFour)",
      "export let sameNothings: Bool = twinned(nothingFive, nothingSix)",
      "",
    ].join("\n");
    const emitted = javascript(source);
    expect(emitted).not.toContain("undefined.");
    const module = await runMain(source);
    expect(module.sameCounts).toBe(true);
    expect(module.otherCounts).toBe(false);
    expect(module.sameMarks).toBe(false);
    // Both `Unit` heads are equal by construction; the `Int` tails are not.
    expect(module.sameNothings).toBe(false);
  });

  test("`#derivedEquals` over a `Vector`, whose element arm is its own", async () => {
    const source = [
      "export let matching<a: Eq>(x: Vector(a), y: Vector(a)): Bool =",
      "    x == y",
      "",
      "let digits: Vector(Int) = [1, 2]",
      "let sameDigits: Vector(Int) = [1, 2]",
      "let otherDigits: Vector(Int) = [1, 3]",
      "let marks: Vector(Bool) = [True, False]",
      "let sameMarks: Vector(Bool) = [True, False]",
      "let blanks: Vector(Unit) = [(), ()]",
      "let oneBlank: Vector(Unit) = [()]",
      "",
      "export let digitsAgree: Bool = matching(digits, sameDigits)",
      "export let digitsDiffer: Bool = matching(digits, otherDigits)",
      "export let marksAgree: Bool = matching(marks, sameMarks)",
      "export let blanksDiffer: Bool = matching(blanks, oneBlank)",
      "",
    ].join("\n");
    expect(javascript(source)).not.toContain("undefined.");
    const module = await runMain(source);
    expect(module.digitsAgree).toBe(true);
    expect(module.digitsDiffer).toBe(false);
    expect(module.marksAgree).toBe(true);
    // Every `Unit` element is equal to every other, so only the length can
    // separate these two — which is the walk's own length guard, not the
    // element's dictionary.
    expect(module.blanksDiffer).toBe(false);
  });

  test("two walks deep: a `Vector` of tuples, the element's head substituted", async () => {
    // The substitution has to reach a type the *inner* walk reads, not just the
    // one the outer container hands to `#subDictionary`. Nothing about the
    // repair is depth-limited, and this is where that would show.
    const source = [
      "export let alignedRows<a: Eq>(x: Vector((a, Int)), y: Vector((a, Int))): Bool =",
      "    x == y",
      "",
      "let rows: Vector((String, Int)) = [(\"p\", 1), (\"q\", 2)]",
      "let sameRows: Vector((String, Int)) = [(\"p\", 1), (\"q\", 2)]",
      "let otherRows: Vector((String, Int)) = [(\"p\", 1), (\"r\", 2)]",
      "let flags: Vector((Bool, Int)) = [(True, 3)]",
      "let sameFlags: Vector((Bool, Int)) = [(True, 3)]",
      "let blanks: Vector((Unit, Int)) = [((), 4)]",
      "let otherBlanks: Vector((Unit, Int)) = [((), 5)]",
      "",
      "export let rowsAgree: Bool = alignedRows(rows, sameRows)",
      "export let rowsDiffer: Bool = alignedRows(rows, otherRows)",
      "export let flagsAgree: Bool = alignedRows(flags, sameFlags)",
      "export let blanksDiffer: Bool = alignedRows(blanks, otherBlanks)",
      "",
    ].join("\n");
    const emitted = javascript(source);
    expect(emitted).not.toContain("undefined.");
    // The edition body is the ground one: the whole nest folds into a single
    // hoisted dictionary named for the substituted element type.
    expect(emitted).toContain("__Eq_Vector_String_Int.equals(x, y)");
    const module = await runMain(source);
    expect(module.rowsAgree).toBe(true);
    expect(module.rowsDiffer).toBe(false);
    expect(module.flagsAgree).toBe(true);
    // The `Unit` heads agree; the `Int` tails decide.
    expect(module.blanksDiffer).toBe(false);
  });
});

describe("an edition emits what a hand-written ground program emits", () => {
  test("the `Ord` tuple editions carry the ground dictionaries verbatim", () => {
    const emitted = javascript([
      "export let sorts<a: Ord>(x: (a, Int), y: (a, Int)): Bool =",
      "    x > y",
      "",
    ].join("\n"));
    // `Int`'s licensed primitive inline arm, `Bool`'s union walk, `Unit`'s
    // empty-tuple walk: three different arms of `#derivedCompare`, each reached
    // because the edition's component type is the ground one.
    expect(emitted).toContain(groundDictionary(
      "export let sortsGroundInt(x: (Int, Int), y: (Int, Int)): Bool =\n    x > y\n",
      "__Ord_Int_Int",
    ));
    expect(emitted).toContain(groundDictionary(
      "export let sortsGroundBool(x: (Bool, Int), y: (Bool, Int)): Bool =\n    x > y\n",
      "__Ord_Bool_Int",
    ));
    expect(emitted).toContain(groundDictionary(
      "export let sortsGroundUnit(x: (Unit, Int), y: (Unit, Int)): Bool =\n    x > y\n",
      "__Ord_Unit_Int",
    ));
    // The `Int` head's arm, spelled out once: the shortcut is licensed by the
    // component's type, and the edition now has one.
    expect(emitted).toContain("__left[0] < __right[0]");
  });

  test("the `Show` tuple editions carry the ground dictionaries verbatim", () => {
    const emitted = javascript([
      "export let labels<a: Show>(x: (a, Int), n: Int): String =",
      "    \"${x}${n}\"",
      "",
    ].join("\n"));
    expect(emitted).toContain(groundDictionary(
      "export let labelsGroundInt(x: (Int, Int), n: Int): String =\n    \"${x}${n}\"\n",
      "__Show_Int_Int",
    ));
    expect(emitted).toContain(groundDictionary(
      "export let labelsGroundBool(x: (Bool, Int), n: Int): String =\n    \"${x}${n}\"\n",
      "__Show_Bool_Int",
    ));
    // `Unit` has no dictionary to compare: its head shows as a constant, so the
    // §9.1 peephole folds the whole walk into the body and hoists nothing. The
    // ground program's body is the pin instead, and it is the same body.
    const groundUnit = javascript(
      "export let labelsGroundUnit(x: (Unit, Int), n: Int): String =\n    \"${x}${n}\"\n",
    );
    const unitBody = groundUnit.split("\n").find((line) => line.includes("\"()\""));
    expect(unitBody).toBeDefined();
    expect(emitted).toContain(unitBody!.trim());
  });

  test("an edition's body is the ground body, dictionary sharing included", () => {
    const emitted = javascript([
      "export let leads<a: Ord>(x: (a, Int), y: (a, Int)): Bool =",
      "    x <= y",
      "",
    ].join("\n"));
    // One hoisted dictionary per edition and a one-line body that names it —
    // the same shape the ground program below has, with the declaration form
    // (`function`, not `const`) the only difference an edition ever carries.
    expect(emitted).toContain("function leadsFloat(x, y) {");
    const ground = javascript(
      "export let leadsGroundFloat(x: (Float, Int), y: (Float, Int)): Bool =\n    x <= y\n",
    );
    const body = ground.split("\n").find((line) => line.includes("__Ord_Float_Int.compare"));
    expect(body).toBeDefined();
    expect(emitted).toContain(body!.trim());
  });
});

describe("nothing outside the editions moves", () => {
  test("the generic body keeps its evidence parameter and its walk", () => {
    const emitted = javascript([
      "export let trails<a: Ord>(x: (a, Int), y: (a, Int)): Bool =",
      "    x >= y",
      "",
    ].join("\n"));
    // The generic body is not an edition: its component is still a variable, its
    // evidence is still the binder's dictionary, and it reads the recorded node
    // exactly as it did before the planner learned to substitute types.
    expect(emitted).toContain("const trails = (x, y, __Ord_a) => {");
    expect(emitted).toContain("__Ord_a.compare(__left[0], __right[0])");
  });

  test("an unexported constrained function mints no editions", () => {
    const emitted = javascript([
      "let hushed<a: Ord>(x: (a, Int), y: (a, Int)): Bool =",
      "    x < y",
      "",
      "let early: (Int, Int) = (1, 2)",
      "let late: (Int, Int) = (1, 3)",
      "",
      "export let ascending: Bool = hushed(early, late)",
      "",
    ].join("\n"));
    expect(emitted).toContain("__Ord_a.compare(__left[0], __right[0])");
    expect(emitted).not.toContain("hushedInt");
  });

  test("a `Hash` binder mints none either, so its walk is the generic one", () => {
    // No fundamental type's row in `fundamentalSupports` honors `Hash`, so the
    // planner's candidate set is empty and the item is skipped entirely. The
    // seat this pins is the one #669 repaired; it must read the same after #675.
    const emitted = javascript([
      "export let gathered<a: Hash>(s: Set((a, Int)), v: (a, Int)): Set((a, Int)) =",
      "    Set.add(s, v)",
      "",
    ].join("\n"));
    expect(emitted).toContain("__Hash_a.hash(__value[0])");
    expect(emitted).toContain("__Hash_a.eq.equals(__left[0], __right[0])");
    expect(emitted).not.toContain("gatheredInt");
  });
});
