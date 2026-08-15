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

    expect(displayScheme(scheme)).toBe("<a: Signed> (a -> a) -> a");
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
 * The constraint bracket (`spec/functions.md` §5.1, §4.2; #410). Written over
 * constructed schemes because the questions are the *renderer's* — grouping,
 * entry order, conjunct order — and inference reaches only the combinations it
 * happens to build.
 */
describe("displayScheme: the constraint bracket", () => {
  const constraint = (name: string, id: number) => ({
    name,
    identity: `hex:${name}`,
    type: { kind: "Variable", id: typeVariableId(id) },
    span: source.span(0, 0),
  }) as const;
  const variable = (id: number) => ({ kind: "Variable", id: typeVariableId(id) }) as const;
  const string = { kind: "Primitive", name: "String" } as const;

  test("a constrained value gets the bracket, and a space, with no arrow in sight", () => {
    // The bracket is a quantifier prefix on a *complete type*, so it needs no
    // function to attach to — and one space is what sets it off (§5.1).
    expect(
      displayScheme({
        variables: [typeVariableId(1)],
        constraints: [constraint("Show", 1)],
        type: variable(1),
      }),
    ).toBe("<a: Show> a");
  });

  test("a constraint-free scheme shows no bracket at all", () => {
    expect(
      displayScheme({
        variables: [typeVariableId(1)],
        constraints: [],
        type: { kind: "Function", parameters: [variable(1)], result: variable(1) },
      }),
    ).toBe("a -> a");
  });

  test("two constraints on one variable become §4.2's parenthesized conjunction", () => {
    // The singleton above is bare; two or more are parenthesized. Both are
    // verbatim source spellings of the binder.
    expect(
      displayScheme({
        variables: [typeVariableId(1)],
        constraints: [constraint("Num", 1), constraint("Show", 1)],
        type: { kind: "Function", parameters: [variable(1)], result: variable(1) },
      }),
    ).toBe("<a: (Num, Show)> a -> a");
  });

  test("conjuncts sort by constraint name, not by the order they accumulated", () => {
    // Within one variable the displayed conjunction matches the evidence
    // suffix, whose second key is the constraint name — independently of how
    // the constraints were written or accumulated (FFI Part 9 §6.2,
    // Constraints §6.1). Written order surviving here is exactly what this
    // rules out. The correspondence is within a variable only; across
    // variables the display follows the type and the suffix follows the
    // declared head (Functions §5.1).
    expect(
      displayScheme({
        variables: [typeVariableId(1)],
        constraints: [constraint("Show", 1), constraint("Num", 1)],
        type: { kind: "Function", parameters: [variable(1)], result: variable(1) },
      }),
    ).toBe("<a: (Num, Show)> a -> a");
  });

  test("each variable gets its own entry, in the display's letter order", () => {
    expect(
      displayScheme({
        variables: [typeVariableId(1), typeVariableId(2)],
        constraints: [constraint("Show", 1), constraint("Show", 2)],
        type: {
          kind: "Function",
          parameters: [variable(1), variable(2)],
          result: string,
        },
      }),
    ).toBe("<a: Show, b: Show> (a, b) -> String");
  });

  test("entries follow the letters, not the constraint list's order", () => {
    // `b`'s constraint is written first; `a`'s entry still comes first, because
    // the bracket's order is the quantifier's (and the ABI's), not the list's.
    expect(
      displayScheme({
        variables: [typeVariableId(1), typeVariableId(2)],
        constraints: [constraint("Eq", 2), constraint("Show", 1)],
        type: {
          kind: "Function",
          parameters: [variable(1), variable(2)],
          result: string,
        },
      }),
    ).toBe("<a: Show, b: Eq> (a, b) -> String");
  });

  test("an unconstrained variable is unmentioned — bare `<a>` is never canonical", () => {
    expect(
      displayScheme({
        variables: [typeVariableId(1), typeVariableId(2)],
        constraints: [constraint("Show", 2)],
        type: {
          kind: "Function",
          parameters: [variable(1), variable(2)],
          result: string,
        },
      }),
    ).toBe("<b: Show> (a, b) -> String");
  });

  test("`=>` appears nowhere in a displayed scheme, however constrained", () => {
    // #410's whole point: the separator was the last non-term reading of `=>`,
    // and every arrow a displayed type can carry is now `->`, `->?`, or `->!`.
    const displayed = displayScheme({
      variables: [typeVariableId(1), typeVariableId(2)],
      constraints: [constraint("Num", 1), constraint("Show", 1), constraint("Eq", 2)],
      type: {
        kind: "Function",
        parameters: [variable(1), variable(2)],
        result: string,
      },
    });

    expect(displayed).toBe("<a: (Num, Show), b: Eq> (a, b) -> String");
    expect(displayed).not.toContain("=>");
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
    ).toBe("(String ->! String) ->! String");
  });

  test("one variable with an inlet displays plain, so the face writes back", () => {
    // The annotation grammar links every written `->?` in a signature into one
    // variable (§2.2), so this text is exactly what this type means — and the
    // parameter's arrow is the inlet that makes it legal to write (§2.2.1).
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
    ).toBe("(String ->? String) ->? String");
  });

  test("one variable with no inlet still displays plain — #405 dropped that case", () => {
    // Every parameter arrow here is the pure constant, so the sole `->?` has no
    // slot for a caller's instantiation. The predecessor numbered it, because
    // the else-constant rule read an inlet-less written arrow back as the
    // impure constant and the plain spelling would have meant something else.
    // With that rule withdrawn (§2.2.1) the plain spelling is exactly right
    // about the colour — one variable — and pasting it into a position that
    // cannot host it is Effects §4.4's error, which says why in a sentence.
    // Numbering marks what the grammar cannot express, not what the checker
    // will refuse (§10).
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
    ).toBe("(() -> String) ->? Int");
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
    ).toBe("((String ->? String) -> String) -> String");
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
    ).toBe("(String ->?¹ String) ->?² String ->?² String");
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
    ).toBe("(String ->?¹ String, String ->! String, String ->?² String) -> String");
  });

  test("numbers past nine keep going, a digit at a time", () => {
    const parameters = Array.from({ length: 11 }, (_, index) => step(colour(index + 1)));
    expect(
      displayScheme({ variables: [], constraints: [], type: {
        kind: "Function",
        parameters,
        result: string,
      } }),
    ).toContain("String ->?¹⁰ String, String ->?¹¹ String) -> String");
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
    ).toBe("(() ->? String, a) -> a");
  });
});
