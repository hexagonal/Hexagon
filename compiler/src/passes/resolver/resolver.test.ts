import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as Resolved from "../../syntax/resolved/index.js";
import { applyLayout } from "../layout/layout.js";
import { lex } from "../lexer/lexer.js";
import { parse } from "../parser/parser.js";
import { resolve } from "./resolver.js";

describe("resolve", () => {
  test("gives extern terms and opaque types stable module identities", () => {
    const module = resolveSource(
      "extern from \"tiny-json\"\n" +
        "    export type JsonValue\n" +
        "    export fun parse(text: String): JsonValue\n" +
        "    let VERSION as version: String\n" +
        "let document: JsonValue = parse(version)",
    );

    expect(module.items[0]).toMatchObject({
      kind: "ExternBlock",
      declarations: [
        { kind: "ExternType", localName: "JsonValue", externType: 0 },
        { kind: "ExternFun", binding: { name: "parse" } },
        { kind: "ExternLet", binding: { name: "version" } },
      ],
    });
    expect(module.externTypes).toMatchObject([
      { localName: "JsonValue", externType: 0 },
    ]);
    expect(module.items[1]).toMatchObject({
      kind: "Let",
      annotation: { kind: "ExternType", name: "JsonValue", externType: 0 },
      value: {
        kind: "Call",
        callee: { kind: "Name", text: "parse" },
        arguments: [{ kind: "Name", text: "version" }],
      },
    });
    expect(module.diagnostics).toEqual([]);
  });
  test("gives implied types owner-relative scope", () => {
    const module = resolveSource(
      "constraint Source<a> =\n" +
        "    type Item\n" +
        "    get(value: a): Item\n" +
        "constraint Sink<a> =\n" +
        "    type Item\n" +
        "    put(value: a, item: Item): Unit\n" +
        "let invalid(value: Item) = value",
    );

    expect(module.items.slice(0, 2)).toMatchObject([
      { kind: "ConstraintDeclaration", impliedTypes: [{ name: "Item" }] },
      { kind: "ConstraintDeclaration", impliedTypes: [{ name: "Item" }] },
    ]);
    expect(module.diagnostics.map(({ message }) => message)).toContain(
      "`Item` is an implied type declared by `Sink` and `Source` and cannot appear in type expressions",
    );
  });
  test("assigns stable symbols to sequential bindings and references", () => {
    const module = resolveSource("let one = 1\nlet two = one + 1\ntwo");

    expect(module.symbols).toMatchObject([
      { id: 0, name: "one", kind: "let" },
      { id: 1, name: "two", kind: "let" },
    ]);
    expect(module.items[1]).toMatchObject({
      kind: "Let",
      binding: { symbol: 1, name: "two" },
      value: {
        kind: "Binary",
        left: { kind: "Name", symbol: 0, text: "one" },
      },
    });
    expect(module.items[2]).toMatchObject({
      kind: "ExprItem",
      expression: { kind: "Name", symbol: 1, text: "two" },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("resolves the unshadowed host console operation explicitly", () => {
    const module = resolveSource('console.log("hello", 42)');

    expect(module.items[0]).toMatchObject({
      kind: "ExprItem",
      expression: {
        kind: "ConsoleLog",
        arguments: [
          { kind: "String" },
          { kind: "Integer", decimal: "42" },
        ],
      },
    });
    expect(module.symbols).toEqual([]);
    expect(module.diagnostics).toEqual([]);
  });

  test("gives for-pattern binders a loop-local head scope", () => {
    const module = resolveSource(
      "let number = 99\n" +
        "for number in 1..3\n" +
        "    console.log(number)\n" +
        "number",
    );

    expect(module.symbols.map(({ name, kind }) => ({ name, kind }))).toEqual([
      { name: "number", kind: "let" },
      { name: "number", kind: "pattern" },
    ]);
    expect(module.items[1]).toMatchObject({
      expression: {
        kind: "For",
        pattern: { binding: { symbol: 1 } },
        body: {
          items: [{ expression: { arguments: [{ symbol: 1 }] } }],
        },
      },
    });
    expect(module.items[2]).toMatchObject({ expression: { symbol: 0 } });
    expect(module.diagnostics).toEqual([]);
  });

  test("resolves local vars and rejects module vars and mutable capture", () => {
    const local = resolveSource(
      "fun bump(value: Int): Int =\n" +
        "    var current = value\n" +
        "    current := current + 1\n" +
        "    current",
    );
    expect(local.symbols).toMatchObject([
      { name: "bump", kind: "fun" },
      { name: "value", kind: "parameter" },
      { name: "current", kind: "var" },
    ]);
    expect(local.diagnostics).toEqual([]);

    const invalid = resolveSource(
      "var global = 0\n" +
        "fun outer() =\n" +
        "    var local = 1\n" +
        "    let closure = () => local\n" +
        "    ()",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      "`var` is only allowed inside a function",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      "`local` is a `var` and cannot be used inside a lambda; copy it to a `let` first",
    );
  });

  test("diagnoses self-reference because let is non-recursive", () => {
    const module = resolveSource("let loop = x => loop(x)");

    expect(module.items[0]).toMatchObject({
      kind: "Let",
      binding: { symbol: 0 },
      value: {
        kind: "Lambda",
        parameters: [{ symbol: 1, name: "x" }],
        body: {
          kind: "Call",
          callee: { kind: "ErrorExpr" },
          arguments: [{ kind: "Name", symbol: 1, text: "x" }],
        },
      },
    });
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`loop` is not in scope in its own `let` definition; `let` is non-recursive — use `fun`.",
    ]);
  });

  test("resolves a fun name inside its own body", () => {
    const module = resolveSource(
      "fun fact(n: Int): Int = if n <= 1 then 1 else n * fact(n - 1)",
    );

    expect(module.symbols).toMatchObject([
      { id: 0, name: "fact", kind: "fun" },
      { id: 1, name: "n", kind: "parameter" },
    ]);
    expect(module.items[0]).toMatchObject({
      kind: "Fun",
      binding: { symbol: 0, name: "fact" },
      value: {
        kind: "Lambda",
        body: {
          kind: "If",
          alternative: {
            kind: "Binary",
            right: {
              kind: "Call",
              callee: { kind: "Name", symbol: 0, text: "fact" },
            },
          },
        },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("keeps record and union declarations in one type namespace", () => {
    const recordThenUnion = resolveSource(
      "record Shape = {size: Int}\nunion Shape = Circle",
    );
    const unionThenRecord = resolveSource(
      "union Shape = Circle\nrecord Shape = {size: Int}",
    );

    expect(recordThenUnion.diagnostics.map(({ message }) => message)).toContain(
      "type `Shape` is already declared",
    );
    expect(unionThenRecord.diagnostics.map(({ message }) => message)).toContain(
      "type `Shape` is already declared",
    );
  });

  test("resolves forward and mutual function references as one recursive group", () => {
    // `Int`, not `Bool`: since #147 `Bool` is a prelude declaration, and this
    // harness resolves one module with no prelude. The recursion group is what
    // is under test, and the annotation plays no part in forming it.
    const module = resolveSource(
      "fun even(n: Int): Int = odd(n - 1)\n" +
        "fun odd(n: Int): Int = even(n - 1)",
    );

    expect(module.diagnostics).toEqual([]);
    expect(module.items[0]).toMatchObject({
      kind: "Fun",
      value: { body: { kind: "Call", callee: { kind: "Name", text: "odd" } } },
    });
  });

  test("a `fun` body may not name a binding written below it", () => {
    // Functions §7.2: the forward visibility a `fun` has is over its own group,
    // and nothing else. A `let` below is simply not in scope yet, whether the
    // `fun` is called before it or after.
    const early = resolveSource(
      "fun announce(): String = message\n" +
        "announce()\n" +
        'let message = "ready"',
    );
    expect(early.diagnostics.map(({ message }) => message)).toEqual([
      "`message` is declared later in this block; declarations are read " +
      "top-down — move its declaration above this use",
    ]);

    const ready = resolveSource(
      'let message = "ready"\n' +
        "fun announce(): String = message\n" +
        "announce()",
    );
    expect(ready.diagnostics).toEqual([]);
  });

  test("the declared-later report reaches every later binder form", () => {
    // A destructured binding is a term binding like any other.
    expect(
      resolveSource(
        "fun f(): Int = a\n" +
          "let (a, b) = (1, 2)\n" +
          "f()\n",
      ).diagnostics.map(({ message }) => message),
    ).toEqual([
      "`a` is declared later in this block; declarations are read top-down — " +
      "move its declaration above this use",
    ]);

    // And a `fun` nested in a body reads the enclosing block top-down too.
    expect(
      resolveSource(
        "fun f(): Int =\n" +
          "    fun inner(): Int = a\n" +
          "    inner()\n" +
          "let a = 1\n" +
          "f()\n",
      ).diagnostics.map(({ message }) => message),
    ).toEqual([
      "`a` is declared later in this block; declarations are read top-down — " +
      "move its declaration above this use",
    ]);
  });

  test("a split `fun` group names the split as the repair", () => {
    // The two `fun`s would have recursed together; the `let` between them ends
    // the run (Functions §7.3), so the forward reference is reported with the
    // rewrite that restores the group.
    expect(
      resolveSource(
        "fun even(n: Int): Int = odd(n - 1)\n" +
          "let gap = 1\n" +
          "fun odd(n: Int): Int = even(n - 1)\n" +
          "even(4)\n",
      ).diagnostics.map(({ message }) => message),
    ).toEqual([
      "`odd` is declared later in this block; only an unbroken run of `fun`s " +
      "recurses together — move the intervening declaration out of the run, or " +
      "move `odd`'s declaration above this use",
    ]);
  });

  test("the ordinary backward reference stays legal", () => {
    expect(resolveSource("let a = 1\nfun f() = a\nf()\n").diagnostics).toEqual([]);
    expect(resolveSource("let a = 1\nfun g() = a\nfun f() = g()\nf()\n").diagnostics)
      .toEqual([]);
    expect(resolveSource("fun f(a: Int) = a\nf(1)\nlet a = 2\n").diagnostics).toEqual([]);
  });

  test("allows lambda parameters to shadow outer bindings", () => {
    const module = resolveSource("let x = 1\nlet increment = x => x + 1");

    expect(module.symbols).toMatchObject([
      { id: 0, name: "x", kind: "let" },
      { id: 1, name: "increment", kind: "let" },
      { id: 2, name: "x", kind: "parameter" },
    ]);
    expect(module.items[1]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        parameters: [{ symbol: 2 }],
        body: {
          kind: "Binary",
          left: { kind: "Name", symbol: 2, text: "x" },
        },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("resolves primitive annotations and diagnoses other type names", () => {
    const module = resolveSource(
      "let plus(x: Int, y): Int = x + y\n" +
        "let unsupported(value: Widget) = value",
    );

    expect(module.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        parameters: [
          { name: "x", annotation: { kind: "Primitive", name: "Int" } },
          { name: "y" },
        ],
        returnAnnotation: { kind: "Primitive", name: "Int" },
      },
    });
    expect(module.items[1]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        parameters: [
          { name: "value", annotation: { kind: "ErrorType" } },
        ],
      },
    });
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "unknown type `Widget`; this slice supports primitive, tuple, and declared union types",
    ]);
  });

  test("rejects sequential rebinding without changing the existing meaning", () => {
    const module = resolveSource(
      "let outer = x =>\n    let x = 2\n    x",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`x` is already bound (line 1); Hexagon does not allow rebinding — choose a different name.",
    ]);
    expect(module.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        parameters: [{ symbol: 1, name: "x" }],
        body: {
          kind: "Block",
          items: [
            { kind: "Let", binding: { symbol: 2, name: "x" } },
            {
              kind: "ExprItem",
              expression: { kind: "Name", symbol: 1, text: "x" },
            },
          ],
        },
      },
    });
  });

  test("rejects duplicate simultaneous parameters and retains the first", () => {
    const module = resolveSource("let choose = (x, x) => x");

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "duplicate parameter `x`",
    ]);
    expect(module.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        parameters: [{ symbol: 1 }, { symbol: 2 }],
        body: { kind: "Name", symbol: 1, text: "x" },
      },
    });
  });

  test("keeps block bindings lexical and resolves interpolations", () => {
    const module = resolveSource(
      "let f = x =>\n" +
        "    if x then\n" +
        "        let hidden = 1\n" +
        '        "${hidden}"\n' +
        "    else\n" +
        '        ""\n' +
        "    hidden",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "unknown name `hidden`",
    ]);
    expect(module.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        body: {
          kind: "Block",
          items: [
            {
              kind: "ExprItem",
              expression: {
                kind: "If",
                consequence: {
                  kind: "Block",
                  items: [
                    { kind: "Let", binding: { symbol: 2, name: "hidden" } },
                    {
                      kind: "ExprItem",
                      expression: {
                        kind: "String",
                        parts: [
                          {
                            kind: "Interpolation",
                            expression: {
                              kind: "Name",
                              symbol: 2,
                              text: "hidden",
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
            { kind: "ExprItem", expression: { kind: "ErrorExpr" } },
          ],
        },
      },
    });
  });

  test("never crashes on arbitrary parser output and preserves valid symbols", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const module = resolveSource(text);

        for (const symbol of module.symbols) {
          expect(Number(symbol.id)).toBeGreaterThanOrEqual(0);
          expect(module.symbols[Number(symbol.id)]).toBe(symbol);
        }
        visitItems(module.items, module.symbols, text.length);
      }),
      { numRuns: 250 },
    );
  });
});

