/**
 * Resolved syntax replaces textual references with stable symbol identities.
 * Binding spellings and spans remain for diagnostics and readable later output,
 * but every non-error Name expression identifies exactly one declared symbol.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type { Documentation } from "../../support/documentation.js";

declare const symbolIdBrand: unique symbol;
declare const unionIdBrand: unique symbol;
declare const recordIdBrand: unique symbol;
declare const externTypeIdBrand: unique symbol;

export type SymbolId = number & { readonly [symbolIdBrand]: "SymbolId" };
export type UnionId = number & { readonly [unionIdBrand]: "UnionId" };
export type RecordId = number & { readonly [recordIdBrand]: "RecordId" };
export type ExternTypeId = number & { readonly [externTypeIdBrand]: "ExternTypeId" };

export type SymbolKind =
  | "let"
  | "var"
  | "fun"
  | "parameter"
  | "pattern"
  | "constructor"
  | "record-constructor"
  | "extern"
  | "constraint-member";

// #147: no `Bool`. It is the prelude union `False | True`, resolved like any
// other union name.
export type PrimitiveName =
  | "Nat"
  | "Int"
  | "Float"
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
  | ExternTypeAnnotation
  | VectorTypeAnnotation
  | MapTypeAnnotation
  | SetTypeAnnotation
  | ArrayTypeAnnotation
  | JsMapTypeAnnotation
  | JsSetTypeAnnotation
  | NodeTypeAnnotation
  | NullableTypeAnnotation
  | FunctionTypeAnnotation
  | TypeVariableAnnotation
  | ImpliedTypeAnnotation
  | HoleTypeAnnotation
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

export interface VectorTypeAnnotation {
  readonly kind: "Vector";
  readonly element: TypeAnnotation;
  readonly span: Source.Span;
}

export interface MapTypeAnnotation {
  readonly kind: "Map";
  readonly key: TypeAnnotation;
  readonly value: TypeAnnotation;
  readonly span: Source.Span;
}

export interface SetTypeAnnotation {
  readonly kind: "Set";
  readonly element: TypeAnnotation;
  readonly span: Source.Span;
}

export interface ArrayTypeAnnotation {
  readonly kind: "Array";
  readonly element: TypeAnnotation;
  readonly span: Source.Span;
}

/**
 * `JsMap(k, v)` — the borrowed view of a native JS `Map` (FFI Part 10 §1). A
 * boundary intrinsic like `Array(a)`: no `.hex` module declares it, and the
 * value crossing is the foreign object itself, zero-copy.
 */
export interface JsMapTypeAnnotation {
  readonly kind: "JsMap";
  readonly key: TypeAnnotation;
  readonly value: TypeAnnotation;
  readonly span: Source.Span;
}

/** `JsSet(a)` — the borrowed view of a native JS `Set` (FFI Part 10 §1). */
export interface JsSetTypeAnnotation {
  readonly kind: "JsSet";
  readonly element: TypeAnnotation;
  readonly span: Source.Span;
}

/**
 * `Node(a)` — the hidden fixed-32 trie node. Resolved only inside a privileged
 * runtime module (the resolver rejects it as an unknown generic type elsewhere),
 * and the checker forbids it from crossing an exported signature.
 */
export interface NodeTypeAnnotation {
  readonly kind: "Node";
  readonly element: TypeAnnotation;
  readonly span: Source.Span;
}

export interface NullableTypeAnnotation {
  readonly kind: "Nullable";
  readonly value: TypeAnnotation;
  readonly span: Source.Span;
}

