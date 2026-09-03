import { beforeAll, describe, expect, test } from "vitest";

import { PRELUDE_MODULES } from "../prelude.js";
import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for **`Array.toVector`** — FFI Part 2 §9's inbound conversion. It
 * is the second of §9's quartet to ship, following `Vector.toArray` (#238,
 * PR #798), whose file this one is modelled on.
 *
 * It ships as **ordinary Hexagon in `stdlib/Array.hex`**, not through the
 * intrinsic door, and the two are not arbitrary alternatives:
 * `stdlib-roadmap.md` §5.1 authors library behaviour in Hexagon whenever Hexagon
 * expresses it at equivalent complexity with acceptable generated code, and
 * admits a private intrinsic only for a host capability, an opaque or
 * performance-critical representation, a compiler transformation, or measured
 * performance evidence. None reaches a `for` over the borrow folding `append`.
 * The asymmetry with `Vector.toArray` — which *is* keyed — is §6.1's: an
 * `Array(a)` has no Hexagon producer, so the outbound body could not name its
 * result, while the inbound one has both a traversal (§8.1's `Iterable` row) and
 * a producer (`Vector`'s `append`, reached by the dot as stdlib source spells
 * it). The last `describe` here pins the premises that shape rests on.
 *
 * §9 gives the operation three words, §6.4 gives it a fourth obligation, and the
 * whole point of the row is a fifth that no other conversion carries:
 *
 * - **eager** — the vector is built before the call returns, not on first read;
 * - **a stable persistent snapshot**, which §9 calls *the explicit escape from
 *   the borrow*: the result is an ordinary Hexagon value with no foreign
 *   stability dependency, so §6.2's contract stops applying to it and a later
 *   `push`, index write, or truncation on the source array reaches nothing;
 * - **shallow** (Part 1 §5.1) — the crossing changes the collection named by the
 *   operation and nothing inside it: `Array(Vector(Int))` gives
 *   `Vector(Vector(Int))` holding the very same vector values, and an array of
 *   records gives a vector of those same records;
 * - **total** — no failure mode; the empty array gives the empty vector;
 * - **sparse-tolerant** (§6.4) — an `Array(Nullable(a))` admits holes, a hole
 *   observes as `Nullable.undefined` with no presence distinction, so a sparse
 *   array converts to a vector of the array's `length` whose hole positions hold
 *   `undefined`, exactly as `for...of` observes them.
 *
 * No type-level assertion separates any of these. An implementation that kept a
 * lazy view onto the borrowed array would satisfy every element test here and
 * fail the snapshot ones; one that converted recursively would satisfy the
 * lengths and fail the identity ones. So the tests run compiled code and ask
 * the answers.
 *
 * **What they deliberately do not separate.** A body that walked
 * `1..Array.length(values)` reading through the bracket passes every pin in this
 * file, and that is correct rather than a hole in the suite: the bracket's
 * lowering bounds-checks and then reads natively, so a hole yields `undefined`
 * exactly as `for...of` reports one, and the two traversals are observationally
 * the same operation. (An earlier form of this comment claimed the index walk
 * would fail §6.4. It does not — measured, not reasoned.) What §6.4's pins do
 * separate is a traversal that treats a hole as *absence* — one that skips it,
 * or normalises it to `null` — which is the mistake §6.4 exists to forbid.
 * Which of the two conformant walks is emitted is pinned separately, at the end,
 * because §8.2's native `for...of` is a premise of the §5.1 argument for
 * shipping this in source at all.
 *
 * §9.1 obligation 4 — partial shipping is excluded — is why the whole contract
 * is pinned in one file. The `.d.ts` row (`ReadonlyArray<a>` in an *argument*
 * position, Part 1 §4.1) is `array-readonly-face.test.ts`'s in general; the row's
 * own generic face in the emitted `Array.d.ts`, and the monomorphic composition
 * with `Hex.Vector<a>` in the result, are pinned below through the real `tsc`.
 *
 * The rest of §9's quartet (`Array.toSeq`/`Array.fromSeq`) is still absent, and
 * `array-borrowed-view.test.ts` still pins it as absent.
 */

/**
 * The one compiled program the runtime tests drive.
 *
 * Every borrowed array arrives as a *parameter*, which is the only honest shape:
 * `Array(a)` has no Hexagon literal and no producer (§6.1), so the arrays under
 * test are written on the JavaScript side and handed across. The readers below
 * are all `Vector` operations, because "the result is a genuine vector" is a
 * claim about what the value answers, not about what it holds.
 */
const PROGRAM = "// The two spellings Modules section 5.5 leaves a prelude function,\n" +
  "// over one exported body.\n" +
  "export let convert(values: Array(Int)): Vector(Int) = Array.toVector(values)\n" +
  "\n" +
  "export let convertDot(values: Array(Int)): Vector(Int) = values.toVector()\n" +
  "\n" +
  "// The vector surface the result has to answer to. A lazy view over the borrow\n" +
  "// would carry the same elements and fail these.\n" +
  "export let size(values: Vector(Int)): Int = Vector.length(values)\n" +
  "\n" +
  "export let elementAt(values: Vector(Int), index: Int): Int = values[index]\n" +
  "\n" +
  "export let vacant(values: Vector(Int)): Bool = Vector.isEmpty(values)\n" +
  "\n" +
  "// `first` and `last` reach the trie's two ends, which is where a conversion\n" +
  "// that built the spine backwards or off by one shows. `-1` stands for `None`,\n" +
  "// so a test reads an `Int` rather than `Option`'s representation.\n" +
  "export let firstOf(values: Vector(Int)): Int = match Vector.first(values)\n" +
  "    None => -1\n" +
  "    Some(value) => value\n" +
  "\n" +
  "export let lastOf(values: Vector(Int)): Int = match Vector.last(values)\n" +
  "    None => -1\n" +
  "    Some(value) => value\n" +
  "\n" +
  "// The iteration order, summed positionally: a walk that visited the right\n" +
  "// elements in the wrong order gets a plain sum right and this wrong.\n" +
  "export let weighted(values: Vector(Int)): Int =\n" +
  "    var total = 0\n" +
  "    var position = 1\n" +
  "    for value in values\n" +
  "        total := total + position * value\n" +
  "        position := position + 1\n" +
  "    total\n" +
  "\n" +
  "// The way back out, for the round trip and for reading a converted vector's\n" +
  "// elements without naming the trie.\n" +
  "export let back(values: Vector(Int)): Array(Int) = Vector.toArray(values)\n" +
  "\n" +
  "// The shallow case, twice: elements that are themselves vectors, and elements\n" +
  "// that are records. Both come back out through `Vector.toArray` so a test can\n" +
  "// compare identities on the JavaScript side.\n" +
  "export let convertNested(values: Array(Vector(Int))): Vector(Vector(Int)) =\n" +
  "    Array.toVector(values)\n" +
  "\n" +
  "export let backNested(values: Vector(Vector(Int))): Array(Vector(Int)) =\n" +
  "    Vector.toArray(values)\n" +
  "\n" +
  "export record Boxed = { label: String }\n" +
  "\n" +
  "export let convertBoxed(values: Array(Boxed)): Vector(Boxed) = Array.toVector(values)\n" +
  "\n" +
  "export let backBoxed(values: Vector(Boxed)): Array(Boxed) = Vector.toArray(values)\n" +
  "\n" +
  "// Section 6.4's holes. `Nullable(Int)` is the element type that admits them,\n" +
  "// and the bracket read hands the raw representation straight back to\n" +
  "// JavaScript, so a hole arrives at the test as the `undefined` it is.\n" +
  "export let convertHoley(values: Array(Nullable(Int))): Vector(Nullable(Int)) =\n" +
  "    Array.toVector(values)\n" +
  "\n" +
  "export let sizeHoley(values: Vector(Nullable(Int))): Int = Vector.length(values)\n" +
  "\n" +
  "export let holeyAt(values: Vector(Nullable(Int)), index: Int): Nullable(Int) =\n" +
  "    values[index]\n" +
  "\n" +
  "// A vector built on this side, so the round trip has a source that never was\n" +
  "// an array.\n" +
  "export let built(count: Int): Vector(Int) =\n" +
  "    var values: Vector(Int) = []\n" +
  "    for index in 1..count\n" +
  "        values := Vector.append(values, index)\n" +
  "    values\n";

let exports_: Record<string, unknown>;

function convert(values: readonly unknown[]): unknown {
  return (exports_["convert"] as (values: readonly unknown[]) => unknown)(values);
}

function convertDot(values: readonly unknown[]): unknown {
  return (exports_["convertDot"] as (values: readonly unknown[]) => unknown)(values);
}

function size(values: unknown): number {
  return (exports_["size"] as (values: unknown) => number)(values);
}

function elementAt(values: unknown, index: number): number {
  return (exports_["elementAt"] as (values: unknown, index: number) => number)(values, index);
}

function back(values: unknown): readonly number[] {
  return (exports_["back"] as (values: unknown) => readonly number[])(values);
}

function built(count: number): unknown {
  return (exports_["built"] as (count: number) => unknown)(count);
}

/**
 * `[1, 2, …, count]`, a fresh array each call. It is deliberately *mutable*:
 * §6.2's stability contract is a promise foreign code makes, and the tests that
 * matter most here are the ones that break it after the conversion has run.
 */
function counting(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

/** `1*x1 + 2*x2 + …`, the positional sum `weighted` computes on the Hexagon side. */
function weightedSum(values: readonly number[]): number {
  return values.reduce((total, value, index) => total + (index + 1) * value, 0);
}

beforeAll(async () => {
  exports_ = await runMain(PROGRAM);
});

describe("eager: the answer is a genuine vector, built at the call (§9)", () => {
  /**
   * The four questions only a vector answers. A lazy view over the borrowed
   * array, or the array itself handed back under a different type, would carry
   * the same elements and fail `Vector.length` — which reads the trie's own size
   * field, not a JavaScript `.length`.
   */
  test("the result answers `Vector.length`, the bracket, `first` and `last`", () => {
    const values = convert([10, 20, 30]);
    expect(size(values)).toBe(3);
    expect(elementAt(values, 1)).toBe(10);
    expect(elementAt(values, 3)).toBe(30);
    expect((exports_["firstOf"] as (v: unknown) => number)(values)).toBe(10);
    expect((exports_["lastOf"] as (v: unknown) => number)(values)).toBe(30);
  });

  /**
   * And it is not the borrowed array wearing a vector's type: an `Array(a)` is
   * the JavaScript array by identity (§6.1's zero-copy clause), so a lowering
   * that did nothing would return the very object the test passed in.
   */
  test("the result is not the source array", () => {
    const source = [1, 2, 3];
    const values = convert(source);
    expect(values).not.toBe(source);
    expect(Array.isArray(values)).toBe(false);
  });

  /**
   * Iteration order, asked positionally rather than by sum, across the shapes
   * the trie takes: 32 and 33 straddle the fixed-width tail, and 1 000 and 5 000
   * span the spine at two heights. `back` restates the same claim element by
   * element, so a walk that lost the order fails twice.
   */
  test.each([1, 3, 32, 33, 1_000, 5_000])(
    "an array of %i converts in order, spine and tail alike",
    (count) => {
      const source = counting(count);
      const values = convert(source);
      expect(size(values)).toBe(count);
      expect(back(values)).toEqual(source);
      expect((exports_["weighted"] as (v: unknown) => number)(values))
        .toBe(weightedSum(source));
    },
  );

  /**
   * Every position, read one at a time through the bracket rather than through a
   * traversal — the reader a wrongly built spine gets wrong at exactly one
   * height while a linear walk of the same trie still comes out right.
   */
  test("every index of a spine-sized vector reads back its own element", () => {
    const values = convert(counting(1_000));
    for (let index = 1; index <= 1_000; index += 1) {
      expect(elementAt(values, index)).toBe(index);
    }
  });
});

describe("the snapshot outlives the borrow (§9, §6.2)", () => {
  /**
   * **What §9 means by "the explicit escape".** §6.2 obliges foreign code to
   * keep a borrowed array's elements and length stable while Hexagon may
   * observe it; §6.5 then rules that live and snapshot iteration coincide
   * *under that contract*, and names this operation as the way out for a caller
   * who needs stability beyond it. So the assertion is the one thing the borrow
   * cannot promise: the source array is mutated after the call, and the vector
   * does not move.
   */
  test("appending to the source afterwards leaves the vector's length alone", () => {
    const source = [1, 2, 3];
    const values = convert(source);
    source.push(99);
    expect(source).toHaveLength(4);
    expect(size(values)).toBe(3);
    expect(back(values)).toEqual([1, 2, 3]);
  });

  /** An index write is the same claim at an element rather than at the length. */
  test("writing into the source afterwards leaves the elements alone", () => {
    const source = counting(1_000);
    const values = convert(source);
    source[0] = -1;
    source[999] = -1;
    expect(elementAt(values, 1)).toBe(1);
    expect(elementAt(values, 1_000)).toBe(1_000);
    expect(back(values)).toEqual(counting(1_000));
  });

  /**
   * And truncation, which is the sharpest of the three: `length = 0` empties the
   * array in place, so a result that shared the array's storage would go empty
   * with it — and would still pass every equality test above, because those all
   * read before the write.
   */
  test("emptying the source afterwards does not empty the vector", () => {
    const source = counting(100);
    const values = convert(source);
    source.length = 0;
    expect(source).toHaveLength(0);
    expect(size(values)).toBe(100);
    expect(back(values)).toEqual(counting(100));
  });

  /**
   * Two conversions of one array are two vectors. A cached result would be `===`
   * here; the vector is persistent, so nothing a caller can do would then reach
   * the other caller — but the caching itself is what the "snapshot" word rules
   * out, since the second snapshot must be of the array *as it is now*.
   */
  test("two conversions of the same array are two distinct vectors", () => {
    const source = [1, 2, 3];
    const first = convert(source);
    const second = convert(source);
    expect(first).not.toBe(second);
    expect(back(first)).toEqual(back(second));
  });

  /** And the second one sees the mutation the first one escaped. */
  test("a conversion after a mutation snapshots the new contents", () => {
    const source = [1, 2, 3];
    const before = convert(source);
    source.push(4);
    const after = convert(source);
    expect(back(before)).toEqual([1, 2, 3]);
    expect(back(after)).toEqual([1, 2, 3, 4]);
  });
});

describe("shallow: the crossing changes one collection (§9, Part 1 §5.1)", () => {
  /**
   * `Array(Vector(Int))` gives `Vector(Vector(Int))` — never
   * `Vector(Vector(Int))` rebuilt. Identity is the assertion, because a
   * recursive conversion would produce vectors *equal* to the elements and not
   * the elements.
   */
  test("vector elements are the same vector values, by identity", () => {
    const inner = [built(2), built(1), built(0)];
    const result = (exports_["convertNested"] as (values: readonly unknown[]) => unknown)(inner);
    const out = (exports_["backNested"] as (values: unknown) => readonly unknown[])(result);
    expect(out).toHaveLength(3);
    out.forEach((element, index) => {
      expect(element).toBe(inner[index]);
    });
  });

  /**
   * And the elements still answer as vectors on the Hexagon side, which is the
   * strongest available statement of "unchanged": they go back through
   * `Vector.length`.
   */
  test("an element read back through `Vector.length` is still a vector", () => {
    const inner = [built(2), built(1), built(0)];
    const result = (exports_["convertNested"] as (values: readonly unknown[]) => unknown)(inner);
    const out = (exports_["backNested"] as (values: unknown) => readonly unknown[])(result);
    expect(out.map((element) => size(element))).toEqual([2, 1, 0]);
  });

  /**
   * Records, the other element kind whose identity a caller can observe: the
   * objects the array held are the objects the vector holds.
   */
  test("record elements keep their identities", () => {
    const boxed = [{ label: "a" }, { label: "b" }];
    const result = (exports_["convertBoxed"] as (values: readonly unknown[]) => unknown)(boxed);
    const out = (exports_["backBoxed"] as (values: unknown) => readonly unknown[])(result);
    expect(out[0]).toBe(boxed[0]);
    expect(out[1]).toBe(boxed[1]);
  });

  /**
   * The outer snapshot is a snapshot even when the elements are shared: the
   * array can be rearranged afterwards, and the vector's order stands. That the
   * *elements* are shared is the shallow clause; that the *spine* is not is
   * §9's snapshot clause, and only both together are the contract.
   */
  test("the outer vector is a snapshot even though the elements are shared", () => {
    const boxed = [{ label: "a" }, { label: "b" }];
    const result = (exports_["convertBoxed"] as (values: readonly unknown[]) => unknown)(boxed);
    boxed.reverse();
    const out = (exports_["backBoxed"] as (values: unknown) => readonly { label: string }[])(
      result,
    );
    expect(out.map(({ label }) => label)).toEqual(["a", "b"]);
  });
});

describe("total: there is no failure mode (§9)", () => {
  /** The empty array gives the empty vector — not `None`, not a throw. */
  test("the empty array gives the empty vector", () => {
    const values = convert([]);
    expect((exports_["vacant"] as (v: unknown) => boolean)(values)).toBe(true);
    expect(size(values)).toBe(0);
    expect(back(values)).toEqual([]);
  });

  /**
   * And the empty answer is still a vector rather than a shared sentinel the
   * caller could tell apart: it answers `first` and `last` with `None`, which
   * `-1` stands for here.
   */
  test("the empty vector answers `first` and `last` with nothing", () => {
    const values = convert([]);
    expect((exports_["firstOf"] as (v: unknown) => number)(values)).toBe(-1);
    expect((exports_["lastOf"] as (v: unknown) => number)(values)).toBe(-1);
  });

  /** An emptied source converts to the empty vector too, not to its old contents. */
  test("an array emptied before the call converts to the empty vector", () => {
    const source = [1, 2, 3];
    source.length = 0;
    expect(size(convert(source))).toBe(0);
  });
});

describe("sparse arrays: a hole observes as `undefined` (§6.4)", () => {
  /**
   * **How this is asked, and why.** §6.4's own vocabulary is `Nullable.undefined`,
   * and Part 2 §2.3's inspection surface is not shipped — there is no
   * `stdlib/Nullable.hex` and no `Nullable.` member anywhere in the tree, so the
   * value cannot be *named* in Hexagon today. What can be done is what §6.4
   * actually claims: `Nullable(Int)` is the raw `Int | null | undefined`
   * representation (§2.1), so a bracket read of a `Vector(Nullable(Int))` hands
   * the representation straight back across the boundary, and the test asks
   * JavaScript whether what arrived is `undefined`. Issue **#786** tracks the
   * `Nullable` companion; when it ships, this is the pin to restate in its
   * vocabulary.
   */
  const holey = (source: readonly unknown[]): unknown =>
    (exports_["convertHoley"] as (values: readonly unknown[]) => unknown)(source);

  const holeyAt = (values: unknown, index: number): unknown =>
    (exports_["holeyAt"] as (values: unknown, index: number) => unknown)(values, index);

  const sizeHoley = (values: unknown): number =>
    (exports_["sizeHoley"] as (values: unknown) => number)(values);

  /**
   * The array's `length` — not its count of present elements — is the vector's
   * length. A conversion that skipped holes would give a vector of 2 here, and
   * every element test would still pass.
   */
  test("a sparse array converts to a vector of the array's `length`", () => {
    // eslint-disable-next-line no-sparse-arrays -- §6.4's subject is the hole itself
    const source = [1, , 3] as readonly unknown[];
    // The source really is sparse: three slots, two own properties.
    expect(source).toHaveLength(3);
    expect(Object.keys(source)).toEqual(["0", "2"]);
    expect(sizeHoley(holey(source))).toBe(3);
  });

  /** And the hole position holds `undefined`, exactly as `for...of` reports it. */
  test("the hole position holds `undefined`, and its neighbours hold their values", () => {
    // eslint-disable-next-line no-sparse-arrays -- §6.4's subject is the hole itself
    const values = holey([1, , 3]);
    expect(holeyAt(values, 1)).toBe(1);
    expect(holeyAt(values, 2)).toBeUndefined();
    expect(holeyAt(values, 3)).toBe(3);
  });

  /**
   * **No presence distinction (§6.4).** A stored `undefined` and a hole are the
   * same observation, so the two arrays must convert to indistinguishable
   * vectors — which is the clause that rules out any `has`-style refinement
   * sneaking in through the conversion.
   */
  test("a stored `undefined` is indistinguishable from a hole", () => {
    // eslint-disable-next-line no-sparse-arrays -- §6.4's subject is the hole itself
    const fromHole = holey([1, , 3]);
    const fromStored = holey([1, undefined, 3]);
    expect(sizeHoley(fromHole)).toBe(sizeHoley(fromStored));
    for (let index = 1; index <= 3; index += 1) {
      expect(holeyAt(fromHole, index)).toBe(holeyAt(fromStored, index));
    }
  });

  /** Holes at both ends, and a wholly absent run, come out the same way. */
  test("leading, trailing and consecutive holes all arrive as `undefined`", () => {
    // eslint-disable-next-line no-sparse-arrays -- §6.4's subject is the hole itself
    const edges = holey([, 2, ,]);
    expect(sizeHoley(edges)).toBe(3);
    expect(holeyAt(edges, 1)).toBeUndefined();
    expect(holeyAt(edges, 2)).toBe(2);
    expect(holeyAt(edges, 3)).toBeUndefined();
    const empty = holey(new Array<unknown>(4));
    expect(sizeHoley(empty)).toBe(4);
    for (let index = 1; index <= 4; index += 1) {
      expect(holeyAt(empty, index)).toBeUndefined();
    }
  });

  /** `null` is the other `Nullable` inhabitant, and it is not turned into a hole. */
  test("a stored `null` stays `null`", () => {
    const values = holey([null, 2]);
    expect(holeyAt(values, 1)).toBeNull();
    expect(holeyAt(values, 2)).toBe(2);
  });
});

describe("what makes the Hexagon body possible (`stdlib-roadmap.md` §5.1)", () => {
  /**
   * **These pin a premise, not a behaviour.** §5.1 sends an operation to source
   * whenever Hexagon expresses it at equivalent complexity, so the shipped shape
   * rests on two facts about the language rather than on anything the operation
   * does: `Array(a)` carries §8.1's provided `Iterable` row, so `for value in
   * xs` compiles over a borrowed array and emits §8.2's native `for...of`; and
   * `stdlib/Array.hex` is seated after `stdlib/Vector.hex` in the prelude order,
   * so `Vector.append` is in scope in the file where the body lives.
   *
   * Together they are the whole of why this is not a door row while
   * `Vector.toArray` is. If either stops holding, the body stops compiling and
   * the argument at `intrinsics.ts`'s `vectorToArray` paragraph needs rewriting;
   * this is where that shows, rather than in a puzzling failure elsewhere.
   */
  test("a borrowed array can be walked in Hexagon source", () => {
    expect(projectDiagnostics(
      "export let f(xs: Array(Int)): Int =\n" +
        "    var total = 0\n" +
        "    for value in xs\n" +
        "        total := total + value\n" +
        "    total\n",
    )).toEqual([]);
  });

  test("and the vector builder the body would need is in scope where it would live", () => {
    const order = PRELUDE_MODULES.map(({ basename }) => basename);
    expect(order.indexOf("Array.hex")).toBeGreaterThan(order.indexOf("Vector.hex"));
    expect(order).toContain("Vector.hex");
  });

  /**
   * **The third premise, and the one only emitted text can settle.** The two
   * above say the body *compiles*; §5.1 also asks that it produce acceptable
   * generated code, and the whole answer to that is §8.2's ruling that a `for`
   * over a borrowed array emits native `for...of`. Nothing else in this file
   * can see it: a lowering that materialised an index walk — reading `.length`
   * once and indexing per step — computes the same vector, holes included, and
   * passes all thirty-seven behavioural pins.
   *
   * So this reads the emitted `Array.hex` and asks for the loop by its text. It
   * is the pin the §5.1 argument actually rests on, and the one that fails if a
   * future emitter change quietly turns the door-free body into the very
   * open-coded walk the door was rejected for not needing.
   */
  test("the shipped body emits §8.2's native `for...of`", () => {
    const compiled = compileMain("export let f(xs: Array(Int)): Vector(Int) = Array.toVector(xs)\n");
    expect(compiled.diagnostics).toEqual([]);
    const array = compiled.modules.find(({ source }) => source.path.endsWith("/Array.hex"));
    expect(array).toBeDefined();
    expect(array!.javascript.text).toContain("for (const value of values)");
    // And no index walk beside it: the traversal reads no `.length` of its own
    // and offsets no index. (`length`'s own row is `__a => __a.length`, which is
    // the arrow above, not a loop.)
    const body = array!.javascript.text.slice(array!.javascript.text.indexOf("const toVector"));
    expect(body).not.toContain("values.length");
    expect(body).not.toContain("- 1]");
  });
});

describe("the round trip through §9's other shipped conversion", () => {
  /**
   * `Vector.toArray ∘ Array.toVector` is the identity on elements and on
   * nothing else: §9 makes `Vector.toArray` produce a *fresh* array, so the
   * result cannot be the array that went in — which is the same fact as the
   * snapshot clause, seen from the other end.
   */
  test("`Vector.toArray(Array.toVector(xs))` equals `xs`, in a different array", () => {
    const source = counting(1_000);
    const out = back(convert(source));
    expect(out).toEqual(source);
    expect(out).not.toBe(source);
    expect(back(convert([]))).toEqual([]);
  });

  /** And the other way round, starting from a vector this side built. */
  test("`Array.toVector(Vector.toArray(v))` equals `v`, element for element", () => {
    const values = built(1_000);
    const round = convert(back(values));
    expect(size(round)).toBe(size(values));
    expect(back(round)).toEqual(back(values));
    expect(round).not.toBe(values);
    expect(size(convert(back(built(0))))).toBe(0);
  });
});

describe("both spellings reach the same export (Modules §5.5)", () => {
  test("the qualified form and the dot call compile", () => {
    expect(projectDiagnostics(
      "export let a(xs: Array(Int)): Vector(Int) = Array.toVector(xs)\n",
    )).toEqual([]);
    expect(projectDiagnostics(
      "export let b(xs: Array(Int)): Vector(Int) = xs.toVector()\n",
    )).toEqual([]);
  });

  test("and they run to the same answer", () => {
    const source = [1, 2, 3, 4];
    expect(back(convertDot(source))).toEqual(source);
    expect(back(convertDot(source))).toEqual(back(convert(source)));
    expect(convertDot(source)).not.toBe(convert(source));
  });

  /*
   * **The vocabulary cost is pinned once, and not here.** `toVector` is a name
   * no prelude module exported before, so it is single-homed — and since #742
   * that buys no bare spelling at all: the prelude's function channel is closed
   * (Modules §5.5), so the bare call is refused and the message enumerates two
   * routes where a two-homed name would list three. That refusal is
   * `array-borrowed-view.test.ts`'s, in the `describe` block that holds this
   * module's whole bare-name ledger beside `length`'s and `get`'s, which is
   * where a reader comparing the spend will look. Pinning the same byte string
   * twice would only mean editing it twice.
   */
});

describe("the `.d.ts` face is `ReadonlyArray<a>` in, `Hex.Vector<a>` out", () => {
  const FACE = "export let f(xs: Array(Int)): Vector(Int) = Array.toVector(xs)\n";

  /**
   * **The row's own face, in the prelude's `Array.d.ts`.** This is the surface a
   * TypeScript consumer imports — `import { toVector } from ".../Array.js"` —
   * and it is generic, so the monomorphic pin below cannot catch a regression in
   * it. The doc comment travels with it: a manual-voice `(** … *)` becomes the
   * JSDoc block a consumer's editor shows, and a declaration that lost it would
   * still typecheck.
   */
  test("the prelude's `Array.d.ts` carries the generic row and its doc", () => {
    const compiled = compileMain(FACE);
    expect(compiled.diagnostics).toEqual([]);
    const array = compiled.modules.find(({ source }) => source.path.endsWith("/Array.hex"));
    expect(array).toBeDefined();
    expect(array!.declarations.text).toContain(
      "/**\n" +
        " * The elements of `values` collected into a vector: the snapshot that\n" +
        " * outlives the borrow, so later changes to the array never reach it. The\n" +
        " * vector is built at once, and the crossing is shallow — an element that is\n" +
        " * itself a vector or a record arrives as that same value.\n" +
        " */\n" +
        "export declare const toVector: <a>(values: ReadonlyArray<a>) => Hex.Vector<a>;",
    );
  });

  test("a user export renders the argument and result rows together", () => {
    const compiled = compileMain(FACE);
    expect(compiled.diagnostics).toEqual([]);
    const main = compiled.modules.find(({ source }) => source.path === "/main.hex");
    expect(main!.declarations.text).toContain(
      "export declare const f: (xs: ReadonlyArray<number>) => Hex.Vector<number>;",
    );
  });

  /**
   * And `tsc`'s opinion of it, over the whole declaration set — a pinned
   * spelling inside an invalid file is worth nothing (#132). The consumer hands
   * in a readonly array, is refused when it hands in something else, and gets
   * back a branded `Vector` it can iterate but cannot index as an array: this
   * row is the one place the borrowed face governs a value flowing *into*
   * Hexagon while the branded one governs what comes out.
   */
  test("a TypeScript consumer passes an array in and gets a branded vector out", async () => {
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
        "const out = f([1, 2, 3]);\n" +
        "export const elements: number[] = [...out];\n" +
        "// @ts-expect-error the argument is an array of numbers, not of strings\n" +
        'f(["a"]);\n' +
        "// @ts-expect-error the result is a branded vector, not an array\n" +
        "export const first: number = out[0];\n",
    })).toEqual([]);
  });

  /**
   * The prelude row is reachable by its own name from TypeScript too, which is
   * the whole of §9.1 obligation 3 for this operation: the face is generic, so a
   * consumer instantiates it at its own element type.
   */
  test("the prelude row typechecks when a consumer calls it directly", async () => {
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
    const arrayPath = compiled.modules
      .find(({ source }) => source.path.endsWith("/Array.hex"))!
      .source.path.replace(/^\//u, "").replace(/\.hex$/u, ".js");
    expect(await typeScriptErrors({
      ...files,
      "consumer.ts": `import { toVector } from "./${arrayPath}";\n` +
        'declare const labels: ReadonlyArray<string>;\n' +
        "export const v: import(\"./hex.js\").Vector<string> = toVector(labels);\n",
    })).toEqual([]);
  });
});
