/**
 * Parsed syntax records grammatical structure without resolving names or
 * attaching types. The first-round tree covers the expression-and-binding
 * slices implemented by the parser; recovery nodes preserve useful
 * structure after syntax errors without pretending invalid input is valid.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type { Documentation } from "../../support/documentation.js";

export interface Module {
  readonly kind: "Module";
  readonly fileId: Source.FileId;
  readonly items: readonly Item[];
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

export interface ExternBlockItem {
  readonly kind: "ExternBlock";
  readonly specifier: string;
  readonly declarations: readonly ExternDeclaration[];
  readonly span: Source.Span;
}

export interface ExternImportItem {
  readonly kind: "ExternImport";
  readonly specifier: string;
  readonly span: Source.Span;
}

export type ExternDeclaration =
  | ExternFunDeclaration
  | ExternLetDeclaration
  | ExternTypeDeclaration;

interface ExternDeclarationFields {
  readonly exported: boolean;
  readonly default: boolean;
  readonly foreignName?: Name;
  readonly localName: Name;
  readonly span: Source.Span;
}

export interface ExternFunDeclaration extends ExternDeclarationFields {
  readonly kind: "ExternFun";
  readonly parameters: readonly Parameter[];
  readonly returnAnnotation: TypeAnnotation;
}

export interface ExternLetDeclaration extends ExternDeclarationFields {
  readonly kind: "ExternLet";
  readonly annotation: TypeAnnotation;
}

export interface ExternTypeDeclaration extends ExternDeclarationFields {
  readonly kind: "ExternType";
  readonly default: false;
}

export interface LetItem {
  readonly kind: "Let";
  readonly exported: boolean;
  readonly name: Name;
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
  | { readonly kind: "Namespace"; readonly alias: Name }
  | { readonly kind: "Named"; readonly names: readonly ImportName[] };

export interface ImportName {
  readonly imported: Name;
  readonly local: Name;
  readonly span: Source.Span;
}

export interface VarItem {
  readonly kind: "Var";
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

export interface TypeAliasItem {
  readonly kind: "TypeAlias";
  readonly exported: boolean;
  readonly name: Name;
  readonly parameters: readonly Name[];
  readonly annotation: TypeAnnotation;
  readonly span: Source.Span;
}

/**
 * A type parameter as written in a declaration head, sigil included
 * (Declarations Preamble §2.1, Modules §4.2.1; closure doc
 * `decisions-ml-dialect-generalization-2026-08.md` §6.1).
 *
 * `claim` is absent for a bare parameter, and absent is the *empty claim* —
 * invariant. The two spellings must not both exist, or a reader has to ask
 * which one means what (§6.2).
 */
export interface DeclaredTypeParameter {
  readonly name: string;
  readonly claim?: "co" | "contra";
  /** The parameter as written, sigil included, for a report or an edit. */
  readonly span: Source.Span;
}

export interface UnionItem {
  readonly kind: "Union";
  readonly exported: boolean;
  readonly opaque: boolean;
  readonly name: Name;
  readonly parameters: readonly Name[];
  readonly declaredParameters: readonly DeclaredTypeParameter[];
  readonly derives: readonly Name[];
  readonly constructors: readonly Constructor[];
  readonly span: Source.Span;
}

export interface RecordItem {
  readonly kind: "RecordDeclaration";
  readonly exported: boolean;
  readonly opaque: boolean;
  readonly name: Name;
  readonly parameters: readonly Name[];
  readonly declaredParameters: readonly DeclaredTypeParameter[];
  readonly derives: readonly Name[];
  readonly fields: readonly RecordTypeField[];
  readonly span: Source.Span;
}

export interface ExceptionItem {
  readonly kind: "Exception";
  readonly exported: boolean;
  readonly name: Name;
  readonly slots: readonly ConstructorSlot[];
  readonly span: Source.Span;
}

export interface ConstraintItem {
  readonly kind: "ConstraintDeclaration";
  /**
   * `export constraint` (Modules §4.1): the constraint name **and** its members
   * cross. One flag for both, because they are one declaration — §6.5's "an
   * exported constraint crosses as a reference to its declaration".
   */
  readonly exported: boolean;
  readonly name: Name;
  readonly subject: Name;
  readonly baseConstraints: readonly Name[];
  readonly impliedTypes: readonly ConstraintImpliedType[];
  readonly members: readonly ConstraintMember[];
  readonly span: Source.Span;
}

export interface ConstraintImpliedType {
  readonly name: Name;
  readonly span: Source.Span;
}

export interface ConstraintMember {
  readonly name: Name;
  readonly parameters: readonly Parameter[];
  readonly returnAnnotation: TypeAnnotation;
  readonly defaultValue?: LambdaExpr;
  readonly span: Source.Span;
}

export interface HonorItem {
  readonly kind: "Honor";
  readonly constraint: Name;
  readonly typeParameters: readonly TypeParameter[];
  readonly subject: TypeAnnotation;
  readonly derived: boolean;
  readonly impliedTypes: readonly HonorImpliedType[];
  readonly members: readonly HonorMember[];
  readonly span: Source.Span;
}

export interface HonorImpliedType {
  readonly name: Name;
  readonly annotation: TypeAnnotation;
  readonly span: Source.Span;
}

export interface HonorMember {
  readonly name: Name;
  readonly value: LambdaExpr;
  readonly span: Source.Span;
}

export interface Constructor {
  readonly name: Name;
  readonly slots: readonly ConstructorSlot[];
  readonly span: Source.Span;
}

