import { describe, expect, test } from "vitest";

import { helloWorld } from "./examples/hello-world";
import { compileSource } from "./compile";

describe("compileSource", () => {
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
      { name: "plus", displayedType: "(Int, Int) -> Int" },
      { name: "factorial", displayedType: "Int -> Int" },
      { name: "color", displayedType: "Suit -> String" },
    ]);
  });

  test("compiles then-form conditionals split across aligned lines", () => {
    const response = compileSource(
      8,
      "fun fact(n: Int): Int =\n" +
        "  if n <= 1\n" +
        "  then 1\n" +
        "  else n * fact(n - 1)\n",
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
