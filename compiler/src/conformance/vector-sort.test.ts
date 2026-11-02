import fc from "fast-check";
import { beforeAll, describe, expect, test } from "vitest";

import { compileFiles, runMain } from "../support/test-project.js";

/**
 * Sorting on `Vector` (`spec/collection-combinators.md` §12): `sort`, `sortBy`
 * and `sortUsing`, each stable and each answering a new vector. `sortBy` calls
 * its key once per element, in index order; `sortUsing`'s comparator is called
 * on pairs of the input's elements in an unspecified order, and one that is not
 * a total order still gets back a permutation (§12.3).
 *
 * The oracle is JavaScript's own stable sort over an array of the same
 * elements. Callbacks are JavaScript functions handed to exported Hexagon
 * functions, so a test can log the calls it receives, and an `Ordering` handed
 * back from JavaScript is the tagged object the language represents it as.
 */

const SOURCE = `module Main

export let vec(values: Array(Int)): Vector(Int) = Array.toVector(values)

// The same elements built by prepending, so the trie's origin is not zero.
export let prepended(values: Array(Int)): Vector(Int) =
    let forward = Array.toVector(values)
    var result: Vector(Int) = []
    var index = forward.length()
    while index >= 1
        result := result.prepend(forward[index])
        index := index - 1
    result

export let pairs(values: Array((Int, Int))): Vector((Int, Int)) = Array.toVector(values)
export let floats(values: Array(Float)): Vector(Float) = Array.toVector(values)
export let strings(values: Array(String)): Vector(String) = Array.toVector(values)
export let nullables(values: Array(Nullable(Int))): Vector(Nullable(Int)) = Array.toVector(values)

export let vSort(values: Vector(Int)): Vector(Int) = values.sort()
export let pSort(values: Vector((Int, Int))): Vector((Int, Int)) = values.sort()
export let fSort(values: Vector(Float)): Vector(Float) = values.sort()
export let sSort(values: Vector(String)): Vector(String) = values.sort()
export let uSort(values: Vector(Unit)): Vector(Unit) = values.sort()
export let units(count: Int): Vector(Unit) = Vector.fromSeq(Seq.map(1..count, (_) => ()))

export let vSortBy(values: Vector(Int), key: Int ->! Int): Vector(Int) = values.sortBy!(key)
export let pSortBy(values: Vector((Int, Int)), key: ((Int, Int)) ->! Int): Vector((Int, Int)) = values.sortBy!(key)
export let pSortByText(values: Vector((Int, Int)), key: ((Int, Int)) ->! String): Vector((Int, Int)) =
    values.sortBy!(key)
export let vSortUsing(values: Vector(Int), compare: (Int, Int) ->! Ordering): Vector(Int) =
    values.sortUsing!(compare)
export let pSortUsing(values: Vector((Int, Int)), compare: ((Int, Int), (Int, Int)) ->! Ordering): Vector((Int, Int)) =
    values.sortUsing!(compare)
export let nSortUsing(values: Vector(Nullable(Int)), compare: (Nullable(Int), Nullable(Int)) ->! Ordering): Vector(Nullable(Int)) =
    values.sortUsing!(compare)

// Descending, by swapping the comparator's arguments (§12.2).
export let descending(values: Vector(Int)): Vector(Int) = values.sortUsing((a, b) => Ord.compare(b, a))

// A comparator that sorts again (§12.5: each call has arrays of its own).
export let reentrant(values: Vector(Int)): Vector(Int) =
    values.sortUsing((a, b) => Ord.compare([a, 0].sort()[2], [b, 0].sort()[2]))
`;

type Ordering = { readonly tag: "Less" | "Equal" | "Greater" };
type Callback<A extends unknown[], R> = (...args: A) => R;

type Exports = {
  readonly vec: (values: readonly number[]) => unknown;
  readonly prepended: (values: readonly number[]) => unknown;
  readonly pairs: (values: readonly (readonly [number, number])[]) => unknown;
  readonly floats: (values: readonly number[]) => unknown;
  readonly strings: (values: readonly string[]) => unknown;
  readonly nullables: (values: readonly (number | null | undefined)[]) => unknown;
  readonly vSort: (values: unknown) => Iterable<number>;
  readonly pSort: (values: unknown) => Iterable<readonly [number, number]>;
  readonly fSort: (values: unknown) => Iterable<number>;
  readonly sSort: (values: unknown) => Iterable<string>;
  readonly uSort: (values: unknown) => Iterable<undefined>;
  readonly units: (count: number) => unknown;
  readonly vSortBy: (values: unknown, key: Callback<[number], number>) => Iterable<number>;
  readonly pSortBy: (values: unknown, key: Callback<[[number, number]], number>) => Iterable<[number, number]>;
  readonly pSortByText: (values: unknown, key: Callback<[[number, number]], string>) => Iterable<[number, number]>;
  readonly vSortUsing: (values: unknown, compare: Callback<[number, number], Ordering>) => Iterable<number>;
  readonly pSortUsing: (
    values: unknown,
    compare: Callback<[[number, number], [number, number]], Ordering>,
  ) => Iterable<[number, number]>;
  readonly nSortUsing: (
    values: unknown,
    compare: Callback<[number | null | undefined, number | null | undefined], Ordering>,
  ) => Iterable<number | null | undefined>;
  readonly descending: (values: unknown) => Iterable<number>;
  readonly reentrant: (values: unknown) => Iterable<number>;
};

