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
 *   elaboration — `Pow` has no `Rat`, so `let r: Rat = a ** b` runs the power at
 *   `Int` and injects the finished value.
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

  test("the gated decline: `Pow` has no `Rat`, so the power runs at `Int`", () => {
    // The instance gate is a boundary, and it is what keeps every gated decline
    // identical to the ungated elaboration — the finished `Int` value injects,
    // exactly as §5.1 always read.
    expect(ratVerdict("export let r: Rat.Rat = a ** b\n")).toEqual([]);
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

  test("unary negation is a lifted operation too", () => {
    expect(verdict("export let r: BigInt = -a\n")).toEqual([]);
    expect(emitted("export let r: BigInt = -a\n")).toContain("-BigInt(a)");
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
