import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for **`honor Pow<Rat>` and its integer-exponent guard** — #523,
 * `rat.md` §4/§8/§9 and Operators §6.3's `Rat` row.
 *
 * `Rat` is exact at integer-valued exponents of *either* sign — the predicate is
 * a canonical bottom of `1n` — so `(2/3) ** (-2/1)` is exactly `9/4`, the case
 * `Pow<Int>` structurally cannot serve. A non-integer exponent throws
 * `FractionalExponentError` (`stdlib/Pow.hex`, beside `NegativeExponentError`):
 * an irrational result cannot be a `Rat`. A zero base with a negative exponent
 * reaches `Rat`'s existing `DivideByZeroError` through `reciprocal`'s
 * smart-construction boundary, minting no message of its own.
 *
 * The **ordering** is itself a pin: the integrality guard is a predicate of the
 * exponent alone, decided before the base is consulted, so `pow(0/1, -1/2)` is
 * the fractional error and `pow(0/1, -1/1)` the zero one. A guard placed after
 * the inversion answers `DivideByZeroError` to both.
 *
 * `rat.md` §9 requires the emitted JavaScript to be *executed*: an exactness
 * claim about bigint exponentiation is a claim about what the module computes,
 * and only running it sees a `Float` leak or a lost guard. Every program here is
 * byte-distinct from its neighbours — emitted modules mount as `data:` URLs
 * cached by their full text, so two identical programs would share one module
 * instance and one of the pins would be measuring the other's.
 */

