import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for `stdlib/Map.hex` — Collections Part 4's acceptance tests (§16)
 * turned into fixtures, plus the four gaps the Map step closes (#370, #366).
 *
 * This is the results-side companion to `hash-trie-wiring.test.ts`. Nothing here
 * looks at emitted JavaScript or at the representation: every assertion is one
 * Part 4 states about the *surface*, so the file would survive a change of
 * backing — which is the property that makes it worth having beside a wiring
 * test that deliberately would not.
 *
 * ## What is deliberately not asserted
 *
 * **No traversal order.** A `Map` is a hash array mapped trie with seeded
 * placement (§7.1), so the order `entries`, `keys`, `values`, `toSeq`, `show`
 * and `for (k, v) in` produce is deterministic for one map value within one
 * execution and is promised for nothing else — not insertion, not sorted, not
 * stable across runs. Every assertion below is an order-independent aggregate,
 * a comparison of one map value against itself, or a `show` rendering read for
 * its *contents* rather than its sequence.
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
   * §3.5: `Map.empty` is a polymorphic *constant*, not a call. The call
   * spelling every consumer used before this milestone is now what it looks
   * like — an attempt to call a value — and the constant generalizes, so one
   * binding of it serves two key types in one program.
   *
   * This is the fourth conformance gap the Map step closes, and the one the
   * step's own survey found: the transitional core typed `empty` as a nullary
   * function, so `Map.empty()` compiled and `Map.empty` did not, which is the
   * exact inverse of what §3.5 says.
   */
  test("`Map.empty` is a value, and generalizes", async () => {
    const main = await runMain(
      "let e = Map.empty\n" +
        "let byInt: Map(Int, String) = Map.set(e, 1, \"one\")\n" +
        "let byText: Map(String, Int) = Map.set(e, \"one\", 1)\n" +
        "export let counted: (Int, Int, Int) = (Map.size(e), Map.size(byInt), Map.size(byText))\n",
    );
    expect(main["counted"]).toEqual([0, 1, 1]);
  });

  test("the call spelling is refused like any other non-function call", () => {
    // No bespoke message is owed and none is written: `Map.empty` is a value, so
    // calling it takes the ordinary not-callable report (#385), which names the
    // callee, the type it does have, and how many arguments the call supplied.
    // The variable numbers in the rendered type are not asserted — they move
    // with every unrelated change to the prelude. No arrow appears: the report's
    // subject is that there is no function here, so a demanded arrow's colour
    // would be a claim about a call that does not exist.
    const messages = projectDiagnostics("export let e: Map(Int, Int) = Map.empty()\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`empty` is not a function — it has type `Map(");
    expect(messages[0]).toContain("and this call supplies no arguments");
    expect(messages[0]).not.toContain("->");
  });

  /**
   * §12.4, and the second of #366's gaps: `singleton` is **unconstrained, and
   * permanently so**. A key type with no `Hash` instance — and none derivable,
   * since this one has no `derives` clause — must still construct a one-entry
   * map, because the entry is held unplaced until a keyed operation arrives.
   */
  test("`Map.singleton` takes a key type with no `Hash` instance", async () => {
    const main = await runMain(
      "record Weird = {s: String}\n" +
        "let odd: Map(Weird, Int) = Map.singleton(Weird({s = \"K\"}), 7)\n" +
        "export let counted: Int = Map.size(odd)\n" +
        "export let blank: Bool = Map.isEmpty(odd)\n" +
        "let addValue(total: Int, pair: (Weird, Int)): Int =\n" +
        "    let (_, value) = pair\n" +
        "    total + value\n" +
        "export let summed: Int = Seq.fold(Map.entries(odd), 0, addValue)\n",
    );
    expect(main["counted"]).toBe(1);
    expect(main["blank"]).toBe(false);
    expect(main["summed"]).toBe(7);
  });

  /**
   * §16 (b): the keyed operations do demand it, and say so at the use site.
   *
   * The report is Modules §7.6's **replacing** composition (#644): `Hash` is
   * derivable-only, so neither legal home may hold the hand-written honor the
   * two-home clause invites, and the clause gives way to the one repair the
   * checker would accept. Base-complete, this specimen having no `Eq` either —
   * following a bare `derives Hash` would trade this error for the missing-base
   * one. `derivation-fixit.test.ts` owns the family; this pin is the Part 4
   * §"`m[k]` where `k`'s type lacks `Hash`" row reading it at a real key.
   */
  test("a keyed operation at the same key type is refused, with the derivation repair", () => {
    expect(projectDiagnostics(
      "record Point = {s: String}\n" +
        "export let bad: Map(Point, Int) = Map.set(Map.empty, Point({s = \"K\"}), 1)\n",
    )).toContain(
      "type `Point` has no `Hash` instance; `Hash` instances cannot be hand-written, " +
        "so the only repair is `derives (Eq, Hash)` on the declaration of `Point` " +
        "in `./main.hex`",
    );
  });

  /** §3.2's `fromVector`, and §3.3's duplicate rule: the last value wins. */
  test("`fromVector` collects left to right, last value winning", async () => {
    const main = await runMain(
      "let m: Map(Int, String) = Map.fromVector([(1, \"one\"), (2, \"two\")])\n" +
        "let duplicated: Map(Int, String) = " +
        "Map.fromEntries(Vector.toSeq([(1, \"old\"), (1, \"new\")]))\n" +
        "export let counted: (Int, Int) = (Map.size(m), Map.size(duplicated))\n" +
        "export let latest: String = duplicated[1]\n" +
        // §3.4's synonym pairs are one implementation under two names.
        "export let viaSeq: Int = Map.size(Map.fromSeq(Map.toSeq(m)))\n",
    );
    expect(main["counted"]).toEqual([2, 1]);
    expect(main["latest"]).toBe("new");
    expect(main["viaSeq"]).toBe(2);
  });
});

