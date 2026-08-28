import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for `stdlib/Set.hex` — Collections Part 4's acceptance tests (§16)
 * turned into fixtures, plus the gaps the Set step closes (#373, #366).
 *
 * This is the results-side companion to `hash-trie-wiring.test.ts`, and the
 * sibling of `map-prelude-companion.test.ts`. Nothing here looks at emitted
 * JavaScript or at the representation: every assertion is one Part 4 states
 * about the *surface*, so the file would survive a change of backing — which is
 * the property that makes it worth having beside a wiring test that deliberately
 * would not. In particular nothing here knows that a `Set(a)` is a wrapper
 * record over a `HashTrie(a, Unit)`; that is the wiring file's business.
 *
 * ## What is deliberately not asserted
 *
 * **No traversal order.** A `Set` is a hash array mapped trie with seeded
 * placement (§7.1), so the order `toSeq`, `show` and `for x in` produce is
 * deterministic for one set value within one execution and is promised for
 * nothing else — not insertion, not sorted, not stable across runs. Every
 * assertion below is an order-independent aggregate, a comparison of one set
 * value against itself, or a `show` rendering read for its *contents* rather
 * than its sequence.
 *
 * **No complexity.** §2.2's bounds are expected-case and unobservable from a
 * program. What *is* observable, and is asserted, is that the two operations
 * §2.2 pins to the smaller side take both directions: `union` and `intersect`
 * dispatch on `size`, so each operand order runs different code, and an
 * assertion made in one order alone would leave the other path untested.
 */

/** Sorted elements of a constructor-shaped `show` rendering; see §8.3. */
function shownElements(rendering: string, prefix: string): readonly string[] {
  expect(rendering.startsWith(`${prefix}[`)).toBe(true);
  expect(rendering.endsWith("])")).toBe(true);
  return [...rendering.slice(prefix.length + 1, -2).matchAll(/\([^)]*\)|[^,\s][^,]*/gu)]
    .map((match) => match[0].trim())
    .sort();
}

describe("§16 (a) construction, generalization, and the absent `Hash`", () => {
  /**
   * §3.5: `Set.empty` is a polymorphic *constant*, not a call. The call spelling
   * every consumer used before this milestone is now what it looks like — an
   * attempt to call a value — and the constant generalizes, so one binding of it
   * serves two element types in one program.
   *
   * This is the call-spelling defect the Map step corrected for `Map` (#370),
   * corrected here for `Set`: the transitional core typed `empty` as a nullary
   * function, so `Set.empty()` compiled and `Set.empty` did not, which is the
   * exact inverse of what §3.5 says. It generalizes because the claim row is
   * verified covariant at this milestone (closure doc §5.3) and the relaxed
   * value restriction admits unconstrained, covariant-only variables.
   */
  test("`Set.empty` is a value, and generalizes", async () => {
    const main = await runMain(
      "let e = Set.empty\n" +
        "let byInt: Set(Int) = Set.add(e, 1)\n" +
        "let byText: Set(String) = Set.add(e, \"one\")\n" +
        "export let counted: (Int, Int, Int) = (Set.size(e), Set.size(byInt), Set.size(byText))\n",
    );
    expect(main["counted"]).toEqual([0, 1, 1]);
  });

  test("the call spelling is refused like any other non-function call", () => {
    // No bespoke message is owed and none is written: `Set.empty` is a value, so
    // calling it takes the ordinary not-callable report (#385), which names the
    // callee, the type it does have, and how many arguments the call supplied.
    // The variable numbers in the rendered type are not asserted — they move
    // with every unrelated change to the prelude. No arrow appears: the report's
    // subject is that there is no function here, so a demanded arrow's colour
    // would be a claim about a call that does not exist.
    const messages = projectDiagnostics("export let e: Set(Int) = Set.empty()\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`empty` is not a function — it has type `Set(");
    expect(messages[0]).toContain("and this call supplies no arguments");
    expect(messages[0]).not.toContain("->");
  });

  /**
   * §12.4, and the Set half of #366: `singleton` is **unconstrained, and
   * permanently so**. An element type with no `Hash` instance — and none
   * derivable, since this one has no `derives` clause — must still construct a
   * one-element set, because the element is held unplaced until a keyed
   * operation arrives.
   *
   * `Set.singleton` was absent from *both* passes before this step, which is
   * what #366 recorded; it exists now and takes the signature §12.4 fixes.
   */
  test("`Set.singleton` takes an element type with no `Hash` instance", async () => {
    const main = await runMain(
      "record Weird = {s: String}\n" +
        "let odd: Set(Weird) = Set.singleton(Weird({s = \"K\"}))\n" +
        "export let counted: Int = Set.size(odd)\n" +
        "export let blank: Bool = Set.isEmpty(odd)\n" +
        "let lengths(total: Int, element: Weird): Int = total + 1\n" +
        "export let walked: Int = Seq.fold(Set.toSeq(odd), 0, lengths)\n",
    );
    expect(main["counted"]).toBe(1);
    expect(main["blank"]).toBe(false);
    // The unplaced element is enumerable without ever being hashed.
    expect(main["walked"]).toBe(1);
  });

  /**
   * §16 (b): the keyed operations do demand it, and say so at the use site.
   *
   * The report is Modules §7.6's **replacing** composition (#644): `Hash` is
   * derivable-only, so neither legal home may hold the hand-written honor the
   * two-home clause invites, and the clause gives way to the one repair the
   * checker would accept. Base-complete, this specimen having no `Eq` either.
   * `derivation-fixit.test.ts` owns the family; this pin reads it at a real
   * element type.
   */
  test("a keyed operation at the same element type is refused, with the derivation repair", () => {
    expect(projectDiagnostics(
      "record Point = {s: String}\n" +
        "export let bad: Set(Point) = Set.add(Set.empty, Point({s = \"K\"}))\n",
    )).toContain(
      "type `Point` has no `Hash` instance; `Hash` instances cannot be hand-written, " +
        "so the only repair is `derives (Eq, Hash)` on the declaration of `Point` " +
        "in `./main.hex`",
    );
  });

  /** §3.2's `fromVector`, and §3.4's synonym pair. */
  test("`fromVector` collects left to right, duplicates collapsing", async () => {
    const main = await runMain(
      "let s: Set(Int) = Set.fromVector([1, 2, 3])\n" +
        "let duplicated: Set(Int) = Set.fromVector([1, 1, 2])\n" +
        "export let counted: (Int, Int) = (Set.size(s), Set.size(duplicated))\n" +
        "export let viaSeq: Int = Set.size(Set.fromSeq(Set.toSeq(s)))\n",
    );
    expect(main["counted"]).toEqual([3, 2]);
    expect(main["viaSeq"]).toBe(3);
  });
});

