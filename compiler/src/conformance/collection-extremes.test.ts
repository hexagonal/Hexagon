import fc from "fast-check";
import { beforeAll, describe, expect, test } from "vitest";

import { compileFiles, compileMain, runMain } from "../support/test-project.js";

/**
 * Extremes and totals (`spec/collection-combinators.md` §13): `Ord`'s members
 * `max` and `min` over two values, and `max`, `min`, `maxBy`, `minBy`,
 * `maxUsing`, `minUsing`, `sum` and `product` over `Vector`, `Set` and `Seq`,
 * with the first six over a `Map`'s entries. How every kind of instance comes
 * to have the two members is `ord-defaulted-members.test.ts`'s subject.
 *
 * Every order form is the one walk §13.2 spells out: the best item starts as
 * the first, and each later item `x` replaces it unless `compare(best, x)` is
 * `Greater` (for `max`), or only when it is (for `min`). The oracle below is
 * that walk written in JavaScript over the collection's traversal order, so a
 * test can compare the answer and the exact calls the comparator receives.
 * Callbacks are JavaScript functions handed to exported Hexagon functions, and
 * an `Ordering` handed back from JavaScript is the tagged object the language
 * represents it as.
 *
 * The items are `(Int, Int)` pairs on every collection, a `Map(Int, Int)`'s
 * entries included, so one callback type serves all four.
 */

