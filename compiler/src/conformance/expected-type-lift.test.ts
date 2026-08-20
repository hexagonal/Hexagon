/**
 * Conformance for Numeric Literals §5.1's **expected-type lift** — #517.
 *
 * > At an arithmetic operation whose expected type is **concrete** and carries
 * > the operator's constraint instance, the expected type **is** the
 * > operation's common type.
 *
 * The rule's reason is `let r: Rat = count + count`: without the lift the
 * addition runs at `Int` and only the finished sum is injected — an exact
 * conversion of a sum the silent-overflow `Int` addition may already have
 * folded past 2^53. So the observable pins are *values*, not verdicts, and the
 * ones that matter run at a wider-than-f64 home.
 *
 * Two boundaries close the rule, and each is pinned:
 *
 * - **No written face, no lift.** Arithmetic happens at the type written on its
 *   own seat, never one written somewhere later.
 * - **The instance gate.** A concrete expectation *without* the operator's
 *   instance lifts nothing, and the gated decline is identical to the ungated
 *   elaboration. Since `Rat` honors `Pow` (#523), the gate's remaining subjects
 *   are user nominals: at `let t: T = a ** b` for a `T` honoring `Num` and
 *   `Signed` but not `Pow`, the power runs at `Int` and the finished value
 *   injects. No in-tower written face is gated out any more — every tower face
 *   reachable by injection carries every operator whose operands can land at
 *   `Nat` or `Int`.
 *
 * Every graph here is byte-distinct where it executes: emitted modules mount as
 * `data:` URLs cached by their full text, so two tests compiling the same
 * program would share one module instance.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

const STDLIB = import.meta.glob("../../../stdlib/*.hex", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** `stdlib/Rat.hex`, the nominal home §5.1 names throughout. */
const RAT = (() => {
  const entry = Object.entries(STDLIB).find(([path]) => path.endsWith("/Rat.hex"));
  if (entry === undefined) throw new Error("no stdlib/Rat.hex");
  return entry[1];
})();

/** §5.1's fixtures. */
const fixtures = "let n: Nat = 7\n" +
  "let m: Nat = 2\n" +
  "let a: Int = 6\n" +
  "let b: Int = 4\n" +
  "let c: Int = 3\n" +
  "let count: Int = 3\n" +
  "let sum: Int = 7\n" +
  "let size: Int = 2\n" +
  "let negOne: Int = -1\n";

function verdict(source: string): readonly string[] {
  return projectDiagnostics(fixtures + source);
}

function withRat(source: string): readonly (readonly [string, string])[] {
  return [["/main.hex", `import * as Rat from "./Rat"\n${fixtures}${source}`], ["/Rat.hex", RAT]];
}

function ratVerdict(source: string): readonly string[] {
  return compileFiles(withRat(source)).diagnostics.map(({ message }) => message);
}

/** The same, for a `Rat` client: `/main.hex`'s JavaScript, project clean. */
function ratEmitted(source: string): string {
  const project = compileFiles(withRat(source));
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text;
}

