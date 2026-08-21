import { describe, expect, test } from "vitest";

import {
  compileFiles,
  compileMain,
  projectDiagnostics,
  runMain,
  runProject,
} from "../support/test-project.js";

/**
 * Conformance for **the two power doors and the `widens` declaration that
 * carries them** — #541, respelled as a declaration form by #546; Constraints
 * §4.7, Operators §6.3.1, Modules §5.3, Method Syntax §6.1, Primitive Types
 * §3/§5.
 *
 * `**` is the algebraist's power and its exponent is an `Int` by type. The two
 * operations that seat leaves unspellable get named doors instead:
 *
 * - **`widens Pow.pow(value: Float, exponent: Float): Float`** — the analytic
 *   power, total and honestly IEEE.
 * - **`widens Pow.pow(value: BigInt, exponent: BigInt): BigInt`** — the exact
 *   power at exponents past `Int`'s range.
 *
 * Each declares a member it widens, a signature that must widen properly, and
 * **one body**: the `Pow` member is that body's derived restriction, accounted
 * for in the honor block as `pow = widened`, never written. The binding is
 * *qualifiable, not a bare export* — bare `pow` in a consumer still has exactly
 * one exporter, `Pow.hex`'s member — and the dot call reaches the door as *one
 * claimant* rather than a §6 collision.
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
    // Since #546 this is true *by construction* — the member is the door called
    // at the member's seats, derived rather than written — so the pin measures
    // that the derivation actually runs, on the whole shared domain.
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
    // One guard, in one body: the member reaches it by being that body
    // restricted (§4.7), so the two faces cannot drift apart.
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

  test("the derivation converts the `Int` exponent explicitly — JS never mixes the two", async () => {
    // The pin that a raw `bigint ** number` would fail with a `TypeError`
    // rather than a wrong answer: it has to *run*. Since #546 no source line
    // writes the conversion — the derived member's call lands in the door's
    // `BigInt` seat, and Numeric Literals §5.1's exact conversion is inserted
    // there like at any other seat.
    const source = "// BigInt member conversion\n" +
      "let ten: Int = 10\n" +
      "export let powered: BigInt = 2n ** ten\n";
    const exports = await runMain(source);

    expect(exports["powered"]).toBe(1024n);
    // The call site hands the plain `Int` across; the conversion is inside the
    // derived member, in `stdlib/BigInt.hex`'s instance.
    expect(emitted(source)).toContain("__Pow_BigInt.pow(2n, ten)");
  });
});

describe("qualifiable, not bare: the one-exporter guarantee (Modules §5.3)", () => {
  test("bare `pow` in a consumer is still the constraint member, at every type", async () => {
    // Two companions now widen a `pow`, and neither reaches bare scope. If
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

  test("a local name of the door's spelling is an ordinary binding", () => {
    // It inherits the member's visibility rule whole: reached qualified and
    // through the dot, never as a bare name a consumer binds.
    const diagnostics = projectDiagnostics(
      "let shadow(value: Float, exponent: Float): Float = Float.pow(value, exponent)\n" +
      "export let r: Float = shadow(2.0, 0.5)\n",
    );

    expect(diagnostics).toEqual([]);
  });

  test("a consumer may not import a `widens` binding severally, any more than the member", () => {
    // The same law one step out (Constraints §4.7): a named import is bare
    // scope, and the binding does not enter one.
    const diagnostics = compileFiles([
      ["/box.hex", [
        "// importable door",
        "export record Box = {value: Float}",
        "",
        "honor Num<Box> =",
        "    add(left, right) = Box({value = left.value + right.value})",
        "    multiply(left, right) = Box({value = left.value * right.value})",
        "    fromNat(value) = Box({value = Float.fromNat(value)})",
        "",
        "widens Pow.pow(value: Box, exponent: Float): Box =",
        "    Box({value = Float.pow(value.value, exponent)})",
        "",
        "honor Pow<Box> =",
        "    pow = widened",
        "",
      ].join("\n")],
      ["/main.hex", [
        "// severally",
        "import { pow } from \"./box\"",
        "",
      ].join("\n")],
    ]).diagnostics.map(({ message }) => message);

    expect(diagnostics).toEqual([
      "`pow` is a constraint member's wider face; it is qualifiable, not a bare " +
        "export — reach it through `import * as` and its qualified spelling",
    ]);
  });
});

describe("the dot call reaches the door as one claimant (Method Syntax §6.1)", () => {
  test("`x.pow(0.5)` at `Float` and `x.pow(2n)` at `BigInt` are ordinary dot calls", async () => {
    // Not the §6 two-source refusal: the `widens` binding and the member it
    // supplies are one operation wearing two widths, so the dot resolves to the
    // widest face.
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
    // Modules §5.3's resolution order: the module's terms outrank honored-member
    // routes, so the emitted call is the `widens` binding itself.
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
    // rivals, and the no-ranking doctrine refuses it exactly as before. The two
    // claimants have to live in different modules now, because within one the
    // export would be the unconditional rebinding error (§4.6, #546).
    const diagnostics = compileFiles([
      ["/gauge.hex", [
        "// gauge",
        "export record Gauge = {reading: Int}",
        "",
        "export let describe(value: Gauge, extra: Int): String = \"g\"",
        "",
      ].join("\n")],
      ["/quiet.hex", [
        "// quiet",
        "import * as Gauge from \"./gauge\"",
        "",
        "export constraint Quiet<a> =",
        "    describe(value: a): String",
        "",
        "honor Quiet<Gauge.Gauge> =",
        "    describe(value) = \"quiet\"",
        "",
      ].join("\n")],
      ["/main.hex", [
        "// rivals",
        "import * as Gauge from \"./gauge\"",
        "import * as Quiet from \"./quiet\"",
        "",
        "export let r: String = Gauge.Gauge({reading = 1}).describe(2)",
        "",
      ].join("\n")],
    ]).diagnostics.map(({ message }) => message);

    expect(diagnostics).toContain(
      "`describe` after a dot is ambiguous at `Gauge`: a companion operation " +
        "`Gauge.describe`, `Quiet`'s member `describe`. Write `Quiet.describe(…)`, " +
        "or `Gauge.describe(…)` for the companion operation.",
    );
  });
});

/**
 * The law at a **user nominal**, which is where its verdicts can be shown side
 * by side over one constraint. `Pow` is the constraint with a remaining seat to
 * widen — `Show` and `Eq` have none, so nothing there could generalise — and
 * its `Int` exponent reaches `Float` through §5.1's exact conversion.
 *
 * The module below puts the door on **line 8** and the `Pow<Box>` block on line
 * 10, which are the lines the refusals name.
 */
