import { describe, expect, test, vi } from "vitest";

import { helloWorld } from "./examples/hello-world";
import { internationalIdentifiers } from "./examples/international-identifiers";
import { payloadUnions } from "./examples/payload-unions";
import { specializations } from "./examples/specializations";
import { rat } from "./examples/rat";
import { vectors } from "./examples/vectors";
import { compileSource } from "./compile";
import { linkModule } from "./module-execution";

describe("compileSource", () => {
  test("compiles the canonical Vector module surface", () => {
    const response = compileSource(5, vectors.source);

    expect(response).toMatchObject({ kind: "compile-success", diagnostics: [] });
    if (response.kind !== "compile-success") return;
    expect(response.javascript).toContain("Vector.append(numbers, 40)");
    expect(response.javascript).toContain("Vector.set(extended, 2, 25)");
    expect(response.javascript).toContain("Vector.at(updated, -1)");
    expect(response.javascript).toContain("Vector.get(updated, 5)");
    const vectorModule = response.executionModules.find(({ path }) =>
      path === "/stdlib/Vector.hex"
    );
    expect(vectorModule?.javascript).not.toContain(
      "const __hex_persistentCollections",
    );
    // `Option`/`Some`/`None` are implicit via the prelude; Vector imports only
    // the constructors it uses, ordered by first reference.
    expect(vectorModule?.javascript).toContain(
      'import { None, Some } from "./Option.js";',
    );
  });

  // The observation channel is an export, not a sink (#417): the assertions
  // below read the crossed `Vector` values themselves, and `log` renders a
  // `String`. An exported binding hands them over unrendered, which is what
  // this test is about, and it is what a consumer of the emitted module reads.
  // The written signature is the price of exporting (Modules §4.1.1) — and it
  // is also what pins `Vector.empty`'s element, which nothing else here does.
  test("executes the complete canonical Vector core API", async () => {
    const response = compileSource(
      5,
      "let values = [10, 20, 30]\n" +
        "let updated = Vector.set(values, 2, 25)\n" +
        "export let crossed: (Vector(Int), Vector(Int), Bool, Int, " +
        "Vector(Int), Vector(Int), Option(Int), Option(Int), Vector(Int), " +
        "Vector(Int), Option(Int), Option(Int), Int, Vector(Int), " +
        "Vector(Int), Vector(Int)) = (\n" +
        "    Vector.empty,\n" +
        "    Vector.singleton(7),\n" +
        "    Vector.isEmpty([]),\n" +
        "    Vector.length(values),\n" +
        "    Vector.append(values, 40),\n" +
        "    Vector.prepend(values, 0),\n" +
        "    Vector.first(values),\n" +
        "    Vector.last(values),\n" +
        "    Vector.dropFirst(values),\n" +
        "    Vector.dropLast(values),\n" +
        "    Vector.get(values, 2),\n" +
        "    Vector.get(values, 9),\n" +
        "    Vector.at(values, -1),\n" +
        "    updated,\n" +
        "    values,\n" +
        "    Vector.fromSeq(Vector.toSeq(values))\n" +
        ")\n",
    );

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;
    const moduleUrls = new Map<string, string>();
    for (const module of response.executionModules) {
      const linked = linkModule(module.javascript, module.path, moduleUrls);
      moduleUrls.set(
        module.path,
        `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
      );
    }
    const entry = await import(
      /* @vite-ignore */ moduleUrls.get(response.entryPath)!
    ) as { readonly crossed: unknown[] };
    // The tuple crosses as a JavaScript array, but each `Vector` in it is the
    // Collections Part 3 §4 trie, so the vector-valued slots are read through
    // the representation contract's `[Symbol.iterator]` — which is the same
    // spread a user of the emitted program would write.
    const crossed = entry.crossed;
    const vector = (index: number): unknown[] => [...(crossed[index] as Iterable<unknown>)];
    expect([
      vector(0),
      vector(1),
      crossed[2],
      crossed[3],
      vector(4),
      vector(5),
      crossed[6],
      crossed[7],
      vector(8),
      vector(9),
      crossed[10],
      crossed[11],
      crossed[12],
      vector(13),
      vector(14),
      vector(15),
    ]).toEqual([
      [],
      [7],
      true,
      3,
      [10, 20, 30, 40],
      [0, 10, 20, 30],
      { tag: "Some", value: 10 },
      { tag: "Some", value: 30 },
      [20, 30],
      [10, 20],
      { tag: "Some", value: 20 },
      { tag: "None" },
      30,
      [10, 25, 30],
      [10, 20, 30],
      [10, 20, 30],
    ]);
  });

  test("preserves the original signed index in Vector.at failures", async () => {
    const response = compileSource(5, "let impossible = Vector.at([10, 20], -3)\n");

    expect(response.kind).toBe("compile-success");
    if (response.kind !== "compile-success") return;
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
    expect(thrown).toMatchObject({
      name: "IndexError",
      message: "index -3 out of bounds for size 2",
      $hex: true,
      index: -3,
      size: 2,
    });
  });

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
    expect(response.javascript).toContain("log(展示(用户,");
    expect(response.javascript).toContain("Mगणित.जोड़(20, 22)");
    // `/Prelude.hex` is emitted because the always-supplied `Rat.hex` uses
    // `Ordering`, and `/VectorTrie.hex` because `Vector.hex` is built on it —
    // the trie runtime is reached the way a prelude member is, by an emitted
    // import rather than by a source one. `/BigInt.hex` joins for the same
    // reason since #344: `Rat.hex` normalizes through `Integral<BigInt>`'s
    // members, so the companion's dictionary and the constraint homes that
    // declare what it throws (`/Integral.hex`, `/Pow.hex`) are emitted with it.
    // `/Int.hex` joins at the second landing: `/VectorTrie.hex`'s index
    // arithmetic is `Integral<Int>`'s members at that companion now. `/Debug.hex`
    // joins wherever a source writes a line, which since #407 is every sample —
    // and `/String.hex` joins behind it since #419 widened the probe to
    // `log<a: Show>`, because a line written at `String` now needs the companion
    // that houses `Show<String>`.
    expect(response.executionModules.map(({ path }) => path)).toEqual([
      "/Pow.hex",
      "/Prelude.hex",
      "/Integral.hex",
      "/stdlib/Option.hex",
      "/BigInt.hex",
      "/Int.hex",
      "/String.hex",
      "/VectorTrie.hex",
      "/stdlib/Vector.hex",
      "/Debug.hex",
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
      "log(Repo.broken)\n";
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
    // Since #419 the probe is `log<a: Show>`, so a call site hands it the
    // resolved dictionary as a trailing argument (FFI Part 9 §6). The binding
    // this line is really about is `greet`, so the evidence spelling is left
    // out of the pin rather than nailed down.
    expect(response.javascript).toMatch(/log\(greet\("Hexagon"\), \w+\);/);
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

  test("compiles the canonical multiline conditional", () => {
    const response = compileSource(
      8,
      "fun fact(n: Int): Int =\n" +
        "    if n <= 1 then\n" +
        "        1\n" +
        "    else\n" +
        "        n * fact(n - 1)\n",
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

    // The claim is the routing — each concrete call reaches its own edition
    // rather than the generic `plus` — so the trailing `Show` evidence #419's
    // widened `log` now takes is matched loosely rather than spelled out.
    expect(response.javascript).toMatch(/log\(String\(plusInt\(20, 22\)\), \w+\);/);
    expect(response.javascript).toMatch(/log\(String\(plusFloat\(20\.0, 1\.5\)\), \w+\);/);
    expect(response.javascript).toMatch(/log\(String\(plusBigInt\(10n, 20n\)\), \w+\);/);
    expect(response.javascript).not.toContain("log(String(plus(20, 22,");
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
      "const fiveSixths = __hex_imported_2___hex_instance_Num_Rat.add(half, third);",
    );
    expect(response.javascript).toContain(
      "const threeHalves = __hex_imported_2___hex_instance_Frac_Rat.divide(half, third);",
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
    // The brand is `Integral.hex`'s `exception` declaration now, reached by
    // import (#344), rather than a helper branding an `Error` in place. The
    // observable — name, message, `$hex` — is pinned by the executed test
    // below, which is where it belongs.
    expect(ratModule?.javascript).toContain("DivideByZeroError(\"Rat.create: bottom is zero\")");
    expect(ratModule?.javascript).toContain('from "../Integral.js"');
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
      // `True`, not `true` (#147): interpolating a `Bool` shows its constructor
      // name, the ruling's one silent behaviour change. Pinned here on purpose.
      expect(log).toHaveBeenCalledWith("Does 10/12 = 5/6? True");
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
      "__hex_imported_2___hex_instance_Frac_Rat.divide(half, zero)",
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
    expect(thrown).toMatchObject({
      name: "DivideByZeroError",
      message: "Rat.divide: divisor is zero",
      $hex: true,
    });
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
    // `/Int.hex` and the constraint homes its guards throw from arrive with
    // `/VectorTrie.hex`, whose index arithmetic reaches `Integral<Int>` at that
    // companion since #344.
    expect(response.executionModules.map(({ path }) => path)).toEqual([
      "/Pow.hex",
      "/Integral.hex",
      "/stdlib/Option.hex",
      "/Int.hex",
      "/VectorTrie.hex",
      "/stdlib/Vector.hex",
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
