import fc from "fast-check";
import { beforeAll, describe, expect, test } from "vitest";

import { compileFiles, runMain, runProject } from "../support/test-project.js";

/**
 * #1417: **the collection combinators** (`spec/collection-combinators.md`).
 * `Vector`, `Set` and `Map` gain `map`, `filter`, `fold`, `find`, `any` and
 * `all`, each meaning `Seq`'s function over the items, run at once, with a
 * callback of any colour (§1.1, §2); `Vector` adds `flatMap`, `contains`,
 * `indexOf`, `reverse`, `zip` and `indexed` (§3). `Map`'s callbacks take the
 * entry, and `Map.map` is entries in, entries out, throwing `DuplicateKeyFault`
 * on a repeated key (§5.1).
 *
 * The oracles are plain JavaScript over the same items: an array for a vector,
 * and for a set or map the collection's own traversal order, read back through
 * `Vector.fromSeq`, since that order is the one every walk must follow (§2;
 * Collections Part 4 §7.1). Callbacks are JavaScript functions handed to
 * exported Hexagon functions, so each test can log the calls it receives.
 */

const SOURCE = `module Main

export let vec(values: Array(Int)): Vector(Int) = Array.toVector(values)

-- The same elements built by prepending, so the trie's origin is not zero and
-- its leaves do not start at a multiple of 32.
export let prepended(values: Array(Int)): Vector(Int) =
    let forward = Array.toVector(values)
    var result: Vector(Int) = []
    var index = forward.length()
    while index >= 1
        result := result.prepend(forward[index])
        index := index - 1
    result

export let vMap(values: Vector(Int), f: Int ->! Int): Vector(Int) = values.map!(f)
export let vFilter(values: Vector(Int), f: Int ->! Bool): Vector(Int) = values.filter!(f)
export let vFlatMap(values: Vector(Int), f: Int ->! Vector(Int)): Vector(Int) = values.flatMap!(f)
export let vFold(values: Vector(Int), initial: Int, f: (Int, Int) ->! Int): Int = values.fold!(initial, f)
export let vFind(values: Vector(Int), f: Int ->! Bool): Option(Int) = values.find!(f)
export let vAny(values: Vector(Int), f: Int ->! Bool): Bool = values.any!(f)
export let vAll(values: Vector(Int), f: Int ->! Bool): Bool = values.all!(f)
export let vContains(values: Vector(Int), element: Int): Bool = values.contains(element)
export let vIndexOf(values: Vector(Int), element: Int): Option(Int) = values.indexOf(element)
export let vReverse(values: Vector(Int)): Vector(Int) = values.reverse()
export let vZip(left: Vector(Int), right: Vector(Int)): Vector((Int, Int)) = left.zip(right)
export let vIndexed(values: Vector(Int)): Vector((Int, Int)) = values.indexed()
export let vRows(rows: Array(Array(Int))): Vector(Vector(Int)) = Array.toVector(rows).map(Array.toVector)
export let vFlatten(rows: Vector(Vector(Int))): Vector(Int) = rows.flatten()
export let vFlattenQualified(rows: Vector(Vector(Int))): Vector(Int) = Vector.flatten(rows)

export let floatSet(values: Array(Float)): Set(Float) = Set.fromSeq(values)
export let sOrder(s: Set(Float)): Vector(Float) = Vector.fromSeq(s)
export let sMap(s: Set(Float), f: Float ->! Float): Set(Float) = s.map!(f)
export let sMapLaw(s: Set(Float), f: Float -> Float): Set(Float) = Set.fromSeq(Seq.map(s, f))
export let sFilter(s: Set(Float), f: Float ->! Bool): Set(Float) = s.filter!(f)
export let sFold(s: Set(Float), initial: Int, f: (Int, Float) ->! Int): Int = s.fold!(initial, f)
export let sFind(s: Set(Float), f: Float ->! Bool): Option(Float) = s.find!(f)
export let sAny(s: Set(Float), f: Float ->! Bool): Bool = s.any!(f)
export let sAll(s: Set(Float), f: Float ->! Bool): Bool = s.all!(f)
export let sEqual(left: Set(Float), right: Set(Float)): Bool = left == right
export let sSize(s: Set(Float)): Int = s.size()
export let sHas(s: Set(Float), element: Float): Bool = s.contains(element)

export let intMap(pairs: Array((Int, Int))): Map(Int, Int) = Map.fromSeq(pairs)
export let mOrder(m: Map(Int, Int)): Vector((Int, Int)) = Vector.fromSeq(m)
export let mMap(m: Map(Int, Int), f: ((Int, Int)) ->! (Int, Int)): Map(Int, Int) = m.map!(f)
export let mMapLaw(m: Map(Int, Int), f: ((Int, Int)) -> (Int, Int)): Map(Int, Int) = Map.fromSeq(Seq.map(m, f))
export let mFilter(m: Map(Int, Int), f: ((Int, Int)) ->! Bool): Map(Int, Int) = m.filter!(f)
export let mFold(m: Map(Int, Int), initial: Int, f: (Int, (Int, Int)) ->! Int): Int = m.fold!(initial, f)
export let mFind(m: Map(Int, Int), f: ((Int, Int)) ->! Bool): Option((Int, Int)) = m.find!(f)
export let mAny(m: Map(Int, Int), f: ((Int, Int)) ->! Bool): Bool = m.any!(f)
export let mAll(m: Map(Int, Int), f: ((Int, Int)) ->! Bool): Bool = m.all!(f)
export let mEqual(left: Map(Int, Int), right: Map(Int, Int)): Bool = left == right
export let mSize(m: Map(Int, Int)): Int = m.size()
export let mGet(m: Map(Int, Int), key: Int): Option(Int) = m.get(key)

export let stringMap(pairs: Array((String, Int))): Map(String, Int) = Map.fromSeq(pairs)
export let smOrder(m: Map(String, Int)): Vector((String, Int)) = Vector.fromSeq(m)
export let smMap(m: Map(String, Int), f: ((String, Int)) ->! (String, Int)): Map(String, Int) = m.map!(f)
export let smFilter(m: Map(String, Int), f: ((String, Int)) ->! Bool): Map(String, Int) = m.filter!(f)
export let smGet(m: Map(String, Int), key: String): Option(Int) = m.get(key)
export let smSize(m: Map(String, Int)): Int = m.size()

export let floatMap(pairs: Array((Float, Int))): Map(Float, Int) = Map.fromSeq(pairs)
export let fmMap(m: Map(Float, Int), f: ((Float, Int)) ->! (Float, Int)): Map(Float, Int) = m.map!(f)
export let fmFilter(m: Map(Float, Int), f: ((Float, Int)) ->! Bool): Map(Float, Int) = m.filter!(f)
export let fmKeys(m: Map(Float, Int)): Vector(Float) = Vector.fromSeq(m.keys())

-- A change of key type: an \`Int\` and its decimal \`String\` hash alike, so every
-- key keeps its slot although every key changes type.
export let shown(m: Map(Int, Int)): Map(String, Int) = m.map(((key, value)) => (show(key), value))
`;

