import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

/**
 * Conformance for the derived walks reading the checker's **recorded evidence**
 * at every component seat, entailment path included (issue #669).
 *
 * A binder may demand a constraint it reaches only *through* another. Constraints
 * §2 makes base constraints user-declarable, so `constraint Wide<a: Hash>` gives
 * a `Wide` binder a `Hash` at the dictionary slot `hash`, and an `Eq` at
 * `hash.eq`. The checker folds the narrower demand into the wider binder's
 * requirement and records the path; the elaborator carries it on the component's
 * `Dictionary` evidence node; `#emitEvidence` renders it. Direct expression seats
 * have always read it — `x == y` at plain `a` under `Wide` emits
 * `__Wide_a.hash.eq.equals(x, y)`.
 *
 * The four derived walks did not. Two seat families re-derived the reference from
 * the component's *type kind* instead:
 *
 * - the `Set`/`Map` shortcuts in `#derivedHash` and `#derivedEquals`, which read
 *   `type.element.kind === "Variable"` and rebuilt `#dictionary(id, "Hash")`;
 * - the dispatchers, which admitted only `Instance` evidence, so a variable
 *   component's recorded `Dictionary` node fell through **blind** into the walk
 *   and landed on its top-level `Variable` arm — the same rebuild.
 *
 * Both spelled `__Hash_a` where the module binds `__Wide_a`, and the emitter
 * reported `missing \`Hash\` evidence during JavaScript emission` on a module the
 * checker had accepted.
 *
 * The controls matter as much: the same shapes under a *direct* `Hash`/`Ord`/
 * `Show` binder have always been right, and the repair must move nothing there.
 * A `Dictionary` node under a direct binder records that binder's own constraint
 * and an **empty** path, so reading it produces the identical spelling the
 * rebuild did — which is why no existing expectation in the suite changed.
 *
 * Two things every program here must do, or it measures nothing:
 *
 * - **Pin its literals.** A user constraint is not defaultable, so `same(x, y)`
 *   at a bare `1` is a checker refusal, not an emission. Each call's arguments
 *   are annotated bindings.
 * - **Stay out of the specialization planner.** An *exported* generic `let` over
 *   a structural type mints monomorphic editions, and when this file was written
 *   their component evidence was dropped too, by a different route with its own
 *   repair (issue #675) — under `Eq` as much as under `Ord` and `Show`. Every
 *   wide-binder program here reaches the walks through a bound consumer instead,
 *   so none of them depended on that route in either direction. The one
 *   exception is deliberate and marked: the last `describe` pins the single
 *   planner seat this repair cured on its own, ahead of #675's.
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

/** `constraint Wide<a: Hash>` and its `Int` honor, under a caller's own member name. */
function wide(member: string): string {
  return [
    "constraint Wide<a: Hash> =",
    `    ${member}(value: a): Int`,
    "",
    "honor Wide<Int> =",
    `    ${member}(value) = value`,
    "",
  ].join("\n");
}

