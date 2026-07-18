/**
 * Resolved syntax replaces textual references with stable symbol identities.
 * Binding spellings and spans remain for diagnostics and readable later output,
 * but every non-error Name expression identifies exactly one declared symbol.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";

declare const symbolIdBrand: unique symbol;
declare const unionIdBrand: unique symbol;
declare const recordIdBrand: unique symbol;

export type SymbolId = number & { readonly [symbolIdBrand]: "SymbolId" };
export type UnionId = number & { readonly [unionIdBrand]: "UnionId" };
export type RecordId = number & { readonly [recordIdBrand]: "RecordId" };

export type SymbolKind =
  | "let"
  | "var"
  | "fun"
  | "parameter"
  | "pattern"
  | "constructor"
  | "record-constructor"
  | "constraint-member";

export type PrimitiveName =
  | "Int"
  | "Float"
  | "Bool"
  | "String"
  | "BigInt"
  | "Exn"
  | "Unit";

export type TypeAnnotation =
  | PrimitiveTypeAnnotation
  | RangeTypeAnnotation
  | TupleTypeAnnotation
  | RecordTypeAnnotation
  | UnionTypeAnnotation
  | RecordDeclarationTypeAnnotation
  | SeqTypeAnnotation
  | TypeVariableAnnotation
  | AssociatedTypeAnnotation
  | ErrorTypeAnnotation;

export interface PrimitiveTypeAnnotation {
  readonly kind: "Primitive";
  readonly name: PrimitiveName;
  readonly span: Source.Span;
}

export interface RangeTypeAnnotation {
  readonly kind: "Range";
  readonly span: Source.Span;
}

export interface SeqTypeAnnotation {
  readonly kind: "Seq";
  readonly element: TypeAnnotation;
  readonly span: Source.Span;
}

export interface TupleTypeAnnotation {
  readonly kind: "Tuple";
  readonly elements: readonly TypeAnnotation[];
  readonly span: Source.Span;
}

export interface RecordTypeAnnotation {
  readonly kind: "Record";
  readonly fields: readonly RecordTypeField[];
  readonly open: boolean;
  readonly tail?: string;
  readonly span: Source.Span;
}

export interface RecordTypeField {
  readonly name: string;
  readonly annotation: TypeAnnotation;
  readonly span: Source.Span;
}

export interface UnionTypeAnnotation {
  readonly kind: "Union";
  readonly union: UnionId;
  readonly name: string;
  readonly arguments: readonly TypeAnnotation[];
  readonly span: Source.Span;
}

export interface TypeVariableAnnotation {
  readonly kind: "TypeVariable";
  readonly name: string;
  readonly span: Source.Span;
}

export interface AssociatedTypeAnnotation {
  readonly kind: "AssociatedType";
  readonly constraint: string;
  readonly name: string;
  readonly span: Source.Span;
}

export interface RecordDeclarationTypeAnnotation {
  readonly kind: "RecordDeclaration";
  readonly record: RecordId;
  readonly name: string;
  readonly arguments: readonly TypeAnnotation[];
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
  readonly annotation?: TypeAnnotation;
  readonly value: Expr;
  readonly span: Source.Span;
}

export interface ImportItem {
  readonly kind: "Import";
  readonly specifier: string;
  readonly form: ImportForm;
  readonly span: Source.Span;
}

export type ImportForm =
  | { readonly kind: "Effect" }
  | { readonly kind: "Namespace"; readonly alias: string; readonly names: readonly ImportName[] }
  | { readonly kind: "Named"; readonly names: readonly ImportName[] };

export interface ImportName {
  readonly imported: string;
  readonly local: string;
  readonly symbol?: SymbolId;
  readonly span: Source.Span;
}

export interface VarItem {
  readonly kind: "Var";
  readonly binding: Binding;
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
  readonly symbol: SymbolId;
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
  readonly id: UnionId;
  readonly name: string;
  readonly parameters: readonly string[];
  readonly derives: readonly string[];
  readonly span: Source.Span;
  readonly constructors: readonly Constructor[];
}

export interface Constructor {
  readonly binding: Binding;
  readonly slots: readonly ConstructorSlot[];
  readonly span: Source.Span;
}

export interface ConstructorSlot {
  readonly field: string;
  readonly annotation: TypeAnnotation;
  readonly span: Source.Span;
}

export interface UnionItem {
  readonly kind: "Union";
  readonly exported: boolean;
  readonly union: UnionId;
  readonly name: string;
  readonly parameters: readonly string[];
  readonly derives: readonly string[];
  readonly constructors: readonly Constructor[];
  readonly span: Source.Span;
}

export interface RecordDeclaration {
  readonly id: RecordId;
  readonly name: string;
  readonly parameters: readonly string[];
  readonly derives: readonly string[];
  readonly constructor: Binding;
  readonly fields: readonly RecordTypeField[];
  readonly span: Source.Span;
}

export interface RecordItem {
  readonly kind: "RecordDeclaration";
  readonly exported: boolean;
  readonly record: RecordId;
  readonly name: string;
  readonly parameters: readonly string[];
  readonly derives: readonly string[];
  readonly constructor: Binding;
  readonly fields: readonly RecordTypeField[];
  readonly span: Source.Span;
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
  readonly subject: string;
  readonly superconstraints: readonly string[];
  readonly associatedTypes: readonly ConstraintAssociatedType[];
  readonly members: readonly ConstraintMember[];
  readonly span: Source.Span;
}

export interface ConstraintAssociatedType {
  readonly name: string;
  readonly span: Source.Span;
}

export interface ConstraintMember {
  readonly binding: Binding;
  readonly parameters: readonly Parameter[];
  readonly returnAnnotation: TypeAnnotation;
  readonly defaultValue?: LambdaExpr;
  readonly span: Source.Span;
}

export interface HonorItem {
  readonly kind: "Honor";
  readonly constraint: string;
  readonly typeParameters: readonly TypeParameter[];
  readonly subject: TypeAnnotation;
  readonly derived: boolean;
  readonly dictionary: string;
  readonly associatedTypes: readonly HonorAssociatedType[];
  readonly members: readonly HonorMember[];
  readonly span: Source.Span;
}

export interface HonorAssociatedType {
  readonly name: string;
  readonly annotation: TypeAnnotation;
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

export type Expr =
  | NameExpr
  | UnitExpr
  | BooleanExpr
  | IntegerExpr
  | BigIntExpr
  | FloatExpr
  | StringExpr
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

export interface SeqOperationExpr {
  readonly kind: "SeqOperation";
  readonly operation: "iterate" | "map" | "filter" | "take";
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

export interface RecordExpr {
  readonly kind: "Record";
  readonly spread?: Expr;
  readonly fields: readonly RecordField[];
  readonly span: Source.Span;
}

export interface RecordField {
  readonly name: FieldName;
  readonly punned: boolean;
  readonly value: Expr;
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
  readonly typeParameters?: readonly TypeParameter[];
  readonly returnAnnotation?: TypeAnnotation;
  readonly body: Expr;
  readonly span: Source.Span;
}

export interface TypeParameter {
  readonly name: string;
  readonly constraints: readonly string[];
  readonly span: Source.Span;
}

export interface IfExpr {
  readonly kind: "If";
  readonly condition: Expr;
  readonly consequence: Expr;
  readonly alternative?: Expr;
  readonly span: Source.Span;
}

export interface WhileExpr {
  readonly kind: "While";
  readonly condition: Expr;
  readonly body: BlockExpr;
  readonly span: Source.Span;
}

export interface ForExpr {
  readonly kind: "For";
  readonly pattern: Pattern;
  readonly iterable: Expr;
  readonly body: BlockExpr;
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
  readonly guard?: Expr;
  readonly body: Expr;
  readonly span: Source.Span;
}

export interface CallExpr {
  readonly kind: "Call";
  readonly callee: Expr;
  readonly arguments: readonly Expr[];
  readonly span: Source.Span;
}

/** A call to the browser/JavaScript host console's variadic log operation. */
export interface ConsoleLogExpr {
  readonly kind: "ConsoleLog";
  readonly arguments: readonly Expr[];
  readonly span: Source.Span;
}

export interface AccessExpr {
  readonly kind: "Access";
  readonly receiver: Expr;
  readonly field: FieldName;
  readonly span: Source.Span;
}

export interface ThrowExpr {
  readonly kind: "Throw";
  readonly exception: Expr;
  readonly span: Source.Span;
}

export interface TryExpr {
  readonly kind: "Try";
  readonly body: Expr;
  readonly arms: readonly MatchArm[];
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

/** Constructs a checked stable identity for one resolver-owned union. */
export function unionId(value: number): UnionId {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("a union id must be a non-negative safe integer");
  }
  return value as UnionId;
}
