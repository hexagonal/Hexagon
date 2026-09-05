/**
 * Parsed syntax records grammatical structure without resolving names or
 * attaching types. The first-round tree covers the expression-and-binding
 * slices implemented by the parser; recovery nodes preserve useful
 * structure after syntax errors without pretending invalid input is valid.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type { Documentation } from "../../support/documentation.js";
import type { ForeignLiteral } from "../../support/foreign-literal.js";

/**
 * A module's declared name — the header's own text (Modules §2.1, #829).
 *
 * Dotted names are one name, not a path: `text` is the whole spelling
 * (`Render.Geometry`) and `segments` its uppercase-start parts, which the
 * first-segment rule (Modules §2.2) reads and nothing else does.
 *
 * `declared` is false for the name a **headerless** file recovers under — the
 * basename derivation the fixit offers (§2.1). The derivation serves the fixit
 * only; a false flag is how every later pass knows the file said nothing.
 */
export interface ModuleName {
  readonly text: string;
  readonly segments: readonly Name[];
  readonly span: Source.Span;
  readonly declared: boolean;
}

/**
 * A refused import head, as `Module.refusedImportAliases` records it: the alias
 * the head's own rewrite would bind, and where the head stands.
 */
export interface RefusedImportHead {
  readonly alias: string;
  readonly span: Source.Span;
}

export interface Module {
  readonly kind: "Module";
  readonly fileId: Source.FileId;
  /**
   * The aliases a **refused import head** would bind under its own rewrite —
   * `Geometry` for `import geometry`, `Geo` for `import geometry as geo`.
   *
   * A refused head is an `ErrorItem`: it binds nothing, so uses below it draw
   * Modules §5.1 rule 1's unbound-alias report. What that report must not do is
   * carry an applied edit inserting the same line the head's own rewrite
   * already offers — "that line already offered, and the seats below it carry
   * none" (§5.1). Nothing else can say which line that is: the head is gone
   * from the tree by the time the resolver walks it, and the rewrite's spelling
   * is the parser's own derivation.
   *
   * The head's **span** travels with the alias because §5.1's suppression is
   * positional — *the seats below it* — so a seat has to be able to ask where
   * the head stands, not merely whether one exists.
   */
  readonly refusedImportAliases: readonly RefusedImportHead[];
  /** This module's declared name (Modules §2.1) — its identity (§1). */
  readonly name: ModuleName;
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
  /**
   * The trusted purity claim (`pure fun …`), on a user-written extern
   * (Effects §6.1). Absent is the honest default for the unknown — the impure
   * constant — and the claim is meaningless on an intrinsic row, whose purity
   * comes from intrinsics §4.2's verification instead.
   */
  readonly pure?: true;
  /**
   * The declared-conduit claim (`conduit fun …`), #409's second claim keyword,
   * carried as the span of the word itself so the checker can stand a report on
   * it. It seats one colour variable at the row's outer arrow *and* at every
   * `->?` the signature writes: the row is exactly as effectful as its
   * callbacks, jointly (FFI Part 4 §4.5).
   *
   * One row carries one claim: a row spelling both `pure` and `conduit` records
   * neither, and takes the impure default behind the parser's report.
   */
  readonly conduit?: Source.Span;
  readonly foreignName?: Name;
  readonly localName: Name;
  readonly span: Source.Span;
}

export interface ExternFunDeclaration extends ExternDeclarationFields {
  readonly kind: "ExternFun";
  /**
   * The declared binders, present only inside the reserved boundary (#370,
   * `spec/intrinsics.md` §3.4): an intrinsic row may carry constraint brackets,
   * and the bounds are what make it an ordinary constrained function. A foreign
   * extern is refused before this is recorded, so the field is a boundary fact
   * as much as a syntactic one.
   *
   * Absent when the row wrote no brackets — the common case, and the only one
   * before #370.
   */
  readonly typeParameters?: readonly TypeParameter[];
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
  /**
   * The members a `widens` declaration names at its head (Constraints §4.7,
   * #546) — present exactly on a `widens` item, absent on every `let`.
   *
   * A `widens` declaration *is* a module-level term binding, so it takes the
   * binding item's shape rather than one of its own; what marks it is this
   * field and the name, which is **derived** from the last segment of the paths
   * rather than written. `name` therefore has no leading spelling to point at
   * and carries the member path's own span.
   */
  readonly widens?: readonly WidensTarget[];
  readonly span: Source.Span;
}

/**
 * One `Alias.member` path at a `widens` head (Constraints §4.7).
 *
 * The qualification is a **module alias** — the only kind there is (§2.2: no
 * constraint-specific namespace exists) — which is what lets the reach doctrine
 * self-enforce where no alias is in scope.
 */
export interface WidensTarget {
  readonly module: Name;
  readonly member: Name;
  readonly span: Source.Span;
}

