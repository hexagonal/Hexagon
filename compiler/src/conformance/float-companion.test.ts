import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * PR δ3 of #344: **`Float` is a source companion.** `stdlib/Float.hex` is the
 * primitive's home module (Constraints §5.3), its eight instances are ordinary
 * `honor` blocks, `Float.mod` and `Float.rem` are its plain exports — `Float`
 * is never `Integral` — and the compiler's wired `Float` rows retired in the
 * same change. `Float` was the last owner of the `PrimitiveOperation` family,
 * so the family itself died with it: the resolver guard, the checker row, the
 * emitter rows, and the tree node.
 *
 * `Float` is where the semantics are least ordinary and most easily lost. Its
 * equality is SameValueZero rather than `===`, its order is total with `NaN`
 * last, its `show` is the host's with every wart, and its hash is supposed to
 * normalize both. None of that is visible in a clean compile, so **everything
 * that can run, runs** — a wired row rebuilt as a source instance that quietly
 * drops the `NaN` arm would pass every shape assertion in this file.
 *
 * The programs are deliberately byte-distinct from one another: two conformance
 * modules whose emitted JavaScript is identical share one instance through the
 * ESM data-URL cache, and a pin that silently measures its neighbour's module is
 * a pin that cannot fail.
 */

/** `/main.hex`'s emitted JavaScript, which must have compiled cleanly. */
function emitted(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

/** `stdlib/Float.hex`'s emitted JavaScript, as the prelude compiled it. */
function companion(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules
    .find(({ source: file }) => file.path.endsWith("/Float.hex"))!.javascript.text;
}

/** Every diagnostic message a multi-module project produced, in order. */
function diagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

describe("the control: diagnostics are project-level, so prove the probe can fail", () => {
  test("an unknown name is still refused", () => {
    expect(projectDiagnostics("export let r: Float = halph(1.0)\n"))
      .toEqual(["unknown name `halph`"]);
  });
});

describe("the four spellings are one implementation", () => {
  /**
   * The qualified spelling, the dot call, string interpolation, and the generic
   * route all reach the same member of the same instance. Before #344 three of
   * these four were a compiler row rather than a member at all — and
   * interpolation is the one that never had a name to be spelled with, so it is
   * the one a re-homing could most easily leave pointing at the retired row.
   */
  test("`show` agrees qualified, after a dot, interpolated, and under a bound", async () => {
    const exports = await runMain([
      "export let qualified: String = Float.show(1.5)",
      "export let dotted: String = (1.5).show()",
      'export let interpolated: String = "${1.5}"',
      "let render<a: Show>(value: a): String = show(value)",
      "export let generic: String = render(1.5)",
      "",
    ].join("\n"));

    expect(exports["qualified"]).toBe("1.5");
    expect(exports["dotted"]).toBe("1.5");
    expect(exports["interpolated"]).toBe("1.5");
    expect(exports["generic"]).toBe("1.5");
  });

  /**
   * And the same for the two plain exports, which are reached by three
   * spellings rather than four: the bare one is gone (see the two-exporter
   * describe below), and there is no operator to be a fourth.
   */
  test("`mod` agrees qualified and after a dot, on a receiver and on a literal", async () => {
    const exports = await runMain([
      "export let qualified: Float = Float.mod(-7.5, 3.0)",
      "let angle: Float = -7.5",
      "export let dotted: Float = angle.mod(3.0)",
      "export let onLiteral: Float = (-7.5).mod(3.0)",
      "",
    ].join("\n"));

    expect(exports["qualified"]).toBe(1.5);
    expect(exports["dotted"]).toBe(1.5);
    expect(exports["onLiteral"]).toBe(1.5);
  });
});

describe("Primitive Types §5's equality and order, executed", () => {
  /**
   * SameValueZero, by both routes: the `==` operator's fast path and the
   * instance's own slot through a generic. `Float`'s equality is deliberately
   * not the host's `===` — a `NaN` equals itself and the two zeroes agree —
   * which is what lets a `Float` key a hash table at all.
   */
  test("`NaN` equals itself and `-0.0` equals `0.0`, operator and slot alike", async () => {
    const exports = await runMain([
      "let nan: Float = 0.0 / 0.0",
      "let alsoNan: Float = (1.0 / 0.0) - (1.0 / 0.0)",
      "let same<a: Eq>(left: a, right: a): Bool = equals(left, right)",
      "export let operatorNan: Bool = nan == nan",
      "export let operatorTwoNans: Bool = nan == alsoNan",
      "export let operatorZeroes: Bool = 0.0 == -0.0",
      "export let slotNan: Bool = same(nan, alsoNan)",
      "export let slotZeroes: Bool = same(0.0, -0.0)",
      "export let stillDistinguishes: Bool = same(1.5, 2.5)",
      "",
    ].join("\n"));

    expect(exports["operatorNan"]).toBe(true);
    expect(exports["operatorTwoNans"]).toBe(true);
    expect(exports["operatorZeroes"]).toBe(true);
    expect(exports["slotNan"]).toBe(true);
    expect(exports["slotZeroes"]).toBe(true);
    expect(exports["stillDistinguishes"]).toBe(false);
  });

  /**
   * The decided total order: every number ascending, `NaN` after `+Infinity`,
   * and the two zeroes equal. Totality is what makes `Ord<Float>` lawful, and
   * it is exactly the property a host comparison would not have.
   */
  test("`NaN` sorts after `+Infinity` and the zeroes compare equal", async () => {
    const exports = await runMain([
      "let notANumber: Float = 0.0 / 0.0",
      "let positiveInfinity: Float = 1.0 / 0.0",
      "let negativeInfinity: Float = -1.0 / 0.0",
      "export let ascending: Vector(Bool) = [",
      "    negativeInfinity < -1.5, -1.5 < 0.0, 0.0 < 1.5, 1.5 < positiveInfinity,",
      "    positiveInfinity < notANumber]",
      "export let nanIsNotLess: Bool = notANumber < negativeInfinity",
      "export let zeroesTie: Bool = 0.0 <= -0.0 and -0.0 <= 0.0",
      "export let ordered: Ordering = compare(2.5, 1.5)",
      "",
    ].join("\n"));

    expect([...(exports["ascending"] as Iterable<unknown>)])
      .toEqual([true, true, true, true, true]);
    expect(exports["nanIsNotLess"]).toBe(false);
    expect(exports["zeroesTie"]).toBe(true);
    expect(exports["ordered"]).toBe("Greater");
  });
});

describe("Division & Remainder §5's family, executed", () => {
  /**
   * The whole sign matrix at `Float`. `mod` is Euclidean — never negative — and
   * `rem` is truncated, taking the sign of the dividend, which is JS's `%`
   * exactly. The two agree only where both operands are non-negative, so every
   * sign pair is here.
   */
  test("Euclidean and truncated agree only where §2's table says they do", async () => {
    const exports = await runMain([
      "export let euclidean: Vector(Float) = [",
      "    Float.mod(7.0, 3.0), Float.mod(-7.0, 3.0),",
      "    Float.mod(7.0, -3.0), Float.mod(-7.0, -3.0)]",
      "export let truncated: Vector(Float) = [",
      "    Float.rem(7.0, 3.0), Float.rem(-7.0, 3.0),",
      "    Float.rem(7.0, -3.0), Float.rem(-7.0, -3.0)]",
      "",
    ].join("\n"));

    expect([...(exports["euclidean"] as Iterable<unknown>)]).toEqual([1, 2, 1, 2]);
    expect([...(exports["truncated"] as Iterable<unknown>)]).toEqual([1, -1, 1, -1]);
  });

  /**
   * §5.1's no-throw rule, which is the whole difference from the integer
   * families: float partiality is `NaN`. Asserted through `show` rather than
   * through `!=`, because `Eq<Float>` is SameValueZero — a `NaN` equals itself,
   * so the usual `x != x` test answers `False` here and would prove nothing.
   */
  test("a zero divisor answers `NaN` at both, and nothing throws", async () => {
    const exports = await runMain([
      "export let modByZero: String = show(Float.mod(1.0, 0.0))",
      "export let remByZero: String = show(Float.rem(1.0, 0.0))",
      "export let zeroByZero: String = show(Float.mod(0.0, 0.0))",
      "let infinity: Float = 1.0 / 0.0",
      "export let modOfInfinity: String = show(Float.mod(infinity, 3.0))",
      "export let modByInfinity: String = show(Float.mod(1.0, infinity))",
      "",
    ].join("\n"));

    expect(exports["modByZero"]).toBe("NaN");
    expect(exports["remByZero"]).toBe("NaN");
    expect(exports["zeroByZero"]).toBe("NaN");
    expect(exports["modOfInfinity"]).toBe("NaN");
    // A finite dividend under an infinite divisor is already in range.
    expect(exports["modByInfinity"]).toBe("1");
  });

  /**
   * §5.1's documented rounding edge, which the spec chose to record rather than
   * "fix": the adjustment that lifts a negative remainder can round up to the
   * divisor's own magnitude, so the honest bound at `Float` is
   * `0.0 <= result <= abs(right)`. Rust's `rem_euclid` has the identical edge.
   * Pinned so that a future "tightening" of `mod` has to argue with this test.
   */
  test("the adjustment may round up to `abs(right)`, and that is the contract", async () => {
    const exports = await runMain([
      "let tiny: Float = -1.0e-300",
      "export let atTheBoundary: Float = Float.mod(tiny, 3.0)",
      "export let withinTheBound: Bool = Float.mod(tiny, 3.0) <= 3.0",
      "export let neverNegative: Bool = Float.mod(tiny, 3.0) >= 0.0",
      "",
    ].join("\n"));

    expect(exports["atTheBoundary"]).toBe(3);
    expect(exports["withinTheBound"]).toBe(true);
    expect(exports["neverNegative"]).toBe(true);
  });
});

describe("Collections Part 2 §2.3's `Hash` row, executed", () => {
  /**
   * The half of the normalization that holds: every `NaN`, however produced,
   * hashes alike — which it must, because `Eq<Float>` says they are equal.
   */
  test("two independently produced `NaN`s hash equally", async () => {
    const exports = await runMain([
      "let nan: Float = 0.0 / 0.0",
      "let alsoNan: Float = (1.0 / 0.0) * 0.0",
      "export let equal: Bool = nan == alsoNan",
      "export let hashesAgree: Bool = hash(nan) == hash(alsoNan)",
      "export let finiteStillDiffers: Bool = hash(1.5) != hash(2.5)",
      "",
    ].join("\n"));

    expect(exports["equal"]).toBe(true);
    expect(exports["hashesAgree"]).toBe(true);
    expect(exports["finiteStillDiffers"]).toBe(true);
  });

  /**
   * The half that does not, written to **fail** today. Collections Part 2 §2.3
   * says the `Float` hash is SameValueZero-consistent, and `Eq<Float>` says
   * `0.0 == -0.0` — so the two must hash alike, and they do not:
   * `__hex_stableHash`'s `-0` arm answers `0` while `0.0` answers the string
   * hash of `"0"`, which is 48. A `Set(Float)` therefore holds both zeroes at
   * once, which is the law failing where a user can see it.
   *
   * Measured identically on `main` (the wired `Hash<Float>` row called the same
   * helper), so this is pre-existing rather than this landing's doing — but the
   * landing is what makes the instance source, and the law is the companion's
   * to keep now.
   *
   * `test.fails` and not `skip`: when the helper's `-0` arm is repaired this
   * goes red, which is the signal to delete this comment and flip it to an
   * ordinary `test`.
   */
  test.fails("`-0.0` and `0.0` hash equally — the SameValueZero law, unmet", async () => {
    const exports = await runMain([
      "export let zeroesEqual: Bool = 0.0 == -0.0",
      "export let hashesAgree: Bool = hash(0.0) == hash(-0.0)",
      "let both: Set(Float) = Set.add(Set.add(Set.empty(), 0.0), -0.0)",
      "export let collapsed: Int = Set.size(both)",
      "",
    ].join("\n"));

    expect(exports["zeroesEqual"]).toBe(true);
    expect(exports["hashesAgree"]).toBe(true);
    expect(exports["collapsed"]).toBe(1);
  });
});

describe("Primitive Types §7's `show`, warts included", () => {
  /**
   * `Show<Float>` is the host's `String(x)` by ruling, so `4.0` renders without
   * its fraction and `-0.0` loses its sign. Those are not accidents to be
   * repaired here — they are the decided rendering, and pinning them is what
   * stops a later "improvement" from changing every interpolation in the
   * language without noticing.
   */
  test("`4.0` shows as `4`, `-0.0` as `0`, and the non-finite floats by name", async () => {
    const exports = await runMain([
      "export let whole: String = show(4.0)",
      "export let negativeZero: String = show(-0.0)",
      "export let large: String = show(1.0e21)",
      "export let small: String = show(1.5)",
      "export let notANumber: String = show(0.0 / 0.0)",
      "export let positiveInfinity: String = show(1.0 / 0.0)",
      "export let negativeInfinity: String = show(-1.0 / 0.0)",
      "",
    ].join("\n"));

    expect(exports["whole"]).toBe("4");
    expect(exports["negativeZero"]).toBe("0");
    expect(exports["large"]).toBe("1e+21");
    expect(exports["small"]).toBe("1.5");
    expect(exports["notANumber"]).toBe("NaN");
    expect(exports["positiveInfinity"]).toBe("Infinity");
    expect(exports["negativeInfinity"]).toBe("-Infinity");
  });
});

describe("`pow` and the guard that is not there", () => {
  /**
   * Operators §6.3's `Float` row: a negative float exponent is an ordinary
   * float operation, so `Pow<Float>` is the raw native with nothing above it —
   * the guard `Int` and `BigInt` carry does not exist here and must not appear.
   * The emission half matters as much as the answers: `**` at `Float` keeps
   * inlining, because there is no guard for a slot call to be protecting.
   */
  test("a negative exponent is an ordinary answer, and `**` still inlines", async () => {
    const source = [
      "export let cube: Float = 2.0 ** 3.0",
      "export let reciprocal: Float = 2.0 ** -1.0",
      "export let root: Float = 9.0 ** 0.5",
      "",
    ].join("\n");
    const exports = await runMain(source);

    expect(exports["cube"]).toBe(8);
    expect(exports["reciprocal"]).toBe(0.5);
    expect(exports["root"]).toBe(3);
    expect(emitted(source)).toContain("const cube = 2.0 ** 3.0;");
    expect(emitted(source)).not.toContain("NegativeExponentError");
  });
});

describe("the wired rows are gone, not dormant", () => {
  /**
   * The load-bearing describe. A row that merely stopped being *selected* would
   * be emitted again the moment anything reached it, so these assert absence in
   * the output rather than agreement in the answers — reinstating the retired
   * `supports` table or the `primitiveDictionary` builder has to fail here.
   */
  test("no `__hex_float*` helper survives, and the dictionaries are imported", () => {
    const text = emitted([
      "export let a: Float = Float.mod(-9.0, 4.0)",
      "export let b: Float = Float.rem(-9.0, 4.0)",
      "let compare2<a: Ord>(left: a, right: a): Ordering = compare(left, right)",
      "export let c: Ordering = compare2(1.25, 2.25)",
      "",
    ].join("\n"));

    expect(text).not.toContain("__hex_float");
    expect(text).toContain('from "./Float.js"');
    expect(text).toContain("__hex_instance_Ord_Float");
  });

  /**
   * And no dictionary is built at the use site. The retired table's `Signed`
   * arm wrote `fromInt: __hex_a => __hex_a` inline; the companion's export is
   * the only definition of that slot now, so a literal like it appearing here
   * is the wired row rebuilt under another name.
   */
  test("no dictionary literal is materialized beside the companion's export", () => {
    const text = emitted([
      "let widen<a: Signed>(left: a, right: a): a = left - right",
      "export let difference: Float = widen(2.75, 0.25)",
      "",
    ].join("\n"));

    expect(text).not.toContain("fromInt: __hex_a => __hex_a");
    expect(text).not.toContain("divide: (__hex_a, __hex_b) => __hex_a / __hex_b");
    expect(text).toContain('__hex_instance_Signed_Float } from "./Float.js"');
  });

  /**
   * The door's curated companion-miss message died with the guard: `Float.div`
   * is now an ordinary does-not-export at a real module, exactly as
   * `String.length` is. `Float` still is not `Integral`, and the constraint
   * still says so in its own words (Integral §8).
   */
  test("`Float.div` misses as an ordinary export, and `gcd` still refuses `Float`", () => {
    expect(projectDiagnostics("export let d: Float = Float.div(1.0, 2.0)\n"))
      .toEqual(["module `Float` does not export `div`"]);
    expect(projectDiagnostics("export let q: Float = Float.quot(1.0, 2.0)\n"))
      .toEqual(["module `Float` does not export `quot`"]);
    expect(projectDiagnostics("export let g: Float = gcd(1.5, 2.0)\n"))
      .toEqual(["type `Float` has no `Integral` instance"]);
  });

  /**
   * The dot call takes Method Syntax §9's neither-error rather than a
   * missing-instance report: `div` is neither a field of `Float`, nor an export
   * of its companion, nor a member of anything honored there. `mod` on the same
   * receiver resolves, which is what makes this a routing pin and not a blanket
   * refusal.
   */
  test("a `div` dot call on a `Float` receiver takes the neither-error", () => {
    expect(projectDiagnostics("export let d: Float = (1.5).div(2.0)\n")).toEqual([
      "`Float` has no field `div`, its companion exports no operation `div`, and " +
        "no constraint honored at `Float` has a subject-first member `div`; call " +
        "an available subject-first function explicitly",
    ]);
    expect(projectDiagnostics("let t: Float = 7.0\nexport let m: Float = t.mod(3.0)\n"))
      .toEqual([]);
  });
});

describe("Constraints §6.1's inlining survives the move", () => {
  /**
   * The selection is the source instance's either way; the monomorphic tables
   * render that one selection as the JavaScript operator rather than as a slot
   * read. Byte-stability here is the whole readable-JavaScript goal, and at
   * `Float` two of these are *not* bare operators on purpose — `<` and `==`
   * carry the total order and SameValueZero through their own helpers, which
   * survive because the derived leaves and the fast paths both need them.
   */
  test("arithmetic inlines, and comparison keeps its two helpers", () => {
    const text = emitted([
      "export let sum: Float = 1.25 + 2.75",
      "export let product: Float = 1.5 * 4.0",
      "export let difference: Float = 9.5 - 0.5",
      "export let opposite: Float = -3.25",
      "export let quotient: Float = 9.0 / 4.0",
      "export let ordered: Bool = 1.25 < 2.75",
      "export let identical: Bool = 1.25 == 1.25",
      'export let rendered: String = "${6.25}"',
      "",
    ].join("\n"));

    expect(text).toContain("const sum = 1.25 + 2.75;");
    expect(text).toContain("const product = 1.5 * 4.0;");
    expect(text).toContain("const difference = 9.5 - 0.5;");
    expect(text).toContain("const opposite = -3.25;");
    expect(text).toContain("const quotient = 9.0 / 4.0;");
    expect(text).toContain("const ordered = __hex_compareFloat(1.25, 2.75) < 0;");
    expect(text).toContain("const identical = __hex_floatEquals(1.25, 1.25);");
    expect(text).toContain("const rendered = String(6.25);");
  });

  /**
   * The derived leaves keep their inline arms too (#278's guard exempts a
   * primitive component, which has exactly one instance to bypass). A container
   * deriving over a `Float` field must not start calling a dictionary slot for
   * what the table renders directly.
   */
  test("a record deriving over a `Float` field still inlines its leaf arms", async () => {
    const source = [
      "export record Reading derives (Eq, Ord, Show, Hash) = {value: Float}",
      "let here = Reading({value = 0.5})",
      "let alsoHere = Reading({value = 0.5})",
      "export let same: Bool = here == alsoHere",
      "export let shown: String = show(here)",
      "export let hashed: Bool = hash(here) == hash(alsoHere)",
      "",
    ].join("\n");
    const exports = await runMain(source);
    const text = emitted(source);

    expect(exports["same"]).toBe(true);
    expect(exports["shown"]).toBe("{value = 0.5}");
    expect(exports["hashed"]).toBe(true);
    expect(text).toContain("__hex_floatEquals(__hex_left.value, __hex_right.value)");
    expect(text).toContain("__hex_ordering(__hex_compareFloat(__hex_left.value, __hex_right.value))");
    expect(text).toContain('String(__hex_value.value)');
  });
});

describe("the composed `fromNat`, which takes no key", () => {
  /**
   * `Num<Float>`'s `fromNat` is the one member of either new companion that is
   * ordinary Hexagon over two other slots — `Signed.fromInt` over
   * `Int.fromNat`. Reached as the qualified member at the companion, which is
   * Modules §5.3's honored-member read, so the slot really does run: a stub or
   * a missing lowering would answer `undefined` here rather than a number.
   */
  test("`Float.fromNat` composes and answers, from a literal and from a `Nat`", async () => {
    const source = [
      "export let fromLiteral: Float = Float.fromNat(7)",
      "let counted: Nat = 5",
      "export let fromBinding: Float = Float.fromNat(counted)",
      "export let alsoConverts: Float = Float.fromInt(-4)",
      "export let zero: Float = Float.fromNat(0)",
      "",
    ].join("\n");
    const exports = await runMain(source);

    expect(exports["fromLiteral"]).toBe(7);
    expect(exports["fromBinding"]).toBe(5);
    expect(exports["alsoConverts"]).toBe(-4);
    expect(exports["zero"]).toBe(0);
    // The slot is really selected: the call goes through `Num.hex`'s member with
    // the companion's dictionary, rather than being erased at the call site.
    expect(emitted(source)).toContain('__hex_instance_Num_Float } from "./Float.js"');
  });

  /**
   * And the slot never materializes for a literal: Numeric Literals §5's
   * erasure means a `Float`-typed literal is the bare JavaScript number with
   * its `.0` intact, with no `fromNat` call standing in front of it.
   */
  test("a `Float` literal still erases to a bare number, `.0` and all", () => {
    const text = emitted([
      "export let whole: Float = 4.0",
      "export let fraction: Float = -0.5",
      "export let separated: Float = 1_000.0",
      "",
    ].join("\n"));

    expect(text).toContain("const whole = 4.0;");
    expect(text).toContain("const fraction = -0.5;");
    expect(text).toContain("const separated = 1000.0;");
    expect(text).not.toContain("fromNat");
  });
});

describe("`mod` and `rem` gained a second exporter", () => {
  /**
   * `stdlib/Float.hex` exports two functions by names `Integral.hex` already
   * exports as members, so both bare spellings take Modules §5.5's refusal and
   * name both qualified homes — at *every* argument type, integers included,
   * because the bare layer is not type-directed. The corpus had zero bare
   * consumer uses and one generic conformance pin, rewritten to the dot call:
   * the same accepted trade `concat` and `fromInt` made at the earlier
   * landings.
   */
  test("the bare spellings are refused, naming both homes", () => {
    expect(projectDiagnostics("export let m: Int = mod(7, 3)\n")).toEqual([
      "the prelude name `mod` is ambiguous: exported by `Integral` and `Float`; " +
        "write `Integral.mod` or `Float.mod`",
    ]);
    expect(projectDiagnostics("export let r: Float = rem(7.0, 3.0)\n")).toEqual([
      "the prelude name `rem` is ambiguous: exported by `Integral` and `Float`; " +
        "write `Integral.rem` or `Float.rem`",
    ]);
  });

  /** Every unambiguous route still works, at `Int` as much as at `Float`. */
  test("the qualified and dot spellings survive at both types", async () => {
    const exports = await runMain([
      "export let floatQualified: Float = Float.mod(-11.0, 4.0)",
      "export let intQualified: Int = Integral.mod(-11, 4)",
      "export let companionQualified: Int = Int.rem(-11, 4)",
      "let whole: Int = -11",
      "let fractional: Float = -11.0",
      "export let intDotted: Int = whole.mod(4)",
      "export let floatDotted: Float = fractional.rem(4.0)",
      "let viaBound<a: Integral>(left: a, right: a): a = left.mod(right)",
      "export let generic: Int = viaBound(-11, 4)",
      "",
    ].join("\n"));

    expect(exports["floatQualified"]).toBe(1);
    expect(exports["intQualified"]).toBe(1);
    expect(exports["companionQualified"]).toBe(-3);
    expect(exports["intDotted"]).toBe(1);
    expect(exports["floatDotted"]).toBe(-3);
    expect(exports["generic"]).toBe(1);
  });

  /** A user module's own `mod` is unaffected — it is not a prelude name. */
  test("a module exporting its own `mod` still works", () => {
    expect(diagnostics([
      ["/clock.hex", "export let mod(value: Int, by: Int): String = \"tick\"\n"],
      ["/main.hex",
        'import { mod } from "./clock"\n' +
        "export let label: String = mod(7, 3)\n"],
    ])).toEqual([]);
  });
});

describe("Numeric Literals §4's defaulting is unchanged by the new seats", () => {
  /**
   * Two more prelude members honoring `Num`, `Eq`, `Ord`, and `Show` at two
   * more types is exactly the shape that could make an unannotated literal look
   * ambiguous. It does not: §4's rule reads the `Int` instance and nothing
   * else, and `Float.hex` sitting after `Int.hex` changes no part of it.
   */
  test("an unannotated literal is still an `Int`, beside the new companions", async () => {
    const exports = await runMain([
      "let x = 1",
      "export let doubled: Int = x + x",
      "export let stillInt: String = show(x + 41)",
      "export let floatNeedsItsPoint: Float = 1.0 + 1.0",
      "export let compared: Bool = 3 < 4",
      "",
    ].join("\n"));

    expect(exports["doubled"]).toBe(2);
    expect(exports["stillInt"]).toBe("42");
    expect(exports["floatNeedsItsPoint"]).toBe(2);
    expect(exports["compared"]).toBe(true);
  });
});

describe("the companion's own emitted shape", () => {
  /**
   * The door bindings lower to bare arrows with nothing behind them, which is
   * what the primop split is for — except the three that cannot be operators,
   * where the arrow wraps the helper that carries the decided semantics. And
   * `mod` is the one piece of Hexagon above the door in this file.
   */
  test("`Float.js` holds the natives as operators and `mod` as source", () => {
    const text = companion("export let n: Float = Float.mod(8.0, 3.0)\n");

    expect(text).toContain("const nativeAdd = (__hex_a, __hex_b) => __hex_a + __hex_b;");
    expect(text).toContain("const nativeDivide = (__hex_a, __hex_b) => __hex_a / __hex_b;");
    expect(text).toContain("const nativePow = (__hex_a, __hex_b) => __hex_a ** __hex_b;");
    expect(text).toContain("const rem = (__hex_a, __hex_b) => __hex_a % __hex_b;");
    expect(text).toContain("const nativeFromInt = __hex_a => __hex_a;");
    expect(text).toContain(
      "const nativeEquals = (__hex_a, __hex_b) => __hex_a === __hex_b || " +
        "(__hex_a !== __hex_a && __hex_b !== __hex_b);",
    );
    expect(text).toContain(
      "const nativeCompare = (__hex_a, __hex_b) => " +
        "__hex_ordering(__hex_compareFloat(__hex_a, __hex_b));",
    );
    // The Euclidean adjustment is Hexagon here, not a helper anywhere else.
    expect(text).toContain("const remainder = rem(left, right);");
    // And nothing in the file guards: `Float` has no exception to throw.
    expect(text).not.toContain("DivideByZeroError");
    expect(text).not.toContain("NegativeExponentError");
  });
});
