import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

/**
 * Conformance for the one `Ordering` representation (issue #275,
 * `spec/operators-logic-precedence.md` §5.1).
 *
 * The defect was two representations meeting at a dictionary slot. `a < b`
 * lowered to `compare(a, b) < 0` — a *sign* test — while `Ord.compare` is
 * `(a, a) -> Ordering`, and `Ordering = Less | Equal | Greater` is an
 * all-nullary union, so a hand-written `honor Ord<T>` returns the Unions §6.2
 * name-strings. `"Less" < 0` is `false`, and so was `"Greater" > 0`: the
 * specimen below compiled with zero diagnostics and exported `false` for every
 * comparison. Derived instances escaped only because they emitted a *numeric*
 * comparator into the same slot — the other half of the nonconformance, and the
 * reason the two kinds of instance could not be mixed.
 *
 * §5.1 settles it: the relational four are **constructor tests** on an
 * `Ordering`, never sign tests, and every `compare` slot — derived,
 * hand-written, structural, primitive — holds a function returning `Ordering`.
 * Numeric comparators survive only as fast-path internals whose result is
 * consumed in the same expression and never crosses a dictionary or FFI
 * boundary.
 *
 * Almost everything here **executes**, because that is the only thing the
 * defect could not survive: it type-checked perfectly. The two shape pins are
 * for facts a program cannot observe about itself (the `Unit` slot's constant,
 * the primitive comparator's wrapper).
 *
 * Every program below is textually distinct on purpose: two programs whose
 * emitted JS is byte-identical share one `data:` URL module instance, so a copy
 * of another test's source would silently assert against that test's module.
 */

/** The three values a conforming `compare` slot may return. */
const ORDERINGS = ["Less", "Equal", "Greater"];

/** A dictionary as JS sees it across the FFI Part 9 boundary. */
type OrdDictionary = { readonly compare: (left: unknown, right: unknown) => unknown };

