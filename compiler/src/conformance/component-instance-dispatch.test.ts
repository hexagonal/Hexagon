import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for `spec/products.md` §2.5's implementer note (issue #278): a
 * component means **its instance**.
 *
 * The defect was a second, silent derivation. The checker resolves every
 * component demand a `derives` raises — and reports when a component type has
 * no instance — but emission threw that selection away and re-walked the type
 * structurally, reaching into each nominal component's representation. A
 * hand-written `honor Ord<T>` on a field type was therefore *partially dead*:
 * `t1 < t2` consulted it and `container1 < container2` did not, and the two
 * silently disagreed. It read through `export opaque` for the same reason, and
 * imported the component's dictionary only to leave it unused.
 *
 * The rule is **always dispatch**: wherever the walk meets a nominal component,
 * emission calls that component type's instance dictionary — hand-written or
 * derived, same module or another. Three shortcuts stay inline because the
 * structural answer provably *is* the instance's answer: primitives, the `Bool`
 * representation pin (#147), and `Hash` (underivable by hand, and derivable
 * only alongside derived `Eq`, Collections Part 2 §4.3).
 *
 * Almost everything here **executes**, and every hand-written component
 * instance below is deliberately *perverse* — a reversed `compare`, an `equals`
 * that is constantly `False`, a `show` that answers `"LOUD"`. A structural
 * re-derivation cannot imitate any of them, so no assertion here can pass by
 * accident. The few shape assertions cover facts a program cannot observe about
 * itself: which dictionary a body names, and which shortcuts stayed inline.
 *
 * Every program is textually distinct on purpose: two programs whose emitted JS
 * is byte-identical share one `data:` URL module instance, so a copy of another
 * test's source would silently assert against that test's module.
 */

/** One module's emitted JavaScript, with the project's diagnostics asserted empty. */
function javascript(source: string, path = "/main.hex"): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === path)!.javascript.text;
}

/** The same for a multi-module project. */
function javascriptOf(
  files: readonly (readonly [string, string])[],
  path: string,
): string {
  const project = compileFiles(files);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === path)!.javascript.text;
}

/** A dictionary as JavaScript sees it across the FFI Part 9 boundary. */
type OrdDictionary = { readonly compare: (left: unknown, right: unknown) => unknown };
type EqDictionary = {
  readonly equals: (left: unknown, right: unknown) => unknown;
  readonly notEquals: (left: unknown, right: unknown) => unknown;
};

describe("the issue specimen: a container agrees with its field's own instance", () => {
  test("`Leg < Leg` is what `honor Ord<Metres>` says, not what its fields say", async () => {
    // Verbatim from #278. The honor reverses the order so the disagreement is
    // visible; with an agreeing honor the divergence is latent, not absent.
    const source =
      "export record Metres derives Eq = {span: Int}\n" +
      "honor Ord<Metres> =\n" +
      "    compare(left, right) = if left.span < right.span then Greater else if right.span < left.span then Less else Equal\n" +
      "export record Leg derives (Eq, Ord) = {distance: Metres}\n" +
      "export let legLt: Bool = Leg({distance = Metres({span = 1})}) < Leg({distance = Metres({span = 2})})\n" +
      "export let metresLt: Bool = Metres({span = 1}) < Metres({span = 2})\n";
    const module = await runMain(source);

    // The filed acceptance: the two answers agree. Both are `false`, because
    // the honor reverses; a structural re-derivation answered `true` for the
    // container and `false` for the field.
    expect(module.legLt).toBe(module.metresLt);
    expect(module.legLt).toBe(false);
  });

  test("the container's `compare` names the component's dictionary", () => {
    const emitted = javascript(
      "export record Metres2 derives Eq = {span: Int}\n" +
        "honor Ord<Metres2> =\n" +
        "    compare(left, right) = if left.span < right.span then Greater else if right.span < left.span then Less else Equal\n" +
        "export record Leg2 derives (Eq, Ord) = {distance: Metres2}\n",
    );

    expect(emitted).toContain("__Ord_Metres2.compare(__left.distance, __right.distance)");
    expect(emitted).toContain("__Eq_Metres2.equals(__left.distance, __right.distance)");
    // The defect itself, as a shape: the container never reads the field's
    // representation. `.span` appears only inside `Metres2`'s own instances.
    expect(emitted).not.toContain("__left.distance.span");
  });
});

