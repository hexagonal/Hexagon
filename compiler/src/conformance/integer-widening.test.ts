import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

const STDLIB = import.meta.glob("../../../stdlib/*.hex", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const RAT = (() => {
  const entry = Object.entries(STDLIB).find(([path]) => path.endsWith("/Rat.hex"));
  if (entry === undefined) throw new Error("no stdlib/Rat.hex");
  return entry[1];
})();

function withRat(source: string): readonly (readonly [string, string])[] {
  return [
    ["/main.hex", "module Main\n\nimport Rat\n" + source],
    ["/Rat.hex", RAT],
  ];
}

function verdict(source: string): readonly string[] {
  return compileFiles(withRat(source)).diagnostics.map(({ message }) => message);
}

describe("exact BigInt-source widening through FromBigInt", () => {
  test("annotations, operands, comparisons, and generic calls preserve arbitrary precision", async () => {
    const exports = await runProject(withRat(
      "let huge: BigInt = 900719925474099312345678902n\n" +
      "let small: Int = -2\n" +
      "let half: Rat.Rat = Rat.create(1n, 2n)\n" +
      "let annotated: Rat.Rat = huge\n" +
      "let asRat(value: BigInt): Rat.Rat = value\n" +
      "let combine<a: Num>(left: a, right: a): a = left + right\n" +
      "let scale<a: FromBigInt>(count: BigInt, value: a): a = count * value\n" +
      "let left: Rat.Rat = huge * half\n" +
      "let right: Rat.Rat = half * huge\n" +
      "let deferred: Rat.Rat = combine(huge, half)\n" +
      "let generic: Rat.Rat = scale(huge, half)\n" +
      "let bigLeftValue: BigInt = huge + small\n" +
      "let bigRightValue: BigInt = small + huge\n" +
      "export let annotatedTop: BigInt = Rat.top(annotated)\n" +
      "export let returnedTop: BigInt = Rat.top(asRat(huge))\n" +
      "export let ascribedTop: BigInt = Rat.top((huge: Rat.Rat))\n" +
      "export let leftTop: BigInt = Rat.top(left)\n" +
      "export let rightTop: BigInt = Rat.top(right)\n" +
      "export let deferredTop: BigInt = Rat.top(deferred)\n" +
      "export let deferredBottom: BigInt = Rat.bottom(deferred)\n" +
      "export let genericTop: BigInt = Rat.top(generic)\n" +
      "export let bigLeft: BigInt = bigLeftValue\n" +
      "export let bigRight: BigInt = bigRightValue\n" +
      "export let forwardEqual: Bool = huge == Rat.create(huge, 1n)\n" +
      "export let reverseEqual: Bool = Rat.create(huge, 1n) == huge\n",
    ));

    expect(exports).toMatchObject({
      annotatedTop: 900719925474099312345678902n,
      returnedTop: 900719925474099312345678902n,
      ascribedTop: 900719925474099312345678902n,
      leftTop: 450359962737049656172839451n,
      rightTop: 450359962737049656172839451n,
      deferredTop: 1801439850948198624691357805n,
      deferredBottom: 2n,
      genericTop: 450359962737049656172839451n,
      bigLeft: 900719925474099312345678900n,
      bigRight: 900719925474099312345678900n,
      forwardEqual: true,
      reverseEqual: true,
    });
  });

  test("qualified, pipe, and dot tower spellings share the direct conversion", async () => {
    const exports = await runProject(withRat(
      "let big: BigInt = 3n\n" +
      "let half: Rat.Rat = Rat.create(1n, 2n)\n" +
      "let qualified: Rat.Rat = Num.add(big, half)\n" +
      "let piped: Rat.Rat = big |> Num.add(half)\n" +
      "let dotted: Rat.Rat = big.add(half)\n" +
      "let divided: Rat.Rat = big.divide(2n)\n" +
      "export let values: Vector(BigInt) = [\n" +
      "    Rat.top(qualified), Rat.top(piped), Rat.top(dotted),\n" +
      "    Rat.top(divided), Rat.bottom(divided)]\n",
    ));

    expect([...(exports["values"] as Iterable<unknown>)]).toEqual([7n, 7n, 7n, 3n, 2n]);
  });

  test("an ordinary user nominal can opt in through canonical evidence", async () => {
    const exports = await runProject([["/main.hex", "module Main\n\n" +
      "record Exact = {value: BigInt}\n" +
      "honor Num<Exact> =\n" +
      "    add(left, right) = Exact({value = left.value + right.value})\n" +
      "    multiply(left, right) = Exact({value = left.value * right.value})\n" +
      "    fromNat(value) = Exact({value = BigInt.fromNat(value)})\n" +
      "honor Signed<Exact> =\n" +
      "    subtract(left, right) = Exact({value = left.value - right.value})\n" +
      "    negate(value) = Exact({value = -value.value})\n" +
      "    fromInt(value) = Exact({value = BigInt.fromInt(value)})\n" +
      "honor FromBigInt<Exact> =\n" +
      "    fromBigInt(value) = Exact({value})\n" +
      "let widened: Exact = 123456789012345678901n\n" +
      "export let result: BigInt = widened.value\n"]]);

    expect(exports["result"]).toBe(123456789012345678901n);
  });

  test("Signed evidence and an ordinary same-named function do not grant widening", () => {
    const messages = verdict(
      "let fromBigInt(value: BigInt): Rat.Rat = Rat.create(value, 1n)\n" +
      "let onlySigned<a: Signed>(value: BigInt, other: a): a = value + other\n",
    );

    expect(messages).toEqual([
      "`a` is a declared type variable, but the body requires `BigInt`; change the " +
      "annotation to `BigInt`, or remove it to let the type be inferred",
    ]);

    const shaped = verdict(
      "constraint Convert<a: Signed> =\n" +
      "    fromBigInt(value: BigInt) -> a\n" +
      "let onlyShaped<a: Convert>(value: BigInt, other: a): a = value + other\n",
    );
    expect(shaped).toEqual(messages);
  });

  test("assignment conversion evaluates its source once", async () => {
    const source =
      "let source(): BigInt = 6n\n" +
      "export let observe(): Vector(BigInt) =\n" +
      "    var current = Rat.create(1n, 2n)\n" +
      "    current := source()\n" +
      "    [Rat.top(current), Rat.bottom(current)]\n";
    const compiled = compileFiles(withRat(source));

    expect(compiled.diagnostics).toEqual([]);
    const main = compiled.modules.find(({ source }) => source.path === "/main.hex")!;
    // The emitted `let` declaration is an arrow; this is the sole call site.
    // The inserted conversion consumes its result rather than re-emitting it.
    expect(main.javascript.text.match(/source\(\)/gu)).toHaveLength(1);

    const exports = await runProject(withRat(source));

    expect([...(exports["observe"] as () => Iterable<unknown>)()]).toEqual([6n, 1n]);
  });

  test("BigInt and Float refuse both operand orders without exact evidence", () => {
    for (const expression of ["big + floating", "floating + big"]) {
      const messages = verdict(
        "let big: BigInt = 3n\n" +
        "let floating: Float = 2.0\n" +
        `let result = ${expression}\n`,
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("type mismatch");
      expect(messages[0]).toContain("BigInt");
      expect(messages[0]).toContain("Float");
    }
  });

  test("an unannotated BigInt divide remains at BigInt and is refused", () => {
    const messages = verdict(
      "let big: BigInt = 3n\n" +
      "let other: BigInt = 2n\n" +
      "let result = big.divide(other)\n",
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("type `BigInt` has no `Frac` instance");
    expect(messages[0]).not.toContain("Rat");
    expect(messages[0]).not.toContain("Float");
  });

  test("the n suffix and the exponent seat remain monomorphic", () => {
    const patternMessages = verdict(
      "let describe(value: Rat.Rat): Int = match value\n" +
      "    3n => 1\n" +
      "    _ => 0\n",
    );
    expect(patternMessages).toContain("type mismatch: expected Rat, found BigInt");

    const exponentMessages = verdict(
      "let base: Rat.Rat = Rat.create(2n, 1n)\n" +
      "let exponent: BigInt = 3n\n" +
      "let result = base ** exponent\n",
    );
    expect(exponentMessages).toEqual(["type mismatch: expected Int, found BigInt"]);
  });

  test("a written Rat home widens only the BigInt base for negative powers", async () => {
    const exports = await runProject(withRat(
      "let rational: Rat.Rat = 2n ** -2\n" +
      "export let top: BigInt = Rat.top(rational)\n" +
      "export let bottom: BigInt = Rat.bottom(rational)\n",
    ));

    expect(exports).toMatchObject({ top: 1n, bottom: 4n });
  });
});