describe("the `widens` declaration at a user nominal (Constraints §4.7)", () => {
  const box = [
    "export record Box = {value: Float}",
    "",
    "honor Num<Box> =",
    "    add(left, right) = Box({value = left.value + right.value})",
    "    multiply(left, right) = Box({value = left.value * right.value})",
    "    fromNat(value) = Box({value = Float.fromNat(value)})",
    "",
  ].join("\n");

  const DOOR = "widens Pow.pow(value: Box, exponent: Float): Box = " +
    "Box({value = Float.pow(value.value, exponent)})";

  /** The module, with `head` standing where the `widens` declaration goes. */
  function module(head: string, ...extra: readonly string[]): string {
    return [
      box,
      head,
      "",
      "honor Pow<Box> =",
      "    pow = widened",
      "",
      ...extra,
    ].join("\n");
  }

  function verdict(head: string, ...extra: readonly string[]): readonly string[] {
    return projectDiagnostics(module(head, ...extra));
  }

  test("a properly widening declaration is legal, and every face runs", async () => {
    const exports = await runMain(module(
      DOOR,
      "export let door: Float = pow(Box({value = 4.0}), 0.5).value",
      "export let dotted: Float = Box({value = 4.0}).pow(0.5).value",
      "export let operator: Float = (Box({value = 2.0}) ** 3).value",
      "",
    ));

    expect(exports["door"]).toBe(2);
    // One claimant: the dot reaches the door, not the §6 refusal.
    expect(exports["dotted"]).toBe(2);
    // The operator always elaborates to the member — the door's restriction.
    expect(exports["operator"]).toBe(8);
  });

  test("the member is the one body restricted: `**` and the door agree", async () => {
    const exports = await runMain(module(
      DOOR,
      "let three: Int = 3",
      "export let viaOperator: Float = (Box({value = 2.0}) ** three).value",
      "export let viaDoor: Float = pow(Box({value = 2.0}), 3.0).value",
      "",
    ));

    expect(exports["viaOperator"]).toBe(exports["viaDoor"]);
    expect(exports["viaOperator"]).toBe(8);
  });

  test("a bare in-module use beside the pair resolves to the widens binding", () => {
    // Constraints §4.6's bare-use sentence: a lawful pair is one operation, so
    // the bare spelling means the widens binding — the widest face — and not the
    // derived member. At a *shared-domain* argument (an `Int` exponent, which
    // both faces accept) the two answers are identical by construction, so only
    // the emitted route can say which one answered.
    const javascript = emitted(module(
      DOOR,
      "let two: Int = 2",
      "export let shared: Float = pow(Box({value = 3.0}), two).value",
      "",
    ));

    expect(javascript).toContain("const shared = pow({ value: 3.0 }, two).value;");
    // The instance's member seat exists; no bare use calls it.
    expect(javascript).toContain("const __Pow_Box_pow = ");
    expect(javascript).not.toContain("__Pow_Box_pow(");
    expect(javascript).not.toContain("__Pow_Box.pow(");
  });

  test("an identical signature generalises nothing", () => {
    expect(verdict(
      "widens Pow.pow(value: Box, exponent: Int): Box = " +
        "Box({value = Float.pow(value.value, Float.fromInt(exponent))})",
    )).toEqual([
      "this declaration does not widen `Pow.pow`: an identical signature " +
        "generalises nothing",
    ]);
  });

  test("a narrowing declaration is refused — the law widens, never the reverse", () => {
    // The member takes an `Int` exponent; this one takes only a `Nat`, so it
    // does not accept every call the member accepts.
    expect(verdict(
      "widens Pow.pow(value: Box, exponent: Nat): Box = " +
        "Box({value = Float.pow(value.value, Float.fromNat(exponent))})",
    )).toEqual([
      "this declaration does not widen `Pow.pow`: `Int` does not reach the seat " +
        "`Nat` exactly",
    ]);
  });

  test("a wider result is refused: the member could not restrict back", () => {
    expect(verdict(
      "widens Pow.pow(value: Box, exponent: Float): Float = " +
        "Float.pow(value.value, exponent)",
    )).toEqual([
      "this declaration does not widen `Pow.pow`: the result is `Box`, not " +
        "`Float` — the member is this declaration's restriction, and a wider " +
        "result could not restrict back",
    ]);
  });

  test("a different subject seat is refused: a door widens across seats, not types", () => {
    expect(verdict(
      "widens Pow.pow(value: Float, exponent: Float): Box = " +
        "Box({value = Float.pow(value, exponent)})",
    )).toEqual([
      "this declaration does not widen `Pow.pow`: the subject seat is `Box`, " +
        "not `Float` — a door widens across seats at one type, never across types",
    ]);
  });

  test("an ordinary export of the spelling is refused, with the rewrite into the form", () => {
    // §4.6's claim is unconditional since #546: no export is exempt. What a
    // would-have-widened export earns is the mechanical rewrite.
    expect(verdict(
      "export let pow(value: Box, exponent: Float): Box = " +
        "Box({value = Float.pow(value.value, exponent)})",
      "",
    )).toEqual([
      "the `Pow<Box>` instance binds `pow`, which is already bound (line 8); a " +
        "member's wider face is declared, not exported — write `widens " +
        "Pow.pow(…)` and account for the member with `pow = widened`.",
      "`pow = widened` accounts for a `widens Pow.pow` declaration this module " +
        "does not contain",
    ]);
  });

  test("an export that would not have widened keeps the plain rebinding refusal", () => {
    expect(verdict(
      "export let pow(value: Box, exponent: Int): Box = value",
      "",
    )).toEqual([
      "the `Pow<Box>` instance binds `pow`, which is already bound (line 8); " +
        "Hexagon does not allow rebinding — choose a different name.",
      "`pow = widened` accounts for a `widens Pow.pow` declaration this module " +
        "does not contain",
    ]);
  });

  test("a private binding of the spelling is refused by the claim itself", () => {
    expect(verdict(
      "let pow(value: Box, exponent: Float): Box = value",
      "",
    )).toEqual([
      "the `Pow<Box>` instance binds `pow`, which is already bound (line 8); " +
        "Hexagon does not allow rebinding — choose a different name.",
      "`pow = widened` accounts for a `widens Pow.pow` declaration this module " +
        "does not contain",
    ]);
  });
});

