import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as Parsed from "../../syntax/parsed/index.js";
import { applyLayout } from "../layout/layout.js";
import { lex } from "../lexer/lexer.js";
import { parse } from "./parser.js";

describe("parse", () => {
  test("parses named, aliased, default, type-only, and effect extern declarations", () => {
    const module = parseSource(
      "extern from \"tiny-json\"\n" +
        "    export type JsonValue\n" +
        "    export fun parse(text: String): JsonValue\n" +
        "    let VERSION as version: String\n" +
        "    export default fun createClient(): JsonValue\n" +
        "extern import \"telemetry/register\"",
    );

    expect(module.items).toMatchObject([
      {
        kind: "ExternBlock",
        specifier: "tiny-json",
        declarations: [
          { kind: "ExternType", exported: true, localName: { text: "JsonValue" } },
          { kind: "ExternFun", exported: true, localName: { text: "parse" } },
          {
            kind: "ExternLet",
            foreignName: { text: "VERSION" },
            localName: { text: "version" },
          },
          { kind: "ExternFun", default: true, localName: { text: "createClient" } },
        ],
      },
      { kind: "ExternImport", specifier: "telemetry/register" },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("uses extern-specific rewrites and rejects bodies", () => {
    const module = parseSource(
      "extern from \"broken\"\n" +
        "    let parse(text: String): String\n" +
        "    fun version: String\n" +
        "    let callback: String -> String\n" +
        "    default fun create as make(): String\n" +
        "    fun run(): Unit = ()",
    );
    const messages = module.diagnostics.map(({ message }) => message);

    expect(messages).toContain(
      "extern callable declarations use `fun`; write `fun parse(...)` with explicit parameters",
    );
    expect(messages).toContain(
      "extern `fun` declares a callable and requires a parameter list; for a foreign value, write `let version: Type`",
    );
    expect(messages).toContain(
      "extern callable declarations use `fun`; write `fun callback(...)` with explicit parameters",
    );
    expect(messages).toContain(
      "`as` aliases a foreign export name; a `default` binding has none — name the binding directly",
    );
    expect(messages).toContain("extern declarations have no bodies");
  });
  test("parses aliases, qualified types, and opaque nominal exports", () => {
    const module = parseSource(
      "export type Pair(a) = (a, a)\n" +
        "export opaque record Token = {value: Int}\n" +
        "export opaque union Handle = File(Int) | Socket(Int)\n" +
        "let value: Api.Pair(Int) = (1, 2)",
    );

    expect(module.items).toMatchObject([
      { kind: "TypeAlias", exported: true, name: { text: "Pair" }, parameters: [{ text: "a" }] },
      { kind: "RecordDeclaration", exported: true, opaque: true },
      { kind: "Union", exported: true, opaque: true },
      { kind: "Let", annotation: { kind: "AppliedType", qualifier: { text: "Api" }, constructor: { text: "Pair" } } },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("parses module items with the specified arithmetic precedence", () => {
    const module = parseSource("let answer = 1 + 2 * 3 ** 2\nprint(answer)");

    expect(module.items).toHaveLength(2);
    expect(module.items[0]).toMatchObject({
      kind: "Let",
      name: { text: "answer" },
      value: {
        kind: "Binary",
        operator: "Add",
        right: {
          kind: "Binary",
          operator: "Multiply",
          right: { kind: "Binary", operator: "Power" },
        },
      },
    });
    expect(module.items[1]).toMatchObject({
      kind: "ExprItem",
      expression: { kind: "Call", callee: { kind: "Name" } },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("normalizes function headers and explicit lambdas to Lambda expressions", () => {
    const module = parseSource(
      "let add(x, y) = x + y\nlet increment = x => x + 1\nlet unit = () => ()",
    );
    const bindings = module.items as readonly Parsed.LetItem[];

    expect(bindings[0]?.value).toMatchObject({
      kind: "Lambda",
      parameters: [{ name: { text: "x" } }, { name: { text: "y" } }],
      body: { kind: "Binary", operator: "Add" },
    });
    expect(bindings[1]?.value).toMatchObject({
      kind: "Lambda",
      parameters: [{ name: { text: "x" } }],
    });
    expect(bindings[2]?.value).toMatchObject({
      kind: "Lambda",
      parameters: [],
      body: { kind: "Unit" },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("parses primitive parameter and result annotations", () => {
    const module = parseSource(
      "export let plus(x:Int, y: Int): Int = x + y\n" +
        "let negate = (value: Float): Float => -value",
    );
    const bindings = module.items as readonly Parsed.LetItem[];

    expect(bindings[0]?.value).toMatchObject({
      kind: "Lambda",
      parameters: [
        { name: { text: "x" }, annotation: { name: { text: "Int" } } },
        { name: { text: "y" }, annotation: { name: { text: "Int" } } },
      ],
      returnAnnotation: { name: { text: "Int" } },
    });
    expect(bindings[1]?.value).toMatchObject({
      kind: "Lambda",
      parameters: [
        { name: { text: "value" }, annotation: { name: { text: "Float" } } },
      ],
      returnAnnotation: { name: { text: "Float" } },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("parses recursive fun headers and explicit lambda forms", () => {
    const module = parseSource(
      "export fun fact(n: Int): Int = if n <= 1 then 1 else n * fact(n - 1)\n" +
        "fun loop = value => loop(value)",
    );

    expect(module.items).toMatchObject([
      {
        kind: "Fun",
        exported: true,
        name: { text: "fact" },
        value: {
          kind: "Lambda",
          parameters: [
            { name: { text: "n" }, annotation: { name: { text: "Int" } } },
          ],
          returnAnnotation: { name: { text: "Int" } },
        },
      },
      {
        kind: "Fun",
        exported: false,
        name: { text: "loop" },
        value: { kind: "Lambda", parameters: [{ name: { text: "value" } }] },
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("rejects non-lambda fun bindings and recovers at the next item", () => {
    const module = parseSource("fun answer = 42\nlet good = 1");

    expect(module.items).toMatchObject([
      { kind: "ErrorItem" },
      { kind: "Let", name: { text: "good" } },
    ]);
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`fun` requires a function header or lambda literal on its right-hand side",
    ]);
  });

  test("recovers locally from a non-uppercase-start primitive annotation", () => {
    const module = parseSource("let bad(x: int) = x\nlet good = 1");

    expect(module.items).toMatchObject([
      {
        kind: "Let",
        name: { text: "bad" },
        value: { kind: "Lambda", parameters: [{ name: { text: "x" } }] },
      },
      { kind: "Let", name: { text: "good" } },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("distinguishes tuple literals and types from grouping and parameters", () => {
    const module = parseSource(
      "let pair = (1, \"one\")\n" +
        "let grouped = (1)\n" +
        "let second(value: (String, Int)): Int = value.item2",
    );

    expect(module.items).toMatchObject([
      { kind: "Let", value: { kind: "Tuple", elements: [{ kind: "Integer" }, { kind: "String" }] } },
      { kind: "Let", value: { kind: "Group", expression: { kind: "Integer" } } },
      {
        kind: "Let",
        value: {
          kind: "Lambda",
          parameters: [{ annotation: { kind: "Tuple", elements: [{ kind: "NamedType" }, { kind: "NamedType" }] } }],
          returnAnnotation: { kind: "NamedType" },
          body: { kind: "Access", field: { text: "item2" } },
        },
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("parses tuple patterns as let binders", () => {
    const module = parseSource("let (name, _, (x, y)) = (\"point\", true, (3, 4))");

    expect(module.items).toMatchObject([
      {
        kind: "LetPattern",
        pattern: {
          kind: "Tuple",
          elements: [
            { kind: "Binding", name: { text: "name" } },
            { kind: "Wildcard" },
            {
              kind: "Tuple",
              elements: [
                { kind: "Binding", name: { text: "x" } },
                { kind: "Binding", name: { text: "y" } },
              ],
            },
          ],
        },
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("parses nullary unions and match expressions", () => {
    const module = parseSource(
      "union Suit =\n" +
        "    | Clubs\n    | Diamonds\n    | Hearts\n    | Spades\n" +
        "let color(suit: Suit): String = match suit\n" +
        '    Clubs => "black"\n    Diamonds => "red"\n' +
        '    Hearts => "red"\n    Spades => "black"',
    );

    expect(module.items).toMatchObject([
      {
        kind: "Union",
        name: { text: "Suit" },
        constructors: [
          { name: { text: "Clubs" } },
          { name: { text: "Diamonds" } },
          { name: { text: "Hearts" } },
          { name: { text: "Spades" } },
        ],
      },
      {
        kind: "Let",
        value: {
          kind: "Lambda",
          body: {
            kind: "Match",
            arms: [
              { pattern: { kind: "Constructor", name: { text: "Clubs" } } },
              { pattern: { kind: "Constructor", name: { text: "Diamonds" } } },
              { pattern: { kind: "Constructor", name: { text: "Hearts" } } },
              { pattern: { kind: "Constructor", name: { text: "Spades" } } },
            ],
          },
        },
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("records module-level exported let bindings", () => {
    const module = parseSource("export let answer = 42\nlet privateValue = 1");

    expect(module.items).toMatchObject([
      { kind: "Let", exported: true, name: { text: "answer" } },
      { kind: "Let", exported: false, name: { text: "privateValue" } },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("freely interleaves access, calls, and indexing", () => {
    const module = parseSource("users.at(1).profile.names[2]");

    expect(expression(module)).toMatchObject({
      kind: "Index",
      receiver: {
        kind: "Access",
        field: { text: "names" },
        receiver: {
          kind: "Access",
          field: { text: "profile" },
          receiver: { kind: "Call" },
        },
      },
      index: { kind: "Integer", decimal: "2" },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("puts exponentiation above unary minus and comparisons above not", () => {
    const module = parseSource("let number = -2 ** 2\nlet flag = not a == b and c");
    const bindings = module.items as readonly Parsed.LetItem[];

    expect(bindings[0]?.value).toMatchObject({
      kind: "Unary",
      operator: "Negate",
      operand: { kind: "Binary", operator: "Power" },
    });
    expect(bindings[1]?.value).toMatchObject({
      kind: "Binary",
      operator: "And",
      left: {
        kind: "Unary",
        operator: "Not",
        operand: { kind: "Comparison", operators: ["Equal"] },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("preserves comparison chains and rejects non-associative chains", () => {
    const module = parseSource("a < middle <= z\n1..2..3\nx := y := z");

    expect(expression(module)).toMatchObject({
      kind: "Comparison",
      operands: [{ kind: "Name" }, { kind: "Name" }, { kind: "Name" }],
      operators: ["Less", "LessEqual"],
    });
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`..` does not chain; write separate ranges",
      "`:=` does not chain; assignment produces `Unit`",
    ]);
  });

  test("parses inline and multiline conditionals with nested blocks", () => {
    const module = parseSource(
      "let choose = if ready then yes else no\n" +
      "let act(x) =\n" +
      "    if x then\n" +
      "        print(x)\n" +
      "    else\n" +
      "        print(0)\n" +
      "    x",
    );
    const bindings = module.items as readonly Parsed.LetItem[];

    expect(bindings[0]?.value).toMatchObject({
      kind: "If",
      consequence: { kind: "Name" },
      alternative: { kind: "Name" },
    });
    expect(bindings[1]?.value).toMatchObject({
      kind: "Lambda",
      body: {
        kind: "Block",
        items: [
          {
            kind: "ExprItem",
            expression: {
              kind: "If",
              consequence: { kind: "Block" },
              alternative: { kind: "Block" },
            },
          },
          { kind: "ExprItem", expression: { kind: "Name" } },
        ],
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("rejects the former layout conditional without then", () => {
    const module = parseSource(
      "let choose =\n" +
        "    if ready\n" +
        "        yes\n" +
        "    else\n" +
        "        no",
    );

    expect(module.diagnostics.map(({ message }) => message)).toContain(
      "`if` requires `then`; write `if condition then` before the indented true branch",
    );
  });

  test("requires an else for every conditional", () => {
    const module = parseSource(
      "let act(ready: Bool) =\n" +
        "    if ready then\n" +
        "        print(\"ready\")",
    );

    expect(module.diagnostics.map(({ message }) => message)).toContain(
      "`if` requires an `else`",
    );
  });

  test("parses the canonical multiline conditional", () => {
    const module = parseSource(
      "fun fact(n: Int): Int =\n" +
        "    if n <= 1 then\n" +
        "        1\n" +
        "    else\n" +
        "        n * fact(n - 1)",
    );

    expect(module.items[0]).toMatchObject({
      kind: "Fun",
      value: {
        kind: "Lambda",
        body: {
          kind: "Block",
          items: [
            {
              kind: "ExprItem",
              expression: {
                kind: "If",
                condition: {
                  kind: "Comparison",
                  operators: ["LessEqual"],
                },
                consequence: { kind: "Block" },
                alternative: { kind: "Block" },
              },
            },
          ],
        },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("parses expressions nested inside string interpolation", () => {
    const module = parseSource('"Hello, ${user.profile}!"');

    expect(expression(module)).toMatchObject({
      kind: "String",
      parts: [
        { kind: "Text", value: "Hello, " },
        {
          kind: "Interpolation",
          expression: {
            kind: "Access",
            receiver: { kind: "Name" },
            field: { text: "profile" },
          },
        },
        { kind: "Text", value: "!" },
      ],
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("parses mutable bindings, inclusive ranges, and while blocks", () => {
    const module = parseSource(
      "fun countdown(start: Int) =\n" +
        "    var current: Int = start\n" +
        "    let bounds = 1..current\n" +
        "    while current > 0\n" +
        "        current := current - 1\n" +
        "    bounds",
    );

    expect(module.items[0]).toMatchObject({
      kind: "Fun",
      value: {
        body: {
          kind: "Block",
          items: [
            { kind: "Var", name: { text: "current" } },
            { kind: "Let", value: { kind: "Binary", operator: "Range" } },
            {
              kind: "ExprItem",
              expression: {
                kind: "While",
                body: {
                  items: [{ expression: { kind: "Assignment" } }],
                },
              },
            },
            { kind: "ExprItem", expression: { kind: "Name" } },
          ],
        },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("parses for loops over ranges and strings", () => {
    const module = parseSource(
      "fun visit(): Unit =\n" +
        "    for number in 1..3\n" +
        "        console.log(number)\n" +
        "    for character in \"ab\"\n" +
        "        console.log(character)",
    );

    expect(module.items[0]).toMatchObject({
      kind: "Fun",
      value: {
        body: {
          items: [
            {
              expression: {
                kind: "For",
                pattern: { kind: "Binding", name: { text: "number" } },
                iterable: { kind: "Binary", operator: "Range" },
              },
            },
            {
              expression: {
                kind: "For",
                pattern: { kind: "Binding", name: { text: "character" } },
                iterable: { kind: "String" },
              },
            },
          ],
        },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("recovers at layout separators and parses later items", () => {
    const module = parseSource(
      "record Point = {x: Int}\nlet = 1\nlet good = 2",
    );

    expect(module.items.map(({ kind }) => kind)).toEqual([
      "RecordDeclaration",
      "ErrorItem",
      "Let",
    ]);
    expect(module.items[2]).toMatchObject({ kind: "Let", name: { text: "good" } });
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`let` requires a non-uppercase-start name",
    ]);
  });

  test("parses implied type declarations and instance bindings", () => {
    const module = parseSource(
      "constraint Source<a> =\n" +
        "    type Item\n" +
        "    get(value: a): Item\n" +
        "honor Source<Int> =\n" +
        "    type Item = String\n" +
        '    get(value) = "${value}"',
    );

    expect(module.items).toMatchObject([
      {
        kind: "ConstraintDeclaration",
        impliedTypes: [{ name: { text: "Item" } }],
        members: [{ name: { text: "get" }, returnAnnotation: { name: { text: "Item" } } }],
      },
      {
        kind: "Honor",
        impliedTypes: [{ name: { text: "Item" }, annotation: { name: { text: "String" } } }],
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("parses defaults, derives headers, and parameterized honors", () => {
    const module = parseSource(
      "constraint Same<a> =\n" +
        "    same(left: a, right: a): Bool\n" +
        "    different(left: a, right: a): Bool = not same(left, right)\n" +
        "record Box(a) derives (Eq, Show) = {value: a}\n" +
        "honor<a: Eq> Eq<Box(a)> = derive",
    );

    expect(module.items).toMatchObject([
      {
        kind: "ConstraintDeclaration",
        members: [{}, { defaultValue: { kind: "Lambda" } }],
      },
      {
        kind: "RecordDeclaration",
        derives: [{ text: "Eq" }, { text: "Show" }],
      },
      {
        kind: "Honor",
        derived: true,
        typeParameters: [{ name: { text: "a" }, constraints: [{ text: "Eq" }] }],
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("parses explicit function types with zero, one, and many parameters", () => {
    const module = parseSource(
      "type Nullary = () -> String\n" +
        "type Unary = Int -> String\n" +
        "type Binary = (Int, String) -> Bool\n" +
        "type TupleUnary = ((Int, String)) -> Bool\n" +
        "type Higher = (Int -> String) -> Bool\n" +
        "type Chain = Int -> String -> Bool",
    );

    expect(module.items).toMatchObject([
      {
        kind: "TypeAlias",
        annotation: { kind: "Function", parameters: [], result: { kind: "NamedType", name: { text: "String" } } },
      },
      {
        kind: "TypeAlias",
        annotation: { kind: "Function", parameters: [{ kind: "NamedType", name: { text: "Int" } }] },
      },
      {
        kind: "TypeAlias",
        annotation: { kind: "Function", parameters: [{ kind: "NamedType" }, { kind: "NamedType" }] },
      },
      {
        kind: "TypeAlias",
        annotation: { kind: "Function", parameters: [{ kind: "Tuple", elements: [{}, {}] }] },
      },
      {
        kind: "TypeAlias",
        annotation: { kind: "Function", parameters: [{ kind: "Function" }] },
      },
      {
        kind: "TypeAlias",
        annotation: { kind: "Function", result: { kind: "Function" } },
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("requires an arrow after an empty type parameter list", () => {
    const module = parseSource("type Wrong = ()");

    expect(module.diagnostics.map(({ message }) => message)).toContain(
      "an empty type parameter list must be followed by `->`; use `Unit` for the unit type",
    );
  });

  test("accepts function types in lambda annotations and layout continuations", () => {
    const module = parseSource(
      "type Callback =\n" +
        "    Int ->\n" +
        "        String\n" +
        "let keep = (callback: Int -> String): Int -> String => callback",
    );

    expect(module.items).toMatchObject([
      { kind: "TypeAlias", annotation: { kind: "Function" } },
      {
        kind: "Let",
        value: {
          kind: "Lambda",
          parameters: [{ annotation: { kind: "Function" } }],
          returnAnnotation: { kind: "Function" },
        },
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("parses guarded catch arms and reserves finally with one targeted error", () => {
    const module = parseSource(
      "exception Wrapped(value: Int)\n" +
        "let result = try\n" +
        "    throw(Wrapped(1))\n" +
        "catch\n" +
        "    Wrapped(value) when value > 0 => value\n" +
        "    _ => 0\n" +
        "finally\n" +
        "    cleanup()",
    );

    expect(module.items).toMatchObject([
      { kind: "Exception" },
      {
        kind: "Let",
        value: {
          kind: "Try",
          arms: [
            { pattern: { kind: "Constructor" }, guard: { kind: "Comparison" } },
            { pattern: { kind: "Wildcard" } },
          ],
        },
      },
    ]);
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`finally` is not part of Hexagon v1",
    ]);
  });

  test("uses representation-specific diagnostics for reserved exception fields", () => {
    const module = parseSource(
      "exception Named(name: String)\n" +
        "exception Stacked(stack: String)",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`name` is reserved as the exception's discriminant field; rename this field",
      "`stack` is reserved for the exception's stack trace; rename this field",
    ]);
  });

  test("recovers from arbitrary text with bounded public spans", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const module = parseSource(text);

        expect(module.span.start.offset).toBeGreaterThanOrEqual(0);
        expect(module.span.end.offset).toBeLessThanOrEqual(text.length);
        for (const diagnostic of module.diagnostics) {
          expect(diagnostic.primary.start.offset).toBeGreaterThanOrEqual(0);
          expect(diagnostic.primary.end.offset).toBeLessThanOrEqual(text.length);
        }
      }),
      { numRuns: 250 },
    );
  });
});

function parseSource(text: string): Parsed.Module {
  const source = new Source.File(Source.fileId(0), "test.hex", text);
  return parse(applyLayout(lex(source)));
}

function expression(module: Parsed.Module): Parsed.Expr {
  const item = module.items[0];
  if (item?.kind !== "ExprItem") {
    throw new Error("expected one expression item");
  }
  return item.expression;
}
