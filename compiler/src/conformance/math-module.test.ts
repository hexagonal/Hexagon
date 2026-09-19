import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

const HEADER = "module Main\n\n";

function program(bindings: readonly (readonly [string, string])[]): string {
  return HEADER + bindings.map(([name, expression]) =>
    `export let ${name}: Float = ${expression}\n`
  ).join("");
}

describe("the ordinary Math module surface", () => {
  test("supplies the complete qualified interface through the prelude", () => {
    const calls = [
      ["sqrt", "Math.sqrt(4.0)"],
      ["sin", "Math.sin(0.5)"],
      ["cos", "Math.cos(0.5)"],
      ["tan", "Math.tan(0.5)"],
      ["asin", "Math.asin(0.5)"],
      ["acos", "Math.acos(0.5)"],
      ["atan", "Math.atan(0.5)"],
      ["atan2", "Math.atan2(0.5, -0.25)"],
      ["exp", "Math.exp(0.5)"],
      ["ln", "Math.ln(2.0)"],
      ["log10", "Math.log10(100.0)"],
      ["sinh", "Math.sinh(0.5)"],
      ["cosh", "Math.cosh(0.5)"],
      ["tanh", "Math.tanh(0.5)"],
    ] as const;
    const project = compileMain(program([
      ["pi", "Math.pi"],
      ["e", "Math.e"],
      ...calls,
    ]));

    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ name }) => name === "Main")!;
    expect(main.javascript.text).toContain(
      'from "./Hex/Math.js";',
    );
    const math = project.modules.find(({ name }) => name === "Hex.Math")!;
    expect(math.path).toBe("/Hex/Math.hex");
    for (const name of ["pi", "e", ...calls.map(([name]) => name)]) {
      expect(math.declarations.text).toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect(math.declarations.text).not.toMatch(/\bpow\b/u);
    expect(math.javascript.text).not.toContain("hex:intrinsic");
  });

  test("also accepts the general explicit-import route and exposes no Math.pow", () => {
    expect(projectDiagnostics(
      "module Main\n\nimport Math\n\nexport let answer: Float = Math.sqrt(4.0)\n",
    )).toEqual([]);
    expect(projectDiagnostics(
      HEADER + "export let answer: Float = Math.pow(2.0, 3.0)\n",
    )).toEqual(["module `Math` does not export `pow`"]);
  });

  test("adds no bare term", () => {
    expect(projectDiagnostics(HEADER + "export let answer: Float = sqrt(4.0)\n"))
      .toEqual(["no bare `sqrt`; write `Math.sqrt(4.0)`"]);
    expect(projectDiagnostics(HEADER + "export let answer: Float = pi\n"))
      .toEqual(["no bare `pi`; write `Math.pi`"]);
    expect(projectDiagnostics(HEADER + "export let answer: Float = e\n"))
      .toEqual(["no bare `e`; write `Math.e`"]);
  });

  test("does not turn Math functions into Float companion operations", () => {
    expect(projectDiagnostics(HEADER + "export let answer: Float = (4.0).sqrt()\n"))
      .toEqual([
        "`Float` has no field `sqrt`, its companion exports no operation `sqrt`, " +
        "and no constraint honored at `Float` has a subject-first member `sqrt`; " +
        "call an available subject-first function explicitly",
      ]);
  });

  test("does not disturb Float.pow", async () => {
    const exports = await runMain(
      HEADER + "export let root: Float = Float.pow(2.0, 0.5)\n",
    );
    expect(exports["root"]).toBe(Math.sqrt(2));
  });
});