describe("§16 (d) no brackets, and `contains` is the only Boolean read", () => {
  /**
   * §12.2: a `Set` has no bracket, permanently. The bracket is an *expression
   * form* the emitter lowers for `Vector`, `String` and `Map`; a set has no
   * index and no key distinct from its element, so there is nothing for one to
   * mean. The refusal is the ordinary one — no bespoke message is owed (§9).
   */
  test("`s[x]` is a type error", () => {
    const messages = projectDiagnostics(
      "let s: Set(Int) = Set.fromVector([1, 2])\n" +
        "export let bad: Int = s[1]\n",
    );
    expect(messages).not.toEqual([]);
    expect(messages.join("\n")).toContain(
      "indexing requires a Vector, String, or Map",
    );
  });

  /** Part 1 §7, restated at §5.3: set union is not concatenation. */
  test("`++` is refused for `Set`", () => {
    const messages = projectDiagnostics(
      "let s: Set(Int) = Set.fromVector([1, 2])\n" +
        "export let bad: Set(Int) = s ++ s\n",
    );
    expect(messages).not.toEqual([]);
    expect(messages.join("\n")).toContain("Concat");
  });

  /** §6.2: `contains` is membership, and the surface's only Boolean read. */
  test("`contains` answers membership", async () => {
    const main = await runMain(
      "let s: Set(Int) = Set.fromVector([1, 2, 3])\n" +
        "export let held: Bool = Set.contains(s, 2)\n" +
        "export let absent: Bool = Set.contains(s, 9)\n" +
        "export let neverInEmpty: Bool = Set.contains(Set.empty, 1)\n",
    );
    expect(main["held"]).toBe(true);
    expect(main["absent"]).toBe(false);
    expect(main["neverInEmpty"]).toBe(false);
  });
});

describe("§16 (e) idempotent add and forgiving removal", () => {
  /**
   * §5.1: `add` is insert, and adding a present element returns the set
   * unchanged. §5.2: `remove` is a request rather than an assertion, so an
   * absent element is not a fault, and removal is idempotent.
   *
   * `Set.remove(Set.add(s, 4), 4) == s` is §16 (e)'s own line, and it is
   * asserted through `Eq` rather than through identity: the equality is what
   * §5.1 promises, and the identity is a representation detail the surface does
   * not owe.
   */
  test("add is idempotent, remove is forgiving, and the round trip returns", async () => {
    const main = await runMain(
      "let s: Set(Int) = Set.fromVector([1, 2, 3])\n" +
        "export let grew: Int = Set.size(Set.add(s, 4))\n" +
        "export let unchanged: Int = Set.size(Set.add(s, 1))\n" +
        "export let stillEqual: Bool = Set.add(s, 1) == s\n" +
        "export let forgiving: Int = Set.size(Set.remove(s, 99))\n" +
        "export let removedTwice: Bool = Set.remove(Set.remove(s, 1), 1) == Set.remove(s, 1)\n" +
        "export let roundTrip: Bool = Set.remove(Set.add(s, 4), 4) == s\n" +
        "export let emptied: Bool = Set.isEmpty(Set.remove(Set.singleton(1), 1))\n",
    );
    expect(main["grew"]).toBe(4);
    expect(main["unchanged"]).toBe(3);
    expect(main["stillEqual"]).toBe(true);
    expect(main["forgiving"]).toBe(3);
    expect(main["removedTwice"]).toBe(true);
    expect(main["roundTrip"]).toBe(true);
    expect(main["emptied"]).toBe(true);
  });
});

