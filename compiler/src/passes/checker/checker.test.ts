import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as Typed from "../../syntax/typed/index.js";
import { applyLayout } from "../layout/layout.js";
import { lex } from "../lexer/lexer.js";
import { parse } from "../parser/parser.js";
import { resolve } from "../resolver/resolver.js";
import { check } from "./checker.js";

describe("check", () => {
  test("types primitive literals and defaults bare integers to Int", () => {
    const module = checkSource(
      'let count = 1\nlet ratio = 1.5\nlet exact = 1n\nlet flag = true\nlet text = "hello"\nlet unit = ()',
    );

    expect(module.symbols.map(({ name, scheme }) => [name, typeName(scheme.type)])).toEqual([
      ["count", "Int"],
      ["ratio", "Float"],
      ["exact", "BigInt"],
      ["flag", "Bool"],
      ["text", "String"],
      ["unit", "Unit"],
    ]);
    expect(module.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "FromInt",
        type: { kind: "Primitive", name: "Int" },
        requirement: {
          name: "Num",
          type: { kind: "Primitive", name: "Int" },
        },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("generalizes let-bound identity and instantiates each use", () => {
    const module = checkSource(
      'let identity = x => x\nlet one = identity(1)\nlet text = identity("a")',
    );
    const identity = letSymbol(module, "identity");

    expect(identity?.scheme.variables).toHaveLength(1);
    expect(identity?.scheme.constraints).toEqual([]);
    expect(identity?.scheme.type).toMatchObject({
      kind: "Function",
      parameters: [{ kind: "Variable" }],
      result: { kind: "Variable" },
    });
    expect(typeName(letSymbol(module, "one").scheme.type)).toBe("Int");
    expect(typeName(letSymbol(module, "text").scheme.type)).toBe("String");
    expect(module.diagnostics).toEqual([]);
  });

  test("checks direct recursion monomorphically and generalizes afterward", () => {
    const module = checkSource(
      "fun choose(value) = if true then value else choose(value)\n" +
        "let number = choose(1)\n" +
        'let text = choose("a")',
    );
    const choose = module.symbols.find(
      ({ kind, name }) => kind === "fun" && name === "choose",
    );

    expect(choose?.scheme).toMatchObject({
      variables: [expect.any(Number)],
      constraints: [],
      type: {
        kind: "Function",
        parameters: [{ kind: "Variable" }],
        result: { kind: "Variable" },
      },
    });
    expect(typeName(letSymbol(module, "number").scheme.type)).toBe("Int");
    expect(typeName(letSymbol(module, "text").scheme.type)).toBe("String");
    expect(module.diagnostics).toEqual([]);
  });

  test("checks annotated numeric recursion", () => {
    const module = checkSource(
      "fun fact(n: Int): Int = if n <= 1 then 1 else n * fact(n - 1)",
    );
    const fact = module.symbols.find(
      ({ kind, name }) => kind === "fun" && name === "fact",
    );

    expect(fact?.scheme).toMatchObject({
      variables: [],
      constraints: [],
      type: {
        kind: "Function",
        parameters: [{ kind: "Primitive", name: "Int" }],
        result: { kind: "Primitive", name: "Int" },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("checks complete and partial primitive annotations", () => {
    const module = checkSource(
      "let complete(x: Int, y: Int): Int = x + y\n" +
        "let partial(x: Int, y) = x + y\n" +
        "let negate = (value: Float): Float => -value",
    );

    for (const name of ["complete", "partial"]) {
      expect(letSymbol(module, name).scheme).toMatchObject({
        variables: [],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [
            { kind: "Primitive", name: "Int" },
            { kind: "Primitive", name: "Int" },
          ],
          result: { kind: "Primitive", name: "Int" },
        },
      });
    }
    expect(letSymbol(module, "negate").scheme.type).toMatchObject({
      kind: "Function",
      parameters: [{ kind: "Primitive", name: "Float" }],
      result: { kind: "Primitive", name: "Float" },
    });
    const complete = module.items[0];
    expect(complete).toMatchObject({ kind: "Let", value: { kind: "Lambda" } });
    if (complete?.kind !== "Let" || complete.value.kind !== "Lambda") {
      throw new Error("expected the complete binding to contain a lambda");
    }
    expect(complete.value).not.toHaveProperty("returnAnnotation");
    for (const parameter of complete.value.parameters) {
      expect(parameter).not.toHaveProperty("annotation");
    }
    expect(module.diagnostics).toEqual([]);
  });

  test("reports parameter and return annotation mismatches", () => {
    const module = checkSource(
      "let takesString(value: String) = value\n" +
        "let wrongParameter(x: Int) = takesString(x)\n" +
        "let wrongResult(x: Int): String = x + 1",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "type mismatch: expected String, found Int",
      "type mismatch: expected String, found Int",
    ]);
  });

  test("retains polymorphic constraints when they govern an input", () => {
    const module = checkSource(
      'let addOne = x => x + 1\nlet display = x => "${x}"',
    );

    expect(letSymbol(module, "addOne").scheme).toMatchObject({
      variables: [expect.any(Number)],
      constraints: [{ name: "Num", type: { kind: "Variable" } }],
      type: {
        kind: "Function",
        parameters: [{ kind: "Variable" }],
        result: { kind: "Variable" },
      },
    });
    expect(letSymbol(module, "display").scheme).toMatchObject({
      variables: [expect.any(Number)],
      constraints: [{ name: "Show", type: { kind: "Variable" } }],
      type: {
        kind: "Function",
        parameters: [{ kind: "Variable" }],
        result: { kind: "Primitive", name: "String" },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("enforces n-ary calls, Bool conditions, and matching branches", () => {
    const good = checkSource(
      "let choose = (condition, yes, no) => if condition then yes else no\n" +
        "choose(true, 1, 2)",
    );
    const bad = checkSource(
      'let pair = (x, y) => x\npair(1)\nif "yes" then 1 else true',
    );

    expect(typeName(expression(good).type)).toBe("Int");
    expect(good.diagnostics).toEqual([]);
    expect(bad.diagnostics.map(({ message }) => message)).toEqual([
      "function expects 2 arguments, got 1",
      "type mismatch: expected String, found Bool",
      "integer literal cannot have type `Bool`",
    ]);
  });

  test("rewrites pipes to first-argument calls before inference", () => {
    const module = checkSource(
      "let add(x: Int, y: Int) = x + y\n" +
        "let identity = x => x\n" +
        "let bare = 1 |> identity\n" +
        "let inserted = 1 |> add(2)\n" +
        "let chained = 1 |> add(2) |> add(3)",
    );

    for (const name of ["bare", "inserted", "chained"]) {
      expect(typeName(letSymbol(module, name).scheme.type)).toBe("Int");
    }
    expect(module.items[2]).toMatchObject({
      kind: "Let",
      value: { kind: "Call", arguments: [{ kind: "FromInt" }] },
    });
    expect(module.items[3]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Call",
        arguments: [{ kind: "FromInt" }, { kind: "FromInt" }],
      },
    });
    expect(module.items[4]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Call",
        arguments: [{ kind: "Call" }, { kind: "FromInt" }],
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("reports discarded values and block-final bindings with source vocabulary", () => {
    const module = checkSource(
      "let discarded = () =>\n  1\n  2\n" +
        "let unfinished = () =>\n  let answer = 42",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "this expression's value is discarded — its type is Int; wrap it in `ignore(...)` if discarding is intentional",
      "a block cannot end with a `let`; did you mean to return `answer`?",
    ]);
  });

  test("checks primitive constraint instances", () => {
    const module = checkSource(
      'let divided = 4.0 / 2.0\nlet joined = "a" ++ "b"\nlet impossible = "a" - "b"',
    );

    expect(typeName(letSymbol(module, "divided").scheme.type)).toBe("Float");
    expect(typeName(letSymbol(module, "joined").scheme.type)).toBe("String");
    expect(module.diagnostics.map(({ message }) => message)).toContain(
      "type `String` has no `Num` instance",
    );
  });

  test("recovers from arbitrary resolved trees without unbounded public spans", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const module = checkSource(text);

        for (const diagnostic of module.diagnostics) {
          expect(diagnostic.primary.start.offset).toBeGreaterThanOrEqual(0);
          expect(diagnostic.primary.end.offset).toBeLessThanOrEqual(text.length);
        }
        for (const symbol of module.symbols) visitType(symbol.scheme.type);
      }),
      { numRuns: 250 },
    );
  });
});

function checkSource(text: string): Typed.Module {
  const source = new Source.File(Source.fileId(0), "test.hex", text);
  return check(resolve(parse(applyLayout(lex(source)))));
}

function expression(module: Typed.Module): Typed.Expr {
  const item = module.items.at(-1);
  if (item?.kind !== "ExprItem") throw new Error("expected an expression item");
  return item.expression;
}

function typeName(type: Typed.Type): string {
  return type.kind === "Primitive" ? type.name : type.kind;
}

function letSymbol(module: Typed.Module, name: string): Typed.Symbol {
  const symbol = module.symbols.find(
    (candidate) => candidate.kind === "let" && candidate.name === name,
  );
  if (symbol === undefined) throw new Error(`expected let symbol ${name}`);
  return symbol;
}

function visitType(type: Typed.Type): void {
  if (type.kind === "Variable") expect(Number(type.id)).toBeGreaterThanOrEqual(0);
  if (type.kind === "Function") {
    for (const parameter of type.parameters) visitType(parameter);
    visitType(type.result);
  }
}