type Option<T> = { readonly tag: "Some"; readonly value: T } | { readonly tag: "None" };
type Callback<A extends unknown[], R> = (...args: A) => R;

type Exports = {
  readonly vec: (values: readonly number[]) => Iterable<number>;
  readonly prepended: (values: readonly number[]) => Iterable<number>;
  readonly vMap: (values: unknown, f: Callback<[number], number>) => Iterable<number>;
  readonly vFilter: (values: unknown, f: Callback<[number], boolean>) => Iterable<number>;
  readonly vFlatMap: (values: unknown, f: Callback<[number], unknown>) => Iterable<number>;
  readonly vFold: (values: unknown, initial: number, f: Callback<[number, number], number>) => number;
  readonly vFind: (values: unknown, f: Callback<[number], boolean>) => Option<number>;
  readonly vAny: (values: unknown, f: Callback<[number], boolean>) => boolean;
  readonly vAll: (values: unknown, f: Callback<[number], boolean>) => boolean;
  readonly vContains: (values: unknown, element: number) => boolean;
  readonly vIndexOf: (values: unknown, element: number) => Option<number>;
  readonly vReverse: (values: unknown) => Iterable<number>;
  readonly vZip: (left: unknown, right: unknown) => Iterable<[number, number]>;
  readonly vIndexed: (values: unknown) => Iterable<[number, number]>;
  readonly vRows: (rows: readonly (readonly number[])[]) => unknown;
  readonly vFlatten: (rows: unknown) => Iterable<number>;
  readonly vFlattenQualified: (rows: unknown) => Iterable<number>;
  readonly floatSet: (values: readonly number[]) => unknown;
  readonly sOrder: (s: unknown) => Iterable<number>;
  readonly sMap: (s: unknown, f: Callback<[number], number>) => unknown;
  readonly sMapLaw: (s: unknown, f: Callback<[number], number>) => unknown;
  readonly sFilter: (s: unknown, f: Callback<[number], boolean>) => unknown;
  readonly sFold: (s: unknown, initial: number, f: Callback<[number, number], number>) => number;
  readonly sFind: (s: unknown, f: Callback<[number], boolean>) => Option<number>;
  readonly sAny: (s: unknown, f: Callback<[number], boolean>) => boolean;
  readonly sAll: (s: unknown, f: Callback<[number], boolean>) => boolean;
  readonly sEqual: (left: unknown, right: unknown) => boolean;
  readonly sSize: (s: unknown) => number;
  readonly sHas: (s: unknown, element: number) => boolean;
  readonly intMap: (pairs: readonly (readonly [number, number])[]) => unknown;
  readonly mOrder: (m: unknown) => Iterable<[number, number]>;
  readonly mMap: (m: unknown, f: Callback<[[number, number]], [number, number]>) => unknown;
  readonly mMapLaw: (m: unknown, f: Callback<[[number, number]], [number, number]>) => unknown;
  readonly mFilter: (m: unknown, f: Callback<[[number, number]], boolean>) => unknown;
  readonly mFold: (m: unknown, initial: number, f: Callback<[number, [number, number]], number>) => number;
  readonly mFind: (m: unknown, f: Callback<[[number, number]], boolean>) => Option<[number, number]>;
  readonly mAny: (m: unknown, f: Callback<[[number, number]], boolean>) => boolean;
  readonly mAll: (m: unknown, f: Callback<[[number, number]], boolean>) => boolean;
  readonly mEqual: (left: unknown, right: unknown) => boolean;
  readonly mSize: (m: unknown) => number;
  readonly mGet: (m: unknown, key: number) => Option<number>;
  readonly stringMap: (pairs: readonly (readonly [string, number])[]) => unknown;
  readonly smOrder: (m: unknown) => Iterable<[string, number]>;
  readonly smMap: (m: unknown, f: Callback<[[string, number]], [string, number]>) => unknown;
  readonly smFilter: (m: unknown, f: Callback<[[string, number]], boolean>) => unknown;
  readonly smGet: (m: unknown, key: string) => Option<number>;
  readonly smSize: (m: unknown) => number;
  readonly floatMap: (pairs: readonly (readonly [number, number])[]) => unknown;
  readonly fmMap: (m: unknown, f: Callback<[[number, number]], [number, number]>) => unknown;
  readonly fmFilter: (m: unknown, f: Callback<[[number, number]], boolean>) => unknown;
  readonly fmKeys: (m: unknown) => Iterable<number>;
  readonly shown: (m: unknown) => unknown;
};

