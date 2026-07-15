import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as Core from "../../syntax/core/index.js";
import { check } from "../checker/checker.js";
import { elaborate } from "../elaborator/elaborator.js";
import { applyLayout } from "../layout/layout.js";
import { lex } from "../lexer/lexer.js";
import { parse } from "../parser/parser.js";
import { resolve } from "../resolver/resolver.js";
import {
  emitDeclarations,
  emitJavaScript,
  emitTypeScriptPreview,
} from "./emitter.js";

describe("emitJavaScript", () => {
  test("emits recursive fun bindings as hoisted function declarations", () => {
    const module = coreSource(
      "export fun fact(n: Int): Int = " +
        "if n <= 1 then 1 else n * fact(n - 1)",
    );
    const javascript = emitJavaScript(module);
    const declarations = emitDeclarations(module);

    expect(javascript.text).toBe(
      "function fact(n) {\n" +
        "  return n <= 1 ? 1 : n * fact(n - 1);\n" +
        "}\n" +
        "export { fact };\n",
    );
    expect(declarations.text).toBe(
      "export declare function fact(n: number): number;\n",
    );
    expect(javascript.diagnostics).toEqual([]);
    expect(declarations.diagnostics).toEqual([]);
  });

  test("emits annotated primitive exports without dictionary evidence", () => {
    const module = coreSource("export let plus(x: Int, y) = x + y");
    const javascript = emitJavaScript(module);
    const declarations = emitDeclarations(module);

    expect(javascript.text).toBe(
      "const plus = (x, y) => x + y;\n" +
        "export { plus };\n",
    );
    expect(declarations.text).toBe(
      "export declare const plus: (x: number, y: number) => number;\n",
    );
    expect(javascript.diagnostics).toEqual([]);
    expect(declarations.diagnostics).toEqual([]);
  });

  test("emits bare, inserted, and chained pipes as ordinary calls", () => {
    const output = emitJavaScript(
      coreSource(
        "let add(x: Int, y: Int) = x + y\n" +
          "let identity = x => x\n" +
          "let bare = 1 |> identity\n" +
          "let chained = 1 |> add(2) |> add(3)",
      ),
    );

    expect(output.text).toBe(
      "const add = (x, y) => x + y;\n" +
        "const identity = x => x;\n" +
        "const bare = identity(1);\n" +
        "const chained = add(add(1, 2), 3);\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("keeps exported single-argument string functions readable", () => {
    const module = coreSource(
      'export let greet(name) = "Hello, " ++ name ++ "!"',
    );

    expect(emitJavaScript(module).text).toBe(
      'const greet = name => "Hello, " + name + "!";\n' +
        "export { greet };\n",
    );
    expect(emitDeclarations(module).text).toBe(
      "export declare const greet: (name: string) => string;\n",
    );
  });

  test("keeps only parentheses required by JavaScript precedence", () => {
    const output = emitJavaScript(
      coreSource(
        "let product = (1 + 2) * 3\n" +
          "let difference = 1 - (2 - 3)\n" +
          "let logic = (true or false) and true\n" +
          "let sum = 1 + 2 * 3\n" +
          "let power = (-2.0) ** 3.0",
      ),
    );

    expect(output.text).toBe(
      "const product = (1 + 2) * 3;\n" +
        "const difference = 1 - (2 - 3);\n" +
        "const logic = (true || false) && true;\n" +
        "const sum = 1 + 2 * 3;\n" +
        "const power = (-2.0) ** 3.0;\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("emits readable private bindings, functions, calls, and arithmetic", () => {
    const output = emitJavaScript(
      coreSource(
        "let double = x => x * 2.0\n" +
          "let answer = double(3.0) + 1.0",
      ),
    );

    expect(output.text).toBe(
      "const double = x => x * 2.0;\n" +
        "const answer = double(3.0) + 1.0;\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("preserves blank lines between top-level items", () => {
    const output = emitJavaScript(
      coreSource(
        "fun fact(n: Int): Int =\n" +
          "  if n <= 1\n" +
          "  then 1\n" +
          "  else n * fact(n - 1)\n\n" +
          "let answer = 6 * 7",
      ),
    );

    expect(output.text).toBe(
      "function fact(n) {\n" +
        "  return n <= 1 ? 1 : n * fact(n - 1);\n" +
        "}\n\n" +
        "const answer = 6 * 7;\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("omits an empty export marker from JavaScript", () => {
    expect(emitJavaScript(coreSource("let privateValue = 42")).text).toBe(
      "const privateValue = 42;\n",
    );
    expect(emitJavaScript(coreSource("")).text).toBe("");
  });

  test("passes dictionaries through constrained function bodies", () => {
    const output = emitJavaScript(coreSource("let addOne = x => x + 1"));

    expect(output.text).toBe(
      "const addOne = ($dictNum1, x) => " +
        "$dictNum1.add(x, $dictNum1.fromInt(1));\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("emits interpolation, conditionals, and structural logic", () => {
    const output = emitJavaScript(
      coreSource(
        'let message = "value: ${1}"\n' +
          "let choose = (condition, yes, no) => if condition then yes else no\n" +
          "let implication = (a, b) => a implies b",
      ),
    );

    expect(output.text).toBe(
      'const message = "value: " + String(1);\n' +
        "const choose = (condition, yes, no) => condition ? yes : no;\n" +
        "const implication = (a, b) => !a || b;\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("emits block returns and immediately called lambdas", () => {
    const output = emitJavaScript(
      coreSource(
        "let compute = () =>\n  let value = 1\n  value\n" +
          "let immediate = (x => x)(2)",
      ),
    );

    expect(output.text).toBe(
      "const compute = () => {\n" +
        "  const value = 1;\n" +
        "  return value;\n" +
        "};\n" +
        "const immediate = (x => x)(2);\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("preserves comparison-chain evaluation and short circuiting", () => {
    const output = emitJavaScript(coreSource("let bounded = 1 < 2 <= 3"));

    expect(output.text).toBe(
      "const bounded = (() => {\n" +
        "  const $compare0 = 1;\n" +
        "  const $compare1 = 2;\n" +
        "  if (!($compare0 < $compare1)) return false;\n" +
        "  const $compare2 = 3;\n" +
        "  return $compare1 <= $compare2;\n" +
        "})();\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("materializes semantic helpers only when required", () => {
    const output = emitJavaScript(
      coreSource("let same = 0.0 == 0.0\nlet ordered = 0.0 < 1.0"),
    );

    expect(output.text).toContain("function $hexFloatEquals(left, right)");
    expect(output.text).toContain("function $hexCompareFloat(left, right)");
    expect(output.text).toContain(
      "const same = $hexFloatEquals(0.0, 0.0);",
    );
    expect(output.text).toContain(
      "const ordered = $hexCompareFloat(0.0, 1.0) < 0;",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("emits the remaining primitive operations and generic evidence", () => {
    const output = emitJavaScript(
      coreSource(
        "let negative = -1\n" +
          "let quotient = 4.0 / 2.0\n" +
          'let joined = "a" ++ "b"\n' +
          "let powered = 2n ** 3n\n" +
          "let logic = not false and true or false\n" +
          'let display = x => "${x}"\n' +
          "let equal = x => x == x",
      ),
    );

    expect(output.text).toContain("const negative = -1;");
    expect(output.text).toContain("const quotient = 4.0 / 2.0;");
    expect(output.text).toContain('const joined = "a" + "b";');
    expect(output.text).toContain("function $hexCheckedPower(base, exponent)");
    expect(output.text).toContain("const powered = $hexCheckedPower(2n, 3n);");
    expect(output.text).toContain(
      "const logic = !false && true || false;",
    );
    expect(output.text).toMatch(
      /const display = \(\$dictShow\d+, x\) => \$dictShow\d+\.show\(x\);/u,
    );
    expect(output.text).toMatch(
      /const equal = \(\$dictEq\d+, x\) => \$dictEq\d+\.equals\(x, x\);/u,
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("emits primitive comparison variants without changing their semantics", () => {
    const output = emitJavaScript(
      coreSource(
        "let different = 1 != 2\n" +
          'let textOrder = "a" < "b"\n' +
          "let unitOrder = () <= ()",
      ),
    );

    expect(output.text).toContain("const different = !(1 === 2);");
    expect(output.text).toContain("function $hexCompareString(left, right)");
    expect(output.text).toContain(
      'const textOrder = $hexCompareString("a", "b") < 0;',
    );
    expect(output.text).toContain("const unitOrder = 0 <= 0;");
    expect(output.diagnostics).toEqual([]);
  });

  test("renames JavaScript-reserved source identifiers deterministically", () => {
    const output = emitJavaScript(coreSource("let await = 1\nawait"));

    expect(output.text).toBe("const $hex0 = 1;\n$hex0;\n");
    expect(output.diagnostics).toEqual([]);
  });

  test("diagnoses constrained calls until call-site evidence reaches Core", () => {
    const output = emitJavaScript(
      coreSource("let addOne = x => x + 1\naddOne(2)"),
    );

    expect(output.text).toContain("undefined;\n");
    expect(output.diagnostics.map(({ message }) => message)).toEqual([
      "cannot emit constrained call to `addOne` in the first JavaScript slice",
    ]);
  });

  test("is deterministic and bounded for arbitrary compiler input", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const module = coreSource(text);
        const first = emitJavaScript(module);
        const second = emitJavaScript(module);

        expect(first).toEqual(second);
        expect(first.text === "" || first.text.endsWith("\n")).toBe(true);
        for (const diagnostic of first.diagnostics) {
          expect(diagnostic.primary.start.offset).toBeGreaterThanOrEqual(0);
          expect(diagnostic.primary.end.offset).toBeLessThanOrEqual(text.length);
        }
      }),
      { numRuns: 250 },
    );
  });
});

describe("emitDeclarations", () => {
  test("keeps private bindings out of the declaration surface", () => {
    const output = emitDeclarations(coreSource("let privateValue = 42"));

    expect(output).toMatchObject({
      kind: "Declarations",
      text: "export {};\n",
      diagnostics: [],
    });
  });

  test("emits exported primitive and polymorphic function types", () => {
    const module = coreSource(
      "export let answer = 42\n" +
        "export let identity = x => x\n" +
        "export let noop = () => ()",
    );
    const javascript = emitJavaScript(module);
    const declarations = emitDeclarations(module);

    expect(javascript.text).toContain("export { answer };");
    expect(javascript.text).toContain("export { identity };");
    expect(javascript.text).toContain("export { noop };");
    expect(declarations.text).toBe(
      "export declare const answer: number;\n" +
      "export declare const identity: <a>(x: a) => a;\n" +
        "export declare const noop: () => void;\n",
    );
    expect(javascript.diagnostics).toEqual([]);
    expect(declarations.diagnostics).toEqual([]);
  });

  test("maps every implemented primitive and nested function type honestly", () => {
    const declarations = emitDeclarations(
      coreSource(
        "export let ratio = 1.5\n" +
          "export let flag = true\n" +
          'export let text = "hello"\n' +
          "export let exact = 2n\n" +
          "export let unit = ()\n" +
          "export let apply = f => x => f(x)",
      ),
    );

    expect(declarations.text).toContain("export declare const ratio: number;");
    expect(declarations.text).toContain("export declare const flag: boolean;");
    expect(declarations.text).toContain("export declare const text: string;");
    expect(declarations.text).toContain("export declare const exact: bigint;");
    expect(declarations.text).toContain("export declare const unit: undefined;");
    expect(declarations.text).toContain(
      "export declare const apply: <a, b>(f: (arg0: a) => b) => (x: a) => b;",
    );
    expect(declarations.diagnostics).toEqual([]);
  });

  test("withholds constrained exports until their public ABI is implemented", () => {
    const module = coreSource("export let addOne = x => x + 1");
    const javascript = emitJavaScript(module);
    const declarations = emitDeclarations(module);
    const message =
      "cannot emit constrained export `addOne` until the public dictionary ABI is implemented";

    expect(javascript.text).not.toContain("export { addOne }");
    expect(declarations.text).toBe("export {};\n");
    expect(javascript.diagnostics.map((diagnostic) => diagnostic.message)).toContain(message);
    expect(declarations.diagnostics.map((diagnostic) => diagnostic.message)).toContain(message);
  });
});

describe("emitTypeScriptPreview", () => {
  test("describes private top-level bindings without exporting them", () => {
    const output = emitTypeScriptPreview(
      coreSource(
        'let greet(name) = "Hello, " ++ name\n' +
          "let plus(x: Int, y) = x + y\n" +
          "let answer = 42",
      ),
    );

    expect(output).toMatchObject({
      kind: "TypeScriptPreview",
      text:
        "declare const greet: (name: string) => string;\n" +
        "declare const plus: (x: number, y: number) => number;\n" +
        "declare const answer: number;\n" +
        "export {};\n",
      diagnostics: [],
    });
  });

  test("includes private recursive functions without exporting them", () => {
    const output = emitTypeScriptPreview(
      coreSource(
        "fun fact(n: Int): Int = if n <= 1 then 1 else n * fact(n - 1)",
      ),
    );

    expect(output.text).toBe(
      "declare function fact(n: number): number;\n" +
        "export {};\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("withholds constrained previews without failing ordinary compilation", () => {
    const output = emitTypeScriptPreview(
      coreSource("let addOne = x => x + 1\nlet answer = 42"),
    );

    expect(output.text).toBe(
      "declare const answer: number;\n" +
        "export {};\n",
    );
    expect(output.diagnostics).toMatchObject([
      {
        severity: "warning",
        message:
          "cannot preview constrained binding `addOne` in TypeScript until " +
          "its dictionary representation is implemented",
      },
    ]);
  });
});

function coreSource(text: string): Core.Module {
  const source = new Source.File(Source.fileId(0), "test.hex", text);
  return elaborate(check(resolve(parse(applyLayout(lex(source))))));
}