const SOURCE = `module Main

export let vec(values: Array((Int, Int))): Vector((Int, Int)) = Array.toVector(values)
export let set(values: Array((Int, Int))): Set((Int, Int)) = Set.fromVector(Array.toVector(values))
export let seq(values: Array((Int, Int))): Seq((Int, Int)) = Array.toVector(values).toSeq()
export let map(values: Array((Int, Int))): Map(Int, Int) = Map.fromVector(Array.toVector(values))
export let ints(values: Array(Int)): Vector(Int) = Array.toVector(values)
export let intSet(values: Array(Int)): Set(Int) = Set.fromVector(Array.toVector(values))
export let floats(values: Array(Float)): Vector(Float) = Array.toVector(values)
export let floatSet(values: Array(Float)): Set(Float) = Set.fromVector(Array.toVector(values))

-- The traversal orders the oracle walks.
export let setOrder(s: Set((Int, Int))): Vector((Int, Int)) = Vector.fromSeq(s.toSeq())
export let mapOrder(m: Map(Int, Int)): Vector((Int, Int)) = Vector.fromSeq(m.toSeq())
export let floatSetOrder(s: Set(Float)): Vector(Float) = Vector.fromSeq(s.toSeq())

export let vMax(c: Vector((Int, Int))): Option((Int, Int)) = c.max()
export let vMin(c: Vector((Int, Int))): Option((Int, Int)) = c.min()
export let vMaxBy(c: Vector((Int, Int)), key: ((Int, Int)) ->! Int): Option((Int, Int)) = c.maxBy!(key)
export let vMinBy(c: Vector((Int, Int)), key: ((Int, Int)) ->! Int): Option((Int, Int)) = c.minBy!(key)
export let vMaxUsing(c: Vector((Int, Int)), compare: ((Int, Int), (Int, Int)) ->! Ordering): Option((Int, Int)) =
    c.maxUsing!(compare)
export let vMinUsing(c: Vector((Int, Int)), compare: ((Int, Int), (Int, Int)) ->! Ordering): Option((Int, Int)) =
    c.minUsing!(compare)

export let sMax(c: Set((Int, Int))): Option((Int, Int)) = c.max()
export let sMin(c: Set((Int, Int))): Option((Int, Int)) = c.min()
export let sMaxBy(c: Set((Int, Int)), key: ((Int, Int)) ->! Int): Option((Int, Int)) = c.maxBy!(key)
export let sMinBy(c: Set((Int, Int)), key: ((Int, Int)) ->! Int): Option((Int, Int)) = c.minBy!(key)
export let sMaxUsing(c: Set((Int, Int)), compare: ((Int, Int), (Int, Int)) ->! Ordering): Option((Int, Int)) =
    c.maxUsing!(compare)
export let sMinUsing(c: Set((Int, Int)), compare: ((Int, Int), (Int, Int)) ->! Ordering): Option((Int, Int)) =
    c.minUsing!(compare)

export let qMax(c: Seq((Int, Int))): Option((Int, Int)) = c.max()
export let qMin(c: Seq((Int, Int))): Option((Int, Int)) = c.min()
export let qMaxBy(c: Seq((Int, Int)), key: ((Int, Int)) ->! Int): Option((Int, Int)) = c.maxBy!(key)
export let qMinBy(c: Seq((Int, Int)), key: ((Int, Int)) ->! Int): Option((Int, Int)) = c.minBy!(key)
export let qMaxUsing(c: Seq((Int, Int)), compare: ((Int, Int), (Int, Int)) ->! Ordering): Option((Int, Int)) =
    c.maxUsing!(compare)
export let qMinUsing(c: Seq((Int, Int)), compare: ((Int, Int), (Int, Int)) ->! Ordering): Option((Int, Int)) =
    c.minUsing!(compare)

export let mMax(c: Map(Int, Int)): Option((Int, Int)) = c.max()
export let mMin(c: Map(Int, Int)): Option((Int, Int)) = c.min()
export let mMaxBy(c: Map(Int, Int), key: ((Int, Int)) ->! Int): Option((Int, Int)) = c.maxBy!(key)
export let mMinBy(c: Map(Int, Int), key: ((Int, Int)) ->! Int): Option((Int, Int)) = c.minBy!(key)
export let mMaxUsing(c: Map(Int, Int), compare: ((Int, Int), (Int, Int)) ->! Ordering): Option((Int, Int)) =
    c.maxUsing!(compare)
export let mMinUsing(c: Map(Int, Int), compare: ((Int, Int), (Int, Int)) ->! Ordering): Option((Int, Int)) =
    c.minUsing!(compare)

-- The sort, for agreement (§13.2).
export let vSort(c: Vector((Int, Int))): Vector((Int, Int)) = c.sort()
export let vSortBy(c: Vector((Int, Int)), key: ((Int, Int)) ->! Int): Vector((Int, Int)) = c.sortBy!(key)
export let vSortUsing(c: Vector((Int, Int)), compare: ((Int, Int), (Int, Int)) ->! Ordering): Vector((Int, Int)) =
    c.sortUsing!(compare)
export let fSort(c: Vector(Float)): Vector(Float) = c.sort()

export let fMax(c: Vector(Float)): Option(Float) = c.max()
export let fMin(c: Vector(Float)): Option(Float) = c.min()
export let ordMax(left: Float, right: Float): Float = Ord.max(left, right)
export let ordMin(left: Float, right: Float): Float = Ord.min(left, right)
export let ordMaxPair(left: (Int, Int), right: (Int, Int)): (Int, Int) = Ord.max(left, right)
export let ordMinPair(left: (Int, Int), right: (Int, Int)): (Int, Int) = Ord.min(left, right)

export let vSum(c: Vector(Int)): Int = c.sum()
export let vProduct(c: Vector(Int)): Int = c.product()
export let sSum(c: Set(Int)): Int = c.sum()
export let sProduct(c: Set(Int)): Int = c.product()
export let qSum(c: Seq(Int)): Int = c.sum()
export let qProduct(c: Seq(Int)): Int = c.product()
export let fSum(c: Vector(Float)): Float = c.sum()
export let fProduct(c: Vector(Float)): Float = c.product()
export let fSetSum(c: Set(Float)): Float = c.sum()
export let intSeq(values: Array(Int)): Seq(Int) = Array.toVector(values).toSeq()

-- Through the \`Seq\` seats (Collections Part 5 section 3.4).
export let rangeSum: Int = Seq.sum(1..100)
export let rangeProduct: Int = Seq.product(1..10)
export let longMax: Option(Int) = Seq.max(1..200000)
export let longMinBy: Option(Int) = Seq.minBy(1..200000, (n) => 0 - n)
export let setMaxThroughSeq(s: Set(Int)): Option(Int) = Seq.max(s)
export let vectorSumThroughSeq(v: Vector(Int)): Int = Seq.sum(v)
export let mapValuesSum(m: Map(Int, Int)): Int = m.values().sum()
`;