describe("record fields", () => {
  test("`Eq`: a perverse hand-written `equals` decides the container", async () => {
    const module = await runMain(
      "export record Odd = {n: Int}\n" +
        "honor Eq<Odd> =\n" +
        "    equals(left, right) = False\n" +
        "export record Holder derives Eq = {part: Odd}\n" +
        "let one = Holder({part = Odd({n = 1})})\n" +
        "let alsoOne = Holder({part = Odd({n = 1})})\n" +
        "export let contained: Bool = one == alsoOne\n" +
        "export let direct: Bool = Odd({n = 1}) == Odd({n = 1})\n" +
        "export let containedNot: Bool = one != alsoOne\n",
    );

    // `equals` is constantly `False`, so structurally-identical values are not
    // equal — at the field *and* inside the container.
    expect(module.contained).toBe(module.direct);
    expect(module.direct).toBe(false);
    // `notEquals` on the container stays the negation of its own `equals`.
    expect(module.containedNot).toBe(true);
  });

  test("`Show`: the container shows its field through the field's `show`", async () => {
    const module = await runMain(
      "export record Loud = {n: Int}\n" +
        "honor Show<Loud> =\n" +
        "    show(value) = \"LOUD\"\n" +
        "export record Quiet derives Show = {part: Loud}\n" +
        "export let contained: String = \"${Quiet({part = Loud({n = 1})})}\"\n" +
        "export let direct: String = \"${Loud({n = 1})}\"\n",
    );

    expect(module.direct).toBe("LOUD");
    // Not `{part = {n = 1}}`, which is what re-deriving the field produced.
    expect(module.contained).toBe("{part = LOUD}");
  });

  test("`Ord`: the field's order decides, and equality still falls through to the next field", async () => {
    const module = await runMain(
      "export record Backwards derives Eq = {rank: Int}\n" +
        "honor Ord<Backwards> =\n" +
        "    compare(left, right) = if left.rank < right.rank then Greater else if right.rank < left.rank then Less else Equal\n" +
        "export record Pair derives (Eq, Ord) = {first: Backwards, second: Int}\n" +
        "let low = Backwards({rank = 1})\n" +
        "let high = Backwards({rank = 2})\n" +
        "export let byFirst: Bool = Pair({first = low, second = 0}) < Pair({first = high, second = 0})\n" +
        "export let bySecond: Bool = Pair({first = low, second = 0}) < Pair({first = low, second = 1})\n",
    );

    // Reversed at the first field: `low` sorts *after* `high`.
    expect(module.byFirst).toBe(false);
    // The container's own lexicographic composition is untouched: an `Equal`
    // from the dispatched component still moves on to the next field.
    expect(module.bySecond).toBe(true);
  });
});

describe("union payload slots", () => {
  test("`Eq`, `Ord` and `Show` all reach the slot type's instance", async () => {
    const module = await runMain(
      "export record Payload = {n: Int}\n" +
        "honor Eq<Payload> =\n" +
        "    equals(left, right) = False\n" +
        "honor Ord<Payload> =\n" +
        "    compare(left, right) = if left.n < right.n then Greater else if right.n < left.n then Less else Equal\n" +
        "honor Show<Payload> =\n" +
        "    show(value) = \"LOUD\"\n" +
        "union Wrapped derives (Eq, Ord, Show) = Empty | Full(content: Payload)\n" +
        "let small = Full(Payload({n = 1}))\n" +
        "let large = Full(Payload({n = 2}))\n" +
        "export let equalPayloads: Bool = small == Full(Payload({n = 1}))\n" +
        "export let smallFirst: Bool = small < large\n" +
        "export let largeFirst: Bool = large < small\n" +
        "export let tagOrder: Bool = Empty < small\n" +
        "export let shown: String = \"${small}\"\n",
    );

    expect(module.equalPayloads).toBe(false);
    // Reversed: the larger payload sorts first.
    expect(module.smallFirst).toBe(false);
    expect(module.largeFirst).toBe(true);
    // The union's own tag ordering is untouched — it precedes any slot.
    expect(module.tagOrder).toBe(true);
    expect(module.shown).toBe("Full(LOUD)");
  });
});