describe("the `Set` and `Map` component seats read the recorded path", () => {
  test("a `Set`'s element at the equals walk (#669's filed case)", async () => {
    const source = wide("tagSetEq") +
      "export let same<a: Wide>(x: Set(a), y: Set(a)): Bool =\n" +
      "    x == y\n" +
      "\n" +
      "let first: Set(Int) = Set.fromVector([1, 2])\n" +
      "let reordered: Set(Int) = Set.fromVector([2, 1])\n" +
      "let altered: Set(Int) = Set.fromVector([1, 3])\n" +
      "\n" +
      "export let unordered: Bool = same(first, reordered)\n" +
      "export let different: Bool = same(first, altered)\n";
    // `setEquals` takes the element's *whole* `Hash` dictionary, so the path is
    // visible in the argument rather than buried under a member read.
    expect(javascript(source)).toContain("__setEquals(__Wide_a.hash, x, y)");
    const module = await runMain(source);
    expect(module.unordered).toBe(true);
    expect(module.different).toBe(false);
  });

  test("a `Set`'s element at the hash walk, both slots of the built dictionary", async () => {
    const source = wide("tagSetHash") +
      "export let pair<a: Wide>(x: Set(a), y: Set(a)): Set(Set(a)) =\n" +
      "    Set.add(Set.add(Set.empty, x), y)\n" +
      "\n" +
      "let threeFour: Set(Int) = Set.fromVector([3, 4])\n" +
      "let fourThree: Set(Int) = Set.fromVector([4, 3])\n" +
      "let fourFive: Set(Int) = Set.fromVector([4, 5])\n" +
      "\n" +
      "export let sameTwice: Int = Set.size(pair(threeFour, fourThree))\n" +
      "export let twoSets: Int = Set.size(pair(threeFour, fourFive))\n";
    const emitted = javascript(source);
    // A `Set(Set(a))` builds its element's dictionary here, and both slots reach
    // the inner element's: the `eq` slot's `setEquals` and the `hash` slot's
    // `setHash`.
    expect(emitted).toContain("__setEquals(__Wide_a.hash,");
    expect(emitted).toContain("__setHash(__Wide_a.hash,");
    const module = await runMain(source);
    // One member, not two: equal sets must hash and compare equal through the
    // reached dictionary, which is the membership question `Set.size` answers.
    expect(module.sameTwice).toBe(1);
    expect(module.twoSets).toBe(2);
  });

  test("a `Map`'s key at the equals walk", async () => {
    const source = wide("tagMapKey") +
      "export let alike<a: Wide>(x: Map(a, Int), y: Map(a, Int)): Bool =\n" +
      "    x == y\n" +
      "\n" +
      "let entries: Map(Int, Int) = Map.fromVector([(1, 7), (2, 8)])\n" +
      "let swapped: Map(Int, Int) = Map.fromVector([(2, 8), (1, 7)])\n" +
      "let shifted: Map(Int, Int) = Map.fromVector([(1, 7), (3, 8)])\n" +
      "\n" +
      "export let regrouped: Bool = alike(entries, swapped)\n" +
      "export let rekeyed: Bool = alike(entries, shifted)\n";
    // The key's `Hash` through the path; the value's `Eq` is `Int`'s own
    // instance and must be untouched.
    expect(javascript(source)).toContain("__mapEquals(__Wide_a.hash, __Eq_Int, x, y)");
    const module = await runMain(source);
    expect(module.regrouped).toBe(true);
    expect(module.rekeyed).toBe(false);
  });

  test("a `Map`'s value at the equals walk reaches `Eq` one slot deeper", async () => {
    const source = wide("tagMapValue") +
      "export let matching<a: Wide>(x: Map(Int, a), y: Map(Int, a)): Bool =\n" +
      "    x == y\n" +
      "\n" +
      "let held: Map(Int, Int) = Map.fromVector([(5, 1)])\n" +
      "let copied: Map(Int, Int) = Map.fromVector([(5, 1)])\n" +
      "let changed: Map(Int, Int) = Map.fromVector([(5, 2)])\n" +
      "\n" +
      "export let agreeing: Bool = matching(held, copied)\n" +
      "export let differing: Bool = matching(held, changed)\n";
    // `hash.eq`, not `hash`: an `Eq` demand on a `Wide` binder walks `Wide`'s
    // base `Hash` and then that dictionary's own base `Eq`. This is the deepest
    // path in the file, and the one `#equalityDictionary`'s name-probe — `Eq`,
    // else `Hash.eq` — could not spell at all.
    expect(javascript(source)).toContain("__mapEquals(__Hash_Int, __Wide_a.hash.eq, x, y)");
    const module = await runMain(source);
    expect(module.agreeing).toBe(true);
    expect(module.differing).toBe(false);
  });

  test("a `Map`'s key and value at the hash walk take the `hashBacked` `.eq`", async () => {
    const source = wide("tagMapHash") +
      "export let stash<a: Wide>(s: Set(Map(a, a)), m: Map(a, a)): Set(Map(a, a)) =\n" +
      "    Set.add(s, m)\n" +
      "\n" +
      "let start: Set(Map(Int, Int)) = Set.empty\n" +
      "let entry: Map(Int, Int) = Map.fromVector([(6, 7)])\n" +
      "let same: Map(Int, Int) = Map.fromVector([(6, 7)])\n" +
      "let apart: Map(Int, Int) = Map.fromVector([(6, 8)])\n" +
      "\n" +
      "export let oneEntry: Int = Set.size(stash(stash(start, entry), same))\n" +
      "export let twoEntries: Int = Set.size(stash(stash(start, entry), apart))\n";
    const emitted = javascript(source);
    // Under a `Hash` node the components were raised as `Hash`, so the value's
    // equality is that dictionary's `eq` slot — a suffix written on whatever the
    // selection resolved to, never a second entailment walk.
    expect(emitted).toContain("__mapEquals(__Wide_a.hash, __Wide_a.hash.eq,");
    expect(emitted).toContain("__mapHash(__Wide_a.hash, __Wide_a.hash, __value)");
    const module = await runMain(source);
    expect(module.oneEntry).toBe(1);
    expect(module.twoEntries).toBe(2);
  });
});

