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
    records: module.records,
    externTypes: module.externTypes,
    comments: module.comments,
    span: module.span,
    diagnostics: module.diagnostics,
  };
}

function elaborateItem(item: Typed.Item): Core.Item {
  switch (item.kind) {
    case "Import":
    case "ExternBlock":
    case "ExternImport":
    case "ConstraintDeclaration":
      return item;
    case "Honor":
      return {
        ...item,
        baseConstraints: item.baseConstraints.map((constraint) => ({
          name: constraint.name,
          evidence: evidence(constraint),
        })),
        members: item.members.map((member) => ({
          ...member,
          value: {
            ...member.value,
            body: elaborateExpr(member.value.body),
          },
        })),
      };
    case "Let":
      return { ...item, value: elaborateExpr(item.value) };
    case "Var":
      return { ...item, value: elaborateExpr(item.value) };
    case "LetPattern":
      return { ...item, pattern: elaboratePattern(item.pattern), value: elaborateExpr(item.value) };
    case "Union":
    case "TypeAlias":
    case "RecordDeclaration":
    case "Exception":
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
    case "SeqOperation":
    case "PrimitiveOperation":
    case "Unit":
    case "Boolean":
    case "BigInt":
    case "Float":
    case "ErrorExpr":
      return expression;
    case "CollectionOperation": {
      const hashRequirement = expression.requirements.find(({ name }) => name === "Hash");
      return {
        ...expression,
        ...(hashRequirement === undefined ? {} : { hashEvidence: evidence(hashRequirement) }),
      };
    }
    case "FromNat":
      return elaborateInteger(expression);
    case "WidenNat":
      return {
        kind: "WidenNat",
        value: elaborateExpr(expression.value),
        evidence: evidence(expression.requirement),
        type: expression.type,
        span: expression.span,
      };
    case "WidenInt":
      return {
        kind: "WidenInt",
        value: elaborateExpr(expression.value),
        evidence: evidence(expression.requirement),
        type: expression.type,
        span: expression.span,
      };
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
    case "Hash":
      return {
        kind: "Hash",
        value: elaborateExpr(expression.value),
        evidence: evidence(expression.requirement),
        type: expression.type,
        span: expression.span,
      };
    case "Tuple":
    case "Vector":
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
    case "If":
      return {
        kind: "If" as const,
        condition: elaborateExpr(expression.condition),
        consequence: elaborateExpr(expression.consequence),
        alternative: elaborateExpr(expression.alternative),
        type: expression.type,
        span: expression.span,
      };
    case "While":
      return {
        ...expression,
        condition: elaborateExpr(expression.condition),
        body: elaborateExpr(expression.body) as Core.BlockExpr,
      };
    case "For":
      return {
        kind: "For",
        pattern: elaboratePattern(expression.pattern),
        iterable: elaborateExpr(expression.iterable),
        body: elaborateExpr(expression.body) as Core.BlockExpr,
        ...(expression.iteration === undefined
          ? {}
          : { iteration: evidence(expression.iteration) }),
        type: expression.type,
        span: expression.span,
      };
    case "Throw":
      return { ...expression, exception: elaborateExpr(expression.exception) };
    case "Try":
      return {
        ...expression,
        body: elaborateExpr(expression.body),
        arms: expression.arms.map((arm) => ({
          pattern: elaboratePattern(arm.pattern),
          ...(arm.guard === undefined
            ? {}
            : { guard: elaborateExpr(arm.guard) }),
          body: elaborateExpr(arm.body),
          span: arm.span,
        })),
      };
    case "Match":
      return {
        ...expression,
        scrutinee: elaborateExpr(expression.scrutinee),
        arms: expression.arms.map((arm) => ({
          pattern: elaboratePattern(arm.pattern),
          ...(arm.guard === undefined
            ? {}
            : { guard: elaborateExpr(arm.guard) }),
          body: elaborateExpr(arm.body),
          span: arm.span,
        })),
      };
    case "Call":
      return {
        kind: "Call",
        callee: elaborateExpr(expression.callee),
        arguments: expression.arguments.map(elaborateExpr),
        evidence: expression.requirements.map((requirement) => ({
          constraint: requirement.name,
          value: evidence(requirement),
        })),
        type: expression.type,
        span: expression.span,
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
    case "Range":
      return {
        ...expression,
        start: elaborateExpr(expression.start),
        end: elaborateExpr(expression.end),
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
    case "Assignment":
      return expression.target.kind === "Name"
        ? {
            kind: "Assignment",
            target: elaborateExpr(expression.target) as Core.NameExpr,
            value: elaborateExpr(expression.value),
            type: expression.type,
            span: expression.span,
          }
        : { kind: "ErrorExpr", type: expression.type, span: expression.span };
    case "Index":
      return expression.operation === undefined
        ? { kind: "ErrorExpr", type: expression.type, span: expression.span }
        : {
            kind: "Index",
            receiver: elaborateExpr(expression.receiver),
            index: elaborateExpr(expression.index),
            operation: expression.operation,
            ...(expression.requirements === undefined
              ? {}
              : {
                  hashEvidence: evidence(
                    expression.requirements.find(({ name }) => name === "Hash"),
                  ),
                }),
            type: expression.type,
            span: expression.span,
          };
  }
}

/** Copies a fully checked pattern into Core without retaining a Typed tree node. */
function elaboratePattern(pattern: Typed.Pattern): Core.Pattern {
  switch (pattern.kind) {
    case "Binding":
    case "Wildcard":
    case "Unit":
    case "Boolean":
    case "Integer":
    case "String":
      return { ...pattern };
    case "As":
      return { ...pattern, pattern: elaboratePattern(pattern.pattern) };
    case "Or":
      return { ...pattern, alternatives: pattern.alternatives.map(elaboratePattern) };
    case "Tuple":
      return { ...pattern, elements: pattern.elements.map(elaboratePattern) };
    case "Vector":
      return {
        kind: "Vector",
        elements: pattern.elements.map(elaboratePattern),
        ...(pattern.rest === undefined
          ? {}
          : {
              rest: {
                index: pattern.rest.index,
                span: pattern.rest.span,
                ...(pattern.rest.pattern === undefined
                  ? {}
                  : { pattern: elaboratePattern(pattern.rest.pattern) }),
              },
            }),
        span: pattern.span,
      };
    case "Record":
      return {
        ...pattern,
        fields: pattern.fields.map((field) => ({
          ...field,
          pattern: elaboratePattern(field.pattern),
        })),
      };
    case "Constructor":
      return { ...pattern, arguments: pattern.arguments.map(elaboratePattern) };
  }
}

function elaborateInteger(expression: Typed.FromNatExpr): Core.Expr {
  if (expression.type.kind === "Primitive") {
    if (
      expression.type.name === "Nat" ||
      expression.type.name === "Int" ||
      expression.type.name === "Float"
    ) {
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
    kind: "ConvertNat",
    decimal: expression.decimal,
    evidence: evidence(expression.requirement),
    type: expression.type,
    span: expression.span,
  };
}

function evidence(requirement: Typed.Constraint | undefined): Core.Evidence {
  if (requirement === undefined) return { kind: "Error" };
  if (requirement.dictionary !== undefined) {
    return {
      kind: "Instance",
      dictionary: requirement.dictionary,
      arguments: (requirement.dictionaryArguments ?? []).map((argument) => ({
        constraint: argument.name,
        evidence: evidence(argument),
      })),
    };
  }
  if (requirement.structural === true) {
    return { kind: "Structural", type: requirement.type };
  }
  switch (requirement.type.kind) {
    case "Primitive":
      return { kind: "Primitive", instance: requirement.type.name };
    case "Variable":
      return {
        kind: "Dictionary",
        variable: requirement.type.id,
        ...(requirement.evidenceConstraint === undefined
          ? {}
          : { constraint: requirement.evidenceConstraint }),
        ...(requirement.evidencePath === undefined
          ? {}
          : { path: requirement.evidencePath }),
      };
    case "Function":
    case "Tuple":
    case "Record":
    case "Range":
    case "Seq":
    case "Vector":
    case "Map":
    case "Set":
    case "Array":
    case "Nullable":
    case "Union":
    case "NominalRecord":
    case "ExternType":
    case "Error":
      return { kind: "Error" };
  }
}
