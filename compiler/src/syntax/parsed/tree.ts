/**
 * Parsed syntax records grammatical structure without resolving names or
 * attaching types. The first-round tree covers the expression-and-binding
 * slices implemented by the parser; recovery nodes preserve useful
 * structure after syntax errors without pretending invalid input is valid.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";

export interface Module {
  readonly kind: "Module";
  readonly fileId: Source.FileId;
  readonly items: readonly Item[];
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
  readonly name: Name;
  readonly annotation?: TypeAnnotation;
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

export interface FunItem {
  readonly kind: "Fun";
  readonly exported: boolean;
  readonly name: Name;
  readonly value: LambdaExpr;
  readonly span: Source.Span;
}

export interface UnionItem {
  readonly kind: "Union";
  readonly exported: boolean;
  readonly name: Name;
  readonly constructors: readonly Constructor[];
  readonly span: Source.Span;
}

export interface Constructor {
  readonly name: Name;
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

export interface Name {
  readonly text: string;
  readonly case: "lower" | "upper";
  readonly span: Source.Span;
}

export type Pattern =
  | BindingPattern
  | WildcardPattern
  | TuplePattern
  | ConstructorPattern;

export interface BindingPattern {
  readonly kind: "Binding";
  readonly name: Name;
  readonly span: Source.Span;
}

export interface WildcardPattern {
  readonly kind: "Wildcard";
  readonly span: Source.Span;
}

export interface TuplePattern {
  readonly kind: "Tuple";
  readonly elements: readonly Pattern[];
  readonly span: Source.Span;
}

export interface ConstructorPattern {
  readonly kind: "Constructor";
  readonly name: Name;
  readonly arguments: readonly Pattern[];
  readonly span: Source.Span;
}

export interface NamedType {
  readonly kind: "NamedType";
  readonly name: Name;
  readonly span: Source.Span;
}

export interface TupleType {
  readonly kind: "Tuple";
  readonly elements: readonly TypeAnnotation[];
  readonly span: Source.Span;
}

export type TypeAnnotation = NamedType | TupleType;

export interface Parameter {
  readonly name: Name;
  readonly annotation?: TypeAnnotation;
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
  | TupleExpr
  | GroupExpr
  | BlockExpr
  | LambdaExpr
  | IfExpr
  | MatchExpr
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
  readonly name: Name;
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

export interface TupleExpr {
  readonly kind: "Tuple";
  readonly elements: readonly Expr[];
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

export interface MatchExpr {
  readonly kind: "Match";
  readonly scrutinee: Expr;
  readonly arms: readonly MatchArm[];
  readonly span: Source.Span;
}

export interface MatchArm {
  readonly pattern: Pattern;
  readonly body: Expr;
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
  readonly field: Name;
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