describe("the walk dispatchers read a variable component's recorded evidence", () => {
  test("a tuple's variable element at the equals walk", async () => {
    const source = wide("tagTupleEq") +
      "export let both<a: Wide>(x: (a, Int), y: (a, Int)): Bool =\n" +
      "    x == y\n" +
      "\n" +
      "let head: (Int, Int) = (1, 2)\n" +
      "let twin: (Int, Int) = (1, 2)\n" +
      "let other: (Int, Int) = (3, 2)\n" +
      "\n" +
      "export let identical: Bool = both(head, twin)\n" +
      "export let headsApart: Bool = both(head, other)\n";
    expect(javascript(source)).toContain("__Wide_a.hash.eq.equals(__left[0], __right[0])");
    const module = await runMain(source);
    expect(module.identical).toBe(true);
    expect(module.headsApart).toBe(false);
  });

  test("a tuple's variable element at the compare walk", async () => {
    const source = [
      "constraint Sorted<a: Ord> =",
      "    tagCompare(value: a): Int",
      "",
      "honor Sorted<Int> =",
      "    tagCompare(value) = value",
      "",
      "export let before<a: Sorted>(x: (a, Int), y: (a, Int)): Bool =",
      "    x < y",
      "",
      "let low: (Int, Int) = (1, 2)",
      "let tail: (Int, Int) = (1, 3)",
      "let high: (Int, Int) = (2, 0)",
      "",
      "export let byTail: Bool = before(low, tail)",
      "export let byHead: Bool = before(high, low)",
      "",
    ].join("\n");
    // `Ord` is `Sorted`'s own declared base, so the path is one slot: `ord`.
    expect(javascript(source)).toContain("__Sorted_a.ord.compare(__left[0], __right[0])");
    const module = await runMain(source);
    expect(module.byTail).toBe(true);
    expect(module.byHead).toBe(false);
  });

  test("a tuple's variable element at the show walk", async () => {
    const source = [
      "constraint Pretty<a: Show> =",
      "    tagShow(value: a): Int",
      "",
      "honor Pretty<Int> =",
      "    tagShow(value) = value",
      "",
      "export let render<a: Pretty>(x: (a, Int)): String =",
      "    \"${x}\"",
      "",
      "let point: (Int, Int) = (4, 5)",
      "",
      "export let shown: String = render(point)",
      "",
    ].join("\n");
    expect(javascript(source)).toContain("__Pretty_a.show.show(__value[0])");
    const module = await runMain(source);
    expect(module.shown).toBe("(4, 5)");
  });

  test("a tuple's variable element at the hash walk, beneath a `Set`", async () => {
    const source = wide("tagTupleHash") +
      "export let insert<a: Wide>(s: Set((a, Int)), x: (a, Int)): Set((a, Int)) =\n" +
      "    Set.add(s, x)\n" +
      "\n" +
      "let none: Set((Int, Int)) = Set.empty\n" +
      "let eight: (Int, Int) = (8, 9)\n" +
      "let again: (Int, Int) = (8, 9)\n" +
      "let flipped: (Int, Int) = (9, 8)\n" +
      "\n" +
      "export let repeated: Int = Set.size(insert(insert(none, eight), again))\n" +
      "export let separate: Int = Set.size(insert(insert(none, eight), flipped))\n";
    const emitted = javascript(source);
    // Both members of the dictionary `Set.add` receives, each through the path.
    expect(emitted).toContain("__Wide_a.hash.hash(__value[0])");
    expect(emitted).toContain("__Wide_a.hash.eq.equals(__left[0], __right[0])");
    const module = await runMain(source);
    expect(module.repeated).toBe(1);
    expect(module.separate).toBe(2);
  });

  test("the path survives three levels of walk: a set of sets of tuples", async () => {
    const source = wide("tagNested") +
      "export let hold<a: Wide>(\n" +
      "    s: Set(Set((a, Int))),\n" +
      "    x: Set((a, Int)),\n" +
      "): Set(Set((a, Int))) =\n" +
      "    Set.add(s, x)\n" +
      "\n" +
      "let none: Set(Set((Int, Int))) = Set.empty\n" +
      "let single: Set((Int, Int)) = Set.fromVector([(1, 1)])\n" +
      "let copy: Set((Int, Int)) = Set.fromVector([(1, 1)])\n" +
      "let apart: Set((Int, Int)) = Set.fromVector([(2, 2)])\n" +
      "\n" +
      "export let merged: Int = Set.size(hold(hold(none, single), copy))\n" +
      "export let split: Int = Set.size(hold(hold(none, single), apart))\n";
    const emitted = javascript(source);
    // Outer element's `Hash` is built here; its own element's is the tuple's,
    // whose head reaches `__Wide_a` by the same path at every depth.
    expect(emitted).toContain("__Wide_a.hash.hash(__value[0])");
    expect(emitted).toContain("__Wide_a.hash.eq.equals(__left[0], __right[0])");
    const module = await runMain(source);
    expect(module.merged).toBe(1);
    expect(module.split).toBe(2);
  });
});

