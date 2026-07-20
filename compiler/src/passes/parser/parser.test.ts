import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as Parsed from "../../syntax/parsed/index.js";
import { applyLayout } from "../layout/layout.js";
import { lex } from "../lexer/lexer.js";
import { parse } from "./parser.js";

describe("parse", () => {
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
        "  | Clubs\n  | Diamonds\n  | Hearts\n  | Spades\n" +
        "let color(suit: Suit): String = match suit\n" +
        '  Clubs => "black"\n  Diamonds => "red"\n' +
        '  Hearts => "red"\n  Spades => "black"',
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

  test("parses inline and layout conditionals with nested blocks", () => {
    const module = parseSource(
      "let choose = if ready then yes else no\n" +
      "let act(x) =\n" +
      "  if x\n" +
      "    print(x)\n" +
      "  else\n" +
      "    print(0)\n" +
      "  x",
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

  test("treats aligned line breaks before then and else as continuations", () => {
    const splitThen = parseSource(
      "fun fact(n: Int): Int =\n" +
        "  if n <= 1\n" +
        "  then 1\n" +
        "  else n * fact(n - 1)",
    );
    const splitElse = parseSource(
      "fun fact(n: Int): Int =\n" +
        "  if n <= 1 then 1\n" +
        "  else n * fact(n - 1)",
    );

    for (const module of [splitThen, splitElse]) {
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
                  consequence: { kind: "Integer", decimal: "1" },
                  alternative: { kind: "Binary", operator: "Multiply" },
                },
              },
            ],
          },
        },
      });
      expect(module.diagnostics).toEqual([]);
    }
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
        "  var current: Int = start\n" +
        "  let bounds = 1..current\n" +
        "  while current > 0\n" +
        "    current := current - 1\n" +
        "  bounds",
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
        "  for number in 1..3\n" +
        "    console.log(number)\n" +
        "  for character in \"ab\"\n" +
        "    console.log(character)",
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
        "  type Item\n" +
        "  get(value: a): Item\n" +
        "honor Source<Int> =\n" +
        "  type Item = String\n" +
        '  get(value) = "${value}"',
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
        "  same(left: a, right: a): Bool\n" +
        "  different(left: a, right: a): Bool = not same(left, right)\n" +
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
