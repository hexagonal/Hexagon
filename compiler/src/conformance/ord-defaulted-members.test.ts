import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * `Ord`'s defaulted members `max` and `min` (`spec/constraints.md` §2 and §7;
 * `spec/collection-combinators.md` §13.1 and §13.2).
 *
 * Every instance has the two without writing them: declared, derived,
 * parameterized and structural alike. The default bodies live in `Ord.hex`,
 * but a prelude constraint's default does not travel to the honoring module,
 * so the emitter completes them at every instance as it completes `Eq`'s
 * `notEquals` (Constraints §6.1). These tests run the emitted JavaScript at
 * each kind of instance, because a completion that is missing, or that
 * answers the wrong argument on a tie, still compiles.
 *
 * The tie rule is the part an equal-valued pair can hide, so the instances
 * below are built to have equal values that differ: `Float`'s two zeros, and
 * a declared `Ord` whose `compare` reads one field of two.
 */

/** A declared `Eq` and `Ord` that look at `rank` alone, so `tag` shows which argument came back. */
const CARD = [
  "export record Card = {rank: Int, tag: String}",
  "",
  "honor Eq<Card> =",
  "    equals(left, right) = left.rank == right.rank",
  "",
  "honor Ord<Card> =",
  "    compare(left, right) = Ord.compare(left.rank, right.rank)",
  "",
  'export let card(rank: Int, tag: String): Card = Card({rank = rank, tag = tag})',
  "",
].join("\n");

const run = (body: string): Promise<Record<string, unknown>> => runMain("module Main\n\n" + body);

describe("every instance has max and min without writing them (Constraints §2)", () => {
  test("the prelude's own instances, through the dot, qualified by type, and qualified by Ord", async () => {
    const exports = await run([
      "export let dotted: Int = 3.max(4)",
      "export let byType: Int = Int.min(3, 4)",
      "export let byOrd: Int = Ord.max(-2, -7)",
      'export let strings: String = "pear".max("apple")',
      "export let nats: Nat = Ord.min(5, 2)",
      "export let bigs: BigInt = Ord.max(BigInt.fromInt(5), BigInt.fromInt(9))",
      "",
    ].join("\n"));
    expect(exports).toMatchObject({ dotted: 4, byType: 3, byOrd: -2, strings: "pear", nats: 2, bigs: 9n });
  });

  test("on a tie, max answers its second argument and min its first, at a declared instance", async () => {
    const exports = await run(CARD + [
      'export let high: String = Ord.max(card(1, "first"), card(1, "second")).tag',
      'export let low: String = Ord.min(card(1, "first"), card(1, "second")).tag',
      'export let dottedHigh: String = card(1, "first").max(card(1, "second")).tag',
      'export let dottedLow: String = card(1, "first").min(card(1, "second")).tag',
      'export let ordered: String = card(2, "two").min(card(1, "one")).tag',
      "",
    ].join("\n"));
    expect(exports).toMatchObject({
      high: "second",
      low: "first",
      dottedHigh: "second",
      dottedLow: "first",
      ordered: "one",
    });
  });

  test("and at Float, whose zeros are equal and differ", async () => {
    const exports = await run([
      "export let a: Float = Ord.max(0.0, -0.0)",
      "export let b: Float = Ord.max(-0.0, 0.0)",
      "export let c: Float = (0.0).min(-0.0)",
      "export let d: Float = (-0.0).min(0.0)",
      "export let e: Float = Ord.max(1.0, Float.nan)",
      "export let f: Float = Ord.min(1.0, Float.nan)",
      "",
    ].join("\n"));
    expect(Object.is(exports.a, -0)).toBe(true);
    expect(Object.is(exports.b, 0)).toBe(true);
    expect(Object.is(exports.c, 0)).toBe(true);
    expect(Object.is(exports.d, -0)).toBe(true);
    expect(exports.e).toBeNaN();
    expect(exports.f).toBe(1);
  });

  test("a derived instance, a parameterized one, and Bool's", async () => {
    const exports = await run([
      "export record Point derives (Eq, Ord) = {x: Int, y: Int}",
      "export record Box(a) derives (Eq, Ord) = {value: a}",
      "",
      "export let point: Point = Point({x = 1, y = 5}).max(Point({x = 2, y = 0}))",
      "export let box: Box(Int) = Ord.min(Box({value = 3}), Box({value = 1}))",
      "export let boxedFloat: Float = Ord.max(Box({value = 0.0}), Box({value = -0.0})).value",
      "export let flag: Bool = True.max(False)",
      "export let other: Bool = Ord.min(True, False)",
      "",
    ].join("\n"));
    expect(exports.point).toEqual({ x: 2, y: 0 });
    expect(exports.box).toEqual({ value: 1 });
    expect(Object.is(exports.boxedFloat, -0)).toBe(true);
    expect(exports.flag).toBe(true);
    expect(exports.other).toBe(false);
  });

  test("structural instances, which give no dot call, through `Ord.max` and `Ord.min`", async () => {
    const exports = await run([
      'export let tuple: (Int, String) = Ord.min((1, "b"), (1, "a"))',
      "export let tie: (Int, Float) = Ord.max((1, 0.0), (1, -0.0))",
      "export let vector: Vector(Int) = Ord.max([1, 2], [1])",
      "export let unit: Unit = Ord.max((), ())",
      "",
    ].join("\n"));
    expect(exports.tuple).toEqual([1, "a"]);
    expect(Object.is((exports.tie as [number, number])[1], -0)).toBe(true);
    expect([...(exports.vector as Iterable<number>)]).toEqual([1, 2]);
    expect(exports.unit).toBeUndefined();
  });

  test("under an `Ord` bound, through the dictionary, at each kind of instance", async () => {
    const exports = await run(CARD + [
      "export let biggest<a: Ord>(x: a, y: a, z: a): a = x.max(y).max(z)",
      "export let least<a: Ord>(x: a, y: a): a = Ord.min(x, y)",
      "",
      "export let ints: Int = biggest(1, 9, 4)",
      "export let zeros: Float = biggest(0.0, -0.0, 0.0)",
      "export let pairs: (Int, Int) = biggest((1, 2), (3, 0), (2, 9))",
      'export let cards: String = least(card(1, "first"), card(1, "second")).tag',
      "",
    ].join("\n"));
    expect(exports.ints).toBe(9);
    expect(Object.is(exports.zeros, 0)).toBe(true);
    expect(exports.pairs).toEqual([3, 0]);
    expect(exports.cards).toBe("first");
  });
});