describe("direct structural use sites run the same walk", () => {
  test("`[m1] == [m2]` and `(m1, 2) == (m2, 2)` consult the element's `Eq`", async () => {
    const module = await runMain(
      "export record Never = {n: Int}\n" +
        "honor Eq<Never> =\n" +
        "    equals(left, right) = False\n" +
        "export let inVector: Bool = [Never({n = 1})] == [Never({n = 1})]\n" +
        "export let inTuple: Bool = (Never({n = 1}), 2) == (Never({n = 1}), 2)\n" +
        "let noneAtAll: Vector(Never) = []\n" +
        "let alsoNone: Vector(Never) = []\n" +
        "export let emptyVector: Bool = noneAtAll == alsoNone\n" +
        "export let plainTuple: Bool = (1, 2) == (1, 2)\n",
    );

    expect(module.inVector).toBe(false);
    expect(module.inTuple).toBe(false);
    // The mirror image: the structural machinery still answers `true` where
    // nothing perverse is reached, so the two above are not "always false".
    expect(module.emptyVector).toBe(true);
    expect(module.plainTuple).toBe(true);
  });

  test("a structural `Ord` and `Show` dispatch their components too", async () => {
    const module = await runMain(
      "export record Flip derives Eq = {rank: Int}\n" +
        "honor Ord<Flip> =\n" +
        "    compare(left, right) = if left.rank < right.rank then Greater else if right.rank < left.rank then Less else Equal\n" +
        "honor Show<Flip> =\n" +
        "    show(value) = \"FLIP\"\n" +
        "export let vectorLt: Bool = [Flip({rank = 1})] < [Flip({rank = 2})]\n" +
        "export let tupleLt: Bool = (Flip({rank = 1}), 0) < (Flip({rank = 2}), 0)\n" +
        "export let shownVector: String = \"${[Flip({rank = 1})]}\"\n" +
        "export let shownTuple: String = \"${(Flip({rank = 1}), 7)}\"\n",
    );

    expect(module.vectorLt).toBe(false);
    expect(module.tupleLt).toBe(false);
    expect(module.shownVector).toBe("[FLIP]");
    expect(module.shownTuple).toBe("(FLIP, 7)");
  });

  test("nested structural components recurse, carrying their own selection", async () => {
    const module = await runMain(
      "export record Deep = {n: Int}\n" +
        "honor Eq<Deep> =\n" +
        "    equals(left, right) = False\n" +
        "honor Show<Deep> =\n" +
        "    show(value) = \"DEEP\"\n" +
        "export let nested: Bool = [(Deep({n = 1}), 2)] == [(Deep({n = 1}), 2)]\n" +
        "export let shownNested: String = \"${[(Deep({n = 1}), 2)]}\"\n",
    );

    // `Vector((Deep, Int))`: the element's evidence is itself structural, and
    // its own first component is the nominal one.
    expect(module.nested).toBe(false);
    expect(module.shownNested).toBe("[(DEEP, 2)]");
  });

  test("a `Map`'s values are compared and shown by their own instance", async () => {
    const module = await runMain(
      "export record Val = {n: Int}\n" +
        "honor Eq<Val> =\n" +
        "    equals(left, right) = False\n" +
        "honor Show<Val> =\n" +
        "    show(value) = \"VAL\"\n" +
        "let one: Map(String, Val) = Map.set(Map.empty, \"a\", Val({n = 1}))\n" +
        "let other: Map(String, Val) = Map.set(Map.empty, \"a\", Val({n = 1}))\n" +
        "export let sameMap: Bool = one == other\n" +
        "export let shownMap: String = \"${one}\"\n",
    );

    expect(module.sameMap).toBe(false);
    expect(module.shownMap).toBe("Map.fromVector([(a, VAL)])");
  });
});