/**
 * An `import` names a module and binds it, and nothing smaller (Modules §3,
 * #762, #829). One binding form reaches this tree — `import Geometry`,
 * `import Render.Geometry as Geo` — so the item carries the written module
 * name and the alias directly and there is no form to discriminate: the path
 * form, the named list, the namespace glob, the former `import module` head,
 * and the effect import are all refused in the parser, and none of them
 * survives as a shape a later pass has to read.
 *
 * There is no specifier. A module's name is its identity (Modules §1), and the
 * path of the file holding it means nothing to the language; the specifier the
 * emitter writes is computed from the two modules' names (§11.2).
 */
export interface ImportItem {
  readonly kind: "Import";
  readonly module: ModuleName;
  readonly alias: Name;
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

/**
 * The head of a `fun` block — the keyword alone, or carrying its §4.2 binder
 * list — shared by **reference** across every member the block declares
 * (Functions §7.3, #700).
 *
 * The head binds no name, so `id` is what every later pass groups on: two
 * adjacent blocks are two heads and never one group, which is the whole of the
 * adjacency-run retirement. `typeParameters` is the block's binder list — one
 * list, whose variables are one rigid each, scoped over every member — and is
 * absent on a bare head.
 */
export interface FunBlockHead {
  readonly id: number;
  readonly typeParameters?: readonly TypeParameter[];
  /** The head as written, for the diagnostics that must locate a nameless site. */
  readonly span: Source.Span;
}

export interface FunItem {
  readonly kind: "Fun";
  readonly exported: boolean;
  readonly name: Name;
  readonly value: LambdaExpr;
  /**
   * The block this member was written in, absent on the fused spelling
   * (Functions §7.3). A fused `fun f(…) = …` *is* the one-member block, so
   * absence is a fact about the spelling and never about the semantics — only
   * the diagnostics that name a repair read it.
   */
  readonly block?: FunBlockHead;
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
  /**
   * The **literal `extern enum`** marker (Foreign Enums §2.4): this declaration
   * was written `extern enum T = "up" as Up | …` at module scope, so its
   * constructors carry `literal` values and its runtime representation is those
   * values rather than Unions §6's tagged objects.
   *
   * The form is an ordinary nominal union everywhere the name, the constructor
   * namespace, matching, exhaustiveness and derivation are concerned — which is
   * why it takes the union item's own shape rather than one of its own. Only
   * emission and the `.d.ts` face read this marker.
   */
  readonly externEnum?: true;
  /**
   * The **object-reading** `extern enum`'s foreign source (Foreign Enums §2.1,
   * §3): the block's module specifier and the named export holding the enum
   * object. Present exactly when `externEnum` is set and the declaration was
   * written inside an `extern from` block rather than as §2.4's module-scope
   * literal head — which is what tells the two forms apart everywhere one has
   * to test which it is reading.
   *
   * The constructors of such a declaration carry `foreignName` where a literal
   * enum's carry `literal`; a union has this field exactly when its
   * constructors have that one.
   */
  readonly foreign?: ForeignEnumSource;
  readonly span: Source.Span;
}

/** Where an object-reading `extern enum` reads its members from (§2.1). */
export interface ForeignEnumSource {
  /** The enclosing `extern from` block's module specifier. */
  readonly specifier: string;
  /** The named export holding the enum object — `Key` in `enum Key as Direction`. */
  readonly name: Name;
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
  readonly constraint: ConstraintReference;
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
  /**
   * The member's body, absent exactly on an accounting line (`pow = widened`),
   * whose "RHS" is the contextual keyword rather than an expression
   * (Constraints §4.7). The member itself is then **derived** from the module's
   * `widens` declaration — the resolver's post-pass supplies the lambda — so
   * every later pass still reads one.
   */
  readonly value?: LambdaExpr;
  /** The span of the `widened` keyword on an accounting line (§4.7). */
  readonly widened?: Source.Span;
  readonly span: Source.Span;
}

export interface Constructor {
  readonly name: Name;
  readonly slots: readonly ConstructorSlot[];
  /**
   * The JavaScript value this member names, on a **literal `extern enum`**
   * (Foreign Enums §2.4) and on nothing else. Present on every constructor of
   * such a declaration and absent on every constructor of an ordinary `union`,
   * which is what `UnionItem.externEnum` says once for the whole declaration.
   */
  readonly literal?: ForeignLiteral;
  /**
   * The foreign **property** this member reads, on an object-reading `extern
   * enum` (Foreign Enums §2.1) and on nothing else — `ARROW_UP` in `ARROW_UP as
   * Up`. Present on every constructor of such a declaration, which is what
   * `UnionItem.foreign` says once for the whole declaration; a constructor
   * carries this or `literal`, never both.
   */
  readonly foreignName?: Name;
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

/**
 * A constraint reference as written — `Ord`, or `Geo.Ord` (Modules §3.3) — a
 * `Name` whose `text` carries the whole spelling, dot included, which is what
 * the resolver keys the module-alias lookup on.
 *
 * The one thing the spelling does **not** carry is where the qualifier stops,
 * and Modules §5.1 rule 1's repair is exactly a deletion of it: `Scale.Scale`
 * inside `module Scale` is reported with the qualifier dropped as the applied
 * edit. The text cannot be re-measured for that, because `Geo . Ord` is legal
 * spacing and normalizes to the same eleven characters — so the range the drop
 * deletes is recorded here, by the one place that saw both tokens.
 */
export interface ConstraintReference extends Name {
  /**
   * The qualifier and its dot — the `Geo.` of `Geo.Ord` — or `undefined` where
   * the reference is bare and there is nothing to drop.
   */
  readonly qualification?: Source.Span;
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
  /**
   * The module a qualified constructor pattern reaches through — Modules §3.3's
   * `Geo.Circle(r)`, and the declaring prelude module's own name for a prelude
   * constructor (`Prelude.Less`, `Option.Some(v)`). Absent for the bare form.
   *
   * The escape hatch §5.4's constructor occlusion depends on: a module whose own
   * `union` has taken `Less` over still has to be able to match an `Ordering`.
   */
  readonly qualifier?: Name;
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

/**
 * How a function type's arrow was written (Effects §2). Absent means `->` —
 * the pure constant, and the pure *demand*.
 *
 * `linked` is `->?`: one implicitly quantified effect variable shared across the
 * whole signature. Where the signature has no inlet for it to link to it is not
 * re-read as anything — the else-constant rule is withdrawn (#405) — but
 * refused, at the arrow (§4.4). `constant` is `->!`: the impure constant,
 * always.
 */
export type ArrowEffect = "linked" | "constant";

export interface FunctionType {
  readonly kind: "Function";
  readonly parameters: readonly TypeAnnotation[];
  readonly result: TypeAnnotation;
  /** Absent for `->`; see `ArrowEffect`. */
  readonly effect?: ArrowEffect;
  /** The arrow token itself, so a face fixit can replace exactly it. */
  readonly arrowSpan?: Source.Span;
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
  readonly constraints: readonly ConstraintReference[];
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
  | AscriptionExpr
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

/**
 * `(e: T)` — the ascription expression (Ascription §2.1). One parenthesized
 * *element* carrying a type; a tuple's components each get their own node, so
 * `(a: Int, b)` is a `Tuple` whose first element is an `Ascription`.
 *
 * The node wraps rather than replaces: `expression` is the element exactly as it
 * would have parsed unascribed, and `annotation` is the ordinary annotation
 * grammar's type, so holes and constrained holes arrive here for free. Nothing
 * downstream of the checker sees the node — an ascription erases (§4).
 */
export interface AscriptionExpr {
  readonly kind: "Ascription";
  readonly expression: Expr;
  readonly annotation: TypeAnnotation;
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

/**
 * The same peel, plus the ascription wrapper (Ascription §3): an ascription of a
 * syntactic value is itself a syntactic value, so a rule that asks what the
 * right-hand side *is* must see through it exactly as it sees through grouping
 * parentheses.
 *
 * Kept separate from `unwrapBindingValue` because the resolver *replaces* a
 * binding's value with that peel's result, and an ascription is not a wrapper
 * the resolver may drop — its type still has to be checked. Only the callers
 * that merely *classify* a right-hand side use this one.
 */
export function unwrapSyntacticValue(expression: Expr): Expr {
  let unwrapped = unwrapBindingValue(expression);
  while (unwrapped.kind === "Ascription") {
    unwrapped = unwrapBindingValue(unwrapped.expression);
  }
  return unwrapped;
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
  readonly constraints: readonly ConstraintReference[];
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
  /**
   * The match catch expression's clause (Exceptions §5.4, #500): catch arms in
   * `catch`'s second seat, guarding the *scrutinee's evaluation only*. Absent is
   * the ordinary `match`; the arms are `try`'s arms in every respect, so they
   * share `MatchArm` and the whole of §5.2–§5.3.
   */
  readonly catchArms?: readonly MatchArm[];
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

/**
 * A call's effect mark (#355). `bang` is `f!(x)` — effects run here; `question`
 * is `f?(x)` — this call is as effectful as the enclosing instantiation made
 * it. Absent is the bare call: pure, guaranteed.
 */
export type CallMark = "bang" | "question";

export interface CallExpr {
  readonly kind: "Call";
  readonly callee: Expr;
  readonly arguments: readonly Expr[];
  /** #355 ruling 2: the mark sits before *this* argument list. */
  readonly mark?: CallMark;
  readonly markSpan?: Source.Span;
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
  /**
   * A `|>` stage's own mark, when the stage supplied no argument list —
   * `x |> save!` (#355 ruling 1). The pipe rewrite manufactures `save!(x)` and
   * carries it onto the call it creates. Only ever set on a `Pipe`.
   */
  readonly mark?: CallMark;
  readonly markSpan?: Source.Span;
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
