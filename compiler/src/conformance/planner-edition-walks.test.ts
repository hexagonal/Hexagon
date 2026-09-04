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
 * Seven per program was the *small* case. The count is one per edition, and a
 * binder over two variables mints the cartesian product: `<k: Eq, v: Eq>` over a
 * `(k, v)` pair is 49 editions and **98** ICEs from a seven-line program. Every
 * shape that walks a component reached it — tuples, `Vector`s, structural
 * records, `fun` items as much as `let`s — which is why the programs below are
 * a spread of shapes rather than four probes.
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
 * parameter and emits exactly what it always did, and an unexported function
 * mints no editions at all. The third was a `Hash` binder minting none, which
 * #679 retired: that was the hand table's content and never the types'
 * standing — all seven fundamentals hold a lawful `Hash` — so the row now
 * asserts the seven editions it mints under §3.2's instance judgment, and is a
 * measurement of this file's repair at a seat that could not reach it before.
 *
 * Only **one** of the two surviving controls is red at base, and not for a
 * property it asserts: the generic-body one, because its own module's editions
 * ICE. It pins a spelling rather than detecting the defect. The unexported one
 * is green at base, as a control that mints nothing should be — the defect
 * never reached it.
 *
 * One test here is green at base on purpose and says so: the `Map` value seat
 * was cured earlier, by #669. It covers a helper — `#subDictionary` — that no
 * other program in this file reaches.
 *
 * Every program here is textually distinct on purpose: two programs whose
 * emitted JS is byte-identical share one `data:` URL module instance, so a copy
 * of another test's source would silently assert against that test's module.
 */

/** One module's emitted JavaScript, with the project's diagnostics asserted empty. */
function javascript(source: string): string {
  const project = compileMain("module Main\n\n" + source);
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
    const module = await runMain("module Main\n\n" + source);
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
    const module = await runMain("module Main\n\n" + source);
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
    const module = await runMain("module Main\n\n" + source);
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
    const module = await runMain("module Main\n\n" + source);
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
    const module = await runMain("module Main\n\n" + source);
    expect(module.rowsAgree).toBe(true);
    expect(module.rowsDiffer).toBe(false);
    expect(module.flagsAgree).toBe(true);
    // The `Unit` heads agree; the `Int` tails decide.
    expect(module.blanksDiffer).toBe(false);
  });

  test("`#derivedShow` and `#derivedCompare` over a bare `Vector(a)`", async () => {
    // `Vector(a)` was covered under `Eq` alone when this file was written; both
    // of the other walks were equally broken over it — 7 ICEs each at base.
    const shown = [
      "export let listedText<a: Show>(x: Vector(a)): String =",
      "    \"${x}\"",
      "",
      "let raised: Vector(Bool) = [True, False]",
      "",
      "export let raisedText: String = listedText(raised)",
      "",
    ].join("\n");
    expect(javascript(shown)).not.toContain("undefined.");
    expect((await runMain("module Main\n\n" + shown)).raisedText).toBe("[True, False]");

    const ordered = [
      "export let sortedBefore<a: Ord>(x: Vector(a), y: Vector(a)): Bool =",
      "    x < y",
      "",
      "let shortRun: Vector(Int) = [1, 2]",
      "let longRun: Vector(Int) = [1, 3]",
      "",
      "export let runsAscend: Bool = sortedBefore(shortRun, longRun)",
      "",
    ].join("\n");
    expect(javascript(ordered)).not.toContain("undefined.");
    expect((await runMain("module Main\n\n" + ordered)).runsAscend).toBe(true);
  });

  test("a structural record's field component", async () => {
    const source = [
      "export let sameRow<a: Eq>(x: {p: a, q: Int}, y: {p: a, q: Int}): Bool =",
      "    x == y",
      "",
      "let rowOne: {p: String, q: Int} = {p = \"k\", q = 1}",
      "let rowTwo: {p: String, q: Int} = {p = \"k\", q = 1}",
      "let rowThree: {p: String, q: Int} = {p = \"m\", q = 1}",
      "let blankRow: {p: Unit, q: Int} = {p = (), q = 2}",
      "let sameBlankRow: {p: Unit, q: Int} = {p = (), q = 2}",
      "",
      "export let rowsAgree: Bool = sameRow(rowOne, rowTwo)",
      "export let rowsDiffer: Bool = sameRow(rowOne, rowThree)",
      "export let blankRowsAgree: Bool = sameRow(blankRow, sameBlankRow)",
      "",
    ].join("\n");
    expect(javascript(source)).not.toContain("undefined.");
    const module = await runMain("module Main\n\n" + source);
    expect(module.rowsAgree).toBe(true);
    expect(module.rowsDiffer).toBe(false);
    expect(module.blankRowsAgree).toBe(true);
  });

  test("a `fun` item, the planner's other specializable form", async () => {
    // `SpecializableItem` is a `Fun` **or** a `Let` whose value is a lambda, and
    // every other program in this file is the second. The substitution is not
    // keyed to the item form, and this is what says so.
    const source = [
      "export fun chainedOrder<a: Ord>(x: (a, Int), y: (a, Int)): Bool =",
      "    x < y",
      "",
      "let lowPair: (Int, Int) = (1, 2)",
      "let highPair: (Int, Int) = (2, 1)",
      "",
      "export let chainAscends: Bool = chainedOrder(lowPair, highPair)",
      "",
    ].join("\n");
    const emitted = javascript(source);
    expect(emitted).not.toContain("undefined.");
    expect(emitted).toContain("chainedOrderInt(lowPair, highPair)");
    expect((await runMain("module Main\n\n" + source)).chainAscends).toBe(true);
  });
});

