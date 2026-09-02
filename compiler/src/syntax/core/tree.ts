/**
 * Core syntax is a small typed semantic representation for emission. Surface
 * grouping and overloadable operators are absent; constraint operations and
 * their selected evidence are explicit.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type { Documentation } from "../../support/documentation.js";
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
  /**
   * The identity of the constraint this evidence **answers** (`spec/constraints.md`
   * §5.1.1) — the *demanded* one, which `constraint` below is merely the
   * provider of where entailment supplied it.
   *
   * Carried because nothing else on the node says which constraint it is for.
   * `<a: (Eq, Show)>` raises two dictionary parameters over one variable and
   * writes the same node for both; only the use site tells them apart, which is
   * enough for `#emitEvidence` — the use site is what calls it — and not enough
   * for the specialization planner, which reads an edition's body with no use
   * site in hand and has to know which instance the parameter becomes (#679).
   *
   * Identity rather than name, because a name is not a property of a constraint
   * at a module border: two modules may each declare a `Describe`, and an
   * import may rename one.
   */
  readonly constraintIdentity: string;
  readonly constraint?: Typed.ConstraintName;
  /**
   * The identity of the constraint whose *binder* this evidence is read out of,
   * where entailment supplied the demand — the provider `constraint` above
   * spells. Absent exactly when `constraint` is, the demand then being a binder
   * of its own and answered by its own identity.
   *
   * Both halves travel because they answer different questions. The name is
   * what a report prints; the identity is what selects the evidence parameter,
   * and only the identity can, two modules being free to spell one word over
   * two unrelated declarations.
   */
  readonly providerIdentity?: string;
  readonly path?: readonly string[];
}

export interface ErrorEvidence {
  readonly kind: "Error";
}

export interface InstanceEvidence {
  readonly kind: "Instance";
  readonly dictionary: string;
  readonly arguments: readonly EvidenceArgument[];
  /**
   * The primitive this instance is honored at, when its subject is one (#344).
   *
   * Carried so that emission can keep doing what Constraints §6.1 calls
   * *inlining of the door-backed slots*: `a + b` at `BigInt` is `Num<BigInt>`'s
   * `add` selected by coherence, and the monomorphic lowering tables (Primitive
   * Types §7; Operators) render that selection as the operator rather than as a
   * slot read. That is quality-of-implementation over one implementation, never
   * a second definition — a *materialized* dictionary still comes from the
   * source instance, which is why the field marks the evidence rather than
   * replacing it.
   *
   * Absent for every nominal subject, and absent for the primitives still
   * compiler-wired, whose evidence is `PrimitiveEvidence` outright.
   */
  readonly primitive?: Typed.PrimitiveName;
}

export interface StructuralEvidence {
  readonly kind: "Structural";
  readonly type: Typed.Type;
  /**
   * The evidence the checker selected for each direct component of `type`
   * (#278, `spec/products.md` §2.5's implementer note). Emission renders these
   * instead of re-walking `type`, so a nominal component is reached through its
   * own instance — hand-written or derived — and never through its
   * representation. Nested structural components recurse: the element of
   * `Vector((Metre, Int))` is itself `Structural`, with its own components.
   *
   * Empty where the type raised no component demand: the `Bool` pin, and
   * `Concat<Vector(a)>`. Also empty on the evidence the emitter synthesizes for
   * a `Set`/`Map` sub-dictionary, which is `Hash`-shaped and so licensed to
   * walk structurally.
   */
  readonly components: readonly EvidenceComponent[];
}