let main: Exports;

beforeAll(async () => {
  main = (await runMain(SOURCE)) as unknown as Exports;
});

const some = <T>(value: T): Option<T> => ({ tag: "Some", value });
const none: Option<never> = { tag: "None" };
const optionOf = <T>(value: T | undefined): Option<T> => value === undefined ? none : some(value);

/** The thrown value, or `undefined` when `run` returns. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (failure) {
    return failure;
  }
  return undefined;
}

/** Whether `failure` is `Map.DuplicateKeyFault` as Exceptions §7.2 builds it. */
function isDuplicateKeyFault(failure: unknown): boolean {
  return failure instanceof Error &&
    failure.name === "DuplicateKeyFault" &&
    (failure as Error & { $hex?: unknown }).$hex === "Hex.Map";
}

// Up to 300 elements, so vectors cross several 32-element leaves and maps and
// sets reach a second trie level. `size: "max"`, because fast-check's default
// size draws about ten elements whatever `maxLength` says.
const ints = fc.array(fc.integer({ min: -50, max: 50 }), { maxLength: 300, size: "max" });
const smallInts = fc.array(fc.integer({ min: 0, max: 40 }), { maxLength: 300, size: "max" });

describe("Vector: each combinator means Seq's, run at once, in index order (§3)", () => {
  const shapes = (values: readonly number[]): readonly unknown[] => [main.vec(values), main.prepended(values)];

  test("map, filter and flatMap call once per element, in order, and build the result", () => {
    fc.assert(fc.property(ints, (values) => {
      for (const vector of shapes(values)) {
        expect([...main.vec(values)]).toEqual(values);
        expect([...(vector as Iterable<number>)]).toEqual(values);
        const mapped: number[] = [];
        expect([...main.vMap(vector, (x) => (mapped.push(x), x * 3 - 1))]).toEqual(values.map((x) => x * 3 - 1));
        expect(mapped).toEqual(values);
        const kept: number[] = [];
        expect([...main.vFilter(vector, (x) => (kept.push(x), x % 3 === 0))])
          .toEqual(values.filter((x) => x % 3 === 0));
        expect(kept).toEqual(values);
        const flat: number[] = [];
        expect([...main.vFlatMap(vector, (x) => (flat.push(x), main.vec(Array(Math.abs(x) % 3).fill(x))))])
          .toEqual(values.flatMap((x) => Array(Math.abs(x) % 3).fill(x)));
        expect(flat).toEqual(values);
      }
    }), { numRuns: 200 });
  });

  test("flatten joins the rows in order, bare, by the dot and qualified", () => {
    fc.assert(fc.property(fc.array(ints, { maxLength: 12 }), (rows) => {
      const vector = main.vRows(rows);
      expect([...main.vFlatten(vector)]).toEqual(rows.flat());
      expect([...main.vFlattenQualified(vector)]).toEqual(rows.flat());
    }), { numRuns: 150 });
  });

  test("fold combines left to right from `initial`", () => {
    fc.assert(fc.property(ints, (values) => {
      for (const vector of shapes(values)) {
        const seen: number[] = [];
        // Not commutative, so a wrong order shows.
        expect(main.vFold(vector, 7, (total, x) => (seen.push(x), (total * 31 + x) % 1000003)))
          .toBe(values.reduce((total, x) => (total * 31 + x) % 1000003, 7));
        expect(seen).toEqual(values);
      }
    }), { numRuns: 200 });
  });

  test("find, any and all stop at the first element that decides the answer", () => {
    fc.assert(fc.property(ints, fc.integer({ min: -50, max: 50 }), (values, pivot) => {
      for (const vector of shapes(values)) {
        const at = values.findIndex((x) => x > pivot);
        const decided = at < 0 ? values : values.slice(0, at + 1);
        let seen: number[] = [];
        expect(main.vFind(vector, (x) => (seen.push(x), x > pivot))).toEqual(optionOf(values.find((x) => x > pivot)));
        expect(seen).toEqual(decided);
        seen = [];
        expect(main.vAny(vector, (x) => (seen.push(x), x > pivot))).toBe(at >= 0);
        expect(seen).toEqual(decided);
        seen = [];
        expect(main.vAll(vector, (x) => (seen.push(x), x <= pivot))).toBe(at < 0);
        expect(seen).toEqual(decided);
      }
    }), { numRuns: 200 });
  });

  test("contains and indexOf answer the first equal element's 1-based position", () => {
    fc.assert(fc.property(ints, fc.integer({ min: -55, max: 55 }), (values, element) => {
      for (const vector of shapes(values)) {
        expect(main.vContains(vector, element)).toBe(values.includes(element));
        const at = values.indexOf(element);
        expect(main.vIndexOf(vector, element)).toEqual(at < 0 ? none : some(at + 1));
      }
    }), { numRuns: 200 });
  });

  test("reverse, zip and indexed", () => {
    fc.assert(fc.property(ints, ints, (left, right) => {
      for (const vector of shapes(left)) {
        expect([...main.vReverse(vector)]).toEqual([...left].reverse());
        expect([...main.vIndexed(vector)]).toEqual(left.map((x, at) => [at + 1, x]));
        const pairs = left.slice(0, Math.min(left.length, right.length)).map((x, at) => [x, right[at]]);
        // Every pairing of a zero and a nonzero origin, so the two vectors'
        // leaves are read in step where they are not aligned.
        for (const other of shapes(right)) {
          expect([...main.vZip(vector, other)]).toEqual(pairs);
        }
      }
    }), { numRuns: 150 });
  });

  test("past one leaf level: 2,000 elements, from either origin", () => {
    const values = Array.from({ length: 2000 }, (_, at) => (at * 7919) % 1009);
    for (const vector of shapes(values)) {
      expect([...main.vMap(vector, (x) => x + 1)]).toEqual(values.map((x) => x + 1));
      expect(main.vIndexOf(vector, values[1777]!)).toEqual(some(values.indexOf(values[1777]!) + 1));
      expect([...main.vReverse(vector)]).toEqual([...values].reverse());
      expect([...main.vZip(vector, main.prepended(values.slice(0, 1500)))])
        .toEqual(values.slice(0, 1500).map((x) => [x, x]));
      let calls = 0;
      expect(main.vFind(vector, (x) => (calls += 1, x === values[1500]))).toEqual(some(values[1500]));
      expect(calls).toBe(values.indexOf(values[1500]!) + 1);
    }
  });

  test("a failing callback ends the call with its own failure", () => {
    const failure = new Error("stop");
    let calls = 0;
    expect(thrown(() =>
      main.vMap(main.vec([1, 2, 3, 4]), (x) => {
        calls += 1;
        if (x === 2) throw failure;
        return x;
      })
    )).toBe(failure);
    expect(calls).toBe(2);
  });
});