describe("§16 (f) / §5.3 the algebra, in both directions", () => {
  /**
   * The four operations, extensionally, at every shape that has an edge: the
   * empty set on each side, disjoint operands, and operands where one contains
   * the other.
   *
   * **Both operand orders, deliberately.** §2.2 pins `union` and `intersect` to
   * the *smaller* side, so `stdlib/Set.hex` dispatches on `size` and each order
   * runs different code. An assertion made in one order alone would leave the
   * other branch untested — and the mirrored branch is the harder one, since it
   * is where §5.4's left-representative retention stops being free.
   */
  test("union, intersect, difference, and isSubsetOf, both operand orders", async () => {
    const main = await runMain(
      "let small: Set(Int) = Set.fromVector([1, 2])\n" +
        "let large: Set(Int) = Set.fromVector([2, 3, 4, 5])\n" +
        "let blank: Set(Int) = Set.empty\n" +
        "let collected(s: Set(Int)): Vector(Int) = Vector.fromSeq(Set.toSeq(s))\n" +
        // Smaller side on the right, then on the left.
        "export let unionA: Int = Set.size(Set.union(large, small))\n" +
        "export let unionB: Int = Set.size(Set.union(small, large))\n" +
        "export let unionAgrees: Bool = Set.union(large, small) == Set.union(small, large)\n" +
        "export let interA: Bool = Set.intersect(large, small) == Set.singleton(2)\n" +
        "export let interB: Bool = Set.intersect(small, large) == Set.singleton(2)\n" +
        // `difference` and `isSubsetOf` do not dispatch — §2.2 pins both to the
        // left side — so their two orders are genuinely different answers.
        "export let diffA: Bool = Set.difference(small, large) == Set.singleton(1)\n" +
        "export let diffB: Bool = Set.difference(large, small) == Set.fromVector([3, 4, 5])\n" +
        "export let subsetA: Bool = Set.isSubsetOf(Set.singleton(2), large)\n" +
        "export let subsetB: Bool = Set.isSubsetOf(large, Set.singleton(2))\n" +
        // The empty-set edges, on both sides of each operation.
        "export let unionEmptyLeft: Bool = Set.union(blank, small) == small\n" +
        "export let unionEmptyRight: Bool = Set.union(small, blank) == small\n" +
        "export let interEmptyLeft: Bool = Set.isEmpty(Set.intersect(blank, small))\n" +
        "export let interEmptyRight: Bool = Set.isEmpty(Set.intersect(small, blank))\n" +
        "export let diffEmptyLeft: Bool = Set.isEmpty(Set.difference(blank, small))\n" +
        "export let diffEmptyRight: Bool = Set.difference(small, blank) == small\n" +
        // §5.3's two named facts about `isSubsetOf`.
        "export let emptyIsSubset: Bool = Set.isSubsetOf(blank, large)\n" +
        "export let selfIsSubset: Bool = Set.isSubsetOf(large, large)\n" +
        "export let disjoint: Int = Set.size(Set.union(Set.singleton(7), Set.singleton(8)))\n" +
        "export let contents: Vector(Int) = collected(Set.union(small, large))\n",
    );
    expect(main["unionA"]).toBe(5);
    expect(main["unionB"]).toBe(5);
    expect(main["unionAgrees"]).toBe(true);
    expect(main["interA"]).toBe(true);
    expect(main["interB"]).toBe(true);
    expect(main["diffA"]).toBe(true);
    expect(main["diffB"]).toBe(true);
    expect(main["subsetA"]).toBe(true);
    expect(main["subsetB"]).toBe(false);
    expect(main["unionEmptyLeft"]).toBe(true);
    expect(main["unionEmptyRight"]).toBe(true);
    expect(main["interEmptyLeft"]).toBe(true);
    expect(main["interEmptyRight"]).toBe(true);
    expect(main["diffEmptyLeft"]).toBe(true);
    expect(main["diffEmptyRight"]).toBe(true);
    expect(main["emptyIsSubset"]).toBe(true);
    expect(main["selfIsSubset"]).toBe(true);
    expect(main["disjoint"]).toBe(2);
    // Contents, not order (§7.1).
    expect([...(main["contents"] as Iterable<number>)].sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5]);
  });
});

