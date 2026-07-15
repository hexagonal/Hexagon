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
    expect(response.javascript).toContain("const greet =");
    expect(response.javascript).toContain("const plus =");
    expect(response.javascript).toContain("function fact(n)");
    expect(response.javascript).toContain("const answer =");
    expect(response.javascript).not.toContain("export { greet }");
    expect(response.typeScriptPreview).toContain("declare const greet");
    expect(response.typeScriptPreview).toContain("declare function fact");
    expect(response.typeScriptPreview).not.toContain(
      "export declare const greet",
    );
    expect(response.types).toEqual([
      { name: "greet", displayedType: "String -> String" },
      { name: "plus", displayedType: "(Int, Int) -> Int" },
      { name: "fact", displayedType: "Int -> Int" },
      { name: "answer", displayedType: "Int" },
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
    expect(response.types).toEqual([
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
    expect(response.types).toEqual([
      { name: "add", displayedType: "(Int, Int) -> Int" },
      { name: "answer", displayedType: "Int" },
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
