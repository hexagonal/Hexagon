/**
 * Typed syntax records the type inferred for every expression and scheme
 * assigned to every binding. Constraint requirements remain explicit so
 * elaboration can later choose a concrete operation or dictionary evidence.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type * as Resolved from "../resolved/index.js";

declare const typeVariableIdBrand: unique symbol;

export type TypeVariableId = number & {
  readonly [typeVariableIdBrand]: "TypeVariableId";
};

export type PrimitiveName =
  | "Int"
  | "Float"
  | "Bool"
  | "String"
  | "BigInt"
  | "Unit";

export type Type = PrimitiveType | VariableType | FunctionType | ErrorType;

export interface PrimitiveType {
  readonly kind: "Primitive";
  readonly name: PrimitiveName;
}

export interface VariableType {
  readonly kind: "Variable";
  readonly id: TypeVariableId;
}

export interface FunctionType {
  readonly kind: "Function";
  readonly parameters: readonly Type[];
  readonly result: Type;
}

export interface ErrorType {
  readonly kind: "Error";
}

export type ConstraintName =
  | "Num"
  | "Frac"
  | "Pow"
  | "Concat"
  | "Eq"
  | "Ord"
  | "Show";

export interface Constraint {
  readonly name: ConstraintName;
  readonly type: Type;
  readonly span: Source.Span;
}

export interface Scheme {
  readonly variables: readonly TypeVariableId[];
  readonly constraints: readonly Constraint[];
  readonly type: Type;
}

export interface Symbol {
  readonly id: Resolved.SymbolId;
  readonly name: string;
  readonly kind: Resolved.SymbolKind;
  readonly bindingSpan: Source.Span;
  readonly scheme: Scheme;
}

export interface Binding {
  readonly symbol: Resolved.SymbolId;
  readonly name: string;
  readonly scheme: Scheme;
  readonly span: Source.Span;
}

export interface FieldName {
  readonly text: string;
  readonly case: "lower" | "upper";
  readonly span: Source.Span;
}

export interface Module {
  readonly kind: "Module";
  readonly fileId: Source.FileId;
  readonly items: readonly Item[];
  readonly symbols: readonly Symbol[];
  readonly span: Source.Span;
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}

export type Item = LetItem | FunItem | ExprItem | ErrorItem;

export interface LetItem {
  readonly kind: "Let";
  readonly exported: boolean;
  readonly binding: Binding;
  readonly value: Expr;
  readonly span: Source.Span;
}

export interface FunItem {
  readonly kind: "Fun";
  readonly exported: boolean;
  readonly binding: Binding;
  readonly value: LambdaExpr;
  readonly span: Source.Span;
}

export interface ExprItem {
  readonly kind: "ExprItem";
  readonly expression: Expr;
  readonly span: Source.Span;
}

export interface ErrorItem {
  readonly kind: "ErrorItem";
  readonly span: Source.Span;
}

interface ExpressionFields {
  readonly type: Type;
  readonly span: Source.Span;
}

export type Expr =
  | NameExpr
  | UnitExpr
  | BooleanExpr
  | FromIntExpr
  | BigIntExpr
  | FloatExpr
  | StringExpr
  | GroupExpr
  | BlockExpr
  | LambdaExpr
  | IfExpr
  | CallExpr
  | AccessExpr
  | IndexExpr
  | LogicalNotExpr
  | LogicalExpr
  | ConstraintCallExpr
  | ComparisonChainExpr
  | AssignmentExpr
  | ErrorExpr;

export interface NameExpr extends ExpressionFields {
  readonly kind: "Name";
  readonly symbol: Resolved.SymbolId;
  readonly text: string;
}

export interface UnitExpr extends ExpressionFields {
  readonly kind: "Unit";
}

export interface BooleanExpr extends ExpressionFields {
  readonly kind: "Boolean";
  readonly value: boolean;
}

/** An integer literal with its explicit `Num.fromInt` requirement. */
export interface FromIntExpr extends ExpressionFields {
  readonly kind: "FromInt";
  readonly decimal: string;
  readonly requirement: Constraint;
}

export interface BigIntExpr extends ExpressionFields {
  readonly kind: "BigInt";
  readonly decimal: string;
}

export interface FloatExpr extends ExpressionFields {
  readonly kind: "Float";
  readonly spelling: string;
  readonly value: number;
}

export interface StringExpr extends ExpressionFields {
  readonly kind: "String";
  readonly parts: readonly StringPart[];
}

export type StringPart = StringText | StringInterpolation;

export interface StringText {
  readonly kind: "Text";
  readonly value: string;
  readonly span: Source.Span;
}

export interface StringInterpolation {
  readonly kind: "Interpolation";
  readonly expression: Expr;
  readonly requirement: Constraint;
  readonly span: Source.Span;
}

export interface GroupExpr extends ExpressionFields {
  readonly kind: "Group";
  readonly expression: Expr;
}

export interface BlockExpr extends ExpressionFields {
  readonly kind: "Block";
  readonly items: readonly Item[];
}

export interface LambdaExpr extends ExpressionFields {
  readonly kind: "Lambda";
  readonly parameters: readonly Binding[];
  readonly body: Expr;
}

export interface IfExpr extends ExpressionFields {
  readonly kind: "If";
  readonly condition: Expr;
  readonly consequence: Expr;
  readonly alternative?: Expr;
}

export interface CallExpr extends ExpressionFields {
  readonly kind: "Call";
  readonly callee: Expr;
  readonly arguments: readonly Expr[];
}

export interface AccessExpr extends ExpressionFields {
  readonly kind: "Access";
  readonly receiver: Expr;
  readonly field: FieldName;
}

export interface IndexExpr extends ExpressionFields {
  readonly kind: "Index";
  readonly receiver: Expr;
  readonly index: Expr;
}

export interface LogicalNotExpr extends ExpressionFields {
  readonly kind: "LogicalNot";
  readonly operand: Expr;
}

export interface LogicalExpr extends ExpressionFields {
  readonly kind: "Logical";
  readonly operation: "And" | "Or";
  readonly left: Expr;
  readonly right: Expr;
}

export type ConstraintMember =
  | "negate"
  | "pow"
  | "multiply"
  | "divide"
  | "add"
  | "subtract"
  | "concat";

export interface ConstraintCallExpr extends ExpressionFields {
  readonly kind: "ConstraintCall";
  readonly constraint: ConstraintName;
  readonly member: ConstraintMember;
  readonly requirement: Constraint;
  readonly arguments: readonly Expr[];
}

export type ComparisonTest =
  | "Equal"
  | "NotEqual"
  | "Less"
  | "Greater"
  | "LessEqual"
  | "GreaterEqual";

export interface ComparisonStep {
  readonly test: ComparisonTest;
  readonly requirement: Constraint;
  readonly span: Source.Span;
}

export interface ComparisonChainExpr extends ExpressionFields {
  readonly kind: "ComparisonChain";
  readonly operands: readonly Expr[];
  readonly steps: readonly ComparisonStep[];
}

export interface AssignmentExpr extends ExpressionFields {
  readonly kind: "Assignment";
  readonly target: Expr;
  readonly value: Expr;
}

export interface ErrorExpr extends ExpressionFields {
  readonly kind: "ErrorExpr";
}

export function typeVariableId(value: number): TypeVariableId {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("a type-variable id must be a non-negative safe integer");
  }
  return value as TypeVariableId;
}