describe("ordinary finite values and constants", () => {
  test("every operation is the corresponding native mathematical operation", async () => {
    const operations = [
      ["sqrt", "Math.sqrt(2.0)", Math.sqrt(2)],
      ["sin", "Math.sin(0.5)", Math.sin(0.5)],
      ["cos", "Math.cos(0.5)", Math.cos(0.5)],
      ["tan", "Math.tan(0.5)", Math.tan(0.5)],
      ["asin", "Math.asin(0.5)", Math.asin(0.5)],
      ["acos", "Math.acos(0.5)", Math.acos(0.5)],
      ["atan", "Math.atan(0.5)", Math.atan(0.5)],
      ["atan2", "Math.atan2(0.5, -0.25)", Math.atan2(0.5, -0.25)],
      ["exp", "Math.exp(0.5)", Math.exp(0.5)],
      ["ln", "Math.ln(2.0)", Math.log(2)],
      ["log10", "Math.log10(100.0)", Math.log10(100)],
      ["sinh", "Math.sinh(0.5)", Math.sinh(0.5)],
      ["cosh", "Math.cosh(0.5)", Math.cosh(0.5)],
      ["tanh", "Math.tanh(0.5)", Math.tanh(0.5)],
    ] as const;
    const exports = await runMain(program([
      ["pi", "Math.pi"],
      ["e", "Math.e"],
      ...operations.map(([name, expression]) => [name, expression] as const),
    ]));

    expect(exports["pi"]).toBe(Math.PI);
    expect(exports["e"]).toBe(Math.E);
    for (const [name, _expression, expected] of operations) {
      expect(exports[name]).toBe(expected);
    }
  });

  test("preserves finite atan endpoint rounding", async () => {
    const exports = await runMain(program([
      ["positive", "Math.atan(1.0e20)"],
      ["negative", "Math.atan(-1.0e20)"],
      ["halfPi", "Math.pi / 2.0"],
    ]));
    expect(exports["positive"]).toBe(Math.atan(1e20));
    expect(exports["negative"]).toBe(Math.atan(-1e20));
    expect(Object.is(exports["positive"], exports["halfPi"]))
      .toBe(Object.is(Math.atan(1e20), Math.PI / 2));
  });
});

describe("NaN and unary boundaries", () => {
  const unary = [
    "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "exp", "ln",
    "log10", "sinh", "cosh", "tanh",
  ] as const;

  test("a NaN in every argument position produces NaN", async () => {
    const exports = await runMain(program([
      ...unary.map((name) => [`${name}Nan`, `Math.${name}(Float.nan)`] as const),
      ["atan2YNan", "Math.atan2(Float.nan, 1.0)"],
      ["atan2XNan", "Math.atan2(1.0, Float.nan)"],
    ]));
    for (const value of Object.values(exports)) expect(value).toBe(Number.NaN);
  });

  test("matches every signed-zero and infinity row", async () => {
    const bindings: [string, string][] = [];
    for (const name of unary) {
      bindings.push([`${name}Pz`, `Math.${name}(0.0)`]);
      bindings.push([`${name}Nz`, `Math.${name}(-0.0)`]);
      bindings.push([`${name}Pi`, `Math.${name}(Float.infinity)`]);
      bindings.push([`${name}Ni`, `Math.${name}(-Float.infinity)`]);
    }
    const exports = await runMain(program(bindings));
    const expected: Record<string, readonly [number, number, number, number]> = {
      sqrt: [0, -0, Infinity, NaN],
      sin: [0, -0, NaN, NaN],
      cos: [1, 1, NaN, NaN],
      tan: [0, -0, NaN, NaN],
      asin: [0, -0, NaN, NaN],
      acos: [Math.acos(0), Math.acos(-0), NaN, NaN],
      atan: [0, -0, Math.atan(Infinity), Math.atan(-Infinity)],
      exp: [1, 1, Infinity, 0],
      ln: [-Infinity, -Infinity, Infinity, NaN],
      log10: [-Infinity, -Infinity, Infinity, NaN],
      sinh: [0, -0, Infinity, -Infinity],
      cosh: [1, 1, Infinity, Infinity],
      tanh: [0, -0, 1, -1],
    };
    for (const name of unary) {
      const [pz, nz, pi, ni] = expected[name]!;
      expect(Object.is(exports[`${name}Pz`], pz)).toBe(true);
      expect(Object.is(exports[`${name}Nz`], nz)).toBe(true);
      expect(Object.is(exports[`${name}Pi`], pi)).toBe(true);
      expect(Object.is(exports[`${name}Ni`], ni)).toBe(true);
    }
  });

  test("keeps domains and their adjacent representable values", async () => {
    const exports = await runMain(program([
      ["sqrtNegative", "Math.sqrt(-0.0000000000000001)"],
      ["asinLowOutside", "Math.asin(-1.0000000000000002)"],
      ["asinLow", "Math.asin(-1.0)"],
      ["asinHigh", "Math.asin(1.0)"],
      ["asinHighOutside", "Math.asin(1.0000000000000002)"],
      ["acosLowOutside", "Math.acos(-1.0000000000000002)"],
      ["acosLow", "Math.acos(-1.0)"],
      ["acosHigh", "Math.acos(1.0)"],
      ["acosHighOutside", "Math.acos(1.0000000000000002)"],
      ["lnNegative", "Math.ln(-0.0000000000000001)"],
      ["lnOne", "Math.ln(1.0)"],
      ["log10Negative", "Math.log10(-0.0000000000000001)"],
      ["log10One", "Math.log10(1.0)"],
    ]));
    expect(exports).toMatchObject({
      sqrtNegative: NaN,
      asinLowOutside: NaN,
      asinLow: Math.asin(-1),
      asinHigh: Math.asin(1),
      asinHighOutside: NaN,
      acosLowOutside: NaN,
      acosLow: Math.acos(-1),
      acosHigh: 0,
      acosHighOutside: NaN,
      lnNegative: NaN,
      lnOne: 0,
      log10Negative: NaN,
      log10One: 0,
    });
  });
});