/** `/main.hex`'s emitted JavaScript, with the project asserted clean. */
function emitted(source: string): string {
  const project = compileFiles([["/main.hex", fixtures + source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text;
}

// Proves the harness can see a failure rather than reporting every case green.
test("the harness reports a broken fixture block rather than passing it", () => {
  expect(verdict("export let broken: Int = missing(1)\n")).not.toEqual([]);
});

describe("the two acceptances", () => {
  test("`let x: Int = n - m` — `Nat` has no `Signed`, and the written face has", () => {
    // An operation whose operand types alone support no instance is well-typed
    // exactly when a written face names an algebra that embeds them.
    expect(verdict("export let x: Int = n - m\n")).toEqual([]);
    // The boundary: without the face, `Nat` subtraction has nowhere to go.
    expect(verdict("export let x: Nat = n - m\n"))
      .toEqual(["type `Nat` has no `Signed` instance"]);
  });

  test("`let mean: Float = sum / size` — `Int` has no `Frac`, and `Float` has", () => {
    expect(verdict("export let mean: Float = sum / size\n")).toEqual([]);
    expect(verdict("export let mean: Int = sum / size\n"))
      .toEqual(["type `Int` has no `Frac` instance"]);
  });

  test("`let r: Rat = a / b` — the same acceptance at a nominal home", () => {
    expect(ratVerdict("export let r: Rat.Rat = a / b\n")).toEqual([]);
  });
});

describe("observable exactness at a wider-than-f64 home", () => {
  test("the lifted sum is exact where the `Int` sum has already folded", async () => {
    // 2^53 - 1 plus 2 is not representable as a double: the `Int` addition
    // folds it to 2^53, and only then injects. The lift runs the addition at
    // `BigInt` and the value survives. This *is* the rule's reason.
    const exports = await runProject([["/main.hex",
      "// exactness at BigInt\n" +
      "let large: Int = 9007199254740991\n" +
      "let two: Int = 2\n" +
      "export let lifted: BigInt = large + two\n" +
      "let folded = large + two\n" +
      "export let injected: BigInt = folded\n",
    ]]);
    expect(exports["lifted"]).toBe(9007199254740993n);
    expect(exports["injected"]).toBe(9007199254740992n);
  });

  test("a `Rat` sum is the home type's addition of injected operands", async () => {
    const exports = await runProject(withRat(
      "// Rat home\n" +
      "export let r: String = \"${(count + count : Rat.Rat)}\"\n",
    ));
    expect(exports["r"]).toBe("6/1");
  });

  test("each operand is converted once, in source order", () => {
    // `let r: BigInt = a + b` emits `BigInt`'s addition over two conversions,
    // not one conversion of the finished `Int` sum.
    expect(emitted("export let r: BigInt = a + b\n"))
      .toContain("BigInt(a) + BigInt(b)");
  });
});

describe("the `Pow` home selection", () => {
  test("`let x: Float = 2 ** negOne` is the native, total `**` — no guard", async () => {
    const exports = await runProject([["/main.hex",
      "// Pow home\n" +
      "let negOne: Int = -1\n" +
      "export let x: Float = 2 ** negOne\n",
    ]]);
    expect(exports["x"]).toBe(0.5);
  });

  test("`let r: Rat = a ** b` lifts to `Pow<Rat>` — the acceptance #523 inverted", () => {
    // Was the gated decline, on the strength of `Pow` having no `Rat`. `Rat`
    // honors `Pow` now, so the written face names the algebra here too: the
    // power runs at `Rat`, exactly, and it is total *here* by construction —
    // an injected operand is integer-valued, so the instance's integrality
    // guard is passed before it is asked.
    expect(ratVerdict("export let r: Rat.Rat = a ** b\n")).toEqual([]);
    // Acceptance alone cannot tell the lift from the decline it replaced —
    // both compile clean. The selection is what changed, so pin it: the power
    // is `Pow<Rat>`'s member over two converted operands, not `Pow<Int>`'s
    // finished value injected.
    expect(ratEmitted("export let r: Rat.Rat = a ** b\n"))
      .toContain("__Pow_Rat.pow(");
  });

  test("`let r: Rat = b ** negOne` is exactly `1/4` — the negative exponent", async () => {
    // The pin that discriminates three elaborations: `Pow<Rat>` answers `1/4`;
    // the retired decline ran the power at `Int` and threw
    // `NegativeExponentError`; a `Pow<Float>` leak would answer `0.25`.
    const exports = await runProject(withRat(
      "// Rat power\n" +
      "let quarter: Rat.Rat = b ** negOne\n" +
      "export let top: BigInt = Rat.top(quarter)\n" +
      "export let bottom: BigInt = Rat.bottom(quarter)\n" +
      "export let shown: String = \"${quarter}\"\n",
    ));
    expect(exports["top"]).toBe(1n);
    expect(exports["bottom"]).toBe(4n);
    expect(exports["shown"]).toBe("1/4");
  });

  test("the gated decline, at the gate's remaining subject: a user nominal", async () => {
    // A nominal honoring `Num` and `Signed` but not `Pow`. The instance gate is
    // a boundary, and it is what keeps every gated decline identical to the
    // ungated elaboration — the power runs at `Int` and the finished value
    // injects, exactly as §5.1 always read.
    const nominal = "// gated decline\n" +
      "export opaque record Boxed = { inner: Int }\n" +
      "honor Num<Boxed> =\n" +
      "    add(left, right) = Boxed({inner = left.inner + right.inner})\n" +
      "    multiply(left, right) = Boxed({inner = left.inner * right.inner})\n" +
      "    fromNat(value) = Boxed({inner = Int.fromNat(value)})\n" +
      "honor Signed<Boxed> =\n" +
      "    subtract(left, right) = Boxed({inner = left.inner - right.inner})\n" +
      "    negate(value) = Boxed({inner = -value.inner})\n" +
      "    fromInt(value) = Boxed({inner = value})\n" +
      "export let unbox(value: Boxed): Int = value.inner\n" +
      "export let t: Boxed = a ** b\n" +
      "export let declined: Int = unbox(t)\n";

    expect(verdict(nominal)).toEqual([]);
    // 6 ** 4 at `Int`, then injected: the value a lift could not have produced,
    // since `Boxed` has no power of its own to run.
    const exports = await runProject([["/main.hex", fixtures + nominal]]);
    expect(exports["declined"]).toBe(1296);
    // The elaboration shape: `Signed<Boxed>.fromInt` wrapping the finished
    // `Int` power, not an operation at `Boxed`.
    expect(emitted(nominal))
      .toContain("__Signed_Boxed.fromInt(__Pow_Int.pow(a, b))");
  });
});

describe("the boundaries", () => {
  test("the no-face boundary: `let s = count + count` stays `Int`", () => {
    // Arithmetic happens at the type written on *its own* seat, never one
    // written somewhere later: the finished `Int` value widens at the second
    // binding's annotation, exactly as written.
    const project = compileFiles([["/main.hex", `${fixtures}let s = count + count\n` +
      "export let r: BigInt = s\n"]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ source: file }) => file.path === "/main.hex")!;
    const scheme = main.typed.symbols.find((candidate) => candidate.name === "s")!.scheme;
    expect(scheme.type).toMatchObject({ kind: "Primitive", name: "Int" });
  });

  test("a variable expectation lifts nothing", () => {
    // Only a *concrete* expectation is a home. At a generic parameter the
    // operation elaborates from its operands alone, exactly as it always did.
    const source = fixtures +
      "let g(value: a): String = \"x\"\n" +
      "export let r: String = g(count + count)\n";
    expect(projectDiagnostics(source)).toEqual([]);
  });

  test("a concrete expectation without the instance lifts nothing", () => {
    // `String` is concrete and carries no `Num`, so the addition elaborates
    // from its operands and the seat reports its own ordinary mismatch. No
    // diagnostic names the lift.
    const diagnostics = verdict("export let r: String = count + count\n");
    expect(diagnostics).toEqual(["type mismatch: expected String, found Int"]);
  });
});

describe("the recursion", () => {
  test("`let r: Rat = (a + b) * c` runs entirely at `Rat`", async () => {
    // An operand seat of a lifted operation expects the same type, so a whole
    // arithmetic expression runs at its written type.
    const exports = await runProject(withRat(
      "// nested Rat\n" +
      "export let r: String = \"${((a + b) * c : Rat.Rat)}\"\n",
    ));
    expect(exports["r"]).toBe("30/1");
  });

  test("the recursion reaches every operand, at a `BigInt` home", () => {
    expect(emitted("export let r: BigInt = (a + b) * c\n"))
      .toContain("(BigInt(a) + BigInt(b)) * BigInt(c)");
  });

  test("the recursion is observable in the value, not only the emission", async () => {
    // A nested sum that folds past 2^53 at `Int`. If the home reached only the
    // outermost operation, the inner sum would elaborate at `Int` and the
    // finished, already-folded value would inject.
    const exports = await runProject([["/main.hex",
      "// nested exactness\n" +
      "let large: Int = 9007199254740991\n" +
      "let two: Int = 2\n" +
      "let unit: Int = 1\n" +
      "export let r: BigInt = (large + two) * unit\n",
    ]]);
    expect(exports["r"]).toBe(9007199254740993n);
  });

  test("unary negation is a lifted operation too", () => {
    expect(verdict("export let r: BigInt = -a\n")).toEqual([]);
    expect(emitted("export let r: BigInt = -a\n")).toContain("-BigInt(a)");
  });

  test("negation lifts a `Nat` operand too — the `Num.fromNat` route", () => {
    // `Nat` has no `Signed`, so `-n` is well-typed exactly when a written face
    // names an algebra that embeds it. `Float` erases, so the conversion is
    // invisible there and the verdict is the whole pin; `BigInt` shows the
    // converted operand. This is the only path through the `Nat` conversion in
    // the unary arm — the `Int` case above takes the `Signed.fromInt` one.
    expect(verdict("export let x: Nat = -n\n"))
      .toEqual(["type `Nat` has no `Signed` instance"]);
    expect(verdict("export let x: Float = -n\n")).toEqual([]);
    expect(emitted("export let x: Float = -n\n")).toContain("-n");
    expect(verdict("export let x: BigInt = -n\n")).toEqual([]);
    expect(emitted("export let x: BigInt = -n\n")).toContain("-BigInt(n)");
  });
});

describe("the landing pair (Functions §4.3)", () => {
  test("both written faces compile, and emit the `Int` addition's JavaScript", () => {
    // `Float` erases to the same representation, so the lifted emission is
    // byte-identical to the result-injected one — the same JavaScript `+` on
    // the same doubles.
    const supplied = emitted("let g: (Int) -> Float = x => x + x\n" +
      "export let out: Float = g(2)\n");
    const written = emitted("let g = (x: Int): Float => x + x\n" +
      "export let out: Float = g(2)\n");
    expect(supplied).toContain("x => x + x");
    expect(supplied).toBe(written);
  });
});

describe("the forwarding forms conduct the home", () => {
  test("an `if` arm is a forwarding position, and its arithmetic lifts", () => {
    // Operators §11: a landed expected type reaches both arms, where it feeds
    // the lift at an arithmetic arm.
    expect(verdict("export let r: BigInt = if a > b then a + b else c\n")).toEqual([]);
    expect(emitted("export let r: BigInt = if a > b then a + b else c\n"))
      .toContain("BigInt(a) + BigInt(b)");
  });

  test("an ascription supplies the home", () => {
    expect(emitted("export let r: BigInt = (a + b : BigInt)\n"))
      .toContain("BigInt(a) + BigInt(b)");
  });

  test("an annotated `var` and its `:=` right-hand side both supply", () => {
    expect(verdict(
      "export let run(): BigInt =\n" +
        "    var total: BigInt = a + b\n" +
        "    total := a * c\n" +
        "    total\n",
    )).toEqual([]);
  });

  test("a call argument's parameter type supplies the home", () => {
    expect(verdict(
      "let take(value: BigInt): BigInt = value\n" +
        "export let r: BigInt = take(a + b)\n",
    )).toEqual([]);
    expect(emitted(
      "let take(value: BigInt): BigInt = value\n" +
        "export let r: BigInt = take(a + b)\n",
    )).toContain("BigInt(a) + BigInt(b)");
  });
});
