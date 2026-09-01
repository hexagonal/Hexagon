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
  | JsMapType
  | JsSetType
  | JsValueType
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
 * The borrowed view of a native JS `Map` (FFI Part 10 §1): zero-copy, read-only,
 * and faced as `ReadonlyMap<k, v>`. Distinct from `MapType`, the persistent
 * collection — the separation is permanent (Part 10 §1).
 */
export interface JsMapType {
  readonly kind: "JsMap";
  readonly key: Type;
  readonly value: Type;
}

/** The borrowed view of a native JS `Set` (FFI Part 10 §1); faced `ReadonlySet<a>`. */
export interface JsSetType {
  readonly kind: "JsSet";
  readonly element: Type;
}

/**
 * Any JavaScript value, about which Hexagon asserts nothing (FFI Part 11 §2):
 * representation-direct, crossing by identity, faced `unknown` — never `any`.
 * It has no type parameters, no instances, and unifies with itself alone.
 */
export interface JsValueType {
  readonly kind: "JsValue";
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

/**
 * The namespace alias one *occurrence* was written through — `Resolved`'s, ridden
 * into the typed tree so FFI Part 7 §2.4 rung 3 can read it.
 *
 * It rides the type rather than being looked up from the annotation syntax, so a
 * declaration the compiler **derives** rather than renders — a fundamental
 * specialization, a constructor arrow, a stable export wrapper — inherits the
 * qualifiers of the scheme it came from: they survive substitution because
 * substitution rebuilds a nominal node's *arguments* and keeps the node.
 */
export type TypeQualifier = Resolved.TypeQualifier;

export interface UnionType {
  readonly kind: "Union";
  readonly union: Resolved.UnionId;
  readonly name: string;
  readonly arguments: readonly Type[];
  /** See `TypeQualifier`; absent for an occurrence the source wrote bare. */
  readonly qualifier?: TypeQualifier;
}

export interface NominalRecordType {
  readonly kind: "NominalRecord";
  readonly record: Resolved.RecordId;
  readonly name: string;
  readonly arguments: readonly Type[];
  /** See `TypeQualifier`; absent for an occurrence the source wrote bare. */
  readonly qualifier?: TypeQualifier;
}

export interface ExternType {
  readonly kind: "ExternType";
  readonly externType: Resolved.ExternTypeId;
  readonly name: string;
  /** See `TypeQualifier`; absent for an occurrence the source wrote bare. */
  readonly qualifier?: TypeQualifier;
}

/**
 * A function type's effect (`spec/effects.md` §2), absent exactly where the
 * arrow is the pure constant. `"impure"` is what `->!` wears, and what §4.4's
 * recovery leaves behind where a `->?` was refused; a variable is the implicitly
 * quantified colour a linked `->?` shares, and it is quantified in the enclosing
 * scheme like any other type variable (§3.4).
 */
export type Effect = "impure" | { readonly variable: TypeVariableId };

export interface FunctionType {
  readonly kind: "Function";
  readonly parameters: readonly Type[];
  readonly result: Type;
  readonly effect?: Effect;
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
  /**
   * Set when the checker has already **reported** this requirement as
   * unsatisfied. Emission needs no evidence for it and must invent none: the
   * program is erroneous, one diagnostic already says so, and a second one
   * describing the missing dictionary would be the same failure told twice
   * (#344 — with every primitive's instances in source, a primitive
   * requirement that reaches emission without a dictionary is exactly this
   * case).
   */
  readonly unsatisfied?: boolean;
  readonly evidenceConstraint?: ConstraintName;
  /**
   * The same binder as `evidenceConstraint`, addressed by its declaration
   * rather than by its spelling. Set and unset together with it.
   *
   * The name reaches a reader; the identity reaches the evidence parameter. A
   * word is not a property of a constraint at a module border, so a route
   * published as a name alone lands two unrelated declarations on one seat
   * wherever a caller can see both.
   */
  readonly evidenceConstraintIdentity?: string;
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
  /**
   * Exception declarations in scope here that this module did not write (#469);
   * see `Resolved.Module.visibleExceptions`. Carried past the checker because
   * emission needs it too: a catch arm's tag test is the `$hex`/`name` one only
   * where the pattern is known to be an exception's, and a constructor whose
   * declaration did not cross compiles to a union tag comparison no thrown value
   * ever satisfies.
   */
  readonly visibleExceptions: readonly ExceptionItem[];
  readonly externTypes: readonly ExternTypeDeclaration[];
  readonly comments: readonly Source.Comment[];
  /**
   * Documentation attached to this module's declarations
   * (`spec/doc-comments.md` §4), keyed by the documented declaration's
   * span start. Metadata: no pass between the parser and emission reads
   * it, and none may branch on it.
   */
  readonly docs: readonly Documentation[];
  /**
   * Every type hole this module wrote, with what it was filled with.
   *
   * Hover is a hole's only reporting channel (`decisions-ml-dialect-annotations-2026-08.md`
   * §7) and a hole is not a name, so the occurrence index cannot answer about
   * one. Metadata, like `docs`: nothing between here and emission reads it.
   */
  readonly typeHoles: readonly TypeHole[];
  /**
   * The companion operations this module's dot calls reached in a module it
   * never textually imported (Method Syntax §8.2, #585). Empty for almost every
   * module.
   *
   * §4.2's operation set is import-insensitive, so a dot call can resolve to a
   * declaration no import here binds a name for — and then "the emitter adds
   * whatever dependency the resolved declaration's lowering requires". This is
   * the checker telling it which, because the checker is the pass that resolved
   * the call and the only one that knows where the operation lives.
   */
  readonly companionImports: readonly CompanionImport[];
  readonly span: Source.Span;
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}

/**
 * One companion operation a dot call reached with no import to name it by, and
 * everything emission needs to write that import (Method Syntax §8.2, #585).
 *
 * Everything here is the *exporting* module's, carried rather than looked up:
 * an operation that no import brought is an operation whose module is in no
 * table on this side either.
 */
export interface CompanionImport {
  readonly symbol: Resolved.SymbolId;
  /** The name the home module declared it under — its source spelling. */
  readonly imported: string;
  /** The specifier this module reaches the home module by (Modules §11). */
  readonly specifier: string;
  /**
   * Whether the operation is a constrained binding, whose exported face is the
   * trailing-evidence one under an internal spelling (FFI Part 7 §7). Read from
   * the exporter's published scheme; an importer's usual source for this is the
   * symbol table, which by construction does not hold this symbol.
   */
  readonly constrained: boolean;
  /**
   * The home module's internal export spellings, exactly as an `Import` item
   * carries them (`Resolved.ImportItem.internalNames`) and read by the same
   * rule, so a written import and a synthesized one cannot disagree about what
   * the exporter published.
   */
  readonly internalNames: Resolved.InternalNameInputs;
}

/**
 * A `_` in an annotation and the type it elaborated to, generalized over
 * whatever variables survived at the binding — so a hole nothing fixed reads as
 * the variable it is rather than as an internal identity.
 */
export interface TypeHole {
  readonly span: Source.Span;
  readonly scheme: Scheme;
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
  /** The local spelling, for display; `tag` is the declared name (#468). */
  readonly text: string;
  readonly tag: string;
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
  /** The declaring module's brand identity (#488); see `Resolved.ExceptionItem`. */
  readonly owner: string;
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
  readonly baseConstraints: readonly DeclaredBaseConstraint[];
  readonly impliedTypes: readonly ConstraintImpliedType[];
  readonly members: readonly ConstraintMemberDeclaration[];
  readonly span: Source.Span;
}

/**
 * One entry of a constraint declaration's base list, in both currencies
 * (§5.1.1): the word this declaration's own module wrote, and the identity that
 * word denoted **there**.
 *
 * A base constraint is a name in the declaring module's scope, so a reader that
 * holds only the name can do nothing safe with it — `constraint Loud<a:
 * Describe>` says nothing about what an importer spells `Describe`, and §6.2
 * mints the base's dictionary slot from the *declaration* the name denoted, not
 * from the name. `Resolved.ConstraintItem` has carried the pairing since #276;
 * this closes the same gap on the Typed tree, where an honor header's binder
 * constraints already carry it (`HonorParameterConstraint`).
 *
 * **Completeness of the published tree, and currently unread.** The cross-module
 * channel that carries the pairing in anger is the Resolved one — a declaration
 * travels through `Module.visibleConstraints` and reaches the checker's
 * `#constraintsByIdentity` as a `Resolved.ConstraintItem`, whose
 * `baseConstraintIdentities` is what `#baseConstraintsOf` reads. The field here
 * exists so that the Typed tree does not publish a base list a consumer could
 * only re-derive an identity for; if one ever does read it, it reads the pairing
 * rather than inventing it. Whoever finds it unused should confirm that is still
 * true before deleting it, and should not "simplify" it back to a bare name.
 */
export interface DeclaredBaseConstraint {
  readonly name: ConstraintName;
  readonly identity: string;
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
  /** Constraints §6.1's member seats, named in the resolver; see `Resolved.MemberSeat`. */
  readonly memberSeats: readonly Resolved.MemberSeat[];
  readonly baseConstraints: readonly HonorBaseConstraint[];
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
  readonly constraints: readonly HonorParameterConstraint[];
  readonly span: Source.Span;
}

/**
 * One constraint written on an instance head's binder, carrying both currencies
 * (§5.1.1): the declaration's own spelling, which names the evidence parameter,
 * and the declaration's identity, which is what that parameter is found by.
 *
 * A header can only spell constraints in scope where it is written, so the
 * declaring module's resolution is the authority for the pairing.
 */
export interface HonorParameterConstraint {
  readonly name: ConstraintName;
  readonly identity: string;
}

/**
 * One base-constraint obligation an instance discharges, paired with the
 * **dictionary slot** it fills (Constraints §6.2).
 *
 * The slot rides here rather than being recomputed at the write side, because
 * it is not a property of this requirement at all: it is minted from the
 * *extending declaration's* base list, positionally, and the reader of the slot
 * — an entailment projection in some other module — mints it from that same
 * list. Handing emission a name to lowercase is exactly what let the two sides
 * come apart, an importer's alias moving one and not the other (#718).
 */
export interface HonorBaseConstraint {
  readonly slot: string;
  readonly constraint: Constraint;
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
  | AscriptionExpr
  | BlockExpr
  | LambdaExpr
  | IfExpr
  | WhileExpr
  | ForExpr
  | MatchExpr
  | TryExpr
  | ThrowExpr
  | CallExpr
  | AccessExpr
  | IndexExpr
  | HashExpr
  | CollectionOperationExpr
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

/**
 * `(e: T)` (Ascription §2.1). It survives to here so the analysis layer can find
 * an ascription by span; the elaborator then erases it, and no Core node, emitted
 * expression, or `.d.ts` entry records that it was written (§4).
 */
export interface AscriptionExpr extends ExpressionFields {
  readonly kind: "Ascription";
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
  /** The match catch clause's arms (Exceptions §5.4, #500); absent is a plain `match`. */
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
  readonly requirements: readonly Constraint[];
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

/**
 * `Node` alone since the Map/Set arc closed (#373) — see the resolved tree's
 * note. `requirements` is accordingly always empty today: it existed for the
 * companion rows' `<k: Hash>`/`<a: Hash>` obligations, and the four `Node`
 * operations have none. It stays because the checker records requirements for
 * every expression kind uniformly, not because this one can carry any.
 */
export interface CollectionOperationExpr extends ExpressionFields {
  readonly kind: "CollectionOperation";
  readonly collection: "Node";
  readonly operation: string;
  readonly requirements: readonly Constraint[];
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