describe("Set: each combinator means Seq's over the elements, in traversal order (§4)", () => {
  const floats = fc.array(
    fc.oneof(fc.integer({ min: -30, max: 30 }), fc.constantFrom(0, -0, 0.5, -0.5)),
    { maxLength: 300, size: "max" },
  );

  test("map is Set.fromSeq of Seq.map, visiting each element once in traversal order", () => {
    fc.assert(fc.property(floats, (values) => {
      const s = main.floatSet(values);
      const order = [...main.sOrder(s)];
      const image = (x: number): number => Math.trunc(x / 4);
      const seen: number[] = [];
      const mapped = main.sMap(s, (x) => (seen.push(x), image(x)));
      expect(seen).toEqual(order);
      expect(main.sEqual(mapped, main.sMapLaw(s, image))).toBe(true);
      expect(main.sSize(mapped)).toBe(new Set(order.map(image)).size);
    }), { numRuns: 200 });
  });

  test("of two equal images, map keeps the first produced in traversal order (§4, §1.3)", () => {
    for (let round = 0; round < 20; round += 1) {
      // `0.5 * 0` is `0` and `-0.5 * 0` is `-0`: one element, two representatives.
      const s = main.floatSet([0.5, -0.5, 3]);
      const produced: number[] = [];
      const mapped = main.sMap(s, (x) => {
        const result = x * 0;
        produced.push(result);
        return result;
      });
      expect(main.sSize(mapped)).toBe(1);
      const kept = [...main.sOrder(mapped)][0]!;
      expect(Object.is(kept, produced[0])).toBe(true);
    }
  });

  test("filter keeps the representatives the set holds, and hashes nothing again", () => {
    fc.assert(fc.property(floats, (values) => {
      const s = main.floatSet(values);
      const order = [...main.sOrder(s)];
      const seen: number[] = [];
      const kept = main.sFilter(s, (x) => (seen.push(x), x >= 0));
      expect(seen).toEqual(order);
      const expected = order.filter((x) => x >= 0);
      const keptOrder = [...main.sOrder(kept)];
      expect(main.sSize(kept)).toBe(expected.length);
      // Same elements, compared by identity so a zero's sign must survive.
      expect(new Set(keptOrder.map((x) => Object.is(x, -0) ? "-0" : String(x))))
        .toEqual(new Set(expected.map((x) => Object.is(x, -0) ? "-0" : String(x))));
      for (const x of expected) expect(main.sHas(kept, x)).toBe(true);
    }), { numRuns: 200 });
  });

  test("fold, find, any and all follow the traversal order and stop where decided", () => {
    fc.assert(fc.property(floats, fc.integer({ min: -30, max: 30 }), (values, pivot) => {
      const s = main.floatSet(values);
      const order = [...main.sOrder(s)];
      const folded: number[] = [];
      expect(main.sFold(s, 0, (count, x) => (folded.push(x), count + 1))).toBe(order.length);
      expect(folded).toEqual(order);
      const at = order.findIndex((x) => x > pivot);
      const decided = at < 0 ? order : order.slice(0, at + 1);
      let seen: number[] = [];
      expect(main.sFind(s, (x) => (seen.push(x), x > pivot))).toEqual(optionOf(order.find((x) => x > pivot)));
      expect(seen).toEqual(decided);
      seen = [];
      expect(main.sAny(s, (x) => (seen.push(x), x > pivot))).toBe(at >= 0);
      expect(seen).toEqual(decided);
      seen = [];
      expect(main.sAll(s, (x) => (seen.push(x), x <= pivot))).toBe(at < 0);
      expect(seen).toEqual(decided);
    }), { numRuns: 200 });
  });

  test("the empty set and a one-element set", () => {
    const empty = main.floatSet([]);
    expect(main.sSize(main.sMap(empty, (x) => x))).toBe(0);
    expect(main.sAll(empty, () => false)).toBe(true);
    expect(main.sAny(empty, () => true)).toBe(false);
    const sole = main.floatSet([-0]);
    expect(Object.is([...main.sOrder(main.sFilter(sole, () => true))][0], -0)).toBe(true);
    expect(main.sSize(main.sFilter(sole, () => false))).toBe(0);
    expect(main.sFind(sole, (x) => x === 0)).toEqual(some(-0));
  });
});

