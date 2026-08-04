/**
 * The checker implements the Hindley–Milner core needed by the current vertical
 * slices. Mutable union-find variables are private to inference; type variables
 * written in annotations are rigid while their definition is checked. The
 * returned Typed tree contains only immutable types and schemes. Implied
 * type choices substitute into ground instances and erase before emission; v1
 * rejects projection-bearing constraints on type-variable binders.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import { stronglyConnectedComponents } from "../../support/graph.js";
import {
  COMPILER_CLAIMS,
  type Declarations as VarianceDeclarations,
  flip as flipVariance,
  join as joinVariance,
  multiply as multiplyVariance,
  type Variance,
  VarianceTable,
} from "./variance.js";
import { isIntrinsicScheme } from "../../intrinsics.js";
import type * as Source from "../../support/source.js";
import { displayParameterName } from "../../support/synthetic.js";
import * as Resolved from "../../syntax/resolved/index.js";
import * as Typed from "../../syntax/typed/index.js";

export interface CheckOptions {
  readonly importedSchemes?: ReadonlyMap<Resolved.SymbolId, Typed.Scheme>;
  /**
   * Every nominal declaration the program has resolved so far, dependencies
   * first. The variance analysis reads it and nothing else does; see
   * `Declarations` in `variance.ts` for why the analysis cannot be sourced from
   * one module's own view. Absent — a lone `check` in a test — the analysis
   * falls back to that view, which is complete for a single-module program.
   */
  readonly programNominals?: VarianceDeclarations;
}

export function check(
  module: Resolved.Module,
  options: CheckOptions = {},
): Typed.Module {
  const diagnostics = new Diagnostics.Bag();
  for (const diagnostic of module.diagnostics) diagnostics.add(diagnostic);
  return new Checker(diagnostics, options).check(module);
}

type Mono =
  | Variable
  | Constructor
  | TupleMono
  | RecordMono
  | RangeMono
  | VectorMono
  | MapMono
  | SetMono
  | ArrayMono
  | NodeMono
  | NullableMono
  | UnionMono
  | NominalRecordMono
  | ExternMono
  | FunctionMono
  | ErrorMono;

interface Variable {
  readonly kind: "Variable";
  readonly id: number;
  readonly rigidName?: string;
  readonly declaredConstraints?: readonly Typed.ConstraintName[];
  /**
   * Set on the stand-in for a module-level `let`/`var` that a function captures
   * before the binding itself is checked. It denotes one binding's single type,
   * so it must neither be quantified by a sibling's generalization (kept out by
   * its level) nor absorbed by a declared type variable (rejected in `#bind`).
   */
  placeholder?: boolean;
  /**
   * A source-shaped name for a variable that survives into a diagnostic the
   * Rewrite Rule makes mandatory. Numeric Literals §6 requires survivors in
   * those reports to be "named rather than numbered"; `?3` is what this
   * replaces. Display only — it never affects unification, unlike `rigidName`.
   */
  displayName?: string;
  level: number;
  instance?: Mono;
  literalOnly: boolean;
  readonly requirements: Requirement[];
  readonly rejectedConstraints: Set<Typed.ConstraintName>;
}

interface Constructor {
  readonly kind: "Constructor";
  readonly name: Typed.PrimitiveName;
}

interface FunctionMono {
  readonly kind: "Function";
  readonly parameters: readonly Mono[];
  readonly result: Mono;
}

interface TupleMono {
  readonly kind: "Tuple";
  readonly elements: readonly Mono[];
}

interface RecordMono {
  readonly kind: "Record";
  readonly fields: ReadonlyMap<string, Mono>;
  readonly tail?: Variable;
}

interface RangeMono {
  readonly kind: "Range";
}

interface VectorMono {
  readonly kind: "Vector";
  readonly element: Mono;
}

interface MapMono {
  readonly kind: "Map";
  readonly key: Mono;
  readonly value: Mono;
}

interface SetMono {
  readonly kind: "Set";
  readonly element: Mono;
}

interface ArrayMono {
  readonly kind: "Array";
  readonly element: Mono;
}

/** The hidden fixed-32 runtime trie node; see the persistent-collections note §4. */
interface NodeMono {
  readonly kind: "Node";
  readonly element: Mono;
}

interface NullableMono {
  readonly kind: "Nullable";
  readonly value: Mono;
}

interface UnionMono {
  readonly kind: "Union";
  readonly union: Resolved.UnionId;
  readonly name: string;
  readonly arguments: readonly Mono[];
}

interface NominalRecordMono {
  readonly kind: "NominalRecord";
  readonly record: Resolved.RecordId;
  readonly name: string;
  readonly arguments: readonly Mono[];
}

interface ExternMono {
  readonly kind: "ExternType";
  readonly externType: Resolved.ExternTypeId;
  readonly name: string;
}

interface ErrorMono {
  readonly kind: "Error";
}

interface Requirement {
  readonly name: Typed.ConstraintName;
  readonly type: Mono;
  readonly span: Source.Span;
  readonly origin: "annotation" | "literal" | "operation" | "interpolation";
  /** The literal's digits, so §6's blocked-defaulting report can name it. */
  literal?: string;
  /**
   * Where the scheme carrying this requirement was *used*. `span` points at
   * the definition, which a copy inherits, so a report about the use — §6's
   * blocked-defaulting one — would otherwise caret a constraint declaration,
   * or another module's source entirely.
   */
  useSpan?: Source.Span;
  readonly impliedTypes?: ReadonlyMap<string, Mono>;
  evidenceConstraint?: Typed.ConstraintName;
  evidencePath?: readonly string[];
  reported: boolean;
  dictionary?: string;
  structural?: boolean;
  dictionaryArguments?: readonly Requirement[];
}

interface Scheme {
  readonly variables: readonly Variable[];
  readonly type: Mono;
  readonly constraint?: string;
  readonly impliedTypes?: ReadonlyMap<string, Variable>;
}

const ERROR: ErrorMono = { kind: "Error" };

/**
 * The level given to the fresh stand-ins for an instance's own type parameters
 * (`#pinInstanceSubject`). Deliberately above every inference level: each one
 * either unifies with a variable from the requirement's type — and `#bind`
 * sinks it to that variable's level — or is never reachable from any binding's
 * type, so nothing quantifies it either way.
 */
const INSTANCE_LEVEL = Number.MAX_SAFE_INTEGER;

/**
 * `Unit` is the empty tuple (#159, Products §2.7): the arity-0 member of the
 * structural tuple family, not a primitive. One interned value is enough —
 * tuple unification is structural, so identity is a fast path, never a
 * requirement — and using it everywhere keeps the checker honest about there
 * being exactly one such type: nothing else ever constructs an arity-0 tuple,
 * because `()` is not a type expression (Products §2.7) and the tuple forms
 * start at arity 2.
 */
const UNIT: TupleMono = { kind: "Tuple", elements: [] };

/** The constraints every structural product satisfies componentwise (Constraints §4.5). */
const structuralConstraints = ["Eq", "Ord", "Show", "Hash"];

function primitive(name: Typed.PrimitiveName): Constructor {
  return { kind: "Constructor", name };
}

/**
 * A compiler-known constructor's claim (closure doc §5.3). A constructor with
 * no row is invariant, and item 7 declines its variables — the answer that
 * withholds generalization rather than granting it on a claim nobody made.
 */
function compilerClaim(constructor: string, slot: number): Variance {
  return COMPILER_CLAIMS.get(constructor)?.[slot] ?? "inv";
}

/** How an occurrence's sign reads in a report, in position words rather than lattice ones. */
function positionPhrase(variance: Variance): string {
  if (variance === "contra") return "in argument position";
  if (variance === "co") return "in result position";
  return "in an invariant position";
}