describe("across module boundaries and through `export opaque`", () => {
  const component =
    "export opaque record Metre derives Eq = {span: Int}\n" +
    "export fun metre(n: Int): Metre = Metre({span = n})\n" +
    "honor Ord<Metre> =\n" +
    "    compare(left, right) = if left.span < right.span then Greater else if right.span < left.span then Less else Equal\n" +
    "honor Show<Metre> =\n" +
    "    show(value) = \"LOUD\"\n";

  const container =
    "import { Metre, metre } from \"./metre\"\n" +
    "export record Journey derives (Eq, Ord, Show) = {leg: Metre}\n" +
    "export let shortFirst: Bool = Journey({leg = metre(1)}) < Journey({leg = metre(2)})\n" +
    "export let longFirst: Bool = Journey({leg = metre(2)}) < Journey({leg = metre(1)})\n" +
    "export let shown: String = \"${Journey({leg = metre(1)})}\"\n";

  test("the imported instance answers, and the representation is never touched", async () => {
    const module = await runProject([["/metre.hex", component], ["/main.hex", container]]);

    expect(module.shortFirst).toBe(false);
    expect(module.longFirst).toBe(true);
    expect(module.shown).toBe("{leg = LOUD}");
  });

  test("emission names the imported dictionary rather than the opaque representation", () => {
    const emitted = javascriptOf(
      [["/metre.hex", component], ["/main.hex", container]],
      "/main.hex",
    );

    // The import was already there before the fix — and dead (#278). It is now
    // the thing the derived bodies call.
    expect(emitted).toMatch(/__Ord_Metre\b/u);
    expect(emitted).toMatch(/__Eq_Metre\b/u);
    expect(emitted).toMatch(/__Show_Metre\b/u);
    // `span` is `Metre`'s private representation. A container in another module
    // must not be able to name it, and now does not.
    expect(emitted).not.toContain(".span");
  });
});

describe("the shape of a composed dictionary", () => {
  test("a parameterized component is applied to its own argument's evidence", async () => {
    const source =
      "export record Box(a) derives (Eq, Ord) = {item: a}\n" +
      "export record Span derives Eq = {units: Int}\n" +
      "honor Ord<Span> =\n" +
      "    compare(left, right) = if left.units < right.units then Greater else if right.units < left.units then Less else Equal\n" +
      "export record Crate derives (Eq, Ord) = {boxed: Box(Span)}\n" +
      "export let crateLt: Bool = Crate({boxed = Box({item = Span({units = 1})})}) < Crate({boxed = Box({item = Span({units = 2})})})\n";
    const emitted = javascript(source);
    const module = await runMain(source);

    // The factory, applied — not re-derived, and not passed unapplied.
    expect(emitted).toContain("__Ord_Box(__Ord_Span).compare(__left.boxed, __right.boxed)");
    // And behaviourally: the reversal survives two levels of composition.
    expect(module.crateLt).toBe(false);
  });

  test("the container's exported dictionary is composed with the component's", async () => {
    const module = await runMain(
      "export record Weight derives Eq = {grams: Int}\n" +
        "honor Ord<Weight> =\n" +
        "    compare(left, right) = if left.grams < right.grams then Greater else if right.grams < left.grams then Less else Equal\n" +
        "export record Parcel derives (Eq, Ord) = {mass: Weight}\n",
    );

    // The dictionary is a value the FFI boundary can hold, so the composition
    // is observable without any Hexagon expression standing in front of it.
    const ord = module.__Ord_Parcel as OrdDictionary;
    const eq = module.__Eq_Parcel as EqDictionary;
    expect(ord.compare({ mass: { grams: 1 } }, { mass: { grams: 2 } })).toBe("Greater");
    expect(ord.compare({ mass: { grams: 2 } }, { mass: { grams: 1 } })).toBe("Less");
    expect(ord.compare({ mass: { grams: 1 } }, { mass: { grams: 1 } })).toBe("Equal");
    expect(eq.equals({ mass: { grams: 1 } }, { mass: { grams: 1 } })).toBe(true);
    expect(eq.notEquals({ mass: { grams: 1 } }, { mass: { grams: 2 } })).toBe(true);
  });
});

