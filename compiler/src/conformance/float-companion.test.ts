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
  const project = compileMain("module Main\n\n" + source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

/** `stdlib/Float.hex`'s emitted JavaScript, as the prelude compiled it. */
function companion(source: string): string {
  const project = compileMain("module Main\n\n" + source);
  expect(project.diagnostics).toEqual([]);
  return project.modules
    .find(({ source: file }) => file.path.endsWith("/Float.hex"))!.javascript.text;
}

/**
 * `text` with its comments gone — block comments, the emitted JSDoc among them,
 * and line-comment tails — leaving only what the engine runs.
 *
 * A claim about emitted *code* must not be answerable by prose: the companion's
 * comments already say "throws" and "throwing", and one future doc sentence
 * carrying the bare word would fail a raw scan without a line of `Float.hex`
 * changing (#540). Stripping first is what makes "not a single `throw`" a claim
 * about the module rather than about its commentary.
 *
 * The scan is textual rather than a JavaScript lexer's, which is exact for this
 * one file and stays so for a reason: the emitted companion holds no string
 * literal containing either delimiter, and its literals are the fixed set the
 * assertions below already spell out. A string literal survives stripping — so
 * a future one holding the word would want the statement-shaped scan instead.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[^]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

/** Every diagnostic message a multi-module project produced, in order. */
function diagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

describe("the control: diagnostics are project-level, so prove the probe can fail", () => {
  test("an unknown name is still refused", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let r: Float = halph(1.0)\n"))
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
      "let same<a: Eq>(left: a, right: a): Bool = Eq.equals(left, right)",
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
      "export let ordered: Ordering = Ord.compare(2.5, 1.5)",
      "",
    ].join("\n"));

    expect([...(exports["ascending"] as Iterable<unknown>)])
      .toEqual([true, true, true, true, true]);
    expect(exports["nanIsNotLess"]).toBe(false);
    expect(exports["zeroesTie"]).toBe(true);
    expect(exports["ordered"]).toEqual({ tag: "Greater" });
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
      "export let hashesAgree: Bool = Hash.hash(nan) == Hash.hash(alsoNan)",
      "export let finiteStillDiffers: Bool = Hash.hash(1.5) != Hash.hash(2.5)",
      "",
    ].join("\n"));

    expect(exports["equal"]).toBe(true);
    expect(exports["hashesAgree"]).toBe(true);
    expect(exports["finiteStillDiffers"]).toBe(true);
  });

  /**
   * The other half: the `Float` hash is SameValueZero-consistent, so the pair
   * `Eq<Float>` equates must hash alike. `0.0 == -0.0`, the two hashes agree,
   * and a `Set(Float)` handed both zeroes collapses to a single entry — which
   * is the law holding where a user can see it.
   */
  test("`-0.0` and `0.0` hash equally — the SameValueZero law", async () => {
    const exports = await runMain([
      "export let zeroesEqual: Bool = 0.0 == -0.0",
      "export let hashesAgree: Bool = Hash.hash(0.0) == Hash.hash(-0.0)",
      "let both: Set(Float) = Set.add(Set.add(Set.empty, 0.0), -0.0)",
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
   * Operators §6.3's `Float` row: `Pow<Float>` is **total** — every `Int`
   * exponent has a `Float` answer, negative ones included — so the guard `Nat`,
   * `Int`, and `BigInt` carry does not exist here and must not appear. The
   * emission half matters as much as the answers: `**` at `Float` is the one
   * `pow` instance that still inlines, because there is no guard for a slot
   * call to be protecting, and its member's `Int` exponent is the same
   * JavaScript `number` the raw `**` wants.
   *
   * The fractional exponent moved out of the operator with #541 and into the
   * `Float.pow` door; `pow-doors.test.ts` owns it.
   */
  test("a negative exponent is an ordinary answer, and `**` still inlines", async () => {
    const source = [
      "let three: Int = 3",
      "export let cube: Float = 2.0 ** three",
      "export let reciprocal: Float = 2.0 ** -1",
      "",
    ].join("\n");
    const exports = await runMain("module Main\n\n" + source);

    expect(exports["cube"]).toBe(8);
    expect(exports["reciprocal"]).toBe(0.5);
    expect(emitted(source)).toContain("const cube = 2.0 ** three;");
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
  test("no `__float*` helper survives, and the dictionaries are imported", () => {
    const text = emitted([
      "export let a: Float = Float.mod(-9.0, 4.0)",
      "export let b: Float = Float.rem(-9.0, 4.0)",
      "let compare2<a: Ord>(left: a, right: a): Ordering = Ord.compare(left, right)",
      "export let c: Ordering = compare2(1.25, 2.25)",
      "",
    ].join("\n"));

    expect(text).not.toContain("__float");
    expect(text).toContain('from "./Hex/Float.js"');
    expect(text).toContain("__Ord_Float");
  });

  /**
   * And no dictionary is built at the use site. The retired table's `Signed`
   * arm wrote `fromInt: __a => __a` inline; the companion's export is
   * the only definition of that slot now, so a literal like it appearing here
   * is the wired row rebuilt under another name.
   */
  test("no dictionary literal is materialized beside the companion's export", () => {
    const text = emitted([
      "let widen<a: Signed>(left: a, right: a): a = left - right",
      "export let difference: Float = widen(2.75, 0.25)",
      "",
    ].join("\n"));

    expect(text).not.toContain("fromInt: __a => __a");
    expect(text).not.toContain("divide: (__a, __b) => __a / __b");
    expect(text).toContain('__Signed_Float } from "./Hex/Float.js"');
  });

  /**
   * The door's curated companion-miss message died with the guard: `Float.div`
   * is now an ordinary does-not-export at a real module, exactly as
   * `String.length` is. `Float` still is not `Integral`, and the constraint
   * still says so in its own words (Integral §8).
   */
  test("`Float.div` misses as an ordinary export, and `gcd` still refuses `Float`", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let d: Float = Float.div(1.0, 2.0)\n"))
      .toEqual(["module `Float` does not export `div`"]);
    expect(projectDiagnostics("module Main\n\n" + "export let q: Float = Float.quot(1.0, 2.0)\n"))
      .toEqual(["module `Float` does not export `quot`"]);
    expect(projectDiagnostics("module Main\n\n" + "export let g: Float = Integral.gcd(1.5, 2.0)\n"))
      .toEqual([
        "type `Float` has no `Integral` instance; its only legal homes are the module " +
          "declaring `Integral` and `Float`'s prelude companion module, both outside " +
          "project source, so this pair's honored set is closed — change the type, or go " +
          "through the operations those homes export",
      ]);
  });

  /**
   * The dot call takes Method Syntax §9's neither-error rather than a
   * missing-instance report: `div` is neither a field of `Float`, nor an export
   * of its companion, nor a member of anything honored there. `mod` on the same
   * receiver resolves, which is what makes this a routing pin and not a blanket
   * refusal.
   */
  test("a `div` dot call on a `Float` receiver takes the neither-error", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let d: Float = (1.5).div(2.0)\n")).toEqual([
      "`Float` has no field `div`, its companion exports no operation `div`, and " +
        "no constraint honored at `Float` has a subject-first member `div`; call " +
        "an available subject-first function explicitly",
    ]);
    expect(projectDiagnostics("module Main\n\n" + "let t: Float = 7.0\nexport let m: Float = t.mod(3.0)\n"))
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
    expect(text).toContain("const ordered = __compareFloat(1.25, 2.75) < 0;");
    expect(text).toContain("const identical = __floatEquals(1.25, 1.25);");
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
      "export let hashed: Bool = Hash.hash(here) == Hash.hash(alsoHere)",
      "",
    ].join("\n");
    const exports = await runMain("module Main\n\n" + source);
    const text = emitted(source);

    expect(exports["same"]).toBe(true);
    expect(exports["shown"]).toBe("{value = 0.5}");
    expect(exports["hashed"]).toBe(true);
    expect(text).toContain("__floatEquals(__left.value, __right.value)");
    expect(text).toContain("__ordering(__compareFloat(__left.value, __right.value))");
    expect(text).toContain('String(__value.value)');
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
    const exports = await runMain("module Main\n\n" + source);

    expect(exports["fromLiteral"]).toBe(7);
    expect(exports["fromBinding"]).toBe(5);
    expect(exports["alsoConverts"]).toBe(-4);
    expect(exports["zero"]).toBe(0);
    // The slot is really selected, and since #444 the call names it outright:
    // `Float.fromNat(7)` is a source-written member call at a concrete head, so
    // Constraints §6.1's first arm reaches `Float.hex`'s own member seat — the
    // binding the record's `fromNat` slot holds — rather than the forwarder and
    // its evidence. An erasure at the call site would name neither.
    expect(emitted(source)).toContain(
      'import { __Num_Float_fromNat as fromNat, __Signed_Float_fromInt as fromInt }' +
        ' from "./Hex/Float.js";',
    );
    expect(emitted(source)).toContain("const fromLiteral = fromNat(7);");
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
    // Since #742 the sentence is §5.5's refusal rather than the ambiguity one —
    // the bare layer holds neither spelling now — and it names the same two
    // homes, spelled with the arguments the program wrote.
    expect(projectDiagnostics("module Main\n\n" + "export let m: Int = mod(7, 3)\n")).toEqual([
      "no bare `mod`; write `(7).mod(3)`, `Integral.mod(7, 3)`, or `Float.mod(7, 3)`",
    ]);
    expect(projectDiagnostics("module Main\n\n" + "export let r: Float = rem(7.0, 3.0)\n")).toEqual([
      "no bare `rem`; write `(7.0).rem(3.0)`, `Integral.rem(7.0, 3.0)`, " +
        "or `Float.rem(7.0, 3.0)`",
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

  /**
   * A user module's own `mod` is unaffected — it is not a prelude name. What
   * stands where the named import stood (§3.2, #762): the ordinary
   * declaration `let mod = Clock.mod` is what wants the spelling bare, and it
   * wins outright, above the prelude layer's own refusal.
   */
  test("a module exporting its own `mod` still works", () => {
    expect(diagnostics([
      ["/clock.hex", "module Clock\n\n" + "export let mod(value: Int, by: Int): String = \"tick\"\n"],
      ["/main.hex",
        "module Main\n\n" + 'import Clock\n' +
        "let mod = Clock.mod\n" +
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

    expect(text).toContain("const nativeAdd = (__a, __b) => __a + __b;");
    expect(text).toContain("const nativeDivide = (__a, __b) => __a / __b;");
    expect(text).toContain("const nativePow = (__a, __b) => __a ** __b;");
    expect(text).toContain("const rem = (__a, __b) => __a % __b;");
    expect(text).toContain("const nativeFromInt = __a => __a;");
    expect(text).toContain(
      "const nativeEquals = (__a, __b) => __a === __b || " +
        "(__a !== __a && __b !== __b);",
    );
    expect(text).toContain(
      "const nativeCompare = (__a, __b) => " +
        "__ordering(__compareFloat(__a, __b));",
    );
    // The Euclidean adjustment is Hexagon here, not a helper anywhere else.
    expect(text).toContain("const remainder = rem(left, right);");
    // And nothing in the file guards. `Float` gained a *declared* exception at
    // #526 — `FloatRangeError`, the range the doors into `Float` from the exact
    // world fail — but no operation here throws it or anything else, which is
    // the claim: not a single `throw` in the whole emitted companion. Read on
    // the stripped text, so the claim is about code and the file's own prose
    // about throwing cannot answer it either way (#540).
    expect(withoutComments(text)).not.toContain("throw");
    expect(text).toContain(
      "const FloatRangeError = message => " +
        "__exception(\"FloatRangeError\", message, { message });",
    );
    // The brand is the declaring module's path identity, so `Float.hex`'s own.
    expect(text).toContain("__error.$hex === \"Float\"");
  });
});

describe("the special values and their detectors (#358)", () => {
  /**
   * Primitive Types §3 owed four names, and the lexer's overflow fix-it had
   * been naming one of them since before it existed. None needs a door: the
   * two constants are exact float divisions, and the two predicates are
   * ordinary Hexagon over `Eq<Float>`.
   *
   * `isNan` is the one worth reading twice. The imported detector `x != x` is
   * uniformly `False` in Hexagon because `Eq<Float>` is SameValueZero, so NaN
   * detection had no spelling at all while `Float.hex`'s own doctrine — float
   * partiality is `NaN` rather than a throw — kept handing callers values they
   * could not test. The same equality that killed the idiom supplies the fix:
   * `value == Float.nan` is true of exactly the NaNs.
   *
   * Executed rather than asserted on shape, per this file's rule: a constant
   * that quietly emitted `0` would satisfy every spelling assertion here.
   */
  test("the constants are the IEEE specials, and negation reaches the third", async () => {
    const exports = await runMain("module Main\n\n" + 'export let out: String = show(Float.infinity) ++ " " ++ show(-Float.infinity)\n' +
        '    ++ " " ++ show(Float.nan)\n',
    );

    expect(exports["out"]).toBe("Infinity -Infinity NaN");
  });

  test("`isNan` answers where `x != x` cannot", async () => {
    const exports = await runMain("module Main\n\n" + "export let out: String =\n" +
        "    show(Float.isNan(Float.nan)) ++ show(Float.isNan(0.0 / 0.0))\n" +
        "      ++ show(Float.isNan(1.0)) ++ show(Float.isNan(Float.infinity))\n",
    );

    expect(exports["out"]).toBe("TrueTrueFalseFalse");
  });

  /** The dead idiom, pinned dead, so its absence stays a decision. */
  test("`x != x` is uniformly `False`, NaN included", async () => {
    const exports = await runMain("module Main\n\n" + "let selfDiffers(value: Float): Bool = value != value\n" +
        "export let out: String =\n" +
        "    show(selfDiffers(Float.nan)) ++ show(selfDiffers(1.0))\n",
    );

    expect(exports["out"]).toBe("FalseFalse");
  });

  test("`isFinite` excludes both infinities and NaN, and admits both zeroes", async () => {
    const exports = await runMain("module Main\n\n" + "export let out: String =\n" +
        "    show(Float.isFinite(1.0)) ++ show(Float.isFinite(0.0))\n" +
        "      ++ show(Float.isFinite(-0.0)) ++ show(Float.isFinite(Float.infinity))\n" +
        "      ++ show(Float.isFinite(-Float.infinity)) ++ show(Float.isFinite(Float.nan))\n",
    );

    expect(exports["out"]).toBe("TrueTrueTrueFalseFalseFalse");
  });

  /** Modules §5.5: one exporter, so the bare spellings resolve too. */
  test("the four names are reached qualified, and `show` stays bare", async () => {
    // #742 took the bare spellings: `infinity`, `nan`, `isNan` and `isFinite`
    // are `Float.hex`'s exports and no prelude function is seeded bare. `show`
    // is the one member that is, which is why it still reads as it did.
    const exports = await runMain("module Main\n\n" + "export let out: String =\n" +
        "    show(Float.infinity) ++ show(Float.isNan(Float.nan))" +
        " ++ show(Float.isFinite(2.5))\n",
    );

    expect(exports["out"]).toBe("InfinityTrueTrue");
  });

  /** And the bare spelling of each names its one home (Modules §10). */
  test("the bare spellings name `Float`", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let f: Float = infinity\n"))
      .toEqual(["no bare `infinity`; write `Float.infinity`"]);
    expect(projectDiagnostics("module Main\n\n" + "export let f: Float = nan\n"))
      .toEqual(["no bare `nan`; write `Float.nan`"]);
    expect(projectDiagnostics("module Main\n\n" + "export let f(x: Float): Bool = isNan(x)\n"))
      .toEqual(["no bare `isNan`; write `x.isNan()` or `Float.isNan(x)`"]);
    expect(projectDiagnostics("module Main\n\n" + "export let f(x: Float): Bool = isFinite(x)\n"))
      .toEqual(["no bare `isFinite`; write `x.isFinite()` or `Float.isFinite(x)`"]);
  });

  /** The hint the lexer has always given now names something that resolves. */
  test("the overflow fix-it's spelling compiles", () => {
    // The bad literal also derails the parse, so only the fix-it is asserted.
    expect(projectDiagnostics("module Main\n\n" + "export let big: Float = 1e400\n"))
      .toContain("Float literal is too large; use `Float.infinity`");
    expect(projectDiagnostics("module Main\n\n" + "export let big: Float = Float.infinity\n")).toEqual([]);
  });
});
