/**
 * Elaboration removes surface-only expression forms and makes every remaining
 * constraint dispatch explicit. It does not format JavaScript or choose names
 * for emitted helpers; those decisions belong to emission.
 */

import type * as Core from "../../syntax/core/index.js";
import type * as Typed from "../../syntax/typed/index.js";

export function elaborate(module: Typed.Module): Core.Module {
  return {
    kind: "Module",
    fileId: module.fileId,
    items: module.items.map(elaborateItem),
    symbols: module.symbols,
    unions: module.unions,
    comments: module.comments,
    span: module.span,
    diagnostics: module.diagnostics,
  };
}

function elaborateItem(item: Typed.Item): Core.Item {
  switch (item.kind) {
    case "Let":
      return { ...item, value: elaborateExpr(item.value) };
    case "LetPattern":
      return { ...item, value: elaborateExpr(item.value) };
    case "Union":
      return item;
    case "Fun":
      return {
        ...item,
        value: {
          ...item.value,
          body: elaborateExpr(item.value.body),
        },
      };
    case "ExprItem":
      return { ...item, expression: elaborateExpr(item.expression) };
    case "ErrorItem":
      return item;
  }
}

function elaborateExpr(expression: Typed.Expr): Core.Expr {
  switch (expression.kind) {
    case "Name":
    case "Unit":
    case "Boolean":
    case "BigInt":
    case "Float":
    case "ErrorExpr":
      return expression;
    case "FromInt":
      return elaborateInteger(expression);
    case "String":
      return {
        ...expression,
        parts: expression.parts.map((part) =>
          part.kind === "Text"
            ? part
            : {
                kind: "Show" as const,
                expression: elaborateExpr(part.expression),
                evidence: evidence(part.requirement),
                span: part.span,
              },
        ),
      };
    case "Tuple":
      return {
        ...expression,
        elements: expression.elements.map(elaborateExpr),
      };
    case "Record":
      return {
        kind: "Record",
        type: expression.type,
        ...(expression.spread === undefined
          ? {}
          : { spread: elaborateExpr(expression.spread) }),
        fields: expression.fields.map((field) => ({
          name: field.name.text,
          punned: field.punned,
          value: elaborateExpr(field.value),
          span: field.span,
        })),
        span: expression.span,
      };
    case "Group":
      return elaborateExpr(expression.expression);
    case "Block":
      return { ...expression, items: expression.items.map(elaborateItem) };
    case "Lambda":
      return { ...expression, body: elaborateExpr(expression.body) };
    case "If": {
      const common = {
        kind: "If" as const,
        condition: elaborateExpr(expression.condition),
        consequence: elaborateExpr(expression.consequence),
        type: expression.type,
        span: expression.span,
      };
      return expression.alternative === undefined
        ? common
        : { ...common, alternative: elaborateExpr(expression.alternative) };
    }
    case "Match":
      return {
        ...expression,
        scrutinee: elaborateExpr(expression.scrutinee),
        arms: expression.arms.map((arm) => ({
          pattern: arm.pattern,
          ...(arm.guard === undefined
            ? {}
            : { guard: elaborateExpr(arm.guard) }),
          body: elaborateExpr(arm.body),
          span: arm.span,
        })),
      };
    case "Call":
      return {
        ...expression,
        callee: elaborateExpr(expression.callee),
        arguments: expression.arguments.map(elaborateExpr),
      };
    case "ConsoleLog":
      return {
        ...expression,
        arguments: expression.arguments.map(elaborateExpr),
      };
    case "LogicalNot":
      return { ...expression, operand: elaborateExpr(expression.operand) };
    case "Logical":
      return {
        ...expression,
        left: elaborateExpr(expression.left),
        right: elaborateExpr(expression.right),
      };
    case "ConstraintCall":
      return {
        kind: "ConstraintCall",
        constraint: expression.constraint,
        member: expression.member,
        evidence: evidence(expression.requirement),
        arguments: expression.arguments.map(elaborateExpr),
        type: expression.type,
        span: expression.span,
      };
    case "ComparisonChain":
      return {
        kind: "ComparisonChain",
        operands: expression.operands.map(elaborateExpr),
        steps: expression.steps.map((step) => ({
          test: step.test,
          evidence: evidence(step.requirement),
          span: step.span,
        })),
        type: expression.type,
        span: expression.span,
      };
    case "Access":
      return expression.tupleIndex !== undefined
        ? {
            kind: "TupleAccess",
            receiver: elaborateExpr(expression.receiver),
            index: expression.tupleIndex,
            type: expression.type,
            span: expression.span,
          }
        : expression.recordField !== undefined
          ? {
              kind: "FieldAccess",
              receiver: elaborateExpr(expression.receiver),
              field: expression.recordField,
              type: expression.type,
              span: expression.span,
            }
          : { kind: "ErrorExpr", type: expression.type, span: expression.span };
    case "Index":
    case "Assignment":
      return { kind: "ErrorExpr", type: expression.type, span: expression.span };
  }
}

function elaborateInteger(expression: Typed.FromIntExpr): Core.Expr {
  if (expression.type.kind === "Primitive") {
    if (expression.type.name === "Int" || expression.type.name === "Float") {
      return {
        kind: "Number",
        decimal: expression.decimal,
        representation: expression.type.name,
        type: expression.type,
        span: expression.span,
      };
    }
    if (expression.type.name === "BigInt") {
      return {
        kind: "BigInt",
        decimal: expression.decimal,
        type: expression.type,
        span: expression.span,
      };
    }
  }

  return {
    kind: "ConvertInt",
    decimal: expression.decimal,
    evidence: evidence(expression.requirement),
    type: expression.type,
    span: expression.span,
  };
}

function evidence(requirement: Typed.Constraint | undefined): Core.Evidence {
  if (requirement === undefined) return { kind: "Error" };
  switch (requirement.type.kind) {
    case "Primitive":
      return { kind: "Primitive", instance: requirement.type.name };
    case "Variable":
      return { kind: "Dictionary", variable: requirement.type.id };
    case "Function":
    case "Tuple":
    case "Record":
    case "Union":
    case "Error":
      return { kind: "Error" };
  }
}