describe("the manifest and the head (Constraints §4.7)", () => {
  const box = [
    "export record Box = {value: Float}",
    "",
    "honor Num<Box> =",
    "    add(left, right) = Box({value = left.value + right.value})",
    "    multiply(left, right) = Box({value = left.value * right.value})",
    "    fromNat(value) = Box({value = Float.fromNat(value)})",
    "",
  ].join("\n");

  const DOOR = "widens Pow.pow(value: Box, exponent: Float): Box = " +
    "Box({value = Float.pow(value.value, exponent)})";

  test("a `widened` line with no matching declaration is refused, naming it", () => {
    expect(projectDiagnostics([
      box,
      "honor Pow<Box> =",
      "    pow = widened",
      "",
    ].join("\n"))).toEqual([
      "`pow = widened` accounts for a `widens Pow.pow` declaration this module " +
        "does not contain",
    ]);
  });

  test("a block that does not account for a widened member is refused", () => {
    // Absence keeps its exact prior meanings only because the line is required
    // whenever the supply route is used: two mechanisms never hide behind one
    // absence. Shown over a two-member constraint, so the block still has a
    // line to write and the missing one is visibly the widened member's.
    expect(compileFiles([
      ["/scale.hex", [
        "// scale",
        "export constraint Scale<a> =",
        "    scale(value: a, factor: Int): a",
        "    label(value: a): String",
        "",
      ].join("\n")],
      ["/matrix.hex", [
        "// matrix",
        "import * as Scale from \"./scale\"",
        "",
        "export record Matrix = {n: Float}",
        "",
        "widens Scale.scale(value: Matrix, factor: Float): Matrix =",
        "    Matrix({n = value.n * factor})",
        "",
        "honor Scale.Scale<Matrix> =",
        "    label(value) = \"matrix\"",
        "",
      ].join("\n")],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "this instance does not account for `scale`, which this module's `widens` " +
        "declaration supplies (line 6) — write `scale = widened` in the block",
      "instance is missing required member `scale`",
    ]);
  });

  test("a member written beside a `widens` of it is refused as a rival", () => {
    expect(projectDiagnostics([
      box,
      DOOR,
      "",
      "honor Pow<Box> =",
      "    pow(value, exponent) = value",
      "",
    ].join("\n"))).toEqual([
      "`pow` is supplied by this module's `widens` declaration (line 8); a " +
        "member written beside it would be a second implementation — account " +
        "for it with `pow = widened`",
    ]);
  });

  test("a second `widens` of one member is the ordinary rebinding refusal", () => {
    // Two declarations of one member necessarily share the derived name, so the
    // rivalry is refused by the binding rule that has always refused it.
    expect(projectDiagnostics([
      box,
      DOOR,
      "",
      DOOR,
      "",
      "honor Pow<Box> =",
      "    pow = widened",
      "",
    ].join("\n"))).toEqual([
      "`pow` is already bound (line 8); Hexagon does not allow rebinding — " +
        "choose a different name.",
    ]);
  });

  test("a head naming a member this module does not honor is refused at the head", () => {
    expect(projectDiagnostics([
      "export record Box = {value: Float}",
      "",
      "widens Show.show(value: Box, extra: Int): String = \"box\"",
      "",
    ].join("\n"))).toEqual([
      "`Show.show` is not a member this module honors at its own type",
    ]);
  });

  test("a head naming no member at all is refused at the head", () => {
    expect(projectDiagnostics([
      "export record Box = {value: Float}",
      "",
      "widens Float.nan(value: Box, extra: Int): Box = value",
      "",
    ].join("\n"))).toEqual([
      "`Float.nan` is not a constraint member; a `widens` head names one",
    ]);
  });

  test("a head through no module alias cannot be spelled at all", () => {
    // The reach doctrine self-enforcing: qualification is module aliases only,
    // so where no alias is in scope the head has no spelling (§4.6, §2.2).
    expect(projectDiagnostics([
      "export record Box = {value: Float}",
      "",
      "widens Nowhere.pow(value: Box, exponent: Float): Box = value",
      "",
    ].join("\n"))).toEqual(["unknown module `Nowhere`"]);
  });
});

describe("several same-spelled members: widen all of them or none (§4.7)", () => {
  /** A second constraint with a `pow` member, in its own module. */
  const mul = [
    "// mul",
    "export constraint Mul<a> =",
    "    pow(value: a, exponent: Int): a",
    "",
    "// The polymorphic face, written on the declaring side: bare `pow` here is",
    "// the member's forwarder, and the evidence rides the call.",
    "export let cubed<a: Mul>(value: a): a = pow(value, 3)",
    "",
  ].join("\n");

  function boxModule(...tail: readonly string[]): string {
    return [
      "// box",
      "import * as Mul from \"./mul\"",
      "",
      "export record Box = {value: Float}",
      "",
      "honor Num<Box> =",
      "    add(left, right) = Box({value = left.value + right.value})",
      "    multiply(left, right) = Box({value = left.value * right.value})",
      "    fromNat(value) = Box({value = Float.fromNat(value)})",
      "",
      ...tail,
    ].join("\n");
  }

  function verdict(...tail: readonly string[]): readonly string[] {
    return compileFiles([
      ["/mul.hex", mul],
      ["/box.hex", boxModule(...tail)],
    ]).diagnostics.map(({ message }) => message);
  }

  test("listing one of two is refused, naming the constraint left out", () => {
    expect(verdict(
      "widens Pow.pow(value: Box, exponent: Float): Box =",
      "    Box({value = Float.pow(value.value, exponent)})",
      "",
      "honor Pow<Box> =",
      "    pow = widened",
      "",
      "honor Mul.Mul<Box> =",
      "    pow(value, exponent) = value",
      "",
    )).toContain(
      "this module also honors `Mul.Mul`, whose `pow` this declaration does not " +
        "list — list it, or the binding cannot take this spelling",
    );
  });

  test("listing both is legal, and each member is the one body's restriction", async () => {
    // Two constraints, two derived members, one written body — and the two
    // members agree on their overlap because each is that body restricted.
    // `Mul.cubed` reaches its member genuinely polymorphically, from the
    // declaring side, so nothing here can be answered by the door by accident.
    const exports = await runProject([
      ["/mul.hex", mul],
      ["/box.hex", boxModule(
        "widens Pow.pow, Mul.pow(value: Box, exponent: Float): Box =",
        "    Box({value = Float.pow(value.value, exponent)})",
        "",
        "honor Pow<Box> =",
        "    pow = widened",
        "",
        "honor Mul.Mul<Box> =",
        "    pow = widened",
        "",
        "export let door: Float = pow(Box({value = 4.0}), 0.5).value",
        "export let viaPow: Float = (Box({value = 2.0}) ** 3).value",
        "export let viaMul: Float = Mul.cubed(Box({value = 2.0})).value",
        "",
      )],
    ], { entry: "/box.hex" });

    expect(exports["viaPow"]).toBe(8);
    expect(exports["viaMul"]).toBe(8);
    expect(exports["door"]).toBe(2);
  });
});

describe("where a `widens` declaration may stand (Declarations Preamble §7.1)", () => {
  test("inside a function body it joins the declarations-live-at-module-level family", () => {
    expect(projectDiagnostics([
      "export let f(): Int =",
      "    widens Pow.pow(value: Int, exponent: Int): Int = value",
      "    1",
      "",
    ].join("\n"))).toContain("`widens` declarations are made at module level");
  });

  test("`export widens` is refused in the form's own words", () => {
    expect(projectDiagnostics([
      "export record Box = {value: Float}",
      "",
      "export widens Pow.pow(value: Box, exponent: Float): Box = value",
      "",
    ].join("\n"))).toContain(
      "a `widens` declaration is qualifiable, not a bare export; `export` does " +
        "not apply",
    );
  });

  test("`widens` and `widened` stay ordinary names everywhere else", async () => {
    // Contextual, not reserved (Lexer §4.2): both spellings are still binders,
    // parameters, and fields.
    const exports = await runMain(
      "// contextual\n" +
      "let widens: Int = 2\n" +
      "let widened(widens: Int): Int = widens + 1\n" +
      "export let r: Int = widened(widens)\n",
    );

    expect(exports["r"]).toBe(3);
  });
});

describe("the mandatory fixit at the exponent seat (Operators §6.3, #545)", () => {
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

  test("a user type's own door is named on exactly the same terms", () => {
    // The two stdlib doors are instances of the lookup, not its content: the
    // fixit reads the registry of `widens` declarations at the value's type.
    expect(projectDiagnostics([
      "export record Box = {value: Float}",
      "",
      "honor Num<Box> =",
      "    add(left, right) = Box({value = left.value + right.value})",
      "    multiply(left, right) = Box({value = left.value * right.value})",
      "    fromNat(value) = Box({value = Float.fromNat(value)})",
      "",
      "widens Pow.pow(value: Box, exponent: Float): Box =",
      "    Box({value = Float.pow(value.value, exponent)})",
      "",
      "honor Pow<Box> =",
      "    pow = widened",
      "",
      "export let r: Box = Box({value = 2.0}) ** 0.5",
      "",
    ].join("\n"))).toEqual([
      "the exponent of `**` is an `Int`; for a fractional exponent at `Box`, " +
        "use `Box.pow(value, exponent)`",
    ]);
  });

  test("a type with no door takes the plain seat error, with no door named", () => {
    const diagnostics = projectDiagnostics(
      "export let r: Int = 2 ** \"three\"\n",
    );

    expect(diagnostics).toEqual(["type mismatch: expected Int, found String"]);
  });

  test("a `Float` exponent at a doorless type names no door either", () => {
    // The claim would be false: there is no `widens Pow.pow` at `Nat`.
    expect(projectDiagnostics(
      "let n: Nat = 2\nexport let r: Nat = n ** 0.5\n",
    )).toEqual(["type mismatch: expected Int, found Float"]);
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
