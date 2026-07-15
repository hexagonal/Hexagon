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

  test("recovers locally from a lowercase primitive annotation", () => {
    const module = parseSource("let bad(x: int) = x\nlet good = 1");

    expect(module.items).toMatchObject([
      {
        kind: "Let",
        name: { text: "bad" },
        value: { kind: "Lambda", parameters: [{ name: { text: "x" } }] },
      },
      { kind: "Let", name: { text: "good" } },
    ]);
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "the second compiler slice supports primitive type names in annotations",
    ]);
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

  test("recovers at layout separators and parses later items", () => {
    const module = parseSource(
      "record Point = {x: Int}\nlet = 1\nlet good = 2",
    );

    expect(module.items.map(({ kind }) => kind)).toEqual([
      "ErrorItem",
      "ErrorItem",
      "Let",
    ]);
    expect(module.items[2]).toMatchObject({ kind: "Let", name: { text: "good" } });
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "the first-round parser does not support `record` items yet",
      "`let` requires a lowercase name",
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