export interface FunctionTypeAnnotation {
  readonly kind: "Function";
  readonly parameters: readonly TypeAnnotation[];
  readonly result: TypeAnnotation;
  /** How the arrow was written (#355); absent is `->`. */
  readonly effect?: "linked" | "constant";
  /** The arrow token, so a face fixit replaces exactly it. */
  readonly arrowSpan?: Source.Span;
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

/**
 * The **namespace-import alias one occurrence was written through** (Modules
 * §3.3), for FFI Part 7 §2.4 rung 3.
 *
 * Rung 3 is the one rung keyed on the occurrence rather than on the identity,
 * because an identity does not determine a qualifier: the companion fallback
 * (Modules §5.1 rule 2) lets one type be named qualified at one seat and bare at
 * another, and two aliases onto one module are both legal, so neither is *the*
 * alias. Re-deriving one from the import items by identity is exactly what the
 * rule refuses, so the qualifier has to ride the occurrence.
 *
 * `module` is what makes the qualifier **readable only in the module that wrote
 * it**. A qualifier is a spelling, and a spelling that travelled would be
 * meaningless at best: a type alias's expansion crosses a module boundary
 * carrying its *writer's* qualifiers (FFI Part 7 §1), and an importer binding
 * the same alias spelling to a different module would then publish a face naming
 * a real type that is the wrong one, with nothing to report it. The declaration
 * emitter compares this against its own `fileId` and ignores every other.
 *
 * Set only for a **source-written** namespace import of the rendering module —
 * never for a prelude companion (§6.4's qualified home, which carries no import
 * line and reaches rung 4 instead), and never for the companion fallback, whose
 * occurrence the source wrote *bare*.
 */
export interface TypeQualifier {
  /** The module that wrote the qualifier; only that module may read it. */
  readonly module: Source.FileId;
  /** The alias as the source spelled it; emission may move it (§2.4). */
  readonly alias: string;
  /** The type's own name in its home module — what follows the dot. */
  readonly member: string;
}

export interface UnionTypeAnnotation {
  readonly kind: "Union";
  readonly union: UnionId;
  readonly name: string;
  readonly arguments: readonly TypeAnnotation[];
  /** See `TypeQualifier`. */
  readonly qualifier?: TypeQualifier;
  readonly span: Source.Span;
}

export interface TypeVariableAnnotation {
  readonly kind: "TypeVariable";
  readonly name: string;
  readonly span: Source.Span;
}

export interface ImpliedTypeAnnotation {
  readonly kind: "ImpliedType";
  readonly constraint: string;
  readonly name: string;
  readonly span: Source.Span;
}

/**
 * A type hole, `_`. It resolves to nothing — there is no name to look up — and
 * the checker elaborates it to a fresh non-rigid variable, which is the whole of
 * its semantics (closure doc `decisions-ml-dialect-annotations-2026-08.md` §4).
 */
export interface HoleTypeAnnotation {
  readonly kind: "Hole";
  /**
   * Which **written** `_` this node came from (§4.1: the unit is the written
   * hole). Type-alias substitution copies one hole node into every position the
   * alias body mentions its parameter — `type Pair(a) = (a, a)` applied as
   * `Pair(_)` yields two nodes — and every copy carries the id the written hole
   * was minted with, so elaboration gives them one metavariable.
   *
   * The id, not the span, is the identity. A copy does keep the written `_`'s
   * span, but only because `withTypeSpan` exempts holes from the re-pointing it
   * gives every other substituted node, and what one written hole *is* must not
   * rest on that choice. Diagnostics that report per written hole — §5.4's
   * fence — collapse on the id for the same reason.
   */
  readonly id: number;
  /**
   * The written constraint list of `_ : C` (§4.4), by name — resolved as binder
   * lists resolve theirs, which is to say carried through for the checker to
   * look up. Empty for a bare `_`. The list rides the hole node, so the copies
   * substitution makes share the seed exactly as they share the id.
   */
  readonly constraints: readonly string[];
  readonly span: Source.Span;
}

export interface RecordDeclarationTypeAnnotation {
  readonly kind: "RecordDeclaration";
  readonly record: RecordId;
  readonly name: string;
  readonly arguments: readonly TypeAnnotation[];
  /** See `TypeQualifier`. */
  readonly qualifier?: TypeQualifier;
  readonly span: Source.Span;
}

export interface ExternTypeAnnotation {
  readonly kind: "ExternType";
  readonly externType: ExternTypeId;
  readonly name: string;
  /** See `TypeQualifier`. */
  readonly qualifier?: TypeQualifier;
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
  /**
   * Set on the binding a `widens` declaration introduces (Constraints §4.7,
   * #546) — the one lawful bearer of an honored member's spelling.
   *
   * It rides the *symbol* rather than the item so the fact crosses a module
   * boundary with the binding: an importer holds symbols, not items, and both
   * the visibility rule (qualifiable, not a bare export) and Method Syntax
   * §6.1's one-claimant rule have to hold on the far side too.
   */
  readonly widens?: true;
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

/** One name a scope binds, and the point from which it can be used. */
export interface ScopeBinding {
  readonly name: string;
  readonly symbol: SymbolId;
  /**
   * The offset from which the name is in scope. For most binders this is the
   * start of the region — a parameter is available throughout its lambda, a
   * `fun` throughout its block, because both are declared before the body is
   * resolved. A sequential `let` or `var` scopes over the *rest* of its block
   * (Statements §5.1), so its own offset is where it begins.
   */
  readonly visibleFrom: number;
}

/**
 * A region of source and the names it introduces.
 *
 * Recorded by the resolver as it goes, because the resolver is the only pass
 * that knows: scoping is its rule, and by the time a tree reaches anyone else
 * every name has already become an identity, with the layers it was chosen from
 * gone. Reconstructing them downstream would mean writing Hexagon's scoping a
 * second time, in a copy nothing keeps honest.
 *
 * **Nesting is containment, not a parent pointer.** A name is in scope at an
 * offset when some region containing that offset binds it and the binding is
 * visible from at or before it; when two regions both do, the smaller one is the
 * inner one. That is what makes this record usable without replaying the walk
 * that produced it.
 */
export interface ScopeRegion {
  readonly span: Source.Span;
  readonly bindings: readonly ScopeBinding[];
  /**
   * Whether the region *is* a body, so that its own start column is where its
   * contents sit.
   *
   * True for a block: `let doubled = …` begins the region and the next statement
   * lines up under it, so a cursor in that column is inside. False for a
   * construct that begins with a head — a match arm, a lambda — where the start
   * column is where the *construct* sits and a cursor there is writing the next
   * one. Completion needs the difference to decide whether a scope still reaches
   * a cursor sitting on blank lines after it.
   */
  readonly body: boolean;
}

/** A module reachable by name, with the members that name reaches. */
export interface ModuleAlias {
  readonly alias: string;
  readonly members: readonly { readonly name: string; readonly symbol: SymbolId }[];
}

export interface Module {
  readonly kind: "Module";
  readonly fileId: Source.FileId;
  /**
   * This module's own project-root-normalized path, when the compilation had
   * one. `fileId` identifies the file to the diagnostic machinery but says
   * nothing about *where* it sits, and a message that names another module's
   * file has to state the route from here (Collections Part 5 §3.3).
   *
   * Absent for a lone `resolve` in a test, which is why every consumer treats a
   * missing path as "no file to name" rather than as an error.
   */
  readonly path?: string;
  readonly items: readonly Item[];
  readonly symbols: readonly Symbol[];
  /**
   * Every scope this module opened, outermost first. Present for editor
   * services that need to answer "what could go here?" — the one question the
   * rest of the tree cannot answer, since it records what names *did* resolve to
   * and never what else was available.
   */
  readonly scopes: readonly ScopeRegion[];
  /** Modules addressable by name here, prelude companions included. */
  readonly moduleAliases: readonly ModuleAlias[];
  readonly unions: readonly Union[];
  readonly records: readonly RecordDeclaration[];
  /**
   * Record identities the prelude supplies, by name (Modules §5.5). Separate
   * from `records` because a module may occlude a prelude name (§5.4) while the
   * compiler's own producers — `Vector.toSeq`, `Map.keys`, `for x in` — must
   * still reach the prelude's declaration. This is how a later stage names a
   * prelude type without spelling it.
   */
  readonly preludeRecords: ReadonlyMap<string, RecordId>;
  /**
   * Union identities the prelude supplies, by name — the `preludeRecords`
   * channel for unions, and for the same occlusion reason. `Bool` is why this
   * exists (#147): since it stopped being a primitive, every condition, guard,
   * comparison, and predicate result the checker builds has to name the
   * *prelude's* `Bool`, which a module declaring its own `Bool` must not move.
   */
  readonly preludeUnions: ReadonlyMap<string, UnionId>;
  /**
   * Every coherent instance the visible prelude modules own or carry (#153).
   *
   * Instance *availability* used to be a property of the import list: the
   * checker's evidence universe was this module's `Honor` items plus the
   * `instances` on its `Import` items, and the prelude's copies rode the
   * synthesized prelude import — which is term-gated. A module that named only a
   * prelude *type* (`a: Ordering`, `b: Option(Int)`) synthesized no import and so
   * had no evidence, and `a == b` failed for want of an instance that is
   * unconditionally in scope by Modules §5.5.
   *
   * This channel is that availability, stated directly instead of inferred from
   * emission. It is deliberately *not* on an `ImportItem`: what a module can see
   * and what it must import are now separate questions, answered by separate
   * passes — the checker seeds from here, and the emitter imports only the
   * entries the elaborated Core actually references.
   *
   * Ordered by the normative prelude order (`compiler/src/prelude.ts`), so the
   * emitted import lines are deterministic. A prelude module's own slice holds
   * only the members before it, and `Bool.hex`'s is empty.
   */
  readonly preludeInstances: readonly PreludeInstance[];
  /**
   * The prelude's importable type inventory for this module (FFI Part 7 §2.4).
   *
   * The same candidates-then-filter division as `preludeInstances` above, for
   * the same reason: a prelude type reaches every module's scope with no import
   * item for the `.d.ts` to render (Modules §5.5), so a face naming `Option`
   * emitted an unimported name — which TypeScript either rejects or, under the
   * default `lib` set, silently binds to `lib.dom.d.ts`'s `Option` (#227).
   *
   * Ordered by the normative prelude order (`compiler/src/prelude.ts`), and
   * within a member by unions, then records, then extern types, so the emitted
   * import lines are deterministic. A prelude module's own slice holds only the
   * members before it, and `Bool.hex`'s is empty.
   */
  readonly preludeTypeImports: readonly PreludeTypeImport[];
  /**
   * Every constraint declaration this module can see — its own and everything
   * its import graph reaches — deduplicated by identity. A wider set than the
   * ones it can *name* (Modules §3.1 binds only what the module it imported
   * exports).
   *
   * Metadata, never scope, and the width is load-bearing in exactly one shape:
   * an **intermediate link in a base chain**. A constraint this module named
   * arrives on `ImportItem.constraints`, and its own bases arrive as identities
   * on `ConstraintItem.baseConstraintIdentities` — enough to take one hop with
   * no second declaration in hand. The hop *after* that needs the middle link's
   * declaration, to read its bases in turn; and a middle link can be private to
   * the module that wrote the chain, in which case no import anywhere can have
   * named it. Without this channel the entailment walk stops one hop short,
   * which surfaces as a demand to declare a constraint the module cannot spell.
   *
   * Transitive for the same reason `ImportItem.instances` is: the module that
   * needs the link need not be the one that imported it.
   */
  readonly visibleConstraints: readonly ConstraintItem[];
  /**
   * Every exception declaration this module can see but did not itself write —
   * the prelude layer's (Modules §5.5) and the ones its imports reach.
   *
   * The `unions`/`records` channel for exceptions, and it exists for the same
   * reason: an exception is a **constructor** (Exceptions §1), so a catch arm
   * names it with the flat constructor patterns of Unions §4.2 — bare, or
   * qualified through Modules §3.3 — and the checker cannot tell a resolved
   * constructor symbol is an exception's, nor read its payload slots, from a
   * scheme alone. Without this the checker's exception table held the module's
   * own `exception` items and nothing else, and every in-scope exception the
   * module had not written was refused in a catch arm by either spelling
   * (#469).
   *
   * This module's own declarations are **not** here: they are its `Exception`
   * items, which the checker walks anyway to validate their slots. Same
   * division as `visibleConstraints`.
   *
   * Metadata, never scope. What a catch arm may *name* is settled by
   * resolution — bare through the module scope's prelude layer, qualified
   * through `#namedModule` — so an entry no spelling reaches is inert rather
   * than a widening of what is in scope.
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
   * The primitive this module is the **fixed prelude companion** of, when it is
   * one (Method Syntax §4.1's table, Constraints §5.3 — #344).
   *
   * A primitive has no declaration, so nothing in a module's *text* can say it
   * is that primitive's home. The fact is a compilation one — the module is a
   * prelude member injected at the primitive's own basename — which is the same
   * shape the intrinsic door's privilege takes (`spec/intrinsics.md` §5.2), and
   * it is settled in `project.ts` for the same reason: privilege attaches to how
   * a module is compiled, never to what it says about itself.
   *
   * Three rules read it, each for exactly the primitive named here: the orphan
   * rule ("the module that declares `T`" — this file *is* `BigInt`'s home),
   * `Hash`'s derivable-only carve-out (Constraints §4.5 — a primitive has no
   * declaration to hang `derives` on), and Modules §5.3's qualified access to
   * honored members, where "a type it declares" reads as "the primitive it
   * companions". Every other module sees a primitive subject as one it does not
   * own, unchanged.
   */
  readonly companionPrimitive?: PrimitiveName;
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
  /**
   * Whether this block resolved as the intrinsic door (`spec/intrinsics.md` §5):
   * the specifier names it **and** the module was compiled with the privilege to
   * use it. False for every foreign block, and false for a `hex:`-scheme block
   * the gate refused — for which §5.3's "the block never resolves" is the whole
   * point, and this field is what makes that literally so downstream.
   *
   * The gate's answer travels rather than being re-derived, because the
   * specifier alone cannot answer it: privilege is a property of the
   * compilation. `isIntrinsicScheme(specifier)` stays a fair question
   * downstream — "is this the reserved scheme?" is syntactic, and the emitter
   * draws exactly that line at its own asking site — but a pass re-deriving
   * the *privilege* half from module identity would have gone quietly wrong
   * when §5.2 widened to the runtime-module set (#365), which is the drift
   * this field exists to absorb.
   */
  readonly intrinsic: boolean;
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
  /** The #355 trusted purity claim; see the parsed tree's field. */
  readonly pure?: true;
  /** #409's declared-conduit claim, at its own word; see the parsed tree's field. */
  readonly conduit?: Source.Span;
  readonly foreignName?: string;
  readonly localName: string;
  readonly span: Source.Span;
}

export interface ExternFunDeclaration extends ExternDeclarationFields {
  readonly kind: "ExternFun";
  readonly binding: Binding;
  /** The declared binders and their bounds (#370); see the parsed tree's field. */
  readonly typeParameters?: readonly TypeParameter[];
  readonly parameters: readonly Parameter[];
  readonly returnAnnotation: TypeAnnotation;
}

export interface ExternLetDeclaration extends ExternDeclarationFields {
  readonly kind: "ExternLet";
  readonly binding: Binding;
  readonly annotation: TypeAnnotation;
}

export interface ExternTypeDeclaration extends ExternDeclarationFields {
  readonly kind: "ExternType";
  readonly default: false;
  readonly externType: ExternTypeId;
}

export interface LetItem {
  readonly kind: "Let";
  readonly exported: boolean;
  readonly binding: Binding;
  readonly annotation?: TypeAnnotation;
  readonly value: Expr;
  /**
   * The members this item widens (Constraints §4.7, #546), present exactly on a
   * `widens` declaration. `exported` is true on one — the binding has to cross
   * the module boundary for `Float.pow` to resolve — but it is *qualifiable, not
   * a bare export*: the interface files it under `widensBindings`, so it enters
   * no consumer's bare scope and counts for nothing in Modules §5.5's
   * collision arithmetic.
   */
  readonly widens?: readonly WidensTarget[];
  readonly span: Source.Span;
}

/**
 * One member a `widens` declaration names, resolved (Constraints §4.7).
 *
 * `constraintIdentity` is what the honor blocks are matched against — a
 * constraint is its declaration (§5.1.1), never its spelling — while
 * `constraint` is the word a diagnostic prints.
 */
export interface WidensTarget {
  /** The module alias the head wrote, which diagnostics quote back. */
  readonly module: string;
  readonly constraint: string;
  readonly constraintIdentity: string;
  readonly member: string;
  readonly span: Source.Span;
}

/**
 * Everything one module's internal export spellings (Lexer §3.2's reserved
 * prefix) are a function of — carried on the import so an importer computes the
 * exporter's names rather than predicting them.
 *
 * Three families share that namespace and can contest a spelling: a defaulted
 * member's hoisted helper claims `__default_<member>`, a member's forwarder
 * prefers `__<member>`, and a constrained term's export prefers `__<term>`
 * (Constraints §6.5, FFI Part 7 §7). `default_log` is an ordinary term name, so
 * the contests are real, and an importer cannot see them from what it imports:
 * `import { default_log }` names the term and never the constraint whose member
 * `log` claims the spelling.
 *
 * These are the *inputs* to the naming rule, not the names it produces, so the
 * rule has exactly one implementation — the exporting module runs it over its
 * own items, an importer over this, and neither predicts what the other
 * computed. `members` is every member of every **exported** constraint the
 * module declares, not only the constraints this import binds, and `terms` is
 * every exported `let`, `fun`, and foreign row: an unconstrained one mints no
 * spelling but still contests one, and both sides must count the same heads.
 */
export interface InternalNameInputs {
  readonly members: readonly {
    readonly name: string;
    readonly defaulted: boolean;
  }[];
  readonly terms: readonly string[];
}

export interface ImportItem {
  readonly kind: "Import";
  readonly specifier: string;
  readonly form: ImportForm;
  /** Coherent instance evidence made global by loading this module. */
  readonly instances: readonly InstanceImport[];
  /** Constraints this import binds by name (Modules §3.1/§3.2/§3.3). */
  readonly constraints: readonly ConstraintImport[];
  /**
   * What the imported module's internal export spellings are computed from; see
   * `InternalNameInputs`.
   */
  readonly internalNames: InternalNameInputs;
  /**
   * Which of the imported module's **exported terms** have a value form that
   * admits Algorithm N editions (FFI Part 8 §3.2): a `fun`, or a `let` bound to
   * a lambda. Carried for the reason `internalNames` is — an importer that
   * emits a call to an edition must reach a name the exporter really published,
   * and the one input it cannot recover is the *form* of the value. The scheme
   * cannot supply it: `export let alias<a: Show>: (a) -> String = describe` has
   * a specializable type and no editions at all, because the exporter's plan
   * reads the item and finds no lambda.
   *
   * Names, not editions. Running Algorithm N here is impossible — the plan
   * needs the generalized scheme, which arrives two passes later — so the two
   * sides split the way the internal-name rule splits them: the exporter's
   * enumeration travels, and each side computes from it.
   */
  readonly specializableTerms: readonly string[];
  /**
   * Whether the resolver synthesized this import rather than the source writing
   * it — the used-names-only import of one prelude module (Modules §5.5, §6.4).
   * False for every import the source spells, including one of a prelude module.
   *
   * The resolver's answer travels rather than being re-derived, because the
   * specifier alone cannot answer it: a source module may import `./Option` by
   * exactly the specifier the synthesized item carries, and the two items are
   * then indistinguishable by text. The same principle as
   * `ExternBlockItem.intrinsic` (#125).
   *
   * Emission reads it because a synthesized item's names are an
   * *over-approximation* — the companion-dispatch candidates of
   * `#noteCompanionCandidate` are registered from syntax, before the checker can
   * say which of them are dispatches — so its name list is filtered to what the
   * elaborated Core actually references (#263), which no explicit import's may
   * be: the source asked for those.
   */
  readonly synthesized: boolean;
  readonly span: Source.Span;
}

/**
 * One member seat of a **ground** instance: the module-level binding a member's
 * implementation hoists to (`spec/constraints.md` §6.1).
 *
 * Named in the resolver rather than the emitter because the seats take the
 * *declared* rank of Dictionary Sharing §5's first phase — they contest one
 * spelling space with the dictionaries beside them, and a name already baked
 * into the resolver's output is one no later rename can reach (§5's closing
 * law). A parameterized instance has no seats: its members close over the
 * factory's evidence parameters, so no module-level binding could hold one.
 */
export interface MemberSeat {
  /** The constraint member this seat holds — the name the record's slot takes. */
  readonly member: string;
  /**
   * The emitted `const`'s name: the preferred `__<Constraint>_<Subject>_<member>`
   * spelling, or a `_n`-suffixed one where the module contests it (§5).
   *
   * On an `InstanceImport` this is instead the **exporter's interface**
   * spelling, read from the resolved interface and never predicted — the same
   * convention `importedDictionary` follows.
   */
  readonly seat: string;
  /**
   * The spelling this module's *interface* publishes, present only where a
   * collision moved `seat` off the bare name (Dictionary Sharing §8). Absent on
   * an `InstanceImport`, whose `seat` is already an interface spelling.
   */
  readonly exportedSeat?: string;
}

export interface InstanceImport {
  /** Stable declaration identity used to deduplicate diamond import paths. */
  readonly identity: string;
  readonly constraint: string;
  /**
   * The identity of the constraint this instance answers, minted by the module
   * that declared the constraint and carried unchanged across every hop
   * (§5.1.1). Coherence in the importing module compares this, never
   * `constraint` — two exporting modules may both spell theirs `Describe`.
   */
  readonly constraintIdentity: string;
  readonly typeParameters: readonly TypeParameter[];
  readonly subject: TypeAnnotation;
  readonly impliedTypes: readonly HonorImpliedType[];
  readonly importedDictionary: string;
  readonly localDictionary: string;
  /**
   * The instance's member seats under the **declaring** module's interface
   * spellings (#444), carried unchanged across every hop for the reason
   * `identity` is: a consumer routing a concrete member call to a seat has to
   * reach a name the honoring module really published, and nothing on this side
   * can predict it. Empty for a parameterized instance, which has no seats.
   */
  readonly memberSeats: readonly MemberSeat[];
  /**
   * The path of the module that **declares** this instance, travelling with the
   * seats and for their sake.
   *
   * The import item's own specifier will not serve. `instances` deduplicates by
   * identity and a diamond of re-exports resolves to the first specifier in
   * source order, which may name a module that merely carried the instance
   * through — and a transit module re-exports the *dictionary*, not the seats.
   * The declaring module is the one that exports them, so routing relativizes
   * this against its own path (`seatSpecifier`). Absent where the compilation
   * gave no module a path (the pass-level harnesses), which declines the route.
   */
  readonly declaringPath?: string;
  /**
   * `declaringPath` as an import specifier from **this** module, computed once
   * where the import is bound. Absent for the same reasons `declaringPath` is.
   */
  readonly seatSpecifier?: string;
  readonly span: Source.Span;
}

/**
 * One prelude-owned instance, available by §5.5 visibility rather than by import
 * (`Module.preludeInstances`, #153).
 *
 * Field-for-field an `InstanceImport` plus the `specifier` of the prelude module
 * that exports the dictionary — which an `InstanceImport` never needs because its
 * import item already carries one, and this channel has no item to sit on. The
 * `localDictionary` convention is `InstanceImport`'s, unchanged, so an entry that
 * does reach emission spells the same name it always did.
 */
export interface PreludeInstance extends InstanceImport {
  /** The prelude module to import `importedDictionary` from, relative to here. */
  readonly specifier: string;
}

/**
 * One prelude-owned nominal type this module may name without importing it
 * (`Module.preludeTypeImports`, FFI Part 7 §2.4).
 *
 * Availability, not emission — the division `preludeInstances` already draws.
 * A prelude type in scope but absent from every rendered face costs nothing,
 * which is what makes the channel free; the declaration emitter imports exactly
 * the entries its faces reference.
 *
 * Exactly one of `union`/`record`/`externType` is set: what a face carries is an
 * *identity*, and matching by name would break on occlusion (Modules §5.4),
 * which is the discipline the `Bool`/`Seq` pins already follow. Type aliases get
 * no entry — a face carries an alias's expansion, never its name (§1).
 */
export interface PreludeTypeImport {
  readonly union?: UnionId;
  readonly record?: RecordId;
  readonly externType?: ExternTypeId;
  /** The prelude export's declared name, which is also the name to import. */
  readonly name: string;
  /** The owning prelude member, relative to here; emission rewrites it to `.js`. */
  readonly specifier: string;
  /**
   * Set when a source-written import also binds this identity, under this local.
   * That import owns the type's emission (§2.4 channel 1) — the same take-over
   * the term side performs — so the entry renders through the local and owes no
   * import line of its own. A second line would be a duplicate identifier.
   */
  readonly explicitLocal?: string;
}

export type ImportForm =
  | { readonly kind: "Effect" }
  | { readonly kind: "Namespace"; readonly alias: string; readonly names: readonly ImportName[] }
  | { readonly kind: "Named"; readonly names: readonly ImportName[] };

/** One constraint an import puts in the constraint namespace. */
export interface ConstraintImport {
  /**
   * The name this module spells it by: the declared name, an `as` alias
   * (§3.2 — the constraint name only, never its members), or `Alias.Name` for
   * the namespace form (§3.3).
   *
   * One entry is not a binding: the namespace form also carries the **bare
   * alias** where the aliased module exports a constraint of the alias's own
   * spelling (§5.1 rule 2's companion fallback, #531). The resolver adds it only
   * for a name the constraint namespace left unclaimed, so downstream it reads
   * as an ordinary entry and can never contest one.
   */
  readonly local: string;
  /** The declaration itself; an importer sees the one the home module made. */
  readonly declaration: ConstraintItem;
}

export interface ImportName {
  readonly imported: string;
  readonly local: string;
  readonly symbol?: SymbolId;
  /**
   * The name binds a type and *no* term. The JavaScript emitter's filter: a
   * synthesized prelude import skips these, because there is nothing to import
   * at run time.
   */
  readonly typeOnly?: boolean;
  /**
   * The name binds a type — union, record, type alias, or extern type —
   * whatever it also binds. Independent of `typeOnly` on purpose (§2.4 channel
   * 1): `import { Point }` of a record binds the constructor *and* the type, and
   * the declaration emitter used to infer "type" from "not a term", so the term
   * half silently cost the `.d.ts` its `import type` row (#227).
   */
  readonly typeBinding?: boolean;
  /**
   * The **identity** the type half binds, where it binds a nominal one — exactly
   * one of the three is set, and all three are absent where `typeBinding` is
   * unset or the name binds a *type alias* (which has no identity, because a
   * face carries an alias's expansion and never its name; FFI Part 7 §1).
   *
   * FFI Part 7 §2.4 rung 2 answers by **identity**, so the declaration emitter
   * can spell a face with the local this import bound — honouring `as` — instead
   * of with the type's declared name. Before this the named-import channel
   * carried no identity at all, so there was nothing to look the local up by and
   * a renamed import emitted `import type { Shape as S }` beside a face spelling
   * `Shape` (#617).
   */
  readonly union?: UnionId;
  readonly record?: RecordId;
  readonly externType?: ExternTypeId;
  /**
   * The name is a **member of an imported constraint** rather than a name the
   * source listed (Modules §3.1: importing a constraint imports its members).
   *
   * The resolver synthesizes these so the members are in scope and typed; the
   * JavaScript emitter filters them to the ones the body actually references,
   * for the reason `ImportItem.synthesized` gives — a name the source never
   * wrote must not become an import line the source never asked for.
   */
  readonly constraintMember?: boolean;
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
  /**
   * Set when this `let` is a **lambda parameter's** destructuring rather than a
   * written binding (Pattern Matching §6.5). The two are the same item by
   * construction — that is the point of desugaring here — but they are not the
   * same *seat*, and one diagnostic distinguishes them: a refutable pattern at a
   * lambda parameter carries §6.7's match-function fixit, which would be advice
   * about the wrong construct anywhere else.
   */
  readonly parameter?: true;
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
  readonly symbol: SymbolId;
  /**
   * The constructor as *written here* — the local spelling. A qualified pattern
   * carries the constructor half alone, so this is always the identifier that
   * stands at `nameSpan`, which is what a diagnostic quotes and what the
   * occurrence index has to publish for a rename to move the right spellings.
   */
  readonly text: string;
  /**
   * The name the constructor was **declared** under, which is the runtime tag
   * emission tests against (and an exception's `name`). It parts company with
   * `text` wherever the use site may spell the constructor its own way — an
   * `import { Circle as Round }` above all (#468) — and a pattern that tested
   * the local spelling would compile to a case no value ever equals.
   */
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
  readonly parameters: readonly string[];
  readonly annotation: TypeAnnotation;
  readonly span: Source.Span;
}

/**
 * A type parameter as written in a declaration head, sigil included (Modules
 * §4.2.1, Declarations Preamble §2.1). Index-aligned with `parameters`, which
 * stays the identity list every other pass reads.
 *
 * Carried on the declaration itself, not in a side table, so an imported
 * declaration brings its claims with it: every consumer reads the *declared*
 * claim, home module included (closure doc §6.4), and a copy that lost the row
 * would silently read as the empty claim. Absent entirely on the synthesized
 * declarations that have no written head.
 */
export interface DeclaredTypeParameter {
  readonly name: string;
  readonly claim?: "co" | "contra";
  readonly span: Source.Span;
}

export interface Union {
  readonly id: UnionId;
  readonly name: string;
  readonly parameters: readonly string[];
  readonly declaredParameters?: readonly DeclaredTypeParameter[];
  readonly derives: readonly string[];
  readonly opaque: boolean;
  readonly representationVisible: boolean;
  /**
   * The project-root-normalized path of the module this union was **declared**
   * in — `/app/bag.hex`, the same string `compileProject` keys its module map
   * on.
   *
   * Carried on the declaration for the reason `DeclaredTypeParameter` above is:
   * an imported declaration must bring the fact with it. Every re-registration
   * of an imported, prelude-seeded, or transitively included declaration is a
   * spread copy, so the path travels the whole module graph unchanged — and
   * because it is normalized against the project root rather than against
   * whichever module copied it, no consumer has to re-relativize a path it did
   * not write.
   *
   * The consumer is Collections Part 5 §3.3's two-legal-homes diagnostic, which
   * names the file the missing `honor` belongs in. Absent when the compilation
   * supplied no path at all (a lone `resolve` in a test), which is exactly when
   * there is no file to name and the diagnostic falls back to its generic form.
   */
  readonly declaringPath?: string;
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
  readonly opaque: boolean;
  readonly union: UnionId;
  readonly name: string;
  readonly parameters: readonly string[];
  readonly declaredParameters?: readonly DeclaredTypeParameter[];
  readonly derives: readonly string[];
  readonly constructors: readonly Constructor[];
  readonly span: Source.Span;
}

export interface RecordDeclaration {
  readonly id: RecordId;
  readonly name: string;
  readonly parameters: readonly string[];
  readonly declaredParameters?: readonly DeclaredTypeParameter[];
  readonly derives: readonly string[];
  readonly opaque: boolean;
  readonly representationVisible: boolean;
  /** The declaring module's path; see `Union.declaringPath`. */
  readonly declaringPath?: string;
  readonly constructor: Binding;
  readonly fields: readonly RecordTypeField[];
  readonly span: Source.Span;
}

export interface RecordItem {
  readonly kind: "RecordDeclaration";
  readonly exported: boolean;
  readonly opaque: boolean;
  readonly record: RecordId;
  readonly name: string;
  readonly parameters: readonly string[];
  readonly declaredParameters?: readonly DeclaredTypeParameter[];
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
  /**
   * The declaring module's **brand identity** (`spec/exceptions.md` §7.1, #488):
   * the string this exception's `$hex` carries at run time, and the literal its
   * `.d.ts` face publishes. See `ResolveOptions.identity` for how it is spelled.
   *
   * It travels on the declaration rather than on the module because emission
   * reads it for exceptions this module did not write: a catch arm naming
   * another module's constructor tests *that* module's brand, which is the
   * whole of #488 (§7.4's (module, name) pair). `Module.visibleExceptions`
   * carries the entries an importer sees, each still stamped with its own home.
   */
  readonly owner: string;
  readonly span: Source.Span;
}

export interface ConstraintItem {
  readonly kind: "ConstraintDeclaration";
  /** `export constraint` (Modules §4.1): the name and its members cross. */
  readonly exported: boolean;
  readonly name: string;
  /**
   * This declaration's identity (`spec/constraints.md` §5.1.1) — what coherence
   * keys on, in place of `name`. See `src/constraints.ts` for the two spaces.
   */
  readonly identity: string;
  readonly subject: string;
  readonly baseConstraints: readonly string[];
  /**
   * The identity each name in `baseConstraints` denoted **where the declaration
   * was written**, positionally aligned with it.
   *
   * A base constraint is a name in the declaring module's scope, so an importer
   * cannot re-derive it: `constraint Loud<a: Describe>` exported from one module
   * says nothing about what the *importer* spells `Describe`. Without this the
   * importer's entailment walk finds no bases and silently reduces a requirement
   * to the wrong dictionary — the miscompile #276 names.
   */
  readonly baseConstraintIdentities: readonly string[];
  /**
   * The path of the file whose text contains this declaration — the constraint's
   * **home module** for the orphan rule (Constraints §5.3), and the file Modules
   * §7.6's missing-instance diagnostic names.
   *
   * Stamped where the declaration is written, exactly as `Union.declaringPath`
   * and `RecordDeclaration.declaringPath` are, and for the same reason: the
   * declaration travels — through `Module.visibleConstraints`, through an
   * import's `constraints`, and on through a second hop — while the identity it
   * carries addresses the *file id*, which no consumer can turn back into a path.
   * A module reporting a missing instance must name a file the reader can open.
   *
   * Absent where the compilation has no path for the module (a bare `check` in a
   * unit harness); §7.6's report falls back to its path-free form there.
   */
  readonly declaringPath?: string;
  readonly impliedTypes: readonly ConstraintImpliedType[];
  readonly members: readonly ConstraintMember[];
  readonly span: Source.Span;
}

export interface ConstraintImpliedType {
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
  /**
   * The identity of the constraint declaration this instance answers, resolved
   * at the `honor` site (§5.1.1). `constraint` is the spelling the source used
   * and what diagnostics print; this is what coherence compares, so an
   * `honor Describe<Int>` answering one module's `Describe` never collides with
   * another module's.
   */
  readonly constraintIdentity: string;
  readonly typeParameters: readonly TypeParameter[];
  readonly subject: TypeAnnotation;
  readonly derived: boolean;
  /**
   * The name of the `const` this instance's dictionary is bound to in the
   * emitted module — its preferred `__<Constraint>_<Subject>` spelling, or a
   * `_n`-suffixed one where the module contests it (Dictionary Sharing §5).
   */
  readonly dictionary: string;
  /**
   * The spelling this module's *interface* publishes, present only where a
   * collision moved `dictionary` off the bare name (Dictionary Sharing §8). The
   * export re-binds — `export { __Eq_Rat_1 as __Eq_Rat }` — so consumers see an
   * uncontested interface name and never predict a local one.
   */
  readonly exportedDictionary?: string;
  /**
   * Constraints §6.1's member seats, one per member of the instance's
   * **completed** member set (supplied members, inherited defaults, and a
   * derived instance's generated ones alike), in the constraint declaration's
   * member order — see `MemberSeat`.
   *
   * Empty for a parameterized instance, and empty where no declaration of the
   * constraint is in view to enumerate the members from, which leaves the
   * instance emitting its members inline exactly as it did before #444.
   */
  readonly memberSeats: readonly MemberSeat[];
  readonly impliedTypes: readonly HonorImpliedType[];
  readonly members: readonly HonorMember[];
  readonly span: Source.Span;
}

export interface HonorImpliedType {
  readonly name: string;
  readonly annotation: TypeAnnotation;
  readonly span: Source.Span;
}

export interface HonorMember {
  readonly name: string;
  readonly value: LambdaExpr;
  /**
   * Set where the block accounted for this member with `name = widened` and the
   * resolver **derived** it from the module's `widens` declaration (Constraints
   * §4.7): the value above is the door's restriction, synthesized — the door
   * called at the member's own seats, with the signature check's certified
   * §5.1 conversions left to the seats that check the call.
   *
   * Read by the checker for one thing only: a derived member's body names a
   * binding that may stand *below* the honor block, so its check is deferred to
   * the end of the module's items, where every scheme is seeded.
   */
  readonly derived?: true;
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
  | ThrowExpr
  | CallExpr
  | AccessExpr
  | IndexExpr
  | HashExpr
  | CollectionOperationExpr
  | UnaryExpr
  | BinaryExpr
  | ComparisonExpr
  | AssignmentExpr
  | ErrorExpr;

export interface NameExpr {
  readonly kind: "Name";
  readonly symbol: SymbolId;
  readonly text: string;
  /**
   * The instance subject this reference is pinned at, for a member reached
   * through **qualified access to an honoring module** (Modules §5.3).
   *
   * `Rat.add` denotes `Num<Rat>`'s member, not `Num`'s polymorphic export — that
   * is what "the member at the type `M` honors" means, and it is what makes
   * `Rat.add(1, 2)` the type error a reader expects rather than a silent
   * `Num<Int>` call. The symbol is the declaration's member either way; this
   * says which instance the reference means.
   */
  readonly instanceSubject?: InstanceSubjectPin;
  readonly span: Source.Span;
}

export interface InstanceSubjectPin {
  readonly annotation: TypeAnnotation;
  /** The instance's own parameters, fresh per reference (`honor<a: Show> …`). */
  readonly typeParameters: readonly TypeParameter[];
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

export interface VectorExpr {
  readonly kind: "Vector";
  readonly elements: readonly Expr[];
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

/**
 * `(e: T)` (Ascription §2.1). The written type has been through the ordinary
 * annotation path, so its type names carry their identities for the occurrence
 * index and its holes carry resolver-assigned ids — an ascribed type is an
 * annotation, and nothing here is special-cased.
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
  readonly alternative: Expr;
  // See Parsed.IfExpr: set when the source omitted `else` (`else ()` sugar).
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
  /** The match catch clause's arms (Exceptions §5.4, #500); absent is a plain `match`. */
  readonly catchArms?: readonly MatchArm[];
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
  /** The written call mark (#355 ruling 2); absent is the bare call. */
  readonly mark?: "bang" | "question";
  readonly markSpan?: Source.Span;
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

export interface HashExpr {
  readonly kind: "Hash";
  readonly value: Expr;
  readonly span: Source.Span;
}

/**
 * A compiler-known operation in a collection companion that has no `.hex` module
 * to own it — **`Node` alone** since the Map/Set arc closed (#373).
 *
 * `Vector` left this family at its intrinsic-door milestone
 * (`spec/intrinsics.md` §9.2): `stdlib/Vector.hex` is a prelude module and
 * declares its boundary operations through the door, so a `Vector.` spelling is
 * an ordinary qualified reference. `Map` left at its own milestone (#370) and
 * `Set` at the arc's last (#373), on the same terms. `Node` stays out of the
 * door by §3.3 — a deliberate non-declared fallback under Modules §5.5, reached
 * only from a privileged runtime module — so it is the family's terminus, and
 * whether a one-member family is the intended one is #223.
 */
export interface CollectionOperationExpr {
  readonly kind: "CollectionOperation";
  readonly collection: "Node";
  readonly operation: string;
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
  /** A `|>` stage's own mark (#355 ruling 1); the rewrite carries it. */
  readonly mark?: "bang" | "question";
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

/** Constructs a checked stable identity for one resolver-owned foreign type. */
export function externTypeId(value: number): ExternTypeId {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("an extern type id must be a non-negative safe integer");
  }
  return value as ExternTypeId;
}