export interface ConstructorSlot {
  readonly name?: Name;
  readonly annotation: TypeAnnotation;
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
  readonly startClass: "non-upper" | "upper";
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
  readonly name: Name;
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
  readonly name: Name;
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
  readonly name: Name;
  readonly pattern: Pattern;
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
  readonly qualifier?: Name;
  readonly name: Name;
  readonly span: Source.Span;
}

export interface AppliedType {
  readonly kind: "AppliedType";
  readonly qualifier?: Name;
  readonly constructor: Name;
  readonly arguments: readonly TypeAnnotation[];
  readonly span: Source.Span;
}

export interface TypeVariable {
  readonly kind: "TypeVariable";
  readonly name: Name;
  readonly span: Source.Span;
}

export interface TupleType {
  readonly kind: "Tuple";
  readonly elements: readonly TypeAnnotation[];
  readonly span: Source.Span;
}

export interface RecordType {
  readonly kind: "Record";
  readonly fields: readonly RecordTypeField[];
  readonly open: boolean;
  readonly tail?: Name;
  readonly span: Source.Span;
}

export interface RecordTypeField {
  readonly name: Name;
  readonly annotation: TypeAnnotation;
  readonly span: Source.Span;
}

export interface FunctionType {
  readonly kind: "Function";
  readonly parameters: readonly TypeAnnotation[];
  readonly result: TypeAnnotation;
  readonly span: Source.Span;
}

/** A type hole, `_` (closure doc `decisions-ml-dialect-annotations-2026-08.md`). */
export interface HoleType {
  readonly kind: "Hole";
  /**
   * The written constraint list of a constrained hole — `_ : Show`,
   * `_ : (Eq, Show)` — empty for a bare `_` (closure doc §4.4). A hole is the
   * only type operand that admits the suffix; the list itself is Functions
   * §4.2's, parsed by the sub-grammar binder lists use.
   */
  readonly constraints: readonly Name[];
  readonly span: Source.Span;
}

export type TypeAnnotation =
  | NamedType
  | AppliedType
  | TypeVariable
  | TupleType
  | RecordType
  | FunctionType
  | HoleType;

export interface Parameter {
  readonly name: Name;
  readonly annotation?: TypeAnnotation;
  readonly span: Source.Span;
}

export type Expr =
  | NameExpr
  | UnitExpr
  | IntegerExpr
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

// #147: no `BooleanExpr`. `True`/`False` are constructor *names*, so they are
// ordinary `Name` references; the reserved words `true`/`false` never reach a tree.
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

export interface VectorExpr {
  readonly kind: "Vector";
  readonly elements: readonly Expr[];
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
  readonly name: Name;
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

/**
 * The expression a binding's right-hand side *means*, with the wrappers that do
 * not change that meaning peeled away: parentheses, which only group, and a
 * layout block whose one item is an expression, which only says the right-hand
 * side was written on the next line.
 *
 * Both wrappers are pure syntax, so every rule that reads what a right-hand side
 * *means* — the value restriction (Functions §8.2), the exported-signature
 * check, the evidence a constrained binding carries, its emitted shape — must
 * read through them, or the same program means two things depending on where it
 * sits on the page (issue #98). Peeling once at each binding site is how they
 * are kept in agreement; a *multi*-item block is left alone, because running its
 * earlier items is evaluation, and evaluation is exactly what the value
 * restriction is about.
 *
 * Not every rule asks what a right-hand side means. Functions §7.1 asks what a
 * `fun`'s right-hand side *is*, because hoisting rests on the written form
 * being a lambda literal; that check runs in the parser and this peel is
 * deliberately kept away from it (issue #113 owns the diagnostic it leaves).
 */
export function unwrapBindingValue(expression: Expr): Expr {
  let unwrapped = expression;
  for (;;) {
    if (unwrapped.kind === "Group") {
      unwrapped = unwrapped.expression;
      continue;
    }
    const only = unwrapped.kind === "Block" && unwrapped.items.length === 1
      ? unwrapped.items[0]
      : undefined;
    if (only?.kind !== "ExprItem") return unwrapped;
    unwrapped = only.expression;
  }
}

export interface LambdaExpr {
  readonly kind: "Lambda";
  readonly parameters: readonly Parameter[];
  readonly typeParameters?: readonly TypeParameter[];
  readonly returnAnnotation?: TypeAnnotation;
  readonly destructurings?: readonly ParameterDestructuring[];
  readonly body: Expr;
  readonly span: Source.Span;
}

/**
 * A pattern parameter: the fresh binder the caller's argument lands in, paired
 * with the pattern that takes it apart. It stays on the *head* rather than
 * being desugared into the body by the parser, because the binders it
 * contributes are head binders (Statements §5, Pattern Matching §6.5) and only
 * the resolver knows the lambda's own scope — the one place where "head binder"
 * is expressible. The resolver opens the body with the equivalent `let` once
 * the binders are classified.
 */
export interface ParameterDestructuring {
  readonly pattern: Pattern;
  readonly name: Name;
  readonly span: Source.Span;
}

export interface TypeParameter {
  readonly name: Name;
  readonly constraints: readonly Name[];
  readonly span: Source.Span;
}

export interface IfExpr {
  readonly kind: "If";
  readonly condition: Expr;
  readonly consequence: Expr;
  readonly alternative: Expr;
  // Set when the source omitted `else`: `alternative` is a synthesized `Unit`
  // (`else ()` sugar, Operators §11.2). The AST always carries both branches.
  readonly elseless?: boolean;
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

export interface TryExpr {
  readonly kind: "Try";
  readonly body: Expr;
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