/** One direct component's evidence, keyed by its position in the container. */
export interface EvidenceComponent {
  /** The component's position: a tuple index, a field name, `element`, … */
  readonly key: string;
  readonly evidence: Evidence;
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
  /** Prelude-supplied record identities by name; see `Resolved.Module`. */
  readonly preludeRecords: ReadonlyMap<string, Resolved.RecordId>;
  /**
   * Prelude-supplied union identities by name; see `Resolved.Module`. Emission
   * needs `Bool` from here (#147) to apply the representation pin: it is the one
   * union whose values are the JS `boolean` rather than the §6.2 string form.
   */
  readonly preludeUnions: ReadonlyMap<string, Resolved.UnionId>;
  /**
   * Prelude-visible instances (#153); see `Resolved.Module`. Emission reads this
   * as a *candidate* set, never an obligation: an entry becomes an `import` line
   * only where the elaborated items below actually name its `localDictionary`.
   * That is what makes this channel free — a module that merely has `Ordering` in
   * scope emits nothing for it.
   */
  readonly preludeInstances: readonly Resolved.PreludeInstance[];
  /**
   * Prelude-visible nominal types (#227); see `Resolved.Module`. Read the same
   * way as `preludeInstances`: a *candidate* set, never an obligation. The
   * declaration emitter turns an entry into an `import type` line only where a
   * rendered face carries its identity, so a module that merely has `Option` in
   * scope emits nothing for it.
   */
  readonly preludeTypeImports: readonly Resolved.PreludeTypeImport[];
  /**
   * Exception declarations in scope here that this module did not write (#469);
   * see `Resolved.Module.visibleExceptions`. Emission reads it exactly as it
   * reads this module's own `Exception` items — to recognise a catch arm's
   * constructor and to name its payload fields — and for nothing else: no entry
   * emits a declaration, a runtime value, or an import.
   */
  readonly visibleExceptions: readonly Typed.ExceptionItem[];
  readonly externTypes: readonly Typed.ExternTypeDeclaration[];
  readonly comments: readonly Source.Comment[];
  /**
   * Documentation attached to this module's declarations
   * (`spec/doc-comments.md` §4), keyed by the documented declaration's
   * span start. Metadata: no pass between the parser and emission reads
   * it, and none may branch on it.
   */
  readonly docs: readonly Documentation[];
  /**
   * Companion operations reached with no import to name them by (Method Syntax
   * §8.2, #585); see `Typed.Module.companionImports`. Emission reads it as an
   * *obligation* rather than a candidate set, unlike the prelude channels above:
   * the checker records an entry only where a dot call resolved to it, so an
   * entry is a name the rendered body will reach and an import the emitted file
   * must carry or fail at load.
   */
  readonly companionImports: readonly Typed.CompanionImport[];
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

export type ExternBlockItem = Typed.ExternBlockItem;
export type ExternImportItem = Typed.ExternImportItem;

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
  readonly pattern: Pattern;
  readonly span: Source.Span;
}