function resolveSource(text: string): Resolved.Module {
  const source = new Source.File(Source.fileId(0), "test.hex", text);
  return resolve(parse(applyLayout(lex(source))));
}

function visitItems(
  items: readonly Resolved.Item[],
  symbols: readonly Resolved.Symbol[],
  sourceLength: number,
): void {
  for (const item of items) {
    expect(item.span.start.offset).toBeGreaterThanOrEqual(0);
    expect(item.span.end.offset).toBeLessThanOrEqual(sourceLength);
    if (item.kind === "Let") visitExpr(item.value, symbols, sourceLength);
    if (item.kind === "ExprItem") {
      visitExpr(item.expression, symbols, sourceLength);
    }
  }
}

function visitExpr(
  expression: Resolved.Expr,
  symbols: readonly Resolved.Symbol[],
  sourceLength: number,
): void {
  expect(expression.span.start.offset).toBeGreaterThanOrEqual(0);
  expect(expression.span.end.offset).toBeLessThanOrEqual(sourceLength);

  switch (expression.kind) {
    case "Name":
      expect(symbols[Number(expression.symbol)]?.name).toBe(expression.text);
      return;
    case "String":
      for (const part of expression.parts) {
        if (part.kind === "Interpolation") {
          visitExpr(part.expression, symbols, sourceLength);
        }
      }
      return;
    case "Group":
      return visitExpr(expression.expression, symbols, sourceLength);
    case "Block":
      return visitItems(expression.items, symbols, sourceLength);
    case "Lambda":
      return visitExpr(expression.body, symbols, sourceLength);
    case "If":
      visitExpr(expression.condition, symbols, sourceLength);
      visitExpr(expression.consequence, symbols, sourceLength);
      visitExpr(expression.alternative, symbols, sourceLength);
      return;
    case "While":
      visitExpr(expression.condition, symbols, sourceLength);
      return visitExpr(expression.body, symbols, sourceLength);
    case "Call":
      visitExpr(expression.callee, symbols, sourceLength);
      for (const argument of expression.arguments) {
        visitExpr(argument, symbols, sourceLength);
      }
      return;
    case "ConsoleLog":
      for (const argument of expression.arguments) {
        visitExpr(argument, symbols, sourceLength);
      }
      return;
    case "Access":
      return visitExpr(expression.receiver, symbols, sourceLength);
    case "Index":
      visitExpr(expression.receiver, symbols, sourceLength);
      return visitExpr(expression.index, symbols, sourceLength);
    case "Unary":
      return visitExpr(expression.operand, symbols, sourceLength);
    case "Binary":
      visitExpr(expression.left, symbols, sourceLength);
      return visitExpr(expression.right, symbols, sourceLength);
    case "Comparison":
      for (const operand of expression.operands) {
        visitExpr(operand, symbols, sourceLength);
      }
      return;
    case "Assignment":
      visitExpr(expression.target, symbols, sourceLength);
      return visitExpr(expression.value, symbols, sourceLength);
    case "Unit":
    case "Integer":
    case "BigInt":
    case "Float":
    case "ErrorExpr":
      return;
  }
}