describe("§16 (c) the accessor pair", () => {
  /**
   * §4.1/§4.2: brackets assert presence and fail loudly at the fault site;
   * `Map.get` answers with an `Option` and never throws.
   *
   * `Map.get`'s mere presence is the first of #366's gaps closed. It was
   * *untypeable* before this milestone — the transitional core had no `get` row
   * at `Map` at all, so the total accessor Part 4 §4.2 mandates could not be
   * written, and every reader was pushed onto the throwing bracket.
   */
  test("the bracket retrieves, `get` answers, and `containsKey` asks", async () => {
    const main = await runMain(
      "let m: Map(Int, String) = Map.fromVector([(1, \"one\"), (2, \"two\")])\n" +
        "export let present: String = m[1]\n" +
        "export let held: Bool = Map.containsKey(m, 2)\n" +
        "export let absent: Bool = Map.containsKey(m, 9)\n" +
        "let describe(option: Option(String)): String =\n" +
        "    match option\n" +
        "        None => \"none\"\n" +
        "        Some(value) => value\n" +
        "export let found: String = describe(Map.get(m, 1))\n" +
        "export let missing: String = describe(Map.get(m, 9))\n" +
        "export fun boom(ignored: Int): String = m[9]\n",
    );
    expect(main["present"]).toBe("one");
    expect(main["held"]).toBe(true);
    expect(main["absent"]).toBe(false);
    expect(main["found"]).toBe("one");
    // The totality claim: an absent key is an answer, not a fault.
    expect(main["missing"]).toBe("none");
    expect(() => (main["boom"] as (ignored: number) => unknown)(0))
      .toThrowError(expect.objectContaining({ name: "KeyError", $hex: "Map" }));
  });
});