describe("Map: each combinator takes the entry and follows the traversal order (§5)", () => {
  const entries = fc.array(fc.tuple(fc.integer({ min: -200, max: 200 }), fc.integer()), {
    maxLength: 300,
    size: "max",
  });

  test("filter, fold, find, any and all over entries", () => {
    fc.assert(fc.property(entries, fc.integer({ min: -200, max: 200 }), (pairs, pivot) => {
      const m = main.intMap(pairs);
      const order = [...main.mOrder(m)];
      const seen: [number, number][] = [];
      const kept = main.mFilter(m, (entry) => (seen.push(entry), entry[0] % 2 === 0));
      expect(seen).toEqual(order);
      expect(new Map([...main.mOrder(kept)])).toEqual(new Map(order.filter(([key]) => key % 2 === 0)));
      expect(main.mSize(kept)).toBe(order.filter(([key]) => key % 2 === 0).length);

      const folded: [number, number][] = [];
      expect(main.mFold(m, 0, (count, entry) => (folded.push(entry), count + 1))).toBe(order.length);
      expect(folded).toEqual(order);

      const at = order.findIndex(([key]) => key > pivot);
      const decided = at < 0 ? order : order.slice(0, at + 1);
      let searched: [number, number][] = [];
      expect(main.mFind(m, (entry) => (searched.push(entry), entry[0] > pivot)))
        .toEqual(at < 0 ? none : some(order[at]));
      expect(searched).toEqual(decided);
      searched = [];
      expect(main.mAny(m, (entry) => (searched.push(entry), entry[0] > pivot))).toBe(at >= 0);
      expect(searched).toEqual(decided);
      searched = [];
      expect(main.mAll(m, (entry) => (searched.push(entry), entry[0] <= pivot))).toBe(at < 0);
      expect(searched).toEqual(decided);
    }), { numRuns: 200 });
  });

  /**
   * §5.1 against its law: where the returned keys are distinct, `Map.map` is
   * `Map.fromSeq(Seq.map(m, f))`; where two are equal, it throws, after every
   * callback has run. The transforms cover every way the shortcut can go: keys
   * kept, every key changed, some changed, and keys merged.
   */
  test("map is entries in, entries out, and refuses a repeated key", () => {
    const transforms: readonly ((entry: [number, number]) => [number, number])[] = [
      ([key, value]) => [key, value * 2],
      ([key, value]) => [key + 1000, value],
      ([key, value]) => [key % 7 === 0 ? key + 5000 : key, value + 1],
      ([key, value]) => [-key, value],
      ([key, value]) => [Math.trunc(key / 3), value],
      ([key, value]) => [key % 11 === 0 ? 0 : key, value],
    ];
    fc.assert(fc.property(entries, fc.integer({ min: 0, max: transforms.length - 1 }), (pairs, which) => {
      const transform = transforms[which]!;
      const m = main.intMap(pairs);
      const order = [...main.mOrder(m)];
      const returned = order.map(transform);
      const distinct = new Set(returned.map(([key]) => key)).size === returned.length;
      const seen: [number, number][] = [];
      const failure = thrown(() => main.mMap(m, (entry) => (seen.push(entry), transform(entry))));
      expect(seen).toEqual(order);
      if (distinct) {
        expect(failure).toBeUndefined();
        const mapped = main.mMap(m, transform);
        expect(new Map([...main.mOrder(mapped)])).toEqual(new Map(returned));
        expect(main.mSize(mapped)).toBe(returned.length);
        expect(main.mEqual(mapped, main.mMapLaw(m, transform))).toBe(true);
        for (const [key, value] of returned) expect(main.mGet(mapped, key)).toEqual(some(value));
      } else {
        expect(isDuplicateKeyFault(failure)).toBe(true);
      }
    }), { numRuns: 300 });
  });

  test("a failing callback pre-empts the fault, and the fault comes after every callback", () => {
    const m = main.intMap([[1, 1], [2, 2], [3, 3], [4, 4]]);
    let calls = 0;
    expect(isDuplicateKeyFault(thrown(() => main.mMap(m, ([, value]) => (calls += 1, [0, value])))))
      .toBe(true);
    expect(calls).toBe(4);
    const failure = new Error("stop");
    expect(thrown(() =>
      main.mMap(m, ([key, value]) => {
        if (key === [...main.mOrder(m)][2]![0]) throw failure;
        return [0, value];
      })
    )).toBe(failure);
  });

  test("each returned key is its own representative, and 0.0 and -0.0 are one key", () => {
    const m = main.floatMap([[0, 1], [1, 2], [2.5, 3]]);
    const negated = main.fmMap(m, ([key, value]) => [-key, value]);
    expect([...main.fmKeys(negated)].some((key) => Object.is(key, -0))).toBe(true);
    expect(new Set([...main.fmKeys(negated)])).toEqual(new Set([-0, -1, -2.5]));
    expect(isDuplicateKeyFault(thrown(() =>
      main.fmMap(main.floatMap([[0, 1], [3, 2]]), ([key, value]) => [key === 0 ? 0 : -0, value])
    ))).toBe(true);
    const kept = main.fmFilter(main.floatMap([[-0, 1], [4, 2]]), () => true);
    expect([...main.fmKeys(kept)].some((key) => Object.is(key, -0))).toBe(true);
  });

  test("a change of key type that keeps every hash still gives the right map", async () => {
    const m = main.intMap(Array.from({ length: 500 }, (_, at) => [at * 3, at]));
    const shown = main.shown(m);
    expect(main.smSize(shown)).toBe(500);
    for (let at = 0; at < 500; at += 1) expect(main.smGet(shown, String(at * 3))).toEqual(some(at));
    expect(main.smGet(shown, "1")).toEqual(none);
  });

  test("the empty map and a one-entry map", () => {
    const empty = main.intMap([]);
    expect(main.mSize(main.mMap(empty, (entry) => entry))).toBe(0);
    expect(main.mAll(empty, () => false)).toBe(true);
    const sole = main.intMap([[5, 50]]);
    expect([...main.mOrder(main.mMap(sole, ([key, value]) => [key + 1, value + 1]))]).toEqual([[6, 51]]);
    expect(main.mFind(sole, ([key]) => key === 5)).toEqual(some([5, 50]));
  });
});