describe("the multi-variable cartesian, the defect's largest instance", () => {
  /**
   * Seven fundamentals per specialized variable, and a two-variable binder is
   * their product: 49 editions, and at base **98** ICEs from one seven-line
   * program — fourteen times the four filed probes.
   *
   * This is the one shape a substitution keyed to a *single* variable would have
   * survived, so it is the row that says the assignment is carried whole.
   */
  test("`<k: Eq, v: Eq>` mints 49 editions and every one of them walks", async () => {
    const source = [
      "export let paired<k: Eq, v: Eq>(x: (k, v), y: (k, v)): Bool =",
      "    x == y",
      "",
      "let numbered: (Int, String) = (1, \"u\")",
      "let alsoNumbered: (Int, String) = (1, \"u\")",
      "let renamed: (Int, String) = (1, \"w\")",
      "let flagBlank: (Bool, Unit) = (True, ())",
      "let sameFlagBlank: (Bool, Unit) = (True, ())",
      "",
      "export let pairsAgree: Bool = paired(numbered, alsoNumbered)",
      "export let pairsDiffer: Bool = paired(numbered, renamed)",
      "export let mixedAgree: Bool = paired(flagBlank, sameFlagBlank)",
      "",
    ].join("\n");
    const emitted = javascript(source);
    expect(emitted).not.toContain("undefined.");
    // The scale itself, so a regression that substituted only the first
    // variable — or minted fewer editions — is visible as a number.
    expect(emitted.match(/^function paired[A-Za-z]+\(/gmu)).toHaveLength(49);
    // Both positions substituted, in the same edition and in both orders.
    expect(emitted).toContain("function pairedIntString(");
    expect(emitted).toContain("function pairedStringInt(");
    const module = await runMain("module Main\n\n" + source);
    // `pairedIntString` and `pairedBoolUnit` are the two run here: a primitive
    // beside a primitive, and the two `Structural`-evidence fundamentals beside
    // each other — the pairing a `Primitive`-only repair would miss twice over.
    expect(module.pairsAgree).toBe(true);
    expect(module.pairsDiffer).toBe(false);
    expect(module.mixedAgree).toBe(true);
  });
});

describe("an edition does not reach past a hand-written component instance", () => {
  /**
   * #278 crossed with #675, and the seat where a repair that reached *too far*
   * would show. `honor Ord<Yards>` is perverse — it reverses — so an edition
   * that re-derived the component structurally instead of dispatching to the
   * honor would silently disagree with the ground expression rather than fail.
   *
   * This program was 7-ICE at base, so nothing measured it either way until now.
   */
  test("a perverse `honor` decides the component, in every edition", async () => {
    const source = [
      "export record Yards derives Eq = {reach: Int}",
      "honor Ord<Yards> =",
      "    compare(left, right) = if left.reach < right.reach then Ordering.Greater" +
        " else if right.reach < left.reach then Ordering.Less else Ordering.Equal",
      "",
      "export let ranked<a: Ord>(x: (a, Yards), y: (a, Yards)): Bool =",
      "    x < y",
      "",
      "let nearer: (Int, Yards) = (1, Yards({reach = 1}))",
      "let further: (Int, Yards) = (1, Yards({reach = 2}))",
      "",
      "export let editionSays: Bool = ranked(nearer, further)",
      "export let groundSays: Bool = Yards({reach = 1}) < Yards({reach = 2})",
      "",
    ].join("\n");
    const emitted = javascript(source);
    expect(emitted).not.toContain("undefined.");
    // The edition dispatches to the honor's dictionary at the component seat.
    expect(emitted).toContain("__Ord_Yards.compare(__left[1], __right[1])");
    // And never reads the component's representation itself: `.reach` belongs to
    // `Yards`' own instances alone.
    expect(emitted).not.toContain("__left[1].reach");
    const module = await runMain("module Main\n\n" + source);
    // The heads are equal, so the component decides — and it decides the honor's
    // way, which is backwards. Agreement with the ground expression is the pin;
    // `false` is what agreement happens to equal.
    expect(module.editionSays).toBe(module.groundSays);
    expect(module.editionSays).toBe(false);
  });
});

describe("the `Map` value seat an edition reaches through `#subDictionary`", () => {
  /**
   * The one component seat in this file that goes through `#subDictionary` —
   * measured, with a per-call counter validated against a positive control: this
   * program reaches it 16 times, and every tuple/`Vector` program above reaches
   * it **zero** times.
   *
   * Unlike everything else here it was **not** red at base: #669's repair had
   * already cured it, because `#subDictionary` renders whatever node is recorded
   * and an edition's `Primitive` evidence is a node like any other. It is here
   * as blast-radius coverage for a seat this file otherwise never visits, not as
   * a defect pin — `derived-walk-evidence.test.ts` holds that one.
   */
  test("each edition names its own value dictionary, and runs", async () => {
    const source = [
      "export let keyedSame<a: Eq>(x: Map(Int, a), y: Map(Int, a)): Bool =",
      "    x == y",
      "",
      "let stored: Map(Int, Bool) = Map.fromVector([(9, True)])",
      "let restored: Map(Int, Bool) = Map.fromVector([(9, True)])",
      "let altered: Map(Int, Bool) = Map.fromVector([(9, False)])",
      "",
      "export let storesAgree: Bool = keyedSame(stored, restored)",
      "export let storesDiffer: Bool = keyedSame(stored, altered)",
      "",
    ].join("\n");
    const emitted = javascript(source);
    expect(emitted).not.toContain("undefined.");
    expect(emitted).toContain("__mapEquals(__Hash_Int, __Eq_Bool, x, y)");
    expect(emitted).toContain("keyedSameBool(stored, restored)");
    const module = await runMain("module Main\n\n" + source);
    expect(module.storesAgree).toBe(true);
    expect(module.storesDiffer).toBe(false);
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

  test("a `Hash` binder mints all seven, and the generic body keeps its walk", () => {
    // Rewritten rather than re-pinned, which is what this row's own note asked
    // for: it used to assert that a `Hash` binder minted *nothing*, which was
    // the hand table's content and never the types' standing — and #679 ruled
    // the table out in favour of §3.2's instance judgment. All seven
    // fundamentals hold a lawful `Hash`, so all seven editions mint, and this is
    // the one program in the file where the collections API becomes reachable
    // from JavaScript at all.
    const emitted = javascript([
      "export let gathered<a: Hash>(s: Set((a, Int)), v: (a, Int)): Set((a, Int)) =",
      "    Set.add(s, v)",
      "",
    ].join("\n"));
    // The generic body is unmoved: still an evidence parameter, still the walk.
    expect(emitted).toContain("__Hash_a.hash(__value[0])");
    expect(emitted).toContain("__Hash_a.Eq.equals(__left[0], __right[0])");
    // And each edition is ground — the `(a, Int)` element's dictionary is the
    // hoisted one a hand-written program at that element type emits, not a walk
    // over a variable the edition no longer binds (#675's property, at the seat
    // that could not exercise it before).
    for (const edition of ["Nat", "Int", "Float", "BigInt", "Bool", "String", "Unit"]) {
      expect(emitted).toContain(`function gathered${edition}(s, v) {`);
      expect(emitted).toContain(`return add(s, v, __Hash_${edition}_Int);`);
    }
    expect(emitted).not.toContain("undefined.");
  });
});