describe("§16 (j) / §5.4 representative retention", () => {
  /**
   * The rule: **a stored element representative is never replaced by an
   * `equals`-equal newcomer**, and for the algebra the *left* operand's
   * representative survives.
   *
   * In v1 the rule is observable through exactly one pair of values: `-0.0` and
   * `0.0`, which `Eq<Float>`'s SameValueZero equates (Constraints §7, chosen
   * precisely for this key model) while `1.0 / x` still tells them apart. Every
   * test below reads the sign that way, because `show` renders `-0` as `"0"`.
   *
   * ## The two seams the section runs along
   *
   * An **unplaced** set does not navigate by anything: `singleton` holds its
   * element raw (§12.4) and every operation on a one-element set answers by
   * comparing directly, so retention is read straight off the comparison. A
   * **placed** set navigates by `Hash<Float>`, which normalizes the two zeros to
   * a single hash — so the trie arrives at the resident element and retention is
   * the trie's to keep. Both seams are exercised, and both answer §5.4 alike.
   */
  const NEGATIVES =
    "let negatives(total: Int, x: Float): Int = if 1.0 / x < 0.0 then total + 1 else total\n" +
    "let signs(s: Set(Float)): Int = Seq.fold(Set.toSeq(s), 0, negatives)\n";

  /**
   * `add` at a present element returns the set unchanged, so the resident
   * representative survives — §5.1's idempotence *is* §5.4's rule, and the
   * unplaced set is where v1 can watch it happen.
   */
  test("an `equals`-equal newcomer does not replace the stored element", async () => {
    const main = await runMain(
      NEGATIVES +
        "let negative: Set(Float) = Set.singleton(-0.0)\n" +
        "let positive: Set(Float) = Set.singleton(0.0)\n" +
        "export let equated: Bool = -0.0 == 0.0\n" +
        "export let stillOne: Int = Set.size(Set.add(negative, 0.0))\n" +
        "export let keptNegative: Int = signs(Set.add(negative, 0.0))\n" +
        "export let keptPositive: Int = signs(Set.add(positive, -0.0))\n" +
        "export let unchanged: Bool = Set.add(negative, 0.0) == negative\n",
    );
    // The equality the rule is stated over does hold.
    expect(main["equated"]).toBe(true);
    expect(main["stillOne"]).toBe(1);
    // The resident survives, whichever sign it is.
    expect(main["keptNegative"]).toBe(1);
    expect(main["keptPositive"]).toBe(0);
    expect(main["unchanged"]).toBe(true);
  });

  /**
   * §5.4's algebra clause, on the branch that takes the smaller side into the
   * left: equal sizes send both operand orders down the insert-if-absent
   * direction, and the left's representative survives in each.
   *
   * Both operands are unplaced singletons, so no hash is consulted at all.
   */
  test("union and intersect keep the left's representative, unplaced", async () => {
    const main = await runMain(
      NEGATIVES +
        "let negative: Set(Float) = Set.singleton(-0.0)\n" +
        "let positive: Set(Float) = Set.singleton(0.0)\n" +
        "export let unionNegativeLeft: (Int, Int) =\n" +
        "    (Set.size(Set.union(negative, positive)), signs(Set.union(negative, positive)))\n" +
        "export let unionPositiveLeft: (Int, Int) =\n" +
        "    (Set.size(Set.union(positive, negative)), signs(Set.union(positive, negative)))\n" +
        "export let interNegativeLeft: (Int, Int) =\n" +
        "    (Set.size(Set.intersect(negative, positive)), signs(Set.intersect(negative, positive)))\n" +
        "export let interPositiveLeft: (Int, Int) =\n" +
        "    (Set.size(Set.intersect(positive, negative)), signs(Set.intersect(positive, negative)))\n",
    );
    // One element each time, and its sign is the left operand's.
    expect(main["unionNegativeLeft"]).toEqual([1, 1]);
    expect(main["unionPositiveLeft"]).toEqual([1, 0]);
    expect(main["interNegativeLeft"]).toEqual([1, 1]);
    expect(main["interPositiveLeft"]).toEqual([1, 0]);
  });

  /**
   * The **mirrored** branch of each operation — the one §2.2's smaller-side rule
   * reaches when the left operand is the small one — and the one place where
   * `stdlib/Set.hex` has to work for §5.4 rather than receive it: `union` folds
   * the left into the right with insert-with-replace, and `intersect` looks the
   * left's representative up through the unexported `setLookup` row.
   *
   * Reaching this branch needs operands of different sizes, so one of them is
   * placed and the hash does the navigating: the two zeros hash alike, so
   * `union` displaces rather than inserting a third element and `intersect`
   * finds the left's element through the resident one. The sign is the claim
   * §5.4 actually makes, and it is the left's representative in both directions.
   */
  test("the mirrored branch keeps the left's representative, placed", async () => {
    const main = await runMain(
      NEGATIVES +
        "let negative: Set(Float) = Set.singleton(-0.0)\n" +
        "let placed: Set(Float) = Set.fromVector([0.0, 1.0])\n" +
        // size(left) 1 < size(right) 2, so `union` folds left into right and
        // `intersect` traverses the right and looks the left's element up.
        "export let unionSizes: (Int, Int) =\n" +
        "    (Set.size(Set.union(negative, placed)), Set.size(Set.union(placed, negative)))\n" +
        "export let unionSigns: (Int, Int) =\n" +
        "    (signs(Set.union(negative, placed)), signs(Set.union(placed, negative)))\n" +
        "export let interSizes: (Int, Int) =\n" +
        "    (Set.size(Set.intersect(negative, placed)), Set.size(Set.intersect(placed, negative)))\n" +
        "export let interSigns: (Int, Int) =\n" +
        "    (signs(Set.intersect(negative, placed)), signs(Set.intersect(placed, negative)))\n",
    );
    // The zeros are one element, so the union is two wide either way.
    expect(main["unionSizes"]).toEqual([2, 2]);
    // And the surviving zero is the left operand's, exactly as in the unplaced
    // pair above: negative on the left, negative kept; positive on the left,
    // positive kept.
    expect(main["unionSigns"]).toEqual([1, 0]);
    expect(main["interSizes"]).toEqual([1, 1]);
    expect(main["interSigns"]).toEqual([1, 0]);
  });

  /**
   * §16 (j)'s own opening line: a two-zero `fromVector` is one element by
   * SameValueZero, and the element kept is the one that arrived first.
   */
  test("±0 Floats are one placed element, and the first arrival is kept", async () => {
    const main = await runMain(
      NEGATIVES +
        "let z: Set(Float) = Set.fromVector([-0.0, 0.0])\n" +
        "export let counted: Int = Set.size(z)\n" +
        "export let negativeCount: Int = signs(z)\n",
    );
    expect(main["counted"]).toBe(1);
    // The single stored element is the negative zero: the resident, not the
    // `equals`-equal newcomer.
    expect(main["negativeCount"]).toBe(1);
  });
});