/**
 * **Collision nodes.** `String`'s hash is Java's, so `"Aa"` and `"BB"` hash
 * alike, and so does every string spelled from those two blocks: these keys all
 * share one mixed hash and live in one collision node, where §7 says kept keys
 * are compared with each other under `Eq`.
 */
describe("Map over a collision node", () => {
  const blocks = (count: number): string[] => {
    let result = [""];
    for (let step = 0; step < count; step += 1) result = result.flatMap((stem) => [stem + "Aa", stem + "BB"]);
    return result;
  };
  const colliding = blocks(3);
  const pairs: [string, number][] = [...colliding.map((key, at): [string, number] => [key, at]), ["x", 100], ["y", 101]];

  test("the eight keys collide, and every walk sees them all", () => {
    const m = main.stringMap(pairs);
    expect(main.smSize(m)).toBe(10);
    const order = [...main.smOrder(m)];
    expect(new Map(order)).toEqual(new Map(pairs));
    const kept = main.smFilter(m, ([key]) => key.startsWith("Aa"));
    expect(new Map([...main.smOrder(kept)])).toEqual(new Map(pairs.filter(([key]) => key.startsWith("Aa"))));
    const sole = main.smFilter(m, ([key]) => key === colliding[3]);
    expect([...main.smOrder(sole)]).toEqual([[colliding[3], 3]]);
  });

  test("map keeps values-only changes in place, swaps keys within the node, and moves keys out", () => {
    const m = main.stringMap(pairs);
    const doubled = main.smMap(m, ([key, value]) => [key, value * 2]);
    expect(new Map([...main.smOrder(doubled)])).toEqual(new Map(pairs.map(([key, value]) => [key, value * 2])));
    // Each colliding key turned into another colliding key: same hash, so all
    // keep their slots, and none repeats.
    const swap = (key: string): string => key.replaceAll("Aa", "##").replaceAll("BB", "Aa").replaceAll("##", "BB");
    const swapped = main.smMap(m, ([key, value]) => [colliding.includes(key) ? swap(key) : key, value]);
    expect(new Map([...main.smOrder(swapped)]))
      .toEqual(new Map(pairs.map(([key, value]) => [colliding.includes(key) ? swap(key) : key, value])));
    // Half the colliding keys leave the node.
    const moved = main.smMap(m, ([key, value]) => [key.endsWith("BB") ? key + "!" : key, value]);
    expect(new Map([...main.smOrder(moved)]))
      .toEqual(new Map(pairs.map(([key, value]) => [key.endsWith("BB") ? key + "!" : key, value])));
    expect(main.smGet(moved, colliding[0]!)).toEqual(some(0));
  });

  test("a repeat between two kept keys in the node is found, and so is one with a moved key", () => {
    const m = main.stringMap(pairs);
    // Both stay in the node, under one hash, equal.
    expect(isDuplicateKeyFault(thrown(() =>
      main.smMap(m, ([key, value]) => [key === colliding[1] ? colliding[0]! : key, value])
    ))).toBe(true);
    // "x" leaves its slot for a colliding key that stayed in place.
    expect(isDuplicateKeyFault(thrown(() =>
      main.smMap(m, ([key, value]) => [key === "x" ? colliding[5]! : key, value])
    ))).toBe(true);
    // Two moved keys meeting each other.
    expect(isDuplicateKeyFault(thrown(() =>
      main.smMap(m, ([key, value]) => [key === "x" || key === "y" ? "z" : key, value])
    ))).toBe(true);
  });
});

