/**
 * Core syntax is a small typed semantic representation for emission. Surface
 * grouping and overloadable operators are absent; constraint operations and
 * their selected evidence are explicit.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type * as Resolved from "../resolved/index.js";
import type * as Typed from "../typed/index.js";

export type Evidence = PrimitiveEvidence | DictionaryEvidence | InstanceEvidence | StructuralEvidence | ErrorEvidence;

export interface PrimitiveEvidence {
  readonly kind: "Primitive";
  readonly instance: Typed.PrimitiveName;
}

export interface DictionaryEvidence {
  readonly kind: "Dictionary";
  readonly variable: Typed.TypeVariableId;
  readonly constraint?: Typed.ConstraintName;
  readonly path?: readonly string[];
}

export interface ErrorEvidence {
  readonly kind: "Error";
}

export interface InstanceEvidence {
  readonly kind: "Instance";
  readonly dictionary: string;
  readonly arguments: readonly EvidenceArgument[];
}

export interface StructuralEvidence {
  readonly kind: "Structural";
  readonly type: Typed.Type;
}

export interface EvidenceArgument {
  readonly constraint: Typed.ConstraintName;
  readonly evidence: Evidence;
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
  readonly unions: readonly Union[];
  readonly records: readonly RecordDeclaration[];
  readonly comments: readonly Source.Comment[];
  readonly span: Source.Span;
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}

export type Item =
  | ImportItem
  | LetItem
  | VarItem
  | LetPatternItem
  | FunItem
  | RecordItem
  | ExceptionItem
  | ConstraintItem
  | HonorItem
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

export type ImportItem = Resolved.ImportItem;

export interface VarItem {
  readonly kind: "Var";
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
  | VectorPattern
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

export interface VectorPattern {
  readonly kind: "Vector";
  readonly elements: readonly Pattern[];
  readonly rest?: { readonly pattern?: Pattern; readonly index: number; readonly span: Source.Span };
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
  readonly parameters: readonly Typed.TypeVariableId[];
  readonly span: Source.Span;
  readonly constructors: readonly Constructor[];
}

export interface Constructor extends Binding {
  readonly slots: readonly ConstructorSlot[];
}

export interface ConstructorSlot {
  readonly field: string;
  readonly type: Typed.Type;
  readonly span: Source.Span;
}

export interface UnionItem {
  readonly kind: "Union";
  readonly exported: boolean;
  readonly union: Resolved.UnionId;
  readonly name: string;
  readonly parameters: readonly Typed.TypeVariableId[];
  readonly constructors: readonly Constructor[];
  readonly span: Source.Span;
}

export type RecordDeclaration = Typed.RecordDeclaration;

export interface RecordItem extends Typed.RecordItem {}
export interface ExceptionItem extends Typed.ExceptionItem {}
export interface ConstraintItem extends Typed.ConstraintItem {}
export interface HonorItem {
  readonly kind: "Honor";
  readonly constraint: string;
  readonly typeParameters: readonly Typed.HonorTypeParameter[];
  readonly subject: Typed.Type;
  readonly derived: boolean;
  readonly dictionary: string;
  readonly superconstraints: readonly HonorSuperconstraint[];
  readonly impliedTypes: readonly Typed.HonorImpliedType[];
  readonly members: readonly HonorMember[];
  readonly span: Source.Span;
}

export interface HonorSuperconstraint {
  readonly name: Typed.ConstraintName;
  readonly evidence: Evidence;
}

export interface HonorMember {
  readonly name: string;
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
  | SeqOperationExpr
  | UnitExpr
  | BooleanExpr
  | NumberExpr
  | BigIntExpr
  | FloatExpr
  | StringExpr
  | VectorExpr
  | TupleExpr
  | TupleAccessExpr
  | RecordExpr
  | FieldAccessExpr
  | IndexExpr
  | HashExpr
  | CollectionOperationExpr
  | ConvertIntExpr
  | WidenIntExpr
  | BlockExpr
  | LambdaExpr
  | IfExpr
  | WhileExpr
  | ForExpr
  | MatchExpr
  | TryExpr
  | ThrowExpr
  | CallExpr
  | ConsoleLogExpr
  | LogicalNotExpr
  | LogicalExpr
  | ConstraintCallExpr
  | ComparisonChainExpr
  | RangeExpr
  | AssignmentExpr
  | ErrorExpr;

export interface NameExpr extends ExpressionFields {
  readonly kind: "Name";
  readonly symbol: Resolved.SymbolId;
  readonly text: string;
}

export interface SeqOperationExpr extends ExpressionFields {
  readonly kind: "SeqOperation";
  readonly operation: "iterate" | "map" | "filter" | "take";
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

export interface VectorExpr extends ExpressionFields {
  readonly kind: "Vector";
  readonly elements: readonly Expr[];
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

export interface TupleExpr extends ExpressionFields {
  readonly kind: "Tuple";
  readonly elements: readonly Expr[];
}

export interface TupleAccessExpr extends ExpressionFields {
  readonly kind: "TupleAccess";
  readonly receiver: Expr;
  /** Zero-based only in Core and emission; source syntax remains one-based. */
  readonly index: number;
}