describe("§16 (e) upsert, forgiving removal, and §7.3's correspondence", () => {
  /**
   * §5.1: `Map.set` inserts or replaces and never throws — the stated break with
   * `Vector.set`, which asserts a slot that must already exist. §5.2: `remove`
   * of an absent key returns the collection *unchanged*, which is stronger than
   * "equal" and is asserted as identity.
   */
  test("set inserts and replaces; remove is forgiving and idempotent", async () => {
    const main = await runMain(
      "let m: Map(Int, String) = Map.fromVector([(1, \"one\"), (2, \"two\")])\n" +
        "export let inserted: Int = Map.size(Map.set(m, 3, \"three\"))\n" +
        "export let replaced: Int = Map.size(Map.set(m, 1, \"uno\"))\n" +
        "export let replacedValue: String = Map.set(m, 1, \"uno\")[1]\n" +
        "export let untouched: Map(Int, String) = Map.remove(m, 99)\n" +
        "export let original: Map(Int, String) = m\n" +
        "export let dropped: Int = Map.size(Map.remove(m, 1))\n" +
        "export let idempotent: Int = Map.size(Map.remove(Map.remove(m, 1), 1))\n" +
        "export let drained: Bool = Map.isEmpty(Map.remove(Map.remove(m, 1), 2))\n",
    );
    expect(main["inserted"]).toBe(3);
    expect(main["replaced"]).toBe(2);
    expect(main["replacedValue"]).toBe("uno");
    expect(main["dropped"]).toBe(1);
    expect(main["idempotent"]).toBe(1);
    expect(main["drained"]).toBe(true);
    // Unchanged means the same value, not an equal rebuild.
    expect(main["untouched"]).toBe(main["original"]);
  });

  /**
   * §7.3: at every position `i`, `entries` yields exactly the pair of the key
   * and value that `keys` and `values` yield at `i`. Free rather than arranged
   * — all three are `Seq` projections of one traversal — and the property is
   * asserted without naming an order, which is the only way §7.1 permits it.
   */
  test("keys, values, and entries correspond position for position", async () => {
    const main = await runMain(
      "let m: Map(Int, Int) = Map.fromVector([(1, 10), (2, 20), (3, 30), (4, 40)])\n" +
        "let paired(pair: (Int, Int)): Bool =\n" +
        "    let (key, value) = pair\n" +
        "    value == key * 10\n" +
        "export let everyPairMatches: Bool = Seq.all(Map.entries(m), paired)\n" +
        "let same(left: (Int, Int), right: (Int, Int)): Bool =\n" +
        "    let (leftKey, leftValue) = left\n" +
        "    let (rightKey, rightValue) = right\n" +
        "    leftKey == rightKey and leftValue == rightValue\n" +
        "let itself(value: Bool): Bool = value\n" +
        // `zip(keys, values)` against `entries`, which is §7.3 stated exactly.
        "let zipped: Seq((Int, Int)) = Seq.zip(Map.keys(m), Map.values(m))\n" +
        "export let corresponds: Bool =\n" +
        "    Seq.all(Seq.zipWith(zipped, Map.entries(m), same), itself)\n" +
        "export let zippedLength: Int = Seq.length(zipped)\n" +
        // Two traversals of one value agree; nothing is claimed of two values.
        "export let repeatable: Bool =\n" +
        "    Seq.all(Seq.zipWith(Map.entries(m), Map.entries(m), same), itself)\n" +
        "export let keySum: Int = Seq.fold(Map.keys(m), 0, (total, key) => total + key)\n" +
        "export let valueSum: Int = Seq.fold(Map.values(m), 0, (total, value) => total + value)\n",
    );
    expect(main["everyPairMatches"]).toBe(true);
    expect(main["corresponds"]).toBe(true);
    // `zipWith` stops at the shorter side, so the length travels with the
    // agreement — otherwise two empty traversals would agree vacuously.
    expect(main["zippedLength"]).toBe(4);
    expect(main["repeatable"]).toBe(true);
    expect(main["keySum"]).toBe(10);
    expect(main["valueSum"]).toBe(100);
  });

  /** §7.2: the tuple-of-binders loop head, which is a pattern position. */
  test("`for (k, v) in m` iterates the pairs", async () => {
    const main = await runMain(
      "let m: Map(Int, Int) = Map.fromVector([(1, 10), (2, 20), (3, 30)])\n" +
        "export fun run(ignored: Int): (Int, Int) =\n" +
        // `keySum`/`valueSum`, not `keys`/`values`: both are prelude names now,
        // and a `var` may not rebind one.
        "    var keySum = 0\n" +
        "    var valueSum = 0\n" +
        "    for (key, value) in m\n" +
        "        keySum := keySum + key\n" +
        "        valueSum := valueSum + value\n" +
        "    (keySum, valueSum)\n",
    );
    expect((main["run"] as (ignored: number) => unknown)(0)).toEqual([6, 60]);
  });
});

