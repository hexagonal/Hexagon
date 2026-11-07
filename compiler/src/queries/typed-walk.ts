/**
 * The checked tree, item by item and expression by expression: every item of a
 * module, nested ones in blocks included, and every expression in each of them.
 *
 * Exhaustive over the expression kinds, so a kind added to the checked tree is
 * a compile error here rather than a place the editor services stop looking.
 */

import type * as Typed from "../syntax/typed/index.js";

/** Every item of a module, nested ones in blocks included. */
export function forEachTypedItem(module: Typed.Module, visit: (item: Typed.Item) => void): void {
  walk(module, visit, () => {});
}

/** Every expression of a module, in every item, nested ones included. */
export function forEachTypedExpression(module: Typed.Module, visit: (expression: Typed.Expr) => void): void {
  walk(module, () => {}, visit);
}

function walk(
  module: Typed.Module,
  onItem: (item: Typed.Item) => void,
  onExpression: (expression: Typed.Expr) => void,
): void {
  const visitItem = (item: Typed.Item): void => {
    onItem(item);
    switch (item.kind) {
      case "Let":
      case "Var":
      case "LetPattern":
      case "Fun":
        visitExpression(item.value);
        return;
      case "ConstraintDeclaration":
        for (const member of item.members) {
          if (member.defaultValue !== undefined) visitExpression(member.defaultValue);
        }
        return;
      case "Honor":
        for (const member of item.members) visitExpression(member.value);
        return;
      case "PatternDeclaration":
        visitExpression(item.view.value);
        if (item.build !== undefined) visitExpression(item.build.value);
        return;
      case "ExprItem":
        visitExpression(item.expression);
        return;
      default:
        return;
    }
  };
  const visitArms = (arms: readonly Typed.MatchArm[]): void => {
    for (const arm of arms) {
      if (arm.guard !== undefined) visitExpression(arm.guard);
      visitExpression(arm.body);
    }
  };
  const visitExpression = (expression: Typed.Expr): void => {
    onExpression(expression);
    switch (expression.kind) {
      case "Name":
      case "Unit":
      case "FromNat":
      case "BigInt":
      case "Dec":
      case "Float":
      case "CollectionOperation":
      case "ErrorExpr":
        return;
      case "WidenNat":
      case "WidenInt":
      case "WidenBigInt":
      case "Hash":
        visitExpression(expression.value);
        return;
      case "String":
        for (const part of expression.parts) {
          if (part.kind === "Interpolation") visitExpression(part.expression);
        }
        return;
      case "Vector":
      case "Tuple":
        for (const element of expression.elements) visitExpression(element);
        return;
      case "Record":
        if (expression.spread !== undefined) visitExpression(expression.spread);
        for (const field of expression.fields) visitExpression(field.value);
        return;
      case "Group":
      case "Ascription":
        visitExpression(expression.expression);
        return;
      case "Block":
        for (const item of expression.items) visitItem(item);
        return;
      case "Lambda":
        visitExpression(expression.body);
        return;
      case "If":
        visitExpression(expression.condition);
        visitExpression(expression.consequence);
        visitExpression(expression.alternative);
        return;
      case "While":
        visitExpression(expression.condition);
        visitExpression(expression.body);
        return;
      case "For":
        visitExpression(expression.iterable);
        visitExpression(expression.body);
        return;
      case "Match":
        visitExpression(expression.scrutinee);
        visitArms(expression.arms);
        visitArms(expression.catchArms ?? []);
        return;
      case "Try":
        visitExpression(expression.body);
        visitArms(expression.arms);
        return;
      case "Throw":
        visitExpression(expression.exception);
        return;
      case "Call":
        visitExpression(expression.callee);
        for (const argument of expression.arguments) visitExpression(argument);
        return;
      case "Access":
        visitExpression(expression.receiver);
        return;
      case "Index":
        visitExpression(expression.receiver);
        visitExpression(expression.index);
        return;
      case "LogicalNot":
        visitExpression(expression.operand);
        return;
      case "Logical":
        visitExpression(expression.left);
        visitExpression(expression.right);
        return;
      case "ConstraintCall":
        for (const argument of expression.arguments) visitExpression(argument);
        return;
      case "ComparisonChain":
        for (const operand of expression.operands) visitExpression(operand);
        return;
      case "Range":
        visitExpression(expression.start);
        visitExpression(expression.end);
        return;
      case "Assignment":
        visitExpression(expression.target);
        visitExpression(expression.value);
        return;
      default: {
        const unreachable: never = expression;
        return unreachable;
      }
    }
  };
  for (const item of module.items) visitItem(item);
}