const STDLIB = import.meta.glob("../../../stdlib/*.hex", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** `stdlib/Rat.hex`, the home module of the instance under test. */
const RAT = (() => {
  const entry = Object.entries(STDLIB).find(([path]) => path.endsWith("/Rat.hex"));
  if (entry === undefined) throw new Error("no stdlib/Rat.hex");
  return entry[1];
})();

function withRat(source: string): readonly (readonly [string, string])[] {
  return [
    ["/main.hex", `import * as Rat from "./Rat"\n${source}`],
    ["/Rat.hex", RAT],
  ];
}

/** Compiles a `Rat` client and executes it, returning `/main.hex`'s exports. */
async function runRat(source: string): Promise<Record<string, unknown>> {
  return runProject(withRat(source));
}

/** What a thunk threw, or `undefined` if it returned. */
function threw(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("the control: the harness reports a failure rather than passing it", () => {
  test("a broken `Rat` client is refused", () => {
    const diagnostics = compileFiles(withRat("export let r: Rat.Rat = Rat.powz(1, 2)\n"))
      .diagnostics.map(({ message }) => message);
    expect(diagnostics).not.toEqual([]);
  });
});

describe("exact at integer-valued exponents of either sign (rat.md §9)", () => {
  test("a positive integer exponent: `pow(2/1, 10/1)` is exactly `1024/1`", async () => {
    const exports = await runRat(
      "// positive exponent\n" +
      "let base: Rat.Rat = Rat.create(2, 1)\n" +
      "let exponent: Rat.Rat = Rat.create(10, 1)\n" +
      "let raised: Rat.Rat = Rat.pow(base, exponent)\n" +
      "export let top: BigInt = Rat.top(raised)\n" +
      "export let bottom: BigInt = Rat.bottom(raised)\n" +
      "export let shown: String = \"${raised}\"\n",
    );

    expect(exports["top"]).toBe(1024n);
    expect(exports["bottom"]).toBe(1n);
    expect(exports["shown"]).toBe("1024/1");
  });

  test("a negative integer exponent inverts the base: `pow(2/3, -2/1)` is `9/4`", async () => {
    // The case `Pow<Int>` structurally cannot serve — it throws — and `Rat`
    // serves exactly. `9/4` also pins the inversion's *direction*: the wrong
    // one is `4/9`.
    const exports = await runRat(
      "// negative exponent\n" +
      "let base: Rat.Rat = Rat.create(2, 3)\n" +
      "let exponent: Rat.Rat = Rat.create(-2, 1)\n" +
      "let raised: Rat.Rat = Rat.pow(base, exponent)\n" +
      "export let top: BigInt = Rat.top(raised)\n" +
      "export let bottom: BigInt = Rat.bottom(raised)\n",
    );

    expect(exports["top"]).toBe(9n);
    expect(exports["bottom"]).toBe(4n);
  });

  test("the exactness is bigint exponentiation, not a double", async () => {
    // 3^40 is far past 2^53. A `Float` route — `Math.pow`, or a `toFloat` at
    // any point inside the instance — answers a rounded neighbour, and the
    // canonical pair is the whole claim of `rat.md` §4's "nothing converts to
    // `Float`, even internally".
    const exports = await runRat(
      "// bigint exactness\n" +
      "let base: Rat.Rat = Rat.create(3, 1)\n" +
      "let exponent: Rat.Rat = Rat.create(40, 1)\n" +
      "let raised: Rat.Rat = Rat.pow(base, exponent)\n" +
      "export let top: BigInt = Rat.top(raised)\n",
    );

    expect(exports["top"]).toBe(12157665459056928801n);
  });

  test("`x ** 0` is `1/1`, `0 ** 0` included", async () => {
    // Consistent with every other instance in the tower, where the zeroth
    // power is the unit and the zero base is not special-cased.
    const exports = await runRat(
      "// zeroth power\n" +
      "let zero: Rat.Rat = Rat.create(0, 1)\n" +
      "let seven: Rat.Rat = Rat.create(7, 2)\n" +
      "export let unit: String = \"${seven ** Rat.create(0, 1)}\"\n" +
      "export let zeroth: String = \"${zero ** Rat.create(0, 1)}\"\n" +
      "export let zeroBase: String = \"${zero ** Rat.create(3, 1)}\"\n",
    );

    expect(exports["unit"]).toBe("1/1");
    expect(exports["zeroth"]).toBe("1/1");
    expect(exports["zeroBase"]).toBe("0/1");
  });

  test("the operator spelling reaches the same member, end to end", async () => {
    // `**` at `Rat` operands, and the same operation under Numeric Literals
    // §5.1's expected-type lift from `Int` operands — one instance, three
    // spellings (`Rat.pow`, `**`, the lifted `**`).
    const exports = await runRat(
      "// operator spelling\n" +
      "let a: Int = 4\n" +
      "let negOne: Int = -1\n" +
      "let quarter: Rat.Rat = a ** negOne\n" +
      "let direct: Rat.Rat = Rat.create(2, 3) ** Rat.create(-2, 1)\n" +
      "export let lifted: String = \"${quarter}\"\n" +
      "export let operator: String = \"${direct}\"\n" +
      "export let member: String = \"${Rat.pow(Rat.create(2, 3), Rat.create(-2, 1))}\"\n",
    );

    expect(exports["lifted"]).toBe("1/4");
    expect(exports["operator"]).toBe("9/4");
    expect(exports["member"]).toBe("9/4");
  });
});

describe("the guards, and the order they are checked in", () => {
  test("a non-integer exponent throws `FractionalExponentError`, message pinned", async () => {
    // `rat.md` §8 pins the provenance-tagged message exactly.
    const exports = await runRat(
      "// fractional exponent\n" +
      "export let boom(): Rat.Rat = Rat.pow(Rat.create(4, 9), Rat.create(1, 2))\n" +
      "export let alsoBoom(): Rat.Rat = Rat.create(2, 1) ** Rat.create(3, 2)\n",
    );

    expect(threw(exports["boom"] as () => unknown)).toMatchObject({
      name: "FractionalExponentError",
      message: "Rat.pow: exponent is not an integer",
      $hex: "Pow",
    });
    // A *perfect* root is refused as squarely as any other: success is never a
    // property of the base's factorization (Operators §13).
    expect(threw(exports["alsoBoom"] as () => unknown))
      .toMatchObject({ name: "FractionalExponentError" });
  });

  test("a zero base at a negative integer exponent throws `DivideByZeroError`", async () => {
    // Through the smart-construction boundary — `reciprocal` is `create` on the
    // swapped pair — so no `Rat.pow`-specific message is minted for it.
    const exports = await runRat(
      "// zero base, negative exponent\n" +
      "export let boom(): Rat.Rat = Rat.pow(Rat.create(0, 1), Rat.create(-1, 1))\n",
    );

    expect(threw(exports["boom"] as () => unknown)).toMatchObject({
      name: "DivideByZeroError",
      message: "Rat.create: bottom is zero",
    });
  });

  test("where both conditions hold the integrality guard is checked first", async () => {
    // `pow(0/1, -1/2)`: fractional *and* a vanishing reciprocal. The guard is a
    // predicate of the exponent alone, decided before the base is consulted, so
    // the answer is `FractionalExponentError`. A guard placed after the
    // inversion answers `DivideByZeroError` here.
    const exports = await runRat(
      "// both conditions\n" +
      "export let boom(): Rat.Rat = Rat.pow(Rat.create(0, 1), Rat.create(-1, 2))\n",
    );

    expect(threw(exports["boom"] as () => unknown)).toMatchObject({
      name: "FractionalExponentError",
      message: "Rat.pow: exponent is not an integer",
    });
  });
});

describe("the exception's identity", () => {
  test("a catch arm names it by `Pow`'s declaration, bare and qualified", async () => {
    // The catch arm is the Hexagon-side guard: it certifies the (module, name)
    // pair, so the sibling `NegativeExponentError` arm does not answer for it.
    const exports = await runRat(
      "// catch arms\n" +
      "export fun bare(): String =\n" +
      "    try\n" +
      "        \"${Rat.pow(Rat.create(4, 1), Rat.create(1, 2))}\"\n" +
      "    catch\n" +
      "        FractionalExponentError(message) => message\n" +
      "export fun qualified(): String =\n" +
      "    try\n" +
      "        \"${Rat.pow(Rat.create(9, 1), Rat.create(1, 2))}\"\n" +
      "    catch\n" +
      "        Pow.FractionalExponentError(message) => message\n" +
      "export fun sibling(): String =\n" +
      "    try\n" +
      "        \"${Rat.pow(Rat.create(16, 1), Rat.create(1, 2))}\"\n" +
      "    catch\n" +
      "        NegativeExponentError(message) => \"wrong: ${message}\"\n" +
      "        _ => \"not the sibling\"\n",
    );

    expect((exports["bare"] as () => string)()).toBe("Rat.pow: exponent is not an integer");
    expect((exports["qualified"] as () => string)())
      .toBe("Rat.pow: exponent is not an integer");
    expect((exports["sibling"] as () => string)()).toBe("not the sibling");
  });

  test("the JavaScript guards certify it against `stdlib/Pow.hex`", async () => {
    // `.is` and `isHexError` are the JS consumer's face of the same brand the
    // arms above read. Both calls run over one module graph: `Pow.hex`'s
    // emitted text is byte-identical across the two entries, so the `data:`
    // cache hands back the same instance and `.is` is the declaration's own.
    const files = withRat(
      "// runtime guards\n" +
      "export let boom(): Rat.Rat = Rat.pow(Rat.create(5, 1), Rat.create(1, 3))\n",
    );
    const main = await runProject(files);
    const pow = await runProject(files, { entry: "/Pow.hex" });

    const error = threw(main["boom"] as () => unknown);
    const fractional = pow["FractionalExponentError"] as { is: (value: unknown) => boolean };
    const negative = pow["NegativeExponentError"] as { is: (value: unknown) => boolean };
    const isHexError = pow["isHexError"] as (value: unknown) => boolean;

    expect(error).toBeInstanceOf(Error);
    expect(fractional.is(error)).toBe(true);
    expect(negative.is(error)).toBe(false);
    expect(isHexError(error)).toBe(true);
    // A foreign `Error` wearing the name is unbranded, so the guard refuses it.
    expect(fractional.is(Object.assign(new Error("x"), { name: "FractionalExponentError" })))
      .toBe(false);
  });
});
