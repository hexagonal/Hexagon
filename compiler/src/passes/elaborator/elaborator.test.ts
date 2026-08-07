import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as Core from "../../syntax/core/index.js";
import type * as Typed from "../../syntax/typed/index.js";
import { compileProject } from "../../project.js";

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
        type: { kind: "Tuple", elements: [] },
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
              kind: "ConvertNat",
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
    if (literal?.kind !== "ConvertNat") throw new Error("expected fromNat");
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
            // `Show<Int>` is `stdlib/Int.hex`'s source instance since #344, so
            // the evidence is that instance's dictionary, tagged with the
            // primitive it is honored at so emission can still inline the slot.
            evidence: { kind: "Instance", primitive: "Int" },
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
    // Annotated: `iff` lowers to `Eq<Bool>`, and since #147 that instance is the
    // prelude declaration's derived one, reached through `Bool.hex`'s import.
    // The annotation is also what a real program would carry here.
    const module = elaborateSource(
      "let implication(a: Bool, b: Bool): Bool = a implies b\n" +
        "let agreement(a: Bool, b: Bool): Bool = a iff b",
    );

    // By name, not by index: naming `Bool` in the annotations means the module
    // carries a synthesized prelude import ahead of its own items.
    const item = (name: string): Core.Item | undefined =>
      module.items.find((candidate) =>
        candidate.kind === "Let" && candidate.binding.name === name
      );

    expect(item("implication")).toMatchObject({
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
    expect(item("agreement")).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        body: {
          kind: "ComparisonChain",
          steps: [
            {
              test: "Equal",
              // Structural, not a dictionary: the pinned `Bool` satisfies its
              // four derivable constraints inline (#147).
              evidence: { kind: "Structural" },
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
        // `Ord<Int>` is `stdlib/Int.hex`'s source instance since #344 (see the
        // interpolation case above); the comparison still inlines to `<`/`<=`.
        //
        // The two steps carry *different* evidence shapes, and that is the
        // truth rather than an accident worth hiding: one chain over one
        // literal-only variable raises two identical `Ord` requirements, and
        // `#attachRequirement` keeps the first and drops the second as already
        // provided — so only the first is discharged against the instance
        // table, and the second falls to the elaborator's by-type fallback.
        // Both name the same instance and both emit the same operator; the
        // difference became visible only when the wired `Int` row retired and
        // the fallback stopped being the *same* object as the resolution.
        steps: [
          { test: "Less", evidence: { kind: "Instance", primitive: "Int" } },
          { test: "LessEqual", evidence: { kind: "Primitive", instance: "Int" } },
        ],
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  /**
   * `architecture/testing.md` §3.4: a failing seed becomes an ordinary
   * regression example when that makes the defect clearer. It does here.
   *
   * The property below forbade `Index` for as long as it existed, so both of
   * these failed it on a tree the elaborator got right — indexing is a *Core*
   * node, not a surface form to lower. `[][` is #198's own counterexample,
   * recovered by sweeping seeds after the original failure was lost; `""[0]` is
   * the smallest case that fails with no diagnostics at all.
   *
   * These examples, not the property, are what now hold the defect down. A
   * `fc.string()` sample of 250 produces no `Index` node at all, so the property
   * would not catch a re-introduction on its own.
   */
  test("keeps indexing as a Core node, resolved to the receiver's operation", () => {
    expect(elaborateSource('""[0]')).toMatchObject({
      items: [{ kind: "ExprItem", expression: { kind: "Index", operation: "StringElement" } }],
      diagnostics: [],
    });

    // Recovery keeps the node too, with the unparsed subscript as `ErrorExpr`.
    expect(elaborateSource("[][")).toMatchObject({
      items: [
        {
          kind: "ExprItem",
          expression: {
            kind: "Index",
            operation: "VectorElement",
            index: { kind: "ErrorExpr" },
          },
        },
      ],
    });
  });

  // 250 full compiles, the same shape as the checker's and the emitter's: since
  // #147 put `Bool` in the prelude, every run loads the project rather than calling
  // the passes directly. This one passed the run that took the Pages deploy down
  // (#160, #163), but at 3550ms against the default 5s budget — thin enough that
  // fixing only the two that failed would have left this as the next to break.
  // Explicit per test rather than a global testTimeout, so the other 680 keep the
  // tight default.
  test("never leaks Typed-only surface nodes from arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const module = elaborateSource(text);
        visitItems(module.items, (expression) => {
          expect(TYPED_ONLY_KINDS).not.toContain(expression.kind);
        });
      }),
      { numRuns: 250 },
    );
  }, 30_000);
});

/**
 * Exactly the `Typed.Expr` kinds with no `Core.Expr` counterpart — the three the
 * elaborator is obliged to lower: `FromNat` to a `Number`/`ConvertNat`, `Group`
 * to nothing, `Access` to `TupleAccess`/`FieldAccess`.
 *
 * Derived rather than written out, because the written-out version drifted
 * (#198). It had listed `Index` and `Assignment`, which Core has too, so any
 * input that reached an indexing expression failed the property on a tree the
 * elaborator got right — `""[0]` does it with no diagnostics at all. A random
 * `fc.string()` reaches one seldom enough that it read as flakiness rather than
 * as a defect. The list also held `Unary`, `Binary`, and `Comparison`, which no
 * *Typed* tree can hold at all; TypeScript rules those out at the type level,
 * so asserting them at run time bought nothing. `Exclude` now fails the type
 * check the moment either mistake is made again.
 *
 * The three that remain are still worth checking at run time even though
 * `elaborateExpr` returns `Core.Expr`: it reaches its result through `as` casts
 * and spreads of the Typed node it came from, and neither carries the kind
 * across for TypeScript to object to.
 */