function javascript(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

describe("the issue specimen: a hand-written `honor Ord` answers the operators", () => {
  test("`<` and `>` are what the hand-written `compare` says", async () => {
    // Verbatim from #275, plus the export the issue's reporter did not need.
    const module = await runMain(
      "export record Meters derives Eq = {value: Int}\n" +
        "honor Ord<Meters> =\n" +
        "    compare(left, right) =\n" +
        "        if left.value < right.value then Less else if right.value < left.value then Greater else Equal\n" +
        "let one = Meters({value = 1})\n" +
        "let two = Meters({value = 2})\n" +
        "export let lt: Bool = one < two\n" +
        "export let gt: Bool = two > one\n" +
        "export let ltReversed: Bool = two < one\n" +
        "export let gtReversed: Bool = one > two\n",
    );

    expect(module.lt).toBe(true);
    expect(module.gt).toBe(true);
    // The mirror image matters as much: a lowering that answered `true`
    // unconditionally would pass the two assertions above.
    expect(module.ltReversed).toBe(false);
    expect(module.gtReversed).toBe(false);
  });

  test("`<=` and `>=` are the negated constructor tests, including at equality", async () => {
    const module = await runMain(
      "export record Grams derives Eq = {mass: Int}\n" +
        "honor Ord<Grams> =\n" +
        "    compare(left, right) =\n" +
        "        if left.mass < right.mass then Less else if right.mass < left.mass then Greater else Equal\n" +
        "let light = Grams({mass = 1})\n" +
        "let heavy = Grams({mass = 2})\n" +
        "let alsoLight = Grams({mass = 1})\n" +
        "export let lessOrEqual: Bool = light <= heavy\n" +
        "export let greaterOrEqual: Bool = heavy >= light\n" +
        "export let lessOrEqualReversed: Bool = heavy <= light\n" +
        "export let greaterOrEqualReversed: Bool = light >= heavy\n" +
        "export let equalIsLessOrEqual: Bool = light <= alsoLight\n" +
        "export let equalIsGreaterOrEqual: Bool = light >= alsoLight\n" +
        "export let equalIsNotLess: Bool = light < alsoLight\n",
    );

    expect(module.lessOrEqual).toBe(true);
    expect(module.greaterOrEqual).toBe(true);
    expect(module.lessOrEqualReversed).toBe(false);
    expect(module.greaterOrEqualReversed).toBe(false);
    // `<=` is `!= Greater` and `>=` is `!= Less`, so `Equal` satisfies both —
    // and `<` still refuses it.
    expect(module.equalIsLessOrEqual).toBe(true);
    expect(module.equalIsGreaterOrEqual).toBe(true);
    expect(module.equalIsNotLess).toBe(false);
  });

  test("the shipped `honor Ord<Rat>` shape orders correctly", async () => {
    // `stdlib/Rat.hex` has exactly this body, so `rat1 < rat2` was `false`
    // for every pair of rationals in the shipped library.
    const module = await runMain(
      "export record Fraction derives Eq = {top: Int, bottom: Int}\n" +
        "honor Ord<Fraction> =\n" +
        "    compare(left, right) =\n" +
        "        let leftProduct = left.top * right.bottom\n" +
        "        let rightProduct = right.top * left.bottom\n" +
        "        if leftProduct < rightProduct then\n" +
        "            Less\n" +
        "        else\n" +
        "            if leftProduct > rightProduct then\n" +
        "                Greater\n" +
        "            else\n" +
        "                Equal\n" +
        "let half = Fraction({top = 1, bottom = 2})\n" +
        "let twoThirds = Fraction({top = 2, bottom = 3})\n" +
        "export let ordered: Bool = half < twoThirds\n" +
        "export let orderedBack: Bool = twoThirds < half\n",
    );

    expect(module.ordered).toBe(true);
    expect(module.orderedBack).toBe(false);
  });
});

describe("derived instances answer in the same representation", () => {
  test("a derived record `Ord` orders field-name-lexicographically", async () => {
    const module = await runMain(
      "export record Reading derives (Eq, Ord) = {level: Int, name: String}\n" +
        "let first = Reading({level = 1, name = \"z\"})\n" +
        "let second = Reading({level = 2, name = \"a\"})\n" +
        "export let byLevel: Bool = first < second\n" +
        "export let byLevelBack: Bool = second < first\n" +
        "export let atLeast: Bool = second >= first\n",
    );

    // Fields compare in name order — `level` before `name` — so `level` decides.
    expect(module.byLevel).toBe(true);
    expect(module.byLevelBack).toBe(false);
    expect(module.atLeast).toBe(true);
  });

  test("an all-nullary union derives declaration order, not alphabetical order", async () => {
    // Unions §7's implementer note for the §6.2 string case, and the reason
    // the tag comparison goes
    // through a declaration-index table rather than JS `<` on the strings the
    // constructors *are*: alphabetically `Blue < Green < Red`, which is the
    // exact reverse of what the declaration says.
    const module = await runMain(
      "export union Colour derives (Eq, Ord, Show) =\n" +
        "    | Red\n" +
        "    | Green\n" +
        "    | Blue\n" +
        "export let redBeforeGreen: Bool = Red < Green\n" +
        "export let greenBeforeBlue: Bool = Green < Blue\n" +
        "export let blueIsGreatest: Bool = Blue > Red\n" +
        "export let notAlphabetical: Bool = Blue < Green\n" +
        "export let selfIsNotLess: Bool = Green < Green\n" +
        "export let selfIsAtMost: Bool = Green <= Green\n",
    );

    expect(module.redBeforeGreen).toBe(true);
    expect(module.greenBeforeBlue).toBe(true);
    expect(module.blueIsGreatest).toBe(true);
    expect(module.notAlphabetical).toBe(false);
    expect(module.selfIsNotLess).toBe(false);
    expect(module.selfIsAtMost).toBe(true);
  });

  test("a union with payloads orders by constructor first, then payload", async () => {
    const module = await runMain(
      "export union Step derives (Eq, Ord) =\n" +
        "    | Halt\n" +
        "    | Move(distance: Int)\n" +
        "export let haltFirst: Bool = Halt < Move(0)\n" +
        "export let byPayload: Bool = Move(1) < Move(2)\n" +
        "export let byPayloadBack: Bool = Move(2) < Move(1)\n" +
        "export let sameHalt: Bool = Halt <= Halt\n",
    );

    expect(module.haltFirst).toBe(true);
    expect(module.byPayload).toBe(true);
    expect(module.byPayloadBack).toBe(false);
    expect(module.sameHalt).toBe(true);
  });
});

describe("derivation composes with a hand-written instance", () => {
  test("a parameterized derived `Ord` calls the hand-written slot it is given", async () => {
    // The composition the defect broke in both directions at once: the derived
    // `compare` received `"Less"` from the hand-written one and compared it to
    // a number. `Box(a)`'s field is the type *variable*, so this is the one
    // record shape whose derived comparison genuinely delegates.
    const module = await runMain(
      "export record Metres derives Eq = {span: Int}\n" +
        "honor Ord<Metres> =\n" +
        "    compare(left, right) =\n" +
        "        if left.span < right.span then Less else if right.span < left.span then Greater else Equal\n" +
        "export record Box(a) derives (Eq, Ord) = {item: a}\n" +
        "let small: Box(Metres) = Box({item = Metres({span = 1})})\n" +
        "let large: Box(Metres) = Box({item = Metres({span = 2})})\n" +
        "export let boxed: Bool = small < large\n" +
        "export let boxedBack: Bool = large < small\n" +
        "export let boxedAtMost: Bool = small <= large\n",
    );

    expect(module.boxed).toBe(true);
    expect(module.boxedBack).toBe(false);
    expect(module.boxedAtMost).toBe(true);
  });

  test("a `Vector` of hand-written-`Ord` values compares element by element", async () => {
    // The vector arm also had to stop returning a length *difference* — an
    // arbitrary-magnitude number that was never a valid `Ordering`.
    const module = await runMain(
      "export record Kilos derives Eq = {load: Int}\n" +
        "honor Ord<Kilos> =\n" +
        "    compare(left, right) =\n" +
        "        if left.load < right.load then Less else if right.load < left.load then Greater else Equal\n" +
        "export record Bag(a) derives (Eq, Ord) = {items: Vector(a)}\n" +
        "let lighter: Bag(Kilos) = Bag({items = [Kilos({load = 1}), Kilos({load = 9})]})\n" +
        "let heavier: Bag(Kilos) = Bag({items = [Kilos({load = 2})]})\n" +
        "let prefix: Bag(Kilos) = Bag({items = [Kilos({load = 1})]})\n" +
        "let longer: Bag(Kilos) = Bag({items = [Kilos({load = 1}), Kilos({load = 0})]})\n" +
        "export let firstElementDecides: Bool = lighter < heavier\n" +
        "export let firstElementDecidesBack: Bool = heavier < lighter\n" +
        "export let shorterPrefixIsLess: Bool = prefix < longer\n" +
        "export let longerIsNotLess: Bool = longer < prefix\n",
    );

    // Element 0 decides even though the shorter vector wins on length.
    expect(module.firstElementDecides).toBe(true);
    expect(module.firstElementDecidesBack).toBe(false);
    // With every shared element `Equal`, length breaks the tie.
    expect(module.shorterPrefixIsLess).toBe(true);
    expect(module.longerIsNotLess).toBe(false);
  });
});

describe("the dictionary-passing path", () => {
  test("a generic `<=` works at a hand-written and at a derived instance", async () => {
    // `least` sees only a dictionary, so this is the path with no fast path to
    // fall back on: before the fix it returned `y` for every input, at every
    // instantiation, because `"Less" <= 0` is `false`.
    const module = await runMain(
      "export let least<a: Ord>(x: a, y: a): a = if x <= y then x else y\n" +
        "export record Volts derives Eq = {charge: Int}\n" +
        "honor Ord<Volts> =\n" +
        "    compare(left, right) =\n" +
        "        if left.charge < right.charge then Less else if right.charge < left.charge then Greater else Equal\n" +
        "export record Ohms derives (Eq, Ord) = {resistance: Int}\n" +
        "export let handWritten: Volts = least(Volts({charge = 7}), Volts({charge = 3}))\n" +
        "export let handWrittenBack: Volts = least(Volts({charge = 3}), Volts({charge = 7}))\n" +
        "export let derived: Ohms = least(Ohms({resistance = 5}), Ohms({resistance = 2}))\n" +
        "export let derivedBack: Ohms = least(Ohms({resistance = 2}), Ohms({resistance = 5}))\n",
    );

    expect(module.handWritten).toEqual({ charge: 3 });
    expect(module.handWrittenBack).toEqual({ charge: 3 });
    expect(module.derived).toEqual({ resistance: 2 });
    expect(module.derivedBack).toEqual({ resistance: 2 });
  });

  test("a chained comparison short-circuits through a dictionary", async () => {
    const module = await runMain(
      "export union Rank derives (Eq, Ord) =\n" +
        "    | Low\n" +
        "    | Mid\n" +
        "    | High\n" +
        "export let ascending: Bool = Low < Mid < High\n" +
        "export let brokenAtTheFirstStep: Bool = Mid < Low < High\n" +
        "export let brokenAtTheSecondStep: Bool = Low < High < Mid\n" +
        "export let loosely: Bool = Low <= Mid <= Mid\n",
    );

    expect(module.ascending).toBe(true);
    expect(module.brokenAtTheFirstStep).toBe(false);
    expect(module.brokenAtTheSecondStep).toBe(false);
    expect(module.loosely).toBe(true);
  });

  test("`Bool` reaches the generic path as a structural dictionary", async () => {
    // The #147 pin keeps the *operator* on `Bool` a native comparison, but a
    // generic call site still builds a dictionary, and its `compare` owes an
    // `Ordering` like every other. `False | True` is the declaration order.
    const module = await runMain(
      "export let smaller<a: Ord>(x: a, y: a): a = if x < y then x else y\n" +
        "export let ofFalseTrue: Bool = smaller(False, True)\n" +
        "export let ofTrueFalse: Bool = smaller(True, False)\n" +
        "export let ofTrueTrue: Bool = smaller(True, True)\n" +
        "export let direct: Bool = False < True\n",
    );

    expect(module.ofFalseTrue).toBe(false);
    expect(module.ofTrueFalse).toBe(false);
    expect(module.ofTrueTrue).toBe(true);
    expect(module.direct).toBe(true);
  });
});

describe("one representation, observable from JS (FFI Part 9)", () => {
  test("a hand-written and a derived exported dictionary answer with the same three strings", async () => {
    const module = await runMain(
      "export record Yards derives Eq = {run: Int}\n" +
        "honor Ord<Yards> =\n" +
        "    compare(left, right) =\n" +
        "        if left.run < right.run then Less else if right.run < left.run then Greater else Equal\n" +
        "export record Feet derives (Eq, Ord) = {step: Int}\n" +
        "export let anchor: Yards = Yards({run = 1})\n" +
        "export let anchorFeet: Feet = Feet({step = 1})\n",
    );

    const written = module["__hex_instance_Ord_Yards"] as OrdDictionary;
    const derived = module["__hex_instance_Ord_Feet"] as OrdDictionary;

    expect(written.compare({ run: 1 }, { run: 2 })).toBe("Less");
    expect(written.compare({ run: 2 }, { run: 1 })).toBe("Greater");
    expect(written.compare({ run: 1 }, { run: 1 })).toBe("Equal");
    // The whole point of the fix: the derived slot is indistinguishable.
    expect(derived.compare({ step: 1 }, { step: 2 })).toBe("Less");
    expect(derived.compare({ step: 2 }, { step: 1 })).toBe("Greater");
    expect(derived.compare({ step: 1 }, { step: 1 })).toBe("Equal");
  });

  test("every derived slot shape returns one of the three, never a number", async () => {
    // One assertion per arm of the derived comparison: primitive leaf, `Float`
    // and `String` comparators, `Bool`, `Vector` (element and length), the
    // all-nullary tag table, and a payload union's tag-then-payload path.
    const module = await runMain(
      "export union Suit derives (Eq, Ord) =\n" +
        "    | Clubs\n" +
        "    | Spades\n" +
        "export union Card derives (Eq, Ord) =\n" +
        "    | Joker\n" +
        "    | Pip(rank: Int)\n" +
        "export record Hand derives (Eq, Ord) = " +
        "{flags: Vector(Bool), label: String, score: Float, seat: Int}\n" +
        "export let dealt: Hand = " +
        "Hand({flags = [True], label = \"n\", score = 1.0, seat = 1})\n",
    );

    const suit = module["__hex_instance_Ord_Suit"] as OrdDictionary;
    const card = module["__hex_instance_Ord_Card"] as OrdDictionary;
    const hand = module["__hex_instance_Ord_Hand"] as OrdDictionary;
    const left = { flags: [false], label: "a", score: 1.0, seat: 1 };

    expect(suit.compare("Clubs", "Spades")).toBe("Less");
    expect(suit.compare("Spades", "Spades")).toBe("Equal");
    expect(card.compare({ tag: "Joker" }, { tag: "Pip", rank: 0 })).toBe("Less");
    expect(card.compare({ tag: "Pip", rank: 2 }, { tag: "Pip", rank: 1 })).toBe("Greater");
    expect(card.compare({ tag: "Joker" }, { tag: "Joker" })).toBe("Equal");
    // `flags` sorts first by field name, so each probe below moves exactly one
    // field away from `left` and the earlier fields stay equal.
    expect(hand.compare(left, { ...left, flags: [true] })).toBe("Less");
    expect(hand.compare(left, { ...left, flags: [false, false] })).toBe("Less");
    expect(hand.compare(left, { ...left, label: "b" })).toBe("Less");
    expect(hand.compare(left, { ...left, score: 2.0 })).toBe("Less");
    expect(hand.compare(left, { ...left, seat: 0 })).toBe("Greater");
    expect(hand.compare(left, { ...left })).toBe("Equal");
    for (const probe of [left, { ...left, label: "b" }, { ...left, seat: 0 }]) {
      expect(ORDERINGS).toContain(hand.compare(left, probe));
    }
  });

  test("the `Unit` slot's constant is `\"Equal\"`, and `<=` tests it as a constructor", async () => {
    // #159 makes `Unit` the arity-0 tuple, whose structural comparison has no
    // components to compare. The constant used to be `0`; a slot may not hand a
    // number to a caller expecting an `Ordering`.
    const source = "export let unitOrder: Bool = () <= ()\n" +
      "export let unitStrict: Bool = () < ()\n";
    const module = await runMain(source);

    expect(module.unitOrder).toBe(true);
    expect(module.unitStrict).toBe(false);
    expect(javascript(source)).toContain(
      'const unitOrder = ({ compare: (__hex_left, __hex_right) => "Equal" })' +
        '.compare(undefined, undefined) !== "Greater";',
    );
  });

  test("the primitive `Ord` dictionary wraps its comparator rather than leaking the sign", async () => {
    // The primitive dictionary is built inline, and a *ground* call of a
    // constrained function is specialized away before one is needed — so the
    // route to it is a parameterized instance applied at a primitive, where the
    // argument is a real dictionary whose slot the derived body calls. That is
    // also why this test pins a shape: no program can name the dictionary.
    // The comparators themselves are untouched; `ordering` is the only new step.
    const source = "export record Cell(a) derives (Eq, Ord) = {item: a}\n" +
      "export let fractional: Bool = Cell({item = 1.5}) < Cell({item = 2.5})\n" +
      "export let textual: Bool = Cell({item = \"b\"}) <= Cell({item = \"a\"})\n" +
      "export let whole: Bool = Cell({item = 2}) > Cell({item = 1})\n";
    const module = await runMain(source);

    expect(module.fractional).toBe(true);
    expect(module.textual).toBe(false);
    expect(module.whole).toBe(true);

    const text = javascript(source);

    expect(text).toContain(
      "compare: (__hex_a, __hex_b) => __hex_ordering(__hex_compareFloat(__hex_a, __hex_b))",
    );
    expect(text).toContain(
      "compare: (__hex_a, __hex_b) => __hex_ordering(__hex_compareString(__hex_a, __hex_b))",
    );
    expect(text).toContain(
      'compare: (__hex_a, __hex_b) => __hex_a < __hex_b ? "Less" : __hex_a > __hex_b ? "Greater" : "Equal"',
    );
    expect(text).toContain(
      'function __hex_ordering(__hex_sign) {\n' +
        '  return __hex_sign < 0 ? "Less" : __hex_sign > 0 ? "Greater" : "Equal";\n' +
        "}",
    );
    // The comparators keep their own bodies, sign and all.
    expect(text).toContain("  if (Number.isNaN(__hex_left)) return Number.isNaN(__hex_right) ? 0 : 1;");
  });
});

describe("what the change does not touch", () => {
  test("`compareFloat`'s total order survives the trip through a dictionary", async () => {
    // NaN is the greatest `Float` and equals itself, so `compare` is total —
    // the property that makes `Ord<Float>` lawful at all. `Slot(Float)` is what
    // reaches the primitive dictionary: a *ground* call of a constrained
    // function is specialized to the inline fast path instead, so the last two
    // exports below deliberately test the other route rather than this one.
    const module = await runMain(
      "export record Slot(a) derives (Eq, Ord) = {held: a}\n" +
        "export let lower<a: Ord>(x: a, y: a): a = if x <= y then x else y\n" +
        "export let notANumber: Float = 0.0 / 0.0\n" +
        "export let nanIsGreatest: Bool = Slot({held = notANumber}) < Slot({held = 1.0})\n" +
        "export let oneIsLess: Bool = Slot({held = 1.0}) < Slot({held = notANumber})\n" +
        "export let nanEqualsItself: Bool = " +
        "Slot({held = notANumber}) <= Slot({held = notANumber})\n" +
        "export let nanIsNotBelowItself: Bool = " +
        "Slot({held = notANumber}) < Slot({held = notANumber})\n" +
        "export let ordinary: Bool = Slot({held = 1.5}) < Slot({held = 2.5})\n" +
        "export let specializedNan: Float = lower(notANumber, 1.0)\n" +
        "export let specializedOrdinary: Float = lower(2.5, 1.5)\n",
    );

    expect(module.nanIsGreatest).toBe(false);
    expect(module.oneIsLess).toBe(true);
    expect(module.nanEqualsItself).toBe(true);
    expect(module.nanIsNotBelowItself).toBe(false);
    expect(module.ordinary).toBe(true);
    // The specialized path answers identically, which is the whole claim that
    // lets it stay numeric.
    expect(module.specializedNan).toBe(1.0);
    expect(module.specializedOrdinary).toBe(1.5);
  });

  test("`compareString` still orders by codepoint through a dictionary", async () => {
    // The astral pair is the codepoint-vs-code-unit trap (Primitive Types §5):
    // JS `<` on the strings would put "\u{1D400}" before "\uFFFD". As above,
    // `Token(String)` is the route to the primitive dictionary; the `smallest`
    // calls are the specialized fast path, kept here to show they agree.
    const module = await runMain(
      "export record Token(a) derives (Eq, Ord) = {text: a}\n" +
        "export let smallest<a: Ord>(x: a, y: a): a = if x <= y then x else y\n" +
        "export let shorterIsLess: Bool = Token({text = \"ab\"}) < Token({text = \"abc\"})\n" +
        "export let earlierIsLess: Bool = Token({text = \"apple\"}) < Token({text = \"banana\"})\n" +
        "export let astralIsGreater: Bool = " +
        "Token({text = \"\\u{1D400}\"}) < Token({text = \"\\u{FFFD}\"})\n" +
        "export let specializedShorter: String = smallest(\"ab\", \"abc\")\n" +
        "export let specializedAstral: String = smallest(\"\\u{1D400}\", \"\\u{FFFD}\")\n",
    );

    expect(module.shorterIsLess).toBe(true);
    expect(module.earlierIsLess).toBe(true);
    expect(module.astralIsGreater).toBe(false);
    expect(module.specializedShorter).toBe("ab");
    expect(module.specializedAstral).toBe("\u{FFFD}");
  });

  test("`Eq` on `Float` keeps SameValueZero, on both the fast and the dictionary path", async () => {
    // Decisions Batch §1: `==` goes through `Eq`, never through `compare`, and
    // this change touched no `Eq` path. `NaN == NaN` is `True` and
    // `0.0 == -0.0` is `True` — neither is what `compareFloat` would say if
    // equality were rerouted through ordering.
    const module = await runMain(
      "export let alike<a: Eq>(x: a, y: a): Bool = x == y\n" +
        "export let unalike<a: Eq>(x: a, y: a): Bool = x != y\n" +
        "export let notANumber: Float = 0.0 / 0.0\n" +
        "export let nanIsItself: Bool = notANumber == notANumber\n" +
        "export let signedZerosAgree: Bool = 0.0 == -0.0\n" +
        "export let nanIsItselfGenerically: Bool = alike(notANumber, notANumber)\n" +
        "export let signedZerosAgreeGenerically: Bool = alike(0.0, -0.0)\n" +
        "export let nanDiffers: Bool = unalike(notANumber, notANumber)\n" +
        "export let nanIsNotLess: Bool = notANumber < notANumber\n",
    );

    expect(module.nanIsItself).toBe(true);
    expect(module.signedZerosAgree).toBe(true);
    expect(module.nanIsItselfGenerically).toBe(true);
    expect(module.signedZerosAgreeGenerically).toBe(true);
    expect(module.nanDiffers).toBe(false);
    // And ordering still disagrees with equality nowhere: NaN is not below
    // itself under the total order either.
    expect(module.nanIsNotLess).toBe(false);
  });

  test("the primitive fast path stays a native comparison, sign test and all", () => {
    // §5.1's codegen fast path: with no dictionary between the comparator and
    // its consumer, the sign never becomes an observable `compare` result, so
    // `Int` compares with the JS operator and `Float` with a sign test.
    const text = javascript(
      "export let cheap: Bool = 1 < 2\n" +
        "export let cheapFloat: Bool = 1.0 < 2.0\n" +
        "export let cheapText: Bool = \"a\" < \"b\"\n" +
        "export let cheapBool: Bool = False < True\n",
    );

    expect(text).toContain("const cheap = 1 < 2;");
    expect(text).toContain("const cheapFloat = __hex_compareFloat(1.0, 2.0) < 0;");
    expect(text).toContain('const cheapText = __hex_compareString("a", "b") < 0;');
    expect(text).toContain("const cheapBool = false < true;");
    // No dictionary was built for any of them.
    expect(text).not.toContain(".compare(");
  });
});
