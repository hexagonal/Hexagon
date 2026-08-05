/**
 * Typed syntax records the type inferred for every expression and scheme
 * assigned to every binding. Constraint requirements remain explicit so
 * elaboration can later choose a concrete operation or dictionary evidence.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type { Documentation } from "../../support/documentation.js";
import type * as Resolved from "../resolved/index.js";

declare const typeVariableIdBrand: unique symbol;

export type TypeVariableId = number & {
  readonly [typeVariableIdBrand]: "TypeVariableId";
};

// #147: `Bool` is not here. It left the primitive set and became the prelude
// union `False | True` (`stdlib/Bool.hex`), so it is a `UnionType` like any other.
// #159: `Unit` is not here either. It is the empty tuple — the arity-0
// `TupleType` — and the `Unit` spelling is surface syntax the checker maps to
// that type (Products §2.7).
export type PrimitiveName =
  | "Nat"
  | "Int"
  | "Float"
  | "String"
  | "BigInt"
  | "Exn";

export type Type =
  | PrimitiveType
  | RangeType
  | VectorType
  | MapType
  | SetType
  | ArrayType
  | NodeType
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

/**
 * The hidden, fixed-32, immutable runtime trie node (persistent-collections
 * design note §4). Not a user-facing type: it has no annotation syntax and only
 * appears inside runtime modules that build `Vector`/`Map`/`Set` over it.
 */
export interface NodeType {
  readonly kind: "Node";
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
  /**
   * The identity of the constraint declaration demanded (`spec/constraints.md`
   * §5.1.1). Carried on a scheme so that an importing module discharges the
   * requirement against the *declaring* module's constraint rather than
   * against whatever its own source spells with that name.
   */
  readonly identity: string;
  readonly type: Type;
  readonly span: Source.Span;
  readonly dictionary?: string;
  readonly evidenceConstraint?: ConstraintName;
  readonly evidencePath?: readonly string[];
  readonly dictionaryArguments?: readonly Constraint[];
  readonly structural?: boolean;
  /**
   * The constraint the checker resolved for each direct component of a
   * structurally satisfied type (#278, `spec/products.md` §2.5's implementer
   * note). Present exactly when `structural` is, and empty for the `Bool` pin
   * and `Concat<Vector(a)>`, which raise no component demand.
   *
   * Emission renders *these* rather than re-walking the type, so a component
   * with a hand-written instance is reached through that instance. The key is
   * the component's position in its container — a tuple index, a record field
   * name, `element`, `key`, `value`, or `Constructor.field` for a union slot —
   * because the derived `compare` and `show` bodies visit a record's fields in
   * name order while this list is in declaration order.
   */
  readonly components?: readonly ConstraintComponent[];
}

/** One direct component of a structural type, or of a derivation subject. */
export interface ConstraintComponent {
  /** The component's position: a tuple index, a field name, `element`, … */
  readonly key: string;
  readonly constraint: Constraint;
}

export interface Scheme {
  readonly variables: readonly TypeVariableId[];
  readonly constraints: readonly Constraint[];
  readonly type: Type;
  /**
   * Present exactly when this is a **constraint member's** scheme: the identity
   * of the constraint that declares it, and the subject variable it quantifies
   * (Constraints §2.2 — members are module-scope terms carrying the constraint).
   *
   * Carried across the module boundary because an importing module has no other
   * way to know that `describe` is `Describe`'s: without it, instantiating an
   * imported member's scheme projects no implied types (`#instantiate` matches
   * the requirement against `constraint`) and the member's own requirement is
   * just another operation constraint.
   */
  readonly constraint?: SchemeConstraint;
}

/** The constraint a constraint member's scheme belongs to; see `Scheme`. */
export interface SchemeConstraint {
  readonly name: ConstraintName;
  readonly identity: string;
  /** The declaration's subject, as a variable of this scheme. */
  readonly subject: TypeVariableId;
  /** The constraint's implied type members, as variables of this scheme. */
  readonly impliedTypes: readonly SchemeImpliedType[];
}

