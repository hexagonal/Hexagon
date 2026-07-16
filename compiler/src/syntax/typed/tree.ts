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

export type Type =
  | PrimitiveType
  | VariableType
  | TupleType
  | RecordType
  | UnionType
  | FunctionType
  | ErrorType;

export interface PrimitiveType {
  readonly kind: "Primitive";
  readonly name: PrimitiveName;
}

export interface VariableType {
  readonly kind: "Variable";
  readonly id: TypeVariableId;
}

export interface TupleType {
  readonly kind: "Tuple";
  readonly elements: readonly Type[];
}

export interface RecordType {
  readonly kind: "Record";
  readonly fields: readonly { readonly name: string; readonly type: Type }[];
  readonly tail?: TypeVariableId;
}

export interface UnionType {
  readonly kind: "Union";
  readonly union: Resolved.UnionId;
  readonly name: string;
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
  readonly unions: readonly Union[];
  readonly comments: readonly Source.Comment[];
  readonly span: Source.Span;
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}

export type Item =
  | LetItem
  | LetPatternItem
  | FunItem
  | UnionItem
  | ExprItem
  | ErrorItem;

export interface LetItem {
  readonly kind: "Let";
  readonly exported: boolean;
  readonly binding: Binding;
  readonly value: Expr;
  readonly span: Source.Span;
}

export interface LetPatternItem {
  readonly kind: "LetPattern";
  readonly exported: false;
  readonly pattern: Pattern;
  readonly value: Expr;
  readonly span: Source.Span;
}

export type Pattern =
  | BindingPattern
  | WildcardPattern
  | UnitPattern
  | BooleanPattern
  | IntegerPattern
  | StringPattern
  | TuplePattern
  | RecordPattern
  | OrPattern
  | AsPattern
  | ConstructorPattern;

export interface BindingPattern {
  readonly kind: "Binding";
  readonly binding: Binding;
  readonly span: Source.Span;
}

export interface WildcardPattern {
  readonly kind: "Wildcard";
  readonly span: Source.Span;
}

export interface UnitPattern {
  readonly kind: "Unit";
  readonly span: Source.Span;
}

export interface AsPattern {
  readonly kind: "As";
  readonly pattern: Pattern;
  readonly binding: Binding;
  readonly span: Source.Span;
}

export interface OrPattern {
  readonly kind: "Or";
  readonly alternatives: readonly Pattern[];
  readonly span: Source.Span;
}

export interface BooleanPattern {
  readonly kind: "Boolean";
  readonly value: boolean;
  readonly span: Source.Span;
}

export interface IntegerPattern {
  readonly kind: "Integer";
  readonly decimal: string;
  readonly span: Source.Span;
}

export interface StringPattern {
  readonly kind: "String";
  readonly value: string;
  readonly span: Source.Span;
}

export interface TuplePattern {
  readonly kind: "Tuple";
  readonly elements: readonly Pattern[];
  readonly span: Source.Span;
}

export interface RecordPattern {
  readonly kind: "Record";
  readonly fields: readonly RecordPatternField[];
  readonly span: Source.Span;
}

export interface RecordPatternField {
  readonly name: string;
  readonly pattern: Pattern;
  readonly span: Source.Span;
}

export interface ConstructorPattern {
  readonly kind: "Constructor";
  readonly symbol: Resolved.SymbolId;
  readonly text: string;
  readonly arguments: readonly Pattern[];
  readonly span: Source.Span;
}

export interface FunItem {
  readonly kind: "Fun";
  readonly exported: boolean;
  readonly binding: Binding;
  readonly value: LambdaExpr;
  readonly span: Source.Span;
}

export interface Union {
  readonly id: Resolved.UnionId;
  readonly name: string;
  readonly span: Source.Span;
  readonly constructors: readonly Constructor[];
}

export interface Constructor extends Binding {
  readonly slots: readonly ConstructorSlot[];
}

export interface ConstructorSlot {
  readonly field: string;
  readonly type: Type;
  readonly span: Source.Span;
}

export interface UnionItem {
  readonly kind: "Union";
  readonly exported: boolean;
  readonly union: Resolved.UnionId;
  readonly name: string;
  readonly constructors: readonly Constructor[];
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
  | TupleExpr
  | RecordExpr
  | GroupExpr
  | BlockExpr
  | LambdaExpr
  | IfExpr
  | MatchExpr
  | CallExpr
  | ConsoleLogExpr
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

export interface TupleExpr extends ExpressionFields {
  readonly kind: "Tuple";
  readonly elements: readonly Expr[];
}

export interface RecordExpr extends ExpressionFields {
  readonly kind: "Record";
  readonly spread?: Expr;
  readonly fields: readonly RecordField[];
}

export interface RecordField {
  readonly name: FieldName;
  readonly punned: boolean;
  readonly value: Expr;
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

export interface MatchExpr extends ExpressionFields {
  readonly kind: "Match";
  readonly scrutinee: Expr;
  readonly arms: readonly MatchArm[];
  readonly union?: Resolved.UnionId;
}

export interface MatchArm {
  readonly pattern: Pattern;
  readonly guard?: Expr;
  readonly body: Expr;
  readonly span: Source.Span;
}

export interface CallExpr extends ExpressionFields {
  readonly kind: "Call";
  readonly callee: Expr;
  readonly arguments: readonly Expr[];
}

/** The host console operation accepts any inferred argument types and returns Unit. */
export interface ConsoleLogExpr extends ExpressionFields {
  readonly kind: "ConsoleLog";
  readonly arguments: readonly Expr[];
}

export interface AccessExpr extends ExpressionFields {
  readonly kind: "Access";
  readonly receiver: Expr;
  readonly field: FieldName;
  readonly tupleIndex?: number;
  readonly recordField?: string;
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