class Checker {
  readonly #expressionTypes = new WeakMap<Resolved.Expr, Mono>();
  readonly #requirements = new WeakMap<object, readonly Requirement[]>();
  /** Exact Nat expressions that checking injects into an independently known Num target. */
  readonly #natWidenings = new WeakMap<Resolved.Expr, Requirement>();
  /** Exact Int expressions that checking injects into an independently known Signed target. */
  readonly #intWidenings = new WeakMap<Resolved.Expr, Requirement>();
  readonly #nameRequirements = new WeakMap<Resolved.NameExpr, readonly Requirement[]>();
  /** Name references serving as a call callee, whose evidence the call supplies. */
  readonly #calleeNames = new WeakSet<Resolved.NameExpr>();
  readonly #callRequirements = new WeakMap<Resolved.CallExpr, readonly Requirement[]>();
  readonly #pipeCalls = new WeakMap<Resolved.BinaryExpr, Resolved.CallExpr>();
  readonly #dotCalls = new WeakMap<Resolved.CallExpr, {
    readonly symbol: Resolved.Symbol;
    readonly callee: Mono;
    readonly receiver: Resolved.Expr;
  }>();
  readonly #tupleAccesses = new WeakMap<Resolved.AccessExpr, number>();
  readonly #recordAccesses = new WeakMap<Resolved.AccessExpr, string>();
  readonly #indexOperations = new WeakMap<Resolved.IndexExpr, NonNullable<Typed.IndexExpr["operation"]>>();
  readonly #matchUnions = new WeakMap<Resolved.MatchExpr, Resolved.UnionId>();
  readonly #iterations = new WeakMap<Resolved.ForExpr, Requirement>();
  readonly #schemes = new Map<Resolved.SymbolId, Scheme>();
  // The enclosing definition's declared type variables, in scope while its body is
  // checked, so a body-local `let`/`var` annotation naming `a` resolves to the same
  // `a` as the signature (functions.md §4.1). `undefined` at module level, where each
  // binding is its own definition and gets a fresh scope. Saved/restored per lambda.
  #annotationVariableScope: Map<string, Variable> | undefined = undefined;
  readonly #unions = new Map<Resolved.UnionId, Resolved.Union>();
  readonly #constructorUnions = new Map<Resolved.SymbolId, Resolved.UnionId>();
  readonly #unionParameters = new Map<Resolved.UnionId, ReadonlyMap<string, Variable>>();
  readonly #records = new Map<Resolved.RecordId, Resolved.RecordDeclaration>();
  /**
   * The prelude `Seq` record's identity (Loops §6.6). `Seq(a)` is a declared
   * type, not a compiler intrinsic, so every compiler-side producer —
   * `Map.keys`, `Set.toSeq`, `Vector.toSeq`/`fromSeq`, `for x in` — has to name
   * *this* declaration rather than mint a structural type of its own, or the two
   * coexist under one name and nothing a user writes will unify with either.
   * Absent only in a module the prelude `Seq` cannot reach: the earlier prelude
   * members, and `Seq.hex` itself.
   */
  #seqRecord: Resolved.RecordId | undefined;
  /**
   * The prelude `Bool` union's identity (#147). `Bool` stopped being a primitive
   * and became `union Bool = False | True` declared in `stdlib/Bool.hex`, so every
   * condition, guard, logic operand, comparison result, and compiler-known
   * predicate has to name *that* declaration. Taken from `preludeUnions` rather
   * than by scanning names, so a module declaring its own `Bool` occludes the
   * spelling (§5.4) without redirecting `if`. The local-declaration fallback
   * exists for exactly one module: `Bool.hex` itself, where the prelude cannot
   * supply what the file is in the middle of declaring.
   */
  #boolUnion: Resolved.UnionId | undefined;
  /**
   * Per intrinsic declaration, the variables its annotations introduced. Shared
   * between scheme construction and materialization so both name the same
   * variables — without it the materialized result type would carry a fresh
   * variable unrelated to the scheme's, and the emitted `.d.ts` face would
   * quantify one `a` while returning another.
   */
  readonly #intrinsicTypeParameters = new WeakMap<Resolved.ExternFunDeclaration, Map<string, Mono>>();
  readonly #externTypes = new Map<Resolved.ExternTypeId, Resolved.ExternTypeDeclaration>();
  readonly #recordParameters = new Map<Resolved.RecordId, ReadonlyMap<string, Variable>>();
  readonly #recordFields = new Map<Resolved.RecordId, ReadonlyMap<string, Mono>>();
  readonly #recordConstructors = new Set<Resolved.SymbolId>();
  readonly #aliasParameters = new WeakMap<Resolved.TypeAliasItem, ReadonlyMap<string, Variable>>();
  readonly #exceptions = new Map<Resolved.SymbolId, Resolved.ExceptionItem>();
  readonly #operationsByName = new Map<string, Resolved.Symbol>();
  readonly #operationSpellings = new Map<Resolved.SymbolId, string>();
  readonly #constraintNames = new Set<string>([
    "Num", "Signed", "Frac", "Pow", "Concat", "Eq", "Ord", "Show", "Hash", "Iterable", "Integral",
  ]);
  readonly #constraintSubjects = new WeakMap<Resolved.ConstraintItem, Variable>();
  readonly #constraintImpliedTypes = new WeakMap<
    Resolved.ConstraintItem,
    ReadonlyMap<string, Variable>
  >();
  readonly #instances = new Map<string, Resolved.HonorItem>();
  readonly #instanceIdentities = new Map<string, string>();
  readonly #constraintDeclarations = new Map<string, Resolved.ConstraintItem>();
  readonly #projectionBearingConstraints = new Set<string>();
  readonly #instanceTypeParameters = new WeakMap<
    Resolved.HonorItem,
    ReadonlyMap<string, Variable>
  >();
  readonly #instanceSubjects = new WeakMap<Resolved.HonorItem, Mono>();
  readonly #instanceBaseConstraints = new WeakMap<Resolved.HonorItem, readonly Requirement[]>();
  readonly #mutableSymbols = new Set<Resolved.SymbolId>();
  /**
   * Every symbol this module can name, imports included (the resolver puts both
   * in `module.symbols`). The syntactic-value test reads the *kind* here rather
   * than the punctuation at the use site, which is what makes a module-qualified
   * reference non-expansive for the same reason its bare spelling is: `Seq.empty`
   * resolves to a `Name` carrying the imported symbol (Functions §8.2, closure
   * doc §2.1).
   */
  readonly #symbolKinds = new Map<Resolved.SymbolId, Resolved.SymbolKind>();
  /**
   * The variance of every constructor this module can name (closure doc §5).
   * Read by Step 2's covariance clause and by §6.3's claim verification; empty
   * until `check` installs it, which is before any inference runs.
   */
  #variance = new VarianceTable([], []);
  readonly #variables: Variable[] = [];
  readonly #quantified = new Set<number>();
  readonly #diagnostics: Diagnostics.Bag;
  readonly #importedSchemes: ReadonlyMap<Resolved.SymbolId, Typed.Scheme>;
  readonly #programNominals: VarianceDeclarations;
  #nextVariable = 0;

  constructor(diagnostics: Diagnostics.Bag, options: CheckOptions) {
    this.#diagnostics = diagnostics;
    this.#importedSchemes = options.importedSchemes ?? new Map();
    this.#programNominals = options.programNominals ?? { unions: [], records: [] };
  }

  check(module: Resolved.Module): Typed.Module {
    for (const symbol of module.symbols) this.#symbolKinds.set(symbol.id, symbol.kind);
    // This module's own view first — its copy of a declaration is authoritative
    // — then the whole program's, which is what §6.4's uniformity needs and what
    // the module's view alone cannot supply: a nominal reached only through a
    // re-exported alias, or through an imported function's type, is not in
    // `module.records` at all and would read as invariant here and covariant one
    // import away.
    this.#variance = new VarianceTable(
      module.unions,
      module.records,
      this.#programNominals,
    );
    this.#seqRecord = module.preludeRecords.get("Seq");
    // The fallback is deliberately guarded on the prelude being *absent
    // entirely*, not merely on `Bool` being missing from it. Reaching for a
    // locally declared `Bool` in any other circumstance would hand a user's own
    // `union Bool` the pin and the structural instances (#147). Only one module
    // satisfies the guard: `stdlib/Bool.hex`, declaring what the prelude cannot
    // yet supply to it. The emitter and the specialization planner use the same
    // form; they must agree, or one pass pins what another does not.
    this.#boolUnion = module.preludeUnions.get("Bool")
      ?? (module.preludeUnions.size === 0
        ? module.unions.find((union) => union.name === "Bool")?.id
        : undefined);
    this.#verifyPinnedBoolShape(module);
    this.#verifyVarianceClaims(module);
    for (const externType of module.externTypes) {
      this.#externTypes.set(externType.externType, externType);
    }
    // Every import form, not just `import * as`: a companion dot call emits the
    // *local* spelling, and a named import — including the synthesized prelude
    // one — may bind a symbol under a dodging local (`__hex_prelude_map`) to
    // clear a module-level binding of the same name. Reading only namespace
    // forms here emitted the source name and referenced nothing.
    for (const item of module.items) {
      if (item.kind !== "Import" || item.form.kind === "Effect") continue;
      for (const name of item.form.names) {
        if (name.symbol !== undefined) this.#operationSpellings.set(name.symbol, name.local);
      }
    }
    for (const [symbol, scheme] of this.#importedSchemes) {
      this.#schemes.set(symbol, this.#importScheme(scheme));
    }
    for (const item of module.items) {
      if (item.kind !== "TypeAlias") continue;
      this.#aliasParameters.set(item, new Map(
        item.parameters.map((name) => [name, this.#fresh(0, false)] as const),
      ));
    }
    for (const item of module.items) {
      if (item.kind === "ConstraintDeclaration") {
        this.#constraintNames.add(item.name);
        this.#constraintDeclarations.set(item.name, item);
        if (item.impliedTypes.length > 0) {
          this.#projectionBearingConstraints.add(item.name);
        }
      }
    }
    // The prelude's instances are in scope by Modules §5.5, not by import, so
    // they are seeded before anything the import list says (#153). Availability
    // used to ride the synthesized prelude import, which only a *term* reference
    // synthesizes — so a module naming only prelude *types* had no evidence for
    // `Ordering == Ordering`. Seeding first also decides which copy wins when the
    // same identity arrives twice: an explicit `import { Some } from "./Option"`
    // carries `Eq<Option>` as well, and `identity` is stable across every hop, so
    // that copy dedups silently against this one instead of colliding.
    for (const instance of module.preludeInstances) this.#seedImportedInstance(instance);
    for (const item of module.items) {
      if (item.kind !== "Import") continue;
      for (const imported of item.instances) this.#seedImportedInstance(imported);
    }
    for (const item of module.items) {
      if (item.kind === "Honor") {
        this.#checkInstanceHead(item, module.items);
        const typeParameters = new Map(
          item.typeParameters.map(({ name }) => [name, this.#fresh(0, false)] as const),
        );
        // An instance's parameters are universally quantified by its header,
        // exactly as a constraint's subject is below: `honor<a: Render>` binds
        // `a`, so it is never an unresolved variable for defaulting to settle
        // — nor one for §4's blocked-defaulting report to name.
        for (const variable of typeParameters.values()) this.#quantified.add(variable.id);
        this.#instanceTypeParameters.set(item, typeParameters);
        for (const parameter of item.typeParameters) {
          const variable = typeParameters.get(parameter.name)!;
          for (const constraint of parameter.constraints) {
            if (!this.#constraintNames.has(constraint)) {
              this.#diagnostics.add({
                severity: "error",
                message: `unknown constraint \`${constraint}\``,
                primary: parameter.span,
              });
              continue;
            }
            if (this.#projectionBearingConstraints.has(constraint)) {
              this.#diagnostics.add({
                severity: "error",
                message: impliedTypeBinderMessage(constraint),
                primary: parameter.span,
              });
              continue;
            }
            this.#require(constraint, variable, parameter.span);
          }
        }
        const subject = this.#annotationType(
          item.subject,
          0,
          new Map(),
          typeParameters,
        );
        this.#instanceSubjects.set(item, subject);
        const key = this.#instanceKey(item.constraint, subject);
        if (this.#instances.has(key)) {
          this.#diagnostics.add({
            severity: "error",
            message: `duplicate instance of \`${item.constraint}<${this.#display(subject)}>\``,
            primary: item.span,
          });
        } else {
          this.#instances.set(key, item);
          this.#instanceIdentities.set(
            key,
            `${Number(module.fileId)}:${item.dictionary}`,
          );
        }
      }
    }
    for (const item of module.items) {
      if (item.kind !== "ConstraintDeclaration") continue;
      const subject = this.#fresh(0, false);
      // A constraint's subject is universally quantified by the declaration.
      // It must never participate in ordinary unresolved-variable defaulting,
      // even when the constraint happens to have an Int instance.
      this.#quantified.add(subject.id);
      this.#constraintSubjects.set(item, subject);
      const typeParameters = new Map<string, Mono>([[item.subject, subject]]);
      const impliedTypes = new Map(
        item.impliedTypes.map(({ name }) => [name, this.#fresh(0, false)] as const),
      );
      const seenImpliedTypes = new Set<string>();
      for (const impliedType of item.impliedTypes) {
        if (seenImpliedTypes.has(impliedType.name)) {
          this.#diagnostics.add({
            severity: "error",
            message: `implied type \`${impliedType.name}\` is declared more than once in \`${item.name}\``,
            primary: impliedType.span,
          });
        }
        seenImpliedTypes.add(impliedType.name);
      }
      this.#constraintImpliedTypes.set(item, impliedTypes);
      for (const member of item.members) {
        const parameters = member.parameters.map((parameter) => {
          const type = parameter.annotation === undefined
            ? ERROR
            : this.#annotationType(
                parameter.annotation,
                0,
                new Map(),
                typeParameters,
                impliedTypes,
              );
          this.#schemes.set(parameter.symbol, { variables: [], type });
          return type;
        });
        const result = this.#annotationType(
          member.returnAnnotation,
          0,
          new Map(),
          typeParameters,
          impliedTypes,
        );
        this.#require(item.name, subject, member.span);
        this.#schemes.set(member.binding.symbol, {
          variables: [subject, ...impliedTypes.values()],
          type: { kind: "Function", parameters, result },
          constraint: item.name,
          impliedTypes,
        });
      }
    }
    this.#checkBaseConstraintGraph();
    for (const item of module.items) {
      if (item.kind !== "ConstraintDeclaration") continue;
      for (const member of item.members) {
        if (member.defaultValue === undefined) continue;
        const expected = this.#prune(this.#scheme(member.binding.symbol).type);
        if (expected.kind !== "Function") continue;
        member.defaultValue.parameters.forEach((parameter, index) => {
          this.#schemes.set(parameter.symbol, {
            variables: [],
            type: expected.parameters[index] ?? ERROR,
          });
        });
        const body = this.#inferExpr(member.defaultValue.body, 1);
        this.#unify(expected.result, body, member.defaultValue.span);
        this.#expressionTypes.set(member.defaultValue, expected);
      }
    }
    for (const symbol of module.symbols) {
      if (symbol.kind === "fun" || symbol.kind === "let") {
        this.#operationsByName.set(symbol.name, symbol);
      }
    }
    for (const item of module.items) {
      if (item.kind !== "Exception") continue;
      this.#exceptions.set(item.binding.symbol, item);
      for (const slot of item.slots) {
        if (annotationHasTypeVariable(slot.annotation)) {
          this.#diagnostics.add({
            severity: "error",
            message: "exception payloads must have concrete types",
            primary: slot.span,
          });
        }
        if (
          slot.field === "message" &&
          !(slot.annotation.kind === "Primitive" && slot.annotation.name === "String")
        ) {
          this.#diagnostics.add({
            severity: "error",
            message: "exception field `message` must have type `String`",
            primary: slot.span,
          });
        }
      }
      const parameters = item.slots.map((slot) => this.#annotationType(slot.annotation));
      const result = primitive("Exn");
      this.#schemes.set(item.binding.symbol, {
        variables: [],
        type: parameters.length === 0
          ? result
          : { kind: "Function", parameters, result },
      });
    }
    for (const item of module.items) {
      if (item.kind !== "ExternBlock") continue;
      // The intrinsic door is not a foreign boundary (`spec/intrinsics.md` §6):
      // no foreign calling convention applies, so neither of the two rules below
      // does. Genericity is granted inside it (§3.4) because the compiler owns
      // every instantiation's representation, and there is no crossing for an
      // adapter-requiring type to be nested in — a `Seq` here stays a `Seq`.
      const intrinsic = isIntrinsicScheme(item.specifier);
      for (const declaration of item.declarations) {
        if (declaration.kind === "ExternType") continue;
        const annotations = declaration.kind === "ExternFun"
          ? [
              ...declaration.parameters.flatMap((parameter) =>
                parameter.annotation === undefined ? [] : [parameter.annotation]
              ),
              declaration.returnAnnotation,
            ]
          : [declaration.annotation];
        if (!intrinsic && annotations.some(annotationHasTypeVariable)) {
          this.#diagnostics.add({
            severity: "error",
            message: "generic extern declarations are not part of Hexagon v1",
            primary: declaration.span,
          });
        }
        if (!intrinsic) {
          for (const annotation of annotations) {
            const nested = nestedAdapterType(annotation, this.#seqRecord);
            if (nested !== undefined) {
              this.#diagnostics.add({
                severity: "error",
                message: `extern type \`${nested}\` requires adaptation inside a direct value; use an explicit eager conversion at the boundary or a foreign shim`,
                primary: annotation.span,
              });
            }
          }
        }
        if (intrinsic && declaration.kind === "ExternFun") {
          // Typed from the annotation, in the declaring module's own scope, and
          // generalized over the variables the annotation mentions — an ordinary
          // annotated export in every respect after this point (§3.1, §6). The
          // variable map is kept so materialization reuses these very variables
          // rather than minting a second, unrelated set.
          const typeParameters = new Map<string, Mono>();
          this.#intrinsicTypeParameters.set(declaration, typeParameters);
          const parameters = declaration.parameters.map((parameter) => {
            const type = parameter.annotation === undefined
              ? ERROR
              : this.#annotationType(parameter.annotation, 0, new Map(), typeParameters);
            this.#schemes.set(parameter.symbol, { variables: [], type });
            return type;
          });
          // Every annotation is interned before the quantified set is read.
          // `typeParameters` is filled in as variables are first *encountered*,
          // so snapshotting it while the result annotation is still uninterned
          // would leave a result-only variable free — a module-global unification
          // variable shared by every consumer, which the first call site would
          // then pin for all the others. `seqMemoize` happens not to have one;
          // the nullary producers §9.2 binds to the `Vector` arc (`empty<a>():
          // Vector(a)`) are exactly that shape.
          const result = this.#annotationType(
            declaration.returnAnnotation, 0, new Map(), typeParameters,
          );
          this.#schemes.set(declaration.binding.symbol, {
            variables: [...typeParameters.values()].flatMap((type) =>
              type.kind === "Variable" ? [type] : []
            ),
            type: { kind: "Function", parameters, result },
          });
          continue;
        }
        if (declaration.kind === "ExternLet") {
          this.#schemes.set(declaration.binding.symbol, {
            variables: [],
            type: this.#annotationType(declaration.annotation),
          });
          continue;
        }
        const parameters = declaration.parameters.map((parameter) => {
          const type = parameter.annotation === undefined
            ? ERROR
            : this.#annotationType(parameter.annotation);
          this.#schemes.set(parameter.symbol, { variables: [], type });
          return type;
        });
        this.#schemes.set(declaration.binding.symbol, {
          variables: [],
          type: {
            kind: "Function",
            parameters,
            result: this.#annotationType(declaration.returnAnnotation),
          },
        });
      }
    }
    for (const record of module.records) {
      this.#records.set(record.id, record);
      this.#recordConstructors.add(record.constructor.symbol);
      const typeParameters = new Map(
        record.parameters.map((name) => [name, this.#fresh(0, false)] as const),
      );
      this.#recordParameters.set(record.id, typeParameters);
      const fields = new Map(record.fields.map((field) => [
        field.name,
        this.#annotationType(field.annotation, 0, new Map(), typeParameters),
      ]));
      this.#recordFields.set(record.id, fields);
      const result: NominalRecordMono = {
        kind: "NominalRecord",
        record: record.id,
        name: record.name,
        arguments: [...typeParameters.values()],
      };
      this.#schemes.set(record.constructor.symbol, {
        variables: [...typeParameters.values()],
        type: {
          kind: "Function",
          parameters: [{ kind: "Record", fields }],
          result,
        },
      });
    }
    for (const union of module.unions) {
      this.#unions.set(union.id, union);
      const typeParameters = new Map(
        union.parameters.map((name) => [name, this.#fresh(0, false)] as const),
      );
      this.#unionParameters.set(union.id, typeParameters);
      const type: UnionMono = {
        kind: "Union",
        union: union.id,
        name: union.name,
        arguments: [...typeParameters.values()],
      };
      for (const constructor of union.constructors) {
        this.#constructorUnions.set(constructor.binding.symbol, union.id);
        const slotParameters = constructor.slots.map((slot) =>
          this.#annotationType(slot.annotation, 0, new Map(), typeParameters)
        );
        this.#schemes.set(constructor.binding.symbol, {
          variables: [...typeParameters.values()],
          type: slotParameters.length === 0
            ? type
            : { kind: "Function", parameters: slotParameters, result: type },
        });
      }
    }
    this.#inferItems(module.items, 0, true);
    this.#defaultRemainingVariables();
    this.#checkPublicSignatures(module.items);

    const symbols = module.symbols.map((symbol) => ({
      ...symbol,
      scheme: this.#publicScheme(this.#scheme(symbol.id)),
    }));

    return {
      kind: "Module",
      fileId: module.fileId,
      items: module.items.map((item) => this.#materializeItem(item)),
      symbols,
      unions: module.unions.map((union) => this.#materializeUnion(union)),
      records: module.records.map((record) => this.#materializeRecord(record)),
      preludeRecords: module.preludeRecords,
      preludeUnions: module.preludeUnions,
      preludeInstances: module.preludeInstances,
      preludeTypeImports: module.preludeTypeImports,
      externTypes: module.externTypes,
      comments: module.comments,
      docs: module.docs,
      span: module.span,
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  #checkInstanceHead(
    item: Resolved.HonorItem,
    moduleItems: readonly Resolved.Item[],
  ): void {
    const subject = item.subject;
    const nominal = subject.kind === "Union" || subject.kind === "RecordDeclaration";
    if (item.typeParameters.length > 0) {
      const arguments_ = nominal ? subject.arguments : [];
      const names = arguments_.flatMap((argument) =>
        argument.kind === "TypeVariable" ? [argument.name] : []
      );
      const declared = item.typeParameters.map(({ name }) => name);
      const lawful = nominal && names.length === arguments_.length &&
        new Set(names).size === names.length &&
        names.length === declared.length &&
        declared.every((name) => names.includes(name));
      if (!lawful) {
        this.#diagnostics.add({
          severity: "error",
          message: "a parameterized instance head must be a nominal constructor applied once to each distinct instance parameter",
          primary: item.subject.span,
        });
      }
    } else if (subject.kind === "Primitive" && subject.name === "Unit") {
      // `Unit` is the empty tuple (#159), and structural types are user-closed
      // (Constraints §9.3): the spelling resolves like a primitive name, but an
      // instance may not target it any more than it may target `(Int, Int)`.
      this.#diagnostics.add({
        severity: "error",
        message:
          "instances are keyed on type constructors; tuples and structural records " +
          "have compiler-derived instances only — declare a nominal `record` or " +
          "`union` for a type you control",
        primary: item.subject.span,
      });
    } else if (
      subject.kind !== "Primitive" &&
      subject.kind !== "Union" &&
      subject.kind !== "RecordDeclaration"
    ) {
      this.#diagnostics.add({
        severity: "error",
        message: "an instance head must name a primitive or nominal type constructor",
        primary: item.subject.span,
      });
    }

    const ownsConstraint = this.#constraintDeclarations.has(item.constraint);
    const ownsSubject = moduleItems.some((candidate) =>
      (subject.kind === "Union" && candidate.kind === "Union" && candidate.union === subject.union) ||
      (subject.kind === "RecordDeclaration" &&
        candidate.kind === "RecordDeclaration" &&
        candidate.record === subject.record)
    );
    if (!ownsConstraint && !ownsSubject) {
      this.#diagnostics.add({
        severity: "error",
        message: `orphan instance: this module declares neither \`${item.constraint}\` nor the instance subject`,
        primary: item.span,
      });
    }
  }

  #inferItems(
    items: readonly Resolved.Item[],
    level: number,
    moduleItems: boolean,
  ): Mono {
    const sequentialPlaceholders = new Map<Resolved.SymbolId, Variable>();
    const recursiveTypes = new Map<Resolved.SymbolId, Variable>();

    // The symbols each function references, computed once and reused for both
    // captured-binding detection and the function dependency graph.
    const funItems = items.filter((item): item is Resolved.FunItem => item.kind === "Fun");
    const funReferences = new Map<Resolved.SymbolId, ReadonlySet<Resolved.SymbolId>>(
      funItems.map((item) => [item.binding.symbol, referencedSymbols(item.value)]),
    );
    const funBySymbol = new Map(funItems.map((item) => [item.binding.symbol, item]));
    const funSymbols = new Set(funBySymbol.keys());

    // A `let`/`var` captured by some function is installed as a monomorphic
    // placeholder before any function body is checked, so bodies can refer to it.
    const capturedSequential = new Set<Resolved.SymbolId>();
    for (const references of funReferences.values()) {
      for (const symbol of references) capturedSequential.add(symbol);
    }

    // ...except for `let`s, which generalize. Being captured must not cost one
    // that: a monomorphic placeholder fuses every caller's use into one type, so
    // a generic `let helper` called from two functions at two element types — or
    // from one function under a declared type variable — collapses. Such bindings
    // join the dependency-ordered pass below instead, generalized before the
    // bodies that use them.
    //
    // Every `let`, not only the ones whose RHS is a syntactic value. That gate
    // was right while generalization was all-or-nothing, and #205's item 7 made
    // it wrong: an expansive RHS now generalizes per variable, so a placeheld
    // expansive binding does not "stay monomorphic", it loses the variables item
    // 7 would have granted it. The closure doc's own headline example is the
    // case — `let xs = makeEmpty()` generalizes (§4.4), and under the old gate it
    // stopped doing so the moment any function mentioned `xs`. Which function
    // mentions a binding is not something the ruling conditions an answer on.
    //
    // What made the gate look load-bearing is that the three ways a binding can
    // be unsound to share are all item 7's clauses, and it asks them whichever
    // path the binding took: a constrained variable is declined by clause (a), a
    // contravariant or invariant one by clause (b), and a declined variable is
    // sunk back to `level` in `#generalize` — so it can no more be quantified
    // into a sibling's scheme than a placeholder could. `var` keeps the
    // placeholder unconditionally: a `var` is a cell, and item 7 governs
    // generalization, not state.
    const letBySymbol = new Map(
      items.flatMap((item) => (item.kind === "Let" ? [[item.binding.symbol, item] as const] : [])),
    );
    const promotedLets = new Map<Resolved.SymbolId, Resolved.LetItem>();
    for (let growing = true; growing;) {
      growing = false;
      for (const [symbol, item] of letBySymbol) {
        if (promotedLets.has(symbol)) continue;
        if (!capturedSequential.has(symbol)) continue;
        promotedLets.set(symbol, item);
        // Whatever the promoted binding itself references is now needed before the
        // graph runs, so it must be placeheld (or promoted) in turn.
        for (const referenced of referencedSymbols(item.value)) {
          if (!capturedSequential.has(referenced)) {
            capturedSequential.add(referenced);
            growing = true;
          }
        }
      }
    }

    for (const item of items) {
      if (
        (item.kind === "Let" || item.kind === "Var") &&
        capturedSequential.has(item.binding.symbol) &&
        !promotedLets.has(item.binding.symbol)
      ) {
        // At `level`, not `level + 1`. A placeholder stands for one binding
        // holding one value of one type, and `#generalize` quantifies exactly the
        // variables above the level it generalizes at — so a placeholder one level
        // deeper would be quantified into any sibling's scheme that mentions it.
        // Each consumer would then instantiate a fresh copy and the single runtime
        // value would be handed out at two types, with two evidence dictionaries at
        // constrained types. A placeholder sits *at* the generalization boundary,
        // so nothing quantifies it and the value restriction survives being read
        // through an intermediary.
        const placeholder = this.#fresh(level, false);
        placeholder.placeholder = true;
        sequentialPlaceholders.set(item.binding.symbol, placeholder);
        this.#schemes.set(item.binding.symbol, { variables: [], type: placeholder });
      }
    }

    // Functions are checked in dependency order — the strongly-connected
    // components of the function-reference graph, dependencies before dependents
    // (issue #66, functions.md §4.1/§4.2). A reference to a function *outside* the
    // current component resolves to an already-generalized scheme and is
    // instantiated fresh per use (let-polymorphism); only genuine mutual recursion
    // shares a monomorphic component, whose members' provisional monotypes are
    // installed together before any of their bodies is checked.
    // The graph carries promoted `let`s alongside the `fun`s, so a generic helper
    // is generalized before whatever uses it regardless of which keyword declared it.
    const graphItems: readonly (Resolved.FunItem | Resolved.LetItem)[] = items.flatMap((item) =>
      item.kind === "Fun" || (item.kind === "Let" && promotedLets.has(item.binding.symbol))
        ? [item as Resolved.FunItem | Resolved.LetItem]
        : []
    );
    const graphBySymbol = new Map(graphItems.map((item) => [item.binding.symbol, item]));
    const graphSymbols = new Set(graphBySymbol.keys());
    const graphReferences = new Map(
      graphItems.map((item) => [item.binding.symbol, referencedSymbols(item.value)]),
    );
    const sourceIndex = new Map(graphItems.map((item, index) => [item.binding.symbol, index]));
    const bySource = (a: Resolved.SymbolId, b: Resolved.SymbolId): number =>
      sourceIndex.get(a)! - sourceIndex.get(b)!;
    const components = stronglyConnectedComponents(
      graphItems.map((item) => item.binding.symbol),
      (symbol) => [...(graphReferences.get(symbol) ?? [])].filter((referenced) => graphSymbols.has(referenced)),
    );
    for (const component of components) {
      const ordered = [...component].sort(bySource);
      for (const symbol of ordered) {
        const recursiveType = this.#fresh(level + 1, false);
        recursiveTypes.set(symbol, recursiveType);
        this.#schemes.set(symbol, { variables: [], type: recursiveType });
      }
      for (const symbol of ordered) {
        const item = graphBySymbol.get(symbol)!;
        let valueType = this.#inferExpr(item.value, level + 1);
        if (item.kind === "Let" && item.annotation !== undefined) {
          const annotationType = this.#annotationType(
            item.annotation, level + 1, new Map(), this.#annotationVariableScope ?? new Map(),
          );
          this.#unifyExpected(annotationType, valueType, item.value, item.annotation.span, true);
          if (this.#hasNumericWidening(item.value)) valueType = annotationType;
        }
        this.#unify(recursiveTypes.get(symbol)!, valueType, item.span);
      }
      for (const symbol of ordered) {
        const item = graphBySymbol.get(symbol)!;
        this.#schemes.set(
          symbol,
          this.#generalize(
            recursiveTypes.get(symbol)!,
            level,
            item.kind === "Fun" ? true : this.#isValue(item.value),
            item.kind === "Let" ? item.annotation?.span : undefined,
          ),
        );
      }
    }

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item === undefined) continue;

      if (item.kind === "Let") {
        // Promoted bindings were inferred and generalized with the graph above.
        if (promotedLets.has(item.binding.symbol)) continue;
        const inferredValueType = this.#inferExpr(item.value, level + 1);
        let valueType = inferredValueType;
        if (item.annotation !== undefined) {
          const annotationType = this.#annotationType(
            item.annotation, level + 1, new Map(), this.#annotationVariableScope ?? new Map(),
          );
          this.#unifyExpected(
            annotationType,
            inferredValueType,
            item.value,
            item.annotation.span,
            true,
          );
          if (this.#hasNumericWidening(item.value)) valueType = annotationType;
        }
        const placeholder = sequentialPlaceholders.get(item.binding.symbol);
        if (placeholder !== undefined) this.#unify(placeholder, valueType, item.span);
        const scheme = this.#generalize(
          valueType,
          level,
          this.#isValue(item.value),
          item.annotation?.span,
        );
        this.#schemes.set(item.binding.symbol, scheme);
        continue;
      }
      if (item.kind === "Import" || item.kind === "ExternBlock" || item.kind === "ExternImport") continue;
      if (item.kind === "ConstraintDeclaration") continue;
      if (item.kind === "Honor") {
        const declaration = this.#constraintDeclarations.get(item.constraint);
        if (item.derived && !["Eq", "Ord", "Show", "Hash"].includes(item.constraint)) {
          this.#diagnostics.add({
            severity: "error",
            message: `\`${item.constraint}\` cannot be derived; only \`Eq\`, \`Ord\`, \`Show\`, and \`Hash\` have derivable forms`,
            primary: item.span,
          });
          continue;
        }
        if (!item.derived && item.constraint === "Hash") {
          this.#diagnostics.add({
            severity: "error",
            message: "`Hash` instances cannot be hand-written; use `derives Hash` on the declaration of the subject type",
            primary: item.span,
          });
          continue;
        }
        if (declaration === undefined && !item.derived) {
          if (this.#checkPreludeHonor(item, level)) continue;
          this.#diagnostics.add({
            severity: "error",
            message: `unknown constraint \`${item.constraint}\``,
            primary: item.span,
          });
          continue;
        }
        if (item.derived) {
          const instanceSubject = this.#instanceSubjects.get(item) ?? ERROR;
          const actual = this.#prune(instanceSubject);
          if (actual.kind !== "Union" && actual.kind !== "NominalRecord") {
            this.#diagnostics.add({
              severity: "error",
              message: `cannot derive \`${item.constraint}<${this.#display(actual)}>\`; derivation requires a nominal record or union`,
              primary: item.span,
            });
          } else {
            for (const component of this.#derivationComponents(actual, item.span)) {
              this.#require(item.constraint, component.type, component.span);
            }
          }
          this.#instanceBaseConstraints.set(
            item,
            this.#baseConstraints(item.constraint).map((baseConstraint) =>
              this.#require(baseConstraint, instanceSubject, item.span)
            ),
          );
          if (item.constraint === "Hash") {
            const equality = this.#instances.get(this.#instanceKey("Eq", instanceSubject));
            if (equality !== undefined && !equality.derived) {
              this.#diagnostics.add({
                severity: "error",
                message: `cannot derive \`Hash<${this.#display(actual)}>\`: the subject has a hand-written \`Eq\` instance; a derived hash requires derived equality`,
                primary: item.span,
              });
            }
          }
          continue;
        }
        if (declaration === undefined) continue;
        const supplied = new Set(item.members.map(({ name }) => name));
        const instanceSubject = this.#instanceSubjects.get(item) ?? ERROR;
        this.#instanceBaseConstraints.set(
          item,
          this.#baseConstraints(item.constraint).map((baseConstraint) =>
            this.#require(baseConstraint, instanceSubject, item.span)
          ),
        );
        const impliedTypes = new Map<string, Mono>();
        for (const required of declaration.impliedTypes) {
          const bindings = item.impliedTypes.filter(({ name }) => name === required.name);
          if (bindings.length === 0) {
            this.#diagnostics.add({
              severity: "error",
              message: `instance is missing implied type \`${required.name}\``,
              primary: item.span,
            });
            impliedTypes.set(required.name, ERROR);
          } else {
            impliedTypes.set(
              required.name,
              this.#annotationType(bindings[0]!.annotation, level + 1),
            );
            if (bindings.length > 1) {
              this.#diagnostics.add({
                severity: "error",
                message: `implied type \`${required.name}\` is bound more than once in this instance`,
                primary: bindings[1]!.span,
              });
            }
          }
        }
        for (const binding of item.impliedTypes) {
          if (!declaration.impliedTypes.some(({ name }) => name === binding.name)) {
            this.#diagnostics.add({
              severity: "error",
              message: `\`${binding.name}\` is not an implied type of \`${item.constraint}\``,
              primary: binding.span,
            });
          }
        }
        for (const required of declaration.members) {
          if (required.defaultValue === undefined && !supplied.has(required.binding.name)) {
            this.#diagnostics.add({
              severity: "error",
              message: `instance is missing required member \`${required.binding.name}\``,
              primary: item.span,
            });
          }
        }
        for (const member of item.members) {
          const firstDefinition = item.members.findIndex(
            ({ name }) => name === member.name,
          );
          if (firstDefinition !== item.members.indexOf(member)) {
            this.#diagnostics.add({
              severity: "error",
              message: `instance member \`${member.name}\` is defined more than once`,
              primary: member.span,
            });
            this.#inferExpr(member.value, level + 1);
            continue;
          }
          const required = declaration.members.find(
            ({ binding }) => binding.name === member.name,
          );
          if (required === undefined) {
            this.#diagnostics.add({
              severity: "error",
              message: `\`${member.name}\` is not a member of \`${item.constraint}\``,
              primary: member.span,
            });
            this.#inferExpr(member.value, level + 1);
            continue;
          }
          const subjectTypes = new Map([[declaration.subject, instanceSubject]]);
          const expectedFunction: FunctionMono = {
            kind: "Function",
            parameters: required.parameters.map((parameter) =>
              parameter.annotation === undefined
                ? ERROR
                : this.#annotationType(
                    parameter.annotation,
                    level + 1,
                    new Map(),
                    subjectTypes,
                    impliedTypes,
                  )
            ),
            result: this.#annotationType(
              required.returnAnnotation,
              level + 1,
              new Map(),
              subjectTypes,
              impliedTypes,
            ),
          };
          if (expectedFunction.parameters.length !== member.value.parameters.length) {
            this.#diagnostics.add({
              severity: "error",
              message: `instance member \`${member.name}\` expects ${expectedFunction.parameters.length} parameters, got ${member.value.parameters.length}`,
              primary: member.span,
            });
          }
          member.value.parameters.forEach((parameter, index) => {
            const expectedParameter = expectedFunction.parameters[index] ?? ERROR;
            this.#schemes.set(parameter.symbol, {
              variables: [],
              type: expectedParameter,
            });
            if (parameter.annotation !== undefined) {
              this.#unify(
                this.#annotationType(
                  parameter.annotation,
                  level + 1,
                  new Map(),
                  new Map(),
                  impliedTypes,
                ),
                expectedParameter,
                parameter.annotation.span,
              );
            }
          });
          const body = this.#inferExpr(member.value.body, level + 1);
          this.#unify(expectedFunction.result, body, member.span);
          this.#expressionTypes.set(member.value, expectedFunction);
        }
        continue;
      }

      if (item.kind === "Var") {
        const inferredValueType = this.#inferExpr(item.value, level + 1);
        let valueType = inferredValueType;
        if (item.annotation !== undefined) {
          const annotationType = this.#annotationType(
            item.annotation, level + 1, new Map(), this.#annotationVariableScope ?? new Map(),
          );
          this.#unifyExpected(
            annotationType,
            inferredValueType,
            item.value,
            item.annotation.span,
            true,
          );
          if (this.#hasNumericWidening(item.value)) valueType = annotationType;
        }
        const placeholder = sequentialPlaceholders.get(item.binding.symbol);
        if (placeholder !== undefined) this.#unify(placeholder, valueType, item.span);
        // A `var` holds one value of one type for as long as it is in scope, so
        // its variables belong to the environment and must sit at the block's
        // own level. Functions §8.4 says a `var` never generalizes; this is the
        // other half of that sentence — nothing *else* may generalize it either.
        // Before item 7, an alias `let e = v` demoted these variables on the way
        // to refusing to quantify anything; now that expansive bindings can
        // quantify, the demotion has to happen where the `var` is bound, or the
        // alias would hand out a polymorphic view of a binding that can still be
        // assigned at one type.
        const bound = placeholder ?? valueType;
        this.#lowerLevels(bound, level);
        this.#schemes.set(item.binding.symbol, { variables: [], type: bound });
        this.#mutableSymbols.add(item.binding.symbol);
        continue;
      }

      if (item.kind === "LetPattern") {
        const valueType = this.#inferExpr(item.value, level + 1);
        // `valueType` is passed twice on purpose. As the pattern's expected
        // type it is peeled apart component by component; as the *evaluated*
        // type it stays whole, and it is the whole one the evidence-seat rule
        // reads (closure doc §13.6). A destructuring `let` constructs one
        // aggregate and every binder names a projection of it, so no binder
        // here can carry a constrained scheme however function-typed its own
        // component happens to be.
        this.#inferPattern(
          item.pattern,
          valueType,
          level,
          this.#isValue(item.value),
          valueType,
        );
        continue;
      }

      if (item.kind === "Fun") {
        continue;
      }

      if (item.kind === "ExprItem") {
        const expressionType = this.#inferExpr(item.expression, level);
        if (!moduleItems && index < items.length - 1) {
          this.#defaultDiscardedLiteral(expressionType, item.expression.span);
          this.#unify(
            expressionType,
            UNIT,
            item.expression.span,
            () =>
              `this expression's value is discarded — its type is ` +
              `\`${this.#display(expressionType)}\`; wrap it in \`ignore(...)\` if ` +
              "discarding is intentional",
          );
        }
      }
      if (item.kind === "RecordDeclaration") continue;
      if (item.kind === "TypeAlias") continue;
      if (item.kind === "Exception") continue;
    }

    if (moduleItems) return UNIT;
    const finalItem = items.at(-1);
    if (finalItem === undefined || finalItem.kind === "ErrorItem") return ERROR;
    if (
      finalItem.kind === "Let" ||
      finalItem.kind === "Import" ||
      finalItem.kind === "ExternBlock" ||
      finalItem.kind === "ExternImport" ||
      finalItem.kind === "Var" ||
      finalItem.kind === "LetPattern" ||
      finalItem.kind === "Fun" ||
      finalItem.kind === "TypeAlias" ||
      finalItem.kind === "Union"
      || finalItem.kind === "RecordDeclaration"
      || finalItem.kind === "Exception"
      || finalItem.kind === "ConstraintDeclaration"
      || finalItem.kind === "Honor"
    ) {
      if (finalItem.kind === "LetPattern") {
        this.#diagnostics.add({
          severity: "error",
          message: "a block cannot end with a `let` pattern; add a final expression",
          primary: finalItem.span,
        });
        return ERROR;
      }
      if (
        finalItem.kind === "Union" ||
        finalItem.kind === "TypeAlias" ||
        finalItem.kind === "RecordDeclaration" ||
        finalItem.kind === "Exception" ||
        finalItem.kind === "ConstraintDeclaration" ||
        finalItem.kind === "Honor" ||
        finalItem.kind === "Import"
        || finalItem.kind === "ExternBlock"
        || finalItem.kind === "ExternImport"
      ) {
        this.#diagnostics.add({
          severity: "error",
          message: "declarations are only allowed at module level",
          primary: finalItem.span,
        });
        return ERROR;
      }
      const keyword = finalItem.kind === "Let" ? "let" : "fun";
      this.#diagnostics.add({
        severity: "error",
        message:
          `a block cannot end with a \`${keyword}\`; did you mean to return ` +
          `\`${finalItem.binding.name}\`?`,
        primary: finalItem.span,
      });
      return ERROR;
    }
    return this.#typeOf(finalItem.expression);
  }

  #derivationComponents(
    subject: UnionMono | NominalRecordMono,
    fallbackSpan: Source.Span,
  ): readonly { readonly type: Mono; readonly span: Source.Span }[] {
    if (subject.kind === "NominalRecord") {
      const fields = this.#nominalRecordFields(subject);
      const declaration = this.#records.get(subject.record);
      return [...fields].map(([name, type]) => ({
        type,
        span: declaration?.fields.find((field) => field.name === name)?.span ??
          declaration?.span ?? fallbackSpan,
      }));
    }
    const parameters = [...(this.#unionParameters.get(subject.union)?.values() ?? [])];
    const replacements = new Map(
      parameters.map((parameter, index) => [parameter.id, subject.arguments[index] ?? ERROR]),
    );
    const union = this.#unions.get(subject.union);
    return union?.constructors.flatMap((constructor) =>
      constructor.slots.map((slot) => ({
        type: this.#replaceVariables(
          this.#annotationType(
            slot.annotation,
            0,
            new Map(),
            this.#unionParameters.get(subject.union),
          ),
          replacements,
        ),
        span: slot.span,
      }))
    ) ?? [];
  }


  /** Checks compiler-known prelude constraint members before a source prelude exists. */
  /**
   * The prelude `Ordering` union, which `Ord.compare` returns. Resolved from the
   * registered unions (seeded from the prelude) rather than hardcoded, so the
   * contract has a single source of truth in `stdlib/Prelude.hex`.
   */
  #orderingType(span: Source.Span): Mono {
    for (const union of this.#unions.values()) {
      if (union.name === "Ordering") {
        return { kind: "Union", union: union.id, name: union.name, arguments: [] };
      }
    }
    this.#diagnostics.add({
      severity: "error",
      message: "the prelude `Ordering` union is not in scope; `Ord.compare` cannot be typed",
      primary: span,
    });
    return ERROR;
  }

  /**
   * Checks that the declaration the pin is granted to is the declaration the pin
   * was ruled for (#147 §3.5/§7: the compiler verifies this shape "the way the
   * intrinsic door verifies its inventory").
   *
   * This is not ceremony. The emitter maps a constructor named `True` to `true`
   * and everything else to `false`, and derived `Ord` emits
   * `(l ? 1 : 0) - (r ? 1 : 0)` on the strength of the declaration order — so a
   * reordered or three-constructor `Bool.hex` would silently emit wrong constants
   * and inverted comparisons rather than the compiler-integrity error §3.2
   * promises. It is also the proof obligation of satisfying `Bool`'s constraints
   * structurally: "structural agrees with derived by construction" is only true
   * while the declaration says what the structural code assumes.
   *
   * Not user-reachable — the prelude sources are embedded in the compiler — so a
   * failure here means the compiler's own stdlib copy is wrong, and the message
   * says so rather than blaming the program being compiled.
   */
  #verifyPinnedBoolShape(module: Resolved.Module): void {
    if (this.#boolUnion === undefined) return;
    const declaration = module.unions.find(({ id }) => id === this.#boolUnion);
    if (declaration === undefined) return;
    const constructors = declaration.constructors.map(({ binding, slots }) => ({
      name: binding.name,
      nullary: slots.length === 0,
    }));
    const shapeIsRight = declaration.parameters.length === 0 &&
      constructors.length === 2 &&
      constructors[0]?.name === "False" && constructors[0].nullary &&
      constructors[1]?.name === "True" && constructors[1].nullary &&
      ["Eq", "Ord", "Show", "Hash"].every((constraint) =>
        declaration.derives.includes(constraint)
      );
    if (shapeIsRight) return;
    this.#diagnostics.add({
      severity: "error",
      message:
        "compiler integrity: the prelude `Bool` must be declared exactly " +
        "`union Bool derives (Eq, Ord, Show, Hash) = False | True`, in that " +
        "constructor order — the representation pin and derived `Ord` both " +
        `depend on it; found \`${
          constructors.map(({ name }) => name).join(" | ")
        }\``,
      primary: declaration.span,
    });
  }

  /**
   * `Bool` as the compiler's own producers must speak it (#147). The same shape
   * as `#orderingType`, and absent for the same kind of reason — a module the
   * prelude `Bool` cannot reach — except that here the only such module declares
   * `Bool` itself and the constructor's fallback has already found it.
   */
  #boolType(span: Source.Span): Mono {
    if (this.#boolUnion === undefined) {
      this.#diagnostics.add({
        severity: "error",
        message: "the prelude `Bool` union is not in scope; a condition cannot be typed",
        primary: span,
      });
      return ERROR;
    }
    return { kind: "Union", union: this.#boolUnion, name: "Bool", arguments: [] };
  }

  #checkPreludeHonor(item: Resolved.HonorItem, level: number): boolean {
    const subject = this.#instanceSubjects.get(item) ?? ERROR;
    const members = new Map<string, { parameters: readonly Mono[]; result: Mono; optional?: boolean }>();
    const binary = { parameters: [subject, subject], result: subject };
    if (item.constraint === "Eq") {
      members.set("equals", { parameters: [subject, subject], result: this.#boolType(item.span) });
      members.set("notEquals", {
        parameters: [subject, subject],
        result: this.#boolType(item.span),
        optional: true,
      });
    } else if (item.constraint === "Ord") {
      members.set("compare", { parameters: [subject, subject], result: this.#orderingType(item.span) });
    } else if (item.constraint === "Show") {
      members.set("show", { parameters: [subject], result: primitive("String") });
    } else if (item.constraint === "Num") {
      for (const name of ["add", "multiply"] as const) members.set(name, binary);
      members.set("fromNat", { parameters: [primitive("Nat")], result: subject });
    } else if (item.constraint === "Signed") {
      members.set("subtract", binary);
      members.set("negate", { parameters: [subject], result: subject });
      members.set("fromInt", { parameters: [primitive("Int")], result: subject });
    } else if (item.constraint === "Frac") {
      members.set("divide", binary);
    } else if (item.constraint === "Concat") {
      members.set("concat", binary);
    } else if (item.constraint === "Pow") {
      members.set("pow", binary);
    } else if (item.constraint === "Integral") {
      for (const name of ["div", "mod", "quot", "rem", "gcd"] as const) {
        members.set(name, binary);
      }
    } else {
      return false;
    }

    this.#instanceBaseConstraints.set(
      item,
      this.#baseConstraints(item.constraint).map((baseConstraint) =>
        this.#require(baseConstraint, subject, item.span)
      ),
    );
    const supplied = new Set(item.members.map(({ name }) => name));
    for (const [name, signature] of members) {
      if (!signature.optional && !supplied.has(name)) {
        this.#diagnostics.add({
          severity: "error",
          message: `instance is missing required member \`${name}\``,
          primary: item.span,
        });
      }
    }
    for (const member of item.members) {
      const signature = members.get(member.name);
      if (signature === undefined) {
        this.#diagnostics.add({
          severity: "error",
          message: `\`${member.name}\` is not a member of \`${item.constraint}\``,
          primary: member.span,
        });
        this.#inferExpr(member.value, level + 1);
        continue;
      }
      member.value.parameters.forEach((parameter, index) => {
        this.#schemes.set(parameter.symbol, {
          variables: [],
          type: signature.parameters[index] ?? ERROR,
        });
      });
      if (member.value.parameters.length !== signature.parameters.length) {
        this.#diagnostics.add({
          severity: "error",
          message: `instance member \`${member.name}\` expects ${signature.parameters.length} parameters, got ${member.value.parameters.length}`,
          primary: member.span,
        });
      }
      const body = this.#inferExpr(member.value.body, level + 1);
      this.#unify(signature.result, body, member.span);
      this.#expressionTypes.set(member.value, {
        kind: "Function",
        parameters: signature.parameters,
        result: signature.result,
      });
    }
    return true;
  }

  /** Validates the implication DAG before evidence selection begins. */
  #checkBaseConstraintGraph(): void {
    for (const declaration of this.#constraintDeclarations.values()) {
      for (const baseConstraint of declaration.baseConstraints) {
        if (!this.#constraintNames.has(baseConstraint)) {
          this.#diagnostics.add({
            severity: "error",
            message: `unknown base constraint \`${baseConstraint}\``,
            primary: declaration.span,
          });
        }
        if (this.#projectionBearingConstraints.has(baseConstraint)) {
          this.#diagnostics.add({
            severity: "error",
            message: impliedTypeBinderMessage(baseConstraint),
            primary: declaration.span,
          });
        }
        const reservedMember =
          (baseConstraint[0]?.toLowerCase() ?? "") + baseConstraint.slice(1);
        if (declaration.members.some(({ binding }) => binding.name === reservedMember)) {
          this.#diagnostics.add({
            severity: "error",
            message: `member \`${reservedMember}\` conflicts with the \`${baseConstraint}\` dictionary slot; rename the member`,
            primary: declaration.span,
          });
        }
      }
    }

    const state = new Map<string, "visiting" | "visited">();
    const visit = (name: string, path: readonly string[]): void => {
      const current = state.get(name);
      if (current === "visited") return;
      if (current === "visiting") {
        const cycle = [...path.slice(path.indexOf(name)), name];
        this.#diagnostics.add({
          severity: "error",
          message: `base constraint cycle: ${cycle.join(" requires ")}`,
          primary: this.#constraintDeclarations.get(name)!.span,
        });
        return;
      }
      state.set(name, "visiting");
      const declaration = this.#constraintDeclarations.get(name);
      for (const baseConstraint of declaration?.baseConstraints ?? []) {
        if (this.#constraintDeclarations.has(baseConstraint)) {
          visit(baseConstraint, [...path, name]);
        }
      }
      state.set(name, "visited");
    };
    for (const name of this.#constraintDeclarations.keys()) visit(name, []);
  }

  /**
   * `Seq(a)` as the compiler's own producers must speak it: the prelude
   * record's identity. Occlusion cannot move it — a module that declares its own
   * `record Seq(a)` shadows the *name* (§5.4) without redirecting `Map.keys`.
   */
  #sequence(element: Mono, span: Source.Span): Mono {
    if (this.#seqRecord === undefined) {
      return this.#unsupported(
        span,
        "`Seq(a)` is not available here; the prelude `Seq` module is not in scope",
      );
    }
    return {
      kind: "NominalRecord",
      record: this.#seqRecord,
      name: "Seq",
      arguments: [element],
    };
  }

  /** The prelude `Seq(a)` this type is, or `undefined` if it is not one. */
  #asSequence(actual: Mono): Mono | undefined {
    if (this.#seqRecord === undefined) return undefined;
    if (actual.kind !== "NominalRecord" || actual.record !== this.#seqRecord) return undefined;
    return actual.arguments[0] ?? ERROR;
  }

  /** Gives compiler-known persistent collection operations their ordinary function types. */
  #collectionOperationType(
    collection: Resolved.CollectionOperationExpr["collection"],
    operation: string,
    level: number,
    span: Source.Span,
    requirements: Requirement[],
  ): Mono {
    const requireKey = (subject: Mono): void => {
      requirements.push(this.#require("Hash", subject, span));
    };
    if (collection === "Map") {
      const key = this.#fresh(level, false);
      const value = this.#fresh(level, false);
      const map: MapMono = { kind: "Map", key, value };
      if (["set", "remove", "containsKey", "fromVector", "fromSeq", "fromEntries"].includes(operation)) {
        requireKey(key);
      }
      if (operation === "empty") return { kind: "Function", parameters: [], result: map };
      if (operation === "set") return { kind: "Function", parameters: [map, key, value], result: map };
      if (operation === "remove") return { kind: "Function", parameters: [map, key], result: map };
      if (operation === "containsKey") return { kind: "Function", parameters: [map, key], result: this.#boolType(span) };
      if (operation === "size") return { kind: "Function", parameters: [map], result: primitive("Int") };
      if (operation === "isEmpty") return { kind: "Function", parameters: [map], result: this.#boolType(span) };
      const entry: Mono = { kind: "Tuple", elements: [key, value] };
      if (operation === "keys") return { kind: "Function", parameters: [map], result: this.#sequence(key, span) };
      if (operation === "values") return { kind: "Function", parameters: [map], result: this.#sequence(value, span) };
      if (operation === "entries" || operation === "toSeq") return { kind: "Function", parameters: [map], result: this.#sequence(entry, span) };
      if (operation === "fromVector") return { kind: "Function", parameters: [{ kind: "Vector", element: entry }], result: map };
      if (operation === "fromSeq" || operation === "fromEntries") return { kind: "Function", parameters: [this.#sequence(entry, span)], result: map };
    } else if (collection === "Set") {
      const element = this.#fresh(level, false);
      const set: SetMono = { kind: "Set", element };
      if (["add", "remove", "contains", "union", "intersect", "difference", "isSubsetOf", "fromVector", "fromSeq"].includes(operation)) {
        requireKey(element);
      }
      if (operation === "empty") return { kind: "Function", parameters: [], result: set };
      if (operation === "add" || operation === "remove") return { kind: "Function", parameters: [set, element], result: set };
      if (operation === "contains") return { kind: "Function", parameters: [set, element], result: this.#boolType(span) };
      if (["union", "intersect", "difference"].includes(operation)) return { kind: "Function", parameters: [set, set], result: set };
      if (operation === "isSubsetOf") return { kind: "Function", parameters: [set, set], result: this.#boolType(span) };
      if (operation === "size") return { kind: "Function", parameters: [set], result: primitive("Int") };
      if (operation === "isEmpty") return { kind: "Function", parameters: [set], result: this.#boolType(span) };
      if (operation === "toSeq") return { kind: "Function", parameters: [set], result: this.#sequence(element, span) };
      if (operation === "fromVector") return { kind: "Function", parameters: [{ kind: "Vector", element }], result: set };
      if (operation === "fromSeq") return { kind: "Function", parameters: [this.#sequence(element, span)], result: set };
    } else if (collection === "Node") {
      // The hidden fixed-32 trie node: 32 slots of `element`, addressed 0..31.
      // `set`/`copy` are immutable (return a fresh node); see the design note §4.
      const element = this.#fresh(level, false);
      const node: NodeMono = { kind: "Node", element };
      if (operation === "empty") return { kind: "Function", parameters: [], result: node };
      if (operation === "get") return { kind: "Function", parameters: [node, primitive("Int")], result: element };
      if (operation === "set") return { kind: "Function", parameters: [node, primitive("Int"), element], result: node };
      if (operation === "copy") return { kind: "Function", parameters: [node], result: node };
    } else {
      const element = this.#fresh(level, false);
      const vector: VectorMono = { kind: "Vector", element };
      if (operation === "empty") return { kind: "Function", parameters: [], result: vector };
      if (operation === "length") return { kind: "Function", parameters: [vector], result: primitive("Int") };
      if (operation === "isEmpty") return { kind: "Function", parameters: [vector], result: this.#boolType(span) };
      if (operation === "append") return { kind: "Function", parameters: [vector, element], result: vector };
      if (operation === "prepend") return { kind: "Function", parameters: [vector, element], result: vector };
      if (operation === "at") return { kind: "Function", parameters: [vector, primitive("Int")], result: element };
      if (operation === "set") return { kind: "Function", parameters: [vector, primitive("Int"), element], result: vector };
      if (operation === "toSeq") return { kind: "Function", parameters: [vector], result: this.#sequence(element, span) };
      if (operation === "fromSeq") return { kind: "Function", parameters: [this.#sequence(element, span)], result: vector };
    }
    return this.#unsupported(span, `the companion of \`${collection}\` has no core operation \`${operation}\``);
  }

  #inferExpr(expression: Resolved.Expr, level: number): Mono {
    let type: Mono;
    switch (expression.kind) {
      case "CollectionOperation":
        const collectionRequirements: Requirement[] = [];
        type = this.#collectionOperationType(
          expression.collection,
          expression.operation,
          level,
          expression.span,
          collectionRequirements,
        );
        this.#requirements.set(expression, collectionRequirements);
        break;
      case "PrimitiveOperation": {
        const subject = primitive(expression.primitive);
        const permitted = expression.primitive === "Float"
          ? ["mod", "rem"]
          : expression.primitive === "Int"
          ? ["div", "mod", "quot", "rem", "gcd"]
          : ["div", "mod", "quot", "rem", "gcd", "lcm"];
        type = permitted.includes(expression.operation)
          ? { kind: "Function", parameters: [subject, subject], result: subject }
          : this.#unsupported(
              expression.span,
              `the companion of \`${expression.primitive}\` has no operation \`${expression.operation}\``,
            );
        break;
      }
      case "Name":
        const requirements: Requirement[] = [];
        type = this.#instantiate(
          this.#scheme(expression.symbol),
          level,
          requirements,
          expression.span,
        );
        this.#nameRequirements.set(expression, requirements);
        break;
      case "Unit":
        type = UNIT;
        break;
      case "Integer": {
        type = this.#fresh(level, true);
        const requirement = this.#require("Num", type, expression.span, "literal");
        requirement.literal = expression.decimal;
        this.#requirements.set(expression, [requirement]);
        break;
      }
      case "BigInt":
        type = primitive("BigInt");
        break;
      case "Float":
        type = primitive("Float");
        break;
      case "String":
        for (const part of expression.parts) {
          if (part.kind === "Interpolation") {
            const partType = this.#inferExpr(part.expression, level);
            const requirement = this.#require(
              "Show",
              partType,
              part.span,
              "interpolation",
            );
            this.#requirements.set(part, [requirement]);
          }
        }
        type = primitive("String");
        break;
      case "Hash": {
        const value = this.#inferExpr(expression.value, level);
        const requirement = this.#require("Hash", value, expression.span);
        this.#requirements.set(expression, [requirement]);
        type = primitive("Int");
        break;
      }
      case "Tuple":
        type = {
          kind: "Tuple",
          elements: expression.elements.map((element) =>
            this.#inferExpr(element, level),
          ),
        };
        break;
      case "Vector": {
        const element = this.#fresh(level, false);
        for (const value of expression.elements) {
          this.#unifyExpected(element, this.#inferExpr(value, level), value, value.span, true);
        }
        type = { kind: "Vector", element };
        break;
      }
      case "Record":
        if (expression.spread === undefined) {
          type = {
            kind: "Record",
            fields: new Map(expression.fields.map((field) => [
              field.name.text,
              this.#inferExpr(field.value, level),
            ])),
          };
        } else {
          const receiver = this.#inferExpr(expression.spread, level);
          const overrides = new Map(expression.fields.map((field) => [
            field.name.text,
            this.#inferExpr(field.value, level),
          ]));
          const actual = this.#prune(receiver);
          if (actual.kind === "NominalRecord") {
            if (!this.#recordRepresentationVisible(actual.record)) {
              type = this.#unsupported(
                expression.span,
                `cannot update opaque record \`${actual.name}\`; use an operation exported by its home module`,
              );
              break;
            }
            const fields = this.#nominalRecordFields(actual);
            for (const [name, override] of overrides) {
              const existing = fields.get(name);
              if (existing === undefined) {
                this.#diagnostics.add({
                  severity: "error",
                  message: `record update cannot add fields; \`${actual.name}\` has no field \`${name}\``,
                  primary: expression.span,
                });
              } else {
                this.#unify(existing, override, expression.span);
              }
            }
            type = overrides.size === 0
              ? { kind: "Record", fields }
              : receiver;
            break;
          } else if (actual.kind === "Record") {
            for (const [name, override] of overrides) {
              const existing = actual.fields.get(name);
              if (existing === undefined) {
                this.#diagnostics.add({
                  severity: "error",
                  message: `record update cannot add fields; the input has no field \`${name}\``,
                  primary: expression.span,
                });
              } else {
                this.#unify(existing, override, expression.span);
              }
            }
          } else {
            this.#unify(receiver, {
              kind: "Record",
              fields: overrides,
              tail: this.#fresh(level, false),
            }, expression.span);
          }
          type = receiver;
        }
        break;
      case "Group":
        type = this.#inferExpr(expression.expression, level);
        break;
      case "Block":
        type = this.#inferItems(expression.items, level, false);
        break;
      case "Lambda": {
        const annotationTails = new Map<string, Variable>();
        // Inherit the enclosing definition's type variables so a nested lambda's
        // annotations may name them (lexical scoping); its own `<...>` binders below
        // shadow by overwriting.
        const annotationVariables = new Map<string, Variable>(this.#annotationVariableScope);
        for (const parameter of expression.typeParameters ?? []) {
          const declaredConstraints = parameter.constraints.filter((constraint) =>
            this.#constraintNames.has(constraint) &&
            !this.#projectionBearingConstraints.has(constraint)
          );
          const variable = this.#fresh(
            level + 1,
            false,
            parameter.name,
            declaredConstraints,
          );
          annotationVariables.set(parameter.name, variable);
          for (const constraint of parameter.constraints) {
            if (!this.#constraintNames.has(constraint)) {
              this.#diagnostics.add({
                severity: "error",
                message: `unknown constraint \`${constraint}\``,
                primary: parameter.span,
              });
              continue;
            }
            if (this.#projectionBearingConstraints.has(constraint)) {
              this.#diagnostics.add({
                severity: "error",
                message: impliedTypeBinderMessage(constraint),
                primary: parameter.span,
              });
              continue;
            }
            this.#require(
              constraint,
              variable,
              parameter.span,
              "annotation",
            );
          }
        }
        const parameters = expression.parameters.map((parameter) => {
          const parameterType = parameter.annotation === undefined
            ? this.#fresh(level + 1, false)
            : this.#annotationType(
                parameter.annotation,
                level + 1,
                annotationTails,
                annotationVariables,
              );
          this.#schemes.set(parameter.symbol, {
            variables: [],
            type: parameterType,
          });
          return parameterType;
        });
        const savedVariableScope = this.#annotationVariableScope;
        this.#annotationVariableScope = annotationVariables;
        const inferredResult = this.#inferExpr(expression.body, level + 1);
        this.#annotationVariableScope = savedVariableScope;
        let result = inferredResult;
        if (expression.returnAnnotation !== undefined) {
          const annotationType = this.#annotationType(
            expression.returnAnnotation,
            level + 1,
            annotationTails,
            annotationVariables,
          );
          this.#unifyExpected(
            annotationType,
            inferredResult,
            expression.body,
            expression.returnAnnotation.span,
            true,
          );
          if (this.#hasNumericWidening(expression.body)) result = annotationType;
        }
        type = { kind: "Function", parameters, result };
        break;
      }
      case "If": {
        const condition = this.#inferExpr(expression.condition, level);
        this.#unify(condition, this.#boolType(expression.condition.span), expression.condition.span);
        const consequence = this.#inferExpr(expression.consequence, level);
        const alternative = this.#inferExpr(expression.alternative, level);
        if (expression.elseless) {
          // `else`-less: the false branch is the synthesized `Unit`, so the
          // `then` branch must be `Unit` (Operators §11.2). No numeric
          // widening — a unit branch never widens.
          //
          // Default a still-polymorphic numeric literal first: it would
          // otherwise unify with `Unit` structurally and succeed (Numeric
          // Literals §1), hiding the §11.2 fixit behind a later unresolved
          // `Num Unit`. Defaulting settles it to `Int` so the unification
          // below fails and reports the add-an-`else` fixit instead.
          this.#defaultDiscardedLiteral(consequence, expression.consequence.span);
          this.#unify(
            consequence,
            alternative,
            expression.consequence.span,
            () =>
              "an `if` without `else` produces `Unit`; its `then` branch is " +
              `\`${this.#display(consequence)}\` — add an \`else\` branch to ` +
              "produce a value",
          );
          type = alternative;
        } else if (
          this.#tryWidenNumeric(
            expression.consequence,
            consequence,
            alternative,
            expression.span,
            true,
          )
        ) {
          type = alternative;
        } else if (
          this.#tryWidenNumeric(
            expression.alternative,
            alternative,
            consequence,
            expression.span,
            true,
          )
        ) {
          type = consequence;
        } else {
          this.#unify(consequence, alternative, expression.span);
          type = consequence;
        }
        break;
      }
      case "While": {
        const condition = this.#inferExpr(expression.condition, level);
        this.#unify(condition, this.#boolType(expression.condition.span), expression.condition.span);
        const body = this.#inferExpr(expression.body, level);
        this.#defaultDiscardedLiteral(body, expression.body.span);
        this.#unify(body, UNIT, expression.body.span, () =>
          "the final expression of a loop body produces a value that is discarded on every iteration; use `ignore(...)` if intended"
        );
        type = UNIT;
        break;
      }
      case "For": {
        const iterable = this.#inferExpr(expression.iterable, level);
        let actual = this.#prune(iterable);
        if (actual.kind === "Variable" && actual.literalOnly) {
          this.#bind(actual, primitive("Int"), expression.iterable.span);
          actual = this.#prune(iterable);
        }
        let element: Mono = ERROR;
        // `for x in` stays compiler-owned over a `Seq` (ruling R3): it is the
        // emitter's constant-stack `next` loop, not an `Iterable` instance, so
        // the prelude record is recognized here rather than falling through to
        // the constraint path — which would report no instance for it.
        const sequenceElement = this.#asSequence(actual);
        if (actual.kind === "Range") {
          element = primitive("Int");
        } else if (sequenceElement !== undefined) {
          element = sequenceElement;
        } else if (actual.kind === "Vector" || actual.kind === "Set" || actual.kind === "Array") {
          element = actual.element;
        } else if (actual.kind === "Map") {
          element = { kind: "Tuple", elements: [actual.key, actual.value] };
        } else if (
          actual.kind === "Constructor" && actual.name === "String"
        ) {
          element = primitive("String");
        } else if (actual.kind === "Variable") {
          this.#diagnostics.add({
            severity: "error",
            message: "cannot determine how to iterate this value; add a `Range`, `String`, or `Seq(a)` type annotation",
            primary: expression.iterable.span,
          });
        } else if (actual.kind !== "Error") {
          element = this.#fresh(level, false);
          const requirement = this.#require(
            "Iterable",
            actual,
            expression.iterable.span,
            "operation",
            new Map([["Item", element]]),
          );
          if (!requirement.reported) this.#iterations.set(expression, requirement);
        }
        this.#inferMatchPattern(expression.pattern, element, level);
        if (!this.#isIrrefutablePattern(expression.pattern, element)) {
          this.#diagnostics.add({
            severity: "error",
            message: "this loop pattern can fail; bind an irrefutable pattern and use `match` inside the loop",
            primary: expression.pattern.span,
          });
        }
        const body = this.#inferExpr(expression.body, level);
        this.#defaultDiscardedLiteral(body, expression.body.span);
        this.#unify(body, UNIT, expression.body.span, () =>
          "the final expression of a loop body produces a value that is discarded on every iteration; use `ignore(...)` if intended"
        );
        type = UNIT;
        break;
      }
      case "Match": {
        const scrutinee = this.#inferExpr(expression.scrutinee, level);
        const result = this.#fresh(level, false);
        let catchAll = false;
        const coveredConstructors = new Set<Resolved.SymbolId>();
        const constructorPatterns = new Map<
          Resolved.SymbolId,
          Resolved.ConstructorPattern[]
        >();
        const coveredLiterals = new Set<string>();
        const coveredBooleans = new Set<boolean>();
        for (const arm of expression.arms) {
          if (catchAll) {
            this.#diagnostics.add({
              severity: "error",
              message: "this match arm is unreachable; an earlier pattern matches everything",
              primary: arm.pattern.span,
            });
          }
          const guarded = arm.guard !== undefined;
          let armCatchesAll = false;
          const armConstructors: Resolved.ConstructorPattern[] = [];
          for (const coveragePattern of coverageAlternatives(arm.pattern)) {
            if (coveragePattern.kind === "Constructor") {
              if (coveredConstructors.has(coveragePattern.symbol)) {
                this.#diagnostics.add({
                  severity: "error",
                  message: `this case is unreachable; \`${coveragePattern.text}\` is already handled above`,
                  primary: coveragePattern.span,
                });
              }
              if (!guarded) armConstructors.push(coveragePattern);
            } else if (
              coveragePattern.kind === "Integer" ||
              coveragePattern.kind === "String"
            ) {
              const key = renderLiteralPatternKey(coveragePattern);
              if (coveredLiterals.has(key)) {
                this.#diagnostics.add({
                  severity: "error",
                  message: "this literal case is unreachable; it is already handled above",
                  primary: coveragePattern.span,
                });
              }
              if (!guarded) coveredLiterals.add(key);
            } else if (isStructurallyIrrefutablePattern(coveragePattern)) {
              armCatchesAll = true;
            }
          }
          for (const pattern of armConstructors) {
            const patterns = constructorPatterns.get(pattern.symbol) ?? [];
            patterns.push(pattern);
            constructorPatterns.set(pattern.symbol, patterns);
            if (this.#constructorPatternsAreExhaustive(patterns)) {
              coveredConstructors.add(pattern.symbol);
            }
          }
          if (!guarded && armCatchesAll) catchAll = true;
          this.#inferMatchPattern(arm.pattern, scrutinee, level);
          if (arm.guard !== undefined) {
            const guard = this.#inferExpr(arm.guard, level);
            this.#unify(guard, this.#boolType(arm.guard.span), arm.guard.span);
          }
          this.#unify(result, this.#inferExpr(arm.body, level), arm.body.span);
        }
        const actual = this.#prune(scrutinee);
        if (actual.kind === "Union") {
          this.#matchUnions.set(expression, actual.union);
          if (!catchAll) {
            const union = this.#unions.get(actual.union);
            const missing = union?.constructors.filter(
              ({ binding }) => !coveredConstructors.has(binding.symbol),
            ) ?? [];
            if (missing.length > 0) {
              this.#diagnostics.add({
                severity: "error",
                message:
                  "match is missing cases: " +
                  missing.map(({ binding }) => `\`${binding.name}\``).join(", "),
                primary: expression.span,
              });
            }
          }
        } else if (
          actual.kind === "Constructor" &&
          actual.name === "Exn"
        ) {
          this.#diagnostics.add({
            severity: "error",
            message: "match requires a closed type; exceptions are inspected with `try`/`catch`",
            primary: expression.scrutinee.span,
          });
        // #147 deleted the `Bool` branch that stood here. `Bool` is a union, so
        // it reaches the closed-constructor path above like every other union,
        // and reports its missing case as `False`/`True` by that machinery.
        } else if (
          actual.kind === "Constructor" &&
          (actual.name === "Int" || actual.name === "String")
        ) {
          if (!catchAll) {
            this.#diagnostics.add({
              severity: "error",
              message: `a match on \`${actual.name}\` needs a catch-all pattern`,
              primary: expression.span,
            });
          }
        } else if (actual.kind === "Tuple" || actual.kind === "Record") {
          if (!catchAll) {
            this.#diagnostics.add({
              severity: "error",
              message: `match on \`${this.#display(actual)}\` needs a catch-all structural pattern`,
              primary: expression.span,
            });
          }
        } else if (actual.kind === "Vector") {
          const patterns = expression.arms.flatMap((arm) =>
            arm.guard === undefined
              ? coverageAlternatives(arm.pattern).filter(
                  (pattern): pattern is Resolved.VectorPattern => pattern.kind === "Vector",
                )
              : []
          );
          const restMinimum = Math.min(
            ...patterns.filter(({ rest }) => rest !== undefined).map(({ elements }) => elements.length),
          );
          const fixedLengths = new Set(
            patterns.filter(({ rest }) => rest === undefined).map(({ elements }) => elements.length),
          );
          const exhaustive = Number.isFinite(restMinimum) &&
            Array.from({ length: restMinimum }, (_, length) => length).every((length) =>
              fixedLengths.has(length)
            );
          if (!catchAll && !exhaustive) {
            this.#diagnostics.add({
              severity: "error",
              message: "match is missing a vector length case",
              primary: expression.span,
            });
          }
        } else {
          type = this.#unsupported(
            expression.scrutinee.span,
            actual.kind === "Variable"
              ? "cannot match on a value of abstract type; use the operations its constraints provide"
              : `cannot match on \`${this.#display(actual)}\` yet`,
          );
          break;
        }
        type = result;
        break;
      }
      case "Throw": {
        const exception = this.#inferExpr(expression.exception, level);
        this.#unify(exception, primitive("Exn"), expression.exception.span);
        type = this.#fresh(level, false);
        break;
      }
      case "Try": {
        const result = this.#inferExpr(expression.body, level);
        let catchesAll = false;
        const coveredConstructors = new Set<Resolved.SymbolId>();
        const constructorPatterns = new Map<
          Resolved.SymbolId,
          Resolved.ConstructorPattern[]
        >();
        for (const arm of expression.arms) {
          if (catchesAll) {
            this.#diagnostics.add({
              severity: "error",
              message: "this catch arm is unreachable because an earlier arm catches everything",
              primary: arm.span,
            });
          }
          const guarded = arm.guard !== undefined;
          let armCatchesAll = false;
          const armConstructors: Resolved.ConstructorPattern[] = [];
          for (const coveragePattern of coverageAlternatives(arm.pattern)) {
            if (coveragePattern.kind === "Constructor") {
              if (coveredConstructors.has(coveragePattern.symbol)) {
                this.#diagnostics.add({
                  severity: "error",
                  message: `exception \`${coveragePattern.text}\` is already caught above`,
                  primary: coveragePattern.span,
                });
              }
              if (!guarded && this.#exceptions.has(coveragePattern.symbol)) {
                armConstructors.push(coveragePattern);
              }
            } else if (
              coveragePattern.kind === "Binding" ||
              coveragePattern.kind === "Wildcard"
            ) {
              armCatchesAll = true;
            }
          }
          for (const pattern of armConstructors) {
            const patterns = constructorPatterns.get(pattern.symbol) ?? [];
            patterns.push(pattern);
            constructorPatterns.set(pattern.symbol, patterns);
            if (this.#constructorPatternsAreExhaustive(patterns)) {
              coveredConstructors.add(pattern.symbol);
            }
          }
          if (!guarded && armCatchesAll) catchesAll = true;
          this.#inferExceptionPattern(arm.pattern, level);
          if (arm.guard !== undefined) {
            const guard = this.#inferExpr(arm.guard, level);
            this.#unify(guard, this.#boolType(arm.guard.span), arm.guard.span);
          }
          this.#unify(result, this.#inferExpr(arm.body, level), arm.body.span);
        }
        type = result;
        break;
      }
      case "Call": {
        if (expression.callee.kind === "Access") {
          const receiver = this.#inferExpr(expression.callee.receiver, level);
          const actual = this.#prune(receiver);
          // `Seq` is a nominal record like any other, so `source.map(f)` is
          // ordinary companion dispatch (Products §3.2) against prelude
          // `Seq.hex` — no dedicated dot-call path, and no fixed operation list.
          const nominal =
            actual.kind === "NominalRecord" ||
            actual.kind === "Union" ||
            actual.kind === "Vector" ||
            actual.kind === "Set" ||
            actual.kind === "Map";
          const recordHasField = actual.kind === "NominalRecord" &&
            this.#recordRepresentationVisible(actual.record) &&
            this.#nominalRecordFields(actual).has(expression.callee.field.text);
          if (nominal && !recordHasField) {
            const operation = this.#operationsByName.get(expression.callee.field.text);
            const scheme = operation === undefined ? undefined : this.#schemes.get(operation.id);
            if (operation === undefined || scheme === undefined) {
              type = this.#unsupported(
                expression.callee.field.span,
                `the companion of \`${this.#display(actual)}\` has no operation \`${expression.callee.field.text}\`; call an available subject-first function explicitly`,
              );
              break;
            }
            const callee = this.#instantiate(
              scheme,
              level,
              undefined,
              expression.callee.field.span,
            );
            const arguments_ = [
              receiver,
              ...expression.arguments.map((argument) => this.#inferExpr(argument, level)),
            ];
            const result = this.#fresh(level, false);
            this.#unify(
              callee,
              { kind: "Function", parameters: arguments_, result },
              expression.span,
            );
            this.#dotCalls.set(expression, {
              symbol: operation,
              callee,
              receiver: expression.callee.receiver,
            });
            type = result;
            break;
          }
        }
        if (expression.callee.kind === "Name") {
          const exception = this.#exceptions.get(expression.callee.symbol);
          if (exception?.slots.length === 0) {
            for (const argument of expression.arguments) {
              this.#inferExpr(argument, level);
            }
            this.#diagnostics.add({
              severity: "error",
              message: `\`${expression.callee.text}\` is a value; write it without \`()\``,
              primary: expression.span,
            });
            type = ERROR;
            break;
          }
        }
        const callee = this.#inferExpr(expression.callee, level);
        const arguments_ = expression.arguments.map((argument) =>
          this.#inferExpr(argument, level),
        );
        const result = this.#fresh(level, false);
        const knownCallee = this.#prune(callee);
        if (
          knownCallee.kind === "Function" &&
          knownCallee.parameters.length !== arguments_.length
        ) {
          const unitCall = knownCallee.parameters.length === 1 &&
              arguments_.length === 0 && this.#solvesToUnit(knownCallee.parameters[0])
            ? "this function takes one unit argument; write `f(())`"
            : knownCallee.parameters.length === 0 && arguments_.length === 1
              ? "this function takes no arguments; write `f()`"
              : undefined;
          this.#diagnostics.add({
            severity: "error",
            message: unitCall ??
              `function expects ${knownCallee.parameters.length} arguments, got ` +
                `${arguments_.length}`,
            primary: expression.span,
          });
          type = ERROR;
        } else if (knownCallee.kind === "Function") {
          this.#checkCallArguments(
            knownCallee.parameters,
            arguments_,
            expression.arguments,
            expression.span,
          );
          type = knownCallee.result;
        } else {
          this.#unify(
            callee,
            { kind: "Function", parameters: arguments_, result },
            expression.span,
          );
          type = result;
        }
        if (expression.callee.kind === "Name") {
          // The call owns this reference's evidence, so the reference itself
          // must not also carry it — that would apply it twice.
          this.#calleeNames.add(expression.callee);
          this.#callRequirements.set(
            expression,
            this.#nameRequirements.get(expression.callee) ?? [],
          );
        }
        break;
      }
      case "ConsoleLog":
        for (const argument of expression.arguments) {
          this.#inferExpr(argument, level);
        }
        type = UNIT;
        break;
      case "Unary": {
        const operand = this.#inferExpr(expression.operand, level);
        if (expression.operator === "Not") {
          this.#unify(operand, this.#boolType(expression.span), expression.span);
          type = this.#boolType(expression.span);
          this.#requirements.set(expression, []);
        } else {
          const requirement = this.#require("Signed", operand, expression.span);
          this.#requirements.set(expression, [requirement]);
          type = operand;
        }
        break;
      }
      case "Binary":
        type = this.#inferBinary(expression, level);
        break;
      case "Comparison": {
        const operands = expression.operands.map((operand) =>
          this.#inferExpr(operand, level),
        );
        let targetIndex = operands.findIndex((operand) => {
          const actual = this.#prune(operand);
          return !(actual.kind === "Constructor" && ["Nat", "Int"].includes(actual.name)) &&
            this.#supportsNumericTarget(actual, true);
        });
        if (targetIndex < 0) {
          targetIndex = operands.findIndex((operand) => {
            const actual = this.#prune(operand);
            return actual.kind === "Constructor" && actual.name === "Int";
          });
        }
        const common = targetIndex < 0 ? operands[0] ?? ERROR : operands[targetIndex]!;
        for (const [index, operand] of operands.entries()) {
          if (index === targetIndex || (targetIndex < 0 && index === 0)) continue;
          const sourceExpression = expression.operands[index];
          if (sourceExpression === undefined) continue;
          this.#unifyExpected(
            common,
            operand,
            sourceExpression,
            expression.span,
            true,
          );
        }
        const requirements = expression.operators.map((operator) =>
          this.#require(
            operator === "Equal" || operator === "NotEqual" ? "Eq" : "Ord",
            common,
            expression.span,
          ),
        );
        this.#requirements.set(expression, requirements);
        type = this.#boolType(expression.span);
        break;
      }
      case "Assignment": {
        const target = this.#inferExpr(expression.target, level);
        const value = this.#inferExpr(expression.value, level);
        this.#unifyExpected(target, value, expression.value, expression.span, true);
        if (
          expression.target.kind !== "Name" ||
          !this.#mutableSymbols.has(expression.target.symbol)
        ) {
          this.#diagnostics.add({
            severity: "error",
            message: expression.target.kind === "Name"
              ? `\`${expression.target.text}\` is not mutable; declare it with \`var\` if you need to update it`
              : "assignment requires a `var` binding",
            primary: expression.target.span,
          });
        }
        type = UNIT;
        break;
      }
      case "Access": {
        const inferredReceiver = this.#prune(this.#inferExpr(expression.receiver, level));
        const receiver = inferredReceiver.kind === "Record"
          ? this.#normalizeRecord(inferredReceiver)
          : inferredReceiver;
        if (receiver.kind === "Constructor" && receiver.name === "Exn") {
          type = this.#unsupported(
            expression.span,
            "exceptions are inspected with `try`/`catch`",
          );
          break;
        }
        if (receiver.kind === "NominalRecord") {
          if (!this.#recordRepresentationVisible(receiver.record)) {
            type = this.#unsupported(
              expression.field.span,
              `cannot access field \`${expression.field.text}\` of opaque record \`${receiver.name}\`; use an operation exported by its home module`,
            );
            break;
          }
          const fields = this.#nominalRecordFields(receiver);
          const field = fields.get(expression.field.text);
          type = field === undefined
            ? this.#unsupported(
                expression.field.span,
                `\`${receiver.name}\` has fields ${[...fields.keys()].map((name) => `\`${name}\``).join(", ")}, not \`${expression.field.text}\``,
              )
            : field;
          if (field !== undefined) this.#recordAccesses.set(expression, expression.field.text);
          break;
        }
        if (receiver.kind === "Record") {
          const field = receiver.fields.get(expression.field.text);
          if (field !== undefined) {
            type = field;
            this.#recordAccesses.set(expression, expression.field.text);
            break;
          }
          if (receiver.tail === undefined) {
            const known = [...receiver.fields.keys()];
            type = this.#unsupported(
              expression.field.span,
              known.length === 0
                ? `the empty record has no field \`${expression.field.text}\``
                : `record has fields ${known.map((name) => `\`${name}\``).join(", ")}, not \`${expression.field.text}\``,
            );
            break;
          }
          type = this.#fresh(level, false);
          this.#unify(receiver, {
            kind: "Record",
            fields: new Map([[expression.field.text, type]]),
            tail: this.#fresh(level, false),
          }, expression.span);
          this.#recordAccesses.set(expression, expression.field.text);
          break;
        }
        const item = /^item(\d+)$/.exec(expression.field.text);
        if (item === null) {
          type = this.#fresh(level, false);
          const tail = this.#fresh(level, false);
          this.#unify(receiver, {
            kind: "Record",
            fields: new Map([[expression.field.text, type]]),
            tail,
          }, expression.span);
          this.#recordAccesses.set(expression, expression.field.text);
          break;
        }
        const position = Number(item[1]);
        if (!Number.isSafeInteger(position) || position < 1) {
          type = this.#unsupported(
            expression.field.span,
            "tuple components are numbered from 1",
          );
          break;
        }
        if (receiver.kind === "Variable") {
          type = this.#unsupported(
            expression.receiver.span,
            "tuple access needs a known tuple type; add a tuple annotation",
          );
          break;
        }
        if (receiver.kind !== "Tuple") {
          type = receiver.kind === "Error"
            ? ERROR
            : this.#unsupported(
                expression.receiver.span,
                `\`${this.#display(receiver)}\` is not a tuple`,
              );
          break;
        }
        if (position > receiver.elements.length) {
          type = this.#unsupported(
            expression.field.span,
            `this tuple has ${receiver.elements.length} components; there is no ` +
              `item${position}`,
          );
          break;
        }
        const index = position - 1;
        this.#tupleAccesses.set(expression, index);
        type = receiver.elements[index]!;
        break;
      }
      case "Index": {
        const receiver = this.#prune(this.#inferExpr(expression.receiver, level));
        const index = this.#prune(this.#inferExpr(expression.index, level));
        if (receiver.kind === "Vector") {
          if (index.kind === "Range") {
            type = receiver;
            this.#indexOperations.set(expression, "VectorSlice");
          } else {
            this.#unify(index, primitive("Int"), expression.index.span);
            type = receiver.element;
            this.#indexOperations.set(expression, "VectorElement");
          }
        } else if (receiver.kind === "Constructor" && receiver.name === "String") {
          if (index.kind === "Range") {
            type = primitive("String");
            this.#indexOperations.set(expression, "StringSlice");
          } else {
            this.#unify(index, primitive("Int"), expression.index.span);
            type = primitive("String");
            this.#indexOperations.set(expression, "StringElement");
          }
        } else if (receiver.kind === "Map") {
          this.#unify(index, receiver.key, expression.index.span);
          const requirements = [
            this.#require("Hash", receiver.key, expression.span),
          ];
          this.#requirements.set(expression, requirements);
          type = receiver.value;
          this.#indexOperations.set(expression, "MapElement");
        } else {
          type = this.#unsupported(expression.receiver.span, "indexing requires a Vector, String, or Map value");
        }
        break;
      }
      case "ErrorExpr":
        type = ERROR;
        break;
    }

    this.#expressionTypes.set(expression, type);
    return type;
  }

  #inferPattern(
    pattern: Resolved.Pattern,
    expected: Mono,
    level: number,
    generalizable: boolean,
    /**
     * The type of the whole right-hand side this pattern destructures — the
     * binding's one evaluated value (closure doc §13.6). Constant for the
     * entire walk and passed down every arm unchanged: the seat is a property
     * of the value that was constructed, not of the name a projection reaches.
     */
    evaluated: Mono = expected,
  ): void {
    if (pattern.kind === "Wildcard") return;
    if (pattern.kind === "Unit") {
      this.#unify(expected, UNIT, pattern.span);
      return;
    }
    if (pattern.kind === "Binding") {
      this.#schemes.set(
        pattern.binding.symbol,
        this.#generalize(expected, level, generalizable, undefined, evaluated),
      );
      return;
    }
    if (pattern.kind === "As") {
      this.#inferPattern(pattern.pattern, expected, level, generalizable, evaluated);
      this.#schemes.set(
        pattern.binding.symbol,
        this.#generalize(expected, level, generalizable, undefined, evaluated),
      );
      return;
    }
    if (pattern.kind === "Or") {
      // `evaluated` below is currently an **equivalent mutant** — dropping it
      // leaves the suite green — but for a reason that is not the one the other
      // equivalents rest on, and that a future change can remove. The call just
      // below opens component variables at `level` rather than `level + 1`, so
      // unification has already sunk the scrutinee's constrained variable below
      // generalization's admission filter and the seat test never speaks.
      // Should those levels ever be corrected (they are the same off-by-one as
      // #213), this argument becomes live: without it, `let ((g, n) | (g, n)) =
      // (describe, 1)` would read the seat off `g`'s own function-typed
      // component and generalize a constrained scheme into an emitter that
      // correctly eta-expands. Recorded rather than pinned, because no source
      // program can discriminate it today.
      this.#inferMatchPattern(pattern, expected, level);
      for (const binding of resolvedPatternBindings(pattern)) {
        this.#schemes.set(
          binding.symbol,
          this.#generalize(
            this.#scheme(binding.symbol).type,
            level,
            generalizable,
            undefined,
            evaluated,
          ),
        );
      }
      if (!this.#isIrrefutablePattern(pattern, expected)) {
        this.#diagnostics.add({
          severity: "error",
          message: "this or-pattern does not cover every possible value and cannot be used in a binding position; use `match`",
          primary: pattern.span,
        });
      }
      return;
    }
    if (pattern.kind === "Constructor") {
      const unionId = this.#constructorUnions.get(pattern.symbol);
      const union = unionId === undefined ? undefined : this.#unions.get(unionId);
      if (union === undefined || union.constructors.length !== 1) {
        this.#diagnostics.add({
          severity: "error",
          message: "a constructor pattern is refutable and cannot be used in a binding position; use `match`",
          primary: pattern.span,
        });
        return;
      }
      const constructor = union.constructors[0]!;
      const shape = this.#constructorShape(constructor.binding.symbol, level);
      const parameters = shape.parameters;
      this.#unify(
        expected,
        shape.result,
        pattern.span,
      );
      if (pattern.arguments.length !== parameters.length) {
        this.#diagnostics.add({
          severity: "error",
          message: `constructor pattern \`${pattern.text}\` expects ${parameters.length} arguments, got ${pattern.arguments.length}`,
          primary: pattern.span,
        });
      }
      // Same standing as the `Or` arm's: `evaluated` here is an equivalent
      // mutant *today*, masked by #213 — this arm's components are opened at the
      // binding's own level, so they never reach the seat test. It goes live the
      // moment #213 lands, and (x-h) is that fix's acceptance test, so the two
      // must be checked together or they will land unheld together.
      pattern.arguments.forEach((argument, index) =>
        this.#inferPattern(
          argument,
          parameters[index] ?? ERROR,
          level,
          generalizable,
          evaluated,
        )
      );
      return;
    }
    if (
      pattern.kind === "Integer" ||
      pattern.kind === "String"
    ) {
      this.#diagnostics.add({
        severity: "error",
        message: "a literal pattern is refutable and cannot be used in a binding position; use `match`",
        primary: pattern.span,
      });
      return;
    }

    if (pattern.kind === "Vector") {
      const element = this.#fresh(level + 1, false);
      const vector: VectorMono = { kind: "Vector", element };
      this.#unify(expected, vector, pattern.span);
      for (const nested of pattern.elements) {
        this.#inferPattern(nested, element, level, generalizable, evaluated);
      }
      if (pattern.rest?.pattern !== undefined) {
        this.#inferPattern(pattern.rest.pattern, vector, level, generalizable, evaluated);
      }
      if (pattern.rest === undefined || pattern.elements.length > 0) {
        this.#diagnostics.add({
          severity: "error",
          message: "this vector pattern can fail because of its length and cannot be used in `let`; use `match`",
          primary: pattern.span,
        });
      }
      return;
    }

    if (pattern.kind === "Record") {
      const fields = new Map<string, Mono>();
      for (const fieldPattern of pattern.fields) {
        const field = this.#fresh(level + 1, false);
        fields.set(fieldPattern.name, field);
      }
      this.#unify(expected, {
        kind: "Record",
        fields,
        tail: this.#fresh(level + 1, false),
      }, pattern.span);
      for (const fieldPattern of pattern.fields) {
        this.#inferPattern(
          fieldPattern.pattern,
          fields.get(fieldPattern.name) ?? ERROR,
          level,
          generalizable,
          evaluated,
        );
      }
      return;
    }

    const elements = pattern.elements.map(() => this.#fresh(level + 1, false));
    this.#unify(
      expected,
      { kind: "Tuple", elements },
      pattern.span,
    );
    pattern.elements.forEach((element, index) => {
      this.#inferPattern(element, elements[index]!, level, generalizable, evaluated);
    });
  }

  #inferMatchPattern(
    pattern: Resolved.Pattern,
    expected: Mono,
    level: number,
  ): void {
    if (pattern.kind === "Wildcard") return;
    if (pattern.kind === "Unit") {
      this.#unify(expected, UNIT, pattern.span);
      return;
    }
    if (pattern.kind === "Binding") {
      this.#schemes.set(pattern.binding.symbol, { variables: [], type: expected });
      return;
    }
    if (pattern.kind === "As") {
      this.#inferMatchPattern(pattern.pattern, expected, level);
      this.#schemes.set(pattern.binding.symbol, { variables: [], type: expected });
      return;
    }
    if (pattern.kind === "Or") {
      const common = new Map<Resolved.SymbolId, Mono>();
      for (const alternative of pattern.alternatives) {
        this.#inferMatchPattern(alternative, expected, level);
        for (const binding of resolvedPatternBindings(alternative)) {
          const current = this.#scheme(binding.symbol).type;
          const previous = common.get(binding.symbol);
          if (previous === undefined) common.set(binding.symbol, current);
          else this.#unify(previous, current, binding.span);
        }
      }
      for (const [symbol, type] of common) {
        this.#schemes.set(symbol, { variables: [], type });
      }
      return;
    }
    if (pattern.kind === "Integer") {
      this.#unify(expected, primitive("Int"), pattern.span);
      return;
    }
    if (pattern.kind === "String") {
      this.#unify(expected, primitive("String"), pattern.span);
      return;
    }
    if (pattern.kind === "Tuple") {
      const elements = pattern.elements.map(() => this.#fresh(level, false));
      this.#unify(expected, { kind: "Tuple", elements }, pattern.span);
      pattern.elements.forEach((element, index) =>
        this.#inferMatchPattern(element, elements[index] ?? ERROR, level)
      );
      return;
    }
    if (pattern.kind === "Vector") {
      const element = this.#fresh(level, false);
      const vector: VectorMono = { kind: "Vector", element };
      this.#unify(expected, vector, pattern.span);
      for (const nested of pattern.elements) this.#inferMatchPattern(nested, element, level);
      if (pattern.rest?.pattern !== undefined) {
        this.#inferMatchPattern(pattern.rest.pattern, vector, level);
      }
      return;
    }
    if (pattern.kind === "Record") {
      const fields = new Map(
        pattern.fields.map((field) => [field.name, this.#fresh(level, false)]),
      );
      this.#unify(expected, {
        kind: "Record",
        fields,
        tail: this.#fresh(level, false),
      }, pattern.span);
      for (const field of pattern.fields) {
        this.#inferMatchPattern(
          field.pattern,
          fields.get(field.name) ?? ERROR,
          level,
        );
      }
      return;
    }

    const unionId = this.#constructorUnions.get(pattern.symbol);
    const union = unionId === undefined ? undefined : this.#unions.get(unionId);
    if (union === undefined) return;
    const constructor = union.constructors.find(
      ({ binding }) => binding.symbol === pattern.symbol,
    );
    if (constructor === undefined) return;
    const shape = this.#constructorShape(constructor.binding.symbol, level);
    const parameters = shape.parameters;
    this.#unify(expected, shape.result, pattern.span);
    if (pattern.arguments.length !== parameters.length) {
      this.#diagnostics.add({
        severity: "error",
        message: `constructor pattern \`${pattern.text}\` expects ${parameters.length} arguments, got ${pattern.arguments.length}`,
        primary: pattern.span,
      });
    }
    pattern.arguments.forEach((argument, index) =>
      this.#inferMatchPattern(argument, parameters[index] ?? ERROR, level)
    );
  }

  #inferExceptionPattern(pattern: Resolved.Pattern, level: number): void {
    if (pattern.kind === "Binding" || pattern.kind === "Wildcard") {
      this.#inferMatchPattern(pattern, primitive("Exn"), level);
      return;
    }
    if (pattern.kind === "As") {
      this.#inferExceptionPattern(pattern.pattern, level);
      this.#schemes.set(pattern.binding.symbol, {
        variables: [],
        type: primitive("Exn"),
      });
      return;
    }
    if (pattern.kind === "Or") {
      const common = new Map<Resolved.SymbolId, Mono>();
      for (const alternative of pattern.alternatives) {
        this.#inferExceptionPattern(alternative, level);
        for (const binding of resolvedPatternBindings(alternative)) {
          const current = this.#scheme(binding.symbol).type;
          const previous = common.get(binding.symbol);
          if (previous === undefined) common.set(binding.symbol, current);
          else this.#unify(previous, current, binding.span);
        }
      }
      for (const [symbol, type] of common) {
        this.#schemes.set(symbol, { variables: [], type });
      }
      return;
    }
    if (pattern.kind !== "Constructor") {
      this.#inferMatchPattern(pattern, primitive("Exn"), level);
      return;
    }
    if (!this.#exceptions.has(pattern.symbol)) {
      this.#diagnostics.add({
        severity: "error",
        message: `\`${pattern.text}\` is not an exception constructor`,
        primary: pattern.span,
      });
      return;
    }
    const shape = this.#constructorShape(pattern.symbol, level);
    this.#unify(shape.result, primitive("Exn"), pattern.span);
    if (shape.parameters.length !== pattern.arguments.length) {
      this.#diagnostics.add({
        severity: "error",
        message: `exception pattern \`${pattern.text}\` expects ${shape.parameters.length} arguments, got ${pattern.arguments.length}`,
        primary: pattern.span,
      });
    }
    pattern.arguments.forEach((argument, index) =>
      this.#inferMatchPattern(argument, shape.parameters[index] ?? ERROR, level)
    );
  }

  #isIrrefutablePattern(pattern: Resolved.Pattern, expected: Mono): boolean {
    if (pattern.kind === "Wildcard" || pattern.kind === "Binding") return true;
    if (pattern.kind === "As") {
      return this.#isIrrefutablePattern(pattern.pattern, expected);
    }
    const actual = this.#prune(expected);
    // Constructor slots are typed by the *declaration*, so a slot declared with
    // the union's own parameter (`Some(value: a)`) arrives here as a bare
    // variable, carrying no structure to compare a `Tuple`/`Record`/`Vector`
    // pattern against. Decide those structurally instead of defaulting to
    // refutable: the pattern has already been checked against the real scrutinee
    // type by `#inferMatchPattern`, so if it typechecks at all, the slot has the
    // shape the pattern destructures, and irrefutability turns only on whether
    // every component pattern is itself irrefutable.
    if (actual.kind === "Variable") return isStructurallyIrrefutablePattern(pattern);
    if (pattern.kind === "Or") {
      if (pattern.alternatives.some((alternative) =>
        this.#isIrrefutablePattern(alternative, actual)
      )) return true;
      if (actual.kind === "Union") {
        const union = this.#unions.get(actual.union);
        return union?.constructors.every((constructor) =>
          pattern.alternatives.some((alternative) => {
            const unwrapped = unwrapAsPattern(alternative);
            if (
              unwrapped.kind !== "Constructor" ||
              unwrapped.symbol !== constructor.binding.symbol
            ) return false;
            return unwrapped.arguments.every((argument, index) => {
              const slot = constructor.slots[index];
              return slot !== undefined && this.#isIrrefutablePattern(
                argument,
                this.#annotationType(slot.annotation),
              );
            });
          })
        ) ?? false;
      }
      return false;
    }
    if (pattern.kind === "Unit") {
      // The arity-0 tuple pattern (#159): irrefutable exactly when the tuple
      // rule below is, vacuously — spelled out because the surface node is its
      // own kind, not because the answer differs.
      return actual.kind === "Tuple" && actual.elements.length === 0;
    }
    if (pattern.kind === "Tuple") {
      return actual.kind === "Tuple" &&
        pattern.elements.length === actual.elements.length &&
        pattern.elements.every((element, index) =>
          this.#isIrrefutablePattern(element, actual.elements[index] ?? ERROR)
        );
    }
    if (pattern.kind === "Record") {
      if (actual.kind !== "Record") return false;
      const fields = this.#normalizeRecord(actual).fields;
      return pattern.fields.every((field) =>
        this.#isIrrefutablePattern(
          field.pattern,
          fields.get(field.name) ?? ERROR,
        )
      );
    }
    if (pattern.kind === "Constructor" && actual.kind === "Union") {
      const union = this.#unions.get(actual.union);
      if (union?.constructors.length !== 1) return false;
      const constructor = union.constructors[0]!;
      return constructor.binding.symbol === pattern.symbol &&
        pattern.arguments.every((argument, index) => {
          const slot = constructor.slots[index];
          return slot !== undefined && this.#isIrrefutablePattern(
            argument,
            this.#annotationType(slot.annotation),
          );
        });
    }
    return false;
  }

  #constructorPatternsAreExhaustive(
    patterns: readonly Resolved.ConstructorPattern[],
  ): boolean {
    const first = patterns[0];
    if (first === undefined) return false;
    const unionId = this.#constructorUnions.get(first.symbol);
    const union = unionId === undefined ? undefined : this.#unions.get(unionId);
    const constructor = union?.constructors.find(
      ({ binding }) => binding.symbol === first.symbol,
    );
    const slots = constructor?.slots ?? this.#exceptions.get(first.symbol)?.slots;
    if (slots === undefined) return false;
    if (patterns.some((pattern) =>
      pattern.arguments.length === slots.length &&
      pattern.arguments.every((argument, index) =>
        this.#isIrrefutablePattern(
          argument,
          this.#annotationType(slots[index]!.annotation),
        )
      )
    )) return true;
    if (slots.length !== 1) return false;
    const arguments_ = patterns.flatMap((pattern) => pattern.arguments.slice(0, 1));
    if (arguments_.length !== patterns.length) return false;
    return this.#isIrrefutablePattern(
      { kind: "Or", alternatives: arguments_, span: first.span },
      this.#annotationType(slots[0]!.annotation),
    );
  }

  #inferBinary(expression: Resolved.BinaryExpr, level: number): Mono {
    if (expression.operator === "Pipe") {
      const call = rewritePipe(expression);
      this.#pipeCalls.set(expression, call);
      return this.#inferExpr(call, level);
    }

    const left = this.#inferExpr(expression.left, level);
    const right = this.#inferExpr(expression.right, level);

    if (["And", "Or", "Implies", "Iff"].includes(expression.operator)) {
      const bool = this.#boolType(expression.span);
      this.#unify(left, bool, expression.left.span);
      this.#unify(right, bool, expression.right.span);
      // `iff` lowers to `Eq<Bool>` equality (§5.5's derived-logic table), so it
      // needs a real, *resolved* requirement — evidence selection runs over the
      // registered ones. Before #147 `Eq<Bool>` was primitive evidence the
      // elaborator could name from the type alone; now it is the prelude
      // declaration's derived instance and has to be selected like any other.
      // The other four operators require nothing: they are structural forms.
      this.#requirements.set(
        expression,
        expression.operator === "Iff"
          ? [this.#require("Eq", bool, expression.span, "operation")]
          : [],
      );
      return bool;
    }

    if (expression.operator === "Range") {
      this.#unify(left, primitive("Int"), expression.left.span);
      this.#unify(right, primitive("Int"), expression.right.span);
      return { kind: "Range" };
    }
    const constraint: Typed.ConstraintName =
      expression.operator === "Divide"
        ? "Frac"
        : expression.operator === "Power"
          ? "Pow"
        : expression.operator === "Concat"
          ? "Concat"
          : expression.operator === "Subtract"
            ? "Signed"
            : "Num";
    let common = left;
    if (this.#tryWidenNumeric(expression.left, left, right, expression.span, true)) {
      common = right;
    } else if (
      this.#tryWidenNumeric(expression.right, right, left, expression.span, true)
    ) {
      common = left;
    } else {
      this.#unify(left, right, expression.span);
    }
    const requirement = this.#require(constraint, common, expression.span);
    this.#requirements.set(expression, [requirement]);
    return common;
  }

  #checkCallArguments(
    parameters: readonly Mono[],
    arguments_: readonly Mono[],
    expressions: readonly Resolved.Expr[],
    span: Source.Span,
  ): void {
    // A later argument may establish the shared type of an earlier Nat/Int argument
    // (`plus(count, 1.5)`). Bare literals and fresh variables establish nothing,
    // so defer both classes until concrete/already-constrained arguments settle.
    const deferredNumericArguments: number[] = [];
    const deferredLiteralArguments: number[] = [];
    const establishedVariables = new Set<number>();

    for (const [index, actual] of arguments_.entries()) {
      const expected = parameters[index] ?? ERROR;
      const expression = expressions[index];
      if (expression === undefined) continue;
      const source = this.#prune(actual);
      const destination = this.#prune(expected);
      if (
        source.kind === "Variable" && source.literalOnly &&
        destination.kind === "Variable"
      ) {
        deferredLiteralArguments.push(index);
        continue;
      }
      if (
        source.kind === "Constructor" && ["Nat", "Int"].includes(source.name) &&
        destination.kind === "Variable"
      ) {
        deferredNumericArguments.push(index);
        continue;
      }
      const independentlyEstablished = source.kind !== "Variable" ||
        this.#supportsNumericTarget(source, true);
      this.#unifyExpected(expected, actual, expression, span, true);
      const established = this.#prune(expected);
      if (independentlyEstablished && established.kind === "Variable") {
        establishedVariables.add(established.id);
      }
    }

    for (const index of deferredNumericArguments) {
      const expected = parameters[index] ?? ERROR;
      const actual = arguments_[index] ?? ERROR;
      const expression = expressions[index];
      if (expression === undefined) continue;
      const destination = this.#prune(expected);
      const allowVariableTarget = destination.kind === "Variable" &&
        establishedVariables.has(destination.id);
      this.#unifyExpected(
        expected,
        actual,
        expression,
        span,
        allowVariableTarget,
      );
    }

    for (const index of deferredLiteralArguments) {
      const expected = parameters[index] ?? ERROR;
      const actual = arguments_[index] ?? ERROR;
      const expression = expressions[index];
      if (expression === undefined) continue;
      this.#unifyExpected(expected, actual, expression, span, true);
    }
  }

  #fresh(
    level: number,
    literalOnly: boolean,
    rigidName?: string,
    declaredConstraints?: readonly Typed.ConstraintName[],
  ): Variable {
    const variable: Variable = {
      kind: "Variable",
      id: this.#nextVariable++,
      ...(rigidName === undefined ? {} : { rigidName }),
      ...(declaredConstraints === undefined ? {} : { declaredConstraints }),
      level,
      literalOnly,
      requirements: [],
      rejectedConstraints: new Set(),
    };
    this.#variables.push(variable);
    return variable;
  }

  /** Whether a type is known to be `Unit` — an unsolved variable is not. */
  #solvesToUnit(type: Mono | undefined): boolean {
    if (type === undefined) return false;
    const solved = this.#prune(type);
    return solved.kind === "Tuple" && solved.elements.length === 0;
  }

  /**
   * A zero-against-one arity mismatch, which otherwise surfaces as a bare
   * `0 and 1` naming neither the cause nor the fix (Functions §5.3). `left` is
   * the expected type and `right` the actual.
   *
   * When the one-parameter side's parameter genuinely solves to `Unit` this is
   * the `() -> T` versus `Unit -> T` confusion and is named as such. When that
   * parameter is still unsolved, `Unit` is not claimed — but the zero-parameter
   * side is concrete either way, so the message still says what is provable and
   * carries the fix.
   */
  #nullaryArityMessage(left: Mono, right: Mono): string | undefined {
    if (left.kind !== "Function" || right.kind !== "Function") return undefined;
    const expectedNullary = left.parameters.length === 0 && right.parameters.length === 1;
    const actualNullary = left.parameters.length === 1 && right.parameters.length === 0;
    if (!expectedNullary && !actualNullary) return undefined;

    const soleParameter = expectedNullary ? right.parameters[0] : left.parameters[0];
    if (this.#solvesToUnit(soleParameter)) {
      return "`Unit -> T` takes a unit value, so it is a one-parameter function; " +
        "for a zero-parameter function write `() -> T`";
    }
    return expectedNullary
      ? "expected a zero-parameter function, but this one takes a parameter; " +
        "write `() => ...`"
      : "a zero-parameter function cannot be passed where a one-parameter function " +
        "is expected; generics do not abstract over arity, so wrap it: `_ => thunk()`";
  }

  #prune(type: Mono): Mono {
    if (type.kind !== "Variable" || type.instance === undefined) return type;
    type.instance = this.#prune(type.instance);
    return type.instance;
  }

  #unify(
    left: Mono,
    right: Mono,
    span: Source.Span,
    message?: () => string,
  ): void {
    const actualLeft = this.#prune(left);
    const actualRight = this.#prune(right);
    if (
      actualLeft === actualRight ||
      actualLeft.kind === "Error" ||
      actualRight.kind === "Error"
    ) {
      return;
    }

    if (actualLeft.kind === "Variable") {
      this.#bind(actualLeft, actualRight, span);
      return;
    }
    if (actualRight.kind === "Variable") {
      this.#bind(actualRight, actualLeft, span);
      return;
    }
    if (actualLeft.kind === "Constructor" && actualRight.kind === "Constructor") {
      if (actualLeft.name === actualRight.name) return;
    } else if (actualLeft.kind === "Function" && actualRight.kind === "Function") {
      if (actualLeft.parameters.length !== actualRight.parameters.length) {
        this.#diagnostics.add({
          severity: "error",
          message: this.#nullaryArityMessage(actualLeft, actualRight) ??
            `function arity mismatch: ${actualLeft.parameters.length} and ` +
              `${actualRight.parameters.length}`,
          primary: span,
        });
        return;
      }
      actualLeft.parameters.forEach((parameter, index) => {
        const other = actualRight.parameters[index];
        if (other !== undefined) this.#unify(parameter, other, span);
      });
      this.#unify(actualLeft.result, actualRight.result, span);
      return;
    } else if (actualLeft.kind === "Tuple" && actualRight.kind === "Tuple") {
      if (actualLeft.elements.length === actualRight.elements.length) {
        actualLeft.elements.forEach((element, index) => {
          this.#unify(element, actualRight.elements[index]!, span);
        });
        return;
      }
      // At arity 0 the tuple is `Unit`, and the report must say so (Products
      // §2.7): fall through to the general mismatch, whose display does.
      if (actualLeft.elements.length > 0 && actualRight.elements.length > 0) {
        this.#diagnostics.add({
          severity: "error",
          message:
            `tuple arity mismatch: ${actualLeft.elements.length} and ` +
            `${actualRight.elements.length}`,
          primary: span,
        });
        return;
      }
    } else if (actualLeft.kind === "Record" && actualRight.kind === "Record") {
      this.#unifyRecords(actualLeft, actualRight, span);
      return;
    } else if (actualLeft.kind === "Union" && actualRight.kind === "Union") {
      if (actualLeft.union === actualRight.union) {
        actualLeft.arguments.forEach((argument, index) => {
          const other = actualRight.arguments[index];
          if (other !== undefined) this.#unify(argument, other, span);
        });
        return;
      }
    } else if (
      actualLeft.kind === "NominalRecord" &&
      actualRight.kind === "NominalRecord"
    ) {
      if (actualLeft.record === actualRight.record) {
        actualLeft.arguments.forEach((argument, index) => {
          const other = actualRight.arguments[index];
          if (other !== undefined) this.#unify(argument, other, span);
        });
        return;
      }
    } else if (
      actualLeft.kind === "ExternType" &&
      actualRight.kind === "ExternType"
    ) {
      if (actualLeft.externType === actualRight.externType) return;
    } else if (actualLeft.kind === "Range" && actualRight.kind === "Range") {
      return;
    } else if (actualLeft.kind === "Vector" && actualRight.kind === "Vector") {
      this.#unify(actualLeft.element, actualRight.element, span);
      return;
    } else if (actualLeft.kind === "Set" && actualRight.kind === "Set") {
      this.#unify(actualLeft.element, actualRight.element, span);
      return;
    } else if (actualLeft.kind === "Array" && actualRight.kind === "Array") {
      this.#unify(actualLeft.element, actualRight.element, span);
      return;
    } else if (actualLeft.kind === "Node" && actualRight.kind === "Node") {
      this.#unify(actualLeft.element, actualRight.element, span);
      return;
    } else if (actualLeft.kind === "Nullable" && actualRight.kind === "Nullable") {
      this.#unify(actualLeft.value, actualRight.value, span);
      return;
    } else if (actualLeft.kind === "Map" && actualRight.kind === "Map") {
      this.#unify(actualLeft.key, actualRight.key, span);
      this.#unify(actualLeft.value, actualRight.value, span);
      return;
    }

    this.#diagnostics.add({
      severity: "error",
      message:
        message?.() ??
        `type mismatch: expected ${this.#display(actualLeft)}, found ` +
          this.#display(actualRight),
      primary: span,
    });
  }

  #unifyRecords(left: RecordMono, right: RecordMono, span: Source.Span): void {
    left = this.#normalizeRecord(left);
    right = this.#normalizeRecord(right);
    for (const [name, type] of left.fields) {
      const other = right.fields.get(name);
      if (other !== undefined) this.#unify(type, other, span);
    }
    const leftOnly = new Map([...left.fields].filter(([name]) => !right.fields.has(name)));
    const rightOnly = new Map([...right.fields].filter(([name]) => !left.fields.has(name)));

    if (left.tail === undefined && rightOnly.size > 0) {
      this.#recordMismatch([...rightOnly.keys()], span);
      return;
    }
    if (right.tail === undefined && leftOnly.size > 0) {
      this.#recordMismatch([...leftOnly.keys()], span);
      return;
    }
    if (left.tail !== undefined && right.tail !== undefined) {
      const actualLeftTail = this.#prune(left.tail);
      const actualRightTail = this.#prune(right.tail);
      if (actualLeftTail === actualRightTail) {
        if (leftOnly.size > 0 || rightOnly.size > 0) {
          this.#recordMismatch([...leftOnly.keys(), ...rightOnly.keys()], span);
        }
        return;
      }
      const shared = this.#fresh(Math.min(left.tail.level, right.tail.level), false);
      this.#bind(left.tail, { kind: "Record", fields: rightOnly, tail: shared }, span);
      this.#bind(right.tail, { kind: "Record", fields: leftOnly, tail: shared }, span);
      return;
    }
    if (left.tail !== undefined) {
      this.#bind(left.tail, { kind: "Record", fields: rightOnly }, span);
      return;
    }
    if (right.tail !== undefined) {
      this.#bind(right.tail, { kind: "Record", fields: leftOnly }, span);
    }
  }

  #normalizeRecord(record: RecordMono): RecordMono {
    const fields = new Map(record.fields);
    let tail = record.tail;
    while (tail !== undefined) {
      const actual = this.#prune(tail);
      if (actual.kind === "Variable") {
        return { kind: "Record", fields, tail: actual };
      }
      if (actual.kind !== "Record") return { kind: "Record", fields };
      for (const [name, field] of actual.fields) {
        if (!fields.has(name)) fields.set(name, field);
      }
      tail = actual.tail;
    }
    return { kind: "Record", fields };
  }

  /**
   * A declared type variable tried to stand for a captured module-level binding
   * whose type the value restriction pinned. Leads with the canonical repair
   * (Rewrite Rule), then the inference-revealing alternative.
   */
  #placeholderEscape(rigidName: string, span: Source.Span): void {
    this.#diagnostics.add({
      severity: "error",
      message:
        `\`${rigidName}\` is a declared type variable, but the body requires the single ` +
        "type of a module-level binding that is not generalized; name that concrete type " +
        `instead of \`${rigidName}\`, or make the binding generalizable by defining it as a ` +
        "function",
      primary: span,
    });
  }

  #recordMismatch(fields: readonly string[], span: Source.Span): void {
    this.#diagnostics.add({
      severity: "error",
      message: `record fields do not match; unexpected ${fields.map((field) => `\`${field}\``).join(", ")}`,
      primary: span,
    });
  }

  #bind(variable: Variable, type: Mono, span: Source.Span): void {
    // The placeholder may also be the one being bound, to a type that *mentions*
    // a declared variable (`fun reuse(): Vector(a) = shared`). Binding it would
    // let `a` be quantified while standing for the pinned binding's element type,
    // which is the same escape seen from the other direction below.
    if (variable.placeholder === true) {
      const declared = this.#collectVariables(type).find(
        (candidate) => candidate.rigidName !== undefined,
      );
      if (declared !== undefined) {
        this.#placeholderEscape(declared.rigidName!, span);
        variable.instance = ERROR;
        return;
      }
    }
    if (variable.rigidName !== undefined) {
      if (type.kind === "Variable" && type.rigidName === undefined) {
        // A placeholder is one binding's single type, so a declared type variable
        // cannot stand for it: absorbing it would let the annotation generalize
        // over a value the value restriction pinned, and each caller would receive
        // a fresh instantiation of one runtime value.
        if (type.placeholder === true) {
          this.#placeholderEscape(variable.rigidName, span);
          variable.instance = ERROR;
          return;
        }
        this.#bind(type, variable, span);
        return;
      }
      if (type.kind === "Variable" && type.rigidName !== undefined) {
        this.#diagnostics.add({
          severity: "error",
          message:
            `\`${variable.rigidName}\` and \`${type.rigidName}\` are distinct declared type variables, ` +
            "but the body requires them to be the same; use one type variable name in both " +
            "annotations, or remove an annotation to let the type be inferred",
          primary: span,
        });
      } else {
        const required = Typed.displayScheme({
          variables: [],
          constraints: [],
          type: this.#publicType(type),
        });
        this.#diagnostics.add({
          severity: "error",
          message:
            `\`${variable.rigidName}\` is a declared type variable, but the body requires ` +
            `\`${required}\`; change the annotation to \`${required}\`, or remove it to let ` +
            "the type be inferred",
          primary: span,
        });
      }
      variable.instance = ERROR;
      return;
    }
    if (type.kind === "Variable") {
      type.level = Math.min(type.level, variable.level);
      type.literalOnly &&= variable.literalOnly;
      for (const requirement of variable.requirements) {
        this.#acceptRequirement(type, requirement);
      }
      variable.instance = type;
      return;
    }
    if (this.#occurs(variable, type)) {
      this.#diagnostics.add({
        severity: "error",
        message: "infinite type: a type variable occurs inside itself",
        primary: span,
      });
      variable.instance = ERROR;
      return;
    }
    // Algorithm J's level adjustment. Binding `?a` at level L to a composite
    // puts every variable inside that composite in `?a`'s scope, so each must
    // sink to L or generalization will quantify a variable the environment can
    // still see. The variable-to-variable case above does this already; without
    // the composite case, `(p) => { let {x} = p; x }` quantified the row's
    // field variable and typed `getX` as `{x: a | r} -> b` — the sharing hazard
    // that Functions §8.2 leaves to levels rather than to the value restriction
    // (closure doc §2.2, conformance item (v)). It went unseen while the only
    // generalizable right-hand sides were lambdas and literals.
    this.#lowerLevels(type, variable.level);
    variable.instance = type;
    for (const requirement of variable.requirements) this.#validate(requirement);
  }

  /** Sinks every variable in `type` to `level` if it sits above it. */
  #lowerLevels(type: Mono, level: number): void {
    const actual = this.#prune(type);
    switch (actual.kind) {
      case "Variable":
        if (actual.level > level) actual.level = level;
        return;
      case "Tuple":
        for (const element of actual.elements) this.#lowerLevels(element, level);
        return;
      case "Record":
        for (const field of actual.fields.values()) this.#lowerLevels(field, level);
        if (actual.tail !== undefined) this.#lowerLevels(actual.tail, level);
        return;
      case "Function":
        for (const parameter of actual.parameters) this.#lowerLevels(parameter, level);
        this.#lowerLevels(actual.result, level);
        return;
      case "Union":
      case "NominalRecord":
        for (const argument of actual.arguments) this.#lowerLevels(argument, level);
        return;
      case "Vector":
      case "Set":
      case "Array":
      case "Node":
        this.#lowerLevels(actual.element, level);
        return;
      case "Nullable":
        this.#lowerLevels(actual.value, level);
        return;
      case "Map":
        this.#lowerLevels(actual.key, level);
        this.#lowerLevels(actual.value, level);
        return;
      default:
        return;
    }
  }

  #occurs(variable: Variable, type: Mono): boolean {
    const actual = this.#prune(type);
    if (actual === variable) return true;
    if (actual.kind === "Tuple") {
      return actual.elements.some((element) => this.#occurs(variable, element));
    }
    if (actual.kind === "Record") {
      return [...actual.fields.values()].some((field) => this.#occurs(variable, field)) ||
        (actual.tail !== undefined && this.#occurs(variable, actual.tail));
    }
    if (actual.kind === "Function") {
      return (
        actual.parameters.some((parameter) => this.#occurs(variable, parameter)) ||
        this.#occurs(variable, actual.result)
      );
    }
    if (actual.kind === "Union") {
      return actual.arguments.some((argument) => this.#occurs(variable, argument));
    }
    if (actual.kind === "NominalRecord") {
      return actual.arguments.some((argument) => this.#occurs(variable, argument));
    }
    if (actual.kind === "Vector") return this.#occurs(variable, actual.element);
    if (actual.kind === "Set") return this.#occurs(variable, actual.element);
    if (actual.kind === "Array") return this.#occurs(variable, actual.element);
    if (actual.kind === "Node") return this.#occurs(variable, actual.element);
    if (actual.kind === "Nullable") return this.#occurs(variable, actual.value);
    if (actual.kind === "Map") return this.#occurs(variable, actual.key) || this.#occurs(variable, actual.value);
    return false;
  }

  #require(
    name: Typed.ConstraintName,
    type: Mono,
    span: Source.Span,
    origin: Requirement["origin"] = "operation",
    impliedTypes?: ReadonlyMap<string, Mono>,
  ): Requirement {
    const requirement: Requirement = {
      name,
      type,
      span,
      origin,
      ...(impliedTypes === undefined ? {} : { impliedTypes }),
      reported: false,
    };
    const actual = this.#prune(type);
    if (actual.kind === "Variable") this.#acceptRequirement(actual, requirement);
    else this.#validate(requirement);
    return requirement;
  }

  #tryWidenInt(
    expression: Resolved.Expr,
    actual: Mono,
    target: Mono,
    span: Source.Span,
    allowVariableTarget = false,
  ): boolean {
    // This is contextual evidence insertion, not subtyping: the target must already
    // support the matching numeric tier, and literal-only variables cannot bootstrap their own target.
    const source = this.#prune(actual);
    const destination = this.#prune(target);
    if (source.kind !== "Constructor" || source.name !== "Int") return false;
    if (destination.kind === "Constructor" && destination.name === "Int") return false;

    if (!this.#supportsSignedTarget(destination, allowVariableTarget)) return false;

    const requirement = this.#require("Signed", destination, span);
    this.#intWidenings.set(expression, requirement);
    return true;
  }

  #tryWidenNat(
    expression: Resolved.Expr,
    actual: Mono,
    target: Mono,
    span: Source.Span,
    allowVariableTarget = false,
  ): boolean {
    const source = this.#prune(actual);
    const destination = this.#prune(target);
    if (source.kind !== "Constructor" || source.name !== "Nat") return false;
    if (destination.kind === "Constructor" && destination.name === "Nat") return false;
    if (!this.#supportsTarget(destination, "Num", allowVariableTarget)) return false;

    const requirement = this.#require("Num", destination, span);
    this.#natWidenings.set(expression, requirement);
    return true;
  }

  #tryWidenNumeric(
    expression: Resolved.Expr,
    actual: Mono,
    target: Mono,
    span: Source.Span,
    allowVariableTarget = false,
  ): boolean {
    return this.#tryWidenInt(expression, actual, target, span, allowVariableTarget) ||
      this.#tryWidenNat(expression, actual, target, span, allowVariableTarget);
  }

  #hasNumericWidening(expression: Resolved.Expr): boolean {
    return this.#natWidenings.has(expression) || this.#intWidenings.has(expression);
  }

  #supportsTarget(
    target: Mono,
    constraint: Typed.ConstraintName,
    allowVariableTarget = false,
  ): boolean {
    const destination = this.#prune(target);
    return destination.kind === "Variable"
      ? allowVariableTarget && !destination.literalOnly &&
        destination.requirements.some(({ name }) =>
          this.#baseConstraintPath(name, constraint) !== undefined
        )
      : destination.kind === "Constructor"
        ? supports(destination.name, constraint)
        : this.#instances.has(this.#instanceKey(constraint, destination));
  }

  #supportsSignedTarget(target: Mono, allowVariableTarget = false): boolean {
    return this.#supportsTarget(target, "Signed", allowVariableTarget);
  }

  #supportsNumericTarget(target: Mono, allowVariableTarget = false): boolean {
    return this.#supportsTarget(target, "Num", allowVariableTarget);
  }

  #unifyExpected(
    expected: Mono,
    actual: Mono,
    expression: Resolved.Expr,
    span: Source.Span,
    allowVariableTarget = false,
  ): void {
    if (
      !this.#tryWidenNumeric(
        expression,
        actual,
        expected,
        span,
        allowVariableTarget,
      )
    ) {
      this.#unify(expected, actual, span);
    }
  }

  #attachRequirement(variable: Variable, requirement: Requirement): void {
    const provider = variable.requirements.find(
      (candidate) =>
        this.#baseConstraintPath(candidate.name, requirement.name) !== undefined,
    );
    if (provider !== undefined) {
      if (provider.name === requirement.name) return;
      const path = this.#baseConstraintPath(provider.name, requirement.name);
      requirement.evidenceConstraint = provider.name;
      if (path !== undefined) requirement.evidencePath = path;
      return;
    }
    for (const existing of variable.requirements) {
      const path = this.#baseConstraintPath(requirement.name, existing.name);
      if (path !== undefined) {
        existing.evidenceConstraint = requirement.name;
        existing.evidencePath = path;
      }
    }
    variable.requirements.push(requirement);
  }

  #acceptRequirement(variable: Variable, requirement: Requirement): void {
    const declared = variable.declaredConstraints;
    if (
      declared !== undefined &&
      requirement.origin !== "annotation" &&
      !declared.some((constraint) =>
        this.#baseConstraintPath(constraint, requirement.name) !== undefined
      )
    ) {
      if (variable.rejectedConstraints.has(requirement.name)) {
        requirement.reported = true;
        return;
      }
      variable.rejectedConstraints.add(requirement.name);
      const canonical = this.#maximalConstraintNames([
        ...declared,
        requirement.name,
      ]);
      const constraintList = canonical.length === 1
        ? canonical[0]!
        : `(${canonical.join(", ")})`;
      const declaration = declared.length === 0
        ? `\`${variable.rigidName}\` is declared without constraints`
        : `\`${variable.rigidName}\` is declared to honor ${
          this.#formatConstraintNames(declared)
        }`;
      const inferenceRewrite = declared.length === 0
        ? "remove the explicit type parameter to let it be inferred"
        : "remove the constraint annotation to let it be inferred";
      this.#diagnostics.add({
        severity: "error",
        message:
          `${declaration}, but the body requires ` +
          `\`${requirement.name}\`; write \`<${variable.rigidName}: ${constraintList}>\`, ` +
          `or ${inferenceRewrite}`,
        primary: requirement.span,
      });
      requirement.reported = true;
      return;
    }
    this.#attachRequirement(variable, requirement);
  }

  #maximalConstraintNames(
    constraints: readonly Typed.ConstraintName[],
  ): readonly Typed.ConstraintName[] {
    const unique = [...new Set(constraints)];
    return unique.filter((constraint) =>
      !unique.some((other) =>
        other !== constraint &&
        this.#baseConstraintPath(other, constraint) !== undefined
      )
    );
  }

  #formatConstraintNames(
    constraints: readonly Typed.ConstraintName[],
  ): string {
    return constraints.map((constraint) => `\`${constraint}\``).join(" and ");
  }

  #baseConstraintPath(
    constraint: string,
    target: string,
    seen = new Set<string>(),
  ): readonly string[] | undefined {
    if (constraint === target) return [];
    if (seen.has(constraint)) return undefined;
    seen.add(constraint);
    for (const baseConstraint of this.#baseConstraints(constraint)) {
      const suffix = this.#baseConstraintPath(baseConstraint, target, seen);
      if (suffix !== undefined) {
        const slot =
          (baseConstraint[0]?.toLowerCase() ?? "") + baseConstraint.slice(1);
        return [slot, ...suffix];
      }
    }
    return undefined;
  }

  #baseConstraints(constraint: string): readonly string[] {
    const declared = this.#constraintDeclarations.get(constraint);
    if (declared !== undefined) return declared.baseConstraints;
    if (constraint === "Ord") return ["Eq"];
    if (constraint === "Signed") return ["Num"];
    if (constraint === "Frac") return ["Signed"];
    if (constraint === "Pow") return ["Num"];
    if (constraint === "Hash") return ["Eq"];
    if (constraint === "Integral") return ["Num", "Ord"];
    return [];
  }

  #validate(requirement: Requirement): void {
    if (requirement.reported) return;
    const type = this.#prune(requirement.type);
    if (type.kind === "Variable" || type.kind === "Error") return;
    if (type.kind === "Constructor" && supports(type.name, requirement.name)) return;
    if (
      structuralConstraints.includes(requirement.name) &&
      (type.kind === "Tuple" || type.kind === "Record" || type.kind === "Vector")
    ) {
      const components = type.kind === "Tuple"
        ? type.elements
        : type.kind === "Record"
        ? [...type.fields.values()]
        : [type.element];
      for (const component of components) {
        this.#require(requirement.name, component, requirement.span);
      }
      requirement.structural = true;
      return;
    }
    if (requirement.name === "Concat" && type.kind === "Vector") {
      requirement.structural = true;
      return;
    }
    if (["Eq", "Show", "Hash"].includes(requirement.name) && type.kind === "Set") {
      this.#require(requirement.name === "Show" ? "Show" : "Hash", type.element, requirement.span);
      requirement.structural = true;
      return;
    }
    if (["Eq", "Show", "Hash"].includes(requirement.name) && type.kind === "Map") {
      if (requirement.name === "Show") {
        this.#require("Show", type.key, requirement.span);
        this.#require("Show", type.value, requirement.span);
      } else {
        this.#require("Hash", type.key, requirement.span);
        this.#require(requirement.name === "Hash" ? "Hash" : "Eq", type.value, requirement.span);
      }
      requirement.structural = true;
      return;
    }
    // The pinned `Bool` satisfies its four derivable constraints **structurally**
    // (#147). The instances themselves are real and derived — `stdlib/Bool.hex`
    // declares them through the ordinary `derives` door, and `Bool.js` exports
    // them — but a *direct* use inlines the same structural code instead of
    // reaching for the dictionary, exactly as a tuple or a vector does above.
    //
    // Why: without this, naming `Bool` in a signature drags four unused
    // dictionary imports into the emitted JavaScript of nearly every module,
    // because a module's interface is fixed before checking and so the import
    // cannot be pruned afterwards (see the `Import` case in `#materializeItem`).
    // Structural satisfaction agrees with the declared instances by
    // construction, since both are the derivation of the same declaration.
    //
    // **Flagged for review:** this is the one place where emission quality was
    // put ahead of a literal reading of decisions doc §3.5 ("`Eq<Bool>` … cease
    // to be compiler-provided instances"). The instances have not moved back
    // into the compiler — the declaration still owns them — but the compiler
    // does now satisfy a direct requirement without consulting them.
    if (
      this.#boolUnion !== undefined &&
      type.kind === "Union" &&
      type.union === this.#boolUnion &&
      ["Eq", "Ord", "Show", "Hash"].includes(requirement.name)
    ) {
      requirement.structural = true;
      return;
    }
    const instance = this.#instances.get(this.#instanceKey(requirement.name, type));
    if (instance !== undefined) {
      this.#pinInstanceSubject(instance, type, requirement.span);
      requirement.dictionary = instance.dictionary;
      requirement.dictionaryArguments = this.#instanceArguments(instance, type);
      if (requirement.impliedTypes !== undefined) {
        const parameters = this.#instanceTypeParameters.get(instance) ?? new Map();
        const replacements = this.#matchInstanceSubject(instance, type);
        for (const [name, projection] of requirement.impliedTypes) {
          const binding = instance.impliedTypes.find(
            (impliedType) => impliedType.name === name,
          );
          if (binding !== undefined) {
            this.#unify(
              projection,
              this.#replaceVariables(
                this.#annotationType(binding.annotation, 0, new Map(), parameters),
                replacements,
              ),
              requirement.span,
            );
          }
        }
      }
      return;
    }

    requirement.reported = true;
    this.#diagnostics.add({
      severity: "error",
      message:
        // `type.kind === "Union"` since #147: `Bool` is the common case of a
        // literal landing on a type with no `Num`, and it stopped being a
        // `Constructor` when it left the primitive set.
        requirement.origin === "literal" &&
          (type.kind === "Constructor" || type.kind === "Union")
          ? `integer literal cannot have type \`${type.name}\``
          : type.kind === "Function"
          ? `functions have no \`${requirement.name}\` instance`
          : `type \`${this.#display(type)}\` has no \`${requirement.name}\` instance`,
      primary: requirement.span,
    });
  }

  /**
   * Unifies the selected instance's declared subject with the type it is
   * discharging, so whatever the subject says about its arguments is *true* of
   * that type.
   *
   * Selection is by head constructor — `#instanceKey` keys on the constructor
   * alone, which is what coherence buys — so the instance found is the only one
   * that could ever discharge this requirement. Its subject is therefore a fact
   * about the requirement's type, not a pattern that happened to match: a ground
   * head (`honor Def<Box(Int)>`) says the argument *is* `Int`.
   *
   * Nothing pinned it before, and while the value restriction refused every
   * expansive binding that cost only precision. Item 7 made it a soundness hole:
   * `Def(Box(?1))` discharged against `honor Def<Box(Int)>` left `?1` carrying no
   * requirement at all, so clause (a) saw an unconstrained variable, clause (b)
   * saw a covariant one, and the binding was quantified — handing one `Box(Int)`
   * out at `Box(String)` with a `7` inside it.
   *
   * The instance's own parameters are freshened first: the declared subject is
   * built once and shared by every use, so unifying it directly would bind one
   * use's arguments into every later one.
   */
  #pinInstanceSubject(
    instance: Resolved.HonorItem,
    subject: Mono,
    span: Source.Span,
  ): void {
    const declared = this.#instanceSubjects.get(instance);
    if (declared === undefined) return;
    const parameters = this.#instanceTypeParameters.get(instance);
    const replacements = new Map<number, Mono>(
      [...(parameters?.values() ?? [])].map((variable) =>
        [variable.id, this.#fresh(INSTANCE_LEVEL, false)] as const
      ),
    );
    this.#unify(this.#replaceVariables(declared, replacements), subject, span);
  }

  /** Instantiates the context on a parameterized instance at a concrete use. */
  #instanceArguments(
    instance: Resolved.HonorItem,
    subject: Mono,
  ): readonly Requirement[] {
    const replacements = this.#matchInstanceSubject(instance, subject);
    return instance.typeParameters.flatMap((parameter) => {
      const formal = this.#instanceTypeParameters.get(instance)?.get(parameter.name);
      const actual = formal === undefined ? undefined : replacements.get(formal.id);
      if (actual === undefined) return [];
      return parameter.constraints.map((constraint) =>
        this.#require(constraint, actual, parameter.span)
      );
    });
  }

  #matchInstanceSubject(
    instance: Resolved.HonorItem,
    subject: Mono,
  ): ReadonlyMap<number, Mono> {
    const parameters = new Set(
      [...(this.#instanceTypeParameters.get(instance)?.values() ?? [])].map(({ id }) => id),
    );
    const replacements = new Map<number, Mono>();
    const match = (formalType: Mono, actualType: Mono): void => {
      const formal = this.#prune(formalType);
      const actual = this.#prune(actualType);
      if (formal.kind === "Variable" && parameters.has(formal.id)) {
        replacements.set(formal.id, actual);
        return;
      }
      if (formal.kind === "Union" && actual.kind === "Union") {
        formal.arguments.forEach((argument, index) =>
          match(argument, actual.arguments[index] ?? ERROR)
        );
      }
      if (formal.kind === "NominalRecord" && actual.kind === "NominalRecord") {
        formal.arguments.forEach((argument, index) =>
          match(argument, actual.arguments[index] ?? ERROR)
        );
      }
    };
    match(this.#instanceSubjects.get(instance) ?? ERROR, subject);
    return replacements;
  }

  #replaceVariables(type: Mono, replacements: ReadonlyMap<number, Mono>): Mono {
    const actual = this.#prune(type);
    if (actual.kind === "Variable") return replacements.get(actual.id) ?? actual;
    if (actual.kind === "Tuple") {
      return { kind: "Tuple", elements: actual.elements.map((element) =>
        this.#replaceVariables(element, replacements)
      ) };
    }
    if (actual.kind === "Record") {
      return {
        kind: "Record",
        fields: new Map([...actual.fields].map(([name, field]) => [
          name,
          this.#replaceVariables(field, replacements),
        ])),
        ...(actual.tail === undefined ? {} : { tail: actual.tail }),
      };
    }
    if (actual.kind === "Union" || actual.kind === "NominalRecord") {
      return {
        ...actual,
        arguments: actual.arguments.map((argument) =>
          this.#replaceVariables(argument, replacements)
        ),
      };
    }
    if (actual.kind === "Vector") {
      return { kind: "Vector", element: this.#replaceVariables(actual.element, replacements) };
    }
    if (actual.kind === "Set") {
      return { kind: "Set", element: this.#replaceVariables(actual.element, replacements) };
    }
    if (actual.kind === "Array") return { kind: "Array", element: this.#replaceVariables(actual.element, replacements) };
    if (actual.kind === "Node") return { kind: "Node", element: this.#replaceVariables(actual.element, replacements) };
    if (actual.kind === "Nullable") return { kind: "Nullable", value: this.#replaceVariables(actual.value, replacements) };
    if (actual.kind === "Map") {
      return {
        kind: "Map",
        key: this.#replaceVariables(actual.key, replacements),
        value: this.#replaceVariables(actual.value, replacements),
      };
    }
    if (actual.kind === "Function") {
      return {
        kind: "Function",
        parameters: actual.parameters.map((parameter) =>
          this.#replaceVariables(parameter, replacements)
        ),
        result: this.#replaceVariables(actual.result, replacements),
      };
    }
    return actual;
  }

  #generalize(
    type: Mono,
    level: number,
    allow: boolean,
    annotation?: Source.Span,
    /**
     * The type of the binding's **one evaluated value**, when that is not
     * `type` itself — closure doc §13.6's corrected reading. It differs only
     * under a destructuring `let`, where `type` is a component the pattern
     * projects and this is the aggregate actually constructed. The seat test
     * must read this and never `type`: at `let (g, n) = (describe, 1)` the
     * component `g` is function-typed and would pass a test keyed on itself,
     * generalize still carrying its constraint, and emit a wrapper one arity
     * narrower than the suffix its callers append — the dropped-dictionary
     * shape Constraints §6.1 records so it is not rebuilt.
     */
    evaluated?: Mono,
  ): Scheme {
    let variables = this.#collectVariables(type).filter(
      (variable) => variable.level > level,
    );
    const inputVariables = this.#inputVariables(type);
    for (const variable of variables) {
      if (
        !inputVariables.has(variable.id) &&
        // At an *expansive* binding only, a declared type variable is left for
        // item 7 to decline: defaulting one bound it to `Int` and then reported
        // the binding as requiring `Int` — an accurate sentence about a state
        // defaulting had just created, and the wrong account of what happened
        // (closure doc §4.1). At a value binding item 7 never fires and the
        // ruling says nothing, so defaulting keeps its pre-#205 behaviour: the
        // skip is gated on `allow`, or `let x: a = 42` loses the diagnostic that
        // names its rewrite and emits `undefined.fromNat(42)` instead.
        (allow || variable.rigidName === undefined) &&
        variable.requirements.length > 0 &&
        this.#canDefaultToInt(variable)
      ) {
        this.#bind(variable, primitive("Int"), variable.requirements[0]!.span);
      }
    }
    variables = this.#collectVariables(type).filter(
      (variable) => variable.level > level,
    );
    if (allow && this.#prune(evaluated ?? type).kind !== "Function") {
      // Closure doc §13.6, the evidence-seat rule. Evidence has exactly one
      // seat — a function's trailing parameter suffix (Constraints §6.1) — so a
      // constrained variable can be quantified only at a binding whose own type
      // is a function. `let g = describe` has that seat and generalizes; `let
      // holder = { f = describe }` does not, and a constrained scheme built
      // there is one the language cannot represent: the checker handed it out,
      // the emitter had nowhere to put the dictionary, and a program that
      // compiles on `main` became two errors, one of them phrased as an
      // internal compiler failure.
      //
      // Declining is not a new fallback. It is what every expansive binding
      // already does and what this binding did before #205: the variable stays
      // unsolved at `level`, and its first use pins it. Unconstrained variables
      // are untouched — `let r = { pull = () => None }` still generalizes in
      // full, which is the record row's whole stdlib motivation.
      //
      // Ordering: defaulting ran above, deliberately. This reads only the
      // residue it leaves, so `let x = 42` still means `Int` and a surviving
      // requirement is by construction one defaulting cannot remove (§13.6).
      const quantified: Variable[] = [];
      for (const variable of variables) {
        if (variable.requirements.length === 0) {
          quantified.push(variable);
          continue;
        }
        // A rigid variable can be neither quantified nor pinned by a use, so —
        // exactly as at §4.1 — an annotation whose variable this rule declines
        // has no legal reading, and the binding is a hard error at the
        // declaration. Both exits are legal at every arity and depth (§13.5's
        // bar): a concrete annotation compiles, and removing the annotation
        // lands on decline-and-pin.
        if (variable.rigidName !== undefined && annotation !== undefined) {
          const names = [
            ...new Set(variable.requirements.map(({ name: constraint }) => constraint)),
          ];
          this.#diagnostics.add({
            severity: "error",
            message:
              `\`${variable.rigidName}\` is a declared type variable, but a binding whose ` +
              `type is not a function cannot carry its \`${names.join("`, `")}\` ` +
              `constraint${names.length === 1 ? "" : "s"} — evidence rides only a ` +
              "function's trailing parameters; annotate at a concrete type, or " +
              "remove the annotation",
            primary: annotation,
          });
          variable.instance = ERROR;
          continue;
        }
        // Sunk so no enclosing generalization can quantify what this one
        // declined — the same sink the `!allow` branch below performs, and the
        // handoff's Defect 7 invariant (a declined variable must be no more
        // quantifiable into a sibling's scheme than a placeholder is).
        //
        // Held by (x-k). Two seats recorded this line as undiscriminable before
        // round 5 found the specimen they had both missed: a *sibling* binding
        // whose own type is a function never enters this block at all, so an
        // unsunk variable is quantified into the sibling's scheme
        // unconditionally — `let holder = { f = describe }` then `let k = () =>
        // holder.f` gives `k` an evidence parameter and strips `holder`'s
        // aggregate of its dictionary. "No specimen was found" was a fact about
        // the search and got written down as a fact about the code.
        variable.level = level;
      }
      variables = quantified;
    }
    if (!allow) {
      // Functions §8 item 7, the relaxed value restriction. Level admission has
      // already run (the filter above); what remains is per-variable, and the
      // two clauses are asked of each survivor independently — one binding may
      // end up with a scheme quantifying some variables while others sit
      // unsolved awaiting their first use (closure doc §4.5).
      const positions = this.#variablePositions(type);
      const quantified: Variable[] = [];
      for (const variable of variables) {
        const declined = this.#declineClause(variable, positions);
        if (declined === undefined) {
          quantified.push(variable);
          continue;
        }
        // A rigid variable can be neither quantified nor pinned by a use, so an
        // annotation whose variable item 7 declines has no legal reading at all:
        // hard error at the declaration, in Functions §4.1's family, naming the
        // clause that actually fired (closure doc §4.1). Exports inherit it
        // through their mandatory signatures (Modules §4.1.1).
        if (variable.rigidName !== undefined && annotation !== undefined) {
          this.#diagnostics.add({
            severity: "error",
            message:
              `\`${variable.rigidName}\` is a declared type variable, but this right-hand ` +
              `side is a computation that cannot be generalized in \`${variable.rigidName}\` ` +
              `(${this.#declineReason(variable.rigidName, variable, declined)}); ` +
              "bind where the type is known, or remove the annotation",
            primary: annotation,
          });
          // The binding has no legal reading, so nothing downstream should try
          // to give it one. Left unsolved, the variable goes on to be defaulted
          // (Numeric Literals §4) and the author's one mistake collects a second
          // message *contradicting* the first: this one says remove the
          // annotation, and defaulting's says `change the annotation to `Int``.
          // Pinned by (vii) in `relaxed-generalization.test.ts`, which asserts
          // the whole diagnostic list — `toContain` cannot see an extra message,
          // and for three rounds it did not.
          //
          // (The symptom before `fc37345` was a `missing evidence during
          // JavaScript emission` note instead; that path no longer reproduces.)
          variable.instance = ERROR;
          continue;
        }
        variable.level = level;
      }
      variables = quantified;
    }
    for (const variable of variables) this.#quantified.add(variable.id);
    return { variables, type };
  }

  /**
   * Which of item 7's clauses refuses this variable, or `undefined` when it
   * passes both. Level admission ran before this (`#generalize`'s filter), so
   * clause (c) never answers here.
   *
   * A clause, not a sentence: all but a vanishing fraction of declined
   * variables are declined silently — only an *annotated* binding reports —
   * and building a diagnostic string for each of the rest would spend the
   * display machinery on text nothing reads.
   */
  #declineClause(
    variable: Variable,
    positions: ReadonlyMap<number, Variance>,
  ): "constrained" | "contra" | "inv" | undefined {
    // (a) Unconstrained. Hexagon's own addition to Garrigue's rule, and
    // load-bearing: a constrained variable occurs covariantly at the root of
    // `Num ?1 => ?1`, so the variance test alone would generalize
    // `let y = double(42)` straight into §3's coherence dilemma — no least `Num`
    // type for the ⊥ argument, and no evaluation point for the evidence
    // (closure doc §4.3). Decided; do not re-litigate.
    if (variable.requirements.length > 0) return "constrained";
    // (b) Covariant-only. A variable whose every occurrence is erased by an
    // unused parameter is covariant-only vacuously — nothing in the value can
    // hold one.
    const position = positions.get(variable.id) ?? "inv";
    if (position === "co" || position === "unused") return undefined;
    return position === "contra" ? "contra" : "inv";
  }

  /**
   * The parenthesized clause §4.1's report quotes, built only when it reports.
   *
   * `rigidName` is a parameter rather than read off the variable because the one
   * caller has already established it is defined — §4.1's report exists only for
   * an annotated binding. Reading it here needed a fallback for a case that
   * cannot arise, and a fallback for a case that cannot arise is a claim about
   * the code that no longer has to be checked against it.
   */
  #declineReason(
    rigidName: string,
    variable: Variable,
    clause: "constrained" | "contra" | "inv",
  ): string {
    const name = `\`${rigidName}\``;
    if (clause === "constrained") {
      const names = [...new Set(variable.requirements.map(({ name: constraint }) => constraint))];
      return `${name} is constrained by \`${names.join("`, `")}\``;
    }
    return clause === "contra"
      ? `${name} occurs in argument position`
      : `${name} occurs in an invariant position`;
  }

  /**
   * Every variable in `type`, joined over the signs of its occurrences (closure
   * doc §5.1). The root is covariant; `->` flips its argument positions; a
   * constructor's slot multiplies by that constructor's *effective* variance —
   * the declared claim for an opaque type, the inferred one for a transparent
   * type, and the compiler-side table's row for a type with no declaration site.
   */
  #variablePositions(type: Mono): ReadonlyMap<number, Variance> {
    const positions = new Map<number, Variance>();
    const walk = (current: Mono, sign: Variance): void => {
      const actual = this.#prune(current);
      switch (actual.kind) {
        case "Variable":
          positions.set(actual.id, joinVariance(positions.get(actual.id) ?? "unused", sign));
          return;
        case "Function":
          for (const parameter of actual.parameters) walk(parameter, flipVariance(sign));
          walk(actual.result, sign);
          return;
        case "Tuple":
          for (const element of actual.elements) walk(element, sign);
          return;
        case "Record":
          for (const field of actual.fields.values()) walk(field, sign);
          if (actual.tail !== undefined) walk(actual.tail, sign);
          return;
        case "Union":
          actual.arguments.forEach((argument, index) =>
            walk(argument, multiplyVariance(sign, this.#variance.effectiveUnion(actual.union, index)))
          );
          return;
        case "NominalRecord":
          actual.arguments.forEach((argument, index) =>
            walk(argument, multiplyVariance(sign, this.#variance.effectiveRecord(actual.record, index)))
          );
          return;
        case "Vector":
        case "Set":
        case "Array":
        case "Node":
          walk(actual.element, multiplyVariance(sign, compilerClaim(actual.kind, 0)));
          return;
        case "Nullable":
          walk(actual.value, multiplyVariance(sign, compilerClaim("Nullable", 0)));
          return;
        case "Map":
          walk(actual.key, multiplyVariance(sign, compilerClaim("Map", 0)));
          walk(actual.value, multiplyVariance(sign, compilerClaim("Map", 1)));
          return;
        default:
          return;
      }
    };
    walk(type, "co");
    return positions;
  }

  #defaultRemainingVariables(): void {
    const seen = new Set<number>();
    for (const variable of this.#variables) {
      const actual = this.#prune(variable);
      if (
        actual.kind !== "Variable" ||
        seen.has(actual.id) ||
        this.#quantified.has(actual.id)
      ) {
        continue;
      }
      seen.add(actual.id);
      if (actual.requirements.length === 0) continue;
      if (this.#canDefaultToInt(actual)) {
        this.#bind(actual, primitive("Int"), actual.requirements[0]!.span);
        continue;
      }
      // Nothing generalised this variable and §4 will not default it, so this
      // is §4's "ambiguity error if the binding form doesn't allow it" — the
      // last point at which the blocking constraint can still be named.
      this.#reportBlockedDefaulting(actual);
    }
  }

  /**
   * Numeric Literals §6's blocked-defaulting report: name the constraint that
   * prevents defaulting and the literal it came from, and name the rewrite —
   * an annotation pins the type, which is the only thing that can (§4).
   */
  #reportBlockedDefaulting(variable: Variable): void {
    // A declared variable is pinned by its annotation already; it never
    // defaulted, so nothing about it is blocked.
    if (variable.rigidName !== undefined) return;
    const blocking = this.#blockingConstraint(variable);
    if (blocking === undefined || blocking.reported) return;
    // Report at the literal, per §6, where one is in the set. Literals that
    // unify (`pair(4, 6)`) collapse onto one `Num` requirement, so exactly one
    // of them is nameable — and the span points at that one, which is what
    // keeps the message and the caret agreeing. Otherwise report where the
    // blocked scheme was used: `blocking.span` is the *declaration* the
    // constraint was written at, which is not what this error is about.
    const literal = variable.requirements.find(({ origin }) => origin === "literal");
    for (const requirement of variable.requirements) requirement.reported = true;
    this.#diagnostics.add({
      severity: "error",
      message: `${
        literal?.literal === undefined
          ? "this expression's type"
          : `the literal \`${literal.literal}\``
      } cannot default to \`Int\`: \`${blocking.name}\` is not a defaultable ` +
        "constraint; add a type annotation to pin the type",
      primary: literal?.span ?? blocking.useSpan ?? blocking.span,
    });
  }

  #inputVariables(type: Mono, found = new Set<number>()): Set<number> {
    const actual = this.#prune(type);
    if (actual.kind !== "Function") return found;
    for (const parameter of actual.parameters) {
      for (const variable of this.#collectVariables(parameter)) {
        found.add(variable.id);
      }
    }
    this.#inputVariables(actual.result, found);
    return found;
  }

  #defaultDiscardedLiteral(type: Mono, span: Source.Span): void {
    const actual = this.#prune(type);
    if (actual.kind === "Variable") {
      if (this.#settlesAtUnitDemand(actual)) {
        this.#bind(actual, primitive("Int"), span);
      }
      return;
    }
    // A structured branch (`(1, 2)`, `[1, 2]`) can never be the demanded
    // `Unit`, so the report is already certain; its literals would otherwise
    // reach the message as raw variables — `(?0, ?1)` — inside a mandatory
    // fixit. Settle them to the `Int` they default to anyway (§4).
    for (const variable of this.#collectVariables(actual)) {
      if (variable.rigidName === undefined && this.#canDefaultToInt(variable)) {
        this.#bind(variable, primitive("Int"), span);
      }
    }
    this.#nameSurvivingVariables(actual);
  }

  /**
   * §4 does not settle a variable a non-defaultable constraint blocks, so one
   * can still reach the mandatory fixit — `(?2, Int)`. §6 requires survivors
   * there to be named rather than numbered, which is the same sentence that
   * excepts declared variables: both say the message speaks the user's names.
   */
  #nameSurvivingVariables(type: Mono): void {
    const variables = this.#collectVariables(type);
    const taken = new Set(
      variables.flatMap(({ rigidName }) => rigidName === undefined ? [] : [rigidName]),
    );
    let index = 0;
    for (const variable of variables) {
      if (variable.rigidName !== undefined || variable.displayName !== undefined) continue;
      let name = inferredTypeVariableName(index++);
      while (taken.has(name)) name = inferredTypeVariableName(index++);
      taken.add(name);
      variable.displayName = name;
    }
  }

  /**
   * Demand-site settling (Numeric Literals §6) asks whether the variable can
   * be `Int` and cannot be the demanded `Unit`. Both halves are semantic, so a
   * user `honor` counts on the `Int` side. The `Unit` side stopped having user
   * instances to consult when #159 made it structural — `honor` cannot target
   * a structural type (Constraints §9.3) — so its answer is the structural
   * tuple one, vacuous at zero components.
   *
   * Deliberately not expressed through `#canDefaultToInt`, which answers §4's
   * different, *policy* question — is the constraint in the closed defaultable
   * list — for generalisation. One predicate cannot serve both: §6 wants user
   * instances consulted, §4 wants them ignored.
   */
  #settlesAtUnitDemand(variable: Variable): boolean {
    // A declared variable is pinned by its annotation, not settleable: binding
    // it to `Int` would report the annotation as requiring the `Int` settling
    // just invented, naming a rewrite that repairs nothing.
    return variable.rigidName === undefined &&
      variable.requirements.length > 0 &&
      variable.requirements.every(({ name }) => this.#satisfiedAt(name, "Int")) &&
      variable.requirements.some(({ name }) => !this.#satisfiedAt(name, "Unit"));
  }

  #satisfiedAt(name: Typed.ConstraintName, subject: "Int" | "Unit"): boolean {
    if (subject === "Unit") return structuralConstraints.includes(name);
    return supports(subject, name) ||
      this.#instances.has(this.#instanceKey(name, primitive(subject)));
  }

  /**
   * Numeric Literals §4's defaulting rule: the defaultable set is closed and
   * hard-coded, "not user-extensible" — §7 rejects Haskell-style extensible
   * defaulting outright. So the test reads the compiler's own `Int` instance
   * table and never `#instances`, which a user `honor Conjure<Int>` extends:
   * consulting that table would make defaulting user-extensible, which is
   * exactly what §4 forbids. Contrast `#satisfiedAt`, which answers §6's
   * different, *semantic* question and does consult user instances.
   */
  #canDefaultToInt(variable: Variable): boolean {
    return variable.requirements.length > 0 &&
      this.#blockingConstraint(variable) === undefined;
  }

  /** The first constraint outside §4's closed set, which blocks defaulting. */
  #blockingConstraint(variable: Variable): Requirement | undefined {
    return variable.requirements.find(({ name }) => !supports("Int", name));
  }

  #collectVariables(type: Mono, found = new Map<number, Variable>()): Variable[] {
    const actual = this.#prune(type);
    if (actual.kind === "Variable") found.set(actual.id, actual);
    if (actual.kind === "Tuple") {
      for (const element of actual.elements) this.#collectVariables(element, found);
    }
    if (actual.kind === "Record") {
      for (const field of actual.fields.values()) this.#collectVariables(field, found);
      if (actual.tail !== undefined) this.#collectVariables(actual.tail, found);
    }
    if (actual.kind === "Function") {
      for (const parameter of actual.parameters) this.#collectVariables(parameter, found);
      this.#collectVariables(actual.result, found);
    }
    if (actual.kind === "Union") {
      for (const argument of actual.arguments) this.#collectVariables(argument, found);
    }
    if (actual.kind === "NominalRecord") {
      for (const argument of actual.arguments) this.#collectVariables(argument, found);
    }
    if (actual.kind === "Vector") this.#collectVariables(actual.element, found);
    if (actual.kind === "Set") this.#collectVariables(actual.element, found);
    if (actual.kind === "Array") this.#collectVariables(actual.element, found);
    if (actual.kind === "Node") this.#collectVariables(actual.element, found);
    if (actual.kind === "Nullable") this.#collectVariables(actual.value, found);
    if (actual.kind === "Map") {
      this.#collectVariables(actual.key, found);
      this.#collectVariables(actual.value, found);
    }
    return [...found.values()];
  }

  #instantiate(
    scheme: Scheme,
    level: number,
    collected?: Requirement[],
    useSpan?: Source.Span,
  ): Mono {
    const replacements = new Map<number, Variable>();
    const copiedRequirements = new Set<number>();
    for (const variable of scheme.variables) {
      replacements.set(variable.id, this.#fresh(level, variable.literalOnly));
    }
    const impliedTypes = scheme.impliedTypes === undefined
      ? undefined
      : new Map(
          [...scheme.impliedTypes].map(([name, variable]) => [
            name,
            replacements.get(variable.id) ?? variable,
          ]),
        );
    const copy = (type: Mono): Mono => {
      const actual = this.#prune(type);
      if (actual.kind === "Variable") {
        const replacement = replacements.get(actual.id);
        if (replacement === undefined) return actual;
        if (copiedRequirements.has(actual.id)) return replacement;
        copiedRequirements.add(actual.id);
        for (const requirement of actual.requirements) {
          const copied = this.#require(
            requirement.name,
            replacement,
            requirement.span,
            requirement.origin,
            requirement.name === scheme.constraint ? impliedTypes : undefined,
          );
          // The copy keeps the definition-site span, so it keeps the digits
          // that span points at too (§6's report names both) — and records
          // where the use was, for a report that is about the use.
          if (requirement.literal !== undefined) copied.literal = requirement.literal;
          if (useSpan !== undefined) copied.useSpan = useSpan;
          collected?.push(copied);
        }
        return replacement;
      }
      if (actual.kind === "Function") {
        return {
          kind: "Function",
          parameters: actual.parameters.map(copy),
          result: copy(actual.result),
        };
      }
      if (actual.kind === "Tuple") {
        return { kind: "Tuple", elements: actual.elements.map(copy) };
      }
      if (actual.kind === "Union") {
        return { ...actual, arguments: actual.arguments.map(copy) };
      }
      if (actual.kind === "NominalRecord") {
        return { ...actual, arguments: actual.arguments.map(copy) };
      }
      if (actual.kind === "Vector") return { kind: "Vector", element: copy(actual.element) };
      if (actual.kind === "Set") return { kind: "Set", element: copy(actual.element) };
      if (actual.kind === "Array") return { kind: "Array", element: copy(actual.element) };
      if (actual.kind === "Node") return { kind: "Node", element: copy(actual.element) };
      if (actual.kind === "Nullable") return { kind: "Nullable", value: copy(actual.value) };
      if (actual.kind === "Map") return { kind: "Map", key: copy(actual.key), value: copy(actual.value) };
      if (actual.kind === "Record") {
        const record = this.#normalizeRecord(actual);
        return {
          kind: "Record",
          fields: new Map([...record.fields].map(([name, field]) => [name, copy(field)])),
          ...(record.tail === undefined ? {} : { tail: copy(record.tail) as Variable }),
        };
      }
      return actual;
    };
    return copy(scheme.type);
  }

  #unsupported(span: Source.Span, message: string): ErrorMono {
    this.#diagnostics.add({ severity: "error", message, primary: span });
    return ERROR;
  }

  #annotationType(
    annotation: Resolved.TypeAnnotation,
    level = 0,
    namedTails = new Map<string, Variable>(),
    typeParameters: ReadonlyMap<string, Mono> = new Map(),
    impliedTypes: ReadonlyMap<string, Mono> = new Map(),
  ): Mono {
    if (annotation.kind === "Primitive") {
      // The `Unit` spelling is surface syntax for the empty tuple (#159): the
      // resolver keeps it in its compiler-known-name list, and the semantic
      // type it denotes is minted here, in one place.
      return annotation.name === "Unit" ? UNIT : primitive(annotation.name);
    }
    if (annotation.kind === "Range") return { kind: "Range" };
    if (annotation.kind === "Vector") {
      return {
        kind: "Vector",
        element: this.#annotationType(annotation.element, level, namedTails, typeParameters, impliedTypes),
      };
    }
    if (annotation.kind === "Set") {
      return { kind: "Set", element: this.#annotationType(annotation.element, level, namedTails, typeParameters, impliedTypes) };
    }
    if (annotation.kind === "Array") return { kind: "Array", element: this.#annotationType(annotation.element, level, namedTails, typeParameters, impliedTypes) };
    if (annotation.kind === "Node") return { kind: "Node", element: this.#annotationType(annotation.element, level, namedTails, typeParameters, impliedTypes) };
    if (annotation.kind === "Nullable") return { kind: "Nullable", value: this.#annotationType(annotation.value, level, namedTails, typeParameters, impliedTypes) };
    if (annotation.kind === "Map") {
      return {
        kind: "Map",
        key: this.#annotationType(annotation.key, level, namedTails, typeParameters, impliedTypes),
        value: this.#annotationType(annotation.value, level, namedTails, typeParameters, impliedTypes),
      };
    }
    if (annotation.kind === "Function") {
      return {
        kind: "Function",
        parameters: annotation.parameters.map((parameter) =>
          this.#annotationType(parameter, level, namedTails, typeParameters, impliedTypes)
        ),
        result: this.#annotationType(
          annotation.result,
          level,
          namedTails,
          typeParameters,
          impliedTypes,
        ),
      };
    }
    if (annotation.kind === "Union") {
      return {
        kind: "Union",
        union: annotation.union,
        name: annotation.name,
        arguments: annotation.arguments.map((argument) =>
          this.#annotationType(argument, level, namedTails, typeParameters, impliedTypes)
        ),
      };
    }
    if (annotation.kind === "RecordDeclaration") {
      return {
        kind: "NominalRecord",
        record: annotation.record,
        name: annotation.name,
        arguments: annotation.arguments.map((argument) =>
          this.#annotationType(argument, level, namedTails, typeParameters, impliedTypes)
        ),
      };
    }
    if (annotation.kind === "ExternType") {
      return {
        kind: "ExternType",
        externType: annotation.externType,
        name: annotation.name,
      };
    }
    if (annotation.kind === "TypeVariable") {
      const existing = typeParameters.get(annotation.name);
      if (existing !== undefined) return existing;
      if (typeParameters instanceof Map) {
        const variable = this.#fresh(level, false, annotation.name);
        typeParameters.set(annotation.name, variable);
        return variable;
      }
      return ERROR;
    }
    if (annotation.kind === "ImpliedType") {
      return impliedTypes.get(annotation.name) ?? ERROR;
    }
    if (annotation.kind === "Tuple") {
      return {
        kind: "Tuple",
        elements: annotation.elements.map((element) =>
          this.#annotationType(element, level, namedTails, typeParameters, impliedTypes)
        ),
      };
    }
    if (annotation.kind === "Record") {
      return {
        kind: "Record",
        fields: new Map(annotation.fields.map((field) => [
          field.name,
          this.#annotationType(field.annotation, level, namedTails, typeParameters, impliedTypes),
        ])),
        ...(annotation.open
          ? { tail: this.#annotationTail(annotation.tail, level, namedTails) }
          : {}),
      };
    }
    return ERROR;
  }

  #annotationTail(
    name: string | undefined,
    level: number,
    namedTails: Map<string, Variable>,
  ): Variable {
    if (name === undefined) return this.#fresh(level, false);
    const existing = namedTails.get(name);
    if (existing !== undefined) return existing;
    const tail = this.#fresh(level, false);
    namedTails.set(name, tail);
    return tail;
  }

  #scheme(symbol: Resolved.SymbolId): Scheme {
    return this.#schemes.get(symbol) ?? { variables: [], type: ERROR };
  }

  #constructorShape(
    symbol: Resolved.SymbolId,
    level: number,
  ): { readonly parameters: readonly Mono[]; readonly result: Mono } {
    const type = this.#instantiate(this.#scheme(symbol), level);
    return type.kind === "Function"
      ? { parameters: type.parameters, result: type.result }
      : { parameters: [], result: type };
  }

  /**
   * Admits one instance this module did not declare into the evidence universe.
   *
   * Shared by both channels that supply such evidence: the prelude's §5.5
   * visibility (`Module.preludeInstances`) and the `instances` an `Import` item
   * carries. They differ in where they come from and in nothing else, so the
   * dedup rule is one rule — `identity` is stable across every hop, and a second
   * arrival of the same declaration is silence, not a collision.
   */
  #seedImportedInstance(imported: Resolved.InstanceImport): void {
    const instance: Resolved.HonorItem = {
      kind: "Honor",
      constraint: imported.constraint,
      typeParameters: imported.typeParameters,
      subject: imported.subject,
      derived: false,
      dictionary: imported.localDictionary,
      impliedTypes: imported.impliedTypes,
      members: [],
      span: imported.span,
    };
    const typeParameters = new Map(
      instance.typeParameters.map(({ name }) => [
        name,
        this.#fresh(0, false),
      ] as const),
    );
    this.#instanceTypeParameters.set(instance, typeParameters);
    const subject = this.#annotationType(
      instance.subject,
      0,
      new Map(),
      typeParameters,
    );
    this.#instanceSubjects.set(instance, subject);
    const key = this.#instanceKey(instance.constraint, subject);
    const existingIdentity = this.#instanceIdentities.get(key);
    if (existingIdentity === imported.identity) return;
    if (existingIdentity !== undefined || this.#instances.has(key)) {
      this.#diagnostics.add({
        severity: "error",
        message: `duplicate instance of \`${instance.constraint}<${this.#display(subject)}>\``,
        primary: imported.span,
      });
      return;
    }
    this.#instances.set(key, instance);
    this.#instanceIdentities.set(key, imported.identity);
  }

  #instanceKey(constraint: string, subject: Mono): string {
    const type = this.#prune(subject);
    if (type.kind === "Constructor") return `${constraint}:primitive:${type.name}`;
    if (type.kind === "NominalRecord") return `${constraint}:record:${Number(type.record)}`;
    if (type.kind === "Union") return `${constraint}:union:${Number(type.union)}`;
    if (type.kind === "Range") return `${constraint}:range`;
    return `${constraint}:${this.#display(type)}`;
  }

  #importScheme(scheme: Typed.Scheme): Scheme {
    const variables = new Map<Typed.TypeVariableId, Variable>();
    for (const id of scheme.variables) {
      const variable = this.#fresh(0, false);
      variables.set(id, variable);
      // Imported binders are already generalized by their defining module;
      // they must never be defaulted as unresolved locals in this module.
      this.#quantified.add(variable.id);
    }
    const copy = (type: Typed.Type): Mono => {
      switch (type.kind) {
        case "Primitive": return primitive(type.name);
        case "Range": return { kind: "Range" };
        case "Vector": return { kind: "Vector", element: copy(type.element) };
        case "Set": return { kind: "Set", element: copy(type.element) };
        case "Array": return { kind: "Array", element: copy(type.element) };
        case "Node": return { kind: "Node", element: copy(type.element) };
        case "Nullable": return { kind: "Nullable", value: copy(type.value) };
        case "Map": return { kind: "Map", key: copy(type.key), value: copy(type.value) };
        case "Variable": {
          const existing = variables.get(type.id);
          if (existing !== undefined) return existing;
          const variable = this.#fresh(0, false);
          variables.set(type.id, variable);
          return variable;
        }
        case "Tuple": return { kind: "Tuple", elements: type.elements.map(copy) };
        case "Record": return {
          kind: "Record",
          fields: new Map(type.fields.map((field) => [field.name, copy(field.type)])),
          ...(type.tail === undefined ? {} : { tail: copy({ kind: "Variable", id: type.tail }) as Variable }),
        };
        case "Union": return { ...type, arguments: type.arguments.map(copy) };
        case "NominalRecord": return { ...type, arguments: type.arguments.map(copy) };
        case "ExternType": return {
          ...type,
          name: this.#externTypes.get(type.externType)?.localName ?? type.name,
        };
        case "Function": return {
          kind: "Function",
          parameters: type.parameters.map(copy),
          result: copy(type.result),
        };
        case "Error": return ERROR;
      }
    };
    for (const constraint of scheme.constraints) {
      this.#require(constraint.name, copy(constraint.type), constraint.span);
    }
    return { variables: [...variables.values()], type: copy(scheme.type) };
  }

  #nominalRecordFields(record: NominalRecordMono): ReadonlyMap<string, Mono> {
    const parameters = [...(this.#recordParameters.get(record.record)?.values() ?? [])];
    const replacements = new Map(
      parameters.map((parameter, index) => [parameter.id, record.arguments[index] ?? ERROR]),
    );
    const copy = (type: Mono): Mono => {
      const actual = this.#prune(type);
      if (actual.kind === "Variable") return replacements.get(actual.id) ?? actual;
      if (actual.kind === "Tuple") return { kind: "Tuple", elements: actual.elements.map(copy) };
      if (actual.kind === "Record") {
        return {
          kind: "Record",
          fields: new Map([...actual.fields].map(([name, field]) => [name, copy(field)])),
          ...(actual.tail === undefined ? {} : { tail: copy(actual.tail) as Variable }),
        };
      }
      if (actual.kind === "Union") return { ...actual, arguments: actual.arguments.map(copy) };
      if (actual.kind === "NominalRecord") return { ...actual, arguments: actual.arguments.map(copy) };
      if (actual.kind === "Vector") return { kind: "Vector", element: copy(actual.element) };
      if (actual.kind === "Set") return { kind: "Set", element: copy(actual.element) };
      if (actual.kind === "Array") return { kind: "Array", element: copy(actual.element) };
      if (actual.kind === "Node") return { kind: "Node", element: copy(actual.element) };
      if (actual.kind === "Nullable") return { kind: "Nullable", value: copy(actual.value) };
      if (actual.kind === "Map") return { kind: "Map", key: copy(actual.key), value: copy(actual.value) };
      if (actual.kind === "Function") {
        return {
          kind: "Function",
          parameters: actual.parameters.map(copy),
          result: copy(actual.result),
        };
      }
      return actual;
    };
    return new Map(
      [...(this.#recordFields.get(record.record) ?? [])].map(([name, field]) => [name, copy(field)]),
    );
  }

  #recordRepresentationVisible(record: Resolved.RecordId): boolean {
    return this.#records.get(record)?.representationVisible ?? true;
  }

  /** Whether the hidden `Node` intrinsic appears directly in a (signature) type. */
  #mentionsNode(type: Mono): boolean {
    const actual = this.#prune(type);
    switch (actual.kind) {
      case "Node": return true;
      case "Function":
        return actual.parameters.some((parameter) => this.#mentionsNode(parameter)) ||
          this.#mentionsNode(actual.result);
      case "Tuple": return actual.elements.some((element) => this.#mentionsNode(element));
      case "Record":
        return [...actual.fields.values()].some((field) => this.#mentionsNode(field)) ||
          (actual.tail !== undefined && this.#mentionsNode(actual.tail));
      case "Vector":
      case "Set":
      case "Array":
        return this.#mentionsNode(actual.element);
      case "Nullable": return this.#mentionsNode(actual.value);
      case "Map": return this.#mentionsNode(actual.key) || this.#mentionsNode(actual.value);
      case "Union":
      case "NominalRecord":
        return actual.arguments.some((argument) => this.#mentionsNode(argument));
      default: return false;
    }
  }

  #checkPublicSignatures(items: readonly Resolved.Item[]): void {
    const publicUnions = new Set(items.flatMap((item) => item.kind === "Union" && item.exported ? [item.union] : []));
    const publicRecords = new Set(items.flatMap((item) => item.kind === "RecordDeclaration" && item.exported ? [item.record] : []));
    const publicExternTypes = new Set(
      [...this.#externTypes.values()].flatMap((declaration) =>
        declaration.exported ? [declaration.externType] : []
      ),
    );
    const visit = (type: Mono, found = new Set<string>()): ReadonlySet<string> => {
      const actual = this.#prune(type);
      if (actual.kind === "Union") {
        if (!publicUnions.has(actual.union) && this.#unions.get(actual.union)?.representationVisible) found.add(actual.name);
        actual.arguments.forEach((argument) => visit(argument, found));
      } else if (actual.kind === "NominalRecord") {
        if (!publicRecords.has(actual.record) && this.#records.get(actual.record)?.representationVisible) found.add(actual.name);
        actual.arguments.forEach((argument) => visit(argument, found));
      } else if (actual.kind === "ExternType") {
        if (!publicExternTypes.has(actual.externType)) found.add(actual.name);
      } else if (actual.kind === "Function") {
        actual.parameters.forEach((parameter) => visit(parameter, found));
        visit(actual.result, found);
      } else if (actual.kind === "Tuple") actual.elements.forEach((element) => visit(element, found));
      else if (actual.kind === "Record") actual.fields.forEach((field) => visit(field, found));
      else if (actual.kind === "Vector" || actual.kind === "Set" || actual.kind === "Array" || actual.kind === "Node") visit(actual.element, found);
      else if (actual.kind === "Nullable") visit(actual.value, found);
      else if (actual.kind === "Map") { visit(actual.key, found); visit(actual.value, found); }
      return found;
    };
    for (const item of items) {
      if ((item.kind === "Let" || item.kind === "Fun") && item.exported) {
        this.#checkCompleteExportSignature(item);
      }
      const bindings = item.kind === "ExternBlock"
        ? item.declarations.flatMap((declaration) =>
            declaration.kind !== "ExternType" && declaration.exported
              ? [declaration.binding]
              : []
          )
        : (item.kind === "Let" || item.kind === "Fun") && item.exported
          ? [item.binding]
          : [];
      for (const binding of bindings) {
        const signature = this.#scheme(binding.symbol).type;
        for (const name of visit(signature)) {
        this.#diagnostics.add({
          severity: "error",
          message: `exported binding \`${binding.name}\` exposes private type \`${name}\`; export the type, perhaps opaquely, or keep the binding private`,
          primary: binding.span,
        });
        }
        // The hidden `Node` intrinsic has no public form: a runtime module may
        // build with it, but never hand one across a module boundary. This is the
        // load-bearing half of Node's visibility — with `Node(a)` now spellable in
        // a runtime module's annotations, this check keeps it from leaking into a
        // `.d.ts` or a consumer's inference.
        if (this.#mentionsNode(signature)) {
          this.#diagnostics.add({
            severity: "error",
            message: `exported binding \`${binding.name}\` exposes the hidden \`Node\` intrinsic, which has no public form; keep the binding private`,
            primary: binding.span,
          });
        }
      }
      // `Node` also has no public form when it hides in an *exported* algebraic
      // type: the constructor of an exported union/record/exception becomes a
      // JS-callable function (FFI Part 7), so a `Node`-typed slot both renders as
      // a bogus `Array<..>` in the `.d.ts` and lets foreign code forge a node.
      // Keep the type private and export functions over it instead.
      const mentionsNodeSlot = (annotations: readonly Resolved.TypeAnnotation[]): boolean =>
        annotations.some(annotationMentionsNode);
      if (item.kind === "Union" && item.exported &&
        mentionsNodeSlot(item.constructors.flatMap((constructor) => constructor.slots.map((slot) => slot.annotation)))) {
        this.#diagnostics.add({
          severity: "error",
          message: `exported union \`${item.name}\` has a \`Node\`-typed slot; the hidden \`Node\` intrinsic has no public form — keep the union private and export functions over it instead`,
          primary: item.span,
        });
      }
      if (item.kind === "Exception" && item.exported &&
        mentionsNodeSlot(item.slots.map((slot) => slot.annotation))) {
        this.#diagnostics.add({
          severity: "error",
          message: `exported exception \`${item.binding.name}\` has a \`Node\`-typed slot; the hidden \`Node\` intrinsic has no public form — keep the exception private`,
          primary: item.span,
        });
      }
      if (item.kind === "TypeAlias" && item.exported && annotationMentionsNode(item.annotation)) {
        this.#diagnostics.add({
          severity: "error",
          message: `exported type alias \`${item.name}\` names the hidden \`Node\` intrinsic, which has no public form; keep the alias private`,
          primary: item.span,
        });
      }
      if (item.kind === "RecordDeclaration" && item.exported) {
        const record = this.#records.get(item.record);
        if (record !== undefined && mentionsNodeSlot(record.fields.map((field) => field.annotation))) {
          this.#diagnostics.add({
            severity: "error",
            message: `exported record \`${record.name}\` has a \`Node\`-typed field; the hidden \`Node\` intrinsic has no public form — keep the record private and export functions over it instead`,
            primary: item.span,
          });
        }
      }
      // Extern is the foreign boundary; `Node` can never cross it, exported or not.
      if (item.kind === "ExternBlock") {
        for (const declaration of item.declarations) {
          const annotations: readonly Resolved.TypeAnnotation[] = declaration.kind === "ExternFun"
            ? [
                ...declaration.parameters.flatMap((parameter) =>
                  parameter.annotation === undefined ? [] : [parameter.annotation]
                ),
                declaration.returnAnnotation,
              ]
            : declaration.kind === "ExternLet"
              ? [declaration.annotation]
              : [];
          if (mentionsNodeSlot(annotations)) {
            this.#diagnostics.add({
              severity: "error",
              message: `extern declaration \`${declaration.localName}\` names the hidden \`Node\` intrinsic, which cannot cross the foreign boundary`,
              primary: declaration.span,
            });
          }
        }
      }
    }
  }

  #checkCompleteExportSignature(
    item: Resolved.LetItem | Resolved.FunItem,
  ): void {
    let lambda: Resolved.LambdaExpr | undefined;
    if (item.kind === "Fun") lambda = item.value;
    else if (item.value.kind === "Lambda") lambda = item.value;
    if (lambda === undefined) {
      if (item.kind === "Let" && item.annotation === undefined) {
        this.#diagnostics.add({
          severity: "error",
          message: `exported value \`${item.binding.name}\` requires a type annotation`,
          primary: item.binding.span,
        });
      }
      return;
    }

    const missingParameters = lambda.parameters
      .filter((parameter) => parameter.annotation === undefined)
      .map((parameter) => `\`${displayParameterName(parameter.name)}\``);
    const missingReturn = lambda.returnAnnotation === undefined;
    if (missingParameters.length > 0 || missingReturn) {
      const missing = [
        ...(missingParameters.length === 0
          ? []
          : [`type${missingParameters.length === 1 ? "" : "s"} for parameter${
            missingParameters.length === 1 ? "" : "s"
          } ${missingParameters.join(", ")}`]),
        ...(missingReturn ? ["a return type"] : []),
      ];
      this.#diagnostics.add({
        severity: "error",
        message:
          `exported function \`${item.binding.name}\` requires a complete signature; add ${
            missing.join(" and ")
          }`,
        primary: item.binding.span,
        incompleteSignature: true,
      });
    }

    const scheme = this.#scheme(item.binding.symbol);
    scheme.variables.forEach((variable, index) => {
      const required = this.#maximalConstraintNames(
        variable.requirements
          .filter((requirement) =>
            requirement.evidenceConstraint === undefined ||
            requirement.evidenceConstraint === requirement.name
          )
          .map(({ name }) => name),
      );
      if (required.length > 0 && variable.declaredConstraints === undefined) {
        const constraintList = required.length === 1
          ? required[0]!
          : `(${required.join(", ")})`;
        this.#diagnostics.add({
          severity: "error",
          message:
            `exported function \`${item.binding.name}\` must declare every constraint in its signature; ` +
            `write \`<${variable.rigidName ?? inferredTypeVariableName(index)}: ${constraintList}>\``,
          primary: item.binding.span,
          incompleteSignature: true,
        });
      }
    });

    for (const parameter of lambda.typeParameters ?? []) {
      const maximal = new Set(this.#maximalConstraintNames(parameter.constraints));
      for (const constraint of parameter.constraints) {
        if (maximal.has(constraint)) continue;
        const provider = parameter.constraints.find((candidate) =>
          candidate !== constraint &&
          this.#baseConstraintPath(candidate, constraint) !== undefined
        );
        this.#diagnostics.add({
          severity: "error",
          message:
            `exported function \`${item.binding.name}\` must omit base constraint \`${constraint}\` from ` +
            `\`${parameter.name}\`; \`${provider ?? "another declared constraint"}\` already provides it`,
          primary: parameter.span,
        });
      }
    }
  }

  /**
   * §6.3: every written claim is checked against the representation, in the home
   * module, where nothing is hidden. Only *this* module's declarations — an
   * imported one was verified where it was written, and re-reporting it would
   * caret a stranger's source.
   *
   * A later representation edit that violates a standing claim therefore errors
   * at the author's declaration, never downstream in a client module.
   */
  #verifyVarianceClaims(module: Resolved.Module): void {
    for (const item of module.items) {
      if (item.kind !== "Union" && item.kind !== "RecordDeclaration") continue;
      for (const [index, declared] of (item.declaredParameters ?? []).entries()) {
        const claim = declared.claim;
        if (claim === undefined) continue;
        const computed = item.kind === "Union"
          ? this.#variance.computedUnion(item.union, index)
          : this.#variance.computedRecord(item.record, index);
        const admitted: readonly Variance[] = claim === "co"
          ? ["unused", "co"]
          : ["unused", "contra"];
        if (admitted.includes(computed)) continue;
        const occurrences = item.kind === "Union"
          ? this.#variance.occurrencesUnion(item.union, index)
          : this.#variance.occurrencesRecord(item.record, index);
        const witness = occurrences.find(
          (occurrence) => !admitted.includes(occurrence.variance),
        );
        const claimed = claim === "co" ? "covariant" : "contravariant";
        const sigil = claim === "co" ? "+" : "-";
        const slot = item.kind === "Union" ? "constructor slot" : "field";
        // The witness is required content, not garnish (§8.1): the author who
        // cannot state variance theory is shown the exact line that blocks the
        // claim, with both legal exits named (Rewrite Rule, Preamble §1.1).
        this.#diagnostics.add({
          severity: "error",
          message: witness === undefined
            ? `\`${declared.name}\` cannot be declared ${claimed} in \`${item.name}\`; ` +
              `remove the \`${sigil}\`, or change the representation`
            : `\`${declared.name}\` cannot be declared ${claimed} in \`${item.name}\`: ` +
              `${slot} \`${witness.field}\` uses \`${declared.name}\` ${positionPhrase(witness.variance)}. ` +
              `Remove the \`${sigil}\`, or change the ${slot}`,
          primary: declared.span,
          ...(witness === undefined ? {} : {
            labels: [{
              span: witness.span,
              message: `\`${declared.name}\` ${positionPhrase(witness.variance)} here`,
            }],
          }),
        });
      }
    }
  }

  #typeOf(expression: Resolved.Expr): Mono {
    return this.#expressionTypes.get(expression) ?? ERROR;
  }

  #isValue(expression: Resolved.Expr): boolean {
    switch (expression.kind) {
      case "Unit":
      case "Integer":
      case "BigInt":
      case "Float":
      case "Lambda":
        return true;
      case "Name":
        return this.#isImmutableTermReference(expression.symbol);
      case "String":
        return expression.parts.every(({ kind }) => kind === "Text");
      case "Tuple":
        return expression.elements.every((element) => this.#isValue(element));
      case "Record":
        return expression.spread === undefined &&
          expression.fields.every((field) => this.#isValue(field.value));
      case "Call":
        return expression.callee.kind === "Name" &&
          (this.#constructorUnions.has(expression.callee.symbol) ||
            this.#recordConstructors.has(expression.callee.symbol)) &&
          expression.arguments.every((argument) => this.#isValue(argument));
      case "Group":
        return this.#isValue(expression.expression);
      default:
        return false;
    }
  }

  /**
   * Functions §8.2's "reference — possibly module-qualified — to an immutable
   * term binding": a `let`, a `fun`, a parameter, a pattern binder, or an import
   * (whose kind is whatever the defining module gave it). Constructors are the
   * pre-existing row and stay.
   *
   * Excluded, each for its own reason:
   * - `var`, because a read is a state observation, not a value (closure doc
   *   §2.3). Levels would protect the typing anyway; this is doctrine hygiene.
   * - `extern`, because the ruling's list does not name it. Nothing observable
   *   rides on the choice: FFI Part 4 §12.4 makes every extern monomorphic in
   *   v1, so an extern reference has no variable for either rule to quantify.
   * - `constraint-member`, because whether a bare unapplied member is a legal
   *   term at all belongs to Constraints §2.2; the ruling neither opens nor
   *   closes that door (closure doc §2.5), so the status quo stands.
   */
  #isImmutableTermReference(symbol: Resolved.SymbolId): boolean {
    switch (this.#symbolKinds.get(symbol)) {
      case "let":
      case "fun":
      case "parameter":
      case "pattern":
      case "constructor":
      case "record-constructor":
        return true;
      default:
        // A symbol the map does not hold is not a term this module can name;
        // the pre-existing constructor test is kept as the fallback so a
        // compiler-minted constructor without a `module.symbols` row (none
        // today) cannot silently lose its row from the list.
        return this.#constructorUnions.has(symbol);
    }
  }

  #publicType(
    type: Mono,
    seen = new Map<number, Typed.VariableType>(),
  ): Typed.Type {
    const actual = this.#prune(type);
    if (actual.kind === "Error") return { kind: "Error" };
    if (actual.kind === "Constructor") {
      return { kind: "Primitive", name: actual.name };
    }
    if (actual.kind === "Function") {
      return {
        kind: "Function",
        parameters: actual.parameters.map((parameter) =>
          this.#publicType(parameter, seen),
        ),
        result: this.#publicType(actual.result, seen),
      };
    }
    if (actual.kind === "Tuple") {
      return {
        kind: "Tuple",
        elements: actual.elements.map((element) => this.#publicType(element, seen)),
      };
    }
    if (actual.kind === "Record") {
      const tail = actual.tail === undefined ? undefined : this.#prune(actual.tail);
      return {
        kind: "Record",
        fields: [...actual.fields].map(([name, field]) => ({
          name,
          type: this.#publicType(field, seen),
        })),
        ...(tail?.kind === "Variable" ? { tail: Typed.typeVariableId(tail.id) } : {}),
      };
    }
    if (actual.kind === "Union") {
      return {
        kind: "Union",
        union: actual.union,
        name: actual.name,
        arguments: actual.arguments.map((argument) => this.#publicType(argument, seen)),
      };
    }
    if (actual.kind === "NominalRecord") {
      return {
        kind: "NominalRecord",
        record: actual.record,
        name: actual.name,
        arguments: actual.arguments.map((argument) => this.#publicType(argument, seen)),
      };
    }
    if (actual.kind === "ExternType") {
      return {
        kind: "ExternType",
        externType: actual.externType,
        name: actual.name,
      };
    }
    if (actual.kind === "Range") return { kind: "Range" };
    if (actual.kind === "Vector") {
      return { kind: "Vector", element: this.#publicType(actual.element, seen) };
    }
    if (actual.kind === "Set") return { kind: "Set", element: this.#publicType(actual.element, seen) };
    if (actual.kind === "Array") return { kind: "Array", element: this.#publicType(actual.element, seen) };
    if (actual.kind === "Node") return { kind: "Node", element: this.#publicType(actual.element, seen) };
    if (actual.kind === "Nullable") return { kind: "Nullable", value: this.#publicType(actual.value, seen) };
    if (actual.kind === "Map") {
      return { kind: "Map", key: this.#publicType(actual.key, seen), value: this.#publicType(actual.value, seen) };
    }
    const existing = seen.get(actual.id);
    if (existing !== undefined) return existing;
    const variable: Typed.VariableType = {
      kind: "Variable",
      id: Typed.typeVariableId(actual.id),
    };
    seen.set(actual.id, variable);
    return variable;
  }

  #publicRequirement(requirement: Requirement): Typed.Constraint {
    return {
      name: requirement.name,
      type: this.#publicType(requirement.type),
      span: requirement.span,
      ...(requirement.dictionary === undefined
        ? {}
        : { dictionary: requirement.dictionary }),
      ...(requirement.evidenceConstraint === undefined
        ? {}
        : { evidenceConstraint: requirement.evidenceConstraint }),
      ...(requirement.evidencePath === undefined
        ? {}
        : { evidencePath: requirement.evidencePath }),
      ...(requirement.dictionaryArguments === undefined
        ? {}
        : { dictionaryArguments: requirement.dictionaryArguments.map((argument) =>
            this.#publicRequirement(argument)
          ) }),
      ...(requirement.structural === true ? { structural: true } : {}),
    };
  }

  /**
   * The evidence a constrained binding's **ABI** expects, for one reference to
   * it: one argument per constraint the callee's scheme declares, in order.
   *
   * **Maximal constraints per variable** (FFI Part 9 §13, which states this is
   * the same rule internally and publicly). Instantiating a scheme yields every
   * requirement the body accumulated, including ones a *sibling* requirement on
   * the same type already implies — `Num` beside `Signed` on one variable. The
   * definition declares a parameter only for the maximal ones, so a reference
   * must supply only those: passing both handed the `Num` dictionary to the
   * `Signed` slot and crashed at the first `.subtract` (defect 16).
   *
   * Deliberately *not* the `evidenceConstraint` test `#publicScheme` uses. That
   * test cannot tell a redundant sibling from a **projection** — `Same` reached
   * as `__hex_dictLabeled.same` from an enclosing dictionary also carries an
   * `evidenceConstraint` of another name, and it is the callee's one real
   * argument. Elimination has to be decided among siblings, not per requirement.
   */
  #evidenceRequirements(requirements: readonly Requirement[]): readonly Typed.Constraint[] {
    const namesByType = new Map<string, Set<string>>();
    const identify = (requirement: Requirement): string => {
      const type = this.#prune(requirement.type);
      return type.kind === "Variable" ? `v${type.id}` : this.#display(type);
    };
    for (const requirement of requirements) {
      const identity = identify(requirement);
      const names = namesByType.get(identity) ?? new Set<string>();
      names.add(requirement.name);
      namesByType.set(identity, names);
    }
    return this.#publicRequirements(requirements.filter((requirement) => {
      const siblings = namesByType.get(identify(requirement)) ?? new Set<string>();
      for (const sibling of siblings) {
        if (sibling === requirement.name) continue;
        if (this.#baseConstraintPath(sibling, requirement.name) !== undefined) return false;
      }
      return true;
    }));
  }

  #publicRequirements(requirements: readonly Requirement[]): readonly Typed.Constraint[] {
    const unique = new Map<string, Typed.Constraint>();
    for (const requirement of requirements) {
      const constraint = this.#publicRequirement(requirement);
      const type = this.#prune(requirement.type);
      const identity = type.kind === "Variable"
        ? `v${type.id}`
        : this.#display(type);
      unique.set(`${constraint.name}:${identity}`, constraint);
    }
    return [...unique.values()];
  }

  #publicScheme(scheme: Scheme): Typed.Scheme {
    const variables = scheme.variables
      .map((variable) => this.#prune(variable))
      .filter((type): type is Variable => type.kind === "Variable");
    const constraints = new Map<string, Typed.Constraint>();
    for (const variable of variables) {
      for (const requirement of variable.requirements) {
        if (
          requirement.evidenceConstraint !== undefined &&
          requirement.evidenceConstraint !== requirement.name
        ) continue;
        const constraint = this.#publicRequirement(requirement);
        constraints.set(`${constraint.name}:${variable.id}`, constraint);
      }
    }
    return {
      variables: variables.map(({ id }) => Typed.typeVariableId(id)),
      constraints: [...constraints.values()],
      type: this.#publicType(scheme.type),
    };
  }

  #materializeItem(item: Resolved.Item): Typed.Item {
    if (item.kind === "ErrorItem") return item;
    // Imports pass through unchanged. Pruning an import's unused instance
    // dictionaries was tried and reverted (#147): a module's interface — which
    // is what downstream modules build their own imports from — is computed
    // before checking, so dropping an instance here makes a consumer import a
    // name the producer no longer exports. Unused evidence in the emitted
    // JavaScript is a readability defect worth its own issue, not something to
    // fix by breaking the interface contract.
    if (item.kind === "Import") return item;
    if (item.kind === "ExternImport") return item;
    if (item.kind === "ExternBlock") {
      return {
        ...item,
        declarations: item.declarations.map((declaration): Typed.ExternDeclaration => {
          if (declaration.kind === "ExternType") return declaration;
          const binding = {
            ...declaration.binding,
            scheme: this.#publicScheme(this.#scheme(declaration.binding.symbol)),
          };
          if (declaration.kind === "ExternLet") {
            return {
              kind: "ExternLet",
              exported: declaration.exported,
              default: declaration.default,
              ...(declaration.foreignName === undefined ? {} : { foreignName: declaration.foreignName }),
              localName: declaration.localName,
              binding,
              type: this.#publicType(this.#annotationType(declaration.annotation)),
              span: declaration.span,
            };
          }
          return {
            kind: "ExternFun",
            exported: declaration.exported,
            default: declaration.default,
            ...(declaration.foreignName === undefined ? {} : { foreignName: declaration.foreignName }),
            localName: declaration.localName,
            binding,
            parameters: declaration.parameters.map((parameter) => ({
              ...parameter,
              scheme: this.#publicScheme(this.#scheme(parameter.symbol)),
            })),
            result: this.#publicType(this.#annotationType(
              declaration.returnAnnotation,
              0,
              new Map(),
              this.#intrinsicTypeParameters.get(declaration) ?? new Map(),
            )),
            span: declaration.span,
          };
        }),
      };
    }
    if (item.kind === "ConstraintDeclaration") {
      const subject = this.#constraintSubjects.get(item) ?? this.#fresh(0, false);
      return {
        kind: "ConstraintDeclaration",
        name: item.name,
        subject: Typed.typeVariableId(subject.id),
        baseConstraints: item.baseConstraints,
        impliedTypes: item.impliedTypes.map((impliedType) => ({
          name: impliedType.name,
          type: this.#publicType(
            this.#constraintImpliedTypes.get(item)?.get(impliedType.name) ?? ERROR,
          ),
          span: impliedType.span,
        })),
        members: item.members.map((member) => ({
          binding: {
            ...member.binding,
            scheme: this.#publicScheme(this.#scheme(member.binding.symbol)),
          },
          parameters: member.parameters.map((parameter) => ({
            ...parameter,
            scheme: this.#publicScheme(this.#scheme(parameter.symbol)),
          })),
          result: this.#publicType(this.#annotationType(
            member.returnAnnotation,
            0,
            new Map(),
            new Map([[item.subject, subject]]),
            this.#constraintImpliedTypes.get(item),
          )),
          ...(member.defaultValue === undefined
            ? {}
            : { defaultValue: this.#materializeLambda(member.defaultValue) }),
          span: member.span,
        })),
        span: item.span,
      };
    }
    if (item.kind === "Honor") {
      const typeParameters = this.#instanceTypeParameters.get(item) ?? new Map();
      const declaration = this.#constraintDeclarations.get(item.constraint);
      const supplied = new Set(item.members.map(({ name }) => name));
      const inherited = declaration?.members.flatMap((member) =>
        member.defaultValue !== undefined && !supplied.has(member.binding.name)
          ? [{
              name: member.binding.name,
              value: this.#materializeLambda(member.defaultValue),
              span: member.span,
            }]
          : []
      ) ?? [];
      return {
        kind: "Honor",
        constraint: item.constraint,
        typeParameters: item.typeParameters.map((parameter) => ({
          name: parameter.name,
          variable: Typed.typeVariableId(typeParameters.get(parameter.name)?.id ?? -1),
          constraints: parameter.constraints,
          span: parameter.span,
        })),
        subject: this.#publicType(this.#instanceSubjects.get(item) ?? ERROR),
        derived: item.derived,
        dictionary: item.dictionary,
        baseConstraints: this.#publicRequirements(
          this.#instanceBaseConstraints.get(item) ?? [],
        ),
        impliedTypes: item.impliedTypes.map((impliedType) => ({
          name: impliedType.name,
          type: this.#publicType(this.#annotationType(impliedType.annotation)),
          span: impliedType.span,
        })),
        members: [
          ...item.members.map((member) => ({
            name: member.name,
            value: this.#materializeLambda(member.value),
            span: member.span,
          })),
          ...inherited,
        ],
        span: item.span,
      };
    }
    if (item.kind === "ExprItem") {
      return { ...item, expression: this.#materializeExpr(item.expression) };
    }
    if (item.kind === "LetPattern") {
      return {
        ...item,
        pattern: this.#materializePattern(item.pattern),
        value: this.#materializeExpr(item.value),
      };
    }
    if (item.kind === "Union") {
      return {
        kind: "Union",
        exported: item.exported,
        opaque: item.opaque,
        union: item.union,
        name: item.name,
        parameters: [...(this.#unionParameters.get(item.union)?.values() ?? [])]
          .map(({ id }) => Typed.typeVariableId(id)),
        derives: item.derives,
        constructors: item.constructors.map(({ binding, slots }) => ({
          ...binding,
          scheme: this.#publicScheme(this.#scheme(binding.symbol)),
          slots: slots.map((slot) => ({
            field: slot.field,
            type: this.#publicType(this.#annotationType(
              slot.annotation,
              0,
              new Map(),
              this.#unionParameters.get(item.union),
            )),
            span: slot.span,
          })),
        })),
        span: item.span,
      };
    }
    if (item.kind === "RecordDeclaration") {
      const record = this.#materializeRecord(this.#records.get(item.record)!);
      return {
        kind: "RecordDeclaration",
        exported: item.exported,
        record: item.record,
        ...record,
      };
    }
    if (item.kind === "TypeAlias") {
      const parameters = this.#aliasParameters.get(item) ?? new Map();
      return {
        kind: "TypeAlias",
        exported: item.exported,
        name: item.name,
        parameters: [...parameters.values()].map(({ id }) => Typed.typeVariableId(id)),
        type: this.#publicType(this.#annotationType(item.annotation, 0, new Map(), parameters)),
        span: item.span,
      };
    }
    if (item.kind === "Exception") {
      return {
        kind: "Exception",
        exported: item.exported,
        binding: {
          ...item.binding,
          scheme: this.#publicScheme(this.#scheme(item.binding.symbol)),
        },
        slots: item.slots.map((slot) => ({
          field: slot.field,
          type: this.#publicType(this.#annotationType(slot.annotation)),
          span: slot.span,
        })),
        span: item.span,
      };
    }
    const scheme = this.#publicScheme(this.#scheme(item.binding.symbol));
    if (item.kind === "Var") {
      return {
        kind: "Var",
        binding: { ...item.binding, scheme },
        value: this.#materializeExpr(item.value),
        span: item.span,
      };
    }
    return item.kind === "Fun"
      ? {
          kind: "Fun",
          exported: item.exported,
          binding: { ...item.binding, scheme },
          value: this.#materializeLambda(item.value),
          span: item.span,
        }
      : {
          kind: "Let",
          exported: item.exported,
          binding: { ...item.binding, scheme },
          value: this.#materializeExpr(item.value),
          span: item.span,
        };
  }

  #materializePattern(pattern: Resolved.Pattern): Typed.Pattern {
    if (
      pattern.kind === "Wildcard" ||
      pattern.kind === "Unit" ||
      pattern.kind === "Integer" ||
      pattern.kind === "String"
    ) return pattern;
    if (pattern.kind === "Or") {
      return {
        ...pattern,
        alternatives: pattern.alternatives.map((alternative) =>
          this.#materializePattern(alternative)
        ),
      };
    }
    if (pattern.kind === "As") {
      return {
        ...pattern,
        pattern: this.#materializePattern(pattern.pattern),
        binding: {
          ...pattern.binding,
          scheme: this.#publicScheme(this.#scheme(pattern.binding.symbol)),
        },
      };
    }
    if (pattern.kind === "Constructor") {
      return {
        ...pattern,
        arguments: pattern.arguments.map((argument) =>
          this.#materializePattern(argument),
        ),
      };
    }
    if (pattern.kind === "Tuple") {
      return {
        ...pattern,
        elements: pattern.elements.map((element) =>
          this.#materializePattern(element),
        ),
      };
    }
    if (pattern.kind === "Vector") {
      return {
        kind: "Vector",
        elements: pattern.elements.map((element) => this.#materializePattern(element)),
        ...(pattern.rest === undefined
          ? {}
          : {
              rest: {
                index: pattern.rest.index,
                span: pattern.rest.span,
                ...(pattern.rest.pattern === undefined
                  ? {}
                  : { pattern: this.#materializePattern(pattern.rest.pattern) }),
              },
            }),
        span: pattern.span,
      };
    }
    if (pattern.kind === "Record") {
      return {
        ...pattern,
        fields: pattern.fields.map((field) => ({
          ...field,
          pattern: this.#materializePattern(field.pattern),
        })),
      };
    }
    return {
      kind: "Binding",
      binding: {
        ...pattern.binding,
        scheme: this.#publicScheme(this.#scheme(pattern.binding.symbol)),
      },
      span: pattern.span,
    };
  }

  /**
   * The variance channel to everything downstream of the checker (§8.2's code
   * action, hover). `declaredParameters` is absent on synthesized declarations,
   * which have no written head — the computed side is still the truth there.
   */
  #parameterVariance(
    parameters: readonly string[],
    declared: readonly Resolved.DeclaredTypeParameter[] | undefined,
    computed: (index: number) => Variance,
  ): readonly Typed.ParameterVariance[] {
    return parameters.map((name, index) => {
      const written = declared?.[index];
      return {
        name,
        ...(written?.claim === undefined ? {} : { declared: written.claim }),
        computed: computed(index),
        ...(written === undefined ? {} : { span: written.span }),
      };
    });
  }

  #materializeUnion(union: Resolved.Union): Typed.Union {
    return {
      id: union.id,
      name: union.name,
      parameters: [...(this.#unionParameters.get(union.id)?.values() ?? [])]
        .map(({ id }) => Typed.typeVariableId(id)),
      variance: this.#parameterVariance(
        union.parameters,
        union.declaredParameters,
        (index) => this.#variance.computedUnion(union.id, index),
      ),
      derives: union.derives,
      opaque: union.opaque,
      representationVisible: union.representationVisible,
      span: union.span,
      constructors: union.constructors.map(({ binding, slots }) => ({
        ...binding,
        scheme: this.#publicScheme(this.#scheme(binding.symbol)),
        slots: slots.map((slot) => ({
          field: slot.field,
          type: this.#publicType(this.#annotationType(
            slot.annotation,
            0,
            new Map(),
            this.#unionParameters.get(union.id),
          )),
          span: slot.span,
        })),
      })),
    };
  }

  #materializeRecord(record: Resolved.RecordDeclaration): Typed.RecordDeclaration {
    const parameters = this.#recordParameters.get(record.id);
    return {
      id: record.id,
      name: record.name,
      parameters: [...(parameters?.values() ?? [])].map(({ id }) => Typed.typeVariableId(id)),
      variance: this.#parameterVariance(
        record.parameters,
        record.declaredParameters,
        (index) => this.#variance.computedRecord(record.id, index),
      ),
      derives: record.derives,
      opaque: record.opaque,
      representationVisible: record.representationVisible,
      constructor: {
        ...record.constructor,
        scheme: this.#publicScheme(this.#scheme(record.constructor.symbol)),
      },
      fields: record.fields.map((field) => ({
        name: field.name,
        type: this.#publicType(this.#annotationType(
          field.annotation,
          0,
          new Map(),
          parameters,
        )),
        span: field.span,
      })),
      span: record.span,
    };
  }

  #materializeExpr(expression: Resolved.Expr): Typed.Expr {
    const value = this.#materializeUnwidenedExpr(expression);
    const natWidening = this.#natWidenings.get(expression);
    if (natWidening !== undefined) {
      const requirement = this.#publicRequirement(natWidening);
      return {
        kind: "WidenNat",
        value,
        requirement,
        type: requirement.type,
        span: expression.span,
      };
    }
    const widening = this.#intWidenings.get(expression);
    if (widening === undefined) return value;
    const requirement = this.#publicRequirement(widening);
    return {
      kind: "WidenInt",
      value,
      requirement,
      type: requirement.type,
      span: expression.span,
    };
  }

  #materializeUnwidenedExpr(expression: Resolved.Expr): Typed.Expr {
    const type = this.#publicType(this.#typeOf(expression));
    switch (expression.kind) {
      case "Name": {
        // A reference in *value* position carries the constraints it resolved,
        // so emission can close over the evidence (defect 4). A callee
        // reference carries none: the enclosing `Call` supplies it, and doing
        // both would apply it twice.
        const requirements = this.#calleeNames.has(expression)
          ? []
          : this.#evidenceRequirements(this.#nameRequirements.get(expression) ?? []);
        return requirements.length === 0
          ? { ...expression, type }
          : { ...expression, type, requirements };
      }
      case "CollectionOperation":
      case "PrimitiveOperation":
      case "Unit":
      case "BigInt":
      case "Float":
      case "ErrorExpr":
        return expression.kind === "CollectionOperation"
          ? {
              ...expression,
              type,
              requirements: this.#publicRequirements(this.#requirements.get(expression) ?? []),
            }
          : { ...expression, type };
      case "Integer":
        return {
          kind: "FromNat",
          decimal: expression.decimal,
          requirement: this.#publicRequirement(this.#requirements.get(expression)![0]!),
          type,
          span: expression.span,
        };
      case "String":
        return {
          ...expression,
          type,
          parts: expression.parts.map((part) =>
            part.kind === "Text"
              ? part
              : {
                  ...part,
                  expression: this.#materializeExpr(part.expression),
                  requirement: this.#publicRequirement(this.#requirements.get(part)![0]!),
                },
          ),
        };
      case "Hash":
        return {
          kind: "Hash",
          value: this.#materializeExpr(expression.value),
          requirement: this.#publicRequirement(this.#requirements.get(expression)![0]!),
          type,
          span: expression.span,
        };
      case "Tuple":
      case "Vector":
        return {
          ...expression,
          type,
          elements: expression.elements.map((element) =>
            this.#materializeExpr(element),
          ),
        };
      case "Record":
        return {
          kind: "Record",
          type,
          ...(expression.spread === undefined
            ? {}
            : { spread: this.#materializeExpr(expression.spread) }),
          fields: expression.fields.map((field) => ({
            ...field,
            value: this.#materializeExpr(field.value),
          })),
          span: expression.span,
        };
      case "Group":
        return { ...expression, type, expression: this.#materializeExpr(expression.expression) };
      case "Block":
        return { ...expression, type, items: expression.items.map((item) => this.#materializeItem(item)) };
      case "Lambda":
        return this.#materializeLambda(expression);
      case "If":
        return {
          kind: "If" as const,
          condition: this.#materializeExpr(expression.condition),
          consequence: this.#materializeExpr(expression.consequence),
          alternative: this.#materializeExpr(expression.alternative),
          ...(expression.elseless ? { elseless: true } : {}),
          type,
          span: expression.span,
        };
      case "While":
        return {
          kind: "While",
          condition: this.#materializeExpr(expression.condition),
          body: this.#materializeExpr(expression.body) as Typed.BlockExpr,
          type,
          span: expression.span,
        };
      case "For":
        return {
          kind: "For",
          pattern: this.#materializePattern(expression.pattern),
          iterable: this.#materializeExpr(expression.iterable),
          body: this.#materializeExpr(expression.body) as Typed.BlockExpr,
          ...(this.#iterations.get(expression) === undefined
            ? {}
            : { iteration: this.#publicRequirement(this.#iterations.get(expression)!) }),
          type,
          span: expression.span,
        };
      case "Throw":
        return {
          kind: "Throw",
          exception: this.#materializeExpr(expression.exception),
          type,
          span: expression.span,
        };
      case "Try":
        return {
          kind: "Try",
          body: this.#materializeExpr(expression.body),
          arms: expression.arms.map((arm) => ({
            pattern: this.#materializePattern(arm.pattern),
            ...(arm.guard === undefined
              ? {}
              : { guard: this.#materializeExpr(arm.guard) }),
            body: this.#materializeExpr(arm.body),
            span: arm.span,
          })),
          type,
          span: expression.span,
        };
      case "Match":
        const union = this.#matchUnions.get(expression);
        return {
          kind: "Match",
          scrutinee: this.#materializeExpr(expression.scrutinee),
          arms: expression.arms.map((arm) => ({
            pattern: this.#materializePattern(arm.pattern),
            ...(arm.guard === undefined
              ? {}
              : { guard: this.#materializeExpr(arm.guard) }),
            body: this.#materializeExpr(arm.body),
            span: arm.span,
          })),
          ...(union === undefined ? {} : { union }),
          type,
          span: expression.span,
        };
      case "Call":
        const dotCall = this.#dotCalls.get(expression);
        if (dotCall !== undefined) {
          return {
            kind: "Call",
            callee: {
              kind: "Name",
              symbol: dotCall.symbol.id,
              text: this.#operationSpellings.get(dotCall.symbol.id) ?? dotCall.symbol.name,
              type: this.#publicType(dotCall.callee),
              receiverBound: true,
              span: expression.callee.kind === "Access"
                ? expression.callee.field.span
                : expression.callee.span,
            },
            arguments: [
              this.#materializeExpr(dotCall.receiver),
              ...expression.arguments.map((argument) => this.#materializeExpr(argument)),
            ],
            requirements: [],
            type,
            span: expression.span,
          };
        }
        return {
          ...expression,
          type,
          callee: this.#materializeExpr(expression.callee),
          arguments: expression.arguments.map((argument) => this.#materializeExpr(argument)),
          requirements: this.#evidenceRequirements(
            this.#callRequirements.get(expression) ?? [],
          ),
        };
      case "ConsoleLog":
        return {
          ...expression,
          type,
          arguments: expression.arguments.map((argument) =>
            this.#materializeExpr(argument)
          ),
        };
      case "Access": {
        const tupleIndex = this.#tupleAccesses.get(expression);
        const recordField = this.#recordAccesses.get(expression);
        return {
          ...expression,
          type,
          receiver: this.#materializeExpr(expression.receiver),
          ...(tupleIndex === undefined ? {} : { tupleIndex }),
          ...(recordField === undefined ? {} : { recordField }),
        };
      }
      case "Index":
        return {
          ...expression,
          type,
          receiver: this.#materializeExpr(expression.receiver),
          index: this.#materializeExpr(expression.index),
          ...(this.#indexOperations.get(expression) === undefined
            ? {}
            : { operation: this.#indexOperations.get(expression)! }),
          ...(this.#requirements.get(expression) === undefined
            ? {}
            : { requirements: this.#publicRequirements(this.#requirements.get(expression)!) }),
        };
      case "Unary":
        if (expression.operator === "Not") {
          return {
            kind: "LogicalNot",
            operand: this.#materializeExpr(expression.operand),
            type,
            span: expression.span,
          };
        }
        return this.#materializeConstraintCall(
          expression,
          "Signed",
          "negate",
          [expression.operand],
        );
      case "Binary":
        return this.#materializeBinary(expression, type);
      case "Comparison":
        return {
          kind: "ComparisonChain",
          type,
          operands: expression.operands.map((operand) => this.#materializeExpr(operand)),
          steps: expression.operators.map((test, index) => ({
            test,
            requirement: this.#publicRequirement(
              this.#requirements.get(expression)?.[index]!,
            ),
            span: expression.span,
          })),
          span: expression.span,
        };
      case "Assignment":
        return {
          ...expression,
          type,
          target: this.#materializeExpr(expression.target),
          value: this.#materializeExpr(expression.value),
        };
    }
  }

  #materializeLambda(expression: Resolved.LambdaExpr): Typed.LambdaExpr {
    return {
      kind: "Lambda",
      type: this.#publicType(this.#typeOf(expression)),
      parameters: expression.parameters.map((parameter) => ({
        symbol: parameter.symbol,
        name: parameter.name,
        span: parameter.span,
        scheme: this.#publicScheme(this.#scheme(parameter.symbol)),
      })),
      body: this.#materializeExpr(expression.body),
      span: expression.span,
    };
  }

  #materializeBinary(
    expression: Resolved.BinaryExpr,
    type: Typed.Type,
  ): Typed.Expr {
    if (expression.operator === "Pipe") {
      const call = this.#pipeCalls.get(expression);
      return call === undefined
        ? { kind: "ErrorExpr", type, span: expression.span }
        : this.#materializeExpr(call);
    }

    const left = this.#materializeExpr(expression.left);
    const right = this.#materializeExpr(expression.right);
    if (expression.operator === "Range") {
      return {
        kind: "Range",
        start: left,
        end: right,
        type,
        span: expression.span,
      };
    }
    if (expression.operator === "And" || expression.operator === "Or") {
      return {
        kind: "Logical",
        operation: expression.operator,
        left,
        right,
        type,
        span: expression.span,
      };
    }
    if (expression.operator === "Implies") {
      return {
        kind: "Logical",
        operation: "Or",
        left: {
          kind: "LogicalNot",
          operand: left,
          type: this.#publicType(this.#typeOf(expression.left)),
          span: expression.left.span,
        },
        right,
        type,
        span: expression.span,
      };
    }
    if (expression.operator === "Iff") {
      // `a iff b` is `Eq<Bool>` equality over the requirement registered while
      // checking it, so the evidence the elaborator sees is the same selected
      // instance an ordinary `==` would carry (#147).
      return {
        kind: "ComparisonChain",
        operands: [left, right],
        steps: [
          {
            test: "Equal",
            requirement: this.#publicRequirement(
              this.#requirements.get(expression)?.[0]!,
            ),
            span: expression.span,
          },
        ],
        type,
        span: expression.span,
      };
    }

    const details: Partial<
      Record<
        Resolved.BinaryOperator,
        readonly [Typed.ConstraintName, Typed.ConstraintMember]
      >
    > = {
      Power: ["Pow", "pow"],
      Multiply: ["Num", "multiply"],
      Divide: ["Frac", "divide"],
      Add: ["Num", "add"],
      Subtract: ["Signed", "subtract"],
      Concat: ["Concat", "concat"],
    };
    const detail = details[expression.operator];
    return detail === undefined
      ? { kind: "ErrorExpr", type, span: expression.span }
      : this.#materializeConstraintCall(
          expression,
          detail[0],
          detail[1],
          [expression.left, expression.right],
        );
  }

  #materializeConstraintCall(
    expression: Resolved.Expr,
    constraint: Typed.ConstraintName,
    member: Typed.ConstraintMember,
    arguments_: readonly Resolved.Expr[],
  ): Typed.ConstraintCallExpr {
    const requirement = this.#requirements.get(expression)?.[0];
    return {
      kind: "ConstraintCall",
      constraint,
      member,
      requirement:
        requirement === undefined
          ? { name: constraint, type: { kind: "Error" }, span: expression.span }
          : this.#publicRequirement(requirement),
      arguments: arguments_.map((argument) => this.#materializeExpr(argument)),
      type: this.#publicType(this.#typeOf(expression)),
      span: expression.span,
    };
  }

  #display(type: Mono): string {
    const actual = this.#prune(type);
    if (actual.kind === "Error") return "<error>";
    if (actual.kind === "Constructor") return actual.name;
    // A declared variable has a name the user wrote; `?3` in its place is
    // unreadable, and worse inside a diagnostic the Rewrite Rule makes
    // mandatory.
    if (actual.kind === "Variable") {
      return actual.rigidName ?? actual.displayName ?? `?${actual.id}`;
    }
    if (actual.kind === "Tuple") {
      // The arity-0 tuple displays as `Unit`, never `()` — diagnostics and the
      // pretty-printer say the type's one name (Products §2.7, #159).
      if (actual.elements.length === 0) return "Unit";
      return `(${actual.elements.map((element) => this.#display(element)).join(", ")})`;
    }
    if (actual.kind === "Union") {
      return actual.arguments.length === 0
        ? actual.name
        : `${actual.name}(${actual.arguments.map((argument) => this.#display(argument)).join(", ")})`;
    }
    if (actual.kind === "NominalRecord") {
      return actual.arguments.length === 0
        ? actual.name
        : `${actual.name}(${actual.arguments.map((argument) => this.#display(argument)).join(", ")})`;
    }
    if (actual.kind === "ExternType") return actual.name;
    if (actual.kind === "Range") return "Range";
    if (actual.kind === "Vector") return `Vector(${this.#display(actual.element)})`;
    if (actual.kind === "Set") return `Set(${this.#display(actual.element)})`;
    if (actual.kind === "Array") return `Array(${this.#display(actual.element)})`;
    if (actual.kind === "Node") return `Node(${this.#display(actual.element)})`;
    if (actual.kind === "Nullable") return `Nullable(${this.#display(actual.value)})`;
    if (actual.kind === "Map") return `Map(${this.#display(actual.key)}, ${this.#display(actual.value)})`;
    if (actual.kind === "Record") {
      const fields = [...actual.fields].map(([name, field]) => `${name}: ${this.#display(field)}`);
      if (actual.tail !== undefined) fields.push("...");
      return `{${fields.join(", ")}}`;
    }
    return (
      `(${actual.parameters.map((parameter) => this.#display(parameter)).join(", ")})` +
      ` -> ${this.#display(actual.result)}`
    );
  }
}

/** Rewrites first-argument pipe insertion before either side is inferred. */
function rewritePipe(expression: Resolved.BinaryExpr): Resolved.CallExpr {
  return expression.right.kind === "Call"
    ? {
        kind: "Call",
        callee: expression.right.callee,
        arguments: [expression.left, ...expression.right.arguments],
        span: expression.span,
      }
    : {
        kind: "Call",
        callee: expression.right,
        arguments: [expression.left],
        span: expression.span,
      };
}

function renderLiteralPatternKey(
  pattern: Resolved.IntegerPattern | Resolved.StringPattern,
): string {
  switch (pattern.kind) {
    case "Integer":
      return `Int:${pattern.decimal}`;
    case "String":
      return `String:${pattern.value}`;
  }
}

function unwrapAsPattern(pattern: Resolved.Pattern): Resolved.Pattern {
  return pattern.kind === "As" ? unwrapAsPattern(pattern.pattern) : pattern;
}

/** Every symbol named anywhere inside a resolved subtree, found structurally. */
function referencedSymbols(root: object): ReadonlySet<Resolved.SymbolId> {
  const symbols = new Set<Resolved.SymbolId>();
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if ("kind" in value && value.kind === "Name" && "symbol" in value && typeof value.symbol === "number") {
      symbols.add(value.symbol as Resolved.SymbolId);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "span") visit(child);
    }
  };
  visit(root);
  return symbols;
}

function coverageAlternatives(
  pattern: Resolved.Pattern,
): readonly Resolved.Pattern[] {
  const unwrapped = unwrapAsPattern(pattern);
  return unwrapped.kind === "Or"
    ? unwrapped.alternatives.flatMap(coverageAlternatives)
    : [unwrapped];
}

function annotationHasTypeVariable(
  annotation: Resolved.TypeAnnotation,
): boolean {
  switch (annotation.kind) {
    case "TypeVariable":
      return true;
    case "Function":
      return annotation.parameters.some(annotationHasTypeVariable) ||
        annotationHasTypeVariable(annotation.result);
    case "Vector":
    case "Set":
    case "Array":
    case "Node":
      return annotationHasTypeVariable(annotation.element);
    case "Nullable":
      return annotationHasTypeVariable(annotation.value);
    case "Map":
      return annotationHasTypeVariable(annotation.key) ||
        annotationHasTypeVariable(annotation.value);
    case "Tuple":
      return annotation.elements.some(annotationHasTypeVariable);
    case "Record":
      return annotation.fields.some((field) =>
        annotationHasTypeVariable(field.annotation)
      );
    case "Union":
    case "RecordDeclaration":
      return annotation.arguments.some(annotationHasTypeVariable);
    case "ExternType":
    case "Primitive":
    case "Range":
    case "ImpliedType":
    case "ErrorType":
      return false;
  }
}

/**
 * Whether the hidden `Node` intrinsic appears anywhere in a resolved annotation.
 * Aliases are inlined during resolution, so a `type X = Node(a)` smuggle is a
 * plain `Node` node here. Used to keep `Node` out of every exported public form —
 * a bare signature (via `#mentionsNode` on the Mono) and an exported
 * union/record/exception slot or an extern boundary (via this walker).
 */
function annotationMentionsNode(annotation: Resolved.TypeAnnotation): boolean {
  switch (annotation.kind) {
    case "Node":
      return true;
    case "Vector":
    case "Set":
    case "Array":
      return annotationMentionsNode(annotation.element);
    case "Nullable":
      return annotationMentionsNode(annotation.value);
    case "Map":
      return annotationMentionsNode(annotation.key) || annotationMentionsNode(annotation.value);
    case "Function":
      return annotation.parameters.some(annotationMentionsNode) ||
        annotationMentionsNode(annotation.result);
    case "Tuple":
      return annotation.elements.some(annotationMentionsNode);
    case "Record":
      return annotation.fields.some((field) => annotationMentionsNode(field.annotation));
    case "Union":
    case "RecordDeclaration":
      return annotation.arguments.some(annotationMentionsNode);
    case "Primitive":
    case "Range":
    case "ExternType":
    case "TypeVariable":
    case "ImpliedType":
    case "ErrorType":
      return false;
  }
}

/**
 * The adapter type (`Seq`) found *nested* inside a direct extern value, if any.
 * `Seq` crosses the FFI boundary only at the top of a declaration, where the
 * bridges wrap it; buried in a tuple or record there is nothing to wrap.
 *
 * `Seq` is now the prelude's record rather than an intrinsic annotation kind, so
 * the identity is passed in: a *user* record spelled `Seq` is an ordinary value
 * and must not be flagged here.
 */
function nestedAdapterType(
  annotation: Resolved.TypeAnnotation,
  seqRecord: Resolved.RecordId | undefined,
  nested = false,
): string | undefined {
  const recurse = (inner: Resolved.TypeAnnotation): string | undefined =>
    nestedAdapterType(inner, seqRecord, true);
  if (
    annotation.kind === "RecordDeclaration" &&
    seqRecord !== undefined &&
    annotation.record === seqRecord
  ) {
    if (nested) return "Seq";
    return annotation.arguments.map(recurse).find((found) => found !== undefined);
  }
  if (annotation.kind === "Function") {
    for (const parameter of annotation.parameters) {
      const found = recurse(parameter);
      if (found !== undefined) return found;
    }
    return recurse(annotation.result);
  }
  if (annotation.kind === "Tuple") {
    for (const element of annotation.elements) {
      const found = recurse(element);
      if (found !== undefined) return found;
    }
  } else if (annotation.kind === "Record") {
    for (const field of annotation.fields) {
      const found = recurse(field.annotation);
      if (found !== undefined) return found;
    }
  } else if (
    annotation.kind === "Vector" ||
    annotation.kind === "Set" ||
    annotation.kind === "Array" ||
    annotation.kind === "Node"
  ) {
    return recurse(annotation.element);
  } else if (annotation.kind === "Nullable") {
    return recurse(annotation.value);
  } else if (annotation.kind === "Map") {
    return recurse(annotation.key) ?? recurse(annotation.value);
  } else if (annotation.kind === "Union" || annotation.kind === "RecordDeclaration") {
    for (const argument of annotation.arguments) {
      const found = recurse(argument);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function resolvedPatternBindings(
  pattern: Resolved.Pattern,
): readonly Resolved.Binding[] {
  switch (pattern.kind) {
    case "Binding":
      return [pattern.binding];
    case "Wildcard":
    case "Unit":
    case "Integer":
    case "String":
      return [];
    case "As":
      return [...resolvedPatternBindings(pattern.pattern), pattern.binding];
    case "Or":
      return pattern.alternatives[0] === undefined
        ? []
        : resolvedPatternBindings(pattern.alternatives[0]);
    case "Tuple":
      return pattern.elements.flatMap(resolvedPatternBindings);
    case "Vector":
      return [
        ...pattern.elements.flatMap(resolvedPatternBindings),
        ...(pattern.rest?.pattern === undefined
          ? []
          : resolvedPatternBindings(pattern.rest.pattern)),
      ];
    case "Record":
      return pattern.fields.flatMap((field) =>
        resolvedPatternBindings(field.pattern)
      );
    case "Constructor":
      return pattern.arguments.flatMap(resolvedPatternBindings);
  }
}

function isStructurallyIrrefutablePattern(pattern: Resolved.Pattern): boolean {
  switch (pattern.kind) {
    case "Wildcard":
    case "Binding":
    case "Unit":
      return true;
    case "As":
      return isStructurallyIrrefutablePattern(pattern.pattern);
    case "Or":
      return pattern.alternatives.some(isStructurallyIrrefutablePattern);
    case "Tuple":
      return pattern.elements.every(isStructurallyIrrefutablePattern);
    case "Vector":
      return pattern.rest !== undefined && pattern.elements.length === 0;
    case "Record":
      return pattern.fields.every((field) =>
        isStructurallyIrrefutablePattern(field.pattern)
      );
    case "Integer":
    case "String":
    case "Constructor":
      return false;
  }
}

function supports(
  type: Typed.PrimitiveName,
  constraint: Typed.ConstraintName,
): boolean {
  const instances: Record<Typed.PrimitiveName, readonly Typed.ConstraintName[]> = {
    Nat: ["Num", "Eq", "Ord", "Show", "Pow", "Hash", "Integral"],
    Int: ["Num", "Signed", "Eq", "Ord", "Show", "Pow", "Hash", "Integral"],
    Float: ["Num", "Signed", "Frac", "Eq", "Ord", "Show", "Pow", "Hash"],
    // No `Bool` row (#147): its four instances are *derived* from the `derives`
    // clause in `stdlib/Bool.hex`, through the same door a user's union uses,
    // rather than decreed here. That is the whole point of the declaration being
    // real prelude source — see Collections Part 2 §4.4.
    //
    // No `Unit` row either (#159): `Unit` is the empty tuple, so its four
    // instances are the automatic structural tuple instances, vacuous at zero
    // components — `#validate`'s structural branch, not a decree here.
    String: ["Eq", "Ord", "Show", "Concat", "Hash"],
    BigInt: ["Num", "Signed", "Eq", "Ord", "Show", "Pow", "Hash", "Integral"],
    Exn: [],
  };
  return instances[type].includes(constraint);
}

function isConstraintName(name: string): name is Typed.ConstraintName {
  return ["Num", "Signed", "Frac", "Pow", "Concat", "Eq", "Ord", "Show", "Hash", "Iterable", "Integral"].includes(name);
}

function inferredTypeVariableName(index: number): string {
  return index < 26 ? String.fromCharCode("a".charCodeAt(0) + index) : `t${index + 1}`;
}

/** Keeps the technical projection vocabulary out of source-facing diagnostics. */
function impliedTypeBinderMessage(constraint: string): string {
  const reason = `\`${constraint}\` declares an implied type and cannot constrain a type variable in v1`;
  return constraint === "Iterable"
    ? `${reason}; take a \`Seq(a)\` parameter instead`
    : reason;
}
