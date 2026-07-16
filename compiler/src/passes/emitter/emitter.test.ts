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
  test("expands nested or-patterns and emits exhaustive or-pattern bindings", () => {
    const module = coreSource(
      "union Side = Left(value: Int) | Right(value: Int)\n" +
        "union Box = Box(side: Side)\n" +
        "fun unbox(box: Box): Int = match box\n" +
        "  Box(Left(value) | Right(value)) => value\n" +
        "let true | false = true\n" +
        "let Left(amount) | Right(amount) = Left(42)",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain(
      '__match0.side.tag === "Left"',
    );
    expect(javascript).toContain(
      'else if (__match0.tag === "Box" && __match0.side.tag === "Right")',
    );
    expect(javascript).toContain("let amount;");
    expect(javascript).toContain("amount = __match1.value;");
  });

  test("emits negative, or, and single-constructor binding patterns", () => {
    const module = coreSource(
      "union Shape = Circle(radius: Float) | Rectangle(width: Float, height: Float) | Point\n" +
        "fun measure(shape: Shape): Float = match shape\n" +
        "  Circle(size) | Rectangle(size, _) when size > 0.0 => size\n" +
        "  Circle(_) | Rectangle(_, _) => 0.0\n" +
        "  Point => 0.0\n" +
        "fun sign(value: Int): String = match value\n" +
        '  -1 => "negative one"\n' +
        '  _ => "other"\n' +
        "union UserId = UserId(value: Int)\n" +
        "let UserId(value) = UserId(42)",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain('if (__match0.tag === "Circle")');
    expect(javascript).toContain('else if (__match0.tag === "Rectangle")');
    expect(javascript).toContain("if (__match1 === -1)");
    expect(javascript).toContain("const { value } = UserId(42);");
  });

  test("emits Unit, as-pattern, tuple, and record matches through ordered tests", () => {
    const unit = emitJavaScript(coreSource(
      'fun describe(value: Unit): String = match value\n  () => "unit"',
    )).text;
    expect(unit).toContain("if (__match0 === undefined)");

    const shape = emitJavaScript(coreSource(
      "union Shape = Circle(radius: Float) | Point\n" +
        "fun preserve(shape: Shape): Shape = match shape\n" +
        "  Circle(_) as whole => whole\n" +
        "  Point as whole => whole",
    )).text;
    expect(shape).toContain("const whole = __match0;");

    const structural = emitJavaScript(coreSource(
      'fun tupleLabel(pair: (Bool, Int)): String = match pair\n' +
        '  (true, count) => "active"\n' +
        '  (_, _) => "inactive"\n' +
        'fun recordName(user: {name: String, active: Bool}): String = match user\n' +
        '  {active: true, name} => name\n' +
        '  {name} => name',
    )).text;
    expect(structural).toContain("if (__match0[0] === true)");
    expect(structural).toContain("const count = __match0[1];");
    expect(structural).toContain("if (__match1.active === true)");
    expect(structural).toContain("const name = __match1.name;");
  });

  test("emits record construction punning as JavaScript shorthand", () => {
    const module = coreSource(
      'let guest = "Mira"\nlet seats = 3\nlet reservation = {guest, seats}',
    );
    expect(module.diagnostics).toEqual([]);
    expect(emitJavaScript(module).text).toContain(
      "const reservation = { guest, seats };",
    );
  });

  test("emits literal matches and guarded constructor arms in source order", () => {
    const primitive = coreSource(
      'fun describe(flag: Bool): String = match flag\n  true => "yes"\n  false => "no"',
    );
    const primitiveJavaScript = emitJavaScript(primitive).text;
    expect(primitiveJavaScript).toContain("if (__match0 === true)");
    expect(primitiveJavaScript).toContain("if (__match0 === false)");

    const guarded = coreSource(
      "union Shape = Circle(radius: Float) | Point\n" +
        "fun describe(shape: Shape): String = match shape\n" +
        '  Circle(radius) when radius > 0.0 => "positive"\n' +
        '  Circle(_) => "circle"\n' +
        '  Point => "point"',
    );
    expect(guarded.diagnostics).toEqual([]);
    const guardedJavaScript = emitJavaScript(guarded).text;
    expect(guardedJavaScript).toContain(
      'if (__match0.tag === "Circle")',
    );
    expect(guardedJavaScript).toContain("const radius = __match0.radius;");
    expect(guardedJavaScript).toContain(
      "if ($hexCompareFloat(radius, 0.0) > 0)",
    );
  });

  test("emits nested tuple and renamed record constructor patterns", () => {
    const module = coreSource(
      "union Result = Ok(value: (String, Int)) | Err(error: {context: {message: String}, code: Int})\n" +
        "export fun describe(result: Result): String = match result\n" +
        "  Ok((name, _)) => name\n" +
        "  Err({context: {message: reason}}) => reason",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain("const [name, ] = __match0.value;");
    expect(javascript).toContain(
      "const { context: { message: reason } } = __match0.error;",
    );
  });

  test("renders shared named record tails in TypeScript declarations", () => {
    const module = coreSource(
      'export fun rename(r: {guest: String, ...rest}): {guest: String, ...rest} = {...r, guest: "Renamed"}',
    );

    expect(module.diagnostics).toEqual([]);
    expect(emitDeclarations(module).text).toContain(
      "export declare function rename<a>(r: ({ guest: string } & a)): ({ guest: string } & a);",
    );
  });

  test("emits annotated record updates and open record destructuring readably", () => {
    const module = coreSource(
      "export let origin: {x: Float, y: Float} = {x: 0.0, y: 0.0}\n" +
        "fun move(p: {x: Float, y: Float}): {x: Float, y: Float} = {...p, x: p.x + 1.0}\n" +
        "let moved = move(origin)\n" +
        "let {x, y} = moved",
    );

    expect(module.diagnostics).toEqual([]);
    expect(emitJavaScript(module).text).toBe(
      "const origin = { x: 0.0, y: 0.0 };\n" +
        "function move(p) {\n" +
        "  return { ...p, x: p.x + 1.0 };\n" +
        "}\n" +
        "const moved = move(origin);\n" +
        "const { x, y } = moved;\n" +
        "export { origin };\n",
    );
    expect(emitDeclarations(module).text).toBe(
      "export declare const origin: { x: number; y: number };\n",
    );
  });

  test("emits payload unions, constructor patterns, and structural row-polymorphic records", () => {
    const module = coreSource(
      "export union Shape = Circle(radius: Float) | Point\n" +
        "fun xOf(r) = r.x\n" +
        "let point = {x: 3, y: 4}\n" +
        "let x = xOf(point)\n" +
        "export fun radius(shape: Shape): Float = match shape\n" +
        "  Circle(value) => value\n" +
        "  Point => 0.0",
    );

    expect(module.diagnostics).toEqual([]);
    expect(emitJavaScript(module).text).toContain(
      'const Circle = (radius) => ({ tag: "Circle", radius: radius });',
    );
    expect(emitJavaScript(module).text).toContain("const point = { x: 3, y: 4 };");
    expect(emitJavaScript(module).text).toContain("const value = __match0.radius;");
    expect(emitDeclarations(module).text).toContain(
      'export type Shape = { tag: "Circle"; radius: number } | { tag: "Point" };',
    );
  });

  test("emits the host console operation as ordinary readable JavaScript", () => {
    const module = coreSource('console.log("answer", 42, true)');

    expect(emitJavaScript(module)).toMatchObject({
      text: 'console.log("answer", 42, true);\n',
      diagnostics: [],
    });
  });

  test("emits tuples as arrays, positional access, and TypeScript tuple types", () => {
    const module = coreSource(
      'export let pair: (String, Int) = ("answer", 42)\n' +
        "export let answer = pair.item2",
    );

    expect(emitJavaScript(module).text).toBe(
      'const pair = ["answer", 42];\n' +
        "const answer = pair[1];\n" +
        "export { pair };\n" +
        "export { answer };\n",
    );
    expect(emitDeclarations(module).text).toBe(
      "export declare const pair: [string, number];\n" +
        "export declare const answer: number;\n",
    );
  });

  test("emits tuple patterns as readable array destructuring", () => {
    const module = coreSource(
      'let (name, _, (x, y)) = ("point", true, (3, 4))\n' +
        "let total = x + y",
    );

    expect(emitJavaScript(module).text).toBe(
      'const [name, , [x, y]] = ["point", true, [3, 4]];\n' +
        "const total = x + y;\n",
    );
    expect(emitTypeScriptPreview(module).text).toBe(
      "declare const name: string;\n" +
        "declare const x: number;\n" +
        "declare const y: number;\n" +
        "declare const total: number;\n" +
        "export {};\n",
    );
  });

  test("emits nullary unions, exhaustive matches, and declaration surfaces", () => {
    const module = coreSource(
      "export union Suit = Clubs | Diamonds | Hearts | Spades\n" +
        "export let card = (10, Hearts)\n" +
        "export let color(suit: Suit): String = match suit\n" +
        '  Clubs => "black"\n  Diamonds => "red"\n' +
        '  Hearts => "red"\n  Spades => "black"',
    );

    expect(emitJavaScript(module).text).toBe(
      'const Clubs = "Clubs";\n' +
        'const Diamonds = "Diamonds";\n' +
        'const Hearts = "Hearts";\n' +
        'const Spades = "Spades";\n' +
        "const card = [10, Hearts];\n" +
        "const color = suit => {\n" +
        "  switch (suit) {\n" +
        '    case "Clubs":\n      return "black";\n' +
        '    case "Diamonds":\n      return "red";\n' +
        '    case "Hearts":\n      return "red";\n' +
        '    case "Spades":\n      return "black";\n' +
        '    default:\n      throw new RangeError("Unexpected pattern.");\n' +
        "  }\n};\n" +
        "export { Clubs };\nexport { Diamonds };\n" +
        "export { Hearts };\nexport { Spades };\n" +
        "export { card };\nexport { color };\n",
    );
    expect(emitDeclarations(module).text).toBe(
      'export type Suit = "Clubs" | "Diamonds" | "Hearts" | "Spades";\n' +
        "export declare const Clubs: Suit;\n" +
        "export declare const Diamonds: Suit;\n" +
        "export declare const Hearts: Suit;\n" +
        "export declare const Spades: Suit;\n" +
        "export declare const card: [number, Suit];\n" +
        "export declare const color: (suit: Suit) => string;\n",
    );
  });

  test("uses a source catch-all arm instead of an unreachable-pattern guard", () => {
    const module = coreSource(
      "union Suit = Clubs | Spades\n" +
        "let color(suit: Suit): String = match suit\n" +
        '  _ => "black"',
    );

    const output = emitJavaScript(module);

    expect(output.text).toContain("switch (suit) {");
    expect(output.text).not.toContain("__match");
    expect(output.text.match(/default:/gu)).toHaveLength(1);
    expect(output.text).not.toContain("Unexpected pattern.");
    expect(output.diagnostics).toEqual([]);
  });

  test("names a scrutinee only when a match arm binds the whole value", () => {
    const module = coreSource(
      "union Suit = Clubs | Spades\n" +
        "let identity(suit: Suit): Suit = match suit\n" +
        "  whole => whole",
    );

    const output = emitJavaScript(module);

    expect(output.text).toContain("const __match0 = suit;");
    expect(output.text).toContain("switch (__match0) {");
    expect(output.text).toContain("const whole = __match0;");
    expect(output.diagnostics).toEqual([]);
  });

  test("keeps an IIFE only when a match must remain an expression", () => {
    const module = coreSource(
      "union Suit = Clubs | Spades\n" +
        "let suit = Clubs\n" +
        "let color: String = match suit\n" +
        '  Clubs => "black"\n' +
        '  Spades => "black"',
    );

    expect(emitJavaScript(module).text).toContain(
      "const color = (() => {\n" +
        "  switch (suit) {\n" +
        '    case "Clubs":\n      return "black";\n' +
        '    case "Spades":\n      return "black";\n' +
        '    default:\n      throw new RangeError("Unexpected pattern.");\n' +
        "  }\n})();",
    );
  });

  test("emits a final block match as direct control flow", () => {
    const module = coreSource(
      "union Suit = Clubs | Spades\n" +
        "let color(suit: Suit): String =\n" +
        "  let selected = suit\n" +
        "  match selected\n" +
        '    Clubs => "black"\n' +
        '    Spades => "black"',
    );

    const output = emitJavaScript(module);

    expect(output.text).toContain(
      "const color = suit => {\n" +
        "  const selected = suit;\n" +
        "  switch (selected) {",
    );
    expect(output.text).not.toContain("(() =>");
    expect(output.diagnostics).toEqual([]);
  });

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

  test("preserves top-level comments and their vertical spacing", () => {
    const output = emitJavaScript(
      coreSource(
        "// Card suits are a closed set.\n" +
          "union Suit = Clubs | Diamonds | Hearts | Spades\n\n" +
          "/* A card combines ordinary product and sum types. */\n" +
          "let card = (10, Hearts) // the ten of hearts",
      ),
    );

    expect(output.text).toBe(
      "// Card suits are a closed set.\n" +
        'const Clubs = "Clubs";\n' +
        'const Diamonds = "Diamonds";\n' +
        'const Hearts = "Hearts";\n' +
        'const Spades = "Spades";\n\n' +
        "/* A card combines ordinary product and sum types. */\n" +
        "const card = [10, Hearts]; // the ten of hearts\n",
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
      "const addOne = (__dictNum_1, x) => " +
        "__dictNum_1.add(x, __dictNum_1.fromInt(1));\n",
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
        "  const __compare0 = 1;\n" +
        "  const __compare1 = 2;\n" +
        "  if (!(__compare0 < __compare1)) return false;\n" +
        "  const __compare2 = 3;\n" +
        "  return __compare1 <= __compare2;\n" +
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
      /const display = \(__dictShow_\d+, x\) => __dictShow_\d+\.show\(x\);/u,
    );
    expect(output.text).toMatch(
      /const equal = \(__dictEq_\d+, x\) => __dictEq_\d+\.equals\(x, x\);/u,
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
