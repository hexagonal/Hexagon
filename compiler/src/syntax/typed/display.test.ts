import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import { displayScheme } from "./display.js";
import { type Effect, typeVariableId, type Scheme, type Type } from "./tree.js";
import { unionId } from "../resolved/tree.js";

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
          name: "Signed",
          identity: "hex:Signed",
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

    expect(displayScheme(scheme)).toBe("Signed a => (a -> a) -> a");
  });

  test("distinguishes zero, one, and many parameters", () => {
    // `Unit` is the arity-0 tuple (#159), and it displays as its one name.
    expect(
      displayScheme({
        variables: [],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [],
          result: { kind: "Tuple", elements: [] },
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
          result: { kind: "Union", union: unionId(0), name: "Bool", arguments: [] },
        },
      }),
    ).toBe("(String, Int) -> Bool");
  });

  test("renders tuple types distinctly from function parameter lists", () => {
    expect(
      displayScheme({
        variables: [],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [
            {
              kind: "Tuple",
              elements: [
                { kind: "Primitive", name: "String" },
                { kind: "Primitive", name: "Int" },
              ],
            },
          ],
          result: { kind: "Union", union: unionId(0), name: "Bool", arguments: [] },
        },
      }),
    ).toBe("((String, Int)) -> Bool");
  });

  test("a sole `Unit` parameter displays bare, keeping `Unit -> T` distinct from `() -> T`", () => {
    expect(
      displayScheme({
        variables: [],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [{ kind: "Tuple", elements: [] }],
          result: { kind: "Union", union: unionId(0), name: "Bool", arguments: [] },
        },
      }),
    ).toBe("Unit -> Bool");
  });

  test("renders nominal union names", () => {
    expect(
      displayScheme({
        variables: [],
        constraints: [],
        type: { kind: "Union", union: unionId(0), name: "Suit", arguments: [] },
      }),
    ).toBe("Suit");
  });
});

/**
 * The arrow trio and its numbering (`spec/effects.md` §2, §10; #364). Written
 * over constructed schemes because the question is about the *renderer* — which
 * arrow for which colour, and in which order the numbers are handed out — and a
 * source fixture can only reach the colours inference happens to build.
 */
describe("displayScheme: the arrow trio", () => {
  const colour = (id: number) => ({ variable: typeVariableId(id) }) as const;
  const string = { kind: "Primitive", name: "String" } as const;
  /** `String <arrow> String`, for whatever colour is handed in. */
  const step = (effect?: Effect): Type => ({
    kind: "Function",
    parameters: [string],
    result: string,
    ...(effect === undefined ? {} : { effect }),
  });

  test("an absent slot is the pure arrow, which is every arrow with the flag off", () => {
    expect(displayScheme({ variables: [], constraints: [], type: step() }))
      .toBe("String -> String");
  });

  test("the impure constant is spelled, and is never numbered", () => {
    expect(
      displayScheme({
        variables: [],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [step("impure")],
          result: string,
          effect: "impure",
        },
      }),
    ).toBe("(String =>! String) =>! String");
  });

  test("one variable with an inlet displays plain, so the face writes back", () => {
    // The annotation grammar links every written `=>` in a signature into one
    // variable (§2.2), and the parameter's arrow is the slot that makes the
    // linked reading — rather than the else-constant one — the right one. So
    // this text is exactly what this type means.
    expect(
      displayScheme({
        variables: [typeVariableId(1)],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [step(colour(1))],
          result: string,
          effect: colour(1),
        },
      }),
    ).toBe("(String => String) => String");
  });

  test("one variable with no inlet is numbered even though it is alone", () => {
    // Every parameter arrow here is the pure constant, so the sole `=>` has no
    // slot for a caller's instantiation and §2.2's else-constant rule would
    // read the written form as the impure constant. Undecorated, this face
    // would advertise a write-back that means something else.
    expect(
      displayScheme({
        variables: [typeVariableId(1)],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [{ kind: "Function", parameters: [], result: string }],
          result: { kind: "Primitive", name: "Int" },
          effect: colour(1),
        },
      }),
    ).toBe("(() -> String) =>¹ Int");
  });

  test("an inlet is a parameter position at any depth", () => {
    // The slot does not have to be a top-level parameter's own arrow: a
    // callback nested inside a parameter is one a caller's instantiation
    // reaches just the same.
    expect(
      displayScheme({
        variables: [typeVariableId(1)],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [{
            kind: "Function",
            parameters: [step(colour(1))],
            result: string,
          }],
          result: string,
        },
      }),
    ).toBe("((String => String) -> String) -> String");
  });

  test("two distinct variables are numbered by first appearance, left to right", () => {
    // The domain is printed before the arrow, so the parameter's colour is the
    // first one the text reaches whichever order the tree holds them in.
    expect(
      displayScheme({
        variables: [typeVariableId(2), typeVariableId(1)],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [step(colour(1))],
          result: step(colour(2)),
          effect: colour(2),
        },
      }),
    ).toBe("(String =>¹ String) =>² String =>² String");
  });

  test("a constant beside two variables stays unnumbered", () => {
    expect(
      displayScheme({
        variables: [],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [step(colour(1)), step("impure"), step(colour(2))],
          result: string,
        },
      }),
    ).toBe("(String =>¹ String, String =>! String, String =>² String) -> String");
  });

  test("numbers past nine keep going, a digit at a time", () => {
    const parameters = Array.from({ length: 11 }, (_, index) => step(colour(index + 1)));
    expect(
      displayScheme({ variables: [], constraints: [], type: {
        kind: "Function",
        parameters,
        result: string,
      } }),
    ).toContain("String =>¹⁰ String, String =>¹¹ String) -> String");
  });

  test("a colour takes no letter from the type variables it sits beside", () => {
    // Effect variables generalize with the binding (§3.4) and so arrive in the
    // quantifier list; naming them would spend `a` on something that displays
    // as an arrow.
    expect(
      displayScheme({
        variables: [typeVariableId(7), typeVariableId(8)],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [
            { kind: "Function", parameters: [], result: string, effect: colour(7) },
            { kind: "Variable", id: typeVariableId(8) },
          ],
          result: { kind: "Variable", id: typeVariableId(8) },
        },
      }),
    ).toBe("(() => String, a) -> a");
  });
});