type Pair = readonly [number, number];
type Ordering = { readonly tag: "Less" | "Equal" | "Greater" };
type Option<T> = { readonly tag: "Some"; readonly value: T } | { readonly tag: "None" };
type Key = (item: Pair) => number;
type Compare = (left: Pair, right: Pair) => Ordering;

type Forms = {
  readonly build: (values: readonly Pair[]) => unknown;
  /** The items in the collection's traversal order. */
  readonly order: (collection: unknown, values: readonly Pair[]) => readonly Pair[];
  readonly max: (collection: unknown) => Option<Pair>;
  readonly min: (collection: unknown) => Option<Pair>;
  readonly maxBy: (collection: unknown, key: Key) => Option<Pair>;
  readonly minBy: (collection: unknown, key: Key) => Option<Pair>;
  readonly maxUsing: (collection: unknown, compare: Compare) => Option<Pair>;
  readonly minUsing: (collection: unknown, compare: Compare) => Option<Pair>;
};

type Exports = Record<string, (...args: never[]) => unknown> & Record<string, unknown>;

let main: Exports;
let collections: Record<"Vector" | "Set" | "Seq" | "Map", Forms>;

const call = <R>(name: string, ...args: unknown[]): R =>
  (main[name] as unknown as (...rest: unknown[]) => R)(...args);

beforeAll(async () => {
  main = (await runMain(SOURCE)) as unknown as Exports;
  const forms = (prefix: string, build: string, order: Forms["order"]): Forms => ({
    build: (values) => call(build, values),
    order,
    max: (c) => call(`${prefix}Max`, c),
    min: (c) => call(`${prefix}Min`, c),
    maxBy: (c, key) => call(`${prefix}MaxBy`, c, key),
    minBy: (c, key) => call(`${prefix}MinBy`, c, key),
    maxUsing: (c, compare) => call(`${prefix}MaxUsing`, c, compare),
    minUsing: (c, compare) => call(`${prefix}MinUsing`, c, compare),
  });
  collections = {
    Vector: forms("v", "vec", (_, values) => values),
    Set: forms("s", "set", (c) => [...call<Iterable<Pair>>("setOrder", c)]),
    Seq: forms("q", "seq", (_, values) => values),
    Map: forms("m", "map", (c) => [...call<Iterable<Pair>>("mapOrder", c)]),
  };
});

const LESS: Ordering = { tag: "Less" };
const EQUAL: Ordering = { tag: "Equal" };
const GREATER: Ordering = { tag: "Greater" };
const ordering = (difference: number): Ordering => difference < 0 ? LESS : difference > 0 ? GREATER : EQUAL;
const byPair = (a: Pair, b: Pair): Ordering => ordering(a[0] - b[0] || a[1] - b[1]);
const NONE = { tag: "None" };
const some = <T>(value: T) => ({ tag: "Some", value });

/** §13.2's walk: which answers replace the best, for `max` and for `min`. */
const replacesForMax = (answer: Ordering): boolean => answer.tag !== "Greater";
const replacesForMin = (answer: Ordering): boolean => answer.tag === "Greater";

/** The walk in JavaScript: the answer and the comparator calls, in order. */
function walk(
  items: readonly Pair[],
  compare: Compare,
  replaces: (answer: Ordering) => boolean,
): { readonly answer: Option<Pair>; readonly calls: readonly (readonly [Pair, Pair])[] } {
  const calls: (readonly [Pair, Pair])[] = [];
  if (items.length === 0) return { answer: { tag: "None" }, calls };
  let best = items[0]!;
  for (const item of items.slice(1)) {
    calls.push([best, item]);
    if (replaces(compare(best, item))) best = item;
  }
  return { answer: { tag: "Some", value: best }, calls };
}

/** A comparator whose answers come from a seeded generator, so they obey no law. */
function arbitrary(seed: number): Compare {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) >>> 0;
    return [LESS, EQUAL, GREATER][state % 3]!;
  };
}

