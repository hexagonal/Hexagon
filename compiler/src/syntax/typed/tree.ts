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
  | "Exn"
  | "Unit";

export type Type =
  | PrimitiveType
  | RangeType
  | SeqType
  | VectorType
  | MapType
  | SetType
  | ArrayType
  | NullableType
  | VariableType
  | TupleType
  | RecordType
  | UnionType
  | NominalRecordType
  | ExternType
  | FunctionType
  | ErrorType;

export interface PrimitiveType {
  readonly kind: "Primitive";
  readonly name: PrimitiveName;
}

export interface RangeType {
  readonly kind: "Range";
}

export interface SeqType {
  readonly kind: "Seq";
  readonly element: Type;
}

export interface VectorType {
  readonly kind: "Vector";
  readonly element: Type;
}

export interface MapType {
  readonly kind: "Map";
  readonly key: Type;
  readonly value: Type;
}

export interface SetType {
  readonly kind: "Set";
  readonly element: Type;
}

export interface ArrayType {
  readonly kind: "Array";
  readonly element: Type;
}

export interface NullableType {
  readonly kind: "Nullable";
  readonly value: Type;
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
  readonly arguments: readonly Type[];
}

export interface NominalRecordType {
  readonly kind: "NominalRecord";
  readonly record: Resolved.RecordId;
  readonly name: string;
  readonly arguments: readonly Type[];
}

export interface ExternType {
  readonly kind: "ExternType";
  readonly externType: Resolved.ExternTypeId;
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

export type ConstraintName = string;

export interface Constraint {
  readonly name: ConstraintName;
  readonly type: Type;
  readonly span: Source.Span;
  readonly dictionary?: string;
  readonly evidenceConstraint?: ConstraintName;
  readonly evidencePath?: readonly string[];
  readonly dictionaryArguments?: readonly Constraint[];
  readonly structural?: boolean;
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
  readonly startClass: "non-upper" | "upper";
  readonly span: Source.Span;
}

export interface Module {
  readonly kind: "Module";
  readonly fileId: Source.FileId;
  readonly items: readonly Item[];
  readonly symbols: readonly Symbol[];
  readonly unions: readonly Union[];
  readonly records: readonly RecordDeclaration[];
  readonly externTypes: readonly ExternTypeDeclaration[];
  readonly comments: readonly Source.Comment[];
  readonly span: Source.Span;
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}

export type Item =
  | ImportItem
  | ExternBlockItem
  | ExternImportItem
  | LetItem
  | VarItem
  | LetPatternItem
  | FunItem
  | TypeAliasItem
  | RecordItem
  | ExceptionItem
  | ConstraintItem
  | HonorItem
  | UnionItem
  | ExprItem
  | ErrorItem;

export type ExternImportItem = Resolved.ExternImportItem;

export interface ExternBlockItem {
  readonly kind: "ExternBlock";
  readonly specifier: string;
  readonly declarations: readonly ExternDeclaration[];
  readonly span: Source.Span;
}

export type ExternDeclaration =
  | ExternFunDeclaration
  | ExternLetDeclaration
  | ExternTypeDeclaration;

interface ExternDeclarationFields {
  readonly exported: boolean;
  readonly default: boolean;
  readonly foreignName?: string;
  readonly localName: string;
  readonly span: Source.Span;
}

export interface ExternFunDeclaration extends ExternDeclarationFields {
  readonly kind: "ExternFun";
  readonly binding: Binding;
  readonly parameters: readonly Binding[];
  readonly result: Type;
}

export interface ExternLetDeclaration extends ExternDeclarationFields {
  readonly kind: "ExternLet";
  readonly binding: Binding;
  readonly type: Type;
}

export interface ExternTypeDeclaration extends ExternDeclarationFields {
  readonly kind: "ExternType";
  readonly default: false;
  readonly externType: Resolved.ExternTypeId;
}

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
  readonly nameSpan: Source.Span;
  readonly pattern: Pattern;
  readonly span: Source.Span;
}

