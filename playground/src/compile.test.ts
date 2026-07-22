import { describe, expect, test, vi } from "vitest";

import { helloWorld } from "./examples/hello-world";
import { internationalIdentifiers } from "./examples/international-identifiers";
import { payloadUnions } from "./examples/payload-unions";
import { specializations } from "./examples/specializations";
import { rat } from "./examples/rat";
import { compileSource } from "./compile";
import { linkModule } from "./module-execution";

describe("compileSource", () => {
  test("shows idiomatic payload-union constructors in JavaScript output", () => {
    const response = compileSource(6, payloadUnions.source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.diagnostics).toEqual([]);
    expect(response.javascript).toContain(
      'const Circle = radius => ({ tag: "Circle", radius });',
    );
    expect(response.javascript).not.toContain("const Circle = (radius) =>");
    expect(response.javascript).not.toContain("radius: radius");
  });

  test("compiles international JavaScript-compatible identifiers without mangling", () => {
    const response = compileSource(6, internationalIdentifiers.source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.diagnostics).toEqual([]);
    expect(response.javascript).toContain(
      "const Tउपयोगकर्ता = __hex_record => __hex_record;",
    );
    expect(response.javascript).toContain(
      "const __hex_instance_C可显示_Tउपयोगकर्ता",
    );
    expect(response.javascript).toContain("const 用户 = { नाम: \"अनाया\", 城市: \"上海\" };");
    expect(response.javascript).toContain("const $税率 = 0.10;");
    expect(response.javascript).toContain("const _折扣 = 5;");
    expect(response.javascript).toContain('import * as Mगणित from "./Mगणित.js";');
    expect(response.javascript).toContain("console.log(展示(用户,");
    expect(response.javascript).toContain("Mगणित.जोड़(20, 22)");
    expect(response.executionModules.map(({ path }) => path)).toEqual([
      "/stdlib/Rat.hex",
      "/Mगणित.hex",
      "/main.hex",
    ]);
  });

  test("maps virtual-module diagnostics back into the combined workspace document", () => {
    const source =
      "module Repo\n" +
      "export let broken = missing\n" +
      "end module Repo\n" +
      "console.log(Repo.broken)\n";
    const response = compileSource(7, source);

    expect(response.kind).toBe("compile-failure");
    if (response.kind !== "compile-failure") return;
    expect(response.diagnostics).toContainEqual({
      severity: "error",
      message: "unknown name `missing`",
      startOffset: source.indexOf("missing"),
      endOffset: source.indexOf("missing") + "missing".length,
    });
  });

  test("previews private bindings through JavaScript and TypeScript emission", () => {
    const response = compileSource(7, helloWorld.source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.version).toBe(7);
    expect(response.diagnostics).toEqual([]);
    expect(response.javascript).toContain(
      "// Unions describe a closed set of alternatives.",
    );
    expect(response.javascript).toContain("const card = [10, Hearts];");
    expect(response.javascript).toContain("const greet =");
    expect(response.javascript).toContain("const plus =");
    expect(response.javascript).toContain("function factorial(n)");
    expect(response.javascript).toContain("const color =");
    expect(response.javascript).toContain('console.log(greet("Hexagon"));');
    expect(response.javascript).not.toContain("export { greet }");
    expect(response.typeScriptPreview).toContain("declare const greet");
    expect(response.typeScriptPreview).toContain("declare function factorial");
    expect(response.typeScriptPreview).not.toContain(
      "export declare const greet",
    );
    expect(response.types.map(({ name, displayedType }) => ({ name, displayedType }))).toEqual([
      { name: "card", displayedType: "(Int, Suit)" },
      { name: "rank", displayedType: "Int" },
      { name: "suit", displayedType: "Suit" },
      { name: "greet", displayedType: "String -> String" },
      { name: "greet2", displayedType: "Show a => a -> String" },
      { name: "plus", displayedType: "(Int, Int) -> Int" },
      { name: "factorial", displayedType: "Int -> Int" },
      { name: "color", displayedType: "Suit -> String" },
    ]);
  });

  test("compiles then-form conditionals split across aligned lines", () => {
    const response = compileSource(
      8,
      "fun fact(n: Int): Int =\n" +
        "    if n <= 1\n" +
        "    then 1\n" +
        "    else n * fact(n - 1)\n",
    );

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.diagnostics).toEqual([]);
    expect(response.javascript).toContain("function fact(n)");
    expect(response.typeScriptPreview).toContain(
      "declare function fact(n: number): number",
    );
    expect(response.types.map(({ name, displayedType }) => ({ name, displayedType }))).toEqual([
      { name: "fact", displayedType: "Int -> Int" },
    ]);
  });

  test("compiles first-argument pipe insertion through the worker pipeline", () => {
    const response = compileSource(
      9,
      "let add(x: Int, y: Int) = x + y\n" +
        "let answer = 1 |> add(2) |> add(3)\n",
    );

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.diagnostics).toEqual([]);
    expect(response.javascript).toContain("const answer = add(add(1, 2), 3);");
    expect(response.types.map(({ name, displayedType }) => ({ name, displayedType }))).toEqual([
      { name: "add", displayedType: "(Int, Int) -> Int" },
      { name: "answer", displayedType: "Int" },
    ]);
  });

  test("returns private specialization regions for compact JavaScript views", () => {
    const response = compileSource(11, "let plus(x, y) = x + y\n");

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.javascript).toContain("function plusNat(x, y)");
    expect(response.javascript).toContain("function plusInt(x, y)");
    expect(response.javascript).toContain("function plusFloat(x, y)");
    expect(response.javascript).toContain("function plusBigInt(x, y)");
    expect(response.generatedJavaScript).toMatchObject([
      { generatedName: "plusNat", typeArguments: ["Nat"] },
      { generatedName: "plusInt", typeArguments: ["Int"] },
      { generatedName: "plusFloat", typeArguments: ["Float"] },
      { generatedName: "plusBigInt", typeArguments: ["BigInt"] },
    ]);
    for (const section of response.generatedJavaScript) {
      expect(response.javascript.slice(section.startOffset, section.endOffset)).toContain(
        `function ${section.generatedName}`,
      );
      expect(section.bytes).toBeGreaterThan(0);
    }
    expect(response.typeScriptPreview).toContain(
      "declare function plusInt(x: number, y: number): number;",
    );
  });

  test("routes the specialization example's concrete calls through its editions", () => {
    const response = compileSource(12, specializations.source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.javascript).toContain("console.log(plusInt(20, 22));");
    expect(response.javascript).toContain("console.log(plusFloat(20.0, 1.5));");
    expect(response.javascript).toContain("console.log(plusBigInt(10n, 20n));");
    expect(response.javascript).not.toContain("console.log(plus(20, 22,");
    expect(response.javascript).toContain("const count = 3;");
    expect(response.javascript).toContain("const cost = 1.50;");
    expect(response.javascript).toContain("const total = count * cost;");
    expect(
      response.types.slice(-3).map(({ name, displayedType }) => ({
        name,
        displayedType,
      })),
    ).toEqual([
      { name: "count", displayedType: "Int" },
      { name: "cost", displayedType: "Float" },
      { name: "total", displayedType: "Float" },
    ]);
  });

  test("compiles the Rat example through exact BigInt arithmetic", () => {
    const response = compileSource(13, rat.source);

    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.diagnostics).toEqual([]);
    expect(response.javascript).toContain('import * as Rat from "./stdlib/Rat.js";');
    expect(response.javascript).toContain(
      "const fiveSixths = __hex_imported_0___hex_instance_Num_Rat.add(half, third);",
    );
    expect(response.javascript).toContain(
      "const threeHalves = __hex_imported_0___hex_instance_Frac_Rat.divide(half, third);",
    );
    expect(response.javascript).toContain("const half = Rat.create(1n, 2n);");
    expect(response.javascript).toContain("const tenTwelfths = Rat.create(10n, 12n);");
    expect(response.javascript).toContain("tenTwelfths, fiveSixths");
    expect(response.javascript).not.toContain("export opaque record Rat");
    expect(response.executionModules.map(({ path }) => path)).toContain(
      "/stdlib/Rat.hex",
    );
    const ratModule = response.executionModules.find(({ path }) =>
      path === "/stdlib/Rat.hex"
    );
    expect(ratModule?.javascript).toContain('bottom === 0n');
    expect(ratModule?.javascript).toContain('reducedBottom < 0n');
    expect(ratModule?.javascript).toContain('name = "DivideByZeroError"');
    expect(ratModule?.javascript).toContain(
      "const __hex_instance_Frac_Rat = { signed: __hex_instance_Signed_Rat, divide:",
    );
    expect(ratModule?.javascript).toContain("export { __hex_instance_Frac_Rat };");
    expect(response.types).toContainEqual(expect.objectContaining({
      name: "fiveSixths",
      displayedType: "Rat",
    }));
    expect(response.types).toContainEqual(expect.objectContaining({
      name: "threeHalves",
      displayedType: "Rat",
    }));
    expect(response.types).toContainEqual(expect.objectContaining({
      name: "tenTwelfths",
      displayedType: "Rat",
    }));
  });

  test("executes the real stdlib Rat module through imported Num and Frac evidence", async () => {
    const response = compileSource(14, rat.source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;
    const moduleUrls = new Map<string, string>();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      for (const module of response.executionModules) {
        const linked = linkModule(module.javascript, module.path, moduleUrls);
        moduleUrls.set(
          module.path,
          `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
        );
      }
      await import(/* @vite-ignore */ moduleUrls.get(response.entryPath)!);
      expect(log).toHaveBeenCalledWith("1/2 + 1/3 = 5/6");
      expect(log).toHaveBeenCalledWith("1/2 / 1/3 = 3/2");
      expect(log).toHaveBeenCalledWith("Does 10/12 = 5/6? true");
    } finally {
      log.mockRestore();
    }
  });

  test("brands exact Rat division by zero through imported Frac evidence", async () => {
    const response = compileSource(
      15,
      "let half = Rat.create(1, 2)\n" +
        "let zero = Rat.create(0, 1)\n" +
        "let impossible = half / zero\n",
    );

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;
    expect(response.javascript).toContain(
      "__hex_imported_0___hex_instance_Frac_Rat.divide(half, zero)",
    );
    const moduleUrls = new Map<string, string>();
    for (const module of response.executionModules) {
      const linked = linkModule(module.javascript, module.path, moduleUrls);
      moduleUrls.set(
        module.path,
        `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
      );
    }
    let thrown: unknown;
    try {
      await import(/* @vite-ignore */ moduleUrls.get(response.entryPath)!);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ name: "DivideByZeroError", $hex: true });
  });

  test("lets a workspace Rat module occlude the fundamental companion", () => {
    const source =
      "module Rat\n" +
      "export let create(value: Int): Int = value\n" +
      "end module Rat\n" +
      "let answer = Rat.create(42)\n";
    const response = compileSource(15, source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;
    expect(response.executionModules.map(({ path }) => path)).toEqual([
      "/Rat.hex",
      "/main.hex",
    ]);
    expect(response.javascript).toContain('import * as Rat from "./Rat.js";');
    expect(response.javascript).not.toContain("./stdlib/Rat.js");
  });

  test("returns exact binding spans for editor hovers", () => {
    const source = "let answer = 42\n";
    const response = compileSource(10, source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.types[0]).toMatchObject({
      name: "answer",
      displayedType: "Int",
      startOffset: source.indexOf("answer"),
      endOffset: source.indexOf("answer") + "answer".length,
    });
  });

  test("returns inferred types and hover spans for tuple pattern bindings", () => {
    const source = "let card = (10, \"hearts\")\nlet (rank, suit) = card\n";
    const response = compileSource(11, source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    expect(response.types.slice(1)).toEqual([
      {
        name: "rank",
        displayedType: "Int",
        startOffset: source.indexOf("rank"),
        endOffset: source.indexOf("rank") + "rank".length,
      },
      {
        name: "suit",
        displayedType: "String",
        startOffset: source.indexOf("suit"),
        endOffset: source.indexOf("suit") + "suit".length,
      },
    ]);
  });

  test("returns hover types for declarations and every value reference", () => {
    const source =
      "let identity(value) = value\n" +
      "let answer = identity(42)\n";
    const response = compileSource(12, source);

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;

    const occurrences = response.typeOccurrences;
    const at = (name: string, startOffset: number) =>
      occurrences.find((occurrence) =>
        occurrence.name === name && occurrence.startOffset === startOffset
      );
    const declaration = source.indexOf("identity");
    const reference = source.lastIndexOf("identity");
    const parameter = source.indexOf("value");
    const parameterReference = source.lastIndexOf("value");

    expect(at("identity", declaration)?.displayedType).toBe("a -> a");
    expect(at("identity", reference)?.displayedType).toBe("a -> a");
    expect(at("value", parameter)?.displayedType).toBe("a");
    expect(at("value", parameterReference)?.displayedType).toBe("a");
    expect(at("answer", source.indexOf("answer"))?.displayedType).toBe("Int");
  });

  test("returns bounded, de-duplicated diagnostics instead of partial output", () => {
    const source = "let broken = missing\n";
    const response = compileSource(8, source);

    expect(response.kind).toBe("compile-failure");
    if (response.kind !== "compile-failure") return;

    expect(response.diagnostics).toHaveLength(1);
    expect(response.diagnostics[0]).toMatchObject({
      severity: "error",
      message: "unknown name `missing`",
    });
    expect(response.diagnostics[0]?.startOffset).toBeGreaterThanOrEqual(0);
    expect(response.diagnostics[0]?.endOffset).toBeLessThanOrEqual(source.length);
  });
});