/** The thrown value, or `undefined` when `run` returns. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (failure) {
    return failure;
  }
  return undefined;
}

// Up to 200 pairs, first components from a small range so that equal keys are
// common and which of the tied items is kept shows; a `Map` keeps the last
// value for each key, so its entries are built from distinct keys.
const pairs = fc.array(
  fc.tuple(fc.integer({ min: 0, max: 9 }), fc.integer({ min: -1000, max: 1000 })),
  { maxLength: 200, size: "max" },
);
const NAMES = ["Vector", "Set", "Seq", "Map"] as const;

describe("the order forms walk the items once, keeping a best (§13.2, §13.3)", () => {
  test.each(NAMES)("%s: maxUsing and minUsing call compare(best, x) n - 1 times, in traversal order", (name) => {
    const forms = collections[name];
    fc.assert(fc.property(pairs, (values) => {
      const collection = forms.build(values);
      const items = forms.order(collection, values);
      for (const [form, replaces] of [[forms.maxUsing, replacesForMax], [forms.minUsing, replacesForMin]] as const) {
        const asked: (readonly [Pair, Pair])[] = [];
        const answer = form(collection, (a, b) => (asked.push([a, b]), byPair(a, b)));
        const expected = walk(items, byPair, replaces);
        expect(answer).toEqual(expected.answer);
        expect(asked).toEqual(expected.calls);
        expect(asked).toHaveLength(Math.max(items.length - 1, 0));
      }
    }), { numRuns: 100 });
  });

  test.each(NAMES)("%s: a comparator that is not consistent still gets back the item the walk gives", (name) => {
    const forms = collections[name];
    fc.assert(fc.property(pairs, fc.integer(), (values, seed) => {
      const collection = forms.build(values);
      const items = forms.order(collection, values);
      for (const [form, replaces] of [[forms.maxUsing, replacesForMax], [forms.minUsing, replacesForMin]] as const) {
        const asked: (readonly [Pair, Pair])[] = [];
        const answers = arbitrary(seed);
        const answer = form(collection, (a, b) => (asked.push([a, b]), answers(a, b)));
        const expected = walk(items, arbitrary(seed), replaces);
        expect(answer).toEqual(expected.answer);
        expect(asked).toEqual(expected.calls);
      }
    }), { numRuns: 100 });
  });

  test.each(NAMES)("%s: maxBy and minBy call the key once per item, in traversal order", (name) => {
    const forms = collections[name];
    // A key over both components with three answers, so that distinct items,
    // a set's and a map's included, tie often.
    const tier = (item: Pair): number => (((item[0] + item[1]) % 3) + 3) % 3;
    const byTier: Compare = (a, b) => ordering(tier(a) - tier(b));
    fc.assert(fc.property(pairs, (values) => {
      const collection = forms.build(values);
      const items = forms.order(collection, values);
      for (const [form, replaces] of [[forms.maxBy, replacesForMax], [forms.minBy, replacesForMin]] as const) {
        const keyed: Pair[] = [];
        const answer = form(collection, (item) => (keyed.push(item), tier(item)));
        expect(keyed).toEqual(items);
        expect(answer).toEqual(walk(items, byTier, replaces).answer);
      }
    }), { numRuns: 100 });
  });

  test.each(NAMES)("%s: max and min are the Using forms under Ord", (name) => {
    const forms = collections[name];
    fc.assert(fc.property(pairs, (values) => {
      const collection = forms.build(values);
      const items = forms.order(collection, values);
      expect(forms.max(collection)).toEqual(walk(items, byPair, replacesForMax).answer);
      expect(forms.min(collection)).toEqual(walk(items, byPair, replacesForMin).answer);
    }), { numRuns: 100 });
  });

  test.each(NAMES)("%s: every order form answers None when empty, and calls nothing", (name) => {
    const forms = collections[name];
    const empty = forms.build([]);
    const never = (): never => {
      throw new Error("called");
    };
    expect(forms.max(empty)).toEqual(NONE);
    expect(forms.min(empty)).toEqual(NONE);
    expect(forms.maxBy(empty, never)).toEqual(NONE);
    expect(forms.minBy(empty, never)).toEqual(NONE);
    expect(forms.maxUsing(empty, never)).toEqual(NONE);
    expect(forms.minUsing(empty, never)).toEqual(NONE);
  });

  test.each(NAMES)("%s: one item is the answer, the key runs once and the comparator never", (name) => {
    const forms = collections[name];
    const one = forms.build([[4, 2]]);
    const never = (): never => {
      throw new Error("called");
    };
    let keys = 0;
    expect(forms.maxUsing(one, never)).toEqual(some([4, 2]));
    expect(forms.minUsing(one, never)).toEqual(some([4, 2]));
    expect(forms.maxBy(one, () => (keys += 1, 0))).toEqual(some([4, 2]));
    expect(keys).toBe(1);
  });

  test.each(NAMES)("%s: a failing key or comparator ends the call with its own failure", (name) => {
    const forms = collections[name];
    const values: Pair[] = [[3, 0], [1, 1], [2, 2], [5, 3]];
    const collection = forms.build(values);
    const items = forms.order(collection, values);
    const failure = new Error("stop");
    const keyed: Pair[] = [];
    expect(thrown(() => forms.maxBy(collection, (item) => {
      keyed.push(item);
      if (keyed.length === 3) throw failure;
      return item[0];
    }))).toBe(failure);
    expect(keyed).toEqual(items.slice(0, 3));
    let compared = 0;
    expect(thrown(() => forms.minUsing(collection, () => {
      compared += 1;
      if (compared === 2) throw failure;
      return EQUAL;
    }))).toBe(failure);
    expect(compared).toBe(2);
  });
});

describe("ties: min keeps the first, max the last, agreeing with the sort (§13.2)", () => {
  test("on a Vector, the By and Using forms are the ends of sortBy and sortUsing, both directions", () => {
    const ascending: Compare = (a, b) => ordering(a[0] - b[0]);
    const descending: Compare = (a, b) => ordering(b[0] - a[0]);
    fc.assert(fc.property(pairs.filter((values) => values.length > 0), (values) => {
      const vector = call("vec", values);
      const first = (sorted: Iterable<Pair>) => some([...sorted][0]);
      const last = (sorted: Iterable<Pair>) => some([...sorted].at(-1));
      const byKey = call<Iterable<Pair>>("vSortBy", vector, ([key]: Pair) => key);
      expect(call("vMinBy", vector, ([key]: Pair) => key)).toEqual(first(byKey));
      expect(call("vMaxBy", vector, ([key]: Pair) => key)).toEqual(last(byKey));
      const byNegatedKey = call<Iterable<Pair>>("vSortBy", vector, ([key]: Pair) => -key);
      expect(call("vMinBy", vector, ([key]: Pair) => -key)).toEqual(first(byNegatedKey));
      expect(call("vMaxBy", vector, ([key]: Pair) => -key)).toEqual(last(byNegatedKey));
      for (const compare of [ascending, descending]) {
        const sorted = call<Iterable<Pair>>("vSortUsing", vector, compare);
        expect(call("vMinUsing", vector, compare)).toEqual(first(sorted));
        expect(call("vMaxUsing", vector, compare)).toEqual(last(sorted));
      }
      const sorted = call<Iterable<Pair>>("vSort", vector);
      expect(call("vMin", vector)).toEqual(first(sorted));
      expect(call("vMax", vector)).toEqual(last(sorted));
    }), { numRuns: 200 });
  });

  test("the same ends as a stable sort in JavaScript, on a Vector and a Seq", () => {
    fc.assert(fc.property(pairs.filter((values) => values.length > 0), (values) => {
      const stable = [...values].sort((a, b) => a[0] - b[0]);
      for (const [build, prefix] of [["vec", "v"], ["seq", "q"]] as const) {
        expect(call(`${prefix}MinBy`, call(build, values), ([key]: Pair) => key)).toEqual(some(stable[0]));
        expect(call(`${prefix}MaxBy`, call(build, values), ([key]: Pair) => key)).toEqual(some(stable.at(-1)));
      }
    }), { numRuns: 100 });
  });

  test("equal zeros show which one is kept", () => {
    const isNegativeZero = (option: Option<number>) => option.tag === "Some" && Object.is(option.value, -0);
    expect(isNegativeZero(call("fMax", call("floats", [0, -0])))).toBe(true);
    expect(isNegativeZero(call("fMin", call("floats", [0, -0])))).toBe(false);
    expect(isNegativeZero(call("fMax", call("floats", [-0, 0])))).toBe(false);
    expect(isNegativeZero(call("fMin", call("floats", [-0, 0])))).toBe(true);
    // And the sort puts them in the same places.
    const sorted = [...call<Iterable<number>>("fSort", call("floats", [0, -0]))];
    expect(sorted.map((zero) => Object.is(zero, -0))).toEqual([false, true]);
  });

  test("Ord.min of a pair is its first on a tie, Ord.max its second", () => {
    fc.assert(fc.property(fc.tuple(fc.integer(), fc.integer()), fc.tuple(fc.integer(), fc.integer()), (a, b) => {
      const low = call<Pair>("ordMinPair", a, b);
      const high = call<Pair>("ordMaxPair", a, b);
      expect([[a, b], [b, a]]).toContainEqual([low, high]);
      const greater = a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
      expect(high).toEqual(greater ? a : b);
      expect(low).toEqual(greater ? b : a);
    }));
  });
});

describe("Float follows Ord<Float> (§13.2)", () => {
  test("NaN is greatest, and the zeros are equal", () => {
    const max = call<Option<number>>("fMax", call("floats", [1, NaN, 2]));
    expect(max.tag === "Some" && Number.isNaN(max.value)).toBe(true);
    expect(call("fMin", call("floats", [1, NaN, 2]))).toEqual(some(1));
    expect(call<number>("ordMin", 1, NaN)).toBe(1);
    expect(call<number>("ordMax", 1, NaN)).toBeNaN();
    expect(call<number>("ordMax", 0, -0)).toBe(-0);
    expect(call<number>("ordMin", 0, -0)).toBe(0);
    expect(call<number>("ordMax", -0, 0)).toBe(0);
  });
});

describe("sum and product are left folds from the identity (§13.2)", () => {
  const floats = fc.array(fc.double(), { maxLength: 100 });

  test("a Float sum and product round step by step, left to right, as a loop does", () => {
    fc.assert(fc.property(floats, (values) => {
      expect(call<number>("fSum", call("floats", values))).toBe(values.reduce((a, b) => a + b, 0));
      expect(call<number>("fProduct", call("floats", values))).toBe(values.reduce((a, b) => a * b, 1));
    }), { numRuns: 200 });
    expect(call<number>("fSum", call("floats", [0.1, 0.2, 0.3]))).toBe(0.6000000000000001);
  });

  test("a Set's Float sum runs in its traversal order", () => {
    fc.assert(fc.property(floats, (values) => {
      const set = call("floatSet", values);
      const order = [...call<Iterable<number>>("floatSetOrder", set)];
      expect(call<number>("fSetSum", set)).toBe(order.reduce((a, b) => a + b, 0));
    }), { numRuns: 100 });
  });

  test("Vector.sum([-0.0]) is 0.0, and a NaN makes the sum NaN", () => {
    expect(call<number>("fSum", call("floats", [-0]))).toBe(0);
    expect(call<number>("fSum", call("floats", [1, NaN, 2]))).toBeNaN();
    expect(call<number>("fProduct", call("floats", [-0]))).toBe(-0);
  });

  test("empty: the sum is zero and the product one, on every collection", () => {
    expect(call<number>("vSum", call("ints", []))).toBe(0);
    expect(call<number>("vProduct", call("ints", []))).toBe(1);
    expect(call<number>("sSum", call("intSet", []))).toBe(0);
    expect(call<number>("sProduct", call("intSet", []))).toBe(1);
    expect(call<number>("qSum", call("intSeq", []))).toBe(0);
    expect(call<number>("qProduct", call("intSeq", []))).toBe(1);
    expect(call<number>("fSum", call("floats", []))).toBe(0);
    expect(call<number>("fProduct", call("floats", []))).toBe(1);
  });

  test("Int totals on each collection", () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: -1000, max: 1000 }), { maxLength: 100 }), (values) => {
      const total = values.reduce((a, b) => a + b, 0);
      expect(call<number>("vSum", call("ints", values))).toBe(total);
      expect(call<number>("qSum", call("intSeq", values))).toBe(total);
      expect(call<number>("sSum", call("intSet", values))).toBe([...new Set(values)].reduce((a, b) => a + b, 0));
    }), { numRuns: 100 });
    expect(call<number>("vProduct", call("ints", [2, 3, 7]))).toBe(42);
    expect(call<number>("sProduct", call("intSet", [2, 3, 3, 7]))).toBe(42);
  });
});

describe("through the Seq seats (Collections Part 5 §3.4)", () => {
  test("a range, a set and a vector at a Seq parameter", () => {
    expect(main.rangeSum).toBe(5050);
    expect(main.rangeProduct).toBe(3628800);
    expect(call("setMaxThroughSeq", call("intSet", [7, 2, 9]))).toEqual(some(9));
    expect(call("setMaxThroughSeq", call("intSet", []))).toEqual(NONE);
    expect(call<number>("vectorSumThroughSeq", call("ints", [1, 2, 3]))).toBe(6);
  });

  test("a long sequence runs in constant stack", () => {
    expect(main.longMax).toEqual(some(200000));
    expect(main.longMinBy).toEqual(some(200000));
  });

  test("a map's values total through its values sequence", () => {
    expect(call<number>("mapValuesSum", call("map", [[1, 10], [2, 20], [3, 5]]))).toBe(35);
  });
});

describe("a Map's forms take whole entries (§13.1)", () => {
  test("max and min are the entries with the greatest and least keys", () => {
    fc.assert(fc.property(pairs, (values) => {
      const m = call("map", values);
      const keys = [...new Map(values.map(([k, v]) => [k, v])).entries()].sort((a, b) => a[0] - b[0]);
      expect(call("mMax", m)).toEqual(keys.length === 0 ? NONE : some(keys.at(-1)));
      expect(call("mMin", m)).toEqual(keys.length === 0 ? NONE : some(keys[0]));
    }), { numRuns: 100 });
  });

  test("maxBy hands the key callback each entry as a pair", () => {
    const visits = call("map", [[1, 3], [2, 9], [3, 1]]);
    const seen: Pair[] = [];
    expect(call("mMaxBy", visits, (entry: Pair) => (seen.push(entry), entry[1]))).toEqual(some([2, 9]));
    expect([...seen].sort((a, b) => a[0] - b[0])).toEqual([[1, 3], [2, 9], [3, 1]]);
  });
});

describe("what a program can write (§13.1, §13.3)", () => {
  const world = 'extern from "./world.js"\n    export fun log(s: String) ->~ Unit\n';
  const diagnostics = (body: string): readonly string[] =>
    compileFiles([["/world.js", ""], ["/main.hex", "module Main\n\n" + world + body]])
      .diagnostics.map(({ message }) => message);

  test("a key that may fail needs `^`, and an impure comparator `~`", () => {
    expect(diagnostics('export let n: Option(String) = ["10", "9"].maxBy(Int.parse)\n'))
      .toEqual(["this call may fail, so `.maxBy` wants `^`, not no mark"]);
    expect(diagnostics('export let n: Option(String) = assume ["10", "9"].maxBy^(Int.parse)\n')).toEqual([]);
    expect(diagnostics(
      "export let go(): Option(Int) = Set.fromVector([2, 1]).minUsing((a, b) =>\n    log~(\"x\")\n    Ord.compare(a, b))\n",
    )).toEqual(["this call is impure, so `.minUsing` wants `~`, not no mark"]);
    expect(diagnostics(
      "export let go(): Option(Int) = Set.fromVector([2, 1]).minUsing~((a, b) =>\n    log~(\"x\")\n    Ord.compare(a, b))\n",
    )).toEqual([]);
    expect(diagnostics("export let n: Option(Int) = [2, 1].max()\nexport let t: Int = (1..4).toSeq().sum()\n"))
      .toEqual([]);
  });

  test("two values take `Ord.max(a, b)` or, being a member, `a.max(b)`", () => {
    expect(diagnostics("export let n: Int = Ord.max(3, 4)\n")).toEqual([]);
    expect(diagnostics("export let n(a: Int, b: Int): Int = a.max(b)\n")).toEqual([]);
    expect(diagnostics("export let n(v: Vector(Int), b: Int): Option(Int) = v.max().map((a) => a.min(b))\n"))
      .toEqual([]);
  });

  test("a map has no sum: its values do", () => {
    const messages = diagnostics("export let n(m: Map(Int, Int)): Int = m.sum()\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`sum`");
    expect(diagnostics("export let n(m: Map(Int, Int)): Int = m.values().sum()\n")).toEqual([]);
  });

  test("max needs an `Ord` instance, and Map and Set have none", () => {
    const messages = diagnostics("export let n(v: Vector(Set(Int))): Option(Set(Int)) = v.max()\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Ord");
  });
});

describe("editions (§13.5)", () => {
  const compiled = () => compileMain("module Main\n\n" + [
    "export let a: Int = Vector.sum([1, 2])",
    "export let b: Option(Float) = Set.fromVector([1.5]).max()",
    "export let c: Option(Int) = Seq.min(1..3)",
    "export let d: Option((Int, String)) = Map.fromVector([(1, \"a\")]).maxBy(((key, _)) => key)",
    "export let e: Option((Int, Float)) = Map.fromVector([(1, 2.5)]).max()",
    "",
  ].join("\n"));

  test("the collection forms publish their fundamental editions, and a caller calls one", () => {
    const project = compiled();
    const text = (path: string) => project.modules.find(({ source }) => source.path === path)!.javascript.text;
    for (const path of ["/Hex/Vector.hex", "/Hex/Set.hex", "/Hex/Seq.hex"]) {
      for (const name of ["max", "min", "maxBy", "minBy", "sum", "product"]) {
        for (const type of ["Int", "Nat", "Float", "BigInt"]) {
          expect(text(path)).toContain(`function ${name}${type}(`);
        }
      }
    }
    for (const name of ["maxBy", "minBy"]) {
      for (const type of ["Int", "Nat", "Float", "BigInt"]) expect(text("/Hex/Map.hex")).toContain(`function ${name}${type}(`);
    }
    // `Map.max` and `Map.min` bind two variables, so they publish no editions
    // (Zero-Cost Fundamental Exports §3.2 step 1), and a call at fundamental
    // types reaches the one copy it uses (§8.3).
    expect(text("/Hex/Map.hex")).not.toMatch(/function m(?:ax|in)(?:Nat|Int|Float|BigInt|Bool|String|Unit)+\(/u);
    expect([...text("/Hex/Map.hex").matchAll(/^function (__m(?:ax|in)_\w+)\(/gmu)].map((match) => match[1]))
      .toEqual(["__max_IntFloat"]);
    const consumer = text("/main.hex");
    for (const edition of ["sumInt(", "maxFloat(", "minInt(", "maxByInt(", "__max_IntFloat("]) {
      expect(consumer).toContain(edition);
    }
  });

  test("Ord.max and Ord.min have no editions: a call goes through the instance", () => {
    const project = compileMain("module Main\n\nexport let n: Int = Ord.max(3, 4)\n");
    const ord = project.modules.find(({ source }) => source.path === "/Hex/Ord.hex")!.javascript.text;
    for (const type of ["Int", "Nat", "Float", "BigInt", "Bool", "Unit"]) {
      expect(ord).not.toContain(`max${type}`);
      expect(ord).not.toContain(`min${type}`);
    }
    const consumer = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(consumer).toMatch(/__Ord_Int_max(?: as max)?\b/u);
    expect(consumer).toMatch(/= (?:__Ord_Int_max|max)\(3, 4\)/u);
  });
});