export interface RecordExpr extends ExpressionFields {
  readonly kind: "Record";
  readonly spread?: Expr;
  readonly fields: readonly { readonly name: string; readonly punned: boolean; readonly value: Expr; readonly span: Source.Span }[];
}

export interface FieldAccessExpr extends ExpressionFields {
  readonly kind: "FieldAccess";
  readonly receiver: Expr;
  readonly field: string;
}

export interface IndexExpr extends ExpressionFields {
  readonly kind: "Index";
  readonly receiver: Expr;
  readonly index: Expr;
  readonly operation: "VectorElement" | "VectorSlice" | "StringElement" | "StringSlice" | "MapElement";
  readonly hashEvidence?: Evidence;
}

export interface HashExpr extends ExpressionFields {
  readonly kind: "Hash";
  readonly value: Expr;
  readonly evidence: Evidence;
}

export interface CollectionOperationExpr extends ExpressionFields {
  readonly kind: "CollectionOperation";
  readonly collection: "Map" | "Set" | "Vector";
  readonly operation: string;
  readonly hashEvidence?: Evidence;
}

/** A non-representationally-trivial `Num.fromInt` application. */
export interface ConvertIntExpr extends ExpressionFields {
  readonly kind: "ConvertInt";
  readonly decimal: string;
  readonly evidence: Evidence;
}

/** An explicit contextual `Num.fromInt(value)` selected during checking. */
export interface WidenIntExpr extends ExpressionFields {
  readonly kind: "WidenInt";
  readonly value: Expr;
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

export interface WhileExpr extends ExpressionFields {
  readonly kind: "While";
  readonly condition: Expr;
  readonly body: BlockExpr;
}

export interface ForExpr extends ExpressionFields {
  readonly kind: "For";
  readonly pattern: Pattern;
  readonly iterable: Expr;
  readonly body: BlockExpr;
  readonly iteration?: Evidence;
}

export interface RangeExpr extends ExpressionFields {
  readonly kind: "Range";
  readonly start: Expr;
  readonly end: Expr;
}

export interface AssignmentExpr extends ExpressionFields {
  readonly kind: "Assignment";
  readonly target: NameExpr;
  readonly value: Expr;
}

export interface MatchExpr extends ExpressionFields {
  readonly kind: "Match";
  readonly scrutinee: Expr;
  readonly arms: readonly MatchArm[];
  readonly union?: Resolved.UnionId;
}

export interface ThrowExpr extends ExpressionFields {
  readonly kind: "Throw";
  readonly exception: Expr;
}

export interface TryExpr extends ExpressionFields {
  readonly kind: "Try";
  readonly body: Expr;
  readonly arms: readonly MatchArm[];
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
  readonly evidence: readonly CallEvidence[];
}

export interface CallEvidence {
  readonly constraint: Typed.ConstraintName;
  readonly value: Evidence;
}

/** An explicit effectful call to the JavaScript host console. */
export interface ConsoleLogExpr extends ExpressionFields {
  readonly kind: "ConsoleLog";
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