/**
 * §7's costs, counted rather than timed: the runtime module's emitted `insert`
 * (one placement) and `placement` (one hash of a key) are wrapped with counters.
 * `Map.filter` and `Set.filter` hash nothing; `Map.map` places only the
 * returned keys that do not keep their original's slot.
 */
describe("costs: what filter and map place (§7)", () => {
  let counted: Exports;

  beforeAll(async () => {
    const probe = "globalThis.__combinatorProbe";
    counted = (await runProject(
      [["/main.hex", SOURCE]],
      {
        transform: (path, javascript) => {
          if (path !== "/Hex/Runtime/HashTrie.hex") return javascript;
          const insert = "function insert(tree, hash, key, value, shift, equal) {";
          const placement = "const placement = (key, __Hash_a) =>";
          expect(javascript.split(insert)).toHaveLength(2);
          expect(javascript.split(placement)).toHaveLength(2);
          return `${probe} = { insert: 0, placement: 0 };\n` +
            javascript
              .replace(insert, "function __probeInsert(tree, hash, key, value, shift, equal) {")
              .replace(placement, "const __probePlacement = (key, __Hash_a) =>") +
            "\nfunction insert(tree, hash, key, value, shift, equal) {\n" +
            // A placement starts at the root, shift 0; deeper calls are its
            // own recursion, not further placements.
            `  if (shift === 0) ${probe}.insert += 1;\n` +
            "  return __probeInsert(tree, hash, key, value, shift, equal);\n" +
            "}\n" +
            "const placement = (key, __Hash_a) => {\n" +
            `  ${probe}.placement += 1;\n` +
            "  return __probePlacement(key, __Hash_a);\n" +
            "};\n";
        },
      },
    )) as unknown as Exports;
  });

  const counts = (): { insert: number; placement: number } =>
    ({ ...(globalThis as unknown as { __combinatorProbe: { insert: number; placement: number } }).__combinatorProbe });
  const reset = (): void => {
    const probe = (globalThis as unknown as { __combinatorProbe: { insert: number; placement: number } })
      .__combinatorProbe;
    probe.insert = 0;
    probe.placement = 0;
  };
  const big = Array.from({ length: 3000 }, (_, at): [number, number] => [at * 7, at]);

  test("filter hashes no key and places nothing", () => {
    const m = counted.intMap(big);
    const s = counted.floatSet(big.map(([key]) => key));
    reset();
    counted.mFilter(m, ([key]) => key % 3 === 0);
    counted.sFilter(s, (x) => x % 3 === 0);
    expect(counts()).toEqual({ insert: 0, placement: 0 });
  });

  test("map with every key handed back places nothing, and hashes each returned key once", () => {
    const m = counted.intMap(big);
    reset();
    counted.mMap(m, ([key, value]) => [key, value + 1]);
    expect(counts()).toEqual({ insert: 0, placement: big.length });
  });

  test("map places each key that leaves its slot, and only those", () => {
    const m = counted.intMap(big);
    for (const changed of [1, 10, 300]) {
      reset();
      const mapped = counted.mMap(m, ([key, value]) => [key % 7 === 0 && key / 7 < changed ? -key - 1 : key, value]);
      expect(counts().insert).toBe(changed);
      expect(counted.mSize(mapped)).toBe(big.length);
    }
    reset();
    counted.mMap(m, ([key, value]) => [key + 1, value]);
    // Every key placed afresh: the first becomes the root, the rest are inserted.
    expect(counts().insert).toBe(big.length - 1);
  });
});

