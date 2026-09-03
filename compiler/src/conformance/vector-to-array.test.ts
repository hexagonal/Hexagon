import { beforeAll, describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for **`Vector.toArray`** — FFI Part 2 §9's outbound conversion,
 * shipped through the intrinsic door per §9.1's obligations (issue #238).
 *
 * §9 gives the operation four words and §6.2 gives it a fifth, and every one of
 * them is a claim about a *running* program rather than about a type:
 *
 * - **eager** — the array is built before the call returns, so it is a real
 *   array with a length, not a view that computes on demand;
 * - **fresh** — a new JavaScript array every call, never the trie's own storage
 *   and never a cached one;
 * - **shallow** (Part 1 §5.1) — the crossing changes the collection named by the
 *   operation and nothing inside it: `Vector(Vector(Int))` gives
 *   `Array(Vector(Int))`, whose elements are the very same vector values;
 * - **total** — no failure mode; the empty vector gives `[]`;
 * - **stable while exclusively held** (§6.2) — a fresh array's stability
 *   obligation is nobody's until foreign code aliases it, so writing to the
 *   result can never reach back into the vector.
 *
 * A type-level assertion separates none of these. An implementation that cached
 * one array per vector, or handed back a view onto shared storage, would satisfy
 * every equality test here and fail the identity and write ones; one that
 * returned a lazy iterable would satisfy the element tests and fail the array
 * ones. So the tests run compiled code and ask the answers.
 *
 * §9.1 obligation 4 — partial shipping is excluded — is why the whole contract
 * is pinned in one file rather than a spelling here and a behaviour later. The
 * `.d.ts` row (`ReadonlyArray<a>`, Part 1 §4.1) is `array-readonly-face.test.ts`'s
 * in general; the one composition this operation adds — the row in a *result*
 * position produced by Hexagon rather than accepted from an extern — is pinned
 * below, through the real `tsc`.
 *
 * §9's inbound crossing, `Array.toVector`, has since shipped through the same
 * door; its contract is `array-to-vector.test.ts`'s, and the round trip between
 * the two is pinned there. The remaining pair (`Array.toSeq`/`fromSeq`) is still
 * absent, and `array-borrowed-view.test.ts` still pins it as absent.
 */

/**
 * The one compiled program the runtime tests drive.
 *
 * The vectors are *built* rather than written out, because the contract has to
 * hold across the representation's own shapes: a small vector lives entirely in
 * the trie's fixed-width tail, a vector of thousands spans tail and spine at two
 * heights, appending and prepending reach those through different paths
 * (`vector-trie.test.ts`'s `buildTo`/`buildDown` split), and a window, a `set`
 * and a `++` each leave the spine in a shape an index walk would get wrong.
 */
const PROGRAM = "// The two spellings Modules section 5.5 leaves for a two-homed name,\n" +
  "// over one door row.\n" +
  "export let convert(values: Vector(Int)): Array(Int) = Vector.toArray(values)\n" +
  "\n" +
  "export let convertDot(values: Vector(Int)): Array(Int) = values.toArray()\n" +
  "\n" +
  "// The empty vector, converted where it is written: `Array(a)` has no Hexagon\n" +
  "// literal, so emptiness has to be asked of the answer rather than supplied.\n" +
  "export let ofNothing(): Array(Int) = Vector.toArray([])\n" +
  "\n" +
  "// `[1, ..., count]` grown from the back — the tail-then-spine path.\n" +
  "export let appended(count: Int): Vector(Int) =\n" +
  "    var built: Vector(Int) = []\n" +
  "    for index in 1..count\n" +
  "        built := Vector.append(built, index)\n" +
  "    built\n" +
  "\n" +
  "// The same elements grown from the front, so the origin path runs instead.\n" +
  "export let prepended(count: Int): Vector(Int) =\n" +
  "    var built: Vector(Int) = []\n" +
  "    for index in 1..count\n" +
  "        built := Vector.prepend(built, count - index + 1)\n" +
  "    built\n" +
  "\n" +
  "// A window over a built vector: a slice is a vector whose elements start\n" +
  "// somewhere other than the spine's origin, which is exactly the shape an\n" +
  "// order-losing walk gets wrong.\n" +
  "export let window(values: Vector(Int), lo: Int, hi: Int): Vector(Int) =\n" +
  "    values[lo..hi]\n" +
  "\n" +
  "// The other three shapes a spine can be left in. `++` joins two vectors\n" +
  "// whose own shapes differ; `set` rewrites a path through the spine without\n" +
  "// moving its ends; `fromSeq` rebuilds the whole thing from a traversal.\n" +
  "export let joined(left: Vector(Int), right: Vector(Int)): Vector(Int) = left ++ right\n" +
  "\n" +
  "export let replaced(values: Vector(Int), index: Int, value: Int): Vector(Int) =\n" +
  "    Vector.set(values, index, value)\n" +
  "\n" +
  "export let roundTripped(values: Vector(Int)): Vector(Int) =\n" +
  "    Vector.fromSeq(values.toSeq())\n" +
  "\n" +
  "// The shallow case. The elements are vectors going in and vectors coming out.\n" +
  "export let nested(): Vector(Vector(Int)) = [[1, 2], [3], []]\n" +
  "\n" +
  "export let convertNested(values: Vector(Vector(Int))): Array(Vector(Int)) =\n" +
  "    Vector.toArray(values)\n" +
  "\n" +
  "// Reading a vector back without naming its representation, so a test can ask\n" +
  "// whether a write to the returned array was seen on this side.\n" +
  "export let size(values: Vector(Int)): Int = Vector.length(values)\n" +
  "\n" +
  "export let elementAt(values: Vector(Int), index: Int): Int = values[index]\n";

let exports_: Record<string, unknown>;

function convert(values: unknown): unknown {
  return (exports_["convert"] as (values: unknown) => unknown)(values);
}

function convertDot(values: unknown): unknown {
  return (exports_["convertDot"] as (values: unknown) => unknown)(values);
}

function appended(count: number): unknown {
  return (exports_["appended"] as (count: number) => unknown)(count);
}

function prepended(count: number): unknown {
  return (exports_["prepended"] as (count: number) => unknown)(count);
}

function window_(values: unknown, lo: number, hi: number): unknown {
  return (exports_["window"] as (values: unknown, lo: number, hi: number) => unknown)(
    values,
    lo,
    hi,
  );
}

function joined(left: unknown, right: unknown): unknown {
  return (exports_["joined"] as (left: unknown, right: unknown) => unknown)(left, right);
}

function replaced(values: unknown, index: number, value: number): unknown {
  return (exports_["replaced"] as (values: unknown, index: number, value: number) => unknown)(
    values,
    index,
    value,
  );
}

function roundTripped(values: unknown): unknown {
  return (exports_["roundTripped"] as (values: unknown) => unknown)(values);
}

function size(values: unknown): number {
  return (exports_["size"] as (values: unknown) => number)(values);
}

function elementAt(values: unknown, index: number): number {
  return (exports_["elementAt"] as (values: unknown, index: number) => number)(values, index);
}

/** `[1, 2, …, count]`, the elements every builder here produces. */
function counting(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

beforeAll(async () => {
  exports_ = await runMain(PROGRAM);
});

describe("eager: the answer is a real JavaScript array (§9)", () => {
  /**
   * `Array.isArray` is the whole of "eager" that a single call can show: a lazy
   * view, a `Seq`, or a bare iterable would carry the same elements and fail
   * here. The length is read *without* iterating, which is the other half —
   * an array knows its size, a traversal does not.
   */
  test("`Array.isArray` holds, and the length is there to read", () => {
    const result = convert(appended(3));
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
  });

  test("the elements are in order", () => {
    expect(convert(appended(5))).toEqual([1, 2, 3, 4, 5]);
  });

  /**
   * And it is not a one-shot traversal wearing an array's face: reading the
   * whole thing twice gives the same elements twice. A lazy adapter that
   * memoized nothing would empty on the second pass.
   */
  test("a second full read gives the same elements", () => {
    const result = convert(appended(4)) as readonly number[];
    expect([...result]).toEqual([1, 2, 3, 4]);
    expect([...result]).toEqual([1, 2, 3, 4]);
  });

  /**
   * The array is dense and ordinary — every index is an own property. A holey
   * or array-like result would pass `toEqual` on some engines and fail this.
   */
  test("the result is dense: every index is an own property", () => {
    const result = convert(appended(3)) as readonly number[];
    expect(Object.keys(result)).toEqual(["0", "1", "2"]);
    expect(Object.getPrototypeOf(result)).toBe(Array.prototype);
  });
});

describe("order survives every shape the representation takes", () => {
  /**
   * A vector of 3 is tail-only; 1,000 and 5,000 span the tail and the spine at
   * two different heights. The assertion is the exact element sequence rather
   * than a length or a sum, because a walk that visits the right leaves in the
   * wrong order gets both of those right.
   */
  test.each([1, 3, 32, 33, 1_000, 5_000])(
    "a vector of %i grown by `append` converts in order",
    (count) => {
      expect(convert(appended(count))).toEqual(counting(count));
    },
  );

  /**
   * The same elements reached the other way. `prepend` grows the origin end, so
   * the spine's window does not start where a naive index walk assumes.
   */
  test.each([1, 3, 32, 33, 1_000, 5_000])(
    "a vector of %i grown by `prepend` converts in order",
    (count) => {
      expect(convert(prepended(count))).toEqual(counting(count));
    },
  );

  /**
   * A slice is the sharpest of the three: its elements sit at a non-zero origin
   * inside a spine built for a larger vector, so a lowering that walked the
   * storage rather than the value would answer with the wrong window.
   */
  test("a slice converts to its own window, not the vector it was cut from", () => {
    expect(convert(window_(appended(1_000), 401, 410)))
      .toEqual([401, 402, 403, 404, 405, 406, 407, 408, 409, 410]);
    expect(convert(window_(prepended(1_000), 1, 3))).toEqual([1, 2, 3]);
    expect(convert(window_(appended(40), 33, 40))).toEqual([33, 34, 35, 36, 37, 38, 39, 40]);
  });

  /**
   * A window *of* a window, at an origin two rebases deep. The inner cut moves
   * the origin off zero; the outer one moves it again inside the already-shifted
   * range, so a walk that added the origins wrong — or added only one of them —
   * answers with a plausible run of the right length and the wrong values.
   */
  test("a window of a window keeps its own elements", () => {
    const inner = window_(appended(5_000), 1_001, 2_000);
    const outer = window_(inner, 501, 600);
    expect(convert(outer)).toEqual(
      Array.from({ length: 100 }, (_, index) => 1_501 + index),
    );
    expect(convert(window_(window_(prepended(2_000), 1_001, 1_100), 51, 55)))
      .toEqual([1_051, 1_052, 1_053, 1_054, 1_055]);
  });

  /**
   * `++` joins two vectors whose shapes need not match, and the join is where a
   * per-side walk shows: the four cases are spine + spine, tail + tail, and an
   * empty side each way. The empty cases matter twice over, because a
   * concatenation that answers with the non-empty side *unchanged* is correct,
   * and a conversion that then handed that side's storage back would not be.
   */
  test("a concatenation converts as one run", () => {
    expect(convert(joined(appended(1_000), appended(1_000))))
      .toEqual([...counting(1_000), ...counting(1_000)]);
    expect(convert(joined(appended(3), appended(4)))).toEqual([1, 2, 3, 1, 2, 3, 4]);
    expect(convert(joined(appended(0), appended(5)))).toEqual(counting(5));
    expect(convert(joined(appended(5), appended(0)))).toEqual(counting(5));
    expect(convert(joined(appended(0), appended(0)))).toEqual([]);
  });

  /**
   * `set` rewrites one path through the spine and leaves both ends where they
   * were, so the shape is a correct trie whose interior differs from any
   * built-by-append one at that height.
   */
  test("a `set` deep in the spine converts with the replacement in place", () => {
    const expected = counting(1_000).map((value) => (value === 500 ? -1 : value));
    expect(convert(replaced(appended(1_000), 500, -1))).toEqual(expected);
    expect(convert(replaced(prepended(1_000), 500, -1))).toEqual(expected);
    expect(convert(replaced(appended(3), 2, -1))).toEqual([1, -1, 3]);
  });

  /**
   * And the whole thing rebuilt from a traversal: `fromSeq` over the vector's
   * own `Iterable` row produces a fresh trie whose elements must convert to the
   * sequence that built it.
   */
  test("a `fromSeq` round-trip converts to the same elements", () => {
    expect(convert(roundTripped(appended(1_000)))).toEqual(counting(1_000));
    expect(convert(roundTripped(prepended(33)))).toEqual(counting(33));
    expect(convert(roundTripped(window_(appended(1_000), 401, 410))))
      .toEqual([401, 402, 403, 404, 405, 406, 407, 408, 409, 410]);
    expect(convert(roundTripped(appended(0)))).toEqual([]);
  });
});

describe("fresh: a new array every call, and never the vector's own storage (§9, §6.2)", () => {
  /**
   * Two calls, two objects. A cached result would be `===` here — and would
   * then let one caller's write reach another's.
   */
  test("two calls on the same vector give distinct arrays", () => {
    const values = appended(3);
    const first = convert(values);
    const second = convert(values);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  /**
   * **What the write tests are for.** They are *not* aimed at a lowering that
   * hands the trie's tail back: a `TrieVector`'s tail is a fixed 32-wide `Node`
   * (`runtime/VectorTrie.hex`), not a right-sized array, so returning it fails
   * on length and on the empty slots long before any write. The lowerings these
   * kill are the ones whose *values* are already right — a cached result reused
   * across calls, or a `slice`-style view onto shared storage. The vector is
   * persistent, so a `push` here must be invisible both to it and to the next
   * caller, and only writing through the result asks that question.
   */
  test("pushing to the result leaves the vector's length and elements alone", () => {
    const values = appended(3);
    const result = convert(values) as number[];
    result.push(99);
    expect(result).toHaveLength(4);
    expect(size(values)).toBe(3);
    expect(elementAt(values, 1)).toBe(1);
    expect(elementAt(values, 3)).toBe(3);
    expect(convert(values)).toEqual([1, 2, 3]);
  });

  /** The same at an index assignment, and against a spine-sized vector. */
  test("assigning into the result reaches neither the vector nor a later call", () => {
    const values = appended(1_000);
    const result = convert(values) as number[];
    result[0] = -1;
    result[999] = -1;
    expect(elementAt(values, 1)).toBe(1);
    expect(elementAt(values, 1_000)).toBe(1_000);
    expect(convert(values)).toEqual(counting(1_000));
  });

  /** Truncating the result is likewise the result's business alone. */
  test("truncating the result does not shorten the vector", () => {
    const values = appended(100);
    const result = convert(values) as number[];
    result.length = 0;
    expect(result).toHaveLength(0);
    expect(size(values)).toBe(100);
    expect(convert(values)).toHaveLength(100);
  });
});

describe("shallow: the crossing changes one collection (§9, Part 1 §5.1)", () => {
  /**
   * `Vector(Vector(Int))` gives `Array(Vector(Int))` — never `Array(Array(Int))`.
   * Identity is the assertion, because a recursive conversion would produce
   * arrays that are *equal* to the vectors' contents and are not the vectors.
   */
  test("elements are the same vector values, by identity", () => {
    const nested = (exports_["nested"] as () => unknown)();
    const inner = convert(nested) as readonly unknown[];
    const result = (exports_["convertNested"] as (values: unknown) => readonly unknown[])(nested);
    expect(result).toHaveLength(3);
    result.forEach((element, index) => {
      expect(element).toBe(inner[index]);
      expect(Array.isArray(element)).toBe(false);
    });
  });

  /**
   * And the elements still answer as vectors on the Hexagon side — the strongest
   * statement of "unchanged" available: they go back through `Vector.length`.
   */
  test("an element read back through `Vector.length` is still a vector", () => {
    const nested = (exports_["nested"] as () => unknown)();
    const result = (exports_["convertNested"] as (values: unknown) => readonly unknown[])(nested);
    expect(result.map((element) => size(element))).toEqual([2, 1, 0]);
  });

  /**
   * The outer conversion is fresh even when the elements are shared: rearranging
   * the array cannot rearrange the vector.
   */
  test("the outer array is fresh even though the elements are shared", () => {
    const nested = (exports_["nested"] as () => unknown)();
    const first = (exports_["convertNested"] as (values: unknown) => unknown[])(nested);
    const second = (exports_["convertNested"] as (values: unknown) => unknown[])(nested);
    expect(first).not.toBe(second);
    first.reverse();
    expect(second.map((element) => size(element))).toEqual([2, 1, 0]);
  });
});

describe("total: there is no failure mode (§9)", () => {
  /** The empty vector gives `[]` — an array, not `undefined` and not a throw. */
  test("the empty vector gives an empty array", () => {
    const result = (exports_["ofNothing"] as () => unknown)();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  /** And an emptied one, reached by conversion of a built value, agrees. */
  test("a vector built to zero elements gives an empty array too", () => {
    expect(convert(appended(0))).toEqual([]);
    expect(convert(prepended(0))).toEqual([]);
  });

  /** Two empty conversions are still two arrays, so neither caller shares. */
  test("even the empty answer is fresh", () => {
    const first = (exports_["ofNothing"] as () => unknown)();
    const second = (exports_["ofNothing"] as () => unknown)();
    expect(first).not.toBe(second);
  });
});

describe("both spellings reach the same door row (Modules §5.5)", () => {
  test("the qualified form and the dot call compile", () => {
    expect(projectDiagnostics(
      "export let a(v: Vector(Int)): Array(Int) = Vector.toArray(v)\n",
    )).toEqual([]);
    expect(projectDiagnostics(
      "export let b(v: Vector(Int)): Array(Int) = v.toArray()\n",
    )).toEqual([]);
  });

  test("and they run to the same answer", () => {
    const values = appended(4);
    expect(convertDot(values)).toEqual([1, 2, 3, 4]);
    expect(convertDot(values)).toEqual(convert(values));
    expect(convertDot(values)).not.toBe(convert(values));
  });

  /**
   * **The vocabulary cost, pinned.** `toArray` was single-homed on `JsValue`;
   * shipping it on `Vector` makes it two-homed, and §5.5 refuses the bare
   * spelling of a name more than one prelude module exports. No *new* bare name
   * is occupied — the bare call was already refused — but the message now names
   * three routes where it named two, and that is the whole of the change a user
   * can see.
   */
  test("the bare call is refused, naming the dot form and both exporters", () => {
    expect(projectDiagnostics("export let c(v: Vector(Int)): Array(Int) = toArray(v)\n"))
      .toEqual([
        "no bare `toArray`; write `v.toArray()`, `Vector.toArray(v)`, or `JsValue.toArray(v)`",
      ]);
  });

  /** `JsValue`'s row is untouched: its own qualified spelling still resolves. */
  test("`JsValue.toArray` still means `JsValue`'s", () => {
    expect(projectDiagnostics(
      "export let d(v: JsValue): Result(Array(JsValue), JsConversionError) = JsValue.toArray(v)\n",
    )).toEqual([]);
  });
});

describe("the `.d.ts` face is the `Array(a)` row (Part 1 §4.1, §9.1 obligation 3)", () => {
  const FACE = "export let f(v: Vector(Int)): Array(Int) = Vector.toArray(v)\n";

  /**
   * **The row's own face, in the prelude's `Vector.d.ts`.** This is the surface
   * a TypeScript consumer imports — `import { toArray } from ".../Vector.js"` —
   * and it is generic, so the monomorphic pin below cannot catch a regression in
   * it. The doc comment travels with it: a manual-voice `(** … *)` becomes the
   * JSDoc block a consumer's editor shows, and a declaration that lost it would
   * still typecheck.
   */
  test("the prelude's `Vector.d.ts` carries the generic row and its doc", () => {
    const compiled = compileMain(FACE);
    expect(compiled.diagnostics).toEqual([]);
    const vector = compiled.modules.find(({ source }) => source.path.endsWith("/Vector.hex"));
    expect(vector).toBeDefined();
    expect(vector!.declarations.text).toContain(
      "/**\n" +
        " * The elements of `values` as a fresh JavaScript array, in order. The\n" +
        " * array is built at once and is a new one every call, so writing to it\n" +
        " * changes nothing here; the crossing is shallow, so an element that is\n" +
        " * itself a vector arrives as that same vector. The empty vector gives an\n" +
        " * empty array.\n" +
        " */\n" +
        "export declare function toArray<a>(values: Hex.Vector<a>): ReadonlyArray<a>;",
    );
  });

  test("the result position renders `ReadonlyArray<number>`", () => {
    const compiled = compileMain(FACE);
    expect(compiled.diagnostics).toEqual([]);
    const main = compiled.modules.find(({ source }) => source.path === "/main.hex");
    expect(main!.declarations.text).toContain(
      "export declare const f: (v: Hex.Vector<number>) => ReadonlyArray<number>;",
    );
    expect(main!.declarations.text).not.toMatch(/(?<!Readonly)Array</u);
  });

  /**
   * And `tsc`'s opinion of it, over the whole declaration set — a pinned
   * spelling inside an invalid file is worth nothing (#132). The consumer takes
   * the produced array, reads it, and is refused when it writes: this is the one
   * position where the readonly row governs a value *Hexagon* made rather than
   * one it borrowed, and the face is the same either way.
   */
  test("a TypeScript consumer reads the produced array and cannot write to it", async () => {
    const compiled = compileMain(FACE);
    expect(compiled.diagnostics).toEqual([]);
    const files: Record<string, string> = {};
    for (const module of compiled.modules) {
      files[module.source.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts")] =
        module.declarations.text;
    }
    if (compiled.runtimeDeclarations !== undefined) {
      files["hex.d.ts"] = compiled.runtimeDeclarations.text;
    }
    expect(await typeScriptErrors({
      ...files,
      "consumer.ts": 'import { f } from "./main.js";\n' +
        "declare const v: import(\"./hex.js\").Vector<number>;\n" +
        "const out = f(v);\n" +
        "export const total: number = out.reduce((a, b) => a + b, 0);\n" +
        "export const spread: number[] = [...out];\n" +
        "// @ts-expect-error the produced array faces TypeScript as readonly\n" +
        "out.push(1);\n",
    })).toEqual([]);
  });
});