describe("a component whose order is not its representation's order", () => {
  // `stdlib/Rat.hex`'s shape: `derives Eq` over a canonical pair, with a
  // hand-written cross-product `Ord`. The two disagree on 1/3 versus 1/2 —
  // cross-multiplication says `Less`, and comparing the fields in name order
  // (`bottom`, then `top`) says `Greater` — so this is the stdlib's own
  // exposure to #278, in a local specimen.
  const ratio =
    "export record Ratio derives Eq = {top: Int, bottom: Int}\n" +
    "honor Ord<Ratio> =\n" +
    "    compare(left, right) =\n" +
    "        let leftProduct = left.top * right.bottom\n" +
    "        let rightProduct = right.top * left.bottom\n" +
    "        if leftProduct < rightProduct then Less else if rightProduct < leftProduct then Greater else Equal\n";

  test("a field of that type sorts by the cross-product, not by the fields", async () => {
    const module = await runMain(
      ratio +
        "export record Reading derives (Eq, Ord) = {rate: Ratio}\n" +
        "let third = Ratio({top = 1, bottom = 3})\n" +
        "let half = Ratio({top = 1, bottom = 2})\n" +
        "export let direct: Bool = third < half\n" +
        "export let contained: Bool = Reading({rate = third}) < Reading({rate = half})\n",
    );

    expect(module.direct).toBe(true);
    // Field-lexicographic order would have said `false` here: same `top`, and
    // `bottom` 3 is greater than 2.
    expect(module.contained).toBe(module.direct);
    expect(module.contained).toBe(true);
  });

  test("a vector of that type sorts by the cross-product too", async () => {
    const module = await runMain(
      ratio.replace(/Ratio/gu, "Fraction") +
        "let third = Fraction({top = 1, bottom = 3})\n" +
        "let half = Fraction({top = 1, bottom = 2})\n" +
        "export let direct: Bool = third < half\n" +
        "export let inVector: Bool = [third] < [half]\n",
    );

    expect(module.direct).toBe(true);
    expect(module.inVector).toBe(true);
  });
});

describe("recursive subjects", () => {
  test("a self-referential component compiles to a self-referential dictionary", async () => {
    const source =
      "export record Node2 derives (Eq, Ord, Show) = {label: Int, kids: Vector(Node2)}\n" +
      "let leaf = Node2({label = 1, kids = []})\n" +
      "let branch = Node2({label = 1, kids = [leaf]})\n" +
      "export let sameLeaf: Bool = leaf == Node2({label = 1, kids = []})\n" +
      "export let leafBeforeBranch: Bool = leaf < branch\n" +
      "export let shownBranch: String = \"${branch}\"\n";
    const emitted = javascript(source);
    const module = await runMain(source);

    // Legal at module level: the reference is inside a function body, so it is
    // resolved at call time, not at initialization.
    expect(emitted).toContain("__Eq_Node2.equals(");
    expect(module.sameLeaf).toBe(true);
    expect(module.leafBeforeBranch).toBe(true);
    expect(module.shownBranch).toBe("{kids = [{kids = [], label = 1}], label = 1}");
  });

  test("a recursive parameterized union derives and runs", async () => {
    const module = await runMain(
      "union Tree(a) derives (Eq, Ord, Show) = Leaf | Branch(left: Tree(a), item: a, right: Tree(a))\n" +
        "let one: Tree(Int) = Branch(Leaf, 1, Leaf)\n" +
        "let two: Tree(Int) = Branch(Leaf, 2, Leaf)\n" +
        "export let same: Bool = one == one\n" +
        "export let different: Bool = one == two\n" +
        "export let ordered: Bool = one < two\n" +
        "export let shown: String = \"${one}\"\n",
    );

    expect(module.same).toBe(true);
    expect(module.different).toBe(false);
    expect(module.ordered).toBe(true);
    expect(module.shown).toBe("Branch(Leaf, 1, Leaf)");
  });
});