describe("atan2 quadrants and signed axes", () => {
  test("matches the complete boundary table", async () => {
    const cases = [
      ["pzP", "0.0", "1.0", 0, 1], ["nzP", "-0.0", "1.0", -0, 1],
      ["pzPz", "0.0", "0.0", 0, 0], ["nzPz", "-0.0", "0.0", -0, 0],
      ["pzPi", "0.0", "Float.infinity", 0, Infinity],
      ["nzPi", "-0.0", "Float.infinity", -0, Infinity],
      ["pzN", "0.0", "-1.0", 0, -1], ["nzN", "-0.0", "-1.0", -0, -1],
      ["pzNz", "0.0", "-0.0", 0, -0], ["nzNz", "-0.0", "-0.0", -0, -0],
      ["pzNi", "0.0", "-Float.infinity", 0, -Infinity],
      ["nzNi", "-0.0", "-Float.infinity", -0, -Infinity],
      ["pPz", "1.0", "0.0", 1, 0], ["pNz", "1.0", "-0.0", 1, -0],
      ["nPz", "-1.0", "0.0", -1, 0], ["nNz", "-1.0", "-0.0", -1, -0],
      ["pPi", "1.0", "Float.infinity", 1, Infinity],
      ["nPi", "-1.0", "Float.infinity", -1, Infinity],
      ["pNi", "1.0", "-Float.infinity", 1, -Infinity],
      ["nNi", "-1.0", "-Float.infinity", -1, -Infinity],
      ["piF", "Float.infinity", "2.0", Infinity, 2],
      ["niF", "-Float.infinity", "2.0", -Infinity, 2],
      ["piPi", "Float.infinity", "Float.infinity", Infinity, Infinity],
      ["niPi", "-Float.infinity", "Float.infinity", -Infinity, Infinity],
      ["piNi", "Float.infinity", "-Float.infinity", Infinity, -Infinity],
      ["niNi", "-Float.infinity", "-Float.infinity", -Infinity, -Infinity],
    ] as const;
    const exports = await runMain(program(cases.map(([name, y, x]) =>
      [name, `Math.atan2(${y}, ${x})`] as const
    )));
    for (const [name, _y, _x, hostY, hostX] of cases) {
      expect(Object.is(exports[name], Math.atan2(hostY, hostX))).toBe(true);
    }
  });
});
