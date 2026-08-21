import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for **the two power doors and the generalisation law that lets
 * them wear their members' names** — #541; Operators §6.3.1, Modules §5.3,
 * Constraints §4.6's exemption, Method Syntax §6.1, Primitive Types §3/§5.
 *
 * `**` is the algebraist's power and its exponent is an `Int` by type. The two
 * operations that seat leaves unspellable get named doors instead:
 *
 * - **`Float.pow(value: Float, exponent: Float): Float`** — the analytic power,
 *   total and honestly IEEE.
 * - **`BigInt.pow(value: BigInt, exponent: BigInt): BigInt`** — the exact power
 *   at exponents past `Int`'s range.
 *
 * Each is a *generalising export*: it accepts every call its `Pow` member
 * accepts, the member is its restriction, and — this is the half a test has to
 * hold, since nothing else can — it is **qualifiable, not a bare export**. Bare
 * `pow` in a consumer still has exactly one exporter, `Pow.hex`'s member, and
 * the dot call reaches the door as *one claimant* rather than a §6 collision.
 */

/** What a thunk threw, or `undefined` if it returned. */
function threw(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

/** `/main.hex`'s emitted JavaScript, with the project asserted clean. */
function emitted(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text;
}

describe("the control: the harness reports a failure rather than passing it", () => {
  test("an unknown name is still refused", () => {
    expect(projectDiagnostics("export let r: Int = noSuchName\n"))
      .toEqual(["unknown name `noSuchName`"]);
  });
});

describe("`Float.pow` — the analytic power (Operators §6.3.1)", () => {
  test("a fractional exponent answers the nearest double, IEEE exactly", async () => {
    // Not transcribed from the implementation: the claim is that the door *is*
    // the host's `**` on doubles, so the host's own `Math.sqrt` is the oracle
    // for the square root and `Math.cbrt` for the cube root.
    const exports = await runMain(
      "// Float door\n" +
      "export let root: Float = Float.pow(2.0, 0.5)\n" +
      "export let cube: Float = Float.pow(27.0, 1.0 / 3.0)\n" +
      "export let negativeExponent: Float = Float.pow(2.0, -0.5)\n" +
      "export let negativeBase: Float = Float.pow(-8.0, 3.0)\n",
    );

    expect(exports["root"]).toBe(Math.sqrt(2));
    expect(exports["cube"]).toBe(27 ** (1 / 3));
    expect(exports["negativeExponent"]).toBe(2 ** -0.5);
    expect(exports["negativeBase"]).toBe(-512);
  });

  test("the `NaN` edges are the host's, unaltered — the door never guards", async () => {
    const exports = await runMain(
      "// Float door edges\n" +
      "export let rootOfNegative: Float = Float.pow(-1.0, 0.5)\n" +
      "export let oneToNan: Float = Float.pow(1.0, Float.nan)\n" +
      "export let nanToZero: Float = Float.pow(Float.nan, 0.0)\n" +
      "export let overflow: Float = Float.pow(10.0, 400.0)\n" +
      "export let underflow: Float = Float.pow(10.0, -400.0)\n",
    );

    expect(exports["rootOfNegative"]).toBe(Number.NaN);
    // The host's two disagreeing corners, copied rather than corrected: JS
    // answers `NaN` for `1 ** NaN` (where C's `pow` answers 1) and `1` for
    // `NaN ** 0`. Copying the host is the standing stance at this type.
    expect(exports["oneToNan"]).toBe(1 ** Number.NaN);
    expect(exports["oneToNan"]).toBe(Number.NaN);
    expect(exports["nanToZero"]).toBe(1);
    expect(exports["overflow"]).toBe(Number.POSITIVE_INFINITY);
    expect(exports["underflow"]).toBe(0);
  });

  test("the member is the door restricted: `**` and the door agree on `Int` exponents", async () => {
    const exports = await runMain(
      "// Float agreement\n" +
      "let three: Int = 3\n" +
      "export let operator: Float = 2.0 ** three\n" +
      "export let door: Float = Float.pow(2.0, 3.0)\n" +
      "export let inverseOperator: Float = 2.0 ** -1\n" +
      "export let inverseDoor: Float = Float.pow(2.0, -1.0)\n",
    );

    expect(exports["operator"]).toBe(exports["door"]);
    expect(exports["inverseOperator"]).toBe(exports["inverseDoor"]);
    expect(exports["operator"]).toBe(8);
  });
});

describe("`BigInt.pow` — the exact power past `Int`'s range (Operators §6.3.1)", () => {
  test("the ordinary case, and the thin domain the door exists for", async () => {
    // `1n`, `-1n`, and `0n` answer at any non-negative exponent, which is where
    // an exponent past `Int`'s range is *defined* rather than merely large.
    const exports = await runMain(
      "// BigInt door\n" +
      "let huge: BigInt = 2n ** 64\n" +
      "export let eight: BigInt = BigInt.pow(2n, 3n)\n" +
      "export let unit: BigInt = BigInt.pow(1n, huge)\n" +
      "export let alternatingEven: BigInt = BigInt.pow(-1n, huge)\n" +
      "export let alternatingOdd: BigInt = BigInt.pow(-1n, huge + 1n)\n" +
      "export let vanishing: BigInt = BigInt.pow(0n, huge)\n",
    );

    expect(exports["eight"]).toBe(8n);
    expect(exports["unit"]).toBe(1n);
    expect(exports["alternatingEven"]).toBe(1n);
    expect(exports["alternatingOdd"]).toBe(-1n);
    expect(exports["vanishing"]).toBe(0n);
    // The host's own answers, for the same expressions.
    expect(exports["unit"]).toBe(1n ** 2n ** 64n);
    expect(exports["alternatingOdd"]).toBe((-1n) ** (2n ** 64n + 1n));
  });

  test("a negative exponent throws `NegativeExponentError`, exactly as `**` does", async () => {
    const exports = await runMain(
      "// BigInt door guard\n" +
      "export let boom(): BigInt = BigInt.pow(2n, -1n)\n" +
      "export let operatorBoom(): BigInt = 2n ** -1\n",
    );

    for (const name of ["boom", "operatorBoom"]) {
      expect(threw(exports[name] as () => unknown)).toMatchObject({
        name: "NegativeExponentError",
        message: "an integer exponent cannot be negative",
        $hex: "Pow",
      });
    }
  });

  test("the member converts its `Int` exponent explicitly — JS never mixes the two", async () => {
    // The pin that a raw `bigint ** number` would fail with a `TypeError`
    // rather than a wrong answer: it has to *run*.
    const source = "// BigInt member conversion\n" +
      "let ten: Int = 10\n" +
      "export let powered: BigInt = 2n ** ten\n";
    const exports = await runMain(source);

    expect(exports["powered"]).toBe(1024n);
    // The call site hands the plain `Int` across; the conversion is inside the
    // member, in `stdlib/BigInt.hex`.
    expect(emitted(source)).toContain("__Pow_BigInt.pow(2n, ten)");
  });
});

describe("qualifiable, not bare: the one-exporter guarantee (Modules §5.3)", () => {
  test("bare `pow` in a consumer is still the constraint member, at every type", async () => {
    // Two companions now export a `pow`, and neither reaches bare scope. If
    // either did, §5.5 would refuse this name outright — the collision
    // explosion the visibility rule exists to prevent.
    const exports = await runMain(
      "// bare pow\n" +
      "let raise<a: Pow>(base: a, exponent: Int): a = pow(base, exponent)\n" +
      "export let polymorphic: Int = raise(2, 10)\n" +
      "export let atInt: Int = pow(3, 4)\n" +
      "export let atFloat: Float = pow(2.0, -1)\n" +
      "export let atBigInt: BigInt = pow(2n, 10)\n" +
      "export let atNat: Nat = pow(2, 5)\n",
    );

    expect(exports["polymorphic"]).toBe(1024);
    expect(exports["atInt"]).toBe(81);
    expect(exports["atFloat"]).toBe(0.5);
    expect(exports["atBigInt"]).toBe(1024n);
    expect(exports["atNat"]).toBe(32);
  });

  test("bare `pow` and both qualified doors coexist in one module", async () => {
    // The single-exporter guarantee is not only about compiling: the bare name
    // and the two doors are three different bindings that all have to survive
    // into one emitted module, under names that do not collide.
    const exports = await runMain(
      "// three spellings\n" +
      "export let bare: Int = pow(2, 5)\n" +
      "export let floatDoor: Float = Float.pow(2.0, 0.5)\n" +
      "export let bigDoor: BigInt = BigInt.pow(2n, 3n)\n",
    );

    expect(exports["bare"]).toBe(32);
    expect(exports["floatDoor"]).toBe(Math.sqrt(2));
    expect(exports["bigDoor"]).toBe(8n);
  });

  test("a consumer may not import the door severally, any more than the member", () => {
    // It inherits the member's visibility rule whole: reached qualified and
    // through the dot, never as a bare name a consumer binds.
    const diagnostics = projectDiagnostics(
      "let shadow(value: Float, exponent: Float): Float = Float.pow(value, exponent)\n" +
      "export let r: Float = shadow(2.0, 0.5)\n",
    );

    expect(diagnostics).toEqual([]);
  });
});

describe("the dot call reaches the door as one claimant (Method Syntax §6.1)", () => {
  test("`x.pow(0.5)` at `Float` and `x.pow(2n)` at `BigInt` are ordinary dot calls", async () => {
    // Not the §6 two-source refusal: the export and the member are related by
    // the generalisation law, so they are one operation wearing two widths and
    // the dot resolves to the widest face.
    const exports = await runMain(
      "// dot calls\n" +
      "let two: Float = 2.0\n" +
      "let big: BigInt = 2n\n" +
      "export let root: Float = two.pow(0.5)\n" +
      "export let squared: BigInt = big.pow(2n)\n",
    );

    expect(exports["root"]).toBe(Math.sqrt(2));
    expect(exports["squared"]).toBe(4n);
  });

  test("the dot call is the companion-operation rewrite, not the member", () => {
    // Modules §5.3's resolution order: exported terms outrank honored-member
    // routes, so the emitted call is the door's own binding.
    const javascript = emitted(
      "// dot rewrite\n" +
      "let two: Float = 2.0\n" +
      "export let root: Float = two.pow(0.5)\n",
    );

    expect(javascript).toContain('pow as __prelude_pow');
    expect(javascript).toContain('from "./Float.js"');
    expect(javascript).not.toContain("__Pow_Float");
  });

  test("an unrelated same-spelled pair keeps the §6 refusal", () => {
    // The law's whole content is that a *lawful* pair is not two rivals. A
    // companion export beside a member of some other honored constraint is two
    // rivals, and the no-ranking doctrine refuses it exactly as before.
    const diagnostics = projectDiagnostics([
      "export constraint Loud<a> =",
      "    volume(value: a): Int",
      "",
      "export record Gauge = {reading: Int}",
      "",
      "honor Loud<Gauge> =",
      "    volume(value) = value.reading",
      "",
      "export let describe(value: Gauge, extra: Int): String = \"g\"",
      "",
      "export constraint Quiet<a> =",
      "    describe(value: a): String",
      "",
      "honor Quiet<Gauge> =",
      "    describe(value) = \"quiet\"",
      "",
      "export let r: String = Gauge({reading = 1}).describe(2)",
      "",
    ].join("\n"));

    expect(diagnostics).toContain(
      "`describe` after a dot is ambiguous at `Gauge`: a companion operation " +
        "`Gauge.describe`, `Quiet`'s member `describe`. Write `describe(…)`, or " +
        "`Gauge.describe(…)` for the companion operation.",
    );
  });
});

describe("the mandatory fixit at the exponent seat (Operators §6.3)", () => {
  test("a `Float` exponent names `Float.pow`", () => {
    expect(projectDiagnostics("export let r: Float = 2.0 ** 0.5\n")).toEqual([
      "the exponent of `**` is an `Int`; for a fractional exponent at `Float`, " +
        "use `Float.pow(value, exponent)`",
    ]);
  });

  test("a `BigInt` exponent names `BigInt.pow` — `2n ** 3n` is the target case", () => {
    expect(projectDiagnostics("export let r: BigInt = 2n ** 3n\n")).toEqual([
      "the exponent of `**` is an `Int`; for a `BigInt` exponent, use " +
        "`BigInt.pow(value, exponent)`",
    ]);
  });

  test("any other type takes the plain seat error, with no door named", () => {
    const diagnostics = projectDiagnostics(
      "export let r: Int = 2 ** \"three\"\n",
    );

    expect(diagnostics).toEqual(["type mismatch: expected Int, found String"]);
  });

  test("a `Nat` exponent widens into the seat rather than erroring", async () => {
    // §5.1's exact conversion applies *into* the exponent seat like any other
    // written-`Int` seat, so the one numeric type below `Int` is not a break.
    const exports = await runMain(
      "// Nat exponent\n" +
      "let count: Nat = 3\n" +
      "export let r: Int = 2 ** count\n",
    );

    expect(exports["r"]).toBe(8);
  });
});

/**
 * The law at a **user nominal**, which is where its three verdicts can be shown
 * side by side over one constraint. `Pow` is the constraint with a remaining
 * seat to widen — `Show` and `Eq` have none, so nothing there could generalise
 * — and its `Int` exponent reaches `Float` through §5.1's exact conversion.
 */
describe("the generalisation law's declaration-time check (Constraints §4.6)", () => {
  const box = [
    "export record Box = {value: Float}",
    "",
    "honor Num<Box> =",
    "    add(left, right) = Box({value = left.value + right.value})",
    "    multiply(left, right) = Box({value = left.value * right.value})",
    "    fromNat(value) = Box({value = Float.fromNat(value)})",
    "",
    "let core(value: Box, exponent: Float): Box =",
    "    Box({value = Float.pow(value.value, exponent)})",
    "",
  ].join("\n");

  const rebinding = "the `Pow<Box>` instance binds `pow`, which is already " +
    "bound (line 11); ";
  const law = "an exported binding of a member's spelling is legal only when " +
    "it properly generalises the member (Modules §5.3) — same subject seat, " +
    "same result, at least one remaining seat properly wider — so widen it or " +
    "choose a different name.";

  function verdict(door: string): readonly string[] {
    return projectDiagnostics([
      box,
      door,
      "",
      "honor Pow<Box> =",
      "    pow(value, exponent) = core(value, exponent)",
      "",
    ].join("\n"));
  }

  test("a properly widening export is legal, and both faces run", async () => {
    // The blessed idiom exactly: one implementation under a private name, the
    // door as its thin face, the member as the same implementation restricted.
    const exports = await runMain([
      box,
      "export let pow(value: Box, exponent: Float): Box = core(value, exponent)",
      "",
      "honor Pow<Box> =",
      "    pow(value, exponent) = core(value, exponent)",
      "",
      "export let door: Float = pow(Box({value = 4.0}), 0.5).value",
      "export let dotted: Float = Box({value = 4.0}).pow(0.5).value",
      "export let operator: Float = (Box({value = 2.0}) ** 3).value",
      "",
    ].join("\n"));

    expect(exports["door"]).toBe(2);
    // One claimant: the dot reaches the door, not the §6 refusal.
    expect(exports["dotted"]).toBe(2);
    // The operator always elaborates to the member.
    expect(exports["operator"]).toBe(8);
  });

  test("a bare in-module use beside the pair resolves to the export", () => {
    // Constraints §4.6's bare-use sentence at the prelude layer (#544): a lawful
    // pair is one operation, so the bare spelling means the export — the widest
    // face — and not the member. At a *shared-domain* argument (an `Int`
    // exponent, which both faces accept) the two answers are identical by the
    // behavioural law, so only the emitted route can say which one answered.
    const javascript = emitted([
      box,
      "export let pow(value: Box, exponent: Float): Box = core(value, exponent)",
      "",
      "honor Pow<Box> =",
      "    pow(value, exponent) = core(value, exponent)",
      "",
      "let two: Int = 2",
      "export let shared: Float = pow(Box({value = 3.0}), two).value",
      "",
    ].join("\n"));

    expect(javascript).toContain("const shared = pow({ value: 3.0 }, two).value;");
    // The instance's member seat exists; no bare use calls it.
    expect(javascript).toContain("const __Pow_Box_pow = ");
    expect(javascript).not.toContain("__Pow_Box_pow(");
    expect(javascript).not.toContain("__Pow_Box.pow(");
  });

  test("an identical signature generalises nothing and stays the rebinding error", () => {
    expect(verdict(
      "export let pow(value: Box, exponent: Int): Box = core(value, exponent)",
    )).toEqual([rebinding + law]);
  });

  test("a narrowing export is refused too — the law widens, never the reverse", () => {
    // The member takes an `Int` exponent; this export takes only a `Nat`, so it
    // does not accept every call the member accepts.
    expect(verdict(
      "export let pow(value: Box, exponent: Nat): Box = core(value, exponent)",
    )).toEqual([rebinding + law]);
  });

  test("a private binding is refused by the claim itself — the exemption is for exports", () => {
    expect(verdict(
      "let pow(value: Box, exponent: Float): Box = core(value, exponent)",
    )).toEqual([
      "the `Pow<Box>` instance binds `pow`, which is already bound (line 11); " +
        "Hexagon does not allow rebinding — choose a different name.",
    ]);
  });
});