export interface ConstructorPattern {
  readonly kind: "Constructor";
  readonly symbol: Resolved.SymbolId;
  /**
   * The declared name, and the only spelling emission may test: nothing past
   * the checker has a reader to show a local spelling to.
   */
  readonly tag: string;
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

export type TypeAliasItem = Typed.TypeAliasItem;

export interface Union {
  readonly id: Resolved.UnionId;
  readonly name: string;
  readonly parameters: readonly Typed.TypeVariableId[];
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
  readonly type: Typed.Type;
  readonly span: Source.Span;
}

export interface UnionItem {
  readonly kind: "Union";
  readonly exported: boolean;
  readonly opaque: boolean;
  readonly union: Resolved.UnionId;
  readonly name: string;
  readonly parameters: readonly Typed.TypeVariableId[];
  readonly constructors: readonly Constructor[];
  readonly span: Source.Span;
}

export type RecordDeclaration = Typed.RecordDeclaration;

export interface RecordItem extends Typed.RecordItem {}
export interface ExceptionItem extends Typed.ExceptionItem {}
/**
 * Constraint declarations reach Core with their **default bodies elaborated**,
 * because for an exported constraint that body is emitted here — hoisted once as
 * a helper (Constraints §6.5) rather than copied into every honoring dictionary.
 */
export interface ConstraintItem extends Omit<Typed.ConstraintItem, "members"> {
  readonly members: readonly ConstraintMemberDeclaration[];
}

export interface ConstraintMemberDeclaration
  extends Omit<Typed.ConstraintMemberDeclaration, "defaultValue"> {
  readonly defaultValue?: LambdaExpr;
}
export interface HonorItem {
  readonly kind: "Honor";
  readonly constraint: string;
  /**
   * The identity of the constraint declaration this instance answers (§5.1.1);
   * see `Typed.HonorItem`. `constraint` is the spelling, this is what coherence
   * compared — and what an edition's evidence looks this instance up by, since
   * a spelling is not a property of a constraint at a module border (#679).
   */
  readonly constraintIdentity: string;
  readonly typeParameters: readonly Typed.HonorTypeParameter[];
  readonly subject: Typed.Type;
  readonly derived: boolean;
  /** The emitted `const`'s name (Dictionary Sharing §5). */
  readonly dictionary: string;
  /** The interface spelling to re-export it under, where §8 moves them apart. */
  readonly exportedDictionary?: string;
  /**
   * Constraints §6.1's member seats, named in the resolver; see
   * `Resolved.MemberSeat`. Empty for a parameterized instance and for one whose
   * constraint declaration was not in view, both of which emit their members
   * inline in the record.
   */
  readonly memberSeats: readonly Resolved.MemberSeat[];
  readonly baseConstraints: readonly HonorBaseConstraint[];
  /**
   * For a derived instance, the evidence for each component of the subject —
   * the record's fields, or every constructor slot of the union (#278). The
   * derived body expands the subject one level and renders each component from
   * here. Empty for a hand-written instance, which has a body.
   */
  readonly components: readonly EvidenceComponent[];
  readonly impliedTypes: readonly Typed.HonorImpliedType[];
  readonly members: readonly HonorMember[];
  /** The constraint declaration's subject variable; see `Typed.HonorItem`. */
  readonly constraintSubject?: Typed.TypeVariableId;
  /** Defaults filled by reference to the home module's helper (§6.5). */
  readonly inheritedDefaults: readonly Typed.InheritedDefault[];
  readonly span: Source.Span;
}

export interface HonorBaseConstraint {
  /**
   * The dictionary slot this base fills (Constraints §6.2), minted by the
   * checker from the extending declaration's base list and carried here
   * verbatim. Emission writes it as the property key and derives nothing from
   * `name`, which is a *report* spelling only — it labels the evidence being
   * rendered, and the two are not the same currency (#718).
   */
  readonly slot: string;
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
  | UnitExpr
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
  | ConvertNatExpr
  | WidenNatExpr
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
  /** See `Resolved.NameExpr.emitted`: the spelling emission must use, where it differs. */
  readonly emitted?: string;
  /**
   * Evidence this value reference must close over; see `Typed.NameExpr`. Present
   * only on references that are *not* call callees, so emission can tell "apply
   * evidence here" from "the enclosing call will".
   */
  readonly evidence?: readonly CallEvidence[];
}

export interface UnitExpr extends ExpressionFields {
  readonly kind: "Unit";
}

// #147: no `BooleanExpr`. `True`/`False` are constructor *names*, so they are
// ordinary `Name` references; the reserved words `true`/`false` never reach a tree.
/** A concrete Int/Float representation of a source integer literal. */
export interface NumberExpr extends ExpressionFields {
  readonly kind: "Number";
  readonly decimal: string;
  readonly representation: "Nat" | "Int" | "Float";
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
  readonly operation:
    | "VectorElement"
    | "VectorSlice"
    | "StringElement"
    | "StringSlice"
    | "MapElement"
    | "ArrayElement";
  readonly hashEvidence?: Evidence;
}

export interface HashExpr extends ExpressionFields {
  readonly kind: "Hash";
  readonly value: Expr;
  readonly evidence: Evidence;
}

/**
 * `Node` alone since the Map/Set arc closed (#373) — see the resolved tree's
 * note. The `hashEvidence` field went with the companion rows: the four `Node`
 * operations are unconstrained, so there was never anything left to carry.
 */
export interface CollectionOperationExpr extends ExpressionFields {
  readonly kind: "CollectionOperation";
  readonly collection: "Node";
  readonly operation: string;
}

/** A non-representationally-trivial `Num.fromNat` application. */
export interface ConvertNatExpr extends ExpressionFields {
  readonly kind: "ConvertNat";
  readonly decimal: string;
  readonly evidence: Evidence;
}

/** An explicit contextual `Num.fromNat(value)` selected during checking. */
export interface WidenNatExpr extends ExpressionFields {
  readonly kind: "WidenNat";
  readonly value: Expr;
  readonly evidence: Evidence;
}

/** An explicit contextual `Signed.fromInt(value)` selected during checking. */
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
  readonly alternative: Expr;
  // See Parsed.IfExpr: set when the source omitted `else` (`else ()` sugar).
  // The emitter erases the inserted branch instead of emitting a synthetic
  // `else` (Operators §11.4).
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
  /**
   * The match catch clause's arms (Exceptions §5.4, #500). Emission narrows the
   * JS `try` to the scrutinee's evaluation and runs §7.4's discrimination in the
   * JS `catch`; the data arms lower outside it, on the bound scrutinee.
   */
  readonly catchArms?: readonly MatchArm[];
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