describe("a planner edition's `Map` value, the seat #669's repair cured first", () => {
  /**
   * Issue #675's defect was a different route into the same walks: the
   * specialization planner rewrote a monomorphic edition's dictionary parameters
   * to `Primitive` evidence *by primitive name*, but left the component's walked
   * type a `Variable`. The walks' type-kind arms then looked up a binder the
   * edition no longer had, and seven editions reported seven ICEs.
   *
   * This one seat escaped that, and it escaped because of the repair this file
   * measures: `#subDictionary` renders whatever node is recorded at a variable
   * component, and `Primitive` is a node like any other, so the `Map` value seat
   * got each edition's own dictionary where it used to get `undefined.eq`. The
   * cure was a consequence of the shape rather than an aim of it, which is why
   * it is pinned here — nothing else in the suite would notice it going away.
   *
   * #675's own repair — the planner substituting an edition's types alongside
   * its evidence — left this module's emission **byte-identical**, which is the
   * strongest confirmation available that the two repairs meet rather than
   * overlap: the seat was already ground-correct, and completing the
   * substitution had nothing left to change here. Every expectation below is the
   * one written before that repair landed.
   */
  test("each edition gets its own `Eq` dictionary where base emitted `undefined.eq`", async () => {
    const source = [
      "export let alike<a: Eq>(x: Map(Int, a), y: Map(Int, a)): Bool =",
      "    x == y",
      "",
      "let held: Map(Int, String) = Map.fromVector([(1, \"a\")])",
      "let copy: Map(Int, String) = Map.fromVector([(1, \"a\")])",
      "let apart: Map(Int, String) = Map.fromVector([(1, \"b\")])",
      "",
      "export let agreeing: Bool = alike(held, copy)",
      "export let differing: Bool = alike(held, apart)",
      "",
    ].join("\n");
    const emitted = javascript(source);
    // The generic body keeps its evidence parameter; each edition names the
    // primitive's own instance. All seven, because seven is what the planner
    // mints and seven is what reported at `ea46fc9`.
    expect(emitted).toContain("__mapEquals(__Hash_Int, __Eq_a, x, y)");
    for (const primitive of ["Nat", "Int", "Float", "BigInt", "Bool", "String", "Unit"]) {
      expect(emitted).toContain(`__mapEquals(__Hash_Int, __Eq_${primitive}, x, y)`);
    }
    expect(emitted).not.toContain("undefined.eq");
    // The consumer is bound at `String`, so the assertions below run *through*
    // one of the cured editions rather than through the generic body.
    expect(emitted).toContain("alikeString(held, copy)");
    const module = await runMain(source);
    expect(module.agreeing).toBe(true);
    expect(module.differing).toBe(false);
  });
});

describe("a direct binder emits exactly what it always did", () => {
  test("a `Set`'s element under `Hash` names the binder's own dictionary", () => {
    expect(javascript(
      "export let same<a: Hash>(x: Set(a), y: Set(a)): Bool =\n" +
        "    x == y\n",
    )).toContain("__setEquals(__Hash_a, x, y)");
  });

  test("a tuple under `Hash` reaches `Eq` through the `eq` slot and no further", () => {
    // The one suffix here is `hashBacked`'s slot read, not an entailment path:
    // a direct binder records an empty one.
    const emitted = javascript(
      "export let held<a: Hash>(s: Set((a, Int)), x: (a, Int)): Set((a, Int)) =\n" +
        "    Set.add(s, x)\n",
    );
    expect(emitted).toContain("__Hash_a.eq.equals(__left[0], __right[0])");
    expect(emitted).toContain("__Hash_a.hash(__value[0])");
  });

  test("a `Map` under two direct binders keys each component separately", () => {
    // The binders display as `a` and `b` whatever the source spells them (#649).
    expect(javascript(
      "export let matched<k: Hash, v: Eq>(x: Map(k, v), y: Map(k, v)): Bool =\n" +
        "    x == y\n",
    )).toContain("__mapEquals(__Hash_a, __Eq_b, x, y)");
  });

  test("a tuple under `Ord`, and one under `Show`", async () => {
    const ordered = [
      "let ahead<a: Ord>(x: (a, Int), y: (a, Int)): Bool =",
      "    x < y",
      "",
      "let earlier: (Int, Int) = (1, 2)",
      "let later: (Int, Int) = (1, 3)",
      "",
      "export let rising: Bool = ahead(earlier, later)",
      "",
    ].join("\n");
    expect(javascript(ordered)).toContain("__Ord_a.compare(__left[0], __right[0])");
    expect((await runMain(ordered)).rising).toBe(true);

    const described = [
      "let describe<a: Show>(x: (a, Int)): String =",
      "    \"${x}\"",
      "",
      "let spot: (Int, Int) = (6, 7)",
      "",
      "export let text: String = describe(spot)",
      "",
    ].join("\n");
    expect(javascript(described)).toContain("__Show_a.show(__value[0])");
    expect((await runMain(described)).text).toBe("(6, 7)");
  });
});