describe("§16 (i) the instances", () => {
  /**
   * §8.1's `Eq` is **extensional** — equal sizes, and every key of either maps
   * in both to `equals`-equal values. Order-independence is not arranged; it is
   * what the definition says, which is why two maps built in opposite orders are
   * equal without any canonicalization obligation on the runtime.
   *
   * §8.4's `Hash` is permutation-invariant, forced rather than chosen: the
   * public member is deterministic and unseeded while iteration order is seeded,
   * so an order-sensitive fold would make `hash(m)` a per-process value.
   */
  test("Eq is extensional and Hash is permutation-invariant", async () => {
    const main = await runMain(
      "let left: Map(Int, String) = Map.fromVector([(1, \"one\"), (2, \"two\")])\n" +
        "let right: Map(Int, String) = Map.fromVector([(2, \"two\"), (1, \"one\")])\n" +
        "let different: Map(Int, String) = Map.fromVector([(1, \"one\"), (2, \"TWO\")])\n" +
        "let shorter: Map(Int, String) = Map.singleton(1, \"one\")\n" +
        "export let equal: Bool = left == right\n" +
        "export let hashesAgree: Bool = hash(left) == hash(right)\n" +
        "export let valuesMatter: Bool = left == different\n" +
        "export let sizesMatter: Bool = left == shorter\n" +
        "export let emptiesAgree: Bool = Map.remove(shorter, 1) == Map.empty\n",
    );
    expect(main["equal"]).toBe(true);
    expect(main["hashesAgree"]).toBe(true);
    expect(main["valuesMatter"]).toBe(false);
    expect(main["sizesMatter"]).toBe(false);
    expect(main["emptiesAgree"]).toBe(true);
  });

  /**
   * The same two claims over generated key orders rather than one hand-picked
   * pair. The program is compiled once and driven many times, so what varies is
   * the *insertion order* — the only thing the two claims are about. The seed is
   * this file's own (`vitest.setup.ts`), never the suite's.
   */
  test("Eq and Hash ignore insertion order, over generated orders", async () => {
    const main = await runMain(
      "let build(a: Int, b: Int, c: Int): Map(Int, Int) =\n" +
        "    Map.fromVector([(a, a * 10), (b, b * 10), (c, c * 10)])\n" +
        "export fun agrees(a: Int, b: Int, c: Int): (Bool, Bool, Int) =\n" +
        "    let one = build(a, b, c)\n" +
        "    let other = build(c, a, b)\n" +
        "    (one == other, hash(one) == hash(other), Map.size(one))\n",
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
   * compare differently across runs. The diagnostic is the ordinary
   * unsatisfied-constraint one — §9's row says no bespoke message is owed.
   */
  test("there is no `Ord` instance for `Map`", () => {
    const messages = projectDiagnostics(
      "let a: Map(Int, Int) = Map.singleton(1, 1)\n" +
        "let b: Map(Int, Int) = Map.singleton(2, 2)\n" +
        "export let ordered: Bool = a < b\n",
    );
    expect(messages.join("\n")).toContain("Ord");
    expect(messages).not.toEqual([]);
  });

  /** §8.3: constructor-shaped display, `Map.empty` when empty. */
  test("Show renders the constructor form", async () => {
    const main = await runMain(
      "let blank: Map(Int, String) = Map.empty\n" +
        "let one: Map(Int, String) = Map.singleton(1, \"one\")\n" +
        "let two: Map(Int, String) = Map.fromVector([(1, \"one\"), (2, \"two\")])\n" +
        "export let shownEmpty: String = show(blank)\n" +
        "export let shownOne: String = show(one)\n" +
        "export let shownTwo: String = show(two)\n",
    );
    expect(main["shownEmpty"]).toBe("Map.empty");
    // `Show<String>` displays bare (Products §2.5), so the value is `one`, not
    // `"one"` — display, not serialization.
    expect(main["shownOne"]).toBe("Map.fromVector([(1, one)])");
    expect(shownElements(main["shownTwo"] as string, "Map.fromVector(")).toEqual([
      "(1, one)",
      "(2, two)",
    ]);
  });

  /**
   * §8.4's closing sentence: the instances make maps usable as map keys and set
   * elements themselves. This is the one assertion that exercises `Hash<Map>`
   * and `Eq<Map>` as *evidence* rather than as operators.
   */
  test("a map is usable as a set element and as a map key", async () => {
    const main = await runMain(
      "let one: Map(Int, Int) = Map.singleton(1, 1)\n" +
        "let alsoOne: Map(Int, Int) = Map.fromVector([(1, 1)])\n" +
        "let two: Map(Int, Int) = Map.singleton(2, 2)\n" +
        "let nested: Set(Map(Int, Int)) = Set.fromVector([one, alsoOne, two])\n" +
        "export let collapsed: Int = Set.size(nested)\n" +
        "export let held: Bool = Set.contains(nested, alsoOne)\n" +
        "let keyed: Map(Map(Int, Int), String) = Map.singleton(one, \"first\")\n" +
        "export let looked: String = Map.set(keyed, alsoOne, \"second\")[one]\n" +
        "export let stillOne: Int = Map.size(Map.set(keyed, alsoOne, \"second\"))\n",
    );
    // `one` and `alsoOne` are extensionally equal, so the set holds two.
    expect(main["collapsed"]).toBe(2);
    expect(main["held"]).toBe(true);
    // And they are one key: the second write replaces the first's value.
    expect(main["looked"]).toBe("second");
    expect(main["stillOne"]).toBe(1);
  });
});

describe("§16 (j) representative retention (§5.4)", () => {
  /**
   * The rule: **a stored key representative is never replaced by an
   * `equals`-equal newcomer**; values take last-wins. In v1 the only way to
   * observe it is a SameValueZero-equated `Float` pair, because `equals(-0.0,
   * 0.0)` is true while `1.0 / key` tells the two apart.
   *
   * The unplaced singleton is where the rule reads cleanly today: `singleton`
   * hashes nothing, so `set` at an `equals`-equal key compares the keys
   * directly, keeps the stored one, and replaces the value — exactly §5.4.
   */
  test("an `equals`-equal newcomer does not replace the stored key", async () => {
    const main = await runMain(
      "let m0: Map(Float, String) = Map.singleton(-0.0, \"a\")\n" +
        "let m1: Map(Float, String) = Map.set(m0, 0.0, \"b\")\n" +
        "export let counted: Int = Map.size(m1)\n" +
        "export let latest: String = m1[0.0]\n" +
        "let negative(total: Int, key: Float): Int =\n" +
        "    if 1.0 / key < 0.0 then total + 1 else total\n" +
        // `show` renders `-0` as "0", so the sign is read arithmetically.
        "export let negativeKeys: Int = Seq.fold(Map.keys(m1), 0, negative)\n",
    );
    expect(main["counted"]).toBe(1);
    // Value: last wins.
    expect(main["latest"]).toBe("b");
    // Key representative: first wins.
    expect(main["negativeKeys"]).toBe(1);
  });

  /**
   * The **placed** ±0 case, which §5.4 answers the same way as the unplaced one
   * above.
   *
   * `0.0 == -0.0` is `True` and the two hash alike, so they are one key however
   * the map stores it: a placed map navigating by the hash still arrives at the
   * resident entry, replaces its value, and keeps the `-0.0` representative it
   * already held.
   */
  test("±0 Float keys are one placed entry, and the first representative is kept", async () => {
    const main = await runMain(
      "let m0: Map(Float, String) = Map.set(Map.empty, -0.0, \"a\")\n" +
        "let m1: Map(Float, String) = Map.set(m0, 0.0, \"b\")\n" +
        "export let equated: Bool = -0.0 == 0.0\n" +
        "export let counted: Int = Map.size(m1)\n" +
        "export let latest: String = m1[0.0]\n" +
        "let negative(total: Int, key: Float): Int =\n" +
        "    if 1.0 / key < 0.0 then total + 1 else total\n" +
        "export let negativeKeys: Int = Seq.fold(Map.keys(m1), 0, negative)\n",
    );
    // The equality the law is stated over holds, and so does the hash.
    expect(main["equated"]).toBe(true);
    expect(main["counted"]).toBe(1);
    // Value: last wins.
    expect(main["latest"]).toBe("b");
    // Key representative: first wins.
    expect(main["negativeKeys"]).toBe(1);
  });
});

describe("the companion's surface", () => {
  /**
   * Method Syntax §1: the dot spelling and the qualified spelling are one call.
   * `Map`'s keyed trio is the first *constrained* companion operation in the
   * language, so this is where the two spellings could differ — a dot call that
   * dropped the evidence suffix would call the same function one argument short.
   */
  test("dot call and qualified call agree, evidence included", async () => {
    const main = await runMain(
      "let m: Map(Int, String) = Map.fromVector([(1, \"one\")])\n" +
        "export let dotted: Int = Map.size(m.set(2, \"two\"))\n" +
        "export let qualified: Int = Map.size(Map.set(m, 2, \"two\"))\n" +
        "let describe(option: Option(String)): String =\n" +
        "    match option\n" +
        "        None => \"none\"\n" +
        "        Some(value) => value\n" +
        "export let dottedGet: String = describe(m.get(1))\n" +
        "export let dottedRemove: Int = Map.size(m.remove(1))\n" +
        "export let dottedEmpty: Bool = m.isEmpty()\n" +
        "export let dottedHas: Bool = m.containsKey(1)\n",
    );
    expect(main["dotted"]).toBe(2);
    expect(main["qualified"]).toBe(2);
    expect(main["dottedGet"]).toBe("one");
    expect(main["dottedRemove"]).toBe(0);
    expect(main["dottedEmpty"]).toBe(false);
    expect(main["dottedHas"]).toBe(true);
  });

  /**
   * Modules §5.5, as ruled at the `Vector` landing and extended here: a bare
   * prelude name two members export is refused in favour of the qualified
   * spellings and dot call. `Map.hex` collides with `Seq.hex` and `Vector.hex`
   * on several names, and that is expected rather than a thing to rename around.
   */
  test("the bare collided names are refused, and the qualified ones answer", async () => {
    expect(projectDiagnostics("export let e: Map(Int, Int) = empty\n")).toEqual([
      // Four homes since #373 seated `Set.hex`, which exports `empty` too.
      "the prelude name `empty` is ambiguous: exported by `Seq`, `Vector`, " +
      "`Map`, and `Set`; write `Seq.empty`, `Vector.empty`, `Map.empty`, or " +
      "`Set.empty`",
    ]);
    const main = await runMain(
      "export let n: Int = Map.size(Map.singleton(1, 2))\n" +
        "export let v: Int = Vector.length(Vector.singleton(1))\n",
    );
    expect(main["n"]).toBe(1);
    expect(main["v"]).toBe(1);
  });

  /**
   * Every export carries a manual-voice doc comment, and the doc travels into
   * the emitted JavaScript as it does for every other prelude member. Read off
   * the compiled module rather than the file, so a comment that failed to attach
   * to its declaration would not pass.
   */
  test("every export is documented", () => {
    const project = compileFiles([[
      "/main.hex",
      "export let n: Int = Map.size(Map.singleton(1, 2))\n",
    ]]);
    expect(project.diagnostics).toEqual([]);
    const map = project.modules.find(({ source }) => source.path === "/Map.hex");
    expect(map).toBeDefined();
    const exported = map!.typed.items.flatMap((item) =>
      (item.kind === "Let" || item.kind === "Fun") && item.exported
        ? [item.binding.name]
        : item.kind === "ExternBlock"
        ? item.declarations.flatMap((declaration) =>
          declaration.exported ? [declaration.localName] : []
        )
        : []
    );
    expect(exported.sort()).toEqual([
      "containsKey",
      "empty",
      "entries",
      "fromEntries",
      "fromSeq",
      "fromVector",
      "get",
      "isEmpty",
      "keys",
      "remove",
      "set",
      "singleton",
      "size",
      "values",
    ]);
    const javascript = map!.javascript.text;
    for (const name of exported) {
      const index = javascript.indexOf(`const ${name} =`);
      expect(index).toBeGreaterThan(0);
      expect(javascript.slice(0, index)).toContain("*/");
    }
  });

  /**
   * The `.d.ts` face publishes the **unconstrained** surface and nothing else,
   * which is the ordinary rule for a constrained binding (Constraints §6.4: the
   * face is the specializations) applied to a constrained *intrinsic row* for
   * the first time.
   *
   * The rule is load-bearing rather than tidy here. A constrained row's ESM
   * export is the internal constrained name and its real arity carries the
   * trailing evidence, so a face rendered from the declared signature would
   * publish an export the module does not have under that name *and* promise it
   * one argument short — a clean compile that fails at the first JavaScript
   * call. `Hash` has no fundamental specializations, so the keyed rows are
   * simply absent, which is no worse than the surface they replaced: the
   * transitional core had no face for them either.
   */
  test("the `.d.ts` face carries the unconstrained surface only", () => {
    const project = compileFiles([[
      "/main.hex",
      "export let n: Int = Map.size(Map.singleton(1, 2))\n",
    ]]);
    expect(project.diagnostics).toEqual([]);
    const map = project.modules.find(({ source }) => source.path === "/Map.hex");
    const face = map!.declarations.text;
    const unconstrained = [
      "singleton",
      "size",
      "entries",
      "empty",
      "isEmpty",
      "keys",
      "values",
    ];
    for (const name of unconstrained) {
      expect(face).toMatch(new RegExp(`export declare (const|function) ${name}\\b`, "u"));
    }
    for (const name of ["get", "set", "remove", "containsKey", "fromEntries", "fromSeq", "fromVector"]) {
      expect(face).not.toMatch(new RegExp(`export declare (const|function) ${name}\\b`, "u"));
    }
    // The face is a face of the *emitted module*, so every name it publishes
    // must be an export the JavaScript actually has under that spelling.
    const javascript = map!.javascript.text;
    for (const name of unconstrained) {
      expect(javascript).toMatch(new RegExp(`export \\{[^}]*\\b${name}\\b[^}]*\\}`, "u"));
    }
  });

  /**
   * `KeyError` is the module's ordinary exported exception (§4.3), so a consumer
   * can name and throw it with no import — the owed prelude declaration, which
   * before this milestone existed only inside the emitter's bracket lowering.
   *
   * **The thrown value is pinned at what the compiler does today, not at what it
   * should be.** A *nullary* exception's reference is materialized by calling
   * its constructor, and the emitter recognizes only the ones this module
   * declares (`#nullaryExceptions` is built from the module's own items), so a
   * cross-module reference throws the constructor function itself. That is a
   * pre-existing defect rather than this step's: `stdlib/Seq.hex`'s
   * `ReentrancyError` is nullary too and behaves identically, and `Vector.hex`'s
   * two exceptions never showed it because both carry payloads.
   *
   * When it is fixed this assertion fails, and that failure is the point — flip
   * it to `objectContaining({ name: "KeyError", $hex: "Map" })`, which is what
   * the bracket's own throw already produces (the §16 (c) case above).
   */
  test("`KeyError` is nameable with no import (throw shape pinned; imported nullary defect)", async () => {
    const project = compileFiles([[
      "/main.hex",
      "export fun refuse(ignored: Int): Int = throw(KeyError)\n",
    ]]);
    expect(project.diagnostics).toEqual([]);
    const main = await runProject([[
      "/main.hex",
      "export fun refuse(ignored: Int): Int = throw(KeyError)\n",
    ]]);
    let thrown: unknown;
    try {
      (main["refuse"] as (ignored: number) => unknown)(0);
    } catch (error) {
      thrown = error;
    }
    // Today: the constructor, not an error built by it.
    expect(typeof thrown).toBe("function");
    expect((thrown as { name: string }).name).toBe("KeyError");
  });
});