describe("an instance may write its own (Constraints §2, §7)", () => {
  /**
   * Law-breaking on purpose, as `Eq`'s override test is: only an override
   * that answers differently from the default shows that the completion did
   * not replace it.
   */
  test("a written max is the one called, every way it is reached, and min keeps its default", async () => {
    const exports = await run([
      "export union Size = Small | Large",
      "",
      "honor Eq<Size> = derive",
      "",
      "honor Ord<Size> =",
      "    compare(left, right) =",
      "        match (left, right)",
      "            (Small, Large) => Ordering.Less",
      "            (Large, Small) => Ordering.Greater",
      "            _ => Ordering.Equal",
      "    max(left, right) = right",
      "",
      "export let dotted: Size = Large.max(Small)",
      "export let qualified: Size = Ord.max(Large, Small)",
      "export let generic<a: Ord>(x: a, y: a): a = x.max(y)",
      "export let bounded: Size = generic(Large, Small)",
      "export let defaulted: Size = Ord.min(Large, Small)",
      "",
    ].join("\n"));
    expect(exports).toMatchObject({
      dotted: { tag: "Small" },
      qualified: { tag: "Small" },
      bounded: { tag: "Small" },
      defaulted: { tag: "Small" },
    });
  });

  /**
   * A parameterized instance has no seats: its record is built by a factory,
   * slot by slot, so a completion that ignored the written member would
   * become a second `max` key there, and the later key would win.
   */
  test("and at a parameterized instance, whose record is built by a factory", async () => {
    const exports = await run([
      "export record Box(a) = {value: a}",
      "",
      "honor<a: Eq> Eq<Box(a)> = derive",
      "",
      "honor<a: Ord> Ord<Box(a)> =",
      "    compare(left, right) = Ord.compare(left.value, right.value)",
      "    max(left, right) = left",
      "",
      "export let written: Int = Ord.max(Box({value = 1}), Box({value = 2})).value",
      "export let defaulted: Int = Ord.min(Box({value = 2}), Box({value = 1})).value",
      "export let tie: Float = Ord.min(Box({value = -0.0}), Box({value = 0.0})).value",
      "",
    ].join("\n"));
    expect(exports.written).toBe(1);
    expect(exports.defaulted).toBe(1);
    expect(Object.is(exports.tie, -0)).toBe(true);
  });
});