describe("effects: the call follows the callback's colour (§2)", () => {
  const world = 'extern from "./world.js"\n    export fun log(s: String) ->~ Unit\n';
  const diagnostics = (body: string): readonly string[] =>
    compileFiles([["/world.js", ""], ["/main.hex", "module Main\n\n" + world + body]])
      .diagnostics.map(({ message }) => message);

  test("a callback that may fail needs `^`, and gets it", () => {
    expect(diagnostics('export let parsed: Vector(Int) = ["1"].map(Int.parse)\n'))
      .toEqual(["this call may fail, so `.map` wants `^`, not no mark"]);
    expect(diagnostics('export let parsed: Option(Vector(Int)) = ["1"].map?(Int.parse)\n')).toEqual([]);
    expect(diagnostics(
      "export let parsed(m: Map(Int, String)): Map(Int, Int) =\n" +
        "    assume m.map^(((key, text)) => (key, Int.parse^(text)))\n",
    )).toEqual([]);
    expect(diagnostics(
      "export let parsed(s: Set(String)): Option(Set(Int)) = s.map?(Int.parse)\n",
    )).toEqual([]);
  });

  test("an impure callback needs `~`, and a pure one no mark", () => {
    expect(diagnostics('export let go(): Unit = ["a"].fold((), (_, s) => log~(s))\n'))
      .toEqual(["this call is impure, so `.fold` wants `~`, not no mark"]);
    expect(diagnostics('export let go(): Unit = ["a"].fold~((), (_, s) => log~(s))\n')).toEqual([]);
    expect(diagnostics("export let go(m: Map(Int, Int)): Bool = m.any~(((_, v)) =>\n    log~(\"x\")\n    v > 0)\n"))
      .toEqual([]);
    expect(diagnostics("export let n: Vector(Int) = [1].map((x) => x + 1)\n")).toEqual([]);
  });
});