type TypedOnlyKind = Exclude<Typed.Expr["kind"], Core.Expr["kind"]>;

// Sound: `satisfies` rejects a kind Core also has, which is what #198 was.
const TYPED_ONLY_KINDS = ["FromNat", "Group", "Ascription", "Access"] as const satisfies readonly TypedOnlyKind[];

// Complete: a fourth Typed-only kind has to be listed above rather than go
// silently unchecked, so this resolves to `never` and fails to accept `true`.
type Unlisted = Exclude<TypedOnlyKind, (typeof TYPED_ONLY_KINDS)[number]>;
const everyTypedOnlyKindIsListed: [Unlisted] extends [never] ? true : never = true;
void everyTypedOnlyKindIsListed;

// Through the whole project, prelude included. Since #147 `Bool` is a prelude
// declaration, so a module assembled by calling the passes directly cannot type
// a condition, a guard, a comparison, or a logic operator.
function elaborateSource(text: string): Core.Module {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", text)]);
  return project.modules.find((module) => module.source.path === "/main.hex")!.core;
}

/**
 * Every expression in the module. The walker this replaced recursed into eleven
 * of Core's thirty-five expression kinds and two of its fifteen item kinds, so
 * an item as ordinary as `fun f() = ...` (a `Fun`, not a `Let`) was never
 * entered, and anything under a `Match`, `Vector`, `Record`, or `Try` was
 * invisible. A leak the property exists to catch could have sat in any of them
 * (#198).
 *
 * The `never` arms below buy less than they look like they buy: they prove
 * every *kind* has an arm, not that each arm descends into every field it
 * holds. Emptying `case "Match":` to a bare `return` still type-checks. Whether
 * an arm is complete is checked by hand, and every one of them was.
 */
function visitItems(
  items: readonly Core.Item[],
  visit: (expression: Core.Expr) => void,
): void {
  for (const item of items) {
    switch (item.kind) {
      case "Let":
      case "Var":
      case "LetPattern":
      case "Fun":
        visitExpr(item.value, visit);
        break;
      case "Honor":
        for (const member of item.members) visitExpr(member.value, visit);
        break;
      case "ExprItem":
        visitExpr(item.expression, visit);
        break;
      // No `Core.Expr` to reach. `ConstraintDeclaration` is the one that needs
      // saying: it is `Typed.ConstraintItem` verbatim, so a member's
      // `defaultValue` body stays a *Typed* lambda here by declaration, not by
      // an elaborator slip. What Core emits from a default is the copy the
      // checker materializes into each honor that omits the member, and those
      // are reached above as `Honor` members.
      case "Import":
      case "ExternBlock":
      case "ExternImport":
      case "TypeAlias":
      case "RecordDeclaration":
      case "Exception":
      case "ConstraintDeclaration":
      case "Union":
      case "ErrorItem":
        break;
      default: {
        const unreachable: never = item;
        throw new Error(`unvisited Core item ${JSON.stringify(unreachable)}`);
      }
    }
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
    case "Vector":
    case "Tuple":
      for (const element of expression.elements) visitExpr(element, visit);
      return;
    case "Record":
      if (expression.spread !== undefined) visitExpr(expression.spread, visit);
      for (const field of expression.fields) visitExpr(field.value, visit);
      return;
    case "TupleAccess":
    case "FieldAccess":
      return visitExpr(expression.receiver, visit);
    case "Index":
      visitExpr(expression.receiver, visit);
      return visitExpr(expression.index, visit);
    case "Hash":
      return visitExpr(expression.value, visit);
    case "Block":
      return visitItems(expression.items, visit);
    case "Lambda":
      return visitExpr(expression.body, visit);
    case "If":
      visitExpr(expression.condition, visit);
      visitExpr(expression.consequence, visit);
      visitExpr(expression.alternative, visit);
      return;
    case "While":
      visitExpr(expression.condition, visit);
      return visitExpr(expression.body, visit);
    case "For":
      visitExpr(expression.iterable, visit);
      return visitExpr(expression.body, visit);
    case "Match":
      visitExpr(expression.scrutinee, visit);
      return visitArms(expression.arms, visit);
    case "Try":
      visitExpr(expression.body, visit);
      return visitArms(expression.arms, visit);
    case "Throw":
      return visitExpr(expression.exception, visit);
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
    case "Range":
      visitExpr(expression.start, visit);
      return visitExpr(expression.end, visit);
    case "Assignment":
      visitExpr(expression.target, visit);
      return visitExpr(expression.value, visit);
    case "WidenNat":
    case "WidenInt":
      return visitExpr(expression.value, visit);
    // Leaves: no subexpression to reach.
    case "Name":
    case "Unit":
    case "Number":
    case "BigInt":
    case "Float":
    case "CollectionOperation":
    case "ConvertNat":
    case "ErrorExpr":
      return;
    default: {
      const unreachable: never = expression;
      throw new Error(`unvisited Core expression ${JSON.stringify(unreachable)}`);
    }
  }
}

/** A guard is an expression; the pattern beside it is not, and holds none. */
function visitArms(arms: readonly Core.MatchArm[], visit: (expression: Core.Expr) => void): void {
  for (const arm of arms) {
    if (arm.guard !== undefined) visitExpr(arm.guard, visit);
    visitExpr(arm.body, visit);
  }
}