describe("the spellings the members claim (Constraints §4.6)", () => {
  test("a module that honors Ord binds no max or min of its own", () => {
    expect(projectDiagnostics("module Main\n\n" + [
      "export record Card derives (Eq, Ord) = {rank: Int}",
      "",
      "export let max(left: Card, right: Card): Card = left",
      "",
    ].join("\n"))).toEqual([
      "`max` is already bound: the `Ord<Card>` instance binds it as a member (line 3); " +
      "Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  test("a tuple gives max no dot call, exactly as it gives compare none", () => {
    const max = projectDiagnostics("module Main\n\nexport let t: (Int, Int) = (1, 2).max((0, 3))\n");
    const compare = projectDiagnostics("module Main\n\nexport let t: Ordering = (1, 2).compare((0, 3))\n");
    expect(max).toHaveLength(1);
    expect(compare).toHaveLength(1);
    expect(max[0]!.replace("max", "compare")).toBe(compare[0]);
  });
});

describe("what the completion emits (Constraints §6.1)", () => {
  const project = () => compileMain("module Main\n\n" + CARD + [
    "export let n: Int = 3.max(4)",
    'export let c: Card = card(1, "a").min(card(2, "b"))',
    "export let u: Unit = Ord.max((), ())",
    "",
  ].join("\n"));
  const text = (path: string) => project().modules.find(({ source }) => source.path === path)!.javascript.text;

  test("a ground instance seats both members, and a concrete call calls the seat", () => {
    const main = text("/main.hex");
    expect(main).toContain("const __Ord_Card_max = ");
    expect(main).toContain("const __Ord_Card_min = ");
    expect(main).toContain("max: __Ord_Card_max, min: __Ord_Card_min");
    expect(main).toMatch(/__Ord_Card_min\(card\(1, "a"\), card\(2, "b"\)\)/u);
    expect(main).toMatch(/import \{[^}]*__Ord_Int_max[^}]*\} from "\.\/Hex\/Int\.js"/u);
    const int = text("/Hex/Int.hex");
    expect(int).toContain("const __Ord_Int_max = ");
    expect(int).toContain("const __Ord_Int_min = ");
  });

  test("no default helper is referenced, and no instance carries a member twice", () => {
    for (const path of ["/main.hex", "/Hex/Int.hex"]) {
      const emitted = text(path);
      expect(emitted).not.toContain("__default");
      for (const literal of emitted.match(/\{ Eq: [^\n]*compare: [^\n]*\}/gu) ?? []) {
        expect(literal.match(/\bmax:/gu) ?? []).toHaveLength(1);
        expect(literal.match(/\bmin:/gu) ?? []).toHaveLength(1);
      }
    }
  });

  /**
   * The other route Constraints §6.5 allows: a module that imports `Ord`'s
   * module reaches the home's hoisted helpers, so its seats refer to them
   * instead of carrying the body. Same member set, same answers.
   */
  test("an honoring module that imports Ord refers to the home's helpers instead", async () => {
    const source = "module Main\n\nimport Ord\n\n" + CARD + [
      'export let high: String = Ord.max(card(1, "first"), card(1, "second")).tag',
      'export let low: String = card(1, "first").min(card(1, "second")).tag',
      "",
    ].join("\n");
    const main = compileMain(source).modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
    expect(main).toMatch(/import \{ __default_max, __default_min \} from "\.\/Hex\/Ord\.js";/u);
    expect(main).toContain("const __Ord_Card_max = (__arg0, __arg1) => __default_max(__Ord_Card, __arg0, __arg1);");
    expect(await runMain(source)).toMatchObject({ high: "second", low: "first" });
  });

  /**
   * On that route a parameterized instance's factory gets its members from
   * the home's helpers, so the completion must see them there too, or it adds
   * a second `max` and `min` to the record. A ground instance can't show the
   * duplicate: its seats take the first member of each name.
   */
  test("and a parameterized instance there carries each member once, written or defaulted", async () => {
    const source = "module Main\n\nimport Ord\n\n" + [
      "export record Box(a) = {value: a}",
      "export record Pair(a) = {value: a}",
      "",
      "honor<a: Eq> Eq<Box(a)> = derive",
      "honor<a: Eq> Eq<Pair(a)> = derive",
      "",
      "honor<a: Ord> Ord<Box(a)> =",
      "    compare(left, right) = Ord.compare(left.value, right.value)",
      "",
      "honor<a: Ord> Ord<Pair(a)> =",
      "    compare(left, right) = Ord.compare(left.value, right.value)",
      "    max(left, right) = left",
      "",
      "export let boxMax: Float = Ord.max(Box({value = 0.0}), Box({value = -0.0})).value",
      "export let boxMin: Float = Ord.min(Box({value = 0.0}), Box({value = -0.0})).value",
      "export let pairMax: Int = Ord.max(Pair({value = 1}), Pair({value = 2})).value",
      "export let pairMin: Int = Ord.min(Pair({value = 2}), Pair({value = 1})).value",
      "",
    ].join("\n");
    const main = compileMain(source).modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
    const factories = main.match(/\{ Eq: [^\n]*compare: [^\n]*\}/gu) ?? [];
    expect(factories.length).toBeGreaterThanOrEqual(2);
    for (const literal of factories) {
      expect(literal.match(/\bmax:/gu) ?? []).toHaveLength(1);
      expect(literal.match(/\bmin:/gu) ?? []).toHaveLength(1);
    }
    const exports = await runMain(source);
    expect(Object.is(exports.boxMax, -0)).toBe(true);
    expect(Object.is(exports.boxMin, 0)).toBe(true);
    expect(exports).toMatchObject({ pairMax: 1, pairMin: 1 });
  });

  test("a hoisted structural dictionary reads its own compare through its name", () => {
    const main = compileMain("module Main\n\n" + 'export let t: (Int, String) = Ord.max((1, "a"), (1, "b"))\n')
      .modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    const binding = main.split("\n").find((line) => line.startsWith("const __Ord_Int_String = "))!;
    expect(binding).toContain(
      'max: (__left, __right) => __Ord_Int_String.compare(__left, __right).tag === "Greater" ? __left : __right',
    );
    expect(binding).toContain(
      'min: (__left, __right) => __Ord_Int_String.compare(__left, __right).tag === "Greater" ? __right : __left',
    );
    // The walk itself is written once, in `compare`.
    expect(binding.match(/__compareString\(/gu) ?? []).toHaveLength(1);
  });

  /**
   * At `Card` no edition answers the generic call, so its body runs with the
   * dictionary passed in, and the tuple's dictionary is built in place around
   * it: the path that has no name to read `compare` through.
   */
  test("a structural dictionary written in place, with a free component, repeats the walk and answers the same", async () => {
    const exports = await run(CARD + [
      "export let pick<a: Ord>(x: a, y: a): (a, Int) = Ord.max((x, 1), (y, 1))",
      "export let low<a: Ord>(x: a, y: a): (a, Int) = Ord.min((x, 1), (y, 1))",
      'export let high: String = match pick(card(1, "first"), card(1, "second"))',
      "    (chosen, _) => chosen.tag",
      'export let least: String = match low(card(1, "first"), card(1, "second"))',
      "    (chosen, _) => chosen.tag",
      'export let ordered: String = match pick(card(3, "three"), card(2, "two"))',
      "    (chosen, _) => chosen.tag",
      "",
    ].join("\n"));
    expect(exports).toMatchObject({ high: "second", least: "first", ordered: "three" });
  });

  test("Unit's structural dictionary answers its tie arguments directly", () => {
    // Every `Unit` value is `undefined`, so only the emitted text can show which argument comes back.
    const binding = text("/main.hex").split("\n").find((line) => line.startsWith("const __Ord_Unit = "))!;
    expect(binding).toContain("max: (__left, __right) => __right");
    expect(binding).toContain("min: (__left, __right) => __left");
  });
});
