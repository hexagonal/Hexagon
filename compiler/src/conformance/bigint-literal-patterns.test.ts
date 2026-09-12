import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

const main = (body: string): string => `module Main\n\n${body}`;
const BUDGET = { timeout: 20000 } as const;
const DUPLICATE = "this literal case is unreachable; it is already handled above";

describe("BigInt literal patterns (#898)", BUDGET, () => {
  test("the documented positive, negative, zero, and arbitrary-precision cases run exactly", async () => {
    const source = main(
      "export let describeBig(count: BigInt): String =\n" +
        "    match count\n" +
        "        900719925474099312345678901234567890n => \"a large count\"\n" +
        "        -900719925474099312345678901234567890n => \"its negative\"\n" +
        "        0n => \"zero\"\n" +
        "        0007n => \"seven\"\n" +
        "        _ => \"another count\"\n" +
        "export let positive: String = describeBig(900719925474099312345678901234567890n)\n" +
        "export let negative: String = describeBig(-900719925474099312345678901234567890n)\n" +
        "export let zero: String = describeBig(0n)\n" +
        "export let seven: String = describeBig(7n)\n" +
        "export let other: String = describeBig(1n)\n",
    );
    const project = compileMain(source);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const text = project.modules.find(({ source }) => source.path === "/main.hex")!
      .javascript.text;
    expect(text).toContain("__match === 900719925474099312345678901234567890n");
    expect(text).toContain("__match === -900719925474099312345678901234567890n");
    expect(text).toContain("__match === 7n");
    expect(text).not.toContain("0007n");

    const exports = await runMain(source);
    expect([exports.positive, exports.negative, exports.zero, exports.seven, exports.other])
      .toEqual(["a large count", "its negative", "zero", "seven", "another count"]);
  });

  test("the suffix is monomorphic and never widens another pattern position", () => {
    for (const type of ["Int", "Nat", "Float"] as const) {
      expect(projectDiagnostics(main(
        `export let f(value: ${type}): String =\n` +
          "    match value\n" +
          "        0n => \"zero\"\n" +
          "        _ => \"other\"\n",
      ))).toEqual([`type mismatch: expected ${type}, found BigInt`]);
    }
  });

  test("coverage keys the BigInt value across suffixes, signs, and leading zeros", () => {
    expect(projectDiagnostics(main(
      "export let f(value: BigInt): String =\n" +
        "    match value\n" +
        "        0 => \"bare\"\n" +
        "        0n => \"suffixed\"\n" +
        "        -0n => \"negative zero\"\n" +
        "        000n => \"leading zeroes\"\n" +
        "        _ => \"other\"\n",
    ))).toEqual([DUPLICATE, DUPLICATE, DUPLICATE]);
  });

  test("nested, or, as, declared-record, and catch positions use the ordinary machinery", async () => {
    const exports = await runMain(main(
      "export record Parcel = {code: BigInt}\n" +
        "exception Failed(code: BigInt)\n" +
        "export let nested(value: Option(BigInt)): Bool = match value\n" +
        "    Some(0n | 1n) => True\n" +
        "    _ => False\n" +
        "export let named(value: BigInt): BigInt = match value\n" +
        "    7n as whole => whole\n" +
        "    _ => 0n\n" +
        "export let declared(value: Parcel): Bool = match value\n" +
        "    Parcel({code = 9n}) => True\n" +
        "    _ => False\n" +
        "export let caught(): BigInt =\n" +
        "    try throw(Failed(11n))\n" +
        "    catch\n" +
        "        Failed(11n) => 11n\n" +
        "        _ => 0n\n" +
        "export let a: Bool = nested(Some(1n))\n" +
        "export let b: BigInt = named(7n)\n" +
        "export let c: Bool = declared(Parcel({code = 9n}))\n" +
        "export let d: BigInt = caught()\n" +
        "export let inferred: String = match Some(0n)\n" +
        "    Some(0n) => \"nested BigInt\"\n" +
        "    Some(_) => \"other\"\n" +
        "    None => \"none\"\n",
    ));
    expect([exports.a, exports.b, exports.c, exports.d, exports.inferred])
      .toEqual([true, 7n, true, 11n, "nested BigInt"]);
  });

  test("a BigInt literal remains refutable in binding and parameter seats", () => {
    expect(projectDiagnostics(main(
      "export union Box = Box(BigInt)\n" +
        "export let get(value: Box): BigInt =\n" +
        "    let Box(0n) = value\n" +
        "    0n\n",
    ))).toEqual(["this pattern can fail: `Box(_)`; use `match`"]);
  });

  test("an oversized bare pattern offers `n` only at a resolved BigInt seat", () => {
    const atBigInt = compileMain(main(
      "export let f(value: BigInt): String = match value\n" +
        "    9007199254740993 => \"large\"\n" +
        "    _ => \"other\"\n",
    )).diagnostics;
    expect(atBigInt.map(({ message }) => message)).toEqual([
      "integer literal exceeds Int range; add `n` for a BigInt",
    ]);
    expect(atBigInt[0]?.fixes?.[0]).toMatchObject({
      message: "make this a BigInt literal",
      edits: [{ replacement: "9007199254740993n" }],
    });

    const atInt = compileMain(main(
      "export let f(value: Int): String = match value\n" +
        "    9007199254740993 => \"large\"\n" +
        "    _ => \"other\"\n",
    )).diagnostics;
    expect(atInt.map(({ message }) => message)).toEqual([
      "integer literal exceeds Int range",
    ]);
    expect(atInt[0]?.fixes).toBeUndefined();

    const negative = compileMain(main(
      "export let f(value: BigInt): String = match value\n" +
        "    -9_007_199_254_740_993 => \"large\"\n" +
        "    _ => \"other\"\n",
    )).diagnostics;
    expect(negative[0]?.fixes?.[0]?.edits[0]?.replacement)
      .toBe("-9_007_199_254_740_993n");

    const expression = compileMain(main(
      "let value = 9_007_199_254_740_993\n",
    )).diagnostics;
    expect(expression.map(({ message }) => message)).toEqual([
      "integer literal exceeds Int range; add `n` for a BigInt, or use an explicit conversion",
    ]);
    expect(expression[0]?.fixes?.[0]?.edits[0]?.replacement)
      .toBe("9_007_199_254_740_993n");
  });

  test("an oversized nested pattern waits for its final seat type", () => {
    for (const arms of [
      "    Some(9007199254740993) => \"large\"\n" +
        "    Some(0n) => \"zero\"\n",
      "    Some(0n) => \"zero\"\n" +
        "    Some(9007199254740993) => \"large\"\n",
    ] as const) {
      const diagnostics = compileMain(main(
        "export let result: String = match None\n" + arms +
          "    Some(_) => \"other\"\n" +
          "    None => \"none\"\n",
      )).diagnostics;
      expect(diagnostics.map(({ message }) => message)).toEqual([
        "integer literal exceeds Int range; add `n` for a BigInt",
      ]);
      expect(diagnostics[0]?.fixes?.[0]?.edits[0]?.replacement)
        .toBe("9007199254740993n");
    }

    const unresolved = compileMain(main(
      "export let result: String = match None\n" +
        "    Some(9007199254740993) => \"large\"\n" +
        "    None => \"none\"\n",
    )).diagnostics;
    expect(unresolved.map(({ message }) => message)).toEqual([
      "integer literal exceeds Int range",
    ]);
    expect(unresolved[0]?.fixes).toBeUndefined();
  });
});
