import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

/**
 * Conformance for the `Vector` walks not emitting machinery for an element
 * operation that ignores its operands (issue #680).
 *
 * `Unit`'s equality inlines to `true` and its order to `"Equal"` — operand-free,
 * because there is nothing to read. The walks emitted the surrounding machinery
 * anyway, so a `Vector(Unit)` equality carried, once per element and forever
 * false, a discarded `.next()` read and a guard testing a literal:
 *
 * ```js
 * const __rightElement = __rightStep.next().value; if (!(true)) return false;
 * ```
 *
 * The suppression keys on **the element expression ignoring its operands**, not
 * on `Unit` by name: the walk asks whether the text it just built mentions the
 * binder it just minted. Two consequences follow, and both are pinned below.
 *
 * - `equals` sheds the whole loop. `true` is the identity of the fold, so a
 *   loop over it cannot decide anything, and the equality is its size check —
 *   the cascade #680 blesses. Two vectors of units are equal exactly when they
 *   are the same length, which is what the emitted text now says outright.
 * - `compare` sheds the binding and keeps the loop, because exhaustion rather
 *   than any element is what decides a vector order. Collapsing an all-`"Equal"`
 *   walk to a length comparison would be a different emission rather than a
 *   deletion, and is deliberately not taken.
 *
 * Only the literal `true` collapses the loop. An operand-free element that is
 * not `true` — a tuple of units inlines to `true && true` — sheds the binding
 * and keeps the walk, and that arm is pinned as hard as the cascade, because
 * nothing about the *answers* distinguishes the two.
 *
 * Where the changed lines land is worth knowing before auditing a diff: the
 * rule keys on the element expression, so a `Vector(Unit)` *held* by a record
 * or a tuple moves that holder's dictionary — `__Eq_Sheet_equals` — whose name
 * says nothing about vectors or units. Grepping for `__*_Vector_Unit` finds
 * most of the change and not all of it.
 *
 * One thing the walk table does not say: `hash` is untouched as a *walk*, and
 * its loop-header binder is left exactly where it was, but a
 * `__Hash_Vector_Unit` dictionary line still moves — the `eq` slot nested
 * inside it collapses like any other equality. The second test pins that.
 *
 * The controls carry the weight here, because this is a cosmetic change to a
 * shared walk: a `Vector` over any type whose equality reads its operands must
 * emit exactly what it always did, and a module mixing a collapsed dictionary
 * with live ones must not renumber the live ones — the walk still *claims* the
 * binder names it no longer spells, precisely so the `_1` suffixes elsewhere in
 * the module do not shift.
 *
 * Every program is textually distinct on purpose: two programs whose emitted JS
 * is byte-identical share one `data:` URL module instance, so a copy of another
 * test's source would silently assert against that test's module.
 */

