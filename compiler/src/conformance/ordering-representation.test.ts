import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

/**
 * Conformance for the one `Ordering` representation (issue #275,
 * `spec/operators-logic-precedence.md` §5.1).
 *
 * The defect was two representations meeting at a dictionary slot. `a < b`
 * lowered to `compare(a, b) < 0` — a *sign* test — while `Ord.compare` is
 * `(a, a) -> Ordering`, and `Ordering = Less | Equal | Greater` is an
 * union of nullary constructors, so a hand-written `honor Ord<T>` returns the
 * Unions §6.1 tagged objects. `Less < 0` is `false`, and so was `Greater > 0`:
 * the specimen below compiled with zero diagnostics and exported `false` for every
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

/** The three values a conforming `compare` slot may return (Unions §6.1). */
const ORDERINGS = [{ tag: "Less" }, { tag: "Equal" }, { tag: "Greater" }];

/** A dictionary as JS sees it across the FFI Part 9 boundary. */
type OrdDictionary = { readonly compare: (left: unknown, right: unknown) => unknown };

function javascript(source: string): string {
  const project = compileMain("module Main\n\n" + source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

/** A prelude companion's own emitted JavaScript, as that project compiled it. */
function companionText(source: string, basename: string): string {
  const project = compileMain("module Main\n\n" + source);
  expect(project.diagnostics).toEqual([]);
  return project.modules
    .find(({ source: file }) => file.path.endsWith(`/${basename}`))!.javascript.text;
}

describe("the issue specimen: a hand-written `honor Ord` answers the operators", () => {
  test("`<` and `>` are what the hand-written `compare` says", async () => {
    // Verbatim from #275, plus the export the issue's reporter did not need.
    const module = await runMain("module Main\n\n" + "export record Meters derives Eq = {value: Int}\n" +
        "honor Ord<Meters> =\n" +
        "    compare(left, right) =\n" +
        "        if left.value < right.value then Ordering.Less else if right.value < left.value then Ordering.Greater else Ordering.Equal\n" +
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
    const module = await runMain("module Main\n\n" + "export record Grams derives Eq = {mass: Int}\n" +
        "honor Ord<Grams> =\n" +
        "    compare(left, right) =\n" +
        "        if left.mass < right.mass then Ordering.Less else if right.mass < left.mass then Ordering.Greater else Ordering.Equal\n" +
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
    const module = await runMain("module Main\n\n" + "export record Fraction derives Eq = {top: Int, bottom: Int}\n" +
        "honor Ord<Fraction> =\n" +
        "    compare(left, right) =\n" +
        "        let leftProduct = left.top * right.bottom\n" +
        "        let rightProduct = right.top * left.bottom\n" +
        "        if leftProduct < rightProduct then\n" +
        "            Ordering.Less\n" +
        "        else\n" +
        "            if leftProduct > rightProduct then\n" +
        "                Ordering.Greater\n" +
        "            else\n" +
        "                Ordering.Equal\n" +
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
    const module = await runMain("module Main\n\n" + "export record Reading derives (Eq, Ord) = {level: Int, name: String}\n" +
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
    const module = await runMain("module Main\n\n" + "export union Colour derives (Eq, Ord, Show) =\n" +
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
    const module = await runMain("module Main\n\n" + "export union Step derives (Eq, Ord) =\n" +
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
    // `compare` received `Less` from the hand-written one and compared it to
    // a number. `Box(a)`'s field is the type *variable*, so this is the one
    // record shape whose derived comparison genuinely delegates.
    const module = await runMain("module Main\n\n" + "export record Metres derives Eq = {span: Int}\n" +
        "honor Ord<Metres> =\n" +
        "    compare(left, right) =\n" +
        "        if left.span < right.span then Ordering.Less else if right.span < left.span then Ordering.Greater else Ordering.Equal\n" +
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
    const module = await runMain("module Main\n\n" + "export record Kilos derives Eq = {load: Int}\n" +
        "honor Ord<Kilos> =\n" +
        "    compare(left, right) =\n" +
        "        if left.load < right.load then Ordering.Less else if right.load < left.load then Ordering.Greater else Ordering.Equal\n" +
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
    // instantiation, because `Less <= 0` is `false`.
    const module = await runMain("module Main\n\n" + "export let least<a: Ord>(x: a, y: a): a = if x <= y then x else y\n" +
        "export record Volts derives Eq = {charge: Int}\n" +
        "honor Ord<Volts> =\n" +
        "    compare(left, right) =\n" +
        "        if left.charge < right.charge then Ordering.Less else if right.charge < left.charge then Ordering.Greater else Ordering.Equal\n" +
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
    const module = await runMain("module Main\n\n" + "export union Rank derives (Eq, Ord) =\n" +
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
    const module = await runMain("module Main\n\n" + "export let smaller<a: Ord>(x: a, y: a): a = if x < y then x else y\n" +
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
    const module = await runMain("module Main\n\n" + "export record Yards derives Eq = {run: Int}\n" +
        "honor Ord<Yards> =\n" +
        "    compare(left, right) =\n" +
        "        if left.run < right.run then Ordering.Less else if right.run < left.run then Ordering.Greater else Ordering.Equal\n" +
        "export record Feet derives (Eq, Ord) = {step: Int}\n" +
        "export let anchor: Yards = Yards({run = 1})\n" +
        "export let anchorFeet: Feet = Feet({step = 1})\n",
    );

    const written = module["__Ord_Yards"] as OrdDictionary;
    const derived = module["__Ord_Feet"] as OrdDictionary;

    expect(written.compare({ run: 1 }, { run: 2 })).toEqual({ tag: "Less" });
    expect(written.compare({ run: 2 }, { run: 1 })).toEqual({ tag: "Greater" });
    expect(written.compare({ run: 1 }, { run: 1 })).toEqual({ tag: "Equal" });
    // The whole point of the fix: the derived slot is indistinguishable.
    expect(derived.compare({ step: 1 }, { step: 2 })).toEqual({ tag: "Less" });
    expect(derived.compare({ step: 2 }, { step: 1 })).toEqual({ tag: "Greater" });
    expect(derived.compare({ step: 1 }, { step: 1 })).toEqual({ tag: "Equal" });
  });

  test("every derived slot shape returns one of the three, never a number", async () => {
    // One assertion per arm of the derived comparison: primitive leaf, `Float`
    // and `String` comparators, `Bool`, `Vector` (element and length), the
    // payload-free tag table, and a payload union's tag-then-payload path.
    const module = await runMain("module Main\n\n" + "export union Suit derives (Eq, Ord) =\n" +
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

    const suit = module["__Ord_Suit"] as OrdDictionary;
    const card = module["__Ord_Card"] as OrdDictionary;
    const hand = module["__Ord_Hand"] as OrdDictionary;
    const left = { flags: [false], label: "a", score: 1.0, seat: 1 };

    // `Suit` is a union of nullary constructors, so its values are the same
    // tagged objects `Card`'s are (#771) — the argument shape below is the
    // whole of what the representation change means at this boundary.
    expect(suit.compare({ tag: "Clubs" }, { tag: "Spades" })).toEqual({ tag: "Less" });
    expect(suit.compare({ tag: "Spades" }, { tag: "Spades" })).toEqual({ tag: "Equal" });
    expect(card.compare({ tag: "Joker" }, { tag: "Pip", rank: 0 })).toEqual({ tag: "Less" });
    expect(card.compare({ tag: "Pip", rank: 2 }, { tag: "Pip", rank: 1 }))
      .toEqual({ tag: "Greater" });
    expect(card.compare({ tag: "Joker" }, { tag: "Joker" })).toEqual({ tag: "Equal" });
    // `flags` sorts first by field name, so each probe below moves exactly one
    // field away from `left` and the earlier fields stay equal.
    expect(hand.compare(left, { ...left, flags: [true] })).toEqual({ tag: "Less" });
    expect(hand.compare(left, { ...left, flags: [false, false] })).toEqual({ tag: "Less" });
    expect(hand.compare(left, { ...left, label: "b" })).toEqual({ tag: "Less" });
    expect(hand.compare(left, { ...left, score: 2.0 })).toEqual({ tag: "Less" });
    expect(hand.compare(left, { ...left, seat: 0 })).toEqual({ tag: "Greater" });
    expect(hand.compare(left, { ...left })).toEqual({ tag: "Equal" });
    for (const probe of [left, { ...left, label: "b" }, { ...left, seat: 0 }]) {
      expect(ORDERINGS).toContainEqual(hand.compare(left, probe));
    }
  });

  test("the `Unit` slot's constant is the `Equal` object, and `<=` tests its tag", async () => {
    // #159 makes `Unit` the arity-0 tuple, whose structural comparison has no
    // components to compare. The constant used to be `0`; a slot may not hand a
    // number to a caller expecting an `Ordering`.
    const source = "export let unitOrder: Bool = () <= ()\n" +
      "export let unitStrict: Bool = () < ()\n";
    const module = await runMain("module Main\n\n" + source);

    expect(module.unitOrder).toBe(true);
    expect(module.unitStrict).toBe(false);
    // The dictionary is ground, so it is Dictionary Sharing §3.4's hoisted
    // module constant and the selection reads off it (#446); the slot's constant
    // — this test's subject — is unchanged by where the record is built.
    const text = javascript(source);
    // The whole body is one `Ordering`, which is why this seat is the one that
    // would break on an object literal: `(__left, __right) => { tag: "Equal" }`
    // reads that object as a block and returns `undefined`. A hoisted name
    // (#771 B1) opens no block, so no parentheses are needed here any more.
    expect(text).toContain(
      "const __Ord_Unit = ({ compare: (__left, __right) => __Equal });",
    );
    expect(text).toContain(
      'const unitOrder = __Ord_Unit.compare(undefined, undefined).tag !== "Greater";',
    );
  });

  test("a primitive `Ord` dictionary wraps its comparator rather than leaking the sign", async () => {
    // Every primitive's dictionary is its companion's export since #344's last
    // landing, so the route to one is a parameterized instance applied at a
    // primitive: the argument is a real, imported dictionary whose slot the
    // derived body calls. That is also why this test pins a shape — no program
    // can name the dictionary. The comparators themselves are untouched;
    // `ordering` is the only step the representation ruling added, and it is
    // the *companions* that now hold the wrapping.
    const source = "export record Cell(a) derives (Eq, Ord) = {item: a}\n" +
      "export let fractional: Bool = Cell({item = 1.5}) < Cell({item = 2.5})\n" +
      "export let textual: Bool = Cell({item = \"b\"}) <= Cell({item = \"a\"})\n" +
      "export let whole: Bool = Cell({item = 2}) > Cell({item = 1})\n";
    const module = await runMain("module Main\n\n" + source);

    expect(module.fractional).toBe(true);
    expect(module.textual).toBe(false);
    expect(module.whole).toBe(true);

    const text = javascript(source);

    // None of the three arguments is a literal built here any more: since #344
    // each is its companion's exported dictionary, imported. The shapes they
    // hold are the same comparators, pinned at their new homes below.
    expect(text).toMatch(/__Ord_Cell\(__Ord_(Int|Float|String)\)/u);
    expect(text).toContain('__Ord_Int } from "./Hex/Int.js"');
    expect(text).toContain('__Ord_Float } from "./Hex/Float.js"');
    expect(text).toContain('__Ord_String } from "./Hex/String.js"');
    expect(companionText(source, "Int.hex")).toContain(
      "(__a, __b) => __a < __b ? __Less : __a > __b ? __Greater : __Equal",
    );
    expect(companionText(source, "Float.hex")).toContain(
      "(__a, __b) => __ordering(__compareFloat(__a, __b))",
    );
    expect(companionText(source, "String.hex")).toContain(
      "(__a, __b) => __ordering(__compareString(__a, __b))",
    );
    // And `ordering` and the comparators travelled with them, bodies and all,
    // into the companions that call them.
    expect(companionText(source, "Float.hex")).toContain(
      "function __ordering(__sign) {\n" +
        "  return __sign < 0 ? __Less : __sign > 0 ? __Greater : __Equal;\n" +
        "}",
    );
    expect(companionText(source, "Float.hex"))
      .toContain("  if (Number.isNaN(__left)) return Number.isNaN(__right) ? 0 : 1;");
  });
});

describe("what the change does not touch", () => {
  test("`compareFloat`'s total order survives the trip through a dictionary", async () => {
    // NaN is the greatest `Float` and equals itself, so `compare` is total —
    // the property that makes `Ord<Float>` lawful at all. `Slot(Float)` is what
    // reaches the primitive dictionary: a *ground* call of a constrained
    // function is specialized to the inline fast path instead, so the last two
    // exports below deliberately test the other route rather than this one.
    const module = await runMain("module Main\n\n" + "export record Slot(a) derives (Eq, Ord) = {held: a}\n" +
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
    const module = await runMain("module Main\n\n" + "export record Token(a) derives (Eq, Ord) = {text: a}\n" +
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
    const module = await runMain("module Main\n\n" + "export let alike<a: Eq>(x: a, y: a): Bool = x == y\n" +
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
    expect(text).toContain("const cheapFloat = __compareFloat(1.0, 2.0) < 0;");
    expect(text).toContain('const cheapText = __compareString("a", "b") < 0;');
    expect(text).toContain("const cheapBool = false < true;");
    // No dictionary was built for any of them.
    expect(text).not.toContain(".compare(");
  });
});