describe("§16 (g) iteration", () => {
  /**
   * §7: `for x in s` iterates elements, not pairs — the whole reason the trie
   * grew a second representation record (#373). A set's boundary iterator yields
   * what `Hex.Set<a> extends Iterable<a>` promises.
   */
  test("`for x in s` iterates the elements", async () => {
    const main = await runMain(
      "let s: Set(Int) = Set.fromVector([1, 2, 3])\n" +
        "let total(source: Set(Int)): Int =\n" +
        "    var sum = 0\n" +
        "    for x in source\n" +
        "        sum := sum + x\n" +
        "    sum\n" +
        "export let summed: Int = total(s)\n" +
        "export let none: Int = total(Set.empty)\n" +
        "export let one: Int = total(Set.singleton(7))\n",
    );
    // An order-independent aggregate, per this file's opening note.
    expect(main["summed"]).toBe(6);
    expect(main["none"]).toBe(0);
    // The unplaced singleton iterates too, without being hashed.
    expect(main["one"]).toBe(7);
  });

  /** §16 (h): two traversals of one set value within one run agree. */
  test("two traversals of one value produce the same order", async () => {
    const main = await runMain(
      "let s: Set(Int) = Set.fromVector([5, 12, 33, 44, 71, 98])\n" +
        "export let first: Vector(Int) = Vector.fromSeq(Set.toSeq(s))\n" +
        "export let second: Vector(Int) = Vector.fromSeq(Set.toSeq(s))\n",
    );
    expect([...(main["first"] as Iterable<number>)])
      .toEqual([...(main["second"] as Iterable<number>)]);
  });
});

