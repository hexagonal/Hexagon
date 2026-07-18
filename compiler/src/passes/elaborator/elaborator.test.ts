import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as Core from "../../syntax/core/index.js";
import { check } from "../checker/checker.js";
import { applyLayout } from "../layout/layout.js";
import { lex } from "../lexer/lexer.js";
import { parse } from "../parser/parser.js";
import { resolve } from "../resolver/resolver.js";
import { elaborate } from "./elaborator.js";

describe("elaborate", () => {
  test("preserves recursive function bindings while elaborating their bodies", () => {
    const module = elaborateSource(
      "fun fact(n: Int): Int = if n <= 1 then 1 else n * fact(n - 1)",
    );

    expect(module.items[0]).toMatchObject({
      kind: "Fun",
      value: {
        kind: "Lambda",
        body: {
          kind: "If",
          alternative: {
            kind: "ConstraintCall",
            member: "multiply",
            arguments: [
              { kind: "Name", text: "n" },
              {
                kind: "Call",
                callee: { kind: "Name", text: "fact" },
              },
            ],
          },
        },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("preserves the explicit host console operation", () => {
    const module = elaborateSource('console.log("answer", 42)');

    expect(module.items[0]).toMatchObject({
      kind: "ExprItem",
      expression: {
        kind: "ConsoleLog",
        arguments: [
          { kind: "String" },
          { kind: "Number", representation: "Int" },
        ],
        type: { kind: "Primitive", name: "Unit" },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("makes concrete numeric operations and evidence explicit", () => {
    const module = elaborateSource("let total = 1 + 2 * 3");

    expect(module.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "ConstraintCall",
        constraint: "Num",
        member: "add",
        evidence: { kind: "Primitive", instance: "Int" },
        arguments: [
          { kind: "Number", decimal: "1", representation: "Int" },
          {
            kind: "ConstraintCall",
            member: "multiply",
            evidence: { kind: "Primitive", instance: "Int" },
            arguments: [
              { kind: "Number", decimal: "2" },
              { kind: "Number", decimal: "3" },
            ],
          },
        ],
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("retains dictionary evidence inside constrained polymorphic functions", () => {
    const module = elaborateSource("let addOne = x => x + 1");
    const item = module.items[0];

    expect(item).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        body: {
          kind: "ConstraintCall",
          constraint: "Num",
          member: "add",
          evidence: { kind: "Dictionary" },
          arguments: [
            { kind: "Name", text: "x" },
            {
              kind: "ConvertInt",
              decimal: "1",
              evidence: { kind: "Dictionary" },
            },
          ],
        },
      },
    });

    if (item?.kind !== "Let" || item.value.kind !== "Lambda") {
      throw new Error("expected a lambda binding");
    }
    const body = item.value.body;
    if (body.kind !== "ConstraintCall") throw new Error("expected Num.add");
    const literal = body.arguments[1];
    if (literal?.kind !== "ConvertInt") throw new Error("expected fromInt");
    expect(body.evidence).toEqual(literal.evidence);
    expect(module.diagnostics).toEqual([]);
  });

  test("turns interpolation into explicit Show evidence", () => {
    const concrete = elaborateSource('let message = "value: ${1}"');
    const generic = elaborateSource('let display = x => "${x}"');

    expect(concrete.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "String",
        parts: [
          { kind: "Text", value: "value: " },
          {
            kind: "Show",
            expression: { kind: "Number", representation: "Int" },
            evidence: { kind: "Primitive", instance: "Int" },
          },
        ],
      },
    });
    expect(generic.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        body: {
          kind: "String",
          parts: [
            {
              kind: "Show",
              evidence: { kind: "Dictionary" },
            },
          ],
        },
      },
    });
  });

  test("lowers derived logic while preserving short-circuit structure", () => {
    const module = elaborateSource(
      "let implication = (a, b) => a implies b\n" +
        "let agreement = (a, b) => a iff b",
    );

    expect(module.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        body: {
          kind: "Logical",
          operation: "Or",
          left: { kind: "LogicalNot", operand: { kind: "Name", text: "a" } },
          right: { kind: "Name", text: "b" },
        },
      },
    });
    expect(module.items[1]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        body: {
          kind: "ComparisonChain",
          steps: [
            {
              test: "Equal",
              evidence: { kind: "Primitive", instance: "Bool" },
            },
          ],
        },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("erases grouping and preserves comparison single-evaluation semantics", () => {
    const module = elaborateSource("let bounded = (1) < 2 <= 3");

    expect(module.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "ComparisonChain",
        operands: [
          { kind: "Number", decimal: "1" },
          { kind: "Number", decimal: "2" },
          { kind: "Number", decimal: "3" },
        ],
        steps: [
          { test: "Less", evidence: { kind: "Primitive", instance: "Int" } },
          { test: "LessEqual", evidence: { kind: "Primitive", instance: "Int" } },
        ],
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("never leaks Typed-only surface nodes from arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const module = elaborateSource(text);
        visitItems(module.items, (expression) => {
          expect([
            "FromInt",
            "Group",
            "Unary",
            "Binary",
            "Comparison",
            "Access",
            "Index",
            "Assignment",
          ]).not.toContain(expression.kind);
        });
      }),
      { numRuns: 250 },
    );
  });
});

function elaborateSource(text: string): Core.Module {
  const source = new Source.File(Source.fileId(0), "test.hex", text);
  return elaborate(check(resolve(parse(applyLayout(lex(source))))));
}

function visitItems(
  items: readonly Core.Item[],
  visit: (expression: Core.Expr) => void,
): void {
  for (const item of items) {
    if (item.kind === "Let") visitExpr(item.value, visit);
    if (item.kind === "ExprItem") visitExpr(item.expression, visit);
  }
}

function visitExpr(expression: Core.Expr, visit: (expression: Core.Expr) => void): void {
  visit(expression);
  switch (expression.kind) {
    case "String":
      for (const part of expression.parts) {
        if (part.kind === "Show") visitExpr(part.expression, visit);
      }
      return;
    case "Block":
      return visitItems(expression.items, visit);
    case "Lambda":
      return visitExpr(expression.body, visit);
    case "If":
      visitExpr(expression.condition, visit);
      visitExpr(expression.consequence, visit);
      if (expression.alternative !== undefined) visitExpr(expression.alternative, visit);
      return;
    case "Call":
      visitExpr(expression.callee, visit);
      for (const argument of expression.arguments) visitExpr(argument, visit);
      return;
    case "ConsoleLog":
      for (const argument of expression.arguments) visitExpr(argument, visit);
      return;
    case "LogicalNot":
      return visitExpr(expression.operand, visit);
    case "Logical":
      visitExpr(expression.left, visit);
      return visitExpr(expression.right, visit);
    case "ConstraintCall":
      for (const argument of expression.arguments) visitExpr(argument, visit);
      return;
    case "ComparisonChain":
      for (const operand of expression.operands) visitExpr(operand, visit);
      return;
    case "WidenInt":
      return visitExpr(expression.value, visit);
    case "Name":
    case "Unit":
    case "Boolean":
    case "Number":
    case "BigInt":
    case "Float":
    case "ConvertInt":
    case "ErrorExpr":
      return;
  }
}