/** One module's emitted JavaScript, with the project's diagnostics asserted empty. */
function javascript(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

describe("an operand-free element equality leaves only the size check", () => {
  test("`Vector(Unit)` equality is its size comparison, and nothing else", async () => {
    const source = [
      "export let sameUnits(x: Vector(Unit), y: Vector(Unit)): Bool =",
      "    x == y",
      "",
      "let twoBlanks: Vector(Unit) = [(), ()]",
      "let alsoTwoBlanks: Vector(Unit) = [(), ()]",
      "let oneBlank: Vector(Unit) = [()]",
      "",
      "export let bothTwo: Bool = sameUnits(twoBlanks, alsoTwoBlanks)",
      "export let twoAgainstOne: Bool = sameUnits(twoBlanks, oneBlank)",
      "",
    ].join("\n");
    const emitted = javascript(source);
    expect(emitted).toContain(
      "const __Eq_Vector_Unit = ({ equals: (__left, __right) => " +
        "__trieSize(__left) === __trieSize(__right), " +
        "notEquals: (__left, __right) => !(__trieSize(__left) === __trieSize(__right)) });",
    );
    // The dead family itself, named: no discarded read, no literal-testing
    // guard, and no iterator left over to drive them.
    expect(emitted).not.toContain("__rightElement");
    expect(emitted).not.toContain("if (!(true))");
    expect(emitted).not.toContain("__rightStep");
    const module = await runMain(source);
    // Same length equal, different length not: the whole of unit-vector
    // equality, and the emitted text is now exactly that claim.
    expect(module.bothTwo).toBe(true);
    expect(module.twoAgainstOne).toBe(false);
  });

  test("the `eq` slot of a `Vector(Unit)` `Hash` collapses the same way", async () => {
    const source = [
      "export let holdBlanks(s: Set(Vector(Unit)), v: Vector(Unit)): Set(Vector(Unit)) =",
      "    Set.add(s, v)",
      "",
      "let noSets: Set(Vector(Unit)) = Set.empty",
      "let pairOfBlanks: Vector(Unit) = [(), ()]",
      "let anotherPair: Vector(Unit) = [(), ()]",
      "let singleBlank: Vector(Unit) = [()]",
      "",
      "export let onePair: Int = Set.size(holdBlanks(holdBlanks(noSets, pairOfBlanks), anotherPair))",
      "export let twoLengths: Int = Set.size(holdBlanks(holdBlanks(noSets, pairOfBlanks), singleBlank))",
      "",
    ].join("\n");
    const emitted = javascript(source);
    expect(emitted).toContain(
      "Eq: { equals: (__left, __right) => __trieSize(__left) === __trieSize(__right), ",
    );
    expect(emitted).not.toContain("if (!(true))");
    const module = await runMain(source);
    // Equal-length unit vectors are one member; different lengths are two.
    expect(module.onePair).toBe(1);
    expect(module.twoLengths).toBe(2);
  });

  test("a nested `Vector(Vector(Unit))` collapses the inner walk only", async () => {
    const source = [
      "export let sameGrids(x: Vector(Vector(Unit)), y: Vector(Vector(Unit))): Bool =",
      "    x == y",
      "",
      "let gridOne: Vector(Vector(Unit)) = [[()], [(), ()]]",
      "let gridTwo: Vector(Vector(Unit)) = [[()], [(), ()]]",
      "let gridThree: Vector(Vector(Unit)) = [[()], [()]]",
      "",
      "export let gridsMatch: Bool = sameGrids(gridOne, gridTwo)",
      "export let gridsPartApart: Bool = sameGrids(gridOne, gridThree)",
      "",
    ].join("\n");
    const emitted = javascript(source);
    // The outer walk still binds its right-hand element, because it reads it —
    // for the inner size check the inner walk collapsed to.
    expect(emitted).toContain("const __rightElement = __rightStep.next().value; ");
    expect(emitted).toContain("if (!(__trieSize(__leftElement) === __trieSize(__rightElement)))");
    // And the inner walk minted no binder of its own.
    expect(emitted).not.toContain("__rightElement_1");
    expect(emitted).not.toContain("if (!(true))");
    const module = await runMain(source);
    expect(module.gridsMatch).toBe(true);
    // Inner lengths decide: `[(), ()]` against `[()]`.
    expect(module.gridsPartApart).toBe(false);
  });
});

describe("an operand-free element that is not `true` keeps its loop", () => {
  /**
   * The other half of the rule, and the half a reader is most likely to
   * simplify away: only the literal `true` collapses the loop, because only the
   * identity of the fold makes the loop unable to decide anything. An element
   * expression that ignores its operands *without* being `true` sheds the
   * binding and the iterator it does not read, and keeps the walk.
   *
   * `Vector((Unit, Unit))` is the shape that reaches it: a tuple of units
   * inlines to `true && true`, which is operand-free but is not `true`. The
   * distinction has no semantic weight here — both answers are the same — so
   * nothing but a pin stops it being flattened into "collapse anything
   * operand-free" by someone tidying the arm.
   *
   * The minimal pair below makes the boundary visible: `{a: Unit}` has one
   * field and inlines to bare `true`, so its vector collapses; `(Unit, Unit)`
   * has two and inlines to `true && true`, so its vector does not.
   */
  test("`Vector((Unit, Unit))` keeps the walk `true && true` does not decide", async () => {
    const source = [
      "export let samePairs(x: Vector((Unit, Unit)), y: Vector((Unit, Unit))): Bool =",
      "    x == y",
      "",
      "let twoPairs: Vector((Unit, Unit)) = [((), ()), ((), ())]",
      "let alsoTwoPairs: Vector((Unit, Unit)) = [((), ()), ((), ())]",
      "let onePair: Vector((Unit, Unit)) = [((), ())]",
      "",
      "export let pairsMatch: Bool = samePairs(twoPairs, alsoTwoPairs)",
      "export let pairsCountApart: Bool = samePairs(twoPairs, onePair)",
      "",
    ].join("\n");
    const emitted = javascript(source);
    // The loop survives, guard and all. Collapsing every operand-free element
    // rather than only `true` deletes this line.
    expect(emitted).toContain(
      "__trieSize(__left) === __trieSize(__right) && (() => { " +
        "for (const __leftElement of __left) { if (!(true && true)) return false; } " +
        "return true; })()",
    );
    // And the two names it genuinely does not read are still shed.
    expect(emitted).not.toContain("__rightElement");
    expect(emitted).not.toContain("__rightStep");
    const module = await runMain(source);
    expect(module.pairsMatch).toBe(true);
    expect(module.pairsCountApart).toBe(false);
  });

  test("the boundary: a one-field all-`Unit` record collapses where a pair does not", () => {
    // Same semantics on both sides — every element equals every other — and
    // different emission, because the rule reads the text rather than the
    // meaning. That is the rule working as #680 specified it, and the pair is
    // here so the asymmetry is deliberate rather than discovered.
    expect(javascript(
      "export let sameCellRuns(x: Vector({a: Unit}), y: Vector({a: Unit})): Bool =\n    x == y\n",
    )).toContain(
      "const __Eq_Vector_a = ({ equals: (__left, __right) => " +
        "__trieSize(__left) === __trieSize(__right), ",
    );
    expect(javascript(
      "export let sameTriples(x: Vector((Unit, Unit, Unit)), y: Vector((Unit, Unit, Unit))): Bool =\n" +
        "    x == y\n",
    )).toContain("for (const __leftElement of __left) { if (!(true && true && true)) return false; }");
  });

  test("`compare` over `Vector((Unit, Unit))` keeps its walk too", async () => {
    const source = [
      "export let pairsBefore(x: Vector((Unit, Unit)), y: Vector((Unit, Unit))): Bool =",
      "    x < y",
      "",
      "let shortPairs: Vector((Unit, Unit)) = [((), ())]",
      "let longPairs: Vector((Unit, Unit)) = [((), ()), ((), ())]",
      "",
      "export let shortPairFirst: Bool = pairsBefore(shortPairs, longPairs)",
      "export let longPairFirst: Bool = pairsBefore(longPairs, shortPairs)",
      "",
    ].join("\n");
    const emitted = javascript(source);
    expect(emitted).toContain("if (__step.done) return \"Greater\"; ");
    expect(emitted).toContain("return __rightStep.next().done ? \"Equal\" : \"Less\";");
    expect(emitted).not.toContain("const __rightElement = __step.value;");
    const module = await runMain(source);
    expect(module.shortPairFirst).toBe(true);
    expect(module.longPairFirst).toBe(false);
  });
});

describe("the collapse reaches dictionaries whose names never say `Vector`", () => {
  /**
   * The rule keys on the element expression, so it fires wherever a
   * `Vector(Unit)` is *held* — and there the changed line belongs to the
   * holder's dictionary, whose name carries no trace of the vector. A reader
   * auditing this change by grepping for `__*_Vector_Unit` would miss both
   * shapes below.
   */
  test("a record field and a tuple element holding `Vector(Unit)`", async () => {
    const held = [
      "export record Sheet derives Eq = {rows: Vector(Unit), tag: Int}",
      "",
      "export let sameSheets(x: Sheet, y: Sheet): Bool =",
      "    x == y",
      "",
      "let firstSheet: Sheet = Sheet({rows = [(), ()], tag = 3})",
      "let matchingSheet: Sheet = Sheet({rows = [(), ()], tag = 3})",
      "let shorterSheet: Sheet = Sheet({rows = [()], tag = 3})",
      "",
      "export let sheetsMatch: Bool = sameSheets(firstSheet, matchingSheet)",
      "export let sheetsRowsApart: Bool = sameSheets(firstSheet, shorterSheet)",
      "",
    ].join("\n");
    const heldEmitted = javascript(held);
    expect(heldEmitted).toContain(
      "const __Eq_Sheet_equals = (__left, __right) => " +
        "__trieSize(__left.rows) === __trieSize(__right.rows) && __left.tag === __right.tag;",
    );
    expect(heldEmitted).not.toContain("if (!(true))");
    const heldModule = await runMain(held);
    expect(heldModule.sheetsMatch).toBe(true);
    expect(heldModule.sheetsRowsApart).toBe(false);

    const carried = [
      "export let sameHolders(x: (Vector(Unit), Int), y: (Vector(Unit), Int)): Bool =",
      "    x == y",
      "",
      "let firstHolder: (Vector(Unit), Int) = ([(), ()], 7)",
      "let matchingHolder: (Vector(Unit), Int) = ([(), ()], 7)",
      "let taggedApart: (Vector(Unit), Int) = ([(), ()], 8)",
      "",
      "export let holdersMatch: Bool = sameHolders(firstHolder, matchingHolder)",
      "export let holdersTagApart: Bool = sameHolders(firstHolder, taggedApart)",
      "",
    ].join("\n");
    const carriedEmitted = javascript(carried);
    expect(carriedEmitted).toContain(
      "__trieSize(__left[0]) === __trieSize(__right[0]) && __left[1] === __right[1]",
    );
    expect(carriedEmitted).not.toContain("if (!(true))");
    const carriedModule = await runMain(carried);
    expect(carriedModule.holdersMatch).toBe(true);
    expect(carriedModule.holdersTagApart).toBe(false);
  });
});

describe("an operand-free element order sheds its binding, not its loop", () => {
  test("`Vector(Unit)` compare keeps the walk exhaustion decides", async () => {
    const source = [
      "export let blanksBefore(x: Vector(Unit), y: Vector(Unit)): Bool =",
      "    x < y",
      "",
      "let shortBlanks: Vector(Unit) = [()]",
      "let longBlanks: Vector(Unit) = [(), ()]",
      "",
      "export let shortFirst: Bool = blanksBefore(shortBlanks, longBlanks)",
      "export let longFirst: Bool = blanksBefore(longBlanks, shortBlanks)",
      "",
    ].join("\n");
    const emitted = javascript(source);
    // The discarded read is gone.
    expect(emitted).not.toContain("const __rightElement = __step.value;");
    // The loop is not: `.next()` still advances, `done` still decides
    // `Greater`, and the tail check still separates `Equal` from `Less`.
    expect(emitted).toContain("const __step = __rightStep.next(); if (__step.done) return \"Greater\"; ");
    expect(emitted).toContain("return __rightStep.next().done ? \"Equal\" : \"Less\";");
    const module = await runMain(source);
    // A proper prefix is `Less`; the longer side is `Greater`.
    expect(module.shortFirst).toBe(true);
    expect(module.longFirst).toBe(false);
  });
});

describe("a planner edition at `Unit` collapses, and its siblings do not", () => {
  test("only the `Unit` edition loses its loop", async () => {
    const source = [
      "export let anyVec<a: Eq>(x: Vector(a), y: Vector(a)): Bool =",
      "    x == y",
      "",
      "let blankRun: Vector(Unit) = [(), ()]",
      "let sameBlankRun: Vector(Unit) = [(), ()]",
      "let countRun: Vector(Int) = [4, 5]",
      "let sameCountRun: Vector(Int) = [4, 5]",
      "let otherCountRun: Vector(Int) = [4, 6]",
      "",
      "export let blanksAgree: Bool = anyVec(blankRun, sameBlankRun)",
      "export let countsAgree: Bool = anyVec(countRun, sameCountRun)",
      "export let countsDiffer: Bool = anyVec(countRun, otherCountRun)",
      "",
    ].join("\n");
    const emitted = javascript(source);
    expect(emitted).toContain(
      "const __Eq_Vector_Unit = ({ equals: (__left, __right) => " +
        "__trieSize(__left) === __trieSize(__right), ",
    );
    // The other six editions keep their element reads. `Int`'s is the spot
    // check, and its binder numbering is the one the claim-but-do-not-spell
    // rule protects: the `Unit` edition is minted last and still claims `_7`.
    expect(emitted).toContain("if (!(__leftElement_2 === __rightElement_2)) return false;");
    expect(emitted).not.toContain("if (!(true))");
    const module = await runMain(source);
    expect(module.blanksAgree).toBe(true);
    expect(module.countsAgree).toBe(true);
    expect(module.countsDiffer).toBe(false);
  });
});

describe("every element operation that reads its operands is untouched", () => {
  test("`Vector(Int)` and `Vector(String)` equality keep the whole walk", () => {
    const emitted = javascript([
      "export let sameCounts(x: Vector(Int), y: Vector(Int)): Bool =",
      "    x == y",
      "",
      "export let sameWords(x: Vector(String), y: Vector(String)): Bool =",
      "    x == y",
      "",
    ].join("\n"));
    expect(emitted).toContain(
      "const __rightStep = __right[Symbol.iterator](); for (const __leftElement of __left) { " +
        "const __rightElement = __rightStep.next().value; " +
        "if (!(__leftElement === __rightElement)) return false; }",
    );
    expect(emitted).toContain(
      "const __rightStep_1 = __right[Symbol.iterator](); for (const __leftElement_1 of __left) { " +
        "const __rightElement_1 = __rightStep_1.next().value; " +
        "if (!(__leftElement_1 === __rightElement_1)) return false; }",
    );
  });

  test("a collapsed dictionary does not renumber the live ones beside it", () => {
    // The `Unit` walk is minted first here and still claims the unsuffixed
    // binders, so `Int`'s remain `_1` and `String`'s `_2` exactly as they were
    // before the collapse. Releasing the names would have shifted both.
    const emitted = javascript([
      "export let mixBlanks(x: Vector(Unit), y: Vector(Unit)): Bool =",
      "    x == y",
      "",
      "export let mixCounts(x: Vector(Int), y: Vector(Int)): Bool =",
      "    x == y",
      "",
      "export let mixWords(x: Vector(String), y: Vector(String)): Bool =",
      "    x == y",
      "",
    ].join("\n"));
    expect(emitted).not.toContain("if (!(true))");
    expect(emitted).toContain("const __rightElement_1 = __rightStep_1.next().value;");
    expect(emitted).toContain("const __rightElement_2 = __rightStep_2.next().value;");
    // Nothing reclaimed the names the collapsed walk gave up.
    expect(emitted).not.toContain("const __rightElement = __rightStep.next().value;");
  });

  test("`Vector(Int)` compare keeps its right-hand binding", () => {
    expect(javascript(
      "export let countsBefore(x: Vector(Int), y: Vector(Int)): Bool =\n    x < y\n",
    )).toContain("const __rightElement = __step.value;");
  });
});