describe("§16 (i) the instances", () => {
  /**
   * §8.1's `Eq` is **extensional** — equal sizes and mutual containment. §8.4's
   * `Hash` is permutation-invariant, forced rather than chosen: the public
   * member is deterministic and unseeded while iteration order is seeded, so an
   * order-sensitive fold would make `hash(s)` a per-process value.
   */
  test("Eq is extensional and Hash is permutation-invariant", async () => {
    const main = await runMain(
      "let left: Set(Int) = Set.fromVector([1, 2, 3])\n" +
        "let right: Set(Int) = Set.fromVector([3, 2, 1])\n" +
        "let different: Set(Int) = Set.fromVector([1, 2, 4])\n" +
        "let shorter: Set(Int) = Set.fromVector([1, 2])\n" +
        "export let equal: Bool = left == right\n" +
        "export let hashesAgree: Bool = hash(left) == hash(right)\n" +
        "export let elementsMatter: Bool = left == different\n" +
        "export let sizesMatter: Bool = left == shorter\n" +
        // **The size check's own row, and the operand order is the whole point.**
        // `setEquals` compares sizes and then walks the *left* set probing the
        // right, so with the bigger set on the left the walk fails on its own and
        // the size comparison is never load-bearing. Put the strict subset on the
        // left and the walk succeeds — only the size check can answer `False`.
        // Deleting that comparison from the helper leaves every other assertion
        // in this file green and turns this one red, which is what a mutation
        // check asked for.
        "export let subsetIsNotEqual: Bool = shorter == left\n" +
        "export let emptiesAgree: Bool = Set.remove(Set.singleton(1), 1) == Set.empty\n",
    );
    expect(main["equal"]).toBe(true);
    expect(main["hashesAgree"]).toBe(true);
    expect(main["elementsMatter"]).toBe(false);
    expect(main["sizesMatter"]).toBe(false);
    expect(main["subsetIsNotEqual"]).toBe(false);
    expect(main["emptiesAgree"]).toBe(true);
  });

  /**
   * The same two claims over generated insertion orders rather than one
   * hand-picked pair. The program is compiled once and driven many times, so
   * what varies is the *insertion order* — the only thing the two claims are
   * about. The seed is this file's own (`vitest.setup.ts`), never the suite's.
   */
  test("Eq and Hash ignore insertion order, over generated orders", async () => {
    const main = await runMain(
      "let build(a: Int, b: Int, c: Int): Set(Int) = Set.fromVector([a, b, c])\n" +
        "export fun agrees(a: Int, b: Int, c: Int): (Bool, Bool, Int) =\n" +
        "    let one = build(a, b, c)\n" +
        "    let other = build(c, a, b)\n" +
        "    (one == other, hash(one) == hash(other), Set.size(one))\n",
    );
    const agrees = main["agrees"] as (a: number, b: number, c: number) => [boolean, boolean, number];
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: -1000, max: 1000 }), {
          minLength: 3,
          maxLength: 3,
        }),
        ([a, b, c]) => {
          const [equal, hashed, size] = agrees(a!, b!, c!);
          expect(equal).toBe(true);
          expect(hashed).toBe(true);
          expect(size).toBe(3);
        },
      ),
    );
  });

  /**
   * §8.2: no `Ord`, and none planned. The only order a hash table has is its
   * traversal order, which is per-process, so a lexicographic `Ord` would
   * compare differently across runs. §16 (i) writes the case as
   * `Set.fromVector([1, 2]) < Set.fromVector([1, 2, 3])`, and the diagnostic is
   * the ordinary unsatisfied-constraint one — §9's row says no bespoke message
   * is owed.
   */
  test("there is no `Ord` instance for `Set`", () => {
    const messages = projectDiagnostics(
      "let a: Set(Int) = Set.fromVector([1, 2])\n" +
        "let b: Set(Int) = Set.fromVector([1, 2, 3])\n" +
        "export let ordered: Bool = a < b\n",
    );
    expect(messages.join("\n")).toContain("Ord");
    expect(messages).not.toEqual([]);
  });

  /** §8.3: constructor-shaped display, `Set.empty` when empty. */
  test("Show renders the constructor form", async () => {
    const main = await runMain(
      "let blank: Set(Int) = Set.empty\n" +
        "let one: Set(String) = Set.singleton(\"one\")\n" +
        "let two: Set(Int) = Set.fromVector([1, 2])\n" +
        "export let shownEmpty: String = show(blank)\n" +
        "export let shownOne: String = show(one)\n" +
        "export let shownTwo: String = show(two)\n",
    );
    expect(main["shownEmpty"]).toBe("Set.empty");
    // `Show<String>` displays bare (Products §2.5), so the element is `one`, not
    // `"one"` — display, not serialization.
    expect(main["shownOne"]).toBe("Set.fromVector([one])");
    expect(shownElements(main["shownTwo"] as string, "Set.fromVector(")).toEqual(["1", "2"]);
  });

  /**
   * §8.4's closing sentence, and §16 (i)'s `Set(Set(Int))` line: the instances
   * make sets usable as set elements and as map keys themselves. This is the one
   * assertion that exercises `Hash<Set>` and `Eq<Set>` as *evidence* rather than
   * as operators.
   */
  test("a set is usable as a set element and as a map key", async () => {
    const main = await runMain(
      "let one: Set(Int) = Set.singleton(1)\n" +
        "let alsoOne: Set(Int) = Set.fromVector([1, 1])\n" +
        "let two: Set(Int) = Set.singleton(2)\n" +
        "let nested: Set(Set(Int)) = Set.fromVector([one, alsoOne, two])\n" +
        "export let collapsed: Int = Set.size(nested)\n" +
        "export let held: Bool = Set.contains(nested, alsoOne)\n" +
        "let keyed: Map(Set(Int), String) = Map.singleton(one, \"first\")\n" +
        "export let looked: String = Map.set(keyed, alsoOne, \"second\")[one]\n" +
        "export let stillOne: Int = Map.size(Map.set(keyed, alsoOne, \"second\"))\n",
    );
    // `one` and `alsoOne` are extensionally equal, so the outer set holds two.
    expect(main["collapsed"]).toBe(2);
    expect(main["held"]).toBe(true);
    // And they are one key: the second write replaces the first's value.
    expect(main["looked"]).toBe("second");
    expect(main["stillOne"]).toBe(1);
  });
});