let main: Exports;

beforeAll(async () => {
  main = (await runMain(SOURCE)) as unknown as Exports;
});

const LESS: Ordering = { tag: "Less" };
const EQUAL: Ordering = { tag: "Equal" };
const GREATER: Ordering = { tag: "Greater" };
const ordering = (difference: number): Ordering => difference < 0 ? LESS : difference > 0 ? GREATER : EQUAL;

/** The thrown value, or `undefined` when `run` returns. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (failure) {
    return failure;
  }
  return undefined;
}

// Up to 300 elements, so vectors cross several 32-element leaves, with keys
// drawn from a small range so equal keys are common and stability shows.
const ints = fc.array(fc.integer({ min: -50, max: 50 }), { maxLength: 300, size: "max" });
const keyed = fc.array(
  fc.tuple(fc.integer({ min: 0, max: 9 }), fc.integer({ min: -1000, max: 1000 })),
  { maxLength: 300, size: "max" },
);

describe("sort, sortBy and sortUsing order the elements, stably (§12.2)", () => {
  test("sort answers the elements least first, from either trie origin", () => {
    fc.assert(fc.property(ints, (values) => {
      const expected = [...values].sort((a, b) => a - b);
      expect([...main.vSort(main.vec(values))]).toEqual(expected);
      expect([...main.vSort(main.prepended(values))]).toEqual(expected);
    }), { numRuns: 200 });
  });

  test("sort answers a new vector and leaves the one it was given as it was", () => {
    const vector = main.vec([3, 1, 2]);
    expect([...main.vSort(vector)]).toEqual([1, 2, 3]);
    expect([...(vector as Iterable<number>)]).toEqual([3, 1, 2]);
  });

  test("the empty vector, one element, and past one leaf level", () => {
    expect([...main.vSort(main.vec([]))]).toEqual([]);
    expect([...main.vSort(main.vec([4]))]).toEqual([4]);
    const many = Array.from({ length: 2000 }, (_, index) => (index * 7919) % 2000);
    expect([...main.vSort(main.prepended(many))]).toEqual([...many].sort((a, b) => a - b));
  });

  test("elements that compare equal keep their order: sortBy and sortUsing", () => {
    fc.assert(fc.property(keyed, (values) => {
      const stable = [...values].sort((a, b) => a[0] - b[0]);
      expect([...main.pSortBy(main.pairs(values), ([key]) => key)]).toEqual(stable);
      expect([...main.pSortUsing(main.pairs(values), (a, b) => ordering(a[0] - b[0]))]).toEqual(stable);
    }), { numRuns: 200 });
  });

  test("sort over tuples orders by the first component, then the second", () => {
    fc.assert(fc.property(keyed, (values) => {
      const expected = [...values].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      expect([...main.pSort(main.pairs(values))]).toEqual(expected);
    }), { numRuns: 100 });
  });

  test("Float's total order: NaN last, and 0.0 and -0.0 equal, so they keep their order", () => {
    // The zeros are not a palindrome, so an order that reversed equal elements
    // would show.
    const sorted = [...main.fSort(main.floats([-0, NaN, 0, 1, -1, 0]))];
    expect(sorted.slice(0, 1)).toEqual([-1]);
    expect(sorted.slice(1, 4).map((zero) => Object.is(zero, -0))).toEqual([true, false, false]);
    expect(sorted[4]).toBe(1);
    expect(sorted[5]).toBeNaN();
  });

  test("String orders by code point, so an astral character follows every basic-plane one", () => {
    expect([...main.sSort(main.strings(["b", "\u{1F600}", "a", "￿", "ab"]))])
      .toEqual(["a", "ab", "b", "￿", "\u{1F600}"]);
  });

  test("Unit sorts, and every Unit element is undefined", () => {
    expect([...main.uSort(main.units(40))]).toEqual(Array(40).fill(undefined));
  });

  test("descending is a swapped comparator, and keeps equal elements in order", () => {
    expect([...main.descending(main.vec([2, 9, 4, 9, 1]))]).toEqual([9, 9, 4, 2, 1]);
    const ties = [[1, 0], [2, 1], [1, 2], [2, 3]] as const;
    expect([...main.pSortUsing(main.pairs(ties), (a, b) => ordering(b[0] - a[0]))])
      .toEqual([[2, 1], [2, 3], [1, 0], [1, 2]]);
  });
});

describe("the door sorts positions, never elements (§12.5)", () => {
  test("`undefined` is ordered by the comparator, not moved to the end", () => {
    // JavaScript's own sort puts `undefined` last without asking its
    // comparator, so a lowering that sorted the elements would answer
    // `[null, 1, 2, 3, undefined]` here.
    const rank = (value: number | null | undefined): number =>
      value === undefined ? -2 : value === null ? -1 : value;
    const asked: (number | null | undefined)[] = [];
    const sorted = [...main.nSortUsing(main.nullables([3, undefined, 1, null, 2, undefined]), (a, b) => {
      asked.push(a, b);
      return ordering(rank(a) - rank(b));
    })];
    expect(sorted).toEqual([undefined, undefined, null, 1, 2, 3]);
    expect(asked).toContain(undefined);
  });

  test("a comparator that sorts again gets a result of its own", () => {
    expect([...main.reentrant(main.vec([5, 1, 4, 1, 3]))]).toEqual([1, 1, 3, 4, 5]);
  });
});

describe("calls (§12.3)", () => {
  test("sortBy calls its key once per element, in index order", () => {
    fc.assert(fc.property(ints, (values) => {
      const seen: number[] = [];
      const sorted = [...main.vSortBy(main.vec(values), (x) => (seen.push(x), Math.abs(x)))];
      expect(seen).toEqual(values);
      expect(sorted).toEqual([...values].sort((a, b) => Math.abs(a) - Math.abs(b)));
    }), { numRuns: 200 });
  });

  test("sortBy orders by a String key under String's own order", () => {
    const values = [[1, 0], [2, 1], [3, 2]] as const;
    const names = ["b", "\u{1F600}", "￿"];
    expect([...main.pSortByText(main.pairs(values), ([, index]) => names[index]!)])
      .toEqual([[1, 0], [3, 2], [2, 1]]);
  });

  test("sortUsing calls its comparator only on elements of the input", () => {
    fc.assert(fc.property(ints, (values) => {
      const members = new Set(values);
      let calls = 0;
      const sorted = [...main.vSortUsing(main.vec(values), (a, b) => {
        calls += 1;
        expect(members.has(a) && members.has(b)).toBe(true);
        return ordering(a - b);
      })];
      expect(sorted).toEqual([...values].sort((a, b) => a - b));
      if (values.length < 2) expect(calls).toBe(0);
    }), { numRuns: 200 });
  });

  test("a comparator that is not a total order still gets back a permutation", () => {
    fc.assert(fc.property(ints, fc.integer(), (values, seed) => {
      let state = seed >>> 0;
      const sorted = [...main.vSortUsing(main.vec(values), () => {
        state = (state * 1103515245 + 12345) >>> 0;
        return [LESS, EQUAL, GREATER][state % 3]!;
      })];
      expect([...sorted].sort((a, b) => a - b)).toEqual([...values].sort((a, b) => a - b));
    }), { numRuns: 200 });
  });

  test("a failing comparator or key ends the call with its own failure", () => {
    const failure = new Error("stop");
    expect(thrown(() => main.vSortUsing(main.vec([3, 1, 2]), () => {
      throw failure;
    }))).toBe(failure);
    const keys: number[] = [];
    expect(thrown(() => main.vSortBy(main.vec([3, 1, 2, 5]), (x) => {
      keys.push(x);
      if (x === 2) throw failure;
      return x;
    }))).toBe(failure);
    expect(keys).toEqual([3, 1, 2]);
  });
});

describe("effects: the call follows the callback's colour (§2, §12.3)", () => {
  const world = 'extern from "./world.js"\n    export fun log(s: String) ->~ Unit\n';
  const diagnostics = (body: string): readonly string[] =>
    compileFiles([["/world.js", ""], ["/main.hex", "module Main\n\n" + world + body]])
      .diagnostics.map(({ message }) => message);

  test("a key that may fail needs `^`, and gets it", () => {
    expect(diagnostics('export let n: Vector(String) = ["10", "9"].sortBy(Int.parse)\n'))
      .toEqual(["this call may fail, so `.sortBy` wants `^`, not no mark"]);
    expect(diagnostics('export let n: Vector(String) = assume ["10", "9"].sortBy^(Int.parse)\n')).toEqual([]);
  });

  test("an impure comparator needs `~`, and a pure one no mark", () => {
    expect(diagnostics(
      "export let go(): Vector(Int) = [2, 1].sortUsing((a, b) =>\n    log~(\"x\")\n    Ord.compare(a, b))\n",
    )).toEqual(["this call is impure, so `.sortUsing` wants `~`, not no mark"]);
    expect(diagnostics(
      "export let go(): Vector(Int) = [2, 1].sortUsing~((a, b) =>\n    log~(\"x\")\n    Ord.compare(a, b))\n",
    )).toEqual([]);
    expect(diagnostics("export let n: Vector(Int) = [2, 1].sort()\n")).toEqual([]);
  });

  test("sort needs an `Ord` instance, and Map and Set have none", () => {
    const messages = diagnostics("export let n(m: Vector(Map(Int, Int))): Vector(Map(Int, Int)) = m.sort()\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Ord");
  });
});
