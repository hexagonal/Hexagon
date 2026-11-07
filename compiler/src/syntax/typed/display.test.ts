import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import { displayScheme } from "./display.js";
import { type Effect, typeVariableId, type Scheme, type Type } from "./tree.js";
import { unionId } from "../resolved/tree.js";

const source = new Source.File(Source.fileId(0), "test.hex", "module Test\n\n" + "");

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

  /**
   * An open record's tail, with and without a letter (#959, under #649's rule
   * that no user-facing rendering shows a numbered inference variable).
   *
   * A tail takes a letter exactly when the scheme quantifies it. An
   * unquantified tail renders as the bare `...`, which says exactly what is
   * known: there may be more fields, and nothing names how many. A letter
   * would claim a quantifier that is not there.
   *
   * That holds wherever the row stands. It used to hold only inside a container
   * (`Vector`, `Set`, `Map`, …), and by accident: the display's walk for
   * letters skipped the containers, and took every tail it did reach, so an
   * unquantified tail outside one took a letter and inside one fell to the
   * bare form (#995, symptom 3). The walk now reaches every kind, and leaves a
   * tail to the scheme.
   */
  test("renders an unquantified row tail as the bare `...`, never a number", () => {
    const tail = typeVariableId(487);
    const record = {
      kind: "Record",
      fields: [{ name: "n", type: { kind: "Primitive", name: "Int" } }],
      tail,
    } as const;
    const row = (quantified: boolean): string =>
      displayScheme({
        variables: quantified ? [tail] : [],
        constraints: [],
        type: {
          kind: "Vector",
          element: {
            kind: "Function",
            parameters: [record],
            result: { kind: "Tuple", elements: [] },
          },
        },
      });

    expect(row(false)).toBe("Vector({n: Int, ...} -> Unit)");
    expect(row(false)).not.toMatch(/t\d/);
    // A quantified tail is a variable the signature *does* name, and it keeps
    // its letter wherever it stands.
    expect(row(true)).toBe("Vector({n: Int, ...a} -> Unit)");
    // And outside a container, the same: unquantified, so bare.
    expect(displayScheme({ variables: [], constraints: [], type: record }))
      .toBe("{n: Int, ...}");
  });

  test("letters a variable inside every container kind, never a number (#995)", () => {
    const first = { kind: "Variable", id: typeVariableId(522) } as const;
    const second = { kind: "Variable", id: typeVariableId(523) } as const;
    const shown = (type: Type): string => displayScheme({ variables: [], constraints: [], type });
    expect(shown({ kind: "Vector", element: first })).toBe("Vector(a)");
    expect(shown({ kind: "Set", element: first })).toBe("Set(a)");
    expect(shown({ kind: "Array", element: first })).toBe("Array(a)");
    expect(shown({ kind: "JsSet", element: first })).toBe("JsSet(a)");
    expect(shown({ kind: "Node", element: first })).toBe("Node(a)");
    expect(shown({ kind: "Nullable", value: first })).toBe("Nullable(a)");
    expect(shown({ kind: "Map", key: first, value: second })).toBe("Map(a, b)");
    expect(shown({ kind: "JsMap", key: first, value: second })).toBe("JsMap(a, b)");
    // One variable, one letter, wherever it stands.
    expect(shown({ kind: "Tuple", elements: [{ kind: "Vector", element: second }, first, second] }))
      .toBe("(Vector(a), b, a)");
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
    // and every arrow a displayed type can carry is now `->`, `>->`, or `->!`.
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
    ...(effect === undefined ? {} : { effect, fail: effect }),
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
          effect: "impure", fail: "impure",
        },
      }),
    ).toBe("(String ->! String) ->! String");
  });

  test("one variable with an inlet displays plain, so the face writes back", () => {
    // The annotation grammar links every written `>->` in a signature into one
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
          effect: colour(1), fail: colour(1),
        },
      }),
    ).toBe("(String ->! String) >-> String");
  });

  test("one variable with no inlet still displays plain — #405 dropped that case", () => {
    // Every parameter arrow here is the pure constant, so the sole `>->` has no
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
          effect: colour(1), fail: colour(1),
        },
      }),
    ).toBe("(() -> String) >-> Int");
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
    ).toBe("((String ->! String) -> String) -> String");
  });

  test("two distinct colours are not numbered: a callback's shows `->!`, a dependent one `>->`", () => {
    // Effects §10: a finished face depends on all of its callbacks or none, so
    // nothing is numbered.
    expect(
      displayScheme({
        variables: [typeVariableId(2), typeVariableId(1)],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [step(colour(1))],
          result: step(colour(2)),
          effect: colour(2), fail: colour(2),
        },
      }),
    ).toBe("(String ->! String) >-> String >-> String");
  });

  test("a constant beside two callbacks' colours reads the same", () => {
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
    ).toBe("(String ->! String, String ->! String, String ->! String) -> String");
  });

  test("many callbacks' colours are none of them numbered", () => {
    const parameters = Array.from({ length: 11 }, (_, index) => step(colour(index + 1)));
    expect(
      displayScheme({ variables: [], constraints: [], type: {
        kind: "Function",
        parameters,
        result: string,
      } }),
    ).toContain("String ->! String, String ->! String) -> String");
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
            { kind: "Function", parameters: [], result: string, effect: colour(7), fail: colour(7) },
            { kind: "Variable", id: typeVariableId(8) },
          ],
          result: { kind: "Variable", id: typeVariableId(8) },
        },
      }),
    ).toBe("(() ->! String, a) -> a");
  });

  test("each colour shows its own mark: `->^` may fail, `->~` is impure (Effects §10)", () => {
    const arrow = (effect: Effect | undefined, fail: Effect | undefined): Type => ({
      kind: "Function",
      parameters: [string],
      result: string,
      ...(effect === undefined ? {} : { effect }),
      ...(fail === undefined ? {} : { fail }),
    });
    const show = (type: Type) => displayScheme({ variables: [], constraints: [], type });
    expect(show(arrow(undefined, "impure"))).toBe("String ->^ String");
    expect(show(arrow("impure", undefined))).toBe("String ->~ String");
    // An error shows its constant on its own colour (§3.5).
    expect(show(arrow("error", undefined))).toBe("String ->~ String");
    // A callback's colours show on its own arrows, as the marks of the colours it has,
    // and the face names only the colour that passes through (§2.2).
    expect(show({ kind: "Function", parameters: [arrow(undefined, colour(3))], result: string, fail: colour(3) }))
      .toBe("(String ->^ String) >^> String");
    // A colour that follows beside a constant is named in its own state (§2.2).
    expect(show({ kind: "Function", parameters: [arrow(colour(4), colour(5))], result: string, effect: "impure", fail: colour(5) }))
      .toBe("(String ->! String) >^>~ String");
    expect(show({ kind: "Function", parameters: [arrow(colour(4), colour(5))], result: string, effect: colour(4), fail: "impure" }))
      .toBe("(String ->! String) >~>^ String");
    expect(show({ kind: "Function", parameters: [arrow(colour(4), colour(5))], result: string, effect: colour(4) }))
      .toBe("(String ->! String) >~> String");
  });
});
