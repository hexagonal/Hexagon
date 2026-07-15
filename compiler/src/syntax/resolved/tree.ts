/**
 * Resolved syntax replaces textual references with stable symbol identities.
 * Binding spellings and spans remain for diagnostics and readable later output,
 * but every non-error Name expression identifies exactly one declared symbol.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";

declare const symbolIdBrand: unique symbol;

export type SymbolId = number & { readonly [symbolIdBrand]: "SymbolId" };

export type SymbolKind = "let" | "fun" | "parameter";

export type PrimitiveName =
  | "Int"
  | "Float"
  | "Bool"
  | "String"
  | "BigInt"
  | "Unit";

export type TypeAnnotation = PrimitiveTypeAnnotation | ErrorTypeAnnotation;

export interface PrimitiveTypeAnnotation {
  readonly kind: "Primitive";
  readonly name: PrimitiveName;
  readonly span: Source.Span;
}

export interface ErrorTypeAnnotation {
  readonly kind: "ErrorType";
  readonly span: Source.Span;
}

export interface Symbol {
  readonly id: SymbolId;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly bindingSpan: Source.Span;
}

export interface Binding {
  readonly symbol: SymbolId;
  readonly name: string;
  readonly span: Source.Span;
}

export interface Parameter extends Binding {
  readonly annotation?: TypeAnnotation;
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

export type Expr =
  | NameExpr
  | UnitExpr
  | BooleanExpr
  | IntegerExpr
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
  | UnaryExpr
  | BinaryExpr
  | ComparisonExpr
  | AssignmentExpr
  | ErrorExpr;

export interface NameExpr {
  readonly kind: "Name";
  readonly symbol: SymbolId;
  readonly text: string;
  readonly span: Source.Span;
}

export interface UnitExpr {
  readonly kind: "Unit";
  readonly span: Source.Span;
}

export interface BooleanExpr {
  readonly kind: "Boolean";
  readonly value: boolean;
  readonly span: Source.Span;
}

export interface IntegerExpr {
  readonly kind: "Integer";
  readonly decimal: string;
  readonly span: Source.Span;
}

export interface BigIntExpr {
  readonly kind: "BigInt";
  readonly decimal: string;
  readonly span: Source.Span;
}

export interface FloatExpr {
  readonly kind: "Float";
  readonly spelling: string;
  readonly value: number;
  readonly span: Source.Span;
}

export interface StringExpr {
  readonly kind: "String";
  readonly parts: readonly StringPart[];
  readonly span: Source.Span;
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
  readonly span: Source.Span;
}

export interface GroupExpr {
  readonly kind: "Group";
  readonly expression: Expr;
  readonly span: Source.Span;
}

export interface BlockExpr {
  readonly kind: "Block";
  readonly items: readonly Item[];
  readonly span: Source.Span;
}

export interface LambdaExpr {
  readonly kind: "Lambda";
  readonly parameters: readonly Parameter[];
  readonly returnAnnotation?: TypeAnnotation;
  readonly body: Expr;
  readonly span: Source.Span;
}

export interface IfExpr {
  readonly kind: "If";
  readonly condition: Expr;
  readonly consequence: Expr;
  readonly alternative?: Expr;
  readonly span: Source.Span;
}

export interface CallExpr {
  readonly kind: "Call";
  readonly callee: Expr;
  readonly arguments: readonly Expr[];
  readonly span: Source.Span;
}

export interface AccessExpr {
  readonly kind: "Access";
  readonly receiver: Expr;
  readonly field: FieldName;
  readonly span: Source.Span;
}

export interface IndexExpr {
  readonly kind: "Index";
  readonly receiver: Expr;
  readonly index: Expr;
  readonly span: Source.Span;
}

export type UnaryOperator = "Negate" | "Not";

export interface UnaryExpr {
  readonly kind: "Unary";
  readonly operator: UnaryOperator;
  readonly operand: Expr;
  readonly span: Source.Span;
}

export type BinaryOperator =
  | "Power"
  | "Multiply"
  | "Divide"
  | "Add"
  | "Subtract"
  | "Concat"
  | "Range"
  | "And"
  | "Or"
  | "Implies"
  | "Iff"
  | "Pipe";

export interface BinaryExpr {
  readonly kind: "Binary";
  readonly operator: BinaryOperator;
  readonly left: Expr;
  readonly right: Expr;
  readonly span: Source.Span;
}

export type ComparisonOperator =
  | "Equal"
  | "NotEqual"
  | "Less"
  | "Greater"
  | "LessEqual"
  | "GreaterEqual";

export interface ComparisonExpr {
  readonly kind: "Comparison";
  readonly operands: readonly Expr[];
  readonly operators: readonly ComparisonOperator[];
  readonly span: Source.Span;
}

export interface AssignmentExpr {
  readonly kind: "Assignment";
  readonly target: Expr;
  readonly value: Expr;
  readonly span: Source.Span;
}

export interface ErrorExpr {
  readonly kind: "ErrorExpr";
  readonly span: Source.Span;
}

/** Constructs a checked stable identity for one resolver-owned symbol. */
export function symbolId(value: number): SymbolId {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("a symbol id must be a non-negative safe integer");
  }
  return value as SymbolId;
}