export interface SchemeImpliedType {
  readonly name: string;
  readonly variable: TypeVariableId;
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
  /** Prelude-supplied record identities by name; see `Resolved.Module`. */
  readonly preludeRecords: ReadonlyMap<string, Resolved.RecordId>;
  /** Prelude-supplied union identities by name; see `Resolved.Module`. */
  readonly preludeUnions: ReadonlyMap<string, Resolved.UnionId>;
  /** Prelude-visible instances (#153); see `Resolved.Module`. */
  readonly preludeInstances: readonly Resolved.PreludeInstance[];
  /** Prelude-visible nominal types (#227, FFI Part 7 §2.4); see `Resolved.Module`. */
  readonly preludeTypeImports: readonly Resolved.PreludeTypeImport[];
  readonly externTypes: readonly ExternTypeDeclaration[];
  readonly comments: readonly Source.Comment[];
  /**
   * Documentation attached to this module's declarations
   * (`spec/doc-comments.md` §4), keyed by the documented declaration's
   * span start. Metadata: no pass between the parser and emission reads
   * it, and none may branch on it.
   */
  readonly docs: readonly Documentation[];
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
  /** Carried from the resolved tree unchanged; see `Resolved.ExternBlockItem`. */
  readonly intrinsic: boolean;
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

// #147: no `BooleanPattern`. `True`/`False` are nullary constructors, so
// they are `ConstructorPattern`s like `None`.
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

/**
 * A declaration's parameter, its written claim, and the variance its
 * representation actually supports (closure doc
 * `decisions-ml-dialect-generalization-2026-08.md` §5, §6).
 *
 * Both are here because the editor shows both: hover on a parameterized opaque
 * type's parameter reports the declared claim *and* the computed variance, and
 * the difference between them is exactly what §8.2's code action offers to
 * close. Nothing downstream of the checker recomputes variance; this is the
 * one channel.
 */
export interface ParameterVariance {
  readonly name: string;
  /** Absent for a bare parameter — the empty claim, which means invariant. */
  readonly declared?: "co" | "contra";
  readonly computed: "unused" | "co" | "contra" | "inv";
  /** The parameter as written, sigil included; absent on a synthesized head. */
  readonly span?: Source.Span;
}

export interface Union {
  readonly id: Resolved.UnionId;
  readonly name: string;
  readonly parameters: readonly TypeVariableId[];
  readonly variance: readonly ParameterVariance[];
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
  readonly variance: readonly ParameterVariance[];
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
  /**
   * `export constraint` (Modules §4.1). Emission reads it: an exported
   * constraint's member forwarders and hoisted default helpers gain ESM exports
   * (Constraints §6.5), and an unexported one emits exactly as before.
   */
  readonly exported: boolean;
  readonly name: string;
  /** This declaration's identity (`spec/constraints.md` §5.1.1). */
  readonly identity: string;
  readonly subject: TypeVariableId;
  readonly baseConstraints: readonly ConstraintName[];
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
  /**
   * The identity of the constraint declaration this instance answers
   * (`spec/constraints.md` §5.1.1), carried through from the Resolved node.
   * `constraint` is the spelling; this is what coherence compared.
   */
  readonly constraintIdentity: string;
  readonly typeParameters: readonly HonorTypeParameter[];
  readonly subject: Type;
  readonly derived: boolean;
  readonly dictionary: string;
  readonly baseConstraints: readonly Constraint[];
  /**
   * For a derived instance, the constraint the checker resolved for each
   * component of the subject — the record's fields, or every constructor slot
   * of the union (#278). Empty for a hand-written instance, which has a body.
   */
  readonly components: readonly ConstraintComponent[];
  readonly impliedTypes: readonly HonorImpliedType[];
  readonly members: readonly HonorMember[];
  /**
   * The declaration's subject variable, when the checker found the declaration.
   *
   * Emission binds the completed dictionary to this variable so that a member
   * body written in the constraint's generic context — an inherited default, or
   * a parameterized instance's own recursive member use — resolves its evidence
   * to the instance under construction. The emitter used to look the declaration
   * up in its own module-local table, which silently yielded nothing once the
   * declaration could be an imported one.
   */
  readonly constraintSubject?: TypeVariableId;
  /**
   * Members inherited from an **exported** constraint's defaults
   * (Constraints §6.5): the body was hoisted to one helper at home, and every
   * inheriting instance fills the slot by reference to it rather than by a copy
   * of the body.
   *
   * Separate from `members` because there is no body here to carry — for an
   * imported constraint the checker could not materialize one anyway, the
   * default's expressions having been typed in another module. For an
   * *unexported* constraint this list is empty and the copies stay in `members`,
   * which is what keeps that emission byte-identical.
   */
  readonly inheritedDefaults: readonly InheritedDefault[];
  readonly span: Source.Span;
}

/** One default member filled by reference to its home module's helper (§6.5). */
export interface InheritedDefault {
  readonly name: string;
  /** The constraint member's symbol — the helper's identity at home. */
  readonly member: Resolved.SymbolId;
  /** The default body's source parameter count; the helper takes one more. */
  readonly arity: number;
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
  | FromNatExpr
  | WidenNatExpr
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
  /**
   * Constraints this *value* reference resolved, when the reference is not a
   * call callee. A constrained generic function takes trailing evidence
   * (Constraints §6.1), and a call site supplies it — but a reference in value
   * position is handed on without one, so it must carry its own (defect 4).
   * Absent on callee references, where the enclosing `Call` owns the evidence.
   */
  readonly requirements?: readonly Constraint[];
}

export interface UnitExpr extends ExpressionFields {
  readonly kind: "Unit";
}

// #147: no `BooleanExpr`. `True`/`False` are constructor *names*, so they are
// ordinary `Name` references; the reserved words `true`/`false` never reach a tree.
/** A non-negative integer literal with its explicit `Num.fromNat` requirement. */
export interface FromNatExpr extends ExpressionFields {
  readonly kind: "FromNat";
  readonly decimal: string;
  readonly requirement: Constraint;
}

/** A contextual, exact `Nat -> a` injection through established `Num<a>` evidence. */
export interface WidenNatExpr extends ExpressionFields {
  readonly kind: "WidenNat";
  readonly value: Expr;
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
  readonly alternative: Expr;
  // See Parsed.IfExpr: set when the source omitted `else` (`else ()` sugar).
  // Carried this far so the emitter can erase the inserted branch rather than
  // emit a synthetic `else` (Operators §11.4).
  readonly elseless?: boolean;
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
  readonly collection: "Map" | "Set" | "Node";
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
