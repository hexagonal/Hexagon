import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for **`honor Pow<Rat>` under the `Int` exponent seat** — #523 as
 * #541 reshaped it, `rat.md` §4/§8/§9 and Operators §6.3's `Rat` row.
 *
 * `Rat` is exact at either sign of its exponent, so `(2/3) ** -2` is exactly
 * `9/4` — the case `Pow<Int>` structurally cannot serve. What changed with the
 * reshape is where the *refusal* lives: a fractional exponent used to throw
 * `FractionalExponentError` at run time and is now a **type error at the seat**,
 * because the member is `pow(value: Rat, exponent: Int)`. The exception is gone
 * from `stdlib/Pow.hex` with the signature that made it reachable, and no guard
 * is left in the instance at all: the only partiality is a zero base under a
 * negative exponent, which reaches `Rat`'s existing `DivideByZeroError` through
 * `reciprocal`'s smart-construction boundary, minting no message of its own.
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
    ["/main.hex", `import Rat from "./Rat"\n${source}`],
    ["/Rat.hex", RAT],
  ];
}

/** Compiles a `Rat` client and executes it, returning `/main.hex`'s exports. */
async function runRat(source: string): Promise<Record<string, unknown>> {
  return runProject(withRat(source));
}

/** What a `Rat` client reports, if anything. */
function ratVerdict(source: string): readonly string[] {
  return compileFiles(withRat(source)).diagnostics.map(({ message }) => message);
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

describe("exact at either sign of the `Int` exponent (rat.md §9)", () => {
  test("a positive exponent: `pow(2/1, 10)` is exactly `1024/1`", async () => {
    const exports = await runRat(
      "// positive exponent\n" +
      "let base: Rat.Rat = Rat.create(2, 1)\n" +
      "let raised: Rat.Rat = Rat.pow(base, 10)\n" +
      "export let top: BigInt = Rat.top(raised)\n" +
      "export let bottom: BigInt = Rat.bottom(raised)\n" +
      "export let shown: String = \"${raised}\"\n",
    );

    expect(exports["top"]).toBe(1024n);
    expect(exports["bottom"]).toBe(1n);
    expect(exports["shown"]).toBe("1024/1");
  });

  test("a negative exponent inverts the base: `pow(2/3, -2)` is `9/4`", async () => {
    // The case `Pow<Int>` structurally cannot serve — it throws — and `Rat`
    // serves exactly. `9/4` also pins the inversion's *direction*: the wrong
    // one is `4/9`.
    const exports = await runRat(
      "// negative exponent\n" +
      "let base: Rat.Rat = Rat.create(2, 3)\n" +
      "let exponent: Int = -2\n" +
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
      "let raised: Rat.Rat = Rat.pow(base, 40)\n" +
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
      "export let unit: String = \"${seven ** 0}\"\n" +
      "export let zeroth: String = \"${zero ** 0}\"\n" +
      "export let zeroBase: String = \"${zero ** 3}\"\n",
    );

    expect(exports["unit"]).toBe("1/1");
    expect(exports["zeroth"]).toBe("1/1");
    expect(exports["zeroBase"]).toBe("0/1");
  });

  test("the operator spelling reaches the same member, end to end", async () => {
    // `**` at a `Rat` base, and the same operation under Numeric Literals
    // §5.1's expected-type lift from an `Int` base — one instance, three
    // spellings (`Rat.pow`, `**`, the lifted `**`). In every one of them the
    // exponent stays an `Int`: the lift moves the base alone.
    const exports = await runRat(
      "// operator spelling\n" +
      "let a: Int = 4\n" +
      "let negOne: Int = -1\n" +
      "let quarter: Rat.Rat = a ** negOne\n" +
      "let direct: Rat.Rat = Rat.create(2, 3) ** negOne\n" +
      "export let lifted: String = \"${quarter}\"\n" +
      "export let operator: String = \"${direct}\"\n" +
      "export let member: String = \"${Rat.pow(Rat.create(2, 3), -2)}\"\n",
    );

    expect(exports["lifted"]).toBe("1/4");
    expect(exports["operator"]).toBe("3/2");
    expect(exports["member"]).toBe("9/4");
  });
});

describe("the fractional exponent is refused by the seat's type, not by a guard", () => {
  test("the operator spelling is a compile-time type error at the seat", () => {
    // `rat.md` §8: a non-integer exponent at `**` or `Rat.pow` is a type error
    // at the `Int` exponent seat, never a runtime report. **No door is named**
    // (#545): the fixit looks a `widens Pow.pow` up at the *value's* type, and
    // `Rat` declares none — the analytic power belongs to the approximate
    // world (`rat.md` §4), which is a different type, not a wider seat at this
    // one. A `Float.pow(rat, 0.5)` suggestion would not even typecheck.
    expect(ratVerdict(
      "export let boom: Rat.Rat = Rat.create(2, 1) ** 0.5\n",
    )).toEqual(["type mismatch: expected Int, found Float"]);
  });

  test("the named spelling `Rat.pow(r, r2)` is refused at the argument seat", () => {
    // The same refusal reached the other way: the member's second parameter is
    // an `Int`, so a `Rat` argument is an ordinary seat mismatch. No fixit here
    // — this is not the operator, and `Rat` is not one of the two door types.
    expect(ratVerdict(
      "export let boom: Rat.Rat = Rat.pow(Rat.create(4, 9), Rat.create(1, 2))\n",
    )).not.toEqual([]);
  });

  test("a *perfect* root is refused as squarely as any other", () => {
    // Success is never a property of the base's factorization (Operators §13),
    // and now the refusal does not even reach the base.
    expect(ratVerdict(
      "export let boom: Rat.Rat = Rat.create(4, 1) ** 0.5\n",
    )).toEqual(["type mismatch: expected Int, found Float"]);
  });
});

describe("the one partiality left, and where it reports", () => {
  test("a zero base at a negative exponent throws `DivideByZeroError`", async () => {
    // Through the smart-construction boundary — `reciprocal` is `create` on the
    // swapped pair — so no `Rat.pow`-specific message is minted for it.
    const exports = await runRat(
      "// zero base, negative exponent\n" +
      "export let boom(): Rat.Rat = Rat.pow(Rat.create(0, 1), -1)\n",
    );

    expect(threw(exports["boom"] as () => unknown)).toMatchObject({
      name: "DivideByZeroError",
      message: "Rat.create: bottom is zero",
    });
  });

  test("`Pow.hex` declares one exception now, and `Rat` throws none of it", async () => {
    // `FractionalExponentError` is deleted, so the only brand `Pow.hex` still
    // owns is `NegativeExponentError` — which `Rat` never throws, its algebra
    // being total at both signs. The zero-base error is `Integral.hex`'s.
    const files = withRat(
      "// runtime guards\n" +
      "export let boom(): Rat.Rat = Rat.pow(Rat.create(0, 1), -1)\n",
    );
    const main = await runProject(files);
    const pow = await runProject(files, { entry: "/Pow.hex" });

    const error = threw(main["boom"] as () => unknown);
    const negative = pow["NegativeExponentError"] as { is: (value: unknown) => boolean };
    const isHexError = pow["isHexError"] as (value: unknown) => boolean;

    expect(error).toBeInstanceOf(Error);
    expect(pow["FractionalExponentError"]).toBeUndefined();
    expect(negative.is(error)).toBe(false);
    expect(isHexError(error)).toBe(true);
  });
});
