import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import { displayScheme } from "./display.js";
import { typeVariableId, type Scheme } from "./tree.js";

const source = new Source.File(Source.fileId(0), "test.hex", "");

describe("displayScheme", () => {
  test("uses Hexagon names for primitive and polymorphic function types", () => {
    const variable = typeVariableId(4);
    const identity: Scheme = {
      variables: [variable],
      constraints: [],
      type: {
        kind: "Function",
        parameters: [{ kind: "Variable", id: variable }],
        result: { kind: "Variable", id: variable },
      },
    };

    expect(displayScheme(identity)).toBe("a -> a");
    expect(
      displayScheme({
        variables: [],
        constraints: [],
        type: { kind: "Primitive", name: "String" },
      }),
    ).toBe("String");
  });

  test("shows constraints and parenthesizes function parameters", () => {
    const variable = typeVariableId(9);
    const scheme: Scheme = {
      variables: [variable],
      constraints: [
        {
          name: "Num",
          type: { kind: "Variable", id: variable },
          span: source.span(0, 0),
        },
      ],
      type: {
        kind: "Function",
        parameters: [
          {
            kind: "Function",
            parameters: [{ kind: "Variable", id: variable }],
            result: { kind: "Variable", id: variable },
          },
        ],
        result: { kind: "Variable", id: variable },
      },
    };

    expect(displayScheme(scheme)).toBe("Num a => (a -> a) -> a");
  });

  test("distinguishes zero, one, and many parameters", () => {
    expect(
      displayScheme({
        variables: [],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [],
          result: { kind: "Primitive", name: "Unit" },
        },
      }),
    ).toBe("() -> Unit");

    expect(
      displayScheme({
        variables: [],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [
            { kind: "Primitive", name: "String" },
            { kind: "Primitive", name: "Int" },
          ],
          result: { kind: "Primitive", name: "Bool" },
        },
      }),
    ).toBe("(String, Int) -> Bool");
  });
});