export interface ConstructorPattern {
  readonly kind: "Constructor";
  readonly symbol: Resolved.SymbolId;
  readonly text: string;
  readonly nameSpan: Source.Span;
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

export interface TypeAliasItem {
  readonly kind: "TypeAlias";
  readonly exported: boolean;
  readonly name: string;
  readonly parameters: readonly TypeVariableId[];
  readonly type: Type;
  readonly span: Source.Span;
}

export interface Union {
  readonly id: Resolved.UnionId;
  readonly name: string;
  readonly parameters: readonly TypeVariableId[];
  readonly derives: readonly string[];
  readonly opaque: boolean;
  readonly representationVisible: boolean;
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
  readonly opaque: boolean;
  readonly union: Resolved.UnionId;
  readonly name: string;
  readonly parameters: readonly TypeVariableId[];
  readonly derives: readonly string[];
  readonly constructors: readonly Constructor[];
  readonly span: Source.Span;
}

export interface RecordDeclaration {
  readonly id: Resolved.RecordId;
  readonly name: string;
  readonly parameters: readonly TypeVariableId[];
  readonly derives: readonly string[];
  readonly opaque: boolean;
  readonly representationVisible: boolean;
  readonly constructor: Binding;
  readonly fields: readonly { readonly name: string; readonly type: Type; readonly span: Source.Span }[];
  readonly span: Source.Span;
}

export interface RecordItem extends RecordDeclaration {
  readonly kind: "RecordDeclaration";
  readonly exported: boolean;
  readonly record: Resolved.RecordId;
}

export interface ExceptionItem {
  readonly kind: "Exception";
  readonly exported: boolean;
  readonly binding: Binding;
  readonly slots: readonly ConstructorSlot[];
  readonly span: Source.Span;
}

export interface ConstraintItem {
  readonly kind: "ConstraintDeclaration";
  readonly name: string;
  readonly subject: TypeVariableId;
  readonly superconstraints: readonly ConstraintName[];
  readonly impliedTypes: readonly ConstraintImpliedType[];
  readonly members: readonly ConstraintMemberDeclaration[];
  readonly span: Source.Span;
}

export interface ConstraintImpliedType {
  readonly name: string;
  readonly type: Type;
  readonly span: Source.Span;
}

export interface ConstraintMemberDeclaration {
  readonly binding: Binding;
  readonly parameters: readonly Binding[];
  readonly result: Type;
  readonly defaultValue?: LambdaExpr;
  readonly span: Source.Span;
}

export interface HonorItem {
  readonly kind: "Honor";
  readonly constraint: string;
  readonly typeParameters: readonly HonorTypeParameter[];
  readonly subject: Type;
  readonly derived: boolean;
  readonly dictionary: string;
  readonly superconstraints: readonly Constraint[];
  readonly impliedTypes: readonly HonorImpliedType[];
  readonly members: readonly HonorMember[];
  readonly span: Source.Span;
}

export interface HonorTypeParameter {
  readonly name: string;
  readonly variable: TypeVariableId;
  readonly constraints: readonly ConstraintName[];
  readonly span: Source.Span;
}

export interface HonorImpliedType {
  readonly name: string;
  readonly type: Type;
  readonly span: Source.Span;
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
  readonly type: Type;
  readonly span: Source.Span;
}

export type Expr =
  | NameExpr
  | UnitExpr
  | BooleanExpr
  | FromIntExpr
  | WidenIntExpr
  | BigIntExpr
  | FloatExpr
  | StringExpr
  | VectorExpr
  | TupleExpr
  | RecordExpr
  | GroupExpr
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
  | AccessExpr
  | SeqOperationExpr
  | IndexExpr
  | HashExpr
  | CollectionOperationExpr
  | PrimitiveOperationExpr
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
  /** Companion dot calls consume their subject before presenting this callable. */
  readonly receiverBound?: boolean;
}

export interface SeqOperationExpr extends ExpressionFields {
  readonly kind: "SeqOperation";
  readonly operation: "iterate" | "map" | "filter" | "take";
  /** Companion dot calls consume their subject before presenting this callable. */
  readonly receiverBound?: boolean;
}

export interface UnitExpr extends ExpressionFields {
  readonly kind: "Unit";
}

export interface BooleanExpr extends ExpressionFields {
  readonly kind: "Boolean";
  readonly value: boolean;
}

/** An integer literal with its explicit `Signed.fromInt` requirement. */
export interface FromIntExpr extends ExpressionFields {
  readonly kind: "FromInt";
  readonly decimal: string;
  readonly requirement: Constraint;
}

/** A contextual, exact `Int -> a` injection through established `Signed<a>` evidence. */
export interface WidenIntExpr extends ExpressionFields {
  readonly kind: "WidenInt";
  readonly value: Expr;
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

export interface VectorExpr extends ExpressionFields {
  readonly kind: "Vector";
  readonly elements: readonly Expr[];
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
  readonly iteration?: Constraint;
}

export interface RangeExpr extends ExpressionFields {
  readonly kind: "Range";
  readonly start: Expr;
  readonly end: Expr;
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
  readonly requirements: readonly Constraint[];
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
  readonly operation?: "VectorElement" | "VectorSlice" | "StringElement" | "StringSlice" | "MapElement";
  readonly requirements?: readonly Constraint[];
}

export interface HashExpr extends ExpressionFields {
  readonly kind: "Hash";
  readonly value: Expr;
  readonly requirement: Constraint;
}

export interface CollectionOperationExpr extends ExpressionFields {
  readonly kind: "CollectionOperation";
  readonly collection: "Map" | "Set" | "Vector";
  readonly operation: string;
  readonly requirements: readonly Constraint[];
}

/** A checked compiler-known operation in a primitive type's companion. */
export interface PrimitiveOperationExpr extends ExpressionFields {
  readonly kind: "PrimitiveOperation";
  readonly primitive: "Int" | "BigInt" | "Float";
  readonly operation: "div" | "mod" | "quot" | "rem" | "gcd" | "lcm";
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