describe("the companion's surface", () => {
  /**
   * Method Syntax §1: the dot spelling and the qualified spelling are one call.
   * `Set`'s keyed trio goes through §3.4's constraint grant, so this is where
   * the two spellings could differ — a dot call that dropped the evidence suffix
   * would call the same function one argument short.
   */
  test("dot call and qualified call agree, evidence included", async () => {
    const main = await runMain(
      "let s: Set(Int) = Set.fromVector([1, 2])\n" +
        "let other: Set(Int) = Set.fromVector([2, 3])\n" +
        "export let dotted: Int = Set.size(s.add(3))\n" +
        "export let qualified: Int = Set.size(Set.add(s, 3))\n" +
        "export let dottedHas: Bool = s.contains(1)\n" +
        "export let dottedRemove: Int = Set.size(s.remove(1))\n" +
        "export let dottedEmpty: Bool = s.isEmpty()\n" +
        "export let dottedUnion: Int = Set.size(s.union(other))\n" +
        "export let dottedSubset: Bool = s.isSubsetOf(s)\n" +
        "export let dottedSeq: Int = Seq.length(s.toSeq())\n",
    );
    expect(main["dotted"]).toBe(3);
    expect(main["qualified"]).toBe(3);
    expect(main["dottedHas"]).toBe(true);
    expect(main["dottedRemove"]).toBe(1);
    expect(main["dottedEmpty"]).toBe(false);
    expect(main["dottedUnion"]).toBe(3);
    expect(main["dottedSubset"]).toBe(true);
    expect(main["dottedSeq"]).toBe(2);
  });

  /**
   * Modules §5.5, as ruled at the `Vector` landing and extended once per
   * companion: a bare prelude name several members export is refused in favour
   * of the qualified spellings and dot call. `Set.hex` collides with all three
   * of its predecessors on several names, and `empty` now reaches four homes,
   * which is the enumeration at the longest length the shipped prelude produces.
   *
   * One collision is worth naming because it crosses families rather than
   * staying inside the collection companions: `Set.add` collides with `Num`'s
   * member `add`, so the bare arithmetic spelling is refused too. That is the
   * same shape `concat` has had since `Seq.hex` joined a prelude that already
   * declared `Concat` — the rule, not a new one.
   */
  test("the bare collided names are refused, and the qualified ones answer", async () => {
    expect(projectDiagnostics("export let e: Set(Int) = empty\n")).toEqual([
      "the prelude name `empty` is ambiguous: exported by `Seq`, `Vector`, " +
      "`Map`, and `Set`; write `Seq.empty`, `Vector.empty`, `Map.empty`, or " +
      "`Set.empty`",
    ]);
    expect(projectDiagnostics("export let n: Int = add(1, 2)\n")).toEqual([
      "the prelude name `add` is ambiguous: exported by `Num` and `Set`; " +
      "write `Num.add` or `Set.add`",
    ]);
    expect(projectDiagnostics("export let n: Int = size(Set.empty)\n")).toEqual([
      "the prelude name `size` is ambiguous: exported by `Map` and `Set`; " +
      "write `Map.size` or `Set.size`",
    ]);
    const main = await runMain(
      "export let n: Int = Set.size(Set.singleton(1))\n" +
        "export let v: Int = Vector.length(Vector.singleton(1))\n" +
        "export let m: Int = Map.size(Map.singleton(1, 2))\n",
    );
    expect(main["n"]).toBe(1);
    expect(main["v"]).toBe(1);
    expect(main["m"]).toBe(1);
  });

  /**
   * **`union` is bare-legal, and that is new.** The name was a hard keyword
   * until this step asked for it (#373), so no binder anywhere could carry it;
   * it is contextual now, and `Set.hex` is the prelude's only exporter of the
   * spelling, so Modules §5.5 has nothing to refuse and the bare call resolves.
   * Its three spellings are one call, as Method Syntax §1 requires — and the
   * declaration form is unharmed, which is the half a contextual keyword can
   * break.
   */
  test("`union` resolves bare, qualified, and after a dot, and still declares", async () => {
    const main = await runMain(
      "union Colour = Red | Green\n" +
        "let left: Set(Int) = Set.fromVector([1, 2])\n" +
        "let right: Set(Int) = Set.fromVector([2, 3])\n" +
        "export let bare: Int = Set.size(union(left, right))\n" +
        "export let qualified: Int = Set.size(Set.union(left, right))\n" +
        "export let dotted: Int = Set.size(left.union(right))\n" +
        "export let agree: Bool = union(left, right) == Set.union(left, right)\n" +
        // The word still declares, and the declaration is still usable.
        "let describe(colour: Colour): Int =\n" +
        "    match colour\n" +
        "        Red => 1\n" +
        "        Green => 2\n" +
        "export let declared: Int = describe(Green)\n" +
        // And it still binds, which is the other half a reserved word forbade.
        "let bound(union: Int): Int = union + 1\n" +
        "export let asBinder: Int = bound(41)\n",
    );
    expect(main["bare"]).toBe(3);
    expect(main["qualified"]).toBe(3);
    expect(main["dotted"]).toBe(3);
    expect(main["agree"]).toBe(true);
    expect(main["declared"]).toBe(2);
    expect(main["asBinder"]).toBe(42);
  });

  /**
   * Every export carries a manual-voice doc comment, and the doc travels into
   * the emitted JavaScript as it does for every other prelude member. Read off
   * the compiled module rather than the file, so a comment that failed to attach
   * to its declaration would not pass.
   *
   * The list is also the whole exported surface, which is where the eighth door
   * key is held to its word: `setLookup`'s local name `storedMember` is declared
   * **unexported** beneath the surface, so it must not appear here. It exists for
   * `intersect`'s mirrored branch alone, and Part 4 §6.2's `contains` stays the
   * only membership read a program can reach. The two private algebra helpers
   * (`replaceMember`, `keptRepresentative`) are held to the same absence.
   */
  test("every export is documented, and the private rows stay private", () => {
    const project = compileFiles([[
      "/main.hex",
      "export let n: Int = Set.size(Set.singleton(1))\n",
    ]]);
    expect(project.diagnostics).toEqual([]);
    const set = project.modules.find(({ source }) => source.path === "/Set.hex");
    expect(set).toBeDefined();
    const exported = set!.typed.items.flatMap((item) =>
      (item.kind === "Let" || item.kind === "Fun") && item.exported
        ? [item.binding.name]
        : item.kind === "ExternBlock"
        ? item.declarations.flatMap((declaration) =>
          declaration.exported ? [declaration.localName] : []
        )
        : []
    );
    expect(exported.sort()).toEqual([
      "add",
      "contains",
      "difference",
      "empty",
      "fromSeq",
      "fromVector",
      "intersect",
      "isEmpty",
      "isSubsetOf",
      "remove",
      "singleton",
      "size",
      "union",
    ]);
    for (const hidden of ["storedMember", "replaceMember", "keptRepresentative", "emptySet"]) {
      expect(exported).not.toContain(hidden);
    }
    const javascript = set!.javascript.text;
    for (const name of exported) {
      const index = javascript.indexOf(`const ${name} =`);
      expect(index).toBeGreaterThan(0);
      expect(javascript.slice(0, index)).toContain("*/");
    }
  });

  /**
   * The `.d.ts` face publishes the **unconstrained** surface and nothing else —
   * the ordinary rule for a constrained binding (Constraints §6.4: the face is
   * the specializations), and `Hash` has no fundamental specializations, so the
   * keyed rows are simply absent. `Map`'s block records why the rule is
   * load-bearing rather than tidy; the same reasoning applies verbatim here.
   *
   * The unexported eighth key is checked twice over: it is neither in the face
   * nor in the emitted module's export list, so nothing outside `Set.hex` can
   * reach it from either language.
   */
  test("the `.d.ts` face carries the unconstrained surface only", () => {
    const project = compileFiles([[
      "/main.hex",
      "export let n: Int = Set.size(Set.singleton(1))\n",
    ]]);
    expect(project.diagnostics).toEqual([]);
    const set = project.modules.find(({ source }) => source.path === "/Set.hex");
    const face = set!.declarations.text;
    const unconstrained = ["singleton", "size", "empty", "isEmpty"];
    for (const name of unconstrained) {
      expect(face).toMatch(new RegExp(`export declare (const|function) ${name}\\b`, "u"));
    }
    const constrained = [
      "contains",
      "add",
      "remove",
      "union",
      "intersect",
      "difference",
      "isSubsetOf",
      "fromSeq",
      "fromVector",
    ];
    for (const name of constrained) {
      expect(face).not.toMatch(new RegExp(`export declare (const|function) ${name}\\b`, "u"));
    }
    // The unexported row is in neither language's surface.
    expect(face).not.toContain("storedMember");
    const javascript = set!.javascript.text;
    expect(javascript).not.toMatch(/export \{[^}]*\bstoredMember\b[^}]*\}/u);
    // The face is a face of the *emitted module*, so every name it publishes
    // must be an export the JavaScript actually has under that spelling.
    for (const name of unconstrained) {
      expect(javascript).toMatch(new RegExp(`export \\{[^}]*\\b${name}\\b[^}]*\\}`, "u"));
    }
  });

  /**
   * §12.2 and §12.3, as absences in the surface rather than as refusals at a use
   * site: a set declares no exception (it has no partial operation to raise
   * one), and `isSupersetOf` is deliberately not in the core — it is
   * `isSubsetOf` with the arguments flipped, and a stdlib-listing candidate at
   * most.
   */
  test("no exception and no `isSupersetOf`", () => {
    expect(projectDiagnostics(
      "let a: Set(Int) = Set.fromVector([1])\n" +
        "export let bad: Bool = Set.isSupersetOf(a, a)\n",
    )).toContain("module `Set` does not export `isSupersetOf`");

    const project = compileFiles([[
      "/main.hex",
      "export let n: Int = Set.size(Set.singleton(1))\n",
    ]]);
    const set = project.modules.find(({ source }) => source.path === "/Set.hex");
    expect(set!.typed.items.some((item) => item.kind === "Exception")).toBe(false);
  });
});