describe("the licensed shortcuts stay inline", () => {
  test("`Bool` components keep the pinned representation, with no dictionary", () => {
    const emitted = javascript(
      "export record Switch derives (Eq, Ord, Show) = {on: Bool}\n",
    );

    // #147's pin: the value *is* the JavaScript boolean, and `False < True`
    // falls out of it. A dictionary here would drag `Bool`'s four instances
    // into the emitted JavaScript of nearly every module.
    expect(emitted).toContain("__left.on === __right.on");
    expect(emitted).toContain('__left.on === __right.on ? "Equal" : __right.on ? "Less" : "Greater"');
    expect(emitted).toContain('(__value.on ? "True" : "False")');
    expect(emitted).not.toContain("__Eq_Bool");
    expect(emitted).not.toContain("__Ord_Bool");
    expect(emitted).not.toContain("__Show_Bool");
  });

  test("primitive components keep their inline leaf arms", () => {
    const emitted = javascript(
      "export record Sample derives (Eq, Ord, Show) = {count: Int, name: String, ratio: Float}\n",
    );

    expect(emitted).toContain("__left.count === __right.count");
    expect(emitted).toContain('__left.count < __right.count ? "Less"');
    expect(emitted).toContain("__compareString(__left.name, __right.name)");
    expect(emitted).toContain("__floatEquals(__left.ratio, __right.ratio)");
    expect(emitted).toContain('"count = " + String(__value.count)');
  });

  test("a ground primitive comparison still takes the #275 fast path", () => {
    const emitted = javascript("export let ordered: Bool = 1 < 2\n");

    // No dictionary stands between the comparator and its consumer, so the
    // sign is consumed where it is made (#275, §5.1's codegen note).
    expect(emitted).toContain("const ordered = 1 < 2;");
    expect(emitted).not.toContain("compare");
  });
});

describe("`Hash` keeps its structural walk, and the law with it", () => {
  test("equal container values hash equal, so a set collapses them", async () => {
    const module = await runMain(
      "export record Cell derives (Eq, Hash) = {value: Int}\n" +
        "export record Row derives (Eq, Hash) = {cell: Cell, tag: String}\n" +
        "let first = Row({cell = Cell({value = 1}), tag = \"a\"})\n" +
        "let second = Row({cell = Cell({value = 1}), tag = \"a\"})\n" +
        "let third = Row({cell = Cell({value = 2}), tag = \"a\"})\n" +
        "let rows: Set(Row) = Set.add(Set.add(Set.add(Set.empty, first), second), third)\n" +
        "export let equalRows: Bool = first == second\n" +
        "export let size: Int = Set.size(rows)\n" +
        "export let member: Bool = Set.contains(rows, Row({cell = Cell({value = 2}), tag = \"a\"}))\n",
    );

    // `Eq` now dispatches into `Cell`'s instance while `Hash` still walks the
    // representation. That stays coherent because `Hash` cannot be hand-written
    // and requires derived `Eq`, so every type under a `Hash` subject has
    // structural equality by construction.
    expect(module.equalRows).toBe(true);
    expect(module.size).toBe(2);
    expect(module.member).toBe(true);
  });
});
