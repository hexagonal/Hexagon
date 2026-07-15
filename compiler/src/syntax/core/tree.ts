/**
 * Core syntax is a small typed semantic representation for emission. Surface
 * grouping and overloadable operators are absent; constraint operations and
 * their selected evidence are explicit.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type * as Resolved from "../resolved/index.js";
import type * as Typed from "../typed/index.js";

export type Evidence = PrimitiveEvidence | DictionaryEvidence | ErrorEvidence;

export interface PrimitiveEvidence {
  readonly kind: "Primitive";
  readonly instance: Typed.PrimitiveName;
}

export interface DictionaryEvidence {
  readonly kind: "Dictionary";
  readonly variable: Typed.TypeVariableId;
}

export interface ErrorEvidence {
  readonly kind: "Error";
}

export interface Symbol {
  readonly id: Resolved.SymbolId;
  readonly name: string;
  readonly kind: Resolved.SymbolKind;
  readonly bindingSpan: Source.Span;
  readonly scheme: Typed.Scheme;
}

export interface Binding {
  readonly symbol: Resolved.SymbolId;
  readonly name: string;
  readonly scheme: Typed.Scheme;
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
  readonly type: Typed.Type;
  readonly span: Source.Span;
}

export type Expr =
  | NameExpr
  | UnitExpr
  | BooleanExpr
  | NumberExpr
  | BigIntExpr
  | FloatExpr
  | StringExpr
  | ConvertIntExpr
  | BlockExpr
  | LambdaExpr
  | IfExpr
  | CallExpr
  | LogicalNotExpr
  | LogicalExpr
  | ConstraintCallExpr
  | ComparisonChainExpr
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

/** A concrete Int/Float representation of a source integer literal. */
export interface NumberExpr extends ExpressionFields {
  readonly kind: "Number";
  readonly decimal: string;
  readonly representation: "Int" | "Float";
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

export type StringPart = StringText | StringShow;

export interface StringText {
  readonly kind: "Text";
  readonly value: string;
  readonly span: Source.Span;
}

export interface StringShow {
  readonly kind: "Show";
  readonly expression: Expr;
  readonly evidence: Evidence;
  readonly span: Source.Span;
}

/** A non-representationally-trivial `Num.fromInt` application. */
export interface ConvertIntExpr extends ExpressionFields {
  readonly kind: "ConvertInt";
  readonly decimal: string;
  readonly evidence: Evidence;
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
  readonly constraint: Typed.ConstraintName;
  readonly member: ConstraintMember;
  readonly evidence: Evidence;
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
  readonly evidence: Evidence;
  readonly span: Source.Span;
}

/** Operands are evaluated once, in order, and adjacent pairs are tested. */
export interface ComparisonChainExpr extends ExpressionFields {
  readonly kind: "ComparisonChain";
  readonly operands: readonly Expr[];
  readonly steps: readonly ComparisonStep[];
}

export interface ErrorExpr extends ExpressionFields {
  readonly kind: "ErrorExpr";
}
